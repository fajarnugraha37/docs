# Learn Java DSA — Part 019: Dynamic Programming II — Classic Patterns and Engineering Use

> Seri: `Java Data Structure and Algorithm`  
> Part: `019 / 030`  
> Fokus: Dynamic Programming patterns, bukan hafalan rumus  
> Target: mampu mengenali bentuk problem, merancang state, memilih representasi Java yang efisien, melakukan reconstruction, dan menghubungkan DP dengan problem engineering nyata.

---

## 0. Posisi Part Ini dalam Seri

Pada **Part 018**, kita membangun fondasi Dynamic Programming:

- overlapping subproblems,
- optimal substructure,
- state,
- transition,
- base case,
- memoization,
- tabulation,
- state compression,
- reconstruction,
- kesalahan desain DP.

Pada part ini, kita masuk ke **pola-pola klasik** yang sering menjadi dasar problem solving advanced:

1. 1D DP.
2. 2D DP.
3. Knapsack family.
4. Longest Increasing Subsequence.
5. Longest Common Subsequence.
6. Edit Distance.
7. Interval DP.
8. Tree DP.
9. Bitmask DP.
10. Counting DP.
11. Optimization DP.
12. Translasi ke problem engineering nyata.

Tujuan part ini bukan membuat kamu hafal banyak rumus. Tujuannya adalah membuat kamu bisa melihat sebuah problem dan berkata:

> “Ini sebenarnya state-space problem. Dimensinya apa? Keputusan per step-nya apa? Apakah ada dependency order? Apakah perlu reconstruction? Apakah memory-nya bisa dikompresi? Apakah ini cocok sebagai DP atau seharusnya greedy/search/graph?”

---

## 1. Mental Model Utama: DP adalah Controlled State-Space Evaluation

Dynamic Programming sering dijelaskan sebagai “recursion + memoization” atau “table filling”. Itu benar, tetapi kurang cukup untuk engineer.

Secara engineering, DP adalah teknik untuk mengevaluasi state-space secara terkendali ketika:

1. Banyak state bisa muncul berulang.
2. Nilai sebuah state bisa dihitung dari state lain yang lebih kecil/lebih sederhana.
3. Kita bisa menentukan urutan evaluasi atau caching strategy.
4. Kita ingin menghindari eksplorasi eksponensial yang redundan.

DP bukan hanya untuk “algorithm problem”. DP sering muncul dalam:

- cost minimization,
- path/resource planning,
- bounded allocation,
- reconciliation,
- string matching,
- rule matching,
- dependency planning,
- state transition evaluation,
- scheduling,
- segmentation,
- version comparison,
- workflow impact calculation.

### 1.1 DP Selalu Punya Empat Elemen

Setiap DP serius harus bisa dijelaskan dengan empat hal:

| Elemen | Pertanyaan |
|---|---|
| State | Informasi minimum apa yang dibutuhkan untuk menjawab subproblem? |
| Transition | Dari state ini, state lebih kecil/lebih awal mana yang membentuk jawabannya? |
| Base Case | State paling sederhana yang nilainya diketahui langsung apa? |
| Evaluation Order | State mana dihitung dulu agar dependency tersedia? |

Kalau salah satu tidak jelas, biasanya DP akan gagal.

### 1.2 DP Bukan Berarti Semua Problem Harus Dibuat Table

Ada tiga bentuk umum:

| Bentuk | Cocok untuk |
|---|---|
| Top-down memoization | State sparse, natural recursive formulation, dependency tidak mudah diurutkan manual |
| Bottom-up tabulation | State dense, order jelas, butuh performa predictable |
| Hybrid | State sebagian dense, sebagian sparse, atau butuh pruning |

Dalam Java, pilihan ini sangat penting karena berpengaruh ke:

- object allocation,
- boxing/unboxing,
- cache locality,
- memory footprint,
- GC pressure,
- stack overflow risk,
- map key overhead.

---

## 2. Pattern 1 — 1D DP

1D DP adalah bentuk ketika state cukup direpresentasikan oleh satu parameter.

Contoh state:

```text
DP[i] = jawaban terbaik/total/count untuk prefix/posisi/ukuran i
```

Biasanya problem ini berbentuk:

- menghitung cara mencapai posisi `i`,
- biaya minimum sampai posisi `i`,
- nilai maksimum sampai kapasitas `i`,
- valid/tidaknya prefix panjang `i`,
- best value ending at index `i`.

---

## 3. 1D DP Example — Minimum Cost Climbing

### 3.1 Problem Model

Diberikan biaya pada tiap step. Kita bisa naik 1 atau 2 step. Cari biaya minimum mencapai top.

State:

```text
dp[i] = biaya minimum untuk mencapai step i
```

Transition:

```text
dp[i] = min(dp[i - 1] + cost[i - 1], dp[i - 2] + cost[i - 2])
```

Base case:

```text
dp[0] = 0
dp[1] = 0
```

Karena kita bisa mulai dari step 0 atau step 1.

### 3.2 Java Implementation — Table

```java
import java.util.Objects;

public final class MinCostClimbingStairs {
    private MinCostClimbingStairs() {}

    public static int minCost(int[] cost) {
        Objects.requireNonNull(cost, "cost must not be null");

        int n = cost.length;
        int[] dp = new int[n + 1];

        for (int i = 2; i <= n; i++) {
            int oneStep = dp[i - 1] + cost[i - 1];
            int twoSteps = dp[i - 2] + cost[i - 2];
            dp[i] = Math.min(oneStep, twoSteps);
        }

        return dp[n];
    }
}
```

Complexity:

| Resource | Cost |
|---|---:|
| Time | `O(n)` |
| Space | `O(n)` |

### 3.3 Space Compression

Karena `dp[i]` hanya bergantung pada `dp[i-1]` dan `dp[i-2]`, table penuh tidak wajib.

```java
import java.util.Objects;

public final class MinCostClimbingStairsCompressed {
    private MinCostClimbingStairsCompressed() {}

    public static int minCost(int[] cost) {
        Objects.requireNonNull(cost, "cost must not be null");

        int prev2 = 0; // dp[i - 2]
        int prev1 = 0; // dp[i - 1]

        for (int i = 2; i <= cost.length; i++) {
            int current = Math.min(prev1 + cost[i - 1], prev2 + cost[i - 2]);
            prev2 = prev1;
            prev1 = current;
        }

        return prev1;
    }
}
```

Complexity:

| Resource | Cost |
|---|---:|
| Time | `O(n)` |
| Space | `O(1)` |

### 3.4 Engineering Lesson

1D DP sering bisa dikompresi, tetapi jangan kompres terlalu cepat.

Jika butuh reconstruction path, table penuh atau parent pointer dibutuhkan.

Contoh:

- ingin tahu step mana yang dipilih,
- ingin explain decision ke user,
- ingin audit trail,
- ingin debugging.

Dalam production system, **explainability sering lebih penting daripada hemat sedikit memory**.

---

## 4. Pattern 2 — 2D DP

2D DP muncul ketika state butuh dua parameter.

Contoh bentuk:

```text
dp[i][j] = jawaban untuk prefix A sepanjang i dan prefix B sepanjang j
```

atau:

```text
dp[i][j] = jawaban untuk memilih dari item pertama i dengan kapasitas j
```

atau:

```text
dp[l][r] = jawaban untuk interval dari l sampai r
```

2D DP umum pada:

- LCS,
- edit distance,
- knapsack,
- grid path,
- interval DP,
- sequence alignment,
- reconciliation.

### 4.1 Java Representation Warning

Di Java:

```java
int[][] dp = new int[n + 1][m + 1];
```

bukan satu blok memory 2D contiguous seperti C.

Itu adalah array of arrays:

