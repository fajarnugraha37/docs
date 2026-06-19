# learn-redis-mastery-for-java-engineers-part-022.md

# Part 022 — Redis Cluster: Hash Slots, Resharding, Multi-Key Constraints

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memakai Redis Cluster secara benar di sistem produksi  
> Fokus: mental model Redis Cluster, hash slots, routing client, hash tags, multi-key limitation, resharding, hot slot, failover, dan desain key dari awal

---

## 0. Posisi Part Ini dalam Seri

Di bagian sebelumnya kita sudah membahas:

- Redis core execution model.
- Data structures.
- TTL, eviction, cache architecture.
- Rate limiting, idempotency, locks, Lua, functions.
- Pub/Sub, Streams.
- Persistence.
- Replication, Sentinel, failover.

Bagian ini membahas pertanyaan besar berikutnya:

> Kalau satu Redis node tidak cukup, bagaimana Redis membagi data ke banyak node tanpa mengubah Redis menjadi database distributed transaction?

Jawabannya adalah **Redis Cluster**.

Tetapi Redis Cluster sering disalahpahami. Banyak engineer mengira Redis Cluster sama dengan:

- Redis biasa + auto scale.
- Redis Sentinel + sharding.
- Semua command tetap sama, hanya endpoint-nya berbeda.
- Semua multi-key command tetap aman.
- Failover berarti tidak ada data loss.
- Hash tag bisa dipakai bebas untuk “memaksa semuanya satu node”.

Semua asumsi itu berbahaya.

Redis Cluster adalah mekanisme **partitioning/sharding + availability**, bukan mekanisme transaksi global. Ia membuat Redis bisa menyebarkan keyspace ke banyak primary node, tetapi dengan konsekuensi desain yang sangat nyata:

- Key punya lokasi fisik berdasarkan hash slot.
- Multi-key command hanya aman jika semua key berada di slot yang sama.
- Client harus cluster-aware.
- Topology bisa berubah.
- Slot bisa dipindah saat resharding.
- Hot key/hot slot tetap bisa menghancurkan node tertentu.
- Failover tetap memiliki window consistency dan availability trade-off.

Part ini akan membangun mental model tersebut dari awal.

---

## 1. Masalah yang Dicoba Dipecahkan Redis Cluster

Satu instance Redis punya batas praktis:

1. **Memory capacity**
   
   Semua working data harus muat di memory node tersebut.

2. **CPU command execution**
   
   Redis sangat cepat, tetapi setiap node tetap punya batas CPU, event loop, I/O thread, dan cost command.

3. **Network throughput**
   
   Node bisa jenuh karena request/response traffic.

4. **Operational blast radius**
   
   Satu node besar berarti restart, fork, persistence, migration, failover, dan restore bisa lebih berat.

5. **High availability**
   
   Butuh replica dan failover ketika primary gagal.

Redis Cluster menjawab sebagian masalah itu dengan:

- Membagi keyspace ke beberapa primary node.
- Menempatkan replica untuk primary node.
- Mengizinkan failover per shard.
- Menggunakan client-side routing berdasarkan hash slot.

Namun Redis Cluster **tidak** menjawab:

- Distributed SQL-style transaction.
- Global strongly consistent reads.
- Cross-shard join.
- Cross-shard lock yang aman secara otomatis.
- Global ordering seluruh command.
- Infinite scaling tanpa key design.

Redis Cluster adalah bentuk scaling yang sangat Redis: cepat, eksplisit, dan menuntut disiplin desain.

---

## 2. Redis Sentinel vs Redis Cluster

Sebelum masuk ke hash slot, bedakan dua konsep ini.

### 2.1 Sentinel

Redis Sentinel menyediakan:

- Monitoring primary/replica.
- Automatic failover.
- Discovery primary baru.
- Notification.

Tetapi Sentinel **tidak melakukan sharding**.

Artinya:

```text
All keys -> one primary logical dataset
```

Replica hanya salinan dari primary. Kalau dataset terlalu besar untuk satu primary, Sentinel tidak menyelesaikan masalah itu.

### 2.2 Cluster

Redis Cluster menyediakan:

- Sharding keyspace ke banyak primary.
- Replica per primary.
- Failover per shard.
- Routing via hash slot.

Secara konseptual:

```text
Keyspace
  -> slot 0..16383
      -> primary node A/B/C/...
          -> optional replicas
```

### 2.3 Tabel Ringkas

| Aspek | Sentinel | Cluster |
|---|---:|---:|
| Failover | Ya | Ya |
| Sharding | Tidak | Ya |
| Banyak primary aktif | Tidak untuk satu dataset | Ya |
| Client perlu routing slot | Tidak | Ya |
| Multi-key bebas lintas key | Ya, selama satu instance | Tidak, harus satu slot |
| Cocok untuk dataset > satu node | Tidak | Ya |
| Complexity | Menengah | Lebih tinggi |

### 2.4 Kesimpulan Praktis

Gunakan Sentinel ketika:

- Satu primary cukup secara memory/throughput.
- Anda butuh HA sederhana.
- Command multi-key lintas key masih penting.

Gunakan Cluster ketika:

- Dataset/throughput perlu dibagi ke banyak primary.
- Anda siap mendesain key agar cluster-safe.
- Anda menerima batas multi-key dan konsekuensi routing.

---

## 3. Mental Model Utama Redis Cluster

Redis Cluster tidak membagi data langsung berdasarkan node. Ia membagi data melalui lapisan tengah bernama **hash slot**.

```text
key -> hash slot -> node
```

Redis Cluster memiliki **16,384 hash slots**, bernomor:

```text
0..16383
```

Setiap primary node bertanggung jawab atas subset slot.

Contoh cluster 3 primary:

```text
Primary A owns slots     0 - 5460
Primary B owns slots  5461 - 10922
Primary C owns slots 10923 - 16383
```

Ketika client menjalankan:

```redis
GET user:123:profile
```

Client atau server akan menghitung slot dari key `user:123:profile`, lalu request diarahkan ke node pemilik slot tersebut.

### 3.1 Kenapa Pakai Hash Slot?

Hash slot membuat Redis Cluster bisa:

1. Memetakan key ke shard secara deterministik.
2. Memindahkan sebagian slot dari node A ke node B saat resharding.
3. Memungkinkan client cache topology.
4. Menghindari central coordinator untuk setiap request.

Tanpa hash slot, setiap key mungkin perlu metadata granular. Dengan slot, Redis cukup memindahkan unit slot.

---

## 4. Key-to-Slot Mapping

Secara high-level:

```text
slot = CRC16(key) mod 16384
```

Contoh konseptual:

```text
user:1:profile     -> slot 7321
user:2:profile     -> slot 11802
tenant:9:quota     -> slot 332
order:abc:state    -> slot 15501
```

Client cluster-aware bisa menghitung ini sendiri, sehingga ia tahu node mana yang harus dihubungi.

### 4.1 Implikasi

Key dengan prefix sama **tidak otomatis** berada di slot sama.

Misalnya:

```text
user:100:profile
user:100:sessions
user:100:permissions
```

Secara intuitif tampak berhubungan, tetapi tanpa hash tag, ketiganya bisa tersebar ke slot berbeda.

Ini sangat penting untuk multi-key operation.

---

## 5. Multi-Key Constraint

Redis single-node memperbolehkan command seperti:

```redis
MGET user:100:profile user:100:settings
SUNION user:100:roles user:100:groups
RENAME old:key new:key
```

Di Redis Cluster, command multi-key hanya bisa dieksekusi jika semua key berada dalam **slot yang sama**.

