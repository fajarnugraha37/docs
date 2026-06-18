# Part 028 — Concurrency and I/O: Thread-per-Connection, Virtual Thread, Async I/O, Locking, dan Backpressure

> Seri: `learn-java-io-nio-networking-data-transfer`  
> Level: Advanced  
> Fokus: memahami hubungan antara concurrency model dan I/O model di Java, sehingga kita bisa memilih desain yang benar untuk file, socket, HTTP, pipeline transfer, ingestion, export, dan service production-grade.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan **concurrency problem** dan **I/O problem**.
2. Menjelaskan kenapa blocking I/O tidak selalu buruk, dan async I/O tidak selalu lebih baik.
3. Memilih antara:
   - thread-per-request,
   - thread pool bounded,
   - virtual thread,
   - NIO selector/event loop,
   - asynchronous channel,
   - hybrid pipeline.
4. Mendesain pipeline I/O yang bounded-memory, cancellable, observable, dan tahan slow downstream.
5. Menghindari bug umum:
   - thread starvation,
   - unbounded queue,
   - blocking di event loop,
   - unsafe concurrent write,
   - partial write hilang,
   - file lock disalahpahami,
   - async callback menjadi spaghetti,
   - virtual thread dipakai untuk menutupi desain backpressure yang buruk.
6. Memahami peran backpressure sebagai invariant utama sistem I/O.
7. Membuat decision matrix untuk production system.

---

## 2. Problem Besar: I/O Selalu Bertemu Concurrency

Begitu aplikasi melakukan I/O, aplikasi berurusan dengan dunia luar:

- disk lebih lambat dari CPU,
- network tidak deterministic,
- remote service bisa lambat,
- file bisa terkunci,
- client bisa membaca lambat,
- downstream bisa overload,
- connection bisa putus di tengah,
- write bisa partial,
- read bisa kosong sementara,
- retry bisa menduplikasi data,
- buffer bisa membengkak,
- thread bisa habis.

Concurrency muncul karena aplikasi jarang hanya melakukan satu operasi I/O. Biasanya aplikasi melakukan banyak operasi bersamaan:

- banyak HTTP request masuk,
- banyak file upload,
- banyak file download,
- banyak socket connection,
- banyak export job,
- banyak import worker,
- banyak chunk transfer,
- banyak retry,
- banyak compression/decompression pipeline,
- banyak task checksum,
- banyak write ke log/audit/output.

Masalahnya: **semakin banyak I/O concurrent tidak otomatis berarti throughput meningkat**.

Concurrency hanya berguna kalau resource bottleneck masih punya kapasitas. Kalau bottleneck adalah disk tunggal, network bandwidth, remote API rate limit, CPU compression, atau database write throughput, menambah concurrency hanya membuat antrean, timeout, memory pressure, dan retry storm.

---

## 3. Mental Model: Concurrency Model vs I/O Model

Jangan mencampur dua pertanyaan ini:

1. **Bagaimana operasi I/O dilakukan?**
   - blocking stream,
   - non-blocking channel,
   - asynchronous channel,
   - HTTP client async,
   - OS event notification,
   - thread pool background.

2. **Bagaimana operasi concurrent dikelola?**
   - satu thread per request,
   - fixed thread pool,
   - virtual thread per task,
   - event loop,
   - work-stealing pool,
   - completion callback,
   - queue pipeline,
   - structured concurrency,
   - actor-like model.

Contoh:

- Blocking socket + platform thread pool.
- Blocking socket + virtual thread per connection.
- Non-blocking socket + selector event loop.
- Async file channel + completion handler.
- HTTP client async + `CompletableFuture`.
- File read blocking + bounded worker pool.

Jadi “blocking vs async” bukan satu-satunya axis. Axis yang lebih lengkap:

| Axis | Pilihan |
|---|---|
| I/O operation | blocking, non-blocking readiness, async completion |
| Execution unit | platform thread, virtual thread, event loop, callback, executor task |
| Flow control | blocking wait, queue bound, semaphore, reactive demand, manual interest ops |
| Resource bound | thread count, connection count, buffer memory, file descriptor, bandwidth, CPU |
| Failure handling | exception, callback failure, future failure, cancellation, timeout |
| State location | stack, heap object, connection context, callback closure, persisted checkpoint |

Top 1% engineer tidak bertanya “pakai NIO atau thread?”. Pertanyaannya:

> Resource apa yang dibatasi, state disimpan di mana, siapa yang memberi tekanan balik, dan apa yang terjadi saat downstream lambat?

---

## 4. Model 1 — Thread-per-Request / Thread-per-Connection dengan Platform Thread

Model tradisional:

```java
try (ServerSocket server = new ServerSocket(8080)) {
    ExecutorService pool = Executors.newFixedThreadPool(200);

    while (true) {
        Socket socket = server.accept();
        pool.submit(() -> handle(socket));
    }
}
```

Setiap connection/request dikerjakan oleh thread.

### 4.1 Kelebihan

- Sangat mudah dipahami.
- Control flow linear.
- Error handling natural dengan `try/catch`.
- Stack trace mudah dibaca.
- Cocok untuk blocking API seperti JDBC, file I/O, legacy SDK, SFTP library, SOAP client, old HTTP client.
- Debugging relatif mudah.

### 4.2 Kekurangan

Platform thread mahal dibanding task ringan:

- punya stack native,
- dijadwalkan OS,
- context switch lebih mahal,
- jumlah thread besar meningkatkan memory dan scheduling overhead.

Kalau setiap connection menahan satu platform thread saat menunggu network, maka ribuan slow connection bisa menghabiskan thread.

### 4.3 Invariant Wajib

Thread-per-request dengan platform thread **harus bounded**.

Jangan:

```java
ExecutorService pool = Executors.newCachedThreadPool();
```

untuk server I/O production tanpa limit, karena ketika downstream lambat, task bertambah, thread bertambah, memory naik, latency naik, GC naik, lalu sistem collapse.

Gunakan bounded executor:

```java
int threads = 200;
int queueCapacity = 1_000;

ThreadPoolExecutor executor = new ThreadPoolExecutor(
        threads,
        threads,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(queueCapacity),
        new ThreadPoolExecutor.AbortPolicy()
);
```

