# learn-redis-mastery-for-java-engineers-part-006.md

# Part 006 — Redis Sets: Membership, Deduplication, Relationship, Eligibility

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `006 / 034`  
> Fokus: Redis Sets untuk membership, deduplication, eligibility, relationship modeling, set algebra, dan constraint Redis Cluster  
> Target pembaca: Java software engineer yang ingin memakai Redis secara production-grade, bukan sekadar tahu command

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- **Strings** sebagai primitive dasar untuk value, counter, token, dan cache blob.
- **Hashes** sebagai object-like structure untuk partial update.
- **Lists** sebagai sequence/queue primitive yang berguna tetapi terbatas.

Bagian ini membahas **Redis Sets**.

Redis Set sering terlihat sederhana: kumpulan string unik tanpa urutan. Namun di sistem backend nyata, Set adalah salah satu primitive paling kuat untuk menjawab pertanyaan seperti:

- Apakah user ini bagian dari group tertentu?
- Apakah event ini sudah pernah diproses?
- Apakah feature ini aktif untuk tenant tertentu?
- Siapa saja user yang eligible untuk campaign ini?
- Item apa yang ada di A tapi tidak ada di B?
- User mana yang memenuhi beberapa kriteria sekaligus?
- Berapa banyak unique actor yang pernah terlihat?
- Bagaimana membangun deduplication window murah dengan TTL?

Redis Set bukan sekadar `HashSet<String>` jarak jauh. Ia adalah primitive untuk **membership decision** dan **set algebra** di sisi server.

Tapi karena Redis memory-first, single command execution, dan cluster-aware, Set juga mudah menjadi sumber masalah:

- `SMEMBERS` pada set besar bisa membekukan Redis cukup lama.
- `SINTER` terhadap set besar bisa mahal.
- Set tanpa TTL bisa tumbuh tanpa batas.
- Multi-key set operation bisa gagal di Redis Cluster jika keys tidak berada di hash slot yang sama.
- Set sering disalahgunakan sebagai “database table mini”.

Jadi tujuan bagian ini bukan hanya hafal command, tetapi membangun mental model kapan Set tepat, bagaimana mendesain key, bagaimana mengukur biayanya, dan bagaimana menulis kode Java yang aman.

---

## 1. Mental Model: Redis Set adalah Unordered Unique Membership Container

Redis Set adalah koleksi member unik yang tidak memiliki urutan.

Secara konseptual:

```text
key: tenant:42:admins
value: Set<String> = {
  "user:1001",
  "user:1002",
  "user:1007"
}
```

Karakter utama:

1. **Unordered**  
   Redis tidak menjamin urutan member.

2. **Unique**  
   Member yang sama tidak bisa muncul dua kali.

3. **String members**  
   Member adalah binary-safe string. Dari sisi Java biasanya direpresentasikan sebagai `String`, `byte[]`, atau serialized value.

4. **Membership check cepat**  
   `SISMEMBER` digunakan untuk mengecek apakah sebuah member ada di set.

5. **Set algebra server-side**  
   Redis bisa melakukan intersection, union, dan difference antar set.

6. **Operasi besar tetap berbahaya**  
   Walaupun membership check murah, operasi yang membaca seluruh isi set tetap proporsional terhadap jumlah member.

Dokumentasi Redis mendefinisikan Set sebagai unordered collection of unique strings yang cocok untuk tracking unique items, merepresentasikan relasi, dan melakukan operasi himpunan seperti intersection/union/difference.

---

## 2. Pertanyaan yang Dijawab oleh Set

Redis Set sangat cocok untuk pertanyaan bertipe **membership** dan **relationship**.

Contoh pertanyaan yang cocok:

```text
Apakah user U anggota group G?
Apakah request R sudah pernah diproses?
Apakah product P ada di wishlist user U?
Apakah tenant T eligible untuk feature F?
Apakah IP ini pernah terlihat hari ini?
Apakah order O sudah masuk deduplication window?
Berapa banyak unique user yang melakukan action hari ini?
Siapa saja user yang memiliki role A dan role B?
Siapa user yang ada di campaign target tetapi belum menerima email?
```

Pertanyaan yang kurang cocok:

```text
Ambil member berdasarkan urutan waktu.
Ambil top-N berdasarkan ranking.
Cari member berdasarkan prefix substring.
Simpan payload kompleks per member.
Query multi-field seperti SQL.
Lakukan pagination stabil berdasarkan sort order.
Audit historis yang harus lengkap dan immutable.
```

Untuk kebutuhan urutan, gunakan List, Stream, atau Sorted Set.  
Untuk ranking/time index, gunakan Sorted Set.  
Untuk payload object-like, gunakan Hash/JSON/source-of-truth database.  
Untuk audit historis, gunakan database/event log yang memang durable dan queryable.

---

## 3. Command Dasar Set

Command paling penting:

| Command | Fungsi |
|---|---|
| `SADD` | Menambah satu atau banyak member |
| `SREM` | Menghapus satu atau banyak member |
| `SISMEMBER` | Mengecek apakah satu member ada |
| `SMISMEMBER` | Mengecek banyak member sekaligus |
| `SCARD` | Mengambil jumlah member |
| `SMEMBERS` | Mengambil semua member |
| `SSCAN` | Iterasi member secara incremental |
| `SPOP` | Mengambil dan menghapus member acak |
| `SRANDMEMBER` | Mengambil member acak tanpa menghapus |
| `SINTER` | Intersection beberapa set |
| `SUNION` | Union beberapa set |
| `SDIFF` | Difference beberapa set |
| `SINTERSTORE` | Simpan hasil intersection ke set baru |
| `SUNIONSTORE` | Simpan hasil union ke set baru |
| `SDIFFSTORE` | Simpan hasil difference ke set baru |

Poin penting: sebagian command adalah **fast** untuk operasi kecil/single member, tetapi command yang harus menyentuh banyak member bisa menjadi mahal.

---

## 4. `SADD`: Add dengan Semantik Deduplication

Contoh:

```bash
SADD tenant:42:admins user:1001
SADD tenant:42:admins user:1002
SADD tenant:42:admins user:1001
```

Redis akan menyimpan `user:1001` hanya sekali.

Return value `SADD` adalah jumlah member baru yang benar-benar ditambahkan.

```bash
> SADD tenant:42:admins user:1001 user:1002 user:1001
(integer) 2
```

Maknanya:

- `2` berarti ada dua member baru.
- Duplikasi dalam command atau member yang sudah ada tidak dihitung.

Ini membuat `SADD` natural untuk deduplication.

Contoh pola:

```bash
SADD processed:payment-events:2026-06-20 evt_9f3a
```

Jika hasil `1`, event baru.  
Jika hasil `0`, event sudah pernah tercatat dalam set tersebut.

Namun hati-hati: `SADD` sendiri tidak memberi TTL per member. TTL berlaku pada key set secara keseluruhan, bukan tiap member.

---

## 5. `SISMEMBER`: Membership Decision Primitive

Contoh:

```bash
SISMEMBER tenant:42:admins user:1001
```

Return:

```text
1 jika member ada
0 jika member tidak ada
```

Dalam desain backend, ini sering menjadi decision point:

```text
if user ∈ tenant-admins:
    allow admin operation
else:
    reject
```

Tapi untuk sistem otorisasi serius, Redis Set sebaiknya diperlakukan sebagai **cache/acceleration layer**, bukan satu-satunya source of truth, kecuali desain durability dan recovery-nya memang sudah dibuktikan.

Pola aman:

```text
Source of truth: PostgreSQL / IAM service / policy store
Redis Set: fast membership projection/cache
```

Risiko jika Redis menjadi satu-satunya authority tanpa governance:

- data hilang karena eviction/persistence misconfiguration,
- stale membership setelah perubahan permission,
- sulit audit siapa mengubah membership,
- tidak ada riwayat perubahan,
- inconsistent ketika refresh gagal.

---

## 6. `SMISMEMBER`: Batch Membership Check

Daripada melakukan banyak `SISMEMBER` satu per satu:

```bash
SISMEMBER tenant:42:enabled-features feature:a
SISMEMBER tenant:42:enabled-features feature:b
SISMEMBER tenant:42:enabled-features feature:c
```

Gunakan:

```bash
SMISMEMBER tenant:42:enabled-features feature:a feature:b feature:c
```

Hasilnya array boolean-ish:

```text
1 0 1
```

Untuk Java service, ini penting karena bottleneck sering bukan CPU Redis, tetapi **network round trip**.

Lebih baik:

```text
1 command dengan 20 member
```

daripada:

```text
20 command individual
```

Terutama pada path request yang latency-sensitive.

---

## 7. `SCARD`: Cardinality Tanpa Membaca Semua Member

`SCARD` mengambil jumlah member:

```bash
SCARD tenant:42:admins
```

Return:

```text
3
```

Ini jauh lebih aman daripada:

```bash
SMEMBERS tenant:42:admins
```

lalu menghitung di aplikasi.

Rule:

```text
Jika hanya butuh jumlah, gunakan SCARD.
Jangan ambil seluruh member hanya untuk menghitung.
```

Contoh penggunaan:

- jumlah unique visitor harian,
- jumlah user dalam audience,
- ukuran deduplication window,
- health check pertumbuhan set,
- quota eligibility count.

Namun `SCARD` tetap hanya memberi angka, bukan distribusi. Jika cardinality besar dan butuh estimasi saja, HyperLogLog mungkin lebih hemat memory. HyperLogLog akan dibahas pada part khusus.

---

## 8. `SMEMBERS`: Command yang Sering Disalahgunakan

`SMEMBERS` mengembalikan semua member dalam set.

Contoh:

```bash
SMEMBERS tenant:42:admins
```

Untuk set kecil, ini normal. Untuk set besar, ini bisa berbahaya.

Masalah `SMEMBERS`:

1. Redis harus membaca seluruh set.
2. Redis harus membangun response besar.
3. Network harus mengirim response besar.
4. Client Java harus menerima dan deserialize response besar.
5. Heap Java bisa melonjak.
6. Latency request bisa meledak.
7. Redis event loop bisa tertahan lebih lama.

Jadi `SMEMBERS` hanya aman jika:

- cardinality dibatasi jelas,
- use case memang perlu semua member,
- ukuran set diketahui kecil,
- bukan dipanggil pada hot request path,
- ada observability untuk ukuran set.

Rule praktis:

```text
Jangan pernah menaruh SMEMBERS pada endpoint request path tanpa batas cardinality yang eksplisit.
```

Lebih baik gunakan `SSCAN` untuk iterasi incremental atau desain query berbeda.

---

## 9. `SSCAN`: Iterasi Incremental

`SSCAN` digunakan untuk membaca member secara bertahap.

Contoh:

```bash
SSCAN tenant:42:members 0 COUNT 100
```

Redis mengembalikan:

```text
next cursor + batch members
```

Selama cursor belum `0`, iterasi belum selesai.

Mental model:

```text
SSCAN bukan pagination stabil.
SSCAN adalah incremental cursor iteration.
```

SSCAN cocok untuk:

- background job,
- migration,
- cleanup,
- sampling/inspection,
- batch processing non-critical,
- maintenance tools.

SSCAN kurang cocok untuk:

- user-facing pagination yang butuh stable order,
- offset-based pagination,
- real-time sorted list,
- exact consistent snapshot ketika set sedang berubah.

Kenapa bukan stable pagination?

Karena Redis Set tidak punya order. Selama iterasi, jika set berubah, hasil scan bisa melewatkan atau mengulang member. Untuk maintenance itu biasanya acceptable; untuk user-facing pagination biasanya tidak.

---

## 10. `SREM`: Remove Membership

Contoh:

```bash
SREM tenant:42:admins user:1001
```

Return value adalah jumlah member yang berhasil dihapus.

```text
1 jika member sebelumnya ada dan dihapus
0 jika member tidak ada
```

`SREM` idempotent secara praktis: memanggil remove terhadap member yang sudah tidak ada tidak merusak state.

Ini cocok untuk event-driven projection:

```text
RoleAssigned  -> SADD tenant:{42}:role:admin user:1001
RoleRevoked   -> SREM tenant:{42}:role:admin user:1001
```

Tapi ada hidden issue: event ordering.

Jika event datang out-of-order:

```text
RoleRevoked(version=11)
RoleAssigned(version=10)
```

lalu diproses apa adanya, Redis Set bisa berakhir salah.

Set tidak menyimpan version per member. Jika ordering/version penting, butuh metadata lain:

- source-of-truth tetap database,
- Redis hanya projection yang bisa rebuild,
- Hash tambahan untuk version,
- Lua script untuk compare version,
- atau gunakan data model lain.

---

## 11. Set untuk Deduplication

Use case umum: event deduplication.

Contoh:

```bash
SADD dedupe:payments:2026-06-20 payment-event-abc
EXPIRE dedupe:payments:2026-06-20 172800
```

Aplikasi:

```text
Jika SADD return 1:
    lanjut proses
Jika SADD return 0:
    skip duplicate
```

Masalah penting: `SADD` dan `EXPIRE` adalah dua command. Jika aplikasi crash setelah `SADD` tetapi sebelum `EXPIRE`, key bisa hidup tanpa TTL.

Alternatif:

1. Gunakan key per idempotency token dengan `SET NX EX` jika TTL per item dibutuhkan.
2. Gunakan Lua untuk `SADD + EXPIRE` atomik jika TTL set-level cukup.
3. Gunakan daily bucket key yang diberi TTL secara terpisah oleh scheduled job atau saat create.

Contoh Lua sederhana:

```lua
-- KEYS[1] = set key
-- ARGV[1] = member
-- ARGV[2] = ttl seconds
local added = redis.call('SADD', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) == -1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return added
```

Catatan: script ini memberi TTL pada set, bukan pada member.

### Set-Level TTL vs Member-Level TTL

Redis Set tidak punya TTL per member.

Jika butuh:

```text
Setiap id dedupe expired 24 jam setelah id itu masuk
```

maka Redis Set biasa kurang cocok.

Gunakan:

```text
SET dedupe:{eventId} "1" NX EX 86400
```

atau Sorted Set dengan score timestamp jika butuh window cleanup manual.

Jika butuh:

```text
Semua id hari ini expired bersama setelah 2 hari
```

maka Set bucket harian cocok:

```text
dedupe:payment:2026-06-20
```

TTL set-level acceptable.

---

## 12. Set untuk Relationship Modeling

Redis Set cocok untuk relationship sederhana.

Contoh:

```text
tenant:{42}:users              -> all users in tenant 42
tenant:{42}:role:admin         -> users with admin role
tenant:{42}:role:reviewer      -> users with reviewer role
user:{1001}:tenants            -> tenants user belongs to
product:{sku123}:watchers      -> users watching product
campaign:{abc}:eligible-users  -> users eligible for campaign
```

Ini mirip many-to-many relationship projection.

Namun ada pertanyaan desain penting:

```text
Apakah kita butuh reverse index?
```

Misalnya:

```text
tenant:{42}:role:admin -> users
user:{1001}:roles:{42} -> roles
```

Jika menyimpan dua arah, update harus menjaga konsistensi dua key.

Contoh assignment:

```bash
SADD tenant:{42}:role:admin user:1001
SADD user:{1001}:tenant:{42}:roles admin
```

Masalah:

- command pertama sukses, command kedua gagal,
- Redis crash di tengah,
- retry menghasilkan state sebagian,
- cluster cross-slot jika key tidak satu slot,
- rollback tidak otomatis.

Solusi:

1. Jadikan Redis sebagai projection yang rebuildable dari source-of-truth.
2. Gunakan Lua jika keys berada di slot yang sama.
3. Gunakan hash tag untuk co-locate keys jika cluster.
4. Simpan satu arah saja jika cukup.
5. Gunakan background reconciliation.

Untuk sistem regulated/defensible, Redis Set sebaiknya bukan authoritative relationship store kecuali persistence, audit, reconciliation, dan recovery sudah matang.

---

## 13. Set untuk Eligibility

Eligibility adalah kondisi “boleh/tidak boleh” berdasarkan membership.

Contoh:

```text
feature:{new-dashboard}:enabled-tenants
campaign:{summer}:eligible-users
tenant:{42}:blocked-users
tenant:{42}:beta-users
policy:{p123}:allowed-case-types
```

Request path:

```text
is tenant 42 in feature:new-dashboard enabled-tenants?
```

Redis:

```bash
SISMEMBER feature:{new-dashboard}:enabled-tenants tenant:42
```

Atau:

```bash
SISMEMBER tenant:{42}:enabled-features new-dashboard
```

### Pilih Orientasi Key Berdasarkan Query Dominan

Dua model:

```text
feature:{featureId}:enabled-tenants -> tenants
```

Bagus untuk:

```text
apakah tenant T enabled untuk feature F?
ambil semua tenant enabled untuk F
```

Model lain:

```text
tenant:{tenantId}:enabled-features -> features
```

Bagus untuk:

```text
ambil semua feature untuk tenant T
cek beberapa feature sekaligus untuk tenant T
```

Dalam Java backend, query dominan biasanya:

```text
Pada setiap request tenant T, cek feature F1/F2/F3.
```

Maka model `tenant:{tenantId}:enabled-features` sering lebih efisien karena bisa memakai `SMISMEMBER` pada satu key.

Namun untuk admin dashboard feature rollout, `feature:{featureId}:enabled-tenants` bisa lebih natural.

Jika butuh dua arah, perlakukan Redis sebagai derived projection.

---

## 14. Set untuk Idempotency dan Processed IDs

Misalnya consumer menerima event dari Kafka/RabbitMQ dan ingin menghindari duplicate processing.

Redis Set:

```text
processed:{consumerName}:{yyyyMMdd}
```

Flow:

```text
1. receive event with eventId
2. SADD processed:{consumer}:{date} eventId
3. if added == 0 -> duplicate, skip
4. if added == 1 -> process
```

Tetapi ada failure mode:

```text
SADD sukses, proses bisnis gagal.
```

Jika retry terjadi, `SADD` return 0 dan event di-skip, padahal proses bisnis belum sukses.

Jadi pola ini hanya aman jika:

- marking sebagai processed dilakukan setelah proses sukses, atau
- proses bisnis idempotent, atau
- ada state machine started/completed/failed, atau
- Redis hanya digunakan sebagai duplicate hint, bukan correctness boundary.

Lebih aman:

```text
1. SET processing:{eventId} owner NX EX 5m
2. process business operation idempotently
3. SADD processed:{bucket} eventId
4. DEL processing:{eventId}
```

Tetapi bahkan ini belum exactly-once. Exactly-once di distributed system adalah kontrak end-to-end, bukan satu command Redis.

Kita akan bahas lebih dalam pada part idempotency.

---

## 15. Set untuk Online Users / Presence

Contoh sederhana:

```bash
SADD presence:online user:1001
SREM presence:online user:1001
```

Masalah: kalau service mati sebelum `SREM`, user tetap dianggap online.

Redis Set tidak punya TTL per member, sehingga presence dengan Set murni rawan stale.

Alternatif:

1. Key per user dengan TTL:

```bash
SET presence:user:1001 "online" EX 60
```

2. Sorted Set dengan score last-seen timestamp:

```bash
ZADD presence:online 1718880000 user:1001
ZREMRANGEBYSCORE presence:online -inf 1718879940
```

3. Set per time bucket:

```text
presence:online:2026-06-20T10:31
```

Untuk presence yang benar-benar membutuhkan expiry per actor, Sorted Set atau key-per-member lebih tepat.

Set cocok jika membership update punya lifecycle eksplisit dan reliable:

```text
login  -> SADD
logout -> SREM
```

Tetapi real-world disconnect jarang reliable.

---

## 16. Set untuk Feature Targeting

Contoh:

```text
tenant:{42}:enabled-features = {"new-dashboard", "bulk-export", "risk-v2"}
```

Java request path:

```text
features = ["new-dashboard", "risk-v2", "experimental-flow"]
SMISMEMBER tenant:{42}:enabled-features new-dashboard risk-v2 experimental-flow
```

Benefit:

- satu Redis command,
- simple mental model,
- fast membership,
- mudah update rollout.

Tapi ada governance concern:

- siapa boleh mengubah set?
- bagaimana audit perubahan feature?
- apakah feature state durable?
- apakah Redis stale setelah rollback?
- apakah default behavior saat Redis down?

Default behavior harus eksplisit:

```text
Jika Redis unavailable:
    fail closed untuk fitur sensitif/security
    fail open untuk fitur non-critical UX?
    fallback ke local cache?
    fallback ke config service?
```

Untuk regulatory system, “Redis down maka semua eligible” biasanya bukan default yang defensible.

---

## 17. Set Algebra: Intersection, Union, Difference

Inilah bagian yang membuat Redis Set lebih dari sekadar membership store.

### 17.1 Intersection: `SINTER`

Contoh:

```text
tenant:{42}:role:reviewer = {u1, u2, u3}
tenant:{42}:trained:aml   = {u2, u3, u4}
tenant:{42}:active-users  = {u2, u4, u5}
```

Query:

```text
Cari user yang reviewer, sudah training AML, dan aktif.
```

Redis:

```bash
SINTER tenant:{42}:role:reviewer tenant:{42}:trained:aml tenant:{42}:active-users
```

Hasil:

```text
{u2}
```

Ini sangat powerful untuk eligibility.

Tapi complexity `SINTER` bergantung pada cardinality input. Redis documentation menyebut worst case `O(N*M)` dengan N cardinality set terkecil dan M jumlah set. Jadi meskipun terlihat satu command, ia bisa mahal jika set besar.

### 17.2 Union: `SUNION`

Contoh:

```text
Semua user yang termasuk salah satu role: admin OR supervisor OR reviewer.
```

```bash
SUNION tenant:{42}:role:admin tenant:{42}:role:supervisor tenant:{42}:role:reviewer
```

Hasil adalah gabungan unik.

### 17.3 Difference: `SDIFF`

Contoh:

```text
Eligible users yang belum menerima campaign.
```

```bash
SDIFF campaign:{abc}:eligible-users campaign:{abc}:sent-users
```

Atau:

```text
Users in tenant but not suspended.
```

```bash
SDIFF tenant:{42}:users tenant:{42}:suspended-users
```

### 17.4 Store Variants

```bash
SINTERSTORE temp:{jobId}:result setA setB setC
SUNIONSTORE temp:{jobId}:result setA setB
SDIFFSTORE temp:{jobId}:result setA setB
EXPIRE temp:{jobId}:result 300
```

Store variants berguna jika hasil digunakan lebih dari sekali.

Tapi hati-hati:

- hasil bisa besar,
- menambah memory pressure,
- butuh TTL,
- di cluster semua key harus slot-compatible,
- stale jika input berubah.

---

## 18. Jangan Jadikan Set Algebra sebagai Query Engine Umum

Mudah tergoda membangun query engine dengan banyak set:

```text
case:type:fraud
case:status:open
case:region:jakarta
case:priority:high
case:assignee:null
```