```text
int[][]
  -> int[] row0
  -> int[] row1
  -> int[] row2
  ...
```

Implikasi:

- ada banyak object array,
- ada overhead per row,
- locality tidak sebaik flat array,
- namun syntax lebih mudah.

Untuk DP besar, pertimbangkan flat array:

```java
int[] dp = new int[(n + 1) * (m + 1)];
int value = dp[i * (m + 1) + j];
```

Trade-off:

| Representation | Kelebihan | Kekurangan |
|---|---|---|
| `int[][]` | mudah dibaca | banyak array object, locality row-reference |
| flat `int[]` | lebih compact, locality lebih baik | indexing lebih rawan bug |
| `Map<State, V>` | sparse state | overhead tinggi, boxing/key allocation |

---

## 5. Pattern 3 — Knapsack Family

Knapsack adalah keluarga DP untuk memilih item dengan constraint kapasitas.

Bentuk umum:

```text
Ada item, tiap item punya cost/weight dan value.
Pilih subset agar total cost <= capacity dan value maksimum.
```

Knapsack bukan hanya tas dan barang. Dalam engineering, ini mirip:

- memilih task dalam kapasitas sprint,
- memilih optimization dalam budget CPU/memory,
- memilih feature dalam kapasitas release,
- memilih cases untuk diproses dalam batch window,
- memilih mitigasi risiko dalam resource terbatas.

---

## 6. 0/1 Knapsack

Setiap item boleh dipilih maksimal sekali.

### 6.1 State

```text
dp[i][w] = value maksimum menggunakan item pertama i dengan kapasitas w
```

Transition:

```text
Tidak ambil item i:
dp[i][w] = dp[i - 1][w]

Ambil item i jika weight[i-1] <= w:
dp[i][w] = dp[i - 1][w - weight[i-1]] + value[i-1]

Ambil maksimum dari dua pilihan.
```

### 6.2 Java Implementation — 2D

```java
import java.util.Objects;

public final class ZeroOneKnapsack2D {
    private ZeroOneKnapsack2D() {}

    public static int maxValue(int[] weights, int[] values, int capacity) {
        Objects.requireNonNull(weights, "weights must not be null");
        Objects.requireNonNull(values, "values must not be null");

        if (weights.length != values.length) {
            throw new IllegalArgumentException("weights and values length mismatch");
        }
        if (capacity < 0) {
            throw new IllegalArgumentException("capacity must not be negative");
        }

        int n = weights.length;
        int[][] dp = new int[n + 1][capacity + 1];

        for (int i = 1; i <= n; i++) {
            int weight = weights[i - 1];
            int value = values[i - 1];

            if (weight < 0) {
                throw new IllegalArgumentException("weight must not be negative at index " + (i - 1));
            }

            for (int w = 0; w <= capacity; w++) {
                int skip = dp[i - 1][w];
                int take = Integer.MIN_VALUE;

                if (weight <= w) {
                    take = dp[i - 1][w - weight] + value;
                }

                dp[i][w] = Math.max(skip, take);
            }
        }

        return dp[n][capacity];
    }
}
```

Complexity:

| Resource | Cost |
|---|---:|
| Time | `O(n * capacity)` |
| Space | `O(n * capacity)` |

Important: ini pseudo-polynomial, bukan polynomial terhadap ukuran input bit-level. Jika capacity sangat besar, DP ini bisa tidak realistis.

### 6.3 Space Compression — 1D

Untuk 0/1 knapsack, gunakan loop kapasitas dari besar ke kecil.

```java
import java.util.Objects;

public final class ZeroOneKnapsack1D {
    private ZeroOneKnapsack1D() {}

    public static int maxValue(int[] weights, int[] values, int capacity) {
        Objects.requireNonNull(weights, "weights must not be null");
        Objects.requireNonNull(values, "values must not be null");

        if (weights.length != values.length) {
            throw new IllegalArgumentException("weights and values length mismatch");
        }
        if (capacity < 0) {
            throw new IllegalArgumentException("capacity must not be negative");
        }

        int[] dp = new int[capacity + 1];

        for (int i = 0; i < weights.length; i++) {
            int weight = weights[i];
            int value = values[i];

            if (weight < 0) {
                throw new IllegalArgumentException("weight must not be negative at index " + i);
            }

            for (int w = capacity; w >= weight; w--) {
                dp[w] = Math.max(dp[w], dp[w - weight] + value);
            }
        }

        return dp[capacity];
    }
}
```

Kenapa loop mundur?

Karena item hanya boleh dipakai sekali. Kalau loop maju, `dp[w - weight]` bisa sudah mengandung item yang sama dari iterasi saat ini, sehingga berubah menjadi unbounded knapsack.

### 6.4 Reconstruction untuk 0/1 Knapsack

Jika perlu tahu item yang dipilih, 2D table memudahkan reconstruction.

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public final class ZeroOneKnapsackReconstruction {
    private ZeroOneKnapsackReconstruction() {}

    public record Result(int maxValue, List<Integer> selectedIndexes) {}

    public static Result solve(int[] weights, int[] values, int capacity) {
        Objects.requireNonNull(weights, "weights must not be null");
        Objects.requireNonNull(values, "values must not be null");

        if (weights.length != values.length) {
            throw new IllegalArgumentException("weights and values length mismatch");
        }
        if (capacity < 0) {
            throw new IllegalArgumentException("capacity must not be negative");
        }

        int n = weights.length;
        int[][] dp = new int[n + 1][capacity + 1];

        for (int i = 1; i <= n; i++) {
            int weight = weights[i - 1];
            int value = values[i - 1];

            for (int w = 0; w <= capacity; w++) {
                dp[i][w] = dp[i - 1][w];
                if (weight <= w) {
                    dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - weight] + value);
                }
            }
        }

        List<Integer> selected = new ArrayList<>();
        int w = capacity;

        for (int i = n; i >= 1; i--) {
            if (dp[i][w] != dp[i - 1][w]) {
                selected.add(i - 1);
                w -= weights[i - 1];
            }
        }

        Collections.reverse(selected);
        return new Result(dp[n][capacity], List.copyOf(selected));
    }
}
```

### 6.5 Engineering Lesson

1D compressed DP bagus untuk answer value.

2D DP atau parent pointer lebih bagus untuk:

- explainability,
- audit,
- debugging,
- “why did system choose this set?”,
- deterministic reconstruction.

Dalam regulatory/case-management system, sering kali jawaban numerik tidak cukup. Sistem harus bisa menjelaskan keputusan.

---

## 7. Unbounded Knapsack

Unbounded knapsack berarti setiap item boleh dipakai berkali-kali.

Contoh engineering:

- memilih paket resource berulang,
- membagi kapasitas ke unit yang sama,
- minimum coins/change,
- kombinasi operation berulang.

Loop kapasitas biasanya maju:

```java
import java.util.Objects;

public final class UnboundedKnapsack {
    private UnboundedKnapsack() {}

    public static int maxValue(int[] weights, int[] values, int capacity) {
        Objects.requireNonNull(weights, "weights must not be null");
        Objects.requireNonNull(values, "values must not be null");

        if (weights.length != values.length) {
            throw new IllegalArgumentException("weights and values length mismatch");
        }
        if (capacity < 0) {
            throw new IllegalArgumentException("capacity must not be negative");
        }

        int[] dp = new int[capacity + 1];

        for (int i = 0; i < weights.length; i++) {
            int weight = weights[i];
            int value = values[i];

            if (weight <= 0) {
                throw new IllegalArgumentException("weight must be positive for unbounded knapsack at index " + i);
            }

            for (int w = weight; w <= capacity; w++) {
                dp[w] = Math.max(dp[w], dp[w - weight] + value);
            }
        }

        return dp[capacity];
    }
}
```

Perbedaan penting:

| Problem | Loop kapasitas |
|---|---|
| 0/1 knapsack | Mundur |
| Unbounded knapsack | Maju |

Ini bukan detail kecil. Ini adalah invariant.

---

## 8. Coin Change — Counting vs Optimization

Coin change punya dua versi yang sering membingungkan.

### 8.1 Minimum Coins

Cari jumlah coin minimum untuk mencapai amount.

State:

```text
dp[x] = minimum coins untuk amount x
```

Transition:

```text
dp[x] = min(dp[x], dp[x - coin] + 1)
```

```java
import java.util.Arrays;
import java.util.Objects;

