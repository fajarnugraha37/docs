# Learn Linux & Kernel Mastery for Java Engineers

## Part 008 — Filesystem Semantics for Correct Applications

**Filename:** `learn-linux-kernel-mastery-for-java-engineers-part-008.md`  
**Series:** `learn-linux-kernel-mastery-for-java-engineers`  
**Part:** 008 / 035  
**Audience:** Java software engineer, backend engineer, tech lead, platform engineer  
**Scope:** Linux filesystem semantics for application correctness, durability, atomicity, page cache, file locking, disk-full behavior, and production-safe file I/O design.

---

## 0. Why This Part Exists

Part 007 explained the **structure** of Linux filesystem abstraction: VFS, inode, dentry, mount, path lookup, and why filename is not the same thing as file identity.

This part explains the more dangerous thing: **filesystem semantics**.

A lot of application bugs come from a subtle misunderstanding:

> “I called `write()` or Java `Files.write()`, therefore the data is safely stored.”

That statement is often false.

Another common misunderstanding:

> “I renamed the temporary file into place, therefore the new file is durable.”

That is also not always enough.

Another one:

> “The filesystem is journaling, therefore my data cannot be corrupted.”

Also incomplete.

For Java engineers, filesystem correctness matters even if you are not building a database. Backend systems often use the filesystem for:

- application logs;
- uploaded files;
- temporary files;
- cache directories;
- lock files;
- local queues;
- generated reports;
- certificates and keys;
- configuration files;
- feature flag snapshots;
- embedded indexes;
- checkpoint files;
- local state used by jobs, workers, or batch processors.

When a service crashes, a node loses power, a container is killed, a volume is remounted, or a disk fills up, the exact semantics of file operations decide whether your system remains correct.

This part builds the mental model needed to answer questions like:

- Is this write atomic?
- Is this write durable?
- Can another process see a partial file?
- Can the file disappear after crash even though `rename()` succeeded?
- Why did disk usage remain high after deleting a large log file?
- Why did `df` show free space but writes still failed?
- Why did `Files.move(..., ATOMIC_MOVE)` not mean “durable move”?
- Why does `fsync()` sometimes cause latency spikes?
- Why does journaling not automatically protect application-level invariants?
- When is the filesystem acceptable as a small state store, and when is it a trap?

---

## 1. The Core Mental Model

A filesystem operation can have several different properties. These properties are related, but not the same.

### 1.1 Visibility

Visibility answers:

> Can another process see the change now?

Example:

```java
Files.writeString(Path.of("status.txt"), "READY");
```

After this returns, another process may read `status.txt` and see `READY`.

But visibility does not mean the bytes are durable on stable storage.

---

### 1.2 Atomicity

Atomicity answers:

> Can observers see an intermediate state?

For example, `rename(old, new)` within the same filesystem is atomic with respect to namespace visibility: observers should see either the old name or the new name, not a half-renamed path.

But atomicity does not mean durability.

A rename can be visible and atomic, but after crash, the directory entry may not necessarily survive unless the correct durability steps are taken.

---

### 1.3 Durability

Durability answers:

> If the machine crashes immediately after the operation returns, will the change still exist after reboot?

This is where many application bugs live.

The kernel may buffer writes in memory. Storage devices may also have their own caches. Filesystems may reorder operations for performance. Journaling may protect metadata consistency without guaranteeing that your application data has reached stable storage.

---

### 1.4 Ordering

Ordering answers:

> If operation A happened before operation B in my program, will storage recover them in that order after crash?

Example:

1. Write new file content.
2. Rename temporary file over old file.
3. Return success to caller.

Your program order is clear. But after crash, filesystem/storage order may be different unless you force the right barriers with `fsync()`/`fdatasync()` and directory sync where needed.

---

### 1.5 Consistency

Consistency answers:

> Are my application-level invariants preserved after crash?

A filesystem may be internally consistent after journal recovery while your application state is still inconsistent.

For example:

- `metadata.json` points to `segment-42.dat`;
- `segment-42.dat` was never durably written;
- after crash, `metadata.json` exists but points to missing or incomplete data.

The filesystem can be healthy, but your application invariant is broken.

---

## 2. The Critical Distinction: Kernel Return vs Stable Storage

When Java writes a file, the rough stack is:

```text
Java code
  ↓
JDK file API / NIO
  ↓
libc / native runtime boundary
  ↓
syscall: openat/write/fsync/rename/close
  ↓
VFS
  ↓
filesystem implementation: ext4/xfs/btrfs/tmpfs/overlayfs/nfs/...
  ↓
page cache / block layer
  ↓
device driver
  ↓
storage controller / disk / network storage
```

A successful `write()` usually means:

> The kernel accepted the bytes into the file abstraction.

It does **not** always mean:

> The bytes are on stable storage.

