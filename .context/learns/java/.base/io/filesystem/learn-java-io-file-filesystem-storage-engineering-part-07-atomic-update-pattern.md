# Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Target Java: 8–25  
> Fokus: update file yang aman terhadap partial write, crash, concurrent reader, dan filesystem boundary.

---

## 0. Kenapa Part Ini Penting

Banyak engineer berpikir operasi update file adalah operasi sederhana:

```java
Files.write(path, bytes);
```

Untuk file kecil dan non-critical, kadang ini cukup. Tetapi untuk file yang menjadi **state**, **configuration**, **checkpoint**, **manifest**, **index**, **cache metadata**, **job status**, atau **handoff marker**, pendekatan ini bisa berbahaya.

Masalahnya bukan hanya “apakah write berhasil”. Masalah production yang sebenarnya adalah:

1. Apa yang dilihat reader ketika writer sedang menulis?
2. Apa yang terjadi jika JVM mati setelah truncate tetapi sebelum semua bytes tertulis?
3. Apa yang terjadi jika OS crash setelah write return tetapi data masih di page cache?
4. Apa yang terjadi jika target berada di filesystem berbeda?
5. Apa yang terjadi jika `ATOMIC_MOVE` tidak didukung?
6. Apakah replacement file terlihat sebagai satu transisi utuh atau sebagai file setengah jadi?
7. Apakah metadata directory yang menunjuk nama file baru sudah persisted?
8. Apakah rollback mungkin dilakukan?
9. Apakah reader perlu lock?
10. Apakah pattern ini masih benar di container, network filesystem, dan cloud runtime?

Part ini membangun mental model dan pattern yang harus dimiliki engineer yang menulis file workflows secara serius.

---

## 1. Masalah Dasar: In-Place Write Tidak Aman untuk State File

Misalkan ada file konfigurasi:

```text
/app/config/runtime.json
```

Writer melakukan update:

```java
Files.writeString(configPath, newJson, StandardCharsets.UTF_8,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
```

Secara intuitif terlihat benar: file lama diganti dengan isi baru.

Tetapi secara failure model, ada beberapa state buruk:

| Waktu gagal | Kemungkinan hasil |
|---|---|
| Setelah truncate, sebelum write | file kosong |
| Di tengah write | file berisi JSON setengah |
| Setelah write, sebelum close | data belum lengkap/flush belum terjadi |
| Setelah close, sebelum storage persist | data terlihat di OS cache tetapi hilang setelah crash |
| Reader membaca saat write | reader melihat isi campuran/partial |

Jadi invariant “file selalu valid” tidak terjaga.

Untuk file yang dibaca oleh komponen lain, ini fatal. Reader bisa gagal parse, membaca state lama sebagian, atau membuat keputusan bisnis salah.

---

## 2. Target Pattern: Publish by Rename, Not Write in Place

Prinsip utama:

> Jangan update file penting dengan menulis langsung ke path final. Tulis versi baru ke file temporary di directory yang sama, pastikan content selesai, lalu publish dengan atomic move/rename.

Flow dasar:

```text
1. final path:
   runtime.json

2. writer membuat temp file di directory yang sama:
   .runtime.json.12345.tmp

3. writer menulis content lengkap ke temp file

4. writer flush/force temp file jika durability penting

5. writer atomic move temp file ke final path:
   .runtime.json.12345.tmp -> runtime.json

6. reader hanya membaca runtime.json
```

Dengan pola ini, reader idealnya hanya melihat:

```text
old complete file
atau
new complete file
```

Bukan file setengah jadi.

---

## 3. Mental Model: Visibility vs Durability

Atomic update harus memisahkan dua pertanyaan:

### 3.1 Visibility

Visibility menjawab:

> Kapan nama `runtime.json` terlihat menunjuk ke isi baru?

Atomic move membantu di sini. Pada filesystem yang mendukung atomic rename/move, transisi directory entry dari file lama ke file baru terjadi sebagai satu operasi logis.

Reader tidak melihat proses write temp file. Reader hanya melihat final path.

### 3.2 Durability

Durability menjawab:

> Jika machine crash setelah operasi return, apakah data dan directory entry dijamin masih ada setelah reboot?

Ini lebih sulit. `Files.move(..., ATOMIC_MOVE)` berbicara tentang atomicity operasi move, bukan selalu full crash persistence untuk semua layer storage.

Untuk durability, kita perlu memikirkan:

- bytes file sudah dipaksa ke storage atau masih di page cache?
- metadata file sudah dipaksa?
- directory entry hasil rename sudah dipaksa?
- storage device/controller melakukan write cache?
- filesystem journaling mode apa?
- apakah filesystem local atau network?

Pattern top-tier engineer tidak berhenti di “rename atomic”. Ia memisahkan:

```text
atomic visibility != crash durability
```

---

## 4. Java API yang Terlibat

Core API:

```java
java.nio.file.Files
java.nio.file.Path
java.nio.file.StandardCopyOption
java.nio.file.StandardOpenOption
java.nio.channels.FileChannel
```

Operasi penting:

```java
Files.createTempFile(...)
Files.move(..., StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
FileChannel.force(boolean metaData)
Files.deleteIfExists(...)
```

Untuk Java 8–25, pattern ini kompatibel karena API `java.nio.file` dan `FileChannel.force` sudah tersedia sejak era Java 7/8.

---

## 5. Apa Arti `ATOMIC_MOVE` di Java

