# Part 18 — File Locking: Advisory, Mandatory, Local, Network, and Cross-Process Coordination

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami file locking bukan sebagai magic mutex, tetapi sebagai kontrak koordinasi lintas proses yang bergantung pada JVM, OS, filesystem, provider, dan disiplin semua program yang mengakses file.

---

## 1. Posisi Part Ini Dalam Seri

Sampai Part 17, kita sudah membangun fondasi:

1. path bukan sekadar string,
2. existence check bukan lock,
3. create bisa atomic jika API-nya benar,
4. open option menentukan lifecycle handle,
5. read/write punya konsekuensi memory, flush, durability,
6. atomic update sebaiknya memakai temp file plus atomic move,
7. copy/move/delete/traversal punya race condition,
8. symlink dan path traversal bisa menjadi security boundary breach,
9. metadata, permission, capacity, dan watcher tidak boleh diperlakukan terlalu naif.

Sekarang kita masuk ke pertanyaan klasik:

> “Bagaimana cara memastikan hanya satu proses yang menulis file ini?”

Jawaban senior bukan langsung “pakai `FileChannel.lock()`”. Jawaban yang benar:

> Tergantung siapa saja aktornya, apakah semua aktor kooperatif, apakah filesystem lokal atau network, apakah lock dipakai untuk mutual exclusion, ownership claim, recovery, atau durability boundary, dan apakah failure mode-nya bisa diterima.

File locking adalah salah satu topik yang terlihat kecil, tetapi banyak bug production muncul dari asumsi berikut:

```text
Saya sudah lock file → berarti tidak ada proses lain yang bisa baca/tulis.
Saya pakai lock file → berarti aman di Kubernetes multi-pod.
Saya pakai tryLock → berarti tidak mungkin race.
Saya pakai exclusive lock → berarti thread lain di JVM juga otomatis terkoordinasi.
Saya lock file → berarti data durable.
Saya lock file → berarti cocok untuk distributed coordination.
```

Sebagian besar asumsi itu salah atau setidaknya tidak portable.

---

## 2. Mental Model Utama

File lock di Java adalah **token koordinasi pada region byte file**, bukan properti permanen dari file.

Secara konseptual:

```text
Java code
  ↓
FileChannel.lock()/tryLock()
  ↓
JVM tracks lock ownership for process/JVM
  ↓
native OS file locking facility
  ↓
filesystem semantics
  ↓
other processes may or may not cooperate
```

Jadi file locking harus dipahami sebagai kombinasi dari lima lapisan:

| Lapisan | Pertanyaan |
|---|---|
| Java API | Method apa yang dipanggil? Blocking atau non-blocking? Shared atau exclusive? Region mana? |
| JVM | Apakah JVM ini sudah memegang lock overlapping? Apakah channel ditutup? |
| OS | Lock advisory atau mandatory? Apakah shared lock didukung? |
| Filesystem | Lokal, network, container volume, mounted volume, object-store-like provider? |
| Protocol aplikasi | Apakah semua writer/reader benar-benar mematuhi locking protocol yang sama? |

Top 1% engineer tidak melihat lock sebagai “fitur API”, tetapi sebagai **coordination protocol**.

---

## 3. API Utama Java Untuk File Lock

Java file locking berada di package:

```java
java.nio.channels.FileChannel
java.nio.channels.FileLock
java.nio.channels.OverlappingFileLockException
java.nio.channels.FileLockInterruptionException
```

Method utama:

```java
FileLock lock()
FileLock lock(long position, long size, boolean shared)

FileLock tryLock()
FileLock tryLock(long position, long size, boolean shared)
```

Makna kasar:

| Method | Behavior |
|---|---|
| `lock()` | Blocking, exclusive lock seluruh file secara konseptual |
| `lock(position, size, shared)` | Blocking, lock region tertentu |
| `tryLock()` | Non-blocking attempt exclusive lock |
| `tryLock(position, size, shared)` | Non-blocking attempt region lock |

Contoh paling sederhana:

```java
Path path = Path.of("data/report.lock"); // Java 11+

try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {

    try (FileLock lock = channel.lock()) {
        // critical section lintas proses kooperatif
        // lakukan operasi yang harus dilindungi
    }
}
```

Untuk Java 8:

```java
Path path = Paths.get("data/report.lock");

try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {

    try (FileLock lock = channel.lock()) {
        // critical section
    }
}
```

Catatan:

- `Path.of(...)` belum tersedia di Java 8.
- `FileLock` implement `AutoCloseable`, sehingga bisa dipakai dalam `try-with-resources`.
- Lock valid sampai dilepas, channel ditutup, atau JVM terminasi.

---

## 4. `FileLock` Bukan Lock Object Biasa

`FileLock` bukan seperti:

```java
synchronized (lock) { ... }
```

atau:

```java
ReentrantLock lock = new ReentrantLock();
```

Perbedaannya besar:

| Aspek | `synchronized` / `ReentrantLock` | `FileLock` |
|---|---|---|
| Scope | Thread dalam JVM | Proses/JVM dan native OS lock |
| Target | Object memory | Region file |
| Cocok untuk | In-process coordination | Cross-process coordination kooperatif |
| Visibility | JVM saja | Diharapkan terlihat ke program lain lewat OS |
| Reliability | Deterministic dalam JVM | System-dependent |
| Distributed-safe | Tidak | Umumnya tidak, terutama network FS perlu hati-hati |

Dokumentasi Java menegaskan bahwa file lock dipegang atas nama seluruh JVM, sehingga tidak cocok untuk mengontrol akses oleh banyak thread dalam JVM yang sama.

Artinya, kalau problem Anda adalah:

> “Saya punya 10 thread dalam aplikasi yang sama menulis ke file yang sama.”

Maka solusi utama seharusnya:

```java
private final ReentrantLock lock = new ReentrantLock();
```

atau serial writer queue, bukan `FileChannel.lock()` sebagai satu-satunya mekanisme.

---

## 5. Exclusive Lock vs Shared Lock

Java mengenal dua mode:

| Mode | Parameter | Makna |
|---|---:|---|
| Exclusive | `shared = false` | Mencegah lock overlapping lain jika pihak lain menghormati lock |
| Shared | `shared = true` | Banyak reader bisa memegang shared lock; writer exclusive tidak boleh overlap |

Contoh shared read lock:

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ);
     FileLock lock = channel.lock(0L, Long.MAX_VALUE, true)) {

    // baca file dengan asumsi writer kooperatif mengambil exclusive lock
}
```

Contoh exclusive write lock:

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE);
     FileLock lock = channel.lock(0L, Long.MAX_VALUE, false)) {

    // tulis file dengan asumsi reader/writer lain kooperatif
}
```

Namun ada caveat penting:

