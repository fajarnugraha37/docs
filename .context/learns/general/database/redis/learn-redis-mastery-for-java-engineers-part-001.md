# learn-redis-mastery-for-java-engineers-part-001.md

# Part 001 — Redis Core Mental Model: Server, Keyspace, Command, Event Loop

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java Software Engineer / Tech Lead  
> Fokus bagian ini: membangun mental model Redis sebagai server stateful dengan command execution model yang spesifik, bukan sekadar library cache atau remote `Map<String, Object>`.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 000 kita membangun orientasi besar: Redis adalah **in-memory data structure server** yang sering dipakai sebagai cache, tetapi tidak terbatas pada cache. Redis bisa menjadi rate limiter, idempotency store, distributed coordination primitive, session store, leaderboard engine, delay queue, stream processor ringan, dan real-time state layer.

Part 001 ini masuk ke fondasi yang lebih teknis:

1. Redis sebagai **server process**.
2. Redis sebagai **keyspace**.
3. Redis sebagai **command processor**.
4. Redis sebagai **mostly single-threaded event-loop system**.
5. Redis sebagai sistem dengan **atomicity per command**, tetapi bukan transaksi global otomatis.
6. Redis sebagai dependency jaringan yang performanya sangat dipengaruhi **round trip, blocking command, payload size, dan client behavior**.

Kalau mental model ini salah, hampir semua desain Redis berikutnya akan rawan:

- cache stampede,
- hot key,
- retry storm,
- lock palsu,
- queue hilang,
- TTL yang tidak defensible,
- command mahal yang memblokir server,
- pipeline yang salah pakai,
- latency spike yang sulit dijelaskan,
- Redis diperlakukan seperti database transaksional padahal bukan.

---

## 1. Redis Bukan Library, Redis Adalah Server Stateful

Banyak Java engineer pertama kali mengenal Redis melalui Spring Cache:

```java
@Cacheable(value = "product", key = "#id")
public Product getProduct(String id) {
    return productRepository.findById(id).orElseThrow();
}
```

Dari sisi kode, Redis terasa seperti annotation kecil. Ini berbahaya karena menyembunyikan realitas sistem.

Redis bukan annotation.

Redis adalah proses server terpisah:

```text
Java Service  --->  TCP connection  --->  Redis Server Process  --->  In-memory keyspace
```

Redis punya:

- process lifecycle,
- memory limit,
- network socket,
- command queue,
- persistence policy,
- replication topology,
- cluster topology,
- ACL/security,
- latency behavior,
- operational failure modes.

Artinya, setiap operasi Redis adalah operasi remote, bukan operasi memory lokal.

Membaca value dari Redis bukan seperti:

```java
map.get("user:123")
```

Tetapi lebih dekat dengan:

```text
serialize command
send bytes through socket
wait in network/client/server queue
server parses command
server executes command against shared keyspace
server serializes response
response travels through network
client deserializes response
application thread resumes
```

Itu sebabnya Redis cepat, tetapi tidak gratis.

---

## 2. Mental Model Paling Dasar

Redis dapat dipahami sebagai:

```text
A single logical keyspace
managed by a server process
that accepts commands from clients
and mutates/reads in-memory data structures
with mostly sequential command execution semantics.
```

Atau dalam bentuk diagram:

```text
+---------------------+
| Java Application A  |
+----------+----------+
           |
           | TCP / RESP
           v
+----------+----------+
|                    Redis Server                    |
|                                                     |
|  +------------------+     +---------------------+   |
|  | Connection I/O   | --> | Command Execution   |   |
|  +------------------+     +---------------------+   |
|                                      |              |
|                                      v              |
|                            +------------------+     |
|                            | In-Memory Data   |     |
|                            | Keyspace         |     |
|                            +------------------+     |
|                                                     |
+-----------------------------------------------------+
           ^
           |
+----------+----------+
| Java Application B  |
+---------------------+
```

Redis terlihat sederhana karena interface-nya adalah command:

```redis
SET user:123:name "Ayu"
GET user:123:name
INCR quota:tenant:42:2026-06-20
EXPIRE session:abc 1800
HSET user:123 status active
ZADD leaderboard 9812 player:9
```

Tetapi di balik command sederhana itu ada desain sistem yang sangat penting:

- semua client berbagi keyspace yang sama,
- command punya cost berbeda,
- command tertentu bisa memblokir proses utama,
- key bisa hilang karena TTL atau eviction,
- value berada di memory,
- persistence tidak selalu berarti durability kuat,
- replication biasanya asynchronous,
- cluster membatasi multi-key command,
- client library ikut menentukan behavior produksi.

---

## 3. Redis Server: Satu Proses, Banyak Koneksi, Shared State

Redis server menerima banyak koneksi client.

Dalam sistem Java production, koneksi ini bisa datang dari:

- banyak instance Spring Boot,
- background worker,
- scheduler,
- batch job,
- admin tool,
- monitoring system,
- Redis CLI,
- migration script,
- Lua/function deployment script.

Semua koneksi ini masuk ke satu logical Redis deployment.

Contoh:

```text
service-order-1  ----+
service-order-2  ----+
service-payment  ----+----> Redis primary
service-risk     ----+
scheduler        ----+
```

Implikasi penting:

1. Redis adalah shared mutable state.
2. Naming key harus punya ownership.
3. Command mahal dari satu service bisa memengaruhi service lain.
4. Memory leak key dari satu bounded context bisa membuat bounded context lain terkena eviction.
5. ACL dan namespace bukan detail ops kecil; itu boundary arsitektur.

Redis bukan milik satu method Java. Redis adalah shared infrastructure component.

---

## 4. Keyspace: Database Logis Redis

Redis menyimpan data dalam keyspace.

Secara sederhana:

```text
key -> value
```

Tetapi value Redis bukan hanya string. Value punya type Redis:

```text
user:123:name       -> String
user:123:profile    -> Hash
tenant:9:features   -> Set
rank:daily          -> Sorted Set
queue:email         -> List
stream:payment      -> Stream
```

Keyspace adalah ruang nama global di dalam Redis database/cluster.

Contoh buruk:

```text
user
session
cache
lock
state
```

Contoh lebih baik:

```text
svc:identity:user:123:profile
svc:identity:user:123:session:abc
svc:billing:invoice:9981:cache
svc:risk:tenant:42:rate-limit:login:2026-06-20T10
lock:svc:settlement:batch:2026-06-20
idempotency:svc:payment:v1:request:9d1e...
```

Key Redis harus menjawab:

1. Siapa owner-nya?
2. Entity apa yang direpresentasikan?
3. Apa lifecycle-nya?
4. Apakah punya TTL?
5. Apakah aman dihapus?
6. Apakah bisa direkonstruksi?
7. Apakah value-nya kecil atau besar?
8. Apakah key ini akan menjadi hot key?
9. Apakah key ini akan dipakai dalam Redis Cluster?
10. Apakah key ini punya konsekuensi compliance/audit?

