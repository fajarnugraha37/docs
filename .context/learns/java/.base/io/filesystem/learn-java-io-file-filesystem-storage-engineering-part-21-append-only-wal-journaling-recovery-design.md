# Part 21 — Append-Only Files, WAL, Journaling, and Recovery Design

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Target: Java 8 hingga Java 25  
> Level: Advanced / production-grade filesystem engineering  
> Fokus: append-only file, write-ahead log, journaling, record framing, checksum, commit marker, segment, compaction, dan crash recovery.

---

## 1. Mengapa Bagian Ini Penting

Di banyak sistem production, file tidak hanya dipakai sebagai “tempat simpan data”, tetapi sebagai **mekanisme recovery**.

Contoh nyata:

- job processor menyimpan progress agar bisa resume setelah crash;
- file intake engine mencatat file mana yang sudah diterima, divalidasi, diproses, gagal, atau dikarantina;
- local queue menyimpan message sebelum dikirim ke server;
- embedded database memakai log untuk durability;
- search/index engine menyimpan segment dan commit metadata;
- replication engine menulis perubahan ke log sebelum dikirim;
- audit pipeline mencatat event secara append-only agar tidak kehilangan jejak;
- cache lokal menyimpan journal supaya tidak perlu rebuild penuh setelah restart.

Masalahnya: file write di dunia nyata **tidak selalu selesai utuh**.

Aplikasi bisa mati di tengah write. OS bisa crash. Disk bisa penuh. Container bisa di-evict. Network filesystem bisa timeout. Proses lain bisa mengubah file. Dan bahkan saat Java method `write(...)` tidak melempar exception, itu belum otomatis berarti semua byte sudah durable di storage fisik.

Karena itu, engineer top-tier tidak hanya bertanya:

```text
Bagaimana cara menulis file?
```

Tetapi bertanya:

```text
Jika proses mati di setiap byte boundary yang mungkin, state apa yang tersisa,
dan bagaimana sistem memulihkan diri tanpa corrupt, double-process, atau kehilangan data?
```

Bagian ini membangun mental model untuk menjawab pertanyaan itu.

---

## 2. Mental Model Utama

Append-only dan WAL adalah cara mengubah problem “update state yang kompleks” menjadi problem yang lebih sederhana:

```text
Daripada mengubah state lama secara langsung,
tulis fakta baru di ujung log.
```

File mutable biasa:

```text
state.dat
  offset 100..200 diubah langsung
```

Jika crash di tengah update, file bisa berisi campuran state lama dan state baru.

Append-only log:

```text
events.log
  record 1
  record 2
  record 3
  record 4 baru ditambahkan di akhir
```

Jika crash di tengah record 4, record 1–3 masih bisa dibaca. Record 4 dianggap incomplete dan dipotong/diabaikan.

WAL atau write-ahead log membawa prinsip ini lebih jauh:

```text
Sebelum state utama diubah, niat/perubahan dicatat dulu ke log yang durable.
```

Urutannya:

```text
1. tulis log: "akan melakukan perubahan X"
2. pastikan log durable
3. baru ubah data utama
4. tulis commit/done marker jika perlu
```

Kalau crash terjadi, log dipakai untuk menentukan:

- perubahan mana yang harus diulang;
- perubahan mana yang harus diabaikan;
- perubahan mana yang sudah committed;
- file mana yang harus dipindah ke done/error/quarantine;
- state utama mana yang harus dibangun ulang.

---

## 3. Vocabulary yang Harus Dibedakan

### 3.1 Append-only file

File yang secara normal hanya bertambah di akhir.

```text
append-only.log
  [record][record][record][record]
```

Tidak berarti file tidak pernah dipotong. Saat recovery, file bisa di-`truncate` sampai last known good offset. Saat compaction, file lama bisa diganti dengan segment baru.

Invarian append-only:

```text
Existing valid prefix tidak dimodifikasi.
Record baru hanya ditambahkan setelah prefix valid.
```

### 3.2 WAL — Write-Ahead Log

Log yang ditulis **sebelum** perubahan utama dilakukan.

Tujuannya:

- redo: ulangi perubahan yang committed tetapi belum diaplikasikan penuh;
- undo: batalkan perubahan yang belum committed;
- recovery: rekonstruksi state setelah crash.

Dalam sistem aplikasi biasa, WAL sering tidak perlu serumit database. Tetapi prinsipnya tetap sama: **log dulu, durable-kan, baru lakukan side effect utama**.

### 3.3 Journal

Journal adalah catatan transisi operasi, biasanya dipakai untuk membuat multi-step workflow bisa dipulihkan.

Contoh journal file intake:

```text
RECEIVED file=A.tmp hash=?
VALIDATED file=A.tmp hash=abc
PUBLISHED file=A.dat hash=abc
PROCESSING file=A.dat
DONE file=A.dat
```

Journal tidak selalu byte-level seperti WAL database. Bisa berupa event log domain.

### 3.4 Commit marker

Commit marker adalah tanda eksplisit bahwa record atau batch sudah lengkap.

Contoh:

```text
BEGIN_TX tx=42
PUT key=a value=1
PUT key=b value=2
COMMIT_TX tx=42
```

Jika crash setelah `PUT` tetapi sebelum `COMMIT_TX`, recovery menganggap transaction belum committed.

### 3.5 Segment

Segment adalah pecahan log.

```text
log-000001.seg
log-000002.seg
log-000003.seg
```

Kenapa perlu segment?

- file tunggal tidak tumbuh tanpa batas;
- compaction lebih mudah;
- retention lebih mudah;
- recovery bisa skip segment yang sudah final;
- backup dan upload lebih manageable;
- corruption bisa diisolasi.

### 3.6 Snapshot

Snapshot adalah representasi state pada titik tertentu.

```text
snapshot-000120.bin
log-000121.seg
log-000122.seg
```

Recovery:

```text
load snapshot terakhir
replay log setelah snapshot
```

Tanpa snapshot, replay log bisa terlalu lama.

### 3.7 Compaction

Compaction adalah proses membuang record lama yang sudah tidak perlu.

Contoh log key-value:

```text
PUT A=1
PUT A=2
PUT A=3
```

State akhir hanya butuh `A=3`. Compaction membuat segment baru yang berisi state terkini.

---

## 4. Prinsip Paling Penting: Valid Prefix

Append-only file harus didesain agar punya sifat **valid prefix**.

Artinya:

```text
Jika file terpotong di posisi mana pun karena crash,
reader masih bisa menemukan prefix record yang valid,
lalu berhenti di record incomplete/corrupt.
```

Ini lebih penting dari formatnya sendiri.

Format buruk:

```text
record tanpa length
record tanpa checksum
record tanpa delimiter reliable
```

Saat crash, reader tidak tahu mana record terakhir yang lengkap.

Format lebih baik:

```text
[length][payload][checksum]
[length][payload][checksum]
[length][payload][checksum]
```

Reader bisa membaca:

1. baca length;
2. pastikan payload sebanyak length tersedia;
3. baca checksum;
4. hitung checksum;
5. jika valid, record diterima;
6. jika EOF/incomplete/checksum mismatch, stop dan truncate ke last good offset.

