# learn-java-dsa-part-023 — Disjoint Set, Indexing, Sparse vs Dense Data

> Seri: Java Data Structure and Algorithm Advanced  
> Bagian: 023 dari 030  
> Status seri: belum selesai  
> Fokus: representasi data berdasarkan kepadatan, mapping ID ke index, coordinate compression, Disjoint Set Union/Union-Find, dan sparse-vs-dense design dalam Java.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa banyak masalah DSA bukan dimulai dari algoritma, tetapi dari **cara memberi alamat pada data**.
2. Membedakan kapan data sebaiknya direpresentasikan sebagai:
   - dense array,
   - sparse map,
   - compressed index,
   - graph,
   - matrix,
   - set of relations.
3. Menggunakan **ID-to-index mapping** untuk mengubah domain object menjadi bentuk algoritmik yang efisien.
4. Memahami dan mengimplementasikan **Disjoint Set Union / Union-Find** di Java.
5. Menggunakan DSU untuk connected component, duplicate clustering, grouping, cycle detection pada undirected graph, dan entity linking.
6. Menilai trade-off antara `int[]`, `long[]`, `Object[]`, `HashMap<K, V>`, nested map, dan sparse matrix representation.
7. Menghindari bug produksi yang berasal dari salah memilih representasi data.

---

## 1. Core Mental Model: Banyak Masalah DSA Adalah Masalah Representasi

Sebelum memilih algoritma, engineer yang baik bertanya:

> “Data ini lebih natural direpresentasikan sebagai apa?”

Bukan langsung:

> “Pakai algoritma apa?”

Contoh:

```text
Case A depends on Case B.
Party X appears in Case A and Case C.
Postal code P maps to district D.
Rule R applies for score range 70..90.
Document D belongs to Application A.
Entity E1 and E2 ternyata duplicate.
```

Semua contoh di atas bisa terlihat seperti business data biasa. Tetapi secara DSA, mereka dapat berubah menjadi:

| Domain Statement | DSA Representation |
|---|---|
| Case depends on another case | directed graph |
| Party appears in many cases | bipartite graph / inverted index |
| Postal code maps to district | hash map / trie / range map |
| Rule applies for score range | interval structure / sorted map |
| Document belongs to application | map/list relation |
| Entity duplicates another entity | disjoint set / connected component |

Kesalahan umum engineer adalah terlalu cepat memakai object model domain langsung sebagai struktur algoritmik.

Misalnya:

```java
class CaseFile {
    String id;
    List<CaseFile> relatedCases;
}
```

Ini nyaman secara OO, tetapi tidak selalu nyaman untuk algoritma:

1. sulit deduplicate identity,
2. sulit serialize traversal state,
3. sulit benchmark,
4. banyak pointer chasing,
5. raw object graph bisa cyclic tanpa disadari,
6. equality bisa ambigu,
7. memory overhead tinggi,
8. traversal bisa lambat karena referensi tersebar di heap.

Untuk banyak algoritma, bentuk yang lebih kuat adalah:

```java
Map<String, Integer> idToIndex;
String[] indexToId;
int[][] adjacency;
int[] parent;
int[] rank;
boolean[] visited;
```

Ini bukan berarti kita meninggalkan domain model. Artinya kita membedakan:

1. **domain representation** untuk readability dan business semantics,
2. **algorithm representation** untuk correctness dan performance.

---

## 2. Dense vs Sparse: Pertanyaan Pertama Sebelum Memilih Struktur Data

### 2.1 Dense Data

Data disebut dense ketika key/index berada dalam range kecil dan hampir semua posisi terpakai.

Contoh:

```text
0..999_999 user index, hampir semua ada
0..23 hour of day
0..6 day of week
0..N-1 graph vertex setelah compression
```

Untuk dense data, array biasanya lebih baik:

```java
int[] countByHour = new int[24];
boolean[] visited = new boolean[n];
long[] scoreByIndex = new long[n];
```

Keunggulan:

1. akses cepat,
2. memory compact,
3. locality lebih baik,
4. tidak ada hashing,
5. tidak ada boxing,
6. tidak ada object node overhead.

Kelemahan:

1. butuh mapping ke index,
2. boros jika range besar tapi data sedikit,
3. resize tidak fleksibel,
4. sulit jika key bukan integer kecil.

### 2.2 Sparse Data

Data disebut sparse ketika range key besar, tetapi hanya sebagian kecil terpakai.

Contoh:

```text
User ID bisa sampai 10^12, tetapi aktif hanya 50_000
Postal code 000000..999999, tetapi valid hanya sebagian
Rule ID random UUID
Case ID string panjang
```

Untuk sparse data, map biasanya lebih cocok:

```java
Map<String, CaseFile> caseById = new HashMap<>();
Map<Long, Integer> countByUserId = new HashMap<>();
Map<String, List<String>> relatedByCaseId = new HashMap<>();
```

Keunggulan:

1. memory proporsional terhadap data aktif,
2. key natural bisa dipakai langsung,
3. flexible,
4. cocok untuk dynamic data.

Kelemahan:

1. overhead object tinggi,
2. hashing cost,
3. potential collision,
4. pointer chasing,
5. iteration order tidak guaranteed untuk `HashMap`,
6. lebih banyak allocation.

### 2.3 Rule of Thumb

Gunakan array jika:

1. key bisa dikonversi ke integer kecil,
2. jumlah element sudah diketahui atau bounded,
3. operation sangat sering,
4. memory locality penting,
5. primitive data cukup.

Gunakan map jika:

1. key sparse,
2. key natural berupa string/UUID/domain ID,
3. data dinamis,
4. jumlah element tidak mudah diprediksi,
5. readability lebih penting daripada raw throughput.

