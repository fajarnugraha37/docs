# learn-java-servlet-websocket-web-container-runtime — Part 015
# Servlet Non-Blocking I/O

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `015`  
> Topik: Servlet Non-Blocking I/O — `ReadListener`, `WriteListener`, `ServletInputStream`, `ServletOutputStream`, readiness, backpressure, streaming upload/download, dan failure modelling  
> Rentang: Java 8 sampai Java 25, Java EE `javax.servlet.*` sampai Jakarta EE `jakarta.servlet.*`

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas **Async Servlet**: bagaimana request dapat keluar dari thread container utama, diproses secara asynchronous, lalu diselesaikan nanti melalui `AsyncContext.complete()` atau `dispatch()`.

Part ini membahas sesuatu yang sering tertukar dengan async servlet, yaitu **Servlet Non-Blocking I/O**.

Async servlet menjawab pertanyaan:

> “Bagaimana request bisa tetap hidup tanpa menahan worker thread selama operasi asynchronous berlangsung?”

Non-blocking I/O menjawab pertanyaan yang lebih spesifik:

> “Bagaimana aplikasi membaca request body atau menulis response body hanya ketika stream siap, tanpa memblokir thread pada operasi socket I/O?”

Ini penting untuk kasus seperti:

- upload besar,
- download besar,
- proxying stream,
- server-sent streaming,
- long-lived response,
- slow client,
- high concurrency dengan payload besar,
- gateway/filter yang harus membaca dan meneruskan body,
- service yang harus menjaga memory tetap bounded.

Namun ini juga salah satu area Servlet yang paling mudah disalahpahami. Banyak developer mengira:

```java
request.startAsync();
```

berarti seluruh I/O otomatis non-blocking. Tidak begitu.

Banyak juga yang mengira:

```java
inputStream.setReadListener(...);
outputStream.setWriteListener(...);
```

berarti aplikasi pasti lebih cepat. Juga tidak selalu.

Target part ini adalah membentuk mental model yang benar: **non-blocking Servlet I/O adalah state machine readiness-driven, bukan sekadar callback API**.

---

## 1. Posisi Non-Blocking I/O dalam Servlet Runtime

Secara sederhana, ada empat model yang sering tercampur:

```text
1. Synchronous blocking servlet
   Thread container membaca request, menjalankan aplikasi, menulis response, lalu selesai.

2. Async servlet
   Request dilepas dari thread container, aplikasi dapat melanjutkan nanti memakai AsyncContext.

3. Servlet non-blocking I/O
   Aplikasi membaca/menulis stream berdasarkan readiness callback: ReadListener/WriteListener.

4. Reactive framework/runtime
   Seluruh pipeline aplikasi dibangun event-driven dengan backpressure semantics framework-level.
```

Servlet non-blocking I/O berada di antara model classic servlet dan reactive runtime penuh.

Ia tidak otomatis mengubah seluruh aplikasi menjadi reactive. Ia hanya memberi API agar **servlet application code tidak memblokir saat membaca body atau menulis body**.

---

## 2. Mental Model Dasar: Dari Blocking ke Readiness-Driven

### 2.1 Blocking I/O biasa

Pada servlet blocking biasa:

```java
byte[] buffer = new byte[8192];
int n;
while ((n = request.getInputStream().read(buffer)) != -1) {
    process(buffer, n);
}
```

Modelnya:

```text
thread calls read()
  ↓
if data available -> return data
if no data yet     -> thread waits / blocks
if EOF             -> return -1
```

Ini sederhana dan sering cukup baik.

Masalahnya muncul bila banyak client lambat mengirim body. Misalnya 10.000 upload lambat, masing-masing menahan thread saat `read()` menunggu data. Walaupun CPU idle, thread pool bisa habis.

### 2.2 Non-blocking I/O

Pada non-blocking Servlet I/O:

```text
application registers listener
  ↓
container notifies when read/write possible
  ↓
application loops while stream.isReady()
  ↓
when stream not ready, application returns control to container
  ↓
container calls again later
```

Modelnya bukan “panggil read dan tunggu”, tapi:

```text
only read when the stream says it is ready
only write when the stream says it is ready
return quickly when it is not ready
```

Inilah inti non-blocking I/O.

---

## 3. API Utama

Pada namespace lama Java EE:

```java
javax.servlet.ServletInputStream
javax.servlet.ServletOutputStream
javax.servlet.ReadListener
javax.servlet.WriteListener
```

Pada namespace modern Jakarta EE:

```java
jakarta.servlet.ServletInputStream
jakarta.servlet.ServletOutputStream
jakarta.servlet.ReadListener
jakarta.servlet.WriteListener
```

Konsepnya sama. Yang berubah adalah package namespace.

### 3.1 `ServletInputStream`

Method penting:

```java
boolean isFinished();
boolean isReady();
void setReadListener(ReadListener readListener);
```

Makna:

| Method | Makna |
|---|---|
| `isFinished()` | Apakah seluruh request body sudah dibaca. |
| `isReady()` | Apakah stream dapat dibaca tanpa blocking. |
| `setReadListener(...)` | Mengaktifkan mode non-blocking read dengan callback listener. |

Dalam mode non-blocking, aplikasi harus menghormati `isReady()`. Membaca saat stream belum ready adalah pelanggaran kontrak dan dapat menyebabkan `IllegalStateException` tergantung implementasi container.

