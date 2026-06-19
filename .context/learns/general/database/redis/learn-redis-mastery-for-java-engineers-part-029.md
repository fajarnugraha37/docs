# learn-redis-mastery-for-java-engineers-part-029.md

# Part 029 — Operations: Backup, Upgrade, Migration, Disaster Recovery

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `029`  
> Target pembaca: Java software engineer / tech lead yang ingin memakai Redis secara production-grade  
> Fokus: operasi Redis sebagai komponen kritikal — backup, restore, upgrade, migration, DR, runbook, dan game day

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- data model Redis;
- TTL dan eviction;
- caching architecture;
- rate limiting;
- idempotency;
- lock;
- Lua dan Redis Functions;
- Pub/Sub dan Streams;
- persistence;
- replication;
- Sentinel;
- Cluster;
- memory engineering;
- latency engineering;
- Java clients;
- transactions;
- security;
- observability.

Bagian ini mengikat semuanya ke dalam pertanyaan operasional:

> Kalau Redis dipakai di production, bagaimana kita menjaga Redis tetap recoverable, upgradeable, migratable, observable, dan tidak menjadi single point of irreversible damage?

Redis sering terlihat sederhana karena developer dapat menjalankannya dengan:

```bash
redis-server
```

Lalu dari Java:

```java
redisTemplate.opsForValue().set("user:123", payload);
```

Tetapi production Redis bukan sekadar proses yang menyimpan key-value.

Production Redis adalah komponen stateful yang punya konsekuensi:

- data bisa hilang;
- data bisa stale;
- failover bisa menyebabkan rollback efektif terhadap write terbaru;
- backup bisa tidak bisa dipakai saat restore;
- upgrade bisa mengubah behavior command, module, persistence, protocol, ACL, atau client compatibility;
- migration bisa memindahkan key tetapi merusak TTL, slot locality, serialization contract, atau ownership;
- disaster recovery bisa berhasil secara infrastruktur tetapi gagal secara business correctness.

Bagian ini tidak akan mengulang teori Redis dasar. Kita akan fokus pada **operational reasoning**.

---

## 1. Mental Model: Redis Operations Adalah Tentang State Risk

Redis operational risk dapat disederhanakan menjadi empat pertanyaan besar.

```text
1. Kalau Redis mati, apa yang hilang?
2. Kalau Redis kembali hidup, apakah data yang kembali benar?
3. Kalau Redis pindah node/version/topology, apakah aplikasi tetap kompatibel?
4. Kalau Redis rusak diam-diam, seberapa cepat kita tahu dan pulih?
```

Banyak tim menjawab pertanyaan ini terlalu dangkal:

```text
Redis cuma cache, jadi aman.
```

Masalahnya, dalam sistem nyata, Redis yang awalnya “cuma cache” sering berkembang menjadi tempat menyimpan:

- session;
- rate limiter quota;
- idempotency key;
- distributed lock;
- deduplication window;
- workflow transient state;
- delayed job;
- feature evaluation cache;
- user presence;
- pending Redis Stream messages;
- leaderboard;
- temporary entitlement;
- fraud/risk velocity counter;
- API token state;
- retry guard;
- compliance UI state.

Sebagian data itu memang boleh hilang. Sebagian tidak.

Maka Redis operations harus dimulai dengan klasifikasi state.

---

## 2. Klasifikasi State Redis

Sebelum membahas backup/restore/upgrade, klasifikasikan semua keyspace.

Gunakan tabel mental berikut.

| Kelas State | Contoh | Boleh Hilang? | Boleh Stale? | Butuh Backup? | Butuh Restore? |
|---|---|---:|---:|---:|---:|
| Pure cache | cache profile dari DB | Ya | Ya, dalam batas TTL | Biasanya tidak | Biasanya tidak |
| Rebuildable derived state | leaderboard dari event log | Mungkin | Mungkin | Opsional | Rebuild lebih baik |
| Ephemeral coordination | lock, semaphore, in-flight marker | Ya, tapi hati-hati | Tidak | Tidak | Tidak |
| Transient business state | idempotency, rate quota, session | Tergantung | Tergantung | Sering ya | Sering ya |
| Queue/stream state | pending Redis Stream entries | Tidak selalu | Tidak | Ya jika Redis jadi transport utama | Ya |
| Source-of-truth misuse | user balance di Redis | Tidak | Tidak | Wajib, tapi desain perlu ditinjau | Wajib |

Rule penting:

> Backup strategy tidak ditentukan oleh Redis. Backup strategy ditentukan oleh arti bisnis dari key.

Kalau semua key dicampur dalam satu Redis tanpa ownership dan klasifikasi, operasi menjadi berbahaya.

Contoh keyspace campur aduk:

```text
cache:user:123
session:abc
ratelimit:tenant-a:/api/payments
lock:case:991
stream:notification
idempotency:payment:uuid-123
leaderboard:monthly
```

Pertanyaan penting:

```text
Apakah semuanya harus dibackup?
Apakah semuanya harus direstore?
Apakah semuanya boleh ikut failover?
Apakah semuanya boleh ikut migration?
Apakah semuanya punya RTO/RPO sama?
```

Jawabannya hampir pasti tidak.

---

## 3. Redis Deployment Topology dan Konsekuensi Operasional

Sebelum operasi, pahami topologi.

### 3.1 Single Redis Instance

```text
App -> Redis primary
```

Kelebihan:

- sederhana;
- mudah debug;
- cocok untuk development atau cache non-kritikal;
- biaya rendah.

Risiko:

- single point of failure;
- downtime saat restart;
- restore manual;
- scaling terbatas;
- failover tidak otomatis.

Cocok untuk:

- local development;
- CI;
- internal tool rendah risiko;
- cache yang benar-benar disposable.

Tidak cocok untuk:

- session critical;
- distributed rate limit critical;
- Redis Stream penting;
- workload bisnis yang butuh availability tinggi.

### 3.2 Primary-Replica

```text
App -> Redis primary
             |
             v
          replica
```

Kelebihan:

- ada replica;
- bisa backup dari replica;
- bisa read-scaling terbatas;
- bisa manual failover.

Risiko:

- replication async;
- replica bisa stale;
- failover manual rawan human error;
- write terbaru bisa hilang jika primary mati sebelum replicate.

### 3.3 Sentinel

```text
       Sentinel quorum
          /   |   \
App -> primary -> replica
```

Kelebihan:

- monitoring;
- automatic failover;
- service discovery untuk primary baru;
- cocok untuk HA non-clustered.

Risiko:

- split-brain jika konfigurasi/quorum buruk;
- client harus Sentinel-aware;
- failover tetap tidak menghilangkan async replication loss;
- operational complexity naik.

### 3.4 Redis Cluster

```text
App -> Cluster nodes
       slot 0..16383
```

Kelebihan:

- horizontal scale;
- shard by hash slot;
- failover per shard;
- memory capacity lebih besar.

Risiko:

- multi-key constraint;
- resharding complexity;
- hot slot;
- client harus cluster-aware;
- migration lebih kompleks;
- backup/restore harus mempertimbangkan slot dan node.

### 3.5 Managed Redis

Contoh bentuk managed Redis:

- AWS ElastiCache / MemoryDB;
- Google Memorystore;
- Azure Cache for Redis;
- Redis Cloud;
- Redis Enterprise.

Kelebihan:

- provisioning mudah;
- patching lebih mudah;
- monitoring basic;
- backup sering built-in;
- failover managed.

Risiko:

- provider-specific behavior;
- versi/feature mungkin tidak sama dengan Redis OSS;
- network/security configuration tetap tanggung jawab tim;
- restore/migration tetap harus diuji;
- cost surprise;
- parameter/configuration terbatas.

Rule:

> Managed service mengurangi sebagian beban operasi, bukan menghilangkan operational reasoning.

---

## 4. RTO dan RPO Redis

Dua istilah penting:

```text
RTO = Recovery Time Objective
Berapa lama sistem boleh tidak tersedia?

RPO = Recovery Point Objective
Seberapa banyak data terbaru boleh hilang?
```

Untuk Redis, RTO/RPO harus per use case.

Contoh:

| Use Case | RTO | RPO | Catatan |
|---|---:|---:|---|
| Product cache | 5-15 menit | Banyak data boleh hilang | Bisa warm ulang |
| Session store | < 5 menit | Beberapa detik/menit mungkin terasa ke user | User logout massal bisa terjadi |
| Rate limiter | < 1 menit | Counter bisa reset sebagian | Bisa menyebabkan quota bypass |
| Idempotency key | < 1 menit | Kehilangan key bisa duplicate processing | Risiko bisnis tinggi |
| Redis Stream job | < 5 menit | Pending message hilang berisiko | Perlu backup/persistence/consumer recovery |
| Lock | Cepat | Tidak perlu preserve lock lama | Restore lock lama justru berbahaya |

Kesalahan umum:

```text
Kita backup Redis tiap 1 jam.
```

Kalimat ini tidak cukup. Pertanyaan sebenarnya:

```text
Apakah kehilangan idempotency key 59 menit masih aman?
Apakah kehilangan rate limit counter 59 menit masih aman?
Apakah restore session lama aman?
Apakah restore lock lama berbahaya?
```

---

## 5. Backup Redis: Apa yang Sebenarnya Dibackup?

Redis persistence umumnya menghasilkan dua bentuk utama:

1. RDB snapshot;
2. AOF log.

### 5.1 RDB Snapshot

RDB adalah snapshot point-in-time.

Karakteristik:

- compact;
- cepat untuk loading dibanding replay AOF besar;
- cocok untuk backup periodik;
- memiliki data loss window sejak snapshot terakhir;
- membuat snapshot membutuhkan fork dan copy-on-write memory overhead.

Contoh konfigurasi historis:

```conf
save 900 1
save 300 10
save 60 10000
```

Artinya kira-kira:

```text
snapshot jika dalam 900 detik ada minimal 1 perubahan,
atau dalam 300 detik ada minimal 10 perubahan,
atau dalam 60 detik ada minimal 10000 perubahan.
```

Catatan: konfigurasi aktual bisa berbeda antar versi/distribusi/managed provider.

### 5.2 AOF

AOF menyimpan command write dalam append-only file.

Karakteristik:

- bisa memberikan durability lebih baik daripada RDB periodik;
- replay saat startup bisa lebih lama;
- file bisa membesar sehingga perlu rewrite;
- fsync policy menentukan trade-off latency vs data loss.

Contoh konfigurasi:

```conf
appendonly yes
appendfsync everysec
```

Fsync policy umum:

| Policy | Makna | Trade-off |
|---|---|---|
| `always` | fsync setiap write | lebih durable, lebih lambat |
| `everysec` | fsync sekitar tiap detik | umum dipakai, bisa kehilangan sekitar 1 detik |
| `no` | serahkan ke OS | lebih cepat, data loss window lebih besar |

### 5.3 RDB + AOF

Banyak deployment memakai kombinasi:

```text
RDB untuk snapshot/backup compact.
AOF untuk recovery dengan data loss window lebih kecil.
```

Namun kombinasi ini bukan free lunch:

- disk usage naik;
- rewrite/load behavior perlu dipahami;
- recovery drill wajib;
- file corruption handling harus diuji;
- backup harus konsisten.

---

## 6. Backup Strategy Berdasarkan Use Case

### 6.1 Jika Redis Hanya Pure Cache

Backup mungkin tidak perlu.

Yang perlu:

- source of truth tetap sehat;
- cache warm-up strategy;
- fallback behavior;
- rate limit terhadap DB saat cache kosong;
- staggered warm-up;
- dashboard cache hit ratio.

Runbook:

```text
1. Redis hilang.
2. Aplikasi masuk degraded mode.
3. Cache miss naik.
4. DB load naik.
5. Autoscale/fallback/protective throttling aktif.
6. Cache warm ulang bertahap.
```

Bahaya terbesar bukan kehilangan cache, tetapi **cache avalanche** ke database.

### 6.2 Jika Redis Menyimpan Session

Backup perlu dipertimbangkan, tetapi restore session lama juga punya risiko.

Risiko restore session:

- session yang sudah logout bisa hidup kembali;
- privilege lama bisa kembali;
- user experience kacau;
- token/session expiration bisa tidak sesuai ekspektasi;
- security incident jika session revocation tidak terjaga.

Alternative design:

- session short-lived;
- token revocation disimpan di source of truth atau durable store;
- login ulang lebih aman daripada restore session lama;
- gunakan rolling restart/failover daripada disaster restore untuk session.

### 6.3 Jika Redis Menyimpan Idempotency Key

Ini serius.

Kehilangan idempotency key bisa membuat request yang sama diproses ulang.

Contoh:

```text
POST /payments
Idempotency-Key: abc
```

Jika key hilang setelah payment berhasil, retry dari client bisa membuat duplicate payment kecuali sistem downstream punya guard lain.

Strategi:

- Redis idempotency key hanya optimization jika DB juga punya unique constraint;
- untuk pembayaran/enforcement, durable idempotency record lebih aman di database;
- Redis bisa dipakai sebagai fast-path guard;
- audit state tetap di durable store;
- backup Redis tidak boleh menjadi satu-satunya jaminan exactly-once.

### 6.4 Jika Redis Menyimpan Rate Limit

Kehilangan counter bisa menyebabkan quota reset.

Dampak:

- abuse window;
- tenant melebihi quota;
- compliance issue jika rate limit bagian enforcement;
- cost spike.

Strategi:

- pahami apakah reset quota sementara acceptable;
- gunakan shorter windows untuk membatasi blast radius;
- untuk quota financial/legal, simpan ledger durable di DB;
- Redis counter dapat menjadi real-time guard, bukan final billing authority.

### 6.5 Jika Redis Streams Dipakai untuk Work Queue

Jika Redis Streams menjadi transport utama, persistence/backup menjadi jauh lebih penting.

