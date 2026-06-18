# learn-java-dsa-part-025 — Concurrent Data Structures in Java, Without Repeating Concurrency Basics

> Seri: Java Data Structure and Algorithm Advanced  
> Bagian: 025 dari 030  
> Status seri: belum selesai  
> Fokus: concurrent data structures sebagai pilihan struktur data, bukan pengulangan konsep thread, virtual thread, lock, happens-before, atau reactive programming.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **thread-safe collection**, **synchronized wrapper**, dan **true concurrent data structure**.
2. Memilih struktur data concurrent berdasarkan operation mix: read-heavy, write-heavy, ordered, blocking, non-blocking, bounded, snapshot, atau sorted.
3. Memahami semantic penting seperti:
   - weakly consistent iterator,
   - snapshot iterator,
   - blocking queue semantics,
   - non-blocking queue semantics,
   - atomic map update,
   - copy-on-write mutation cost,
   - skip-list ordering,
   - contention hotspot.
4. Menghindari kesalahan umum seperti:
   - memakai `Collections.synchronizedMap` lalu iterasi tanpa external lock,
   - memakai `CopyOnWriteArrayList` untuk write-heavy workload,
   - memakai `ConcurrentHashMap.size()` sebagai decision boundary kuat,
   - membuat `computeIfAbsent` yang lambat atau side-effect-heavy,
   - memakai unbounded queue tanpa backpressure,
   - menganggap concurrent iterator adalah snapshot kuat.
5. Mendesain struktur data concurrent untuk kasus produksi seperti:
   - in-flight deduplication,
   - concurrent cache registry,
   - work dispatcher,
   - event buffer,
   - subscription registry,
   - idempotency guard,
   - deadline scheduler,
   - ordered concurrent index.

---

## 1. Batasan Pembahasan

Bagian ini **tidak mengulang** materi concurrency dasar seperti:

- thread lifecycle,
- monitor lock,
- `synchronized`,
- `volatile`,
- Java Memory Model secara formal,
- virtual threads,
- executors,
- reactive streams,
- CompletableFuture detail,
- structured concurrency.

Yang dibahas di sini adalah **struktur data** dan konsekuensi desainnya.

Pertanyaan utamanya bukan:

> “Bagaimana cara membuat kode concurrent?”

Melainkan:

> “Struktur data apa yang benar untuk state yang dimutasi/diakses oleh banyak thread, dan semantic apa yang sebenarnya kita dapatkan?”

---

## 2. Mental Model: Concurrent Data Structure adalah Contract, Bukan Sekadar Lock

Dalam single-threaded DSA, kita biasanya bertanya:

- operation apa yang cepat?
- memory overhead berapa?
- ordering dibutuhkan atau tidak?
- apakah key mutable?
- apakah perlu range query?

Dalam concurrent DSA, pertanyaannya bertambah:

- apakah banyak thread membaca?
- apakah banyak thread menulis?
- apakah read boleh stale?
- apakah iterasi harus konsisten penuh?
- apakah operasi harus blocking?
- apakah kapasitas harus dibatasi?
- apakah ordering global penting?
- apakah update harus atomic terhadap key tertentu?
- apakah operasi user-supplied function boleh dipanggil lebih dari sekali?
- apakah queue boleh tumbuh tanpa batas?
- apakah contention terkonsentrasi pada satu key?

Concurrent data structure bukan hanya “collection yang aman dari race condition”. Ia adalah paket trade-off antara:

1. **Correctness guarantee**
2. **Progress guarantee**
3. **Visibility guarantee**
4. **Iteration semantic**
5. **Contention behavior**
6. **Memory overhead**
7. **Latency profile**

---

## 3. Vocabulary yang Harus Tepat

### 3.1 Thread-safe

Thread-safe berarti struktur data dapat digunakan oleh beberapa thread tanpa corrupt internal state.

Tetapi thread-safe **tidak otomatis berarti**:

- semua operasi gabungan atomic,
- iterator memberi snapshot konsisten,
- `size()` selalu tepat untuk keputusan race-sensitive,
- performance bagus pada high contention,
- tidak bisa terjadi lost business invariant.

Contoh:

```java
if (!map.containsKey(id)) {
    map.put(id, value);
}
```

Pada concurrent map, masing-masing method bisa thread-safe, tetapi kombinasi `containsKey` lalu `put` bukan operasi atomic.

Solusi:

```java
map.putIfAbsent(id, value);
```

Atau jika value perlu dihitung lazy:

```java
map.computeIfAbsent(id, key -> loadValue(key));
```

### 3.2 Concurrent

Concurrent data structure biasanya dirancang agar beberapa thread dapat melakukan operasi secara bersamaan dengan contention yang lebih rendah daripada single global lock.

Contoh:

- `ConcurrentHashMap`
- `ConcurrentLinkedQueue`
- `ConcurrentSkipListMap`
- `LinkedBlockingQueue`
- `ArrayBlockingQueue`
- `CopyOnWriteArrayList`

Namun “concurrent” tidak berarti “selalu lebih cepat”. Pada data kecil, single-threaded collection dengan external discipline bisa lebih murah. Pada write-heavy workload, `CopyOnWriteArrayList` bisa sangat mahal. Pada key hotspot, `ConcurrentHashMap` tetap bisa mengalami contention.

### 3.3 Blocking

Blocking data structure dapat membuat producer/consumer menunggu sampai kondisi tertentu terpenuhi.

Contoh:

- consumer menunggu queue tidak kosong,
- producer menunggu queue tidak penuh.

`BlockingQueue` adalah contoh utama.

### 3.4 Non-blocking

Non-blocking structure tidak menunggu lock jangka panjang untuk progress normal. Banyak implementasi memakai CAS atau atomic primitive.

Contoh:

- `ConcurrentLinkedQueue`
- atomic reference structure custom

Namun non-blocking bukan berarti:

- latency selalu rendah,
- memory selalu kecil,
- tidak ada retry loop,
- tidak ada contention.

### 3.5 Lock-free, wait-free, obstruction-free

Secara teori:

- **lock-free**: sistem secara keseluruhan tetap progress walau satu thread tertunda.
- **wait-free**: setiap thread menyelesaikan operasi dalam jumlah langkah terbatas.
- **obstruction-free**: thread bisa progress jika berjalan sendiri tanpa gangguan.

Untuk engineering Java sehari-hari, cukup pahami bahwa non-blocking collection biasanya menghindari lock besar, tetapi tetap punya retry/coordination cost.

---

## 4. Taxonomy Concurrent Data Structures di Java

