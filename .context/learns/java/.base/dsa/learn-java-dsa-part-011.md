# learn-java-dsa-part-011 — Trees II: BST, Balanced Tree, Segment Tree, Fenwick Tree

> Seri: **Java Data Structure and Algorithm**  
> Bagian: **011 dari 030**  
> Status seri: **belum selesai**  
> Fokus: memahami tree bukan hanya sebagai hierarki, tetapi sebagai struktur indeks, struktur agregasi, dan struktur query/update yang mempertahankan invariant tertentu.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya, kita membahas tree sebagai struktur hierarki: root, parent, child, traversal, recursion, iterative traversal, dan risiko ketika struktur yang dikira tree ternyata graph.

Bagian ini naik satu level. Kita akan melihat tree sebagai **mesin query**.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami kenapa binary search tree bisa memberi pencarian `O(log n)` hanya jika bentuk tree tetap seimbang.
2. Membedakan binary tree biasa, binary search tree, balanced search tree, segment tree, dan Fenwick tree.
3. Memahami mental model red-black tree yang menjadi dasar `TreeMap` dan `TreeSet` di Java.
4. Mendesain struktur data untuk range query, prefix query, threshold lookup, dan dynamic aggregation.
5. Menentukan kapan memakai:
   - sorted array,
   - `TreeMap`,
   - `TreeSet`,
   - segment tree,
   - Fenwick tree,
   - atau sekadar prefix sum.
6. Melihat trade-off Java-specific:
   - node-based structure vs array-based structure,
   - object overhead,
   - comparator cost,
   - recursion risk,
   - cache locality,
   - memory pressure.
7. Menghubungkan struktur tree ke sistem produksi seperti rule engine, effective-date configuration, quota tracking, range validation, dan time-bucket metrics.

---

## 1. Mental Model: Tree sebagai Index, Bukan Sekadar Hierarki

Tree bisa dipakai untuk banyak hal. Dua kategori besar yang penting:

1. **Structural tree**
   - merepresentasikan hubungan parent-child,
   - contoh: menu, org chart, folder, approval hierarchy.

2. **Algorithmic/index tree**
   - sengaja dibentuk untuk mempercepat operasi,
   - bentuknya bukan karena domain memang hierarkis,
   - bentuknya karena kita ingin query/update lebih cepat.

Contoh:

```text
Data domain:
[10, 20, 30, 40, 50, 60, 70]
```

Sebagai list biasa, pencarian angka `60` bisa `O(n)`.

Sebagai sorted array, pencarian bisa binary search `O(log n)`.

Sebagai balanced BST, pencarian, insert, delete bisa `O(log n)`.

Sebagai segment tree, query agregasi range seperti sum/min/max bisa `O(log n)`.

Sebagai Fenwick tree, prefix sum dan point update bisa `O(log n)` dengan memory compact.

Jadi pertanyaan desainnya bukan:

> Apakah datanya berbentuk tree?

Melainkan:

> Apakah operasi yang dominan membutuhkan struktur yang membagi ruang pencarian atau ruang agregasi secara hierarkis?

---

## 2. Binary Search Tree: Invariant Paling Penting

Binary Search Tree atau BST adalah binary tree dengan invariant:

```text
Untuk setiap node X:
- semua key di subtree kiri < key X
- semua key di subtree kanan > key X
```

Atau jika duplicate diizinkan, aturan duplicate harus eksplisit, misalnya:

```text
left  <= node < right
```

atau:

```text
left  < node <= right
```

Namun pada struktur seperti `Map`/`Set`, duplicate key biasanya tidak diizinkan. Jika key sama, value diganti.

Contoh BST:

```text
        40
       /  \
     20    60
    / \   / \
  10  30 50 70
```

Mencari `50`:

```text
50 dibanding 40 -> lebih besar -> kanan
50 dibanding 60 -> lebih kecil -> kiri
50 dibanding 50 -> ketemu
```

Biaya pencarian bergantung pada tinggi tree.

```text
search cost = O(height)
```

Jika tree seimbang:

```text
height ≈ log2(n)
```

Jika tree miring:

```text
height ≈ n
```

---

## 3. BST yang Tidak Seimbang Bisa Menjadi Linked List

Jika data dimasukkan dalam urutan naik:

```text
10, 20, 30, 40, 50
```

BST naive bisa menjadi:

```text
10
  \
   20
     \
      30
        \
         40
           \
            50
```

Ini masih BST secara invariant, tetapi performanya buruk.

Pencarian `50`:

```text
10 -> 20 -> 30 -> 40 -> 50
```

Biaya:

```text
O(n)
```

Mental model penting:

> BST tidak otomatis cepat. BST cepat hanya jika tinggi tree terkendali.

Karena itu, production library biasanya tidak memakai BST naive untuk sorted map/set. Mereka memakai **self-balancing tree**.

---

## 4. Binary Tree vs Binary Search Tree vs Balanced Search Tree

| Struktur | Invariant utama | Cocok untuk |
|---|---|---|
| Binary tree | Maksimal 2 child | Representasi struktur umum |
| BST | left < node < right | Search by ordering |
| Balanced BST | BST + height controlled | Dynamic ordered map/set |
| Red-black tree | BST + color invariant | Ordered map/set dengan operasi stabil `O(log n)` |
| AVL tree | BST + height balance ketat | Lookup-heavy workload |
| Segment tree | Node menyimpan agregasi range | Range query/update |
| Fenwick tree | Array partial sums berbasis bit | Prefix query + point update |

---

## 5. Implementasi BST Sederhana di Java

Contoh minimal untuk memahami invariant, bukan implementasi production-ready:

```java
import java.util.Objects;

public final class IntBinarySearchTree {
    private Node root;
    private int size;

    private static final class Node {
        final int key;
        Node left;
        Node right;

        Node(int key) {
            this.key = key;
        }
    }

    public boolean contains(int key) {
        Node current = root;

        while (current != null) {
            if (key < current.key) {
                current = current.left;
            } else if (key > current.key) {
                current = current.right;
            } else {
                return true;
            }
        }

        return false;
    }

    public boolean add(int key) {
        if (root == null) {
            root = new Node(key);
            size++;
            return true;
        }

        Node current = root;

        while (true) {
            if (key < current.key) {
                if (current.left == null) {
                    current.left = new Node(key);
                    size++;
                    return true;
                }
                current = current.left;
            } else if (key > current.key) {
                if (current.right == null) {
                    current.right = new Node(key);
                    size++;
                    return true;
                }
                current = current.right;
            } else {
                return false;
            }
        }
    }

    public int size() {
        return size;
    }
}
```

Apa yang benar dari implementasi ini?

1. Mempertahankan BST invariant.
2. Tidak memakai recursion, sehingga aman dari stack overflow untuk traversal search/insert.
3. Menolak duplicate key.

Apa yang tidak production-grade?

1. Tidak balanced.
2. Bisa menjadi linked list.
3. Tidak mendukung delete.
4. Tidak mendukung comparator.
5. Tidak thread-safe.
6. Tidak menyediakan iterator.
7. Tidak mengelola memory overhead.

---

## 6. Deletion di BST: Bagian yang Sering Diremehkan

