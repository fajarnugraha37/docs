# learn-java-dsa-part-020 — Greedy Algorithms and Exchange Argument

> Seri: Java Data Structure and Algorithm Advanced  
> Bagian: 020 dari 030  
> Status seri: belum selesai  
> Fokus: greedy algorithm sebagai teknik desain yang harus dibuktikan, bukan sekadar pattern hafalan.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas Dynamic Programming. DP cocok ketika keputusan sekarang bergantung pada kombinasi subproblem dan kita perlu menyimpan hasil antara. Greedy berada di sisi lain: kita mencoba mengambil keputusan lokal yang tampak terbaik sekarang, lalu berharap keputusan itu tetap bisa menjadi bagian dari solusi optimal global.

Masalahnya: banyak algoritma greedy terlihat masuk akal, tetapi salah.

Bagian ini bertujuan membuat kamu mampu:

1. Mengenali kapan greedy mungkin valid.
2. Membedakan greedy yang benar dari heuristic yang hanya terasa benar.
3. Membuktikan greedy dengan exchange argument.
4. Memilih struktur data Java yang tepat untuk greedy: sorting, heap, map, deque, interval list.
5. Menerapkan greedy untuk masalah produksi seperti prioritas SLA, retry scheduling, allocation, resource planning, dan conflict resolution.
6. Mengetahui kapan greedy harus diganti dengan DP, graph algorithm, search, atau optimization model.

---

## 1. Mental Model: Greedy Adalah Komitmen Lokal

Greedy algorithm membuat pilihan terbaik menurut ukuran lokal, lalu tidak kembali mengubah pilihan itu.

Bentuk mentalnya:

```text
while masih ada keputusan:
    pilih kandidat terbaik menurut rule lokal
    commit pilihan itu
    update state
return solusi
```

Kata paling penting: **commit**.

Backtracking berkata:

```text
pilih -> coba -> undo kalau salah
```

Dynamic Programming berkata:

```text
pecah state -> hitung semua kemungkinan relevan -> ambil optimal
```

Greedy berkata:

```text
pilih sekarang -> jangan menyesal
```

Karena itu greedy sangat cepat jika benar, tetapi sangat berbahaya jika rule lokalnya salah.

---

## 2. Contoh Intuitif: Coin Change

Misal tersedia coin:

```text
1, 5, 10, 25
```

Untuk amount 30, greedy mengambil:

```text
25 + 5 = 2 coins
```

Benar.

Untuk amount 40:

```text
25 + 10 + 5 = 3 coins
```

Benar.

Tapi jika coin-nya:

```text
1, 3, 4
```

Amount 6 dengan greedy largest coin:

```text
4 + 1 + 1 = 3 coins
```

Padahal optimal:

```text
3 + 3 = 2 coins
```

Jadi rule “ambil coin terbesar” tidak selalu benar. Ia benar untuk beberapa currency system, tetapi bukan universal.

Pelajaran penting:

> Greedy bukan soal rule yang terdengar masuk akal. Greedy harus punya struktur pembuktian.

---

## 3. Dua Properti Utama Greedy

Greedy biasanya valid jika problem memiliki dua properti:

1. **Greedy-choice property**
2. **Optimal substructure**

### 3.1 Greedy-choice property

Ada pilihan lokal yang bisa dijamin menjadi bagian dari solusi optimal.

Artinya, ketika kita memilih kandidat terbaik menurut rule lokal, kita tidak sedang mengorbankan optimalitas global.

Contoh:

Untuk interval scheduling, memilih aktivitas yang selesai paling awal adalah aman, karena aktivitas yang selesai lebih awal menyisakan ruang paling besar untuk aktivitas berikutnya.

### 3.2 Optimal substructure

Setelah pilihan greedy dibuat, sisa problem tetap berbentuk problem yang sama.

Misal:

```text
Pilih aktivitas selesai paling awal.
Buang aktivitas yang overlap.
Sisa aktivitas masih problem interval scheduling.
```

Jika dua properti ini tidak ada, greedy biasanya tidak bisa dijamin benar.

---

## 4. Greedy vs Heuristic

Ini distinction penting untuk engineer.

### 4.1 Greedy algorithm

Greedy algorithm adalah algorithm dengan jaminan correctness untuk problem tertentu.

Contoh:

- Activity selection by earliest finish time.
- Huffman coding by combining two minimum frequencies.
- Dijkstra untuk graph dengan non-negative edge weight.
- Kruskal untuk minimum spanning tree.

### 4.2 Greedy heuristic

Greedy heuristic adalah strategi lokal yang sering bagus, tetapi tidak menjamin optimal.

Contoh:

- Assign task ke worker yang saat ini paling sedikit load.
- Retry request yang paling baru gagal dulu.
- Prioritize customer terbesar dulu.
- Pick cheapest vendor first.

Bisa berguna, tetapi harus diperlakukan sebagai policy, bukan proof-backed optimization.

Dalam sistem produksi, heuristic boleh dipakai jika:

1. Optimality tidak wajib.
2. Rule mudah dijelaskan.
3. Ada metric untuk mengevaluasi hasil.
4. Ada fallback/manual override.
5. Failure impact dipahami.

---

## 5. Exchange Argument: Cara Membuktikan Greedy

Exchange argument adalah teknik pembuktian greedy yang sangat penting.

Polanya:

1. Ambil solusi optimal sembarang `OPT`.
2. Tunjukkan bahwa jika `OPT` tidak memakai pilihan greedy `g`, kita bisa menukar sebagian solusi `OPT` dengan `g`.
3. Setelah ditukar, solusi tetap valid.
4. Kualitas solusi tidak lebih buruk.
5. Maka ada solusi optimal yang mengandung pilihan greedy.
6. Setelah itu problem berkurang menjadi subproblem yang sama.

Template:

```text
Let g be the greedy choice.
Let OPT be an optimal solution.
If OPT already contains g, done.
If not, replace some element x in OPT with g.
Show feasibility is preserved.
Show objective does not get worse.
Therefore, there exists an optimal solution containing g.
Then recursively solve remaining subproblem.
```

Inilah perbedaan antara “greedy kelihatannya benar” dan “greedy terbukti benar”.

---

## 6. Activity Selection / Interval Scheduling

Problem:

Diberikan beberapa aktivitas dengan start dan end time. Pilih sebanyak mungkin aktivitas yang tidak overlap.

Contoh:

```text
A: [1, 4]
B: [3, 5]
C: [0, 6]
D: [5, 7]
E: [8, 9]
```

Greedy rule:

> Pilih aktivitas yang selesai paling awal.

### 6.1 Kenapa bukan start paling awal?

Jika memilih start paling awal:

```text
C: [0, 6]
```

Mungkin kita kehilangan banyak aktivitas pendek setelahnya.

### 6.2 Kenapa finish paling awal?

Aktivitas yang selesai paling awal menyisakan ruang paling besar bagi aktivitas berikutnya.

Exchange argument:

1. Misal `g` adalah aktivitas dengan finish paling awal.
2. Ambil solusi optimal `OPT`.
3. Misal aktivitas pertama dalam `OPT` adalah `x`.
4. Karena `g` finish tidak lebih lambat dari `x`, mengganti `x` dengan `g` tidak membuat aktivitas berikutnya overlap.
5. Jumlah aktivitas tetap sama.
6. Maka ada solusi optimal yang dimulai dengan `g`.
7. Sisa problem adalah aktivitas yang start setelah `g.end`.

### 6.3 Java implementation

```java
import java.util.*;

public final class ActivitySelection {
    public record Interval(String id, int start, int end) {
        public Interval {
            if (end < start) {
                throw new IllegalArgumentException("end must be >= start");
            }
        }
    }

    public static List<Interval> selectMaxNonOverlapping(List<Interval> intervals) {
        List<Interval> sorted = new ArrayList<>(intervals);
        sorted.sort(Comparator
                .comparingInt(Interval::end)
                .thenComparingInt(Interval::start)
                .thenComparing(Interval::id));

        List<Interval> result = new ArrayList<>();
        int currentEnd = Integer.MIN_VALUE;

        for (Interval interval : sorted) {
            if (interval.start() >= currentEnd) {
                result.add(interval);
                currentEnd = interval.end();
            }
        }

        return List.copyOf(result);
    }
}
```

### 6.4 Complexity

Sorting dominates:

```text
Time:  O(n log n)
Space: O(n) for copied sorted list + result
```

If input is already sorted by end time:

```text
Time: O(n)
```

### 6.5 Production mapping

Ini muncul di:

- memilih slot meeting maksimal,
- memilih job non-overlapping,
- booking resource,
- maintenance window planning,
- selecting non-conflicting rule effective periods,
- batch window scheduling.

---

## 7. Interval Partitioning: Minimum Number of Resources

Problem:

Diberikan interval, tentukan minimum resource agar semua interval bisa dijalankan tanpa overlap pada resource yang sama.

Contoh:

```text
Meeting rooms problem.
Minimum rooms needed.
```

Greedy rule:

1. Sort by start time.
2. Simpan end time setiap resource dalam min-heap.
3. Untuk interval berikutnya:
   - jika resource paling cepat selesai sudah bebas, reuse,
   - jika belum, allocate resource baru.

### 7.1 Kenapa heap?

Kita hanya butuh resource yang paling cepat selesai. Java `PriorityQueue` cocok karena head queue adalah elemen prioritas terkecil berdasarkan natural ordering atau comparator.

### 7.2 Java implementation

```java
import java.util.*;

public final class MinimumRooms {
    public record Interval(int start, int end) {
        public Interval {
            if (end < start) throw new IllegalArgumentException("end < start");
        }
    }

    public static int minRooms(List<Interval> intervals) {
        if (intervals.isEmpty()) return 0;

        List<Interval> sorted = new ArrayList<>(intervals);
        sorted.sort(Comparator
                .comparingInt(Interval::start)
                .thenComparingInt(Interval::end));

        PriorityQueue<Integer> roomEndTimes = new PriorityQueue<>();

        for (Interval interval : sorted) {
            if (!roomEndTimes.isEmpty() && roomEndTimes.peek() <= interval.start()) {
                roomEndTimes.poll();
            }
            roomEndTimes.offer(interval.end());
        }

        return roomEndTimes.size();
    }
}
```

### 7.3 Complexity

```text
Sort: O(n log n)
Each heap operation: O(log r), r <= n
Total: O(n log n)
Space: O(n)
```

### 7.4 Production mapping

- minimum worker pool size,
- concurrent reviewer capacity,
- number of rooms/counters/agents,
- overlapping SLA windows,
- concurrent migration windows,
- capacity planning for scheduled tasks.

