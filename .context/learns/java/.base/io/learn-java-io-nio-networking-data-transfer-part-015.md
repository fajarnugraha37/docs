# Part 015 — WatchService: File Change Detection, Event Coalescing, dan Reliability Limit

> Seri: `learn-java-io-nio-networking-data-transfer`  
> Level: Advanced  
> Fokus: Java NIO.2 `WatchService`, file-system event semantics, reliability limit, debouncing, reconciliation, checkpoint, dan production ingestion watcher.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami `WatchService` bukan sebagai “real-time truth engine”, tetapi sebagai **notifikasi perubahan filesystem** yang memiliki batas reliability.
2. Menjelaskan alur kerja `WatchService`: `WatchService` → `WatchKey` → `WatchEvent` → `reset()`.
3. Membedakan event `ENTRY_CREATE`, `ENTRY_MODIFY`, `ENTRY_DELETE`, dan `OVERFLOW`.
4. Mengetahui kenapa event bisa:
   - terlambat,
   - tergabung,
   - berulang,
   - hilang,
   - tidak recursive,
   - berbeda perilaku antar OS.
5. Mendesain watcher yang production-grade dengan:
   - debounce,
   - stability wait,
   - periodic reconciliation,
   - checkpoint,
   - deduplication,
   - idempotent processing,
   - failure recovery.
6. Menghindari desain rapuh seperti langsung memproses file saat event `ENTRY_CREATE` datang.
7. Membangun mental model yang tepat untuk use case:
   - hot reload config,
   - file ingestion,
   - directory synchronization,
   - audit folder watcher,
   - batch import trigger,
   - Kubernetes ConfigMap/Secret reload.

---

## 2. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membahas:

- `Path`, `Files`, `FileSystem`, dan operasi file modern.
- File attributes, permission, ownership, dan symlink.
- Directory traversal, recursive copy/delete/search.
- Temporary file, atomic replacement, dan crash-safe persistence.

Sekarang kita masuk ke pertanyaan berikutnya:

> “Bagaimana aplikasi Java mengetahui bahwa isi directory berubah?”

Jawaban pendeknya adalah `WatchService`.

Jawaban engineering-nya:

> Gunakan `WatchService` sebagai **signal cepat**, tetapi tetap gunakan filesystem scan/reconciliation sebagai **source of truth**.

Ini perbedaan besar antara kode demo dan sistem production.

---

## 3. Mental Model Dasar

### 3.1 Filesystem Event Bukan Database Event

Filesystem event berbeda dari event database atau message broker.

Database/event broker biasanya punya konsep seperti:

- transaction,
- commit log,
- offset,
- ordering,
- durable queue,
- replay,
- acknowledgement.

Filesystem event umumnya tidak memberi semua itu.

`WatchService` memberi tahu bahwa sesuatu berubah di directory yang diregister. Tetapi ia tidak otomatis memberi jaminan bahwa:

- semua perubahan pasti terlihat,
- event tidak akan digabung,
- event urut sempurna,
- file sudah selesai ditulis,
- event bisa di-replay setelah aplikasi restart,
- semua nested subdirectory otomatis termonitor,
- semantics sama di Linux, macOS, Windows, container, dan network filesystem.

Jadi mental model yang benar:

```text
Filesystem watcher = hint / signal / interrupt
Filesystem scan    = truth / reconciliation / recovery
```

### 3.2 Event Memberi Tahu “Ada Perubahan”, Bukan “Aksi Aman Dilakukan Sekarang”

Ketika menerima `ENTRY_CREATE` untuk file `input.csv`, jangan langsung berasumsi:

```text
file sudah lengkap
file sudah closed oleh writer
file tidak akan berubah lagi
file bisa langsung diproses
file tidak akan di-rename
file tidak akan dihapus beberapa milidetik lagi
```

Yang benar:

```text
Ada entry bernama input.csv yang muncul di directory.
Perlu validasi ulang kondisi file sebelum diproses.
```

### 3.3 Watcher Harus Dipandang sebagai State Machine

Sistem watcher production bukan loop sederhana:

```java
while (true) {
    WatchKey key = watcher.take();
    for (WatchEvent<?> event : key.pollEvents()) {
        process(event);
    }
    key.reset();
}
```

Loop itu hanya skeleton.

Sistem sebenarnya memiliki state seperti:

```text
DISCOVERED
OBSERVING_STABILITY
READY_TO_PROCESS
PROCESSING
PROCESSED
FAILED_RETRYABLE
FAILED_PERMANENT
IGNORED
DELETED_BEFORE_PROCESS
```

File event hanya memindahkan candidate ke state awal. Keputusan lanjut harus berdasarkan inspeksi filesystem.

---

## 4. API Utama `WatchService`

Java menyediakan file change notification API melalui `java.nio.file.WatchService`. Objek yang bisa di-watch diregister ke watch service dan menghasilkan `WatchKey`; ketika event terdeteksi, key akan disignal dan bisa diambil dengan `poll()` atau `take()` untuk diproses. Dokumentasi resmi juga menekankan bahwa key perlu di-`reset()` agar bisa menerima event berikutnya. Referensi utama: Java SE `WatchService` dan tutorial Oracle tentang watching directory changes.  

### 4.1 Class dan Interface Penting

| API | Fungsi |
|---|---|
| `WatchService` | Service untuk menerima notification dari filesystem |
| `Watchable` | Interface untuk object yang bisa didaftarkan ke watcher; `Path` mengimplementasikannya |
| `WatchKey` | Registration handle untuk directory yang sedang di-watch |
| `WatchEvent<T>` | Event yang terjadi pada watched object |
| `WatchEvent.Kind<T>` | Jenis event |
| `StandardWatchEventKinds` | Event standard: create, modify, delete, overflow |
| `FileSystems.getDefault().newWatchService()` | Membuat watcher dari default filesystem |
| `Path.register(...)` | Mendaftarkan path ke watcher |