Yang harus dipikirkan:

- apakah stream entries boleh hilang?
- apakah pending entries list harus recover?
- apakah consumer bisa replay dari source lain?
- apakah trimming policy aman?
- apakah backup restore membuat message lama diproses ulang?
- apakah consumer idempotent?

Rule:

> Redis Stream consumer harus idempotent karena restore/failover/reclaim bisa menyebabkan duplicate processing.

---

## 7. Backup dari Primary vs Replica

### 7.1 Backup dari Primary

Kelebihan:

- data paling baru;
- tidak bergantung pada replica lag.

Kekurangan:

- snapshot/fork dapat menambah load pada primary;
- copy-on-write memory spike bisa mengganggu;
- disk I/O bisa mempengaruhi latency;
- berisiko pada workload high-write.

### 7.2 Backup dari Replica

Kelebihan:

- mengurangi beban primary;
- lebih aman untuk latency write path;
- umum untuk backup periodik.

Kekurangan:

- replica bisa lag;
- backup mungkin tidak mengandung write terbaru;
- jika replica sudah corrupt/stale, backup ikut salah;
- perlu monitor replication offset/lag.

### 7.3 Practical Rule

```text
Untuk workload write-heavy, ambil backup dari replica jika memungkinkan.
Tetapi tetap ukur replication lag dan validasi backup.
```

Backup yang tidak pernah direstore hanyalah file dekoratif.

---

## 8. Backup Checklist

Checklist minimal:

```text
[ ] Semua keyspace Redis sudah diklasifikasikan.
[ ] RTO/RPO per use case jelas.
[ ] Persistence mode jelas: none/RDB/AOF/RDB+AOF.
[ ] Backup frequency sesuai RPO.
[ ] Backup location tidak berada hanya di node Redis yang sama.
[ ] Backup encrypted at rest.
[ ] Backup access dibatasi.
[ ] Backup retention jelas.
[ ] Restore diuji berkala.
[ ] Restore diuji ke environment terisolasi.
[ ] TTL preservation diverifikasi.
[ ] Key count/cardinality diverifikasi.
[ ] Sample semantic validation dilakukan.
[ ] Redis version compatibility diuji.
[ ] Runbook restore tersedia.
[ ] Owner backup jelas.
```

---

## 9. Restore: Operasi yang Lebih Penting Daripada Backup

Backup adalah proses menulis file.
Restore adalah proses membuktikan sistem bisa hidup lagi dengan benar.

Banyak tim punya backup tapi tidak punya restore confidence.

### 9.1 Restore Questions

Sebelum restore, jawab:

```text
Restore ke mana?
Node sama atau node baru?
Version Redis sama atau beda?
Topology sama atau beda?
Standalone ke standalone?
Standalone ke cluster?
Cluster ke cluster?
Apakah TTL tetap valid?
Apakah session lama aman dikembalikan?
Apakah lock lama harus dibuang?
Apakah stream consumer akan duplicate process?
Apakah cache lama akan overwrite data baru?
```

### 9.2 Restore All vs Selective Restore

Kadang restore semua key berbahaya.

Contoh:

```text
Restore lock:* dari backup lama
```

Ini buruk. Lock lama tidak merepresentasikan realitas saat ini.

Contoh lain:

```text
Restore session:* dari backup 6 jam lalu
```

Ini bisa menghidupkan session yang seharusnya expired atau logout.

Maka keyspace harus punya restore policy.

| Key Pattern | Restore? | Catatan |
|---|---:|---|
| `cache:*` | Biasanya tidak | Rebuild lebih aman |
| `lock:*` | Tidak | State koordinasi lama berbahaya |
| `session:*` | Tergantung | Pertimbangkan security |
| `idempotency:*` | Ya untuk window kritikal | Tapi sebaiknya DB juga punya guard |
| `ratelimit:*` | Tergantung | Restore lama bisa salah secara quota |
| `stream:*` | Ya jika Redis transport utama | Consumer harus idempotent |
| `leaderboard:*` | Tergantung | Bisa rebuild dari event/source |

### 9.3 Restore Drill

Minimal drill:

```text
1. Ambil backup production-like.
2. Restore ke Redis baru.
3. Jalankan validation script.
4. Jalankan aplikasi staging terhadap Redis restored.
5. Simulasikan traffic read/write.
6. Verifikasi TTL, key count, memory, command behavior.
7. Simulasikan consumer Redis Streams.
8. Catat waktu total restore.
9. Bandingkan dengan RTO.
10. Catat data loss window.
11. Bandingkan dengan RPO.
```

---

## 10. Semantic Validation Setelah Restore

Validasi restore tidak cukup dengan:

```bash
redis-cli DBSIZE
```

Butuh semantic validation.

Contoh script konseptual:

```text
Check key count by namespace.
Check TTL distribution.
Check no lock namespace restored.
Check sample session expires in reasonable range.
Check stream last IDs.
Check pending entries count.
Check top N hot keys exist if expected.
Check serialized payload can be decoded by current Java app.
```

Contoh pendek dengan `redis-cli`:

```bash
redis-cli --scan --pattern 'session:*' | head
redis-cli --scan --pattern 'lock:*' | head
redis-cli INFO memory
redis-cli INFO persistence
redis-cli INFO keyspace
```

Untuk production besar, jangan sembarang scan tanpa pertimbangan. Gunakan sampling, batch, dan jalankan di environment restore.

### 10.1 Java Compatibility Validation

Redis menyimpan bytes/string. Aplikasi Java yang menafsirkan maknanya.

Masalah restore sering muncul karena:

- class DTO berubah;
- JSON schema berubah;
- field mandatory baru tidak ada;
- enum value berubah;
- serializer berubah;
- compression flag berubah;
- key versioning tidak ada;
- app versi baru membaca payload versi lama.

Maka validasi restore harus mencakup decoding.

Contoh pseudo-code:

```java
record RedisPayloadValidationResult(
    String key,
    boolean valid,
    String error
) {}

public RedisPayloadValidationResult validateUserCache(String key, String rawJson) {
    try {
        UserCacheDto dto = objectMapper.readValue(rawJson, UserCacheDto.class);
        if (dto.userId() == null) {
            return new RedisPayloadValidationResult(key, false, "missing userId");
        }
        return new RedisPayloadValidationResult(key, true, null);
    } catch (Exception e) {
        return new RedisPayloadValidationResult(key, false, e.getMessage());
    }
}
```

Lesson:

> Redis backup restore is not validated until the application can read the restored data correctly.

---

## 11. Upgrade Redis: Bukan Hanya Naik Versi

Upgrade Redis terlihat sederhana:

```text
Redis 7.x -> Redis 8.x
```

Tetapi secara operasional, upgrade dapat menyentuh:

- command behavior;
- persistence format;
- module/data type availability;
- ACL categories;
- TLS behavior;
- cluster protocol;
- replication compatibility;
- client library compatibility;
- managed provider limitations;
- memory usage;
- config defaults;
- deprecation;
- performance profile;
- security patches.

