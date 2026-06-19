# learn-redis-mastery-for-java-engineers-part-026.md

# Part 026 — Transactions, WATCH, MULTI/EXEC, dan Optimistic Concurrency

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara benar dalam sistem produksi  
> Fokus bagian ini: memahami transaction model Redis, batasnya, kapan memakai `MULTI/EXEC`, kapan memakai `WATCH`, kapan lebih baik memakai Lua/Redis Functions, dan bagaimana mengimplementasikannya secara aman dari Java.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membahas:

- Redis command execution model.
- Data structures.
- TTL dan eviction.
- Cache architecture.
- Rate limiting.
- Idempotency.
- Distributed locks.
- Lua scripting.
- Redis Functions.
- Pub/Sub dan Streams.
- Persistence, replication, cluster.
- Memory dan latency engineering.
- Java client mastery.

Sekarang kita masuk ke salah satu area yang sering disalahpahami: **Redis transaction**.

Banyak engineer yang melihat kata “transaction” lalu secara otomatis membayangkan:

- ACID transaction seperti PostgreSQL/MySQL.
- rollback otomatis jika salah satu command gagal.
- isolation level.
- row lock.
- deadlock detection.
- long-running business transaction.
- read-your-own-write di dalam transaction seperti SQL.

Di Redis, hampir semua asumsi itu perlu dibongkar.

Redis transaction adalah mekanisme untuk:

1. mengantre beberapa command,
2. mengeksekusinya secara berurutan,
3. tanpa interleaving command dari client lain di tengah batch tersebut,
4. opsional dengan optimistic check menggunakan `WATCH`.

Itu kuat, tetapi berbeda dari transaction database relasional.

---

## 1. Core Mental Model

### 1.1 Redis transaction bukan mini SQL transaction

Di SQL, transaction biasanya berarti:

```sql
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 1;
UPDATE account SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

Jika ada error tertentu, sistem bisa rollback perubahan sebelum commit.

Di Redis, transaction lebih mirip:

```text
MULTI
INCR counter:a
INCR counter:b
EXEC
```

Command setelah `MULTI` tidak langsung dijalankan. Command tersebut masuk queue. Saat `EXEC`, Redis menjalankan semua queued commands secara berurutan.

Mental model yang lebih tepat:

```text
MULTI/EXEC = atomic command batch
WATCH      = optimistic compare-and-set guard
DISCARD    = buang queued batch sebelum dieksekusi
```

Bukan:

```text
MULTI/EXEC = SQL transaction dengan rollback dan isolation level
```

---

## 2. Kenapa Redis Membutuhkan Transaction Kalau Command Sudah Atomic?

Setiap single Redis command bersifat atomic terhadap command lain karena command dieksekusi secara sekuensial oleh Redis.

Contoh:

```text
INCR user:42:login-count
```

Aman dari race condition antar client untuk increment counter yang sama.

Masalah muncul ketika logic aplikasi membutuhkan beberapa command sebagai satu unit.

Contoh:

```text
DECR stock:item:1001
LPUSH order:item:1001 order-789
```

Jika dua command itu dikirim terpisah:

1. client A menjalankan `DECR`,
2. network error sebelum `LPUSH`,
3. stock sudah berkurang,
4. order tidak tercatat di Redis list.

Redis transaction bisa membantu memastikan batch command dikirim dan dieksekusi sebagai satu unit pada Redis.

Tapi hati-hati: transaction tidak selalu menyelesaikan seluruh failure mode application-level.

---

## 3. Command Dasar: MULTI, EXEC, DISCARD, WATCH, UNWATCH

### 3.1 `MULTI`

`MULTI` menandai awal transaction block.

Setelah `MULTI`, command berikutnya tidak langsung dieksekusi. Redis biasanya mengembalikan `QUEUED` untuk command yang masuk antrian.

Contoh:

```redis
MULTI
SET user:42:name "Alya"
INCR metrics:user-update-count
EXEC
```

Flow:

```text
client -> MULTI
redis  -> OK

client -> SET user:42:name Alya
redis  -> QUEUED

client -> INCR metrics:user-update-count
redis  -> QUEUED

