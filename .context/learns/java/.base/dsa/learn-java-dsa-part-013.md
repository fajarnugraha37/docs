# learn-java-dsa-part-013.md

# Part 013 — Graph I: Graph Mental Model, Representation, Traversal

> Seri: **Java Data Structure and Algorithm — Advanced**  
> Bagian: **013 dari 030**  
> Topik: **Graph fundamentals, representation, BFS, DFS, visited state, traversal correctness, dan Java implementation trade-off**

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas heap dan priority sebagai struktur untuk memilih elemen berdasarkan prioritas. Sekarang kita masuk ke salah satu struktur data paling penting untuk software engineering nyata: **graph**.

Graph bukan hanya materi interview. Graph adalah model natural untuk:

- dependency antar service,
- dependency antar module,
- workflow state transition,
- approval chain,
- authorization relation,
- ownership relation,
- case impact propagation,
- data lineage,
- route/network,
- scheduling dependency,
- migration order,
- retry cascade,
- escalation path,
- dan hampir semua bentuk relasi yang tidak cukup dimodelkan sebagai list/tree biasa.

Tujuan part ini adalah membuat kamu bisa berpikir seperti ini:

> “Saya tidak hanya punya kumpulan object. Saya punya entity dan relation. Kalau relation-nya bisa bercabang, berulang, memiliki cycle, atau butuh reachability analysis, maka mental model-nya adalah graph.”

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. membedakan graph dari list, tree, map, dan table biasa;
2. memilih representasi graph yang sesuai di Java;
3. memahami adjacency list, adjacency matrix, edge list, dan object graph;
4. mengimplementasikan BFS dan DFS secara aman;
5. menghindari bug visited-state, duplicate traversal, infinite loop, dan stack overflow;
6. mendesain traversal untuk kebutuhan production seperti dependency scan, impact analysis, dan workflow reachability;
7. membaca domain problem lalu mengubahnya menjadi graph problem.

---

## 1. Graph sebagai Mental Model

Secara sederhana, graph terdiri dari:

- **vertex/node**: entity;
- **edge/link**: relation antar entity.

Contoh:

```text
Case A -> Document D1
Case A -> Party P1
Case A -> Case B
Case B -> Enforcement Action E1
```

Di sini:

- `Case A`, `Document D1`, `Party P1`, `Case B`, `Enforcement Action E1` adalah node;
- panah antar node adalah edge.

Graph menjawab pertanyaan seperti:

- “Dari node ini, apa saja yang bisa dicapai?”
- “Apakah ada dependency cycle?”
- “Kalau entity ini berubah, entity mana saja yang terdampak?”
- “Apakah state ini reachable dari state awal?”
- “Apakah workflow punya dead-end yang tidak diinginkan?”
- “Apakah ada dua entity yang terhubung secara tidak langsung?”
- “Berapa layer dependency sampai service X?”

Graph menjadi penting ketika relation tidak lagi cukup direpresentasikan sebagai parent-child sederhana.

---

## 2. Graph vs Tree vs List vs Map

Banyak bug desain muncul karena engineer memaksa graph menjadi tree atau list.

### 2.1 List

List cocok ketika data bersifat linear:

```text
A -> B -> C -> D
```

Contoh:

- ordered tasks,
- validation messages,
- chronological audit entries,
- batch rows.

List tidak cocok jika satu item bisa punya banyak neighbor yang perlu ditelusuri.

---

### 2.2 Tree

Tree cocok ketika setiap node, kecuali root, punya tepat satu parent.

```text
       A
     /   \
    B     C
   / \
  D   E
```

Invariants umum tree:

1. Ada root.
2. Setiap node selain root punya satu parent.
3. Tidak ada cycle.
4. Ada tepat satu path dari root ke setiap node.

Tree cocok untuk:

- menu hierarchy,
- folder hierarchy,
- org chart sederhana,
- category hierarchy.

Tapi banyak domain yang tampak seperti tree sebenarnya bukan tree.

Contoh:

```text
          Policy A
         /        \
   Rule X          Rule Y
         \        /
          Condition C
```

`Condition C` dipakai oleh dua rule. Ini bukan tree murni. Ini minimal adalah DAG, yaitu directed acyclic graph.

---

### 2.3 Map

Map cocok untuk lookup langsung:

```java
Map<CaseId, Case> casesById;
```

Map menjawab:

```text
ID ini menunjuk ke object apa?
```

Tapi map tidak otomatis menjawab:

```text
Dari object ini, dependency apa saja yang reachable?
```

Untuk itu, kamu perlu relation graph:

```java
Map<CaseId, Set<CaseId>> dependenciesByCaseId;
```

---

### 2.4 Graph

Graph cocok ketika relation adalah first-class citizen.

```text
A -> B
A -> C
B -> D
C -> D
D -> A   possible cycle
```

Graph bisa memiliki:

- multiple parents,
- multiple children,
- disconnected components,
- cycle,
- weighted edge,
- directed relation,
- undirected relation,
- dynamic update,
- many-to-many relation.

Mental shift-nya:

> List memodelkan urutan. Tree memodelkan hierarchy. Map memodelkan lookup. Graph memodelkan reachability dan relation topology.

---

## 3. Terminologi Graph

### 3.1 Vertex / Node

Node adalah entity dalam graph.

Contoh node:

- service,
- module,
- user,
- role,
- case,
- document,
- state,
- rule,
- task,
- database table,
- endpoint.

Di Java, node bisa direpresentasikan sebagai:

```java
record ServiceId(String value) {}
record CaseId(String value) {}
record StateCode(String value) {}
```

atau object domain:

```java
final class ServiceNode {
    private final String name;
    private final String owner;
}
```

Namun untuk graph algorithm, ID-based representation sering lebih aman dan efisien daripada object-heavy representation.

---

### 3.2 Edge

Edge adalah relation antar node.

Contoh:

```text
OrderService -> PaymentService
CaseReview -> CaseApproved
RoleAdmin -> PermissionDeleteUser
```

Edge bisa punya metadata:

```java
record Edge<V>(V from, V to, String relationType) {}
```

Contoh relation type:

- `CALLS`,
- `DEPENDS_ON`,
- `OWNS`,
- `CAN_TRANSITION_TO`,
- `REFERENCES`,
- `BLOCKS`,
- `ESCALATES_TO`.

---

### 3.3 Directed Graph

Directed graph punya arah.

```text
A -> B
```

Artinya A menunjuk ke B, tapi belum tentu B menunjuk ke A.

Contoh directed graph:

- service A calls service B,
- state A can transition to state B,
- table A references table B,
- task A must run before task B.

Dalam Java:

```java
Map<V, Set<V>> outgoing;
```

`outgoing.get(A)` menghasilkan node yang dapat dicapai langsung dari A.

---

### 3.4 Undirected Graph

Undirected graph tidak punya arah.

```text
A -- B
```

Artinya A terhubung dengan B, dan B terhubung dengan A.

Contoh:

- friendship,
- network cable connection,
- equivalence relation,
- duplicate entity cluster,
- same-household relation.

Representasi adjacency list biasanya menyimpan dua arah:

```text
A: B
B: A
```

Di Java:

```java
void addUndirectedEdge(V a, V b) {
    adjacency.computeIfAbsent(a, ignored -> new LinkedHashSet<>()).add(b);
    adjacency.computeIfAbsent(b, ignored -> new LinkedHashSet<>()).add(a);
}
```

---

### 3.5 Weighted Graph

Weighted graph punya cost pada edge.

```text
A --5--> B
A --2--> C
```

Contoh weight:

- distance,
- latency,
- cost,
- risk score,
- priority,
- probability,
- duration,
- confidence.

Di Part 014 kita akan membahas shortest path. Di part ini kita fokus dulu pada representasi dan traversal dasar.

---

### 3.6 Cyclic Graph

Graph cyclic punya path yang kembali ke node sebelumnya.

