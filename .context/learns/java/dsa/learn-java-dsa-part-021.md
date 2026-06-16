# learn-java-dsa-part-021 — Sliding Window, Two Pointers, Prefix Sum, Difference Array

> Seri: Java Data Structure and Algorithm Advanced  
> Bagian: 021 dari 030  
> Status seri: belum selesai  
> Fokus: teknik linear-time untuk mengganti brute-force, membangun invariant pointer/window, dan menerapkan transformasi prefix/difference untuk query/update range secara efisien.

---

## 0. Tujuan pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat problem `O(n²)` yang sebenarnya bisa diturunkan menjadi `O(n)` dengan **two pointers** atau **sliding window**.
2. Membedakan kapan memakai:
   - two pointers,
   - fast/slow pointer,
   - fixed sliding window,
   - variable sliding window,
   - prefix sum,
   - difference array,
   - frequency window,
   - monotonic window.
3. Mendesain invariant pointer/window secara eksplisit, bukan menyalin template.
4. Menulis implementasi Java yang aman terhadap:
   - off-by-one,
   - overflow `int`,
   - boxing overhead,
   - `substring`/allocation berlebihan,
   - map frequency bug,
   - invalid shrinking logic.
5. Menghubungkan teknik ini ke kasus produksi:
   - rate limiter,
   - rolling metrics,
   - fraud/abuse detection window,
   - SLA breach counters,
   - range update batch processing,
   - time-bucket analytics.

---

## 1. Mental model: dari nested loop ke movement invariant

Banyak problem array/string terlihat natural diselesaikan dengan nested loop:

```java
for (int left = 0; left < n; left++) {
    for (int right = left; right < n; right++) {
        // evaluate interval [left, right]
    }
}
```

Secara konsep, loop di atas mengevaluasi semua subarray/subsequence contiguous. Jumlah interval contiguous pada panjang `n` adalah sekitar:

```text
n + (n-1) + (n-2) + ... + 1 = n(n+1)/2
```

Itu `O(n²)`. Untuk `n = 100_000`, jumlah interval sekitar 5 miliar. Biasanya tidak layak.

Teknik di part ini mencoba menjawab:

> Apakah kita benar-benar perlu mengevaluasi semua pasangan `(left, right)`?

Sering jawabannya tidak, karena ada struktur tambahan:

1. **Data sorted** → pointer bisa bergerak satu arah.
2. **Constraint monotonic** → jika window valid/invalid, arah shrinking/growing bisa diputuskan.
3. **Query range berulang** → prefix sum bisa mengubah `O(length)` menjadi `O(1)`.
4. **Range update berulang** → difference array bisa mengubah update interval dari `O(length)` menjadi `O(1)` per update.
5. **Butuh maximum/minimum dalam window** → monotonic deque menjaga kandidat terbaik tanpa scan ulang.

Kunci dari semua teknik ini adalah **invariant**.

Bukan sekadar:

> “Pakai sliding window.”

Tetapi:

> “Apa arti window saat ini, apa kondisi validnya, kapan pointer kanan maju, kapan pointer kiri maju, dan kenapa pointer tidak perlu mundur?”

---

## 2. Taxonomy teknik linear-time

| Teknik | Struktur input | Core idea | Cocok untuk |
|---|---|---|---|
| Two pointers dari dua ujung | Biasanya sorted array | `left` naik, `right` turun | pair sum, partition, reverse, palindrome |
| Fast/slow pointer | Linked/list/array stream | satu pointer lebih cepat | cycle detection, remove duplicate, compaction |
| Fixed sliding window | Window size tetap `k` | add right, remove left | rolling sum/avg/max, fixed time bucket |
| Variable sliding window | Window size berubah | expand sampai kondisi, shrink sampai valid | longest/shortest subarray dengan constraint monotonic |
| Prefix sum | Query range banyak | precompute cumulative sum | range sum/count, subarray sum |
| Difference array | Update range banyak | mark boundary delta | bulk interval update |
| Frequency window | Window berisi multiset | maintain count per value/char | anagram, unique substring, at-most-k distinct |
| Monotonic deque | Window + min/max | remove dominated candidates | sliding window maximum/minimum |

---

## 3. Java-specific cost model

Teknik linear-time tidak otomatis cepat kalau implementasinya boros allocation atau boxing.

### 3.1 Primitive array lebih murah daripada boxed collection

Untuk workload numeric intensif:

```java
int[] values = new int[n];
long[] prefix = new long[n + 1];
```

biasanya jauh lebih predictable daripada:

```java
List<Integer> values = new ArrayList<>();
List<Long> prefix = new ArrayList<>();
```

Alasannya:

1. `int[]` menyimpan primitive langsung.
2. `List<Integer>` menyimpan reference ke object `Integer`.
3. Access `List<Integer>` melibatkan bounds check + reference dereference + unboxing.
4. Object `Integer` bisa menambah memory footprint dan GC pressure.

Untuk DSA, default-kan primitive array jika:

1. ukuran diketahui,
2. index dense,
3. operation numeric intensif,
4. tidak butuh API collection.

### 3.2 Gunakan `long` untuk akumulasi

Range sum sering overflow jika memakai `int`.

Contoh:

```java
int n = 100_000;
int each = 1_000_000_000;
```

Sum total secara matematis `100_000_000_000_000`, jauh melewati batas `int`.

Gunakan:

```java
long sum = 0L;
long[] prefix = new long[n + 1];
```

### 3.3 Hati-hati dengan `substring` dalam loop

Untuk string algorithm, jangan membuat substring berulang hanya untuk mengecek window.

Buruk:

```java
for (int left = 0; left < s.length(); left++) {
    for (int right = left; right < s.length(); right++) {
        String candidate = s.substring(left, right + 1);
        // expensive allocation pattern
    }
}
```

Lebih baik maintain state window memakai index dan frequency.

### 3.4 `ArrayDeque` berguna untuk monotonic queue

