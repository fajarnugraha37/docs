# learn-redis-mastery-for-java-engineers-part-013.md

# Part 013 — Distributed Locks: Useful, Dangerous, Often Misused

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `013`  
> Format file: `learn-redis-mastery-for-java-engineers-part-013.md`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara aman untuk koordinasi antar proses, bukan sekadar menyalin pattern `SETNX` dari internet.

---

## 0. Tujuan Bagian Ini

Distributed lock adalah salah satu topik Redis yang paling sering terlihat sederhana tetapi paling banyak menghasilkan bug produksi.

Di permukaan, pattern-nya terlihat seperti ini:

```redis
SET resource:lock random-token NX PX 30000
```

Kalau command mengembalikan `OK`, proses merasa berhasil memegang lock. Kalau tidak, proses menunggu atau gagal.

Masalahnya: **itu baru awal cerita**.

Bagian ini akan membangun pemahaman yang jauh lebih kuat tentang:

1. Apa yang Redis lock bisa jamin.
2. Apa yang Redis lock tidak bisa jamin.
3. Kenapa lock harus dipahami sebagai **lease**, bukan kepemilikan permanen.
4. Kenapa value lock harus random token.
5. Kenapa unlock harus memakai compare-and-delete atomic.
6. Kenapa GC pause, network delay, failover, dan clock assumption bisa merusak desain naïf.
7. Kapan single Redis lock cukup.
8. Kapan butuh fencing token.
9. Kapan Redlock relevan.
10. Kapan Redis lock sebaiknya tidak dipakai sama sekali.
11. Bagaimana membuat implementasi Java yang defensible.

Redis sendiri mendokumentasikan pattern distributed locks dengan Redis, termasuk single-instance lock memakai `SET resource_name random_value NX PX milliseconds`, safe release dengan Lua, dan algoritma Redlock untuk skenario multi-master independen. Dokumentasi Redis juga menekankan bahwa value random dipakai agar client hanya melepaskan lock yang ia miliki, dan script compare-delete dipakai agar release bersifat atomic. Referensi utama: Redis distributed locks documentation, `SET`, dan Lua scripting/EVAL.  

---

## 1. Problem yang Ingin Diselesaikan Lock

Distributed lock dipakai ketika beberapa proses, thread, container, node, atau instance service berpotensi menjalankan critical section yang sama secara bersamaan.

Contoh:

1. Satu job scheduler hanya boleh mengeksekusi satu job tertentu pada satu waktu.
2. Satu invoice hanya boleh diproses oleh satu worker.
3. Satu tenant billing cycle tidak boleh dihitung paralel.
4. Satu file export besar tidak boleh dibuat dua kali.
5. Satu cache rebuild mahal tidak boleh dikerjakan oleh banyak instance sekaligus.
6. Satu campaign activation workflow tidak boleh berjalan rangkap.
7. Satu reconciliation batch tidak boleh dimulai jika batch sebelumnya belum selesai.

Tanpa koordinasi, sistem bisa mengalami:

1. Duplicate processing.
2. Double charge.
3. Double notification.
4. Lost update.
5. Corrupted external side effect.
6. Race condition antar workflow.
7. Load spike karena semua instance melakukan pekerjaan mahal yang sama.

Lock terlihat seperti solusi universal. Tapi ini asumsi berbahaya.

Lock hanya membantu jika semua kondisi berikut benar:

1. Semua kontender memakai lock yang sama.
2. Critical section punya durasi yang bisa dibatasi.
3. Sistem bisa menghadapi lock expiry.
4. Side effect bisa dibuat aman meskipun lock holder lama masih berjalan.
5. Redis availability dan consistency model sesuai dengan risiko domain.
6. Lock failure tidak lebih buruk daripada pekerjaan paralel.

Kalau salah satu tidak benar, Redis lock bisa menciptakan ilusi keamanan.

---

## 2. Lock Lokal vs Distributed Lock

Di Java, lock lokal biasa terlihat seperti:

```java
synchronized (monitor) {
    // critical section
}
```

atau:

```java
private final ReentrantLock lock = new ReentrantLock();

lock.lock();
try {
    // critical section
} finally {
    lock.unlock();
}
```

Lock lokal hanya berlaku dalam satu JVM.

Kalau aplikasi berjalan dalam 10 pod Kubernetes, maka ada 10 JVM. `synchronized` tidak mencegah pod lain menjalankan critical section yang sama.

Distributed lock mencoba membuat koordinasi lintas proses melalui shared coordination system, misalnya:

1. Redis.
2. ZooKeeper.
3. etcd.
4. Consul.
5. Database row lock.
6. Advisory lock di database.
7. Cloud-native lease primitive.

Redis lock populer karena cepat dan mudah, tetapi Redis bukan sistem consensus lock murni seperti ZooKeeper/etcd. Redis bisa dipakai untuk banyak kasus praktis, tetapi desainnya harus sadar trade-off.

---

## 3. Redis Lock Bukan Mutex Biasa

Kesalahan mental model paling umum:

> “Saya punya Redis lock, berarti hanya saya yang bisa menjalankan critical section sampai saya unlock.”

Mental model yang lebih benar:

> “Saya berhasil memperoleh lease berdurasi terbatas dari Redis. Selama lease masih valid, sistem lain yang patuh pada protokol lock seharusnya tidak memulai critical section yang sama. Namun lease bisa expire, Redis bisa failover, client bisa pause, network bisa delay, dan resource eksternal tetap perlu proteksi tambahan bila dampaknya besar.”

Perbedaan ini sangat penting.

Mutex lokal biasanya punya karakteristik:

1. Lock holder tetap memiliki lock sampai unlock.
2. Thread lain di proses yang sama tidak bisa masuk.
3. Runtime mengelola ownership.
4. Tidak ada expiry otomatis.

Redis lock punya karakteristik:

1. Lock adalah key dengan TTL.
2. Lock otomatis hilang saat TTL habis.
3. Redis tidak tahu apakah proses pemilik masih hidup.
4. Redis tidak tahu apakah critical section sudah selesai.
5. Client harus membawa token ownership.
6. Unlock harus memastikan token cocok.
7. Lock holder bisa masih berjalan setelah TTL habis.

