# learn-redis-mastery-for-java-engineers-part-015.md

# Part 015 — Redis Functions dan Programmability Modern

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara arsitektural, bukan hanya sebagai cache library.  
> Prasyarat: Part 000–014, terutama Part 014 tentang Lua scripting.  
> Fokus bagian ini: Redis Functions sebagai cara modern untuk menaruh logic atomik, reusable, versionable, dan deployable di sisi Redis tanpa menjadikan Redis sebagai application server tersembunyi.

---

## 0. Posisi Bagian Ini dalam Seri

Di Part 014 kita membahas Lua scripting dengan `EVAL` dan `EVALSHA`.

Lua script memberi Redis kemampuan menjalankan beberapa operasi sebagai satu unit atomik di server. Itu sangat berguna untuk pattern seperti:

- safe unlock distributed lock,
- rate limiter,
- compare-and-set,
- idempotency state transition,
- consume quota,
- conditional update,
- small state-machine transition.

Namun ada masalah operasional pada model `EVAL` klasik:

1. Script biasanya dikirim dari aplikasi.
2. Redis hanya menyimpan script cache berdasarkan SHA.
3. Script cache bukan deployment artifact yang eksplisit.
4. Jika Redis restart atau `SCRIPT FLUSH`, client harus load ulang.
5. Versioning script sering tersebar di beberapa service.
6. Observability dan ownership script kurang jelas.
7. Tidak ada konsep library server-side yang stabil.

