# learn-java-dsa-part-010 — Trees I: Tree Fundamentals, Traversal, Recursion

> Seri: Java Data Structure and Algorithm Advanced  
> Bagian: 010 dari 030  
> Status seri: belum selesai  
> Fokus: tree sebagai model hierarki, traversal, invariant, recursion, dan failure mode ketika struktur yang dianggap tree ternyata bukan tree.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan tidak hanya bisa menulis traversal tree, tetapi mampu melihat tree sebagai **struktur invariant** yang dipakai untuk memodelkan hierarki, ownership, containment, approval chain, menu, permission, workflow decomposition, parse structure, dependency, dan state expansion.

Target pemahaman:

1. Mampu membedakan tree, forest, DAG, dan graph cyclic.
2. Mampu menjelaskan kenapa suatu struktur disebut tree berdasarkan invariant, bukan berdasarkan bentuk class `Node` saja.
3. Mampu memilih traversal yang sesuai dengan kebutuhan domain.
4. Mampu mengubah traversal recursive menjadi iterative untuk menghindari stack overflow.
5. Mampu mendeteksi bug umum pada tree: cycle, orphan, duplicate parent, inconsistent depth, dan accidental DAG.
6. Mampu mendesain API tree yang aman dari mutability leak.
7. Mampu memahami trade-off node object model vs ID/index-based model di Java.
8. Mampu mengaitkan tree dengan problem production seperti menu rendering, permission inheritance, organization hierarchy, category tree, state transition exploration, dan document section parsing.

---

## 1. Mental Model: Tree Bukan Sekadar Node yang Punya Children

Banyak engineer memulai tree dengan class seperti ini:

```java
class Node {
    String value;
    List<Node> children;
}
```

Secara bentuk, itu terlihat seperti tree. Tetapi secara invariant, belum tentu.

Sebuah struktur disebut tree jika memenuhi beberapa syarat penting:

1. Ada satu root untuk sebuah tree.
2. Setiap node selain root memiliki tepat satu parent.
3. Tidak ada cycle.
4. Dari root, setiap node reachable tepat satu kali melalui satu path unik.
5. Jumlah edge untuk `n` node adalah `n - 1` pada connected tree.

Jika salah satu invariant ini rusak, struktur itu bukan tree lagi.

Contoh pelanggaran:

```text
A
├── B
│   └── D
└── C
    └── D
```

Node `D` punya dua parent: `B` dan `C`. Ini bukan tree, tetapi DAG.

Contoh lain:

```text
A -> B -> C -> A
```

Ini bukan tree, tetapi graph cyclic.

Dalam sistem produksi, bug seperti ini sering muncul ketika data berasal dari database:

```text
id | parent_id | name
---|-----------|------
1  | null      | Root
2  | 1         | Case
3  | 2         | Appeal
1  | 3         | Root
```

Secara row terlihat biasa, tetapi parent relation membentuk cycle. Kalau kode traversal recursive naif memproses ini, sistem bisa masuk infinite recursion sampai `StackOverflowError`.

Oracle mendefinisikan `StackOverflowError` sebagai error yang terjadi ketika aplikasi melakukan recursion terlalu dalam. Dalam konteks tree, ini biasanya terjadi karena depth terlalu besar atau karena struktur data yang dianggap tree ternyata cyclic.

---

## 2. Tree sebagai Invariant, Bukan Representasi

Representasi tree bisa bermacam-macam:

### 2.1 Object references

```java
record TreeNode<T>(T value, List<TreeNode<T>> children) {}
```

Kelebihan:

- Natural untuk domain object.
- Mudah dibaca.
- Cocok untuk struktur kecil/sedang.
- Traversal straightforward.

Kekurangan:

- Banyak object allocation.
- Pointer chasing.
- Sulit melakukan validasi global.
- Risiko cycle kalau mutable reference bocor.
- Sulit diserialisasi tanpa kontrol identity.

### 2.2 Parent pointer table

```java
record Row(long id, Long parentId, String name) {}
```

Kelebihan:

- Natural untuk database.
- Mudah melakukan query by parent.
- Mudah menyimpan forest.
- ID stable.

Kekurangan:

- Perlu build adjacency map untuk traversal efisien.
- Bisa mengandung orphan/cycle/duplicate parent kalau tidak divalidasi.
- Root bisa lebih dari satu.

### 2.3 Adjacency map

```java
Map<Long, List<Long>> childrenByParent = new HashMap<>();
```

Kelebihan:

- Bagus untuk traversal by ID.
- Cocok untuk large data.
- Bisa menghindari object graph besar.
- Mudah dikombinasikan dengan metadata map.

Kekurangan:

- Tidak self-explanatory tanpa metadata.
- Butuh invariant validation.
- Bisa menjadi graph jika satu child muncul di lebih dari satu list.

### 2.4 Array-indexed tree

```java
int[] parent = {-1, 0, 0, 1, 1, 2};
List<Integer>[] children;
```

Kelebihan:

- Sangat efisien untuk data dense.
- Lebih cache-friendly daripada object node.
- Cocok untuk algorithm-heavy workload.

Kekurangan:

- Kurang ekspresif untuk domain.
- Perlu mapping ID ke index.
- Error lebih mudah terjadi jika index tidak dijaga.

Kesimpulan penting:

> Tree bukan bentuk class. Tree adalah kumpulan invariant pada relasi antar node.

---

## 3. Terminologi Tree yang Harus Dikuasai

Misalkan struktur berikut:

```text
A
├── B
│   ├── D
│   └── E
└── C
    └── F
```

Terminologi:

| Istilah | Makna |
|---|---|
| Root | Node paling atas, tidak punya parent. Di contoh: `A`. |
| Parent | Node yang langsung menaungi node lain. Parent `D` adalah `B`. |
| Child | Node turunan langsung. Child `A` adalah `B` dan `C`. |
| Sibling | Node dengan parent yang sama. `B` dan `C` sibling. `D` dan `E` sibling. |
| Leaf | Node tanpa child. `D`, `E`, `F`. |
| Internal node | Node yang punya minimal satu child. `A`, `B`, `C`. |
| Ancestor | Parent, parent dari parent, dan seterusnya. Ancestor `E`: `B`, `A`. |
| Descendant | Child, child dari child, dan seterusnya. Descendant `A`: semua node lain. |
| Depth | Jarak dari root ke node. Depth `A` = 0, `B` = 1, `D` = 2. |
| Height node | Panjang path terpanjang dari node ke leaf. Height `B` = 1. |
| Height tree | Height root. Pada contoh = 2. |
| Subtree | Tree yang berakar pada suatu node. Subtree `B`: `B`, `D`, `E`. |
| Degree | Jumlah child. Degree `A` = 2, `C` = 1. |

Catatan penting:

- Ada definisi height yang menghitung jumlah node, bukan jumlah edge.
- Dalam engineering, pilih satu definisi dan dokumentasikan.
- Untuk algoritma, biasanya depth root = 0 dan height leaf = 0 lebih mudah.

---

## 4. Jenis-Jenis Tree

### 4.1 General tree / N-ary tree

Setiap node bisa memiliki jumlah child berapa pun.

Contoh:

- menu aplikasi,
- folder hierarchy,
- organization chart,
- category tree,
- permission inheritance,
- document outline.

Representasi:

```java
final class NaryNode<T> {
    private final T value;
    private final List<NaryNode<T>> children;

    NaryNode(T value, List<NaryNode<T>> children) {
        this.value = Objects.requireNonNull(value);
        this.children = List.copyOf(children);
    }

    T value() {
        return value;
    }

    List<NaryNode<T>> children() {
        return children;
    }
}
```

Kenapa `List.copyOf`?

Karena kalau constructor menyimpan list mutable dari luar, caller bisa mengubah struktur internal setelah node dibuat.

Buruk:

```java
List<NaryNode<String>> children = new ArrayList<>();
NaryNode<String> root = new NaryNode<>("root", children);
children.add(root); // bisa membuat cycle jika tidak defensive copy
```

Lebih aman:

```java
this.children = List.copyOf(children);
```

Tetapi ingat: ini hanya copy list container, bukan deep copy setiap child.

### 4.2 Binary tree

Setiap node punya maksimal dua child: left dan right.

```java
record BinaryNode<T>(T value, BinaryNode<T> left, BinaryNode<T> right) {}
```

Binary tree belum tentu binary search tree.

Binary tree hanya bicara bentuk. Binary search tree bicara invariant ordering.

### 4.3 Binary search tree

Invariant:

```text
semua node di left subtree < current
semua node di right subtree > current
```

Atau variasi dengan duplicate policy tertentu.

Ini akan dibahas lebih dalam pada Part 011. Pada Part 010, fokus kita masih traversal dan struktur tree umum.

### 4.4 Forest

Forest adalah kumpulan tree.

Contoh database hierarchy sering menghasilkan forest:

```text
Root A
├── B
└── C

Root X
└── Y
```

Jika sistem mengharapkan satu root tetapi data punya banyak root, itu bukan sekadar variasi bentuk. Itu perubahan invariant.

---

## 5. Tree Operation Dasar

Operasi umum pada tree:

1. Traverse semua node.
2. Find node by predicate.
3. Hitung size subtree.
4. Hitung height/depth.
5. Ambil path root-to-node.
6. Ambil ancestor chain.
7. Ambil descendant set.
8. Filter subtree.
9. Transform tree.
10. Validate invariant.
11. Serialize/deserialize.
12. Compare dua tree.
13. Detect cycle/orphan.

Biaya operasi bergantung pada representasi.

| Operation | Object tree | Parent table | Adjacency map |
|---|---:|---:|---:|
| Traverse subtree | `O(k)` | mahal tanpa index | `O(k)` |
| Find by ID | `O(n)` tanpa map | `O(1)` jika map by ID | `O(1)` jika metadata map |
| Get parent | mahal tanpa parent pointer | `O(1)` | butuh parent map |
| Get children | langsung | butuh scan `O(n)` tanpa index | `O(1)` average |
| Validate cycle | perlu visited | perlu graph validation | perlu graph validation |

`k` adalah jumlah node pada subtree yang dikunjungi.

---

## 6. Traversal: Cara Membaca Tree

Traversal adalah urutan mengunjungi node.

Traversal bukan cuma implementasi teknis. Dalam domain, traversal menentukan urutan efek.

Misalnya:

- Render menu: parent sebelum children.
- Delete folder: children sebelum parent.
- Evaluate inherited permission: ancestor sebelum descendant.
- Aggregate child result ke parent: children sebelum parent.
- BFS approval level: node per level.

Empat traversal utama:

1. Preorder.
2. Postorder.
3. Inorder.
4. Level-order.

---

## 7. Preorder Traversal

Urutan:

```text
visit node
visit children left-to-right
```

Untuk tree:

```text
A
├── B
│   ├── D
│   └── E
└── C
    └── F
```

Preorder:

```text
A, B, D, E, C, F
```

### 7.1 Kapan preorder dipakai?

Preorder cocok ketika parent harus diproses sebelum children.

Contoh:

1. Render nested menu.
2. Serialize tree dengan marker struktur.
3. Copy tree.
4. Validate inherited context.
5. Apply policy dari parent ke child.
6. Build breadcrumb context.
7. Propagate effective configuration.

### 7.2 Recursive preorder

```java
static <T> void preorder(NaryNode<T> node, Consumer<T> visitor) {
    visitor.accept(node.value());
    for (NaryNode<T> child : node.children()) {
        preorder(child, visitor);
    }
}
```

Kelebihan:

- Singkat.
- Mudah dibaca.
- Natural sesuai definisi tree.

Kekurangan:

- Tidak aman untuk tree sangat dalam.
- Jika ada cycle, infinite recursion.
- Tidak mudah dihentikan jika API tidak dirancang untuk return status.

### 7.3 Preorder dengan early stop

```java
static <T> boolean preorderUntil(NaryNode<T> node, Predicate<T> predicate) {
    if (predicate.test(node.value())) {
        return true;
    }
    for (NaryNode<T> child : node.children()) {
        if (preorderUntil(child, predicate)) {
            return true;
        }
    }
    return false;
}
```

Pattern ini penting untuk search.

---

## 8. Postorder Traversal

Urutan:

```text
visit children
visit node
```

Untuk contoh yang sama:

```text
D, E, B, F, C, A
```

### 8.1 Kapan postorder dipakai?

Postorder cocok ketika parent membutuhkan hasil dari children.

Contoh:

1. Menghitung size subtree.
2. Menghapus tree/folder dari leaf dulu.
3. Aggregating validation result dari child ke parent.
4. Computing total cost pada BOM/component tree.
5. Evaluating expression tree.
6. Merapikan resource dari bawah ke atas.

### 8.2 Recursive postorder

```java
static <T> void postorder(NaryNode<T> node, Consumer<T> visitor) {
    for (NaryNode<T> child : node.children()) {
        postorder(child, visitor);
    }
    visitor.accept(node.value());
}
```

### 8.3 Menghitung ukuran subtree

```java
static <T> int size(NaryNode<T> node) {
    int total = 1;
    for (NaryNode<T> child : node.children()) {
        total += size(child);
    }
    return total;
}
```

Inilah bentuk postorder computation: children dihitung dulu, lalu parent menjumlahkan.

### 8.4 Menghitung height

