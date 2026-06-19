# learn-redis-mastery-for-java-engineers-part-018.md

# Part 018 — Bitmaps, Bitfields, HyperLogLog: Compact State dan Approximation

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara tepat, bukan sekadar hafal command.  
> Fokus bagian ini: memakai Redis untuk state sangat padat, counting skala besar, dan approximate analytics dengan memahami batas correctness, memory, latency, dan auditability.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya kita sudah membahas Redis sebagai:

1. server in-memory dengan command execution model,
2. key-value data structure server,
3. cache layer,
4. primitive untuk rate limit,
5. idempotency,
6. distributed lock,
7. Lua/Functions,
8. Pub/Sub,
9. Streams.

Part ini masuk ke area yang sering dilewatkan oleh engineer backend, padahal sangat powerful: **struktur data compact dan approximate**.

Yang akan kita bahas:

1. **Bitmap** — memakai Redis String sebagai bit vector.
2. **Bitfield** — menyimpan banyak integer kecil di dalam binary string.
3. **HyperLogLog** — memperkirakan jumlah unique item dengan memory kecil.

Tiga topik ini punya karakter yang berbeda dari Hash/List/Set/ZSet:

- lebih dekat ke **data representation engineering**,
- sangat sensitif terhadap mapping offset/index,
- sering dipakai untuk analytics, presence, attendance, quota, dan feature flags,
- bisa sangat hemat memory,
- tetapi mudah berbahaya kalau dipakai untuk data yang membutuhkan kebenaran absolut.

Mental model utama part ini:

> Redis compact structures bukan sekadar command alternatif. Mereka adalah cara memindahkan sebagian desain data structure ke level bit dan probabilistic representation. Keuntungannya memory sangat rendah; risikonya readability, evolusi schema, dan correctness boundary harus jauh lebih disiplin.

---

## 1. Kenapa Topik Ini Penting untuk Java Backend Engineer

Sebagai Java engineer, kita sering terbiasa dengan struktur seperti:

```java
Set<Long> activeUsers;
Map<Long, Boolean> featureEligibility;
Map<Long, Integer> smallCounters;
Set<String> uniqueVisitors;
```

Di Redis, representasi naive-nya mungkin menjadi:

```text
SADD active-users:2026-06-20 1001 1002 1003 ...
HSET user-flags:tenant-42 user:1001 true user:1002 false ...
HINCRBY counters:bucket field-1001 1
SADD unique-visitors:2026-06-20 visitor-a visitor-b ...
```

Itu mudah dipahami, tetapi pada skala besar memory bisa meledak.

Contoh kasar:

- 10 juta user ID dalam Set berarti Redis harus menyimpan banyak string/integer representation + hash table overhead.
- 10 juta boolean dalam Hash tetap punya overhead field/value.
- 100 juta unique visitor dalam Set tidak realistis untuk sekadar daily cardinality analytics.

Redis memberi alternatif:

| Kebutuhan | Struktur naive | Struktur compact | Trade-off |
|---|---|---|---|
| boolean per user/day | Set/Hash | Bitmap | Butuh offset mapping stabil |
| counter kecil per entity | Hash | Bitfield | Butuh bit-width planning |
| unique count | Set | HyperLogLog | Approximate, bukan exact |
| attendance/presence | Set | Bitmap | Tidak simpan daftar ID secara natural |
| daily active users count | Set | Bitmap atau HyperLogLog | Bitmap butuh numeric offset; HLL approximate |

Pertanyaan arsitekturalnya bukan “command mana yang keren”, tetapi:

> Apakah sistem membutuhkan exact membership, exact list, exact count, atau hanya compact signal/count approximation?

---

## 2. Redis Bitmap: Bukan Data Type Baru, Tapi Operasi Bit di String

Redis Bitmap bukan tipe data terpisah. Bitmap adalah operasi bit-level pada Redis String.

Redis String binary-safe dan dapat diperlakukan sebagai array bit. Dengan command bitmap, kita bisa set/get bit pada offset tertentu.

Command utama:

```redis
SETBIT key offset value
GETBIT key offset
BITCOUNT key [start end [BYTE|BIT]]
BITOP operation destkey key [key ...]
BITPOS key bit [start [end [BYTE|BIT]]]
```

Contoh:

```redis
SETBIT dau:2026-06-20 1001 1
GETBIT dau:2026-06-20 1001
BITCOUNT dau:2026-06-20
```

Makna:

- User dengan numeric id `1001` aktif pada tanggal `2026-06-20`.
- Bit pada offset `1001` di-set ke `1`.
- `BITCOUNT` menghitung berapa bit yang bernilai `1`.

Secara konseptual:

```text
key: dau:2026-06-20

offset: 0 1 2 3 4 5 ... 1001 ...
value : 0 0 0 0 0 0 ...  1   ...
```

Ini sangat hemat memory karena satu user hanya butuh satu bit, bukan satu string/set entry.

---

## 3. Bitmap Mental Model

Bayangkan sebuah array boolean besar:

```java
boolean[] active = new boolean[maxUserId + 1];
active[1001] = true;
```

Redis Bitmap kira-kira seperti itu, tetapi disimpan sebagai binary string.

Perbedaan penting:

1. Redis tidak tahu bahwa offset `1001` berarti user ID `1001`.
2. Redis tidak tahu domain datanya.
3. Redis tidak tahu apakah offset valid.
4. Redis tidak tahu apakah key merepresentasikan hari, tenant, feature, atau campaign.
5. Semua interpretasi berada di aplikasi.

Jadi kontraknya harus eksplisit di sisi sistem:

```text
Key pattern:
  bitmap:dau:{yyyy-mm-dd}

Offset mapping:
  offset = numericUserId

Meaning:
  bit=1 means user had at least one accepted activity event on that date.

TTL:
  400 days

Correctness:
  exact for user IDs within mapped range, assuming all events processed.

Not suitable for:
  audit trail, event history, user list with arbitrary external IDs.
```

Tanpa kontrak seperti ini, bitmap cepat berubah menjadi binary blob misterius.

---

## 4. Kapan Bitmap Cocok

Bitmap cocok ketika data Anda berbentuk:

1. boolean,
2. indexed by integer offset,
3. sparsity masih masuk akal,
4. operasi utama adalah mark/check/count/bitwise operation,
5. tidak perlu menyimpan metadata per item.

Contoh use case bagus:

### 4.1 Daily Active Users untuk Numeric User ID

```redis
SETBIT app:dau:2026-06-20 12345 1
BITCOUNT app:dau:2026-06-20
```

Kalau user ID numeric dan range tidak terlalu liar, ini sangat efisien.

### 4.2 Attendance / Presence per Hari

```redis
SETBIT attendance:course-7:2026-06-20 501 1
GETBIT attendance:course-7:2026-06-20 501
BITCOUNT attendance:course-7:2026-06-20
```

Makna:

- Student offset `501` hadir.
- Cek hadir/tidak.
- Hitung total hadir.

### 4.3 Feature Eligibility Snapshot

```redis
SETBIT feature:beta-checkout:tenant-42 1001 1
GETBIT feature:beta-checkout:tenant-42 1001
```

Makna:

- User `1001` eligible untuk fitur beta.

### 4.4 One-Time Action Marker

```redis
SETBIT campaign:clicked:cmp-2026-q2 88912 1
GETBIT campaign:clicked:cmp-2026-q2 88912
```

Makna:

- User pernah klik campaign.

### 4.5 Compact Fraud/Compliance Signal

Untuk regulatory/enforcement platform:

```redis
SETBIT signal:reviewed-case:2026-Q2 778899 1
GETBIT signal:reviewed-case:2026-Q2 778899
```

Tetapi harus hati-hati:

- bitmap boleh jadi **operational accelerator**,
- bukan **audit record**.

Audit tetap harus disimpan di system of record yang bisa menjelaskan siapa, kapan, mengapa, evidence apa, dan transisi status apa.

---

## 5. Kapan Bitmap Tidak Cocok

Bitmap tidak cocok jika:

### 5.1 ID Bukan Integer Dense atau Semi-Dense

Kalau ID Anda UUID:

```text
550e8400-e29b-41d4-a716-446655440000
```

Tidak ada offset natural.

Anda bisa hash UUID ke offset, tetapi itu menimbulkan collision. Untuk exact membership, itu bukan bitmap biasa lagi; Anda masuk ke probabilistic structure seperti Bloom filter, yang tidak kita bahas detail di part ini.

### 5.2 Range ID Sangat Sparse

Misal user ID terbesar `9_000_000_000_000`, tetapi hanya ada 100 ribu user.

Kalau offset langsung memakai user ID, Redis perlu extend string sampai offset tersebut. Itu bisa menghancurkan memory.

Contoh buruk:

```redis
SETBIT dau:2026-06-20 9000000000000 1
```

Secara konseptual Anda meminta Redis membuat bit vector sampai offset yang sangat besar.

### 5.3 Butuh Daftar Member dengan Mudah

Bitmap bisa menghitung dan cek membership, tapi tidak nyaman untuk mengambil semua user yang bit-nya `1`.

Redis tidak menyediakan command “give me all offsets set to 1” dengan cara semudah `SMEMBERS`.

Bisa diproses manual dengan scan binary string, tetapi itu bukan operasi ringan untuk request path.

Kalau use case utama adalah enumerate member, Set atau Sorted Set biasanya lebih cocok.

### 5.4 Butuh Metadata Per Member

Bitmap hanya menyimpan 0/1.

Kalau perlu:

- timestamp,
- reason,
- actor,
- source,
- status,
- evidence,
- score,
- state transition,

maka bitmap tidak cukup.

### 5.5 Butuh Audit Defensibility

Bitmap tidak menjelaskan sejarah.

Contoh:

```redis
GETBIT enforcement:case-reviewed:2026-Q2 123456
```

Jawaban `1` hanya berarti “pernah ditandai reviewed menurut aplikasi”. Tidak menjawab:

- siapa reviewer,
- kapan review terjadi,
- review outcome,
- dokumen pendukung,
- perubahan status,
- apakah pernah dibatalkan,
- apakah event diproses dua kali,
- apakah data sempat corrupt.

Untuk sistem regulatori, bitmap cocok sebagai derived state/cache/signal, bukan source of truth.

---

## 6. Memory Model Bitmap

Bitmap menyimpan bit dalam string. Jika offset tertinggi adalah `N`, maka ukuran minimum kira-kira:

```text
(N + 1) bits / 8 bytes
```

Contoh:

| Offset tertinggi | Kira-kira ukuran string |
|---:|---:|
| 999 | 125 bytes |
| 999,999 | 125 KB |
| 99,999,999 | 12.5 MB |
| 999,999,999 | 125 MB |

Redis String punya batas maksimum tertentu; dokumentasi Redis menyebut string binary-safe dan bitmap cocok untuk sampai miliaran bit, tetapi Anda tetap harus menghitung memory.

Rule praktis:

> Bitmap hemat kalau offset tertinggi masuk akal terhadap jumlah bit yang benar-benar Anda butuhkan.

Jangan hanya lihat jumlah member aktif. Lihat **max offset**.

Buruk:

```text
100 active users, max user id = 10_000_000_000
```

Baik:

```text
10 million users, max user id = 20 million
```

---

## 7. Offset Mapping: Keputusan Terpenting Bitmap

Bitmap butuh fungsi mapping:

```text
domain entity -> integer offset
```

Contoh sederhana:

```text
offset = userId
```

Tetapi ini hanya aman jika:

1. userId integer,
2. userId tidak terlalu sparse,
3. userId tidak berubah,
4. userId tidak multi-tenant collision tanpa namespace key,
5. userId tidak mengandung informasi sensitif yang bocor lewat key/offset observability.

Untuk multi-tenant:

```text
bitmap:dau:{tenantId}:2026-06-20
```

Offset:

```text
offset = tenantLocalUserNumericId
```

Atau:

```text
bitmap:dau:2026-06-20:{tenantId}
```

Jika Redis Cluster dipakai, pertimbangkan hash tag:

```text
bitmap:dau:{tenant-42}:2026-06-20
bitmap:dau:{tenant-42}:2026-06-19
```

Hash tag `{tenant-42}` membuat key terkait tenant yang sama masuk slot yang sama. Ini bisa membantu beberapa operasi multi-key, tetapi juga bisa membuat hot slot kalau tenant besar.

Jadi desain key harus menimbang:

- kebutuhan BITOP antar hari,
- distribusi cluster,
- hot tenant,
- operational isolation.

---

## 8. Command Bitmap Detail

### 8.1 SETBIT