`StandardCopyOption.ATOMIC_MOVE` berarti:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

Java meminta provider filesystem melakukan move sebagai **atomic file system operation**.

Namun ada batas penting:

1. Tidak semua filesystem/provider mendukung atomic move.
2. Jika tidak bisa atomic, Java dapat melempar `AtomicMoveNotSupportedException`.
3. Atomic move biasanya hanya realistis pada filesystem/file store yang sama.
4. Jika source dan target ada di provider berbeda, atomic move biasanya tidak mungkin.
5. Jika menggunakan `ATOMIC_MOVE`, dokumentasi Java menyatakan opsi lain diabaikan; jika target sudah ada, behavior replace atau fail bisa implementation-specific.

Karena itu, atomic update pattern harus mendesain lokasi temp file dengan benar.

---

## 6. Kenapa Temp File Harus di Directory yang Sama

Ini rule penting:

> Temp file untuk atomic replacement harus dibuat di directory yang sama dengan target final.

Contoh benar:

```text
/var/app/config/runtime.json
/var/app/config/.runtime.json.123.tmp
```

Contoh kurang aman:

```text
/tmp/runtime.json.tmp
/var/app/config/runtime.json
```

Alasannya:

1. Directory yang sama biasanya berada di filesystem/file store yang sama.
2. Rename dalam directory yang sama biasanya lebih mungkin atomic.
3. Permission, mount, quota, dan ownership lebih konsisten.
4. Cross-filesystem move bisa berubah menjadi copy-delete atau gagal.
5. `ATOMIC_MOVE` lintas filesystem biasanya tidak didukung.

Atomic update bukan sekadar “pakai temp file”. Temp file harus berada di tempat yang memungkinkan rename atomic.

---

## 7. Minimal Atomic Visibility Pattern

Untuk kasus di mana kita hanya butuh reader tidak melihat partial file, tetapi tidak mengejar durability maksimum:

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class AtomicTextWriter {

    public static void writeAtomically(Path target, String content) throws IOException {
        Path dir = target.toAbsolutePath().getParent();
        String fileName = target.getFileName().toString();

        Path temp = Files.createTempFile(dir, "." + fileName + ".", ".tmp");
        boolean moved = false;

        try {
            Files.writeString(temp, content, StandardCharsets.UTF_8);

            Files.move(temp, target,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);

            moved = true;
        } finally {
            if (!moved) {
                Files.deleteIfExists(temp);
            }
        }
    }
}
```

Catatan Java 8:

`Files.writeString` belum tersedia di Java 8. Gunakan:

```java
Files.write(temp, content.getBytes(StandardCharsets.UTF_8));
```

atau:

```java
try (BufferedWriter writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
    writer.write(content);
}
```

Pattern ini menjaga visibility atomic jika filesystem mendukung `ATOMIC_MOVE`.

Tetapi pattern ini belum cukup untuk durability keras karena tidak melakukan `FileChannel.force`.

---

## 8. Production Pattern dengan Force File Content

Jika file adalah state penting, kita perlu memaksa bytes temp file ke storage sebelum publish.

Contoh:

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

public final class DurableAtomicWriter {

    public static void writeUtf8(Path target, String content) throws IOException {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        writeBytes(target, bytes);
    }

    public static void writeBytes(Path target, byte[] bytes) throws IOException {
        Path absoluteTarget = target.toAbsolutePath();
        Path dir = absoluteTarget.getParent();
        String fileName = absoluteTarget.getFileName().toString();

        if (dir == null) {
            throw new IllegalArgumentException("Target must have a parent directory: " + target);
        }

        Path temp = Files.createTempFile(dir, "." + fileName + ".", ".tmp");
        boolean moved = false;

        try {
            try (FileChannel channel = FileChannel.open(temp,
                    StandardOpenOption.WRITE,
                    StandardOpenOption.TRUNCATE_EXISTING)) {

                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) {
                    channel.write(buffer);
                }

                // true = force content and metadata for the temp file.
                // For many state-file use cases, true is a safer default.
                channel.force(true);
            }

            Files.move(temp, absoluteTarget,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);

            moved = true;
        } finally {
            if (!moved) {
                Files.deleteIfExists(temp);
            }
        }
    }
}
```

Important details:

1. Use explicit `FileChannel` when you need `force`.
2. Write in a loop because channel write is not semantically guaranteed to write all bytes in one call.
3. Force temp file before move.
4. Cleanup temp only if move did not happen.
5. Place temp file in the same directory as target.

---

## 9. Why Force Before Move?

Suppose we write temp file:

```text
.runtime.json.tmp
```

Then immediately rename to:

```text
runtime.json
```

If OS crashes after rename but before dirty pages are written, final path may exist but content durability is not guaranteed depending on OS/filesystem/storage behavior.

`channel.force(true)` asks Java/OS to force updates to the file's storage device.

With `metaData = true`, Java requests both file content and metadata to be written. With `false`, only content updates are requested. The actual behavior may depend on OS/filesystem.

For state replacement, `true` is often preferable before move because the newly created temp file has metadata too.

---

## 10. The Hard Part: Directory fsync

On POSIX-like systems, rename changes a directory entry. To make the rename itself durable across crash, robust systems often fsync the containing directory after rename.

Conceptually:

```text
1. write temp file
2. fsync temp file
3. rename temp -> target
4. fsync parent directory
```

Java standard API does not provide a clean, portable, first-class `fsyncDirectory(Path)` method.