Jika tidak, Redis mengembalikan error seperti:

```text
CROSSSLOT Keys in request don't hash to the same slot
```

### 5.1 Kenapa Batas Ini Ada?

Karena Redis Cluster tidak ingin membuat setiap multi-key command menjadi distributed transaction lintas node.

Bayangkan:

```redis
MSET keyA valueA keyB valueB
```

Jika `keyA` berada di node A dan `keyB` berada di node B, Redis harus menjamin atomicity lintas node. Itu membutuhkan protokol distributed commit, failure recovery, coordination, dan blocking behavior yang akan bertentangan dengan desain Redis.

Redis memilih batas yang lebih sederhana:

> Atomicity multi-key hanya tersedia jika semua key berada di slot yang sama.

### 5.2 Konsekuensi untuk Java Engineer

Di Java service, Anda tidak boleh mendesain repository/cache layer seperti ini tanpa cluster-awareness:

```java
redisTemplate.opsForValue().multiGet(List.of(
    "user:100:profile",
    "user:100:settings",
    "user:100:permissions"
));
```

Ini mungkin bekerja di local Redis single node, tetapi gagal di Redis Cluster.

Masalahnya bukan Java. Masalahnya model key.

---

## 6. Hash Tags: Cara Mengontrol Slot

Redis Cluster menyediakan **hash tag**.

Hash tag adalah bagian key di dalam `{...}` yang dipakai sebagai input hashing, bukan seluruh key.

Contoh:

```text
user:{100}:profile
user:{100}:settings
user:{100}:permissions
```

Semua key di atas memakai hash tag `100`, sehingga semuanya masuk ke slot yang sama.

Secara konseptual:

```text
CRC16("100") mod 16384
```

bukan:

```text
CRC16("user:{100}:profile") mod 16384
```

### 6.1 Contoh Multi-Key Aman

```redis
MGET user:{100}:profile user:{100}:settings user:{100}:permissions
```

Semua key memakai `{100}`, jadi command ini cluster-safe.

### 6.2 Contoh Multi-Key Tidak Aman

```redis
MGET user:100:profile user:100:settings user:100:permissions
```

Prefix sama, tetapi slot belum tentu sama.

### 6.3 Contoh Hash Tag yang Salah

```text
{user}:100:profile
{user}:101:profile
{user}:102:profile
```

Semua key masuk ke slot yang sama karena hash tag-nya `user`.

Ini buruk karena membuat hot slot besar.

### 6.4 Hash Tag Harus Merepresentasikan Co-Location Boundary

Hash tag harus dipilih berdasarkan pertanyaan:

> Data mana yang memang perlu dieksekusi bersama secara atomic atau multi-key?

Contoh boundary yang mungkin valid:

```text
tenant:{tenantId}:quota
user:{userId}:profile
order:{orderId}:state
workflow:{caseId}:lock
rate:{tenantId}:endpoint:{endpointId}
```

Boundary yang buruk:

```text
{all-users}:user:123
{cache}:product:999
{tenant}:123:something
{global}:anything
```

Karena ini mengumpulkan terlalu banyak key ke slot yang sama.

---

## 7. Hash Tag Design Pattern

Untuk sistem produksi, jangan menaruh `{}` secara ad hoc. Jadikan hash tag sebagai bagian dari schema key.

### 7.1 Format Umum

```text
<bounded-context>:<entity-type>:{<partition-id>}:<attribute>
```

Contoh:

```text
identity:user:{u-123}:profile
identity:user:{u-123}:sessions
identity:user:{u-123}:permissions
```

Atau:

```text
case-mgmt:case:{case-789}:state
case-mgmt:case:{case-789}:tasks
case-mgmt:case:{case-789}:lock
```

### 7.2 Untuk Multi-Tenant System

Ada dua pilihan umum.

#### Option A — hash tag per tenant

```text
quota:tenant:{t-42}:daily
quota:tenant:{t-42}:monthly
quota:tenant:{t-42}:burst
```

Kelebihan:

- Mudah melakukan multi-key quota per tenant.
- Cocok jika tenant kecil/menengah.

Kekurangan:

- Tenant besar bisa menjadi hot slot.
- Semua data tenant tertentu terkonsentrasi.

#### Option B — hash tag per tenant + subpartition

```text
quota:tenant:{t-42:bucket-00}:daily
quota:tenant:{t-42:bucket-01}:daily
quota:tenant:{t-42:bucket-02}:daily
```

Kelebihan:

- Mengurangi hot slot.
- Cocok untuk tenant besar.

Kekurangan:

- Multi-key operation antar bucket tidak atomic.
- Aggregation perlu fan-out.

### 7.3 Design Heuristic

Gunakan hash tag kecil ketika:

- Anda butuh atomic multi-key kecil.
- Cardinality tinggi.
- Load relatif tersebar.

Hindari hash tag besar ketika:

- Satu tag bisa menampung jutaan key.
- Satu tag punya traffic sangat tinggi.
- Tag merepresentasikan kategori global.

---

## 8. Key Schema untuk Cluster dari Awal

Kesalahan umum adalah membangun key schema untuk Redis single-node, lalu baru “dipaksa cluster” ketika traffic tumbuh.

Ini mahal karena:

- Key sudah tersebar tanpa hash tag.
- Multi-key command tiba-tiba gagal.
- Lua script dengan banyak key gagal cross-slot.
- Spring Cache key generator tidak cluster-aware.
- Job/worker logic perlu diubah.
- Migration key naming bisa berisiko.

### 8.1 Checklist Key Schema Cluster-Ready

Untuk setiap key pattern, dokumentasikan:

```text
Pattern:
Owner service:
Redis type:
TTL:
Hash tag:
Co-location reason:
Expected cardinality:
Expected QPS:
Max value size:
Multi-key operations:
Cluster-safe? yes/no
```

Contoh:

```text
Pattern: rate:tenant:{tenantId}:endpoint:{endpointId}:window:{epochSecond}
Owner service: api-gateway
Redis type: string counter
TTL: 2 minutes
Hash tag: tenantId? endpointId? depends on limiter algorithm
Co-location reason: all counters for one limiter decision must be same slot if Lua uses multiple keys
Expected cardinality: tenants * endpoints * active windows
Expected QPS: high
Max value size: small integer
Multi-key operations: Lua checks current + previous window
Cluster-safe: yes if hash tag stable across involved keys
```

### 8.2 Jangan Biarkan Framework Mendesain Key Sendiri

Spring Cache default key generation mungkin cukup untuk single-node cache, tetapi untuk Redis Cluster, Anda perlu sadar apakah key-key tertentu perlu co-location.

Contoh cache sederhana:

```text
product::123
product::124
```

Tidak masalah jika setiap `GET` berdiri sendiri.

Tetapi kalau Anda memakai `MGET` untuk beberapa key yang tidak satu slot, Anda harus:

1. Menghindari `MGET` lintas slot.
2. Mengelompokkan key per slot di client.
3. Atau mendesain hash tag jika memang satu entity boundary.

---

## 9. Client-Side Routing

Dalam Redis Cluster, client sebaiknya cluster-aware.

Client cluster-aware melakukan:

1. Load cluster topology.
2. Tahu slot mana dimiliki node mana.
3. Menghitung slot dari key.
4. Mengirim command ke node yang tepat.
5. Menangani redirect `MOVED` dan `ASK`.
6. Refresh topology ketika berubah.

### 9.1 Non-Cluster-Aware Client

Jika client biasa hanya connect ke satu node cluster, ia bisa mendapat redirect error.

Misalnya client mengirim key slot 9000 ke node yang hanya punya slot 0-5000:

```text
-MOVED 9000 10.0.0.12:6379
```

Client harus mengerti pesan itu dan redirect.

Jika tidak, aplikasi akan melihat error.

### 9.2 Cluster-Aware Java Clients

Untuk Java, pilihan umum:

- Lettuce cluster client.
- JedisCluster.
- Spring Data Redis di atas Lettuce/Jedis.

Lettuce sering dipilih untuk async/reactive dan konfigurasi topology refresh yang lebih advanced. Jedis sering dipilih untuk synchronous API yang lebih langsung.

---

## 10. MOVED dan ASK

Redis Cluster punya dua redirect penting:

```text
MOVED
ASK
```

Keduanya sering muncul ketika client mengirim request ke node yang bukan pemilik slot, tetapi artinya berbeda.

---

## 11. MOVED Redirection

`MOVED` berarti:

> Slot tersebut sekarang dimiliki node lain secara permanen menurut topology cluster.

Contoh:

```text
-MOVED 3999 127.0.0.1:6381
```

Maknanya:

- Key ada di slot 3999.
- Slot 3999 bukan di node yang sedang dihubungi.
- Client harus mengirim ke `127.0.0.1:6381`.
- Client sebaiknya refresh topology cache.

### 11.1 Java Implication

Jika Anda melihat banyak `MOVED` di log client:

- Client topology stale.
- Cluster baru saja reshard/failover.
- Topology refresh tidak aktif/kurang tepat.
- Client connect ke endpoint yang tidak cocok.

Di aplikasi Java produksi, ini perlu diamati karena redirect menambah latency.

---

## 12. ASK Redirection

`ASK` biasanya terjadi saat slot sedang dalam proses migrasi.

Maknanya:

> Untuk request ini, coba tanya node target sementara, tetapi jangan anggap topology permanen sudah berubah.

Secara konseptual:

```text
-ASK 3999 127.0.0.1:6381
```

Client harus:

1. Mengirim command `ASKING` ke node target.
2. Mengirim command asli.
3. Tidak langsung mengubah slot map permanen seperti pada `MOVED`.

### 12.1 MOVED vs ASK

| Aspek | MOVED | ASK |
|---|---:|---:|
| Arti | Slot sudah pindah permanen | Slot sedang migrasi/sementara |
| Client topology refresh | Ya, biasanya | Tidak permanen |
| Butuh `ASKING` | Tidak | Ya |
| Umum saat | Failover/resharding selesai/topology stale | Resharding berlangsung |

### 12.2 Practical Lesson

Client Redis Cluster harus menangani keduanya. Jangan implementasikan Redis Cluster routing sendiri kecuali Anda benar-benar tahu protokolnya.

Gunakan client matang.

---

## 13. Topology Refresh di Java

Cluster topology bisa berubah karena:

- Failover.
- Node join/leave.
- Resharding.
- Maintenance.
- Network partition recovery.

Client Java perlu tahu perubahan ini.

### 13.1 Lettuce Topology Refresh Concept

Pada Lettuce, ada konsep:

- Periodic topology refresh.
- Adaptive topology refresh.
- Refresh trigger ketika menerima redirect tertentu.

Konfigurasi konseptual:

```java
ClusterTopologyRefreshOptions topologyRefreshOptions = ClusterTopologyRefreshOptions.builder()
    .enablePeriodicRefresh(Duration.ofSeconds(30))
    .enableAllAdaptiveRefreshTriggers()
    .build();

ClusterClientOptions clusterClientOptions = ClusterClientOptions.builder()
    .topologyRefreshOptions(topologyRefreshOptions)
    .build();

RedisClusterClient client = RedisClusterClient.create(redisUriList);
client.setOptions(clusterClientOptions);
```

Catatan:

- Jangan copy konfigurasi tanpa load test.
- Adaptive refresh terlalu agresif bisa menambah overhead.
- Periodic refresh terlalu lambat bisa memperpanjang redirect latency.
- Production setting harus disesuaikan dengan managed Redis/infra Anda.

### 13.2 JedisCluster Concept

JedisCluster menyediakan abstraction untuk connect ke cluster nodes dan routing command.

Konseptual:

```java
Set<HostAndPort> nodes = Set.of(
    new HostAndPort("redis-1", 6379),
    new HostAndPort("redis-2", 6379),
    new HostAndPort("redis-3", 6379)
);

try (JedisCluster cluster = new JedisCluster(nodes)) {
    cluster.set("user:{123}:profile", "...");
    String value = cluster.get("user:{123}:profile");
}
```

Dalam produksi, Anda perlu memperhatikan:

- Timeout.
- Pooling.
- Max attempts.
- TLS/auth.
- DNS behavior.
- Endpoint discovery.
- Metrics.

### 13.3 Spring Data Redis

Spring Data Redis bisa dikonfigurasi cluster-aware melalui connection factory.

Konseptual:

```java
@Configuration
class RedisConfig {

    @Bean
    LettuceConnectionFactory redisConnectionFactory() {
        RedisClusterConfiguration clusterConfig = new RedisClusterConfiguration()
            .clusterNode("redis-1", 6379)
            .clusterNode("redis-2", 6379)
            .clusterNode("redis-3", 6379);

        return new LettuceConnectionFactory(clusterConfig);
    }
}
```

Tetapi framework tidak menghapus batas Redis Cluster:

- `MGET` tetap cross-slot sensitive.
- Lua script tetap harus key same-slot.
- Transaction multi-key tetap terbatas.
- Key generator tetap harus Anda desain.

---

## 14. Command Category yang Perlu Diperhatikan di Cluster

Tidak semua command punya behavior sama di cluster.

### 14.1 Single-Key Commands

Umumnya aman:

```redis
GET key
SET key value
HGET key field
ZADD key score member
XADD key * field value
```

Karena command punya satu key utama.

### 14.2 Multi-Key Commands

Harus satu slot:

```redis
MGET k1 k2
MSET k1 v1 k2 v2
SUNION k1 k2
SINTER k1 k2
ZUNIONSTORE dest k1 k2
RENAME old new
```

### 14.3 Lua Scripts

Lua script yang menerima beberapa key harus memastikan semua key berada pada slot yang sama.

Contoh aman:

```redis
EVAL "..." 2 order:{123}:state order:{123}:lock
```

Contoh tidak aman:

```redis
EVAL "..." 2 order:123:state order:123:lock
```

Jika slot berbeda, akan gagal.

### 14.4 Pub/Sub

Classic Pub/Sub tidak sama dengan key-slot data command. Redis 7 menambahkan sharded Pub/Sub yang lebih cluster-aware dengan channel shard.

Namun untuk aplikasi Java, tetap dokumentasikan apakah memakai:

- Classic Pub/Sub.
- Sharded Pub/Sub.
- Streams.
- External broker.

### 14.5 Administrative Commands

Command seperti:

```redis
KEYS *
SCAN
INFO
DBSIZE
FLUSHALL
```

Perlu dipahami scope-nya.

Dalam cluster, Anda mungkin perlu menjalankan per node, bukan menganggap satu command mewakili seluruh cluster.

---

## 15. SCAN di Redis Cluster

Di single node, `SCAN` iterasi keyspace node tersebut.

Di cluster, keyspace tersebar di banyak node. Maka operasi scanning seluruh cluster berarti:

```text
SCAN node A
SCAN node B
SCAN node C
...
merge results client-side
```

### 15.1 Jangan Jadikan SCAN Sebagai Runtime Dependency

`SCAN` boleh berguna untuk:

- Maintenance.
- Migration.
- Debugging.
- Offline tooling.
- Cleanup job terkendali.