Lalu query:

```bash
SINTER case:type:fraud case:status:open case:region:jakarta case:priority:high case:assignee:null
```

Ini bisa bekerja untuk search/filter sederhana.

Namun ada risiko:

1. Set harus selalu sinkron dengan source-of-truth.
2. Multi-index update butuh atomicity/reconciliation.
3. Banyak set bisa boros memory.
4. Query kompleks bisa mahal.
5. Pagination dan sorting sulit.
6. Cluster multi-key limitation.
7. Stale index bisa membuat hasil salah.
8. Audit/update reasoning makin rumit.

Jika kebutuhan sudah seperti query engine, pertimbangkan:

- SQL database dengan index yang benar,
- Redis Search jika memang Redis Query Engine cocok,
- Elasticsearch/OpenSearch untuk full-text/search-heavy,
- dedicated read model/projection store.

Redis Set algebra cocok untuk **small/medium bounded eligibility** dan **low-latency membership composition**, bukan pengganti total database query planner.

---

## 19. Random Sampling: `SPOP` dan `SRANDMEMBER`

### 19.1 `SRANDMEMBER`

Ambil member acak tanpa menghapus:

```bash
SRANDMEMBER campaign:{abc}:eligible-users 10
```

Use case:

- sampling untuk inspection,
- random candidate selection,
- canary rollout subset,
- lightweight randomization.

### 19.2 `SPOP`

Ambil dan hapus member acak:

```bash
SPOP queue:random-work 10
```

Use case:

- work distribution sederhana,
- random assignment,
- draining set.

Tapi `SPOP` bukan reliable queue:

```text
Jika worker mengambil item lalu mati sebelum proses selesai, item hilang dari set.
```

Jika butuh reliable queue, gunakan Streams, Lists dengan pending pattern, atau broker yang tepat.

---

## 20. Key Design untuk Sets

Key design menentukan apakah sistem Redis Anda mudah dioperasikan atau menjadi kekacauan.

### 20.1 Format yang Disarankan

Gunakan format:

```text
<domain>:<scope>:<entity>:<attribute>
```

Contoh:

```text
tenant:{42}:users
tenant:{42}:role:admin
tenant:{42}:feature-flags
campaign:{abc}:eligible-users
campaign:{abc}:sent-users
dedupe:{payment-consumer}:2026-06-20
```

### 20.2 Gunakan Hash Tag untuk Cluster-Aware Multi-Key Operations

Di Redis Cluster, key ditempatkan ke hash slot. Multi-key command seperti `SINTER` hanya bisa dilakukan jika semua key ada pada slot yang kompatibel.

Hash tag menggunakan bagian dalam `{...}` untuk menentukan slot.

Contoh:

```text
tenant:{42}:role:reviewer
tenant:{42}:trained:aml
tenant:{42}:active-users
```

Semua key memiliki hash tag `{42}`, sehingga ditempatkan pada slot yang sama.

Ini memungkinkan:

```bash
SINTER tenant:{42}:role:reviewer tenant:{42}:trained:aml tenant:{42}:active-users
```

Jika tanpa hash tag:

```text
tenant:42:role:reviewer
tenant:42:trained:aml
tenant:42:active-users
```

keys bisa jatuh ke slot berbeda dan `SINTER` gagal dengan `CROSSSLOT` di Redis Cluster.

### 20.3 Jangan Asal Pakai Hash Tag Terlalu Luas

Hash tag bisa membantu multi-key operation, tetapi bisa menciptakan hot slot.

Buruk:

```text
app:{global}:set:a
app:{global}:set:b
app:{global}:set:c
```

Semua global keys masuk satu slot, menghilangkan distribusi cluster.

Lebih baik:

```text
tenant:{tenantId}:...
campaign:{campaignId}:...
workflow:{workflowId}:...
```

Prinsip:

```text
Co-locate keys yang memang perlu dioperasikan bersama.
Jangan co-locate seluruh aplikasi.
```

---

## 21. Cluster Multi-Key Limitation

Redis Cluster mendukung single-key command secara natural. Untuk multi-key commands, semua key harus berada pada hash slot yang sama.

Command yang terdampak:

```text
SINTER
SUNION
SDIFF
SINTERSTORE
SUNIONSTORE
SDIFFSTORE
multi-key Lua script
transaction multi-key
```

Contoh gagal:

```bash
SINTER tenant:{42}:role:admin tenant:{43}:role:admin
```

Karena `{42}` dan `{43}` slot berbeda.

Desain perlu bertanya:

```text
Apakah saya perlu operasi set antar tenant?
```

Jika ya, Redis Cluster set algebra mungkin bukan tool tepat, atau butuh strategy lain:

1. lakukan operasi di aplikasi dengan fetching bertahap,
2. buat global projection khusus,
3. gunakan analytics/search system,
4. hindari query cross-tenant di Redis request path,
5. jadikan operasi sebagai background job.

Untuk sistem multi-tenant, ini sangat penting.

---

## 22. Memory Model dan Cardinality Discipline

Redis Set memakai memory. Banyak engineer hanya memikirkan jumlah key, padahal yang sering membunuh Redis adalah jumlah member dan ukuran member.

Memory roughly dipengaruhi oleh:

- jumlah member,
- panjang string member,
- internal encoding,
- overhead object/hash table,
- fragmentation,
- duplicate logical data across reverse indexes,
- temporary result dari set operations.

Contoh buruk:

```text
campaign:all-users = 20 juta user IDs
```

Lalu:

```bash
SMEMBERS campaign:all-users
```

Ini bisa menjadi incident.

Rule desain:

```text
Setiap Set harus punya expected cardinality.
Setiap Set besar harus punya alasan, TTL/lifecycle, dan cara akses yang tidak membaca semuanya.
```

Checklist untuk setiap key Set:

```text
Apa max expected cardinality?
Apa growth driver?
Apakah ada TTL?
Siapa owner key ini?
Apakah boleh di-SMEMBERS?
Apakah butuh SSCAN?
Apakah masuk hot path?
Apakah butuh multi-key operation?
Apakah cluster hash tag sudah benar?
Apa strategi cleanup?
Apa metrik cardinality-nya?
```

---

## 23. Cardinality Categories

Gunakan kategori untuk review desain.

### 23.1 Tiny Set

```text
0 - 100 members
```

Contoh:

- feature flags per tenant,
- roles per user,
- allowed actions per case type.

Biasanya aman untuk `SMEMBERS`, asal tetap bounded.

### 23.2 Small Set

```text
100 - 10,000 members
```

Contoh:

- users in small tenant,
- members in team,
- campaign sample.

`SMEMBERS` masih mungkin, tetapi jangan sembarang di hot path.

### 23.3 Medium Set

```text
10,000 - 1,000,000 members
```

Contoh:

- audience segment,
- dedupe bucket,
- daily unique actors.

Gunakan `SCARD`, `SISMEMBER`, `SSCAN`. Hindari `SMEMBERS` synchronous request.

### 23.4 Large Set

```text
> 1,000,000 members
```

Ini sudah operationally sensitive.

Butuh:

- capacity planning,
- memory budget,
- lifecycle/TTL,
- background processing,
- monitoring,
- avoidance of full materialization,
- possibly different data structure/system.

---

## 24. Set vs Hash vs Sorted Set vs Bitmap vs HyperLogLog

### 24.1 Set vs Hash

Gunakan Set jika hanya butuh membership:

```text
Is user U in group G?
```

Gunakan Hash jika butuh metadata per field:

```text
For user U in group G, what is status/version/assignedAt?
```

Set:

```text
group:{g}:members = {u1, u2, u3}
```

Hash:

```text
group:{g}:member-status = {
  u1: "active",
  u2: "pending"
}
```

Jika Anda menyimpan JSON di dalam set member untuk membawa metadata, itu smell.

