# learn-java-memory-byte-bit-buffer-offheap-gc-part-007

# Object Lifetime Engineering: Young, Middle-Lived, Long-Lived Objects

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `007`  
> Topik: Object lifetime engineering, generational hypothesis, allocation pressure, promotion, survivor behavior, retained garbage, dan desain umur object di sistem Java produksi.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas bahwa allocation object Java sering kali sangat cepat karena banyak allocation dapat dilakukan melalui **bump pointer** di dalam **TLAB**. Itu menjelaskan kenapa membuat object baru di Java tidak otomatis buruk.

Namun pertanyaan penting berikutnya bukan lagi:

> “Apakah allocation cepat?”

Pertanyaan yang lebih penting adalah:

> “Berapa lama object itu hidup, siapa yang menahannya, dan berapa banyak biaya yang ditimbulkan selama ia hidup?”

Di Java, object yang lahir cepat tetapi mati cepat biasanya murah. Object yang hidup lama bisa juga murah jika memang benar-benar state jangka panjang yang stabil. Yang sering berbahaya adalah object yang hidup “cukup lama untuk mengganggu GC”, tetapi tidak cukup penting untuk benar-benar menjadi state jangka panjang. Inilah kelas masalah yang sering disebut **middle-lived object problem**.

Bagian ini membangun mental model untuk melihat aplikasi Java sebagai sistem aliran object:

```text
allocation site
  -> object lifetime
  -> reference graph
  -> GC generation / region
  -> promotion / evacuation / marking cost
  -> pause / CPU / memory pressure
  -> production symptom
```

Kita tidak akan mengulang detail algoritma GC tertentu secara penuh. G1, ZGC, Shenandoah, dan collector lain akan dibahas di bagian khusus. Di sini fokusnya adalah **engineering umur object**: bagaimana mendesain kode dan arsitektur supaya object memiliki lifetime yang jelas, bounded, mudah diprediksi, dan tidak merusak performa GC.

---

## 1. Inti Mental Model

Java memory management bukan hanya soal “GC akan membersihkan object yang tidak dipakai”. Itu benar secara konsep, tetapi terlalu dangkal untuk produksi.

Mental model yang lebih akurat:

```text
GC tidak membersihkan object yang tidak kamu butuhkan.
GC membersihkan object yang tidak lagi reachable dari GC roots.
```

Perbedaannya besar.

Object yang secara business logic sudah “tidak dibutuhkan” tetap akan hidup jika masih ada reference dari:

- static field,
- cache,
- queue,
- map,
- listener,
- thread local,
- lambda capture,
- executor task,
- session,
- persistence context,
- classloader,
- metric registry,
- reactive pipeline,
- object graph besar yang masih tersambung ke satu root kecil.

Jadi, GC tidak tahu niat domain kita. GC hanya tahu graph reachability.

```text
Business lifetime != GC lifetime
```

**Business lifetime** adalah kapan object seharusnya tidak lagi berguna.  
**GC lifetime** adalah kapan object tidak lagi reachable.

Engineering yang baik berusaha membuat keduanya sedekat mungkin.

---

## 2. Tiga Pertanyaan Fundamental untuk Setiap Object

Untuk setiap object penting, terutama object yang dibuat dalam volume besar, tanyakan tiga hal:

### 2.1 Siapa yang membuat object ini?

Ini adalah **allocation site**.

Contoh:

```java
var dto = new ApplicationDto(...);
var row = new HashMap<String, Object>();
var buffer = ByteBuffer.allocateDirect(size);
var payload = objectMapper.readValue(json, Payload.class);
```

Allocation site penting karena di sanalah object lahir. Jika terjadi allocation pressure, allocation site adalah titik investigasi pertama.

### 2.2 Siapa yang menahan object ini?

Ini adalah **retainer**.

Contoh:

```java
static final Map<String, ApplicationDto> CACHE = new ConcurrentHashMap<>();
```

atau:

```java
executor.submit(() -> process(largePayload));
```

Di contoh kedua, `largePayload` mungkin tertahan oleh closure/lambda sampai task selesai dieksekusi.

### 2.3 Kapan object ini seharusnya mati?

Ini adalah **intended lifetime**.

Contoh lifetime:

| Object | Intended Lifetime |
|---|---:|
| local temporary parser token | beberapa nanosecond sampai microsecond |
| request DTO | selama request diproses |
| validation result | selama workflow step |
| cache entry | sampai TTL/eviction |
| tenant configuration | sampai config reload |
| application singleton | selama JVM hidup |
| direct buffer dari pool | selama pool hidup, tapi ownership harus dikembalikan |

Masalah muncul saat intended lifetime pendek, tetapi actual lifetime panjang karena reference tidak dilepas.

---

## 3. Generational Hypothesis: Asumsi Besar di Balik Banyak GC

Banyak GC Java historis dibangun di atas **generational hypothesis**:

> Sebagian besar object mati muda.

Artinya, banyak object hanya dipakai sebentar: object temporary, iterator, lambda object, DTO parsing, wrapper kecil, temporary string, collection intermediate, dan sebagainya.

Jika sebagian besar object mati muda, maka masuk akal membagi heap menjadi area untuk object muda dan object tua. Object muda dikumpulkan lebih sering. Object tua dikumpulkan lebih jarang.

Model sederhana:

```text
new object
  ↓
young area / eden
  ↓ survives young GC
survivor area
  ↓ survives enough cycles
old area
```

Ini bukan detail implementasi semua collector modern secara identik, tetapi mental model generational tetap penting. Bahkan collector modern seperti Generational ZGC dan Generational Shenandoah kembali menekankan nilai pemisahan object muda dan tua.

OpenJDK JEP 439 menjelaskan bahwa Generational ZGC dirancang untuk memisahkan young dan old objects, karena collecting young objects yang cenderung cepat mati dapat mengurangi pekerjaan GC secara keseluruhan dibanding memperlakukan semua object sama. JEP 439 juga membahas konsekuensi teknis seperti old-to-young pointers dan card table/barrier. Referensi: <https://openjdk.org/jeps/439>

---

## 4. Young Object: Object yang Murah Jika Benar-Benar Mati Cepat

Young object adalah object yang dibuat dan mati dalam waktu sangat singkat.

Contoh:

```java
public Money calculateTotal(List<LineItem> items) {
    BigDecimal total = BigDecimal.ZERO;
    for (LineItem item : items) {
        total = total.add(item.price().multiply(BigDecimal.valueOf(item.quantity())));
    }
    return new Money(total);
}
```

