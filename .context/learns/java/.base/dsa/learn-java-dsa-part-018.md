# learn-java-dsa-part-018 — Dynamic Programming I: Mental Model, Memoization, Tabulation

> Seri: Java Data Structure and Algorithm Advanced  
> Bagian: 018 dari 030  
> Status seri: belum selesai  
> Fokus: membangun fondasi berpikir Dynamic Programming secara benar, bukan menghafal template.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami Dynamic Programming sebagai teknik desain algoritma berbasis **state**, **transition**, dan **reuse of subproblem results**.
2. Membedakan kapan sebuah masalah cocok memakai DP dan kapan tidak.
3. Mendesain state DP dari requirement, bukan dari hafalan pattern.
4. Menentukan base case, transition, evaluation order, dan answer extraction.
5. Mengubah recursive brute force menjadi memoization.
6. Mengubah memoization menjadi tabulation.
7. Melakukan state compression saat aman.
8. Melakukan reconstruction untuk mengambil solusi, bukan hanya nilai optimum.
9. Menghindari bug DP yang umum di Java: wrong key, mutable key, boxing overhead, accidental exponential recursion, wrong iteration order, dan memory explosion.
10. Membaca DP sebagai model engineering: caching keputusan, evaluating state machine, cost minimization, bounded allocation, dan dependency computation.

---

## 1. Mental Model Utama: DP Bukan Rumus, DP Adalah Reuse atas State

Dynamic Programming sering diajarkan sebagai kumpulan problem klasik:

- Fibonacci,
- climbing stairs,
- knapsack,
- longest common subsequence,
- edit distance,
- coin change,
- matrix path,
- interval DP.

Masalahnya, kalau DP dipelajari dari daftar soal, engineer sering menjadi “pattern matcher” lemah:

> “Ini kayak knapsack?”  
> “Ini kayak LIS?”  
> “Ini kayak coin change?”

Padahal mental model yang lebih kuat adalah:

> DP digunakan ketika banyak keputusan berbeda membawa kita ke **subproblem yang sama**, sehingga hasil subproblem tersebut layak disimpan dan dipakai ulang.

Dalam bentuk sederhana:

```text
problem(state) = combine(problem(nextState1), problem(nextState2), ...)
```

Jika `problem(state)` muncul berulang dari banyak jalur keputusan, maka tanpa cache kita menghitung hal yang sama berkali-kali.

DP adalah cara sistematis untuk berkata:

> “Untuk setiap state yang valid, hitung jawabannya tepat sekali, lalu gunakan jawabannya sebanyak yang dibutuhkan.”

---

## 2. Dua Syarat DP

Sebuah problem biasanya cocok untuk DP jika punya dua properti.

### 2.1 Overlapping Subproblems

Subproblem yang sama muncul berulang kali.

Contoh Fibonacci:

```text
fib(5)
= fib(4) + fib(3)
= fib(3) + fib(2) + fib(2) + fib(1)
= ...
```

`fib(3)`, `fib(2)`, dan seterusnya dihitung berkali-kali.

Tanpa reuse, computation tree membesar secara eksponensial.

Dengan memoization:

```text
fib(n) dihitung sekali untuk setiap n
```

Cost berubah dari kira-kira exponential menjadi linear.

### 2.2 Optimal Substructure

Jawaban problem besar bisa dibangun dari jawaban subproblem yang benar.

Contoh shortest path:

Jika path terbaik dari `A` ke `D` melalui `B`, maka bagian path dari `B` ke `D` juga harus optimal untuk subproblem `B -> D`. Kalau tidak, path total bisa diperbaiki.

Dalam DP, kita butuh sifat seperti ini:

```text
best(state) = choose best among valid transitions to smaller/future states
```

Tanpa optimal substructure, menyimpan jawaban lokal tidak cukup untuk menjamin jawaban global.

---

## 3. DP sebagai Graph of States

Cara paling powerful melihat DP:

> DP adalah graph traversal di atas state graph.

Setiap state adalah node.
Setiap transition adalah edge.
Jawaban dihitung dengan mengalirkan informasi antar node.

Misalnya:

```text
state: i
transition: i -> i - 1, i -> i - 2
problem: fib(i)
```

Graph-nya:

```text
5 -> 4 -> 3 -> 2 -> 1
|    |    |    |
v    v    v    v
3 -> 2 -> 1 -> 0
```

Banyak edge menuju state yang sama.

Memoization berarti:

```text
DFS + cache result per node
```

Tabulation berarti:

```text
Topological evaluation order over state graph
```

Kalau state graph punya cycle tanpa mekanisme convergence, problem bukan DP biasa. Mungkin perlu shortest path, fixed-point iteration, graph algorithm, atau dynamic programming dengan stage dimension.

---

## 4. Formula Inti DP

Setiap DP yang sehat biasanya bisa dijelaskan dengan 6 elemen:

| Elemen | Pertanyaan |
|---|---|
| State | Informasi minimum apa yang mendeskripsikan subproblem? |
| Meaning | `dp[state]` artinya apa secara persis? |
| Base case | State apa yang jawabannya langsung diketahui? |
| Transition | Dari state ini, opsi keputusan apa saja yang valid? |
| Order | State mana harus dihitung lebih dulu? |
| Answer | Jawaban final diambil dari state mana? |

Kalau salah satu tidak jelas, DP biasanya rapuh.

---

## 5. Kesalahan Terbesar: State Tidak Didefinisikan dengan Presisi

