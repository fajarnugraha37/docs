# learn-redis-mastery-for-java-engineers-part-011.md

# Part 011 — Rate Limiting dan Quota Enforcement dengan Redis

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara matang, bukan sekadar menempelkan cache atau counter.  
> Fokus part ini: Redis sebagai primitive untuk membangun **rate limiter**, **quota enforcement**, dan **abuse protection** yang benar secara concurrency, masuk akal secara arsitektur, dan defensible secara operasional.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

- Redis sebagai server in-memory dengan command atomic per execution.
- Keyspace dan data structures.
- Strings, Hashes, Lists, Sets, Sorted Sets.
- TTL, expiration, eviction.
- Cache-aside, consistency, invalidation, stampede, hot key.

Part ini mulai masuk ke use case sistem nyata: **membatasi laju aksi**.

Rate limiting sering terlihat sederhana:

> “User hanya boleh hit endpoint ini 100 kali per menit.”

Tapi dalam sistem production, kalimat itu langsung memunculkan pertanyaan desain:

- “100 kali” dihitung berdasarkan apa?
- Per user, per tenant, per IP, per API key, per endpoint, atau kombinasi?
- Window-nya fixed, sliding, atau token refill?
- Apakah burst diperbolehkan?
- Apa yang terjadi saat Redis timeout?
- Apakah limiter harus fail-open atau fail-closed?
- Apakah keputusan limiter perlu bisa diaudit?
- Bagaimana kalau service berjalan di 30 instance?
- Bagaimana kalau request datang bersamaan?
- Bagaimana kalau jam antar node berbeda?
- Bagaimana kalau Redis Cluster mengembalikan `CROSSSLOT`?
- Bagaimana kalau limiter key menjadi hot key?

Part ini bertujuan membuat Anda tidak hanya bisa menulis limiter, tapi bisa **mendesain kebijakan enforcement**.

---

## 1. Rate Limiting Bukan Sekadar Performance Feature

Banyak engineer melihat rate limiting sebagai perlindungan teknis agar server tidak overload. Itu benar, tapi belum lengkap.

Rate limiting dapat berfungsi sebagai:

1. **Abuse protection**  
   Mencegah brute force login, scraping, credential stuffing, spam, bot activity, atau automated misuse.

2. **Fair usage enforcement**  
   Mencegah satu client menghabiskan kapasitas yang seharusnya dibagi bersama.

3. **Business quota enforcement**  
   Misalnya tenant Basic hanya boleh 10.000 API calls per bulan, tenant Enterprise 10 juta.

4. **Cost control**  
   Membatasi akses ke endpoint mahal seperti report generation, AI inference, fraud scoring, OCR, dan external API calls.

5. **Reliability protection**  
   Menjaga dependency downstream agar tidak collapse.

6. **Security signal**  
   Kenaikan rejected requests bisa menjadi indikator attack.

7. **Regulatory defensibility**  
   Dalam sistem regulatori, enforcement harus bisa dijelaskan: siapa dibatasi, berdasarkan aturan apa, kapan, berapa sisa kuota, dan apakah decision path konsisten.

Jadi rate limiter bukan cuma utility class. Ia adalah **policy enforcement point**.

---

## 2. Mental Model: Rate Limiter sebagai State Machine

Secara konseptual, limiter adalah state machine kecil.

Input:

```text
principal + action + scope + time + cost
```

Contoh:

```text
principal = user:123
action    = POST /cases/{id}/submit
scope     = tenant:acme
now       = 2026-06-20T10:15:03.120Z
cost      = 1
```

State:

```text
counter, window boundary, token count, last refill timestamp,
recent request timestamps, monthly usage, violation score, etc.
```

Output:

```text
ALLOW | DENY | SOFT_DENY | CHALLENGE | DEGRADE
```

Dengan metadata:

```text
limit
remaining
resetAt
retryAfter
reason
policyVersion
decisionId
```

Dalam aplikasi web sederhana, output biasanya hanya `ALLOW` atau `DENY`. Dalam platform enforcement yang lebih matang, output bisa berbeda:

- `ALLOW`: lanjutkan request.
- `DENY`: tolak request dengan HTTP `429 Too Many Requests`.
- `SOFT_DENY`: return response degraded.
- `CHALLENGE`: minta CAPTCHA/MFA/additional verification.
- `QUEUE`: terima request tapi proses nanti.
- `ESCALATE`: tandai client untuk review.

Redis menyimpan state transient limiter. Aplikasi tetap memegang policy semantics.

---

## 3. Kenapa Redis Cocok untuk Rate Limiting

Redis cocok karena rate limiting butuh karakteristik berikut:

1. **Low latency**  
   Limiter biasanya berada di critical request path. Setiap request harus memutuskan allow/deny cepat.

2. **Atomic operation**  
   Banyak instance service bisa menerima request bersamaan. Increment/check/update harus race-safe.

3. **TTL-native**  
   Window counter dan temporary quota state harus hilang otomatis.

4. **Data structure rich**  
   Redis punya Strings untuk counter, Sorted Sets untuk sliding log, Hashes untuk token bucket state, Lua untuk atomic multi-step logic.

5. **Centralized shared state**  
   Semua instance Java service bisa berbagi limiter state.

6. **Operationally simple compared to full DB path**  
   Tidak setiap request perlu write ke SQL hanya untuk menghitung rate sementara.

Tapi Redis juga memiliki batas:

- Memory finite.
- Hot key bisa bottleneck.
- Async replication berarti failover bisa kehilangan beberapa update.
- Eviction bisa menghapus limiter state jika konfigurasi salah.
- Redis bukan audit ledger.
- Redis Cluster membatasi multi-key atomicity.

Jadi Redis sangat cocok untuk **runtime enforcement**, bukan selalu untuk **permanent compliance record**.

---

## 4. Rate Limit vs Quota: Jangan Dicampur

Dua istilah ini sering dicampur.

### 4.1 Rate Limit

Rate limit membatasi **laju** dalam window pendek.

Contoh:

```text
Maksimal 100 request per menit.
Maksimal 5 login attempt per 10 menit.
Maksimal 20 report generation per jam.
```

Karakteristik:

- Window pendek.
- State ephemeral.
- Cocok disimpan di Redis.
- Biasanya response `429`.
- Tujuannya melindungi sistem dari overload/abuse.