---

## 8. Merge Intervals

Problem:

Diberikan interval yang mungkin overlap. Gabungkan interval overlap.

Greedy rule:

1. Sort by start.
2. Maintain current merged interval.
3. Jika next.start <= current.end, merge.
4. Jika tidak, commit current dan mulai interval baru.

### 8.1 Java implementation

```java
import java.util.*;

public final class MergeIntervals {
    public record Interval(int start, int end) {
        public Interval {
            if (end < start) throw new IllegalArgumentException("end < start");
        }
    }

    public static List<Interval> merge(List<Interval> intervals) {
        if (intervals.isEmpty()) return List.of();

        List<Interval> sorted = new ArrayList<>(intervals);
        sorted.sort(Comparator
                .comparingInt(Interval::start)
                .thenComparingInt(Interval::end));

        List<Interval> result = new ArrayList<>();
        int start = sorted.getFirst().start();
        int end = sorted.getFirst().end();

        for (int i = 1; i < sorted.size(); i++) {
            Interval next = sorted.get(i);
            if (next.start() <= end) {
                end = Math.max(end, next.end());
            } else {
                result.add(new Interval(start, end));
                start = next.start();
                end = next.end();
            }
        }

        result.add(new Interval(start, end));
        return List.copyOf(result);
    }
}
```

Note:

`List.getFirst()` tersedia pada `List` modern karena `List` sekarang memiliki operasi sequenced collection. Jika target proyek masih Java lama, gunakan `sorted.get(0)`.

### 8.2 Edge semantics

Harus jelas apakah interval menggunakan:

```text
[start, end]
```

atau:

```text
[start, end)
```

Untuk time interval production, `[start, end)` sering lebih aman karena adjacent interval tidak overlap:

```text
[09:00, 10:00)
[10:00, 11:00)
```

Jika menggunakan half-open interval, kondisi merge menjadi:

```java
if (next.start() <= end) // merge touching intervals
```

atau:

```java
if (next.start() < end) // only merge strictly overlapping intervals
```

Pilih secara eksplisit.

---

## 9. Minimum Arrows / Minimum Points to Cover Intervals

Problem:

Diberikan interval. Pilih minimum jumlah point sehingga setiap interval mengandung minimal satu point.

Greedy rule:

> Sort by end, pilih end paling awal sebagai point.

Ini mirip interval scheduling, tetapi objective-nya berbeda.

### 9.1 Java implementation

```java
import java.util.*;

public final class MinimumCoverPoints {
    public record Interval(int start, int end) {
        public Interval {
            if (end < start) throw new IllegalArgumentException("end < start");
        }
    }

    public static List<Integer> minimumPoints(List<Interval> intervals) {
        List<Interval> sorted = new ArrayList<>(intervals);
        sorted.sort(Comparator
                .comparingInt(Interval::end)
                .thenComparingInt(Interval::start));

        List<Integer> points = new ArrayList<>();
        Integer lastPoint = null;

        for (Interval interval : sorted) {
            if (lastPoint == null || lastPoint < interval.start()) {
                lastPoint = interval.end();
                points.add(lastPoint);
            }
        }

        return List.copyOf(points);
    }
}
```

### 9.2 Production mapping

- menentukan minimum audit checkpoint untuk mencakup active periods,
- minimum sampling time untuk mencakup sessions,
- minimum notification batch time,
- minimum rule evaluation anchor point.

---

## 10. Huffman Coding: Greedy dengan Priority Queue

Huffman coding membangun prefix code optimal berdasarkan frequency.

Greedy rule:

> Ambil dua node dengan frequency terkecil, gabungkan, masukkan kembali.

Repeat sampai satu root tersisa.

### 10.1 Mental model

Karakter yang jarang muncul boleh punya code lebih panjang. Karakter yang sering muncul harus punya code lebih pendek.

Menggabungkan dua frequency terkecil berarti dua simbol paling jarang ditempatkan paling dalam pada tree.

### 10.2 Java implementation skeleton

```java
import java.util.*;

public final class HuffmanCoding {
    sealed interface Node permits Leaf, Branch {
        int frequency();
    }

    public record Leaf(char symbol, int frequency) implements Node {
        public Leaf {
            if (frequency <= 0) throw new IllegalArgumentException("frequency must be positive");
        }
    }

    public record Branch(Node left, Node right, int frequency) implements Node {
        public Branch {
            if (left == null || right == null) throw new NullPointerException();
            if (frequency != left.frequency() + right.frequency()) {
                throw new IllegalArgumentException("invalid branch frequency");
            }
        }
    }

    public static Node build(Map<Character, Integer> frequencies) {
        if (frequencies.isEmpty()) {
            throw new IllegalArgumentException("frequencies must not be empty");
        }

        PriorityQueue<Node> pq = new PriorityQueue<>(
                Comparator.comparingInt(Node::frequency)
        );

        for (Map.Entry<Character, Integer> entry : frequencies.entrySet()) {
            pq.offer(new Leaf(entry.getKey(), entry.getValue()));
        }

        while (pq.size() > 1) {
            Node a = pq.poll();
            Node b = pq.poll();
            pq.offer(new Branch(a, b, a.frequency() + b.frequency()));
        }

        return pq.remove();
    }
}
```

### 10.3 PriorityQueue pitfalls

`PriorityQueue` iteration is not sorted. If you need sorted output, repeatedly poll or copy and sort.

