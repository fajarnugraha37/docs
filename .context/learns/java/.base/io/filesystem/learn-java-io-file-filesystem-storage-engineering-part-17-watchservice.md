# learn-java-io-file-filesystem-storage-engineering

## Part 17 — WatchService: Filesystem Events Are Hints, Not Truth

> Target Java: 8 sampai 25  
> Fokus: `WatchService`, filesystem event, `WatchKey`, event coalescing, `OVERFLOW`, recursive watch, debounce, reconciliation scan, dan desain watcher yang reliable untuk production.

---

## 1. Posisi Materi Ini dalam Seri

Sampai Part 16, kita sudah membangun fondasi besar:

1. `Path` bukan file, melainkan representasi lokasi.
2. `Files.exists` bukan lock dan bukan kebenaran abadi.
3. Create/copy/move/delete punya atomicity dan race semantics sendiri.
4. Traversal directory tidak membekukan file tree.
5. Link, permission, metadata, dan filesystem capacity sangat bergantung pada provider/OS/filesystem.

Sekarang kita masuk ke pertanyaan yang sering muncul dalam sistem real:

> “Bagaimana kalau aplikasi Java perlu tahu saat file masuk, berubah, atau dihapus?”

Java menyediakan `WatchService` di package `java.nio.file`. API ini ada sejak Java 7, berarti tersedia di Java 8, dan tetap ada sampai Java 25. Dokumentasi Java menyebut `WatchService` sebagai service untuk mengawasi objek yang terdaftar terhadap perubahan dan event. Contoh tipikalnya adalah file manager yang memonitor directory agar bisa memperbarui tampilan ketika file dibuat atau dihapus.

Namun kesalahan paling umum adalah memperlakukan `WatchService` sebagai event stream yang lengkap, ordered, durable, dan reliable seperti Kafka. Itu salah.

Mental model yang benar:

```text
WatchService bukan source of truth.
WatchService adalah sinyal bahwa sesuatu mungkin berubah.
Source of truth tetap filesystem state yang dibaca ulang.
```

Dengan kata lain:

```text
filesystem event -> trigger -> scan/reconcile -> decide
```

Bukan:

```text
filesystem event -> langsung dianggap fakta final
```

---

## 2. API Utama WatchService

Komponen utama:

| Komponen | Fungsi |
|---|---|
| `WatchService` | Service/event queue tempat watch key dikirim saat ada event. |
| `WatchKey` | Registration token untuk directory yang sedang di-watch. |
| `WatchEvent.Kind<?>` | Jenis event, misalnya create, modify, delete, overflow. |
| `WatchEvent<Path>` | Event dengan context berupa relative path entry di directory yang didaftarkan. |
| `StandardWatchEventKinds` | Constant event standar Java. |

Event standar:

```java
StandardWatchEventKinds.ENTRY_CREATE
StandardWatchEventKinds.ENTRY_MODIFY
StandardWatchEventKinds.ENTRY_DELETE
StandardWatchEventKinds.OVERFLOW
```

API dasar:

```java
Path dir = Path.of("/data/inbox"); // Java 11+

try (WatchService watcher = FileSystems.getDefault().newWatchService()) {
    dir.register(
        watcher,
        StandardWatchEventKinds.ENTRY_CREATE,
        StandardWatchEventKinds.ENTRY_MODIFY,
        StandardWatchEventKinds.ENTRY_DELETE
    );

    while (true) {
        WatchKey key = watcher.take(); // blocking

        for (WatchEvent<?> event : key.pollEvents()) {
            WatchEvent.Kind<?> kind = event.kind();

            if (kind == StandardWatchEventKinds.OVERFLOW) {
                // event mungkin hilang; harus rescan
                continue;
            }

            @SuppressWarnings("unchecked")
            WatchEvent<Path> pathEvent = (WatchEvent<Path>) event;
            Path relativeName = pathEvent.context();
            Path changed = dir.resolve(relativeName);

            System.out.println(kind.name() + " " + changed);
        }

        boolean valid = key.reset();
        if (!valid) {
            break;
        }
    }
}
```

Java 8 compatible:

```java
Path dir = Paths.get("/data/inbox");
```

Java 11+ preferred:

```java
Path dir = Path.of("/data/inbox");
```

---

## 3. WatchService Mengawasi Directory Entry, Bukan File Object Secara Umum

Ketika mendaftarkan path ke watch service, path yang umum didaftarkan adalah directory.

```java
dir.register(watcher, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
```

Artinya:

```text
Watch directory /data/inbox.
Laporkan event untuk entry langsung di dalam /data/inbox.
```

Bukan:

```text
Watch semua file di bawah /data/inbox secara recursive otomatis.
```

Dan bukan:

```text
Watch satu file tertentu secara portable sebagai entity global.
```

Context event biasanya adalah nama entry relatif terhadap directory yang di-register.

Contoh:

```text
registered directory: /data/inbox
created file:         /data/inbox/a.txt
event.context():      a.txt
resolved path:        /data/inbox/a.txt
```

Kode:

```java
Path dir = Path.of("/data/inbox");
WatchEvent<Path> e = cast(event);
Path child = dir.resolve(e.context());
```

Ini penting karena event context bukan absolute path.

---

## 4. WatchService Tidak Recursive Secara Default

Jika struktur:

```text
/data/inbox/
  a.txt
  sub/
    b.txt
```

Lalu hanya `/data/inbox` yang di-register, maka perubahan `sub/b.txt` tidak otomatis dilaporkan sebagai event file `b.txt`.

Yang bisa terjadi:

1. Event create untuk `sub` saat directory `sub` dibuat.
2. Tidak ada event untuk file yang sudah ada di dalam `sub` jika directory tersebut masuk secara bulk/copy.
3. Tidak ada event untuk perubahan di `sub` kecuali `sub` juga di-register.

Karena itu recursive watch harus dilakukan sendiri:

```text
initial walk tree -> register every directory
new directory event -> register new directory
periodic reconciliation -> discover missed directories/files
```

---

## 5. WatchKey Lifecycle

Setiap registration menghasilkan `WatchKey`.

Lifecycle konseptual:

```text
registered
  ↓
ready/signaled saat ada event
  ↓
pollEvents dibaca aplikasi
  ↓
reset
  ↓
registered lagi jika masih valid
```

Kode penting:

```java
WatchKey key = watcher.take();
List<WatchEvent<?>> events = key.pollEvents();
boolean valid = key.reset();
```

`reset()` wajib dipanggil setelah event diproses. Kalau tidak, key tidak kembali ke state siap menerima event baru.

Jika `reset()` mengembalikan `false`, artinya key tidak lagi valid. Penyebab umum:

1. Directory tidak lagi accessible.
2. Directory dihapus.
3. Watch service ditutup.
4. Provider/OS membatalkan registration.

Production rule:

```text
Setiap key harus dipetakan ke directory yang di-watch.
Saat key invalid, hapus dari registry internal.
Jika registry kosong, watcher mungkin harus berhenti atau melakukan full reinitialization.
```

Contoh registry:

```java
Map<WatchKey, Path> keys = new HashMap<>();
WatchKey key = dir.register(watcher, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
keys.put(key, dir);
```

Saat event:

```java
WatchKey key = watcher.take();
Path dir = keys.get(key);
if (dir == null) {
    key.reset();
    continue;
}
```

---

## 6. OVERFLOW: Sinyal Bahwa Event Mungkin Hilang

`OVERFLOW` adalah event paling penting untuk dipahami.

Maknanya:

```text
Ada event yang mungkin hilang atau dibuang.
Aplikasi tidak boleh percaya bahwa event yang diterima lengkap.
```

Penyebab umum:

1. Event terlalu banyak dalam waktu singkat.
2. Queue internal penuh.
3. OS notification backend kehilangan event.
4. Aplikasi lambat memproses event.
5. Directory besar berubah secara masif.

Anti-pattern:

```java
if (event.kind() == OVERFLOW) {
    continue; // salah jika tidak ada reconciliation
}
```

Pattern benar:

```java
if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
    markDirectoryDirty(dir);
    continue;
}
```

Lalu:

```text
dirty directory -> scheduled reconciliation scan
```

Untuk sistem file intake:

```text
OVERFLOW berarti:
- jangan panik
- jangan stop otomatis
- jangan abaikan
- lakukan full scan ulang pada directory terkait atau seluruh subtree
```

---

## 7. Event Coalescing: Banyak Perubahan Bisa Jadi Sedikit Event

Filesystem watcher sering melakukan coalescing.

Contoh operasi:

```text
write chunk 1
write chunk 2
write chunk 3
close file
```

Aplikasi bisa menerima:

```text
ENTRY_CREATE a.dat
ENTRY_MODIFY a.dat
```

Atau:

```text
ENTRY_CREATE a.dat
ENTRY_MODIFY a.dat
ENTRY_MODIFY a.dat
ENTRY_MODIFY a.dat
```

Atau hanya:

```text
ENTRY_MODIFY a.dat
```

Atau event datang sebelum writer benar-benar selesai menulis.

Karena itu jangan membuat logic seperti ini:

```text
on ENTRY_CREATE -> langsung proses file
```

Lebih aman:

```text
on ENTRY_CREATE/MODIFY -> mark candidate
candidate -> wait stable window -> stat/read/claim/process
```

---

## 8. Event Ordering Tidak Boleh Dianggap Sebagai Transaction Log

Walaupun dalam beberapa kasus event terlihat berurutan, production code tidak boleh mengasumsikan ordering sempurna.

Contoh operasi nyata:

```text
producer writes temp file
producer renames temp -> final
```

Watcher mungkin melihat:

```text
ENTRY_CREATE file.tmp
ENTRY_MODIFY file.tmp
ENTRY_DELETE file.tmp
ENTRY_CREATE file.dat
```

Atau hanya:

```text
ENTRY_CREATE file.dat
```

Atau event temp muncul tapi final event terlambat.

Untuk desain yang benar, event harus dianggap sebagai trigger untuk membaca state terbaru:

```java
void onEvent(Path path) {
    pending.add(path);
}

void reconcile(Path dir) {
    // baca state directory sekarang
    // bandingkan dengan state yang sudah diketahui
    // process candidate yang memenuhi invariant
}
```

---

## 9. File Modified Event Tidak Berarti File Sudah Siap Diproses

Ini salah satu bug paling umum.

Misalnya producer menulis file besar:

```text
/data/inbox/report.csv
```

Consumer mendapat event:

```text
ENTRY_CREATE report.csv
```

Lalu langsung membaca file. Risiko:

1. File belum selesai ditulis.
2. File masih bertambah.
3. Writer belum flush.
4. Writer belum close.
5. File masih di-lock di Windows.
6. Checksum belum lengkap.
7. Metadata belum final.

Solusi terbaik adalah kontrak producer-consumer yang eksplisit.

### 9.1 Pattern: Write Temp Then Rename Final

Producer:

```text
write report.csv.tmp
fsync/close
rename report.csv.tmp -> report.csv
```

Consumer hanya memproses file final:

```text
ignore *.tmp
process *.csv only after stable
```

### 9.2 Pattern: Manifest/Done Marker

Producer:

```text
payload: report.csv
marker:  report.csv.done
```

Consumer:

```text
only process report.csv if report.csv.done exists
```

Lebih kuat:

```text
manifest contains:
- filename
- size
- sha256
- record count
- created timestamp
```

Consumer memvalidasi manifest sebelum proses.

### 9.3 Pattern: Stable Size Window

Jika tidak bisa mengubah producer:

```text
file candidate ditemukan
wait N ms
stat size + modified time
wait N ms
stat ulang
jika size dan mtime stabil -> process
```

Ini hanya heuristic, bukan guarantee.

---

## 10. WatchService Polling Model

Ada tiga cara mengambil key:

```java
WatchKey key = watcher.take(); // blocking sampai ada key
```

```java
WatchKey key = watcher.poll(); // langsung return null jika tidak ada
```

```java
WatchKey key = watcher.poll(5, TimeUnit.SECONDS); // tunggu dengan timeout
```

### 10.1 `take()`

Cocok untuk dedicated watcher thread:

```java
while (!Thread.currentThread().isInterrupted()) {
    WatchKey key = watcher.take();
    handle(key);
}
```

Masalah:

1. Shutdown harus menutup watcher atau interrupt thread.
2. Thread bisa stuck jika tidak ada event.

### 10.2 `poll()`

Cocok jika loop juga mengerjakan hal lain, tapi riskan busy-spin jika tidak diberi sleep/backoff.

```java
WatchKey key = watcher.poll();
if (key == null) {
    Thread.sleep(100);
    return;
}
```

### 10.3 `poll(timeout)`

Sering paling practical untuk service:

```java
while (running.get()) {
    WatchKey key = watcher.poll(1, TimeUnit.SECONDS);
    if (key != null) {
        handle(key);
    }
    runPeriodicReconciliationIfDue();
}
```

Keuntungan:

1. Bisa periodic reconciliation.
2. Bisa shutdown graceful.
3. Bisa emit heartbeat metric.
4. Bisa cek health state.

---

## 11. Minimal Watcher yang Benar

Contoh ini belum recursive, tetapi sudah menangani:

1. key registry
2. overflow
3. reset
4. invalid key
5. event context resolution
6. safe shutdown via close

```java
import java.io.Closeable;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import static java.nio.file.StandardWatchEventKinds.*;

public final class DirectoryWatcher implements Closeable, Runnable {
    private final WatchService watcher;
    private final Map<WatchKey, Path> keys = new HashMap<>();
    private volatile boolean running = true;

    public DirectoryWatcher(Path dir) throws IOException {
        this.watcher = dir.getFileSystem().newWatchService();
        register(dir);
    }

    private void register(Path dir) throws IOException {
        WatchKey key = dir.register(watcher, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
        keys.put(key, dir);
    }

    @Override
    public void run() {
        while (running) {
            WatchKey key;
            try {
                key = watcher.poll(1, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (ClosedWatchServiceException e) {
                break;
            }

            if (key == null) {
                continue;
            }

            Path dir = keys.get(key);
            if (dir == null) {
                key.reset();
                continue;
            }

            boolean overflow = false;

            for (WatchEvent<?> rawEvent : key.pollEvents()) {
                WatchEvent.Kind<?> kind = rawEvent.kind();

                if (kind == OVERFLOW) {
                    overflow = true;
                    continue;
                }

                WatchEvent<Path> event = cast(rawEvent);
                Path changed = dir.resolve(event.context());

                onChanged(kind, changed);
            }

            if (overflow) {
                onOverflow(dir);
            }

            boolean valid = key.reset();
            if (!valid) {
                keys.remove(key);
                onDirectoryUnavailable(dir);
            }
        }
    }

    private void onChanged(WatchEvent.Kind<?> kind, Path path) {
        System.out.println(kind.name() + " " + path);
    }

    private void onOverflow(Path dir) {
        System.err.println("Overflow for " + dir + "; schedule reconciliation scan");
    }

    private void onDirectoryUnavailable(Path dir) {
        System.err.println("Directory no longer watchable: " + dir);
    }

    @SuppressWarnings("unchecked")
    private static WatchEvent<Path> cast(WatchEvent<?> event) {
        return (WatchEvent<Path>) event;
    }

    @Override
    public void close() throws IOException {
        running = false;
        watcher.close();
    }
}
```

Java 8 compatible jika `Path.of` diganti `Paths.get` di pemanggil.

---

## 12. Debounce: Jangan Proses Setiap Event Mentah

Event file sering noisy.

Satu save dari editor bisa menghasilkan:

```text
ENTRY_CREATE .file.swp
ENTRY_MODIFY .file.swp
ENTRY_DELETE file.txt
ENTRY_CREATE file.txt
ENTRY_MODIFY file.txt
ENTRY_DELETE .file.swp
```

Satu copy file besar bisa menghasilkan banyak modify event.

Karena itu watcher harus memisahkan:

```text
event ingestion
candidate aggregation
stability/debounce
processing
```

### 12.1 Debounce Model

```text
on event for path P:
    pending[P].lastSeen = now

periodic worker:
    for each P where now - lastSeen >= quietPeriod:
        reconcile/process P
```

Contoh Java:

```java
final class DebounceBuffer {
    private final Map<Path, Long> lastSeenMillis = new HashMap<>();
    private final long quietMillis;

    DebounceBuffer(long quietMillis) {
        this.quietMillis = quietMillis;
    }

    synchronized void mark(Path path, long nowMillis) {
        lastSeenMillis.put(path, nowMillis);
    }

    synchronized List<Path> drainReady(long nowMillis) {
        List<Path> ready = new ArrayList<>();
        Iterator<Map.Entry<Path, Long>> it = lastSeenMillis.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<Path, Long> e = it.next();
            if (nowMillis - e.getValue() >= quietMillis) {
                ready.add(e.getKey());
                it.remove();
            }
        }
        return ready;
    }
}
```

