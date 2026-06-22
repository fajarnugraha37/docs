# Part 22 — Concurrency Pattern I: Immutability, Confinement, Guarded Suspension

Series: `learn-java-design-patterns-antipatterns-architecture-engineering`  
File: `22-concurrency-immutability-confinement-guarded-suspension.md`  
Java scope: Java 8 sampai Java 25

---

## 0. Posisi Materi Ini dalam Seri

Sampai Part 21, kita sudah membangun fondasi pattern dari sisi object design, SOLID, creational, structural, behavioral, domain modeling, service boundary, persistence boundary, DTO boundary, dan error handling.

Mulai Part 22, kita masuk ke design pattern concurrency.

Namun bagian ini sengaja tidak langsung membahas `CompletableFuture`, virtual threads, structured concurrency, executor tuning, atau reactive pipeline. Itu akan dibahas lebih dalam di Part 23.

Part 22 fokus pada lapisan yang lebih fundamental:

```text
Siapa pemilik state?
Siapa boleh membaca state?
Siapa boleh mengubah state?
Kapan perubahan terlihat oleh thread lain?
Apa invariant yang harus tetap benar ketika lebih dari satu thread berjalan?
```

Banyak bug concurrency bukan terjadi karena engineer tidak tahu API concurrency. Bug sering terjadi karena desain state ownership-nya tidak jelas.

Pattern seperti immutability, confinement, guarded suspension, balking, producer-consumer, dan safe publication adalah fondasi sebelum memilih mekanisme teknis seperti `synchronized`, `Lock`, `AtomicReference`, `BlockingQueue`, `ExecutorService`, virtual thread, atau structured concurrency.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami concurrency sebagai masalah desain state, bukan sekadar masalah thread.
2. Membedakan mutual exclusion, visibility, ordering, atomicity, ownership, dan lifecycle.
3. Mendesain object agar aman dipakai di lingkungan concurrent.
4. Memahami kapan immutability cukup, kapan confinement cukup, dan kapan lock diperlukan.
5. Memahami safe publication dan kenapa object yang “sudah dibuat” belum tentu aman dibaca thread lain.
6. Menerapkan Guarded Suspension Pattern secara benar dengan `wait/notify`, `Condition`, dan `BlockingQueue`.
7. Menerapkan Balking Pattern untuk operasi yang hanya boleh berjalan pada state tertentu.
8. Mendesain producer-consumer pipeline yang jelas ownership dan backpressure-nya.
9. Mengenali anti-pattern concurrency umum di Java enterprise codebase.
10. Menghubungkan Java 8–25 dengan pattern concurrency klasik.

---

## 2. Mental Model Utama: Concurrency adalah Masalah Ownership + Visibility + Coordination

Ketika satu thread mengakses state sendiri, desain biasanya sederhana.

```java
var counter = 0;
counter++;
```

Tetapi ketika banyak thread mengakses state yang sama, muncul beberapa pertanyaan:

```text
1. Apakah state ini shared?
2. Apakah state ini mutable?
3. Siapa owner state ini?
4. Apakah pembaca boleh melihat state parsial?
5. Apakah penulis boleh berjalan bersamaan?
6. Bagaimana thread lain tahu perubahan sudah terjadi?
7. Bagaimana thread menunggu kondisi tertentu tanpa busy-wait?
8. Bagaimana operasi dibatalkan atau timeout?
9. Apa yang terjadi saat shutdown?
```

Concurrency bug biasanya muncul ketika jawaban terhadap pertanyaan ini tidak eksplisit.

### 2.1 Concurrency Design Triangle

Ada tiga strategi besar untuk membuat concurrent system aman:

```text
1. Jangan berbagi state.
2. Kalau berbagi, jangan ubah state.
3. Kalau harus berbagi dan mengubah state, koordinasikan aksesnya.
```

Dalam bentuk pattern:

```text
No shared state       -> Confinement, actor-like ownership, queue ownership
Shared immutable      -> Immutability, snapshot, value object
Shared mutable        -> Locking, atomic, guarded suspension, monitor, condition
```

Rule of thumb:

```text
Semakin sedikit shared mutable state, semakin sedikit concurrency hazard.
```

Top engineer biasanya tidak mulai dari “pakai lock apa?”. Mereka mulai dari “bisakah state ini tidak dibagi?” atau “bisakah state ini immutable?”.

---

## 3. Core Vocabulary

Sebelum masuk pattern, kita perlu menyamakan istilah.

### 3.1 Thread Safety

Sebuah class thread-safe jika dapat digunakan oleh banyak thread secara bersamaan tanpa menyebabkan race condition, broken invariant, corrupted state, atau visibility bug.

Thread-safe bukan berarti selalu cepat. Thread-safe berarti contract-nya tetap benar di bawah concurrency.

### 3.2 Race Condition

Race condition terjadi ketika hasil program bergantung pada timing relatif antar thread.

Contoh klasik:

```java
final class Counter {
    private int value;

    void increment() {
        value++;
    }

    int value() {
        return value;
    }
}
```

`value++` terlihat sederhana, tetapi sebenarnya terdiri dari:

```text
read value
add 1
write value
```

Jika dua thread menjalankan operasi ini bersamaan, update bisa hilang.

### 3.3 Atomicity

Atomicity berarti operasi terlihat sebagai satu kesatuan yang tidak bisa diinterleave.

```java
synchronized void increment() {
    value++;
}
```

Atomicity bukan hanya tentang satu field. Bisa juga tentang invariant beberapa field.

```java
private int used;
private int available;
private final int capacity;

// Invariant:
// used + available == capacity
```

Kalau update `used` dan `available` tidak atomic sebagai satu operasi, invariant bisa rusak.

### 3.4 Visibility

Visibility berarti perubahan yang dilakukan satu thread terlihat oleh thread lain.

Tanpa synchronization yang benar, thread lain bisa melihat value lama, object parsial, atau urutan perubahan yang tidak sesuai harapan.

### 3.5 Ordering

Compiler, CPU, dan JVM boleh melakukan optimasi/reordering selama single-thread semantics tetap terlihat benar. Dalam concurrent program, reordering bisa terlihat sebagai bug jika tidak ada happens-before relationship.

### 3.6 Happens-Before

Happens-before adalah relasi dalam Java Memory Model yang menjamin visibility dan ordering antar aksi tertentu.

Contoh sumber happens-before penting:

1. Unlock pada monitor happens-before lock berikutnya pada monitor yang sama.
2. Write ke volatile field happens-before read berikutnya terhadap volatile field yang sama.
3. Start thread happens-before aksi di thread yang started.
4. Aksi dalam thread happens-before thread lain berhasil `join()` thread tersebut.
5. Inisialisasi final field punya aturan khusus jika object tidak bocor saat konstruksi.

Mental model sederhana:

```text
Tanpa happens-before, jangan mengandalkan thread lain melihat perubahanmu dengan benar.
```

### 3.7 Safe Publication

Safe publication adalah cara membuat object yang sudah dibuat oleh satu thread terlihat secara benar oleh thread lain.

Object yang immutable pun perlu dipublish dengan aman.

Contoh safe publication:

```java
private static final Config CONFIG = new Config(...);
```

```java
private volatile Config config;
```

```java
synchronized void update(Config next) {
    this.config = next;
}

synchronized Config current() {
    return config;
}
```