Some platforms allow opening a directory with `FileChannel.open(dir, READ)` and calling `force(true)`, but this is not portable and may fail on some systems/providers.

A best-effort implementation:

```java
static void forceDirectoryBestEffort(Path dir) throws IOException {
    try (FileChannel channel = FileChannel.open(dir, StandardOpenOption.READ)) {
        channel.force(true);
    }
}
```

But treat it as best-effort, not universal Java portability.

A production-grade implementation often does:

```java
try {
    forceDirectoryBestEffort(dir);
} catch (IOException | UnsupportedOperationException e) {
    // Log at debug/warn depending on durability requirement.
    // Decide whether this environment requires hard-fail or accepts best-effort.
}
```

Top-tier mental model:

```text
File fsync persists file content/metadata.
Directory fsync persists name/link changes.
Java can express file force portably.
Directory force is provider/platform-dependent.
```

---

## 11. Full Best-Effort Durable Atomic Replace

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Objects;

public final class AtomicReplace {

    private AtomicReplace() {
    }

    public static void replace(Path target, byte[] content) throws IOException {
        Objects.requireNonNull(target, "target");
        Objects.requireNonNull(content, "content");

        Path absoluteTarget = target.toAbsolutePath();
        Path dir = absoluteTarget.getParent();

        if (dir == null) {
            throw new IllegalArgumentException("Target must have parent directory: " + target);
        }

        Files.createDirectories(dir);

        String fileName = absoluteTarget.getFileName().toString();
        Path temp = Files.createTempFile(dir, "." + fileName + ".", ".tmp");

        boolean published = false;

        try {
            writeAndForce(temp, content);

            try {
                Files.move(temp, absoluteTarget,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                // For critical state, do not silently fall back to non-atomic move.
                // Make the caller/environment choose explicitly.
                throw e;
            }

            published = true;

            forceDirectoryBestEffort(dir);
        } finally {
            if (!published) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException cleanupFailure) {
                    // In a library, attach as suppressed or log externally.
                    // Here we preserve the original failure by not masking it.
                }
            }
        }
    }

    private static void writeAndForce(Path temp, byte[] content) throws IOException {
        try (FileChannel channel = FileChannel.open(temp,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING)) {

            ByteBuffer buffer = ByteBuffer.wrap(content);
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }

            channel.force(true);
        }
    }

    private static void forceDirectoryBestEffort(Path dir) throws IOException {
        try (FileChannel channel = FileChannel.open(dir, StandardOpenOption.READ)) {
            channel.force(true);
        } catch (UnsupportedOperationException e) {
            // Some providers do not support opening directories this way.
            // Depending on your durability requirement, either ignore, log, or rethrow.
        }
    }
}
```

This version deliberately does **not** fall back automatically when `ATOMIC_MOVE` is unsupported.

Why?

Because automatic fallback may silently break the most important invariant:

```text
reader must never observe partial replacement
```

For critical state, fail fast is better than silently becoming unsafe.

---

## 12. Should We Use `REPLACE_EXISTING` with `ATOMIC_MOVE`?

This is subtle.

A common call is:

```java
Files.move(temp, target,
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING);
```

But Java documentation states that when `ATOMIC_MOVE` is specified, other options are ignored. If target exists, whether existing file is replaced or move fails can be implementation-specific.

In practice, many default filesystems replace atomically. But a truly portable library should not assume every provider behaves the same.

Design options:

### Option A — Require Replace Support, Fail Otherwise

Use `ATOMIC_MOVE, REPLACE_EXISTING`, test on supported runtime, and fail if provider does not behave as required.

Good for controlled production platforms.

### Option B — Versioned File + Atomic Pointer

Instead of replacing data file directly:

```text
config-000001.json
config-000002.json
CURRENT
```

Update process:

```text
1. Write config-000002.json
2. Force file
3. Atomic replace CURRENT with text "config-000002.json"
```

Reader reads `CURRENT`, then reads immutable version file.

This is more complex but avoids direct replacement of large data files.

### Option C — Create-New Publish

If you never replace an existing target:

```java
Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
```

This is useful for handoff/inbox workflows where each file has a unique name.

---

## 13. Failure Matrix

Assume target initially contains valid old content:

```text
runtime.json = OLD
```

Writer wants to publish:

```text
runtime.json = NEW
```

Pattern:

```text
write temp -> force temp -> atomic move temp to target -> force directory best-effort
```

| Failure point | Expected state | Reader impact |
|---|---|---|
| Before temp create | `runtime.json = OLD` | sees old valid file |
| After temp create, before write | old target + temp garbage/empty | reader ignores temp |
| During temp write | old target + partial temp | reader ignores temp |
| After temp write, before force | old target + complete temp maybe not durable | reader ignores temp |
| After force, before move | old target + durable temp | reader sees old |
| During atomic move | old or new, not partial | reader sees valid file |
| After move, before directory force | new visible; crash durability depends on FS | reader sees new if system alive |
| After directory force | new visible and more durable | reader sees new |

This matrix is the heart of the pattern.

The key invariant:

```text
The final path is never intentionally written in place.
```

Therefore a reader of the final path should not observe a partial write caused by the writer.

---

## 14. Reader Design: How Should Readers Read Atomically Updated Files?

A reader can usually be simple:

```java
byte[] bytes = Files.readAllBytes(target);
```

But robust readers should consider:

1. File may not exist yet.
2. File may be replaced between open and read.
3. File may be deleted by cleanup or deployment.
4. Content may be old or new.
5. Content validity still needs validation.
6. Atomic move prevents partial writer visibility, but not logical corruption from bad content.

Better reader:

```java
public static Config readConfig(Path path) throws IOException {
    byte[] bytes = Files.readAllBytes(path);
    Config config = parseConfig(bytes);
    validateConfig(config);
    return config;
}
```

Important:

```text
Atomic file replacement protects physical completeness.
It does not prove semantic correctness.
```

If bad JSON is fully written and atomically moved, readers will atomically see bad JSON. Therefore validate before publish where possible.

---

## 15. Validate Before Publish

For config/state files, do this:

```text
1. Generate content in memory.
2. Validate content structurally.
3. Write temp file.
4. Optionally read back and validate temp file.
5. Force temp file.
6. Atomic move.
```

Example:

```java
String json = serialize(config);
Config parsed = parse(json);
validate(parsed);
AtomicReplace.replace(target, json.getBytes(StandardCharsets.UTF_8));
```

For binary files:

- include magic number
- include version
- include length
- include checksum
- include commit marker if append-like
- validate before publishing

---

## 16. Why `Files.write(target, bytes)` with `SYNC` Is Not Enough

You might think:

```java
Files.write(target, bytes,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.SYNC);
```

This improves durability of writes, but it does not solve reader visibility during update.

Problems:

1. Target can be truncated before new content is fully written.
2. Reader can observe empty/partial file.
3. Crash after truncate can destroy old valid state.
4. If content generation is wrong, target is overwritten directly.

`SYNC` helps persistence of operations performed. It does not transform an in-place update into atomic replacement.

---

## 17. Why Locking Alone Is Not Enough

Another tempting approach:

```text
writer locks file
writer truncates file
writer writes file
writer unlocks
```

This only works if every reader obeys the same lock protocol and if filesystem lock behavior is reliable in the environment.

Problems:

1. File locks are often advisory.
2. Some readers may ignore locks.
3. Other languages/tools may not participate.
4. Network filesystem locks may behave differently.
5. Locking does not automatically solve crash recovery after truncate.

Atomic replace is usually a better default than in-place write protected by advisory lock.

Locks may still be useful for coordinating multiple writers, but they should not be your only protection against partial reads.

---

## 18. Multi-Writer Problem

Atomic move protects the final path from partial visibility. It does not automatically decide which writer wins.

If two writers concurrently update same target:

```text
writer A writes temp A
writer B writes temp B
writer A moves temp A -> target
writer B moves temp B -> target
```

Final result may be B, even if A started first.

This is last-writer-wins.

To avoid accidental overwrite, use one of these strategies:

### 18.1 Single Writer by Architecture

Only one component owns the file.

Best when possible.

### 18.2 External Coordination

Use DB row lock, Redis lock, leader election, or application-level coordinator.

### 18.3 Compare-and-Swap by Version

Store version inside file:

```json
{
  "version": 42,
  "payload": {...}
}
```

Writer reads version 42 and writes version 43 only if no other writer updated.

But plain filesystem does not provide portable CAS replace by content. You need additional locking or versioned filenames.

### 18.4 Versioned Immutable Files

Write immutable version files:

```text
state-000042.json
state-000043.json
state-000044.json
CURRENT
```

Then coordinate update of `CURRENT`.

This makes recovery and audit easier.

---

## 19. Large File Replacement

For large files, atomic replacement is still useful, but cost changes:

```text
write large temp -> force large temp -> rename
```

Consider:

1. Need disk space for old + new simultaneously.
2. Temp file must be on same filesystem.
3. Force can be expensive.
4. If readers hold old file handle, they may continue reading old content after rename on Unix-like systems.
5. On Windows, replacing files with open handles may fail depending on sharing mode/provider behavior.
6. For huge files, prefer immutable versioned files and pointer/manifest update.

Pattern for large dataset:

```text
/data/snapshot-2026-06-18-001.bin
/data/snapshot-2026-06-18-002.bin
/data/CURRENT
```

Update only `CURRENT` atomically.

This avoids replacing huge data file names repeatedly and makes rollback easy.

---

## 20. Manifest Pattern

When publishing multiple files, direct atomic replacement is harder because filesystem rename is atomic for one path, not a group of unrelated paths.

Use manifest:

```text
release-001/
  users.dat
  orders.dat
  index.dat
  manifest.json