Quiet period bukan correctness guarantee. Ia hanya noise control. Correctness tetap harus datang dari invariant seperti final rename, marker file, checksum, manifest, atau idempotent processing.

---

## 13. Reconciliation Scan: Komponen Wajib untuk Reliability

Watcher tanpa reconciliation adalah sistem rapuh.

Reconciliation berarti:

```text
Baca ulang filesystem state aktual.
Bandingkan dengan state aplikasi.
Proses item yang missing/dirty/unknown.
```

Kapan reconciliation dilakukan?

1. Saat startup.
2. Secara periodic.
3. Saat menerima `OVERFLOW`.
4. Saat watch key invalid.
5. Setelah service restart.
6. Setelah deployment.
7. Saat health check menemukan gap.
8. Saat directory baru ditemukan di recursive watch.

### 13.1 Startup Reconciliation

Saat service baru start, event sebelum service start sudah hilang. Jadi harus scan dulu.

```java
void startup(Path inbox) throws IOException {
    scanAndEnqueueExistingCandidates(inbox);
    startWatcher(inbox);
}
```

Tanpa ini, file yang sudah ada sebelum aplikasi hidup tidak akan diproses.

### 13.2 Periodic Reconciliation

```java
long nextScan = System.nanoTime();

while (running) {
    WatchKey key = watcher.poll(1, TimeUnit.SECONDS);
    if (key != null) {
        handle(key);
    }

    if (System.nanoTime() >= nextScan) {
        reconcileAllWatchedDirectories();
        nextScan = System.nanoTime() + TimeUnit.MINUTES.toNanos(5);
    }
}
```

### 13.3 Dirty Directory Reconciliation

```java
Set<Path> dirtyDirs = new HashSet<>();

void onOverflow(Path dir) {
    dirtyDirs.add(dir);
}

void processDirtyDirs() {
    for (Path dir : drainDirtyDirs()) {
        scanDirectory(dir);
    }
}
```

---

## 14. Recursive Watcher Design

Untuk recursive tree:

```text
root/
  a/
  b/
    c/
```

Harus register:

```text
root
root/a
root/b
root/b/c
```

### 14.1 Initial Registration

```java
void registerAll(Path root) throws IOException {
    Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs)
                throws IOException {
            register(dir);
            return FileVisitResult.CONTINUE;
        }
    });
}
```

Perlu import:

```java
import java.nio.file.attribute.BasicFileAttributes;
```

### 14.2 Register New Directory on Create

Saat event `ENTRY_CREATE`, jika path adalah directory, register directory tersebut.

```java
if (kind == ENTRY_CREATE) {
    try {
        if (Files.isDirectory(changed, LinkOption.NOFOLLOW_LINKS)) {
            registerAll(changed);
        }
    } catch (IOException e) {
        markParentDirty(dir);
    }
}
```

Kenapa `registerAll(changed)`, bukan hanya `register(changed)`?

Karena directory bisa muncul sudah berisi subtree, misalnya hasil extract/copy/move.

```text
newdir/
  a.txt
  child/
    b.txt
```

Jika hanya register `newdir`, event untuk `a.txt` dan `child/b.txt` yang sudah ada sebelum registration bisa tidak pernah muncul. Maka harus scan/register subtree.

---

## 15. Recursive Watcher Skeleton

```java
import java.io.Closeable;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.concurrent.TimeUnit;

import static java.nio.file.StandardWatchEventKinds.*;

public final class RecursiveDirectoryWatcher implements Runnable, Closeable {
    private final WatchService watcher;
    private final Map<WatchKey, Path> keys = new HashMap<>();
    private final Set<Path> dirtyDirectories = new HashSet<>();
    private volatile boolean running = true;

    public RecursiveDirectoryWatcher(Path root) throws IOException {
        this.watcher = root.getFileSystem().newWatchService();
        registerAll(root);
    }

    private void registerAll(Path root) throws IOException {
        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs)
                    throws IOException {
                register(dir);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                // Permission issue or transient deletion.
                // Production code should record this for reconciliation/reporting.
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void register(Path dir) throws IOException {
        WatchKey key = dir.register(watcher, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
        keys.put(key, dir);
    }

    @Override
    public void run() {
        while (running) {
            try {
                WatchKey key = watcher.poll(1, TimeUnit.SECONDS);
                if (key != null) {
                    processKey(key);
                }
                reconcileDirtyDirectories();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (ClosedWatchServiceException e) {
                break;
            } catch (IOException e) {
                // Production code: classify, log, metric, maybe trigger full rescan.
                e.printStackTrace();
            }
        }
    }

    private void processKey(WatchKey key) throws IOException {
        Path dir = keys.get(key);
        if (dir == null) {
            key.reset();
            return;
        }

        for (WatchEvent<?> raw : key.pollEvents()) {
            WatchEvent.Kind<?> kind = raw.kind();

            if (kind == OVERFLOW) {
                dirtyDirectories.add(dir);
                continue;
            }

            WatchEvent<Path> event = cast(raw);
            Path changed = dir.resolve(event.context());

            if (kind == ENTRY_CREATE) {
                handleCreate(dir, changed);
            } else if (kind == ENTRY_MODIFY) {
                handleModify(dir, changed);
            } else if (kind == ENTRY_DELETE) {
                handleDelete(dir, changed);
            }
        }

        boolean valid = key.reset();
        if (!valid) {
            keys.remove(key);
            dirtyDirectories.add(dir.getParent() != null ? dir.getParent() : dir);
        }
    }

    private void handleCreate(Path parent, Path changed) throws IOException {
        if (Files.isDirectory(changed, LinkOption.NOFOLLOW_LINKS)) {
            registerAll(changed);
            dirtyDirectories.add(changed); // scan contents that may have appeared before registration
        } else {
            onCandidate(changed);
        }
    }

    private void handleModify(Path parent, Path changed) {
        onCandidate(changed);
    }

    private void handleDelete(Path parent, Path changed) {
        onDeleted(changed);
    }

    private void reconcileDirtyDirectories() throws IOException {
        if (dirtyDirectories.isEmpty()) {
            return;
        }

        List<Path> dirs = new ArrayList<>(dirtyDirectories);
        dirtyDirectories.clear();

        for (Path dir : dirs) {
            if (Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS)) {
                scanDirectory(dir);
            }
        }
    }

    private void scanDirectory(Path dir) throws IOException {
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path child : stream) {
                if (Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)) {
                    // ensure directory is registered if missed
                    // production implementation should avoid duplicate register by real path map
                    onDirectorySeen(child);
                } else {
                    onCandidate(child);
                }
            }
        }
    }

    private void onDirectorySeen(Path dir) {
        // placeholder
    }

    private void onCandidate(Path file) {
        System.out.println("candidate: " + file);
    }

    private void onDeleted(Path file) {
        System.out.println("deleted: " + file);
    }

    @SuppressWarnings("unchecked")
    private static WatchEvent<Path> cast(WatchEvent<?> event) {
        return (WatchEvent<Path>) event;
    }

    @Override
    public void close() throws IOException {
        running = false;
        watcher.close();
    }
}
```

