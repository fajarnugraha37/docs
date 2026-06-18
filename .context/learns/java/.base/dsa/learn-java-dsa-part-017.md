# learn-java-dsa-part-017 — Recursion, Backtracking, Search Space Pruning

> Seri: Java Data Structure and Algorithm Advanced  
> Part: 017 dari 030  
> Status seri: belum selesai  
> Fokus: recursion, backtracking, pruning, branch-and-bound, dan cara mengubah eksplorasi kombinatorial menjadi algoritma yang terkontrol, aman, dan bisa dipakai dalam sistem Java nyata.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas struktur data graph, shortest path, topological sort, string search, trie, suffix thinking, dan indexing berbasis prefix. Di bagian ini kita masuk ke pola algoritmik yang sering tampak sederhana tetapi sangat mudah menjadi tidak terkendali: **recursion dan backtracking**.

Recursion dan backtracking adalah fondasi untuk banyak problem:

- generate permutation;
- generate combination;
- generate subset;
- constraint solving;
- rule matching;
- route exploration;
- dependency resolution dengan alternatif;
- scheduling terbatas;
- allocation matching;
- search with rollback;
- parsing grammar sederhana;
- game/state exploration;
- tree/graph traversal dengan keputusan bercabang.

Namun dalam production engineering, masalahnya bukan hanya “bisa solve”. Masalah utamanya adalah:

1. **apakah search space-nya meledak?**
2. **apakah recursion depth aman untuk Java stack?**
3. **apakah state rollback benar?**
4. **apakah pruning valid atau malah menghilangkan solusi?**
5. **apakah algoritma bisa dihentikan, dibatasi, diaudit, dan dijelaskan?**
6. **apakah output deterministic?**
7. **apakah memory allocation terkendali?**

Bagian ini bertujuan membangun mental model agar kamu tidak hanya tahu template backtracking, tetapi mampu mendesain search algorithm yang robust.

---

## 1. Mental Model Utama: Search Tree

Backtracking hampir selalu bisa dipahami sebagai membangun **search tree**.

Setiap node dalam search tree merepresentasikan **partial solution**.

Setiap edge merepresentasikan **choice**.

Setiap path dari root ke leaf merepresentasikan satu kandidat solusi lengkap atau dead end.

Contoh sederhana: memilih subset dari `[A, B, C]`.

```text
                         []
                   /            \
              exclude A        include A
                []                [A]
             /      \           /     \
       excl B      incl B   excl B   incl B
        []          [B]      [A]     [A,B]
       /  \        /  \     /  \     /   \
     [] [C]     [B] [B,C] [A] [A,C] [A,B] [A,B,C]
```

Jumlah leaf = `2^n`.

Itulah sebabnya backtracking sering exponential. Bukan karena implementasinya buruk, tetapi karena jumlah kemungkinan memang tumbuh eksponensial.

Top-tier engineer tidak bertanya:

> “Apa template backtracking-nya?”

Melainkan:

> “Apa state-nya, apa choice-nya, apa invariant-nya, apa pruning yang valid, dan seberapa besar search space aktualnya?”

---

## 2. Recursion Frame Model

Recursion bukan sihir. Recursion berarti method memanggil dirinya sendiri, dan setiap call memiliki frame sendiri di call stack.

Frame biasanya menyimpan:

- parameter method;
- local variable;
- return address;
- intermediate state;
- reference ke object yang sedang digunakan.

Contoh:

```java
static int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
```

Call stack untuk `factorial(4)`:

```text
factorial(4)
  waits for factorial(3)
    waits for factorial(2)
      waits for factorial(1)
        returns 1
      returns 2 * 1
    returns 3 * 2
  returns 4 * 6
```

Setiap call menambah stack depth. Jika recursion terlalu dalam, Java dapat melempar `StackOverflowError`. Java mendokumentasikan `StackOverflowError` sebagai error yang dilempar saat stack overflow terjadi karena aplikasi melakukan recursion terlalu dalam.

Dalam DSA, recursion sering nyaman untuk:

- tree traversal;
- DFS;
- divide and conquer;
- backtracking;
- parsing nested structure.

Tetapi dalam sistem production, recursion harus dipakai dengan sadar karena input bisa berasal dari user, database, file, atau external system yang tidak menjamin depth aman.

---

## 3. Tiga Komponen Recursion yang Benar

Recursion yang sehat biasanya punya tiga komponen:

1. **Base case** — kapan berhenti.
2. **Progress** — setiap call bergerak mendekati base case.
3. **Composition** — bagaimana hasil subproblem digabungkan.

Contoh sum array recursive:

```java
static int sum(int[] values, int index) {
    if (index == values.length) {
        return 0;
    }
    return values[index] + sum(values, index + 1);
}
```

Base case:

```java
index == values.length
```

Progress:

```java
index + 1
```

Composition:

```java
values[index] + resultOfRest
```

Jika salah satu hilang, recursion menjadi berbahaya.

Contoh buruk:

```java
static int broken(int n) {
    return broken(n); // tidak ada progress dan tidak ada base case
}
```

Ini pasti gagal.

---

## 4. Recursion vs Iteration

Secara teori, banyak recursion bisa diubah menjadi iteration dengan explicit stack.

Recursive DFS:

```java
static void dfsRecursive(Node node, Set<Node> visited) {
    if (node == null || !visited.add(node)) {
        return;
    }

    process(node);

    for (Node child : node.children()) {
        dfsRecursive(child, visited);
    }
}
```

Iterative DFS:

```java
static void dfsIterative(Node start) {
    Set<Node> visited = new HashSet<>();
    Deque<Node> stack = new ArrayDeque<>();
    stack.push(start);

    while (!stack.isEmpty()) {
        Node node = stack.pop();
        if (node == null || !visited.add(node)) {
            continue;
        }

        process(node);

        List<Node> children = node.children();
        for (int i = children.size() - 1; i >= 0; i--) {
            stack.push(children.get(i));
        }
    }
}
```

Kenapa `ArrayDeque`? Karena Java mendokumentasikan `ArrayDeque` sebagai resizable-array implementation dari `Deque`, tidak menerima `null`, tidak thread-safe tanpa external synchronization, dan kemungkinan lebih cepat dibanding `Stack` untuk stack usage serta `LinkedList` untuk queue usage.

Rule of thumb:

| Situasi | Recursion | Iteration / explicit stack |
|---|---:|---:|
| Depth kecil dan terkontrol | cocok | boleh |
| Depth bisa ribuan/jutaan | berisiko | lebih aman |
| Tree alami dan bounded | cocok | boleh |
| Input untrusted | hati-hati | lebih aman |
| Butuh pause/resume/cancel | sulit | lebih mudah |
| Butuh instrumentation detail | sedang | lebih mudah |
| Performance allocation rendah | bisa | biasanya lebih bisa dikontrol |