```text
A -> B -> C -> A
```

Cycle bisa valid atau bug tergantung domain.

Valid:

- web navigation,
- retry flow,
- state machine yang mengizinkan reopen,
- social network.

Bug:

- dependency module,
- package import architecture,
- migration order,
- approval hierarchy,
- task prerequisite.

Karena cycle bisa membuat traversal infinite, graph traversal hampir selalu membutuhkan visited state.

---

### 3.7 DAG: Directed Acyclic Graph

DAG adalah directed graph tanpa cycle.

```text
A -> B -> D
A -> C -> D
```

DAG sangat penting untuk:

- dependency resolution,
- topological sort,
- build pipeline,
- ETL pipeline,
- workflow definition tanpa backward transition,
- task scheduling,
- rule dependency.

DAG akan dibahas lebih dalam di Part 014.

---

### 3.8 Degree

Untuk undirected graph:

- **degree** node = jumlah neighbor.

Untuk directed graph:

- **out-degree** = jumlah edge keluar;
- **in-degree** = jumlah edge masuk.

Contoh:

```text
A -> B
A -> C
D -> A
```

A punya:

- out-degree 2;
- in-degree 1.

In-degree penting untuk topological sort dan dependency analysis.

---

## 4. Graph sebagai Model Production

### 4.1 Service Dependency Graph

```text
WebApp -> UserService
WebApp -> CaseService
CaseService -> DocumentService
CaseService -> PaymentService
PaymentService -> ExternalGateway
```

Pertanyaan graph:

- Kalau `ExternalGateway` down, service mana terdampak?
- Kalau `CaseService` deploy, siapa downstream/upstream-nya?
- Apakah ada dependency cycle antar service?
- Berapa blast radius perubahan `DocumentService`?

---

### 4.2 Workflow State Graph

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
REJECTED -> DRAFT
```

Pertanyaan graph:

- State mana terminal?
- Apakah semua state reachable dari initial state?
- Apakah ada state yang tidak pernah bisa dicapai?
- Apakah state terminal bisa keluar lagi?
- Apakah ada transition ilegal?

---

### 4.3 Authorization Graph

```text
User -> Role
Role -> Permission
Permission -> ResourceAction
```

Pertanyaan graph:

- User ini akhirnya punya permission apa saja?
- Permission ini berasal dari role mana?
- Apakah ada role cycle?
- Apakah role inheritance membuat privilege escalation?

---

### 4.4 Case Impact Graph

```text
Case A -> Party P1
Case B -> Party P1
Case B -> Document D9
Document D9 -> ExternalReference R7
```

Pertanyaan graph:

- Jika Party P1 berubah, case mana saja terdampak?
- Jika Document D9 invalid, case mana perlu revalidation?
- Jika external reference dicabut, dependency chain mana yang harus diperiksa?

---

## 5. Graph Representation di Java

Tidak ada satu representasi graph yang selalu terbaik. Representasi harus dipilih berdasarkan:

1. jumlah vertex;
2. jumlah edge;
3. graph dense atau sparse;
4. operasi dominan;
5. perlu edge metadata atau tidak;
6. perlu deterministic traversal order atau tidak;
7. graph mutable atau immutable;
8. memory budget;
9. concurrency model;
10. apakah vertex punya ID integer padat atau object key sparse.

---

## 6. Representation 1: Adjacency List

Adjacency list menyimpan daftar neighbor untuk setiap vertex.

```text
A: B, C
B: D
C: D
D: 
```

Java representation umum:

```java
Map<V, List<V>> adjacency;
```

atau:

```java
Map<V, Set<V>> adjacency;
```

### 6.1 Kapan pakai `List<V>`?

Gunakan list jika:

- duplicate edge boleh atau perlu dihitung;
- ordering neighbor penting;
- edge insertion banyak dan membership check jarang;
- graph merepresentasikan event/order sequence.

Contoh:

```java
Map<ServiceId, List<ServiceId>> calls = new HashMap<>();
```

Kelemahan:

- duplicate edge mudah muncul;
- `contains` O(degree);
- edge existence check lambat untuk node dengan banyak neighbor.

---

### 6.2 Kapan pakai `Set<V>`?

Gunakan set jika:

- duplicate edge tidak valid;
- perlu fast edge existence check;
- graph relation bersifat unik;
- correctness lebih penting daripada mempertahankan duplicate.

Contoh:

```java
Map<ServiceId, Set<ServiceId>> dependencies = new HashMap<>();
```

Kelemahan:

- memory lebih besar;
- butuh `equals/hashCode` yang benar;
- ordering default `HashSet` tidak deterministic.

Jika butuh deterministic traversal:

```java
Map<V, Set<V>> graph = new LinkedHashMap<>();
Set<V> neighbors = new LinkedHashSet<>();
```

`LinkedHashMap`/`LinkedHashSet` berguna saat hasil traversal perlu stabil untuk test, audit, report, atau reproducible behavior.

---

### 6.3 Directed Adjacency List

```java
public final class DirectedGraph<V> {
    private final Map<V, Set<V>> outgoing = new LinkedHashMap<>();

    public void addVertex(V vertex) {
        outgoing.computeIfAbsent(vertex, ignored -> new LinkedHashSet<>());
    }

    public void addEdge(V from, V to) {
        addVertex(from);
        addVertex(to);
        outgoing.get(from).add(to);
    }

    public Set<V> neighborsOf(V vertex) {
        return outgoing.getOrDefault(vertex, Set.of());
    }

    public Set<V> vertices() {
        return Collections.unmodifiableSet(outgoing.keySet());
    }
}
```

Catatan penting:

- `addEdge` juga mendaftarkan `to`, meskipun `to` tidak punya outgoing edge.
- Tanpa itu, sink node sering hilang dari vertex set.
- `neighborsOf` mengembalikan empty set untuk vertex tanpa outgoing edge.

---

### 6.4 Undirected Adjacency List

```java
public final class UndirectedGraph<V> {
    private final Map<V, Set<V>> adjacency = new LinkedHashMap<>();

    public void addVertex(V vertex) {
        adjacency.computeIfAbsent(vertex, ignored -> new LinkedHashSet<>());
    }

    public void addEdge(V a, V b) {
        addVertex(a);
        addVertex(b);
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
    }

    public Set<V> neighborsOf(V vertex) {
        return adjacency.getOrDefault(vertex, Set.of());
    }
}
```

Invariant untuk undirected graph:

```text
Jika B ada di adjacency[A], maka A harus ada di adjacency[B].
```

Bug umum:

```java
adjacency.get(a).add(b);
// lupa adjacency.get(b).add(a)
```

Akibat:

- traversal dari A menemukan B;
- traversal dari B tidak menemukan A;
- connected component salah;
- graph tampak directed padahal domain-nya undirected.

---

## 7. Representation 2: Adjacency Matrix

Adjacency matrix memakai matrix `V x V`.

Untuk graph 4 node:

```text
    A B C D
