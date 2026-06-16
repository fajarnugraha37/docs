# learn-java-memory-byte-bit-buffer-offheap-gc-part-029.md

# Part 029 — Memory-Aware API and System Design Patterns

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `029`  
> Topik: **Memory-Aware API and System Design Patterns**  
> Target Java: **8 hingga 25**  
> Fokus: mengubah pemahaman memory, object lifetime, buffer, off-heap, GC, dan observability menjadi keputusan desain API dan sistem produksi.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- representasi bit/byte/primitive;
- object layout dan reference graph;
- heap, stack, metaspace, code cache, native memory;
- allocation mechanics, TLAB, escape analysis;
- object lifetime engineering;
- reference types, `Cleaner`, off-heap lifecycle;
- `ByteBuffer`, direct buffer, memory-mapped file, FFM API;
- `Unsafe`, `VarHandle`, migration strategy;
- CPU cache, false sharing, locality;
- Java Memory Model;
- GC fundamentals;
- Serial, Parallel, CMS, G1, ZGC, Shenandoah;
- GC selection;
- observability, heap dump, native memory investigation;
- container/Kubernetes memory tuning.

Bagian ini adalah jembatan dari **runtime knowledge** ke **software design**.

Artinya, kita tidak lagi bertanya:

```text
Bagaimana JVM mengelola memory?
```

Tetapi:

```text
Bagaimana saya mendesain API, service boundary, data flow, cache, buffer,
dan object lifecycle agar JVM tidak dipaksa bekerja melawan desain saya sendiri?
```

Ini level yang sering membedakan engineer biasa dari engineer yang benar-benar kuat di production. Banyak masalah memory bukan karena GC salah, melainkan karena API dan arsitektur membuat object terlalu banyak, terlalu besar, terlalu lama hidup, atau terlalu sulit dilepas.

---

## 1. Core Mental Model: API Design Is Memory Design

Setiap API Java yang kita buat sebenarnya melakukan beberapa keputusan memory secara implisit:

```text
Apakah data dibuat baru atau dipakai ulang?
Apakah data disalin atau dibagikan?
Apakah data dimaterialisasi penuh atau distream?
Apakah data hidup sebentar atau tertahan lama?
Apakah object graph dangkal atau sangat dalam?
Apakah ownership jelas atau ambigu?
Apakah buffer bounded atau bisa tumbuh tanpa batas?
Apakah cleanup deterministik atau menunggu GC?
```

Contoh sederhana:

```java
List<OrderDto> findOrders(SearchCriteria criteria);
```

API ini terlihat normal. Tetapi secara memory, API ini mengatakan:

```text
Caller harus menerima seluruh hasil dalam memory.
Semua row akan dimaterialisasi menjadi object Java.
Semua object minimal hidup sampai List selesai dipakai.
Jika hasil besar, heap pressure naik.
Jika List disimpan ke cache/session/log, lifetime menjadi panjang.
```

Bandingkan dengan:

```java
void streamOrders(SearchCriteria criteria, Consumer<OrderDto> consumer);
```

Atau:

```java
Page<OrderDto> findOrders(SearchCriteria criteria, Cursor cursor, int limit);
```

Atau:

```java
Stream<OrderDto> findOrders(SearchCriteria criteria);
```

Masing-masing membawa konsekuensi memory berbeda. API bukan cuma kontrak fungsional; API juga kontrak allocation, ownership, lifetime, dan backpressure.

---

## 2. Prinsip Utama Memory-Aware Design

Ada beberapa prinsip yang akan terus muncul di bagian ini.

### 2.1 Bound Everything That Can Grow

Struktur yang bisa tumbuh harus punya batas eksplisit:

- queue;
- buffer;
- cache;
- batch;
- result set;
- upload size;
- JSON body;
- map accumulator;
- pending task;
- retry backlog;
- in-flight request;
- per-tenant data;
- per-user session data;
- per-key aggregation state.

Anti-pattern:

```java
private final Queue<Event> pending = new ConcurrentLinkedQueue<>();
```

Masalahnya bukan `ConcurrentLinkedQueue` itu buruk. Masalahnya queue tersebut **unbounded**. Kalau producer lebih cepat dari consumer, queue menjadi heap-backed memory leak yang sah secara reference graph.

Lebih sehat:

```java
private final BlockingQueue<Event> pending = new ArrayBlockingQueue<>(10_000);
```

Atau dalam sistem async:

```text
bounded queue + rejection policy + retry policy + dead-letter strategy + metric
```

Memory-aware design selalu bertanya:

```text
Apa yang terjadi jika input 10x lebih besar?
Apa yang terjadi jika downstream lambat?
Apa yang terjadi jika satu tenant/user/key sangat aktif?
Apa yang terjadi jika retry gagal selama 30 menit?
```

---

### 2.2 Prefer Streaming When Cardinality Is Not Naturally Small

Jika jumlah data tidak punya batas natural yang kecil, jangan default ke materialisasi penuh.

Buruk:

```java
List<AuditRecord> records = repository.findAllByDateRange(from, to);
return exporter.toCsv(records);
```

Masalah:

- semua row masuk heap;
- setiap row menjadi object;
- CSV mungkin membuat `StringBuilder` besar;
- byte output mungkin juga ditahan;
- GC harus menelusuri seluruh object graph;
- latency tail memburuk;
- OOM muncul saat range membesar.

Lebih baik:

```java
repository.streamByDateRange(from, to, record -> {
    csvWriter.write(record);
});
```

Atau:

```java
try (var cursor = repository.openCursor(from, to)) {
    while (cursor.hasNext()) {
        csvWriter.write(cursor.next());
    }
}
```

Namun streaming juga punya risiko:

- resource harus ditutup;
- transaction tidak boleh terlalu panjang;
- connection tidak boleh tertahan lama;
- exception handling harus jelas;
- caller tidak boleh menyimpan semua item diam-diam;
- backpressure harus diperhitungkan.

Streaming bukan sekadar mengganti `List` menjadi `Stream`. Streaming adalah kontrak lifetime.

---

### 2.3 Separate Data Shape by Lifecycle

Object yang hidup sangat sebentar sebaiknya tidak bercampur dengan object yang hidup lama.

Contoh buruk:

```java
class UserSession {
    private final UserProfile profile;
    private final List<SearchResult> lastSearchResults;
    private final byte[] lastUploadedFile;
    private final Map<String, Object> debugContext;
}
```

Masalahnya `UserSession` biasanya long-lived. Jika kita memasukkan transient data ke dalamnya, transient data ikut menjadi long-lived.

Lebih sehat:

```text
Session state:
- user id
- role summary
- small stable preferences

Transient request state:
- search results
- upload bytes
- debug context
- temporary DTOs
```

Mental model:

```text
Jangan menempelkan object short-lived ke root long-lived.
```

Root long-lived bisa berupa:

- static singleton;
- cache;
- session;
- actor state;
- scheduler;
- thread local;
- executor queue;
- event bus subscriber;
- classloader;
- application context;
- connection pool;
- metrics registry;
- request registry;
- correlation map;
- retry store.

---

### 2.4 Make Ownership Explicit

Banyak leak dan corruption muncul karena ownership tidak jelas.

Pertanyaan ownership:

```text
Siapa yang boleh menulis object ini?
Siapa yang boleh menyimpan reference ini?
Siapa yang bertanggung jawab menutup resource ini?
Apakah caller boleh menyimpan buffer setelah method return?
Apakah callee boleh mutate input?
Apakah data harus dicopy sebelum disimpan?
```

Contoh API ambigu:

```java
void send(ByteBuffer buffer);
```

Pertanyaan:

```text
Apakah send akan membaca dari posisi sekarang?
Apakah send akan mengubah position?
Apakah send async?
Apakah caller boleh reuse buffer setelah method return?
Apakah send menyimpan reference buffer?
```

API lebih jelas:

```java
void sendCopy(ByteBuffer source);
```

Atau:

```java
CompletionStage<Void> sendOwned(ByteBuffer ownedBuffer);
```

Atau:

```java
void sendReadOnly(ByteBuffer sourceView);
```

Atau dengan dokumentasi kontrak:

```java
/**
 * The caller transfers ownership of {@code buffer} to this sender.
 * The caller must not mutate or reuse the buffer until the returned stage completes.
 * The sender may mutate the buffer's position and limit.
 */
CompletionStage<Void> send(ByteBuffer buffer);
```

Memory-aware API harus menjelaskan ownership, bukan hanya type.

---

## 3. Allocation-Aware API Design

### 3.1 Hindari Allocation yang Tidak Membawa Informasi Baru

Allocation sehat adalah allocation yang membawa nilai domain baru. Allocation buruk adalah allocation yang hanya muncul karena API shape kurang baik.

Contoh:

```java
String status = order.getStatus().toString().toLowerCase(Locale.ROOT);
```

Jika dilakukan di loop besar, ini membuat banyak temporary `String`.

Lebih baik:

```java
if (order.status() == OrderStatus.APPROVED) {
    ...
}
```

Atau jika perlu external representation:

```java
enum OrderStatus {
    APPROVED("approved"),
    REJECTED("rejected");

    private final String wireValue;

    OrderStatus(String wireValue) {
        this.wireValue = wireValue;
    }

    public String wireValue() {
        return wireValue;
    }
}
```

Prinsip:

```text
Jangan konversi ulang representasi yang sama berkali-kali.
```

---

### 3.2 Return Primitive or Specialized Result When Appropriate

Buruk:

```java
Optional<Integer> findScore(UserId userId);
```

Untuk path panas, ini bisa membuat object tambahan, terutama jika boxing tidak dieliminasi.

Alternatif:

```java
OptionalInt findScore(UserId userId);
```

Atau:

```java
int findScoreOrDefault(UserId userId, int defaultValue);
```

Atau untuk hot path internal:

```java
boolean tryFindScore(UserId userId, MutableInt out);
```

Tetapi hati-hati: desain seperti `MutableInt out` lebih rendah-level dan bisa mengorbankan readability. Gunakan hanya ketika benar-benar hot path dan terbukti allocation sensitive.

Rule praktis:

```text
Public domain API boleh lebih ekspresif.
Internal hot-path API boleh lebih allocation-aware.
```

---

### 3.3 Avoid Accidental Boxing in Hot Paths

Contoh umum:

```java
Map<Long, Integer> counts = new HashMap<>();
for (long id : ids) {
    counts.merge(id, 1, Integer::sum);
}
```

Masalah:

- `long` menjadi `Long`;
- `int` menjadi `Integer`;
- key/value object bertambah;
- hash table node/object overhead tinggi;
- cache locality buruk.

Untuk path biasa, ini bisa diterima. Untuk cardinality besar/hot path, pertimbangkan:

- primitive specialized collection dari library tepercaya;
- array jika id dense;
- `LongAdder` untuk concurrent counter;
- bitmap jika state boolean;
- sorting + scan jika batch processing;
- off-heap structure jika live set terlalu besar dan lifecycle jelas.

Jangan langsung optimasi semua `HashMap<Long, Integer>`. Tetapi pahami kapan boxing menjadi cost dominan.

---

### 3.4 API Should Not Force Defensive Copies Everywhere

Defensive copy kadang perlu untuk safety. Tetapi API yang salah bisa membuat copy berantai.

Buruk:

```java
byte[] getPayload() {
    return Arrays.copyOf(payload, payload.length);
}
```

Jika `getPayload()` dipanggil berkali-kali untuk payload besar, setiap call meng-copy.

Alternatif:

```java
ByteBuffer payloadView() {
    return ByteBuffer.wrap(payload).asReadOnlyBuffer();
}
```

Atau:

```java
void writePayloadTo(OutputStream out) throws IOException {
    out.write(payload);
}
```

Atau:

```java
int copyPayloadTo(byte[] target, int offset) {
    System.arraycopy(payload, 0, target, offset, payload.length);
    return payload.length;
}
```

Trade-off:

```text
byte[] copy       -> simple, safe, potentially expensive
read-only view    -> less copy, caller must understand view semantics
writer callback   -> good for streaming, API less flexible
owned buffer      -> efficient, needs ownership discipline
```

---

## 4. Streaming vs Materialization

### 4.1 Materialization Is Not Evil

Materialization baik ketika:

- result kecil;
- data perlu random access;
- data dipakai berkali-kali;
- lifetime jelas pendek;
- simplicity lebih penting;
- transaction/resource harus segera ditutup;
- downstream API memang membutuhkan full collection.