client -> EXEC
redis  -> [OK, 1]
```

### 3.2 `EXEC`

`EXEC` menjalankan semua command yang sudah di-queue.

Sifat penting:

- command dieksekusi berurutan,
- tidak ada command dari client lain yang masuk di tengah execution batch,
- result dikembalikan sebagai array,
- jika `WATCH` aktif dan watched key berubah, `EXEC` gagal dengan null/nil response.

### 3.3 `DISCARD`

`DISCARD` membuang semua command yang sudah di-queue dan mengembalikan connection ke state normal.

Penting: `DISCARD` hanya bekerja sebelum `EXEC`.

Jika command sudah dieksekusi oleh `EXEC`, tidak ada rollback otomatis.

### 3.4 `WATCH`

`WATCH` membuat Redis memonitor satu atau lebih key untuk optimistic concurrency.

Contoh:

```redis
WATCH account:1
GET account:1
MULTI
SET account:1 900
EXEC
```

Jika `account:1` berubah setelah `WATCH` dan sebelum `EXEC`, maka `EXEC` tidak menjalankan transaction.

Ini mirip compare-and-set:

```text
jalankan update hanya jika key belum berubah sejak saya baca
```

### 3.5 `UNWATCH`

`UNWATCH` membatalkan watch pada key yang sedang dimonitor oleh connection tersebut.

`EXEC` dan `DISCARD` juga akan membersihkan watched keys.

---

## 4. Transaction Execution Model

### 4.1 Timeline sederhana

Misal client A:

```redis
MULTI
SET a 1
SET b 2
EXEC
```

Client B mencoba:

```redis
GET a
```

Redis menjamin ketika `EXEC` mulai menjalankan queued commands, command dari client lain tidak diinterleaving di tengah batch.

Timeline:

```text
T1 client A: MULTI
T2 client A: SET a 1 -> QUEUED
T3 client A: SET b 2 -> QUEUED
T4 client B: GET a -> bisa dieksekusi sebelum A EXEC
T5 client A: EXEC -> SET a 1, SET b 2 dieksekusi sebagai batch tanpa interleaving
T6 client B: GET b -> setelah batch selesai
```

Yang atomic adalah execution batch di saat `EXEC`, bukan periode antara `MULTI` dan `EXEC`.

Ini penting.

Antara `MULTI` dan `EXEC`, client lain masih bisa menjalankan command. Command client A hanya sedang dikumpulkan di queue connection client A.

---

## 5. Redis Transaction dan Error Handling

Ini bagian yang sering menipu.

Ada dua jenis error:

1. error saat command di-queue,
2. error saat command dieksekusi di `EXEC`.

### 5.1 Error saat queueing

Contoh command invalid:

```redis
MULTI
SET a
EXEC
```

`SET a` salah karena kurang argument. Redis bisa menandai transaction sebagai invalid. `EXEC` akan gagal menjalankan transaction.

### 5.2 Error saat execution

Contoh:

```redis
SET mykey "hello"
MULTI
INCR mykey
SET otherkey "ok"
EXEC
```

`INCR mykey` gagal karena value bukan integer.

Tapi `SET otherkey "ok"` tetap bisa dieksekusi.

Inilah bedanya dengan SQL transaction rollback.

Redis transaction tidak otomatis rollback command yang sudah berhasil dalam `EXEC` hanya karena command lain error saat execution.

Mental model:

```text
Redis transaction guarantees grouped sequential execution, not semantic all-or-nothing rollback for runtime command errors.
```

Konsekuensi desain:

- validasi tipe data sebelum masuk transaction,
- jangan mencampur command yang bisa gagal karena tipe/value tidak diketahui,
- gunakan Lua jika butuh conditional logic lebih defensif,
- desain operation agar idempotent atau recoverable.

---

## 6. Transaction Tidak Memberi Read di Tengah Batch

Misal:

```redis
MULTI
GET balance:user:1
SET balance:user:1 100
EXEC
```

`GET` tidak dieksekusi langsung. Ia di-queue.

Aplikasi tidak bisa membaca hasil `GET` lalu memutuskan command berikutnya di dalam transaction yang sama dari sisi client.

Ini berbeda dengan SQL:

```sql
BEGIN;
SELECT balance FROM account WHERE id = 1;
-- application decides next statement
UPDATE account SET balance = ...;
COMMIT;
```

Dalam Redis, jika butuh:

```text
read value -> compute -> conditionally write
```

opsinya:

1. `WATCH` + read outside transaction + `MULTI/EXEC`, atau
2. Lua/Redis Function agar read-compute-write terjadi server-side atomic.

---

## 7. WATCH sebagai Optimistic Concurrency

### 7.1 Problem: lost update

Misal ada counter balance manual:

```text
balance:user:1 = 100
```

Dua client ingin menambahkan 10.

Tanpa atomic command:

```text
Client A GET balance -> 100
Client B GET balance -> 100
Client A SET balance -> 110
Client B SET balance -> 110
```

Hasil akhir 110, padahal seharusnya 120.

Untuk increment sederhana, gunakan `INCRBY`. Tidak perlu transaction.

Tetapi jika update membutuhkan business computation:

```text
newBalance = oldBalance + dynamicFee - penalty + cap
```

kita mungkin perlu optimistic concurrency.

### 7.2 WATCH flow

```text
WATCH key
read key
compute new value
MULTI
write key
EXEC
```

Jika key berubah sebelum `EXEC`, Redis membatalkan transaction.

Pseudo-flow:

```text
attempt 1:
  WATCH account:1
  old = GET account:1
  new = compute(old)
  MULTI
  SET account:1 new
  EXEC

  if EXEC returns null:
      retry with backoff
