# learn-java-dsa-part-014.md

# Part 014 — Graph II: Shortest Path, Topological Sort, Dependency Resolution

> Seri: **Java Data Structure and Algorithm**  
> Level: **Advanced / Engineering-Oriented**  
> Fokus: Graph algorithms untuk dependency resolution, workflow reachability, shortest path, cycle reporting, DSU, dan desain solusi Java yang production-ready.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 013, kita membangun fondasi graph:

- apa itu vertex dan edge,
- directed vs undirected graph,
- weighted vs unweighted graph,
- adjacency list, adjacency matrix, edge list,
- BFS,
- DFS,
- visited state,
- parent reconstruction,
- connected component,
- object graph vs ID graph.

Part 014 naik satu level: kita tidak lagi hanya bertanya:

> “Node mana saja yang bisa dicapai?”

Tetapi mulai bertanya:

> “Dalam urutan apa dependency harus diproses?”  
> “Apakah dependency ini valid atau cyclic?”  
> “Path termurah dari A ke B apa?”  
> “Kalau entity X berubah, entity mana yang terdampak?”  
> “Bagaimana melaporkan cycle dengan pesan error yang bisa dipahami manusia?”

Ini adalah bagian yang sangat penting untuk software engineer yang bekerja dengan:

- workflow engine,
- state machine,
- dependency graph,
- build/deployment pipeline,
- migration ordering,
- rule engine,
- approval chain,
- escalation flow,
- case management,
- domain lifecycle,
- impact analysis,
- data lineage,
- service dependency analysis.

Graph algorithms sering dianggap “materi interview”. Dalam sistem nyata, graph justru sering muncul sebagai bentuk alami dari relasi antar komponen. Bedanya, di production kita tidak cukup hanya menghasilkan jawaban benar; kita juga harus memikirkan:

- validasi input,
- error reporting,
- explainability,
- determinism,
- memory cost,
- partial failure,
- observability,
- concurrency boundary,
- dan evolusi domain.

---

## 1. Mental Model Utama

Graph algorithm pada dasarnya menjawab pertanyaan tentang **relasi** dan **propagasi**.

| Pertanyaan | Algoritma / Struktur Umum |
|---|---|
| Apakah A bergantung pada B? | DFS/BFS reachability |
| Apa semua hal yang terdampak jika A berubah? | Reverse graph traversal |
| Urutan proses dependency yang valid apa? | Topological sort |
| Apakah dependency graph valid atau cyclic? | Cycle detection |
| Kalau cyclic, cycle-nya di mana? | DFS recursion stack / parent tracking |
| Path termurah dari A ke B apa? | Dijkstra / Bellman-Ford |
| Semua jarak antar node? | Floyd-Warshall |
| Kelompok node yang tersambung? | DSU / connected component |
| Apakah menambahkan edge ini membuat cycle? | DSU untuk undirected graph, DFS/toposort untuk directed graph |
| Node mana yang punya dependency belum selesai? | Indegree tracking |
| Mana next executable task? | Queue dengan indegree nol |
| Mana next highest-priority executable task? | PriorityQueue + indegree |

Mental model yang penting:

> Graph bukan hanya struktur data. Graph adalah model kausalitas, dependency, reachability, dan constraint.

Ketika kamu melihat sistem production, banyak hal yang tampaknya “list of tasks” sebenarnya adalah graph:

```text
Database migration:
  create_table_user
  create_table_role
  create_table_user_role depends on user and role

Deployment:
  config-service before case-service
  auth-service before gateway

Workflow:
  Draft -> Submitted -> Reviewed -> Approved
  Reviewed -> Rejected
  Rejected -> Resubmitted

Rule engine:
  Rule B uses output from Rule A
  Rule C requires Rule B and Rule D
```

Kalau graph-nya salah, sistem bisa:

- menjalankan step dalam urutan salah,
- deadlock karena dependency cyclic,
- melewatkan impact,
- menghitung path yang salah,
- membuat workflow yang unreachable,
- atau menghasilkan proses yang tidak deterministic.

---

## 2. Directed Acyclic Graph atau DAG

Banyak graph dependency seharusnya berbentuk **DAG**.

DAG = Directed Acyclic Graph:

- directed: edge punya arah,
- acyclic: tidak ada cycle.

Contoh dependency:

```text
A -> B
```

Harus ditentukan artinya secara eksplisit. Dua konvensi umum:

### Konvensi 1 — Edge dari dependency ke dependent

```text
A -> B
```

Artinya:

> A harus selesai sebelum B.

Maka urutan valid: `A, B`.

Ini cocok untuk topological sort karena ketika indegree B menjadi nol, B siap diproses.

### Konvensi 2 — Edge dari dependent ke dependency

```text
B -> A
```

Artinya:

> B bergantung pada A.

Ini sering lebih natural saat membaca domain, tetapi untuk topological sort biasanya kita perlu reverse graph.

### Rule penting

Jangan pernah membiarkan arti edge implisit.

Dalam code production, beri nama yang jelas:

```java
Map<TaskId, List<TaskId>> dependentsByDependency;
Map<TaskId, List<TaskId>> dependenciesByTask;
```

Nama seperti ini lebih aman daripada:

```java
Map<TaskId, List<TaskId>> graph;
```

Karena `graph` tidak menjelaskan arah semantik edge.

---

## 3. Topological Sort

Topological sort menghasilkan urutan linear dari node dalam directed acyclic graph sehingga setiap dependency muncul sebelum node yang bergantung padanya.

Jika ada edge:

```text
A -> B
```

dan artinya A harus sebelum B, maka output topological sort harus menempatkan A sebelum B.

Contoh:

```text
compile-core -> compile-api
compile-api  -> compile-service
compile-db   -> compile-service
compile-service -> package-app
```

Salah satu topological order:

```text
compile-core
compile-db
compile-api
compile-service
package-app
```

Order tidak selalu unik. Jika dua node tidak saling bergantung, posisinya bisa berbeda.

### Use case nyata

Topological sort muncul di:

- build order,
- deployment order,
- database migration order,
- rule evaluation order,
- task scheduling,
- workflow validation,
- dependency injection initialization,
- module loading,
- ETL pipeline,
- data lineage computation.

---

## 4. Kahn’s Algorithm

Kahn’s algorithm adalah topological sort berbasis **indegree**.

Indegree = jumlah incoming edge ke sebuah node.

Jika edge `A -> B`, maka:

- A adalah dependency,
- B adalah dependent,
- indegree B bertambah 1.

Node dengan indegree 0 berarti:

> tidak ada dependency yang belum dipenuhi.

Algorithm:

1. Hitung indegree semua node.
2. Masukkan semua node dengan indegree 0 ke queue.
3. Ambil node dari queue.
4. Tambahkan ke hasil.
5. Untuk setiap dependent node tersebut:
   - kurangi indegree dependent,
   - jika indegree menjadi 0, masukkan ke queue.
6. Jika jumlah hasil < jumlah node, berarti ada cycle.

### Complexity

Untuk adjacency list:

```text
Time  : O(V + E)
Memory: O(V + E)
```

Dengan:

- V = jumlah vertex/node,
- E = jumlah edge.

### Implementasi Java: deterministic Kahn’s algorithm

Untuk production, determinism sering penting. Jika ada beberapa node dengan indegree 0, kita bisa menggunakan `PriorityQueue` atau sorted collection agar output stabil.

Misalnya task ID berupa string:

```java
import java.util.*;

public final class TopologicalSort {

    public static List<String> sort(Map<String, List<String>> dependentsByDependency) {
        Objects.requireNonNull(dependentsByDependency, "dependentsByDependency");

        Set<String> nodes = new HashSet<>();
        Map<String, Integer> indegree = new HashMap<>();

        for (Map.Entry<String, List<String>> entry : dependentsByDependency.entrySet()) {
            String from = requireNode(entry.getKey());
            nodes.add(from);
            indegree.putIfAbsent(from, 0);

            for (String to : entry.getValue()) {
                to = requireNode(to);
                nodes.add(to);
                indegree.merge(to, 1, Integer::sum);
                indegree.putIfAbsent(from, indegree.getOrDefault(from, 0));
            }
        }

        PriorityQueue<String> ready = new PriorityQueue<>();
        for (String node : nodes) {
            if (indegree.getOrDefault(node, 0) == 0) {
                ready.add(node);
            }
        }

        List<String> order = new ArrayList<>(nodes.size());

        while (!ready.isEmpty()) {
            String current = ready.poll();
            order.add(current);

            for (String next : dependentsByDependency.getOrDefault(current, List.of())) {
                int updated = indegree.merge(next, -1, Integer::sum);
                if (updated == 0) {
                    ready.add(next);
                }
            }
        }

        if (order.size() != nodes.size()) {
            throw new IllegalStateException("Dependency graph contains a cycle");
        }

        return order;
    }

    private static String requireNode(String node) {
        if (node == null || node.isBlank()) {
            throw new IllegalArgumentException("Node must not be null or blank");
        }
        return node;
    }
}
```

### Kenapa menggunakan `PriorityQueue`?

Jika menggunakan `ArrayDeque`, output topological sort bisa bergantung pada iteration order dari `HashMap` atau input list. Itu tidak selalu salah, tetapi sering mengganggu production debugging.

Dengan `PriorityQueue`, jika ada banyak node siap, node dengan ID terkecil dipilih dulu. Output menjadi lebih deterministic.

Trade-off:

```text
ArrayDeque     : O(V + E)
PriorityQueue  : O((V + E) log V) dalam kasus umum karena poll/add log V
```

Untuk banyak sistem bisnis, determinism sering lebih penting daripada selisih performa kecil. Untuk graph sangat besar, pilihannya perlu diukur.

---

## 5. DFS Topological Sort

Topological sort juga bisa dibuat dengan DFS.

Ide:

1. Visit node.
2. Visit semua outgoing neighbor.
3. Setelah semua neighbor selesai, masukkan node ke result.
4. Reverse result.

DFS topo sort natural untuk recursive reasoning, tetapi ada risiko:

- stack overflow pada graph besar/deep,
- cycle reporting perlu recursion state,
- urutan output tergantung iteration order.

### State warna

DFS biasanya memakai 3 warna:

```text
WHITE = belum dikunjungi
GRAY  = sedang di recursion stack
BLACK = selesai diproses
```

Jika saat DFS menemukan edge ke node `GRAY`, berarti ada cycle.

### Implementasi Java dengan cycle detection

```java
import java.util.*;

public final class DfsTopologicalSort {

    private enum Color {
        WHITE,
        GRAY,
        BLACK
    }

    public static List<String> sort(Map<String, List<String>> dependentsByDependency) {
        Objects.requireNonNull(dependentsByDependency, "dependentsByDependency");

        Set<String> nodes = collectNodes(dependentsByDependency);
        Map<String, Color> color = new HashMap<>();
        for (String node : nodes) {
            color.put(node, Color.WHITE);
        }

        List<String> result = new ArrayList<>(nodes.size());
        Deque<String> path = new ArrayDeque<>();

        List<String> sortedNodes = new ArrayList<>(nodes);
        Collections.sort(sortedNodes);

        for (String node : sortedNodes) {
            if (color.get(node) == Color.WHITE) {
                dfs(node, dependentsByDependency, color, result, path);
            }
        }

        Collections.reverse(result);
        return result;
    }

    private static void dfs(
            String current,
            Map<String, List<String>> graph,
            Map<String, Color> color,
            List<String> result,
            Deque<String> path
    ) {
        color.put(current, Color.GRAY);
        path.addLast(current);

        List<String> neighbors = new ArrayList<>(graph.getOrDefault(current, List.of()));
        Collections.sort(neighbors);

        for (String next : neighbors) {
            Color nextColor = color.getOrDefault(next, Color.WHITE);

            if (nextColor == Color.GRAY) {
                throw new IllegalStateException("Cycle detected: " + describeCycle(path, next));
            }

            if (nextColor == Color.WHITE) {
                dfs(next, graph, color, result, path);
            }
        }

        path.removeLast();
        color.put(current, Color.BLACK);
        result.add(current);
    }

    private static Set<String> collectNodes(Map<String, List<String>> graph) {
        Set<String> nodes = new HashSet<>();
        for (Map.Entry<String, List<String>> entry : graph.entrySet()) {
            nodes.add(entry.getKey());
            nodes.addAll(entry.getValue());
        }
        return nodes;
    }

    private static String describeCycle(Deque<String> path, String repeated) {
        List<String> cycle = new ArrayList<>();
        boolean insideCycle = false;

        for (String node : path) {
            if (node.equals(repeated)) {
                insideCycle = true;
            }
            if (insideCycle) {
                cycle.add(node);
            }
        }

        cycle.add(repeated);
        return String.join(" -> ", cycle);
    }
}
```

### Kapan DFS topo cocok?

Cocok ketika:

- graph tidak terlalu deep,
- cycle path perlu dilaporkan jelas,
- traversal logic lebih mudah ditulis recursive,
- dependency semantics lebih natural sebagai DFS.

Kurang cocok ketika:

- graph bisa sangat besar,
- depth tidak terkontrol,
- sistem menerima input untrusted,
- perlu streaming next-ready node,
- perlu incremental scheduling.

Untuk production, Kahn biasanya lebih aman untuk task execution karena naturally menghasilkan “ready queue”. DFS bagus untuk validation dan cycle diagnostics.

---

## 6. Cycle Detection dan Error Reporting

Dalam dependency graph, cycle bukan sekadar “invalid”. Cycle adalah error domain yang harus bisa dijelaskan.

Pesan buruk:

```text
Dependency graph contains a cycle.
```

Pesan lebih baik:

```text
Cycle detected: rule.age-check -> rule.eligibility -> rule.risk-score -> rule.age-check
```

Pesan yang baik mempercepat debugging.

### Jenis cycle berdasarkan domain

| Domain | Contoh cycle | Dampak |
|---|---|---|
| Migration | migration A depends on B, B depends on A | migration tidak bisa diurutkan |
| Rule engine | rule X memakai output Y, Y memakai output X | evaluation deadlock |
| Workflow | state transition guard kembali ke state yang membutuhkan guard awal | unreachable / infinite loop |
| Deployment | service A needs B ready, B needs A ready | startup deadlock |
| Entity sync | A sync triggers B, B triggers A | event loop |

### Cycle detection untuk directed graph

Gunakan DFS color:

- WHITE: unvisited,
- GRAY: visiting,
- BLACK: done.

Edge ke GRAY berarti back edge dan menunjukkan cycle.

### Cycle detection untuk undirected graph

Bisa menggunakan DFS dengan parent tracking atau DSU.

Untuk directed graph, DSU tidak cukup untuk mendeteksi directed cycle secara umum.

Ini sering menjadi kesalahan.

---

## 7. Dependency Resolution sebagai Engineering Problem

Topological sort hanya core algorithm. Dependency resolution production lebih luas.

Biasanya butuh pipeline:

```text
1. Parse input
2. Normalize node ID
3. Validate missing references
4. Validate duplicate edges
5. Validate self-dependency
6. Build graph
7. Detect cycle
8. Produce deterministic order
9. Explain why each node placed there
10. Execute or return plan
```

### Self-dependency

```text
A -> A
```

Ini cycle satu node. Jangan biarkan masuk diam-diam.

### Missing node

Contoh:

```text
rule-a depends on rule-b
```

Tapi `rule-b` tidak terdaftar.

Ada dua kemungkinan policy:

1. Auto-create node dari edge.
2. Treat as invalid missing dependency.

Untuk production, biasanya lebih aman treat sebagai invalid jika graph merepresentasikan konfigurasi eksplisit.

### Duplicate edge

```text
A -> B
A -> B
```

Jika tidak deduplicate, indegree B bisa bertambah 2 dan topological sort salah.

Karena itu adjacency sering lebih aman sebagai `Set`, bukan `List`, pada tahap build.

```java
Map<String, Set<String>> dependentsByDependency = new HashMap<>();
```

Lalu setelah validasi, convert ke immutable sorted list jika perlu determinism.

---

## 8. Desain Type untuk Graph Dependency

Menggunakan `String` langsung cepat untuk contoh, tetapi untuk sistem besar lebih baik type-safe.

Contoh `record`:

```java
public record TaskId(String value) implements Comparable<TaskId> {
    public TaskId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("TaskId must not be blank");
        }
    }

    @Override
    public int compareTo(TaskId other) {
        return this.value.compareTo(other.value);
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Dependency edge:

```java
public record DependencyEdge(TaskId dependency, TaskId dependent) {
    public DependencyEdge {
        Objects.requireNonNull(dependency, "dependency");
        Objects.requireNonNull(dependent, "dependent");
        if (dependency.equals(dependent)) {
            throw new IllegalArgumentException("Self dependency is not allowed: " + dependency);
        }
    }
}
```

Graph:

```java
public final class DependencyGraph {
    private final Set<TaskId> nodes;
    private final Map<TaskId, Set<TaskId>> dependentsByDependency;
    private final Map<TaskId, Set<TaskId>> dependenciesByTask;

    public DependencyGraph(
            Set<TaskId> nodes,
            Map<TaskId, Set<TaskId>> dependentsByDependency,
            Map<TaskId, Set<TaskId>> dependenciesByTask
    ) {
        this.nodes = Set.copyOf(nodes);
        this.dependentsByDependency = deepImmutableCopy(dependentsByDependency);
        this.dependenciesByTask = deepImmutableCopy(dependenciesByTask);
    }

    public Set<TaskId> nodes() {
        return nodes;
    }

    public Set<TaskId> dependentsOf(TaskId dependency) {
        return dependentsByDependency.getOrDefault(dependency, Set.of());
    }

    public Set<TaskId> dependenciesOf(TaskId task) {
        return dependenciesByTask.getOrDefault(task, Set.of());
    }

    private static Map<TaskId, Set<TaskId>> deepImmutableCopy(Map<TaskId, Set<TaskId>> input) {
        Map<TaskId, Set<TaskId>> copy = new HashMap<>();
        for (Map.Entry<TaskId, Set<TaskId>> entry : input.entrySet()) {
            copy.put(entry.getKey(), Set.copyOf(entry.getValue()));
        }
        return Map.copyOf(copy);
    }
}
```

### Kenapa punya dua map?

Karena dua pertanyaan berbeda:

```text
1. Kalau A selesai, siapa yang sekarang mungkin siap?     -> dependentsByDependency
2. Task X masih menunggu dependency apa?                  -> dependenciesByTask
```

Untuk Kahn’s algorithm, `dependentsByDependency` sangat berguna.

Untuk error reporting, `dependenciesByTask` sangat berguna.

---

## 9. Topological Sort dengan Error Model Lebih Kuat

Alih-alih langsung `throw IllegalStateException`, production code sering lebih baik mengembalikan result object.

```java
public sealed interface ResolutionResult permits ResolutionResult.Success, ResolutionResult.Cycle {

    record Success(List<TaskId> order) implements ResolutionResult {
        public Success {
            order = List.copyOf(order);
        }
    }

    record Cycle(List<TaskId> cyclePath) implements ResolutionResult {
        public Cycle {
            cyclePath = List.copyOf(cyclePath);
        }
    }
}
```

Namun Kahn’s algorithm hanya tahu bahwa cycle ada ketika result size kurang dari nodes size. Untuk path cycle yang jelas, kita bisa:

1. Jalankan Kahn.
2. Jika gagal, ambil remaining nodes.
3. Jalankan DFS cycle extraction pada subgraph remaining.

Ini memberi gabungan:

- Kahn untuk ordering,
- DFS untuk diagnostics.

### Skeleton resolver

```java
public final class DependencyResolver {

    public ResolutionResult resolve(DependencyGraph graph) {
        Objects.requireNonNull(graph, "graph");

        Map<TaskId, Integer> indegree = new HashMap<>();
        for (TaskId node : graph.nodes()) {
            indegree.put(node, graph.dependenciesOf(node).size());
        }

        PriorityQueue<TaskId> ready = new PriorityQueue<>();
        for (TaskId node : graph.nodes()) {
            if (indegree.get(node) == 0) {
                ready.add(node);
            }
        }

        List<TaskId> order = new ArrayList<>(graph.nodes().size());

        while (!ready.isEmpty()) {
            TaskId current = ready.poll();
            order.add(current);

            for (TaskId dependent : graph.dependentsOf(current)) {
                int updated = indegree.merge(dependent, -1, Integer::sum);
                if (updated == 0) {
                    ready.add(dependent);
                }
            }
        }

        if (order.size() == graph.nodes().size()) {
            return new ResolutionResult.Success(order);
        }

        Set<TaskId> unresolved = new HashSet<>(graph.nodes());
        unresolved.removeAll(order);
        List<TaskId> cycle = CycleExtractor.findCycle(graph, unresolved);
        return new ResolutionResult.Cycle(cycle);
    }
}
```

---

## 10. Shortest Path: Apa Masalah yang Dijawab?

Shortest path menjawab:

> Dari node awal ke node tujuan, jalur dengan total cost terkecil apa?

Cost tidak selalu jarak geografis. Dalam software system, cost bisa berupa:

- latency,
- risiko,
- effort,
- penalty,
- number of hops,
- fee,
- confidence loss,
- severity score,
- estimated processing time,
- transition cost.

Contoh graph weighted:

```text
A --5--> B
A --2--> C
C --1--> B
B --3--> D
C --9--> D
```

Shortest path dari A ke D:

```text
A -> C -> B -> D
cost = 2 + 1 + 3 = 6
```

Bukan:

```text
A -> C -> D
cost = 11
```

---

## 11. BFS sebagai Shortest Path untuk Unweighted Graph

Jika semua edge punya cost sama, BFS menghasilkan shortest path dalam jumlah edge.

Contoh:

```text
A -> B -> D
A -> C -> E -> D
```

Shortest path A ke D adalah:

```text
A -> B -> D
```

Karena 2 edge, bukan 3 edge.

### Implementasi BFS shortest path

```java
import java.util.*;

public final class UnweightedShortestPath {

    public static List<String> shortestPath(
            Map<String, List<String>> graph,
            String source,
            String target
    ) {
        Objects.requireNonNull(graph, "graph");
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(target, "target");

        Queue<String> queue = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        Map<String, String> parent = new HashMap<>();

        visited.add(source);
        queue.add(source);

        while (!queue.isEmpty()) {
            String current = queue.remove();

            if (current.equals(target)) {
                return reconstructPath(parent, source, target);
            }

            for (String next : graph.getOrDefault(current, List.of())) {
                if (visited.add(next)) {
                    parent.put(next, current);
                    queue.add(next);
                }
            }
        }

        return List.of();
    }

    private static List<String> reconstructPath(
            Map<String, String> parent,
            String source,
            String target
    ) {
        LinkedList<String> path = new LinkedList<>();
        String current = target;

        while (current != null) {
            path.addFirst(current);
            if (current.equals(source)) {
                return List.copyOf(path);
            }
            current = parent.get(current);
        }

        return List.of();
    }
}
```

### Complexity

```text
Time  : O(V + E)
Memory: O(V)
```

---

## 12. Dijkstra’s Algorithm

Dijkstra digunakan untuk shortest path pada graph dengan **non-negative edge weights**.

Jika ada negative edge, Dijkstra tidak valid.

Mental model:

- Simpan jarak terbaik sementara dari source ke setiap node.
- Selalu proses node dengan jarak terkecil yang belum final.
- Relax edge dari node tersebut.

Relaxation:

```text
if dist[current] + weight(current, next) < dist[next]
    dist[next] = dist[current] + weight(current, next)
    parent[next] = current
```

### Kenapa butuh priority queue?

Karena kita selalu ingin mengambil node dengan jarak sementara terkecil.

Di Java, ini natural memakai `PriorityQueue`.

### Representasi edge

```java
public record WeightedEdge(String to, long weight) {
    public WeightedEdge {
        Objects.requireNonNull(to, "to");
        if (weight < 0) {
            throw new IllegalArgumentException("Dijkstra does not allow negative weight: " + weight);
        }
    }
}
```

### Implementasi Dijkstra dengan lazy entry

Java `PriorityQueue` tidak menyediakan efficient decrease-key. Strategi umum:

- ketika distance membaik, tambahkan entry baru ke priority queue,
- ketika poll entry lama yang sudah stale, skip.

```java
import java.util.*;

