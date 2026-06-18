# learn-java-dsa-part-012 — Heap, PriorityQueue, Top-K, Scheduling

> Seri: Java Data Structure and Algorithm Advanced  
> Bagian: 012 dari 030  
> Status seri: belum selesai  
> Topik utama: heap, priority queue, top-k, k-way merge, median stream, scheduling, retry ordering, lazy deletion, priority mutation, dan desain priority-based system di Java.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **priority sebagai struktur data**, bukan sekadar `Queue` biasa.

Setelah bagian sebelumnya kita membahas sorted data dan tree-based navigation, sekarang kita masuk ke struktur yang menjawab pertanyaan berbeda:

> “Saya tidak perlu semua data dalam urutan penuh. Saya hanya perlu tahu elemen mana yang paling penting berikutnya.”

Itulah domain heap dan priority queue.

Contoh nyata:

- task mana yang harus diproses dulu?
- case mana yang deadline-nya paling dekat?
- retry mana yang sudah boleh dijalankan ulang?
- user request mana yang punya priority tertinggi?
- event mana yang timestamp-nya paling kecil dari beberapa stream?
- bagaimana mengambil 100 item terbaik dari 10 juta item tanpa sorting semua?
- bagaimana menjaga median dari data stream?

Secara engineering, ini adalah struktur data yang sangat penting karena banyak sistem produksi bukan hanya menyimpan data, tetapi harus **memilih next action**.

---

## 1. Mental Model: Priority Queue Bukan Queue FIFO

`Queue` biasa menjawab:

```text
Siapa yang datang lebih dulu?
```

Priority queue menjawab:

```text
Siapa yang menurut ordering saat ini harus keluar lebih dulu?
```

Perbedaannya besar.

FIFO queue:

```text
insert order: A, B, C, D
poll order:   A, B, C, D
```

Priority queue:

```text
insert order: A(priority=50), B(priority=10), C(priority=30), D(priority=5)
poll order:   D(5), B(10), C(30), A(50)       // jika smaller = higher priority
```

Di Java, `PriorityQueue` adalah queue tak terbatas berbasis priority heap. Elemen diurutkan berdasarkan natural ordering atau `Comparator` yang diberikan saat construction. Elemen paling kecil menurut ordering tersebut menjadi head queue. Namun dokumentasi juga menekankan bahwa jika ada beberapa elemen yang sama-sama least, pemilihan salah satunya tidak dijamin secara spesifik.

Artinya:

```java
PriorityQueue<Integer> pq = new PriorityQueue<>();
pq.add(30);
pq.add(10);
pq.add(20);

System.out.println(pq.poll()); // 10
System.out.println(pq.poll()); // 20
System.out.println(pq.poll()); // 30
```

Tetapi ini bukan berarti internal array-nya selalu sorted.

Priority queue hanya menjamin:

```text
poll() mengembalikan elemen minimum saat ini.
peek() melihat elemen minimum saat ini.
```

Ia tidak menjamin:

```text
iterator berjalan sorted.
array internal sorted.
semua elemen selalu disusun secara total sorted.
```

Ini salah satu misconception paling umum.

---

## 2. Problem yang Cocok untuk Heap/PriorityQueue

Priority queue cocok jika operasi dominan adalah:

```text
insert item
ambil item terbaik/terkecil/terbesar berikutnya
insert lagi
ambil lagi
```

Bentuk operation mix:

| Operation | Pertanyaan |
|---|---|
| `offer(x)` | Tambahkan kandidat baru |
| `peek()` | Siapa kandidat terbaik saat ini? |
| `poll()` | Ambil dan hapus kandidat terbaik |
| bounded top-k | Simpan hanya k kandidat terbaik |
| k-way merge | Gabungkan banyak stream sorted |
| scheduled retry | Ambil task yang due paling awal |
| event ordering | Ambil event timestamp paling kecil |
| escalation | Ambil case dengan urgency tertinggi |

Priority queue tidak cocok jika operasi dominan adalah:

| Kebutuhan | Struktur yang biasanya lebih cocok |
|---|---|
| cari item arbitrary dengan cepat | `HashMap` |
| hapus item arbitrary dengan cepat | `TreeSet`/indexed heap/custom structure |
| range query | `TreeMap`/`NavigableMap` |
| iteration sorted penuh | sorted list/tree atau sort saat output |
| membership check cepat | `HashSet` |
| update priority arbitrary sering | indexed heap/custom structure |
| stable ordering untuk equal priority | comparator dengan tie-breaker eksplisit |

---

## 3. Heap Invariant

Heap adalah struktur data tree-based dengan invariant tertentu.

Untuk **min-heap**:

```text
Setiap parent <= anak-anaknya.
```

Untuk **max-heap**:

```text
Setiap parent >= anak-anaknya.
```

Contoh min-heap:

```text
          3
       /     \
      7       5
    /  \     / \
   9   11   8  20
```

Invariant-nya:

```text
3 <= 7, 5
7 <= 9, 11
5 <= 8, 20
```

Yang penting: heap **bukan binary search tree**.

Dalam BST:

```text
left subtree < node < right subtree
```

Dalam heap:

```text
parent lebih prioritas daripada children
```

Tidak ada ordering global antar sibling atau antar subtree.

Contoh:

```text
          3
       /     \
      7       5
```

`7` dan `5` tidak harus punya relasi kiri-kanan seperti BST. Yang penting hanya parent `3` lebih kecil dari keduanya.

---

## 4. Binary Heap sebagai Array

Heap biasanya diimplementasikan sebagai **complete binary tree** yang disimpan dalam array.

Complete binary tree:

```text
Semua level terisi penuh kecuali mungkin level terakhir,
dan level terakhir diisi dari kiri ke kanan.
```

Karena bentuknya complete, kita tidak perlu pointer parent/child. Cukup array.

Dengan zero-based index:

```text
parent(i)     = (i - 1) / 2
leftChild(i)  = 2 * i + 1
rightChild(i) = 2 * i + 2
```

Contoh array:

```text
index:  0   1   2   3   4   5   6
value:  3   7   5   9   11  8   20
```

Representasi tree:

```text
          3              index 0
       /     \
      7       5           index 1,2
    /  \     / \
   9   11   8  20         index 3,4,5,6
```

Ini membuat heap lebih memory-friendly daripada linked tree:

- tidak perlu node object per element,
- tidak perlu pointer `left`, `right`, `parent`,
- lebih baik locality-nya,
- traversal parent/child cukup arithmetic index.

Namun untuk Java `PriorityQueue<E>`, elemen tetap object reference jika `E` adalah object. Jadi array-nya adalah array references, bukan array primitive value.

---

## 5. Operasi Heap: `offer`

Saat elemen baru masuk, binary heap menaruhnya di posisi terakhir agar bentuk complete tree tetap terjaga.

Lalu elemen dinaikkan sampai invariant heap kembali benar.

Proses ini biasa disebut:

```text
sift up
bubble up
percolate up
```

Contoh min-heap awal:

```text
array: [3, 7, 5, 9, 11, 8, 20]
```

Insert `4`:

```text
array sementara: [3, 7, 5, 9, 11, 8, 20, 4]
```

`4` berada di index 7.

Parent index:

```text
(7 - 1) / 2 = 3
```

Parent value = `9`.

Karena `4 < 9`, swap:

```text
[3, 7, 5, 4, 11, 8, 20, 9]
```

Index `4` sekarang 3.

Parent index:

```text
(3 - 1) / 2 = 1
```

Parent value = `7`.

Karena `4 < 7`, swap:

```text
[3, 4, 5, 7, 11, 8, 20, 9]
```

Parent index:

```text
(1 - 1) / 2 = 0
```

Parent value = `3`.

Karena `4 >= 3`, stop.

Final:

```text
[3, 4, 5, 7, 11, 8, 20, 9]
```

Cost:

```text
O(log n)
```

Karena tinggi complete binary tree adalah `log n`.

Namun dalam praktik, average movement bisa lebih kecil daripada log n tergantung distribusi data.

---

## 6. Operasi Heap: `poll`

`poll()` mengambil root karena root adalah minimum di min-heap.

Masalahnya: setelah root dihapus, tree harus tetap complete.

Strateginya:

1. Simpan root sebagai result.
2. Ambil elemen terakhir.
3. Pindahkan elemen terakhir ke root.
4. Turunkan elemen tersebut sampai heap invariant benar.

Proses ini disebut:

```text
sift down
bubble down
heapify down
percolate down
```

Contoh:

```text
[3, 4, 5, 7, 11, 8, 20, 9]
```

Poll root `3`.

Elemen terakhir `9` dipindah ke root:

```text
[9, 4, 5, 7, 11, 8, 20]
```

Bandingkan dengan children `4` dan `5`. Ambil child terkecil `4`.

