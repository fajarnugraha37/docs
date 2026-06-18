# learn-java-dsa-part-005 — Stack, Queue, Deque, Ring Buffer

> Seri: **Java Data Structure and Algorithm**  
> Part: **005 dari 030**  
> Topik: **Stack, Queue, Deque, Ring Buffer**  
> Level: **Advanced / Engineering-Oriented**  
> Prasyarat seri sebelumnya: Java object model, array, `ArrayList`, linked structures, basic complexity, equality/hash contract.

---

## 0. Tujuan Pembelajaran

Pada bagian ini kita membahas struktur data linear yang tampak sederhana tetapi sangat sering menjadi pusat desain sistem:

- **Stack** untuk LIFO, traversal, undo, nested parsing, explicit call frame.
- **Queue** untuk FIFO, buffering, traversal breadth-first, producer-consumer, work dispatching.
- **Deque** untuk operasi dua ujung, stack/queue hybrid, monotonic algorithms, sliding window.
- **Ring buffer** untuk bounded buffer, fixed-capacity queue, backpressure, event pipeline, dan high-throughput buffering.

Setelah selesai, targetnya bukan hanya bisa memakai `ArrayDeque`, tetapi mampu menjawab pertanyaan engineering seperti:

1. Kenapa Java merekomendasikan `Deque` daripada legacy `Stack` untuk perilaku stack?
2. Apa bedanya unbounded queue dan bounded queue dari sisi reliability?
3. Kenapa queue sering menjadi titik gagal sistem, bukan sekadar struktur data biasa?
4. Bagaimana merancang ring buffer yang tidak ambigu antara state kosong dan penuh?
5. Bagaimana memilih antara `ArrayDeque`, `LinkedList`, `PriorityQueue`, `BlockingQueue`, dan custom ring buffer?
6. Bagaimana melihat struktur ini sebagai **control-flow data structure**, bukan hanya container?

---

## 1. Mental Model Utama

Struktur data linear pada bagian ini bukan terutama tentang menyimpan data. Mereka adalah cara untuk mengatur **urutan eksekusi**.

- Stack mengatur pekerjaan berdasarkan **yang terakhir masuk diproses duluan**.
- Queue mengatur pekerjaan berdasarkan **yang pertama masuk diproses duluan**.
- Deque memberi kontrol atas **dua sisi urutan**.
- Ring buffer membatasi urutan itu dengan **kapasitas tetap**.

Dengan kata lain:

```text
Data structure linear = policy untuk menentukan elemen mana yang diproses berikutnya.
```

Ini penting karena dalam sistem nyata, urutan pemrosesan memengaruhi:

- fairness,
- latency,
- starvation,
- memory usage,
- retry behavior,
- ordering guarantee,
- backpressure,
- debuggability,
- failure propagation.

### 1.1 Container vs Control Structure

`List` sering dipakai sebagai container umum. Tapi `Stack`, `Queue`, dan `Deque` adalah control structure.

Contoh:

```java
Queue<Job> jobs = new ArrayDeque<>();
```

Ini bukan hanya berarti “kumpulan `Job`”. Ini berarti:

> Job yang masuk lebih dulu akan diproses lebih dulu.

Atau:

```java
Deque<Node> stack = new ArrayDeque<>();
```

Ini berarti:

> Node terakhir yang ditemukan akan diproses lebih dulu, sehingga traversal menjadi depth-first.

Desain DSA yang matang selalu menanyakan:

```text
Apa policy pemilihan elemen berikutnya?
```

Bukan hanya:

```text
Data ini mau disimpan di collection apa?
```

---

## 2. Stack

## 2.1 Definisi

Stack adalah struktur data **LIFO**: Last In, First Out.

Operasi utama:

| Operasi | Makna | Complexity ideal |
|---|---|---:|
| `push(x)` | masukkan elemen ke atas stack | O(1) |
| `pop()` | ambil dan hapus elemen teratas | O(1) |
| `peek()` | lihat elemen teratas tanpa hapus | O(1) |
| `isEmpty()` | cek kosong | O(1) |

Visual:

```text
push A
push B
push C

Top
 ↓
[C]
[B]
[A]

pop() -> C
pop() -> B
pop() -> A
```

### 2.2 Stack sebagai Explicit Call Frame

Recursion memakai call stack JVM. Tetapi recursion bisa diganti dengan stack eksplisit.

Contoh DFS recursive:

```java
void dfs(Node node) {
    if (node == null) return;
    visit(node);
    for (Node child : node.children()) {
        dfs(child);
    }
}
```

Versi iterative:

```java
void dfsIterative(Node root) {
    if (root == null) return;

    Deque<Node> stack = new ArrayDeque<>();
    stack.push(root);

    while (!stack.isEmpty()) {
        Node current = stack.pop();
        visit(current);

        List<Node> children = current.children();
        for (int i = children.size() - 1; i >= 0; i--) {
            stack.push(children.get(i));
        }
    }
}
```

Kenapa children didorong dari belakang?

Karena stack LIFO. Jika ingin child pertama diproses duluan, child terakhir harus masuk stack lebih dulu.

```text
children = [A, B, C]

push C
push B
push A

pop -> A
pop -> B
pop -> C
```