Gunakan compression jika:

1. key natural sparse,
2. algoritma internal butuh array,
3. dataset diproses batch/snapshot,
4. ada banyak operasi setelah mapping dibuat.

---

## 3. ID-to-Index Mapping

Banyak algoritma textbook memakai vertex `0..n-1`. Tetapi sistem nyata memakai ID seperti:

```text
CASE-2026-000123
APP-994882
NRIC-hash-abc...
rule:e7f1...
UUID
```

Agar bisa memakai array-based algorithm, kita buat mapping:

```text
external ID -> internal index
internal index -> external ID
```

### 3.1 Basic Implementation

```java
import java.util.*;

public final class Indexer<K> {
    private final Map<K, Integer> idToIndex = new HashMap<>();
    private final ArrayList<K> indexToId = new ArrayList<>();

    public int indexOf(K id) {
        Objects.requireNonNull(id, "id");
        Integer existing = idToIndex.get(id);
        if (existing != null) {
            return existing;
        }
        int next = indexToId.size();
        idToIndex.put(id, next);
        indexToId.add(id);
        return next;
    }

    public K idOf(int index) {
        return indexToId.get(index);
    }

    public int size() {
        return indexToId.size();
    }

    public boolean contains(K id) {
        return idToIndex.containsKey(id);
    }
}
```

### 3.2 Kenapa Tidak Langsung Pakai `computeIfAbsent`?

Bisa, tetapi hati-hati:

```java
public int indexOf(K id) {
    return idToIndex.computeIfAbsent(id, key -> {
        int next = indexToId.size();
        indexToId.add(key);
        return next;
    });
}
```

Ini ringkas, tetapi ada beberapa hal:

1. mapping function melakukan side effect ke `indexToId`,
2. jika dipakai dalam konteks concurrent tanpa proteksi, rusak,
3. jika mapping function throw exception, state bisa partial,
4. lebih sulit dibaca untuk engineer yang tidak familiar.

Untuk single-threaded batch indexing, masih acceptable. Untuk library/core component, versi eksplisit sering lebih mudah diaudit.

### 3.3 Stable Index vs Ephemeral Index

Ada dua jenis index:

#### Stable Index

Index harus konsisten antar waktu/proses.

Contoh:

```text
user type ADMIN selalu index 0
state SUBMITTED selalu index 2
```

Biasanya cocok untuk enum:

```java
enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Bisa pakai ordinal, tetapi hati-hati karena reorder enum dapat merusak persisted data.

Untuk persisted mapping, lebih aman pakai explicit code:

```java
enum CaseState {
    DRAFT(0),
    SUBMITTED(1),
    UNDER_REVIEW(2),
    APPROVED(3),
    REJECTED(4);

    private final int code;

    CaseState(int code) {
        this.code = code;
    }

    public int code() {
        return code;
    }
}
```

#### Ephemeral Index

Index hanya valid untuk satu proses/batch.

Contoh:

```text
case ID -> index hanya untuk menjalankan graph algorithm saat ini
```

Ini umum dalam:

1. graph traversal,
2. connected component,
3. duplicate clustering,
4. migration dependency analysis,
5. batch validation.

Ephemeral index tidak boleh disimpan ke database sebagai business ID.

---

## 4. Coordinate Compression

Coordinate compression adalah teknik mengubah nilai besar/sparse menjadi index kecil berdasarkan urutan unique value.

Contoh nilai asli:

```text
[1000000000, 500, 999999999, 500]
```

Unique sorted:

```text
[500, 999999999, 1000000000]
```

Compressed:

```text
500 -> 0
999999999 -> 1
1000000000 -> 2
```

Hasil array:

```text
[2, 0, 1, 0]
```

### 4.1 Kapan Compression Berguna?

Compression berguna ketika:

1. nilai asli besar,
2. jumlah unique kecil,
3. operation butuh array/tree indexed by position,
4. urutan relatif penting,
5. nilai asli tidak perlu dipakai dalam inner loop.

Contoh:

1. interval endpoint,
2. timestamp bucket,
3. score threshold,
4. sparse coordinate grid,
5. effective-date boundary,
6. user rank position.

### 4.2 Implementasi Compression di Java

```java
import java.util.*;

public final class CoordinateCompression {
    public static int[] compress(long[] values) {
        long[] sorted = values.clone();
        Arrays.sort(sorted);

        int uniqueCount = 0;
        for (long value : sorted) {
            if (uniqueCount == 0 || sorted[uniqueCount - 1] != value) {
                sorted[uniqueCount++] = value;
            }
        }

        long[] unique = Arrays.copyOf(sorted, uniqueCount);
        int[] result = new int[values.length];

        for (int i = 0; i < values.length; i++) {
            int index = Arrays.binarySearch(unique, values[i]);
            result[i] = index;
        }

        return result;
    }
}
```

Complexity:

```text
Sort: O(n log n)
Each binary search: O(log u)
Total: O(n log n + n log u)
Memory: O(n + u)
```

Jika banyak lookup setelah compression, buat map:

```java
Map<Long, Integer> compressedIndex = new HashMap<>((int) (unique.length / 0.75f) + 1);
for (int i = 0; i < unique.length; i++) {
    compressedIndex.put(unique[i], i);
}
```

Lalu lookup menjadi expected `O(1)`, dengan trade-off memory map.

### 4.3 Compression Tidak Sama Dengan Hashing

Compression menjaga hubungan urutan.

```text
if a < b, then compressed(a) < compressed(b)
```

Hashing tidak menjamin itu.

Karena itu compression cocok untuk:

1. sorted query,
2. Fenwick tree,
3. segment tree,
4. range query,
5. rank-based logic.

Hashing cocok untuk equality lookup.

---

## 5. Disjoint Set Union / Union-Find

DSU adalah struktur data untuk mengelola partisi elemen ke dalam beberapa kelompok yang tidak overlap.

Operasi inti:

```text
find(x)      -> cari representative/root group dari x
union(a, b)  -> gabungkan group a dan group b
connected(a, b) -> apakah a dan b berada di group yang sama?
```

Mental model:

```text
Awalnya:
{0}, {1}, {2}, {3}, {4}

