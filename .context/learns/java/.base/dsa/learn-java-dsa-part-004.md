# learn-java-dsa-part-004 — Linked Structures: LinkedList, Node Chain, Pointer Chasing

> Seri: Java Data Structure and Algorithm — Advanced
>
> Bagian: 004 dari 030
>
> Status seri: belum selesai
>
> Fokus: linked structure, `LinkedList`, node chain, pointer chasing, cache locality, iterator mutation, dan kapan linked list benar-benar masuk akal di Java.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan tidak hanya tahu bahwa linked list punya operasi insert/delete `O(1)` dan access `O(n)`, tetapi mampu menjawab pertanyaan engineering yang lebih penting:

1. Mengapa `LinkedList` sering tampak bagus di teori tetapi buruk di production Java.
2. Kapan linked structure lebih cocok daripada array-backed structure.
3. Mengapa pointer chasing, object allocation, dan cache locality bisa mengalahkan Big-O textbook.
4. Bagaimana memahami node, reference, iterator, dan mutation invariant.
5. Bagaimana membangun linked list sendiri untuk memahami trade-off internal.
6. Bagaimana menggunakan linked node sebagai building block untuk struktur lain seperti LRU cache.
7. Bagaimana mendesain keputusan: `ArrayList`, `ArrayDeque`, `LinkedList`, custom node chain, atau struktur lain.

---

## 1. Mental Model: Linked Structure Bukan “List”, Tetapi Chain of Nodes

Linked structure adalah struktur data yang menyimpan elemen dalam node-node terpisah, lalu menghubungkannya memakai reference.

Secara konseptual:

```text
[A] -> [B] -> [C] -> [D] -> null
```

Setiap node biasanya memiliki:

```java
class Node<E> {
    E item;
    Node<E> next;
}
```

Untuk doubly linked list:

```java
class Node<E> {
    E item;
    Node<E> prev;
    Node<E> next;
}
```

Perbedaan penting dengan array:

```text
Array:
[index 0][index 1][index 2][index 3]
contiguous logical storage

Linked list:
[node A] -> [node B] -> [node C] -> [node D]
objects connected by references
```

Array menempatkan reference elemen dalam block yang terindeks. Linked list menyebarkan node sebagai object terpisah di heap. Di Java, ini berarti linked list bukan hanya struktur logis, tetapi juga banyak object kecil yang saling menunjuk.

---

## 2. Invariant Utama Linked List

Struktur data yang baik selalu punya invariant. Linked list bukan sekadar kumpulan node.

Untuk singly linked list:

```text
head points to first node, or null if empty
last node's next is null
size equals number of reachable nodes from head
there must be no accidental cycle
```

Untuk doubly linked list:

```text
first.prev == null
last.next == null
for every node x with x.next = y, y.prev == x
for every node y with y.prev = x, x.next == y
size equals number of reachable nodes from first
```

Untuk list kosong:

```text
first == null
last == null
size == 0
```

Untuk list berisi satu elemen:

```text
first == last
first.prev == null
first.next == null
size == 1
```

Banyak bug linked list terjadi karena invariant edge case ini tidak dijaga.

---

## 3. Textbook Complexity vs Real Java Cost

Textbook sering mengajarkan:

| Operation | ArrayList | LinkedList |
|---|---:|---:|
| random access by index | O(1) | O(n) |
| append | amortized O(1) | O(1) |
| insert at front | O(n) | O(1) |
| delete known node | O(n) or O(1) depending context | O(1) |
| insert/delete in middle with iterator | O(n) to reach + O(1) mutate | O(n) to reach + O(1) mutate |

Tetapi tabel ini sering menyesatkan karena menyembunyikan dua hal:

1. `O(1)` insert/delete pada linked list hanya benar jika kamu sudah punya reference ke node atau posisi iterator.
2. Di Java, setiap node adalah object terpisah, sehingga traversal menghasilkan pointer chasing dan allocation overhead.

Jadi kalimat yang lebih tepat:

> Linked list bagus untuk mutation lokal di posisi yang sudah diketahui, tetapi buruk untuk pencarian posisi.

Kalau kamu harus mencari dulu posisi ke-500000, lalu delete satu node, biayanya bukan `O(1)`. Biayanya:

```text
O(n) traversal + O(1) unlink
```

Dalam production, traversal sering mendominasi.

---

## 4. Pointer Chasing: Musuh Tersembunyi Linked List

Pointer chasing adalah pola akses di mana CPU harus membaca object A untuk mengetahui alamat object B, lalu membaca object B untuk mengetahui alamat object C, dan seterusnya.

```text
read node1.next -> read node2.next -> read node3.next -> read node4.next
```

Masalahnya:

1. CPU tidak bisa dengan mudah memprediksi alamat berikutnya.
2. Memory access bisa meloncat-loncat di heap.
3. Cache locality buruk.
4. Traversal menjadi latency-bound, bukan compute-bound.

Array-backed structure lebih ramah cache karena data referencenya tersusun berdekatan:

```text
array[0], array[1], array[2], array[3]
```

Bahkan jika array menyimpan references ke object, minimal references-nya contiguous. Untuk primitive array, datanya sendiri contiguous.

Linked list menyimpan node-node terpisah:

```text
heap address 0xA010: Node(A)
heap address 0xF220: Node(B)
heap address 0x31C0: Node(C)
heap address 0x9AA0: Node(D)
```

Secara logical rapi, secara memory bisa tersebar.

---

## 5. Node Allocation Cost

Setiap elemen dalam linked list tidak hanya membutuhkan elemen itu sendiri. Ia juga membutuhkan node wrapper.

Untuk doubly linked list, satu node minimal menyimpan:

```text
object header
reference item
reference prev
reference next
padding/alignment
```

Dengan compressed ordinary object pointers pada HotSpot yang umum dipakai, reference sering berukuran 4 byte, tetapi ukuran object tetap dipengaruhi header dan alignment. Jangan menghafal angka tetap karena layout aktual bergantung JVM, flags, dan platform. Gunakan JOL jika butuh validasi.

Intinya:

```text
ArrayList:
backing array of references + elements elsewhere

LinkedList:
one extra Node object per element + references between nodes
```

Untuk 1 juta elemen, `LinkedList` berarti sekitar 1 juta object node tambahan.

Dampaknya:

1. Allocation rate naik.
2. GC harus melacak lebih banyak object.
3. Heap graph menjadi lebih besar.
4. Memory locality memburuk.
5. Traversal bisa lebih lambat walaupun Big-O tampak sama.

---

## 6. Singly Linked List

Singly linked list menyimpan reference ke node berikutnya.

```text
head -> A -> B -> C -> null
```

Minimal implementation:

```java
public final class SinglyLinkedList<E> {
    private Node<E> head;
    private Node<E> tail;
    private int size;

    private static final class Node<E> {
        E item;
        Node<E> next;

        Node(E item) {
            this.item = item;
        }
    }

    public int size() {
        return size;
    }

    public boolean isEmpty() {
        return size == 0;
    }

    public void addFirst(E item) {
        Node<E> node = new Node<>(item);
        node.next = head;
        head = node;
        if (tail == null) {
            tail = node;
        }
        size++;
    }

    public void addLast(E item) {
        Node<E> node = new Node<>(item);
        if (tail == null) {
            head = node;
            tail = node;
        } else {
            tail.next = node;
            tail = node;
        }
        size++;
    }

    public E removeFirst() {
        if (head == null) {
            throw new java.util.NoSuchElementException();
        }
        Node<E> oldHead = head;
        head = oldHead.next;
        oldHead.next = null; // help detach
        if (head == null) {
            tail = null;
        }
        size--;
        return oldHead.item;
    }
}
```

Perhatikan edge case:

1. Insert ke list kosong harus mengubah `head` dan `tail`.
2. Remove elemen terakhir harus mengubah `tail` menjadi `null`.
3. `size` harus selalu konsisten.
4. `oldHead.next = null` membantu memutus chain dari node yang sudah dihapus.

### 6.1 Kenapa `removeLast` Sulit di Singly Linked List?

Untuk remove tail, kamu perlu node sebelum tail.

```text
A -> B -> C -> D -> null
          ^    ^
       prev   tail
```

Tetapi singly linked list tidak punya `prev`. Maka untuk menemukan node sebelum tail, kamu harus traversal dari head.

```java
public E removeLast() {
    if (head == null) {
        throw new java.util.NoSuchElementException();
    }
    if (head == tail) {
        E item = head.item;
        head = null;
        tail = null;
        size--;
        return item;
    }

    Node<E> current = head;
    while (current.next != tail) {
        current = current.next;
    }

    E item = tail.item;
    current.next = null;
    tail = current;
    size--;
    return item;
}
```

Complexity: `O(n)`.

Inilah alasan doubly linked list ada.

---

## 7. Doubly Linked List

Doubly linked list menyimpan reference ke node sebelumnya dan berikutnya.

```text
null <- A <-> B <-> C -> null
```

Keuntungan:

1. Bisa bergerak maju dan mundur.
2. Remove node yang sudah diketahui bisa `O(1)`.
3. Insert sebelum/sesudah node tertentu bisa `O(1)`.
4. Cocok untuk LRU cache pattern.

Kerugian:

1. Memory per node lebih besar.
2. Mutasi lebih rawan bug karena harus menjaga `prev` dan `next`.
3. Lebih banyak reference update.
4. Masih buruk untuk random access dan traversal besar.

Contoh unlink node:

```java
private void unlink(Node<E> node) {
    Node<E> prev = node.prev;
    Node<E> next = node.next;

    if (prev == null) {
        first = next;
    } else {
        prev.next = next;
        node.prev = null;
    }

    if (next == null) {
        last = prev;
    } else {
        next.prev = prev;
        node.next = null;
    }

    node.item = null;
    size--;
}
```

Ada tiga hal penting di sini:

1. Jika `prev == null`, node adalah first.
2. Jika `next == null`, node adalah last.
3. Reference dari node yang dilepas dibersihkan agar tidak mempertahankan object graph lebih lama dari yang perlu.

---

## 8. Sentinel Node

Sentinel node adalah dummy node yang digunakan untuk menyederhanakan edge case.

Tanpa sentinel:

```text
first == null means empty
last == null means empty
```

Dengan sentinel circular doubly linked list:

```text
sentinel <-> A <-> B <-> C <-> sentinel
```

