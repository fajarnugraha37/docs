# Part 16 — FileStore and Filesystem Capacity: Disk Space, Quotas, and Operational Guardrails

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Target Java: 8–25  
> Level: Advanced / production engineering  
> Fokus: `FileStore`, kapasitas storage, quota, disk-full behavior, inode/metadata exhaustion, container ephemeral storage, dan desain guardrail agar file-producing workload tidak merusak node/aplikasi.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas operasi file dari sisi:

- path
- existence/type/identity
- create/open/read/write
- atomic update
- copy/move/delete
- traversal
- link safety
- metadata/permission

Bagian ini naik satu lapisan: **filesystem capacity as an operational invariant**.

Topik ini sering diremehkan karena developer biasanya berpikir:

> “Sebelum write, tinggal cek free space.”

Itu premis yang lemah.

Pada sistem produksi, kapasitas filesystem bukan angka statis. Kapasitas dipengaruhi oleh:

- proses lain di mesin yang sama
- container writable layer
- log rotation
- temp file
- quota user/project/filesystem
- reserved blocks
- inode exhaustion
- snapshot/copy-on-write storage
- network filesystem
- volume mount
- Kubernetes eviction
- asynchronous cleanup
- file yang sudah dihapus tetapi masih dipegang process
- OS page cache dan delayed allocation

Karena itu, engineer yang kuat tidak hanya bertanya:

> “Berapa free space?”

Tetapi:

> “Apa invariant kapasitas yang harus dijaga agar workflow file tetap aman, predictable, observable, dan recoverable ketika storage menipis atau habis?”

---

## 1. Mental Model: Storage Capacity Bukan Sekadar `free bytes`

Ketika aplikasi Java menulis file, ada beberapa lapisan yang terlibat:

```text
Application
  ↓
Java Files / FileChannel / OutputStream
  ↓
FileSystemProvider
  ↓
OS syscall / kernel VFS
  ↓
Filesystem driver
  ↓
Block allocator / metadata allocator
  ↓
Volume / disk / network storage / container layer
```

`FileStore` memberi kita view terhadap **file store** tempat path berada.

Namun angka yang kita dapat dari API seperti `getUsableSpace()` bukan janji bahwa seluruh byte itu bisa dipakai dengan sukses.

Secara konseptual:

```text
Total capacity
  ├── already allocated / used
  ├── unallocated but not necessarily usable by this process
  ├── reserved for root/system/filesystem
  ├── blocked by quota
  ├── consumed by metadata/inode needs
  ├── affected by concurrent writers
  └── affected by provider-specific behavior
```

Jadi:

```text
usable space ≠ guaranteed future write capacity
```

Lebih tepat:

```text
usable space = current hint from provider/OS about bytes this JVM may be able to use
```

Dan bahkan hint itu bisa expired segera setelah method return.

---

## 2. API Utama di Java: `FileStore`

Package utama:

```java
java.nio.file.FileStore
java.nio.file.Files
java.nio.file.FileSystem
java.nio.file.FileSystems
```

Cara umum mengambil `FileStore` dari sebuah path:

```java
Path path = Path.of("/var/app/data/inbox"); // Java 11+
FileStore store = Files.getFileStore(path);

System.out.println("name=" + store.name());
System.out.println("type=" + store.type());
System.out.println("total=" + store.getTotalSpace());
System.out.println("usable=" + store.getUsableSpace());
System.out.println("unallocated=" + store.getUnallocatedSpace());
```

Java 8 compatible:

```java
Path path = Paths.get("/var/app/data/inbox");
FileStore store = Files.getFileStore(path);
```

### 2.1 `Files.getFileStore(Path)`

`Files.getFileStore(path)` mengembalikan `FileStore` tempat file berada.

Namun ada detail penting:

- path harus bisa digunakan untuk menentukan store
- operasi bisa melempar `IOException`
- setelah `FileStore` didapat, behavior lanjutan bisa implementation-specific jika file/path tersebut dihapus atau dipindah ke store lain

Artinya jangan simpan `FileStore` sebagai kebenaran abadi.

Untuk workflow jangka panjang, lebih aman melakukan refresh berkala:

```java
FileStore currentStore = Files.getFileStore(workDirectory);
long usable = currentStore.getUsableSpace();
```

bukan:

```java
// Bad assumption: store object valid forever as an operational truth
this.store = Files.getFileStore(workDirectory);
```

---

## 3. `getTotalSpace`, `getUsableSpace`, `getUnallocatedSpace`

`FileStore` memiliki tiga angka utama:

```java
long total = store.getTotalSpace();
long usable = store.getUsableSpace();
long unallocated = store.getUnallocatedSpace();
```

### 3.1 `getTotalSpace()`

Makna:

```text
total size of the file store, in bytes
```

Biasanya ini kapasitas keseluruhan filesystem/partition/volume menurut provider.

Contoh:

```text
/var/app/data berada di volume 100 GiB
getTotalSpace() ≈ 100 GiB
```

Tetapi dalam container, angka ini bisa mengecoh.

Aplikasi bisa melihat total capacity filesystem node atau mounted layer, sementara limit pod/container lebih kecil. Karena itu, pada runtime container, `FileStore` harus dibaca bersama resource limit runtime, bukan sendirian.

### 3.2 `getUnallocatedSpace()`

Makna:

```text
number of unallocated bytes in the file store
```

Ini kira-kira “free blocks” di filesystem.

Namun unallocated tidak selalu berarti bisa dipakai oleh process ini.

Kenapa?

Karena sebagian free blocks bisa:

- reserved untuk root/system
- tidak accessible karena quota
- tidak usable karena project quota
- tidak usable karena filesystem policy
- berubah karena concurrent writer

### 3.3 `getUsableSpace()`

Makna:

```text
number of bytes available to this Java virtual machine
```

Ini biasanya angka yang paling relevan untuk aplikasi, karena mempertimbangkan “available to this JVM”.

Namun tetap bukan guarantee.

Dua alasan besar:

1. **Race condition kapasitas**  
   Setelah dicek, process lain bisa menulis duluan.

2. **Write allocation tidak selalu linear**  
   Menulis N byte data bisa butuh lebih dari N byte karena metadata, journal, block alignment, copy-on-write, compression, sparse allocation, atau filesystem overhead.

Mental model:

```text
getUsableSpace() answers:
"roughly how much space appears usable now?"

It does not answer:
"will my next 5 GiB write definitely succeed?"
```

---

## 4. Contoh Utility Pembacaan Kapasitas

Kita buat utility kecil yang aman untuk observability.