| Kebutuhan | Kandidat | Catatan |
|---|---|---|
| Concurrent key-value lookup | `ConcurrentHashMap` | Default untuk registry/cache concurrent |
| Ordered concurrent map | `ConcurrentSkipListMap` | Sorted, range query, `log n` |
| Ordered concurrent set | `ConcurrentSkipListSet` | Sorted set concurrent |
| Read-mostly list | `CopyOnWriteArrayList` | Snapshot iterator, write mahal |
| Read-mostly set | `CopyOnWriteArraySet` | Cocok untuk listener/subscriber kecil-menengah |
| Producer-consumer bounded | `ArrayBlockingQueue` | Bounded, backpressure jelas |
| Producer-consumer linked | `LinkedBlockingQueue` | Bisa bounded/unbounded; node allocation |
| Priority work queue | `PriorityBlockingQueue` | Unbounded, priority order, tidak otomatis FIFO untuk same priority |
| Delay scheduling | `DelayQueue` | Elemen tersedia setelah delay expire |
| Non-blocking FIFO | `ConcurrentLinkedQueue` | Many producer/consumer non-blocking queue |
| Blocking handoff | `SynchronousQueue` | Tidak menyimpan elemen; rendezvous producer-consumer |
| Work-stealing deque | `ConcurrentLinkedDeque` / fork-join internal deque | Cocok untuk task scheduling tertentu |
| Atomic single value | `AtomicReference`, `AtomicLong`, etc. | Building block untuk custom state |
| High contention counter | `LongAdder` | Lebih baik dari `AtomicLong` untuk update-heavy counter |

---

## 5. Synchronized Wrapper vs Concurrent Collection

Java menyediakan wrapper seperti:

```java
Map<K, V> map = Collections.synchronizedMap(new HashMap<>());
List<T> list = Collections.synchronizedList(new ArrayList<>());
Set<T> set = Collections.synchronizedSet(new HashSet<>());
```

Wrapper ini membuat method dasar synchronized pada mutex tertentu.

Namun ada konsekuensi:

1. Banyak operasi diserialisasi oleh satu lock.
2. Iterasi tetap perlu external synchronization.
3. Operasi gabungan tetap perlu lock manual.
4. Contention tinggi bisa membuat throughput turun.

Contoh yang salah:

```java
Map<String, Integer> map = Collections.synchronizedMap(new HashMap<>());

for (var entry : map.entrySet()) {
    process(entry);
}
```

Iterasi di atas tidak cukup aman jika thread lain dapat memodifikasi map.

Pola yang lebih benar untuk synchronized wrapper:

```java
synchronized (map) {
    for (var entry : map.entrySet()) {
        process(entry);
    }
}
```

Tetapi ini mengunci map selama seluruh iterasi. Jika `process` lambat, semua thread lain terblokir.

Maka untuk workload concurrent serius, biasanya gunakan collection dari `java.util.concurrent`.

---

## 6. `ConcurrentHashMap`: Default Workhorse untuk Concurrent Lookup

### 6.1 Mental model

`ConcurrentHashMap<K, V>` adalah pilihan default ketika banyak thread perlu membaca dan menulis key-value map.

Gunakan untuk:

- registry by ID,
- in-flight request tracking,
- idempotency guard,
- concurrent dedup set,
- cache sederhana,
- per-key lock registry,
- subscription mapping,
- correlation ID map,
- aggregation by key.

Jangan gunakan jika kamu butuh:

- sorted order,
- strong snapshot iteration,
- blocking semantics,
- bounded capacity built-in,
- eviction policy built-in,
- value expiration built-in.

### 6.2 Semantic penting

`ConcurrentHashMap` memiliki iterators/views yang **weakly consistent**.

Artinya:

- iterator tidak melempar `ConcurrentModificationException` hanya karena concurrent modification,
- iterator boleh melihat sebagian update yang terjadi setelah iterator dibuat,
- iterator tidak memberikan snapshot penuh yang kuat,
- iterator tidak cocok sebagai basis keputusan yang membutuhkan konsistensi global sempurna.

Contoh aman untuk monitoring kira-kira:

```java
for (var entry : activeSessions.entrySet()) {
    emitMetric(entry.getKey(), entry.getValue());
}
```

Contoh berbahaya jika butuh keputusan mutlak:

```java
if (activeSessions.size() < maxAllowed) {
    activeSessions.put(sessionId, session);
}
```

Di antara `size()` dan `put`, thread lain bisa menambah session.

### 6.3 Atomic per-key operations

Gunakan operasi atomic:

```java
map.putIfAbsent(key, value);
map.remove(key, expectedValue);
map.replace(key, oldValue, newValue);
map.compute(key, (k, old) -> newValue);
map.computeIfAbsent(key, k -> createValue(k));
map.merge(key, delta, Integer::sum);
```

Contoh in-flight dedup:

```java
public final class InFlightRegistry<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    public CompletableFuture<V> getOrStart(K key, Supplier<CompletableFuture<V>> starter) {
        return inFlight.computeIfAbsent(key, k ->
            starter.get().whenComplete((value, error) -> inFlight.remove(k))
        );
    }
}
```

Invariant:

```text
For each key, at most one active future exists in the registry.
```

Tetapi hati-hati: fungsi di dalam `computeIfAbsent` sebaiknya:

- tidak terlalu lambat,
- tidak melakukan nested update kompleks ke map yang sama,
- tidak mengandalkan side effect yang harus persis sekali tanpa strategi tambahan,
- tidak memanggil operasi blocking lama.

### 6.4 `computeIfAbsent` bukan silver bullet

Contoh buruk:

```java
cache.computeIfAbsent(key, k -> {
    auditService.writeAudit(k);       // side effect
    return remoteService.call(k);     // slow I/O
});
```

Masalah:

1. Side effect bercampur dengan cache population.
2. Remote I/O bisa menahan internal coordination lebih lama dari yang diinginkan.
3. Jika mapping gagal, behavior retry perlu dipikirkan.
4. Jika banyak key hotspot, latency membesar.

Alternatif lebih eksplisit:

```java
CompletableFuture<Value> existing = inFlight.putIfAbsent(key, createdFuture);
if (existing != null) {
    return existing;
}

try {
    remote call...
} finally {
    inFlight.remove(key, createdFuture);
}
```

### 6.5 `ConcurrentHashMap.newKeySet()`

Untuk concurrent set tanpa value penting:

```java
Set<String> seen = ConcurrentHashMap.newKeySet();

if (seen.add(requestId)) {
    process(requestId);
}
```

Ini sering lebih tepat daripada:

```java
Map<String, Boolean> seen = new ConcurrentHashMap<>();
```

Use cases:

- visited set concurrent,
- active user ID set,
- currently processing keys,
- dedup event ID.

### 6.6 Counter di `ConcurrentHashMap`

Naif:

```java
map.put(key, map.getOrDefault(key, 0) + 1);
```

Ini race-prone.

Lebih benar:

```java
map.merge(key, 1, Integer::sum);
```

Untuk high contention counter:

```java
ConcurrentHashMap<String, LongAdder> counters = new ConcurrentHashMap<>();

counters.computeIfAbsent(key, ignored -> new LongAdder()).increment();
```

Kenapa `LongAdder`?

`AtomicLong` bagus untuk single atomic counter, tetapi pada update-heavy contention, semua thread berebut satu lokasi atomic. `LongAdder` memecah update ke beberapa cell internal sehingga throughput update sering lebih baik, dengan trade-off pembacaan sum yang bukan transactional snapshot terhadap update concurrent.

### 6.7 Anti-pattern `size()`

`size()` pada concurrent collection sering lebih cocok untuk observability, bukan strict control.

Buruk:

```java
if (queueMap.size() < limit) {
    queueMap.put(id, item);
}
```

Lebih baik gunakan primitive yang memang merepresentasikan kapasitas:

- `Semaphore`,
- bounded `BlockingQueue`,
- atomic permit counter,
- `Caffeine` maximum size untuk cache,
- database unique constraint untuk global invariant.

---

## 7. `CopyOnWriteArrayList`: Read-Mostly Snapshot Structure

### 7.1 Mental model

`CopyOnWriteArrayList` menyimpan elemen dalam array. Setiap mutasi seperti add/remove membuat copy array baru.

Iterator memakai snapshot array pada saat iterator dibuat.

Artinya:

- traversal tidak perlu lock external,
- iterator tidak melihat perubahan setelah iterator dibuat,
- write mahal karena copy array,
- cocok ketika read jauh lebih sering daripada write.

### 7.2 Use cases yang cocok

1. Listener registry.
2. Subscriber list yang jarang berubah.
3. Feature hook list.
4. Small plugin chain.
5. Static-ish policy observers.

Contoh:

```java
public final class EventBus<E> {
    private final CopyOnWriteArrayList<Consumer<E>> listeners = new CopyOnWriteArrayList<>();

    public void subscribe(Consumer<E> listener) {
        listeners.add(Objects.requireNonNull(listener));
    }

    public void unsubscribe(Consumer<E> listener) {
        listeners.remove(listener);
    }

    public void publish(E event) {
        for (Consumer<E> listener : listeners) {
            listener.accept(event);
        }
    }
}
```

Invariant:

```text
Publish sees a stable snapshot of subscribers.
Subscription changes do not interfere with an ongoing publish iteration.
```

### 7.3 Use cases yang buruk

Jangan gunakan untuk:

- queue,
- frequently updated list,
- large list with many writes,
- per-request mutation,
- high-churn membership,
- write-heavy registry.

Buruk:

```java
CopyOnWriteArrayList<Request> activeRequests = new CopyOnWriteArrayList<>();
```

Jika request masuk/keluar sangat sering, setiap add/remove copy array.

### 7.4 Snapshot bukan live view

Contoh:

```java
Iterator<String> it = list.iterator();
list.add("new");

while (it.hasNext()) {
    System.out.println(it.next());
}
```

Iterator lama tidak wajib melihat elemen baru.

Ini feature, bukan bug.

---

## 8. Concurrent Queues: Memilih Berdasarkan Flow Control

Queue concurrent bukan hanya masalah FIFO. Pertanyaan yang lebih penting:

1. Apakah producer boleh menunggu?
2. Apakah consumer boleh menunggu?
3. Apakah queue bounded?
4. Apa yang terjadi saat penuh?
5. Apakah ordering strict FIFO?
6. Apakah priority dibutuhkan?
7. Apakah delay scheduling dibutuhkan?
8. Apakah handoff langsung dibutuhkan?
9. Apakah memory boleh tumbuh tanpa batas?

---

## 9. `BlockingQueue`: Producer-Consumer dengan Backpressure

### 9.1 Mental model

`BlockingQueue<E>` menyediakan operasi yang bisa:

- gagal langsung,
- return special value,
- block indefinitely,
- block dengan timeout.

Pattern method umumnya:

| Intent | Throws | Special value | Blocks | Timeout |
|---|---|---|---|---|
| Insert | `add(e)` | `offer(e)` | `put(e)` | `offer(e, time, unit)` |
| Remove | `remove()` | `poll()` | `take()` | `poll(time, unit)` |
| Examine | `element()` | `peek()` | - | - |

### 9.2 `ArrayBlockingQueue`

Karakter:

- bounded,
- array-backed,
- fixed capacity,
- bagus untuk backpressure eksplisit,
- memory lebih predictable,
- cocok untuk worker queue dengan batas jelas.

Contoh:

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(10_000);

boolean accepted = queue.offer(job, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    rejectOrDegrade(job);
}
```

Gunakan ketika:

- overload harus terlihat,
- memory harus dibatasi,
- producer tidak boleh menumpuk pekerjaan tak terbatas,
- sistem butuh graceful degradation.

### 9.3 `LinkedBlockingQueue`

Karakter:

- linked-node queue,
- bisa bounded jika capacity diberikan,
- default constructor secara praktis sangat besar/unbounded-like,
- setiap elemen berarti node allocation,
- throughput bisa baik untuk producer-consumer,
- memory risk jika tidak dibatasi.

Buruk:

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>(); // effectively unbounded
```

Pada traffic spike, queue bisa tumbuh sampai memory pressure/GC/OOM.

Lebih baik:

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>(50_000);
```

### 9.4 `PriorityBlockingQueue`

Karakter:

- priority-based,
- unbounded,
- tidak memblokir producer karena penuh,
- cocok untuk job priority,
- perlu comparator stabil,
- elemen dengan priority sama tidak otomatis FIFO kecuali kamu encode tie-breaker.

Contoh:

```java
record Job(long deadlineMillis, long sequence, Runnable task) {}

Comparator<Job> byDeadlineThenSequence =
    Comparator.comparingLong(Job::deadlineMillis)
              .thenComparingLong(Job::sequence);

BlockingQueue<Job> queue = new PriorityBlockingQueue<>(1024, byDeadlineThenSequence);
```

Tie-breaker penting agar deterministic.

### 9.5 `DelayQueue`

Karakter:

- elemen hanya bisa diambil setelah delay expire,
- cocok untuk retry scheduler,
- expiration scheduler,
- delayed task dispatch.

Elemen harus implement `Delayed`.

Contoh sederhana:

```java
public record RetryTask(
    String id,
    long runAtNanos,
    Runnable action
) implements Delayed {

    @Override
    public long getDelay(TimeUnit unit) {
        long remaining = runAtNanos - System.nanoTime();
        return unit.convert(remaining, TimeUnit.NANOSECONDS);
    }

    @Override
    public int compareTo(Delayed other) {
        RetryTask that = (RetryTask) other;
        return Long.compare(this.runAtNanos, that.runAtNanos);
    }
}
```

### 9.6 `SynchronousQueue`

Karakter:

- tidak menyimpan elemen,
- producer dan consumer harus rendezvous,
- cocok untuk direct handoff,
- sering muncul dalam executor design.

Jangan pakai jika kamu butuh buffering.

---

## 10. `ConcurrentLinkedQueue`: Non-blocking FIFO Queue

### 10.1 Mental model

`ConcurrentLinkedQueue<E>` adalah FIFO queue non-blocking berbasis linked nodes.

Cocok ketika:

- banyak producer/consumer,
- kamu tidak ingin blocking pada queue operation,
- kapasitas tidak perlu dibatasi oleh queue itu sendiri,
- polling dilakukan oleh loop/scheduler eksternal.

Contoh:

```java
Queue<Event> queue = new ConcurrentLinkedQueue<>();