Mental model:

```text
Append-only recovery = scan sampai first invalid boundary.
```

---

## 5. Kenapa `println` Log Bukan WAL

Banyak engineer membuat local journal seperti ini:

```java
Files.writeString(log, "DONE " + id + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
```

Ini bisa cukup untuk kasus low-risk, tetapi bukan WAL production-grade.

Masalah:

- satu line bisa partial;
- newline bisa hilang;
- encoding bisa bermasalah;
- tidak ada checksum;
- tidak ada version;
- tidak ada length;
- tidak ada commit marker;
- tidak ada fsync/force;
- append atomicity tidak selalu dijamin untuk semua kondisi;
- jika dua writer menulis bersamaan, record bisa interleave tergantung platform dan cara menulis;
- recovery tidak bisa membedakan line corrupt vs line valid yang kebetulan aneh.

Text log boleh dipakai jika requirement-nya:

- best-effort audit/debug;
- bisa kehilangan beberapa event terakhir;
- corruption manual bisa diterima;
- tidak menjadi source of truth.

Untuk recovery source-of-truth, gunakan framing yang eksplisit.

---

## 6. Java API yang Relevan

### 6.1 `FileChannel`

`FileChannel` adalah primitive utama untuk desain log serius karena:

- bisa menulis byte buffer;
- bisa mengetahui posisi;
- bisa menulis di posisi tertentu;
- bisa `force(...)`;
- bisa `truncate(...)`;
- bisa dipakai untuk lock jika perlu;
- cocok untuk binary format.

Open contoh:

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {
    // read/write/recovery
}
```

Untuk append-only single writer, ada dua pendekatan:

#### Pendekatan A — explicit position

```java
long end = channel.size();
channel.position(end);
writeFully(channel, recordBuffer);
```

Kelebihan:

- posisi eksplisit;
- mudah menyimpan offset;
- mudah recovery/truncate;
- cocok single writer.

Kekurangan:

- jika banyak writer, perlu koordinasi.

#### Pendekatan B — `APPEND`

```java
FileChannel.open(path,
    StandardOpenOption.CREATE,
    StandardOpenOption.WRITE,
    StandardOpenOption.APPEND);
```

Kelebihan:

- intent jelas: tulis di akhir.

Kekurangan:

- atomicity append bersifat provider/filesystem-specific;
- offset record yang baru ditulis tidak selalu mudah diketahui dengan aman jika concurrent writer;
- untuk WAL yang butuh offset presisi, single writer queue sering lebih baik.

### 6.2 `StandardOpenOption.SYNC` dan `DSYNC`

`SYNC` meminta setiap update content atau metadata ditulis sinkron ke underlying storage device.

`DSYNC` meminta setiap update content ditulis sinkron ke underlying storage device.

Tetapi ini mahal karena setiap write menjadi synchronous integrity operation.

Alternatif umum:

```java
write several records
channel.force(false)
```

`force(false)` biasanya berarti force content, sedangkan `force(true)` meminta content dan metadata.

Untuk append ke file existing, content sering cukup. Untuk create/rename file baru, metadata directory juga penting, tetapi Java standar tidak punya API portable sempurna untuk directory fsync di semua platform.

### 6.3 `truncate`

Recovery append-only sering memakai:

```java
channel.truncate(lastGoodOffset);
```

Tujuannya membuang partial tail.

Invarian:

```text
Setelah recovery, file hanya berisi valid records.
```

---

## 7. Record Framing: Format Minimal yang Layak

Format minimal production-grade:

```text
+------------+------------+--------------+------------+
| magic      | version    | payloadLength| payload    |
| 4 bytes    | 1 byte     | 4 bytes      | N bytes    |
+------------+------------+--------------+------------+
| crc32c     |
| 4 bytes    |
+------------+
```

Atau:

```text
[magic:int][version:byte][type:byte][flags:short][seq:long][payloadLength:int][payload][crc:int]
```

Field penting:

| Field | Fungsi |
|---|---|
| magic | membedakan file/record valid dari byte acak |
| version | evolusi format |
| type | event type/record type |
| flags | compression/encryption/tombstone/commit marker |
| sequence | ordering dan duplicate detection |
| payloadLength | mengetahui boundary record |
| payload | data utama |
| checksum | deteksi partial/corrupt write |

### 7.1 Kenapa checksum di akhir?

Jika checksum ditulis terakhir, maka incomplete write lebih mudah dideteksi.

```text
[length][payload][checksum]
                 ^ crash sebelum checksum lengkap
```

Reader membaca length, payload, lalu checksum. Jika checksum tidak ada atau mismatch, record dianggap tidak committed.

### 7.2 Apakah perlu checksum header?

Untuk format lebih kuat, iya.

Masalah jika header corrupt:

- length bisa menjadi angka sangat besar;
- reader mencoba alokasi memory besar;
- scan bisa kacau.

Mitigasi:

- magic number;
- max payload size;
- header checksum;
- sanity check length;
- segment-level metadata.

Minimal harus ada:

```text
payloadLength >= 0
payloadLength <= MAX_RECORD_SIZE
magic == expected
version supported
```

---

## 8. Contoh Format Record Binary Sederhana

Kita definisikan:

```text
int    magic          0x4A57414C  // "JWAL"
byte   version        1
byte   type           event type
short  flags
long   sequence
int    payloadLength
byte[] payload
int    crc32
```

Checksum dihitung atas:

```text
version + type + flags + sequence + payloadLength + payload
```

Bukan termasuk magic dan bukan termasuk field checksum itu sendiri.

Alasan magic tidak harus masuk checksum:

- magic dipakai untuk sync boundary;
- checksum tetap bisa memasukkan magic jika ingin lebih ketat.

Yang penting konsisten.

---

## 9. Helper: Write Fully

`FileChannel.write(buffer)` tidak wajib menulis semua byte dalam satu call.

Karena itu perlu loop:

```java
static void writeFully(FileChannel channel, ByteBuffer buffer) throws IOException {
    while (buffer.hasRemaining()) {
        int written = channel.write(buffer);
        if (written < 0) {
            throw new EOFException("Unexpected end of channel while writing");
        }
    }
}
```

Untuk `FileChannel`, `write` biasanya menulis sebagian atau semua. Kode production tidak boleh mengasumsikan satu call selalu cukup.

---

## 10. Helper: Read Fully or Incomplete

Saat recovery, incomplete tail bukan selalu error fatal. Itu bisa berarti crash saat menulis record terakhir.

```java
static boolean readFullyOrIncomplete(FileChannel channel, ByteBuffer buffer) throws IOException {
    while (buffer.hasRemaining()) {
        int n = channel.read(buffer);
        if (n < 0) {
            return false;
        }
    }
    return true;
}
```

Pola recovery:

```java
long recordStart = channel.position();
boolean headerOk = readFullyOrIncomplete(channel, header);
if (!headerOk) {
    truncate(recordStart);
    stop;
}
```

---

## 11. Implementasi Record Writer Sederhana

```java
import java.io.EOFException;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.CRC32C;