### 4.2 Standard Event Kinds

| Event | Makna |
|---|---|
| `ENTRY_CREATE` | Entry dibuat di directory yang diawasi |
| `ENTRY_MODIFY` | Entry dimodifikasi |
| `ENTRY_DELETE` | Entry dihapus |
| `OVERFLOW` | Event mungkin hilang atau dibuang |

Poin penting: `OVERFLOW` bukan event file tertentu. Ia adalah sinyal bahwa watcher tidak lagi punya view lengkap atas perubahan yang terjadi.

---

## 5. Basic WatchService Flow

### 5.1 Membuat WatchService

```java
WatchService watchService = FileSystems.getDefault().newWatchService();
```

`WatchService` terikat ke `FileSystem`. Untuk default filesystem, biasanya ini filesystem OS lokal.

### 5.2 Register Directory

```java
Path directory = Path.of("/data/inbox");

WatchKey key = directory.register(
        watchService,
        StandardWatchEventKinds.ENTRY_CREATE,
        StandardWatchEventKinds.ENTRY_MODIFY,
        StandardWatchEventKinds.ENTRY_DELETE
);
```

Yang diregister adalah **directory**, bukan file individual.

Event context biasanya berupa relative `Path` dari entry yang berubah.

### 5.3 Event Loop Minimal

```java
while (true) {
    WatchKey key = watchService.take(); // blocking

    for (WatchEvent<?> event : key.pollEvents()) {
        WatchEvent.Kind<?> kind = event.kind();

        if (kind == StandardWatchEventKinds.OVERFLOW) {
            continue;
        }

        @SuppressWarnings("unchecked")
        WatchEvent<Path> pathEvent = (WatchEvent<Path>) event;
        Path fileName = pathEvent.context();
        Path fullPath = directory.resolve(fileName);

        System.out.printf("%s: %s%n", kind.name(), fullPath);
    }

    boolean valid = key.reset();
    if (!valid) {
        break;
    }
}
```

Kode ini cukup untuk demo, tetapi belum production-grade.

---

## 6. WatchKey Lifecycle

### 6.1 State Konseptual WatchKey

```text
REGISTERED
   |
   | event occurs
   v
SIGNALED / QUEUED
   |
   | application takes key
   v
PROCESSING_EVENTS
   |
   | key.reset()
   v
READY_AGAIN
```

Jika `reset()` tidak dipanggil, key tidak kembali ke state aktif untuk menerima signal berikutnya.

### 6.2 `reset()` Return Value

`key.reset()` mengembalikan `false` jika key tidak lagi valid.

Penyebab:

- directory tidak lagi accessible,
- directory dihapus,
- watch service ditutup,
- registration dibatalkan.

Pattern:

```java
boolean valid = key.reset();
if (!valid) {
    // Directory no longer watched.
    // Remove it from internal map.
}
```

### 6.3 `cancel()`

`WatchKey.cancel()` membatalkan registration.

Gunakan saat:

- directory tidak lagi perlu dipantau,
- recursive watcher mendeteksi directory dihapus,
- aplikasi shutdown,
- reload watch configuration.

---

## 7. Polling vs Blocking

`WatchService` punya beberapa cara mengambil key.

### 7.1 `take()`

```java
WatchKey key = watchService.take();
```

Blocking sampai ada key tersedia.

Cocok untuk dedicated watcher thread.

### 7.2 `poll()`

```java
WatchKey key = watchService.poll();
```

Non-blocking. Return `null` jika tidak ada event.

Cocok jika watcher digabung dengan loop lain, tetapi sering menyebabkan busy loop jika salah digunakan.

### 7.3 `poll(timeout, unit)`

```java
WatchKey key = watchService.poll(5, TimeUnit.SECONDS);
```

Menunggu maksimal timeout.

Cocok jika butuh:

- periodic housekeeping,
- shutdown check,
- reconciliation berkala,
- metrics emission.

Production watcher biasanya tidak hanya `take()`, tetapi memakai timed poll agar tetap bisa melakukan periodic scan.

---

## 8. Event Context dan Path Resolution

Ketika watch directory `/data/inbox` menerima event untuk `a.csv`, context event biasanya `a.csv`, bukan `/data/inbox/a.csv`.

```java
WatchEvent<Path> pathEvent = (WatchEvent<Path>) event;
Path relative = pathEvent.context();
Path absolute = watchedDirectory.resolve(relative);
```

Jangan salah menganggap `event.context()` selalu absolute path.

### 8.1 Mapping WatchKey ke Directory

Jika hanya satu directory, mudah.

Kalau recursive watcher, satu `WatchService` bisa menerima event dari banyak `WatchKey`. Karena `WatchKey` tidak langsung memberi `Path` directory asal, kamu perlu map sendiri.

```java
Map<WatchKey, Path> directoriesByKey = new HashMap<>();

WatchKey key = directory.register(watchService, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
directoriesByKey.put(key, directory);
```

Saat event datang:

```java
Path dir = directoriesByKey.get(key);
Path child = dir.resolve((Path) event.context());
```

---

## 9. Event Coalescing

### 9.1 Apa Itu Event Coalescing?

Event coalescing berarti beberapa perubahan filesystem bisa digabung menjadi event lebih sedikit.

Contoh writer menulis file:

```text
create file
write chunk 1
write chunk 2
write chunk 3
close file
```

Watcher mungkin melihat:

```text
ENTRY_CREATE input.csv
ENTRY_MODIFY input.csv
```

Atau:

```text
ENTRY_CREATE input.csv
ENTRY_MODIFY input.csv
ENTRY_MODIFY input.csv
ENTRY_MODIFY input.csv
```

