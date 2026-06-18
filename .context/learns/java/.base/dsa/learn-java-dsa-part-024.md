# Learn Java Data Structure and Algorithm — Part 024

## Caching Data Structures: LRU, LFU, TTL, Windowed Cache

> Seri: `learn-java-dsa`  
> Part: `024 / 030`  
> Topik: caching data structures, eviction policy, expiration, stampede control, negative caching, in-flight deduplication, Java implementation trade-off  
> Prasyarat: hash table, linked structures, heap/priority queue, queue/deque, time-window thinking, equality/hash contract, basic concurrency semantics

---

## 0. Tujuan Bagian Ini

Di banyak sistem Java, cache sering diperlakukan terlalu sederhana:

```java
Map<Key, Value> cache = new HashMap<>();
```

Lalu dianggap selesai.

Padahal cache yang benar bukan hanya `Map`. Cache adalah kombinasi dari:

1. **index** untuk lookup cepat,
2. **policy** untuk memutuskan data mana yang boleh tetap hidup,
3. **time model** untuk menentukan kapan data dianggap stale,
4. **memory budget** untuk mencegah unbounded growth,
5. **concurrency control** untuk mencegah stampede,
6. **correctness contract** agar data yang dikembalikan tidak salah,
7. **observability** agar perilaku cache bisa dipahami di production.

Part ini bertujuan membuat kamu tidak hanya bisa “pakai cache”, tetapi bisa **mendesain cache sebagai data structure**.

Setelah menyelesaikan part ini, kamu harus mampu:

- membedakan cache, memoization, index, snapshot, dan materialized view;
- mendesain cache key yang benar;
- memahami LRU, LFU, TTL, refresh, windowed cache, dan negative caching;
- mengimplementasikan bounded LRU cache sederhana dengan `LinkedHashMap`;
- memahami kenapa cache manual sering gagal di concurrency;
- memahami cache stampede dan in-flight deduplication;
- memilih antara `LinkedHashMap`, `ConcurrentHashMap`, custom cache, Guava Cache, dan Caffeine;
- membaca failure mode cache dalam sistem production.

---

## 1. Cache Bukan Sekadar Map

Secara paling dasar, cache menyimpan hasil dari operasi mahal agar request berikutnya bisa lebih cepat.

```text
request -> key -> cache lookup
                | hit  -> return cached value
                | miss -> load from source -> store -> return
```

Tapi definisi itu masih terlalu dangkal.

Cache yang benar harus menjawab pertanyaan berikut:

| Pertanyaan | Kenapa penting |
|---|---|
| Apa key-nya? | Key salah menghasilkan data salah. |
| Apa value-nya? | Value terlalu besar membuat memory pressure. |
| Berapa lama value valid? | Data stale bisa membuat keputusan bisnis salah. |
| Berapa banyak entry boleh disimpan? | Tanpa batas, cache berubah menjadi memory leak. |
| Siapa yang boleh mutate value? | Mutable cached object bisa rusak lintas request. |
| Bagaimana kalau load gagal? | Error bisa di-cache atau tidak, tergantung strategi. |
| Bagaimana kalau banyak thread miss key yang sama? | Bisa terjadi cache stampede. |
| Bagaimana eviction dilakukan? | Policy menentukan hit rate dan latency. |
| Bagaimana cache diamati? | Tanpa metrics, cache hanya asumsi. |

Mental model penting:

> **Cache adalah data structure dengan lifecycle policy.**

`Map` hanya menyelesaikan lookup. Ia belum menyelesaikan eviction, expiration, refresh, concurrency, correctness, dan observability.

---

## 2. Cache vs Memoization vs Index vs Snapshot

Sebelum mendesain cache, pisahkan empat konsep yang sering dicampur.

### 2.1 Cache

Cache adalah penyimpanan sementara untuk mempercepat akses ke data yang sumber kebenarannya berada di tempat lain.

Contoh:

- external API response cache;
- token cache;
- configuration lookup cache;
- postal-code-to-address cache;
- computed eligibility result cache.

Karakter:

- boleh expired;
- boleh evicted;
- bisa stale;
- sumber kebenaran bukan cache.

### 2.2 Memoization

Memoization adalah cache untuk pure/semi-pure function.

```text
f(input) -> output
```

Jika input sama dan fungsi deterministik, output bisa disimpan.

Contoh:

- parsing expression;
- compiling regex-like rule;
- computing derived metadata from immutable config;
- dynamic programming memo table.

Karakter:

- biasanya tidak butuh TTL jika input immutable;
- correctness bergantung pada determinism;
- key harus merepresentasikan seluruh input function.

### 2.3 Index

Index adalah struktur data untuk mempercepat query atas dataset yang kamu miliki.

Contoh:

```java
Map<CaseStatus, List<CaseId>> casesByStatus;
NavigableMap<Instant, List<CaseId>> casesByDeadline;
Map<UserId, Set<CaseId>> casesByAssignee;
```

Karakter:

- bukan data sementara;
- harus konsisten dengan source data;
- update index adalah bagian dari write path;
- stale index biasanya bug, bukan acceptable cache behavior.

### 2.4 Snapshot

Snapshot adalah representasi immutable dari state pada waktu tertentu.

Contoh:

- workflow definition version;
- rule engine configuration snapshot;
- feature flag snapshot;
- authorization matrix snapshot.

Karakter:

- immutable;
- bisa diganti atomically;
- sering dipakai untuk safe sharing antar thread;
- bukan eviction-oriented.

### 2.5 Kesimpulan

| Struktur | Source of truth? | Bisa stale? | Bisa evicted? | Fokus utama |
|---|---:|---:|---:|---|
| Cache | Tidak | Ya | Ya | latency/memory trade-off |
| Memoization | Tidak, tetapi fungsi deterministik | Biasanya tidak | Bisa | avoid recomputation |
| Index | Sering bagian dari source model | Tidak boleh tanpa kontrol | Tidak lazim | query speed |
| Snapshot | Representasi state valid | Valid untuk versinya | Diganti versi baru | consistency/safe sharing |

Banyak bug terjadi karena engineer memperlakukan cache seperti index, atau memperlakukan index seperti cache.

---

## 3. Anatomy of a Cache

Cache production-grade biasanya memiliki komponen konseptual berikut:

```text
                 +---------------------+
request key ---> | key canonicalization |
                 +----------+----------+
                            |
                            v
                 +---------------------+
                 | lookup index         |  usually hash table
                 +----------+----------+
                            |
              hit? yes -----+----- no
                 |                  |
                 v                  v
       +----------------+    +----------------+
       | freshness check|    | load/coalesce  |
       +-------+--------+    +-------+--------+
               |                     |
               v                     v
       +---------------+     +----------------+
       | return value  |     | insert/update  |
       +---------------+     +-------+--------+
                                      |
                                      v
                              +---------------+
                              | eviction      |
                              +---------------+
```

Minimal cache state:

```java
record Entry<V>(
    V value,
    long writeTimeNanos,
    long accessTimeNanos,
    long hitCount,
    long weight
) {}
```

Tidak semua cache butuh semua field, tetapi field tersebut menunjukkan bahwa cache entry biasanya bukan sekadar value.

---

## 4. Cache Key Correctness

Cache key adalah bagian paling penting dari cache.

Kalimat kerasnya:

> **Cache dengan key yang salah lebih buruk daripada tidak pakai cache.**

Tanpa cache, sistem mungkin lambat. Dengan key salah, sistem bisa cepat mengembalikan jawaban yang salah.

### 4.1 Key Harus Mewakili Semua Variabel yang Mempengaruhi Value

Misalnya API address lookup:

```text
getAddress(postalCode, locale, sourceVersion)
```

Jika cache key hanya `postalCode`, maka response untuk locale/source version lain bisa salah.

Key buruk:

```java
String key = postalCode;
```

Key lebih benar:

```java
record AddressCacheKey(
    String postalCode,
    Locale locale,
    String providerVersion
) {}
```