```java
private final AtomicReference<Config> configRef = new AtomicReference<>();
```

### 3.8 Confinement

Confinement berarti state hanya boleh diakses dari satu area/thread/owner tertentu.

Contoh:

```text
local variable confinement
thread confinement
request confinement
actor/event-loop confinement
transaction confinement
```

### 3.9 Coordination

Coordination adalah mekanisme agar thread bekerja sama berdasarkan kondisi.

Contoh:

```text
Thread A menunggu queue tidak kosong.
Thread B menunggu buffer tidak penuh.
Thread C hanya menjalankan job jika service sudah STARTED.
Thread D berhenti saat shutdown diminta.
```

---

## 4. Pattern 1 — Immutability Pattern

### 4.1 Intent

Immutability Pattern membuat object tidak berubah setelah dibuat.

Jika object tidak berubah, banyak thread bisa membacanya tanpa lock.

### 4.2 Problem

Shared mutable state adalah sumber utama race condition.

Contoh buruk:

```java
final class RuntimeConfig {
    private Map<String, String> properties;

    Map<String, String> properties() {
        return properties;
    }

    void set(String key, String value) {
        properties.put(key, value);
    }
}
```

Masalah:

1. Map mutable dibagikan keluar.
2. Caller bisa mengubah internal state.
3. Concurrent read/write bisa corrupt.
4. Tidak ada visibility guarantee.
5. Tidak ada snapshot semantic.

### 4.3 Solution

Buat object immutable:

```java
import java.util.Map;

public final class RuntimeConfig {
    private final Map<String, String> properties;

    public RuntimeConfig(Map<String, String> properties) {
        this.properties = Map.copyOf(properties);
    }

    public String get(String key) {
        return properties.get(key);
    }

    public Map<String, String> asMap() {
        return properties;
    }

    public RuntimeConfig with(String key, String value) {
        var copy = new java.util.HashMap<>(properties);
        copy.put(key, value);
        return new RuntimeConfig(copy);
    }
}
```

Key points:

```text
1. Class final, atau hierarchy dikontrol.
2. Field final.
3. Tidak expose mutable internal object.
4. Defensive copy saat masuk.
5. Immutable view/copy saat keluar.
6. Update menghasilkan instance baru.
```

### 4.4 Java Records

Java 16+ records membantu membuat value carrier immutable secara dangkal.

```java
public record Money(String currency, long cents) {
    public Money {
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency is required");
        }
        if (cents < 0) {
            throw new IllegalArgumentException("cents must be non-negative");
        }
    }
}
```

Tetapi record tidak otomatis deep immutable.

Contoh jebakan:

```java
public record UnsafePayload(java.util.List<String> tags) {
}
```

Caller masih bisa mengubah list asli jika tidak dilakukan copy.

Lebih aman:

```java
public record SafePayload(java.util.List<String> tags) {
    public SafePayload {
        tags = java.util.List.copyOf(tags);
    }
}
```

### 4.5 Immutable Snapshot Pattern

Immutability sering dipakai sebagai snapshot.

```java
public record SystemSnapshot(
        long version,
        RuntimeConfig config,
        java.time.Instant capturedAt
) {}
```

Snapshot berguna ketika:

```text
1. Reader perlu consistent view.
2. Writer boleh update config tanpa mengganggu reader.
3. Audit butuh bukti state saat keputusan dibuat.
4. Concurrent read jauh lebih banyak daripada write.
```

### 4.6 Atomic Reference + Immutable Snapshot

Pattern umum untuk config runtime:

```java
import java.util.concurrent.atomic.AtomicReference;

public final class ConfigStore {
    private final AtomicReference<RuntimeConfig> current;

    public ConfigStore(RuntimeConfig initial) {
        this.current = new AtomicReference<>(initial);
    }

    public RuntimeConfig current() {
        return current.get();
    }

    public void update(RuntimeConfig next) {
        current.set(next);
    }
}
```

Dengan desain ini:

```text
1. RuntimeConfig immutable.
2. Reference update atomic.
3. Reader tidak butuh lock.
4. Reader selalu melihat salah satu snapshot valid.
5. Tidak ada state parsial.
```

### 4.7 Immutability Tidak Selalu Gratis

Trade-off:

| Aspek | Keuntungan | Biaya |
|---|---|---|
| Thread safety | read aman tanpa lock | update harus membuat object baru |
| Reasoning | invariant lebih jelas | object graph besar bisa mahal dicopy |
| Caching | hash/equality stabil | perlu memory tambahan |
| Audit | snapshot mudah | lifecycle snapshot harus dikelola |
| API | lebih aman | builder/copy factory kadang dibutuhkan |

### 4.8 Anti-Pattern: Fake Immutable

```java
public final class ReportCriteria {
    private final List<String> statuses;

    public ReportCriteria(List<String> statuses) {
        this.statuses = statuses;
    }

    public List<String> statuses() {
        return statuses;
    }
}
```

Ini fake immutable karena list tetap mutable.

Perbaikan:

```java
public final class ReportCriteria {
    private final List<String> statuses;

    public ReportCriteria(List<String> statuses) {
        this.statuses = List.copyOf(statuses);
    }

    public List<String> statuses() {
        return statuses;
    }
}
```

---

## 5. Pattern 2 — Thread Confinement

### 5.1 Intent

Thread Confinement menjaga state hanya diakses oleh satu thread, sehingga tidak perlu synchronization untuk state tersebut.

### 5.2 Bentuk Confinement

```text
1. Stack confinement
2. Thread confinement
3. Request confinement
4. Actor/event-loop confinement
5. Transaction confinement
6. Ownership confinement
```

### 5.3 Stack Confinement

Local variable yang tidak bocor ke thread lain aman secara natural.

```java
public BigDecimal calculateTotal(List<LineItem> items) {
    BigDecimal total = BigDecimal.ZERO;
    for (var item : items) {
        total = total.add(item.amount());
    }
    return total;
}
```

`total` confined ke stack method.

### 5.4 Object Confinement by Ownership

```java
public final class CaseDraftBuilder {
    private final List<String> notes = new ArrayList<>();

    public CaseDraftBuilder addNote(String note) {
        notes.add(note);
        return this;
    }

    public CaseDraft build() {
        return new CaseDraft(List.copyOf(notes));
    }
}
```

Builder mutable, tapi seharusnya confined ke satu thread/use case.

Contract harus jelas:

```text
Builder is not thread-safe.
Do not share builder between threads.
The built object is immutable.
```

### 5.5 Request Confinement

Dalam web application, object request-scoped biasanya confined ke satu request.

```java
public final class RequestContext {
    private final String correlationId;
    private final String userId;

    public RequestContext(String correlationId, String userId) {
        this.correlationId = correlationId;
        this.userId = userId;
    }
}
```

Namun hati-hati: request bisa memicu async task. Begitu state request dibawa ke thread lain, confinement berubah menjadi shared/published state.

### 5.6 ThreadLocal sebagai Confinement

`ThreadLocal` menyimpan value per thread.

```java
private static final ThreadLocal<String> CORRELATION_ID = new ThreadLocal<>();
```

Masalah di server:

```text
1. Thread pool memakai ulang thread.
2. Jika tidak remove(), data request lama bisa bocor.
3. Dengan async continuation, value tidak otomatis pindah thread.
4. Dengan virtual thread, ThreadLocal bisa dipakai, tetapi propagation dan memory tetap perlu disiplin.
```

Pattern aman:

```java
try {
    CORRELATION_ID.set(correlationId);
    process();
} finally {
    CORRELATION_ID.remove();
}
```

### 5.7 Scoped Values di Java 25

Java 25 memiliki `ScopedValue` sebagai cara yang lebih terstruktur untuk berbagi immutable context dalam dynamic scope. Ini membantu menggantikan sebagian penggunaan `ThreadLocal` untuk context yang seharusnya terbatas durasi eksekusi.

Contoh konseptual:

```java
import java.lang.ScopedValue;

public final class RequestScope {
    static final ScopedValue<String> CORRELATION_ID = ScopedValue.newInstance();

    public void handle(String correlationId, Runnable action) {
        ScopedValue.where(CORRELATION_ID, correlationId).run(action);
    }

    public static String correlationId() {
        return CORRELATION_ID.get();
    }
}
```

Benefit:

```text
1. Binding punya scope yang jelas.
2. Setelah scope selesai, value tidak leak.
3. Cocok untuk immutable context.
4. Lebih cocok dengan structured concurrency dibanding ThreadLocal-style global mutable context.
```

### 5.8 Anti-Pattern: Accidental Escape

```java
public final class ImportJob {
    private final List<String> errors = new ArrayList<>();

    public List<String> errors() {
        return errors;
    }
}
```

Jika caller menyimpan `errors()` dan memodifikasinya dari thread lain, confinement rusak.

Perbaikan:

```java
public List<String> errors() {
    return List.copyOf(errors);
}
```

Atau:

```java
public void addError(String error) {
    errors.add(error);
}
```

Tapi tetap harus dijelaskan apakah object ini thread-confined atau thread-safe.

---

## 6. Pattern 3 — Safe Publication

### 6.1 Intent

Safe Publication memastikan object yang dibuat oleh satu thread terlihat lengkap dan benar oleh thread lain.

### 6.2 Problem: Object Sudah Dibuat, Tapi Belum Aman Dilihat

Contoh buruk:

```java
public final class ConfigHolder {
    private RuntimeConfig config;

    public void init() {
        config = new RuntimeConfig(Map.of("mode", "prod"));
    }

    public RuntimeConfig config() {
        return config;
    }
}
```

Jika satu thread memanggil `init()` dan thread lain memanggil `config()`, tanpa synchronization/volatile/final publication, visibility tidak dijamin secara benar.

### 6.3 Publication via Final Field

```java
public final class ConfigHolder {
    private final RuntimeConfig config;

    public ConfigHolder(RuntimeConfig config) {
        this.config = config;
    }

    public RuntimeConfig config() {
        return config;
    }
}
```

Final field memberi initialization safety selama `this` tidak bocor saat constructor.

### 6.4 Publication via Volatile

```java
public final class ReloadableConfig {
    private volatile RuntimeConfig current;

    public ReloadableConfig(RuntimeConfig initial) {
        this.current = initial;
    }

    public RuntimeConfig current() {
        return current;
    }

    public void reload(RuntimeConfig next) {
        current = next;
    }
}
```

Cocok jika:

```text
1. Assignment reference cukup atomic.
2. Object target immutable.
3. Reader boleh melihat snapshot lama atau baru.
4. Tidak perlu compound update beberapa field.
```

### 6.5 Publication via Synchronized

```java
public final class ReloadableConfig {
    private RuntimeConfig current;

    public synchronized RuntimeConfig current() {
        return current;
    }

    public synchronized void reload(RuntimeConfig next) {
        current = next;
    }
}
```

Cocok jika perlu menjaga invariant beberapa field.

### 6.6 Publication via Concurrent Collection

```java
private final ConcurrentHashMap<String, RuntimeConfig> configs = new ConcurrentHashMap<>();

public void put(String tenant, RuntimeConfig config) {
    configs.put(tenant, config);
}

public RuntimeConfig get(String tenant) {
    return configs.get(tenant);
}
```

Concurrent collection menyediakan thread-safe access untuk struktur collection, tapi tidak otomatis membuat value mutable di dalamnya aman.

Jika `RuntimeConfig` mutable, tetap ada risiko.

### 6.7 Anti-Pattern: This Escape

```java
public final class UnsafeService {
    public UnsafeService(EventBus bus) {
        bus.register(this); // this escape sebelum constructor selesai
        initializeExpensiveState();
    }
}
```

Masalah:

```text
Object bisa dipakai listener lain sebelum constructor selesai.
Final field safety bisa rusak.
Invariant belum terbentuk.
```

Perbaikan:

```java
public final class SafeService {
    private final EventBus bus;

    public SafeService(EventBus bus) {
        this.bus = bus;
    }

    public void start() {
        bus.register(this);
    }
}
```

Pisahkan construction dan lifecycle start.

---

## 7. Pattern 4 — Guarded Suspension

### 7.1 Intent

Guarded Suspension membuat thread menunggu sampai kondisi tertentu benar sebelum melanjutkan operasi.

Bentuk umum:

```text
while condition is not satisfied:
    wait
perform action
```

### 7.2 Problem

Kadang operasi hanya boleh berjalan jika state tertentu sudah tersedia.

Contoh:

```text
Consumer hanya boleh mengambil item jika queue tidak kosong.
Sender hanya boleh mengirim jika connection ready.
Worker hanya boleh memproses jika service sudah started.
Shutdown hanya boleh selesai jika active task = 0.
```

### 7.3 Guarded Suspension dengan wait/notify

```java
public final class SimpleBlockingQueue<T> {
    private final java.util.ArrayDeque<T> queue = new java.util.ArrayDeque<>();
    private final int capacity;

    public SimpleBlockingQueue(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
    }

    public synchronized void put(T item) throws InterruptedException {
        while (queue.size() == capacity) {
            wait();
        }
        queue.addLast(item);
        notifyAll();
    }

    public synchronized T take() throws InterruptedException {
        while (queue.isEmpty()) {
            wait();
        }
        T item = queue.removeFirst();
        notifyAll();
        return item;
    }
}
```

Kenapa `while`, bukan `if`?

```text
1. Spurious wakeup bisa terjadi.
2. Thread lain bisa mengambil condition sebelum thread ini jalan.
3. notifyAll membangunkan banyak thread, belum tentu semua condition terpenuhi.
```

### 7.4 Guarded Suspension dengan Lock dan Condition

```java
import java.util.ArrayDeque;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public final class BoundedBuffer<T> {
    private final ArrayDeque<T> queue = new ArrayDeque<>();
    private final int capacity;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notEmpty = lock.newCondition();
    private final Condition notFull = lock.newCondition();

    public BoundedBuffer(int capacity) {
        this.capacity = capacity;
    }

    public void put(T item) throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (queue.size() == capacity) {
                notFull.await();
            }
            queue.addLast(item);
            notEmpty.signal();
        } finally {
            lock.unlock();
        }
    }

    public T take() throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (queue.isEmpty()) {
                notEmpty.await();
            }
            T item = queue.removeFirst();
            notFull.signal();
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```

`Condition` lebih ekspresif ketika ada beberapa kondisi berbeda.

### 7.5 Guarded Suspension dengan BlockingQueue