`AbortPolicy` membuat overload terlihat. Ini lebih baik daripada sistem diam-diam menimbun request sampai OOM.

### 4.4 Kapan Cocok

Cocok jika:

- concurrency tidak terlalu besar,
- workload mostly blocking,
- simplicity lebih penting,
- latency requirement moderate,
- ada limit request/connection,
- I/O operation punya timeout,
- queue bounded,
- tidak ada puluhan ribu idle connection.

Contoh:

- batch file processing worker,
- internal admin service,
- small TCP server,
- transfer worker dengan concurrency 16–200,
- job executor yang membaca file lalu upload ke remote API.

---

## 5. Model 2 — Thread Pool Bounded untuk I/O Pipeline

Untuk file processing dan data transfer, sering lebih tepat memakai bounded worker pool daripada membuat thread per file tanpa batas.

Contoh pipeline:

```text
file discovery -> parse queue -> transform workers -> upload queue -> upload workers -> finalize
```

Setiap stage punya kapasitas.

### 5.1 Kenapa Bounded Queue Penting

Unbounded queue terlihat nyaman:

```java
Executors.newFixedThreadPool(20)
```

Secara internal, `newFixedThreadPool` memakai unbounded queue. Ini berbahaya jika producer lebih cepat dari consumer.

Jika kamu membaca 5 juta record dan submit semuanya sebagai task, queue bisa menyimpan jutaan object.

Lebih aman:

```java
BlockingQueue<Runnable> queue = new ArrayBlockingQueue<>(10_000);
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        20,
        20,
        0,
        TimeUnit.MILLISECONDS,
        queue,
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

`CallerRunsPolicy` memberi backpressure sederhana: saat queue penuh, producer ikut menjalankan task sehingga produksi melambat.

### 5.2 Pattern: Semaphore untuk Membatasi In-Flight I/O

Untuk transfer file/chunk:

```java
Semaphore inFlight = new Semaphore(32);

for (Path file : files) {
    inFlight.acquire();
    executor.submit(() -> {
        try {
            transfer(file);
        } finally {
            inFlight.release();
        }
    });
}
```

Invariant:

> Jumlah operasi transfer aktif tidak boleh melebihi kapasitas downstream.

Ini lebih penting daripada jumlah file yang ditemukan.

### 5.3 Pattern: Bounded Producer-Consumer

```java
BlockingQueue<Record> queue = new ArrayBlockingQueue<>(50_000);

Thread producer = Thread.ofPlatform().start(() -> {
    try (BufferedReader reader = Files.newBufferedReader(input)) {
        String line;
        while ((line = reader.readLine()) != null) {
            queue.put(parse(line)); // blocks if consumers are slow
        }
    } catch (Exception e) {
        // signal failure
    }
});
```

Backpressure muncul dari `queue.put()` yang block saat queue penuh.

### 5.4 Failure Rule

Pipeline bounded harus punya cara menghentikan semua stage saat satu stage gagal.

Jangan biarkan producer terus membaca file 100 GB ketika consumer sudah gagal menulis output.

Butuh:

- shared cancellation flag,
- interrupt,
- poison pill,
- executor shutdown,
- error propagation,
- checkpoint final state.

---

## 6. Model 3 — Virtual Threads untuk Blocking I/O

Virtual thread diperkenalkan sebagai fitur final di Java 21 melalui JEP 444. Tujuannya adalah membuat model thread-per-task tetap sederhana tetapi jauh lebih scalable untuk workload yang banyak menunggu I/O.

Virtual thread adalah thread ringan yang dikelola JVM. Saat virtual thread melakukan blocking operation yang didukung, JVM dapat melepas carrier thread sehingga carrier bisa menjalankan virtual thread lain.

### 6.1 Contoh Dasar

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (URI uri : uris) {
        executor.submit(() -> download(uri));
    }
}
```

Kode tetap linear:

```java
static void download(URI uri) throws IOException, InterruptedException {
    HttpRequest request = HttpRequest.newBuilder(uri).GET().build();
    HttpResponse<Path> response = CLIENT.send(
            request,
            HttpResponse.BodyHandlers.ofFile(tempFileFor(uri))
    );

    if (response.statusCode() != 200) {
        throw new IOException("Unexpected status: " + response.statusCode());
    }
}
```

### 6.2 Kenapa Virtual Thread Menarik untuk I/O

Virtual thread membuat blocking style kembali layak untuk high-concurrency I/O:

- code linear,
- tidak callback-heavy,
- stack trace lebih natural,
- cancellation lebih mudah dibanding callback nested,
- cocok untuk request-per-task,
- cocok untuk banyak call remote yang mostly waiting.

### 6.3 Virtual Thread Bukan Pengganti Backpressure

Kesalahan besar:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Path file : millionsOfFiles) {
        executor.submit(() -> upload(file));
    }
}
```

Virtual thread murah, tapi task, buffer, socket, file descriptor, memory, remote quota, dan bandwidth tidak gratis.

Virtual thread mengurangi biaya thread, bukan menghapus bottleneck sistem.

Tetap butuh:

- semaphore,
- rate limiter,
- bounded queue,
- timeout,
- cancellation,
- retry budget,
- memory budget,
- connection pool limit.

Contoh benar:

```java
Semaphore permits = new Semaphore(64);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Path file : files) {
        permits.acquire();
        executor.submit(() -> {
            try {
                upload(file);
            } finally {
                permits.release();
            }
        });
    }
}
```

### 6.4 Pinning dan Blocking yang Tidak Ideal

Virtual thread bisa kehilangan manfaat jika operation mem-pin carrier thread, misalnya blocking dalam synchronized region tertentu atau native call tertentu. Perilaku Java modern terus membaik, tetapi mental modelnya tetap:

> Jangan menganggap semua blocking sama murahnya.

Rule praktis:

- jangan tahan monitor lama saat I/O,
- hindari `synchronized` yang membungkus socket/file/network call,
- gunakan `ReentrantLock` jika lock bisa menunggu lama,
- ukur dengan JFR jika curiga pinning atau carrier starvation.

Buruk:

```java
synchronized (lock) {
    remoteUpload(bytes); // I/O while holding monitor
}
```

Lebih baik:

```java
Metadata snapshot;
lock.lock();
try {
    snapshot = metadata.copy();
} finally {
    lock.unlock();
}