Contoh sehat:

```java
List<CountryCode> countries = countryRepository.findAllActiveCountries();
```

Jika jumlah country stabil kecil, materialisasi tidak masalah.

---

### 4.2 Materialization Berbahaya Ketika Cardinality Tidak Terkontrol

Contoh:

```java
List<AuditTrail> findAuditTrails(LocalDate from, LocalDate to);
```

Ini berbahaya jika `from-to` bisa menghasilkan jutaan row.

Lebih baik:

```java
void exportAuditTrails(AuditTrailFilter filter, AuditTrailSink sink);
```

Dengan sink:

```java
interface AuditTrailSink {
    void onRecord(AuditTrailView record) throws IOException;
}
```

Atau cursor:

```java
interface AuditTrailCursor extends AutoCloseable {
    boolean next();
    AuditTrailView current();
}
```

Cursor memberi kontrol lifecycle yang eksplisit.

---

### 4.3 `Stream<T>` Bukan Selalu Jawaban

Java `Stream<T>` ekspresif, tapi ada jebakan:

```java
try (Stream<Row> rows = repository.streamRows()) {
    return rows.map(mapper::toDto).toList();
}
```

Ini tetap materialisasi penuh.

Jebakan lain:

```java
Stream<Row> rows = repository.streamRows();
return rows;
```

Jika stream bergantung pada database connection, caller sekarang memegang resource lifecycle. Ini mudah bocor.

Untuk boundary service/domain, kadang lebih jelas memakai callback/cursor daripada mengembalikan `Stream`.

Rule:

```text
Return Stream hanya jika caller jelas bertanggung jawab menutupnya,
dan dokumentasi/API contract memaksa lifecycle yang benar.
```

---

## 5. Bounded Buffers and Backpressure

### 5.1 Buffer Adalah Debt, Bukan Solusi Gratis

Buffer sering dipakai untuk menyerap perbedaan kecepatan.

```text
producer -> buffer -> consumer
```

Jika producer temporary lebih cepat, buffer membantu. Jika consumer secara permanen lebih lambat, buffer hanya menunda kegagalan sambil mengubah latency problem menjadi memory problem.

Unbounded buffer berarti:

```text
Saya memilih heap sebagai tempat menyimpan kegagalan flow control.
```

---

### 5.2 Bounded Queue Pattern

Contoh:

```java
public final class BoundedDispatcher<T> implements AutoCloseable {
    private final BlockingQueue<T> queue;
    private final ExecutorService workers;
    private volatile boolean closed;

    public BoundedDispatcher(int capacity, int workerCount, Consumer<T> handler) {
        this.queue = new ArrayBlockingQueue<>(capacity);
        this.workers = Executors.newFixedThreadPool(workerCount);

        for (int i = 0; i < workerCount; i++) {
            workers.submit(() -> {
                while (!closed || !queue.isEmpty()) {
                    T item = queue.poll(100, TimeUnit.MILLISECONDS);
                    if (item != null) {
                        handler.accept(item);
                    }
                }
            });
        }
    }

    public boolean trySubmit(T item) {
        if (closed) {
            return false;
        }
        return queue.offer(item);
    }

    @Override
    public void close() {
        closed = true;
        workers.shutdown();
    }
}
```

Catatan:

- `offer` tidak memblokir selamanya;
- caller bisa menerapkan rejection/backoff;
- queue capacity adalah memory budget;
- metric `queue.size()` wajib dimonitor;
- item size harus dipahami.

---

### 5.3 Capacity Harus Dihitung, Bukan Ditebak

Formula kasar:

```text
queue_memory = capacity × average_item_retained_size
```

Jika item rata-rata 20 KB dan capacity 10.000:

```text
10.000 × 20 KB = 200 MB retained heap
```

Jika setiap item juga membawa object graph tambahan, retained size bisa jauh lebih besar dari shallow size.

Checklist capacity:

```text
Berapa average retained size per item?
Berapa worst-case retained size?
Berapa producer rate?
Berapa consumer rate?
Berapa durasi burst yang ingin diserap?
Berapa memory budget queue?
Apa rejection strategy?
Apa metric dan alert-nya?
```

---

## 6. Object Pooling: Kapan Buruk, Kapan Masuk Akal

### 6.1 Object Pooling Sering Buruk di Java Modern

Banyak engineer datang dari dunia manual memory management dan mencoba mengurangi GC dengan pooling semua object.

Contoh:

```java
OrderDto dto = pool.borrow();
try {
    dto.reset(...);
    process(dto);
} finally {
    pool.release(dto);
}
```

Masalah:

- object pool membuat object lebih long-lived;
- long-lived object masuk old generation;
- reset bug bisa menyebabkan data leakage;
- ownership menjadi kompleks;
- pool contention;
- pool bisa menjadi memory leak;
- object yang seharusnya mati muda malah bertahan lama;
- escape analysis/scalar replacement bisa gagal karena object dipaksa escape.

Untuk object kecil short-lived, allocation normal sering lebih baik.

Mental model:

```text
Young-generation allocation murah.
Pooling object kecil sering mengubah cheap garbage menjadi expensive retained state.
```

---

### 6.2 Pooling Masuk Akal untuk Resource Mahal

Pooling masuk akal untuk:

- database connection;
- network connection;
- thread/platform thread dalam konteks tertentu;
- large direct buffer;
- large byte array;
- compression context;
- encryption context tertentu;
- parser object yang mahal jika allocation/init tinggi;
- object native/off-heap yang mahal dibuat.

Kriteria pooling sehat:

```text
Object mahal dibuat.
Object cukup besar.
Object lifecycle jelas.
Object bisa direset secara aman.
Pool bounded.
Borrow/release selalu deterministic.
Leak detection ada.
Metric ada.
Contention acceptable.
```

---

### 6.3 Pooling Harus Punya Ownership Contract

Contoh buffer pool sederhana:

```java
public interface BufferLease extends AutoCloseable {
    ByteBuffer buffer();

    @Override
    void close();
}
```

Pemakaian:

```java
try (BufferLease lease = pool.acquire()) {
    ByteBuffer buffer = lease.buffer();
    buffer.clear();
    encodeMessage(message, buffer);
    buffer.flip();
    channel.write(buffer);
}
```