---

## 5. Backtracking: Choice, Constraint, Goal, Undo

Backtracking adalah DFS pada search tree dengan kemampuan untuk membangun partial solution, mencoba choice, lalu rollback.

Template mental:

```text
search(state):
    if state is complete:
        emit solution
        return

    for choice in choices(state):
        if choice violates constraint:
            continue

        apply choice
        search(next state)
        undo choice
```

Empat komponen utama:

1. **State** — partial solution saat ini.
2. **Choice** — keputusan berikutnya.
3. **Constraint** — aturan yang harus tetap benar.
4. **Undo** — rollback agar branch berikutnya mulai dari state yang benar.

Backtracking bukan brute force murni jika constraint dan pruning dipakai dengan benar. Ia tetap bisa exponential, tetapi jauh lebih terarah.

---

## 6. Invariant dalam Backtracking

Setiap recursive call harus menjaga invariant.

Misalnya problem kombinasi angka yang sum-nya target.

Invariant:

```text
currentSum == sum(currentPath)
```

Jika invariant ini rusak, hasil search tidak bisa dipercaya.

Contoh implementasi:

```java
static List<List<Integer>> combinationSum(int[] values, int target) {
    Arrays.sort(values);
    List<List<Integer>> result = new ArrayList<>();
    backtrackCombination(values, target, 0, 0, new ArrayList<>(), result);
    return result;
}

private static void backtrackCombination(
        int[] values,
        int target,
        int start,
        int currentSum,
        List<Integer> path,
        List<List<Integer>> result
) {
    if (currentSum == target) {
        result.add(List.copyOf(path));
        return;
    }

    if (currentSum > target) {
        return;
    }

    for (int i = start; i < values.length; i++) {
        int value = values[i];

        if (currentSum + value > target) {
            break; // valid karena values sudah sorted dan semua value positif
        }

        path.add(value);
        backtrackCombination(values, target, i + 1, currentSum + value, path, result);
        path.remove(path.size() - 1);
    }
}
```

Perhatikan:

```java
path.add(value);
...
path.remove(path.size() - 1);
```

Itu apply dan undo.

Bug umum adalah lupa undo.

```java
path.add(value);
backtrack(...);
// lupa path.remove(...)
```

Akibatnya branch berikutnya memakai state yang tercemar.

---

## 7. Output Copy: Kenapa `List.copyOf(path)` Penting

Dalam backtracking, `path` biasanya mutable dan dipakai ulang.

Jika kita melakukan ini:

```java
result.add(path);
```

maka semua result bisa menunjuk ke object list yang sama.

Contoh bug:

```java
static List<List<Integer>> brokenSubsets(int[] values) {
    List<List<Integer>> result = new ArrayList<>();
    List<Integer> path = new ArrayList<>();
    brokenSubsets(values, 0, path, result);
    return result;
}

private static void brokenSubsets(
        int[] values,
        int index,
        List<Integer> path,
        List<List<Integer>> result
) {
    if (index == values.length) {
        result.add(path); // BUG: menyimpan reference mutable yang sama
        return;
    }

    brokenSubsets(values, index + 1, path, result);

    path.add(values[index]);
    brokenSubsets(values, index + 1, path, result);
    path.remove(path.size() - 1);
}
```

Versi benar:

```java
result.add(List.copyOf(path));
```

Atau:

```java
result.add(new ArrayList<>(path));
```

Mental model:

> Partial state boleh mutable untuk efisiensi, tetapi output harus snapshot.

---

## 8. Subset Generation

Problem: generate semua subset dari array.

Jumlah subset = `2^n`.

```java
static List<List<Integer>> subsets(int[] values) {
    List<List<Integer>> result = new ArrayList<>();
    backtrackSubsets(values, 0, new ArrayList<>(), result);
    return result;
}

private static void backtrackSubsets(
        int[] values,
        int index,
        List<Integer> path,
        List<List<Integer>> result
) {
    if (index == values.length) {
        result.add(List.copyOf(path));
        return;
    }

    // Choice 1: exclude values[index]
    backtrackSubsets(values, index + 1, path, result);

    // Choice 2: include values[index]
    path.add(values[index]);
    backtrackSubsets(values, index + 1, path, result);
    path.remove(path.size() - 1);
}
```

Alternative style:

```java
static List<List<Integer>> subsetsIncremental(int[] values) {
    List<List<Integer>> result = new ArrayList<>();
    backtrackSubsetsIncremental(values, 0, new ArrayList<>(), result);
    return result;
}

private static void backtrackSubsetsIncremental(
        int[] values,
        int start,
        List<Integer> path,
        List<List<Integer>> result
) {
    result.add(List.copyOf(path));

    for (int i = start; i < values.length; i++) {
        path.add(values[i]);
        backtrackSubsetsIncremental(values, i + 1, path, result);
        path.remove(path.size() - 1);
    }
}
```

Dua style ini berbeda bentuk search tree-nya, tetapi menghasilkan konsep yang sama.

Complexity:

- time: `O(n * 2^n)` jika setiap subset disalin;
- output size: `O(n * 2^n)`;
- auxiliary recursion depth: `O(n)`.

Kenapa ada faktor `n`? Karena setiap output subset bisa berukuran hingga `n`, dan kita membuat snapshot.

---

## 9. Combination Generation

Combination memilih `k` item dari `n` item tanpa memperhatikan urutan.

Jumlah output:

```text
C(n, k) = n! / (k! * (n-k)!)
```

Implementation:

```java
static List<List<Integer>> combinations(int n, int k) {
    if (k < 0 || k > n) {
        return List.of();
    }

    List<List<Integer>> result = new ArrayList<>();
    backtrackCombinations(1, n, k, new ArrayList<>(), result);
    return result;
}

private static void backtrackCombinations(
        int start,
        int n,
        int k,
        List<Integer> path,
        List<List<Integer>> result
) {
    if (path.size() == k) {
        result.add(List.copyOf(path));
        return;
    }

    int remainingSlots = k - path.size();

    for (int value = start; value <= n; value++) {
        int remainingValues = n - value + 1;
        if (remainingValues < remainingSlots) {
            break; // pruning: tidak cukup item tersisa
        }

        path.add(value);
        backtrackCombinations(value + 1, n, k, path, result);
        path.remove(path.size() - 1);
    }
}
```

Pruning kecil tetapi penting:

```java
if (remainingValues < remainingSlots) break;
```

