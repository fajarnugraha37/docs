# learn-redis-mastery-for-java-engineers-part-023.md

# Part 023 — Memory Engineering: The Most Important Redis Skill

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `023`  
> Topik: Redis Memory Engineering, Capacity Planning, Big Keys, Hot Keys, Eviction Safety, Fragmentation  
> Target pembaca: Java software engineer yang ingin memakai Redis secara production-grade, bukan sekadar bisa menjalankan command Redis.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami bahwa kapasitas Redis terutama ditentukan oleh **memory budget**, bukan jumlah key saja.
2. Membedakan `used_memory`, `used_memory_rss`, allocator fragmentation, dataset memory, overhead, replication backlog, client buffer, Lua/function memory, dan module/index memory.
3. Mendesain key/value Redis dengan sadar terhadap biaya memory.
4. Mengidentifikasi **big key**, **hot key**, dan **unbounded keyspace** sebelum menjadi incident.
5. Membuat estimasi kapasitas Redis yang cukup realistis untuk design review.
6. Memilih data structure Redis dengan pertimbangan memory, latency, dan operability.
7. Menentukan kapan eviction aman, kapan berbahaya, dan kapan `noeviction` lebih benar.
8. Membuat checklist memory readiness untuk service Java yang memakai Redis.

Bagian ini penting karena Redis adalah sistem yang sering gagal bukan karena algoritma Redis buruk, tetapi karena aplikasi memperlakukan memory sebagai detail sekunder.

Di Redis, memory adalah **storage**, **working set**, **index**, **queue**, **cache**, **coordination state**, dan kadang **operational blast radius** sekaligus.

---

## 1. Mental Model Utama: Redis Bukan “Database Kecil”, Redis Adalah Memory Budget yang Bisa Di-query

Banyak engineer memulai Redis dengan pertanyaan:

> “Berapa juta key yang bisa ditampung Redis?”

Pertanyaan itu kurang tepat.

Pertanyaan yang lebih benar:

> “Berapa byte rata-rata per logical entity, termasuk key name, value, object overhead, encoding overhead, allocator fragmentation, metadata, replication overhead, client buffers, persistence overhead, dan safety headroom?”

Redis menyimpan data terutama di memory. Jadi kapasitasnya bukan hanya:

```text
jumlah_key × ukuran_value
```

Tetapi lebih mirip:

```text
total_memory_required = dataset_payload
                      + key_overhead
                      + value_object_overhead
                      + data_structure_overhead
                      + allocator_overhead
                      + fragmentation
                      + replication_backlog
                      + client_buffers
                      + module_or_index_memory
                      + persistence_copy_on_write_headroom
                      + operational_safety_headroom
```

Inilah alasan Redis sering terlihat “boros” kalau dibandingkan file, database row, atau Java object yang kamu kira sederhana. Redis memberikan latency sangat rendah karena data berada di memory dan struktur datanya siap dieksekusi, tetapi itu berarti setiap byte punya konsekuensi langsung terhadap biaya, stabilitas, dan availability.

---

## 2. Redis Memory Bukan Satu Angka

Saat melihat Redis, jangan hanya melihat satu metric. Redis memory punya beberapa lapisan.

### 2.1 `used_memory`

`used_memory` adalah memory yang dialokasikan Redis lewat allocator untuk menyimpan data dan struktur internal.

Ini angka yang sering dijadikan baseline:

```bash
redis-cli INFO memory
```

Contoh field yang relevan:

```text
used_memory:1073741824
used_memory_human:1.00G
used_memory_rss:1342177280
used_memory_peak:2147483648
used_memory_dataset:850000000
used_memory_overhead:220000000
mem_fragmentation_ratio:1.25
allocator_frag_ratio:1.08
allocator_rss_ratio:1.12
maxmemory:3221225472
maxmemory_policy:allkeys-lfu
```

Interpretasi awal:

| Metric | Makna Praktis |
|---|---|
| `used_memory` | Memory yang Redis pakai menurut allocator |
| `used_memory_rss` | Memory fisik yang terlihat dipakai proses Redis oleh OS |
| `used_memory_peak` | Puncak historical memory usage |
| `used_memory_dataset` | Estimasi memory untuk dataset utama |
| `used_memory_overhead` | Overhead internal Redis |
| `mem_fragmentation_ratio` | Rasio RSS terhadap used memory |
| `allocator_frag_ratio` | Fragmentation di allocator |
| `maxmemory` | Limit memory yang dikonfigurasi |
| `maxmemory_policy` | Policy saat limit tercapai |

Redis mendokumentasikan bahwa `used_memory_rss` yang jauh lebih besar dari `used_memory` bisa mengindikasikan fragmentation eksternal, sedangkan `used_memory` yang jauh lebih besar dari RSS bisa berarti sebagian memory terswap ke disk, yang dapat menyebabkan latency signifikan.

### 2.2 `used_memory_rss`

RSS adalah Resident Set Size, yaitu memory fisik yang sedang dipakai proses Redis menurut OS.

Kalau:

```text
used_memory_rss >> used_memory
```

maka kemungkinan:

1. Ada fragmentation.
2. Redis pernah memakai memory jauh lebih besar lalu turun, tetapi allocator/OS belum mengembalikan memory.
3. Ada overhead allocator.
4. Ada pola alokasi/dealokasi yang membuat memory tidak kompak.

Kalau:

```text
used_memory >> used_memory_rss
```

ini lebih berbahaya. Ini bisa berarti memory Redis terswap. Redis yang terswap bukan lagi Redis yang low-latency.

### 2.3 Dataset Memory vs Overhead

Redis membedakan memory untuk dataset dan overhead internal.

Secara konseptual:

```text
used_memory = dataset_memory + overhead_memory + allocator_effects
```

Dataset memory adalah data yang kamu anggap sebagai “isi Redis”. Overhead memory adalah biaya agar Redis bisa mengelola isi itu.

Overhead bisa berasal dari:

1. Dictionary/hash table keyspace.
2. Object header Redis.
3. SDS string metadata.
4. Expire dictionary untuk TTL.
5. Replication backlog.
6. Client connection buffers.
7. Pub/Sub buffers.
8. Lua/function/script memory.
9. Cluster metadata.
10. Module/index metadata.

### 2.4 `MEMORY STATS`

Command penting:

```bash
redis-cli MEMORY STATS
```

Command ini memberikan breakdown memory yang lebih detail dibanding `INFO memory`.

Gunakan ini saat kamu ingin menjawab pertanyaan:

1. Apakah memory habis karena dataset?
2. Apakah overhead terlalu besar?
3. Apakah replication backlog besar?
4. Apakah fragmentation abnormal?
5. Apakah Lua/script/function/module memakai memory signifikan?

### 2.5 `MEMORY USAGE key`

Command penting:

```bash
redis-cli MEMORY USAGE user:{123}:profile
```

Ini memberi estimasi memory yang digunakan sebuah key beserta value-nya.

Gunakan untuk sampling:

```bash
redis-cli --scan --pattern 'user:*:profile' | head -100 | while read k; do
  redis-cli MEMORY USAGE "$k"
done
```

Jangan sampling sembarangan di production dengan command berat atau loop tidak terkendali. Gunakan pendekatan observability yang aman.

---

## 3. Kesalahan Mental Model yang Paling Mahal

### 3.1 Menghitung hanya value, melupakan key