public final class CoinChangeMinimum {
    private CoinChangeMinimum() {}

    public static int minCoins(int[] coins, int amount) {
        Objects.requireNonNull(coins, "coins must not be null");

        if (amount < 0) {
            throw new IllegalArgumentException("amount must not be negative");
        }

        int impossible = amount + 1;
        int[] dp = new int[amount + 1];
        Arrays.fill(dp, impossible);
        dp[0] = 0;

        for (int x = 1; x <= amount; x++) {
            for (int coin : coins) {
                if (coin <= 0) {
                    throw new IllegalArgumentException("coin must be positive");
                }
                if (coin <= x) {
                    dp[x] = Math.min(dp[x], dp[x - coin] + 1);
                }
            }
        }

        return dp[amount] == impossible ? -1 : dp[amount];
    }
}
```

### 8.2 Number of Combinations

Hitung jumlah kombinasi coin untuk mencapai amount. Urutan tidak dianggap berbeda.

```java
import java.util.Objects;

public final class CoinChangeCombinations {
    private CoinChangeCombinations() {}

    public static long countCombinations(int[] coins, int amount) {
        Objects.requireNonNull(coins, "coins must not be null");

        if (amount < 0) {
            throw new IllegalArgumentException("amount must not be negative");
        }

        long[] dp = new long[amount + 1];
        dp[0] = 1L;

        for (int coin : coins) {
            if (coin <= 0) {
                throw new IllegalArgumentException("coin must be positive");
            }
            for (int x = coin; x <= amount; x++) {
                dp[x] += dp[x - coin];
            }
        }

        return dp[amount];
    }
}
```

### 8.3 Why Loop Order Matters

Jika loop coin di luar, amount di dalam:

```text
count combinations
```

Jika loop amount di luar, coin di dalam:

```text
count permutations/order-sensitive sequences
```

Itu bukan sekadar implementasi. Itu mengubah makna state.

---

## 9. Pattern 4 — Longest Increasing Subsequence

LIS: cari subsequence terpanjang yang increasing.

Subsequence tidak harus contiguous.

Contoh:

```text
[10, 9, 2, 5, 3, 7, 101, 18]
LIS length = 4
Salah satu LIS = [2, 3, 7, 18]
```

---

## 10. LIS O(n²) DP

State:

```text
dp[i] = panjang LIS yang berakhir di index i
```

Transition:

```text
dp[i] = 1 + max(dp[j]) untuk semua j < i dan nums[j] < nums[i]
```

```java
import java.util.Arrays;
import java.util.Objects;

public final class LongestIncreasingSubsequenceQuadratic {
    private LongestIncreasingSubsequenceQuadratic() {}

    public static int lengthOfLIS(int[] nums) {
        Objects.requireNonNull(nums, "nums must not be null");

        if (nums.length == 0) {
            return 0;
        }

        int[] dp = new int[nums.length];
        Arrays.fill(dp, 1);

        int best = 1;
        for (int i = 0; i < nums.length; i++) {
            for (int j = 0; j < i; j++) {
                if (nums[j] < nums[i]) {
                    dp[i] = Math.max(dp[i], dp[j] + 1);
                }
            }
            best = Math.max(best, dp[i]);
        }

        return best;
    }
}
```

Complexity:

| Resource | Cost |
|---|---:|
| Time | `O(n²)` |
| Space | `O(n)` |

### 10.1 Reconstruction

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public final class LongestIncreasingSubsequenceReconstruction {
    private LongestIncreasingSubsequenceReconstruction() {}

    public static List<Integer> lis(int[] nums) {
        Objects.requireNonNull(nums, "nums must not be null");

        if (nums.length == 0) {
            return List.of();
        }

        int n = nums.length;
        int[] dp = new int[n];
        int[] parent = new int[n];
        Arrays.fill(dp, 1);
        Arrays.fill(parent, -1);

        int bestIndex = 0;

        for (int i = 0; i < n; i++) {
            for (int j = 0; j < i; j++) {
                if (nums[j] < nums[i] && dp[j] + 1 > dp[i]) {
                    dp[i] = dp[j] + 1;
                    parent[i] = j;
                }
            }
            if (dp[i] > dp[bestIndex]) {
                bestIndex = i;
            }
        }

        List<Integer> result = new ArrayList<>();
        for (int at = bestIndex; at != -1; at = parent[at]) {
            result.add(nums[at]);
        }

        Collections.reverse(result);
        return List.copyOf(result);
    }
}
```

---

## 11. LIS O(n log n) with Binary Search

Ada solusi `O(n log n)` yang menggunakan array `tails`.

Mental model:

```text
tails[len - 1] = possible tail terkecil untuk increasing subsequence dengan panjang len
```

Semakin kecil tail untuk panjang tertentu, semakin fleksibel untuk diperpanjang.

```java
import java.util.Arrays;
import java.util.Objects;

public final class LongestIncreasingSubsequenceLogLinear {
    private LongestIncreasingSubsequenceLogLinear() {}

    public static int lengthOfLIS(int[] nums) {
        Objects.requireNonNull(nums, "nums must not be null");

        int[] tails = new int[nums.length];
        int size = 0;

        for (int x : nums) {
            int pos = Arrays.binarySearch(tails, 0, size, x);
            if (pos < 0) {
                pos = -pos - 1;
            }
            tails[pos] = x;
            if (pos == size) {
                size++;
            }
        }

        return size;
    }
}
```

### 11.1 Important Caveat

`taiIs` bukan selalu actual LIS. Ia menyimpan best possible tail per length.

Untuk reconstruction `O(n log n)`, butuh parent array dan index tracking.

### 11.2 Engineering Use

LIS muncul di:

- version migration ordering,
- minimizing reorder operations,
- diff algorithms,
- sequence stabilization,
- finding longest compatible progression,
- planning monotonic upgrade path.

---

## 12. Pattern 5 — Longest Common Subsequence

LCS: subsequence terpanjang yang muncul di dua sequence.

Contoh:

```text
A = "ABCBDAB"
B = "BDCABA"
LCS length = 4
```

LCS berguna untuk:

- diff engine,
- reconciliation,
- comparing workflow traces,
- document/version comparison,
- audit trail sequence comparison,
- finding shared lifecycle path.

---

## 13. LCS DP

State:

```text
dp[i][j] = LCS length untuk A[0..i) dan B[0..j)
```

Transition:

```text
Jika A[i - 1] == B[j - 1]:
  dp[i][j] = dp[i - 1][j - 1] + 1

Jika berbeda:
  dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
```

```java
import java.util.Objects;

public final class LongestCommonSubsequence {
    private LongestCommonSubsequence() {}

    public static int length(String a, String b) {
        Objects.requireNonNull(a, "a must not be null");
        Objects.requireNonNull(b, "b must not be null");

        int n = a.length();
        int m = b.length();
        int[][] dp = new int[n + 1][m + 1];

        for (int i = 1; i <= n; i++) {
            char ca = a.charAt(i - 1);
            for (int j = 1; j <= m; j++) {
                char cb = b.charAt(j - 1);
                if (ca == cb) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        return dp[n][m];
    }
}
```