Karena `9 > 4`, swap:

```text
[4, 9, 5, 7, 11, 8, 20]
```

Index `9` sekarang 1. Children: `7`, `11`. Child terkecil `7`.

Karena `9 > 7`, swap:

```text
[4, 7, 5, 9, 11, 8, 20]
```

Index `9` sekarang 3, tidak punya child. Stop.

Cost:

```text
O(log n)
```

---

## 7. Operasi Heap: `peek`

`peek()` hanya membaca root.

```text
O(1)
```

Karena elemen prioritas tertinggi selalu ada di array index 0.

---

## 8. Complexity Summary

Untuk binary heap:

| Operation | Complexity | Catatan |
|---|---:|---|
| peek min/max | `O(1)` | root array |
| insert | `O(log n)` | sift up |
| poll min/max | `O(log n)` | sift down |
| build heap from array | `O(n)` | bottom-up heapify |
| remove arbitrary item | `O(n)` search + `O(log n)` fix | Java `PriorityQueue.remove(Object)` mahal |
| contains arbitrary item | `O(n)` | harus scan |
| update priority arbitrary | tidak langsung didukung | perlu remove+offer atau lazy deletion/indexed heap |
| sorted iteration | tidak dijamin | harus copy lalu poll/sort |

Hal penting:

```text
PriorityQueue bagus untuk mengambil next best.
PriorityQueue buruk untuk mencari/menghapus arbitrary element.
```

---

## 9. Java `PriorityQueue` Mental Model

Java `PriorityQueue<E>` adalah implementasi priority queue berbasis priority heap.

Karakter penting:

1. Unbounded secara API, tetapi tetap tergantung memory.
2. Tidak menerima `null` element.
3. Ordering berdasarkan natural ordering atau comparator.
4. Head adalah least element menurut ordering.
5. Jika ada beberapa least element, tie-breaking tidak dijamin.
6. Iterator tidak menjamin traversal sorted.
7. Tidak thread-safe.
8. `offer`, `poll`, `remove`, `peek` mengikuti contract `Queue`, tapi dengan semantics priority.

Contoh min-heap default:

```java
import java.util.PriorityQueue;

public class MinHeapExample {
    public static void main(String[] args) {
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        pq.offer(40);
        pq.offer(10);
        pq.offer(30);
        pq.offer(20);

        while (!pq.isEmpty()) {
            System.out.println(pq.poll());
        }
    }
}
```

Output:

```text
10
20
30
40
```

---

## 10. Max-Heap di Java

Java `PriorityQueue` default-nya min-heap berdasarkan ordering natural.

Untuk max-heap, gunakan comparator reversed.

```java
import java.util.Comparator;
import java.util.PriorityQueue;

public class MaxHeapExample {
    public static void main(String[] args) {
        PriorityQueue<Integer> maxHeap = new PriorityQueue<>(Comparator.reverseOrder());

        maxHeap.offer(40);
        maxHeap.offer(10);
        maxHeap.offer(30);
        maxHeap.offer(20);

        while (!maxHeap.isEmpty()) {
            System.out.println(maxHeap.poll());
        }
    }
}
```

Output:

```text
40
30
20
10
```

Untuk object:

```java
record CaseTask(String caseId, int severity, long dueEpochMillis) {}

PriorityQueue<CaseTask> queue = new PriorityQueue<>(
    Comparator.comparingInt(CaseTask::severity).reversed()
              .thenComparingLong(CaseTask::dueEpochMillis)
              .thenComparing(CaseTask::caseId)
);
```

Interpretasi:

1. Severity lebih tinggi keluar dulu.
2. Jika severity sama, due date lebih cepat keluar dulu.
3. Jika masih sama, `caseId` menjadi tie-breaker deterministik.

Tie-breaker eksplisit sangat penting untuk sistem produksi.

Tanpa tie-breaker, dua item yang comparator-nya setara boleh keluar dalam urutan yang tidak stabil.

---

## 11. Comparator adalah Priority Contract

Pada priority queue, comparator bukan sekadar helper sorting. Comparator adalah definisi priority.

Salah:

```java
PriorityQueue<CaseTask> queue = new PriorityQueue<>(
    (a, b) -> b.severity() - a.severity()
);
```

Masalah:

1. Bisa overflow jika nilai besar.
2. Tidak jelas tie-breaker-nya.
3. Bisa membuat ordering sulit diaudit.

Lebih baik:

```java
PriorityQueue<CaseTask> queue = new PriorityQueue<>(
    Comparator.comparingInt(CaseTask::severity).reversed()
              .thenComparingLong(CaseTask::dueEpochMillis)
              .thenComparing(CaseTask::caseId)
);
```

Comparator harus memenuhi sifat dasar ordering:

- antisymmetric secara efektif,
- transitive,
- consistent untuk operasi queue,
- tidak bergantung pada state yang berubah secara tidak terkendali.

Contoh comparator buruk:

```java
Comparator<Job> unstable = (a, b) -> {
    if (System.nanoTime() % 2 == 0) {
        return -1;
    }
    return 1;
};
```

Ini menghancurkan invariant heap karena ordering berubah setiap waktu.

Comparator untuk priority queue harus diperlakukan seperti schema index di database: sekali salah, hasil retrieval bisa salah atau tidak bisa diprediksi.

---

## 12. `PriorityQueue` Bukan Sorted Collection

Misconception:

```java
PriorityQueue<Integer> pq = new PriorityQueue<>();
pq.addAll(List.of(5, 1, 4, 2, 3));

for (Integer x : pq) {
    System.out.println(x);
}
```

Banyak developer berharap output:

```text
1
2
3
4
5
```

Tapi iterator `PriorityQueue` tidak menjamin order sorted.

Jika ingin output sorted, gunakan salah satu:

### Opsi 1 — Poll sampai habis

```java
while (!pq.isEmpty()) {
    System.out.println(pq.poll());
}
```

Konsekuensi: queue menjadi kosong.

### Opsi 2 — Copy lalu poll

```java
PriorityQueue<Integer> copy = new PriorityQueue<>(pq);
while (!copy.isEmpty()) {
    System.out.println(copy.poll());
}
```

Konsekuensi: tambahan memory `O(n)`.

### Opsi 3 — Copy ke list lalu sort

```java
List<Integer> sorted = new ArrayList<>(pq);
sorted.sort(Integer::compareTo);
```

Konsekuensi: `O(n log n)` sort.

---

## 13. Heap vs Sorted List vs TreeMap

Priority queue sering dibandingkan dengan sorted list dan balanced tree.

| Struktur | Insert | Get min | Remove min | Search arbitrary | Range query | Sorted iteration |
|---|---:|---:|---:|---:|---:|---:|
| Unsorted list | `O(1)` | `O(n)` | `O(n)` | `O(n)` | buruk | no |
| Sorted list | `O(n)` | `O(1)` | `O(1)`/`O(n)` tergantung remove | `O(log n)` binary search | cukup | yes |
| Binary heap | `O(log n)` | `O(1)` | `O(log n)` | `O(n)` | no | no |
| TreeMap/TreeSet | `O(log n)` | `O(log n)`/near `O(1)` first entry access internally | `O(log n)` | `O(log n)` | yes | yes |

Gunakan heap jika:

```text
Butuh repeated next-best extraction.
Tidak butuh range query.
Tidak butuh frequent arbitrary update/remove.
```

Gunakan tree jika:

```text
Butuh sorted traversal.
Butuh floor/ceiling/range query.
Butuh search/remove arbitrary dengan log n.
```

Gunakan sorted list jika:

```text
Data mostly read-only.
Build sekali, query berkali-kali.
Memory locality penting.
Insert jarang.
```

---

## 14. Build Heap: Repeated Insert vs Heapify

Ada dua cara membangun heap dari n item.

### Cara 1 — Insert satu-satu

```java
PriorityQueue<Integer> pq = new PriorityQueue<>();
for (int x : values) {
    pq.offer(x);
}
```

Cost:

```text
O(n log n)
```

### Cara 2 — Heapify dari collection

```java
PriorityQueue<Integer> pq = new PriorityQueue<>(values);
```

Secara konsep, heap bisa dibangun dengan bottom-up heapify dalam `O(n)`.

Kenapa bisa `O(n)`, bukan `O(n log n)`?

Karena tidak semua node berada di height `log n`. Mayoritas node berada dekat daun, sehingga cost sift-down mereka kecil.

Intuisi:

```text
banyak node murah + sedikit node mahal = total O(n)
```

Dalam desain sistem, kalau kamu sudah punya batch data besar dan ingin membuat priority queue, construction dari collection sering lebih baik daripada offer satu-satu.

Namun selalu cek kebutuhan comparator dan format data.

---

## 15. Implementasi Binary Min Heap Sendiri