Untuk deque berbasis object, Java menyediakan `ArrayDeque`. Dokumentasi Java mendeskripsikannya sebagai implementasi `Deque` berbasis resizable array, tidak thread-safe tanpa external synchronization, tidak menerima `null`, dan umumnya lebih cepat daripada `Stack` untuk stack usage serta `LinkedList` untuk queue usage. Referensi: Oracle Java SE `ArrayDeque` documentation.

Namun untuk sliding window maximum berbasis index primitive, custom `int[] deque` sering lebih hemat allocation daripada `ArrayDeque<Integer>` karena menghindari boxing.

---

## 4. Two pointers: satu problem, dua arah gerak

### 4.1 Mental model

Two pointers dipakai saat dua posisi dalam data bergerak dengan aturan tertentu, dan setiap pointer bergerak monoton.

Bentuk umum:

```java
int left = 0;
int right = n - 1;

while (left < right) {
    // evaluate values[left], values[right]

    if (/* need larger value */) {
        left++;
    } else {
        right--;
    }
}
```

Invariant penting:

1. Semua kandidat yang dibuang sudah tidak mungkin menjadi jawaban.
2. Pointer tidak perlu mundur.
3. Setiap langkah mengurangi search space.

### 4.2 Contoh: pair sum pada sorted array

Problem:

> Diberikan array sorted ascending dan target, apakah ada dua angka dengan jumlah target?

Brute-force:

```java
for (int i = 0; i < n; i++) {
    for (int j = i + 1; j < n; j++) {
        if (a[i] + a[j] == target) return true;
    }
}
```

Two pointers:

```java
public static boolean hasPairWithSum(int[] a, int target) {
    int left = 0;
    int right = a.length - 1;

    while (left < right) {
        long sum = (long) a[left] + a[right];

        if (sum == target) {
            return true;
        }

        if (sum < target) {
            left++;
        } else {
            right--;
        }
    }

    return false;
}
```

Kenapa benar?

Jika `a[left] + a[right] < target`, maka untuk `left` yang sama, semua pasangan dengan index kanan lebih kecil akan menghasilkan sum lebih kecil atau sama. Jadi `left` tidak bisa menjadi pasangan valid dengan `right` mana pun yang tersisa. Aman untuk `left++`.

Jika `a[left] + a[right] > target`, maka untuk `right` yang sama, semua pasangan dengan index kiri lebih besar akan menghasilkan sum lebih besar atau sama. Jadi `right` tidak bisa menjadi pasangan valid dengan `left` mana pun yang tersisa. Aman untuk `right--`.

Complexity:

```text
Time  : O(n)
Memory: O(1)
```

### 4.3 Two pointers tidak selalu valid

Two pointers butuh struktur. Jika array tidak sorted dan tidak ada property monotonic, logic `left++` atau `right--` bisa membuang kandidat valid.

Solusi untuk unsorted pair sum biasanya pakai `HashSet`:

```java
public static boolean hasPairWithSumUnsorted(int[] a, int target) {
    Set<Integer> seen = new HashSet<>();

    for (int value : a) {
        int need = target - value;
        if (seen.contains(need)) {
            return true;
        }
        seen.add(value);
    }

    return false;
}
```

Trade-off:

```text
Sorted + two pointers : O(n), memory O(1), butuh sorted input
Unsorted + hash set   : O(n) average, memory O(n), bergantung hash/equality
Sort + two pointers   : O(n log n), memory tergantung sort, mengubah order jika in-place
```

---

## 5. Fast/slow pointer

### 5.1 Mental model

Fast/slow pointer memakai dua pointer dengan kecepatan berbeda atau peran berbeda.

Contoh kategori:

1. Slow sebagai write index, fast sebagai read index.
2. Slow satu langkah, fast dua langkah.
3. Slow menunjuk kandidat valid terakhir.

### 5.2 Remove duplicates dari sorted array in-place

Problem:

> Diberikan sorted array, compress unique value ke depan array dan return panjang unique.

```java
public static int deduplicateSorted(int[] a) {
    if (a.length == 0) {
        return 0;
    }

    int write = 1;

    for (int read = 1; read < a.length; read++) {
        if (a[read] != a[write - 1]) {
            a[write] = a[read];
            write++;
        }
    }

    return write;
}
```

Invariant:

1. `a[0..write-1]` berisi unique values yang sudah diproses.
2. `read` adalah posisi input berikutnya yang sedang diperiksa.
3. Jika `a[read]` berbeda dari unique terakhir, tulis ke `a[write]`.

Complexity:

```text
Time  : O(n)
Memory: O(1)
```

### 5.3 Compaction pattern di sistem nyata

Pattern ini sering muncul saat kita ingin filter array/list tanpa membuat banyak object baru.

Contoh: compact valid IDs.

```java
public static int compactPositiveIds(long[] ids) {
    int write = 0;

    for (int read = 0; read < ids.length; read++) {
        if (ids[read] > 0) {
            ids[write++] = ids[read];
        }
    }

    return write;
}
```

Setelah itu, bagian valid adalah `ids[0..write-1]`.

Catatan: jika array berisi reference object, elemen sisa sebaiknya di-null-kan untuk mencegah object retention.

```java
public static <T> int compactNonNull(T[] values) {
    int write = 0;

    for (int read = 0; read < values.length; read++) {
        T value = values[read];
        if (value != null) {
            values[write++] = value;
        }
    }

    for (int i = write; i < values.length; i++) {
        values[i] = null;
    }

    return write;
}
```

---

## 6. Fixed-size sliding window

### 6.1 Mental model

Fixed-size sliding window dipakai ketika ukuran window konstan `k`.

Contoh:

> Cari maximum sum dari subarray panjang `k`.

Brute-force menghitung sum ulang untuk setiap window:

```text
Window 0: a[0] + ... + a[k-1]
Window 1: a[1] + ... + a[k]
Window 2: a[2] + ... + a[k+1]
```

Padahal window berikutnya hanya beda satu elemen keluar dan satu elemen masuk.

```text
nextSum = currentSum - outgoing + incoming
```

### 6.2 Maximum sum fixed window