The Linux `fsync(2)` manual documents the purpose of `fsync()` as transferring modified in-core data for a file to the storage device, including metadata needed to retrieve it. `fdatasync()` is similar but may avoid flushing metadata that is not required for subsequent data retrieval. See the official Linux man page for `fsync(2)`: <https://man7.org/linux/man-pages/man2/fsync.2.html>.

---

## 3. Buffered I/O and the Page Cache

Most normal file I/O on Linux is **buffered I/O**.

When your application writes:

```java
Files.writeString(Path.of("event.log"), "hello\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
```

Linux often does not synchronously write bytes to the physical disk. Instead, it places the data in the **page cache** and marks those pages dirty.

Conceptually:

```text
Application write()
  ↓
Kernel copies data from user memory
  ↓
Page cache page becomes dirty
  ↓
write() returns
  ↓
Later: kernel writeback thread flushes dirty page to storage
```

This makes writes fast, but it creates a gap between:

- application success;
- kernel memory state;
- durable storage state.

### 3.1 Dirty Pages

A dirty page is a page in memory whose content differs from what is currently on storage.

Dirty pages eventually need to be written back. Writeback can happen because of:

- memory pressure;
- dirty page thresholds;
- periodic background writeback;
- explicit `fsync()`/`fdatasync()`;
- unmount;
- process exit does **not** by itself imply durable sync of all files.

### 3.2 Why This Matters for Java

A Java service can successfully write:

```java
Files.writeString(checkpointPath, checkpointJson);
```

Then immediately acknowledge to a caller:

```text
checkpoint saved
```

If the machine crashes before dirty pages are flushed, the checkpoint may be missing, old, truncated, or inconsistent depending on filesystem and write pattern.

The bug is not in Java. The bug is the application making a durability claim without paying the durability cost.

---

## 4. `write()`, `close()`, `flush()`, `fsync()`: Not the Same

Java engineers often confuse several layers of flushing.

### 4.1 Java `flush()`

For streams and writers, `flush()` often means:

> Push buffered data from Java/user-space buffers to the next layer.

Example:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path)) {
    writer.write("hello");
    writer.flush();
}
```

This does not necessarily mean the data is durable on disk. It usually means Java's buffer has been flushed to the OS using write calls.

### 4.2 Java `close()`

`close()` generally releases the file descriptor and may flush user-space buffers first.

But `close()` is not a universal substitute for `fsync()`.

Also, errors can be reported on `close()` because previous delayed writeback errors may surface late. Code that ignores close errors can miss storage failures.

### 4.3 `FileChannel.force()`

Java NIO exposes durability intent through:

```java
channel.force(true);
```

or:

```java
channel.force(false);
```

Conceptually:

- `force(true)` asks to flush file content and metadata;
- `force(false)` asks to flush file content, with less metadata requirement.

Under Linux this maps conceptually to `fsync()`/`fdatasync()`-style behavior, though exact implementation depends on platform/JDK.

### 4.4 `fsync()`

`fsync(fd)` asks the kernel to flush dirty file data and relevant metadata for that file to stable storage.

### 4.5 Directory `fsync()`

A subtle but critical point:

> `fsync(file_fd)` flushes the file content and required file metadata, but directory entries are metadata of the parent directory.

If you create, rename, or unlink a file and need the namespace update itself to survive crash, you often need to sync the parent directory as well.

This matters for safe-write patterns.

---

## 5. The Safe-Write Pattern

Suppose you want to update a configuration snapshot safely:

```text
state.json
```

Naive code:

```java
Files.writeString(Path.of("state.json"), newJson);
```

This can expose partial content to readers if the process crashes mid-write or if readers observe while the file is being overwritten.

A better pattern is:

1. Write content to a temporary file in the same directory.
2. Flush the temporary file content to storage.
3. Atomically rename temporary file into final path.
4. Flush the parent directory to make the rename durable.

Conceptual syscall sequence:

```text
fd = open("state.json.tmp", O_CREAT|O_WRONLY|O_TRUNC, 0644)
write(fd, data)
fsync(fd)
close(fd)
rename("state.json.tmp", "state.json")
dirfd = open(".", O_RDONLY|O_DIRECTORY)
fsync(dirfd)
close(dirfd)
```

### 5.1 Why Same Directory?

`rename()` atomicity is reliable when the source and destination are on the same mounted filesystem.

If the temporary file is created in `/tmp` and final file is in `/var/lib/myapp`, the rename may cross filesystems. Cross-filesystem rename cannot be implemented as a simple atomic namespace switch; it may fail with `EXDEV`, or higher-level APIs may fall back to copy/delete behavior.

Therefore:

> Temporary replacement files should usually live in the same directory as the final target.

### 5.2 Java Sketch

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

public final class SafeFileWrite {
    public static void writeAtomically(Path target, byte[] data) throws IOException {
        Path dir = target.toAbsolutePath().getParent();
        String tmpName = target.getFileName() + ".tmp." + UUID.randomUUID();
        Path tmp = dir.resolve(tmpName);

        boolean renamed = false;
        try {
            try (FileChannel ch = FileChannel.open(
                    tmp,
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE)) {
                ch.write(ByteBuffer.wrap(data));
                ch.force(true); // file content + metadata needed for file
            }

            try {
                Files.move(tmp, target,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                // For correctness-sensitive state, do not silently fall back to copy/delete.
                throw e;
            }
            renamed = true;

            // Java does not provide a clean portable directory fsync API.
            // On Linux, production-grade libraries may use native code/JNA/JNI
            // to open the directory and fsync the directory fd.
            // Without this step, the rename may be visible but not crash-durable.
        } finally {
            if (!renamed) {
                try {
                    Files.deleteIfExists(tmp);
                } catch (IOException ignored) {
                    // Best-effort cleanup.
                }
            }
        }
    }
}
```

