# learn-redis-mastery-for-java-engineers-part-021.md

# Part 021 — Replication, Sentinel, Failover: Availability dengan Trade-Off

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `021 / 034`  
> Fokus: primary-replica replication, Sentinel, failover, stale read, lag, split brain, client behavior, Java service resilience  
> Prasyarat: Part 000–020, terutama event loop, TTL/eviction, cache consistency, Lua, Streams, dan persistence

---

## 0. Tujuan Bagian Ini

Setelah bagian ini, kamu harus bisa menjawab pertanyaan yang sering membuat desain Redis production menjadi rapuh:

1. Apa yang sebenarnya dijamin oleh Redis replication?
2. Apa yang tidak dijamin oleh Redis replication?
3. Apa beda durability, availability, dan consistency dalam konteks Redis?
4. Apa yang terjadi ketika primary mati?
5. Apa yang dilakukan Sentinel?
6. Apa yang tidak bisa diselesaikan Sentinel?
7. Kapan read dari replica aman?
8. Kapan read dari replica berbahaya?
9. Bagaimana Java client harus dikonfigurasi agar failover tidak berubah menjadi incident cascade?
10. Bagaimana menyusun failure-mode matrix untuk Redis HA?

Inti bagian ini:

> Redis replication meningkatkan availability dan read scalability, tetapi Redis Open Source replication pada dasarnya asynchronous. Karena itu, failover dapat menyebabkan stale read, kehilangan write yang belum tereplikasi, reconnect storm, dan perubahan topology yang harus dipahami client.

---

## 1. Redis Availability Bukan Satu Hal

Ketika engineer berkata “Redis harus high availability”, biasanya ada beberapa kebutuhan yang tercampur:

| Kebutuhan | Maksud | Redis Mechanism | Risiko |
|---|---|---|---|
| Data tetap ada setelah restart | durability | RDB/AOF | data loss window tergantung konfigurasi |
| Node primary mati tapi service tetap jalan | availability | replica + Sentinel / Cluster / managed failover | failover delay, write loss window |
| Beban read dibagi | read scaling | read replica | stale read |
| Client tahu primary baru | service discovery | Sentinel-aware / Cluster-aware client | reconnect storm, stale topology |
| Tidak ada write hilang | strong durability | tidak otomatis dijamin | perlu WAIT/min-replicas/AOF/DB lain |
| Tidak ada dua primary aktif | split-brain safety | quorum/fencing/network design | tetap perlu desain operasi |

Kesalahan umum: menganggap “punya replica” berarti semua kebutuhan di atas terpenuhi.

Replica hanya berarti ada proses Redis lain yang menerima salinan perubahan dari primary. Itu belum otomatis berarti:

- write pasti sudah aman;
- read pasti fresh;
- failover pasti instant;
- client pasti otomatis benar;
- tidak mungkin ada data loss;
- tidak mungkin ada dua pihak merasa dirinya primary.

---

## 2. Mental Model: Primary-Replica

Redis replication model dasar:

```text
Application
    |
    v
Redis Primary  --->  Redis Replica A
               --->  Redis Replica B
```

Default mental model:

1. Application menulis ke primary.
2. Primary mengeksekusi command.
3. Primary mengirim replication stream ke replica.
4. Replica menerapkan stream tersebut.
5. Replica biasanya read-only untuk mencegah divergensi.

Konsekuensi penting:

> Primary biasanya membalas write ke client tanpa menunggu semua replica selesai menerapkan write tersebut.

Artinya:

```text
Client SET k v
    |
    v
Primary executes SET
    |
    +--> reply OK to client
    |
    +--> replicate to replicas asynchronously
```

Window kecil tapi nyata:

```text
T1 primary accepts write
T2 primary replies OK
T3 primary crashes before replica receives/applies write
T4 replica promoted
T5 new primary does not contain write
```

Dari sisi client:

```text
SET order:123:status APPROVED -> OK
```

Dari sisi sistem setelah failover:

```text
GET order:123:status -> old value / missing
```

Ini bukan bug Redis. Ini konsekuensi consistency model.

---

## 3. Asynchronous Replication: Kenapa Penting?

Redis memilih asynchronous replication karena tujuan utamanya latency dan throughput. Menunggu semua replica sebelum membalas setiap write akan menaikkan latency dan membuat availability lebih rendah saat replica lambat.

Trade-off:

| Model | Latency | Availability | Write safety | Complexity |
|---|---:|---:|---:|---:|
| Async replication | rendah | tinggi | weaker | rendah-sedang |
| Semi-sync dengan WAIT | sedang | sedang | lebih baik, bukan absolut | sedang |
| Strong consensus DB | lebih tinggi | tergantung quorum | lebih kuat | tinggi |

Redis bukan consensus database. Jangan memodelkan Redis replica seperti Raft follower dengan commit index kuat.

---

## 4. Replication Lifecycle

Ada dua fase besar:

1. Initial synchronization.
2. Continuous replication.

### 4.1 Initial Synchronization

Ketika replica pertama kali connect ke primary, replica perlu mendapatkan dataset.

Secara konseptual:

```text
Replica connects to primary
Replica asks for sync
Primary creates/transfers snapshot or uses partial resync if possible
Replica loads data
Primary continues streaming new writes
Replica catches up
```

Operational implication:

- initial sync bisa berat;
- snapshot/fork dapat berdampak pada memory;
- network bandwidth bisa tinggi;
- replica yang terlalu sering reconnect dapat membebani primary;
- jangan menambahkan banyak replica besar saat traffic puncak tanpa perencanaan.

