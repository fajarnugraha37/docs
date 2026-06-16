# learn-java-dsa-part-008 — Ordering, Sorting, Comparator, Comparable

> Seri: Java Data Structure and Algorithm Advanced  
> Part: 008 dari 030  
> Status seri: belum selesai  
> Fokus: ordering sebagai correctness contract, bukan sekadar kosmetik pengurutan

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya bisa menulis:

```java
list.sort(Comparator.comparing(User::createdAt));
```

Tetapi juga memahami:

1. Apa arti **ordering** sebagai kontrak logis.
2. Perbedaan antara **natural ordering** dan **custom ordering**.
3. Kenapa comparator yang “kelihatan jalan” bisa merusak `TreeSet`, `TreeMap`, `PriorityQueue`, binary search, dan sorting.
4. Kenapa `compare(a, b) == 0` bukan sekadar “hasil sama”, tetapi sering berarti “dua object berada pada equivalence class yang sama menurut ordering itu”.
5. Bagaimana sorting bekerja secara cost model di Java.
6. Kapan sorting stabil penting.
7. Kapan harus memakai `Comparable`, kapan harus memakai `Comparator`, dan kapan tidak boleh memaksa domain object punya natural order.
8. Bagaimana membangun ordering yang deterministic untuk sistem produksi: report, audit trail, workflow priority, escalation ordering, dan pagination.
9. Bagaimana menguji comparator supaya tidak melanggar transitivity, antisymmetry, consistency, dan null policy.

Part ini sengaja dibuat detail karena ordering adalah fondasi untuk beberapa struktur berikutnya:

- binary search,
- sorted array,
- `TreeMap`,
- `TreeSet`,
- heap / `PriorityQueue`,
- range query,
- top-K,
- scheduler,
- deadline queue,
- deterministic workflow processing.

---

## 1. Inti Mental Model: Ordering adalah Relasi, Bukan Tampilan UI

Banyak engineer melihat sorting sebagai hal UI:

> “Urutkan by date descending.”

Itu benar, tapi terlalu dangkal.

Dalam DSA, ordering adalah **relasi matematis** yang memberi jawaban terhadap pertanyaan:

> Untuk dua elemen `a` dan `b`, apakah `a` harus datang sebelum, sama level, atau sesudah `b`?

Di Java, pertanyaan itu direpresentasikan oleh angka integer:

```java
int r = comparator.compare(a, b);
```

Dengan convention:

```text
r < 0  => a sebelum b
r == 0 => a setara dengan b menurut ordering ini
r > 0  => a sesudah b
```

Yang sering dilupakan: `r == 0` bukan berarti object-nya sama secara identity, dan belum tentu `a.equals(b)` bernilai `true`. Tetapi bagi struktur data berbasis ordering seperti `TreeSet`, `TreeMap`, dan binary search, `compare(a, b) == 0` sering diperlakukan sebagai “key-equivalent”.

Contoh:

```java
record Person(long id, String name) {}

Comparator<Person> byNameOnly = Comparator.comparing(Person::name);

Person a = new Person(1, "Rina");
Person b = new Person(2, "Rina");

System.out.println(a.equals(b));          // false
System.out.println(byNameOnly.compare(a, b)); // 0
```

Menurut `equals`, mereka berbeda. Menurut comparator `byNameOnly`, mereka setara.

Ini tidak salah jika memang kamu ingin mengurutkan tampilan berdasarkan nama. Tetapi ini bisa menjadi bug besar jika comparator tersebut dipakai di `TreeSet<Person>` untuk menyimpan semua person unik.

```java
Set<Person> set = new TreeSet<>(byNameOnly);
set.add(a);
set.add(b);

System.out.println(set.size()); // 1, bukan 2
```

Kenapa? Karena bagi `TreeSet`, dua elemen dengan `compare(a, b) == 0` dianggap menempati posisi yang sama dalam pohon.

**Mental model utama:**

> Comparator bukan hanya fungsi sorting. Comparator mendefinisikan equivalence class, navigasi, dan uniqueness bagi struktur sorted.

---

## 2. Vocabulary: Order, Sort, Rank, Priority, Equality

Sebelum masuk Java API, bedakan istilah berikut.

### 2.1 Order

Order adalah relasi antara elemen.

Contoh:

```text
case A lebih urgent daripada case B
invoice X lebih lama daripada invoice Y
user U lebih dahulu dibuat daripada user V
module M harus diproses sebelum module N
```

Order menjawab hubungan pairwise.

### 2.2 Sort

Sort adalah proses menyusun koleksi berdasarkan order tertentu.

Order adalah contract. Sort adalah algoritma yang menggunakan contract itu.

### 2.3 Rank

Rank adalah posisi relatif setelah ordering diterapkan.

Contoh:

```text
Case A rank 1 dalam escalation queue.
Case B rank 2.
```

Rank biasanya berubah ketika data berubah.

### 2.4 Priority

Priority adalah bentuk ordering yang sering hanya peduli elemen “terbaik” atau “terkecil” berikutnya.

`PriorityQueue` tidak perlu menjaga seluruh elemen fully sorted. Ia hanya menjaga invariant heap agar elemen dengan priority tertinggi/terendah bisa diambil cepat.

### 2.5 Equality

Equality menjawab apakah dua object dianggap sama secara logical.

Di Java:

```java
boolean same = a.equals(b);
```

Ordering menjawab apakah dua object setara menurut kriteria urutan.

```java
boolean equivalentByOrder = comparator.compare(a, b) == 0;
```

Ini bisa sama, bisa berbeda.

---

## 3. Natural Ordering vs Custom Ordering

Java menyediakan dua konsep besar:

1. `Comparable<T>` untuk natural ordering.
2. `Comparator<T>` untuk external/custom ordering.

### 3.1 `Comparable<T>`

`Comparable` dipakai saat class memiliki natural ordering yang sangat jelas dan stabil.

Contoh core Java:

```java
String implements Comparable<String>
Integer implements Comparable<Integer>
LocalDate implements Comparable<LocalDate>
BigDecimal implements Comparable<BigDecimal>
```

Contoh domain yang mungkin masuk akal:

```java
record Priority(int level) implements Comparable<Priority> {
    @Override
    public int compareTo(Priority other) {
        return Integer.compare(this.level, other.level);
    }
}
```

Natural ordering cocok jika:

1. Ada satu urutan dominan yang hampir selalu benar.
2. Urutan tersebut tidak tergantung context.
3. Urutan tersebut stabil sepanjang umur class.
4. Urutan tersebut tidak berubah karena kebutuhan UI/report tertentu.

### 3.2 `Comparator<T>`

`Comparator` dipakai untuk ordering yang context-specific.

Contoh:

```java
Comparator<Case> byCreatedAt = Comparator.comparing(Case::createdAt);
Comparator<Case> byDeadline = Comparator.comparing(Case::deadline);
Comparator<Case> bySeverityThenDeadline = Comparator
        .comparing(Case::severity)
        .thenComparing(Case::deadline);
```

Custom comparator cocok jika:

1. Ada lebih dari satu cara valid untuk mengurutkan object.
2. Ordering tergantung use case.
3. Ordering adalah concern application layer, bukan intrinsic property domain object.
4. Sorting dipakai untuk report, screen, queue, assignment, export, escalation, atau query result.

### 3.3 Rule praktis

Gunakan `Comparable` hanya jika kamu berani mengatakan:

> “Inilah urutan alami object ini di hampir semua konteks.”

Jika tidak, gunakan `Comparator`.

Jangan membuat entity domain seperti `Case`, `Application`, `User`, atau `Order` implements `Comparable` hanya karena satu layar butuh sorting tertentu.

Buruk:

```java
class Case implements Comparable<Case> {
    @Override
    public int compareTo(Case other) {
        return this.createdAt.compareTo(other.createdAt);
    }
}
```

Kenapa buruk?

Karena `Case` bisa diurutkan berdasarkan:

- created date,
- updated date,
- deadline,
- severity,
- assignee,
- state,
- queue priority,
- SLA breach risk,
- case number,
- domain-specific escalation score.

Tidak ada satu natural order yang jelas.

Lebih baik:

```java
final class CaseOrderings {
    static final Comparator<Case> BY_CREATED_AT =
            Comparator.comparing(Case::createdAt);

    static final Comparator<Case> BY_DEADLINE_THEN_SEVERITY =
            Comparator.comparing(Case::deadline)
                    .thenComparing(Case::severity);

    private CaseOrderings() {}
}
```

---

## 4. General Contract Comparator

