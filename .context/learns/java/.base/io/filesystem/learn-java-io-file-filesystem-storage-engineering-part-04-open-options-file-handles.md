# learn-java-io-file-filesystem-storage-engineering — Part 04  
# Open Options and File Handles: How Java Opens Files

> Target: Java 8 sampai Java 25  
> Fokus: `StandardOpenOption`, file handle/channel lifecycle, open mode semantics, truncation, append, create, delete-on-close, sparse file hint, synchronous write options, resource leak, dan perbedaan perilaku OS/filesystem.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

1. **Part 00** — file bukan sekadar data, tetapi kontrak antara Java API, provider, OS, filesystem, dan storage.
2. **Part 01** — `Path` adalah representasi lokasi/nama, bukan bukti file benar-benar ada.
3. **Part 02** — `exists`, `isRegularFile`, dan type check bukan lock; hasilnya bisa race.
4. **Part 03** — pembuatan file/directory punya atomicity tertentu, terutama `CREATE_NEW`, `createFile`, dan temp file.

Part ini masuk ke titik yang lebih rawan: **apa yang sebenarnya terjadi ketika program Java “membuka file”**.

Banyak bug file workflow bukan terjadi saat parsing data, tetapi saat membuka file dengan opsi yang salah:

```java
Files.write(path, bytes);
```

Kode di atas tampak aman. Padahal default behavior-nya adalah:

```text
CREATE + TRUNCATE_EXISTING + WRITE
```

Artinya:
- jika file belum ada: buat file;
- jika file sudah ada: kosongkan dulu;
- lalu tulis bytes;
- jika I/O error terjadi setelah truncate tapi sebelum semua byte tertulis, file bisa tertinggal dalam kondisi rusak/parsial.

Part ini membangun mental model bahwa **open operation adalah kontrak mutasi**, bukan sekadar “ambil stream”.

---

## 1. Mental Model: Membuka File Berarti Membuat Handle ke Objek Filesystem

Saat kita menulis:

```java
try (var channel = Files.newByteChannel(path, StandardOpenOption.READ)) {
    // read
}
```

Java tidak “memuat file” begitu saja. Secara konseptual terjadi rantai:

```text
Path
  → FileSystemProvider
      → OS syscall / runtime-specific implementation
          → directory lookup
              → permission check
                  → file object / inode / file record
                      → file descriptor / file handle
                          → Java Channel/Stream/Reader/Writer object
```

Objek Java seperti `InputStream`, `OutputStream`, `SeekableByteChannel`, atau `FileChannel` adalah wrapper di atas resource OS.

Konsekuensi penting:

1. **File handle adalah resource terbatas.**
   Tidak menutup file berarti membocorkan handle/file descriptor.

2. **Open file bisa tetap mengacu ke file object lama walaupun path berubah.**
   Di Unix-like system, directory entry bisa dihapus/di-rename saat file masih terbuka. Handle masih valid ke objek file lama. Di Windows, rename/delete file yang sedang dibuka sering gagal tergantung sharing mode dan handle yang aktif.

3. **Path lookup terjadi saat open, bukan terus-menerus.**
   Setelah file terbuka, channel/stream bekerja terhadap handle, bukan melakukan lookup path ulang setiap operasi.

4. **Open mode menentukan konsekuensi mutasi.**
   `APPEND`, `TRUNCATE_EXISTING`, `CREATE`, `CREATE_NEW`, `DELETE_ON_CLOSE`, `SYNC`, dan `DSYNC` mengubah kontrak operasi.

5. **Provider menentukan capability.**
   Default filesystem provider, ZIP filesystem provider, network filesystem, atau custom provider bisa mendukung subset perilaku yang berbeda.

---

## 2. API Surface untuk Membuka File di Java

Di Java modern, ada beberapa level API.

### 2.1 High-Level Convenience API

Contoh:

```java
byte[] data = Files.readAllBytes(path);

Files.write(path, data);

String text = Files.readString(path);       // Java 11+
Files.writeString(path, text);              // Java 11+
```

Cocok untuk:
- file kecil;
- script-like code;
- test fixture;
- konfigurasi sederhana;
- operasi yang bukan performance/durability critical.

Risiko:
- default option bisa tidak disadari;
- memory besar untuk file besar;
- error bisa terjadi setelah file dibuat/truncated/partial write;
- tidak memberi kontrol detail terhadap lifecycle dan durability.

### 2.2 Stream API

Contoh:

```java
try (InputStream in = Files.newInputStream(path)) {
    // read bytes
}

try (OutputStream out = Files.newOutputStream(path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    // write bytes
}
```

Cocok untuk:
- sequential byte stream;
- integrasi library lama;
- copy, upload, download;
- pipeline byte-oriented.

Catatan:
- `InputStream`/`OutputStream` tidak punya konsep posisi eksplisit.
- Untuk random access, gunakan channel.

### 2.3 Reader/Writer API

Contoh:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    // read text
}