Di sini mungkin ada banyak object temporary `BigDecimal`. Apakah selalu buruk? Tidak selalu. Jika object temporary ini tidak escape dan bisa dioptimasi oleh JIT, sebagian allocation mungkin hilang. Jika tidak hilang pun, object yang mati muda sering murah karena cukup dibuang pada young collection.

Contoh lain:

```java
String normalized = input.trim().toLowerCase(Locale.ROOT);
```

Ada temporary string atau internal array tergantung versi dan implementasi. Jika hanya hidup selama request, kemungkinan masuk kategori young.

### 4.1 Ciri young object yang sehat

Young object biasanya sehat jika:

- dibuat dalam jumlah wajar,
- tidak masuk cache/global structure,
- tidak tertahan oleh queue panjang,
- tidak dicapture oleh async callback yang lama,
- tidak menjadi bagian dari graph long-lived,
- mati sebelum atau sekitar young GC berikutnya.

### 4.2 Young object yang tidak sehat

Young object menjadi masalah jika allocation rate terlalu tinggi.

```text
allocation rate terlalu tinggi
  -> young generation cepat penuh
  -> young GC terlalu sering
  -> GC CPU naik
  -> latency tail naik
```

Walaupun object mati muda, membuat terlalu banyak object tetap bisa mahal karena:

- object perlu di-zero-initialize,
- TLAB perlu refill,
- GC perlu scan roots dan remembered sets,
- young GC tetap butuh pause atau coordination,
- CPU cache terganggu,
- memory bandwidth terpakai.

Jadi aturan yang benar bukan:

```text
short-lived object selalu gratis
```

Tetapi:

```text
short-lived object biasanya lebih murah daripada long-lived garbage, selama allocation rate masih masuk budget.
```

---

## 5. Long-Lived Object: Murah Jika Stabil, Mahal Jika Banyak dan Mutable

Long-lived object adalah object yang memang dimaksudkan hidup lama.

Contoh:

- application configuration,
- singleton service,
- compiled regex/cache yang bounded,
- database pool object,
- route table,
- metadata module,
- enum singleton,
- immutable lookup table,
- loaded class metadata,
- shared codec,
- object pool.

Long-lived object tidak otomatis buruk. Banyak aplikasi produksi justru membutuhkan long-lived state.

Yang penting adalah:

```text
Long-lived object sebaiknya bounded, stabil, dan intentional.
```

### 5.1 Long-lived object yang sehat

Contoh:

```java
public final class CountryCodeRegistry {
    private final Map<String, CountryCode> byCode;

    public CountryCodeRegistry(List<CountryCode> codes) {
        this.byCode = Map.copyOf(
            codes.stream().collect(Collectors.toMap(CountryCode::code, Function.identity()))
        );
    }
}
```

Object graph ini hidup lama, tetapi bounded dan immutable. GC dapat memperlakukannya sebagai bagian dari live set stabil.

### 5.2 Long-lived object yang buruk

Contoh:

```java
public final class AuditDebugStore {
    private static final List<String> EVENTS = new ArrayList<>();

    public static void add(String event) {
        EVENTS.add(event);
    }
}
```

Ini bukan long-lived state yang sehat. Ini retained garbage yang tumbuh tanpa batas.

Masalahnya bukan karena `static` selalu buruk. Masalahnya adalah tidak ada batas lifetime dan kapasitas.

---

## 6. Middle-Lived Object: Kelas Masalah yang Sering Merusak Produksi

Middle-lived object adalah object yang tidak mati cukup cepat untuk murah, tetapi juga tidak benar-benar menjadi state jangka panjang yang stabil.

Contoh:

- object request yang tertahan di queue selama beberapa detik/menit,
- batch buffer yang hidup selama satu job besar,
- response aggregation list yang menampung seluruh dataset,
- persistence context terlalu besar,
- cache entry tanpa TTL yang akhirnya bertahan jam/hari,
- CompletableFuture chain yang menahan payload besar,
- reactive stream buffer karena consumer lambat,
- scheduled task backlog,
- temporary map yang dipromote ke old gen sebelum dilepas,
- large byte array yang hidup cukup lama untuk masuk old generation.

Middle-lived object buruk karena mereka sering:

1. survive beberapa young GC,
2. masuk survivor space,
3. dipromote ke old generation,
4. akhirnya mati tidak lama setelah promotion,
5. membuat old generation berisi garbage,
6. memicu marking/mixed/full collection lebih mahal.

Modelnya:

```text
object dibuat
  ↓
tidak mati saat young GC pertama
  ↓
survive lagi
  ↓
promotion ke old
  ↓
baru tidak dibutuhkan
  ↓
old-gen garbage
  ↓
lebih mahal untuk dibersihkan
```

Inilah alasan “object yang tidak bocor” pun dapat menyebabkan masalah GC.

```text
Not leaked != cheap
```

Object bisa tidak leak, tetapi lifetime-nya buruk.

---

## 7. Allocation Rate, Live Set, dan Retained Set

Untuk memahami lifetime, ada tiga metrik konseptual yang harus dibedakan.

### 7.1 Allocation rate

Allocation rate adalah kecepatan aplikasi membuat object baru.

```text
allocation rate = bytes allocated per second
```

Contoh:

```text
500 MB/s allocation rate
```

Artinya aplikasi membuat object baru total 500 MB setiap detik, meskipun heap usage terlihat stabil.

Allocation rate tinggi biasanya menyebabkan young GC sering.

### 7.2 Live set

Live set adalah ukuran object yang masih reachable setelah GC.

```text
live set = memory that remains after collection
```

Jika setelah full/concurrent cycle old generation tetap 5 GB, maka live set lama kira-kira mendekati angka itu.

Live set besar membuat marking lebih mahal, karena GC harus menelusuri lebih banyak object reachable.

### 7.3 Retained set

Retained set adalah total object yang akan ikut mati jika satu root/reference tertentu dilepas.

Contoh:

```text
ConcurrentHashMap cache
  -> 500_000 entries
  -> each entry points to object graph 20 KB
```

Map-nya mungkin hanya beberapa MB, tetapi retained set-nya bisa banyak GB.

Heap dump tools seperti Eclipse MAT menggunakan konsep dominator tree dan retained size untuk memahami ini.

### 7.4 Kenapa tiga metrik ini harus dipisahkan

Aplikasi bisa punya:

| Kondisi | Allocation Rate | Live Set | Masalah Utama |
|---|---:|---:|---|
| REST service banyak temporary DTO | tinggi | rendah | young GC frequency |
| cache besar stabil | rendah | tinggi | marking cost / memory footprint |
| queue backlog | sedang | naik | middle-lived promotion |
| leak static map | naik perlahan | naik perlahan | retained garbage |
| off-heap buffer leak | heap rendah | RSS naik | native memory leak |