union(0, 1):
{0, 1}, {2}, {3}, {4}

union(3, 4):
{0, 1}, {2}, {3, 4}

union(1, 4):
{0, 1, 3, 4}, {2}
```

DSU bukan graph traversal general-purpose. DSU menjawab pertanyaan connectivity untuk relasi undirected/equivalence yang sifatnya menggabungkan group.

---

## 6. DSU sebagai Forest

DSU biasanya direpresentasikan sebagai forest.

Setiap elemen punya parent:

```text
parent[x] = parent dari x
```

Root adalah elemen yang parent-nya dirinya sendiri:

```text
parent[root] == root
```

Contoh:

```text
0 -> 0
1 -> 0
2 -> 2
3 -> 0
4 -> 3
```

Artinya:

```text
0 adalah root dari group {0,1,3,4}
2 adalah root group sendiri
```

`find(4)` berjalan:

```text
4 -> 3 -> 0
```

Root = `0`.

---

## 7. DSU Naive

```java
public final class NaiveDisjointSet {
    private final int[] parent;

    public NaiveDisjointSet(int size) {
        if (size < 0) {
            throw new IllegalArgumentException("size must be non-negative");
        }
        this.parent = new int[size];
        for (int i = 0; i < size; i++) {
            parent[i] = i;
        }
    }

    public int find(int x) {
        checkIndex(x);
        while (parent[x] != x) {
            x = parent[x];
        }
        return x;
    }

    public boolean union(int a, int b) {
        int rootA = find(a);
        int rootB = find(b);
        if (rootA == rootB) {
            return false;
        }
        parent[rootB] = rootA;
        return true;
    }

    public boolean connected(int a, int b) {
        return find(a) == find(b);
    }

    private void checkIndex(int x) {
        if (x < 0 || x >= parent.length) {
            throw new IndexOutOfBoundsException("index=" + x + ", size=" + parent.length);
        }
    }
}
```

Masalah:

Jika union selalu membentuk chain panjang:

```text
0 <- 1 <- 2 <- 3 <- 4 <- ...
```

`find` bisa menjadi `O(n)`.

---

## 8. Optimization 1: Path Compression

Path compression membuat semua node di path langsung menunjuk ke root setelah `find`.

Sebelum:

```text
4 -> 3 -> 2 -> 1 -> 0
```

Setelah `find(4)`:

```text
4 -> 0
3 -> 0
2 -> 0
1 -> 0
```

Implementasi recursive:

```java
public int find(int x) {
    checkIndex(x);
    if (parent[x] != x) {
        parent[x] = find(parent[x]);
    }
    return parent[x];
}
```

Tetapi di Java, recursion bisa berisiko jika tree sangat dalam sebelum compression. Iterative version lebih defensif.

---

## 9. Path Compression Iterative yang Aman

```java
public int find(int x) {
    checkIndex(x);

    int root = x;
    while (parent[root] != root) {
        root = parent[root];
    }

    while (parent[x] != x) {
        int next = parent[x];
        parent[x] = root;
        x = next;
    }

    return root;
}
```

Keunggulan:

1. tidak memakai call stack,
2. aman untuk chain panjang,
3. path tetap terkompresi,
4. cocok untuk production-grade implementation.

---

## 10. Optimization 2: Union by Size / Rank

Agar tree tidak tinggi, gabungkan tree kecil ke tree besar.

Dengan `size[]`:

```java
if (size[rootA] < size[rootB]) swap(rootA, rootB);
parent[rootB] = rootA;
size[rootA] += size[rootB];
```

Dengan `rank[]`, rank kira-kira mewakili tinggi tree.

Untuk kebanyakan aplikasi engineering, `size[]` lebih informatif karena bisa dipakai untuk mengetahui ukuran component.

---

## 11. Production-Ready DSU dengan Size

```java
import java.util.Arrays;

public final class DisjointSetUnion {
    private final int[] parent;
    private final int[] size;
    private int components;

    public DisjointSetUnion(int elementCount) {
        if (elementCount < 0) {
            throw new IllegalArgumentException("elementCount must be non-negative");
        }
        this.parent = new int[elementCount];
        this.size = new int[elementCount];
        this.components = elementCount;

        for (int i = 0; i < elementCount; i++) {
            parent[i] = i;
            size[i] = 1;
        }
    }

    public int find(int x) {
        checkIndex(x);

        int root = x;
        while (parent[root] != root) {
            root = parent[root];
        }

        while (parent[x] != x) {
            int next = parent[x];
            parent[x] = root;
            x = next;
        }

        return root;
    }

    public boolean union(int a, int b) {
        int rootA = find(a);
        int rootB = find(b);

        if (rootA == rootB) {
            return false;
        }

        if (size[rootA] < size[rootB]) {
            int temp = rootA;
            rootA = rootB;
            rootB = temp;
        }

        parent[rootB] = rootA;
        size[rootA] += size[rootB];
        components--;
        return true;
    }

    public boolean connected(int a, int b) {
        return find(a) == find(b);
    }

