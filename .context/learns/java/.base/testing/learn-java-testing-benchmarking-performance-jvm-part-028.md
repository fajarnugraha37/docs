# learn-java-testing-benchmarking-performance-jvm-part-028

# Part 028 — Performance Engineering for Java Code: Allocation, Collections, Strings, IO, Serialization

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: bagaimana bentuk kode Java menghasilkan biaya runtime: allocation, CPU, memory locality, GC pressure, IO, serialization, logging, exception, dan caching.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- benchmark fundamental,
- JMH,
- macrobenchmark/load test,
- JVM execution model,
- memory model,
- GC,
- JVM arguments,
- diagnostic tools,
- profiling dan flame graph.

Part ini menjawab pertanyaan berikut:

> Setelah profiler menunjukkan hot path, allocation source, GC pressure, atau latency contributor, bagaimana kita memperbaiki bentuk kode Java tanpa jatuh ke micro-optimization yang tidak perlu?

Tujuan akhirnya bukan membuat semua kode “super cepat”, tetapi membangun kemampuan untuk:

1. membaca biaya runtime dari bentuk kode,
2. membedakan optimization yang berdampak dari optimization kosmetik,
3. mengurangi allocation pressure secara terukur,
4. memilih data structure berdasarkan workload,
5. memahami cost dari string, regex, logging, exception, serialization, dan IO,
6. menghubungkan perubahan kode dengan benchmark, profiler, dan production telemetry,
7. membuat keputusan performance yang aman untuk readability, correctness, dan maintainability.

---

## 2. Mental Model Utama: Kode Java Adalah Generator Workload untuk JVM

Kode Java tidak langsung “menjadi performa”. Kode Java menghasilkan workload untuk runtime.

```text
Source code
  -> bytecode shape
  -> interpreter/JIT profile
  -> object allocation pattern
  -> memory access pattern
  -> branch profile
  -> lock/coordination pattern
  -> IO/syscall pattern
  -> GC pressure
  -> CPU/cache behavior
  -> latency/throughput behavior
```

Jadi ketika kita menulis:

```java
var result = orders.stream()
    .filter(o -> o.status() == Status.ACTIVE)
    .map(o -> o.customer().email().toLowerCase(Locale.ROOT))
    .distinct()
    .sorted()
    .toList();
```

kita bukan hanya menulis “business logic”. Kita juga menentukan:

- apakah ada intermediate object,
- apakah lambda bisa di-inline,
- apakah ada boxing,
- apakah `toLowerCase` membuat string baru,
- apakah `distinct` membuat hash table,
- apakah `sorted` membutuhkan materialisasi penuh,
- apakah output list immutable atau mutable tergantung API/version,
- apakah branch/data distribution membuat CPU cache locality buruk,
- apakah pipeline cocok untuk data kecil, sedang, atau besar.

Top-tier Java engineer tidak bertanya “stream atau loop lebih cepat?” secara abstrak. Mereka bertanya:

```text
Data size berapa?
Allocation rate berapa?
Hot path atau cold path?
Latency-sensitive atau batch?
Apakah readability lebih penting dari 2% CPU?
Apakah profiler membuktikan ini bottleneck?
Apakah benchmark representatif?
Apa failure mode setelah optimization?
```

---

## 3. Optimization Ladder: Urutan yang Sehat

Jangan mulai dari micro-optimization. Mulai dari evidence.

```text
1. Correctness first
   - Test behavior.
   - Test edge cases.
   - Test concurrency if needed.

2. Observe
   - Metrics: latency, throughput, error rate, allocation rate, GC, CPU.
   - Logs/traces for request path.
   - JFR/profiler for runtime cause.

3. Localize
   - Which endpoint/job/consumer?
   - Which method/path?
   - CPU-bound, allocation-bound, IO-bound, lock-bound, DB-bound?

4. Hypothesize
   - What exact cost is too high?
   - Allocation? Branching? Serialization? Logging? Regex? Copying? Blocking?

5. Measure locally
   - Unit-level benchmark if pure code.
   - JMH for isolated algorithm/code path.
   - Integration/macrobenchmark for end-to-end behavior.

6. Change one thing
   - Smallest safe change.
   - Preserve readability when possible.
   - Add regression test/benchmark if critical.

7. Validate
   - Same workload.
   - Same JVM/container settings.
   - Compare before/after.

8. Operationalize
   - Document assumption.
   - Add metrics/alert if needed.
   - Add performance regression gate if valuable.
```

Performance engineering is controlled change management, not folklore.

---

## 4. Java 8–25 Compatibility Notes

Java 8 sampai Java 25 punya perbedaan besar yang memengaruhi bentuk kode dan runtime behavior.

| Area | Java 8 | Java 11 | Java 17 | Java 21 | Java 25 |
|---|---:|---:|---:|---:|---:|
| Default GC | Parallel GC historically common/default in many Java 8 deployments | G1 default since Java 9 era | G1 mature | Virtual threads available | Modern GC/runtime improvements continue |
| String representation | Compact Strings belum ada | Compact Strings sudah ada sejak Java 9 | Mature | Mature | Mature |
| `String` concat | Java 8 uses older patterns | `invokedynamic` concat since Java 9 | Mature | Mature | Mature |
| `Stream.toList()` | Tidak ada | Tidak ada | Ada sejak Java 16 | Ada | Ada |
| Records | Tidak ada | Tidak ada | Ada | Ada | Ada |
| Pattern matching | Tidak ada | Limited/no | More features | More features | More features |
| Virtual threads | Tidak ada | Tidak ada | Preview era absent | Final in Java 21 | Matured ecosystem |
| ZGC | Tidak ada | Experimental/available depending build/version | Production-grade | Generational ZGC | Non-generational ZGC removed direction relevant |
| Module system | Tidak ada | Ada | Ada | Ada | Ada |
| Strong encapsulation | Tidak ada | Transition | Stronger | Strong | Strong |

Implikasi praktis:

1. **Jangan copy-paste benchmark Java 8 ke Java 21/25 tanpa revalidasi.**  
   JIT, GC, string implementation, inlining, dan library internals bisa berubah.

2. **Optimization berbasis internal JDK harus dicurigai.**  
   Misalnya reflection hack, unsafe access, atau dependency pada object layout tertentu.