> Beberapa platform tidak mendukung shared lock. Pada platform seperti itu, request shared lock bisa otomatis dikonversi menjadi exclusive lock.

Jadi jangan desain correctness yang terlalu bergantung pada shared lock jika aplikasi harus portable.

---

## 6. Region Lock: Lock Tidak Harus Seluruh File

`FileLock` dapat mengunci region:

```java
FileLock lock = channel.lock(position, size, shared);
```

Misalnya:

```java
long recordSize = 512;
long recordIndex = 42;
long position = recordIndex * recordSize;

try (FileLock lock = channel.lock(position, recordSize, false)) {
    // update record ke-42
}
```

Ini berguna untuk file dengan fixed-length records atau structured binary layout.

Tetapi region lock jarang tepat untuk workflow file biasa seperti:

- upload file,
- process file,
- replace config,
- append log,
- generate report,
- archive file.

Untuk mayoritas application workflow, lebih sederhana dan aman memakai whole-file lock atau lock file terpisah.

Perlu dipahami juga:

> Region yang dikunci tidak harus benar-benar berada dalam ukuran file saat ini.

Lock bisa mencakup byte range yang melewati EOF. Ini berguna untuk “reservation”, tetapi sering membingungkan saat debugging.

---

## 7. `lock()` vs `tryLock()`

### 7.1 `lock()`

`lock()` bersifat blocking:

```java
try (FileLock lock = channel.lock()) {
    // masuk setelah lock diperoleh
}
```

Jika proses lain memegang lock yang konflik, thread bisa menunggu.

Risiko:

- thread pool bisa habis,
- request bisa menggantung,
- deadlock antar resource bisa terjadi,
- shutdown bisa tertahan,
- observability buruk jika tidak ada timeout.

### 7.2 `tryLock()`

`tryLock()` tidak menunggu:

```java
try (FileLock lock = channel.tryLock()) {
    if (lock == null) {
        // lock sedang dipegang proses lain
        return;
    }

    // critical section
}
```

Namun `tryLock()` tidak hanya mengembalikan `null`. Ia juga bisa melempar exception.

Perbedaan penting:

| Kondisi | Kemungkinan hasil |
|---|---|
| Lock konflik dengan proses lain | `null` |
| Lock overlap sudah dipegang JVM yang sama | `OverlappingFileLockException` |
| Channel tidak writable untuk exclusive lock | exception |
| OS/filesystem error | `IOException` |

Contoh wrapper yang lebih eksplisit:

```java
public enum LockAcquireResult {
    ACQUIRED,
    BUSY_BY_OTHER_PROCESS,
    OVERLAPS_IN_SAME_JVM,
    FAILED
}
```

Dalam production, jangan samakan semua kegagalan lock sebagai “busy”.

---

## 8. `OverlappingFileLockException`: Kesalahan Mental Model Dalam JVM

`OverlappingFileLockException` terjadi ketika JVM yang sama sudah memegang lock overlapping atau ada thread lain dalam JVM yang sedang menunggu lock overlapping.

Contoh:

```java
try (FileChannel channel1 = FileChannel.open(path, StandardOpenOption.WRITE);
     FileChannel channel2 = FileChannel.open(path, StandardOpenOption.WRITE)) {

    FileLock lock1 = channel1.lock();

    // Ini bisa throw OverlappingFileLockException,
    // bukan sekadar menunggu atau return null.
    FileLock lock2 = channel2.tryLock();
}
```

Kenapa?

Karena Java menjaga invariant:

```text
Dalam satu JVM, lock pada file yang sama tidak boleh overlap.
```

Implikasinya:

- `FileLock` bukan primitive lock untuk thread dalam JVM.
- Anda tetap butuh `ReentrantLock`, queue, actor, single writer, atau concurrency control internal.
- Jika aplikasi Anda punya banyak komponen yang bisa lock file yang sama, buat registry internal agar tidak saling tabrak.

Contoh registry sederhana:

```java
final class InJvmFileLockRegistry {
    private final ConcurrentHashMap<Path, ReentrantLock> locks = new ConcurrentHashMap<>();

    ReentrantLock forPath(Path path) throws IOException {
        Path real = path.toAbsolutePath().normalize();
        return locks.computeIfAbsent(real, ignored -> new ReentrantLock());
    }
}
```

Catatan: registry seperti ini hanya menyelesaikan koordinasi dalam JVM, bukan lintas proses.

---

## 9. Advisory vs Mandatory Lock

Ini inti dari topik ini.

### 9.1 Advisory Lock

Advisory lock berarti:

> OS menyediakan mekanisme lock, tetapi program lain harus secara sukarela memeriksa dan menghormatinya.

Jika program lain tidak peduli lock dan langsung menulis file, OS mungkin tidak mencegah.

Analogi:

```text
Ada tanda “ruangan sedang dipakai”.
Orang yang sopan tidak masuk.
Orang yang tidak peduli tetap bisa masuk.
```

### 9.2 Mandatory Lock

Mandatory lock berarti:

> OS benar-benar mencegah akses yang melanggar lock.

Analogi:

```text
Pintu benar-benar terkunci.
```

### 9.3 Java Recommendation

Java secara eksplisit menyarankan agar lock API dipakai seolah-olah lock tersebut advisory, karena behavior native lock system-dependent.

Ini berarti desain yang benar adalah:

```text
File lock hanya valid jika semua aktor memakai locking protocol yang sama.
```

Kalau ada aktor yang tidak kooperatif:

- shell script,
- editor manual,
- antivirus,
- backup agent,
- legacy process,
- container sidecar,
- ETL job,
- another service in different language,

maka file lock tidak boleh dianggap sebagai absolute protection.

---

## 10. File Lock Tidak Sama Dengan File Permission

Permission menjawab:

```text
Siapa boleh membuka/membaca/menulis file?
```

Lock menjawab:

```text
Siapa sedang mengklaim region file saat ini?
```

Mereka berbeda.

| Mekanisme | Persistent? | Scope | Fungsi |
|---|---:|---|---|
| Permission | Ya | File metadata | Authorization dasar |
| ACL | Ya | File metadata | Authorization lebih granular |
| File lock | Tidak | Runtime handle/JVM/OS | Koordinasi akses sementara |

Jangan gunakan file lock untuk security boundary.

Jika file tidak boleh ditulis oleh user/process tertentu, perbaiki permission/ACL/runtime identity, bukan hanya lock.

---

## 11. File Lock Tidak Sama Dengan Durability

Lock tidak membuat write durable.

Ini salah:

```java
try (FileLock lock = channel.lock()) {
    channel.write(buffer);
    // mengira karena ada lock maka data pasti durable
}
```

Yang benar:

```java
try (FileLock lock = channel.lock()) {
    channel.write(buffer);
    channel.force(true);
}
```

Bahkan `force(true)` pun punya caveat pada storage/network tertentu, tapi secara API itu adalah primitive durability yang relevan, bukan lock.

Pisahkan mental model:

| Concern | Primitive |
|---|---|
| Mutual exclusion | lock / rename claim / DB lock |
| Visibility | close / flush / OS cache behavior |
| Durability | `FileChannel.force`, `SYNC`, `DSYNC`, fsync-like behavior |
| Atomic replacement | temp file + atomic move |
| Recovery | manifest, checkpoint, journal, replay |

---

## 12. File Lock Tidak Sama Dengan Atomic Handoff

Untuk workflow seperti:

```text
producer menaruh file
consumer mengambil file
```

file lock sering bukan pilihan terbaik.

Lebih baik:

```text
/inbox/file.tmp       ← producer menulis
/inbox/file.ready     ← producer atomic rename setelah selesai
/processing/file      ← consumer atomic rename untuk claim
/done/file            ← selesai
/error/file           ← gagal
```

Kenapa atomic rename sering lebih baik?

- consumer tidak perlu percaya lock,
- ownership terlihat dari nama/lokasi file,
- recovery lebih mudah,
- lebih cocok untuk batch workflow,
- state machine lebih eksplisit,
- tidak bergantung pada semua reader melakukan lock.

Lock cocok jika:

- file yang sama memang harus dibuka bersama oleh beberapa proses,
- format file mendukung update in-place,
- semua aktor kooperatif,
- filesystem mendukung lock dengan baik.

Atomic rename cocok jika:

- file adalah unit kerja,
- producer/consumer workflow,
- handoff satu arah,
- idempotency/recovery penting.

---

## 13. Lock File Pattern

Lock file pattern menggunakan file khusus sebagai token koordinasi:

```text
/data/job.lock
/data/job-state.json
/data/input.csv
```

Proses mengambil lock pada `job.lock`, bukan langsung pada file data.

Contoh:

```java
Path lockPath = directory.resolve("job.lock");

try (FileChannel channel = FileChannel.open(
        lockPath,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE);
     FileLock lock = channel.tryLock()) {

    if (lock == null) {
        System.out.println("Another process is running");
        return;
    }

    // protected workflow
}
```

Keuntungan:

- tidak mengganggu content file utama,
- bisa menyimpan metadata lock,
- lokasi lock jelas,
- bisa melindungi multi-file operation.

Kelemahan:

- stale lock file bisa membingungkan,
- lock file existence bukan lock,
- jika hanya memakai `Files.exists(lock)` → race,
- network filesystem caveat tetap berlaku,
- tidak cocok untuk distributed coordination yang serius.

---

## 14. Jangan Salah: File `.lock` Yang Ada Bukan Berarti Lock Aktif

Ini anti-pattern:

```java
if (Files.exists(lockFile)) {
    throw new IllegalStateException("Already locked");
}
Files.createFile(lockFile);
```

Masalah:

- TOCTOU race,
- proses bisa crash dan meninggalkan file,
- tidak ada hubungan dengan OS lock,
- tidak otomatis release saat JVM mati,
- cleanup manual bisa salah.

Versi sedikit lebih baik:

```java
try {
    Files.createFile(lockFile); // atomic create
    try {
        // critical section
    } finally {
        Files.deleteIfExists(lockFile);
    }
} catch (FileAlreadyExistsException busy) {
    // lock file already exists
}
```

Ini memakai atomic create sebagai claim. Namun tetap ada stale lock problem jika proses crash setelah create sebelum delete.

Versi OS lock:

```java
try (FileChannel channel = FileChannel.open(lockFile,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE);
     FileLock lock = channel.tryLock()) {

    if (lock == null) {
        return;
    }

    // critical section
}
```

Di sini file boleh tetap ada; yang penting adalah OS lock-nya, bukan existence file-nya.

---

## 15. PID File Pattern dan Kelemahannya

PID file menyimpan process id:

```text
job.pid
12345
```

Tujuannya agar operator tahu proses mana yang memegang lock.

Contoh metadata:

```json
{
  "pid": 12345,
  "host": "worker-07",
  "startedAt": "2026-06-18T09:15:00+07:00",
  "owner": "monthly-report-generator",
  "version": "2026.06.1"
}
```

Masalah PID file:

- PID bisa reuse,
- PID hanya bermakna di host yang sama,
- container PID namespace bisa berbeda,
- clock antar host bisa skew,
- proses bisa crash meninggalkan file,
- `kill -0 pid` tidak portable untuk semua environment,
- stale detection rawan salah.

PID file boleh dipakai untuk observability/operator hint, tetapi jangan dijadikan satu-satunya correctness mechanism.

---

## 16. Heartbeat Lease Pattern

Untuk long-running process, lock file bisa dilengkapi heartbeat:

```json
{
  "ownerId": "worker-07:pid-12345:uuid-abc",
  "acquiredAt": "2026-06-18T09:00:00+07:00",
  "lastHeartbeatAt": "2026-06-18T09:03:30+07:00",
  "leaseSeconds": 120
}
```

Namun hati-hati: heartbeat file bukan distributed consensus.

Problem:

- clock skew,
- GC pause panjang,
- host pause,
- network filesystem delay,
- partial write heartbeat,
- split brain,
- dua process merasa lease expired dan sama-sama mengambil.

Jika correctness penting, gunakan coordination system yang memang didesain untuk lease:

- database row lock,
- PostgreSQL advisory lock,
- Redis dengan fencing token dan TTL yang hati-hati,
- ZooKeeper/etcd/Consul,
- message queue consumer group,
- Kubernetes leader election.

File heartbeat cocok untuk best-effort local job, bukan distributed critical coordination.

---

## 17. File Lock Di Network Filesystem

Java documentation memberi peringatan keras: hati-hati dengan file locks pada network filesystem.

Kenapa?

Network filesystem bisa memiliki:

- client-side caching,
- delayed visibility,
- lock manager terpisah,
- server failover,
- stale file handle,
- page alignment constraint,
- maximum lock region constraint,
- inconsistent behavior antar OS client,
- latency tinggi,
- partial outage.

Contoh lingkungan berisiko:

```text
NFS
SMB/CIFS
EFS-like filesystem
shared PVC di Kubernetes
mounted network drive
enterprise NAS
```

Rule praktis:

| Situasi | Rekomendasi |
|---|---|
| Single host, local filesystem | File lock bisa masuk akal |
| Multiple JVM same host | File lock bisa berguna, tetap advisory |
| Multiple host via network FS | Hati-hati besar; test real FS |
| Critical financial/regulatory workflow | Prefer DB/queue/coordination service |
| Kubernetes multi-pod shared volume | Jangan anggap file lock cukup tanpa validasi provider |