Catatan: skeleton ini sengaja belum memasukkan duplicate registration map berbasis real path karena itu akan dibahas bersama symlink/cycle/identity strategy. Untuk production, registry harus lebih kuat.

---

## 16. Duplicate Registration dan Directory Identity

Dalam recursive watcher, path string bisa menunjuk directory yang sama melalui:

1. symlink
2. bind mount
3. case-insensitive path variation
4. relative/absolute difference
5. `..` dan `.` normalization difference

Jika tidak hati-hati, watcher bisa mendaftarkan directory yang sama berkali-kali atau membuat loop.

Strategi:

```text
use toRealPath(NOFOLLOW_LINKS if appropriate)
keep Set<Path> registeredRealDirs
avoid FOLLOW_LINKS unless explicitly needed
```

Contoh:

```java
private final Set<Path> registeredDirectories = new HashSet<>();

private void registerOnce(Path dir) throws IOException {
    Path real = dir.toRealPath(LinkOption.NOFOLLOW_LINKS);
    if (!registeredDirectories.add(real)) {
        return;
    }

    WatchKey key = dir.register(watcher, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
    keys.put(key, dir);
}
```

Namun perlu dipahami:

1. `toRealPath` membutuhkan file/directory benar-benar ada.
2. Ia bisa gagal karena permission.
3. Pada filesystem tertentu identity semantics bisa berbeda.
4. Pada symlink-sensitive sandbox, mengikuti link bisa berbahaya.

---

## 17. WatchService dan Symbolic Link

Jika directory yang di-register adalah symlink, behavior tergantung provider dan OS.

Pertanyaan yang harus dijawab dalam desain:

1. Apakah aplikasi boleh watch symlinked directory?
2. Apakah aplikasi harus follow symlink?
3. Apakah symlink bisa diganti attacker setelah validasi?
4. Apakah event dari target harus dianggap bagian dari sandbox?
5. Apakah recursive traversal boleh melewati symlink directory?

Security-oriented default:

```text
Do not follow symlinks by default.
Treat symlink as boundary unless explicitly allowed.
```

Untuk intake directory yang menerima file dari pihak luar, hindari mengikuti symlink.

---

## 18. Platform Backend: Kenapa Behavior Bisa Berbeda

`WatchService` adalah Java abstraction di atas kemampuan OS/filesystem.

Secara konseptual:

```text
Java WatchService
  -> JDK provider implementation
  -> OS notification facility / fallback mechanism
  -> filesystem behavior
```

Contoh backend OS secara umum:

| OS | Konsep umum |
|---|---|
| Linux | inotify-like notification |
| Windows | directory change notification APIs |
| macOS/BSD | provider-specific behavior, historically polling/fsevents-like concerns tergantung JDK/platform |
| Network FS | bisa tidak reliable atau tidak didukung penuh |

Yang penting bukan menghafal backend, tetapi memahami konsekuensinya:

1. Event semantics tidak sepenuhnya portable.
2. Latency event bisa berbeda.
3. Duplicate/coalesced/missing event bisa terjadi.
4. Recursive watch tidak otomatis portable.
5. Network filesystem bisa sangat tricky.

Production rule:

```text
Test watcher pada OS dan filesystem production yang sebenarnya.
```

Jangan hanya test di laptop lalu deploy ke container + network volume dan menganggap behavior sama.

---

## 19. WatchService di Container dan Kubernetes

Di container, path yang terlihat aplikasi bisa berasal dari beberapa sumber:

1. writable container layer
2. `emptyDir`
3. PersistentVolumeClaim
4. ConfigMap volume
5. Secret volume
6. projected volume
7. hostPath
8. network filesystem

Setiap sumber bisa punya semantics berbeda.

### 19.1 ConfigMap/Secret Volume Caveat

Kubernetes ConfigMap/Secret volume sering di-update dengan mekanisme atomic symlink/swap internal. Aplikasi yang watch file tertentu bisa tidak mendapat event seperti yang diharapkan.