List kosong:

```text
sentinel.next == sentinel
sentinel.prev == sentinel
```

Keuntungan sentinel:

1. Insert/remove tidak perlu banyak special case.
2. Tidak ada `null` boundary untuk traversal internal.
3. Cocok untuk custom intrusive list.

Contoh minimal:

```java
public final class SentinelLinkedList<E> {
    private final Node<E> sentinel = new Node<>(null);
    private int size;

    public SentinelLinkedList() {
        sentinel.next = sentinel;
        sentinel.prev = sentinel;
    }

    private static final class Node<E> {
        E item;
        Node<E> prev;
        Node<E> next;

        Node(E item) {
            this.item = item;
        }
    }

    public void addLast(E item) {
        insertBefore(sentinel, new Node<>(item));
    }

    private void insertBefore(Node<E> target, Node<E> node) {
        Node<E> before = target.prev;
        node.prev = before;
        node.next = target;
        before.next = node;
        target.prev = node;
        size++;
    }
}
```

Trade-off: sentinel membuat internal lebih elegan, tetapi public API tetap harus hati-hati agar sentinel tidak bocor sebagai data.

---

## 9. `java.util.LinkedList`: Apa yang Sebenarnya Ditawarkan?

`java.util.LinkedList` adalah implementasi doubly linked list dari `List` dan `Deque`.

Karena ia mengimplementasikan `List`, ia punya operasi seperti:

```java
get(int index)
add(int index, E element)
remove(int index)
```

Karena ia juga mengimplementasikan `Deque`, ia punya operasi seperti:

```java
addFirst(E e)
addLast(E e)
removeFirst()
removeLast()
peekFirst()
peekLast()
```

Ini sering membingungkan: `LinkedList` bisa dipakai sebagai list, queue, deque, atau stack-like structure. Tetapi bisa bukan berarti selalu cocok.

### 9.1 `get(index)` pada `LinkedList`

Pada `ArrayList`:

```java
array[index]
```

Pada `LinkedList`:

```text
walk from first or last until index reached
```

Secara konseptual:

```java
Node<E> node(int index) {
    if (index < (size >> 1)) {
        Node<E> x = first;
        for (int i = 0; i < index; i++) {
            x = x.next;
        }
        return x;
    } else {
        Node<E> x = last;
        for (int i = size - 1; i > index; i--) {
            x = x.prev;
        }
        return x;
    }
}
```

Walaupun bisa mulai dari sisi terdekat, tetap `O(n)`.

### 9.2 Anti-pattern: Loop by Index

Ini buruk:

```java
LinkedList<String> list = new LinkedList<>();

for (int i = 0; i < list.size(); i++) {
    process(list.get(i));
}
```

Kenapa?

Setiap `get(i)` traversal lagi. Total bisa menjadi `O(n²)`.

Gunakan iterator/enhanced for:

```java
for (String value : list) {
    process(value);
}
```

Atau gunakan `ArrayList` jika memang butuh indexed access.

---

## 10. Iterator Mutation: Kapan LinkedList Menjadi Masuk Akal

Linked list menjadi lebih masuk akal ketika kamu sedang berjalan dengan iterator lalu melakukan mutation lokal.

Contoh:

```java
ListIterator<String> it = list.listIterator();
while (it.hasNext()) {
    String value = it.next();
    if (shouldRemove(value)) {
        it.remove();
    }
}
```

Pada linked list, iterator secara internal sudah berada di posisi node tertentu. Remove lokal bisa dilakukan tanpa shift array besar.

Tetapi ini tetap tidak berarti linked list otomatis lebih cepat. Jika operasi remove jarang dan traversal besar, array-backed list masih bisa menang karena cache locality.

Prinsipnya:

```text
LinkedList wins only when local mutation frequency is high enough to compensate for traversal and allocation cost.
```

---

## 11. Fail-Fast Iterator dan Structural Modification

Banyak Java collection, termasuk `LinkedList`, memiliki iterator fail-fast. Artinya, jika list dimodifikasi secara struktural setelah iterator dibuat, kecuali melalui method iterator itu sendiri, iterator dapat melempar `ConcurrentModificationException`.

Contoh bug:

```java
for (String value : list) {
    if (value.startsWith("x")) {
        list.remove(value); // wrong during foreach
    }
}
```

Gunakan iterator:

```java
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    String value = it.next();
    if (value.startsWith("x")) {
        it.remove();
    }
}
```

Penting: fail-fast bukan correctness mechanism untuk concurrency. Ia lebih tepat dipahami sebagai bug detector best-effort. Jangan membangun logic yang bergantung pada exception ini.

---

## 12. `LinkedList` sebagai Queue: Sering Kalah oleh `ArrayDeque`

Untuk queue/deque single-threaded, `ArrayDeque` sering menjadi default yang lebih baik daripada `LinkedList`.

Alasannya:

1. Array-backed.
2. Lebih sedikit object allocation.
3. Locality lebih baik.
4. Tidak ada node wrapper per element.
5. API memang dirancang sebagai deque.

Contoh stack dengan `ArrayDeque`:

```java
Deque<String> stack = new ArrayDeque<>();
stack.push("A");
stack.push("B");
String top = stack.pop();
```

Contoh queue:

```java
Deque<String> queue = new ArrayDeque<>();
queue.addLast("A");
queue.addLast("B");
String next = queue.removeFirst();
```

Gunakan `LinkedList` sebagai deque hanya jika kamu benar-benar butuh karakteristik linked node atau operasi tertentu yang tidak cocok dengan array-backed deque.

---

## 13. `Stack` Legacy dan Hubungannya dengan Linked Structures

`java.util.Stack` adalah class lama berbasis `Vector`. Dalam Java modern, biasanya lebih baik memakai `Deque` untuk stack semantics.

```java
Deque<Integer> stack = new ArrayDeque<>();
stack.push(10);
stack.push(20);
int value = stack.pop();
```

Mengapa ini dibahas di linked list? Karena banyak orang memilih `LinkedList` untuk stack/queue karena textbook mengajarkan stack/queue dengan linked list. Di Java production, pilihan yang lebih sering benar adalah:

```text
Stack semantics -> ArrayDeque
Queue semantics -> ArrayDeque
Deque semantics -> ArrayDeque
Frequent middle iterator mutation -> consider LinkedList
Known-node unlink pattern -> custom linked nodes
LRU cache -> LinkedHashMap or custom hash map + doubly linked list
```

---

## 14. Known Node vs Known Value vs Known Index

Linked list hanya unggul untuk delete jika node sudah diketahui.

Tiga skenario berbeda:

### 14.1 Known Index

```java
list.remove(500_000);
```

Butuh traversal ke index tersebut.

```text
O(n) to locate + O(1) unlink
```

### 14.2 Known Value

```java
list.remove("target");
```

Butuh search by equality.

```text
O(n) search + O(1) unlink
```

### 14.3 Known Node

```java
unlink(node);
```

Jika kamu punya node reference langsung:

```text
O(1)
```

Tetapi public `LinkedList` Java tidak mengekspos node. Jadi skenario known-node biasanya muncul dalam custom structure, bukan penggunaan `java.util.LinkedList` biasa.

---

## 15. Intrusive Linked List

Intrusive linked list adalah linked list di mana object domain sendiri menyimpan pointer `prev/next`, bukan dibungkus node eksternal.

Non-intrusive:

```text
Node(item=TaskA) <-> Node(item=TaskB)
```

Intrusive:

```text
TaskA.prev/next <-> TaskB.prev/next
```

Contoh:

```java
final class Task {
    final String id;
    Task prev;
    Task next;

    Task(String id) {
        this.id = id;
    }
}
```

Keuntungan:

1. Tidak perlu wrapper node tambahan.
2. Known-node unlink mudah.
3. Cocok untuk low-level scheduler/cache/internal runtime structure.

Kerugian:

1. Object domain tercemar detail struktur data.
2. Satu object sulit berada di banyak list sekaligus kecuali punya banyak pasangan pointer.
3. Encapsulation lebih sulit.
4. Bug pointer bisa merusak struktur global.

Untuk enterprise application biasa, intrusive list jarang dibutuhkan. Tetapi penting untuk memahami bahwa “linked list sebagai building block” tidak selalu berarti `java.util.LinkedList`.

---

## 16. LRU Cache: Linked Structure yang Benar-Benar Berguna

Salah satu penggunaan klasik doubly linked list yang valid adalah LRU cache.

Requirement:

```text
get(key): O(1)
put(key, value): O(1)
when accessed, move entry to most-recent position
when capacity exceeded, evict least-recent entry
```

Butuh dua struktur:

1. `HashMap<K, Node<K,V>>` untuk lookup cepat.
2. Doubly linked list untuk urutan recency.

```text
least recent                         most recent
   head  <->  node1  <->  node2  <->  tail
```

Saat `get(key)`:

1. Cari node di map.
2. Jika ada, unlink dari posisi lama.
3. Move ke tail.
4. Return value.

Saat `put(key, value)`:

1. Jika key sudah ada, update dan move to tail.
2. Jika key baru, create node, add to tail, put map.
3. Jika size > capacity, remove head dan delete dari map.

Contoh implementasi sederhana:

```java
public final class LruCache<K, V> {
    private final int capacity;
    private final Map<K, Node<K, V>> index = new HashMap<>();
    private Node<K, V> head;
    private Node<K, V> tail;

    private static final class Node<K, V> {
        K key;
        V value;
        Node<K, V> prev;
        Node<K, V> next;

        Node(K key, V value) {
            this.key = key;
            this.value = value;
        }
    }

    public LruCache(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
    }

    public V get(K key) {
        Node<K, V> node = index.get(key);
        if (node == null) {
            return null;
        }
        moveToTail(node);
        return node.value;
    }

    public void put(K key, V value) {
        Node<K, V> existing = index.get(key);
        if (existing != null) {
            existing.value = value;
            moveToTail(existing);
            return;
        }

        Node<K, V> node = new Node<>(key, value);
        index.put(key, node);
        appendToTail(node);

        if (index.size() > capacity) {
            evictHead();
        }
    }

    private void moveToTail(Node<K, V> node) {
        if (node == tail) {
            return;
        }
        unlink(node);
        appendToTail(node);
    }

    private void appendToTail(Node<K, V> node) {
        node.prev = tail;
        node.next = null;

        if (tail == null) {
            head = node;
        } else {
            tail.next = node;
        }
        tail = node;
    }

    private void unlink(Node<K, V> node) {
        Node<K, V> prev = node.prev;
        Node<K, V> next = node.next;

        if (prev == null) {
            head = next;
        } else {
            prev.next = next;
        }

        if (next == null) {
            tail = prev;
        } else {
            next.prev = prev;
        }

        node.prev = null;
        node.next = null;
    }

    private void evictHead() {
        Node<K, V> victim = head;
        if (victim == null) {
            return;
        }
        unlink(victim);
        index.remove(victim.key);
        victim.key = null;
        victim.value = null;
    }
}
```