Walaupun di produksi biasanya gunakan `PriorityQueue`, menulis heap sendiri membantu memahami invariant.

```java
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;

public final class BinaryMinHeap<E> {
    private final ArrayList<E> heap = new ArrayList<>();
    private final Comparator<? super E> comparator;

    public BinaryMinHeap(Comparator<? super E> comparator) {
        this.comparator = Objects.requireNonNull(comparator, "comparator");
    }

    public int size() {
        return heap.size();
    }

    public boolean isEmpty() {
        return heap.isEmpty();
    }

    public void offer(E value) {
        Objects.requireNonNull(value, "value");
        heap.add(value);
        siftUp(heap.size() - 1);
    }

    public E peek() {
        if (heap.isEmpty()) {
            throw new NoSuchElementException("heap is empty");
        }
        return heap.get(0);
    }

    public E poll() {
        if (heap.isEmpty()) {
            throw new NoSuchElementException("heap is empty");
        }

        E result = heap.get(0);
        E last = heap.remove(heap.size() - 1);

        if (!heap.isEmpty()) {
            heap.set(0, last);
            siftDown(0);
        }

        return result;
    }

    private void siftUp(int index) {
        E value = heap.get(index);

        while (index > 0) {
            int parentIndex = (index - 1) >>> 1;
            E parent = heap.get(parentIndex);

            if (comparator.compare(value, parent) >= 0) {
                break;
            }

            heap.set(index, parent);
            index = parentIndex;
        }

        heap.set(index, value);
    }

    private void siftDown(int index) {
        int size = heap.size();
        int half = size >>> 1; // nodes from half onward are leaves
        E value = heap.get(index);

        while (index < half) {
            int left = (index << 1) + 1;
            int right = left + 1;
            int bestChild = left;
            E bestChildValue = heap.get(left);

            if (right < size) {
                E rightValue = heap.get(right);
                if (comparator.compare(rightValue, bestChildValue) < 0) {
                    bestChild = right;
                    bestChildValue = rightValue;
                }
            }

            if (comparator.compare(value, bestChildValue) <= 0) {
                break;
            }

            heap.set(index, bestChildValue);
            index = bestChild;
        }

        heap.set(index, value);
    }
}
```

Beberapa detail penting:

1. `Objects.requireNonNull` dipakai agar invariant lebih jelas.
2. `siftUp` dan `siftDown` menyimpan `value` lalu menggeser elemen lain, bukan swap terus-menerus. Ini mengurangi assignment.
3. `index < half` berarti node masih punya minimal left child.
4. `(index - 1) >>> 1` lazim dipakai untuk parent index non-negative.
5. Comparator menjadi satu-satunya definisi priority.

---

## 16. Testing Heap Invariant

Struktur data seperti heap harus dites bukan hanya output contoh kecil, tetapi invariant-nya.

Contoh helper test:

```java
static <E> boolean isMinHeap(List<E> data, Comparator<? super E> comparator) {
    for (int parent = 0; parent < data.size(); parent++) {
        int left = parent * 2 + 1;
        int right = parent * 2 + 2;

        if (left < data.size() && comparator.compare(data.get(parent), data.get(left)) > 0) {
            return false;
        }
        if (right < data.size() && comparator.compare(data.get(parent), data.get(right)) > 0) {
            return false;
        }
    }
    return true;
}
```

Property test idea:

```text
Given random list of integers
When inserted into heap then polled until empty
Then output must equal sorted input
```

JUnit-style:

```java
@Test
void heapShouldPollValuesInAscendingOrder() {
    List<Integer> input = List.of(5, 1, 9, 2, 7, 3);
    BinaryMinHeap<Integer> heap = new BinaryMinHeap<>(Integer::compareTo);

    for (int x : input) {
        heap.offer(x);
    }

    List<Integer> output = new ArrayList<>();
    while (!heap.isEmpty()) {
        output.add(heap.poll());
    }

    assertEquals(List.of(1, 2, 3, 5, 7, 9), output);
}
```

Test lain:

1. Poll dari empty heap.
2. Peek tidak menghapus elemen.
3. Duplicates.
4. Reverse input.
5. Already sorted input.
6. Random input besar.
7. Comparator custom.
8. Comparator with tie-breaker.

---

## 17. Top-K Problem

Problem:

```text
Dari N item, ambil K item terbaik.
```

Naive approach:

```text
sort semua item lalu ambil K pertama
```

Cost:

```text
O(n log n)
```

Jika `K` jauh lebih kecil dari `N`, heap bisa lebih efisien.

Contoh: ambil 100 transaksi terbesar dari 10 juta transaksi.

Kita tidak perlu sort 10 juta item. Kita cukup menjaga heap ukuran 100.

---

## 18. Top-K Largest dengan Min-Heap Ukuran K

Untuk mengambil K terbesar, gunakan min-heap ukuran K.

Invariant:

```text
Heap menyimpan K elemen terbesar yang ditemukan sejauh ini.
Root heap adalah elemen terkecil di antara K terbesar tersebut.
```

Algorithm:

```text
for each item:
    if heap size < k:
        offer item
    else if item > heap.peek():
        poll root
        offer item
```

Kenapa min-heap?

Karena saat heap sudah berisi K kandidat terbesar, kandidat terlemah ada di root. Jika item baru lebih besar dari kandidat terlemah, ia layak masuk.

Implementation:

```java
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.PriorityQueue;

public final class TopK {
    public static <T> List<T> largestK(
            Iterable<T> input,
            int k,
            Comparator<? super T> comparator
    ) {
        if (k < 0) {
            throw new IllegalArgumentException("k must be >= 0");
        }
        if (k == 0) {
            return List.of();
        }

        PriorityQueue<T> heap = new PriorityQueue<>(k, comparator);

        for (T item : input) {
            if (heap.size() < k) {
                heap.offer(item);
            } else if (comparator.compare(item, heap.peek()) > 0) {
                heap.poll();
                heap.offer(item);
            }
        }

        ArrayList<T> result = new ArrayList<>(heap);
        result.sort(comparator.reversed());
        return result;
    }
}
```

Complexity:

```text
Time:  O(n log k)
Space: O(k)
```

Jika `k` kecil, ini jauh lebih baik daripada sort full.

---

## 19. Top-K Smallest dengan Max-Heap Ukuran K

Untuk mengambil K terkecil, gunakan max-heap ukuran K.

Invariant:

```text
Heap menyimpan K elemen terkecil sejauh ini.
Root adalah elemen terbesar di antara K terkecil.
```

Jika item baru lebih kecil dari root, item baru masuk dan root lama keluar.

```java
public static <T> List<T> smallestK(
        Iterable<T> input,
        int k,
        Comparator<? super T> comparator
) {
    if (k < 0) {
        throw new IllegalArgumentException("k must be >= 0");
    }
    if (k == 0) {
        return List.of();
    }

    PriorityQueue<T> heap = new PriorityQueue<>(k, comparator.reversed());

    for (T item : input) {
        if (heap.size() < k) {
            heap.offer(item);
        } else if (comparator.compare(item, heap.peek()) < 0) {
            heap.poll();
            heap.offer(item);
        }
    }

    ArrayList<T> result = new ArrayList<>(heap);
    result.sort(comparator);
    return result;
}
```

Complexity:

```text
Time:  O(n log k)
Space: O(k)
```

---

## 20. Top-K Engineering Notes

Top-K terlihat sederhana, tetapi production version perlu memperhatikan:

### 20.1 Tie-breaker

Jika score sama, apa yang terjadi?

```java
record Candidate(String id, int score, long createdAt) {}

Comparator<Candidate> ranking = Comparator
    .comparingInt(Candidate::score)
    .thenComparingLong(Candidate::createdAt)
    .thenComparing(Candidate::id);
```

Untuk deterministic result, selalu tambahkan tie-breaker.

### 20.2 Memory

Jika input 100 juta item dan K = 1000, heap `O(k)` sangat hemat.

Namun jika item adalah object besar, jangan simpan object penuh jika cukup simpan reference atau compact projection.

Contoh:

```java
record CandidateView(String id, int score) {}
```

### 20.3 Streaming

Top-K heap bisa bekerja pada stream yang tidak muat di memory.

```text
read chunk -> update heap -> discard chunk
```

### 20.4 Comparator Cost

Jika comparator mahal, misalnya menghitung score kompleks, precompute score.

Buruk:

```java
Comparator<Item> c = Comparator.comparingInt(item -> expensiveScore(item));
```

Lebih baik:

```java
record ScoredItem(Item item, int score) {}
```

### 20.5 Mutable Item

Jangan mutasi field yang dipakai comparator setelah item masuk heap.

---

## 21. K-Way Merge

Problem:

```text
Ada K list/stream yang masing-masing sudah sorted.
Gabungkan menjadi satu sorted output.
```

Contoh:

```text
A: [1, 4, 9]
B: [2, 3, 10]
C: [0, 8, 11]

Output: [0, 1, 2, 3, 4, 8, 9, 10, 11]
```

Naive:

```text
gabungkan semua lalu sort
```

Cost:

```text
O(n log n)
```

Heap approach:

1. Masukkan elemen pertama dari setiap list ke heap.
2. Poll elemen terkecil.
3. Dari list yang sama, masukkan elemen berikutnya.
4. Ulangi sampai heap kosong.

Cost:

```text
O(n log k)
```

Karena heap hanya berisi maksimal K item.

---

## 22. K-Way Merge Implementation

```java
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.PriorityQueue;

public final class KWayMerge {
    private record Cursor<T>(T value, int listIndex, int elementIndex) {}

    public static <T> List<T> mergeSortedLists(
            List<? extends List<T>> lists,
            Comparator<? super T> comparator
    ) {
        PriorityQueue<Cursor<T>> heap = new PriorityQueue<>(
            Comparator.comparing(Cursor<T>::value, comparator)
                      .thenComparingInt(Cursor::listIndex)
                      .thenComparingInt(Cursor::elementIndex)
        );

        int totalSize = 0;
        for (int i = 0; i < lists.size(); i++) {
            List<T> list = lists.get(i);
            totalSize += list.size();
            if (!list.isEmpty()) {
                heap.offer(new Cursor<>(list.get(0), i, 0));
            }
        }

        ArrayList<T> result = new ArrayList<>(totalSize);

        while (!heap.isEmpty()) {
            Cursor<T> current = heap.poll();
            result.add(current.value());

            List<T> source = lists.get(current.listIndex());
            int nextIndex = current.elementIndex() + 1;

            if (nextIndex < source.size()) {
                heap.offer(new Cursor<>(source.get(nextIndex), current.listIndex(), nextIndex));
            }
        }

        return result;
    }
}
```

Tie-breaker `listIndex` dan `elementIndex` membuat result deterministic jika value sama.

Production examples:

1. Merge sorted audit log dari beberapa shard.
2. Merge search result dari beberapa index partition.
3. Merge event stream berdasarkan timestamp.
4. Merge per-service timeline menjadi global timeline.
5. Merge sorted pagination windows.

---

## 23. Median from Data Stream: Two Heaps

Problem:

```text
Data datang satu per satu.
Setelah setiap insert, kita ingin tahu median saat ini.
```

Sorting ulang setiap kali mahal.

Gunakan dua heap:

```text
lower half: max-heap
upper half: min-heap
```

Invariant:

1. Semua elemen di `lower` <= semua elemen di `upper`.
2. Ukuran kedua heap berbeda maksimal 1.
3. Jika total ganjil, median adalah root heap yang lebih besar ukurannya.
4. Jika total genap, median adalah rata-rata dua root.

Visual:

```text
lower max-heap        upper min-heap
[smaller half]        [larger half]
root = max lower      root = min upper
```

Implementation:

```java
import java.util.Comparator;
import java.util.PriorityQueue;

public final class MedianTracker {
    private final PriorityQueue<Integer> lower = new PriorityQueue<>(Comparator.reverseOrder());
    private final PriorityQueue<Integer> upper = new PriorityQueue<>();

    public void add(int value) {
        if (lower.isEmpty() || value <= lower.peek()) {
            lower.offer(value);
        } else {
            upper.offer(value);
        }

        rebalance();
    }

    public double median() {
        int total = lower.size() + upper.size();
        if (total == 0) {
            throw new IllegalStateException("no values");
        }

        if (lower.size() == upper.size()) {
            return ((long) lower.peek() + (long) upper.peek()) / 2.0;
        }

        return lower.size() > upper.size()
            ? lower.peek()
            : upper.peek();
    }

    private void rebalance() {
        if (lower.size() > upper.size() + 1) {
            upper.offer(lower.poll());
        } else if (upper.size() > lower.size() + 1) {
            lower.offer(upper.poll());
        }
    }
}
```

Cost:

```text
add:    O(log n)
median: O(1)
space:  O(n)
```

Production analogy:

- live latency median,
- transaction amount median,
- queue wait-time median,
- rolling score distribution.

Catatan: untuk rolling median dengan deletion, priority queue biasa tidak cukup nyaman karena arbitrary deletion mahal. Perlu lazy deletion atau balanced tree/multiset.

---

## 24. Priority Update Problem

Salah satu kelemahan Java `PriorityQueue`:

```text
Tidak ada decrease-key / increase-key operation langsung.
```

Contoh:

```java
record Job(String id, int priority) {}
```

Jika job sudah berada dalam priority queue lalu priority berubah, heap tidak otomatis memperbaiki posisinya.

Bahkan jika object mutable:

```java
final class MutableJob {
    final String id;
    int priority;

    MutableJob(String id, int priority) {
        this.id = id;
        this.priority = priority;
    }
}
```

Lalu:

```java
PriorityQueue<MutableJob> pq = new PriorityQueue<>(Comparator.comparingInt(j -> j.priority));

MutableJob a = new MutableJob("A", 10);
MutableJob b = new MutableJob("B", 20);

pq.offer(a);
pq.offer(b);

a.priority = 1000;
```

Heap invariant internal bisa menjadi tidak valid secara logical karena posisi `a` tidak diperbaiki.

Priority queue tidak tahu bahwa field yang dipakai comparator berubah.

Aturan produksi:

```text
Jangan mutasi priority field setelah object masuk heap.
```

Jika priority berubah, pilih strategi:

1. Remove lalu offer lagi.
2. Lazy insertion dengan versioning.
3. Indexed heap custom.
4. Gunakan `TreeSet`/`TreeMap` jika update/delete arbitrary dominan.

---

## 25. Strategy 1: Remove + Offer

```java
pq.remove(job); // O(n)
job.priority = newPriority;
pq.offer(job); // O(log n)
```

Total:

```text
O(n)
```

Ini bisa cukup jika:

- ukuran queue kecil,
- update priority jarang,
- simplicity lebih penting.

Tidak cocok jika:

- update sering,
- queue besar,
- latency sensitive.

---

## 26. Strategy 2: Lazy Deletion / Versioned Entry

Daripada update entry lama, masukkan entry baru dengan version lebih baru.

Saat poll, skip entry yang sudah stale.

Contoh untuk scheduling:

```java
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.PriorityQueue;

public final class VersionedScheduler {
    private record ScheduledJob(String jobId, long dueAtMillis, long version) {}

    private final PriorityQueue<ScheduledJob> queue = new PriorityQueue<>(
        Comparator.comparingLong(ScheduledJob::dueAtMillis)
                  .thenComparing(ScheduledJob::jobId)
                  .thenComparingLong(ScheduledJob::version)
    );

    private final Map<String, Long> latestVersionByJobId = new HashMap<>();

    public void schedule(String jobId, long dueAtMillis) {
        long version = latestVersionByJobId.getOrDefault(jobId, 0L) + 1;
        latestVersionByJobId.put(jobId, version);
        queue.offer(new ScheduledJob(jobId, dueAtMillis, version));
    }

    public String pollDue(long nowMillis) {
        while (!queue.isEmpty()) {
            ScheduledJob head = queue.peek();

            Long latestVersion = latestVersionByJobId.get(head.jobId());
            boolean stale = latestVersion == null || latestVersion != head.version();

            if (stale) {
                queue.poll();
                continue;
            }

            if (head.dueAtMillis() > nowMillis) {
                return null;
            }

            queue.poll();
            latestVersionByJobId.remove(head.jobId());
            return head.jobId();
        }

        return null;
    }
}
```

Kelebihan:

- Update menjadi `O(log n)` karena hanya insert baru.
- Tidak perlu remove arbitrary.
- Bagus untuk reschedule/retry.

Kekurangan:

- Queue bisa berisi stale entries.
- Memory bisa membesar jika banyak update dan poll jarang.
- Perlu cleanup saat poll.
- Perlu version map.

Production fit:

- delayed retry,
- token refresh schedule,
- case escalation reschedule,
- reminder system,
- timer queue sederhana.

---

## 27. Strategy 3: Indexed Heap

Indexed heap menambahkan map dari key ke index heap.

```text
heap array:       index -> item
position map:     itemId -> index
```

Dengan ini, kita bisa:

- menemukan posisi item `O(1)`,
- update priority,
- sift up/down dari posisi tersebut,
- remove arbitrary `O(log n)`.

Pseudo-structure:

```java
final class IndexedPriorityQueue<K, V> {
    private final ArrayList<Entry<K, V>> heap;
    private final HashMap<K, Integer> indexByKey;
    private final Comparator<? super Entry<K, V>> comparator;
}
```

Ketika swap dua element di heap, map juga harus diupdate.