Comparator yang benar harus memenuhi beberapa sifat penting.

### 4.1 Sign symmetry

Untuk dua object `a` dan `b`:

```text
sign(compare(a, b)) == -sign(compare(b, a))
```

Jika `a < b`, maka `b > a`.

Contoh pelanggaran:

```java
Comparator<Integer> broken = (a, b) -> a > b ? 1 : 0;
```

Untuk `a = 2`, `b = 1`:

```text
compare(2, 1) = 1
compare(1, 2) = 0
```

Ini tidak valid.

### 4.2 Transitivity

Jika:

```text
a > b
b > c
```

Maka harus:

```text
a > c
```

Contoh domain failure:

```text
A lebih urgent dari B karena severity
B lebih urgent dari C karena deadline
C lebih urgent dari A karena special flag
```

Jika logic comparator seperti itu dibuat tanpa hierarchy rule yang jelas, sorting bisa gagal atau hasilnya tidak deterministik.

### 4.3 Consistency of equality class

Jika:

```text
compare(a, b) == 0
```

Maka untuk setiap `z`, sign dari:

```text
compare(a, z)
compare(b, z)
```

harus sama.

Artinya, kalau `a` dan `b` dianggap setara oleh comparator, mereka harus berperilaku sama terhadap elemen lain.

### 4.4 Consistency with equals

Comparator dikatakan consistent with equals jika:

```java
compare(a, b) == 0
```

punya boolean value yang sama dengan:

```java
a.equals(b)
```

untuk semua pasangan `a`, `b`.

Ini tidak selalu wajib untuk semua comparator, tetapi sangat penting untuk struktur sorted set/map.

Contoh comparator yang tidak consistent with equals:

```java
Comparator<Person> byNameOnly = Comparator.comparing(Person::name);
```

Dua person berbeda dengan nama sama akan `compare == 0`, walau `equals == false`.

Untuk sorting list biasa, ini sering aman. Untuk `TreeSet`, bisa menyebabkan data “hilang”.

---

## 5. Kesalahan Comparator Paling Berbahaya: Subtraction Comparator

Banyak orang menulis:

```java
Comparator<Integer> bad = (a, b) -> a - b;
```

Ini terlihat benar, tapi bisa overflow.

Contoh:

```java
int a = Integer.MAX_VALUE;
int b = -1;

System.out.println(a - b); // overflow menjadi negatif
```

Secara matematis:

```text
2147483647 - (-1) = 2147483648
```

Tetapi `int` maksimum hanya `2147483647`, sehingga overflow.

Comparator akan salah menyimpulkan bahwa `MAX_VALUE < -1`.

Gunakan:

```java
Comparator<Integer> good = Integer::compare;
```

Atau:

```java
Comparator<User> byAge = Comparator.comparingInt(User::age);
```

Untuk `long`:

```java
Comparator<Event> byTimestamp = Comparator.comparingLong(Event::epochMillis);
```

Untuk `double`:

```java
Comparator<Measurement> byValue = Comparator.comparingDouble(Measurement::value);
```

Catatan: `double` memiliki isu sendiri seperti `NaN`, `-0.0`, dan `0.0`. Gunakan `Double.compare`, bukan subtraction.

Buruk:

```java
Comparator<Measurement> bad = (a, b) -> (int) (a.value() - b.value());
```

Kenapa buruk?

1. Precision hilang.
2. Nilai kecil bisa menjadi 0.
3. Overflow mungkin terjadi saat cast.
4. `NaN` tidak tertangani jelas.

Benar:

```java
Comparator<Measurement> good = Comparator.comparingDouble(Measurement::value);
```

---

## 6. Stable vs Unstable Sort

### 6.1 Apa itu stable sort?

Sorting stabil berarti jika dua elemen dianggap equal oleh comparator, urutan relatifnya tetap sama seperti input.

Contoh data awal:

```text
[ A(priority=1, created=09:00),
  B(priority=2, created=09:01),
  C(priority=1, created=09:02) ]
```

Sort by `priority` ascending.

Jika stable:

```text
A(priority=1)
C(priority=1)
B(priority=2)
```

A tetap sebelum C karena di input A memang sebelum C.

Jika unstable, hasil bisa:

```text
C(priority=1)
A(priority=1)
B(priority=2)
```

Keduanya benar menurut comparator, tetapi hanya yang pertama mempertahankan urutan relatif.

### 6.2 Kenapa stability penting?

Stability penting untuk multi-pass sorting.

Contoh: ingin sort by `department`, lalu within department by `createdAt`.

Dengan stable sort, bisa:

```java
list.sort(Comparator.comparing(Employee::createdAt));
list.sort(Comparator.comparing(Employee::department));
```

Sort kedua tidak merusak order `createdAt` di dalam department yang sama.

Tetapi di Java modern, lebih jelas pakai chained comparator:

```java
list.sort(
        Comparator.comparing(Employee::department)
                .thenComparing(Employee::createdAt)
);
```

### 6.3 Java List sort

`List.sort` / `Collections.sort` untuk object list bersifat stable. Implementasinya adaptive iterative mergesort yang bekerja sangat baik pada data partially sorted.

Implikasi engineering:

1. Sorting list object aman untuk multi-key ordering.
2. Data yang hampir sorted bisa jauh lebih murah daripada random data.
3. Ada temporary storage untuk reference array.
4. Comparator cost bisa dominan.

### 6.4 Primitive array sort

Untuk primitive arrays seperti `int[]`, `long[]`, `double[]`, Java menggunakan Dual-Pivot Quicksort. Ini cepat dan hemat memory, tetapi primitive sort tidak membutuhkan stability karena primitive value tidak punya identity tambahan selain nilainya.

```java
int[] values = {3, 1, 2};
Arrays.sort(values);
```

Untuk object array:

```java
User[] users = ...;
Arrays.sort(users, Comparator.comparing(User::createdAt));
```

Object sorting memiliki pertimbangan berbeda karena object bisa punya fields lain dan equality class berdasarkan comparator bisa mengandung banyak object berbeda.

---

## 7. Sorting Cost Model di Java

Secara teori, comparison sorting umumnya `O(n log n)`.

Tetapi di Java, cost nyata sorting adalah:

```text
sorting cost = comparison count × comparator cost
             + data movement cost
             + temporary allocation
             + cache behavior
             + branch behavior
             + null handling
             + boxing/unboxing cost
             + method dispatch / lambda overhead after JIT
```

### 7.1 Comparator cost bisa dominan

Murah:

```java
Comparator<User> byId = Comparator.comparingLong(User::id);
```

Lebih mahal:

```java
Comparator<User> byNormalizedName = Comparator.comparing(
        u -> normalize(u.name())
);
```

Sangat mahal jika `normalize` melakukan allocation, regex, DB lookup, parsing, atau locale operation.

Buruk:

```java
users.sort(Comparator.comparing(u -> expensiveNormalize(u.name())));
```

Jika sorting melakukan `n log n` comparison, expensive function bisa dipanggil berkali-kali untuk object yang sama.

Solusi: decorate-sort-undecorate.

```java
record UserKeyed(User user, String normalizedName) {}

List<User> sorted = users.stream()
        .map(u -> new UserKeyed(u, expensiveNormalize(u.name())))
        .sorted(Comparator.comparing(UserKeyed::normalizedName))
        .map(UserKeyed::user)
        .toList();
```

Trade-off:

- Lebih banyak allocation untuk wrapper.
- Tetapi expensive key dihitung sekali per item.
- Cocok untuk key extraction mahal.

Versi mutable list tanpa stream:

```java
List<UserKeyed> keyed = new ArrayList<>(users.size());
for (User u : users) {
    keyed.add(new UserKeyed(u, expensiveNormalize(u.name())));
}

keyed.sort(Comparator.comparing(UserKeyed::normalizedName));

List<User> result = new ArrayList<>(keyed.size());
for (UserKeyed k : keyed) {
    result.add(k.user());
}
```

### 7.2 Data movement cost

Sorting object list biasanya memindahkan references, bukan object payload penuh.

```text
ArrayList<User> backing array berisi reference ke User.
Sorting menukar posisi reference.
User object tidak dipindahkan secara fisik.
```

Ini lebih murah daripada memindahkan struct besar di bahasa yang memiliki value object besar secara langsung.

Tetapi pointer chasing tetap ada saat comparator membaca field object.

### 7.3 Boxing cost

Buruk:

```java
List<Integer> values = ...;
values.sort(Comparator.naturalOrder());
```