```

### 7.3 WATCH bersifat connection-scoped

`WATCH` melekat pada connection.

Ini sangat penting untuk Java client dan connection pooling.

Jika command `WATCH`, `GET`, `MULTI`, `EXEC` tidak dijalankan pada connection yang sama, transaction bisa salah atau gagal.

Karena itu di Spring Data Redis, gunakan `SessionCallback` untuk memastikan operasi transaction berjalan pada session/connection yang sama.

---

## 8. WATCH vs Lua

### 8.1 WATCH cocok ketika

Gunakan `WATCH` jika:

- logic computation lebih nyaman di aplikasi,
- conflict rate rendah,
- retry acceptable,
- data yang dibaca tidak besar,
- command yang ditulis sederhana,
- tidak ingin deploy Lua/Function.

Contoh:

```text
update JSON blob kecil dengan version check
```

### 8.2 Lua cocok ketika

Gunakan Lua/Redis Function jika:

- butuh read-compute-write atomic tanpa round trip race,
- conflict rate tinggi,
- retry dari client mahal,
- logic relatif kecil dan deterministik,
- semua keys berada di slot yang sama pada cluster,
- butuh invariant kuat di Redis layer.

Contoh:

```text
rate limiter token bucket
safe lock release
idempotency state transition
stock reserve dengan guard
```

### 8.3 Trade-off

| Aspek | WATCH + MULTI/EXEC | Lua / Function |
|---|---:|---:|
| Logic berada di | aplikasi | Redis server |
| Round trip | lebih banyak | lebih sedikit |
| Conflict handling | retry client | atomic server-side |
| Debugging | relatif mudah | lebih sulit |
| Deployment | app only | script/function lifecycle |
| Risiko blocking Redis | lebih kecil jika command sederhana | lebih besar jika script berat |
| Cocok untuk high contention | kurang | lebih cocok |

---

## 9. MULTI/EXEC vs Pipeline

Pipeline dan transaction sering terlihat mirip karena sama-sama mengirim banyak command.

Tetapi tujuannya berbeda.

### 9.1 Pipeline

Pipeline adalah optimasi network round trip.

```text
send command1, command2, command3 without waiting response each time
```

Tujuan:

```text
latency reduction / throughput improvement
```

Tidak otomatis memberikan atomic batch semantics.

### 9.2 Transaction

Transaction adalah atomic batch execution.

```text
queue commands, execute as one sequential block at EXEC
```

Tujuan:

```text
non-interleaved execution of multiple commands
```

### 9.3 Bisa digabung?

Bisa dalam beberapa client, tetapi harus hati-hati. Untuk kebanyakan aplikasi Java, jangan menggabungkan pipeline dan transaction kecuali benar-benar perlu dan sudah memahami response ordering.

Rule praktis:

- butuh performa banyak independent command: pipeline,
- butuh atomic multi-command batch: transaction,
- butuh conditional atomic logic: Lua/Function atau WATCH,
- butuh atomic single operation: gunakan command native Redis.

---

## 10. MULTI/EXEC Bukan Lock

Transaction tidak mencegah client lain menulis key sebelum `EXEC`.

Contoh:

```redis
MULTI
SET a 1
SET b 2
-- sebelum EXEC, client lain masih bisa SET a 9
EXEC
```

Command client lain bisa berjalan sebelum `EXEC`.

Jika perlu memastikan key tidak berubah sejak dibaca, pakai `WATCH`.

Jika perlu mutual exclusion lintas operasi external, itu masuk domain lock/lease/fencing token yang sudah dibahas di Part 013.

Jangan memakai `MULTI` sebagai lock.

---

## 11. Cluster Constraints

Di Redis Cluster, semua key dalam transaction yang berkaitan dengan multi-key operation harus berada pada hash slot yang sama.

Contoh buruk:

```redis
MULTI
SET user:1:balance 100
SET account:9:last-update 2026-06-20
EXEC
```

Jika dua key tersebut berada di slot berbeda, cluster akan bermasalah untuk transaction lintas slot.

Solusi:

gunakan hash tag:

```text
acct:{123}:balance
acct:{123}:last-update
acct:{123}:ledger-marker
```

Semua key dengan `{123}` dipetakan ke slot yang sama.

Tapi jangan berlebihan memakai hash tag yang terlalu umum seperti:

```text
{global}:user:1
{global}:user:2
{global}:user:3
```

Itu menciptakan hot slot dan merusak distribusi cluster.

Rule:

```text
Hash tag harus mewakili aggregate boundary, bukan seluruh aplikasi.
```

---

## 12. Pattern: Atomic Batch tanpa Conditional Logic

### 12.1 Use case

Saat user login, kita ingin:

1. update last login timestamp,
2. increment login count,
3. add user to recent login sorted set.

```redis
MULTI
SET user:42:last-login 2026-06-20T10:15:00Z
INCR user:42:login-count
ZADD users:recent-logins 1781940900 user:42
EXEC
```

Ini cocok untuk `MULTI/EXEC` jika:

- semua command relatif aman,
- tidak butuh read-compute-write client-side,
- tidak butuh rollback semantic,
- failure runtime command kecil karena tipe key dikelola dengan baik.

### 12.2 Java mental model

Di Java, hasil `EXEC` adalah list response.

Jangan abaikan response jika operation penting.

Misal:

```java
List<Object> results = redisTemplate.execute(new SessionCallback<List<Object>>() {
    @Override
    @SuppressWarnings("unchecked")
    public List<Object> execute(RedisOperations operations) {
        operations.multi();
        operations.opsForValue().set("user:42:last-login", "2026-06-20T10:15:00Z");
        operations.opsForValue().increment("user:42:login-count");
        operations.opsForZSet().add("users:recent-logins", "user:42", 1781940900);
        return operations.exec();
    }
});