```text
swap heap[i], heap[j]
indexByKey.put(heap[i].key, i)
indexByKey.put(heap[j].key, j)
```

Ini lebih kompleks tetapi penting untuk:

- Dijkstra dengan decrease-key style,
- dynamic scheduling dengan frequent priority updates,
- matching engine,
- live leaderboard dengan update score,
- workflow queue yang priority-nya berubah.

Namun untuk banyak sistem bisnis, lazy deletion lebih sederhana dan cukup.

---

## 28. Scheduling dengan PriorityQueue

Scheduling berbasis priority queue adalah pattern yang sangat umum.

Kita ingin memproses task berdasarkan waktu paling awal.

Priority:

```text
dueAt paling kecil keluar lebih dulu
```

Model:

```java
record ScheduledTask(String id, long dueAtMillis, Runnable action) {}
```

Comparator:

```java
Comparator<ScheduledTask> byDueTime = Comparator
    .comparingLong(ScheduledTask::dueAtMillis)
    .thenComparing(ScheduledTask::id);
```

Loop konseptual:

```text
while running:
    task = queue.peek()
    if no task:
        wait
    else if task.dueAt <= now:
        poll and execute
    else:
        wait until dueAt
```

Namun implementasi production-grade perlu hati-hati:

1. Thread safety.
2. Waking up saat task baru lebih awal masuk.
3. Clock changes.
4. Long-running action.
5. Exception handling.
6. Shutdown.
7. Backpressure.
8. Observability.

Java sudah punya struktur concurrent scheduling seperti `DelayQueue` dan scheduler di `java.util.concurrent`, tetapi memahami priority queue membantu memahami mekanismenya.

---

## 29. Retry Scheduling Pattern

Untuk retry external call, priority queue bisa menyimpan next attempt time.

```java
record RetryTask(
    String id,
    int attempt,
    long nextRunAtMillis,
    String payload
) {}
```

Comparator:

```java
Comparator<RetryTask> retryOrder = Comparator
    .comparingLong(RetryTask::nextRunAtMillis)
    .thenComparingInt(RetryTask::attempt)
    .thenComparing(RetryTask::id);
```

Exponential backoff:

```java
static long nextDelayMillis(int attempt) {
    long base = 250L;
    long max = 30_000L;
    long delay = base << Math.min(attempt, 10);
    return Math.min(delay, max);
}
```

Production notes:

1. Jangan unbounded tanpa limit.
2. Simpan retry state durable jika task tidak boleh hilang saat restart.
3. Tambahkan jitter agar tidak terjadi thundering herd.
4. Batasi maximum attempt.
5. Bedakan retryable vs non-retryable failure.
6. Gunakan dead-letter strategy.
7. Ukur queue size dan oldest due age.

Priority queue in-memory cocok untuk local transient scheduling.

Untuk workflow penting, gunakan durable store atau message broker dengan delay/retry support.

---

## 30. Deadline/Escalation Queue

Dalam sistem case management atau enforcement lifecycle, priority sering gabungan beberapa faktor:

```text
priority = severity + deadline + state + legal risk + age
```

Namun hati-hati: comparator harus deterministik dan murah.

Contoh:

```java
record CaseWorkItem(
    String caseId,
    int severity,
    long dueAtMillis,
    long createdAtMillis,
    String state
) {}
```

Comparator:

```java
Comparator<CaseWorkItem> escalationOrder = Comparator
    .comparingInt(CaseWorkItem::severity).reversed()
    .thenComparingLong(CaseWorkItem::dueAtMillis)
    .thenComparingLong(CaseWorkItem::createdAtMillis)
    .thenComparing(CaseWorkItem::caseId);
```

Interpretasi:

1. Severity tertinggi dulu.
2. Untuk severity sama, due date terdekat dulu.
3. Untuk due date sama, case lebih lama dulu.
4. Untuk semua sama, case ID menjadi deterministic tie-breaker.

Masalah desain:

Jika due date berubah karena extension, priority queue tidak otomatis update.

Solusi:

- remove+offer jika kecil,
- lazy versioning jika besar,
- rebuild queue periodik dari authoritative store,
- gunakan DB query/index jika source of truth ada di database.

Important distinction:

```text
PriorityQueue adalah execution selection structure,
bukan source-of-truth state store.
```

---

## 31. Event Time Merge dari Banyak Source

Misalnya ada event dari beberapa service:

```text
case-service events sorted by timestamp
payment-service events sorted by timestamp
document-service events sorted by timestamp
notification-service events sorted by timestamp
```

Untuk membuat timeline global, gunakan k-way merge.

Heap item:

```java
record EventCursor(
    Event event,
    int sourceIndex,
    int offset
) {}
```

Comparator:

```java
Comparator<EventCursor> byEventTime = Comparator
    .comparingLong((EventCursor c) -> c.event().timestampMillis())
    .thenComparingInt(EventCursor::sourceIndex)
    .thenComparingInt(EventCursor::offset);
```

Ini lebih baik daripada merge semua event lalu sort jika masing-masing source sudah sorted.

---

## 32. Heap Sort

Heap bisa dipakai untuk sorting.

Concept:

1. Build heap dari array.
2. Repeatedly poll root.
3. Output menjadi sorted.

Dengan min-heap extra storage:

```java
PriorityQueue<Integer> pq = new PriorityQueue<>(values);
List<Integer> sorted = new ArrayList<>(values.size());
while (!pq.isEmpty()) {
    sorted.add(pq.poll());
}
```

Cost:

```text
Time:  O(n log n)
Space: O(n) dengan PriorityQueue terpisah
```

In-place heap sort bisa `O(1)` extra space, tapi Java production biasanya memakai built-in sort karena sudah sangat dioptimasi dan lebih idiomatis.

Heap sort penting secara mental model, tetapi priority queue lebih sering dipakai untuk incremental priority selection, bukan full sorting.

---

## 33. PriorityQueue and Dijkstra

Dijkstra sering diajarkan dengan priority queue.

Masalah: Java `PriorityQueue` tidak punya decrease-key.

Common approach di Java:

```text
Masukkan distance candidate baru ke heap.
Saat poll, skip jika distance bukan distance terbaru.
```

Lazy deletion pattern.

Pseudo:

```java
record NodeDistance(int node, long distance) {}

PriorityQueue<NodeDistance> pq = new PriorityQueue<>(
    Comparator.comparingLong(NodeDistance::distance)
);

long[] dist = new long[n];
Arrays.fill(dist, Long.MAX_VALUE);
dist[source] = 0;
pq.offer(new NodeDistance(source, 0));

while (!pq.isEmpty()) {
    NodeDistance current = pq.poll();

    if (current.distance() != dist[current.node()]) {
        continue; // stale
    }

    for (Edge edge : graph[current.node()]) {
        long nextDistance = current.distance() + edge.weight();
        if (nextDistance < dist[edge.to()]) {
            dist[edge.to()] = nextDistance;
            pq.offer(new NodeDistance(edge.to(), nextDistance));
        }
    }
}
```

Trade-off:

- lebih sederhana,
- queue bisa berisi stale entries,
- complexity masih sering diterima dalam praktik,
- memory bisa meningkat pada graph dengan banyak relaxation.

---

## 34. PriorityQueue untuk Rate Limiting dan Token Scheduling

Priority queue juga bisa dipakai untuk mengatur kapan suatu key boleh diproses ulang.

Contoh:

```text
API external rate limit per customer.
Setiap customer punya nextAllowedAt.
Ambil customer dengan nextAllowedAt paling awal.
```

Record:

```java
record CustomerSlot(String customerId, long nextAllowedAtMillis, long version) {}
```

Pattern:

1. Poll customer yang due.
2. Proses satu unit kerja.
3. Hitung next allowed time.
4. Offer ulang.

Ini mirip scheduler.

Namun untuk distributed system, in-memory priority queue hanya berlaku di satu process. Jika multi-instance, perlu distributed coordination atau external queue/store.

---

## 35. Common Failure Mode: Mutating Priority Field

Ini sangat penting.

Buruk:

```java
final class Ticket {
    final String id;
    int priority;

    Ticket(String id, int priority) {
        this.id = id;
        this.priority = priority;
    }
}

PriorityQueue<Ticket> pq = new PriorityQueue<>(Comparator.comparingInt(t -> t.priority));
Ticket t1 = new Ticket("T1", 100);
Ticket t2 = new Ticket("T2", 200);

pq.offer(t1);
pq.offer(t2);

t2.priority = 1;

System.out.println(pq.poll().id);
```

Developer mungkin berharap `T2` keluar dulu setelah priority diubah menjadi `1`.

Tapi heap tidak melakukan reheapify otomatis.

Solusi:

```text
Treat heap entries as immutable.
```

Gunakan record:

```java
record TicketEntry(String id, int priority, long version) {}
```