remoteUpload(snapshot);
```

### 6.5 Kapan Virtual Thread Cocok

Cocok untuk:

- blocking HTTP client calls,
- file transfer worker,
- internal service request handling,
- many independent I/O tasks,
- migration dari thread pool lama,
- codebase yang memakai blocking libraries,
- workflow yang butuh stack-local state.

Kurang cocok jika:

- butuh extremely low-level event-loop optimization,
- harus handle puluhan/ratusan ribu connection idle dengan footprint minimum,
- protocol membutuhkan manual readiness control,
- library blocking mem-pin carrier secara berat,
- bottleneck sebenarnya remote rate limit dan tidak dibatasi.

---

## 7. Model 4 — NIO Selector dan Event Loop

NIO selector bekerja dengan readiness model:

- channel dibuat non-blocking,
- channel didaftarkan ke selector,
- selector memberi tahu channel siap accept/read/write/connect,
- event loop memproses readiness event.

Pseudo-flow:

```java
while (running) {
    selector.select();

    Iterator<SelectionKey> keys = selector.selectedKeys().iterator();
    while (keys.hasNext()) {
        SelectionKey key = keys.next();
        keys.remove();

        if (key.isAcceptable()) accept(key);
        if (key.isReadable()) read(key);
        if (key.isWritable()) write(key);
    }
}
```

### 7.1 Kelebihan Event Loop

- Satu thread bisa mengelola banyak connection.
- Cocok untuk banyak idle/slow connection.
- Memory footprint thread kecil.
- Bisa mengontrol readiness write untuk backpressure.
- Cocok untuk network framework seperti Netty.

### 7.2 Kekurangan Event Loop

- State tidak lagi natural di stack.
- Per-connection state harus disimpan manual.
- Partial read/write harus dikelola eksplisit.
- Error handling lebih kompleks.
- Blocking sedikit saja bisa merusak semua connection di event loop.
- Debugging lebih sulit.

### 7.3 Invariant Event Loop

> Event loop tidak boleh melakukan blocking operation.

Jangan lakukan ini di event loop:

- baca file besar blocking,
- call database blocking,
- call HTTP blocking,
- compression besar,
- JSON parsing besar,
- checksum file besar,
- DNS blocking yang tidak dikontrol,
- logging synchronous lambat,
- `Thread.sleep`,
- `Future.get()`.

Jika butuh kerja berat, offload ke worker pool:

```text
selector event loop -> parse lightweight -> submit heavy work -> worker result -> enqueue response -> enable OP_WRITE
```

### 7.4 Write Backpressure dengan Selector

Kesalahan umum: selalu register `OP_WRITE`.

Socket sering siap write, sehingga event loop bisa spin terus.

Rule:

- register `OP_WRITE` hanya jika ada pending outbound data,
- setelah queue kosong, hapus `OP_WRITE`.

Pseudo:

```java
void enqueueWrite(Connection c, ByteBuffer data) {
    c.outbound.add(data);
    c.key.interestOps(c.key.interestOps() | SelectionKey.OP_WRITE);
    c.key.selector().wakeup();
}

void onWritable(Connection c) throws IOException {
    while (!c.outbound.isEmpty()) {
        ByteBuffer head = c.outbound.peek();
        c.channel.write(head);

        if (head.hasRemaining()) {
            return; // socket send buffer full; wait next OP_WRITE
        }

        c.outbound.remove();
    }

    c.key.interestOps(c.key.interestOps() & ~SelectionKey.OP_WRITE);
}
```

### 7.5 Kapan Selector Cocok

Cocok untuk:

- custom TCP server high connection count,
- protocol gateway,
- proxy,
- long-lived connection,
- chat/message broker style connection,
- framework/network library,
- kasus ketika thread-per-connection terlalu mahal.

Tidak perlu jika:

- concurrency moderate,
- blocking code lebih sederhana,
- virtual thread cukup,
- development cost lebih penting dari micro-optimization,
- protocol bukan bottleneck.

---

## 8. Model 5 — Asynchronous I/O Channels

Java menyediakan asynchronous channels seperti:

- `AsynchronousFileChannel`,
- `AsynchronousSocketChannel`,
- `AsynchronousServerSocketChannel`.

Modelnya completion-based:

1. Kamu memulai operasi.
2. Method return sebelum operasi selesai.
3. Hasil datang melalui `Future` atau `CompletionHandler`.

Dokumentasi `AsynchronousChannel` menjelaskan dua bentuk umum: menggunakan `Future` untuk menunggu hasil, atau `CompletionHandler` yang dipanggil saat operasi selesai atau gagal.

### 8.1 AsynchronousFileChannel

Contoh dengan `Future`:

```java
try (AsynchronousFileChannel channel = AsynchronousFileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer buffer = ByteBuffer.allocate(8192);
    Future<Integer> future = channel.read(buffer, 0);

    Integer bytesRead = future.get(5, TimeUnit.SECONDS);
    if (bytesRead == -1) {
        // EOF
    }
}
```

Tapi hati-hati: jika kamu langsung `future.get()`, kamu membuat flow menjadi blocking lagi. Itu tidak selalu salah, tetapi jangan mengira ini otomatis lebih scalable.

Contoh dengan `CompletionHandler`:

```java
AsynchronousFileChannel channel = AsynchronousFileChannel.open(path, StandardOpenOption.READ);
ByteBuffer buffer = ByteBuffer.allocate(8192);