queue.offer(event);

Event event;
while ((event = queue.poll()) != null) {
    handle(event);
}
```

### 10.2 Kelemahan

1. Tidak bounded.
2. Tidak ada backpressure built-in.
3. `size()` bisa mahal dan tidak cocok untuk kontrol presisi.
4. Node allocation per element.
5. Consumer polling loop bisa busy-spin jika tidak hati-hati.

Jika kamu butuh producer menunggu saat penuh, gunakan `BlockingQueue` bounded.

---

## 11. `ConcurrentSkipListMap` dan `ConcurrentSkipListSet`: Ordered Concurrent Index

### 11.1 Mental model

Skip list adalah probabilistic ordered data structure dengan expected `O(log n)` untuk operasi lookup/update.

Di Java:

- `ConcurrentSkipListMap<K, V>` adalah concurrent sorted/navigable map.
- `ConcurrentSkipListSet<E>` adalah concurrent sorted/navigable set.

Gunakan ketika butuh:

- concurrent access,
- sorted key,
- range query,
- floor/ceiling/lower/higher,
- earliest deadline lookup,
- time-indexed data,
- ordered registry.

### 11.2 Contoh: deadline index

```java
public final class DeadlineIndex<T> {
    private final ConcurrentSkipListMap<Long, ConcurrentLinkedQueue<T>> byDeadline =
        new ConcurrentSkipListMap<>();

    public void add(long deadlineEpochMillis, T item) {
        byDeadline.computeIfAbsent(deadlineEpochMillis, ignored -> new ConcurrentLinkedQueue<>())
                  .offer(item);
    }

    public List<T> dueUntil(long nowEpochMillis, int max) {
        List<T> result = new ArrayList<>(max);

        while (result.size() < max) {
            Map.Entry<Long, ConcurrentLinkedQueue<T>> first = byDeadline.firstEntry();
            if (first == null || first.getKey() > nowEpochMillis) {
                break;
            }

            T item = first.getValue().poll();
            if (item != null) {
                result.add(item);
                continue;
            }

            byDeadline.remove(first.getKey(), first.getValue());
        }

        return result;
    }
}
```

Invariant:

```text
Keys are ordered by deadline.
Each deadline bucket contains tasks for that deadline.
Empty buckets are eventually removed.
```

### 11.3 Trade-off

Dibanding `ConcurrentHashMap`:

| Aspect | `ConcurrentHashMap` | `ConcurrentSkipListMap` |
|---|---|---|
| Key lookup | expected near O(1) | O(log n) expected |
| Ordering | no | yes |
| Range query | no native sorted range | yes |
| Memory | hash table nodes/bins | skip-list nodes/levels |
| Use case | registry/cache | ordered index |

---

## 12. Snapshot, Weak Consistency, Fail-Fast: Jangan Disamakan

Ada tiga keluarga iterator yang sering membingungkan.

### 12.1 Fail-fast iterator

Banyak collection biasa seperti `ArrayList`, `HashMap`, `LinkedList` punya iterator yang fail-fast secara best-effort ketika collection dimodifikasi secara struktural di luar iterator.

Tujuannya mendeteksi bug, bukan memberi guarantee concurrency.

### 12.2 Weakly consistent iterator

Concurrent collections seperti `ConcurrentHashMap` sering punya iterator weakly consistent.

Artinya:

- aman terhadap concurrent modification,
- tidak throw `ConcurrentModificationException` karena concurrent update,
- bisa melihat sebagian update,
- bukan snapshot kuat.

### 12.3 Snapshot iterator

`CopyOnWriteArrayList` menyediakan snapshot-style iterator.

Artinya iterator melihat array pada saat iterator dibuat.

| Semantic | Contoh | Melihat update setelah iterator dibuat? | Throw CME? | Cocok untuk |
|---|---|---:|---:|---|
| Fail-fast | `ArrayList` | tidak reliable | bisa | bug detection single-thread discipline |
| Weakly consistent | `ConcurrentHashMap` | mungkin | tidak | monitoring/traversal concurrent |
| Snapshot | `CopyOnWriteArrayList` | tidak | tidak | read-mostly stable traversal |

---

## 13. Atomic Reference Structures

Kadang collection terlalu besar untuk problem kecil. Kamu hanya perlu satu state reference yang diganti atomically.

### 13.1 Immutable snapshot with `AtomicReference`

```java
public final class RuleSnapshotRegistry {
    private final AtomicReference<Map<String, Rule>> snapshot =
        new AtomicReference<>(Map.of());

    public Rule get(String ruleId) {
        return snapshot.get().get(ruleId);
    }