3. **Library performance bisa berubah antar versi.**  
   Jackson, logging framework, HTTP client, JDBC driver, dan collection implementation sering berubah.

4. **Virtual threads mengubah cost model blocking, bukan menghapus cost IO.**  
   Blocking lebih murah dari sisi thread, tetapi connection pool, DB, rate limit, dan downstream tetap bottleneck.

5. **Container memory budget semakin penting.**  
   Allocation-heavy code yang aman di VM besar bisa menyebabkan GC churn atau OOMKilled di Kubernetes kecil.

---

## 5. Performance Cost Taxonomy pada Kode Java

Ketika kode lambat, biasanya cost-nya masuk salah satu kategori berikut.

### 5.1 CPU Cost

Contoh:

- sorting besar,
- regex kompleks,
- JSON serialization/deserialization,
- encryption/hashing,
- compression,
- BigDecimal calculation,
- date/time parsing,
- object mapping,
- repeated permission calculation.

Signal:

- CPU usage tinggi,
- flame graph menunjukkan method Java dominan,
- GC tidak dominan,
- latency turun ketika CPU ditambah.

### 5.2 Allocation Cost

Contoh:

- membuat DTO berlapis-lapis,
- string concatenation dalam loop,
- regex `Pattern.compile` berulang,
- boxing/unboxing,
- stream pipeline pada hot small loop,
- temporary collection,
- JSON tree model (`JsonNode`) berlebihan,
- exception sebagai control flow.

Signal:

- allocation rate tinggi,
- minor GC sering,
- p99 spike saat GC,
- `-prof gc` JMH menunjukkan `gc.alloc.rate.norm` tinggi,
- JFR allocation event menunjukkan hot allocation site.

### 5.3 Memory Retention Cost

Contoh:

- cache tanpa bound,
- static map,
- ThreadLocal tidak dibersihkan,
- classloader leak,
- listener/subscriber tidak dilepas,
- queue backlog,
- batch menahan semua data di memory,
- request context menyimpan payload besar.

Signal:

- heap after GC naik terus,
- old gen/live set naik,
- heap dump dominator menunjukkan collection/cache/queue,
- GC makin sering dan makin mahal.

### 5.4 IO Cost

Contoh:

- file read/write tanpa buffering,
- remote HTTP call per item,
- N+1 database query,
- flush terlalu sering,
- synchronous logging ke disk/network,
- membaca semua file/payload ke memory.

Signal:

- CPU rendah tapi latency tinggi,
- wall-clock profiler menunjukkan waiting/socket/file IO,
- thread dump banyak `WAITING`/`TIMED_WAITING`/socket read,
- connection pool penuh.

### 5.5 Coordination Cost

Contoh:

- lock contention,
- synchronized hot path,
- single shared counter,
- bounded queue penuh,
- executor saturation,
- connection pool bottleneck,
- cache stampede.

Signal:

- CPU tidak penuh tapi throughput stagnan,
- thread dump banyak BLOCKED,
- JFR lock event,
- async-profiler lock profile,
- queue depth naik.

---

## 6. Allocation Engineering

Allocation di JVM itu murah, tetapi bukan gratis.

Modern JVM membuat allocation sangat cepat melalui TLAB dan bump-pointer allocation. Masalah muncul ketika allocation rate melebihi kemampuan GC, cache locality memburuk, atau object sementara terlalu banyak di hot path.

### 6.1 Allocation Rate vs Retention

Dua hal ini sering tertukar.

```text
Allocation rate = seberapa cepat object dibuat.
Retention      = seberapa lama object bertahan.
```

High allocation rate bisa aman kalau object mati muda dan GC bisa mengimbanginya. Tetapi dalam service latency-sensitive, high allocation rate tetap bisa menaikkan GC frequency dan p99 latency.

High retention lebih berbahaya karena memperbesar live set, old generation, dan durasi marking/compaction.

### 6.2 Contoh Allocation yang Tidak Terlihat

#### Boxing

```java
List<Integer> ids = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    ids.add(i); // boxes int -> Integer
}
```

Kalau data primitif sangat besar dan hot path, pertimbangkan:

- primitive array,
- specialized primitive collections,
- batching,
- streaming processing.

Namun jangan mengganti semua `List<Integer>` secara impulsif. Lihat profiler dulu.

#### Temporary Collection

```java
List<Order> active = orders.stream()
    .filter(Order::isActive)
    .collect(Collectors.toList());

return active.stream()
    .map(Order::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

Bisa dibuat single pass:

```java
BigDecimal total = BigDecimal.ZERO;
for (Order order : orders) {
    if (order.isActive()) {
        total = total.add(order.amount());
    }
}
return total;
```

Tapi trade-off:

- versi stream mungkin lebih readable untuk cold path,
- versi loop lebih cocok untuk hot path dengan data besar,
- `BigDecimal` sendiri tetap allocation-heavy karena immutable.

#### String Allocation

```java
String key = tenantId + ":" + module + ":" + userId;
```

Ini biasanya baik-baik saja untuk path biasa. Tetapi dalam loop sangat panas atau millions/sec, object sementara bisa signifikan.

### 6.3 Object Reuse: Tidak Selalu Lebih Baik

Engineer yang baru belajar performance sering berpikir:

> “Kalau allocation mahal, berarti kita harus reuse object.”

Tidak selalu.

Object reuse bisa memperburuk:

- readability,
- thread safety,
- accidental state leak,
- escape analysis,
- GC generational behavior,
- cache correctness,
- bug karena mutable shared object.

Contoh buruk:

```java
private static final StringBuilder SHARED = new StringBuilder();

public String buildKey(String a, String b) {
    SHARED.setLength(0);
    return SHARED.append(a).append(':').append(b).toString();
}
```

Ini tidak thread-safe.

Versi aman:

```java
public String buildKey(String a, String b) {
    return new StringBuilder(a.length() + b.length() + 1)
        .append(a)
        .append(':')
        .append(b)
        .toString();
}
```

Biasanya JVM/JIT sangat baik mengoptimalkan object lokal yang tidak escape. Jadi object reuse manual harus dibuktikan.

### 6.4 Escape Analysis

JIT bisa menghilangkan allocation jika object tidak escape dari method/thread.

Contoh konseptual:

```java
record Point(int x, int y) {}

