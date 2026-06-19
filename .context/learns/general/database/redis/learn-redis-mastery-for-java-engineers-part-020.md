# learn-redis-mastery-for-java-engineers-part-020.md

# Part 020 — Persistence: RDB, AOF, Durability, Recovery

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara benar di sistem produksi  
> Fokus bagian ini: persistence, durability boundary, crash recovery, backup, dan konsekuensi arsitektural

---

## 0. Posisi Bagian Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membahas Redis sebagai:

- in-memory data structure server,
- cache layer,
- rate limiter,
- idempotency store,
- lock/coordination primitive,
- Pub/Sub tool,
- Stream engine ringan,
- compact state store,
- dan retrieval/query layer modern.

Namun ada satu pertanyaan yang sering dianggap remeh:

> Kalau Redis mati, data apa yang boleh hilang?

Jawaban terhadap pertanyaan itu menentukan apakah Redis hanya cache, semi-durable working state, atau sudah menjadi bagian dari system of record.

Bagian ini membahas persistence Redis dengan tujuan bukan hanya tahu cara mengaktifkan RDB atau AOF, tetapi memahami **kontrak durability** yang sebenarnya.

---

## 1. Mental Model Utama: Redis Adalah Memory-First System

Redis menyimpan working dataset utama di memory.

Disk pada Redis bukan tempat utama command dilayani. Disk dipakai untuk:

1. snapshot,
2. append log,
3. restart recovery,
4. backup,
5. replication bootstrap,
6. operational durability.

Ini berbeda dari database seperti PostgreSQL/MySQL yang storage engine-nya memang disk/page/WAL-oriented sejak awal.

Redis harus dipahami seperti ini:

```text
Client command
   ↓
Redis memory state berubah
   ↓
Persistence mechanism mencoba merekam state/log ke disk sesuai konfigurasi
   ↓
Jika crash, Redis mencoba membangun ulang memory state dari file persistence
```

Konsekuensi besar:

```text
Acknowledged write ≠ pasti sudah durable di disk
```

Tergantung konfigurasi, write yang sudah sukses ke client bisa saja hilang ketika proses, host, disk, atau OS crash.

---

## 2. Tiga Mode Persistence Redis

Secara praktis, Redis punya tiga mode besar:

| Mode | Penjelasan | Cocok Untuk |
|---|---|---|
| No persistence | Semua data hanya di memory | pure cache, disposable state |
| RDB | snapshot point-in-time | backup, restart cepat, durability periodik |
| AOF | append-only command log | durability lebih baik, recovery berdasarkan log operasi |
| RDB + AOF | kombinasi snapshot dan append log | mayoritas use case durable Redis |

Redis modern juga mendukung AOF dengan format multi-part, tetapi mental model dasarnya tetap: Redis merekam operasi tulis agar bisa replay saat restart.

---

## 3. Sebelum Memilih RDB/AOF: Klasifikasikan Data Redis Anda

Engineer sering langsung bertanya:

> Pakai RDB atau AOF?

Pertanyaan yang lebih benar:

> Data Redis ini boleh hilang berapa banyak, dalam kondisi failure apa, dan apa mekanisme rekonstruksinya?

Gunakan klasifikasi berikut.

### 3.1 Disposable Cache

Contoh:

- product detail cache,
- user profile cache,
- configuration cache yang bisa reload dari DB,
- search result cache,
- expensive computation cache.

Karakteristik:

```text
Jika Redis kosong setelah restart, sistem tetap benar, hanya lebih lambat.
```

Untuk ini, persistence sering tidak wajib.

Bahkan persistence bisa merugikan karena:

- memperbesar disk I/O,
- memperlambat restart kalau dataset besar,
- membawa stale cache kembali setelah restart,
- membuat operator mengira cache adalah data durable.

### 3.2 Rebuildable Derived State

Contoh:

- rate limiter counters,
- online presence,
- recently seen IDs,
- short-lived workflow state,
- idempotency window yang juga bisa diverifikasi dari DB/event log.

Karakteristik:

```text
Kehilangan data tidak ideal, tetapi dapat ditoleransi dalam window tertentu.
```

Untuk ini, RDB atau AOF bisa dipakai tergantung toleransi kehilangan.

### 3.3 Operationally Important State

Contoh:

- idempotency response cache untuk pembayaran,
- distributed token registry,
- delay queue penting,
- Redis Stream untuk pekerjaan yang belum diproses,
- temporary workflow decision state.

Karakteristik:

```text
Kehilangan data bisa menyebabkan duplicate processing, inconsistent behavior, atau manual recovery.
```

Untuk ini, persistence harus dirancang serius.

Biasanya tidak cukup hanya “aktifkan AOF”. Harus ada:

- failure matrix,
- replay/reconciliation process,
- monitoring persistence lag,
- backup restore drill,
- bounded retention,
- idempotent downstream handling.

### 3.4 True System of Record

Contoh:

- ledger,
- account balance,
- legal case record,
- enforcement action state,
- audit log primer,
- irreversible business decision.

Untuk kelas ini, Redis umumnya **bukan pilihan default** sebagai source of truth.

Redis bisa menjadi acceleration/coordination layer, tetapi data authoritative sebaiknya berada di sistem yang punya durability, transaction semantics, auditability, backup, restore, migration, dan governance yang sesuai.

Dalam sistem regulatori, Redis sebaiknya tidak menjadi satu-satunya tempat menyimpan fakta yang harus bisa dipertahankan secara legal.

---

## 4. RDB Snapshot

RDB adalah mekanisme persistence berbasis snapshot.