Banyak orang menulis:

```java
int[] dp = new int[n + 1];
```

Tapi tidak bisa menjawab:

```text
dp[i] itu apa?
```

Ini bahaya. `dp[i]` bisa berarti:

1. jumlah cara untuk mencapai posisi `i`,
2. biaya minimum sampai posisi `i`,
3. biaya minimum dari posisi `i` ke akhir,
4. nilai maksimum memakai item pertama sampai `i`,
5. apakah prefix sampai `i` valid,
6. panjang subsequence terbaik yang berakhir di `i`,
7. panjang subsequence terbaik dalam prefix `0..i`.

Semua memakai `dp[i]`, tapi transition dan order-nya berbeda.

Rule:

> Sebelum menulis kode DP, tulis kalimat `dp[...] means ...`.

Contoh benar:

```text
dp[i] = minimum cost needed to reach step i.
```

atau:

```text
dp[i][w] = maximum value obtainable using first i items with capacity limit w.
```

atau:

```text
dp[i][j] = length of longest common subsequence between a[0..i) and b[0..j).
```

Perhatikan penggunaan `[0..i)` yang eksplisit. Dalam DP string/array, boundary half-open sering membuat reasoning lebih bersih.

---

## 6. Contoh 1: Fibonacci sebagai DP Minimal

Fibonacci bukan contoh production yang bagus, tapi bagus untuk melihat transformasi.

### 6.1 Recursive Exponential

```java
static long fibSlow(int n) {
    if (n < 0) {
        throw new IllegalArgumentException("n must be non-negative");
    }
    if (n <= 1) {
        return n;
    }
    return fibSlow(n - 1) + fibSlow(n - 2);
}
```

Masalah:

```text
fib(n - 2) dihitung ulang di banyak cabang.
```

### 6.2 Memoization

```java
import java.util.Arrays;

final class FibonacciMemo {
    static long fib(int n) {
        if (n < 0) {
            throw new IllegalArgumentException("n must be non-negative");
        }
        long[] memo = new long[n + 1];
        Arrays.fill(memo, -1L);
        return fib(n, memo);
    }

    private static long fib(int n, long[] memo) {
        if (n <= 1) {
            return n;
        }
        if (memo[n] != -1L) {
            return memo[n];
        }
        long value = fib(n - 1, memo) + fib(n - 2, memo);
        memo[n] = value;
        return value;
    }
}
```

State:

```text
dp[n] = nth Fibonacci number
```

Base:

```text
dp[0] = 0
dp[1] = 1
```

Transition:

```text
dp[n] = dp[n - 1] + dp[n - 2]
```

Complexity:

```text
Time:  O(n)
Space: O(n) memo + O(n) call stack
```

### 6.3 Tabulation

```java
final class FibonacciTabulation {
    static long fib(int n) {
        if (n < 0) {
            throw new IllegalArgumentException("n must be non-negative");
        }
        if (n <= 1) {
            return n;
        }

        long[] dp = new long[n + 1];
        dp[0] = 0L;
        dp[1] = 1L;

        for (int i = 2; i <= n; i++) {
            dp[i] = dp[i - 1] + dp[i - 2];
        }

        return dp[n];
    }
}
```

Complexity:

```text
Time:  O(n)
Space: O(n)
```

### 6.4 State Compression

Karena `dp[i]` hanya butuh dua state sebelumnya, array penuh tidak diperlukan.

```java
final class FibonacciCompressed {
    static long fib(int n) {
        if (n < 0) {
            throw new IllegalArgumentException("n must be non-negative");
        }
        if (n <= 1) {
            return n;
        }

        long prev2 = 0L;
        long prev1 = 1L;

        for (int i = 2; i <= n; i++) {
            long current = prev1 + prev2;
            prev2 = prev1;
            prev1 = current;
        }

        return prev1;
    }
}
```

Complexity:

```text
Time:  O(n)
Space: O(1)
```

Important:

State compression aman hanya karena kita tidak butuh semua historical states untuk future transition atau reconstruction.

---

## 7. Memoization vs Tabulation

### 7.1 Memoization

Memoization adalah top-down DP.

Karakteristik:

1. Mulai dari target answer.
2. Recursive exploration ke state yang dibutuhkan.
3. Cache hasil state.
4. Tidak menghitung unreachable state.
5. Natural untuk problem dengan state sparse.
6. Risiko stack overflow jika depth besar.
7. Bisa mahal jika key berupa object dan banyak boxing/hash.

Template:

```java
Result solve(State state) {
    if (isBase(state)) {
        return baseResult(state);
    }
    Result cached = memo.get(state);
    if (cached != null) {
        return cached;
    }
    Result best = combineTransitions(state);
    memo.put(state, best);
    return best;
}
```

Catatan Java:

Jika `Result` bisa bernilai `null`, jangan pakai `null` sebagai marker cache. Gunakan:

- `containsKey`,
- sentinel object,
- `Optional` dengan hati-hati,
- primitive array + visited boolean,
- custom state marker.

### 7.2 Tabulation

Tabulation adalah bottom-up DP.

Karakteristik:

1. Mulai dari base state.
2. Mengisi table dalam order yang valid.
3. Tidak memakai recursion.
4. Biasanya lebih cache-friendly jika table berupa primitive array.
5. Bisa menghitung state yang sebenarnya tidak diperlukan.
6. Membutuhkan evaluation order yang benar.

Template:

```java
initializeBaseCases(dp);

for (State state : statesInValidOrder) {
    dp[state] = combineAlreadyComputedStates(state);
}

return extractAnswer(dp);
```

---

## 8. Memilih Memoization atau Tabulation

| Situasi | Bias Pilihan |
|---|---|
| State space kecil dan dense | Tabulation |
| State space besar tapi reachable state sedikit | Memoization |
| Transition order jelas | Tabulation |
| Transition order kompleks | Memoization |
| Depth recursion bisa sangat besar | Tabulation / iterative explicit stack |
| Butuh performance tinggi di Java | Tabulation dengan primitive array |
| State berupa composite object | Memoization dengan record key, atau compress ke index |
| Butuh reconstruction mudah | Keduanya bisa, tapi tabulation sering lebih eksplisit |

Production rule:

> Untuk workload besar dan predictable, tabulation dengan primitive array biasanya lebih stabil. Untuk search space sparse dan branching dinamis, memoization sering lebih sederhana dan hemat state.

---

## 9. Designing State: Minimum Sufficient Information

State harus memuat informasi yang cukup untuk menyelesaikan sisa problem, tetapi tidak boleh membawa informasi berlebihan.

### 9.1 State Terlalu Kecil

Misalnya problem:

> Pilih item dari index `i` sampai akhir, dengan kapasitas remaining `w`.

State salah:

```text
dp[i]
```

Kenapa salah?

Karena keputusan optimal dari `i` bergantung pada kapasitas tersisa.

State benar:

```text
dp[i][w]
```

Meaning:

```text
dp[i][w] = maximum value obtainable using items from i onward with remaining capacity w.
```

### 9.2 State Terlalu Besar

State buruk:

```text
dp[i][w][fullListOfChosenItems]
```

Kalau tujuan hanya nilai maksimum, daftar item yang dipilih tidak perlu menjadi bagian state. Ia membuat state space meledak.

Kalau butuh reconstruction, simpan decision parent secara terpisah, bukan memasukkan seluruh path ke state.

### 9.3 State Harus Menghapus History yang Tidak Relevan

DP bekerja ketika masa depan hanya bergantung pada ringkasan state, bukan seluruh history.

Ini mirip Markov property:

```text
future depends on current state, not on how we reached it
```

Kalau dua jalur berbeda tiba di state yang sama dan masa depan identik, state itu bisa di-cache.

Kalau masa depan berbeda karena history yang tidak ada di state, state terlalu kecil.

---

## 10. Contoh 2: Minimum Cost Climbing Stairs

Problem:

Diberikan array `cost`, di mana `cost[i]` adalah biaya menginjak step `i`. Dari step, bisa naik 1 atau 2. Cari biaya minimum untuk mencapai setelah step terakhir.

### 10.1 State Definition

Gunakan:

```text
dp[i] = minimum cost to reach step i
```

Di sini `i` bisa berarti posisi virtual dari `0` sampai `n`, dengan `n` adalah posisi setelah step terakhir.

Base:

```text
dp[0] = 0
dp[1] = 0
```

Karena bisa mulai dari step 0 atau step 1 tanpa biaya sebelum menginjak.

Transition:

```text
dp[i] = min(
  dp[i - 1] + cost[i - 1],
  dp[i - 2] + cost[i - 2]
)
```

Answer:

```text
dp[n]
```

### 10.2 Java Implementation

```java
import java.util.Objects;

final class MinCostClimbingStairs {
    static int minCost(int[] cost) {
        Objects.requireNonNull(cost, "cost must not be null");

        int n = cost.length;
        if (n <= 1) {
            return 0;
        }

        int[] dp = new int[n + 1];
        dp[0] = 0;
        dp[1] = 0;

        for (int i = 2; i <= n; i++) {
            int fromPrevious = dp[i - 1] + cost[i - 1];
            int fromTwoBack = dp[i - 2] + cost[i - 2];
            dp[i] = Math.min(fromPrevious, fromTwoBack);
        }

        return dp[n];
    }
}
```

### 10.3 State Compression

```java
import java.util.Objects;

final class MinCostClimbingStairsCompressed {
    static int minCost(int[] cost) {
        Objects.requireNonNull(cost, "cost must not be null");

        int n = cost.length;
        if (n <= 1) {
            return 0;
        }

        int prev2 = 0; // dp[i - 2]
        int prev1 = 0; // dp[i - 1]

        for (int i = 2; i <= n; i++) {
            int current = Math.min(
                    prev1 + cost[i - 1],
                    prev2 + cost[i - 2]
            );
            prev2 = prev1;
            prev1 = current;
        }

        return prev1;
    }
}
```

### 10.4 Key Lesson

DP menjadi jelas karena state meaning jelas:

```text
dp[i] = minimum cost to reach position i
```

Bukan:

```text
dp[i] = some minimum cost
```

---

## 11. Contoh 3: Number of Ways vs Minimum Cost

Dua problem bisa terlihat mirip tapi aggregation-nya berbeda.

### 11.1 Number of Ways

```text
dp[i] = number of ways to reach i
```

Transition:

```text
dp[i] = dp[i - 1] + dp[i - 2]
```

Aggregation: sum.

### 11.2 Minimum Cost

```text
dp[i] = minimum cost to reach i
```

Transition:

```text
dp[i] = min(dp[i - 1] + cost1, dp[i - 2] + cost2)
```

Aggregation: min.

### 11.3 Maximum Value

```text
dp[i] = maximum value achievable up to i
```

Transition:

```text
dp[i] = max(take, skip)
```