```java
static <T> int height(NaryNode<T> node) {
    int maxChildHeight = -1;
    for (NaryNode<T> child : node.children()) {
        maxChildHeight = Math.max(maxChildHeight, height(child));
    }
    return maxChildHeight + 1;
}
```

Dengan definisi ini:

- leaf height = 0,
- empty child height = -1,
- root height = max path edge count ke leaf.

---

## 9. Inorder Traversal

Inorder terutama relevan untuk binary tree.

Urutan:

```text
left subtree
visit node
right subtree
```

Contoh binary tree:

```text
      4
     / \
    2   6
   / \ / \
  1  3 5  7
```

Inorder:

```text
1, 2, 3, 4, 5, 6, 7
```

Jika tree adalah binary search tree yang valid, inorder menghasilkan urutan sorted.

### 9.1 Recursive inorder

```java
static <T> void inorder(BinaryNode<T> node, Consumer<T> visitor) {
    if (node == null) {
        return;
    }
    inorder(node.left(), visitor);
    visitor.accept(node.value());
    inorder(node.right(), visitor);
}
```

### 9.2 Kapan inorder dipakai?

1. Membaca BST secara sorted.
2. Validasi BST.
3. Expression tree tertentu.
4. Range traversal pada ordered tree.

Untuk general N-ary tree, “inorder” tidak punya definisi universal karena jumlah children bisa lebih dari dua.

---

## 10. Level-Order Traversal / Breadth-First Traversal

Level-order mengunjungi node per level dari root.

Untuk tree:

```text
A
├── B
│   ├── D
│   └── E
└── C
    └── F
```

Level-order:

```text
A, B, C, D, E, F
```

### 10.1 Kapan level-order dipakai?

1. Memproses hierarchy level by level.
2. Mencari node terdekat dari root.
3. Menghitung minimum depth.
4. Menampilkan organization chart per level.
5. Processing escalation breadth-wise.
6. Validasi depth limit.
7. Queue-based workflow expansion.

### 10.2 Implementasi dengan `ArrayDeque`

```java
static <T> void levelOrder(NaryNode<T> root, Consumer<T> visitor) {
    ArrayDeque<NaryNode<T>> queue = new ArrayDeque<>();
    queue.addLast(root);

    while (!queue.isEmpty()) {
        NaryNode<T> current = queue.removeFirst();
        visitor.accept(current.value());

        for (NaryNode<T> child : current.children()) {
            queue.addLast(child);
        }
    }
}
```

Kenapa `ArrayDeque`?

`ArrayDeque` adalah implementasi deque berbasis resizable array pada Java standard library. Untuk stack/queue single-threaded, `ArrayDeque` sering menjadi pilihan default yang lebih modern daripada `Stack` lama, karena bisa dipakai sebagai stack maupun queue tanpa overhead legacy synchronization.

---

## 11. Recursive vs Iterative Traversal

Recursive traversal mudah dibaca, tetapi tidak selalu aman.

### 11.1 Risiko recursive traversal

Recursive traversal menggunakan call stack.

Untuk tree seimbang:

```text
height = O(log n)
```

Risiko stack kecil.

Untuk tree yang sangat miring:

```text
A
└── B
    └── C
        └── D
            └── E
                └── ...
```

Height bisa `O(n)`. Jika `n` sangat besar, recursion dapat menyebabkan `StackOverflowError`.

### 11.2 Java tidak menjamin tail-call optimization

Jangan mengandalkan compiler/JVM untuk menghilangkan frame recursion secara umum. Untuk tree traversal production pada input tidak terpercaya, gunakan iterative traversal dengan explicit stack/queue atau terapkan depth limit.

### 11.3 Iterative preorder

```java
static <T> void preorderIterative(NaryNode<T> root, Consumer<T> visitor) {
    ArrayDeque<NaryNode<T>> stack = new ArrayDeque<>();
    stack.push(root);

    while (!stack.isEmpty()) {
        NaryNode<T> current = stack.pop();
        visitor.accept(current.value());

        List<NaryNode<T>> children = current.children();
        for (int i = children.size() - 1; i >= 0; i--) {
            stack.push(children.get(i));
        }
    }
}
```

Kenapa children dimasukkan dari kanan ke kiri?

Karena stack LIFO. Agar child kiri diproses lebih dulu, child kanan harus dipush lebih dulu.

### 11.4 Iterative postorder

Postorder iterative lebih tricky karena parent harus diproses setelah children.

Pendekatan dua stack:

```java
static <T> void postorderIterative(NaryNode<T> root, Consumer<T> visitor) {
    ArrayDeque<NaryNode<T>> stack = new ArrayDeque<>();
    ArrayDeque<NaryNode<T>> output = new ArrayDeque<>();

    stack.push(root);
    while (!stack.isEmpty()) {
        NaryNode<T> current = stack.pop();
        output.push(current);

        for (NaryNode<T> child : current.children()) {
            stack.push(child);
        }
    }

    while (!output.isEmpty()) {
        visitor.accept(output.pop().value());
    }
}
```

Trade-off:

- Mudah dipahami.
- Butuh memory tambahan `O(n)`.

Pendekatan satu stack bisa dibuat, tetapi lebih kompleks karena perlu state apakah node sudah diekspansi.

### 11.5 Iterative traversal dengan frame eksplisit

```java
record Frame<T>(NaryNode<T> node, boolean expanded) {}

static <T> void postorderWithFrame(NaryNode<T> root, Consumer<T> visitor) {
    ArrayDeque<Frame<T>> stack = new ArrayDeque<>();
    stack.push(new Frame<>(root, false));

    while (!stack.isEmpty()) {
        Frame<T> frame = stack.pop();
        NaryNode<T> node = frame.node();

        if (frame.expanded()) {
            visitor.accept(node.value());
            continue;
        }

        stack.push(new Frame<>(node, true));
        List<NaryNode<T>> children = node.children();
        for (int i = children.size() - 1; i >= 0; i--) {
            stack.push(new Frame<>(children.get(i), false));
        }
    }
}
```

Mental model:

- Recursive call stack diganti menjadi stack data structure.
- Local variable recursion diganti menjadi `Frame`.
- Ini lebih eksplisit dan lebih aman untuk depth besar.

---

## 12. Complexity Traversal

Untuk tree dengan `n` node dan `e` edge:

Pada tree valid:

```text
e = n - 1
```

Traversal yang mengunjungi semua node:

```text
Time: O(n)
Space recursive: O(h)
Space iterative DFS: O(h) sampai O(n), tergantung bentuk tree
Space BFS: O(w), width maksimum tree
```

Dengan:

- `h` = height tree,
- `w` = maksimum jumlah node dalam satu level.

### 12.1 Space DFS vs BFS

Tree sangat deep tetapi narrow:

```text
DFS stack besar: O(n)
BFS queue kecil: O(1) atau kecil
```

Tree sangat wide:

```text
DFS stack relatif kecil
BFS queue bisa sangat besar
```

Contoh wide tree:

```text
Root punya 1.000.000 child
```

BFS queue bisa menahan hampir semua child sekaligus.

Ini penting untuk sistem yang membaca hierarchy besar dari DB/API.

---

## 13. Building Tree dari Flat Rows

Dalam aplikasi enterprise, tree sering tidak datang sebagai object nested, tetapi sebagai flat rows.

Contoh:

```java
record CategoryRow(long id, Long parentId, String name) {}
```

Input:

```text
1 null Root
2 1    Application
3 1    Case
4 2    New Application
5 2    Renewal
```

Target:

```text
Root
├── Application
│   ├── New Application
│   └── Renewal
└── Case
```

### 13.1 Naive approach yang buruk

```java
for (CategoryRow parent : rows) {
    for (CategoryRow child : rows) {
        if (Objects.equals(child.parentId(), parent.id())) {
            // attach child
        }
    }
}
```

Complexity:

```text
O(n²)
```

Untuk `n = 10_000`, ini bisa menjadi 100 juta comparison.

### 13.2 Build dengan index

```java
static Map<Long, List<CategoryRow>> groupByParent(List<CategoryRow> rows) {
    Map<Long, List<CategoryRow>> childrenByParent = new HashMap<>();

    for (CategoryRow row : rows) {
        childrenByParent
            .computeIfAbsent(row.parentId(), ignored -> new ArrayList<>())
            .add(row);
    }

    return childrenByParent;
}
```

Lalu build dari root:

```java
record CategoryNode(long id, String name, List<CategoryNode> children) {}

static List<CategoryNode> buildForest(List<CategoryRow> rows) {
    Map<Long, List<CategoryRow>> childrenByParent = groupByParent(rows);
    List<CategoryRow> roots = childrenByParent.getOrDefault(null, List.of());

    List<CategoryNode> result = new ArrayList<>(roots.size());
    for (CategoryRow root : roots) {
        result.add(buildNode(root, childrenByParent));
    }
    return List.copyOf(result);
}

static CategoryNode buildNode(
        CategoryRow row,
        Map<Long, List<CategoryRow>> childrenByParent
) {
    List<CategoryRow> childRows = childrenByParent.getOrDefault(row.id(), List.of());
    List<CategoryNode> children = new ArrayList<>(childRows.size());

    for (CategoryRow child : childRows) {
        children.add(buildNode(child, childrenByParent));
    }

    return new CategoryNode(row.id(), row.name(), List.copyOf(children));
}
```

Complexity ideal:

```text
O(n)
```

Tetapi kode ini masih punya risiko:

1. Tidak mendeteksi cycle.
2. Tidak mendeteksi orphan.
3. Tidak mendeteksi duplicate ID.
4. Bisa stack overflow jika depth terlalu dalam.
5. Tidak menjamin single root.

Untuk production, build tree harus disertai validation.

---

## 14. Validasi Tree dari Flat Data

Flat data harus divalidasi sebelum dianggap tree.

Invariant yang perlu dicek:

1. ID unik.
2. Parent ID, jika tidak null, harus ada.
3. Root count sesuai ekspektasi.
4. Tidak ada cycle.
5. Semua node reachable dari root jika expected single connected tree.
6. Setiap node hanya punya satu parent.

Pada model row dengan satu `parentId`, duplicate parent secara field tidak mungkin untuk satu row. Tetapi duplicate `id` bisa membuat dua parent terlihat valid padahal identity rusak.

### 14.1 Duplicate ID check

```java
static void validateUniqueIds(List<CategoryRow> rows) {
    Set<Long> ids = new HashSet<>();
    for (CategoryRow row : rows) {
        if (!ids.add(row.id())) {
            throw new IllegalArgumentException("Duplicate id: " + row.id());
        }
    }
}
```

### 14.2 Orphan check

```java
static void validateNoOrphans(List<CategoryRow> rows) {
    Set<Long> ids = new HashSet<>();
    for (CategoryRow row : rows) {
        ids.add(row.id());
    }

    for (CategoryRow row : rows) {
        Long parentId = row.parentId();
        if (parentId != null && !ids.contains(parentId)) {
            throw new IllegalArgumentException(
                "Orphan node id=" + row.id() + ", missing parent=" + parentId
            );
        }
    }
}
```

### 14.3 Cycle detection dengan DFS color

Gunakan tiga warna:

```text
WHITE = belum dikunjungi
GRAY  = sedang di call stack / sedang dieksplorasi
BLACK = selesai diproses
```

Jika traversal menemukan edge ke `GRAY`, ada cycle.

```java
enum Color {
    WHITE,
    GRAY,
    BLACK
}
```

```java
static void validateAcyclic(List<CategoryRow> rows) {
    Map<Long, List<Long>> childrenByParent = new HashMap<>();
    Map<Long, Color> colorById = new HashMap<>();

    for (CategoryRow row : rows) {
        colorById.put(row.id(), Color.WHITE);
        if (row.parentId() != null) {
            childrenByParent
                .computeIfAbsent(row.parentId(), ignored -> new ArrayList<>())
                .add(row.id());
        }
    }

    for (CategoryRow row : rows) {
        if (colorById.get(row.id()) == Color.WHITE) {
            detectCycle(row.id(), childrenByParent, colorById, new ArrayDeque<>());
        }
    }
}

static void detectCycle(
        long id,
        Map<Long, List<Long>> childrenByParent,
        Map<Long, Color> colorById,
        ArrayDeque<Long> path
) {
    Color color = colorById.get(id);
    if (color == Color.GRAY) {
        throw new IllegalArgumentException("Cycle detected around id=" + id + ", path=" + path);
    }
    if (color == Color.BLACK) {
        return;
    }

    colorById.put(id, Color.GRAY);
    path.addLast(id);

    for (long childId : childrenByParent.getOrDefault(id, List.of())) {
        detectCycle(childId, childrenByParent, colorById, path);
    }

    path.removeLast();
    colorById.put(id, Color.BLACK);
}
```

Catatan:

- Untuk input sangat deep, implementasi recursive cycle detection juga bisa stack overflow.
- Untuk production yang menerima input tidak terpercaya, buat versi iterative atau pasang depth limit.

---

## 15. Tree yang Diam-Diam Bukan Tree

Ini salah satu bagian paling penting untuk engineer sistem.

Banyak domain tampak seperti tree, tetapi sebenarnya bukan.

### 15.1 Permission inheritance

Permission hierarchy bisa terlihat seperti tree:

```text
Admin
├── Case Manager
└── Appeal Officer
```

Tetapi jika role bisa inherit dari banyak role:

```text
Senior Officer inherits Case Manager and Appeal Officer
```

Maka itu DAG, bukan tree.

### 15.2 Organization structure

Org chart biasanya tree. Tetapi matrix organization bisa membuat satu orang punya reporting line fungsional dan project line.

Itu bukan tree murni.

### 15.3 Workflow state

State transition hampir selalu graph, bukan tree.

```text
Draft -> Submitted -> Approved
Draft -> Cancelled
Submitted -> Returned -> Draft
```

Ada edge balik. Itu cyclic graph.

Kalau kamu memodelkannya sebagai tree, kamu bisa salah pada:

- reachability,
- duplicate visit,
- infinite traversal,
- impact analysis,
- path count.

### 15.4 Case dependency

Case A tergantung Case B, Case C tergantung Case B. Ini graph dependency. Jika tidak ada cycle, itu DAG. Bukan tree karena satu node bisa menjadi dependency banyak node.

---

## 16. Parent Pointer: Perlu atau Tidak?

Node bisa punya pointer ke parent:

```java
final class MutableNode<T> {
    T value;
    MutableNode<T> parent;
    List<MutableNode<T>> children = new ArrayList<>();
}
```

Kelebihan parent pointer:

1. Mudah mengambil ancestor.
2. Mudah membuat breadcrumb.
3. Mudah remove node dari parent.
4. Mudah menghitung path root-to-node.

Kekurangan:

1. Bisa menciptakan cycle reference.
2. Mutasi harus menjaga dua arah relation.
3. Lebih mudah inconsistent:
   - parent bilang child ada,
   - child bilang parent berbeda.
4. Serialization lebih kompleks.
5. Memory overhead bertambah.

### 16.1 Invariant dua arah

Jika memakai parent pointer, operasi add child harus menjaga dua relation:

```java
void addChild(MutableNode<T> child) {
    Objects.requireNonNull(child);

    if (child.parent != null) {
        throw new IllegalArgumentException("Child already has parent");
    }

    child.parent = this;
    children.add(child);
}
```

Tetapi ini masih belum cukup. Harus cegah cycle:

```java
void addChild(MutableNode<T> child) {
    Objects.requireNonNull(child);

    if (child == this) {
        throw new IllegalArgumentException("Node cannot be child of itself");
    }

    for (MutableNode<T> p = this; p != null; p = p.parent) {
        if (p == child) {
            throw new IllegalArgumentException("Adding child would create a cycle");
        }
    }

    if (child.parent != null) {
        throw new IllegalArgumentException("Child already has parent");
    }

    child.parent = this;
    children.add(child);
}
```

Ini contoh bahwa tree mutation bukan sekadar `children.add(child)`.

---

## 17. Mutable Tree vs Immutable Tree

### 17.1 Mutable tree

Kelebihan:

- Mudah dibangun incrementally.
- Mudah edit node.
- Cocok untuk builder/internal processing.

Kekurangan:

- Sulit menjaga invariant.
- Tidak aman untuk sharing.
- Susah reasoning saat traversal dan mutation bersamaan.
- Lebih rawan cycle.

### 17.2 Immutable tree

```java
record ImmutableNode<T>(T value, List<ImmutableNode<T>> children) {
    ImmutableNode {
        Objects.requireNonNull(value);
        children = List.copyOf(children);
    }
}
```

Kelebihan:

- Aman dibaca banyak pihak.
- Tidak berubah saat traversal.
- Cocok untuk snapshot config/rule/menu.
- Lebih mudah testing.

Kekurangan:

- Update bisa mahal jika tree besar.
- Perlu rebuilding path untuk perubahan kecil.
- Butuh builder jika konstruksi kompleks.

### 17.3 Hybrid approach

Pattern yang umum:

1. Build dengan mutable internal builder.
2. Validate invariant.
3. Freeze menjadi immutable tree.
4. Publish snapshot immutable.

Ini sangat cocok untuk:

- workflow definition,
- rule tree,
- menu configuration,
- permission tree,
- document section tree,
- product/category hierarchy.

---

## 18. Tree API Design

API tree yang buruk:

```java
class Node<T> {
    public T value;
    public List<Node<T>> children = new ArrayList<>();
}
```

Masalah:

1. Semua orang bisa mutasi.
2. Invariant tidak bisa dijaga.
3. Cycle mudah dibuat.
4. Traversal bisa gagal karena concurrent modification.
5. Tidak ada ownership jelas.

API yang lebih baik:

```java
public final class TreeNode<T> {
    private final T value;
    private final List<TreeNode<T>> children;

    public TreeNode(T value, List<TreeNode<T>> children) {
        this.value = Objects.requireNonNull(value);
        this.children = List.copyOf(children);
    }

    public T value() {
        return value;
    }

    public List<TreeNode<T>> children() {
        return children;
    }

    public boolean isLeaf() {
        return children.isEmpty();
    }
}
```

Untuk mutable builder:

```java
public final class TreeBuilder<T> {
    private final T value;
    private final List<TreeBuilder<T>> children = new ArrayList<>();

    public TreeBuilder(T value) {
        this.value = Objects.requireNonNull(value);
    }

    public TreeBuilder<T> addChild(TreeBuilder<T> child) {
        children.add(Objects.requireNonNull(child));
        return this;
    }

    public TreeNode<T> build() {
        List<TreeNode<T>> builtChildren = new ArrayList<>(children.size());
        for (TreeBuilder<T> child : children) {
            builtChildren.add(child.build());
        }
        return new TreeNode<>(value, builtChildren);
    }
}
```

Namun builder ini belum mencegah reuse child builder di dua tempat. Jika itu penting, tambahkan validation identity.

---

## 19. Path dalam Tree

Path root-to-node sering dibutuhkan untuk breadcrumb, audit, permission explanation, atau error reporting.

### 19.1 Recursive path search

```java
static <T> boolean findPath(
        NaryNode<T> node,
        Predicate<T> target,
        List<T> path
) {
    path.add(node.value());

    if (target.test(node.value())) {
        return true;
    }

    for (NaryNode<T> child : node.children()) {
        if (findPath(child, target, path)) {
            return true;
        }
    }

    path.remove(path.size() - 1);
    return false;
}
```

Pemakaian:

```java
List<String> path = new ArrayList<>();
boolean found = findPath(root, value -> value.equals("Renewal"), path);
```

Jika found:

```text
Root -> Application -> Renewal
```

### 19.2 Parent map path

Untuk data besar, lebih efisien menyimpan parent map:

```java
Map<Long, Long> parentById = new HashMap<>();
```

Ambil path:

```java
static List<Long> pathToRoot(long id, Map<Long, Long> parentById) {
    ArrayList<Long> reversed = new ArrayList<>();
    Long current = id;

    while (current != null) {
        reversed.add(current);
        current = parentById.get(current);
    }

    Collections.reverse(reversed);
    return List.copyOf(reversed);
}
```