Pattern lebih aman:

```text
watch parent directory
periodically re-read config
validate version/checksum
support explicit reload endpoint/signal
```

### 19.2 PVC/Network Volume Caveat

Jika volume backend adalah network filesystem:

1. event bisa tidak muncul antar node
2. latency bisa tinggi
3. ordering tidak reliable
4. lock dan rename semantics perlu diuji
5. watcher di pod A belum tentu melihat update dari pod B seperti local disk

Untuk multi-pod processing, watcher saja tidak cukup. Biasanya perlu database/queue/lease.

---

## 20. Designing a Reliable File Intake Watcher

Misal aplikasi perlu memproses file yang masuk ke:

```text
/data/inbox
```

Target behavior:

1. File yang sudah ada saat startup tetap diproses.
2. File baru diproses.
3. File yang event-nya hilang tetap ditemukan.
4. File yang belum selesai ditulis tidak diproses premature.
5. File tidak diproses dua kali walaupun event duplicate.
6. Crash/restart tidak membuat data hilang.
7. Overflow tidak merusak correctness.

### 20.1 Directory Layout

```text
/data/inbox/
  incoming/
  processing/
  done/
  error/
```

Producer menulis ke `incoming`.

Consumer melakukan claim:

```text
incoming/file.dat -> processing/file.dat.<consumer-id>
```

Jika move atomic di filesystem yang sama berhasil, consumer menjadi owner.

### 20.2 State Machine

```text
DISCOVERED
  -> CANDIDATE
  -> STABLE
  -> CLAIMED
  -> PROCESSING
  -> DONE
  -> ERROR
```

Event watcher hanya boleh menghasilkan:

```text
UNKNOWN_OR_CHANGED(path)
```

Bukan langsung:

```text
PROCESS_NOW(path)
```

### 20.3 Invariant

```text
A file is processable only if:
- path is inside allowed root
- filename is allowed
- not temp/partial extension
- file is regular file, no symlink if prohibited
- file has stable size/mtime or has done marker/manifest
- file can be atomically claimed
- idempotency key not already completed
```

### 20.4 Event to Work Queue

```java
void onWatcherEvent(Path path) {
    candidateBuffer.mark(path, clock.millis());
}
```

### 20.5 Worker Claim

```java
boolean claim(Path source, Path processing) {
    try {
        Files.move(source, processing, StandardCopyOption.ATOMIC_MOVE);
        return true;
    } catch (NoSuchFileException e) {
        return false; // another process moved/deleted it
    } catch (AtomicMoveNotSupportedException e) {
        // fallback policy must be explicit; for intake, often fail fast
        return false;
    } catch (IOException e) {
        return false;
    }
}
```

---

## 21. Idempotency: Duplicate Events Are Normal

Watcher can emit duplicate events. Application must tolerate:

```text
same file candidate many times
modify after create
delete after processing
overflow then scan re-adds same file
restart re-discovers old file
```

Idempotency key options:

1. final path
2. content hash
3. producer-provided file id
4. manifest id
5. `(directory, filename, size, modifiedTime)` heuristic

Best for critical system:

```text
manifest id + content hash + durable processing table
```

If no database is available:

```text
done directory + marker file + checksum manifest
```

Example marker:

```text
.done/file.dat.sha256
```

---

## 22. Watcher Threading Model

Do not process heavy work on watcher thread.

Bad:

```java
for (WatchEvent<?> event : key.pollEvents()) {
    processLargeFile(changed); // blocks watcher
}
```

Why bad?

1. Event queue can overflow.
2. Other directories are not serviced.
3. Shutdown becomes slow.
4. Latency becomes unpredictable.
5. One poisoned file blocks all events.

Better:

```text
watcher thread:
  read events quickly
  mark candidates
  reset key

worker thread/pool:
  debounce
  validate
  claim
  process
```

Architecture:

```text
WatchService Thread
    ↓
Candidate Aggregator / Debounce Buffer
    ↓
Reconciliation Scanner
    ↓
Work Queue
    ↓
Processor Pool
    ↓
Done/Error State
```

---

## 23. Backpressure

If events arrive faster than processing:

```text
watcher receives 100k events/minute
processor handles 1k files/minute
```

Without backpressure:

1. memory grows
2. event queue overflows
3. candidate map grows
4. processing delay grows
5. disk fills
6. application becomes unstable

Backpressure strategies:

| Strategy | Description |
|---|---|
| bounded candidate map | limit number of pending paths |
| directory-level dirty flag | collapse many events into one scan |
| bounded work queue | reject/defer processing when full |
| producer contract | producer checks capacity or writes elsewhere |
| filesystem capacity guard | stop accepting when free space low |
| batch scan | process directory in pages/batches |
| quarantine | isolate poisoned files |

Key design:

```text
When overloaded, degrade to directory-level reconciliation, not per-event memory explosion.
```

Example:

```java
if (pendingCandidates.size() > MAX_PENDING) {
    pendingCandidates.clear();
    dirtyDirectories.add(root);
}
```

---

## 24. Health Model for Watcher

A watcher service should expose health beyond “thread alive”.

Metrics:

| Metric | Meaning |
|---|---|
| `watcher.events.total` | Total raw events. |
| `watcher.events.overflow.total` | Overflow count. |
| `watcher.keys.active` | Active registered directories. |
| `watcher.keys.invalidated.total` | Invalidated watch keys. |
| `watcher.reconciliation.runs.total` | Number of scans. |
| `watcher.reconciliation.duration` | Scan latency. |
| `watcher.candidates.pending` | Pending candidate count. |
| `watcher.queue.depth` | Work queue backlog. |
| `watcher.event.lag` | Time from event to processing. |
| `watcher.last.event.time` | Last event timestamp. |
| `watcher.last.scan.time` | Last reconciliation timestamp. |