Misal value hanya:

```json
{"s":"A"}
```

Ukuran payload mungkin kecil. Tetapi key:

```text
production:com.company.platform.enforcement.case-management.service.cache.case-summary.by-case-id:tenant:tenant-001:case:CASE-2026-0000000001
```

bisa jauh lebih besar dari value.

Kalau ada 100 juta key, panjang key menjadi faktor biaya besar.

Key name harus readable, tetapi tidak boleh liar.

Contoh terlalu panjang:

```text
enforcement-lifecycle-platform:case-management-service:cache:case-summary-view-model:tenant-id:acme-regulatory-unit:case-id:CASE-2026-0000012345
```

Contoh lebih seimbang:

```text
cm:{tenant-42}:case-summary:CASE-2026-0000012345
```

Atau kalau cluster hash tag dibutuhkan:

```text
cm:{tenant-42}:case:CASE-2026-0000012345:summary
```

### 3.2 Menganggap jumlah key adalah kapasitas utama

Dua key bisa sangat berbeda:

```text
small:1 -> "ok"
```

vs

```text
report:monthly:tenant:42 -> 5 MB JSON
```

Satu key besar bisa lebih berbahaya daripada satu juta key kecil karena:

1. Command terhadap big key bisa memblokir event loop lebih lama.
2. Replication/persistence cost besar.
3. Network transfer besar.
4. Client deserialization cost besar.
5. Deletion bisa mahal jika tidak memakai lazy freeing.

### 3.3 Menganggap Redis eviction seperti garbage collection

Eviction bukan GC aplikasi. Eviction adalah Redis membuang key untuk bertahan hidup saat memory limit tercapai.

Kalau key yang dibuang adalah cache transient, mungkin aman.

Kalau key yang dibuang adalah idempotency marker, session, lock, quota state, stream state, atau workflow state, akibatnya bisa menjadi correctness bug.

### 3.4 Menganggap TTL otomatis menyelesaikan memory growth

TTL membantu, tetapi tidak cukup kalau:

1. TTL terlalu panjang.
2. Key creation rate lebih tinggi dari expiration rate.
3. Banyak key tidak punya TTL karena bug path tertentu.
4. Value membesar seiring waktu.
5. Active expiration tidak cukup cepat untuk traffic pattern tertentu.
6. Ada big key yang tidak expired.

Memory engineering harus memodelkan **inflow**, **outflow**, dan **retention window**.

```text
steady_state_memory ≈ write_rate_per_second × ttl_seconds × average_bytes_per_key
```

Contoh:

```text
5,000 keys/s × 86,400 seconds × 300 bytes/key
= 129,600,000,000 bytes
≈ 120.7 GiB
```

TTL 1 hari untuk key kecil sekalipun bisa menjadi mahal kalau write rate tinggi.

---

## 4. Redis Memory Components: Apa Saja yang Menggunakan RAM?

### 4.1 Keyspace Dictionary

Redis menyimpan mapping dari key ke object. Keyspace ini membutuhkan dictionary/hash table internal.

Setiap key memiliki biaya:

1. Nama key sebagai string.
2. Metadata string.
3. Entry dictionary.
4. Pointer ke value object.
5. Redis object metadata.
6. Optional TTL metadata kalau key punya expiration.

Artinya key sangat kecil pun tidak gratis.

### 4.2 Value Object

Value bisa berupa:

1. String.
2. List.
3. Set.
4. Hash.
5. Sorted Set.
6. Stream.
7. Bitmap/Bitfield.
8. HyperLogLog.
9. JSON.
10. Search/vector index structures.

Masing-masing punya encoding dan overhead berbeda.

### 4.3 Expiration Metadata

Setiap key dengan TTL membutuhkan metadata tambahan di expiration dictionary.

TTL bagus, tetapi bukan tanpa biaya. Namun untuk cache/transient data, biaya TTL biasanya lebih kecil daripada risiko key leak.

### 4.4 Replication Backlog

Kalau Redis punya replica, primary menyimpan replication backlog agar replica bisa catch up.

Konfigurasi seperti:

```conf
repl-backlog-size 64mb
```

berarti ada memory yang sengaja dialokasikan untuk replication.

Dalam workload write-heavy, backlog bisa penting agar replica tidak perlu full resync saat disconnect singkat.

### 4.5 Client Buffers

Setiap client connection punya buffer.

Problem besar muncul ketika:

1. Client lambat membaca response.
2. Pub/Sub subscriber lambat.
3. Banyak client melakukan pipeline besar.
4. Query menghasilkan response besar.
5. Aplikasi Java membuka terlalu banyak connection.

Client output buffer bisa menjadi sumber OOM yang mengejutkan.

### 4.6 Persistence Copy-on-Write Headroom

Saat Redis membuat RDB snapshot atau melakukan AOF rewrite, Redis melakukan fork. Dengan copy-on-write, memory page yang berubah selama child process berjalan perlu dicopy.

Dalam workload write-heavy, operasi persistence bisa membutuhkan headroom memory besar.

Kalau Redis berjalan terlalu dekat dengan limit OS memory, proses fork/persistence bisa gagal atau menyebabkan memory pressure.

### 4.7 Module / Index / Query Engine Memory

Redis modern dapat memakai JSON, Search, Vector Set, probabilistic structures, dan lain-lain. Index bukan gratis.

Jika kamu membuat search index di Redis, memory yang dihitung bukan hanya document JSON. Ada inverted index, numeric index, tag index, vector index, dan metadata tambahan.

Mental model:

```text
indexed_document_memory = raw_document_memory + index_memory + metadata + fragmentation
```

Jangan mengukur hanya dokumen mentah.

---

## 5. Data Structure Memory Trade-Off

Redis disebut data structure server karena pilihan struktur data menentukan memory dan latency.

### 5.1 Banyak String Key vs Satu Hash

Misal kamu menyimpan profile user.

Model A: banyak string key

```text
user:{42}:name      -> "Ayu"
user:{42}:email     -> "ayu@example.com"
user:{42}:status    -> "ACTIVE"
user:{42}:tier      -> "GOLD"
```

Model B: satu hash

```text
user:{42}:profile -> hash
  name   = "Ayu"
  email  = "ayu@example.com"
  status = "ACTIVE"
  tier   = "GOLD"
```

Model A mudah untuk TTL per field, tetapi overhead key lebih besar.

Model B biasanya lebih hemat untuk object kecil karena satu key memuat banyak field. Tetapi TTL-nya berlaku pada seluruh hash, bukan field individual.

Rule of thumb:

1. Banyak field kecil yang diakses bersama → Hash sering lebih baik.
2. Field punya TTL/lifecycle berbeda → key terpisah bisa lebih benar.
3. Field sering diakses individual dan object sangat besar → hati-hati `HGETALL`.
4. Hash sangat besar → bisa menjadi big key.

### 5.2 JSON Blob vs Hash

JSON blob:

```text
case:{tenant-42}:CASE-1:summary -> '{"status":"OPEN","risk":87,...}'
```

Kelebihan:

1. Mudah diserialisasi dari DTO.
2. Satu GET.
3. Cocok untuk cache read model immutable-ish.

Kekurangan:

1. Update partial butuh read-modify-write di client, kecuali memakai RedisJSON.
2. Seluruh blob dikirim lewat network.
3. Deserialization cost di JVM.
4. Schema evolution bisa tersembunyi.