### 13.1 LCS Reconstruction

```java
import java.util.Objects;

public final class LongestCommonSubsequenceReconstruction {
    private LongestCommonSubsequenceReconstruction() {}

    public static String lcs(String a, String b) {
        Objects.requireNonNull(a, "a must not be null");
        Objects.requireNonNull(b, "b must not be null");

        int n = a.length();
        int m = b.length();
        int[][] dp = new int[n + 1][m + 1];

        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        StringBuilder reversed = new StringBuilder();
        int i = n;
        int j = m;

        while (i > 0 && j > 0) {
            if (a.charAt(i - 1) == b.charAt(j - 1)) {
                reversed.append(a.charAt(i - 1));
                i--;
                j--;
            } else if (dp[i - 1][j] >= dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }

        return reversed.reverse().toString();
    }
}
```

### 13.2 Unicode Warning

Kode di atas memakai `char`, yaitu UTF-16 code unit, bukan Unicode code point.

Jika sequence kamu harus benar secara Unicode code point, ubah input menjadi `int[]`:

```java
int[] aCodePoints = a.codePoints().toArray();
int[] bCodePoints = b.codePoints().toArray();
```

Lalu jalankan LCS pada `int[]`.

---

## 14. Pattern 6 — Edit Distance

Edit distance mengukur minimum operasi untuk mengubah satu string menjadi string lain.

Operasi umum:

1. insert,
2. delete,
3. replace.

State:

```text
dp[i][j] = minimum edit untuk mengubah a[0..i) menjadi b[0..j)
```

Base case:

```text
dp[i][0] = i
dp[0][j] = j
```

Transition:

```text
Jika sama:
  dp[i][j] = dp[i - 1][j - 1]

Jika beda:
  dp[i][j] = 1 + min(
      dp[i - 1][j],     // delete
      dp[i][j - 1],     // insert
      dp[i - 1][j - 1]  // replace
  )
```

```java
import java.util.Objects;

public final class EditDistance {
    private EditDistance() {}

    public static int levenshtein(String a, String b) {
        Objects.requireNonNull(a, "a must not be null");
        Objects.requireNonNull(b, "b must not be null");

        int n = a.length();
        int m = b.length();
        int[][] dp = new int[n + 1][m + 1];

        for (int i = 0; i <= n; i++) {
            dp[i][0] = i;
        }
        for (int j = 0; j <= m; j++) {
            dp[0][j] = j;
        }

        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    int delete = dp[i - 1][j];
                    int insert = dp[i][j - 1];
                    int replace = dp[i - 1][j - 1];
                    dp[i][j] = 1 + Math.min(delete, Math.min(insert, replace));
                }
            }
        }

        return dp[n][m];
    }
}
```

### 14.1 Space Compression

Edit distance only needs previous row and current row.

```java
import java.util.Objects;

public final class EditDistanceCompressed {
    private EditDistanceCompressed() {}

    public static int levenshtein(String a, String b) {
        Objects.requireNonNull(a, "a must not be null");
        Objects.requireNonNull(b, "b must not be null");

        if (b.length() > a.length()) {
            // Keep second dimension smaller for memory.
            String tmp = a;
            a = b;
            b = tmp;
        }

        int n = a.length();
        int m = b.length();

        int[] prev = new int[m + 1];
        int[] curr = new int[m + 1];

        for (int j = 0; j <= m; j++) {
            prev[j] = j;
        }

        for (int i = 1; i <= n; i++) {
            curr[0] = i;
            for (int j = 1; j <= m; j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) {
                    curr[j] = prev[j - 1];
                } else {
                    curr[j] = 1 + Math.min(prev[j], Math.min(curr[j - 1], prev[j - 1]));
                }
            }

            int[] tmp = prev;
            prev = curr;
            curr = tmp;
        }

        return prev[m];
    }
}
```

### 14.2 Engineering Use

Edit distance digunakan untuk:

- fuzzy matching,
- typo tolerance,
- duplicate detection,
- name/address reconciliation,
- approximate search,
- comparing user-submitted text,
- matching external system records.

Tetapi hati-hati:

1. Edit distance mahal untuk banyak pair.
2. Perlu normalization sebelum compare.
3. Untuk bahasa manusia, distance per code point tidak selalu sesuai makna visual.
4. Untuk production fuzzy search, biasanya butuh indexing/prefilter sebelum DP.

---

## 15. Pattern 7 — Interval DP

Interval DP muncul ketika state adalah rentang `[l, r]`.

Bentuk:

```text
dp[l][r] = jawaban terbaik untuk interval dari l sampai r
```

Transition biasanya mencoba titik split:

```text
dp[l][r] = best over k in [l, r): combine(dp[l][k], dp[k+1][r])
```

Interval DP cocok untuk:

- matrix chain multiplication,
- optimal merge,
- parsing,
- parenthesization,
- partitioning sequence,
- cost aggregation over contiguous range.

---

## 16. Matrix Chain Multiplication

Problem:

Diberikan chain matrix:

```text
A1 x A2 x A3 x ... x An
```

Dimensi:

```text
A_i = dims[i-1] x dims[i]
```

Cari urutan parenthesization dengan jumlah scalar multiplication minimum.

### 16.1 State

```text
dp[l][r] = cost minimum untuk mengalikan matrix l sampai r
```

Base:

```text
dp[i][i] = 0
```

Transition:

```text
dp[l][r] = min over k:
  dp[l][k] + dp[k+1][r] + dims[l] * dims[k+1] * dims[r+1]
```

### 16.2 Java Implementation

```java
import java.util.Arrays;
import java.util.Objects;

public final class MatrixChainMultiplication {
    private MatrixChainMultiplication() {}

    public static long minCost(int[] dims) {
        Objects.requireNonNull(dims, "dims must not be null");

        if (dims.length < 2) {
            return 0L;
        }

        int n = dims.length - 1;
        long[][] dp = new long[n][n];

        for (int len = 2; len <= n; len++) {
            for (int l = 0; l + len - 1 < n; l++) {
                int r = l + len - 1;
                dp[l][r] = Long.MAX_VALUE;

                for (int k = l; k < r; k++) {
                    long cost = dp[l][k]
                            + dp[k + 1][r]
                            + 1L * dims[l] * dims[k + 1] * dims[r + 1];
                    dp[l][r] = Math.min(dp[l][r], cost);
                }
            }
        }

        return dp[0][n - 1];
    }
}
```

Complexity:

| Resource | Cost |
|---|---:|
| Time | `O(n³)` |
| Space | `O(n²)` |

### 16.3 Engineering Use

Interval DP muncul saat keputusan harus membelah urutan contiguous:

- optimal grouping of batch operations,
- minimizing cost of merge plan,
- expression evaluation planning,
- document segmentation,
- rule chain partitioning,
- workflow stage grouping.

---

## 17. Pattern 8 — Tree DP

Tree DP adalah DP pada struktur tree.

State berada pada node.

Bentuk umum:

```text
dp[node] = jawaban untuk subtree node
```

Transition menggabungkan hasil child.

Tree DP cocok untuk:

- hierarchy aggregation,
- permission inheritance,
- organization tree computation,
- menu visibility,
- dependency tree cost,
- decision tree evaluation,
- case-subcase aggregation.

---

## 18. Tree DP Example — Maximum Independent Set on Tree

Problem:

Diberikan tree. Pilih node sebanyak mungkin dengan constraint tidak boleh memilih parent dan child bersamaan.

State:

```text
include[node] = best jika node dipilih
exclude[node] = best jika node tidak dipilih
```

Transition:

```text
include[node] = 1 + sum(exclude[child])
exclude[node] = sum(max(include[child], exclude[child]))
```