---

## 18. File Lock Di Container dan Kubernetes

Dalam container, file lock tetap bergantung pada filesystem yang dimount.

Beberapa skenario:

| Storage | Risiko |
|---|---|
| Container writable layer | Lock hanya berguna dalam container/node context terkait |
| `emptyDir` | Local ke node; pod berbeda node tidak berbagi |
| PVC block/local | Bergantung storage class |
| NFS/EFS-backed PVC | Network FS caveat |
| ConfigMap/Secret volume | Umumnya read-only/projection semantics; bukan tempat lock |
| Object-store-mounted filesystem | Sering tidak punya POSIX lock semantics kuat |

Untuk Kubernetes leader/job coordination, lebih baik:

- gunakan Lease API Kubernetes,
- database lock,
- queue-based work claim,
- idempotent consumer,
- atomic rename pada shared POSIX filesystem yang sudah divalidasi.

Jangan membuat asumsi:

```text
Karena pod bisa melihat file yang sama, maka FileLock pasti reliable lintas pod.
```

Itu harus dibuktikan dengan dokumentasi storage class dan integration test.

---

## 19. Blocking Lock dan Deadlock

File lock dapat menjadi bagian dari deadlock jika dikombinasikan dengan resource lain.

Contoh buruk:

```text
Process A:
1. acquire DB lock row X
2. wait file lock F

Process B:
1. acquire file lock F
2. wait DB lock row X
```

Deadlock.

Aturan desain:

1. Tetapkan global lock ordering.
2. Jangan pegang file lock saat melakukan operasi lambat yang tidak perlu.
3. Hindari blocking lock tanpa timeout di request thread.
4. Prefer `tryLock` + retry/backoff untuk job worker.
5. Instrument lock wait time.
6. Jangan melakukan network call eksternal saat memegang file lock kecuali benar-benar perlu.

Java `FileChannel.lock()` tidak menyediakan timeout langsung. Jika butuh timeout, Anda biasanya memakai loop `tryLock()` dengan deadline.

Contoh:

```java
static Optional<FileLock> tryLockWithTimeout(
        FileChannel channel,
        Duration timeout,
        Duration sleepBetweenAttempts) throws IOException, InterruptedException {

    long deadline = System.nanoTime() + timeout.toNanos();

    while (System.nanoTime() < deadline) {
        try {
            FileLock lock = channel.tryLock();
            if (lock != null) {
                return Optional.of(lock);
            }
        } catch (OverlappingFileLockException sameJvmConflict) {
            // Ini bukan busy by other process. Ini bug/konflik desain dalam JVM.
            throw sameJvmConflict;
        }

        Thread.sleep(sleepBetweenAttempts.toMillis());
    }

    return Optional.empty();
}
```

Dalam Java modern, untuk production, pertimbangkan jitter:

```java
long jitterMillis = ThreadLocalRandom.current().nextLong(10, 100);
Thread.sleep(baseDelayMillis + jitterMillis);
```

---

## 20. Safe Critical Section Dengan File Lock

Template lebih production-friendly:

```java
public final class FileLocking {

    public static <T> Optional<T> withExclusiveFileLock(
            Path lockFile,
            Duration timeout,
            CheckedSupplier<T> action) throws IOException, InterruptedException {

        Files.createDirectories(lockFile.toAbsolutePath().getParent());

        try (FileChannel channel = FileChannel.open(
                lockFile,
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE)) {

            Optional<FileLock> maybeLock = tryLockWithTimeout(
                    channel,
                    timeout,
                    Duration.ofMillis(100));

            if (maybeLock.isEmpty()) {
                return Optional.empty();
            }

            try (FileLock ignored = maybeLock.get()) {
                return Optional.of(action.get());
            }
        }
    }

    private static Optional<FileLock> tryLockWithTimeout(
            FileChannel channel,
            Duration timeout,
            Duration sleep) throws IOException, InterruptedException {

        long deadline = System.nanoTime() + timeout.toNanos();

        while (System.nanoTime() < deadline) {
            FileLock lock = channel.tryLock();
            if (lock != null) {
                return Optional.of(lock);
            }
            Thread.sleep(sleep.toMillis());
        }

        return Optional.empty();
    }

    @FunctionalInterface
    public interface CheckedSupplier<T> {
        T get() throws IOException;
    }
}
```

Kelemahan template ini:

- belum ada jitter,
- belum ada observability,
- belum ada cancellation policy selain interrupt,
- belum menangani `OverlappingFileLockException` secara domain-specific,
- belum menulis owner metadata,
- belum membedakan local vs network filesystem.

Tetapi ini lebih baik daripada blocking `lock()` tanpa batas.

---

## 21. Menulis Metadata Lock Untuk Observability

Saat lock berhasil diperoleh, Anda bisa menulis metadata ke lock file.

```java
record LockOwner(
        String ownerId,
        String host,
        long pid,
        Instant acquiredAt,
        String purpose
) {}
```

Contoh:

```java
static void writeLockMetadata(FileChannel channel, LockOwner owner) throws IOException {
    String json = """
            {
              "ownerId": "%s",
              "host": "%s",
              "pid": %d,
              "acquiredAt": "%s",
              "purpose": "%s"
            }
            """.formatted(
            owner.ownerId(),
            owner.host(),
            owner.pid(),
            owner.acquiredAt(),
            owner.purpose());

    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    channel.truncate(0);
    channel.position(0);
    channel.write(ByteBuffer.wrap(bytes));
    channel.force(true);
}
```

Untuk Java 8, tidak ada text block dan record:

```java
final class LockOwner {
    final String ownerId;
    final String host;
    final long pid;
    final Instant acquiredAt;
    final String purpose;

    LockOwner(String ownerId, String host, long pid, Instant acquiredAt, String purpose) {
        this.ownerId = ownerId;
        this.host = host;
        this.pid = pid;
        this.acquiredAt = acquiredAt;
        this.purpose = purpose;
    }
}
```

Metadata lock membantu operator menjawab:

- siapa memegang lock,
- sejak kapan,
- untuk tujuan apa,
- host/pod mana,
- apakah lock mungkin stale.

Namun metadata bukan correctness mechanism utama.

---

## 22. File Lock dan Append

Untuk append multi-process, banyak orang mengira cukup:

```java
Files.write(path, line, CREATE, APPEND);
```

Masalah:

- atomicity append system-dependent,
- record bisa interleave jika banyak process menulis bersamaan,
- encoding multi-byte bisa terpotong jika write terfragmentasi,
- newline boundary bisa kacau,
- network FS bisa lebih buruk.