Prinsip:

```text
Borrowed object harus dikembalikan secara deterministic.
try-with-resources membuat ownership terlihat.
```

Jangan:

```java
ByteBuffer b = pool.acquire();
// lupa release
```

Lebih baik API memaksa lease.

---

## 7. Buffer Pooling and Byte Ownership

### 7.1 Heap `byte[]` vs Heap `ByteBuffer` vs Direct `ByteBuffer`

Keputusan buffer:

| Pilihan | Cocok Untuk | Risiko |
|---|---|---|
| `byte[]` | data kecil, CPU processing, mudah dicopy | copy besar, heap pressure |
| Heap `ByteBuffer` | API NIO-like, parsing binary di heap | masih heap-backed |
| Direct `ByteBuffer` | native I/O besar/long-lived | cleanup delayed, native memory pressure |
| `MappedByteBuffer` | file besar/random access | unmap/lifecycle/page-cache complexity |
| `MemorySegment` | off-heap modern, structured native memory | Java 22+, lifecycle harus eksplisit |

Dokumentasi `ByteBuffer` Java SE 25 sendiri menyarankan direct buffer terutama untuk buffer besar/long-lived yang terkena native I/O dan hanya ketika memberi measurable performance gain.

---

### 7.2 Avoid Buffer Sharing Without Slice Discipline

Buruk:

```java
void parse(ByteBuffer buffer) {
    headerParser.parse(buffer);
    bodyParser.parse(buffer);
}
```

Jika parser mengubah `position`, urutan dan bug sulit dilacak.

Lebih jelas:

```java
ByteBuffer header = buffer.slice(headerOffset, headerLength).asReadOnlyBuffer();
ByteBuffer body = buffer.slice(bodyOffset, bodyLength).asReadOnlyBuffer();

headerParser.parse(header);
bodyParser.parse(body);
```

Keuntungan:

- batas jelas;
- parser tidak bisa membaca di luar segment;
- posisi parent tidak berubah;
- ownership lebih aman.

---

### 7.3 Do Not Store Pooled Buffer in Domain Object

Buruk:

```java
class Message {
    private final ByteBuffer pooledBuffer;
}
```

Jika `Message` masuk queue/cache/logging pipeline, buffer lease bisa tertahan lama. Pool habis meskipun heap terlihat normal.

Lebih sehat:

```text
Pooled buffer hanya hidup di boundary I/O atau codec.
Domain object menyimpan value yang sudah diparse atau immutable copy kecil.
```

Rule:

```text
Pooled buffer adalah transport concern, bukan domain state.
```

---

## 8. Immutable Object Trade-Off

Immutability membantu:

- thread safety;
- reasoning;
- safe publication;
- cache safety;
- no aliasing mutation;
- easier debugging.

Tetapi immutability bisa meningkatkan allocation jika setiap perubahan membuat object baru.

Contoh:

```java
Order updated = order.withStatus(APPROVED).withApprovedAt(now).withApprover(userId);
```

Jika `Order` besar, chaining bisa membuat banyak object.

Solusi:

```text
Gunakan immutable untuk boundary/domain state.
Gunakan mutable builder untuk construction internal.
Gunakan mutable accumulator untuk hot aggregation.
Gunakan persistent data structure hanya jika manfaatnya nyata.
```

Pattern:

```java
Order order = Order.builder()
    .id(id)
    .status(APPROVED)
    .approvedAt(now)
    .approver(userId)
    .build();
```

Builder mutable hidup sebentar. Object final immutable hidup sesuai domain.

---

## 9. DTO Explosion and Mapping Cost

### 9.1 DTO Layering Bisa Menggandakan Memory

Contoh flow umum:

```text
DB row
 -> Entity
 -> Domain object
 -> Service DTO
 -> REST DTO
 -> JSON tree
 -> String/byte[] response
```

Setiap tahap bisa membuat object graph baru.

Kadang layering memang dibutuhkan untuk separation of concerns. Tetapi untuk data besar, full materialization antar layer sangat mahal.

Memory-aware alternative:

```text
DB cursor
 -> projection record
 -> streaming JSON writer
 -> output stream
```

Atau:

```text
Entity hanya untuk transactional mutation.
Read-heavy listing memakai projection tipis.
Export memakai streaming projection.
```

---

### 9.2 Projection Over Full Object

Buruk:

```java
List<User> users = userRepository.findAll();
return users.stream()
    .map(user -> new UserListItem(user.id(), user.name(), user.status()))
    .toList();
```

Jika `User` membawa banyak field/relations, memory boros.

Lebih baik:

```java
List<UserListItem> users = userRepository.findListItems(criteria, limit);
```

Prinsip:

```text
Ambil bentuk data yang sesuai use case, bukan object terbesar lalu dipotong.
```

---

## 10. JSON/XML/Serialization Memory Costs

### 10.1 Tree Model vs Streaming Model

Tree model:

```java
JsonNode node = objectMapper.readTree(input);
```

Kelebihan:

- fleksibel;
- random access;
- mudah transformasi.

Kekurangan:

- seluruh payload dimaterialisasi;
- object graph besar;
- string field/key/value bisa banyak;
- tidak cocok untuk payload besar tanpa limit.

Streaming model:

```java
JsonParser parser = objectMapper.getFactory().createParser(input);
while (parser.nextToken() != null) {
    ...
}
```

Kelebihan:

- memory bounded;
- cocok payload besar;
- bisa early reject.

Kekurangan:

- code lebih kompleks;
- state machine manual;
- error handling harus rapi.

Rule:

```text
Gunakan tree/object mapping untuk payload kecil-menengah yang bounded.
Gunakan streaming parser/writer untuk export/import besar.
```

---

### 10.2 Beware Logging Payloads

Buruk:

```java
log.info("Request payload: {}", objectMapper.writeValueAsString(request));
```

Masalah:

- serialisasi tambahan;
- `String` besar;
- PII/security risk;
- log pipeline pressure;
- duplicate memory: object + JSON string + encoder buffer.

Lebih baik:

```java
log.info("Request received: type={}, id={}, itemCount={}",
    request.type(), request.id(), request.items().size());
```

Untuk debugging, pakai controlled sampling, redaction, size limit, dan environment guard.

---

## 11. Cache Design Is Memory Design