Redis menyimpan representasi dataset pada waktu tertentu ke file `.rdb`.

Mental model:

```text
Pada interval/kondisi tertentu:
Redis membuat snapshot dataset memory → menulisnya ke disk → file RDB dipakai saat restart
```

Contoh konfigurasi historis:

```conf
save 900 1
save 300 10
save 60 10000
```

Artinya kira-kira:

```text
Buat snapshot jika:
- minimal 1 perubahan dalam 900 detik, atau
- minimal 10 perubahan dalam 300 detik, atau
- minimal 10000 perubahan dalam 60 detik
```

Di Redis modern, konfigurasi bisa berbeda tergantung distribusi, tetapi prinsipnya sama.

---

## 5. Cara Kerja RDB Secara Konseptual

Saat Redis membuat RDB snapshot, proses umumnya:

```text
1. Redis menerima trigger snapshot.
2. Redis fork child process.
3. Child process menulis dataset ke temporary RDB file.
4. Setelah sukses, file lama diganti secara atomic dengan file baru.
5. Parent process tetap melayani client.
```

Redis memakai `fork()` agar parent tetap melayani request.

Namun fork bukan gratis.

Fork memicu mekanisme copy-on-write OS.

---

## 6. Copy-on-Write dan Risiko Memory Saat RDB

Copy-on-write berarti parent dan child awalnya berbagi halaman memory yang sama.

Jika parent mengubah data saat child sedang menulis snapshot, halaman memory yang berubah perlu disalin agar child tetap melihat snapshot konsisten.

Mental model:

```text
Dataset besar + write rate tinggi saat snapshot
   ↓
Banyak memory page berubah
   ↓
Copy-on-write meningkat
   ↓
Memory usage sementara naik
   ↓
Risiko latency spike atau OOM
```

Ini salah satu alasan kenapa Redis persistence adalah topik operations, bukan hanya konfigurasi.

### 6.1 Contoh Risiko

Misalkan Redis menyimpan dataset 80 GB di host dengan RAM 96 GB.

Pada saat RDB snapshot:

- child process mulai menulis snapshot,
- parent tetap menerima write,
- banyak halaman memory berubah,
- copy-on-write menambah penggunaan memory,
- host kehabisan memory.

Hasilnya bisa buruk:

- Redis killed by OOM killer,
- snapshot gagal,
- latency memburuk,
- failover terpacu,
- client timeout massal.

### 6.2 Invariant Operasional

Untuk Redis dengan persistence aktif:

```text
Available RAM harus cukup untuk dataset + fragmentation + client buffers + replication buffers + copy-on-write headroom.
```

Jangan sizing Redis hanya berdasarkan ukuran data logical.

---

## 7. Kelebihan RDB

RDB unggul untuk:

1. file snapshot compact,
2. backup point-in-time,
3. restart relatif cepat dibanding replay log panjang,
4. cocok untuk disaster recovery periodik,
5. cocok untuk cache/derived state yang boleh kehilangan beberapa menit data.

RDB sangat berguna jika Anda ingin punya snapshot dataset Redis yang mudah dipindahkan.

---

## 8. Kekurangan RDB

Kekurangan utama RDB:

1. data loss window lebih besar,
2. fork bisa mahal,
3. snapshot bisa gagal jika disk/RAM tidak cukup,
4. tidak mencatat setiap operasi,
5. recovery state hanya sejauh snapshot terakhir.

Jika Redis crash pada pukul 10:10 dan snapshot terakhir pukul 10:00, maka perubahan 10 menit terakhir bisa hilang.

Untuk pure cache, ini bukan masalah.

Untuk idempotency/payment token/queue penting, ini bisa fatal.

---

## 9. AOF: Append Only File

AOF mencatat operasi tulis Redis ke file append-only.

Mental model:

```text
Client write command
   ↓
Redis apply ke memory
   ↓
Redis append command/logical representation ke AOF buffer/file
   ↓
AOF dipakai untuk replay saat restart
```

Berbeda dari RDB yang menyimpan snapshot state, AOF menyimpan urutan perubahan.

Saat restart:

```text
Redis membaca AOF → replay command → memory state terbentuk kembali
```

---

## 10. AOF fsync Policy

Parameter paling penting dalam AOF adalah kapan Redis meminta OS melakukan flush ke disk secara durable.

Umumnya ada tiga mode:

```conf
appendfsync always
appendfsync everysec
appendfsync no
```

### 10.1 `appendfsync always`

Redis melakukan fsync pada setiap write.

Karakteristik:

```text
Durability paling kuat, latency paling mahal.
```

Kelebihan:

- data loss window minimal.

Kekurangan:

- throughput turun,
- latency write naik,
- sangat bergantung performa disk,
- tail latency bisa buruk.

Jarang dipakai untuk workload Redis high-throughput kecuali benar-benar butuh durability kuat dan sudah diuji.

### 10.2 `appendfsync everysec`

Redis melakukan fsync kira-kira setiap detik.

Karakteristik:

```text
Trade-off default yang umum: kehilangan data sekitar maksimum ±1 detik pada crash tertentu.
```

Kelebihan:

- performa jauh lebih baik dari always,
- durability jauh lebih baik dari no persistence,
- cocok untuk banyak use case operational state.

Kekurangan:

- write yang sudah acknowledged masih bisa hilang jika crash sebelum fsync,
- saat disk lambat, fsync bisa berdampak pada latency.

### 10.3 `appendfsync no`

Redis menyerahkan flush ke OS.

Karakteristik:

```text
Performa tinggi, durability lemah.
```

Data loss window tergantung OS flush behavior.