Hash:

```text
case:{tenant-42}:CASE-1:summary -> hash
```

Kelebihan:

1. Partial update.
2. Partial read.
3. Bisa lebih hemat untuk object kecil.
4. Bisa lebih jelas field-level.

Kekurangan:

1. Mapping DTO lebih manual.
2. Nested object tidak natural.
3. Tidak sama dengan document database.
4. Hash besar tetap berbahaya.

### 5.3 Set vs Bitmap

Untuk membership user dalam event:

Set:

```text
event:{E1}:attendees -> set of user IDs
```

Bitmap:

```text
event:{E1}:attended-bitmap -> bit offset by numeric user ID
```

Set cocok jika:

1. ID tidak dense.
2. Butuh enumerate members.
3. Butuh intersection/union dengan ID asli.
4. Cardinality tidak ekstrem.

Bitmap cocok jika:

1. ID numeric dan cukup dense.
2. Butuh compact boolean state.
3. Banyak membership check/count.
4. Tidak perlu enumerate semua ID dengan mudah.

Bitmap dapat sangat hemat, tetapi offset besar membuat string membesar sampai offset tersebut.

Contoh bahaya:

```bash
SETBIT flags 10000000000 1
```

Ini memaksa Redis mengalokasikan string sampai offset tinggi. Jangan memakai ID sparse besar langsung sebagai offset tanpa mapping.

### 5.4 HyperLogLog vs Set

Kalau butuh menghitung unique user secara approximate:

```text
dau:2026-06-20 -> HyperLogLog
```

HyperLogLog sangat hemat untuk cardinality estimation.

Tetapi jangan gunakan untuk:

1. Audit exact.
2. Billing exact.
3. Enforcement exact.
4. Legal/regulatory decision exact.

Untuk sistem regulatori, HLL boleh menjadi telemetry/analytics approximation, bukan evidence store.

### 5.5 Sorted Set Memory Cost

Sorted Set powerful, tetapi tidak murah. Ia menyimpan member dan score, dan untuk ukuran tertentu memakai struktur yang mendukung ordering/range.

Gunakan Sorted Set untuk:

1. Ranking.
2. Time index.
3. Delay queue.
4. Sliding window.
5. Priority queue.

Jangan gunakan Sorted Set sebagai default “karena nanti mungkin butuh range”. Kalau tidak butuh ordering, Set atau Hash mungkin lebih hemat.

---

## 6. Big Key: Key yang Secara Lokal Merusak Sistem

### 6.1 Definisi Big Key

Big key bukan hanya key dengan value besar dalam MB.

Big key bisa berarti:

1. String bernilai besar.
2. Hash dengan sangat banyak field.
3. List dengan sangat banyak element.
4. Set dengan sangat banyak member.
5. Sorted Set dengan sangat banyak member.
6. Stream yang tidak ditrim.
7. JSON document besar.
8. Bitmap dengan offset sangat tinggi.

Definisi praktis:

> Big key adalah key yang operasi normal terhadapnya dapat menyebabkan latency spike, memory pressure, replication overhead, network burst, persistence overhead, atau client-side pause yang tidak proporsional.

### 6.2 Kenapa Big Key Berbahaya

Big key berbahaya karena Redis command dijalankan oleh event loop. Command terhadap big key bisa membuat operasi lain menunggu.

Contoh command berbahaya:

```bash
HGETALL giant:hash
SMEMBERS giant:set
LRANGE giant:list 0 -1
ZRANGE giant:zset 0 -1 WITHSCORES
GET giant:json-blob
DEL giant:key
```

Dampak:

1. Server latency spike.
2. Network response sangat besar.
3. Java client thread blocked.
4. Deserialization pause.
5. GC pressure.
6. Replication burst.
7. AOF/RDB growth.
8. Failover lebih lambat.

### 6.3 Mendeteksi Big Key

Command Redis:

```bash
redis-cli --bigkeys
```

Ini melakukan scan keyspace dan mencari key besar per type. Gunakan hati-hati di production.

Alternatif sampling:

```bash
redis-cli --scan --pattern 'case:*' | head -1000 | while read k; do
  echo "$k $(redis-cli MEMORY USAGE "$k")"
done | sort -k2 -n | tail
```

Untuk type-specific cardinality:

```bash
STRLEN some:string
HLEN some:hash
LLEN some:list
SCARD some:set
ZCARD some:zset
XLEN some:stream
```

### 6.4 Strategi Menghindari Big Key

#### Strategy A — Shard logical collection

Jangan:

```text
tenant:{42}:all-case-ids -> set with 100 million members
```

Lebih aman:

```text
tenant:{42}:case-ids:bucket:000
...
tenant:{42}:case-ids:bucket:255
```

Bucket bisa berdasarkan hash case ID.

#### Strategy B — Time partitioning

Jangan:

```text
tenant:{42}:events -> stream/list forever
```

Lebih aman:

```text
tenant:{42}:events:2026-06-20
```

atau:

```text
tenant:{42}:events:2026-W25
```

#### Strategy C — Trim actively

Untuk Stream:

```bash
XTRIM stream:key MAXLEN ~ 100000
```

Untuk List:

```bash
LTRIM list:key 0 9999
```

#### Strategy D — Never fetch all by default

Jangan expose method Java seperti:

```java
Set<String> getAllMembers(String key);
```

sebagai API default.

Lebih aman:

```java
ScanCursor<Member> scanMembers(String key, int limit);
```

atau desain query yang tidak membutuhkan enumerate seluruh key.

#### Strategy E — Use lazy deletion

Untuk key besar, pertimbangkan:

```bash
UNLINK giant:key
```

bukan:

```bash
DEL giant:key
```

`UNLINK` melepas key dari keyspace lalu membebaskan memory secara asynchronous, sehingga mengurangi blocking di event loop.

---

## 7. Hot Key: Key yang Secara Trafik Merusak Sistem

### 7.1 Definisi Hot Key

Hot key adalah key yang mendapat traffic tidak proporsional.

Contoh:

```text
feature-flags:global
home-page:top-feed
rate-limit:public-api:anonymous
config:tenant:default
product:flash-sale:123
```

Hot key bisa kecil. Problemnya bukan ukuran, tetapi frekuensi akses.

### 7.2 Gejala Hot Key

1. CPU Redis tinggi walau dataset kecil.
2. Network throughput tinggi pada satu shard.
3. Latency p99/p999 naik.
4. Cluster node tertentu lebih sibuk.
5. Replica/primary tertentu bottleneck.
6. Cache hit rate tinggi tetapi service tetap lambat.
7. Java client pool wait meningkat.

### 7.3 Mendeteksi Hot Key

Command:

```bash
redis-cli --hotkeys
```

Namun ini membutuhkan LFU counter dan konfigurasi tertentu agar efektif.

Observasi tambahan:

1. Commandstats.
2. Per-key application metric.
3. Client-side instrumentation.
4. Slowlog.
5. Redis latency monitor.
6. Cluster node-level CPU/network imbalance.

### 7.4 Mitigasi Hot Key

#### Strategy A — Local cache

Untuk config/read-mostly data:

```text
Java service local Caffeine cache -> Redis -> source of truth
```

Ini mengurangi request Redis untuk key super panas.

Risiko:

1. Staleness.
2. Invalidation complexity.
3. Memory di setiap service instance.

Cocok untuk:

1. Feature flag snapshot.
2. Public config.
3. Reference data.
4. Tenant configuration dengan TTL pendek.

#### Strategy B — Key replication manually

Untuk read-only value:

```text
hot:key:0
hot:key:1
hot:key:2
...
hot:key:15
```

Client membaca dari shard berdasarkan random/bucket.

Risiko:

1. Write/update harus fanout.
2. Inconsistency antar salinan.
3. Tidak cocok untuk counter atau mutable state.

#### Strategy C — Avoid single global counter

Jangan:

```text
counter:global-api-requests
```

Lebih baik:

```text
counter:global-api-requests:bucket:0
...
counter:global-api-requests:bucket:63
```

Lalu aggregate periodik.

#### Strategy D — Use CDN/application-level cache for public hot content

Redis bukan selalu jawaban untuk hot read. Kadang hot key harus naik ke layer yang lebih dekat:

1. In-process cache.
2. CDN.
3. Edge cache.
4. Precomputed static object.

#### Strategy E — Tenant-aware partitioning

Untuk sistem multi-tenant:

```text
config:{tenantId}:rules
```

lebih baik daripada:

```text
config:all-tenants
```

agar akses tersebar dan failure domain lebih kecil.

---

## 8. Eviction Safety: Memory Policy Adalah Correctness Policy

Redis eviction policy menentukan apa yang terjadi saat `maxmemory` tercapai.

### 8.1 `noeviction`

Dengan `noeviction`, Redis tidak membuang key. Redis akan mengembalikan error untuk write yang membutuhkan memory tambahan.

Ini sering paling aman untuk data yang tidak boleh hilang diam-diam:

1. Idempotency state.
2. Workflow transient state.
3. Lock/fencing state.
4. Quota enforcement state.
5. Session penting.
6. Queue/stream state.

Konsekuensi:

1. Aplikasi harus handle OOM Redis.
2. Harus ada backpressure.
3. Harus ada alert sebelum limit tercapai.

### 8.2 `allkeys-lru` / `allkeys-lfu`

Policy ini bisa membuang key apa pun berdasarkan approximated recency/frequency.

Cocok untuk dedicated cache Redis yang semua key-nya boleh hilang.

Tidak cocok untuk Redis campuran yang menyimpan cache + lock + idempotency + stream.

### 8.3 `volatile-lru` / `volatile-lfu`

Policy ini hanya membuang key yang punya TTL.

Cocok jika:

1. Semua cache key diberi TTL.
2. Non-cache key tanpa TTL tidak boleh dievict.
3. Kamu sadar bahwa jika tidak ada key TTL yang cukup, Redis tetap bisa OOM.

### 8.4 `volatile-ttl`

Membuang key dengan TTL terdekat.

Cocok jika TTL merepresentasikan prioritas lifecycle yang benar.

Berbahaya kalau TTL hanya asal diberi.

### 8.5 `random` policies

Policy random bisa berguna untuk workload tertentu, tetapi jarang menjadi pilihan utama design review karena sulit dijelaskan dari sisi predictability.

### 8.6 Dedicated Redis by Data Class

Rule production yang sering lebih aman:

```text
Redis Cache          -> allkeys-lfu / allkeys-lru
Redis Sessions       -> volatile-lru atau noeviction, tergantung SLA
Redis Idempotency    -> noeviction + strict TTL + alert
Redis Locks          -> noeviction + tiny dataset + strict TTL
Redis Streams/Queues -> noeviction + retention/trimming + backpressure
Redis Search/Vector  -> noeviction atau explicit capacity strategy
```

Jangan mencampur semua workload ke satu Redis lalu berharap satu eviction policy cocok untuk semua.

---

## 9. Fragmentation: Memory yang Terlihat Ada, tetapi Tidak Efektif

### 9.1 Apa itu Fragmentation?

Fragmentation terjadi saat allocator/OS tidak dapat memakai atau mengembalikan memory secara ideal karena pola alokasi/dealokasi.

Redis docs menjelaskan fragmentation ratio secara konseptual sebagai RSS dibagi memory yang digunakan. Rasio ini bisa tidak reliabel bila puncak memory sebelumnya jauh lebih tinggi dari memory saat ini, tetapi tetap menjadi sinyal penting.

### 9.2 Membaca Fragmentation Ratio

Secara kasar:

```text
mem_fragmentation_ratio ≈ used_memory_rss / used_memory
```

Interpretasi praktis:

| Ratio | Interpretasi Awal |
|---|---|
| ~1.0 - 1.2 | Umumnya sehat |
| 1.2 - 1.5 | Perlu diamati, tergantung workload |
| >1.5 | Investigasi fragmentation/allocator/pola key churn |
| Sangat tinggi saat used_memory kecil | Bisa misleading karena denominator kecil |
| used_memory > rss | Waspada swap |

Jangan membuat alert naive hanya berdasarkan ratio tanpa konteks dataset size.

Lebih baik alert dengan kombinasi:

1. `used_memory_rss` mendekati memory fisik.
2. `mem_fragmentation_ratio` tinggi.
3. `used_memory` tidak tinggi tetapi RSS tinggi.
4. Eviction mulai terjadi.
5. Latency naik.

### 9.3 Penyebab Fragmentation

1. Banyak key dibuat dan dihapus terus-menerus.
2. Value berubah ukuran secara signifikan.
3. Banyak object kecil dengan lifecycle berbeda.
4. Large object allocation/deallocation.
5. AOF rewrite / RDB / fork interaction.
6. Module/index memory behavior.

### 9.4 Active Defragmentation

Redis memiliki active defragmentation yang dapat membantu mengurangi fragmentation pada konfigurasi tertentu.

Contoh konfigurasi:

```conf
activedefrag yes
active-defrag-threshold-lower 10
active-defrag-threshold-upper 100
active-defrag-cycle-min 1
active-defrag-cycle-max 25
```

Trade-off:

1. Bisa mengurangi RSS/fragmentation.
2. Menggunakan CPU tambahan.
3. Perlu diuji dengan workload produksi.
4. Bukan pengganti desain data yang sehat.

### 9.5 Restart sebagai “Defrag Terakhir”

Restart dapat mengurangi RSS karena proses baru memuat dataset lebih kompak, tetapi:

1. Ada downtime atau failover risk.
2. Reload RDB/AOF butuh waktu.
3. Cache warmup bisa menekan source database.
4. Cluster/failover harus direncanakan.

Jangan jadikan restart sebagai memory management strategy utama.

---

## 10. Capacity Planning: Dari Requirement ke Memory Budget

### 10.1 Langkah 1 — Klasifikasikan Data

Buat tabel semua key family.

Contoh:

| Key Family | Purpose | Type | TTL | Cardinality | Avg Value | Growth Driver | Evictable? |
|---|---|---|---:|---:|---:|---|---|
| `cm:{tenant}:case-summary:{caseId}` | cache case summary | String JSON | 15m | 2M active | 2 KB | read traffic | yes |
| `idem:{tenant}:{key}` | idempotency | Hash/String | 24h | 20M/day | 300 B | writes | no silent eviction |
| `rl:{tenant}:{api}:{principal}` | rate limit | String/ZSet | 1m-1h | 5M active | 100 B-2 KB | request traffic | careful |
| `lock:{resource}` | lock | String | 30s | small | 100 B | concurrency | no silent eviction |
| `stream:{tenant}:events` | stream | Stream | trim | variable | variable | events | no silent eviction |