Menghapus node di BST punya tiga kasus.

### 6.1 Case 1: Node adalah leaf

```text
    20
   /  \
 10   30
```

Hapus `10`:

```text
    20
      \
      30
```

Mudah: parent tinggal melepas pointer.

### 6.2 Case 2: Node punya satu child

```text
    20
   /  \
 10   30
        \
        40
```

Hapus `30`:

```text
    20
   /  \
 10   40
```

Parent diarahkan ke child node yang dihapus.

### 6.3 Case 3: Node punya dua child

```text
        40
       /  \
     20    60
    / \   / \
  10  30 50 70
```

Hapus `40`.

Kita perlu pengganti yang tetap menjaga invariant. Umumnya memakai:

1. **In-order successor**: node terkecil di subtree kanan.
2. **In-order predecessor**: node terbesar di subtree kiri.

Jika memakai successor:

```text
successor(40) = 50
```

Tree menjadi:

```text
        50
       /  \
     20    60
    / \     \
  10  30    70
```

Mental model:

> Delete bukan sekadar “remove node”. Delete adalah operasi menjaga ordering invariant setelah struktur berubah.

Pada balanced tree, delete lebih kompleks karena setelah delete kita juga harus memulihkan balance invariant.

---

## 7. Balanced Tree: Kenapa Perlu Rotasi

Agar operasi tetap `O(log n)`, tree perlu menjaga tinggi.

Self-balancing tree melakukan perubahan lokal yang disebut **rotation**.

### 7.1 Right Rotation

Sebelum:

```text
      30
     /
   20
  /
10
```

Setelah right rotation di `30`:

```text
    20
   /  \
 10   30
```

### 7.2 Left Rotation

Sebelum:

```text
10
  \
   20
     \
      30
```

Setelah left rotation di `10`:

```text
    20
   /  \
 10   30
```

Rotation menjaga BST invariant.

Yang berubah hanya bentuk tree, bukan urutan sorted-nya.

```text
in-order traversal sebelum = 10, 20, 30
in-order traversal sesudah = 10, 20, 30
```

Inilah kunci balancing:

> Rotasi mengubah shape, tetapi tidak mengubah sorted order.

---

## 8. Red-Black Tree: Mental Model, Bukan Hafalan Warna

`TreeMap` di Java didokumentasikan sebagai implementasi `NavigableMap` berbasis red-black tree dan menyediakan guaranteed `log(n)` untuk operasi inti seperti `containsKey`, `get`, `put`, dan `remove`.

Red-black tree adalah BST dengan tambahan warna pada node.

Secara konseptual, invariant-nya:

1. Setiap node berwarna merah atau hitam.
2. Root hitam.
3. Leaf kosong dianggap hitam.
4. Node merah tidak boleh punya child merah.
5. Semua path dari node ke descendant leaf kosong memiliki jumlah black node yang sama.

Tujuan semua aturan ini:

> Memastikan tidak ada path yang terlalu panjang dibanding path lain.

Red-black tree tidak seimbang seketat AVL tree, tetapi cukup seimbang untuk menjamin operasi `O(log n)` dengan biaya update yang relatif efisien.

### 8.1 Kenapa Red-Black Tree Cocok untuk General-Purpose Library?

Karena `Map`/`Set` umum perlu balance antara:

1. lookup,
2. insert,
3. delete,
4. iteration in sorted order,
5. range query,
6. predictable worst-case complexity.

AVL tree biasanya lebih ketat balance-nya, lookup bisa sangat bagus, tetapi update bisa lebih banyak rebalancing. Red-black tree sering menjadi pilihan library karena trade-off-nya stabil.

### 8.2 Yang Perlu Dipahami Engineer Java

Kamu tidak perlu menghafal semua kasus recoloring red-black tree untuk memakai `TreeMap` dengan benar.

Yang perlu kamu pahami:

1. `TreeMap` bergantung pada ordering, bukan hashing.
2. Key dibandingkan menggunakan natural ordering atau `Comparator`.
3. Comparator harus konsisten dan transitive.
4. Operasi utama `O(log n)`.
5. Iterasi menghasilkan sorted order.
6. Range operation seperti `subMap`, `headMap`, `tailMap`, `floorEntry`, `ceilingEntry` adalah alasan utama memilihnya dibanding `HashMap`.

---

## 9. AVL Tree vs Red-Black Tree

AVL tree mempertahankan balance factor:

```text
balanceFactor(node) = height(left) - height(right)
```

Biasanya invariant AVL:

```text
-1 <= balanceFactor <= 1
```

Artinya AVL sangat ketat menjaga tinggi.

Perbandingan praktis:

| Aspek | AVL Tree | Red-Black Tree |
|---|---|---|
| Balance | Lebih ketat | Lebih longgar |
| Lookup | Sangat baik | Baik |
| Insert/delete | Bisa lebih banyak rotasi | Biasanya lebih murah |
| Library general-purpose | Kurang umum dibanding RBT | Sangat umum |
| Cocok untuk | Lookup-heavy custom index | General ordered map/set |

Untuk seri ini, AVL penting sebagai konsep, tetapi dalam Java standard library kamu lebih sering berinteraksi dengan red-black tree melalui `TreeMap`/`TreeSet`.

---

## 10. `TreeMap` dan `TreeSet` sebagai Balanced Search Tree di Java

`TreeMap<K, V>` adalah ordered map.

Contoh:

```java
import java.time.LocalDate;
import java.util.NavigableMap;
import java.util.TreeMap;

public final class EffectiveRateTable {
    private final NavigableMap<LocalDate, Rate> ratesByEffectiveDate = new TreeMap<>();

    public void put(LocalDate effectiveDate, Rate rate) {
        ratesByEffectiveDate.put(effectiveDate, rate);
    }

    public Rate findRateAt(LocalDate date) {
        var entry = ratesByEffectiveDate.floorEntry(date);
        if (entry == null) {
            throw new IllegalArgumentException("No rate configured for date " + date);
        }
        return entry.getValue();
    }

    public record Rate(String code, double value) {}
}
```

Kenapa `TreeMap` cocok?

Karena operasi yang dibutuhkan bukan hanya `get(exactKey)`.

Kita butuh:

```text
cari effective date terbesar yang <= tanggal tertentu
```

Itu operasi ordered lookup:

```java
floorEntry(date)
```

Dengan `HashMap`, kita tidak punya operasi `floor`.

### 10.1 `TreeSet`

`TreeSet<E>` secara konseptual adalah set yang menjaga elemen dalam sorted order.

Contoh use case:

```java
import java.util.NavigableSet;
import java.util.TreeSet;

public final class SeverityThresholds {
    private final NavigableSet<Integer> thresholds = new TreeSet<>();

    public SeverityThresholds() {
        thresholds.add(10);
        thresholds.add(50);
        thresholds.add(100);
        thresholds.add(500);
    }

    public int nextThresholdAtLeast(int value) {
        Integer threshold = thresholds.ceiling(value);
        if (threshold == null) {
            throw new IllegalArgumentException("No threshold for value " + value);
        }
        return threshold;
    }
}
```

---