    public void replaceAll(Map<String, Rule> newRules) {
        snapshot.set(Map.copyOf(newRules));
    }
}
```

Kelebihan:

- read sangat murah,
- tidak perlu lock pada read,
- snapshot konsisten,
- update mengganti seluruh versi.

Trade-off:

- update full-copy,
- tidak cocok untuk write-heavy per-key mutation,
- memory sementara bisa naik saat replace.

Ini sangat cocok untuk:

- rule config,
- feature flags,
- routing table,
- workflow definition snapshot,
- permission matrix snapshot.

### 13.2 CAS loop

```java
public void addRule(String id, Rule rule) {
    while (true) {
        Map<String, Rule> oldSnapshot = snapshot.get();

        Map<String, Rule> mutable = new HashMap<>(oldSnapshot);
        mutable.put(id, rule);
        Map<String, Rule> newSnapshot = Map.copyOf(mutable);

        if (snapshot.compareAndSet(oldSnapshot, newSnapshot)) {
            return;
        }
    }
}
```

Ini lock-free-ish dari sisi state reference, tetapi jika contention tinggi, CAS bisa gagal berulang.

---

## 14. ABA Problem: Konsep yang Perlu Dikenal

ABA problem terjadi ketika thread melihat value berubah dari A ke B lalu kembali ke A, sehingga compare-and-set mengira tidak ada perubahan bermakna.

Contoh abstrak:

```text
Thread 1 reads head = A
Thread 2 changes A -> B -> A
Thread 1 CAS head from A to C succeeds
```

Padahal struktur internal mungkin sudah berubah.

Dalam kebanyakan aplikasi bisnis Java, kamu jarang menulis lock-free linked structure sendiri. Tetapi penting mengenali ABA jika memakai:

- custom stack lock-free,
- custom queue lock-free,
- object pool,
- freelist,
- off-heap pointer-like structure,
- highly optimized concurrent algorithm.

Mitigasi umum:

- stamped reference,
- version counter,
- immutable node lifecycle,
- avoid custom lock-free unless necessary.

Java menyediakan `AtomicStampedReference` untuk membawa stamp/version bersama reference.

---

## 15. Contention: Complexity Baru dalam Concurrent DSA

Dalam DSA biasa, kita sering bicara `O(1)`, `O(log n)`, `O(n)`.

Dalam concurrent DSA, ada dimensi tambahan:

```text
cost = algorithmic complexity + coordination cost + contention cost + memory visibility cost + allocation/GC cost
```

### 15.1 Hot key problem

Misalnya:

```java
ConcurrentHashMap<String, LongAdder> counters = new ConcurrentHashMap<>();
counters.computeIfAbsent("GLOBAL", ignored -> new LongAdder()).increment();
```

Walau `LongAdder` membantu, semua traffic menuju satu logical key. Jika operation di sekitar key menjadi lebih kompleks, contention tetap terkonsentrasi.

### 15.2 Hot queue problem

Satu global queue:

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(100_000);
```

Bisa menjadi bottleneck jika semua producer dan consumer berebut struktur sama.

Alternatif:

- sharded queues,
- per-partition queues,
- work stealing,
- consistent hashing by key,
- actor/mailbox per entity,
- batching.

### 15.3 False sharing

False sharing terjadi ketika beberapa variable yang sering diupdate thread berbeda berada di cache line yang sama. Secara algoritmik tidak tampak, tetapi performance bisa buruk.

Dalam kode high-performance, gunakan abstraction yang sudah mempertimbangkan ini seperti `LongAdder`, atau desain sharding counter yang lebih baik.

---

## 16. Bounded vs Unbounded: Ini Bukan Detail Kecil

Unbounded collection dalam sistem produksi adalah risiko.

Contoh berbahaya:

```java
Queue<Event> queue = new ConcurrentLinkedQueue<>();
```

Jika consumer lebih lambat dari producer, queue tumbuh tanpa batas.

Efeknya:

1. Heap naik.
2. GC pressure naik.
3. Latency naik.
4. CPU habis untuk GC.
5. Sistem menjadi makin lambat.
6. Queue makin menumpuk.
7. Akhirnya OOM atau total degradation.

Bounded queue membuat overload terlihat lebih awal.

```java
BlockingQueue<Event> queue = new ArrayBlockingQueue<>(10_000);

if (!queue.offer(event)) {
    metrics.incrementDroppedEvents();
    fallback(event);
}
```

Top-tier engineering sering memilih bounded structure bukan karena suka menolak request, tetapi karena ingin failure mode yang jelas.

---

## 17. Pattern: Concurrent Dedup Set

Problem:

> Banyak worker menerima event. Event dengan `eventId` sama tidak boleh diproses dua kali secara bersamaan.

Solusi sederhana:

```java
public final class ProcessingGuard {
    private final Set<String> processing = ConcurrentHashMap.newKeySet();

    public boolean tryEnter(String eventId) {
        return processing.add(eventId);
    }

    public void exit(String eventId) {
        processing.remove(eventId);
    }
}
```

Usage:

```java
if (!guard.tryEnter(event.id())) {
    return;
}

try {
    process(event);
} finally {
    guard.exit(event.id());
}
```

Invariant:

```text
At most one active processor per eventId inside this JVM.
```

Limitasi:

- hanya dalam satu JVM,
- tidak tahan crash tanpa external recovery,
- bukan global distributed idempotency,
- perlu TTL/cleanup jika flow bisa bocor sebelum `finally`.

---

## 18. Pattern: In-Flight Deduplication for Remote Calls

Problem:

> Banyak request meminta data key yang sama. Jangan panggil remote API berkali-kali untuk key sama ketika call pertama masih berjalan.

Solusi:

```java
public final class InFlightDeduplicator<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    public CompletableFuture<V> get(K key, Function<K, CompletableFuture<V>> loader) {
        CompletableFuture<V> existing = inFlight.get(key);
        if (existing != null) {
            return existing;
        }

        CompletableFuture<V> created = loader.apply(key);
        CompletableFuture<V> raced = inFlight.putIfAbsent(key, created);

        if (raced != null) {
            return raced;
        }

        created.whenComplete((value, error) -> inFlight.remove(key, created));
        return created;
    }
}
```

Kenapa tidak langsung `computeIfAbsent`?

Bisa saja, tetapi untuk async loader kadang lebih jelas memisahkan:

- future creation,
- put race,
- cleanup,
- cancellation/error semantics.

Failure modes:

1. Future tidak pernah selesai → entry bocor.
2. Cancellation satu caller membatalkan shared future untuk caller lain.
3. Loader side effect terjadi walau kalah race jika dibuat sebelum `putIfAbsent`.
4. Perlu timeout policy.

Versi lebih aman bisa membuat future setelah menang race, tetapi implementasinya lebih panjang.

---

## 19. Pattern: Read-Mostly Listener Registry

Problem:

> Listener jarang berubah, event publish sangat sering.

Gunakan `CopyOnWriteArrayList`.

```java
public final class ListenerRegistry<E> {
    private final CopyOnWriteArrayList<Consumer<E>> listeners = new CopyOnWriteArrayList<>();

    public void add(Consumer<E> listener) {
        listeners.add(Objects.requireNonNull(listener));
    }

    public void remove(Consumer<E> listener) {
        listeners.remove(listener);
    }

    public void publish(E event) {
        for (Consumer<E> listener : listeners) {
            try {
                listener.accept(event);
            } catch (RuntimeException ex) {
                // isolate bad listener
                handleListenerFailure(listener, ex);
            }
        }
    }

    private void handleListenerFailure(Consumer<E> listener, RuntimeException ex) {
        // log/metric/quarantine depending on system policy
    }
}
```

Invariant:

```text
Publish traversal is not structurally affected by concurrent subscribe/unsubscribe.
```

---

## 20. Pattern: Bounded Work Dispatcher

Problem:

> Producers menghasilkan job. Worker memproses job. Jika overload, sistem harus melakukan backpressure atau reject.