Jika value dipengaruhi oleh tenant, role, agency, feature flag, effective date, atau user permission, semua dimensi itu harus dipertimbangkan.

### 4.2 Key Harus Stabil

Key untuk hash-based cache harus memiliki `equals` dan `hashCode` yang stabil selama berada di cache.

Buruk:

```java
final class MutableKey {
    String agency;
    String code;

    @Override
    public boolean equals(Object o) { /* based on agency + code */ }

    @Override
    public int hashCode() { /* based on agency + code */ }
}
```

Jika `agency` atau `code` berubah setelah key masuk `HashMap`, entry bisa menjadi tidak bisa ditemukan lagi.

Gunakan immutable key:

```java
public record RuleCacheKey(
    String agencyCode,
    String ruleCode,
    LocalDate effectiveDate
) {}
```

Record cocok untuk cache key karena secara default menyediakan `equals`, `hashCode`, dan `toString` berdasarkan component, selama component-nya sendiri stabil.

### 4.3 Key Harus Canonical

Input berbeda bisa merepresentasikan hal yang sama.

Contoh postal code:

```text
"123456"
" 123456 "
"123 456"
```

Jika semua disimpan sebagai key berbeda, hit rate turun dan memory naik.

Canonicalization:

```java
static String canonicalPostalCode(String input) {
    String digits = input.replaceAll("\\D", "");
    if (digits.length() != 6) {
        throw new IllegalArgumentException("postal code must contain exactly 6 digits");
    }
    return digits;
}
```

Namun hati-hati. Canonicalization tidak boleh menghapus informasi yang sebenarnya bermakna.

### 4.4 Key Tidak Boleh Terlalu Besar

Key besar meningkatkan memory cost dan lookup cost.

Buruk:

```java
record HugeKey(RequestDto fullRequest) {}
```

Lebih baik:

```java
record EligibilityKey(
    String applicantType,
    String licenceType,
    String agencyCode,
    LocalDate asOfDate
) {}
```

Gunakan key yang merepresentasikan dimensi penentu value, bukan seluruh object graph.

### 4.5 Key Harus Aman dari Data Sensitif

Jika cache key dicatat di metrics/log, jangan memasukkan PII mentah.

Buruk:

```java
record Key(String nric, String fullName, LocalDate dob) {}
```

Lebih aman:

```java
record Key(String applicantType, String ruleVersion, String normalizedCategory) {}
```

Atau gunakan hash/tokenisasi jika memang perlu, dengan governance yang jelas.

---

## 5. Cache Value Correctness

Value cache juga punya risiko.

### 5.1 Jangan Cache Mutable Object yang Bisa Dimodifikasi Caller

Buruk:

```java
class ConfigCache {
    private final Map<String, List<Rule>> cache = new HashMap<>();

    List<Rule> getRules(String agency) {
        return cache.get(agency); // caller bisa add/remove
    }
}
```

Lebih aman:

```java
class ConfigCache {
    private final Map<String, List<Rule>> cache = new HashMap<>();

    List<Rule> getRules(String agency) {
        return List.copyOf(cache.getOrDefault(agency, List.of()));
    }
}
```

Lebih baik lagi: simpan value immutable sejak awal.

```java
record RuleSnapshot(List<Rule> rules) {
    RuleSnapshot {
        rules = List.copyOf(rules);
    }
}
```

### 5.2 Value Bisa Terlalu Mahal Secara Memory

Misalnya cache menyimpan full response object dengan nested list besar, padahal hanya field tertentu yang dipakai.

Pertanyaan desain:

- Apakah perlu cache raw response?
- Apakah cukup cache derived compact value?
- Apakah perlu cache ID list, bukan full entity?
- Apakah value perlu compression?
- Apakah perlu weight-based eviction, bukan count-based eviction?

### 5.3 Value Bisa Menahan Reference Besar

Contoh bug:

```java
record CachedResult(RequestContext context, Result result) {}
```

Jika `RequestContext` memegang user/session/request body, cache akan menahan object graph besar dan sensitif.

Cache value harus minimal.

---

## 6. Eviction vs Expiration

Dua konsep ini sering tertukar.

### 6.1 Eviction

Eviction berarti entry dikeluarkan karena policy kapasitas atau prioritas.

Contoh alasan:

- cache sudah mencapai `maximumSize`;
- cache sudah mencapai `maximumWeight`;
- entry jarang dipakai;
- entry paling lama tidak diakses;
- memory pressure;
- manual invalidation.

Eviction menjawab:

> “Entry mana yang harus dikorbankan ketika cache terlalu penuh?”

### 6.2 Expiration

Expiration berarti entry dianggap tidak valid setelah kondisi waktu tertentu.

Contoh:

- expire after write 5 menit;
- expire after access 30 menit;
- token expires at specific instant;
- rule config valid sampai version berubah;
- address provider response valid selama 24 jam.

Expiration menjawab:

> “Entry ini masih boleh dipercaya atau sudah stale?”

### 6.3 Kombinasi

Cache production sering memakai keduanya:

```text
maximumSize = 10_000
expireAfterWrite = 10 minutes
```

Artinya:

- entry bisa keluar karena cache terlalu besar;
- entry juga bisa invalid karena umur sudah lewat.

---

## 7. LRU Cache

LRU berarti **Least Recently Used**.

Entry yang paling lama tidak diakses akan dikeluarkan lebih dulu.

### 7.1 Mental Model

```text
least recent                                  most recent
    A <-> B <-> C <-> D <-> E
```

Jika `B` diakses:

```text
A <-> C <-> D <-> E <-> B
```

Jika cache penuh dan entry baru `F` masuk, `A` dikeluarkan:

```text
C <-> D <-> E <-> B <-> F
```

### 7.2 Data Structure LRU

LRU klasik butuh dua struktur:

1. `HashMap<K, Node<K,V>>` untuk lookup `O(1)`;
2. doubly linked list untuk memindahkan node ke posisi most-recent `O(1)`.

```text
HashMap:
  K -> Node

Linked list:
  least <-> ... <-> most
```

Operation:

| Operation | Cost |
|---|---:|
| get | `O(1)` average |
| put existing | `O(1)` average |
| put new not full | `O(1)` average |
| put new full | `O(1)` average + evict tail/head |

### 7.3 LRU dengan LinkedHashMap

Java `LinkedHashMap` bisa menjaga insertion order atau access order. Constructor dengan `accessOrder = true` membuat encounter order berdasarkan akses dari least-recently accessed ke most-recently accessed. Dokumentasi Java juga menyebut `removeEldestEntry` bisa dioverride untuk menghapus mapping tua secara otomatis ketika mapping baru ditambahkan. Ini membuat `LinkedHashMap` cocok untuk LRU kecil/sederhana.

Implementasi sederhana:

```java
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

public final class LruCache<K, V> {
    private final int maxSize;
    private final LinkedHashMap<K, V> map;

    public LruCache(int maxSize) {
        if (maxSize <= 0) {
            throw new IllegalArgumentException("maxSize must be positive");
        }
        this.maxSize = maxSize;
        this.map = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > LruCache.this.maxSize;
            }
        };
    }

    public synchronized V get(K key) {
        Objects.requireNonNull(key, "key");
        return map.get(key);
    }

    public synchronized void put(K key, V value) {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(value, "value");
        map.put(key, value);
    }

    public synchronized boolean containsKey(K key) {
        Objects.requireNonNull(key, "key");
        return map.containsKey(key);
    }

    public synchronized int size() {
        return map.size();
    }

    public synchronized Map<K, V> snapshot() {
        return Map.copyOf(map);
    }
}
```

Catatan:

- Ini cukup untuk cache kecil, single-JVM, low-contention.
- `synchronized` membuat semua operasi serialized.
- Tidak ada TTL.
- Tidak ada loader.
- Tidak ada metrics.
- Tidak ada weight.
- Tidak ada stampede protection.

### 7.4 Kenapa `get` Bisa Mengubah Struktur?

Dalam access-order `LinkedHashMap`, `get` dianggap access dan dapat memindahkan entry ke posisi most-recent.

Konsekuensi:

- `get` bukan operasi purely read secara struktural;
- di multithread context, access-order map butuh synchronization;
- iterator bisa fail-fast jika struktur berubah selama iterasi;
- cache read bisa punya write-like side effect.

Ini detail penting yang sering terlewat.

### 7.5 LRU Tidak Selalu Optimal

LRU bagus jika item yang baru dipakai cenderung akan dipakai lagi dalam waktu dekat.

Buruk untuk workload scan:

```text
cache size = 3
access pattern = A B C D E F G A B C
```

Setiap item lama tersapu oleh scan panjang. Ini disebut cache pollution.

LRU juga bisa buruk jika ada item yang sering dipakai tetapi sempat tidak diakses karena burst workload.

---

## 8. LFU Cache

LFU berarti **Least Frequently Used**.

Entry dengan frekuensi akses paling rendah dikeluarkan lebih dulu.

### 8.1 Mental Model

```text
A hits = 100
B hits = 5
C hits = 2
D hits = 1  <-- evict first
```

LFU cocok jika popularitas item relatif stabil.

### 8.2 Problem LFU Naif

Jika hanya menyimpan counter, item lama bisa “menang selamanya”.

Contoh:

- `A` populer kemarin dan punya hit count 1.000.000;
- hari ini `A` tidak relevan lagi;
- item baru sulit menggusur `A` karena counter besar.

Karena itu LFU production sering memakai:

- aging;
- decay;
- windowed frequency;
- approximate frequency sketch;
- kombinasi recency + frequency.

### 8.3 Data Structure LFU Klasik

LFU `O(1)` biasanya menggunakan:

1. `Map<K, Node>` untuk lookup;
2. `Map<Frequency, DoublyLinkedList<Node>>` untuk bucket frekuensi;
3. `minFrequency` untuk tahu bucket eviction.

```text
freq 1: [D, E]
freq 2: [C]
freq 5: [B]
freq 100: [A]
```

Saat key diakses:

```text
remove from freq f
add to freq f+1
```

Tie-breaker biasanya LRU dalam frequency bucket.

### 8.4 Kapan LFU Lebih Baik dari LRU?

LFU lebih cocok untuk:

- reference data yang popularitasnya stabil;
- config/rule lookup dengan hot keys tertentu;
- content/catalog lookup;
- expensive computation dengan repeated hot subset.

LRU lebih cocok untuk:

- temporal locality tinggi;
- session-like workload;
- recent activity;
- short-lived burst.

### 8.5 Trade-off

| Policy | Kelebihan | Kekurangan |
|---|---|---|
| LRU | sederhana, recency-aware | lemah terhadap scan pollution |
| LFU | menjaga hot item | butuh aging/decay, lebih kompleks |
| FIFO | sangat sederhana | tidak memperhatikan recency/frequency |
| Random | murah, kadang cukup | hit rate tidak optimal |
| Windowed/hybrid | lebih robust | implementasi kompleks |

---

## 9. TTL Cache

TTL berarti **Time To Live**.

Entry valid sampai durasi tertentu setelah write atau access.

### 9.1 Expire After Write

Entry expired setelah waktu tertentu sejak ditulis.

```text
write at 10:00
TTL 5 minutes
expired at 10:05
```

Cocok untuk:

- external API response;
- config polling;
- reference data dengan freshness window;
- token yang punya expiry fixed.

### 9.2 Expire After Access

Entry expired jika tidak diakses selama durasi tertentu.

```text
access at 10:00
TTL 5 minutes
access at 10:03 -> expiry extended to 10:08
```

Cocok untuk:

- session-like data;
- temporary working set;
- data yang ingin dipertahankan selama aktif dipakai.

### 9.3 Absolute Expiry

Beberapa value punya expiry dari sumbernya.

Contoh token:

```java
record TokenEntry(
    String token,
    Instant expiresAt
) {}
```

Jangan memakai TTL fixed jika provider memberi expiry yang eksplisit.

Lebih aman gunakan buffer:

```java
boolean isUsable(Clock clock) {
    return Instant.now(clock).isBefore(expiresAt.minusSeconds(30));
}
```

Tujuannya mencegah token dipakai terlalu dekat dengan expiry.

### 9.4 Lazy Expiration

Lazy expiration berarti entry dihapus saat diakses dan ternyata expired.

```java
public V get(K key) {
    Entry<V> entry = map.get(key);
    if (entry == null) {
        return null;
    }
    if (entry.isExpired(clock)) {
        map.remove(key);
        return null;
    }
    return entry.value();
}
```

Kelebihan:

- sederhana;
- tidak butuh background thread.

Kekurangan:

- expired entry yang tidak pernah diakses bisa tetap menahan memory;
- cleanup bergantung pada traffic.

### 9.5 Active Expiration

Active expiration memakai background cleanup atau scheduler.

```text
periodically scan expired entries -> remove
```

Kelebihan:

- memory lebih cepat dibersihkan;
- cocok untuk banyak expired idle entries.

Kekurangan:

- scheduler complexity;
- scan cost;
- race dengan concurrent access;
- timing tidak boleh dianggap hard real-time.

Banyak library cache production memakai maintenance berkala yang dipicu write/read dan/atau scheduler. Caffeine, misalnya, mendokumentasikan expiration maintenance selama write dan kadang read; scheduler bisa dipakai untuk prompt expiration, tetapi cleanup tetap best-effort, bukan hard real-time guarantee.

---

## 10. Implementasi TTL Cache Sederhana

Implementasi single-thread/low-contention:

```java
import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Objects;

public final class TtlCache<K, V> {
    private record Entry<V>(V value, long expiresAtMillis) {}

    private final Map<K, Entry<V>> map = new HashMap<>();
    private final Duration ttl;
    private final Clock clock;

    public TtlCache(Duration ttl, Clock clock) {
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("ttl must be positive");
        }
        this.ttl = ttl;
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public synchronized V get(K key) {
        Objects.requireNonNull(key, "key");
        Entry<V> entry = map.get(key);
        if (entry == null) {
            return null;
        }
        if (isExpired(entry)) {
            map.remove(key);
            return null;
        }
        return entry.value();
    }

    public synchronized void put(K key, V value) {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(value, "value");
        long expiresAt = clock.millis() + ttl.toMillis();
        map.put(key, new Entry<>(value, expiresAt));
    }

    public synchronized int cleanupExpired() {
        int removed = 0;
        Iterator<Map.Entry<K, Entry<V>>> iterator = map.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<K, Entry<V>> current = iterator.next();
            if (isExpired(current.getValue())) {
                iterator.remove();
                removed++;
            }
        }
        return removed;
    }

    public synchronized int size() {
        return map.size();
    }

    private boolean isExpired(Entry<V> entry) {
        return clock.millis() >= entry.expiresAtMillis();
    }
}
```

Kelemahan implementasi ini:

- tidak bounded by size;
- semua operasi synchronized;
- cleanup scan `O(n)`;
- tidak ada stampede protection;
- tidak ada refresh;
- tidak cocok untuk high-throughput cache.

Tetapi sebagai mental model, ini sangat berguna.

---

## 11. Combining LRU + TTL

Production cache sering butuh dua batas:

```text
maximumSize = 10_000
TTL = 10 minutes
```

Artinya:

- entry terlalu tua dianggap invalid;
- entry terlalu banyak akan dievict walaupun belum expired.

Dengan `LinkedHashMap`, kamu bisa menggabungkan access-order eviction dengan timestamp.