Important limitation:

> Standard Java APIs make file `force()` accessible, but directory `fsync()` is not cleanly exposed as a first-class portable operation.

If your application truly needs crash-durable local state, you may need:

- a mature storage library;
- JNI/JNA for directory fsync on Linux;
- an embedded database that already handles these details;
- or a design that avoids using plain files as the source of truth.

---

## 6. Atomic Rename Is Not Durable Rename

`rename()` is often described as atomic, and that is true in the namespace visibility sense within a filesystem.

But this does not automatically mean:

- file content is durable;
- directory entry is durable;
- application invariants spanning multiple files are durable.

The `rename(2)` man page documents the atomic replacement behavior of `rename()` when the destination already exists: there is no point at which another process attempting to access `newpath` will find it missing. See the official Linux man page: <https://man7.org/linux/man-pages/man2/rename.2.html>.

But for crash consistency, you still need to reason about `fsync()`.

### 6.1 Correct Mental Model

```text
rename() gives atomic visibility.
fsync() gives durability intent.
Application protocol gives consistency.
```

Do not collapse these into one concept.

---

## 7. Journaling: What It Solves and What It Does Not

A journaling filesystem records certain changes in a journal so it can recover filesystem metadata consistency after crash.

But journaling does not automatically mean your file content is safe.

The Linux kernel ext4 documentation states that, for performance reasons, ext4 by default journals filesystem metadata, and file data blocks are not guaranteed to be in a consistent state after a crash under the default mode. The ext4 journal documentation describes modes such as `data=ordered`, `data=writeback`, and `data=journal`. See the official kernel docs: <https://www.kernel.org/doc/html/latest/filesystems/ext4/journal.html>.

### 7.1 Metadata Consistency vs Data Consistency

Filesystem metadata includes things like:

- inode allocation;
- directory entries;
- block allocation metadata;
- size metadata;
- timestamps;
- link counts.

Application data is your actual file content:

```json
{"lastProcessedOffset": 12345}
```

A filesystem can recover metadata correctly but still not preserve the latest application data you assumed was committed.

### 7.2 Three Layers of Consistency

```text
Filesystem structural consistency
  Example: filesystem can mount after crash.

File-level consistency
  Example: state.json is either old or new, not truncated garbage.

Application-level consistency
  Example: state.json and segment files agree with each other.
```

Journaling primarily helps the first layer. You must design for the others.

---

## 8. `O_SYNC`, `O_DSYNC`, `O_DIRECT`: Powerful but Often Misused

Linux exposes open flags that change write behavior.

### 8.1 `O_SYNC`

Writes complete as though followed by a synchronization of data and necessary metadata.

This can simplify durability reasoning but can be very expensive.

### 8.2 `O_DSYNC`

Similar idea but focused on data integrity rather than all metadata.

### 8.3 `O_DIRECT`

Attempts to minimize page cache effects by doing direct I/O between user buffers and storage.

This is not a magic performance switch. It introduces alignment requirements and can reduce performance for workloads that benefit from caching.

### 8.4 Java Relevance

Most Java applications should not reach for direct I/O casually.

Use direct/synchronous I/O only when you have:

- clear durability requirements;
- measured page cache behavior;
- workload-specific reason;
- operational knowledge of the storage layer;
- tests that include crash/restart behavior.

For typical backend services:

- buffered I/O is usually correct for logs, caches, and transient files;
- explicit `force()`/`fsync()` is needed for committed local state;
- database/storage engines should own low-level I/O semantics when state is critical.

---

## 9. Append Is Not a Universal Transaction Log

Appending to a file feels simple:

```java
Files.writeString(logPath, record + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
```

But several questions remain:

- Is each append atomic?
- Are records length-delimited?
- Can a crash leave a partial final record?
- Are multiple writers involved?
- Is the file opened with append semantics or does code seek then write?
- Is `fsync()` called per record, per batch, or never?
- What is the recovery rule for a torn final record?

### 9.1 Correct Append-Log Design

For an application-owned append log, you usually need:

1. explicit record framing;
2. checksum per record or segment;
3. monotonic sequence number;
4. recovery that truncates incomplete tail;
5. batching policy;
6. periodic fsync or fsync-on-commit;
7. rotation protocol;
8. compaction or retention policy.