A [ 0 1 1 0 ]
B [ 0 0 0 1 ]
C [ 0 0 0 1 ]
D [ 0 0 0 0 ]
```

Java:

```java
boolean[][] connected = new boolean[n][n];
```

Edge check:

```java
connected[fromIndex][toIndex]
```

biaya O(1).

### 7.1 Kelebihan Adjacency Matrix

1. Edge existence check sangat cepat.
2. Representasi sederhana untuk dense graph.
3. Cocok untuk algorithm tertentu.
4. Tidak membutuhkan object per edge.
5. Bisa pakai primitive array.

---

### 7.2 Kekurangan Adjacency Matrix

Memory cost O(V²).

Jika ada 100.000 vertex:

```text
100,000 x 100,000 = 10,000,000,000 boolean cells
```

Itu tidak realistis untuk banyak sistem Java biasa, apalagi `boolean[][]` di Java bukan satu contiguous bit matrix; ia adalah array of arrays dengan overhead object per row.

Adjacency matrix juga tidak nyaman untuk vertex ID yang sparse, misalnya:

```text
CASE-2026-000001
CASE-2026-982134
CASE-2026-777777
```

Kamu perlu mapping:

```java
Map<CaseId, Integer> indexByCaseId;
List<CaseId> caseByIndex;
```

---

### 7.3 Kapan Matrix Masuk Akal?

Adjacency matrix masuk akal jika:

- jumlah vertex kecil/menengah;
- graph dense;
- edge existence check sangat dominan;
- vertex bisa dipetakan ke integer index padat;
- memory budget cukup;
- algorithm membutuhkan matrix.

Contoh:

- compatibility matrix antar role kecil;
- transition matrix state machine dengan jumlah state kecil;
- permission matrix internal;
- all-pairs relation untuk dataset kecil.

---

## 8. Representation 3: Edge List

Edge list menyimpan daftar edge.

```java
record Edge<V>(V from, V to) {}

List<Edge<ServiceId>> edges = List.of(
    new Edge<>(webApp, userService),
    new Edge<>(webApp, caseService),
    new Edge<>(caseService, documentService)
);
```

### 8.1 Kelebihan Edge List

1. Simple.
2. Cocok untuk loading/import/export.
3. Cocok untuk batch processing.
4. Cocok jika edge adalah data utama.
5. Cocok untuk algoritma tertentu seperti Kruskal.

---

### 8.2 Kekurangan Edge List

Untuk mencari neighbor dari node X, kamu harus scan semua edge:

```java
for (Edge<V> edge : edges) {
    if (edge.from().equals(x)) {
        result.add(edge.to());
    }
}
```

Biaya O(E).

Kalau traversal melakukan ini berkali-kali, bisa berubah menjadi sangat lambat.

---

### 8.3 Edge List sebagai Input, Adjacency List sebagai Runtime Index

Pattern production yang umum:

1. Data disimpan sebagai rows/edge list.
2. Saat runtime, build adjacency index.
3. Traversal memakai adjacency list.

Contoh:

```java
static <V> Map<V, Set<V>> buildAdjacency(List<Edge<V>> edges) {
    Map<V, Set<V>> adjacency = new LinkedHashMap<>();

    for (Edge<V> edge : edges) {
        adjacency.computeIfAbsent(edge.from(), ignored -> new LinkedHashSet<>()).add(edge.to());
        adjacency.computeIfAbsent(edge.to(), ignored -> new LinkedHashSet<>());
    }

    return adjacency;
}
```

Ini adalah contoh penting dari prinsip:

> Data storage format tidak harus sama dengan algorithm execution format.

---

## 9. Representation 4: Object Graph

Object graph adalah ketika object langsung memegang reference ke object lain.

```java
final class WorkflowState {
    private final String code;
    private final List<WorkflowState> nextStates = new ArrayList<>();
}
```

Contoh:

```text
DRAFT object -> SUBMITTED object -> REVIEW object
```

### 9.1 Kelebihan Object Graph

1. Natural untuk domain modelling.
2. Navigasi mudah.
3. Bisa menyimpan behavior dekat dengan data.
4. Cocok untuk graph kecil dan controlled.

---

### 9.2 Kekurangan Object Graph

1. Mudah membuat cycle tanpa sadar.
2. Serialization bisa sulit.
3. Equality bisa rumit.
4. Debugging reference graph bisa sulit.
5. Memory overhead tinggi.
6. Traversal membutuhkan visited state berbasis identity atau logical ID.
7. Mutability bisa menyebabkan topology berubah saat traversal.

Contoh masalah:

```java
final class Node {
    String id;
    List<Node> children = new ArrayList<>();
}
```

Kalau `id` mutable dan dipakai untuk `equals/hashCode`, graph traversal berbasis `HashSet<Node>` bisa rusak.

---

### 9.3 ID Graph Lebih Aman untuk Algorithm

Daripada:

```java
Map<Case, Set<Case>> graph;
```

sering lebih aman:

```java
Map<CaseId, Set<CaseId>> graph;
Map<CaseId, Case> caseById;
```

Keuntungan:

- key immutable;
- serialization mudah;
- traversal lebih ringan;
- equality lebih jelas;
- graph tidak membawa semua object domain;
- bisa load detail object hanya ketika dibutuhkan.

Pattern ini sangat penting di sistem besar.

---

## 10. Representation 5: Integer-Indexed Graph

Untuk graph besar, object key bisa mahal. Jika vertex bisa dipetakan ke index `0..n-1`, kita bisa memakai array.

```java
List<int[]> adjacencyByIndex;
```

atau:

```java
int[][] adjacency;
```

Contoh mapping:

```java
Map<ServiceId, Integer> indexByService = new HashMap<>();
List<ServiceId> serviceByIndex = new ArrayList<>();
```

### 10.1 Kelebihan

1. Lebih hemat memory.
2. Lebih cache-friendly.
3. Lebih cepat untuk algorithm intensif.
4. Bisa pakai primitive arrays.
5. Avoid boxing jika dirancang benar.

---

### 10.2 Kekurangan

1. Butuh mapping layer.
2. Debugging kurang intuitif.
3. Graph update dinamis lebih sulit.
4. API domain perlu translate ID-index.

Pattern umum:

```text
External/domain API: ServiceId
Internal algorithm: int index
Output: ServiceId again
```

Ini pattern top-tier untuk graph besar.

---

## 11. Choosing Representation

| Representasi | Edge check | Neighbor iteration | Memory | Cocok untuk |
|---|---:|---:|---:|---|
| Edge list | O(E) | O(E) | O(E) | import/export, batch, simple storage |
| Adjacency list | O(degree) atau O(1) dengan set | O(degree) | O(V + E) | sparse graph, traversal umum |
| Adjacency matrix | O(1) | O(V) | O(V²) | dense graph, small state matrix |
| Object graph | tergantung | natural | tinggi | domain kecil/medium |
| Integer-indexed graph | cepat | cepat | rendah | large graph, algorithm-heavy |

Rule of thumb:

1. Untuk kebanyakan production graph sparse: **adjacency list**.
2. Untuk state machine kecil: **matrix atau map-based transition table**.
3. Untuk graph besar: **integer-indexed adjacency**.
4. Untuk storage/import: **edge list**.
5. Untuk domain object: gunakan object graph hati-hati; jangan jadikan itu satu-satunya algorithm representation.

---

## 12. Traversal Graph

Traversal adalah proses mengunjungi node-node graph mengikuti edge.

Dua traversal dasar:

1. **BFS** — Breadth-First Search.
2. **DFS** — Depth-First Search.

BFS mengeksplorasi layer demi layer.

DFS mengeksplorasi sedalam mungkin dulu.

---

## 13. Breadth-First Search / BFS

BFS memakai queue.

Mental model:

```text
Mulai dari source.
Kunjungi semua neighbor jarak 1.
Lalu semua neighbor jarak 2.
Lalu semua neighbor jarak 3.
Dan seterusnya.
```

Contoh graph:

```text
A -> B
A -> C
B -> D
C -> E
D -> F
E -> F
```

BFS dari A:

```text
A
B, C
D, E
F
```

BFS sangat cocok untuk:

- shortest path pada unweighted graph;
- nearest reachable node;
- layer traversal;
- dependency depth;
- level-order propagation;
- blast radius by distance;
- finding minimum number of transitions.

---

## 14. BFS Implementation di Java

```java
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class GraphTraversal {
    public static <V> List<V> bfs(V start, Map<V, ? extends Iterable<V>> graph) {
        Set<V> visited = new HashSet<>();
        ArrayDeque<V> queue = new ArrayDeque<>();
        List<V> order = new ArrayList<>();

        visited.add(start);
        queue.addLast(start);

        while (!queue.isEmpty()) {
            V current = queue.removeFirst();
            order.add(current);

            Iterable<V> neighbors = graph.getOrDefault(current, List.of());
            for (V neighbor : neighbors) {
                if (visited.add(neighbor)) {
                    queue.addLast(neighbor);
                }
            }
        }

        return order;
    }
}
```

### 14.1 Kenapa `visited.add(neighbor)` di dalam `if`?

`Set.add` mengembalikan:

- `true` jika elemen belum ada dan berhasil ditambahkan;
- `false` jika elemen sudah ada.

Jadi ini compact dan aman:

```java
if (visited.add(neighbor)) {
    queue.addLast(neighbor);
}
```

Artinya:

> hanya enqueue neighbor yang baru pertama kali ditemukan.

---

### 14.2 Mark Visited Saat Enqueue, Bukan Saat Dequeue

Bug umum:

```java
queue.addLast(neighbor);
// visited baru ditandai nanti saat dequeue
```

Masalahnya, node yang sama bisa masuk queue berkali-kali dari parent berbeda.

Contoh:

```text
A -> B
A -> C
B -> D
C -> D
```

Kalau `D` tidak langsung ditandai saat enqueue, maka `D` bisa masuk queue dua kali.

Correct pattern:

```java
if (visited.add(neighbor)) {
    queue.addLast(neighbor);
}
```

---

### 14.3 Kenapa `ArrayDeque`, Bukan `LinkedList`?

Untuk queue/stack non-concurrent, `ArrayDeque` umumnya pilihan yang baik karena berbasis resizable array, tidak menerima `null`, tidak thread-safe tanpa external synchronization, dan didokumentasikan kemungkinan lebih cepat daripada `Stack` untuk stack usage serta lebih cepat daripada `LinkedList` untuk queue usage.

BFS sering melakukan banyak enqueue/dequeue. Menggunakan `LinkedList` berarti banyak node allocation dan pointer chasing. `ArrayDeque` biasanya lebih memory/cache friendly.

---

## 15. BFS dengan Distance

BFS sering dipakai untuk menghitung jarak minimum dalam unweighted graph.

```java
public static <V> Map<V, Integer> bfsDistance(V start, Map<V, ? extends Iterable<V>> graph) {
    Map<V, Integer> distance = new LinkedHashMap<>();
    ArrayDeque<V> queue = new ArrayDeque<>();

    distance.put(start, 0);
    queue.addLast(start);

    while (!queue.isEmpty()) {
        V current = queue.removeFirst();
        int currentDistance = distance.get(current);

        for (V neighbor : graph.getOrDefault(current, List.of())) {
            if (!distance.containsKey(neighbor)) {
                distance.put(neighbor, currentDistance + 1);
                queue.addLast(neighbor);
            }
        }
    }

    return distance;
}
```

Di sini `distance.containsKey(neighbor)` berperan sebagai visited check.

Use case:

- berapa langkah transition dari `DRAFT` ke `APPROVED`;
- berapa dependency hop dari service A ke database X;
- berapa layer impact dari entity yang berubah;
- nearest valid handler dalam escalation graph.

---

## 16. BFS dengan Parent Reconstruction

Kadang kita tidak hanya butuh tahu node reachable, tapi juga path-nya.

```java
public static <V> List<V> shortestPathUnweighted(
        V start,
        V target,
        Map<V, ? extends Iterable<V>> graph
) {
    Map<V, V> parent = new LinkedHashMap<>();
    Set<V> visited = new HashSet<>();
    ArrayDeque<V> queue = new ArrayDeque<>();

    visited.add(start);
    queue.addLast(start);

    while (!queue.isEmpty()) {
        V current = queue.removeFirst();

        if (current.equals(target)) {
            return reconstructPath(start, target, parent);
        }

        for (V neighbor : graph.getOrDefault(current, List.of())) {
            if (visited.add(neighbor)) {
                parent.put(neighbor, current);
                queue.addLast(neighbor);
            }
        }
    }

    return List.of();
}