```redis
SETBIT key offset value
```

Contoh:

```redis
SETBIT dau:2026-06-20 1001 1
```

Return value adalah nilai bit sebelumnya.

Ini berguna untuk mendeteksi first-seen:

```redis
SETBIT dau:2026-06-20 1001 1
```

Jika return `0`, berarti user baru pertama kali ditandai aktif di key itu.

Jika return `1`, berarti user sudah pernah aktif.

Use case:

- increment exact daily unique counter hanya saat previous bit `0`,
- detect first participation,
- avoid duplicate side effect.

Namun hati-hati: jika Anda melakukan `SETBIT` lalu command lain secara terpisah, operasi multi-step tidak atomic secara keseluruhan kecuali memakai Lua/Function.

### 8.2 GETBIT

```redis
GETBIT key offset
```

Contoh:

```redis
GETBIT feature:beta-checkout:tenant-42 1001
```

Return:

```text
0 or 1
```

Jika key tidak ada atau offset belum diset, Redis menganggap bit `0`.

Artinya missing key dan bit false terlihat sama dari hasil `GETBIT`.

Kontrak aplikasi harus jelas:

```text
0 means not eligible? or unknown? or key missing due to Redis failure? or data not loaded yet?
```

Untuk fitur kritikal, bedakan:

- key absent,
- key present but bit 0,
- Redis unavailable,
- data generation incomplete.

### 8.3 BITCOUNT

```redis
BITCOUNT key
```

Contoh:

```redis
BITCOUNT dau:2026-06-20
```

Menghitung jumlah bit `1`.

Secara konseptual ini adalah population count.

Perhatikan:

- `BITCOUNT` pada seluruh bitmap besar bisa menjadi operasi mahal.
- Dokumentasi Redis menandai `BITCOUNT` sebagai O(N) terhadap jumlah byte yang diperiksa.
- Untuk request path latency-critical, hati-hati menghitung bitmap besar berkali-kali.

Strategi:

1. Hitung `BITCOUNT` async/background.
2. Cache hasil count di key terpisah.
3. Hitung interval tertentu saja jika cocok.
4. Gunakan HyperLogLog jika hanya butuh approximate cardinality.

### 8.4 BITOP

```redis
BITOP AND dest key1 key2
BITOP OR dest key1 key2
BITOP XOR dest key1 key2
BITOP NOT dest key
```

Use case:

#### DAU union dua produk

```redis
BITOP OR dau:combined:2026-06-20 dau:web:2026-06-20 dau:mobile:2026-06-20
BITCOUNT dau:combined:2026-06-20
```

#### Retention: aktif hari 1 dan hari 7

```redis
BITOP AND retention:d1-d7:2026-06-13 dau:2026-06-13 dau:2026-06-20
BITCOUNT retention:d1-d7:2026-06-13
```

#### Users active yesterday but not today

```redis
BITOP NOT dau:not-today:2026-06-20 dau:2026-06-20
BITOP AND churn-risk:2026-06-20 dau:2026-06-19 dau:not-today:2026-06-20
BITCOUNT churn-risk:2026-06-20
```

Namun `NOT` dapat membuat string sebesar input. Gunakan dengan hati-hati.

### 8.5 BITPOS

```redis
BITPOS key 1
BITPOS key 0
```

Mencari posisi bit pertama bernilai tertentu.

Use case:

- mencari available slot,
- mencari first active marker,
- debugging.

Untuk enumeration penuh, `BITPOS` bukan solusi lengkap kecuali dipakai dalam loop dengan range/offset yang hati-hati.

---

## 9. Bitmap Pattern: Daily Active Users

### 9.1 Requirements

Kita ingin mencatat user aktif harian:

- exact count untuk user ID numeric,
- update cepat,
- bisa cek apakah user aktif hari tertentu,
- bisa hitung retention dengan operasi bitwise,
- data boleh derived dari event log/source of truth.

### 9.2 Key Design

```text
bitmap:dau:{yyyy-mm-dd}
```

Contoh:

```text
bitmap:dau:2026-06-20
```

### 9.3 Write Path

Saat event aktivitas diterima:

```redis
SETBIT bitmap:dau:2026-06-20 1001 1
EXPIRE bitmap:dau:2026-06-20 34560000
```

TTL 400 hari misalnya.

Tapi jangan set `EXPIRE` setiap event tanpa berpikir. Itu memperbarui TTL terus. Untuk daily key, sebaiknya TTL diset saat key dibuat atau dengan Lua yang hanya set TTL saat first write.

### 9.4 Lua untuk Set Bit + TTL Only on First Creation

Pseudo Lua:

```lua
local existed = redis.call('EXISTS', KEYS[1])
local old = redis.call('SETBIT', KEYS[1], ARGV[1], 1)
if existed == 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return old
```

Makna return:

- `0`: user first active for that day.
- `1`: already active.

### 9.5 Count Path

```redis
BITCOUNT bitmap:dau:2026-06-20
```

Untuk dashboard, lakukan periodik, bukan setiap request.

### 9.6 Retention

```redis
BITOP AND bitmap:retention:2026-06-13:2026-06-20 bitmap:dau:2026-06-13 bitmap:dau:2026-06-20
BITCOUNT bitmap:retention:2026-06-13:2026-06-20
EXPIRE bitmap:retention:2026-06-13:2026-06-20 3600
```

Destination key sebaiknya diberi TTL karena derived temporary result.

### 9.7 Failure Modes

| Failure | Dampak | Mitigasi |
|---|---|---|
| Event tidak sampai Redis | DAU undercount | Rebuild dari event log/source of truth |
| User ID sparse sangat besar | Memory blow-up | Offset remapping atau HLL |
| BITCOUNT terlalu sering | Latency spike | Precompute/cache count |
| Key tidak diberi TTL | Memory leak | Key policy + monitor |
| Redis data dianggap audit | Compliance risk | Simpan audit di system of record |

---

## 10. Java Implementation: Bitmap dengan Lettuce

Contoh conceptual service.

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

public final class DailyActiveUserBitmapService {
    private final RedisCommands<String, String> redis;
    private final long ttlSeconds;

    public DailyActiveUserBitmapService(StatefulRedisConnection<String, String> connection,
                                        long ttlSeconds) {
        this.redis = connection.sync();
        this.ttlSeconds = ttlSeconds;
    }