Biasanya di production, gunakan library concurrency yang sudah matang:

```java
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;

public final class WorkQueue<T> {
    private final BlockingQueue<T> queue;

    public WorkQueue(int capacity) {
        this.queue = new ArrayBlockingQueue<>(capacity);
    }

    public void submit(T item) throws InterruptedException {
        queue.put(item);
    }

    public T take() throws InterruptedException {
        return queue.take();
    }
}
```

Mental model tetap sama: operasi dilindungi oleh guard condition.

### 7.6 Timeout-aware Guarded Suspension

Thread yang menunggu tanpa timeout bisa membuat sistem sulit shutdown atau sulit recover.

```java
public T poll(java.time.Duration timeout) throws InterruptedException {
    return queue.poll(timeout.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS);
}
```

Design question:

```text
Jika timeout, caller harus apa?
Retry?
Return empty?
Raise domain error?
Cancel operation?
Escalate health check?
```

### 7.7 Interrupt Handling

Jangan swallow `InterruptedException`.

Buruk:

```java
try {
    queue.take();
} catch (InterruptedException ignored) {
}
```

Lebih benar:

```java
try {
    queue.take();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("interrupted while waiting for work", e);
}
```

Atau jika method memang boleh throw:

```java
public WorkItem take() throws InterruptedException {
    return queue.take();
}
```

### 7.8 Anti-Pattern: Busy Waiting

```java
while (!ready) {
    // spin forever
}
```

Masalah:

```text
1. Membakar CPU.
2. Visibility belum tentu benar jika ready tidak volatile/synchronized.
3. Tidak ada timeout.
4. Tidak responsif terhadap shutdown.
```

Jika perlu spin karena low-latency, desainnya harus eksplisit, bounded, dan biasanya memakai primitive khusus. Untuk enterprise app biasa, blocking coordination lebih tepat.

---

## 8. Pattern 5 — Balking Pattern

### 8.1 Intent

Balking Pattern membuat operasi langsung batal jika object tidak berada dalam state yang valid untuk operasi tersebut.

Beda dengan Guarded Suspension:

```text
Guarded Suspension: tunggu sampai condition benar.
Balking: kalau condition belum benar, jangan lakukan operasi.
```

### 8.2 Contoh: Service Start Hanya Sekali

```java
public final class BackgroundWorker {
    private enum State { NEW, STARTED, STOPPED }

    private State state = State.NEW;

    public synchronized boolean start() {
        if (state != State.NEW) {
            return false;
        }
        state = State.STARTED;
        startThread();
        return true;
    }

    public synchronized boolean stop() {
        if (state != State.STARTED) {
            return false;
        }
        state = State.STOPPED;
        requestStop();
        return true;
    }

    private void startThread() {
        // start worker
    }

    private void requestStop() {
        // signal shutdown
    }
}
```

### 8.3 Balking untuk Idempotent Operation

```java
public final class ReportGenerator {
    private boolean generated;

    public synchronized boolean generateOnce() {
        if (generated) {
            return false;
        }
        generated = true;
        doGenerate();
        return true;
    }

    private void doGenerate() {
        // expensive generation
    }
}
```

Namun hati-hati: jika `doGenerate()` gagal, apakah `generated` harus tetap true?

Lebih baik:

```java
public synchronized boolean generateOnce() {
    if (generated) {
        return false;
    }
    doGenerate();
    generated = true;
    return true;
}
```

Tapi ini menahan lock selama expensive operation.

Alternatif state lebih jelas:

```java
private enum State { NEW, GENERATING, GENERATED, FAILED }
```

### 8.4 Balking dengan AtomicBoolean

Untuk simple one-time gate:

```java
import java.util.concurrent.atomic.AtomicBoolean;

public final class OneTimeInitializer {
    private final AtomicBoolean initialized = new AtomicBoolean(false);

    public boolean initialize() {
        if (!initialized.compareAndSet(false, true)) {
            return false;
        }
        doInitialize();
        return true;
    }

    private void doInitialize() {
        // initialize resource
    }
}
```

Masalah: jika `doInitialize()` gagal, flag sudah true.

Versi lebih robust perlu state machine.

```java
enum InitState { NEW, INITIALIZING, INITIALIZED, FAILED }
```

### 8.5 Balking vs Exception

Ada dua kontrak:

```java
boolean start();
```

atau:

```java
void start(); // throws IllegalStateException if invalid
```

Pilih berdasarkan semantic:

| Kondisi | Return boolean | Exception |
|---|---:|---:|
| Duplicate call normal/idempotent | Cocok | Kurang cocok |
| Illegal lifecycle bug | Kurang cocok | Cocok |
| Caller expected to branch | Cocok | Bisa noisy |
| Must fail loudly | Kurang cocok | Cocok |

---

## 9. Pattern 6 — Producer-Consumer

### 9.1 Intent

Producer-Consumer memisahkan pihak yang menghasilkan work item dari pihak yang memproses work item melalui queue/buffer.

### 9.2 Problem

Producer dan consumer sering punya kecepatan berbeda.

```text
Producer cepat, consumer lambat -> queue membesar.
Producer lambat, consumer cepat -> consumer idle.
Consumer gagal -> retry/dead-letter perlu jelas.
Shutdown -> item di queue harus diapakan?
```

### 9.3 Basic Design

```java
public record WorkItem(String id, String payload) {}
```

```java
public final class WorkProcessor {
    public void process(WorkItem item) {
        // process item
    }
}
```

```java
public final class Worker implements Runnable {
    private final BlockingQueue<WorkItem> queue;
    private final WorkProcessor processor;
    private volatile boolean running = true;

    public Worker(BlockingQueue<WorkItem> queue, WorkProcessor processor) {
        this.queue = queue;
        this.processor = processor;
    }

    @Override
    public void run() {
        while (running || !queue.isEmpty()) {
            try {
                WorkItem item = queue.poll(500, TimeUnit.MILLISECONDS);
                if (item != null) {
                    processor.process(item);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                running = false;
            }
        }
    }

    public void stop() {
        running = false;
    }
}
```

### 9.4 Bounded Queue sebagai Backpressure

Unbounded queue terlihat nyaman, tetapi berbahaya.

```java
new LinkedBlockingQueue<>() // unbounded by default
```

Risiko:

```text
1. Memory growth tidak terkendali.
2. Latency meningkat diam-diam.
3. Failure tertunda sampai OOM.
4. Producer tidak tahu consumer overload.
```

Lebih baik:

```java
new ArrayBlockingQueue<>(10_000)
```

Kemudian pilih policy ketika penuh:

```text
1. block producer
2. timeout then fail
3. reject
4. drop oldest
5. drop newest
6. route to dead-letter
```

### 9.5 Poison Pill Shutdown

```java
public sealed interface QueueMessage permits Work, StopSignal {}
public record Work(String id, String payload) implements QueueMessage {}
public enum StopSignal implements QueueMessage { INSTANCE }
```

Consumer:

```java
while (true) {
    QueueMessage message = queue.take();
    switch (message) {
        case Work work -> process(work);
        case StopSignal ignored -> {
            return;
        }
    }
}
```

Poison pill cocok untuk fixed number worker. Jika ada N worker, biasanya butuh N poison pill atau mekanisme broadcast shutdown.

### 9.6 Ownership Transfer