### 11.1 Cache Tanpa Budget Adalah Leak yang Dilegalkan

Buruk:

```java
private final Map<Key, Value> cache = new ConcurrentHashMap<>();
```

Jika tidak ada eviction, TTL, max size, atau invalidation, ini bukan cache. Ini growing retention root.

Cache sehat punya:

```text
max entries atau max weight
TTL/TTI jika relevan
eviction policy
negative caching policy
refresh policy
invalidation path
per-tenant fairness
metrics
backpressure on miss storm
```

---

### 11.2 Entry Count Tidak Sama dengan Memory Size

`maximumSize(10_000)` bisa aman atau berbahaya tergantung value size.

Jika value rata-rata 2 KB:

```text
10.000 × 2 KB = 20 MB + overhead
```

Jika value rata-rata 500 KB:

```text
10.000 × 500 KB = 5 GB + overhead
```

Karena itu untuk value variatif, gunakan weight-based cache jika tersedia.

Pseudo:

```java
record CachedDocument(String id, byte[] compressedPayload) {
    int weight() {
        return 64 + compressedPayload.length;
    }
}
```

Prinsip:

```text
Cache capacity harus merepresentasikan memory budget, bukan angka entry acak.
```

---

### 11.3 Negative Cache Juga Harus Bounded

Negative cache menyimpan hasil “tidak ditemukan” agar tidak memukul backend terus-menerus.

Buruk:

```java
notFoundKeys.add(key);
```

Jika attacker/user mengirim key unik terus-menerus, negative cache tumbuh tanpa batas.

Lebih baik:

```text
bounded negative cache + short TTL + rate limit + per-tenant cap
```

---

### 11.4 Cache Stampede and In-Flight Dedup

Memory problem bisa muncul saat cache miss storm.

Tanpa dedup:

```text
1000 request untuk key sama
 -> 1000 backend calls
 -> 1000 response objects
 -> 1000 serialization buffers
 -> heap spike
```

Dengan in-flight dedup:

```text
1000 request untuk key sama
 -> 1 backend call
 -> 999 await same future
```

Pattern sederhana:

```java
private final ConcurrentHashMap<Key, CompletableFuture<Value>> inFlight = new ConcurrentHashMap<>();

public CompletableFuture<Value> get(Key key) {
    Value cached = cache.getIfPresent(key);
    if (cached != null) {
        return CompletableFuture.completedFuture(cached);
    }

    return inFlight.computeIfAbsent(key, k ->
        loadAsync(k).whenComplete((value, error) -> {
            inFlight.remove(k);
            if (error == null) {
                cache.put(k, value);
            }
        })
    );
}
```

Caveat:

- `inFlight` juga harus dipantau;
- timeout harus ada;
- exceptional future harus dibersihkan;
- per-key/per-tenant pressure harus dibatasi.

---

## 12. Pagination, Cursor, and Result Window Design

### 12.1 Offset Pagination Bisa Mahal

API:

```http
GET /orders?page=10000&size=100
```

Dengan offset pagination, database mungkin harus scan/skip banyak row. Dari sisi Java, user bisa meminta page besar atau page jauh yang menyebabkan:

- query lama;
- connection tertahan;
- timeout;
- retry;
- queue backlog;
- memory spike jika result besar.

Memory-aware API:

```http
GET /orders?cursor=...&limit=100
```

Cursor/keyset pagination lebih stabil untuk large dataset.

---

### 12.2 Limit Harus Hard-Enforced

Buruk:

```java
int limit = request.limit();
```

Lebih sehat:

```java
int limit = Math.min(Math.max(request.limit(), 1), MAX_PAGE_SIZE);
```

Atau reject:

```java
if (request.limit() > MAX_PAGE_SIZE) {
    throw new BadRequestException("limit exceeds maximum " + MAX_PAGE_SIZE);
}
```

Prinsip:

```text
Client-provided cardinality is untrusted input.
```

---

## 13. Memory Budget per Request

Top engineer tidak hanya berpikir “heap service 4 GB”, tetapi juga:

```text
Berapa memory budget per request?
Berapa concurrent request maksimum?
Berapa temporary allocation per request?
Berapa retained memory jika request menunggu downstream?
```

Formula kasar:

```text
safe_concurrency ≈ available_request_memory / worst_case_memory_per_request
```

Jika heap efektif untuk request transient sekitar 1 GB, dan worst-case request bisa menahan 20 MB:

```text
1 GB / 20 MB ≈ 50 concurrent heavy requests
```

Jika service mengizinkan 500 concurrent heavy requests, GC tuning tidak akan menyelamatkan desain tersebut.

---

### 13.1 Request Memory Budget Checklist

Untuk endpoint besar, definisikan:

```text
max request body size
max parsed object count
max page size
max export rows per job/window
max upload part size
max in-flight downstream calls
max retry backlog
max response buffer size
max server-side aggregation keys
max per-tenant concurrency
```

Contoh:

```text
Endpoint: POST /bulk-approval
max payload: 5 MB
max items: 5.000
max per item validation errors retained: 3
max concurrent bulk jobs per tenant: 2
processing mode: streaming validation + chunked persistence
response mode: summary + downloadable error report
```

Ini jauh lebih aman daripada menerima payload besar lalu membangun `List<ApprovalItem>` lengkap plus `List<ValidationError>` lengkap plus response lengkap.

---

## 14. Memory Budget per Tenant/User/Key

Dalam multi-tenant system, global limit saja tidak cukup.

Buruk:

```text
global queue capacity = 100.000
```

Jika satu tenant mengisi 99.000 item, tenant lain ikut terdampak.

Lebih sehat:

```text
global queue capacity = 100.000
per-tenant capacity = 5.000
per-user capacity = 500
per-key in-flight dedup = 1
```

Memory-aware fairness:

```text
Bound global pressure.
Bound tenant pressure.
Bound user pressure.
Bound hot-key pressure.
```

---

## 15. Failure Containment Patterns

Memory-aware design bukan hanya membuat memory rendah, tetapi membatasi blast radius saat ada input buruk atau downstream lambat.

### 15.1 Reject Early

Jika payload terlalu besar, reject sebelum parsing penuh.

```text
Content-Length check
streaming size counter
max JSON depth
max array length
max string length
max multipart size
```