Jika semua disebut “memory problem”, diagnosis akan kabur.

---

## 8. Promotion: Saat Object Muda Menjadi Object Tua

Promotion adalah proses memindahkan object yang telah bertahan cukup lama dari area muda ke area tua.

Pada collector generational klasik, alurnya kira-kira:

```text
Eden
  -> Survivor 0
  -> Survivor 1
  -> Old
```

Object yang survive young GC akan dipindahkan ke survivor. Jika survive beberapa kali atau survivor tidak cukup, object dapat dipromote ke old generation.

### 8.1 Kenapa promotion diperlukan

Jika object terus bertahan, meng-copy object itu di setiap young GC menjadi mahal. Jadi object yang kelihatan long-lived dipindahkan ke old area supaya tidak terus ikut young collection.

### 8.2 Kenapa promotion bisa menjadi masalah

Promotion menjadi masalah jika object sebenarnya hanya middle-lived.

Contoh:

```java
public List<Result> loadAllAndProcess() {
    List<Result> all = new ArrayList<>();
    for (Page page : pages()) {
        all.addAll(loadPage(page));
    }
    return process(all);
}
```

Jika `all` besar dan prosesnya lama, object-object di dalam list bisa survive beberapa young GC. Setelah dipromote ke old, mereka mungkin langsung tidak dipakai setelah method selesai. Akibatnya old gen terisi object yang sebenarnya temporary.

Lebih baik:

```java
public void processPageByPage() {
    for (Page page : pages()) {
        List<Result> results = loadPage(page);
        process(results);
    }
}
```

Atau streaming dengan bounded buffer.

### 8.3 Premature promotion

Premature promotion terjadi ketika object masuk old generation terlalu cepat, misalnya karena:

- survivor space terlalu kecil,
- allocation burst terlalu besar,
- object graph temporary terlalu besar,
- young GC terlalu sering,
- pause target memaksa young size kecil,
- batch materialization tidak bounded.

Premature promotion sering terlihat sebagai:

```text
old gen naik cepat
young GC sering
mixed/full GC lebih sering
pause tail memburuk
heap after GC naik-turun tajam
```

---

## 9. Survivor Space dan Tenuring: Mengapa Object “Menunggu” Sebelum Menjadi Tua

Survivor space adalah area antara Eden dan Old. Ia berfungsi sebagai ruang observasi: object yang survive satu young GC belum tentu benar-benar long-lived.

Mental model:

```text
Eden = tempat lahir
Survivor = ruang probation
Old = dianggap lebih long-lived
```

Object memiliki age. Setiap kali survive young GC, age naik. Setelah melewati threshold tertentu, object dapat dipromote.

Oracle documentation lama maupun modern menjelaskan bahwa konfigurasi survivor space memengaruhi apakah object dapat bertahan di survivor atau langsung overflow ke old generation. Jika survivor terlalu kecil, copying collection dapat overflow langsung ke old generation. Referensi Oracle terkait `SurvivorRatio`: <https://docs.oracle.com/cd/E19900-01/819-4742/6n6sfgmkr/index.html>

### 9.1 Kesalahan tuning yang umum

Kesalahan umum:

```text
Masalah: old gen cepat naik.
Solusi asal: heap diperbesar.
```

Heap lebih besar bisa membantu sementara, tetapi jika akar masalahnya premature promotion, heap lebih besar hanya menunda gejala.

Pertanyaan yang lebih baik:

- Apakah allocation burst terlalu besar?
- Apakah temporary object terlalu lama tertahan?
- Apakah queue/backlog membuat request object survive banyak GC?
- Apakah young generation terlalu kecil?
- Apakah pause target terlalu agresif?
- Apakah ada materialization yang bisa diubah menjadi streaming?

---

## 10. Object Lifetime sebagai Distribution, Bukan Satu Angka

Jangan berpikir object lifetime sebagai satu angka rata-rata.

Aplikasi biasanya memiliki distribusi:

```text
very short-lived    : parser token, iterator, temporary wrapper
short-lived         : request DTO, validation object
middle-lived        : queue item, batch aggregation, async payload
long-lived bounded  : config, registry, cache bounded
long-lived unbounded: leak / uncontrolled retention
```

Yang penting bukan hanya average lifetime, tetapi shape distribusinya.

Contoh dua aplikasi:

```text
Aplikasi A:
90% object mati < 10 ms
9.9% object hidup 1 s
0.1% object hidup selama JVM
```

```text
Aplikasi B:
60% object mati < 10 ms
35% object hidup 30-120 s
5% object hidup selama JVM
```

Aplikasi B cenderung lebih berisiko terhadap promotion dan old-gen pressure, walaupun total allocation rate mungkin mirip.

---

## 11. Retained Garbage: Object yang Secara Bisnis Sudah Mati tetapi Masih Reachable

Retained garbage adalah object yang secara bisnis tidak diperlukan, tetapi masih reachable.

Contoh paling sederhana:

```java
public final class RequestHistory {
    private final List<RequestContext> contexts = new ArrayList<>();

    public void record(RequestContext context) {
        contexts.add(context);
    }
}
```

Jika `contexts` tidak pernah dibatasi, semua `RequestContext` akan hidup selama `RequestHistory` hidup.

### 11.1 Retained garbage berbeda dari leak klasik

Leak klasik biasanya terlihat sebagai memory naik tanpa turun.

Retained garbage bisa lebih halus:

- cache punya eviction tapi terlalu lambat,
- queue akhirnya drain tapi backlog lama,
- future chain selesai tapi callback masih tersimpan,
- session timeout terlalu panjang,
- context object besar ditahan oleh satu field kecil,
- metrics label cardinality tinggi membuat map tumbuh.

### 11.2 Small root, huge graph

Satu reference kecil bisa menahan graph besar.

```java
class UserSession {
    private UserProfile profile;
    private List<Document> recentlyViewedDocuments;
    private Map<String, Object> workflowScratchpad;
}
```

Jika `UserSession` tertahan di session registry, semua graph di bawahnya ikut hidup.

Mental model:

```text
root kecil
  -> object kecil
      -> collection besar
          -> element besar
              -> byte[] / String / graph domain
```

Dalam heap dump, root kecil ini bisa menjadi dominator atas banyak memory.

---

## 12. Common Lifetime Anti-Patterns

### 12.1 Static collection tanpa batas

```java
private static final Map<String, Payload> PAYLOADS = new ConcurrentHashMap<>();
```

Masalah:

- hidup selama classloader hidup,
- tidak ada TTL,
- tidak ada max size,
- tidak ada ownership jelas.

Perbaikan:

```java
private final Cache<String, Payload> payloads = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build();
```

Prinsip:

```text
Cache tanpa eviction adalah memory leak dengan nama yang lebih sopan.
```

### 12.2 ThreadLocal leak

```java
private static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();

public void handle(RequestContext context) {
    CTX.set(context);
    process();
}
```

Jika tidak `remove()`, context bisa tertahan selama thread hidup, terutama pada thread pool.

Perbaikan:

```java
public void handle(RequestContext context) {
    CTX.set(context);
    try {
        process();
    } finally {
        CTX.remove();
    }
}
```

Pada virtual thread, pola ThreadLocal tetap harus hati-hati, tetapi bentuk risikonya dapat berbeda karena virtual thread tidak sama dengan pool platform thread tradisional. Namun prinsip ownership dan cleanup tetap berlaku.

### 12.3 Listener/subscriber tidak di-unregister

```java
eventBus.register(this);
```

Jika object mendaftar sebagai listener tetapi tidak pernah unregister, event bus dapat menahan object tersebut selamanya.

Perbaikan:

```java
class Subscription implements AutoCloseable {
    @Override
    public void close() {
        eventBus.unregister(listener);
    }
}
```

Prinsip:

```text
Setiap subscribe harus punya unsubscribe path.
```

### 12.4 Lambda capture object besar

```java
public void submit(LargePayload payload) {
    executor.submit(() -> process(payload));
}
```

Jika executor backlog panjang, setiap lambda menahan `payload`.

Lebih baik jika hanya sebagian kecil data diperlukan:

```java
public void submit(LargePayload payload) {
    String id = payload.id();
    executor.submit(() -> processById(id));
}
```

### 12.5 Queue unbounded

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>();
```

Default constructor `LinkedBlockingQueue` memiliki kapasitas sangat besar (`Integer.MAX_VALUE`). Secara praktis ini sering menjadi unbounded queue.

Perbaikan:

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(10_000);
```

Prinsip:

```text
Unbounded queue mengubah load problem menjadi memory problem.
```

### 12.6 Batch materialization

```java
List<Row> rows = repository.findAllRows();
for (Row row : rows) {
    process(row);
}
```

Jika dataset besar, semua row hidup bersama.

Lebih baik:

```java
repository.scanRows(page -> {
    for (Row row : page) {
        process(row);
    }
});
```

Atau cursor/streaming dengan batas resource yang jelas.

### 12.7 Accidental retention via subgraph

```java
class ValidationError {
    private final RequestContext context;
    private final String message;
}
```

Jika error list disimpan lama, seluruh `RequestContext` ikut tertahan.

Lebih baik:

```java
class ValidationError {
    private final String requestId;
    private final String message;
}
```

Prinsip:

```text
Simpan identifier atau snapshot kecil, bukan seluruh context besar.
```

---

## 13. Engineering Object Lifetime by Scope

Cara paling praktis mendesain lifetime adalah membagi scope.

### 13.1 Method scope

Object hanya hidup selama method.

```java
public Result calculate(Input input) {
    TemporaryState state = new TemporaryState();
    return state.compute(input);
}
```

Biasanya aman selama tidak escape.

### 13.2 Request scope

Object hidup selama request.

```java
public Response handle(Request request) {
    RequestContext ctx = RequestContext.from(request);
    return service.process(ctx);
}
```

Risiko: context dicapture oleh async task, disimpan ke static, atau masuk cache.

### 13.3 Transaction/workflow scope

Object hidup selama transaksi atau workflow step.

Risiko: transaction terlalu panjang, persistence context membesar, entity graph tertahan.

### 13.4 Batch scope

Object hidup selama batch.

Risiko: materialization besar dan middle-lived object.

### 13.5 Application scope

Object hidup selama JVM.

Harus bounded dan intentional.

### 13.6 External resource scope

Object Java mengelola resource non-heap:

- direct buffer,
- file descriptor,
- socket,
- native memory segment,
- mapped file,
- database connection.

Harus ada explicit lifecycle, biasanya `AutoCloseable`.

```java
try (ResourceHandle handle = resource.open()) {
    handle.use();
}
```

---

## 14. Lifetime Budget: Cara Berpikir seperti Engineer Produksi

Untuk sistem produksi, setiap request sebaiknya punya budget konseptual:

```text
per request allocation budget
per request retained memory budget
per queue backlog budget
per tenant cache budget
per batch page budget
per worker buffer budget
```

Contoh:

```text
Service target:
- 500 requests/s
- average allocation per request: 200 KB
- allocation rate: ~100 MB/s
```

Jika average allocation naik menjadi 2 MB/request:

```text
500 requests/s * 2 MB = 1 GB/s allocation rate
```

Itu bisa mengubah profil GC secara drastis.

### 14.1 Budget untuk queue

Misal:

```text
Queue capacity: 10,000 jobs
Average job object graph: 50 KB
Potential retained memory: 500 MB
```

Jika job graph ternyata 500 KB:

```text
10,000 * 500 KB = 5 GB
```

Queue bukan sekadar concurrency primitive. Queue adalah memory retention structure.

### 14.2 Budget untuk cache

```text
max entries = 100,000
average retained size per entry = 20 KB
potential retained size = 2 GB
```

Jika heap 4 GB, cache ini mungkin terlalu besar.

Cache harus dihitung berdasarkan retained size, bukan shallow size.

---

## 15. Object Lifetime dalam REST/Microservice

REST service umum memiliki pattern:

```text
HTTP request
  -> parse headers/body
  -> auth context
  -> DTO
  -> validation
  -> service input
  -> repository result
  -> response DTO
  -> JSON serialization
```

Sebagian besar object seharusnya request-scoped dan mati cepat.

Masalah muncul jika:

- request body besar disimpan di log context,
- DTO masuk async audit queue tanpa batas,
- response list dimaterialisasi penuh,
- entity graph terlalu besar,
- exception menyimpan payload besar,
- MDC/ThreadLocal tidak dibersihkan,
- cache menyimpan per-request result tanpa TTL.

### 15.1 Pattern sehat

```text
request object graph
  -> diproses
  -> output kecil
  -> context dibersihkan
  -> tidak ada reference setelah response
```

### 15.2 Pattern buruk

```text
request object graph
  -> masuk queue
  -> dicapture lambda
  -> disimpan untuk audit/debug
  -> tertahan oleh ThreadLocal
  -> survive many young GCs
  -> promoted
```

---

## 16. Object Lifetime dalam Batch Processing