### 4.2 Quota

Quota membatasi **jumlah konsumsi** dalam periode bisnis.

Contoh:

```text
Tenant Basic: 10.000 API calls per bulan.
User: 100 document exports per hari.
Organization: 1 TB processing per billing cycle.
```

Karakteristik:

- Window lebih panjang.
- Sering berhubungan dengan billing, contract, compliance.
- Harus bisa diaudit.
- Redis bisa menjadi fast path, tapi source of truth biasanya SQL/event ledger.

### 4.3 Prinsip Desain

Gunakan Redis sebagai:

```text
Fast enforcement state
```

Gunakan database/event ledger sebagai:

```text
Durable usage record / billing / audit source
```

Untuk sistem sensitif, jangan menjadikan Redis satu-satunya bukti pemakaian.

---

## 5. Dimensi Rate Limiting

Sebelum memilih algoritma, tentukan dimensi enforcement.

### 5.1 Principal Dimension

Siapa yang dibatasi?

```text
ip:203.0.113.10
user:123
tenant:acme
apiKey:k_abc
clientApp:mobile-ios
serviceAccount:case-worker
anonymous:fingerprintHash
```

### 5.2 Action Dimension

Aksi apa yang dibatasi?

```text
login_attempt
password_reset
create_case
submit_case
export_report
search
ocr
ai_summary
api_call
```

### 5.3 Scope Dimension

Di level mana batas berlaku?

```text
per user
per tenant
per user per endpoint
per tenant per endpoint
per IP per endpoint
per API key globally
per organization per day
```

### 5.4 Cost Dimension

Apakah setiap request bernilai sama?

```text
GET /cases/123          cost = 1
POST /reports/export    cost = 10
POST /ai/summarize      cost = 50
Bulk import 1000 rows   cost = 1000
```

Limiter matang sering membatasi **cost**, bukan hanya request count.

### 5.5 Time Dimension

Window-nya apa?

```text
1 second
1 minute
15 minutes
1 hour
1 day
calendar month
rolling 24 hours
billing cycle
```

Calendar window dan rolling window berbeda secara fairness dan implementasi.

---

## 6. Rate Limiter Output Contract

Jangan hanya return boolean.

Minimal contract:

```java
public record RateLimitDecision(
    boolean allowed,
    String policyId,
    String scopeKey,
    long limit,
    long remaining,
    long retryAfterMillis,
    long resetAtEpochMillis,
    String reason
) {}
```

Kenapa metadata penting?

1. API bisa mengisi response header.
2. Client bisa tahu kapan retry.
3. Observability bisa mengelompokkan deny berdasarkan policy.
4. Audit/debugging lebih mudah.
5. Product/business bisa melihat dampak limit.

Untuk HTTP API, umum mengembalikan:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1718877600
```

Header bukan pengganti enforcement. Header hanya komunikasi.

---

## 7. Algoritma 1: Fixed Window Counter

Fixed window adalah algoritma paling sederhana.

Contoh policy:

```text
Maksimal 100 request per menit per user.
```

Key:

```text
rl:{tenant:acme}:user:123:api:search:202606201015
```

Flow:

1. Tentukan window saat ini.
2. Increment counter.
3. Set TTL agar key hilang setelah window selesai.
4. Jika counter > limit, deny.

Redis commands:

```text
INCR key
EXPIRE key ttl
```

### 7.1 Naive Implementation

```java
long count = redis.incr(key);
if (count == 1) {
    redis.expire(key, ttlSeconds);
}
boolean allowed = count <= limit;
```

Masalahnya: `INCR` dan `EXPIRE` adalah dua command. Jika aplikasi crash setelah `INCR` sebelum `EXPIRE`, key bisa hidup tanpa TTL.

### 7.2 Atomic dengan Lua

```lua
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
if current == tonumber(ARGV[1]) then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
local limit = tonumber(ARGV[3])
local ttl = redis.call('PTTL', KEYS[1])
if current > limit then
  return {0, current, limit, ttl}
else
  return {1, current, limit, ttl}
end
```

Parameter:

```text
KEYS[1] = limiter key
ARGV[1] = cost
ARGV[2] = ttlMillis
ARGV[3] = limit
```

Redis Lua execution bersifat atomic relatif terhadap command lain. Selama script berjalan, command lain tidak interleave.

### 7.3 Java dengan Lettuce

```java
public final class FixedWindowRateLimiter {

    private static final String SCRIPT = """
        local current = redis.call('INCRBY', KEYS[1], ARGV[1])
        if current == tonumber(ARGV[1]) then
          redis.call('PEXPIRE', KEYS[1], ARGV[2])
        end
        local limit = tonumber(ARGV[3])
        local ttl = redis.call('PTTL', KEYS[1])
        if current > limit then
          return {0, current, limit, ttl}
        else
          return {1, current, limit, ttl}
        end
        """;

    private final RedisCommands<String, String> redis;

    public FixedWindowRateLimiter(RedisCommands<String, String> redis) {
        this.redis = redis;
    }