```java
public final class BoundedDispatcher<T> implements AutoCloseable {
    private final BlockingQueue<T> queue;
    private final List<Thread> workers;
    private volatile boolean running = true;

    public BoundedDispatcher(int capacity, int workerCount, Consumer<T> handler) {
        this.queue = new ArrayBlockingQueue<>(capacity);
        this.workers = new ArrayList<>(workerCount);

        for (int i = 0; i < workerCount; i++) {
            Thread worker = Thread.ofPlatform().name("dispatcher-worker-" + i).start(() -> {
                while (running || !queue.isEmpty()) {
                    try {
                        T item = queue.poll(250, TimeUnit.MILLISECONDS);
                        if (item != null) {
                            handler.accept(item);
                        }
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            });
            workers.add(worker);
        }
    }

    public boolean submit(T item, long timeoutMillis) throws InterruptedException {
        return queue.offer(item, timeoutMillis, TimeUnit.MILLISECONDS);
    }

    @Override
    public void close() {
        running = false;
        for (Thread worker : workers) {
            worker.interrupt();
        }
    }
}
```

DSA insight:

- `ArrayBlockingQueue` memberi bounded buffer.
- `offer` dengan timeout memberi controlled backpressure.
- `poll` dengan timeout memungkinkan shutdown check.

Catatan:

Dalam production Java modern, biasanya worker management memakai `ExecutorService` atau structured concurrency abstraction, tetapi inti struktur datanya tetap bounded queue.

---

## 21. Pattern: Concurrent Cache Registry, Bukan Production Cache Lengkap

Problem:

> Butuh cache sederhana per key dalam satu JVM.

Minimal:

```java
public final class SimpleConcurrentCache<K, V> {
    private final ConcurrentHashMap<K, V> map = new ConcurrentHashMap<>();

    public V getOrLoad(K key, Function<K, V> loader) {
        return map.computeIfAbsent(key, loader);
    }

    public void invalidate(K key) {
        map.remove(key);
    }
}
```

Ini bukan cache production-grade karena tidak punya:

- max size,
- TTL,
- refresh,
- eviction policy,
- stampede protection lengkap,
- metrics,
- async loading semantic,
- weak/soft reference policy,
- removal listener.

Untuk production cache, pertimbangkan library seperti Caffeine.

Namun sebagai DSA lesson, `ConcurrentHashMap` cocok untuk memahami registry concurrent.

---

## 22. Pattern: Immutable Snapshot + Atomic Swap

Problem:

> Banyak request membaca rule configuration. Update jarang terjadi, tetapi read harus konsisten dan cepat.

```java
public final class WorkflowDefinitionStore {
    private final AtomicReference<WorkflowDefinitions> current =
        new AtomicReference<>(WorkflowDefinitions.empty());

    public WorkflowDefinitions current() {
        return current.get();
    }

    public void publish(WorkflowDefinitions definitions) {
        current.set(definitions.freeze());
    }
}
```

`WorkflowDefinitions` bisa berisi:

```java
public final class WorkflowDefinitions {
    private final Map<String, Workflow> byId;
    private final Map<String, Set<String>> transitionsByState;
    private final Map<String, Rule> rulesById;

    // all maps immutable
}
```

Kelebihan:

- read tidak lock,
- setiap request melihat satu versi konsisten,
- update atomic secara reference,
- cocok untuk config/rule/workflow.

Ini sering lebih baik daripada concurrent map jika update dilakukan sebagai satu batch versi.

---

## 23. Choosing the Right Concurrent Structure

### 23.1 Decision table

| Pertanyaan | Jika jawabannya ya | Struktur kandidat |
|---|---|---|
| Butuh lookup by key concurrent? | Ya | `ConcurrentHashMap` |
| Butuh set concurrent? | Ya | `ConcurrentHashMap.newKeySet()` |
| Butuh ordered/range query concurrent? | Ya | `ConcurrentSkipListMap` / `ConcurrentSkipListSet` |
| Read jauh lebih sering dari write? | Ya | `CopyOnWriteArrayList` / immutable snapshot |
| Butuh producer-consumer menunggu? | Ya | `BlockingQueue` |
| Butuh bounded backpressure? | Ya | `ArrayBlockingQueue` / bounded `LinkedBlockingQueue` |
| Butuh non-blocking FIFO? | Ya | `ConcurrentLinkedQueue` |
| Butuh priority blocking? | Ya | `PriorityBlockingQueue` |
| Butuh delayed availability? | Ya | `DelayQueue` |
| Butuh direct handoff tanpa buffer? | Ya | `SynchronousQueue` |
| Butuh update seluruh config secara atomic? | Ya | `AtomicReference<ImmutableSnapshot>` |
| Butuh high-contention counter? | Ya | `LongAdder` |

### 23.2 Operation mix lebih penting daripada nama struktur

Contoh:

- `ConcurrentHashMap` bagus untuk many-key concurrent access.
- Tetapi untuk satu key yang sangat hot, bottleneck tetap bisa ada.
- `CopyOnWriteArrayList` bagus untuk listener registry.
- Tetapi buruk untuk active session list yang berubah setiap request.
- `ConcurrentLinkedQueue` bagus untuk non-blocking handoff.
- Tetapi buruk jika kamu butuh overload control.
- `ConcurrentSkipListMap` bagus untuk sorted deadline index.
- Tetapi lebih mahal dari hash map untuk lookup biasa.

---

## 24. Failure Modes yang Sering Terjadi

### 24.1 Compound action tidak atomic

Buruk:

```java
if (!map.containsKey(key)) {
    map.put(key, value);
}
```

Benar:

```java
map.putIfAbsent(key, value);
```

### 24.2 Write-heavy `CopyOnWriteArrayList`

Buruk:

```java
CopyOnWriteArrayList<Order> activeOrders = new CopyOnWriteArrayList<>();
```

Jika active order sering berubah, gunakan map/set/queue lain.

### 24.3 Unbounded queue

Buruk:

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>();
```

Lebih aman:

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>(capacity);
```

### 24.4 Iterator dianggap snapshot kuat

Buruk:

```java
for (var entry : concurrentMap.entrySet()) {
    // assume this is complete consistent snapshot
}
```

Jika butuh snapshot:

```java
Map<K, V> snapshot = Map.copyOf(concurrentMap);
```

Tetapi `Map.copyOf` juga mengambil snapshot pada satu proses iterasi yang bisa melihat state weakly consistent jika source-nya concurrent. Jika butuh transactional snapshot, desain state harus immutable-versioned atau dilindungi lock/transaction.

### 24.5 `size()` dipakai sebagai gate

Buruk:

```java
if (map.size() < max) {
    map.put(key, value);
}
```

Gunakan bounded queue/semaphore/atomic permit.

### 24.6 Blocking inside map compute

Buruk:

```java
map.compute(key, (k, old) -> remoteCall(k));
```

Lebih baik pisahkan remote call dari critical update path jika memungkinkan.

### 24.7 Tidak membersihkan in-flight registry

Buruk:

```java
inFlight.put(id, future);
return future;
```