Namun di Java, untuk LRU sederhana, kamu sering bisa memakai `LinkedHashMap` access-order.

```java
public final class SimpleLruCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;

    public SimpleLruCache(int capacity) {
        super(16, 0.75f, true); // accessOrder = true
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;
    }
}
```

Lesson:

> Linked node sangat berguna ketika dikombinasikan dengan struktur lain, terutama hash map, untuk mempertahankan urutan mutation yang bisa diubah secara `O(1)`.

---

## 17. Linked List untuk Graph Adjacency?

Secara teori, adjacency list pada graph sering digambarkan sebagai linked list.

```text
A -> B -> C -> D
B -> E
C -> A -> F
```

Dalam Java modern, adjacency list lebih sering direpresentasikan sebagai:

```java
Map<NodeId, List<NodeId>> graph;
```

atau untuk dense integer id:

```java
int[][] adjacency;
```

atau:

```java
List<int[]> adjacency;
```

Kenapa bukan `LinkedList`?

Karena traversal adjacency biasanya jauh lebih sering daripada insert/delete di tengah adjacency. Maka `ArrayList` atau primitive array lebih sering lebih baik.

Gunakan linked structure untuk adjacency hanya jika:

1. Edge sering dihapus dengan known-node reference.
2. Graph sangat dinamis.
3. Kamu mengontrol node/edge object secara custom.
4. Memory dan traversal pattern sudah dibenchmark.

---

## 18. Linked List dan Recursion

Linked list sering digunakan untuk latihan recursion:

```java
int length(Node<?> node) {
    if (node == null) {
        return 0;
    }
    return 1 + length(node.next);
}
```

Tetapi di Java, recursion pada list panjang bisa menyebabkan `StackOverflowError`.

Versi iterative lebih aman:

```java
int length(Node<?> node) {
    int count = 0;
    Node<?> current = node;
    while (current != null) {
        count++;
        current = current.next;
    }
    return count;
}
```

Prinsip production:

> Untuk struktur yang depth-nya berasal dari input/data eksternal, jangan mengandalkan recursion tanpa batas.

---

## 19. Cycle Detection: Ketika Chain Rusak Menjadi Loop

Linked list seharusnya berakhir di `null` atau sentinel. Jika pointer rusak, bisa terbentuk cycle.

```text
A -> B -> C -> D
     ^         |
     |_________|
```

Floyd’s cycle detection:

```java
public static <E> boolean hasCycle(Node<E> head) {
    Node<E> slow = head;
    Node<E> fast = head;

    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) {
            return true;
        }
    }
    return false;
}
```

Mental model:

1. Slow bergerak satu langkah.
2. Fast bergerak dua langkah.
3. Jika ada cycle, fast eventually bertemu slow.
4. Jika tidak ada cycle, fast mencapai null.

Ini penting bukan hanya untuk interview. Dalam domain system, struktur yang dianggap tree/list kadang rusak menjadi cyclic dependency. Pattern slow-fast mengajarkan cara berpikir tentang reachability dan termination.

---

## 20. Reversing Linked List

Reversal adalah latihan pointer invariant.

```text
A -> B -> C -> null

null <- A <- B <- C
```

Implementasi iterative:

```java
public static <E> Node<E> reverse(Node<E> head) {
    Node<E> prev = null;
    Node<E> current = head;

    while (current != null) {
        Node<E> next = current.next;
        current.next = prev;
        prev = current;
        current = next;
    }

    return prev;
}
```

Invariant selama loop:

```text
prev    = reversed prefix
current = remaining suffix head
next    = saved original current.next
```

Jangan update `current.next` sebelum menyimpan `next`, karena kamu akan kehilangan sisa chain.

---

## 21. Removing Nth Node from End

Pattern fast/slow pointer:

```java
public static <E> Node<E> removeNthFromEnd(Node<E> head, int n) {
    Node<E> dummy = new Node<>(null);
    dummy.next = head;

    Node<E> fast = dummy;
    Node<E> slow = dummy;

    for (int i = 0; i < n; i++) {
        if (fast.next == null) {
            throw new IllegalArgumentException("n is larger than list size");
        }
        fast = fast.next;
    }

    while (fast.next != null) {
        fast = fast.next;
        slow = slow.next;
    }

    Node<E> victim = slow.next;
    slow.next = victim.next;
    victim.next = null;
    return dummy.next;
}
```

Kenapa dummy node membantu?

Karena remove head menjadi kasus yang sama dengan remove node lain.

```text
dummy -> A -> B -> C
```

Jika yang dihapus A, `slow` tetap bisa menunjuk dummy.