## 11. Comparator adalah Bagian dari Data Structure

Pada hash table, correctness bergantung pada `equals/hashCode`.

Pada tree map/set, correctness bergantung pada comparator.

Contoh bug serius:

```java
import java.util.Comparator;
import java.util.TreeSet;

record User(long id, String email) {}

public class BadComparatorExample {
    public static void main(String[] args) {
        var users = new TreeSet<User>(Comparator.comparing(User::email));

        users.add(new User(1, "a@example.com"));
        users.add(new User(2, "a@example.com"));

        System.out.println(users.size()); // 1
    }
}
```

Kenapa `size()` menjadi 1?

Karena menurut comparator, dua user dengan email sama dianggap equivalent dalam tree ordering.

Tree set tidak peduli `id` jika comparator hanya membandingkan email.

Mental model:

> Dalam `TreeSet`, duplicate ditentukan oleh hasil comparison `0`, bukan selalu oleh `equals`.

Comparator yang buruk bisa membuat data hilang secara diam-diam.

Comparator harus:

1. transitive,
2. antisymmetric,
3. consistent,
4. ideally consistent with equals jika dipakai untuk set/map umum.

---

## 12. Sorted Array vs TreeMap

Kadang orang langsung memakai `TreeMap` untuk semua ordered data. Itu belum tentu optimal.

Jika data:

1. jarang berubah,
2. banyak dibaca,
3. bisa dibangun sekali,
4. ukurannya cukup besar,
5. lookup exact/lower-bound sederhana,

maka sorted array/list + binary search bisa lebih efisien daripada tree.

Kenapa?

1. Array punya memory locality lebih baik.
2. Tidak ada node object per entry.
3. Tidak ada pointer chasing.
4. CPU cache lebih ramah.
5. Allocation lebih rendah.

Perbandingan:

| Aspek | Sorted array/list | TreeMap |
|---|---|---|
| Search | `O(log n)` | `O(log n)` |
| Insert tengah | `O(n)` | `O(log n)` |
| Delete tengah | `O(n)` | `O(log n)` |
| Range scan | Sangat cache-friendly | Bisa, tapi pointer chasing |
| Memory overhead | Rendah | Lebih tinggi |
| Dynamic update | Buruk | Baik |
| API range operation | Manual | Built-in |

Rule of thumb:

```text
Read-mostly sorted dataset -> sorted array/list
Frequently mutated ordered dataset -> TreeMap/TreeSet
Range query with aggregate -> segment tree / Fenwick tree / prefix sum
```

---

## 13. Segment Tree: Tree untuk Range Aggregation

Segment tree menjawab pertanyaan seperti:

```text
Berapa sum/min/max pada range [L, R]?
```

Untuk array:

```text
index: 0  1  2  3  4  5
value: 2  1  5  3  4  7
```

Pertanyaan:

```text
sum(1, 4) = 1 + 5 + 3 + 4 = 13
```

Jika pakai loop biasa:

```text
O(n) per query
```

Jika banyak query, ini mahal.

Segment tree menyimpan agregasi per segment.

```text
                 [0..5]
                sum=22
              /        \
          [0..2]       [3..5]
          sum=8        sum=14
         /    \        /    \
      [0..1] [2..2] [3..4] [5..5]
      sum=3  sum=5  sum=7  sum=7
      /  \          /  \
   [0]  [1]       [3]  [4]
    2    1         3    4
```

Range query `[1..4]` dipecah menjadi node-node segment yang tepat.

```text
[1..1] + [2..2] + [3..4]
```

Biaya:

```text
O(log n) untuk query
O(log n) untuk point update
O(n) untuk build
```

---

## 14. Segment Tree sebagai Array, Bukan Node Object

Di Java, segment tree hampir selalu lebih baik direpresentasikan dengan array daripada node object.

Kenapa?

Node object:

```java
final class Node {
    int left;
    int right;
    long sum;
    Node leftChild;
    Node rightChild;
}
```

Masalah:

1. Banyak object allocation.
2. Pointer chasing.
3. GC pressure.
4. Memory overhead object header.
5. Cache locality buruk.

Array representation:

```text
node i
left child  = 2 * i
right child = 2 * i + 1
```

Biasanya memakai 1-based indexing untuk memudahkan.

---

## 15. Implementasi Segment Tree untuk Range Sum

```java
import java.util.Arrays;

public final class LongSumSegmentTree {
    private final int n;
    private final long[] tree;

    public LongSumSegmentTree(long[] values) {
        if (values == null) {
            throw new IllegalArgumentException("values must not be null");
        }
        this.n = values.length;
        this.tree = new long[Math.max(1, 4 * n)];

        if (n > 0) {
            build(values, 1, 0, n - 1);
        }
    }

    private void build(long[] values, int node, int left, int right) {
        if (left == right) {
            tree[node] = values[left];
            return;
        }

        int mid = left + (right - left) / 2;
        build(values, node * 2, left, mid);
        build(values, node * 2 + 1, mid + 1, right);

        tree[node] = tree[node * 2] + tree[node * 2 + 1];
    }

    public long query(int queryLeft, int queryRight) {
        checkRange(queryLeft, queryRight);
        return query(1, 0, n - 1, queryLeft, queryRight);
    }

    private long query(int node, int left, int right, int queryLeft, int queryRight) {
        if (queryLeft <= left && right <= queryRight) {
            return tree[node];
        }

        if (right < queryLeft || queryRight < left) {
            return 0L;
        }

        int mid = left + (right - left) / 2;
        long leftSum = query(node * 2, left, mid, queryLeft, queryRight);
        long rightSum = query(node * 2 + 1, mid + 1, right, queryLeft, queryRight);

        return leftSum + rightSum;
    }

    public void update(int index, long newValue) {
        checkIndex(index);
        update(1, 0, n - 1, index, newValue);
    }

    private void update(int node, int left, int right, int index, long newValue) {
        if (left == right) {
            tree[node] = newValue;
            return;
        }

        int mid = left + (right - left) / 2;
        if (index <= mid) {
            update(node * 2, left, mid, index, newValue);
        } else {
            update(node * 2 + 1, mid + 1, right, index, newValue);
        }

        tree[node] = tree[node * 2] + tree[node * 2 + 1];
    }

    private void checkRange(int left, int right) {
        if (n == 0) {
            throw new IllegalStateException("empty segment tree");
        }
        if (left < 0 || right < left || right >= n) {
            throw new IndexOutOfBoundsException(
                    "invalid range [" + left + ", " + right + "] for size " + n
            );
        }
    }

    private void checkIndex(int index) {
        if (index < 0 || index >= n) {
            throw new IndexOutOfBoundsException(
                    "invalid index " + index + " for size " + n
            );
        }
    }

    @Override
    public String toString() {
        return "LongSumSegmentTree{" +
                "n=" + n +
                ", tree=" + Arrays.toString(tree) +
                '}';
    }
}
```

Catatan desain:

1. `long[]` dipakai untuk mengurangi boxing.
2. Ukuran `4 * n` adalah alokasi sederhana yang aman untuk segment tree recursive.
3. Query out-of-range mengembalikan neutral element `0L` untuk sum.
4. Untuk min, neutral element bisa `Long.MAX_VALUE`.
5. Untuk max, neutral element bisa `Long.MIN_VALUE`.
6. Untuk product, neutral element bisa `1L`.