### 2.3 Kapan Stack Berguna

Stack cocok ketika problem punya pola:

```text
masuk ke konteks baru -> selesaikan -> kembali ke konteks sebelumnya
```

Contoh:

1. DFS graph/tree.
2. Validasi bracket.
3. Parsing nested expression.
4. Undo operation.
5. Browser back history.
6. Call frame simulation.
7. Backtracking.
8. Topological sort berbasis DFS.
9. Evaluasi expression postfix.
10. Monotonic stack untuk next greater/smaller element.

### 2.4 Jangan Pakai `java.util.Stack` untuk Kode Baru

`java.util.Stack` adalah class legacy berbasis `Vector`. Karena `Vector` tersinkronisasi secara historis, `Stack` membawa model lama yang biasanya tidak ideal untuk kode modern.

Java `Deque` dapat digunakan sebagai stack, dan dokumentasi Java menyatakan bahwa `Deque` lebih disukai dibanding legacy `Stack` untuk penggunaan stack.

Gunakan:

```java
Deque<String> stack = new ArrayDeque<>();
stack.push("A");
stack.push("B");

String top = stack.pop();
```

Bukan:

```java
Stack<String> stack = new Stack<>();
```

### 2.5 Stack API dengan `Deque`

| Stack concept | `Deque` method | Makna |
|---|---|---|
| push | `push(e)` / `addFirst(e)` | tambah di depan |
| pop | `pop()` / `removeFirst()` | ambil dan hapus depan |
| peek | `peek()` / `peekFirst()` | lihat depan |

Rekomendasi:

```java
Deque<T> stack = new ArrayDeque<>();
```

Gunakan method stack-style (`push`, `pop`, `peek`) jika variabel memang merepresentasikan stack.

---

## 3. Queue

## 3.1 Definisi

Queue adalah struktur data **FIFO**: First In, First Out.

Operasi utama:

| Operasi | Makna | Complexity ideal |
|---|---|---:|
| `offer(x)` | masukkan elemen ke belakang | O(1) |
| `poll()` | ambil dan hapus elemen depan | O(1) |
| `peek()` | lihat elemen depan tanpa hapus | O(1) |
| `isEmpty()` | cek kosong | O(1) |

Visual:

```text
Front                      Back
 ↓                          ↓
[A] -> [B] -> [C]

poll() -> A
poll() -> B
poll() -> C
```

### 3.2 Queue sebagai Fairness Policy

Queue biasanya memberi guarantee sederhana:

```text
Yang lebih dulu datang dilayani lebih dulu.
```

Ini berguna untuk:

- job scheduling sederhana,
- request buffering,
- BFS,
- producer-consumer,
- retry pipeline,
- event processing,
- notification dispatch.

Tetapi FIFO juga punya kelemahan.

Jika elemen depan berat, lambat, atau stuck, elemen di belakang ikut tertahan.

Ini disebut **head-of-line blocking**.

Contoh:

```text
Queue:
[slow job 10s] [fast job 5ms] [fast job 5ms] [fast job 5ms]
```

Dengan satu worker FIFO, semua fast job harus menunggu slow job.

Karena itu queue adalah keputusan scheduling, bukan sekadar collection.

### 3.3 Queue API di Java

Interface `Queue` menyediakan dua keluarga method:

| Operation | Throws exception | Returns special value |
|---|---|---|
| Insert | `add(e)` | `offer(e)` |
| Remove | `remove()` | `poll()` |
| Examine | `element()` | `peek()` |

Untuk sistem robust, biasanya lebih aman memakai:

```java
queue.offer(x);
T item = queue.poll();
T head = queue.peek();
```

Karena `poll()` mengembalikan `null` saat kosong, bukan melempar exception.

Namun perlu hati-hati: banyak queue tidak mengizinkan elemen `null`, agar `null` dapat dipakai sebagai sentinel “tidak ada elemen”. `ArrayDeque` juga tidak mengizinkan `null`.

### 3.4 BFS dengan Queue

Breadth-first search menggunakan queue karena ingin memproses level terdekat lebih dulu.

```java
void bfs(Node root) {
    if (root == null) return;

    Queue<Node> queue = new ArrayDeque<>();
    queue.offer(root);

    while (!queue.isEmpty()) {
        Node current = queue.poll();
        visit(current);

        for (Node child : current.children()) {
            queue.offer(child);
        }
    }
}
```

Visual:

```text
        A
      / | \
     B  C  D
    /      \
   E        F

Queue process order:
A, B, C, D, E, F
```

### 3.5 Queue untuk Producer-Consumer

Queue sering menjadi boundary antara producer dan consumer.

```text
Producer -> Queue -> Consumer
```

Producer menghasilkan pekerjaan. Consumer memproses pekerjaan.

Yang penting:

- Kalau producer lebih cepat dari consumer, queue tumbuh.
- Kalau queue unbounded, memory bisa habis.
- Kalau queue bounded, producer harus menunggu, menolak, drop, atau degrade.

Ini mengarah ke konsep **backpressure**.

---

## 4. Deque

## 4.1 Definisi

Deque adalah **double-ended queue**: insertion dan removal dapat dilakukan dari depan maupun belakang.

Operasi utama:

| Operasi | Depan | Belakang |
|---|---|---|
| Insert | `addFirst`, `offerFirst` | `addLast`, `offerLast` |
| Remove | `removeFirst`, `pollFirst` | `removeLast`, `pollLast` |
| Examine | `getFirst`, `peekFirst` | `getLast`, `peekLast` |

Deque bisa menjadi:

- stack,
- queue,
- worklist dua arah,
- sliding window structure,
- monotonic queue,
- palindrome checker,
- BFS variant,
- scheduling buffer.

### 4.2 `ArrayDeque` sebagai Default

Untuk stack dan queue single-threaded/non-concurrent, default praktis biasanya:

```java
Deque<T> deque = new ArrayDeque<>();
```

Alasannya:

1. Array-backed.
2. Tidak punya node allocation per elemen.
3. Lebih locality-friendly daripada linked nodes.
4. Operasi ujung efisien.
5. Dapat dipakai untuk stack dan queue.

`ArrayDeque` adalah implementasi resizable-array dari `Deque` dan tumbuh sesuai kebutuhan. Dokumentasi Java juga menyebut array deque tidak memiliki capacity restriction tetap secara API dan grow as necessary.

### 4.3 `ArrayDeque` vs `LinkedList`

| Aspek | `ArrayDeque` | `LinkedList` |
|---|---|---|
| Storage | array melingkar | node chain |
| Per-element object overhead | rendah | tinggi |
| Cache locality | lebih baik | buruk karena pointer chasing |
| Insert/remove ujung | O(1) amortized | O(1) |
| Random access | tidak tersedia | tersedia via `List`, tapi O(n) |
| Null element | tidak boleh | boleh sebagai list, tapi buruk untuk queue semantics |
| Default stack/queue | biasanya ya | jarang perlu |

Rule praktis:

```text
Untuk stack/queue/deque biasa, pilih ArrayDeque.
Pilih LinkedList hanya jika ada alasan kuat berbasis node/iterator mutation.
```

---

## 5. Ring Buffer

## 5.1 Definisi

Ring buffer adalah array fixed-capacity yang diperlakukan seolah-olah melingkar.

```text
capacity = 8

index:  0 1 2 3 4 5 6 7
array: [ ][ ][ ][ ][ ][ ][ ][ ]

head = posisi baca
 tail = posisi tulis
```

Ketika tail mencapai ujung array, ia kembali ke 0.

```text
next = (index + 1) % capacity
```

Namun operasi modulo bisa relatif mahal dalam hot path. Jika capacity adalah power of two, bisa memakai bitmask:

```java
next = (index + 1) & (capacity - 1);
```

Syarat:

```text
capacity harus power of two.
```

### 5.2 Kenapa Ring Buffer Penting

Ring buffer penting karena ia memberi batas.

```text
Queue biasa: bisa tumbuh.
Ring buffer: kapasitas tetap.
```

Dalam reliability engineering, batas adalah fitur.

Unbounded queue terlihat nyaman sampai producer lebih cepat daripada consumer. Setelah itu queue menjadi memory leak yang legal.

Ring buffer memaksa kita membuat keputusan:

- block producer,
- reject new item,
- drop oldest,
- drop newest,
- overwrite,
- spill to disk,
- scale consumer,
- degrade service.

### 5.3 Invariant Ring Buffer

Ada beberapa desain ring buffer.

#### Desain A — Menyimpan `size`

State:

```java
Object[] elements;
int head;
int tail;
int size;
```

Invariant:

```text
0 <= size <= capacity
head menunjuk elemen berikutnya untuk dibaca
 tail menunjuk slot berikutnya untuk ditulis
```

Kosong:

```text
size == 0
```

Penuh:

```text
size == capacity
```

Kelebihan:

- mudah dipahami,
- tidak kehilangan satu slot,
- empty/full tidak ambigu.

Kekurangan:

- perlu update `size`,
- dalam concurrent context `size` bisa menjadi sumber contention.

#### Desain B — Mengorbankan Satu Slot

State:

```java
Object[] elements;
int head;
int tail;
```

Kosong:

```text
head == tail
```

Penuh:

```text
next(tail) == head
```

Kapasitas efektif:

```text
array.length - 1
```

Kelebihan:

- tidak perlu `size`,
- empty/full bisa dibedakan.

Kekurangan:

- satu slot tidak dipakai.

#### Desain C — Sequence Number

State:

```text
readSequence
writeSequence
slotIndex = sequence & mask
```

Ini biasanya dipakai pada high-performance ring buffer karena sequence memberi informasi lebih kaya daripada index saja.

Kita tidak akan masuk terlalu jauh ke lock-free algorithm di part ini, karena itu akan dibahas lebih relevan di concurrent data structures. Tetapi konsep sequence penting untuk memahami desain ring buffer yang matang.

---

## 6. Implementasi Ring Buffer Sederhana di Java

Kita buat bounded FIFO queue single-threaded.