Also, never mutate the priority field after inserting an element into `PriorityQueue`. The heap will not automatically reorder itself.

---

## 11. Greedy dengan Sorting

Banyak greedy problem dimulai dengan sorting.

Common patterns:

```text
sort by earliest end
sort by latest start
sort by smallest cost
sort by highest profit
sort by deadline
sort by ratio
sort by severity then deadline
```

Tetapi sorting key adalah klaim correctness.

Kalau kamu sort by `deadline`, kamu sedang mengklaim:

> Deadline earlier should be committed earlier.

Kalau kamu sort by `profit/cost ratio`, kamu sedang mengklaim:

> Rasio lokal cukup untuk objective global.

Ini benar untuk fractional knapsack, tetapi salah untuk 0/1 knapsack.

---

## 12. Fractional Knapsack vs 0/1 Knapsack

### 12.1 Fractional knapsack

Barang bisa diambil sebagian.

Greedy rule:

> Ambil value/weight ratio tertinggi dulu.

Ini benar karena kita bisa menukar kapasitas kecil dari item rasio rendah dengan rasio tinggi tanpa memperburuk nilai.

### 12.2 0/1 knapsack

Barang harus diambil utuh atau tidak sama sekali.

Greedy by ratio bisa salah.

Contoh:

```text
Capacity = 50
Item A: value 60, weight 10, ratio 6
Item B: value 100, weight 20, ratio 5
Item C: value 120, weight 30, ratio 4
```

Greedy ratio:

```text
A + B = value 160, weight 30
```

Optimal:

```text
B + C = value 220, weight 50
```

Maka 0/1 knapsack butuh DP, bukan greedy sederhana.

---

## 13. Job Sequencing with Deadlines and Profit

Problem:

Setiap job butuh 1 slot waktu, punya deadline dan profit. Pilih job agar total profit maksimum dan job selesai sebelum deadline.

Greedy idea:

1. Sort job by highest profit.
2. Tempatkan job pada slot kosong paling akhir sebelum deadline.

### 13.1 Kenapa slot paling akhir?

Karena slot awal lebih fleksibel untuk job dengan deadline lebih ketat.

### 13.2 Java implementation sederhana

```java
import java.util.*;

public final class JobSequencing {
    public record Job(String id, int deadline, int profit) {
        public Job {
            if (deadline <= 0) throw new IllegalArgumentException("deadline must be positive");
            if (profit < 0) throw new IllegalArgumentException("profit must be non-negative");
        }
    }

    public static List<Job> schedule(List<Job> jobs) {
        if (jobs.isEmpty()) return List.of();

        List<Job> sorted = new ArrayList<>(jobs);
        sorted.sort(Comparator
                .comparingInt(Job::profit).reversed()
                .thenComparingInt(Job::deadline)
                .thenComparing(Job::id));

        int maxDeadline = sorted.stream()
                .mapToInt(Job::deadline)
                .max()
                .orElse(0);

        Job[] slots = new Job[maxDeadline + 1];

        for (Job job : sorted) {
            for (int slot = Math.min(job.deadline(), maxDeadline); slot >= 1; slot--) {
                if (slots[slot] == null) {
                    slots[slot] = job;
                    break;
                }
            }
        }

        List<Job> result = new ArrayList<>();
        for (int slot = 1; slot < slots.length; slot++) {
            if (slots[slot] != null) {
                result.add(slots[slot]);
            }
        }
        return List.copyOf(result);
    }
}
```

### 13.3 Complexity

```text
Sort: O(n log n)
Slot search: O(n * D)
Space: O(D)
```

Untuk deadline besar, gunakan DSU untuk mencari available slot lebih cepat. Itu menghubungkan greedy dengan struktur data dari part DSU.

---

## 14. Greedy untuk Resource Allocation

Dalam sistem nyata, banyak allocation policy bersifat greedy.

Contoh:

```text
Assign incoming case ke reviewer dengan queue paling pendek.
Assign migration job ke worker dengan available capacity paling besar.
Assign retry ke node dengan earliest available time.
Assign priority based on severity and deadline.
```

Namun kebanyakan ini bukan optimal algorithm, melainkan policy.

### 14.1 Example: earliest available worker

```java
import java.time.*;
import java.util.*;

public final class WorkerAssignment {
    public record Task(String id, Duration duration) {
        public Task {
            if (duration.isNegative() || duration.isZero()) {
                throw new IllegalArgumentException("duration must be positive");
            }
        }
    }

    public record WorkerState(String workerId, Instant availableAt) {}

    public record Assignment(String workerId, String taskId, Instant startAt, Instant finishAt) {}

    private record WorkerSlot(String workerId, Instant availableAt) {}

    public static List<Assignment> assign(List<Task> tasks, List<WorkerState> workers) {
        if (workers.isEmpty()) throw new IllegalArgumentException("workers must not be empty");

        PriorityQueue<WorkerSlot> pq = new PriorityQueue<>(Comparator
                .comparing(WorkerSlot::availableAt)
                .thenComparing(WorkerSlot::workerId));

        for (WorkerState worker : workers) {
            pq.offer(new WorkerSlot(worker.workerId(), worker.availableAt()));
        }

        List<Assignment> assignments = new ArrayList<>();

        for (Task task : tasks) {
            WorkerSlot slot = pq.remove();
            Instant start = slot.availableAt();
            Instant finish = start.plus(task.duration());
            assignments.add(new Assignment(slot.workerId(), task.id(), start, finish));
            pq.offer(new WorkerSlot(slot.workerId(), finish));
        }

        return List.copyOf(assignments);
    }
}
```

