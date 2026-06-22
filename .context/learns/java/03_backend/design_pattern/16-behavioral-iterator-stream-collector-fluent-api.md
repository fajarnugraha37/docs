# Part 16 — Behavioral Pattern VII: Iterator, Stream, Collector, Fluent API

File: `16-behavioral-iterator-stream-collector-fluent-api.md`

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: 16 dari 35  
> Topik: Java Design Pattern dan Anti-Pattern  
> Scope Java: 8 sampai 25

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. Memahami **Iterator Pattern** bukan hanya sebagai `Iterator<T>`, tetapi sebagai desain untuk mengontrol akses bertahap terhadap koleksi, stream data, cursor, result set, tree, graph, file, dan event source.
2. Membedakan **external iteration** dan **internal iteration** beserta konsekuensi desainnya.
3. Memahami mengapa Java 8 Stream API bukan sekadar syntax ringkas, melainkan model pipeline dengan source, intermediate operation, terminal operation, laziness, encounter order, dan side-effect constraint.
4. Mendesain custom `Iterable`, `Iterator`, `Spliterator`, `Stream`, dan `Collector` secara benar.
5. Memahami kapan Stream membuat desain lebih jelas dan kapan justru menjadi anti-pattern.
6. Memahami Fluent API sebagai desain bahasa kecil, bukan sekadar method chaining.
7. Mendesain Fluent API yang type-safe, readable, testable, dan tidak menyembunyikan failure.
8. Mengenali anti-pattern seperti:
   - unreadable stream chain,
   - stream for everything,
   - parallel stream misuse,
   - iterator leaking resource,
   - fluent API hiding state mutation,
   - method chain with invisible side effect.
9. Mampu membuat decision matrix kapan memakai loop, iterator, stream, collector, cursor, atau fluent DSL.
10. Mampu menilai desain API iteration/pipeline dari sisi correctness, performance, debugging, resource lifecycle, concurrency, dan maintainability.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Banyak engineer melihat iteration sebagai hal sepele:

```java
for (Item item : items) {
    process(item);
}
```

Namun di sistem nyata, iteration sering berubah menjadi masalah desain yang lebih besar:

1. Data terlalu besar untuk dimuat semua ke memory.
2. Data berasal dari database cursor, file besar, queue, API paginated, tree, graph, atau remote stream.
3. Urutan data penting untuk audit atau business rule.
4. Iterasi harus bisa dihentikan lebih awal.
5. Iterasi menghasilkan side effect.
6. Iterasi perlu parallelism.
7. Pipeline perlu reusable tetapi tetap readable.
8. API chaining terlihat elegan tetapi menyembunyikan state mutation.
9. Stream terlihat deklaratif tetapi sulit di-debug ketika chain terlalu panjang.
10. Parallel stream terlihat mudah tetapi berbahaya untuk blocking IO, shared mutable state, dan transaction context.

Pattern di bagian ini membantu menjawab:

```text
Bagaimana kita memberi akses terhadap sequence of elements tanpa membocorkan struktur internal?
Bagaimana kita memisahkan traversal dari business operation?
Bagaimana kita mendesain pipeline yang readable, lazy, composable, dan aman?
Bagaimana kita membedakan fluent API yang benar-benar meningkatkan ekspresivitas dari chaining kosmetik?
```

---

## 3. Mental Model

### 3.1 Iteration Is a Boundary

Iterator bukan sekadar loop helper. Iterator adalah **boundary antara producer dan consumer elemen**.

Producer tahu:

- dari mana data berasal,
- bagaimana mengambil elemen berikutnya,
- apakah ada pagination,
- apakah ada resource terbuka,
- apakah traversal mahal,
- apakah urutan penting,
- apakah data mutable atau snapshot.

Consumer hanya perlu tahu:

```text
Apakah masih ada elemen?
Berikan elemen berikutnya.
```

Ini adalah abstraction boundary.

---

### 3.2 Stream Is a Pipeline, Not a Collection

Stream bukan collection.

Collection adalah data structure.

Stream adalah deskripsi computation pipeline terhadap source.

```text
Collection = stores elements
Iterator   = traverses elements
Stream     = describes computation over elements
Collector  = folds elements into result
```

Salah satu kesalahan umum adalah memperlakukan Stream seperti List.

Contoh buruk:

```java
Stream<Order> stream = orders.stream();
long count = stream.count();
List<Order> list = stream.toList(); // error: stream already consumed
```

Stream adalah one-shot pipeline.

---

### 3.3 Fluent API Is a Language

Fluent API bukan hanya:

```java
object.a().b().c();
```

Fluent API yang baik membentuk **mini language** yang mengarahkan user API menulis operasi dengan urutan yang masuk akal.

Contoh intent:

```java
CaseQuery.open()
    .ownedBy(userId)
    .withStatus(Status.PENDING_REVIEW)
    .sortedBy(CaseSort.CREATED_DESC)
    .limit(50)
    .execute();
```

Pertanyaan desainnya:

```text
Apakah chain ini hanya kosmetik?
Apakah tiap step punya invariant?
Apakah urutan method valid?
Apakah invalid sequence bisa dicegah compile-time?
Apakah failure terlihat eksplisit?
Apakah chain mutable atau immutable?
```

---

## 4. Core Concept

Bagian ini membahas empat konsep utama:

| Konsep | Fungsi Desain | Cocok Untuk | Risiko Utama |
|---|---|---|---|
| Iterator | External traversal | custom collection, cursor, tree, file | resource leak, concurrent modification |
| Stream | Internal pipeline | transformation/filter/reduce declarative | unreadable chain, side effect, misuse parallel |
| Collector | Reduction strategy | aggregate/group/fold result | mutable accumulator bug, combiner salah |
| Fluent API | Expressive operation DSL | query builder, validation DSL, config DSL | hidden state, invalid chain, debugging sulit |

---

## 5. Iterator Pattern

### 5.1 Intent

Iterator Pattern menyediakan cara untuk mengakses elemen aggregate secara berurutan tanpa mengekspos representasi internal aggregate tersebut.

Dalam Java, bentuk paling umum adalah:

```java
public interface Iterator<E> {
    boolean hasNext();
    E next();
    default void remove() { ... }
}
```

Dan:

```java
public interface Iterable<T> {
    Iterator<T> iterator();
}
```

Dengan `Iterable`, object bisa digunakan dalam enhanced for-loop:

```java
for (CaseFile file : caseFiles) {
    process(file);
}
```

---

### 5.2 External Iteration

External iteration berarti consumer mengontrol traversal.

```java
Iterator<CaseFile> iterator = repository.findOpenCases().iterator();

while (iterator.hasNext()) {
    CaseFile file = iterator.next();
    process(file);
}
```

Keunggulan:

1. mudah dihentikan,
2. mudah debug step-by-step,
3. cocok untuk stateful traversal,
4. cocok untuk resource cursor,
5. explicit control di caller.

Kelemahan:

1. caller memegang detail traversal,
2. side effect mudah menyebar,
3. parallelism tidak otomatis,
4. logic filtering/mapping sering bercampur dengan loop.

---

### 5.3 Internal Iteration

Internal iteration berarti producer/pipeline mengontrol traversal; caller hanya memberi behavior.

```java
cases.stream()
    .filter(CaseFile::isOpen)
    .map(CaseFile::ownerId)
    .forEach(notificationService::notifyOwner);
```

Keunggulan:

1. declarative,
2. mudah composition,
3. filtering/mapping/reduction lebih jelas,
4. bisa lazy,
5. bisa parallel jika source dan operation memenuhi syarat.

Kelemahan:

1. debugging chain panjang lebih sulit,
2. side effect tersembunyi,
3. exception handling lebih awkward,
4. short-circuit harus dipahami,
5. resource lifecycle bisa kabur.

---

## 6. Designing Custom Iterator

### 6.1 Contoh Domain: Case Page Iterator

Misalnya sistem memiliki API paginated:

```text
GET /cases?page=0&size=100
GET /cases?page=1&size=100
...
```

Consumer tidak perlu tahu pagination. Kita bisa membungkusnya menjadi iterator.

```java
public final class PaginatedCaseIterator implements Iterator<CaseSummary> {

    private final CaseClient client;
    private final int pageSize;

    private int pageNumber;
    private Iterator<CaseSummary> currentPageIterator = List.<CaseSummary>of().iterator();
    private boolean lastPageReached;

    public PaginatedCaseIterator(CaseClient client, int pageSize) {
        if (pageSize <= 0) {
            throw new IllegalArgumentException("pageSize must be positive");
        }
        this.client = Objects.requireNonNull(client, "client");
        this.pageSize = pageSize;
    }

    @Override
    public boolean hasNext() {
        if (currentPageIterator.hasNext()) {
            return true;
        }

        if (lastPageReached) {
            return false;
        }

        fetchNextPage();
        return currentPageIterator.hasNext();
    }

    @Override
    public CaseSummary next() {
        if (!hasNext()) {
            throw new NoSuchElementException();
        }
        return currentPageIterator.next();
    }

    private void fetchNextPage() {
        CasePage page = client.fetchCases(pageNumber, pageSize);
        pageNumber++;
        currentPageIterator = page.items().iterator();
        lastPageReached = page.last();
    }
}
```

Kelebihan:

- pagination tersembunyi,
- caller melihat sequence biasa,
- fetching lazy,
- cocok untuk batch processing.

Tetapi ada risiko:

- `hasNext()` melakukan network call,
- repeated `hasNext()` harus aman,
- exception network bisa muncul saat iteration,
- tracing harus jelas,
- retry policy jangan disembunyikan tanpa observability.

---

### 6.2 Iterator dengan Resource

Jika iterator membaca file, database cursor, atau network stream, ia harus punya lifecycle.

Jangan hanya implement `Iterator<T>`. Gunakan `AutoCloseable`.

```java
public interface CloseableIterator<T> extends Iterator<T>, AutoCloseable {
    @Override
    void close();
}
```

Contoh pemakaian:

```java
try (CloseableIterator<AuditEvent> events = auditRepository.scanEvents(criteria)) {
    while (events.hasNext()) {
        process(events.next());
    }
}
```

Anti-pattern:

```java
Iterator<AuditEvent> events = auditRepository.scanEvents(criteria);
while (events.hasNext()) {
    process(events.next());
}
// resource tidak pernah ditutup
```

Rule penting:

```text
Jika traversal membuka resource eksternal, API iteration harus membuat lifecycle eksplisit.
```

---

### 6.3 Iterator Contract

Iterator yang baik harus jelas soal:

1. Apakah `hasNext()` idempotent?
2. Apakah `next()` boleh dipanggil tanpa `hasNext()`?
3. Apa exception ketika exhausted?
4. Apakah iterator snapshot atau live view?
5. Apakah iterator fail-fast terhadap concurrent modification?
6. Apakah elemen boleh `null`?
7. Apakah traversal ordered?
8. Apakah thread-safe?
9. Siapa yang menutup resource?
10. Apa yang terjadi jika source berubah saat iterasi?

Untuk Java engineer senior, ini bukan detail kecil. Ini adalah bagian dari API contract.

---

## 7. Iterable vs Iterator vs Cursor

### 7.1 Iterable

`Iterable<T>` berarti object bisa membuat iterator baru.

```java
public final class CaseCollection implements Iterable<CaseFile> {
    private final List<CaseFile> cases;

    public CaseCollection(List<CaseFile> cases) {
        this.cases = List.copyOf(cases);
    }

    @Override
    public Iterator<CaseFile> iterator() {
        return cases.iterator();
    }
}
```

Biasanya `Iterable` menyiratkan:

- bisa diulang beberapa kali,
- murah membuat iterator baru,
- data ada atau dapat diakses stabil.

Namun ini tidak selalu benar untuk cursor database atau stream remote.

---

### 7.2 Iterator

`Iterator<T>` adalah traversal stateful.

Iterator biasanya one-shot.

```java
Iterator<T> it = ...;
it.next();
it.next();
```

Iterator tidak seharusnya dipakai ulang dari awal.

---

### 7.3 Cursor

Cursor adalah iterator dengan resource dan posisi.

Database cursor, file cursor, dan remote paginated cursor biasanya punya:

- posisi,
- lifecycle,
- timeout,
- resource handle,
- fetch size,
- consistency semantics.

Karena itu cursor sebaiknya lebih eksplisit daripada `Iterator` biasa.

```java
public interface CaseCursor extends AutoCloseable {
    boolean hasNext();
    CaseSummary next();
    CursorPosition position();
    @Override void close();
}
```

---

## 8. Spliterator

### 8.1 Apa Itu Spliterator?

`Spliterator` diperkenalkan di Java 8 sebagai abstraction untuk traversal dan partitioning source data. Ia bisa melakukan traversal elemen satu per satu atau mencoba membagi source menjadi beberapa bagian untuk parallel processing.

Mental model:

```text
Iterator    = traverse
Spliterator = split + traverse
```

Operasi penting:

```java
boolean tryAdvance(Consumer<? super T> action);
Spliterator<T> trySplit();
long estimateSize();
int characteristics();
```

---

### 8.2 Characteristics

`Spliterator` dapat mendeklarasikan karakteristik:

| Characteristic | Makna |
|---|---|
| `ORDERED` | traversal punya order bermakna |
| `DISTINCT` | elemen unik |
| `SORTED` | elemen sudah sorted |
| `SIZED` | ukuran diketahui |
| `NONNULL` | elemen tidak null |
| `IMMUTABLE` | source tidak berubah |
| `CONCURRENT` | source bisa dimodifikasi concurrent |
| `SUBSIZED` | split juga sized |