### 15.2 Degrade Gracefully

Contoh:

```text
Jika cache penuh -> evict/reject low-priority item.
Jika export terlalu besar -> jadwalkan async job.
Jika result terlalu banyak -> minta filter lebih spesifik.
Jika downstream lambat -> trip circuit/bulkhead.
Jika tenant melewati quota -> throttle tenant tersebut.
```

### 15.3 Avoid Retrying with Full Payload Retention

Buruk:

```java
retryQueue.add(new RetryTask(requestPayloadBytes, headers, context));
```

Jika payload besar dan retry menumpuk, heap penuh.

Alternatif:

```text
Persist payload externally with bounded retention.
Queue stores reference/id only.
Compress large payload if appropriate.
Apply TTL and max retry count.
Use DLQ for exhausted retry.
```

---

## 16. Designing Low-Allocation Hot Paths

### 16.1 Identify Hot Path First

Jangan membuat seluruh codebase low-level. Cari hot path:

- endpoint traffic tinggi;
- serialization/deserialization;
- validation loop;
- matching/scoring loop;
- metrics/logging path;
- codec;
- queue dispatcher;
- cache lookup;
- aggregation;
- auth token parsing;
- ID conversion;
- binary protocol parsing.

Gunakan observability:

```text
JFR allocation profile
GC allocation rate
async-profiler allocation mode
heap histogram delta
benchmark dengan JMH untuk micro-path
```

---

### 16.2 Common Low-Allocation Techniques

Teknik:

```text
Use primitive where meaningful.
Avoid repeated String conversion.
Reuse formatter carefully if thread-safe or scoped.
Use StringBuilder for local construction.
Pre-size collections when cardinality known.
Prefer arrays for fixed-size internal data.
Avoid regex in hot loops unless precompiled and justified.
Avoid Stream API in extremely hot loops if allocation appears.
Use projection instead of full object.
Avoid logging string construction when log disabled.
Avoid collecting when streaming is enough.
```

Contoh pre-size:

```java
List<Result> results = new ArrayList<>(expectedSize);
```

Contoh logging:

```java
if (log.isDebugEnabled()) {
    log.debug("Expanded payload: {}", expensiveToString(payload));
}
```

Namun jangan membuat code buruk demi allocation kecil yang tidak signifikan. Ukur.

---

## 17. API Shape Patterns

### 17.1 Pull Model

```java
T next();
```

Kelebihan:

- caller mengontrol pace;
- natural untuk cursor;
- memory bounded.

Kekurangan:

- resource lifecycle harus eksplisit;
- bisa menahan connection lama.

---

### 17.2 Push Model

```java
void forEach(Consumer<T> consumer);
```

Kelebihan:

- callee mengontrol resource;
- bisa memastikan close;
- cocok untuk export/write-through.

Kekurangan:

- backpressure harus dirancang;
- exception propagation harus jelas.

---

### 17.3 Batch Model

```java
List<T> nextBatch(int maxItems);
```

Kelebihan:

- kompromi antara streaming dan materialization;
- memory bounded per batch;
- cocok untuk DB/network.

Kekurangan:

- batch size harus dipilih;
- partial failure handling lebih kompleks.

---

### 17.4 Sink Model

```java
interface Sink<T> {
    void accept(T item) throws Exception;
}
```

Cocok ketika output langsung ditulis ke:

- file;
- HTTP response;
- message broker;
- compression stream;
- hashing digest;
- external storage.

Prinsip:

```text
Jika data hanya lewat, jangan simpan sebagai collection.
```

---

## 18. Memory-Aware Domain Modeling

### 18.1 Jangan Semua Menjadi Object Kaya

Object-oriented design sering mendorong model seperti:

```java
class Case {
    List<Attachment> attachments;
    List<Comment> comments;
    List<AuditEntry> auditEntries;
    List<Task> tasks;
    List<Assignment> assignments;
}
```

Untuk detail page tertentu, mungkin masuk akal. Untuk listing 10.000 case, sangat mahal.

Gunakan shape berbeda:

```java
record CaseListItem(
    long id,
    String referenceNo,
    CaseStatus status,
    Instant updatedAt
) {}
```

```java
record CaseDetail(
    CaseHeader header,
    List<TaskSummary> tasks,
    List<AttachmentSummary> attachments
) {}
```

```java
record CaseExportRow(
    String referenceNo,
    String status,
    String owner,
    String updatedAt
) {}
```

Prinsip:

```text
Satu aggregate domain bukan berarti satu shape memory untuk semua use case.
```

---

### 18.2 Split Hot and Cold Fields

Jika object sering diproses di loop, pisahkan field yang sering dibaca dari field besar/jarang dipakai.

Buruk:

```java
class RuleCandidate {
    long id;
    int score;
    boolean active;
    String description;
    String fullJsonConfig;
    byte[] attachmentPreview;
}
```

Untuk scoring, hanya `id`, `score`, `active` yang hot. Field lain memperbesar footprint dan memperburuk locality.

Lebih baik:

```java
record RuleCandidateHot(long id, int score, boolean active) {}
record RuleCandidateCold(long id, String description, String fullJsonConfig, byte[] attachmentPreview) {}
```

Atau lazy load cold fields.

---

## 19. Avoiding Accidental Retention

### 19.1 Lambda Capture Leak

```java
byte[] largePayload = readPayload();
executor.submit(() -> process(id, largePayload));
```

Jika executor queue penuh/lambat, `largePayload` tertahan.

Lebih baik:

```java
PayloadRef ref = payloadStore.save(largePayload);
executor.submit(() -> process(id, ref));
```

Atau enforce bounded executor queue.

---

### 19.2 ThreadLocal Leak

```java
private static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();

void handle(Request request) {
    CTX.set(buildContext(request));
    process(request);
}
```

Jika tidak `remove`, context bisa tertahan selama thread pool hidup.

Benar:

```java
void handle(Request request) {
    CTX.set(buildContext(request));
    try {
        process(request);
    } finally {
        CTX.remove();
    }
}
```

Lebih baik lagi: hindari `ThreadLocal` untuk data besar.

---

### 19.3 Metrics Label Cardinality

```java
counter.labels(userId, requestId, errorMessage).inc();
```

Ini bisa membuat memory naik di metrics registry karena label cardinality tidak bounded.