### 11.1 Upgrade Drivers

Alasan upgrade:

- security fix;
- bug fix;
- performance improvement;
- feature baru;
- managed provider EOL;
- Redis Stack/Redis 8 feature consolidation;
- compliance requirement;
- client compatibility;
- support lifecycle.

Alasan buruk:

```text
Versi baru keluar, jadi langsung upgrade production.
```

### 11.2 Upgrade Risk Classes

| Risk | Contoh |
|---|---|
| Client compatibility | Lettuce/Jedis lama tidak paham topology/protocol tertentu |
| Data compatibility | RDB/AOF dari versi baru belum tentu aman downgrade |
| Command behavior | command deprecated/changed edge behavior |
| Module/feature | RedisJSON/Search/vector behavior berbeda |
| Config | default maxmemory/persistence/TLS/ACL berbeda |
| Performance | memory overhead atau latency berubah |
| Operational | failover saat rolling upgrade gagal |

---

## 12. Upgrade Strategy

### 12.1 Read Release Notes

Jangan upgrade tanpa membaca release notes.

Cari:

```text
Breaking changes
Security fixes
Persistence compatibility
Cluster changes
Replication changes
Module changes
Deprecated commands/configs
Known issues
Client compatibility notes
```

### 12.2 Build Compatibility Matrix

Contoh matrix:

| Component | Current | Target | Compatibility Status |
|---|---:|---:|---|
| Redis Server | 7.2.x | 8.x | Need test |
| Lettuce | 6.x | 6.x/7.x | Need confirm |
| Spring Data Redis | 3.x | 3.x/4.x | Need confirm |
| RedisJSON/Search usage | yes/no | yes/no | Need test |
| Sentinel/Cluster | Cluster | Cluster | Need failover test |
| Persistence | AOF+RDB | AOF+RDB | Need recovery test |
| TLS/ACL | yes | yes | Need connection test |

### 12.3 Test Upgrade in Staging with Production-Like Data

Testing with empty Redis is not enough.

Need:

- realistic key count;
- realistic value size;
- realistic TTL distribution;
- realistic command mix;
- realistic client concurrency;
- realistic cluster topology;
- realistic failover scenario.

### 12.4 Rolling Upgrade

Untuk HA topology, rolling upgrade sering digunakan.

Konsep umum:

```text
1. Upgrade replica first.
2. Let replica sync and stabilize.
3. Failover to upgraded replica.
4. Upgrade old primary.
5. Repeat per shard if cluster.
```

Tetapi detailnya tergantung deployment.

Managed provider mungkin punya proses sendiri.

### 12.5 Blue/Green Redis Upgrade

Blue/green lebih aman untuk upgrade besar atau migration besar.

```text
Blue Redis = current production
Green Redis = new version/topology
```

Strategi:

1. Provision Green.
2. Migrate/sync data.
3. Run shadow validation.
4. Point a small percentage traffic.
5. Monitor.
6. Gradual cutover.
7. Keep Blue as rollback window.
8. Decommission after confidence.

Trade-off:

- lebih aman;
- lebih mahal;
- butuh data sync strategy;
- dual-write bisa kompleks;
- consistency harus dirancang.

---

## 13. Upgrade Checklist

```text
[ ] Release notes dibaca.
[ ] Breaking changes dicatat.
[ ] Security fixes dipahami.
[ ] Client compatibility dicek.
[ ] Spring Data Redis compatibility dicek.
[ ] Persistence compatibility diuji.
[ ] Backup tersedia sebelum upgrade.
[ ] Restore backup diuji sebelum upgrade.
[ ] Staging upgrade dilakukan dengan data production-like.
[ ] Load test dilakukan.
[ ] Failover test dilakukan.
[ ] Rollback plan jelas.
[ ] Downgrade limitation dipahami.
[ ] Monitoring dashboard siap.
[ ] Alert sementara diperketat.
[ ] Owner upgrade jelas.
[ ] Freeze window dikomunikasikan.
```

---

## 14. Rollback: Jangan Asumsikan Bisa Downgrade

Salah satu asumsi berbahaya:

```text
Kalau gagal, tinggal downgrade Redis.
```

Tidak selalu.

Alasannya:

- persistence file dari versi baru mungkin tidak backward compatible;
- command/feature baru mungkin menulis format baru;
- module metadata bisa berubah;
- cluster metadata bisa berubah;
- managed provider mungkin tidak support downgrade;
- client sudah deploy dengan behavior baru.

Rollback yang lebih realistis:

```text
Restore backup pre-upgrade ke environment Redis versi lama,
redirect traffic kembali,
dan pastikan data selama upgrade window diperlakukan secara eksplisit.
```

Ini berarti rollback juga punya RPO.

---

## 15. Migration Redis

Migration berbeda dari upgrade.

Upgrade:

```text
Redis version changes.
```

Migration:

```text
Data/topology/provider/location/key schema changes.
```

Jenis migration:

1. standalone ke standalone;
2. standalone ke Sentinel;
3. standalone ke Cluster;
4. Cluster ke Cluster;
5. self-hosted ke managed;
6. managed provider A ke provider B;
7. single tenant Redis ke multi tenant Redis atau sebaliknya;
8. key schema migration;
9. serializer migration;
10. Redis logical database split.

---

## 16. Migration Strategy Patterns

### 16.1 Snapshot Restore Migration

```text
Stop writes -> backup -> restore target -> switch app
```

Kelebihan:

- sederhana;
- deterministic;
- cocok untuk downtime window.

Kekurangan:

- butuh write freeze;
- downtime bisa besar;
- data berubah selama migration harus dicegah;
- sulit untuk high-availability system.

Cocok untuk:

- internal system;
- small data;
- maintenance window;
- non-critical cache.

### 16.2 Live Replication Migration

```text
Source Redis -> Target Redis replication/sync -> cutover
```

Kelebihan:

- downtime lebih rendah;
- target warm sebelum cutover.

Kekurangan:

- compatibility/topology constraint;
- tidak semua provider mendukung;
- ACL/network/TLS complexity;
- lag perlu dimonitor.

### 16.3 Dual Write Migration

```text
App writes to Source and Target
Reads from Source initially
Validate Target
Cut reads to Target
Stop Source writes
```

Kelebihan:

- fleksibel;
- bisa migrasi schema/serializer;
- cocok untuk application-level migration.

Kekurangan:

- dual-write partial failure;
- ordering issue;
- consistency complexity;
- perlu reconciliation;
- code lebih kompleks.

Pattern Java:

```java
public void writeSession(String sessionId, SessionPayload payload) {
    try {
        oldRedis.set(sessionKey(sessionId), encodeOld(payload));
    } catch (Exception e) {
        metrics.increment("redis.old.write.failure");
        throw e;
    }

    try {
        newRedis.set(sessionKeyV2(sessionId), encodeNew(payload));
    } catch (Exception e) {
        metrics.increment("redis.new.write.failure");
        // Decision point:
        // fail request?
        // continue and reconcile later?
        // enqueue repair?
        throw e;
    }
}
```