Tetapi buruk sebagai bagian request path.

Jika aplikasi butuh menemukan data berdasarkan query, jangan mengandalkan scan seluruh cluster. Desain index sendiri dengan Set/Sorted Set/Search, atau gunakan database/search engine yang tepat.

---

## 16. Resharding

Resharding adalah proses memindahkan hash slots dari satu node ke node lain.

Contoh:

```text
Before:
A owns 0-5460
B owns 5461-10922
C owns 10923-16383

After adding D:
A owns fewer slots
B owns fewer slots
C owns fewer slots
D owns some moved slots
```

### 16.1 Kenapa Resharding Dilakukan?

- Menambah node baru.
- Mengurangi load node tertentu.
- Mengganti node lama.
- Mengatasi imbalance.
- Maintenance.
- Capacity expansion.

### 16.2 Apa yang Terjadi Saat Slot Dipindah?

Secara konseptual:

1. Slot ditandai migrating di source node.
2. Slot ditandai importing di target node.
3. Keys dalam slot dipindahkan.
4. Client mungkin menerima `ASK` selama proses.
5. Setelah selesai, ownership slot berubah.
6. Client stale mungkin menerima `MOVED`.

### 16.3 Risiko Resharding

- Latency naik.
- Redirect meningkat.
- Client topology stale.
- Hot slot tetap hot walau pindah node.
- Migration key besar bisa berat.
- Operational mistake bisa menyebabkan instability.

### 16.4 Production Resharding Checklist

Sebelum reshard:

```text
[ ] Ada backup/rollback plan.
[ ] Metrics baseline tersedia.
[ ] Client topology refresh dikonfigurasi.
[ ] Big keys diketahui.
[ ] Hot keys/hot slots diketahui.
[ ] Maintenance window dipilih jika perlu.
[ ] Alert disesuaikan agar tidak noise berlebihan.
[ ] Runbook jelas.
```

Saat reshard:

```text
[ ] Monitor latency p95/p99.
[ ] Monitor MOVED/ASK.
[ ] Monitor CPU per node.
[ ] Monitor memory per node.
[ ] Monitor blocked clients.
[ ] Monitor client error rate.
```

Setelah reshard:

```text
[ ] Validate slot balance.
[ ] Validate key count/memory distribution.
[ ] Validate application error rate normal.
[ ] Validate cache hit ratio tidak rusak.
[ ] Validate no unexpected hot node.
```

---

## 17. Rebalancing Tidak Sama dengan Menghilangkan Hot Key

Redis Cluster membagi berdasarkan slot, bukan berdasarkan command load per key.

Jika satu key sangat panas:

```text
product:{999}:detail
```

Maka semua request untuk key itu tetap menuju satu slot dan satu primary node.

Menambah node tidak otomatis menyelesaikan hot key.

### 17.1 Hot Key

Hot key adalah key tunggal yang menerima traffic sangat tinggi.

Contoh:

- Global config.
- Viral product.
- Popular leaderboard.
- Common feature flag.
- Tenant raksasa.
- Single rate limiter key untuk semua user.

Mitigasi:

1. Local in-process cache.
2. Client-side caching.
3. Read replica, jika staleness diterima.
4. Key sharding/manual fan-out.
5. Precomputed variants.
6. Move workload out of Redis if unsuitable.

### 17.2 Hot Slot

Hot slot terjadi ketika banyak key panas kebetulan atau sengaja berada dalam slot sama.

Sering terjadi karena hash tag buruk:

```text
cache:{global}:a
cache:{global}:b
cache:{global}:c
```

Semua masuk satu slot.

Mitigasi:

- Perbaiki hash tag.
- Tambahkan subpartition.
- Hindari global tag.
- Pecah workload.

### 17.3 Hot Node

Hot node terjadi ketika node menampung slot-slot dengan load lebih tinggi.

Mitigasi:

- Rebalance slot.
- Tambah node.
- Pindahkan slot panas.
- Pecah hot key/hot slot.

Tetapi jika akar masalah adalah satu key sangat panas, rebalancing tidak cukup.

---

## 18. Designing for Multi-Key Use Cases

Mari lihat beberapa use case nyata.

---

## 19. Use Case 1 — User Aggregate Cache

Anda ingin menyimpan:

```text
user profile
user settings
user permissions
user session summary
```

Jika sering dibaca bersama dengan `MGET`, gunakan:

```text
identity:user:{u-123}:profile
identity:user:{u-123}:settings
identity:user:{u-123}:permissions
identity:user:{u-123}:session-summary
```

Command:

```redis
MGET identity:user:{u-123}:profile \
     identity:user:{u-123}:settings \
     identity:user:{u-123}:permissions \
     identity:user:{u-123}:session-summary
```

Cluster-safe karena hash tag sama.

Tetapi jika user tertentu bisa sangat hot, pertimbangkan:

- Local cache untuk profile/settings.
- Jangan co-locate semua data user jika tidak perlu.
- Pisahkan session list besar dari profile kecil.

---

## 20. Use Case 2 — Case Management Workflow State

Untuk sistem enforcement/case management, Anda mungkin punya:

```text
case state
case lock
case step counters
case assignment
case transient validation cache
```

Key:

```text
case-mgmt:case:{case-789}:state
case-mgmt:case:{case-789}:lock
case-mgmt:case:{case-789}:step-counter
case-mgmt:case:{case-789}:assignment
case-mgmt:case:{case-789}:validation-cache
```

Ini bagus jika Anda butuh Lua script atomik:

```text
if case state is OPEN and lock is owned by worker X:
    increment step counter
    update assignment marker
```

Semua key dalam script harus satu slot.

Namun jangan memasukkan seluruh tenant ke satu tag:

```text
case-mgmt:tenant:{tenant-1}:case:case-789:state
```

Jika tenant besar, ini bisa menciptakan hot slot.

---

## 21. Use Case 3 — Rate Limiter

Sliding window limiter sering butuh beberapa key dalam satu decision:

```text
current window
previous window
metadata/config
```

Agar Lua script cluster-safe:

```text
rl:{tenant-42|api-payments}:curr:1710000010
rl:{tenant-42|api-payments}:prev:1710000000
rl:{tenant-42|api-payments}:meta
```

Hash tag:

```text
{tenant-42|api-payments}
```

Ini membuat limiter untuk tenant+endpoint co-located.

Tetapi jika satu tenant+endpoint terlalu hot, gunakan subpartition:

```text
rl:{tenant-42|api-payments|bucket-00}:curr
rl:{tenant-42|api-payments|bucket-01}:curr
...
```

Trade-off:

- Lebih scalable.
- Decision global butuh aggregation.
- Atomicity per bucket saja.

---

## 22. Use Case 4 — Delay Queue dengan Sorted Set

Single queue:

```text
delay-queue:{email}:scheduled
delay-queue:{email}:processing
delay-queue:{email}:dead
```

Jika worker memakai Lua untuk move item dari scheduled ke processing, semua key harus satu slot.

Tetapi satu queue global bisa hot. Maka bisa dipartisi:

```text
email-delay:{bucket-00}:scheduled
email-delay:{bucket-00}:processing
email-delay:{bucket-01}:scheduled
email-delay:{bucket-01}:processing
```

Worker pool membaca beberapa bucket.

Trade-off:

- Throughput lebih baik.
- Ordering global hilang.
- Complexity worker meningkat.

---

## 23. Use Case 5 — Idempotency Store

Untuk idempotency per request:

```text
idemp:{tenant-42|request-abc}:state
idemp:{tenant-42|request-abc}:response
```