    public int componentSize(int x) {
        return size[find(x)];
    }

    public int components() {
        return components;
    }

    public int elementCount() {
        return parent.length;
    }

    public int[] parentSnapshot() {
        return Arrays.copyOf(parent, parent.length);
    }

    private void checkIndex(int x) {
        if (x < 0 || x >= parent.length) {
            throw new IndexOutOfBoundsException("index=" + x + ", size=" + parent.length);
        }
    }
}
```

Complexity dengan path compression + union by size/rank:

```text
find: almost constant amortized
union: almost constant amortized
connected: almost constant amortized
space: O(n)
```

Secara teori, bound amortized klasiknya memakai inverse Ackermann function, yang tumbuh sangat lambat sehingga dalam praktik hampir konstan untuk ukuran input realistis.

---

## 12. DSU dengan Domain ID

Dalam sistem nyata, input jarang berupa integer `0..n-1`. Kita bisa menggabungkan `Indexer` + DSU.

### 12.1 Dynamic DSU untuk Key Arbitrary

```java
import java.util.*;

public final class KeyedDisjointSet<K> {
    private final Map<K, Integer> idToIndex = new HashMap<>();
    private final ArrayList<K> indexToId = new ArrayList<>();
    private final ArrayList<Integer> parent = new ArrayList<>();
    private final ArrayList<Integer> size = new ArrayList<>();
    private int components;

    public int add(K key) {
        Objects.requireNonNull(key, "key");
        Integer existing = idToIndex.get(key);
        if (existing != null) {
            return existing;
        }

        int index = indexToId.size();
        idToIndex.put(key, index);
        indexToId.add(key);
        parent.add(index);
        size.add(1);
        components++;
        return index;
    }

    public int findIndex(int x) {
        checkIndex(x);

        int root = x;
        while (!parent.get(root).equals(root)) {
            root = parent.get(root);
        }

        while (!parent.get(x).equals(x)) {
            int next = parent.get(x);
            parent.set(x, root);
            x = next;
        }

        return root;
    }

    public K find(K key) {
        int index = add(key);
        return indexToId.get(findIndex(index));
    }

    public boolean union(K a, K b) {
        int indexA = add(a);
        int indexB = add(b);

        int rootA = findIndex(indexA);
        int rootB = findIndex(indexB);

        if (rootA == rootB) {
            return false;
        }

        if (size.get(rootA) < size.get(rootB)) {
            int temp = rootA;
            rootA = rootB;
            rootB = temp;
        }

        parent.set(rootB, rootA);
        size.set(rootA, size.get(rootA) + size.get(rootB));
        components--;
        return true;
    }

    public boolean connected(K a, K b) {
        if (!idToIndex.containsKey(a) || !idToIndex.containsKey(b)) {
            return false;
        }
        return findIndex(idToIndex.get(a)) == findIndex(idToIndex.get(b));
    }

    public int components() {
        return components;
    }

    public Map<K, List<K>> groups() {
        Map<Integer, List<K>> byRoot = new HashMap<>();

        for (int i = 0; i < indexToId.size(); i++) {
            int root = findIndex(i);
            byRoot.computeIfAbsent(root, ignored -> new ArrayList<>()).add(indexToId.get(i));
        }

        Map<K, List<K>> result = new LinkedHashMap<>();
        for (Map.Entry<Integer, List<K>> entry : byRoot.entrySet()) {
            result.put(indexToId.get(entry.getKey()), List.copyOf(entry.getValue()));
        }
        return result;
    }

    private void checkIndex(int x) {
        if (x < 0 || x >= parent.size()) {
            throw new IndexOutOfBoundsException("index=" + x + ", size=" + parent.size());
        }
    }
}
```

### 12.2 Catatan Performance

Versi `ArrayList<Integer>` punya boxing overhead. Untuk workload besar, lebih baik dua-pass:

1. kumpulkan semua key,
2. map key ke int index,
3. buat `DisjointSetUnion` berbasis `int[]`,
4. proses union menggunakan index.

Versi dynamic keyed DSU nyaman untuk readability, tetapi bukan pilihan optimal untuk jutaan operasi.

---

## 13. Use Case 1: Duplicate Entity Clustering

Misalnya kita punya entity calon duplicate berdasarkan beberapa sinyal:

```text
same email
same phone
same normalized name + DOB
same external reference
same document fingerprint
```

Jika A duplicate B, dan B duplicate C, maka A, B, C berada dalam cluster yang sama walaupun A tidak dibandingkan langsung dengan C.

Ini adalah equivalence closure. DSU cocok.

### 13.1 Model

```java
record DuplicateEdge(String leftEntityId, String rightEntityId, String reason) {}
```

### 13.2 Clustering

```java
import java.util.*;

