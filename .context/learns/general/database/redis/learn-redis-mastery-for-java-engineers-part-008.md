# learn-redis-mastery-for-java-engineers-part-008.md

# Part 008 — TTL, Expiration, Eviction: Data Hilang Bukan Bug, Tapi Kontrak

> Seri: `learn-redis-mastery-for-java-engineers`  
> Part: `008`  
> Topik: TTL, expiration, eviction, lifecycle data, cache safety, memory pressure  
> Target pembaca: Java software engineer yang ingin memakai Redis secara production-grade  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-redis-mastery-for-java-engineers-part-007.md`  
> Bagian berikutnya: `learn-redis-mastery-for-java-engineers-part-009.md`

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita belajar data structures Redis: Strings, Hashes, Lists, Sets, dan Sorted Sets. Sekarang kita masuk ke salah satu konsep yang paling sering dianggap sederhana tetapi justru paling banyak menyebabkan incident: **TTL, expiration, dan eviction**.

Redis sering dipakai karena data bisa hilang secara otomatis. Ini powerful, tapi juga berbahaya.

Kesalahan mental model yang umum:

> “Redis key hilang berarti Redis error.”

Mental model yang benar:

> “Redis key hilang adalah bagian dari kontrak sistem, kecuali kita mendesain sebaliknya.”

Setelah bagian ini, kamu harus bisa:

1. membedakan **expiration** dan **eviction**;
2. memahami TTL sebagai bagian dari lifecycle data;
3. mendesain key yang boleh hilang dan key yang tidak boleh hilang;
4. memilih eviction policy secara sadar;
5. menghindari bug dari missing key;
6. membuat cache dan transient-state Redis yang aman;
7. membaca Redis metrics terkait expired/evicted keys;
8. menjelaskan failure mode Redis ketika memory pressure terjadi;
9. mendesain Redis usage yang defensible untuk backend Java production.

---

## 1. Core Thesis: Di Redis, “Missing Key” Harus Menjadi State Normal

Dalam SQL, row yang hilang biasanya berarti:

1. memang belum pernah dibuat;
2. sudah dihapus;
3. query salah;
4. transaction belum commit;
5. data corruption atau operational issue.

Dalam Redis, key yang hilang bisa berarti lebih banyak hal:

1. key belum pernah dibuat;
2. key sudah expired;
3. key di-evict karena memory pressure;
4. key sengaja dihapus;
5. key berada di node cluster lain tetapi client salah routing;
6. key belum direplikasi;
7. key hilang setelah failover karena replication async;
8. data tidak dipersist karena Redis dipakai sebagai cache;
9. key pernah ada tetapi TTL terlalu pendek;
10. key diganti karena naming collision;
11. key salah serialization/prefix;
12. key flush karena human/operator mistake.

Karena itu, Redis-backed design yang baik selalu punya aturan:

> **Every read from Redis must define what missing means.**

Contoh:

```text
GET cache:user:123
```

Kalau hasilnya `nil`, artinya apa?

Kemungkinan:

1. user tidak ada;
2. user ada tetapi cache miss;
3. cache expired;
4. cache evicted;
5. service belum warm-up;
6. key version berubah;
7. bug serialization;
8. Redis sedang failover;
9. client membaca dari replica stale;
10. tenant prefix salah.

Jika application code memperlakukan semua `nil` sebagai “user tidak ada”, maka sistem akan salah.

Untuk Java backend, aturan praktisnya:

```java
Optional<CachedUser> cached = userCache.get(userId);

if (cached.isPresent()) {
    return cached.get();
}

// Missing Redis key bukan berarti user tidak ada.
// Missing Redis key berarti harus resolve ke source of truth.
User user = userRepository.findById(userId)
        .orElseThrow(UserNotFoundException::new);

userCache.put(userId, user, ttl);
return user;
```

Redis missing key adalah signal, bukan final truth, kecuali key tersebut memang didesain sebagai source of truth yang durable — dan itu butuh pembuktian desain persistence, replication, backup, dan recovery.

---

## 2. Expiration vs Eviction

Dua konsep ini sering tertukar.

### 2.1 Expiration

**Expiration** adalah hilangnya key karena key tersebut memiliki TTL dan waktunya sudah habis.

Contoh:

```redis
SET session:abc user-123 EX 1800
```

Artinya:

```text
session:abc boleh hilang otomatis setelah sekitar 1800 detik.
```

Expiration adalah lifecycle yang kamu minta.

### 2.2 Eviction

**Eviction** adalah hilangnya key karena Redis mencapai batas memory (`maxmemory`) lalu perlu membuang key sesuai `maxmemory-policy`.

Contoh:

```conf
maxmemory 4gb
maxmemory-policy allkeys-lru
```

Artinya:

```text
Jika Redis butuh memory, Redis boleh membuang key yang dianggap least recently used dari seluruh keyspace.
```

Eviction adalah memory-pressure behavior.

### 2.3 Perbedaan Fundamental

| Aspek | Expiration | Eviction |
|---|---|---|
| Penyebab | TTL habis | Memory pressure |
| Dirancang per key? | Ya | Tidak langsung; tergantung policy |
| Bisa terjadi walau memory longgar? | Ya | Tidak |
| Bisa terjadi sebelum TTL habis? | Tidak karena expiration, tapi bisa karena eviction | Ya |
| Diaktifkan oleh | `EXPIRE`, `SET EX`, `PEXPIRE`, dsb | `maxmemory` + `maxmemory-policy` |
| Makna desain | lifecycle contract | overload/memory control contract |
| Harus dianggap normal? | Ya jika key punya TTL | Ya jika eviction policy mengizinkan |

Kalimat penting:

> TTL menjawab “berapa lama data ini valid atau boleh hidup.”  
> Eviction menjawab “apa yang harus dikorbankan saat memory tidak cukup.”

---

## 3. TTL sebagai Lifecycle Contract

TTL bukan hanya angka teknis.

TTL adalah kontrak domain dan operasional:

```text
Key ini boleh tetap ada maksimal selama X.
Jika hilang setelah X, sistem tetap benar.
Jika hilang sebelum X karena eviction, sistem juga harus punya fallback jika eviction policy mengizinkan.
```

Contoh TTL yang masuk akal:

| Use Case | TTL | Alasan |
|---|---:|---|
| login session | 30 menit - 24 jam | security dan UX |
| password reset token | 5 - 15 menit | security |
| email verification token | 10 menit - 24 jam | UX/security trade-off |
| API response cache | 30 detik - 10 menit | freshness |
| product catalog cache | 5 - 60 menit | data relatif stabil |
| exchange rate cache | sesuai SLA freshness | domain-specific |
| idempotency key payment | 24 jam - 7 hari | replay safety |
| deduplication event | sesuai replay window | event retention contract |
| rate limiter counter | window size + buffer | enforcement correctness |
| distributed lock | sangat pendek | lease safety |

TTL yang buruk:

```text
TTL = 1 day karena “kayaknya cukup”
```

TTL yang baik:

```text
TTL = 15 minutes because:
- source data can change within minutes,
- stale value beyond 15 minutes violates product requirement,
- expected request rate makes cache hit ratio acceptable,
- fallback source can tolerate miss rate,
- jitter is added to avoid synchronized expiration.
```

---

## 4. Basic TTL Commands

### 4.1 `EXPIRE`

```redis
SET user:123 "Alice"
EXPIRE user:123 60
```

Artinya key akan expired setelah 60 detik.

### 4.2 `PEXPIRE`

```redis
PEXPIRE user:123 1500
```

TTL dalam millisecond.

### 4.3 `TTL`

```redis
TTL user:123
```

Hasil umum:

```text
> 42   key exists and expires in 42 seconds
> -1   key exists but has no associated expire
> -2   key does not exist
```

### 4.4 `PTTL`

```redis
PTTL user:123
```

TTL dalam millisecond.

### 4.5 `PERSIST`

```redis
PERSIST user:123
```

Menghapus TTL dari key. Key menjadi persistent sampai dihapus atau di-evict.

### 4.6 `SET` dengan Expiry

Lebih baik:

```redis
SET session:abc user-123 EX 1800
```

Daripada:

```redis
SET session:abc user-123
EXPIRE session:abc 1800
```

Kenapa?

Karena command kedua adalah dua operasi terpisah. Jika proses crash di antara `SET` dan `EXPIRE`, key bisa hidup tanpa TTL.

Untuk Java production, prefer atomic set-with-TTL:

```redis
SET key value EX seconds
SET key value PX milliseconds
SET key value NX EX seconds
SET key value XX EX seconds
```

---

## 5. Atomicity: `SET` + TTL Harus Satu Command Jika Lifecycle Wajib

Ini bug klasik.

### 5.1 Buggy Pattern

```java
redis.set("reset-token:" + token, userId);
redis.expire("reset-token:" + token, Duration.ofMinutes(10));
```

Jika service crash setelah `SET` tetapi sebelum `EXPIRE`, reset token tidak punya TTL.

Untuk password reset, ini security bug.

### 5.2 Correct Pattern

```java
redis.set(
    "reset-token:" + token,
    userId,
    SetArgs.Builder.ex(Duration.ofMinutes(10).toSeconds())
);
```

Atau konsep Redis command-nya:

```redis
SET reset-token:abc user-123 EX 600
```

### 5.3 Rule

Jika key **harus** punya TTL, TTL harus dipasang pada operasi create/update yang sama.

```text
Never create mandatory-expiring keys with naked SET followed by EXPIRE.
```

---

## 6. TTL dan Mutation Semantics

TTL bisa hilang tanpa disadari ketika key di-overwrite.

Contoh:

```redis
SET user:123 "Alice" EX 60
TTL user:123
# 60