Atau pada situasi tertentu:

```text
ENTRY_CREATE input.csv
```

Jangan desain logic yang bergantung pada jumlah event modify.

### 9.2 Kenapa Coalescing Terjadi?

Karena event filesystem melewati beberapa lapisan:

```text
filesystem driver
OS notification mechanism
JVM WatchService implementation
internal event queue
application polling loop
```

Agar efisien, lapisan-lapisan ini bisa menggabungkan event yang berdekatan.

### 9.3 Consequence

Event bukan audit log.

Jangan pernah membangun logic seperti:

```text
Kalau ada 3 MODIFY berarti file sudah lengkap.
Kalau hanya 1 MODIFY berarti belum lengkap.
```

Itu tidak valid.

---

## 10. `OVERFLOW`: Sinyal Bahwa View Tidak Lengkap

### 10.1 Makna `OVERFLOW`

`OVERFLOW` berarti event mungkin hilang atau dibuang.

Ini bisa terjadi jika:

- terlalu banyak perubahan dalam waktu pendek,
- application lambat memproses event,
- queue internal penuh,
- OS notification buffer overflow,
- directory tree sangat aktif,
- watcher thread blocked oleh pekerjaan berat.

### 10.2 Respons yang Benar

Respons yang benar terhadap `OVERFLOW` bukan sekadar log warning.

Yang benar:

```text
OVERFLOW received
  -> mark watched directory as dirty
  -> run full reconciliation scan
  -> rebuild candidate set
  -> deduplicate against processed checkpoint
```

Contoh:

```java
if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
    reconciliationRequested.set(true);
    continue;
}
```

### 10.3 Anti-Pattern

```java
if (event.kind() == OVERFLOW) {
    continue;
}
```

Ini bahaya karena aplikasi mengabaikan fakta bahwa event sudah tidak lengkap.

---

## 11. Non-Recursive by Default

`WatchService` pada Java standard API mendaftarkan directory tertentu. Ia tidak otomatis recursive ke semua subdirectory.

Jika ingin recursive watch:

1. scan awal seluruh directory tree,
2. register setiap directory,
3. ketika ada new directory created, register directory baru itu,
4. ketika directory deleted, remove key mapping,
5. tetap lakukan periodic reconciliation.

### 11.1 Recursive Register Pattern

```java
void registerTree(Path root, WatchService watcher, Map<WatchKey, Path> keys) throws IOException {
    Files.walkFileTree(root, new SimpleFileVisitor<>() {
        @Override
        public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
            WatchKey key = dir.register(
                    watcher,
                    StandardWatchEventKinds.ENTRY_CREATE,
                    StandardWatchEventKinds.ENTRY_MODIFY,
                    StandardWatchEventKinds.ENTRY_DELETE
            );
            keys.put(key, dir);
            return FileVisitResult.CONTINUE;
        }
    });
}
```

### 11.2 Race Saat Directory Baru Dibuat

Jika directory baru dibuat dengan isi sudah ada:

```text
mkdir batch-001
copy file1 into batch-001
copy file2 into batch-001
```

Watcher parent mungkin hanya melihat:

```text
ENTRY_CREATE batch-001
```

Jika kamu baru register `batch-001` setelah event, file di dalamnya mungkin sudah dibuat sebelum registration. Jadi setelah register directory baru, lakukan scan isi directory tersebut.

```text
new directory detected
  -> register directory
  -> scan directory content
  -> enqueue discovered files
```

---

## 12. File Still Being Written Problem

### 12.1 Masalah

Ketika event `ENTRY_CREATE` muncul, file mungkin masih sedang ditulis.

Contoh producer:

```java
try (OutputStream out = Files.newOutputStream(path)) {
    writeLargeFile(out); // takes 30 seconds
}
```

Watcher bisa menerima `ENTRY_CREATE` pada detik pertama.

Jika consumer langsung proses:

- file terbaca sebagian,
- checksum gagal,
- parser error,
- import data corrupt,
- file dianggap bad padahal belum selesai.

### 12.2 Solusi Terbaik: Atomic Publish Contract

Producer sebaiknya tidak menulis langsung ke nama final.

Pattern:

```text
write input.csv.tmp
fsync input.csv.tmp
atomic move input.csv.tmp -> input.csv
```

Consumer hanya memproses file dengan nama final.

```text
ignore *.tmp
process *.csv only
```

Ini jauh lebih kuat daripada menebak file sudah selesai.

### 12.3 Jika Producer Tidak Bisa Diubah

Gunakan stability check.

File dianggap stabil jika:

- size tidak berubah selama beberapa interval,
- last modified time tidak berubah,
- file bisa dibuka,
- optional checksum/manifest tersedia,
- optional lock tidak aktif.

Contoh sederhana:

```java
record FileSnapshot(long size, FileTime modifiedTime) {}

static FileSnapshot snapshot(Path path) throws IOException {
    BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);
    return new FileSnapshot(attrs.size(), attrs.lastModifiedTime());
}

static boolean isStable(Path path, Duration interval) throws IOException, InterruptedException {
    FileSnapshot first = snapshot(path);
    Thread.sleep(interval.toMillis());
    if (!Files.exists(path)) {
        return false;
    }
    FileSnapshot second = snapshot(path);
    return first.equals(second);
}
```

Catatan: ini heuristic, bukan guarantee sempurna.

---

## 13. Debounce

### 13.1 Kenapa Perlu Debounce?

Satu file save dari editor bisa menghasilkan banyak event:

```text
ENTRY_MODIFY config.yml
ENTRY_MODIFY config.yml
ENTRY_MODIFY config.yml
```

Atau editor melakukan:

```text
write temp file
rename temp file
delete old file
create new file
modify new file
```

Jika aplikasi reload config setiap event, hasilnya:

- reload berulang,
- CPU spike,
- inconsistent view,
- reload file saat masih ditulis,
- log spam.

### 13.2 Debounce Mental Model

Debounce berarti:

```text
Saat event datang, tunggu sebentar.
Jika event baru datang untuk path yang sama, reset timer.
Proses hanya setelah quiet period.
```

Contoh:

```text
t=0ms    MODIFY config.yml
          schedule reload at t=500ms

t=200ms  MODIFY config.yml
          reschedule reload at t=700ms

t=400ms  MODIFY config.yml
          reschedule reload at t=900ms

t=900ms  no more events -> reload
```

### 13.3 Debounce Queue Design

Data structure:

```java
record PendingPath(Path path, Instant dueAt) {}
```

Map:

```text
Path -> due time
```

On event:

```text
pending[path] = now + debounceDuration
```

Periodic loop:

```text
for each pending where dueAt <= now:
    process(path)
    remove from pending
```

---

## 14. Reconciliation

### 14.1 Kenapa Reconciliation Wajib?

Karena watcher bisa melewatkan event.

Penyebab:

- aplikasi restart,
- watcher belum register saat file datang,
- `OVERFLOW`,
- recursive directory race,
- network filesystem behavior,
- event coalescing,
- bug OS/JDK,
- directory recreated,
- permission berubah.

Jadi production watcher perlu periodic scan.

### 14.2 Reconciliation Mental Model

```text
Watcher event:
    fast path: enqueue candidate quickly

Periodic reconciliation:
    slow path: scan directory and find truth
```

### 14.3 Reconciliation Algorithm

Untuk ingestion folder:

```text
Every N seconds/minutes:
  1. Walk inbox directory.
  2. Select files matching accepted pattern.
  3. Ignore temp/in-progress files.
  4. Compare with checkpoint table/store.
  5. Enqueue unseen files.
  6. Re-check failed retryable files.
```

Pseudo:

```java
void reconcile(Path inbox) throws IOException {
    try (Stream<Path> stream = Files.walk(inbox)) {
        stream
            .filter(Files::isRegularFile)
            .filter(this::isAcceptedName)
            .filter(path -> !checkpointStore.isProcessed(path))
            .forEach(candidateQueue::offer);
    }
}
```

### 14.4 Source of Truth

Source of truth bukan event queue.

Source of truth adalah kombinasi:

```text
filesystem current state
+ durable checkpoint
+ processing rules
```

---

## 15. Checkpoint dan Idempotency

### 15.1 Kenapa Checkpoint Perlu?

Tanpa checkpoint, aplikasi restart akan bingung:

- file mana sudah diproses?
- file mana sedang diproses saat crash?
- file mana gagal dan perlu retry?
- file mana duplicate?

### 15.2 Checkpoint Minimal

Untuk setiap file:

```text
path
size
lastModifiedTime
checksum optional
status
attemptCount
lastError
firstSeenAt
lastAttemptAt
processedAt
```

Status:

```text
DISCOVERED
STABLE_WAIT
READY
PROCESSING
PROCESSED
FAILED_RETRYABLE
FAILED_PERMANENT
IGNORED
```

### 15.3 Idempotency Key

Path saja tidak selalu cukup.

Pertimbangkan key:

```text
relativePath + size + modifiedTime
```

Lebih kuat:

```text
relativePath + checksum
```

Untuk transfer antar sistem:

```text
producerId + batchId + fileName + checksum
```

### 15.4 Processed Marker Pattern

Setelah berhasil, file bisa:

- dipindah ke `processed/`,
- diberi marker `.done`,
- dicatat di database,
- dihapus setelah retention.

Contoh layout:

```text
/data/import/
  inbox/
  processing/
  processed/
  failed/
```

Flow:

```text
inbox/file.csv
  -> atomic move to processing/file.csv
  -> process
  -> atomic move to processed/file.csv
```

Keuntungannya:

- consumer lain tidak memproses file yang sama,
- restart recovery lebih mudah,
- status terlihat secara operasional.

---

## 16. Production File Ingestion Watcher Design

### 16.1 Architecture

```text
                 +---------------------+
Filesystem Event |     WatchService    |
---------------->|  fast signal path   |
                 +----------+----------+
                            |
                            v
                 +---------------------+
                 | Candidate Registry  |
                 | debounce + dedup    |
                 +----------+----------+
                            |
                            v
                 +---------------------+
Periodic Scan ---> Reconciliation Job  |
                 +----------+----------+
                            |
                            v
                 +---------------------+
                 |  Stability Checker  |
                 +----------+----------+
                            |
                            v
                 +---------------------+
                 |  Processing Queue   |
                 +----------+----------+
                            |
                            v
                 +---------------------+
                 | Idempotent Processor|
                 +----------+----------+
                            |
                            v
                 +---------------------+
                 | Durable Checkpoint  |
                 +---------------------+
```

### 16.2 Invariants

Sistem harus menjaga invariant berikut:

1. File tidak diproses sebelum dianggap stabil.
2. File yang sama tidak diproses paralel oleh worker berbeda.
3. Crash tidak membuat status file hilang.
4. Event hilang tidak membuat file selamanya tidak diproses.
5. `OVERFLOW` memicu reconciliation.
6. Processing harus idempotent atau deduplicated.
7. File temporary/in-progress tidak diproses.
8. File gagal punya jalur retry atau permanent failure.

### 16.3 State Machine

```text
DISCOVERED
   |
   v
WAITING_FOR_STABILITY
   |
   | stable
   v
READY
   |
   | claimed by worker
   v
PROCESSING
   |
   | success
   v
PROCESSED

PROCESSING
   |
   | retryable failure
   v
FAILED_RETRYABLE
   |
   | retry delay elapsed
   v
READY

PROCESSING
   |
   | permanent failure
   v
FAILED_PERMANENT

DISCOVERED / WAITING_FOR_STABILITY
   |
   | file deleted
   v
DISAPPEARED
```

