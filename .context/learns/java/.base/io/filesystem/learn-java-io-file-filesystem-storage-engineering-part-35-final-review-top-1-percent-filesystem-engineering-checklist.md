# Part 35 — Final Review: Top 1% Filesystem Engineering Checklist

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Scope: Java 8–25  
> Level: Advanced / production engineering / top 1% mental model  
> Focus: correctness, durability, portability, security, performance, observability, testing, and architectural decision-making for file/filesystem workloads

---

## 0. Tujuan Part Ini

Bagian ini adalah penutup seri. Tujuannya bukan menambah API baru, tetapi mengunci cara berpikir.

Setelah 34 bagian sebelumnya, kita sudah membahas:

1. path semantics,
2. file creation,
3. reading/writing,
4. atomic update,
5. copy/move/delete,
6. traversal,
7. symbolic link/hard link,
8. security,
9. metadata/permission,
10. capacity,
11. watcher,
12. locking,
13. mmap,
14. random access,
15. WAL/journaling,
16. checksum/hash,
17. MIME/charset/content detection,
18. ZIP filesystem,
19. custom provider,
20. legacy `java.io.File`,
21. cross-platform behavior,
22. container/Kubernetes runtime,
23. network filesystem/distributed storage,
24. performance,
25. observability,
26. workflow architecture,
27. testing,
28. capstone file intake engine.

Bagian terakhir ini menyatukan semuanya menjadi satu checklist operasional.

Mental model utama:

```text
A file workflow is not correct because it works on your laptop.
It is correct only when it defines invariants under race, crash, permission failure,
capacity pressure, platform differences, provider differences, and operator error.
```

Dalam Java modern, file API utama adalah `java.nio.file`. Package `java.nio.file` mendefinisikan class untuk akses file dan filesystem; atribut file berada di `java.nio.file.attribute`; dan service provider extension berada di `java.nio.file.spi`. Artinya, operasi file Java bukan kontrak tunggal yang lepas dari environment, melainkan operasi yang diterjemahkan melalui `FileSystemProvider` ke filesystem/runtime aktual.

---

## 1. Peta Besar Mental Model Filesystem Engineering

### 1.1 Layer yang selalu terlibat

Setiap operasi file production biasanya melewati layer berikut:

```text
Application logic
  ↓
Java API: Path / Files / FileChannel / FileSystem
  ↓
FileSystemProvider
  ↓
JVM native integration
  ↓
OS kernel / VFS
  ↓
Filesystem implementation
  ↓
Block device / network storage / container volume / object-backed abstraction
```

Kesalahan umum engineer biasa adalah berpikir seperti ini:

```text
Files.write(path, bytes) == bytes pasti aman di disk
Files.exists(path) == file pasti bisa dipakai
Files.move(a, b) == selalu atomic
WatchService event == fakta final
FileLock == distributed lock
Path.normalize() == aman dari traversal attack
```

Engineer yang matang berpikir seperti ini:

```text
Files.write(path, bytes) == request write; durability tergantung flush/force/storage
Files.exists(path) == snapshot observasi; bisa berubah sebelum dipakai
Files.move(a, b) == bisa atomic hanya jika provider/filesystem mendukung
WatchService event == hint; harus direkonsiliasi
FileLock == lock dengan semantics system-dependent
Path.normalize() == lexical cleanup, bukan authorization boundary
```

---

## 2. Golden Rules Top 1% Filesystem Engineering

### Rule 1 — Path bukan string biasa

Path adalah representasi location dalam filesystem tertentu.

Checklist:

- Jangan concat path manual dengan `"/"` atau `"\\"`.
- Gunakan `Path.resolve`.
- Bedakan lexical path operation vs real filesystem operation.
- Jangan menganggap separator sama di semua OS.
- Jangan menganggap path case-sensitive.
- Jangan menganggap root model sama di Linux, Windows, macOS, ZIP filesystem, dan custom provider.

Contoh buruk:

```java
Path p = Path.of(baseDir + "/" + userInput);
```

Contoh lebih benar:

```java
Path p = baseDir.resolve(userInput);
```

Tetapi untuk security, `resolve` saja belum cukup. Lihat Rule 8.

---

### Rule 2 — `exists` bukan permission, lock, atau guarantee

`Files.exists(path)` hanya observasi pada waktu tertentu.

Checklist:

- Jangan lakukan `if exists then use` sebagai mekanisme safety.
- Gunakan operasi atomic seperti `CREATE_NEW` untuk create-if-absent.
- Tangani exception dari operasi aktual.
- Ingat bahwa `exists` dan `notExists` tidak selalu saling negasi karena state bisa unknown.
- Untuk workflow concurrent, desain berdasarkan state transition atomic, bukan pre-check.

Anti-pattern:

```java
if (!Files.exists(target)) {
    Files.write(target, bytes);
}
```

Pattern lebih benar:

```java
try {
    Files.write(target, bytes, StandardOpenOption.CREATE_NEW);
} catch (FileAlreadyExistsException e) {
    // conflict path already exists
}
```

---

### Rule 3 — Atomic create lebih kuat daripada check-then-create

Pembuatan file/directory harus dianggap operasi state transition.

Checklist:

- Untuk file baru yang tidak boleh overwrite, gunakan `CREATE_NEW` atau `Files.createFile`.
- Untuk directory tunggal, gunakan `createDirectory`.
- Untuk nested directory, `createDirectories` boleh membuat sebagian parent sebelum gagal.
- Untuk temporary file, gunakan `createTempFile`, bukan generate nama manual.
- Untuk permission-sensitive file, set permission saat create jika provider mendukung.

Invarian:

```text
A file is claimed only if create operation succeeds atomically.
```

---

### Rule 4 — Open option adalah kontrak state transition

`StandardOpenOption` bukan parameter teknis kecil. Ia menentukan kontrak destructive/non-destructive.

Checklist:

- `READ`: buka untuk baca.
- `WRITE`: buka untuk tulis.
- `CREATE`: buat jika belum ada.
- `CREATE_NEW`: buat hanya jika belum ada, atomic check-and-create.
- `TRUNCATE_EXISTING`: kosongkan file existing saat dibuka untuk write.
- `APPEND`: tulis di akhir file; atomicity append system-dependent.
- `DELETE_ON_CLOSE`: best-effort, jangan jadikan security guarantee.
- `SYNC`: sinkronisasi content dan metadata.
- `DSYNC`: sinkronisasi content.

Pertanyaan wajib sebelum membuka file:

```text
Apakah operasi ini boleh membuat file baru?
Apakah boleh overwrite?
Apakah boleh truncate?
Apakah append harus aman multi-writer?
Apakah durability diperlukan sebelum lanjut?
Apakah file boleh hilang saat close?
```

---

### Rule 5 — Write visibility berbeda dari write durability

Ketika `Files.write` selesai, data mungkin sudah visible untuk proses lain, tetapi belum tentu durable terhadap crash/power loss.

Checklist:

- `flush()` memindahkan data dari buffer Java ke layer bawah.
- `close()` biasanya flush, tetapi durability tetap tergantung OS/storage.
- `FileChannel.force(true)` meminta content dan metadata dipaksa ke storage.
- `FileChannel.force(false)` meminta content dipaksa, metadata tidak harus lengkap.
- `SYNC`/`DSYNC` memberi semantics sync pada setiap update, tetapi mahal.
- Network filesystem dan storage virtualized bisa punya semantics berbeda.

Mental model:

```text
write success       = Java menyerahkan data ke OS/provider
flush success       = Java buffer dikosongkan ke bawah
force success       = request durability ke storage layer
crash consistency   = desain format/workflow tetap valid setelah crash di titik mana pun
```

---

### Rule 6 — Atomic update harus memakai temp file + force + atomic move

Untuk mengganti isi file penting, jangan tulis langsung ke target.

Pattern canonical:

```text
1. Write to temporary file in the same directory.
2. Flush/force temporary file content.
3. Optionally validate temp file.
4. Move temp → target with ATOMIC_MOVE + REPLACE_EXISTING.
5. Ideally force parent directory where platform supports it.
6. Cleanup orphan temp files on recovery.
```

Java sketch:

```java
Path dir = target.getParent();
Path temp = Files.createTempFile(dir, target.getFileName().toString(), ".tmp");

try (FileChannel ch = FileChannel.open(
        temp,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING)) {
    ch.write(ByteBuffer.wrap(bytes));
    ch.force(true);
}

Files.move(temp, target,
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING);
```

Checklist:

- Temp file harus di filesystem/directory yang sama agar atomic rename lebih mungkin.
- Tangani `AtomicMoveNotSupportedException`.
- Non-atomic fallback harus eksplisit dan didokumentasikan.
- Jangan campur atomic update dengan reader yang membaca sebagian file.
- Reader sebaiknya membuka target setelah rename selesai.