public final class SimpleWalWriter implements AutoCloseable {
    private static final int MAGIC = 0x4A57414C; // JWAL
    private static final byte VERSION = 1;
    private static final int HEADER_SIZE = 4 + 1 + 1 + 2 + 8 + 4;
    private static final int CHECKSUM_SIZE = 4;

    private final FileChannel channel;
    private long nextSequence;

    public SimpleWalWriter(Path path, long initialSequence) throws IOException {
        this.channel = FileChannel.open(
                path,
                StandardOpenOption.CREATE,
                StandardOpenOption.READ,
                StandardOpenOption.WRITE);
        this.channel.position(this.channel.size());
        this.nextSequence = initialSequence;
    }

    public synchronized long append(byte type, byte[] payload, boolean force) throws IOException {
        if (payload.length > 16 * 1024 * 1024) {
            throw new IllegalArgumentException("Record too large: " + payload.length);
        }

        long sequence = nextSequence++;
        long offset = channel.position();

        ByteBuffer record = ByteBuffer.allocate(HEADER_SIZE + payload.length + CHECKSUM_SIZE);

        record.putInt(MAGIC);
        record.put(VERSION);
        record.put(type);
        record.putShort((short) 0); // flags
        record.putLong(sequence);
        record.putInt(payload.length);
        record.put(payload);

        int crc = crc32c(record.array(), 4, HEADER_SIZE - 4 + payload.length);
        record.putInt(crc);

        record.flip();
        writeFully(channel, record);

        if (force) {
            channel.force(false);
        }

        return offset;
    }

    private static int crc32c(byte[] data, int offset, int length) {
        CRC32C crc = new CRC32C();
        crc.update(data, offset, length);
        return (int) crc.getValue();
    }

    private static void writeFully(FileChannel channel, ByteBuffer buffer) throws IOException {
        while (buffer.hasRemaining()) {
            int n = channel.write(buffer);
            if (n < 0) {
                throw new EOFException("Unexpected EOF while writing");
            }
        }
    }

    @Override
    public void close() throws IOException {
        channel.close();
    }
}
```

Catatan:

- `synchronized` dipakai agar satu writer instance tidak corrupt posisi channel;
- untuk throughput tinggi, gunakan single writer thread + queue, bukan banyak thread langsung menulis channel;
- `force` bisa per record atau batch;
- `CRC32C` ada sejak Java 9, untuk Java 8 gunakan `CRC32` atau implementasi CRC32C library eksternal;
- jika target Java 8 strict, ganti `CRC32C` dengan `CRC32`.

Versi Java 8-compatible:

```java
import java.util.zip.CRC32;

private static int crc32(byte[] data, int offset, int length) {
    CRC32 crc = new CRC32();
    crc.update(data, offset, length);
    return (int) crc.getValue();
}
```

---

## 12. Implementasi Recovery Reader

Recovery bertugas:

1. scan dari awal atau dari offset snapshot;
2. baca header;
3. validasi magic/version/length;
4. baca payload;
5. baca checksum;
6. jika valid, apply/replay record;
7. jika invalid/incomplete, truncate ke last good offset;
8. return next sequence.

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.CRC32;

public final class SimpleWalRecovery {
    private static final int MAGIC = 0x4A57414C;
    private static final byte VERSION = 1;
    private static final int HEADER_SIZE = 4 + 1 + 1 + 2 + 8 + 4;
    private static final int MAX_RECORD_SIZE = 16 * 1024 * 1024;

    public interface RecordHandler {
        void onRecord(long offset, byte type, long sequence, byte[] payload) throws IOException;
    }

    public static long recover(Path path, RecordHandler handler) throws IOException {
        try (FileChannel channel = FileChannel.open(
                path,
                StandardOpenOption.CREATE,
                StandardOpenOption.READ,
                StandardOpenOption.WRITE)) {

            long lastGoodOffset = 0;
            long nextSequence = 0;
            ByteBuffer header = ByteBuffer.allocate(HEADER_SIZE);

            while (true) {
                long recordStart = channel.position();
                header.clear();

                if (!readFullyOrIncomplete(channel, header)) {
                    channel.truncate(lastGoodOffset);
                    channel.position(lastGoodOffset);
                    return nextSequence;
                }

                header.flip();

                int magic = header.getInt();
                byte version = header.get();
                byte type = header.get();
                short flags = header.getShort();
                long sequence = header.getLong();
                int payloadLength = header.getInt();

                if (magic != MAGIC || version != VERSION || payloadLength < 0 || payloadLength > MAX_RECORD_SIZE) {
                    channel.truncate(lastGoodOffset);
                    channel.position(lastGoodOffset);
                    return nextSequence;
                }

                ByteBuffer payload = ByteBuffer.allocate(payloadLength);
                if (!readFullyOrIncomplete(channel, payload)) {
                    channel.truncate(lastGoodOffset);
                    channel.position(lastGoodOffset);
                    return nextSequence;
                }

                ByteBuffer checksumBuffer = ByteBuffer.allocate(4);
                if (!readFullyOrIncomplete(channel, checksumBuffer)) {
                    channel.truncate(lastGoodOffset);
                    channel.position(lastGoodOffset);
                    return nextSequence;
                }

                payload.flip();
                checksumBuffer.flip();
                int expectedCrc = checksumBuffer.getInt();

                byte[] payloadBytes = new byte[payload.remaining()];
                payload.get(payloadBytes);

                int actualCrc = computeRecordCrc(version, type, flags, sequence, payloadLength, payloadBytes);
                if (actualCrc != expectedCrc) {
                    channel.truncate(lastGoodOffset);
                    channel.position(lastGoodOffset);
                    return nextSequence;
                }

                handler.onRecord(recordStart, type, sequence, payloadBytes);

                lastGoodOffset = channel.position();
                nextSequence = Math.max(nextSequence, sequence + 1);
            }
        }
    }

    private static boolean readFullyOrIncomplete(FileChannel channel, ByteBuffer buffer) throws IOException {
        while (buffer.hasRemaining()) {
            int n = channel.read(buffer);
            if (n < 0) {
                return false;
            }
        }
        return true;
    }

    private static int computeRecordCrc(
            byte version,
            byte type,
            short flags,
            long sequence,
            int payloadLength,
            byte[] payload) {

        ByteBuffer b = ByteBuffer.allocate(1 + 1 + 2 + 8 + 4 + payload.length);
        b.put(version);
        b.put(type);
        b.putShort(flags);
        b.putLong(sequence);
        b.putInt(payloadLength);
        b.put(payload);

        CRC32 crc = new CRC32();
        crc.update(b.array(), 0, b.position());
        return (int) crc.getValue();
    }
}
```

Catatan:

- recovery tidak melempar error untuk incomplete tail normal;
- recovery melempar error jika handler gagal apply record;
- corruption di tengah file, bukan tail, perlu kebijakan lebih ketat;
- contoh ini sederhana dan belum mencakup segment, snapshot, atau transaction batch.

---

## 13. Kenapa Recovery Harus `truncate` Tail

Misal file:

```text
record 1 valid
record 2 valid
record 3 partial
```