```java
import java.util.NoSuchElementException;
import java.util.Objects;

public final class RingBuffer<E> {
    private final Object[] elements;
    private int head;
    private int tail;
    private int size;

    public RingBuffer(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.elements = new Object[capacity];
    }

    public int capacity() {
        return elements.length;
    }

    public int size() {
        return size;
    }

    public boolean isEmpty() {
        return size == 0;
    }

    public boolean isFull() {
        return size == elements.length;
    }

    public boolean offer(E item) {
        Objects.requireNonNull(item, "item");

        if (isFull()) {
            return false;
        }

        elements[tail] = item;
        tail = next(tail);
        size++;
        return true;
    }

    public E poll() {
        if (isEmpty()) {
            return null;
        }

        @SuppressWarnings("unchecked")
        E item = (E) elements[head];

        elements[head] = null; // avoid memory retention
        head = next(head);
        size--;
        return item;
    }

    public E remove() {
        E item = poll();
        if (item == null) {
            throw new NoSuchElementException();
        }
        return item;
    }

    public E peek() {
        if (isEmpty()) {
            return null;
        }

        @SuppressWarnings("unchecked")
        E item = (E) elements[head];
        return item;
    }

    private int next(int index) {
        int next = index + 1;
        return next == elements.length ? 0 : next;
    }
}
```

### 6.1 Kenapa `elements[head] = null` Penting?

Jika elemen yang sudah dipoll tidak dinull-kan, array tetap memegang reference ke object tersebut.

Akibatnya object tidak bisa di-GC walaupun secara logical sudah keluar dari buffer.

Ini disebut **memory retention**.

```java
E item = (E) elements[head];
elements[head] = null; // important
```

### 6.2 Kenapa `offer` Mengembalikan `false` Saat Penuh?

Karena ini bounded buffer.

Saat penuh, kita harus memilih policy.

Pada implementasi ini policy-nya:

```text
reject new item
```

Bukan overwrite, bukan block, bukan drop oldest.

Policy harus eksplisit karena semua pilihan punya konsekuensi.

---

## 7. Ring Buffer dengan Drop-Oldest Policy

Kadang untuk telemetry, metrics, atau recent-events buffer, kita tidak ingin reject. Kita ingin menyimpan data terbaru dan membuang yang lama.

Policy:

```text
Jika penuh, elemen tertua dibuang.
```

Implementasi:

```java
public final class DropOldestRingBuffer<E> {
    private final Object[] elements;
    private int head;
    private int tail;
    private int size;

    public DropOldestRingBuffer(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.elements = new Object[capacity];
    }

    public void add(E item) {
        Objects.requireNonNull(item, "item");

        if (size == elements.length) {
            // drop oldest
            elements[head] = null;
            head = next(head);
            size--;
        }

        elements[tail] = item;
        tail = next(tail);
        size++;
    }

    public E poll() {
        if (size == 0) {
            return null;
        }

        @SuppressWarnings("unchecked")
        E item = (E) elements[head];
        elements[head] = null;
        head = next(head);
        size--;
        return item;
    }

    private int next(int index) {
        int next = index + 1;
        return next == elements.length ? 0 : next;
    }
}
```

### 7.1 Kapan Drop-Oldest Masuk Akal?

Masuk akal untuk:

- recent error samples,
- last N audit hints,
- debug event window,
- UI notification preview,
- metrics samples,
- non-critical telemetry.

Tidak masuk akal untuk:

- payment processing,
- legal audit event,
- workflow transition command,
- case escalation job,
- email dispatch yang wajib terkirim,
- external integration event yang punya guarantee.

Karena drop-oldest berarti kehilangan data secara sengaja.

---

## 8. Bounded vs Unbounded Queue

### 8.1 Unbounded Queue

Unbounded queue tampak sederhana:

```text
Producer can always enqueue.
```

Masalahnya:

```text
Memory menjadi batas tersembunyi.
```

Jika producer lebih cepat daripada consumer:

```text
queue size grows -> heap grows -> GC pressure -> latency naik -> consumer makin lambat -> queue makin tumbuh -> OOM
```

Ini failure loop.

### 8.2 Bounded Queue

Bounded queue memaksa sistem memilih tindakan saat penuh.

Pilihan:

| Policy | Cocok untuk | Risiko |
|---|---|---|
| Block producer | producer boleh menunggu | thread starvation/deadlock jika salah desain |
| Reject new item | request boleh gagal cepat | caller harus handle retry/failure |
| Drop newest | telemetry non-critical | data terbaru hilang |
| Drop oldest | recent-window buffer | data lama hilang |
| Overwrite | fixed sample buffer | kehilangan ordering/history |
| Spill to disk | durability lebih penting | latency dan kompleksitas naik |
| Scale consumer | workload elastis | butuh resource dan orchestration |

### 8.3 Backpressure

Backpressure adalah mekanisme agar downstream yang lambat bisa memberi sinyal ke upstream.

Tanpa backpressure:

```text
fast producer -> unbounded queue -> memory pressure -> system failure
```

Dengan backpressure:

```text
fast producer -> bounded queue full -> producer slowed/rejected -> system remains bounded
```

DSA-nya sederhana, tetapi consequence-nya architectural.

---

## 9. Monotonic Stack

Monotonic stack adalah stack yang mempertahankan urutan tertentu, misalnya increasing atau decreasing.

Contoh problem: untuk setiap angka, cari angka berikutnya di kanan yang lebih besar.