### 10.2 Langkah 2 — Hitung Entity Count

Untuk TTL-bound keys:

```text
active_keys ≈ write_rate_per_second × ttl_seconds
```

Contoh idempotency:

```text
write_rate = 2,000 request/s
ttl = 24 hours = 86,400 seconds
active_keys = 172,800,000 keys
```

Jika rata-rata key + value + overhead 300 bytes:

```text
172,800,000 × 300 = 51,840,000,000 bytes ≈ 48.3 GiB
```

Kalau overhead sebenarnya 700 bytes:

```text
172,800,000 × 700 = 120,960,000,000 bytes ≈ 112.7 GiB
```

Perbedaan asumsi kecil bisa mengubah desain infrastruktur total.

### 10.3 Langkah 3 — Ukur, Jangan Tebak

Buat sample realistis di environment test.

```bash
redis-cli FLUSHDB
```

Load 100k sample key representatif.

```bash
redis-cli INFO memory
redis-cli MEMORY STATS
```

Lalu hitung:

```text
bytes_per_entity ≈ (used_memory_after - used_memory_before) / inserted_entities
```

Ulangi untuk:

1. 10k entities.
2. 100k entities.
3. 1M entities jika memungkinkan.

Kenapa? Karena beberapa struktur data berubah encoding ketika melewati threshold tertentu.

### 10.4 Langkah 4 — Masukkan Headroom

Jangan targetkan 100% memory.

Headroom diperlukan untuk:

1. Traffic spike.
2. TTL delay.
3. Fragmentation.
4. Persistence copy-on-write.
5. Replication backlog.
6. Client buffers.
7. Resharding/migration.
8. Emergency investigation.

Rule praktis:

```text
usable_dataset_memory = physical_memory × 0.5 sampai 0.75
```

Angka tepat tergantung:

1. Persistence enabled atau tidak.
2. Write rate.
3. Fragmentation behavior.
4. Managed Redis policy.
5. Replica count.
6. Module/index usage.

Untuk Redis dengan persistence dan write-heavy workload, headroom harus lebih besar.

### 10.5 Langkah 5 — Buat Projection

Contoh projection:

```text
Key family: idempotency
Peak request rate: 2,000/s
TTL: 24h
Active keys: 172.8M
Measured bytes/key: 520 B
Raw dataset: 89.8 GB
Fragmentation/headroom factor: 1.4
Required memory: 125.7 GB
Replica count: 1
Total infra memory: 251.4 GB + provider overhead
```

Kesimpulan mungkin:

1. TTL 24 jam terlalu mahal.
2. Perlu compact representation.
3. Perlu shard by tenant/time.
4. Perlu SQL table untuk idempotency tertentu.
5. Perlu dedicated Redis cluster.
6. Perlu lower retention untuk low-risk endpoint.

Memory engineering sering mengubah requirement, bukan hanya sizing server.

---

## 11. Java-Specific Memory Pitfalls

Redis memory bukan satu-satunya memory. Java service juga membayar memory saat membaca/menulis Redis.

### 11.1 Serialization Bloat

Jangan memakai Java native serialization untuk Redis cache kecuali ada alasan sangat kuat.

Masalah:

1. Payload besar.
2. Tidak ramah schema evolution.
3. Sulit dibaca/debug.
4. Security risk historis pada deserialization pattern.
5. Coupling kuat ke class Java.

Lebih baik:

1. JSON untuk readability dan compatibility.
2. Smile/CBOR/MessagePack untuk compactness jika perlu.
3. Protobuf/Avro untuk schema kuat jika organisasi siap.
4. String/primitive untuk counter/token.
5. Hash untuk object field sederhana.

### 11.2 DTO Terlalu Gemuk

Cache DTO sering tidak sengaja membawa semua field domain object.

Contoh buruk:

```java
record CaseSummaryCache(
    String caseId,
    String tenantId,
    String status,
    String title,
    String description,
    List<AttachmentDto> attachments,
    List<CommentDto> comments,
    List<AuditEntryDto> auditTrail,
    Map<String, Object> debugContext
) {}
```

Untuk summary view, seharusnya mungkin hanya:

```java
record CaseSummaryCache(
    String caseId,
    String status,
    String title,
    int riskScore,
    Instant updatedAt,
    long version
) {}
```

Cache object harus didesain sebagai read model minimal, bukan dump domain aggregate.

### 11.3 Compression Trade-Off

Compression bisa mengurangi Redis memory dan network, tetapi menambah CPU dan latency.

Cocok untuk:

1. Value besar.
2. Read traffic tidak ekstrem.
3. Network/memory lebih mahal daripada CPU.
4. Object jarang diubah.

Tidak cocok untuk:

1. Tiny values.
2. Hot key super sering.
3. Low-latency p99 ketat.
4. Data yang sering partial update.

Pattern Java:

```text
serialize DTO -> compress bytes -> SET
GET -> decompress -> deserialize DTO
```

Tambahkan metadata format/version:

```text
magic byte/version + compression flag + payload
```

Agar migrasi format tidak menyakitkan.

### 11.4 Client Pipeline Memory

Pipeline besar di Java bisa menghemat round trip, tetapi response buffer bisa besar.

Jangan melakukan pipeline jutaan command tanpa batas.

Buruk:

```java
for (String key : millionsOfKeys) {
    async.get(key);
}
// lalu tunggu semua
```

Lebih baik:

```text
process in bounded batches
batch size: 100 - 5,000 tergantung command/value/network
measure memory and p99
```

### 11.5 `HGETALL` / `SMEMBERS` / `ZRANGE 0 -1` ke JVM

Command yang mengembalikan banyak data bisa memindahkan problem dari Redis ke JVM:

1. Large network response.
2. Byte buffer besar.
3. Object allocation besar.
4. GC pause.
5. Thread blocked.
6. Backpressure hilang.

Expose API Redis dengan batas eksplisit:

```java
interface RedisSetGateway {
    boolean isMember(String key, String member);
    long cardinality(String key);
    Stream<String> scanMembers(String key, int batchSize);
}
```

Bukan:

```java
Set<String> getAllMembers(String key);
```

---

## 12. Key Naming dari Perspektif Memory

Key name perlu memenuhi beberapa tujuan:

1. Mudah dioperasikan.
2. Mudah di-debug.
3. Punya namespace ownership.
4. Mendukung cluster hash tags.
5. Tidak terlalu panjang.
6. Tidak mengandung data sensitif.
7. Stabil lintas versi.

### 12.1 Format yang Baik

```text
<domain>:<scope>:<entity>:<id>:<purpose>
```

Contoh:

```text
cm:{t42}:case:CASE-123:summary
idem:{t42}:payment:req-abc
rl:{t42}:api:create-case:user-991
```

### 12.2 Hindari Key Terlalu Panjang

Buruk:

```text
case-management-service:production:tenant:tenant-42:bounded-context:enforcement-lifecycle:entity:case:id:CASE-123:cache:summary:view-model:v3
```

Lebih baik:

```text
cm:{t42}:case:CASE-123:sum:v3
```

Tetapi jangan terlalu pendek sampai tidak bisa dioperasikan:

```text
c:{t42}:c:CASE-123:s:v3
```

Kalau on-call engineer tidak bisa memahami key family dalam incident, key terlalu cryptic.