Aggregation: max.

### 11.4 Feasibility

```text
dp[i] = whether i is reachable
```

Transition:

```text
dp[i] = dp[i - 1] || dp[i - 2]
```

Aggregation: boolean OR.

Mental model:

> DP bukan selalu mencari minimum atau maksimum. DP menghitung value dari state. Value bisa berupa count, bool, min cost, max score, set, parent pointer, atau composite result.

---

## 12. Contoh 4: Word Break sebagai Feasibility DP

Problem:

Diberikan string `s` dan dictionary kata. Tentukan apakah `s` bisa dipecah menjadi sequence kata valid.

Contoh:

```text
s = "applepenapple"
dict = {"apple", "pen"}
answer = true
```

### 12.1 State Definition

```text
dp[i] = whether prefix s[0..i) can be segmented into dictionary words
```

Base:

```text
dp[0] = true
```

Transition:

```text
dp[i] = true if there exists j < i such that:
  dp[j] == true
  and s[j..i) is in dictionary
```

Answer:

```text
dp[n]
```

### 12.2 Java Implementation

```java
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

final class WordBreakDp {
    static boolean canSegment(String s, Set<String> dictionary) {
        Objects.requireNonNull(s, "s must not be null");
        Objects.requireNonNull(dictionary, "dictionary must not be null");

        Set<String> words = new HashSet<>(dictionary);
        int n = s.length();
        boolean[] dp = new boolean[n + 1];
        dp[0] = true;

        for (int i = 1; i <= n; i++) {
            for (int j = 0; j < i; j++) {
                if (dp[j] && words.contains(s.substring(j, i))) {
                    dp[i] = true;
                    break;
                }
            }
        }

        return dp[n];
    }
}
```

Complexity:

```text
Time:  O(n^3) in worst case if substring copying/hash cost is O(length)
Space: O(n + dictionary size)
```

Why `O(n^3)`?

There are `O(n^2)` pairs `(j, i)`, and substring/hash may cost up to `O(n)` depending on length.

### 12.3 Improved with Max Word Length

If dictionary max word length is bounded, reduce unnecessary checks.

```java
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

final class WordBreakDpBounded {
    static boolean canSegment(String s, Set<String> dictionary) {
        Objects.requireNonNull(s, "s must not be null");
        Objects.requireNonNull(dictionary, "dictionary must not be null");

        Set<String> words = new HashSet<>(dictionary);
        int maxWordLength = 0;
        for (String word : words) {
            if (word == null) {
                throw new IllegalArgumentException("dictionary must not contain null");
            }
            maxWordLength = Math.max(maxWordLength, word.length());
        }

        int n = s.length();
        boolean[] dp = new boolean[n + 1];
        dp[0] = true;

        for (int i = 1; i <= n; i++) {
            int start = Math.max(0, i - maxWordLength);
            for (int j = start; j < i; j++) {
                if (dp[j] && words.contains(s.substring(j, i))) {
                    dp[i] = true;
                    break;
                }
            }
        }

        return dp[n];
    }
}
```

### 12.4 Engineering Note

This is DP, but the bottleneck may not be DP table. It may be:

1. substring allocation,
2. hash computation,
3. dictionary lookup,
4. Unicode boundary semantics,
5. memory churn.

For high-throughput production text segmentation, you might combine DP with trie to avoid creating many substring objects.

---

## 13. DP Table as Cache: Java API Implications

DP table is a cache.

The choice of cache representation matters.

### 13.1 Primitive Array

Best when state is dense integer range.

```java
int[] dp = new int[n + 1];
boolean[] seen = new boolean[n + 1];
```

Pros:

1. compact,
2. fast access,
3. no boxing,
4. cache-friendly,
5. no hash cost.

Cons:

1. requires state-to-index mapping,
2. bad for sparse huge state,
3. fixed size.

### 13.2 2D Primitive Array

```java
int[][] dp = new int[n + 1][capacity + 1];
```

Pros:

1. simple,
2. fast enough for moderate size,
3. natural indexing.

Cons:

1. many row objects,
2. memory overhead,
3. possible memory explosion,
4. less contiguous than a flat array.

Flat alternative:

```java
int[] dp = new int[(n + 1) * (capacity + 1)];
int index = i * (capacity + 1) + w;
```

This is often more memory/cache predictable, but less readable.

### 13.3 HashMap with Composite State

Useful for sparse state.

```java
import java.util.HashMap;
import java.util.Map;

record State(int index, int remainingBudget) {}

final class SparseMemoExample {
    private final Map<State, Integer> memo = new HashMap<>();

    int solve(int index, int remainingBudget) {
        State state = new State(index, remainingBudget);
        Integer cached = memo.get(state);
        if (cached != null) {
            return cached;
        }

        int result = compute(index, remainingBudget);
        memo.put(state, result);
        return result;
    }

    private int compute(int index, int remainingBudget) {
        return 0;
    }
}
```

Records are good DP keys because they provide value-based `equals` and `hashCode` automatically based on components.

But watch:

1. object allocation per state,
2. hashing overhead,
3. memory overhead per map entry,
4. GC pressure,
5. no deterministic order unless using ordered map.

The Java `Map` API provides methods like `computeIfAbsent`, but for recursive DP, use it carefully: the mapping function must not create confusing reentrant updates or hide expensive recursion inside a map API call. The plain `get` / compute / `put` pattern is often easier to debug.

---

## 14. Sentinel Values and Unknown States