public final class DuplicateClusterer {
    public static Map<String, List<String>> cluster(List<DuplicateEdge> edges) {
        KeyedDisjointSet<String> dsu = new KeyedDisjointSet<>();

        for (DuplicateEdge edge : edges) {
            dsu.union(edge.leftEntityId(), edge.rightEntityId());
        }

        return dsu.groups();
    }
}
```

### 13.3 Why DSU Fits

DSU cocok karena:

1. duplicate relation bersifat undirected,
2. relation transitive dalam cluster,
3. kita butuh group akhir,
4. tidak perlu shortest path,
5. tidak perlu traversal lengkap setiap union.

### 13.4 Where DSU Is Not Enough

DSU tidak menyimpan alasan edge secara natural.

Jika auditor bertanya:

> “Kenapa entity A dan C dianggap satu cluster?”

DSU hanya bisa bilang mereka punya root yang sama. Untuk explainability, simpan juga graph edge:

```java
Map<String, List<DuplicateEdge>> evidenceGraph;
```

Pola production:

```text
DSU untuk fast grouping
Graph untuk explainability/path evidence
```

---

## 14. Use Case 2: Undirected Cycle Detection

Untuk undirected graph, DSU bisa mendeteksi cycle saat menambahkan edge.

Jika edge `(u, v)` ditambahkan dan `u` sudah connected dengan `v`, maka edge itu membentuk cycle.

```java
public static boolean hasCycle(int n, int[][] edges) {
    DisjointSetUnion dsu = new DisjointSetUnion(n);

    for (int[] edge : edges) {
        int u = edge[0];
        int v = edge[1];
        if (!dsu.union(u, v)) {
            return true;
        }
    }

    return false;
}
```

Catatan penting:

DSU cycle detection ini untuk **undirected graph**. Untuk directed graph, gunakan DFS color/state atau topological sort.

---

## 15. Use Case 3: Connected Component dalam Batch Relationship

Misalnya ada relasi antar party:

```text
P1 shares address with P2
P2 shares phone with P3
P4 shares email with P5
```

Cluster:

```text
{P1, P2, P3}
{P4, P5}
```

DSU bisa membangun component cepat.

Production use:

1. risk grouping,
2. household grouping,
3. account linking,
4. related-party analysis,
5. duplicate document family,
6. common ownership cluster.

---

## 16. Use Case 4: Kruskal Minimum Spanning Tree

DSU sering dipakai dalam Kruskal algorithm.

Mental model:

1. sort edge berdasarkan weight,
2. ambil edge termurah,
3. jika edge menghubungkan dua component berbeda, pilih edge,
4. jika edge membentuk cycle, skip,
5. selesai ketika edge terpilih `n - 1`.

```java
import java.util.*;

record WeightedEdge(int from, int to, long weight) {}

public final class Kruskal {
    public static List<WeightedEdge> minimumSpanningTree(int n, List<WeightedEdge> edges) {
        List<WeightedEdge> sorted = new ArrayList<>(edges);
        sorted.sort(Comparator.comparingLong(WeightedEdge::weight));

        DisjointSetUnion dsu = new DisjointSetUnion(n);
        List<WeightedEdge> result = new ArrayList<>();

        for (WeightedEdge edge : sorted) {
            if (dsu.union(edge.from(), edge.to())) {
                result.add(edge);
                if (result.size() == n - 1) {
                    break;
                }
            }
        }

        return result;
    }
}
```

Dalam sistem enterprise, MST tidak selalu muncul eksplisit. Tetapi mental model-nya berguna untuk memilih koneksi minimal antar group dengan cost terendah.

---

## 17. Sparse Matrix Thinking

Matrix dense:

```java
int[][] matrix = new int[n][m];
```

Cocok jika hampir semua cell terpakai.

Tetapi jika hanya sedikit cell berisi nilai, `int[][]` boros.

Contoh:

```text
1_000_000 users x 1_000_000 items
hanya 10_000_000 interactions
```

Dense matrix mustahil.

### 17.1 Sparse Matrix dengan Map of Map

```java
Map<Integer, Map<Integer, Long>> values = new HashMap<>();

public void put(int row, int col, long value) {
    values.computeIfAbsent(row, ignored -> new HashMap<>()).put(col, value);
}

public long get(int row, int col) {
    Map<Integer, Long> rowMap = values.get(row);
    if (rowMap == null) {
        return 0L;
    }
    return rowMap.getOrDefault(col, 0L);
}
```

Keunggulan:

1. mudah dipahami,
2. dynamic,
3. hanya menyimpan non-zero/non-empty value.

Kelemahan:

1. banyak object overhead,
2. boxing `Integer`/`Long`,
3. pointer chasing,
4. kurang baik untuk numeric heavy computation.

### 17.2 Sparse Matrix dengan Encoded Key

Untuk pasangan integer `(row, col)`, bisa encode ke `long`:

```java
static long key(int row, int col) {
    return ((long) row << 32) ^ (col & 0xffffffffL);
}
```

Lalu:

```java
Map<Long, Long> values = new HashMap<>();
```

Masih ada boxing jika pakai Java standard `HashMap<Long, Long>`, tetapi struktur lebih flat daripada nested map.

Untuk performance tinggi, primitive-specialized collection bisa dipertimbangkan, tetapi itu di luar Java standard library.

### 17.3 Sparse Representation Berdasarkan Access Pattern

Jika sering query by row:

```java
Map<Row, List<Cell>> byRow
```

Jika sering query by column:

```java
Map<Column, List<Cell>> byColumn
```

Jika sering query exact cell:

```java
Map<CellKey, Value>
```

Jika sering query range:

```java
SortedMap / interval tree / segment tree / database index
```

Tidak ada representation yang menang semua. Representation harus mengikuti operation.

---

## 18. Dense Graph vs Sparse Graph

Graph juga punya dense/sparse distinction.

### 18.1 Adjacency Matrix

```java
boolean[][] connected = new boolean[n][n];
```

Keunggulan:

1. check edge `O(1)`,
2. sederhana,
3. cocok untuk dense graph kecil.

Kelemahan:

1. memory `O(n²)`,
2. buruk untuk graph besar sparse,
3. traversal semua neighbor butuh scan `O(n)` per vertex.

### 18.2 Adjacency List

```java
List<Integer>[] graph = new ArrayList[n];
```

atau:

```java
Map<String, List<String>> graph = new HashMap<>();
```

Keunggulan:

1. memory `O(V + E)`,
2. cocok untuk sparse graph,
3. traversal neighbor efisien.

Kelemahan:

1. check edge bisa `O(degree)` jika list,
2. butuh `Set` jika frequent edge existence check,
3. more allocation.

### 18.3 Engineering Decision

Gunakan matrix jika:

1. `n` kecil,
2. graph dense,
3. edge existence check dominan,
4. memory acceptable.

Gunakan adjacency list jika:

1. graph sparse,
2. traversal dominan,
3. `n` besar,
4. edge count jauh lebih kecil dari `n²`.

Gunakan adjacency set jika:

1. traversal + edge existence check sama-sama penting,
2. duplicate edge harus dicegah.

---

## 19. Inverted Index: Sparse Mapping yang Sangat Praktis

Inverted index mengubah:

```text
entity -> attributes
```

menjadi:

```text
attribute -> entities
```

Contoh:

```text
Case C1 has party P1, P2
Case C2 has party P2, P3
```

Forward index:

```java
Map<String, List<String>> partiesByCase;
```

Inverted index:

```java
Map<String, List<String>> casesByParty;
```

### 19.1 Build Inverted Index

```java
import java.util.*;