Kesalahan characteristics bisa menyebabkan hasil salah atau performance buruk.

Contoh:

```java
@Override
public int characteristics() {
    return Spliterator.ORDERED | Spliterator.NONNULL;
}
```

Jangan mengklaim `SIZED` jika ukuran tidak pasti.

---

### 8.3 Kapan Membuat Custom Spliterator?

Custom `Spliterator` layak jika:

1. Anda membuat collection/source custom.
2. Anda ingin source bisa menjadi Stream dengan benar.
3. Anda perlu control lazy traversal.
4. Anda ingin parallel processing efisien.
5. Anda punya source yang bisa dipartisi secara alami.

Tidak layak jika:

1. Source kecil.
2. Loop biasa cukup jelas.
3. Splitting sulit atau mahal.
4. Operation blocking IO.
5. Correctness characteristics tidak jelas.

---

## 9. Stream Pattern

### 9.1 Stream Pipeline Anatomy

Stream pipeline terdiri dari:

```text
source -> intermediate operations -> terminal operation
```

Contoh:

```java
List<CaseSummary> urgentCases = cases.stream()
    .filter(CaseSummary::isOpen)
    .filter(CaseSummary::isOverdue)
    .sorted(Comparator.comparing(CaseSummary::createdAt))
    .limit(100)
    .toList();
```

Source:

```java
cases.stream()
```

Intermediate operations:

```java
filter
filter
sorted
limit
```

Terminal operation:

```java
toList
```

Stream operation tidak berjalan sampai terminal operation dipanggil.

---

### 9.2 Laziness

Stream intermediate operation lazy.

```java
Stream<CaseSummary> pipeline = cases.stream()
    .filter(c -> {
        System.out.println("filter " + c.id());
        return c.isOpen();
    });

// belum ada output

long count = pipeline.count();
// baru dieksekusi
```

Laziness memberi manfaat:

1. operation bisa digabung,
2. short-circuit bisa hemat kerja,
3. pipeline bisa mendeskripsikan computation sebelum dijalankan.

Tetapi laziness juga membuat side effect lebih berbahaya.

---

### 9.3 Intermediate Operation: Stateless vs Stateful

Stateless operation:

```java
filter
map
peek
```

Stateful operation:

```java
distinct
sorted
limit
skip
```

Stateful operation bisa membutuhkan buffering dan memengaruhi performance.

Contoh:

```java
cases.stream()
    .sorted(Comparator.comparing(CaseSummary::createdAt))
    .limit(10)
    .toList();
```

Untuk memperoleh 10 pertama setelah sort, stream perlu mengetahui banyak elemen, bahkan mungkin semua.

Bandingkan:

```java
cases.stream()
    .limit(10)
    .sorted(Comparator.comparing(CaseSummary::createdAt))
    .toList();
```

Ini berbeda semantic.

Urutan operation adalah bagian dari correctness.

---

### 9.4 Terminal Operation

Terminal operation menghasilkan result atau side effect.

Contoh result:

```java
long count = cases.stream().filter(CaseSummary::isOpen).count();
```

Contoh reduction:

```java
Optional<CaseSummary> oldest = cases.stream()
    .min(Comparator.comparing(CaseSummary::createdAt));
```

Contoh side effect:

```java
cases.stream().forEach(notificationService::notify);
```

Side effect terminal operation harus hati-hati, terutama dalam parallel stream.

---

## 10. Stream Design Heuristics

Gunakan Stream ketika:

1. Transformasi data linear dan jelas.
2. Pipeline pendek sampai sedang.
3. Operasi lebih deklaratif daripada imperative.
4. Tidak butuh complex control flow.
5. Tidak ada resource lifecycle rumit.
6. Tidak ada checked exception yang dominan.
7. Tidak ada shared mutable state.
8. Short-circuit jelas.
9. Output adalah collection, aggregate, optional, atau scalar.

Gunakan loop ketika:

1. Perlu branching kompleks.
2. Perlu multiple mutable accumulator.
3. Perlu detailed error handling per elemen.
4. Perlu early exit dengan logic kompleks.
5. Perlu logging/debugging step-by-step.
6. Performance hot path terbukti penting.
7. Operation punya side effect berat.
8. Code stream menjadi sulit dibaca.

Top engineer tidak memaksakan Stream. Mereka memilih bentuk yang paling menjaga correctness dan readability.

---

## 11. Stream Anti-Pattern: Unreadable Chain

Contoh buruk:

```java
Map<String, List<String>> result = cases.stream()
    .filter(c -> c.status() != null && c.status().isOpen() && c.owner() != null)
    .flatMap(c -> c.violations().stream().filter(v -> v.type() != null).map(v -> Map.entry(c.owner().id(), v.type().code())))
    .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
```

Masalah:

1. terlalu banyak level nested,
2. domain intent hilang,
3. null handling bercampur,
4. grouping sulit dibaca,
5. debugging sulit.

Refactor:

```java
List<CaseFile> eligibleCases = cases.stream()
    .filter(this::isOpenCaseWithOwner)
    .toList();

Stream<OwnerViolationType> ownerViolationTypes = eligibleCases.stream()
    .flatMap(this::ownerViolationTypes);

Map<String, List<String>> result = ownerViolationTypes.collect(
    Collectors.groupingBy(
        OwnerViolationType::ownerId,
        Collectors.mapping(OwnerViolationType::violationTypeCode, Collectors.toList())
    )
);
```

Dengan helper:

```java
private boolean isOpenCaseWithOwner(CaseFile caseFile) {
    return caseFile.status().isOpen() && caseFile.owner() != null;
}

private Stream<OwnerViolationType> ownerViolationTypes(CaseFile caseFile) {
    return caseFile.violations().stream()
        .map(v -> new OwnerViolationType(caseFile.owner().id(), v.type().code()));
}
```

Rule:

```text
Jika Stream chain membutuhkan komentar untuk dipahami, kemungkinan perlu diekstrak menjadi named operation.
```

---

## 12. Stream Anti-Pattern: Side Effect in Pipeline

Contoh buruk:

```java
List<String> notified = new ArrayList<>();

cases.stream()
    .filter(CaseFile::isOverdue)
    .map(CaseFile::ownerEmail)
    .forEach(email -> {
        emailService.sendReminder(email);
        notified.add(email);
    });
```

Masalah:

1. side effect campur dengan transformation,
2. mutable external list,
3. tidak aman jika parallel,
4. error handling tidak jelas.

Lebih baik:

```java
List<String> emails = cases.stream()
    .filter(CaseFile::isOverdue)
    .map(CaseFile::ownerEmail)
    .distinct()
    .toList();

for (String email : emails) {
    emailService.sendReminder(email);
}
```