### 12.3 Key Dictionary / ADR

Buat dokumen key registry:

| Key Pattern | Owner | Type | TTL | Eviction | Max Cardinality | Max Value | Notes |
|---|---|---|---:|---|---:|---:|---|
| `cm:{tenant}:case:{caseId}:sum:v3` | case-service | String JSON | 15m | evictable | active cases | 4 KB | cache-aside |
| `idem:{tenant}:{idemKey}` | api-gateway | Hash | 24h | no silent eviction | req/day × ttl | 1 KB | stores status/result pointer |
| `rl:{tenant}:{api}:{principal}` | gateway | String/ZSet | 1m | careful | active principals | 2 KB | Lua limiter |

Key registry adalah alat memory engineering, bukan sekadar dokumentasi.

---

## 13. Memory-Aware Design untuk Use Case Umum

### 13.1 Cache Case Summary

Requirement:

1. Read-heavy.
2. Source of truth di PostgreSQL.
3. Boleh stale 1-5 menit.
4. Tidak boleh menghabiskan Redis.

Design:

```text
key: cm:{tenantId}:case:{caseId}:summary:v3
type: String JSON
TTL: 5-15 minutes + jitter
max value: 4 KB
eviction: allowed
```

Memory control:

1. Jangan cache case yang jarang dibaca.
2. Jangan simpan attachment/comment/audit trail.
3. Tambahkan max serialized bytes guard di Java.
4. Track cache value size histogram.

Java guard:

```java
byte[] payload = objectMapper.writeValueAsBytes(summary);
if (payload.length <= 4096) {
    redis.setex(key, ttlSeconds, payload);
} else {
    metrics.counter("redis.cache.skip.too_large", "family", "case-summary").increment();
}
```

### 13.2 Idempotency Store

Requirement:

1. Mencegah duplicate processing.
2. TTL 24 jam.
3. Tidak boleh hilang diam-diam.

Design:

```text
key: idem:{tenantId}:{idempotencyKey}
type: Hash or String JSON
TTL: 24h
eviction: noeviction preferred / dedicated Redis
```

Memory control:

1. Simpan response pointer, bukan response body besar.
2. Batasi idempotency key length.
3. Hash request fingerprint.
4. Reject abusive key cardinality per principal.
5. Monitor active key count.

### 13.3 Rate Limiter

Requirement:

1. Millions of principals.
2. Low latency.
3. TTL natural.

Fixed window:

```text
key: rl:{tenant}:{api}:{principal}:{window}
type: String counter
TTL: window + grace
```

Sliding window with ZSet:

```text
key: rl:{tenant}:{api}:{principal}
type: Sorted Set timestamp/requestId
TTL: window
```

Memory trade-off:

1. Counter: small, approximate boundary behavior.
2. ZSet: more accurate, higher memory per request in window.

Untuk endpoint high-volume, ZSet per request bisa sangat mahal.

### 13.4 Presence / Online Users

Naive:

```text
online-users -> Set of all user IDs
```

Problem:

1. Bisa jadi big key.
2. Multi-tenant blast radius.
3. `SMEMBERS` berbahaya.

Lebih baik:

```text
presence:{tenant}:{bucket} -> Set
presence-user:{tenant}:{userId} -> String heartbeat TTL
```

Atau gunakan TTL key per user dan aggregate secara asynchronous.

### 13.5 Workflow Transient State

Requirement:

1. State sementara proses enforcement.
2. Correctness penting.
3. TTL ada, tetapi kehilangan diam-diam berbahaya.

Design:

1. Jangan letakkan di Redis cache shared dengan `allkeys-lru`.
2. Gunakan Redis dedicated atau database source of truth.
3. Redis boleh menjadi acceleration layer, bukan evidence layer.
4. Gunakan `noeviction` dan alert ketat jika Redis menjadi coordination state.

---

## 14. Operational Memory Monitoring

### 14.1 Metrics Minimum

Monitor setidaknya:

1. `used_memory`.
2. `used_memory_rss`.
3. `used_memory_peak`.
4. `used_memory_dataset`.
5. `used_memory_overhead`.
6. `maxmemory`.
7. `mem_fragmentation_ratio`.
8. `allocator_frag_ratio`.
9. `evicted_keys`.
10. `expired_keys`.
11. `keyspace_hits` / `keyspace_misses`.
12. `connected_clients`.
13. client output buffer metrics jika tersedia.
14. replication backlog/lag.
15. persistence fork/cow metrics.
16. per-command latency/slowlog.

### 14.2 Alert yang Berguna

Contoh alert:

```text
RedisMemoryUsageHigh:
  used_memory / maxmemory > 80% for 10m
```

```text
RedisMemoryCritical:
  used_memory / maxmemory > 90% for 5m
```

```text
RedisEvictionsDetected:
  increase(evicted_keys[5m]) > 0
```

Untuk Redis yang bukan pure cache, eviction harus page incident.

```text
RedisFragmentationHigh:
  used_memory > 1GB
  and mem_fragmentation_ratio > 1.5 for 30m
```

```text
RedisRSSNearHostLimit:
  used_memory_rss / host_memory > 85%
```

```text
RedisKeyExpirationStoppedOrDropped:
  expired_keys rate abnormal vs expected key inflow
```

### 14.3 Dashboard yang Benar

Dashboard Redis memory harus menampilkan:

1. Memory over time: used, rss, maxmemory.
2. Fragmentation ratio.
3. Evicted keys rate.
4. Expired keys rate.
5. Key count by DB/keyspace.
6. Command rate.
7. Top command families.
8. Slowlog count.
9. Network input/output.
10. Client connections.
11. Replication lag.
12. Persistence events.
13. Application key family metrics.

Redis metrics tanpa application key family metrics sering tidak cukup.

Tambahkan dari aplikasi Java:

1. Cache payload size histogram.
2. Number of writes by key family.
3. Number of skips due to large payload.
4. TTL distribution.
5. Cache hit/miss by family.
6. Redis command latency by operation.
7. Redis exception count.
8. OOM/rejected write count.

---

## 15. Big Key dan Hot Key Guardrail di Java

### 15.1 Payload Size Guard

```java
public final class RedisPayloadGuard {
    private final int maxBytes;

    public RedisPayloadGuard(int maxBytes) {
        this.maxBytes = maxBytes;
    }

    public void validate(String key, byte[] payload) {
        if (payload.length > maxBytes) {
            throw new RedisPayloadTooLargeException(
                "Redis payload too large for key=" + safeKeyFamily(key)
                    + ", bytes=" + payload.length
                    + ", maxBytes=" + maxBytes
            );
        }
    }

    private String safeKeyFamily(String key) {
        int idx = key.indexOf(':');
        return idx > 0 ? key.substring(0, idx) : "unknown";
    }
}
```

Jangan log full key kalau key mengandung identifier sensitif.

### 15.2 TTL Guard

```java
public record RedisWritePolicy(
    Duration ttl,
    int maxPayloadBytes,
    boolean allowWithoutTtl
) {
    public RedisWritePolicy {
        if (!allowWithoutTtl && (ttl == null || ttl.isZero() || ttl.isNegative())) {
            throw new IllegalArgumentException("Redis write requires positive TTL");
        }
    }
}
```

Untuk cache, default harus TTL mandatory.

### 15.3 Bounded Batch