SET user:123 "Alice v2"
TTL user:123
# -1
```

Pada banyak operasi overwrite, TTL lama bisa hilang kecuali kamu menggunakan opsi yang mempertahankan TTL, misalnya `KEEPTTL` pada `SET`.

Contoh:

```redis
SET user:123 "Alice" EX 60
SET user:123 "Alice v2" KEEPTTL
TTL user:123
# still has TTL
```

Untuk Java engineer, ini penting saat melakukan refresh partial atau update cache.

Bad pattern:

```java
redis.set(cacheKey, serialize(newValue)); // TTL accidentally removed
```

Better:

```java
redis.set(cacheKey, serialize(newValue), SetArgs.Builder.ex(ttlSeconds));
```

Atau jika memang ingin mempertahankan TTL:

```redis
SET cache:user:123 "..." KEEPTTL
```

Rule:

> Every write path must explicitly decide whether TTL is reset, preserved, removed, or recalculated.

---

## 7. Passive Expiration dan Active Expiration

Redis tidak selalu menghapus semua expired keys tepat pada timestamp expiry.

Secara konseptual, Redis memakai dua mekanisme:

### 7.1 Passive Expiration

Key dicek saat diakses.

Contoh:

```redis
GET session:abc
```

Jika key sudah melewati expiry timestamp, Redis menghapus key dan mengembalikan `nil`.

### 7.2 Active Expiration

Redis secara periodik mengambil sampel key yang punya TTL dan menghapus key yang sudah expired.

Kenapa sampling?

Karena Redis tidak ingin scan semua key setiap saat. Scan semua key akan mahal dan bisa mengganggu latency.

### 7.3 Implikasi

TTL bukan real-time scheduling mechanism.

Jika kamu butuh job dieksekusi tepat pada waktu tertentu, jangan hanya mengandalkan key expiration sebagai scheduler akurat.

Bad design:

```text
Set key order-timeout:123 EX 900
Listen expired event
When expired event arrives, cancel order
```

Masalah:

1. expired event tidak guaranteed delivery seperti broker;
2. delay bisa terjadi;
3. Redis restart/failover bisa mengubah behavior;
4. keyspace notification bukan durable event log;
5. jika subscriber down, event hilang.

Better design:

1. gunakan Sorted Set sebagai time index;
2. worker polling due items;
3. store authoritative state di database;
4. make cancellation idempotent;
5. gunakan broker/scheduler durable jika butuh strict workflow.

TTL cocok untuk lifecycle cleanup, bukan workflow timer yang harus exact dan audit-grade.

---

## 8. TTL Accuracy: Jangan Menganggap Expiry sebagai Deadline Presisi

TTL menjamin Redis tidak akan mengembalikan key yang sudah dianggap expired saat key diakses. Tetapi Redis tidak menjamin key fisik langsung hilang pada detik yang persis sama untuk semua kondisi internal.

Penting membedakan:

```text
Logical expiry: key dianggap expired.
Physical deletion: memory key benar-benar dibebaskan.
```

Karena passive + active expiration, physical deletion bisa tertunda.

Untuk kebanyakan cache/session/token use case, ini tidak masalah.

Untuk use case seperti:

1. financial settlement deadline;
2. regulatory submission cutoff;
3. legal hold expiration;
4. workflow SLA enforcement;
5. fraud decision deadline;

Redis TTL saja biasanya tidak cukup sebagai sumber kebenaran. Gunakan source of truth yang menyimpan timestamp eksplisit.

Contoh better modeling:

```sql
payment_authorization(
    id,
    status,
    expires_at,
    created_at,
    updated_at
)
```

Redis boleh dipakai untuk acceleration:

```redis
SET payment-auth-cache:abc ... EX 900
```

Tapi keputusan authoritative tetap:

```java
if (authorization.expiresAt().isBefore(clock.instant())) {
    reject();
}
```

---

## 9. Expiration adalah Per-Key, Bukan Per-Field

Redis TTL berlaku pada key, bukan field di dalam Hash.

Contoh:

```redis
HSET user-session:abc userId 123 device ios csrf xyz
EXPIRE user-session:abc 1800
```

TTL berlaku untuk seluruh `user-session:abc`.

Tidak ada TTL native untuk field `csrf` saja di dalam Hash.

Jika field punya lifecycle berbeda, jangan taruh dalam key yang sama tanpa desain matang.

Bad model:

```text
Hash user:123
- profileName: no TTL
- temporaryOtp: TTL 5 minutes
- cachedRiskScore: TTL 30 seconds
- legalHoldFlag: no TTL
```

Ini buruk karena lifecycle berbeda bercampur dalam satu key.

Better:

```text
user:123:profile                 no TTL or long cache TTL
user:123:otp:<purpose>           TTL 5 minutes
user:123:risk-score              TTL 30 seconds
user:123:legal-hold              authoritative store elsewhere
```

Rule:

> Data with different lifecycle usually deserves different Redis keys.

---

## 10. TTL dan Key Schema

TTL harus tercermin dalam key design documentation.

Contoh key schema yang buruk:

```text
user:{id}
```

Tidak jelas:

1. ini cache atau source state?
2. TTL berapa?
3. owner service siapa?
4. format value apa?
5. missing berarti apa?
6. boleh dihapus siapa?

Key schema yang baik:

```text
Key:
  app:identity:v1:user-profile-cache:{userId}
Type:
  String JSON
Owner:
  identity-service
TTL:
  15 minutes + jitter 0-120 seconds
Source of truth:
  PostgreSQL identity.users
Missing semantics:
  cache miss; reload from PostgreSQL
Eviction safety:
  safe to evict
Invalidation:
  delete on user profile update event
Value version:
  profile-cache-v1