Without this, an append-only file is just a convenient byte stream, not a reliable commit log.

---

## 10. File Locking: Coordination, Not Durability

Linux has multiple locking mechanisms:

- advisory locks using `flock()`;
- POSIX byte-range locks using `fcntl()`;
- open-file-description locks;
- lock files implemented through create/link/rename patterns;
- application-level leases or heartbeats.

The `flock(2)` man page documents advisory locks and notes that locks are associated with an open file description. See: <https://man7.org/linux/man-pages/man2/flock.2.html>.

### 10.1 Advisory Means Cooperation Required

Advisory locks do not stop a process that ignores them.

If process A locks a file and process B simply writes without checking the lock, Linux usually does not prevent B from doing so under normal advisory locking semantics.

Therefore:

> File locks coordinate well-behaved participants. They are not a security boundary and not a universal correctness guarantee.

### 10.2 Locking Is Not Persistence

A lock does not make writes durable.

You can hold a lock, write data, release lock, and still lose data after crash if you never synced.

### 10.3 Locking and Java

Java exposes file locking via `FileChannel.lock()` and `tryLock()`.

Use cases:

- prevent two local processes from using the same working directory;
- single-instance guard;
- local batch job coordination;
- protecting a local cache update.

Be careful with:

- network filesystems;
- containers sharing volumes;
- process crash while holding lock;
- lock lifetime tied to file descriptor/channel;
- assuming locks work across all filesystem types identically.

---

## 11. Disk Full Is Not One Failure

“Disk full” can mean different things.

### 11.1 No Blocks Available

Classic:

```text
ENOSPC
```

The filesystem has no free data blocks.

### 11.2 No Inodes Available

A filesystem can have free bytes but no free inodes.

This happens with workloads that create huge numbers of small files.

Symptoms:

```text
df -h shows free space
df -i shows 100% inode usage
```

### 11.3 Project/User Quota Exceeded

A process may hit quota even when filesystem has free space.

### 11.4 Reserved Blocks

Some filesystems reserve blocks for root or system operation.

An unprivileged service may get `ENOSPC` before `df` looks completely full.

### 11.5 Deleted but Open Files

If a large file is deleted while a process still has it open, the directory entry disappears, but the storage remains allocated until the last file descriptor is closed.

Production symptom:

```text
rm large.log
df still shows disk full
```

Diagnosis:

```bash
sudo lsof +L1
ls -l /proc/<pid>/fd
```

This follows from the inode/link-count/open-file model from Part 007.

---

## 12. Common File I/O Error Codes and What They Mean

A correct application must treat file I/O as fallible.

Important errors:

| Error | Meaning | Typical Production Cause |
|---|---|---|
| `ENOENT` | No such file/path component | race, wrong mount, deleted file |
| `EACCES` | permission denied | wrong user/group/mode/ACL/LSM |
| `EPERM` | operation not permitted | capability/security policy/immutable file |
| `ENOSPC` | no space left | full disk, full quota, exhausted blocks |
| `EDQUOT` | quota exceeded | user/project quota |
| `EMFILE` | process FD limit hit | FD leak or low `ulimit` |
| `ENFILE` | system-wide FD table full | host-wide resource exhaustion |
| `EIO` | I/O error | device/storage failure, delayed writeback error |
| `EROFS` | read-only filesystem | container image path, remounted volume |
| `EXDEV` | cross-device link/rename | temp file on different filesystem |
| `ENAMETOOLONG` | path too long | generated path bug |
| `ELOOP` | too many symlink levels | symlink cycle or attack |

### 12.1 Java Mapping

Many of these become subclasses of `IOException` or `FileSystemException`.

Do not collapse them into:

```java
catch (IOException e) {
    throw new RuntimeException("failed");
}
```

For production-grade systems, classify errors:

- retryable?
- fatal?
- operator action required?
- data corruption risk?
- safe to continue?
- should node be drained?

---

## 13. Temporary Files: More Dangerous Than They Look

Temporary files are often used for:

- uploads;
- report generation;
- decompression;
- archive creation;
- intermediate job state;
- safe writes.

Risks:

1. temporary directory on wrong filesystem;
2. cross-filesystem rename;
3. predictable filename;
4. symlink attack;
5. cleanup failure;
6. world-readable sensitive data;
7. tmpfs memory pressure;
8. container ephemeral storage limit;
9. orphan temp files after crash.

### 13.1 Safer Temporary File Rules

- Use secure random names or `Files.createTempFile()`.
- For atomic replace, create temp file in same directory as target.
- Set restrictive permissions for sensitive data.
- Avoid writing secrets to disk when not necessary.
- Clean up best-effort, but design recovery cleanup too.
- Monitor temp directory usage.
- Do not assume `/tmp` is large or persistent.

---

## 14. Filesystem as State Store: Decision Model