Top 1% Redis engineer tidak hanya bertanya “apa key name-nya?”, tetapi “apa kontrak key ini dalam sistem?”.

---

## 5. Redis Command Model

Redis diekspos melalui command.

Command adalah unit interaksi utama.

Contoh command sederhana:

```redis
SET counter 1
GET counter
INCR counter
DEL counter
```

Command untuk data structure:

```redis
HSET user:123 name "Ayu" status "ACTIVE"
HGET user:123 status
SADD tenant:42:enabled-features reports audit-export
ZADD job:schedule 1780000000000 job:991
XADD payment:events * type captured paymentId pmt_123
```

Command punya beberapa karakteristik:

1. Nama command.
2. Argumen.
3. Key yang disentuh.
4. Time complexity.
5. Return type.
6. ACL category.
7. Cluster behavior.
8. Blocking/non-blocking behavior.
9. Memory effect.
10. Persistence/replication propagation behavior.

Command Redis bukan semua O(1). Banyak command cepat, tetapi tidak semua command aman untuk semua cardinality.

Contoh:

```redis
GET key
```

Biasanya O(1) terhadap lookup key, tetapi response time tetap dipengaruhi ukuran value yang dikirim balik.

```redis
SMEMBERS huge:set
```

Bisa sangat mahal karena Redis harus mengembalikan semua member.

```redis
HGETALL huge:hash
```

Bisa mengirim payload besar dan memblokir command lain selama eksekusi.

```redis
KEYS *
```

Berbahaya di production karena melakukan scan seluruh keyspace secara blocking.

Redis official docs menyediakan time complexity di setiap command. Ini bukan dekorasi dokumentasi; itu input desain.

---

## 6. Request-Response Model

Mayoritas command Redis mengikuti model request-response:

```text
client sends command
server sends response
```

Contoh:

```redis
GET user:123:name
```

Response:

```text
"Ayu"
```

Dari perspektif Java service:

```java
String name = redis.get("user:123:name");
```

Tetapi secara sistem:

```text
Thread Java
  -> Redis client library
  -> encode command
  -> socket write
  -> Redis receives command
  -> command waits behind earlier commands if any
  -> Redis executes command
  -> Redis writes response
  -> socket read
  -> client decodes response
  -> Java thread continues
```

Konsekuensi:

- 100 command kecil secara sequential bisa lebih lambat daripada 1 command bulk atau pipeline.
- Banyak remote call kecil adalah anti-pattern umum.
- Redis cepat di server-side, tetapi aplikasi bisa lambat karena round trip.
- Latency Redis harus dipikirkan end-to-end, bukan hanya command execution time.

---

## 7. RESP: Redis Serialization Protocol secara Mental Model

Redis memakai protocol sendiri bernama RESP. Kita tidak perlu menghafal byte-level protocol di awal, tetapi penting memahami bahwa command Redis dikirim sebagai data terstruktur lewat TCP.

Secara konseptual:

```redis
SET user:123:name Ayu
```

Akan dikirim sebagai array command:

```text
["SET", "user:123:name", "Ayu"]
```

Kenapa ini penting untuk Java engineer?

Karena Redis client melakukan beberapa pekerjaan:

1. Encode command.
2. Decode response.
3. Manage connection.
4. Handle reconnect.
5. Handle timeout.
6. Handle cluster redirect.
7. Potentially multiplex async commands.
8. Potentially pool connections.
9. Serialize Java object ke bytes/string.
10. Deserialize Redis response ke Java object.

Saat terjadi masalah, akar masalah belum tentu Redis server. Bisa jadi:

- serializer lambat,
- connection pool habis,
- event loop client tersumbat,
- DNS problem,
- TLS overhead,
- payload terlalu besar,
- timeout terlalu pendek,
- retry memperparah beban,
- blocking command berbagi connection dengan command biasa.

---

## 8. Redis Event Loop dan Mostly Single-Threaded Execution

Redis terkenal sebagai sistem yang “single-threaded”. Pernyataan ini sering disederhanakan terlalu jauh.

Mental model yang lebih tepat:

```text
Redis primarily executes commands sequentially on a main thread/event loop,
while some background work and I/O-related tasks may use additional threads depending on version/configuration.
```

Redis menggunakan desain mostly single-threaded untuk command processing. Dokumentasi Redis menjelaskan bahwa Redis melayani request client secara berurutan pada satu proses/main execution path menggunakan multiplexing; karena itu satu command yang lama dapat menunda command lain. Redis juga memiliki tooling seperti Slow Log dan Latency Monitor untuk mendiagnosis command atau event yang menyebabkan latency spike. Referensi: Redis latency documentation, Slow Log documentation, dan latency doctor command documentation.  

Sederhananya:

```text
Connection A command 1  ---> queued/executed
Connection B command 1  ---> queued/executed
Connection A command 2  ---> queued/executed
Connection C command 1  ---> queued/executed
```

Redis tidak menjalankan banyak command mutating terhadap keyspace secara paralel seperti database multi-threaded tradisional.

Ini memberi keuntungan:

1. Tidak ada lock contention internal untuk mayoritas command.
2. Banyak command menjadi atomic secara natural.
3. Mental model data race lebih sederhana.
4. Latency bisa sangat rendah untuk command kecil.
5. Implementation data structure bisa sangat efisien.

Tetapi ada biaya:

1. Satu command mahal bisa menahan command lain.
2. Long-running Lua script bisa memblokir server.
3. Large response bisa membuat tail latency naik.
4. Big key operation berbahaya.
5. Redis instance punya batas CPU single-core untuk command path utama.
6. Horizontal scaling sering membutuhkan sharding/cluster, bukan sekadar menambah thread.

---

## 9. Analogi: Kasir Super Cepat Tapi Hanya Satu Loket

Bayangkan Redis seperti kasir yang sangat cepat.

Kasir bisa memproses transaksi kecil dalam mikrodetik. Tetapi hanya ada satu loket utama untuk memproses transaksi.

Jika antrean berisi transaksi kecil:

```text
GET a
INCR b
HGET c field
SET d value
```

Semua lancar.

Tetapi jika satu orang membawa dokumen ribuan halaman:

```text
HGETALL huge:hash
```

atau meminta kasir menghitung seluruh gudang:

```text
KEYS *
```

maka semua orang di belakangnya menunggu.

Redis cepat bukan karena semua hal diparalelkan. Redis cepat karena:

- data berada di memory,
- command kecil,
- event loop sederhana,
- struktur data efisien,
- tidak banyak context switching,
- tidak banyak locking,
- protocol sederhana,
- workload cocok.

Jika workload tidak cocok, Redis bisa menjadi bottleneck yang sangat tajam.

---

## 10. Atomicity per Command

Karena command Redis dieksekusi secara sequential pada command path utama, command individual bersifat atomic terhadap command lain.

Contoh:

```redis
INCR counter
```

Jika 100 client menjalankan `INCR counter` bersamaan, Redis tidak akan mengalami lost update seperti ini:

```text
client A reads 10
client B reads 10
client A writes 11
client B writes 11
```

Redis memproses:

```text
INCR -> 11
INCR -> 12
INCR -> 13
...
```

Ini sangat berguna untuk:

- counters,
- rate limiting,
- sequence generation,
- simple state transition,
- idempotency claim dengan `SET NX`,
- lock acquisition dengan `SET NX PX`.

Tetapi atomicity per command tidak berarti semua operasi aplikasi otomatis atomic.

Contoh salah:

```java
String current = redis.get("balance:user:123");
int next = Integer.parseInt(current) - 100;
redis.set("balance:user:123", String.valueOf(next));
```

Ini bukan atomic di level operasi aplikasi karena terdiri dari dua command:

```text
GET
SET
```

Di antara `GET` dan `SET`, client lain bisa memodifikasi key yang sama.

Untuk multi-step atomic logic, Redis menyediakan beberapa opsi:

1. Gunakan command atomic bawaan jika ada, misalnya `INCRBY`.
2. Gunakan Lua script.
3. Gunakan Redis Functions.
4. Gunakan `WATCH` + `MULTI/EXEC` untuk optimistic concurrency.
5. Pindahkan invariant ke database transaksional jika memang membutuhkan transaksi kuat.

---

## 11. Atomic Command vs Transaction vs Consistency

Redis command atomic tidak sama dengan database transaction ACID penuh.

Perbedaan penting:

| Aspek | Redis Command Atomic | Redis Transaction | SQL Transaction |
|---|---:|---:|---:|
| Unit dasar | Satu command | Sekelompok command | Sekelompok statement |
| Eksekusi terinterleaving? | Tidak untuk satu command | Tidak saat `EXEC` menjalankan queue | Bergantung isolation level |
| Rollback otomatis? | Tidak relevan | Tidak seperti SQL rollback | Ya, umumnya ada rollback |
| Constraint relational | Tidak | Tidak | Ada |
| Multi-row invariant | Manual | Manual | Native |
| Cross-key cluster | Terbatas | Terbatas | Bergantung DB |
| Cocok untuk | primitive atomic ringan | batch atomic sederhana | invariant data kuat |

Redis transaction dengan `MULTI/EXEC` akan kita bahas detail di Part 026. Untuk sekarang, cukup pahami:

> Jangan memindahkan invariant bisnis kritis ke Redis hanya karena command Redis atomic.

Atomicity Redis sangat berguna, tetapi lingkupnya harus jelas.

---

## 12. Command Queue: Kenapa Command Cepat Bisa Tetap Lambat

Bayangkan command Redis Anda sendiri hanya butuh 50 mikrodetik di server.

Tetapi response aplikasi bisa 40 ms.

Kenapa?

Karena latency end-to-end adalah gabungan:

```text
client-side wait
+ network send
+ server queue wait
+ command execution
+ response serialization
+ network receive
+ client decode
+ application scheduling
```

Redis Slow Log hanya mengukur execution time command di server, bukan seluruh round trip. Dokumentasi Redis Slow Log menekankan bahwa slowlog mencatat waktu eksekusi command, tidak termasuk I/O dengan client.

Artinya:

- Slow Log kosong tidak berarti aplikasi tidak bisa mengalami Redis latency tinggi.
- Bisa saja masalahnya network, client pool, TLS, payload, atau event loop client.
- Latency observability harus mencakup client-side metric.

Contoh failure:

```text
Redis server command time p99: 0.4 ms
Java service Redis call p99: 85 ms
```

Kemungkinan:

- connection pool exhausted,
- blocked Netty event loop,
- pod network congestion,
- Redis client reconnecting,
- DNS/TLS issue,
- large payload deserialize,
- GC pause di Java process,
- retry storm.

Senior engineer tidak langsung menyalahkan Redis server. Ia memecah latency path.

---

## 13. Time Complexity Harus Dibaca Seperti Kontrak

Setiap command Redis punya time complexity.

Contoh konseptual:

```redis
GET key
```

O(1)

```redis
LRANGE list 0 -1
```

O(N) terhadap jumlah elemen yang dikembalikan.

```redis
SMEMBERS set
```

O(N) terhadap ukuran set.

```redis
HGETALL hash
```

O(N) terhadap jumlah field.

```redis
ZADD zset score member
```

O(log N)

Time complexity bukan sekadar teori algoritma. Dalam Redis, O(N) berarti:

1. main command path sibuk lebih lama,
2. command lain menunggu,
3. response payload bisa besar,
4. memory allocation bisa naik,
5. network buffer bisa membesar,
6. tail latency service lain bisa ikut naik.

Karena Redis sering shared, command O(N) di satu service bisa menjadi incident semua service.

---

## 14. Blocking Command: Tidak Semua “Blocking” Itu Salah

Redis memiliki blocking command seperti:

```redis
BLPOP queue 0
BRPOP queue 0
XREAD BLOCK 5000 STREAMS mystream $
```

Blocking command berguna untuk worker yang menunggu data.

Tetapi perlu disiplin:

1. Jangan campur blocking command dan command biasa pada connection yang sama jika client library tidak mengisolasinya dengan benar.
2. Gunakan dedicated connection untuk blocking workloads.
3. Gunakan timeout, jangan selalu infinite block tanpa operational reasoning.
4. Pahami behavior saat reconnect.
5. Pahami efek shutdown aplikasi.
6. Jangan bangun job processing serius tanpa recovery model.

Contoh buruk:

```text
Same Redis connection:
- BLPOP queue 0
- GET cache:user:123
```

Jika connection sedang blocked, command lain bisa ikut tertahan tergantung client behavior.

Di Java, ini relevan karena client seperti Lettuce/Jedis punya model koneksi berbeda. Kita akan bahas detail di Part 025.

---

## 15. Redis Cepat Karena Workload-nya Cocok

Redis biasanya cepat untuk workload seperti:

- small key lookup,
- small counter update,
- small hash field access,
- bounded sorted set range,
- atomic claim,
- short TTL cache,
- rate limiter command/script kecil,
- idempotency key lookup,
- session token lookup,
- membership check,
- presence state.

Redis buruk untuk workload seperti:

- object raksasa,
- scan seluruh data sering,
- analytical query,
- ad-hoc filtering kompleks tanpa index/search design,
- relational invariant,
- long transaction,
- large fanout write tanpa desain,
- unbounded queue tanpa retention,
- audit log utama,
- primary system of record tanpa durability analysis,
- cross-key operation besar di cluster.

Redis bukan “fast database for everything”. Redis adalah “fast system when the access pattern fits the data structure and operational model”.

---

## 16. Network Round Trip: Bottleneck yang Sering Diremehkan Java Engineer

Misalkan latency round trip antara Java service dan Redis adalah 0.5 ms.

Jika Anda melakukan 100 command sequential:

```java
for (String id : ids) {
    redis.get("product:" + id);
}
```