release-002/
  users.dat
  orders.dat
  index.dat
  manifest.json
CURRENT
```

Publish process:

```text
1. Write all files under release-002.tmp/
2. Validate all files.
3. Rename release-002.tmp -> release-002
4. Atomically update CURRENT to point to release-002
```

Reader:

```text
1. Read CURRENT
2. Open release directory named by CURRENT
3. Read manifest
4. Validate expected files/checksums
```

This pattern appears in search index deployment, static asset release, ML model deployment, local cache snapshot, report export bundles, and batch file handoff.

---

## 21. Handoff Pattern: Complete File Visibility

For file ingestion pipelines, writer should not write directly into an inbox that consumers scan.

Bad:

```text
/inbox/customer.csv   // writer is still writing this
```

Good:

```text
/staging/customer.csv.tmp
/inbox/customer.csv
```

Flow:

```text
1. Writer writes to staging or hidden temp file.
2. Writer validates and closes file.
3. Writer moves file atomically into inbox.
4. Consumer scans only inbox final files.
```

If staging and inbox are same filesystem, atomic move gives consumers complete-file visibility.

Common variation:

```text
/inbox/.customer.csv.uploading
/inbox/customer.csv
```

This keeps temp in same directory but hidden/ignored by consumer.

---

## 22. Hidden Temp File Naming Strategy

Use names consumers can safely ignore:

```text
.<target-name>.<random>.tmp
```

Examples:

```text
.runtime.json.839201.tmp
.customer.csv.102938.tmp
.index.dat.aa73f.tmp
```

Rules:

1. Prefix with dot on Unix-like systems to reduce accidental visibility.
2. Suffix with `.tmp` or application-specific extension.
3. Include randomness to avoid collision.
4. Do not derive temp names solely from timestamp.
5. Do not let external user control full temp path.
6. Cleanup stale temp files carefully.

`Files.createTempFile(dir, prefix, suffix)` is preferred over manual random name generation.

---

## 23. Cleanup of Stale Temp Files

Atomic update can leave temp files after crash:

```text
.runtime.json.123.tmp
```

This is expected and usually safe because final path remains old or new valid version.

Cleanup strategy:

```text
1. On startup or scheduled job, scan known directories.
2. Match only your own temp naming pattern.
3. Only delete temp files older than safe threshold.
4. Never recursively delete broad directories without root guard.
5. Log count and size cleaned.
```

Example:

```java
static void cleanupOldTemps(Path dir, String targetName) throws IOException {
    long cutoffMillis = System.currentTimeMillis() - 24L * 60 * 60 * 1000;

    try (var stream = Files.newDirectoryStream(dir,
            "." + targetName + ".*.tmp")) {
        for (Path temp : stream) {
            try {
                if (Files.getLastModifiedTime(temp).toMillis() < cutoffMillis) {
                    Files.deleteIfExists(temp);
                }
            } catch (IOException ignored) {
                // Log in production; another process may be using it.
            }
        }
    }
}
```

Java 8 note: `var` is unavailable. Use:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, pattern)) {
    ...
}
```