Karena itu, Redis lock adalah **lease**, bukan mutex absolut.

---

## 4. Naïve Lock Pattern yang Berbahaya

Pattern lama yang sering ditemukan:

```redis
SETNX my-lock 1
EXPIRE my-lock 30
```

Masalahnya: dua command terpisah.

Failure scenario:

1. Client mengirim `SETNX my-lock 1`.
2. Redis membuat key.
3. Client crash sebelum `EXPIRE my-lock 30`.
4. Lock tidak punya TTL.
5. Lock macet selamanya.

Itu sebabnya pattern modern harus memakai satu command atomic:

```redis
SET my-lock random-token NX PX 30000
```

`SET` dengan opsi `NX` hanya membuat key jika belum ada, dan opsi `PX` memberi TTL dalam milidetik. Karena ini satu command, Redis mengeksekusinya secara atomic.

Di Redis modern, `SET` adalah primitive utama untuk acquire lock, bukan `SETNX` + `EXPIRE` manual.

---

## 5. Minimal Correct Single-Instance Redis Lock

Pattern acquire:

```redis
SET lock:invoice:123 7f8b7f2c-6f56-4c2d-a63c-8fd7d7d34c99 NX PX 30000
```

Makna:

1. Key: `lock:invoice:123`.
2. Value: token random unik milik client.
3. `NX`: hanya berhasil kalau key belum ada.
4. `PX 30000`: lease 30 detik.

Jika Redis mengembalikan `OK`, client memperoleh lease.

Jika Redis mengembalikan null/nil, lock sedang dipegang client lain.

Pattern release tidak boleh:

```redis
DEL lock:invoice:123
```

Kenapa?

Karena client lama bisa menghapus lock milik client baru.

Safe release harus compare token:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
```

Dipanggil dengan:

```redis
EVAL <script> 1 lock:invoice:123 7f8b7f2c-6f56-4c2d-a63c-8fd7d7d34c99
```

Karena script dieksekusi atomic oleh Redis, tidak ada race antara `GET` dan `DEL`.

---

## 6. Kenapa Value Lock Harus Random Token

Bayangkan ada dua worker:

1. Worker A acquire lock dengan TTL 5 detik.
2. Worker A mengalami GC pause 10 detik.
3. Lock expire setelah 5 detik.
4. Worker B acquire lock baru.
5. Worker A resume dan menjalankan `DEL lock`.
6. Worker A menghapus lock milik Worker B.
7. Worker C bisa acquire lock.
8. Sekarang Worker B dan Worker C bisa berjalan paralel.

Dengan random token, Worker A hanya bisa delete lock jika value masih token miliknya.

Timeline dengan token:

```text
T0   A SET lock tokenA NX PX 5000 -> OK
T1   A pause
T5   lock tokenA expired
T6   B SET lock tokenB NX PX 5000 -> OK
T10  A resume
T11  A release with compare tokenA
T12  Redis sees current value is tokenB, not tokenA
T13  Redis does not delete
```

Token mencegah stale owner merusak lease owner baru.

Token tidak mencegah Worker A melanjutkan side effect setelah expiry. Itu masalah berbeda, dan akan dibahas dalam fencing token.

---

## 7. Lock Expiry Adalah Kontrak Keselamatan, Bukan Detail Teknis

TTL lock diperlukan supaya lock tidak macet jika client mati.

Tetapi TTL menciptakan masalah:

1. Jika TTL terlalu pendek, lock expire saat pekerjaan masih berjalan.
2. Jika TTL terlalu panjang, recovery dari crash lambat.
3. Jika TTL diperpanjang otomatis tanpa batas, lock bisa menjadi quasi-permanent.
4. Jika pekerjaan punya durasi tidak pasti, lock tidak bisa memberi jaminan kuat.

TTL harus dipilih berdasarkan:

1. Worst-case durasi critical section.
2. Tail latency external dependency.
3. JVM GC pause budget.
4. Network delay.
5. Redis latency.
6. Retry behavior.
7. Recovery requirement.
8. Dampak pekerjaan paralel.

Contoh buruk:

```text
Critical section biasanya 3 detik.
P95 5 detik.
P99 20 detik karena external API lambat.
TTL lock 10 detik.
```

Ini berarti pada P99, lock bisa expire saat pekerjaan masih berjalan.

Contoh lebih baik:

```text
Critical section harus didesain bounded.
Jika melebihi 8 detik, proses abort atau checkpoint.
TTL 15 detik.
External side effect memakai fencing token atau idempotency key.
```

Lock yang baik bukan hanya `PX` besar. Lock yang baik memaksa desain critical section menjadi terbatas dan recoverable.

---

## 8. GC Pause Problem di Java

Sebagai Java engineer, ini sangat penting.

JVM bisa berhenti sementara karena:

1. Stop-the-world GC.
2. Container CPU throttling.
3. Safepoint delay.
4. Page fault.
5. Host overload.
6. Long blocking I/O.
7. Debugger pause.
8. Thread starvation.

Dari perspektif Redis, client yang pause terlihat seperti client mati sementara.

Scenario:

```text
T0   Service A acquire lock TTL 10s
T1   Service A mulai critical section
T2   JVM pause 20s
T10  lock expired
T11  Service B acquire lock
T12  Service B menjalankan critical section
T22  Service A resume
T23  Service A lanjut menjalankan side effect
```

Sekarang A dan B sama-sama menjalankan critical section, walaupun Redis lock digunakan.

Ini bukan bug Redis. Ini konsekuensi lease.

Mitigasi:

1. Critical section harus idempotent.
2. Side effect harus dilindungi idempotency key.
3. Gunakan fencing token untuk resource yang bisa memvalidasi urutan.
4. Jangan melakukan pekerjaan panjang dalam lock.
5. Jangan lock sambil menunggu external API tidak bounded.
6. Monitor GC pause dan thread starvation.
7. Gunakan timeout ketat.
8. Desain lock sebagai optimization/coordination, bukan satu-satunya correctness barrier.

---

## 9. Network Delay dan Lost Response

Distributed systems selalu punya kasus ini:

```text
Client -> Redis: SET lock token NX PX 30000
Redis executes: OK
Network response lost
Client times out
```

Apa yang client tahu?

Client tidak tahu apakah lock berhasil atau gagal.

Kemungkinan:

1. Command tidak sampai Redis.
2. Command sampai Redis dan gagal karena lock sudah ada.
3. Command sampai Redis dan berhasil, tapi response hilang.

Ini disebut ambiguous outcome.

Untuk acquire lock, strategi aman biasanya:

1. Jangan langsung menganggap berhasil jika timeout.
2. Cek key dan token jika mungkin.
3. Jika key berisi token sendiri, client bisa menganggap acquire berhasil, tetapi durasi lease sudah berkurang.
4. Jika tidak yakin, tunggu lease window lewat atau retry dengan token baru sesuai policy.

Tetapi cek token juga punya race dengan expiry. Karena itu implementasi lock production harus memperlakukan timeout sebagai status serius, bukan sekadar retry buta.

---

## 10. Release Timeout dan Ambiguous Unlock

Release juga bisa ambigu:

```text
Client -> Redis: EVAL compare-delete
Redis executes: DEL lock
Network response lost
Client times out
```

Client tidak tahu apakah unlock berhasil.

Dalam banyak kasus, ini tidak fatal karena TTL akan membersihkan lock. Tetapi client harus berhati-hati:

1. Jangan retry release dengan token yang sama terlalu lama tanpa memahami bahwa key mungkin sudah expire dan diambil client lain.
2. Safe release script mencegah delete lock orang lain.
3. Jika release timeout, safe retry masih relatif aman karena token compare.
4. Namun release result tetap harus dimonitor.

---

## 11. Lock Renewal: Berguna Tetapi Berbahaya

Kadang critical section lebih lama dari TTL. Solusi umum: renew lock.

Renew harus compare token juga:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
    return 0
end
```