### 18.1 Java Implementation

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public final class TreeIndependentSet {
    private TreeIndependentSet() {}

    public static final class Node {
        private final int id;
        private final List<Node> children = new ArrayList<>();

        public Node(int id) {
            this.id = id;
        }

        public int id() {
            return id;
        }

        public List<Node> children() {
            return children;
        }
    }

    private record State(int include, int exclude) {}

    public static int maxIndependentSet(Node root) {
        Objects.requireNonNull(root, "root must not be null");
        State state = dfs(root);
        return Math.max(state.include, state.exclude);
    }

    private static State dfs(Node node) {
        int include = 1;
        int exclude = 0;

        for (Node child : node.children()) {
            State childState = dfs(child);
            include += childState.exclude;
            exclude += Math.max(childState.include, childState.exclude);
        }

        return new State(include, exclude);
    }
}
```

### 18.2 Cycle Warning

Tree DP assumes no cycle.

If the data comes from database or external system, do not blindly trust it as tree.

Validate:

- one root,
- no cycle,
- no multiple parents if it must be a strict tree,
- all referenced nodes exist.

If cycles are possible, this becomes graph DP or graph traversal with SCC/cycle handling.

---

## 19. Pattern 9 — Bitmask DP

Bitmask DP uses bits to represent a subset.

State example:

```text
dp[mask] = best answer for selected subset represented by mask
```

A mask with `n` items has `2^n` possible subsets.

This is useful when `n` is small, usually <= 20–25 depending on memory/time.

---

## 20. Traveling Salesman Style DP

State:

```text
dp[mask][last] = minimum cost to visit set mask and end at last
```

Transition:

```text
dp[mask | (1 << next)][next] = min(
    dp[mask | (1 << next)][next],
    dp[mask][last] + cost[last][next]
)
```

### 20.1 Java Implementation

```java
import java.util.Arrays;
import java.util.Objects;

public final class TspBitmaskDp {
    private TspBitmaskDp() {}

    public static int minHamiltonianPathCost(int[][] cost) {
        Objects.requireNonNull(cost, "cost must not be null");

        int n = cost.length;
        if (n == 0) {
            return 0;
        }
        if (n > 20) {
            throw new IllegalArgumentException("n too large for bitmask DP: " + n);
        }
        for (int[] row : cost) {
            if (row == null || row.length != n) {
                throw new IllegalArgumentException("cost must be a square matrix");
            }
        }

        int states = 1 << n;
        int inf = 1_000_000_000;
        int[][] dp = new int[states][n];

        for (int[] row : dp) {
            Arrays.fill(row, inf);
        }

        for (int start = 0; start < n; start++) {
            dp[1 << start][start] = 0;
        }

        for (int mask = 0; mask < states; mask++) {
            for (int last = 0; last < n; last++) {
                int current = dp[mask][last];
                if (current == inf) {
                    continue;
                }

                for (int next = 0; next < n; next++) {
                    if ((mask & (1 << next)) != 0) {
                        continue;
                    }
                    int nextMask = mask | (1 << next);
                    dp[nextMask][next] = Math.min(dp[nextMask][next], current + cost[last][next]);
                }
            }
        }

        int full = states - 1;
        int best = inf;
        for (int last = 0; last < n; last++) {
            best = Math.min(best, dp[full][last]);
        }

        return best;
    }
}
```

Complexity:

| Resource | Cost |
|---|---:|
| Time | `O(2^n * n²)` |
| Space | `O(2^n * n)` |

### 20.2 Engineering Use

Bitmask DP is useful for small-set exhaustive optimization:

- assigning limited reviewers to limited tasks,
- optimizing order of a few migration steps,
- testing all combinations of feature flags,
- finding cheapest order of small workflow operations,
- constraint solving for small `n`.

But it is not scalable for large `n`.

---

## 21. Pattern 10 — Counting DP

Counting DP answers:

```text
How many ways?
```

Examples:

- number of paths,
- number of combinations,
- number of valid sequences,
- number of decodings,
- number of configurations.

Counting DP has unique risks:

1. overflow,
2. modulo semantics,
3. duplicate counting,
4. order-sensitive vs order-insensitive counting,
5. invalid state leakage.

---

## 22. Counting Paths in Grid

Problem:

From top-left to bottom-right, move only right or down.

State:

```text
dp[r][c] = number of ways to reach cell (r, c)
```

Transition:

```text
dp[r][c] = dp[r - 1][c] + dp[r][c - 1]
```

```java
public final class GridPathCounting {
    private GridPathCounting() {}

    public static long countPaths(int rows, int cols) {
        if (rows <= 0 || cols <= 0) {
            throw new IllegalArgumentException("rows and cols must be positive");
        }

        long[] dp = new long[cols];
        dp[0] = 1L;

        for (int r = 0; r < rows; r++) {
            for (int c = 1; c < cols; c++) {
                dp[c] += dp[c - 1];
            }
        }

        return dp[cols - 1];
    }
}
```

### 22.1 Overflow Warning

Path count grows quickly. `long` may overflow.

Options:

- use `BigInteger`,
- use modulo arithmetic,
- cap at threshold,
- return “too many” sentinel,
- use combinatorics if exact table not needed.

### 22.2 Counting DP with BigInteger

```java
import java.math.BigInteger;
import java.util.Arrays;

public final class GridPathCountingBigInteger {
    private GridPathCountingBigInteger() {}

    public static BigInteger countPaths(int rows, int cols) {
        if (rows <= 0 || cols <= 0) {
            throw new IllegalArgumentException("rows and cols must be positive");
        }

        BigInteger[] dp = new BigInteger[cols];
        Arrays.fill(dp, BigInteger.ZERO);
        dp[0] = BigInteger.ONE;

        for (int r = 0; r < rows; r++) {
            for (int c = 1; c < cols; c++) {
                dp[c] = dp[c].add(dp[c - 1]);
            }
        }

        return dp[cols - 1];
    }
}
```

Engineering note: `BigInteger` allocation can be expensive. Use only when exact huge count is required.

---

## 23. Pattern 11 — Optimization DP

Optimization DP answers:

```text
What is the minimum/maximum cost/value?
```

Common shapes:

- minimum cost,
- maximum value,
- minimum penalty,
- maximum score,
- minimum number of operations,
- maximum number of satisfied constraints.

Important engineering concerns:

1. define impossible state carefully,
2. avoid overflow when adding to sentinel,
3. store parent decision if explanation is needed,
4. deterministic tie-breaking,
5. verify objective matches business meaning.

---

## 24. Optimization DP with Tie-Breaking

In production, “minimum cost” often has ties.

If two decisions have equal cost, which one should win?

Examples:

- earlier deadline first,
- lower risk first,
- deterministic ID order,
- more explainable path,
- fewer external calls,
- less operational risk.

Never leave tie-breaking accidental if result is user-visible.

Example decision object:

```java
public record PlanScore(int cost, int risk, int operationCount) implements Comparable<PlanScore> {
    @Override
    public int compareTo(PlanScore other) {
        int byCost = Integer.compare(this.cost, other.cost);
        if (byCost != 0) {
            return byCost;
        }

        int byRisk = Integer.compare(this.risk, other.risk);
        if (byRisk != 0) {
            return byRisk;
        }

        return Integer.compare(this.operationCount, other.operationCount);
    }
}
```

This makes objective explicit.

---

## 25. DP for Word Break

Problem:

Given a string and dictionary, decide whether string can be segmented into dictionary words.

State:

```text
dp[i] = true if s[0..i) can be segmented
```

Transition:

```text
dp[i] = true if exists j < i such that dp[j] and s[j..i] in dictionary
```

```java
import java.util.List;
import java.util.Objects;
import java.util.Set;

public final class WordBreakDp {
    private WordBreakDp() {}