private static <V> List<V> reconstructPath(V start, V target, Map<V, V> parent) {
    ArrayDeque<V> reversed = new ArrayDeque<>();
    V current = target;

    while (!current.equals(start)) {
        reversed.addFirst(current);
        current = parent.get(current);
        if (current == null) {
            return List.of();
        }
    }

    reversed.addFirst(start);
    return List.copyOf(reversed);
}
```

Important invariant:

```text
parent[child] = node yang pertama kali menemukan child
```

Pada BFS unweighted graph, parent chain ini menghasilkan shortest path berdasarkan jumlah edge.

---

## 17. Depth-First Search / DFS

DFS mengeksplorasi sedalam mungkin sebelum backtrack.

Contoh:

```text
A -> B
A -> C
B -> D
D -> F
C -> E
E -> F
```

DFS dari A bisa menghasilkan:

```text
A, B, D, F, C, E
```

Urutan detail tergantung order neighbor.

DFS cocok untuk:

- cycle detection;
- connected component;
- topological sort;
- dependency validation;
- exploring all paths;
- tree/graph traversal;
- reachability;
- recursive domain expansion.

---

## 18. Recursive DFS

```java
public static <V> List<V> dfsRecursive(V start, Map<V, ? extends Iterable<V>> graph) {
    Set<V> visited = new HashSet<>();
    List<V> order = new ArrayList<>();
    dfs(start, graph, visited, order);
    return order;
}

private static <V> void dfs(
        V current,
        Map<V, ? extends Iterable<V>> graph,
        Set<V> visited,
        List<V> order
) {
    if (!visited.add(current)) {
        return;
    }

    order.add(current);

    for (V neighbor : graph.getOrDefault(current, List.of())) {
        dfs(neighbor, graph, visited, order);
    }
}
```

Recursive DFS sangat bersih secara kode.

Tapi ada risiko:

```text
graph depth besar -> call stack besar -> StackOverflowError
```

Untuk input tidak terpercaya atau graph bisa sangat dalam, prefer iterative DFS.

---

## 19. Iterative DFS dengan Stack

```java
public static <V> List<V> dfsIterative(V start, Map<V, ? extends Iterable<V>> graph) {
    Set<V> visited = new HashSet<>();
    ArrayDeque<V> stack = new ArrayDeque<>();
    List<V> order = new ArrayList<>();

    stack.addLast(start);

    while (!stack.isEmpty()) {
        V current = stack.removeLast();

        if (!visited.add(current)) {
            continue;
        }

        order.add(current);

        for (V neighbor : graph.getOrDefault(current, List.of())) {
            if (!visited.contains(neighbor)) {
                stack.addLast(neighbor);
            }
        }
    }

    return order;
}
```

Catatan:

- Stack memakai `ArrayDeque`.
- `addLast` + `removeLast` = LIFO.
- Mark visited saat pop/dequeue bisa membuat duplicate stack entries jika ada banyak parent.
- Untuk menghindari duplicate stack entries, bisa mark saat push.

Versi mark saat push:

```java
public static <V> List<V> dfsIterativeMarkOnPush(V start, Map<V, ? extends Iterable<V>> graph) {
    Set<V> visited = new HashSet<>();
    ArrayDeque<V> stack = new ArrayDeque<>();
    List<V> order = new ArrayList<>();

    visited.add(start);
    stack.addLast(start);

    while (!stack.isEmpty()) {
        V current = stack.removeLast();
        order.add(current);

        for (V neighbor : graph.getOrDefault(current, List.of())) {
            if (visited.add(neighbor)) {
                stack.addLast(neighbor);
            }
        }
    }

    return order;
}
```

Namun urutan DFS iterative bisa berbeda dari recursive DFS karena stack order. Jika butuh urutan identik, neighbor perlu didorong dalam reverse order.

---

## 20. DFS dan Traversal Order

Traversal graph sering dianggap deterministic, padahal tidak selalu.

Jika graph memakai:

```java
HashMap<V, Set<V>>
HashSet<V>
```

maka iteration order tidak boleh dijadikan contract.

Jika hasil harus stabil:

```java
LinkedHashMap<V, Set<V>>
LinkedHashSet<V>
```

atau sort neighbors:

```java
List<V> neighbors = new ArrayList<>(graph.getOrDefault(current, Set.of()));
neighbors.sort(comparator);
```

Trade-off:

- stable order memudahkan testing dan audit;
- sorting neighbor menambah cost;
- `LinkedHashSet` menambah memory dibanding `HashSet`;
- deterministic order sering layak untuk business systems.

---

## 21. Visited State: Core Correctness Boundary

Visited state adalah bagian paling penting dalam traversal graph.

Tanpa visited:

```text
A -> B -> C -> A
```

DFS/BFS akan infinite.

Dengan visited:

```text
A visited
B visited
C visited
A already visited, skip
```

---

## 22. Apa yang Dipakai sebagai Visited Key?

Pilihan visited key sangat penting.

### 22.1 Object sebagai Key

```java
Set<Node> visited = new HashSet<>();
```

Aman jika:

- `equals/hashCode` benar;
- fields yang dipakai equality immutable;
- object identity/logical equality sesuai maksud traversal.

Berbahaya jika:

- `equals/hashCode` mutable;
- dua object berbeda merepresentasikan entity yang sama tapi tidak equal;
- proxy/entity ORM punya equality aneh;
- object graph punya duplicate instance untuk ID yang sama.

---

### 22.2 ID sebagai Key

```java
Set<NodeId> visited = new HashSet<>();
```

Biasanya lebih aman.

Contoh:

```java
record ServiceId(String value) {}
record CaseId(String value) {}
record StateCode(String value) {}
```

ID key cocok karena:

- immutable;
- equality jelas;
- tidak tergantung object instance;
- serializable/loggable;
- traversal result mudah dipahami.

---

### 22.3 Identity-based Visited

Kadang kamu ingin visited berdasarkan object identity, bukan logical equality.

Contoh:

- debugging object reference graph;
- detecting cycle dalam actual object graph;
- traversing AST/object heap-like structure.

Gunakan identity map:

```java
Set<Node> visited = Collections.newSetFromMap(new IdentityHashMap<>());
```

Ini memakai `==`, bukan `equals`.

Tapi jangan gunakan ini untuk domain graph biasa kecuali memang itu maksudnya.

---

## 23. Connected Component

Connected component adalah kumpulan node yang saling terhubung dalam undirected graph.

Contoh:

```text
A -- B -- C