Max expected size:
  < 8 KB
```

Untuk Redis production, key schema harus diperlakukan seperti API contract.

---

## 11. Jitter: Mencegah Cache Avalanche

Jika banyak key dibuat dengan TTL sama, mereka bisa expired bersamaan.

Contoh buruk:

```java
Duration ttl = Duration.ofMinutes(10);
cache.put(key, value, ttl);
```

Jika 100.000 key di-warm-up dalam 1 menit, banyak key akan expired hampir bersamaan 10 menit kemudian.

Efek:

1. cache miss spike;
2. database spike;
3. service latency naik;
4. retry storm;
5. Redis refill storm;
6. cascading failure.

Solusi: TTL jitter.

```java
Duration baseTtl = Duration.ofMinutes(10);
Duration jitter = Duration.ofSeconds(ThreadLocalRandom.current().nextInt(0, 120));
Duration ttl = baseTtl.plus(jitter);
```

Atau jitter negatif/positif:

```java
long baseSeconds = 600;
long jitterSeconds = ThreadLocalRandom.current().nextLong(-60, 61);
long ttlSeconds = baseSeconds + jitterSeconds;
```

Rule:

> For high-cardinality cache keys, never use perfectly synchronized TTL if keys are created in bursts.

---

## 12. Negative Caching dan TTL Pendek

Negative caching adalah menyimpan hasil “tidak ditemukan” untuk menghindari repeated expensive lookup.

Contoh:

```text
GET cache:user:999
miss
SELECT * FROM users WHERE id = 999
not found
SET cache:user-not-found:999 true EX 60
```

Ini berguna untuk:

1. user id random attack;
2. bot scanning;
3. missing product lookup;
4. repeated invalid reference;
5. external API lookup result not found.

Tapi TTL harus pendek.

Kenapa?

Karena entity bisa muncul setelah sebelumnya tidak ada.

Bad:

```text
negative cache user not found for 24h
```

Jika user dibuat 5 menit kemudian, sistem masih menganggap tidak ada.

Better:

```text
negative cache TTL 15s - 2m, depending on domain
```

Java modeling:

```java
sealed interface UserLookupCache permits CachedUser, CachedUserNotFound {}

record CachedUser(UserDto user) implements UserLookupCache {}
record CachedUserNotFound(Instant cachedAt) implements UserLookupCache {}
```

Jangan serialisasi null secara ambigu.

Bad:

```java
redis.set(key, "null", EX, 60);
```

Better:

```json
{
  "kind": "NOT_FOUND",
  "cachedAt": "2026-06-20T10:00:00Z"
}
```

Atau gunakan key terpisah:

```text
cache:user:123                actual user cache
cache:user-not-found:123      negative marker
```

---

## 13. TTL untuk Session

Session adalah salah satu use case Redis paling umum.

Contoh:

```redis
SET session:token-abc "user-123" EX 1800
```

Pertanyaan desain:

1. Apakah session fixed expiration atau sliding expiration?
2. Apakah setiap request memperpanjang TTL?
3. Apakah refresh TTL dilakukan synchronously?
4. Bagaimana logout menghapus session?
5. Bagaimana account lock mematikan semua session?
6. Apakah Redis eviction boleh menghapus session aktif?
7. Apakah session harus survive Redis restart?
8. Bagaimana multi-device session dimodelkan?

### 13.1 Fixed Expiration

Session habis setelah waktu tertentu sejak login.

```text
login at 10:00
TTL 8 hours
expires at 18:00 regardless of activity
```

Pro:

1. lebih sederhana;
2. security lebih kuat;
3. predictable.

Kontra:

1. user aktif tetap bisa logout tiba-tiba.

### 13.2 Sliding Expiration

TTL diperpanjang setiap ada aktivitas.

```text
request at 10:00 -> TTL 30m
request at 10:20 -> TTL reset to 30m
request at 10:45 -> TTL reset to 30m
```

Pro:

1. UX lebih baik;
2. user aktif tetap login.

Kontra:

1. write amplification;
2. hot session key;
3. race condition;
4. harus ada absolute max lifetime;
5. lebih sulit diaudit.

Better model:

```json
{
  "userId": "123",
  "createdAt": "2026-06-20T10:00:00Z",
  "lastSeenAt": "2026-06-20T10:20:00Z",
  "absoluteExpiresAt": "2026-06-20T18:00:00Z"
}
```

Redis TTL bisa sliding, tapi application tetap cek `absoluteExpiresAt`.

### 13.3 Session dan Eviction

Jika session key di-evict, user akan logout.

Apakah itu acceptable?

Untuk many consumer apps: mungkin acceptable sebagai degraded behavior.

Untuk admin/regulatory case management platform: mungkin tidak acceptable tanpa audit dan UX handling.

Jika session tidak boleh hilang karena memory pressure:

1. jangan campur session dengan cache volatile besar;
2. gunakan Redis terpisah;
3. pilih eviction policy yang tidak membuang session;
4. capacity plan dengan headroom;
5. monitor evicted keys;
6. pertimbangkan persistent session store.

---

## 14. TTL untuk Token

Token seperti password reset, OTP, email verification, magic link, dan CSRF token punya security property.

Example:

```redis
SET otp:login:user-123 "hashed-otp" EX 300
```

Rules:

1. token TTL harus pendek;
2. token value sebaiknya hashed jika sensitif;
3. token use should be atomic;
4. token harus dihapus setelah sukses;
5. failed attempts harus dibatasi;
6. jangan gunakan naked SET + EXPIRE;
7. jangan simpan token tanpa purpose;
8. jangan reuse key untuk purpose berbeda.

Contoh key:

```text
auth:v1:otp:login:{userId}
auth:v1:password-reset:{tokenHash}
auth:v1:email-verification:{tokenHash}
```

### 14.1 Atomic Consume Token

Buggy flow:

```java
String userId = redis.get(tokenKey);
if (userId != null) {
    redis.del(tokenKey);
    resetPassword(userId);
}
```

Race:

1. Request A `GET` token.
2. Request B `GET` token.
3. Both see valid token.
4. Both proceed.

Better dengan Lua:

```lua
local value = redis.call('GET', KEYS[1])
if not value then
  return nil
end
redis.call('DEL', KEYS[1])
return value
```

Ini akan dibahas lebih dalam di Part 014, tapi mental model-nya sudah penting di sini:

> TTL membatasi umur token, tetapi tidak otomatis membuat consume token atomic.

---

## 15. TTL untuk Rate Limiter

Rate limiter sering memakai counter dengan TTL.

Contoh fixed window:

```redis
INCR rate:user:123:202606201030
EXPIRE rate:user:123:202606201030 60
```

Bug klasik:

```text
INCR berhasil, EXPIRE gagal -> counter tanpa TTL -> key leak.
```

Better:

1. gunakan Lua untuk `INCR` dan set TTL hanya saat counter baru;
2. atau gunakan command pattern yang aman;
3. monitor key growth.

Lua concept:

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
```

Rate limiter TTL bukan hanya cleanup. TTL adalah definisi window enforcement.

Jika TTL salah:

1. user bisa terlalu cepat bebas limit;
2. user bisa terlalu lama diblokir;
3. enforcement tidak defensible;
4. abuse prevention gagal.

---

## 16. TTL untuk Idempotency Key

Idempotency key biasanya perlu disimpan selama replay window.

Contoh:

```redis
SET idem:payment:v1:merchant-7:req-abc "PROCESSING" NX EX 86400
```

Makna:

```text
Request dengan key ini dianggap sama selama 24 jam.
Setelah TTL habis, request yang sama bisa diproses ulang.
```

TTL idempotency harus dipilih berdasarkan:

1. client retry window;
2. message broker replay window;
3. payment gateway duplicate submission window;
4. legal/audit requirement;
5. storage cost;
6. operational recovery time.

Common mistake:

```text
TTL idempotency = 5 minutes because cache should be short
```

Padahal payment client bisa retry setelah 30 menit.

Better:

```text
Payment idempotency TTL = 24h or 7d, based on business contract.
```

State design:

```json
{
  "state": "COMPLETED",
  "requestHash": "sha256:...",
  "responseCode": 201,
  "responseBodyRef": "payment:789",
  "createdAt": "2026-06-20T10:00:00Z",
  "completedAt": "2026-06-20T10:00:03Z"
}
```

Expiration of idempotency key means:

```text
The system no longer promises duplicate suppression for this key.
```

That must be acceptable by contract.

---

## 17. TTL untuk Distributed Lock

Distributed lock biasanya memakai lease TTL.

```redis
SET lock:invoice:123 random-token NX PX 30000
```

Makna:

```text
Caller owns lock only for at most 30 seconds, if it can complete safely within that lease.
```

TTL lock bukan cleanup doang. TTL adalah safety boundary.

Jika TTL terlalu pendek:

1. lock expired saat critical section masih berjalan;
2. caller lain acquire lock;
3. dua caller berjalan bersamaan;
4. data corruption mungkin terjadi.

Jika TTL terlalu panjang:

1. crash membuat resource terkunci lama;
2. availability turun;
3. retry menumpuk.

JVM-specific risk:

1. GC pause;
2. thread starvation;
3. network pause;
4. container CPU throttling;
5. safepoint pause;
6. overloaded executor.

Karena itu, Redis lock harus dipakai dengan fencing token untuk resource yang benar-benar butuh mutual exclusion kuat.

TTL lock akan dibahas detail di Part 013.

---

## 18. Eviction: Saat Redis Kehabisan Memory

Redis adalah memory-first system. Jika memory dibatasi dengan `maxmemory`, Redis harus memutuskan apa yang dilakukan saat memory penuh.

Konfigurasi utama:

```conf
maxmemory 4gb
maxmemory-policy allkeys-lru
```

Jika `maxmemory` tercapai, Redis mencoba membuang key sesuai policy.

Jika policy tidak membolehkan key dibuang, Redis akan menolak write yang membutuhkan memory.

---

## 19. `maxmemory-policy`

Policy umum:

| Policy | Makna | Cocok untuk |
|---|---|---|
| `noeviction` | Jangan evict; write error saat memory penuh | Redis sebagai state store yang tidak boleh silent data loss |
| `allkeys-lru` | Evict least recently used dari semua key | General cache |
| `volatile-lru` | Evict least recently used hanya dari key yang punya TTL | Mixed persistent + volatile keys, tapi berisiko jika TTL coverage buruk |
| `allkeys-lfu` | Evict least frequently used dari semua key | Cache dengan popularity skew |
| `volatile-lfu` | LFU hanya pada key dengan TTL | Mixed volatile cache |
| `allkeys-random` | Random dari semua key | Workload tertentu, simple cache, benchmark baseline |
| `volatile-random` | Random hanya key dengan TTL | Jarang jadi default desain utama |
| `volatile-ttl` | Evict key TTL terpendek | Cache dengan TTL-based priority kasar |

Redis docs juga mencatat varian policy modern seperti LRM di Redis tertentu, tetapi policy paling umum di production tetap LRU/LFU/random/TTL/noeviction families.

---

## 20. Expiration vs Eviction: Contoh Konkret

Misal:

```redis
SET cache:a A EX 3600
SET cache:b B EX 3600
SET cache:c C
```

Dan Redis config:

```conf
maxmemory-policy volatile-lru
```

Jika memory penuh:

```text
cache:a dan cache:b bisa di-evict
cache:c tidak eligible karena tidak punya TTL
```

Jika semua key tidak punya TTL, Redis bisa gagal menulis walaupun policy `volatile-lru` aktif.

Ini common incident:

```text
Team mengira Redis akan evict cache otomatis.
Ternyata banyak key cache dibuat tanpa TTL.
Policy volatile-lru hanya evict key ber-TTL.
Memory penuh.
Write errors muncul.
```

Jika config:

```conf
maxmemory-policy allkeys-lru
```

Maka semua key eligible, termasuk key yang mungkin kamu anggap penting.

Karena itu, jangan campur:

1. cache disposable;
2. session important;
3. lock;
4. rate limiter;
5. idempotency;
6. stream pending state;
7. operational metadata;

ke Redis instance yang sama dengan eviction policy yang tidak mempertimbangkan criticality.

---

## 21. `noeviction`: Aman atau Berbahaya?

`noeviction` sering dianggap paling aman karena tidak menghapus data diam-diam.

Benar, tetapi trade-off-nya:

```text
Saat memory penuh, writes can fail.
```

Ini bisa menyebabkan:

1. session creation gagal;
2. rate limiter tidak bisa mencatat usage;
3. idempotency key tidak tersimpan;
4. lock acquisition error;
5. cache fill gagal;
6. application exception meningkat.

Untuk cache murni, `noeviction` biasanya buruk karena cache seharusnya bisa mengorbankan key.

Untuk Redis sebagai coordination/state store, `noeviction` bisa lebih aman karena silent eviction lebih berbahaya daripada explicit write failure.

Rule:

```text
If losing key silently is worse than failing write explicitly, prefer noeviction.
If failing write is worse than losing cache entry, prefer an eviction policy.
```

---

## 22. `allkeys-lru`: Default Mental Model untuk Cache Murni

Untuk Redis instance yang hanya berisi cache disposable, `allkeys-lru` sering menjadi pilihan masuk akal.

Makna:

```text
Semua key adalah cache.
Semua key boleh dibuang.
Key yang jarang dipakai lebih mungkin dibuang.
```

Cocok jika:

1. semua data bisa direkonstruksi dari source of truth;
2. missing key selalu safe;
3. cache hit ratio penting;
4. tidak ada key critical non-cache;
5. Redis instance dedicated untuk cache.

Tidak cocok jika Redis juga menyimpan:

1. session penting;
2. idempotency payment;
3. lock;
4. pending job;
5. rate limit enforcement yang harus defensible;
6. state workflow.

---

## 23. `allkeys-lfu`: Untuk Popularity-Skewed Cache

LFU berarti least frequently used.

Ini cocok ketika workload memiliki hot keys yang konsisten.

Contoh:

1. top products;
2. popular configuration;
3. tenant metadata;
4. frequently requested reference data;
5. content metadata.

LRU bisa kalah jika ada scan besar yang menyentuh banyak key sekali saja. LFU lebih tahan terhadap one-time scan pollution.

Trade-off:

1. metadata frequency tracking;
2. tuning lebih kompleks;
3. behavior bisa kurang intuitif;
4. key yang dulu populer bisa bertahan terlalu lama tergantung decay.

Rule:

```text
Use LFU when frequency matters more than recency.
Use LRU when recent access is a good proxy for future access.
```

---

## 24. `volatile-*`: Mixed Dataset Trap

Policy `volatile-lru`, `volatile-lfu`, `volatile-random`, dan `volatile-ttl` hanya meng-evict key yang punya TTL.

Ini terlihat menarik untuk mixed Redis:

```text
persistent keys tidak dihapus
cache keys punya TTL dan bisa dihapus
```

Tapi ini bisa menjadi jebakan.

Jika cache code lupa set TTL:

```redis
SET cache:user:123 "..."
```

Key ini tidak eligible untuk eviction pada volatile policy.

Akibat:

1. memory leak;
2. Redis penuh;
3. writes gagal;
4. cache malah memperburuk reliability.

Jika menggunakan volatile policy, wajib ada:

1. key schema enforcement;
2. integration test TTL;
3. scanner untuk key tanpa TTL pada namespace cache;
4. alert pada `db0:keys=...,expires=...` ratio;
5. periodic audit.

---

## 25. `volatile-ttl`: Prioritas Berdasarkan Sisa TTL

`volatile-ttl` memilih key dengan TTL tersisa paling pendek.

Kesan awal:

```text
Kalau sudah mau expired, buang saja duluan.
```

Cocok untuk sebagian workload.

Tapi hati-hati:

1. TTL pendek tidak selalu berarti value kurang penting;
2. TTL panjang tidak selalu berarti value mahal direcompute;
3. Redis tidak tahu cost recomputation;
4. Redis tidak tahu business priority.

Contoh:

```text
risk-score-cache TTL 30s, recompute sangat mahal
product-cache TTL 1h, recompute murah
```

`volatile-ttl` bisa membuang risk-score dulu karena TTL pendek, padahal recompute lebih mahal.

Eviction policy tidak memahami domain. Kamu harus mendesain data placement.

---

## 26. Separate Redis by Criticality

Production Redis design sering gagal karena satu Redis instance dipakai untuk semua hal.

Bad:

```text
Single Redis cluster:
- user sessions
- API cache
- product cache
- idempotency keys
- rate limiters
- distributed locks
- pub/sub
- stream jobs
- feature flags
```

Masalah:

1. satu eviction policy untuk semua;
2. satu memory pool untuk semua;
3. hot key cache bisa mengganggu session;
4. pub/sub burst bisa mempengaruhi latency;
5. debugging sulit;
6. blast radius besar;
7. capacity planning tidak jelas.

Better segmentation:

```text
redis-cache:
  purpose: disposable cache
  policy: allkeys-lru or allkeys-lfu
  persistence: off or minimal

redis-session:
  purpose: session/token transient auth state
  policy: noeviction or carefully selected volatile policy
  persistence: maybe AOF/RDB depending requirement

redis-coordination:
  purpose: idempotency/rate limit/locks
  policy: noeviction
  persistence: depends on correctness requirement

redis-stream:
  purpose: Redis Streams workload
  policy: noeviction, explicit trimming
```

Rule:

> Redis instance boundaries should follow failure semantics, not just team convenience.

---

## 27. Designing Missing-Key Semantics

Every Redis key family should define missing behavior.

Template:

```text
Key family:
  cache:user-profile:{userId}

Can be missing because:
  - never cached
  - TTL expired
  - evicted
  - invalidated after update

Application behavior:
  - load from PostgreSQL
  - cache result with TTL + jitter
  - if source unavailable, optionally serve stale local cache if available

User-visible behavior:
  - no error unless source unavailable

Correctness impact:
  - none; Redis is not source of truth
```

Another:

```text
Key family:
  idem:payment:{merchantId}:{idempotencyKey}

Can be missing because:
  - never submitted
  - replay window expired
  - Redis data loss/failover/eviction incident

Application behavior:
  - if absent, attempt to create PROCESSING marker with SET NX EX
  - for high-value payment, also check durable payment table by request hash

Correctness impact:
  - missing key may allow duplicate unless durable fallback exists
```

This is the level of thinking that separates safe Redis usage from accidental cache scripting.

---

## 28. Cache Avalanche, Cache Penetration, Cache Breakdown

Redis TTL bugs often appear under load, not during development.

### 28.1 Cache Avalanche

Many keys expire together.

Cause:

1. same TTL;
2. batch warm-up;
3. deploy flush;
4. Redis restart;
5. mass invalidation.

Mitigation:

1. TTL jitter;
2. pre-warming;
3. request coalescing;
4. local cache layer;
5. circuit breaker to source;
6. staggered invalidation;
7. rate limit cache refill.

### 28.2 Cache Penetration

Requests repeatedly query non-existing data.

Cause:

1. random IDs;
2. attack traffic;
3. stale references;
4. crawler behavior.

Mitigation:

1. negative caching;
2. Bloom filter/probabilistic membership;
3. input validation;
4. rate limiting;
5. abuse detection.

### 28.3 Cache Breakdown

A hot key expires and many requests recompute it simultaneously.

Mitigation:

1. mutex/lock for recompute;
2. stale-while-revalidate;
3. refresh-ahead;
4. probabilistic early refresh;
5. hot key never expires physically but has logical expiry in value.

---

## 29. Physical TTL vs Logical TTL

Physical TTL:

```redis
SET cache:config "..." EX 300
```

Redis removes key after TTL.

Logical TTL:

```json
{
  "value": {...},
  "freshUntil": "2026-06-20T10:05:00Z",
  "staleUntil": "2026-06-20T10:30:00Z"
}
```

Redis key may have longer TTL:

```redis
SET cache:config "json" EX 1800
```

Application decides:

```java
if (now.isBefore(freshUntil)) {
    return value;
}

if (now.isBefore(staleUntil)) {
    triggerAsyncRefresh();
    return staleValue;
}

return reloadSynchronously();
```

This is useful for:

1. high-value hot key;
2. expensive recomputation;
3. external API cache;
4. feature config;
5. graceful degradation.

Trade-off:

1. more complex value format;
2. stale data policy must be explicit;
3. background refresh complexity;
4. harder testing.

---

## 30. TTL in Java: API Design

Avoid APIs like:

```java
void put(String key, Object value);
```

This allows accidental immortal cache keys.

Better:

```java
void put(CacheKey key, Object value, Duration ttl);
```

Even better:

```java
record RedisKeySpec(
    String namespace,
    String key,
    RedisDataKind kind,
    Duration ttl,
    boolean evictionSafe,
    MissingSemantics missingSemantics
) {}
```

Example:

```java
public final class UserProfileCache {
    private static final Duration BASE_TTL = Duration.ofMinutes(15);
    private static final Duration MAX_JITTER = Duration.ofMinutes(2);

    private final RedisCommands<String, String> redis;
    private final ObjectMapper objectMapper;

    public Optional<UserProfileDto> get(UserId userId) {
        String json = redis.get(key(userId));
        if (json == null) {
            return Optional.empty();
        }
        return Optional.of(read(json));
    }

    public void put(UserProfileDto profile) {
        Duration ttl = withJitter(BASE_TTL, MAX_JITTER);
        redis.setex(key(profile.userId()), ttl.toSeconds(), write(profile));
    }

    public void invalidate(UserId userId) {
        redis.del(key(userId));
    }

    private String key(UserId userId) {
        return "identity:v1:user-profile-cache:" + userId.value();
    }
}
```

Important:

1. TTL is not optional.
2. Key format is centralized.
3. Missing returns `Optional.empty()`.
4. Cache does not decide user existence.

---

## 31. Spring Cache TTL Trap

Spring Cache abstraction can hide Redis details.

This is convenient but dangerous.

Typical annotation:

```java
@Cacheable(cacheNames = "userProfile", key = "#userId")
public UserProfile getUserProfile(String userId) {
    return repository.findById(userId).orElseThrow();
}
```

Questions often hidden:

1. What TTL is applied?
2. Is null cached?
3. What serializer is used?
4. What key prefix is generated?
5. Does method exception cache anything?
6. How is invalidation done?
7. Is TTL same for all cache names?
8. Are cache names versioned?
9. Are keys cluster-safe?
10. How are stampedes handled?

A production Redis cache should configure per-cache TTL:

```java
RedisCacheConfiguration.defaultCacheConfig()
    .entryTtl(Duration.ofMinutes(15))
    .disableCachingNullValues();
```

But for advanced patterns like jitter, negative caching, stale-while-revalidate, idempotency, and lock-safe recompute, explicit Redis code is often clearer than annotations.