    public boolean markActive(LocalDate date, long numericUserId) {
        validateOffset(numericUserId);
        String key = key(date);

        Long previous = redis.setbit(key, numericUserId, 1);

        // Simplified. In production, set TTL only on first creation using Lua/Function.
        redis.expire(key, ttlSeconds);

        return previous != null && previous == 0L;
    }

    public boolean wasActive(LocalDate date, long numericUserId) {
        validateOffset(numericUserId);
        Long bit = redis.getbit(key(date), numericUserId);
        return bit != null && bit == 1L;
    }

    public long countActive(LocalDate date) {
        Long count = redis.bitcount(key(date));
        return count == null ? 0L : count;
    }

    private static String key(LocalDate date) {
        return "bitmap:dau:" + date.format(DateTimeFormatter.ISO_LOCAL_DATE);
    }

    private static void validateOffset(long offset) {
        if (offset < 0) {
            throw new IllegalArgumentException("Bitmap offset must be non-negative");
        }
        // Add business-specific max offset guard.
        if (offset > 100_000_000L) {
            throw new IllegalArgumentException("Bitmap offset exceeds configured safety limit");
        }
    }
}
```

Production improvements:

1. Use Lua to set TTL only when key created.
2. Add metrics for max offset seen.
3. Add guardrail for unexpectedly large offset.
4. Avoid `BITCOUNT` in synchronous user request path.
5. Consider async/reactive for high-throughput ingestion.
6. Use key builder with tenant/bounded context.
7. Consider Redis Cluster hash tags for related keys.

---

## 11. Bitmap Pattern: Feature Flags at Scale

Suppose you need fast eligibility check:

```text
Is user 1001 eligible for feature checkout-v2 in tenant 42?
```

Key:

```text
bitmap:feature:{tenant-42}:checkout-v2
```

Command:

```redis
GETBIT bitmap:feature:{tenant-42}:checkout-v2 1001
```

Update eligibility:

```redis
SETBIT bitmap:feature:{tenant-42}:checkout-v2 1001 1
SETBIT bitmap:feature:{tenant-42}:checkout-v2 1002 0
```

Advantages:

- extremely fast check,
- compact for large cohorts,
- simple rollout snapshot.

Risks:

- cannot explain why user is eligible,
- cannot encode rule version,
- cannot easily enumerate all eligible users,
- stale snapshot risk,
- offset mapping must be stable.

Better design:

```text
bitmap:feature:{tenant-42}:checkout-v2:v17
string:feature:{tenant-42}:checkout-v2:active-version = v17
hash:feature:{tenant-42}:checkout-v2:meta = {generatedAt, ruleHash, sourceDatasetId}
```

Read flow:

1. Read active version.
2. `GETBIT` on versioned bitmap.
3. Use metadata for observability/debug.

This avoids mutating the same bitmap in-place without version traceability.

---

## 12. Bitmap Pattern: Compliance/Enforcement Signal

In regulatory lifecycle systems, you may want a fast check:

```text
Has case X already been included in nightly risk scan?
```

Bitmap can help:

```redis
SETBIT bitmap:risk-scan:{2026-06-20} 987654 1
GETBIT bitmap:risk-scan:{2026-06-20} 987654
```

But this must be treated as derived state.

Correct architecture:

```text
System of record:
  risk_scan_case_result table / event log / audit store

Redis bitmap:
  derived accelerator for fast membership check/count

Rebuild path:
  source of truth -> regenerate bitmap

Reconciliation:
  compare source count vs BITCOUNT periodically
```

The invariant:

> Redis bitmap may accelerate enforcement workflow, but must not be the only proof that a case was reviewed, classified, escalated, or notified.

---

## 13. Bitfields: Many Small Integers Inside a Redis String

Bitmap stores one bit per entity.

Bitfield generalizes this: store integer fields of arbitrary bit length in a binary string.

Redis bitfields let you operate on signed/unsigned integers with specific width and offset.

Command:

```redis
BITFIELD key [GET encoding offset | SET encoding offset value | INCRBY encoding offset increment ...]
```

Examples:

```redis
BITFIELD counters:hourly GET u8 0
BITFIELD counters:hourly SET u8 0 42
BITFIELD counters:hourly INCRBY u8 0 1
```

Meaning:

- Use unsigned 8-bit integer at bit offset `0`.
- It can store values `0..255`.

Encoding examples:

```text
u1   unsigned 1-bit integer: 0..1
u8   unsigned 8-bit integer: 0..255
u16  unsigned 16-bit integer: 0..65535
u32  unsigned 32-bit integer