Jika tidak dihapus setelah selesai, memory leak.

Benar:

```java
future.whenComplete((v, e) -> inFlight.remove(id, future));
```

### 24.8 Mengabaikan cancellation semantics

Shared future bisa membuat cancellation satu caller mempengaruhi caller lain. Perlu policy:

- cancellation tidak propagate ke shared computation,
- caller mendapat derived future,
- timeout per caller berbeda dari timeout loader.

---

## 25. Testing Concurrent Data Structures

Testing concurrent DSA tidak cukup dengan unit test single-thread.

### 25.1 Invariant test

Tuliskan invariant eksplisit.

Contoh dedup guard:

```text
For every key, active processor count must never exceed 1.
```

Test dengan banyak thread:

```java
@Test
void processingGuardAllowsOnlyOneThreadPerKey() throws Exception {
    ProcessingGuard guard = new ProcessingGuard();
    ExecutorService executor = Executors.newFixedThreadPool(16);
    AtomicInteger inside = new AtomicInteger();
    AtomicInteger violations = new AtomicInteger();

    List<Callable<Void>> tasks = IntStream.range(0, 1_000)
        .mapToObj(i -> (Callable<Void>) () -> {
            if (guard.tryEnter("same-key")) {
                int now = inside.incrementAndGet();
                if (now > 1) violations.incrementAndGet();
                try {
                    Thread.sleep(1);
                } finally {
                    inside.decrementAndGet();
                    guard.exit("same-key");
                }
            }
            return null;
        })
        .toList();

    executor.invokeAll(tasks);
    executor.shutdown();

    assertEquals(0, violations.get());
}
```

### 25.2 Stress test

Jalankan banyak iterasi.

```java
@RepeatedTest(100)
void stress() {
    // concurrent scenario
}
```

Tidak membuktikan correctness penuh, tetapi membantu menemukan race yang mudah muncul.

### 25.3 Deterministic model comparison

Untuk struktur custom, bandingkan hasil akhir dengan model single-threaded.

Contoh:

- generate operation list,
- apply sequential model,
- apply concurrent implementation,
- compare invariant akhir.

### 25.4 Avoid sleep-based false confidence

`Thread.sleep` kadang membantu memancing interleaving, tetapi bukan bukti. Untuk testing serius gunakan:

- barrier/latch,
- randomized scheduler,
- jcstress untuk memory/concurrency semantics rendah,
- property-based testing untuk operation sequence.

---

## 26. Performance Notes

### 26.1 Benchmark concurrent collection itu sulit

Performa tergantung:

- thread count,
- CPU core,
- key distribution,
- read/write ratio,
- object size,
- allocation rate,
- GC,
- contention,
- warmup,
- false sharing,
- NUMA/system topology.

Jangan benchmark dengan loop single-thread lalu menyimpulkan untuk concurrent workload.

### 26.2 Key distribution matters

Dua benchmark `ConcurrentHashMap` bisa sangat berbeda:

1. 1 juta key random → low contention.
2. 1 key hot → high contention.

Selalu benchmark dengan distribusi realistis:

- uniform,
- skewed/Zipfian,
- hot tenant,
- hot user,
- hot workflow state,
- burst traffic.

### 26.3 Allocation matters

`ConcurrentLinkedQueue` dan `LinkedBlockingQueue` membuat node per element. Dalam high-throughput workload, node allocation menjadi GC pressure.

`ArrayBlockingQueue` lebih predictable karena array fixed, tetapi punya lock/condition coordination.

### 26.4 Tail latency matters

Average throughput tidak cukup. Queue growth bisa membuat p99/p999 latency buruk walau average masih tampak normal.

Metrics penting:

- queue depth,
- offer rejection count,
- time in queue,
- processing duration,
- active worker count,
- map size approximate,
- eviction/removal count,
- contention metric jika tersedia,
- allocation rate,
- GC pause.

---

## 27. Production Design Checklist

Sebelum memilih concurrent structure, jawab:

1. Apa invariant utama?
2. Apakah invariant per-key atau global?
3. Apakah operasi gabungan harus atomic?
4. Apakah read boleh stale?
5. Apakah iterasi harus snapshot kuat?
6. Apakah ordering dibutuhkan?
7. Apakah range query dibutuhkan?
8. Apakah producer boleh menunggu?
9. Apakah queue boleh unbounded?
10. Apa overload behavior?
11. Apa cleanup policy?
12. Apa timeout policy?
13. Apa cancellation policy?
14. Apakah workload read-heavy atau write-heavy?
15. Apakah ada hot key/hot queue?
16. Bagaimana observability-nya?
17. Bagaimana test race condition-nya?
18. Bagaimana shutdown behavior-nya?
19. Apa memory growth bound-nya?
20. Apakah lebih baik immutable snapshot daripada concurrent mutation?

---

## 28. Mini Case Study: Concurrent Case Processing Registry

### 28.1 Problem

Sistem case management memiliki banyak worker. Setiap case dapat menerima event:

- update document,
- transition state,
- recompute SLA,
- notify party,
- generate audit.

Constraint:

1. Untuk satu `caseId`, hanya satu worker boleh melakukan mutation aktif.
2. Event berbeda case boleh diproses paralel.
3. Jika event duplikat datang saat case sedang diproses, event boleh digabung atau ditunda.
4. Sistem harus punya batas queue.
5. Retry harus berdasarkan deadline.

### 28.2 Data structure design

| Concern | Structure |
|---|---|
| Active case guard | `ConcurrentHashMap.newKeySet()` |
| Incoming bounded event queue | `ArrayBlockingQueue<CaseEvent>` |
| Per-case pending event buffer | `ConcurrentHashMap<CaseId, ConcurrentLinkedQueue<CaseEvent>>` |
| Retry schedule | `DelayQueue<RetryCaseEvent>` |
| Metrics counter | `LongAdder` |
| Workflow definition | `AtomicReference<ImmutableWorkflowSnapshot>` |

### 28.3 Core invariant

```text
At most one active processor per caseId.
Events for overloaded system are bounded by queue capacity.
Workflow rules are read from one immutable snapshot per processing attempt.
Retries are scheduled by delay, not busy loop.
```

### 28.4 Sketch