### 3.2 `ReadListener`

Method:

```java
void onDataAvailable() throws IOException;
void onAllDataRead() throws IOException;
void onError(Throwable t);
```

Makna:

| Callback | Dipanggil ketika |
|---|---|
| `onDataAvailable()` | Data request body tersedia untuk dibaca tanpa blocking. |
| `onAllDataRead()` | Semua data request body sudah selesai dibaca. |
| `onError(Throwable)` | Ada error saat non-blocking read. |

### 3.3 `ServletOutputStream`

Method penting:

```java
boolean isReady();
void setWriteListener(WriteListener writeListener);
```

Makna:

| Method | Makna |
|---|---|
| `isReady()` | Apakah output stream bisa ditulis tanpa blocking. |
| `setWriteListener(...)` | Mengaktifkan mode non-blocking write dengan callback listener. |

### 3.4 `WriteListener`

Method:

```java
void onWritePossible() throws IOException;
void onError(Throwable t);
```

Makna:

| Callback | Dipanggil ketika |
|---|---|
| `onWritePossible()` | Container menilai output stream bisa ditulis tanpa blocking. |
| `onError(Throwable)` | Ada error saat non-blocking write. |

---

## 4. Async Servlet vs Non-Blocking I/O

Ini perbedaan paling penting.

| Aspek | Async Servlet | Non-Blocking I/O |
|---|---|---|
| Tujuan utama | Melepas request dari thread container utama | Membaca/menulis stream tanpa blocking |
| API utama | `AsyncContext` | `ReadListener`, `WriteListener` |
| Problem yang diselesaikan | Menunggu operasi async eksternal | Slow body input/output |
| Apakah otomatis non-blocking? | Tidak | Ya, untuk stream I/O jika dipakai benar |
| Cocok untuk | Long polling, deferred result, async service call | Streaming upload/download, slow clients, gateway streaming |
| Kompleksitas | Sedang | Tinggi |

Contoh async tapi masih blocking:

```java
AsyncContext async = request.startAsync();
executor.submit(() -> {
    try (InputStream in = request.getInputStream()) {
        in.readAllBytes(); // tetap blocking pada executor thread
        async.complete();
    } catch (IOException e) {
        async.complete();
    }
});
```

Contoh non-blocking read:

```java
AsyncContext async = request.startAsync();
ServletInputStream in = request.getInputStream();
in.setReadListener(new ReadListener() {
    @Override
    public void onDataAvailable() throws IOException {
        byte[] buffer = new byte[8192];
        while (in.isReady() && !in.isFinished()) {
            int n = in.read(buffer);
            if (n > 0) {
                // process chunk
            }
        }
    }

    @Override
    public void onAllDataRead() throws IOException {
        async.complete();
    }

    @Override
    public void onError(Throwable t) {
        async.complete();
    }
});
```

Async adalah lifecycle mechanism. Non-blocking I/O adalah stream readiness mechanism.

---

## 5. The Golden Rule

Untuk non-blocking read:

```text
Inside onDataAvailable():
  read while input.isReady() && !input.isFinished()
  return immediately when isReady() becomes false
```

Untuk non-blocking write:

```text
Inside onWritePossible():
  write while output.isReady() && data remains
  complete when all data written
  return immediately when isReady() becomes false
```

Jangan melakukan ini:

```java
while (!input.isFinished()) {
    int n = input.read(buffer); // wrong: may read when not ready
}
```

Jangan melakukan ini:

```java
while (hasMoreData()) {
    output.write(nextChunk()); // wrong: ignores isReady
}
```

Jangan melakukan ini:

```java
while (!output.isReady()) {
    // busy spin
}
```

Non-blocking I/O hanya berguna kalau aplikasi **mengembalikan thread ke container saat stream belum ready**.

---

## 6. Read State Machine

Non-blocking request body dapat dimodelkan seperti ini:

```text
NEW
  ↓ setReadListener
WAITING_FOR_DATA
  ↓ onDataAvailable
READING
  ├─ while isReady && !isFinished: read chunk
  ├─ if !isReady: return → WAITING_FOR_DATA
  └─ if isFinished: wait/transition
       ↓ onAllDataRead
COMPLETE

Any state
  ↓ onError
FAILED
```

Pseudocode:

```java
class BodyReadListener implements ReadListener {
    private final ServletInputStream input;
    private final AsyncContext async;
    private final ByteArrayOutputStream body = new ByteArrayOutputStream();
    private final byte[] buffer = new byte[8192];

    BodyReadListener(ServletInputStream input, AsyncContext async) {
        this.input = input;
        this.async = async;
    }

    @Override
    public void onDataAvailable() throws IOException {
        while (input.isReady() && !input.isFinished()) {
            int read = input.read(buffer);
            if (read > 0) {
                body.write(buffer, 0, read);
            }
        }
    }

    @Override
    public void onAllDataRead() throws IOException {
        byte[] completeBody = body.toByteArray();
        // process completeBody, or dispatch to another servlet/framework
        async.complete();
    }

    @Override
    public void onError(Throwable t) {
        async.complete();
    }
}
```

Catatan penting: contoh ini mengumpulkan seluruh body ke memory hanya untuk memperlihatkan struktur. Untuk payload besar, ini justru anti-pattern. Streaming yang baik memproses chunk secara bounded.

---

## 7. Write State Machine