Tanpa pruning, algoritma tetap benar, tetapi mencoba branch yang mustahil.

---

## 10. Permutation Generation

Permutation memperhatikan urutan.

Jumlah output = `n!`.

Untuk `n = 10`, output sudah `3,628,800`.

Untuk `n = 12`, output `479,001,600`.

Jadi permutation generation hampir selalu harus diberi batas dalam sistem nyata.

Implementation dengan `used[]`:

```java
static List<List<Integer>> permutations(int[] values) {
    List<List<Integer>> result = new ArrayList<>();
    boolean[] used = new boolean[values.length];
    backtrackPermutations(values, used, new ArrayList<>(), result);
    return result;
}

private static void backtrackPermutations(
        int[] values,
        boolean[] used,
        List<Integer> path,
        List<List<Integer>> result
) {
    if (path.size() == values.length) {
        result.add(List.copyOf(path));
        return;
    }

    for (int i = 0; i < values.length; i++) {
        if (used[i]) {
            continue;
        }

        used[i] = true;
        path.add(values[i]);

        backtrackPermutations(values, used, path, result);

        path.remove(path.size() - 1);
        used[i] = false;
    }
}
```

Invariant:

```text
used[i] == true jika dan hanya jika values[i] ada di path
```

Jika `used[i] = false` lupa dilakukan saat rollback, seluruh search rusak.

---

## 11. Handling Duplicate Input

Jika input mengandung duplicate, naive permutation menghasilkan duplicate output.

Contoh: `[1, 1, 2]`.

Permutation unik:

```text
[1,1,2]
[1,2,1]
[2,1,1]
```

Bukan 6 output.

Implementation:

```java
static List<List<Integer>> uniquePermutations(int[] values) {
    Arrays.sort(values);
    List<List<Integer>> result = new ArrayList<>();
    boolean[] used = new boolean[values.length];
    backtrackUniquePermutations(values, used, new ArrayList<>(), result);
    return result;
}

private static void backtrackUniquePermutations(
        int[] values,
        boolean[] used,
        List<Integer> path,
        List<List<Integer>> result
) {
    if (path.size() == values.length) {
        result.add(List.copyOf(path));
        return;
    }

    for (int i = 0; i < values.length; i++) {
        if (used[i]) {
            continue;
        }

        if (i > 0 && values[i] == values[i - 1] && !used[i - 1]) {
            continue;
        }

        used[i] = true;
        path.add(values[i]);

        backtrackUniquePermutations(values, used, path, result);

        path.remove(path.size() - 1);
        used[i] = false;
    }
}
```

Rule ini:

```java
if (i > 0 && values[i] == values[i - 1] && !used[i - 1]) continue;
```

berarti:

> Untuk duplicate value yang sama, gunakan instance sebelumnya lebih dulu agar ordering canonical.

Ini bukan sekadar trik. Ini adalah cara memaksa representasi unik untuk menghindari branch equivalent.

---

## 12. Constraint Pruning

Pruning berarti menghentikan branch karena kita tahu branch itu tidak bisa menghasilkan solusi valid atau tidak bisa mengalahkan solusi terbaik.

Ada dua kategori besar:

1. **Feasibility pruning** — branch tidak mungkin valid.
2. **Optimality pruning** — branch mungkin valid, tetapi tidak mungkin lebih baik dari solusi terbaik saat ini.

Contoh feasibility pruning:

```java
if (currentSum > target) return;
```

Valid jika semua angka non-negative.

Jika angka bisa negative, pruning ini salah.

Contoh:

```text
target = 5
currentSum = 10
remaining contains -5
```

Branch masih bisa menjadi 5.

Jadi pruning harus berdasarkan invariant dan constraint yang benar.

Rule penting:

> Pruning yang salah lebih berbahaya daripada tidak pruning, karena menghasilkan jawaban salah secara diam-diam.

---

## 13. Branch and Bound

Branch and bound digunakan untuk optimization problem.

Kita menyimpan best solution sejauh ini, lalu menghentikan branch jika bound menunjukkan branch itu tidak mungkin lebih baik.

Contoh problem:

> Pilih beberapa task dengan profit maksimum, tetapi total duration tidak boleh melebihi limit.

Ini mirip knapsack. Backtracking bisa dipakai untuk ukuran kecil atau ketika constraint kompleks.

```java
record Task(String id, int duration, int profit) {}

record Plan(List<String> taskIds, int totalDuration, int totalProfit) {}
```

Solver sederhana:

```java
final class TaskPlanner {
    private Plan best = new Plan(List.of(), 0, 0);

    Plan bestPlan(List<Task> tasks, int maxDuration) {
        List<Task> sorted = new ArrayList<>(tasks);
        sorted.sort(Comparator.comparingDouble((Task t) -> (double) t.profit() / t.duration()).reversed());

        search(sorted, maxDuration, 0, 0, 0, new ArrayList<>());
        return best;
    }

    private void search(
            List<Task> tasks,
            int maxDuration,
            int index,
            int duration,
            int profit,
            List<String> path
    ) {
        if (duration > maxDuration) {
            return;
        }

        if (profit > best.totalProfit()) {
            best = new Plan(List.copyOf(path), duration, profit);
        }

        if (index == tasks.size()) {
            return;
        }

        int optimisticProfit = profit + sumRemainingProfit(tasks, index);
        if (optimisticProfit <= best.totalProfit()) {
            return;
        }

        Task task = tasks.get(index);

        // include
        path.add(task.id());
        search(tasks, maxDuration, index + 1,
                duration + task.duration(),
                profit + task.profit(),
                path);
        path.remove(path.size() - 1);

        // exclude
        search(tasks, maxDuration, index + 1, duration, profit, path);
    }

    private int sumRemainingProfit(List<Task> tasks, int start) {
        int sum = 0;
        for (int i = start; i < tasks.size(); i++) {
            sum += tasks.get(i).profit();
        }
        return sum;
    }
}
```

`sumRemainingProfit` adalah upper bound kasar. Jika bahkan mengambil semua remaining profit tidak bisa mengalahkan best, branch tidak perlu dicari.

Catatan: ini belum optimal untuk large input. Untuk knapsack klasik, DP sering lebih cocok. Tetapi untuk constraint rumit yang sulit dibuat DP, branch-and-bound sering lebih fleksibel.

---

## 14. Search Space Explosion

Backtracking sering gagal bukan karena bug, tetapi karena search space terlalu besar.

| Pattern | Jumlah kemungkinan |
|---|---:|
| Subset | `2^n` |
| Permutation | `n!` |
| Combination k dari n | `C(n,k)` |
| Assign n item ke m bucket | `m^n` |
| Path dalam graph umum | bisa exponential |