A plain filesystem can be a reasonable local state store when:

- state is small;
- one local writer owns it;
- crash semantics are simple;
- recovery can validate and repair;
- durability requirements are modest or explicitly handled;
- performance impact of sync is acceptable;
- you can test kill/crash scenarios.

A plain filesystem is risky when:

- multiple writers update related files;
- data must be transactionally consistent;
- you need concurrent reads/writes with isolation;
- crash recovery is complex;
- partial writes are unacceptable;
- storage is networked with weaker/different semantics;
- the application cannot tolerate manual repair;
- you are reinventing a database.

### 14.1 Better Options

Depending on requirements:

- embedded database;
- write-ahead log library;
- object storage with conditional writes;
- external database;
- queue/log system;
- checkpoint protocol with validation;
- append-only segment format with checksums.

The point is not “never use files.”

The point is:

> Use files when the semantics are sufficient and explicitly understood.

---

## 15. Java API Semantics You Must Not Overclaim

### 15.1 `Files.writeString()`

Convenient, not automatically crash-safe.

It may open, write, and close. It does not imply directory sync. It does not automatically give atomic replacement semantics.

### 15.2 `Files.move(..., ATOMIC_MOVE)`

Gives atomic move if supported. It does not by itself ensure file content was previously synced or parent directory was synced.

### 15.3 `StandardOpenOption.SYNC` and `DSYNC`

These express synchronous write intent through Java API. They can be expensive and should be measured.

### 15.4 `FileChannel.force()`

This is the most important Java-level primitive for explicit file durability.

But again:

- forcing the file is not the same as forcing the parent directory;
- forcing too often can destroy throughput;
- not forcing when claiming commit can break correctness.

---

## 16. Performance Model of Durability

Durability is expensive because it forces coordination across layers:

```text
Application
  ↓
Kernel dirty pages
  ↓
Filesystem metadata/data ordering
  ↓
Block layer
  ↓
Device cache/barrier/flush
  ↓
Physical or virtual storage
```

### 16.1 Why `fsync()` Latency Spikes

`fsync()` may need to wait for:

- dirty data of that file;
- metadata updates;
- journal commit;
- storage flush;
- other queued I/O;
- writeback congestion;
- network storage latency;
- noisy neighbors;
- cloud volume throttling.

Therefore, `fsync()` latency can be much higher than normal write latency.

### 16.2 Batch Durability

Instead of syncing every event:

```text
write event
fsync
write event
fsync
write event
fsync
```

many systems batch:

```text
write N events
fsync once
ack batch
```

Trade-off:

- higher throughput;
- lower fsync overhead per event;
- larger loss window on crash unless acknowledgments are delayed until sync.

### 16.3 Commit Policy Is a Product/Business Decision

For a local cache, losing the last second may be fine.

For payment settlement, losing one acknowledged record may be unacceptable.

Linux gives primitives. The application must define the contract.

---

## 17. Crash-Consistency Thinking

A crash can occur between any two operations.

For example:

```text
1. open temp file
2. write first half
3. write second half
4. fsync temp file
5. close temp file
6. rename temp to final
7. fsync parent directory
8. return success
```

Crash points:

- before step 2: no temp content;
- after step 2: partial temp file;
- after step 4: temp file durable but not published;
- after step 6: final path visible before directory sync;
- after step 8: should be recoverable if all necessary syncs succeeded.

### 17.1 Recovery Rules

Safe file protocols need recovery logic:

- ignore temp files older than active process;
- validate checksum;
- choose highest valid generation;
- truncate incomplete append record;
- rebuild cache from source of truth;
- fail closed if invariant cannot be proven.

### 17.2 Generation Files

For small state snapshots, one pattern is:

```text
state.000001.json
state.000002.json
state.000003.json
CURRENT
```

`CURRENT` points to latest generation.

Each state file contains:

- version;
- checksum;
- timestamp;
- schema version;
- previous generation maybe.

Recovery:

1. Read `CURRENT`.
2. Validate referenced file.
3. If invalid, scan previous generations.
4. Choose latest valid state.
5. Alert if recovery had to roll back.

This is more work than `Files.writeString()`, but it is the difference between convenience and correctness.

---

## 18. Network Filesystems and Cloud Volumes

Not all filesystems behave like local ext4/XFS.

Networked or virtualized storage can introduce:

- different locking semantics;
- higher latency;
- cache incoherence windows;
- weaker or surprising rename behavior;
- delayed error reporting;
- throughput caps;
- burst credits;
- multi-attach hazards;
- failover behavior;
- inconsistent performance under load.

Examples include:

- NFS;
- SMB;
- FUSE filesystems;
- object-store-backed mounts;
- cloud block volumes;
- container overlay filesystems.

### 18.1 Engineering Rule

If your correctness depends on local POSIX filesystem semantics, verify them on the exact filesystem and mount configuration used in production.

Do not assume:

```text
works on laptop ext4 == works on production mounted volume
```

---