---

## 24. Exception Handling Strategy

Do not flatten all exceptions into “failed to write file”. Classify failures.

| Exception | Meaning |
|---|---|
| `AccessDeniedException` | permission, open handle, ACL, read-only mount |
| `NoSuchFileException` | parent missing, path disappeared, race |
| `FileAlreadyExistsException` | collision or replacement unsupported |
| `AtomicMoveNotSupportedException` | provider/filesystem cannot perform atomic move |
| `FileSystemException` | generic filesystem-level detail with file/reason |
| `IOException` | catch-all I/O failure |

For production, include in logs:

- target path logical name, not sensitive raw path if multi-tenant
- temp path if safe
- operation phase
- byte count
- filesystem/store if known
- elapsed time
- exception class
- exception reason

Avoid logging file content.

---

## 25. Operation Phases for Observability

Model atomic update as phases:

```text
CREATE_TEMP
WRITE_TEMP
FORCE_TEMP
VALIDATE_TEMP
MOVE_ATOMIC
FORCE_DIRECTORY
CLEANUP_TEMP
```

Metrics:

```text
file.atomic_replace.count
file.atomic_replace.failure.count
file.atomic_replace.bytes
file.atomic_replace.duration
file.atomic_replace.force.duration
file.atomic_replace.move.duration
file.atomic_replace.cleanup.failure.count
file.atomic_replace.atomic_move_not_supported.count
```

Structured log example:

```json
{
  "event": "file_atomic_replace_failed",
  "phase": "MOVE_ATOMIC",
  "target": "runtime.json",
  "bytes": 48291,
  "exception": "AtomicMoveNotSupportedException",
  "message": "Atomic move between providers is not supported"
}
```

This makes incident diagnosis much faster.

---

## 26. Fallback Strategy: When `ATOMIC_MOVE` Is Unsupported

There is no universal safe fallback that preserves the same invariant.

Options:

### 26.1 Hard Fail

For critical file:

```text
If atomic move unsupported, fail startup/deployment/job.
```

This is often correct.

### 26.2 Environment Validation at Startup

Test whether atomic move works in the configured directory:

```text
create test file -> atomic move -> delete
```

If unsupported, fail fast before handling real workload.

### 26.3 Versioned Immutable Files

Avoid replacing existing file. Write unique file names and atomically publish small pointer file.

### 26.4 Database/Object Store Alternative

If filesystem cannot provide required semantics, do not force it. Use a storage system with stronger or more appropriate guarantees.

### 26.5 Non-Atomic Move with Maintenance Window

Accept only if:

- no concurrent readers
- file is non-critical
- failure can be repaired
- operation is monitored
- partial state is acceptable

Never silently degrade for critical state.

---

## 27. Startup Capability Probe

In controlled applications, verify capability early.

```java
public static void verifyAtomicMoveSupported(Path dir) throws IOException {
    Files.createDirectories(dir);

    Path source = Files.createTempFile(dir, ".atomic-probe-", ".tmp");
    Path target = source.resolveSibling(source.getFileName().toString() + ".moved");

    try {
        Files.write(source, new byte[] {1, 2, 3});
        Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
    } finally {
        Files.deleteIfExists(source);
        Files.deleteIfExists(target);
    }
}
```

But remember:

```text
A startup probe proves this environment supported this operation at that time.
It does not prove every future move under every condition will succeed.
```

Still, it catches many deployment misconfigurations early.

---

## 28. Atomic Replace and Symlinks