    public static boolean canSegment(String s, Set<String> dictionary) {
        Objects.requireNonNull(s, "s must not be null");
        Objects.requireNonNull(dictionary, "dictionary must not be null");

        boolean[] dp = new boolean[s.length() + 1];
        dp[0] = true;

        for (int i = 1; i <= s.length(); i++) {
            for (int j = 0; j < i; j++) {
                if (dp[j] && dictionary.contains(s.substring(j, i))) {
                    dp[i] = true;
                    break;
                }
            }
        }

        return dp[s.length()];
    }
}
```

### 25.1 Java Cost Warning

`substring(j, i)` creates a new `String` in modern Java. If this is called inside nested loops, allocation can become significant.

Optimization options:

1. limit max word length,
2. use trie,
3. use rolling hash carefully,
4. group dictionary by length,
5. use `regionMatches` against candidate words,
6. prefilter by prefix.

### 25.2 Word Break with Max Word Length

```java
import java.util.Objects;
import java.util.Set;

public final class WordBreakBounded {
    private WordBreakBounded() {}

    public static boolean canSegment(String s, Set<String> dictionary) {
        Objects.requireNonNull(s, "s must not be null");
        Objects.requireNonNull(dictionary, "dictionary must not be null");

        int maxLen = 0;
        for (String word : dictionary) {
            if (word == null || word.isEmpty()) {
                throw new IllegalArgumentException("dictionary must not contain null or empty word");
            }
            maxLen = Math.max(maxLen, word.length());
        }

        boolean[] dp = new boolean[s.length() + 1];
        dp[0] = true;

        for (int i = 1; i <= s.length(); i++) {
            int from = Math.max(0, i - maxLen);
            for (int j = from; j < i; j++) {
                if (dp[j] && dictionary.contains(s.substring(j, i))) {
                    dp[i] = true;
                    break;
                }
            }
        }

        return dp[s.length()];
    }
}
```

---

## 26. DP and `Map<State, Value>` in Java

Top-down DP often needs state keys.

Example:

```java
record State(int i, int remainingCapacity) {}
```

Then:

```java
Map<State, Integer> memo = new HashMap<>();
```

This is elegant, but not free.

Cost:

- one object per state key,
- hashing cost,
- equality cost,
- map node overhead,
- reference chasing,
- GC pressure.

Better when:

- state space is sparse,
- dimensions are irregular,
- only small subset reached,
- code clarity is more important than raw speed.

Worse when:

- state space is dense,
- dimensions are bounded small integers,
- millions of states,
- strict latency/memory requirement.

---

## 27. Memoization Example with Record Key

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public final class KnapsackMemoized {
    private KnapsackMemoized() {}

    private record State(int index, int capacity) {}

    public static int maxValue(int[] weights, int[] values, int capacity) {
        Objects.requireNonNull(weights, "weights must not be null");
        Objects.requireNonNull(values, "values must not be null");

        if (weights.length != values.length) {
            throw new IllegalArgumentException("weights and values length mismatch");
        }

        Map<State, Integer> memo = new HashMap<>();
        return solve(weights, values, 0, capacity, memo);
    }

    private static int solve(
            int[] weights,
            int[] values,
            int index,
            int capacity,
            Map<State, Integer> memo
    ) {
        if (index == weights.length || capacity <= 0) {
            return 0;
        }

        State state = new State(index, capacity);
        Integer cached = memo.get(state);
        if (cached != null) {
            return cached;
        }

        int skip = solve(weights, values, index + 1, capacity, memo);
        int take = 0;

        if (weights[index] <= capacity) {
            take = values[index] + solve(weights, values, index + 1, capacity - weights[index], memo);
        }

        int answer = Math.max(skip, take);
        memo.put(state, answer);
        return answer;
    }
}
```

### 27.1 Why Not `computeIfAbsent` Recursively?

For recursive DP, `computeIfAbsent` can be elegant, but be careful:

- recursive mutation of the same map can be confusing,
- exceptions inside mapping function are harder to reason about,
- accidental recursion cycles can become harder to debug,
- for `ConcurrentHashMap`, mapping function has additional constraints and contention implications.

Manual `get` then `put` is often more explicit for teaching and debugging.

---

## 28. DP Reconstruction Patterns

There are three common reconstruction strategies.

### 28.1 Parent Pointer

Store decision predecessor:

```text
parent[state] = previousState
```

Good for path-like result.

### 28.2 Choice Table

Store what decision was taken:

```text
choice[i][j] = TAKE / SKIP / MATCH / INSERT / DELETE
```

Good for explainable business decisions.

### 28.3 Recompute from DP Table

Do not store choice. Walk backward comparing values.

Good when choices can be inferred from table.

Trade-off:

| Strategy | Space | Explainability | Robustness |
|---|---:|---:|---:|
| Parent pointer | Medium | High | High |
| Choice table | High | Very high | Very high |
| Recompute from DP | Low/medium | Medium | Can be fragile with ties |

---

## 29. DP Tie-Breaking and Determinism

DP often has multiple optimal answers.

Example:

```text
LCS of A and B may not be unique.
Knapsack may have multiple item sets with same value.
Edit distance may have multiple edit scripts.
```

If output is consumed downstream, nondeterminism is dangerous.

Make tie-breaking explicit:

- prefer earlier index,
- prefer lexicographically smaller result,
- prefer fewer items,
- prefer lower total weight,
- prefer stable source order,
- prefer lower risk category.

Without explicit tie-breaking, result can change when:

- loop order changes,
- map iteration order changes,
- Java implementation changes,
- refactor changes traversal order.

---

## 30. DP Table Initialization Patterns

Initialization is a common source of bugs.

### 30.1 Zero Initialization

Java arrays are zero-initialized. Good for natural zero base cases.

Examples:

- LCS length,
- grid paths if set first cell,
- max value with no item.

### 30.2 Impossible Sentinel

For minimum problems:

```java
int INF = 1_000_000_000;
```

Never do:

```java
INF + cost
```

without checking, because overflow or invalid value propagation can occur.

### 30.3 Negative Infinity

For maximum problems:

```java
int NEG_INF = -1_000_000_000;
```

Same warning applies.

### 30.4 Boolean Reachability

Use `boolean[]` or `BitSet` for reachability if dense.

```java
boolean[] reachable = new boolean[target + 1];
reachable[0] = true;
```

---

## 31. DP with `BitSet` for Reachability

Subset sum reachability can be represented as bits.

Classic idea:

```text
reachable sum s is true if bit s is set.
For each value x, shift bitset left by x and OR.
```

Java `BitSet` does not provide direct shift operation, but you can implement carefully.

Simple boolean version:

```java
import java.util.Objects;

public final class SubsetSumReachability {
    private SubsetSumReachability() {}

    public static boolean canReach(int[] values, int target) {
        Objects.requireNonNull(values, "values must not be null");

        if (target < 0) {
            throw new IllegalArgumentException("target must not be negative");
        }

        boolean[] dp = new boolean[target + 1];
        dp[0] = true;

        for (int value : values) {
            if (value < 0) {
                throw new IllegalArgumentException("value must not be negative");
            }
            for (int s = target; s >= value; s--) {
                dp[s] = dp[s] || dp[s - value];
            }
        }

        return dp[target];
    }
}
```

Loop backward means each value is used at most once.

---

## 32. Engineering Translation: DP as Resource Allocation

Suppose you have cases to process in a nightly batch.

Each case has:

- expected processing time,
- business priority value,
- risk reduction value,
- SLA urgency,
- category constraint.

Window capacity is limited.

This resembles knapsack.

But production adds constraints:

1. Some cases must be processed together.
2. Some cases cannot be processed together.
3. Some cases have deadline.
4. Some cases have dependency.
5. Some cases require external system availability.
6. Output must be explainable.