```java
import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

public final class BoundedTtlLruCache<K, V> {
    private record Entry<V>(V value, long expiresAtMillis) {}

    private final int maxSize;
    private final Duration ttl;
    private final Clock clock;
    private final LinkedHashMap<K, Entry<V>> map;

    public BoundedTtlLruCache(int maxSize, Duration ttl, Clock clock) {
        if (maxSize <= 0) {
            throw new IllegalArgumentException("maxSize must be positive");
        }
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("ttl must be positive");
        }
        this.maxSize = maxSize;
        this.ttl = ttl;
        this.clock = Objects.requireNonNull(clock, "clock");
        this.map = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, Entry<V>> eldest) {
                return size() > BoundedTtlLruCache.this.maxSize;
            }
        };
    }

    public synchronized V get(K key) {
        Objects.requireNonNull(key, "key");
        Entry<V> entry = map.get(key);
        if (entry == null) {
            return null;
        }
        if (clock.millis() >= entry.expiresAtMillis()) {
            map.remove(key);
            return null;
        }
        return entry.value();
    }

    public synchronized void put(K key, V value) {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(value, "value");
        long expiresAt = clock.millis() + ttl.toMillis();
        map.put(key, new Entry<>(value, expiresAt));
    }

    public synchronized int size() {
        return map.size();
    }
}
```

Ini cache sederhana yang cukup untuk kasus kecil. Namun jangan langsung anggap ini production-grade untuk workload tinggi.

---

## 12. Weight-Based Eviction

`maximumSize` mengasumsikan semua entry punya biaya sama.

Itu sering salah.

Contoh:

```text
Entry A = 1 KB
Entry B = 20 MB
```

Jika cache membatasi 1.000 entry, satu entry besar bisa membuat memory melonjak.

Weight-based cache membatasi total bobot:

```text
maximumWeight = 512 MB
entryWeight = estimated bytes / cost units
```

Bobot tidak harus byte persis. Bisa berupa unit estimasi:

- jumlah row;
- jumlah item nested;
- panjang string;
- ukuran serialized payload;
- jumlah permission/rule.

Contoh desain:

```java
interface Weigher<K, V> {
    long weigh(K key, V value);
}
```

Entry:

```java
record WeightedEntry<V>(V value, long weight) {}
```

Cache harus menjaga:

```text
sum(entry.weight) <= maximumWeight
```

Trade-off:

- lebih akurat daripada count;
- butuh estimasi weight;
- update value harus update total weight;
- sulit jika object mutable dan ukurannya berubah setelah dicache.

Karena itu cached value sebaiknya immutable.

---

## 13. Negative Caching

Negative caching berarti menyimpan hasil “tidak ada” atau “gagal tertentu”.

Contoh:

```text
postalCode 999999 -> not found
userId X -> no active profile
ruleCode Y -> not configured
```

Tanpa negative caching, missing key yang sering diminta akan selalu menekan backend.

### 13.1 Representasi Negative Result

Jangan pakai `null` sebagai value cache jika kamu perlu membedakan:

- tidak ada entry di cache;
- entry ada dan hasilnya memang not found.

Gunakan wrapper:

```java
sealed interface LookupResult<V> permits LookupResult.Found, LookupResult.NotFound {
    record Found<V>(V value) implements LookupResult<V> {}
    record NotFound<V>() implements LookupResult<V> {}
}
```

Atau:

```java
Map<Key, Optional<Value>> cache;
```

Tetapi hati-hati: `Optional` sebagai field/value kadang diperdebatkan. Untuk cache internal, bisa diterima jika tim sepakat.

### 13.2 TTL Negative Cache Biasanya Lebih Pendek

Not found bisa berubah menjadi found.

Contoh:

- config baru dibuat;
- user baru sync;
- external system update;
- data eventually consistent.

Maka TTL negative result sering lebih pendek.

```text
positive TTL = 30 minutes
negative TTL = 1 minute
```

### 13.3 Jangan Cache Semua Error

Error berbeda perlu diperlakukan berbeda.

| Error | Cache? | Alasan |
|---|---:|---|
| 404 not found stabil | Mungkin | mengurangi repeated miss |
| 400 invalid request | Mungkin | input invalid deterministik |
| 401 unauthorized | Biasanya tidak | credential/session bisa berubah |
| 429 rate limited | Hati-hati | lebih cocok backoff/circuit breaker |
| 500 backend error | Biasanya tidak lama | bisa memperpanjang outage ke user |
| Timeout | Biasanya tidak | transient |

Negative caching yang salah bisa membuat sistem “mengingat kegagalan” terlalu lama.

---

## 14. Cache Stampede

Cache stampede terjadi ketika banyak request miss key yang sama pada waktu bersamaan, lalu semuanya men-load dari sumber mahal.

```text
100 threads request key A
cache miss for all
100 backend calls happen
backend overloaded
latency rises
more timeouts
more retries
system collapse
```

Cache seharusnya mengurangi beban. Stampede membuat cache justru memperparah beban.

### 14.1 Penyebab Stampede

- TTL sama untuk banyak key;
- hot key expired;
- cache cold setelah restart;
- cache invalidation massal;
- deploy membersihkan local cache;
- backend lambat sehingga load overlap;
- retry policy agresif.

### 14.2 Teknik Mitigasi

| Teknik | Ide |
|---|---|
| In-flight deduplication | satu load per key, caller lain menunggu |
| Request coalescing | gabungkan load key yang sama |
| Soft TTL + refresh async | return stale sementara refresh di belakang |
| TTL jitter | expiry disebar agar tidak serentak |
| Negative caching | repeated not-found tidak menekan backend |
| Rate limiting | batasi load ke backend |
| Circuit breaker | stop call sementara saat backend sakit |
| Pre-warming | isi cache sebelum traffic besar |

---

## 15. In-Flight Deduplication dengan ConcurrentHashMap

In-flight deduplication menyimpan load yang sedang berjalan.

Mental model:

```text
Map<K, CompletableFuture<V>> inFlight
```

Jika request pertama miss:

```text
put future for key A
start load A
```

Jika request lain datang saat load belum selesai:

```text
reuse same future
```

### 15.1 Implementasi Konseptual

```java
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.function.Function;

public final class SingleFlightLoader<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();
    private final Executor executor;
    private final Function<K, V> loader;

    public SingleFlightLoader(Executor executor, Function<K, V> loader) {
        this.executor = Objects.requireNonNull(executor, "executor");
        this.loader = Objects.requireNonNull(loader, "loader");
    }

    public CompletableFuture<V> load(K key) {
        Objects.requireNonNull(key, "key");
        return inFlight.computeIfAbsent(key, this::startLoad);
    }

    private CompletableFuture<V> startLoad(K key) {
        CompletableFuture<V> future = CompletableFuture.supplyAsync(() -> loader.apply(key), executor);
        future.whenComplete((value, error) -> inFlight.remove(key, future));
        return future;
    }
}
```

Poin penting:

- `remove(key, future)` mencegah menghapus future baru yang mungkin sudah masuk;
- error juga harus menghapus in-flight entry;
- caller harus menangani exception;
- loader harus punya timeout/backpressure.

Java `ConcurrentHashMap` mendokumentasikan pola `computeIfAbsent` untuk inisialisasi value secara concurrent, misalnya histogram dengan `LongAdder`. Ini menunjukkan bahwa `computeIfAbsent` memang primitive penting untuk atomic per-key initialization pada map concurrent, tetapi mapping function tetap harus dirancang hati-hati agar tidak melakukan blocking panjang di jalur kritis tanpa pertimbangan.

### 15.2 Integrasi Cache + Single Flight

```java
public CompletableFuture<V> getOrLoad(K key) {
    V cached = cache.get(key);
    if (cached != null) {
        return CompletableFuture.completedFuture(cached);
    }

    return singleFlight.load(key)
        .thenApply(value -> {
            cache.put(key, value);
            return value;
        });
}
```

Namun implementasi ini masih punya race:

```text
Thread A miss -> load
Thread B miss -> waits same future
Thread C after A load but before put -> may miss
```

Bisa diperbaiki dengan memasukkan cache put dalam future yang sama atau memakai cache library loading cache.

---

## 16. Soft TTL, Hard TTL, Refresh

TTL biasa membuat entry hilang atau dianggap invalid setelah waktu tertentu.

Soft TTL/hard TTL membagi freshness menjadi dua batas:

```text
write time = T0
soft TTL  = T0 + 5 minutes
hard TTL  = T0 + 30 minutes
```

Behavior:

- sebelum soft TTL: return fresh;
- setelah soft TTL tapi sebelum hard TTL: return stale value, trigger refresh;
- setelah hard TTL: jangan return, harus load ulang atau fail.

### 16.1 Kenapa Soft TTL Berguna?

Untuk hot key, lebih baik mengembalikan value sedikit stale daripada membuat semua request menunggu refresh.

```text
request at soft-expired key
return stale immediately
one background refresh starts
```

Ini menurunkan tail latency.

### 16.2 Risiko Soft TTL

- user menerima data stale;
- refresh failure perlu ditangani;
- harus ada hard TTL agar stale tidak hidup selamanya;
- butuh observability: stale served count.

### 16.3 Refresh After Write

Refresh berbeda dari expire.

Refresh membuat entry eligible untuk reload, tetapi tidak selalu langsung invalid. Pada Caffeine, `refreshAfterWrite` membuat key eligible untuk refresh setelah durasi tertentu, dan refresh dipicu saat entry di-query. Ini berbeda dari `expireAfterWrite`, yang membuat entry tidak boleh dipakai setelah expiry.

---

## 17. TTL Jitter

Jika banyak entry ditulis pada waktu yang sama dengan TTL sama, mereka akan expired bersamaan.

Contoh:

```text
10.000 entries loaded at 10:00
TTL = 10 minutes
all expire at 10:10
```

Akibat:

- miss spike;
- backend spike;
- latency spike;
- retry storm.

Tambahkan jitter:

```java
Duration jitteredTtl(Duration baseTtl, double jitterRatio, ThreadLocalRandom random) {
    long baseMillis = baseTtl.toMillis();
    long jitterRange = (long) (baseMillis * jitterRatio);
    long delta = random.nextLong(-jitterRange, jitterRange + 1);
    return Duration.ofMillis(baseMillis + delta);
}
```

Contoh:

```text
base TTL = 10 minutes
jitter = ±10%
actual TTL = 9-11 minutes
```

Jitter sederhana tetapi sangat efektif untuk menghindari synchronized expiry.

---

## 18. Windowed Cache

Windowed cache menyimpan data berdasarkan jendela waktu.

Contoh:

```text
key = (userId, minuteBucket)
```

Atau:

```text
key = (apiName, 5-minute-window)
```

### 18.1 Use Case

- rate limiting;
- rolling metrics;
- fraud detection window;
- SLA breach count;
- temporary deduplication;
- idempotency window.

### 18.2 Fixed Window

```text
10:00:00 - 10:00:59
10:01:00 - 10:01:59
```

Mudah, tetapi boundary problem:

```text
user sends 100 requests at 10:00:59
then 100 requests at 10:01:00
```

Dalam 2 detik user bisa melewati limit dua kali.

### 18.3 Sliding Window

Sliding window melihat rentang waktu relatif terhadap sekarang.

```text
now = 10:01:30
window = last 60 seconds -> 10:00:30 - 10:01:30
```

Lebih akurat, tetapi lebih mahal.

Representasi:

- deque timestamps;
- ring buffer bucket;
- approximate counter.

### 18.4 Ring Buffer Window

Untuk rolling count per second selama 60 detik:

```java
final class RollingCounter {
    private static final int WINDOW_SECONDS = 60;

    private final long[] bucketSecond = new long[WINDOW_SECONDS];
    private final long[] bucketCount = new long[WINDOW_SECONDS];

    public synchronized void increment(long epochSecond) {
        int index = (int) (epochSecond % WINDOW_SECONDS);
        if (bucketSecond[index] != epochSecond) {
            bucketSecond[index] = epochSecond;
            bucketCount[index] = 0;
        }
        bucketCount[index]++;
    }

    public synchronized long sum(long nowEpochSecond) {
        long total = 0;
        long minSecond = nowEpochSecond - WINDOW_SECONDS + 1;
        for (int i = 0; i < WINDOW_SECONDS; i++) {
            if (bucketSecond[i] >= minSecond && bucketSecond[i] <= nowEpochSecond) {
                total += bucketCount[i];
            }
        }
        return total;
    }
}
```

Ini bukan cache biasa, tetapi secara konsep menyimpan data sementara dalam jendela waktu.

---

## 19. Time Wheel untuk Expiration

Jika kamu punya banyak entry dengan expiry time, salah satu pendekatan adalah time wheel.

Mental model:

```text
slots = array of buckets
current tick moves every second
entries assigned to future slot
when slot active -> expire candidates
```

Contoh:

```text
slot 0: entries expiring at second 0, 60, 120, ...
slot 1: entries expiring at second 1, 61, 121, ...
...
slot 59
```

Kelebihan:

- expiration scheduling lebih murah daripada priority queue untuk banyak timer;
- cocok untuk coarse-grained TTL;
- banyak sistem networking/timer memakai konsep serupa.

Kekurangan:

- implementasi lebih kompleks;
- expiry tidak presisi jika granularity kasar;
- butuh handle entry yang di-refresh/dihapus sebelum slot aktif;
- butuh concurrency control.

Untuk aplikasi biasa, lebih baik gunakan library cache daripada membuat time wheel sendiri.

---

## 20. Manual Cache vs Library Cache

### 20.1 Manual Cache Layak Jika

- ukurannya kecil;
- policy sederhana;
- single-thread atau low-contention;
- tidak critical;
- behavior mudah dites;
- tidak butuh metrics kompleks;
- tidak butuh async loading/refresh.

Contoh:

```text
cache last 100 parsed templates in a CLI tool
cache small static metadata in a batch job
cache local mapping in test utility
```

### 20.2 Gunakan Library Jika

- high-throughput service;
- multi-threaded access;
- eviction + expiration + refresh;
- butuh metrics;
- butuh async loading;
- butuh stampede protection;
- cache mempengaruhi production latency;
- data volume besar;
- policy correctness penting.

Library umum di ekosistem Java:

- **Caffeine** — modern, high-performance local cache;
- **Guava Cache** — lebih lama, masih banyak ditemukan di codebase;
- provider JCache/JSR-107 — jika organisasi memakai standard abstraction tertentu.

Caffeine menyediakan policy seperti size-based eviction, time-based expiration, refresh, scheduler, async cache, dan stats. Dokumentasinya juga menjelaskan bahwa expiration maintenance dilakukan secara periodik saat write dan kadang read, dengan scheduler opsional untuk prompt expiration.

Guava `CacheBuilder` menyediakan `maximumSize`, `expireAfterWrite`, `removalListener`, dan `LoadingCache` yang dapat atomically compute/retrieve value dengan `CacheLoader`; jika thread lain sedang load key yang sama, thread tersebut menunggu hasil load tersebut, sementara key berbeda bisa diload concurrently.

---

## 21. Java Data Structures untuk Cache

### 21.1 `HashMap`

Cocok untuk:

- single-thread manual cache;
- memoization dalam satu method/request;
- DP sparse table;
- small local map.

Tidak cukup untuk:

- eviction;
- expiration;
- concurrency;
- ordering.

### 21.2 `LinkedHashMap`

Cocok untuk:

- simple LRU;
- insertion-order cache;
- deterministic iteration;
- small bounded cache.

Kelemahan:

- bukan concurrent;
- access-order `get` mengubah struktur;
- eviction hanya pada insert via `removeEldestEntry`;
- tidak ada TTL built-in;
- tidak ada metrics/load coalescing.

### 21.3 `ConcurrentHashMap`

Cocok untuk:

- concurrent lookup;
- in-flight dedup map;
- simple concurrent memoization;
- frequency map dengan `LongAdder`.

Tidak cukup untuk:

- LRU ordering global;
- automatic eviction;
- TTL cleanup;
- weight policy.

### 21.4 `PriorityQueue`

Bisa dipakai untuk expiry queue:

```text
min-heap by expiresAt
```

Tetapi ada masalah:

- jika entry diperbarui, heap lama masih berisi expiry lama;
- butuh lazy deletion;
- remove arbitrary entry mahal;
- concurrency rumit.

### 21.5 `DelayQueue`