Cocok jika AOF hanya untuk best-effort recovery.

---

## 11. Important Distinction: Process Crash vs Machine Crash vs Disk Failure

Durability tidak bisa dibahas tanpa failure type.

| Failure | Dampak Persistence |
|---|---|
| Redis process crash | Data yang sudah ditulis ke OS buffer mungkin masih ada; recovery bisa baik |
| OS crash / power loss | Data belum fsync bisa hilang |
| Disk failure | RDB/AOF bisa hilang/rusak jika tidak ada backup/replica |
| Filesystem corruption | Recovery bisa butuh repair/check |
| Host loss | Perlu replica/backup eksternal |
| Region loss | Perlu DR lintas availability zone/region |

Jadi pernyataan “AOF aktif berarti aman” terlalu lemah.

Pertanyaan yang benar:

```text
Aman terhadap failure apa?
Dengan kehilangan maksimum berapa?
Dengan recovery time berapa?
Dengan verification apa?
```

---

## 12. AOF Rewrite

AOF tumbuh seiring waktu.

Contoh:

```text
SET counter 1
INCR counter
INCR counter
INCR counter
DEL old:key
SET user:1:name "A"
SET user:1:name "B"
SET user:1:name "C"
```

Log historis bisa panjang, tetapi state akhir lebih sederhana:

```text
counter = 4
user:1:name = "C"
old:key does not exist
```

AOF rewrite membuat file AOF baru yang lebih compact berdasarkan state saat ini.

Mental model:

```text
AOF lama: banyak operasi historis
AOF rewrite: instruksi minimal untuk membangun state saat ini
```

---

## 13. Risiko AOF Rewrite

AOF rewrite juga memakai mekanisme background process/fork.

Risiko mirip RDB:

- copy-on-write memory overhead,
- disk I/O tinggi,
- CPU overhead,
- latency spike,
- file rewrite gagal jika disk penuh,
- recovery file terlalu besar jika rewrite tidak berjalan.

### 13.1 Disk Full Scenario

Skenario klasik:

```text
1. Redis AOF aktif.
2. AOF tumbuh besar.
3. Rewrite gagal karena disk hampir penuh.
4. AOF terus tumbuh.
5. Disk penuh.
6. Redis tidak bisa append AOF dengan benar.
7. Write path terganggu.
```

Untuk Redis durable, disk monitoring sama pentingnya dengan memory monitoring.

---

## 14. RDB + AOF Bersamaan

Redis bisa memakai RDB dan AOF bersama.

Saat restart, jika AOF aktif, Redis biasanya memakai AOF karena dianggap lebih complete.

Kombinasi ini sering dipakai karena:

- RDB bagus sebagai snapshot compact/backup,
- AOF bagus untuk data loss window yang lebih kecil,
- recovery bisa lebih fleksibel,
- operational safety meningkat.

Namun kombinasi ini juga menambah:

- disk usage,
- I/O workload,
- operational complexity,
- monitoring responsibility.

---

## 15. Persistence Configuration Decision Matrix

Gunakan matrix berikut.

| Use Case | Persistence Recommendation | Catatan |
|---|---|---|
| Pure cache | none atau RDB ringan | Hindari membawa stale cache kecuali berguna |
| Session store | AOF everysec atau RDB+AOF | Tergantung toleransi logout massal |
| Rate limiter | none/RDB/AOF tergantung compliance | Biasanya losing counters acceptable, tetapi quota abuse perlu dipikirkan |
| Idempotency key | AOF everysec + downstream idempotency | Redis saja tidak cukup untuk irreversible operation |
| Distributed lock | persistence biasanya tidak menyelesaikan problem lock | Lock harus lease-based, bukan durable ownership |
| Delay queue | AOF everysec minimal | Tetap butuh reconciliation |
| Redis Streams job queue | AOF everysec/RDB+AOF | Pending entries perlu recovery plan |
| Leaderboard | RDB/AOF tergantung rebuildability | Jika bisa rebuild dari event log, Redis derived state |
| Regulatory audit | Redis bukan primary audit store | Gunakan durable DB/log sebagai source of truth |

---

## 16. Redis sebagai Cache: Haruskah Persistence Dimatikan?

Untuk pure cache, persistence sering bisa dimatikan.

Alasan:

1. cache bisa diisi ulang,
2. stale cache setelah restart bisa menyesatkan,
3. disk I/O tidak perlu,
4. restart lebih sederhana,
5. operational model lebih jujur.

Namun ada trade-off:

Jika Redis restart kosong, semua traffic bisa langsung menekan database.

Maka walaupun persistence dimatikan, Anda perlu:

- cache warmup strategy,
- request coalescing,
- TTL jitter,
- rate limit terhadap cache refill,
- database protection,
- fallback behavior.

### 16.1 Cache Restart Storm

Skenario:

```text
1. Redis cache restart kosong.
2. Semua service mengalami cache miss.
3. Semua instance query database.
4. Database overloaded.
5. Latency naik.
6. Service timeout.
7. Retry storm.
8. Incident membesar.
```

Persistence bukan satu-satunya solusi, tetapi bisa membantu mengurangi cold-start pressure.

Namun jika cache state terlalu stale, persistence juga bisa membawa data yang salah.

---

## 17. Redis sebagai Idempotency Store: Persistence Tidak Cukup

Misalkan API pembayaran memakai idempotency key:

```text
POST /payments
Idempotency-Key: abc
```

Redis menyimpan:

```text
idemp:payments:abc -> COMPLETED, paymentId=123
```

Jika Redis crash dan kehilangan key tersebut, retry request bisa memproses pembayaran ulang.