## 19. Overlay Filesystems and Containers

Container images usually use layered filesystems. A writable container layer may be implemented with overlay mechanisms.

Implications:

- writes to image paths may go to copy-on-write upper layer;
- performance may differ from host filesystem;
- container root filesystem may be read-only;
- writable layer may be ephemeral;
- large writes may consume node ephemeral storage;
- renames/copy-up behavior can surprise performance assumptions;
- logs written inside container filesystem may disappear with container.

### 19.1 Practical Container Rule

For Java services in containers:

- write durable state to explicit mounted volumes;
- write logs to stdout/stderr unless you intentionally manage log files;
- treat container filesystem as ephemeral unless specified otherwise;
- monitor ephemeral storage;
- do not put critical application state in `/tmp` without understanding tmpfs/ephemeral storage limits.

---

## 20. Safe Configuration Update Pattern

Suppose a Java service reads a local feature flag snapshot:

```text
/var/lib/myapp/flags.json
```

Updater process should avoid partial file exposure.

Recommended pattern:

```text
/var/lib/myapp/flags.json.tmp.<random>
write full content
fsync temp file
rename temp → flags.json
fsync /var/lib/myapp directory
```

Reader should:

1. open `flags.json`;
2. read full content;
3. validate JSON;
4. validate schema version;
5. validate checksum if included;
6. only then publish in-memory state.

Never let partially parsed configuration become active runtime configuration.

---

## 21. Safe Upload Handling Pattern

For file uploads:

Bad pattern:

```text
write directly to final visible path while upload is still in progress
```

Problem:

- another process may consume partial upload;
- crash can leave corrupt final file;
- retry semantics are ambiguous.

Better pattern:

```text
incoming/<upload-id>.part
complete write
validate length/checksum/content-type
fsync if durability required
rename to ready/<upload-id>
fsync parent directory if crash-durable publication required
```

Consumer only reads from `ready/`.

This is a simple state machine:

```text
RECEIVING → VALIDATED → PUBLISHED
       ↘ FAILED
```

Filesystem directories become state partitions. But the application must maintain the invariants.

---

## 22. Safe Local Cache Pattern

For cache files:

- no need to fsync every object if cache can be rebuilt;
- write temp + rename to avoid partial reads;
- include checksum to detect torn/corrupt values;
- allow deletion/rebuild on startup;
- keep cache under explicit size limit;
- handle `ENOSPC` by evicting or disabling cache;
- never let cache corruption corrupt source-of-truth state.

Cache invariant:

> Cache may disappear or be stale, but must not become authoritative false state.

---

## 23. Safe Log File Thinking

Application logs are usually not transactional state.

But logs matter for audit, compliance, incident reconstruction, or regulatory systems.

Questions:

- Can you lose last N seconds of logs?
- Does the log pipeline acknowledge before durable ingest?
- Are logs written to local disk, stdout, journald, sidecar, or agent?
- What happens when log volume fills disk?
- What happens when log rotation deletes an open file?
- Are sensitive fields redacted before disk write?
- Is there backpressure when logging blocks?

### 23.1 Logging Failure Mode

A synchronous file appender can block request threads when disk is slow.

An asynchronous appender can lose buffered logs on crash.

A non-blocking dropping appender can preserve latency while losing evidence.

There is no free option. Choose based on operational and compliance requirements.

---

## 24. Observability Commands

### 24.1 Disk Space and Inodes

```bash
df -h
df -i
```

### 24.2 Open Deleted Files

```bash
sudo lsof +L1
ls -l /proc/<pid>/fd | grep deleted
```

### 24.3 File Descriptor View

```bash
ls -lah /proc/<pid>/fd
cat /proc/<pid>/limits
```

### 24.4 Filesystem Type and Mount Options

```bash
findmnt
mount | column -t
cat /proc/mounts
```

### 24.5 I/O Pressure

```bash
iostat -xz 1
pidstat -d 1
vmstat 1
```

### 24.6 Syscall-Level View

```bash
strace -f -ttT -e trace=openat,write,fsync,fdatasync,rename,close,unlink java ...
```

For an already-running process:

```bash
sudo strace -p <pid> -f -ttT -e trace=fsync,fdatasync,write,rename,openat,close
```

Use carefully in production.

### 24.7 Page Cache and Dirty Writeback Clues

```bash
cat /proc/meminfo | egrep 'Dirty|Writeback|Cached'
cat /proc/vmstat | egrep 'dirty|writeback|pgpg|pswp'
```

---

## 25. Lab 1 — Observe Buffered Write vs Forced Write

Create two files: one written normally, one forced.

Java sketch:

```java
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class ForceDemo {
    public static void main(String[] args) throws Exception {
        Path normal = Path.of("normal.dat");
        Path forced = Path.of("forced.dat");
        byte[] data = new byte[1024 * 1024];

        long t1 = System.nanoTime();
        try (FileChannel ch = FileChannel.open(normal,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE)) {
            ch.write(ByteBuffer.wrap(data));
        }
        long t2 = System.nanoTime();

        long t3 = System.nanoTime();
        try (FileChannel ch = FileChannel.open(forced,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE)) {
            ch.write(ByteBuffer.wrap(data));
            ch.force(true);
        }
        long t4 = System.nanoTime();

        System.out.printf("normal close: %.3f ms%n", (t2 - t1) / 1_000_000.0);
        System.out.printf("forced write: %.3f ms%n", (t4 - t3) / 1_000_000.0);
    }
}
```

Run with:

```bash
javac ForceDemo.java
strace -f -ttT -e trace=openat,write,fsync,fdatasync,close java ForceDemo
```

Observe:

- Which syscalls happen?
- Does `force(true)` result in sync syscall?
- How long does it take?
- Does latency vary between runs?

---

## 26. Lab 2 — Deleted but Open File

```bash
mkdir -p /tmp/fs-demo
cd /tmp/fs-demo
python3 - <<'PY'
import time
f = open('big.log', 'wb')
f.write(b'x' * 200 * 1024 * 1024)
f.flush()
print('pid:', __import__('os').getpid())
time.sleep(300)
PY
```

In another terminal:

```bash
cd /tmp/fs-demo
rm big.log
du -sh .
sudo lsof +L1 | grep big.log
ls -l /proc/<pid>/fd | grep deleted
```

Expected mental model:

- directory entry removed;
- file inode still referenced by open FD;
- disk blocks not freed until FD closes.

---

## 27. Lab 3 — Atomic Replace Visibility

Writer:

```bash
while true; do
  printf 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' > file.tmp
  mv file.tmp file
  printf 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n' > file.tmp
  mv file.tmp file
done
```

Reader:

```bash
while true; do
  cat file | grep -vE '^(A+|B+)$' && echo 'saw weird content'
done
```

This demonstrates visibility atomicity of rename under normal same-filesystem conditions.

But it does not prove crash durability.

---

## 28. Production Debugging Scenarios

### Scenario A — “Config File Was Empty After Deploy”

Likely causes:

- wrote directly to final file with truncate;
- crash occurred after truncate before full write;
- deploy script did not use temp + rename;
- no validation before activation.

Fix:

- write temp;
- validate;
- fsync if needed;
- atomic rename;
- reader validates content before publishing.

---

### Scenario B — “Disk Is Full but We Deleted Logs”

Likely causes:

- log file still open by Java process;
- log rotation misconfigured;
- appender did not reopen file;
- deleted inode still referenced.

Diagnosis:

```bash
sudo lsof +L1
ls -l /proc/<pid>/fd | grep deleted
```

Fix:

- restart process or signal logger to reopen;
- configure logrotate correctly;
- prefer stdout/stderr in containers;
- monitor open deleted files.

---

### Scenario C — “Checkpoint Says Processed, But Data Missing”

Likely causes:

- metadata/checkpoint file synced before data file;
- application invariant spans files but commit protocol does not;
- crash occurred between writes.

Fix:

- define commit protocol;
- write data first;
- fsync data;
- write manifest/checkpoint;
- fsync manifest;
- rename manifest;
- fsync parent directory;
- recovery validates references.

---

### Scenario D — “Latency Spikes Every Few Seconds”

Possible filesystem causes:

- background writeback;
- synchronous logging;
- fsync batching;
- journal commits;
- slow cloud disk flush;
- memory pressure causing writeback/reclaim;
- shared volume noisy neighbor.

Diagnosis:

```bash
iostat -xz 1
pidstat -d 1
cat /proc/meminfo | egrep 'Dirty|Writeback'
strace -p <pid> -f -ttT -e trace=fsync,fdatasync,write
```

---

## 29. Invariants for Correct Filesystem Use

Memorize these:

1. `write()` success means kernel accepted bytes, not necessarily durable storage.
2. `flush()` in Java is not `fsync()`.
3. `close()` is not a universal durability boundary.
4. `rename()` is atomic for namespace visibility within a filesystem, not automatically durable.
5. File content durability and directory entry durability are separate concerns.
6. Journaling protects filesystem recovery, not automatically application invariants.
7. A deleted file can still consume space if a process holds an open FD.
8. Disk full can mean blocks, inodes, quota, or reserved blocks.
9. File locks coordinate cooperative processes; they are not a security boundary or durability mechanism.
10. Temporary files used for atomic replacement should usually be in the same directory as the target.
11. Critical local state needs a crash recovery protocol, not just file writes.
12. Filesystem behavior depends on filesystem type and mount options.
13. Network/overlay filesystems can break assumptions learned on local ext4/XFS.
14. Durability has latency cost; acknowledge only what you have actually made durable.
15. If correctness matters, test with kill, crash, disk-full, permission, and restart scenarios.

---

## 30. Practical Design Checklist

Before using a file for application state, answer:

### Visibility