Pattern:

1. Acquire lock TTL 30 detik.
2. Worker menjalankan pekerjaan.
3. Background heartbeat memperpanjang TTL setiap 10 detik.
4. Jika renew gagal, worker harus stop atau masuk safe mode.

Masalah lock renewal:

1. Jika renew terus menerus, lock bisa macet lama.
2. Jika worker pause lebih lama dari TTL, renew gagal setelah resume, tapi worker mungkin sudah melakukan side effect.
3. Renewal thread bisa hidup sementara worker logic macet.
4. Renewal membuat reasoning lebih kompleks.
5. Renewal bisa menyembunyikan critical section yang tidak bounded.

Gunakan renewal hanya jika:

1. Pekerjaan memang bisa panjang.
2. Pekerjaan bisa dihentikan aman saat renewal gagal.
3. Ada max lease duration.
4. Ada progress checkpoint.
5. Ada fencing/idempotency untuk side effect.

Jangan gunakan renewal untuk menutupi desain critical section yang tidak terkendali.

---

## 12. Fencing Token: Konsep yang Sering Hilang

Redis lock mencegah client lain yang patuh pada protokol untuk memulai pekerjaan saat lock masih valid.

Tetapi Redis lock tidak bisa mencegah client lama yang pause untuk melanjutkan side effect setelah lease expired.

Fencing token menyelesaikan masalah ini dengan memberi nomor monotonik ke setiap lock acquisition.

Contoh:

```text
A acquire lock -> fencing token 101
A pause
Lock expired
B acquire lock -> fencing token 102
B writes to resource with token 102
A resumes
A tries writes to resource with token 101
Resource rejects token 101 because latest accepted token is 102
```

Fencing token membutuhkan resource target bisa memvalidasi token.

Misalnya:

1. Database row punya kolom `last_fencing_token`.
2. External service menerima idempotency/fencing header.
3. File storage metadata menyimpan generation number.
4. Workflow state machine menolak transition dengan stale token.

Tanpa resource target yang memeriksa token, fencing token hanya angka dekoratif.

Redis bisa membuat fencing token dengan `INCR`:

```redis
INCR lockseq:invoice:123
```

Tetapi acquire lock + generate fencing token harus dipikirkan atomicity-nya.

Sederhana untuk single Redis instance:

```lua
if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
    local token = redis.call("INCR", KEYS[2])
    return token
else
    return nil
end
```

Dengan:

```text
KEYS[1] = lock:invoice:123
KEYS[2] = lockseq:invoice:123
ARGV[1] = random ownership token
ARGV[2] = ttl millis
```

Dalam Redis Cluster, dua key ini harus berada di hash slot yang sama. Pakai hash tag:

```text
lock:{invoice:123}
lockseq:{invoice:123}
```

Karena keduanya punya hash tag `{invoice:123}`, Redis Cluster menempatkannya di slot yang sama.

---

## 13. Lock vs Fencing: Bedanya Apa?

Lock menjawab:

> “Siapa yang boleh mulai bekerja sekarang?”

Fencing menjawab:

> “Apakah aktor yang mencoba melakukan side effect ini masih generasi terbaru?”

Lock adalah admission control.

Fencing adalah stale-writer protection.

Untuk pekerjaan berdampak besar, keduanya sering perlu digabung.

Contoh tanpa fencing:

```text
Lock berhasil, proses pause, lock expire, proses lain masuk, proses lama resume, write stale.
```

Contoh dengan fencing:

```text
Lock berhasil, proses mendapat token 101.
Proses pause.
Lock expire.
Proses lain mendapat token 102.
Resource menerima 102.
Proses lama resume dengan 101.
Resource menolak 101.
```

Fencing sering lebih penting daripada lock untuk correctness.

---

## 14. Redlock: Apa Itu dan Kapan Relevan

Redlock adalah algoritma distributed lock yang dijelaskan oleh Redis untuk memperoleh lock dari beberapa Redis master independen.

Ide high-level:

1. Ada N Redis master independen, misalnya 5.
2. Client mencoba acquire lock pada mayoritas node, misalnya 3 dari 5.
3. Setiap lock memakai token random dan TTL.
4. Client menghitung waktu yang dibutuhkan untuk acquire.
5. Lock dianggap valid hanya jika mayoritas berhasil dan waktu acquire masih dalam lease validity window.
6. Release dilakukan ke semua node memakai token compare-delete.

Redlock dirancang untuk lebih kuat daripada single Redis instance dalam beberapa skenario availability/failure.

Namun Redlock bukan pengganti consensus system seperti etcd/ZooKeeper untuk semua kasus. Dalam desain sistem serius, Anda tetap harus bertanya:

1. Apa failure model yang diterima?
2. Apakah Redis nodes benar-benar independen?
3. Apakah clock drift terkendali?
4. Apakah critical section bounded?
5. Apakah side effect punya fencing?
6. Apakah operasi ini butuh linearizability yang kuat?
7. Apakah database row lock/advisory lock lebih cocok?
8. Apakah queue/workflow engine lebih cocok?

Redlock cocok dipertimbangkan ketika:

1. Anda butuh lock lintas proses.
2. Anda ingin mengurangi single-node failure risk.
3. Anda bisa menerima lease-based semantics.
4. Critical section relatif pendek.
5. Side effect aman dengan idempotency/fencing.
6. Anda memahami operational complexity dari beberapa Redis master.

Redlock kurang cocok ketika:

1. Kesalahan lock bisa menyebabkan kerugian finansial besar.
2. Resource target tidak bisa memvalidasi fencing token.
3. Critical section panjang dan tidak bounded.
4. Anda butuh strict serializability.
5. Redis nodes tidak benar-benar independen.
6. Anda hanya menyalin library tanpa memahami failure model.

---

## 15. Single Redis Lock vs Redlock vs Database Lock

Tidak semua kasus butuh Redlock. Tidak semua kasus cocok dengan Redis.

### 15.1 Single Redis Lock

Cocok untuk:

1. Cache rebuild mutex.
2. Prevent duplicate expensive computation.
3. Best-effort scheduler guard.
4. Non-critical background jobs.
5. Short bounded critical section.
6. Dampak paralelisme kecil atau recoverable.

Tidak cocok untuk:

1. Uang.
2. Legal/regulatory finalization.
3. Irreversible side effect tanpa idempotency.
4. Critical section sangat panjang.
5. Sistem yang menuntut correctness lebih tinggi dari availability.

### 15.2 Redlock

Cocok untuk:

1. Higher availability Redis-based lock.
2. Short lease-based coordination.
3. Sistem yang bisa tolerate lease ambiguity dengan mitigasi.
4. Lingkungan dengan Redis nodes independen.

Tidak cocok untuk:

1. Membuat Redis menjadi consensus system penuh.
2. Mengabaikan fencing.
3. Mengunci resource dengan side effect irreversible.

### 15.3 Database Row Lock

Cocok untuk:

1. Resource utama memang ada di database.
2. Transaksi SQL sudah menjadi boundary correctness.
3. Anda perlu atomic update terhadap row yang sama.
4. Anda butuh durability dan audit trail.

Contoh:

```sql
SELECT * FROM invoice WHERE id = ? FOR UPDATE;
```

atau optimistic locking:

```sql
UPDATE invoice
SET status = 'PROCESSING', version = version + 1
WHERE id = ? AND status = 'READY' AND version = ?;
```

Sering kali untuk domain critical, database conditional update lebih defensible daripada Redis lock.

---

## 16. Lock vs Queue vs Idempotency

Sebelum memakai lock, tanyakan apakah problem sebenarnya adalah salah satu dari ini:

### 16.1 Problem: Banyak Worker Mengambil Pekerjaan yang Sama

Solusi mungkin bukan lock, tapi queue atau claim state.

```sql
UPDATE job
SET status = 'PROCESSING', claimed_by = ?, claimed_at = now()
WHERE id = ? AND status = 'READY';
```

Atau Redis Streams consumer group.

### 16.2 Problem: Request Bisa Dikirim Ulang

Solusi mungkin idempotency key, bukan lock.

```text
idempotency:{tenant}:{requestId}
```

### 16.3 Problem: Side Effect Eksternal Tidak Boleh Ganda

Solusi mungkin idempotency di external provider, outbox pattern, atau unique constraint.

### 16.4 Problem: Hanya Ingin Mengurangi Stampede

Solusi lock boleh, tapi sifatnya performance optimization. Kalau lock gagal, sistem tetap harus benar.

### 16.5 Problem: Workflow State Transition

Solusi sering lebih baik berupa state machine dengan transition guard:

```sql
UPDATE case_workflow
SET state = 'ESCALATING'
WHERE case_id = ? AND state = 'READY_FOR_ESCALATION';
```

Lock bisa membantu, tetapi state transition guard adalah correctness barrier.

---

## 17. Desain Key untuk Redis Lock

Lock key harus eksplisit dan scoped.

Format umum:

```text
lock:{bounded-context}:{resource-type}:{resource-id}
```

Contoh:

```text
lock:billing:invoice:123
lock:case:escalation:CASE-2026-0001
lock:cache-rebuild:tenant:acme:permissions
lock:scheduler:daily-reconciliation:2026-06-20
```

Untuk Redis Cluster, jika lock butuh companion key seperti sequence/fencing token, gunakan hash tag:

```text
lock:{billing:invoice:123}
lockseq:{billing:invoice:123}
```

Hindari key terlalu umum:

```text
lock:global
lock:job
lock:processing
```

Key terlalu umum menciptakan bottleneck dan coupling antar domain.

Hindari key terlalu spesifik yang tidak pernah dipakai bersama:

```text
lock:invoice:123:instance:i-9d8a7
```

Jika setiap instance punya key sendiri, lock tidak mengunci apa pun.

---

## 18. TTL Selection Framework

TTL lock bukan angka random.

Gunakan pertanyaan ini:

1. Berapa P50/P95/P99 durasi critical section?
2. Apa durasi maksimum yang secara bisnis masih wajar?
3. Apa external dependency paling lambat?
4. Apakah external call punya timeout?
5. Apakah ada retry dalam critical section?
6. Apakah retry bisa memperpanjang durasi tak terkendali?
7. Berapa GC pause worst-case yang pernah terlihat?
8. Apa dampak jika lock expire terlalu cepat?
9. Apa dampak jika lock terlalu lama setelah crash?
10. Apakah pekerjaan bisa dibagi menjadi chunk kecil?

Formula praktis awal:

```text
TTL = bounded critical section timeout
    + network margin
    + Redis latency margin
    + JVM pause budget
    + safety buffer
```

Tetapi lebih penting dari formula:

> Jika critical section tidak punya batas durasi, Redis lock Anda tidak punya batas correctness yang jelas.

---

## 19. Retry Strategy untuk Acquire Lock

Acquire lock bisa gagal karena lock sedang dipegang.

Strategi yang mungkin:

1. Fail fast.
2. Retry dengan backoff.
3. Retry dengan jitter.
4. Wait bounded.
5. Queue request.
6. Return conflict/try later.

Untuk backend API, fail fast sering lebih baik daripada membuat thread menunggu lama.

Contoh policy:

```text
Try acquire once.
If fail, return 409 Conflict: resource is already being processed.
```

Untuk background worker:

```text
Try acquire.
If fail, skip job and retry in next scheduler tick.
```

Untuk cache rebuild:

```text
Try acquire.
If fail, serve stale cache or wait briefly with jitter.
```

Hindari retry storm:

```text
100 instances gagal acquire lock.
Semua retry setiap 10ms.
Redis menerima traffic lock berlebihan.
```

Gunakan exponential backoff + jitter.

---

## 20. Java Implementation: Minimal Redis Lock dengan Lettuce

Contoh berikut sengaja eksplisit, bukan terlalu abstrak.

> Catatan: production code perlu observability, error taxonomy, timeout, metrics, dan integration test. Contoh ini untuk mental model.

```java
package com.example.redislock;

import io.lettuce.core.SetArgs;
import io.lettuce.core.ScriptOutputType;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public final class RedisLeaseLock {

    private static final String RELEASE_SCRIPT = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        else
            return 0
        end
        """;

    private final RedisCommands<String, String> redis;

    public RedisLeaseLock(RedisCommands<String, String> redis) {
        this.redis = Objects.requireNonNull(redis);
    }

    public Optional<Lease> tryAcquire(String key, Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("ttl must be positive");
        }

        String token = UUID.randomUUID().toString();

        SetArgs args = SetArgs.Builder
                .nx()
                .px(ttl.toMillis());

        String result = redis.set(key, token, args);

        if ("OK".equals(result)) {
            return Optional.of(new Lease(key, token, ttl));
        }

        return Optional.empty();
    }

    public boolean release(Lease lease) {
        Long result = redis.eval(
                RELEASE_SCRIPT,
                ScriptOutputType.INTEGER,
                new String[]{lease.key()},
                lease.token()
        );

        return result != null && result == 1L;
    }

    public record Lease(String key, String token, Duration ttl) {}
}
```

Usage:

```java
Optional<RedisLeaseLock.Lease> maybeLease = lock.tryAcquire(
        "lock:billing:invoice:123",
        Duration.ofSeconds(30)
);

if (maybeLease.isEmpty()) {
    throw new IllegalStateException("Invoice is already being processed");
}

RedisLeaseLock.Lease lease = maybeLease.get();
try {
    processInvoice("123");
} finally {
    boolean released = lock.release(lease);
    if (!released) {
        // Could mean expired, stolen, already released, or Redis issue depending on exception handling.
        // Emit metric/log; do not blindly assume correctness.
    }
}
```

Important limitation:

```java
processInvoice("123");
```

must still be safe if lease expires before completion.

That means:

1. Use idempotency.
2. Use database state transition guards.
3. Use external idempotency keys.
4. Use fencing token if stale writer is dangerous.

---

## 21. Java Implementation: Lock with Bounded Wait

A bounded wait is often useful for background jobs, but dangerous for request threads if overused.

```java
package com.example.redislock;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;

public final class LockAcquirer {

    private final RedisLeaseLock lock;
    private final Clock clock;

    public LockAcquirer(RedisLeaseLock lock, Clock clock) {
        this.lock = lock;
        this.clock = clock;
    }

    public Optional<RedisLeaseLock.Lease> tryAcquireWithin(
            String key,
            Duration ttl,
            Duration maxWait,
            Duration minBackoff,
            Duration maxBackoff
    ) throws InterruptedException {

        Instant deadline = clock.instant().plus(maxWait);

        while (clock.instant().isBefore(deadline)) {
            Optional<RedisLeaseLock.Lease> lease = lock.tryAcquire(key, ttl);
            if (lease.isPresent()) {
                return lease;
            }

            long sleepMillis = randomBetween(minBackoff.toMillis(), maxBackoff.toMillis());
            Thread.sleep(sleepMillis);
        }

        return Optional.empty();
    }

    private long randomBetween(long minInclusive, long maxInclusive) {
        if (maxInclusive <= minInclusive) {
            return minInclusive;
        }
        return ThreadLocalRandom.current().nextLong(minInclusive, maxInclusive + 1);
    }
}
```

Design notes:

1. `maxWait` must be bounded.
2. Use jitter to avoid thundering herd.
3. Do not block servlet/request threads indefinitely.
4. Emit metrics for wait time and acquisition failures.
5. Treat lock contention as a signal, not only a transient inconvenience.

---

## 22. Java Implementation: Fencing Token Lock

Untuk domain yang lebih serius, lock acquisition bisa mengembalikan fencing token.

Lua script:

```lua
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
    return redis.call('INCR', KEYS[2])
else
    return nil
end
```

Java:

```java
package com.example.redislock;

import io.lettuce.core.ScriptOutputType;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public final class FencedRedisLock {

    private static final String ACQUIRE_SCRIPT = """
        if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
            return redis.call('INCR', KEYS[2])
        else
            return nil
        end
        """;

    private static final String RELEASE_SCRIPT = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        else
            return 0
        end
        """;

    private final RedisCommands<String, String> redis;

    public FencedRedisLock(RedisCommands<String, String> redis) {
        this.redis = Objects.requireNonNull(redis);
    }

    public Optional<FencedLease> tryAcquire(String lockKey, String sequenceKey, Duration ttl) {
        String ownershipToken = UUID.randomUUID().toString();

        Long fencingToken = redis.eval(
                ACQUIRE_SCRIPT,
                ScriptOutputType.INTEGER,
                new String[]{lockKey, sequenceKey},
                ownershipToken,
                String.valueOf(ttl.toMillis())
        );

        if (fencingToken == null) {
            return Optional.empty();
        }

        return Optional.of(new FencedLease(lockKey, ownershipToken, fencingToken, ttl));
    }

    public boolean release(FencedLease lease) {
        Long result = redis.eval(
                RELEASE_SCRIPT,
                ScriptOutputType.INTEGER,
                new String[]{lease.lockKey()},
                lease.ownershipToken()
        );
        return result != null && result == 1L;
    }

    public record FencedLease(
            String lockKey,
            String ownershipToken,
            long fencingToken,
            Duration ttl
    ) {}
}
```

Cluster-safe key naming:

```java
String resource = "billing:invoice:123";
String lockKey = "lock:{" + resource + "}";
String sequenceKey = "lockseq:{" + resource + "}";
```

Both keys share the same hash tag.

---

## 23. Fencing Token at Database Boundary

Redis can issue fencing token, but the database must enforce it.

Example table:

```sql
CREATE TABLE invoice_processing_guard (
    invoice_id          VARCHAR(64) PRIMARY KEY,
    last_fencing_token  BIGINT NOT NULL,
    updated_at          TIMESTAMP NOT NULL
);
```

Before side effect:

```sql
UPDATE invoice_processing_guard
SET last_fencing_token = :token,
    updated_at = now()
WHERE invoice_id = :invoiceId
  AND last_fencing_token < :token;
```

If update count is 0, this actor is stale.

For state transition:

```sql
UPDATE invoice
SET status = 'PROCESSING',
    processing_fencing_token = :token,
    updated_at = now()
WHERE id = :invoiceId
  AND status = 'READY'
  AND (
      processing_fencing_token IS NULL
      OR processing_fencing_token < :token
  );
```

For finalization:

```sql
UPDATE invoice
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = :invoiceId
  AND status = 'PROCESSING'
  AND processing_fencing_token = :token;
```

This prevents a stale worker from completing work that a newer worker has taken over.

---

## 24. Lock State Machine

A robust lock-using worker should behave like a small state machine.

```text
IDLE
  -> ACQUIRING
  -> ACQUIRED
  -> WORKING
  -> RELEASING
  -> RELEASED
```

Failure transitions:

```text
ACQUIRING -> UNKNOWN_OUTCOME
ACQUIRED  -> EXPIRED_OR_LOST
WORKING   -> ABORTING
RELEASING -> RELEASE_UNKNOWN
```

Do not model lock as boolean:

```java
boolean locked = redis.setnx(...);
```

Model it as lease metadata:

```java
record Lease(
    String key,
    String ownershipToken,
    Instant acquiredAt,
    Duration ttl,
    OptionalLong fencingToken
) {}
```

Because meaningful questions include:

1. When was it acquired?
2. How much validity remains?
3. Which token owns it?
4. Was it released?
5. Did release fail?
6. Did critical section overrun TTL?
7. Was fencing token used downstream?

---

## 25. Observability for Redis Locks

You need metrics. Without metrics, lock behavior is invisible until an incident.

Track:

1. `redis_lock_acquire_attempt_total{lock_name}`
2. `redis_lock_acquire_success_total{lock_name}`
3. `redis_lock_acquire_failure_total{lock_name}`
4. `redis_lock_acquire_timeout_total{lock_name}`
5. `redis_lock_wait_duration_ms{lock_name}`
6. `redis_lock_hold_duration_ms{lock_name}`
7. `redis_lock_release_success_total{lock_name}`
8. `redis_lock_release_mismatch_total{lock_name}`
9. `redis_lock_release_error_total{lock_name}`
10. `redis_lock_expired_before_release_total{lock_name}`
11. `redis_lock_critical_section_overrun_total{lock_name}`
12. `redis_lock_fencing_reject_total{resource_type}`

Also log structured events:

```json
{
  "event": "redis_lock_acquired",
  "lockKey": "lock:billing:invoice:123",
  "ttlMs": 30000,
  "ownershipTokenHash": "sha256:...",
  "fencingToken": 102,
  "service": "billing-worker",
  "instanceId": "pod-7df9c"
}
```

Do not log raw token if logs are broadly accessible. Hash it if needed.

---

## 26. Alerting Signals

Alerts should focus on symptoms that matter.

Useful alerts:

1. Acquire failure rate suddenly high.
2. Wait duration high.
3. Hold duration near TTL.
4. Release mismatch increasing.
5. Critical section overrun.
6. Fencing rejects increasing.
7. Redis latency high.
8. Redis timeouts high.
9. Redis failover around lock incidents.
10. Lock cardinality unexpectedly growing.

Potential alert:

```text
p99(redis_lock_hold_duration_ms{lock_name="invoice-processing"}) > 0.8 * ttl_ms
```

This says critical section is too close to lease expiry.

---

## 27. Failure Matrix

| Failure | What happens | Required mitigation |
|---|---|---|
| Client crashes after acquire | Lock remains until TTL | TTL required |
| Client pauses past TTL | Another client may acquire | Fencing/idempotency/abort checks |
| Client releases after TTL | Might delete new lock if unsafe | Random token + compare-delete Lua |
| Redis response lost on acquire | Outcome ambiguous | Token check / conservative retry |
| Redis response lost on release | Release ambiguous | Safe retry + TTL fallback |
| Redis primary fails before replication | Lock may be lost | Understand replication/failover risk; consider Redlock or different primitive |
| Critical section longer than TTL | Concurrent execution possible | Bound work, renew carefully, fencing |
| Retry storm on contention | Redis load spike | Backoff + jitter |
| Key naming too broad | Throughput bottleneck | Scope lock key correctly |
| Key naming too narrow | Lock ineffective | Resource-based key design |
| Unlock uses DEL | Deletes someone else's lock | Compare token in Lua |
| No observability | Silent correctness bugs | Metrics/logs/traces |