Perbandingan kasar:

```text
2^20  = 1,048,576
2^30  = 1,073,741,824
10!   = 3,628,800
12!   = 479,001,600
15!   = 1,307,674,368,000
```

Jangan membuat API production yang diam-diam melakukan permutation terhadap input user tanpa limit.

Minimal desain guard:

```java
static void requireReasonableSize(int n, int maxN, String operation) {
    if (n > maxN) {
        throw new IllegalArgumentException(
                operation + " input too large: n=" + n + ", max=" + maxN);
    }
}
```

Untuk algoritma exponential, limit bukan optional. Limit adalah bagian dari correctness boundary.

---

## 15. Early Termination: Find One vs Find All

Banyak implementasi backtracking boros karena selalu mencari semua solusi padahal hanya butuh satu.

Find all:

```java
void search(..., List<Solution> result)
```

Find one:

```java
boolean search(...)
```

Contoh mencari apakah subset sum target ada:

```java
static boolean existsSubsetSum(int[] values, int target) {
    return existsSubsetSum(values, 0, 0, target);
}

private static boolean existsSubsetSum(int[] values, int index, int sum, int target) {
    if (sum == target) {
        return true;
    }

    if (index == values.length) {
        return false;
    }

    return existsSubsetSum(values, index + 1, sum, target)
            || existsSubsetSum(values, index + 1, sum + values[index], target);
}
```

Dengan short-circuit `||`, search berhenti ketika solusi ditemukan.

Jika semua value positive dan sudah sorted, bisa tambah pruning:

```java
if (sum > target) return false;
```

Tetapi lagi-lagi hanya valid jika tidak ada negative value.

---

## 16. Search Budget: Time, Node Count, Output Count

Dalam sistem nyata, backtracking perlu budget.

Tiga budget umum:

1. **max depth**;
2. **max visited nodes**;
3. **max output count**;
4. **deadline/time budget**.

Contoh context:

```java
final class SearchBudget {
    private final long deadlineNanos;
    private final long maxVisitedNodes;
    private final int maxSolutions;
    private long visitedNodes;

    SearchBudget(Duration timeout, long maxVisitedNodes, int maxSolutions) {
        this.deadlineNanos = System.nanoTime() + timeout.toNanos();
        this.maxVisitedNodes = maxVisitedNodes;
        this.maxSolutions = maxSolutions;
    }

    void onVisit(int currentSolutionCount) {
        visitedNodes++;

        if (visitedNodes > maxVisitedNodes) {
            throw new SearchLimitExceededException("visited node limit exceeded: " + maxVisitedNodes);
        }

        if (currentSolutionCount >= maxSolutions) {
            throw new SearchLimitExceededException("solution limit exceeded: " + maxSolutions);
        }

        if (System.nanoTime() > deadlineNanos) {
            throw new SearchLimitExceededException("search deadline exceeded");
        }
    }
}

final class SearchLimitExceededException extends RuntimeException {
    SearchLimitExceededException(String message) {
        super(message);
    }
}
```

Catatan penting:

- `System.nanoTime()` cocok untuk elapsed time, bukan wall-clock timestamp.
- Budget exception sebaiknya dibedakan dari “no solution”.
- Search timeout harus menghasilkan response yang jelas, bukan partial result yang dikira lengkap.

---

## 17. Backtracking dengan Result Streaming

Mengumpulkan semua output ke `List` bisa berbahaya jika output besar.

Alternatif: gunakan callback/consumer.

```java
static void generateSubsets(int[] values, Consumer<List<Integer>> consumer) {
    generateSubsets(values, 0, new ArrayList<>(), consumer);
}

private static void generateSubsets(
        int[] values,
        int index,
        List<Integer> path,
        Consumer<List<Integer>> consumer
) {
    if (index == values.length) {
        consumer.accept(List.copyOf(path));
        return;
    }

    generateSubsets(values, index + 1, path, consumer);

    path.add(values[index]);
    generateSubsets(values, index + 1, path, consumer);
    path.remove(path.size() - 1);
}
```

Pemakaian:

```java
generateSubsets(new int[] {1, 2, 3}, subset -> {
    System.out.println(subset);
});
```

Untuk production, callback dapat:

- menulis batch ke file;
- mengirim ke downstream;
- menghitung statistik;
- berhenti setelah limit tertentu;
- menghindari menyimpan semua output.

Tetapi tetap perlu hati-hati: `Consumer` tidak punya mekanisme stop bawaan. Bisa pakai return boolean.

```java
@FunctionalInterface
interface SolutionVisitor<T> {
    boolean visit(T solution); // false means stop
}
```

---

## 18. Backtracking yang Bisa Dihentikan dengan Boolean Visitor

```java
static boolean generateSubsetsUntil(
        int[] values,
        SolutionVisitor<List<Integer>> visitor
) {
    return generateSubsetsUntil(values, 0, new ArrayList<>(), visitor);
}

private static boolean generateSubsetsUntil(
        int[] values,
        int index,
        List<Integer> path,
        SolutionVisitor<List<Integer>> visitor
) {
    if (index == values.length) {
        return visitor.visit(List.copyOf(path));
    }

    if (!generateSubsetsUntil(values, index + 1, path, visitor)) {
        return false;
    }

    path.add(values[index]);
    try {
        return generateSubsetsUntil(values, index + 1, path, visitor);
    } finally {
        path.remove(path.size() - 1);
    }
}
```

Kenapa ada `finally`?

Karena jika visitor atau recursive call melempar exception, kita tetap ingin rollback state.

Dalam backtracking production, `try/finally` sering penting ketika operasi apply/undo harus selalu simetris.

---

## 19. Apply/Undo Harus Exception-Safe

Pattern aman:

```java
apply(choice, state);
try {
    search(state);
} finally {
    undo(choice, state);
}
```

Jangan hanya:

```java
apply(choice, state);
search(state);
undo(choice, state);
```

Jika `search` melempar exception, undo tidak jalan.

Kapan ini penting?

- search punya timeout exception;
- visitor bisa gagal;
- instrumentation bisa gagal;
- constraint evaluator bisa melempar exception;
- thread interrupted atau cancellation diterjemahkan menjadi exception;
- branch menggunakan resource sementara.

Untuk algorithm toy, mungkin berlebihan. Untuk production library, ini penting.

---

## 20. Immutable State vs Mutable State + Undo

Ada dua gaya implementasi backtracking.

### 20.1 Immutable State

Setiap recursive call membuat state baru.