Dual-write decision must be explicit.

Bad:

```java
oldRedis.set(k, v);
try {
    newRedis.set(k, v);
} catch (Exception ignored) {
}
```

This creates silent divergence.

### 16.4 Read Repair Migration

```text
Read from new.
If miss, read from old.
If found, write to new.
```

Cocok untuk cache/session-ish data.

Pseudo-code:

```java
public Optional<UserCache> getUser(String userId) {
    String newKey = "v2:user-cache:" + userId;
    String oldKey = "user-cache:" + userId;

    String v2 = newRedis.get(newKey);
    if (v2 != null) {
        return Optional.of(decodeV2(v2));
    }

    String old = oldRedis.get(oldKey);
    if (old == null) {
        return Optional.empty();
    }

    UserCache decoded = decodeOld(old);
    newRedis.setex(newKey, 3600, encodeV2(decoded));
    return Optional.of(decoded);
}
```

Risiko:

- long tail old keys tidak pernah migrasi;
- first read latency lebih tinggi;
- decode old harus tetap dipertahankan;
- expiry semantics harus hati-hati.

### 16.5 Shadow Read Validation

```text
Read real path from old.
Also read target in background.
Compare result.
Emit metric.
Do not affect response.
```

Ini sangat berguna sebelum cutover.

Pseudo-code:

```java
UserProfile result = oldCache.get(userId);

executor.submit(() -> {
    try {
        UserProfile candidate = newCache.get(userId);
        if (!Objects.equals(normalize(result), normalize(candidate))) {
            metrics.increment("redis.migration.shadow_mismatch");
        }
    } catch (Exception e) {
        metrics.increment("redis.migration.shadow_error");
    }
});

return result;
```

Catatan:

- jangan shadow compare raw serialized value jika schema berubah;
- compare semantic normalized form;
- sampling lebih aman untuk high traffic.

---

## 17. Migrasi ke Redis Cluster: Perhatikan Key Design

Migrasi dari standalone ke Cluster adalah salah satu migration paling tricky.

Masalah utama:

```text
Multi-key command yang dulu berhasil bisa gagal CROSSSLOT.
```

Contoh command:

```bash
MGET user:1 user:2
```

Di Cluster, kedua key bisa beda slot.

Kalau aplikasi bergantung pada operasi multi-key atomic, migrasi ke Cluster bisa memecahkan correctness.

### 17.1 Hash Tags

Hash tag memaksa bagian tertentu dipakai sebagai hash slot.

Contoh:

```text
tenant:{123}:user:1
tenant:{123}:quota
```

Kedua key memiliki hash tag `{123}` sehingga masuk slot sama.

Ini berguna untuk operasi yang harus co-located.

Risiko:

- hash tag terlalu luas menciptakan hot slot;
- hash tag terlalu sempit membuat multi-key tetap gagal;
- key naming jadi kontrak arsitektur.

### 17.2 Cluster Migration Checklist

```text
[ ] Inventory semua multi-key command.
[ ] Inventory Lua scripts yang memakai beberapa key.
[ ] Inventory transactions/WATCH.
[ ] Inventory pipelines multi-key.
[ ] Tentukan hash tag policy.
[ ] Cek hot tenant risk.
[ ] Test CROSSSLOT in staging.
[ ] Pastikan client Java cluster-aware.
[ ] Pastikan topology refresh aktif.
[ ] Test MOVED/ASK handling.
[ ] Test resharding under load.
```

---

## 18. Key Schema Migration

Redis key schema adalah API internal antar versi aplikasi.

Contoh v1:

```text
user:123
```

v2:

```text
user-profile:v2:123
```

Atau lebih structured:

```text
svc:identity:user-profile:v2:{userId}:snapshot
```

### 18.1 Mengapa Perlu Versioned Key

Karena value format bisa berubah.

Tanpa versioned key:

```text
user:123 -> old JSON
user:123 -> new JSON
```

Aplikasi lama dan baru bisa saling merusak data.

Dengan versioned key:

```text
user-profile:v1:123
user-profile:v2:123
```

Lebih aman untuk rolling deploy.

### 18.2 Migration Policy

Untuk setiap key pattern, tetapkan:

```text
Owner service
Value format
TTL
Migration method
Read fallback
Write behavior
Delete behavior
Sunset date
Validation metric
```

Contoh tabel:

| Key Pattern | Owner | Migration | Fallback | Sunset |
|---|---|---|---|---|
| `user-cache:v1:{id}` | identity-service | read repair ke v2 | yes | 30 hari |
| `session:v1:{id}` | auth-service | no migration, expire naturally | no | TTL max 8 jam |
| `ratelimit:v1:{tenant}` | api-gateway | dual-write 7 hari | no | setelah window habis |
| `lock:v1:*` | multiple | no migration | no | expire naturally |

---

## 19. Serializer Migration untuk Java

Java systems sering punya masalah serializer.

Contoh serializer:

- JDK serialization;
- JSON Jackson;
- Smile/CBOR;
- Kryo;
- Protobuf;
- Avro;
- custom binary;
- compressed JSON.

Migration serializer harus hati-hati.

### 19.1 Jangan Ubah Serializer Diam-Diam

Bad:

```java
RedisTemplate<String, Object> redisTemplate = new RedisTemplate<>();
redisTemplate.setValueSerializer(new GenericJackson2JsonRedisSerializer());
```

Lalu di release berikutnya:

```java
redisTemplate.setValueSerializer(new StringRedisSerializer());
```

Key lama tidak bisa dibaca.

### 19.2 Versioned Envelope

Gunakan envelope:

```json
{
  "schemaVersion": 2,
  "codec": "json",
  "createdAt": "2026-06-20T10:15:00Z",
  "payload": {
    "userId": "123",
    "displayName": "Ari"
  }
}
```

Atau binary envelope dengan prefix:

```text
MAGIC | VERSION | CODEC | PAYLOAD
```

### 19.3 Dual Decoder

Selama migration:

```java
public UserSession decode(byte[] bytes) {
    if (looksLikeV2(bytes)) {
        return decodeV2(bytes);
    }
    return decodeV1(bytes);
}
```

Rule:

> Decoder harus lebih backward-compatible daripada encoder.

Encoder boleh menulis format baru. Decoder harus bisa membaca format lama selama TTL/migration window.

---

## 20. Disaster Recovery Redis

Disaster recovery berbeda dari failover.

Failover:

```text
Primary mati, replica dipromosikan.
```

Disaster recovery:

```text
Region/provider/cluster/data corrupted/hilang.
Pulihkan layanan dari backup atau site lain.
```

### 20.1 DR Scenarios

Contoh skenario:

1. node Redis crash;
2. primary dan replica hilang;
3. cluster metadata rusak;
4. data corrupt karena bug aplikasi;
5. operator menjalankan `FLUSHALL`;
6. eviction menghapus key kritikal;
7. region cloud outage;
8. credentials bocor;
9. upgrade gagal;
10. migration cutover salah;
11. Redis memory penuh dan write gagal;
12. backup ternyata tidak bisa direstore.