Jika partial tail dibiarkan, restart berikutnya akan menemukan partial tail lagi.

Lebih buruk, jika append baru dilakukan setelah partial tail tanpa truncate, layout menjadi:

```text
record 1 valid
record 2 valid
record 3 partial
record 4 new
```

Reader tidak bisa mencapai record 4 karena berhenti di record 3 partial.

Maka recovery harus menjadikan file kembali ke state canonical:

```text
record 1 valid
record 2 valid
```

Dengan:

```java
channel.truncate(lastGoodOffset);
channel.position(lastGoodOffset);
```

---

## 14. Force Strategy: Per Record vs Batch

### 14.1 Force per record

```text
append record
force
ack caller
```

Kelebihan:

- durability kuat;
- setelah ack, record kemungkinan besar tidak hilang saat crash OS.

Kekurangan:

- sangat mahal;
- throughput rendah;
- latency tinggi.

Cocok untuk:

- audit critical;
- financial event;
- compliance evidence;
- irreversible external side effect.

### 14.2 Force batch

```text
append record 1
append record 2
append record 3
force
ack batch
```

Kelebihan:

- throughput jauh lebih baik;
- biaya fsync amortized.

Kekurangan:

- record yang belum masuk forced batch bisa hilang saat crash OS;
- caller harus memahami durability boundary.

Cocok untuk:

- queue lokal;
- telemetry;
- event yang bisa diretry;
- state yang bisa direkonstruksi.

### 14.3 Timed force

```text
force setiap 100 ms atau setiap 1 MB
```

Ini kompromi umum.

Contoh policy:

```text
force if:
  pendingBytes >= 1 MB
  OR pendingRecords >= 1000
  OR lastForceAge >= 100 ms
  OR caller requested durable append
```

---

## 15. Ack Semantics: Jangan Bohong ke Caller

Kalau API Anda bernama:

```java
append(event)
```

Pertanyaan penting:

```text
Setelah method return sukses, apa guarantee-nya?
```

Kemungkinan guarantee:

| Guarantee | Arti |
|---|---|
| accepted in memory | baru masuk queue memory |
| written to OS buffer | Java write selesai, belum forced |
| forced to storage | `FileChannel.force` selesai |
| replicated | sudah dikirim ke node lain |
| applied | sudah diproses ke state utama |

API yang buruk menyamarkan semua ini.

API yang baik eksplisit:

```java
AppendResult append(Event event, Durability durability);
```

Dengan:

```java
enum Durability {
    MEMORY_ACCEPTED,
    WRITTEN_TO_CHANNEL,
    FORCED_TO_STORAGE
}
```

Atau pisahkan method:

```java
appendAsync(event)
appendAndForce(event)
flush()
```

---

## 16. Transaction Batch dengan Commit Marker

Jika satu operation terdiri dari banyak record, jangan anggap semua record valid hanya karena masing-masing checksum valid.

Contoh:

```text
BEGIN tx=10
PUT A=1
PUT B=2
COMMIT tx=10
```

Jika crash:

```text
BEGIN tx=10
PUT A=1
PUT B=2
```

Recovery harus mengabaikan transaction 10.

### 16.1 Model sederhana

Record type:

```text
1 = BEGIN
2 = PUT
3 = DELETE
4 = COMMIT
5 = ABORT
```

Recovery:

```text
for each record:
  if BEGIN: create pending tx
  if PUT/DELETE: add to pending tx
  if COMMIT: apply pending tx to state
  if ABORT: discard pending tx
end:
  discard all uncommitted pending tx
```

### 16.2 Commit marker harus forced kapan?

Untuk guarantee “committed after return”:

```text
write BEGIN + mutations + COMMIT
force
return success
```

Atau:

```text
write BEGIN + mutations
force
write COMMIT
force
return success
```

Yang kedua lebih kuat untuk beberapa recovery design, tetapi lebih mahal.

Untuk banyak aplikasi, cukup:

```text
write full transaction batch including COMMIT
force once
```

Asal recovery menganggap COMMIT valid hanya jika record COMMIT sendiri valid.

---

## 17. Redo vs Undo

### 17.1 Redo log

Log berisi perubahan yang bisa diterapkan ulang.

```text
SET status(order-123)=PAID
```

Recovery:

```text
replay committed records
```

Syarat:

- operation idempotent;
- sequence/order jelas;
- duplicate application aman.

### 17.2 Undo log

Log berisi informasi untuk membatalkan perubahan.

```text
BEFORE status(order-123)=PENDING
```

Jika crash saat update belum committed, undo mengembalikan state lama.

Dalam aplikasi file workflow, redo sering lebih mudah daripada undo.

Contoh file intake:

- jangan update file utama in-place;
- catat event;
- recovery membaca event dan membangun state;
- side effect yang belum committed diulang atau dibersihkan.

---

## 18. WAL untuk File Workflow

Misal pipeline:

```text
incoming/    file upload masuk
staging/     file sedang divalidasi
ready/       file siap diproses
processing/  file sedang diproses
done/        sukses
error/       gagal
quarantine/  mencurigakan/corrupt
```

Journal event:

```text
RECEIVED fileId originalName stagingPath size
HASHED fileId sha256
VALIDATED fileId
PUBLISHED fileId readyPath
CLAIMED fileId workerId
DONE fileId
FAILED fileId reason
QUARANTINED fileId reason
```

Recovery:

```text
1. replay journal ke in-memory state
2. scan directories sebagai reconciliation
3. bandingkan journal state vs filesystem actual state
4. resolve mismatch dengan deterministic rules
```

Contoh mismatch:

| Journal | Filesystem | Recovery action |
|---|---|---|
| RECEIVED | staging file ada | lanjut hash/validate |
| RECEIVED | staging file tidak ada | mark lost/corrupt |
| PUBLISHED | ready file ada | enqueue processing |
| CLAIMED | processing file ada, worker mati | release/retry |
| DONE | done file ada | no-op |
| DONE | done file hilang | alert; done artifact missing |

Ini penting: journal saja tidak cukup jika side effect filesystem bisa terjadi sebagian. Filesystem scan tetap diperlukan sebagai reconciliation.

---

## 19. Multi-File Transaction: Jangan Mengaku Atomic Jika Tidak Atomic

Filesystem biasa tidak menyediakan transaction multi-file portable.

Misal ingin publish:

```text
payload.dat
metadata.json
checksum.sha256
```

Jika menulis tiga file, crash bisa terjadi setelah satu atau dua file.

Pattern yang lebih aman:

```text
staging/fileId/payload.dat
staging/fileId/metadata.json
staging/fileId/checksum.sha256
staging/fileId/COMMIT
```

Atau:

```text
ready/fileId.manifest
```

Manifest adalah source of truth. Payload hanya dianggap valid jika manifest committed.

Pattern:

```text
1. tulis payload temp
2. tulis metadata temp
3. tulis checksum temp
4. force files jika perlu
5. tulis manifest/commit marker terakhir
6. atomic move manifest ke ready
```

Recovery:

```text
Jika manifest tidak ada, directory staging boleh dibersihkan/retry.
Jika manifest ada dan valid, payload harus lengkap.
```

---

## 20. Segment Design

Single WAL file sederhana, tetapi tidak sustainable.

Segment layout:

```text
wal/
  00000000000000000001.seg
  00000000000000010001.seg
  00000000000000020001.seg
  active.seg
```

Atau:

```text
wal/
  log-000001.wal
  log-000002.wal
  log-000003.wal
```

Segment metadata:

```text
baseSequence
maxSequence
createdAt
sealed/unsealed
checksum optional
```

### 20.1 Active vs sealed segment

```text
active segment: boleh append
sealed segment: immutable
```

Saat rotate:

```text
1. force active segment
2. write segment footer or seal marker
3. force
4. rename active to sealed name
5. create new active
```

### 20.2 Kenapa sealed segment penting?

Sealed segment bisa:

- di-backup;
- dikompaksi;
- di-upload;
- dipindah;
- diverifikasi;
- dianggap immutable.

Active segment adalah satu-satunya file yang boleh punya incomplete tail.

---

## 21. Segment Recovery

Recovery segment:

```text
1. urutkan segment berdasarkan base sequence atau filename
2. untuk sealed segment:
   - scan harus selesai sampai end atau seal marker
   - jika corrupt, ini serious incident
3. untuk active segment:
   - scan sampai last good record
   - truncate partial tail
4. pastikan sequence monotonic
5. detect gap atau duplicate
```

Contoh rules:

```text
sealed segment corrupt => fail startup / manual intervention
active tail corrupt => truncate tail and continue
missing segment => fail startup unless snapshot covers it
sequence gap => fail startup or rebuild from snapshot
```

Jangan diam-diam mengabaikan corruption di sealed segment. Itu bisa menyembunyikan data loss.

---

## 22. Snapshot + Replay

Tanpa snapshot:

```text
replay dari record pertama setiap startup
```

Semakin lama semakin lambat.

Dengan snapshot:

```text
snapshot sequence=500000
wal segment mulai sequence=500001
```

Recovery:

```text
1. load snapshot valid terbaru
2. replay WAL setelah snapshot sequence
3. jika snapshot corrupt, coba snapshot sebelumnya
```

### 22.1 Snapshot harus atomic

Gunakan pattern Part 07:

```text
write snapshot.tmp
force snapshot.tmp
atomic move snapshot.tmp -> snapshot-000500000.bin
write/update CURRENT pointer atomically
```

Atau gunakan immutable named snapshots:

```text
snapshot-000500000.bin
snapshot-000600000.bin
```

Lalu file pointer kecil:

```text
CURRENT -> snapshot-000600000.bin
```

Jika `CURRENT` corrupt, scan snapshot files dan pilih valid tertinggi.

### 22.2 Snapshot juga perlu checksum

Snapshot tanpa checksum bisa membuat recovery membangun state dari file corrupt.

Minimal snapshot:

```text
magic
version
sequence
payloadLength
payload
checksum
```

---

## 23. Compaction

Append-only log tumbuh terus.

Compaction membuat representasi ringkas.

Contoh key-value log:

```text
PUT A=1
PUT B=1
PUT A=2
DELETE B
PUT C=1
```

State akhir:

```text
A=2
C=1
```

Compacted segment:

```text
PUT A=2
PUT C=1
COMPACTION_MARKER upToSequence=5
```

### 23.1 Compaction tidak boleh menghancurkan recovery

Pattern aman:

```text
1. build compacted segment baru di temp
2. force compacted segment
3. write manifest yang menyatakan compacted segment mencakup sequence <= N
4. atomic move manifest
5. baru delete old segment yang sudah covered
```

Invarian:

```text
Tidak pernah ada momen di mana old segment sudah dihapus tetapi compacted segment belum committed.
```

---

## 24. Idempotency: Syarat Mutlak Replay

WAL recovery biasanya replay record.

Replay berarti record bisa diterapkan lebih dari sekali dalam beberapa failure scenario.

Maka handler harus idempotent.

Buruk:

```java
balance += event.amount();
```

Jika event direplay dua kali, saldo salah.

Lebih baik:

```java
if (!appliedEventIds.contains(event.id())) {
    balance += event.amount();
    appliedEventIds.add(event.id());
}
```

Atau desain state assignment:

```java
status.put(orderId, PAID);
```

Assignment sering lebih idempotent daripada increment.

Untuk file workflow:

```text
move ready/A -> processing/A
```

Jika replay:

- jika file sudah di processing, anggap move sudah terjadi;
- jika file masih di ready, lakukan move;
- jika file ada di done, operation sudah selesai;
- jika tidak ada di mana pun, mark inconsistency.

---

## 25. Ordering dan Sequence Number

Setiap record perlu sequence number monotonik.

Manfaat:

- detect duplicate;
- detect gap;
- resume dari offset tertentu;
- build snapshot;
- debug timeline;
- replication;
- compaction boundary.

Invarian:

```text
sequence record berikutnya harus lebih besar dari record sebelumnya.
```

Recovery harus memvalidasi:

```java
if (sequence < expectedMin) duplicate/stale
if (sequence > expectedNext) gap/corruption
```

Tetapi ada dua model:

### Strict contiguous

```text
1,2,3,4,5
```

Gap berarti corruption/missing record.

### Monotonic non-contiguous

```text
100,110,120
```

Gap boleh, tetapi ordering tetap jelas.

Untuk WAL lokal, strict contiguous biasanya lebih mudah.

---

## 26. Offset Index

Untuk log besar, replay dari awal segment bisa mahal.

Bisa buat index:

```text
sequence -> file offset
```

Index bisa disimpan sebagai file terpisah:

```text
log-000001.seg
log-000001.idx
```

Tetapi index adalah derived data. Jangan jadikan index satu-satunya source of truth.

Recovery index:

```text
if index missing/corrupt:
  rebuild by scanning segment
```

Index record sederhana:

```text
sequence:long offset:long
```

Setiap N record:

```text
sparse index
sequence 1000 -> offset 123456
sequence 2000 -> offset 256789
```

---

## 27. Handling Disk Full

Disk full di WAL sangat berbahaya.

Kemungkinan:

- header tertulis sebagian;
- payload tertulis sebagian;
- checksum tidak tertulis;
- `force` gagal;
- segment rotation gagal;
- compaction gagal karena butuh extra space.

Rules:

```text
Jika append gagal, jangan ack caller.
Jika force gagal, jangan klaim durable.
Jika recovery menemukan partial tail, truncate.
Jika disk terlalu penuh untuk truncate/continue, fail fast dan alert.
```

Guardrail:

- preflight usable space;
- reserve file;
- retention policy;
- backpressure;
- alert threshold;
- reject new writes before disk full;
- separate volume untuk WAL jika critical.

Reserve file pattern:

```text
reserve.dat 1GB
```

Saat emergency disk full:

```text
hapus reserve.dat agar ada ruang untuk shutdown/compact/recover metadata
```

Ini bukan pengganti monitoring, tetapi dapat membantu graceful degradation.

---

## 28. Concurrency Model