Jika harus append dari banyak process:

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.APPEND);
     FileLock lock = channel.lock()) {

    byte[] bytes = (line + System.lineSeparator()).getBytes(StandardCharsets.UTF_8);
    channel.write(ByteBuffer.wrap(bytes));
    channel.force(false); // jika perlu durability per record
}
```

Tetapi untuk high-throughput logging, ini buruk. Lebih baik:

- satu writer thread,
- logging framework,
- queue,
- stdout di container,
- database/event stream jika perlu query/reliability.

File lock per line biasanya bottleneck.

---

## 23. File Lock dan Memory-Mapped File

Java docs memperingatkan bahwa pada beberapa sistem, mandatory lock pada region file bisa mencegah region itu dimapping ke memory, dan sebaliknya. Network filesystem juga bisa mensyaratkan lock region page-aligned untuk mapped file.

Implikasi:

- jangan asal gabungkan `FileChannel.map()` dan `FileLock`,
- test di OS/filesystem target,
- siapkan fallback,
- jangan desain format storage kritikal dengan asumsi semua kombinasi mmap+lock portable.

Jika Anda membuat embedded storage engine, ini menjadi topik besar:

```text
record layout
page size
mmap lifecycle
file lock
force
crash recovery
compaction
multi-process access
```

Untuk aplikasi bisnis biasa, hindari multi-process mmap write dengan file lock kecuali benar-benar paham konsekuensinya.

---

## 24. Lock Lifetime dan Channel Lifetime

Lock valid sampai:

1. `release()` dipanggil,
2. `close()` pada `FileLock` dipanggil,
3. channel yang dipakai untuk memperoleh lock ditutup,
4. JVM terminasi.

Contoh aman:

```java
try (FileChannel channel = FileChannel.open(path, CREATE, WRITE);
     FileLock lock = channel.lock()) {

    // lock valid di sini
}
```

Contoh berbahaya:

```java
FileLock lock;
try (FileChannel channel = FileChannel.open(path, CREATE, WRITE)) {
    lock = channel.lock();
}

// channel sudah close, lock tidak valid lagi
```

Jangan mengembalikan `FileLock` keluar dari scope channel kecuali lifecycle channel juga dikelola eksplisit.

---

## 25. Closing One Channel Bisa Mempengaruhi Lock Lain

Dokumentasi Java memberi peringatan: pada beberapa sistem, menutup satu channel bisa melepaskan semua lock yang dipegang JVM pada file underlying tersebut, walaupun lock diperoleh lewat channel lain.

Karena itu Java merekomendasikan:

> Dalam satu program, gunakan channel unik untuk memperoleh semua lock pada file tertentu.

Anti-pattern:

```java
FileChannel c1 = FileChannel.open(path, WRITE);
FileChannel c2 = FileChannel.open(path, WRITE);

FileLock lock = c1.lock();

// Di beberapa sistem, close c2 bisa punya efek mengejutkan terhadap lock pada file sama.
c2.close();
```

Praktik lebih baik:

- satu abstraction owning channel+lock,
- jangan buka banyak channel ke file lock yang sama tanpa alasan,
- centralize file lock acquisition,
- hindari utility tersebar yang membuka/menutup channel file yang sama sembarangan.

---

## 26. Exception Model

Exception umum:

| Exception | Makna umum |
|---|---|
| `OverlappingFileLockException` | JVM yang sama sudah punya/menunggu lock overlapping |
| `FileLockInterruptionException` | Thread diinterrupt saat menunggu lock |
| `ClosedChannelException` | Channel sudah ditutup |
| `NonReadableChannelException` | Request shared lock pada channel yang tidak readable |
| `NonWritableChannelException` | Request exclusive lock pada channel yang tidak writable |
| `AsynchronousCloseException` | Channel ditutup thread lain saat operasi blocking |
| `ClosedByInterruptException` | Thread diinterrupt dan channel ditutup |
| `IOException` | Error I/O umum dari OS/provider |

Pattern handling:

```java
try (FileLock lock = channel.tryLock()) {
    if (lock == null) {
        // busy by other process
        return;
    }
    // critical section
} catch (OverlappingFileLockException e) {
    // design bug or in-JVM contention
    throw e;
} catch (IOException e) {
    // real I/O failure
    throw e;
}
```

Jangan tangkap semua exception lalu menganggap “file sedang dipakai”.

---

## 27. Kapan Memakai File Lock?

File lock masuk akal untuk:

1. mencegah dua instance local job berjalan bersamaan,
2. koordinasi antar proses di host yang sama,
3. melindungi update in-place file kecil/menengah,
4. lock file untuk CLI tool,
5. proses import/export single-host,
6. embedded local data file dengan satu writer,
7. menjaga agar reader/writer kooperatif tidak overlap.

Contoh kasus tepat:

```text
Satu server menjalankan scheduled job via cron.
Kadang job sebelumnya belum selesai.
Gunakan lock file agar instance berikutnya skip.
```

Contoh:

```java
try (FileChannel channel = FileChannel.open(lockPath, CREATE, WRITE);
     FileLock lock = channel.tryLock()) {

    if (lock == null) {
        log.info("Previous job still running; skip this run");
        return;
    }

    runJob();
}
```

---

## 28. Kapan Tidak Memakai File Lock?

Hindari file lock sebagai mekanisme utama jika:

1. workload distributed multi-host,
2. correctness sangat kritikal,
3. file berada di network filesystem yang belum divalidasi,
4. ada aktor non-kooperatif,
5. Anda butuh fairness,
6. Anda butuh fencing token,
7. Anda butuh timeout/lease kuat,
8. Anda butuh audit transaction log,
9. operasi melibatkan banyak resource eksternal,
10. Anda sebenarnya butuh queue/DB transaction.

Contoh salah:

```text
Lima pod Kubernetes membaca shared PVC dan memakai FileLock untuk leader election critical process.
```

Lebih baik:

- Kubernetes Lease API,
- database advisory lock,
- single consumer queue,
- job scheduler dengan concurrency policy,
- distributed coordination service.

---

## 29. Alternative: Atomic Create Sebagai Claim

Untuk claim file satu kali, `CREATE_NEW` sering lebih sederhana daripada `FileLock`.

Contoh:

```java
Path claim = path.resolveSibling(path.getFileName() + ".claim");