Logs should include:

1. watched root
2. event kind
3. relative path
4. resolved path
5. watch key directory
6. overflow marker
7. key invalidation
8. scan start/end
9. candidate state transition
10. claim success/failure

Avoid logging sensitive full paths if paths include user data or tenant identifiers. Prefer structured logs with redaction.

---

## 25. Failure Matrix

| Scenario | What happens | Correct response |
|---|---|---|
| App starts after files already exist | No historical events | Startup scan |
| Writer creates large file slowly | Create/modify event before ready | Debounce + readiness invariant |
| Event queue overflows | Some events lost | Directory/full reconciliation |
| Directory deleted | Key invalid | Remove key, alert/recreate if expected |
| New subdirectory copied with files | Only parent event may arrive | Register subtree + scan subtree |
| Watcher thread blocked | Event backlog grows | Keep watcher lightweight |
| Duplicate modify events | Same path repeatedly seen | Idempotent candidate aggregation |
| File deleted before processing | `NoSuchFileException` | Treat as benign race if allowed |
| File moved by another consumer | Claim fails | Skip/idempotent handling |
| Network filesystem misses event | Watcher sees nothing | Periodic scan |
| Kubernetes config volume swapped | Unexpected event pattern | Watch parent + periodic reload |
| Symlink inserted | Escape risk | no-follow policy + containment validation |

---

## 26. WatchService vs Polling Scan

A pure watcher is low latency but not complete.

A pure polling scanner is complete-ish but higher latency/cost.

Production answer is often hybrid:

```text
WatchService for low-latency hints.
Polling/reconciliation for correctness.
```

Comparison:

| Approach | Strength | Weakness |
|---|---|---|
| Watch only | low latency, efficient when changes are small | misses event/overflow/platform differences |
| Poll only | simple, predictable, no event dependency | latency, expensive on large trees |
| Hybrid | low latency + correctness recovery | more complex |

Top-tier design usually uses hybrid.

---

## 27. WatchService vs Queue/Object Storage Notification

Sometimes filesystem watcher is the wrong abstraction.

Use WatchService when:

1. Files are produced locally or on known mounted filesystem.
2. Directory is not massively large.
3. Loss can be recovered by scan.
4. Low latency is useful but not sole correctness mechanism.
5. Single-node or carefully controlled multi-node design.

Prefer queue/event bus when:

1. Producer can emit durable event.
2. Consumers are distributed.
3. Need retry/dead-letter semantics.
4. Need ordering/partitioning.
5. Need audit trail.

Prefer object storage notification when:

1. Files live in S3/GCS/Azure Blob.
2. Object lifecycle matters more than POSIX semantics.
3. You need cloud-native scale.

Prefer database state table when:

1. File is just payload and workflow state matters.
2. Need idempotency and transactional status.
3. Need UI/admin reconciliation.

---

## 28. Practical Production Pattern: Watch + Scan + Claim

Full pattern:

```text
startup:
  validate root
  create required directories
  initial scan
  register directories
  start watcher loop
  start scanner loop
  start worker pool

watcher loop:
  poll watch key
  convert events into candidate marks
  handle overflow by dirty directory
  reset key

scanner loop:
  periodic scan root/incoming
  scan dirty dirs
  enqueue candidates

worker:
  debounce/stability check
  validate containment
  validate regular file
  claim by atomic move
  process idempotently
  move done/error
```

Pseudo-code:

```java
class FileIntakeEngine {
    void start() throws IOException {
        ensureDirectories();
        initialReconcile();
        startWatcherThread();
        startScannerThread();
        startWorkerPool();
    }

    void onFileHint(Path path) {
        candidates.mark(path, now());
    }

    void workerTick() {
        for (Path candidate : candidates.ready(now())) {
            if (!isProcessable(candidate)) {
                continue;
            }

            Path claimed = processingDir.resolve(candidate.getFileName().toString());
            if (tryAtomicClaim(candidate, claimed)) {
                processClaimedFile(claimed);
            }
        }
    }
}
```

---

## 29. Common Anti-Patterns

### 29.1 Processing Directly on `ENTRY_CREATE`

```java
if (kind == ENTRY_CREATE) {
    process(path); // dangerous
}
```

Why wrong:

1. file may be incomplete
2. writer may still own it
3. event may be duplicate
4. path may be symlink
5. file may disappear before processing

### 29.2 Ignoring OVERFLOW

```java
if (kind == OVERFLOW) continue;
```

Correct:

```text
OVERFLOW -> mark dirty -> scan
```

### 29.3 Assuming Recursive Watch

```java
root.register(watcher, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
// assuming all children recursively watched
```

Wrong. Register each directory or use another abstraction.

### 29.4 Heavy Work in Watcher Thread

```java
watch event -> parse 5GB file
```

Wrong. Watcher should only ingest event hints.

### 29.5 No Startup Scan

If service was down while file arrived, no event exists. Startup scan is mandatory.

### 29.6 No Idempotency

Duplicate event is normal. Processing must tolerate it.

### 29.7 Trusting Event Path Without Validation

Always validate path containment and link policy before acting.

---

## 30. Java 8–25 Compatibility Notes

| Topic | Java 8 | Java 11+ / 25 |
|---|---|---|
| `WatchService` | available | available |
| `WatchKey` | available | available |
| `StandardWatchEventKinds` | available | available |
| `Path.of` | not available | preferred modern factory |
| `Paths.get` | common | still available, but `Path.of` is preferred in modern Java |
| try-with-resources | available | available |
| `Files.walkFileTree` | available | available |
| `DirectoryStream` | available | available |