### 28.1 Single writer adalah default terbaik

Append-only log paling aman dengan single writer.

```text
many producer threads -> queue -> one WAL writer thread -> file
```

Kelebihan:

- record tidak interleave;
- sequence mudah;
- force batching mudah;
- offset akurat;
- backpressure jelas.

### 28.2 Multiple writer langsung ke file

Bisa, tetapi sulit:

- perlu lock;
- append atomicity tidak portable sepenuhnya;
- offset assignment sulit;
- batching force sulit;
- ordering antar thread bisa ambigu.

Untuk top-tier design, jangan pamer concurrency jika tidak perlu. Pilih single writer, ukur bottleneck, baru optimasi.

### 28.3 Single writer tidak berarti single producer

Arsitektur:

```text
Producer 1 ┐
Producer 2 ├─> bounded queue ─> WAL writer ─> FileChannel
Producer 3 ┘
```

Bounded queue penting untuk backpressure.

---

## 29. WAL Writer Thread Sketch

```java
final class WalWriterThread implements AutoCloseable {
    private final BlockingQueue<AppendRequest> queue = new ArrayBlockingQueue<>(10_000);
    private final SimpleWalWriter writer;
    private volatile boolean running = true;

    WalWriterThread(SimpleWalWriter writer) {
        this.writer = writer;
    }

    CompletableFuture<Long> append(byte type, byte[] payload) throws InterruptedException {
        CompletableFuture<Long> result = new CompletableFuture<>();
        queue.put(new AppendRequest(type, payload, result));
        return result;
    }

    void runLoop() {
        while (running || !queue.isEmpty()) {
            try {
                AppendRequest first = queue.poll(100, TimeUnit.MILLISECONDS);
                if (first == null) {
                    continue;
                }

                List<AppendRequest> batch = new ArrayList<>();
                batch.add(first);
                queue.drainTo(batch, 999);

                for (AppendRequest req : batch) {
                    long offset = writer.append(req.type, req.payload, false);
                    req.result.complete(offset);
                }

                writer.force(); // expose force method in writer
            } catch (Throwable t) {
                // fail pending requests, transition service to unhealthy
            }
        }
    }

    @Override
    public void close() throws Exception {
        running = false;
        writer.close();
    }

    private static final class AppendRequest {
        final byte type;
        final byte[] payload;
        final CompletableFuture<Long> result;

        AppendRequest(byte type, byte[] payload, CompletableFuture<Long> result) {
            this.type = type;
            this.payload = payload;
            this.result = result;
        }
    }
}
```

Catatan:

- contoh ini sketch, bukan final implementation;
- completion sebaiknya dilakukan setelah force jika caller butuh durable ack;
- jika completion dilakukan sebelum force, API harus menyebut guarantee-nya hanya written/accepted;
- perlu shutdown protocol yang jelas.

---

## 30. Shutdown Protocol

Shutdown WAL writer:

```text
1. stop accepting new append
2. drain queue
3. write all pending records
4. force
5. close channel
6. mark service stopped
```

Jika shutdown dipaksa:

```text
recovery harus handle tail partial atau unforced records.
```

Jangan mengandalkan shutdown hook sebagai satu-satunya durability mechanism.

Shutdown hook tidak dijamin berjalan untuk semua kondisi:

- SIGKILL;
- container hard kill;
- kernel panic;
- power loss;
- process crash fatal tertentu.

---

## 31. Corruption Policy

Tidak semua corruption sama.

| Lokasi corruption | Interpretasi umum | Action |
|---|---|---|
| active tail | crash saat append | truncate tail |
| active middle | serious corruption | fail startup/manual repair |
| sealed segment tail | seal process gagal atau corruption | fail unless policy allows repair |
| sealed segment middle | data loss/corruption | fail startup |
| snapshot latest | coba snapshot sebelumnya | alert |
| all snapshots corrupt | rebuild from WAL or fail | manual recovery |

Top-tier system punya explicit corruption policy, bukan `catch(Exception) {}`.

---

## 32. Manifest sebagai Commit Boundary

Untuk segment/snapshot/compaction, manifest sering lebih aman daripada mengandalkan directory listing saja.

Contoh manifest:

```json
{
  "version": 1,
  "segments": [
    {"name": "log-000001.wal", "baseSequence": 1, "lastSequence": 10000, "sealed": true},
    {"name": "log-000002.wal", "baseSequence": 10001, "lastSequence": 18200, "sealed": false}
  ],
  "latestSnapshot": "snapshot-00010000.bin"
}
```

Update manifest harus atomic:

```text
write manifest.tmp
force manifest.tmp
atomic move manifest.tmp -> MANIFEST
```

Jika manifest corrupt:

- scan directory;
- validate segment headers;
- reconstruct candidate manifest;
- require operator approval if high-stakes.

---

## 33. Directory fsync Problem

Saat membuat file baru lalu rename, data file bisa durable tetapi directory entry belum tentu durable pada semua platform/filesystem jika directory metadata belum flushed.

Java standar tidak menyediakan API portable yang sempurna untuk fsync directory di semua OS/provider.

Implikasi:

- `FileChannel.force` pada file memaksa content/metadata file;
- atomic move membuat rename atomic secara namespace;
- tetapi crash consistency directory entry bisa bergantung OS/filesystem;
- untuk local Linux, beberapa sistem membuka directory dan fsync via native API;
- untuk pure Java portable, dokumentasikan batas guarantee.

Engineering conclusion:

```text
Java dapat meminta durability, tetapi tidak dapat menghapus semua variasi OS/filesystem/provider.
```

Untuk requirement sangat tinggi:

- gunakan database yang mature;
- gunakan embedded storage engine yang sudah menangani detail ini;
- gunakan native integration khusus platform;
- lakukan destructive crash testing.

---

## 34. FileChannel.force Bukan Sihir

`force` meminta update dipaksa ke storage device. Namun:

- storage device/controller mungkin punya cache;
- filesystem bisa punya mode berbeda;
- network filesystem bisa punya semantic berbeda;
- virtualized/containerized environment menambah layer;
- bug hardware/firmware tetap mungkin;
- Java tidak bisa menjamin melebihi kontrak OS/provider.

Maka gunakan wording yang benar:

```text
Kami memanggil force sebelum ack durable.
```

Bukan:

```text
Data pasti tidak mungkin hilang.
```

---

## 35. Exactly-Once Illusion

File WAL sering dipakai agar “tidak ada event hilang”. Tetapi side effect eksternal membuat exactly-once sulit.

Contoh:

```text
1. read record from WAL
2. call external API
3. mark DONE in WAL
```

Crash setelah external API sukses tetapi sebelum `DONE`:

```text
Recovery akan call external API lagi.
```

Solusi:

- external API idempotency key;
- outbox pattern;
- status journal;
- deduplication di receiver;
- at-least-once semantics eksplisit;
- exactly-once hanya jika semua komponen mendukung idempotent transaction boundary yang sama.

Dalam file workflow, target realistis sering:

```text
at-least-once processing + idempotent handler + deduplication
```

Bukan exactly-once murni.

---

## 36. WAL vs Database vs Queue