Batch sering membuat middle-lived object karena data diproses dalam jumlah besar.

Anti-pattern:

```java
List<Record> records = loadAllRecords();
List<ProcessedRecord> processed = new ArrayList<>();

for (Record record : records) {
    processed.add(process(record));
}

writeAll(processed);
```

Masalah:

- `records` hidup selama seluruh batch,
- `processed` hidup selama seluruh batch,
- total object graph bisa sangat besar,
- object survive banyak GC,
- promotion pressure tinggi.

Pattern lebih sehat:

```java
for (List<Record> page : loadPages(1_000)) {
    List<ProcessedRecord> processed = new ArrayList<>(page.size());
    for (Record record : page) {
        processed.add(process(record));
    }
    writePage(processed);
}
```

Lebih baik lagi jika bisa streaming:

```java
try (RecordCursor cursor = repository.openCursor()) {
    while (cursor.hasNext()) {
        writer.write(process(cursor.next()));
    }
}
```

Prinsip:

```text
Batch harus punya bounded working set.
```

---

## 17. Object Lifetime dalam Cache

Cache adalah intentional retention.

Cache yang baik menjawab:

1. Apa key-nya?
2. Apa value-nya?
3. Berapa max entry?
4. Berapa max weight/retained size?
5. Apa TTL/TTI?
6. Apa eviction policy?
7. Apa invalidation rule?
8. Apa yang terjadi jika cache penuh?
9. Apakah value immutable?
10. Apakah value menahan graph terlalu besar?

### 17.1 Cache value terlalu besar

```java
cache.put(userId, userAggregate);
```

Jika `userAggregate` berisi:

- profile,
- permissions,
- recent activity,
- documents,
- workflow state,
- audit history,

maka satu entry bisa menahan graph besar.

Lebih baik cache representation yang sempit:

```java
cache.put(userId, new UserAuthorizationSnapshot(userId, roleIds, permissionBits));
```

### 17.2 TTL bukan pengganti max size

TTL saja tidak cukup. Jika traffic tinggi, dalam satu TTL window cache bisa tumbuh sangat besar.

```text
TTL controls time.
Max size controls space.
```

Cache produksi biasanya butuh keduanya.

---

## 18. Object Lifetime dalam Async/Reactive Pipeline

Async pipeline sering membuat object hidup lebih lama daripada yang terlihat dari kode.

Contoh:

```java
CompletableFuture<Response> f = CompletableFuture
    .supplyAsync(() -> callA(request))
    .thenCombineAsync(callB(request), this::merge)
    .thenApply(result -> enrich(result, request));
```

`request` bisa tertahan oleh beberapa closure sampai seluruh chain selesai.

Jika request besar, ini menjadi retention.

Pattern lebih baik:

```java
String requestId = request.id();
MinimalInput input = request.toMinimalInput();

CompletableFuture<Response> f = CompletableFuture
    .supplyAsync(() -> callA(input))
    .thenCombineAsync(callB(input), this::merge)
    .thenApply(result -> enrich(result, requestId));
```

Prinsip:

```text
Async boundary memperpanjang lifetime object yang dicapture.
```

---

## 19. Object Lifetime dan Exception

Exception bisa menahan memory lebih besar dari yang terlihat.

```java
try {
    process(payload);
} catch (Exception e) {
    throw new ProcessingException("Failed for payload " + payload, e);
}
```

Masalah:

- `payload.toString()` mungkin membuat string besar,
- exception stack trace mahal,
- exception bisa disimpan di future/log/event,
- cause chain bisa panjang,
- suppressed exception bisa menambah graph.

Lebih baik:

```java
throw new ProcessingException("Failed for payloadId=" + payload.id(), e);
```

Prinsip:

```text
Exception harus membawa diagnostic minimum yang cukup, bukan seluruh object graph.
```

---

## 20. Lifetime dan Logging/MDC

Logging bisa memperpanjang lifetime object jika tidak hati-hati.

Anti-pattern:

```java
MDC.put("request", request.toString());
```

atau:

```java
logger.info("Processing {}", largeObject);
```

Jika `toString()` besar, memory allocation naik. Jika MDC tidak dibersihkan, thread pool dapat menahan data antar request.

Pattern:

```java
MDC.put("requestId", request.id());
try {
    process(request);
} finally {
    MDC.clear();
}
```

Prinsip:

```text
Log identifier, not payload.
```

---

## 21. Lifetime dan Persistence Context

Pada ORM/JPA/Hibernate-like pattern, persistence context dapat menahan entity graph.

Anti-pattern batch:

```java
for (Item item : items) {
    entityManager.persist(item);
}
```

Jika tidak flush/clear secara berkala, persistence context tumbuh.

Pattern:

```java
int count = 0;
for (Item item : items) {
    entityManager.persist(item);
    if (++count % 1_000 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

Prinsip:

```text
Persistence context adalah cache dan identity map; ia menahan object.
```

---

## 22. Lifetime dan Object Pooling

Object pooling sering dianggap solusi allocation. Di Java modern, ini sering salah.

Object pooling bisa buruk karena:

- membuat object yang seharusnya mati muda menjadi long-lived,
- meningkatkan live set,
- menambah synchronization,
- menambah lifecycle bug,
- membuat stale state bug,
- memperburuk cache locality,
- menyulitkan GC.

Contoh pooling buruk:

```java
private final BlockingQueue<RequestDto> pool = new ArrayBlockingQueue<>(1000);
```

DTO request biasanya lebih baik dibuat baru dan mati muda.

### 22.1 Kapan pooling masuk akal

Pooling masuk akal untuk:

- object mahal yang mengelola resource eksternal,
- direct buffer besar,
- database connection,
- thread/platform resource,
- native memory segment dengan lifecycle mahal,
- encoder/decoder state tertentu jika benar-benar mahal dan safe.

Prinsip:

```text
Pool resource mahal, bukan object murah.
```

---

## 23. Lifetime dan Large Object

Large object punya efek khusus.

Contoh:

```java
byte[] payload = new byte[50 * 1024 * 1024];
```

Large object:

- sulit dipindahkan murah,
- bisa masuk area khusus seperti humongous region pada G1,
- dapat memicu GC lebih cepat,
- meningkatkan fragmentation pressure,
- sering tertahan oleh satu reference kecil.

Jika large object hanya diperlukan streaming, jangan materialisasi penuh.

Anti-pattern:

```java
byte[] file = inputStream.readAllBytes();
process(file);
```

Pattern:

```java
byte[] buffer = new byte[64 * 1024];
int n;
while ((n = inputStream.read(buffer)) != -1) {
    processChunk(buffer, 0, n);
}
```

Catatan: detail byte buffer, direct buffer, dan mapped file akan dibahas lebih dalam di part 011–014.

---

## 24. Lifetime-Aware Data Structure Choice

Data structure memengaruhi lifetime dan retained graph.

### 24.1 `ArrayList` vs `LinkedList`

`ArrayList`:

- backing array contiguous,
- lebih cache-friendly,
- overhead per element rendah.

`LinkedList`:

- satu node object per element,
- banyak pointer chasing,
- lebih banyak allocation,
- graph lebih panjang.

Untuk banyak workload, `LinkedList` buruk secara memory.

### 24.2 `HashMap` overhead

`HashMap` entry/node menambah object atau struktur internal. Jika value kecil, overhead map bisa dominan.

Untuk key/value primitive atau dense integer key, pertimbangkan struktur khusus jika memory critical.

### 24.3 `EnumSet`

`EnumSet` bisa sangat compact karena memakai bit vector internal.

Daripada:

```java
Set<Permission> permissions = new HashSet<>();
```

Jika `Permission` enum:

```java
EnumSet<Permission> permissions = EnumSet.noneOf(Permission.class);
```

### 24.4 Bitset untuk state besar

Untuk boolean banyak:

```java
boolean[] flags = new boolean[1_000_000];
```

bisa lebih besar daripada bit-packed representation.

```java
BitSet flags = new BitSet(1_000_000);
```

Bit manipulation akan dibahas lebih dalam di part 010.

---

## 25. Designing Object Ownership

Object lifetime sulit dikendalikan jika ownership tidak jelas.

Pertanyaan ownership:

1. Siapa pemilik object?
2. Apakah object boleh dibagikan?
3. Siapa yang boleh menyimpan reference?
4. Kapan reference harus dilepas?
5. Apakah object mutable?
6. Apakah object bisa masuk cache?
7. Apakah object aman melewati async boundary?
8. Apakah object membawa resource eksternal?

### 25.1 Borrowing style di Java

Java tidak punya borrow checker seperti Rust, tetapi kita bisa memakai discipline:

```java
public void process(RequestContext context) {
    // context hanya dipakai selama method call
    // tidak disimpan ke field
    // tidak dikirim async
    // tidak dimasukkan cache
}
```

Dokumentasikan:

```java
/**
 * The provided context is borrowed for the duration of this call.
 * Implementations must not retain it beyond the method invocation.
 */
void validate(RequestContext context);
```

### 25.2 Snapshot vs reference

Jika data perlu disimpan lama, simpan snapshot kecil.

Buruk:

```java
class AuditEvent {
    private final RequestContext context;
}
```

Lebih baik:

```java
class AuditEvent {
    private final String requestId;
    private final String userId;
    private final Instant timestamp;
    private final String action;
}
```

---

## 26. Lifetime Boundaries sebagai Arsitektur

Object lifetime bukan hanya detail kode. Ia adalah keputusan arsitektur.

Contoh boundary:

```text
HTTP request boundary
transaction boundary
async queue boundary
cache boundary
batch page boundary
tenant boundary
module boundary
classloader boundary
native resource boundary
```

Setiap boundary harus menjawab:

```text
Apa yang boleh lewat boundary?
Apa yang tidak boleh lewat?
Apakah yang lewat berupa reference besar atau snapshot kecil?
Apakah ada backpressure?
Apakah ada cleanup?
Apakah ada timeout?
Apakah ada max size?
```

### 26.1 Async boundary rule

Saat melewati async boundary, jangan bawa seluruh request context kecuali benar-benar perlu.

```text
Synchronous call can borrow.
Asynchronous call tends to retain.
```

### 26.2 Cache boundary rule

Saat masuk cache, object menjadi long-lived candidate.

```text
Anything inserted into cache must be safe to live longer than the request.
```

### 26.3 Queue boundary rule

Saat masuk queue, object hidup sampai consumer memprosesnya.

```text
Queue capacity * retained size per item = worst-case memory retention.
```

---

## 27. Reading Symptoms Through Lifetime Lens

### 27.1 Young GC terlalu sering

Kemungkinan:

- allocation rate tinggi,
- banyak temporary object,
- serialization/deserialization berat,
- collection intermediate banyak,
- logging string besar,
- object churn dari mapping DTO/entity.

Pertanyaan:

- Allocation site terbesar di mana?
- Apakah object benar-benar perlu dibuat?
- Apakah bisa streaming?
- Apakah bisa reuse buffer terbatas?
- Apakah ada accidental boxing?

### 27.2 Old gen naik setelah traffic burst

Kemungkinan:

- request object survive karena queue/backlog,
- premature promotion,
- async tasks menahan payload,
- cache menyerap burst,
- batch job materialization.

Pertanyaan:

- Apa yang hidup lebih lama saat burst?
- Ada queue depth naik?
- Ada latency downstream naik?
- Ada executor backlog?
- Ada cache miss storm?

### 27.3 Heap after GC naik perlahan

Kemungkinan:

- leak,
- cache growth,
- classloader retention,
- metric label cardinality,
- session growth,
- static map/list.

Pertanyaan:

- Retained size terbesar apa?
- Dominator utama siapa?
- Growth per class apa?
- Apakah growth berkorelasi dengan tenant/user/request type?

### 27.4 RSS naik tetapi heap stabil

Kemungkinan:

- direct buffer,
- mapped file,
- native memory,
- thread stack,
- metaspace,
- malloc fragmentation,
- JNI/native library leak.

Ini akan dibahas di part 027 dan 028.

---

## 28. Practical Investigation Workflow

Ketika menghadapi memory problem, jangan langsung tuning GC.

Gunakan urutan ini:

```text
1. Identifikasi symptom
2. Bedakan heap vs native/RSS
3. Ukur allocation rate
4. Ukur live set setelah GC
5. Lihat old-gen trend
6. Lihat GC frequency dan pause
7. Ambil heap dump jika aman
8. Cari dominator/retained size
9. Hubungkan dominator ke business flow
10. Perbaiki lifetime/retention
11. Baru tuning GC jika lifecycle sudah masuk akal
```

### 28.1 Pertanyaan wajib

- Apakah object mati muda?
- Apakah object survive beberapa GC?
- Apakah object masuk old generation?
- Siapa yang menahannya?
- Apakah retainer itu intentional?
- Apakah ada bound?
- Apakah ada cleanup?
- Apakah ada backpressure?
- Apakah ada TTL/eviction?
- Apakah object bisa diganti snapshot kecil?

---

## 29. Code Review Checklist untuk Object Lifetime

Gunakan checklist berikut saat review kode.

### 29.1 Allocation

- Apakah allocation terjadi di hot path?
- Apakah allocation per request bounded?
- Apakah ada allocation besar?
- Apakah ada intermediate collection yang tidak perlu?
- Apakah ada boxing/autoboxing di loop besar?

### 29.2 Retention

- Apakah object disimpan ke field/static/cache?
- Apakah collection punya max size?
- Apakah queue bounded?
- Apakah listener di-unregister?
- Apakah ThreadLocal dibersihkan?
- Apakah lambda menangkap object besar?

### 29.3 Async

- Apakah object melewati async boundary?
- Apakah payload besar dicapture?
- Apakah executor queue bounded?
- Apakah timeout/cancellation membersihkan reference?

### 29.4 Cache

- Apakah cache punya max size/weight?
- Apakah cache punya TTL/TTI?
- Apakah value immutable?
- Apakah value retained graph-nya diketahui?

### 29.5 Batch

- Apakah batch memproses page/chunk?
- Apakah persistence context dibersihkan?
- Apakah result dimaterialisasi penuh?
- Apakah output bisa streaming?

### 29.6 Resource

- Apakah object membawa direct/native resource?
- Apakah ada `close()`?
- Apakah `close()` dipanggil via try-with-resources?
- Apakah ownership jelas?

---

## 30. Design Patterns yang Membantu Lifetime

### 30.1 Bounded context object

Jangan buat context object yang menjadi “tas besar semua data”.

Buruk:

```java
class RequestContext {
    HttpServletRequest request;
    User user;
    List<Document> documents;
    Map<String, Object> scratchpad;
    byte[] rawBody;
}
```

Lebih baik pisahkan scope:

```java
record RequestIdentity(String requestId, String userId, String tenantId) {}
record ValidationInput(String requestId, Map<String, String> fields) {}
record AuditSnapshot(String requestId, String action, Instant at) {}
```

### 30.2 Page/chunk processing

```java
while (true) {
    List<Item> page = loadPage(cursor, 1000);
    if (page.isEmpty()) break;
    process(page);
    cursor = nextCursor(page);
}
```

### 30.3 Ownership wrapper

```java
public final class BorrowedPayload {
    private final Payload payload;