```java
public static long maxFixedWindowSum(int[] a, int k) {
    if (k <= 0 || k > a.length) {
        throw new IllegalArgumentException("k must be in range 1..a.length");
    }

    long sum = 0L;
    for (int i = 0; i < k; i++) {
        sum += a[i];
    }

    long best = sum;

    for (int right = k; right < a.length; right++) {
        int left = right - k;
        sum -= a[left];
        sum += a[right];
        best = Math.max(best, sum);
    }

    return best;
}
```

Invariant:

1. Pada awal iterasi `right`, `sum` adalah sum window sebelumnya.
2. Elemen `a[right-k]` keluar.
3. Elemen `a[right]` masuk.
4. Setelah update, `sum` adalah sum window `[right-k+1, right]`.

Complexity:

```text
Time  : O(n)
Memory: O(1)
```

### 6.3 Rolling average

```java
public static double[] rollingAverage(int[] a, int k) {
    if (k <= 0 || k > a.length) {
        throw new IllegalArgumentException("k must be in range 1..a.length");
    }

    double[] result = new double[a.length - k + 1];

    long sum = 0L;
    for (int i = 0; i < k; i++) {
        sum += a[i];
    }

    result[0] = sum / (double) k;

    for (int right = k; right < a.length; right++) {
        sum += a[right];
        sum -= a[right - k];
        result[right - k + 1] = sum / (double) k;
    }

    return result;
}
```

Production mapping:

1. rolling request per minute,
2. moving average latency,
3. moving error rate,
4. rolling SLA compliance,
5. sliding fraud score.

---

## 7. Variable-size sliding window

### 7.1 Mental model

Variable-size sliding window dipakai ketika window boleh membesar/mengecil berdasarkan constraint.

Bentuk umum:

```java
int left = 0;
for (int right = 0; right < n; right++) {
    add(a[right]);

    while (windowInvalid()) {
        remove(a[left]);
        left++;
    }

    // window [left, right] valid
    updateAnswer();
}
```

Pattern ini valid jika constraint bersifat monotonic terhadap perluasan atau penyempitan window.

Contoh constraint monotonic:

1. Sum non-negative array `<= target`.
2. Jumlah distinct character `<= k`.
3. Tidak ada duplicate dalam window.
4. Frequency setiap char memenuhi batas tertentu.

### 7.2 Longest subarray dengan sum <= target untuk angka non-negative

```java
public static int longestSumAtMost(int[] a, long target) {
    int left = 0;
    long sum = 0L;
    int best = 0;

    for (int right = 0; right < a.length; right++) {
        if (a[right] < 0) {
            throw new IllegalArgumentException("This algorithm requires non-negative numbers");
        }

        sum += a[right];

        while (sum > target && left <= right) {
            sum -= a[left];
            left++;
        }

        best = Math.max(best, right - left + 1);
    }

    return best;
}
```

Kenapa butuh non-negative?

Jika semua angka non-negative, saat `right` maju, `sum` tidak akan turun. Jika `sum > target`, satu-satunya cara membuat valid adalah menggeser `left`. Itu menciptakan monotonicity.

Jika ada angka negatif, menambah elemen kanan bisa menurunkan sum. Maka logic shrink saat invalid bisa membuang kandidat yang sebenarnya nanti bisa valid lagi.

Untuk array dengan angka negatif, biasanya prefix sum + balanced tree/hash map atau algoritma lain lebih cocok.

### 7.3 Shortest subarray dengan sum >= target untuk angka non-negative

```java
public static int shortestSumAtLeast(int[] a, long target) {
    int left = 0;
    long sum = 0L;
    int best = Integer.MAX_VALUE;

    for (int right = 0; right < a.length; right++) {
        if (a[right] < 0) {
            throw new IllegalArgumentException("This algorithm requires non-negative numbers");
        }

        sum += a[right];

        while (sum >= target) {
            best = Math.min(best, right - left + 1);
            sum -= a[left];
            left++;
        }
    }

    return best == Integer.MAX_VALUE ? -1 : best;
}
```

Invariant:

1. Expand sampai window memenuhi `sum >= target`.
2. Selama valid, shrink untuk mencari window yang lebih pendek.
3. Setiap `left` dan `right` hanya bergerak maju, jadi total `O(n)`.

---

## 8. Frequency window

### 8.1 Mental model

Frequency window dipakai ketika validitas window bergantung pada jumlah kemunculan value.

Contoh:

1. longest substring without repeating characters,
2. longest substring with at most `k` distinct characters,
3. anagram detection,
4. minimum window containing required chars.

Untuk ASCII/limited alphabet, gunakan array frequency.

```java
int[] freq = new int[128];
```

Untuk Unicode general atau arbitrary token, gunakan `Map`.

Namun hati-hati: `char` di Java adalah UTF-16 code unit, bukan selalu satu Unicode character manusia. Untuk problem production multilingual, perlu desain berbasis code point atau normalized token. Di part ini fokus DSA-nya, bukan mengulang Unicode detail dari seri data-types.

### 8.2 Longest substring without repeating ASCII chars

```java
public static int longestAsciiSubstringWithoutRepeat(String s) {
    int[] freq = new int[128];
    int left = 0;
    int duplicates = 0;
    int best = 0;

    for (int right = 0; right < s.length(); right++) {
        char c = s.charAt(right);
        if (c >= 128) {
            throw new IllegalArgumentException("ASCII only");
        }

        freq[c]++;
        if (freq[c] == 2) {
            duplicates++;
        }

        while (duplicates > 0) {
            char out = s.charAt(left++);
            freq[out]--;
            if (freq[out] == 1) {
                duplicates--;
            }
        }

        best = Math.max(best, right - left + 1);
    }

    return best;
}
```

Invariant:

1. `freq` merepresentasikan char count di window `[left, right]`.
2. `duplicates` adalah jumlah char yang sedang memiliki frequency >= 2.
3. Window valid jika `duplicates == 0`.

### 8.3 Alternative: last seen index

Untuk problem no-repeat, ada pendekatan lebih compact:

```java
public static int longestAsciiSubstringWithoutRepeatLastSeen(String s) {
    int[] lastSeen = new int[128];
    Arrays.fill(lastSeen, -1);

    int left = 0;
    int best = 0;

    for (int right = 0; right < s.length(); right++) {
        char c = s.charAt(right);
        if (c >= 128) {
            throw new IllegalArgumentException("ASCII only");
        }

        int previous = lastSeen[c];
        if (previous >= left) {
            left = previous + 1;
        }

        lastSeen[c] = right;
        best = Math.max(best, right - left + 1);
    }

    return best;
}
```

Invariant:

1. `left` selalu berada setelah kemunculan duplicate terakhir yang konflik.
2. `lastSeen[c]` menyimpan posisi terakhir `c`.
3. Saat `c` pernah muncul dalam window, lompatkan `left` ke `previous + 1`.

Perhatikan penggunaan:

```java
left = Math.max(left, previous + 1)
```

atau guard `previous >= left`. Tanpa itu, `left` bisa mundur dan invariant rusak.

### 8.4 Longest substring with at most K distinct chars

```java
public static int longestSubstringAtMostKDistinct(String s, int k) {
    if (k < 0) {
        throw new IllegalArgumentException("k must be non-negative");
    }
    if (k == 0) {
        return 0;
    }

    Map<Character, Integer> freq = new HashMap<>();
    int left = 0;
    int best = 0;

    for (int right = 0; right < s.length(); right++) {
        char in = s.charAt(right);
        freq.merge(in, 1, Integer::sum);

        while (freq.size() > k) {
            char out = s.charAt(left++);
            int next = freq.get(out) - 1;
            if (next == 0) {
                freq.remove(out);
            } else {
                freq.put(out, next);
            }
        }

        best = Math.max(best, right - left + 1);
    }

    return best;
}
```

Java-specific note:

1. `Map<Character, Integer>` menyebabkan boxing.
2. Untuk ASCII, `int[] freq` + `distinct` lebih efisien.
3. Untuk real Unicode/token stream, `Map` lebih fleksibel.

ASCII variant:

```java
public static int longestAsciiSubstringAtMostKDistinct(String s, int k) {
    if (k < 0) {
        throw new IllegalArgumentException("k must be non-negative");
    }

    int[] freq = new int[128];
    int distinct = 0;
    int left = 0;
    int best = 0;

    for (int right = 0; right < s.length(); right++) {
        char in = s.charAt(right);
        if (in >= 128) {
            throw new IllegalArgumentException("ASCII only");
        }

        if (freq[in]++ == 0) {
            distinct++;
        }

        while (distinct > k) {
            char out = s.charAt(left++);
            if (--freq[out] == 0) {
                distinct--;
            }
        }

        best = Math.max(best, right - left + 1);
    }

    return best;
}
```

---

## 9. Prefix sum

### 9.1 Mental model

Prefix sum menyimpan cumulative sum sampai sebelum index tertentu.

Definisi umum:

```java
prefix[0] = 0
prefix[i + 1] = prefix[i] + a[i]
```

Maka sum range `[left, right]` inclusive:

```java
sum(left, right) = prefix[right + 1] - prefix[left]
```

Kenapa `prefix` panjangnya `n + 1`?

Agar range yang mulai dari index `0` tidak butuh special case.

```text
a:       [  5,   2,   7,   3]
index:      0    1    2    3
prefix: [0, 5,   7,  14,  17]

sum [1,3] = prefix[4] - prefix[1] = 17 - 5 = 12
```

### 9.2 Implementasi range sum immutable array

```java
public final class LongPrefixSum {
    private final long[] prefix;

    public LongPrefixSum(int[] values) {
        this.prefix = new long[values.length + 1];
        for (int i = 0; i < values.length; i++) {
            prefix[i + 1] = prefix[i] + values[i];
        }
    }

    public long sumInclusive(int left, int right) {
        if (left < 0 || right < left || right + 1 >= prefix.length) {
            throw new IndexOutOfBoundsException(
                    "Invalid range: [" + left + ", " + right + "]"
            );
        }
        return prefix[right + 1] - prefix[left];
    }

    public int size() {
        return prefix.length - 1;
    }
}
```

Complexity:

```text
Build       : O(n)
Range query : O(1)
Memory      : O(n)
```

### 9.3 Prefix count

Prefix sum tidak hanya untuk sum numeric. Bisa juga untuk count condition.

Contoh: count error event dalam range.

```java
public final class BooleanPrefixCount {
    private final int[] prefix;

    public BooleanPrefixCount(boolean[] flags) {
        this.prefix = new int[flags.length + 1];
        for (int i = 0; i < flags.length; i++) {
            prefix[i + 1] = prefix[i] + (flags[i] ? 1 : 0);
        }
    }

    public int countTrueInclusive(int left, int right) {
        if (left < 0 || right < left || right + 1 >= prefix.length) {
            throw new IndexOutOfBoundsException();
        }
        return prefix[right + 1] - prefix[left];
    }
}
```

Production mapping:

1. count breach in time range,
2. count failed login in index range,
3. count validation errors per batch segment,
4. count completed tasks in ordered timeline.

### 9.4 Prefix sum + HashMap: subarray sum equals K

Problem:

> Berapa jumlah subarray dengan sum tepat `k`? Angka bisa negatif.

Sliding window tidak aman karena angka negatif merusak monotonicity. Prefix sum menyelesaikan.

Jika:

```text
prefix[j] - prefix[i] = k
```

Maka:

```text
prefix[i] = prefix[j] - k
```

Saat berada di prefix current, hitung berapa prefix sebelumnya bernilai `current - k`.

```java
public static long countSubarraysWithSum(int[] a, long k) {
    Map<Long, Integer> freq = new HashMap<>();
    freq.put(0L, 1);

    long prefix = 0L;
    long count = 0L;

    for (int value : a) {
        prefix += value;

        long needed = prefix - k;
        count += freq.getOrDefault(needed, 0);

        freq.merge(prefix, 1, Integer::sum);
    }

    return count;
}
```

Complexity:

```text
Time  : O(n) average
Memory: O(n)
```

Caveat:

1. `HashMap` average-case bergantung distribusi hash dan key behavior.
2. Gunakan `long` untuk prefix.
3. Jika jumlah subarray bisa sangat besar, result juga perlu `long`.