try {
    Files.createFile(claim); // atomic create
    try {
        process(path);
    } finally {
        Files.deleteIfExists(claim);
    }
} catch (FileAlreadyExistsException busy) {
    // already claimed
}
```

Kelemahan:

- stale claim file jika crash,
- perlu recovery policy,
- tidak auto-release oleh OS saat JVM mati.

Kelebihan:

- sangat eksplisit,
- mudah diobservasi,
- tidak bergantung pada OS file lock semantics sejauh atomic create valid,
- cocok untuk work-item claim dengan recovery.

Untuk robust workflow, rename-claim sering lebih baik:

```text
/inbox/a.csv
```

consumer mencoba:

```text
/inbox/a.csv → /processing/a.csv
```

Jika move berhasil, ia owner. Jika gagal, file sudah diambil/hilang.

---

## 30. Alternative: Database Lock

Jika aplikasi sudah memakai database, sering kali database lock lebih kuat untuk coordination.

Contoh pattern:

```sql
UPDATE job_lock
SET owner = ?, locked_until = ?
WHERE name = ?
  AND locked_until < CURRENT_TIMESTAMP;
```

Atau pessimistic row lock:

```sql
SELECT * FROM job_lock WHERE name = ? FOR UPDATE;
```

Keuntungan:

- transactional,
- observable,
- works across hosts,
- bisa punya TTL/lease,
- bisa ikut audit,
- lebih jelas untuk regulatory system.

Kelemahan:

- database dependency,
- perlu schema,
- risiko lock contention DB,
- perlu transaction discipline.

Untuk enterprise/regulatory workflow, DB lock biasanya lebih defensible daripada file lock.

---

## 31. Alternative: Queue-Based Ownership

Daripada banyak worker berebut file, gunakan queue:

```text
producer → queue message {fileId, objectKey, checksum}
worker consumes message → process file
```

Keuntungan:

- ownership by message broker,
- retry built-in,
- dead-letter queue,
- visibility timeout,
- scaling lebih jelas,
- observability lebih baik.

File tetap bisa ada di storage, tetapi coordination pindah ke queue.

Ini biasanya lebih baik untuk:

- high volume intake,
- distributed workers,
- retry-heavy workloads,
- exactly-once-like processing dengan idempotency.

---

## 32. Design Decision Matrix

| Problem | Prefer |
|---|---|
| Single local job tidak boleh overlap | file lock atau atomic lock file |
| Multi-thread dalam JVM | `ReentrantLock`, queue, actor, synchronized writer |
| Producer/consumer file handoff | atomic rename/state directory |
| Multi-pod leader election | Kubernetes Lease / DB / etcd |
| Multi-host critical lock | DB lock / distributed coordinator |
| Append local low-volume file | file lock + append |
| Append high-volume log | logging framework/stdout/event stream |
| Multi-file transaction | DB transaction or manifest+journal pattern |
| Secure write protection | permission/ACL/runtime identity, bukan lock |
| Crash-safe config update | temp file + force + atomic move |

---

## 33. Production Pattern: Single Instance Local Job Lock

Contoh lengkap Java 11+:

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Optional;

public final class LocalJobLockExample {

    public static void main(String[] args) throws Exception {
        Path lockPath = Path.of("runtime/monthly-report.lock");

        boolean ran = runSingleInstance(lockPath, () -> {
            System.out.println("Running job...");
            Thread.sleep(5_000);
        });

        if (!ran) {
            System.out.println("Another instance is already running. Skip.");
        }
    }

    static boolean runSingleInstance(Path lockPath, InterruptibleRunnable job)
            throws IOException, InterruptedException {

        Path parent = lockPath.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        try (FileChannel channel = FileChannel.open(
                lockPath,
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE)) {

            FileLock lock;
            try {
                lock = channel.tryLock();
            } catch (OverlappingFileLockException e) {
                // Same JVM conflict. Treat as already running or configuration bug.
                return false;
            }

            if (lock == null) {
                return false;
            }

            try (lock) {
                writeOwner(channel);
                job.run();
                return true;
            }
        }
    }

    static void writeOwner(FileChannel channel) throws IOException {
        String metadata = "ownerPid=" + ProcessHandle.current().pid()
                + "\nacquiredAt=" + Instant.now()
                + "\n";

        channel.truncate(0);
        channel.position(0);
        channel.write(ByteBuffer.wrap(metadata.getBytes(StandardCharsets.UTF_8)));
        channel.force(true);
    }

    @FunctionalInterface
    interface InterruptibleRunnable {
        void run() throws InterruptedException, IOException;
    }
}
```

Java 8 compatibility note:

- ganti `Path.of(...)` dengan `Paths.get(...)`,
- `ProcessHandle.current().pid()` belum ada di Java 8; gunakan alternative seperti `ManagementFactory.getRuntimeMXBean().getName()` jika perlu best-effort PID.

---

## 34. Production Pattern: Lock + Atomic Update

Jika ingin update file config dengan writer tunggal lintas proses kooperatif:

```text
config.json
config.json.lock
```

Flow:

1. acquire exclusive lock pada `config.json.lock`,
2. baca config lama jika perlu,
3. tulis config baru ke temp file di directory yang sama,
4. force temp file,
5. atomic move temp ke `config.json`,
6. release lock.

Pseudo:

```java
try (FileChannel lockChannel = FileChannel.open(lockPath, CREATE, WRITE);
     FileLock lock = lockChannel.lock()) {

    Path temp = Files.createTempFile(configPath.getParent(), ".config-", ".tmp");

    try (FileChannel data = FileChannel.open(temp, WRITE, TRUNCATE_EXISTING)) {
        data.write(ByteBuffer.wrap(newContent));
        data.force(true);
    }

    Files.move(temp, configPath,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
}
```

Kenapa lock file terpisah?

- target bisa diganti via atomic move,
- lock tetap stabil pada path lock,
- reader/writer kooperatif bisa lock protocol yang sama,
- tidak bergantung pada lock yang melekat pada inode lama target.

Namun reader harus mematuhi protocol jika memang ingin konsistensi terhadap writer:

```java
try (FileChannel lockChannel = FileChannel.open(lockPath, CREATE, READ);
     FileLock lock = lockChannel.lock(0L, Long.MAX_VALUE, true)) {

    byte[] bytes = Files.readAllBytes(configPath);
}
```

Jika reader tidak lock, ia masih mungkin membaca saat writer melakukan update, walaupun atomic move biasanya membuat reader melihat versi lama atau baru, bukan partial file, pada filesystem yang mendukung atomic rename.

---

## 35. Production Pattern: Rename Claim Lebih Baik Daripada Lock Untuk Intake

Untuk file intake:

```text
/inbox/customer-001.csv
```

Jangan desain:

```text
lock customer-001.csv
process customer-001.csv
unlock
```

Lebih baik:

```text
/inbox/customer-001.csv
  → /processing/customer-001.csv
  → /done/customer-001.csv
```

Java:

```java
Path source = inbox.resolve(fileName);
Path claimed = processing.resolve(fileName);

try {
    Files.move(source, claimed, StandardCopyOption.ATOMIC_MOVE);
} catch (NoSuchFileException alreadyTakenOrGone) {
    return;
} catch (AtomicMoveNotSupportedException unsupported) {
    // Decide: fail fast or fallback with explicit risk.
    throw unsupported;
}

process(claimed);
```