Non-blocking response write dapat dimodelkan seperti ini:

```text
NEW
  ↓ setWriteListener
WAITING_TO_WRITE
  ↓ onWritePossible
WRITING
  ├─ while output.isReady && data remains: write chunk
  ├─ if !output.isReady: return → WAITING_TO_WRITE
  └─ if no data remains: complete

Any state
  ↓ onError
FAILED
```

Contoh streaming data dari iterator:

```java
class ChunkWriteListener implements WriteListener {
    private final ServletOutputStream output;
    private final AsyncContext async;
    private final Iterator<byte[]> chunks;

    ChunkWriteListener(ServletOutputStream output,
                       AsyncContext async,
                       Iterator<byte[]> chunks) {
        this.output = output;
        this.async = async;
        this.chunks = chunks;
    }

    @Override
    public void onWritePossible() throws IOException {
        while (output.isReady()) {
            if (!chunks.hasNext()) {
                async.complete();
                return;
            }
            output.write(chunks.next());
        }
    }

    @Override
    public void onError(Throwable t) {
        async.complete();
    }
}
```

Masalah besar dalam contoh ini: `Iterator<byte[]>` mungkin menghasilkan data dari sumber blocking, misalnya DB cursor, file lambat, HTTP client blocking, atau message broker. Kalau `chunks.next()` blocking, maka output stream non-blocking tidak lagi membantu.

Non-blocking output harus dipasangkan dengan strategi produksi data yang juga tidak menghancurkan thread.

---

## 8. Non-Blocking I/O Tidak Sama dengan Faster I/O

Non-blocking I/O bukan magic performance switch.

Ia membantu ketika bottleneck-nya adalah:

- client lambat mengirim body,
- client lambat menerima response,
- banyak koneksi idle/slow,
- thread pool habis karena menunggu socket readiness,
- aplikasi perlu menjaga memory bounded saat streaming.

Ia tidak banyak membantu ketika bottleneck-nya adalah:

- CPU-bound processing,
- database lambat,
- connection pool habis,
- remote service lambat tapi dipanggil blocking,
- serialization JSON besar di satu thread,
- synchronized lock contention,
- global queue penuh,
- storage lambat,
- container/proxy buffering semua response.

Mental model:

```text
Non-blocking I/O saves threads from waiting on socket readiness.
It does not remove work.
It does not remove downstream bottlenecks.
It does not make slow dependencies fast.
It does not automatically provide business-level backpressure.
```

---

## 9. Backpressure Mental Model

Backpressure adalah kemampuan sistem untuk mengatakan:

> “Saya belum siap menerima/menulis lebih banyak data; jangan dorong lebih banyak dulu.”

Dalam Servlet non-blocking output, sinyalnya adalah:

```java
output.isReady()
```

Jika `isReady()` false, aplikasi harus berhenti menulis dan return.

Dalam Servlet non-blocking input, sinyalnya adalah:

```java
input.isReady()
```

Jika `isReady()` false, aplikasi harus berhenti membaca dan return.

Namun ada dua level backpressure:

```text
Socket-level backpressure
  - controlled by ServletInputStream/ServletOutputStream readiness

Application-level backpressure
  - controlled by queues, memory limits, downstream capacity, rate limits, admission control
```

Servlet API memberi socket-level signal, bukan keseluruhan business-level backpressure.

Contoh failure:

```text
Client uploads 5 GB file
  ↓
ReadListener reads chunks correctly
  ↓
Application puts each chunk into unbounded queue
  ↓
Downstream scanner slow
  ↓
Queue grows until heap explodes
```

Walaupun I/O API non-blocking, desainnya tetap gagal karena application-level backpressure tidak ada.

---

## 10. Pattern: Bounded Streaming Upload

Tujuan:

- baca upload bertahap,
- jangan simpan seluruh body di heap,
- batasi ukuran,
- batasi memory,
- tulis ke temp file/object storage/scanner pipeline,
- stop jika client terlalu lambat atau payload terlalu besar.

State machine:

```text
START
  ↓
validate headers
  ↓
start async
  ↓
register ReadListener
  ↓
read chunks while ready
  ↓
write chunk to bounded sink
  ↓
if size > limit: fail 413
  ↓
if all data read: finalize sink
  ↓
respond
```

Pseudo-implementation:

```java
@WebServlet(urlPatterns = "/upload-stream", asyncSupported = true)
public class StreamingUploadServlet extends HttpServlet {
    private static final long MAX_BYTES = 100L * 1024 * 1024;

    @Override
    protected void doPost(HttpServletRequest request,
                          HttpServletResponse response) throws IOException {
        AsyncContext async = request.startAsync();
        async.setTimeout(60_000);

        ServletInputStream input = request.getInputStream();
        UploadSink sink = openSink();

        input.setReadListener(new ReadListener() {
            private final byte[] buffer = new byte[8192];
            private long total;
            private boolean failed;

            @Override
            public void onDataAvailable() throws IOException {
                try {
                    while (input.isReady() && !input.isFinished()) {
                        int n = input.read(buffer);
                        if (n > 0) {
                            total += n;
                            if (total > MAX_BYTES) {
                                failed = true;
                                response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
                                response.getWriter().write("Payload too large");
                                sink.abort();
                                async.complete();
                                return;
                            }
                            sink.write(buffer, 0, n);
                        }
                    }
                } catch (Throwable t) {
                    failed = true;
                    sink.abort();
                    throw t;
                }
            }

            @Override
            public void onAllDataRead() throws IOException {
                if (failed) return;
                sink.commit();
                response.setStatus(HttpServletResponse.SC_CREATED);
                response.getWriter().write("Uploaded");
                async.complete();
            }

            @Override
            public void onError(Throwable t) {
                sink.abortQuietly();
                async.complete();
            }
        });
    }
}
```