if (results == null) {
    throw new IllegalStateException("Redis transaction aborted");
}
```

Catatan:

- `SessionCallback` membantu memastikan operasi memakai connection/session yang sama.
- Serializer harus konsisten.
- Response type perlu dipahami, terutama untuk binary serializer atau custom serializer.

---

## 13. Pattern: Optimistic Update dengan WATCH

### 13.1 Use case

Kita menyimpan profile snapshot kecil:

```text
profile:{userId}:snapshot
```

Value:

```json
{
  "version": 7,
  "displayName": "Alya",
  "riskLevel": "LOW"
}
```

Kita ingin update hanya jika tidak ada writer lain yang mengubah snapshot.

### 13.2 Pseudocode

```text
for attempt in 1..maxAttempts:
    WATCH key
    current = GET key
    next = compute(current)
    MULTI
    SET key next
    EXEC
    if success:
        return
    else:
        retry with jitter
throw conflict
```

### 13.3 Java sketch with Lettuce-style thinking

Pseudo Java:

```java
public boolean updateProfileSnapshot(String userId, Function<ProfileSnapshot, ProfileSnapshot> updater) {
    String key = "profile:{" + userId + "}:snapshot";

    for (int attempt = 1; attempt <= 5; attempt++) {
        redis.watch(key);

        String raw = redis.get(key);
        ProfileSnapshot current = decode(raw);
        ProfileSnapshot next = updater.apply(current);

        TransactionResult result = redis.multi()
            .set(key, encode(next))
            .exec();

        if (result.wasApplied()) {
            return true;
        }

        sleepWithJitter(attempt);
    }

    return false;
}
```

Di client nyata, API detail berbeda. Yang penting adalah invariant:

```text
WATCH, read, MULTI, write, EXEC harus berada pada connection yang sama.
```

### 13.4 Backoff penting

Tanpa backoff, high contention akan membuat banyak client terus retry dan memperburuk load.

Gunakan:

- max retry kecil,
- exponential backoff ringan,
- jitter,
- fallback conflict response,
- metric conflict rate.

Jika conflict rate tinggi, pertimbangkan Lua atau redesign ownership model.

---

## 14. Pattern: Compare-and-Set State Machine

Redis transaction sering dipakai untuk state transition kecil.

Contoh lifecycle:

```text
PENDING -> PROCESSING -> COMPLETED
PENDING -> CANCELLED
PROCESSING -> FAILED
```

Dengan WATCH:

```text
WATCH job:{id}:state
state = GET job:{id}:state
if state != PENDING:
    UNWATCH
    return false