### 4.2 Continuous Replication

Setelah sinkron:

```text
Primary command stream -> replica apply stream
```

Jika replica tertinggal:

- replication lag meningkat;
- read dari replica makin stale;
- failover ke replica yang tertinggal berisiko kehilangan lebih banyak write;
- backlog mungkin tidak cukup untuk partial resync sehingga perlu full sync.

---

## 5. Read from Replica: Kapan Aman, Kapan Bahaya

Read dari replica sering dipakai untuk menurunkan load primary.

Namun replica read membawa masalah freshness.

### 5.1 Aman untuk Data yang Toleran Stale

Contoh relatif aman:

- product catalog cache;
- feature metadata yang jarang berubah;
- public profile snapshot;
- leaderboard eventual;
- analytics-ish counters;
- read-only recommendation cache;
- non-critical UI hints.

Kontraknya:

```text
Data may be stale for a short period.
Application must tolerate it.
```

### 5.2 Bahaya untuk Read-Your-Write

Contoh bahaya:

```text
POST /orders/123/approve
  writes status APPROVED to Redis primary

GET /orders/123
  reads from replica immediately
  sees PENDING
```

User melihat aksi gagal padahal write sukses.

Untuk flow yang butuh read-your-write:

- read dari primary;
- atau gunakan source of truth yang memberi consistency yang dibutuhkan;
- atau pakai session stickiness/topology rule;
- atau jangan jadikan Redis replica sebagai read source untuk state tersebut.

### 5.3 Bahaya untuk Enforcement

Jangan sembarangan read dari replica untuk enforcement:

- rate limit;
- quota;
- idempotency;
- lock ownership;
- fraud/risk decision;
- regulatory deadline state;
- workflow state transition guard.

Kenapa?

Karena stale read dapat membuat sistem mengambil keputusan salah:

```text
Replica belum menerima counter terbaru
Limiter mengizinkan request yang harusnya ditolak
```

Atau:

```text
Replica belum menerima idempotency completion state
Duplicate request diproses ulang
```

Rule:

> State yang dipakai untuk mengambil keputusan blocking/allowing harus dibaca dari tempat yang punya freshness sesuai kontrak keputusan tersebut.

---

## 6. Replication Lag

Replication lag adalah selisih antara state primary dan state replica.

Penyebab umum:

1. Network lambat.
2. Replica CPU lambat.
3. Replica melakukan load snapshot.
4. Command berat di primary menghasilkan stream besar.
5. Big value update.
6. Disk pressure pada persistence.
7. Fork/copy-on-write overhead.
8. Client output buffer penuh.
9. Replica reconnect loop.

Gejala:

- stale read meningkat;
- failover lebih berisiko;
- replica disconnected;
- memory naik karena backlog/client buffer;
- Sentinel mungkin memilih replica yang kurang ideal jika konfigurasi buruk.

Monitoring minimal:

```text
INFO replication
```

Field yang perlu dipahami secara konsep:

- role;
- connected replicas;
- replica offset;
- master replication offset;
- master link status;
- backlog state;
- replica lag indicator.

Contoh reasoning:

```text
Primary offset = 1,000,000
Replica offset =   980,000
Lag logical     =    20,000 bytes/commands stream-ish gap
```

Jangan hanya bertanya “replica connected?”. Pertanyaan yang lebih benar:

> Connected, tetapi seberapa jauh tertinggal dan apakah workload kita aman membaca dari sana?

---

## 7. WAIT Command: Semi-Synchronous Flavor, Bukan Magic

Redis punya command `WAIT` untuk meminta primary menunggu sampai sejumlah replica mengakui write sampai offset tertentu, dalam batas timeout.

Pola konseptual:

```text
SET critical:key value
WAIT 1 100
```

Makna high-level:

- tunggu sampai minimal 1 replica mengakui write;
- maksimal tunggu 100 ms;
- hasil command memberi jumlah replica yang memenuhi.

Tetapi ini bukan transaksi distributed consensus.

Kenapa bukan jaminan absolut?

1. Replica bisa acknowledge lalu crash sebelum persistence flush.
2. Failover selection bisa kompleks.
3. Network partition masih mungkin membuat observasi client dan topology berubah.
4. `WAIT` meningkatkan probabilitas durability replication, bukan mengubah Redis menjadi strongly consistent database.

Gunakan `WAIT` untuk:

- meningkatkan safety untuk write penting tetapi masih toleran edge data loss;
- mengurangi window kehilangan write;
- membuat trade-off eksplisit antara latency dan replication assurance.

Jangan gunakan `WAIT` untuk:

- audit ledger utama;
- irreversible financial state;
- legal record final;
- workflow source of truth yang membutuhkan strict consistency.

Untuk domain seperti itu, Redis bisa menjadi acceleration layer, bukan authoritative ledger.

---

## 8. min-replicas-to-write: Guardrail untuk Write Safety

Redis dapat dikonfigurasi agar primary menolak write jika tidak ada cukup replica yang dianggap sehat.

Konsep:

```text
min-replicas-to-write 1
min-replicas-max-lag 10
```

Artinya secara praktis:

- primary hanya menerima write jika ada minimal 1 replica;
- replica tersebut tidak boleh lag lebih dari ambang tertentu.

Benefit:

- mengurangi risiko primary menerima write saat isolated dari replica;
- membuat mode failure lebih eksplisit: lebih baik reject write daripada menerima write yang sangat berisiko hilang.