If `target` is a symlink, replacement semantics can be surprising.

For move operations, Java documentation states that if the target exists and is a symbolic link, replacement replaces the symbolic link itself, not the link target.

This can be good or bad depending on intent.

Security-sensitive code should decide explicitly:

1. Are symlink targets allowed?
2. Should target final path be inside a trusted directory?
3. Should target path be resolved with `toRealPath` before update?
4. Is there a symlink race between validation and move?
5. Could attacker replace parent directory or target path?

For untrusted paths, atomic update alone is not enough. Combine with path containment and permission strategy from later security parts.

---

## 29. Atomic Move Is Not a Transaction

Atomic move gives atomicity for one filesystem operation.

It does not provide:

- multi-file transaction
- automatic rollback
- semantic validation
- distributed consensus
- multi-node locking
- cross-filesystem atomicity
- guaranteed reader refresh
- automatic directory durability on every platform

Do not overgeneralize.

Correct mental model:

```text
Atomic move is a sharp primitive.
A transaction protocol is a larger design built from primitives.
```

---

## 30. Interaction with Readers Holding Open Handles

Suppose reader opens `runtime.json`, then writer replaces it atomically.

What happens to reader?

Often:

- Reader with already-open handle continues reading the old file object.
- New opener sees the new file by name.

This is especially common on Unix-like systems.

Implication:

```text
Atomic replacement changes what future path lookup sees.
It does not necessarily mutate existing open handles.
```

This is usually good: existing readers are not disrupted mid-read.

But if you expect all readers to instantly see new content, you need application-level reload signaling/version checking.

---

## 31. Windows Considerations

Windows filesystem semantics can differ:

1. Replacing a file that another process has open may fail depending on sharing flags.
2. Deleting/moving open files can behave differently from Unix.
3. Antivirus/indexing tools can briefly hold handles.
4. Directory opening for force may fail.
5. Some path and permission rules differ.

Therefore:

- test atomic replacement on Windows if supporting Windows
- classify `AccessDeniedException` carefully
- implement retry only where safe
- avoid assuming Unix unlink semantics

---

## 32. Container and Kubernetes Considerations

Atomic update inside containers depends on the mounted filesystem.

Cases:

| Location | Notes |
|---|---|
| writable container layer | ephemeral, may disappear on restart |
| `emptyDir` | pod-local, lifecycle tied to pod |
| PVC | depends on storage class/provider |
| ConfigMap volume | often updated by kubelet using symlink-like projection; do not write to it |
| Secret volume | usually read-only projection |
| network-backed volume | different atomicity/latency behavior |

In Kubernetes:

1. Do not assume every mounted volume supports same atomic move semantics.
2. Probe capability for configured directories.
3. Treat ConfigMap/Secret projected volumes as read-only application inputs.
4. For app-owned state, use proper writable volume.
5. For multi-pod writers, filesystem atomic move is not enough; use external coordination.

---

## 33. Network Filesystem Considerations

Network filesystems can weaken assumptions:

- rename may be atomic on server but client cache visibility can lag
- locks may be unreliable or differently configured
- metadata propagation can be delayed
- fsync semantics may be expensive or not equivalent to local disk
- watchers may miss events or behave inconsistently

If multiple nodes coordinate via files on network filesystem, be conservative.

Better alternatives for distributed coordination:

- database row/version
- message queue
- object storage with conditional writes
- distributed lock service
- leader election

Filesystem atomic update is strongest as a local single-host primitive.

---

## 34. Atomic Update for JSON Config Example

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

public final class ConfigRepository {

    private final Path configPath;

    public ConfigRepository(Path configPath) {
        this.configPath = configPath;
    }

    public void save(AppConfig config) throws IOException {
        String json = Json.encodePretty(config);

        // Validate before publish.
        AppConfig parsed = Json.decode(json, AppConfig.class);
        validate(parsed);

        AtomicReplace.replace(configPath, json.getBytes(StandardCharsets.UTF_8));
    }

    public AppConfig load() throws IOException {
        byte[] bytes = java.nio.file.Files.readAllBytes(configPath);
        AppConfig config = Json.decode(new String(bytes, StandardCharsets.UTF_8), AppConfig.class);
        validate(config);
        return config;
    }

    private static void validate(AppConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("config is null");
        }
        if (config.version() <= 0) {
            throw new IllegalArgumentException("invalid config version");
        }
    }
}
```

This example separates:

```text
serialization correctness
validation correctness
atomic physical publish
reader validation
```

That separation is what makes the design robust.

---

## 35. Atomic Update for Checkpoint File

Checkpoint file example:

```json
{
  "jobId": "billing-import-2026-06-18",
  "lastProcessedOffset": 18492012,
  "updatedAt": "2026-06-18T11:30:00Z"
}
```

Invariant:

```text
Checkpoint file must always be parseable.
It may be old, but it must not be partial.
```

Atomic update is perfect for this.

However, decide business semantics:

- Is old checkpoint after crash acceptable?
- Does job processing need idempotency?
- Could checkpoint advance before side effect commits?
- Should checkpoint include checksum or source file identity?

Atomic file update protects the checkpoint file. It does not solve distributed exactly-once processing by itself.

---

## 36. Atomic Update for Cache Index

A local cache may have:

```text
cache/
  data/
    sha256-a.bin
    sha256-b.bin
  index.json