AOF everysec mengurangi risiko, tetapi tidak menghilangkan semua failure mode:

- write acknowledged belum fsync,
- replica lag,
- failover kehilangan write,
- host loss,
- TTL expiry terlalu cepat,
- key evicted karena memory pressure,
- operator restore file lama.

Maka desain yang benar:

```text
Redis boleh mempercepat idempotency path,
tetapi irreversible effect tetap harus dilindungi oleh durable source of truth.
```

Misalnya:

- database unique constraint pada idempotency key,
- payment provider idempotency,
- transaction log,
- reconciliation job,
- outbox/inbox pattern,
- event log authoritative.

---

## 18. Redis Streams dan Persistence

Redis Streams sering terlihat seperti event log.

Namun jika dipakai untuk job/event processing penting, persistence harus dipikirkan.

Data penting pada Streams:

1. stream entries,
2. consumer group metadata,
3. pending entries list,
4. last delivered ID,
5. acknowledged/not acknowledged state.

Jika persistence kehilangan beberapa detik data:

- event yang sudah `XADD` bisa hilang,
- consumer bisa kehilangan pending state,
- job bisa hilang atau diproses ulang tergantung timing,
- downstream state bisa tidak sinkron.

Untuk non-critical async task, ini mungkin diterima.

Untuk audit/event history, Redis Streams bukan pengganti Kafka/event store/durable DB.

---

## 19. Write Acknowledgement Timeline

Pahami timeline berikut untuk AOF everysec:

```text
T0: client mengirim SET order:123 PROCESSING
T1: Redis apply ke memory
T2: Redis append ke AOF buffer / OS buffer
T3: Redis reply OK ke client
T4: fsync periodik terjadi
T5: data benar-benar durable di disk
```

Jika crash terjadi antara T3 dan T4, client sudah melihat sukses, tetapi data bisa hilang.

Inilah sumber banyak kesalahpahaman.

### 19.1 Invariant

```text
Jika business correctness membutuhkan acknowledged write tidak boleh hilang,
Redis AOF everysec saja tidak cukup.
```

---

## 20. WAIT Command dan Replication Acknowledgement

Redis punya command seperti `WAIT` untuk menunggu write direplikasi ke sejumlah replica.

Mental model:

```text
Write ke primary
   ↓
WAIT N timeout
   ↓
Primary menunggu N replica mengakui write
```

Namun ini bukan pengganti disk durability.

`WAIT` membantu mengurangi risiko kehilangan write saat primary failover, tetapi:

- replica acknowledgement bukan selalu fsync durable,
- replica juga bisa crash,
- timeout bisa terjadi,
- client harus memutuskan apa yang dilakukan jika replica ack kurang,
- latency bertambah.

Gunakan `WAIT` jika memang Anda butuh stronger replication acknowledgment, tetapi tetap pahami batasnya.

---

## 21. Durability vs Availability vs Latency

Persistence selalu trade-off.

```text
Lebih durable biasanya berarti:
- lebih banyak disk I/O,
- potensi latency lebih tinggi,
- operasional lebih kompleks.
```

Redis dipilih karena cepat. Jika Anda memaksa Redis menjadi durable database tanpa menerima cost-nya, desain akan rapuh.

Trade-off umum:

| Prioritas | Pilihan Umum | Konsekuensi |
|---|---|---|
| Latency maksimal | no persistence | data hilang saat restart |
| Backup periodik | RDB | kehilangan data sejak snapshot terakhir |
| Durability seimbang | AOF everysec | kemungkinan kehilangan ±1 detik pada crash tertentu |
| Durability lebih kuat | AOF always | latency dan throughput terdampak besar |
| Operational safety | RDB + AOF + replica + backup | kompleksitas meningkat |

---

## 22. Recovery: Apa yang Terjadi Saat Redis Restart

Saat Redis restart, ia akan mencoba load persistence file.

Secara konseptual:

```text
1. Redis process start.
2. Redis membaca file persistence.
3. Dataset memory dibangun ulang.
4. Redis mulai menerima client connection.
```

Recovery time tergantung:

- ukuran dataset,
- ukuran AOF,
- disk throughput,
- CPU,
- encoding data,
- rewrite freshness,
- jumlah keys,
- memory allocation speed.

### 22.1 RTO Redis Tidak Sama dengan Process Restart Time

RTO nyata adalah:

```text
process start time
+ persistence load time
+ replication re-sync time
+ client reconnect time
+ cache warmup time
+ application stabilization time
```

Jika Redis butuh 8 menit load dataset dan aplikasi timeout selama 8 menit, maka Redis “start” bukan berarti layanan pulih.

---

## 23. Corrupted AOF/RDB

Persistence file bisa corrupt karena:

- crash saat write,
- disk error,
- filesystem issue,
- manual copy tidak konsisten,
- storage bug,
- operator mistake.

Redis menyediakan tooling seperti check/repair untuk file persistence, tetapi repair bisa berarti membuang bagian akhir file.

Dalam desain serius, jangan mengandalkan repair sebagai strategi utama.

Anda butuh:

- backup valid,
- replica,
- restore test,
- checksums/verification,
- monitoring persistence errors,
- runbook.

---

## 24. Backup Strategy

Persistence bukan backup.

Persistence file di mesin yang sama tidak cukup jika:

- disk rusak,
- host hilang,
- operator menjalankan `FLUSHALL`,
- data corrupt lalu corrupt state ikut persisted,
- ransomware/accidental deletion,
- region outage.

Backup berarti:

```text
Salinan data yang dapat dipakai untuk restore,
disimpan di tempat berbeda,
dengan retention policy,
dan pernah diuji.
```