public final class InvertedIndex {
    public static <K, V> Map<V, List<K>> invert(Map<K, ? extends Collection<V>> valuesByKey) {
        Map<V, List<K>> result = new HashMap<>();

        for (Map.Entry<K, ? extends Collection<V>> entry : valuesByKey.entrySet()) {
            K key = entry.getKey();
            for (V value : entry.getValue()) {
                result.computeIfAbsent(value, ignored -> new ArrayList<>()).add(key);
            }
        }

        return result;
    }
}
```

### 19.2 Use Case

Inverted index cocok untuk:

1. find all cases by party,
2. find all applications using rule,
3. find all documents with tag,
4. find all workflows containing state,
5. impact analysis.

### 19.3 Inverted Index + DSU

Untuk duplicate clustering:

```text
email -> list of entity IDs sharing email
phone -> list of entity IDs sharing phone
address fingerprint -> list of entity IDs sharing address
```

Setiap list dengan size > 1 bisa di-union.

```java
public static Map<String, List<String>> clusterBySharedAttributes(
        Map<String, List<String>> attributesByEntity
) {
    Map<String, List<String>> entitiesByAttribute = InvertedIndex.invert(attributesByEntity);
    KeyedDisjointSet<String> dsu = new KeyedDisjointSet<>();

    for (String entityId : attributesByEntity.keySet()) {
        dsu.add(entityId);
    }

    for (List<String> entities : entitiesByAttribute.values()) {
        if (entities.size() <= 1) {
            continue;
        }
        String first = entities.get(0);
        for (int i = 1; i < entities.size(); i++) {
            dsu.union(first, entities.get(i));
        }
    }

    return dsu.groups();
}
```

---

## 20. Choosing Representation by Operation Matrix

Sebelum memilih struktur data, tulis operation matrix.

Contoh domain: case relationship.

| Operation | Frequency | Required Cost | Candidate Structure |
|---|---:|---:|---|
| lookup case by ID | very high | O(1) expected | `HashMap<String, Case>` |
| list dependencies of case | high | O(out-degree) | adjacency list |
| check if case A depends on B | medium | O(1) expected | adjacency set |
| find all related cluster | batch | near O(E) | DSU |
| explain path A to B | occasional | BFS/DFS on graph | adjacency list |
| sort by deadline | high | O(log n) update | `TreeMap`/heap |
| range by date | high | O(log n + k) | `NavigableMap` |

DSU dapat menjawab “satu cluster atau tidak”, tetapi tidak menjawab “path-nya lewat edge mana” tanpa graph tambahan.

---

## 21. Common Failure Modes

### 21.1 Menggunakan Array untuk Sparse Key Besar

```java
boolean[] exists = new boolean[1_000_000_000];
```

Masalah:

1. memory boros,
2. range mungkin tidak bounded,
3. raw ID tidak selalu aman sebagai index,
4. input malicious bisa membuat allocation besar.

Solusi:

```java
Set<Integer> exists = new HashSet<>();
```

atau compression jika batch.

### 21.2 Menggunakan `HashMap<String, Integer>` di Hot Loop Besar Tanpa Compression

Jika operation jutaan kali dan key set fixed, hashing string terus-menerus mahal.

Solusi:

1. map string ke int sekali,
2. pakai `int[]`/`long[]` dalam inner loop,
3. convert balik ke ID di boundary.

### 21.3 Mengira DSU Bisa Remove Edge

DSU standard mendukung merge, tetapi tidak mudah mendukung delete/split.

Jika relasi bisa dihapus:

```text
union(A, B)
remove(A, B)
```

DSU tidak bisa otomatis memisahkan component karena mungkin masih ada path lain.

Solusi tergantung kebutuhan:

1. rebuild DSU batch,
2. dynamic connectivity structure,
3. maintain graph + recompute component,
4. use database query/index if domain size moderate.

### 21.4 Menggunakan DSU untuk Directed Dependency

DSU tidak preserve direction.

Jika:

```text
A -> B
B -> C
```

DSU hanya tahu A, B, C satu component. Ia kehilangan arah dependency.

Untuk directed dependency:

1. adjacency list,
2. topological sort,
3. DFS cycle detection,
4. strongly connected components.

### 21.5 Tidak Menyimpan Evidence Edge

Untuk grouping audit-sensitive, DSU result saja tidak cukup.

Bad:

```text
Entity A and C are grouped because root is 7.
```

Good:

```text
A grouped with B because same email.
B grouped with C because same phone.
Therefore A, B, C are in same connected duplicate cluster.
```

Simpan:

```java
record EvidenceEdge(String left, String right, String reason, double confidence) {}
```

### 21.6 Mengandalkan Iteration Order `HashMap`

Jika output cluster harus deterministic, jangan bergantung pada `HashMap` iteration order.

Gunakan:

1. sort output,
2. `LinkedHashMap` untuk insertion order,
3. `TreeMap` untuk sorted key,
4. deterministic representative selection.

---

## 22. Deterministic DSU Representative

Union by size membuat root bergantung pada urutan union. Kadang ini tidak masalah. Tetapi untuk audit/reporting, representative harus deterministic.

Misalnya root group harus ID terkecil secara lexicographic.

Pendekatan:

1. DSU internal tetap union by size untuk performance,
2. simpan metadata representative terpisah.

```java
import java.util.*;