```

Update flow:

```text
1. Write new data blobs under content-addressed immutable names.
2. Force important blobs if needed.
3. Generate index.json referencing blobs.
4. Validate referenced blobs exist and hashes match.
5. Atomic replace index.json.
```

Reader uses index as source of truth.

This design is robust because index publication is a small atomic operation, while data files are immutable.

---

## 37. Atomic Update for Report Export

For export workflows:

Bad:

```text
/reports/monthly.csv   // generated directly
```

Good:

```text
/reports/.monthly.csv.tmp
/reports/monthly.csv
```

Even better:

```text
/reports/monthly-2026-06.csv.tmp
/reports/monthly-2026-06.csv
/reports/monthly-2026-06.csv.sha256
/reports/monthly-2026-06.manifest.json
```

Publish manifest last.

Consumers should only consume files with complete manifest.

---

## 38. Retry Strategy

Retries can help with transient failures, but be careful.

Safe to retry:

- temp file creation after random collision
- force after transient I/O? maybe, depends on error
- move after transient Windows handle issue? sometimes
- cleanup delete

Unsafe or suspicious to retry blindly:

- permission denied
- disk full
- atomic move unsupported
- parent path replaced by symlink
- repeated access denied from security policy

Retry policy should include:

```text
max attempts
small backoff
phase-specific classification
no retry for deterministic unsupported operation
observability
```

---

## 39. Disk Full Behavior

Atomic replacement needs temporary extra space.

If old file is 1GB and new file is 1GB, you may need roughly 2GB plus metadata overhead during update.

Failure model:

```text
write temp fails -> old target remains valid
```

This is a major advantage over in-place update.

But you still need:

- capacity monitoring
- temp cleanup
- quota awareness
- clear exception handling
- alerting

---

## 40. Security Considerations

Atomic update code can still be insecure if target path is attacker-controlled.

Security checklist:

1. Resolve target under trusted base directory.
2. Do not allow absolute user-supplied target path.
3. Normalize and validate path containment.
4. Be careful with symlinks.
5. Do not expose temp file names as user-controlled.
6. Set restrictive permissions at create time where needed.
7. Avoid world-readable temp files for secrets.
8. Never log sensitive content.
9. Consider owner/permission validation before update.
10. Treat archive extraction separately; atomic move does not fix Zip Slip.

Permissions and path traversal receive dedicated parts later, but this pattern must already be designed with them in mind.

---

## 41. Java 8–25 Compatibility Notes

| Feature | Java 8 | Java 11+ / 25 |
|---|---:|---:|
| `Path` | yes | yes |
| `Files.move` | yes | yes |
| `StandardCopyOption.ATOMIC_MOVE` | yes | yes |
| `FileChannel.force` | yes | yes |
| `Files.writeString` | no | yes |
| `Path.of` | no | yes |
| `var` | no | yes, Java 10+ local variable inference |

For Java 8-compatible examples:

Use:

```java
Paths.get("...")
Files.write(path, bytes)
```

Instead of:

```java
Path.of("...")
Files.writeString(path, text)
```

---

## 42. Top 1% Engineering Heuristics

Use atomic update when:

- file must always be complete
- readers may read while writer updates
- old state is better than corrupt state
- file is a checkpoint/config/index/manifest
- file is used as handoff marker
- crash recovery matters

Avoid direct in-place write when:

- file has independent readers
- parseability matters
- update is not trivially recoverable
- write may be interrupted
- file is larger than tiny throwaway content

Prefer immutable + pointer pattern when:

- file is large
- multiple files must be published consistently
- rollback matters
- audit/history matters
- readers can tolerate versioned directory structure

Hard fail when:

- `ATOMIC_MOVE` unsupported but atomicity is required
- directory is not writable
- target path violates containment
- filesystem semantics are unknown for critical state

---

## 43. Anti-Patterns

### 43.1 Write Final Path Directly

```java
Files.write(target, bytes, TRUNCATE_EXISTING);
```

Bad for critical state.

### 43.2 Temp File in `/tmp`, Then Move to Final

```text
/tmp/file.tmp -> /app/state/file.json
```

May cross filesystem boundary.

### 43.3 Silent Fallback from Atomic to Non-Atomic

```java
try {
    atomicMove();
} catch (AtomicMoveNotSupportedException e) {
    Files.move(temp, target, REPLACE_EXISTING); // dangerous silent degradation
}
```

Bad unless explicitly accepted by requirements.

### 43.4 Trusting `close()` as Full Durability

Close may flush Java buffers and OS resources, but crash persistence semantics require deeper understanding.

### 43.5 Assuming Rename Solves Multi-Writer Coordination

Atomic move does not prevent last-writer-wins.

### 43.6 Publishing Before Validation

Atomic bad data is still bad data.

---

## 44. Practical Decision Table

| Use case | Recommended pattern |
|---|---|
| Small config file | temp + force + atomic move |
| Checkpoint file | temp + force + atomic move + idempotent processing |
| Large snapshot | immutable version file + atomic pointer |
| Multi-file release | versioned directory + manifest + atomic pointer |
| Upload handoff | write hidden temp + atomic move into inbox |
| Distributed multi-node update | external coordination + atomic local publish |
| Non-critical cache | temp + atomic move, force optional |
| Secret file | restrictive permissions at create + force + atomic move |
| Network filesystem critical state | validate semantics or avoid filesystem coordination |

---

## 45. Production-Grade Utility: Java 8 Compatible Version

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Objects;

public final class Java8AtomicFileWriter {

    private Java8AtomicFileWriter() {
    }

    public static void replace(Path target, byte[] content) throws IOException {
        Objects.requireNonNull(target, "target");
        Objects.requireNonNull(content, "content");

        Path absoluteTarget = target.toAbsolutePath();
        Path dir = absoluteTarget.getParent();
        if (dir == null) {
            throw new IllegalArgumentException("Target must have a parent: " + target);
        }

        Files.createDirectories(dir);

        String fileName = absoluteTarget.getFileName().toString();
        Path temp = Files.createTempFile(dir, "." + fileName + ".", ".tmp");

        boolean moved = false;
        IOException failure = null;

        try {
            writeFullyAndForce(temp, content);
            moveAtomically(temp, absoluteTarget);
            moved = true;
            forceDirectoryIfSupported(dir);
        } catch (IOException e) {
            failure = e;
            throw e;
        } finally {
            if (!moved) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException cleanup) {
                    if (failure != null) {
                        failure.addSuppressed(cleanup);
                    } else {
                        throw cleanup;
                    }
                }
            }
        }
    }

    private static void writeFullyAndForce(Path temp, byte[] content) throws IOException {
        FileChannel channel = FileChannel.open(temp,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING);
        try {
            ByteBuffer buffer = ByteBuffer.wrap(content);
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }
            channel.force(true);
        } finally {
            channel.close();
        }
    }

    private static void moveAtomically(Path source, Path target) throws IOException {
        try {
            Files.move(source, target,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            throw e;
        }
    }

    private static void forceDirectoryIfSupported(Path dir) throws IOException {
        FileChannel channel = null;
        try {
            channel = FileChannel.open(dir, StandardOpenOption.READ);
            channel.force(true);
        } catch (UnsupportedOperationException ignored) {
            // Provider does not support opening/forcing directory.
        } finally {
            if (channel != null) {
                channel.close();
            }
        }
    }

    public static void cleanupOldTemps(Path dir, String targetName, long olderThanMillis) throws IOException {
        long cutoff = System.currentTimeMillis() - olderThanMillis;
        String pattern = "." + targetName + ".*.tmp";

        DirectoryStream<Path> stream = Files.newDirectoryStream(dir, pattern);
        try {
            for (Path candidate : stream) {
                try {
                    if (Files.getLastModifiedTime(candidate).toMillis() < cutoff) {
                        Files.deleteIfExists(candidate);
                    }
                } catch (IOException ignored) {
                    // Log in real code.
                }
            }
        } finally {
            stream.close();
        }
    }
}
```