Minimal latency karena round trip saja:

```text
100 * 0.5 ms = 50 ms
```

Padahal command `GET` di Redis mungkin hanya mikrodetik.

Solusi bisa berupa:

1. `MGET` jika command dan key design memungkinkan.
2. Pipelining.
3. Batching di application layer.
4. Data modeling ulang.
5. Local cache untuk hot immutable data.
6. Avoid remote call in tight loop.

Contoh lebih baik:

```redis
MGET product:1 product:2 product:3 product:4
```

Atau pipeline:

```text
send GET product:1
send GET product:2
send GET product:3
send GET product:4
read responses later
```

Pipelining mengurangi biaya round trip karena banyak command dikirim tanpa menunggu response satu per satu. Dokumentasi Redis/pustaka client umumnya menjelaskan pipeline sebagai cara meningkatkan performa dengan mengurangi bolak-balik TCP request-response.

Namun pipelining juga punya trade-off:

- response buffering,
- memory pressure,
- fairness,
- error handling lebih kompleks,
- command tetap dieksekusi Redis satu per satu,
- tidak otomatis atomic.

Pipelining bukan transaksi. Pipelining adalah transport optimization.

---

## 17. Pipelining vs Transaction vs Lua

Tiga konsep ini sering tertukar.

| Mekanisme | Tujuan | Atomic? | Mengurangi RTT? | Cocok untuk |
|---|---|---:|---:|---|
| Pipeline | Network efficiency | Tidak | Ya | banyak command independent |
| MULTI/EXEC | Queue commands lalu execute sebagai batch atomic-ish | Ya untuk eksekusi batch, tanpa rollback SQL | Bisa, tergantung client | update sederhana multi-command |
| Lua Script | Server-side atomic multi-step logic | Ya | Ya | check-and-set, rate limiter, lock release |

Contoh pipeline:

```text
GET user:1
GET user:2
GET user:3
```

Tujuan: cepat karena tidak menunggu satu per satu.

Contoh transaction:

```redis
MULTI
INCR counter
EXPIRE counter 60
EXEC
```

Tujuan: command dikirim sebagai batch yang dieksekusi tanpa interleaving saat `EXEC`.

Contoh Lua:

```lua
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0
```

Tujuan: logika check-then-set dijalankan di server secara atomic.

---

## 18. Key Ownership: Fondasi Operasional

Di banyak organisasi, Redis incident bukan karena Redis jelek, tetapi karena tidak ada ownership key.

Contoh key kacau:

```text
cache:123
user:123
lock:job
state:abc
```

Masalah:

- tidak tahu service mana pemilik key,
- tidak tahu aman dihapus atau tidak,
- tidak tahu TTL expected,
- tidak tahu value format,
- tidak tahu cardinality,
- tidak tahu apakah key dipakai dalam cluster multi-key command,
- tidak tahu siapa yang harus di-page saat key meledak.

Template key contract yang lebih baik:

```text
Key Pattern      : svc:<service>:<domain>:<entity-id>:<purpose>
Owner            : service/team
Type             : Redis String/Hash/Set/etc
Value Format     : JSON v1/String/Integer/etc
TTL              : required/optional/none + reason
Cardinality      : expected number of keys
Value Size       : expected p50/p99
Access Pattern   : read-heavy/write-heavy/hot-key risk
Reconstructable  : yes/no/from where
Cluster Safe     : yes/no/hash tag design
Deletion Policy  : who can delete/when
Monitoring       : metric/alert
```

Contoh:

```text
Key Pattern      : svc:payment:idempotency:v1:{tenantId}:request:<hash>
Owner            : payment-platform
Type             : Hash
Value Format     : status/result metadata fields
TTL              : 24 hours, matches API idempotency guarantee
Cardinality      : max requests per tenant per 24h
Value Size       : small, < 2 KB expected
Access Pattern   : write-once/read-on-retry
Reconstructable  : partially, from payment DB and API logs
Cluster Safe     : hash tag on tenantId if tenant-scoped scripts needed
Deletion Policy  : TTL only
Monitoring       : key count, memory, command latency, error rate
```

Ini level arsitektur, bukan sekadar naming convention.

---

## 19. Redis Database Number: Jangan Terlalu Bergantung pada Logical DB

Redis memiliki konsep logical database index di deployment non-cluster, biasanya database `0`, `1`, dst.

Command:

```redis
SELECT 0
SELECT 1
```

Namun dalam Redis Cluster, database selection tidak digunakan seperti standalone Redis. Cluster menggunakan satu keyspace per cluster dengan hash slot distribution.

Praktik modern:

- jangan mengandalkan database number untuk boundary arsitektur,
- gunakan namespace key yang eksplisit,
- gunakan deployment terpisah untuk bounded context kritis jika perlu,
- gunakan ACL untuk membatasi command/key pattern,
- desain sejak awal agar kompatibel dengan cluster jika skala berpotensi naik.

Logical DB bukan pengganti tenancy, ownership, atau security model.

---

## 20. Redis Command Atomicity dan Java Threading

Java engineer sering mengira problem concurrency hilang karena Redis atomic.

Sebagian benar, sebagian salah.

Benar:

```java
redis.incr("counter");
```

Aman dari lost update di Redis.

Salah:

```java
String status = redis.get("order:123:status");
if ("PENDING".equals(status)) {
    redis.set("order:123:status", "APPROVED");
}
```

Ini race-prone karena check dan set terpisah.

Benar menggunakan Lua/transaction/atomic command:

```lua
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0
```

Mental model:

```text
Redis protects atomicity inside one command/script.
Redis does not protect arbitrary Java control flow around multiple Redis calls.
```

---

## 21. Command Granularity: Tempat Invariant Tinggal

Dalam desain sistem, Anda harus memutuskan di mana invariant dijaga.

Contoh invariant:

> User hanya boleh melakukan 5 request per menit.

Redis cocok karena invariant dapat dimodelkan sebagai atomic counter/window kecil.

Contoh invariant:

> Invoice tidak boleh marked paid kecuali payment settlement valid, ledger entry created, tax journal updated, dan audit record persisted.

Redis tidak cocok sebagai penjaga utama invariant. Ini domain transaksi database/workflow system, bukan Redis primitive.

Redis dapat membantu:

- rate limit,
- deduplication,
- lock/lease,
- cache read model,
- transient state,
- async coordination.

Tetapi Redis tidak boleh diam-diam menjadi system of record untuk invariant bisnis berat hanya karena mudah dan cepat.

---

## 22. Latency Discipline: Redis Call Harus Terlihat dalam Desain API

Contoh endpoint Java:

```text
GET /dashboard
```

Di dalamnya:

```text
- get user session from Redis
- get feature flags from Redis
- get 20 product summaries from Redis one by one
- get 10 quota counters from Redis one by one
- update access counter Redis
```

Secara kode tampak ringan. Secara runtime mungkin 32 Redis calls.

Jika sequential:

```text
32 round trips
```

Jika p99 Redis client call 3 ms:

```text
96 ms hanya untuk Redis path
```

Sebelum optimasi database, mungkin bottleneck Anda adalah Redis call granularity.

Checklist desain API:

1. Berapa Redis call per request?
2. Berapa yang sequential?
3. Bisa digabung dengan `MGET`/pipeline?
4. Apakah ada command O(N)?
5. Apakah ada large value?
6. Apakah endpoint bisa survive Redis down?
7. Apakah timeout Redis lebih kecil dari API timeout?
8. Apakah retry Redis bisa memperparah overload?
9. Apakah fallback menyebabkan DB stampede?
10. Apakah metrics membedakan cache hit/miss/error/timeout?

---

## 23. Timeout: Redis Cepat Bukan Alasan Timeout Longgar

Kesalahan umum:

```yaml
redis.timeout: 30s
```

Untuk cache read di API latency-sensitive, timeout 30 detik hampir pasti salah. Jika Redis lambat/down, request thread menunggu terlalu lama, thread pool habis, service ikut collapse.

Redis dependency harus punya timeout sesuai use case.

Contoh prinsip:

| Use Case | Timeout Bias |
|---|---:|
| cache read optional | sangat pendek |
| session read mandatory | pendek tapi realistis |
| idempotency claim | pendek, failure explicit |
| rate limiter | pendek, fail-open/fail-closed decision jelas |
| background worker blocking read | berbeda, dedicated connection |
| admin migration | bisa lebih panjang, isolated |

Timeout bukan angka teknis semata. Timeout adalah policy kegagalan.

Pertanyaan penting:

> Kalau Redis tidak menjawab dalam X ms, apa keputusan bisnis sistem?

- reject request?
- allow request?
- fallback ke DB?
- return degraded response?
- enqueue retry?
- open circuit?

Tidak ada jawaban universal.

---

## 24. Retry: Bisa Menyelamatkan, Bisa Menghancurkan

Redis operation sering dianggap idempotent, tetapi tidak selalu.

Contoh aman relatif:

```redis
GET key
```

Retry `GET` biasanya aman.

Contoh berbahaya:

```redis
INCR counter
```

Jika client timeout setelah Redis sebenarnya berhasil menjalankan `INCR`, retry bisa menggandakan increment.

Contoh:

```text
client sends INCR
Redis executes INCR -> counter 11
network issue before response
client times out
client retries INCR
Redis executes INCR -> counter 12
```

Dari sisi client, ia hanya “ingin satu increment”. Dari sisi Redis, dua command diterima.

Retry harus mempertimbangkan:

1. Apakah command idempotent?
2. Apakah ada request ID?
3. Apakah command mutating?
4. Apakah timeout terjadi sebelum atau sesudah server execute?
5. Apakah retry bisa memperbesar load saat Redis sedang overload?
6. Apakah circuit breaker perlu?

Top engineer tidak menyalakan retry otomatis untuk semua Redis command tanpa klasifikasi.

---

## 25. Redis sebagai Shared Bottleneck

Dalam microservices, Redis sering dipakai lintas service:

```text
identity service: session
payment service: idempotency
risk service: rate limit
notification service: queue
api gateway: quota
feature service: flags
```

Jika semuanya memakai satu Redis deployment, maka Redis menjadi shared bottleneck dan shared blast radius.

Masalah satu service:

```redis
KEYS *
HGETALL giant:hash
SMEMBERS huge:set
large pipeline 1M commands
infinite key creation
```

bisa menyebabkan:

- latency session service naik,
- rate limiter timeout,
- API gateway degrade,
- worker backlog,
- memory eviction,
- failover,
- cascading failure.

Solusi arsitektur:

1. Pisahkan Redis berdasarkan criticality.
2. Pisahkan cache volatile dari coordination critical.
3. Gunakan ACL/key pattern restriction.
4. Gunakan observability per command/per client.
5. Tetapkan maxmemory policy sesuai use case.
6. Audit command berbahaya.
7. Batasi payload dan cardinality.
8. Jangan shared Redis tanpa governance.

---

## 26. Redis dan Backpressure

Redis yang cepat bisa membuat developer lupa backpressure.

Contoh queue dengan List:

```redis
LPUSH queue:email <job>
BRPOP queue:email 0
```

Jika producer lebih cepat daripada consumer, Redis memory naik.

Redis tidak otomatis menyelesaikan:

- unbounded queue,
- poison message,
- retry delay,
- dead-letter queue,
- consumer lag visibility,
- per-tenant fairness,
- payload bloat,
- durability requirement.

Redis hanya menyediakan primitive. Backpressure adalah desain sistem.

Dalam Java service, Anda perlu menentukan:

1. Berapa max queue depth?
2. Apa yang terjadi saat queue penuh?
3. Apakah producer ditolak?
4. Apakah job diprioritaskan?
5. Apakah payload disimpan di Redis atau hanya pointer?
6. Bagaimana worker crash dipulihkan?
7. Bagaimana mengukur lag?
8. Bagaimana menghindari Redis memory exhaustion?

---

## 27. Redis Client Matters: Lettuce, Jedis, Spring Data Redis

Redis client bukan detail kecil.

Java ecosystem umum:

1. Lettuce.
2. Jedis.
3. Spring Data Redis.
4. Redisson.

Part 025 akan membahas detail, tetapi mental model awal:

- client mengelola koneksi,
- client menentukan sync/async/reactive behavior,
- client menentukan pooling/multiplexing,
- client melakukan serialization,
- client menangani topology Redis Cluster,
- client menangani reconnect,
- client berinteraksi dengan thread model Java.

Kesalahan umum:

```text
Redis lambat
```

Padahal sebenarnya:

```text
connection pool exhausted
```

atau:

```text
serializer JSON lambat
```

atau:

```text
blocking command memakai shared connection
```

atau:

```text
reactive pipeline blocked oleh kode blocking
```

Saat debugging Redis dari Java, selalu pisahkan:

```text
application latency
client library latency
network latency
server queue latency
command execution latency
response payload latency
deserialization latency
```

---

## 28. Server-Side vs Client-Side Bottleneck

Gejala yang sama bisa punya penyebab berbeda.

### Kasus A: Server-side bottleneck

Tanda:

- Redis CPU tinggi,
- slowlog berisi command mahal,
- latency doctor menunjukkan spike,
- commandstats menunjukkan command tertentu dominan,
- big key ditemukan,
- memory fragmentation tinggi,
- fork/persistence spike.

Kemungkinan:

- command O(N),
- big key,
- large Lua script,
- high write load,
- persistence fork overhead,
- eviction storm.

### Kasus B: Client-side bottleneck

Tanda:

- Redis CPU rendah,
- slowlog kosong,
- server metrics normal,
- aplikasi tetap timeout.

Kemungkinan:

- connection pool habis,
- DNS/network issue,
- TLS handshake/reconnect,
- Java GC pause,
- Netty event loop blocked,
- deserialization lambat,
- too many sequential calls,
- bad retry policy.