---

## 17. Robust Example: Watcher with Debounce and Reconciliation Hook

Kode berikut bukan framework lengkap, tetapi menunjukkan struktur yang lebih sehat daripada demo loop sederhana.

```java
import java.io.IOException;
import java.nio.file.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

import static java.nio.file.StandardWatchEventKinds.*;

public final class DebouncedDirectoryWatcher implements AutoCloseable {
    private final Path directory;
    private final WatchService watchService;
    private final Duration debounceDuration;
    private final Duration pollTimeout;
    private final Map<Path, Instant> pending = new HashMap<>();
    private volatile boolean running = true;

    public DebouncedDirectoryWatcher(Path directory,
                                     Duration debounceDuration,
                                     Duration pollTimeout) throws IOException {
        this.directory = directory.toAbsolutePath().normalize();
        this.watchService = FileSystems.getDefault().newWatchService();
        this.debounceDuration = debounceDuration;
        this.pollTimeout = pollTimeout;

        this.directory.register(watchService, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
    }

    public void run() throws IOException, InterruptedException {
        while (running) {
            WatchKey key = watchService.poll(pollTimeout.toMillis(), TimeUnit.MILLISECONDS);

            if (key != null) {
                handleKey(key);
            }

            drainDuePaths();
        }
    }

    private void handleKey(WatchKey key) throws IOException {
        boolean overflow = false;

        for (WatchEvent<?> rawEvent : key.pollEvents()) {
            WatchEvent.Kind<?> kind = rawEvent.kind();

            if (kind == OVERFLOW) {
                overflow = true;
                continue;
            }

            @SuppressWarnings("unchecked")
            WatchEvent<Path> event = (WatchEvent<Path>) rawEvent;
            Path relative = event.context();
            Path fullPath = directory.resolve(relative).normalize();

            if (!fullPath.startsWith(directory)) {
                // Defensive guard, although context should be relative entry name.
                continue;
            }

            if (kind == ENTRY_DELETE) {
                pending.remove(fullPath);
                onDeleted(fullPath);
            } else {
                schedule(fullPath);
            }
        }

        boolean valid = key.reset();
        if (!valid) {
            running = false;
        }

        if (overflow) {
            reconcile();
        }
    }

    private void schedule(Path path) {
        pending.put(path, Instant.now().plus(debounceDuration));
    }

    private void drainDuePaths() {
        Instant now = Instant.now();
        Iterator<Map.Entry<Path, Instant>> iterator = pending.entrySet().iterator();

        while (iterator.hasNext()) {
            Map.Entry<Path, Instant> entry = iterator.next();
            if (!entry.getValue().isAfter(now)) {
                Path path = entry.getKey();
                iterator.remove();
                onReadyCandidate(path);
            }
        }
    }

    private void onReadyCandidate(Path path) {
        // Do not process blindly here.
        // Typical next steps:
        // 1. Validate it still exists.
        // 2. Check regular file.
        // 3. Ignore temp names.
        // 4. Check stability.
        // 5. Enqueue to bounded processor queue.
        System.out.println("candidate: " + path);
    }

    private void onDeleted(Path path) {
        System.out.println("deleted: " + path);
    }

    private void reconcile() throws IOException {
        // Full scan should rebuild truth from filesystem + checkpoint.
        try (var stream = Files.list(directory)) {
            stream
                .filter(Files::isRegularFile)
                .forEach(this::schedule);
        }
    }

    @Override
    public void close() throws IOException {
        running = false;
        watchService.close();
    }
}
```

### 17.1 Yang Sudah Benar dari Contoh Ini

- Menggunakan `poll(timeout)` agar loop bisa menjalankan housekeeping.
- Menangani `OVERFLOW` dengan reconciliation.
- Melakukan debounce per path.
- Tidak langsung memproses file saat event datang.
- Menghapus pending candidate saat file deleted.
- Menormalisasi path.
- Menutup `WatchService`.

### 17.2 Yang Masih Perlu Ditambahkan untuk Production

- Durable checkpoint.
- Worker queue bounded.
- Stability checker.
- Retry policy.
- Recursive directory support jika perlu.
- Metrics.
- Structured logging.
- Graceful shutdown.
- Error isolation.
- Thread interruption policy.

---

## 18. Hot Reload Configuration

### 18.1 Use Case

Aplikasi membaca config file:

```text
/etc/myapp/config.yml
```

Saat file berubah, aplikasi reload config.

### 18.2 Masalah

Editor atau deployment tool bisa menulis config dengan cara berbeda:

1. modify file in-place,
2. write temp file lalu rename,
3. delete old lalu create new,
4. symlink switch,
5. Kubernetes volume update.

Jika watcher hanya mendengar `ENTRY_MODIFY config.yml`, reload bisa tidak jalan pada case rename/symlink.

### 18.3 Pattern yang Lebih Aman

Watch directory parent, bukan hanya asumsi file modify.

```text
watch /etc/myapp
react if config.yml affected by CREATE/MODIFY/DELETE
also periodically re-stat config path
```

Reload flow:

```text
event detected
  -> debounce
  -> read full config into memory
  -> validate schema
  -> build new immutable config object
  -> atomically swap active config
  -> if invalid, keep old config
```

### 18.4 Jangan Reload Partial Config

Anti-pattern:

```java
currentConfig.setTimeout(readTimeoutFromFile(path));
currentConfig.setUrl(readUrlFromFile(path));
currentConfig.setPoolSize(readPoolSizeFromFile(path));
```

Jika parsing gagal di tengah, config object bisa setengah baru setengah lama.

Pattern lebih baik:

```java
Config newConfig = ConfigLoader.loadAndValidate(path);
activeConfig.set(newConfig);
```