public final class DijkstraShortestPath {

    public record WeightedEdge(String to, long weight) {
        public WeightedEdge {
            Objects.requireNonNull(to, "to");
            if (weight < 0) {
                throw new IllegalArgumentException("Negative weight is not allowed for Dijkstra: " + weight);
            }
        }
    }

    private record QueueEntry(String node, long distance) implements Comparable<QueueEntry> {
        @Override
        public int compareTo(QueueEntry other) {
            int byDistance = Long.compare(this.distance, other.distance);
            if (byDistance != 0) {
                return byDistance;
            }
            return this.node.compareTo(other.node);
        }
    }

    public record PathResult(long distance, List<String> path) {
        public PathResult {
            path = List.copyOf(path);
        }
    }

    public static Optional<PathResult> shortestPath(
            Map<String, List<WeightedEdge>> graph,
            String source,
            String target
    ) {
        Objects.requireNonNull(graph, "graph");
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(target, "target");

        Map<String, Long> distance = new HashMap<>();
        Map<String, String> parent = new HashMap<>();
        PriorityQueue<QueueEntry> pq = new PriorityQueue<>();

        distance.put(source, 0L);
        pq.add(new QueueEntry(source, 0L));

        while (!pq.isEmpty()) {
            QueueEntry entry = pq.poll();
            String current = entry.node();
            long currentDistance = entry.distance();

            if (currentDistance != distance.getOrDefault(current, Long.MAX_VALUE)) {
                continue; // stale queue entry
            }

            if (current.equals(target)) {
                return Optional.of(new PathResult(
                        currentDistance,
                        reconstructPath(parent, source, target)
                ));
            }

            for (WeightedEdge edge : graph.getOrDefault(current, List.of())) {
                long nextDistance = safeAdd(currentDistance, edge.weight());
                long oldDistance = distance.getOrDefault(edge.to(), Long.MAX_VALUE);

                if (nextDistance < oldDistance) {
                    distance.put(edge.to(), nextDistance);
                    parent.put(edge.to(), current);
                    pq.add(new QueueEntry(edge.to(), nextDistance));
                }
            }
        }

        return Optional.empty();
    }

    private static long safeAdd(long a, long b) {
        if (a > Long.MAX_VALUE - b) {
            return Long.MAX_VALUE;
        }
        return a + b;
    }

    private static List<String> reconstructPath(
            Map<String, String> parent,
            String source,
            String target
    ) {
        LinkedList<String> path = new LinkedList<>();
        String current = target;

        while (current != null) {
            path.addFirst(current);
            if (current.equals(source)) {
                return List.copyOf(path);
            }
            current = parent.get(current);
        }

        return List.of();
    }
}
```

### Complexity

Dengan adjacency list dan priority queue:

```text
Time  : O((V + E) log V)
Memory: O(V + E)
```

Dengan lazy entries, jumlah entry di priority queue bisa lebih dari V, tetapi tetap bounded oleh jumlah relaxation sukses, umumnya O(E).

### Failure mode Dijkstra

1. Negative weight dipakai diam-diam.
2. Overflow distance.
3. Comparator pakai subtraction:

```java
// buruk
return (int) (this.distance - other.distance);
```

4. Tidak skip stale queue entry.
5. Mengira `PriorityQueue` mendukung update priority otomatis.
6. Mutating object yang sudah berada di dalam priority queue.
7. Tidak melakukan path reconstruction.

---

## 13. Bellman-Ford

Bellman-Ford digunakan ketika graph bisa memiliki negative edge weight.

Ia juga bisa mendeteksi negative cycle.

Negative cycle berarti ada cycle dengan total cost negatif, sehingga shortest path tidak well-defined karena kita bisa terus mengitari cycle dan cost makin kecil.

Contoh:

```text
A -> B cost 1
B -> C cost -3
C -> A cost 1
```

Total cycle:

```text
1 + (-3) + 1 = -1
```

Kalau bisa mengulang cycle, cost bisa turun tanpa batas.

### Algorithm

1. Set distance source = 0.
2. Repeat V - 1 times:
   - relax semua edge.
3. Jalankan satu pass tambahan:
   - jika masih ada edge yang bisa direlax, ada negative cycle.

### Complexity

```text
Time  : O(V * E)
Memory: O(V)
```

Lebih lambat dari Dijkstra, tetapi lebih general.

### Kapan dipakai di sistem nyata?

Tidak sesering Dijkstra, tetapi berguna untuk:

- rule scoring dengan penalty negatif,
- arbitrage-like model,
- constraint system,
- graph yang bisa punya “reward” bukan hanya cost,
- validasi bahwa cost model tidak mengandung negative cycle.

### Skeleton implementasi

```java
public record Edge(String from, String to, long weight) {
    public Edge {
        Objects.requireNonNull(from, "from");
        Objects.requireNonNull(to, "to");
    }
}

public final class BellmanFord {

    public static Map<String, Long> shortestDistances(
            Set<String> nodes,
            List<Edge> edges,
            String source
    ) {
        Map<String, Long> dist = new HashMap<>();
        for (String node : nodes) {
            dist.put(node, Long.MAX_VALUE);
        }
        dist.put(source, 0L);

        for (int i = 0; i < nodes.size() - 1; i++) {
            boolean changed = false;

            for (Edge edge : edges) {
                long fromDistance = dist.getOrDefault(edge.from(), Long.MAX_VALUE);
                if (fromDistance == Long.MAX_VALUE) {
                    continue;
                }

                long candidate = fromDistance + edge.weight();
                if (candidate < dist.getOrDefault(edge.to(), Long.MAX_VALUE)) {
                    dist.put(edge.to(), candidate);
                    changed = true;
                }
            }

            if (!changed) {
                break;
            }
        }

        for (Edge edge : edges) {
            long fromDistance = dist.getOrDefault(edge.from(), Long.MAX_VALUE);
            if (fromDistance == Long.MAX_VALUE) {
                continue;
            }

            if (fromDistance + edge.weight() < dist.getOrDefault(edge.to(), Long.MAX_VALUE)) {
                throw new IllegalStateException("Negative cycle detected");
            }
        }

        return Map.copyOf(dist);
    }
}
```

---

## 14. Floyd-Warshall

Floyd-Warshall menghitung shortest path antar semua pasangan node.

Ia cocok untuk graph kecil sampai sedang dengan representasi matrix.

Algorithm idea:

```text
for each intermediate node k:
    for each source i:
        for each target j:
            dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j])
```

### Complexity

```text
Time  : O(V^3)
Memory: O(V^2)
```

Ini mahal untuk graph besar.

### Kapan masuk akal?

Cocok jika:

- jumlah node kecil,
- query shortest path antar node sangat sering,
- graph relatif static,
- precomputation acceptable.

Contoh:

- transition cost antar state kecil,
- route table kecil,
- rule category relation kecil,
- workflow state graph dengan puluhan state.

Tidak cocok untuk:

- service dependency ribuan node,
- social graph,
- graph event besar,
- runtime request path besar.

---

## 15. Minimum Spanning Tree Concept

Minimum Spanning Tree atau MST biasanya untuk undirected weighted graph.

Pertanyaan yang dijawab:

> Bagaimana menghubungkan semua node dengan total cost minimum tanpa cycle?

Contoh use case klasik:

- network cabling,
- road planning,
- clustering,
- approximate structure extraction.

Dalam enterprise software, MST tidak muncul sesering topological sort atau shortest path, tetapi konsepnya berguna untuk memahami:

- memilih minimal set dependency,
- menghindari redundant connection,
- membangun backbone relation,
- clustering graph.

Algoritma umum:

- Kruskal: sort edges by weight, gunakan DSU untuk menghindari cycle.
- Prim: grow tree dari satu node menggunakan priority queue.

---

## 16. Disjoint Set Union / Union-Find

DSU menyelesaikan problem grouping pada undirected relation.

Pertanyaan yang dijawab:

> Apakah A dan B berada dalam komponen yang sama?

Operasi utama:

```text
find(x)  -> representative/root dari group x
union(a, b) -> gabungkan group a dan b
```

Optimasi:

- path compression,
- union by rank/size.

### Implementasi Java berbasis index

```java
import java.util.*;