Untuk koleksi object, `Integer` sudah boxed. Sorting membaca object `Integer`, bukan primitive `int`.

Jika workload sangat besar dan hanya butuh primitive sort:

```java
int[] values = ...;
Arrays.sort(values);
```

Ini biasanya jauh lebih memory-efficient dan cache-friendly.

### 7.4 Allocation cost

`list.sort(...)` bisa membuat temporary array tergantung implementasi dan list type.

Selain itu, comparator chain bisa menciptakan object comparator kecil, biasanya negligible jika dibuat sekali.

Buruk jika comparator dibuat berulang dalam hot path tanpa perlu:

```java
for (...) {
    list.sort(Comparator.comparing(User::createdAt)
            .thenComparing(User::id));
}
```

Lebih baik:

```java
private static final Comparator<User> USER_ORDER =
        Comparator.comparing(User::createdAt)
                .thenComparingLong(User::id);
```

### 7.5 Sorting sering bukan bottleneck tunggal

Dalam sistem nyata, bottleneck sorting bisa datang dari:

1. Query mengambil terlalu banyak data.
2. Sorting dilakukan di application layer padahal DB index bisa membantu.
3. Comparator melakukan parsing string tanggal setiap compare.
4. Sorting dilakukan berulang untuk data yang sama.
5. Data structure salah: tiap insert sort ulang list, padahal butuh heap atau tree.

---

## 8. Multi-Key Ordering

Multi-key ordering adalah skill penting.

Contoh domain case management:

```text
1. overdue case dulu
2. severity lebih tinggi dulu
3. deadline lebih awal dulu
4. createdAt lebih awal dulu
5. id sebagai deterministic tiebreaker
```

Java comparator:

```java
Comparator<Case> CASE_ESCALATION_ORDER = Comparator
        .comparing(Case::isOverdue).reversed()
        .thenComparing(Case::severity, Comparator.reverseOrder())
        .thenComparing(Case::deadline)
        .thenComparing(Case::createdAt)
        .thenComparingLong(Case::id);
```

Tapi hati-hati: `Comparator.comparing(Case::isOverdue).reversed()` membalik seluruh comparator sampai titik itu jika tidak dipahami dengan baik.

Lebih eksplisit:

```java
Comparator<Case> CASE_ESCALATION_ORDER = Comparator
        .comparing(Case::isOverdue, Comparator.reverseOrder())
        .thenComparing(Case::severity, Comparator.reverseOrder())
        .thenComparing(Case::deadline)
        .thenComparing(Case::createdAt)
        .thenComparingLong(Case::id);
```

Jika `severity` adalah enum, pastikan enum order memang sesuai priority.

```java
enum Severity {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

Natural enum order memakai ordinal declaration. Kalau ingin critical dulu:

```java
Comparator<Case> bySeverityDesc = Comparator.comparing(
        Case::severity,
        Comparator.comparingInt(Severity::rank).reversed()
);
```

Lebih baik enum menyimpan rank explicit:

```java
enum Severity {
    LOW(10),
    MEDIUM(20),
    HIGH(30),
    CRITICAL(40);

    private final int rank;

    Severity(int rank) {
        this.rank = rank;
    }

    int rank() {
        return rank;
    }
}
```

Lalu:

```java
Comparator<Case> bySeverityDesc =
        Comparator.comparingInt((Case c) -> c.severity().rank()).reversed();
```

### 8.1 Selalu tambahkan deterministic tiebreaker untuk output produksi

Jika comparator dipakai untuk report, export, API response, batch processing, atau audit-related output, jangan biarkan banyak elemen `compare == 0` tanpa tiebreaker.

Buruk:

```java
Comparator<Case> byDeadline = Comparator.comparing(Case::deadline);
```

Jika banyak case punya deadline sama, order antar case bisa bergantung pada input order. Jika input dari DB tanpa `ORDER BY` deterministic, hasil bisa berubah-ubah.

Lebih baik:

```java
Comparator<Case> byDeadlineStable = Comparator
        .comparing(Case::deadline)
        .thenComparingLong(Case::id);
```

Untuk sistem production, deterministic order membantu:

1. Debugging.
2. Snapshot testing.
3. Idempotent batch processing.
4. Pagination correctness.
5. Audit defensibility.
6. Reproducibility.

---

## 9. Null Policy: Jangan Biarkan Ambigu

Sorting data production sering bertemu null.

Contoh:

```java
record Case(long id, LocalDate deadline) {}
```

Jika `deadline` bisa null, ini bisa throw `NullPointerException`:

```java
cases.sort(Comparator.comparing(Case::deadline));
```

Tentukan policy.

Null last:

```java
cases.sort(Comparator.comparing(
        Case::deadline,
        Comparator.nullsLast(Comparator.naturalOrder())
));
```

Null first:

```java
cases.sort(Comparator.comparing(
        Case::deadline,
        Comparator.nullsFirst(Comparator.naturalOrder())
));
```

Business meaning harus jelas.

Contoh:

```text
Jika deadline null berarti belum dijadwalkan, apakah harus paling belakang?
Jika deadline null berarti data invalid, apakah sorting harus gagal cepat?
Jika deadline null berarti no deadline, apakah prioritasnya paling rendah?
```

Kadang null handling di comparator justru menyembunyikan data quality issue.

Untuk workflow kritikal, mungkin lebih baik fail fast:

```java
Comparator<Case> byDeadline = Comparator.comparing(c -> {
    if (c.deadline() == null) {
        throw new IllegalStateException("Case " + c.id() + " has no deadline");
    }
    return c.deadline();
});
```

Rule:

> Null handling dalam comparator adalah business decision, bukan sekadar technical patch.

---

## 10. Locale-Sensitive Ordering untuk String

`String.compareTo` melakukan lexicographic ordering berdasarkan Unicode value, bukan natural human-language sorting.

Contoh sederhana:

```java
List<String> names = new ArrayList<>(List.of("éclair", "apple", "Zebra"));
names.sort(String::compareTo);
```

Hasilnya mungkin tidak sesuai ekspektasi manusia dalam locale tertentu.

Untuk natural language, Java menyediakan `Collator`.

```java
Collator collator = Collator.getInstance(Locale.forLanguageTag("id-ID"));
names.sort(collator);
```

Trade-off:

1. Lebih benar untuk bahasa manusia.
2. Lebih mahal daripada `String.compareTo`.
3. Harus specify locale agar deterministic.
4. Strength/case/accent sensitivity perlu diset sesuai requirement.

Contoh:

```java
Collator collator = Collator.getInstance(Locale.forLanguageTag("id-ID"));
collator.setStrength(Collator.PRIMARY); // often ignores case/accent differences depending on locale rules
names.sort(collator);
```

Untuk system identifier, code, enum name, UUID string, atau technical key, biasanya jangan pakai `Collator`. Pakai byte/Unicode/code-point/lexicographic order yang deterministic.

---

## 11. `BigDecimal`: Natural Ordering yang Tidak Consistent with Equals

Ini contoh klasik Java yang penting.

```java
BigDecimal a = new BigDecimal("4.0");
BigDecimal b = new BigDecimal("4.00");

System.out.println(a.equals(b));     // false
System.out.println(a.compareTo(b));  // 0
```

Kenapa `equals` false?

Karena `BigDecimal.equals` mempertimbangkan value dan scale.

```text
4.0  scale 1
4.00 scale 2
```

Kenapa `compareTo` 0?

Karena numeric value sama.

Implikasi:

```java
Set<BigDecimal> hashSet = new HashSet<>();
hashSet.add(new BigDecimal("4.0"));
hashSet.add(new BigDecimal("4.00"));
System.out.println(hashSet.size()); // 2