---

## 10. Difference array

### 10.1 Mental model

Difference array adalah kebalikan dari prefix sum.

Jika kita punya array final `a`, difference `diff` bisa didefinisikan:

```text
diff[0] = a[0]
diff[i] = a[i] - a[i-1]
```

Untuk membangun kembali `a`:

```text
a[i] = diff[0] + diff[1] + ... + diff[i]
```

Trik penting:

Untuk menambah `delta` pada range `[left, right]`:

```text
diff[left] += delta
diff[right + 1] -= delta
```

Lalu satu pass prefix terhadap `diff` menghasilkan array final.

### 10.2 Range update batch

```java
public final class DifferenceArray {
    private final long[] diff;
    private final int size;

    public DifferenceArray(int size) {
        if (size < 0) {
            throw new IllegalArgumentException("size must be non-negative");
        }
        this.size = size;
        this.diff = new long[size + 1];
    }

    public void addInclusive(int left, int right, long delta) {
        if (left < 0 || right < left || right >= size) {
            throw new IndexOutOfBoundsException(
                    "Invalid range: [" + left + ", " + right + "]"
            );
        }

        diff[left] += delta;
        diff[right + 1] -= delta;
    }

    public long[] materialize() {
        long[] result = new long[size];
        long running = 0L;

        for (int i = 0; i < size; i++) {
            running += diff[i];
            result[i] = running;
        }

        return result;
    }
}
```

Complexity:

```text
Range update : O(1)
Materialize  : O(n)
Memory       : O(n)
```

Jika ada `m` updates panjang besar, brute force bisa `O(m * rangeLength)`. Difference array menjadi `O(m + n)`.

### 10.3 Contoh: bulk interval load

Misal kita punya event interval aktif per menit, dan ingin tahu jumlah event aktif pada tiap menit.

```java
public static int[] activeCounts(int minutes, int[][] intervalsInclusive) {
    int[] diff = new int[minutes + 1];

    for (int[] interval : intervalsInclusive) {
        int start = interval[0];
        int end = interval[1];

        if (start < 0 || end < start || end >= minutes) {
            throw new IllegalArgumentException("Invalid interval");
        }

        diff[start]++;
        diff[end + 1]--;
    }

    int[] active = new int[minutes];
    int running = 0;

    for (int minute = 0; minute < minutes; minute++) {
        running += diff[minute];
        active[minute] = running;
    }

    return active;
}
```

Production mapping:

1. number of active cases per time bucket,
2. number of overlapping maintenance windows,
3. resource demand per interval,
4. SLA coverage windows,
5. staffing load over schedule.

---

## 11. Prefix + difference in 2D

### 11.1 2D prefix sum mental model

Untuk matrix `grid`, 2D prefix menyimpan sum rectangle dari `(0,0)` sampai `(r-1,c-1)`.

Definisi:

```text
prefix[r+1][c+1] = grid[r][c]
                 + prefix[r][c+1]
                 + prefix[r+1][c]
                 - prefix[r][c]
```

Rectangle query inclusive `(r1,c1)` sampai `(r2,c2)`:

```text
sum = prefix[r2+1][c2+1]
    - prefix[r1][c2+1]
    - prefix[r2+1][c1]
    + prefix[r1][c1]
```

### 11.2 Java implementation

```java
public final class MatrixPrefixSum {
    private final long[][] prefix;
    private final int rows;
    private final int cols;

    public MatrixPrefixSum(int[][] grid) {
        this.rows = grid.length;
        this.cols = rows == 0 ? 0 : grid[0].length;

        this.prefix = new long[rows + 1][cols + 1];

        for (int r = 0; r < rows; r++) {
            if (grid[r].length != cols) {
                throw new IllegalArgumentException("Jagged matrix is not supported");
            }
            for (int c = 0; c < cols; c++) {
                prefix[r + 1][c + 1] = grid[r][c]
                        + prefix[r][c + 1]
                        + prefix[r + 1][c]
                        - prefix[r][c];
            }
        }
    }

    public long sumInclusive(int r1, int c1, int r2, int c2) {
        if (r1 < 0 || c1 < 0 || r2 < r1 || c2 < c1 || r2 >= rows || c2 >= cols) {
            throw new IndexOutOfBoundsException();
        }

        return prefix[r2 + 1][c2 + 1]
                - prefix[r1][c2 + 1]
                - prefix[r2 + 1][c1]
                + prefix[r1][c1];
    }
}
```

### 11.3 2D difference array

Untuk update rectangle `[r1..r2][c1..c2]` dengan `delta`:

```text
diff[r1][c1]         += delta
diff[r2 + 1][c1]     -= delta
diff[r1][c2 + 1]     -= delta
diff[r2 + 1][c2 + 1] += delta
```

Lalu materialisasi dengan 2D prefix.

```java
public final class MatrixDifference {
    private final long[][] diff;
    private final int rows;
    private final int cols;

    public MatrixDifference(int rows, int cols) {
        if (rows < 0 || cols < 0) {
            throw new IllegalArgumentException("rows/cols must be non-negative");
        }
        this.rows = rows;
        this.cols = cols;
        this.diff = new long[rows + 1][cols + 1];
    }

    public void addRectangleInclusive(int r1, int c1, int r2, int c2, long delta) {
        if (r1 < 0 || c1 < 0 || r2 < r1 || c2 < c1 || r2 >= rows || c2 >= cols) {
            throw new IndexOutOfBoundsException();
        }

        diff[r1][c1] += delta;
        diff[r2 + 1][c1] -= delta;
        diff[r1][c2 + 1] -= delta;
        diff[r2 + 1][c2 + 1] += delta;
    }

    public long[][] materialize() {
        long[][] result = new long[rows][cols];

        for (int r = 0; r < rows; r++) {
            long rowRunning = 0L;
            for (int c = 0; c < cols; c++) {
                rowRunning += diff[r][c];
                long above = r == 0 ? 0L : result[r - 1][c];
                result[r][c] = above + rowRunning;
            }
        }

        return result;
    }
}
```