```java
static void searchImmutable(List<Integer> remaining, List<Integer> path) {
    if (remaining.isEmpty()) {
        process(path);
        return;
    }

    for (int i = 0; i < remaining.size(); i++) {
        List<Integer> nextRemaining = new ArrayList<>(remaining);
        Integer chosen = nextRemaining.remove(i);

        List<Integer> nextPath = new ArrayList<>(path);
        nextPath.add(chosen);

        searchImmutable(nextRemaining, nextPath);
    }
}
```

Kelebihan:

- lebih mudah reasoning;
- rollback tidak perlu;
- lebih aman dari state corruption;
- cocok untuk prototyping.

Kekurangan:

- allocation besar;
- GC pressure tinggi;
- lambat untuk search space besar.

### 20.2 Mutable State + Undo

State diubah lalu dikembalikan.

Kelebihan:

- allocation lebih rendah;
- performa lebih baik;
- cocok untuk search intensif.

Kekurangan:

- rawan lupa undo;
- rawan shared reference bug;
- lebih sulit diuji;
- perlu invariant checking.

Rule engineering:

> Mulai dari immutable/copying untuk correctness. Optimalkan ke mutable+undo jika profiling menunjukkan perlu.

---

## 21. N-Queens: Backtracking dengan Constraint Set

Problem N-Queens:

> Tempatkan N queen di papan N x N sehingga tidak ada queen yang saling menyerang.

Constraint:

- satu queen per row;
- tidak boleh kolom sama;
- tidak boleh diagonal sama.

Diagonal encoding:

```text
main diagonal: row - col
anti diagonal: row + col
```

Implementation:

```java
static List<List<String>> solveNQueens(int n) {
    List<List<String>> result = new ArrayList<>();

    boolean[] columns = new boolean[n];
    boolean[] mainDiagonals = new boolean[2 * n - 1];
    boolean[] antiDiagonals = new boolean[2 * n - 1];
    int[] queenAtColumnByRow = new int[n];
    Arrays.fill(queenAtColumnByRow, -1);

    backtrackQueens(0, n, columns, mainDiagonals, antiDiagonals, queenAtColumnByRow, result);
    return result;
}

private static void backtrackQueens(
        int row,
        int n,
        boolean[] columns,
        boolean[] mainDiagonals,
        boolean[] antiDiagonals,
        int[] queenAtColumnByRow,
        List<List<String>> result
) {
    if (row == n) {
        result.add(renderBoard(queenAtColumnByRow, n));
        return;
    }

    for (int col = 0; col < n; col++) {
        int main = row - col + n - 1;
        int anti = row + col;

        if (columns[col] || mainDiagonals[main] || antiDiagonals[anti]) {
            continue;
        }

        columns[col] = true;
        mainDiagonals[main] = true;
        antiDiagonals[anti] = true;
        queenAtColumnByRow[row] = col;

        try {
            backtrackQueens(row + 1, n, columns, mainDiagonals, antiDiagonals, queenAtColumnByRow, result);
        } finally {
            queenAtColumnByRow[row] = -1;
            antiDiagonals[anti] = false;
            mainDiagonals[main] = false;
            columns[col] = false;
        }
    }
}

private static List<String> renderBoard(int[] queenAtColumnByRow, int n) {
    List<String> board = new ArrayList<>(n);
    for (int row = 0; row < n; row++) {
        char[] line = new char[n];
        Arrays.fill(line, '.');
        line[queenAtColumnByRow[row]] = 'Q';
        board.add(new String(line));
    }
    return board;
}
```

Mental model:

- `row` adalah depth;
- `col` adalah choice;
- `columns/mainDiagonals/antiDiagonals` adalah constraint index;
- `queenAtColumnByRow` adalah partial solution;
- `renderBoard` membuat snapshot output.

---

## 22. Backtracking untuk Rule Matching

Sekarang kita bawa ke konteks sistem nyata.

Misal ada rule engine kecil:

- case punya attributes;
- tiap rule punya beberapa condition;
- beberapa condition punya alternatif;
- kita ingin mencari kombinasi condition yang menjelaskan kenapa case eligible/ineligible.

Model:

```java
record CaseData(String type, int amount, Set<String> tags) {}

@FunctionalInterface
interface Condition {
    boolean matches(CaseData data);
}

record RuleAlternative(String code, Condition condition) {}

record RuleGroup(String name, List<RuleAlternative> alternatives) {}

record MatchExplanation(List<String> selectedAlternativeCodes) {}
```

Kita perlu memilih satu alternative dari setiap group.

```java
static List<MatchExplanation> findExplanations(
        CaseData data,
        List<RuleGroup> groups,
        int maxExplanations
) {
    List<MatchExplanation> result = new ArrayList<>();
    backtrackRuleGroups(data, groups, 0, new ArrayList<>(), result, maxExplanations);
    return result;
}

private static boolean backtrackRuleGroups(
        CaseData data,
        List<RuleGroup> groups,
        int groupIndex,
        List<String> path,
        List<MatchExplanation> result,
        int maxExplanations
) {
    if (result.size() >= maxExplanations) {
        return false;
    }

    if (groupIndex == groups.size()) {
        result.add(new MatchExplanation(List.copyOf(path)));
        return result.size() < maxExplanations;
    }

    RuleGroup group = groups.get(groupIndex);
    for (RuleAlternative alternative : group.alternatives()) {
        if (!alternative.condition().matches(data)) {
            continue;
        }

        path.add(alternative.code());
        try {
            if (!backtrackRuleGroups(data, groups, groupIndex + 1, path, result, maxExplanations)) {
                return false;
            }
        } finally {
            path.remove(path.size() - 1);
        }
    }

    return true;
}
```

Ini terlihat sederhana, tetapi sudah mengandung konsep penting:

- output limit;
- deterministic order mengikuti order groups dan alternatives;
- pruning berdasarkan condition;
- explanation snapshot;
- early stop.

Dalam regulatory/case management system, pattern seperti ini sering muncul dalam:

- eligibility explanation;
- validation error path;
- rule conflict analysis;
- escalation reason construction;
- approval route alternatives.

---

## 23. Backtracking untuk Allocation Problem

Contoh:

> Ada beberapa officer dengan kapasitas. Ada beberapa case dengan effort. Assign case ke officer tanpa melewati kapasitas dan cari assignment yang valid.

Model:

```java
record Officer(String id, int capacity) {}
record CaseWork(String id, int effort) {}
record Assignment(String caseId, String officerId) {}
```

Solver find one:

```java
static Optional<List<Assignment>> assignCases(
        List<Officer> officers,
        List<CaseWork> cases
) {
    int[] remainingCapacity = officers.stream().mapToInt(Officer::capacity).toArray();
    List<Assignment> path = new ArrayList<>();

    boolean found = assignCases(officers, cases, 0, remainingCapacity, path);
    return found ? Optional.of(List.copyOf(path)) : Optional.empty();
}

private static boolean assignCases(
        List<Officer> officers,
        List<CaseWork> cases,
        int caseIndex,
        int[] remainingCapacity,
        List<Assignment> path
) {
    if (caseIndex == cases.size()) {
        return true;
    }

    CaseWork currentCase = cases.get(caseIndex);

    for (int officerIndex = 0; officerIndex < officers.size(); officerIndex++) {
        if (remainingCapacity[officerIndex] < currentCase.effort()) {
            continue;
        }

        Officer officer = officers.get(officerIndex);
        remainingCapacity[officerIndex] -= currentCase.effort();
        path.add(new Assignment(currentCase.id(), officer.id()));

        try {
            if (assignCases(officers, cases, caseIndex + 1, remainingCapacity, path)) {
                return true;
            }
        } finally {
            path.remove(path.size() - 1);
            remainingCapacity[officerIndex] += currentCase.effort();
        }
    }

    return false;
}
```

Improvement penting:

- sort cases by descending effort agar fail fast;
- sort officers by capacity atau domain priority;
- add symmetry pruning jika officer equivalent;
- add budget;
- return explanation jika no solution.

Sorting cases descending effort:

```java
List<CaseWork> sortedCases = new ArrayList<>(cases);
sortedCases.sort(Comparator.comparingInt(CaseWork::effort).reversed());
```

Kenapa ini membantu?

Karena item paling sulit ditempatkan dicoba lebih awal. Jika tidak bisa, search gagal lebih cepat.

---

## 24. Symmetry Pruning

Symmetry terjadi ketika beberapa choice secara efektif equivalent.

Contoh:

- officer A dan B punya kapasitas sama dan role sama;
- memilih A dulu atau B dulu menghasilkan struktur solusi equivalent.

Tanpa symmetry pruning, search membuang waktu pada branch yang sama secara semantik.

Contoh sederhana untuk bucket assignment:

```java
Set<Integer> triedCapacities = new HashSet<>();

for (int officerIndex = 0; officerIndex < officers.size(); officerIndex++) {
    if (remainingCapacity[officerIndex] < effort) {
        continue;
    }

    if (!triedCapacities.add(remainingCapacity[officerIndex])) {
        continue; // skip equivalent capacity state
    }

    // try assignment
}
```

Tetapi hati-hati. Ini valid hanya jika officers benar-benar interchangeable terhadap constraint lain.

Jika officer punya skill, jurisdiction, conflict of interest, atau workload priority berbeda, symmetry pruning berdasarkan capacity saja bisa salah.

---

## 25. Recursion Depth Risk di Java

Java tidak menjamin tail-call optimization. Jadi recursive call yang terlalu dalam tetap berisiko.

Contoh recursive linked list traversal pada list sangat panjang:

```java
static int length(Node node) {
    if (node == null) return 0;
    return 1 + length(node.next());
}
```

Jika list berisi ratusan ribu node, ini berbahaya.

Versi iterative:

```java
static int lengthIterative(Node node) {
    int count = 0;
    Node current = node;
    while (current != null) {
        count++;
        current = current.next();
    }
    return count;
}
```

Rule production:

| Input depth | Rekomendasi |
|---:|---|
| < 100 dan terkontrol | recursion biasanya aman |
| ratusan | masih mungkin, tetapi monitor |
| ribuan | pertimbangkan iterative |
| puluhan ribu+ | gunakan iterative |
| input untrusted | gunakan iterative atau depth guard |

Depth guard:

```java
static void traverse(Node node, int depth, int maxDepth) {
    if (depth > maxDepth) {
        throw new IllegalArgumentException("max traversal depth exceeded: " + maxDepth);
    }

    if (node == null) {
        return;
    }

    process(node);
    traverse(node.next(), depth + 1, maxDepth);
}
```

---

## 26. Explicit Stack untuk Backtracking

Backtracking recursive kadang perlu diubah menjadi explicit stack jika:

- depth terlalu besar;
- butuh pause/resume;
- butuh cancellation lebih granular;
- butuh iterative engine;
- ingin menghindari `StackOverflowError`.

Namun explicit stack untuk backtracking lebih kompleks karena harus menyimpan frame state.

Contoh subset iterative:

```java
record SubsetFrame(int index, List<Integer> path) {}

static List<List<Integer>> subsetsIterative(int[] values) {
    List<List<Integer>> result = new ArrayList<>();
    Deque<SubsetFrame> stack = new ArrayDeque<>();
    stack.push(new SubsetFrame(0, List.of()));

    while (!stack.isEmpty()) {
        SubsetFrame frame = stack.pop();

        if (frame.index() == values.length) {
            result.add(frame.path());
            continue;
        }

        int value = values[frame.index()];

        List<Integer> included = new ArrayList<>(frame.path());
        included.add(value);

        stack.push(new SubsetFrame(frame.index() + 1, included));
        stack.push(new SubsetFrame(frame.index() + 1, frame.path()));
    }

    return result;
}
```

Ini lebih aman terhadap call stack, tetapi membuat banyak list baru. Bisa dioptimalkan, tetapi complexity implementasi naik.

---

## 27. Backtracking dengan Bit Mask

Untuk `n` kecil, subset bisa direpresentasikan dengan bit mask.

```java
static List<List<Integer>> subsetsByBitMask(int[] values) {
    int n = values.length;
    if (n > 30) {
        throw new IllegalArgumentException("n too large for int bitmask: " + n);
    }

    List<List<Integer>> result = new ArrayList<>();
    int total = 1 << n;

    for (int mask = 0; mask < total; mask++) {
        List<Integer> subset = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            if ((mask & (1 << i)) != 0) {
                subset.add(values[i]);
            }
        }
        result.add(List.copyOf(subset));
    }

    return result;
}
```

Ini bukan recursion, tetapi mengeksplorasi search space yang sama.

Kelebihan:

- simple;
- no recursion;
- deterministic;
- cocok untuk subset kecil.

Kekurangan:

- hanya cocok jika `n` kecil;
- `1 << n` overflow jika `n >= 31` untuk int;
- tidak natural untuk constraint pruning kompleks.

Untuk `long`:

```java
if (n > 62) throw new IllegalArgumentException("n too large for long bitmask");
long total = 1L << n;
```

Tetapi `2^62` tetap mustahil dieksekusi. Secara representasi bisa, secara waktu tidak.

---

## 28. Memoization: Saat Backtracking Bertemu DP