Gunakan label bounded:

```java
counter.labels(endpoint, statusClass, errorCode).inc();
```

Memory-aware observability juga penting. Monitoring system bisa menjadi retention root.

---

## 20. Decision Matrix: Common API Choices

| Problem | Default Simple Design | Memory-Aware Design |
|---|---|---|
| Search result | `List<T>` | page/cursor/stream with max limit |
| Export | build full CSV string | stream rows to writer/output stream |
| Upload | read all bytes | size limit + chunk/stream + temp storage |
| Cache | `ConcurrentHashMap` | bounded cache with weight/TTL/metrics |
| Retry | queue full payload | queue reference/id + bounded retention |
| Async processing | unbounded executor queue | bounded queue + rejection/backpressure |
| Binary payload | copy `byte[]` everywhere | view/slice/ownership contract |
| Hot counter | `Map<K, Integer>` | primitive/specialized counter where justified |
| JSON large payload | `JsonNode` tree | streaming parser/writer |
| Multi-tenant load | global limit only | global + per-tenant + per-user limits |
| Large resource | GC cleanup | `AutoCloseable` deterministic lifecycle |
| Native/off-heap memory | Cleaner only | explicit close/Arena/lease pattern |

---

## 21. Practical Review Checklist

Saat review desain API/service, tanya:

```text
1. Apa cardinality maksimum input dan output?
2. Apakah limit hard-enforced?
3. Apakah API memaksa materialisasi penuh?
4. Apakah object besar bisa tertahan di cache/session/queue?
5. Apakah buffer ownership jelas?
6. Apakah cleanup deterministic untuk resource native/off-heap/file/socket?
7. Apakah queue/cache/pool bounded?
8. Apakah ada per-tenant/per-user fairness?
9. Apakah retry menyimpan payload besar?
10. Apakah logging/metrics bisa menciptakan object/cardinality besar?
11. Apakah DTO mapping menggandakan object graph?
12. Apakah hot path punya allocation profile?
13. Apakah direct/off-heap memory masuk budget RSS/container?
14. Apakah worst-case request memory sudah dihitung?
15. Apakah failure mode berubah menjadi memory accumulation?
```

Jika jawaban banyak yang “belum tahu”, desain tersebut belum memory-aware.

---

## 22. Case Study 1: Export Audit Trail

### 22.1 Desain Awal

```java
List<AuditTrail> rows = auditRepository.findByRange(from, to);
String csv = csvExporter.export(rows);
return ResponseEntity.ok(csv);
```

Masalah:

```text
DB result dimaterialisasi penuh.
Domain object banyak.
CSV String besar.
HTTP response mungkin membuat byte[] tambahan.
Jika range besar, heap spike.
Jika user paralel, GC pressure tinggi.
```

### 22.2 Desain Memory-Aware

```java
@GetMapping("/audit/export")
public void export(AuditFilter filter, HttpServletResponse response) throws IOException {
    enforceDateRangeLimit(filter);
    enforcePermission(filter);

    response.setContentType("text/csv");
    response.setHeader("Content-Disposition", "attachment; filename=audit.csv");

    try (Writer writer = response.getWriter()) {
        auditRepository.streamProjectedRows(filter, row -> {
            csvWriter.writeRow(writer, row);
        });
    }
}
```

Improvements:

```text
Projection tipis.
Tidak membuat List besar.
Tidak membuat CSV String penuh.
Memory bounded oleh row/current buffer.
Range dibatasi.
```

Tambahan untuk production:

```text
max date range
max export rows atau async export untuk besar
rate limit per user
server-side timeout
streaming DB fetch size
no long transaction if avoidable
audit/log summary only
```

---

## 23. Case Study 2: Bulk Validation

### 23.1 Desain Awal

```java
BulkRequest request = objectMapper.readValue(body, BulkRequest.class);
List<ValidationError> errors = new ArrayList<>();

for (Item item : request.items()) {
    errors.addAll(validate(item));
}

return new BulkResponse(errors);
```

Masalah:

- payload penuh jadi object;
- semua item hidup sekaligus;
- semua error hidup sekaligus;
- response bisa lebih besar dari request;
- satu request bisa menguasai heap.

### 23.2 Desain Lebih Aman

```text
max payload size
max item count
streaming parse
validate item per item
store detailed errors externally if large
return summary + error report id
```

Response:

```json
{
  "accepted": 4920,
  "rejected": 80,
  "errorReportId": "..."
}
```

Prinsip:

```text
Jangan mengembalikan error detail tak terbatas dalam response synchronous.
```

---

## 24. Case Study 3: Cache with Large Values

### 24.1 Desain Awal

```java
Map<String, UserDocument> cache = new ConcurrentHashMap<>();
```

`UserDocument` membawa:

```text
metadata
full JSON
parsed object tree
rendered HTML
thumbnail bytes
```

Masalah:

- no bound;
- duplicated representation;
- value besar;
- old-gen retention;
- GC pause naik;
- heap dump menunjukkan cache sebagai dominator.

### 24.2 Desain Memory-Aware

```text
Cache key: document id + version
Cache value: compressed canonical bytes atau small projection
Max weight: berdasarkan byte size
TTL: sesuai freshness
Per-tenant cap
Avoid storing parsed + raw + rendered together kecuali perlu
Use external object storage for large payload
Metrics: hit rate, eviction, weight, load time, miss storm
```

Prinsip:

```text
Cache value harus dipilih sebagai representation yang paling hemat dan paling sesuai access pattern.
```

---

## 25. Case Study 4: Async Event Dispatcher

### 25.1 Desain Awal

```java
ExecutorService executor = Executors.newFixedThreadPool(8);

void publish(Event event) {
    executor.submit(() -> send(event));
}
```

`newFixedThreadPool` memakai unbounded queue di banyak implementasi factory umum. Jika downstream lambat, task menumpuk.

### 25.2 Desain Memory-Aware

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    8,
    8,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(10_000),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Atau reject:

```java
new ThreadPoolExecutor.AbortPolicy()
```

Pilihan policy:

| Policy | Efek |
|---|---|
| caller-runs | memberi backpressure ke producer |
| abort | fail fast, caller handle retry |
| discard | bahaya jika event penting |
| discard-oldest | bahaya jika ordering/semantics penting |