DR plan harus mencakup skenario berbeda, bukan hanya “server mati”.

---

## 21. DR Architecture Options

### 21.1 Backup/Restore DR

```text
Backup periodically -> store offsite -> restore during disaster
```

Kelebihan:

- sederhana;
- biaya rendah.

Kekurangan:

- RTO lebih tinggi;
- RPO tergantung backup frequency;
- restore manual/semimanual;
- tidak cocok untuk very low downtime.

### 21.2 Warm Standby

```text
Primary Redis in Region A
Standby Redis in Region B receives periodic sync/restore
```

Kelebihan:

- RTO lebih baik;
- environment target sudah tersedia.

Kekurangan:

- sync lag;
- cost lebih tinggi;
- cutover logic;
- validation complexity.

### 21.3 Active-Active / Multi-Region

Redis OSS tidak otomatis memberikan active-active multi-master conflict resolution sederhana.

Beberapa enterprise/managed product punya solusi aktif-aktif dengan CRDT atau mekanisme khusus, tetapi itu bukan asumsi default Redis OSS.

Untuk Java architect, pertanyaannya:

```text
Apakah kita benar-benar butuh active-active Redis?
Apa conflict semantics-nya?
Apakah rate limiter global harus strongly consistent?
Apakah session bisa regional?
Apakah cache bisa per-region?
```

Sering kali solusi lebih baik:

- cache per region;
- session sticky/regional;
- source of truth global di database/event log;
- Redis hanya local acceleration;
- enforcement final dilakukan di durable layer.

---

## 22. DR Runbook

Runbook harus executable, bukan dokumen abstrak.

Contoh struktur:

```text
Title: Redis DR Runbook
Owner: Platform Team
Scope: redis-prod-cache-cluster
Last tested: 2026-xx-xx
RTO: 30 minutes
RPO: 5 minutes for idempotency keys, best-effort for cache
```

### 22.1 Trigger Criteria

```text
Declare Redis DR if:
- Primary and replicas unavailable > 5 minutes.
- Cluster cannot elect stable primary.
- Data corruption confirmed in critical namespace.
- Region unavailable.
- Security incident requires Redis credential rotation plus rebuild.
```

### 22.2 Immediate Actions

```text
1. Freeze dangerous writes if needed.
2. Disable consumers if duplicate processing risk exists.
3. Capture current state if available.
4. Notify incident channel.
5. Assign incident commander.
6. Confirm Redis scope and affected services.
```

### 22.3 Restore Decision

```text
Restore full backup?
Restore selected keyspace?
Rebuild cache from source?
Start empty Redis?
Fail over to standby?
```

Decision matrix:

| Scenario | Action |
|---|---|
| Pure cache lost | Start empty + controlled warm-up |
| Session lost | Decide login reset vs restore |
| Idempotency lost | Restore if safe + rely DB uniqueness |
| Streams lost | Restore/replay source + idempotent consumers |
| Locks lost | Do not restore locks |
| Corrupt application data | Prefer point-in-time restore before corruption |

### 22.4 Validation

```text
1. Redis reachable.
2. AUTH/ACL works.
3. TLS works.
4. Key count within expected range.
5. Critical namespaces present/absent as intended.
6. TTL distribution valid.
7. Java app can decode sample payload.
8. Latency normal.
9. Memory headroom sufficient.
10. Replication healthy.
11. Cluster slots stable if cluster.
```

### 22.5 Cutover

```text
1. Update service discovery/endpoint.
2. Roll application config if needed.
3. Restart/reconnect clients carefully.
4. Monitor connection storm.
5. Gradually re-enable consumers.
6. Monitor error rate, latency, DB load, duplicate processing.
```

### 22.6 Post-Recovery

```text
1. Keep incident open through stabilization window.
2. Compare actual RTO/RPO.
3. Identify data loss.
4. Run reconciliation.
5. Document duplicate/missing processing.
6. Update runbook.
7. Add missing alert/test.
```

---

## 23. Handling Catastrophic Commands

Redis security/ops must treat some commands as catastrophic.

Examples:

```text
FLUSHALL
FLUSHDB
CONFIG SET
SHUTDOWN
SCRIPT KILL
FUNCTION DELETE
ACL SETUSER
KEYS on huge DB
EVAL expensive script
```

Protection:

- ACL restrict dangerous commands;
- separate admin user;
- production shell access limited;
- command renaming if appropriate in older setups;
- audited break-glass process;
- backups before high-risk operations;
- use staging rehearsal;
- disable wildcard admin access for apps.

For Java app user, never grant broad admin permission.

Bad:

```text
app user can run @all
```

Better:

```text
app user can run only required read/write commands for its key patterns
```

---

## 24. Memory-Full Incident Runbook

Redis memory-full incidents are common.

Symptoms:

- `OOM command not allowed when used memory > maxmemory`;
- latency spike;
- eviction spike;
- cache hit ratio drops;
- write failure;
- app retry storm;
- CPU spike;
- DB load increases.

### 24.1 Immediate Questions

```text
Is maxmemory configured?
What eviction policy?
Is this cache or critical state?
Is eviction happening?
Are writes failing?
Which namespace grew?
Any recent deploy?
Any TTL missing?
Any big key?
Any hot key causing amplification?
```

### 24.2 Commands

Use with care:

```bash
redis-cli INFO memory
redis-cli INFO stats
redis-cli INFO keyspace
redis-cli MEMORY STATS
redis-cli --bigkeys
redis-cli --hotkeys
```

Caution:

- `--bigkeys` scans;
- `--hotkeys` requires LFU policy to be meaningful in standard usage;
- run during incident carefully;
- prefer replica/staging when possible.

### 24.3 Possible Actions

```text
1. Increase memory if safe.
2. Add/adjust TTL for offending namespace.
3. Delete non-critical keyspace carefully.
4. Stop traffic source causing growth.
5. Disable feature flag.
6. Scale cluster if cluster.
7. Enable/adjust eviction only if semantics allow.
8. Fix app bug.
```

Danger:

```bash
redis-cli FLUSHALL
```

This is not an incident response. This is a destructive action requiring explicit approval.

---

## 25. Latency Incident Runbook

Symptoms:

- Java Redis timeout;
- pool wait high;
- p99/p999 latency spike;
- slowlog entries;
- CPU high;
- network retransmits;
- blocked clients;
- command queue buildup.

### 25.1 Immediate Questions

```text
Is Redis CPU saturated?
Is one command slow?
Is network degraded?
Is there a big key operation?
Is there a Lua/function running too long?
Is persistence rewrite/fork happening?
Is AOF fsync slow?
Is client connection pool exhausted?
Is retry storm happening?
```

### 25.2 Commands

```bash
redis-cli INFO commandstats
redis-cli SLOWLOG GET 20
redis-cli LATENCY DOCTOR
redis-cli INFO clients
redis-cli INFO persistence
redis-cli INFO cpu
```