Jika priority berubah, insert entry baru dan invalidate entry lama.

---

## 36. Common Failure Mode: Expecting FIFO for Same Priority

`PriorityQueue` tidak menjamin FIFO untuk elemen dengan priority sama.

Jika perlu FIFO among equal priority, tambahkan sequence number.

```java
import java.util.concurrent.atomic.AtomicLong;

record PrioritizedTask(String id, int priority, long sequence) {}

AtomicLong sequence = new AtomicLong();

Comparator<PrioritizedTask> order = Comparator
    .comparingInt(PrioritizedTask::priority).reversed()
    .thenComparingLong(PrioritizedTask::sequence);

PriorityQueue<PrioritizedTask> pq = new PriorityQueue<>(order);

pq.offer(new PrioritizedTask("A", 10, sequence.getAndIncrement()));
pq.offer(new PrioritizedTask("B", 10, sequence.getAndIncrement()));
```

Dengan ini, priority tinggi tetap keluar dulu, dan untuk priority sama, yang masuk lebih awal keluar lebih awal.

---

## 37. Common Failure Mode: Comparator Overflow

Buruk:

```java
Comparator<Integer> c = (a, b) -> a - b;
```

Jika `a = Integer.MIN_VALUE` dan `b = 1`, overflow bisa membuat hasil salah.

Lebih baik:

```java
Comparator<Integer> c = Integer::compare;
```

Untuk field:

```java
Comparator<Job> c = Comparator.comparingInt(Job::priority);
```

Untuk long:

```java
Comparator<Event> c = Comparator.comparingLong(Event::timestampMillis);
```

---

## 38. Common Failure Mode: Using PriorityQueue for `contains`

`PriorityQueue.contains(x)` harus scan.

Cost:

```text
O(n)
```

Jika butuh membership check cepat, kombinasikan dengan set/map.

```java
PriorityQueue<Job> queue = new PriorityQueue<>(jobOrder);
Set<String> queuedJobIds = new HashSet<>();
```

Saat offer:

```java
if (queuedJobIds.add(job.id())) {
    queue.offer(job);
}
```

Saat poll valid:

```java
Job job = queue.poll();
queuedJobIds.remove(job.id());
```

Namun hati-hati jika pakai lazy versioning: set/map harus merepresentasikan latest valid state, bukan semua heap entries.

---

## 39. Common Failure Mode: Unbounded Queue

`PriorityQueue` secara API unbounded, tapi memory tetap terbatas.

Jika producer lebih cepat daripada consumer, queue akan tumbuh.

Risiko:

1. Heap memory habis.
2. GC pressure meningkat.
3. Latency memburuk.
4. Stale entries menumpuk.
5. Shutdown makin lama karena backlog besar.

Production checklist:

- Apakah ada max queue size?
- Apa yang terjadi jika full?
- Drop? reject? backpressure? spill to disk? persist to broker?
- Apakah queue size dimonitor?
- Apakah oldest item age dimonitor?
- Apakah stale entry ratio dimonitor?

Priority queue tanpa capacity policy bisa menjadi memory leak yang lambat.

---

## 40. Common Failure Mode: Priority Inversion

Priority inversion terjadi ketika item prioritas rendah menghambat item prioritas tinggi.

Dalam konteks queue, contohnya:

1. Worker mengambil task low-priority yang long-running.
2. Setelah itu high-priority task masuk.
3. High-priority task harus menunggu worker selesai.

Priority queue hanya memilih urutan saat `poll`, bukan menghentikan task yang sudah berjalan.

Solusi tergantung domain:

- task harus kecil dan cooperative,
- worker pool dipisah per priority class,
- preemption jika memungkinkan,
- deadline-aware scheduling,
- max execution time,
- cancellation support.

Priority queue bukan silver bullet untuk scheduling fairness.

---

## 41. Common Failure Mode: Starvation

Jika high-priority task terus masuk, low-priority task bisa tidak pernah diproses.

Solusi:

1. Aging: priority naik seiring waktu tunggu.
2. Weighted fair queue.
3. Separate queues per priority level.
4. Round-robin antar priority class.
5. Deadline override.

Namun aging berarti priority berubah seiring waktu. Jika priority dihitung dinamis dari `now`, comparator bisa menjadi time-dependent dan berbahaya.

Lebih aman:

```text
Hitung effectivePriority saat enqueue/reschedule,
lalu masukkan immutable entry ke queue.
```

Atau gunakan scheduler yang secara eksplisit rebuild/rebucket queue.

---

## 42. Common Failure Mode: Expensive Comparator

Comparator dipanggil berkali-kali saat sift up/down.

Jika comparator melakukan operasi mahal, heap menjadi lambat.

Buruk:

```java
Comparator<Document> c = Comparator.comparingInt(doc -> {
    return parseJsonAndComputeScore(doc.rawJson());
});
```

Lebih baik:

```java
record ScoredDocument(String id, int score, Document document) {}
```

Precompute score sebelum masuk queue.

Comparator ideal:

- pure,
- deterministic,
- cepat,
- tidak melakukan I/O,
- tidak membaca state mutable eksternal,
- tidak allocate berlebihan.

---

## 43. Common Failure Mode: Priority Based on External Mutable State

Contoh buruk:

```java
Map<String, Integer> priorityById = new HashMap<>();

PriorityQueue<String> pq = new PriorityQueue<>(
    Comparator.comparingInt(priorityById::get)
);
```

Jika `priorityById` berubah setelah item masuk queue, heap tidak tahu.

Lebih baik:

```java
record QueueEntry(String id, int priority, long version) {}
```

Snapshot priority saat enqueue.

---

## 44. Choosing Between PriorityQueue and Database Index

Dalam sistem produksi, sering muncul pertanyaan:

```text
Haruskah due task disimpan di PriorityQueue in-memory,
atau query database ORDER BY due_at LIMIT 1?
```

Jawabannya tergantung source-of-truth dan durability.

Gunakan in-memory priority queue jika:

- task transient,
- kehilangan task saat restart acceptable atau bisa direbuild,
- single process ownership jelas,
- latency sangat rendah dibutuhkan,
- queue size manageable.

Gunakan database/index/broker jika:

- task harus durable,
- multi-instance consumer,
- restart tidak boleh kehilangan state,
- auditability penting,
- perlu transactional consistency,
- queue sangat besar,
- perlu query/filter lain.

Hybrid pattern:

```text
DB sebagai source-of-truth.
PriorityQueue sebagai local execution cache/window.
```

Contoh:

1. Query DB untuk due tasks berikutnya.
2. Masukkan batch kecil ke local priority queue.
3. Worker poll dari local queue.
4. Update DB status secara transactional.
5. Periodically refill.

---

## 45. Designing a Priority Entry

Entry yang baik biasanya immutable dan memiliki tie-breaker.

Template:

```java
public record PriorityEntry(
    String id,
    int priority,
    long dueAtMillis,
    long sequence,
    long version
) {}
```

Comparator:

```java
public static final Comparator<PriorityEntry> ORDER = Comparator
    .comparingInt(PriorityEntry::priority).reversed()
    .thenComparingLong(PriorityEntry::dueAtMillis)
    .thenComparingLong(PriorityEntry::sequence)
    .thenComparing(PriorityEntry::id)
    .thenComparingLong(PriorityEntry::version);
```

Mengapa banyak field?

| Field | Fungsi |
|---|---|
| `id` | identity domain |
| `priority` | ordering utama |
| `dueAtMillis` | deadline ordering |
| `sequence` | FIFO tie-breaker |
| `version` | lazy invalidation |

Tidak semua kasus butuh semua field, tetapi ini pola mental yang aman.

---

## 46. Designing PriorityQueue Wrapper

Jangan selalu expose raw `PriorityQueue` ke domain service.

Lebih baik bungkus dengan abstraction yang menjaga invariant.

Contoh:

```java
public final class EscalationQueue {
    private final PriorityQueue<CaseWorkItem> queue;
    private final Map<String, Long> latestVersionByCaseId;
    private long sequence;

    public EscalationQueue() {
        this.queue = new PriorityQueue<>(CaseWorkItem.ORDER);
        this.latestVersionByCaseId = new HashMap<>();
    }

    public void upsert(String caseId, int severity, long dueAtMillis) {
        long version = latestVersionByCaseId.getOrDefault(caseId, 0L) + 1;
        latestVersionByCaseId.put(caseId, version);

        queue.offer(new CaseWorkItem(
            caseId,
            severity,
            dueAtMillis,
            sequence++,
            version
        ));
    }

    public Optional<CaseWorkItem> poll() {
        while (!queue.isEmpty()) {
            CaseWorkItem item = queue.poll();
            Long latest = latestVersionByCaseId.get(item.caseId());

            if (latest != null && latest == item.version()) {
                latestVersionByCaseId.remove(item.caseId());
                return Optional.of(item);
            }
        }
        return Optional.empty();
    }

    public int rawSize() {
        return queue.size();
    }

    public int activeSize() {
        return latestVersionByCaseId.size();
    }

    public record CaseWorkItem(
        String caseId,
        int severity,
        long dueAtMillis,
        long sequence,
        long version
    ) {
        static final Comparator<CaseWorkItem> ORDER = Comparator
            .comparingInt(CaseWorkItem::severity).reversed()
            .thenComparingLong(CaseWorkItem::dueAtMillis)
            .thenComparingLong(CaseWorkItem::sequence)
            .thenComparing(CaseWorkItem::caseId)
            .thenComparingLong(CaseWorkItem::version);
    }
}
```