Invarian:

```text
At any time, target is either old complete version or new complete version.
Never a half-written version.
```

---

### Rule 7 — Recursive operation harus explicit tentang symlink

Traversal directory tanpa kebijakan link adalah bug menunggu waktu.

Checklist:

- Apakah traversal mengikuti symbolic link?
- Apakah perlu `NOFOLLOW_LINKS`?
- Apakah root directory dipercaya?
- Apakah attacker bisa mengganti file menjadi symlink saat traversal?
- Apakah loop/cycle ditangani?
- Apakah `FileSystemLoopException` dicatat?
- Apakah delete recursive aman dari symlink escape?

Default mental model:

```text
For destructive recursive operations, do not follow links unless there is a very strong reason.
```

---

### Rule 8 — Path containment security membutuhkan real boundary

Untuk user input path:

```text
normalize() is not authorization.
```

Minimal containment pattern:

```java
Path baseReal = baseDir.toRealPath(LinkOption.NOFOLLOW_LINKS);
Path candidate = baseReal.resolve(userInput).normalize();
Path parentReal = candidate.getParent().toRealPath(LinkOption.NOFOLLOW_LINKS);

if (!parentReal.startsWith(baseReal)) {
    throw new SecurityException("Path escapes base directory");
}
```

Tetapi ini pun belum sempurna terhadap race jika attacker bisa mutate directory antara check dan use.

Checklist upload/path traversal:

- Jangan pakai original filename sebagai storage filename.
- Generate server-side random ID.
- Simpan original filename hanya sebagai metadata/display name.
- Batasi panjang nama.
- Batasi character set.
- Tolak `..`, separator, control character, hidden/reserved pattern.
- Validasi extension dengan allowlist.
- Validasi magic number/content signature.
- Validasi size sebelum dan selama processing.
- Jangan extract archive tanpa containment check per entry.
- Jangan izinkan symlink entry escape saat extraction.
- Simpan upload di directory non-executable.

---

## 3. Correctness Checklist

### 3.1 File lifecycle correctness

Untuk setiap file workflow, jawab pertanyaan berikut:

```text
Siapa yang membuat file?
Kapan file dianggap complete?
Siapa yang boleh membaca file?
Siapa yang boleh mengubah file?
Siapa yang boleh menghapus file?
Apa state file saat sedang diproses?
Apa state file saat gagal?
Apa state file setelah sukses?
Apa state file setelah crash?
```

Checklist:

- Ada state machine eksplisit.
- State direpresentasikan oleh directory, extension, manifest, metadata DB, atau kombinasi.
- Tidak ada ambiguous state seperti “file ada tetapi kita tidak tahu sedang diproses atau belum”.
- Ada recovery process.
- Ada idempotency key.
- Ada quarantine untuk poison file.

Contoh state machine:

```text
RECEIVED
  → STAGED
  → VALIDATED
  → PUBLISHED
  → CLAIMED
  → PROCESSING
  → DONE
  → ARCHIVED

Failure branch:
  → QUARANTINED
  → RETRY_WAIT
  → DEAD_LETTER
```

---

### 3.2 Race condition checklist

Cari semua race ini:

```text
exists → create
exists → read
exists → delete
list → process
validate path → open
read attributes → use attributes
watch event → open file
copy complete? → consume
writer finished? → reader sees file
lock acquired? → same JVM thread also writes
```

Untuk setiap race, ubah menjadi:

- atomic create,
- atomic rename,
- claim-by-rename,
- open-and-handle-exception,
- manifest commit marker,
- checksum verification,
- idempotent processing,
- DB/queue coordination.

---

### 3.3 Crash consistency checklist

Simulasikan crash di setiap titik:

```text
Before temp create
After temp create
During write
After write before force
After force before move
During move
After move before metadata update
After metadata update before ack
During cleanup
```

Untuk setiap titik, jawab:

```text
Apa yang terlihat setelah restart?
Apakah ada file orphan?
Apakah file target valid?
Apakah duplicate processing mungkin?
Apakah data loss mungkin?
Apakah recovery bisa deterministic?
```

Top 1% invariant:

```text
Recovery is not an afterthought. Recovery is part of the write protocol.
```

---

## 4. Durability Checklist