```java
public static int[] nextGreaterElement(int[] values) {
    int n = values.length;
    int[] result = new int[n];
    Arrays.fill(result, -1);

    Deque<Integer> stack = new ArrayDeque<>(); // stores indexes

    for (int i = 0; i < n; i++) {
        while (!stack.isEmpty() && values[i] > values[stack.peek()]) {
            int previousIndex = stack.pop();
            result[previousIndex] = values[i];
        }
        stack.push(i);
    }

    return result;
}
```

Mental model:

```text
Stack menyimpan indeks yang belum menemukan jawaban.
Begitu elemen baru lebih besar, ia menyelesaikan satu atau lebih elemen sebelumnya.
```

Complexity:

- Setiap indeks masuk stack sekali.
- Setiap indeks keluar stack sekali.
- Total O(n), bukan O(n²).

### 9.1 Kenapa Stack Menyimpan Index, Bukan Value?

Karena sering kita butuh:

- posisi,
- update result berdasarkan posisi,
- menghitung jarak,
- menangani duplicate value.

Menyimpan index lebih fleksibel.

---

## 10. Monotonic Queue

Monotonic queue biasanya dipakai untuk sliding window maximum/minimum.

Problem:

> Diberikan array dan ukuran window `k`, cari maksimum setiap window.

Naive:

```text
Untuk setiap window, scan k elemen.
O(nk)
```

Dengan deque:

```java
public static int[] slidingWindowMaximum(int[] values, int k) {
    if (k <= 0 || k > values.length) {
        throw new IllegalArgumentException("invalid window size");
    }

    int[] result = new int[values.length - k + 1];
    Deque<Integer> deque = new ArrayDeque<>(); // stores indexes, values decreasing

    for (int i = 0; i < values.length; i++) {
        // remove indexes outside current window
        int windowStart = i - k + 1;
        while (!deque.isEmpty() && deque.peekFirst() < windowStart) {
            deque.pollFirst();
        }

        // maintain decreasing order
        while (!deque.isEmpty() && values[deque.peekLast()] <= values[i]) {
            deque.pollLast();
        }

        deque.offerLast(i);

        if (windowStart >= 0) {
            result[windowStart] = values[deque.peekFirst()];
        }
    }

    return result;
}
```

Invariant:

```text
Deque menyimpan index dalam window.
Nilai pada index di deque tersusun decreasing.
Elemen depan adalah maksimum window.
```

Complexity:

```text
O(n)
```

Karena setiap index masuk deque sekali dan keluar deque maksimal sekali.

### 10.1 Production Analogy

Sliding window maximum/minimum muncul dalam:

- rolling latency max,
- rate limiting,
- recent error spike detection,
- recent SLA breach tracking,
- monitoring dashboard,
- fraud signal windows.

---

## 11. Queue untuk Retry dan Scheduling

Queue FIFO tidak selalu cukup untuk retry.

Contoh:

```text
Job A gagal, retry setelah 5 detik.
Job B baru masuk dan bisa diproses sekarang.
```

Jika A langsung dimasukkan kembali ke FIFO queue, ia bisa diproses terlalu cepat.

Untuk retry delay, kita perlu priority berdasarkan waktu siap diproses.

Struktur yang lebih cocok:

```text
PriorityQueue by nextAttemptAt
```

Contoh model:

```java
record RetryJob(
    String id,
    int attempt,
    long nextAttemptAtMillis
) {}
```

Comparator:

```java
PriorityQueue<RetryJob> queue = new PriorityQueue<>(
    Comparator.comparingLong(RetryJob::nextAttemptAtMillis)
);
```

Consumer:

```java
RetryJob job = queue.peek();
long now = System.currentTimeMillis();

if (job != null && job.nextAttemptAtMillis() <= now) {
    job = queue.poll();
    process(job);
}
```

Ini bukan lagi FIFO, tetapi **earliest-ready-first**.

Kita akan membahas `PriorityQueue` lebih dalam di part heap, tetapi penting melihat bahwa queue policy harus cocok dengan domain.

---

## 12. Work Queue Design

Work queue tampak sederhana:

```text
workers poll jobs from queue
```

Namun desain production perlu menjawab banyak hal.

### 12.1 Pertanyaan Desain

1. Apakah queue bounded?
2. Apa yang terjadi saat penuh?
3. Apakah ordering wajib FIFO?
4. Apakah job boleh diproses lebih dari sekali?
5. Apakah job boleh hilang?
6. Apakah job punya priority?
7. Apakah job punya deadline?
8. Apakah job punya retry delay?
9. Apakah consumer idempotent?
10. Apakah queue in-memory cukup?
11. Apakah perlu durability?
12. Apakah shutdown harus drain queue?
13. Apakah ada poison message?
14. Apakah ada dead-letter policy?

### 12.2 In-Memory Queue vs Durable Queue

In-memory queue cocok untuk:

- transient tasks,
- request-local pipeline,
- CPU-bound worker handoff,
- non-critical background task,
- bounded internal coordination.

Tidak cocok untuk:

- financial transaction,
- legal audit event,
- command yang wajib tidak hilang,
- cross-service async integration,
- long-running durable workflow.

Untuk durable requirement, gunakan message broker, database queue, outbox pattern, atau workflow engine. Struktur data queue tetap relevan sebagai mental model, tetapi persistence dan delivery guarantee menjadi concern tambahan.