Redis Functions diperkenalkan untuk menjawab sebagian masalah tersebut. Redis Functions tersedia sejak Redis 7 dan didesain sebagai API untuk mengelola code server-side yang dapat dipanggil dengan `FCALL`/`FCALL_RO`. Dokumentasi Redis menyebut Functions sebagai API untuk mengelola code yang dieksekusi di server dan, untuk Redis 7+, sebagai pendekatan yang menggantikan penggunaan `EVAL` untuk banyak kebutuhan programmability modern. [Redis Functions documentation](https://redis.io/docs/latest/develop/programmability/functions-intro/)

Mental modelnya:

```text
Lua EVAL script:
  application owns script text
  Redis executes script text / script SHA
  lifecycle mostly controlled by clients

Redis Function:
  Redis owns loaded library
  application calls named function
  lifecycle managed as Redis-side artifact
```

Part ini akan membahas bukan hanya “cara pakai”, tetapi juga:

- kapan Redis Functions membuat sistem lebih benar,
- kapan Functions membuat sistem lebih sulit dioperasikan,
- bagaimana mendesain versioning,
- bagaimana memasukkannya ke Java delivery pipeline,
- bagaimana menghindari Redis berubah menjadi application server yang tidak terlihat.

---

## 1. Redis Programmability: Apa yang Sebenarnya Sedang Kita Lakukan?

Redis programmability berarti kita mengeksekusi logic dekat dengan data Redis.

Tanpa programmability:

```text
Java service:
  GET key
  evaluate condition
  SET key
  EXPIRE key
```

Masalahnya:

```text
Between GET and SET:
  another client may change the key
```

Dengan Lua atau Function:

```text
Redis server:
  read key
  evaluate condition
  write key
  set ttl

All executed as one server-side operation.
```

Tujuan utama bukan “menulis logic dalam Lua karena keren”. Tujuan utamanya adalah:

1. Mengurangi race condition.
2. Mengurangi round trip.
3. Menjaga invariant kecil secara atomik.
4. Menaruh operasi multi-command di satu execution boundary.
5. Membuat beberapa service memanggil primitive yang sama.

Redis programmability cocok untuk **small deterministic data-local logic**.

Redis programmability buruk untuk:

- business workflow panjang,
- orchestration antar service,
- logic yang butuh HTTP call,
- query kompleks lintas bounded context,
- operasi CPU berat,
- transaksi multi-resource,
- logic yang membutuhkan debugging kompleks,
- domain policy yang sering berubah dan perlu observability kaya.

Prinsip penting:

> Redis Functions should protect Redis invariants, not replace your Java domain model.

---

## 2. Dari Lua Script ke Redis Function

### 2.1 Lua Script dengan `EVAL`

Contoh sederhana safe decrement quota:

```lua
local key = KEYS[1]
local requested = tonumber(ARGV[1])
local current = tonumber(redis.call('GET', key) or '0')

if current < requested then
  return {0, current}
end

local remaining = current - requested
redis.call('SET', key, remaining)
return {1, remaining}
```

Dipanggil dengan:

```text
EVAL <script> 1 quota:tenant:acme 5
```

Atau setelah `SCRIPT LOAD`:

```text
EVALSHA <sha> 1 quota:tenant:acme 5
```

### 2.2 Masalah `EVAL` dalam Sistem Besar

Untuk satu service kecil, `EVALSHA` cukup.

Untuk ekosistem banyak service, muncul masalah:

```text
Service A has script v1
Service B has script v2
Service C forgot to preload script
Redis restarted
One pod still calls old SHA
A new deployment changed script return shape
Observability only says EVALSHA failed
```

Ini bukan masalah Redis semata. Ini masalah **artifact ownership**.

Script sudah menjadi bagian dari kontrak sistem, tetapi sering diperlakukan seperti string literal di code Java.

Redis Functions memberi bentuk lebih eksplisit:

```text
Library name: quota_lib
Function name: consume_quota
Version: encoded in library name or deployment metadata
Invocation: FCALL consume_quota 1 quota:tenant:acme 5
```

Dokumentasi `FUNCTION LOAD` menjelaskan bahwa library Function dideklarasikan dengan `redis.register_function()`, lalu dipanggil menggunakan `FCALL` atau `FCALL_RO`. Jika library dengan nama sama sudah ada, Redis mengembalikan error kecuali modifier `REPLACE` digunakan. [Redis FUNCTION LOAD documentation](https://redis.io/docs/latest/commands/function-load/)

---

## 3. Redis Functions: Mental Model

Redis Function terdiri dari beberapa konsep:

```text
Function library
  ├── metadata / shebang
  ├── one or more registered functions
  ├── Lua code
  └── loaded into Redis server

Application client
  └── FCALL function_name numkeys key... arg...
```

Redis Function bukan class Java.

Redis Function lebih mirip:

```text
named server-side command extension
```

Tetapi extension ini berada dalam batas Redis programmability, bukan native module.

### 3.1 Library

Library adalah unit deployment.

Satu library bisa berisi beberapa function.

Contoh:

```text
idempotency_lib
  start_request
  complete_request
  fail_request
  get_request_status
```

Atau:

```text
quota_lib
  consume
  refund
  inspect
```

### 3.2 Function

Function adalah entry point yang dipanggil client.

Contoh pemanggilan:

```text
FCALL consume_quota 1 quota:{tenant-123}:daily 5
```

Maknanya:

```text
FCALL <function_name> <numkeys> <keys...> <args...>
```

Jumlah key harus eksplisit, sama seperti `EVAL`.

### 3.3 Atomicity

Seperti Lua script, function dieksekusi di Redis server sebagai satu execution unit. Selama function berjalan, command lain tidak interleave ke tengah logic function tersebut.

Implikasinya:

```text
Good:
  invariant kecil bisa dijaga atomik

Danger:
  function lambat akan menahan Redis memproses command lain
```

Atomicity di Redis bukan izin untuk menulis logic mahal. Atomicity adalah kontrak yang harus dipakai hemat.

---

## 4. Contoh Redis Function Minimal

Contoh library sederhana:

```lua
#!lua name=counter_lib

redis.register_function('increment_by', function(keys, args)
  local key = keys[1]
  local delta = tonumber(args[1])
  local value = redis.call('INCRBY', key, delta)
  return value
end)
```

Load ke Redis:

```bash
redis-cli FUNCTION LOAD "$(cat counter_lib.lua)"
```

Panggil:

```bash
redis-cli FCALL increment_by 1 counter:orders 3
```

Hasil:

```text
(integer) 3
```

Panggil lagi:

```bash
redis-cli FCALL increment_by 1 counter:orders 7
```

Hasil:

```text
(integer) 10
```

Ini contoh sangat sederhana. Nilainya bukan pada `INCRBY`, karena `INCRBY` sendiri sudah atomik. Nilainya adalah memahami struktur library/function.

---

## 5. Contoh yang Lebih Realistis: Atomic Quota Consume

Misalnya ada sistem API enforcement.

Kebutuhan:

```text
A tenant has remaining daily quota.
A request consumes N units.
If remaining quota is insufficient, reject.
If sufficient, decrement atomically and return remaining quota.
```

Tanpa function, naive Java flow:

```java
String current = redis.get(key);
if (Integer.parseInt(current) < requested) reject();
redis.decrBy(key, requested);
```

Race condition:

```text
Initial quota = 10
Request A reads 10, wants 7
Request B reads 10, wants 7
Both pass
Both decrement
Final quota = -4
Invariant broken
```

Function:

```lua
#!lua name=quota_lib

redis.register_function('consume_quota', function(keys, args)
  local key = keys[1]
  local requested = tonumber(args[1])

  if requested == nil or requested <= 0 then
    return {err = 'requested quota must be positive'}
  end

  local current = tonumber(redis.call('GET', key) or '0')

  if current < requested then
    return {0, current}
  end

  local remaining = current - requested
  redis.call('SET', key, remaining)

  return {1, remaining}
end)
```

Load:

```bash
redis-cli FUNCTION LOAD "$(cat quota_lib.lua)"
```

Seed quota:

```bash
redis-cli SET quota:{tenant-123}:daily 10 EX 86400
```

Consume:

```bash
redis-cli FCALL consume_quota 1 quota:{tenant-123}:daily 7
```

Expected:

```text
1) (integer) 1
2) (integer) 3
```

Consume again:

```bash
redis-cli FCALL consume_quota 1 quota:{tenant-123}:daily 7
```

Expected:

```text
1) (integer) 0
2) (integer) 3
```

Invariant:

```text
quota never goes below zero
```

This is the kind of invariant Redis Functions are good at preserving.

---

## 6. Important Correction: Preserve TTL When Updating

Function di atas punya bug desain halus.

Kita seed key dengan TTL:

```bash
SET quota:{tenant-123}:daily 10 EX 86400
```

Tapi function menjalankan:

```lua
redis.call('SET', key, remaining)
```

Secara default, `SET` tanpa opsi TTL akan mengganti value dan menghapus TTL lama.

Efeknya:

```text
quota daily key becomes persistent
quota never expires
capacity leak
wrong enforcement window
```

Redis `SET` mendukung opsi `KEEPTTL`, tetapi tidak semua engineer mengingatnya.

Perbaikan:

```lua
#!lua name=quota_lib_v2

redis.register_function('consume_quota_v2', function(keys, args)
  local key = keys[1]
  local requested = tonumber(args[1])

  if requested == nil or requested <= 0 then
    return {err = 'requested quota must be positive'}
  end

  local current = tonumber(redis.call('GET', key) or '0')

  if current < requested then
    return {0, current}
  end

  local remaining = current - requested
  redis.call('SET', key, remaining, 'KEEPTTL')

  return {1, remaining}
end)
```

This is why Redis programmability must be treated as production code.

A one-line Redis command choice can alter lifecycle semantics.

---

## 7. Function Return Contract

Function return shape is an API contract.

Bad return contract:

```lua
return 'ok'
```

Why bad?

- tidak ada reason code,
- tidak ada remaining quota,
- sulit observability,
- caller harus infer state,
- susah versioning.

Better:

```lua
return {1, 'CONSUMED', remaining}
```

Or:

```lua
return {0, 'INSUFFICIENT_QUOTA', current}
```

Recommended shape untuk Java:

```text
[successFlag, code, numericValue, optionalEpochMillis]
```

Example:

```text
[1, "CONSUMED", 42]
[0, "INSUFFICIENT_QUOTA", 3]
[0, "MISSING_KEY", 0]
```

Why not return JSON string?

Bisa, tapi ada trade-off:

```text
Array reply:
  + native Redis protocol
  + cheaper
  + easy enough to map
  - less self-describing

JSON string:
  + self-describing
  + easier backward compatibility
  - serialization overhead
  - error-prone if manually constructed in Lua
```

Untuk primitive latency-critical, array reply biasanya cukup.

Untuk admin/debug function, JSON boleh dipertimbangkan.

---

## 8. Function Naming and Library Naming

Naming Redis Function harus diperlakukan seperti public API.

Bad:

```text
update
process
check
script1
consume
```

Better:

```text
quota_consume_v1
idempotency_start_v1
idempotency_complete_v1
lock_release_if_owner_v1
rate_limit_token_bucket_v1
```

Library naming options:

### Option A — Domain Library with Version in Function Name

```text
library: quota_lib
function: quota_consume_v1
function: quota_refund_v1
function: quota_consume_v2
```

Pros:

- one library per bounded Redis primitive,
- multiple versions can coexist,
- safe gradual rollout.

Cons:

- library grows over time,
- cleanup discipline needed.

### Option B — Versioned Library Name

```text
library: quota_lib_v1
function: quota_consume

library: quota_lib_v2
function: quota_consume
```

Problem:

Redis Function invocation is by function name. If two libraries register the same function name, conflict semantics matter. To avoid ambiguity, function names should usually remain globally unique.

Practical recommendation:

```text
library: quota_lib
function: quota_consume_v1
function: quota_consume_v2
```

Or:

```text
library: quota_v1_lib
function: quota_v1_consume
```

The key is: make function names explicit and migration-safe.

---

## 9. Redis Functions vs Lua EVAL

| Dimension | Lua `EVAL` / `EVALSHA` | Redis Functions |
|---|---:|---:|
| Lifecycle | Client-managed | Server-managed |
| Deployment artifact | Usually app code string | Function library |
| Invocation | Script body or SHA | Named function |
| Preload requirement | Often yes for SHA | Load library once |
| Restart behavior | Script cache can be lost | Function library persists according to Redis function mechanism/configuration |
| Versioning | Ad hoc | More structured |
| Observability | Script SHA often opaque | Function names are more meaningful |
| Best for | small app-owned logic | shared Redis primitive |
| Risk | script sprawl | hidden server-side application logic |

Redis documentation frames Redis Functions as the Redis 7+ way to manage server-side programmability, while Lua scripting remains available and useful, especially for simpler or legacy cases. [Redis programmability documentation](https://redis.io/docs/latest/develop/programmability/)

---

## 10. When Redis Functions Improve Correctness

Redis Functions are appropriate when all these are true:

```text
The operation touches Redis-local state only.
The invariant must hold atomically.
The operation is small and deterministic.
The function runtime is expected to be very short.
The same primitive is reused by multiple callers.
The return contract is stable.
The function can be tested independently.
The function has clear ownership.
```

Examples:

### 10.1 Idempotency State Transition

```text
START request if absent
COMPLETE request only if state=STARTED and fingerprint matches
FAIL request only if state=STARTED
REPLAY only if state=COMPLETED
```

This is a good candidate because:

- state is Redis-local,
- transitions are small,
- race condition matters,
- multiple app instances need identical behavior.

### 10.2 Token Bucket Rate Limit

```text
refill tokens based on time
consume token if enough
write new token count and timestamp
return allow/deny/retryAfter
```

Good candidate because:

- multi-step math,
- atomic read-modify-write,
- latency-sensitive,
- used by many nodes.

### 10.3 Safe Lock Release

```text
if GET lockKey == ownerToken then DEL lockKey else do nothing
```

Good candidate because:

- tiny,
- prevents wrong-owner unlock,
- canonical pattern.

### 10.4 Conditional TTL Preservation

```text
update value only if version matches
preserve TTL
return version conflict or success
```

Good candidate because:

- TTL semantics are part of invariant,
- Java-side multi-command sequence is race-prone.

---

## 11. When Redis Functions Harm Operability

Redis Functions are dangerous when they become:

```text
business process engine
workflow engine
policy engine
hidden microservice
cross-system transaction coordinator
long-running computation host
```

Bad examples:

### 11.1 Full Order Validation in Redis Function

```text
Check user eligibility
Check inventory
Check pricing
Apply discount
Write cart state
Publish event
Update quota
Return order decision
```

Why bad?

- too much domain logic,
- difficult to debug,
- Redis cannot call your service dependencies,
- poor observability,
- hard rollback,
- hidden coupling.

### 11.2 Large Set Computation in Function

```text
SMEMBERS huge:set
loop over every member
calculate decision
write many keys
```

Why bad?

- blocks Redis,
- unpredictable latency,
- CPU heavy,
- memory heavy,
- violates latency discipline.

### 11.3 Function as Batch Job

```text
scan all keys
migrate values
transform payloads
```

Why bad?

- Redis Functions execute in Redis server path,
- batch migration should be externalized,
- operational blast radius too large.

Rule:

> If you would be embarrassed to see the function in your production latency flame graph, it does not belong in Redis.

---

## 12. Execution Model and Latency Discipline

Redis is fast partly because command execution is simple and predictable.

Functions can destroy that predictability.

A function that runs for 20 ms may sound small in Java application terms.

In Redis terms, 20 ms is huge.

Why?

```text
Redis processes many commands in a tight event loop.
A long function delays unrelated commands.
Tail latency rises.
Timeouts increase.
Clients retry.
Retry storm amplifies load.
Redis gets slower.
Incident begins.
```

Target mindset:

```text
Good function runtime: microseconds to low single-digit milliseconds
Suspicious: several milliseconds under normal load
Dangerous: tens of milliseconds
Incident-grade: loops over unbounded collections
```

Avoid inside functions:

- unbounded loops,
- `KEYS`,
- large `SMEMBERS`,
- large `HGETALL`,
- full stream scans,
- large sorted set range processing,
- complex string manipulation,
- large payload parsing.

Bound everything.

If a function loops, there must be an explicit limit:

```lua
local limit = tonumber(args[1])
if limit == nil or limit < 1 or limit > 100 then
  return {err = 'invalid limit'}
end
```

---

## 13. Cluster Constraints

Redis Cluster changes how you design functions.

A function can only safely operate on keys that are available on the same shard execution context.

The client passes keys explicitly:

```text
FCALL my_func 2 key1 key2 arg1
```

In Redis Cluster, multi-key operations require keys to map to the same hash slot.

Use hash tags:

```text
quota:{tenant-123}:daily
quota:{tenant-123}:metadata
quota:{tenant-123}:audit-window
```

The part inside `{}` determines hash slot.

Good:

```text
quota:{tenant-123}:tokens
quota:{tenant-123}:last-refill
```

Bad:

```text
quota:tenant-123:tokens
quota-last-refill:tenant-123
```

These may land on different slots.

Design rule:

> If a function needs multiple keys, design the key names and hash tags before writing the function.

Do not retrofit cluster compatibility after production adoption.

---

## 14. Read-Only Functions: `FCALL_RO`

Redis provides `FCALL` and `FCALL_RO`.

Conceptually:

```text
FCALL     => function may write
FCALL_RO  => function is read-only
```

Use read-only functions for:

- computed read view,
- safe inspect command,
- validation without mutation,
- admin diagnostics.

Benefits:

- clearer intent,
- safer routing possibilities in some deployments,
- easier ACL policy,
- less accidental mutation.

Example read-only function:

```lua
#!lua name=quota_read_lib

redis.register_function{
  function_name = 'quota_inspect_v1',
  callback = function(keys, args)
    local key = keys[1]
    local value = redis.call('GET', key)
    local ttl = redis.call('TTL', key)
    return {value or false, ttl}
  end,
  flags = { 'no-writes' }
}
```

Call:

```bash
redis-cli FCALL_RO quota_inspect_v1 1 quota:{tenant-123}:daily
```

The exact registration style and flags should follow Redis documentation for your Redis version.

---

## 15. Deployment Model

Redis Functions turn server-side code into deployment artifact.

That means you need a deployment strategy.

### 15.1 Anti-Pattern: App Loads Function on Every Startup Without Discipline

Bad:

```text
Every Java service instance starts
Each instance blindly calls FUNCTION LOAD REPLACE
Multiple versions race
One old pod overwrites new function
Production behavior flips
```

This is dangerous.

### 15.2 Better: Function Migration Step

Use a controlled migration phase:

```text
CI/CD pipeline
  run function syntax check
  run integration tests against Redis container
  load new function library
  verify FUNCTION LIST
  deploy application version that calls new function
  observe
  remove old function later
```

The function lifecycle should be explicit.

### 15.3 Deployment Sequence for Backward-Compatible Function

```text
1. Load new function with new name: quota_consume_v2
2. Deploy Java service that can call v2
3. Gradually route traffic to v2 callers
4. Monitor result codes and latency
5. Stop v1 callers
6. Remove v1 after safe window
```

### 15.4 Deployment Sequence for Return Contract Change

If return shape changes:

```text
v1 returns [allowed, remaining]
v2 returns [allowed, code, remaining, retryAfterMs]
```

Do not replace in place.

Use new function name:

```text
quota_consume_v2
```

Then update Java parser explicitly.

---

## 16. Rollback Strategy

Every Redis Function deployment needs rollback.

Questions:

1. Can old Java code still call old function?
2. Are old and new functions coexisting?
3. Did new function change stored data format?
4. Can stored data be read by old function?
5. Can rollback happen without clearing Redis?
6. Are result codes compatible?
7. Are metrics tagged by function version?

Good rollback design:

```text
Deploy additive functions first.
Do not mutate existing function behavior in-place during risky releases.
Keep old function until traffic proves stable.
Avoid data format migration inside hot-path function.
```

Bad rollback design:

```text
FUNCTION LOAD REPLACE quota_lib
New function writes new hash fields
Old app cannot parse them
Rollback app breaks
```

---

## 17. Versioning Patterns

### 17.1 Function Name Versioning

```text
idempotency_start_v1
idempotency_start_v2
```

Best for:

- public function contract changes,
- return shape changes,
- argument semantics changes,
- stored data format changes.

### 17.2 Internal Version Field

Function writes:

```text
schemaVersion=2
```

Best for:

- stored state evolution,
- mixed-read support,
- migration visibility.

### 17.3 Library Comment Metadata

At top of file:

```lua
#!lua name=idempotency_lib
-- version: 2026-06-20.1
-- owner: enforcement-platform
-- contract: docs/redis-functions/idempotency.md
```

This helps human operators.

### 17.4 Git SHA in Deployment Metadata

Maintain external registry:

```text
function library: idempotency_lib
loaded version: git sha abc123
loaded at: 2026-06-20T10:20:00Z
loaded by: release pipeline
environment: prod
```

Redis itself should not be your only release registry.

---

## 18. Java Integration: Lettuce Example

Lettuce supports Redis commands including function invocation via command interfaces depending on version. The exact API can vary, so always align with your Lettuce version.

Conceptual usage:

```java
public record QuotaConsumeResult(
    boolean allowed,
    String code,
    long remaining
) {}
```

Example adapter shape:

```java
public final class RedisQuotaGateway {

    private final StatefulRedisConnection<String, String> connection;

    public RedisQuotaGateway(StatefulRedisConnection<String, String> connection) {
        this.connection = connection;
    }

    public QuotaConsumeResult consume(String tenantId, long requested) {
        String key = "quota:{" + tenantId + "}:daily";

        // Pseudocode: actual Lettuce FCALL API depends on client version.
        // Some teams use dispatch/custom command wrappers if high-level API is unavailable.
        List<Object> reply = fcall(
            "quota_consume_v2",
            List.of(key),
            List.of(Long.toString(requested))
        );

        long successFlag = asLong(reply.get(0));
        String code = asString(reply.get(1));
        long remaining = asLong(reply.get(2));

        return new QuotaConsumeResult(successFlag == 1L, code, remaining);
    }

    private List<Object> fcall(String functionName, List<String> keys, List<String> args) {
        throw new UnsupportedOperationException("Implement using your Lettuce version's command API");
    }

    private static long asLong(Object value) {
        if (value instanceof Number n) return n.longValue();
        return Long.parseLong(value.toString());
    }

    private static String asString(Object value) {
        return value == null ? null : value.toString();
    }
}
```

Important design choice:

```text
Do not let application code scatter FCALL calls everywhere.
Wrap Redis Function invocation behind a typed gateway.
```

Bad:

```java
redis.fcall("quota_consume_v2", ...); // everywhere
```

Good:

```java
quotaGateway.consume(tenantId, requestedUnits);
```

Why?

- centralizes key naming,
- centralizes return parsing,
- centralizes metrics,
- centralizes timeout/retry policy,
- centralizes version selection,
- easier testing.

---

## 19. Java Integration: Spring Data Redis Considerations

Spring Data Redis has mature support for Lua scripting via `RedisScript` and `RedisTemplate`. Its scripting documentation explains that it uses Redis script support through `eval`/`evalsha` and provides a high-level abstraction for running Lua scripts. [Spring Data Redis scripting documentation](https://docs.spring.io/spring-data/redis/reference/redis/scripting.html)

For Redis Functions, support level depends on the Spring Data Redis and driver version you use. If high-level function commands are not exposed in your abstraction, options include:

1. Use lower-level connection APIs.
2. Use Lettuce directly for function calls.
3. Use `execute` callback with raw command support.
4. Keep critical programmability as Lua `RedisScript` if Redis Functions integration is not mature enough in your stack.

Do not choose Redis Functions only because it is newer.

Choose based on:

```text
Can my Java client call it cleanly?
Can my ops team deploy it safely?
Can my test suite validate it?
Can my observability identify it?
Can rollback be done safely?
```

For Spring-heavy systems, a pragmatic approach is:

```text
Spring Cache / RedisTemplate for normal operations
Lettuce or low-level connection for FCALL gateway
Dedicated function deployment step in CI/CD
```

---

## 20. Error Handling Contract

Redis Function can fail in several ways:

1. Function does not exist.
2. Wrong number of keys.
3. Wrong argument type.
4. Script runtime error.
5. Redis timeout from client perspective.
6. Redis connection failure.
7. Cluster redirection issue.
8. Function returns application-level deny/error code.

Separate these categories.

### 20.1 Infrastructure Error

Example:

```text
ERR Function not found
connection timeout
MOVED redirection not handled
```

Java handling:

```text
This is not quota denied.
This is infrastructure failure.
Use fail-open/fail-closed policy based on domain risk.
```

### 20.2 Business/Policy Denial

Example return:

```text
[0, "INSUFFICIENT_QUOTA", 3]
```

Java handling:

```text
This is expected domain result.
Return HTTP 429 / policy response / enforcement denial.
```

### 20.3 Contract Error

Example:

```text
[0, "INVALID_ARGUMENT", 0]
```

Java handling:

```text
Bug in caller or validation gap.
Emit metric and log structured context.
```

Avoid using Redis runtime errors for expected domain outcomes.

Prefer explicit return codes.

---

## 21. Retry Policy

Functions are often mutating.

Retry can duplicate mutation if the client times out after Redis completed the function.

Scenario:

```text
Client calls consume_quota
Redis decrements quota
Network stalls before response
Client times out
Client retries
Redis decrements quota again
```

This is not hypothetical. This is a common distributed systems failure.

Design options:

### 21.1 Make Function Idempotent

Include request ID:

```text
FCALL quota_consume_idempotent_v1 2 quota:{tenant}:daily quota:{tenant}:request:{requestId} 5 requestId
```

Function:

```text
if requestId already processed:
  return previous result
else:
  consume quota
  store result under requestId with TTL
```

### 21.2 Do Not Retry Mutating Function Automatically

For non-idempotent mutations:

```text
Retry only if connection failed before write is known impossible.
Usually hard to know.
```

Practical rule:

```text
Client-level automatic retries for mutating Redis Functions should be disabled or tightly controlled.
```

### 21.3 Retry Read-Only Functions More Freely

Read-only inspect function is safer to retry.

But still be careful about load amplification.

---

## 22. Observability

At minimum, observe per function:

```text
function name
function version
success/error result code
Redis command latency
client-side total latency
timeout count
Redis error count
connection pool wait
cluster redirect count
result distribution
```

Example metric names:

```text
redis_function_calls_total{function="quota_consume_v2", result="CONSUMED"}
redis_function_calls_total{function="quota_consume_v2", result="INSUFFICIENT_QUOTA"}
redis_function_latency_seconds{function="quota_consume_v2"}
redis_function_errors_total{function="quota_consume_v2", error="timeout"}
```

Structured log example:

```json
{
  "event": "redis_function_call_failed",
  "function": "quota_consume_v2",
  "tenantHash": "t_93af",
  "requestedUnits": 5,
  "errorType": "timeout",
  "failPolicy": "fail_closed",
  "durationMs": 42
}
```

Do not log raw tenant ID or sensitive keys if your regulatory/security context forbids it.

---

## 23. Security and ACL Considerations

Redis Functions extend what clients can trigger on Redis.

Security questions:

1. Who can load functions?
2. Who can replace functions?
3. Who can flush functions?
4. Who can call functions?
5. Which functions can write?
6. Are function source files reviewed?
7. Are function deployments audited?
8. Are dangerous commands used inside functions?

Do not let normal application runtime user load or replace functions.

Recommended separation:

```text
Deployment identity:
  allowed to FUNCTION LOAD / DELETE / LIST as needed

Application identity:
  allowed to FCALL specific operational functions
  not allowed to FUNCTION LOAD REPLACE
```

In regulated systems, function deployment is a change-control event.

Treat it like database migration or stored procedure deployment.

---

## 24. Redis Functions Are Similar to Stored Procedures — But Not Identical

A useful analogy:

```text
Redis Function ≈ stored procedure for Redis data structures
```

But there are differences:

| Aspect | SQL Stored Procedure | Redis Function |
|---|---:|---:|
| Data model | relational | key-value/data structures |
| Transaction model | DB transaction semantics | Redis command/function atomicity |
| Query ability | rich query optimizer | command-based data access |
| Runtime | database engine | Redis embedded Lua engine |
| Best use | set-based DB-local logic | small key-local atomic primitive |
| Risk | hidden business logic | hidden latency-critical logic |

The stored procedure analogy is useful only as warning:

> Server-side logic can centralize invariants, but it can also hide complexity.

---

## 25. Testing Redis Functions

Testing Redis Functions needs more than Java unit tests.

### 25.1 Static Checks

Basic checks:

```text
Lua syntax check
function file naming convention
metadata present
forbidden command scan
unbounded loop review
return contract documented
```

### 25.2 Integration Test with Real Redis

Use Testcontainers Redis where possible.

Test flow:

```text
Start Redis container
Load function library
Seed keys
Call function
Assert return
Assert Redis state
Assert TTL behavior
Assert failure behavior
```

Example test cases for `quota_consume_v2`:

```text
consume below available quota -> allowed, remaining reduced
consume exactly available quota -> allowed, remaining zero
consume above available quota -> denied, remaining unchanged
negative requested amount -> error
missing quota key -> denied or explicit missing behavior
TTL is preserved after consume
concurrent consume does not go below zero
```

### 25.3 Concurrency Test

Pseudo-test:

```java
int workers = 50;
long initialQuota = 100;
long request = 3;

// Run 50 concurrent consume attempts.
// Assert total consumed <= 100.
// Assert Redis quota never negative.
```

The key assertion:

```text
The invariant holds under concurrent clients.
```

### 25.4 Contract Test Between Java Parser and Function Reply

If function returns:

```text
[1, "CONSUMED", 42]
```

Java parser must be tested against exactly that shape.

Add tests for:

```text
wrong type
missing field
unknown result code
new result code
```

---

## 26. Function Design Checklist

Before writing a Redis Function, answer:

```text
1. What invariant does this protect?
2. Why cannot a single Redis command solve it?
3. Why is Lua/Function better than WATCH/MULTI?
4. Are all keys in the same cluster slot?
5. Is every loop bounded?
6. What is the maximum expected runtime?
7. What is the return contract?
8. Is the function idempotent?
9. What happens on client timeout?
10. What is the rollback plan?
11. Who owns the function?
12. How is it tested?
13. How is it deployed?
14. How is it monitored?
15. Can old and new versions coexist?
```

If these cannot be answered, do not deploy the function.

---

## 27. Case Study: Idempotency Function Library

Let's design a more complete Redis Function library for idempotency.

### 27.1 Desired State Machine

```text
ABSENT
  -> STARTED
STARTED
  -> COMPLETED
STARTED
  -> FAILED
COMPLETED
  -> replay response
FAILED
  -> maybe retry allowed, depending policy
EXPIRED
  -> treated as ABSENT or conflict depending domain
```

Redis keys:

```text
idem:{tenant}:{idempotencyKey}
```

Hash fields:

```text
state
fingerprint
responseCode
responseBodyRef
createdAtMs
updatedAtMs
```

### 27.2 `idempotency_start_v1`

Semantics:

```text
If key absent:
  create STARTED with fingerprint and TTL
  return [1, STARTED]

If key exists with same fingerprint and COMPLETED:
  return [0, REPLAY]

If key exists with same fingerprint and STARTED:
  return [0, IN_PROGRESS]

If key exists with different fingerprint:
  return [0, FINGERPRINT_MISMATCH]
```

Function sketch:

```lua
#!lua name=idempotency_lib

redis.register_function('idempotency_start_v1', function(keys, args)
  local key = keys[1]
  local fingerprint = args[1]
  local now = args[2]
  local ttlSeconds = tonumber(args[3])

  if fingerprint == nil or fingerprint == '' then
    return {0, 'INVALID_FINGERPRINT'}
  end

  if ttlSeconds == nil or ttlSeconds <= 0 then
    return {0, 'INVALID_TTL'}
  end

  local existingState = redis.call('HGET', key, 'state')

  if not existingState then
    redis.call('HSET', key,
      'state', 'STARTED',
      'fingerprint', fingerprint,
      'createdAtMs', now,
      'updatedAtMs', now
    )
    redis.call('EXPIRE', key, ttlSeconds)
    return {1, 'STARTED'}
  end

  local existingFingerprint = redis.call('HGET', key, 'fingerprint')

  if existingFingerprint ~= fingerprint then
    return {0, 'FINGERPRINT_MISMATCH'}
  end

  if existingState == 'COMPLETED' then
    return {0, 'REPLAY'}
  end

  if existingState == 'STARTED' then
    return {0, 'IN_PROGRESS'}
  end

  return {0, existingState}
end)
```

### 27.3 Why This Belongs in Redis

Because the invariant is local:

```text
one idempotency key
one state machine
atomic transition
short logic
bounded fields
no external dependency
```

### 27.4 What Should Not Be in This Function

Do not put:

- HTTP response generation,
- business validation,
- user permission logic,
- database updates,
- event publishing,
- audit record finalization.

Redis stores transient idempotency state. The domain service owns the business transaction.

---

## 28. Case Study: Why `FUNCTION LOAD REPLACE` Can Be Dangerous

Suppose `idempotency_start_v1` originally returns:

```text
[1, "STARTED"]
[0, "REPLAY"]
```

Java parser:

```java
boolean allowed = ((Long) reply.get(0)) == 1;
String code = reply.get(1).toString();
```

A developer changes function to return:

```text
["STARTED", 1]
```

Then deploys:

```bash
FUNCTION LOAD REPLACE "$(cat idempotency_lib.lua)"
```

Old Java pods still running.

Result:

```text
ClassCastException
failed requests
retry storm
idempotency broken
```

Lesson:

> Never replace a function contract in-place while old callers may exist.

Use `idempotency_start_v2`.

---

## 29. Redis Functions and Data Ownership

Redis Functions should have explicit ownership.

Example ownership record:

```yaml
redis_function_library: idempotency_lib
owner_team: enforcement-platform
runtime: Redis 8.x
repository: platform-redis-functions
functions:
  - idempotency_start_v1
  - idempotency_complete_v1
  - idempotency_fail_v1
keys:
  - idem:{tenant}:{idempotencyKey}
slo:
  p99_latency_ms: 2
rollback:
  keep previous function version for 14 days
change_control:
  requires architecture review for return contract change
```

Why this matters:

- Redis is often shared infrastructure.
- Functions can affect unrelated workloads via latency.
- Nobody should wonder who owns a function during incident response.

---

## 30. Redis Functions in a Java CI/CD Pipeline

Recommended pipeline:

```text
repo/
  redis-functions/
    quota_lib.lua
    idempotency_lib.lua
  src/main/java/
    ...
  src/test/java/
    ...
```

Pipeline stages:

```text
1. Lint/check function files
2. Start Redis test container
3. FUNCTION LOAD libraries
4. Run function integration tests
5. Run Java gateway tests
6. Build app
7. Deploy functions to target environment using deployment identity
8. Verify FUNCTION LIST
9. Deploy Java app
10. Monitor function metrics
```

Do not let function deployment be a manual copy-paste from a wiki.

---

## 31. Production Runbook for Function Incident

If Redis latency spikes and function is suspected:

### 31.1 Identify

Check:

```text
Redis latency metrics
SLOWLOG
commandstats
client-side metrics by function
recent deployment history
FUNCTION LIST
```

Redis command `FUNCTION LIST` returns information about loaded functions and libraries. [Redis FUNCTION LIST documentation](https://redis.io/docs/latest/commands/function-list/)

### 31.2 Contain

Options:

```text
reduce caller traffic
disable feature flag using function
route to fallback path
rollback app to previous function caller
load previous function version if safe
```

### 31.3 Avoid

Do not immediately run destructive commands like:

```text
FUNCTION FLUSH
FLUSHALL
SCRIPT FLUSH
```

unless incident command explicitly approves and blast radius is understood.

### 31.4 Recover

After containment:

```text
capture function version
capture representative keys
reproduce in staging
add regression test
update deployment checklist
```

---

## 32. Practical Decision Matrix

| Need | Recommended Tool |
|---|---|
| Single atomic Redis command exists | Use native command |
| Multi-command atomic operation, app-specific, simple | Lua script or Function |
| Shared primitive across services | Redis Function |
| Optimistic concurrency with small conflict window | `WATCH`/`MULTI` or Function |
| High-frequency rate limiter | Function/Lua with bounded logic |
| Long business workflow | Java service / workflow engine |
| Cross-system transaction | Do not use Redis Function as coordinator |
| Large data migration | External batch job |
| Debug/admin read-only computed view | Read-only Function if bounded |
| Complex search/query | Redis Query Engine or another specialized system |

---

## 33. Common Anti-Patterns

### 33.1 Function Without Owner

```text
Nobody knows who wrote it.
Nobody knows if it can be removed.
Nobody knows what keys it touches.
```

This is operational debt.

### 33.2 Function Without Version

```text
quota_consume
```

Six months later, nobody knows which callers expect which return format.

### 33.3 Function With Hidden Schema Migration

```lua
if old field exists then migrate hash to new format
```

This can be okay only if bounded and deliberate. Usually it creates hot-path unpredictability.

### 33.4 Function That Scans Keyspace

Do not use functions for global keyspace scans.

### 33.5 Function That Encodes Domain Policy

```lua
if customerType == 'GOLD' and region == 'EU' and product == 'X' then ...
```

This belongs in Java domain logic unless it is purely Redis-local enforcement metadata and very stable.

### 33.6 Function Called Without Metrics

If it is important enough to be server-side, it is important enough to measure.

---

## 34. Mini Lab

### 34.1 Start Redis

```bash
docker run --rm --name redis-functions-lab -p 6379:6379 redis:8
```

If using another Redis version, ensure it supports Redis Functions. Redis Functions require Redis 7.0 or later according to Redis tutorial material. [Redis Functions tutorial](https://redis.io/tutorials/create/redis-functions/)

### 34.2 Create `quota_lib.lua`

```lua
#!lua name=quota_lib

redis.register_function('quota_seed_v1', function(keys, args)
  local key = keys[1]
  local amount = tonumber(args[1])
  local ttl = tonumber(args[2])

  if amount == nil or amount < 0 then
    return {0, 'INVALID_AMOUNT'}
  end

  if ttl == nil or ttl <= 0 then
    return {0, 'INVALID_TTL'}
  end

  redis.call('SET', key, amount, 'EX', ttl)
  return {1, 'SEEDED', amount}
end)

redis.register_function('quota_consume_v1', function(keys, args)
  local key = keys[1]
  local requested = tonumber(args[1])

  if requested == nil or requested <= 0 then
    return {0, 'INVALID_REQUEST', 0}
  end

  local current = tonumber(redis.call('GET', key) or '0')

  if current < requested then
    return {0, 'INSUFFICIENT_QUOTA', current}
  end

  local remaining = current - requested
  redis.call('SET', key, remaining, 'KEEPTTL')

  return {1, 'CONSUMED', remaining}
end)

redis.register_function{
  function_name = 'quota_inspect_v1',
  callback = function(keys, args)
    local key = keys[1]
    local current = redis.call('GET', key)
    local ttl = redis.call('TTL', key)
    return {current or false, ttl}
  end,
  flags = { 'no-writes' }
}
```

### 34.3 Load Library

```bash
redis-cli FUNCTION LOAD "$(cat quota_lib.lua)"
```

If already loaded during repeated lab:

```bash
redis-cli FUNCTION LOAD REPLACE "$(cat quota_lib.lua)"
```

In production, do not casually use `REPLACE` without versioning discipline.

### 34.4 Seed Quota

```bash
redis-cli FCALL quota_seed_v1 1 quota:{tenant-123}:daily 10 3600
```

Expected:

```text
1) (integer) 1
2) "SEEDED"
3) (integer) 10
```

### 34.5 Consume

```bash
redis-cli FCALL quota_consume_v1 1 quota:{tenant-123}:daily 3
```

Expected:

```text
1) (integer) 1
2) "CONSUMED"
3) (integer) 7
```

### 34.6 Inspect

```bash
redis-cli FCALL_RO quota_inspect_v1 1 quota:{tenant-123}:daily
```

Expected shape:

```text
1) "7"
2) (integer) <ttl>
```

### 34.7 Try Over-Consume

```bash
redis-cli FCALL quota_consume_v1 1 quota:{tenant-123}:daily 100
```

Expected:

```text
1) (integer) 0
2) "INSUFFICIENT_QUOTA"
3) (integer) 7
```

### 34.8 Verify TTL Preservation

```bash
redis-cli TTL quota:{tenant-123}:daily
redis-cli FCALL quota_consume_v1 1 quota:{tenant-123}:daily 1
redis-cli TTL quota:{tenant-123}:daily
```

Expected:

```text
TTL remains positive and does not become -1.
```

If TTL becomes `-1`, your function destroyed lifecycle contract.

---

## 35. Architecture Review Example

Suppose a team proposes this:

```text
We will implement tenant enforcement in Redis Function.
It will check tenant status, feature entitlements, daily quota, user role, region policy, and case status.
```

Review response:

```text
Quota consume belongs in Redis Function.
Full enforcement decision does not.
```

Better split:

```text
Java enforcement service:
  loads tenant policy from source of truth / cache
  evaluates domain eligibility
  calls Redis function only to atomically consume quota
  writes audit record to durable store
  returns decision

Redis function:
  atomically consume quota if available
  preserve TTL
  return result code and remaining quota
```

This preserves boundaries:

```text
Domain policy: Java/service layer
Transient atomic counter invariant: Redis Function
Audit record: durable database/event log
```

---

## 36. Mental Model Summary

Redis Functions are best understood as:

```text
named, deployable, server-side Redis primitives
```

They are not:

```text
microservices
workflow engines
business rule engines
batch processors
transaction coordinators
```

Use Redis Functions when you need:

- atomic multi-command Redis-local operation,
- reusable primitive across callers,
- named server-side contract,
- reduced race condition,
- reduced round trip,
- centralized Redis invariant.

Avoid them when you are tempted to move domain complexity into Redis.

The best Redis Functions are boring:

```text
small
bounded
deterministic
versioned
tested
observable
owned
rollbackable
```

---

## 37. What a Top 1% Engineer Should Internalize

A weaker engineer asks:

```text
Can I put this logic in Redis?
```

A stronger engineer asks:

```text
Which invariant belongs inside Redis, and which logic must remain outside?
```

A weaker engineer sees Redis Functions as a performance trick.

A stronger engineer sees Redis Functions as a **consistency boundary with operational blast radius**.

A weaker engineer deploys with:

```text
FUNCTION LOAD REPLACE
```

A stronger engineer deploys with:

```text
versioned functions
integration tests
metrics
rollback plan
caller compatibility
cluster slot design
```

A weaker engineer writes:

```lua
for all members in huge set do ...
```

A stronger engineer asks:

```text
What is the maximum runtime of this function at p99 data size?
```

That difference is what separates useful Redis programmability from production risk.

---

## 38. Checklist Sebelum Production

```text
[ ] Function has owner team.
[ ] Function has versioned name.
[ ] Return contract is documented.
[ ] Java gateway parses return contract centrally.
[ ] All keys are passed via KEYS, not constructed hidden inside function unless safe.
[ ] Cluster hash tags are designed.
[ ] Every loop is bounded.
[ ] TTL behavior is tested.
[ ] Function is integration-tested with real Redis.
[ ] Concurrent correctness is tested.
[ ] Mutating function retry policy is explicit.
[ ] Metrics include function name/version/result code.
[ ] Deployment does not rely on random app startup race.
[ ] Rollback is documented.
[ ] ACL separates loader identity from application identity.
[ ] No hidden domain workflow is implemented in Redis.
```

---

## 39. Referensi

- Redis documentation — Redis Functions: `https://redis.io/docs/latest/develop/programmability/functions-intro/`
- Redis documentation — Redis programmability: `https://redis.io/docs/latest/develop/programmability/`
- Redis documentation — Lua scripting: `https://redis.io/docs/latest/develop/programmability/eval-intro/`
- Redis command documentation — `FUNCTION LOAD`: `https://redis.io/docs/latest/commands/function-load/`
- Redis command documentation — `FUNCTION LIST`: `https://redis.io/docs/latest/commands/function-list/`
- Redis tutorial — Redis Functions: `https://redis.io/tutorials/create/redis-functions/`
- Spring Data Redis documentation — Scripting: `https://docs.spring.io/spring-data/redis/reference/redis/scripting.html`

---

## 40. Penutup Part 015

Di bagian ini kita membahas Redis Functions sebagai evolusi dari Lua scripting:

- Functions membuat server-side Redis logic lebih named, reusable, dan deployable.
- Functions cocok untuk invariant kecil yang Redis-local dan harus atomik.
- Functions berbahaya jika dipakai untuk workflow atau domain policy kompleks.
- Java service sebaiknya memanggil Functions lewat typed gateway, bukan raw call tersebar.
- Deployment, versioning, rollback, ACL, dan observability adalah bagian dari desain, bukan tambahan opsional.

Part berikutnya akan membahas:

```text
Part 016 — Pub/Sub: Real-Time Fanout Tanpa Durability
```

Kita akan membedakan Redis Pub/Sub sebagai sinyal real-time ringan dari queue/event log durable, serta kapan Pub/Sub cocok untuk cache invalidation, local coordination, dan notification fanout.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Lua Scripting: Atomic Multi-Step Logic di Redis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-016.md">Part 016 — Redis Pub/Sub: Real-Time Fanout Tanpa Durability ➡️</a>
</div>