Production mapping:

1. heatmap traffic,
2. spatial grid scoring,
3. schedule matrix updates,
4. permission coverage matrix,
5. time x category aggregation.

---

## 12. Monotonic queue / deque

### 12.1 Problem: sliding window maximum

Problem:

> Untuk setiap window panjang `k`, cari maximum value.

Naive:

```text
Untuk setiap window, scan semua k elemen → O(nk)
```

Heap:

```text
O(n log k), butuh lazy deletion atau index check
```

Monotonic deque:

```text
O(n), karena setiap index masuk sekali dan keluar sekali
```

### 12.2 Invariant monotonic deque

Deque menyimpan index, bukan value.

Invariant:

1. Index dalam deque selalu increasing dari depan ke belakang.
2. Value berdasarkan index selalu decreasing dari depan ke belakang.
3. Depan deque selalu index dengan value maximum untuk window saat ini.
4. Index yang keluar window dibuang dari depan.
5. Index baru menghapus kandidat di belakang yang nilainya <= value baru, karena kandidat itu tidak akan pernah menjadi maximum selama value baru masih berada di window.

### 12.3 Implementasi dengan primitive int deque

```java
public static int[] slidingWindowMaximum(int[] a, int k) {
    if (k <= 0 || k > a.length) {
        throw new IllegalArgumentException("k must be in range 1..a.length");
    }

    int n = a.length;
    int[] result = new int[n - k + 1];

    int[] deque = new int[n];
    int head = 0;
    int tail = 0; // exclusive

    for (int right = 0; right < n; right++) {
        int windowLeft = right - k + 1;

        // Remove indexes outside current window.
        while (head < tail && deque[head] < windowLeft) {
            head++;
        }

        // Remove dominated candidates.
        while (head < tail && a[deque[tail - 1]] <= a[right]) {
            tail--;
        }

        deque[tail++] = right;

        if (windowLeft >= 0) {
            result[windowLeft] = a[deque[head]];
        }
    }

    return result;
}
```

Complexity:

```text
Time  : O(n)
Memory: O(n) for deque/result, O(k) active deque conceptually
```

### 12.4 Mengapa bukan `PriorityQueue`?

`PriorityQueue` di Java adalah unbounded priority queue berbasis priority heap dan head-nya adalah elemen terkecil menurut ordering/comparator. Untuk sliding max, kita bisa membuat max-heap dengan comparator reverse, tetapi menghapus elemen yang keluar window tidak murah jika bukan head. Biasanya perlu lazy deletion via index check.

Monotonic deque lebih cocok karena window bergerak satu arah dan dominance relation bisa dimanfaatkan.

---

## 13. Monotonic stack/window patterns

Monotonic structure bukan hanya untuk sliding max. Ia menyimpan kandidat yang tidak didominasi.

Contoh konsep:

1. next greater element,
2. previous smaller element,
3. largest rectangle in histogram,
4. sliding window max/min,
5. maintain min/max under moving window.

Mental model:

> Jika elemen baru membuat elemen lama tidak mungkin menjadi jawaban, elemen lama boleh dibuang sekarang.

Ini adalah prinsip pruning, bukan trik syntax.

---

## 14. Case study: rate limiter dengan sliding window

### 14.1 Problem

Kita ingin membatasi user maksimal `N` request dalam window `T` milliseconds.

Ada beberapa desain:

1. Fixed window counter.
2. Sliding log.
3. Sliding window counter with buckets.
4. Token bucket/leaky bucket.

Di sini fokus DSA sliding window.

### 14.2 Sliding log exact limiter

Simpan timestamp request per key. Saat request baru masuk:

1. Buang timestamp yang lebih tua dari window.
2. Jika jumlah timestamp masih >= limit, reject.
3. Jika belum, add timestamp dan allow.

```java
public final class SlidingLogRateLimiter {
    private final int limit;
    private final long windowMillis;
    private final Map<String, ArrayDeque<Long>> requestsByKey = new HashMap<>();

    public SlidingLogRateLimiter(int limit, long windowMillis) {
        if (limit <= 0 || windowMillis <= 0) {
            throw new IllegalArgumentException("limit and windowMillis must be positive");
        }
        this.limit = limit;
        this.windowMillis = windowMillis;
    }

    public synchronized boolean allow(String key, long nowMillis) {
        ArrayDeque<Long> deque = requestsByKey.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        long minAllowed = nowMillis - windowMillis;

        while (!deque.isEmpty() && deque.peekFirst() <= minAllowed) {
            deque.removeFirst();
        }

        if (deque.size() >= limit) {
            return false;
        }

        deque.addLast(nowMillis);
        return true;
    }

    public synchronized void cleanupEmptyKeys() {
        requestsByKey.entrySet().removeIf(entry -> entry.getValue().isEmpty());
    }
}
```

Engineering notes:

1. Ini exact tapi memory bisa besar: `O(numberOfKeys * limit)`.
2. Method `synchronized` sederhana tapi tidak scalable untuk multi-thread high throughput.
3. Per-key lock atau sharding bisa lebih baik.
4. Untuk distributed rate limiter, butuh Redis/DB/centralized counter; struktur data lokal saja tidak cukup.
5. Harus ada cleanup key agar map tidak tumbuh tanpa batas.

### 14.3 Bucketed sliding window

Daripada menyimpan semua timestamp, simpan count per bucket.

Contoh: window 60 detik, bucket 1 detik, simpan 60 bucket.

Trade-off:

1. Memory lebih kecil.
2. Tidak exact sampai level millisecond.
3. Cocok untuk metrics/rate approximation.

---

## 15. Case study: rolling SLA breach metric

Misal ada timeline event per menit:

```text
0 = no breach
1 = breach
```

Kita ingin query:

> Berapa breach antara menit `l` sampai `r`?

Gunakan prefix count.