```java
import java.io.IOException;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;

public final class FileStoreSnapshot {
    private final String name;
    private final String type;
    private final long totalBytes;
    private final long usableBytes;
    private final long unallocatedBytes;

    private FileStoreSnapshot(
            String name,
            String type,
            long totalBytes,
            long usableBytes,
            long unallocatedBytes
    ) {
        this.name = name;
        this.type = type;
        this.totalBytes = totalBytes;
        this.usableBytes = usableBytes;
        this.unallocatedBytes = unallocatedBytes;
    }

    public static FileStoreSnapshot capture(Path path) throws IOException {
        FileStore store = Files.getFileStore(path);
        return new FileStoreSnapshot(
                store.name(),
                store.type(),
                store.getTotalSpace(),
                store.getUsableSpace(),
                store.getUnallocatedSpace()
        );
    }

    public double usedRatioApprox() {
        if (totalBytes <= 0) {
            return 1.0;
        }
        return 1.0 - ((double) usableBytes / (double) totalBytes);
    }

    public String name() {
        return name;
    }

    public String type() {
        return type;
    }

    public long totalBytes() {
        return totalBytes;
    }

    public long usableBytes() {
        return usableBytes;
    }

    public long unallocatedBytes() {
        return unallocatedBytes;
    }

    @Override
    public String toString() {
        return "FileStoreSnapshot{" +
                "name='" + name + '\'' +
                ", type='" + type + '\'' +
                ", totalBytes=" + totalBytes +
                ", usableBytes=" + usableBytes +
                ", unallocatedBytes=" + unallocatedBytes +
                ", usedRatioApprox=" + usedRatioApprox() +
                '}';
    }
}
```

Catatan desain:

- snapshot immutable
- jangan expose `FileStore` langsung sebagai long-lived object
- hitung ratio sebagai approximate
- handle `totalBytes <= 0`
- metrics sebaiknya disimpan sebagai bytes, bukan human-readable string

---

## 5. Human-Readable Formatting Tanpa Mengorbankan Precision

Untuk logging/UI boleh human-readable, tetapi untuk metrics tetap bytes.

```java
public final class ByteSizeFormat {
    private static final String[] UNITS = {"B", "KiB", "MiB", "GiB", "TiB", "PiB"};

    private ByteSizeFormat() {
    }

    public static String binary(long bytes) {
        if (bytes < 0) {
            return bytes + " B";
        }

        double value = bytes;
        int unit = 0;

        while (value >= 1024.0 && unit < UNITS.length - 1) {
            value /= 1024.0;
            unit++;
        }

        return String.format("%.2f %s", value, UNITS[unit]);
    }
}
```

Contoh:

```java
FileStoreSnapshot snapshot = FileStoreSnapshot.capture(Path.of("/var/app/data"));
System.out.println("usable=" + ByteSizeFormat.binary(snapshot.usableBytes()));
```

Hindari menyimpan metrics sebagai:

```text
12.37 GB
```

Simpan sebagai:

```text
13282115584
```

Lalu formatting dilakukan di layer presentasi.

---

## 6. Kenapa Preflight Space Check Tidak Cukup

Misalnya aplikasi mau menulis file 5 GiB.

Naive approach:

```java
long usable = Files.getFileStore(targetDir).getUsableSpace();

if (usable < expectedBytes) {
    throw new IllegalStateException("Not enough disk space");
}

writeLargeFile(target);
```

Masalah:

```text
T0: app cek usable = 10 GiB
T1: process lain tulis 8 GiB log
T2: app mulai tulis 5 GiB
T3: disk full di tengah write
```

Preflight check hanya mengurangi kemungkinan gagal, bukan menghilangkan failure.

Rule penting:

```text
Capacity check is admission control, not correctness guarantee.
```

Kebenaran workflow tetap harus datang dari:

- write exception handling
- staging file
- cleanup partial file
- idempotent retry
- atomic publish
- backpressure
- observability

---

## 7. Disk-Full Failure Mode di Java

Ketika filesystem penuh, operasi Java bisa gagal dengan berbagai exception.

Yang umum:

```java
java.io.IOException: No space left on device
```

Namun jangan hardcode message string.

Di Java, error yang muncul bisa berupa:

- `IOException`
- `FileSystemException`
- `AccessDeniedException`
- provider-specific exception wrapping
- channel write returning partial progress sebelum exception

Contoh handling yang lebih sehat:

```java
try {
    Files.write(target, payload, StandardOpenOption.CREATE_NEW);
} catch (FileSystemException e) {
    // Bisa jadi disk full, permission, readonly fs, quota, stale mount, dll.
    logFileSystemFailure(target, e);
    throw e;
} catch (IOException e) {
    logIoFailure(target, e);
    throw e;
}
```

Kenapa tidak cukup menangkap “disk full” secara spesifik?

Karena Java standard library tidak memberikan exception subtype portable khusus “NoSpaceLeftOnDeviceException”.

Maka desain yang benar adalah:

```text
Classify operationally where possible,
but make workflow safe for any IOException during write.
```

---

## 8. Partial Write: Bahaya Terbesar Saat Kapasitas Habis

Saat disk penuh di tengah write, target file bisa berada dalam kondisi:

- file tercipta tetapi ukurannya 0
- file tercipta sebagian
- file lama ter-truncate lalu gagal ditulis ulang
- metadata berubah tetapi content tidak lengkap
- temp file tertinggal
- stream/channel belum close

Naive overwrite paling berbahaya:

```java
Files.writeString(configPath, newConfig, StandardOpenOption.TRUNCATE_EXISTING);
```

Failure mode:

```text
1. File lama valid.
2. File dibuka dengan TRUNCATE_EXISTING.
3. File lama menjadi kosong/terpotong.
4. Write gagal karena disk full.
5. Sekarang tidak ada file valid.
```

Karena itu, untuk critical file gunakan pola dari Part 07:

```text
write temp
force temp
atomic move
```

Pada disk-full scenario, paling tidak file lama tetap utuh selama temp belum berhasil dipublish.

---

## 9. Capacity Guardrail: Threshold, Reserve, dan Admission Control

Aplikasi file-producing perlu memiliki guardrail.

Contoh policy:

```text
Minimum absolute free space: 2 GiB
Minimum relative free space: 15%
Maximum accepted incoming file: 512 MiB
Per-tenant staging quota: 5 GiB
Global staging quota: 50 GiB
Processing queue pause threshold: usable < 10 GiB
Processing queue resume threshold: usable > 20 GiB
```

Kenapa butuh absolute dan relative threshold?

Karena:

```text
15% dari 10 GiB = 1.5 GiB
15% dari 10 TiB = 1.5 TiB
```

Sistem kecil butuh minimum absolute. Sistem besar tidak selalu butuh reserve sebesar persentase besar.

Policy realistis biasanya gabungan:

```java
public final class CapacityPolicy {
    private final long minUsableBytes;
    private final double minUsableRatio;
    private final long maxSingleWriteBytes;

    public CapacityPolicy(long minUsableBytes, double minUsableRatio, long maxSingleWriteBytes) {
        if (minUsableBytes < 0) {
            throw new IllegalArgumentException("minUsableBytes must be >= 0");
        }
        if (minUsableRatio < 0.0 || minUsableRatio > 1.0) {
            throw new IllegalArgumentException("minUsableRatio must be between 0 and 1");
        }
        if (maxSingleWriteBytes <= 0) {
            throw new IllegalArgumentException("maxSingleWriteBytes must be > 0");
        }
        this.minUsableBytes = minUsableBytes;
        this.minUsableRatio = minUsableRatio;
        this.maxSingleWriteBytes = maxSingleWriteBytes;
    }

    public CapacityDecision evaluate(FileStoreSnapshot snapshot, long requestedWriteBytes) {
        if (requestedWriteBytes > maxSingleWriteBytes) {
            return CapacityDecision.reject("requested write exceeds max single write size");
        }

        long usable = snapshot.usableBytes();
        long total = snapshot.totalBytes();

        if (usable < minUsableBytes) {
            return CapacityDecision.reject("usable space below absolute reserve");
        }

        if (total > 0) {
            double usableRatio = (double) usable / (double) total;
            if (usableRatio < minUsableRatio) {
                return CapacityDecision.reject("usable space below ratio reserve");
            }
        }

        long remainingAfterWrite = usable - requestedWriteBytes;
        if (remainingAfterWrite < minUsableBytes) {
            return CapacityDecision.reject("write would breach absolute reserve");
        }

        return CapacityDecision.allow();
    }
}

public final class CapacityDecision {
    private final boolean allowed;
    private final String reason;

    private CapacityDecision(boolean allowed, String reason) {
        this.allowed = allowed;
        this.reason = reason;
    }

    public static CapacityDecision allow() {
        return new CapacityDecision(true, "allowed");
    }

    public static CapacityDecision reject(String reason) {
        return new CapacityDecision(false, reason);
    }

    public boolean allowed() {
        return allowed;
    }

    public String reason() {
        return reason;
    }
}
```

Tetap ingat: ini admission control, bukan guarantee.

---

## 10. Hysteresis: Jangan Pause/Resume Dengan Threshold yang Sama

Bad design:

```text
pause when free < 10 GiB
resume when free >= 10 GiB
```

Ini bisa menyebabkan flapping:

```text
9.9 GiB → pause
10.1 GiB → resume
9.8 GiB → pause
10.2 GiB → resume
```

Gunakan hysteresis:

```text
pause when free < 10 GiB
resume when free > 20 GiB
```

Contoh:

```java
public final class CapacityGate {
    private final long pauseBelowBytes;
    private final long resumeAboveBytes;
    private volatile boolean paused;

    public CapacityGate(long pauseBelowBytes, long resumeAboveBytes) {
        if (pauseBelowBytes >= resumeAboveBytes) {
            throw new IllegalArgumentException("pause threshold must be lower than resume threshold");
        }
        this.pauseBelowBytes = pauseBelowBytes;
        this.resumeAboveBytes = resumeAboveBytes;
    }

    public synchronized boolean update(long usableBytes) {
        if (!paused && usableBytes < pauseBelowBytes) {
            paused = true;
        } else if (paused && usableBytes > resumeAboveBytes) {
            paused = false;
        }
        return paused;
    }

    public boolean paused() {
        return paused;
    }
}
```

Gunakan untuk:

- stop accepting upload
- pause background processor
- reduce batch size
- disable export job
- reject non-critical file generation

---

## 11. Quota: Kenapa `df` Terlihat Aman tapi Write Tetap Gagal

Filesystem quota dapat membatasi konsumsi storage oleh:

- user
- group
- project
- directory subtree
- container/pod
- volume claim
- tenant/application-level logical quota

Contoh:

```text
Filesystem total free: 200 GiB
User quota remaining: 500 MiB
Aplikasi menulis 1 GiB
Result: write fails
```

Di Java standard API, quota tidak selalu terekspos secara portable.

`getUsableSpace()` mungkin mencerminkan sebagian quota, tetapi jangan mengandalkan itu untuk semua platform/provider.

Untuk aplikasi multi-tenant, buat quota sendiri di level aplikasi:

```text
tenant_id
used_bytes
reserved_bytes
committed_bytes
last_reconciled_at
```

Workflow:

```text
1. request arrives with expected size
2. reserve quota
3. write to staging
4. compute actual size
5. commit usage
6. release reservation on failure/cleanup
```

Kenapa butuh reservation?

Karena tanpa reservation:

```text
Tenant A upload 4 GiB
Tenant A upload 4 GiB concurrently
Quota 5 GiB
Keduanya melihat used=0
Keduanya diterima
Total 8 GiB masuk
```

---

## 12. Reservation Pattern untuk File Intake

Contoh model sederhana:

```java
public interface StorageQuotaRepository {
    boolean tryReserve(String tenantId, long bytes);
    void commit(String tenantId, long reservedBytes, long actualBytes);
    void release(String tenantId, long reservedBytes);
}
```

File intake flow:

```java
public void acceptUpload(String tenantId, Path incomingTemp, long declaredSize) throws IOException {
    boolean reserved = quotaRepository.tryReserve(tenantId, declaredSize);
    if (!reserved) {
        throw new StorageRejectedException("tenant quota exceeded");
    }

    try {
        Path staged = writeToStaging(tenantId, incomingTemp);
        long actualSize = Files.size(staged);

        if (actualSize > declaredSize) {
            throw new StorageRejectedException("actual size exceeds declared reservation");
        }

        publishAtomically(staged);
        quotaRepository.commit(tenantId, declaredSize, actualSize);
    } catch (Exception e) {
        quotaRepository.release(tenantId, declaredSize);
        throw e;
    }
}
```

Di production, `tryReserve` harus atomic, misalnya via database transaction:

```sql
UPDATE tenant_storage_quota
SET reserved_bytes = reserved_bytes + :bytes
WHERE tenant_id = :tenant_id
  AND used_bytes + reserved_bytes + :bytes <= quota_bytes
```

Lalu cek affected row = 1.

Ini jauh lebih kuat daripada hanya cek directory size.

---

## 13. Inode Exhaustion: Disk Masih Kosong, Tapi Tidak Bisa Buat File

Pada banyak filesystem Unix-like, file membutuhkan metadata record seperti inode.

Failure mode:

```text
Disk free bytes: 100 GiB
Free inode: 0
Create new file: fails
```

Penyebab:

- terlalu banyak file kecil
- temporary files tidak dibersihkan
- per-request log/debug dump
- cache exploded menjadi jutaan object kecil
- directory fanout buruk

Java `FileStore` standard tidak memberi portable method untuk inode free.

Maka guardrail Java perlu dikombinasikan dengan observability OS/platform:

- Linux: `df -i`
- node exporter filesystem inode metrics
- Kubernetes node filesystem inode pressure
- cloud monitoring
- custom sidecar/agent jika perlu

Aplikasi juga bisa mengurangi risiko dengan desain layout:

```text
Bad:
/data/cache/tenantA/1 file per request, jutaan file flat

Better:
/data/cache/tenantA/ab/cd/<content-hash>
```

Hash fanout:

```java
public static Path fanoutBySha256(Path root, String hexSha256) {
    if (hexSha256.length() < 4) {
        throw new IllegalArgumentException("hash too short");
    }
    return root
            .resolve(hexSha256.substring(0, 2))
            .resolve(hexSha256.substring(2, 4))
            .resolve(hexSha256);
}
```

Tujuannya:

- menghindari satu directory berisi jutaan entry
- mempercepat listing/lookup pada banyak filesystem
- membuat cleanup per-prefix lebih manageable

---

## 14. Deleted But Still Open: Free Space Tidak Langsung Kembali

Di Unix-like system, file yang sudah dihapus dari directory masih bisa tetap mengonsumsi disk selama masih ada process yang memegang file descriptor.

Mental model:

```text
Directory entry removed
  ≠
File storage released immediately
```

Storage baru dilepas saat:

```text
link count == 0 AND no open file handle remains
```

Dampak production:

```text
rm large.log
free space tidak naik
karena process masih menulis ke deleted file handle
```

Di Java:

```java
OutputStream out = Files.newOutputStream(logPath);
Files.delete(logPath);
out.write(...); // pada Unix-like, handle masih bisa hidup
```

Pada Windows, delete file yang sedang dibuka sering gagal tergantung sharing mode/handle.

Operational lesson:

- close resource dengan disiplin
- jangan mengandalkan delete untuk segera mengembalikan space di semua OS
- observability perlu melihat open deleted files di OS bila troubleshooting
- log rotation harus compatible dengan process writer

---

## 15. Temporary File Leak

Temp file adalah salah satu penyebab paling umum disk penuh.

Contoh buruk:

```java
Path temp = Files.createTempFile("export-", ".zip");
writeExport(temp);
return temp;
```

Jika caller gagal cleanup, file tertinggal.

Pattern lebih baik:

```java
Path temp = Files.createTempFile(tempDir, "export-", ".zip");
try {
    writeExport(temp);
    sendToClient(temp);
} finally {
    try {
        Files.deleteIfExists(temp);
    } catch (IOException cleanupFailure) {
        log.warn("Failed to delete temp file {}", temp, cleanupFailure);
    }
}
```

Namun cleanup di `finally` saja tidak cukup untuk crash.

Butuh janitor/reaper:

```text
/temp/app
  /staging
  /export
  /upload
```

Policy:

```text
delete temp files older than 24h
quarantine suspicious partial files
limit max temp directory usage
emit metrics cleanup_deleted_bytes
```

---

## 16. Safe Cleanup Tidak Boleh Buta

Jangan pernah membuat cleanup job seperti ini:

```java
Files.walk(root)
     .sorted(Comparator.reverseOrder())
     .forEach(path -> Files.deleteIfExists(path));
```

Masalah:

- bisa menghapus root jika root salah
- bisa follow symlink jika tidak hati-hati
- tidak ada age filter
- tidak ada ownership marker
- tidak ada quota delete budget
- tidak ada dry-run
- tidak ada audit log

Cleanup yang aman harus punya guard:

```text
1. root harus absolute dan real path
2. root harus berada di allowlist
3. file harus punya marker/prefix/metadata yang menunjukkan milik aplikasi
4. age harus melewati threshold
5. symlink tidak di-follow
6. delete budget per run
7. log summary
8. metrics deleted count/bytes/failures
```

Contoh marker-based cleanup:

```java
public final class TempReaper {
    private final Path root;
    private final Duration maxAge;
    private final int maxDeletesPerRun;

    public TempReaper(Path root, Duration maxAge, int maxDeletesPerRun) {
        this.root = root;
        this.maxAge = maxAge;
        this.maxDeletesPerRun = maxDeletesPerRun;
    }

    public int reap() throws IOException {
        Path realRoot = root.toRealPath();
        Instant cutoff = Instant.now().minus(maxAge);
        AtomicInteger deleted = new AtomicInteger();

        try (Stream<Path> stream = Files.list(realRoot)) {
            Iterator<Path> iterator = stream.iterator();
            while (iterator.hasNext() && deleted.get() < maxDeletesPerRun) {
                Path candidate = iterator.next();

                if (!candidate.getFileName().toString().startsWith("app-tmp-")) {
                    continue;
                }

                BasicFileAttributes attrs = Files.readAttributes(
                        candidate,
                        BasicFileAttributes.class,
                        LinkOption.NOFOLLOW_LINKS
                );

                if (!attrs.isRegularFile()) {
                    continue;
                }

                if (attrs.lastModifiedTime().toInstant().isAfter(cutoff)) {
                    continue;
                }

                Files.deleteIfExists(candidate);
                deleted.incrementAndGet();
            }
        }

        return deleted.get();
    }
}
```

Catatan:

- ini contoh sederhana
- untuk recursive cleanup, gunakan `FileVisitor`
- jangan follow symlink untuk cleanup keamanan
- jangan delete unlimited dalam satu run

---

## 17. Storage Capacity dan Backpressure

Ketika storage menipis, aplikasi tidak boleh terus menerima workload dengan kecepatan sama.

Backpressure dapat diterapkan di beberapa level:

```text
HTTP/API layer:
  reject upload/export request dengan 503/429/domain error

Queue layer:
  pause consumer
  reduce poll size
  extend retry delay

Batch layer:
  reduce batch size
  stop non-critical report generation

File processor:
  stop moving new file ke processing
  prioritize cleanup/quarantine

Tenant layer:
  throttle tenant besar
```

Contoh API response:

```text
HTTP 503 Service Unavailable
Retry-After: 300

{
  "code": "STORAGE_CAPACITY_GUARD_TRIGGERED",
  "message": "File processing is temporarily paused because storage capacity is below safety threshold.",
  "retryable": true
}
```

Kenapa bukan 500?

Karena ini bukan bug tak terduga. Ini kondisi operasional yang bisa didesain.

---

## 18. Low-Disk Mode State Machine

Daripada boolean ad-hoc, gunakan state machine.

```text
NORMAL
  ├── usable < warn threshold
  ↓
DEGRADED
  ├── usable < pause threshold
  ↓
PAUSED
  ├── cleanup successful and usable > resume threshold
  ↓
RECOVERING
  ├── stable for N checks
  ↓
NORMAL
```

State behavior:

| State | Behavior |
|---|---|
| `NORMAL` | Semua operasi berjalan normal |
| `DEGRADED` | Alert, reduce batch, disable non-critical generation |
| `PAUSED` | Reject/pause new writes, run cleanup, keep reads if safe |
| `RECOVERING` | Resume bertahap, avoid thundering herd |

Contoh class:

```java
public enum StorageMode {
    NORMAL,
    DEGRADED,
    PAUSED,
    RECOVERING
}
```

Transition harus berdasarkan beberapa check, bukan satu sample.

```text
Bad:
one sample free=9.9 GiB → PAUSED

Better:
3 consecutive samples below threshold → PAUSED
5 consecutive samples above resume threshold → RECOVERING/NORMAL
```