Jangan membangun WAL custom jika problem sebenarnya butuh database/queue.

Gunakan custom WAL jika:

- state lokal sederhana;
- embedded/offline requirement;
- throughput write sequential tinggi;
- dependency eksternal tidak boleh ada;
- recovery model bisa Anda uji penuh;
- single-node semantics cukup.

Gunakan database jika:

- perlu query kompleks;
- multi-writer transactional semantics;
- indexing;
- concurrent readers/writers;
- backup/restore mature;
- durability kuat;
- operational tooling.

Gunakan queue/message broker jika:

- perlu distributed consumption;
- retry/dead-letter;
- consumer group;
- backpressure lintas service;
- persistence sudah disediakan broker.

Gunakan object storage jika:

- payload besar;
- immutability;
- retention;
- cross-service sharing;
- lifecycle policy.

Top 1% engineer bukan yang selalu membuat storage engine sendiri, tetapi yang tahu kapan **tidak** membuatnya.

---

## 37. Crash Failure Matrix

Untuk append satu record:

| Crash point | File state | Recovery |
|---|---|---|
| sebelum write | tidak ada record baru | no-op |
| setelah sebagian header | partial header | truncate to last good |
| setelah header lengkap | missing payload/checksum | truncate |
| setelah payload sebagian | incomplete payload | truncate |
| setelah payload lengkap sebelum checksum | missing checksum | truncate |
| setelah checksum sebagian | checksum incomplete | truncate |
| setelah checksum lengkap sebelum force | record valid tetapi mungkin belum durable setelah OS crash | tergantung apakah bytes survive |
| setelah force sukses | record durable sesuai kontrak platform | replay |
| setelah ack caller | harus sesuai ack semantics | replay atau guarantee dilanggar |

Untuk transaction batch:

| Crash point | Recovery |
|---|---|
| sebelum BEGIN | no-op |
| setelah BEGIN | discard pending tx |
| setelah mutation records | discard pending tx jika no COMMIT |
| setelah COMMIT partial | discard pending tx |
| setelah COMMIT valid sebelum force | depends durability policy |
| setelah force COMMIT | apply tx |

---

## 38. Production Checklist untuk Append-Only/WAL

### Format

- [ ] magic number
- [ ] version
- [ ] record type
- [ ] sequence number
- [ ] payload length
- [ ] max payload size
- [ ] checksum
- [ ] optional flags
- [ ] optional header checksum

### Writing

- [ ] single writer or explicit lock/coordination
- [ ] write fully loop
- [ ] bounded queue/backpressure
- [ ] force policy jelas
- [ ] ack semantics jelas
- [ ] failure tidak di-ack
- [ ] disk full handled

### Recovery

- [ ] scan valid prefix
- [ ] detect incomplete tail
- [ ] truncate tail
- [ ] validate checksum
- [ ] validate sequence
- [ ] handle transaction commit marker
- [ ] idempotent replay
- [ ] corruption policy eksplisit

### Segment

- [ ] active vs sealed segment
- [ ] rotate safely
- [ ] manifest atomically updated
- [ ] sealed segment immutable
- [ ] retention safe
- [ ] compaction safe

### Snapshot

- [ ] snapshot atomic write
- [ ] snapshot checksum
- [ ] fallback to previous snapshot
- [ ] replay from snapshot sequence

### Operation

- [ ] metrics append latency
- [ ] metrics force latency
- [ ] metrics pending queue depth
- [ ] metrics bytes written
- [ ] metrics recovery duration
- [ ] alert disk space
- [ ] alert corruption
- [ ] runbook for manual recovery

---

## 39. Common Anti-Patterns

### Anti-pattern 1 — Append text line as source of truth

```java
Files.writeString(path, event + "\n", APPEND, CREATE);
```

Problem:

- no framing;
- no checksum;
- partial line ambiguous;
- encoding/newline issue.

### Anti-pattern 2 — No recovery scan

```text
Startup langsung append ke existing file.
```

Jika file punya partial tail, log bisa tidak bisa dibaca.

### Anti-pattern 3 — Ack before durability but claim durable

```text
write to memory queue
return success
```

Jika caller mengira durable, ini correctness bug.

### Anti-pattern 4 — Multi-thread append without ordering model

```text
10 threads write to same channel directly
```

Sequence, offset, batching, and recovery become unclear.

### Anti-pattern 5 — Delete old logs before compacted log committed

```text
delete old
write compacted
```

Crash setelah delete menyebabkan data loss.

### Anti-pattern 6 — Treat checksum mismatch as “skip record and continue”

Jika checksum mismatch di tengah file, melanjutkan scan bisa membuat sistem menerima state setelah corruption tanpa memahami kehilangan record.

Lebih aman:

```text
active tail mismatch -> truncate
middle/sealed mismatch -> fail
```

---

## 40. Java 8 hingga 25 Compatibility Notes

| Feature | Java 8 | Java 9+ / 25 |
|---|---:|---:|
| `FileChannel` | yes | yes |
| `SeekableByteChannel` | yes | yes |
| `StandardOpenOption.SYNC/DSYNC` | yes | yes |
| `FileChannel.force` | yes | yes |
| `CRC32` | yes | yes |
| `CRC32C` | no | yes, since Java 9 |
| `Path.of` | no | yes |
| `Files.writeString/readString` | no | yes, since Java 11 |

Untuk seri ini:

- gunakan `Paths.get(...)` jika kode harus Java 8;
- gunakan `Path.of(...)` jika Java 11+;
- gunakan `CRC32` untuk Java 8 baseline;
- gunakan `CRC32C` jika Java 9+ dan butuh checksum lebih modern/cepat;
- jangan bergantung pada Java 25 feature khusus untuk WAL dasar.

---

## 41. Mini Case Study: Local Durable Job Journal

Requirement:

```text
Aplikasi menerima job lokal.
Setiap job harus tidak hilang setelah diterima.
Worker boleh crash.
Job boleh diproses ulang, tetapi handler harus idempotent.
```

Design:

```text
journal.wal:
  JOB_ACCEPTED jobId payload
  JOB_CLAIMED jobId workerId attempt
  JOB_DONE jobId
  JOB_FAILED jobId reason retryable
```

Append policy:

```text
JOB_ACCEPTED -> force before returning success to caller
CLAIMED/DONE/FAILED -> batch force every 100ms or force depending SLA
```

Recovery:

```text
1. recover journal valid prefix
2. build map jobId -> latest state
3. accepted but not done -> enqueue
4. claimed but worker dead -> enqueue retry
5. done -> ignore
6. failed retryable -> enqueue retry
7. failed permanent -> keep in error
```

Idempotency:

```text
jobId is idempotency key
handler records external side effect with jobId
```

Failure semantics:

```text
At-least-once processing.
No accepted job is intentionally lost after durable ack.
```

---

## 42. Mini Case Study: File Intake Manifest Journal

Requirement:

```text
Files uploaded into staging must be published atomically into ready.
If app crashes, no partial file should be processed.
```

Design:

```text
staging/{fileId}/payload.tmp
staging/{fileId}/metadata.tmp
ready/{fileId}.manifest
journal.wal
```