Trade-off:

- availability write turun;
- saat replica lag, aplikasi dapat menerima error;
- perlu error handling di Java service;
- tidak menggantikan consensus.

Decision:

| Use Case | min-replicas-to-write? |
|---|---|
| pure cache | biasanya tidak perlu |
| session store penting | pertimbangkan |
| idempotency state | pertimbangkan, tapi evaluasi source of truth |
| lock | hati-hati, lock punya problem lain |
| audit state | Redis tetap bukan primary ledger |

---

## 9. Sentinel: Apa yang Dilakukan

Sentinel adalah sistem monitoring dan failover untuk Redis Open Source primary-replica deployment.

Sentinel melakukan beberapa fungsi:

1. Monitoring primary dan replica.
2. Mendeteksi primary tidak sehat.
3. Berkoordinasi dengan Sentinel lain.
4. Memilih replica untuk dipromosikan.
5. Mengonfigurasi replica lain untuk follow primary baru.
6. Memberi service discovery kepada client Sentinel-aware.

Topology umum:

```text
          +-------------+
          | Sentinel 1  |
          +-------------+
                 |
+------+      +---------+      +---------+
| App  | ---> | Primary | ---> | Replica |
+------+      +---------+      +---------+
                 |
          +-------------+
          | Sentinel 2  |
          +-------------+
                 |
          +-------------+
          | Sentinel 3  |
          +-------------+
```

Kenapa minimal 3 Sentinel?

Karena Sentinel perlu quorum/majority untuk keputusan failover yang lebih aman. Satu Sentinel adalah single point of decision failure.

---

## 10. Sentinel: Apa yang Tidak Dilakukan

Sentinel tidak membuat Redis menjadi strongly consistent.

Sentinel tidak menjamin:

- zero data loss;
- zero downtime;
- no stale reads;
- no duplicate command execution from client retries;
- no split brain dalam semua kondisi network buruk;
- application otomatis benar tanpa client support;
- semua Java connection langsung berpindah sempurna.

Sentinel adalah HA orchestration, bukan correctness oracle.

---

## 11. Failover Timeline

Contoh timeline:

```text
T0 primary sehat
T1 network/host primary bermasalah
T2 Sentinel mulai gagal ping primary
T3 Sentinel mencapai subjective down
T4 Sentinel quorum mencapai objective down
T5 leader Sentinel dipilih untuk failover
T6 replica terbaik dipilih
T7 replica dipromosikan menjadi primary
T8 replica lain diarahkan follow primary baru
T9 clients menemukan primary baru
T10 traffic pulih
```

Di antara T1–T10:

- write bisa gagal;
- read bisa timeout;
- client bisa masih mencoba primary lama;
- retry bisa menumpuk;
- beberapa command mungkin sukses tapi response hilang;
- aplikasi perlu idempotency dan timeout discipline.

---

## 12. Subjective Down vs Objective Down

Sentinel punya dua konsep penting:

### 12.1 Subjective Down

Satu Sentinel berpikir primary down.

```text
Sentinel A: primary tidak merespons -> s_down
```

Ini belum cukup untuk failover.

### 12.2 Objective Down

Cukup Sentinel sepakat primary down.

```text
Sentinel A + B + C reach quorum -> o_down
```

Baru failover dapat dimulai.

Kenapa penting?

Jika satu Sentinel salah karena network lokalnya bermasalah, kita tidak ingin langsung failover.

---

## 13. Split Brain Risk

Split brain terjadi ketika dua pihak dapat menerima write sebagai primary atau ketika sebagian sistem menganggap primary lama masih valid sementara sebagian memakai primary baru.

Skenario sederhana:

```text
Network partition

Side A:
  Old primary masih reachable oleh sebagian app

Side B:
  Sentinel quorum promote replica menjadi new primary

Akibat:
  sebagian write masuk old primary
  sebagian write masuk new primary
```

Setelah network pulih, salah satu dataset akan menang secara topology, dan write di sisi lain bisa hilang.

Mitigasi:

1. Deploy Sentinel dengan quorum benar.
2. Jangan letakkan semua Sentinel di satu host/AZ.
3. Gunakan `min-replicas-to-write` untuk primary lama agar tidak menerima write saat isolated dari replica.
4. Client harus menggunakan Sentinel discovery, bukan hardcode primary lama.
5. Batasi akses network ke Redis primary lama setelah failover.
6. Untuk critical state, gunakan fencing token atau source of truth lebih kuat.

---

## 14. Client Behavior adalah Bagian dari HA

Redis HA bukan hanya server topology. Client menentukan apakah aplikasi pulih dengan baik atau malah memperparah incident.

Java service harus memikirkan:

1. Bagaimana menemukan primary?
2. Apakah client Sentinel-aware?
3. Apakah client auto-reconnect?
4. Apakah command in-flight saat failover akan diulang?
5. Apakah retry aman?
6. Apakah timeout terlalu panjang?
7. Apakah connection pool bisa habis?
8. Apakah circuit breaker dibutuhkan?
9. Apakah fallback boleh dilakukan?
10. Apakah read dari replica dikonfigurasi sengaja atau tidak sengaja?

---

## 15. Java Client: Lettuce Sentinel Concept

Lettuce mendukung Sentinel topology.

High-level pseudo-configuration:

```java
RedisURI sentinelUri = RedisURI.Builder
    .sentinel("sentinel-1.example.com", 26379, "mymaster")
    .withSentinel("sentinel-2.example.com", 26379)
    .withSentinel("sentinel-3.example.com", 26379)
    .build();

RedisClient client = RedisClient.create(sentinelUri);
StatefulRedisConnection<String, String> connection = client.connect();
RedisCommands<String, String> commands = connection.sync();
```

Hal yang perlu diputuskan:

- timeout;
- reconnect policy;
- readFrom policy;
- command timeout;
- topology refresh;
- pooling vs shared connection;
- behavior saat failover;
- metrics.

Jangan copy-paste konfigurasi client tanpa failover test.

---

## 16. Java Client: Jedis Sentinel Concept

Jedis juga mendukung Sentinel.

Pseudo-code:

```java
Set<String> sentinels = Set.of(
    "sentinel-1.example.com:26379",
    "sentinel-2.example.com:26379",
    "sentinel-3.example.com:26379"
);

JedisSentinelPool pool = new JedisSentinelPool("mymaster", sentinels);

try (Jedis jedis = pool.getResource()) {
    jedis.set("k", "v");
}
```

Hal yang perlu dijaga:

- pool exhaustion saat failover;
- stale connections;
- socket timeout;
- borrow timeout;
- retry strategy;
- exception classification;
- shutdown lifecycle.

---

## 17. Spring Data Redis Sentinel Concept

Spring Boot/Spring Data Redis biasanya mengonfigurasi Redis Sentinel lewat properties atau bean.

Konsep properties:

```properties
spring.data.redis.sentinel.master=mymaster
spring.data.redis.sentinel.nodes=sentinel-1:26379,sentinel-2:26379,sentinel-3:26379
spring.data.redis.timeout=200ms
```

Tetapi production readiness bukan hanya properties.

Checklist:

- serializer eksplisit;
- timeout eksplisit;
- command latency metrics;
- connection pool metrics jika pooling;
- exception translation dipahami;
- retry tidak membabi buta;
- cache fallback behavior jelas;
- health check tidak membuat failover storm;
- actuator health indicator tidak terlalu agresif.

---

## 18. Retry: Teman atau Musuh?

Saat failover, retry terlihat menggoda:

```text
Redis timeout -> retry
```

Tetapi retry bisa berbahaya.

### 18.1 Aman untuk Idempotent Read

```text
GET cache:user:123
```

Retry relatif aman, meski tetap bisa memperparah load.

### 18.2 Berbahaya untuk Non-Idempotent Write

```text
INCR quota:user:123
LPUSH queue job
XADD stream event
```

Jika command sukses di server tapi response hilang, retry bisa menggandakan efek.

Contoh:

```text
Client sends INCR
Primary increments
Response lost due failover/network
Client retries INCR on new primary
Counter increments twice
```

Mitigasi:

- idempotency key;
- Lua script dengan request id;
- operation log di source of truth;
- avoid retry untuk non-idempotent Redis operations;
- classify commands.

Command classification:

| Command Type | Retry Safe? | Catatan |
|---|---:|---|
| GET | biasanya ya | stale/failover tetap mungkin |
| SET same value | sering ya | tergantung TTL dan semantics |
| SET NX | hati-hati | retry bisa berubah makna jika first succeeded |
| INCR | tidak aman | non-idempotent |
| LPUSH/RPUSH | tidak aman | duplicate item |
| XADD | tidak aman | duplicate event unless idempotency design |
| DEL | relatif aman | tetapi race dengan recreate key |
| Lua mutation | tergantung script | harus didesain idempotent |

---

## 19. Timeout Design untuk Failover

Timeout terlalu panjang:

- thread request tertahan;
- connection pool penuh;
- upstream timeout;
- retry datang terlambat;
- cascading failure.

Timeout terlalu pendek:

- false failure;
- excessive retry;
- noisy alert;
- failover normal terlihat seperti outage besar.

Prinsip:

```text
Redis timeout must fit inside service timeout budget.
```

Contoh:

```text
API SLO p99: 300 ms
DB budget: 120 ms
Redis budget: 30-80 ms depending use case
Fallback budget: 50 ms
```

Untuk cache read:

```text
Redis timeout -> fallback to DB / degraded response
```

Untuk enforcement:

```text
Redis timeout -> fail open or fail closed?
```

Keputusan fail-open/fail-closed harus domain-specific.

Contoh:

| Use Case | Redis unavailable behavior |
|---|---|
| product cache | fallback DB |
| recommendation cache | degraded empty result |
| login rate limit | mungkin fail closed sebagian atau risk-based |
| payment idempotency | jangan proses blindly |
| regulatory deadline guard | fail closed / route manual |
| distributed lock | do not enter critical section |

---

## 20. Health Check: Jangan Membunuh Sistem Sendiri

Health check yang buruk bisa memperparah Redis incident.

Anti-pattern:

```text
Every app instance pings Redis every 100 ms
```

Saat Redis bermasalah:

- health check menambah load;
- orchestrator restart semua pod;
- connection storm;
- failover makin lambat;
- app kehilangan local cache.

Health check yang lebih baik:

1. Pisahkan readiness dan liveness.
2. Redis dependency failure tidak selalu berarti process harus dibunuh.
3. Cache Redis down mungkin degraded, bukan fatal.
4. Enforcement Redis down mungkin service tidak ready untuk traffic tertentu.
5. Gunakan timeout pendek dan interval wajar.
6. Jangan jalankan command berat untuk health check.

Mental model:

```text
Liveness: process masih sehat?
Readiness: boleh menerima traffic penuh?
Dependency health: dependency sedang usable?
```

Jangan mencampur semuanya.

---

## 21. Read Scaling dengan Replica

Read scaling bisa berguna jika:

- read volume besar;
- data stale-tolerant;
- primary CPU/network bottleneck;
- latency ke replica acceptable;
- replica lag dimonitor;
- client read policy eksplisit.

Tetapi Redis workload sering bottleneck-nya bukan hanya CPU primary. Bisa jadi:

- network round trip;
- serialization di Java;
- connection pool;
- big key;
- slow command;
- memory pressure;
- hot key.

Jangan menambah replica sebelum tahu bottleneck.

Decision process:

```text
1. Measure commandstats/latency/pool metrics.
2. Identify hot commands and hot keys.
3. Reduce round trips with MGET/pipeline.
4. Fix big keys/serialization.
5. Consider local cache for hot immutable data.
6. Only then consider read replicas.
```

---

## 22. Replica untuk Backup dan Analytics? Hati-Hati

Replica sering dipakai untuk:

- backup snapshot;
- offline analysis;
- scanning keys;
- migration;
- debugging.

Lebih aman melakukan operasi berat di replica daripada primary, tetapi tetap ada risiko:

- replica lag meningkat;
- replica disconnect;
- backup snapshot membebani host;
- read-heavy scan mengganggu replica yang dipakai aplikasi;
- jika replica dijadikan failover candidate, kondisi buruknya bisa mempengaruhi HA.

Rule:

> Jangan gunakan replica production failover candidate sebagai tempat eksperimen berat tanpa isolasi.

Better:

- dedicated replica untuk backup/analytics;
- lower priority replica for promotion;
- separate resource class;
- scheduled job window;
- monitor lag during backup.

---

## 23. Sentinel Deployment Topology

Bad topology:

```text
Host A:
  Redis Primary
  Sentinel 1
  Sentinel 2
  Sentinel 3
```

Masalah:

- host mati -> semua Sentinel mati;
- quorum tidak bermakna;
- failure domain sama.

Better:

```text
AZ 1: Redis Primary + Sentinel 1
AZ 2: Redis Replica + Sentinel 2
AZ 3: Redis Replica + Sentinel 3
```

Atau minimal pisahkan Sentinel ke host berbeda.

Pertanyaan desain:

1. Apa failure domain kita?
2. Apakah Sentinel quorum tetap tersedia jika satu AZ mati?
3. Apakah app bisa reach Sentinel di beberapa AZ?
4. Apakah Redis nodes punya network ACL yang mencegah akses liar?
5. Apakah DNS/load balancer menambah delay atau menyembunyikan topology yang dibutuhkan client?

---

## 24. Sentinel Master Name adalah Contract

Sentinel menggunakan master name, misalnya:

```text
mymaster
```

Client bertanya ke Sentinel:

```text
Siapa primary untuk mymaster?
```

Jika master name berubah atau tidak konsisten, client bisa gagal discover primary.

Treat master name as config contract:

- versioned;
- documented;
- environment-specific;
- validated in deployment;
- included in runbook.

---

## 25. Promotion Candidate Selection

Saat failover, Sentinel memilih replica untuk dipromosikan berdasarkan beberapa faktor seperti health, lag, priority, dan offset.

Konsekuensi desain:

- replica yang lebih lag tidak ideal jadi primary;
- replica yang dipakai backup berat mungkin jangan jadi promotion candidate utama;
- replica di AZ tertentu mungkin punya priority berbeda;
- replica dengan network buruk bisa memperpanjang failover.

Kamu harus tahu:

```text
Which replica will likely become primary during failover?
```

Jika jawabanmu “tidak tahu”, HA belum benar-benar didesain.

---

## 26. Failover Test: Wajib, Bukan Optional

Redis Sentinel deployment belum production-ready sebelum failover diuji.

Minimal tests:

### 26.1 Kill Primary Process

```bash
redis-cli -p 6379 SHUTDOWN NOSAVE
```

Observe:

- detection time;
- failover time;
- client error rate;
- retry behavior;
- write loss possibility;
- app recovery time.

### 26.2 Network Partition Simulation

Simulasikan app tidak bisa reach primary atau Sentinel.

Observe:

- client timeout;
- pool exhaustion;
- whether old primary still accepts writes;
- Sentinel decision.

### 26.3 Replica Lag Before Failover

Buat replica tertinggal, lalu failover.

Observe:

- data loss window;
- application correctness;
- monitoring alerts.

### 26.4 Rolling Restart

Restart Redis/Sentinel one by one.

Observe:

- topology stability;
- unnecessary failover;
- client reconnect behavior.

### 26.5 App Cold Start During Failover

Start app saat failover sedang terjadi.

Observe:

- bootstrap robustness;
- Sentinel discovery;
- readiness behavior.

---

## 27. Failure Matrix untuk Java Service

Setiap Redis-backed feature harus punya matrix.

Contoh:

| Failure | Cache Feature | Idempotency Feature | Rate Limiter | Lock |
|---|---|---|---|---|
| Redis timeout | fallback DB | reject / retry with idempotency | fail open/closed by policy | do not lock |
| Redis stale replica | acceptable if bounded | not acceptable | not acceptable | not acceptable |
| Primary failover | temporary miss | possible uncertain state | possible quota ambiguity | lease invalid |
| Write acknowledged then lost | cache stale | dangerous | dangerous | dangerous |
| Duplicate retry | okay for SET same cache | must dedupe | counter overcount | double acquire risk |
| Replica lag | degraded read scale | no replica read | no replica read | no replica read |