### 25.3 Java-Side Checks

Check:

- Redis command latency metric;
- connection pool wait;
- command timeout count;
- retry count;
- event loop saturation if reactive;
- serialization time;
- GC pause;
- network client errors;
- topology refresh logs for cluster.

### 25.4 Mitigation

```text
1. Stop expensive command source.
2. Kill or isolate slow scripts if safe.
3. Disable problematic feature.
4. Reduce batch size.
5. Increase timeout only if root cause understood.
6. Add circuit breaker to protect Redis.
7. Scale/read-shard if architecture supports.
8. Reshard hot slot if cluster issue.
```

Increasing timeout is often not a fix. It can just hide queueing until everything collapses slower.

---

## 26. Connection Storm During Restart/Failover

Redis restart/failover can cause many Java app instances to reconnect at once.

Symptoms:

- connection refused spike;
- CPU spike after Redis returns;
- auth handshakes spike;
- app thread pools blocked;
- retry storm;
- cache stampede;
- DB traffic spike.

Mitigation:

- jittered reconnect;
- bounded retries;
- circuit breaker;
- bulkhead for Redis access;
- cache fallback;
- request coalescing;
- warm-up throttling;
- avoid all pods restarting simultaneously;
- readiness probes that check dependencies sensibly.

Bad Java behavior:

```text
Every request immediately retries Redis 3 times, then DB.
```

Better:

```text
Redis unavailable -> short circuit for a cooldown -> controlled fallback -> limited DB pressure.
```

---

## 27. Game Day Exercises

Game day adalah latihan failure secara sengaja.

Tujuannya bukan membuat sistem rusak. Tujuannya membuktikan runbook dan observability.

### 27.1 Exercise 1 — Empty Cache Rebuild

Scenario:

```text
Flush cache namespace in staging.
```

Measure:

- cache miss spike;
- DB load;
- warm-up time;
- p99 latency;
- error rate;
- protection behavior.

Pass criteria:

```text
System remains available.
DB does not collapse.
Cache warms gradually.
Alerts fire correctly.
```

### 27.2 Exercise 2 — Redis Down

Scenario:

```text
Stop Redis in staging.
```

Measure:

- Java timeout behavior;
- circuit breaker;
- fallback;
- retry count;
- user-facing error;
- recovery after Redis returns.

Pass criteria:

```text
No retry storm.
No thread exhaustion.
Service degradation is controlled.
```

### 27.3 Exercise 3 — Replica Lag / Failover

Scenario:

```text
Simulate failover to replica under write load.
```

Measure:

- lost writes;
- stale reads;
- client reconnect time;
- error spike;
- duplicate processing.

Pass criteria:

```text
App reconnects.
Data-loss assumptions match RPO.
Consumers recover idempotently.
```

### 27.4 Exercise 4 — Restore Backup

Scenario:

```text
Restore latest backup to isolated Redis.
```

Measure:

- restore duration;
- key count;
- TTL validity;
- application decode success;
- stream pending behavior.

Pass criteria:

```text
Actual restore time <= RTO.
Data loss <= RPO.
Semantic validation passes.
```

### 27.5 Exercise 5 — Big Key Incident

Scenario:

```text
Introduce large key in staging.
```

Measure:

- memory spike;
- slow command;
- latency;
- big key detection;
- alerting.

Pass criteria:

```text
Big key detected.
Runbook identifies namespace.
Mitigation works.
```

---

## 28. Operational Ownership Model

Redis often fails organizationally before technically.

Questions:

```text
Who owns Redis?
Platform team?
Application team?
Database team?
Each service team?
```

Ambiguous ownership causes:

- no one owns memory growth;
- no one owns key naming;
- no one owns backup validation;
- no one owns Redis client config;
- no one owns incident runbook;
- no one owns upgrade;
- no one owns cost.

A mature model separates:

| Responsibility | Owner |
|---|---|
| Infrastructure provisioning | Platform/SRE |
| Redis version and patching | Platform/SRE |
| Key namespace ownership | Application team |
| Serialization contract | Application team |
| Backup policy | Joint |
| Restore testing | Joint |
| Security/ACL | Platform + App |
| Memory budget | App + Platform |
| Incident command | Defined by severity |

Rule:

> Platform can operate Redis infrastructure, but application teams must own Redis semantics.

---

## 29. Redis Runbook Template

Gunakan template ini untuk setiap Redis deployment.

```markdown
# Redis Runbook: <deployment-name>

## 1. Scope
- Environment:
- Region:
- Topology:
- Redis version:
- Managed/self-hosted:
- Owner team:

## 2. Keyspace Inventory
| Pattern | Owner | Purpose | TTL | Criticality | Restore Policy |
|---|---|---|---:|---|---|

## 3. RTO/RPO
| Use Case | RTO | RPO | Notes |
|---|---:|---:|---|

## 4. Persistence
- RDB:
- AOF:
- fsync:
- backup frequency:
- retention:
- backup location:

## 5. Security
- TLS:
- ACL users:
- dangerous command policy:
- secret rotation:

## 6. Monitoring
- dashboards:
- alerts:
- SLO:
- slowlog policy:

## 7. Common Incidents
- Redis down:
- memory full:
- latency high:
- failover:
- corrupt data:
- accidental delete:

## 8. Restore Procedure
- backup source:
- restore target:
- validation steps:
- cutover steps:
- rollback steps:

## 9. Upgrade Procedure
- release notes:
- compatibility matrix:
- staging test:
- rollout plan:
- rollback plan:

## 10. Last Game Day
- date:
- scenario:
- result:
- follow-up:
```

---

## 30. Architecture Decision Record Template

Redis operational choices should be documented as ADR.

```markdown
# ADR: Redis Persistence and DR Strategy for <service>

## Status
Accepted / Proposed / Deprecated

## Context
<Service> uses Redis for:
- cache:
- session:
- idempotency:
- stream:

## Decision
We will use:
- topology:
- persistence:
- backup frequency:
- restore policy:
- keyspace classification:

## Rationale
Why this trade-off is acceptable:

## Consequences
Positive:
- ...

Negative:
- ...

## RTO/RPO
- RTO:
- RPO:

## Failure Modes
- Redis unavailable:
- Redis data loss:
- failover stale read:
- backup restore duplicate processing:

## Validation
- restore drill frequency:
- game day frequency:
- monitoring:
```

---

## 31. Common Operational Anti-Patterns

### 31.1 “Redis Cuma Cache” Tapi Menyimpan Critical State

Gejala:

```text
Tidak ada backup.
Tapi Redis berisi session, idempotency, quota, stream.
```

Fix:

- inventory keyspace;
- klasifikasi state;
- pindahkan critical truth ke durable store;
- Redis sebagai acceleration layer.

### 31.2 Backup Ada, Restore Tidak Pernah Diuji

Gejala:

```text
Backup success metric hijau.
Tidak ada yang tahu cara restore.
```