```java
public <T> List<T> fetchInBatches(
    List<String> keys,
    int batchSize,
    Function<List<String>, List<T>> batchLoader
) {
    List<T> result = new ArrayList<>();
    for (int i = 0; i < keys.size(); i += batchSize) {
        List<String> batch = keys.subList(i, Math.min(i + batchSize, keys.size()));
        result.addAll(batchLoader.apply(batch));
    }
    return result;
}
```

Jangan jadikan batch size angka ajaib. Ukur:

1. Payload size.
2. Redis latency.
3. JVM allocation.
4. Network throughput.
5. p99 service latency.

### 15.4 Key Family Metrics

```java
Timer.Sample sample = Timer.start(registry);
try {
    return redisCommands.get(key);
} finally {
    sample.stop(registry.timer(
        "redis.operation.latency",
        "family", keyFamily,
        "operation", "get"
    ));
}
```

Tambahkan metrics untuk:

1. `redis.payload.bytes`.
2. `redis.write.count`.
3. `redis.skip.too_large`.
4. `redis.ttl.seconds`.
5. `redis.error.count`.

### 15.5 Explicit API untuk Dangerous Operations

Jangan expose generic Redis facade seperti:

```java
Object execute(String command, Object... args);
```

Buat gateway per use case:

```java
interface CaseSummaryCache {
    Optional<CaseSummary> get(TenantId tenantId, CaseId caseId);
    void put(TenantId tenantId, CaseSummary summary);
    void evict(TenantId tenantId, CaseId caseId);
}
```

Ini memungkinkan kamu menempelkan:

1. TTL policy.
2. Size guard.
3. Key schema.
4. Metrics.
5. Serialization version.
6. Circuit breaker.
7. Fallback behavior.

---

## 16. Memory Budget Worksheet

Gunakan worksheet ini saat design review.

### 16.1 Key Family

```text
Key pattern:
Owner service:
Business purpose:
Redis type:
Source of truth:
Evictable? yes/no
TTL:
Expected write rate:
Expected read rate:
Expected active cardinality:
Average payload bytes:
P95 payload bytes:
Max allowed payload bytes:
Measured bytes per entity:
Expected steady-state memory:
Fragmentation/headroom factor:
Required memory:
Failure behavior if key missing:
Failure behavior if Redis OOM:
Operational alert owner:
```

### 16.2 Example

```text
Key pattern: cm:{tenant}:case:{caseId}:summary:v3
Owner service: case-management-service
Business purpose: speed up case list/detail summary
Redis type: String JSON
Source of truth: PostgreSQL case tables
Evictable: yes
TTL: 10m ± jitter
Expected write rate: cache miss dependent, peak 500/s
Expected read rate: peak 20k/s
Expected active cardinality: 3M
Average payload bytes: 1.8 KB
P95 payload bytes: 3.6 KB
Max allowed payload bytes: 4 KB
Measured bytes per entity: 2.3 KB
Expected steady-state memory: 6.9 GB
Fragmentation/headroom factor: 1.5
Required memory: 10.35 GB
Failure if key missing: load from DB
Failure if Redis OOM: skip cache write, continue DB read with rate protection
Operational owner: Platform runtime + case service
```

### 16.3 Decision

```text
Approved if:
- Dedicated cache Redis has enough headroom.
- Payload max enforced in Java.
- TTL jitter implemented.
- Hit/miss and payload size metrics exist.
- Eviction is acceptable.
- DB fallback is protected from stampede.
```

---

## 17. Design Review Questions

Gunakan pertanyaan ini untuk membongkar risiko Redis memory.

### 17.1 Keyspace Growth

1. Apa semua key family yang service ini tulis?
2. Apakah setiap key family punya owner?
3. Apakah setiap key family punya TTL atau alasan eksplisit tidak punya TTL?
4. Apa cardinality maksimum per tenant?
5. Apa write rate × TTL?
6. Apa yang mencegah unbounded growth?
7. Apakah ada tenant/customer yang bisa membuat key explosion?

### 17.2 Value Size

1. Berapa average, p95, p99 payload size?
2. Apakah payload size diukur atau ditebak?
3. Apakah ada guard max payload?
4. Apakah ada field besar yang tidak perlu?
5. Apakah compression layak?
6. Apakah serialization format punya version?

### 17.3 Data Structure

1. Mengapa type ini dipilih?
2. Apakah Hash lebih hemat daripada banyak String?
3. Apakah Set bisa menjadi Bitmap?
4. Apakah ZSet benar-benar perlu ordering?
5. Apakah Stream punya trimming policy?
6. Apakah ada operasi yang membaca seluruh collection?

### 17.4 Eviction

1. Apa eviction policy Redis ini?
2. Apakah semua key dalam Redis ini aman dievict?
3. Apa akibat idempotency key hilang?
4. Apa akibat rate limiter key hilang?
5. Apa akibat session key hilang?
6. Apakah Redis ini seharusnya dipisah per workload?

### 17.5 Operations

1. Apa alert memory warning/critical?
2. Apa runbook jika memory 90%?
3. Apa runbook jika eviction terjadi?
4. Apa runbook jika fragmentation tinggi?
5. Apakah backup/persistence butuh memory headroom?
6. Apakah failover pernah dites dengan dataset sebesar production?

---

## 18. Failure Modeling

### 18.1 Scenario: Cache Redis mulai eviction

Kondisi:

```text
maxmemory_policy = allkeys-lru
used_memory/maxmemory = 100%
evicted_keys increasing
```

Kalau Redis dedicated cache:

1. Hit rate turun.
2. DB traffic naik.
3. Bisa terjadi stampede.
4. Latency aplikasi naik.

Mitigasi:

1. Scale Redis memory.
2. Kurangi TTL.
3. Kurangi payload.
4. Tambahkan local cache untuk hot key.
5. Tambahkan request coalescing.
6. Precompute/prioritize only valuable cache entries.

Kalau Redis campuran:

1. Idempotency key bisa hilang.
2. Lock bisa hilang.
3. Rate limiter bisa reset.
4. Session bisa hilang.
5. Queue/stream state bisa rusak secara semantik.

Mitigasi utama:

```text
Pisahkan workload. Jangan campur cache evictable dengan correctness state.
```

### 18.2 Scenario: Big key menyebabkan latency spike

Kondisi:

```text
p99 Redis latency naik
slowlog menunjukkan HGETALL tenant:{42}:all-cases
Java GC naik
network output spike
```

Root cause:

1. Satu Hash besar dipakai sebagai table.
2. Endpoint admin membaca semua data.
3. Response besar masuk JVM.

Fix:

1. Partition hash by bucket/time.
2. Replace `HGETALL` dengan `HSCAN` bounded.
3. Buat query/read model di database/search engine.
4. Tambahkan max response guard.
5. Tambahkan slow operation metric.

### 18.3 Scenario: Fragmentation membuat RSS tinggi

Kondisi:

```text
used_memory = 20 GB
used_memory_rss = 38 GB
mem_fragmentation_ratio = 1.9
host memory pressure tinggi
```

Kemungkinan:

1. Dataset pernah lebih besar.
2. Key churn tinggi.
3. Value sizes berubah-ubah.
4. Active defrag belum aktif/tidak cukup.

Mitigasi:

1. Analisis allocator metrics.
2. Aktifkan/tune active defrag jika cocok.
3. Kurangi churn dan large object mutation.
4. Restart/failover terencana sebagai emergency relief.
5. Tambahkan headroom.
6. Perbaiki data model.