Tapi ini harus dipakai pada data yang sudah divalidasi acyclic. Jika tidak, `while` bisa infinite loop.

Tambahkan guard:

```java
static List<Long> safePathToRoot(long id, Map<Long, Long> parentById) {
    ArrayList<Long> reversed = new ArrayList<>();
    Set<Long> seen = new HashSet<>();
    Long current = id;

    while (current != null) {
        if (!seen.add(current)) {
            throw new IllegalArgumentException("Cycle detected while building path at id=" + current);
        }
        reversed.add(current);
        current = parentById.get(current);
    }

    Collections.reverse(reversed);
    return List.copyOf(reversed);
}
```

---

## 20. Serialization dan Deserialization Tree

Tree bisa diserialisasi dalam beberapa format.

### 20.1 Nested JSON

```json
{
  "id": 1,
  "name": "Root",
  "children": [
    {
      "id": 2,
      "name": "Application",
      "children": []
    }
  ]
}
```

Kelebihan:

- Natural untuk UI.
- Mudah dipahami manusia.

Kekurangan:

- Bisa besar.
- Deep tree bisa bermasalah untuk parser/stack.
- Shared node tidak bisa direpresentasikan tanpa duplikasi.
- Cycle tidak bisa direpresentasikan secara normal.

### 20.2 Flat rows

```json
[
  { "id": 1, "parentId": null, "name": "Root" },
  { "id": 2, "parentId": 1, "name": "Application" }
]
```

Kelebihan:

- Cocok untuk DB.
- Lebih mudah update satu node.
- Lebih compact untuk beberapa kasus.

Kekurangan:

- Client harus build tree.
- Perlu validation.
- Ordering children harus ditentukan eksplisit.

### 20.3 Preorder dengan marker

```text
A B D # # E # # C F # # #
```

Cocok untuk algorithm exercise, jarang dipakai langsung dalam enterprise API.

---

## 21. Ordering Children

Tree sering tidak cukup hanya parent-child. Urutan child juga penting.

Contoh menu:

```text
Dashboard
Case Management
Reports
Admin
```

Jika children disimpan dalam `HashSet`, urutan tidak deterministik.

Lebih baik:

- Simpan `sortOrder` pada row.
- Gunakan `List` untuk children.
- Sort secara eksplisit.
- Gunakan comparator yang deterministic.

Contoh:

```java
record MenuRow(long id, Long parentId, String label, int sortOrder) {}
```

```java
children.sort(
    Comparator.comparingInt(MenuRow::sortOrder)
              .thenComparing(MenuRow::label)
              .thenComparingLong(MenuRow::id)
);
```

Kenapa perlu tie-breaker `id`?

Agar output deterministic meskipun `sortOrder` dan `label` sama.

Dalam production, deterministic ordering penting untuk:

1. Snapshot testing.
2. UI consistency.
3. Audit diff.
4. Cache key stability.
5. Reproducible report.

---

## 22. Tree sebagai Domain Model

### 22.1 Menu tree

Operation penting:

- render visible nodes,
- apply permission filtering,
- preserve order,
- collapse empty parent,
- mark active path.

DSA yang dipakai:

- preorder untuk render,
- postorder untuk prune parent kosong,
- path search untuk active breadcrumb.

### 22.2 Permission tree

Operation penting:

- inherit permission dari parent,
- override permission di child,
- explain effective permission,
- validate no conflicting rule.

DSA yang dipakai:

- preorder untuk propagate context,
- path root-to-node untuk explanation,
- immutable snapshot untuk safe publication.

### 22.3 Organization tree

Operation penting:

- find all subordinates,
- find manager chain,
- compute headcount,
- detect invalid reporting cycle.

DSA yang dipakai:

- adjacency map,
- parent map,
- postorder aggregation,
- cycle detection.

### 22.4 Document tree

Operation penting:

- section numbering,
- table of contents,
- nested validation,
- diff section subtree.

DSA yang dipakai:

- preorder for numbering,
- postorder for validation aggregate,
- path for section reference.

### 22.5 Case management tree

Case relationships often start as tree:

```text
Master Case
├── Investigation
├── Enforcement Action
└── Appeal
```

But as soon as one appeal references multiple enforcement actions, or one document is shared by multiple cases, the structure becomes graph/DAG.

This is why engineers must avoid forcing every hierarchy-looking domain into tree.

---

## 23. Failure Modes dalam Production

### 23.1 Infinite recursion due to cycle

Cause:

- bad data,
- missing validation,
- mutable child reference,
- parent-child relation corrupted.

Mitigation:

- validate acyclic,
- visited set,
- depth limit,
- immutable tree after build.

### 23.2 Orphan node

Cause:

- parent deleted,
- migration partial,
- import order issue,
- missing FK constraint.

Mitigation:

- orphan validation,
- FK constraint if stored in DB,
- quarantine invalid rows,
- report exact node and missing parent.

### 23.3 Multiple roots when only one expected

Cause:

- incomplete data migration,
- wrong tenant filter,
- null parent accidentally inserted.

Mitigation:

- root count validation,
- tenant-scoped unique root rule,
- explicit virtual root if multiple roots are valid.

### 23.4 Duplicate ID

Cause:

- merge data from multiple source without namespace,
- string/integer conversion bug,
- natural key conflict.

Mitigation:

- ID uniqueness check,
- use namespaced key,
- report duplicate rows.

### 23.5 Accidental DAG

Cause:

- same child object reused in two parents,
- permission/role inheritance modeled too simplistically,
- shared component treated as owned component.

Mitigation:

- decide whether domain is tree or DAG,
- validate single parent if tree,
- change model if shared node is valid.

### 23.6 Stack overflow on deep tree

Cause:

- recursive traversal on untrusted data,
- malicious input,
- degenerate hierarchy.

Mitigation:

- iterative traversal,
- depth limit,
- input validation,
- pagination/lazy loading for UI tree.

### 23.7 Memory blow-up

Cause:

- object node per row for millions of rows,
- duplicate subtree materialization,
- eager building entire hierarchy,
- retaining parent and child maps together too long.

Mitigation:

- ID/index-based representation,
- streaming traversal,
- lazy loading,
- release intermediate maps,
- measure with heap profiler/JOL.

---

## 24. Java-Specific Cost Model untuk Tree

Tree berbasis object node memiliki cost berbeda dari array.

```java
final class Node<T> {
    T value;
    List<Node<T>> children;
}
```

Setiap node minimal punya:

1. Object header.
2. Reference ke value.
3. Reference ke children list.
4. Object list terpisah.
5. Backing array list terpisah jika `ArrayList`.
6. Child node objects.