Fix:

- scheduled restore drill;
- semantic validation;
- RTO/RPO measurement.

### 31.3 Upgrade Tanpa Client Compatibility Test

Gejala:

```text
Redis upgrade sukses.
Java client mulai error topology/protocol/TLS.
```

Fix:

- compatibility matrix;
- staging with real client versions;
- canary.

### 31.4 Restore Semua Key Tanpa Filter

Gejala:

```text
lock lama hidup lagi.
session lama hidup lagi.
cache lama overwrite reality.
```

Fix:

- restore policy per namespace;
- selective restore;
- rebuild disposable data.

### 31.5 No Memory Budget

Gejala:

```text
Redis growing until OOM.
```

Fix:

- per-namespace memory budget;
- TTL enforcement;
- alerts;
- capacity review.

### 31.6 Dual Write Tanpa Reconciliation

Gejala:

```text
Migrasi terlihat berhasil, tapi target Redis diam-diam missing data.
```

Fix:

- explicit dual-write failure policy;
- reconciliation job;
- shadow read metrics;
- cutover criteria.

---

## 32. Production Readiness Checklist

Sebelum Redis dipakai production:

```text
[ ] Redis use case diklasifikasikan.
[ ] Redis bukan source of truth tanpa keputusan eksplisit.
[ ] Key namespace punya owner.
[ ] TTL policy jelas.
[ ] Persistence mode sesuai kebutuhan.
[ ] Backup strategy sesuai RPO.
[ ] Restore drill sudah pernah berhasil.
[ ] Failover behavior sudah diuji.
[ ] Java client reconnect behavior sudah diuji.
[ ] Timeout/retry/circuit breaker sudah dikonfigurasi.
[ ] Serialization contract versioned atau backward-compatible.
[ ] ACL minimal privilege.
[ ] TLS/network isolation sesuai requirement.
[ ] Observability dashboard tersedia.
[ ] Memory alert tersedia.
[ ] Latency alert tersedia.
[ ] Slowlog dipantau.
[ ] Upgrade plan tersedia.
[ ] DR runbook tersedia.
[ ] Game day dilakukan periodik.
```

---

## 33. Practical Example: Redis Used for Cache + Idempotency + Rate Limit

Misal service Java `payment-api` memakai Redis untuk:

```text
cache: merchant profile
idempotency: payment request
rate limit: tenant payment API
lock: payment method mutation
```

### 33.1 Keyspace

```text
payment-api:cache:merchant:v1:{merchantId}
payment-api:idempotency:v1:{tenantId}:{idempotencyKey}
payment-api:ratelimit:v1:{tenantId}:{window}
payment-api:lock:v1:{paymentMethodId}
```

### 33.2 Restore Policy

| Pattern | Restore? | Reason |
|---|---:|---|
| cache merchant | No | Rebuild dari DB |
| idempotency | Yes, if within active idempotency window | Prevent duplicate payment |
| rate limit | Maybe | Depends enforcement requirement |
| lock | No | Old lock invalid/dangerous |

### 33.3 Backup Policy

```text
RDB every 5 minutes from replica.
AOF everysec if Redis is relied upon for idempotency fast path.
Critical idempotency also stored in SQL unique table for final guard.
```

### 33.4 DR Policy

```text
If Redis lost:
- cache starts empty;
- idempotency falls back to SQL guard;
- rate limiter enters stricter local degraded limit;
- locks expire/disappear; mutation path relies DB optimistic locking;
- Redis restored only for idempotency namespace if safe.
```

This is robust because Redis failure does not imply duplicate payment or uncontrolled write.

---

## 34. What Top Engineers Do Differently

Top Redis operators do not merely know commands.

They know:

```text
This key can be lost.
This key cannot be lost.
This key must never be restored.
This namespace can be rebuilt.
This namespace needs durable guard elsewhere.
This migration needs dual decoder.
This upgrade cannot be rolled back by downgrading.
This failover can lose acknowledged writes.
This cache outage can kill the database.
This Redis Stream consumer must be idempotent.
This ACL should not allow FLUSHALL.
This backup is meaningless until restored.
```

That is the difference between using Redis and operating Redis.

---

## 35. Summary

Redis operations are mostly about making implicit state assumptions explicit.

Key points:

1. Backup policy must follow state classification.
2. RTO/RPO must be defined per Redis use case, not per server only.
3. RDB and AOF have different durability and performance trade-offs.
4. Backup without restore drill is not a recovery strategy.
5. Restore must be semantic, not only file-level.
6. Some keys should not be restored, especially locks and some ephemeral coordination state.
7. Upgrade requires release notes, compatibility matrix, staging, backup, and rollback plan.
8. Downgrade is not always possible.
9. Migration requires careful handling of key schema, serializers, TTL, cluster slots, and dual-write failure.
10. Disaster recovery must include cache avalanche, duplicate processing, lost idempotency, stale sessions, and region failure.
11. Java applications must be designed with bounded timeout, retries, fallback, serialization compatibility, and reconnect behavior.
12. Operational ownership must be clear between platform and application teams.

---

## 36. Practice Tasks

### Task 1 — Inventory Redis Keyspace

Ambil salah satu service yang memakai Redis. Buat tabel:

```text
Key pattern
Owner
Purpose
TTL
Criticality
Can lose?
Can restore?
Source of truth?
```

### Task 2 — RTO/RPO Definition

Untuk setiap Redis use case, tentukan:

```text
RTO
RPO
Failure behavior
Fallback behavior
```

### Task 3 — Restore Drill Design

Tulis prosedur restore:

```text
Where is backup?
How to restore?
How to validate?
How to cut over?
How to rollback?
```

### Task 4 — Migration Plan

Rancang migrasi key:

```text
user-cache:v1:{id}
```

ke:

```text
identity:user-profile:v2:{id}:snapshot
```

Sertakan:

- read fallback;
- dual decoder;
- TTL handling;
- sunset date;
- shadow validation metric.

### Task 5 — Game Day

Pilih satu skenario:

```text
Redis down
memory full
backup restore
failover
cache empty
```

Tentukan:

- expected alerts;
- expected app behavior;
- pass/fail criteria;
- data loss expectation.

---

## 37. Bridge ke Part Berikutnya

Part berikutnya adalah:

```text
learn-redis-mastery-for-java-engineers-part-030.md
```

Judul:

```text
Testing Redis-Backed Systems
```

Kita akan membahas bagaimana menguji sistem yang bergantung pada Redis:

- unit vs integration test;
- Testcontainers Redis;
- TTL/expiration test;
- concurrency test;
- Lua test;
- failover simulation;
- timeout/failure injection;
- cache invalidation regression;
- load testing;
- Java testing architecture.

Redis yang tidak diuji terhadap failure hanya terlihat benar saat demo.

---

## Status Seri

```text
Part 029 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-030.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Observability: Metrics, Logs, Traces, Slowlog, Commandstats</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-030.md">Part 030 — Testing Redis-Backed Systems ➡️</a>
</div>