Kelebihan:

- ownership terlihat,
- tidak perlu reader lain menghormati lock,
- recovery bisa scan `/processing`,
- status workflow jelas,
- audit lebih mudah.

Ini akan dibahas lebih luas lagi di Part 32.

---

## 36. Observability Untuk File Lock

Metric yang perlu:

| Metric | Arti |
|---|---|
| `file_lock_attempt_total` | jumlah attempt acquire |
| `file_lock_acquired_total` | jumlah sukses |
| `file_lock_busy_total` | jumlah busy by other process |
| `file_lock_overlap_same_jvm_total` | desain konflik dalam JVM |
| `file_lock_wait_duration_ms` | waktu tunggu |
| `file_lock_hold_duration_ms` | durasi critical section |
| `file_lock_io_error_total` | error saat acquire/release/write metadata |
| `file_lock_stale_detected_total` | stale metadata/claim ditemukan |

Log yang baik:

```json
{
  "event": "file_lock_acquired",
  "lockPath": "/app/runtime/report.lock",
  "ownerId": "report-worker-1",
  "waitMs": 42,
  "purpose": "monthly-report"
}
```

Log yang buruk:

```text
Could not lock file
```

Karena tidak menjawab:

- file mana,
- busy atau error,
- menunggu berapa lama,
- siapa owner sebelumnya,
- filesystem apa,
- operation apa.

---

## 37. Failure Matrix

| Failure | Dampak | Mitigasi |
|---|---|---|
| Process crash saat pegang `FileLock` | OS/JVM biasanya release lock saat process mati | Pastikan recovery data tetap benar |
| Process crash setelah create `.claim` file | Stale claim | TTL/metadata/manual recovery |
| JVM yang sama acquire lock overlapping | `OverlappingFileLockException` | In-JVM lock registry/single abstraction |
| Network FS lock inconsistency | Split-brain/corruption | Avoid or validate; use DB/coordination service |
| Blocking lock tidak pernah didapat | thread stuck | tryLock + timeout + metric |
| Holder melakukan operasi eksternal lama | lock hold time tinggi | kecilkan critical section |
| Channel tertutup tidak sengaja | lock invalid/released | lifecycle ownership jelas |
| Shared lock dikonversi exclusive | throughput turun/deadlock risk | jangan bergantung pada shared semantics portable |
| Non-cooperative writer menulis file | lock tidak melindungi | permission/protocol/architecture |
| Lock dipakai sebagai durability | data hilang saat crash | force/atomic move/journal |

---

## 38. Checklist Desain Sebelum Memakai File Lock

Jawab pertanyaan ini sebelum memilih `FileChannel.lock()`:

1. Apakah semua aktor yang akses file kooperatif?
2. Apakah semua aktor memakai protocol lock yang sama?
3. Apakah aktor berada dalam satu host atau banyak host?
4. Apakah file berada di local filesystem atau network filesystem?
5. Apakah lock harus fair?
6. Apakah lock butuh timeout?
7. Apakah crash saat critical section bisa direcover?
8. Apakah lock melindungi satu file atau multi-file workflow?
9. Apakah operation butuh durability atau hanya exclusion?
10. Apakah rename-claim lebih cocok?
11. Apakah database/queue lebih defensible?
12. Apakah observability lock sudah cukup?
13. Apakah ada stale lock/claim recovery?
14. Apakah sudah dites di OS/filesystem target?
15. Apakah Java 8 compatibility dibutuhkan?

Jika banyak jawaban tidak jelas, jangan buru-buru pakai file lock.

---

## 39. Java 8–25 Compatibility Notes

| Fitur | Java 8 | Java 9+ / 11+ / 25 |
|---|---|---|
| `FileChannel.lock` | Ada | Ada |
| `FileLock implements AutoCloseable` | Ada | Ada |
| `Path.of` | Tidak ada | Ada sejak Java 11 |
| `ProcessHandle.current().pid()` | Tidak ada | Ada sejak Java 9 |
| `var` | Tidak ada | Ada sejak Java 10 |
| text block | Tidak ada | Ada sejak Java 15 |
| record | Tidak ada | Ada sejak Java 16 |
| virtual thread | Tidak ada | Ada sejak Java 21, tapi blocking file lock tetap harus didesain hati-hati |

Untuk materi seri ini, API file lock core stabil dari Java 8 sampai Java 25. Perbedaan terbesar ada pada ergonomics bahasa dan API pendukung, bukan konsep lock-nya.

---

## 40. Kesalahan Umum dan Koreksinya

### Kesalahan 1 — Menganggap `Files.exists(lockFile)` adalah lock

Salah:

```java
if (!Files.exists(lockFile)) {
    Files.createFile(lockFile);
}
```

Benar:

```java
Files.createFile(lockFile); // atomic claim, handle FileAlreadyExistsException
```

atau:

```java
FileChannel.open(lockFile, CREATE, WRITE).tryLock();
```

---

### Kesalahan 2 — Menggunakan `FileLock` untuk thread dalam JVM

Salah:

```java
// Banyak thread dalam JVM yang sama mengandalkan FileLock saja
```

Benar:

```java
// ReentrantLock/queue untuk in-JVM
// FileLock hanya jika perlu cross-process
```

---

### Kesalahan 3 — Menganggap lock mencegah semua program menulis

Salah:

```text
Saya sudah exclusive lock, jadi tidak ada proses lain bisa menulis.
```

Benar:

```text
Hanya aman jika native lock mandatory atau semua aktor kooperatif.
Secara portable, perlakukan sebagai advisory.
```

---

### Kesalahan 4 — Lock dipakai sebagai pengganti atomic move

Salah:

```text
Lock target file lalu overwrite langsung.
```

Benar untuk config/checkpoint:

```text
Lock protocol jika perlu
+ write temp
+ force
+ atomic move
+ recovery
```

---

### Kesalahan 5 — Memakai file lock sebagai distributed lock

Salah:

```text
Semua pod lock file di shared PVC.
```

Benar:

```text
Gunakan DB/queue/Kubernetes Lease/coordination service,
atau validasi storage semantics secara eksplisit.
```

---

## 41. Mini Case Study: Scheduled Report Generator

### Problem

Ada job generate report harian. Kadang job berjalan lebih dari interval scheduler. Jika dua job overlap:

- file output bisa corrupt,
- email bisa terkirim dua kali,
- audit trail membingungkan.

### Naive Design

```java
if (Files.exists(outputFile)) {
    return;
}
generate(outputFile);
```

Ini salah karena output existence bukan running state.

### Better Local Single-Host Design