i8   signed 8-bit integer: -128..127
i16  signed 16-bit integer
```

Bitfields are useful when you need many compact counters with small bounded range.

---

## 14. Bitfield Mental Model

Imagine packing small counters into a byte array.

Java conceptual model:

```java
byte[] storage = new byte[...];
// counter i occupies a fixed bit range.
```

Redis Bitfield gives command-level operations to read/write/increment those packed counters.

For example, 24 hourly counters in one key, each `u16`:

```text
hour 0 -> bit offset 0
hour 1 -> bit offset 16
hour 2 -> bit offset 32
...
hour 23 -> bit offset 368
```

Key:

```text
bitfield:api-usage:tenant-42:2026-06-20
```

Set/increment hour 13:

```redis
BITFIELD bitfield:api-usage:tenant-42:2026-06-20 INCRBY u16 208 1
```

Because:

```text
13 * 16 = 208
```

---

## 15. Bitfield Offset Planning

This is the most important part.

You need define:

```text
fieldWidthBits = 16
index = hourOfDay
offset = index * fieldWidthBits
encoding = u16
```

For 24 hourly counters:

| Hour | Offset | Encoding |
|---:|---:|---|
| 0 | 0 | u16 |
| 1 | 16 | u16 |
| 2 | 32 | u16 |
| ... | ... | ... |
| 23 | 368 | u16 |

For per-minute counters in a day:

```text
1440 counters/day
u16 each
1440 * 16 bits = 23040 bits = 2880 bytes
```

That is only ~2.8 KB per key for 1440 small counters.

A Hash with 1440 fields would be far larger.

---

## 16. Bitfield Overflow Semantics

Small counters can overflow.

Redis Bitfield supports overflow behavior:

```redis
OVERFLOW WRAP
OVERFLOW SAT
OVERFLOW FAIL
```

### 16.1 WRAP

Wrap around.

For `u8`:

```text
255 + 1 -> 0
```

Dangerous for counters unless wrap is intended.

### 16.2 SAT

Saturate at min/max.

For `u8`:

```text
255 + 1 -> 255
```

Useful for “cap at max” semantics.

### 16.3 FAIL

Fail operation if overflow occurs.

This is often best when correctness matters.

Example:

```redis
BITFIELD usage:tenant-42 OVERFLOW FAIL INCRBY u16 208 1
```

If value would exceed `65535`, Redis returns null for that subcommand.

Application can then escalate:

- switch to wider encoding in a new key version,
- record overflow metric,
- fall back to Hash/ZSet/SQL,
- trigger alert.

---

## 17. Bitfield Use Cases

### 17.1 Compact Per-Minute Counters

Key:

```text
bitfield:req-count:{tenant-42}:2026-06-20
```

Mapping:

```text
minuteOfDay = hour * 60 + minute
encoding = u16
offset = minuteOfDay * 16
```

Increment:

```redis
BITFIELD bitfield:req-count:{tenant-42}:2026-06-20 OVERFLOW SAT INCRBY u16 7680 1
```

For 08:00:

```text
minuteOfDay = 480
offset = 480 * 16 = 7680
```

### 17.2 Compact Status Buckets

Suppose each case can have compact daily state:

```text
0 = none
1 = queued
2 = reviewed
3 = escalated
```

That fits in `u2`.

Offset:

```text
caseLocalIndex * 2
```

But be careful: if lifecycle matters, this is only a derived snapshot, not audit.

### 17.3 Small Quota Counters

If tenant has bounded per-hour quota <= 65535:

```text
u16 per hour
24 counters/day
```

But if quota can exceed 65535, do not use `u16` unless overflow handling is designed.

### 17.4 Feature Experiment Exposure Count by Bucket

For A/B bucket counts:

```text
bucket 0..99
u32 per bucket
offset = bucket * 32
```

This is compact and predictable.

---

## 18. Bitfield Java Implementation

Example for per-minute request count.

```java
import io.lettuce.core.api.sync.RedisCommands;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public final class PerMinuteBitfieldCounter {
    private static final int FIELD_WIDTH = 16;
    private static final long MAX_U16 = 65_535L;

    private final RedisCommands<String, String> redis;

    public PerMinuteBitfieldCounter(RedisCommands<String, String> redis) {
        this.redis = redis;
    }

    public long increment(String tenantId, LocalDateTime timestamp) {
        String key = key(tenantId, timestamp.toLocalDate());
        int minuteOfDay = timestamp.getHour() * 60 + timestamp.getMinute();
        int bitOffset = minuteOfDay * FIELD_WIDTH;

        // Lettuce exposes bitfield APIs, but exact API shape may vary by version.
        // If client abstraction is awkward, use dispatch/custom command or Lua.
        // Pseudo-command:
        // BITFIELD key OVERFLOW FAIL INCRBY u16 bitOffset 1
        throw new UnsupportedOperationException("Use client-specific BITFIELD API or Lua wrapper");
    }

    private static String key(String tenantId, LocalDate date) {
        return "bitfield:req-count:{" + tenantId + "}:" + date.format(DateTimeFormatter.ISO_LOCAL_DATE);
    }
}
```

In production, it is often cleaner to wrap Bitfield behind a dedicated adapter:

```java
public interface CompactCounterStore {
    IncrementResult incrementMinuteCounter(String tenantId, LocalDateTime time, long delta);
    long getMinuteCounter(String tenantId, LocalDate date, int minuteOfDay);
}
```

Do not leak raw bit offsets throughout the codebase.

Bad:

```java
redis.bitfield(key, "u16", 7680, 1); // random magic offset everywhere
```

Good:

```java
counterStore.incrementMinuteCounter(tenantId, now, 1);
```

The adapter owns:

- key pattern,
- offset math,
- encoding,
- overflow policy,
- TTL,
- metrics,
- migration/versioning.

---

## 19. Bitfield Schema Evolution

Bitfield is compact because schema is implicit. That is also the danger.

If you change from `u16` to `u32`, old data cannot simply be read with the new encoding.

Bad evolution:

```text
v1: u16 per minute
v2: u32 per minute using same key
```

This corrupts interpretation.

Better:

```text
bitfield:req-count:v1:{tenant}:2026-06-20
bitfield:req-count:v2:{tenant}:2026-06-20
```

Migration options:

1. Keep v1 until TTL expires; write new data to v2.
2. Dual-write for transition period.
3. Background convert v1 to v2.
4. Store version metadata.

Metadata key:

```redis
HSET bitfield:req-count:meta version v2 fieldWidth 32 encoding u32 createdBy service-a
```

But metadata cannot replace key versioning. It only helps humans/tools.

---

## 20. HyperLogLog: Approximate Cardinality

HyperLogLog estimates the number of unique elements.

Command utama:

```redis
PFADD key element [element ...]
PFCOUNT key [key ...]
PFMERGE destkey sourcekey [sourcekey ...]
```

Example:

```redis
PFADD hll:uv:2026-06-20 visitor-a
PFADD hll:uv:2026-06-20 visitor-b
PFADD hll:uv:2026-06-20 visitor-a
PFCOUNT hll:uv:2026-06-20
```

If `visitor-a` appears twice, cardinality estimate still treats it as one unique element conceptually.

Important:

> HyperLogLog does not store the actual set of members in a way you can retrieve. It stores probabilistic state for estimating unique count.

So you cannot ask:

```text
Which visitors were unique?
```

You can only estimate:

```text
How many unique visitors were observed?
```

Redis documentation describes HyperLogLog as probabilistic and suited for approximated cardinality. It uses small fixed memory compared to exact Set for large cardinalities.

---

## 21. HyperLogLog vs Set

| Requirement | Set | HyperLogLog |
|---|---|---|
| Exact membership | Yes | No |
| Exact cardinality | Yes | No, approximate |
| Enumerate members | Yes | No |
| Memory for huge unique count | High | Very low |
| Deduplicate side effects | Yes | No |
| Analytics dashboard | Good but costly | Often excellent |
| Audit/compliance proof | Possible with source data | No |

Use Set when:

- need exact membership,
- need enumerate members,
- count must be exact,
- size is manageable.

Use HyperLogLog when:

- only need approximate unique count,
- volume is very large,
- small error is acceptable,
- no need to list members.

---

## 22. HyperLogLog Use Cases

### 22.1 Unique Visitors per Day

```redis
PFADD hll:unique-visitors:2026-06-20 visitor-123
PFCOUNT hll:unique-visitors:2026-06-20
```

Good for analytics.

Not good for billing if billing requires exact count.

### 22.2 Unique API Consumers per Endpoint

```redis
PFADD hll:api-consumers:/v1/payments:2026-06-20 client-abc
PFCOUNT hll:api-consumers:/v1/payments:2026-06-20
```

Useful for capacity/product analytics.

### 22.3 Unique Cases Touched by Rule Engine

```redis
PFADD hll:rule-engine:touched-cases:2026-06-20 case-778899
PFCOUNT hll:rule-engine:touched-cases:2026-06-20
```

Useful as operational telemetry.

But not proof of case processing.

### 22.4 Unique Error Fingerprints

```redis
PFADD hll:error-fingerprints:service-a:2026-06-20 error-hash-1
PFCOUNT hll:error-fingerprints:service-a:2026-06-20
```

Good for observing diversity of failures.

---

## 23. PFMERGE: Combining HyperLogLogs

You can merge multiple HLLs:

```redis
PFMERGE hll:uv:week-2026-W25 hll:uv:2026-06-15 hll:uv:2026-06-16 hll:uv:2026-06-17 hll:uv:2026-06-18 hll:uv:2026-06-19 hll:uv:2026-06-20 hll:uv:2026-06-21
PFCOUNT hll:uv:week-2026-W25
```

This gives estimated unique visitors across the week.

Important: do not sum daily `PFCOUNT` values to get weekly unique.

Wrong:

```text
weeklyUnique = PFCOUNT(day1) + PFCOUNT(day2) + ...
```

That double-counts users active on multiple days.

Correct:

```text
PFMERGE weeklyHll dailyHlls...
PFCOUNT weeklyHll
```

Or call `PFCOUNT` with multiple keys if supported for your need, but understand performance and semantics.

---

## 24. HyperLogLog Error Boundary

HyperLogLog is approximate.

This means:

```text
actual unique = 1,000,000
PFCOUNT may return around 992,000 or 1,008,000 or similar depending on error properties
```

The exact error characteristics depend on implementation, but the key point for architecture is:

> HLL answers are estimates. They must not be used where exact cardinality is a legal, financial, contractual, or enforcement requirement.

Good:

- dashboard trend,
- product analytics,
- capacity planning,
- rough uniqueness,
- anomaly signal.

Bad:

- invoice exact billable users,
- legal count of affected users,
- regulatory breach report exact count,
- exact enforcement eligibility,
- deduplication before executing side effect.

For critical counts, store source events or exact dedupe set/table.

---

## 25. Java Implementation: HyperLogLog

Example service:

```java
import io.lettuce.core.api.sync.RedisCommands;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