DP often needs to distinguish:

```text
not computed yet
```

from legitimate computed values.

Bad example:

```java
int[] memo = new int[n + 1];
// assume 0 means unknown
```

If valid answer can be `0`, this is wrong.

Better:

```java
int[] memo = new int[n + 1];
boolean[] computed = new boolean[n + 1];
```

or sentinel outside valid domain:

```java
import java.util.Arrays;

int[] memo = new int[n + 1];
Arrays.fill(memo, -1);
```

Only safe if answer is never `-1`.

For minimization:

```java
static final int INF = 1_000_000_000;
```

But avoid overflow:

```java
if (previous != INF) {
    candidate = previous + cost;
}
```

Better for large sums:

```java
static final long INF = Long.MAX_VALUE / 4;
```

Using `Long.MAX_VALUE` directly can overflow when adding.

---

## 15. Integer Overflow in DP

DP often counts ways or accumulates cost.

### 15.1 Count DP Overflow

Number of ways can grow exponentially.

```java
int ways = dp[i - 1] + dp[i - 2];
```

This may overflow silently.

Options:

1. use `long`,
2. use modulo arithmetic,
3. use `BigInteger`,
4. reject input if result exceeds limit,
5. use saturating arithmetic if business semantics allow.

Modulo example:

```java
static final int MOD = 1_000_000_007;

dp[i] = (dp[i - 1] + dp[i - 2]) % MOD;
```

But modulo changes semantics. Do not use modulo unless requirement explicitly asks for modulo result.

### 15.2 Cost DP Overflow

```java
int candidate = dp[j] + cost;
```

If both large, overflow can turn positive into negative.

Safer:

```java
static final long INF = Long.MAX_VALUE / 4;

long candidate = dp[j] + cost;
```

or:

```java
long candidate = Math.addExact(dp[j], cost);
```

`Math.addExact` throws if overflow occurs, useful when overflow indicates invalid input or implementation bug.

---

## 16. Evaluation Order

Tabulation requires states to be computed before they are used.

Example:

```text
dp[i] depends on dp[i - 1] and dp[i - 2]
```

Order:

```text
i ascending
```

For 2D:

```text
dp[i][j] depends on dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]
```

Order:

```text
i ascending, j ascending
```

For reverse dependency:

```text
dp[i] depends on dp[i + 1]
```

Order:

```text
i descending
```

Wrong order may compile and run but produce plausible wrong answers.

Rule:

> Draw arrows. Iterate opposite to dependency arrows only if values are already initialized correctly; otherwise iterate in topological order of dependency graph.

---

## 17. 0/1 Knapsack Preview: Why Iteration Direction Matters

Full knapsack pattern will be covered in Part 019, but this example is important for state compression.

Problem:

Each item can be taken at most once.

2D meaning:

```text
dp[i][w] = max value using first i items with capacity w
```

Transition:

```text
dp[i][w] = max(
  dp[i - 1][w],
  dp[i - 1][w - weight[i]] + value[i]
)
```

When compressed to 1D:

```text
dp[w] = max value for current processed items and capacity w
```

Correct iteration:

```java
for (int item = 0; item < n; item++) {
    for (int w = capacity; w >= weight[item]; w--) {
        dp[w] = Math.max(dp[w], dp[w - weight[item]] + value[item]);
    }
}
```

Why descending?

Because each item can be used once. If `w` ascends, `dp[w - weight]` may already include the current item, causing repeated usage.

For unbounded knapsack, ascending may be correct because repeated usage is allowed.

Lesson:

> State compression changes dependency hazards. Iteration order becomes part of correctness.

---

## 18. Reconstruction: Getting the Actual Solution

Many DP examples only return value:

```text
minimum cost = 17
```

But production often needs:

```text
which choices led to 17?
```

Examples:

1. which rules matched,
2. which tasks selected,
3. which path chosen,
4. which allocation plan generated,
5. which string segmentation produced validity.

### 18.1 Parent Pointer Pattern

Store decision while computing DP.

Example: minimum jumps/path over array.

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

final class MinCostPathReconstruction {
    record Result(int cost, List<Integer> positions) {}