This is the difference between “we use Redis” and “we understand Redis”.

---

## 28. Cache-Specific HA Strategy

Untuk cache, Redis HA strategy bisa lebih relaxed.

Jika Redis down:

- fallback ke DB;
- serve stale local cache;
- degrade response;
- temporarily disable optional feature;
- protect DB with circuit breaker.

Tetapi cache outage dapat menyebabkan database stampede.

Mitigasi:

1. Local in-process cache untuk hot keys.
2. Request coalescing.
3. Rate limit fallback DB traffic.
4. Jittered TTL.
5. Bulkhead Redis-dependent code path.
6. Cache warmup setelah failover.
7. Alert on miss rate spike.

Failure pattern:

```text
Redis failover -> cache misses/timeouts -> DB traffic spike -> DB slow -> app threads block -> full outage
```

Lesson:

> Redis HA is also database protection design.

---

## 29. Session Store HA Strategy

Jika Redis menyimpan session:

Questions:

1. Apakah kehilangan session acceptable?
2. Apakah user boleh logout massal?
3. Apakah session write harus persisted?
4. Apakah read dari replica boleh stale?
5. Bagaimana session refresh TTL saat failover?
6. Apakah `WAIT`/AOF/min-replicas diperlukan?

Common policy:

- read/write session ke primary;
- avoid replica read for active session mutation;
- use AOF if session loss costly;
- set explicit TTL;
- monitor evicted/expired keys;
- prepare forced re-login as degradation mode.

---

## 30. Enforcement State HA Strategy

Untuk rate limiter, idempotency, locks, workflow guards:

Default:

```text
No stale replica reads.
No blind retry for non-idempotent mutation.
No silent fail-open unless business explicitly accepts risk.
```

Rate limiter fail-open vs fail-closed harus diputuskan:

```text
Public search endpoint -> fail open maybe acceptable
Login brute force limiter -> fail open dangerous
Payment API quota -> fail closed or risk-adaptive
Regulatory submission deadline -> fail closed/manual route
```

Redis failover bukan hanya availability incident. Untuk enforcement, itu bisa menjadi correctness incident.

---

## 31. Lock HA Strategy

Redis lock dengan replication/failover punya problem khusus.

Skenario:

```text
Client A acquires lock on primary
Primary crashes before lock replicated
Replica promoted
Client B acquires same lock on new primary
Client A still thinks it holds lock
```

Akibat:

- two clients enter critical section.

Mitigasi:

- fencing token;
- design critical resource to reject stale token;
- minimize lock usage;
- prefer DB constraints/work queue when correctness stronger needed;
- evaluate Redlock carefully;
- do not rely on replica failover alone for absolute lock safety.

---

## 32. Streams HA Strategy

Redis Streams with replication:

- stream entry can be lost if primary accepts `XADD` and crashes before replication;
- consumer group state is also Redis state;
- pending entries can be affected by failover;
- duplicate processing remains possible;
- consumer must be idempotent.

Use Redis Streams for:

- lightweight event processing;
- internal async work;
- near-real-time tasks where bounded loss/duplication can be handled.

Be cautious for:

- audit log;
- financial ledger;
- legally binding event history;
- cross-service event backbone requiring strong retention and replay guarantees.

---

## 33. Persistence + Replication: Kombinasi, Bukan Pengganti

RDB/AOF dan replication menyelesaikan masalah berbeda.

| Mechanism | Protects Against | Does Not Fully Protect Against |
|---|---|---|
| RDB | restart restore snapshot | recent write loss |
| AOF | more durable command log | fsync window, corruption risk, operational complexity |
| Replica | node failure availability | async write loss, stale read |
| Sentinel | automatic failover | strong consistency |
| Backup | disaster recovery | immediate availability |

Production Redis sering perlu kombinasi:

```text
AOF + replica + Sentinel + backup + tested restore + app-level idempotency
```

Tapi untuk pure cache:

```text
replica/Sentinel may be enough, or even single node if app degrades safely
```

Tidak semua Redis use case butuh HA yang sama.

---

## 34. Managed Redis vs Self-Hosted Sentinel

Managed Redis services biasanya menyediakan HA/failover abstraction.

Keuntungan:

- operational burden lebih rendah;
- automatic failover;
- monitoring built-in;
- patching/upgrades lebih mudah;
- backup/restore managed;
- security integration.

Tetapi kamu tetap harus tahu:

- replication tetap sering async;
- failover tetap tidak zero-error;
- endpoints bisa berubah behavior;
- stale reads tetap mungkin jika replica read enabled;
- client timeout/retry tetap tanggung jawab aplikasi;
- vendor SLA bukan correctness proof.

Pertanyaan untuk managed Redis:

1. Apa RPO/RTO real?
2. Apa failover behavior client endpoint?
3. Apakah write bisa hilang saat failover?
4. Apakah reader endpoint membaca replica?
5. Bagaimana patching dilakukan?
6. Apakah persistence aktif?
7. Bagaimana backup restore diuji?
8. Apa maxmemory policy default?
9. Apa observability yang tersedia?
10. Bagaimana network partition ditangani?

---

## 35. Practical Architecture Patterns

### 35.1 Pure Cache with HA

```text
App -> Redis primary
    -> DB fallback
Redis primary -> replica
Sentinel manages failover
```