---

## 13. API Semantics: Exception vs Special Value

Java queue/deque methods sering punya dua varian:

```text
throws exception vs returns special value
```

Contoh `Queue`:

| Intent | Exception | Special value |
|---|---|---|
| Insert | `add` | `offer` |
| Remove | `remove` | `poll` |
| Examine | `element` | `peek` |

Contoh `Deque`:

| Intent | Exception | Special value |
|---|---|---|
| Insert first | `addFirst` | `offerFirst` |
| Insert last | `addLast` | `offerLast` |
| Remove first | `removeFirst` | `pollFirst` |
| Remove last | `removeLast` | `pollLast` |
| Examine first | `getFirst` | `peekFirst` |
| Examine last | `getLast` | `peekLast` |

Engineering guidance:

- Gunakan exception variant jika empty/full adalah bug invariant.
- Gunakan special-value variant jika empty/full adalah kondisi normal runtime.

Contoh bug invariant:

```java
Token token = stack.pop(); // should not be empty if parser invariant correct
```

Contoh kondisi normal:

```java
Job job = queue.poll();
if (job == null) {
    return;
}
```

---

## 14. Common Failure Modes

## 14.1 Menggunakan `ArrayList.remove(0)` sebagai Queue

Buruk:

```java
List<Job> jobs = new ArrayList<>();
Job job = jobs.remove(0); // O(n), shifts all elements
```

Gunakan:

```java
Queue<Job> jobs = new ArrayDeque<>();
Job job = jobs.poll();
```

### 14.2 Menggunakan `LinkedList` tanpa alasan

Banyak engineer memilih `LinkedList` karena berpikir insert/remove O(1). Tetapi untuk queue/stack biasa, `ArrayDeque` biasanya lebih baik karena tidak melakukan allocation node per elemen.

### 14.3 Unbounded Queue di Production

```java
Queue<Job> queue = new ConcurrentLinkedQueue<>();
```

Jika producer tidak dibatasi, queue bisa tumbuh sampai heap habis.

Unbounded queue harus punya external control:

- rate limit,
- worker capacity,
- rejection,
- memory monitoring,
- queue length alert,
- admission control.

### 14.4 Tidak Menentukan Full Policy

Ring buffer atau bounded queue tanpa policy jelas akan menghasilkan bug desain.

Pertanyaan wajib:

```text
Saat penuh, apa yang terjadi?
```

Jawabannya tidak boleh implisit.

### 14.5 Null Element Ambiguity

Jika queue mengizinkan `null`, maka `poll()` mengembalikan `null` menjadi ambigu:

```text
null karena queue kosong?
atau null sebagai elemen valid?
```

Karena itu banyak queue tidak mengizinkan null.

### 14.6 Mutasi Elemen yang Mempengaruhi Priority

Untuk priority queue, jika field yang dipakai comparator berubah setelah masuk queue, heap invariant rusak secara logical.

Ini akan dibahas di part heap, tetapi root problem-nya sama:

```text
Collection invariant bergantung pada state elemen.
Jika state elemen berubah, collection tidak otomatis memperbaiki diri.
```

### 14.7 Queue sebagai Tempat Menyembunyikan Bottleneck

Queue sering dipakai untuk “mengatasi lambat”. Padahal queue hanya menunda masalah.

Jika arrival rate > service rate dalam jangka panjang:

```text
queue growth is inevitable
```

Queue bukan solusi kapasitas. Queue adalah buffer untuk variasi sementara.

---

## 15. Complexity Summary

| Structure | Operation | Complexity | Notes |
|---|---|---:|---|
| Stack via `ArrayDeque` | push/pop/peek | O(1) amortized | resize sesekali |
| Queue via `ArrayDeque` | offer/poll/peek | O(1) amortized | array-backed deque |
| Deque via `ArrayDeque` | both-end ops | O(1) amortized | no null elements |
| Ring buffer fixed | offer/poll/peek | O(1) | bounded, no resize |
| `ArrayList.remove(0)` | dequeue-like remove | O(n) | shifts elements |
| `LinkedList` queue ops | add/remove ends | O(1) | higher memory/pointer cost |
| Monotonic stack | total processing | O(n) | each element pushed/popped once |
| Monotonic queue | total processing | O(n) | each index inserted/removed once |

---

## 16. Decision Guide

### 16.1 Pilih `ArrayDeque` Jika

Gunakan `ArrayDeque` untuk:

- stack single-threaded,
- queue single-threaded,
- deque single-threaded,
- DFS iterative,
- BFS local,
- parser stack,
- monotonic stack/queue,
- temporary worklist.

```java
Deque<T> deque = new ArrayDeque<>();
```

### 16.2 Pilih `ArrayBlockingQueue` Jika

Gunakan bounded blocking queue untuk:

- producer-consumer antar thread,
- ingin kapasitas tetap,
- producer boleh menunggu,
- backpressure via blocking masuk akal.

### 16.3 Pilih `LinkedBlockingQueue` Jika

Gunakan dengan hati-hati untuk:

- producer-consumer,
- kapasitas optional,
- linked-node behavior diterima.

Tetap tentukan capacity jika reliability penting.

### 16.4 Pilih `PriorityQueue` Jika