int distanceLike(int x, int y) {
    Point p = new Point(x, y);
    return p.x() * p.x() + p.y() * p.y();
}
```

Dalam kondisi tertentu, allocation `Point` bisa dihilangkan melalui scalar replacement.

Implikasi:

- Jangan otomatis takut membuat object kecil yang lokal dan jelas.
- Takutlah pada object yang disimpan, dikembalikan, masuk collection, masuk lambda yang escape, atau melintasi boundary async.

### 6.5 Allocation Reduction Checklist

Gunakan checklist ini hanya setelah profiler menunjukkan allocation penting.

```text
[ ] Apakah allocation terjadi di hot path?
[ ] Apakah object mati muda atau tertahan lama?
[ ] Apakah allocation berasal dari temporary collection?
[ ] Apakah ada boxing/unboxing besar?
[ ] Apakah ada string/regex/date parser berulang?
[ ] Apakah mapper membuat DTO bertingkat tanpa perlu?
[ ] Apakah JSON tree dipakai padahal streaming/binding cukup?
[ ] Apakah batch menahan semua data di memory?
[ ] Apakah cache/queue membuat retention?
[ ] Apakah optimization bisa diuji dengan JMH/JFR/load test?
```

---

## 7. Collections Performance Engineering

Collections adalah salah satu sumber cost terbesar di aplikasi enterprise.

Bukan karena `ArrayList` atau `HashMap` buruk, tetapi karena:

- ukuran tidak dikontrol,
- duplicate structure,
- conversion berulang,
- wrong data structure,
- hashing buruk,
- iteration pattern buruk,
- synchronization salah,
- memory overhead besar.

### 7.1 `ArrayList`

`ArrayList` cocok untuk:

- append dominan,
- indexed access,
- iteration cepat,
- data compact.

Masalah umum:

```java
List<Item> result = new ArrayList<>();
for (Item item : source) {
    if (item.isValid()) {
        result.add(transform(item));
    }
}
```

Jika source besar dan kira-kira semua item masuk, pre-size bisa membantu:

```java
List<ItemDto> result = new ArrayList<>(source.size());
for (Item item : source) {
    if (item.isValid()) {
        result.add(transform(item));
    }
}
```

Tapi pre-size terlalu besar bisa membuang memory jika hanya sedikit item lolos filter.

Better:

```java
int expected = Math.min(source.size(), 1024);
List<ItemDto> result = new ArrayList<>(expected);
```

atau gunakan heuristik domain.

### 7.2 `LinkedList`

`LinkedList` sering disalahgunakan.

Klaim umum:

> “LinkedList cepat untuk insert/delete.”

Itu hanya benar jika node position sudah diketahui. Dalam praktik, traversal pointer-heavy membuat locality buruk.

Untuk kebanyakan workload modern:

- `ArrayList` lebih baik untuk iteration,
- `ArrayDeque` lebih baik untuk queue/deque,
- `LinkedList` jarang menjadi pilihan terbaik.

### 7.3 `HashMap`

`HashMap` cost berasal dari:

- hashing,
- equality check,
- resize/rehash,
- collision,
- memory overhead node/table,
- poor key design.

#### Pre-sizing HashMap

```java
Map<String, User> byId = new HashMap<>();
for (User user : users) {
    byId.put(user.id(), user);
}
```

Jika `users` besar, resize bisa mahal.

Kapasitas kira-kira:

```java
static int hashMapCapacityFor(int expectedSize) {
    return (int) ((expectedSize / 0.75f) + 1.0f);
}

Map<String, User> byId = new HashMap<>(hashMapCapacityFor(users.size()));
```

Catatan:

- Jangan overdo untuk map kecil.
- Pre-sizing berguna untuk map besar/hot path.
- Pastikan key `equals/hashCode` benar dan stabil.

### 7.4 `EnumMap` dan `EnumSet`

Jika key adalah enum, gunakan `EnumMap`/`EnumSet`.

```java
EnumMap<CaseStatus, Integer> countByStatus = new EnumMap<>(CaseStatus.class);
```

Keuntungan:

- lebih compact,
- lebih cepat,
- tidak perlu hashing umum,
- semantic lebih jelas.

### 7.5 `ConcurrentHashMap`

`ConcurrentHashMap` cocok untuk concurrent access, tetapi bukan solusi semua concurrency.

Contoh aman untuk cache lazy:

```java
PermissionDecision decision = cache.computeIfAbsent(key, this::loadDecision);
```

Tetapi hati-hati:

- function `loadDecision` harus aman,
- jangan melakukan blocking mahal tanpa memikirkan cache stampede/lock contention,
- jangan menaruh mutable object yang diubah tanpa sinkronisasi,
- jangan lupa eviction jika cache tumbuh tak terbatas.

### 7.6 Collection Conversion Cost

Anti-pattern:

```java
Set<String> ids = users.stream()
    .map(User::id)
    .collect(Collectors.toSet());

List<String> sorted = new ArrayList<>(ids);
Collections.sort(sorted);
```

Mungkin benar, tapi tanyakan:

- Apakah perlu dedup?
- Apakah perlu sorted?
- Apakah urutan stabil penting?
- Apakah bisa query DB langsung sorted/dedup?
- Apakah conversion terjadi per request?

### 7.7 Collection Performance Checklist

```text
[ ] Apakah data structure sesuai access pattern?
[ ] Apakah collection besar di-pre-size dengan wajar?
[ ] Apakah ada conversion list->set->list yang tidak perlu?
[ ] Apakah `LinkedList` dipakai tanpa alasan kuat?
[ ] Apakah enum key memakai EnumMap/EnumSet?
[ ] Apakah map key immutable dan hashCode stabil?
[ ] Apakah collection disimpan terlalu lama dan menahan memory?
[ ] Apakah concurrent collection dipakai untuk menyembunyikan desain concurrency buruk?
[ ] Apakah ordering/dedup/sorting benar-benar dibutuhkan?
```

---

## 8. Stream vs Loop: Cara Berpikir yang Benar

Pertanyaan “Stream lebih lambat dari loop?” terlalu dangkal.

Jawaban yang benar:

> Tergantung data size, operation, allocation, JIT inlining, branch profile, primitive vs boxed, readability, dan hotness.

### 8.1 Stream Cocok Ketika

- pipeline sederhana,
- data tidak terlalu besar,
- readability meningkat,
- bukan hot path ekstrem,
- operasi dominan bukan overhead stream,
- tidak banyak boxing,
- tidak perlu early exit kompleks.

```java
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