Catatan:

- `rawSize()` bisa lebih besar dari `activeSize()` karena stale entries.
- Ini harus dimonitor jika lazy strategy dipakai.
- Dalam concurrent environment, wrapper ini butuh synchronization atau concurrent design.

---

## 47. Heap Memory Cost di Java

`PriorityQueue<E>` menyimpan elemen dalam array object reference.

Konsekuensi:

1. Heap array menyimpan references.
2. Object entry berada terpisah di heap memory JVM.
3. Jika entry berupa record object, tetap ada object allocation per entry.
4. Pointer chasing lebih rendah daripada linked tree, tapi tetap ada dereference ke object.
5. Untuk primitive score besar-besaran, primitive array custom bisa lebih hemat.

Contoh:

```java
PriorityQueue<Integer>
```

Memiliki boxing cost karena `Integer`, bukan `int` primitive murni.

Untuk jutaan primitive values, custom `IntHeap` bisa jauh lebih hemat.

---

## 48. Primitive Int Heap Example

Jika workload sangat performance-sensitive dan hanya butuh `int`, kita bisa membuat heap primitive.

```java
import java.util.Arrays;
import java.util.NoSuchElementException;

public final class IntMinHeap {
    private int[] heap;
    private int size;

    public IntMinHeap(int initialCapacity) {
        if (initialCapacity < 0) {
            throw new IllegalArgumentException("initialCapacity must be >= 0");
        }
        this.heap = new int[Math.max(1, initialCapacity)];
    }

    public int size() {
        return size;
    }

    public boolean isEmpty() {
        return size == 0;
    }

    public void offer(int value) {
        ensureCapacity(size + 1);
        heap[size] = value;
        siftUp(size);
        size++;
    }

    public int peek() {
        if (size == 0) {
            throw new NoSuchElementException();
        }
        return heap[0];
    }

    public int poll() {
        if (size == 0) {
            throw new NoSuchElementException();
        }

        int result = heap[0];
        int last = heap[--size];

        if (size > 0) {
            heap[0] = last;
            siftDown(0);
        }

        return result;
    }

    private void siftUp(int index) {
        int value = heap[index];
        while (index > 0) {
            int parent = (index - 1) >>> 1;
            int parentValue = heap[parent];
            if (value >= parentValue) {
                break;
            }
            heap[index] = parentValue;
            index = parent;
        }
        heap[index] = value;
    }

    private void siftDown(int index) {
        int value = heap[index];
        int half = size >>> 1;

        while (index < half) {
            int left = (index << 1) + 1;
            int right = left + 1;
            int child = left;
            int childValue = heap[left];

            if (right < size && heap[right] < childValue) {
                child = right;
                childValue = heap[right];
            }

            if (value <= childValue) {
                break;
            }

            heap[index] = childValue;
            index = child;
        }

        heap[index] = value;
    }

    private void ensureCapacity(int required) {
        if (required <= heap.length) {
            return;
        }
        int newCapacity = heap.length + (heap.length >>> 1) + 1;
        if (newCapacity < required) {
            newCapacity = required;
        }
        heap = Arrays.copyOf(heap, newCapacity);
    }
}
```

Trade-off:

| Aspect | `PriorityQueue<Integer>` | `IntMinHeap` custom |
|---|---|---|
| Generic | yes | no |
| Boxing | yes | no |
| Comparator | yes | no unless custom logic added |
| Memory | higher | lower |
| Maintainability | better | more burden |
| API features | richer | minimal |

Rule:

```text
Gunakan standard library dulu.
Custom primitive heap hanya jika profiling membuktikan bottleneck.
```

---

## 49. PriorityQueue and Concurrency

`PriorityQueue` tidak thread-safe.

Jika beberapa thread melakukan offer/poll bersamaan tanpa synchronization, struktur internal bisa rusak.

Untuk concurrent environment:

1. Gunakan external lock.
2. Gunakan `PriorityBlockingQueue` jika cocok.
3. Gunakan scheduler/concurrent queue yang sesuai.
4. Pisahkan producer/consumer dengan ownership jelas.

Namun `PriorityBlockingQueue` juga punya karakter penting:

- unbounded secara API,
- priority-based blocking retrieval,
- bukan scheduler by delay secara otomatis,
- equal priority ordering tetap perlu tie-breaker jika butuh deterministic/FIFO.

Untuk delayed scheduling, struktur seperti `DelayQueue` lebih sesuai.

Kita tidak akan mendalami concurrency di sini karena sudah ada seri concurrency, tetapi untuk DSA design, kesimpulannya:

```text
Priority semantics dan thread-safety adalah dua concern berbeda.
```

---

## 50. Priority Queue in System Design

Priority queue sering muncul sebagai struktur kecil di dalam sistem besar.

### 50.1 Worker Scheduler

```text
incoming jobs -> priority queue -> workers
```

Pertanyaan desain:

- priority berdasarkan apa?
- apakah starvation acceptable?
- apakah job durable?
- apa max queue size?
- apakah worker bisa cancel/preempt?

### 50.2 Retry Engine

```text
failed task -> compute nextRunAt -> priority queue -> due task processor
```

Pertanyaan desain:

- retry state durable?
- max attempt?
- jitter?
- duplicate prevention?
- poison message handling?

### 50.3 Escalation Engine

```text
case state -> compute urgency -> priority queue -> escalation action
```

Pertanyaan desain:

- priority snapshot atau dynamic?
- source of truth DB atau memory?
- extension/reschedule handling?
- auditability?

### 50.4 Stream Merge

```text
sorted streams -> heap by timestamp -> global ordered stream
```

Pertanyaan desain:

- late events?
- watermark?
- source lag?
- deterministic tie-breaker?

### 50.5 Top-K Analytics

```text
large stream -> bounded heap -> top-k result
```

Pertanyaan desain:

- exact vs approximate?
- memory budget?
- tie-breaker?
- score recomputation?

---

## 51. Decision Framework

Gunakan pertanyaan berikut saat memilih priority queue.

### 51.1 Apa operasi dominan?

```text
Repeatedly get best item? -> PriorityQueue kandidat kuat.
Need sorted range query? -> TreeMap/TreeSet.
Need arbitrary lookup? -> HashMap.
Need arbitrary update priority often? -> Indexed heap or TreeSet.
```

### 51.2 Apakah priority immutable?

```text
Immutable priority -> simple PriorityQueue.
Mutable priority -> remove+offer, lazy versioning, indexed heap, or tree.
```

### 51.3 Apakah result harus deterministic?

```text
Need deterministic tie handling -> add tie-breaker.
Need FIFO among same priority -> add sequence number.
```

### 51.4 Apakah queue boleh hilang saat restart?

```text
Yes -> in-memory PQ possible.
No -> DB/broker/durable scheduler.
```

### 51.5 Apakah queue bounded?

```text
Bounded -> define rejection/backpressure/drop policy.
Unbounded -> monitor memory and backlog.
```

### 51.6 Apakah multi-threaded?

```text
No -> PriorityQueue fine.
Yes -> lock, PriorityBlockingQueue, or dedicated scheduler.
```

---

## 52. Production Checklist

Sebelum memakai `PriorityQueue` di production code, cek:

```text
[ ] Comparator deterministic.
[ ] Comparator tidak overflow.
[ ] Comparator tidak bergantung pada mutable external state.
[ ] Entry immutable atau priority field tidak dimutasi setelah enqueue.
[ ] Tie-breaker eksplisit jika ordering harus deterministic.
[ ] Sequence number jika FIFO among same priority dibutuhkan.
[ ] Arbitrary update/remove tidak menjadi operasi dominan.
[ ] Queue size punya batas atau monitoring.
[ ] Stale entry strategy jelas jika lazy deletion dipakai.
[ ] Source-of-truth jelas: memory, DB, broker, atau hybrid.
[ ] Thread-safety jelas.
[ ] Backpressure/rejection policy jelas.
[ ] Metrics tersedia: size, active size, poll rate, offer rate, stale discard count, oldest due age.
[ ] Test mencakup duplicates, same priority, reschedule, stale entry, empty queue.
```