D -- E

F
```

Komponen:

```text
{A, B, C}
{D, E}
{F}
```

Implementation:

```java
public static <V> List<Set<V>> connectedComponents(Map<V, ? extends Iterable<V>> graph) {
    Set<V> visited = new HashSet<>();
    List<Set<V>> components = new ArrayList<>();

    for (V vertex : graph.keySet()) {
        if (visited.contains(vertex)) {
            continue;
        }

        Set<V> component = new LinkedHashSet<>();
        ArrayDeque<V> queue = new ArrayDeque<>();

        visited.add(vertex);
        queue.addLast(vertex);

        while (!queue.isEmpty()) {
            V current = queue.removeFirst();
            component.add(current);

            for (V neighbor : graph.getOrDefault(current, List.of())) {
                if (visited.add(neighbor)) {
                    queue.addLast(neighbor);
                }
            }
        }

        components.add(component);
    }

    return components;
}
```

Use case:

- duplicate entity grouping;
- account linkage cluster;
- related-party cluster;
- isolated service groups;
- disconnected workflow fragments.

---

## 24. Reachability

Reachability menjawab:

```text
Apakah target bisa dicapai dari start?
```

```java
public static <V> boolean isReachable(V start, V target, Map<V, ? extends Iterable<V>> graph) {
    if (start.equals(target)) {
        return true;
    }

    Set<V> visited = new HashSet<>();
    ArrayDeque<V> queue = new ArrayDeque<>();

    visited.add(start);
    queue.addLast(start);

    while (!queue.isEmpty()) {
        V current = queue.removeFirst();

        for (V neighbor : graph.getOrDefault(current, List.of())) {
            if (neighbor.equals(target)) {
                return true;
            }
            if (visited.add(neighbor)) {
                queue.addLast(neighbor);
            }
        }
    }

    return false;
}
```

Use case:

- apakah state `APPROVED` reachable dari `DRAFT`;
- apakah service A akhirnya bergantung pada database X;
- apakah permission X reachable dari role Y;
- apakah update entity A bisa berdampak pada entity B.

---

## 25. Cycle Awareness

Cycle detection akan dibahas lebih dalam pada Part 014, tapi part ini harus membangun awareness.

Bug umum:

```java
void traverse(Node node) {
    for (Node child : node.children()) {
        traverse(child);
    }
}
```

Ini aman untuk tree, tetapi tidak aman untuk graph.

Jika graph cyclic:

```text
A -> B -> C -> A
```

kode tersebut infinite recursion.

Minimal graph traversal harus punya visited:

```java
void traverse(Node node, Set<NodeId> visited) {
    if (!visited.add(node.id())) {
        return;
    }
    for (Node child : node.children()) {
        traverse(child, visited);
    }
}
```

Namun untuk mendeteksi cycle, visited saja tidak cukup. Kamu perlu state tambahan seperti:

- unvisited,
- visiting,
- visited.

Itu akan dibahas di Part 014.

---

## 26. Graph Traversal Complexity

Untuk adjacency list:

```text
BFS: O(V + E)
DFS: O(V + E)
```

Karena:

- setiap vertex dikunjungi maksimal sekali;
- setiap edge diperiksa maksimal sekali untuk directed graph atau dua kali untuk undirected representation.

Memory:

```text
Visited: O(V)
Queue/Stack: O(V) worst-case
Output: O(V) jika menyimpan order
```

Tapi Java real cost tergantung:

- object allocation;
- boxing;
- hash cost;
- `equals` cost;
- neighbor collection type;
- deterministic order requirement;
- graph size;
- cache locality;
- duplicate edges;
- whether graph uses object keys or integer keys.

---

## 27. Java-Specific Cost Model untuk Graph

### 27.1 `Map<V, Set<V>>` Mudah Tapi Berat

```java
Map<V, Set<V>> graph = new HashMap<>();
```

Kelebihan:

- simple;
- expressive;
- generic;
- good enough untuk banyak business graph.

Kekurangan:

- banyak object;
- hash overhead;
- pointer chasing;
- memory overhead tinggi;
- `equals/hashCode` sering dipanggil;
- tidak ideal untuk million-scale traversal.

---

### 27.2 `Map<V, List<V>>` Lebih Ringan Tapi Edge Check Lambat

```java
Map<V, List<V>> graph = new HashMap<>();
```

Kelebihan:

- neighbor iteration cepat;
- memory lebih rendah daripada set;
- ordering natural;
- cocok jika graph sudah deduplicated upstream.

Kekurangan:

- duplicate edge mungkin muncul;
- edge existence check O(degree);
- perlu validasi tambahan jika uniqueness penting.

---

### 27.3 Integer Graph Lebih Cepat untuk Skala Besar

```java
int[][] graph;
boolean[] visited;
int[] queue;
```

Kelebihan:

- primitive;
- locality lebih baik;
- tidak ada hashing per traversal;
- allocation lebih terkendali.

Kekurangan:

- lebih sulit dibaca;
- mapping ID-index wajib;
- kurang fleksibel.

Top-tier engineering sering memakai dua lapis:

```text
Readable domain graph for business correctness.
Compiled integer graph for hot algorithm path.
```

---

## 28. Example: Workflow State Graph

Misalnya kita punya workflow:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
REJECTED -> DRAFT
```

Representasi:

```java
record State(String code) {}

public final class WorkflowGraph {
    private final Map<State, Set<State>> transitions = new LinkedHashMap<>();

    public void allow(State from, State to) {
        transitions.computeIfAbsent(from, ignored -> new LinkedHashSet<>()).add(to);
        transitions.computeIfAbsent(to, ignored -> new LinkedHashSet<>());
    }

    public boolean canTransition(State from, State to) {
        return transitions.getOrDefault(from, Set.of()).contains(to);
    }

    public boolean canEventuallyReach(State from, State target) {
        return isReachable(from, target, transitions);
    }
}
```

Pertanyaan yang bisa dijawab:

```java
workflow.canTransition(DRAFT, SUBMITTED);
workflow.canEventuallyReach(REJECTED, APPROVED);
```

Ini lebih powerful daripada `switch-case` biasa karena graph bisa dianalisis.

---

## 29. Example: Service Dependency Impact Analysis

```java
record Service(String name) {}

Map<Service, Set<Service>> dependsOn = new LinkedHashMap<>();
```

Jika edge berarti:

```text
A -> B means A depends on B
```

Maka dari `A`, traversal outgoing menjawab:

```text
A membutuhkan siapa saja?
```

Tapi jika `B` down, siapa terdampak?

Kamu butuh reverse graph:

```java
static <V> Map<V, Set<V>> reverse(Map<V, ? extends Iterable<V>> graph) {
    Map<V, Set<V>> reversed = new LinkedHashMap<>();

    for (V from : graph.keySet()) {
        reversed.computeIfAbsent(from, ignored -> new LinkedHashSet<>());
        for (V to : graph.getOrDefault(from, List.of())) {
            reversed.computeIfAbsent(to, ignored -> new LinkedHashSet<>()).add(from);
            reversed.computeIfAbsent(from, ignored -> new LinkedHashSet<>());
        }
    }

    return reversed;
}
```

Jika:

```text
CaseService -> PaymentService
PaymentService -> ExternalGateway
```

Reverse:

```text
ExternalGateway -> PaymentService
PaymentService -> CaseService
```

Traversal dari `ExternalGateway` pada reverse graph menghasilkan semua impacted upstream services.

---

## 30. Example: Permission Expansion

```text
User U1 -> Role Manager
Role Manager -> Permission APPROVE_CASE
Role Manager -> Role Reviewer
Role Reviewer -> Permission VIEW_CASE
```

Graph bisa dipakai untuk expand semua permission reachable.

```java
public static <V> Set<V> reachableSet(V start, Map<V, ? extends Iterable<V>> graph) {
    Set<V> visited = new LinkedHashSet<>();
    ArrayDeque<V> queue = new ArrayDeque<>();

    visited.add(start);
    queue.addLast(start);

    while (!queue.isEmpty()) {
        V current = queue.removeFirst();

        for (V neighbor : graph.getOrDefault(current, List.of())) {
            if (visited.add(neighbor)) {
                queue.addLast(neighbor);
            }
        }
    }

    return visited;
}
```

Namun authorization graph punya risiko besar:

- role inheritance cycle;
- privilege escalation;
- duplicate permission;
- stale graph snapshot;
- inconsistent revocation.

Maka graph expansion harus disertai validation dan audit.

---

## 31. Graph Builder yang Lebih Defensif

Graph sering dibangun dari data eksternal. Maka builder harus menjaga invariants.

```java
public final class ImmutableDirectedGraph<V> {
    private final Map<V, Set<V>> outgoing;

    private ImmutableDirectedGraph(Map<V, Set<V>> outgoing) {
        Map<V, Set<V>> copy = new LinkedHashMap<>();
        for (Map.Entry<V, Set<V>> entry : outgoing.entrySet()) {
            copy.put(entry.getKey(), Set.copyOf(entry.getValue()));
        }
        this.outgoing = Map.copyOf(copy);
    }

    public Set<V> vertices() {
        return outgoing.keySet();
    }

    public Set<V> neighborsOf(V vertex) {
        return outgoing.getOrDefault(vertex, Set.of());
    }

    public static final class Builder<V> {
        private final Map<V, Set<V>> outgoing = new LinkedHashMap<>();

        public Builder<V> addVertex(V vertex) {
            Objects.requireNonNull(vertex, "vertex");
            outgoing.computeIfAbsent(vertex, ignored -> new LinkedHashSet<>());
            return this;
        }

        public Builder<V> addEdge(V from, V to) {
            Objects.requireNonNull(from, "from");
            Objects.requireNonNull(to, "to");
            addVertex(from);
            addVertex(to);
            outgoing.get(from).add(to);
            return this;
        }

        public ImmutableDirectedGraph<V> build() {
            return new ImmutableDirectedGraph<>(outgoing);
        }
    }
}
```

Catatan:

- `Objects.requireNonNull` mencegah ambiguity `null` vertex.
- `to` vertex tetap didaftarkan.
- hasil build immutable/snapshot.
- cocok untuk config graph, workflow graph, dependency graph yang tidak sering berubah.

---

## 32. Pitfall: Missing Sink Vertices

Bug:

```java
for (Edge<V> edge : edges) {
    graph.computeIfAbsent(edge.from(), ignored -> new HashSet<>()).add(edge.to());
}
```

Jika node hanya muncul sebagai `to`, ia tidak ada dalam `graph.keySet()`.

Akibat:

- vertex count salah;
- terminal node hilang;
- connected component salah;
- topological sort salah;
- report incomplete.

Correct:

```java
graph.computeIfAbsent(edge.from(), ignored -> new HashSet<>()).add(edge.to());
graph.computeIfAbsent(edge.to(), ignored -> new HashSet<>());
```

---

## 33. Pitfall: Mutating Graph During Traversal

Jangan sembarangan modify graph saat sedang traversal.

Contoh berbahaya:

```java
for (V neighbor : graph.get(current)) {
    if (shouldAddMore(neighbor)) {
        graph.get(current).add(newNeighbor);
    }
}
```

Masalah:

- `ConcurrentModificationException`;
- traversal tidak deterministic;
- edge baru ikut/tidak ikut tergantung timing;
- infinite expansion;
- sulit diuji.

Pilihan desain:

1. traversal atas snapshot immutable;
2. collect mutation lalu apply setelah traversal;
3. gunakan work queue eksplisit untuk dynamic expansion;
4. dokumentasikan semantics: apakah edge baru harus diproses dalam traversal yang sama?

---

## 34. Pitfall: Recursive DFS pada Graph Tidak Terpercaya

Jika graph depth bisa besar, recursive DFS riskan.

```java
private void dfs(V node) {
    for (V next : graph.get(node)) {
        dfs(next);
    }
}
```

Risiko:

```text
StackOverflowError
```

Untuk graph dari database/user/config besar, iterative traversal lebih aman.

---

## 35. Pitfall: Duplicate Edges

Jika memakai list:

```java
A: B, B, B
```

Traversal dengan visited tetap benar, tapi:

- edge scan membengkak;
- metrics degree salah;
- edge count salah;
- algorithm berbasis in-degree bisa salah jika duplicate tidak dimaksudkan.

Jika domain relation unique, gunakan `Set` atau deduplicate saat build.

---

## 36. Pitfall: Wrong Edge Direction

Ini salah satu bug paling mahal.

Misalnya:

```text
A depends on B
```

Ada dua pilihan edge:

```text
A -> B   means A depends on B
B -> A   means B is required by A / B impacts A
```

Keduanya valid, tapi pertanyaan traversal berbeda.

Jika edge direction tidak didefinisikan eksplisit, tim akan salah membaca graph.

Selalu dokumentasikan:

```text
Edge X -> Y means X depends on Y.
```

atau:

```text
Edge X -> Y means X can transition to Y.
```

atau:

```text
Edge X -> Y means change in X propagates to Y.
```

Jangan hanya menulis `graph` tanpa semantic contract.

---

## 37. Pitfall: Equality Mismatch

Graph key memakai `HashMap`/`HashSet`, maka `equals/hashCode` menentukan identitas vertex.