Jika state dan response harus diakses bersama secara atomic, gunakan hash tag sama.

Namun sering lebih sederhana memakai satu Hash:

```text
idemp:{tenant-42|request-abc}
```

Fields:

```text
status
fingerprint
response
createdAt
completedAt
```

Ini menghindari multi-key command sama sekali.

Pelajaran penting:

> Di Redis Cluster, sering kali desain terbaik adalah mengurangi jumlah key yang perlu disentuh bersama, bukan memaksa banyak key satu slot.

---

## 24. Strategy: Single Key Aggregate vs Multiple Co-Located Keys

Ketika Anda punya data yang harus diakses bersama, ada dua pilihan.

### 24.1 Single Key Aggregate

Contoh Hash:

```text
case-mgmt:case:{case-789}
```

Fields:

```text
state
assignee
lockOwner
version
lastTransitionAt
```

Kelebihan:

- Tidak ada multi-key constraint.
- Satu key satu slot.
- Operasi field-level tersedia.
- Mudah TTL untuk satu aggregate.

Kekurangan:

- Hash bisa menjadi besar.
- Different field lifecycle sulit.
- High write contention pada satu key.
- Tidak semua struktur cocok jadi Hash.

### 24.2 Multiple Co-Located Keys

```text
case-mgmt:case:{case-789}:state
case-mgmt:case:{case-789}:lock
case-mgmt:case:{case-789}:tasks
```

Kelebihan:

- Type bisa berbeda.
- TTL bisa berbeda.
- Struktur lebih spesifik.
- Bisa memisahkan payload besar.

Kekurangan:

- Harus disiplin hash tag.
- Risiko hot slot.
- Lebih banyak key overhead.
- Lua/transaction perlu cluster-safe.

### 24.3 Rule of Thumb

Gunakan single key aggregate ketika:

- Data kecil/sedang.
- Lifecycle sama.
- Akses bersama sering.
- Struktur field-value cukup.

Gunakan multiple co-located keys ketika:

- Data structure berbeda.
- TTL berbeda.
- Ada list/zset/set yang tidak cocok jadi Hash.
- Payload besar perlu dipisah.

Gunakan partitioning ketika:

- Satu aggregate boundary terlalu hot.
- Throughput lebih penting dari atomicity global.

---

## 25. Transactions di Redis Cluster

Redis transaction `MULTI/EXEC` di cluster hanya dapat melibatkan key dalam slot yang sama.

Contoh aman:

```redis
MULTI
SET order:{123}:state PAID
ZADD order:{123}:timeline 1710000000 paid
EXEC
```

Contoh berisiko/gagal:

```redis
MULTI
SET order:123:state PAID
ZADD order:123:timeline 1710000000 paid
EXEC
```

Karena dua key belum tentu satu slot.

### 25.1 WATCH

`WATCH` juga terkena batas key slot. Jika Anda optimistic locking atas beberapa key, pastikan satu slot.

### 25.2 Lua vs Transaction di Cluster

Lua sering lebih baik untuk atomic multi-step logic. Namun batas slot tetap sama.

Jadi pertanyaannya bukan:

> Pakai Lua agar cluster-safe?

Pertanyaan yang benar:

> Apakah semua key yang dipakai Lua berada di slot yang sama?

---

## 26. Redis Cluster dan Consistency

Redis Cluster bukan CP distributed database.

Hal yang perlu dipahami:

1. Replication tetap asynchronous.
2. Failover bisa kehilangan acknowledged writes dalam kondisi tertentu.
3. Client bisa melihat timeout saat failover.
4. Reads dari replica bisa stale.
5. Slot migration bisa menambah redirect dan latency.

### 26.1 Failover Per Shard

Jika primary node A gagal, replica A bisa dipromosikan.

Slot milik A berpindah ke primary baru.

Aplikasi mungkin mengalami:

- Temporary command failure.
- Timeout.
- Redirect.
- Reconnect.
- Possible write loss jika write belum replicated.

### 26.2 Application Contract

Untuk setiap Redis usage, tentukan:

```text
Jika Redis Cluster failover terjadi, apa yang boleh terjadi?

[ ] Request boleh retry?
[ ] Write boleh duplicate?
[ ] Data boleh hilang?
[ ] Cache boleh miss?
[ ] Lock boleh expire?
[ ] Rate limiter boleh fail-open atau fail-closed?
[ ] Idempotency boleh kehilangan state?
```

Tidak semua Redis data punya criticality yang sama.

Cache product detail berbeda dengan idempotency payment request.

---

## 27. Retry Strategy di Redis Cluster

Retry terdengar sederhana, tetapi bisa berbahaya.

### 27.1 Retry Aman untuk Idempotent Reads

```redis
GET key
HGET key field
ZSCORE key member
```

Retry umumnya aman selama timeout dan backoff masuk akal.

### 27.2 Retry Berisiko untuk Mutating Commands

```redis
INCR key
LPUSH queue item
XADD stream * ...
ZADD key score member
```

Jika client timeout setelah server mengeksekusi command, retry bisa menggandakan efek.

Contoh:

```text
Client sends INCR
Redis executes INCR
Network timeout before response
Client retries INCR
Counter increments twice
```

### 27.3 Design Pattern

Untuk mutating command penting:

- Gunakan idempotency token.
- Gunakan Lua compare state.
- Gunakan unique member id untuk ZSET/SET.
- Gunakan deterministic stream ID jika cocok.
- Jangan retry blindly.

### 27.4 Retry Storm

Saat failover/topology change, semua service bisa retry bersamaan.

Mitigasi:

- Exponential backoff.
- Jitter.
- Circuit breaker.
- Request budget.
- Bulkhead.
- Short timeout untuk cache non-critical.
- Fail-open/fail-closed policy eksplisit.

---

## 28. Spring Cache di Redis Cluster

Spring Cache terlihat sederhana:

```java
@Cacheable(cacheNames = "product", key = "#id")
public Product getProduct(String id) { ... }
```

Key mungkin menjadi:

```text
product::123
```

Untuk single-key get/set, ini aman.

Namun masalah muncul ketika:

- Anda melakukan cache eviction by pattern.
- Anda mengandalkan batch clear.
- Anda memakai multi-key get.
- Anda memakai custom CacheManager dengan locking writer.
- Anda mencampur cache key dengan Lua script.

### 28.1 Cache Clear Problem

Membersihkan cache by pattern di cluster bisa mahal karena harus scan banyak node.

Contoh buruk:

```text
Delete all product::*
```

Jika dilakukan sering, ini menjadi maintenance operation berat.

Desain alternatif:

- TTL pendek + versioned key.
- Namespace version key.
- Event-driven invalidation targeted.
- Cache-aside dengan exact key deletion.

### 28.2 Versioned Cache Key

Daripada scan dan delete semua:

```text
product:v42:123
```

Naikkan version:

```text
product current version = v43
```

Key lama akan mati via TTL.

Trade-off:

- Memory sementara naik.
- Invalidation global cepat.
- Perlu TTL disiplin.

---

## 29. Keyspace Notifications di Cluster

Keyspace notifications bisa berguna untuk event lokal seperti expired key, tetapi di cluster:

- Event terjadi di node yang memiliki key.
- Subscriber perlu memahami scope node/cluster.
- Tidak cocok sebagai reliable event stream.

Untuk reliable processing, gunakan Redis Streams atau broker yang sesuai.

Jangan membangun critical workflow hanya dari key expiration event di Redis Cluster.

---

## 30. Operational Commands untuk Memahami Cluster

Beberapa command penting:

```redis
CLUSTER INFO
CLUSTER NODES
CLUSTER SLOTS
CLUSTER KEYSLOT key
CLUSTER COUNTKEYSINSLOT slot
CLUSTER GETKEYSINSLOT slot count
```

### 30.1 `CLUSTER KEYSLOT`

Gunakan untuk validasi hash tag:

```redis
CLUSTER KEYSLOT user:{100}:profile
CLUSTER KEYSLOT user:{100}:settings
```

Keduanya harus menghasilkan slot sama.

### 30.2 `CLUSTER SLOTS`

Menampilkan mapping slot ke node. Client cluster-aware memakai informasi semacam ini untuk routing.

### 30.3 `CLUSTER INFO`

Melihat status cluster seperti:

- cluster_state.
- slots assigned.
- known nodes.
- fail status.

---

## 31. Local Development Redis Cluster

Untuk belajar, Anda bisa menjalankan cluster lokal dengan Docker Compose.

Contoh minimal konseptual:

```yaml
services:
  redis-node-1:
    image: redis:8
    command: ["redis-server", "--cluster-enabled", "yes", "--cluster-config-file", "nodes.conf", "--appendonly", "yes", "--port", "6379"]
    ports:
      - "7001:6379"

  redis-node-2:
    image: redis:8
    command: ["redis-server", "--cluster-enabled", "yes", "--cluster-config-file", "nodes.conf", "--appendonly", "yes", "--port", "6379"]
    ports:
      - "7002:6379"

  redis-node-3:
    image: redis:8
    command: ["redis-server", "--cluster-enabled", "yes", "--cluster-config-file", "nodes.conf", "--appendonly", "yes", "--port", "6379"]
    ports:
      - "7003:6379"
```

Namun Redis Cluster lokal via Docker punya detail networking yang sering membuat pemula bingung, terutama karena node mengiklankan alamat internal container. Untuk lab serius, gunakan setup yang eksplisit dengan `cluster-announce-ip` dan port mapping yang benar, atau gunakan Testcontainers/module yang sudah mengurusnya.

### 31.1 Redis CLI Cluster Mode

Gunakan:

```bash
redis-cli -c -p 7001
```

Opsi `-c` membuat redis-cli mengikuti redirect cluster.

Contoh:

```redis
SET user:1:name Alice
GET user:1:name
```

Jika key ada di slot node lain, CLI akan mengikuti redirect.

---

## 32. Java Lab: Validasi Slot dan Multi-Key

### 32.1 Dependency Lettuce

Maven konseptual:

```xml
<dependency>
  <groupId>io.lettuce</groupId>
  <artifactId>lettuce-core</artifactId>
  <version>${lettuce.version}</version>
</dependency>
```

### 32.2 Slot Validation Helper

Lettuce punya utility untuk menghitung slot.

Contoh konseptual:

```java
import io.lettuce.core.cluster.SlotHash;

public class RedisSlotDemo {
    public static void main(String[] args) {
        print("user:100:profile");
        print("user:100:settings");
        print("user:{100}:profile");
        print("user:{100}:settings");
    }

    static void print(String key) {
        System.out.printf("%-30s -> slot %d%n", key, SlotHash.getSlot(key));
    }
}
```

Expected insight:

```text
user:100:profile      -> maybe slot A
user:100:settings     -> maybe slot B
user:{100}:profile    -> same slot
user:{100}:settings   -> same slot
```

### 32.3 MGET Failure Demo

```java
RedisAdvancedClusterCommands<String, String> commands = connection.sync();

// May fail CROSSSLOT
commands.mget("user:100:profile", "user:100:settings");

// Should be cluster-safe
commands.mget("user:{100}:profile", "user:{100}:settings");
```

### 32.4 Safer Abstraction

Buat helper yang memvalidasi semua key satu slot sebelum menjalankan multi-key operation:

```java
public final class RedisClusterKeyGuard {

    public static void requireSameSlot(List<String> keys) {
        if (keys == null || keys.isEmpty()) {
            throw new IllegalArgumentException("keys must not be empty");
        }

        int expected = SlotHash.getSlot(keys.get(0));

        for (String key : keys) {
            int actual = SlotHash.getSlot(key);
            if (actual != expected) {
                throw new IllegalArgumentException(
                    "Redis Cluster CROSSSLOT risk. Expected slot " + expected +
                    " but key " + key + " is in slot " + actual +
                    ". Keys=" + keys
                );
            }
        }
    }
}
```

Gunakan di repository/service Redis Anda:

```java
public List<KeyValue<String, String>> getUserAggregate(String userId) {
    List<String> keys = List.of(
        "identity:user:{" + userId + "}:profile",
        "identity:user:{" + userId + "}:settings",
        "identity:user:{" + userId + "}:permissions"
    );

    RedisClusterKeyGuard.requireSameSlot(keys);
    return redis.mget(keys.toArray(String[]::new));
}
```

Ini membuat failure lebih cepat terlihat di test/development, bukan baru di production.

---

## 33. Repository Design untuk Redis Cluster

Jangan menyebarkan string key mentah di seluruh codebase.

Buat key factory.

```java
public final class RedisKeys {

    private RedisKeys() {}

    public static String userProfile(String userId) {
        return "identity:user:{" + userId + "}:profile";
    }

    public static String userSettings(String userId) {
        return "identity:user:{" + userId + "}:settings";
    }

    public static String caseState(String caseId) {
        return "case-mgmt:case:{" + caseId + "}:state";
    }

    public static String caseLock(String caseId) {
        return "case-mgmt:case:{" + caseId + "}:lock";
    }
}
```

### 33.1 Tambahkan Test Slot

```java
@Test
void userAggregateKeysMustBeSameSlot() {
    String userId = "u-123";

    List<String> keys = List.of(
        RedisKeys.userProfile(userId),
        RedisKeys.userSettings(userId)
    );

    assertDoesNotThrow(() -> RedisClusterKeyGuard.requireSameSlot(keys));
}
```

### 33.2 Test Anti-Pattern

```java
@Test
void unrelatedUsersShouldNotBeForcedIntoSameSlot() {
    int slot1 = SlotHash.getSlot(RedisKeys.userProfile("u-1"));
    int slot2 = SlotHash.getSlot(RedisKeys.userProfile("u-2"));

    // Not a strict guarantee they differ, but over many samples distribution should spread.
}
```

Better test distribution statistically over many IDs:

```java
@Test
void userKeysShouldDistributeAcrossManySlots() {
    Set<Integer> slots = new HashSet<>();

    for (int i = 0; i < 10_000; i++) {
        slots.add(SlotHash.getSlot(RedisKeys.userProfile("u-" + i)));
    }

    assertTrue(slots.size() > 5_000, "key schema likely over-concentrates slots");
}
```

This is not a perfect mathematical test, but it catches obvious bad hash tags like `{user}`.

---

## 34. Cluster-Safe Lua Script Example

Suppose you want to update case state only if lock token matches.

Keys:

```text
case-mgmt:case:{case-789}:state
case-mgmt:case:{case-789}:lock
```

Lua:

```lua
local stateKey = KEYS[1]
local lockKey = KEYS[2]
local expectedToken = ARGV[1]
local newState = ARGV[2]

local currentToken = redis.call('GET', lockKey)
if currentToken ~= expectedToken then
  return {err = 'LOCK_MISMATCH'}
end

redis.call('SET', stateKey, newState)
return 'OK'
```

Java call must pass same-slot keys:

```java
List<String> keys = List.of(
    RedisKeys.caseState(caseId),
    RedisKeys.caseLock(caseId)
);

RedisClusterKeyGuard.requireSameSlot(keys);
```