---

## 19. Kubernetes ConfigMap dan Secret Reload

### 19.1 Kenapa Ini Penting?

Di Kubernetes, ConfigMap/Secret yang dimount sebagai volume sering diperbarui bukan dengan modify file biasa, tetapi dengan mekanisme symlink/atomic directory switch.

Akibatnya watcher bisa menerima event yang tidak intuitif:

- directory berubah,
- symlink berubah,
- file lama tidak dimodify langsung,
- path final tampak sama tetapi target berubah.

### 19.2 Pattern Aman

Untuk config reload dalam container:

1. Watch parent directory.
2. Jangan bergantung hanya pada `ENTRY_MODIFY` file final.
3. Periodically re-read atau re-stat config file.
4. Debounce event.
5. Validate config sebelum swap.
6. Keep last known good config.

```text
WatchService = fast reload trigger
Periodic check = safety net
Last known good = resilience
```

---

## 20. Directory Synchronization

Use case:

```text
sync local folder -> remote storage
```

Watcher bisa membantu mendeteksi perubahan cepat, tetapi sync engine harus tetap berbasis reconciliation.

### 20.1 Kenapa?

Karena remote sync butuh menjawab:

- file mana baru?
- file mana berubah?
- file mana dihapus?
- file mana rename?
- file mana upload gagal?
- file mana sudah remote tapi local belum checkpoint?

Event saja tidak cukup.

### 20.2 Sync State

Minimal metadata:

```text
relativePath
localSize
localModifiedTime
localChecksum optional
remoteObjectKey
remoteChecksum
lastSyncedAt
syncStatus
```

### 20.3 Rename Problem

Filesystem event rename sering muncul sebagai:

```text
ENTRY_DELETE oldName
ENTRY_CREATE newName
```

Tidak selalu ada semantic “rename old → new”.

Kalau perlu detect rename, gunakan heuristic checksum/inode/file key, bukan event mentah.

---

## 21. Threading Model

### 21.1 Jangan Proses Berat di Watcher Thread

Watcher thread sebaiknya hanya:

- mengambil event,
- resolve path,
- update pending registry,
- trigger reconciliation,
- enqueue candidate.

Jangan lakukan:

- parse CSV besar,
- upload file,
- unzip archive,
- call HTTP API,
- blocking database lama,
- checksum file besar.

Jika watcher thread blocked, event queue bisa penuh dan menyebabkan `OVERFLOW`.

### 21.2 Gunakan Bounded Queue

```java
BlockingQueue<Path> queue = new ArrayBlockingQueue<>(1000);
```

Jika queue penuh, keputusan harus eksplisit:

- block watcher thread? berisiko overflow,
- drop candidate? berisiko data loss,
- mark reconciliation needed? lebih aman,
- slow down producer? jarang bisa.

Untuk ingestion, pilihan aman:

```text
If queue full:
  mark directory dirty
  rely on reconciliation
  emit alert/metric
```

### 21.3 Worker Pool

```text
watcher thread -> candidate queue -> worker pool
```

Jumlah worker ditentukan oleh bottleneck:

- CPU parsing,
- disk I/O,
- network upload,
- database insert,
- downstream rate limit.

Jangan otomatis set worker = jumlah CPU jika bottleneck adalah database atau remote API.

---

## 22. Error Handling

### 22.1 Watch Loop Error

Watch loop tidak boleh mati diam-diam.

```java
try {
    watcher.run();
} catch (ClosedWatchServiceException e) {
    // expected during shutdown
} catch (Exception e) {
    // log, alert, restart depending on supervisor model
}
```

### 22.2 Per-File Error

File processing failure tidak boleh membunuh watcher.

```text
file A failed -> mark failed
file B, C, D continue
```

### 22.3 Retryable vs Permanent

Retryable:

- file temporarily locked,
- permission temporarily denied,
- downstream timeout,
- network error,
- partial producer write.

Permanent:

- invalid schema,
- unsupported extension,
- checksum mismatch after finalization,
- malicious path,
- business validation failure.

---

## 23. Security Considerations

### 23.1 Path Traversal

Even in watcher systems, path validation matters.

If input comes from extracted archives or external producers, ensure final path remains inside expected root.

```java
Path root = Path.of("/data/inbox").toAbsolutePath().normalize();
Path candidate = root.resolve(relative).normalize();

if (!candidate.startsWith(root)) {
    throw new SecurityException("Path escapes root: " + candidate);
}
```

### 23.2 Symlink Attack

If attacker can write to watched directory, they may create symlink to sensitive file.

Defensive checks:

- avoid following symlinks unless intended,
- use `NOFOLLOW_LINKS` for metadata checks,
- validate real path carefully,
- restrict directory permissions,
- process under least privilege.

### 23.3 Zip Slip Interaction

If watcher processes new ZIP files and extracts them, extraction logic must defend against zip slip.

Do not assume watched folder input is trusted.

### 23.4 Resource Exhaustion

Attacker or broken producer can create:

- millions of tiny files,
- extremely large files,
- rapid modify events,
- deep directory trees,
- symlink cycles,
- zip bombs,
- invalid files causing repeated retries.

Controls:

- max file size,
- max files per batch,
- bounded queues,
- retry limit,
- quarantine folder,
- rate limit,
- reconciliation budget,
- alerting.

---

## 24. Observability

Production watcher harus punya metrics.

### 24.1 Metrics Penting

| Metric | Makna |
|---|---|
| `watch_events_total` | Jumlah event diterima |
| `watch_overflow_total` | Jumlah overflow |
| `watch_invalid_key_total` | WatchKey invalid |
| `pending_candidates` | Jumlah path menunggu debounce/stability |
| `processing_queue_depth` | Panjang queue worker |
| `files_discovered_total` | File candidate ditemukan |
| `files_processed_total` | File berhasil diproses |
| `files_failed_total` | File gagal |
| `reconciliation_runs_total` | Jumlah reconciliation |
| `reconciliation_duration_seconds` | Durasi scan |
| `oldest_pending_age_seconds` | Umur candidate tertua |