```java
public final class CaseProcessor {
    private final BlockingQueue<CaseEvent> incoming = new ArrayBlockingQueue<>(50_000);
    private final Set<String> activeCases = ConcurrentHashMap.newKeySet();
    private final ConcurrentHashMap<String, ConcurrentLinkedQueue<CaseEvent>> pendingByCase =
        new ConcurrentHashMap<>();
    private final AtomicReference<WorkflowSnapshot> workflow =
        new AtomicReference<>(WorkflowSnapshot.empty());

    public boolean submit(CaseEvent event) {
        return incoming.offer(event);
    }

    public void workerLoop() throws InterruptedException {
        while (!Thread.currentThread().isInterrupted()) {
            CaseEvent event = incoming.take();
            processOrEnqueue(event);
        }
    }

    private void processOrEnqueue(CaseEvent event) {
        String caseId = event.caseId();

        if (!activeCases.add(caseId)) {
            pendingByCase.computeIfAbsent(caseId, ignored -> new ConcurrentLinkedQueue<>())
                         .offer(event);
            return;
        }

        try {
            CaseEvent current = event;
            while (current != null) {
                processOne(current, workflow.get());
                current = pollPending(caseId);
            }
        } finally {
            activeCases.remove(caseId);

            ConcurrentLinkedQueue<CaseEvent> q = pendingByCase.get(caseId);
            if (q != null && !q.isEmpty()) {
                CaseEvent next = q.poll();
                if (next != null) {
                    processOrEnqueue(next);
                }
            }
        }
    }

    private CaseEvent pollPending(String caseId) {
        ConcurrentLinkedQueue<CaseEvent> q = pendingByCase.get(caseId);
        if (q == null) return null;

        CaseEvent next = q.poll();
        if (next == null) {
            pendingByCase.remove(caseId, q);
        }
        return next;
    }

    private void processOne(CaseEvent event, WorkflowSnapshot snapshot) {
        // validate transition, apply domain mutation, audit, notify, etc.
    }
}
```

### 28.5 Failure analysis

Potential issue:

1. `pendingByCase` queue can grow per hot case.
2. Recursive `processOrEnqueue` call in finally path should be reviewed for stack depth or replaced with explicit loop/scheduling.
3. If `processOne` blocks long, one case is serialized for long time.
4. Need retry/error classification.
5. Need durable persistence if events cannot be lost.
6. In-memory registry only covers one JVM.
7. Distributed deployment needs DB lock, partitioning, message broker key ordering, or external coordination.

This is the important engineering leap:

> Concurrent data structures solve in-process coordination. They do not automatically solve distributed coordination, durability, replay, exactly-once processing, or transactional consistency.

---

## 29. Summary

Concurrent DSA in Java is about choosing the right semantic under mutation by many threads.

Key takeaways:

1. `ConcurrentHashMap` is the default concurrent key-value structure, but not a cache with eviction/TTL by itself.
2. `ConcurrentHashMap` iterators are weakly consistent, not strong snapshots.
3. Use atomic map operations for compound actions.
4. `CopyOnWriteArrayList` is excellent for read-mostly snapshot traversal and terrible for write-heavy workloads.
5. Bounded queues are often better production choices than unbounded queues because they make overload explicit.
6. `ConcurrentLinkedQueue` is non-blocking FIFO but has no backpressure.
7. `ConcurrentSkipListMap` is for sorted concurrent indexes and range queries.
8. `AtomicReference<ImmutableSnapshot>` is often better than mutable concurrent maps for read-mostly configuration/rule/workflow state.
9. High-contention counters should consider `LongAdder`.
10. Concurrent collection method-level safety does not automatically preserve business invariants.
11. Size, iteration, and snapshot semantics must be understood before using concurrent structures for decisions.
12. The best concurrent data structure is often the one that makes failure mode explicit: bounded, observable, cancellable, and testable.

---

## 30. Latihan

### Latihan 1 — Choose the structure

Untuk setiap case, pilih struktur data:

1. Registry active request by request ID.
2. Listener list yang berubah 1 kali per jam, dibaca ribuan kali per detik.
3. Queue job yang tidak boleh melewati 10.000 item.
4. Deadline index untuk task yang harus dieksekusi berdasarkan waktu terdekat.
5. Counter per API path dengan traffic tinggi.
6. Workflow config yang diupdate setiap deploy, dibaca setiap request.

Expected direction:

1. `ConcurrentHashMap` / `newKeySet()`
2. `CopyOnWriteArrayList`
3. `ArrayBlockingQueue`
4. `DelayQueue` atau `ConcurrentSkipListMap`
5. `ConcurrentHashMap<String, LongAdder>`
6. `AtomicReference<ImmutableSnapshot>`

### Latihan 2 — Fix the race

Kode:

```java
if (!processing.contains(caseId)) {
    processing.add(caseId);
    process(caseId);
    processing.remove(caseId);
}
```

Perbaiki agar atomic.

Expected:

```java
if (processing.add(caseId)) {
    try {
        process(caseId);
    } finally {
        processing.remove(caseId);
    }
}
```

Dengan:

```java
Set<String> processing = ConcurrentHashMap.newKeySet();
```

### Latihan 3 — Design bounded event buffer

Buat desain event buffer dengan:

- max capacity,
- `offer` timeout,
- metric rejected,
- graceful shutdown.

Gunakan `ArrayBlockingQueue` atau bounded `LinkedBlockingQueue`.

### Latihan 4 — Snapshot rule registry

Implementasikan registry rule dengan:

- `AtomicReference<Map<String, Rule>>`,
- read lock-free,
- update atomic full snapshot,
- no mutation after publish.

### Latihan 5 — Explain iterator semantic

Jelaskan perbedaan:

- fail-fast iterator,
- weakly consistent iterator,
- snapshot iterator.

Berikan contoh collection Java untuk masing-masing.

---

## 31. Referensi

1. Oracle Java SE 25 Documentation — `java.util.concurrent` package summary.
2. Oracle Java SE 25 Documentation — `ConcurrentHashMap` and related views.
3. Oracle Java SE 25 Documentation — `CopyOnWriteArrayList`.
4. Oracle Java SE 25 Documentation — `BlockingQueue`, `ArrayBlockingQueue`, `LinkedBlockingQueue`, `PriorityBlockingQueue`, `DelayQueue`, `SynchronousQueue`.
5. Oracle Java SE 25 Documentation — `ConcurrentLinkedQueue`.
6. Oracle Java SE 25 Documentation — `ConcurrentSkipListMap`, `ConcurrentSkipListSet`.
7. Oracle Java SE 25 Documentation — `AtomicReference`, `AtomicStampedReference`, `LongAdder`.
8. OpenJDK source references for `java.util.concurrent` implementations.
9. Java Concurrency in Practice concepts: safe publication, compound actions, concurrent collections, and liveness trade-offs.
10. Mechanical Sympathy / high-performance Java concepts: contention, false sharing, allocation pressure, queue latency.

---

## 32. Status Seri

Part 025 selesai.

Seri belum selesai. Berikutnya:

```text
learn-java-dsa-part-026 — Persistent, Immutable, Copy-on-Write, and Snapshot Structures
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java Data Structure and Algorithm — Part 024](./learn-java-dsa-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-026 — Persistent, Immutable, Copy-on-Write, and Snapshot Structures](./learn-java-dsa-part-026.md)

</div>