Set<BigDecimal> treeSet = new TreeSet<>();
treeSet.add(new BigDecimal("4.0"));
treeSet.add(new BigDecimal("4.00"));
System.out.println(treeSet.size()); // 1
```

Keduanya “benar” sesuai contract masing-masing, tetapi hasil berbeda.

Lesson:

> Jangan asumsikan `TreeSet` dan `HashSet` selalu memiliki uniqueness semantics yang sama.

Untuk money/domain amount, tentukan canonicalization:

```java
BigDecimal normalized = amount.stripTrailingZeros();
```

Atau tentukan scale policy:

```java
BigDecimal normalized = amount.setScale(2, RoundingMode.UNNECESSARY);
```

Pilih berdasarkan domain, bukan convenience.

---

## 12. Sorting API di Java: Mana yang Dipakai?

### 12.1 `List.sort`

Modern dan direct:

```java
list.sort(comparator);
```

Gunakan ini untuk mutable list.

### 12.2 `Collections.sort`

Legacy-style utility, masih valid:

```java
Collections.sort(list, comparator);
```

Di Java modern, biasanya `list.sort(comparator)` lebih jelas.

### 12.3 `Arrays.sort`

Untuk array:

```java
Arrays.sort(values);
Arrays.sort(users, comparator);
```

### 12.4 `Arrays.parallelSort`

Untuk array besar, bisa mencoba parallel sort:

```java
Arrays.parallelSort(values);
```

Tapi jangan otomatis memakai parallel sort.

Pertimbangkan:

1. Ukuran data.
2. Core available.
3. Common ForkJoinPool contention.
4. Comparator cost.
5. Memory bandwidth.
6. Apakah sorting berada dalam request path latency-sensitive.

Parallel bukan gratis. Untuk ukuran kecil/menengah, overhead bisa lebih besar daripada manfaat.

### 12.5 Stream sorted

```java
List<User> sorted = users.stream()
        .sorted(Comparator.comparing(User::createdAt))
        .toList();
```

Ini menghasilkan list baru, bukan mutate list asli.

Gunakan jika pipeline memang functional/readable.

Hati-hati untuk large dataset:

1. `sorted()` adalah stateful intermediate operation.
2. Ia harus melihat semua elemen sebelum menghasilkan output final.
3. Untuk stream tak terbatas, sorting tidak selesai.
4. Untuk memory besar, bisa mahal.

---

## 13. Sorting vs Maintaining Sorted Structure

Pertanyaan penting:

> Apakah data disort sekali setelah terkumpul, atau harus tetap sorted selama insert/delete?

### 13.1 Sort once

Jika pola operasi:

```text
build list -> sort -> consume
```

Gunakan `ArrayList` + `sort`.

Contoh:

```java
List<Case> cases = loadCases();
cases.sort(CASE_ESCALATION_ORDER);
return cases;
```

Cocok untuk:

- report,
- export,
- response API,
- batch snapshot,
- one-time ranking.

### 13.2 Maintain sorted

Jika pola operasi:

```text
insert/delete/search range berulang-ulang
```

Pertimbangkan:

- `TreeMap`,
- `TreeSet`,
- heap / `PriorityQueue`,
- sorted array + binary search,
- custom index.

Contoh:

```java
NavigableMap<LocalDate, List<Case>> byDeadline = new TreeMap<>();
```

Cocok untuk:

- range query deadline,
- next due item,
- time-window lookup,
- live scheduling queue,
- effective-date configuration.

### 13.3 Jangan sort ulang setiap insert

Buruk:

```java
void add(Case c) {
    cases.add(c);
    cases.sort(CASE_ESCALATION_ORDER);
}
```

Jika `add` sering, ini mahal.

Alternatif:

1. Insert unsorted, sort saat read snapshot.
2. Gunakan `PriorityQueue` jika hanya butuh next item.
3. Gunakan `TreeSet` jika butuh always sorted dan uniqueness by comparator.
4. Gunakan `TreeMap<Key, List<Value>>` jika banyak duplicate key.

---

## 14. Comparator dan Sorted Set/Map

`TreeSet` dan `TreeMap` menggunakan ordering untuk navigasi dan uniqueness.

### 14.1 Bug umum: comparator tidak cukup unik

```java
record Case(long id, LocalDate deadline) {}

Set<Case> set = new TreeSet<>(Comparator.comparing(Case::deadline));
set.add(new Case(1, LocalDate.parse("2026-01-01")));
set.add(new Case(2, LocalDate.parse("2026-01-01")));

System.out.println(set.size()); // 1
```

Jika maksudnya menyimpan semua case, tambahkan tiebreaker:

```java
Set<Case> set = new TreeSet<>(
        Comparator.comparing(Case::deadline)
                .thenComparingLong(Case::id)
);
```

### 14.2 Jika key duplicate memang valid, gunakan `TreeMap<Key, List<Value>>`

```java
NavigableMap<LocalDate, List<Case>> casesByDeadline = new TreeMap<>();

void add(Case c) {
    casesByDeadline
            .computeIfAbsent(c.deadline(), ignored -> new ArrayList<>())
            .add(c);
}
```

Ini lebih eksplisit daripada memaksa `TreeSet<Case>` dengan comparator kompleks.

### 14.3 Comparator harus stabil terhadap mutation

Jika object sudah masuk `TreeSet`, jangan ubah field yang dipakai comparator.

Buruk:

```java
Case c = new Case(1, LocalDate.parse("2026-01-01"));
set.add(c);
c.setDeadline(LocalDate.parse("2026-02-01"));
```

Tree internal tidak otomatis re-balance/re-position object karena field berubah. Struktur menjadi inconsistent.

Solusi:

```java
set.remove(c);
c.setDeadline(newDeadline);
set.add(c);
```

Lebih baik: key immutable.

---

## 15. Deterministic Pagination dan Ordering

Pagination tanpa deterministic ordering adalah sumber bug production.

Contoh query app-layer:

```java
cases.sort(Comparator.comparing(Case::createdAt));
return cases.subList(offset, offset + limit);
```

Jika banyak `createdAt` sama dan tidak ada tiebreaker, item bisa pindah halaman ketika input order berubah.

Comparator yang lebih aman:

```java
Comparator<Case> PAGE_ORDER = Comparator
        .comparing(Case::createdAt)
        .thenComparingLong(Case::id);
```

Dalam DB pun sama:

```sql
ORDER BY created_at ASC, id ASC
```

Untuk cursor pagination:

```text
(createdAt, id) > (:lastCreatedAt, :lastId)
```

Mental model:

> Pagination memerlukan total deterministic order, bukan partial order.

Jika tidak, user bisa melihat duplicate item, missing item, atau item berpindah antar halaman.

---

## 16. Ordering untuk Workflow dan Escalation

Dalam sistem workflow/case management, ordering sering bukan sekadar date ascending.

Contoh escalation queue:

```text
1. blocked case lebih dulu
2. breached SLA lebih dulu
3. severity rank desc
4. deadline asc
5. number of previous escalations desc
6. createdAt asc
7. id asc
```

Representasi:

```java
Comparator<Case> ESCALATION_ORDER = Comparator
        .comparing(Case::blocked, Comparator.reverseOrder())
        .thenComparing(Case::slaBreached, Comparator.reverseOrder())
        .thenComparingInt((Case c) -> c.severity().rank()).reversed()
        .thenComparing(Case::deadline)
        .thenComparingInt(Case::previousEscalationCount).reversed()
        .thenComparing(Case::createdAt)
        .thenComparingLong(Case::id);
```

Namun ada subtle bug di atas: `.reversed()` membalik seluruh comparator chain sampai titik itu, bukan hanya key terakhir jika posisinya tidak hati-hati.

Lebih aman pisahkan comparator per key:

```java
static final Comparator<Case> BY_BLOCKED_DESC =
        Comparator.comparing(Case::blocked, Comparator.reverseOrder());

static final Comparator<Case> BY_SLA_BREACHED_DESC =
        Comparator.comparing(Case::slaBreached, Comparator.reverseOrder());

static final Comparator<Case> BY_SEVERITY_DESC =
        Comparator.comparingInt((Case c) -> c.severity().rank()).reversed();

static final Comparator<Case> BY_ESCALATION_COUNT_DESC =
        Comparator.comparingInt(Case::previousEscalationCount).reversed();

static final Comparator<Case> ESCALATION_ORDER = BY_BLOCKED_DESC
        .thenComparing(BY_SLA_BREACHED_DESC)
        .thenComparing(BY_SEVERITY_DESC)
        .thenComparing(Case::deadline)
        .thenComparing(BY_ESCALATION_COUNT_DESC)
        .thenComparing(Case::createdAt)
        .thenComparingLong(Case::id);
```

Atau gunakan explicit score key:

```java
record EscalationKey(
        boolean blocked,
        boolean slaBreached,
        int severityRank,
        LocalDate deadline,
        int previousEscalationCount,
        Instant createdAt,
        long id
) {}
```

Comparator:

```java
Comparator<EscalationKey> ESCALATION_KEY_ORDER = Comparator
        .comparing(EscalationKey::blocked, Comparator.reverseOrder())
        .thenComparing(EscalationKey::slaBreached, Comparator.reverseOrder())
        .thenComparing(EscalationKey::severityRank, Comparator.reverseOrder())
        .thenComparing(EscalationKey::deadline)
        .thenComparing(EscalationKey::previousEscalationCount, Comparator.reverseOrder())
        .thenComparing(EscalationKey::createdAt)
        .thenComparingLong(EscalationKey::id);