Buruk:

```text
SADD group:{g}:members '{"userId":"u1","status":"active"}'
```

Kenapa buruk?

- membership by userId sulit,
- update metadata berarti remove/add exact string,
- duplicate logical user bisa muncul dengan JSON berbeda,
- memory lebih besar,
- query sulit.

### 24.2 Set vs Sorted Set

Gunakan Set jika tidak butuh ordering/ranking/time.

Gunakan Sorted Set jika butuh score:

```text
last seen timestamp
priority
rank
scheduled time
```

Presence lebih cocok Sorted Set daripada Set jika butuh expiry berbasis last seen.

### 24.3 Set vs Bitmap

Gunakan Bitmap jika universe ID integer dense dan state boolean.

Contoh:

```text
userId 1..100M, daily active true/false
```

Set lebih fleksibel untuk arbitrary string ID, tetapi lebih boros memory.

### 24.4 Set vs HyperLogLog

Gunakan Set jika butuh tahu member spesifik:

```text
Apakah user U pernah terlihat?
```

Gunakan HyperLogLog jika hanya butuh approximate cardinality:

```text
Berapa kira-kira unique visitor hari ini?
```

Set akurat tapi memory lebih tinggi. HyperLogLog approximate tapi memory sangat kecil.

---

## 25. Java Integration: Lettuce

Contoh dengan Lettuce synchronous API.

### 25.1 Dependency Conceptual

Pada project Spring Boot modern, Anda mungkin mendapat Lettuce melalui Spring Data Redis. Namun untuk memahami primitive, contoh langsung berguna.

Pseudo Maven dependency:

```xml
<dependency>
  <groupId>io.lettuce</groupId>
  <artifactId>lettuce-core</artifactId>
</dependency>
```

### 25.2 Basic Set Operations

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.util.Set;

public class RedisSetExample {

    public static void main(String[] args) {
        RedisClient client = RedisClient.create("redis://localhost:6379");

        try (StatefulRedisConnection<String, String> connection = client.connect()) {
            RedisCommands<String, String> redis = connection.sync();

            String key = "tenant:{42}:role:admin";

            Long added = redis.sadd(key, "user:1001", "user:1002", "user:1001");
            System.out.println("added = " + added); // 2

            Boolean isAdmin = redis.sismember(key, "user:1001");
            System.out.println("isAdmin = " + isAdmin); // true

            Long count = redis.scard(key);
            System.out.println("count = " + count); // 2

            Set<String> members = redis.smembers(key);
            System.out.println(members);
        } finally {
            client.shutdown();
        }
    }
}
```

Catatan:

- `smembers` mengembalikan semua member. Jangan gunakan untuk set besar.
- Gunakan key hash tag `{42}` jika akan melakukan multi-key operation per tenant di Redis Cluster.

### 25.3 Batch Membership dengan `SMISMEMBER`

Tergantung versi client, API bisa bervariasi. Jika tersedia:

```java
List<Boolean> flags = redis.smismember(
    "tenant:{42}:enabled-features",
    "new-dashboard",
    "risk-v2",
    "bulk-export"
);
```

Jika API belum tersedia atau tidak nyaman, gunakan command interface lower-level atau pipeline beberapa `SISMEMBER`. Tetapi secara prinsip, batch command lebih baik daripada banyak round trip.

---

## 26. Java Integration: Spring Data Redis

### 26.1 RedisTemplate Set Operations

```java
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Repository;

import java.util.Set;

@Repository
public class TenantRoleRedisRepository {

    private final RedisTemplate<String, String> redisTemplate;

    public TenantRoleRedisRepository(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public boolean addAdmin(String tenantId, String userId) {
        String key = "tenant:{" + tenantId + "}:role:admin";
        Long added = redisTemplate.opsForSet().add(key, "user:" + userId);
        return added != null && added == 1L;
    }

    public boolean isAdmin(String tenantId, String userId) {
        String key = "tenant:{" + tenantId + "}:role:admin";
        Boolean member = redisTemplate.opsForSet().isMember(key, "user:" + userId);
        return Boolean.TRUE.equals(member);
    }

    public long countAdmins(String tenantId) {
        String key = "tenant:{" + tenantId + "}:role:admin";
        Long size = redisTemplate.opsForSet().size(key);
        return size == null ? 0L : size;
    }

    public Set<String> getAllAdminsOnlyIfBounded(String tenantId) {
        String key = "tenant:{" + tenantId + "}:role:admin";
        return redisTemplate.opsForSet().members(key);
    }
}
```

Nama method `getAllAdminsOnlyIfBounded` sengaja eksplisit. Ini membantu code review: `members()` tidak boleh terasa harmless.

### 26.2 Jangan Bocorkan Redis Key Construction ke Seluruh Codebase

Buruk:

```java
redisTemplate.opsForSet().isMember("tenant:" + tenantId + ":role:admin", userId)
```

tersebar di banyak service.

Lebih baik buat key builder:

```java
public final class RedisKeys {

    private RedisKeys() {}

    public static String tenantRole(String tenantId, String role) {
        return "tenant:{" + tenantId + "}:role:" + role;
    }