```java
public final class SlaBreachTimeline {
    private final int[] prefixBreach;

    public SlaBreachTimeline(boolean[] breachedByMinute) {
        this.prefixBreach = new int[breachedByMinute.length + 1];
        for (int i = 0; i < breachedByMinute.length; i++) {
            prefixBreach[i + 1] = prefixBreach[i] + (breachedByMinute[i] ? 1 : 0);
        }
    }

    public int countBreaches(int minuteStartInclusive, int minuteEndInclusive) {
        if (minuteStartInclusive < 0
                || minuteEndInclusive < minuteStartInclusive
                || minuteEndInclusive + 1 >= prefixBreach.length) {
            throw new IndexOutOfBoundsException();
        }

        return prefixBreach[minuteEndInclusive + 1] - prefixBreach[minuteStartInclusive];
    }

    public boolean hasAnyBreach(int minuteStartInclusive, int minuteEndInclusive) {
        return countBreaches(minuteStartInclusive, minuteEndInclusive) > 0;
    }
}
```

Jika data mutable dan update sering, prefix sum immutable tidak cukup. Alternatif:

1. Fenwick tree,
2. segment tree,
3. bucketed recomputation,
4. event-sourced append + periodic snapshot.

---

## 16. Case study: range update untuk workload planning

Misal ada rencana maintenance/service-load:

```text
service A butuh +3 worker dari jam 2 sampai 5
service B butuh +2 worker dari jam 4 sampai 8
service C butuh +1 worker dari jam 0 sampai 3
```

Dengan difference array, setiap interval update `O(1)`.

```java
public static long[] requiredCapacityByHour(int hours, List<CapacityInterval> intervals) {
    DifferenceArray diff = new DifferenceArray(hours);

    for (CapacityInterval interval : intervals) {
        diff.addInclusive(interval.startHourInclusive(), interval.endHourInclusive(), interval.capacityDelta());
    }

    return diff.materialize();
}

public record CapacityInterval(
        int startHourInclusive,
        int endHourInclusive,
        long capacityDelta
) {}
```

Ini pattern yang sama untuk:

1. load forecast,
2. batch processing capacity,
3. overlapping case assignments,
4. resource booking,
5. active rule period.

---

## 17. Choosing the right technique

### 17.1 Jika input sorted dan mencari pair/partition

Biasanya pertimbangkan two pointers.

Checklist:

1. Apakah data sorted?
2. Apakah menaikkan `left` atau menurunkan `right` bisa dibuktikan aman?
3. Apakah butuh mempertahankan original order?
4. Apakah sorting boleh dilakukan?

### 17.2 Jika window contiguous dan constraint monotonic

Pertimbangkan sliding window.

Checklist:

1. Apakah window selalu contiguous?
2. Apakah right hanya perlu maju?
3. Apakah saat invalid, left bisa maju sampai valid?
4. Apakah elemen negatif/operation non-monotonic merusak asumsi?
5. Apakah answer di-update saat valid atau saat invalid?

### 17.3 Jika banyak range query pada data immutable

Pertimbangkan prefix sum/count.

Checklist:

1. Apakah update jarang atau tidak ada?
2. Apakah query range banyak?
3. Apakah operation associative dan punya inverse? Untuk sum: ya.
4. Apakah butuh `long`?

### 17.4 Jika banyak range update lalu materialize

Pertimbangkan difference array.

Checklist:

1. Apakah update berupa penambahan konstan ke interval?
2. Apakah query intermediate tidak sering?
3. Apakah final materialization cukup?
4. Apakah index range dense?

### 17.5 Jika butuh min/max per moving window

Pertimbangkan monotonic deque.

Checklist:

1. Apakah window bergerak satu arah?
2. Apakah kandidat lama bisa didominasi kandidat baru?
3. Apakah butuh exact max/min untuk setiap window?
4. Apakah `PriorityQueue` akan butuh lazy deletion?

---

## 18. Failure modes yang sering terjadi

### 18.1 Off-by-one pada prefix sum

Bug umum:

```java
return prefix[right] - prefix[left]; // salah untuk inclusive right
```

Gunakan definisi konsisten:

```java
prefix[i + 1] = prefix[i] + a[i];
rangeSum(left, right) = prefix[right + 1] - prefix[left];
```

### 18.2 Sliding window untuk angka negatif

Bug:

```java
while (sum > target) left++;
```

Ini hanya aman untuk array non-negative pada constraint tertentu. Dengan angka negatif, window sum tidak monotonic.

### 18.3 Pointer mundur tanpa sadar

Bug last-seen:

```java
left = lastSeen[c] + 1;
```

Jika `lastSeen[c]` berada sebelum current `left`, ini membuat `left` mundur.

Benar:

```java
left = Math.max(left, lastSeen[c] + 1);
```

atau:

```java
if (lastSeen[c] >= left) {
    left = lastSeen[c] + 1;
}
```

### 18.4 Frequency map tidak menghapus zero count

Bug:

```java
freq.put(out, freq.get(out) - 1);
```

Jika count menjadi 0 tapi key tetap ada, `freq.size()` salah.

Benar:

```java
int next = freq.get(out) - 1;
if (next == 0) freq.remove(out);
else freq.put(out, next);
```

### 18.5 Overflow sum

Bug:

```java
int sum = 0;
for (int value : a) sum += value;
```

Gunakan:

```java
long sum = 0L;
```

### 18.6 `ArrayDeque<Integer>` boxing overhead

Untuk monotonic deque intensif, `ArrayDeque<Integer>` bisa cukup untuk readability, tetapi `int[]` deque lebih hemat untuk hot path.

### 18.7 Unbounded map/window dalam service long-running

Sliding log rate limiter yang menyimpan key tanpa cleanup akan menjadi memory leak logis.

Mitigasi:

1. TTL cleanup,
2. bounded key cardinality,
3. eviction policy,
4. approximate counters,
5. distributed store dengan expiration.

---

## 19. Testing strategy

### 19.1 Test brute-force oracle untuk input kecil

Untuk sliding/prefix algorithms, cara bagus adalah membuat implementasi brute-force untuk input kecil lalu compare.

Contoh test maximum fixed window:

```java
static long bruteMaxFixedWindowSum(int[] a, int k) {
    long best = Long.MIN_VALUE;
    for (int left = 0; left + k <= a.length; left++) {
        long sum = 0L;
        for (int i = left; i < left + k; i++) {
            sum += a[i];
        }
        best = Math.max(best, sum);
    }
    return best;
}
```