### 24.2 Logs Penting

Log harus menjawab:

- directory apa yang di-watch,
- event apa yang diterima,
- file mana yang masuk candidate,
- kapan overflow terjadi,
- kapan reconciliation berjalan,
- kenapa file gagal,
- kapan checkpoint diperbarui.

Gunakan correlation id untuk batch atau file processing.

### 24.3 Alert

Alert jika:

- overflow sering,
- watcher mati,
- reconciliation gagal,
- queue penuh,
- oldest pending terlalu tua,
- failed permanent meningkat,
- disk hampir penuh,
- permission error muncul tiba-tiba.

---

## 25. Testing Strategy

### 25.1 Unit Test

Test logic murni:

- debounce registry,
- path filter,
- stability checker,
- checkpoint transition,
- retry policy.

### 25.2 Integration Test dengan Temporary Directory

Gunakan `@TempDir` di JUnit.

Scenario:

1. file created,
2. file modified,
3. file deleted,
4. multiple rapid modifies,
5. temp file ignored,
6. final rename detected,
7. directory deleted,
8. watcher closed.

### 25.3 Race Test

Simulasikan file besar ditulis perlahan:

```java
try (OutputStream out = Files.newOutputStream(path)) {
    for (int i = 0; i < 100; i++) {
        out.write(chunk);
        out.flush();
        Thread.sleep(50);
    }
}
```

Pastikan processor tidak membaca sebelum file stabil.

### 25.4 Overflow Simulation

Sulit dipastikan portable, tetapi bisa stress test:

- create ribuan file cepat,
- modify banyak file cepat,
- sengaja lambatkan watcher processing,
- pastikan reconciliation menemukan semua file walaupun event hilang.

### 25.5 Restart Recovery Test

1. Discover file.
2. Crash sebelum process.
3. Restart.
4. Reconciliation harus menemukan file lagi.

1. Process file.
2. Crash setelah process tapi sebelum move.
3. Restart.
4. Idempotency harus mencegah duplicate effect.

---

## 26. Common Anti-Patterns

### Anti-Pattern 1 — Treat WatchService as Reliable Queue

Salah:

```text
Setiap file pasti menghasilkan event.
Kalau tidak ada event, berarti tidak ada file baru.
```

Benar:

```text
Event hanya fast signal.
Periodic scan tetap wajib untuk correctness.
```

### Anti-Pattern 2 — Processing Directly in Watcher Thread

Salah:

```java
for (WatchEvent<?> event : key.pollEvents()) {
    processLargeCsv(resolve(event));
}
```

Benar:

```text
watcher thread -> enqueue candidate -> worker processes separately
```

### Anti-Pattern 3 — Ignore `OVERFLOW`

Salah:

```java
if (kind == OVERFLOW) continue;
```

Benar:

```text
if OVERFLOW -> mark dirty -> full reconciliation
```

### Anti-Pattern 4 — No Debounce

Salah:

```text
reload config on every MODIFY
```

Benar:

```text
coalesce rapid events, then validate and atomic swap config
```

### Anti-Pattern 5 — Process File Immediately on Create

Salah:

```text
ENTRY_CREATE -> parse file
```

Benar:

```text
ENTRY_CREATE -> wait stable or require atomic publish contract
```

### Anti-Pattern 6 — Assume Recursive Watch

Salah:

```text
register root directory only, expect all subdirectories watched
```

Benar:

```text
register every directory, scan after new directory creation, reconcile periodically
```

### Anti-Pattern 7 — No Checkpoint

Salah:

```text
In-memory set of processed files only
```

Benar:

```text
durable checkpoint + idempotent processor + reconciliation
```

---

## 27. Decision Matrix

### 27.1 Kapan `WatchService` Cocok?

| Use Case | Cocok? | Catatan |
|---|---:|---|
| Hot reload config | Ya | Pakai debounce dan last known good |
| File ingestion folder | Ya | Wajib checkpoint dan reconciliation |
| Local development auto-reload | Ya | Toleransi error lebih tinggi |
| Directory sync ringan | Ya | Tetap perlu scan periodic |
| Audit log security-critical | Hati-hati | Jangan jadikan satu-satunya source |
| Distributed filesystem sync | Hati-hati | Semantics network FS bisa berbeda |
| High-frequency event stream | Kurang cocok | Pertimbangkan broker/log-based design |
| Exactly-once file processing | Tidak cukup | Butuh idempotency dan durable state |

### 27.2 WatchService vs Polling Scan

| Aspek | WatchService | Periodic Scan |
|---|---|---|
| Latency | Rendah | Tergantung interval |
| Completeness | Tidak selalu | Lebih kuat sebagai truth |
| CPU saat idle | Rendah | Bisa lebih tinggi |
| Recovery after restart | Tidak | Ya, jika scan + checkpoint |
| Complexity | Medium | Low-medium |
| Recursive support | Manual | Natural via walk |
| Production correctness | Perlu tambahan | Baik sebagai safety net |

Best practice:

```text
Use both.
WatchService for low-latency signal.
Periodic scan for correctness.
```

---

## 28. Checklist Production Watcher

Sebelum menggunakan watcher di production, pastikan:

### API dan Lifecycle

- [ ] `WatchService` dibuat dari filesystem yang benar.
- [ ] Directory, bukan file, diregister.
- [ ] Ada mapping `WatchKey -> Path` jika multi-directory.
- [ ] `key.reset()` selalu dipanggil setelah processing event.
- [ ] Invalid key ditangani.
- [ ] `WatchService` ditutup saat shutdown.