    public static String tenantEnabledFeatures(String tenantId) {
        return "tenant:{" + tenantId + "}:enabled-features";
    }
}
```

Benefit:

- cluster hash tag konsisten,
- naming mudah direview,
- migration lebih mudah,
- key ownership jelas,
- typo berkurang.

---

## 27. Production Pattern: Feature Eligibility Service

Misalnya service perlu cek feature per tenant.

### 27.1 Redis Model

```text
tenant:{tenantId}:enabled-features -> Set<featureCode>
```

Example:

```text
tenant:{42}:enabled-features = {
  "new-dashboard",
  "risk-v2",
  "bulk-export"
}
```

### 27.2 Java Interface

```java
public interface FeatureEligibilityService {
    boolean isEnabled(String tenantId, String featureCode);
    Map<String, Boolean> areEnabled(String tenantId, Collection<String> featureCodes);
}
```

### 27.3 Implementation Skeleton

```java
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class RedisFeatureEligibilityService implements FeatureEligibilityService {

    private final RedisTemplate<String, String> redisTemplate;

    public RedisFeatureEligibilityService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public boolean isEnabled(String tenantId, String featureCode) {
        String key = RedisKeys.tenantEnabledFeatures(tenantId);
        Boolean result = redisTemplate.opsForSet().isMember(key, featureCode);
        return Boolean.TRUE.equals(result);
    }

    @Override
    public Map<String, Boolean> areEnabled(String tenantId, Collection<String> featureCodes) {
        String key = RedisKeys.tenantEnabledFeatures(tenantId);

        Map<String, Boolean> result = new LinkedHashMap<>();

        // Simple version. For high-throughput path, prefer SMISMEMBER if available
        // or pipelining to reduce round trips.
        for (String featureCode : featureCodes) {
            Boolean enabled = redisTemplate.opsForSet().isMember(key, featureCode);
            result.put(featureCode, Boolean.TRUE.equals(enabled));
        }

        return result;
    }
}
```

### 27.4 Failure Policy

Do not hide this decision.

```java
public enum RedisFailurePolicy {
    FAIL_CLOSED,
    FAIL_OPEN,
    FALLBACK_TO_SOURCE_OF_TRUTH,
    FALLBACK_TO_LOCAL_CACHE
}
```

For sensitive features:

```text
FAIL_CLOSED or FALLBACK_TO_SOURCE_OF_TRUTH
```

For cosmetic features:

```text
FAIL_OPEN may be acceptable
```

But this must be product/security decision, not accidental catch block behavior.

---

## 28. Production Pattern: Deduplication Window with Daily Buckets

### 28.1 Model

```text
dedupe:{domain}:{yyyyMMdd}
```

Example:

```text
dedupe:{payment-webhook}:2026-06-20
```

The hash tag `{payment-webhook}` groups related keys if needed, but if all operations are single-key, hash tag is less critical.

### 28.2 Service Contract

```java
public interface DeduplicationWindow {
    boolean markIfFirstSeen(String domain, String eventId);
}
```

### 28.3 Implementation Concern

Need atomic `SADD + EXPIRE` for first creation.

Naive:

```java
Boolean firstSeen = redisTemplate.opsForSet().add(key, eventId) == 1;
redisTemplate.expire(key, Duration.ofDays(3));
```

Problem:

- if crash between commands, TTL may not be set.
- repeatedly calling `EXPIRE` extends lifetime unintentionally if every event refreshes TTL.

Better:

- Set TTL only when no TTL exists.
- Use Lua for atomicity.

Pseudo Lua:

```lua
local added = redis.call('SADD', KEYS[1], ARGV[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl == -1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return added
```

Java with Spring Data Redis:

```java
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class RedisSetDeduplicationWindow implements DeduplicationWindow {

    private static final DefaultRedisScript<Long> SADD_WITH_TTL_SCRIPT = new DefaultRedisScript<>(
        "local added = redis.call('SADD', KEYS[1], ARGV[1]); " +
        "local ttl = redis.call('TTL', KEYS[1]); " +
        "if ttl == -1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])); end; " +
        "return added;",
        Long.class
    );

    private final RedisTemplate<String, String> redisTemplate;

    public RedisSetDeduplicationWindow(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public boolean markIfFirstSeen(String domain, String eventId) {
        String key = "dedupe:{" + domain + "}:" + java.time.LocalDate.now();
        Long added = redisTemplate.execute(
            SADD_WITH_TTL_SCRIPT,
            List.of(key),
            eventId,
            String.valueOf(3 * 24 * 60 * 60)
        );
        return added != null && added == 1L;
    }
}
```

Caveat:

- This marks first-seen, not necessarily successfully processed.
- Use carefully in workflows where failure after mark matters.

---

## 29. Production Pattern: Audience Difference

Requirement:

```text
Send campaign to all eligible users who have not been sent yet.
```

Redis model:

```text
campaign:{abc}:eligible-users
campaign:{abc}:sent-users
```

Command:

```bash
SDIFF campaign:{abc}:eligible-users campaign:{abc}:sent-users
```

For small campaign, okay.

For large campaign, do not materialize all result in API request.

Better:

```bash
SDIFFSTORE campaign:{abc}:remaining-users campaign:{abc}:eligible-users campaign:{abc}:sent-users
EXPIRE campaign:{abc}:remaining-users 3600
```

Then drain with `SPOP` batches:

```bash
SPOP campaign:{abc}:remaining-users 100
```

But remember:

```text
SPOP removes items before processing.
If worker dies after SPOP, those users may be lost unless workflow handles it.
```

Alternative:

- use Streams for reliable processing,
- store assignment state in database,
- use Sorted Set with processing state,
- use campaign send table in SQL.

Redis Set can help compute candidate sets, but delivery reliability needs separate design.

---

## 30. Anti-Pattern: Giant Global Set

Example:

```text
users:all
```

with 100M members.

This looks simple, but operationally dangerous.

Problems:

- memory huge,
- `SMEMBERS users:all` incident risk,
- set operations expensive,
- migration difficult,
- no tenant boundary,
- cluster hot key/hot slot risk,
- unclear lifecycle.

Better:

```text
tenant:{42}:users
users:bucket:{00}
users:bucket:{01}
...
```

or do not store this in Redis at all if source database can answer correctly.

---

## 31. Anti-Pattern: Set as Table

Bad design:

```text
SADD cases '{"caseId":"c1","status":"open","risk":"high"}'
SADD cases '{"caseId":"c2","status":"closed","risk":"low"}'
```

This is not queryable, not update-friendly, and not type-safe.

If you need cases by status:

```text
case-index:{status:open} -> Set<caseId>
case:{caseId} -> Hash/details elsewhere
```

But then you are building secondary indexes. You need:

- consistency plan,
- rebuild plan,
- versioning,
- source-of-truth,
- cleanup,
- cluster key design.

Often SQL indexes are a better answer.

---

## 32. Anti-Pattern: Blind `SMEMBERS` in REST Endpoint

Example:

```java
@GetMapping("/tenants/{tenantId}/users")
public Set<String> getUsers(@PathVariable String tenantId) {
    return redisTemplate.opsForSet().members("tenant:{" + tenantId + "}:users");
}
```

This endpoint has no cardinality guard.

Problems:

- tenant with 10 users works,
- tenant with 10 million users causes incident,
- response payload huge,
- timeout,
- Redis latency spike,
- JVM memory pressure.

Better:

- use database pagination,
- use Sorted Set if ordered pagination is required,
- use `SSCAN` only for internal/batch use,
- enforce max cardinality,
- expose count with `SCARD` separately.

---

## 33. Anti-Pattern: Assuming Set Member Expiry

Bad assumption:

```text
I added user to set with TTL, so each user expires individually.
```

Wrong. TTL applies to the whole key.

If you do:

```bash
SADD online-users user:1001
EXPIRE online-users 60
```

then the entire `online-users` set expires after 60 seconds, not `user:1001` only.

If another user is added later, there is still one TTL for the whole set.

Use:

- key-per-member TTL,
- Sorted Set timestamp,
- bucketed sets,
- Streams/other model.

---

## 34. Anti-Pattern: Cross-Slot Set Algebra in Cluster

This works in standalone Redis:

```bash
SINTER tenant:42:role:admin tenant:42:active-users
```

But may fail in Redis Cluster because keys can be on different slots.

Cluster-safe:

```bash
SINTER tenant:{42}:role:admin tenant:{42}:active-users
```

Do not postpone cluster key design until migration. Retrofitting hash tags later is painful because key names change and data migration is required.

---

## 35. Performance Reasoning

### 35.1 Fast Path

Good fast path commands:

```text
SADD small number of members
SREM small number of members
SISMEMBER
SMISMEMBER bounded list
SCARD
```

These are usually safe in request path if Redis itself is healthy and network is controlled.

### 35.2 Potentially Expensive Path

Be careful with:

```text
SMEMBERS
SINTER
SUNION
SDIFF
SINTERSTORE
SUNIONSTORE
SDIFFSTORE
SSCAN full iteration
SPOP large count
SRANDMEMBER large count
```

They may be fine in batch jobs or bounded sets, but need explicit reasoning.

### 35.3 Tail Latency

Even if average latency is low, one bad command can cause tail spikes.

Example:

```text
A background job runs SMEMBERS huge-set.
Redis event loop spends time preparing response.
Normal GET/SISMEMBER requests queue behind it.
P99/P999 latency spikes.
```

This is why Redis operational skill is not just command knowledge. It is workload isolation and command discipline.

---

## 36. Observability for Sets

Track at least:

1. Cardinality of important sets via `SCARD`.
2. Growth rate of set cardinality.
3. TTL existence for lifecycle-bound sets.
4. Frequency of `SMEMBERS`/`SINTER`/`SUNION`/`SDIFF`.
5. Slowlog entries involving set commands.
6. Big keys.
7. Hot keys.
8. Memory usage by Redis instance.
9. Network egress spikes.
10. Client heap spikes after large responses.

Example operational probe:

```bash
SCARD dedupe:{payment-webhook}:2026-06-20
TTL dedupe:{payment-webhook}:2026-06-20
```

For large systems, do not manually inspect only. Build dashboards.

---

## 37. Testing Set-Based Logic

### 37.1 Unit Test Key Builder

```java
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class RedisKeysTest {

    @Test
    void tenantRoleUsesTenantHashTag() {
        assertThat(RedisKeys.tenantRole("42", "admin"))
            .isEqualTo("tenant:{42}:role:admin");
    }
}
```

This seems trivial, but prevents cluster-breaking typos.

### 37.2 Integration Test with Testcontainers

```java
@Test
void addAdminIsIdempotent() {
    repository.addAdmin("42", "1001");
    repository.addAdmin("42", "1001");

    assertThat(repository.countAdmins("42")).isEqualTo(1L);
    assertThat(repository.isAdmin("42", "1001")).isTrue();
}
```

### 37.3 Test TTL for Dedupe Buckets

```java
@Test
void dedupeBucketHasTtl() {
    boolean first = dedupe.markIfFirstSeen("payment-webhook", "evt-1");

    assertThat(first).isTrue();
    Long ttl = redisTemplate.getExpire("dedupe:{payment-webhook}:" + LocalDate.now());
    assertThat(ttl).isNotNull();
    assertThat(ttl).isPositive();
}
```

### 37.4 Failure Tests

Test:

- duplicate event,
- Redis down,
- Redis timeout,
- set with unexpected type,
- key without TTL,
- large cardinality guard,
- cluster cross-slot in staging if using cluster.

---

## 38. Design Review Framework for Redis Sets

Saat review desain yang memakai Redis Set, tanyakan:

### 38.1 Semantics

```text
Apa arti membership?
Apakah membership authoritative atau cache/projection?
Apa yang terjadi jika membership stale?
Apa default jika key missing?
Apa default jika Redis unavailable?
```

### 38.2 Lifecycle

```text
Apakah set perlu TTL?
Apakah member perlu TTL individual?
Bagaimana cleanup dilakukan?
Apa growth limit?
Apakah ada memory budget?
```

### 38.3 Access Pattern

```text
Apakah hanya SISMEMBER/SCARD?
Apakah ada SMEMBERS?
Apakah ada SINTER/SUNION/SDIFF?
Apakah operasi tersebut bounded?
Apakah masuk request path atau background path?
```

### 38.4 Cluster

```text
Apakah akan pakai Redis Cluster?
Apakah multi-key operations butuh hash tag?
Apakah hash tag menciptakan hot slot?
Apakah query cross-tenant dibutuhkan?
```

### 38.5 Consistency

```text
Jika Redis adalah projection, bagaimana rebuild?
Bagaimana event ordering?
Bagaimana partial update ditangani?
Apakah reverse index perlu reconciliation?
```

### 38.6 Java

```text
Apakah key construction tersentralisasi?
Apakah serializer eksplisit?
Apakah timeout/retry policy jelas?
Apakah large response dicegah?
Apakah pipelining/batching dipakai untuk batch membership?
```

---

## 39. Case Study: Reviewer Eligibility in Regulatory Workflow

Misalnya ada case management system.

Requirement:

```text
Untuk assign case AML high-risk, reviewer harus:
1. berada di tenant yang sama,
2. memiliki role reviewer,
3. sudah lulus training AML,
4. sedang active,
5. tidak sedang suspended.
```

Redis model:

```text
tenant:{42}:users
tenant:{42}:role:reviewer
tenant:{42}:training:aml-certified
tenant:{42}:active-users
tenant:{42}:suspended-users
```

Compute eligible:

```bash
SINTERSTORE tenant:{42}:tmp:eligible-reviewers:case:{caseId} \
  tenant:{42}:role:reviewer \
  tenant:{42}:training:aml-certified \
  tenant:{42}:active-users

SDIFFSTORE tenant:{42}:tmp:eligible-reviewers-final:case:{caseId} \
  tenant:{42}:tmp:eligible-reviewers:case:{caseId} \
  tenant:{42}:suspended-users

EXPIRE tenant:{42}:tmp:eligible-reviewers:case:{caseId} 60
EXPIRE tenant:{42}:tmp:eligible-reviewers-final:case:{caseId} 60
```

Then choose candidate.

But ask:

```text
Is this decision auditable?
```

If assignment is regulatory-sensitive, Redis result should probably be treated as acceleration, while final assignment record stores:

- case id,
- selected reviewer,
- decision timestamp,
- criteria version,
- source policy version,
- reason/candidate set summary if needed,
- fallback path.

Redis can help compute fast. It should not silently become the only audit evidence.

---

## 40. Case Study: Feature Rollout with Tenant Sets

Requirement:

```text
Roll out feature risk-v2 to selected tenants.
```

Model A:

```text
feature:{risk-v2}:enabled-tenants -> Set<tenantId>
```

Check:

```bash
SISMEMBER feature:{risk-v2}:enabled-tenants tenant:42
```

Model B:

```text
tenant:{42}:enabled-features -> Set<featureCode>
```

Check:

```bash
SISMEMBER tenant:{42}:enabled-features risk-v2
```

If each request checks many features for one tenant, Model B is often better.

If admin system often lists tenants for a feature, Model A is better.

If both are needed, use source-of-truth and Redis projections both ways, with rebuild capability.

---

## 41. Case Study: Duplicate Webhook Handling

Requirement:

```text
Payment provider may send duplicate webhook event IDs.
Deduplicate within 7 days.
```

Option 1: Set bucket per day.

```text
dedupe:{payment}:2026-06-20
```

Pros:

- easy count,
- memory grouping,
- simple cleanup with TTL,
- good for reporting daily duplicates.

Cons:

- TTL per bucket, not per event,
- event near midnight edge cases,
- marking first-seen before success can skip failed processing.

Option 2: Key per event.

```bash
SET dedupe:{payment}:evt_abc "1" NX EX 604800
```

Pros:

- TTL per event,
- atomic set-if-not-exists with expiry,
- simple semantics.

Cons:

- many keys,
- keyspace larger,
- count/reporting harder.

Decision:

```text
If correctness is per event TTL -> SET NX EX.
If daily bucket reporting and bounded dedupe are enough -> Set bucket.
```

Redis Set is not always the best dedupe primitive. Choose by lifecycle semantics.

---

## 42. Practical CLI Lab

Run Redis locally:

```bash
docker run --rm -p 6379:6379 redis:8
```

Open CLI:

```bash
docker exec -it <container-id> redis-cli
```

### 42.1 Basic Membership

```bash
DEL tenant:{42}:role:admin
SADD tenant:{42}:role:admin user:1001 user:1002 user:1001
SCARD tenant:{42}:role:admin
SISMEMBER tenant:{42}:role:admin user:1001
SISMEMBER tenant:{42}:role:admin user:9999
SMEMBERS tenant:{42}:role:admin
```

Expected:

```text
SADD returns 2
SCARD returns 2
SISMEMBER user:1001 returns 1
SISMEMBER user:9999 returns 0
```

### 42.2 Set Algebra

```bash
DEL tenant:{42}:role:reviewer tenant:{42}:trained:aml tenant:{42}:active-users

SADD tenant:{42}:role:reviewer user:1 user:2 user:3
SADD tenant:{42}:trained:aml user:2 user:3 user:4
SADD tenant:{42}:active-users user:2 user:4 user:5

SINTER tenant:{42}:role:reviewer tenant:{42}:trained:aml tenant:{42}:active-users
```

Expected:

```text
user:2
```

### 42.3 Difference

```bash
DEL campaign:{abc}:eligible-users campaign:{abc}:sent-users

SADD campaign:{abc}:eligible-users user:1 user:2 user:3 user:4
SADD campaign:{abc}:sent-users user:2 user:4

SDIFF campaign:{abc}:eligible-users campaign:{abc}:sent-users
```

Expected:

```text
user:1
user:3
```

### 42.4 SSCAN

```bash
SSCAN campaign:{abc}:eligible-users 0 COUNT 2
```

Repeat with returned cursor until cursor is `0`.

---

## 43. Common Mistakes Summary

| Mistake | Why It Hurts | Better Approach |
|---|---|---|
| Using `SMEMBERS` in request path | Large response, latency spike | `SISMEMBER`, `SCARD`, `SSCAN`, DB pagination |
| Assuming per-member TTL | Redis TTL is key-level | key-per-member or Sorted Set |
| Cross-slot `SINTER` in cluster | Fails with CROSSSLOT | hash tags or redesign |
| Set as JSON table | Hard to query/update | Hash/source DB/index model |
| No cardinality limit | Memory grows unbounded | capacity plan + TTL + metrics |
| Reverse index without reconciliation | Inconsistent membership | source-of-truth + rebuild |
| Using Set for reliable queue | Item loss after `SPOP` | Streams/List/broker/DB state |
| Dedup mark before successful processing | Can skip failed work | mark after success or state machine |
| Global giant set | Hot key/memory incident | partitioning or different system |
| No key builder in Java | inconsistent keys/cluster bugs | centralized key naming |

---

## 44. Redis Sets Cheat Sheet

```bash
# Add members
SADD key member [member ...]

# Remove members
SREM key member [member ...]

# Check membership
SISMEMBER key member

# Check multiple memberships
SMISMEMBER key member [member ...]

# Count members
SCARD key

# Get all members - only if bounded
SMEMBERS key

# Incremental scan
SSCAN key cursor [MATCH pattern] [COUNT count]

# Random read
SRANDMEMBER key [count]

# Random pop
SPOP key [count]

# Intersection
SINTER key [key ...]
SINTERSTORE destination key [key ...]

# Union
SUNION key [key ...]
SUNIONSTORE destination key [key ...]

# Difference
SDIFF key [key ...]
SDIFFSTORE destination key [key ...]
```

---

## 45. Heuristics: When to Use Redis Set

Gunakan Redis Set ketika:

```text
Saya butuh cek membership cepat.
Saya butuh dedupe sederhana.
Saya butuh representasi relation many-to-many sebagai projection.
Saya butuh intersection/union/difference untuk bounded sets.
Saya tidak butuh ordering.
Saya tidak butuh metadata per member.
Saya tahu cardinality dan lifecycle-nya.
```

Jangan gunakan Redis Set ketika:

```text
Saya butuh per-member TTL.
Saya butuh sorted pagination.
Saya butuh payload kompleks per member.
Saya butuh query multi-field yang berkembang.
Saya butuh audit historis authoritative.
Saya akan sering membaca seluruh set besar.
Saya butuh reliable queue semantics.
Saya butuh cross-slot set operations di Redis Cluster.
```

---

## 46. Mental Model Akhir

Redis Set adalah primitive untuk **membership truth at speed**.

Tapi kalimat itu harus dibaca hati-hati:

```text
membership -> iya, ini domain utamanya
truth      -> hanya jika durability/consistency/audit-nya memang didesain
speed      -> hanya untuk operasi bounded dan command discipline yang benar
```

Redis Set sangat kuat ketika dipakai untuk:

- membership check,
- deduplication bounded,
- eligibility projection,
- role/feature membership,
- relationship cache,
- set algebra untuk candidate filtering.

Redis Set berbahaya ketika dipakai sebagai:

- table,
- search engine,
- reliable queue,
- audit store,
- unbounded global registry,
- source-of-truth tanpa recovery.

Sebagai Java engineer, skill utamanya bukan hanya tahu `SADD` dan `SISMEMBER`, tetapi tahu:

```text
Apa contract membership ini?
Apa lifecycle-nya?
Berapa cardinality-nya?
Apa failure behavior-nya?
Apakah cluster-safe?
Apakah operasi ini bounded?
Apakah Java client akan menerima response besar?
Apakah Redis hanya cache/projection atau authority?
```

Jika pertanyaan-pertanyaan itu terjawab, Redis Set menjadi alat yang sangat efektif.

---

## 47. Latihan Mandiri

### Latihan 1 — Feature Flag Model

Desain Redis Set untuk feature flag multi-tenant.

Jawab:

1. Key apa yang dipakai?
2. Query dominan apa?
3. Apakah butuh reverse index?
4. Apa fallback jika Redis down?
5. Bagaimana audit perubahan feature dilakukan?

### Latihan 2 — Dedupe Webhook

Desain dedupe untuk webhook 7 hari.

Bandingkan:

```text
Set bucket harian
vs
SET NX EX per event
vs
Sorted Set timestamp
```

Pilih salah satu dan jelaskan trade-off.

### Latihan 3 — Reviewer Eligibility

Buat model Redis Set untuk memilih reviewer case.

Kriteria:

- tenant sama,
- role reviewer,
- certified,
- active,
- not suspended.

Tuliskan command Redis untuk menghasilkan candidate set.

Lalu jawab:

```text
Apakah hasil Redis cukup untuk audit?
Jika tidak, data apa yang harus disimpan di source-of-truth?
```

### Latihan 4 — Cluster Key Design

Ubah key berikut agar cluster-safe untuk `SINTER` per tenant:

```text
tenant:42:role:admin
tenant:42:active-users
tenant:42:trained:aml
```

Jawaban yang diharapkan:

```text
tenant:{42}:role:admin
tenant:{42}:active-users
tenant:{42}:trained:aml
```

### Latihan 5 — Code Review

Review kode berikut:

```java
public Set<String> allUsers(String tenantId) {
    return redisTemplate.opsForSet().members("tenant:" + tenantId + ":users");
}
```

Identifikasi minimal 5 masalah.

---

## 48. Referensi Resmi untuk Bagian Ini

Referensi utama yang sebaiknya dibaca setelah menyelesaikan bagian ini:

- Redis documentation — Sets data type.
- Redis command documentation — `SADD`, `SREM`, `SISMEMBER`, `SMISMEMBER`, `SCARD`, `SMEMBERS`, `SSCAN`.
- Redis command documentation — `SINTER`, `SUNION`, `SDIFF` dan store variants.
- Redis Cluster specification — hash slots dan hash tags.
- Spring Data Redis documentation — Set operations through `RedisTemplate`.
- Lettuce documentation — Redis Java client usage.

---

## 49. Ringkasan

Redis Sets adalah struktur data sederhana dengan dampak arsitektural besar.

Yang harus Anda bawa dari bagian ini:

1. Set menjawab pertanyaan membership dan relation.
2. `SADD` memberi dedupe natural.
3. `SISMEMBER` adalah primitive decision cepat.
4. `SCARD` aman untuk count tanpa membaca semua member.
5. `SMEMBERS` harus diperlakukan sebagai command berbahaya jika cardinality tidak bounded.
6. `SSCAN` adalah incremental iteration, bukan stable pagination.
7. `SINTER`, `SUNION`, dan `SDIFF` powerful tetapi bisa mahal.
8. Redis Cluster memaksa multi-key set operations berada dalam hash slot yang sama.
9. TTL berlaku pada key, bukan member.
10. Set cocok sebagai projection/cache, tetapi source-of-truth butuh durability, audit, dan rebuild strategy.
11. Java code harus punya key builder, serializer jelas, dan guard terhadap large response.
12. Production Redis Set design harus selalu menyebut cardinality, lifecycle, failure behavior, dan cluster strategy.

---

## 50. Status Seri

```text
Part 006 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-007.md
```

Part berikutnya akan membahas:

```text
Redis Sorted Sets: Ranking, Scheduling, Priority, Time Index
```

Di sana kita akan membahas `ZADD`, `ZRANGE`, `ZRANK`, score modeling, leaderboard, delay queue, sliding window rate limiter, time index, pagination pitfall, dan Java implementation patterns.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Redis Lists: Queue Primitive, Log Kecil, dan Blocking Pop</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-007.md">Part 007 — Sorted Sets: Ranking, Scheduling, Priority, Time Index ➡️</a>
</div>