### Kasus C: Network/payload bottleneck

Tanda:

- command execution kecil,
- response besar,
- bandwidth tinggi,
- client decode lambat.

Kemungkinan:

- `HGETALL` huge hash,
- `SMEMBERS` huge set,
- giant cached JSON,
- large pipeline response.

Redis observability harus multi-layer.

---

## 29. Redis CLI sebagai Microscope

Redis CLI penting untuk belajar dan debugging.

Command dasar:

```bash
redis-cli PING
redis-cli INFO
redis-cli DBSIZE
redis-cli MEMORY STATS
redis-cli SLOWLOG GET 10
redis-cli LATENCY DOCTOR
```

Interaktif:

```bash
redis-cli
```

Lalu:

```redis
PING
SET hello world
GET hello
DEL hello
```

Namun Redis CLI juga bisa berbahaya di production.

Jangan sembarangan:

```redis
KEYS *
FLUSHALL
CONFIG SET ...
EVAL ...
MONITOR
```

`MONITOR` misalnya bisa sangat mahal karena streaming semua command. `KEYS *` bisa memblokir. `FLUSHALL` jelas destructive.

CLI adalah alat bedah, bukan mainan production.

---

## 30. Local Lab Environment

Untuk seri ini, kita akan memakai Docker Compose sederhana.

Buat file:

```yaml
# docker-compose.redis.yml
services:
  redis:
    image: redis:8
    container_name: redis-mastery
    ports:
      - "6379:6379"
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

Jalankan:

```bash
docker compose -f docker-compose.redis.yml up -d
```

Test:

```bash
redis-cli PING
```

Expected:

```text
PONG
```

Masuk CLI:

```bash
redis-cli
```

Coba:

```redis
SET course redis
GET course
INCR counter
INCR counter
TTL course
EXPIRE course 60
TTL course
```

Stop:

```bash
docker compose -f docker-compose.redis.yml down
```

Hapus data:

```bash
docker compose -f docker-compose.redis.yml down -v
```

Catatan:

- `redis:8` dipakai agar lab mengikuti Redis modern.
- `appendonly yes` mengaktifkan AOF untuk lab persistence awal.
- Detail persistence akan dibahas di Part 020.

---

## 31. Minimal Java Lab dengan Lettuce

Contoh minimal Maven dependency:

```xml
<dependency>
    <groupId>io.lettuce</groupId>
    <artifactId>lettuce-core</artifactId>
    <version>6.5.5.RELEASE</version>
</dependency>
```

Catatan: versi dependency bisa berubah. Pada project nyata, cek versi terbaru melalui Maven Central atau dependency management Spring Boot.

Contoh kode:

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

public class RedisHello {
    public static void main(String[] args) {
        RedisClient client = RedisClient.create("redis://localhost:6379");

        try (StatefulRedisConnection<String, String> connection = client.connect()) {
            RedisCommands<String, String> redis = connection.sync();

            redis.set("course", "redis-mastery");
            String value = redis.get("course");

            Long counter = redis.incr("counter");

            System.out.println("course=" + value);
            System.out.println("counter=" + counter);
        } finally {
            client.shutdown();
        }
    }
}
```

Yang perlu diamati:

1. `RedisClient` bukan command object; ia mengelola client resources.
2. `connection` adalah koneksi stateful ke Redis.
3. `sync()` memberi API synchronous.
4. Setiap command tetap remote call.
5. `incr` atomic di Redis server.
6. Connection lifecycle harus jelas.

Untuk Spring Boot, kita akan bahas nanti agar tidak terlalu cepat masuk abstraction sebelum mental model kuat.

---

## 32. Latihan 1: Rasakan Remote Call Cost

Tujuan: membedakan local map operation vs Redis remote operation.

Eksperimen konseptual:

```java
Map<String, String> map = new HashMap<>();
map.put("k", "v");

long start = System.nanoTime();
for (int i = 0; i < 10_000; i++) {
    map.get("k");
}
long elapsed = System.nanoTime() - start;
System.out.println(elapsed);
```

Bandingkan dengan:

```java
long start = System.nanoTime();
for (int i = 0; i < 10_000; i++) {
    redis.get("k");
}
long elapsed = System.nanoTime() - start;
System.out.println(elapsed);
```

Redis akan jauh lebih lambat dibanding local map untuk operasi trivial, karena Redis adalah remote system.

Tetapi Redis memberi kemampuan yang local map tidak beri:

- shared across instances,
- TTL,
- atomic counter,
- data structure server,
- persistence optional,
- replication,
- centralized coordination,
- eviction policy,
- cross-process visibility.

Kesimpulan:

> Redis bukan dipakai karena lebih cepat dari local memory. Redis dipakai karena lebih cepat daripada database/disk/network-heavy system untuk shared state tertentu, sambil memberi primitive yang local memory tidak punya.

---

## 33. Latihan 2: Rasakan Atomicity `INCR`

Jalankan di dua terminal:

Terminal 1:

```bash
for i in {1..1000}; do redis-cli INCR atomic:counter > /dev/null; done
```

Terminal 2:

```bash
for i in {1..1000}; do redis-cli INCR atomic:counter > /dev/null; done
```

Cek:

```bash
redis-cli GET atomic:counter
```

Expected:

```text
2000
```

Ini memperlihatkan atomicity `INCR`.

Bandingkan dengan pola non-atomic di aplikasi:

```text
GET atomic:counter
calculate +1 in client
SET atomic:counter newValue
```

Pola itu bisa lost update jika dilakukan concurrent.

---

## 34. Latihan 3: Rasakan Bahaya Command O(N)

Buat banyak key kecil:

```bash
for i in {1..100000}; do redis-cli SET test:key:$i $i > /dev/null; done
```

Jangan biasakan ini di production, tapi untuk lab lokal boleh.

Coba:

```bash
redis-cli DBSIZE
```

Lalu coba:

```bash
redis-cli --latency
```

Di terminal lain, jalankan:

```bash
redis-cli KEYS 'test:key:*' > /dev/null
```

Amati potensi latency spike.

Alternatif lebih aman untuk production scanning:

```redis
SCAN 0 MATCH test:key:* COUNT 100
```

Perbedaan mental model:

- `KEYS` mencoba menemukan semua key matching secara blocking.
- `SCAN` melakukan incremental iteration.

`SCAN` bukan gratis, tetapi jauh lebih aman untuk keyspace besar jika digunakan benar.

---

## 35. Latihan 4: Sequential GET vs MGET

Buat data:

```bash
for i in {1..1000}; do redis-cli SET product:$i "value-$i" > /dev/null; done
```

Sequential:

```bash
for i in {1..1000}; do redis-cli GET product:$i > /dev/null; done
```

Bulk:

```bash
redis-cli MGET $(seq -f "product:%.0f" 1 1000) > /dev/null
```

Pada mesin lokal, hasil bisa bervariasi, tetapi pola umumnya:

- banyak command sequential membayar banyak round trip,
- satu command bulk/pipeline mengurangi round trip,
- terlalu besar bulk response juga bisa bermasalah.

Tujuan latihan bukan angka benchmark absolut. Tujuannya membangun intuisi.

---

## 36. Latihan 5: Slowlog Dasar

Cek konfigurasi slowlog:

```redis
CONFIG GET slowlog-log-slower-than
CONFIG GET slowlog-max-len
```

Set threshold rendah untuk lab:

```redis
CONFIG SET slowlog-log-slower-than 0
```

Jalankan beberapa command:

```redis
SET a 1
GET a
INCR c
```

Lihat slowlog:

```redis
SLOWLOG GET 10
```

Reset konfigurasi jika perlu:

```redis
CONFIG SET slowlog-log-slower-than 10000
```

Catatan:

- Nilai threshold dalam mikrodetik.
- Jangan sembarangan ubah config production tanpa prosedur.
- Slowlog menunjukkan command execution time, bukan total client latency.

---

## 37. Anti-Pattern Utama pada Level Mental Model

### 37.1 Redis Dianggap Local Map

Gejala:

```java
for (Item item : items) {
    redis.get("item:" + item.id());
}
```

Masalah:

- terlalu banyak round trip,
- latency kumulatif,
- tidak ada batching,
- tidak ada timeout strategy.

Perbaikan:

- MGET,
- pipeline,
- data shape ulang,
- local cache untuk hot data,
- request-level aggregation.

---

### 37.2 Redis Dianggap SQL Database

Gejala:

- ingin query fleksibel tanpa desain index,
- ingin transaction invariant kompleks,
- ingin join,
- ingin audit history,
- ingin ad-hoc analytics.

Redis bukan SQL. Jika memakai Redis Search/JSON sekalipun, tetap perlu desain index dan operational memory model.

---

### 37.3 Redis Dianggap Message Broker Durable

Gejala:

- List dipakai sebagai queue utama tanpa DLQ,
- Pub/Sub dipakai untuk event penting,
- Stream dipakai seperti Kafka tanpa retention/consumer recovery design.

Redis punya primitives untuk messaging-ish use cases, tetapi durability dan replay semantics harus eksplisit.

---

### 37.4 Redis Dianggap Lock Manager Sempurna

Gejala:

```text
SET lock foo NX EX 60
```

lalu dianggap aman untuk semua distributed critical section.

Masalah:

- lease bisa expire,
- holder bisa pause karena GC,
- network partition,
- unlock bisa menghapus lock milik client lain jika token tidak dicek,
- fencing token sering dibutuhkan untuk resource eksternal.

Distributed lock akan dibahas detail di Part 013.

---

### 37.5 Redis Dianggap Tidak Perlu Observability

Gejala:

- tidak tahu cache hit ratio,
- tidak tahu Redis call count per endpoint,
- tidak tahu hot key,
- tidak tahu memory growth,
- tidak tahu command latency,
- tidak tahu timeout rate,
- tidak tahu eviction count.

Redis yang tidak terlihat akan menjadi incident yang sulit dijelaskan.

---

## 38. Redis Design Thinking: Pertanyaan Sebelum Menulis Command

Sebelum menambahkan Redis ke fitur, jawab:

1. Apa masalah sistem yang Redis selesaikan?
2. Apakah Redis menjadi source of truth atau derived state?
3. Jika Redis kehilangan data, apa dampaknya?
4. Apakah data bisa direkonstruksi?
5. Apa type Redis yang paling cocok?
6. Apa key pattern-nya?
7. Apa TTL-nya?
8. Apa expected cardinality?
9. Apa expected value size?
10. Apa read/write ratio?
11. Apakah ada hot key?
12. Apakah command yang digunakan O(1), O(log N), atau O(N)?
13. Apakah butuh atomic multi-step logic?
14. Apakah akan jalan di Redis Cluster?
15. Apa timeout policy?
16. Apa retry policy?
17. Apa fallback behavior?
18. Apa metrics dan alert-nya?
19. Siapa owner operasional key ini?
20. Bagaimana membersihkan data lama?

Jika pertanyaan ini tidak bisa dijawab, desain Redis belum matang.

---

## 39. Redis dalam Perspektif Java Backend Architecture

Dalam sistem Java modern, Redis sering muncul di beberapa layer:

```text
API Gateway
  - rate limit
  - token/session lookup
  - quota

Application Service
  - cache-aside
  - idempotency
  - workflow transient state
  - short-lived lock/lease

Worker
  - delay queue
  - stream consumer
  - deduplication

Platform
  - distributed feature flag cache
  - global config cache
  - presence state
```

Setiap layer punya failure policy berbeda.

Contoh:

| Layer | Redis Down Behavior |
|---|---|
| optional product cache | fallback DB, maybe degraded latency |
| API rate limiter | fail-open atau fail-closed sesuai risk |
| session store | user mungkin logout/error |
| idempotency store | duplicate risk, mungkin reject safer |
| distributed lock | stop critical job |
| queue | producer/consumer pause |

Tidak ada satu konfigurasi Redis client yang cocok untuk semua.

---

## 40. Failure Model Awal

Mari mulai membangun failure model.

Redis operation bisa gagal karena:

1. Redis server down.
2. Network partition.
3. DNS resolution issue.
4. TLS/auth failure.
5. Timeout.
6. Connection refused.
7. Connection reset.
8. Pool exhausted.
9. Cluster redirect loop.
10. MOVED/ASK handling bug/config issue.
11. Command rejected by ACL.
12. Command error karena wrong type.
13. OOM / maxmemory.
14. Eviction menyebabkan missing key.
15. Key expired.
16. Replica stale.
17. Failover sedang berlangsung.
18. Lua script error.
19. Serialization/deserialization error.
20. Java GC pause.

Setiap use case harus punya failure handling spesifik.

Contoh cache:

```text
Redis timeout -> fallback DB -> fill cache later
```

Contoh payment idempotency:

```text
Redis timeout during idempotency claim -> do not blindly process payment twice
```

Contoh rate limiter:

```text
Redis unavailable -> fail-open for low-risk endpoint, fail-closed for high-risk endpoint
```

Contoh lock:

```text
Redis unavailable -> do not enter critical section
```

Redis engineering adalah failure policy engineering.

---

## 41. Practical Java Coding Rules Setelah Part Ini

Sampai di sini, beberapa aturan praktis:

1. Jangan Redis call di loop tanpa sadar round trip.
2. Jangan gunakan command O(N) pada data unbounded.
3. Jangan simpan object besar tanpa size budget.
4. Jangan menganggap `GET` + `SET` sebagai atomic update.
5. Jangan retry mutating command tanpa idempotency reasoning.
6. Jangan share connection untuk blocking dan normal command tanpa memahami client behavior.
7. Jangan pakai Redis sebagai source of truth tanpa persistence/replication/recovery analysis.
8. Jangan desain key tanpa TTL/lifecycle/ownership.
9. Jangan abaikan client-side metrics.
10. Jangan menyalakan Redis di critical path tanpa fallback/timeout policy.