---

## 28. Redis Replication and Failover Risk

Single Redis primary with replica is common.

But replication is asynchronous.

Scenario:

1. Client A acquires lock on primary.
2. Primary acknowledges `OK`.
3. Primary crashes before lock replicated.
4. Replica is promoted.
5. New primary does not have lock.
6. Client B acquires same lock.
7. A and B both think they hold lock.

This is one reason Redis documentation discusses Redlock for stronger distributed locking assumptions.

For low-risk workloads, this may be acceptable.

For high-risk workloads, you need one or more:

1. Fencing token enforced by durable resource.
2. Database conditional state transition.
3. Consensus-backed lock service.
4. Queue with durable claim semantics.
5. Workflow engine.
6. Redlock with independent Redis masters, if its assumptions fit.

Do not assume Redis replication gives linearizable locking.

---

## 29. Should You Use Redis Lock? Decision Framework

Ask these questions.

### 29.1 Is correctness dependent on the lock?

If no, Redis lock is likely okay as optimization.

Example:

```text
Only one instance should rebuild cache if possible.
If two rebuild, system still correct but wastes resources.
```

If yes, continue.

### 29.2 Can critical section exceed TTL?

If yes, either redesign, add renewal with abort semantics, or avoid Redis lock.

### 29.3 Can stale worker cause irreversible harm?

If yes, use fencing/idempotency/DB guard.

### 29.4 Is the resource already represented in a database row?

If yes, a database conditional update may be simpler and safer.

### 29.5 Do you need strict ordering or durable serialization?

If yes, Redis lock may be wrong primitive.

### 29.6 Is the lock only for duplicate work suppression?

If yes, Redis lock can be suitable.

---

## 30. Good Use Cases

Redis lock is often good for:

1. Cache stampede suppression.
2. Preventing duplicate cache warmup.
3. Best-effort singleton scheduled job.
4. Short maintenance task guard.
5. Non-critical report generation deduplication.
6. Short-lived per-resource background task.
7. Protecting an expensive but idempotent computation.
8. Avoiding duplicated notification preparation when send layer is idempotent.

Characteristics:

1. Short critical section.
2. TTL bounded.
3. Duplicate execution tolerable or recoverable.
4. Side effects idempotent.
5. Observability exists.

---

## 31. Bad Use Cases

Redis lock is often bad for:

1. Payment capture without provider idempotency.
2. Legal case finalization without durable state guard.
3. Regulatory enforcement transition with audit consequences but no database constraint.
4. Long-running ETL without checkpoint.
5. Distributed transaction substitute.
6. Cross-service saga correctness barrier.
7. Protecting non-idempotent external API.
8. Anything where “two processes ran” is catastrophic and no downstream guard exists.

In these cases, prefer:

1. Database transaction.
2. Optimistic concurrency control.
3. Durable queue claim.
4. Workflow engine.
5. External provider idempotency key.
6. Consensus coordination system.
7. Fencing token enforced by resource.

---

## 32. Regulatory/Case Management Perspective

For enforcement lifecycle or regulatory case systems, Redis lock should rarely be the only correctness mechanism.

Example risky design:

```text
Acquire Redis lock on case ID.
If acquired, transition case from INVESTIGATION to ENFORCEMENT_ACTION.
Write audit later.
```

Problem:

1. Lock might expire.
2. Worker might pause.
3. Failover might lose lock.
4. Audit might not reflect contention.
5. Duplicate transitions might happen if state guard missing.

Better design:

```text
Redis lock: optional contention reducer.
Database transition: authoritative correctness barrier.
Audit event: durable.
Fencing/version: stale writer protection.
```

Example:

```sql
UPDATE case_lifecycle
SET state = 'ENFORCEMENT_ACTION',
    version = version + 1,
    updated_by = :actor,
    updated_at = now()
WHERE case_id = :caseId
  AND state = 'INVESTIGATION'
  AND version = :expectedVersion;
```

Then emit audit event transactionally through outbox.

Redis lock can reduce duplicate attempts, but database state transition defines truth.

---

## 33. Testing Redis Locks

You must test failure behavior, not only happy path.

### 33.1 Test Acquire Success

```text
Given no lock key
When client acquires lock
Then Redis returns lease
And key has token
And TTL exists
```

### 33.2 Test Acquire Conflict

```text
Given lock key exists
When second client acquires
Then acquire fails
```

### 33.3 Test Safe Release

```text
Given lock key has tokenB
When client with tokenA releases
Then key remains
```

### 33.4 Test Expiry

```text
Given lock TTL 100ms
When wait > 100ms
Then another client can acquire
```

### 33.5 Test Critical Section Overrun

```text
Given TTL 100ms
When worker sleeps 200ms
Then release returns false or mismatch
And system handles stale lease safely
```

### 33.6 Test Fencing Reject

```text
Given worker A token 101
And worker B token 102
When A writes after B
Then DB rejects A
```

### 33.7 Test Redis Timeout

Use test doubles or proxy to simulate:

1. Acquire timeout.
2. Release timeout.
3. Redis unavailable.
4. Slow Redis.
5. Connection reset.

With Testcontainers, you can run Redis integration tests and inject lifecycle events.

---

## 34. Practical Lock Review Checklist

Before approving Redis lock in a Java service, ask:

1. What exact resource is locked?
2. Is key naming resource-scoped?
3. Is acquire one atomic `SET NX PX` or equivalent Lua?
4. Is value a unique random token?
5. Is release compare-and-delete via Lua?
6. Is TTL justified by measured critical section duration?
7. What happens if TTL expires while work continues?
8. What happens if JVM pauses?
9. What happens if Redis failover loses lock?
10. Is side effect idempotent?
11. Is fencing token needed?
12. Is fencing token enforced downstream?
13. Are retries bounded with jitter?
14. Are lock metrics emitted?
15. Is lock contention visible?
16. Is this actually a queue/state-transition problem?
17. Is database conditional update safer?
18. Is duplicate execution tolerable?
19. Are integration tests covering expiry and stale release?
20. Is there a runbook for stuck/high-contention locks?