public final class UniqueVisitorEstimator {
    private final RedisCommands<String, String> redis;
    private final long ttlSeconds;

    public UniqueVisitorEstimator(RedisCommands<String, String> redis, long ttlSeconds) {
        this.redis = redis;
        this.ttlSeconds = ttlSeconds;
    }

    public boolean observe(LocalDate date, String visitorId) {
        String key = key(date);
        Long changed = redis.pfadd(key, visitorId);
        redis.expire(key, ttlSeconds);

        // PFADD returns 1 if internal HLL representation was modified, 0 otherwise.
        // It does NOT mean "this visitor was definitely new" in an exact membership sense.
        return changed != null && changed == 1L;
    }

    public long estimate(LocalDate date) {
        Long count = redis.pfcount(key(date));
        return count == null ? 0L : count;
    }

    private static String key(LocalDate date) {
        return "hll:unique-visitors:" + date.format(DateTimeFormatter.ISO_LOCAL_DATE);
    }
}
```

Important warning:

```java
boolean changed = observe(date, visitorId);
```

Do **not** interpret `changed == true` as “visitor was definitely new”. HyperLogLog internal state modification is not the same as exact first-seen detection.

For exact first-seen:

```redis
SADD exact:visitors:2026-06-20 visitor-123
```

or a database unique constraint.

---

## 26. Choosing Between Bitmap, Bitfield, HyperLogLog, Set, Hash, ZSet

### 26.1 Decision Table

| Need | Best candidate |
|---|---|
| Exact boolean by numeric ID | Bitmap |
| Exact boolean by UUID | Set or Bloom filter-like structure, not plain bitmap |
| Exact unique count + enumerate | Set |
| Approx unique count only | HyperLogLog |
| Many small bounded counters | Bitfield |
| Per-entity fields | Hash |
| Ranking/time/score | Sorted Set |
| Event history | Stream or external log |
| Audit trail | Database/event store, not compact Redis only |

### 26.2 Key Question

Ask:

```text
Do I need exactness or approximation?
Do I need membership or only count?
Do I need enumeration?
Do I have numeric dense offsets?
Do I need per-item metadata?
Can this be rebuilt?
What happens if Redis evicts/expires/corrupts this derived state?
```

---

## 27. Compact Structures and Redis Cluster

Bitmap/Bitfield/HyperLogLog are stored under Redis keys like other structures.

Cluster concerns:

### 27.1 Single-Key Operations

Commands on one key are straightforward.

```redis
SETBIT bitmap:dau:{tenant-42}:2026-06-20 1001 1
PFADD hll:uv:{tenant-42}:2026-06-20 visitor-a
```

### 27.2 Multi-Key Operations

Commands like `BITOP`, `PFMERGE`, or multi-key `PFCOUNT` need source/destination keys compatible with cluster slot constraints.

Use hash tags carefully:

```text
bitmap:dau:{tenant-42}:2026-06-19
bitmap:dau:{tenant-42}:2026-06-20
bitmap:retention:{tenant-42}:2026-06-19:2026-06-20
```

All have `{tenant-42}` and therefore can land in same slot.

But if tenant is huge, this concentrates load.

Alternative:

- compute per shard/client side,
- avoid server-side multi-key operations,
- partition by date instead of tenant,
- run offline analytics outside Redis.

There is no universal answer. Cluster key design must match query pattern and hot key risk.

---

## 28. TTL and Lifecycle

Compact structures often represent time windows:

```text
daily active users
weekly unique visitors
hourly counters
campaign exposure
rule-engine touched cases
```

Every key should have lifecycle policy.

Example TTL policy:

| Key | TTL |
|---|---:|
| `bitmap:dau:*` | 400 days |
| `hll:unique-visitors:*` | 400 days |
| `bitfield:req-count:*` | 30 days |
| temporary BITOP result | 1 hour |
| experiment eligibility bitmap | until experiment end + 30 days |

Never leave analytics-derived compact keys unbounded unless there is explicit retention policy.

Bad:

```redis
SETBIT bitmap:dau:2026-06-20 1001 1
```

Good:

```redis
SETBIT bitmap:dau:2026-06-20 1001 1
EXPIRE bitmap:dau:2026-06-20 34560000
```

Better:

- TTL set only when key first created,
- retention documented,
- metrics for key count and memory,
- periodic scan/report by prefix.

---

## 29. Observability

For compact structures, standard Redis metrics are not enough. You need domain metrics.

### 29.1 Bitmap Metrics

Track:

- max offset observed,
- number of bitmap keys,
- BITCOUNT results,
- SETBIT QPS,
- unexpected large offset rejection,
- memory usage per key sample,
- latency of BITCOUNT/BITOP.

### 29.2 Bitfield Metrics

Track:

- overflow count,
- saturation count,
- field width version,
- max counter observed,
- failed increments,
- key TTL coverage,
- client-side offset calculation errors.

### 29.3 HyperLogLog Metrics

Track:

- PFADD QPS,
- PFCOUNT estimate,
- source event count vs estimate ratio,
- number of HLL keys,
- merge latency,
- dashboard consumers.

### 29.4 Redis Native Commands

Useful commands:

```redis
MEMORY USAGE key
TYPE key
TTL key
BITCOUNT key
PFCOUNT key
INFO memory
INFO commandstats
SLOWLOG GET
```

Be careful using expensive commands on large keys during incidents.

---

## 30. Testing Strategy

### 30.1 Bitmap Tests

Test:

1. offset mapping,
2. negative offset rejection,
3. max offset guard,
4. first-set return behavior,
5. TTL assignment,
6. BITCOUNT correctness for small sample,
7. BITOP retention logic.

Example:

```java
@Test
void markActiveShouldReturnTrueOnlyFirstTime() {
    LocalDate date = LocalDate.of(2026, 6, 20);

    assertTrue(service.markActive(date, 1001));
    assertFalse(service.markActive(date, 1001));
    assertTrue(service.wasActive(date, 1001));
    assertEquals(1, service.countActive(date));
}
```

### 30.2 Bitfield Tests

Test:

1. offset calculation,
2. each bucket mapping,
3. overflow behavior,
4. version migration,
5. TTL,
6. reading old version.

Critical test:

```text
minute 0 offset = 0
minute 1 offset = 16
minute 1439 offset = 23024
```

### 30.3 HyperLogLog Tests

Do not assert exact count for large values.

Bad:

```java
assertEquals(1_000_000, estimator.estimate(date));
```

Better:

```java
long estimate = estimator.estimate(date);
assertTrue(estimate > 990_000 && estimate < 1_010_000);
```

For small cardinalities, HLL may be exact or near exact depending on representation, but tests should not rely on exactness unless Redis docs guarantee it for that case.

### 30.4 Rebuild Tests

Because these structures are often derived, test rebuild path:

```text
source events -> regenerate bitmap/HLL/bitfield -> compare expected signal/count
```

For regulatory systems, this is crucial.

---

## 31. Failure Modeling

### 31.1 Bitmap Failure Matrix

| Scenario | Result | Design response |
|---|---|---|
| Redis key missing | All bits read as 0 | Distinguish absent vs false if needed |
| Wrong offset mapping | Silent wrong result | Centralize mapper + tests |
| Huge offset | Memory blow-up | Guard max offset |
| BITCOUNT on hot path | Latency spike | Precompute/cache count |
| Source event missed | Undercount | Rebuild/reconcile |

### 31.2 Bitfield Failure Matrix

| Scenario | Result | Design response |
|---|---|---|
| Counter overflow wrap | Silent wrong count | Use `OVERFLOW FAIL` or `SAT` intentionally |
| Encoding changed | Misread data | Version key schema |
| Offset bug | Counter collision | Centralize layout |
| Need bigger values | Data model too small | Migrate to wider field or Hash |
| Multi-writer high QPS | Redis hot key | Shard counters or aggregate later |

### 31.3 HyperLogLog Failure Matrix

| Scenario | Result | Design response |
|---|---|---|
| Used for exact billing | Incorrect billing | Use exact store |
| Need member list | Impossible | Use Set/source events |
| Summing daily counts | Overcount | Use PFMERGE/multi-key count |
| Estimate misinterpreted | Bad decision | Label as approximate |
| Source events missing | Underestimate | Rebuild from source |

---

## 32. Regulatory and Audit Boundary

This part is especially important for enforcement lifecycle systems.

Compact structures are tempting because they are fast and cheap. But they often destroy explanatory detail.

### 32.1 Safe Uses in Regulatory Systems

Safe as:

- derived indicator,
- dashboard metric,
- optimization layer,
- pre-filter,
- rate/quota helper,
- transient state,
- rebuildable projection.

Examples:

```text
bitmap:case-seen-in-batch:{batchId}
hll:unique-entities-touched:{date}
bitfield:hourly-rule-hit-count:{ruleId}:{date}
```

### 32.2 Unsafe Uses

Unsafe as the only record for:

- official case status,
- enforcement decision,
- legal notification,
- fine calculation,
- exact affected population,
- approval/rejection history,
- audit trail.

### 32.3 Required Invariants

For critical systems:

```text
Redis compact state must be derivable from durable source records.
Redis compact state must have retention policy.
Approximate metrics must be labeled approximate.
Exact decisions must not depend solely on probabilistic counts.
Bitmap/bitfield offset mapping must be versioned and testable.
```

This is not bureaucracy. It is how you prevent invisible data corruption from becoming legal/operational failure.

---

## 33. Practical Design Review Checklist

Before approving Bitmap/Bitfield/HLL usage, ask:

### 33.1 Correctness

- Is the result exact or approximate?
- Is approximation acceptable?
- Who consumes the value?
- Could someone use it for billing/audit/enforcement incorrectly?
- Is the source of truth elsewhere?

### 33.2 Data Modeling

- What is the key pattern?
- What is the offset mapping?
- Is ID range bounded?
- Is the mapping stable?
- Is schema versioned?
- Is metadata available?

### 33.3 Memory

- What is max offset?
- What is expected key size?
- How many keys per day/tenant/campaign?
- What is retention?
- What happens for a malicious or buggy offset?

### 33.4 Latency

- Are expensive commands in request path?
- How often is `BITCOUNT` called?
- How often is `BITOP`/`PFMERGE` called?
- Are destination keys temporary?

### 33.5 Operations

- Are TTLs guaranteed?
- Are metrics available?
- Can data be rebuilt?
- Is there a reconciliation job?
- Are hot keys expected?
- Does cluster slot design match operations?

---

## 34. Anti-Patterns

### 34.1 Bitmap with UUID Hashing for Exact Membership

Bad:

```text
offset = hash(uuid) % 1_000_000
```

Then:

```text
GETBIT key offset == 1 means uuid exists
```

This is false because hash collision can happen.

If false positives are acceptable, you are designing a probabilistic membership filter, not exact bitmap membership.

### 34.2 HLL for Deduplication

Bad:

```text
PFADD processed-events eventId
if changed then process event
```

`PFADD` changed does not mean exactly new event. HLL is not dedupe storage.

Use:

```redis
SET idempotency:event:{eventId} started NX EX 86400
```

or database unique constraint.

### 34.3 Bitfield Without Overflow Policy

Bad:

```redis
BITFIELD key INCRBY u8 0 1
```

If value exceeds 255, behavior depends on overflow mode. Be explicit.

Better:

```redis
BITFIELD key OVERFLOW FAIL INCRBY u8 0 1
```

or:

```redis
BITFIELD key OVERFLOW SAT INCRBY u8 0 1
```

### 34.4 No Max Offset Guard

Bad:

```java
redis.setbit(key, userId, 1);
```

with no validation.

One bad user ID can allocate huge memory.

### 34.5 BITCOUNT on Every API Request

Bad:

```text
GET /dashboard/dau
  -> BITCOUNT bitmap:dau:today