---

## 16. Segment Tree Generic: Hati-Hati dengan Abstraksi

Secara teori kita bisa membuat segment tree generic:

```java
interface Merger<T> {
    T merge(T left, T right);
}
```

Tetapi di Java, generic primitive tidak tersedia di standard generics.

Akibatnya:

```java
SegmentTree<Long>
```

bisa menyebabkan:

1. boxing,
2. object allocation,
3. cache locality buruk,
4. overhead virtual call/lambda,
5. performa jauh kalah dari `long[]` specialized implementation.

Untuk production performance-sensitive structure, sering lebih baik membuat specialized implementation:

```text
LongSumSegmentTree
IntMinSegmentTree
LongMaxSegmentTree
```

Daripada satu generic implementation yang indah tetapi mahal.

Mental model:

> Di Java, generic abstraction sering membayar harga boxing ketika domain-nya primitive-heavy.

---

## 17. Lazy Propagation: Range Update + Range Query

Segment tree biasa bagus untuk:

```text
point update + range query
```

Contoh:

```text
update index 5 menjadi 100
query sum [2..10]
```

Tapi bagaimana jika operasi update-nya range?

```text
add +3 ke semua element [2..10]
query sum [5..8]
```

Jika update range dilakukan satu per satu:

```text
O(k log n)
```

Untuk range panjang, mahal.

Lazy propagation menyimpan update tertunda di node segment.

Mental model:

```text
Jika sebuah update menutupi seluruh segment node,
kita tidak perlu langsung turun ke semua child.
Kita simpan efek update di node itu,
dan hanya push ke child jika nanti dibutuhkan.
```

### 17.1 Struktur Data Lazy Segment Tree

Untuk range add + range sum, kita butuh:

```java
tree[node] = sum segment
lazy[node] = pending addition untuk semua elemen di segment
```

Jika update `+delta` menutupi segment `[left..right]`, maka:

```text
tree[node] += delta * segmentLength
lazy[node] += delta
```

Nanti saat query/update perlu turun ke child, pending delta di-push.

---

## 18. Implementasi Lazy Segment Tree: Range Add, Range Sum

```java
public final class LongRangeAddSumSegmentTree {
    private final int n;
    private final long[] tree;
    private final long[] lazy;

    public LongRangeAddSumSegmentTree(long[] values) {
        if (values == null) {
            throw new IllegalArgumentException("values must not be null");
        }
        this.n = values.length;
        this.tree = new long[Math.max(1, 4 * n)];
        this.lazy = new long[Math.max(1, 4 * n)];

        if (n > 0) {
            build(values, 1, 0, n - 1);
        }
    }

    private void build(long[] values, int node, int left, int right) {
        if (left == right) {
            tree[node] = values[left];
            return;
        }

        int mid = left + (right - left) / 2;
        build(values, node * 2, left, mid);
        build(values, node * 2 + 1, mid + 1, right);
        tree[node] = tree[node * 2] + tree[node * 2 + 1];
    }

    public void add(int updateLeft, int updateRight, long delta) {
        checkRange(updateLeft, updateRight);
        add(1, 0, n - 1, updateLeft, updateRight, delta);
    }

    private void add(int node, int left, int right, int updateLeft, int updateRight, long delta) {
        if (updateLeft <= left && right <= updateRight) {
            apply(node, left, right, delta);
            return;
        }

        if (right < updateLeft || updateRight < left) {
            return;
        }

        push(node, left, right);

        int mid = left + (right - left) / 2;
        add(node * 2, left, mid, updateLeft, updateRight, delta);
        add(node * 2 + 1, mid + 1, right, updateLeft, updateRight, delta);

        tree[node] = tree[node * 2] + tree[node * 2 + 1];
    }

    public long sum(int queryLeft, int queryRight) {
        checkRange(queryLeft, queryRight);
        return sum(1, 0, n - 1, queryLeft, queryRight);
    }

    private long sum(int node, int left, int right, int queryLeft, int queryRight) {
        if (queryLeft <= left && right <= queryRight) {
            return tree[node];
        }

        if (right < queryLeft || queryRight < left) {
            return 0L;
        }

        push(node, left, right);

        int mid = left + (right - left) / 2;
        long leftSum = sum(node * 2, left, mid, queryLeft, queryRight);
        long rightSum = sum(node * 2 + 1, mid + 1, right, queryLeft, queryRight);

        return leftSum + rightSum;
    }

    private void apply(int node, int left, int right, long delta) {
        tree[node] += delta * (right - left + 1L);
        lazy[node] += delta;
    }

    private void push(int node, int left, int right) {
        long pending = lazy[node];
        if (pending == 0L || left == right) {
            return;
        }

        int mid = left + (right - left) / 2;
        apply(node * 2, left, mid, pending);
        apply(node * 2 + 1, mid + 1, right, pending);
        lazy[node] = 0L;
    }

    private void checkRange(int left, int right) {
        if (n == 0) {
            throw new IllegalStateException("empty segment tree");
        }
        if (left < 0 || right < left || right >= n) {
            throw new IndexOutOfBoundsException(
                    "invalid range [" + left + ", " + right + "] for size " + n
            );
        }
    }
}
```

### 18.1 Invariant Lazy Segment Tree

Invariant-nya lebih sulit dari segment tree biasa:

```text
tree[node] selalu merepresentasikan sum segment setelah semua update yang relevan diterapkan pada node tersebut.

lazy[node] merepresentasikan update tertunda yang sudah diterapkan ke tree[node], tetapi belum didorong ke children.
```

Ini penting.

Lazy bukan berarti update belum dihitung sama sekali. Lazy berarti update sudah tercermin di node saat ini, tetapi belum disebarkan ke bawah.

---

## 19. Segment Tree untuk Min/Max dan Custom Aggregate

Segment tree tidak hanya untuk sum.

Bisa untuk:

1. range minimum query,
2. range maximum query,
3. range gcd,
4. count active items,
5. first position satisfying condition,
6. max prefix,
7. combined aggregate.

Contoh aggregate yang lebih kaya:

```java
record SegmentStats(long sum, long min, long max, int count) {
    static SegmentStats of(long value) {
        return new SegmentStats(value, value, value, 1);
    }

    static SegmentStats merge(SegmentStats left, SegmentStats right) {
        return new SegmentStats(
                left.sum + right.sum,
                Math.min(left.min, right.min),
                Math.max(left.max, right.max),
                left.count + right.count
        );
    }
}
```

Tapi hati-hati.

Jika `SegmentStats` dibuat per query/merge, allocation bisa tinggi.

Untuk performance-sensitive path, pertimbangkan:

1. primitive arrays paralel,
2. mutable internal object yang tidak diekspos,
3. preallocated buffers,
4. atau struktur khusus per kebutuhan.

---

## 20. Fenwick Tree / Binary Indexed Tree

Fenwick tree juga dikenal sebagai Binary Indexed Tree atau BIT.

Ia mendukung:

```text
point update: add delta ke index i
prefix query: sum [0..i]
```

Biaya:

```text
update = O(log n)
prefix sum = O(log n)
range sum = O(log n), dengan prefix(r) - prefix(l - 1)
memory = O(n)
```

Fenwick tree sering lebih compact dan lebih sederhana daripada segment tree untuk prefix/range sum dengan point update.

### 20.1 Mental Model Fenwick Tree

Fenwick tree menyimpan partial sums dengan ukuran block berdasarkan bit paling rendah.

Biasanya memakai 1-based indexing.

Untuk index `i`, fungsi:

```java
i & -i
```

mengambil least significant set bit.

Contoh:

```text
i = 12
binary 12 = 1100
-i       = two's complement
12 & -12 = 4
```

Artinya node Fenwick di index 12 bertanggung jawab atas block sepanjang 4.

Secara intuitif:

```text
bit[i] menyimpan sum dari beberapa elemen terakhir yang panjangnya lowbit(i)
```

---

## 21. Implementasi Fenwick Tree di Java

```java
public final class LongFenwickTree {
    private final int n;
    private final long[] tree; // 1-based

    public LongFenwickTree(int size) {
        if (size < 0) {
            throw new IllegalArgumentException("size must not be negative");
        }
        this.n = size;
        this.tree = new long[n + 1];
    }

    public LongFenwickTree(long[] values) {
        if (values == null) {
            throw new IllegalArgumentException("values must not be null");
        }
        this.n = values.length;
        this.tree = new long[n + 1];

        for (int i = 0; i < values.length; i++) {
            add(i, values[i]);
        }
    }

    public void add(int zeroBasedIndex, long delta) {
        checkIndex(zeroBasedIndex);

        int i = zeroBasedIndex + 1;
        while (i <= n) {
            tree[i] += delta;
            i += lowBit(i);
        }
    }

    public long prefixSum(int zeroBasedInclusiveIndex) {
        if (zeroBasedInclusiveIndex < 0) {
            return 0L;
        }
        if (zeroBasedInclusiveIndex >= n) {
            throw new IndexOutOfBoundsException(
                    "invalid index " + zeroBasedInclusiveIndex + " for size " + n
            );
        }

        long sum = 0L;
        int i = zeroBasedInclusiveIndex + 1;
        while (i > 0) {
            sum += tree[i];
            i -= lowBit(i);
        }
        return sum;
    }

    public long rangeSum(int leftInclusive, int rightInclusive) {
        if (leftInclusive < 0 || rightInclusive < leftInclusive || rightInclusive >= n) {
            throw new IndexOutOfBoundsException(
                    "invalid range [" + leftInclusive + ", " + rightInclusive + "] for size " + n
            );
        }

        return prefixSum(rightInclusive) - prefixSum(leftInclusive - 1);
    }

    private void checkIndex(int index) {
        if (index < 0 || index >= n) {
            throw new IndexOutOfBoundsException(
                    "invalid index " + index + " for size " + n
            );
        }
    }

    private static int lowBit(int i) {
        return i & -i;
    }
}
```

---

## 22. Fenwick Tree Walkthrough

Misal values:

```text
index: 0  1  2  3  4  5  6  7
value: 3  2 -1  6  5  4 -3  3
```

Fenwick tree memakai 1-based index:

```text
value index 0 -> tree index 1
value index 1 -> tree index 2
...
value index 7 -> tree index 8
```

Untuk query prefix sum index 6:

```text
i = 7
sum += tree[7]
i -= lowBit(7) -> 7 - 1 = 6
sum += tree[6]
i -= lowBit(6) -> 6 - 2 = 4
sum += tree[4]
i -= lowBit(4) -> 4 - 4 = 0
stop
```

Fenwick tree mengambil beberapa block yang menutup prefix `[0..6]`.

Untuk update index 2 dengan delta `+5`:

```text
i = 3
update tree[3]
i += lowBit(3) -> 4
update tree[4]
i += lowBit(4) -> 8
update tree[8]
i += lowBit(8) -> 16 stop
```

Update naik ke semua block yang mencakup index tersebut.

---

## 23. Fenwick Tree vs Segment Tree

| Aspek | Fenwick Tree | Segment Tree |
|---|---|---|
| Memory | `O(n)` | Biasanya `O(4n)` recursive array |
| Query utama | Prefix sum | Arbitrary range aggregate |
| Range sum | prefix(r) - prefix(l-1) | Direct range query |
| Point update | `O(log n)` | `O(log n)` |
| Range update | Bisa, tapi trikier | Natural dengan lazy propagation |
| Min/max | Terbatas tergantung operation | Natural |
| Implementation | Lebih compact | Lebih fleksibel |
| Debuggability | Sedang | Lebih eksplisit |
| Cocok untuk | cumulative counter | flexible interval aggregation |

Rule of thumb:

```text
Butuh prefix/range sum + point update saja -> Fenwick tree
Butuh min/max/custom aggregate/range update -> Segment tree
Data immutable dan hanya query sum -> Prefix sum array
```

---

## 24. Prefix Sum vs Fenwick Tree vs Segment Tree

Misal kamu punya array `n` data dan operasi:

```text
query sum [L, R]
```

Jika data tidak berubah:

```java
prefix[i + 1] = prefix[i] + values[i]
rangeSum(l, r) = prefix[r + 1] - prefix[l]
```

Build:

```text
O(n)
```

Query:

```text
O(1)
```

Update:

```text
O(n), karena prefix setelah index itu berubah
```

Perbandingan:

| Struktur | Build | Query sum range | Point update | Range update |
|---|---:|---:|---:|---:|
| Raw array | `O(1)` | `O(n)` | `O(1)` | `O(k)` |
| Prefix sum | `O(n)` | `O(1)` | `O(n)` | `O(n)` |
| Fenwick | `O(n log n)` sederhana / `O(n)` optimized | `O(log n)` | `O(log n)` | variasi khusus |
| Segment tree | `O(n)` | `O(log n)` | `O(log n)` | `O(log n)` dengan lazy |

Jangan memakai segment tree kalau prefix sum cukup.

> Struktur data terbaik adalah struktur data paling sederhana yang memenuhi operation contract.

---

## 25. Production Example 1: Effective-Date Configuration

Problem:

```text
Sebuah aturan punya versi berdasarkan effective date.
Untuk tanggal tertentu, cari aturan terbaru yang sudah effective.
```

Data:

```text
2025-01-01 -> Rule V1
2025-03-15 -> Rule V2
2025-06-01 -> Rule V3
```

Query:

```text
find rule at 2025-04-20 -> V2
```

Struktur cocok:

```text
TreeMap<LocalDate, RuleSnapshot>
```

Operasi:

```java
floorEntry(date)
```

Kenapa bukan `HashMap`?

Karena query bukan exact lookup.

Kenapa bukan segment tree?

Karena data adalah ordered key-value, bukan numeric indexed range aggregation.

---

## 26. Production Example 2: SLA Deadline Bucket

Problem:

```text
Ada ribuan case dengan deadline.
Kita perlu mengambil semua case yang deadline-nya sampai hari ini.
```

Struktur:

```java
NavigableMap<LocalDate, List<CaseId>> casesByDeadline = new TreeMap<>();
```

Query:

```java
var due = casesByDeadline.headMap(today.plusDays(1), false);
```

Atau:

```java
while (!casesByDeadline.isEmpty()) {
    var first = casesByDeadline.firstEntry();
    if (first.getKey().isAfter(today)) {
        break;
    }
    process(first.getValue());
    casesByDeadline.pollFirstEntry();
}
```

Ini adalah ordered processing problem.

Tree cocok karena:

1. insert deadline dynamic,
2. remove processed deadline dynamic,
3. butuh earliest deadline,
4. butuh range by date.

---

## 27. Production Example 3: Time-Bucket Metrics dengan Fenwick Tree

Problem:

```text
Kita punya counter per menit dalam satu hari.
Butuh query total event dari menit L sampai R.
Update counter setiap ada event baru.
```

Jumlah bucket:

```text
24 * 60 = 1440
```

Operasi:

```text
add event at minute m
sum events between minute L and R
```

Fenwick tree cocok:

```java
LongFenwickTree eventsPerMinute = new LongFenwickTree(1440);

eventsPerMinute.add(minuteOfDay, 1);
long count = eventsPerMinute.rangeSum(startMinute, endMinute);
```

Kenapa bukan `TreeMap`?

Karena index dense dan numeric.

Kenapa bukan segment tree?

Bisa, tetapi Fenwick lebih compact untuk sum.

Kenapa bukan prefix sum?

Karena data berubah terus.

---

## 28. Production Example 4: Range Validation dengan Segment Tree

Problem:

```text
Sebuah sistem punya quota per time slot.
Kita perlu tahu apakah range booking [start, end] masih punya minimum capacity >= requested.
```

Kita punya array capacity per slot.

Operasi:

1. Query minimum capacity di range.
2. Jika cukup, kurangi capacity di semua slot range itu.

Ini cocok untuk lazy segment tree dengan aggregate minimum dan range add.

```text
query min [start, end]
range add [start, end] by -requested
```

Fenwick tidak cukup natural karena kita butuh range minimum, bukan hanya sum.

---

## 29. Production Example 5: Rule Threshold Lookup

Problem:

```text
Jika score mencapai threshold tertentu, tentukan severity.
```

Data:

```text
0   -> LOW
50  -> MEDIUM
80  -> HIGH
95  -> CRITICAL
```

Query:

```text
score 87 -> threshold floor 80 -> HIGH
```

Struktur:

```java
NavigableMap<Integer, Severity> severityByMinimumScore = new TreeMap<>();
```

Implementasi:

```java
import java.util.NavigableMap;
import java.util.TreeMap;

public final class SeverityClassifier {
    private final NavigableMap<Integer, Severity> severityByMinScore = new TreeMap<>();

    public SeverityClassifier() {
        severityByMinScore.put(0, Severity.LOW);
        severityByMinScore.put(50, Severity.MEDIUM);
        severityByMinScore.put(80, Severity.HIGH);
        severityByMinScore.put(95, Severity.CRITICAL);
    }

    public Severity classify(int score) {
        var entry = severityByMinScore.floorEntry(score);
        if (entry == null) {
            throw new IllegalStateException("No default severity threshold configured");
        }
        return entry.getValue();
    }

    public enum Severity {
        LOW,
        MEDIUM,
        HIGH,
        CRITICAL
    }
}
```

---

## 30. Java-Specific Cost Model: Node Tree vs Array Tree

### 30.1 Node-Based Tree

Contoh:

```java
class Node<K, V> {
    K key;
    V value;
    Node<K, V> left;
    Node<K, V> right;
    Node<K, V> parent;
    boolean color;
}
```

Biaya:

1. Object header per node.
2. Reference per field.
3. Key/value object references.
4. Pointer chasing saat traversal.
5. Comparator call per level.
6. Allocation per insert.
7. GC scanning.

Kelebihan:

1. Dynamic insert/delete mudah.
2. Ordered operation fleksibel.
3. Tidak butuh dense numeric index.
4. API general-purpose.

### 30.2 Array-Based Tree

Contoh segment tree:

```java
long[] tree;
```

Biaya:

1. Memory contiguous.
2. Tidak ada object per node.
3. Cache locality lebih baik.
4. Boxing bisa dihindari.
5. Cocok untuk numeric indexed domain.

Kekurangan:

1. Butuh index dense.
2. Tidak cocok untuk arbitrary object key tanpa mapping.
3. Ukuran biasanya fixed atau resize manual.
4. Implementasi lebih spesifik.

---

## 31. Coordinate Compression: Mengubah Key Sparse Menjadi Index Dense

Segment tree dan Fenwick tree bekerja paling natural pada index integer dense:

```text
0..n-1
```

Tapi data domain sering sparse:

```text
case amount threshold: 1000, 5000, 10000, 25000, 1000000
```

Atau timestamp:

```text
2026-01-01T10:15:03
2026-01-01T14:20:11
2026-01-03T08:01:00
```

Coordinate compression mengubah sorted unique key menjadi index:

```text
1000    -> 0
5000    -> 1
10000   -> 2
25000   -> 3
1000000 -> 4
```

Contoh Java:

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class CoordinateCompression<T extends Comparable<? super T>> {
    private final List<T> sortedUnique;
    private final Map<T, Integer> indexByValue;

    public CoordinateCompression(List<T> values) {
        if (values == null) {
            throw new IllegalArgumentException("values must not be null");
        }

        List<T> copy = new ArrayList<>(values);
        Collections.sort(copy);

        this.sortedUnique = new ArrayList<>();
        T previous = null;
        boolean hasPrevious = false;

        for (T value : copy) {
            if (!hasPrevious || value.compareTo(previous) != 0) {
                sortedUnique.add(value);
                previous = value;
                hasPrevious = true;
            }
        }

        this.indexByValue = new HashMap<>((int) (sortedUnique.size() / 0.75f) + 1);
        for (int i = 0; i < sortedUnique.size(); i++) {
            indexByValue.put(sortedUnique.get(i), i);
        }
    }

    public int indexOf(T value) {
        Integer index = indexByValue.get(value);
        if (index == null) {
            throw new IllegalArgumentException("unknown value: " + value);
        }
        return index;
    }

    public T valueAt(int index) {
        return sortedUnique.get(index);
    }

    public int size() {
        return sortedUnique.size();
    }
}
```

Use case:

1. event timestamp compression,
2. sparse threshold compression,
3. graph node ID compression,
4. range query over known coordinate set.

---

## 32. Recursion vs Iterative Implementation

Segment tree sering diajarkan recursive.

Untuk `n` normal, depth-nya `O(log n)`, jadi recursion biasanya aman.

Namun di production, pertimbangkan:

1. Apakah input size controlled?
2. Apakah query sangat sering?
3. Apakah recursive call overhead relevan?
4. Apakah stack trace/debuggability penting?
5. Apakah coding standard melarang recursion di hot path?

BST naive dengan input sorted bisa depth `O(n)` dan recursion berisiko besar.

Balanced tree depth `O(log n)`, lebih aman.

Segment tree depth `O(log n)`, umumnya aman.

Tetapi untuk library performance-sensitive, iterative implementation bisa lebih baik.

---

## 33. Iterative Segment Tree Singkat

Iterative segment tree sering memakai array ukuran `2n`.

Layout:

```text
leaves at [n .. 2n-1]
parents at [1 .. n-1]
```

Implementasi range sum half-open `[l, r)`:

```java
public final class IterativeLongSumSegmentTree {
    private final int n;
    private final long[] tree;