    public RateLimitDecision allow(
        String key,
        long cost,
        long windowMillis,
        long limit,
        String policyId
    ) {
        @SuppressWarnings("unchecked")
        List<Long> result = (List<Long>) redis.eval(
            SCRIPT,
            ScriptOutputType.MULTI,
            new String[]{key},
            Long.toString(cost),
            Long.toString(windowMillis),
            Long.toString(limit)
        );

        boolean allowed = result.get(0) == 1;
        long current = result.get(1);
        long ttl = result.get(3);
        long remaining = Math.max(0, limit - current);

        return new RateLimitDecision(
            allowed,
            policyId,
            key,
            limit,
            remaining,
            Math.max(0, ttl),
            System.currentTimeMillis() + Math.max(0, ttl),
            allowed ? "allowed" : "fixed_window_limit_exceeded"
        );
    }
}
```

Catatan:

- Untuk production, lebih baik load script via `SCRIPT LOAD` lalu gunakan `EVALSHA`.
- Tangani `NOSCRIPT` dengan fallback reload script.
- Jangan hardcode policy di script; script harus primitive, policy ada di aplikasi/config.

### 7.4 Kelebihan Fixed Window

- Sederhana.
- Memory kecil.
- Cepat.
- Cocok untuk limit kasar.
- Mudah dijelaskan.

### 7.5 Kelemahan Fixed Window

Masalah utama: **boundary burst**.

Jika limit 100/minute:

```text
10:00:59.900 -> 100 request allowed
10:01:00.100 -> 100 request allowed
```

Dalam 200 ms, client bisa melakukan 200 request. Secara formal tidak melanggar fixed window, tapi secara operational bisa terlalu longgar.

Gunakan fixed window untuk:

- Login attempt kasar.
- Basic API throttle.
- Feature protection sederhana.
- Endpoint yang tidak sangat mahal.

Jangan gunakan fixed window untuk:

- Fairness presisi tinggi.
- Costly operation yang tidak boleh burst.
- Enforcement finansial presisi.

---

## 8. Algoritma 2: Fixed Window dengan Sub-Window Smoothing

Untuk mengurangi boundary burst, bisa gunakan beberapa window kecil.

Contoh:

```text
Limit: 100 per minute
Sub-window: 10 seconds
Maksimal 20 per 10 seconds
```

Ini bukan sliding window penuh, tapi memberi guardrail.

Policy gabungan:

```text
allow jika:
- count per minute <= 100
- count per 10 seconds <= 20
```

Key:

```text
rl:{tenant:acme}:user:123:search:min:202606201015
rl:{tenant:acme}:user:123:search:sec10:2026062010150
```

Masalahnya: multi-key atomicity.

Di single Redis instance, Lua bisa update dua key secara atomic. Di Redis Cluster, semua key harus berada di slot yang sama. Karena itu gunakan hash tag:

```text
rl:{tenant:acme:user:123}:search:min:202606201015
rl:{tenant:acme:user:123}:search:sec10:2026062010150
```

Bagian dalam `{...}` menentukan cluster hash slot. Multi-key script harus memakai key dalam slot yang sama.

---

## 9. Algoritma 3: Sliding Window Log dengan Sorted Set

Sliding window log menyimpan timestamp request individual.

Policy:

```text
Maksimal 100 request dalam rolling 60 detik terakhir.
```

Data structure:

```text
Sorted Set
member = unique request id
score  = timestamp millis
```

Flow:

1. Hapus entry lebih lama dari `now - window`.
2. Hitung jumlah entry tersisa.
3. Jika count < limit, masukkan request baru.
4. Set TTL.
5. Return decision.

Commands:

```text
ZREMRANGEBYSCORE key 0 now-window
ZCARD key
ZADD key now requestId
PEXPIRE key window
```

Harus atomic agar request concurrent tidak menembus limit.

### 9.1 Lua Script

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local cost = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local current = redis.call('ZCARD', key)

if current + cost > limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = window
  if oldest[2] ~= nil then
    retryAfter = (tonumber(oldest[2]) + window) - now
    if retryAfter < 0 then retryAfter = 0 end
  end
  return {0, current, limit, retryAfter}
end

for i = 1, cost do
  redis.call('ZADD', key, now, member .. ':' .. i)
end
redis.call('PEXPIRE', key, window)
return {1, current + cost, limit, 0}
```

### 9.2 Java Key and Member

```java
String member = UUID.randomUUID().toString();
long now = clock.millis();
```

Jangan gunakan timestamp sebagai member tunggal, karena dua request pada millisecond sama bisa overwrite member. Sorted Set member harus unik.

### 9.3 Kelebihan Sliding Log

- Fairness tinggi.
- Rolling window akurat.
- Bisa menghitung retry-after relatif presisi.
- Cocok untuk endpoint mahal atau security-sensitive.

### 9.4 Kelemahan Sliding Log

- Memory proporsional terhadap jumlah request dalam window.
- Setiap request melakukan `ZREMRANGEBYSCORE` dan `ZCARD`.
- Hot key bisa mahal.
- Tidak ideal untuk limit sangat besar seperti 1 juta request/jam per tenant.

Gunakan untuk:

- Login attempt.
- Password reset.
- OTP send.
- Expensive endpoint.
- Per-user strict limiter.

Hindari untuk:

- Global API traffic sangat besar.
- Per-tenant high-volume quota.
- Use case yang cukup dengan approximated fairness.

---

## 10. Algoritma 4: Sliding Window Counter

Sliding window counter adalah kompromi antara fixed window dan sliding log.

Alih-alih menyimpan semua request timestamp, kita menyimpan dua window counter:

```text
previous window count
current window count
```

Lalu menghitung weighted count berdasarkan posisi waktu saat ini dalam window.

Formula:

```text
effectiveCount = currentCount + previousCount * overlapRatio
```

Contoh:

```text
Window = 60 detik
Saat ini 15 detik masuk ke window baru
Overlap previous = 45/60 = 0.75
Current = 20
Previous = 80
Effective = 20 + 80 * 0.75 = 80
```

### 10.1 Kelebihan

- Memory kecil.
- Lebih smooth dari fixed window.
- Tidak menyimpan per-request log.

### 10.2 Kelemahan

- Approximation.
- Implementasi lebih rumit.
- Untuk weighted calculation, perlu hati-hati dengan integer/float.
- Retry-after tidak sepresisi sliding log.

Cocok untuk API general-purpose yang butuh fairness lebih baik dari fixed window tapi tidak butuh presisi penuh.

---

## 11. Algoritma 5: Token Bucket

Token bucket adalah algoritma yang populer karena mendukung burst terbatas.

Mental model:

```text
Bucket punya kapasitas maksimum.
Token refill seiring waktu.
Setiap request mengonsumsi token.
Jika token cukup -> allow.
Jika token tidak cukup -> deny.
```

Policy:

```text
capacity = 100 tokens
refill = 10 tokens per second
cost = 1 token per request
```

Artinya:

- Client bisa burst sampai 100 request jika bucket penuh.
- Setelah itu hanya rata-rata 10 request/detik.

### 11.1 State

Redis Hash atau String JSON bisa menyimpan:

```text
tokens
lastRefillMillis
```

Hash key:

```text
rl:{tenant:acme:user:123}:bucket:api
```

Fields:

```text
tokens = 74
lastRefillMillis = 1718877600123
```

### 11.2 Lua Script

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillRatePerMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttlMillis = tonumber(ARGV[5])

local state = redis.call('HMGET', key, 'tokens', 'lastRefillMillis')
local tokens = tonumber(state[1])
local lastRefill = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  lastRefill = now
end