Memory-aware design harus menyatukan:

```text
queue capacity
retry semantics
event durability
ordering guarantee
idempotency
metrics
DLQ
```

---

## 26. Design Heuristics by Workload Type

### 26.1 REST CRUD Service

Biasanya sehat dengan:

```text
bounded request size
bounded page size
projection for listing
no full export sync for huge data
small DTOs
cache with max weight/TTL
G1 default often fine
JFR allocation profiling for hot endpoints
```

### 26.2 High-Throughput Gateway

Fokus:

```text
buffer ownership
copy minimization
bounded in-flight requests
direct buffer only when measured
avoid logging payload
backpressure
small object graph per request
latency tail monitoring
```

### 26.3 Batch Processor

Fokus:

```text
chunking
bounded batch size
streaming input/output
checkpointing
avoid retaining all errors/results
separate hot accumulator from cold details
Parallel GC/G1/ZGC depending workload
```

### 26.4 Data Export/Report Service

Fokus:

```text
async job for large export
streaming writer
external temporary storage
range limit
projection query
avoid giant StringBuilder
response by file reference
```

### 26.5 Cache-Heavy Service

Fokus:

```text
weight-based cache
per-tenant cap
value representation
compression trade-off
refresh storm control
in-flight dedup
old-gen after-GC monitoring
```

---

## 27. Java 8–25 Design Considerations

### Java 8

- No finalized FFM API.
- `Unsafe` and direct buffer tricks are more common in old libraries.
- CMS may exist in legacy production.
- GC logging syntax differs from unified logging.
- Use `try-with-resources`, bounded queues, careful direct buffer pooling.

### Java 11/17

- G1 common default in server workloads.
- ZGC/Shenandoah availability depends on version/distribution and maturity.
- JFR is production-usable and valuable for allocation profiling.
- Cleaner exists as finalizer alternative, but deterministic close remains preferred.

### Java 21

- Virtual threads can increase concurrency shape; memory budgets per request become even more important.
- Do not confuse cheap virtual threads with unlimited memory for blocked request state.
- Structured concurrency may help lifecycle in newer code, depending preview/final status by version.

### Java 22+

- FFM API finalized.
- `MemorySegment`/`Arena` become serious alternatives for explicit off-heap memory.

### Java 24/25

- ZGC generational mode is the modern path.
- Unsafe memory-access migration becomes more urgent due to deprecation/warning direction.
- Generational Shenandoah exists in JDK 25 as product feature.
- Memory-aware design should avoid relying on internal APIs when standard APIs exist.

---

## 28. Anti-Patterns Summary

```text
Unbounded ConcurrentHashMap used as cache.
Unbounded executor queue.
Returning List for unbounded query.
Building giant String/byte[] response.
Pooling small DTOs.
Holding pooled buffer inside domain object.
Storing request payload in retry queue.
Logging full payload by default.
Metrics labels with userId/requestId/errorMessage.
ThreadLocal without remove.
Session storing transient data.
Cache storing raw + parsed + rendered representation together.
Stream returned without clear close ownership.
Direct buffer allocated per request.
Cleaner used as primary resource lifecycle.
Limit accepted from client without max cap.
No per-tenant memory fairness.
```

---

## 29. Positive Patterns Summary

```text
Hard cardinality limits.
Pagination/cursor for large result.
Streaming writer for export.
Projection-specific read models.
Bounded queue with backpressure/rejection.
Bounded cache with weight/TTL/metrics.
In-flight dedup for cache miss storm.
try-with-resources lease for pooled/native resource.
Short-lived builder + immutable result.
Hot/cold data split.
Per-request memory budget.
Per-tenant fairness.
Payload size guard before parsing.
Chunked processing for bulk jobs.
External storage for large retry/export payload.
Allocation profiling before low-level optimization.
Explicit ownership contract for buffers.
```

---

## 30. Final Mental Model

Memory-aware system design is the discipline of controlling four things:

```text
1. How much data enters the process.
2. How many object representations are created.
3. How long those objects remain reachable.
4. Where memory is charged: heap, direct/native, mapped/page cache, thread stack, metaspace, code cache, or external storage.
```

GC can reclaim unreachable heap objects. GC cannot fix:

```text
unbounded queues,
unbounded caches,
unbounded result sets,
unclear ownership,
wrong lifecycle,
large objects retained by long-lived roots,
native memory without deterministic close,
container RSS budget mistakes,
or APIs that force materialization.
```

The strongest Java memory engineers do not start with JVM flags. They start with shape, cardinality, ownership, lifetime, and budget.

---

## 31. Mini Checklist for Code Review

Use this as a compact review tool:

```text
[ ] Does this API expose or hide cardinality?
[ ] Is there a hard maximum for input/output size?
[ ] Does the design materialize data that could be streamed?
[ ] Are queue/cache/pool capacities explicit?
[ ] Is memory budget estimated from retained size, not entry count only?
[ ] Is ownership of buffers/resources explicit?
[ ] Are large resources closed deterministically?
[ ] Could one tenant/user/key consume most memory?
[ ] Could retry/backlog/logging/metrics retain unbounded data?
[ ] Are large object graphs attached to long-lived roots?
[ ] Is object pooling justified by measurement and lifecycle?
[ ] Is direct/off-heap memory included in RSS/container budget?
[ ] Is allocation profile measured for hot paths?
[ ] Is the failure mode fail-fast/backpressure instead of heap growth?
```

---

## 32. References

Primary references used for this part:

1. Oracle Java SE 25 HotSpot Virtual Machine Garbage Collection Tuning Guide  
   https://docs.oracle.com/en/java/javase/25/gctuning/index.html

2. Oracle Java SE 25 Introduction to Garbage Collection Tuning  
   https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html

3. Java SE 25 `ByteBuffer` API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html

4. JEP 454 — Foreign Function & Memory API  
   https://openjdk.org/jeps/454

5. Java SE 25 `Cleaner` API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/Cleaner.html

6. Java SE 25 `java.lang.foreign` API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html

7. Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools  
   https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html

---

## 33. Status Seri

```text
Part 029 selesai.
Seri belum selesai.
Masih lanjut ke part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-030.md
```

Topik berikutnya:

```text
Final Integration: Production Playbook, Case Studies, and Decision Matrix
```