Policy:

- Redis down => fallback DB;
- protect DB with circuit breaker;
- cache read retry limited;
- non-critical stale allowed;
- alert on miss/timeout spike.

### 35.2 Session Store

```text
App -> Redis primary only for session read/write
Redis AOF enabled
Replica + Sentinel
```

Policy:

- no replica read for mutable active session;
- explicit TTL;
- session loss degradation plan;
- monitor evictions strictly.

### 35.3 Enforcement Layer

```text
App -> Redis primary
Lua scripts for atomic decisions
No replica read
Optional WAIT/min-replicas for risk reduction
Source-of-truth audit elsewhere if required
```

Policy:

- fail-open/closed decided per endpoint;
- idempotency for retries;
- no blind retry for mutating commands;
- command latency budget strict.

### 35.4 Read Replica for Stale-Tolerant Views

```text
Writes -> primary
Reads for stale-tolerant view -> replica
Critical reads -> primary
```

Policy:

- use separate methods/code paths;
- names must reveal consistency;
- monitor lag;
- fallback to primary if lag high.

Example API design:

```java
interface UserCacheRepository {
    UserSnapshot getFreshUser(String userId);       // primary
    UserSnapshot getEventuallyConsistentUser(String userId); // replica allowed
}
```

Do not hide consistency behind generic `getUser()`.

---

## 36. Naming Consistency in Code

Bad:

```java
User user = redisUserRepository.findById(userId);
```

Ambiguous:

- primary or replica?
- fresh or stale?
- cache or source?
- nullable due miss or error?

Better:

```java
Optional<UserSnapshot> getUserSnapshotFromPrimary(String userId);
Optional<UserSnapshot> getUserSnapshotFromReplicaAllowingStale(String userId);
CacheLookup<UserSnapshot> getUserCacheEntry(String userId);
```

For enforcement:

```java
RateLimitDecision consumeQuotaFromPrimary(RateLimitSubject subject);
IdempotencyDecision claimRequestFromPrimary(IdempotencyKey key);
```

Make consistency visible in interface names.

---

## 37. Operational Runbook: Sentinel Failover

A serious Redis deployment should have a runbook.

Minimum runbook contents:

1. Current topology.
2. Primary identity.
3. Replica identities.
4. Sentinel nodes.
5. Master name.
6. Expected quorum.
7. How to inspect replication.
8. How to inspect Sentinel state.
9. How to trigger controlled failover.
10. How to detect stuck failover.
11. How to re-add old primary as replica.
12. How to validate app connectivity.
13. How to assess data loss window.
14. How to communicate impact.
15. How to rollback or recover.

Useful commands conceptually:

```bash
redis-cli INFO replication
redis-cli -p 26379 SENTINEL masters
redis-cli -p 26379 SENTINEL replicas mymaster
redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
redis-cli -p 26379 SENTINEL failover mymaster
```

Never run failover command in production without understanding blast radius.

---

## 38. Metrics and Alerts

Key metrics:

### Replication

- primary/replica role;
- connected replicas;
- master link status;
- replication offset lag;
- replica disconnects;
- backlog utilization;
- failover count.

### Sentinel

- Sentinel process health;
- number of Sentinels reachable;
- subjective/objective down events;
- failover events;
- master address changes.

### Client

- Redis command latency;
- timeout rate;
- reconnect count;
- pool usage;
- pool wait time;
- command error classification;
- retry count;
- fallback count.

### Application Correctness

- duplicate operation count;
- idempotency conflict count;
- rate limiter fail-open/fail-closed count;
- cache miss spike;
- DB fallback spike;
- stale read detection if possible.

Alert examples:

```text
Replication link down > 30s
Replica lag above threshold > 60s
Sentinel quorum below minimum
Redis command timeout rate > baseline
Cache miss rate spike after failover
Pool exhaustion > 0
Failover occurred outside maintenance window
```

---

## 39. Common Anti-Patterns

### 39.1 “We Have a Replica, So Writes Are Safe”

Wrong. Replication is usually async.

### 39.2 Reading Enforcement State from Replica

Dangerous due stale reads.

### 39.3 Blind Retry of Mutating Commands

Can duplicate effects.

### 39.4 One Sentinel on Same Host

Not real HA.

### 39.5 Hardcoded Primary Address

Client will not discover new primary after failover.

### 39.6 No Failover Test

HA that has never failed over is a theory.

### 39.7 Health Check Restarts Everything

Can turn Redis blip into full outage.

### 39.8 All Redis Use Cases Share Same Availability Policy

Cache, session, idempotency, lock, and stream do not have the same correctness needs.

---

## 40. Decision Framework

Before enabling replication/Sentinel, answer:

### 40.1 Data Criticality

```text
If Redis loses the last 1 second of writes, what happens?
```

Possible answers:

- no problem, cache refills;
- users may need login again;
- duplicate request may be processed;
- quota may be bypassed;
- legal/audit issue;
- financial loss.

### 40.2 Freshness

```text
Can the application read stale data?
```

If yes:

- replica read may be okay.

If no:

- read primary or use stronger store.

### 40.3 Failover Behavior

```text
During 5-30 seconds of Redis instability, what should the app do?
```

Answer must be explicit.

### 40.4 Retry Safety

```text
If a command succeeded but client did not receive response, is retry safe?
```

If no:

- add idempotency;
- avoid retry;
- design command as idempotent;
- move operation to stronger system.

### 40.5 Operational Ownership