---

## 42. Mini Case Study: Cache yang Membunuh API

### Situasi

Service Java punya endpoint:

```text
GET /home
```

Endpoint membaca 50 item rekomendasi dari Redis:

```java
List<Product> products = new ArrayList<>();
for (String id : recommendationIds) {
    String json = redis.get("product:summary:" + id);
    products.add(objectMapper.readValue(json, Product.class));
}
```

### Gejala

- Redis CPU rendah.
- Slowlog kosong.
- API p99 tinggi.
- Thread pool API penuh.
- Database normal.

### Diagnosis

Masalah bukan Redis command execution. Masalahnya:

1. 50 sequential network round trips.
2. JSON deserialization 50 kali.
3. Tidak ada batching.
4. Timeout Redis terlalu besar.
5. Tidak ada fallback partial.

### Perbaikan

1. Gunakan `MGET` untuk 50 key.
2. Batasi jumlah item.
3. Gunakan payload summary yang lebih kecil.
4. Tambahkan cache hit/miss metric.
5. Gunakan timeout pendek.
6. Jika beberapa item miss, return partial atau fallback sesuai kebutuhan.
7. Pertimbangkan local cache untuk item sangat hot.

### Pelajaran

Redis server bisa sehat, tetapi desain aplikasi tetap buruk.

---

## 43. Mini Case Study: `KEYS *` Saat Jam Sibuk

### Situasi

Engineer ingin melihat jumlah key session:

```redis
KEYS session:*
```

### Gejala

- Redis latency spike.
- Semua service yang memakai Redis timeout.
- Session lookup gagal.
- API gateway error rate naik.

### Root Cause

`KEYS` melakukan scan blocking terhadap keyspace. Pada keyspace besar, command ini menahan event loop Redis.

### Perbaikan

1. Gunakan `SCAN` untuk inspeksi incremental.
2. Gunakan metrics/key counters sejak awal.
3. Batasi akses command dangerous via ACL.
4. Dokumentasikan runbook production.
5. Gunakan Redis Insight/observability tools dengan aman.

### Pelajaran

Satu command manual bisa menjadi incident jika mental model command execution salah.

---

## 44. Mini Case Study: `INCR` Retry Menggandakan Kuota

### Situasi

Rate limiter menggunakan:

```redis
INCR quota:user:123:minute:10
EXPIRE quota:user:123:minute:10 60
```

Client timeout setelah `INCR`, lalu retry.

### Gejala

- Beberapa user terkena rate limit lebih cepat.
- Counter lebih tinggi dari request aktual.

### Root Cause

`INCR` mutating dan tidak idempotent. Timeout tidak membuktikan command gagal. Command mungkin berhasil tetapi response hilang.

### Perbaikan

1. Gunakan Lua script untuk `INCR + EXPIRE` atomic.
2. Pertimbangkan request ID jika perlu idempotency kuat.
3. Atur retry policy berdasarkan command class.
4. Monitor timeout separately from Redis error.

### Pelajaran

Retry bukan obat universal. Untuk mutating command, retry adalah keputusan correctness.

---

## 45. Koneksi ke Part Berikutnya

Part 001 membentuk dasar eksekusi Redis:

- Redis adalah server stateful remote.
- Redis mengelola keyspace shared.
- Redis menerima command.
- Command dieksekusi mostly sequential.
- Atomicity berlaku pada command/script, bukan seluruh Java flow.
- Latency dipengaruhi round trip, queueing, payload, client, dan command cost.
- Key ownership adalah kontrak arsitektur.

Part 002 akan membahas:

```text
Redis Data Model: Keys, Values, Types, Encodings
```

Di sana kita akan masuk ke pertanyaan:

- apa sebenarnya value Redis,
- kenapa String/Hash/List/Set/ZSet bukan sekadar container biasa,
- kenapa internal encoding memengaruhi memory,
- kenapa key design menentukan cluster compatibility,
- kenapa type safety harus didesain di application layer.

---

## 46. Ringkasan Part 001

Redis harus dipahami sebagai sistem remote, bukan local map.

Core mental model:

```text
Client sends command over network.
Redis queues/parses/executes command against shared in-memory keyspace.
Most command execution is sequential on the main path.
Individual commands are atomic.
Multi-command application logic is not automatically atomic.
Latency is end-to-end, not only server execution.
```

Yang harus tertanam:

1. Redis cepat ketika command kecil dan access pattern cocok.
2. Redis bisa lambat atau berbahaya jika command mahal memblokir event loop.
3. Redis atomicity sangat berguna tetapi lingkupnya terbatas.
4. Redis call count per request adalah desain performa.
5. Pipelining mengurangi RTT tetapi bukan transaksi.
6. Keyspace adalah shared mutable state yang butuh ownership.
7. Timeout/retry/fallback adalah bagian dari correctness.
8. Observability harus mencakup client dan server.
9. Redis primitive harus dipilih berdasarkan invariant sistem, bukan karena mudah.

---

## 47. Checklist Pemahaman

Anda siap lanjut jika bisa menjawab tanpa menghafal:

1. Kenapa Redis tidak boleh dianggap `ConcurrentHashMap` remote?
2. Apa arti Redis mostly single-threaded untuk command execution?
3. Kenapa satu command O(N) bisa membuat command lain lambat?
4. Kenapa `INCR` atomic tetapi `GET` lalu `SET` tidak atomic?
5. Apa bedanya pipeline, transaction, dan Lua script?
6. Kenapa Slow Log kosong tidak membuktikan client latency rendah?
7. Kenapa retry `GET` lebih aman daripada retry `INCR`?
8. Apa risiko key tanpa owner?
9. Kenapa Redis timeout adalah policy bisnis, bukan angka teknis saja?
10. Kapan Redis cocok dan kapan tidak cocok sebagai state layer?

---

## 48. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk part ini:

1. Redis command documentation — untuk membaca command semantics dan time complexity.
2. Redis latency troubleshooting documentation — untuk memahami mostly single-threaded request processing dan latency diagnosis.
3. Redis Slow Log documentation — untuk memahami bahwa slowlog mengukur command execution time, bukan total network round trip.
4. Redis Latency Doctor documentation — untuk diagnosis latency event.
5. Redis transactions documentation — untuk memahami `MULTI`, `EXEC`, `WATCH`, dan batasan transaction model.
6. Redis pipelining documentation / client documentation — untuk memahami pengurangan round trip.
7. Lettuce documentation — untuk memahami Java client sync/async/reactive, connection behavior, dan production integration.

---

## 49. Status Seri

```text
Part 001 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-002.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Redis sebagai Sistem, Bukan Sekadar Cache</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-002.md">Part 002 — Redis Data Model: Keys, Values, Types, Encodings ➡️</a>
</div>