### 8.2 Loop Cocok Ketika

- hot path sangat sering,
- data besar,
- perlu minimize allocation,
- perlu primitive operations,
- perlu early exit,
- perlu avoid intermediate structure,
- branch handling kompleks,
- profiler menunjukkan stream overhead nyata.

```java
List<String> emails = new ArrayList<>(users.size());
for (User user : users) {
    if (user.active()) {
        emails.add(user.email());
    }
}
```

### 8.3 Parallel Stream

Parallel stream sering menjadi footgun.

Masalah:

- memakai common ForkJoinPool,
- blocking operation bisa merusak common pool,
- overhead splitting/merging,
- ordering cost,
- false sharing/coordination,
- tidak cocok untuk IO remote tanpa kontrol concurrency,
- bisa bentrok dengan framework runtime.

Jangan gunakan `parallelStream()` untuk request path production tanpa benchmark dan concurrency design.

### 8.4 Primitive Stream

Untuk numeric heavy path, primitive stream menghindari boxing.

```java
int sum = values.stream()
    .mapToInt(Integer::intValue)
    .sum();
```

Tetapi jika sumbernya sudah `List<Integer>`, boxing sudah terjadi. Primitive array bisa lebih cocok untuk data numerik besar.

---

## 9. String Performance

String terlihat sederhana, tetapi sering menjadi sumber allocation dan CPU cost.

### 9.1 String Immutability

`String` immutable. Operasi seperti:

```java
s = s + part;
```

dalam loop bisa menghasilkan banyak object sementara.

Buruk:

```java
String csv = "";
for (String item : items) {
    csv += item + ",";
}
```

Lebih baik:

```java
StringBuilder builder = new StringBuilder();
for (String item : items) {
    if (!builder.isEmpty()) {
        builder.append(',');
    }
    builder.append(item);
}
String csv = builder.toString();
```

Untuk Java 8, `StringBuilder` tidak punya `isEmpty()`, gunakan `builder.length() > 0`.

```java
if (builder.length() > 0) {
    builder.append(',');
}
```

### 9.2 `String.join` dan Collectors

Untuk readability:

```java
String csv = String.join(",", items);
```

atau:

```java
String csv = items.stream()
    .map(Item::code)
    .collect(Collectors.joining(","));
```

Ini sering cukup baik. Untuk hot path ekstrem, ukur.

### 9.3 Case Conversion dan Locale

Selalu eksplisit untuk case conversion yang bukan UI locale-specific.

```java
String normalized = code.toLowerCase(Locale.ROOT);
```

Ini correctness + performance predictability. Locale default bisa menyebabkan behavior aneh.

### 9.4 Regex Cost

Buruk:

```java
boolean valid = value.matches("[A-Z]{3}-\\d{6}");
```

`String.matches` compile pattern setiap panggilan.

Lebih baik untuk hot path:

```java
private static final Pattern CASE_NO_PATTERN = Pattern.compile("[A-Z]{3}-\\d{6}");

boolean valid = CASE_NO_PATTERN.matcher(value).matches();
```

Tetapi jangan compile semua pattern global jika jarang dipakai dan startup/memory penting. Pilih sesuai workload.

### 9.5 Substring dan Copy

Modern Java tidak lagi membuat substring yang berbagi backing array seperti era lama. Ini mencegah retention besar, tetapi substring tetap membuat string baru/copy relevan.

Implikasi:

- parsing banyak substring bisa allocation-heavy,
- gunakan parser yang bekerja dengan index/char sequence untuk hot path jika terbukti perlu,
- jangan premature.

---

## 10. Logging Performance

Logging adalah observability, tetapi logging juga bisa menjadi bottleneck.

### 10.1 Parameterized Logging

Buruk:

```java
log.debug("User " + userId + " loaded with roles " + roles);
```

String dibangun walaupun debug disabled.

Lebih baik:

```java
log.debug("User {} loaded with roles {}", userId, roles);
```

SLF4J mendukung parameterized logging untuk menghindari unnecessary string construction ketika level disabled.

### 10.2 Expensive Argument Problem

Parameterized logging tidak otomatis mencegah evaluasi argument mahal.

```java
log.debug("Payload summary {}", expensiveSummary(payload));
```

`expensiveSummary(payload)` tetap dieksekusi sebelum method call.

Gunakan guard:

```java
if (log.isDebugEnabled()) {
    log.debug("Payload summary {}", expensiveSummary(payload));
}
```

SLF4J 2 fluent API juga bisa membantu supplier-style tergantung framework/version, tetapi kompatibilitas Java 8/legacy logging perlu dicek.

### 10.3 Logging in Hot Loop

Buruk:

```java
for (Item item : items) {
    log.info("Processing item {}", item.id());
    process(item);
}
```

Masalah:

- IO overhead,
- lock/queue contention,
- huge log volume,
- cost formatting,
- observability noise,
- storage cost,
- PII/security risk.

Lebih baik:

```java
int success = 0;
int failed = 0;
for (Item item : items) {
    try {
        process(item);
        success++;
    } catch (Exception ex) {
        failed++;
        log.warn("Failed processing item id={} reason={}", item.id(), ex.toString());
    }
}
log.info("Batch completed success={} failed={}", success, failed);
```

### 10.4 Async Logging

Async logging bisa mengurangi request thread blocking, tetapi punya trade-off:

- queue memory,
- log loss risk saat crash,
- backpressure/drop policy,
- latency hidden bukan hilang,
- ordering semantics.

Untuk audit/compliance event, jangan asal async-drop.

### 10.5 Logging Checklist

```text
[ ] Apakah log level sesuai?
[ ] Apakah argument mahal dilindungi guard/supplier?
[ ] Apakah log di loop menghasilkan volume besar?
[ ] Apakah log mengandung PII/secrets?
[ ] Apakah error log mencetak stack trace berulang?
[ ] Apakah async logging punya policy saat queue penuh?
[ ] Apakah audit log tidak bisa hilang?
[ ] Apakah structured logging dipakai untuk queryability?
```

---

## 11. Exception Performance