```text
Who knows how to recover Redis topology at 03:00?
```

If nobody, managed Redis or simpler architecture may be better.

---

## 41. Java-Oriented Implementation Checklist

### Client

- [ ] Sentinel-aware or managed endpoint aware.
- [ ] Multiple Sentinel nodes configured.
- [ ] Master name correct.
- [ ] Timeouts explicit.
- [ ] Pooling/multiplexing understood.
- [ ] Reconnect behavior tested.
- [ ] Read replica policy explicit.
- [ ] Metrics enabled.

### Command Semantics

- [ ] Mutating commands classified for retry safety.
- [ ] Idempotency implemented where needed.
- [ ] Lua scripts tested under retry/failover.
- [ ] Non-critical cache operations degrade gracefully.
- [ ] Enforcement operations fail-open/closed by policy.

### Deployment

- [ ] Sentinels on separate failure domains.
- [ ] Replica promotion priority understood.
- [ ] Persistence configured according to RPO.
- [ ] `min-replicas-to-write` considered for important writes.
- [ ] Backup and restore tested.

### Testing

- [ ] Primary kill test.
- [ ] Sentinel failover test.
- [ ] Network partition test.
- [ ] App cold-start during failover test.
- [ ] Retry duplicate-effect test.
- [ ] DB fallback load test.

---

## 42. Small Lab: Local Sentinel Topology

This is a conceptual lab outline.

### 42.1 Components

```text
redis-primary: 6379
redis-replica-1: 6380
redis-replica-2: 6381
sentinel-1: 26379
sentinel-2: 26380
sentinel-3: 26381
```

### 42.2 Primary Config Concept

```conf
port 6379
appendonly yes
```

### 42.3 Replica Config Concept

```conf
port 6380
replicaof 127.0.0.1 6379
appendonly yes
```

### 42.4 Sentinel Config Concept

```conf
port 26379
sentinel monitor mymaster 127.0.0.1 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1
```

Meaning:

- monitor master named `mymaster`;
- quorum 2;
- mark down after 5s without acceptable response;
- failover timeout 60s;
- resync replicas one at a time.

### 42.5 Experiment

1. Write key to primary.
2. Read from replica.
3. Kill primary.
4. Watch Sentinel promote replica.
5. Query Sentinel for new primary.
6. Confirm app reconnects.
7. Check whether recent writes survived.
8. Repeat with write load during failover.

Expected learning:

- failover has duration;
- some commands fail;
- client behavior matters;
- write loss window is not imaginary.

---

## 43. Architecture Review Questions

Use these in design review:

1. What Redis role is this feature using: cache, session, enforcement, lock, stream, query?
2. Is Redis authoritative for this data?
3. What is acceptable RPO?
4. What is acceptable RTO?
5. Can reads be stale?
6. Are reads from replica enabled?
7. Which commands are non-idempotent?
8. What happens if primary crashes after ACK but before replication?
9. What happens if client retries after timeout?
10. What happens if Sentinel promotes a lagging replica?
11. What happens if old primary comes back?
12. Is `min-replicas-to-write` configured or intentionally not?
13. Is persistence configured?
14. Is failover tested in CI/staging/game day?
15. Does the Java service have fallback/circuit breaker?
16. Does health check cause restart storm?
17. Are Sentinel nodes in separate failure domains?
18. Are metrics sufficient to diagnose lag and failover?
19. Is there a runbook?
20. Who owns the 03:00 incident?

---

## 44. Key Takeaways

1. Redis replication is usually asynchronous.
2. Replica improves availability/read scaling, not strong consistency.
3. Failover can lose acknowledged writes that were not replicated.
4. Read from replica is only safe for stale-tolerant data.
5. Enforcement state should usually use primary reads/writes.
6. Sentinel automates failover and service discovery, but does not remove consistency trade-offs.
7. Java client configuration is part of HA design.
8. Retry strategy must be command-aware.
9. Health checks can amplify failures.
10. HA must be tested, not assumed.

The senior mental model:

> Redis HA is not “add replica and Sentinel”. Redis HA is a contract between data criticality, replication lag, failover behavior, client semantics, timeout policy, retry safety, and operational runbooks.

---

## 45. Referensi

- Redis documentation — Replication: https://redis.io/docs/latest/operate/oss_and_stack/management/replication/
- Redis documentation — Sentinel: https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/
- Redis documentation — Sentinel client spec: https://redis.io/docs/latest/develop/reference/sentinel-clients/
- Redis documentation — FAILOVER command: https://redis.io/docs/latest/commands/failover/
- Redis documentation — Redis Cluster scaling and asynchronous replication discussion: https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/
- Redis documentation — Cluster specification write safety: https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/
- Redis documentation — Connection pools and multiplexing: https://redis.io/docs/latest/develop/clients/pools-and-muxing/

---

## 46. Status Seri

```text
Part 021 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-022.md
```

Part berikutnya akan membahas:

```text
Redis Cluster: Hash Slots, Resharding, Multi-Key Constraints
```

Di sana kita akan berpindah dari HA primary-replica/Sentinel menuju Redis Cluster sebagai model scaling horizontal dengan 16.384 hash slots, hash tags, MOVED/ASK redirects, resharding, dan constraint multi-key yang sangat penting untuk desain key Java services.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Persistence: RDB, AOF, Durability, Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-022.md">Part 022 — Redis Cluster: Hash Slots, Resharding, Multi-Key Constraints ➡️</a>
</div>