### 4.1 Kapan durability benar-benar diperlukan?

Tidak semua file perlu forced durability. Tetapi untuk beberapa kasus, wajib dipikirkan:

- config file penting,
- checkpoint,
- ledger,
- audit log,
- WAL,
- manifest,
- ingestion handoff,
- regulatory evidence,
- irreversible business event,
- file yang menjadi source of truth.

Checklist:

- Apakah kehilangan file setelah success response dapat diterima?
- Apakah kehilangan beberapa record terakhir dapat diterima?
- Apakah duplicate lebih baik daripada loss?
- Apakah consumer bisa replay?
- Apakah file hanya cache?
- Apakah database adalah source of truth?

Jika file adalah source of truth, Anda perlu:

```text
framing + checksum + commit marker + force policy + recovery scanner
```

---

### 4.2 WAL/append-only durability checklist

Untuk append-only file:

- Setiap record punya length prefix.
- Setiap record punya checksum.
- Ada magic/version.
- Ada sequence number.
- Ada transaction/commit marker bila perlu.
- Recovery bisa mendeteksi partial tail.
- Partial tail bisa dipotong dengan aman.
- Rotation/segment punya manifest.
- Compaction idempotent.
- Index bisa dibangun ulang dari log.

Record sketch:

```text
| magic | version | length | sequence | timestamp | payload | checksum |
```

Recovery rule:

```text
Read until first invalid/incomplete record.
Validate checksum.
Truncate invalid tail if policy allows.
Rebuild derived index.
```

---

## 5. Portability Checklist

### 5.1 Java version portability: Java 8–25

Checklist:

- Java 8 tidak punya `Path.of`; gunakan `Paths.get` untuk kompatibilitas Java 8.
- Java 11+ punya `Files.readString` dan `Files.writeString`.
- Java 9+ punya `CRC32C`.
- `java.io.File` masih banyak muncul di library lama.
- `Path.toFile()` hanya portable untuk default provider.
- `Files` API bisa bekerja dengan non-default provider, tetapi tidak semua operation didukung.

Compatibility style:

```java
// Java 8 compatible
Path path = Paths.get("data", "input.txt");

// Java 11+ / modern style
Path path2 = Path.of("data", "input.txt");
```

Design rule:

```text
Application code may use Path.of if minimum runtime supports it.
Library code should prefer receiving Path from caller rather than constructing from global default filesystem.
```

---

### 5.2 OS portability checklist

Linux:

- Usually case-sensitive.
- Delete open file usually unlinks directory entry while handle remains.
- POSIX permissions common.
- Symlink support common.
- Directory fsync possible through native/platform specifics, not always ergonomic in Java.

Windows:

- Commonly case-insensitive, case-preserving.
- Reserved names: `CON`, `PRN`, `AUX`, `NUL`, etc.
- Delete/rename can fail if file is open by another process.
- ACL model differs from POSIX.
- Symlink creation may require privilege/mode.
- Path length issues can appear.

macOS:

- Often case-insensitive by default, but can be case-sensitive.
- Unicode normalization differences can matter.
- POSIX-like permissions plus platform-specific metadata.

Checklist:

- Test on at least Linux and Windows if distributed to developer machines.
- Normalize business identifiers independently of filesystem semantics.
- Do not use filenames as unique keys unless case/Unicode policy is explicit.
- Avoid Windows reserved names.
- Avoid trailing spaces/dots.
- Avoid control characters.
- Avoid assuming delete/rename of open files works.

---

### 5.3 Provider portability checklist

For non-default providers:

- `toFile()` may fail.
- `FileStore` data may be incomplete or unsupported.
- Attribute views may differ.
- `ATOMIC_MOVE` may fail.
- `WatchService` may be unsupported or weak.
- Permissions may not map.
- URI scheme matters.

Rule:

```text
If code receives Path, do not assume it is local disk.
```

Safer library API:

```java
public void process(Path input, Path output) throws IOException {
    // use Path/Files only; do not convert to File unless documented
}
```

Risky library API:

```java
public void process(Path input) throws IOException {
    File f = input.toFile(); // breaks non-default provider
}
```

---

## 6. Security Checklist

### 6.1 File upload checklist

For upload workflows:

- Size limit before accepting.
- Size limit while streaming.
- Server-side generated storage filename.
- Original filename stored as metadata only.
- Extension allowlist.
- MIME treated as hint, not truth.
- Magic number validation.
- Charset decoding controlled.
- Virus/malware scanning if domain requires.
- Content disarm/reconstruction if high-risk docs.
- Store outside web root.
- No execute permission.
- Permission least privilege.
- Quarantine suspicious files.
- Audit accepted/rejected reason.

Storage naming pattern:

```text
/storage/yyyy/mm/dd/<uuid>.bin
/storage/yyyy/mm/dd/<uuid>.meta.json
```

Do not:

```text
/storage/<userOriginalFilename>
```

---

### 6.2 Archive extraction checklist

For ZIP/TAR-like extraction:

- Limit total uncompressed size.
- Limit file count.
- Limit max depth.
- Limit max single file size.
- Reject absolute paths.
- Reject `..` escape.
- Reject or carefully handle symlink entries.
- Normalize and validate each output path.
- Check final parent real path containment.
- Avoid overwrite unless policy allows.
- Extract to temporary staging directory.
- Validate staging tree before publish.
- Publish via atomic rename if possible.

Extraction invariant:

```text
No archive entry may cause a write outside extraction root.
```

---

### 6.3 Symlink/security checklist

- Destructive operations default to `NOFOLLOW_LINKS`.
- Delete recursive does not follow symlinks.
- Upload directories not writable by untrusted users if Java process trusts path structure.
- Real path containment checks are used where needed.
- Directory permissions prevent attacker from replacing checked path.
- For highly sensitive operations, rely on OS sandbox/container policy too.

---

### 6.4 Permission checklist

- Process runs as non-root where possible.
- Directory has least privilege.
- File create permissions are restrictive by default.
- POSIX permission handling is conditional on provider support.
- Windows ACL behavior is separately tested if Windows supported.
- Container `runAsUser`, `runAsGroup`, `fsGroup` configured consciously.
- Read-only root filesystem considered.
- Secrets/config volumes treated as read-only.

---

## 7. Performance Checklist

### 7.1 I/O pattern checklist

Classify workload:

```text
Small file many times?
Large file sequential?
Large file random access?
Metadata-heavy traversal?
Append-only log?
Read-mostly cache?
Write-heavy ingestion?
Network filesystem?
Container ephemeral storage?
```

Different workload, different bottleneck:

| Workload | Likely bottleneck | Better strategy |
|---|---|---|
| Many tiny files | metadata syscalls, directory scaling | batch, shard directories, archive/segment |
| Large sequential read | throughput, page cache | buffered stream, transfer, larger buffer |
| Random access | seek/page fault | FileChannel, mmap carefully |
| Recursive traversal | metadata latency | FileVisitor, batch attrs, avoid extra stat |
| Append log | fsync cost | group commit, segment, batching |
| Network FS | latency/coherency | reduce round trips, avoid locks, local staging |
| Container temp | ephemeral limit | quota guardrail, cleanup, external storage |

---

### 7.2 Buffering checklist

- Avoid byte-by-byte I/O.
- Use buffered stream/reader/writer for text/sequential workloads.
- Avoid `readAllBytes` for unbounded files.
- Use streaming digest for hash.
- Avoid repeated open/close in tight loop.
- Avoid repeated metadata calls for same file when one `readAttributes` can fetch required attributes.
- Use `DirectoryStream` for very large directories when you need controlled iteration.

---

### 7.3 Directory scale checklist

- Do not put millions of files in one directory unless filesystem tested for it.
- Shard by date, hash prefix, tenant, or partition key.
- Avoid using directory listing as primary database query.
- Maintain manifest/index if needed.
- Design cleanup by partition.

Example sharding:

```text
/data/intake/2026/06/18/tenant-a/ab/cd/<uuid>.bin
```

---

### 7.4 Benchmarking checklist

Do not trust naive benchmarks.

Control:

- cold vs warm page cache,
- SSD/HDD/network FS,
- container volume type,
- file size distribution,
- concurrency,
- fsync policy,
- directory size,
- antivirus/security scanner interference,
- OS differences,
- JVM warmup,
- GC allocation pressure,
- measurement of tail latency, not only average.

Measure:

- p50/p95/p99 latency,
- throughput bytes/sec,
- files/sec,
- fsync latency,
- queue depth,
- disk free/inodes,
- error rate by exception type,
- retry count,
- recovery time.

---

## 8. Observability Checklist

### 8.1 Log fields

For file operation logs, include:

```text
correlationId
workflowId
fileId
operation
pathCategory, not necessarily raw sensitive path
providerScheme
fileStore/type if known
sizeBytes
stateFrom/stateTo
durationMs
attempt
exceptionClass
errno/native message if available
thread/process/pod/node
```

Avoid logging:

- full path with tenant PII,
- original filename if it may contain sensitive data,
- file content,
- secrets embedded in path,
- unbounded stack traces for repeated errors.

---

### 8.2 Metrics

Core metrics:

```text
file_operation_total{operation,status,exception}
file_operation_duration_seconds{operation}
file_bytes_read_total
file_bytes_written_total
file_workflow_state_count{state}
file_quarantine_total{reason}
file_retry_total{reason}
file_disk_usable_bytes{store}
file_temp_orphan_count
file_watcher_overflow_total
file_reconciliation_duration_seconds
file_lock_acquire_duration_seconds
file_fsync_duration_seconds
```

Top 1% metric:

```text
recovery_success_total
recovery_failure_total
```

Because recovery is part of the design, not a rare manual operation.

---

### 8.3 Troubleshooting exception map

| Exception | Usual meaning | First investigation |
|---|---|---|
| `NoSuchFileException` | missing path, race, wrong mount | path, deployment, race, cleanup |
| `FileAlreadyExistsException` | conflict, duplicate, non-idempotent create | idempotency, naming, concurrent writer |
| `AccessDeniedException` | permission, open handle, directory policy | UID/GID, ACL, Windows handle, container security |
| `DirectoryNotEmptyException` | recursive delete issue, concurrent create | traversal, mutation, symlink |
| `AtomicMoveNotSupportedException` | provider/filesystem cannot atomic move | same store?, provider?, fallback policy |
| `FileSystemLoopException` | symlink cycle | link strategy, NOFOLLOW_LINKS |
| `MalformedInputException` | charset decode mismatch | encoding policy, binary vs text |
| `ClosedWatchServiceException` | watcher lifecycle issue | shutdown/restart handling |
| `OverlappingFileLockException` | same JVM lock overlap | intra-JVM coordination |

---

## 9. Testing Checklist

### 9.1 Unit/integration test dimensions

Test:

- file exists,
- file missing,
- file already exists,
- parent missing,
- parent is file,
- permission denied,
- empty file,
- huge file,
- partial file,
- corrupt checksum,
- invalid charset,
- symlink input,
- symlink escape,
- hard link if relevant,
- directory loop,
- delete while open,
- rename conflict,
- atomic move unsupported,
- disk nearly full,
- watcher overflow/reconciliation,
- crash recovery.

---

### 9.2 Cross-platform tests

Run CI on:

```text
Linux
Windows
macOS if supported
```

Especially test:

- case sensitivity,
- path separator,
- reserved names,
- delete open file,
- symlink permission,
- hidden file behavior,
- newline and charset assumptions,
- Unicode filename equivalence.

---

### 9.3 Crash testing

Crash testing strategy:

- insert fault points after every state transition,
- kill process,
- restart recovery,
- assert invariant.

Fault points:

```text
after temp create
after partial write
after full write before force
after force before move
after move before metadata update
after metadata update before ack
during quarantine
during cleanup
```

Expected assertion:

```text
No file is lost silently.
No complete file is processed twice without idempotency.
No partial file is published as complete.
Recovery converges.
```

---

## 10. Architecture Decision Checklist: File vs Database vs Queue vs Object Storage

### 10.1 Use file/filesystem when

File is appropriate when:

- payload is naturally file-shaped,
- local staging is needed,
- batch import/export,
- interoperability requires files,
- append-only local log/checkpoint,
- temporary scratch space,
- large blob processing near compute,
- simple single-host workflow.

But file is dangerous as coordination layer across multiple nodes.

---

### 10.2 Use database when

Use database when you need:

- transactional metadata,
- query by state,
- concurrency control,
- uniqueness constraints,
- auditability,
- multi-entity consistency,
- workflow status tracking,
- human review/backoffice operations.

Common hybrid:

```text
File payload in filesystem/object storage
Metadata/state/idempotency in database
Events in queue
```

---

### 10.3 Use queue/event stream when

Use queue/event stream when you need:

- producer-consumer decoupling,
- retry/dead-letter,
- ordered or partitioned processing,
- backpressure,
- multi-consumer distribution,
- observable delivery semantics.