Queue bukan hanya buffer. Queue adalah ownership transfer boundary.

```text
Sebelum put: producer owner item.
Setelah put berhasil: queue/consumer owner item.
Saat consumer take: consumer owner item.
```

Karena itu item yang dimasukkan ke queue sebaiknya immutable.

Buruk:

```java
var item = new MutableWorkItem();
queue.put(item);
item.setPayload("changed after enqueue");
```

Baik:

```java
public record WorkItem(String id, String payload) {}
```

### 9.7 Error Handling dalam Consumer

Jangan biarkan worker mati diam-diam.

```java
try {
    processor.process(item);
} catch (Exception e) {
    errorHandler.handle(item, e);
}
```

Design decision:

```text
1. Retry langsung?
2. Requeue?
3. Dead-letter?
4. Mark failed?
5. Escalate health?
6. Stop worker?
```

---

## 10. Pattern 7 — Monitor Object

### 10.1 Intent

Monitor Object menggabungkan state, lock, dan condition operations dalam satu object.

Di Java, `synchronized` method/block adalah bentuk monitor.

### 10.2 Contoh

```java
public final class CapacityTracker {
    private final int max;
    private int used;

    public CapacityTracker(int max) {
        this.max = max;
    }

    public synchronized boolean tryAcquire(int units) {
        if (units <= 0) {
            throw new IllegalArgumentException("units must be positive");
        }
        if (used + units > max) {
            return false;
        }
        used += units;
        return true;
    }

    public synchronized void release(int units) {
        if (units <= 0 || units > used) {
            throw new IllegalArgumentException("invalid release units");
        }
        used -= units;
    }

    public synchronized int available() {
        return max - used;
    }
}
```

Invariant:

```text
0 <= used <= max
available = max - used
```

Semua akses ke state lewat monitor yang sama.

### 10.3 Lock Scope

Kunci desain:

```text
Lock harus melindungi invariant, bukan sekadar baris kode.
```

Buruk:

```java
synchronized int used() { return used; }
synchronized int available() { return available; }
```

Jika invariant bergantung pada dua field, expose getter terpisah bisa memberi view tidak konsisten.

Lebih baik:

```java
public synchronized CapacitySnapshot snapshot() {
    return new CapacitySnapshot(used, max - used, max);
}
```

### 10.4 Jangan Panggil External Code Saat Memegang Lock

Buruk:

```java
public synchronized void update(State next) {
    this.state = next;
    listener.onStateChanged(next); // external code inside lock
}
```

Risiko:

```text
1. Deadlock.
2. Reentrancy surprise.
3. Lock ditahan lama.
4. Listener bisa memanggil balik object ini.
```

Lebih baik:

```java
public void update(State next) {
    List<Listener> snapshot;
    synchronized (this) {
        this.state = next;
        snapshot = List.copyOf(listeners);
    }
    for (var listener : snapshot) {
        listener.onStateChanged(next);
    }
}
```

---

## 11. Pattern 8 — Copy-on-Write Snapshot

### 11.1 Intent

Copy-on-Write membuat update dengan mengganti snapshot immutable, sehingga reader tidak perlu lock.

### 11.2 Cocok Untuk

```text
1. Read jauh lebih sering daripada write.
2. Snapshot tidak terlalu besar.
3. Reader butuh consistent immutable view.
4. Update boleh sedikit lebih mahal.
```

### 11.3 Contoh Listener Registry

```java
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public final class ListenerRegistry {
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    public void register(Listener listener) {
        listeners.addIfAbsent(listener);
    }

    public void unregister(Listener listener) {
        listeners.remove(listener);
    }

    public void publish(Event event) {
        for (var listener : listeners) {
            listener.onEvent(event);
        }
    }
}
```

### 11.4 Anti-Pattern: Copy-on-Write untuk Write-heavy Data

Jika write sering, copy-on-write mahal.

```text
Read-heavy registry -> good
Write-heavy queue   -> bad
High churn cache    -> bad
```

---

## 12. Pattern 9 — Atomic State Transition

### 12.1 Intent

Atomic State Transition memastikan perubahan state terjadi dari state lama yang diharapkan ke state baru secara atomic.

### 12.2 AtomicReference untuk State

```java
import java.util.concurrent.atomic.AtomicReference;

public final class Lifecycle {
    enum State { NEW, STARTING, STARTED, STOPPING, STOPPED }

    private final AtomicReference<State> state = new AtomicReference<>(State.NEW);

    public boolean start() {
        if (!state.compareAndSet(State.NEW, State.STARTING)) {
            return false;
        }
        try {
            doStart();
            state.set(State.STARTED);
            return true;
        } catch (RuntimeException e) {
            state.set(State.STOPPED);
            throw e;
        }
    }

    private void doStart() {
        // start resource
    }
}
```

### 12.3 CAS Loop untuk Immutable State

```java
public record Usage(int used, int limit) {
    public Usage acquire(int units) {
        if (used + units > limit) {
            throw new IllegalStateException("limit exceeded");
        }
        return new Usage(used + units, limit);
    }
}
```

```java
public final class UsageTracker {
    private final AtomicReference<Usage> usage;

    public UsageTracker(int limit) {
        this.usage = new AtomicReference<>(new Usage(0, limit));
    }

    public boolean tryAcquire(int units) {
        while (true) {
            Usage current = usage.get();
            Usage next;
            try {
                next = current.acquire(units);
            } catch (IllegalStateException e) {
                return false;
            }
            if (usage.compareAndSet(current, next)) {
                return true;
            }
        }
    }
}
```

Cocok jika state kecil dan immutable.

### 12.4 CAS Bukan Obat Semua

CAS bisa bermasalah jika:

```text
1. Contention tinggi.
2. State update mahal.
3. Ada side effect dalam loop.
4. Perlu blocking wait.
5. State besar.
```

Jangan lakukan side effect sebelum CAS berhasil.

Buruk:

```java
while (true) {
    var current = ref.get();
    sendEmail(); // bisa terjadi berkali-kali
    var next = current.markSent();
    if (ref.compareAndSet(current, next)) return;
}
```

---

## 13. Java 8–25 Perspective

### 13.1 Java 8

Java 8 memberi tools penting:

```text
1. CompletableFuture
2. parallel stream
3. lambda untuk callback/strategy
4. improved concurrent collections usage style
```

Namun Part 22 sengaja menekankan: lambda tidak menghapus masalah shared mutable state.

Buruk:

```java
var list = new ArrayList<Integer>();
stream.parallel().forEach(list::add); // race
```

Baik:

```java
var list = stream.parallel().toList();
```

atau collector thread-safe yang benar.

### 13.2 Java 9–17

Relevant changes:

```text
1. immutable collection factories: List.of, Map.of, Set.of
2. VarHandle untuk low-level atomic/volatile access
3. records untuk immutable data modeling
4. sealed classes untuk state/message modeling
```

### 13.3 Java 21

Java 21 membawa virtual threads sebagai fitur final. Virtual threads membuat blocking code lebih scalable untuk I/O-bound workload, tetapi tidak menghilangkan race condition.

```text
Virtual thread solves thread scarcity for blocking I/O.
Virtual thread does not solve shared mutable state correctness.
```

Jika object tidak thread-safe, menjalankannya di virtual thread tetap tidak aman.