Gunakan jika next item ditentukan oleh priority, bukan arrival order:

- earliest deadline,
- retry schedule,
- top-k,
- shortest path,
- merge sorted streams.

### 16.5 Pilih Custom Ring Buffer Jika

Gunakan jika:

- butuh fixed capacity,
- ingin policy penuh eksplisit,
- hot path sangat sederhana,
- ingin avoid resize,
- behavior domain spesifik seperti drop-oldest.

Jangan custom jika library/JDK structure sudah cukup. Custom data structure menambah maintenance burden.

---

## 17. Production Examples

## 17.1 Request-Local Validation Stack

Misal validasi rule expression nested:

```text
(A AND (B OR C)) AND NOT D
```

Stack bisa dipakai untuk:

- nested group,
- operator precedence,
- bracket matching,
- expression tree construction.

## 17.2 BFS untuk Impact Analysis

Misal entity dependency:

```text
Case -> Application -> Applicant -> Document
```

Jika satu `Applicant` berubah, kita ingin tahu entity apa saja terdampak.

BFS cocok jika ingin dampak berdasarkan jarak terdekat.

```java
Set<EntityId> impacted = new HashSet<>();
Queue<EntityId> queue = new ArrayDeque<>();

queue.offer(changedEntity);
impacted.add(changedEntity);

while (!queue.isEmpty()) {
    EntityId current = queue.poll();
    for (EntityId next : dependencyGraph.outgoing(current)) {
        if (impacted.add(next)) {
            queue.offer(next);
        }
    }
}
```

Catatan penting:

```text
Visited set wajib ada jika graph bisa cyclic.
```

Tanpa visited set, queue bisa tidak pernah kosong.

## 17.3 Escalation Queue

Untuk case management, FIFO belum tentu benar.

Case escalation mungkin ditentukan oleh:

- due date,
- severity,
- statutory deadline,
- manual priority,
- risk score.

Maka struktur bisa berubah:

```text
FIFO Queue -> PriorityQueue -> TreeMap<Deadline, List<Case>>
```

DSA mengikuti invariant domain.

## 17.4 Recent Event Ring Buffer

Untuk troubleshooting, kita bisa menyimpan 1000 event terakhir.

Policy:

```text
Jika penuh, buang event tertua.
```

Ini cocok karena tujuan bukan audit legal, tetapi observability ringkas.

```java
DropOldestRingBuffer<DebugEvent> recentEvents = new DropOldestRingBuffer<>(1000);
```

Jika event wajib durable, ini salah. Gunakan audit log/outbox/broker.

---

## 18. Testing Strategy

### 18.1 Test Basic FIFO

```java
@Test
void ringBufferShouldReturnItemsInFifoOrder() {
    RingBuffer<String> buffer = new RingBuffer<>(3);

    assertTrue(buffer.offer("A"));
    assertTrue(buffer.offer("B"));
    assertTrue(buffer.offer("C"));

    assertEquals("A", buffer.poll());
    assertEquals("B", buffer.poll());
    assertEquals("C", buffer.poll());
    assertNull(buffer.poll());
}
```

### 18.2 Test Full Behavior

```java
@Test
void ringBufferShouldRejectWhenFull() {
    RingBuffer<String> buffer = new RingBuffer<>(2);

    assertTrue(buffer.offer("A"));
    assertTrue(buffer.offer("B"));
    assertFalse(buffer.offer("C"));

    assertEquals("A", buffer.poll());
    assertEquals("B", buffer.poll());
}
```

### 18.3 Test Wrap-Around

```java
@Test
void ringBufferShouldWrapAround() {
    RingBuffer<String> buffer = new RingBuffer<>(3);

    assertTrue(buffer.offer("A"));
    assertTrue(buffer.offer("B"));
    assertEquals("A", buffer.poll());

    assertTrue(buffer.offer("C"));
    assertTrue(buffer.offer("D"));

    assertEquals("B", buffer.poll());
    assertEquals("C", buffer.poll());
    assertEquals("D", buffer.poll());
}
```

Wrap-around wajib dites karena banyak bug ring buffer muncul saat head/tail melewati akhir array.

### 18.4 Test Memory Retention Secara Konseptual

Unit test biasa sulit membuktikan GC, tetapi code review checklist harus memastikan:

```java
elements[head] = null;
```

Saat elemen keluar dari buffer.

### 18.5 Property-Like Test

Untuk ring buffer, bandingkan behavior dengan model sederhana seperti `ArrayDeque`.

Pseudo-pattern:

```text
Generate random operations: offer/poll.
Apply ke RingBuffer dan reference ArrayDeque dengan capacity rule sama.
Assert output dan size sama.
```

Ini sangat efektif untuk menemukan bug state machine kecil.

---

## 19. Performance Notes

### 19.1 Array-backed vs Node-backed

`ArrayDeque` memakai array. Ini biasanya memberi:

- lebih sedikit object allocation,
- locality lebih baik,
- GC pressure lebih rendah.

`LinkedList` memakai node per elemen. Ini biasanya memberi:

- object overhead lebih besar,
- pointer chasing,
- locality lebih buruk,
- lebih banyak beban GC.

### 19.2 Resize Spike