    public IterativeLongSumSegmentTree(long[] values) {
        if (values == null) {
            throw new IllegalArgumentException("values must not be null");
        }
        this.n = values.length;
        this.tree = new long[Math.max(1, 2 * n)];

        for (int i = 0; i < n; i++) {
            tree[n + i] = values[i];
        }
        for (int i = n - 1; i > 0; i--) {
            tree[i] = tree[i << 1] + tree[i << 1 | 1];
        }
    }

    public void update(int index, long value) {
        if (index < 0 || index >= n) {
            throw new IndexOutOfBoundsException("invalid index " + index);
        }

        int i = index + n;
        tree[i] = value;

        while (i > 1) {
            i >>= 1;
            tree[i] = tree[i << 1] + tree[i << 1 | 1];
        }
    }

    public long query(int leftInclusive, int rightExclusive) {
        if (leftInclusive < 0 || rightExclusive < leftInclusive || rightExclusive > n) {
            throw new IndexOutOfBoundsException(
                    "invalid range [" + leftInclusive + ", " + rightExclusive + ")"
            );
        }

        long result = 0L;
        int left = leftInclusive + n;
        int right = rightExclusive + n;

        while (left < right) {
            if ((left & 1) == 1) {
                result += tree[left++];
            }
            if ((right & 1) == 1) {
                result += tree[--right];
            }
            left >>= 1;
            right >>= 1;
        }

        return result;
    }
}
```

Kelebihan:

1. Lebih compact dari `4n`.
2. Tidak recursive.
3. Sering lebih cepat.

Kekurangan:

1. Lebih sulit dipahami awalnya.
2. Lazy propagation iterative lebih kompleks.
3. Half-open range perlu disiplin.

---

## 34. Designing Tree Structures from Operation Requirements

Jangan mulai dari struktur data. Mulai dari operasi.

Template analisis:

```text
1. Apa key/index-nya?
2. Apakah key dense integer atau arbitrary object?
3. Apakah data sorted?
4. Apakah butuh exact lookup, nearest lookup, atau range lookup?
5. Apakah butuh aggregation?
6. Apakah aggregation-nya sum/min/max/custom?
7. Apakah data berubah?
8. Update-nya point atau range?
9. Query lebih sering atau update lebih sering?
10. Apakah ordering harus deterministic?
11. Apakah memory budget ketat?
12. Apakah concurrent access diperlukan?
```

Mapping awal:

| Requirement | Struktur kandidat |
|---|---|
| Exact lookup by key | `HashMap` |
| Sorted exact + nearest lookup | `TreeMap` |
| Sorted unique values | `TreeSet` |
| Read-only range sum | Prefix sum |
| Point update + range sum | Fenwick tree |
| Point update + range min/max/sum | Segment tree |
| Range update + range query | Lazy segment tree |
| Dynamic arbitrary intervals | `TreeMap` + interval model, atau interval tree custom |
| Dense counter buckets | array/Fenwick/segment tree |
| Effective-date rule | `NavigableMap` |
| Earliest deadline | `PriorityQueue` atau `TreeMap` |

---

## 35. Common Failure Modes

### 35.1 Memakai BST Naive untuk Data yang Bisa Sorted

Jika input sering sorted, BST naive menjadi linked list.

Solusi:

1. gunakan `TreeMap`,
2. gunakan balancing,
3. gunakan sorted array jika read-only,
4. shuffle bukan solusi production untuk correctness.

### 35.2 Comparator Tidak Konsisten

Comparator yang mengembalikan `0` untuk dua object berbeda membuat `TreeSet` menganggap duplicate.

Solusi:

1. definisikan identity bisnis,
2. comparator mencakup tie-breaker,
3. test transitivity dan equality behavior.

Contoh tie-breaker:

```java
Comparator<User> byEmailThenId = Comparator
        .comparing(User::email)
        .thenComparingLong(User::id);
```

### 35.3 Memakai Segment Tree untuk Problem yang Bisa Prefix Sum

Jika data immutable dan hanya range sum query, segment tree terlalu kompleks.

Solusi:

```text
prefix sum
```

### 35.4 Memakai Fenwick untuk Query yang Bukan Prefix-Compatible

Fenwick sangat bagus untuk sum. Tidak semua aggregate cocok.

Range minimum dengan arbitrary update tidak sesederhana sum karena operasi inverse tidak tersedia seperti subtraction pada sum.

### 35.5 Off-by-One pada Range

Kesalahan umum:

```text
[l, r]
vs
[l, r)
```

Solusi:

1. Pilih satu convention.
2. Dokumentasikan di nama method.
3. Pakai suffix `Inclusive` / `Exclusive`.
4. Test boundary.

Contoh:

```java
rangeSumInclusive(left, right)
rangeSumHalfOpen(left, rightExclusive)
```

### 35.6 Integer Overflow pada Mid Calculation

Buruk:

```java
int mid = (left + right) / 2;
```

Lebih aman:

```java
int mid = left + (right - left) / 2;
```

### 35.7 Overflow pada Sum

Jika nilai dan jumlah besar, `int` bisa overflow.

Gunakan `long` untuk sum/counter.

Namun `long` juga bisa overflow untuk domain tertentu. Untuk uang, jangan asal pakai `double`; gunakan minor unit `long` atau `BigDecimal` tergantung requirement.

### 35.8 Memory Explosion

Segment tree `4n` dengan beberapa array:

```text
tree: 4n long
lazy: 4n long
extra: 4n long
```

Untuk `n = 100_000_000`, ini tidak realistis.

Hitung memory sebelum implementasi.

```text
4 * n * 8 bytes = 3.2 GB untuk satu long[] jika n=100M
```

Belum overhead array, lazy array, dan JVM memory lainnya.

---

## 36. Testing Strategy

Tree algorithm rawan bug karena invariant tersembunyi.

### 36.1 Test Against Brute Force

Untuk segment tree/Fenwick, buat oracle sederhana:

```java
long bruteForceSum(long[] values, int left, int right) {
    long sum = 0L;
    for (int i = left; i <= right; i++) {
        sum += values[i];
    }
    return sum;
}
```

Lalu random test:

```java
import java.util.Random;