### 13.4 Java 25

Java 25 memperkuat arah structured concurrency dan scoped context. Dua implikasi besar untuk pattern Part 22:

```text
1. Context propagation sebaiknya bounded dan scoped, bukan global ThreadLocal yang bocor.
2. Concurrent subtasks sebaiknya punya lifecycle yang jelas, bukan orphan task.
```

Part 23 akan membahas structured concurrency lebih dalam. Di Part 22, takeaway utamanya:

```text
Confinement dan ownership tetap konsep utama bahkan ketika thread lebih murah.
```

---

## 14. Anti-Pattern Catalog

### 14.1 Shared Mutable Everything

Gejala:

```text
1. Banyak singleton mutable.
2. Static map/cache tanpa ownership jelas.
3. Service menyimpan mutable per-request state.
4. DTO mutable dipakai lintas thread.
```

Contoh:

```java
public class CaseService {
    private Case currentCase; // shared service singleton storing request state
}
```

Di Spring/CDI/Jakarta, service singleton tidak boleh menyimpan request-specific mutable state.

### 14.2 Volatile as Magic Fix

`volatile` menjamin visibility untuk read/write variable tersebut, tetapi tidak membuat compound operation atomic.

Buruk:

```java
private volatile int count;

void increment() {
    count++;
}
```

Perbaikan:

```java
private final AtomicInteger count = new AtomicInteger();

void increment() {
    count.incrementAndGet();
}
```

Atau lock jika ada invariant multi-field.

### 14.3 Lock Without Ownership Model

```java
synchronized (someRandomObject) {
    // update state
}
```

Pertanyaan:

```text
State apa yang dilindungi lock ini?
Semua akses ke state memakai lock yang sama?
Apakah lock object bisa diakses luar?
Apakah lock ordering jelas?
```

Lebih baik:

```java
private final Object lock = new Object();
```

Dan dokumentasikan invariant yang dilindungi.

### 14.4 Unsafe Lazy Initialization

Buruk:

```java
private ExpensiveObject object;

public ExpensiveObject object() {
    if (object == null) {
        object = new ExpensiveObject();
    }
    return object;
}
```

Perbaikan sederhana:

```java
public synchronized ExpensiveObject object() {
    if (object == null) {
        object = new ExpensiveObject();
    }
    return object;
}
```

Atau initialization-on-demand holder:

```java
public final class ExpensiveProvider {
    private static class Holder {
        static final ExpensiveObject INSTANCE = new ExpensiveObject();
    }

    public static ExpensiveObject instance() {
        return Holder.INSTANCE;
    }
}
```

### 14.5 Double-Checked Locking Salah

Versi benar butuh `volatile`:

```java
private volatile ExpensiveObject object;

public ExpensiveObject object() {
    ExpensiveObject local = object;
    if (local == null) {
        synchronized (this) {
            local = object;
            if (local == null) {
                local = new ExpensiveObject();
                object = local;
            }
        }
    }
    return local;
}
```

Namun sering kali lebih sederhana memakai holder idiom atau DI container.

### 14.6 Catch InterruptedException and Continue

Buruk:

```java
catch (InterruptedException e) {
    log.warn("interrupted");
}
```

Jika lanjut tanpa restore interrupt, cancellation signal hilang.

Perbaikan:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

### 14.7 Synchronized Public Lock

```java
public synchronized void update() { ... }
```

Ini menggunakan `this` sebagai lock. Caller luar bisa melakukan:

```java
synchronized (service) {
    // hold lock externally
}
```

Untuk class library atau object yang diekspos luas, private lock sering lebih aman.

### 14.8 Locking Around I/O

```java
public synchronized void saveAndNotify(Data data) {
    repository.save(data);
    httpClient.post(data);
}
```

Risiko:

```text
1. Lock ditahan terlalu lama.
2. I/O lambat memblokir operasi lain.
3. Deadlock jika callback masuk balik.
4. Throughput collapse.
```

Pisahkan state mutation dan I/O jika memungkinkan.

### 14.9 ThreadLocal Leak

```java
REQUEST_USER.set(user);
process();
// no remove
```

Perbaikan:

```java
try {
    REQUEST_USER.set(user);
    process();
} finally {
    REQUEST_USER.remove();
}
```

Lebih baik untuk Java 25 context tertentu: pertimbangkan `ScopedValue`.

### 14.10 Parallel Stream over Mutable State

Buruk:

```java
var result = new HashMap<String, Integer>();
items.parallelStream().forEach(item -> result.put(item.key(), item.value()));
```

Gunakan collector/concurrent collector yang benar, atau jangan parallel.

---

## 15. Refactoring Path dari Unsafe Mutable Code

### 15.1 Starting Point

```java
public class CaseImportService {
    private final List<String> errors = new ArrayList<>();
    private int processed;

    public void importCases(List<CaseRow> rows) {
        rows.parallelStream().forEach(row -> {
            try {
                importOne(row);
                processed++;
            } catch (Exception e) {
                errors.add(row.id() + ": " + e.getMessage());
            }
        });
    }

    public List<String> errors() {
        return errors;
    }

    public int processed() {
        return processed;
    }
}
```

Masalah:

```text
1. Service menyimpan per-operation state.
2. ArrayList tidak thread-safe.
3. processed++ race.
4. errors bocor keluar.
5. parallelStream memakai shared mutable state.
6. Jika service singleton, state antar request bercampur.
```

### 15.2 Step 1 — Jadikan State Local

```java
public ImportResult importCases(List<CaseRow> rows) {
    List<ImportOutcome> outcomes = rows.stream()
            .map(this::importSafely)
            .toList();

    return ImportResult.from(outcomes);
}
```

### 15.3 Step 2 — Jadikan Result Immutable

```java
public record ImportResult(
        int processed,
        List<String> errors
) {
    public ImportResult {
        errors = List.copyOf(errors);
    }

    public static ImportResult from(List<ImportOutcome> outcomes) {
        int processed = 0;
        List<String> errors = new ArrayList<>();

        for (var outcome : outcomes) {
            if (outcome.success()) {
                processed++;
            } else {
                errors.add(outcome.errorMessage());
            }
        }
        return new ImportResult(processed, errors);
    }
}
```

### 15.4 Step 3 — Parallelize Only Pure Work

```java
public ImportResult importCases(List<CaseRow> rows) {
    List<ImportOutcome> outcomes = rows.parallelStream()
            .map(this::validateAndTransform)
            .toList();

    return ImportResult.from(outcomes);
}
```

Jika `importOne` punya I/O/transaction, jangan asal parallel stream. Gunakan bounded executor/queue di Part 23.

### 15.5 Step 4 — Explicit Work Queue Jika Perlu

Jika workload besar, butuh:

```text
1. bounded queue
2. worker count jelas
3. retry policy
4. failure handling
5. cancellation
6. progress snapshot
7. shutdown behavior
```

---

## 16. Design Review Checklist

Gunakan checklist ini saat review code concurrent.

### 16.1 State Ownership

```text
[ ] State ini milik siapa?
[ ] Apakah state shared antar thread?
[ ] Apakah state mutable?
[ ] Kalau mutable, siapa yang boleh mengubah?
[ ] Apakah ada accidental escape?
```

### 16.2 Invariant