MULTI
SET job:{id}:state PROCESSING
SET job:{id}:worker worker-17
EXPIRE job:{id}:worker 300
EXEC
```

Namun, untuk state machine seperti ini, Lua sering lebih baik karena check dan set bisa dilakukan dalam satu server-side script.

Lua version mental model:

```text
if GET state != expected:
    return 0
SET state next
SET metadata ...
return 1
```

Rule:

```text
WATCH cocok untuk low-contention application-side CAS.
Lua lebih cocok untuk compact high-contention Redis-side CAS.
```

---

## 15. Pattern: Inventory Reservation

### 15.1 Naive problem

```text
stock:item:100 = 5
```

Order ingin reserve quantity 2.

Naive:

```text
GET stock:item:100
if stock >= 2:
    DECRBY stock:item:100 2
```

Race condition.

Jika hanya decrement dan tidak boleh negative, kita butuh guard.

### 15.2 WATCH approach

```text
WATCH stock:{item100}
stock = GET stock:{item100}
if stock < requested:
    UNWATCH
    return insufficient
MULTI
DECRBY stock:{item100} requested
SADD reservation:{item100} orderId
EXEC
```

Jika conflict, retry.

### 15.3 Lua approach often better

Karena operasi ini high-contention untuk item populer, Lua lebih tepat:

```lua
local stockKey = KEYS[1]
local reservationKey = KEYS[2]
local orderId = ARGV[1]
local requested = tonumber(ARGV[2])

local stock = tonumber(redis.call('GET', stockKey) or '0')
if stock < requested then
  return {0, stock}
end