Caveat:

- `sink.write(...)` harus cepat atau memiliki strategi buffering bounded.
- Jika `sink.write(...)` blocking ke storage lambat, thread callback tetap bisa tertahan.
- Untuk object storage remote, sering lebih aman memakai multipart upload dengan bounded executor dan queue.
- Kalau semua data harus discan dulu sebelum diterima, non-blocking read harus disatukan dengan scanner pipeline yang punya backpressure.

---

## 11. Pattern: Non-Blocking Streaming Download

Tujuan:

- kirim response besar,
- jangan simpan seluruh response di memory,
- hormati slow client,
- selesai dengan benar bila client abort.

State machine:

```text
START
  ↓
set headers
  ↓
start async
  ↓
register WriteListener
  ↓
while output ready and data exists: write chunk
  ↓
if output not ready: return
  ↓
if complete: async.complete
```

Pseudo-implementation:

```java
@WebServlet(urlPatterns = "/download-stream", asyncSupported = true)
public class StreamingDownloadServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest request,
                         HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("application/octet-stream");
        response.setHeader("Content-Disposition", "attachment; filename=export.bin");

        AsyncContext async = request.startAsync();
        async.setTimeout(120_000);

        ServletOutputStream output = response.getOutputStream();
        ChunkSource source = openChunkSource();

        output.setWriteListener(new WriteListener() {
            @Override
            public void onWritePossible() throws IOException {
                try {
                    while (output.isReady()) {
                        byte[] chunk = source.nextChunkOrNull();
                        if (chunk == null) {
                            source.close();
                            async.complete();
                            return;
                        }
                        output.write(chunk);
                    }
                } catch (Throwable t) {
                    source.closeQuietly();
                    throw t;
                }
            }

            @Override
            public void onError(Throwable t) {
                source.closeQuietly();
                async.complete();
            }
        });
    }
}
```

Caveat:

- `source.nextChunkOrNull()` tidak boleh blocking lama.
- Jika source berasal dari file lokal, blocking file read mungkin masih acceptable, tapi tetap pahami trade-off.
- Jika source dari DB/remote HTTP, lebih hati-hati.
- Setelah response committed, error tidak bisa selalu dikirim sebagai JSON error rapi.

---

## 12. Pattern: Bridging Input to Output

Kasus umum: servlet sebagai gateway/proxy yang membaca request body dan meneruskan ke response atau remote service.

Naive approach:

```java
request.getInputStream().transferTo(response.getOutputStream());
```

Ini blocking dan bisa menahan thread selama client/source lambat.

Namun bridging non-blocking secara benar sulit karena harus mengelola dua readiness signal:

```text
input ready?
output ready?
buffer has data?
buffer has capacity?
upstream finished?
downstream finished?
error on either side?
```

State yang harus dikelola:

```text
READING_INPUT
BUFFERING
WAITING_FOR_OUTPUT
WRITING_OUTPUT
WAITING_FOR_INPUT
COMPLETING
FAILED
```

Aturan desain:

1. Buffer harus bounded.
2. Jangan baca input jika buffer penuh.
3. Jangan tulis output jika `output.isReady()` false.
4. Jangan complete sebelum semua data terbaca dan tertulis.
5. Tangani client abort dan upstream abort secara terpisah.
6. Jangan simpan seluruh payload kecuali memang kecil dan dibatasi.

Untuk production gateway kompleks, sering lebih tepat memakai framework/runtime yang memang dirancang reactive-streams end-to-end, misalnya Netty/Reactor Netty/Vert.x, daripada memaksakan Servlet non-blocking manual.

---

## 13. Container Threading: Siapa Memanggil Callback?

Callback `ReadListener` dan `WriteListener` dipanggil oleh container.

Yang perlu dipahami:

- callback tetap berjalan pada thread tertentu,
- callback bukan tempat untuk operasi CPU berat,
- callback bukan tempat untuk blocking remote call,
- callback harus return cepat ketika stream tidak ready,
- callback bisa dipanggil beberapa kali selama lifecycle request,
- tidak boleh mengasumsikan thread yang sama untuk semua callback,
- state listener harus thread-safe sesuai invocation semantics container dan application interaction.

Mental model aman:

```text
Treat listener callback as event-loop-like code:
  - do bounded work
  - respect readiness
  - update small state machine
  - hand off heavy work deliberately
  - never block indefinitely
```

---

## 14. Common Mistake: Blocking Inside Listener

Contoh buruk:

```java
@Override
public void onDataAvailable() throws IOException {
    while (input.isReady() && !input.isFinished()) {
        int n = input.read(buffer);
        if (n > 0) {
            database.insert(buffer, 0, n); // blocking DB call inside callback
        }
    }
}
```

Masalah:

- DB insert bisa lambat.
- Callback thread tertahan.
- Container tidak mendapat thread kembali.
- Non-blocking I/O kehilangan manfaat.
- Jika banyak request, bottleneck pindah ke DB dan thread callback.