### Reliability

- [ ] `OVERFLOW` memicu reconciliation.
- [ ] Ada periodic reconciliation walaupun tidak ada event.
- [ ] Ada durable checkpoint.
- [ ] Processing idempotent.
- [ ] Ada retry policy.
- [ ] Ada failed/quarantine path.

### File Correctness

- [ ] File temporary/in-progress diabaikan.
- [ ] Ada stability check atau atomic publish contract.
- [ ] File besar tidak dibaca seluruhnya ke memory.
- [ ] Concurrent processor tidak memproses file yang sama.
- [ ] Rename/delete saat processing ditangani.

### Security

- [ ] Path dinormalisasi dan divalidasi.
- [ ] Symlink policy eksplisit.
- [ ] Permission directory dibatasi.
- [ ] Max file size diterapkan.
- [ ] Malicious archive ditangani jika ada extraction.

### Observability

- [ ] Metrics event count.
- [ ] Metrics overflow.
- [ ] Metrics queue depth.
- [ ] Metrics processing success/failure.
- [ ] Alert watcher mati.
- [ ] Alert reconciliation gagal.
- [ ] Alert oldest pending terlalu tua.

---

## 29. Latihan

### Latihan 1 — Basic Watcher

Buat program Java yang watch satu directory dan mencetak event create/modify/delete.

Syarat:

- gunakan `WatchService`,
- resolve relative path ke absolute path,
- handle `OVERFLOW`,
- panggil `reset()`.

### Latihan 2 — Debounced Config Reload

Buat watcher untuk `config.yml`.

Syarat:

- watch parent directory,
- debounce 500 ms,
- reload hanya jika file valid,
- jika invalid, retain last known good config.

### Latihan 3 — File Ingestion dengan Atomic Publish

Buat producer:

```text
write file.csv.tmp
move to file.csv
```

Buat consumer:

- ignore `.tmp`,
- process `.csv`,
- move success ke `processed/`,
- move failure ke `failed/`.

### Latihan 4 — Reconciliation

Tambahkan periodic scan setiap 30 detik.

Simulasikan aplikasi mati saat file baru masuk. Setelah restart, file harus tetap diproses.

### Latihan 5 — Recursive Watch

Buat recursive watcher:

- scan awal semua directory,
- register setiap directory,
- register directory baru saat `ENTRY_CREATE`,
- scan isi directory baru setelah register.

---

## 30. Ringkasan

`WatchService` adalah API penting di Java NIO.2 untuk menerima notifikasi perubahan directory. Tetapi desain production tidak boleh memperlakukan event filesystem sebagai durable, ordered, replayable event log.

Mental model utama:

```text
WatchService = fast signal
Filesystem scan = truth
Checkpoint = memory across crash
Idempotency = defense against duplicate
Debounce = defense against noisy events
Stability check = defense against partial writes
Reconciliation = defense against missed events
```

Kesalahan umum adalah langsung memproses file saat event datang. Dalam sistem nyata, event hanya berarti “ada sesuatu yang mungkin berubah”. Aplikasi tetap harus memvalidasi kondisi file, menunggu stabil, memastikan path aman, menjaga checkpoint, dan memiliki mekanisme recovery.

Jika dipakai dengan benar, `WatchService` sangat berguna untuk:

- hot reload config,
- file ingestion,
- local sync,
- batch trigger,
- container config reload.

Jika dipakai sebagai satu-satunya sumber kebenaran, ia mudah menjadi sumber bug yang sulit direproduksi.

---

## 31. Referensi

- Java SE API Documentation — `java.nio.file.WatchService`.
- Java SE API Documentation — `java.nio.file.WatchKey`.
- Java SE API Documentation — `java.nio.file.WatchEvent`.
- Java SE API Documentation — `java.nio.file.StandardWatchEventKinds`.
- Oracle Java Tutorials — Watching a Directory for Changes.
- Java SE API Documentation — `Path.register(...)`.
- Java SE API Documentation — `Files.walkFileTree(...)`.
- Java SE API Documentation — `SimpleFileVisitor`.

---

## 32. Status Seri

Seri belum selesai.

Part yang sudah dibuat sampai sekarang:

```text
Part 000 — Mental Model Besar Java I/O
Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
Part 002 — Classic java.io: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance
Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil
Part 005 — Character I/O: Reader, Writer, Line Processing, Large Text File, dan Text Pipeline
Part 006 — Console I/O: System.in/out/err, Console, Password Input, dan CLI Interaction
Part 007 — NIO Core: Buffer, Channel, Selector, dan Perubahan Mental Model dari Stream
Part 008 — ByteBuffer Deep Dive: Heap, Direct, Mapped, Slice, Duplicate, View Buffer
Part 009 — FileChannel: Random Access, Transfer, Locking, Force, dan Zero-Copy
Part 010 — Memory-Mapped File: MappedByteBuffer, Page Cache, Huge Files, dan Trade-off
Part 011 — NIO.2 File API: Path, Files, FileSystem, dan Modern File Operations
Part 012 — File Attributes, Permissions, Ownership, Metadata, dan Cross-Platform Semantics
Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete
Part 014 — Temporary File, Atomic File Write, File Replacement, dan Crash-Safe Persistence
Part 015 — WatchService: File Change Detection, Event Coalescing, dan Reliability Limit
```

Part berikutnya:

```text
Part 016 — Serialization I: Java Object Serialization Architecture, Object Graph, Identity, dan Format
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 014 — Temporary File, Atomic File Write, File Replacement, dan Crash-Safe Persistence](./learn-java-io-nio-networking-data-transfer-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 016 — Serialization I: Java Object Serialization Architecture, Object Graph, Identity, dan Format](./learn-java-io-nio-networking-data-transfer-part-016.md)

</div>