Pisahkan:

```text
data selection != side effect execution
```

---

## 13. Stream Anti-Pattern: `peek` Abuse

`peek` sering dipakai untuk side effect.

```java
cases.stream()
    .filter(CaseFile::isOpen)
    .peek(c -> audit.log("selected", c.id()))
    .map(this::toDto)
    .toList();
```

`peek` lebih cocok untuk debugging ringan, bukan business side effect.

Masalah:

1. lazy; tidak jalan tanpa terminal operation,
2. bisa tidak terpanggil sesuai ekspektasi karena short-circuit,
3. behavior tersembunyi di tengah pipeline,
4. sulit dites sebagai business operation.

Gunakan explicit operation:

```java
List<CaseFile> openCases = cases.stream()
    .filter(CaseFile::isOpen)
    .toList();

auditSelectedCases(openCases);

List<CaseDto> result = openCases.stream()
    .map(this::toDto)
    .toList();
```

---

## 14. Parallel Stream

### 14.1 Kapan Parallel Stream Menguntungkan?

Parallel stream bisa berguna jika:

1. source besar,
2. operation CPU-bound,
3. operation stateless,
4. operation tidak blocking,
5. source mudah di-split,
6. collector/reduction parallel-safe,
7. ordering tidak terlalu membatasi,
8. overhead parallel lebih kecil daripada kerja per elemen.

Contoh relatif masuk akal:

```java
long count = largeNumbers.parallelStream()
    .filter(this::isPrimeExpensive)
    .count();
```

---

### 14.2 Kapan Parallel Stream Berbahaya?

Jangan gunakan parallel stream untuk:

1. blocking IO,
2. database call per element,
3. HTTP call per element,
4. transaction context,
5. request-scoped context berbasis ThreadLocal,
6. shared mutable accumulator,
7. operation yang harus ordered strict,
8. environment server dengan common pool contention.

Contoh buruk:

```java
cases.parallelStream()
    .forEach(caseFile -> externalApi.updateStatus(caseFile.id()));
```

Masalah:

1. bisa membanjiri external API,
2. memakai common ForkJoinPool,
3. timeout/retry tidak terkontrol,
4. rate limit sulit diterapkan,
5. context propagation tidak jelas,
6. ordering hilang.

Lebih baik gunakan explicit executor/rate limiter/work queue.

---

### 14.3 Parallel Stream and Common Pool

Parallel stream secara default memakai common `ForkJoinPool`. Ini berarti workload parallel stream bisa berebut resource dengan workload lain di JVM yang sama.

Dalam aplikasi server, ini sering menjadi masalah karena:

1. satu request bisa memakai banyak worker,
2. blocking operation bisa menahan worker,
3. latency request lain ikut naik,
4. observability worker pool kurang eksplisit.

Rule:

```text
Di backend service, parallel stream bukan pengganti concurrency design.
```

---

## 15. Collector Pattern

### 15.1 Apa Itu Collector?

Collector adalah strategi untuk mengakumulasi elemen Stream menjadi hasil akhir.

Contoh:

```java
Map<Status, List<CaseFile>> byStatus = cases.stream()
    .collect(Collectors.groupingBy(CaseFile::status));
```

Collector terdiri dari konsep:

1. supplier: membuat accumulator,
2. accumulator: memasukkan elemen,
3. combiner: menggabungkan accumulator,
4. finisher: mengubah accumulator menjadi result,
5. characteristics: properti collector.

---

### 15.2 Built-in Collector

Contoh umum:

```java
List<CaseFile> list = cases.stream().toList();

Set<String> owners = cases.stream()
    .map(CaseFile::ownerId)
    .collect(Collectors.toSet());

Map<Status, Long> countByStatus = cases.stream()
    .collect(Collectors.groupingBy(CaseFile::status, Collectors.counting()));

Map<OwnerId, List<CaseFile>> byOwner = cases.stream()
    .collect(Collectors.groupingBy(CaseFile::ownerId));
```

---

### 15.3 Custom Collector

Misalnya kita ingin mengumpulkan decision reasons:

```java
public record DecisionSummary(
    int total,
    int approved,
    int rejected,
    List<String> rejectionReasons
) {}
```

Accumulator:

```java
public final class DecisionSummaryAccumulator {
    private int total;
    private int approved;
    private int rejected;
    private final List<String> rejectionReasons = new ArrayList<>();

    public void add(Decision decision) {
        total++;
        if (decision.approved()) {
            approved++;
        } else {
            rejected++;
            rejectionReasons.addAll(decision.reasons());
        }
    }

    public DecisionSummaryAccumulator combine(DecisionSummaryAccumulator other) {
        this.total += other.total;
        this.approved += other.approved;
        this.rejected += other.rejected;
        this.rejectionReasons.addAll(other.rejectionReasons);
        return this;
    }

    public DecisionSummary finish() {
        return new DecisionSummary(
            total,
            approved,
            rejected,
            List.copyOf(rejectionReasons)
        );
    }
}
```

Collector:

```java
public static Collector<Decision, ?, DecisionSummary> decisionSummaryCollector() {
    return Collector.of(
        DecisionSummaryAccumulator::new,
        DecisionSummaryAccumulator::add,
        DecisionSummaryAccumulator::combine,
        DecisionSummaryAccumulator::finish
    );
}
```

Usage:

```java
DecisionSummary summary = decisions.stream()
    .collect(decisionSummaryCollector());
```

---

### 15.4 Collector Correctness Rules

Custom collector harus memenuhi aturan:

1. accumulator harus memasukkan satu elemen dengan benar,
2. combiner harus associative,
3. finisher tidak boleh merusak accumulator untuk hasil berikutnya,
4. jika parallel, combiner harus benar,
5. jangan klaim `CONCURRENT` jika tidak benar,
6. jangan expose mutable internal state,
7. hasil harus deterministic jika order penting.

Combiner sering diabaikan karena test hanya sequential.

Contoh buruk:

```java
(left, right) -> left
```

Ini mungkin lolos di sequential stream, tetapi salah di parallel stream.

---

## 16. Fluent API Pattern

### 16.1 Intent

Fluent API bertujuan membuat API terbaca seperti bahasa domain kecil.

Martin Fowler mempopulerkan istilah Fluent Interface sebagai style API yang menekankan readability melalui chaining dan domain language.

Contoh:

```java
CaseSearchQuery query = CaseSearchQuery.builder()
    .status(Status.OPEN)
    .assignedTo(userId)
    .createdBetween(from, to)
    .sortBy(CaseSort.CREATED_DESC)
    .limit(100)
    .build();
```

Fluent API yang baik bukan hanya pendek, tetapi:

1. urutan method masuk akal,
2. invalid state dicegah,
3. intent domain jelas,
4. terminal operation jelas,
5. failure terlihat,
6. side effect tidak mengejutkan.

---

### 16.2 Method Chaining vs Fluent API

Method chaining:

```java
obj.a().b().c();
```

Fluent API:

```java
CaseQuery
    .whereStatusIs(Status.OPEN)
    .andOwnerIs(userId)
    .orderByCreatedDateDescending()
    .limitTo(50)
    .execute();
```

Perbedaannya:

```text
Method chaining = syntax technique
Fluent API      = API language design
```

Tidak semua chaining adalah fluent API.

---

### 16.3 Mutable Fluent API

Contoh:

```java
public final class CaseQueryBuilder {
    private Status status;
    private UserId owner;
    private int limit = 50;

    public CaseQueryBuilder status(Status status) {
        this.status = status;
        return this;
    }

    public CaseQueryBuilder owner(UserId owner) {
        this.owner = owner;
        return this;
    }

    public CaseQueryBuilder limit(int limit) {
        this.limit = limit;
        return this;
    }

    public CaseQuery build() {
        return new CaseQuery(status, owner, limit);
    }
}
```

Kelebihan:

1. simple,
2. umum,
3. familiar,
4. murah.

Risiko:

1. builder bisa reused tanpa sengaja,
2. thread-unsafe,
3. intermediate invalid state,
4. urutan method tidak dikontrol.

---

### 16.4 Immutable Fluent API

```java
public record CaseQueryDraft(
    Status status,
    UserId owner,
    int limit
) {
    public static CaseQueryDraft empty() {
        return new CaseQueryDraft(null, null, 50);
    }

    public CaseQueryDraft status(Status status) {
        return new CaseQueryDraft(status, owner, limit);
    }

    public CaseQueryDraft owner(UserId owner) {
        return new CaseQueryDraft(status, owner, limit);
    }

    public CaseQueryDraft limit(int limit) {
        return new CaseQueryDraft(status, owner, limit);
    }

    public CaseQuery build() {
        return new CaseQuery(status, owner, limit);
    }
}
```

Kelebihan:

1. safer reuse,
2. no hidden mutation,
3. easier reasoning,
4. works well with records.

Kelemahan:

1. lebih banyak object allocation,
2. bisa verbose,
3. compile-time protocol tetap belum otomatis.

---

### 16.5 Staged Fluent API

Staged fluent API membatasi urutan method dengan interface berbeda.

Contoh: query harus punya status sebelum bisa execute.

```java
public final class CaseQueryDsl {

    public interface StatusStep {
        OwnerStep status(Status status);
    }

    public interface OwnerStep {
        OptionalStep owner(UserId owner);
        OptionalStep anyOwner();
    }

    public interface OptionalStep {
        OptionalStep limit(int limit);
        OptionalStep sort(CaseSort sort);
        CaseQuery build();
    }

    public static StatusStep query() {
        return new Builder();
    }

    private static final class Builder implements StatusStep, OwnerStep, OptionalStep {
        private Status status;
        private UserId owner;
        private int limit = 50;
        private CaseSort sort = CaseSort.CREATED_DESC;

        @Override
        public OwnerStep status(Status status) {
            this.status = Objects.requireNonNull(status);
            return this;
        }

        @Override
        public OptionalStep owner(UserId owner) {
            this.owner = Objects.requireNonNull(owner);
            return this;
        }

        @Override
        public OptionalStep anyOwner() {
            this.owner = null;
            return this;
        }

        @Override
        public OptionalStep limit(int limit) {
            if (limit <= 0 || limit > 500) {
                throw new IllegalArgumentException("limit must be between 1 and 500");
            }
            this.limit = limit;
            return this;
        }

        @Override
        public OptionalStep sort(CaseSort sort) {
            this.sort = Objects.requireNonNull(sort);
            return this;
        }

        @Override
        public CaseQuery build() {
            return new CaseQuery(status, owner, limit, sort);
        }
    }
}
```

Usage:

```java
CaseQuery query = CaseQueryDsl.query()
    .status(Status.OPEN)
    .anyOwner()
    .limit(100)
    .build();
```

User tidak bisa memanggil `build()` sebelum `status()` dan owner step.

Trade-off:

1. compile-time safety naik,
2. API lebih verbose,
3. banyak interface,
4. cocok untuk DSL penting,
5. overkill untuk builder sederhana.

---

## 17. Fluent API Failure Model

Fluent API sering buruk karena menyembunyikan failure.

Contoh buruk:

```java
client
    .withRetry(3)
    .withTimeout(Duration.ofSeconds(2))
    .send(request)
    .parse()
    .save();
```

Pertanyaan:

1. `send()` melakukan IO atau hanya membangun request?
2. `parse()` bisa gagal bagaimana?
3. `save()` menyimpan ke mana?
4. Apakah chain ini transactional?
5. Jika `save()` gagal, apakah request sudah terkirim?
6. Apakah retry mencakup send, parse, atau save?

Fluent API dengan side effect harus punya terminal operation yang jelas.

Lebih baik:

```java
PreparedRequest prepared = client.request()
    .retry(maxAttempts)
    .timeout(timeout)
    .prepare(request);

ClientResponse response = prepared.send();
ParsedPayload payload = parser.parse(response.body());
repository.save(payload);
```

Atau jika tetap fluent:

```java
SendResult result = client.request(request)
    .withRetry(maxAttempts)
    .withTimeout(timeout)
    .execute();
```

Terminal operation `execute()` jelas sebagai titik side effect.

---

## 18. Designing Fluent API for Enterprise Use

Fluent API enterprise harus mempertimbangkan:

1. auditability,
2. validation,
3. error taxonomy,
4. observability,
5. authorization,
6. transaction boundary,
7. idempotency,
8. versioning,
9. compatibility,
10. test readability.

Contoh fluent validation DSL:

```java
ValidationResult result = Validator.forObject(application)
    .require(Application::applicantId, "applicantId")
    .require(Application::licenseType, "licenseType")
    .rule("licenseType.allowed", app -> allowedTypes.contains(app.licenseType()))
    .rule("documents.complete", this::hasRequiredDocuments)
    .validate();
```

Ini bagus jika:

1. tiap rule punya name,
2. failure punya code,
3. validation tidak melakukan mutation,
4. `validate()` adalah terminal operation,
5. hasil bukan exception acak.

---

## 19. Iterator, Stream, Collector, Fluent API: Relationship

Keempat konsep ini bisa dikombinasikan.

Contoh:

```java
DecisionSummary summary = CaseQuery.openCases()
    .ownedBy(userId)
    .stream(caseRepository)
    .filter(CaseFile::requiresReview)
    .map(decisionService::evaluate)
    .collect(decisionSummaryCollector());
```

Namun komposisi ini harus jelas:

1. Fluent API membangun query.
2. Repository menghasilkan Stream.
3. Stream melakukan transformation.
4. Collector menghasilkan summary.
5. Side effect tidak tersembunyi.

Jika semua dilakukan dalam satu chain dengan IO, mutation, audit, notification, dan DB write, desain menjadi kabur.

---

## 20. Java 8–25 Perspective

### Java 8

Java 8 memperkenalkan Stream API, lambda, method reference, functional interface, default method, dan Spliterator. Ini mengubah banyak pattern:

- Strategy menjadi lambda.
- Iterator diperluas oleh Spliterator.
- Pipeline transformation menjadi lebih deklaratif.
- Collector menjadi reusable reduction strategy.
- Fluent API semakin umum karena lambda-friendly API.

### Java 9–10

`takeWhile`, `dropWhile`, dan immutable collection factory membantu expressive pipeline.

`var` membantu mengurangi noise tetapi bisa merusak clarity jika type penting.

### Java 14–17

Records membantu data carrier untuk stream transformation.

```java
record OwnerViolationType(String ownerId, String violationTypeCode) {}
```

Sealed classes membantu fluent API atau pipeline result dengan closed alternatives.

```java
sealed interface ImportResult permits ImportResult.Success, ImportResult.Failed {
    record Success(int imported) implements ImportResult {}
    record Failed(String code, String message) implements ImportResult {}
}
```

### Java 21–25

Virtual threads membuat blocking loop lebih viable untuk IO-heavy workload, tetapi tidak otomatis membuat parallel stream cocok untuk IO.

Structured concurrency memengaruhi cara kita membuat fan-out/fan-in eksplisit dibanding menyembunyikan concurrency dalam Stream.

Scoped values membantu context propagation yang lebih aman daripada ThreadLocal dalam model modern, tetapi pipeline tetap harus jelas soal context boundary.

---

## 21. Resource Lifecycle with Stream

Stream bisa membawa resource.

Contoh file lines:

```java
try (Stream<String> lines = Files.lines(path)) {
    long count = lines
        .filter(line -> line.contains("ERROR"))
        .count();
}
```

Rule:

```text
Jika Stream berasal dari resource IO, gunakan try-with-resources.
```

Anti-pattern:

```java
public Stream<AuditEvent> streamEvents() {
    return jdbcTemplate.queryForStream(...);
}

// caller lupa close
Stream<AuditEvent> events = repository.streamEvents();
events.forEach(this::process);
```

Alternatif lebih aman:

```java
public void scanEvents(AuditCriteria criteria, Consumer<AuditEvent> consumer) {
    try (Stream<AuditEvent> events = openEventStream(criteria)) {
        events.forEach(consumer);
    }
}
```

Atau gunakan callback boundary:

```java
public <R> R withEventStream(
    AuditCriteria criteria,
    Function<Stream<AuditEvent>, R> operation
) {
    try (Stream<AuditEvent> events = openEventStream(criteria)) {
        return operation.apply(events);
    }
}
```

Trade-off:

- API lebih aman,
- caller tidak bisa lupa close,
- tetapi caller tidak bisa mengembalikan Stream keluar scope.

---

## 22. Error Handling in Stream

Stream kurang nyaman untuk checked exception.

Contoh buruk:

```java
files.stream()
    .map(file -> {
        try {
            return Files.readString(file);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    })
    .toList();
```

Ini bisa diterima untuk boundary kecil, tetapi jika error semantics penting, loop lebih jelas.

```java
List<FileImportResult> results = new ArrayList<>();

for (Path file : files) {
    try {
        String content = Files.readString(file);
        results.add(FileImportResult.success(file, content.length()));
    } catch (IOException e) {
        results.add(FileImportResult.failed(file, "READ_FAILED", e.getMessage()));
    }
}
```

Rule:

```text
Jika per-element failure adalah bagian dari domain result, jangan sembunyikan dalam unchecked exception pipeline.
```

---

## 23. Testing Strategy

### 23.1 Iterator Test

Test iterator harus mencakup:

1. empty source,
2. single element,
3. multiple elements,
4. `hasNext()` called repeatedly,
5. `next()` after exhausted,
6. resource close,
7. exception during fetch,
8. pagination boundary,
9. concurrent modification semantics.

Contoh:

```java
@Test
void hasNextIsIdempotent() {
    PaginatedCaseIterator iterator = new PaginatedCaseIterator(client, 2);

    assertTrue(iterator.hasNext());
    assertTrue(iterator.hasNext());

    CaseSummary first = iterator.next();
    assertEquals("CASE-1", first.id());
}
```

---

### 23.2 Stream Pipeline Test

Jangan hanya test pipeline panjang lewat final result jika logic penting. Ekstrak predicate/mapper.

```java
@Test
void overdueOpenCaseRequiresReminder() {
    assertTrue(policy.requiresReminder(openOverdueCase()));
    assertFalse(policy.requiresReminder(closedOverdueCase()));
}
```

Pipeline:

```java
List<ReminderTarget> targets = cases.stream()
    .filter(reminderPolicy::requiresReminder)
    .map(reminderMapper::toTarget)
    .toList();
```

---

### 23.3 Collector Test

Custom collector harus dites sequential dan parallel.

```java
@Test
void collectorWorksInParallel() {
    DecisionSummary summary = decisions.parallelStream()
        .collect(decisionSummaryCollector());

    assertEquals(expectedTotal, summary.total());
}
```

Jika parallel tidak didukung, dokumentasikan dan hindari klaim characteristics yang salah.

---

### 23.4 Fluent API Test

Test fluent API harus mencakup:

1. valid chain,
2. invalid required field,
3. invalid value,
4. default value,
5. method order jika staged,
6. immutability/mutability behavior,
7. terminal operation side effect.

---

## 24. Observability and Debugging Angle

Iteration/pipeline API perlu observability jika:

1. traversal lazy,
2. source remote,
3. source paginated,
4. processing batch besar,
5. pipeline punya filter signifikan,
6. terminal operation punya side effect.

Metrics yang berguna:

```text
items.scanned
items.filtered
items.processed
items.failed
page.fetch.count
page.fetch.latency
stream.processing.duration
collector.result.size
```

Log yang berguna:

```text
scan_id
query_criteria_hash
page_number
page_size
processed_count
failure_code
terminal_operation
```

Hindari log per item untuk batch besar kecuali sampling atau error case.

---

## 25. Performance Consideration

### 25.1 Loop vs Stream

Loop tidak otomatis lebih cepat, Stream tidak otomatis lambat. Tetapi Stream memiliki overhead abstraction dan lambda allocation/inlining consideration.

Untuk hot path:

1. ukur dengan benchmark,
2. hindari asumsi,
3. lihat allocation,
4. lihat boxing/unboxing,
5. hindari stream nested berlebihan,
6. gunakan primitive stream jika relevan.