Avoid using directory listing as a poor queue when workload is distributed and high-volume.

---

### 10.4 Use object storage when

Use object storage when you need:

- durable blob storage,
- high availability,
- cross-node access,
- lifecycle policy,
- versioning,
- cheap large object storage,
- CDN/integration.

But remember:

```text
Object storage is not POSIX filesystem.
```

Do not assume:

- atomic rename,
- directory semantics,
- file locks,
- append-in-place,
- POSIX permission,
- WatchService.

---

### 10.5 Use distributed lock service when

Use database/Redis/ZooKeeper/etcd-like lease when:

- multiple nodes coordinate work,
- lock needs TTL/lease,
- owner identity matters,
- failure detection matters,
- lock state must be observable,
- network filesystem lock semantics are uncertain.

File lock is acceptable mostly for:

- local process coordination,
- simple single-host protection,
- legacy interop,
- low-risk tooling.

---

## 11. Top 1% Review Questions

A strong engineer should be able to answer these without guessing.

### 11.1 Path questions

1. Difference between `normalize()` and `toRealPath()`?
2. Why is `Path.startsWith` not enough for untrusted paths unless base is controlled?
3. Why can two different path strings point to same file?
4. What happens with case-insensitive filesystem?
5. Why should library code avoid `Paths.get(...)` from global default filesystem when caller already provides a `Path` anchor?

### 11.2 Operation questions

1. Why is `exists → write` race-prone?
2. What does `CREATE_NEW` guarantee?
3. When can `ATOMIC_MOVE` fail?
4. Is `Files.copy(directory, target)` recursive?
5. Why can `deleteIfExists` still throw?
6. Why can `Files.list` leak resources if not closed?

### 11.3 Durability questions

1. Difference between flush and force?
2. Difference between `SYNC` and `DSYNC`?
3. Why is direct overwrite unsafe for config file update?
4. What happens if crash occurs after temp force but before atomic move?
5. Why might directory metadata durability matter?

### 11.4 Security questions

1. Why is original filename untrusted?
2. Why is MIME type untrusted?
3. How does Zip Slip happen?
4. How can symlink cause delete/extract escape?
5. Why is normalize not enough?

### 11.5 Distributed/runtime questions

1. Why is WatchService not source of truth?
2. Why is FileLock not necessarily distributed-safe?
3. What assumptions break on NFS?
4. What assumptions break on object storage?
5. What changes inside Kubernetes with ephemeral storage and volume permissions?

### 11.6 Observability questions

1. What metrics detect file workflow backlog?
2. What logs allow reconstructing processing timeline?
3. How do you distinguish permission issue from open-handle issue?
4. How do you detect orphan temp files?
5. How do you prove recovery works?

---

## 12. Compact Engineering Checklist

Use this before shipping any file-based feature.

### Correctness

- [ ] File state machine defined.
- [ ] Completion signal explicit.
- [ ] Partial files cannot be consumed.
- [ ] Claiming is atomic.
- [ ] Duplicate processing is idempotent.
- [ ] Recovery process exists.
- [ ] Cleanup process exists.
- [ ] Race conditions reviewed.

### Security

- [ ] User path input constrained.
- [ ] Path traversal blocked.
- [ ] Symlink policy explicit.
- [ ] Original filename not trusted.
- [ ] Extension/MIME/content validation layered.
- [ ] Archive extraction safe.
- [ ] Permission least privilege.
- [ ] Sensitive path/content not logged.

### Durability

- [ ] Direct overwrite avoided for important file.
- [ ] Temp + force + atomic move used where needed.
- [ ] Append format detects partial record.
- [ ] Checksum/hash used where integrity matters.
- [ ] Crash points tested.

### Portability

- [ ] Java 8–25 compatibility considered.
- [ ] Linux/Windows/macOS differences considered.
- [ ] Path separator not hardcoded.
- [ ] Case sensitivity not assumed.
- [ ] Provider capability checked.
- [ ] `Path.toFile()` avoided unless default FS required.

### Runtime

- [ ] Container writable paths explicit.
- [ ] Read-only root filesystem considered.
- [ ] Ephemeral storage limit monitored.
- [ ] Volume permission configured.
- [ ] Network filesystem assumptions reviewed.
- [ ] Object storage not treated as POSIX FS.

### Performance

- [ ] Large files streamed.
- [ ] Small file explosion avoided.
- [ ] Directory sharding considered.
- [ ] Metadata calls batched.
- [ ] fsync policy measured.
- [ ] Cold/warm cache benchmark separated.