```

Manfaat key object:

1. Comparator lebih mudah diuji.
2. Expensive calculation bisa dilakukan sekali.
3. Bisa log key untuk audit.
4. Bisa menjelaskan kenapa case A lebih tinggi daripada case B.
5. Bisa dipakai untuk deterministic snapshot.

---

## 17. Comparator sebagai Explainable Policy

Untuk domain regulatory/workflow, sering tidak cukup menjawab:

> Case A muncul lebih dulu karena comparator.

Kamu perlu bisa menjelaskan:

> Case A muncul lebih dulu karena SLA breached, severity CRITICAL, deadline lebih awal, dan id lebih kecil sebagai tiebreaker.

Maka comparator sebaiknya selaras dengan policy yang bisa dibaca manusia.

Contoh explainable ranking:

```java
record CaseRank(
        long caseId,
        boolean slaBreached,
        int severityRank,
        LocalDate deadline,
        Instant createdAt
) {
    static CaseRank from(Case c) {
        return new CaseRank(
                c.id(),
                c.slaBreached(),
                c.severity().rank(),
                c.deadline(),
                c.createdAt()
        );
    }
}
```

Ordering:

```java
static final Comparator<CaseRank> CASE_RANK_ORDER = Comparator
        .comparing(CaseRank::slaBreached, Comparator.reverseOrder())
        .thenComparing(CaseRank::severityRank, Comparator.reverseOrder())
        .thenComparing(CaseRank::deadline)
        .thenComparing(CaseRank::createdAt)
        .thenComparingLong(CaseRank::caseId);
```

Usage:

```java
List<Case> sorted = cases.stream()
        .map(c -> Map.entry(CaseRank.from(c), c))
        .sorted(Map.Entry.comparingByKey(CASE_RANK_ORDER))
        .map(Map.Entry::getValue)
        .toList();
```

Untuk audit/debug:

```java
CaseRank rank = CaseRank.from(c);
log.info("case={} rank={}", c.id(), rank);
```

Mental model:

> Untuk domain penting, comparator bukan utility kecil. Comparator adalah encoded policy.

---

## 18. Testing Comparator

Comparator perlu diuji seperti business logic lain.

### 18.1 Test expected ordering

```java
@Test
void criticalComesBeforeHigh() {
    Case critical = caseWithSeverity(CRITICAL);
    Case high = caseWithSeverity(HIGH);

    assertThat(ESCALATION_ORDER.compare(critical, high)).isLessThan(0);
}
```

### 18.2 Test tiebreaker

```java
@Test
void idBreaksTieDeterministically() {
    Case a = sameRankCaseWithId(1);
    Case b = sameRankCaseWithId(2);

    assertThat(ESCALATION_ORDER.compare(a, b)).isLessThan(0);
    assertThat(ESCALATION_ORDER.compare(b, a)).isGreaterThan(0);
}
```

### 18.3 Test sign symmetry

```java
static <T> void assertSignSymmetry(Comparator<T> cmp, T a, T b) {
    int ab = Integer.signum(cmp.compare(a, b));
    int ba = Integer.signum(cmp.compare(b, a));
    assertEquals(ab, -ba);
}
```

### 18.4 Test transitivity

```java
static <T> void assertTransitive(Comparator<T> cmp, T a, T b, T c) {
    if (cmp.compare(a, b) > 0 && cmp.compare(b, c) > 0) {
        assertTrue(cmp.compare(a, c) > 0);
    }
    if (cmp.compare(a, b) < 0 && cmp.compare(b, c) < 0) {
        assertTrue(cmp.compare(a, c) < 0);
    }
}
```

### 18.5 Property-style comparator test

Tanpa library property testing pun bisa lakukan randomized test sederhana.

```java
@Test
void comparatorContractSmokeTest() {
    List<Case> samples = generateCases(1_000);

    for (Case a : samples) {
        for (Case b : samples) {
            int ab = Integer.signum(ESCALATION_ORDER.compare(a, b));
            int ba = Integer.signum(ESCALATION_ORDER.compare(b, a));
            assertEquals(ab, -ba);
        }
    }

    for (Case a : samples) {
        for (Case b : samples) {
            for (Case c : samples) {
                if (ESCALATION_ORDER.compare(a, b) <= 0
                        && ESCALATION_ORDER.compare(b, c) <= 0) {
                    assertTrue(ESCALATION_ORDER.compare(a, c) <= 0);
                }
            }
        }
    }
}
```

Triple nested test mahal. Untuk 1000 samples terlalu besar. Ambil random triples:

```java
@Test
void comparatorTransitivityRandomTriples() {
    List<Case> samples = generateCases(1_000);
    Random random = new Random(42);

    for (int i = 0; i < 100_000; i++) {
        Case a = samples.get(random.nextInt(samples.size()));
        Case b = samples.get(random.nextInt(samples.size()));
        Case c = samples.get(random.nextInt(samples.size()));

        if (ESCALATION_ORDER.compare(a, b) <= 0
                && ESCALATION_ORDER.compare(b, c) <= 0) {
            assertTrue(ESCALATION_ORDER.compare(a, c) <= 0,
                    () -> "Transitivity failed for " + a + ", " + b + ", " + c);
        }
    }
}
```

### 18.6 Test sorted result invariant

```java
static <T> void assertSorted(List<T> list, Comparator<T> cmp) {
    for (int i = 1; i < list.size(); i++) {
        T prev = list.get(i - 1);
        T curr = list.get(i);
        assertTrue(cmp.compare(prev, curr) <= 0,
                () -> "Not sorted at index " + i + ": " + prev + " > " + curr);
    }
}
```

---

## 19. Non-Transitive Comparator: Contoh Nyata

Misalkan ada comparator “toleransi” untuk koordinat:

```java
Comparator<Double> nearComparator = (a, b) -> {
    if (Math.abs(a - b) < 0.1) {
        return 0;
    }
    return Double.compare(a, b);
};
```

Terlihat masuk akal: nilai yang beda kurang dari 0.1 dianggap sama.

Tapi ini bisa melanggar transitivity equivalence.

```text
a = 0.00
b = 0.09
c = 0.18

compare(a,b) == 0
compare(b,c) == 0
compare(a,c) < 0
```

Kalau `a` setara `b`, dan `b` setara `c`, seharusnya `a` setara `c` dalam equivalence relation. Tapi tidak.

Ini bisa menyebabkan sorting throw:

```text
IllegalArgumentException: Comparison method violates its general contract!
```

Atau hasil sorted structure aneh.

Solusi:

Gunakan bucketing explicit:

```java
static long bucket(double value) {
    return Math.round(value * 10.0);
}

Comparator<Double> byBucket = Comparator.comparingLong(MyClass::bucket);
```

Atau definisikan canonical key:

```java
record MeasurementKey(long roundedTenths) {
    static MeasurementKey from(double value) {
        return new MeasurementKey(Math.round(value * 10));
    }
}
```

Principle:

> Tolerance-based comparator sering berbahaya. Lebih aman ubah data menjadi canonical key, lalu compare key tersebut.

---

## 20. Sorting Mutable Data

Sorting list mutable object aman jika object tidak berubah selama sorting dan setelah sorting tidak diasumsikan tetap valid terhadap mutated key.

Contoh:

```java
List<Case> cases = ...;
cases.sort(Comparator.comparing(Case::deadline));
```

Setelah sort, jika deadline salah satu case berubah:

```java
cases.get(0).setDeadline(LocalDate.parse("2030-01-01"));
```

List tidak otomatis re-sort.

Jika downstream masih menganggap list sorted, invariant rusak.

Untuk sorted snapshot, gunakan immutable projection:

```java
record CaseView(long id, LocalDate deadline, Instant createdAt) {}

List<CaseView> sortedSnapshot = cases.stream()
        .map(c -> new CaseView(c.id(), c.deadline(), c.createdAt()))
        .sorted(Comparator.comparing(CaseView::deadline)
                .thenComparingLong(CaseView::id))
        .toList();