Ini menghindari false transition karena metric jitter.

---

## 19. Container Filesystem: Writable Layer vs Mounted Volume

Dalam container, path yang ditulis aplikasi bisa berada di:

```text
1. image layer read-only
2. writable container layer
3. emptyDir / ephemeral volume
4. ConfigMap/Secret projected volume
5. PersistentVolumeClaim
6. hostPath
7. network filesystem mount
```

Setiap lokasi punya capacity semantics berbeda.

Contoh:

```text
/tmp
  mungkin writable container layer atau emptyDir

/app/config
  bisa read-only ConfigMap

/data
  bisa PVC

/var/log/app
  bisa writable layer atau mounted volume
```

Jangan asumsi semua path writable dan durable.

Pada startup, aplikasi production dapat melakukan validation:

```java
public final class StorageStartupCheck {
    public static void verifyWritableDirectory(Path dir) throws IOException {
        Files.createDirectories(dir);

        if (!Files.isDirectory(dir)) {
            throw new IOException("Not a directory: " + dir);
        }

        Path probe = Files.createTempFile(dir, "startup-probe-", ".tmp");
        try {
            Files.writeString(probe, "ok");
        } finally {
            Files.deleteIfExists(probe);
        }
    }
}
```

Startup check tidak menjamin masa depan, tetapi mendeteksi misconfiguration awal:

- directory tidak ada
- permission salah
- read-only mount
- path mount salah
- security context salah

---

## 20. Kubernetes Ephemeral Storage

Di Kubernetes, local ephemeral storage dapat digunakan oleh:

- writable container layers
- logs
- `emptyDir` volumes, kecuali memory-backed
- temporary files

Kubernetes memungkinkan request/limit untuk `ephemeral-storage` pada container.

Contoh manifest:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
    ephemeral-storage: "2Gi"
  limits:
    cpu: "1"
    memory: "1Gi"
    ephemeral-storage: "5Gi"
```

Mental model:

```text
FileStore usable space inside container
  may not equal
Kubernetes ephemeral-storage limit remaining
```

Jika aplikasi menulis terlalu banyak ke local ephemeral storage, pod bisa terkena eviction.

Karena itu, untuk workload file besar:

- jangan simpan file besar di writable layer tanpa limit
- gunakan PVC/object storage untuk payload durable
- set `ephemeral-storage` request/limit
- expose application-level temp usage metrics
- cleanup temp file agresif tetapi aman
- batasi export/import concurrency

---

## 21. PVC dan Persistent Volume Capacity

Jika path berada di PVC:

```text
/data/uploads
```

Maka capacity lebih terkait ke volume tersebut daripada root filesystem container.

Namun tetap ada caveat:

- PVC bisa punya quota/limit sendiri
- filesystem di PVC bisa penuh walau node masih longgar
- performance bisa turun sebelum penuh
- resize PVC tidak selalu langsung tercermin ke filesystem tanpa expansion process
- network-backed PVC punya latency/throughput berbeda

Startup observability sebaiknya mencatat:

```text
path=/data/uploads
store.name=...
store.type=...
total=...
usable=...
unallocated=...
```

Ini membantu debugging:

```text
Aplikasi menulis ke /tmp padahal harusnya ke /data
```

atau:

```text
PVC mounted ke /data, tapi staging masih di root layer
```

---

## 22. Read-Only Filesystem dan Immutable Runtime

Banyak deployment security-conscious menggunakan:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Maka aplikasi harus menulis hanya ke explicit writable mount:

```text
/tmp
/data
/work
```

Jika aplikasi diam-diam menulis ke:

```text
./logs
./cache
user.home
java.io.tmpdir
```

maka bisa gagal di runtime.

Best practice:

```text
All writable paths must be explicit configuration.
```

Contoh config:

```yaml
app:
  storage:
    inbox-dir: /data/inbox
    staging-dir: /data/staging
    temp-dir: /work/tmp
    quarantine-dir: /data/quarantine
```

Jangan hardcode:

```java
Path temp = Paths.get("tmp");
```

Lebih baik:

```java
Path temp = config.storageTempDir();
```

---

## 23. Object Storage Bukan Filesystem

Sering ada provider atau library yang membuat object storage terlihat seperti filesystem.

Namun object storage seperti S3-compatible storage bukan POSIX filesystem.

Perbedaan penting:

| Filesystem | Object Storage |
|---|---|
| Directory hierarchy nyata/semu tergantung FS | Prefix-based key namespace |
| Rename bisa metadata operation | Rename biasanya copy + delete |
| Atomic move mungkin tersedia | Umumnya tidak atomic seperti POSIX rename |
| File lock mungkin ada | Locking biasanya bukan primitive native yang sama |
| Partial update mungkin ada | Object biasanya replace whole object/multipart |
| WatchService lokal mungkin bisa | Event model berbeda |

Jadi `FileStore` capacity pattern tidak langsung berlaku untuk object storage.

Untuk object storage, guardrail berbeda:

- bucket quota
- lifecycle policy
- multipart upload cleanup
- request rate
- storage class
- object count
- eventual/strong consistency model sesuai provider
- retry semantics

Jangan memaksakan filesystem invariant ke object storage.

---

## 24. Network Filesystem: Kapasitas dan Latency Tidak Lokal

Pada NFS/SMB/EFS-like storage, `getUsableSpace()` bisa dipengaruhi oleh server, mount option, cache, permission, dan quota server-side.

Masalah umum:

- usable space stale
- latency tinggi untuk metadata-heavy operation
- quota server-side tidak terlihat jelas
- lock behavior berbeda
- write accepted locally lalu gagal flush
- network partition
- stale file handle

Guardrail tambahan:

```text
1. timeout-aware operation
2. retry dengan idempotency
3. avoid millions of tiny files
4. avoid assuming lock reliability across clients
5. monitor server-side metrics
6. maintain application-level quota
```

Untuk distributed writer, jangan mengandalkan `getUsableSpace()` per node sebagai global truth.

---

## 25. Capacity-Aware Writer Pattern

Sekarang kita gabungkan konsepnya.

Goal:

```text
Write file only if capacity guard allows,
write through staging,
cleanup on failure,
publish atomically,
emit metrics.
```

Skeleton:

```java
public final class CapacityAwareFileWriter {
    private final Path targetDirectory;
    private final Path stagingDirectory;
    private final CapacityPolicy capacityPolicy;

    public CapacityAwareFileWriter(
            Path targetDirectory,
            Path stagingDirectory,
            CapacityPolicy capacityPolicy
    ) {
        this.targetDirectory = targetDirectory;
        this.stagingDirectory = stagingDirectory;
        this.capacityPolicy = capacityPolicy;
    }