```text
report.lock
report.tmp
report.csv
```

Flow:

1. acquire `report.lock`,
2. generate ke `report.tmp`,
3. force,
4. atomic move ke `report.csv`,
5. release lock,
6. kirim email hanya setelah publish sukses.

### Better Distributed Design

Jika job bisa jalan di banyak pod:

1. scheduler/DB memilih satu execution,
2. status job disimpan di DB,
3. file output disimpan dengan content hash/object key,
4. publish dilakukan via transaction/outbox,
5. worker idempotent.

File lock bukan pilihan utama.

---

## 42. Mini Case Study: Local Cache Rebuild

### Problem

Beberapa process local bisa rebuild cache file yang sama. Cache boleh direbuild ulang, tetapi jangan sampai partial file terbaca.

### Design

- Writer mengambil lock file.
- Writer build cache ke temp.
- Writer atomic move.
- Reader tidak harus lock jika format publish atomic dan bisa tolerate stale cache.

Flow:

```text
cache.bin.lock
cache.bin.tmp-uuid
cache.bin
```

Reader:

```java
byte[] data = Files.readAllBytes(cachePath);
```

Writer:

```java
try (FileLock lock = lockChannel.lock()) {
    writeTempAndAtomicMove();
}
```

Kenapa reader tidak lock?

Karena atomic replacement memberi reader versi lama atau versi baru. Jika cache immutable per publish, reader tidak perlu koordinasi ketat.

Ini contoh penting: lock tidak selalu harus dipakai oleh semua reader jika data publication pattern sudah benar.

---

## 43. Mini Case Study: Regulatory File Intake

### Problem

Agency menerima batch file dari external system via shared folder. File bisa besar. Consumer tidak boleh membaca file yang masih ditulis.

### Naive Design

```text
WatchService mendeteksi ENTRY_CREATE → langsung read file
```

Salah. File mungkin belum selesai ditulis.

### Better Design

Minta producer mengikuti protocol:

```text
file.dat.uploading
file.dat.ready
```

Producer:

1. tulis `file.dat.uploading`,
2. close/flush,
3. atomic rename ke `file.dat.ready`.

Consumer:

1. scan `*.ready`,
2. atomic move ke `/processing`,
3. validate checksum/manifest,
4. process idempotently,
5. move ke `/done` atau `/error`.

File lock hanya dipakai jika producer dan consumer tidak bisa mengubah naming protocol, dan keduanya kooperatif. Bahkan begitu pun, shared folder/network FS harus divalidasi.

---

## 44. Prinsip Top 1% Untuk File Locking

1. File lock adalah protocol, bukan magic.
2. Treat Java file lock as advisory for portable correctness.
3. File lock bukan permission, bukan durability, bukan transaction.
4. In-JVM concurrency butuh primitive in-JVM.
5. Cross-process local coordination boleh memakai file lock.
6. Distributed coordination sebaiknya tidak memakai file lock kecuali filesystem semantics benar-benar divalidasi.
7. Whole-file workflow sering lebih baik memakai atomic rename daripada lock.
8. Lock file existence bukan bukti lock aktif.
9. Timeout, observability, dan recovery harus didesain sejak awal.
10. Lock hold time harus sekecil mungkin.
11. Jangan pegang lock saat call eksternal lambat jika bisa dihindari.
12. Jangan mencampur banyak channel untuk file lock yang sama tanpa lifecycle jelas.
13. Jangan desain correctness yang bergantung pada shared lock portable.
14. Jangan abaikan `OverlappingFileLockException`; itu biasanya sinyal desain internal yang buruk.
15. Uji di OS/filesystem/container/storage class target.

---

## 45. Ringkasan Mental Model

Kalimat inti:

> File locking di Java adalah mekanisme koordinasi lintas proses berbasis native OS lock pada region file, tetapi correctness-nya bergantung pada platform dan disiplin semua aktor. Untuk desain portable, perlakukan lock sebagai advisory, bukan enforcement absolut.

Jika Anda ingin:

```text
mencegah dua local process jalan bersamaan
```

file lock bisa cocok.

Jika Anda ingin:

```text
mengklaim work item berupa file
```

atomic rename sering lebih cocok.

Jika Anda ingin:

```text
distributed leader election atau critical multi-host mutual exclusion
```

pakai DB/queue/Kubernetes Lease/coordination service.

Jika Anda ingin:

```text
write yang crash-safe
```

pakai temp file + force + atomic move + recovery, bukan lock saja.

Jika Anda ingin:

```text
security boundary
```

pakai permission/ACL/runtime isolation, bukan lock.

---

## 46. Referensi

- Oracle Java SE 25 API — `java.nio.channels.FileLock`
- Oracle Java SE 24/25 API — `java.nio.channels.FileChannel`
- Oracle Java SE 8 API — `java.nio.channels.FileLock`, `FileChannel`, `OverlappingFileLockException`
- Oracle Java SE API — `OverlappingFileLockException`
- Java NIO.2 file API documentation for `Path`, `Files`, and `StandardOpenOption`

---

## 47. Status Seri

Selesai:

```text
Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
Part 02 — File Existence, Type, and Identity: exists Is Not a Lock
Part 03 — File Creation Semantics: Atomic Create, Temp File, Directory Creation
Part 04 — Open Options and File Handles: How Java Opens Files
Part 05 — Reading Files Correctly: Small File, Large File, Streaming, Lazy Lines
Part 06 — Writing Files Correctly: Replace, Append, Flush, Durability
Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move
Part 08 — Copy and Move Semantics: Replace, Attributes, Links, Cross-Device Behavior
Part 09 — Delete Semantics: Delete, Recursive Delete, Tombstone, and Safe Cleanup
Part 10 — Directory Listing and Traversal: list, walk, find, DirectoryStream
Part 11 — FileVisitor and Tree Algorithms: Robust Recursive Operations
Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming
Part 13 — Path Traversal Security: User Input, Uploads, Archives, and Sandboxes
Part 14 — File Attributes: Basic, POSIX, DOS, Owner, ACL
Part 15 — Permissions Model: POSIX, Windows ACL, Containers, and Runtime Identity
Part 16 — FileStore and Filesystem Capacity: Disk Space, Quotas, and Operational Guardrails
Part 17 — WatchService: Filesystem Events Are Hints, Not Truth
Part 18 — File Locking: Advisory, Mandatory, Local, Network, and Cross-Process Coordination
```

Berikutnya:

```text
Part 19 — Memory-Mapped Files in File Workflows
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering](./learn-java-io-file-filesystem-storage-engineering-part-17-watchservice.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 19 — Memory-Mapped Files in File Workflows](./learn-java-io-file-filesystem-storage-engineering-part-19-memory-mapped-files.md)

</div>