```

Atau gunakan immutable domain object.

---

## 21. Comparator dan Binary Search

Binary search mensyaratkan data sudah sorted dengan comparator yang sama.

Salah:

```java
users.sort(Comparator.comparing(User::name));
int index = Collections.binarySearch(
        users,
        target,
        Comparator.comparing(User::createdAt)
);
```

Ini invalid. Data sorted by name, tetapi searched by createdAt.

Benar:

```java
Comparator<User> byName = Comparator.comparing(User::name);
users.sort(byName);
int index = Collections.binarySearch(users, target, byName);
```

Mental model:

> Binary search bukan mencari dalam list biasa. Ia mencari dalam list yang sudah memenuhi invariant sorted terhadap comparator yang sama.

Part berikutnya akan membahas binary search lebih dalam.

---

## 22. Comparator dan PriorityQueue

`PriorityQueue` memakai comparator untuk heap invariant.

```java
PriorityQueue<Case> queue = new PriorityQueue<>(ESCALATION_ORDER);
```

`poll()` mengeluarkan elemen terkecil menurut comparator.

Jika comparator ascending berarti “lebih urgent lebih kecil”, maka urgent keluar dulu.

### 22.1 Iterasi priority queue tidak sorted

```java
for (Case c : queue) {
    // Ini bukan sorted order penuh
}
```

Untuk hasil sorted:

```java
List<Case> sorted = new ArrayList<>(queue);
sorted.sort(ESCALATION_ORDER);
```

Atau poll satu per satu jika boleh mengosongkan queue:

```java
while (!queue.isEmpty()) {
    process(queue.poll());
}
```

### 22.2 Jangan mutate priority saat object ada di queue

Sama seperti `TreeSet`, jika field priority berubah, heap tidak otomatis memperbaiki posisi.

Solusi:

1. Remove lalu add ulang.
2. Gunakan immutable task object.
3. Gunakan lazy deletion/versioning.

Lazy deletion example:

```java
record ScheduledTask(long id, int version, Instant runAt) {}

PriorityQueue<ScheduledTask> pq = new PriorityQueue<>(
        Comparator.comparing(ScheduledTask::runAt)
                .thenComparingLong(ScheduledTask::id)
                .thenComparingInt(ScheduledTask::version)
);

Map<Long, Integer> latestVersion = new HashMap<>();

void schedule(long id, Instant runAt) {
    int nextVersion = latestVersion.merge(id, 1, Integer::sum);
    pq.add(new ScheduledTask(id, nextVersion, runAt));
}

ScheduledTask pollValid() {
    while (!pq.isEmpty()) {
        ScheduledTask task = pq.poll();
        if (latestVersion.getOrDefault(task.id(), -1) == task.version()) {
            return task;
        }
    }
    return null;
}
```

---

## 23. Designing Comparator as Data, Not Inline Lambda

Inline comparator cepat ditulis:

```java
cases.sort(Comparator.comparing(Case::deadline));
```

Tetapi untuk policy penting, lebih baik jadikan named constant atau named method.

```java
final class CaseComparators {
    static final Comparator<Case> BY_DEADLINE_THEN_ID = Comparator
            .comparing(Case::deadline)
            .thenComparingLong(Case::id);

    static final Comparator<Case> ESCALATION_ORDER = Comparator
            .comparing(Case::slaBreached, Comparator.reverseOrder())
            .thenComparingInt((Case c) -> c.severity().rank()).reversed()
            .thenComparing(Case::deadline)
            .thenComparingLong(Case::id);

    private CaseComparators() {}
}
```

Namun hati-hati dengan `.reversed()` pada chain. Untuk readability, buat bagian-bagian kecil.

```java
final class CaseComparators {
    private static final Comparator<Case> SLA_BREACHED_FIRST =
            Comparator.comparing(Case::slaBreached, Comparator.reverseOrder());

    private static final Comparator<Case> SEVERITY_HIGH_FIRST =
            Comparator.comparingInt((Case c) -> c.severity().rank()).reversed();

    static final Comparator<Case> ESCALATION_ORDER = SLA_BREACHED_FIRST
            .thenComparing(SEVERITY_HIGH_FIRST)
            .thenComparing(Case::deadline)
            .thenComparingLong(Case::id);

    private CaseComparators() {}
}
```

### 23.1 Comparator naming convention

Good names:

```text
BY_DEADLINE_ASC_THEN_ID_ASC
BY_CREATED_AT_DESC_THEN_ID_ASC
ESCALATION_ORDER
REPORT_ORDER
DETERMINISTIC_PAGE_ORDER
SLA_RISK_ORDER
```

Bad names:

```text
SORT_COMPARATOR
CUSTOM_SORT
DEFAULT_ORDER
COMPARE_CASE
```

Comparator name should reveal business intent.

---

## 24. Domain Ordering Decision Framework

Ketika mendesain ordering, jawab pertanyaan ini:

### 24.1 Apa tujuan ordering?

- Display?
- Search?
- Deduplication?
- Range query?
- Scheduling?
- Escalation?
- Pagination?
- Deterministic export?
- Audit/reproducibility?

Comparator untuk display boleh tidak consistent with equals. Comparator untuk `TreeSet` uniqueness harus sangat hati-hati.

### 24.2 Apakah ordering total atau partial?

Partial order:

```text
A depends on B, so B before A.
But C unrelated to A/B.
```

Sorting biasa butuh total order. Untuk dependency, gunakan topological sort, bukan comparator biasa.

Jika kamu memaksa dependency graph menjadi comparator, sering muncul non-transitive comparator.

### 24.3 Apa tiebreaker final?

Untuk deterministic output, pastikan ada final unique key:

```java
.thenComparingLong(Entity::id)
```

Atau:

```java
.thenComparing(Entity::uuid)
```

### 24.4 Apakah key mutable?

Jika ya:

- jangan pakai object mutable sebagai key sorted set/map tanpa lifecycle control,
- jangan asumsikan list tetap sorted setelah mutation,
- gunakan immutable projection.

### 24.5 Apakah key mahal dihitung?

Jika ya:

- precompute key,
- decorate-sort-undecorate,
- materialize ranking key,
- jangan parse/normalize berulang dalam comparator.

### 24.6 Apakah null valid?

Jika valid, tentukan policy. Jika invalid, fail fast.

### 24.7 Apakah text human-language?

Jika ya, pertimbangkan `Collator` dengan locale explicit.

### 24.8 Apakah ordering dipakai di DB dan Java?

Jika ya, pastikan semantics konsisten.

Contoh mismatch:

```text
DB collation case-insensitive
Java String.compareTo case-sensitive
```

Ini bisa menyebabkan pagination mismatch, duplicate ordering, atau inconsistent page boundary.

---

## 25. Worked Example: Case Queue Ranking

Kita desain comparator untuk case queue.

### 25.1 Requirement

Sistem perlu menampilkan daftar case untuk officer.

Urutan:

1. Case yang blocked muncul paling atas.
2. Case yang SLA breached muncul setelah blocked priority.
3. Severity tinggi muncul lebih dulu.
4. Deadline lebih awal muncul lebih dulu.
5. Case yang sudah lebih sering dieskalasi muncul lebih dulu.
6. CreatedAt lebih awal muncul lebih dulu.
7. ID sebagai tiebreaker deterministic.

### 25.2 Domain model

```java
enum Severity {
    LOW(10), MEDIUM(20), HIGH(30), CRITICAL(40);

    private final int rank;

    Severity(int rank) {
        this.rank = rank;
    }

    int rank() {
        return rank;
    }
}