```text
[ ] Apa invariant object ini?
[ ] Apakah invariant melibatkan lebih dari satu field?
[ ] Apakah semua field invariant dilindungi lock/atomic boundary yang sama?
[ ] Apakah getter bisa expose partial/inconsistent view?
```

### 16.3 Visibility

```text
[ ] Bagaimana object dipublish ke thread lain?
[ ] Apakah field final cukup?
[ ] Apakah perlu volatile?
[ ] Apakah synchronized digunakan konsisten?
[ ] Apakah concurrent collection hanya melindungi map/list, bukan isi value?
```

### 16.4 Coordination

```text
[ ] Apakah thread menunggu condition dengan benar?
[ ] Apakah wait dilakukan dalam while loop?
[ ] Apakah ada timeout?
[ ] Apakah InterruptedException ditangani dengan benar?
[ ] Apakah shutdown bisa menghentikan thread yang menunggu?
```

### 16.5 Locking

```text
[ ] Lock melindungi invariant apa?
[ ] Apakah ada lock ordering?
[ ] Apakah external code dipanggil saat lock dipegang?
[ ] Apakah I/O dilakukan dalam lock?
[ ] Apakah lock terlalu coarse atau terlalu fine?
```

### 16.6 Queue/Pipeline

```text
[ ] Queue bounded atau unbounded?
[ ] Apa policy saat queue penuh?
[ ] Item immutable setelah enqueue?
[ ] Apa retry/dead-letter behavior?
[ ] Apa shutdown behavior?
```

---

## 17. Testing Strategy

### 17.1 Unit Test Tidak Cukup

Concurrency bug sering timing-dependent. Unit test biasa bisa lolos ribuan kali lalu gagal di production.

Tetap tulis unit test untuk invariant, tapi tambahkan stress-oriented test.

### 17.2 Test Invariant Under Concurrency

```java
@Test
void counterShouldReachExpectedValue() throws Exception {
    var counter = new SafeCounter();
    int threads = 8;
    int increments = 100_000;

    var executor = Executors.newFixedThreadPool(threads);
    var tasks = new ArrayList<Callable<Void>>();

    for (int i = 0; i < threads; i++) {
        tasks.add(() -> {
            for (int j = 0; j < increments; j++) {
                counter.increment();
            }
            return null;
        });
    }

    for (var future : executor.invokeAll(tasks)) {
        future.get();
    }
    executor.shutdown();

    assertEquals(threads * increments, counter.value());
}
```

### 17.3 Test Shutdown

Test wajib:

```text
1. worker stops when requested
2. worker handles interrupt
3. queued item behavior saat shutdown
4. no thread leak
5. timeout works
```

### 17.4 Test Publication

Untuk config/snapshot:

```text
1. reader never sees null after initialization
2. reader never sees partial object
3. reader sees either old valid snapshot or new valid snapshot
4. update does not mutate previous snapshot
```

### 17.5 Avoid Sleep-Based Test

Buruk:

```java
Thread.sleep(1000);
assertTrue(done);
```

Lebih baik:

```java
assertTrue(latch.await(1, TimeUnit.SECONDS));
```

Gunakan `CountDownLatch`, `CyclicBarrier`, `Phaser`, atau test hooks yang eksplisit.

---

## 18. Observability and Debugging Angle

Concurrency bug sulit dilihat. Desain observability harus membantu menjawab:

```text
1. Thread mana memproses work item apa?
2. Queue depth berapa?
3. Berapa lama item menunggu?
4. Berapa lama lock ditahan?
5. Berapa task aktif?
6. Berapa task gagal/retry?
7. Apakah worker masih hidup?
8. Apakah shutdown stuck?
```

### 18.1 Metrics Penting

```text
queue.depth
queue.offer.timeout.count
queue.take.wait.time
worker.active.count
worker.completed.count
worker.failed.count
worker.retry.count
worker.shutdown.duration
lock.wait.time
lock.hold.time
```

### 18.2 Structured Logging

```java
log.info("work-item-started id={} queueWaitMs={} worker={}",
        item.id(), item.queueWaitMs(), Thread.currentThread().getName());
```

Jangan log semua dalam hot path jika throughput tinggi. Gunakan sampling/metrics.

### 18.3 Thread Dump Literacy

Saat production stuck, thread dump bisa menunjukkan:

```text
1. BLOCKED pada monitor
2. WAITING pada condition
3. TIMED_WAITING pada queue poll
4. deadlock candidate
5. thread pool starvation
6. worker leak
```

Pattern yang baik membuat thread name dan stack trace bermakna.

---

## 19. Security and Compliance Angle

Concurrency design juga berdampak pada security/compliance.

### 19.1 Context Leakage

ThreadLocal yang tidak dibersihkan bisa membocorkan user context antar request.

Risiko:

```text
1. audit salah user
2. authorization memakai subject lama
3. log correlation salah
4. data tenant A masuk proses tenant B
```

### 19.2 Mutable Shared Authorization State

Buruk:

```java
static Set<String> currentPermissions;
```

Permissions harus request-scoped/immutable/safely published.

### 19.3 Async Audit Event

Jika audit diproses async, pastikan event payload immutable dan lengkap.

Buruk:

```java
AuditEvent event = new AuditEvent();
queue.put(event);
event.setUser(currentUser); // mutation after enqueue
```

Baik:

```java
queue.put(new AuditEvent(userId, action, targetId, occurredAt));
```

---

## 20. Performance Consideration

### 20.1 Lock Cost vs Correctness

Jangan menghindari lock sebelum benar-benar perlu. Lock yang benar dan sederhana sering lebih baik daripada CAS rumit yang salah.

### 20.2 Contention

Jika banyak thread berebut lock yang sama:

```text
1. kurangi shared state
2. shard state
3. gunakan immutable snapshot
4. gunakan queue ownership
5. gunakan LongAdder untuk high-contention counters
6. gunakan read-write lock jika read-heavy dan critical section besar
```

### 20.3 False Sharing

Untuk low-level high-performance systems, field yang sering diupdate thread berbeda bisa menyebabkan cache-line contention. Ini advanced dan biasanya tidak perlu di aplikasi enterprise biasa, tetapi penting untuk engine/cache/queue implementation.

### 20.4 Virtual Threads

Virtual threads mengurangi biaya thread blocking I/O, tetapi synchronization yang membuat carrier pinning atau contention tetap bisa menjadi masalah. Lebih penting lagi, virtual thread tidak membuat shared mutable state aman.

---

## 21. Case Study: Runtime Policy Cache untuk Regulatory Application

### 21.1 Problem

Sistem memiliki policy configuration untuk eligibility, sanction, deadline, dan routing. Policy dibaca ribuan kali per menit, tetapi update hanya beberapa kali per hari.

Requirement:

```text
1. Reader harus cepat.
2. Reader harus melihat policy snapshot konsisten.
3. Update tidak boleh membuat reader melihat state parsial.
4. Audit harus tahu policy version yang dipakai.
5. Jika update gagal, old policy tetap aktif.
```

### 21.2 Bad Design

```java
public final class PolicyCache {
    private final Map<String, PolicyRule> rules = new HashMap<>();

    public PolicyRule rule(String code) {
        return rules.get(code);
    }

    public void reload(List<PolicyRule> newRules) {
        rules.clear();
        for (var rule : newRules) {
            rules.put(rule.code(), rule);
        }
    }
}
```