---

## 22. Merging Two Sorted Linked Lists

```java
public static <E> Node<E> mergeSorted(
        Node<E> a,
        Node<E> b,
        Comparator<? super E> comparator
) {
    Node<E> dummy = new Node<>(null);
    Node<E> tail = dummy;

    while (a != null && b != null) {
        if (comparator.compare(a.item, b.item) <= 0) {
            Node<E> next = a.next;
            tail.next = a;
            tail = a;
            a = next;
        } else {
            Node<E> next = b.next;
            tail.next = b;
            tail = b;
            b = next;
        }
    }

    tail.next = (a != null) ? a : b;
    return dummy.next;
}
```

Ini mengajarkan prinsip:

```text
build result by moving links, not copying values
```

Namun dalam production Java application biasa, sering lebih aman memakai collection library daripada pointer manipulation manual, kecuali kamu benar-benar sedang membangun struktur data internal.

---

## 23. Sorting Linked List

Linked list tidak cocok untuk quicksort berbasis random access. Sorting linked list biasanya memakai merge sort karena:

1. Tidak perlu random access.
2. Split dengan slow/fast pointer.
3. Merge bisa dilakukan dengan relink node.
4. Complexity `O(n log n)`.

Tetapi untuk `java.util.LinkedList`, jangan otomatis menganggap sorting linked list lebih bagus daripada array. Java collection sort memiliki mekanisme tersendiri pada List API dan implementasi bisa menyalin ke array secara internal. Prinsipnya: untuk sorting object collection besar, ukur dengan workload nyata.

---

## 24. LinkedList vs ArrayList vs ArrayDeque

### 24.1 Jika Butuh Indexed Access

Gunakan:

```text
ArrayList
```

Hindari:

```text
LinkedList
```

### 24.2 Jika Butuh Stack/Queue/Deque Single-threaded

Gunakan:

```text
ArrayDeque
```

Hindari default:

```text
LinkedList
Stack
```

### 24.3 Jika Butuh Frequent Middle Remove via Iterator

Pertimbangkan:

```text
LinkedList
```

Tetapi benchmark jika data besar.

### 24.4 Jika Butuh LRU

Gunakan:

```text
LinkedHashMap access-order
```

atau custom:

```text
HashMap + doubly linked list
```

### 24.5 Jika Butuh Known-node O(1) Remove

Gunakan:

```text
custom node-based structure
```

Bukan public `LinkedList`, karena node internal tidak diekspos.

---

## 25. Decision Matrix

| Kebutuhan | Struktur yang Lebih Masuk Akal | Catatan |
|---|---|---|
| Banyak `get(index)` | `ArrayList` | Random access O(1) |
| Banyak append dan iterasi | `ArrayList` | Locality bagus |
| Stack single-threaded | `ArrayDeque` | Hindari `Stack` legacy |
| Queue single-threaded | `ArrayDeque` | Biasanya lebih cepat dari linked node |
| Deque single-threaded | `ArrayDeque` | Default modern |
| Remove saat iterasi | `Iterator` + tergantung struktur | `LinkedList` bisa masuk akal jika remove sering |
| LRU sederhana | `LinkedHashMap` | Access-order support |
| LRU custom kompleks | `HashMap` + doubly linked list | Butuh node control |
| Known-node unlink | custom linked nodes | Public `LinkedList` tidak expose node |
| Graph adjacency traversal-heavy | `ArrayList` / arrays | Hindari linked list default |
| Memory-sensitive collection besar | arrays / primitive collections | Linked node overhead tinggi |

---

## 26. Common Failure Modes

### 26.1 Menggunakan `LinkedList` karena “insert delete O(1)”

Salah framing.

Pertanyaan yang benar:

```text
Apakah posisi node sudah diketahui?
Jika belum, berapa biaya menemukan posisi itu?
```

### 26.2 Loop by Index pada `LinkedList`

```java
for (int i = 0; i < list.size(); i++) {
    process(list.get(i));
}
```

Ini bisa accidental `O(n²)`.

### 26.3 Menggunakan `LinkedList` sebagai Queue Default

Lebih baik mulai dari `ArrayDeque` untuk single-threaded queue/deque.

### 26.4 Menganggap Fail-Fast sebagai Thread Safety

Fail-fast bukan concurrency control.

### 26.5 Node Leak

Jika custom linked structure tidak membersihkan `prev/next/item`, object graph bisa tertahan lebih lama.

### 26.6 Broken Invariant

Contoh:

```text
nodeA.next = nodeB
nodeB.prev != nodeA
```

Traversal maju dan mundur memberi hasil berbeda. Ini bug serius.

### 26.7 Accidental Cycle

Traversal tidak berhenti.

### 26.8 Public Exposure of Node

Jika node diekspos sembarangan, caller bisa merusak invariant internal.

---

## 27. Testing Strategy untuk Custom Linked Structure

Untuk custom linked list, jangan hanya test happy path.

Test invariant setelah setiap operasi:

```java
private void assertInvariants() {
    if (size == 0) {
        assert first == null;
        assert last == null;
        return;
    }

    assert first != null;
    assert last != null;
    assert first.prev == null;
    assert last.next == null;

    int count = 0;
    Node<E> prev = null;
    Node<E> current = first;
    while (current != null) {
        assert current.prev == prev;
        prev = current;
        current = current.next;
        count++;
        assert count <= size; // crude cycle guard
    }

    assert prev == last;
    assert count == size;
}
```