Rule:

> Spring Cache is good for simple cache-aside. It is not a substitute for lifecycle design.

---

## 32. Observability: Expired vs Evicted

You must monitor expiration and eviction separately.

Important Redis metrics from `INFO`:

```redis
INFO stats
```

Relevant fields include:

```text
expired_keys
expired_stale_perc
expired_time_cap_reached_count
evicted_keys
keyspace_hits
keyspace_misses
```

Also:

```redis
INFO memory
```

Relevant:

```text
used_memory
used_memory_rss
used_memory_peak
mem_fragmentation_ratio
maxmemory
maxmemory_policy
```

And:

```redis
INFO keyspace
```

Example:

```text
db0:keys=1000000,expires=950000,avg_ttl=842000
```

Interpretation:

1. most keys have TTL;
2. average TTL around 842 seconds depending unit shown;
3. if cache namespace expects 100% TTL but expires count is low, audit needed.

### 32.1 Alerting Ideas

Alert on:

1. `evicted_keys` increasing unexpectedly;
2. `used_memory / maxmemory` above threshold;
3. `keyspace_misses` spike;
4. hit ratio drop;
5. expired keys spike after deployment;
6. keys without TTL in volatile namespace;
7. high `expired_time_cap_reached_count`;
8. write errors due to OOM;
9. latency spike during active expiry or eviction.

### 32.2 Expired Keys Spike Is Not Always Bad

If a batch of temporary tokens expires, `expired_keys` rises. That can be normal.

`evicted_keys` rising is more concerning because it means memory pressure forced Redis to discard data.

For cache-only Redis, eviction may be acceptable.

For session/idempotency/coordination Redis, eviction is usually a serious signal.

---

## 33. Keyspace Notifications: Useful, Not Durable

Redis can publish events for expired/evicted keys if keyspace notifications are enabled.

Use cases:

1. debug;
2. lightweight local notification;
3. best-effort cleanup;
4. metric enrichment;
5. non-critical side effects.

Non-use cases:

1. durable workflow transition;
2. payment timeout authoritative action;
3. audit-grade event;
4. guaranteed job scheduling;
5. compliance evidence.

Why?

Because Pub/Sub events are not persisted like a durable log. If subscriber is offline, event can be missed.

Better for durable time-based processing:

1. store due time in database or Redis Sorted Set;
2. worker scans due items;
3. action is idempotent;
4. state transition is stored durably;
5. audit event emitted through durable mechanism.

---

## 34. Large TTL vs No TTL

A common question:

```text
Should I use TTL 30 days or no TTL?
```

They mean different things.

TTL 30 days:

```text
This data is allowed to disappear after 30 days automatically.
```

No TTL:

```text
This data persists until explicit deletion or eviction.
```

If data is cache, use TTL even if long.

If data is canonical state, Redis may not be the right store unless durability and recovery are designed.

Long TTL risks:

1. stale data;
2. memory accumulation;
3. cache pollution;
4. hidden dependency on Redis;
5. hard invalidation.

No TTL risks:

1. memory leak;
2. no lifecycle cleanup;
3. volatile eviction ineligible issue;
4. stale forever;
5. operational surprises.

Rule:

> Absence of TTL must be intentional and documented.

---

## 35. TTL and Data Freshness

TTL is often used as a proxy for freshness, but they are not identical.

Example:

```text
Product price cache TTL = 10 minutes
```

This means:

```text
Price can be stale for up to 10 minutes.
```

Is that acceptable?

Depends.

For product description: maybe yes.

For stock availability: maybe risky.

For financial balance: probably no.

For regulatory case status: likely no unless clearly marked as non-authoritative.

Freshness should be decided by domain requirement, not cache convenience.

Design table:

| Data | Source of Truth | Max Staleness | Redis TTL | Missing Behavior |
|---|---|---:|---:|---|
| user profile display | PostgreSQL | 15m | 15m + jitter | reload |
| permissions | Authorization DB | 30s or event invalidation | 30s | reload/block cautiously |
| account balance | Ledger | 0 or near-0 | avoid cache or very careful | query source |
| feature flags | Config service | 1m | 1m + local fallback | use safe default |
| case enforcement status | Case DB | domain-specific | maybe short | query authoritative store |

---

## 36. TTL and Regulatory/Enforcement Systems

Untuk sistem regulatory/enforcement/case-management, Redis TTL harus diperlakukan hati-hati.

Redis cocok untuk:

1. UI acceleration;
2. transient locks;
3. rate limiting;
4. idempotency windows;
5. short-lived workflow assistance;
6. deduplication windows;
7. temporary search/session state.

Redis tidak boleh menjadi satu-satunya tempat untuk:

1. enforcement decision record;
2. legal deadline;
3. audit trail;
4. official case status;
5. violation history;
6. appeal state;
7. evidence chain;
8. irreversible action log.

TTL dalam regulatory system harus bisa dijelaskan:

```text
What disappears?
When can it disappear?
Why is it safe to disappear?
What is the authoritative fallback?
How is disappearance observed?
How is data reconstructed?
What audit record remains?
```

Jika jawaban ini tidak jelas, Redis TTL mungkin sedang menyembunyikan correctness problem.

---

## 37. Memory Pressure Failure Matrix

Saat Redis memory penuh, outcome tergantung policy.

| Use Case | Policy | Failure Mode | Impact |
|---|---|---|---|
| cache | allkeys-lru | key evicted | lower hit ratio |
| cache | noeviction | cache fill fails | app may fallback but errors possible |
| session | allkeys-lru | active session evicted | user logout / auth issue |
| session | noeviction | new session write fails | login failure |
| idempotency | allkeys-lru | duplicate protection lost | duplicate processing risk |
| idempotency | noeviction | new request cannot reserve key | fail closed possible |
| rate limiter | allkeys-lru | limiter state lost | abuse window opens |
| rate limiter | noeviction | cannot increment | fail open/closed decision required |
| lock | allkeys-lru | lock key evicted | mutual exclusion broken |
| lock | noeviction | cannot acquire lock | availability issue |
| stream | allkeys-lru | stream keys evicted | data loss |
| stream | noeviction | XADD fails | producer error/backpressure |

Important conclusion:

> For correctness-sensitive Redis data, eviction is often worse than explicit write failure.

---

## 38. Fail Open vs Fail Closed

When Redis fails or key is missing unexpectedly, application must choose fail-open or fail-closed.

### 38.1 Rate Limiter Example

If Redis unavailable:

Fail open:

```text
Allow request.
```

Pros:

1. availability preserved;
2. fewer user-visible errors.

Cons:

1. abuse can bypass limit;
2. cost spike;
3. policy violation.

Fail closed:

```text
Reject request.
```

Pros:

1. enforcement preserved;
2. safer for abuse/security.

Cons:

1. Redis outage becomes user outage;
2. can block legitimate users.

Decision depends on endpoint.

```text
Public login endpoint -> maybe fail closed or degraded strict local limiter.
Product listing -> fail open.
Payment submission -> likely fail closed or route to durable fallback.
Admin enforcement action -> fail closed if idempotency cannot be guaranteed.
```

### 38.2 Cache Example

Cache miss usually fails open to source of truth.

```text
Redis missing -> query DB
```

But if DB is overloaded, repeated cache miss can take system down.

Thus fail-open must be paired with:

1. source protection;
2. timeout;
3. circuit breaker;
4. request coalescing;
5. local fallback;
6. bulkhead.

---

## 39. TTL Testing

TTL bugs are easy to miss.

Test cases should include:

1. key has TTL after creation;
2. update does not remove TTL accidentally;
3. TTL is within expected range;
4. jitter is applied;
5. missing key triggers source reload;
6. negative cache expires quickly;
7. session TTL refresh works;
8. absolute session expiry is enforced;
9. token cannot be consumed twice;
10. rate limiter counter expires;
11. idempotency key expires after replay window;
12. namespace has no immortal cache keys.

Example Testcontainers test idea:

```java
@Test
void userProfileCacheShouldAlwaysWriteWithTtl() {
    cache.put(profile);

    Long ttl = redis.ttl("identity:v1:user-profile-cache:" + profile.userId());

    assertThat(ttl).isGreaterThan(0);
    assertThat(ttl).isBetween(13 * 60L, 17 * 60L);
}
```

Testing update does not remove TTL:

```java
@Test
void updatingCacheShouldNotRemoveTtl() {
    cache.put(profileV1);
    cache.put(profileV2);

    Long ttl = redis.ttl(key);

    assertThat(ttl).isGreaterThan(0);
}
```

Testing expiration semantics:

```java
@Test
void expiredKeyShouldBeTreatedAsCacheMissNotNotFound() {
    cache.put(profile, Duration.ofSeconds(1));
    await().atMost(Duration.ofSeconds(3))
           .untilAsserted(() -> assertThat(cache.get(userId)).isEmpty());

    when(repository.findById(userId)).thenReturn(Optional.of(profile));

    UserProfile result = service.getUserProfile(userId);

    assertThat(result).isEqualTo(profile);
}
```

---

## 40. Operational Audits for TTL

Periodic audit commands:

```redis
SCAN 0 MATCH app:* COUNT 1000
TTL some:key
MEMORY USAGE some:key
TYPE some:key
```

Do not use `KEYS *` in production.

Audit goals:

1. find cache keys without TTL;
2. find key families with unexpected TTL;
3. find large keys with long TTL;
4. find immortal keys in volatile namespace;
5. find stale version prefixes;
6. detect namespace owner violations;
7. validate expected key cardinality.

Example audit report:

```text
Namespace: identity:v1:user-profile-cache:*
Expected TTL: 15m + jitter
Sample size: 10,000 keys
Keys without TTL: 0
TTL p50: 804s
TTL p95: 968s
Largest value: 7.4KB
Unexpected type: 0
Status: OK
```

Problem report:

```text
Namespace: product:v1:detail-cache:*
Expected TTL: 1h
Sample size: 10,000 keys
Keys without TTL: 824
Largest value: 1.8MB
Finding:
  Some write path uses SET without EX.
Risk:
  Memory growth and volatile-lru ineligibility.
Action:
  Patch writer and clean existing keys.
```

---

## 41. TTL Cleanup Migration

Suppose you discover 5 million cache keys without TTL.

Bad response:

```redis
KEYS product:v1:detail-cache:*
DEL ... all at once
```

This can block Redis and cause incident.

Better:

1. use `SCAN` incrementally;
2. process in batches;
3. apply `EXPIRE` gradually;
4. add jitter;
5. throttle migration;
6. monitor latency and memory;
7. run off-peak;
8. deploy code fix before cleanup.

Pseudo-script:

```text
cursor = 0
repeat:
  cursor, keys = SCAN cursor MATCH product:v1:detail-cache:* COUNT 500
  for key in keys:
    if TTL key == -1:
      EXPIRE key random(3000, 4200)
  sleep 50ms
until cursor == 0
```

Prefer writing a safe admin job using client library, not ad-hoc shell command in panic.

---

## 42. TTL and Serialization Versioning

TTL can be used to phase out old serialized formats.

Example:

```text
cache:user-profile:v1:{userId} TTL 15m
cache:user-profile:v2:{userId} TTL 15m
```

Deploy v2 writer and reader:

1. reader tries v2;
2. if miss, load source;
3. write v2;
4. v1 naturally expires.

This avoids mass delete.

But for long TTL caches, old versions linger longer.

For schema migrations:

1. use versioned key prefix;
2. keep TTL finite;
3. avoid deserializing unknown payloads blindly;
4. monitor old namespace cardinality;
5. clean up after safe window.

---

## 43. TTL and Cluster

Redis Cluster adds complexity:

1. key distribution across slots;
2. memory pressure per node;
3. eviction happens per node;
4. hot slots/nodes can evict while others have memory;
5. multi-key TTL operations need hash tags if atomicity required.

Example:

```text
node A memory 95%, evicting keys
node B memory 40%
node C memory 35%
```

Cluster total memory may look fine, but one node can be under pressure.

Therefore monitor per-node:

1. used memory;
2. evicted keys;
3. key count;
4. hot keys;
5. slot distribution;
6. big keys.

Key design with hash tag:

```text
rate:{user-123}:api:/payments
rate:{user-123}:api:/profile
```

These keys share hash tag `{user-123}` if multi-key operation is needed. But overusing hash tags can create hot slots.

Trade-off:

```text
Atomic locality vs load distribution.
```

---

## 44. TTL and Replication/Failover

TTL metadata is replicated, but replication is asynchronous in common Redis setups.

Failure modes:

1. primary accepts write with TTL;
2. primary crashes before replica receives it;
3. failover promotes replica;
4. key never existed on new primary.

Or:

1. primary has key close to expiry;
2. replica lag exists;
3. read from replica may observe different timing behavior;
4. client sees stale/missing inconsistently.

For cache, acceptable.

For idempotency/security-sensitive state, evaluate carefully.

If losing key across failover breaks correctness, Redis alone may be insufficient unless durability/replication guarantees are explicitly engineered.

---

## 45. TTL Checklist by Use Case

### 45.1 Cache

```text
- Source of truth exists?
- TTL based on freshness requirement?
- Jitter applied?
- Missing means cache miss?
- Negative cache considered?
- Stampede protection considered?
- Eviction safe?
- Serialization versioned?
```

### 45.2 Session

```text
- Fixed or sliding?
- Absolute max lifetime?
- Logout deletes key?
- Account lock invalidates sessions?
- Eviction acceptable?
- Persistence needed?
- Multi-device model?
```

### 45.3 Token

```text
- TTL short enough?
- Token hashed?
- Purpose-specific key?
- Consume atomic?
- Attempts limited?
- Reuse prevented?
```

### 45.4 Idempotency

```text
- Replay window defined?
- TTL matches external retry behavior?
- PROCESSING/COMPLETED state modeled?
- Request hash stored?
- Missing fallback defined?
- Eviction unacceptable?
```

### 45.5 Rate Limiter

```text
- Window model clear?
- TTL atomic with counter creation?
- Fail open/closed decision?
- Multi-dimensional key design?
- Cluster hash tag needed?
- Abuse behavior tested?
```

### 45.6 Lock

```text
- TTL is lease, not ownership forever?
- Random token used?
- Safe unlock?
- Critical section bounded?
- GC pause considered?
- Fencing token needed?
```

---

## 46. Design Review Questions

Saat review design Redis TTL, tanyakan:

1. Key ini boleh hilang kapan?
2. Kalau hilang sebelum TTL karena eviction, apa yang terjadi?
3. Kalau tidak pernah hilang karena TTL bug, apa risikonya?
4. Missing key artinya apa?
5. Siapa source of truth?
6. Apakah TTL dipasang atomically?
7. Apakah update mempertahankan TTL atau reset TTL?
8. Apakah TTL punya jitter?
9. Apakah key ini punya lifecycle yang sama dengan field lain?
10. Apakah eviction policy cocok dengan criticality key?
11. Apakah instance Redis dedicated atau shared?
12. Bagaimana monitor expired vs evicted?
13. Bagaimana test memastikan TTL ada?
14. Bagaimana migration jika TTL salah?
15. Bagaimana failover mempengaruhi key ini?

Kalau pertanyaan-pertanyaan ini belum bisa dijawab, Redis usage belum production-grade.