redis.call('DECRBY', stockKey, requested)
redis.call('SADD', reservationKey, orderId)
return {1, stock - requested}
```

Cluster note: `stockKey` dan `reservationKey` harus satu slot, misalnya:

```text
stock:{item100}
reservation:{item100}
```

---

## 16. Pattern: Financial/Regulatory Caution

Untuk domain yang butuh audit kuat, Redis transaction tidak boleh dipakai sebagai pengganti database transaction/ledger.

Misal:

- enforcement case status resmi,
- payment ledger,
- compliance decision record,
- legal evidence timeline,
- irreversible quota penalty,
- financial balance.

Redis boleh menjadi:

- cache decision snapshot,
- idempotency guard,
- transient state machine,
- lock/lease coordination,
- rate limit enforcement layer,
- fast read model,
- deduplication window.

Tapi source of truth audit harus biasanya berada di database/event log yang durable dan queryable.

Decision rule:

```text
Jika perubahan harus bisa dibuktikan secara hukum/audit setelah Redis crash, failover, eviction, atau restore, jangan jadikan Redis satu-satunya source of truth.
```

---

## 17. Common Misconceptions

### 17.1 “Redis transaction bisa rollback”

Tidak seperti SQL rollback.

Jika command runtime error saat `EXEC`, command lain bisa tetap dieksekusi.

### 17.2 “MULTI mengunci key”

Tidak.

`MULTI` hanya mengubah connection menjadi queueing mode.

### 17.3 “WATCH membuat lock”

Tidak.

`WATCH` hanya membuat `EXEC` conditional terhadap perubahan key.

### 17.4 “Pipeline sama dengan transaction”

Tidak.

Pipeline mengurangi round trip. Transaction memberi non-interleaved batch execution.

### 17.5 “Redis transaction cocok untuk business workflow panjang”

Tidak.

Redis transaction harus pendek, cepat, dan command-level.

Business workflow panjang harus dimodelkan dengan state machine, durable store, event processing, atau orchestration.

### 17.6 “Spring @Transactional otomatis membuat Redis transaction benar”

Tidak selalu.

Spring Data Redis punya transaction support, tetapi perlu memahami connection binding, `SessionCallback`, serializer, dan batas Redis transaction sendiri.

Jangan mengasumsikan `@Transactional` relational database semantics berlaku ke Redis dengan cara yang sama.

---

## 18. Java/Spring Data Redis Transaction Details

### 18.1 Gunakan SessionCallback untuk transaction manual

Contoh:

```java
List<Object> results = redisTemplate.execute(new SessionCallback<List<Object>>() {
    @Override
    @SuppressWarnings({ "unchecked", "rawtypes" })
    public List<Object> execute(RedisOperations operations) {
        operations.multi();
        operations.opsForValue().set("key:a", "1");
        operations.opsForValue().set("key:b", "2");
        return operations.exec();
    }
});
```

Kenapa?

Karena transaction Redis harus berada pada connection/session yang sama. `SessionCallback` menyediakan scope eksekusi tersebut.

### 18.2 WATCH dengan Spring Data Redis

Pseudo:

```java
Boolean updated = redisTemplate.execute(new SessionCallback<Boolean>() {
    @Override
    @SuppressWarnings({ "unchecked", "rawtypes" })
    public Boolean execute(RedisOperations operations) {
        String key = "quota:{tenant-123}:remaining";

        operations.watch(key);

        Object raw = operations.opsForValue().get(key);
        long remaining = Long.parseLong(String.valueOf(raw));

        if (remaining <= 0) {
            operations.unwatch();
            return false;
        }

        operations.multi();
        operations.opsForValue().decrement(key);
        List<Object> execResult = operations.exec();

        return execResult != null;
    }
});
```

Catatan:

- `execResult == null` berarti transaction aborted karena watched key berubah.
- Jangan retry infinite.
- Jangan melakukan call lambat/external antara `WATCH` dan `EXEC`.
- Jangan melakukan blocking I/O ke database/API di antara `WATCH` dan `EXEC`.

### 18.3 Transaction support di RedisTemplate

Spring Data Redis memiliki opsi transaction support pada `RedisTemplate`.

Tetapi untuk clarity dan kontrol produksi, banyak tim lebih memilih explicit `SessionCallback` untuk operasi Redis transaction yang penting.

Reason:

- lebih jelas connection scope-nya,
- lebih mudah review,
- lebih eksplisit failure handling-nya,
- mengurangi ilusi bahwa Redis mengikuti semantics SQL transaction.

---

## 19. Failure Matrix

| Failure | Dampak | Mitigasi |
|---|---|---|
| Network timeout sebelum `EXEC` terkirim | Tidak ada command transaction dijalankan | retry safe jika operation idempotent |
| Network timeout setelah `EXEC` terkirim | Client tidak tahu apakah transaction berhasil | gunakan idempotency marker / read-back / operation id |
| Runtime command error di dalam `EXEC` | Command lain bisa tetap berhasil | validasi type, key schema, Lua guard |
| Watched key berubah | `EXEC` abort | retry dengan backoff atau return conflict |
| Connection berganti saat WATCH flow | Transaction salah/gagal | gunakan same connection/session |
| High contention | retry storm | Lua, sharding, ownership model, backoff |
| Cluster cross-slot | transaction gagal/tidak valid | hash tags berdasarkan aggregate |
| Redis failover saat transaction | unknown outcome | idempotent design, retry/read-back |
| Long computation antara WATCH dan EXEC | conflict probability naik | compute cepat, move logic to Lua |
| Serializer mismatch | wrong value/error | centralize serializers, contract tests |

---

## 20. Unknown Outcome Problem

Ini sangat penting.

Saat client mengirim `EXEC`, lalu connection timeout sebelum menerima response:

```text
client -> EXEC
network timeout
client doesn't know result
```

Ada dua kemungkinan:

1. Redis tidak menerima `EXEC`.
2. Redis menerima dan menjalankan `EXEC`, tetapi response hilang.

Kalau client langsung retry tanpa idempotency, bisa double apply.

Contoh bahaya:

```text
MULTI
DECRBY quota:user:1 10
LPUSH audit:quota user:1:-10
EXEC
```

Jika timeout setelah `EXEC` berhasil, retry bisa mengurangi quota dua kali.

Mitigasi:

- gunakan operation id,
- simpan idempotency marker dalam transaction/script,
- lakukan read-back status,
- desain operation sebagai set-to-state, bukan increment/decrement buta,
- gunakan durable store untuk effect penting.

Pattern:

```text
operation:{opId}:applied = true
```

Dalam Lua atau transaction:

```text
if operation marker exists:
    return already_applied