local elapsed = now - lastRefill
if elapsed < 0 then
  elapsed = 0
end

local refill = elapsed * refillRatePerMs
tokens = math.min(capacity, tokens + refill)
lastRefill = now

local allowed = 0
local retryAfter = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  local missing = cost - tokens
  retryAfter = math.ceil(missing / refillRatePerMs)
end

redis.call('HMSET', key, 'tokens', tokens, 'lastRefillMillis', lastRefill)
redis.call('PEXPIRE', key, ttlMillis)

return {allowed, math.floor(tokens), capacity, retryAfter}
```

### 11.3 Floating Point Concern

Lua di Redis memakai number type dari Lua 5.1. Jangan membuat policy yang bergantung pada floating precision ekstrem.

Alternatif: gunakan integer micro-token.

Contoh:

```text
1 token = 1000 units
capacity = 100_000 units
refill = 10_000 units per second
cost = 1000 units
```

Maka semua arithmetic integer.

### 11.4 Kelebihan Token Bucket

- Mendukung burst natural.
- Bagus untuk API traffic.
- Memory kecil.
- Cocok untuk distributed services.
- Rate rata-rata terkontrol.

### 11.5 Kelemahan Token Bucket

- Perlu clock.
- Lebih sulit dijelaskan dibanding fixed window.
- Implementation bug bisa memberi limit terlalu longgar.
- Dengan clock client-side, node time drift bisa memengaruhi refill.

Untuk mengurangi clock drift, Anda bisa:

- Menggunakan server time dari Redis `TIME` di script.
- Atau memastikan service node sinkron via NTP/chrony.
- Atau menerima toleransi kecil jika enforcement bukan regulatory-grade.

Redis official guide menyediakan contoh token bucket dengan Redis dan Java Lettuce/Jedis, umumnya menggunakan Lua agar operasi refill dan consume atomic.

---

## 12. Algoritma 6: Leaky Bucket

Leaky bucket membatasi aliran keluar dengan rate konstan.

Mental model:

```text
Request masuk ke bucket/antrian.
Bucket bocor dengan rate tetap.
Jika bucket penuh, request ditolak.
```

Dalam API rate limiting, token bucket lebih umum karena mengizinkan burst. Leaky bucket cocok ketika Anda ingin **smooth traffic** secara ketat.

Contoh use case:

- Menahan dispatch job ke external API yang punya strict throughput.
- Mengontrol operasi mahal agar tidak burst.
- Menstabilkan write ke dependency legacy.

Redis implementation bisa memakai:

- Sorted Set sebagai scheduled timestamps.
- List/Stream untuk queue terkontrol.
- Lua untuk claim slot.

Namun hati-hati: jika Anda mulai membuat queue reliable, delay scheduling, retries, DLQ, dan ack semantics, Anda mungkin sedang membangun broker mini. Untuk workflow durable, gunakan sistem messaging yang tepat.

---

## 13. Multi-Dimensional Limiter

Sistem production jarang hanya butuh satu limiter.

Contoh request:

```http
POST /api/v1/cases/123/submit
Authorization: Bearer user:42
X-Tenant: acme
X-Api-Key: k_live_abc
```

Policy:

```text
1. Per IP: max 300/minute
2. Per user: max 100/minute
3. Per tenant: max 10_000/minute
4. Per endpoint expensive submit: max 20/minute per user
5. Per tenant daily submit quota: max 50_000/day
```

Decision harus evaluate beberapa limiter.

### 13.1 Fail Fast Evaluation

```java
List<Policy> policies = List.of(
    ipPolicy,
    userPolicy,
    tenantPolicy,
    endpointPolicy,
    dailyQuotaPolicy
);