public final class FenwickRandomTest {
    public static void main(String[] args) {
        Random random = new Random(42);
        int n = 100;
        long[] values = new long[n];
        LongFenwickTree fenwick = new LongFenwickTree(n);

        for (int step = 0; step < 10_000; step++) {
            if (random.nextBoolean()) {
                int index = random.nextInt(n);
                long delta = random.nextInt(201) - 100;
                values[index] += delta;
                fenwick.add(index, delta);
            } else {
                int left = random.nextInt(n);
                int right = left + random.nextInt(n - left);
                long expected = 0L;
                for (int i = left; i <= right; i++) {
                    expected += values[i];
                }
                long actual = fenwick.rangeSum(left, right);
                if (expected != actual) {
                    throw new AssertionError(
                            "expected " + expected + " but got " + actual +
                                    " for [" + left + ", " + right + "]"
                    );
                }
            }
        }
    }
}
```

### 36.2 Boundary Tests

Test:

1. empty input,
2. size 1,
3. query first element,
4. query last element,
5. query full range,
6. update first,
7. update last,
8. negative values,
9. large values,
10. repeated updates.

### 36.3 Invariant Tests for BST

Untuk BST:

1. in-order traversal harus sorted,
2. size sesuai unique insert,
3. contains benar,
4. delete menjaga sorted order,
5. random operation dibandingkan dengan `TreeSet` sebagai oracle.

---

## 37. Performance Notes

### 37.1 Big-O Sama, Performa Bisa Berbeda

`TreeMap` search:

```text
O(log n)
```

Binary search di array:

```text
O(log n)
```

Tapi binary search array bisa lebih cepat karena:

1. contiguous memory,
2. fewer allocations,
3. no node pointer chasing,
4. fewer object dereferences.

### 37.2 Comparator Cost Bisa Dominan

Jika comparator melakukan operasi mahal:

```java
Comparator.comparing(user -> normalize(user.email()))
```

Maka setiap comparison bisa mahal.

Jangan lakukan normalization mahal di comparator hot path.

Lebih baik precompute normalized key.

### 37.3 Boxing Bisa Merusak Performa

`TreeMap<Integer, Long>` untuk counter besar bisa mahal:

1. `Integer` object jika di luar cache/autoboxing context,
2. `Long` boxing,
3. node allocation,
4. GC pressure.

Untuk dense integer domain, gunakan primitive array/Fenwick/segment tree.

### 37.4 Recursion Overhead

Recursive segment tree jelas dan cukup cepat untuk banyak kasus.

Namun jika hot path sangat ketat, iterative segment tree bisa lebih baik.

Ukur dengan benchmark, jangan tebak.

---

## 38. Design Checklist

Sebelum memilih tree structure, jawab:

```text
[ ] Apakah saya butuh ordering?
[ ] Apakah saya butuh nearest key seperti floor/ceiling?
[ ] Apakah saya butuh range query?
[ ] Apakah saya butuh aggregation?
[ ] Apakah aggregation punya neutral element?
[ ] Apakah aggregation associative?
[ ] Apakah saya butuh inverse operation?
[ ] Apakah update point atau range?
[ ] Apakah key dense integer?
[ ] Apakah data read-only atau mutable?
[ ] Apakah comparator benar dan stabil?
[ ] Apakah memory overhead node acceptable?
[ ] Apakah input size bisa menyebabkan recursion risk?
[ ] Apakah struktur terlalu kompleks untuk problem ini?
```

Khusus segment tree/Fenwick:

```text
[ ] Range convention sudah jelas: inclusive atau half-open?
[ ] Empty input ditangani?
[ ] Overflow dipertimbangkan?
[ ] Random test melawan brute force sudah ada?
[ ] Boundary test sudah ada?
[ ] Nama method tidak ambigu?
```

---

## 39. Ringkasan Mental Model

1. **BST** cepat jika tinggi tree rendah.
2. **BST naive** bisa menjadi linked list.
3. **Balanced tree** menjaga tinggi dengan rotation/rebalancing.
4. **Red-black tree** adalah balanced BST yang cocok untuk general ordered map/set.
5. **`TreeMap`/`TreeSet`** dipakai saat ordering adalah bagian dari requirement.
6. **Comparator** adalah bagian dari invariant struktur data.
7. **Sorted array** sering lebih cepat untuk read-mostly data.
8. **Segment tree** cocok untuk range aggregate dengan update.
9. **Lazy segment tree** cocok untuk range update + range query.
10. **Fenwick tree** cocok untuk prefix/range sum dengan point update.
11. **Prefix sum** lebih sederhana dan lebih cepat jika data immutable.
12. Di Java, array-backed numeric tree sering jauh lebih memory-efficient daripada node-based generic tree.

---

## 40. Latihan

### Latihan 1 — Effective-Date Rule Table

Buat `EffectiveRuleTable<R>` berbasis `NavigableMap<LocalDate, R>` dengan operasi:

```java
void put(LocalDate effectiveDate, R rule)
R findAt(LocalDate date)
List<R> findRulesBetween(LocalDate startInclusive, LocalDate endExclusive)
```

Pastikan:

1. date tidak null,
2. jika tidak ada rule sebelumnya, error jelas,
3. range boundary benar.

### Latihan 2 — Fenwick Tree Counter

Implementasikan counter per jam selama 30 hari:

```text
30 * 24 = 720 bucket
```

Operasi:

```java
recordEvent(day, hour)
countBetween(startBucket, endBucket)
```

### Latihan 3 — Segment Tree Minimum

Buat `LongMinSegmentTree` untuk:

```java
long min(int leftInclusive, int rightInclusive)
void update(int index, long newValue)
```

Gunakan `Long.MAX_VALUE` sebagai neutral element.

### Latihan 4 — Randomized Test

Bandingkan `LongMinSegmentTree` dengan brute force array untuk 10.000 operasi random.

### Latihan 5 — Comparator Bug Hunt

Buat `TreeSet<Person>` dengan comparator hanya berdasarkan `name`.

Masukkan dua person dengan nama sama tapi ID berbeda.

Jelaskan kenapa salah, lalu perbaiki dengan `thenComparing`.

---

## 41. Preview Part Berikutnya

Part berikutnya:

```text
learn-java-dsa-part-012 — Heap, PriorityQueue, Top-K, Scheduling
```

Kita akan membahas:

1. heap invariant,
2. min-heap dan max-heap,
3. `PriorityQueue`,
4. top-K,
5. k-way merge,
6. median dengan dua heap,
7. lazy deletion,
8. priority update problem,
9. scheduling dan retry queue,
10. failure mode ketika priority object dimutasi setelah masuk queue.

---

## 42. Referensi

1. Oracle Java Documentation — `TreeMap`: red-black tree based `NavigableMap`, sorted by natural ordering or comparator, with guaranteed `log(n)` cost for `containsKey`, `get`, `put`, and `remove`.
2. Oracle Java Documentation — `NavigableMap`: interface untuk navigasi ordered map seperti lower, floor, ceiling, higher, ascending/descending, sub-map views.
3. Oracle Java Documentation — `TreeSet`: sorted set implementation backed by tree map semantics.
4. OpenJDK source code — `java.util.TreeMap`: implementation detail red-black tree dalam JDK.
5. USACO Guide — Range Update Range Query: lazy segment tree concept for range update and range query in `O(log n)`.
6. Fenwick tree / Binary Indexed Tree literature: structure for efficient prefix sum and point update.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 010 — Trees I: Tree Fundamentals, Traversal, Recursion](./learn-java-dsa-part-010.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 012 — Heap, PriorityQueue, Top-K, Scheduling](./learn-java-dsa-part-012.md)