else:
    apply effect
    set marker
```

Untuk hal seperti ini, Lua sering lebih aman daripada WATCH.

---

## 21. Design Heuristics

### 21.1 Pakai command native kalau bisa

Jika Redis punya single command atomic, gunakan itu.

Contoh:

- counter: `INCR`, `INCRBY`
- set membership: `SADD`
- sorted score update: `ZADD`
- conditional set: `SET NX EX`
- bounded list push: `LPUSH` + `LTRIM` bisa transaction atau Lua tergantung invariant

Jangan membuat transaction untuk hal yang sudah atomic secara native.

### 21.2 Pakai MULTI/EXEC untuk atomic batch sederhana

Cocok untuk:

- update beberapa derived keys,
- append metadata + counter,
- maintain small secondary structure,
- batch yang command-nya deterministic dan unlikely error.

### 21.3 Pakai WATCH untuk low-contention optimistic update

Cocok untuk:

- compare-and-set ringan,
- config snapshot update,
- versioned small object,
- administrative operation low concurrency.

### 21.4 Pakai Lua/Function untuk compact critical invariant

Cocok untuk:

- rate limiter,
- idempotency transition,
- lock release,
- inventory guard,
- high-contention CAS,
- state transition with expected state.

### 21.5 Pakai database transaction untuk durable business truth

Cocok untuk:

- money,
- legal audit,
- irreversible state,
- compliance history,
- durable workflow record.

---

## 22. Review Checklist untuk Redis Transaction

Sebelum approve PR yang memakai `MULTI/EXEC` atau `WATCH`, tanyakan:

1. Apakah single native Redis command cukup?
2. Apakah benar butuh transaction, bukan pipeline?
3. Apakah command di dalam transaction bisa runtime error?
4. Apakah semua key punya type contract yang jelas?
5. Apakah semua key berada di slot yang sama jika Redis Cluster?
6. Apakah operation idempotent jika client timeout setelah `EXEC`?
7. Apakah ada unknown outcome mitigation?
8. Apakah `WATCH` flow memakai connection yang sama?
9. Apakah ada max retry dan jitter?
10. Apakah high contention lebih cocok dengan Lua?
11. Apakah Redis menjadi source of truth tanpa durability reasoning?
12. Apakah response `EXEC` diperiksa?
13. Apakah metric conflict/abort dicatat?
14. Apakah ada test concurrency?
15. Apakah serializer konsisten?

---

## 23. Testing Strategy

### 23.1 Test normal success

Verifikasi semua key berubah sesuai ekspektasi.

### 23.2 Test runtime error

Sengaja buat key tipe salah untuk melihat behavior.

Contoh:

```redis
SET number "not-a-number"
MULTI
INCR number
SET marker ok
EXEC
```

Pastikan tim memahami hasilnya.

### 23.3 Test WATCH conflict

Flow:

1. client A `WATCH key`,
2. client A `GET key`,
3. client B `SET key new-value`,
4. client A `MULTI`,
5. client A `SET key computed-value`,
6. client A `EXEC`,
7. assert aborted.

### 23.4 Test timeout/unknown outcome

Lebih sulit, tetapi penting.

Pendekatan:

- proxy network fault,
- test container + toxiproxy,
- kill connection after sending command,
- verify idempotency marker.

### 23.5 Test cluster key slot

Pastikan key naming untuk transaction memakai hash tag jika perlu.

Contoh helper test:

```java
assertSameSlot("quota:{tenant-123}:remaining", "quota:{tenant-123}:used");
```

---

## 24. Observability

Metric yang penting:

- transaction attempts,
- transaction success,
- transaction abort due to WATCH,
- retry count,
- max retry exceeded,
- exec latency,
- unknown outcome count,
- Redis command timeout,
- error inside exec result,
- conflict rate by key pattern,
- cluster cross-slot error count.

Log yang berguna:

```json
{
  "event": "redis_transaction_aborted",
  "operation": "quota_decrement",
  "keyPattern": "quota:{tenant}:remaining",
  "attempt": 3,
  "maxAttempts": 5,
  "reason": "watch_conflict"
}
```

Jangan log full key jika mengandung sensitive tenant/user data. Gunakan redaction atau hashed identifier.

---

## 25. Mini Lab

### 25.1 Jalankan Redis

```bash
docker run --rm -p 6379:6379 redis:8
```

### 25.2 Coba transaction sederhana

```bash
redis-cli
```

```redis
DEL tx:a tx:b
MULTI
SET tx:a 1
SET tx:b 2
EXEC
MGET tx:a tx:b
```

### 25.3 Coba runtime error

```redis
SET tx:number hello
MULTI
INCR tx:number
SET tx:marker ok
EXEC
GET tx:marker
```

Amati bahwa command lain masih bisa berhasil.

### 25.4 Coba WATCH conflict dengan dua terminal

Terminal A:

```redis
SET tx:balance 100
WATCH tx:balance
GET tx:balance
```

Terminal B:

```redis
SET tx:balance 200
```

Terminal A:

```redis
MULTI
SET tx:balance 150
EXEC
GET tx:balance
```

`EXEC` harus abort karena key berubah setelah `WATCH`.

### 25.5 Coba successful WATCH

```redis
WATCH tx:balance
GET tx:balance
MULTI
SET tx:balance 250
EXEC
GET tx:balance
```

Jika tidak ada client lain mengubah key, `EXEC` berhasil.

---

## 26. Architectural Takeaways

Redis transaction adalah tool kecil tapi tajam.

Gunakan untuk command-level atomicity, bukan untuk menggantikan transaction database.

Mental model final:

```text
Single Redis command:
  atomic by default.