for (Policy policy : policies) {
    RateLimitDecision decision = limiter.evaluate(policy, requestContext);
    if (!decision.allowed()) {
        return decision;
    }
}
return allowedDecision();
```

Masalah: policy pertama yang allowed sudah mengonsumsi token/counter. Jika policy keempat deny, policy pertama sampai ketiga sudah increment. Ini disebut **partial consumption**.

### 13.2 Check-Then-Commit Pattern

Untuk multi-policy, idealnya:

1. Check semua policy apakah cukup.
2. Jika semua cukup, consume semua.
3. Jika salah satu tidak cukup, consume tidak ada.

Sulit dilakukan across banyak key, apalagi Redis Cluster.

### 13.3 Praktik Realistis

Pilihan desain:

1. **Accept partial consumption**  
   Untuk abuse limiter, ini sering acceptable. Request yang ditolak tetap dianggap konsumsi attempt.

2. **Order policies from broad to specific**  
   Misalnya IP abuse dulu, lalu expensive quota.

3. **Use same hash slot and Lua for related policies**  
   Jika semua key punya hash tag sama, script bisa check/commit beberapa key atomic di Redis Cluster.

4. **Separate hard quota from soft rate limit**  
   Hard quota mungkin harus pakai durable store, Redis hanya fast cache.

5. **Use reservation model**  
   Consume token lalu compensate jika downstream gagal. Tapi compensation juga punya race/failure issues.

Dalam banyak sistem, “denied request still counts” adalah policy yang sah, khususnya untuk login attempt dan abuse protection.

---

## 14. Key Design untuk Rate Limiter

Key design menentukan correctness, memory, dan cluster behavior.

### 14.1 Format Umum

```text
rl:{scope}:policy:{policyId}:window:{windowId}
```

Contoh:

```text
rl:{tenant:acme:user:123}:policy:search_100pm:window:202606201015
```

### 14.2 Kenapa Hash Tag Penting

Untuk Redis Cluster:

```text
rl:{tenant:acme:user:123}:minute:202606201015
rl:{tenant:acme:user:123}:second10:2026062010150
```

Bagian `{tenant:acme:user:123}` memastikan dua key berada di slot sama.

Jika Anda butuh script multi-key, semua key harus di slot sama.

### 14.3 Hindari Key Berbasis Raw User Input

Jangan langsung memasukkan string user input ke key.

Buruk:

```text
rl:{ip:1.2.3.4}:endpoint:/api/search?q=very-long-user-input
```

Lebih baik:

```text
rl:{ip:1.2.3.4}:endpoint:search
```

Atau hash canonical dimension:

```text
rl:{tenant:acme:user:123}:endpoint:8f14e45f
```

### 14.4 Key Cardinality Control

Setiap kombinasi dimension menciptakan key.

Jika dimension terlalu detail:

```text
user x endpoint x method x query x ip x device x region x minute
```

Anda bisa menciptakan ledakan key.

Prinsip:

```text
Rate limit dimension harus sengaja dipilih,
bukan semua atribut request dimasukkan ke key.
```

---

## 15. TTL Strategy

Limiter key harus punya TTL.

Fixed window:

```text
TTL = window length + small grace
```

Sliding log:

```text
TTL = window length + grace
```

Token bucket:

```text
TTL = time to fully refill when idle + grace
```

Contoh token bucket:

```text
capacity = 100 tokens
refill = 10 tokens/sec
fully refill = 10 sec
TTL maybe 60 sec or 5 min depending cardinality
```

TTL terlalu pendek:

- State hilang terlalu cepat.
- User mendapat bucket penuh terlalu sering.

TTL terlalu panjang:

- Memory meningkat.
- Inactive principals tetap tersimpan.

Untuk monthly quota cache, TTL bisa sampai akhir billing cycle plus grace, tapi durable source tetap sebaiknya bukan Redis saja.

---

## 16. Clock Assumptions

Rate limiter berhubungan dengan waktu. Waktu adalah dependency.

### 16.1 Client-Side Clock

Aplikasi Java mengirim `nowMillis` ke Redis.

Kelebihan:

- Mudah.
- Bisa diuji dengan injected `Clock`.
- Tidak perlu Redis `TIME`.

Kelemahan:

- Antar instance bisa drift.
- Jika clock mundur, refill bisa salah.
- Jika clock maju, token bisa refill terlalu banyak.

### 16.2 Redis Server Clock

Script memanggil:

```lua
local t = redis.call('TIME')
local nowMillis = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
```

Kelebihan:

- Semua limiter state berdasarkan waktu Redis.
- Lebih konsisten antar app instances.

Kelemahan:

- Script bergantung pada command `TIME`.
- Dalam replication/scripting context historis, command nondeterministic perlu dipahami dengan hati-hati.
- Test sedikit lebih sulit.

Untuk enforcement sensitif, gunakan satu sumber waktu yang jelas dan dokumentasikan.

---

## 17. Atomicity: Kenapa Lua Sering Lebih Aman

Redis command individual atomic. Tapi limiter sering butuh beberapa operasi:

```text
read current state
calculate
write new state
set ttl
return decision
```

Jika dilakukan dari client sebagai beberapa command, race condition bisa terjadi.

Contoh race:

```text
limit = 1
current = 0

Client A reads current = 0
Client B reads current = 0
Client A writes current = 1 and allows
Client B writes current = 1 and allows
```

Dua request allowed padahal limit satu.

Lua menyelesaikan ini karena seluruh logic dijalankan sebagai satu unit atomic di Redis.

Tapi Lua juga punya risiko:

- Script terlalu panjang memblok server.
- Script dengan loop besar buruk untuk latency.
- Harus deklarasikan key via `KEYS`.
- Cluster multi-key harus same slot.
- Deployment script harus versioned.

Prinsip:

```text
Gunakan Lua untuk atomic decision kecil dan bounded.
Jangan gunakan Lua untuk business workflow besar.
```

---

## 18. Redis Cluster Considerations

Rate limiter sering berjalan di Redis Cluster untuk scale dan availability.

### 18.1 Single-Key Limiter Aman

Jika setiap decision hanya menyentuh satu key, cluster relatif mudah.

```text
rl:{tenant:acme:user:123}:login:202606201015
```

### 18.2 Multi-Key Limiter Harus Same Slot

Jika script menyentuh beberapa key, gunakan hash tag sama.

Benar:

```text
rl:{tenant:acme:user:123}:min
rl:{tenant:acme:user:123}:hour
```

Salah:

```text
rl:tenant:acme:user:123:min
rl:tenant:acme:user:123:hour
```

Tanpa hash tag, dua key bisa berada di slot berbeda.

### 18.3 Hot Slot Problem

Jika hash tag terlalu broad:

```text
rl:{tenant:acme}:all-users
```

Semua user tenant besar masuk slot sama. Ini bisa menciptakan hot slot.

Jika hash tag terlalu narrow, multi-key atomicity sulit.

Trade-off:

```text
Atomic grouping vs distribution
```

Untuk tenant besar, pertimbangkan:

- Per-user limiter distributed.
- Tenant global limiter dengan sharded counters.
- Approximate aggregation.
- Dedicated Redis capacity untuk tenant besar.

---

## 19. Hot Key dan High-Volume Limiter

Global limiter seperti:

```text
rl:global:api
```

bisa menjadi hot key karena semua request menyentuh key yang sama.

Mitigasi:

1. **Sharded counters**

```text
rl:global:api:shard:0
rl:global:api:shard:1
...
rl:global:api:shard:63
```

Request memilih shard berdasarkan hash request/user.

Masalah: untuk mengetahui total, harus menjumlahkan semua shard. Ini tidak ideal per request.

2. **Local pre-allocation**

Setiap app instance mengambil token batch dari Redis.

```text
Instance A reserve 100 tokens
Instance B reserve 100 tokens
```

Lalu mengonsumsi local tokens.

Kelebihan: Redis load turun.

Kelemahan: jika instance mati, token reserved bisa hilang sementara; fairness lebih longgar.

3. **Hierarchical limiter**

```text
local limiter -> Redis per-user limiter -> Redis tenant limiter -> durable quota
```

4. **Approximate enforcement**

Untuk non-critical global protection, approximate often good enough.

5. **Move enforcement upstream**

Gateway/Nginx/API management layer dapat membatasi sebelum request masuk service. Tapi business-aware limiter tetap sering butuh aplikasi.

---

## 20. Fail-Open vs Fail-Closed

Apa yang terjadi jika Redis tidak bisa dihubungi?

### 20.1 Fail-Open

Jika Redis down, request allowed.

Kelebihan:

- Availability aplikasi lebih tinggi.
- Tidak memblok user legitimate.

Kelemahan:

- Saat attack, proteksi hilang.
- Downstream bisa overload.
- Bisa melanggar quota.

Cocok untuk:

- Non-critical soft limiter.
- UX-sensitive feature.
- Endpoint murah.

### 20.2 Fail-Closed

Jika Redis down, request denied.

Kelebihan:

- Proteksi tetap ketat.
- Tidak melebihi quota.

Kelemahan:

- Redis outage menjadi application outage.
- Bisa menolak traffic legitimate.

Cocok untuk:

- Security-sensitive operation.
- Expensive external API call.
- Regulated quota yang tidak boleh dilanggar.

### 20.3 Degraded Mode

Pilihan lebih matang:

```text
Redis available    -> distributed limiter
Redis unavailable  -> local emergency limiter
```

Local emergency limiter bisa berupa Caffeine/Guava in-memory counter per instance.

Kelemahan: tidak global. Tapi lebih baik daripada tanpa proteksi.

---

## 21. Retry Behavior

Rate limiter failure bukan alasan untuk retry agresif.

Jika Redis timeout, retry bisa menciptakan:

- latency lebih tinggi,
- duplicate increments,
- traffic storm,
- Redis overload makin parah.

Prinsip:

```text
Limiter call harus punya timeout pendek.
Retry maksimal sangat terbatas.
Lebih baik fallback deterministic daripada retry storm.
```

Contoh:

```java
try {
    return limiter.allow(context);
} catch (RedisTimeoutException ex) {
    return fallbackLimiter.allow(context);
}
```

Untuk request denied `429`, client harus mengikuti `Retry-After`. Jangan auto-retry immediate.

---

## 22. Java/Spring Integration Pattern

### 22.1 Filter/Interceptor Level

Untuk HTTP API, limiter bisa ditempatkan di:

- Servlet Filter.
- Spring HandlerInterceptor.
- WebFlux WebFilter.
- API Gateway.
- Service method decorator.

Semakin upstream, semakin murah. Semakin downstream, semakin kaya context.

### 22.2 Spring MVC HandlerInterceptor Example

```java
@Component
public final class RateLimitInterceptor implements HandlerInterceptor {