Java 8 style:

```java
Path root = Paths.get("/data/inbox");
```

Modern style:

```java
Path root = Path.of("/data/inbox");
```

---

## 31. Mental Model Summary

`WatchService` should be understood as:

```text
A lossy, provider-dependent, directory-entry notification mechanism.
```

It is useful for:

1. reducing latency
2. avoiding constant polling
3. triggering reconciliation sooner
4. reacting to local filesystem changes

It is not:

1. a durable event log
2. a complete audit trail
3. a distributed coordination mechanism
4. a guarantee that every change is observed
5. proof that a file is ready
6. recursive by default
7. independent from OS/filesystem/provider behavior

The mature architecture is:

```text
watch event as hint
+ debounce for noise
+ reconciliation for correctness
+ readiness check for completeness
+ atomic claim for ownership
+ idempotency for duplicates
+ metrics for operations
```

---

## 32. Checklist: Production-Grade WatchService

Gunakan checklist ini sebelum menganggap watcher siap production.

### Correctness

- [ ] Startup scan dilakukan.
- [ ] Periodic reconciliation ada.
- [ ] `OVERFLOW` ditangani dengan scan.
- [ ] Duplicate event tidak menyebabkan double processing.
- [ ] File readiness tidak hanya berdasarkan `ENTRY_CREATE`.
- [ ] Delete race dianggap normal.
- [ ] Atomic claim digunakan jika ada multi-consumer.
- [ ] Processing idempotent.

### Security

- [ ] Path containment divalidasi.
- [ ] Symlink policy eksplisit.
- [ ] Tidak follow symlink tanpa alasan kuat.
- [ ] Filename user tidak dipercaya.
- [ ] Directory root tidak bisa diganti attacker.
- [ ] Permission failure tidak membuat watcher silent fail.

### Scalability

- [ ] Watcher thread tidak melakukan heavy processing.
- [ ] Pending candidate structure bounded atau collapsible.
- [ ] Directory-level dirty flag tersedia.
- [ ] Work queue bounded.
- [ ] Backpressure strategy ada.
- [ ] Directory besar diproses batch.

### Operations

- [ ] Metric overflow ada.
- [ ] Metric active key count ada.
- [ ] Metric reconciliation duration ada.
- [ ] Alert jika key invalid untuk required directory.
- [ ] Alert jika overflow terlalu sering.
- [ ] Shutdown graceful.
- [ ] Tested di filesystem production.

### Platform

- [ ] Diuji di Linux/Windows/macOS sesuai target.
- [ ] Diuji di container jika deploy di container.
- [ ] Diuji di mounted volume jika pakai PVC/network FS.
- [ ] Tidak mengasumsikan behavior laptop sama dengan production.

---

## 33. Latihan

### Latihan 1 — Basic Watcher

Buat watcher untuk satu directory yang:

1. menerima create/modify/delete
2. mencetak full path
3. menangani overflow
4. reset key dengan benar
5. berhenti jika directory dihapus

### Latihan 2 — Debounced Watcher

Tambahkan debounce buffer:

1. candidate path disimpan saat event datang
2. path baru diproses setelah tidak ada event selama 2 detik
3. duplicate event tidak membuat duplicate processing

### Latihan 3 — Startup Scan

Modifikasi watcher agar:

1. scan directory saat startup
2. memproses file yang sudah ada sebelum watcher berjalan
3. tetap memproses event baru

### Latihan 4 — Recursive Watcher

Buat recursive watcher:

1. register semua subdirectory saat startup
2. register directory baru saat muncul
3. scan subtree baru setelah register
4. tidak follow symlink

### Latihan 5 — File Intake Engine

Buat mini file intake:

```text
incoming -> processing -> done/error
```

Rules:

1. watcher hanya menandai candidate
2. worker melakukan stable check
3. worker claim via atomic move
4. worker menghasilkan `.done` marker
5. restart tidak memproses ulang file done

---

## 34. Kesimpulan

`WatchService` adalah API yang tampak sederhana tetapi mudah salah digunakan. Engineer biasa melihatnya sebagai callback event file. Engineer yang lebih matang melihatnya sebagai komponen observability filesystem yang harus dipasangkan dengan reconciliation, idempotency, dan state machine.

Prinsip utama:

```text
Event mempercepat deteksi.
Scan memulihkan kebenaran.
Claim menentukan ownership.
Idempotency melindungi dari duplicate.
State machine membuat workflow bisa dipulihkan.
```

Jika prinsip ini dipakai, `WatchService` bisa menjadi bagian yang berguna dalam file workflow production. Jika tidak, ia akan menjadi sumber bug intermittent yang sulit direproduksi.

---

## 35. Referensi

- Java SE 21 Documentation — `WatchService`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/WatchService.html
- Java Tutorials — Watching a Directory for Changes: https://docs.oracle.com/javase/tutorial/essential/io/notification.html
- Java SE 25 Documentation — `Files`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html
- Java SE 25 Documentation — `WatchKey`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/WatchKey.html
- Java SE 25 Documentation — `StandardWatchEventKinds`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/StandardWatchEventKinds.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 16 — FileStore and Filesystem Capacity: Disk Space, Quotas, and Operational Guardrails](./learn-java-io-file-filesystem-storage-engineering-part-16-filestore-filesystem-capacity.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 18 — File Locking: Advisory, Mandatory, Local, Network, and Cross-Process Coordination](./learn-java-io-file-filesystem-storage-engineering-part-18-file-locking.md)

</div>