Implikasi:

- Banyak allocation.
- Pointer chasing tinggi.
- Cache locality rendah.
- GC harus melacak banyak object.

Untuk tree kecil/sedang, ini tidak masalah.

Untuk tree sangat besar, pertimbangkan:

```java
long[] ids;
int[] firstChildIndex;
int[] nextSiblingIndex;
```

Atau:

```java
int[] parent;
int[][] children;
```

Trade-off:

| Model | Readability | Memory | Locality | Domain expressiveness |
|---|---:|---:|---:|---:|
| Object node | tinggi | boros | rendah | tinggi |
| ID adjacency map | sedang | sedang | sedang | sedang |
| Array-indexed | rendah | efisien | tinggi | rendah |

Top-tier engineering bukan selalu memilih yang tercepat. Yang benar adalah memilih representasi yang sesuai dengan:

1. ukuran data,
2. frekuensi operasi,
3. mutation pattern,
4. lifecycle object,
5. readability requirement,
6. correctness risk,
7. performance budget.

---

## 25. Depth Limit dan Input Tidak Terpercaya

Jika tree berasal dari user input, integration API, migration file, atau database yang historinya panjang, jangan percaya bahwa data selalu valid.

Tambahkan limit:

```java
static <T> void validateDepth(NaryNode<T> node, int maxDepth) {
    validateDepth(node, maxDepth, 0);
}

static <T> void validateDepth(NaryNode<T> node, int maxDepth, int depth) {
    if (depth > maxDepth) {
        throw new IllegalArgumentException("Tree depth exceeds limit: " + maxDepth);
    }

    for (NaryNode<T> child : node.children()) {
        validateDepth(child, maxDepth, depth + 1);
    }
}
```

Untuk production input besar, gunakan iterative version:

```java
record DepthFrame<T>(NaryNode<T> node, int depth) {}

static <T> void validateDepthIterative(NaryNode<T> root, int maxDepth) {
    ArrayDeque<DepthFrame<T>> stack = new ArrayDeque<>();
    stack.push(new DepthFrame<>(root, 0));

    while (!stack.isEmpty()) {
        DepthFrame<T> frame = stack.pop();
        if (frame.depth() > maxDepth) {
            throw new IllegalArgumentException("Tree depth exceeds limit: " + maxDepth);
        }

        for (NaryNode<T> child : frame.node().children()) {
            stack.push(new DepthFrame<>(child, frame.depth() + 1));
        }
    }
}
```

---

## 26. Testing Tree Code

Tree code harus dites bukan hanya happy path.

### 26.1 Test cases wajib

1. Empty input.
2. Single root only.
3. Multiple roots if not allowed.
4. One-level tree.
5. Deep chain.
6. Wide root.
7. Balanced tree.
8. Duplicate ID.
9. Missing parent.
10. Cycle self-loop.
11. Cycle multi-node.
12. Deterministic sibling order.
13. Large input.
14. Permission/filter pruning.
15. Immutable children cannot be modified.

### 26.2 Example test idea

```java
@Test
void shouldRejectCycle() {
    List<CategoryRow> rows = List.of(
        new CategoryRow(1, 3L, "A"),
        new CategoryRow(2, 1L, "B"),
        new CategoryRow(3, 2L, "C")
    );

    assertThrows(IllegalArgumentException.class, () -> validateAcyclic(rows));
}
```

### 26.3 Property-style invariant

Untuk setiap valid tree:

1. Semua node kecuali root punya satu parent.
2. Jumlah edge = jumlah node - jumlah root untuk forest.
3. Traversal preorder mengunjungi setiap node tepat sekali.
4. Tidak ada duplicate ID dalam traversal result.
5. Semua parentId non-null menunjuk ID yang ada.

---

## 27. Design Checklist

Sebelum memakai tree dalam desain, jawab pertanyaan ini:

### 27.1 Domain invariant

1. Apakah benar setiap node hanya punya satu parent?
2. Apakah root harus satu atau boleh banyak?
3. Apakah shared child valid?
4. Apakah cycle mungkin secara domain?
5. Apakah urutan sibling penting?
6. Apakah node bisa berpindah parent?
7. Apakah subtree bisa dihapus/diarsipkan?
8. Apakah child mewarisi property parent?

### 27.2 Operation profile

1. Operasi paling sering apa?
2. Search by ID sering atau traversal sering?
3. Butuh ancestor lookup cepat?
4. Butuh descendant lookup cepat?
5. Butuh range/order query?
6. Butuh update realtime atau snapshot?
7. Ukuran tree berapa?
8. Depth maksimum berapa?
9. Width maksimum berapa?

### 27.3 Representation

1. Object references cukup atau perlu ID-based?
2. Perlu parent pointer?
3. Perlu immutable snapshot?
4. Perlu builder?
5. Perlu validation layer?
6. Perlu lazy loading?
7. Perlu cache path/subtree size?

### 27.4 Failure handling

1. Apa error message jika orphan?
2. Apa error message jika cycle?
3. Apa yang dilakukan jika multiple root?
4. Apakah invalid data ditolak, dikarantina, atau diperbaiki?
5. Apakah traversal punya depth limit?
6. Apakah output deterministic?

---

## 28. Mini Case Study: Menu Tree dengan Permission Filtering

Problem:

Kita punya menu tree. Setiap menu punya required permission optional. User hanya boleh melihat menu jika:

1. Menu tidak punya required permission, atau
2. User punya permission tersebut.

Jika parent tidak punya visible child dan parent sendiri tidak directly visible, parent harus hilang.

Ini membutuhkan postorder, karena keputusan parent bisa bergantung pada hasil filtering children.

### 28.1 Model

```java
record MenuItem(
    long id,
    String label,
    String requiredPermission,
    List<MenuItem> children
) {
    MenuItem {
        Objects.requireNonNull(label);
        children = List.copyOf(children);
    }
}
```

### 28.2 Filtering

```java
static Optional<MenuItem> filterMenu(MenuItem item, Set<String> userPermissions) {
    List<MenuItem> filteredChildren = new ArrayList<>();

    for (MenuItem child : item.children()) {
        filterMenu(child, userPermissions).ifPresent(filteredChildren::add);
    }

    boolean directlyVisible = item.requiredPermission() == null
        || userPermissions.contains(item.requiredPermission());

    if (!directlyVisible && filteredChildren.isEmpty()) {
        return Optional.empty();
    }

    return Optional.of(new MenuItem(
        item.id(),
        item.label(),
        item.requiredPermission(),
        filteredChildren
    ));
}
```

Mental model:

- Children diproses dulu.
- Parent dipertahankan jika visible sendiri atau punya visible descendant.
- Output tree immutable baru.
- Input tree tidak dimutasi.