    private final RateLimitPolicyResolver policyResolver;
    private final DistributedRateLimiter limiter;

    public RateLimitInterceptor(
        RateLimitPolicyResolver policyResolver,
        DistributedRateLimiter limiter
    ) {
        this.policyResolver = policyResolver;
        this.limiter = limiter;
    }

    @Override
    public boolean preHandle(
        HttpServletRequest request,
        HttpServletResponse response,
        Object handler
    ) throws IOException {
        RateLimitContext context = RateLimitContext.from(request);
        List<RateLimitPolicy> policies = policyResolver.resolve(context);

        for (RateLimitPolicy policy : policies) {
            RateLimitDecision decision = limiter.evaluate(policy, context);
            if (!decision.allowed()) {
                response.setStatus(429);
                response.setHeader("Retry-After",
                    Long.toString(Math.max(1, decision.retryAfterMillis() / 1000)));
                response.setHeader("X-RateLimit-Limit", Long.toString(decision.limit()));
                response.setHeader("X-RateLimit-Remaining", Long.toString(decision.remaining()));
                response.setHeader("X-RateLimit-Policy", decision.policyId());
                response.setContentType("application/json");
                response.getWriter().write("""
                    {"error":"rate_limit_exceeded"}
                    """);
                return false;
            }
        }

        return true;
    }
}
```

### 22.3 Policy Resolver

```java
public interface RateLimitPolicyResolver {
    List<RateLimitPolicy> resolve(RateLimitContext context);
}
```

Policy sebaiknya tidak tersebar di annotation random tanpa governance. Untuk sistem besar, policy perlu:

- ID stabil.
- Owner.
- Description.
- Rollout strategy.
- Metrics.
- Exception handling.
- Version.

### 22.4 Example Policy

```java
public record RateLimitPolicy(
    String id,
    RateLimitAlgorithm algorithm,
    Scope scope,
    long limit,
    Duration window,
    long cost,
    FailureMode failureMode
) {}
```

---

## 23. Cost-Based Limiting

Tidak semua request sama mahal.

Contoh:

```text
GET /cases/{id}                  cost 1
GET /cases?query=...             cost 3
POST /cases/{id}/submit          cost 5
POST /reports/export             cost 20
POST /ai/summarize-large-case    cost 100
```

Fixed window script bisa memakai `INCRBY cost`.

Token bucket consume `cost` token.

Keuntungan:

- Lebih adil.
- Melindungi expensive operation.
- Bisa mengintegrasikan business value.

Risiko:

- Cost model harus stabil.
- Client bisa merasa limit “tidak transparan” jika response tidak menjelaskan cost.
- Cost harus dihitung sebelum operation dijalankan.

Untuk operation dengan cost baru diketahui setelah proses, gunakan reservation:

```text
reserve estimated cost -> execute -> adjust/refund if needed
```

Tapi refund punya failure mode. Untuk enforcement yang strict, cost harus diketahui upfront.

---

## 24. Quota Enforcement dan Durable Record

Untuk monthly quota, jangan hanya Redis counter jika quota berkaitan dengan billing atau compliance.

Better architecture:

```text
Request
  -> Redis fast quota check
  -> Process operation
  -> Emit usage event
  -> Durable usage ledger / SQL / warehouse
  -> Periodic reconciliation