    public Path write(String finalFileName, byte[] bytes) throws IOException {
        Files.createDirectories(targetDirectory);
        Files.createDirectories(stagingDirectory);

        FileStoreSnapshot snapshot = FileStoreSnapshot.capture(stagingDirectory);
        CapacityDecision decision = capacityPolicy.evaluate(snapshot, bytes.length);

        if (!decision.allowed()) {
            throw new IOException("Storage capacity guard rejected write: " + decision.reason());
        }

        Path staged = Files.createTempFile(stagingDirectory, "stage-", ".tmp");
        boolean stagedExists = true;

        try {
            Files.write(staged, bytes, StandardOpenOption.TRUNCATE_EXISTING);

            Path target = targetDirectory.resolve(finalFileName);
            Files.move(
                    staged,
                    target,
                    StandardCopyOption.ATOMIC_MOVE
            );
            stagedExists = false;
            return target;
        } catch (IOException e) {
            throw e;
        } finally {
            if (stagedExists) {
                try {
                    Files.deleteIfExists(staged);
                } catch (IOException cleanupFailure) {
                    // log but do not mask original failure in real implementation
                }
            }
        }
    }
}
```

Production improvements:

- use `FileChannel.force(true)` for durable file
- fsync parent directory if platform supports via directory channel
- check target name containment
- separate domain exception for capacity rejection
- emit metrics
- handle `AtomicMoveNotSupportedException`
- avoid byte[] for large file; stream instead

---

## 26. Large File Streaming dengan Capacity Guard

Untuk file besar, jangan load semua ke memory.

```java
public Path writeFromStream(String finalFileName, InputStream input, long expectedBytes) throws IOException {
    Files.createDirectories(targetDirectory);
    Files.createDirectories(stagingDirectory);

    FileStoreSnapshot snapshot = FileStoreSnapshot.capture(stagingDirectory);
    CapacityDecision decision = capacityPolicy.evaluate(snapshot, expectedBytes);

    if (!decision.allowed()) {
        throw new IOException("Storage capacity guard rejected write: " + decision.reason());
    }

    Path staged = Files.createTempFile(stagingDirectory, "stage-", ".tmp");
    boolean stagedExists = true;

    try (OutputStream out = Files.newOutputStream(staged, StandardOpenOption.WRITE)) {
        byte[] buffer = new byte[64 * 1024];
        long written = 0L;

        while (true) {
            int read = input.read(buffer);
            if (read == -1) {
                break;
            }

            written += read;

            if (written > expectedBytes) {
                throw new IOException("Input exceeded expected size");
            }

            out.write(buffer, 0, read);
        }
    } catch (IOException e) {
        throw e;
    }

    try {
        Path target = targetDirectory.resolve(finalFileName);
        Files.move(staged, target, StandardCopyOption.ATOMIC_MOVE);
        stagedExists = false;
        return target;
    } finally {
        if (stagedExists) {
            try {
                Files.deleteIfExists(staged);
            } catch (IOException ignored) {
                // log in real code
            }
        }
    }
}
```

Critical details:

- expected size is admission input, not truth
- count actual bytes while streaming
- reject if actual exceeds expected/reserved
- cleanup staged file on failure
- publish only when fully written

---

## 27. Reserving Capacity Locally: Why It Is Hard

Kadang engineer ingin “reserve disk space” sebelum write.

Portable Java standard library tidak menyediakan API umum untuk preallocate disk blocks.

Beberapa platform punya native mechanism seperti:

- `fallocate` di Linux
- sparse file behavior
- filesystem-specific allocation APIs

Java `StandardOpenOption.SPARSE` hanya hint untuk sparse file saat create, bukan general quota reservation.

Jangan menganggap membuat file dengan size tertentu otomatis mengalokasikan semua block.

Contoh:

```java
try (SeekableByteChannel channel = Files.newByteChannel(path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE,
        StandardOpenOption.SPARSE)) {
    channel.position(10L * 1024 * 1024 * 1024);
    channel.write(ByteBuffer.wrap(new byte[]{0}));
}
```

Pada filesystem yang mendukung sparse file, logical size bisa besar tetapi physical blocks kecil.

Karena itu:

```text
file size != allocated disk usage
```

Dan:

```text
capacity reservation portable != available in core Java
```

---

## 28. Directory Size Calculation: Mahal dan Tidak Atomic

Menghitung total size directory sering terlihat mudah:

```java
long size = Files.walk(dir)
        .filter(Files::isRegularFile)
        .mapToLong(path -> {
            try {
                return Files.size(path);
            } catch (IOException e) {
                return 0L;
            }
        })
        .sum();
```

Masalah:

- mahal untuk directory besar
- tidak atomic
- file bisa berubah saat dihitung
- symlink bisa membingungkan
- hard link bisa double-count
- sparse file logical size bisa misleading
- permission error bisa menyebabkan undercount

Directory size scan cocok untuk:

- periodic reconciliation
- approximate reporting
- cleanup candidate selection

Tidak cocok untuk:

- per-request quota enforcement utama
- real-time admission control pada high-throughput system

Untuk quota, gunakan ledger transactional.

---

## 29. Storage Ledger Pattern

Untuk sistem serius, kapasitas aplikasi sebaiknya punya ledger.

Tabel contoh:

```sql
CREATE TABLE storage_object (
    object_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    path VARCHAR(1024) NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 CHAR(64),
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    committed_at TIMESTAMP
);