Ini lebih aman daripada menghapus child dari list saat traversal.

---

## 29. Mini Case Study: Organization Headcount Aggregation

Problem:

Diberikan org tree. Hitung total headcount di setiap node termasuk semua descendant.

Model:

```java
record OrgNode(
    long id,
    String name,
    int directHeadcount,
    List<OrgNode> children
) {
    OrgNode {
        children = List.copyOf(children);
    }
}
```

Result:

```java
record HeadcountResult(long id, int totalHeadcount) {}
```

Computation:

```java
static int computeHeadcount(
        OrgNode node,
        Map<Long, Integer> totalById
) {
    int total = node.directHeadcount();

    for (OrgNode child : node.children()) {
        total += computeHeadcount(child, totalById);
    }

    totalById.put(node.id(), total);
    return total;
}
```

Ini postorder aggregation.

Failure mode:

- Jika cycle ada, infinite recursion.
- Jika org sangat deep, stack overflow.
- Jika direct headcount bisa negatif, invariant bisnis rusak.
- Jika satu node muncul di dua parent, total bisa double-count.

---

## 30. Mini Case Study: Effective Configuration Inheritance

Problem:

Setiap node bisa override sebagian configuration parent.

Contoh:

```text
Global config
└── Agency config
    └── Module config
        └── Feature config
```

Kita ingin menghitung effective config untuk setiap node.

Ini preorder, karena child butuh context parent.

```java
record Config(boolean enabled, int timeoutSeconds) {}
record ConfigPatch(Boolean enabled, Integer timeoutSeconds) {}

static Config apply(Config parent, ConfigPatch patch) {
    return new Config(
        patch.enabled() != null ? patch.enabled() : parent.enabled(),
        patch.timeoutSeconds() != null ? patch.timeoutSeconds() : parent.timeoutSeconds()
    );
}
```

Traversal:

```java
record ConfigNode(long id, ConfigPatch patch, List<ConfigNode> children) {
    ConfigNode {
        children = List.copyOf(children);
    }
}

static void computeEffectiveConfig(
        ConfigNode node,
        Config inherited,
        Map<Long, Config> effectiveById
) {
    Config effective = apply(inherited, node.patch());
    effectiveById.put(node.id(), effective);

    for (ConfigNode child : node.children()) {
        computeEffectiveConfig(child, effective, effectiveById);
    }
}
```

Mental model:

- Preorder cocok untuk top-down context propagation.
- Postorder cocok untuk bottom-up aggregation.

---

## 31. Common Interview DSA vs Production DSA

Interview sering bertanya:

1. Invert binary tree.
2. Maximum depth.
3. Lowest common ancestor.
4. Validate BST.
5. Level-order traversal.

Production sering bertanya secara implisit:

1. Apakah data ini benar-benar tree?
2. Bagaimana mencegah cycle dari DB/input?
3. Bagaimana error reporting jika hierarchy rusak?
4. Bagaimana membuat traversal deterministic?
5. Bagaimana membatasi depth untuk input tidak terpercaya?
6. Bagaimana menjaga permission inheritance tetap benar?
7. Bagaimana menghindari `O(n²)` saat membangun tree dari row?
8. Bagaimana membuat snapshot immutable agar aman dibaca banyak request?
9. Bagaimana mengukur memory jika tree punya jutaan node?
10. Bagaimana membedakan tree vs DAG ketika requirement berubah?

Top-tier engineer harus bisa dua-duanya, tetapi production DSA biasanya lebih sulit karena data tidak selalu bersih dan invariant tidak selalu eksplisit.

---

## 32. Latihan

### Latihan 1 — Build forest dari flat rows

Diberikan:

```java
record Row(long id, Long parentId, String name, int sortOrder) {}
```

Buat function:

```java
List<TreeNode<Row>> buildForest(List<Row> rows)
```

Requirement:

1. Reject duplicate ID.
2. Reject orphan.
3. Reject cycle.
4. Sort siblings by `sortOrder`, lalu `id`.
5. Return immutable tree.
6. Complexity ideal `O(n log k)` karena sorting siblings, dengan `k` ukuran sibling group.

### Latihan 2 — Flatten tree preorder

Buat function:

```java
List<Long> flattenPreorder(TreeNode<Row> root)
```

Tambahkan versi iterative.

### Latihan 3 — Prune invisible nodes

Diberikan tree menu dan set permission user. Return tree baru yang hanya berisi visible nodes. Parent dipertahankan jika punya visible descendant.

### Latihan 4 — Detect accidental DAG pada object tree

Diberikan object tree `Node` yang mutable. Buat validator yang menolak jika object identity node yang sama ditemukan melalui dua path berbeda.

Hint:

- Gunakan `IdentityHashMap` atau `Set` berbasis identity.

### Latihan 5 — Convert recursion to explicit stack

Ambil recursive postorder aggregation dan ubah menjadi iterative dengan frame.

---

## 33. Ringkasan

Tree adalah struktur yang terlihat sederhana tetapi sering menjadi sumber bug serius di sistem nyata.

Hal paling penting dari bagian ini:

1. Tree adalah invariant, bukan sekadar `Node.children`.
2. Setiap node selain root harus punya tepat satu parent.
3. Tree tidak boleh cyclic.
4. Traversal dipilih berdasarkan arah dependency:
   - preorder untuk parent-to-child propagation,
   - postorder untuk child-to-parent aggregation,
   - inorder untuk binary/BST ordering,
   - level-order untuk breadth/level processing.
5. Recursive traversal mudah, tetapi berisiko pada input dalam atau cyclic.
6. Iterative traversal dengan `ArrayDeque` sering lebih aman untuk production.
7. Flat rows harus divalidasi sebelum dibangun menjadi tree.
8. Banyak domain yang terlihat seperti tree sebenarnya DAG atau graph.
9. Immutable tree snapshot membantu correctness dan safe sharing.
10. DSA top-tier menuntut pemahaman invariant, cost model, dan failure mode sekaligus.

---

## 34. Referensi

1. Oracle Java SE 25 Documentation — `TreeMap`: Red-Black tree based `NavigableMap` implementation with guaranteed `log(n)` cost for core operations.
2. Oracle Java SE 25 Documentation — `ArrayDeque`: resizable-array implementation of `Deque`.
3. Oracle Java SE 25 Documentation — `Deque`: interface for accessing elements at both ends of a deque.
4. Oracle Java SE 25 Documentation — `StackOverflowError`: thrown when stack overflow occurs because an application recurses too deeply.
5. OpenJDK JOL — Java Object Layout tooling for object layout, footprint, and references.

---

## 35. Status Seri

Bagian ini adalah **Part 010 dari 030**.

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-dsa-part-011 — Trees II: BST, Balanced Tree, Segment Tree, Fenwick Tree
```