If someone changes one key pattern later and breaks hash tag, test should fail.

---

## 35. Cluster and Data Modeling: Avoid Cross-Slot Workflows

A dangerous design:

```text
workflow:{caseId}:state
user:{userId}:workload
tenant:{tenantId}:quota
```

Then one Lua script tries to update all three atomically:

```text
case state + user workload + tenant quota
```

These are different natural partition boundaries. Redis Cluster will not give you cross-shard atomicity.

You need redesign.

### 35.1 Options

#### Option A — Move atomicity to database

Use PostgreSQL/MySQL transaction for authoritative state.

Redis becomes cache/derived state.

#### Option B — Use event-driven reconciliation

Update one Redis boundary atomically, publish event, reconcile other derived keys asynchronously.

#### Option C — Co-locate by larger boundary

Use tenant hash tag:

```text
workflow:{tenantId}:case:{caseId}:state
workflow:{tenantId}:user:{userId}:workload
workflow:{tenantId}:quota
```

But this can create tenant hot slot. Only valid for small tenants or low load.

#### Option D — Partition and accept non-atomicity

Use separate keys and define compensating logic.

### 35.2 Architecture Rule

If you need atomic update across many aggregate boundaries, Redis Cluster is probably not the right transaction authority.

Use Redis for fast state, coordination hints, counters, and cache—not as hidden distributed transaction engine.

---

## 36. Cluster Read Scaling

Redis Cluster spreads data across primaries. Reads go to the primary owning the slot by default.

Some clients/configs allow reading from replicas.

### 36.1 Reading from Replica

Benefits:

- More read throughput.
- Offload primary.
- Useful for read-heavy cache.

Risks:

- Stale reads.
- Replica lag.
- Failover behavior complexity.
- Read-your-write violation.

### 36.2 Use Cases Where Replica Reads May Be Okay

- Product catalog cache.
- Feature flag cache with acceptable propagation delay.
- Public metadata.
- Analytics-ish approximate reads.

### 36.3 Use Cases Where Replica Reads Are Dangerous

- Idempotency check.
- Lock ownership.
- Rate limiter decision.
- Payment/session security state.
- Workflow transition guard.

Rule:

> If correctness depends on latest value, read primary.

---

## 37. Memory Distribution and Slot Distribution

Even if slots are evenly distributed, memory might not be.

Why?

Because slots do not contain equal data sizes.

Example:

```text
slot 100 contains 10 small keys
slot 101 contains 2 huge sorted sets
```

Both are one slot, but memory/load differs dramatically.

### 37.1 Monitor Per Node

Track per node:

- Used memory.
- Memory fragmentation.
- Evicted keys.
- Expired keys.
- Commandstats.
- CPU.
- Network input/output.
- Latency.
- Key count.

### 37.2 Monitor Per Key Pattern

Per-node metrics are not enough. You need application-level key pattern metrics:

```text
cache:product:* count/value size/hit ratio
rate:* counter count/write QPS
idemp:* count/TTL distribution
stream:* pending length
```

Redis itself does not know your bounded context semantics.

---

## 38. Big Keys in Cluster

A big key is bad in single Redis. In cluster, it is still bad and can be worse operationally.

Examples:

- Hash with millions of fields.
- Set with millions of members.
- ZSET leaderboard too large.
- List queue with unbounded backlog.
- Stream without trimming.
- Huge JSON document.

### 38.1 Why Big Keys Hurt Cluster

- Slot migration is slower.
- Delete can be expensive.
- Memory imbalance.
- Latency spikes.
- Backup/rewrite pressure.
- Hot node concentration.

### 38.2 Mitigation

- Shard application-level structure.
- Trim streams/lists.
- Use TTL.
- Use `UNLINK` over `DEL` for large deletes where appropriate.
- Use bounded sorted sets.
- Use separate storage for large payloads.

---

## 39. Cluster-Safe Pattern Matrix

| Pattern | Cluster-safe by default? | Notes |
|---|---:|---|
| Single-key cache | Yes | Key maps to one slot |
| `MGET` unrelated keys | No | Group by slot or avoid |
| User aggregate with `{userId}` | Yes | Watch hot users |
| Tenant-wide `{tenantId}` | Maybe | Risk hot slot for large tenant |
| Lua with multiple keys | Only same slot | Validate in tests |
| Distributed lock per resource | Yes if one key | Multi-key lock needs same slot |
| Rate limiter per principal | Yes if single key | Multi-window Lua needs same tag |
| Global leaderboard | Single key yes, scaling no | Can be hot/big |
| Delay queue global ZSET | Single key yes, scaling no | Partition if needed |
| Cross-entity transaction | No | Use DB/event workflow |
| Pattern delete | Operationally expensive | Use versioning/TTL |

---

## 40. Architecture Decision Framework

When considering Redis Cluster, ask these questions.

### 40.1 Capacity

```text
Can one Redis primary handle memory and throughput?
If yes, do we really need Cluster now?
```

Cluster adds complexity. Do not use it only because it sounds production-grade.

### 40.2 Key Independence

```text
Are most operations single-key?
```

Redis Cluster works best when operations are mostly single-key or naturally co-located.

### 40.3 Multi-Key Boundaries

```text
Which keys must be read/written atomically together?
What hash tag will co-locate them?
Can this boundary become hot?
```

### 40.4 Failure Semantics

```text
During failover, may operation retry?
May data be stale?
May write be lost?
Should app fail-open or fail-closed?
```

### 40.5 Operational Maturity

```text
Can the team observe per-node memory, latency, redirects, slot balance, hot keys?
Can the team reshard safely?
Can the client handle topology change?
```

### 40.6 Simpler Alternative

```text
Would Sentinel be enough?
Would DB partitioning be better?
Would application-level sharding be clearer?
Would managed Redis reduce operational burden?
```

---

## 41. Common Anti-Patterns

### 41.1 Assuming Prefix Controls Slot

Bad assumption:

```text
user:100:profile and user:100:settings are colocated because prefix is same
```

Reality:

```text
Only hash tag controls co-location predictably.
```

### 41.2 Global Hash Tag

Bad:

```text
cache:{global}:product:1
cache:{global}:product:2
cache:{global}:product:3
```

This defeats sharding.

### 41.3 Multi-Key Code Tested Only on Single Redis

Tests pass locally, fail in production cluster.

Mitigation:

- Run integration tests against Redis Cluster.
- Validate slot in unit tests for key factories.

### 41.4 Using Redis Cluster as Distributed Transaction Store

Bad:

```text
Update user + account + tenant + workflow atomically in Redis Cluster
```

Use database transaction or workflow/event model.

### 41.5 Ignoring MOVED/ASK Metrics

Redirects are not just noise. Sustained redirect rate can indicate stale topology, resharding, or client misconfiguration.

### 41.6 Over-Co-Location

Hash tag everything by tenant because it makes multi-key easy.

Then one large tenant melts one slot.

### 41.7 No Slot-Aware Test

Key naming changes can silently break Lua/multi-key operations.

Add tests.

---

## 42. Production Readiness Checklist

### 42.1 Application Checklist

```text
[ ] Java client is cluster-aware.
[ ] Timeouts configured explicitly.
[ ] Retry policy differs for read vs write commands.
[ ] Topology refresh configured and tested.
[ ] Key factories centralize key naming.
[ ] Multi-key operations validate same slot.
[ ] Lua scripts validate same-slot keys.
[ ] Cache clear does not rely on production KEYS.
[ ] Failover behavior tested.
[ ] Resharding behavior tested or understood.
```

### 42.2 Key Schema Checklist