    public BorrowedPayload(Payload payload) {
        this.payload = Objects.requireNonNull(payload);
    }

    public Payload get() {
        return payload;
    }
}
```

Ini tidak enforce lifetime secara runtime, tetapi membantu API menyatakan maksud.

### 30.4 Snapshot for async

```java
record NotificationJob(String userId, String templateId, Map<String, String> parameters) {}
```

Daripada mengirim seluruh `User`, `RequestContext`, atau entity graph.

### 30.5 Bounded queue with rejection/backpressure

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

Pilihan policy tergantung sistem, tetapi queue harus disengaja.

---

## 31. Case Study 1: REST Service dengan Allocation Tinggi tetapi Live Set Rendah

Gejala:

```text
heap used naik-turun cepat
old gen stabil
young GC sangat sering
p99 latency kadang naik
CPU GC tinggi
```

Kemungkinan:

- allocation rate tinggi,
- object mati muda,
- tidak ada leak besar.

Investigasi:

- JFR allocation profiling,
- GC log allocation rate,
- flame graph allocation,
- cari mapper/serializer/logging hot path.

Solusi:

- kurangi intermediate DTO,
- hindari materialisasi collection sementara,
- gunakan streaming parser jika payload besar,
- kurangi string concatenation/logging besar,
- hindari autoboxing di loop,
- gunakan primitive/specialized structure jika perlu.

Catatan:

Masalah ini bukan lifetime panjang, tetapi object churn. Namun tetap bagian dari lifetime engineering karena object memang mati cepat tetapi terlalu banyak.

---

## 32. Case Study 2: Queue Backlog Membuat Object Dipromote

Gejala:

```text
traffic burst
executor queue naik
old gen naik setelah beberapa menit
GC pause meningkat
setelah traffic turun, old gen baru turun lambat
```

Akar:

Setiap queue item membawa object graph 200 KB. Queue capacity 50,000.

Worst-case retained memory:

```text
50,000 * 200 KB = 10 GB
```

Masalah bukan GC tuning. Masalahnya queue retention.

Solusi:

- kecilkan payload job,
- simpan ID bukan graph besar,
- bounded queue lebih kecil,
- backpressure/rejection,
- scale consumer,
- timeout/cancellation,
- prioritization/drop policy jika domain memungkinkan.

---

## 33. Case Study 3: Cache Entry Menahan Entity Graph

Gejala:

```text
heap after GC naik perlahan
old gen tidak turun
heap dump menunjukkan cache dominator
```

Akar:

Cache menyimpan `UserAggregate`, bukan snapshot kecil. Setiap aggregate menahan banyak document, permissions, audit state, dan workflow history.

Solusi:

- cache snapshot kecil,
- maximumWeight bukan hanya maximumSize,
- TTL,
- invalidate saat update,
- split cache by purpose,
- jangan cache entity graph mutable.

---

## 34. Case Study 4: Batch Materialization Membuat Full GC

Gejala:

```text
batch job berjalan
heap naik besar
old gen naik
mixed/full GC terjadi
job selesai, memory turun
```

Ini bukan leak karena memory turun setelah job selesai. Tetapi job menciptakan middle-lived object dalam jumlah besar.

Solusi:

- process per page,
- flush/clear persistence context,
- streaming output,
- hindari `findAll`,
- batasi aggregation,
- gunakan temp file/external sort jika perlu.

Prinsip:

```text
Tidak semua memory problem adalah leak.
Beberapa adalah lifetime distribution yang buruk.
```

---

## 35. Java 8 sampai 25: Kenapa Lifetime Tetap Relevan

Walaupun GC modern semakin canggih, object lifetime tetap fundamental.

### Java 8

- Banyak sistem masih memakai Parallel GC, CMS, atau G1.
- CMS sensitif terhadap fragmentation dan promotion behavior.
- G1 sudah tersedia, tetapi belum sematang versi modern.
- String dedup dan G1 tuning sering relevan.

### Java 9+

- G1 menjadi default collector di banyak konfigurasi HotSpot modern.
- Unified logging memudahkan analisis GC.
- Compact Strings mengubah footprint string.

### Java 11/17

- G1 matang sebagai default banyak workload.
- ZGC/Shenandoah mulai makin relevan untuk low-latency.
- JFR lebih praktis untuk profiling allocation/lifetime.

### Java 21

- Generational ZGC hadir sebagai fitur penting.
- Virtual threads mengubah profil thread memory dan request concurrency, tetapi tidak menghapus kebutuhan bounded memory.

### Java 25

- GC modern semakin menekankan low-latency dan generational behavior.
- Generational Shenandoah menjadi product feature.
- Non-generational ZGC mode telah berada di jalur penghapusan/diubah sesuai evolusi JDK modern.

Namun prinsip dasarnya tetap:

```text
GC terbaik pun tidak bisa membuat unbounded retention menjadi desain yang sehat.
```

---

## 36. Praktik Terbaik Utama

### 36.1 Buat lifetime eksplisit

Jangan biarkan object hidup “karena kebetulan masih direferensikan”.

### 36.2 Batasi semua retention structure

Yang harus dibatasi:

- cache,
- queue,
- map,
- list,
- session,
- batch buffer,
- metric labels,
- async backlog.

### 36.3 Jangan bawa graph besar melewati boundary

Gunakan ID/snapshot kecil.

### 36.4 Hindari unbounded materialization

Gunakan streaming, paging, chunking.

### 36.5 Cleanup harus deterministik untuk resource eksternal

GC bukan lifecycle manager yang ideal untuk resource eksternal.

### 36.6 Ukur retained size, bukan hanya object count

Satu object kecil bisa menahan graph besar.

### 36.7 Tuning GC setelah desain lifetime masuk akal

GC tuning tidak boleh menjadi kompensasi untuk desain retention yang buruk.

---

## 37. Ringkasan Mental Model

Object lifetime engineering dapat diringkas seperti ini:

```text
Object lahir di allocation site.
Object hidup selama masih reachable.
Object mati saat tidak ada path dari GC root.
Object murah jika mati muda dan allocation rate terkendali.
Object sehat jika hidup lama secara intentional dan bounded.
Object berbahaya jika middle-lived, unbounded, atau retained tanpa alasan.
```

Diagram besar:

```text
Allocation Rate
   |
   v