---

## 53. Mini Case Study: Retry Queue untuk External API

### 53.1 Requirement

Kita punya external API call. Jika gagal karena error retryable, task harus dicoba ulang.

Rules:

1. Retry paling cepat berdasarkan `nextRunAt`.
2. Maximum attempt 5.
3. Retry menggunakan exponential backoff.
4. Jika task di-reschedule, entry lama tidak boleh dieksekusi.
5. Jika beberapa task due bersamaan, urutan deterministic.

### 53.2 Data Structure

Gunakan:

- `PriorityQueue<RetryEntry>` untuk due ordering,
- `Map<String, Long>` untuk latest version,
- immutable record untuk entry.

### 53.3 Entry

```java
record RetryEntry(
    String taskId,
    int attempt,
    long nextRunAtMillis,
    long sequence,
    long version
) {}
```

### 53.4 Comparator

```java
Comparator<RetryEntry> RETRY_ORDER = Comparator
    .comparingLong(RetryEntry::nextRunAtMillis)
    .thenComparingInt(RetryEntry::attempt)
    .thenComparingLong(RetryEntry::sequence)
    .thenComparing(RetryEntry::taskId)
    .thenComparingLong(RetryEntry::version);
```

### 53.5 Invariants

```text
1. Head queue adalah candidate dengan nextRunAt paling kecil.
2. Entry valid jika version == latestVersionByTaskId[taskId].
3. Entry stale harus dibuang saat terlihat di head.
4. attempt tidak boleh melebihi max attempt.
5. Queue boleh punya stale entries, tetapi active map hanya menyimpan latest entry.
```

### 53.6 Implementation Sketch

```java
public final class RetryQueue {
    private static final int MAX_ATTEMPT = 5;

    private final PriorityQueue<RetryEntry> queue = new PriorityQueue<>(RETRY_ORDER);
    private final Map<String, Long> latestVersionByTaskId = new HashMap<>();
    private long sequence;

    public void addFailure(String taskId, int previousAttempt, long nowMillis) {
        int nextAttempt = previousAttempt + 1;
        if (nextAttempt > MAX_ATTEMPT) {
            latestVersionByTaskId.remove(taskId);
            return;
        }

        long version = latestVersionByTaskId.getOrDefault(taskId, 0L) + 1;
        latestVersionByTaskId.put(taskId, version);

        long delay = computeBackoffMillis(nextAttempt);
        long nextRunAt = nowMillis + delay;

        queue.offer(new RetryEntry(
            taskId,
            nextAttempt,
            nextRunAt,
            sequence++,
            version
        ));
    }

    public Optional<RetryEntry> pollDue(long nowMillis) {
        while (!queue.isEmpty()) {
            RetryEntry head = queue.peek();
            Long latestVersion = latestVersionByTaskId.get(head.taskId());

            if (latestVersion == null || latestVersion != head.version()) {
                queue.poll();
                continue;
            }

            if (head.nextRunAtMillis() > nowMillis) {
                return Optional.empty();
            }

            queue.poll();
            latestVersionByTaskId.remove(head.taskId());
            return Optional.of(head);
        }

        return Optional.empty();
    }

    private static long computeBackoffMillis(int attempt) {
        long base = 250L;
        long max = 30_000L;
        long delay = base << Math.min(attempt - 1, 10);
        return Math.min(delay, max);
    }

    public int rawSize() {
        return queue.size();
    }

    public int activeSize() {
        return latestVersionByTaskId.size();
    }

    private record RetryEntry(
        String taskId,
        int attempt,
        long nextRunAtMillis,
        long sequence,
        long version
    ) {}

    private static final Comparator<RetryEntry> RETRY_ORDER = Comparator
        .comparingLong(RetryEntry::nextRunAtMillis)
        .thenComparingInt(RetryEntry::attempt)
        .thenComparingLong(RetryEntry::sequence)
        .thenComparing(RetryEntry::taskId)
        .thenComparingLong(RetryEntry::version);
}
```

### 53.7 Failure Model

| Failure | Mitigation |
|---|---|
| duplicate schedule | version invalidation |
| stale entry executed | check latest version before poll result |
| queue grows from stale entries | monitor raw vs active size, periodic cleanup/rebuild |
| retry storm | backoff + jitter + max attempt |
| process restart loses queue | persist task state if required |
| same due time non-deterministic | sequence + task id tie-breaker |
| memory pressure | bounded queue or durable queue |

---

## 54. Exercises

### Exercise 1 — Heap Invariant

Given array:

```text
[2, 5, 3, 9, 7, 4]
```

Is this a valid min-heap?

Check every parent-child pair.

### Exercise 2 — PriorityQueue Iteration

Create a `PriorityQueue<Integer>` with values:

```text
[10, 1, 7, 3, 5]
```

Print using:

1. `forEach`
2. repeated `poll`

Explain why output differs.

### Exercise 3 — Top-K

Implement `topKByScore(List<Item> items, int k)` where:

```java
record Item(String id, int score) {}
```

Requirement:

1. Return highest score first.
2. For same score, smaller `id` first.
3. Time complexity should be `O(n log k)`.

### Exercise 4 — Median Tracker

Extend `MedianTracker` to support `long` values safely.

Be careful when averaging two large values.

### Exercise 5 — Retry Queue

Modify `RetryQueue` to add jitter:

```text
finalDelay = baseDelay + random(0, baseDelay / 4)
```

Then explain why jitter matters.

### Exercise 6 — Priority Mutation Bug

Write a failing test showing that mutating a field used by comparator after insertion does not reorder `PriorityQueue`.

Then fix it using immutable entry + reinsert.

---

## 55. Key Takeaways

1. Heap is optimized for **next best extraction**, not full sorted traversal.
2. Java `PriorityQueue` is a heap-backed unbounded priority queue whose head is the least element under its ordering.
3. `peek()` is `O(1)`, while `offer()` and `poll()` are `O(log n)`.
4. Arbitrary `contains` and `remove` are `O(n)`.
5. Iterator order is not sorted.
6. Comparator defines priority contract; it must be deterministic, transitive, cheap, and safe from overflow.
7. Do not mutate fields used by comparator after enqueue.
8. For top-k, bounded heap gives `O(n log k)` and `O(k)` memory.
9. K-way merge uses heap size K to merge sorted streams in `O(n log k)`.
10. Two heaps can maintain running median with `O(log n)` insert and `O(1)` median.
11. Java `PriorityQueue` does not support decrease-key directly; use remove+offer, lazy versioning, indexed heap, or tree-based structure.
12. Priority queue is often an execution selection structure, not durable source of truth.
13. In production, always define tie-breaker, capacity/backpressure, update strategy, metrics, and failure model.

---

## 56. Referensi

- Java SE 25 API — `PriorityQueue`: unbounded priority queue based on a priority heap; ordering by natural ordering or comparator; head is least element; iterator order is not guaranteed sorted.
- Java SE 25 API — `Comparator`: comparison function imposing ordering over objects and usable by sorted collections and priority structures.
- Java SE 25 API — `Queue`: collection designed for holding elements prior to processing.
- OpenJDK `PriorityQueue` source: useful for understanding heap-array implementation details, sift-up/sift-down mechanics, and internal representation.

---

## 57. Status Seri

Selesai:

```text
Part 000 — Orientation
Part 001 — Complexity Analysis yang Realistis di Java
Part 002 — Java Object, Array, Reference, Equality, Hashing
Part 003 — Arrays, Dynamic Arrays, ArrayList, dan Cost Model-nya
Part 004 — Linked Structures: LinkedList, Node Chain, Pointer Chasing
Part 005 — Stack, Queue, Deque, Ring Buffer
Part 006 — Hash Table Fundamentals
Part 007 — HashMap, HashSet, LinkedHashMap, IdentityHashMap, WeakHashMap
Part 008 — Ordering, Sorting, Comparator, Comparable
Part 009 — Binary Search, Sorted Data, Navigable Structures
Part 010 — Trees I: Tree Fundamentals, Traversal, Recursion
Part 011 — Trees II: BST, Balanced Tree, Segment Tree, Fenwick Tree
Part 012 — Heap, PriorityQueue, Top-K, Scheduling
```

Berikutnya:

```text
Part 013 — Graph I: Graph Mental Model, Representation, Traversal
```

Seri belum selesai. Kita masih akan lanjut ke graph, shortest path, string algorithms, recursion/backtracking, dynamic programming, greedy, sliding window, bit manipulation, caching structures, concurrent data structures, immutable snapshots, workflow/state-machine DSA, benchmarking, anti-patterns, dan capstone production design.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-dsa-part-011 — Trees II: BST, Balanced Tree, Segment Tree, Fenwick Tree](./learn-java-dsa-part-011.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-013.md](./learn-java-dsa-part-013.md)

</div>