record CaseItem(
        long id,
        boolean blocked,
        boolean slaBreached,
        Severity severity,
        LocalDate deadline,
        int escalationCount,
        Instant createdAt
) {}
```

### 25.3 Comparator direct

```java
static final Comparator<CaseItem> CASE_QUEUE_ORDER =
        Comparator.comparing(CaseItem::blocked, Comparator.reverseOrder())
                .thenComparing(CaseItem::slaBreached, Comparator.reverseOrder())
                .thenComparingInt((CaseItem c) -> c.severity().rank()).reversed()
                .thenComparing(CaseItem::deadline, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparingInt(CaseItem::escalationCount).reversed()
                .thenComparing(CaseItem::createdAt)
                .thenComparingLong(CaseItem::id);
```

Ada masalah readability karena `.reversed()` bisa membingungkan.

### 25.4 Comparator decomposed

```java
static final Comparator<CaseItem> BLOCKED_FIRST =
        Comparator.comparing(CaseItem::blocked, Comparator.reverseOrder());

static final Comparator<CaseItem> SLA_BREACHED_FIRST =
        Comparator.comparing(CaseItem::slaBreached, Comparator.reverseOrder());

static final Comparator<CaseItem> SEVERITY_HIGH_FIRST =
        Comparator.comparingInt((CaseItem c) -> c.severity().rank()).reversed();

static final Comparator<CaseItem> DEADLINE_EARLY_FIRST =
        Comparator.comparing(
                CaseItem::deadline,
                Comparator.nullsLast(Comparator.naturalOrder())
        );

static final Comparator<CaseItem> ESCALATION_COUNT_HIGH_FIRST =
        Comparator.comparingInt(CaseItem::escalationCount).reversed();

static final Comparator<CaseItem> CASE_QUEUE_ORDER = BLOCKED_FIRST
        .thenComparing(SLA_BREACHED_FIRST)
        .thenComparing(SEVERITY_HIGH_FIRST)
        .thenComparing(DEADLINE_EARLY_FIRST)
        .thenComparing(ESCALATION_COUNT_HIGH_FIRST)
        .thenComparing(CaseItem::createdAt)
        .thenComparingLong(CaseItem::id);
```

Ini lebih panjang, tapi jauh lebih aman untuk policy penting.

### 25.5 Explainable rank key

```java
record CaseQueueRank(
        boolean blocked,
        boolean slaBreached,
        int severityRank,
        LocalDate deadline,
        int escalationCount,
        Instant createdAt,
        long id
) {
    static CaseQueueRank from(CaseItem c) {
        return new CaseQueueRank(
                c.blocked(),
                c.slaBreached(),
                c.severity().rank(),
                c.deadline(),
                c.escalationCount(),
                c.createdAt(),
                c.id()
        );
    }
}
```

Comparator:

```java
static final Comparator<CaseQueueRank> CASE_QUEUE_RANK_ORDER =
        Comparator.comparing(CaseQueueRank::blocked, Comparator.reverseOrder())
                .thenComparing(CaseQueueRank::slaBreached, Comparator.reverseOrder())
                .thenComparing(CaseQueueRank::severityRank, Comparator.reverseOrder())
                .thenComparing(CaseQueueRank::deadline, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(CaseQueueRank::escalationCount, Comparator.reverseOrder())
                .thenComparing(CaseQueueRank::createdAt)
                .thenComparingLong(CaseQueueRank::id);
```

Usage:

```java
List<CaseItem> ordered = cases.stream()
        .map(c -> Map.entry(CaseQueueRank.from(c), c))
        .sorted(Map.Entry.comparingByKey(CASE_QUEUE_RANK_ORDER))
        .map(Map.Entry::getValue)
        .toList();
```

### 25.6 Complexity

Jika ada `n` case:

```text
sort cost: O(n log n)
rank creation: O(n)
memory: O(n) untuk decorated entries
```

Jika rank computation mahal atau perlu audit, ini worth it.

Jika sangat latency-sensitive dan rank murah, direct comparator lebih hemat allocation.

---

## 26. Worked Example: Sorting Event Log Deterministically

Requirement:

```text
Audit event harus ditampilkan berdasarkan eventTime ascending.
Jika eventTime sama, urutkan by sequenceNo.
Jika sequenceNo null karena event lama, fallback by createdAt.
Jika masih sama, fallback by id.
```

Comparator:

```java
record AuditEvent(
        long id,
        Instant eventTime,
        Long sequenceNo,
        Instant createdAt
) {}

static final Comparator<AuditEvent> AUDIT_EVENT_ORDER = Comparator
        .comparing(AuditEvent::eventTime)
        .thenComparing(
                AuditEvent::sequenceNo,
                Comparator.nullsLast(Long::compareTo)
        )
        .thenComparing(AuditEvent::createdAt)
        .thenComparingLong(AuditEvent::id);
```

Potential issue:

If `sequenceNo == null`, `createdAt` decides order. But if `sequenceNo` exists for one event and null for another at same eventTime, nullsLast means event with sequenceNo comes first.

Is this desired?

Business must decide.

Alternative: separate legacy and modern events.

```java
static final Comparator<AuditEvent> AUDIT_EVENT_ORDER = Comparator
        .comparing(AuditEvent::eventTime)
        .thenComparing(e -> e.sequenceNo() == null)
        .thenComparing(
                AuditEvent::sequenceNo,
                Comparator.nullsLast(Long::compareTo)
        )
        .thenComparing(AuditEvent::createdAt)
        .thenComparingLong(AuditEvent::id);
```

This makes “has sequence first” explicit.

---

## 27. Worked Example: Rule Priority Ordering

Requirement:

Rules are applied in order:

1. Explicit agency override before general rule.
2. More specific rule before less specific rule.
3. Higher configured priority first.
4. Newer version first.
5. Rule ID ascending as deterministic tiebreaker.

Domain:

```java
record Rule(
        long id,
        boolean agencyOverride,
        int specificityScore,
        int priority,
        int version
) {}
```

Comparator:

```java
static final Comparator<Rule> RULE_APPLICATION_ORDER = Comparator
        .comparing(Rule::agencyOverride, Comparator.reverseOrder())
        .thenComparingInt(Rule::specificityScore).reversed()
        .thenComparingInt(Rule::priority).reversed()
        .thenComparingInt(Rule::version).reversed()
        .thenComparingLong(Rule::id);
```

Again, `.reversed()` chain risk. Better:

```java
static final Comparator<Rule> AGENCY_OVERRIDE_FIRST =
        Comparator.comparing(Rule::agencyOverride, Comparator.reverseOrder());

static final Comparator<Rule> SPECIFICITY_HIGH_FIRST =
        Comparator.comparingInt(Rule::specificityScore).reversed();

static final Comparator<Rule> PRIORITY_HIGH_FIRST =
        Comparator.comparingInt(Rule::priority).reversed();

static final Comparator<Rule> VERSION_NEW_FIRST =
        Comparator.comparingInt(Rule::version).reversed();

static final Comparator<Rule> RULE_APPLICATION_ORDER = AGENCY_OVERRIDE_FIRST
        .thenComparing(SPECIFICITY_HIGH_FIRST)
        .thenComparing(PRIORITY_HIGH_FIRST)
        .thenComparing(VERSION_NEW_FIRST)
        .thenComparingLong(Rule::id);
```

But ask deeper:

> Is rule application truly a total order, or is there dependency between rules?

If rule B depends on rule A output, comparator is not enough. You need dependency graph + topological sort.

---

## 28. Sorting and Database Boundary

Often data comes from DB.

Question:

> Should sorting happen in DB or Java?

### 28.1 Prefer DB sorting when

1. Data set is large.
2. DB has useful index.
3. You need pagination.
4. Sorting key is persisted column.
5. Query can avoid transferring unnecessary rows.

Example:

```sql
SELECT *
FROM cases
WHERE state = 'OPEN'
ORDER BY deadline ASC, id ASC
FETCH FIRST 100 ROWS ONLY
```

### 28.2 Prefer Java sorting when

1. Data set already small.
2. Sorting key is computed in application.
3. Sorting uses complex domain logic not in DB.
4. You are merging multiple sources.
5. You are sorting in-memory snapshot.

### 28.3 Beware mismatch

DB ordering and Java ordering may differ because:

1. DB collation differs from Java string ordering.
2. Null ordering differs.
3. Timezone conversion differs.
4. Numeric precision differs.
5. Case sensitivity differs.
6. DB `ORDER BY` missing unique tiebreaker.

If Java does post-sort after DB pagination, result can be incorrect.

Bad:

```text
DB returns first 100 by created_at.
Java reorders those 100 by priority.
```

This does not equal “global top 100 by priority”.

Correct alternatives:

1. Sort globally in DB by final order.
2. Fetch all candidates then sort in Java if candidate set small.
3. Materialize application rank into DB column/index if needed.
4. Use search/indexing system if ordering is complex and high-volume.

---

## 29. Sorting Large Data: External Sort Thinking

If data does not fit memory, `list.sort` is not enough.

External sort pattern:

1. Read chunk.
2. Sort chunk in memory.
3. Write sorted run to disk/object storage.
4. K-way merge sorted runs.

Java DSA relevance:

- chunk sorting uses `Arrays.sort` / `List.sort`,
- merge uses heap / priority queue,
- comparator must be same across runs,
- output order must be deterministic,
- memory bound is explicit.

Pseudo:

```java
PriorityQueue<RunHead> heap = new PriorityQueue<>(
        Comparator.comparing(RunHead::key)
                .thenComparingInt(RunHead::runIndex)
);
```

Why tiebreak by runIndex?

To make merge deterministic when keys equal.

This is the same idea as sorting small data: equal keys still need policy if reproducibility matters.

---

## 30. Sorting Algorithm Summary for Java Engineer

You do not need to implement TimSort or Dual-Pivot Quicksort daily. But you must know their implications.

### 30.1 Object list/array sorting

Generally:

- stable,
- adaptive,
- efficient for partially sorted data,
- comparison-based,
- comparator cost matters,
- may use temporary storage.

### 30.2 Primitive array sorting

Generally:

- optimized for primitive data,
- no object pointer chasing,
- no comparator,
- very cache-friendly,
- not about stability.

### 30.3 Parallel sorting

Potentially useful for large arrays, but consider:

- overhead,
- common pool contention,
- memory bandwidth,
- request latency,
- comparator cost,
- environment constraints.

### 30.4 Custom sorting algorithm

Usually avoid unless:

1. You need partial sort/top-K.
2. You need external sort.
3. You need counting/radix sort for bounded integer keys.
4. You need streaming order.
5. You need domain-specific incremental index.

---

## 31. Partial Sort and Top-K

Sometimes sorting all data is wasteful.

Question:

> Do you need full sorted order, or only top K?

If only top 10 urgent cases from 1 million:

Bad:

```java
cases.sort(ESCALATION_ORDER);
return cases.subList(0, 10);
```

Cost:

```text
O(n log n)
```

Alternative with heap size K:

```java
PriorityQueue<Case> heap = new PriorityQueue<>(
        10,
        ESCALATION_ORDER.reversed() // worst among selected at head
);

for (Case c : cases) {
    if (heap.size() < 10) {
        heap.add(c);
    } else if (ESCALATION_ORDER.compare(c, heap.peek()) < 0) {
        heap.poll();
        heap.add(c);
    }
}

List<Case> top = new ArrayList<>(heap);
top.sort(ESCALATION_ORDER);
```

Cost:

```text
O(n log k)
```

For small `k`, much cheaper.

This will be explored more in heap/top-K part.

---

## 32. Common Anti-Patterns

### 32.1 Comparator by subtraction

```java
(a, b) -> a.id() - b.id()
```

Use:

```java
Comparator.comparingLong(Entity::id)
```

### 32.2 Comparator that returns only 1 or 0

```java
(a, b) -> a.score() > b.score() ? 1 : 0
```

Invalid. Must return negative/zero/positive consistently.

### 32.3 No tiebreaker in production output

```java
Comparator.comparing(Event::timestamp)
```

Better:

```java
Comparator.comparing(Event::timestamp).thenComparingLong(Event::id)
```

### 32.4 Sorting repeatedly in loop

```java
for (Item item : incoming) {
    list.add(item);
    list.sort(order);
}
```

Use heap/tree/batch sort.

### 32.5 Comparator with side effects

```java
Comparator<User> cmp = (a, b) -> {
    metrics.increment();
    return a.name().compareTo(b.name());
};
```

Comparator can be called many times in unspecified pattern. Side effects make behavior confusing.

### 32.6 Comparator that reads external mutable state

```java
Comparator<Task> cmp = (a, b) -> Integer.compare(
        dynamicPriority.get(a.id()),
        dynamicPriority.get(b.id())
);
```

If `dynamicPriority` changes during sort, contract can break.

Snapshot first.

### 32.7 Locale-sensitive sorting without explicit locale

```java
Collator.getInstance()
```

Default locale may differ by environment. Specify locale for deterministic system behavior.

### 32.8 Using comparator for dependency ordering

If relation is “A must run before B” and many nodes are unrelated, use graph topological sort, not comparator.

---

## 33. Practical Checklist

Before writing comparator, answer:

```text
[ ] What is the business meaning of this order?
[ ] Is it total order or partial order?
[ ] Is it for display, set/map uniqueness, range query, priority queue, or pagination?
[ ] Does compare(a,b)==0 imply duplicate/equivalent for this use case?
[ ] Is it consistent with equals when used in TreeSet/TreeMap?
[ ] Are all fields used by comparator immutable during structure membership?
[ ] Is there a final deterministic tiebreaker?
[ ] Is null possible? If yes, null first/last/fail fast?
[ ] Are String keys technical or human-language?
[ ] Is locale explicit if human-language sorting is needed?
[ ] Is key extraction cheap? If not, should we precompute rank/key?
[ ] Is full sort needed, or only top-K/next item/range query?
[ ] Is sorting done in Java or should DB/index do it?
[ ] Is comparator tested for sign symmetry and transitivity?
[ ] Does code avoid subtraction comparator?
```

---

## 34. Mini Exercises

### Exercise 1: Find the bug

```java
Comparator<Order> order = (a, b) -> (int) (a.totalCents() - b.totalCents());
```

Questions:

1. What happens if `totalCents` difference exceeds `Integer.MAX_VALUE`?
2. What if total is `long`?
3. What should be used instead?

Expected fix:

```java
Comparator<Order> order = Comparator.comparingLong(Order::totalCents);
```

### Exercise 2: TreeSet disappearing data

```java
record User(long id, String email) {}

Set<User> users = new TreeSet<>(Comparator.comparing(User::email));
users.add(new User(1, "a@example.com"));
users.add(new User(2, "a@example.com"));
```

Questions:

1. What is `users.size()`?
2. Is it a bug?
3. How to fix if both users must be retained?

Fix:

```java
Set<User> users = new TreeSet<>(
        Comparator.comparing(User::email)
                .thenComparingLong(User::id)
);
```

Or use:

```java
Map<String, List<User>> usersByEmail = new TreeMap<>();
```

### Exercise 3: Deadline null policy

Design comparator for:

```java
record Task(long id, LocalDate deadline, int priority) {}
```

Requirement:

1. Higher priority first.
2. Earlier deadline first.
3. Tasks without deadline last.
4. ID as tiebreaker.

Answer:

```java
Comparator<Task> TASK_ORDER = Comparator
        .comparingInt(Task::priority).reversed()
        .thenComparing(
                Task::deadline,
                Comparator.nullsLast(Comparator.naturalOrder())
        )
        .thenComparingLong(Task::id);
```

But watch `.reversed()` placement. Safer:

```java
Comparator<Task> PRIORITY_HIGH_FIRST =
        Comparator.comparingInt(Task::priority).reversed();

Comparator<Task> DEADLINE_EARLY_FIRST_NULL_LAST =
        Comparator.comparing(
                Task::deadline,
                Comparator.nullsLast(Comparator.naturalOrder())
        );

Comparator<Task> TASK_ORDER = PRIORITY_HIGH_FIRST
        .thenComparing(DEADLINE_EARLY_FIRST_NULL_LAST)
        .thenComparingLong(Task::id);
```

### Exercise 4: Comparator or topological sort?

Requirement:

```text
Step B must run after Step A.
Step C must run after Step A.
Step D must run after B and C.
```

Should you write comparator?

Usually no. This is dependency graph. Use topological sort.

---

## 35. Summary

Ordering is one of the most underestimated parts of DSA in Java.

Key points:

1. Comparator defines a relation, not only a UI sorting trick.
2. `compare(a,b)==0` can affect uniqueness in sorted structures.
3. `Comparable` is for true natural ordering; `Comparator` is for context-specific ordering.
4. Comparator must obey sign symmetry, transitivity, and consistency requirements.
5. Never use subtraction comparator for numeric fields.
6. Stable sort matters for equal elements and multi-key behavior.
7. Java object sorting and primitive sorting have different cost models.
8. Sorting cost is often dominated by comparator cost and data movement, not only `O(n log n)`.
9. Production ordering should usually have deterministic tiebreaker.
10. Null policy must be explicit.
11. Locale-sensitive String sorting needs `Collator` and explicit locale.
12. `BigDecimal` is a real example where natural ordering differs from equals.
13. Use sorted structures, heaps, or range indexes when repeated ordering operations are required.
14. For dependency relation, use graph algorithms, not comparator hacks.
15. Comparator used for policy should be named, tested, and explainable.

---

## 36. Referensi

- Oracle Java SE 25 `Comparator` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html
- Oracle Java SE 25 `Comparable` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html
- Oracle Java SE 25 `List.sort` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html
- Oracle Java SE 25 `Arrays.sort` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html
- Oracle Java SE 25 `Collections` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html
- Oracle Java SE 25 `Collator` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Collator.html
- OpenJDK `TimSort` source: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/TimSort.java
- OpenJDK `Arrays` source: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/Arrays.java

---

## 37. Status Seri

Part ini adalah **Part 008 dari 030**.

Seri **belum selesai**.

Berikutnya:

```text
learn-java-dsa-part-009.md
```

Judul berikutnya:

```text
Part 009 — Binary Search, Sorted Data, Navigable Structures
```