### 24.1 Backup Minimal

Untuk Redis durable-ish:

1. periodic RDB snapshot,
2. copy ke object storage/external volume,
3. retention harian/mingguan,
4. restore drill,
5. checksum/size validation,
6. documented recovery procedure.

### 24.2 Backup Consistency

Copy file RDB yang sudah selesai ditulis relatif aman.

Jangan copy file temporary atau file yang sedang ditulis tanpa memahami mekanismenya.

Untuk AOF, perhatikan multi-part AOF manifest pada Redis modern.

---

## 25. Restore Strategy

Restore bukan hanya meletakkan file ke direktori Redis.

Pertanyaan restore:

1. Restore ke Redis kosong atau existing?
2. Apakah client boleh connect saat restore?
3. Apakah data lama harus dihapus?
4. Apakah key TTL masih valid?
5. Apakah data restored lebih tua dari database authoritative?
6. Apakah stream/job state boleh mundur?
7. Apakah idempotency key lama boleh muncul kembali?
8. Apakah key schema masih kompatibel dengan versi aplikasi baru?

### 25.1 TTL dan Restore

TTL bisa menjadi jebakan.

Jika snapshot lama di-restore, key yang pada real time seharusnya sudah expired bisa muncul kembali, tergantung bagaimana expiration metadata dan waktu diperlakukan.

Untuk data seperti session/token/idempotency, restore bisa menghidupkan state lama.

Maka restore Redis harus punya business-level validation.

---

## 26. Persistence dan Eviction: Kombinasi Berbahaya Jika Tidak Dipahami

Jika Redis memakai `maxmemory` dan eviction policy, key bisa hilang karena memory pressure.

Persistence akan menyimpan state setelah eviction.

Artinya:

```text
AOF/RDB tidak menjamin key tidak hilang.
Jika Redis mengevict key, kehilangan itu adalah state resmi Redis.
```

Untuk data penting, hindari eviction policy yang bisa menghapus key penting.

Gunakan:

- instance Redis terpisah untuk cache dan durable operational state,
- `noeviction` untuk state penting,
- memory alert yang ketat,
- key TTL disiplin,
- capacity planning.

### 26.1 Jangan Campur Cache dan Critical State Tanpa Boundary

Anti-pattern:

```text
Satu Redis cluster dipakai untuk:
- cache product,
- session,
- idempotency payment,
- rate limiter,
- locks,
- stream jobs.

maxmemory-policy = allkeys-lru
```

Ketika memory penuh, Redis bisa menghapus key idempotency/session/stream-related auxiliary key karena dianggap semua key boleh dievict.

Ini bukan bug Redis. Ini desain boundary yang salah.

---

## 27. Persistence dan Replication

Replication dan persistence adalah dua hal berbeda.

Replication menjawab:

```text
Apakah data disalin ke node lain?
```

Persistence menjawab:

```text
Apakah data bisa bertahan setelah restart/crash?
```

Anda bisa punya:

| Replication | Persistence | Konsekuensi |
|---|---|---|
| Tidak | Tidak | Redis mati, data hilang |
| Ya | Tidak | Failover bisa membantu, tetapi restart semua node hilang |
| Tidak | Ya | Restart node bisa recover, tetapi host loss fatal tanpa backup |
| Ya | Ya | Lebih aman, tetap perlu pahami lag/failover/backup |

Replica async bisa tertinggal.

Jika primary crash sebelum write direplikasi, replica tidak punya write tersebut.

Jika write direplikasi tetapi belum persisted, crash seluruh nodes tetap bisa kehilangan data.

---

## 28. Persistence dan Managed Redis

Managed Redis seperti cloud cache service sering menyediakan:

- snapshot otomatis,
- backup retention,
- replica,
- multi-AZ failover,
- maintenance window,
- parameter group,
- monitoring metrics.

Namun managed service tidak menghapus kebutuhan desain.

Anda tetap harus tahu:

1. apakah AOF didukung,
2. snapshot frequency,
3. backup retention,
4. restore behavior,
5. failover semantics,
6. data loss window,
7. cross-region DR,
8. maintenance impact,
9. eviction policy,
10. maximum memory behavior.

Cloud provider bisa mengelola mesin, tetapi tidak bisa menentukan business correctness Anda.

---

## 29. Java Application Impact

Persistence Redis mempengaruhi Java service dalam beberapa cara.

### 29.1 Timeout Saat Persistence Event

RDB/AOF rewrite dapat memicu latency spike.

Java client harus punya:

- command timeout realistis,
- retry policy hati-hati,
- circuit breaker,
- fallback path,
- metrics per command,
- separation untuk blocking/non-blocking command.

### 29.2 Retry Bisa Membuat Data Ganda

Jika Java client timeout setelah Redis sebenarnya sukses menulis, retry bisa mengirim command lagi.

Untuk command idempotent seperti `SET key value`, ini mungkin aman.

Untuk `INCR`, `LPUSH`, `XADD`, `ZADD` dengan unique member mungkin berbeda.

Contoh:

```java
redis.incr("quota:user:123");
```

Jika timeout terjadi setelah Redis sudah menjalankan `INCR`, retry akan menaikkan counter dua kali.

Maka untuk operation non-idempotent:

- desain idempotency token,
- gunakan Lua dengan request ID,
- simpan operation ID,
- atau buat reconciliation.

### 29.3 Startup Dependency

Jika aplikasi Java bergantung pada Redis saat startup, Redis recovery yang lama bisa membuat deployment gagal.

Desain:

- lazy connection jika memungkinkan,
- readiness probe yang realistis,
- degraded mode,
- bounded retry,
- clear startup failure semantics.

---

## 30. Command Semantics dan Persistence Risk

Tidak semua command punya risiko yang sama saat retry/recovery.

| Command Pattern | Retry Risk | Catatan |
|---|---|---|
| `SET key value` | rendah | overwrite idempotent jika value sama |
| `SET key value NX` | sedang | retry setelah timeout bisa melihat key sudah ada |
| `INCR` | tinggi | retry bisa double count |
| `LPUSH` | tinggi | retry bisa duplicate item |
| `XADD *` | tinggi | retry membuat entry baru |
| `ZADD member fixed` | rendah-sedang | idempotent jika member fixed |
| `ZINCRBY` | tinggi | retry double increment |
| Lua with op id | rendah jika benar | script harus idempotent |

Dalam sistem Java, Redis timeout handling harus aware terhadap command semantics.

---

## 31. Designing for Recovery: Reconciliation First

Untuk data Redis yang penting, selalu tanya:

```text
Jika Redis kehilangan 1 detik data, bagaimana sistem tahu dan memperbaiki?
```

Contoh reconciliation:

### 31.1 Idempotency

Authoritative DB punya tabel:

```sql
payment_requests(idempotency_key, payment_id, status, created_at)
```

Redis hanya cache cepat.

Jika Redis kehilangan key, service query DB sebelum memproses ulang.

### 31.2 Delay Queue

Authoritative DB punya scheduled task table.

Redis Sorted Set hanya acceleration index.

Jika Redis hilang, rebuild dari DB:

```text
SELECT task_id, due_at FROM scheduled_tasks WHERE status='PENDING'
```

### 31.3 Leaderboard

Event log menyimpan score events.

Redis Sorted Set adalah materialized view.

Jika Redis corrupt/hilang, replay event log.

### 31.4 Rate Limiter

Jika limiter hilang, mungkin acceptable.

Jika quota enforcement legally relevant, simpan usage record durable di DB/log, Redis hanya fast path.

---

## 32. Persistence Monitoring

Monitor minimal:

### 32.1 RDB Metrics

- last save time,
- last save status,
- changes since last save,
- duration of last save,
- fork time,
- copy-on-write memory usage.

### 32.2 AOF Metrics

- AOF enabled,
- last write status,
- last fsync status,
- fsync delayed,
- AOF current size,
- AOF base size,
- rewrite in progress,
- last rewrite status,
- rewrite duration.

### 32.3 Disk Metrics

- disk usage,
- disk latency,
- IOPS,
- throughput,
- filesystem errors,
- inode availability.

### 32.4 Memory Metrics

- used memory,
- memory fragmentation ratio,
- maxmemory,
- evicted keys,
- rejected connections,
- client output buffer.

### 32.5 Application Metrics

- Redis command latency,
- Redis timeout count,
- retry count,
- fallback count,
- cache miss storm,
- idempotency fallback DB lookup,
- duplicate suppression count.

---

## 33. Alerting Rules

Contoh alert penting:

```text
RDB last save failed
AOF last write status failed
AOF fsync delayed increasing
AOF rewrite failed
Disk usage > 80%
Disk usage > 90%
Memory usage > 80% maxmemory
Evicted keys > 0 on non-cache Redis
Fork time p99 high
Redis loading for too long
Replication lag high
Redis command timeout spike
```

Untuk Redis yang menyimpan critical operational state:

```text
Evicted keys > 0 harus dianggap incident.
```

---

## 34. Persistence Runbook

Runbook minimal untuk Redis persistence:

### 34.1 Jika RDB Save Gagal

1. Cek disk space.
2. Cek permission direktori.
3. Cek memory headroom.
4. Cek fork failure.
5. Cek logs.
6. Cek last successful save.
7. Tentukan risk window.
8. Jika perlu, scale memory/disk.
9. Jalankan manual save hanya jika aman.

### 34.2 Jika AOF Rewrite Gagal

1. Cek disk space.
2. Cek AOF size.
3. Cek memory/copy-on-write overhead.
4. Cek rewrite in progress.
5. Cek latency impact.
6. Tambah disk atau hapus data tidak penting dengan prosedur aman.
7. Trigger rewrite ulang saat aman.

### 34.3 Jika Redis Restart dan Loading Lama

1. Jangan restart-loop tanpa analisis.
2. Cek file size RDB/AOF.
3. Cek CPU/disk throughput.
4. Cek logs progress loading.
5. Redirect traffic jika ada replica/cluster.
6. Komunikasikan degraded mode.
7. Setelah pulih, evaluasi dataset size dan persistence strategy.

### 34.4 Jika Persistence File Corrupt

1. Stop writes jika memungkinkan.
2. Copy file corrupt untuk forensic.
3. Coba check tool di copy, bukan file utama.
4. Evaluasi repair impact.
5. Restore dari backup jika lebih aman.
6. Jalankan reconciliation setelah restore.
7. Dokumentasikan data loss window.

---

## 35. Lab: Redis Persistence dengan Docker

### 35.1 Struktur Direktori

```bash
mkdir -p redis-persistence-lab/data
cd redis-persistence-lab
```

### 35.2 Redis dengan RDB

Buat `redis-rdb.conf`:

```conf
port 6379
dir /data
dbfilename dump.rdb
save 60 1
appendonly no
loglevel notice
```

Jalankan:

```bash
docker run --rm \
  --name redis-rdb-lab \
  -p 6379:6379 \
  -v "$PWD/redis-rdb.conf:/usr/local/etc/redis/redis.conf" \
  -v "$PWD/data:/data" \
  redis:8 \
  redis-server /usr/local/etc/redis/redis.conf
```