---

## 47. Common Anti-Patterns

### 47.1 Naked Cache Set

```java
redis.set(key, value);
```

Untuk cache, ini hampir selalu bug.

### 47.2 `SET` lalu `EXPIRE`

```java
redis.set(key, value);
redis.expire(key, ttl);
```

Bug jika TTL mandatory.

### 47.3 TTL Sama untuk Semua Cache

```text
All cache TTL = 1 hour
```

Ini malas, bukan desain.

### 47.4 Tidak Ada Jitter

Menyebabkan avalanche.

### 47.5 Mixed Criticality dalam Satu Redis

Cache eviction bisa membuang lock/session/idempotency.

### 47.6 Menganggap Expiration Event Durable

Expired event bukan workflow engine.

### 47.7 Missing Key Dianggap Entity Not Found

Cache miss berubah jadi domain false negative.

### 47.8 Long TTL untuk Data yang Butuh Freshness Ketat

Stale data bug.

### 47.9 No TTL untuk Namespace Cache

Memory leak.

### 47.10 Tidak Monitor `evicted_keys`

Eviction terjadi diam-diam sampai user merasakan efeknya.

---

## 48. Practical Java Blueprint: TTL-Safe Cache Wrapper

Contoh minimal wrapper yang memaksa TTL:

```java
public interface RedisCacheCodec<T> {
    String encode(T value);
    T decode(String value);
}

public record TtlPolicy(Duration base, Duration maxJitter) {
    public Duration nextTtl() {
        if (maxJitter.isZero()) {
            return base;
        }
        long jitterMillis = ThreadLocalRandom.current().nextLong(0, maxJitter.toMillis() + 1);
        return base.plusMillis(jitterMillis);
    }
}

public final class TtlSafeRedisCache<T> {
    private final RedisCommands<String, String> redis;
    private final RedisCacheCodec<T> codec;
    private final TtlPolicy ttlPolicy;
    private final String namespace;

    public TtlSafeRedisCache(
            RedisCommands<String, String> redis,
            RedisCacheCodec<T> codec,
            TtlPolicy ttlPolicy,
            String namespace
    ) {
        this.redis = redis;
        this.codec = codec;
        this.ttlPolicy = ttlPolicy;
        this.namespace = namespace;
    }

    public Optional<T> get(String id) {
        String raw = redis.get(key(id));
        if (raw == null) {
            return Optional.empty();
        }
        return Optional.of(codec.decode(raw));
    }

    public void put(String id, T value) {
        Duration ttl = ttlPolicy.nextTtl();
        redis.setex(key(id), ttl.toSeconds(), codec.encode(value));
    }

    public void delete(String id) {
        redis.del(key(id));
    }

    public Duration ttl(String id) {
        Long seconds = redis.ttl(key(id));
        if (seconds == null || seconds < 0) {
            return Duration.ZERO;
        }
        return Duration.ofSeconds(seconds);
    }

    private String key(String id) {
        return namespace + ":" + id;
    }
}
```

Limitasi wrapper ini:

1. belum handle stampede;
2. belum handle negative caching;
3. belum handle stale-while-revalidate;
4. belum expose metrics;
5. belum handle Redis failures;
6. belum cluster hash tag;
7. belum handle serialization evolution.

Tapi wrapper ini sudah lebih baik daripada Redis access liar tersebar di service.

---

## 49. Practical Java Blueprint: Missing Semantics Explicit

```java
public sealed interface CacheLookup<T> {
    record Hit<T>(T value) implements CacheLookup<T> {}
    record Miss<T>(MissReason reason) implements CacheLookup<T> {}
}

public enum MissReason {
    ABSENT_OR_EXPIRED,
    DESERIALIZATION_FAILED,
    REDIS_UNAVAILABLE
}
```

Usage:

```java
CacheLookup<UserProfile> lookup = cache.get(userId);

return switch (lookup) {
    case CacheLookup.Hit<UserProfile> hit -> hit.value();
    case CacheLookup.Miss<UserProfile> miss -> switch (miss.reason()) {
        case ABSENT_OR_EXPIRED -> loadFromSource(userId);
        case DESERIALIZATION_FAILED -> reloadAndOverwrite(userId);
        case REDIS_UNAVAILABLE -> loadFromSourceWithProtection(userId);
    };
};
```

This avoids treating all missing/error states as same.

---

## 50. Summary Mental Model

TTL:

```text
A lifecycle contract attached to a key.
```

Expiration:

```text
Redis removing a key because its TTL elapsed.
```

Eviction:

```text
Redis removing a key because memory pressure forces it, according to policy.
```

Missing key:

```text
A normal state that must be interpreted per key family.
```

Cache key:

```text
Should usually have TTL, jitter, fallback, and source of truth.
```

Correctness key:

```text
Should usually avoid silent eviction and must define fail-open/fail-closed behavior.
```

Production-grade Redis design:

```text
Does not ask “how do I set TTL?” only.
It asks “what does data disappearance mean for system correctness?”
```

---

## 51. Exercises

### Exercise 1 — Classify Key Families

Untuk setiap key berikut, tentukan:

1. apakah perlu TTL;
2. TTL berapa;
3. eviction safe atau tidak;
4. missing behavior;
5. source of truth.

```text
cache:user-profile:{userId}
session:{token}
rate:{tenantId}:{endpoint}:{minute}
idem:payment:{merchantId}:{idempotencyKey}
lock:case:{caseId}
feature-config:{tenantId}
stream:case-events
otp:login:{userId}
```

### Exercise 2 — Find the Bug

```java
public void saveOtp(String userId, String otp) {
    redis.set("otp:" + userId, otp);
    redis.expire("otp:" + userId, 300);
}
```

Questions:

1. Apa failure mode-nya?
2. Bagaimana memperbaikinya?
3. Apakah OTP boleh disimpan plaintext?
4. Bagaimana consume OTP secara atomic?

### Exercise 3 — Eviction Policy Selection

Kamu punya Redis dengan data:

```text
- product detail cache
- user session
- payment idempotency key
- login rate limiter
```

Pertanyaan:

1. Apakah boleh satu Redis instance?
2. Policy apa yang dipakai?
3. Apa risiko `allkeys-lru`?
4. Apa risiko `noeviction`?
5. Bagaimana segmentation yang lebih baik?

### Exercise 4 — Design TTL Contract

Buat key contract untuk:

```text
case-management:v1:case-summary-cache:{caseId}
```

Isi minimal:

1. owner;
2. type;
3. TTL;
4. jitter;
5. source of truth;
6. missing semantics;
7. eviction safety;
8. invalidation event;
9. max value size;
10. observability metric.

---

## 52. Referensi

Referensi utama:

1. Redis command documentation untuk `EXPIRE`, `TTL`, dan expiration behavior.
2. Redis key eviction documentation untuk `maxmemory` dan eviction policies.
3. Redis `INFO` documentation untuk observability field seperti `expired_keys`, `evicted_keys`, dan memory stats.
4. Redis keyspace notification documentation untuk event expired/evicted.
5. Redis client documentation untuk Java client behavior dan command usage.

---

## 53. Status Seri

```text
Part 008 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-009.md
```

Part berikutnya akan masuk ke:

```text
Cache Architecture I: Cache-Aside dengan Java Services
```

Di sana kita akan membangun dari konsep TTL ini menjadi desain cache-aside yang benar: read path, write path, invalidation, negative caching, key design, cache miss, observability, dan integrasi Spring/Java yang tidak rapuh.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Sorted Sets: Ranking, Scheduling, Priority, Time Index</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-009.md">Part 009 — Cache Architecture I: Cache-Aside dengan Java Services ➡️</a>
</div>