Bisa dipakai untuk delayed expiration, tetapi:

- cocok untuk task scheduling tertentu;
- tidak otomatis sinkron dengan map update;
- butuh handle cancellation/lazy invalidation;
- bukan general cache solution.

---

## 22. Cache Invalidation

Salah satu kalimat klasik di software engineering: hal tersulit adalah naming dan cache invalidation.

Invalidation berarti menghapus/memperbarui cache karena source of truth berubah.

### 22.1 Invalidation Strategies

| Strategy | Cara kerja | Cocok untuk |
|---|---|---|
| TTL-only | tunggu expired | data boleh stale sementara |
| Write-through invalidation | hapus/update cache saat write | service mengontrol write path |
| Event-driven invalidation | consume event perubahan | distributed system |
| Versioned key | key mencakup version | config/rule snapshot |
| Manual invalidation | admin/action eksplisit | rare operational cases |
| Refresh polling | periodic reload | reference data sederhana |

### 22.2 Versioned Key

Daripada menghapus semua cache saat config berubah, masukkan version ke key.

```java
record RuleEvalKey(
    String agency,
    String ruleCode,
    String ruleVersion,
    String applicantType
) {}
```

Jika rule version berubah, key baru otomatis tidak bertabrakan dengan value lama.

Kelebihan:

- tidak perlu global invalidation rumit;
- cache lama bisa naturally expire;
- aman untuk concurrent requests lintas version.

Kekurangan:

- memory bisa naik jika version sering berubah;
- perlu bounded cache/TTL.

### 22.3 Event-Driven Invalidation

Contoh:

```text
RuleUpdatedEvent(ruleId, version)
```

Consumer cache:

```java
cache.invalidate(ruleId);
```

Risiko:

- event delay;
- event loss;
- duplicate event;
- out-of-order event;
- partial invalidation;
- multi-instance coordination.

Jika correctness kritis, event-driven invalidation harus punya fallback:

- version check;
- TTL upper bound;
- periodic reconciliation;
- idempotent event handling.

---

## 23. Distributed Cache vs Local Cache

Part ini fokus local cache data structure, tetapi production sering punya distributed cache seperti Redis.

### 23.1 Local Cache

Kelebihan:

- sangat cepat;
- tidak ada network hop;
- tidak membebani Redis;
- cocok untuk per-instance hot data.

Kekurangan:

- tiap instance punya isi berbeda;
- invalidation antar instance sulit;
- cache cold saat instance restart;
- memory total = per instance x number of instances.

### 23.2 Distributed Cache

Kelebihan:

- shared antar instance;
- central TTL;
- bisa mengurangi duplicate load antar service instances;
- cocok untuk token/session/shared reference.

Kekurangan:

- network latency;
- serialization cost;
- Redis/cache cluster bisa menjadi dependency kritis;
- failure mode bertambah;
- stampede masih bisa terjadi;
- key design tetap penting.

### 23.3 Two-Level Cache

```text
L1 local cache -> L2 distributed cache -> source of truth
```

Kelebihan:

- latency rendah untuk hot local item;
- Redis mengurangi DB/API call;
- scalable read path.

Kekurangan:

- invalidation lebih kompleks;
- stale behavior bertingkat;
- observability harus memisahkan L1 hit, L2 hit, source load.

---

## 24. Cache untuk Token

Token cache adalah contoh bagus karena expiry correctness penting.

### 24.1 Design

```java
record AccessToken(
    String token,
    Instant expiresAt
) {
    boolean usableAt(Instant now) {
        return now.isBefore(expiresAt.minusSeconds(30));
    }
}
```

Key bisa berupa:

```java
record TokenKey(
    String provider,
    String clientId,
    String scope
) {}
```

### 24.2 Failure Mode

| Failure | Dampak |
|---|---|
| token dipakai sampai tepat expiry | intermittent 401 |
| semua thread refresh token bersamaan | auth server spike |
| token cache key tidak mencakup scope | privilege/permission salah |
| cache token di browser | security risk |
| tidak handle 401 retry | request gagal padahal token bisa refresh |

### 24.3 Pattern

- cache token server-side;
- refresh sebelum expiry dengan safety window;
- single-flight refresh per token key;
- retry sekali pada 401 setelah force refresh;
- jangan infinite retry;
- metrics refresh success/failure.

Pseudo-flow:

```text
get token
  if cached token usable -> return
  else single-flight refresh

call API
  if 401 -> invalidate token -> refresh once -> retry once
```

---

## 25. Cache untuk External API Response

Misalnya postal code lookup.

### 25.1 Key

```java
record PostalLookupKey(
    String provider,
    String normalizedPostalCode,
    String responseVersion
) {}
```

### 25.2 Value

```java
sealed interface PostalLookupValue {
    record Found(String postalCode, String address, double lat, double lon) implements PostalLookupValue {}
    record NotFound(String postalCode) implements PostalLookupValue {}
}
```

### 25.3 Policy

- positive TTL: lebih panjang;
- negative TTL: lebih pendek;
- maximum size;
- in-flight dedup;
- rate limit loader;
- timeout;
- retry bounded;
- fallback behavior jelas.

### 25.4 Common Design

```text
request postal code
  normalize key
  check local cache
  if hit and fresh -> return
  if miss -> in-flight dedup load
      loader protected by rate limiter
      loader timeout
      store positive/negative result
```

---

## 26. Cache for Rule Engine

Rule engine sering membutuhkan cache, tetapi correctness-nya sensitif.

### 26.1 Apa yang Bisa Dicache?

- compiled rule expression;
- parsed condition tree;
- immutable rule snapshot;
- lookup table by rule version;
- eligibility result untuk input deterministik.

### 26.2 Apa yang Berbahaya Dicache?

- result yang bergantung pada current time tanpa time masuk key;
- result yang bergantung pada user permission tanpa permission/version masuk key;
- mutable rule object dari database entity;
- partial evaluation yang tidak mencakup semua context.

### 26.3 Key Design

```java
record RuleEvaluationKey(
    String ruleSetId,
    String ruleSetVersion,
    String applicantType,
    String licenceType,
    LocalDate asOfDate,
    String normalizedFactsHash
) {}
```

Jika facts terlalu besar, bisa dibuat digest. Tetapi digest harus deterministic dan collision risk harus diterima sesuai criticality.

### 26.4 Snapshot Lebih Baik dari TTL untuk Config Kritis

Untuk rule/config, sering lebih benar memakai versioned immutable snapshot daripada TTL-only cache.

```text
RuleSnapshot v1 loaded
requests use v1
RuleSnapshot v2 loaded atomically
new requests use v2
old requests finish with v1
```

Ini menghindari request yang sebagian memakai config lama dan sebagian config baru.

---

## 27. Cache Observability

Cache tanpa metrics adalah black box.

Minimal metrics:

| Metric | Makna |
|---|---|
| hit count/rate | seberapa sering cache membantu |
| miss count/rate | load pressure ke source |
| load success/failure | kesehatan loader |
| load latency | impact source/backend |
| eviction count | memory pressure/policy behavior |
| expiration count | TTL behavior |
| size/weight | memory approximation |
| stale served count | soft TTL behavior |
| in-flight count | stampede/coalescing behavior |
| refresh count/failure | refresh health |

Interpretasi:

- Hit rate tinggi belum tentu baik jika data stale salah.
- Hit rate rendah belum tentu buruk jika workload memang random.
- Eviction tinggi bisa berarti cache terlalu kecil atau key cardinality terlalu besar.
- Miss spike setelah deploy bisa berarti local cache cold.
- Load failure tinggi bisa menandakan backend/circuit breaker issue.

---

## 28. Testing Cache

Cache harus dites pada tiga level:

1. correctness;
2. policy;
3. concurrency/failure.

### 28.1 Correctness Test

- same key returns cached value;
- different key does not collide;
- canonicalization works;
- mutable key is not allowed;
- cached value not externally mutable;
- negative result distinguishable from miss.

### 28.2 Policy Test