Flow:

```text
1. receive upload into staging payload.tmp
2. compute hash
3. write metadata.tmp
4. force payload and metadata if required
5. append JOURNAL: STAGED fileId hash size
6. force journal
7. write manifest.tmp referencing payload metadata hash
8. atomic move manifest.tmp -> ready/{fileId}.manifest
9. append JOURNAL: PUBLISHED fileId
10. process only files with ready manifest
```

Recovery:

```text
- manifest exists and valid: process/retry
- staging exists without manifest: validate or cleanup based journal
- journal PUBLISHED but manifest missing: alert/reconcile
- manifest exists but payload hash mismatch: quarantine
```

Key idea:

```text
The manifest is the publish commit marker.
The journal is the timeline/recovery evidence.
```

---

## 43. Testing Strategy

### 43.1 Unit tests

- encode/decode record;
- checksum mismatch;
- unsupported version;
- invalid magic;
- max payload validation;
- sequence validation.

### 43.2 Partial write tests

Generate valid WAL then truncate at every byte offset:

```text
for cut = 0..fileSize:
  copy wal to temp
  truncate temp to cut
  recover temp
  assert no crash
  assert recovered records are valid prefix
```

This is one of the most powerful tests for append-only recovery.

### 43.3 Corruption tests

Flip one byte:

```text
for each byte position:
  mutate byte
  recover
  assert checksum/magic/length detects corruption
```

Expected behavior differs:

- active tail corruption can truncate;
- middle corruption should fail.

### 43.4 Crash simulation

Inject crash points:

```text
after header
after payload
before checksum
after checksum
before force
after force
```

In pure unit test, simulate by writing partial bytes.

### 43.5 Disk full simulation

Harder, but can be approximated:

- custom channel wrapper throws after N bytes;
- small test filesystem/container quota;
- temp volume with limited size.

### 43.6 Recovery idempotency test

Run recovery twice:

```text
recover once
recover again
assert state same
```

Replay must not duplicate effects.

---

## 44. Observability

Metrics:

```text
wal_append_total
wal_append_failed_total
wal_bytes_written_total
wal_force_total
wal_force_latency_seconds
wal_append_latency_seconds
wal_queue_depth
wal_pending_bytes
wal_recovery_duration_seconds
wal_recovered_records_total
wal_truncated_tail_bytes_total
wal_corruption_detected_total
wal_segment_rotation_total
wal_compaction_duration_seconds
```

Logs:

```text
WAL opened path={} size={} lastSequence={}
WAL recovery started path={}
WAL recovery truncated partial tail offset={} bytes={}
WAL corruption detected segment={} offset={} reason={}
WAL force slow durationMs={} pendingBytes={}
WAL disk low usableBytes={} threshold={}
```

Do not log sensitive payload.

Log record metadata:

- sequence;
- type;
- offset;
- payload size;
- checksum;
- file id/job id if safe.

---

## 45. Runbook untuk Production Incident

### Symptom: startup fails due to WAL corruption

Steps:

```text
1. stop service; jangan start berulang-ulang jika bisa memperburuk state
2. backup seluruh WAL directory read-only
3. identify active vs sealed segment
4. run offline verifier
5. jika corruption hanya active tail, truncate to last good offset
6. jika sealed segment corrupt, escalate/manual restore from backup/snapshot
7. compare snapshot sequence and segment range
8. restart in read-only/recovery mode jika tersedia
9. setelah recovery, force new snapshot
```

### Symptom: disk full

```text
1. stop accepting new writes
2. check WAL size, snapshot size, old segments
3. do not delete uncommitted/uncompacted segments blindly
4. if reserve file exists, release reserve
5. compact if safe
6. increase volume or move retention
7. restart only after free space threshold healthy
```

### Symptom: recovery too slow

```text
1. check latest snapshot age
2. check number/size of segments after snapshot
3. verify compaction/retention job
4. produce new snapshot
5. tune snapshot interval
```

---

## 46. Top 1% Mental Model

File append-only/WAL engineering bukan tentang “menulis log”. Ini tentang **membuat state transition bisa dibuktikan benar meskipun proses mati di tengah operasi**.

Pertanyaan yang harus selalu muncul:

```text
Apa commit boundary-nya?
Apa durable boundary-nya?
Apa valid prefix-nya?
Apa yang terjadi jika crash setelah setiap step?
Bagaimana recovery membedakan complete, partial, corrupt, duplicate, stale?
Apa yang boleh diulang?
Apa yang tidak boleh diulang?
Apa yang harus idempotent?
Apa yang harus operator lihat jika recovery tidak aman otomatis?
```

Kalau pertanyaan ini belum terjawab, sistem belum production-grade.

---

## 47. Ringkasan

Di bagian ini, kita membahas:

- append-only file sebagai valid-prefix data structure;
- WAL sebagai mekanisme recovery sebelum state utama diubah;
- record framing dengan magic, version, type, sequence, length, payload, checksum;
- kenapa text line append bukan WAL yang kuat;
- `FileChannel`, `force`, `truncate`, `SYNC`, `DSYNC`;
- force per record vs batch;
- ack semantics;
- commit marker;
- redo vs undo;
- journal untuk file workflow;
- multi-file transaction approximation dengan manifest;
- segment, snapshot, compaction;
- idempotent replay;
- corruption policy;
- crash failure matrix;
- testing dan observability.

Core invariant:

```text
A WAL yang baik selalu bisa dipulihkan ke prefix valid terakhir,
lalu replay record committed secara idempotent untuk membangun state yang benar.
```

---

## 48. Latihan

1. Buat WAL sederhana dengan format:

```text
magic:int
version:byte
type:byte
sequence:long
payloadLength:int
payload:bytes
crc:int
```

2. Tulis test yang melakukan truncate di setiap byte offset dan memastikan recovery tidak crash.

3. Tambahkan commit marker untuk batch transaction.

4. Buat snapshot file yang ditulis dengan atomic update pattern.

5. Buat segment rotation saat file mencapai 64 MB.

6. Buat offline verifier CLI:

```bash
java WalVerifier journal.wal
```

Output:

```text
valid records: 12345
last good offset: 987654
first invalid offset: none
last sequence: 12345
```

7. Simulasikan corruption dengan flip byte di tengah segment dan pastikan sealed segment corruption tidak diabaikan diam-diam.

---

## 49. Referensi

- Java SE 25 / Java SE 8 documentation: `java.nio.channels.FileChannel`.
- Java SE 25 / Java SE 8 documentation: `java.nio.file.StandardOpenOption`.
- Java SE 25 documentation: `java.nio.channels.SeekableByteChannel`.
- Java documentation: `FileChannel.force`, `FileChannel.truncate`, `StandardOpenOption.SYNC`, `StandardOpenOption.DSYNC`, `StandardOpenOption.APPEND`.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering](./learn-java-io-file-filesystem-storage-engineering-part-20-random-access-structured-binary-file-layout.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering](./learn-java-io-file-filesystem-storage-engineering-part-22-checksums-hashes-integrity-deduplication.md)