```

If called frequently on large bitmap, this can add server load.

Better:

- compute periodically,
- cache count,
- expose last updated time,
- use async analytics.

### 34.6 Compact State as Undocumented Binary Schema

Bad:

```text
bitfield:tenant:42:data
```

No one knows:

- field width,
- offset formula,
- version,
- retention,
- owner.

Better:

```text
bitfield:req-count:v1:{tenant-42}:2026-06-20
hash:bitfield:req-count:v1:meta
```

plus ADR/test.

---

## 35. Lab: Build Compact Analytics Projection

### Goal

Build a small Java service that records:

1. exact daily active user signal with Bitmap,
2. approximate unique visitor count with HyperLogLog,
3. per-minute request counts with Bitfield or Hash fallback.

### Requirements

For each request:

```text
tenantId
userId numeric
visitorId string
endpoint
timestamp
```

Write:

```text
SETBIT bitmap:dau:{tenant}:{date} userId 1
PFADD hll:uv:{tenant}:{date} visitorId
BITFIELD bitfield:req-count:{tenant}:{date} INCRBY u16 minuteOffset 1
```

### Design Constraints

1. Validate `userId` max offset.
2. Version bitfield schema.
3. TTL all daily keys.
4. Do not use approximate count for exact billing.
5. Add metrics:
   - max user offset,
   - hll estimate,
   - bitfield overflow,
   - Redis command latency.
6. Add rebuild strategy from event log/source table.

### Suggested Classes

```text
CompactAnalyticsService
BitmapDauProjection
HyperLogLogUniqueVisitorEstimator
BitfieldMinuteCounter
RedisKeyFactory
RedisCompactStateProperties
CompactAnalyticsRebuildJob
```

### Test Cases

1. Same user active twice -> BITCOUNT remains 1.
2. Same visitor observed twice -> HLL estimate roughly unchanged.
3. Minute counter increments expected bucket.
4. Offset above max rejected.
5. TTL exists after write.
6. Bitfield overflow handled.
7. Rebuild from events produces expected bitmap count for small dataset.

---

## 36. Summary Mental Model

Bitmap:

> Exact boolean signal by integer offset. Extremely compact, but offset mapping is everything.

Bitfield:

> Packed integer fields inside Redis String. Excellent for many small bounded counters, dangerous without schema/version/overflow discipline.

HyperLogLog:

> Approximate unique count with tiny memory. Great for analytics, wrong for exact membership, dedupe, billing, or audit.

The deeper principle:

> Redis compact structures are not beginner shortcuts. They are advanced data representation tools. They reward clear invariants and punish vague semantics.

As a Java backend engineer, you should hide these structures behind domain-specific adapters, not scatter raw bit math and probabilistic semantics across services.

---

## 37. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. Why Redis Bitmap is implemented on top of String operations.
2. Why max offset matters more than number of active members.
3. Why Bitmap is bad for UUID exact membership.
4. How `SETBIT`, `GETBIT`, `BITCOUNT`, and `BITOP` support DAU/retention use cases.
5. Why `BITCOUNT` can be costly on large keys.
6. How Bitfield stores many small counters compactly.
7. Why Bitfield needs explicit overflow policy.
8. Why Bitfield schema changes require versioning.
9. What HyperLogLog estimates.
10. Why HLL cannot be used for deduplication or exact membership.
11. How `PFMERGE` avoids double-counting across time windows.
12. Why compact Redis state must be rebuildable in critical systems.
13. How to design Java adapters around these primitives.
14. How to review correctness, memory, latency, and audit boundaries.

---

## 38. References

- Redis documentation: Bitmaps.
- Redis documentation: `SETBIT`, `GETBIT`, `BITCOUNT`, `BITOP`, `BITPOS`.
- Redis documentation: Bitfields and `BITFIELD`.
- Redis documentation: HyperLogLog, `PFADD`, `PFCOUNT`, `PFMERGE`.
- Redis documentation: Redis data types.
- Redis documentation: Redis Cluster key hash tags and multi-key command constraints.
- Lettuce documentation for Redis command integration in Java.
- Spring Data Redis documentation for Redis operations abstraction.

---

## 39. Status Seri

```text
Part 018 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-019.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Redis Streams: Consumer Groups, Pending Entries, dan Practical Event Processing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-019.md">Part 019 — Geospatial, JSON, Search, dan Vector Set ➡️</a>
</div>