Alternatif:

```text
Read chunk
  ↓
validate size
  ↓
place into bounded queue / write to fast temporary sink
  ↓
return when not ready
  ↓
worker processes bounded queue with explicit backpressure
```

Namun ini juga kompleks karena harus menghubungkan queue capacity dengan read pace.

---

## 15. Common Mistake: Unbounded Memory Accumulation

Contoh buruk:

```java
private final List<byte[]> chunks = new ArrayList<>();

@Override
public void onDataAvailable() throws IOException {
    while (input.isReady() && !input.isFinished()) {
        byte[] chunk = input.readNBytes(8192);
        chunks.add(chunk);
    }
}
```

Masalah:

- upload besar memenuhi heap,
- slow downstream tidak memberi tekanan balik,
- GC pressure naik,
- OOM mungkin terjadi sebelum limit aplikasi bekerja.

Aturan:

```text
Every streaming design must answer:
  - maximum bytes per request?
  - maximum in-memory bytes per request?
  - maximum concurrent streaming requests?
  - maximum total streaming memory?
  - what happens when sink is slower than source?
```

---

## 16. Common Mistake: Busy Loop

Contoh buruk:

```java
while (!output.isReady()) {
    // wait
}
output.write(data);
```

Ini bukan non-blocking. Ini spin-wait dan akan membakar CPU.

Yang benar:

```java
if (!output.isReady()) {
    return;
}
```

Biarkan container memanggil `onWritePossible()` lagi ketika output siap.

---

## 17. Common Mistake: Complete Too Early

Contoh buruk:

```java
@Override
public void onWritePossible() throws IOException {
    if (output.isReady()) {
        output.write(firstChunk);
    }
    async.complete(); // wrong if more chunks remain
}
```

Jika response ditutup terlalu cepat:

- client menerima payload parsial,
- download corrupt,
- JSON invalid,
- browser menampilkan network error,
- log aplikasi terlihat sukses padahal response gagal.

State machine harus eksplisit tentang:

```text
all source data consumed?
all buffered data written?
output flush/commit semantics acceptable?
then complete
```

---

## 18. Common Mistake: Ignoring Client Abort

Client bisa disconnect kapan saja:

- user menutup browser,
- mobile network drop,
- proxy timeout,
- LB reset,
- browser cancel download,
- frontend route berubah.

Pada output streaming, error bisa muncul saat write atau callback `onError`.

Aturan:

```text
Client abort is not always application error.
Classify it separately from server failure.
```

Logging buruk:

```text
ERROR stacktrace IOException: Broken pipe
ERROR stacktrace IOException: Connection reset by peer
ERROR stacktrace IOException: ClientAbortException
```

Logging lebih baik:

```text
WARN client_aborted requestId=... bytesWritten=... durationMs=... endpoint=...
```

Kecuali abort terjadi pada endpoint yang seharusnya sangat cepat atau menunjukkan pola aneh, client abort biasanya bukan incident server.

---

## 19. Interaction with Response Commit

Pada streaming output, response sering committed lebih awal.

Begitu body mulai dikirim, status dan header umumnya tidak bisa diubah.

Artinya:

```text
Before streaming starts:
  validate authorization
  validate parameters
  set content type
  set content disposition
  set cache headers
  set status
  decide error if possible

After streaming starts:
  cannot reliably switch to JSON error
  cannot reliably change status
  can only close/abort/log
```

Ini sangat penting untuk endpoint download/report.

Anti-pattern:

```java
response.getOutputStream().write(partialData);
try {
    generateRemainingData();
} catch (Exception e) {
    response.setStatus(500); // too late if committed
    response.getWriter().write("error");
}
```

Better pattern:

```text
Preflight validation
  ↓
prepare source
  ↓
only then start streaming
```

---

## 20. Interaction with Proxy Buffering

Non-blocking streaming di aplikasi bisa tidak terlihat oleh client bila reverse proxy melakukan buffering.

Contoh:

```text
Servlet writes chunks progressively
  ↓
Nginx buffers response
  ↓
client receives only after buffer full or response complete
```

Efek:

- SSE tidak real-time,
- progress endpoint terasa delay,
- backpressure berbeda dari yang diperkirakan,
- memory/disk pressure pindah ke proxy,
- timeout bisa terjadi di layer proxy.

Hal yang perlu diperiksa:

- proxy buffering,
- response compression,
- chunked transfer,
- HTTP/2 behavior,
- idle timeout,
- request/response body size limit,
- gateway timeout,
- load balancer idle timeout.

Non-blocking Servlet I/O bukan hanya masalah Java code. Ini end-to-end runtime behavior.

---

## 21. Interaction with Compression

Compression bisa mengubah streaming behavior.

Jika response dikompresi:

- container/proxy mungkin buffer data untuk compression efficiency,
- `flush()` mungkin tidak langsung mengirim bytes ke client,
- small chunks bisa digabung,
- CPU cost meningkat,
- backpressure signal bisa berbeda.

Untuk SSE atau real-time streaming, compression sering perlu dimatikan atau dikonfigurasi hati-hati.

Untuk download besar, compression tergantung jenis file:

| Payload | Compression useful? |
|---|---|
| Plain text/CSV/JSON | Sering berguna |
| ZIP/JPEG/PNG/PDF compressed | Biasanya tidak banyak berguna |
| SSE | Sering mengganggu latency |
| Binary encrypted/compressed | Biasanya tidak berguna |