Test cases:

1. Empty list.
2. Add first once.
3. Add last once.
4. Add many.
5. Remove first from one-element list.
6. Remove last from one-element list.
7. Remove middle.
8. Remove head.
9. Remove tail.
10. Interleaved add/remove.
11. Iterator remove.
12. Randomized operations compared against `ArrayList` as oracle.

Randomized test idea:

```java
Random random = new Random(1);
ArrayList<Integer> oracle = new ArrayList<>();
CustomList<Integer> subject = new CustomList<>();

for (int step = 0; step < 100_000; step++) {
    int op = random.nextInt(3);
    // apply same operation to oracle and subject
    // compare size and sequence
}
```

Ini sering menemukan edge-case bug yang tidak terpikir.

---

## 28. Benchmarking LinkedList dengan Benar

Jangan benchmark seperti ini:

```java
long start = System.nanoTime();
// one tiny operation
long end = System.nanoTime();
```

Masalah:

1. JIT warmup.
2. Dead code elimination.
3. GC noise.
4. Data distribution tidak realistis.
5. Single operation terlalu noisy.

Gunakan JMH untuk benchmark serius.

Skenario benchmark yang masuk akal:

1. Append N elements.
2. Iterate N elements.
3. Remove every k-th element using iterator.
4. Queue add/remove.
5. Random get by index.
6. Memory footprint dengan JOL.
7. Allocation rate dengan profiler.

Yang perlu dibandingkan:

```text
ArrayList
LinkedList
ArrayDeque
custom linked structure jika relevan
```

Jangan benchmark hanya satu operasi isolated. Benchmark operation mix.

---

## 29. Production Mental Model: Pilih Struktur Berdasarkan Dominant Operation

Pertanyaan yang harus dijawab sebelum memilih linked list:

1. Apakah saya butuh random access?
2. Apakah saya hanya butuh append dan iterate?
3. Apakah saya butuh remove/insert di tengah?
4. Apakah posisi remove sudah diketahui?
5. Apakah mutation terjadi via iterator?
6. Apakah data besar?
7. Apakah memory overhead penting?
8. Apakah traversal jauh lebih sering daripada mutation?
9. Apakah object allocation/GC menjadi concern?
10. Apakah queue/deque bisa diselesaikan dengan `ArrayDeque`?
11. Apakah LRU bisa diselesaikan dengan `LinkedHashMap`?
12. Apakah saya benar-benar butuh custom node control?

Default yang sehat:

```text
Use ArrayList unless you have a specific reason not to.
Use ArrayDeque for stack/queue/deque unless concurrency or capacity semantics require another structure.
Use LinkedList only when its actual mutation pattern is beneficial.
Use custom linked nodes only for specialized structures with strong invariant control.
```

---

## 30. Domain Example: Escalation Queue dengan Removal Lokal

Misalkan ada case management system dengan escalation candidates.

Requirement:

1. Candidate bisa ditambahkan.
2. Candidate bisa dibatalkan.
3. Candidate bisa dipindahkan ke tail setelah re-evaluation.
4. Lookup by case ID harus cepat.
5. Remove by case ID harus cepat.

`LinkedList<Case>` saja tidak cukup karena remove by case ID perlu search `O(n)`.

Lebih baik:

```text
HashMap<CaseId, Node>
Doubly linked list of Node
```

Dengan begitu:

```text
lookup node by case ID: O(1)
unlink node: O(1)
move node: O(1)
```

Struktur:

```java
final class EscalationQueue {
    private final Map<String, Entry> byCaseId = new HashMap<>();
    private Entry head;
    private Entry tail;

    private static final class Entry {
        final String caseId;
        Entry prev;
        Entry next;

        Entry(String caseId) {
            this.caseId = caseId;
        }
    }
}
```

Ini contoh penting: linked structure menjadi kuat ketika digabung dengan index.

---

## 31. Domain Example: Workflow History Chain

Misalkan setiap case punya transition history:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
```

Apakah linked list cocok?

Jika requirement hanya append dan read all history, `ArrayList` sering lebih baik:

```java
List<TransitionHistory> history = new ArrayList<>();
```

Kenapa?

1. Append amortized `O(1)`.
2. Iterasi cepat.
3. Memory overhead lebih rendah.
4. Snapshot/export/report lebih natural.

Linked list hanya masuk akal jika:

1. Sering insert di tengah history.
2. Sering remove known node.
3. Ada cursor aktif yang bergerak maju/mundur.

Untuk audit/history, biasanya data append-only. Maka `ArrayList` atau persistent append log lebih masuk akal daripada linked list.

---

## 32. Domain Example: Undo/Redo

Undo/redo bisa dimodelkan dengan doubly linked list atau dua stack.

### Opsi 1: Doubly Linked List + Cursor

```text
state1 <-> state2 <-> state3 <-> state4
                    ^ cursor