This is greedy load assignment. It is often good, deterministic, and explainable. But it may not be globally optimal if task durations vary significantly and all tasks are known upfront. In that case, sorting longer tasks first may improve makespan.

---

## 15. Greedy and Determinism

Production greedy algorithms should be deterministic.

Bad:

```java
Comparator.comparingInt(Job::profit).reversed()
```

If two jobs have same profit, order may depend on input order. Sometimes okay, sometimes dangerous.

Better:

```java
Comparator.comparingInt(Job::profit).reversed()
        .thenComparingInt(Job::deadline)
        .thenComparing(Job::id)
```

Why deterministic tie-breakers matter:

1. Reproducible debugging.
2. Stable audit trail.
3. Consistent behavior across nodes.
4. Less flaky tests.
5. More defensible business decision.

For regulatory/business systems, deterministic tie-breaking is not optional when output affects users.

---

## 16. Common Greedy Patterns

### 16.1 Sort then scan

Used for:

- interval scheduling,
- merge intervals,
- minimum arrows,
- meeting rooms,
- assigning tasks.

Template:

```java
List<T> sorted = new ArrayList<>(items);
sorted.sort(comparator);

State state = initialState();
for (T item : sorted) {
    if (canTake(item, state)) {
        take(item, state);
    } else {
        skipOrUpdate(item, state);
    }
}
return buildResult(state);
```

### 16.2 Heap greedy

Used for:

- always pick min/max,
- scheduling,
- top-k,
- k-way merge,
- Huffman coding,
- resource assignment.

Template:

```java
PriorityQueue<T> pq = new PriorityQueue<>(comparator);
pq.addAll(items);

while (!pq.isEmpty()) {
    T best = pq.poll();
    process(best);
    if (newCandidateExists()) {
        pq.offer(newCandidate);
    }
}
```

### 16.3 Greedy with replacement

Used when we maintain selected items and replace weaker choice with better one.

Example:

- maximize number of courses before deadlines,
- choose tasks with duration constraints.

Pattern:

```text
Sort by deadline.
Take item.
If constraint violated, remove the worst selected item.
```

This often uses max-heap.

---

## 17. Course Schedule III Pattern

Problem:

Each course has duration and deadline. Take maximum number of courses before deadline.

Greedy:

1. Sort by deadline ascending.
2. Add course duration.
3. Keep selected durations in max-heap.
4. If total duration exceeds current deadline, remove longest selected course.

Why?

At each deadline boundary, if we exceed time, dropping the longest course frees most capacity and preserves maximum count.

### Java implementation

```java
import java.util.*;

public final class MaxCoursesBeforeDeadline {
    public record Course(String id, int duration, int deadline) {
        public Course {
            if (duration <= 0) throw new IllegalArgumentException("duration must be positive");
            if (deadline <= 0) throw new IllegalArgumentException("deadline must be positive");
        }
    }

    public static int maxCourses(List<Course> courses) {
        List<Course> sorted = new ArrayList<>(courses);
        sorted.sort(Comparator
                .comparingInt(Course::deadline)
                .thenComparingInt(Course::duration)
                .thenComparing(Course::id));

        PriorityQueue<Integer> longestDurations = new PriorityQueue<>(Comparator.reverseOrder());
        int total = 0;

        for (Course course : sorted) {
            total += course.duration();
            longestDurations.offer(course.duration());

            if (total > course.deadline()) {
                total -= longestDurations.remove();
            }
        }

        return longestDurations.size();
    }
}
```

Production analogy:

- select maximum trainings before deadlines,
- choose migration tasks before freeze window,
- choose remediation tasks before audit date,
- select batch jobs before maintenance end.

---

## 18. Greedy for SLA Triage

Suppose cases have:

```text
severity
remaining SLA time
business priority
estimated effort
```

A naive greedy rule:

```text
Pick highest severity first.
```

This may starve lower-severity cases and still miss many deadlines.

Another rule:

```text
Pick earliest deadline first.
```

Better for deadline misses, but may ignore severity.

Another:

```text
Pick highest weighted score.
```

Could be explainable but not necessarily optimal.

### 18.1 Engineering framing

For production triage, ask:

1. What objective are we optimizing?
   - minimize missed SLA count?
   - minimize weighted penalty?
   - maximize resolved severity points?
   - fairness?
2. Are tasks preemptible?
3. Are durations known?
4. Are new tasks arriving online?
5. Is optimality required or policy explainability more important?
6. Can humans override?

### 18.2 Deterministic priority comparator

```java
import java.time.*;
import java.util.*;

public final class CaseTriage {
    enum Severity { LOW, MEDIUM, HIGH, CRITICAL }

    public record CaseItem(
            String caseId,
            Severity severity,
            Instant dueAt,
            int estimatedMinutes,
            int businessPriority
    ) {}

    public static final Comparator<CaseItem> TRIAGE_ORDER = Comparator
            .comparing(CaseTriage::severityRank).reversed()
            .thenComparing(CaseItem::dueAt)
            .thenComparingInt(CaseItem::businessPriority).reversed()
            .thenComparingInt(CaseItem::estimatedMinutes)
            .thenComparing(CaseItem::caseId);

    private static int severityRank(CaseItem c) {
        return switch (c.severity()) {
            case LOW -> 1;
            case MEDIUM -> 2;
            case HIGH -> 3;
            case CRITICAL -> 4;
        };
    }
}
```