---

## 22. Interaction with Multipart Upload

Multipart upload di Servlet sering diproses dengan `@MultipartConfig` dan `request.getParts()`.

Namun `getParts()` biasanya membuat container melakukan multipart parsing dan buffering sesuai konfigurasi.

Jika tujuan Anda adalah full streaming control, `getParts()` mungkin bukan path terbaik.

Perbandingan:

| Approach | Cocok untuk | Caveat |
|---|---|---|
| `@MultipartConfig` + `Part` | Form upload umum | Container parsing/buffering/temp file |
| Manual stream read | Custom protocol/upload besar | Harus parsing sendiri jika multipart |
| Dedicated upload service | Payload sangat besar | Kompleksitas infra lebih tinggi |
| Direct-to-object-storage upload | File besar dari browser | App server tidak jadi data plane utama |

Untuk top-tier design, pertanyaan pentingnya bukan “bagaimana upload bisa diterima Servlet”, tapi:

> “Haruskah app server menjadi jalur data utama untuk payload sebesar ini?”

Kadang solusi terbaik adalah signed URL/direct upload ke object storage, sementara Servlet hanya mengatur metadata, authorization, dan workflow.

---

## 23. Interaction with Virtual Threads

Java 21 memperkenalkan virtual threads sebagai fitur final. Dengan virtual threads, blocking I/O tertentu menjadi jauh lebih murah dari sisi thread-per-request.

Pertanyaan: apakah virtual threads membuat Servlet non-blocking I/O tidak perlu?

Jawabannya: tidak sesederhana itu.

Virtual threads membantu ketika:

- gaya kode blocking lebih sederhana,
- banyak request menunggu I/O yang virtual-thread-friendly,
- container/framework mendukung virtual-thread execution,
- bottleneck bukan socket slow-client dengan memory unbounded,
- downstream capacity tetap dikontrol.

Servlet non-blocking I/O tetap relevan ketika:

- Anda perlu readiness-level control atas body streaming,
- slow client menjadi masalah utama,
- Anda perlu bounded buffering yang eksplisit,
- response long-lived/streaming harus menghormati socket readiness,
- gateway/proxy style endpoint perlu menghindari thread pinning/blocked writes.

Namun dalam banyak aplikasi CRUD/API biasa, virtual threads atau classic blocking servlet lebih masuk akal daripada manual `ReadListener`/`WriteListener`.

Decision rule:

```text
If the code is simple request/response with moderate payload:
  prefer blocking model, maybe virtual threads if supported.

If the problem is waiting for async business result:
  use AsyncContext/framework async abstraction.

If the problem is slow request/response body streaming:
  consider Servlet non-blocking I/O.

If the whole application is stream/backpressure-oriented:
  consider reactive runtime end-to-end.
```

---

## 24. Capacity Planning for Streaming Endpoints

Untuk endpoint non-blocking, kapasitas tidak cukup dihitung dari request thread.

Gunakan model:

```text
Concurrent streams
  × per-stream memory buffer
  + per-stream metadata/session state
  + sink/source resource usage
  + proxy buffering
  + temp disk usage
  + downstream connections
```

Contoh:

```text
2,000 concurrent upload streams
8 MB max in-memory buffer per stream
= 16 GB potential heap pressure
```

Itu belum termasuk object overhead, queues, servlet/session state, container buffers, proxy buffers, dan GC headroom.

Lebih aman:

```text
2,000 concurrent streams
64 KB in-memory buffer per stream
= ~128 MB raw buffer
```

Lalu batasi:

- max concurrent streaming requests,
- max bytes per request,
- max duration,
- max idle read time,
- max queued chunks,
- max temp disk usage,
- max downstream in-flight upload parts.

---

## 25. Admission Control

Non-blocking I/O memungkinkan lebih banyak koneksi bertahan, tapi bukan berarti semua harus diterima.

Streaming endpoint perlu admission control:

```text
if activeUploads > limit:
  reject 503 or 429 before reading body
```

Contoh:

```java
if (!uploadLimiter.tryAcquire()) {
    response.setStatus(429);
    response.getWriter().write("Too many concurrent uploads");
    return;
}

AsyncContext async = request.startAsync();
async.addListener(new AsyncListener() {
    @Override public void onComplete(AsyncEvent event) { uploadLimiter.release(); }
    @Override public void onTimeout(AsyncEvent event) { uploadLimiter.release(); }
    @Override public void onError(AsyncEvent event) { uploadLimiter.release(); }
    @Override public void onStartAsync(AsyncEvent event) { }
});
```

Pastikan release idempotent. Timeout dan error bisa berinteraksi dengan complete.

---

## 26. Timeout Design

Streaming endpoint harus punya timeout yang jelas.

Jenis timeout:

| Timeout | Makna |
|---|---|
| Request read timeout | Client terlalu lambat mengirim body |
| Response write timeout | Client terlalu lambat menerima body |
| Async timeout | Request async terlalu lama hidup |
| Proxy timeout | Reverse proxy/LB menutup koneksi |
| Downstream timeout | Storage/scanner/service terlalu lambat |
| Idle timeout | Tidak ada traffic selama periode tertentu |

Yang sering salah:

```text
Servlet async timeout = 120s
Nginx proxy_read_timeout = 60s
ALB idle timeout = 60s
Client expects 5min stream
```

Akibat:

- aplikasi merasa masih memproses,
- proxy sudah memutus client,
- write berikutnya broken pipe,
- user melihat 504/connection reset,
- log aplikasi membingungkan.

Aturan:

```text
Timeouts must be aligned across client, proxy, load balancer, container, app, and downstream.
```

---

## 27. Observability: Metrics yang Harus Ada

Untuk endpoint non-blocking/streaming, minimal ukur:

| Metric | Kenapa penting |
|---|---|
| active streaming requests | Mengetahui concurrency nyata |
| bytes read per request | Deteksi payload besar/abnormal |
| bytes written per request | Deteksi partial response/client abort |
| stream duration | Deteksi slow client/downstream |
| read callback count | Deteksi fragmentation/slow upload |
| write callback count | Deteksi slow consumer |
| async timeout count | Lifecycle failure |
| client abort count | Network/proxy/frontend behavior |
| buffer occupancy | Backpressure health |
| rejected streams | Admission control |
| temp disk usage | Upload safety |
| downstream sink latency | Bottleneck sebenarnya |

Log event penting:

```text
stream_started
stream_progress_optional_sampled
stream_completed
stream_rejected
stream_timeout
stream_client_aborted
stream_failed
```

Jangan log setiap chunk pada traffic tinggi. Itu bisa menjadi bottleneck baru.

---

## 28. Debugging Checklist

### 28.1 Upload lambat dan thread pool habis

Periksa:

- Apakah kode masih memakai blocking `read()`?
- Apakah async dipakai tapi blocking pindah ke executor?
- Berapa max worker thread container?
- Apakah client upload lambat?
- Apakah proxy buffering request body?
- Apakah temp disk penuh?
- Apakah multipart parsing menahan request?

### 28.2 Download besar sering gagal

Periksa:

- client abort count,
- proxy idle timeout,
- response committed before error,
- source data blocking,
- output `isReady()` dihormati atau tidak,
- compression/buffering,
- content length benar atau tidak,
- range/resume support diperlukan atau tidak.

### 28.3 SSE tidak real-time

Periksa:

- proxy buffering,
- compression,
- flush behavior,
- HTTP/2/proxy behavior,
- browser connection limit,
- heartbeat interval,
- container async timeout,
- LB idle timeout.

### 28.4 Memory naik saat streaming

Periksa:

- unbounded queue,
- body accumulated in memory,
- per-stream buffer terlalu besar,
- chunks retained after write,
- session/context attribute menyimpan stream state,
- metrics/logging menyimpan payload,
- temp file reference tidak dibersihkan.

---

## 29. Testing Strategy

Non-blocking I/O tidak cukup dites dengan unit test biasa.

Butuh beberapa jenis test:

### 29.1 Slow upload test

Simulasikan client mengirim body pelan:

```text
send 1 KB every second
observe active requests, thread usage, timeout, memory
```

Tujuan:

- memastikan worker thread tidak habis,
- timeout bekerja,
- memory bounded,
- partial upload cleanup benar.

### 29.2 Slow download test

Simulasikan client membaca response pelan:

```text
server writes large response
client reads slowly
observe write callbacks, memory, client abort behavior
```

### 29.3 Client abort test

Simulasikan:

```text
start upload/download
close socket mid-stream
verify cleanup
verify log classification
verify semaphore/limiter released
verify temp file removed
```

### 29.4 Proxy timeout test

Jalankan melalui reverse proxy, bukan hanya direct container.

```text
client → proxy → servlet container
```

Banyak bug streaming hanya muncul lewat proxy.

### 29.5 Large concurrency test

Test dengan:

- banyak concurrent upload kecil lambat,
- banyak concurrent download lambat,
- mix slow and fast clients,
- downstream sink slow,
- storage failure,
- rolling restart.

---

## 30. When Not to Use Servlet Non-Blocking I/O

Jangan gunakan manual non-blocking Servlet I/O jika:

- endpoint CRUD biasa,
- payload kecil,
- concurrency rendah/sedang,
- bottleneck ada di DB,
- tim belum siap memelihara state machine callback,
- observability belum matang,
- proxy melakukan buffering penuh,
- framework sudah menyediakan abstraction yang cukup,
- virtual threads menyelesaikan problem dengan kompleksitas lebih rendah.

Top-tier engineer tidak memakai API paling advanced hanya karena ada. Ia memilih kompleksitas yang sepadan dengan failure mode yang ingin dikendalikan.

---

## 31. When to Use Servlet Non-Blocking I/O

Pertimbangkan Servlet non-blocking I/O jika:

- ada banyak slow clients,
- request/response body besar,
- streaming harus memory-bounded,
- thread pool sering habis karena socket read/write wait,
- Anda membangun gateway/filter/proxy style servlet,
- SSE/streaming response perlu kontrol readiness,
- Anda perlu membedakan socket backpressure dari business processing,
- Anda siap membuat observability dan failure handling yang memadai.

---

## 32. Practical Decision Matrix