Contoh boxing issue:

```java
int sum = numbers.stream()
    .map(n -> n.value())
    .reduce(0, Integer::sum);
```

Lebih baik:

```java
int sum = numbers.stream()
    .mapToInt(NumberBox::value)
    .sum();
```

---

### 25.2 Large Dataset

Untuk dataset besar:

1. jangan collect semua jika bisa streaming,
2. gunakan pagination/cursor,
3. gunakan backpressure jika source cepat dan sink lambat,
4. batasi memory accumulator,
5. hindari `sorted()` global jika tidak perlu,
6. hindari `distinct()` global untuk data sangat besar tanpa sadar memory cost.

---

## 26. Security and Compliance Angle

Iteration dan pipeline sering menyentuh data banyak. Risiko:

1. PII leak saat logging pipeline,
2. authorization filter lupa diterapkan,
3. stream resource dibiarkan terbuka,
4. partial processing tanpa audit,
5. batch operation tanpa idempotency,
6. fluent API memungkinkan query terlalu luas.

Contoh query fluent yang harus dibatasi:

```java
CaseQuery.open()
    .limit(1_000_000)
    .execute();
```

Harus ada maximum limit.

```java
public OptionalStep limit(int limit) {
    if (limit <= 0 || limit > 500) {
        throw new IllegalArgumentException("limit must be between 1 and 500");
    }
    this.limit = limit;
    return this;
}
```

Compliance-friendly iteration harus mencatat:

1. siapa menjalankan,
2. kriteria selection,
3. jumlah data diproses,
4. failure count,
5. waktu mulai/selesai,
6. correlation ID.

---

## 27. Anti-Pattern Catalog

### 27.1 Stream for Everything

Gejala:

```java
items.stream().forEach(item -> {
    if (...) {
        try {
            ...
        } catch (...) {
            ...
        }
    }
});
```

Jika isi `forEach` adalah mini program imperative, gunakan loop.

---

### 27.2 Parallel Stream for IO

Gejala:

```java
ids.parallelStream()
    .map(api::fetch)
    .toList();
```

Risiko:

- common pool starvation,
- rate limit issue,
- timeout chaos,
- poor context propagation.

---

### 27.3 Iterator Leaking Resource

Gejala:

```java
Iterator<Row> rows = repository.rows();
```

Padahal repository membuka cursor.

Fix:

```java
try (CloseableIterator<Row> rows = repository.rows()) { ... }
```

---

### 27.4 Fluent API Hiding Mutation

Gejala:

```java
order.approve().notifyOwner().save();
```

Tidak jelas method mana yang mutasi memory, kirim email, atau tulis DB.

Fix: pisahkan command/use case.

---

### 27.5 Collector with Broken Combiner

Gejala:

```java
Collector.of(
    ArrayList::new,
    List::add,
    (left, right) -> left
)
```

Sequential mungkin tampak benar, parallel salah.

---

### 27.6 Fluent API Without Terminal Boundary

Gejala:

```java
client.withX().withY().send().save().notify().audit();
```

Terminal operation bercampur banyak side effect.

Fix: satu terminal operation jelas, atau pisahkan operation.

---

### 27.7 Stream with Hidden Null Semantics

Gejala:

```java
cases.stream()
    .map(CaseFile::owner)
    .map(Owner::email)
    .toList();
```

Jika owner nullable, pipeline rapuh.

Fix:

```java
cases.stream()
    .map(CaseFile::owner)
    .filter(Objects::nonNull)
    .map(Owner::email)
    .toList();
```

Lebih baik: domain model tidak expose nullable jika owner required.

---

## 28. Refactoring Path

### 28.1 From Messy Loop to Stream

Awal:

```java
List<CaseDto> result = new ArrayList<>();
for (CaseFile caseFile : cases) {
    if (caseFile.isOpen()) {
        if (caseFile.owner() != null) {
            CaseDto dto = mapper.toDto(caseFile);
            result.add(dto);
        }
    }
}
```

Step 1: extract predicate.

```java
private boolean isVisibleOpenCase(CaseFile caseFile) {
    return caseFile.isOpen() && caseFile.owner() != null;
}
```

Step 2: stream.

```java
List<CaseDto> result = cases.stream()
    .filter(this::isVisibleOpenCase)
    .map(mapper::toDto)
    .toList();
```

---

### 28.2 From Bad Stream to Named Pipeline

Awal:

```java
List<Reminder> reminders = cases.stream()
    .filter(c -> c.status().isOpen() && c.deadline().isBefore(now) && c.owner() != null && c.owner().email() != null)
    .map(c -> new Reminder(c.id(), c.owner().email(), c.deadline()))
    .toList();
```

Refactor:

```java
List<Reminder> reminders = cases.stream()
    .filter(reminderPolicy::requiresReminder)
    .map(reminderFactory::createReminder)
    .toList();
```

Ini bukan hanya style. Ini memindahkan domain logic ke named object.

---

### 28.3 From Fluent Chain to Explicit Command

Awal:

```java
caseFile.approve().assignTo(manager).notifyOwner().audit().save();
```

Refactor:

```java
ApproveCaseCommand command = new ApproveCaseCommand(
    caseFile.id(),
    manager.id(),
    actor.id(),
    reason
);

approveCaseHandler.handle(command);
```

Use case handler mengatur:

1. load aggregate,
2. authorize,
3. validate transition,
4. mutate domain,
5. persist,
6. publish event,
7. audit.

---

## 29. Case Study: Regulatory Case Filtering and Summary

### 29.1 Problem

Sistem perlu mengambil case yang:

1. status open,
2. overdue,
3. bukan assigned ke inactive officer,
4. visible untuk current user,
5. dikelompokkan berdasarkan enforcement priority,
6. menghasilkan summary untuk dashboard.

Buruk:

```java
Map<Priority, Long> result = cases.stream()
    .filter(c -> c.status().equals(Status.OPEN))
    .filter(c -> c.deadline().isBefore(now))
    .filter(c -> c.assignedOfficer() != null && c.assignedOfficer().active())
    .filter(c -> security.canView(user, c))
    .collect(Collectors.groupingBy(c -> c.priority(), Collectors.counting()));
```

Masalah:

1. security call di pipeline bisa mahal,
2. policy tersebar,
3. reason kenapa case excluded tidak tersedia,
4. dashboard summary tidak explainable.

---

### 29.2 Better Design

Policy object:

```java
public final class DashboardCaseEligibilityPolicy {

    private final CaseVisibilityPolicy visibilityPolicy;
    private final Clock clock;

    public DashboardCaseEligibilityPolicy(
        CaseVisibilityPolicy visibilityPolicy,
        Clock clock
    ) {
        this.visibilityPolicy = visibilityPolicy;
        this.clock = clock;
    }

    public boolean eligibleFor(User user, CaseFile caseFile) {
        return caseFile.status() == Status.OPEN
            && caseFile.deadline().isBefore(LocalDate.now(clock))
            && caseFile.assignedOfficer().active()
            && visibilityPolicy.canView(user, caseFile);
    }
}
```