This is not automatically optimal. It is a deterministic greedy policy. Treat it as business policy, test it with historical data, and document trade-offs.

---

## 19. Greedy Correctness Checklist

Before shipping a greedy algorithm, answer:

1. What exactly is the objective?
2. What is the local greedy choice?
3. Why is this choice safe?
4. Can every optimal solution be transformed to include this choice?
5. After taking the choice, is the remaining problem the same kind of problem?
6. Is there a counterexample with small input?
7. Are tie-breakers deterministic?
8. Does sorting key fully reflect the proof?
9. Are edge cases defined?
10. Is this an algorithm with proof or a heuristic policy?

---

## 20. How to Find Counterexamples

When greedy seems plausible, try to break it.

### 20.1 Small exhaustive search

For small `n`, compare greedy result to brute force.

Example for interval selection:

```java
static int bruteForceMaxNonOverlap(List<ActivitySelection.Interval> intervals) {
    int n = intervals.size();
    int best = 0;

    for (int mask = 0; mask < (1 << n); mask++) {
        List<ActivitySelection.Interval> chosen = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            if ((mask & (1 << i)) != 0) {
                chosen.add(intervals.get(i));
            }
        }
        if (isNonOverlapping(chosen)) {
            best = Math.max(best, chosen.size());
        }
    }
    return best;
}

static boolean isNonOverlapping(List<ActivitySelection.Interval> intervals) {
    List<ActivitySelection.Interval> sorted = new ArrayList<>(intervals);
    sorted.sort(Comparator.comparingInt(ActivitySelection.Interval::start));
    for (int i = 1; i < sorted.size(); i++) {
        if (sorted.get(i).start() < sorted.get(i - 1).end()) {
            return false;
        }
    }
    return true;
}
```

This is not for production runtime. It is for validating algorithm idea and tests.

### 20.2 Property-based thinking

Generate random small inputs and assert:

```text
greedy(input) == bruteForce(input)
```

If it fails, inspect counterexample.

This is a powerful way to discover that a greedy idea is actually false.

---

## 21. Greedy Failure Modes

### 21.1 Wrong sorting key

Example:

For activity selection, sorting by start time is wrong. Need finish time.

### 21.2 Missing tie-breaker

Same priority produces non-deterministic or input-dependent output.

### 21.3 Local metric ignores constraint

Example:

Pick highest profit but ignore deadline feasibility.

### 21.4 Ratio trap

Ratio works for fractional knapsack, not 0/1 knapsack.

### 21.5 Online vs offline confusion

If all tasks are known upfront, one greedy strategy may work. If tasks arrive over time, the same strategy may fail or require competitive-analysis framing.

### 21.6 Mutation inside priority queue

If object priority changes after insertion, Java `PriorityQueue` does not reheapify automatically.

Bad:

```java
Task task = ...;
pq.offer(task);
task.priority = 999; // heap invariant now logically broken
```

Better:

- use immutable priority objects,
- remove and reinsert,
- use lazy invalidation with version number.

### 21.7 Assuming PriorityQueue iteration order

Bad:

```java
for (Task t : pq) {
    // not sorted order
}
```

Use:

```java
while (!pq.isEmpty()) {
    Task t = pq.poll();
}
```

or copy and sort.

---

## 22. Java-Specific Notes

### 22.1 Comparator overflow

Bad:

```java
(a, b) -> b.profit() - a.profit()
```

This can overflow.

Better:

```java
Comparator.comparingInt(Job::profit).reversed()
```

### 22.2 Stable sort and deterministic output

Java object-list sorting is stable for `List.sort`, but do not use stability as hidden business logic. Add explicit tie-breakers.

### 22.3 Primitive vs object cost

For algorithm practice, object records are readable.

For hot production path, primitive arrays may be faster and smaller:

```java
int[] start;
int[] end;
int[] idIndex;
```

But primitive arrays reduce readability and increase bug risk. Use them only when profiling shows collection/object overhead matters.

### 22.4 Avoid stream-heavy hot loops

Streams can be clear, but greedy algorithms are often stateful scans. Plain loops are usually clearer and easier to reason about for mutation-heavy algorithmic code.

### 22.5 Defensive copy

If sorting input would surprise caller, copy first:

```java
List<T> sorted = new ArrayList<>(input);
sorted.sort(comparator);
```

Do not mutate caller-owned collection unless API explicitly says so.

---

## 23. Testing Strategy for Greedy Algorithms

### 23.1 Example-based tests

Use known cases:

- empty input,
- one item,
- all compatible,
- all conflicting,
- same start,
- same end,
- adjacent intervals,
- zero-length interval if allowed.

### 23.2 Counterexample tests

For known wrong strategies, include tests proving why they are wrong.

Example coin change:

```text
coins = [1, 3, 4], amount = 6
largest coin greedy gives 3 coins
optimal is 2 coins
```

### 23.3 Brute-force oracle for small input

For small `n`, compare greedy to exhaustive search.

### 23.4 Determinism tests

If equal priority exists, verify output order is stable based on explicit tie-breakers.

### 23.5 Invariant tests

Examples:

```text
selected intervals never overlap
all scheduled jobs meet deadlines
merged intervals are sorted and non-overlapping
heap-based assignment never loses tasks
```