Masalah:

```text
1. Reader bisa melihat map kosong saat reload.
2. HashMap tidak aman concurrent read/write.
3. Tidak ada version.
4. Tidak ada rollback semantic.
5. Rule mutable bisa berubah setelah publish.
```

### 21.3 Better Design: Immutable Snapshot + AtomicReference

```java
public record PolicySnapshot(
        long version,
        Map<String, PolicyRule> rules,
        Instant loadedAt
) {
    public PolicySnapshot {
        rules = Map.copyOf(rules);
    }

    public PolicyRule rule(String code) {
        return rules.get(code);
    }
}
```

```java
public final class PolicyCache {
    private final AtomicReference<PolicySnapshot> current;

    public PolicyCache(PolicySnapshot initial) {
        this.current = new AtomicReference<>(initial);
    }

    public PolicySnapshot current() {
        return current.get();
    }

    public void reload(PolicySnapshot next) {
        current.set(next);
    }
}
```

Usage:

```java
PolicySnapshot snapshot = policyCache.current();
PolicyRule rule = snapshot.rule("ELIGIBILITY_A");
Decision decision = evaluate(rule, application);
audit.record(application.id(), decision, snapshot.version());
```

### 21.4 Why This Works

```text
1. Snapshot immutable.
2. AtomicReference publishes snapshot safely.
3. Reader sees old or new snapshot, never partial reload.
4. Audit records policy version.
5. Reload failure does not corrupt active state.
```

### 21.5 Design Trade-Off

```text
Cost:
- update copies map
- snapshot memory exists temporarily

Benefit:
- lock-free read
- strong consistency per decision
- easy audit
- easy rollback
```

Untuk read-heavy policy cache, ini biasanya trade-off yang sangat baik.

---

## 22. Common Staff-Level Discussion Questions

### 22.1 “Kenapa tidak semua pakai synchronized saja?”

Karena `synchronized` menyelesaikan sebagian masalah coordination dan visibility, tetapi tidak otomatis menyelesaikan ownership, lifecycle, throughput, deadlock, blocking I/O, atau boundary design.

Namun untuk invariant kecil, `synchronized` sering pilihan terbaik karena sederhana dan benar.

### 22.2 “Kapan volatile cukup?”

`volatile` cukup jika:

```text
1. State hanya satu reference/primitive.
2. Update tidak bergantung pada value sebelumnya, atau race overwrite acceptable.
3. Object yang direferensikan immutable/safely constructed.
4. Tidak ada invariant multi-field.
```

Contoh cocok:

```java
private volatile boolean shutdownRequested;
private volatile RuntimeConfig config;
```

Tidak cocok:

```java
volatile int count;
count++;
```

### 22.3 “Kapan AtomicReference lebih baik daripada lock?”

Jika:

```text
1. State immutable dan relatif kecil.
2. Update bisa diretry tanpa side effect.
3. Contention tidak terlalu tinggi.
4. Reader butuh cepat tanpa lock.
```

Kalau update kompleks, side-effectful, atau invariant besar, lock sering lebih jelas.

### 22.4 “Kapan queue lebih baik daripada shared lock?”

Queue lebih baik ketika:

```text
1. Ownership bisa dipindah ke worker.
2. Work item independen.
3. Perlu backpressure.
4. Producer dan consumer speed berbeda.
5. Kita ingin serialisasi mutation pada owner thread.
```

### 22.5 “Apakah virtual threads membuat producer-consumer obsolete?”

Tidak. Virtual threads membuat thread blocking lebih murah, tetapi queue tetap berguna untuk ownership transfer, backpressure, buffering, ordering, dan worker isolation.

### 22.6 “Apakah immutable object selalu thread-safe?”

Secara behavior, immutable object aman dibaca banyak thread jika benar-benar immutable dan dipublish dengan aman. Fake immutable atau object yang bocor saat constructor tetap bisa bermasalah.

---

## 23. Practical Heuristics

Gunakan urutan keputusan ini:

```text
1. Bisakah state tidak dishare?
   -> gunakan confinement.

2. Kalau harus dishare, bisakah dibuat immutable?
   -> gunakan immutable snapshot/value object.

3. Kalau harus mutable, bisakah satu owner thread mengelola mutation?
   -> gunakan queue/actor-like ownership.

4. Kalau banyak thread harus mutate, apakah invariant sederhana?
   -> synchronized/lock/atomic.

5. Kalau thread harus menunggu condition?
   -> guarded suspension / BlockingQueue / Condition.

6. Kalau operasi hanya valid pada state tertentu dan tidak perlu menunggu?
   -> balking.

7. Kalau update read-heavy dan write-rare?
   -> copy-on-write / AtomicReference snapshot.
```

---

## 24. Summary

Concurrency pattern bukan dimulai dari API. Ia dimulai dari state model.

Fondasi utamanya:

```text
1. Immutability menghilangkan mutation race.
2. Confinement menghilangkan sharing race.
3. Safe publication memastikan object terlihat benar oleh thread lain.
4. Guarded Suspension mengatur thread menunggu condition dengan aman.
5. Balking menolak operasi jika state tidak valid.
6. Producer-Consumer memindahkan ownership melalui queue.
7. Monitor Object melindungi invariant dengan lock terpusat.
8. Copy-on-Write memberi snapshot konsisten untuk read-heavy workload.
9. Atomic State Transition cocok untuk state kecil dan side-effect-free.
```

Prinsip paling penting:

```text
Jangan bertanya “lock apa yang harus saya pakai?” terlalu awal.
Tanyakan dulu “state ini milik siapa, berubah kapan, dan bagaimana perubahan itu terlihat?”
```

Engineer top-level bukan hanya tahu `synchronized`, `volatile`, atau `AtomicReference`. Mereka tahu kapan tidak perlu berbagi state, kapan immutable snapshot cukup, kapan queue adalah boundary ownership, kapan lock menjaga invariant, dan kapan concurrency abstraction justru menyembunyikan bug.

---

## 25. Referensi Lanjut

1. Java Language Specification — Chapter 17: Threads and Locks / Java Memory Model.
2. Java SE 25 API — `Thread`, `ScopedValue`, `java.util.concurrent`.
3. Oracle Java documentation — Virtual Threads.
4. Oracle Java documentation — Structured Concurrency.
5. Brian Goetz et al. — Java Concurrency in Practice.
6. Doug Lea — Concurrent Programming in Java.
7. POSA Pattern — Guarded Suspension, Balking, Producer-Consumer.
8. OpenJDK documentation and JEP history for virtual threads, scoped values, and structured concurrency.

---

## 26. Part Berikutnya

Part berikutnya:

```text
23-concurrency-executor-future-completablefuture-structured-concurrency.md
```

Fokus berikutnya:

```text
Executor, Future, CompletableFuture, task lifecycle, cancellation, timeout propagation, fan-out/fan-in, virtual threads, structured concurrency, scoped values, dan anti-pattern CompletableFuture spaghetti.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./21-error-handling-result-exception-translation-problem-details.md">⬅️ Error Handling Patterns: Result, Exception Translation, Problem Details</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./23-concurrency-executor-future-completablefuture-structured-concurrency.md">Concurrency Pattern II: Executor, Future, CompletableFuture, Structured Concurrency ➡️</a>
</div>