    static Result minCostPath(int[] cost) {
        Objects.requireNonNull(cost, "cost must not be null");
        int n = cost.length;
        if (n == 0) {
            return new Result(0, List.of());
        }

        int[] dp = new int[n];
        int[] parent = new int[n];
        Arrays.fill(dp, Integer.MAX_VALUE / 4);
        Arrays.fill(parent, -1);

        dp[0] = cost[0];

        for (int i = 1; i < n; i++) {
            // from i - 1
            if (dp[i - 1] + cost[i] < dp[i]) {
                dp[i] = dp[i - 1] + cost[i];
                parent[i] = i - 1;
            }

            // from i - 2
            if (i >= 2 && dp[i - 2] + cost[i] < dp[i]) {
                dp[i] = dp[i - 2] + cost[i];
                parent[i] = i - 2;
            }
        }

        List<Integer> path = new ArrayList<>();
        for (int at = n - 1; at != -1; at = parent[at]) {
            path.add(at);
        }
        Collections.reverse(path);

        return new Result(dp[n - 1], List.copyOf(path));
    }
}
```

### 18.2 Tie-Breaking Is Part of Determinism

If two choices have equal cost, which one should be chosen?

Bad:

```java
if (candidate < best) update();
```

This silently preserves first choice depending on iteration order.

Sometimes okay, sometimes dangerous.

Better define:

```text
If costs tie, choose lexicographically smaller path.
If costs tie, choose fewer items.
If costs tie, choose earliest deadline.
If costs tie, choose stable input order.
```

Production systems need deterministic output, especially for audit, reports, and reproducible decisions.

---

## 19. DP and Domain Engineering

DP is not only for competitive programming.

It appears whenever we answer:

```text
What is the best feasible result under constraints?
```

or:

```text
How many ways can this state be reached?
```

or:

```text
Can this target be constructed from available components?
```

### 19.1 Case Management Example: Minimum Escalation Cost

Suppose a case can be resolved through actions:

```text
request-info, reminder, supervisor-review, enforcement, closure
```

Each action has:

1. cost,
2. allowed state,
3. resulting state,
4. deadline impact,
5. risk score impact.

Question:

```text
What is the minimum-cost sequence to reach terminal state within SLA?
```

This may become shortest path or DP depending on graph properties.

If states progress by stage and never cycle, DP works naturally:

```text
dp[stage][remainingDays][riskLevel] = minimum operational cost
```

If transitions can cycle, use graph shortest path or add constraints that make state acyclic.

### 19.2 Bounded Allocation Example

Given limited reviewer capacity, assign cases to reviewers maximizing priority handled.

This resembles knapsack:

```text
item = case
weight = estimated effort
value = priority / SLA risk reduction
capacity = reviewer available hours
```

State:

```text
dp[i][h] = maximum priority value using first i cases within h hours
```

But production requires extra dimensions:

1. skill match,
2. conflict of interest,
3. team ownership,
4. deadline,
5. fairness,
6. deterministic tie-breaking.

DP can still help, but state explosion becomes the design constraint.

### 19.3 Rule Matching Example

Suppose a rule expression can be built from tokens and dictionary clauses.

Question:

```text
Can this expression be segmented into valid clauses?
```

This resembles Word Break.

State:

```text
dp[i] = whether prefix tokens[0..i) can be parsed into valid clauses
```

This is DP applied to parsing/validation.

---

## 20. DP vs Greedy vs Graph Search

Not every optimization problem is DP.

### 20.1 Use Greedy When Local Choice Is Provably Safe

If local optimal choice can be proven not to hurt global optimality, greedy is simpler and often faster.

Example:

```text
interval scheduling by earliest finish time
```

### 20.2 Use DP When Choices Interact Through State

If choosing something affects future remaining capacity/state, DP often fits.

Example:

```text
knapsack: choosing item consumes capacity and changes future choices
```

### 20.3 Use Graph Search When State Transitions Form a General Graph

If states and transitions are arbitrary and may cycle, use graph algorithms:

1. BFS for unweighted shortest path,
2. Dijkstra for non-negative weights,
3. Bellman-Ford for negative weights,
4. topological DP for DAG.

DP is often graph search on a DAG.

---

## 21. Java-Specific DP Performance Notes

### 21.1 Prefer Primitive Arrays for Dense Numeric DP

Good:

```java
int[] dp = new int[n + 1];
long[][] cost = new long[n + 1][m + 1];
boolean[] reachable = new boolean[target + 1];
```

Avoid unless needed:

```java
List<Integer> dp = new ArrayList<>();
Map<Integer, Integer> dp = new HashMap<>();
```

Why?

Because `Integer` boxing creates objects or uses cached wrappers only for limited range; either way, it adds indirection and overhead.

### 21.2 Avoid Mutable Objects as Memo Keys

Bad:

```java
final class State {
    int i;
    int budget;
}
```

If inserted into `HashMap` and then mutated, lookup may break because hash bucket no longer matches logical value.

Good:

```java
record State(int i, int budget) {}
```

Records are immutable by convention if components are immutable/primitive.

### 21.3 Beware `computeIfAbsent` in Recursive DP

Tempting:

```java
return memo.computeIfAbsent(state, this::solveState);
```

This can be elegant, but be careful:

1. recursion becomes hidden inside map operation,
2. exceptions can leave debugging harder,
3. recursive dependencies involving same key can be problematic,
4. mapping function should not mutate map in surprising ways.

Clearer for complex DP:

```java
Integer cached = memo.get(state);
if (cached != null) {
    return cached;
}
int result = compute(state);
memo.put(state, result);
return result;
```

### 21.4 Use Flat Arrays for Large 2D Tables

Instead of:

```java
int[][] dp = new int[n][m];
```

Consider:

```java
int[] dp = new int[n * m];
int idx = row * m + col;
```

Benefits:

1. fewer objects,
2. better memory locality,
3. simpler bulk initialization,
4. more predictable footprint.

Trade-off:

1. less readable,
2. index calculation mistakes,
3. potential overflow in `n * m`.

Safer:

```java
int size = Math.multiplyExact(n, m);
int[] dp = new int[size];
```

### 21.5 Memory Explosion Is a Correctness Problem

If table size is:

```text
n * m * k
```

and each cell is 8 bytes, memory can explode quickly.

Example:

```text
10_000 * 10_000 long cells = 100_000_000 * 8 bytes = ~800 MB raw data
```

And Java array/object overhead adds more.

For production:

1. estimate table size before allocating,
2. reject impossible input early,
3. compress state,
4. use sparse memoization,
5. stream by layer,
6. consider approximation or different algorithm.

---

## 22. DP Design Checklist

Before coding:

1. What exactly is the final answer?
2. What is the state?
3. What does `dp[state]` mean in one precise sentence?
4. What are the base cases?
5. What choices are available from each state?
6. How do choices transform state?
7. How are subproblem results combined?
8. Is the state graph acyclic?
9. If tabulation, what is the valid evaluation order?
10. If memoization, how deep can recursion go?
11. Is state space dense or sparse?
12. What data structure represents the DP cache?
13. Can answers overflow `int` or `long`?
14. Is reconstruction required?
15. What is the tie-breaking rule?
16. Can state be compressed?
17. Does compression preserve correctness?
18. What is the worst-case memory footprint?
19. What are invalid inputs?
20. What test cases prove boundary and transition correctness?

---

## 23. DP Testing Strategy

### 23.1 Base Cases

Test smallest inputs:

1. empty array/string,
2. single element,
3. two elements,
4. zero capacity,
5. impossible target.

### 23.2 Transition Cases

Use small input where you can manually enumerate answer.

Example:

```text
cost = [10, 15, 20]
answer = 15
```

### 23.3 Tie Cases

If two solutions have same score, assert deterministic choice.

### 23.4 Impossible Cases

For feasibility/min-cost:

1. no valid segmentation,
2. no reachable target,
3. capacity insufficient.

### 23.5 Large Cases

Test:

1. memory footprint,
2. recursion depth,
3. overflow,
4. performance.

### 23.6 Cross-check with Brute Force

For small `n`, compare DP against brute force.

This is powerful.

```java
// For n <= 20, brute force all subsets.
// For larger n, use DP only.
```

Property-based testing can generate random small cases and compare brute force vs DP.

---

## 24. Worked Example: Target Sum Feasibility

Problem:

Given positive integers `numbers` and target `T`, determine whether some subset sums exactly to `T`.

### 24.1 State

```text
dp[s] = whether sum s is reachable using processed numbers so far
```

Base:

```text
dp[0] = true
```

Transition:

For each number `x`, update:

```text
dp[s] = dp[s] || dp[s - x]
```

For 0/1 subset, iterate `s` descending.

### 24.2 Java Implementation

```java
import java.util.Objects;