```

Redis state:

```text
quota:{tenant:acme}:2026-06 = 75421
```

SQL/event ledger:

```text
usage_event(id, tenant_id, operation, cost, occurred_at, request_id, policy_id)
```

Redis bisa dipakai untuk:

- Fast deny ketika jelas quota habis.
- Approximate remaining quota.
- Protecting hot path.

Durable store dipakai untuk:

- Billing.
- Dispute resolution.
- Audit.
- Reconciliation.

### 24.1 Reconciliation

Jika Redis counter beda dari ledger, siapa menang?

Biasanya ledger durable menang.

Redis bisa diperbaiki:

```text
SET quota:{tenant}:month ledger_total EX end_of_month_ttl
```

### 24.2 Idempotency

Usage event harus idempotent.

Gunakan `requestId` atau `operationId` agar retry tidak menghitung ganda.

Redis limiter dan usage ledger harus sama-sama sadar idempotency untuk operasi mahal.

---

## 25. Auditability untuk Sistem Regulatori

Dalam sistem regulatori/enforcement, limiter decision mungkin perlu dapat dijelaskan.

Minimal log event untuk deny:

```json
{
  "eventType": "RATE_LIMIT_DENIED",
  "decisionId": "d_01HX...",
  "policyId": "case_submit_user_20_per_min",
  "policyVersion": "2026-06-01",
  "principalType": "user",
  "principalId": "123",
  "tenantId": "acme",
  "action": "case.submit",
  "limit": 20,
  "remaining": 0,
  "retryAfterMillis": 42100,
  "algorithm": "SLIDING_WINDOW_LOG",
  "scopeKeyHash": "...",
  "occurredAt": "2026-06-20T10:15:03.120Z"
}
```

Jangan log raw sensitive key jika mengandung user/IP/email/token. Gunakan hashing atau structured fields yang aman.

Audit log tidak harus disimpan di Redis. Biasanya dikirim ke log/event pipeline.

### 25.1 Explainability

Policy harus bisa dijawab:

- Rule mana yang menolak request?
- Apakah rule masih aktif saat itu?
- Scope apa yang dipakai?
- Berapa limitnya?
- Berapa usage saat decision?
- Apakah decision berasal dari Redis normal mode atau fallback mode?
- Apakah ada override/manual exception?

---

## 26. Observability

Metrics yang perlu ada:

```text
rate_limit.allowed.count{policyId}
rate_limit.denied.count{policyId, reason}
rate_limit.error.count{policyId, errorType}
rate_limit.fallback.count{policyId, mode}
rate_limit.redis.latency{operation}
rate_limit.remaining.histogram{policyId}
rate_limit.retry_after.histogram{policyId}
rate_limit.hot_key.detected.count
```

Dashboard harus bisa menjawab:

1. Policy mana paling sering deny?
2. Apakah deny naik tiba-tiba?
3. Apakah Redis latency memengaruhi request latency?
4. Apakah fallback mode aktif?
5. Apakah satu tenant/user menyebabkan load abnormal?
6. Apakah key cardinality naik abnormal?

Log denied request secara sampling untuk high-volume policy, tapi full log untuk security-sensitive action seperti login/OTP.

---

## 27. Testing Strategy

### 27.1 Unit Test Algorithm

Gunakan fake clock.

Test:

- First request allowed.
- Limit-th request allowed.
- Limit+1 denied.
- Window reset.
- Cost > 1.
- Negative/zero cost rejected.
- Retry-after reasonable.

### 27.2 Concurrency Test

Simulasikan 100 thread mencoba consume limit 10.

Expected:

```text
allowed == 10
denied == 90
```

Jika hasil 11 allowed, limiter tidak atomic.

### 27.3 Integration Test dengan Testcontainers

```java
@Container
static GenericContainer<?> redis = new GenericContainer<>("redis:8")
    .withExposedPorts(6379);
```

Test against real Redis karena Lua, TTL, Sorted Set behavior, dan command semantics lebih aman diuji pada Redis asli.

### 27.4 Failure Test

Simulasi:

- Redis down.
- Redis timeout.
- Script `NOSCRIPT`.
- Cluster `MOVED`.
- High latency.
- Key evicted.
- Clock skew.

Limiter tanpa failure test hampir pasti punya perilaku tidak terdokumentasi saat incident.

---

## 28. Common Anti-Patterns

### 28.1 `GET` lalu `SET` Counter Manual

```java
String value = redis.get(key);
int count = value == null ? 0 : Integer.parseInt(value);
redis.set(key, Integer.toString(count + 1));
```

Race condition.

Gunakan `INCRBY` atau Lua.

### 28.2 `INCR` tanpa TTL Atomic

```java
redis.incr(key);
redis.expire(key, 60);
```

Jika crash di tengah, key bisa bocor.

Gunakan Lua atau command/primitive atomik yang sesuai.

### 28.3 Membuat Key dari Full URL

```text
rl:user:123:/search?q=very-long&random=...
```

Cardinality explosion.

### 28.4 Global Limiter Hot Key

```text
rl:all_requests
```

Semua traffic menghantam satu key.

### 28.5 Menggunakan Redis sebagai Billing Ledger

Counter Redis hilang/bergeser/failover bukan audit record.

### 28.6 Fail-Open untuk Security Critical Endpoint

Jika login brute force limiter fail-open, Redis outage menjadi attack window.

### 28.7 Tidak Mengembalikan Retry-After

Client tidak tahu kapan retry, lalu retry storm.

### 28.8 Policy Tanpa Owner

Limit muncul di code, tidak ada yang tahu alasannya, lalu dipertahankan selamanya.

---

## 29. Algorithm Selection Matrix

| Use Case | Recommended Algorithm | Reason |
|---|---|---|
| Basic API throttle | Fixed window / token bucket | Simple and cheap |
| Login attempt | Sliding window log | Strict recent attempt control |
| OTP send | Sliding window log + daily quota | Security and abuse sensitive |
| Expensive report export | Token bucket / sliding log | Control burst and cost |
| Tenant API plan | Fixed window + durable quota ledger | Business quota needs reconciliation |
| Global traffic protection | Sharded counters / gateway limiter | Avoid Redis hot key |
| External API protection | Token bucket / leaky bucket | Smooth throughput |
| Regulatory action submission | Sliding log + audit event | Explainable denial |
| AI inference quota | Cost-based token bucket + durable usage | Cost varies per request |

---

## 30. Production Checklist

Sebelum deploy rate limiter Redis, jawab ini:

### Policy

- Apa policy ID-nya?
- Siapa owner-nya?
- Apa action yang dibatasi?
- Apa principal/scope-nya?
- Apa limit, window, cost?
- Apakah denied request tetap dihitung?
- Apakah ada override?

### Algorithm

- Fixed window, sliding log, sliding counter, token bucket, atau lainnya?
- Apakah fairness cukup?
- Apakah burst diperbolehkan?
- Apakah retry-after bisa dihitung?

### Redis

- Apakah key punya TTL?
- Apakah operasi atomic?
- Apakah script bounded?
- Apakah cluster key memakai hash tag benar?
- Apakah key cardinality terkendali?
- Apakah hot key mungkin?

### Java

- Apakah timeout pendek?
- Apakah fallback mode jelas?
- Apakah exception handling deterministic?
- Apakah response header benar?
- Apakah policy resolver testable?

### Operations

- Metrics tersedia?
- Deny logs tersedia?
- Alert tersedia?
- Redis memory budget dihitung?
- Load test sudah dilakukan?
- Failure test sudah dilakukan?

### Compliance/Audit

- Apakah decision bisa dijelaskan?
- Apakah deny event disimpan?
- Apakah quota durable source tersedia?
- Apakah raw sensitive data tidak bocor ke key/log?

---

## 31. End-to-End Example: Cost-Based Token Bucket for Java API

### 31.1 Policy

```java
RateLimitPolicy policy = new RateLimitPolicy(
    "tenant_api_cost_1000_per_min",
    RateLimitAlgorithm.TOKEN_BUCKET,
    Scope.TENANT,
    1000,
    Duration.ofMinutes(1),
    requestCost,
    FailureMode.DEGRADED_LOCAL
);
```

Interpretasi:

```text
Tenant mendapat 1000 token kapasitas.
Token refill rata-rata 1000 per menit.
Request mengonsumsi token sesuai cost.
```

### 31.2 Key

```java
String key = "rl:{tenant:" + tenantId + "}:policy:" + policy.id();
```

### 31.3 Decision Flow

```text
1. Resolve tenant.
2. Resolve endpoint/action.
3. Calculate cost.
4. Execute Lua token bucket.
5. If allowed -> continue.
6. If denied -> return 429 with metadata.
7. If Redis error -> fallback according to policy.
8. Emit metrics.
9. For business quota -> emit durable usage event after successful operation.
```

### 31.4 HTTP Response

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12
X-RateLimit-Policy: tenant_api_cost_1000_per_min
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0

{
  "error": "rate_limit_exceeded",
  "policy": "tenant_api_cost_1000_per_min",
  "retryAfterSeconds": 12
}
```