Exception mahal terutama karena stack trace capture.

Jangan gunakan exception sebagai control flow biasa.

Buruk:

```java
try {
    return Integer.parseInt(value);
} catch (NumberFormatException ex) {
    return 0;
}
```

Jika invalid input sangat sering, ini mahal.

Lebih baik validasi ringan jika path sangat panas:

```java
static boolean isInteger(String value) {
    if (value == null || value.isEmpty()) return false;
    int start = value.charAt(0) == '-' ? 1 : 0;
    if (start == value.length()) return false;
    for (int i = start; i < value.length(); i++) {
        if (!Character.isDigit(value.charAt(i))) return false;
    }
    return true;
}
```

Tetapi jangan menulis parser manual untuk semua hal. Correctness risk tinggi.

### 11.1 Exception yang Sah

Exception sah untuk:

- unexpected failure,
- boundary error,
- invariant violation,
- external dependency failure,
- transaction failure,
- invalid state yang tidak boleh terjadi.

Tidak ideal untuk:

- expected validation failure massal,
- branch biasa,
- lookup miss normal,
- parsing invalid yang dominan.

### 11.2 Stack Trace Volume

Buruk:

```java
catch (ExternalTimeoutException ex) {
    log.error("External timeout", ex);
    throw ex;
}
```

Jika timeout ribuan kali/menit, log dan stack trace bisa memperparah incident.

Lebih baik:

```java
catch (ExternalTimeoutException ex) {
    metrics.incrementTimeout();
    log.warn("External timeout service={} correlationId={}", serviceName, correlationId);
    throw ex;
}
```

Untuk debug mendalam, sampling stack trace bisa dipakai.

---

## 12. BigDecimal, Date/Time, dan Domain Value Cost

### 12.1 BigDecimal

`BigDecimal` immutable dan allocation-heavy.

Kesalahan umum:

```java
BigDecimal amount = new BigDecimal(0.1); // bad precision
```

Gunakan:

```java
BigDecimal amount = BigDecimal.valueOf(0.1);
```

atau string untuk exact decimal:

```java
BigDecimal amount = new BigDecimal("0.10");
```

Untuk money:

- correctness lebih penting dari raw performance,
- hindari double,
- pertimbangkan representasi minor unit `long` untuk hot calculation internal jika domain memungkinkan,
- tetap expose type yang aman di boundary.

### 12.2 Date/Time

Parsing date/time mahal jika dilakukan berulang.

```java
private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ISO_LOCAL_DATE;

LocalDate date = LocalDate.parse(input, ISO_DATE);
```

`DateTimeFormatter` immutable dan thread-safe, sehingga aman disimpan static final.

Untuk `SimpleDateFormat` Java 8 legacy:

- tidak thread-safe,
- jangan static shared tanpa protection,
- prefer `java.time`.

### 12.3 Domain Value Object

Value object meningkatkan correctness. Jangan menghapus value object demi performance tanpa bukti.

Contoh baik:

```java
record CaseNumber(String value) {
    CaseNumber {
        if (value == null || !CASE_NO_PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid case number");
        }
    }
}
```

Untuk Java 8, gunakan final class.

Jika profiler membuktikan value object allocation besar, opsi:

- cache parsed representation,
- validate once at boundary,
- avoid repeated wrapping/unwrapping,
- use primitive/internal representation di hot loop,
- document trade-off.

---

## 13. Serialization Performance

Serialization sering menjadi bottleneck API, messaging, cache, dan audit.

### 13.1 JSON Binding vs Tree Model

Binding:

```java
OrderDto dto = objectMapper.readValue(json, OrderDto.class);
```

Tree model:

```java
JsonNode node = objectMapper.readTree(json);
String id = node.get("id").asText();
```

Tree model fleksibel, tetapi bisa allocation-heavy untuk payload besar.

Gunakan tree model ketika:

- schema dinamis,
- partial extraction,
- transformation fleksibel,
- validation custom.

Gunakan binding ketika:

- schema jelas,
- DTO stabil,
- typed contract penting,
- performance lebih mudah dikontrol.

### 13.2 ObjectMapper Reuse

Buruk:

```java
String json = new ObjectMapper().writeValueAsString(dto);
```

Lebih baik:

```java
private final ObjectMapper objectMapper;

String json = objectMapper.writeValueAsString(dto);
```

`ObjectMapper` mahal dibuat dan biasanya dikonfigurasi sebagai singleton/bean.

### 13.3 Reflection, Modules, Records

Jackson banyak bergantung pada introspection/reflection. Pada Java modern dengan module/strong encapsulation, configuration dan module registration penting.

Untuk Java 17+:

- records sering lebih nyaman untuk DTO immutable,
- pastikan Jackson version mendukung fitur yang dipakai,
- hindari illegal reflective access hacks,
- perhatikan native image jika relevan.

### 13.4 Afterburner / Blackbird

Jackson Afterburner historically dipakai untuk meningkatkan performance melalui bytecode generation. Untuk Java 11+ ada Blackbird yang dirancang lebih cocok dengan runtime modern. Namun gunakan module performance seperti ini dengan benchmark sendiri karena efeknya tergantung model, JVM, dan workload.

### 13.5 Serialization Checklist

```text
[ ] Apakah ObjectMapper dibuat ulang?
[ ] Apakah payload besar memakai JsonNode tanpa perlu?
[ ] Apakah field unknown/null/absent semantics jelas?
[ ] Apakah date/time format konsisten?
[ ] Apakah BigDecimal precision aman?
[ ] Apakah DTO immutable menyebabkan constructor/reflection issue?
[ ] Apakah serialization muncul di flame graph?
[ ] Apakah allocation profile menunjukkan JsonNode/char[]/byte[] dominan?
[ ] Apakah compression/encryption ikut dihitung?
[ ] Apakah benchmark memakai payload realistis?
```

---

## 14. IO Performance

IO performance bukan hanya “pakai NIO”. Yang penting adalah access pattern.

### 14.1 Buffering

Buruk:

```java
try (FileInputStream in = new FileInputStream(file)) {
    int b;
    while ((b = in.read()) != -1) {
        processByte(b);
    }
}
```

Lebih baik:

```java
try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(file))) {
    int b;
    while ((b = in.read()) != -1) {
        processByte(b);
    }
}
```

Atau read block:

```java
byte[] buffer = new byte[8192];
try (InputStream in = Files.newInputStream(path)) {
    int read;
    while ((read = in.read(buffer)) != -1) {
        process(buffer, 0, read);
    }
}
```

### 14.2 Read All vs Streaming

Buruk untuk payload besar:

```java
byte[] all = Files.readAllBytes(path);
```

Lebih aman:

```java
try (InputStream in = Files.newInputStream(path)) {
    processStream(in);
}
```

Gunakan `readAllBytes` hanya jika ukuran jelas aman.

### 14.3 Charset Cost

String/byte conversion membutuhkan charset.

```java
String text = new String(bytes, StandardCharsets.UTF_8);
byte[] out = text.getBytes(StandardCharsets.UTF_8);
```

Jangan bergantung pada default charset untuk data protocol.

### 14.4 File, Network, DB: Batasnya Bukan Java Saja

Jika hot path didominasi IO:

- optimizing collection kecil tidak berguna,
- lihat batching,
- reduce round-trip,
- connection pooling,
- timeout,
- backpressure,
- compression trade-off,
- protocol payload size,
- downstream capacity.

---

## 15. Caching Performance

Caching bisa menyelesaikan bottleneck atau membuat incident baru.

### 15.1 Cache Membeli Kecepatan dengan Kompleksitas

Cache trade-off:

```text
+ lower latency
+ lower downstream load
+ lower CPU if computation expensive

- stale data
- memory retention
- invalidation complexity
- stampede risk
- security/tenant isolation risk
- observability complexity
```

### 15.2 Local Cache

```java
Cache<Key, PermissionDecision> cache = Caffeine.newBuilder()
    .maximumSize(100_000)
    .expireAfterWrite(Duration.ofMinutes(5))
    .build(this::loadPermission);
```

Pertanyaan desain:

- key mencakup tenant/user/role/module?
- TTL aman secara compliance?
- eviction policy sesuai?
- apakah negative result di-cache?
- apakah cache per node acceptable?
- bagaimana invalidasi?
- apakah cache hit ratio diukur?
- apakah memory budget cukup?

### 15.3 Cache Stampede

Anti-pattern:

```java
if (!cache.containsKey(key)) {
    cache.put(key, loadExpensive(key));
}
return cache.get(key);
```

Race bisa membuat banyak thread load bersamaan.

Lebih baik gunakan atomic loading cache atau `computeIfAbsent`, dengan caveat blocking/exception.

### 15.4 Cache Checklist

```text
[ ] Apa cost yang dihindari cache?
[ ] Apakah hit ratio dipantau?
[ ] Apakah cache bounded?
[ ] Apakah TTL benar secara domain?
[ ] Apakah invalidation jelas?
[ ] Apakah key mengandung tenant/security dimension?
[ ] Apakah value immutable?
[ ] Apakah stampede dicegah?
[ ] Apakah memory overhead dihitung?
[ ] Apakah failure load function aman?
```

---

## 16. Performance Engineering pada Mapper dan DTO

Enterprise Java sering punya banyak mapping:

```text
Entity -> Domain -> DTO -> JSON
JSON -> DTO -> Command -> Domain
DB row -> Entity -> Projection
```

Mapping cost berasal dari:

- allocation DTO,
- reflection,
- collection transformation,
- nested graph traversal,
- lazy loading/N+1,
- string/date conversion,
- null handling,
- defensive copy.

### 16.1 Manual Mapper

```java
CaseDto toDto(CaseEntity entity) {
    return new CaseDto(
        entity.getId(),
        entity.getCaseNo(),
        entity.getStatus().name(),
        entity.getCreatedAt()
    );
}
```

Keuntungan:

- explicit,
- compile-time safe,
- easy to profile,
- low magic.

Kekurangan:

- verbose,
- repetitive,
- human error.

### 16.2 Reflection Mapper

Mapper berbasis reflection mengurangi boilerplate, tetapi bisa:

- lambat di hot path,
- sulit diprofiling,
- menyembunyikan field mapping,
- bermasalah dengan modules/records,
- membuat runtime failure.

### 16.3 Codegen Mapper

MapStruct-style mapper biasanya baik untuk enterprise karena compile-time generated.

Tetapi tetap cek:

- nested mapping,
- collection mapping,
- null strategy,
- date conversion,
- lazy relation,
- update existing target vs new target.

### 16.4 Projection Lebih Baik daripada Mapping Semua

Buruk:

```java
List<CaseEntity> cases = repository.findAll();
return cases.stream().map(this::toListDto).toList();
```

Lebih baik:

```java
List<CaseListProjection> cases = repository.findCaseList(filters);
```

Jika list screen hanya butuh 8 fields, jangan load 80 fields + relations.

Ini bukan hanya performance, tapi juga memory, DB, network, dan serialization.

---

## 17. Hot Path vs Cold Path

Tidak semua kode layak dioptimalkan.

### Hot Path

Ciri:

- dipanggil sangat sering,
- ada di request critical path,
- muncul di flame graph,
- allocation besar,
- mempengaruhi p95/p99,
- berdampak pada CPU/cloud cost,
- berada di batch besar.

### Cold Path

Ciri:

- jarang dipanggil,
- admin-only,
- startup-only,
- error path jarang,
- migration one-off,
- test utility.

Rule:

```text
Optimize hot path for measured performance.
Optimize cold path for clarity and safety.
```

Namun ada exception: cold error path yang saat incident dipanggil massal bisa menjadi hot. Contoh: stack trace logging saat downstream timeout.

---

## 18. Micro-Optimization Decision Framework

Sebelum mengubah kode readable menjadi kode lebih kompleks, jawab ini:

```text
1. Apakah path ini terbukti bottleneck?
2. Apakah cost-nya CPU, allocation, IO, lock, atau retention?
3. Apakah optimization memperbaiki cost yang benar?
4. Apakah ada benchmark/profiler before-after?
5. Apakah correctness tetap jelas?
6. Apakah readability turun signifikan?
7. Apakah ada komentar yang menjelaskan alasan performance?
8. Apakah optimization sensitif terhadap Java version?
9. Apakah failure mode baru muncul?
10. Apakah regression bisa dicegah?
```

Jika jawabannya tidak jelas, jangan optimasi dulu.

---