```text
[ ] Every key pattern documented.
[ ] Hash tag documented.
[ ] Co-location reason documented.
[ ] Cardinality estimated.
[ ] QPS estimated.
[ ] Hot key risk assessed.
[ ] TTL documented.
[ ] Value size budgeted.
[ ] Owner service documented.
```

### 42.3 Ops Checklist

```text
[ ] Per-node memory dashboard.
[ ] Per-node CPU dashboard.
[ ] Per-node latency dashboard.
[ ] Redirect/MOVED/ASK visibility.
[ ] Hot key detection process.
[ ] Big key detection process.
[ ] Backup/restore tested if persistence matters.
[ ] Failover drill performed.
[ ] Resharding runbook exists.
[ ] Client version compatibility tracked.
```

### 42.4 Safety Checklist

```text
[ ] Dangerous commands restricted by ACL.
[ ] TLS/auth configured where needed.
[ ] No public exposure.
[ ] Admin commands separated from app path.
[ ] Cluster endpoints handled securely.
```

---

## 43. Failure Mode Table

| Failure | Symptom | Likely Cause | Mitigation |
|---|---|---|---|
| `CROSSSLOT` | Multi-key command fails | Keys not same slot | Hash tags, redesign, group by slot |
| Many `MOVED` | Higher latency/errors | Stale topology/failover | Topology refresh, client config |
| Many `ASK` | Redirect during migration | Resharding | Monitor, ensure client supports ASK |
| One node high CPU | Hot slot/key | Bad tag or hot workload | Hot key mitigation, repartition |
| One node high memory | Uneven data size | Big keys/slot imbalance | Reshard, split big structures |
| Failover write anomalies | Missing recent writes | Async replication | App-level idempotency/reconciliation |
| Retry duplicates | Counter/list double update | Timeout after execution | Idempotent write design |
| Pattern delete slow | Latency spike | Cluster-wide scan/delete | Versioned keys, targeted invalidation |
| Lua script fails | CROSSSLOT | KEYS in different slots | Key guard/tests |

---

## 44. Lab Exercises

### Exercise 1 — Slot Awareness

1. Generate 1000 keys with pattern:

```text
user:<id>:profile
```

2. Generate 1000 keys with pattern:

```text
user:{<id>}:profile
```

3. Compare distribution.
4. Verify related keys for same user share slot only with hash tag.

### Exercise 2 — CROSSSLOT Reproduction

Run on Redis Cluster:

```redis
MGET user:1:profile user:1:settings
```

Then:

```redis
MGET user:{1}:profile user:{1}:settings
```

Observe difference.

### Exercise 3 — Lua Same-Slot Validation

Write Lua script touching two keys.

Try keys without hash tag. Observe failure.

Try keys with hash tag. Observe success.

### Exercise 4 — Bad Hash Tag Distribution

Create keys:

```text
cache:{global}:item:<id>
```

Check slot distribution. Then fix to:

```text
cache:item:{<id>}
```

Discuss trade-off.

### Exercise 5 — Client Topology Change

If you have local cluster tooling:

1. Start cluster.
2. Run Java loop doing `GET`/`SET`.
3. Trigger reshard/failover.
4. Observe timeout, `MOVED`, `ASK`, recovery behavior.
5. Tune topology refresh.

---

## 45. Practical Java Abstraction: Slot-Aware Redis Gateway

For serious systems, create a Redis access layer with explicit methods rather than exposing raw RedisTemplate everywhere.

Example boundary:

```java
public interface CaseRedisGateway {
    Optional<CaseState> getCaseState(String caseId);
    boolean transitionIfLocked(String caseId, String lockToken, CaseState newState);
    void cacheValidationResult(String caseId, ValidationResult result, Duration ttl);
}
```

Implementation owns:

- Key naming.
- Serialization.
- Slot validation.
- Lua invocation.
- Metrics.
- Timeout policy.
- Error classification.

Avoid this:

```java
@Autowired RedisTemplate<String, Object> redisTemplate;
```

used freely by every service class.

That makes cluster constraints invisible and uncontrolled.

---

## 46. Design Review Questions

When reviewing Redis Cluster usage, ask:

1. Which operations are single-key?
2. Which operations are multi-key?
3. Are all multi-key operations same-slot by construction?
4. Where is key naming centralized?
5. Are hash tags documented?
6. Could any hash tag become hot?
7. Are Lua scripts slot-safe?
8. Are transactions slot-safe?
9. How does the Java client refresh topology?
10. What happens during failover?
11. What happens during resharding?
12. What commands are retried?
13. Are mutating retries idempotent?
14. How are hot keys detected?
15. How are big keys detected?
16. Is cache invalidation cluster-safe?
17. Is Redis being used as hidden source of truth?
18. If Redis loses latest write, what breaks?
19. Can this design run on single-node local dev but fail in cluster?
20. Is there an integration test using actual Redis Cluster?

---

## 47. Mental Model Summary

Redis Cluster is simple if you keep one invariant in mind:

```text
Every key belongs to exactly one hash slot.
Every hash slot belongs to one primary at a time.
Multi-key atomicity only works inside one hash slot.
```

Everything else follows:

- Hash tags control co-location.
- Bad hash tags create hot slots.
- Client must route by slot.
- Topology can change.
- `MOVED` means update routing.
- `ASK` means temporary migration redirect.
- Resharding moves slots, not arbitrary semantic partitions.
- Failover is per shard and still has consistency trade-offs.
- Redis Cluster scales keyspace, not cross-key transactions.

The best Redis Cluster designs are boring:

- Mostly single-key commands.
- Explicit hash tags only where needed.
- No accidental global co-location.
- Slot-aware tests.
- Strong client configuration.
- Clear failure semantics.
- Good observability.

The worst Redis Cluster designs hide distributed complexity behind a generic cache/repository abstraction until production traffic exposes it.

---

## 48. What You Should Be Able to Do After This Part

After this part, you should be able to:

1. Explain why Redis Cluster has 16,384 hash slots.
2. Explain how key maps to slot.
3. Explain why prefix does not guarantee co-location.
4. Use hash tags correctly.
5. Identify dangerous hash tags.
6. Predict `CROSSSLOT` failures.
7. Design cluster-safe multi-key operations.
8. Understand `MOVED` vs `ASK`.
9. Configure Java clients with cluster awareness.
10. Recognize hot key, hot slot, and hot node as different problems.
11. Evaluate whether Redis Cluster is appropriate for a workload.
12. Review Redis key schema for cluster readiness.

---

## 49. Referensi Teknis

Referensi utama yang relevan untuk part ini:

- Redis Cluster specification — hash slots, hash tags, redirection, cluster behavior.
- Redis clustering best practices with keys — hash tag planning and multi-key constraints.
- Redis Java clients documentation — Lettuce/Jedis cluster-aware usage.
- Lettuce production usage — topology refresh and Redis Cluster client behavior.
- Spring Data Redis documentation — Redis Cluster configuration and RedisTemplate behavior.

---

## 50. Status Seri

```text
Part 022 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-023.md
```

Part berikutnya akan membahas:

```text
Part 023 — Memory Engineering: The Most Important Redis Skill
```

Topik berikutnya sangat penting karena Redis Cluster sering dipakai untuk scaling, tetapi scaling Redis pada akhirnya tetap dibatasi oleh memory model, key overhead, value encoding, fragmentation, big keys, eviction, dan kapasitas per node.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Replication, Sentinel, Failover: Availability dengan Trade-Off</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-023.md">Part 023 — Memory Engineering: The Most Important Redis Skill ➡️</a>
</div>