Bug:

```java
record ServiceNode(String name, String owner) {}
```

Jika owner berubah, logical vertex berubah.

Mungkin yang benar:

```java
record ServiceId(String name) {}
```

lalu metadata owner disimpan terpisah:

```java
Map<ServiceId, ServiceMetadata> metadataByService;
```

Prinsip:

> Vertex identity harus stabil. Metadata boleh berubah.

---

## 38. Graph API Design Checklist

Saat mendesain graph API, jawab pertanyaan ini:

1. Apakah graph directed atau undirected?
2. Apa arti edge `A -> B`?
3. Apakah duplicate edge valid?
4. Apakah self-loop valid?
5. Apakah cycle valid?
6. Apakah vertex boleh ada tanpa edge?
7. Apakah traversal order harus deterministic?
8. Apakah graph mutable atau immutable?
9. Apakah graph dibangun dari trusted source?
10. Apakah graph perlu edge metadata?
11. Apakah graph size kecil, sedang, atau besar?
12. Apakah vertex identity object atau ID?
13. Apakah traversal harus return order, set, path, distance, atau parent map?
14. Apakah traversal boleh partial jika ada error?
15. Apakah graph perlu reverse index?

---

## 39. Testing Graph Code

Graph code harus dites bukan hanya happy path.

### 39.1 Test Empty Graph

```text
graph kosong
start tidak ada
```

Expected behavior harus jelas:

- return empty?
- throw exception?
- treat start as isolated vertex?

---

### 39.2 Test Single Vertex

```text
A
```

BFS/DFS dari A harus return `[A]`.

---

### 39.3 Test Simple Chain

```text
A -> B -> C
```

Reachability:

```text
A reaches C = true
C reaches A = false
```

---

### 39.4 Test Branching

```text
A -> B
A -> C
B -> D
C -> E
```

Pastikan traversal tidak skip branch.

---

### 39.5 Test Diamond

```text
A -> B
A -> C
B -> D
C -> D
```

Pastikan D hanya diproses sekali.

---

### 39.6 Test Cycle

```text
A -> B -> C -> A
```

Pastikan traversal terminate.

---

### 39.7 Test Disconnected Components

```text
A -> B
C -> D
E
```

Pastikan component detection benar.

---

### 39.8 Test Sink Vertex

```text
A -> B
```

Pastikan B tetap masuk vertex set.

---

### 39.9 Test Deterministic Order

Jika order penting, gunakan `LinkedHashMap`/`LinkedHashSet` atau sorting.

Test harus tidak bergantung pada accidental `HashMap` order.

---

## 40. Production Design Pattern: Graph Snapshot

Untuk config/workflow/dependency graph, pattern yang aman:

1. Load raw data.
2. Validate raw data.
3. Build graph mutable sementara.
4. Validate graph invariants.
5. Build immutable snapshot.
6. Publish snapshot atomically.
7. Traversal hanya membaca snapshot.

Contoh:

```text
Database rows -> Edge list -> Mutable builder -> Validation -> Immutable graph snapshot
```

Kelebihan:

- traversal thread-safe;
- tidak ada mutation saat traversal;
- debugging lebih mudah;
- bisa versioning;
- rollback lebih mudah;
- cocok untuk workflow/rule engine.

---

## 41. Production Design Pattern: Forward and Reverse Index

Untuk graph directed, sering perlu dua index:

```java
Map<V, Set<V>> outgoing;
Map<V, Set<V>> incoming;
```

Outgoing menjawab:

```text
Dari A, A menunjuk ke siapa?
```

Incoming menjawab:

```text
Siapa yang menunjuk ke A?
```

Contoh service dependency:

- outgoing: dependencies;
- incoming: dependents/impacted services.

Build bersamaan:

```java
public final class DirectedGraphIndex<V> {
    private final Map<V, Set<V>> outgoing = new LinkedHashMap<>();
    private final Map<V, Set<V>> incoming = new LinkedHashMap<>();

    public void addEdge(V from, V to) {
        outgoing.computeIfAbsent(from, ignored -> new LinkedHashSet<>()).add(to);
        outgoing.computeIfAbsent(to, ignored -> new LinkedHashSet<>());

        incoming.computeIfAbsent(to, ignored -> new LinkedHashSet<>()).add(from);
        incoming.computeIfAbsent(from, ignored -> new LinkedHashSet<>());
    }

    public Set<V> outgoingOf(V vertex) {
        return outgoing.getOrDefault(vertex, Set.of());
    }

    public Set<V> incomingOf(V vertex) {
        return incoming.getOrDefault(vertex, Set.of());
    }
}
```

---

## 42. Production Design Pattern: Bounded Traversal

Tidak semua traversal boleh eksplorasi seluruh graph.

Kadang kamu perlu limit:

- max depth;
- max nodes;
- timeout;
- allowed relation type;
- stop predicate.

Contoh bounded BFS:

```java
public static <V> Set<V> reachableWithinDepth(
        V start,
        int maxDepth,
        Map<V, ? extends Iterable<V>> graph
) {
    if (maxDepth < 0) {
        throw new IllegalArgumentException("maxDepth must be >= 0");
    }

    Set<V> visited = new LinkedHashSet<>();
    Map<V, Integer> depth = new HashMap<>();
    ArrayDeque<V> queue = new ArrayDeque<>();

    visited.add(start);
    depth.put(start, 0);
    queue.addLast(start);

    while (!queue.isEmpty()) {
        V current = queue.removeFirst();
        int currentDepth = depth.get(current);

        if (currentDepth == maxDepth) {
            continue;
        }

        for (V neighbor : graph.getOrDefault(current, List.of())) {
            if (visited.add(neighbor)) {
                depth.put(neighbor, currentDepth + 1);
                queue.addLast(neighbor);
            }
        }
    }

    return visited;
}
```

Use case:

- only show impact up to 3 layers;
- limit dependency visualization;
- avoid expensive expansion;
- safety guard for user-triggered traversal.

---

## 43. Production Design Pattern: Relation-Typed Graph

Kadang edge punya type.

```java
enum RelationType {
    DEPENDS_ON,
    CALLS,
    OWNS,
    REFERENCES,
    CAN_TRANSITION_TO
}

record TypedEdge<V>(V from, V to, RelationType type) {}
```

Traversal mungkin hanya mengikuti type tertentu:

```java
public static <V> Set<V> reachableByRelation(
        V start,
        RelationType allowedType,
        Map<V, List<TypedEdge<V>>> outgoing
) {
    Set<V> visited = new LinkedHashSet<>();
    ArrayDeque<V> queue = new ArrayDeque<>();

    visited.add(start);
    queue.addLast(start);

    while (!queue.isEmpty()) {
        V current = queue.removeFirst();

        for (TypedEdge<V> edge : outgoing.getOrDefault(current, List.of())) {
            if (edge.type() != allowedType) {
                continue;
            }
            if (visited.add(edge.to())) {
                queue.addLast(edge.to());
            }
        }
    }

    return visited;
}
```

Ini penting jika satu graph mencampur banyak relation.

Namun hati-hati: graph terlalu generic bisa menjadi sulit dipahami. Kadang lebih baik punya beberapa graph spesifik:

```text
serviceDependencyGraph
workflowTransitionGraph
entityReferenceGraph
permissionInheritanceGraph
```

Daripada satu “super graph” yang semua edge-nya dicampur.

---

## 44. Mini Case Study: Enforcement Case Impact Graph

Misalnya domain punya entity:

```text
Case
Party
Document
Investigation
EnforcementAction
Appeal
```

Relation:

```text
Case -> Party
Case -> Document
Case -> Investigation
Investigation -> EnforcementAction
EnforcementAction -> Appeal
Document -> ExternalReference
```

Pertanyaan:

1. Jika party berubah, case mana terdampak?
2. Jika document invalid, enforcement action mana perlu recheck?
3. Jika appeal decision berubah, apakah case parent perlu update?
4. Jika external reference dicabut, node apa saja terdampak?

Desain graph:

```java
record EntityRef(String type, String id) {}

enum RelationType {
    HAS_PARTY,
    HAS_DOCUMENT,
    HAS_INVESTIGATION,
    PRODUCES_ACTION,
    HAS_APPEAL,
    REFERENCES_EXTERNAL,
    IMPACTS
}

record EntityEdge(EntityRef from, EntityRef to, RelationType type) {}
```

Untuk impact analysis, direction edge harus jelas.

Ada dua model:

### Model A — Structural Relation

```text
Case -> Document
```

Artinya Case punya Document.

Jika Document berubah, kita butuh reverse graph untuk mencari Case.

### Model B — Impact Relation

```text
Document -> Case
```

Artinya perubahan Document berdampak ke Case.

Lebih mudah untuk impact traversal, tapi kurang natural untuk structural modelling.

Top-tier design sering menyimpan structural relation lalu membangun derived impact index.

```text
Structural graph: source of truth
Impact graph: derived index optimized for query
```

---

## 45. Mini Case Study: Workflow Reachability Validation

Workflow definition:

```text
DRAFT -> SUBMITTED
SUBMITTED -> REVIEW
REVIEW -> APPROVED
REVIEW -> REJECTED
REJECTED -> DRAFT
CANCELLED
```

`CANCELLED` tidak punya incoming edge dari mana pun.

Validation:

1. Semua state harus terdaftar.
2. Initial state harus ada.
3. Semua non-deprecated state harus reachable dari initial state.
4. Terminal states harus diketahui.
5. Transition backward harus explicit.
6. Cycle harus allowed atau rejected berdasarkan policy.

Reachability check:

```java
Set<State> reachable = reachableSet(initialState, transitions);
Set<State> unreachable = new LinkedHashSet<>(allStates);
unreachable.removeAll(reachable);
```

Jika `unreachable` tidak kosong, workflow punya dead configuration.

---

## 46. Design Heuristic: Graph atau Bukan?

Gunakan graph jika problem punya kata-kata seperti:

- depends on,
- references,
- reachable,
- connected,
- impacts,
- transition,
- prerequisite,
- parent/child with sharing,
- upstream/downstream,
- cycle,
- route,
- hierarchy with multiple parent,
- inheritance,
- permission expansion,
- propagation.

Jangan pakai graph jika problem cukup:

- lookup satu key ke satu value → map;
- urutan linear → list/deque;
- hierarchy murni satu parent → tree;
- priority selection → heap;
- range lookup → sorted map/tree;
- membership only → set.

Namun sering kali sistem nyata memakai kombinasi:

```text
Map for vertex metadata
Adjacency list for graph topology
PriorityQueue for scheduled traversal
TreeMap for time-based query
Set for visited state
```

---

## 47. Engineering Checklist Sebelum Implementasi Graph

Sebelum menulis kode graph, jawab:

```text
1. Apa vertex identity-nya?
2. Apa arti edge direction?
3. Directed atau undirected?
4. Weighted atau unweighted?
5. Edge duplicate boleh atau tidak?
6. Self-loop boleh atau tidak?
7. Cycle valid atau invalid?
8. Graph sparse atau dense?
9. Operasi dominan: traversal, edge check, update, path, component?
10. Perlu deterministic order?
11. Perlu reverse lookup?
12. Perlu immutable snapshot?
13. Graph dibangun dari mana?
14. Bagaimana validasi graph?
15. Bagaimana failure dilaporkan?
```

Jika kamu tidak bisa menjawab nomor 1 dan 2, implementasi graph hampir pasti akan membingungkan.

---

## 48. Latihan Implementasi

### Latihan 1 — Basic Directed Graph

Buat `DirectedGraph<V>` dengan operasi:

```java
addVertex(V vertex)
addEdge(V from, V to)
neighborsOf(V vertex)
vertices()
```

Invariants:

- vertex `to` harus tetap terdaftar;
- duplicate edge tidak boleh;
- null vertex ditolak;
- traversal order deterministic.

---

### Latihan 2 — BFS Distance

Implementasikan BFS yang mengembalikan:

```java
Map<V, Integer> distanceFromStart
```

Test dengan graph:

```text
A -> B
A -> C
B -> D
C -> D
D -> E
```

Expected:

```text
A = 0
B = 1
C = 1
D = 2
E = 3
```

---

### Latihan 3 — Reverse Graph

Dari graph:

```text
A -> B
A -> C
D -> C
```

Bangun reverse:

```text
B -> A
C -> A, D
A -> 
D -> 
```

Pastikan sink/source vertices tidak hilang.

---

### Latihan 4 — Connected Component

Untuk undirected graph:

```text
A -- B
C -- D
E
```

Return:

```text
[{A,B}, {C,D}, {E}]
```

Urutan boleh deterministic jika memakai `LinkedHashMap`/`LinkedHashSet`.

---

### Latihan 5 — Workflow Reachability

Given:

```text
DRAFT -> SUBMITTED
SUBMITTED -> REVIEW
REVIEW -> APPROVED
REVIEW -> REJECTED
CANCELLED
```

Find unreachable states from `DRAFT`.

Expected:

```text
CANCELLED
```

---

## 49. Summary Mental Model

Graph adalah struktur untuk **relation topology**.

Yang harus kamu ingat:

1. Vertex adalah entity.
2. Edge adalah relation.
3. Edge direction harus punya makna eksplisit.
4. Tree adalah graph khusus; graph bukan tree.
5. Banyak domain yang tampak seperti tree sebenarnya DAG atau cyclic graph.
6. Adjacency list adalah default representation untuk sparse graph.
7. Adjacency matrix cocok untuk graph kecil/dense dan edge check cepat.
8. Edge list cocok untuk storage/import, bukan traversal intensif.
9. Object graph natural tapi rawan cycle, equality bug, dan memory overhead.
10. ID graph sering lebih aman daripada object graph.
11. BFS cocok untuk layer, distance, shortest path unweighted.
12. DFS cocok untuk deep exploration, cycle-related algorithm, dan dependency validation.
13. Traversal graph hampir selalu butuh visited state.
14. `ArrayDeque` adalah pilihan stack/queue non-concurrent yang baik di Java.
15. Graph production sering membutuhkan immutable snapshot, reverse index, bounded traversal, dan deterministic order.

---

## 50. Kapan Seri Ini Berlanjut?

Part ini adalah **Part 013 dari 030**.

Seri belum selesai.

Part berikutnya:

```text
Part 014 — Graph II: Shortest Path, Topological Sort, Dependency Resolution
```

Di Part 014 kita akan masuk ke graph algorithm yang lebih kuat:

- topological sort,
- dependency resolution,
- cycle detection dengan visiting state,
- Dijkstra,
- Bellman-Ford concept,
- Floyd-Warshall concept,
- Union-Find,
- path reconstruction,
- dan production use case seperti deployment order, rule dependency, migration graph, dan workflow validation.

---

## 51. Referensi

Referensi yang relevan untuk bagian ini:

1. Oracle Java SE Documentation — `ArrayDeque`, sebagai deque berbasis resizable array untuk queue/stack non-concurrent.
2. Oracle Java SE Documentation — `HashMap`, terutama konsep capacity/load factor dan unordered map semantics.
3. Oracle Java Collections Framework Overview, untuk memahami collection interfaces dan implementation trade-off.
4. Java `Map` API, sebagai dasar associative representation untuk adjacency list.
5. Literatur algoritma klasik untuk BFS/DFS, adjacency list, adjacency matrix, connected component, dan traversal graph.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 012 — Heap, PriorityQueue, Top-K, Scheduling](./learn-java-dsa-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 014 — Graph II: Shortest Path, Topological Sort, Dependency Resolution](./learn-java-dsa-part-014.md)