public final class DeterministicCluster<K> {
    private final KeyedDisjointSet<K> dsu = new KeyedDisjointSet<>();
    private final Comparator<? super K> comparator;

    public DeterministicCluster(Comparator<? super K> comparator) {
        this.comparator = Objects.requireNonNull(comparator, "comparator");
    }

    public void add(K key) {
        dsu.add(key);
    }

    public void union(K a, K b) {
        dsu.union(a, b);
    }

    public Map<K, List<K>> deterministicGroups() {
        Map<K, List<K>> raw = dsu.groups();
        Map<K, List<K>> result = new TreeMap<>(comparator);

        for (List<K> members : raw.values()) {
            ArrayList<K> sortedMembers = new ArrayList<>(members);
            sortedMembers.sort(comparator);
            K canonical = sortedMembers.get(0);
            result.put(canonical, List.copyOf(sortedMembers));
        }

        return result;
    }
}
```

Catatan:

Representative internal DSU tidak harus sama dengan canonical representative output.

---

## 23. Designing for Auditability

Dalam regulatory/case-management system, grouping/relationship result harus bisa dijelaskan.

DSA output ideal:

```json
{
  "clusterId": "ENTITY-001",
  "members": ["ENTITY-001", "ENTITY-009", "ENTITY-112"],
  "canonicalMember": "ENTITY-001",
  "evidence": [
    {"left": "ENTITY-001", "right": "ENTITY-009", "reason": "same-email", "confidence": 0.98},
    {"left": "ENTITY-009", "right": "ENTITY-112", "reason": "same-phone", "confidence": 0.91}
  ]
}
```

DSU sendiri hanya struktur internal. Untuk sistem nyata, desain minimal:

1. DSU untuk grouping,
2. evidence graph untuk explainability,
3. deterministic canonical ID,
4. confidence score jika matching probabilistic,
5. versioned matching rules,
6. timestamp batch,
7. source dataset,
8. reproducible input order atau deterministic output sorting.

---

## 24. Testing Strategy

### 24.1 Unit Test Basic DSU

```java
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

final class DisjointSetUnionTest {
    @Test
    void unionShouldConnectElements() {
        DisjointSetUnion dsu = new DisjointSetUnion(5);

        assertFalse(dsu.connected(0, 1));
        assertTrue(dsu.union(0, 1));
        assertTrue(dsu.connected(0, 1));
        assertEquals(4, dsu.components());
    }

    @Test
    void unionSameComponentShouldReturnFalse() {
        DisjointSetUnion dsu = new DisjointSetUnion(3);

        assertTrue(dsu.union(0, 1));
        assertFalse(dsu.union(1, 0));
        assertEquals(2, dsu.components());
    }

    @Test
    void componentSizeShouldReflectMergedGroup() {
        DisjointSetUnion dsu = new DisjointSetUnion(4);

        dsu.union(0, 1);
        dsu.union(2, 3);
        dsu.union(1, 2);

        assertEquals(4, dsu.componentSize(0));
        assertEquals(1, dsu.components());
    }
}
```

### 24.2 Property-Like Tests

Invariants:

1. `find(x) == find(x)` always.
2. Jika `connected(a, b)` dan `connected(b, c)`, maka `connected(a, c)`.
3. `components` tidak pernah naik setelah union.
4. `componentSize(x) >= 1`.
5. Total size semua root component = n.

### 24.3 Compare Against Slow Model

Untuk test kecil, bandingkan DSU dengan slow set-of-sets implementation.

```java
// Untuk random union kecil, validasi hasil connected(a,b)
// DSU harus sama dengan model lambat yang mudah dibaca.
```

Ini sangat efektif untuk menangkap bug path compression/size update.

---

## 25. Performance Notes di Java

### 25.1 Prefer Primitive Arrays untuk Core DSU

```java
int[] parent;
int[] size;
```

Lebih baik daripada:

```java
Map<Integer, Integer> parent;
List<Integer> parent;
```

Karena:

1. no boxing,
2. fewer allocations,
3. better locality,
4. less GC pressure,
5. lower constant factor.

### 25.2 Jangan Over-Abstraction di Hot Path

Bad hot path:

```java
Map<String, Node> nodes;
Node parent;
```

Better:

```java
Map<String, Integer> idToIndex; // boundary
int[] parent;                  // hot path
```

### 25.3 Path Compression Mengubah Struktur Internal

`find` bukan read-only secara internal. Ia melakukan mutation untuk compression.

Implication:

1. DSU standard tidak thread-safe,
2. snapshot parent sebelum/after bisa berbeda,
3. concurrent find tanpa synchronization dapat race,
4. untuk parallel algorithm, butuh desain khusus.

### 25.4 Memory Estimation

Untuk `n` element:

```text
parent int[]: ~4n bytes + array overhead
size int[]:   ~4n bytes + array overhead
Total:        ~8n bytes + overhead
```

Untuk 10 juta element, raw arrays sekitar 80 MB plus overhead. Ini besar, tetapi masih jauh lebih compact daripada object-per-node representation.

---

## 26. Mini Capstone: Entity Linking Pipeline

### 26.1 Problem

Kita punya records:

```java
record EntityRecord(
        String entityId,
        String normalizedEmail,
        String normalizedPhone,
        String documentFingerprint
) {}
```

Goal:

1. group entity yang punya shared email/phone/document fingerprint,
2. output deterministic cluster,
3. simpan evidence reason.

### 26.2 Evidence Model

```java
record LinkEvidence(
        String leftEntityId,
        String rightEntityId,
        String reason
) {}
```

### 26.3 Build Attribute Index

```java
import java.util.*;