CREATE TABLE tenant_storage_quota (
    tenant_id VARCHAR(64) PRIMARY KEY,
    quota_bytes BIGINT NOT NULL,
    used_bytes BIGINT NOT NULL,
    reserved_bytes BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

State:

```text
RESERVED
STAGED
COMMITTED
QUARANTINED
DELETED
ORPHANED
```

Invariant:

```text
used_bytes = sum(size_bytes where status = COMMITTED)
reserved_bytes = sum(expected/reserved where status in RESERVED/STAGED)
```

Periodic reconciliation:

```text
1. scan filesystem
2. compare with DB ledger
3. detect orphan files
4. detect missing files
5. correct or quarantine based on policy
```

Ini lebih baik daripada menjadikan filesystem sebagai satu-satunya database.

---

## 30. Metrics yang Harus Ada

Minimal metrics untuk file-producing service:

```text
storage_total_bytes{path,store,type}
storage_usable_bytes{path,store,type}
storage_unallocated_bytes{path,store,type}
storage_usable_ratio{path,store,type}
storage_capacity_mode{path}
storage_write_rejected_total{reason}
storage_write_failed_total{exception_class}
storage_written_bytes_total{workflow}
storage_temp_bytes{dir}
storage_temp_files{dir}
storage_cleanup_deleted_bytes_total{dir}
storage_cleanup_deleted_files_total{dir}
storage_cleanup_failed_total{dir,exception_class}
storage_quota_used_bytes{tenant}
storage_quota_reserved_bytes{tenant}
storage_quota_rejected_total{tenant,reason}
```

Untuk OS/platform:

```text
filesystem inode free
filesystem inode used ratio
node disk pressure
pod ephemeral storage usage
PVC usage
open deleted file bytes, if available
```

Logging event penting:

```text
capacity_guard_triggered
capacity_mode_changed
temp_cleanup_completed
write_failed_after_partial_progress
quota_reservation_failed
quota_reconciliation_mismatch
```

---

## 31. Alerting Strategy

Alert bertingkat:

```text
Warning:
  usable < 20% for 10 min
  or temp dir > 50 GiB

Critical:
  usable < 10% for 5 min
  or app mode PAUSED
  or cleanup failing repeatedly

Emergency:
  usable < 5%
  or write failures due to filesystem exception spike
  or Kubernetes DiskPressure / pod eviction
```

Hindari alert hanya berdasarkan single sample.

Gunakan:

- duration
- trend
- burn rate
- workflow impact

Contoh alert yang lebih berguna:

```text
Storage usable space will hit pause threshold in < 2 hours based on 6-hour write rate.
```

Lebih baik daripada:

```text
Disk 80% full.
```

Karena disk 80% full bisa aman atau bahaya tergantung write rate.

---

## 32. Capacity Planning

Pertanyaan capacity planning:

```text
1. Berapa rata-rata file masuk per hari?
2. Berapa p95/p99 ukuran file?
3. Berapa retention period?
4. Berapa amplification factor?
5. Berapa temp/staging overhead?
6. Berapa growth rate tenant terbesar?
7. Berapa cleanup delay saat failure?
8. Berapa backfill/import worst case?
9. Berapa operational reserve?
10. Apa failure behavior saat cleanup tidak berjalan?
```

Formula kasar:

```text
required_capacity = daily_ingest_bytes
                  × retention_days
                  × replication_or_copy_factor
                  × safety_factor
                  + temp_peak_bytes
                  + operational_reserve_bytes
```

Contoh:

```text
Daily ingest: 200 GiB
Retention: 30 days
Copy factor: 1.5   (staging + final + temporary overlap)
Safety factor: 1.3
Temp peak: 500 GiB
Reserve: 1 TiB

Required ≈ 200 × 30 × 1.5 × 1.3 + 500 + 1024 GiB
         ≈ 13,224 GiB
         ≈ 12.9 TiB
```

Capacity planning harus memasukkan temporary amplification.

Banyak incident terjadi bukan karena final storage terlalu besar, tetapi karena temporary overlap:

```text
existing final file
+ new temp file
+ backup file
+ archive file
+ log/debug dump
```

---

## 33. Common Anti-Patterns

### 33.1 Menggunakan `/tmp` untuk file besar tanpa batas

```text
/tmp sering berada di root filesystem atau ephemeral storage.
```

Akibat:

- root penuh
- pod evicted
- node pressure
- unrelated service terganggu

### 33.2 Menulis file final langsung

```text
Disk full di tengah write → file final corrupt/partial.
```

Gunakan staging + atomic publish.

### 33.3 Cleanup tanpa ownership marker

```text
Delete semua file older than X di directory shared.
```

Bahaya:

- hapus file service lain
- hapus file user
- hapus symlink target jika salah follow

### 33.4 Menganggap `getUsableSpace()` guarantee

```text
Cek free space berhasil, write tetap bisa gagal.
```

Tetap handle failure.

### 33.5 Mengabaikan inode

```text
Free bytes banyak, create file gagal.
```

Monitor inode untuk workload small-file.

### 33.6 Tidak punya tenant quota

```text
Satu tenant bisa menghabiskan storage semua tenant.
```

Gunakan quota ledger.

### 33.7 Tidak punya low-disk mode

```text
Saat disk menipis, aplikasi tetap menerima semua workload.
```

Gunakan pause/degraded/recovering mode.

---

## 34. Production Design Checklist

### 34.1 Path and store mapping

- [ ] Semua writable path explicit config.
- [ ] Startup check memastikan directory ada dan writable.
- [ ] Log `FileStore` name/type/total/usable untuk tiap critical directory.
- [ ] Staging dan final directory dipastikan berada di filesystem yang sama jika butuh atomic move.
- [ ] Temp directory tidak default sembarangan.

### 34.2 Capacity guard

- [ ] Ada absolute reserve.
- [ ] Ada relative reserve.
- [ ] Ada max single write size.
- [ ] Ada hysteresis pause/resume.
- [ ] Ada degraded/paused/recovering mode.
- [ ] Capacity check tidak dianggap guarantee.

### 34.3 Failure safety

- [ ] Write ke staging, bukan langsung final.
- [ ] Partial file dibersihkan atau dikarantina.
- [ ] Final publish atomic jika memungkinkan.
- [ ] IOException saat write tidak merusak file lama.
- [ ] Retry idempotent.

### 34.4 Quota

- [ ] Tenant/user quota bila multi-tenant.
- [ ] Reservation atomic.
- [ ] Commit/release reservation jelas.
- [ ] Periodic reconciliation dengan filesystem.
- [ ] Orphan file handling.

### 34.5 Cleanup

- [ ] Cleanup root allowlisted.
- [ ] Tidak follow symlink.
- [ ] Delete berdasarkan marker + age.
- [ ] Delete budget per run.
- [ ] Metrics cleanup count/bytes/failure.
- [ ] Crash leftover ditangani.

### 34.6 Observability

- [ ] total/usable/unallocated bytes.
- [ ] temp file count/bytes.
- [ ] write failure classification.
- [ ] capacity rejection count.
- [ ] storage mode gauge.
- [ ] inode metrics via platform.
- [ ] Kubernetes ephemeral/PVC metrics jika applicable.

---

## 35. Java 8–25 Compatibility Notes

### 35.1 `FileStore`

`FileStore` sudah tersedia sejak Java 7, sehingga aman untuk Java 8–25.

API utama:

```java
store.name()
store.type()
store.isReadOnly()
store.getTotalSpace()
store.getUsableSpace()
store.getUnallocatedSpace()
store.supportsFileAttributeView(...)
store.getFileStoreAttributeView(...)
store.getAttribute(...)
```

### 35.2 `Path.of` vs `Paths.get`

Java 8:

```java
Path p = Paths.get("/data");
```

Java 11+:

```java
Path p = Path.of("/data");
```

Untuk library yang harus support Java 8, gunakan `Paths.get`.

Untuk aplikasi Java modern 11–25, `Path.of` lebih idiomatic.

### 35.3 `Files.writeString`

`Files.writeString` tidak tersedia di Java 8.

Java 8 compatible:

```java
Files.write(path, text.getBytes(StandardCharsets.UTF_8));
```

Java 11+:

```java
Files.writeString(path, text, StandardCharsets.UTF_8);
```

### 35.4 Security Manager

Di Java modern, Security Manager tidak boleh dijadikan boundary utama untuk filesystem access. Mulai Java 24, Security Manager sudah dinonaktifkan permanen. Desain security harus berbasis:

- OS permission
- container security context
- least privilege runtime user
- path containment
- application authorization
- filesystem mount boundary

---

## 36. Example: Storage Health Endpoint

Contoh endpoint internal dapat mengembalikan snapshot:

```json
{
  "paths": [
    {
      "role": "staging",
      "path": "/data/staging",
      "storeName": "/dev/nvme1n1p1",
      "storeType": "ext4",
      "totalBytes": 107374182400,
      "usableBytes": 32212254720,
      "unallocatedBytes": 34359738368,
      "mode": "NORMAL"
    },
    {
      "role": "temp",
      "path": "/work/tmp",
      "storeName": "overlay",
      "storeType": "overlay",
      "totalBytes": 53687091200,
      "usableBytes": 4294967296,
      "unallocatedBytes": 5368709120,
      "mode": "DEGRADED"
    }
  ]
}
```

Catatan:

- Jangan expose endpoint ini publik.
- Bisa mengandung informasi infrastruktur.
- Cocok untuk internal readiness/diagnostic.

Readiness decision harus hati-hati.

Jika storage untuk critical write penuh, service mungkin harus not-ready agar traffic baru berhenti. Namun kalau service masih bisa serve read-only traffic, mungkin readiness tetap true tetapi write endpoint reject.

---

## 37. Example: Startup Storage Report

Log startup yang berguna:

```text
storage.path.role=inbox
storage.path=/data/inbox
storage.store.name=/dev/nvme1n1p1
storage.store.type=ext4
storage.total.bytes=107374182400
storage.usable.bytes=85899345920
storage.readonly=false
storage.sameStoreWithStaging=true
```

Untuk memastikan staging dan target satu store:

```java
public static boolean sameStore(Path a, Path b) throws IOException {
    FileStore storeA = Files.getFileStore(a);
    FileStore storeB = Files.getFileStore(b);
    return storeA.equals(storeB);
}
```

Caveat:

- `equals` behavior provider-dependent tetapi umumnya berguna untuk default filesystem.
- Untuk critical atomic move, validasi tetap harus dilakukan dengan actual move test atau handle `AtomicMoveNotSupportedException`.

---

## 38. Failure Matrix

| Scenario | Symptom | Design Response |
|---|---|---|
| Disk penuh sebelum write | capacity guard reject | Return retryable/domain error |
| Disk penuh saat write | `IOException`, partial staging file | Cleanup/quarantine staging, file final tidak disentuh |
| Disk penuh saat overwrite langsung | final file corrupt/empty | Hindari overwrite langsung |
| Quota habis | write gagal walau free bytes ada | App-level quota + handle IOException |
| Inode habis | create file gagal | Monitor inode, reduce small files, cleanup |
| Temp leak | usable space turun terus | Reaper + metrics + alert |
| Deleted open file | cleanup tidak menaikkan free space | Restart/close writer, inspect open handles |
| Pod ephemeral limit exceeded | pod evicted | Set limits, reduce temp, use PVC |
| PVC penuh | app write gagal | PVC monitoring, guardrail, retention cleanup |
| Network FS stale capacity | capacity angka tidak reliable | Server-side monitoring + conservative guard |

---

## 39. Top 1% Mental Model

Engineer biasa berpikir:

```text
Cek free space → tulis file
```

Engineer kuat berpikir:

```text
File write is an allocation workflow under uncertainty.
Capacity is a changing shared resource.
Free-space checks are hints.
Correctness comes from staging, idempotency, cleanup, quota, backpressure, and observability.
```

Engineer top-tier akan bertanya:

```text
1. Apakah path ini berada di filesystem yang benar?
2. Apakah staging dan final berada di same store?
3. Apa yang terjadi jika disk penuh di byte ke-N?
4. Apakah file lama tetap aman?
5. Apakah temp file bisa leak setelah crash?
6. Apakah satu tenant bisa menghabiskan semua kapasitas?
7. Apakah free bytes cukup tetapi inode habis?
8. Apakah container ephemeral limit berbeda dari FileStore usable space?
9. Apakah cleanup aman dari symlink/path traversal?
10. Apakah sistem masuk degraded/paused mode sebelum node collapse?
```

---

## 40. Ringkasan

Di bagian ini kita belajar bahwa kapasitas filesystem bukan sekadar angka `free space`.

Poin utama:

- `FileStore` adalah API utama Java untuk melihat store tempat path berada.
- `getTotalSpace()` memberi total size file store.
- `getUnallocatedSpace()` memberi unallocated bytes.
- `getUsableSpace()` lebih relevan untuk JVM, tetapi tetap hanya hint, bukan guarantee.
- Preflight capacity check adalah admission control, bukan correctness guarantee.
- Disk-full dapat menyebabkan partial file, corrupt overwrite, temp leak, dan workflow stuck.
- Critical write harus memakai staging + atomic publish.
- Multi-tenant storage butuh quota reservation/ledger.
- Inode exhaustion adalah failure mode terpisah dari free bytes.
- Container/Kubernetes punya ephemeral storage semantics yang tidak selalu sama dengan `FileStore` view.
- Aplikasi produksi butuh low-disk mode, hysteresis, backpressure, cleanup, metrics, dan alerting.

---

## 41. Latihan

### Latihan 1 — FileStore Snapshot CLI

Buat CLI Java yang menerima path lalu mencetak:

```text
path
store name
store type
readonly
total bytes
usable bytes
unallocated bytes
usable ratio
```

Pastikan support Java 8.

---

### Latihan 2 — Capacity Gate

Implementasikan `CapacityGate` dengan:

```text
WARN below 20%
PAUSE below 10%
RESUME above 25%
```

Tambahkan test untuk mencegah flapping.

---

### Latihan 3 — Safe Temp Reaper

Buat cleanup job untuk temp directory dengan aturan:

```text
- hanya delete file prefix app-tmp-
- hanya regular file
- NOFOLLOW_LINKS
- older than 24h
- max 1000 delete per run
- log total deleted bytes
```

---

### Latihan 4 — Quota Reservation

Desain tabel SQL dan pseudo-code untuk tenant quota:

```text
quota_bytes
used_bytes
reserved_bytes
```

Pastikan concurrent upload tidak bisa melewati quota.

---

### Latihan 5 — Failure Injection

Simulasikan write failure di tengah stream:

```text
InputStream yang melempar IOException setelah N bytes
```

Pastikan:

```text
- final file tidak dibuat
- staging file dibersihkan atau dikarantina
- quota reservation dilepas
```

---

## 42. Referensi

- Java SE 25 API — `java.nio.file.FileStore`
- Java SE 25 API — `java.nio.file.Files#getFileStore`
- Java SE 8 API — `java.nio.file.FileStore`
- Java SE 25 API — `java.nio.file.StandardOpenOption`
- Kubernetes Documentation — Resource Management for Pods and Containers
- Kubernetes Documentation — Local Ephemeral Storage
- Kubernetes Documentation — Node-pressure Eviction

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 15](./learn-java-io-file-filesystem-storage-engineering-part-15-permissions-model.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering](./learn-java-io-file-filesystem-storage-engineering-part-17-watchservice.md)

</div>