Pure knapsack may be insufficient. You may need:

- knapsack DP for bounded capacity,
- graph constraints for dependencies,
- priority queue for deadlines,
- tie-breaking policy,
- audit log for decision trace.

Top-tier engineering means recognizing when a textbook DP is only one component of a larger decision system.

---

## 33. Engineering Translation: DP as Reconciliation

Reconciliation between two event sequences:

```text
System A lifecycle:
Submitted -> Reviewed -> Approved -> Issued

System B lifecycle:
Submitted -> Approved -> Issued
```

You may need to find:

- common subsequence,
- missing events,
- inserted events,
- replaced statuses,
- minimum edit script.

Algorithms:

- LCS for common lifecycle path,
- edit distance for minimal transformation,
- weighted edit distance if operations have different business severity.

Weighted edit distance:

```text
insert cost = severity of missing event
delete cost = severity of extra event
replace cost = severity of mismatch
```

This is DP with domain-specific cost.

---

## 34. Engineering Translation: DP as Policy Matching

Policy matching often looks like:

```text
Given applicant facts, case facts, and rules,
find best matching policy path or minimum missing requirement set.
```

Possible DP state:

```text
dp[i][j] = best score after evaluating first i facts and first j policy clauses
```

Or:

```text
dp[ruleIndex][remainingBudget][riskBand]
```

But be careful. Not every rule engine should be DP.

DP is suitable when:

- rules have ordered/structured dependency,
- subproblems repeat,
- cost/score aggregation is well-defined,
- state dimensions are bounded.

DP is not suitable when:

- rule dependencies are arbitrary graph with cycles,
- state dimensions explode,
- rules have side effects,
- explainability requires symbolic reasoning instead.

---

## 35. Engineering Translation: DP as Scheduling

Scheduling can be:

- greedy,
- graph,
- DP,
- integer programming,
- constraint solving.

DP is useful when:

- number of resources is small,
- capacity dimension is bounded,
- time is discretized,
- objective is additive,
- constraints are local enough.

Example:

```text
dp[day][remainingCapacity] = max completed priority up to this day
```

But if scheduling has arbitrary constraints, human assignments, calendars, exclusions, fairness, and cross-task dependencies, DP may become too rigid.

Top-tier decision:

> Use DP when the state captures all relevant future consequences compactly. Do not force DP when future consequences require too much history.

---

## 36. DP Design Checklist

Before implementing DP, answer these questions.

### 36.1 Problem Shape

1. Is the problem optimization, counting, feasibility, or reconstruction?
2. Is there overlapping subproblem?
3. Is there optimal substructure?
4. Are decisions independent after state compression?
5. Is the state space bounded?

### 36.2 State

1. What is the minimum sufficient state?
2. Is any hidden dependency missing?
3. Does state include too much history?
4. Can state be represented as primitive indexes?
5. Is state dense or sparse?

### 36.3 Transition

1. What choices are available from each state?
2. Are all choices valid?
3. Are invalid choices filtered early?
4. Is transition order correct?
5. Does loop direction preserve item usage invariant?

### 36.4 Base Case

1. What is the empty input answer?
2. What is the impossible state?
3. What is the zero-capacity answer?
4. What happens at boundaries?

### 36.5 Evaluation

1. Top-down or bottom-up?
2. Does recursion risk stack overflow?
3. Can memory be compressed?
4. Is reconstruction required?
5. Is tie-breaking deterministic?

### 36.6 Java Implementation

1. Use primitive array if dense.
2. Use `Map<State, V>` if sparse.
3. Avoid boxing in hot loops.
4. Avoid substring allocation in nested loops.
5. Avoid object allocation per transition.
6. Validate input dimensions.
7. Use `long` or `BigInteger` when counts may overflow.
8. Avoid `Integer.MAX_VALUE + cost` overflow.
9. Keep indexing convention consistent.
10. Test with tiny examples where table can be manually verified.

---

## 37. Testing Strategy for DP

DP bugs are often subtle. Use layered tests.

### 37.1 Base Cases

- empty input,
- one item,
- zero capacity,
- impossible target,
- identical strings,
- completely different strings,
- single-node tree.

### 37.2 Small Brute Force Cross-Check

For small `n`, compare DP with brute force.

Example for knapsack:

```java
public static int bruteForceKnapsack(int[] weights, int[] values, int capacity) {
    int n = weights.length;
    int best = 0;

    for (int mask = 0; mask < (1 << n); mask++) {
        int totalWeight = 0;
        int totalValue = 0;

        for (int i = 0; i < n; i++) {
            if ((mask & (1 << i)) != 0) {
                totalWeight += weights[i];
                totalValue += values[i];
            }
        }

        if (totalWeight <= capacity) {
            best = Math.max(best, totalValue);
        }
    }

    return best;
}
```

Use this only for small `n`, e.g. `n <= 20` or less.

### 37.3 Property Tests

Useful properties:

- increasing capacity should not reduce knapsack answer,
- adding an item with zero value should not improve max value,
- edit distance of a string to itself is zero,
- LCS length <= min(length(a), length(b)),
- LIS length <= n,
- number of grid paths should be symmetric for rows/cols if only right/down.

### 37.4 Reconstruction Tests

If algorithm returns selected path/items/script:

1. Verify output is valid.
2. Verify score of output equals DP optimum.
3. Verify tie-breaking behavior.
4. Verify deterministic result across repeated runs.

---

## 38. Performance Strategy for DP in Java

### 38.1 Prefer Primitive Arrays for Dense DP

Good:

```java
int[] dp = new int[n + 1];
long[][] count = new long[n + 1][m + 1];
boolean[] reachable = new boolean[target + 1];
```

Potentially expensive:

```java
Map<State, Integer> memo = new HashMap<>();
```

But again, if state is sparse, map can be better.

### 38.2 Avoid Allocation in Inner Loops

Bad in hot loop:

```java
for (...) {
    State state = new State(i, j);
    ...
}
```

Better if dense:

```java
int index = i * width + j;
```

### 38.3 Beware `String.substring` in DP

Modern `substring` creates new string content representation. In nested DP, this can be expensive.

Alternative:

- indexes,
- `regionMatches`,
- trie,
- rolling hash,
- max-length bound.

### 38.4 Use Flat Arrays for Huge Tables

Instead of:

```java
int[][] dp = new int[states][n];
```

Use:

```java
int[] dp = new int[states * n];
int value = dp[mask * n + last];
```

This reduces row-object overhead and improves locality.

### 38.5 Measure Before Over-Optimizing

DP performance depends on:

- input size,
- state density,
- transition count,
- allocation rate,
- cache locality,
- branch predictability,
- JIT warmup.

Use JMH for microbenchmarking serious alternatives, and use profiling/allocation tracking for production traces.

---

## 39. Common DP Failure Modes

### 39.1 Wrong State Definition

Symptom:

- answer works for examples but fails edge cases.

Cause:

- state misses information needed for future decisions.

Example:

```text
dp[i] stores best value up to i, but future depends on last chosen category.
```

Need:

```text
dp[i][lastCategory]
```

### 39.2 Overcounting

Symptom:

- count too large.

Cause:

- loop order counts permutations instead of combinations.

### 39.3 Reusing Item Multiple Times Accidentally

Symptom:

- 0/1 knapsack returns unbounded result.

Cause:

- capacity loop goes forward instead of backward.

### 39.4 Bad Sentinel

Symptom:

- negative values or overflow.

Cause:

- `Integer.MAX_VALUE + cost` overflow.

### 39.5 Memory Explosion

Symptom:

- `OutOfMemoryError`, GC storm, latency spike.

Cause:

- state space too large,
- `Map<State, V>` with millions of states,
- `int[][]` huge table,
- no compression.