public final class EntityLinker {
    public static Result link(List<EntityRecord> records) {
        Map<String, List<String>> entitiesByAttribute = new HashMap<>();

        for (EntityRecord record : records) {
            addAttribute(entitiesByAttribute, "email:" + record.normalizedEmail(), record.entityId());
            addAttribute(entitiesByAttribute, "phone:" + record.normalizedPhone(), record.entityId());
            addAttribute(entitiesByAttribute, "doc:" + record.documentFingerprint(), record.entityId());
        }

        KeyedDisjointSet<String> dsu = new KeyedDisjointSet<>();
        for (EntityRecord record : records) {
            dsu.add(record.entityId());
        }

        List<LinkEvidence> evidence = new ArrayList<>();

        for (Map.Entry<String, List<String>> entry : entitiesByAttribute.entrySet()) {
            List<String> entities = entry.getValue();
            if (entities.size() <= 1) {
                continue;
            }

            String first = entities.get(0);
            for (int i = 1; i < entities.size(); i++) {
                String other = entities.get(i);
                dsu.union(first, other);
                evidence.add(new LinkEvidence(first, other, entry.getKey()));
            }
        }

        Map<String, List<String>> groups = canonicalize(dsu.groups());
        return new Result(groups, List.copyOf(evidence));
    }

    private static void addAttribute(Map<String, List<String>> index, String attribute, String entityId) {
        if (attribute.endsWith("null")) {
            return;
        }
        index.computeIfAbsent(attribute, ignored -> new ArrayList<>()).add(entityId);
    }

    private static Map<String, List<String>> canonicalize(Map<String, List<String>> rawGroups) {
        Map<String, List<String>> result = new TreeMap<>();

        for (List<String> group : rawGroups.values()) {
            ArrayList<String> sorted = new ArrayList<>(group);
            Collections.sort(sorted);
            result.put(sorted.get(0), List.copyOf(sorted));
        }

        return result;
    }

    public record Result(
            Map<String, List<String>> clusters,
            List<LinkEvidence> evidence
    ) {}
}
```

### 26.4 Important Production Corrections

Kode di atas adalah teaching version. Untuk production:

1. jangan pakai string concatenation raw untuk attribute key jika value bisa mengandung separator ambiguity,
2. normalisasi harus versioned,
3. null/blank handling harus eksplisit,
4. high-cardinality attribute harus dibatasi,
5. suspicious common attribute seperti shared dummy email harus difilter,
6. evidence harus diarahkan ke pair yang explainable,
7. cluster besar perlu review threshold,
8. deterministic sorting wajib untuk reproducibility,
9. simpan rule version dan batch ID.

---

## 27. Checklist Pemilihan Struktur

Saat menghadapi problem relationship/indexing, tanyakan:

1. Apakah key dense atau sparse?
2. Apakah key bisa dikompresi ke integer?
3. Apakah ordering key penting?
4. Apakah relation directed atau undirected?
5. Apakah relation transitive?
6. Apakah perlu delete/split relation?
7. Apakah perlu explain path/evidence?
8. Apakah output harus deterministic?
9. Apakah operation dominan lookup, traversal, grouping, range query, atau update?
10. Apakah dataset batch/snapshot atau online/dynamic?
11. Apakah memory budget mengizinkan object-heavy representation?
12. Apakah hot path bisa memakai primitive array?
13. Apakah structure perlu thread-safe?
14. Apakah result perlu diaudit?

---

## 28. Summary

Di bagian ini kita membangun fondasi penting:

1. Banyak masalah DSA sebenarnya dimulai dari **representasi data**.
2. Dense data cocok dengan array; sparse data cocok dengan map; batch sparse ordered data sering cocok dengan coordinate compression.
3. ID-to-index mapping adalah teknik bridge antara domain ID dan algoritma array-based.
4. DSU/Union-Find efisien untuk partitioning, connected component, duplicate clustering, dan undirected cycle detection.
5. DSU standard tidak cocok untuk directed dependency, delete/split relation, atau explainability tanpa struktur tambahan.
6. Sparse matrix, inverted index, adjacency list, dan DSU adalah keluarga representasi yang sering muncul dalam sistem nyata.
7. Untuk sistem regulatory/case-management, output algoritmik harus deterministic dan explainable.

---

## 29. What Comes Next

Bagian berikutnya:

```text
learn-java-dsa-part-024.md
```

Judul:

```text
Caching Data Structures: LRU, LFU, TTL, Windowed Cache
```

Fokus berikutnya:

1. cache sebagai struktur data + policy,
2. LRU dengan hash map + doubly linked list,
3. `LinkedHashMap` access-order,
4. TTL cache,
5. LFU,
6. expiration strategy,
7. negative caching,
8. cache stampede,
9. in-flight deduplication,
10. production cache design.

Status seri setelah bagian ini: **belum selesai**. Kita sudah menyelesaikan **Part 023 dari 030**.