---

## 24. Production Design: Greedy Policy Documentation

For every greedy production rule, document:

```text
Name:
Objective:
Input:
Output:
Greedy choice:
Tie-breakers:
Feasibility constraints:
Correctness argument or heuristic rationale:
Known counterexamples / limitations:
Operational metrics:
Fallback:
Human override:
Audit fields:
```

Example:

```text
Name: SLA Triage Ordering
Objective: prioritize cases by severity while reducing imminent SLA misses
Greedy choice: process highest severity first, then earliest due date
Tie-breakers: business priority, estimated duration, case id
Correctness: heuristic policy, not globally optimal scheduling
Limitation: may starve low severity cases unless aging boost is added
Metric: missed SLA count, weighted missed SLA penalty, average wait time by severity
Fallback: manual queue override by supervisor
Audit fields: computed priority, rule version, input factors
```

This level of documentation matters for defensibility.

---

## 25. Greedy vs DP vs Graph vs Search

Use greedy when:

1. A local choice can be proven safe.
2. Objective and constraints are simple enough.
3. Subproblem remains structurally identical.
4. You can produce exchange argument or cut property.

Use DP when:

1. Choices interact across dimensions.
2. You need evaluate combinations.
3. There are overlapping subproblems.
4. Greedy counterexample exists.

Use graph algorithms when:

1. Problem is about reachability, path, dependency, or connectivity.
2. State transitions matter.
3. Constraints are edges or weights.

Use search/backtracking when:

1. Constraints are complex.
2. Need enumerate feasible assignments.
3. Need exact solution for small/medium problem.

Use heuristic/optimization model when:

1. Problem is NP-hard at production scale.
2. Exact optimality is too expensive.
3. Good-enough solution with monitoring is acceptable.

---

## 26. Case Study: Escalation Queue Design

Suppose a regulatory case management system needs escalation ordering.

Each case has:

```text
caseId
severity
state
submittedAt
dueAt
lastActionAt
assignedOfficer
estimatedEffort
hasExternalDependency
```

Naive greedy:

```text
Sort by dueAt ascending.
```

Problem:

- Critical cases due later may be delayed.
- Cases blocked by external dependency may waste reviewer attention.
- Long effort cases may never start if short tasks keep arriving.

Better policy may be:

```text
1. Exclude blocked cases from active queue, but track them in blocked index.
2. Rank by severity bucket.
3. Within severity, rank by dueAt.
4. Add aging boost to prevent starvation.
5. Use deterministic tie-breaker by caseId.
6. Log priority factors for audit.
```

This is greedy triage, but not mathematical optimality.

### Java sketch

```java
import java.time.*;
import java.util.*;

public final class EscalationQueue {
    enum Severity { LOW, MEDIUM, HIGH, CRITICAL }
    enum State { OPEN, IN_REVIEW, BLOCKED, CLOSED }

    public record CaseItem(
            String caseId,
            Severity severity,
            State state,
            Instant submittedAt,
            Instant dueAt,
            Instant lastActionAt,
            int estimatedEffortMinutes,
            boolean hasExternalDependency
    ) {}

    public static List<CaseItem> rank(List<CaseItem> cases, Instant now) {
        List<CaseItem> active = cases.stream()
                .filter(c -> c.state() != State.CLOSED)
                .filter(c -> c.state() != State.BLOCKED)
                .filter(c -> !c.hasExternalDependency())
                .toList();

        List<CaseItem> sorted = new ArrayList<>(active);
        sorted.sort(Comparator
                .comparingInt((CaseItem c) -> priorityScore(c, now)).reversed()
                .thenComparing(CaseItem::dueAt)
                .thenComparingInt(CaseItem::estimatedEffortMinutes)
                .thenComparing(CaseItem::caseId));

        return List.copyOf(sorted);
    }

    private static int priorityScore(CaseItem c, Instant now) {
        int severityScore = switch (c.severity()) {
            case LOW -> 10;
            case MEDIUM -> 30;
            case HIGH -> 60;
            case CRITICAL -> 100;
        };

        long hoursWaiting = Math.max(0, Duration.between(c.lastActionAt(), now).toHours());
        int agingBoost = (int) Math.min(30, hoursWaiting / 24);

        long hoursToDue = Duration.between(now, c.dueAt()).toHours();
        int urgencyBoost = hoursToDue <= 0 ? 50 : (int) Math.max(0, 48 - Math.min(48, hoursToDue));

        return severityScore + agingBoost + urgencyBoost;
    }
}
```

Important:

This is a policy. It should be validated against historical data.

---

## 27. Case Study: Retry Scheduling

Retry scheduling often uses greedy priority by next eligible time.

Data structure:

```text
PriorityQueue<RetryTask> ordered by nextAttemptAt
```

Algorithm:

```text
peek earliest retry
if nextAttemptAt <= now:
    poll and execute
else:
    sleep/wait until eligible
```

### Java sketch