### Observability

- [ ] Operation logs structured.
- [ ] Metrics by operation/status/exception.
- [ ] Disk space/inode monitored.
- [ ] Retry/quarantine metrics.
- [ ] Watcher overflow metric.
- [ ] Recovery metrics.

### Testing

- [ ] Temp directory tests.
- [ ] Permission tests.
- [ ] Symlink tests.
- [ ] Cross-platform tests.
- [ ] Crash recovery tests.
- [ ] Large file tests.
- [ ] Corrupt file tests.
- [ ] Concurrent writer/reader tests.

---

## 13. Final Mental Model

If you remember only one thing from the whole series, remember this:

```text
A filesystem is a shared, mutable, failure-prone namespace with provider-specific semantics.
Java gives you powerful abstractions, but not magical guarantees.
Correctness comes from explicit invariants, atomic state transitions, recovery design,
and refusing to trust path strings, watcher events, pre-checks, or platform assumptions.
```

A top-tier engineer does not merely know `Files.readAllBytes` or `Files.write`.

A top-tier engineer knows:

- when not to read all bytes,
- when not to write directly,
- when not to trust existence checks,
- when not to follow links,
- when not to rely on file locks,
- when not to use WatchService as truth,
- when not to store coordination state in directories,
- when not to use filesystem at all.

The strongest filesystem code is boring in production because its edge cases were designed before they occurred.

---

## 14. Series Completion

This is the final part of:

```text
learn-java-io-file-filesystem-storage-engineering
```

Completed parts:

```text
Part 00 — Orientation: Mental Model File, Path, Filesystem, and Storage Boundary
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
Part 19 — Memory-Mapped Files in File Workflows
Part 20 — Random Access and Structured Binary File Layout
Part 21 — Append-Only Files, WAL, Journaling, and Recovery Design
Part 22 — Checksums, Hashes, Integrity, and Deduplication
Part 23 — File Naming, Extension, MIME, Charset, and Content Detection
Part 24 — Archives and Virtual Filesystems: ZIP FileSystem and JAR-Like Access
Part 25 — Custom FileSystemProvider and Pluggable Filesystem Mental Model
Part 26 — Legacy java.io.File: Interop, Migration, and Compatibility
Part 27 — Cross-Platform Filesystem Behavior: Linux, Windows, macOS
Part 28 — Containers, Cloud Runtime, Kubernetes Volumes, and Ephemeral Files
Part 29 — Network Filesystems and Distributed Files: NFS, SMB, EFS, Object Storage Boundary
Part 30 — Performance Engineering: Syscalls, Page Cache, Buffering, Batching, and Directory Scale
Part 31 — Observability and Troubleshooting File Workloads
Part 32 — File Workflow Architecture Patterns
Part 33 — Testing File and Filesystem Code
Part 34 — Capstone: Build a Production-Grade File Intake Engine
Part 35 — Final Review: Top 1% Filesystem Engineering Checklist
```

Status:

```text
SERIES COMPLETE
```

---

## 15. References

- Oracle Java SE 25 API — `java.nio.file` package summary: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html`
- Oracle Java SE 25 API — `Files`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html`
- Oracle Java SE 25 API — `FileSystemProvider`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/spi/FileSystemProvider.html`
- Oracle Java SE 25 API — `StandardOpenOption`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/StandardOpenOption.html`
- Oracle Java SE 25 API — `FileChannel`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html`
- Oracle Java SE 25 API — `FileLock`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileLock.html`
- Oracle Java SE 25 API — `WatchService`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/WatchService.html`
- Oracle Java SE 8 API — `Paths`: `https://docs.oracle.com/javase/8/docs/api/java/nio/file/Paths.html`
- OWASP File Upload Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html`
- Kubernetes Volumes: `https://kubernetes.io/docs/concepts/storage/volumes/`
- Kubernetes Security Context: `https://kubernetes.io/docs/tasks/configure-pod-container/security-context/`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 34 — Build a Production-Grade File Intake Engine](./learn-java-io-file-filesystem-storage-engineering-part-34-capstone-production-grade-file-intake-engine.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 000 — Mental Model Besar Java I/O: Dari Byte, Stream, Channel, Buffer, sampai Data Transfer](../learn-java-io-nio-networking-data-transfer-part-000.md)