Pipeline:
  network optimization.

MULTI/EXEC:
  queued commands executed sequentially without interleaving.

WATCH:
  optimistic compare-and-set guard.

Lua/Function:
  server-side atomic read-compute-write.

SQL transaction/event log:
  durable business truth and audit boundary.
```

Engineer yang matang tidak bertanya:

```text
Can Redis do transactions?
```

Tetapi bertanya:

```text
Invariant apa yang harus dijaga?
Apakah Redis transaction semantics cukup?
Apa failure mode jika EXEC outcome unknown?
Apakah key berada dalam aggregate/slot yang benar?
Apakah Redis boleh menjadi tempat truth untuk state ini?
```

---

## 27. Ringkasan

Dalam part ini kita membahas:

- Redis transaction berbeda dari SQL transaction.
- `MULTI` mengaktifkan queueing mode.
- `EXEC` menjalankan queued commands secara berurutan tanpa interleaving.
- `DISCARD` membuang queued commands sebelum execution.
- `WATCH` memberi optimistic concurrency.
- Runtime error dalam `EXEC` tidak berarti rollback otomatis seluruh transaction.
- Pipeline bukan transaction.
- `WATCH` bukan lock.
- Redis Cluster menuntut key dalam transaction berada pada slot yang sama.
- Java/Spring Data Redis perlu same connection/session, sering lewat `SessionCallback`.
- Unknown outcome setelah timeout adalah failure mode kritis.
- Untuk invariant kompleks/high contention, Lua/Redis Function sering lebih tepat.
- Untuk durable audit/business truth, gunakan database/event log, bukan Redis transaction saja.

---

## 28. Referensi

- Redis Documentation — Transactions: `MULTI`, `EXEC`, `DISCARD`, `WATCH`.
- Redis Command Documentation — `MULTI`, `EXEC`, `WATCH`, `DISCARD`.
- Redis Cluster specification dan multi-key operation constraints.
- Spring Data Redis Reference — Redis Transactions.
- Spring Data Redis API — `SessionCallback`.
- Redis client documentation — pipelines and transactions.

---

## 29. Status Seri

```text
Part 026 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-027.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Java Client Mastery: Lettuce, Jedis, Spring Data Redis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-027.md">Part 027 — Security: AUTH, ACL, TLS, Network Boundary, Secret Hygiene ➡️</a>
</div>