channel.read(buffer, 0L, null, new CompletionHandler<>() {
    @Override
    public void completed(Integer bytesRead, Object attachment) {
        if (bytesRead == -1) {
            closeQuietly(channel);
            return;
        }
        buffer.flip();
        // consume buffer
        buffer.clear();
        channel.read(buffer, bytesRead, null, this);
    }

    @Override
    public void failed(Throwable exc, Object attachment) {
        closeQuietly(channel);
    }
});
```

Code callback seperti ini cepat menjadi kompleks. Perlu state object yang rapi.

### 8.2 AsynchronousSocketChannel

`AsynchronousSocketChannel` bisa memulai read/write async. Handler menerima jumlah byte atau `-1` jika end-of-stream.

Pseudo:

```java
channel.read(buffer, connection, new CompletionHandler<Integer, Connection>() {
    @Override
    public void completed(Integer n, Connection c) {
        if (n == -1) {
            c.close();
            return;
        }

        c.inbound.flip();
        c.parser.consume(c.inbound);
        c.inbound.compact();

        c.channel.read(c.inbound, c, this);
    }

    @Override
    public void failed(Throwable exc, Connection c) {
        c.close();
    }
});
```

### 8.3 Async Tidak Berarti Tanpa Thread

Async I/O tetap membutuhkan mekanisme eksekusi:

- OS completion mechanism,
- thread pool callback,
- JVM provider,
- executor untuk completion handler.

Jika completion handler melakukan kerja berat, thread callback bisa tersumbat.

Rule:

> Completion handler harus pendek, cepat, dan tidak blocking; kerja berat harus dipindah ke executor lain.

### 8.4 Kapan AsynchronousChannel Cocok

Cocok jika:

- operasi file/socket dapat dipipeline,
- kamu butuh overlap banyak operasi I/O,
- kamu siap mengelola state eksplisit,
- kamu butuh integration dengan completion model,
- workload punya banyak outstanding operation.

Tidak ideal jika:

- kamu hanya akan memanggil `Future.get()` langsung,
- code menjadi sulit dipahami,
- virtual thread sudah cukup,
- bottleneck bukan thread waiting.

---

## 9. Blocking vs Non-Blocking vs Async Completion

Tiga istilah ini sering tercampur.

### 9.1 Blocking

Thread menunggu sampai operasi selesai atau gagal.

```java
int n = input.read(buffer);
```

Jika belum ada data, thread park/block.

### 9.2 Non-Blocking Readiness

Operasi tidak menunggu. Jika belum siap, return 0 atau tidak dipanggil sampai selector memberi readiness.

```java
int n = socketChannel.read(buffer); // can return 0
```

Kamu harus mencoba lagi saat channel ready.

### 9.3 Async Completion

Kamu memulai operasi, lalu diberi callback/future saat selesai.

```java
channel.read(buffer, attachment, handler);
```

### 9.4 Perbandingan

| Model | State berada di | Mudah dipahami | Scalability connection idle | Risiko utama |
|---|---|---:|---:|---|
| Blocking + platform thread | stack | tinggi | rendah-sedang | thread exhaustion |
| Blocking + virtual thread | stack | tinggi | tinggi | unbounded resource, pinning |
| NIO selector | heap connection state | rendah-sedang | tinggi | blocking event loop, state bug |
| Async channel | callback/state object | sedang-rendah | tinggi | callback complexity, hidden pool saturation |
| Bounded worker pipeline | queue/stage | sedang | tergantung | queue sizing, cancellation |

---

## 10. File I/O dan Concurrency

File I/O concurrency berbeda dari network concurrency. Banyak thread membaca file yang sama belum tentu lebih cepat.

### 10.1 Bottleneck File I/O

Bottleneck bisa berupa:

- storage throughput,
- random IOPS,
- page cache,
- filesystem lock,
- disk queue,
- network filesystem,
- CPU parsing,
- GC allocation,
- output sink.

### 10.2 Concurrent Read

Concurrent read bisa membantu jika:

- storage mendukung parallelism,
- file besar bisa dipartisi,
- parsing CPU-heavy,
- setiap worker membaca segment berbeda,
- output bisa digabung aman.

Tapi bisa merusak jika:

- HDD random seek,
- network filesystem latency,
- page cache thrashing,
- terlalu banyak buffer besar,
- ordering harus dipertahankan.

### 10.3 Concurrent Write

Concurrent write ke file yang sama sangat rawan.

Masalah:

- interleaving bytes,
- record rusak,
- append atomicity tidak selalu sesuai asumsi,
- buffering wrapper tidak thread-safe untuk semantic record,
- flush order tidak sama dengan logical order.

Lebih aman memakai single writer:

```text
many producers -> bounded queue -> single writer -> file
```

Contoh:

```java
final class SingleFileWriter implements AutoCloseable {
    private final BlockingQueue<String> queue = new ArrayBlockingQueue<>(10_000);
    private final Thread writer;
    private volatile boolean running = true;
    private final BufferedWriter out;

    SingleFileWriter(Path path) throws IOException {
        this.out = Files.newBufferedWriter(path, StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE);

        this.writer = Thread.ofPlatform().start(this::runWriter);
    }

    void writeLine(String line) throws InterruptedException {
        if (!running) {
            throw new IllegalStateException("writer closed");
        }
        queue.put(line);
    }

    private void runWriter() {
        try {
            while (running || !queue.isEmpty()) {
                String line = queue.poll(200, TimeUnit.MILLISECONDS);
                if (line != null) {
                    out.write(line);
                    out.newLine();
                }
            }
            out.flush();
        } catch (Exception e) {
            // production: store failure and make producers observe it
        } finally {
            try { out.close(); } catch (IOException ignored) {}
        }
    }

    @Override
    public void close() throws InterruptedException {
        running = false;
        writer.join();
    }
}
```

### 10.4 Concurrent Append Pattern

Jika banyak worker menghasilkan output, jangan semua worker langsung menulis ke satu `BufferedWriter`.

Gunakan:

- sharded output file per partition,
- single writer queue,
- append-only log dengan explicit framing,
- database/message queue jika durability dan concurrency tinggi.

---

## 11. File Locking: Apa yang Bisa dan Tidak Bisa Dijamin

Java menyediakan `FileLock` melalui `FileChannel.lock()` dan `tryLock()`.

Namun file lock bukan magic distributed transaction.

### 11.1 Advisory vs Mandatory

Di banyak sistem, file lock bersifat advisory: process lain harus ikut menghormati lock. Jika process lain tidak memakai lock, ia mungkin tetap bisa membaca/menulis.

### 11.2 Lock Scope

Pertanyaan penting:

- Lock berlaku untuk region file atau seluruh file?
- Lock berlaku antar thread dalam JVM yang sama?
- Lock berlaku antar process?
- Bagaimana perilaku di network filesystem?
- Apa yang terjadi saat process crash?

### 11.3 Pattern: Lock File untuk Job Singleton

```java
Path lockPath = workDir.resolve("job.lock");