final class SubsetSumFeasibility {
    static boolean canReach(int[] numbers, int target) {
        Objects.requireNonNull(numbers, "numbers must not be null");
        if (target < 0) {
            return false;
        }

        boolean[] reachable = new boolean[target + 1];
        reachable[0] = true;

        for (int x : numbers) {
            if (x < 0) {
                throw new IllegalArgumentException("numbers must be non-negative");
            }
            if (x > target) {
                continue;
            }
            for (int sum = target; sum >= x; sum--) {
                reachable[sum] = reachable[sum] || reachable[sum - x];
            }
        }

        return reachable[target];
    }
}
```

Why descending?

Because each number can be used once. Ascending would allow the same number to contribute multiple times in the same item iteration.

### 24.3 Reconstruction Version

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

final class SubsetSumReconstruction {
    static List<Integer> findSubset(int[] numbers, int target) {
        Objects.requireNonNull(numbers, "numbers must not be null");
        if (target < 0) {
            return List.of();
        }

        boolean[] reachable = new boolean[target + 1];
        int[] parentSum = new int[target + 1];
        int[] parentIndex = new int[target + 1];

        for (int i = 0; i <= target; i++) {
            parentSum[i] = -1;
            parentIndex[i] = -1;
        }

        reachable[0] = true;

        for (int i = 0; i < numbers.length; i++) {
            int x = numbers[i];
            if (x < 0) {
                throw new IllegalArgumentException("numbers must be non-negative");
            }
            if (x > target) {
                continue;
            }

            for (int sum = target; sum >= x; sum--) {
                if (!reachable[sum] && reachable[sum - x]) {
                    reachable[sum] = true;
                    parentSum[sum] = sum - x;
                    parentIndex[sum] = i;
                }
            }
        }

        if (!reachable[target]) {
            return List.of();
        }

        List<Integer> selectedIndexes = new ArrayList<>();
        int sum = target;
        while (sum != 0) {
            int index = parentIndex[sum];
            selectedIndexes.add(index);
            sum = parentSum[sum];
        }

        Collections.reverse(selectedIndexes);
        return List.copyOf(selectedIndexes);
    }
}
```

This returns selected indexes, not values. Returning indexes is often safer when duplicate values exist.

---

## 25. Common DP Failure Modes

### 25.1 Wrong State Meaning

Symptom:

```text
Code almost works but fails on edge cases.
```

Cause:

`dp[i]` meaning is vague or changes mid-code.

Fix:

Write state meaning as a comment before implementation.

### 25.2 Missing Dimension

Symptom:

```text
DP chooses invalid solution because it forgot a constraint.
```

Example:

Capacity, remaining time, used item count, previous selected state, or current mode is not included.

Fix:

Ask:

```text
Can two histories with same state produce different future choices?
```

If yes, state is missing information.

### 25.3 Too Many Dimensions

Symptom:

```text
Memory blows up.
```

Fix:

Remove history not needed for future decisions. Use parent pointers for reconstruction.

### 25.4 Wrong Iteration Direction

Symptom:

```text
0/1 item used multiple times.
```

Fix:

Check dependency after compression.

### 25.5 Sentinel Collision

Symptom:

```text
Memoization recomputes valid zero results or returns wrong unknown marker.
```

Fix:

Use `boolean[] computed`, `Optional`, or sentinel outside valid domain.

### 25.6 Overflow

Symptom:

```text
Minimum cost becomes negative.
Number of ways becomes random.
```