Generate random small arrays, compare dengan optimized version.

### 19.2 Boundary tests

Wajib test:

1. empty array,
2. size 1,
3. `k = 1`,
4. `k = n`,
5. all same values,
6. increasing values,
7. decreasing values,
8. negative values jika algorithm mendukung,
9. overflow-prone values,
10. invalid ranges.

### 19.3 Invariant assertions saat development

Untuk code internal/debug, assert invariant bisa membantu.

Contoh monotonic deque:

```java
static void assertDequeDecreasing(int[] a, int[] deque, int head, int tail) {
    for (int i = head + 1; i < tail; i++) {
        if (a[deque[i - 1]] < a[deque[i]]) {
            throw new AssertionError("Deque is not decreasing");
        }
    }
}
```

Jangan aktifkan assertion mahal di hot path production kecuali memang perlu debug mode.

---

## 20. Design checklist sebelum coding

Sebelum memilih teknik, jawab pertanyaan ini:

1. Apakah data contiguous atau graph/tree?
2. Apakah query berbasis range?
3. Apakah data mutable atau immutable?
4. Apakah update lebih sering daripada query?
5. Apakah input sorted?
6. Apakah constraint monotonic?
7. Apakah angka bisa negatif?
8. Apakah index dense?
9. Apakah key cardinality bounded?
10. Apakah memory growth perlu dibatasi?
11. Apakah result bisa overflow `int`?
12. Apakah butuh exact answer atau approximate cukup?
13. Apakah ini hot path latency-sensitive?
14. Apakah primitive array lebih cocok daripada collection?
15. Apakah invariant bisa dijelaskan dalam satu kalimat?

Jika invariant tidak bisa dijelaskan, kemungkinan besar implementasi akan fragile.

---

## 21. Mini pattern catalog

### 21.1 Fixed window template

```java
long state = 0L;

for (int i = 0; i < k; i++) {
    state += a[i];
}

for (int right = k; right < n; right++) {
    state -= a[right - k];
    state += a[right];
    // update answer
}
```

### 21.2 Variable valid-window template

```java
int left = 0;

for (int right = 0; right < n; right++) {
    add(right);

    while (invalid()) {
        remove(left);
        left++;
    }

    // [left, right] valid
    updateAnswer(left, right);
}
```

### 21.3 Variable satisfy-window template

```java
int left = 0;

for (int right = 0; right < n; right++) {
    add(right);

    while (satisfies()) {
        updateAnswer(left, right);
        remove(left);
        left++;
    }
}
```

### 21.4 Prefix sum template

```java
long[] prefix = new long[n + 1];
for (int i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + a[i];
}

long range = prefix[right + 1] - prefix[left];
```

### 21.5 Difference array template

```java
long[] diff = new long[n + 1];

diff[left] += delta;
diff[right + 1] -= delta;

long running = 0L;
for (int i = 0; i < n; i++) {
    running += diff[i];
    result[i] = running;
}
```

### 21.6 Monotonic max deque template

```java
while (head < tail && deque[head] <= right - k) head++;
while (head < tail && a[deque[tail - 1]] <= a[right]) tail--;
deque[tail++] = right;
```

---

## 22. Latihan bertahap

### Level 1 — Basic transformation

1. Maximum sum subarray length `k`.
2. Count number of windows length `k` with average >= threshold.
3. Reverse array with two pointers.
4. Remove duplicates from sorted array.
5. Range sum query immutable array.

### Level 2 — Invariant discipline

1. Longest subarray with sum <= target, non-negative values.
2. Shortest subarray with sum >= target, non-negative values.
3. Longest substring without repeating characters.
4. Longest substring with at most `k` distinct characters.
5. Count subarrays with sum exactly `k`, values can be negative.

### Level 3 — Production-like

1. Sliding log rate limiter with cleanup.
2. Rolling error-rate monitor over fixed event buckets.
3. Active interval count from start/end schedules.
4. Capacity planning with range updates.
5. Sliding window maximum latency per minute.

### Level 4 — Advanced reasoning

1. Minimum window substring containing all required chars.
2. Sliding window median.
3. Shortest subarray with sum at least K with negative values.
4. 2D rectangle sum query.
5. 2D range update materialization.

---

## 23. Ringkasan mental model

1. **Two pointers** mengurangi search space dengan membuang kandidat yang terbukti tidak mungkin.
2. **Fast/slow pointer** memisahkan read position dan write/candidate position.
3. **Fixed sliding window** memakai delta: satu keluar, satu masuk.
4. **Variable sliding window** butuh constraint monotonic agar pointer kiri/kanan hanya maju.
5. **Prefix sum** mengubah range query dari scan menjadi subtraction.
6. **Difference array** mengubah range update dari loop menjadi boundary delta.
7. **Frequency window** menjaga multiset kecil yang merepresentasikan isi window.
8. **Monotonic deque** menyimpan kandidat yang tidak didominasi.
9. Di Java, gunakan `long` untuk akumulasi, primitive array untuk hot path, dan hindari allocation/boxing yang tidak perlu.
10. Kualitas solusi terletak pada invariant, bukan template.

---

## 24. Referensi

1. Oracle Java SE 25 — `Arrays`: binary search, sorting, filling, array utilities.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html
2. Oracle Java SE 25 — `ArrayDeque`: deque berbasis resizable array, stack/queue usage, tidak menerima `null`.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html
3. Oracle Java SE 25 — `HashMap`: hash table implementation, capacity/load factor, iteration-order caveat.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html
4. Oracle Java SE 25 — Collections Framework Overview.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html
5. Oracle Java SE 25 — `PriorityQueue`: priority heap behavior, iterator ordering caveat.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html

---

## 25. Status seri

Bagian ini menyelesaikan:

```text
Part 021 — Sliding Window, Two Pointers, Prefix Sum, Difference Array
```

Seri belum selesai. Berikutnya:

```text
Part 022 — Bit Manipulation, BitSet, Bloom Filter
```