Di terminal lain:

```bash
redis-cli SET lab:rdb:1 "hello"
redis-cli SAVE
ls -lh data
```

Stop container, lalu start lagi. Cek:

```bash
redis-cli GET lab:rdb:1
```

### 35.3 Redis dengan AOF

Buat `redis-aof.conf`:

```conf
port 6379
dir /data
appendonly yes
appendfsync everysec
save ""
loglevel notice
```

Jalankan:

```bash
rm -rf data/*

docker run --rm \
  --name redis-aof-lab \
  -p 6379:6379 \
  -v "$PWD/redis-aof.conf:/usr/local/etc/redis/redis.conf" \
  -v "$PWD/data:/data" \
  redis:8 \
  redis-server /usr/local/etc/redis/redis.conf
```

Isi data:

```bash
redis-cli SET lab:aof:1 "hello-aof"
redis-cli INCR lab:aof:counter
redis-cli INCR lab:aof:counter
```

Lihat file:

```bash
find data -type f -maxdepth 3 -print -exec ls -lh {} \;
```

Restart container dan cek:

```bash
redis-cli GET lab:aof:1
redis-cli GET lab:aof:counter
```

### 35.4 Trigger AOF Rewrite

```bash
redis-cli BGREWRITEAOF
redis-cli INFO persistence
```

Amati:

```text
aof_rewrite_in_progress
aof_last_bgrewrite_status
aof_current_size
aof_base_size
```

---

## 36. Java Lab: Timeout dan Non-Idempotent Retry

Contoh konseptual dengan Lettuce synchronous API:

```java
public final class RedisCounterService {
    private final RedisCommands<String, String> redis;

    public RedisCounterService(RedisCommands<String, String> redis) {
        this.redis = redis;
    }

    public long incrementQuota(String userId) {
        String key = "quota:user:" + userId;
        return redis.incr(key);
    }
}
```

Masalah:

```text
Jika redis.incr() sukses di Redis tetapi client timeout sebelum menerima response,
aplikasi mungkin retry dan counter naik dua kali.
```

Desain lebih aman butuh operation ID.

Contoh Lua konseptual:

```lua
-- KEYS[1] = counter key
-- KEYS[2] = operation id key
-- ARGV[1] = operation id ttl seconds

if redis.call('EXISTS', KEYS[2]) == 1 then
  return redis.call('GET', KEYS[1])
end

local value = redis.call('INCR', KEYS[1])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
return value
```

Java side harus membuat operation ID stabil per request, bukan per retry.

```java
String opId = request.getIdempotencyKey();
String counterKey = "quota:user:" + userId;
String opKey = "quota-op:" + opId;
```

Ini belum menyelesaikan semua problem, tetapi mengurangi double increment akibat retry.

---

## 37. Architecture Pattern: Redis as Durable-ish Working State

Untuk banyak sistem Java, Redis paling aman ditempatkan sebagai:

```text
Durable-ish working state, bukan final truth.
```

Artinya:

- Redis mempercepat keputusan runtime,
- Redis menyimpan state aktif jangka pendek,
- Redis bisa recover dari persistence,
- tetapi authoritative truth tetap ada di DB/event log.

Contoh:

```text
PostgreSQL:
  authoritative enforcement case state

Kafka/Event Log:
  immutable state transition history

Redis:
  active workflow locks
  idempotency cache
  rate limit counters
  pending task index
  hot read cache
```

Redis penting, tetapi bukan satu-satunya sumber kebenaran.

---

## 38. Design Review Checklist

Sebelum mengaktifkan persistence Redis, jawab:

### 38.1 Data Classification

- Data apa yang disimpan?
- Apakah data derived atau authoritative?
- Berapa TTL-nya?
- Apakah boleh dievict?
- Apakah boleh hilang saat restart?

### 38.2 Durability

- Kehilangan data maksimum yang bisa diterima berapa detik/menit?
- Failure mana yang harus ditoleransi?
- Apakah AOF everysec cukup?
- Apakah perlu RDB + AOF?
- Apakah perlu replica/WAIT?

### 38.3 Recovery

- Bagaimana restore dilakukan?
- Berapa RTO?
- Berapa RPO?
- Apakah recovery pernah diuji?
- Apakah ada reconciliation?

### 38.4 Operations

- Apakah disk cukup?
- Apakah memory cukup untuk copy-on-write?
- Apakah alert persistence aktif?
- Apakah backup disimpan di luar host?
- Apakah runbook tersedia?

### 38.5 Application Semantics

- Command apa yang non-idempotent?
- Apa yang terjadi jika timeout lalu retry?
- Apakah startup bergantung pada Redis?
- Apakah fallback aman?
- Apakah Redis down membuat data corrupt atau hanya degraded?

---

## 39. Common Anti-Patterns

### 39.1 “Redis Ada AOF, Berarti Aman Jadi Database”

Salah.

AOF meningkatkan durability, tetapi tidak otomatis memberikan:

- relational constraints,
- transaction isolation kompleks,
- audit trail governance,
- schema migration model,
- query correctness,
- backup semantics yang cukup,
- human review workflow,
- legal defensibility.

### 39.2 Cache dan Critical State Dicampur dengan `allkeys-lru`

Berbahaya.

Redis bisa menghapus key penting.

Pisahkan Redis cache dan Redis operational state.

### 39.3 Tidak Pernah Restore Test

Backup tanpa restore test hanyalah harapan.

### 39.4 Mengabaikan Disk Karena Redis “In-Memory”