If many answers are unclear, the design is not ready.

---

## 35. Mini Architecture Examples

### 35.1 Cache Rebuild Lock

Use Redis lock as optimization.

```text
GET cache:item:123 -> miss
Try lock cache-rebuild:item:123
If acquired:
    Load from DB
    SET cache
    Release lock
If not acquired:
    Wait small jitter
    Retry GET cache
    If still miss, maybe serve fallback
```

Correctness does not depend on the lock. Worst case: duplicate DB load.

### 35.2 Invoice Processing Lock

Do not rely only on Redis.

```text
Try Redis lock invoice 123 with fencing token
DB transition READY -> PROCESSING with fencing token
Call payment provider with idempotency key
DB transition PROCESSING -> PAID only if fencing token matches
Release lock
```

Correctness barriers:

1. DB state transition.
2. Provider idempotency key.
3. Fencing token.
4. Redis lock as contention reducer.

### 35.3 Scheduled Job Singleton

For low-risk scheduled jobs:

```text
Every instance wakes up at 01:00.
Try lock scheduler:daily-report:2026-06-20 TTL 10m.
Only one instance runs.
If lock unavailable, others skip.
```

But if daily report must run exactly once, use durable job table or scheduler with persistent claim.

---

## 36. Common Anti-Patterns

### Anti-Pattern 1: `SETNX` then `EXPIRE`

Non-atomic. Can create permanent lock.

Use `SET key token NX PX ttl`.

### Anti-Pattern 2: Unlock with `DEL`

Can delete another client's lock.

Use compare-delete Lua.

### Anti-Pattern 3: No Random Token

Cannot prove ownership.

Use UUID/secure random enough unique token.

### Anti-Pattern 4: TTL Longer Than Business Reality

Long TTL hides stuck work.

Bound critical section instead.

### Anti-Pattern 5: TTL Shorter Than P99 Work

Creates parallel execution under load.

Measure and set policy.

### Anti-Pattern 6: Lock Around External API with No Timeout

Critical section duration becomes unbounded.

Set external timeout and idempotency.

### Anti-Pattern 7: Lock as Substitute for Database Constraint

Redis lock can fail; DB constraint should protect source of truth.

### Anti-Pattern 8: No Metrics

You cannot debug contention or stale release.

### Anti-Pattern 9: Global Lock

Kills throughput and creates coupling.

### Anti-Pattern 10: Assuming Redlock Solves Everything

Redlock changes failure assumptions. It does not remove lease semantics.

---

## 37. Mental Model Summary

Redis lock is:

1. A key.
2. With a random ownership token.
3. With a TTL.
4. Acquired atomically.
5. Released only if token matches.
6. A lease, not absolute ownership.
7. Useful for coordination.
8. Dangerous as sole correctness mechanism.

Correct Redis lock design requires:

1. Atomic acquire.
2. Safe release.
3. TTL discipline.
4. Bounded critical section.
5. Retry discipline.
6. Observability.
7. Idempotency.
8. Fencing for stale writer protection.
9. Awareness of Redis replication/failover semantics.
10. Willingness to choose another primitive when Redis is not enough.

The most senior Redis lock skill is not knowing the command. It is knowing **when the lock is not the real solution**.

---

## 38. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. Why `SETNX` + `EXPIRE` is unsafe.
2. Why `SET key token NX PX ttl` is the minimal acquire primitive.
3. Why lock value must be random.
4. Why release must use Lua compare-delete.
5. Why Redis lock is a lease.
6. How JVM GC pause breaks naïve lock assumptions.
7. Why TTL selection is a system design decision.
8. Why fencing token matters.
9. How Redis Cluster affects lock key design.
10. Why Redis replication/failover can violate lock expectations.
11. When Redlock is relevant.
12. When database locks or conditional updates are better.
13. How to implement a basic Redis lock in Java with Lettuce.
14. How to observe Redis lock behavior in production.
15. How to review Redis lock design critically.

---

## 39. Practical Exercises

### Exercise 1 — Implement Safe Lock

Build a Java class with:

1. `tryAcquire(key, ttl)`.
2. `release(lease)`.
3. Random token.
4. Lua compare-delete.
5. Metrics hooks.

### Exercise 2 — Simulate Expiry

1. Acquire lock with TTL 1 second.
2. Sleep 2 seconds.
3. Try release.
4. Confirm release returns false or key absent.
5. Confirm another client can acquire.

### Exercise 3 — Simulate Stale Owner

1. Client A acquire lock.
2. Let it expire.
3. Client B acquire lock.
4. Client A release with old token.
5. Verify B's lock remains.

### Exercise 4 — Add Fencing Token

1. Add sequence key.
2. Return fencing token on acquire.
3. Store token in database row.
4. Reject stale token.

### Exercise 5 — Design Review

Pick one workflow in your current system and answer:

1. Why do we need a lock?
2. What resource is locked?
3. What is the TTL?
4. What happens if lock expires mid-work?
5. What protects the source of truth?
6. Do we need fencing?
7. What metrics prove it works?

---

## 40. References

Primary references for this part:

1. Redis documentation — Distributed Locks with Redis.
2. Redis documentation — `SET` command options including `NX`, `PX`, `EX`, `XX`, `GET`, and newer conditional options.
3. Redis documentation — Lua scripting and `EVAL`.
4. Redis documentation — `EVALSHA` and script cache behavior.
5. Redis documentation — Redis programmability and Redis Functions overview.

---

## 41. Status Seri

```text
Part 013 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-014.md
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Idempotency, Deduplication, dan Exactly-Once Illusion</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-014.md">Part 014 — Lua Scripting: Atomic Multi-Step Logic di Redis ➡️</a>
</div>