```

Undo:

```text
cursor = cursor.prev
```

Redo:

```text
cursor = cursor.next
```

Jika user melakukan action baru setelah undo, suffix setelah cursor dibuang.

### Opsi 2: Two Stacks

```text
undoStack
redoStack
```

Untuk banyak aplikasi, two stacks dengan `ArrayDeque` lebih sederhana.

```java
Deque<Command> undo = new ArrayDeque<>();
Deque<Command> redo = new ArrayDeque<>();
```

Prinsip:

> Jangan memilih linked list hanya karena domain terlihat seperti chain. Pilih berdasarkan operasi aktual.

---

## 33. Checklist: Kapan LinkedList Layak?

Gunakan `LinkedList` atau linked structure jika sebagian besar benar:

- [ ] Random access tidak penting.
- [ ] Traversal by iterator adalah pola utama.
- [ ] Insert/remove di posisi iterator sering terjadi.
- [ ] Data size tidak terlalu besar, atau sudah dibenchmark.
- [ ] Memory overhead node masih acceptable.
- [ ] Queue/deque biasa tidak cukup diselesaikan `ArrayDeque`.
- [ ] Butuh stable node identity secara internal.
- [ ] Butuh move-to-front/move-to-back cepat dengan known node.
- [ ] Bisa menjaga invariant pointer dengan ketat.

Hindari linked list jika:

- [ ] Banyak `get(index)`.
- [ ] Banyak scan besar.
- [ ] Data sangat besar dan memory-sensitive.
- [ ] Hanya butuh append dan iterate.
- [ ] Hanya butuh stack/queue/deque biasa.
- [ ] Kamu belum mengukur operation mix.

---

## 34. Ringkasan Mental Model

Linked list bukan struktur data “lebih dinamis” secara otomatis. Ia adalah struktur data dengan trade-off tajam:

```text
Good:
- local insert/delete when position/node is known
- move node within sequence
- combine with hash map for O(1) lookup + O(1) unlink
- useful as internal building block

Bad:
- random access
- large traversal
- memory overhead
- cache locality
- GC pressure
- pointer invariant bugs
```

Kalimat paling penting:

> Linked list mengoptimalkan mutation lokal, bukan pencarian posisi.

Dan dalam Java:

> Linked list juga membawa biaya object allocation, reference chasing, dan GC tracking yang sering lebih besar daripada yang terlihat dalam Big-O textbook.

---

## 35. Latihan

### Latihan 1 — Implementasi Singly Linked List

Implementasikan:

```java
addFirst(E item)
addLast(E item)
removeFirst()
contains(E item)
size()
isEmpty()
```

Tambahkan invariant check internal.

### Latihan 2 — Implementasi Doubly Linked List

Implementasikan:

```java
addFirst(E item)
addLast(E item)
removeFirst()
removeLast()
remove(Node<E> node)
```

Uji edge case list kosong, satu elemen, dua elemen, banyak elemen.

### Latihan 3 — Compare with ArrayList

Buat benchmark sederhana dengan JMH untuk:

1. Append 1 juta elemen.
2. Iterate semua elemen.
3. Remove setiap elemen ke-10 via iterator.
4. Random access 100 ribu index.

Bandingkan `ArrayList` dan `LinkedList`.

### Latihan 4 — LRU Cache

Implementasikan LRU cache dengan:

```text
HashMap<K, Node<K,V>>
Doubly linked list
```

Lalu implementasikan versi `LinkedHashMap`.

Bandingkan kompleksitas dan maintainability.

### Latihan 5 — Domain Design

Desain struktur data untuk escalation queue:

```text
- add case
- cancel by case ID
- move case to back
- pop next case
- check existence by case ID
```

Tentukan:

1. Struktur data yang dipakai.
2. Invariant.
3. Complexity tiap operation.
4. Failure modes.

---

## 36. Referensi

Referensi utama untuk bagian ini:

1. Oracle Java SE 25 API — `java.util.LinkedList`.
2. Oracle Java SE 25 API — `java.util.ArrayDeque`.
3. Oracle Java SE 25 API — `java.util.Deque`.
4. OpenJDK JOL — Java Object Layout.
5. OpenJDK source code untuk memahami implementasi internal collection, dengan catatan: source code adalah implementation detail dan bisa berubah antar versi.

---

## 37. Penutup

Bagian ini membahas linked structure secara mendalam, terutama gap antara teori textbook dan realitas Java. Kesimpulan utamanya bukan bahwa `LinkedList` buruk, tetapi bahwa `LinkedList` sering dipakai untuk alasan yang salah.

Linked structure tetap sangat penting sebagai building block untuk cache, scheduler, intrusive queue, LRU, dan struktur dengan known-node mutation. Namun untuk penggunaan collection sehari-hari, `ArrayList` dan `ArrayDeque` sering menjadi pilihan default yang lebih sehat.

Pada bagian berikutnya, kita akan masuk ke:

```text
Part 005 — Stack, Queue, Deque, Ring Buffer
```

Di sana kita akan membahas struktur linear untuk kontrol alur: LIFO, FIFO, bounded buffer, monotonic stack/queue, ring buffer, dan bagaimana semua ini menjadi fondasi scheduler, BFS/DFS, retry queue, event buffer, dan backpressure.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dsa-part-003.md](./learn-java-dsa-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-005 — Stack, Queue, Deque, Ring Buffer](./learn-java-dsa-part-005.md)