---

## 32. How to Think Like a Top 1% Engineer

Engineer pemula bertanya:

> “Command Redis apa untuk rate limiter?”

Engineer kuat bertanya:

> “Apa enforcement contract-nya?”

Checklist mental model:

1. **Policy before algorithm**  
   Jangan pilih Redis structure sebelum tahu apa yang dibatasi.

2. **Atomicity before performance**  
   Limiter cepat tapi race-prone tidak berguna.

3. **TTL before memory growth**  
   Semua limiter state harus punya lifecycle.

4. **Scope before key**  
   Key adalah representasi policy scope, bukan string asal-asalan.

5. **Failure mode before happy path**  
   Redis timeout adalah bagian desain, bukan edge case.

6. **Audit before denial**  
   Jika denial berdampak ke user/business/regulatory process, decision harus bisa dijelaskan.

7. **Cluster before production**  
   Desain key dari awal seolah Redis akan di-cluster.

8. **Cost before count**  
   Request count sering terlalu kasar. Banyak sistem butuh cost-based limiting.

9. **Approximation is a policy decision**  
   Approximate limiter bukan salah, selama disadari dan didokumentasikan.

10. **Redis is runtime state, not universal truth**  
   Untuk billing/audit, butuh durable record.

---

## 33. Latihan Praktis

### Exercise 1 — Fixed Window Login Limiter

Buat limiter:

```text
max 5 login attempts per 10 minutes per username+IP
```

Requirements:

- Key tidak menyimpan raw username; gunakan hash.
- Atomic `INCRBY + PEXPIRE`.
- Return retry-after.
- Denied attempt tetap dihitung.

### Exercise 2 — Sliding Window OTP Limiter

Buat limiter:

```text
max 3 OTP send per 15 minutes per phone number
max 10 OTP send per day per phone number
```

Requirements:

- Phone number tidak raw di key.
- Sliding window untuk 15 menit.
- Fixed/day quota untuk daily.
- Multi-policy evaluation.
- Deny log event.

### Exercise 3 — Token Bucket API Limiter

Buat token bucket:

```text
capacity 100
refill 10 token/sec
cost berbeda per endpoint
```

Requirements:

- Lua atomic.
- Integer micro-token.
- Fallback local limiter jika Redis timeout.
- Metrics per policy.

### Exercise 4 — Cluster Key Review

Untuk setiap key berikut, tentukan apakah aman untuk multi-key script di Redis Cluster:

```text
rl:tenant:acme:user:123:min
rl:tenant:acme:user:123:hour

rl:{tenant:acme:user:123}:min
rl:{tenant:acme:user:123}:hour

rl:{tenant:acme}:user:123:min
rl:{tenant:acme}:user:456:min
```

Jelaskan trade-off hot slot dan atomicity.

---

## 34. Ringkasan

Rate limiting dengan Redis terlihat seperti masalah counter, tapi sebenarnya masalah desain enforcement.

Redis memberi primitive yang kuat:

- `INCRBY` untuk counter.
- TTL untuk lifecycle.
- Sorted Set untuk sliding window.
- Hash untuk token bucket state.
- Lua untuk atomic multi-step decision.
- Cluster hash tag untuk multi-key locality.

Namun Redis tidak otomatis memberi:

- policy yang benar,
- auditability,
- durable quota record,
- safe fallback,
- hot key mitigation,
- semantic clarity.

Kesimpulan utama:

```text
Rate limiter yang baik bukan hanya cepat.
Ia harus benar dalam concurrency, eksplisit dalam policy,
terkendali dalam memory, jelas saat failure,
dan dapat dijelaskan saat ditolak.
```

---

## 35. Referensi Teknis

Dokumentasi yang relevan untuk pendalaman:

- Redis command `INCR` dan pattern counter dengan expiration.
- Redis rate limiter use case guide.
- Redis token bucket limiter dengan Java Lettuce/Jedis.
- Redis Lua scripting dan `EVAL`.
- Redis Sorted Sets dan sliding-window rate limiter.
- Redis command `ZADD`, `ZCARD`, `ZREMRANGEBYSCORE`.
- Redis pipelining dan Java client behavior.
- Spring Data Redis untuk integrasi aplikasi Spring.

---

## 36. Status Seri

```text
Part 011 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-012.md
```

Part berikutnya akan membahas:

```text
Idempotency, Deduplication, dan Exactly-Once Illusion
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Cache Architecture II: Consistency, Invalidation, Stampede, Hot Key</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-012.md">Part 012 — Idempotency, Deduplication, dan Exactly-Once Illusion ➡️</a>
</div>