- Can readers see a partial write?
- Is publication atomic?
- Are readers validating content before use?

### Durability

- Does the application promise persistence after success?
- Is `force()`/`fsync()` called before acknowledgment?
- Is parent directory synced after create/rename/unlink if needed?

### Consistency

- Does the state span multiple files?
- Is there a manifest/checkpoint protocol?
- Can recovery detect incomplete updates?

### Concurrency

- Is there more than one writer?
- Are file locks needed?
- Are locks advisory and respected by all participants?

### Failure

- What happens on `ENOSPC`?
- What happens on `EIO`?
- What happens on partial final record?
- What happens on process crash during update?
- What happens on container restart?

### Operations

- Is the path on the expected mount?
- Is the filesystem local, networked, overlay, tmpfs, or read-only?
- Is usage monitored by bytes and inodes?
- Is cleanup safe?
- Are open deleted files detected?

---

## 31. Senior-Level Reasoning Questions

1. Why is `rename()` atomic but not sufficient for crash-safe file replacement?
2. Why might `Files.move(..., ATOMIC_MOVE)` still lose data after power loss?
3. What is the difference between syncing a file and syncing its parent directory?
4. Why can `df -h` show free space while file creation still fails?
5. Why can deleting a file fail to free disk space immediately?
6. Why does journaling not automatically make application state consistent?
7. When would you use `FileChannel.force(true)` vs `force(false)`?
8. Why is direct overwrite with truncate dangerous for config files?
9. How would you design a crash-safe local checkpoint file?
10. How would you debug fsync-induced latency spikes in a Java service?
11. What changes if the file lives on NFS or a container overlay filesystem?
12. Why are advisory file locks insufficient against uncooperative writers?
13. How would you design an append-only local log with recovery?
14. How do you decide whether to use plain files or an embedded database?
15. What filesystem assumptions must be tested before relying on a mounted production volume?

---

## 32. Minimal Production Playbook

When a Java service has suspicious file/storage behavior:

### Step 1 — Identify Filesystem and Mount

```bash
findmnt <path>
cat /proc/mounts | grep <mount>
```

Ask:

- local disk?
- network filesystem?
- overlay?
- tmpfs?
- read-only?
- expected mount options?

### Step 2 — Check Space and Inodes

```bash
df -h <path>
df -i <path>
```

### Step 3 — Check Open Deleted Files

```bash
sudo lsof +L1
```

### Step 4 — Check I/O Latency

```bash
iostat -xz 1
pidstat -d 1
```

### Step 5 — Check Syscalls

```bash
sudo strace -p <pid> -f -ttT -e trace=openat,write,fsync,fdatasync,rename,close,unlink
```

### Step 6 — Check Java-Level Behavior

- Is app writing directly or temp+rename?
- Does it call `FileChannel.force()`?
- Does it ignore `IOException`?
- Does logging block request threads?
- Does startup validate local state?
- Does recovery handle temp files?

---

## 33. Summary

Filesystem programming looks simple because the API is simple:

```java
Files.writeString(path, data);
```

But correct filesystem programming is about explicit semantics:

- visibility;
- atomicity;
- durability;
- ordering;
- recovery;
- consistency;
- operational failure.

For Java backend engineers, the key lesson is:

> The filesystem is not just storage. It is a set of contracts, caches, metadata operations, durability barriers, and failure modes.

Most production bugs happen when code assumes a stronger contract than Linux actually provided.

You do not need to become a filesystem developer. But you do need to know when a file operation is merely convenient and when it is a correctness boundary.

---

## 34. References

Official and primary references:

1. Linux `fsync(2)` manual page  
   <https://man7.org/linux/man-pages/man2/fsync.2.html>

2. Linux `open(2)` manual page  
   <https://man7.org/linux/man-pages/man2/open.2.html>

3. Linux `rename(2)` manual page  
   <https://man7.org/linux/man-pages/man2/rename.2.html>

4. Linux `flock(2)` manual page  
   <https://man7.org/linux/man-pages/man2/flock.2.html>

5. Linux Kernel Documentation — ext4 journal  
   <https://www.kernel.org/doc/html/latest/filesystems/ext4/journal.html>

6. Linux Kernel Documentation — ext4 general information  
   <https://docs.kernel.org/admin-guide/ext4.html>

7. Linux Kernel Documentation — VFS  
   <https://docs.kernel.org/filesystems/vfs.html>

Supplementary references:

8. Linux man-pages project  
   <https://www.kernel.org/doc/man-pages/>

9. OpenJDK Java NIO `FileChannel` API documentation  
   <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html>

---

## 35. Status Seri

Part ini adalah:

```text
Part 008 — Filesystem Semantics for Correct Applications
```

Seri belum selesai.

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-009.md
Part 009 — Memory Model I: Virtual Memory and Address Space
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Virtual Filesystems: VFS, inode, dentry, mount</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-009.md">Part 009 — Memory Model I: Virtual Memory and Address Space ➡️</a>
</div>