Pipeline:

```java
Map<Priority, Long> summary = cases.stream()
    .filter(caseFile -> eligibilityPolicy.eligibleFor(user, caseFile))
    .collect(Collectors.groupingBy(CaseFile::priority, Collectors.counting()));
```

If explainability matters:

```java
List<EligibilityDecision> decisions = cases.stream()
    .map(caseFile -> eligibilityPolicy.evaluate(user, caseFile))
    .toList();

Map<Priority, Long> summary = decisions.stream()
    .filter(EligibilityDecision::eligible)
    .map(EligibilityDecision::caseFile)
    .collect(Collectors.groupingBy(CaseFile::priority, Collectors.counting()));
```

Now system can answer:

```text
Why was this case excluded from dashboard?
```

This is crucial in regulatory systems.

---

## 30. Decision Matrix

| Situation | Prefer |
|---|---|
| Simple traversal with side effect | `for` loop |
| Declarative filter/map/reduce | Stream |
| Resource-backed traversal | Closeable cursor / callback |
| Custom collection | Iterable/Iterator |
| Parallel CPU-bound processing | Parallel stream only after measurement |
| Blocking IO fan-out | Explicit executor / structured concurrency |
| Aggregation/grouping | Collector |
| Domain query construction | Fluent query builder |
| Strict call order required | Staged fluent API |
| Complex per-item error handling | Loop or explicit result pipeline |
| Very large dataset | Cursor/pagination/backpressure-aware API |
| Need explainable decisions | Policy/rule object before Stream |

---

## 31. Design Review Checklist

### Iterator / Iterable

- Apakah iterator one-shot atau repeatable?
- Apakah `hasNext()` idempotent?
- Apakah traversal ordered?
- Apakah source snapshot atau live?
- Apakah ada resource yang harus ditutup?
- Apakah concurrent modification semantics jelas?
- Apakah exception model jelas?

### Stream

- Apakah pipeline readable?
- Apakah side effect dipisahkan?
- Apakah operation order benar?
- Apakah ada stateful operation mahal?
- Apakah Stream berasal dari resource dan ditutup?
- Apakah error handling sesuai domain?
- Apakah parallel stream benar-benar layak?

### Collector

- Apakah accumulator benar?
- Apakah combiner benar?
- Apakah finisher immutable?
- Apakah parallel behavior dites?
- Apakah characteristics jujur?

### Fluent API

- Apakah chain merepresentasikan bahasa domain?
- Apakah invalid sequence dicegah?
- Apakah terminal operation jelas?
- Apakah side effect eksplisit?
- Apakah mutable builder aman?
- Apakah error/failure terlihat?
- Apakah API tetap mudah di-debug?

---

## 32. Staff-Level Discussion Questions

1. Kenapa Stream bukan Collection?
2. Kapan loop lebih baik daripada Stream?
3. Apa risiko `parallelStream()` di backend service?
4. Apa perbedaan Iterator dan Spliterator?
5. Apa yang membuat custom Collector benar untuk parallel execution?
6. Kenapa `peek()` sering menjadi design smell?
7. Bagaimana mendesain iteration API untuk database cursor?
8. Bagaimana fluent API bisa menyembunyikan side effect?
9. Kapan staged builder/fluent API layak?
10. Bagaimana membuat pipeline decision logic tetap explainable?
11. Apa hubungan antara Specification/Policy dengan Stream filtering?
12. Bagaimana observability diterapkan pada batch pipeline?
13. Bagaimana resource lifecycle ditangani jika API mengembalikan Stream?
14. Apa trade-off immutable fluent API vs mutable builder?
15. Bagaimana Java modern records/sealed classes membantu pipeline result modeling?

---

## 33. Summary

Iterator, Stream, Collector, dan Fluent API adalah pattern yang terlihat sederhana tetapi sangat menentukan kualitas desain Java modern.

Mental model utama:

```text
Iterator  = explicit traversal boundary
Stream    = lazy computation pipeline
Collector = reduction strategy
Fluent API = small domain language
```

Gunakan Iterator/Cursor ketika traversal, resource, atau control flow harus eksplisit.

Gunakan Stream ketika transformasi data linear, deklaratif, dan bebas side effect berat.

Gunakan Collector ketika aggregation logic cukup penting untuk diberi nama, dites, dan digunakan ulang.

Gunakan Fluent API ketika API benar-benar membentuk bahasa domain yang lebih jelas, bukan sekadar chaining kosmetik.

Anti-pattern utama yang harus dihindari:

1. Stream untuk semua hal.
2. Parallel stream untuk IO.
3. Side effect tersembunyi dalam pipeline.
4. `peek()` untuk business logic.
5. Iterator yang membuka resource tanpa lifecycle eksplisit.
6. Fluent API yang menyembunyikan mutation dan failure.
7. Collector dengan combiner salah.
8. Chain terlalu panjang tanpa named domain concept.

Top 1% engineer tidak memilih Stream karena modern, loop karena cepat, atau fluent API karena cantik. Mereka memilih bentuk desain yang paling menjaga:

```text
correctness,
readability,
resource safety,
failure clarity,
observability,
maintainability,
and evolution path.
```

---

## 34. Referensi Lanjut

- Oracle Java SE 25 API Documentation — `java.util.stream.Stream`
- Oracle Java SE 25 API Documentation — `java.util.stream.StreamSupport`
- Oracle Java SE 8 API Documentation — `java.util.Spliterator`
- Oracle Java SE 8 API Documentation — `java.util.stream.Collectors`
- Martin Fowler — Fluent Interface
- Effective Java — Item tentang Iterator, Stream, Lambda, dan API design
- Design Patterns: Elements of Reusable Object-Oriented Software — Iterator Pattern
- Refactoring — Replace Loop with Pipeline dan Extract Function sebagai refactoring pendukung

---

## 35. Penutup Part 16

Bagian ini menutup kelompok behavioral pattern klasik-modern yang berhubungan dengan traversal, pipeline, aggregation, dan fluent API.

Bagian berikutnya akan masuk ke domain modeling modern dengan Java:

```text
17-data-domain-modeling-patterns-records-sealed-value-objects.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./15-behavioral-visitor-double-dispatch-pattern-matching-alternative.md">⬅️ Part 15 — Behavioral Pattern VI: Visitor, Double Dispatch, Pattern Matching Alternative</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./17-data-domain-modeling-patterns-records-sealed-value-objects.md">Data and Domain Modeling Patterns with Modern Java ➡️</a>
</div>