---

## 46. Production Checklist

Before using atomic update in production, answer:

```text
[ ] Is temp file created in the same directory as target?
[ ] Is target path controlled and validated?
[ ] Are temp files ignored by readers?
[ ] Is content validated before publish?
[ ] Is temp file forced before move if durability matters?
[ ] Is ATOMIC_MOVE required and tested?
[ ] Is unsupported atomic move treated as hard failure for critical state?
[ ] Is directory force needed and handled best-effort/platform-specifically?
[ ] Is stale temp cleanup implemented safely?
[ ] Are multi-writer semantics defined?
[ ] Are exceptions classified by phase?
[ ] Are metrics/logs available?
[ ] Is behavior tested on actual target OS/filesystem/container volume?
[ ] Is network filesystem behavior explicitly accepted or avoided?
[ ] Is rollback/versioning needed?
```

---

## 47. Summary Mental Model

Atomic update pattern is not just a code snippet. It is a correctness protocol.

Core idea:

```text
Never construct the new state at the public name.
Construct it privately.
Validate it.
Persist it as much as required.
Publish it with one atomic namespace operation.
```

The most important distinction:

```text
write controls bytes
move controls namespace visibility
force controls durability request
validation controls semantic correctness
coordination controls multi-writer behavior
```

A mature engineer does not say:

```text
I wrote the file successfully.
```

A mature engineer asks:

```text
What can readers observe?
What survives crash?
What happens if two writers race?
What happens if filesystem semantics differ?
What is the recovery state after every failure point?
```

That is the difference between casual file I/O and production filesystem engineering.

---

## 48. What We Covered

In this part, we covered:

- why in-place update is unsafe for critical files
- temp file + atomic move pattern
- visibility vs durability
- `ATOMIC_MOVE` limitations
- why temp file must be in same directory
- `FileChannel.force(true)`
- directory fsync concept and Java portability limitation
- failure matrix
- reader behavior
- validation-before-publish
- multi-writer limitation
- large file and manifest patterns
- cleanup strategy
- exception classification
- Java 8–25 compatibility
- production checklist

---

## 49. Next Part

Next:

```text
Part 08 — Copy and Move Semantics: Replace, Attributes, Links, Cross-Device Behavior
```

Part 08 will broaden from atomic update into the complete semantics of `Files.copy` and `Files.move`, including replacement behavior, attribute preservation, symbolic link handling, cross-device moves, partial copy failure, directory copy limitations, and resumable copy design.

---

## References

- Oracle Java SE 25 API — `java.nio.file.Files`
- Oracle Java SE 25 API — `java.nio.file.StandardCopyOption`
- Oracle Java SE 8 API — `java.nio.channels.FileChannel`
- Oracle Java Tutorials — Moving a File or Directory

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 06](./learn-java-io-file-filesystem-storage-engineering-part-06-writing-files-correctly.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 08](./learn-java-io-file-filesystem-storage-engineering-part-08-copy-move-semantics.md)