### 39.6 Recursion Stack Overflow

Symptom:

- works for small input, crashes for long chain.

Cause:

- top-down recursion depth too large.

Solution:

- bottom-up,
- explicit stack,
- limit input,
- validate structure.

### 39.7 Nondeterministic Reconstruction

Symptom:

- same score, different selected result.

Cause:

- tie-breaking implicit,
- map iteration order,
- unordered set traversal.

Solution:

- deterministic comparator,
- stable input order,
- explicit tie policy.

---

## 40. DP Pattern Recognition Table

| Problem clue | Likely pattern |
|---|---|
| “Best up to index i” | 1D DP |
| “Compare two sequences” | 2D DP, LCS/Edit Distance |
| “Capacity/budget constraint” | Knapsack |
| “Minimum operations to transform” | Edit Distance / shortest path |
| “Longest compatible subsequence” | LIS/LCS |
| “Split interval optimally” | Interval DP |
| “Aggregate subtree result” | Tree DP |
| “Small set subset states” | Bitmask DP |
| “How many ways” | Counting DP |
| “Can reach target” | Boolean DP / subset sum |
| “Need chosen items/path” | DP + reconstruction |
| “Dependency graph” | Maybe graph algorithm, not DP unless DAG/subtree |
| “Local optimum seems enough” | Maybe greedy, prove before using |

---

## 41. Real-World Design Example — Batch Case Selection

### 41.1 Problem

Nightly job can process at most `T` minutes. Each case has:

- processing duration,
- business value,
- risk score,
- SLA urgency,
- category.

Goal: maximize value without exceeding time.

This resembles 0/1 knapsack.

### 41.2 Simple Model

```java
public record CaseTask(
        String caseId,
        int durationMinutes,
        int valueScore
) {}
```

Use:

```text
weights = durationMinutes
values = valueScore
capacity = availableMinutes
```

### 41.3 But Production Needs More

Questions:

1. What if two cases must be processed together?
2. What if one case depends on another?
3. What if high-risk case must always be included?
4. What if fairness requires category distribution?
5. What if value changes as deadline approaches?
6. What if result must be explainable?

At that point, pure knapsack becomes only a baseline.

You may need:

- graph preprocessing for dependencies,
- mandatory inclusion rules,
- grouped knapsack,
- tie-breaking,
- audit trail of skipped/taken reason,
- fallback heuristic when DP state explodes.

### 41.4 Top-Tier Engineering Decision

Do not blindly implement textbook knapsack.

First define:

- decision unit,
- constraints,
- objective,
- explainability requirement,
- capacity dimension,
- expected input size,
- max acceptable latency,
- memory budget.

Only then choose DP or another approach.

---

## 42. Real-World Design Example — Workflow Trace Comparison

### 42.1 Problem

Two systems record lifecycle events differently.

System A:

```text
SUBMITTED -> SCREENED -> REVIEWED -> APPROVED -> ISSUED
```

System B:

```text
SUBMITTED -> REVIEWED -> APPROVED -> ISSUED
```

Need:

- identify missing events,
- compare trace similarity,
- generate reconciliation report.

### 42.2 Algorithm Choice

Use LCS to find common sequence:

```text
SUBMITTED -> REVIEWED -> APPROVED -> ISSUED
```

Then events outside LCS are insertions/deletions from reconciliation perspective.

Use edit distance if you need minimum operation script.

### 42.3 Domain-Specific Weighted Edit Distance

Not all mismatches are equal.

Example cost:

| Operation | Cost |
|---|---:|
| Missing optional event | 1 |
| Missing mandatory review | 10 |
| Status mismatch | 5 |
| Duplicate event | 2 |

This gives more meaningful reconciliation than raw string edit distance.

---

## 43. Real-World Design Example — Rule Clause Matching

### 43.1 Problem

A rule has ordered clauses. A case has facts. Need to find best alignment between facts and clauses.

This resembles sequence alignment.

State:

```text
dp[i][j] = best score matching first i facts with first j clauses
```

Transition:

- match fact to clause,
- skip fact,
- mark clause missing,
- replace/mismatch.

### 43.2 Why DP Helps

Greedy matching may choose early local match and block better global alignment.

DP evaluates all valid alignments under scoring rules.

### 43.3 Risk

If clauses have arbitrary logical dependencies, DP over sequence may be wrong.

Then you need graph/rule engine reasoning, not sequence DP.

---

## 44. Summary

Dynamic Programming patterns are reusable mental models:

1. 1D DP handles prefix/index/capacity progression.
2. 2D DP handles pairwise sequence or item-capacity state.
3. Knapsack models bounded resource allocation.
4. LIS models longest monotonic compatible subsequence.
5. LCS models common structure between sequences.
6. Edit distance models transformation cost.
7. Interval DP models optimal split over contiguous ranges.
8. Tree DP models bottom-up aggregation over hierarchy.
9. Bitmask DP models small-set subset state.
10. Counting DP counts ways and must avoid overcounting/overflow.
11. Optimization DP must define objective, impossible state, and tie-breaking.
12. Production DP must consider explainability, determinism, memory, and failure modes.

The most important skill is not memorizing recurrence. The important skill is knowing how to derive it:

```text
state -> transition -> base case -> evaluation order -> representation -> reconstruction -> test -> performance validation
```

---

## 45. Practice Tasks

### Task 1 — Derive State

For each problem, define the DP state and transition:

1. Minimum cost to process tasks with optional skip penalty.
2. Number of ways to split a string into valid policy codes.
3. Best subset of cases under processing time capacity.
4. Minimum edits between two lifecycle traces.
5. Maximum score in a tree of dependent review steps.

### Task 2 — Implement

Implement in Java:

1. 0/1 knapsack with reconstruction.
2. LCS for `int[]` event codes, not `String`.
3. Edit distance with weighted operation costs.
4. Word break with dictionary grouped by word length.
5. Tree DP with cycle validation before computation.

### Task 3 — Performance

For knapsack:

1. Implement 2D array version.
2. Implement 1D compressed version.
3. Implement memoized `Map<State, Integer>` version.
4. Compare memory and runtime for dense vs sparse states.

### Task 4 — Explainability

For a selected batch of cases, output:

1. selected case IDs,
2. total duration,
3. total value,
4. skipped cases and reason,
5. tie-breaking decision.

---

## 46. Key Takeaways

1. DP is controlled evaluation of repeated state-space, not magic table filling.
2. The hardest part is state design.
3. Loop order encodes invariant.
4. Reconstruction is a first-class requirement in real systems.
5. Java representation matters: primitive arrays and `Map<State, V>` have very different cost profiles.
6. Counting DP must handle overflow and duplicate counting.
7. Optimization DP must handle impossible states and tie-breaking.
8. Not every dependency problem is DP; some are graph, greedy, search, or constraint-solving problems.
9. Production DP must be deterministic, testable, explainable, and measured.

---

## 47. References

- Oracle Java SE 25 API — `java.util.Arrays`.
- Oracle Java SE 25 API — `java.util.Map` and related map operations.
- Oracle Java SE 25 API — `java.util.HashMap`.
- Oracle Java SE 25 API — `java.util.ArrayList`.
- OpenJDK Code Tools — JOL: Java Object Layout.
- Classic algorithmic foundations: dynamic programming, longest common subsequence, edit distance, knapsack, interval DP, tree DP, and bitmask DP.

---

## 48. Status Seri

Part ini adalah **Part 019 dari 030**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 020 — Greedy Algorithms and Exchange Argument
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 018 — Dynamic Programming I: Mental Model, Memoization, Tabulation](./learn-java-dsa-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 020 — Greedy Algorithms and Exchange Argument](./learn-java-dsa-part-020.md)