## 19. Patterns: Dari Buruk ke Lebih Baik

### 19.1 Avoid Repeated Remote Call in Loop

Buruk:

```java
for (Case c : cases) {
    User user = userClient.getUser(c.ownerId());
    result.add(toDto(c, user));
}
```

Lebih baik:

```java
Set<String> ownerIds = cases.stream()
    .map(Case::ownerId)
    .collect(Collectors.toSet());

Map<String, User> users = userClient.getUsers(ownerIds);

for (Case c : cases) {
    result.add(toDto(c, users.get(c.ownerId())));
}
```

Ini bukan micro-optimization. Ini mengubah complexity dari N remote calls menjadi 1/batched calls.

### 19.2 Avoid Repeated Regex Compilation

Buruk:

```java
boolean ok = input.matches("[A-Z]{2}[0-9]{6}");
```

Lebih baik:

```java
private static final Pattern REF_PATTERN = Pattern.compile("[A-Z]{2}[0-9]{6}");

boolean ok = REF_PATTERN.matcher(input).matches();
```

### 19.3 Avoid Huge Intermediate Result

Buruk:

```java
List<Event> all = repository.findAllEvents();
List<Event> recent = all.stream()
    .filter(e -> e.createdAt().isAfter(cutoff))
    .toList();
```

Lebih baik:

```java
List<Event> recent = repository.findEventsCreatedAfter(cutoff);
```

Push filtering to storage if storage can do it efficiently and correctly.

### 19.4 Avoid Per-Item ObjectMapper

Buruk:

```java
for (Message message : messages) {
    ObjectMapper mapper = new ObjectMapper();
    Event event = mapper.readValue(message.body(), Event.class);
    handle(event);
}
```

Lebih baik:

```java
for (Message message : messages) {
    Event event = objectMapper.readValue(message.body(), Event.class);
    handle(event);
}
```

### 19.5 Avoid Exception Control Flow in Bulk Validation

Buruk:

```java
for (String raw : inputs) {
    try {
        ids.add(UUID.fromString(raw));
    } catch (IllegalArgumentException ignored) {
        invalid++;
    }
}
```

If invalid is common, consider prevalidation or structured parser. If invalid is rare, this may be acceptable.

---

## 20. JMH Mini Examples

### 20.1 Benchmark String Regex Compile vs Reuse

```java
@State(Scope.Thread)
public class RegexBenchmark {
    private static final Pattern PRECOMPILED = Pattern.compile("[A-Z]{3}-\\d{6}");

    @Param({"ABC-123456", "bad-value"})
    public String input;

    @Benchmark
    public boolean stringMatches() {
        return input.matches("[A-Z]{3}-\\d{6}");
    }

    @Benchmark
    public boolean precompiledPattern() {
        return PRECOMPILED.matcher(input).matches();
    }
}
```

Yang diukur:

- regex compilation cost,
- matcher allocation,
- match cost.

Jangan extrapolate ke semua regex. Pattern complexity dan input distribution penting.

### 20.2 Benchmark HashMap Pre-size

```java
@State(Scope.Thread)
public class MapBuildBenchmark {
    @Param({"10", "1000", "100000"})
    public int size;

    private List<String> keys;

    @Setup
    public void setup() {
        keys = new ArrayList<>(size);
        for (int i = 0; i < size; i++) {
            keys.add("key-" + i);
        }
    }

    @Benchmark
    public Map<String, Integer> defaultHashMap() {
        Map<String, Integer> map = new HashMap<>();
        for (int i = 0; i < keys.size(); i++) {
            map.put(keys.get(i), i);
        }
        return map;
    }

    @Benchmark
    public Map<String, Integer> presizedHashMap() {
        Map<String, Integer> map = new HashMap<>((int) (size / 0.75f) + 1);
        for (int i = 0; i < keys.size(); i++) {
            map.put(keys.get(i), i);
        }
        return map;
    }
}
```

Interpretasi:

- Untuk size kecil, beda mungkin noise.
- Untuk size besar, resize reduction bisa signifikan.
- Allocation profile penting.

### 20.3 Benchmark Loop vs Stream

```java
@State(Scope.Thread)
public class LoopVsStreamBenchmark {
    @Param({"10", "1000", "100000"})
    public int size;

    private List<Integer> values;

    @Setup
    public void setup() {
        values = new ArrayList<>(size);
        for (int i = 0; i < size; i++) {
            values.add(i);
        }
    }

    @Benchmark
    public long loopSumEven() {
        long sum = 0;
        for (Integer value : values) {
            if ((value & 1) == 0) {
                sum += value;
            }
        }
        return sum;
    }

    @Benchmark
    public long streamSumEven() {
        return values.stream()
            .filter(v -> (v & 1) == 0)
            .mapToLong(Integer::longValue)
            .sum();
    }
}
```

Gunakan benchmark ini untuk belajar, bukan untuk membuat aturan universal “loop always faster”.

---

## 21. Production Investigation Example

### Symptom

Endpoint `/cases/search` mengalami:

```text
p50 120 ms -> 150 ms
p95 700 ms -> 2.5 s
p99 1.2 s -> 6 s
CPU 65%
GC minor frequency naik
DB query time normal
```

### Evidence

JFR menunjukkan:

- allocation tinggi di mapper list result,
- banyak `String.toLowerCase`,
- banyak `HashMap.resize`,
- JSON serialization besar,
- log debug payload masih membangun summary walau debug disabled.

### Bad Fix

```text
Increase heap.
```

Ini mungkin mengurangi GC frequency sementara, tapi tidak mengatasi allocation source.

### Better Fixes

1. Push projection ke DB agar tidak load full entity.
2. Pre-size result list dan maps berdasarkan page size.
3. Normalize searchable field saat write, bukan saat setiap read.
4. Guard expensive debug logging.
5. Reduce response payload fields.
6. Add benchmark untuk mapper hot path.
7. Add load test untuk `/cases/search` dengan realistic filter/page distribution.

### Validation

```text
Allocation rate turun 45%.
Minor GC frequency turun.
p95 turun dari 2.5s ke 850ms.
p99 turun dari 6s ke 1.7s.
CPU turun 65% ke 48%.
Response size turun 35%.
```

Catatan: angka di atas contoh format report, bukan klaim universal.

---

## 22. Anti-Pattern Performance Engineering