public final class DisjointSetUnion {
    private final int[] parent;
    private final int[] size;

    public DisjointSetUnion(int n) {
        if (n < 0) {
            throw new IllegalArgumentException("n must be non-negative");
        }
        this.parent = new int[n];
        this.size = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i;
            size[i] = 1;
        }
    }

    public int find(int x) {
        validate(x);
        if (parent[x] != x) {
            parent[x] = find(parent[x]);
        }
        return parent[x];
    }

    public boolean union(int a, int b) {
        int rootA = find(a);
        int rootB = find(b);

        if (rootA == rootB) {
            return false;
        }

        if (size[rootA] < size[rootB]) {
            int tmp = rootA;
            rootA = rootB;
            rootB = tmp;
        }

        parent[rootB] = rootA;
        size[rootA] += size[rootB];
        return true;
    }

    public boolean connected(int a, int b) {
        return find(a) == find(b);
    }

    public int componentSize(int x) {
        return size[find(x)];
    }

    private void validate(int x) {
        if (x < 0 || x >= parent.length) {
            throw new IndexOutOfBoundsException("Invalid index: " + x);
        }
    }
}
```

### DSU untuk arbitrary ID

Jika ID berupa string/object, gunakan coordinate compression:

```java
Map<String, Integer> indexById = new HashMap<>();
List<String> idByIndex = new ArrayList<>();
```

Saat menemukan ID baru:

```java
int indexOf(String id) {
    Integer existing = indexById.get(id);
    if (existing != null) {
        return existing;
    }
    int index = idByIndex.size();
    indexById.put(id, index);
    idByIndex.add(id);
    return index;
}
```

### DSU untuk cycle detection pada undirected graph

Untuk setiap edge `(a, b)`:

- jika `a` dan `b` sudah connected, edge ini membentuk cycle,
- jika belum, union.

```java
for (Edge edge : edges) {
    int a = indexOf(edge.from());
    int b = indexOf(edge.to());

    if (!dsu.union(a, b)) {
        throw new IllegalStateException("Undirected cycle detected: " + edge);
    }
}
```

### Penting

DSU sangat bagus untuk undirected connectivity.

Namun DSU bukan pengganti topological sort untuk directed dependency graph.

---

## 17. Graph Representation untuk Algoritma Lanjutan

Representasi yang benar menentukan sederhana atau rumitnya algoritma.

### 17.1 Adjacency list object-based

```java
Map<String, List<String>> graph;
```

Kelebihan:

- mudah dibaca,
- cocok untuk domain ID,
- fleksibel.

Kekurangan:

- overhead object tinggi,
- hashing cost,
- pointer chasing,
- kurang optimal untuk graph besar.

### 17.2 Adjacency list index-based

```java
List<int[]> neighbors;
```

Atau:

```java
int[][] adjacency;
```

Kelebihan:

- lebih compact,
- lebih cepat untuk graph besar,
- cache locality lebih baik.

Kekurangan:

- butuh mapping ID ke index,
- lebih sulit debug,
- kurang expressive.

### 17.3 Edge list

```java
List<Edge> edges;
```

Cocok untuk:

- Bellman-Ford,
- Kruskal,
- batch validation,
- import/export.

Kurang cocok untuk:

- BFS/DFS cepat,
- query neighbors berulang.

### 17.4 Reverse graph

Untuk impact analysis, reverse graph sering penting.

Jika original edge:

```text
A -> B
```

Artinya A diperlukan oleh B.

Reverse graph:

```text
B -> A
```

Bisa menjawab:

> Apa dependency langsung dari B?

Atau jika original adalah dependency-to-dependent, graph original menjawab:

> Jika A berubah, siapa yang terdampak?

Sistem production sering menyimpan dua arah agar query murah.

---

## 18. Impact Analysis

Impact analysis adalah bentuk traversal graph.

Pertanyaan:

> Jika node X berubah, node mana saja yang terdampak langsung atau tidak langsung?

Jika edge berarti:

```text
dependency -> dependent
```

Maka impact dari X adalah semua node reachable dari X.

### Implementasi sederhana

```java
public static Set<String> impactedNodes(
        Map<String, List<String>> dependentsByDependency,
        String changedNode
) {
    Set<String> impacted = new LinkedHashSet<>();
    Queue<String> queue = new ArrayDeque<>();

    queue.add(changedNode);

    while (!queue.isEmpty()) {
        String current = queue.remove();

        for (String dependent : dependentsByDependency.getOrDefault(current, List.of())) {
            if (impacted.add(dependent)) {
                queue.add(dependent);
            }
        }
    }

    return impacted;
}
```

### Kenapa `LinkedHashSet`?

Agar insertion order stabil berdasarkan traversal.

Dalam diagnostics, deterministic output membantu.

### Production extension

Impact analysis sering perlu metadata:

```text
node impacted because:
  changed config A
  -> rule B depends on config A
  -> workflow C depends on rule B
```

Maka simpan parent/reason:

```java
Map<String, String> impactedBy = new HashMap<>();
```

---

## 19. Workflow Reachability

State machine bisa dimodelkan sebagai directed graph.

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
REJECTED -> RESUBMITTED
RESUBMITTED -> UNDER_REVIEW
```

Pertanyaan yang bisa dijawab:

1. Apakah state `APPROVED` reachable dari `DRAFT`?
2. Apakah ada terminal state?
3. Apakah ada state unreachable?
4. Apakah ada cycle yang memang diizinkan?
5. Apakah transition tertentu membuat infinite loop risk?
6. Apakah setiap non-terminal state punya outgoing transition?
7. Apakah setiap state punya path ke terminal state?

### DAG tidak selalu cocok untuk workflow

Workflow bisa punya cycle yang valid:

```text
REJECTED -> RESUBMITTED -> UNDER_REVIEW -> REJECTED
```

Jadi jangan otomatis menganggap semua graph business harus DAG.

Yang perlu divalidasi bukan sekadar “tidak ada cycle”, tapi:

- cycle mana yang valid,
- cycle mana yang punya escape path,
- state mana yang terminal,
- state mana yang unreachable,
- state mana yang dead-end tidak diinginkan.

### Reachability dari initial state

```java
public static Set<String> reachableStates(
        Map<String, List<String>> transitions,
        String initialState
) {
    Set<String> reachable = new LinkedHashSet<>();
    Deque<String> stack = new ArrayDeque<>();
    stack.push(initialState);

    while (!stack.isEmpty()) {
        String current = stack.pop();
        if (!reachable.add(current)) {
            continue;
        }

        List<String> nextStates = transitions.getOrDefault(current, List.of());
        ListIterator<String> it = nextStates.listIterator(nextStates.size());
        while (it.hasPrevious()) {
            stack.push(it.previous());
        }
    }

    return reachable;
}
```

---

## 20. Strongly Connected Components Concept

Strongly Connected Component atau SCC adalah kelompok node dalam directed graph di mana setiap node bisa mencapai node lain dalam kelompok yang sama.

Contoh:

```text
A -> B
B -> C
C -> A
C -> D
```

A, B, C membentuk SCC.

D sendiri SCC terpisah.

### Kenapa SCC penting?

Untuk workflow dan dependency analysis:

- SCC ukuran > 1 berarti cycle group,
- SCC bisa dipadatkan menjadi satu node super,
- graph antar SCC selalu DAG,
- membantu memahami cyclic subsystem.

Dalam rule engine, SCC bisa berarti:

> sekelompok rule saling bergantung dan tidak bisa dievaluasi secara linear tanpa fixed-point iteration atau desain ulang.

Dalam workflow, SCC bisa berarti:

> sekelompok state membentuk loop yang mungkin valid, tetapi perlu escape path.

Algoritma populer:

- Tarjan,
- Kosaraju.

Part ini cukup memahami konsepnya. Implementasi detail SCC bisa dimasukkan dalam extension/capstone jika diperlukan.

---

## 21. Path Reconstruction

Banyak implementasi graph hanya mengembalikan `true/false` atau distance.

Production sering butuh path.

Contoh:

```text
Can service-order reach service-payment? true
```

Kurang berguna.

Lebih baik:

```text
service-order -> service-case -> service-billing -> service-payment
```

### Parent map

Path reconstruction biasanya memakai parent map:

```java
Map<Node, Node> parent;
```

Saat menemukan `next` dari `current`:

```java
parent.put(next, current);
```

Lalu reconstruct dari target mundur ke source.

### Untuk multiple paths

Jika butuh semua path, problem bisa meledak eksponensial.

Di production, sering lebih baik:

- return shortest path,
- return first deterministic path,
- return up to N paths,
- return summarized reachability,
- return explanation tree with cutoff.

Jangan expose “all paths” tanpa limit pada graph user-controlled.

---

## 22. Determinism dalam Graph Algorithm

Graph algorithm sering menghasilkan banyak output valid.

Contoh topological sort:

```text
A -> C
B -> C
```

Valid:

```text
A, B, C
B, A, C
```

Untuk interview, dua-duanya benar.

Untuk production, output tidak stabil bisa menyebabkan:

- test flaky,
- deployment order berubah tanpa alasan,
- diff konfigurasi noise,
- audit explanation tidak konsisten,
- cache key berubah,
- user bingung.

### Cara membuat deterministic

1. Sort node IDs sebelum traversal.
2. Gunakan `TreeMap`/`TreeSet` jika graph kecil/sedang dan determinism penting.
3. Gunakan `PriorityQueue` untuk ready nodes.
4. Jangan bergantung pada iteration order `HashMap`.
5. Canonicalize input.
6. Deduplicate edges.

### Trade-off

Determinism sering menambah biaya:

```text
sorting        : O(n log n)
PriorityQueue  : O(log n) per operation
TreeMap        : O(log n) access, bukan expected O(1)
```

Tetapi untuk banyak business graph, biaya itu wajar.

---

## 23. Weighted State Transition

Weighted graph bukan hanya untuk jarak.

Dalam workflow, edge bisa punya cost:

```text
DRAFT -> SUBMITTED        cost 1
SUBMITTED -> REVIEW       cost 2
REVIEW -> APPROVED        cost 1
REVIEW -> REJECTED        cost 1
REJECTED -> RESUBMITTED   cost 3
```

Cost bisa merepresentasikan:

- effort,
- SLA days,
- risk,
- penalty,
- approval level,
- operational cost.

Shortest path bisa menjawab:

> Jalur penyelesaian dengan effort minimum apa?

Longest path di DAG bisa menjawab:

> Critical path terpanjang apa?

Untuk DAG, shortest/longest path bisa dihitung dengan topological order lebih efisien daripada Dijkstra, jika graph acyclic.

---

## 24. Shortest Path in DAG

Jika graph adalah DAG, shortest path bisa dihitung dengan topological order.

Algorithm:

1. Topological sort.
2. Set distance source = 0.
3. Process nodes in topological order.
4. Relax outgoing edges.

Complexity:

```text
Time  : O(V + E)
Memory: O(V)
```

Lebih cepat dari Dijkstra untuk DAG.

### Kapan berguna?

- task pipeline cost,
- build stage optimization,
- migration plan,
- acyclic rule evaluation,
- acyclic dependency scheduling.

---

## 25. Longest Path in DAG

Longest path pada general graph sulit karena cycle bisa membuat path tak terbatas. Tetapi pada DAG, longest path bisa dihitung dengan topological order.

Use case:

- critical path analysis,
- maximum accumulated SLA,
- longest dependency chain,
- worst-case execution plan,
- project scheduling.

Algorithm mirip shortest path, tetapi pakai `max` bukan `min`.

```text
dist[next] = max(dist[next], dist[current] + weight)
```

Jika graph dependency punya duration per task, critical path membantu menemukan bottleneck.

---

## 26. Deployment Order Example

Misal service dependency:

```text
config -> auth
config -> case
auth   -> gateway
case   -> gateway
case   -> report
```

Artinya:

- config harus sebelum auth dan case,
- auth dan case harus sebelum gateway,
- case harus sebelum report.

Topological order deterministic:

```text
config
case
auth
gateway
report
```

Atau tergantung comparator, bisa:

```text
config
auth
case
gateway
report
```

Jika deploy bisa paralel, topological sort bisa dibagi menjadi levels.

### Levelized topological sort

Level 0: semua indegree 0.

```text
Level 0: config
Level 1: auth, case
Level 2: gateway, report
```

Ini berguna untuk batch execution.

```java
public static List<List<String>> topologicalLevels(Map<String, List<String>> graph) {
    Set<String> nodes = new HashSet<>();
    Map<String, Integer> indegree = new HashMap<>();

    for (Map.Entry<String, List<String>> entry : graph.entrySet()) {
        String from = entry.getKey();
        nodes.add(from);
        indegree.putIfAbsent(from, 0);
        for (String to : entry.getValue()) {
            nodes.add(to);
            indegree.merge(to, 1, Integer::sum);
        }
    }

    PriorityQueue<String> ready = new PriorityQueue<>();
    for (String node : nodes) {
        if (indegree.getOrDefault(node, 0) == 0) {
            ready.add(node);
        }
    }

    List<List<String>> levels = new ArrayList<>();
    int processed = 0;

    while (!ready.isEmpty()) {
        List<String> level = new ArrayList<>();
        int size = ready.size();

        for (int i = 0; i < size; i++) {
            level.add(ready.poll());
        }

        for (String current : level) {
            processed++;
            for (String next : graph.getOrDefault(current, List.of())) {
                int updated = indegree.merge(next, -1, Integer::sum);
                if (updated == 0) {
                    ready.add(next);
                }
            }
        }

        levels.add(List.copyOf(level));
    }

    if (processed != nodes.size()) {
        throw new IllegalStateException("Cycle detected");
    }

    return List.copyOf(levels);
}
```

### Production caution

Nodes dalam level yang sama boleh diproses paralel hanya jika:

- tidak ada hidden dependency,
- resource limit cukup,
- side effect aman,
- failure handling jelas,
- retry tidak merusak dependency semantics.

Topological level bukan otomatis izin paralel tanpa analisis operasional.

---

## 27. Migration Dependency Example

Database migration sering butuh dependency order.

Contoh:

```text
create_user_table
create_role_table
create_user_role_table depends on create_user_table, create_role_table
add_user_role_fk depends on create_user_role_table
seed_admin_role depends on create_role_table
```

Graph dependency-to-dependent:

```text
create_user_table      -> create_user_role_table
create_role_table      -> create_user_role_table
create_user_role_table -> add_user_role_fk
create_role_table      -> seed_admin_role
```

Topological sort bisa menghasilkan plan.

### Validasi tambahan

Migration dependency graph harus validasi:

- missing migration ID,
- duplicate migration ID,
- self dependency,
- cycle,
- dependency to disabled migration,
- environment-specific migration,
- irreversible migration order,
- rollback relation.

### Rollback graph

Rollback sering reverse dari apply order, tetapi tidak selalu sederhana.

Jika migration punya data destructive operation, rollback bisa butuh manual gate.

DSA memberi urutan, bukan menggantikan governance migration.

---

## 28. Rule Dependency Example

Rule engine sering punya dependency:

```text
age-rule -> eligibility-rule
income-rule -> eligibility-rule
eligibility-rule -> risk-rule
risk-rule -> approval-rule
```

Evaluation order:

```text
age-rule
income-rule
eligibility-rule
risk-rule
approval-rule
```

### Masalah umum

1. Rule output name ambiguous.
2. Rule A reads field produced by Rule B, tapi dependency tidak dideklarasikan.
3. Dependency cyclic.
4. Rule punya side effect sehingga evaluation order memengaruhi hasil.
5. Rule menggunakan global mutable context.
6. Rule disabled tetapi masih direferensikan.
7. Versioned rule dependency tidak konsisten.

### Design principle

Rule evaluation harus sebisa mungkin:

- pure,
- explicit dependency,
- deterministic,
- versioned,
- explainable.

Graph membantu membuat rule engine defensible.

---

## 29. Workflow Transition Validation Example

Dalam case management, state machine bisa direpresentasikan:

```java
Map<CaseState, Set<CaseState>> transitions;
```

Validasi:

1. Initial state exists.
2. Terminal states exist.
3. Semua states reachable dari initial.
4. Semua non-terminal states punya outgoing transition.
5. Semua states punya path ke terminal, kecuali explicitly long-running.
6. Cycle harus diklasifikasi:
   - allowed cycle,
   - suspicious cycle,
   - invalid cycle.

### Path to terminal

Untuk mengecek apakah state punya path ke terminal:

- reverse reasoning bisa dilakukan dari terminal states pada reverse graph.
- Semua state yang bisa mencapai terminal pada original graph adalah semua state reachable dari terminal pada reverse graph.

Algorithm:

1. Build reverse graph.
2. Start BFS dari terminal states.
3. Semua visited adalah states yang punya path ke terminal.
4. Non-visited states adalah trapped states.

---

## 30. Graph Algorithms dan API Design

Jangan expose struktur internal graph mentah jika domain butuh invariant.

Kurang baik:

```java
public Map<String, List<String>> getGraph() {
    return graph;
}
```

Masalah:

- caller bisa mutate,
- invariant rusak,
- duplicate edge masuk,
- null masuk,
- direction semantics tidak jelas.

Lebih baik:

```java
public interface DependencyView<N> {
    Set<N> nodes();
    Set<N> dependentsOf(N node);
    Set<N> dependenciesOf(N node);
}
```

Atau domain-specific:

```java
public interface WorkflowDefinition {
    Set<CaseState> states();
    Set<CaseState> nextStates(CaseState current);
    boolean isTerminal(CaseState state);
}
```

API harus mengekspresikan domain semantics, bukan hanya data structure.

---

## 31. Memory dan Performance Considerations di Java

### 31.1 Object graph overhead

Graph berbasis object:

```java
Map<Node, List<Edge>>
```

Mudah dibaca tetapi bisa mahal:

- setiap `Node` object punya overhead,
- setiap `Edge` object punya overhead,
- setiap list punya object/array,
- map punya bucket/node overhead,
- pointer chasing tinggi.

Untuk graph kecil/sedang, readability lebih penting.

Untuk graph besar, pertimbangkan index-based representation.

### 31.2 Boxing overhead

```java
Map<Integer, List<Integer>>
```

Menyebabkan boxing `Integer`.

Untuk jutaan node/edge, overhead besar.

Alternatif:

- primitive arrays,
- specialized primitive collections,
- compressed sparse row style representation.

### 31.3 Recursion risk

DFS recursive sederhana tetapi bisa `StackOverflowError` pada graph deep.

Untuk input tidak terkontrol, gunakan iterative DFS.

### 31.4 Allocation pressure

Hindari membuat object baru terlalu banyak di inner loop.

Contoh Dijkstra lazy queue memang membuat banyak `QueueEntry`. Ini acceptable untuk banyak kasus, tetapi pada graph besar bisa jadi allocation hotspot.

Jika perlu optimize:

- gunakan primitive heap custom,
- gunakan index-based arrays,
- reuse buffers carefully,
- benchmark dengan workload realistis.

### 31.5 Determinism vs speed

`HashMap` lebih cepat expected O(1), tetapi order tidak menjadi contract sorting domain.

Jika output harus stable:

- sort neighbor list,
- gunakan `TreeSet`,
- gunakan `PriorityQueue`,
- canonicalize input.

---

## 32. Testing Strategy

Graph algorithm harus diuji lebih dari happy path.

### 32.1 Topological sort tests

Test:

1. Empty graph.
2. Single node.
3. Linear dependency.
4. Branch dependency.
5. Multiple valid orders tetapi deterministic expected.
6. Disconnected graph.
7. Duplicate edge.
8. Self dependency.
9. Simple cycle.
10. Complex cycle.
11. Missing dependency.
12. Very deep graph.
13. Very wide graph.

### 32.2 Shortest path tests

Test:

1. Source equals target.
2. No path.
3. Single edge.
4. Multiple paths.
5. Tie distance.
6. Zero weight edge.
7. Negative edge rejection for Dijkstra.
8. Large weight overflow.
9. Stale queue entry scenario.
10. Path reconstruction correctness.

### 32.3 Workflow graph tests

Test:

1. All states reachable.
2. Unreachable state.
3. Terminal state reachable.
4. Non-terminal dead-end.
5. Allowed cycle.
6. Invalid cycle.
7. Transition to unknown state.
8. Duplicate transition.
9. Guard metadata missing.

---

## 33. Property-Based Thinking

Graph algorithm cocok diuji dengan property.

Contoh property topological sort:

> Untuk setiap edge A -> B, index(A) harus lebih kecil dari index(B).

Bukan hanya compare dengan satu expected order.

```java
static void assertTopologicalOrder(
        List<String> order,
        Map<String, List<String>> graph
) {
    Map<String, Integer> index = new HashMap<>();
    for (int i = 0; i < order.size(); i++) {
        index.put(order.get(i), i);
    }

    for (Map.Entry<String, List<String>> entry : graph.entrySet()) {
        String from = entry.getKey();
        for (String to : entry.getValue()) {
            if (index.get(from) >= index.get(to)) {
                throw new AssertionError("Invalid order for edge " + from + " -> " + to);
            }
        }
    }
}
```

Property shortest path:

- distance target <= every known alternative path sampled,
- every consecutive pair in returned path must be valid edge,
- sum edge weights equals returned distance,
- no path returns empty optional/list.

---

## 34. Observability untuk Graph Resolution

Graph algorithm di production perlu observability.

Minimal log/metric:

```text
node_count
edge_count
resolution_time_ms
cycle_detected
ready_initial_count
max_ready_queue_size
max_depth_or_level
unresolved_node_count
```

Untuk dependency resolution:

```text
resolution_id
input_version
node_count
edge_count
result=success|cycle|invalid
cycle_path_hash
```

Jangan log seluruh graph jika besar atau mengandung sensitive data.

Gunakan:

- summary,
- hash,
- sample,
- redacted node IDs,
- explicit debug mode.

---

## 35. Failure Modes yang Sering Terjadi

### 35.1 Salah arah edge

Ini paling umum.

Developer menulis:

```text
A -> B means A depends on B
```

Tapi algorithm membaca:

```text
A -> B means A before B
```

Hasil order terbalik.

Solusi:

- nama map harus eksplisit,
- test dengan contoh kecil,
- dokumentasikan edge semantics.

### 35.2 Tidak memasukkan isolated node

Node tanpa edge tetap bagian graph.

Jika hanya collect dari adjacency key/value, isolated node bisa hilang.

Solusi:

- graph harus punya explicit node set,
- edge list bukan satu-satunya sumber node.

### 35.3 Duplicate edge merusak indegree

Jika duplicate edge menaikkan indegree dua kali, node bisa tidak pernah ready.

Solusi:

- build adjacency sebagai set,
- validate duplicate edge.

### 35.4 Menganggap cycle selalu salah

Dalam dependency graph, cycle salah.

Dalam workflow graph, cycle bisa valid.

Solusi:

- validasi sesuai domain semantics,
- jangan pakai generic graph rule tanpa konteks.

### 35.5 Output non-deterministic

Bisa menyebabkan flaky test dan audit noise.

Solusi:

- deterministic traversal,
- sort input,
- priority queue ready nodes.

### 35.6 Dijkstra dengan negative weight

Hasil bisa salah.

Solusi:

- validate edge weight,
- gunakan Bellman-Ford jika negative edge diperlukan.

### 35.7 Priority mutation

Jika object dalam `PriorityQueue` diubah field priority-nya, heap tidak otomatis reorder.

Solusi:

- gunakan immutable queue entry,
- add new entry dan skip stale.

### 35.8 Recursion stack overflow

Deep graph bisa membuat DFS recursive gagal.

Solusi:

- gunakan iterative DFS,
- batasi input,
- validasi depth.

---

## 36. Design Checklist

Saat melihat problem graph, tanyakan:

1. Node merepresentasikan apa?
2. Edge merepresentasikan apa?
3. Edge arahnya apa?
4. Apakah graph directed atau undirected?
5. Apakah cycle valid?
6. Jika cycle tidak valid, error message harus seperti apa?
7. Apakah edge weighted?
8. Apakah weight bisa negatif?
9. Apakah butuh shortest path, all paths, atau reachability saja?
10. Apakah output harus deterministic?
11. Apakah graph static atau berubah-ubah?
12. Apakah query lebih sering daripada update?
13. Apakah graph kecil, sedang, atau besar?
14. Apakah ID domain perlu mapping ke integer?
15. Apakah isolated node penting?
16. Apakah duplicate edge allowed?
17. Apakah missing reference invalid?
18. Apakah traversal harus bounded?
19. Apakah perlu path explanation?
20. Apakah perlu observability metric?

---

## 37. Mini Capstone: Dependency Plan Generator

Misal kita ingin membuat generator plan untuk task dependency.

Requirement:

1. Input daftar task dan dependency.
2. Reject missing task.
3. Reject duplicate task.
4. Reject self dependency.
5. Deduplicate edge.
6. Detect cycle dengan path.
7. Produce deterministic execution levels.
8. Explain level output.

Model:

```java
public record Task(String id) implements Comparable<Task> {
    public Task {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Task id must not be blank");
        }
    }

    @Override
    public int compareTo(Task other) {
        return this.id.compareTo(other.id);
    }
}

public record TaskDependency(Task dependency, Task dependent) {
    public TaskDependency {
        Objects.requireNonNull(dependency, "dependency");
        Objects.requireNonNull(dependent, "dependent");
        if (dependency.equals(dependent)) {
            throw new IllegalArgumentException("Task cannot depend on itself: " + dependency);
        }
    }
}
```

Result:

```java
public record ExecutionPlan(List<List<Task>> levels) {
    public ExecutionPlan {
        levels = levels.stream()
                .map(List::copyOf)
                .toList();
    }
}
```

Core idea:

```text
Level 0: no dependencies
Level 1: dependencies satisfied by level 0
Level 2: dependencies satisfied by previous levels
...
```

This is not just algorithm. It becomes a production abstraction:

- safe deploy plan,
- safe migration plan,
- safe rule evaluation plan,
- safe batch execution plan.

---

## 38. Hubungan dengan Sistem Regulatory / Case Management

Untuk sistem case management dan enforcement lifecycle, graph muncul secara alami:

### 38.1 State transition graph

State:

```text
Draft
Submitted
Screening
Investigation
Review
Decision
Appeal
Closed
```

Edges:

```text
Draft -> Submitted
Submitted -> Screening
Screening -> Investigation
Investigation -> Review
Review -> Decision
Decision -> Appeal
Decision -> Closed
Appeal -> Review
```

Pertanyaan:

- State mana yang unreachable?
- Apakah setiap case bisa closed?
- Apakah appeal loop punya batas?
- Apakah transition tertentu bypass mandatory review?

### 38.2 Dependency antar entity

```text
Case -> Party
Case -> Allegation
Case -> Evidence
Evidence -> Document
Decision -> Case
Appeal -> Decision
```

Impact analysis:

> Jika evidence berubah, apakah decision perlu re-evaluation?

### 38.3 Escalation flow

Escalation bisa priority queue + graph dependency:

- case tidak boleh escalate sebelum mandatory checks selesai,
- mandatory checks punya dependency,
- ready case diprioritaskan berdasarkan SLA deadline.

Ini gabungan:

- topological readiness,
- priority queue scheduling,
- shortest/critical path for SLA.

### 38.4 Rule defensibility

Jika sebuah decision berasal dari rules:

```text
input facts -> derived facts -> eligibility -> risk -> decision
```

Graph dependency memungkinkan explanation:

```text
Decision REJECTED because:
  risk-score HIGH because:
    prior-violation-count = 3
    outstanding-compliance-order = true
```

DSA di sini bukan sekadar performa. Ia menjadi alat auditability dan defensibility.

---

## 39. Ringkasan Algoritma

| Problem | Algorithm | Valid Untuk | Complexity |
|---|---|---|---|
| Dependency order | Kahn topological sort | DAG | O(V + E) |
| Dependency order + DFS style | DFS topological sort | DAG | O(V + E) |
| Cycle detection directed | DFS color | Directed graph | O(V + E) |
| Shortest path unweighted | BFS | Unweighted graph | O(V + E) |
| Shortest path non-negative | Dijkstra | Weighted non-negative graph | O((V + E) log V) |
| Shortest path with negative edge | Bellman-Ford | Weighted graph, negative edge allowed | O(VE) |
| All-pairs shortest path | Floyd-Warshall | Small/medium graph | O(V³) |
| Connected components undirected | DFS/BFS/DSU | Undirected graph | O(V + E) / near O(1) amortized DSU ops |
| Cycle detection undirected | DSU | Undirected graph | near O(E) |
| Critical path in DAG | Topological DP | Weighted DAG | O(V + E) |
| Impact analysis | BFS/DFS reachability | Directed graph | O(V + E) |

---

## 40. Key Takeaways

1. Graph algorithm adalah alat untuk dependency, reachability, causality, dan impact.
2. Edge direction harus eksplisit. Salah arah edge adalah bug paling mahal.
3. Topological sort hanya valid jika graph acyclic.
4. Kahn’s algorithm cocok untuk scheduling dan dependency execution.
5. DFS topological sort cocok untuk reasoning dan cycle diagnostics, tetapi recursion risk harus dipertimbangkan.
6. Cycle error harus menjelaskan path, bukan hanya berkata “cycle exists”.
7. BFS adalah shortest path untuk unweighted graph.
8. Dijkstra butuh non-negative weights.
9. Bellman-Ford mendukung negative edge dan bisa mendeteksi negative cycle.
10. Floyd-Warshall mahal tetapi berguna untuk graph kecil dengan banyak query all-pairs.
11. DSU sangat kuat untuk undirected connectivity, tetapi bukan solusi umum directed dependency.
12. Determinism penting untuk production debugging, audit, dan test stability.
13. Graph representation harus mengikuti operation mix.
14. Workflow graph tidak selalu harus acyclic; validasi harus domain-aware.
15. Dalam sistem regulatory/case management, graph membantu membuat lifecycle, dependency, escalation, dan decision explanation lebih defensible.

---

## 41. Latihan

### Latihan 1 — Topological Sort

Buat dependency graph:

```text
A -> C
B -> C
C -> D
B -> E
E -> F
```

Tulis:

1. Indegree awal setiap node.
2. Semua topological order yang mungkin kamu temukan.
3. Deterministic order jika ready queue memakai alphabetical priority.

### Latihan 2 — Cycle Reporting

Untuk graph:

```text
A -> B
B -> C
C -> D
D -> B
```

Buat function yang mengeluarkan cycle path:

```text
B -> C -> D -> B
```

### Latihan 3 — Dijkstra

Untuk graph:

```text
A -> B cost 5
A -> C cost 2
C -> B cost 1
B -> D cost 3
C -> D cost 9
```

Hitung shortest path dari A ke D.

### Latihan 4 — Impact Analysis

Jika dependency graph:

```text
config -> auth
config -> case
case -> report
auth -> gateway
case -> gateway
```

Jika `config` berubah, node mana terdampak?

### Latihan 5 — Workflow Validation

Buat validator untuk state graph:

```text
DRAFT -> SUBMITTED
SUBMITTED -> REVIEW
REVIEW -> APPROVED
REVIEW -> REJECTED
REJECTED -> RESUBMITTED
RESUBMITTED -> REVIEW
```

Cek:

1. semua state reachable dari DRAFT,
2. APPROVED terminal,
3. semua non-terminal punya path ke APPROVED,
4. cycle mana yang valid.

---

## 42. Referensi

- Oracle Java SE 25 Documentation — Collections Framework Overview: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html
- Oracle Java SE 25 Documentation — ArrayDeque: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html
- Oracle Java SE 25 Documentation — PriorityQueue: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html
- OpenJDK Source — PriorityQueue: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/PriorityQueue.java
- CLRS-style graph algorithms reference topics: BFS, DFS, topological sort, shortest path, union-find, MST.

---

## 43. Status Seri

Part ini adalah **Part 014 dari 030**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 015 — String Algorithms I: String Cost Model, Search, Parsing
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-dsa-part-013.md](./learn-java-dsa-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-015.md](./learn-java-dsa-part-015.md)

</div>