try (FileChannel channel = FileChannel.open(lockPath,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {

    try (FileLock lock = channel.tryLock()) {
        if (lock == null) {
            throw new IllegalStateException("Another job is running");
        }

        runJob();
    }
}
```

Caveat:

- di beberapa platform `tryLock()` bisa throw exception, bukan return null,
- network filesystem bisa punya semantics berbeda,
- lock tidak menggantikan idempotency,
- lock tidak menggantikan checkpoint.

### 11.4 Lock Jangan Menjadi Satu-Satunya Safety

Untuk ingestion/export production, gunakan kombinasi:

- lock untuk mengurangi concurrent execution,
- state table/checkpoint untuk correctness,
- atomic file move untuk publish,
- idempotency key untuk retry,
- reconciliation untuk recovery.

---

## 12. Backpressure: Invariant Paling Penting

Backpressure berarti downstream yang lambat bisa memperlambat upstream secara terkontrol.

Tanpa backpressure:

```text
producer cepat -> queue membesar -> memory naik -> GC naik -> latency naik -> timeout -> retry -> makin overload
```

Dengan backpressure:

```text
producer cepat -> queue penuh -> producer block/reject/throttle -> sistem tetap bounded
```

### 12.1 Backpressure Bukan Sekadar Queue

Queue hanya salah satu alat. Backpressure bisa berbentuk:

- bounded blocking queue,
- semaphore,
- rate limiter,
- TCP receive window,
- selector write interest,
- HTTP 429,
- bounded executor,
- reactive demand,
- chunk permit,
- database connection pool,
- file descriptor limit,
- memory budget.

### 12.2 Backpressure Decision

Saat sistem penuh, pilih satu:

1. **Block** producer.
2. **Reject** request.
3. **Drop** data.
4. **Spool** ke disk.
5. **Throttle** rate.
6. **Degrade** quality.
7. **Shed load** berdasarkan priority.

Tidak memilih berarti biasanya memilih OOM secara tidak sadar.

### 12.3 Bounded Memory Formula

Untuk data transfer chunked:

```text
max_memory_for_buffers = max_in_flight_chunks × chunk_size × copies_per_chunk
```

Jika:

- `max_in_flight_chunks = 200`,
- `chunk_size = 4 MiB`,
- `copies_per_chunk = 2`,

maka buffer memory ≈ 1.6 GiB.

Virtual thread tidak mengubah matematika ini.

### 12.4 Anti-Pattern: Async Tanpa Backpressure

```java
List<CompletableFuture<Void>> futures = files.stream()
        .map(file -> CompletableFuture.runAsync(() -> upload(file)))
        .toList();
```

Ini terlihat elegan tetapi bisa membuat semua upload berjalan atau antre tanpa batas tergantung executor.

Lebih baik:

```java
Semaphore permits = new Semaphore(32);
List<CompletableFuture<Void>> futures = new ArrayList<>();

for (Path file : files) {
    permits.acquire();
    CompletableFuture<Void> f = CompletableFuture.runAsync(() -> {
        try {
            upload(file);
        } finally {
            permits.release();
        }
    }, executor);
    futures.add(f);
}

CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).join();
```

Namun perhatikan: list future untuk jutaan file juga bisa besar. Untuk skala besar, gunakan streaming submission dan completion service.

---

## 13. Timeout dan Cancellation

Concurrency I/O tanpa timeout adalah bug laten.

### 13.1 Timeout yang Dibutuhkan

Untuk network:

- DNS timeout/resolution behavior,
- connect timeout,
- TLS handshake timeout,
- read timeout,
- write timeout,
- request timeout,
- idle timeout,
- pool acquisition timeout.

Untuk file/job:

- lock acquisition timeout,
- queue offer timeout,
- stage processing timeout,
- chunk timeout,
- total job deadline.

### 13.2 Cancellation Harus Propagate

Kalau user membatalkan download:

- stop reading source,
- stop writing sink,
- close channel/socket,
- release permits,
- delete temp file jika tidak resumable,
- mark checkpoint cancelled,
- stop retry.

Cancellation yang hanya set flag tapi thread sedang blocking selamanya tidak cukup. Gunakan timeout atau close resource dari thread lain.

### 13.3 Interrupt Rule

Blocking Java API tidak semuanya merespons interrupt dengan cara yang sama. Banyak I/O lebih reliable dibatalkan dengan menutup channel/socket/stream.

Pattern:

```java
Future<?> future = executor.submit(() -> transfer(source, target));

try {
    future.get(5, TimeUnit.MINUTES);
} catch (TimeoutException e) {
    future.cancel(true);
    closeQuietly(source); // if accessible
    closeQuietly(target);
    throw e;
}
```

---

## 14. Error Propagation di Concurrent I/O

Concurrent I/O sering gagal sebagian. Jangan hanya log exception di worker.

Buruk:

```java
executor.submit(() -> {
    try {
        process(file);
    } catch (Exception e) {
        log.error("failed", e);
    }
});
```

Caller tidak tahu ada failure.

Lebih baik:

```java
List<Future<Result>> futures = new ArrayList<>();

for (Path file : files) {
    futures.add(executor.submit(() -> process(file)));
}

List<Throwable> failures = new ArrayList<>();
for (Future<Result> future : futures) {
    try {
        future.get();
    } catch (ExecutionException e) {
        failures.add(e.getCause());
    }
}

if (!failures.isEmpty()) {
    throw new BatchFailedException(failures);
}
```

Untuk job besar, jangan simpan semua future. Gunakan `ExecutorCompletionService`:

```java
ExecutorCompletionService<Result> ecs = new ExecutorCompletionService<>(executor);
int submitted = 0;

for (Path file : files) {
    ecs.submit(() -> process(file));
    submitted++;
}

for (int i = 0; i < submitted; i++) {
    Future<Result> completed = ecs.take();
    Result result = completed.get();
    // aggregate
}
```

---

## 15. Structured Concurrency sebagai Model Berpikir

Structured concurrency membuat lifetime task mengikuti lexical scope. Walaupun API-nya berkembang antar versi Java, mental modelnya penting:

> Task yang dibuat bersama harus selesai, gagal, atau dibatalkan bersama.

Tanpa struktur:

- child task bisa bocor,
- error hilang,
- cancellation tidak jelas,
- resource ditutup saat child masih berjalan,
- request selesai tetapi background task masih menulis.

Dengan struktur:

```text
handle request
  ├─ read metadata
  ├─ download object
  ├─ calculate checksum
  └─ write audit
scope exits only after children resolved or cancelled
```

Dalam Java biasa, kamu bisa menerapkan prinsip ini meskipun tanpa API structured concurrency:

- gunakan `try-with-resources` untuk executor scope,
- collect futures,
- cancel siblings on failure,
- close resources after workers selesai,
- jangan fire-and-forget kecuali benar-benar background service dengan lifecycle sendiri.

---

## 16. Rate Limiting dan Bulkhead

### 16.1 Rate Limiting

Jika remote API hanya mengizinkan 300 request/minute, concurrency 100 tidak menjamin aman. Kamu butuh rate limit.

Sederhana:

```java
final class SimpleRateLimiter {
    private final long intervalNanos;
    private final AtomicLong next = new AtomicLong(System.nanoTime());

    SimpleRateLimiter(int permitsPerSecond) {
        this.intervalNanos = 1_000_000_000L / permitsPerSecond;
    }

    void acquire() throws InterruptedException {
        while (true) {
            long now = System.nanoTime();
            long current = next.get();
            long allowedAt = Math.max(now, current);
            long updated = allowedAt + intervalNanos;

            if (next.compareAndSet(current, updated)) {
                long sleep = allowedAt - now;
                if (sleep > 0) {
                    TimeUnit.NANOSECONDS.sleep(sleep);
                }
                return;
            }
        }
    }
}
```

Dalam production, biasanya gunakan library matang, tetapi prinsipnya tetap: **rate** berbeda dari **concurrency**.

### 16.2 Bulkhead

Bulkhead memisahkan kapasitas antar downstream.

Jangan semua operasi memakai executor yang sama:

```text
bad:
  one global executor for file read, DB, remote API, audit, email
```

Jika email lambat, file ingestion ikut mati.

Lebih baik:

```text
file-read-executor
transform-executor
remote-upload-executor
audit-executor
```

Atau semaphore per dependency:

```java
Semaphore uploadPermits = new Semaphore(32);
Semaphore checksumPermits = new Semaphore(Runtime.getRuntime().availableProcessors());
Semaphore dbPermits = new Semaphore(20);
```

---

## 17. Concurrency Design untuk Data Transfer

### 17.1 Chunked Transfer Concurrent

Desain umum:

```text
read chunks -> checksum chunks -> upload chunks -> commit manifest
```

Pertanyaan penting:

- Berapa chunk size?
- Berapa in-flight chunk?
- Apakah order upload penting?
- Apakah commit atomic?
- Bagaimana resume?
- Bagaimana retry chunk?
- Bagaimana checksum disimpan?
- Bagaimana cancellation membersihkan partial upload?

### 17.2 Pattern: Bounded Chunk Transfer

```java
record Chunk(long index, long offset, int length, Path tempFile, String checksum) {}

Semaphore inFlight = new Semaphore(16);
ExecutorService executor = Executors.newFixedThreadPool(16);
CompletionService<ChunkResult> completion = new ExecutorCompletionService<>(executor);

int submitted = 0;
try (FileChannel channel = FileChannel.open(source, StandardOpenOption.READ)) {
    long offset = 0;
    long index = 0;

    while (offset < channel.size()) {
        inFlight.acquire();
        long chunkOffset = offset;
        long chunkIndex = index;
        int length = computeLength(channel.size(), offset);

        completion.submit(() -> {
            try {
                return uploadChunk(channel, chunkIndex, chunkOffset, length);
            } finally {
                inFlight.release();
            }
        });

        submitted++;
        offset += length;
        index++;
    }

    for (int i = 0; i < submitted; i++) {
        ChunkResult result = completion.take().get();
        recordManifest(result);
    }
}
```

Caveat: `FileChannel` supports concurrent operations in defined ways, but you still must reason about position-based reads vs shared position. Prefer positional read for chunking to avoid shared mutable channel position.

### 17.3 Shared Position Bug

Buruk:

```java
// multiple threads share channel position
channel.position(offset);
channel.read(buffer);
```

Race condition.

Lebih baik:

```java
channel.read(buffer, offset); // positional read
```

---

## 18. Read/Write Coordination dan Ownership

Concurrent I/O selalu membutuhkan ownership rule.

### 18.1 Buffer Ownership

Satu buffer tidak boleh dimutasi oleh dua thread tanpa protocol.

Buruk:

```java
ByteBuffer shared = ByteBuffer.allocate(8192);

executor.submit(() -> channel1.read(shared));
executor.submit(() -> channel2.write(shared));
```

`position/limit` berubah, data rusak.

Lebih aman:

- buffer per task,
- buffer pool dengan acquire/release,
- immutable byte array after flip,
- ownership transfer via queue.

### 18.2 Stream Ownership

Jika function menerima `InputStream`, tentukan siapa yang menutup.

```java
void upload(InputStream in) { ... }
```

Pertanyaan:

- Apakah `upload` boleh menutup `in`?
- Apakah caller masih butuh stream?
- Bagaimana jika upload async dan caller keluar dari scope?

Lebih eksplisit:

```java
void uploadAndClose(InputStream in) { ... }
void uploadWithoutClosing(InputStream in) { ... }
```

Atau gunakan supplier:

```java
void upload(Supplier<InputStream> streamFactory) { ... }
```

### 18.3 Channel Ownership

Async operation bisa masih berjalan saat channel ditutup.

Rule:

- channel ditutup setelah semua operation selesai/cancelled,
- callback harus handle `AsynchronousCloseException`,
- shutdown harus idempotent,
- close boleh dipanggil berkali-kali.

---

## 19. Observability untuk Concurrent I/O

Tanpa observability, concurrent I/O failure terlihat seperti “kadang lambat”.

### 19.1 Metrics Minimal

Untuk setiap pipeline:

- active tasks,
- queued tasks,
- completed tasks,
- failed tasks,
- cancelled tasks,
- bytes read/sec,
- bytes written/sec,
- records/sec,
- average latency,
- p95/p99 latency,
- retry count,
- timeout count,
- queue wait time,
- downstream response time,
- buffer pool usage,
- file descriptor count,
- open connection count,
- rejected tasks.

### 19.2 Logs

Log harus membawa correlation:

- job id,
- transfer id,
- file id,
- chunk index,
- offset,
- attempt,
- remote endpoint,
- checksum,
- thread name atau virtual thread context,
- state transition.

Contoh:

```text
transfer_id=abc file=orders.csv chunk=42 offset=44040192 attempt=2 state=UPLOAD_RETRY reason=READ_TIMEOUT
```

### 19.3 Tracing

Untuk data transfer service:

```text
receive request
  -> allocate transfer id
  -> read source chunk
  -> checksum
  -> upload remote
  -> commit manifest
  -> atomic publish
```

Span harus menunjukkan stage mana bottleneck.

---

## 20. Anti-Pattern Besar

### 20.1 “Async Semua Hal”

Async tanpa model state dan backpressure menghasilkan sistem yang sulit dibaca dan sulit dihentikan.

### 20.2 “Virtual Thread Berarti Unlimited”

Virtual thread murah, tetapi downstream tidak unlimited.

### 20.3 “Satu Global Executor”

Satu pool untuk semua dependency menyebabkan failure propagation antar komponen.

### 20.4 “Unbounded Queue”

Unbounded queue mengubah overload menjadi memory leak.

### 20.5 “Fire-and-Forget I/O”

Fire-and-forget sering kehilangan error, cancellation, dan ownership resource.

### 20.6 “Blocking di Event Loop”

Satu blocking call bisa menahan ribuan connection.

### 20.7 “Concurrent Write Langsung ke File yang Sama”

Tanpa framing dan single-writer discipline, output bisa corrupt.

### 20.8 “Retry Tanpa Idempotency”

Concurrency + retry tanpa idempotency menciptakan duplicate write.

### 20.9 “Timeout Hanya di Connect”

Read/write/overall deadline juga perlu.

### 20.10 “Benchmark I/O dengan Data Kecil dan Cache Hangat”

Benchmark kecil sering mengukur page cache/memory copy, bukan real I/O.

---

## 21. Decision Matrix

### 21.1 Pilih Blocking + Platform Thread Jika

- concurrency rendah-sedang,
- code harus sederhana,
- thread count bounded,
- workload mostly blocking,
- latency tidak ekstrem,
- tidak butuh puluhan ribu connection.

### 21.2 Pilih Blocking + Virtual Thread Jika

- banyak I/O waiting,
- ingin code linear,
- Java 21+ tersedia,
- blocking library dominan,
- setiap task independent,
- tetap ada semaphore/rate limit.

### 21.3 Pilih NIO Selector Jika

- banyak long-lived connection,
- butuh footprint sangat rendah,
- siap mengelola state machine manual,
- tidak boleh blocking di event loop,
- protocol custom/performance-critical.

### 21.4 Pilih AsynchronousChannel Jika

- ingin completion-based I/O,
- banyak outstanding operation,
- cocok dengan callback/future model,
- siap mengelola lifecycle callback.

### 21.5 Pilih Bounded Pipeline Jika

- file/batch processing,
- stage berbeda punya bottleneck berbeda,
- perlu checkpoint/restart,
- perlu memory bound,
- perlu observability per stage.

---

## 22. Production Pattern: Reliable Concurrent File Upload

### 22.1 Requirement

Upload file besar ke remote service:

- file bisa 1 GB–100 GB,
- upload chunk concurrent,
- retry per chunk,
- checksum per chunk,
- resume jika process restart,
- max memory 512 MB,
- remote rate limit 100 request/minute,
- final commit harus atomic secara logical.

### 22.2 Design

```text
DISCOVER
  -> CREATE_TRANSFER_RECORD
  -> SPLIT_LOGICALLY
  -> for each chunk:
       READ_RANGE
       CHECKSUM
       UPLOAD_WITH_RETRY
       RECORD_CHUNK_SUCCESS
  -> VERIFY_ALL_CHUNKS
  -> COMMIT_REMOTE
  -> MARK_COMPLETED
```

### 22.3 Concurrency Controls

- `uploadPermits = 8`
- `checksumPermits = CPU cores`
- `chunkSize = 8 MiB`
- `max in-memory chunks = 8–16`
- rate limiter = 100/min
- retry budget = max 3 per chunk
- timeout per chunk
- overall transfer deadline

### 22.4 State Machine

```text
NEW
  -> IN_PROGRESS
  -> PAUSED
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> COMMITTING
  -> COMPLETED
  -> CANCELLED
```

### 22.5 Invariants

- Chunk is identified by `(transferId, chunkIndex, offset, length, checksum)`.
- Upload chunk is idempotent using same chunk key.
- Manifest is source of truth.
- Final commit only happens after all chunks verified.
- Temp/partial remote objects are not visible as final object.
- Retry never changes chunk identity.
- Process restart resumes from manifest, not from memory.

---

## 23. Code Sketch: Virtual Threads + Semaphore + Timeout

```java
public final class ConcurrentUploader {
    private final HttpClient client;
    private final Semaphore permits;

    public ConcurrentUploader(HttpClient client, int maxConcurrentUploads) {
        this.client = Objects.requireNonNull(client);
        this.permits = new Semaphore(maxConcurrentUploads);
    }

    public void uploadAll(List<Path> files) throws Exception {
        List<Future<?>> futures = new ArrayList<>();

        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (Path file : files) {
                permits.acquire();
                futures.add(executor.submit(() -> {
                    try {
                        uploadOne(file);
                    } finally {
                        permits.release();
                    }
                }));
            }

            List<Throwable> failures = new ArrayList<>();
            for (Future<?> future : futures) {
                try {
                    future.get();
                } catch (ExecutionException e) {
                    failures.add(e.getCause());
                }
            }

            if (!failures.isEmpty()) {
                throw new AggregateUploadException(failures);
            }
        }
    }

    private void uploadOne(Path file) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uploadUri(file))
                .timeout(Duration.ofMinutes(5))
                .PUT(HttpRequest.BodyPublishers.ofFile(file))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            throw new IOException("Upload failed for " + file + ": " + response.statusCode());
        }
    }

    private URI uploadUri(Path file) {
        // example only
        return URI.create("https://example.internal/upload/" + file.getFileName());
    }
}
```

Catatan:

- Virtual thread memberi simplicity.
- Semaphore memberi backpressure.
- HTTP timeout mencegah hanging task.
- Error dikumpulkan, tidak hilang.
- Untuk jutaan file, jangan simpan semua future; gunakan completion service atau windowed submission.

---

## 24. Code Sketch: Windowed Submission untuk Banyak File

Untuk jutaan input, jangan submit semua task sekaligus.

```java
public static <T> void processWindowed(
        Iterator<T> items,
        int maxInFlight,
        ExecutorService executor,
        ThrowingConsumer<T> processor
) throws Exception {
    ExecutorCompletionService<Void> ecs = new ExecutorCompletionService<>(executor);
    int inFlight = 0;
    int submitted = 0;
    List<Throwable> failures = new ArrayList<>();

    while (items.hasNext() || inFlight > 0) {
        while (items.hasNext() && inFlight < maxInFlight) {
            T item = items.next();
            ecs.submit(() -> {
                processor.accept(item);
                return null;
            });
            inFlight++;
            submitted++;
        }

        Future<Void> done = ecs.take();
        inFlight--;

        try {
            done.get();
        } catch (ExecutionException e) {
            failures.add(e.getCause());
            // optional: stop early depending on policy
        }
    }

    if (!failures.isEmpty()) {
        throw new AggregateProcessingException(submitted, failures);
    }
}
```

Ini menjaga jumlah task aktif bounded.

---

## 25. Testing Strategy

Concurrent I/O harus dites dengan failure, bukan hanya happy path.

### 25.1 Test Case Wajib

- Slow source.
- Slow sink.
- Sink timeout.
- Partial write.
- Connection reset.
- File deleted mid-read.
- Disk full simulation.
- Permission denied.
- Queue full.
- Worker exception.
- Cancellation mid-transfer.
- Retry duplicate.
- Out-of-order chunk completion.
- Large file.
- Many small files.
- Concurrent same target.
- Process restart/resume.

### 25.2 Deterministic Fake I/O

Buat fake stream/channel yang bisa:

- return partial read,
- return 0,
- throw after N bytes,
- block until released,
- simulate slow write,
- verify close called.

### 25.3 Load Test

Measure:

- max heap,
- direct memory,
- thread count,
- virtual thread count,
- file descriptors,
- queue depth,
- p99 latency,
- throughput,
- retry rate,
- GC pause,
- CPU usage,
- remote error rate.

---

## 26. Checklist Production

Sebelum memilih model concurrency + I/O, jawab:

1. Berapa concurrency maksimal?
2. Apa resource bottleneck utama?
3. Apakah queue bounded?
4. Apa yang terjadi saat queue penuh?
5. Apakah operasi punya timeout?
6. Apakah cancellation menutup resource?
7. Apakah retry idempotent?
8. Apakah partial failure bisa dipulihkan?
9. Apakah output write atomic/logically committed?
10. Apakah buffer memory dihitung?
11. Apakah file descriptor limit cukup?
12. Apakah event loop bebas blocking?
13. Apakah virtual thread tetap dibatasi oleh semaphore/rate limit?
14. Apakah executor dipisah per dependency?
15. Apakah error worker sampai ke caller?
16. Apakah shutdown graceful?
17. Apakah metrics cukup untuk melihat bottleneck?
18. Apakah ada load shedding?
19. Apakah ada runbook saat downstream lambat?
20. Apakah desain bisa resume setelah crash?

---

## 27. Ringkasan

Concurrency dan I/O tidak bisa dipisahkan. I/O membuat aplikasi menunggu dunia luar; concurrency menentukan bagaimana banyak operasi menunggu, berjalan, gagal, dan dibatasi.

Prinsip utama:

1. Blocking I/O tidak selalu buruk.
2. Async I/O tidak otomatis lebih cepat.
3. Virtual thread membuat blocking style scalable, tetapi tidak menghapus kebutuhan backpressure.
4. Event loop sangat kuat, tetapi tidak boleh blocking.
5. Async channel membutuhkan state management yang disiplin.
6. Queue harus bounded.
7. Retry harus punya idempotency.
8. Concurrent file write harus punya single-writer/framing/locking strategy.
9. Timeout dan cancellation adalah bagian desain, bukan tambahan belakangan.
10. Backpressure adalah invariant utama production I/O.

Kalimat kunci:

> Model concurrency yang baik bukan yang menjalankan sebanyak mungkin operasi, tetapi yang menjaga semua resource tetap bounded sambil mempertahankan throughput, correctness, dan recoverability.

---

## 28. Referensi Utama

- Oracle Java SE 25 API — `AsynchronousFileChannel`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/AsynchronousFileChannel.html
- Oracle Java SE 26 API — `AsynchronousSocketChannel`  
  https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/nio/channels/AsynchronousSocketChannel.html
- Oracle Java SE 25 API — `AsynchronousChannel`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/AsynchronousChannel.html
- Oracle Java SE 25 API — `AsynchronousServerSocketChannel`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/AsynchronousServerSocketChannel.html
- OpenJDK JEP 444 — Virtual Threads  
  https://openjdk.org/jeps/444
- Oracle Java 21 Documentation — Virtual Threads  
  https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html
- Oracle Java API — `java.nio.channels` package  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/package-summary.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-nio-networking-data-transfer-part-027.md">⬅️ Part 027 — Performance Engineering for I/O: Syscall, Page Cache, GC, Direct Memory, Benchmark, dan Profiling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-io-nio-networking-data-transfer-part-029.md">Part 029 — Security, Robustness, dan Defensive I/O: Path Traversal, Zip Slip, Deserialization, Resource Exhaustion ➡️</a>
</div>