```java
import java.time.*;
import java.util.*;

public final class RetryScheduler {
    public record RetryTask(
            String id,
            Instant nextAttemptAt,
            int attempt,
            int maxAttempts
    ) {}

    private final PriorityQueue<RetryTask> queue = new PriorityQueue<>(Comparator
            .comparing(RetryTask::nextAttemptAt)
            .thenComparing(RetryTask::id));

    public void schedule(RetryTask task) {
        if (task.attempt() >= task.maxAttempts()) {
            return;
        }
        queue.offer(task);
    }

    public List<RetryTask> drainEligible(Instant now, int maxItems) {
        List<RetryTask> result = new ArrayList<>();
        while (result.size() < maxItems && !queue.isEmpty()) {
            RetryTask next = queue.peek();
            if (next.nextAttemptAt().isAfter(now)) {
                break;
            }
            result.add(queue.remove());
        }
        return result;
    }
}
```

Production caveats:

1. Single JVM queue is not durable.
2. Multi-node scheduling needs DB/queue coordination.
3. Clock skew matters.
4. Retry storm must be rate-limited.
5. Jitter avoids thundering herd.
6. Poison tasks need dead-letter handling.

---

## 28. What Top-Tier Engineers Notice

A weaker engineer says:

> “Sort it and take the best.”

A stronger engineer asks:

1. Best according to what objective?
2. Is the local choice safe?
3. Can we prove it with exchange argument?
4. What are the counterexamples?
5. What happens on ties?
6. Is output deterministic?
7. Does this mutate caller-owned input?
8. Does priority change after insertion?
9. Is this offline or online scheduling?
10. Do we need optimality or explainable policy?
11. How will this be audited?
12. How will this fail under adversarial data?

That is the engineering difference.

---

## 29. Summary

Greedy algorithms are powerful because they often reduce complex problems to sorting, scanning, or heap operations. But greedy is only safe when the local decision can be justified.

Key takeaways:

1. Greedy commits local choices without backtracking.
2. A plausible greedy rule is not enough.
3. Correct greedy algorithms usually need greedy-choice property and optimal substructure.
4. Exchange argument is the main proof tool.
5. Sorting key is part of the algorithm’s correctness claim.
6. `PriorityQueue` is central for heap-based greedy, but its iteration is not sorted and mutable priority is dangerous.
7. Ratio-based greedy works for fractional knapsack, not 0/1 knapsack.
8. Production greedy often becomes policy, not proof-backed algorithm.
9. Deterministic tie-breakers matter for auditability and debugging.
10. Always search for counterexamples before trusting greedy.

---

## 30. Practice Problems

### Problem 1 — Maximum non-overlapping intervals

Given intervals, select maximum number of non-overlapping intervals.

Required:

1. Sort by end time.
2. Return selected intervals.
3. Explain exchange argument.
4. Test against brute force for small `n`.

### Problem 2 — Minimum meeting rooms

Given intervals, compute minimum number of rooms.

Required:

1. Sort by start.
2. Use `PriorityQueue<Integer>` of end times.
3. Define adjacent interval semantics.

### Problem 3 — Merge intervals

Given intervals, merge overlap.

Required:

1. Define `[start, end]` or `[start, end)`.
2. Sort by start.
3. Return immutable result.

### Problem 4 — Retry scheduler

Design a retry scheduler using priority queue.

Required:

1. Order by `nextAttemptAt`.
2. Add deterministic tie-breaker.
3. Support `drainEligible(now, maxItems)`.
4. Explain durability limitations.

### Problem 5 — SLA triage policy

Design greedy ordering for case escalation.

Required:

1. Define objective.
2. Define comparator.
3. Include aging boost.
4. Explain whether algorithm is optimal or heuristic.
5. Define audit fields.

---

## 31. Checklist untuk Review Code Greedy

Gunakan checklist ini saat code review:

```text
[ ] Objective jelas.
[ ] Greedy choice eksplisit.
[ ] Sorting/comparator sesuai objective.
[ ] Tie-breaker deterministic.
[ ] Tidak ada comparator overflow.
[ ] Input tidak dimutasi tanpa kontrak eksplisit.
[ ] Edge cases diuji.
[ ] Counterexample untuk strategi salah dipahami.
[ ] Correctness proof atau heuristic rationale tertulis.
[ ] PriorityQueue tidak diiterasi seolah sorted.
[ ] Priority object tidak dimutasi setelah masuk heap.
[ ] Complexity jelas.
[ ] Production limitations jelas.
[ ] Auditability dipertimbangkan jika keputusan berdampak bisnis.
```

---

## 32. Referensi

- Java SE 25 `PriorityQueue` API: unbounded priority queue berbasis priority heap, ordered by natural ordering atau comparator.
- Java SE 25 `Arrays` API: utility untuk sorting/searching arrays.
- Java SE 25 Collections Framework documentation.
- OpenJDK JMH: harness untuk benchmark JVM.

---

## 33. Penutup

Greedy adalah salah satu teknik yang paling sering terlihat sederhana tetapi paling mudah disalahgunakan. Di Java, correctness greedy tidak hanya ditentukan oleh formula algoritma, tetapi juga oleh detail implementasi: comparator, sorting stability, heap semantics, mutability, object allocation, dan determinism.

Bagian berikutnya akan membahas:

```text
learn-java-dsa-part-021 — Sliding Window, Two Pointers, Prefix Sum, Difference Array
```

Di sana kita akan masuk ke pola linear-time yang sangat penting untuk data stream, rate limiting, rolling metrics, time window, dan range query sederhana.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java DSA — Part 019: Dynamic Programming II — Classic Patterns and Engineering Use](./learn-java-dsa-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 021 — Sliding Window, Two Pointers, Prefix Sum, Difference Array](./learn-java-dsa-part-021.md)