`ArrayDeque` dapat tumbuh. Operasi normal O(1), tetapi resize membutuhkan copy.

Dalam hot path latency-sensitive, resize spike bisa penting.

Mitigasi:

```java
Deque<Job> queue = new ArrayDeque<>(expectedSize);
```

Atau gunakan fixed ring buffer jika kapasitas benar-benar diketahui.

### 19.3 Modulo vs Branch

Ring buffer sering memakai:

```java
(index + 1) % capacity
```

Versi branch:

```java
int next = index + 1;
return next == elements.length ? 0 : next;
```

Versi power-of-two:

```java
(index + 1) & mask
```

Jangan premature optimize. Ukur dengan JMH jika ini benar-benar hot path.

### 19.4 Queue Length sebagai Signal

Queue length adalah metric penting.

Metric yang perlu dipantau:

- current queue size,
- enqueue rate,
- dequeue rate,
- oldest item age,
- processing latency,
- rejection count,
- retry count,
- dead-letter count,
- worker utilization.

Queue size saja tidak cukup. Queue kecil dengan oldest item sangat tua tetap buruk.

---

## 20. Design Checklist

Saat ingin memakai stack/queue/deque/ring buffer, jawab checklist ini:

1. Apakah urutan pemrosesan LIFO, FIFO, priority, deadline, atau custom?
2. Apakah collection ini hanya local method atau long-lived component?
3. Apakah kapasitas harus bounded?
4. Apa policy saat penuh?
5. Apakah elemen boleh hilang?
6. Apakah elemen boleh diproses ulang?
7. Apakah struktur perlu thread-safe?
8. Apakah perlu blocking behavior?
9. Apakah ordering guarantee penting?
10. Apakah shutdown harus drain isi queue?
11. Apakah ada memory retention risk?
12. Apakah null element harus dilarang?
13. Apakah ada retry/deadline/priority?
14. Apakah struktur ini menyembunyikan bottleneck downstream?
15. Apakah metric dan alert sudah didefinisikan?

---

## 21. Key Takeaways

1. Stack, queue, deque, dan ring buffer adalah struktur untuk mengatur **urutan eksekusi**.
2. Stack cocok untuk nested context, DFS, undo, parser, dan backtracking.
3. Queue cocok untuk FIFO, BFS, producer-consumer, dan buffering.
4. Deque adalah struktur fleksibel untuk operasi dua ujung dan menjadi default modern untuk stack/queue single-threaded via `ArrayDeque`.
5. `java.util.Stack` adalah legacy; gunakan `Deque` untuk stack modern.
6. `ArrayDeque` biasanya lebih baik daripada `LinkedList` untuk stack/queue biasa karena array-backed dan lebih locality-friendly.
7. Ring buffer penting karena memberi batas kapasitas dan memaksa full policy eksplisit.
8. Unbounded queue adalah risiko reliability jika producer bisa lebih cepat daripada consumer.
9. Backpressure adalah konsekuensi architectural dari bounded queue.
10. Monotonic stack/queue memungkinkan banyak problem yang tampak O(n²) menjadi O(n).
11. Queue bukan solusi kapasitas; queue hanya buffer untuk variasi sementara.
12. Pilihan struktur data harus mengikuti invariant domain, bukan kebiasaan.

---

## 22. Latihan

### Latihan 1 — Bracket Validator

Implementasikan validator untuk string yang berisi `()[]{}`.

Requirement:

- Return `true` jika bracket valid.
- Return `false` jika tidak valid.
- Gunakan `Deque<Character>` sebagai stack.

Contoh:

```text
"([]){}" -> true
"([)]"   -> false
"(("     -> false
```

### Latihan 2 — BFS Level Order

Diberikan tree sederhana, implementasikan traversal level-order menggunakan queue.

Output:

```text
List<List<T>> levels
```

### Latihan 3 — Fixed Ring Buffer

Lengkapi `RingBuffer<E>` dengan method:

```java
List<E> snapshotInOrder()
```

Requirement:

- Tidak mengubah isi buffer.
- Mengembalikan elemen dari oldest ke newest.
- Harus benar saat wrap-around.

### Latihan 4 — Drop Policy

Buat tiga variasi bounded queue:

1. Reject new item saat penuh.
2. Drop oldest saat penuh.
3. Drop newest saat penuh.

Lalu jelaskan domain mana yang cocok untuk masing-masing.

### Latihan 5 — Sliding Window Maximum

Implementasikan ulang sliding window maximum tanpa melihat kode di atas.

Tuliskan invariant deque-nya dengan jelas.

---

## 23. Referensi

1. Oracle Java SE 25 API — `ArrayDeque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html

2. Oracle Java SE 25 API — `Deque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html

3. Oracle Java SE 25 API — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

4. Oracle Java SE 25 API — Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

5. OpenJDK Code Tools — JOL, Java Object Layout  
   https://openjdk.org/projects/code-tools/jol/

---

## 24. Status Seri

Part ini adalah **Part 005 dari 030**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-dsa-part-006 — Hash Table Fundamentals
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dsa-part-004.md">⬅️ Part 004 — Linked Structures: LinkedList, Node Chain, Pointer Chasing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dsa-part-006.md">Learn Java DSA — Part 006: Hash Table Fundamentals ➡️</a>
</div>