### 18.4 Scenario: TTL tidak cukup menahan growth

Kondisi:

```text
write rate naik 10x
TTL tetap 24h
used_memory naik linear
expired_keys rate tidak mengejar inflow
```

Fix:

1. Hitung ulang write_rate × TTL × bytes.
2. Kurangi TTL berdasarkan business requirement.
3. Tambahkan per-tenant quota.
4. Compact value.
5. Shard/scale.
6. Reject abusive traffic.

---

## 19. Lab: Mengukur Memory Redis Secara Empiris

### 19.1 Setup

Gunakan Docker:

```bash
docker run --name redis-memory-lab -p 6379:6379 -d redis:8 redis-server --save "" --appendonly no
```

Cek memory awal:

```bash
redis-cli INFO memory
redis-cli MEMORY STATS
```

### 19.2 Test String Key Kecil

Generate 100k key:

```bash
for i in $(seq 1 100000); do
  redis-cli SET "s:$i" "ok" > /dev/null
done
```

Cek:

```bash
redis-cli DBSIZE
redis-cli INFO memory | grep used_memory
```

Hitung bytes per key:

```text
(used_memory_after - used_memory_before) / 100000
```

Bandingkan dengan ukuran value `"ok"`. Kamu akan melihat overhead signifikan.

### 19.3 Test Key Name Panjang

```bash
redis-cli FLUSHDB
```

```bash
for i in $(seq 1 100000); do
  redis-cli SET "production:case-management-service:tenant:tenant-001:case:$i:summary:v3" "ok" > /dev/null
done
```

Bandingkan memory dengan key pendek.

Insight:

> Key name adalah bagian dari dataset memory.

### 19.4 Test Hash vs Banyak String

Banyak string:

```bash
redis-cli FLUSHDB
for i in $(seq 1 100000); do
  redis-cli SET "u:$i:name" "Ayu" > /dev/null
  redis-cli SET "u:$i:status" "ACTIVE" > /dev/null
  redis-cli SET "u:$i:tier" "GOLD" > /dev/null
  redis-cli SET "u:$i:score" "42" > /dev/null
done
redis-cli INFO memory | grep used_memory_human
```

Hash:

```bash
redis-cli FLUSHDB
for i in $(seq 1 100000); do
  redis-cli HSET "u:$i" name "Ayu" status "ACTIVE" tier "GOLD" score "42" > /dev/null
done
redis-cli INFO memory | grep used_memory_human
```

Bandingkan.

Insight:

> Untuk object kecil, Hash sering lebih hemat daripada banyak key string karena mengurangi per-key overhead.

### 19.5 Test Big Key

```bash
redis-cli FLUSHDB
for i in $(seq 1 1000000); do
  redis-cli SADD giant:set "member:$i" > /dev/null
 done
```

Cek:

```bash
redis-cli SCARD giant:set
redis-cli MEMORY USAGE giant:set
```

Jangan jalankan `SMEMBERS giant:set` di environment penting.

Gunakan:

```bash
redis-cli SSCAN giant:set 0 COUNT 100
```

### 19.6 Cleanup

```bash
docker rm -f redis-memory-lab
```

---

## 20. Redis Memory Readiness Checklist

Sebelum Redis usage dianggap production-ready, jawab ini:

### Data Modeling

- [ ] Semua key family terdokumentasi.
- [ ] Semua key family punya owner service.
- [ ] Semua key family punya type eksplisit.
- [ ] Semua key family punya TTL atau alasan no-TTL.
- [ ] Semua key family punya expected cardinality.
- [ ] Semua key family punya max value size.
- [ ] Tidak ada key family yang unbounded tanpa retention.

### Memory Measurement

- [ ] Bytes per entity sudah diukur dengan sample realistis.
- [ ] Average/p95/p99 payload size diketahui.
- [ ] Key name length dipertimbangkan.
- [ ] Data structure overhead dipertimbangkan.
- [ ] Module/index memory dipertimbangkan jika memakai Search/JSON/Vector.

### Eviction Safety

- [ ] Redis instance dedicated berdasarkan data class atau eviction compatibility.
- [ ] Eviction policy sesuai correctness requirement.
- [ ] Eviction alert aktif.
- [ ] Aplikasi bisa handle Redis OOM/error.
- [ ] Tidak ada correctness state di Redis cache `allkeys-lru`.

### Big Key / Hot Key

- [ ] Ada guard untuk payload terlalu besar.
- [ ] Tidak ada endpoint yang melakukan unbounded read.
- [ ] Tidak ada collection global tanpa partition.
- [ ] Hot key strategy ada untuk key read-heavy.
- [ ] Big key scan dilakukan periodik atau saat release besar.

### Operations

- [ ] `used_memory`, `rss`, fragmentation, eviction, expired keys dimonitor.
- [ ] Alert threshold punya runbook.
- [ ] Persistence/fork headroom dihitung.
- [ ] Failover dites dengan dataset realistis.
- [ ] Capacity projection dibuat untuk 3/6/12 bulan.

---

## 21. Ringkasan Mental Model

Redis memory engineering bisa diringkas seperti ini:

```text
Redis capacity = memory budget discipline, not key count optimism.
```

Key lesson:

1. Key name punya biaya.
2. Value punya biaya.
3. Data structure punya biaya.
4. TTL metadata punya biaya.
5. Fragmentation punya biaya.
6. Persistence/fork punya biaya.
7. Replication/client buffers punya biaya.
8. Eviction adalah correctness decision.
9. Big key merusak latency.
10. Hot key merusak distribusi load.
11. Java serialization dan DTO design bisa menggandakan biaya.
12. Ukur dengan `MEMORY USAGE`, `MEMORY STATS`, `INFO memory`, bukan feeling.

Engineer Redis yang kuat bukan hanya tahu command. Ia bisa menjawab:

> “Kalau traffic naik 5x dan TTL tetap, berapa GB Redis yang dibutuhkan, apa yang akan dievict, apakah itu aman, dan apa yang terjadi pada Java service saat Redis menolak write?”

Kalau kamu bisa menjawab itu, Redis mulai menjadi alat arsitektur yang terkendali, bukan cache misterius yang suatu hari penuh sendiri.

---

## 22. Referensi Resmi

- Redis Docs — Memory optimization: https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/
- Redis Docs — Key eviction: https://redis.io/docs/latest/develop/reference/eviction/
- Redis command — `INFO`: https://redis.io/docs/latest/commands/info/
- Redis command — `MEMORY STATS`: https://redis.io/docs/latest/commands/memory-stats/
- Redis command — `MEMORY USAGE`: https://redis.io/docs/latest/commands/memory-usage/
- Redis command — `UNLINK`: https://redis.io/docs/latest/commands/unlink/
- Redis command — `SCAN`: https://redis.io/docs/latest/commands/scan/
- Redis data types overview: https://redis.io/docs/latest/develop/data-types/
- Redis configuration: https://redis.io/docs/latest/operate/oss_and_stack/management/config/

---

## 23. Status Seri

```text
Part 023 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-024.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Redis Cluster: Hash Slots, Resharding, Multi-Key Constraints</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-024.md">Part 024 — Latency Engineering: Pipelining, Batching, Pooling, Timeouts ➡️</a>
</div>