### 22.1 Optimizing Without Profiling

```text
“Saya rasa stream lambat, ganti semua ke loop.”
```

Masalah:

- tidak evidence-based,
- bisa merusak readability,
- bottleneck mungkin DB/network/serialization,
- perubahan besar sulit divalidasi.

### 22.2 Optimizing Only Average Latency

Average latency bisa membaik sementara p99 memburuk.

Contoh:

- batching terlalu besar,
- cache lock contention,
- async queue backlog,
- GC pause lebih jarang tapi lebih besar.

### 22.3 Caching Everything

Cache tanpa bounded size/TTL/invalidation adalah memory leak yang diberi nama bagus.

### 22.4 Reusing Mutable Objects Everywhere

Object reuse bisa menghasilkan data corruption dan thread-safety bugs.

### 22.5 Replacing Clarity with Cleverness

Kode performance-sensitive boleh lebih rendah-level, tetapi harus:

- terbukti perlu,
- dilokalisasi,
- diberi komentar alasan,
- punya test correctness,
- punya benchmark/regression evidence.

### 22.6 Ignoring Allocation Because “GC is Fast”

GC modern cepat, tetapi allocation rate ekstrem tetap memengaruhi:

- CPU,
- memory bandwidth,
- cache locality,
- pause/safepoint,
- container headroom,
- cloud cost.

---

## 23. Code Review Checklist untuk Performance-Sensitive Java

Gunakan checklist ini hanya untuk kode yang berada di hot path atau critical path.

```text
Data Structure
[ ] Apakah collection sesuai access pattern?
[ ] Apakah collection besar di-pre-size?
[ ] Apakah ada conversion collection yang tidak perlu?
[ ] Apakah key map immutable dan hashCode stabil?

Allocation
[ ] Apakah ada temporary object besar?
[ ] Apakah ada boxing/unboxing dalam loop besar?
[ ] Apakah ada DTO/mapper berlapis yang tidak perlu?
[ ] Apakah batch menahan semua data di memory?

String/Regex
[ ] Apakah string concat dalam loop aman?
[ ] Apakah regex compile berulang?
[ ] Apakah Locale eksplisit?
[ ] Apakah charset eksplisit?

Logging/Exception
[ ] Apakah expensive logging dilindungi guard?
[ ] Apakah log di hot loop dibatasi?
[ ] Apakah exception dipakai untuk control flow?
[ ] Apakah stack trace spam mungkin terjadi saat incident?

Serialization/IO
[ ] Apakah ObjectMapper reused?
[ ] Apakah payload besar di-stream jika perlu?
[ ] Apakah JSON tree model diperlukan?
[ ] Apakah IO buffered?
[ ] Apakah remote call dalam loop dibatching?

Caching
[ ] Apakah cache bounded?
[ ] Apakah TTL/invalidation jelas?
[ ] Apakah cache key aman untuk tenant/security?
[ ] Apakah stampede dicegah?

Evidence
[ ] Apakah profiler menunjukkan path ini penting?
[ ] Apakah benchmark representatif?
[ ] Apakah before/after dibandingkan?
[ ] Apakah correctness test tersedia?
```

---

## 24. Top 1% Engineer Notes

Engineer kuat bukan yang hafal trik micro-optimization terbanyak. Engineer kuat adalah yang bisa menghubungkan:

```text
source code shape
  -> JVM behavior
  -> runtime metrics
  -> user-visible latency
  -> operational risk
  -> maintainability trade-off
```

Beberapa prinsip praktis:

1. **Hot path deserves evidence.**  
   Jangan debat style kalau profiler belum bicara.

2. **Allocation is a throughput and latency budget.**  
   Object kecil murah, tapi jutaan object per detik bukan gratis.

3. **Collections are algorithms plus memory layout.**  
   Big-O saja tidak cukup. Locality, allocation, hashing, and resizing matter.

4. **Serialization is often business logic hidden as infrastructure.**  
   Payload shape, null semantics, date format, BigDecimal precision, and compatibility matter.

5. **Logging is production behavior.**  
   Logging bisa menyelamatkan incident atau memperparah incident.

6. **Cache is a distributed systems decision.**  
   Even local cache has consistency, memory, and invalidation consequences.

7. **Readability is a performance feature.**  
   Kode yang mudah dipahami lebih mudah dioptimalkan dengan aman saat evidence muncul.

8. **The fastest code is often the code not executed.**  
   Avoid repeated remote calls, unnecessary DB loads, unnecessary serialization, and unnecessary conversions.

---

## 25. Summary

Part ini membahas performance engineering pada bentuk kode Java.

Key takeaways:

- Jangan mulai dari trik; mulai dari evidence.
- Allocation murah, tetapi allocation rate tinggi tetap bisa mahal.
- Object reuse manual sering lebih berbahaya daripada membantu.
- Collections harus dipilih berdasarkan access pattern dan memory behavior.
- Stream vs loop bukan agama; ukur pada workload nyata.
- String, regex, logging, exception, serialization, dan IO sering menjadi sumber cost tersembunyi.
- Cache mempercepat dengan menambah kompleksitas.
- Optimization harus dilokalisasi, diuji, diukur, dan didokumentasikan.

Part berikutnya akan naik dari kode lokal ke service-level performance:

```text
Part 029 — Performance Engineering for Services: Thread Pool, Connection Pool, Backpressure, Timeout
```

---

## 26. Referensi

- Oracle Java SE 25 Garbage Collection Tuning Guide: https://docs.oracle.com/en/java/javase/25/gctuning/
- Oracle Java SE 25 Documentation: https://docs.oracle.com/en/java/javase/25/
- OpenJDK JOL: https://openjdk.org/projects/code-tools/jol/
- OpenJDK JMH: https://openjdk.org/projects/code-tools/jmh/
- async-profiler: https://github.com/async-profiler/async-profiler
- SLF4J Manual: https://www.slf4j.org/manual.html
- SLF4J FAQ: https://www.slf4j.org/faq.html
- Jackson Blackbird: https://github.com/stevenschlansker/jackson-blackbird
- FasterXML Jackson: https://github.com/FasterXML/jackson

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-027](./learn-java-testing-benchmarking-performance-jvm-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-029](./learn-java-testing-benchmarking-performance-jvm-part-029.md)