- max size enforced;
- LRU eviction removes least recently used;
- TTL expiry works;
- negative TTL shorter;
- refresh triggered after soft TTL;
- hard TTL prevents infinite stale.

### 28.3 Time Test with Fake Clock

Jangan test TTL dengan `Thread.sleep` jika bisa dihindari.

Gunakan fake clock:

```java
final class MutableClock extends Clock {
    private Instant instant;
    private final ZoneId zone;

    MutableClock(Instant instant, ZoneId zone) {
        this.instant = instant;
        this.zone = zone;
    }

    void advance(Duration duration) {
        instant = instant.plus(duration);
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return new MutableClock(instant, zone);
    }

    @Override
    public Instant instant() {
        return instant;
    }
}
```

### 28.4 Concurrency Test

Untuk in-flight dedup:

- many threads request same key;
- loader should be invoked once;
- all callers receive same result;
- failure removes in-flight entry;
- retry after failure can load again.

Gunakan `CountDownLatch`, `ExecutorService`, dan atomic counter.

---

## 29. Failure Modes Cache di Production

### 29.1 Unbounded Cache

```java
private final Map<Key, Value> cache = new ConcurrentHashMap<>();
```

Tanpa eviction/TTL, ini memory leak dengan nama lain.

### 29.2 Key Cardinality Explosion

Key mencakup terlalu banyak dimensi high-cardinality:

```text
(userId, timestampMillis, requestId)
```

Akibat:

- hampir tidak ada hit;
- memory naik;
- eviction churn tinggi.

### 29.3 Mutable Cached Value

Caller mengubah value dari cache.

Akibat:

- request lain melihat data rusak;
- bug nondeterministic;
- sulit direproduksi.

### 29.4 Stale Authorization/Permission

Cache permission terlalu lama.

Akibat:

- user masih punya akses setelah dicabut;
- audit/security incident.

Untuk authorization, TTL harus sangat hati-hati. Versioned permission snapshot atau event invalidation sering lebih baik.

### 29.5 Cache Stampede

Hot key expired, semua thread load.

Akibat:

- backend overload;
- timeout;
- retry storm;
- cascading failure.

### 29.6 Cache Avalanche

Banyak key expired bersamaan.

Mitigasi:

- jitter;
- staggered warmup;
- soft TTL;
- rate-limited refresh.

### 29.7 Cache Penetration

Request untuk key yang tidak pernah ada menembus cache terus menerus.

Mitigasi:

- negative caching;
- input validation;
- Bloom filter pre-check untuk dataset besar;
- rate limit suspicious key.

### 29.8 Silent Wrong Cache

Key tidak mencakup dimension penting.

Contoh:

```text
cache by ruleCode only
but result depends on agency + effectiveDate + applicantType
```

Ini adalah failure paling berbahaya karena sistem cepat dan tampak sehat, tetapi salah.

---

## 30. Decision Framework: Memilih Cache Policy

Gunakan pertanyaan ini.

### 30.1 Apakah Data Boleh Stale?

| Jawaban | Strategy |
|---|---|
| Tidak boleh | jangan pakai TTL cache sembarangan; gunakan snapshot/version/index |
| Boleh beberapa detik | soft TTL + refresh |
| Boleh beberapa menit | TTL cache |
| Boleh sampai restart | local memoization/static cache mungkin cukup |

### 30.2 Apakah Workload Memiliki Temporal Locality?

Jika ya, LRU cocok.

Contoh:

- recent user/session;
- recently accessed case;
- repeated lookup dalam burst.

### 30.3 Apakah Ada Hot Keys Stabil?

Jika ya, LFU/hybrid lebih cocok.

Contoh:

- popular reference data;
- common rule config;
- common postal code/location.

### 30.4 Apakah Value Size Seragam?

Jika tidak, gunakan weight-based thinking.

### 30.5 Apakah Multi-threaded?

Jika ya:

- jangan pakai `HashMap` biasa;
- hati-hati dengan `LinkedHashMap` access-order;
- gunakan library atau synchronization yang jelas;
- pertimbangkan `ConcurrentHashMap` untuk in-flight.

### 30.6 Apakah Loader Mahal?

Jika ya:

- gunakan in-flight dedup;
- timeout;
- retry bounded;
- rate limit;
- circuit breaker;
- metrics.

---

## 31. Design Checklist

Sebelum membuat cache, jawab checklist ini:

### 31.1 Key

- [ ] Apakah key immutable?
- [ ] Apakah `equals/hashCode` benar?
- [ ] Apakah semua dimensi value masuk key?
- [ ] Apakah input dicanonicalize?
- [ ] Apakah key menghindari PII sensitif?
- [ ] Apakah cardinality key terkendali?

### 31.2 Value

- [ ] Apakah value immutable atau defensive copied?
- [ ] Apakah value minimal?
- [ ] Apakah value tidak menahan request/session context?
- [ ] Apakah value size dipahami?

### 31.3 Policy

- [ ] Apakah ada maximum size/weight?
- [ ] Apakah ada TTL/expiration jika perlu?
- [ ] Apakah TTL positive dan negative berbeda?
- [ ] Apakah eviction policy sesuai workload?
- [ ] Apakah ada jitter untuk mencegah avalanche?

### 31.4 Loading

- [ ] Apakah loader idempotent?
- [ ] Apakah loader punya timeout?
- [ ] Apakah loader punya retry bounded?
- [ ] Apakah in-flight dedup diperlukan?
- [ ] Apakah failure di-cache atau tidak?

### 31.5 Invalidation

- [ ] Apakah source data bisa berubah?
- [ ] Apakah TTL cukup?
- [ ] Apakah butuh event invalidation?
- [ ] Apakah versioned key lebih aman?
- [ ] Apakah ada fallback reconciliation?

### 31.6 Observability

- [ ] Hit/miss rate?
- [ ] Load latency?
- [ ] Load failure?
- [ ] Eviction/expiration count?
- [ ] Size/weight?
- [ ] Stale served count?
- [ ] In-flight load count?

---

## 32. Mini Case Study: External Postal Lookup Cache

### 32.1 Requirement

Sistem perlu lookup postal code ke external API.

Constraints:

- external API rate limited;
- response relatif stabil;
- not found bisa berubah jika provider update data;
- token auth perlu refresh;
- browser tidak boleh tahu token;
- banyak user bisa mengetik postal code yang sama.

### 32.2 Design

```text
Frontend -> Backend proxy -> PostalLookupService
                           -> TokenCache
                           -> PostalResponseCache
                           -> External API
```

### 32.3 Data Structures

```java
record PostalKey(String provider, String postalCode, String responseVersion) {}

sealed interface PostalValue {
    record Found(String postalCode, String address, double latitude, double longitude) implements PostalValue {}
    record NotFound(String postalCode) implements PostalValue {}
}
```

Cache policy:

```text
maximumSize = 100_000
positive TTL = 24 hours ± jitter
negative TTL = 5 minutes ± jitter
single-flight per postal key
loader rate limit = below provider limit
retry = bounded for transient failures
```

Token policy:

```text
token key = provider + client id + scope
token refresh before expiry
single-flight refresh
401 -> invalidate token -> refresh once -> retry once
```

### 32.4 Failure Model

| Failure | Mitigation |
|---|---|
| hot postal code expires | single-flight + soft TTL |
| many entries expire same time | TTL jitter |
| provider 429 | rate limit + backoff |
| token expired | safety refresh + retry once |
| invalid postal code spam | validation + negative cache |
| huge key cardinality | canonicalize postal code |
| stale data unacceptable? | reduce TTL or add provider version/invalidation |

---

## 33. Mini Case Study: Rule Config Cache

### 33.1 Requirement

Sistem punya rule configuration untuk workflow/case processing.

Constraints:

- rule changes must be auditable;
- request must evaluate with consistent version;
- rule evaluation is frequent;
- config changes less frequent;
- stale rule could create wrong business decision.

### 33.2 Bad Design

```java
Map<String, Rule> cacheByRuleCode;
```

Masalah:

- rule code saja tidak cukup;
- tidak ada version;
- mutable rule entity bisa bocor;
- TTL-only bisa membuat decision memakai config lama;
- partial update bisa membuat inconsistent rule set.

### 33.3 Better Design

```java
record RuleSetKey(String agency, String ruleSetId, String version) {}

record RuleSetSnapshot(
    RuleSetKey key,
    Map<String, CompiledRule> rulesByCode,
    Instant loadedAt
) {
    RuleSetSnapshot {
        rulesByCode = Map.copyOf(rulesByCode);
    }
}
```

Atomic reference:

```java
final class RuleSnapshotRegistry {
    private final AtomicReference<RuleSetSnapshot> current = new AtomicReference<>();

    RuleSetSnapshot current() {
        return current.get();
    }

    void publish(RuleSetSnapshot snapshot) {
        current.set(snapshot);
    }
}
```

Ini lebih mirip immutable snapshot daripada TTL cache.

Pelajaran:

> Untuk data yang menentukan keputusan bisnis kritis, versioned immutable snapshot sering lebih aman daripada cache TTL biasa.

---

## 34. Complexity Summary

| Structure/Policy | Lookup | Insert | Evict | Memory | Catatan |
|---|---:|---:|---:|---:|---|
| HashMap cache | avg `O(1)` | avg `O(1)` | manual | medium | tidak bounded default |
| LinkedHashMap LRU | avg `O(1)` | avg `O(1)` | avg `O(1)` | higher | access-order get mutates structure |
| TTL lazy cache | avg `O(1)` | avg `O(1)` | on access | medium | expired idle entries bisa bertahan |
| TTL scan cleanup | avg `O(1)` | avg `O(1)` | `O(n)` scan | medium | simple but scan cost |
| PriorityQueue expiry | lookup needs map | `O(log n)` heap | `O(log n)` min | higher | update/cancel perlu lazy deletion |
| LFU classic | avg `O(1)` | avg `O(1)` | avg `O(1)` | high | implementation complex |
| Ring buffer window | `O(window)` or `O(1)` depending query | `O(1)` | overwrite | low | cocok untuk time bucket |
| Single-flight map | avg `O(1)` | avg `O(1)` | on completion | medium | mencegah duplicate load |

---

## 35. Common Interview vs Production Difference

Interview sering bertanya:

> “Implement LRU Cache in O(1).”

Production bertanya:

- Apakah cache key benar?
- Apakah value immutable?
- Apakah ada max size?
- Apakah ada TTL?
- Apakah TTL butuh jitter?
- Apakah negative result dicache?
- Apakah loader bisa stampede?
- Apakah cache thread-safe?
- Apakah data boleh stale?
- Apakah eviction bisa diamati?
- Apakah cache memperburuk outage?
- Apakah invalidation reliable?
- Apakah memory footprint terukur?

Top-tier engineer tidak berhenti pada `HashMap + doubly linked list`. Ia menanyakan policy, correctness, lifecycle, observability, dan failure behavior.

---

## 36. Practical Rules of Thumb

1. Jangan buat cache tanpa maximum size/weight kecuali lifetime dan cardinality benar-benar terbatas.
2. Jangan pakai mutable object sebagai key.
3. Jangan return mutable cached value tanpa defensive copy atau immutable design.
4. Jangan cache authorization/permission terlalu lama tanpa invalidation/versioning.
5. Jangan menganggap hit rate tinggi berarti cache benar.
6. Jangan cache transient backend failure terlalu lama.
7. Gunakan negative caching untuk repeated not-found, tetapi TTL-nya pendek.
8. Gunakan in-flight dedup untuk hot expensive key.
9. Tambahkan TTL jitter untuk banyak key dengan TTL sama.
10. Untuk cache production high-throughput, gunakan library seperti Caffeine daripada membuat manual cache kompleks.
11. Untuk config/rule kritis, pertimbangkan immutable versioned snapshot, bukan TTL cache biasa.
12. Ukur cache: hit, miss, load latency, eviction, expiration, size, stale served.

---

## 37. Latihan

### Latihan 1 — LRU Manual

Implementasikan LRU cache sendiri menggunakan:

- `HashMap<K, Node<K,V>>`;
- custom doubly linked list;
- `get`, `put`, `remove`, `size`;
- max size.

Pastikan:

- `get` memindahkan node ke most-recent;
- `put existing` update value dan move to most-recent;
- `put new` evict least-recent jika penuh;
- semua pointer konsisten.

### Latihan 2 — TTL Cache dengan Fake Clock

Implementasikan TTL cache dan test:

- hit sebelum expired;
- miss setelah expired;
- cleanup expired;
- no `Thread.sleep`.

### Latihan 3 — Negative Cache

Buat cache postal lookup dengan:

- `Found`;
- `NotFound`;
- TTL positive 10 menit;
- TTL negative 30 detik.

### Latihan 4 — Single Flight

Buat test dengan 50 thread meminta key yang sama.

Ekspektasi:

- loader hanya dipanggil 1 kali;
- semua thread mendapat result sama;
- jika loader gagal, in-flight entry dibersihkan.

### Latihan 5 — Design Review

Ambil satu cache di sistem nyata atau imajiner. Jawab:

- apa key-nya;
- apa value-nya;
- cardinality key;
- TTL;
- eviction;
- invalidation;
- stampede risk;
- stale risk;
- metrics;
- failure mode.

---

## 38. Ringkasan

Cache adalah struktur data yang menggabungkan lookup cepat dan lifecycle policy.

Hal paling penting:

- `Map` hanya lookup, bukan cache lengkap.
- Cache key menentukan correctness.
- Cached value harus aman dari mutation dan memory retention.
- Eviction dan expiration adalah konsep berbeda.
- LRU cocok untuk temporal locality, tetapi buruk terhadap scan pollution.
- LFU cocok untuk hot keys stabil, tetapi perlu aging/decay.
- TTL perlu dipadukan dengan jitter, negative caching, dan invalidation strategy.
- Cache stampede adalah failure mode serius.
- In-flight dedup mencegah duplicate load per key.
- Soft TTL bisa menurunkan tail latency, tetapi mengizinkan stale data.
- Library cache seperti Caffeine/Guava menyelesaikan banyak detail yang sulit dibuat manual.
- Untuk data kritis seperti rule/config/permission, versioned immutable snapshot sering lebih benar daripada TTL cache biasa.

Mental model akhir:

> **Cache bukan optimisasi lokal kecil. Cache adalah kontrak data, waktu, memory, dan failure.**

---

## 39. Referensi

- Oracle Java SE 25 — `LinkedHashMap`: access order, encounter order, `removeEldestEntry`.  
  <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html>
- Oracle Java SE 25 — `ConcurrentHashMap`: concurrent retrieval/update and `computeIfAbsent` usage pattern.  
  <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html>
- Oracle Java SE 25 — `Map`: map contract, compute/merge operations.  
  <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html>
- Oracle Java SE 25 — `PriorityQueue`: heap-based priority queue behavior.  
  <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html>
- Caffeine Wiki — Eviction and expiration maintenance.  
  <https://github.com/ben-manes/caffeine/wiki/Eviction>
- Caffeine Wiki — Refresh semantics.  
  <https://github.com/ben-manes/caffeine/wiki/Refresh>
- Guava Wiki — Caches Explained.  
  <https://github.com/google/guava/wiki/cachesexplained>
- Guava `CacheBuilder` Javadoc — maximum size, expire after write, loading cache examples.  
  <https://guava.dev/releases/19.0/api/docs/com/google/common/cache/CacheBuilder.html>

---

## 40. Status Seri

Part ini adalah **Part 024** dari seri **Java Data Structure and Algorithm**.

Status: **belum selesai**.

Part berikutnya:

```text
Part 025 — Concurrent Data Structures in Java, Without Repeating Concurrency Basics
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-dsa-part-023 — Disjoint Set, Indexing, Sparse vs Dense Data](./learn-java-dsa-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-025 — Concurrent Data Structures in Java, Without Repeating Concurrency Basics](./learn-java-dsa-part-025.md)

</div>