Fix:

Use `long`, `BigInteger`, modulo only if required, or `Math.addExact`.

### 25.7 Mutable Map Key

Symptom:

```text
Memoized value cannot be found later.
```

Fix:

Use immutable state keys, preferably records.

### 25.8 Recursion Depth

Symptom:

```text
StackOverflowError on large input.
```

Fix:

Use tabulation or explicit stack.

### 25.9 Hidden Allocation

Symptom:

```text
Algorithm is theoretically O(n^2), but production latency is terrible.
```

Cause:

Substring creation, boxed keys, record allocation, map nodes, object arrays.

Fix:

Use primitive arrays, index-based states, trie, rolling hash, or flat arrays.

---

## 26. A Practical DP Development Workflow

Use this workflow for real problems.

### Step 1: Write Brute Force Recurrence

Do not optimize first.

```text
solve(state):
  if base: return answer
  result = combine(solve(next states))
```

### Step 2: Identify Repeated States

Ask:

```text
Can different decision paths reach the same state?
```

If yes, memoize.

### Step 3: Define State Precisely

Write:

```text
dp[...] = ...
```

### Step 4: Add Memoization

Use array if state is dense; map if sparse.

### Step 5: Convert to Tabulation If Needed

Do this when:

1. recursion depth is unsafe,
2. performance needs to improve,
3. evaluation order is clear,
4. memory layout matters.

### Step 6: Compress State

Only after correctness is proven.

### Step 7: Add Reconstruction

Only if business needs actual decisions/path.

### Step 8: Benchmark and Bound Memory

For production, always estimate:

```text
states * bytes per state
```

---

## 27. Java DP Style Guide

### 27.1 Good Naming

Prefer:

```java
int itemCount = weights.length;
int capacityLimit = capacity;
long[] minCostByPosition = new long[n + 1];
boolean[] reachableSum = new boolean[target + 1];
```

Avoid:

```java
int[] arr;
int[][] t;
int x;
```

Unless in very local algorithm code where meaning is obvious.

### 27.2 Put State Meaning in Comment

```java
// reachable[sum] means: after processing items so far,
// whether a subset can produce exactly 'sum'.
boolean[] reachable = new boolean[target + 1];
```

### 27.3 Validate Inputs

Production DP should validate:

1. null arrays,
2. negative sizes,
3. negative weights if unsupported,
4. target too large,
5. multiplication overflow for table size.

### 27.4 Avoid Premature Cleverness

Start with readable 2D DP.
Then compress.
Then flatten.
Then specialize.

Correctness first. Performance second. Obscurity last.

---

## 28. Mini Exercise Set

### Exercise 1: Climbing Ways

Given `n`, count ways to climb using 1 or 2 steps.

Define:

```text
dp[i] = number of ways to reach step i
```

Implement:

1. memoized,
2. tabulated,
3. compressed.

Think about overflow.

### Exercise 2: Minimum Path Sum in Grid

Given non-negative grid, move only right or down. Find minimum path sum from top-left to bottom-right.

Define:

```text
dp[r][c] = minimum cost to reach cell (r, c)
```

Then try compress to one row.

### Exercise 3: Word Break Reconstruction

Modify Word Break to return one valid segmentation.

Use:

```text
parent[i] = previous split position j that makes s[j..i) valid
```

### Exercise 4: Subset Sum Count

Instead of feasibility, count number of subsets that produce target.

Question:

```text
Should sum iteration be ascending or descending?
```

### Exercise 5: Sparse Memo

Design a memoized solver where state is:

```java
record State(int index, int remainingBudget, int previousCategory) {}
```

Explain when this is better than a 3D array.

---

## 29. Summary

Dynamic Programming is not a bag of templates. It is a disciplined way to compute answers over repeated states.

The core skill is not memorizing recurrence. The core skill is designing state.

A strong DP solution always answers:

```text
What does dp[state] mean?
What are the base states?
What are the transitions?
What order makes dependencies valid?
What is the final answer state?
```

In Java, DP design must also account for:

1. primitive vs boxed representation,
2. dense array vs sparse map,
3. immutable memo keys,
4. recursion depth,
5. sentinel correctness,
6. integer overflow,
7. allocation and GC pressure,
8. memory footprint of multidimensional tables.

The best engineers do not ask only:

```text
What is the recurrence?
```

They ask:

```text
What is the state model, what invariant does it preserve, what cost does it impose, and how does it fail at production scale?
```

---

## 30. References

1. Oracle Java SE 25 API — `Map`: `computeIfAbsent`, map contract, optional operations.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html
2. Oracle Java SE 25 API — `HashMap`: hash-table based `Map` implementation and `computeIfAbsent`.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html
3. Oracle Java SE 25 API — `Arrays`: array utilities such as `fill`, sorting, searching, and manipulation.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html
4. Oracle Java SE 25 API — `ArrayList`: resizable-array implementation and list behavior.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html
5. OpenJDK Code Tools — JOL: Java Object Layout toolbox for object layout, footprint, and references.  
   https://openjdk.org/projects/code-tools/jol/

---

## 31. Status Seri

Bagian ini adalah **Part 018 dari 030**.

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-dsa-part-019 — Dynamic Programming II: Classic Patterns and Engineering Use
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dsa-part-017 — Recursion, Backtracking, Search Space Pruning](./learn-java-dsa-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java DSA — Part 019: Dynamic Programming II — Classic Patterns and Engineering Use](./learn-java-dsa-part-019.md)