try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE)) {
    // write text
}
```

Cocok untuk:
- text file;
- line-based parsing;
- CSV/log/config sederhana.

Catatan:
- Charset harus eksplisit untuk Java 8 compatibility.
- Writer bisa melempar `IOException` saat `write`, `flush`, atau `close`, terutama karena buffering dan encoding.

### 2.4 Channel API

Contoh:

```java
try (SeekableByteChannel channel = Files.newByteChannel(path,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {
    ByteBuffer buffer = ByteBuffer.allocate(8192);
    channel.read(buffer);
}
```

Atau khusus default provider:

```java
try (FileChannel channel = FileChannel.open(path,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {
    channel.position(0);
}
```

Cocok untuk:
- random access;
- locking;
- `force`;
- memory-mapped file;
- transfer antar channel;
- structured binary file;
- append-only log;
- file format internal.

---

## 3. `StandardOpenOption`: Peta Besar

`StandardOpenOption` tersedia sejak Java 7, jadi semua opsi utama relevan untuk Java 8 sampai Java 25.

Daftar option:

| Option | Makna ringkas |
|---|---|
| `READ` | Buka untuk membaca |
| `WRITE` | Buka untuk menulis |
| `APPEND` | Tulis selalu ke akhir file |
| `TRUNCATE_EXISTING` | Kosongkan file existing saat dibuka untuk write |
| `CREATE` | Buat file jika belum ada |
| `CREATE_NEW` | Buat file baru dan gagal jika sudah ada |
| `DELETE_ON_CLOSE` | Coba hapus file saat handle ditutup |
| `SPARSE` | Hint bahwa file baru akan sparse |
| `SYNC` | Setiap update content dan metadata disinkronkan ke storage |
| `DSYNC` | Setiap update content disinkronkan ke storage |

Mental model sederhana:

```text
Access mode:
  READ, WRITE, APPEND

Existence mode:
  CREATE, CREATE_NEW

Initial mutation mode:
  TRUNCATE_EXISTING

Lifecycle side effect:
  DELETE_ON_CLOSE

Storage/durability hint:
  SYNC, DSYNC

Filesystem allocation hint:
  SPARSE
```

---

## 4. Default Open Behavior yang Sering Menjebak

### 4.1 `Files.newByteChannel(path)` Default: READ

Jika tidak diberi option:

```java
try (SeekableByteChannel ch = Files.newByteChannel(path)) {
    // read
}
```

Secara konseptual sama dengan:

```java
Files.newByteChannel(path, StandardOpenOption.READ);
```

Artinya:
- file harus ada;
- tidak dibuat otomatis;
- tidak dikosongkan;
- dibuka untuk baca.

### 4.2 `Files.newInputStream(path)` Default: READ

```java
try (InputStream in = Files.newInputStream(path)) {
    // read
}
```

Default-nya juga membaca.

### 4.3 `Files.newOutputStream(path)` Default: CREATE + TRUNCATE_EXISTING + WRITE

Ini sangat penting:

```java
try (OutputStream out = Files.newOutputStream(path)) {
    out.write(bytes);
}
```

Default-nya adalah:

```java
StandardOpenOption.CREATE
StandardOpenOption.TRUNCATE_EXISTING
StandardOpenOption.WRITE
```

Konsekuensi:
- file dibuat jika belum ada;
- file existing dikosongkan di awal;
- jika write gagal setelah truncate, file lama sudah hilang.

### 4.4 `Files.write(path, bytes)` Default: CREATE + TRUNCATE_EXISTING + WRITE

```java
Files.write(path, bytes);
```

Juga default overwrite/truncate.

### 4.5 `Files.newBufferedWriter(path, charset)` Default: CREATE + TRUNCATE_EXISTING + WRITE

```java
Files.newBufferedWriter(path, StandardCharsets.UTF_8);
```

Juga default overwrite.

### 4.6 `Files.writeString(path, text)` Default: CREATE + TRUNCATE_EXISTING + WRITE

Java 11+:

```java
Files.writeString(path, text);
```

Juga overwrite/truncate.

#### Engineering Rule

Jangan biarkan default option tersembunyi untuk kode production yang memodifikasi file.

Lebih baik eksplisit:

```java
Files.write(path, bytes,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
```

Atau:

```java
Files.write(path, bytes,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Eksplisit membuat intent reviewable.

---

## 5. Access Mode: `READ`, `WRITE`, `APPEND`

### 5.1 `READ`

```java
try (SeekableByteChannel ch = Files.newByteChannel(path, StandardOpenOption.READ)) {
    // read only
}
```

Makna:
- file dibuka untuk baca;
- write tidak diizinkan;
- file harus ada;
- create option diabaikan jika file opened only for reading.

Gunakan untuk:
- parser;
- validator;
- checksum;
- import pipeline;
- file inspection.

### 5.2 `WRITE`

```java
try (SeekableByteChannel ch = Files.newByteChannel(path,
        StandardOpenOption.WRITE)) {
    // write
}
```

Makna:
- file dibuka untuk write;
- file harus ada kecuali dikombinasi `CREATE`/`CREATE_NEW`;
- posisi awal biasanya di awal file;
- tanpa `TRUNCATE_EXISTING`, menulis dari awal bisa overwrite sebagian tanpa menghapus sisa lama.

Contoh bahaya:

```java
Path p = Path.of("config.txt");

// Misalnya isi lama: "production=true"
Files.writeString(p, "dev",
        StandardOpenOption.WRITE);
```

Hasil bisa menjadi:

```text
devduction=true
```

Karena write dari awal hanya menimpa tiga byte/char awal, tidak otomatis truncate.

Untuk replace penuh, gunakan:

```java
Files.writeString(p, "dev",
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING);
```

Atau pattern lebih aman: temp file + atomic move, dibahas di part 07.

### 5.3 `APPEND`

```java
Files.writeString(logPath, "event\n",
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND);
```

Makna:
- file dibuka untuk write;
- tiap write diarahkan ke akhir file;
- tidak boleh digabung dengan `READ`;
- tidak boleh digabung dengan `TRUNCATE_EXISTING`.

Append cocok untuk:
- log sederhana;
- audit trail lokal;
- append-only journal sederhana;
- process checkpoint log.

Namun jangan salah paham:

```text
APPEND tidak otomatis berarti record-level atomic untuk semua ukuran, semua OS, semua filesystem, semua proses.
```

Dokumentasi Java menyatakan bahwa jika file dibuka untuk write oleh program lain, atomicity penulisan ke akhir file bersifat filesystem-specific.

#### Implikasi

Jika banyak thread/proses menulis record besar ke file yang sama, risiko:
- record interleaving;
- partial record;
- corrupted newline framing;
- ordering tidak seperti ekspektasi;
- write sukses sebagian.

Untuk audit/security-grade append log:
- gunakan single writer;
- gunakan queue;
- gunakan record framing;
- gunakan checksum;
- gunakan `FileChannel.force`;
- atau gunakan database/event store/logging system khusus.

---

## 6. Existence Mode: `CREATE` vs `CREATE_NEW`

### 6.1 `CREATE`

```java
try (OutputStream out = Files.newOutputStream(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {
    out.write(data);
}
```

Makna:
- jika file belum ada, buat;
- jika sudah ada, buka file existing;
- tidak gagal hanya karena file sudah ada;
- diabaikan jika `CREATE_NEW` juga ada;
- diabaikan jika file dibuka only for reading.

Gunakan ketika:
- ingin “upsert” file;
- append log yang boleh membuat file awal;
- cache file yang boleh dibuat jika belum ada.

Risiko:
- tidak mencegah overwrite;
- tidak mencegah race dengan writer lain;
- bisa membuka file milik proses lain;
- bisa menulis ke file yang sudah ada tanpa sadar.

### 6.2 `CREATE_NEW`

```java
try (OutputStream out = Files.newOutputStream(path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    out.write(data);
}
```

Makna:
- buat file baru;
- gagal jika file sudah ada;
- check existence dan create adalah atomic terhadap operasi filesystem lain;
- gagal jika path existing adalah symbolic link.

Gunakan untuk:
- lock file sederhana;
- unique output;
- claim file;
- idempotency marker;
- secure creation;
- temp/staging file finalization.

Contoh:

```java
public static boolean tryCreateMarker(Path marker) throws IOException {
    try {
        Files.writeString(marker, "claimed\n",
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE);
        return true;
    } catch (FileAlreadyExistsException e) {
        return false;
    }
}
```

Ini jauh lebih aman daripada:

```java
if (!Files.exists(marker)) {
    Files.writeString(marker, "claimed");
}
```

Karena versi kedua race-prone.

### 6.3 Decision Rule

| Intent | Option |
|---|---|
| File harus sudah ada | `READ` atau `WRITE` tanpa `CREATE` |
| Buat jika belum ada, buka jika sudah ada | `CREATE` |
| Buat hanya jika belum ada; gagal jika sudah ada | `CREATE_NEW` |
| Replace isi file existing | `TRUNCATE_EXISTING + WRITE` |
| Replace secara production-safe | temp file + atomic move |

---

## 7. Initial Mutation: `TRUNCATE_EXISTING`

`TRUNCATE_EXISTING` adalah salah satu option paling berbahaya jika tidak disengaja.

```java
Files.newOutputStream(path,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING);
```

Makna:
- jika file existing dan dibuka untuk write, ukuran file dibuat 0;
- jika file dibuka hanya read, option ini diabaikan;
- truncate terjadi saat open, bukan setelah semua data siap.

### 7.1 Bahaya Partial Replacement

Kode:

```java
Files.write(path, generateLargeBytes(),
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Failure scenario:

```text
T0 file lama valid
T1 open dengan TRUNCATE_EXISTING
T2 file menjadi 0 byte
T3 write 40%
T4 disk full / permission / process crash
T5 file sekarang rusak/parsial
```

Untuk data penting, ini bukan acceptable.

### 7.2 Kapan `TRUNCATE_EXISTING` Masuk Akal?

Cocok untuk:
- scratch file;
- generated file yang bisa dibuat ulang;
- test file;
- cache file non-critical;
- file yang tidak dibaca concurrent oleh pihak lain.

Tidak cocok untuk:
- config production;
- checkpoint;
- manifest;
- metadata index;
- audit file;
- financial/regulatory artifact;
- anything requiring crash consistency.

### 7.3 Replace Lebih Aman

Gunakan:
1. tulis ke temp file di directory sama;
2. flush/force;
3. atomic move ke target.

Akan dibahas detail di Part 07.

---

## 8. Lifecycle Side Effect: `DELETE_ON_CLOSE`

```java
try (SeekableByteChannel ch = Files.newByteChannel(path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE,
        StandardOpenOption.DELETE_ON_CLOSE)) {
    // work file
}
```

Makna:
- implementation akan berusaha menghapus file saat close;
- jika close tidak dipanggil, JVM akan best-effort saat terminate;
- detail deletion implementation-specific;
- tidak direkomendasikan untuk file yang juga dibuka pihak lain;
- security-sensitive application harus hati-hati.

### 8.1 Kapan Cocok?

Cocok untuk:
- work file internal satu JVM;
- temporary scratch;
- test;
- intermediate data yang tidak perlu recovery.

### 8.2 Kapan Tidak Cocok?

Hindari untuk:
- file shared antar proses;
- file di directory yang bisa dimodifikasi attacker;
- file workflow yang butuh audit/recovery;
- file yang harus diproses pihak lain;
- cleanup production yang harus deterministic.

### 8.3 Kenapa Tidak Deterministic?

Karena:
- close bisa gagal/terlambat;
- JVM crash bisa mencegah cleanup;
- OS behavior berbeda;
- Windows/Unix delete semantics berbeda;
- symbolic link/security caveat;
- file bisa diganti attacker dalam beberapa scenario.

Untuk production cleanup, lebih baik:
- explicit delete;
- cleanup job;
- TTL;
- marker;
- quarantine;
- metric cleanup failure.

---

## 9. Allocation Hint: `SPARSE`

```java
try (SeekableByteChannel ch = Files.newByteChannel(path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE,
        StandardOpenOption.SPARSE)) {
    // write sparse layout
}
```

Makna:
- hint bahwa file baru akan sparse;
- hanya relevan saat create new file;
- diabaikan jika filesystem tidak mendukung;
- bukan guarantee.

Sparse file adalah file yang logical size-nya besar, tetapi blok fisik tidak dialokasikan untuk region kosong.

Contoh use case:
- VM disk image;
- database file;
- random access file besar;
- preallocated logical layout;
- file format dengan offset jauh.

Risiko:
- copy tool tertentu bisa mengubah sparse menjadi fully allocated;
- `size()` tidak sama dengan disk usage;
- quota behavior bisa mengejutkan;
- network/object storage provider mungkin tidak mendukung.

Untuk Java engineer, treat `SPARSE` sebagai **optimization hint**, bukan correctness mechanism.

---

## 10. Durability Options: `SYNC` dan `DSYNC`

### 10.1 `SYNC`

```java
try (SeekableByteChannel ch = Files.newByteChannel(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.SYNC)) {
    ch.write(buffer);
}
```

Makna:
- setiap update content atau metadata harus ditulis synchronous ke underlying storage device.

### 10.2 `DSYNC`

```java
try (SeekableByteChannel ch = Files.newByteChannel(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.DSYNC)) {
    ch.write(buffer);
}
```

Makna:
- setiap update content harus ditulis synchronous ke underlying storage device;
- metadata tidak harus seketat `SYNC`, kecuali metadata diperlukan untuk content retrieval tergantung sistem.

### 10.3 `SYNC` vs `DSYNC`

| Option | Content | Metadata | Biaya |
|---|---:|---:|---|
| `DSYNC` | Ya | Tidak selalu | Lebih rendah |
| `SYNC` | Ya | Ya | Lebih tinggi |

Contoh metadata:
- file length;
- modification time;
- directory entry;
- permission;
- ownership;
- allocation metadata.

### 10.4 Kenapa Ini Tetap Bukan “Magic Durability”?

`SYNC`/`DSYNC` menaikkan guarantee, tetapi tetap ada boundary:
- storage controller cache;
- OS/filesystem implementation;
- network filesystem;
- virtualized disk;
- cloud volume semantics;
- directory entry durability;
- provider support.

Untuk atomic replace, durability target biasanya membutuhkan:
- force temp file content;
- atomic rename;
- force parent directory;
- handle failure matrix.

Itu dibahas di Part 07.

### 10.5 Kapan Gunakan `SYNC`/`DSYNC`?

Gunakan hati-hati untuk:
- journal;
- WAL;
- checkpoint;
- metadata state file;
- financial/regulatory record;
- recovery-critical state.

Hindari untuk:
- high-throughput logging biasa;
- cache;
- temporary file;
- per-request write kecil tanpa batching.

Karena synchronous write bisa sangat mahal.

---

## 11. `FileChannel.force(boolean metaData)` vs `SYNC`/`DSYNC`

Selain open option, `FileChannel` punya:

```java
channel.force(true);
channel.force(false);
```

Makna:
- `force(true)` meminta content dan metadata ditulis ke storage.
- `force(false)` meminta content saja.

Perbedaan mental model:

| Mechanism | Cara kerja |
|---|---|
| `SYNC` | setiap update synchronous |
| `DSYNC` | setiap content update synchronous |
| `force(true/false)` | explicit flush point saat dipanggil |

Untuk throughput, sering lebih baik:

```java
try (FileChannel ch = FileChannel.open(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {

    ch.write(buffer1);
    ch.write(buffer2);
    ch.write(buffer3);

    ch.force(false);
}
```

Daripada:

```java
FileChannel.open(path, CREATE, WRITE, DSYNC);
```

Karena `DSYNC` bisa memaksa setiap update menjadi synchronous, sedangkan `force` memungkinkan batching.

### 11.1 Batching Durability

Append-only log sering menggunakan pola:

```text
write record 1
write record 2
write record 3
force
ack batch
```

Trade-off:
- lebih cepat;
- tetapi crash sebelum force bisa kehilangan batch;
- harus didefinisikan dalam durability SLA.

---

## 12. Valid dan Tidak Valid: Kombinasi Option

Tidak semua kombinasi masuk akal.

### 12.1 `APPEND + READ`

Tidak valid untuk `newByteChannel` default semantics.

```java
Files.newByteChannel(path,
        StandardOpenOption.READ,
        StandardOpenOption.APPEND); // invalid
```

Kenapa?
- `APPEND` berarti write mode dan posisi write dikontrol ke EOF;
- read + append ambigu untuk channel positioning.

Jika butuh read + write random access, gunakan:

```java
FileChannel.open(path,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE);
```

Lalu atur posisi secara eksplisit.

### 12.2 `APPEND + TRUNCATE_EXISTING`

Tidak valid.

```java
Files.newOutputStream(path,
        StandardOpenOption.APPEND,
        StandardOpenOption.TRUNCATE_EXISTING); // invalid
```

Kenapa?
- append berarti preserve content dan tambah di akhir;
- truncate berarti hapus content existing.

### 12.3 `CREATE_NEW + CREATE`

`CREATE` diabaikan jika `CREATE_NEW` ada.

```java
Files.newOutputStream(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
```

Secara intent, ini membingungkan. Lebih baik pilih satu.

### 12.4 `TRUNCATE_EXISTING` tanpa `WRITE`

Diabaikan jika only read.

```java
Files.newByteChannel(path,
        StandardOpenOption.READ,
        StandardOpenOption.TRUNCATE_EXISTING);
```

Jangan tulis option yang tidak punya efek; ini menyulitkan reviewer.

---

## 13. Open Mode Cookbook

### 13.1 Read Existing File

```java
try (InputStream in = Files.newInputStream(path)) {
    // read
}
```

Atau eksplisit:

```java
try (SeekableByteChannel ch = Files.newByteChannel(path, StandardOpenOption.READ)) {
    // read
}
```

Behavior:
- gagal jika tidak ada;
- tidak create;
- tidak mutate.

### 13.2 Create New File, Fail if Exists

```java
try (OutputStream out = Files.newOutputStream(path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    out.write(data);
}
```

Gunakan untuk:
- idempotency;
- safe publish;
- claim/marker.

### 13.3 Create or Overwrite Existing File

```java
Files.write(path, data,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Gunakan hanya jika partial replacement acceptable.

### 13.4 Append to Existing File, Fail if Missing

```java
Files.writeString(path, line,
        StandardCharsets.UTF_8,
        StandardOpenOption.APPEND);
```

Behavior:
- gagal jika file tidak ada;
- append ke akhir.

### 13.5 Append, Create if Missing

```java
Files.writeString(path, line,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND);
```

Behavior:
- buat jika belum ada;
- append jika sudah ada.

### 13.6 Open for Random Read/Write

```java
try (FileChannel ch = FileChannel.open(path,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {
    ch.position(128);
    ch.write(buffer);
}
```

Behavior:
- file harus ada;
- tidak truncate;
- posisi dikontrol manual.

### 13.7 Open Durable Journal with Batched Force

```java
try (FileChannel ch = FileChannel.open(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.APPEND)) {

    ch.write(recordBuffer);
    ch.force(false);
}
```

Catatan:
- `APPEND` dan `FileChannel.position` punya semantics yang perlu diuji pada provider/OS target.
- Untuk journal production, format record harus punya framing/checksum/recovery.

### 13.8 Scratch File Auto Delete

```java
try (SeekableByteChannel ch = Files.newByteChannel(path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE,
        StandardOpenOption.DELETE_ON_CLOSE)) {
    // scratch
}
```

Gunakan untuk local internal scratch, bukan shared workflow.

---

## 14. Resource Lifecycle: `close()` Adalah Bagian dari Correctness

File handle harus ditutup.

Benar:

```java
try (InputStream in = Files.newInputStream(path)) {
    return in.readAllBytes();
}
```

Salah:

```java
InputStream in = Files.newInputStream(path);
return in.readAllBytes(); // leak jika tidak close
```

### 14.1 Kenapa Leak Berbahaya?

Resource leak bisa menyebabkan:
- `Too many open files` di Linux;
- tidak bisa delete/rename file di Windows;
- file lock tertahan;
- directory stream tidak tertutup;
- temp file tidak terhapus;
- process memory/native resource naik;
- production degradation pelan-pelan.

### 14.2 `try-with-resources` dan Exception Saat Close

`close()` bisa melempar exception. `try-with-resources` akan menangani suppressed exception.

Contoh:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write("hello");
}
```

Jika `write` sukses tetapi `close` gagal karena flush gagal, maka operasi seharusnya dianggap gagal.

### 14.3 Jangan Abaikan Error Saat Close

Ini buruk:

```java
try {
    writer.write(data);
} finally {
    try {
        writer.close();
    } catch (IOException ignored) {
    }
}
```

Kenapa?
- buffered writer bisa baru benar-benar gagal saat close;
- mengabaikan close error berarti menganggap file valid padahal mungkin tidak lengkap.

---

## 15. Buffered Writer: Error Bisa Muncul Terlambat

Dengan buffering:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write(largeText);
}
```

Beberapa error bisa terjadi saat:
- `write`;
- `flush`;
- `close`.

Contoh:
- disk full;
- permission issue;
- network filesystem failure;
- encoding issue;
- broken mount;
- quota exceeded.

Mental model:

```text
writer.write(...)
  belum tentu semua byte sudah ke OS/storage

writer.flush()
  mendorong buffer Java ke underlying stream/channel

close()
  flush terakhir + close resource

FileChannel.force()
  meminta data sampai storage boundary
```

Jadi:
- `flush` bukan durability guarantee;
- `close` bukan selalu durability guarantee;
- `force`/`SYNC`/`DSYNC` lebih dekat ke durability, namun tetap provider/storage dependent.

---

## 16. Path vs Open Handle: Rename/Delete Setelah Open

### 16.1 Unix-Like Mental Model

Di Unix-like filesystem:
- path adalah directory entry;
- open handle menunjuk file object;
- file bisa dihapus dari directory tapi data tetap ada sampai handle terakhir ditutup.

Scenario:

```text
T0 process A open /tmp/a.txt
T1 process B delete /tmp/a.txt
T2 path /tmp/a.txt tidak ada
T3 process A masih bisa baca/tulis via handle
T4 process A close
T5 storage bisa dilepas
```

### 16.2 Windows Mental Model

Di Windows:
- delete/rename file yang sedang terbuka sering gagal tergantung sharing mode;
- proses lain bisa mendapat `AccessDeniedException`;
- mapped file/stream/channel bisa mencegah cleanup.

### 16.3 Implikasi Cross-Platform

Kode yang lolos di Linux bisa gagal di Windows:

```java
try (InputStream in = Files.newInputStream(path)) {
    Files.delete(path); // mungkin OK di Unix, bisa gagal di Windows
}
```

Production-grade rule:
- close dulu sebelum delete/rename;
- test di OS target;
- jangan mengandalkan Unix unlink semantics jika aplikasi cross-platform.

---

## 17. Open File dan Symbolic Link

Saat membuka file existing, symbolic link biasanya diikuti oleh default provider untuk banyak operasi, kecuali option/operation tertentu menyatakan `NOFOLLOW_LINKS` atau security behavior tertentu.

`CREATE_NEW` punya karakteristik penting:
- gagal jika path sudah ada;
- gagal juga jika path existing adalah symbolic link.

Ini penting untuk secure creation.

Contoh masalah:

```java
Path target = uploadDir.resolve(userProvidedName);

Files.write(target, data,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Jika attacker bisa membuat symlink di `uploadDir`, target bisa mengarah ke file lain.

Part 12 dan Part 13 akan membahas symlink/path traversal lebih dalam. Untuk sekarang, ingat:

```text
Open option bukan pengganti secure path containment.
```

---

## 18. File Handle dan Concurrency

### 18.1 Multiple Readers

Umumnya beberapa reader bisa membuka file yang sama.

Namun:
- file bisa berubah saat dibaca;
- reader tidak otomatis mendapat snapshot;
- hasil bisa inconsistent jika writer aktif.

### 18.2 Reader + Writer

Jika satu proses membaca saat proses lain menulis:
- reader bisa melihat data lama, baru, campuran, atau partial tergantung OS/filesystem/pattern;
- tidak ada transaction boundary otomatis;
- file size bisa berubah saat loop membaca;
- parser bisa gagal di tengah.

### 18.3 Multiple Writers

Ini paling berbahaya:
- write interleaving;
- lost update;
- file corruption;
- truncation race;
- append ordering ambiguity;
- lock conflict.

Contoh buruk:

```java
// Process A
Files.writeString(path, "A",
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);

// Process B
Files.writeString(path, "B",
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Tidak ada jaminan final state sesuai urutan bisnis. Final file bisa A, B, empty, atau partial jika failure terjadi.

### 18.4 Coordination Strategy

Untuk single file mutable state:
- gunakan single writer;
- gunakan atomic replace;
- gunakan lock jika cukup lokal;
- gunakan database jika multi-node;
- gunakan append-only + recovery jika butuh audit;
- gunakan rename-based claim untuk file intake.

---

## 19. File Handle dan Permission

Open operation melakukan permission check.

Contoh:

```java
Files.newInputStream(path);  // butuh read permission
Files.newOutputStream(path); // butuh write permission pada file/directory tergantung create
```

Nuansa:
- create butuh write/execute pada parent directory di POSIX;
- write existing butuh permission pada file;
- truncate butuh write;
- delete biasanya butuh permission pada parent directory;
- Windows ACL berbeda;
- container UID/GID bisa berbeda dari host;
- mounted volume bisa read-only;
- permission bisa berubah setelah open.

Jika permission berubah setelah file terbuka, behavior bergantung OS/provider. Jangan desain security model dengan asumsi “permission check akan terus terjadi di setiap write”.

---

## 20. Exception Taxonomy Saat Open

Beberapa exception penting:

| Exception | Umum terjadi saat |
|---|---|
| `NoSuchFileException` | file tidak ada |
| `FileAlreadyExistsException` | `CREATE_NEW` tetapi file sudah ada |
| `AccessDeniedException` | permission/sharing/lock/path protected |
| `DirectoryNotEmptyException` | bukan open biasa, tapi deletion/move tertentu |
| `NotDirectoryException` | komponen path seharusnya directory tapi bukan |
| `FileSystemLoopException` | traversal follow symlink loop |
| `UnsupportedOperationException` | option/provider tidak didukung |
| `IllegalArgumentException` | kombinasi option invalid |
| `IOException` | fallback umum untuk I/O failure |

### 20.1 Jangan Catch Semua sebagai “File Not Found”

Buruk:

```java
try {
    Files.newInputStream(path);
} catch (IOException e) {
    throw new RuntimeException("File not found");
}
```

Lebih baik:

```java
try (InputStream in = Files.newInputStream(path)) {
    // read
} catch (NoSuchFileException e) {
    throw new IllegalStateException("Required file does not exist: " + path, e);
} catch (AccessDeniedException e) {
    throw new IllegalStateException("No permission to read file: " + path, e);
} catch (IOException e) {
    throw new IllegalStateException("Failed to read file: " + path, e);
}
```

Dalam sistem production, error classification membantu:
- retry decision;
- alert severity;
- user message;
- audit trail;
- remediation.

---

## 21. Java 8 sampai Java 25: Compatibility Notes

### 21.1 Stabil Sejak Java 8

Konsep berikut tersedia di Java 8:
- `Path`;
- `Files`;
- `StandardOpenOption`;
- `Files.newInputStream`;
- `Files.newOutputStream`;
- `Files.newByteChannel`;
- `FileChannel.open`;
- `Files.write`;
- `Files.newBufferedReader`;
- `Files.newBufferedWriter`.

### 21.2 Java 11+

Java 11 menambahkan convenience method:

```java
Files.readString(path);
Files.writeString(path, text);
```

Untuk Java 8 compatible code, gunakan:

```java
String text = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);

Files.write(path,
        text.getBytes(StandardCharsets.UTF_8),
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

### 21.3 Java 25

Di Java 25, API dasar open option tetap sama. Yang berubah lebih banyak pada:
- dokumentasi modern;
- API notes di class lain;
- default charset convenience method yang lebih jelas;
- platform/module context.

Seri ini akan selalu menandai jika ada API yang tidak tersedia di Java 8.

---

## 22. Design Pattern: Explicit Open Intent

Untuk production code, buat helper agar intent jelas.

### 22.1 Read Existing

```java
public static InputStream openExistingForRead(Path path) throws IOException {
    return Files.newInputStream(path, StandardOpenOption.READ);
}
```

### 22.2 Create New

```java
public static OutputStream createNewForWrite(Path path) throws IOException {
    return Files.newOutputStream(path,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE);
}
```

### 22.3 Append Event

```java
public static void appendUtf8Line(Path path, String line) throws IOException {
    Files.writeString(path,
            line + System.lineSeparator(),
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND);
}
```

Java 8 version:

```java
public static void appendUtf8LineJava8(Path path, String line) throws IOException {
    Files.write(path,
            Collections.singletonList(line),
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND);
}
```

### 22.4 Overwrite Non-Critical

```java
public static void overwriteNonCritical(Path path, byte[] bytes) throws IOException {
    Files.write(path, bytes,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE);
}
```

Nama method sengaja memakai `NonCritical` agar reviewer sadar bahwa ini bukan crash-safe replace.

---

## 23. Anti-Patterns

### 23.1 Implicit Overwrite

```java
Files.write(path, bytes);
```

Masalah:
- default truncate tersembunyi;
- reviewer tidak tahu apakah overwrite disengaja.

Lebih baik:

```java
Files.write(path, bytes,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Atau atomic replace.

### 23.2 Check-Then-Open

```java
if (!Files.exists(path)) {
    Files.write(path, bytes);
}
```

Masalah:
- race condition;
- proses lain bisa membuat file setelah check.

Lebih baik:

```java
Files.write(path, bytes,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
```

### 23.3 Write Without Close

```java
OutputStream out = Files.newOutputStream(path);
out.write(bytes);
```

Masalah:
- resource leak;
- buffer mungkin belum flush;
- Windows delete/rename issue.

Lebih baik:

```java
try (OutputStream out = Files.newOutputStream(path)) {
    out.write(bytes);
}
```

### 23.4 Swallow Close Exception

```java
try {
    writer.close();
} catch (IOException ignored) {
}
```

Masalah:
- data loss bisa disembunyikan.

### 23.5 Assume Append Is Distributed-Safe

```java
Files.writeString(sharedNfsPath, event,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND);
```

Masalah:
- atomicity append across machines/filesystems tidak boleh diasumsikan.

### 23.6 Use `DELETE_ON_CLOSE` for Security Cleanup

Masalah:
- best effort;
- implementation-specific;
- symlink/security caveat;
- tidak cocok untuk cleanup deterministik.

---

## 24. Practical Failure Models

### 24.1 Disk Full During `Files.write`

```text
T0 open with CREATE + TRUNCATE_EXISTING + WRITE
T1 target truncated
T2 write starts
T3 disk full
T4 IOException
T5 target partial/corrupt
```

Mitigation:
- temp file + atomic move;
- preflight capacity check only as guardrail, not guarantee;
- handle partial file;
- force and recovery logic.

### 24.2 Permission Revoked Before Open

```text
T0 app has path
T1 permission changed
T2 open fails AccessDeniedException
```

Mitigation:
- classify error;
- do not retry blindly;
- alert configuration/security issue.

### 24.3 Concurrent Truncate

```text
T0 reader opens file
T1 writer opens same path with TRUNCATE_EXISTING
T2 reader observes unexpected EOF/partial data
```

Mitigation:
- atomic replace;
- versioned file;
- single writer;
- readers open immutable published files.

### 24.4 Temp File Leak

```text
T0 create temp file
T1 write starts
T2 exception
T3 code forgets cleanup
T4 temp files accumulate
```

Mitigation:
- try/finally cleanup;
- temp directory lifecycle;
- background janitor;
- metrics.

### 24.5 Windows Delete Failure

```text
T0 channel open
T1 cleanup tries delete
T2 AccessDeniedException
```

Mitigation:
- close all streams/channels;
- avoid leaking directory streams;
- test on Windows if supported;
- retry with backoff only if safe.

---

## 25. File Opening in Production Architecture

Dalam sistem besar, open option harus berasal dari domain intent.

Contoh domain:

```text
File Intake Engine
  - incoming file: read-only
  - staging file: create_new + write
  - published file: atomic move from staging
  - status file: atomic replace
  - audit log: append with single writer
  - temp work file: create_new + delete_on_close maybe okay
```

Jangan biarkan setiap developer memilih open option ad-hoc.

Lebih baik desain abstraction:

```java
interface FileRepository {
    InputStream openPublished(String id) throws IOException;
    OutputStream createStaging(String id) throws IOException;
    void appendAudit(AuditRecord record) throws IOException;
    void publish(String id) throws IOException;
}
```

Lalu implementasi internal memaksa option yang benar.

---

## 26. Checklist Sebelum Membuka File untuk Write

Tanyakan:

1. Apakah file harus sudah ada?
2. Apakah file boleh dibuat?
3. Apakah file boleh sudah ada?
4. Apakah existing content boleh hilang?
5. Apakah partial write acceptable?
6. Apakah reader lain bisa membaca saat write?
7. Apakah writer lain bisa menulis bersamaan?
8. Apakah path berasal dari user input?
9. Apakah symlink harus dihindari?
10. Apakah durability setelah crash diperlukan?
11. Apakah metadata harus durable?
12. Apakah file berada di local disk, network filesystem, container volume, atau object-storage-like provider?
13. Apakah cleanup harus deterministic?
14. Apakah operasi harus portable Linux/Windows/macOS?
15. Apakah error harus retryable atau fatal?

Jika jawaban nomor 4 atau 5 adalah “tidak boleh”, jangan gunakan direct truncate overwrite. Gunakan atomic replace pattern.

---

## 27. Mini Lab: Mengamati Efek Open Option

### 27.1 `WRITE` tanpa `TRUNCATE_EXISTING`

```java
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class WriteWithoutTruncateDemo {
    public static void main(String[] args) throws Exception {
        Path p = Path.of("demo.txt");

        Files.writeString(p, "production=true", StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE);

        Files.writeString(p, "dev", StandardCharsets.UTF_8,
                StandardOpenOption.WRITE);

        System.out.println(Files.readString(p));
    }
}
```

Kemungkinan output:

```text
devduction=true
```

Lesson:
- `WRITE` tidak sama dengan replace seluruh file.

Java 8 version ganti `Path.of` menjadi:

```java
Path p = Paths.get("demo.txt");
```

Dan ganti `writeString/readString` dengan `Files.write/readAllBytes`.

### 27.2 `CREATE_NEW` untuk Menghindari Race

```java
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class CreateNewDemo {
    public static void main(String[] args) throws Exception {
        Path marker = Path.of("job.claimed");

        try {
            Files.writeString(marker, "claimed", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE);
            System.out.println("Claim success");
        } catch (FileAlreadyExistsException e) {
            System.out.println("Already claimed");
        }
    }
}
```

Lesson:
- atomic create lebih baik daripada check-then-create.

### 27.3 Append Tidak Sama dengan Record Transaction

```java
Files.writeString(logPath, "event-a\n", StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND);
```

Lesson:
- cukup untuk log lokal sederhana;
- belum cukup untuk multi-process, multi-node, regulatory-grade audit.

---

## 28. Java 8 Compatibility Appendix

Beberapa contoh di seri ini memakai Java modern syntax untuk readability:

```java
var path = Path.of("file.txt");
Files.writeString(path, "hello");
```

Untuk Java 8:

```java
Path path = Paths.get("file.txt");
Files.write(path,
        "hello".getBytes(StandardCharsets.UTF_8),
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

`StandardOpenOption` sendiri tersedia di Java 8, jadi core pembahasan part ini tetap valid.

---

## 29. Top 1% Mental Model

Engineer biasa berpikir:

```text
Saya ingin menulis file.
Pakai Files.write.
Selesai.
```

Engineer kuat berpikir:

```text
Apa intent mutasinya?
Apakah create, replace, append, atau claim?
Apakah existing content boleh hilang?
Apakah partial write acceptable?
Apakah ada reader/writer lain?
Apakah path bisa diganti symlink?
Apakah write harus durable setelah crash?
Apakah file handle ditutup dengan benar?
Apakah behavior portable di OS/filesystem target?
Apa recovery story jika error terjadi setelah open tapi sebelum close?
```

Engineer top-tier tidak memilih API hanya karena “bisa jalan”, tetapi karena **kontrak failure-nya sesuai dengan kebutuhan sistem**.

---

## 30. Ringkasan

Key points:

1. Membuka file berarti membuat OS/provider-backed handle.
2. `Path` bukan file handle.
3. Default `Files.write`, `newOutputStream`, dan `newBufferedWriter` adalah overwrite/truncate.
4. `WRITE` tanpa `TRUNCATE_EXISTING` bisa overwrite sebagian dan meninggalkan tail lama.
5. `CREATE_NEW` adalah tool penting untuk atomic create.
6. `APPEND` bukan otomatis distributed-safe atau record-transaction-safe.
7. `DELETE_ON_CLOSE` adalah best-effort dan implementation-specific.
8. `SPARSE` hanya hint.
9. `SYNC`/`DSYNC` meningkatkan durability cost, tetapi bukan pengganti desain crash consistency.
10. `FileChannel.force` memungkinkan explicit durability point.
11. `close()` adalah bagian dari correctness, bukan formalitas.
12. Error saat close/flush bisa berarti data belum aman.
13. OS/filesystem/provider memengaruhi behavior.
14. Production file workflow harus eksplisit tentang open option.
15. Jika partial overwrite tidak acceptable, gunakan atomic replace pattern.

---

## 31. Latihan Pemahaman

Jawab sebelum lanjut:

1. Apa bedanya `CREATE` dan `CREATE_NEW`?
2. Kenapa `Files.write(path, bytes)` bisa berbahaya untuk config production?
3. Apa hasil potensial dari `WRITE` tanpa `TRUNCATE_EXISTING`?
4. Kenapa `APPEND` tidak boleh dianggap multi-process safe?
5. Kenapa `DELETE_ON_CLOSE` tidak cocok untuk cleanup security-sensitive?
6. Apa bedanya `flush`, `close`, `force`, `SYNC`, dan `DSYNC`?
7. Kenapa direct overwrite tidak crash-safe?
8. Kenapa error saat `close` tidak boleh diabaikan?
9. Apa implikasi Unix vs Windows saat delete file yang masih terbuka?
10. Kapan lebih baik memakai `FileChannel` daripada `OutputStream`?

---

## 32. Preview Part Berikutnya

Part berikutnya:

```text
Part 05 — Reading Files Correctly: Small File, Large File, Streaming, Lazy Lines
```

Kita akan membahas:
- `readAllBytes`;
- `readString`;
- `readAllLines`;
- `Files.lines`;
- `BufferedReader`;
- charset dan BOM;
- large file strategy;
- lazy stream resource lifecycle;
- file berubah saat dibaca;
- error handling;
- parser design untuk production file ingestion.

---

## Referensi Utama

- Oracle Java SE 25 — `java.nio.file.StandardOpenOption`
- Oracle Java SE 8 — `java.nio.file.StandardOpenOption`
- Oracle Java SE 25 — `java.nio.file.Files`
- Oracle Java SE 25 — `java.nio.channels.FileChannel`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 03](./learn-java-io-file-filesystem-storage-engineering-part-03-file-creation-semantics.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 05](./learn-java-io-file-filesystem-storage-engineering-part-05-reading-files-correctly.md)