Backtracking sering mengunjungi state yang sama berulang kali.

Contoh subset sum:

State dapat direpresentasikan sebagai:

```text
(index, currentSum)
```

Jika dari state yang sama sudah diketahui gagal, tidak perlu dicari lagi.

```java
record SubsetState(int index, int sum) {}

static boolean existsSubsetSumMemo(int[] values, int target) {
    return existsSubsetSumMemo(values, 0, 0, target, new HashMap<>());
}

private static boolean existsSubsetSumMemo(
        int[] values,
        int index,
        int sum,
        int target,
        Map<SubsetState, Boolean> memo
) {
    if (sum == target) {
        return true;
    }

    if (index == values.length) {
        return false;
    }

    SubsetState state = new SubsetState(index, sum);
    Boolean cached = memo.get(state);
    if (cached != null) {
        return cached;
    }

    boolean result = existsSubsetSumMemo(values, index + 1, sum, target, memo)
            || existsSubsetSumMemo(values, index + 1, sum + values[index], target, memo);

    memo.put(state, result);
    return result;
}
```

Ini sudah masuk wilayah dynamic programming.

Perbedaan mental:

- backtracking: explore choices;
- memoization: remember state result;
- DP: define state transition systematically.

Part 018 dan 019 akan membahas DP lebih dalam. Di sini cukup pahami bahwa memoization adalah cara menghindari eksplorasi ulang.

---

## 29. Cycle Detection dalam Recursive Search

Jika search dilakukan pada graph, bukan tree, recursion bisa infinite jika tidak ada visited state.

Contoh buruk:

```java
static void explore(Node node) {
    for (Node next : node.neighbors()) {
        explore(next);
    }
}
```

Jika graph punya cycle, ini tidak berhenti.

DFS graph harus punya visited.

```java
static void explore(Node start) {
    Set<Node> visited = new HashSet<>();
    explore(start, visited);
}

private static void explore(Node node, Set<Node> visited) {
    if (!visited.add(node)) {
        return;
    }

    process(node);

    for (Node next : node.neighbors()) {
        explore(next, visited);
    }
}
```

Namun untuk path enumeration, `visited` sering harus path-local, bukan global.

Global visited:

- cocok untuk reachability/traversal;
- tidak cocok untuk enumerate all simple paths.

Path-local visited:

```java
visited.add(node);
try {
    for (Node next : node.neighbors()) {
        if (!visited.contains(next)) {
            enumerate(next, target, visited, path, result);
        }
    }
} finally {
    visited.remove(node);
}
```

Mental model:

> Global visited berarti “node ini sudah selesai diproses secara global”.  
> Path-local visited berarti “node ini sedang ada di path saat ini”.

Ini beda besar.

---

## 30. Enumerating Paths dengan Backtracking

```java
static List<List<String>> allSimplePaths(Graph graph, String source, String target, int maxPaths) {
    List<List<String>> result = new ArrayList<>();
    Set<String> onPath = new HashSet<>();
    List<String> path = new ArrayList<>();

    enumeratePaths(graph, source, target, onPath, path, result, maxPaths);
    return result;
}

private static boolean enumeratePaths(
        Graph graph,
        String current,
        String target,
        Set<String> onPath,
        List<String> path,
        List<List<String>> result,
        int maxPaths
) {
    if (result.size() >= maxPaths) {
        return false;
    }

    onPath.add(current);
    path.add(current);

    try {
        if (current.equals(target)) {
            result.add(List.copyOf(path));
            return result.size() < maxPaths;
        }

        for (String next : graph.neighborsOf(current)) {
            if (onPath.contains(next)) {
                continue;
            }

            if (!enumeratePaths(graph, next, target, onPath, path, result, maxPaths)) {
                return false;
            }
        }

        return true;
    } finally {
        path.remove(path.size() - 1);
        onPath.remove(current);
    }
}

interface Graph {
    List<String> neighborsOf(String nodeId);
}
```

Ini berguna untuk:

- workflow possible path;
- dependency route;
- approval chain alternatives;
- impact path explanation.

Tetapi jumlah simple paths dalam graph bisa exponential. Jadi `maxPaths` penting.

---

## 31. Determinism dalam Backtracking

Backtracking sering dipakai untuk menghasilkan explanation, decision, atau assignment. Dalam sistem nyata, output harus deterministic.

Non-deterministic source:

- iterasi `HashMap`/`HashSet`;
- input order tidak distandardisasi;
- comparator tidak stabil;
- parallel search;
- external rule order berubah.

Jika output perlu deterministic, gunakan:

- `List` dengan urutan eksplisit;
- `LinkedHashMap` untuk insertion order;
- `TreeMap` untuk sorted order;
- `Comparator` yang total dan stabil;
- canonical ordering sebelum search.

Contoh:

```java
List<RuleAlternative> alternatives = new ArrayList<>(group.alternatives());
alternatives.sort(Comparator.comparing(RuleAlternative::code));
```

Untuk regulatory/decisioning system, deterministic output bukan nice-to-have. Itu bagian dari auditability.

---

## 32. Instrumentation untuk Search

Backtracking production sebaiknya bisa menjawab:

- berapa node dikunjungi?
- berapa branch dipruning?
- berapa solusi ditemukan?
- depth maksimum berapa?
- timeout atau complete?
- pruning rule mana yang paling efektif?

Contoh stats:

```java
final class SearchStats {
    long visitedNodes;
    long prunedNodes;
    int maxDepth;
    int solutions;

    void onVisit(int depth) {
        visitedNodes++;
        maxDepth = Math.max(maxDepth, depth);
    }

    void onPrune() {
        prunedNodes++;
    }

    void onSolution() {
        solutions++;
    }
}
```

Dipakai:

```java
stats.onVisit(depth);

if (constraintViolated) {
    stats.onPrune();
    return;
}

if (solutionFound) {
    stats.onSolution();
}
```

Ini sangat membantu saat algoritma lambat. Tanpa stats, engineer sering hanya menebak.

---

## 33. Testing Backtracking

Backtracking harus diuji lebih dari happy path.

Checklist test:

1. input kosong;
2. input satu elemen;
3. duplicate input;
4. no solution;
5. one solution;
6. multiple solutions;
7. max output limit;
8. timeout/budget exceeded;
9. deterministic ordering;
10. large input rejected;
11. state rollback benar setelah exception;
12. pruning tidak menghilangkan solusi;
13. mutable input tidak merusak output;
14. output snapshot bukan shared mutable list.

Contoh test rollback dengan visitor gagal:

```java
@Test
void rollbackMustHappenWhenVisitorThrows() {
    int[] values = {1, 2, 3};

    RuntimeException failure = assertThrows(RuntimeException.class, () ->
            generateSubsets(values, subset -> {
                throw new RuntimeException("boom");
            })
    );

    assertEquals("boom", failure.getMessage());
}
```

Untuk memverifikasi rollback internal, bisa expose stats atau gunakan invariant assertion di debug/test mode.

---

## 34. Common Failure Modes

### 34.1 Lupa base case

Gejala:

- infinite recursion;
- `StackOverflowError`;
- CPU tinggi.

### 34.2 Tidak ada progress

```java
search(index); // harusnya index + 1
```

### 34.3 Lupa undo

Gejala:

- output aneh;
- duplicate salah;
- branch saling mencemari;
- sulit direproduksi.

### 34.4 Menyimpan reference mutable sebagai output

```java
result.add(path); // salah
```

Harus snapshot.

### 34.5 Pruning tidak valid

Contoh `sum > target` padahal angka bisa negative.

### 34.6 Menggunakan global visited padahal butuh path-local visited

Gejala:

- path valid hilang;
- solusi tidak lengkap.

### 34.7 Tidak ada limit untuk exponential search

Gejala:

- request timeout;
- memory habis;
- thread pool tersaturasi;
- service tidak responsif.

### 34.8 Non-deterministic output

Gejala:

- test flaky;
- audit sulit;
- user melihat hasil berbeda untuk input sama.

### 34.9 Allocation explosion

Gejala:

- GC pressure tinggi;
- throughput turun;
- latency spike.

### 34.10 Recursive traversal pada input untrusted

Gejala:

- stack overflow pada data nested/cyclic;
- denial-of-service vector.

---

## 35. Design Checklist untuk Backtracking Production

Sebelum menulis kode, jawab ini:

1. Apa state minimal yang perlu disimpan?
2. Apa choice pada setiap depth?
3. Apa base case?
4. Apa invariant setiap recursive call?
5. Apa constraint yang bisa dicek lebih awal?
6. Apa pruning yang valid?
7. Apakah pruning tetap valid untuk negative/duplicate/null/special case?
8. Apakah output perlu semua solusi atau cukup satu?
9. Apakah output perlu deterministic?
10. Apakah search space bounded?
11. Apa max input size?
12. Apa max output count?
13. Apa timeout/deadline?
14. Apakah recursion depth aman?
15. Apakah perlu iterative version?
16. Apakah state mutable atau immutable?
17. Jika mutable, apakah undo exception-safe?
18. Apakah output disnapshot?
19. Apakah ada instrumentation?
20. Bagaimana no-solution dijelaskan?
21. Bagaimana timeout dibedakan dari no-solution?
22. Bagaimana test membuktikan pruning tidak salah?

---

## 36. Java-Specific Recommendations

1. Gunakan `ArrayDeque` untuk explicit stack/queue daripada legacy `Stack`.
2. Jangan pakai recursion untuk depth tidak terkontrol.
3. Gunakan primitive arrays untuk state kecil yang sering berubah:
   - `boolean[] used`;
   - `int[] remainingCapacity`;
   - `int[] pathIndex`.
4. Hindari membuat object baru di setiap branch jika search space besar.
5. Snapshot output dengan `List.copyOf` atau copy constructor.
6. Jangan expose mutable internal path.
7. Gunakan `try/finally` untuk rollback yang harus selalu terjadi.
8. Gunakan `Comparator` eksplisit untuk deterministic choice ordering.
9. Pisahkan `no solution`, `invalid input`, dan `search limit exceeded`.
10. Tambahkan budget untuk operasi exponential.
11. Tambahkan stats untuk observability.
12. Jangan parallelize backtracking sebelum sequential version benar dan terukur.

---

## 37. Latihan Bertahap

### Latihan 1 — Subset dengan Limit

Buat generator subset yang berhenti setelah menemukan `maxResults` subset.

Requirement:

- output deterministic;
- tidak menyimpan reference mutable;
- jika `maxResults <= 0`, return empty list;
- jika input length terlalu besar, reject.

### Latihan 2 — Combination Sum dengan Duplicate

Input bisa duplicate.

Requirement:

- output combination unik;
- setiap angka hanya boleh dipakai sekali;
- output sorted lexicographically;
- pruning valid hanya untuk angka non-negative.

### Latihan 3 — Assignment Officer

Assign case ke officer dengan capacity.

Requirement:

- find one solution;
- sort case descending effort;
- support officer skill constraint;
- return explanation jika tidak ada officer yang eligible untuk suatu case.

### Latihan 4 — Path Enumeration

Enumerate all simple path dari source ke target dalam graph.

Requirement:

- path-local visited;
- maxPaths;
- maxDepth;
- deterministic neighbor ordering;
- no-solution vs limit-exceeded dibedakan.

### Latihan 5 — Backtracking dengan Budget

Tambahkan:

- max visited nodes;
- timeout;
- stats;
- exception-safe rollback.

---

## 38. Ringkasan Mental Model

Recursion adalah cara mengekspresikan problem yang memiliki struktur self-similar. Backtracking adalah DFS atas search tree dengan apply/undo state. Kekuatan backtracking ada pada fleksibilitasnya, tetapi kelemahannya adalah search space yang sering exponential.

Untuk engineer yang bekerja di sistem nyata, hal terpenting bukan menghafal template, tetapi memahami:

- state;
- choice;
- invariant;
- constraint;
- pruning;
- rollback;
- depth;
- budget;
- determinism;
- explanation;
- failure boundary.

Backtracking yang baik bukan hanya menghasilkan solusi. Backtracking yang baik juga tahu kapan harus berhenti, kapan harus menolak input, bagaimana menjelaskan kegagalan, dan bagaimana menjaga state tetap benar walaupun terjadi exception atau timeout.

---

## 39. Referensi

- Oracle Java SE 25 Documentation — `StackOverflowError`.
- Oracle Java SE 25 Documentation — `ArrayDeque`.
- Oracle Java SE 25 Documentation — `Deque`.
- Oracle Java SE 25 Documentation — Java Collections Framework Overview.

---

## 40. Status Seri

Bagian ini menyelesaikan:

```text
Part 017 — Recursion, Backtracking, Search Space Pruning
```

Status seri: **belum selesai**.

Progress:

```text
Selesai: Part 000 sampai Part 017
Berikutnya: Part 018 — Dynamic Programming I: Mental Model, Memoization, Tabulation
Sisa: Part 018 sampai Part 030
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-dsa-part-016.md](./learn-java-dsa-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-018 — Dynamic Programming I: Mental Model, Memoization, Tabulation](./learn-java-dsa-part-018.md)

</div>