Young Objects ---- die young ----> cheap garbage
   |
   | survive
   v
Survivor / probation
   |
   | survive / overflow
   v
Old Generation / long-lived area
   |
   +--> intentional live set       -> acceptable if bounded
   +--> retained garbage           -> leak-like problem
   +--> middle-lived promoted data  -> GC pressure problem
```

Dan prinsip desainnya:

```text
Make object lifetime intentional.
Make retention bounded.
Make ownership clear.
Make async/cache/queue boundaries explicit.
Measure allocation rate, live set, and retained size separately.
```

---

## 38. Latihan Praktis

### Latihan 1 — Klasifikasi lifetime

Untuk setiap object berikut, klasifikasikan sebagai young, middle-lived, long-lived bounded, atau retained garbage:

1. DTO hasil parsing request.
2. `byte[]` hasil `readAllBytes()` file 200 MB.
3. Entry cache tanpa TTL/max size.
4. Config map immutable saat startup.
5. Job object di queue backlog 30 menit.
6. Entity dalam persistence context batch 1 juta row.
7. String `requestId` di MDC yang dibersihkan di finally.
8. `ThreadLocal<UserContext>` tanpa remove di thread pool.

### Latihan 2 — Hitung memory retention queue

Sebuah queue punya kapasitas 20,000 item. Setiap item menahan rata-rata 80 KB object graph.

Hitung worst-case retained memory.

Jawaban:

```text
20,000 * 80 KB = 1,600,000 KB ≈ 1.6 GB
```

### Latihan 3 — Refactor lifetime

Ubah desain berikut:

```java
record EmailJob(User user, RequestContext context, List<Document> documents) {}
```

Menjadi snapshot kecil yang aman untuk async boundary.

Contoh:

```java
record EmailJob(
    String userId,
    String email,
    String templateId,
    Map<String, String> parameters,
    List<String> documentIds
) {}
```

---

## 39. Checklist Produksi Singkat

Sebelum menyalahkan GC, jawab ini:

```text
[ ] Apakah allocation rate diketahui?
[ ] Apakah live set setelah GC diketahui?
[ ] Apakah old-gen trend diketahui?
[ ] Apakah queue/cache/session bounded?
[ ] Apakah ThreadLocal dibersihkan?
[ ] Apakah async callback menangkap graph besar?
[ ] Apakah batch diproses chunk/page?
[ ] Apakah cache menyimpan snapshot kecil?
[ ] Apakah heap dump menunjukkan dominator jelas?
[ ] Apakah problem heap atau native/RSS?
```

Jika jawaban banyak yang belum diketahui, jangan mulai dari tuning flag GC.

---

## 40. Referensi

1. OpenJDK JEP 439 — Generational ZGC: <https://openjdk.org/jeps/439>
2. Oracle Java SE 25 HotSpot Virtual Machine Garbage Collection Tuning Guide: <https://docs.oracle.com/en/java/javase/25/gctuning/>
3. Oracle Java SE 25 GC Tuning Introduction: <https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html>
4. Oracle documentation on survivor spaces and `SurvivorRatio`: <https://docs.oracle.com/cd/E19900-01/819-4742/6n6sfgmkr/index.html>
5. Oracle G1 GC documentation and tuning notes: <https://docs.oracle.com/en/java/javase/17/gctuning/garbage-first-g1-garbage-collector1.html>
6. Oracle ZGC tuning documentation, especially allocation rate/live-set/headroom relationship: <https://docs.oracle.com/en/java/javase/21/gctuning/z-garbage-collector.html>

---

## 41. Penutup

Bagian ini adalah fondasi untuk memahami kenapa GC tuning tanpa memahami object lifetime sering gagal.

Yang perlu dibawa ke bagian berikutnya:

```text
Object yang mati muda biasanya murah.
Object yang hidup lama bisa sehat jika bounded dan intentional.
Object middle-lived sering menjadi sumber masalah tersembunyi.
GC melihat reachability, bukan business intent.
Memory design yang baik dimulai dari ownership, boundary, dan lifetime.
```

Pada bagian berikutnya kita akan masuk ke:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-008.md
```

Topik:

```text
Java References Deep Dive: Strong, Soft, Weak, Phantom, Cleaner
```

Di sana kita akan membedah bagaimana jenis reference memengaruhi reachability, kapan object boleh dikoleksi, bagaimana reference queue bekerja, kenapa finalizer bermasalah, dan bagaimana Cleaner/PhantomReference dipakai untuk lifecycle resource yang lebih aman.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-006](./learn-java-memory-byte-bit-buffer-offheap-gc-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-008](./learn-java-memory-byte-bit-buffer-offheap-gc-part-008.md)

</div>