Jika persistence aktif, disk adalah bagian dari write path durability.

Disk lambat atau penuh bisa menjadi incident utama.

### 39.5 Retry Semua Redis Command Secara Blind

Retry `GET` aman.

Retry `INCR`, `LPUSH`, `XADD`, `ZINCRBY` bisa menggandakan efek.

### 39.6 AOF Rewrite Tidak Dimonitor

AOF bisa tumbuh sampai disk penuh.

### 39.7 Restore Snapshot Lama Tanpa Business Validation

Restore bisa menghidupkan token/session/idempotency state lama.

---

## 40. Practical Recommendations

### 40.1 Untuk Pure Cache

Gunakan:

```conf
appendonly no
save ""
```

atau RDB ringan jika cold start mahal.

Pastikan:

- TTL semua cache jelas,
- cache warmup aman,
- DB terlindungi dari miss storm.

### 40.2 Untuk Session Store

Gunakan:

```conf
appendonly yes
appendfsync everysec
```

Pertimbangkan RDB backup.

Pastikan:

- session TTL eksplisit,
- logout/revocation semantics jelas,
- kehilangan session bisa diterima atau tidak.

### 40.3 Untuk Idempotency

Gunakan Redis sebagai fast path:

```conf
appendonly yes
appendfsync everysec
```

Tetapi authoritative dedup tetap di durable store untuk irreversible operation.

### 40.4 Untuk Redis Streams Jobs

Gunakan:

```conf
appendonly yes
appendfsync everysec
```

Tambahkan:

- idempotent consumer,
- dead-letter strategy,
- pending recovery,
- reconciliation dari authoritative source jika job penting.

### 40.5 Untuk Regulatory/Enforcement Systems

Gunakan Redis untuk:

- cache,
- rate limiter,
- transient state,
- workflow acceleration,
- lock/lease dengan fencing,
- materialized read state.

Jangan gunakan Redis sebagai satu-satunya:

- audit log,
- case state truth,
- legal decision history,
- enforcement lifecycle state,
- evidence store.

---

## 41. Final Mental Model

Redis persistence bukan tombol “make durable”.

Redis persistence adalah konfigurasi trade-off antara:

```text
memory state
write latency
disk I/O
crash recovery
data loss window
operational complexity
business correctness
```

RDB menjawab:

```text
Bisakah saya kembali ke snapshot terakhir?
```

AOF menjawab:

```text
Bisakah saya replay operasi tulis dengan kehilangan lebih kecil?
```

Backup menjawab:

```text
Bisakah saya pulih jika host/file rusak atau operator salah?
```

Reconciliation menjawab:

```text
Bisakah sistem bisnis kembali benar setelah Redis kehilangan/duplikasi state?
```

Untuk engineer senior, pertanyaan terpenting bukan:

```text
Apakah Redis persistence aktif?
```

Tetapi:

```text
Apa kontrak kehilangan data Redis, bagaimana sistem mendeteksinya, dan bagaimana sistem pulih?
```

---

## 42. Ringkasan

Pada bagian ini kita mempelajari:

1. Redis adalah memory-first system.
2. Persistence Redis terdiri dari RDB, AOF, atau kombinasi keduanya.
3. RDB adalah snapshot point-in-time.
4. AOF adalah append log untuk replay operasi.
5. `appendfsync` menentukan trade-off durability vs latency.
6. AOF everysec bukan jaminan zero data loss.
7. Persistence berbeda dari replication dan backup.
8. Fork/copy-on-write bisa menyebabkan memory spike.
9. AOF rewrite dan RDB save harus dimonitor.
10. Redis persistent masih bisa kehilangan key karena eviction jika policy salah.
11. Java retry terhadap Redis command non-idempotent bisa menggandakan efek.
12. Redis sebaiknya dipakai sebagai durable-ish working state, bukan sembarang source of truth.
13. Untuk sistem regulatori, Redis tidak boleh menjadi satu-satunya audit/legal truth store.
14. Recovery dan reconciliation adalah bagian dari desain, bukan afterthought.

---

## 43. Checklist Cepat

Sebelum memakai Redis persistence di production:

```text
[ ] Data Redis sudah diklasifikasikan: cache / derived / operational / authoritative
[ ] RPO dan RTO sudah ditentukan
[ ] RDB/AOF dipilih berdasarkan toleransi kehilangan data
[ ] Disk usage dimonitor
[ ] AOF rewrite dimonitor
[ ] RDB save status dimonitor
[ ] Memory headroom untuk copy-on-write tersedia
[ ] Eviction policy sesuai jenis data
[ ] Backup keluar host tersedia
[ ] Restore pernah diuji
[ ] Java retry policy command-aware
[ ] Non-idempotent command dilindungi operation ID jika perlu
[ ] Reconciliation tersedia untuk state penting
[ ] Runbook persistence incident tersedia
```

---

## 44. Preview Part Berikutnya

Part berikutnya:

```text
learn-redis-mastery-for-java-engineers-part-021.md
```

Judul:

```text
Replication, Sentinel, Failover: Availability dengan Trade-Off
```

Kita akan membahas:

- primary-replica model,
- async replication,
- replication lag,
- read from replica,
- Sentinel,
- failover,
- split brain risk,
- client reconnect behavior,
- dan bagaimana Java service harus menghadapi failover Redis tanpa mengira Redis memberikan consistency magic.

---

## 45. Status Seri

```text
Part 020 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-021.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Geospatial, JSON, Search, dan Vector Set</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-021.md">Part 021 — Replication, Sentinel, Failover: Availability dengan Trade-Off ➡️</a>
</div>