| Problem | Pilihan yang biasanya tepat |
|---|---|
| API CRUD JSON biasa | Blocking servlet/framework MVC |
| Banyak request menunggu remote service | Async framework abstraction atau virtual threads |
| Upload file besar | Multipart config/direct object storage/streaming bounded |
| Upload sangat besar dan slow client | Non-blocking read atau direct upload architecture |
| Download report besar | Streaming output; non-blocking jika slow clients signifikan |
| Real-time one-way events | SSE dengan async, proxy tuned |
| Full-duplex realtime | WebSocket |
| End-to-end backpressure stream processing | Reactive runtime/framework |
| Proxy/gateway body streaming | Dedicated reactive gateway or careful Servlet non-blocking bridge |

---

## 33. Production Checklist

Sebelum memakai non-blocking Servlet I/O di production, pastikan:

```text
[ ] Endpoint benar-benar butuh streaming/non-blocking body I/O.
[ ] Async supported aktif.
[ ] Listener menghormati isReady().
[ ] Tidak ada busy loop.
[ ] Tidak ada unbounded memory accumulation.
[ ] Per-request buffer bounded.
[ ] Total concurrency dibatasi.
[ ] Payload size dibatasi.
[ ] Timeout jelas dan selaras dengan proxy/LB.
[ ] Client abort ditangani dan diklasifikasi.
[ ] Async complete/error/timeout cleanup idempotent.
[ ] Temp file/sink/source selalu dibersihkan.
[ ] Response header/status diset sebelum streaming.
[ ] Error setelah commit dipahami sebagai partial response failure.
[ ] Proxy buffering/compression dievaluasi.
[ ] Metrics active stream, bytes, duration, abort, timeout tersedia.
[ ] Slow client test dilakukan.
[ ] Client abort test dilakukan.
[ ] Rolling deployment behavior diuji.
```

---

## 34. Key Takeaways

1. Async Servlet dan non-blocking Servlet I/O adalah dua konsep berbeda.
2. Async Servlet mengatur lifecycle request; non-blocking I/O mengatur readiness stream.
3. `ReadListener` dan `WriteListener` adalah callback untuk membaca/menulis tanpa blocking ketika stream ready.
4. Golden rule: baca/tulis hanya saat `isReady()` true, lalu return ketika tidak ready.
5. Non-blocking I/O menghemat thread dari socket wait, bukan menghapus bottleneck downstream.
6. Backpressure harus dipikirkan di dua level: socket-level dan application-level.
7. Streaming tanpa batas memory adalah bug desain, walaupun memakai API non-blocking.
8. Response streaming harus memahami commit semantics: setelah body terkirim, error response rapi sering sudah terlambat.
9. Proxy buffering, compression, dan timeout bisa membatalkan asumsi streaming di aplikasi.
10. Untuk banyak aplikasi biasa, blocking model, async abstraction, atau virtual threads lebih sederhana dan lebih aman.
11. Servlet non-blocking I/O cocok untuk engineer yang siap mengelola state machine, buffer, timeout, observability, dan failure cleanup secara eksplisit.

---

## 35. Latihan Mental Model

Jawab pertanyaan berikut sebelum lanjut:

1. Apa perbedaan masalah yang diselesaikan `AsyncContext` dan `ReadListener`?
2. Kenapa `while (!output.isReady()) {}` adalah bug serius?
3. Apa yang terjadi jika response sudah committed lalu source data gagal?
4. Bagaimana membatasi memory untuk 5.000 concurrent streaming upload?
5. Kenapa non-blocking read tidak membantu jika setiap chunk langsung diproses dengan DB insert blocking?
6. Apa bedanya socket-level backpressure dan application-level backpressure?
7. Kenapa proxy buffering bisa membuat SSE terlihat tidak real-time?
8. Dalam kondisi apa virtual threads lebih baik daripada manual `WriteListener`?
9. Metric apa yang menunjukkan banyak slow consumers?
10. Cleanup apa saja yang harus terjadi saat client abort di tengah upload?

---

## 36. Referensi

- Jakarta Servlet 6.1 API — `ServletInputStream`, `ServletOutputStream`, `ReadListener`, `WriteListener`, `AsyncContext`.
- Jakarta Servlet Specification 6.1.
- Apache Tomcat 11 Servlet API documentation.
- Eclipse Jetty 12 documentation and API references.
- RFC 9110 — HTTP Semantics.
- RFC 9112 — HTTP/1.1.
- Java virtual threads documentation and JEP 444 for modern blocking-vs-non-blocking design considerations.

---

## 37. Posisi Part Ini dalam Seri

Kita sudah membahas:

```text
Part 000 — Orientation
Part 001 — Javax to Jakarta evolution
Part 002 — HTTP fundamentals
Part 003 — Servlet container architecture
Part 004 — Servlet lifecycle
Part 005 — HttpServletRequest internals
Part 006 — HttpServletResponse internals
Part 007 — Servlet mapping
Part 008 — Request dispatching
Part 009 — Filters
Part 010 — Listeners
Part 011 — ServletContext
Part 012 — HttpSession
Part 013 — Cookies and browser boundary
Part 014 — Async Servlet
Part 015 — Servlet Non-Blocking I/O
```

Berikutnya:

```text
Part 016 — Multipart Upload, File Download, and Large Payload Handling
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-servlet-websocket-web-container-runtime-part-014.md">⬅️ Part 014 — Async Servlet: Non-Blocking Request Lifecycle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-servlet-websocket-web-container-runtime-part-016.md">Part 016 — Multipart Upload, File Download, and Large Payload Handling ➡️</a>
</div>
