# learn-postgresql-mastery-for-java-engineers-part-027.md

# Part 027 — Replication: Streaming, Logical, Slots, Lag, dan Failover Semantics

## Status Seri

Kamu sedang berada di:

```text
Part 027 dari 034
```

Seri belum selesai. Setelah bagian ini masih ada:

```text
Part 028 — High Availability Architecture: Patroni, pgBackRest, HAProxy, Cloud-managed PostgreSQL
Part 029 — Security: Roles, Privileges, RLS, TLS, Secrets, dan Auditability
Part 030 — Migration dan Zero-downtime Schema Change
Part 031 — PostgreSQL dengan Java: JDBC, HikariCP, Hibernate, jOOQ, Spring Data
Part 032 — Workload-specific Design: OLTP, Workflow Engine, Event Log, Audit, Reporting, Multi-tenant
Part 033 — Performance Engineering Methodology: Benchmark, Diagnose, Tune, Verify
Part 034 — PostgreSQL Production Playbook: Failure Modelling, Runbook, Upgrade, dan Mastery Checklist
```

---

# 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas backup, restore, PITR, dan disaster recovery. Itu menjawab pertanyaan:

```text
Jika data hilang/rusak, bagaimana kita kembali ke kondisi yang benar?
```

Replication menjawab pertanyaan yang berbeda:

```text
Bagaimana perubahan dari satu PostgreSQL server disalin ke server lain agar sistem punya availability, durability tambahan, read scaling, migration path, atau downstream data flow?
```

Tapi replication sering disalahpahami. Banyak engineer berpikir:

```text
Primary punya replica.
Berarti data aman.
Berarti read bisa diarahkan ke replica.
Berarti failover tinggal promote.
```

Itu terlalu sederhana dan berbahaya.

Replication bukan magic consistency layer. Replication adalah mekanisme pemindahan perubahan. Ia punya delay, slot, backlog, conflict, WAL retention, topology, timeline, failover semantics, dan efek langsung ke aplikasi Java.

Setelah bagian ini, kamu harus mampu menjawab:

1. Apa bedanya physical streaming replication dan logical replication?
2. Kenapa read replica bisa mengembalikan data lama?
3. Apa arti replication lag secara byte, waktu, dan apply position?
4. Kenapa replication slot bisa membuat disk primary penuh?
5. Kenapa failover bukan sekadar “promote standby”?
6. Apa itu timeline PostgreSQL?
7. Kenapa synchronous replication menukar latency untuk durability/availability semantics?
8. Kenapa aplikasi Java harus sadar topology change?
9. Bagaimana mendesain read-after-write consistency saat memakai replica?
10. Kapan logical replication cocok untuk migration, CDC, atau integration?

---

# 2. Mental Model Utama: Replication adalah Pemindahan Urutan Perubahan

Database bukan hanya kumpulan row. Database adalah state yang berubah seiring waktu.

PostgreSQL primary menerima transaksi:

```text
T1 -> T2 -> T3 -> T4 -> T5 -> ...
```

Setiap transaksi menghasilkan perubahan yang dicatat di WAL:

```text
WAL stream:
LSN A -> LSN B -> LSN C -> LSN D -> ...
```

Replica mencoba mengejar stream itu.

```text
Primary:  A ---- B ---- C ---- D ---- E ---- F
Replica:  A ---- B ---- C
                         ^ lag
```

Replication adalah proses membuat server lain mencapai state yang berasal dari urutan perubahan yang sama.

Yang penting:

```text
Replica tidak otomatis identik pada setiap waktu.
Replica identik hanya setelah semua perubahan relevan diterima dan diterapkan.
```

Karena itu, setiap desain dengan replication harus menjawab:

```text
Berapa jauh replica boleh tertinggal?
Apa yang terjadi jika replica tertinggal?
Apa yang terjadi jika primary mati sebelum replica menerima commit?
Apa yang terjadi jika aplikasi membaca dari replica setelah menulis ke primary?
Apa yang terjadi jika slot membuat WAL tertahan?
Apa yang terjadi setelah failover?
```

---

# 3. Jenis Replication di PostgreSQL

Secara besar, PostgreSQL punya dua keluarga replication penting:

```text
PostgreSQL Replication
├── Physical replication
│   ├── WAL shipping
│   ├── streaming replication
│   ├── hot standby
│   └── cascading replication
│
└── Logical replication
    ├── logical decoding
    ├── publication/subscription
    ├── replication slot
    └── row-level logical change stream
```

## 3.1 Physical Replication

Physical replication menyalin perubahan di level fisik/WAL.

Karakteristik:

```text
- Menyalin byte-level perubahan storage PostgreSQL.
- Replica mereplay WAL dari primary.
- Replica biasanya seluruh cluster/database state, bukan subset tabel tertentu.
- Cocok untuk HA, read replica, disaster recovery.
- Biasanya butuh major version compatibility yang ketat.
- Standby fisik tidak menerima write biasa.
```

Dalam streaming replication:

```text
Primary menghasilkan WAL
    ↓
WAL sender mengirim WAL
    ↓
Standby WAL receiver menerima WAL
    ↓
Standby menulis WAL
    ↓
Startup/recovery process mereplay WAL
    ↓
Replica state bergerak mendekati primary
```

## 3.2 Logical Replication

Logical replication menyalin perubahan di level logis:

```text
table X: INSERT row
 table Y: UPDATE row
 table Z: DELETE row
```

Karakteristik:

```text
- Berbasis logical decoding dari WAL.
- Bisa replicate subset tabel.
- Bisa replicate antar major version tertentu.
- Cocok untuk migration, CDC, integration, selective replication.
- Subscriber dapat menjadi database writable untuk objek lain.
- Tidak otomatis menyalin semua DDL.
- Membutuhkan primary key/replica identity untuk update/delete yang baik.
```

Physical replication memindahkan “storage changes”.

Logical replication memindahkan “data changes”.

---

# 4. Physical Streaming Replication

## 4.1 Komponen Utama

Physical streaming replication melibatkan:

```text
Primary
├── backend processes menghasilkan WAL
├── WAL writer menulis WAL
├── WAL sender process mengirim WAL ke standby
│
Standby
├── WAL receiver process menerima WAL
├── startup/recovery process menerapkan WAL
└── optional read-only queries jika hot standby aktif
```

Diagram sederhana:

```text
Client writes
    ↓
Primary PostgreSQL
    ↓ WAL records
WAL sender
    ↓ network
WAL receiver
    ↓
Standby WAL
    ↓ replay
Standby data files
```

## 4.2 WAL sebagai Replication Stream

Semua physical replication bergantung pada WAL.

Setiap perubahan penting dicatat sebagai WAL record.

WAL punya posisi bernama LSN:

```text
Log Sequence Number
```

Contoh bentuk LSN:

```text
0/16B6C50
```

LSN memungkinkan PostgreSQL dan operator menjawab:

```text
Primary sudah sampai LSN mana?
Replica sudah menerima sampai LSN mana?
Replica sudah menulis sampai LSN mana?
Replica sudah replay sampai LSN mana?
Berapa jaraknya?
```

## 4.3 Receiver, Write, Flush, Replay

Pada standby, ada beberapa tahap:

```text
received_lsn  : WAL sudah diterima dari primary
written_lsn   : WAL sudah ditulis ke disk standby
flushed_lsn   : WAL sudah di-flush ke disk standby
replayed_lsn  : WAL sudah diaplikasikan ke data files standby
```

Lag bisa muncul di beberapa titik:

```text
Network lag     : primary mengirim lambat / network lambat
Write lag       : standby lambat menulis WAL
Flush lag       : standby lambat fsync
Replay lag      : standby lambat menerapkan WAL
Query conflict  : replay tertahan oleh query read-only panjang
```

Ini penting karena kalimat “replica lag” tidak cukup presisi.

Pertanyaan yang benar:

```text
Lag di tahap mana?
Byte lag atau time lag?
Receive lag atau replay lag?
Lag karena network, IO, CPU, lock conflict, atau standby query?
```

---

# 5. Hot Standby dan Read Replica

Standby fisik bisa dikonfigurasi sebagai hot standby sehingga menerima query read-only.

Artinya:

```text
Aplikasi bisa membaca dari replica.
Replica tetap mereplay WAL.
Replica tidak menerima write biasa.
```

## 5.1 Keuntungan Read Replica

Read replica dapat membantu:

```text
- reporting query dipisah dari primary
- dashboard read-only
- analytics ringan
- backup dari standby
- failover candidate
- geographical read locality
```

## 5.2 Risiko Read Replica

Read replica bukan free scaling.

Risiko utamanya:

```text
- stale read
- query conflict dengan WAL replay
- replica lag karena query panjang
- aplikasi membaca data lama setelah menulis
- inconsistent reads antar request
- failover membuat routing berubah
```

## 5.3 Read-after-write Problem

Contoh:

```text
Request A:
1. User update status case ke APPROVED di primary.
2. Commit sukses.
3. UI reload membaca dari replica.
4. Replica belum replay commit.
5. UI masih melihat PENDING.
```

Dari sisi user:

```text
“Sistem tidak menyimpan perubahan.”
```

Dari sisi database:

```text
Sistem benar, tetapi read diarahkan ke replica yang belum catch up.
```

Ini problem desain aplikasi, bukan bug PostgreSQL.

Solusi umum:

```text
1. Read-your-writes dari primary untuk user/session tertentu.
2. Sticky primary read setelah write untuk beberapa detik.
3. LSN token: simpan commit LSN, baca replica hanya jika replay_lsn >= required_lsn.
4. Jangan arahkan critical workflow reads ke replica.
5. Gunakan replica hanya untuk eventual-consistency views.
```

---

# 6. Asynchronous vs Synchronous Replication

## 6.1 Asynchronous Replication

Default mental model:

```text
Primary commit tidak menunggu standby menerima WAL.
```

Flow:

```text
Client COMMIT
    ↓
Primary flush WAL lokal
    ↓
Commit sukses ke client
    ↓
WAL dikirim ke standby kemudian
```

Keuntungan:

```text
- latency commit rendah
- primary tidak tergantung kondisi standby
- lebih tahan terhadap standby lambat/down
```

Risiko:

```text
- jika primary mati sebelum WAL sampai standby, committed transaction bisa hilang setelah failover
- RPO tidak nol
- replica bisa tertinggal
```

## 6.2 Synchronous Replication

Synchronous replication membuat commit menunggu acknowledgement dari standby sesuai konfigurasi.

Mental model:

```text
Commit sukses hanya setelah standby tertentu mengonfirmasi level penerimaan tertentu.
```

Ada beberapa level penting:

```text
remote_write  : standby sudah menulis WAL ke OS/kernel buffer
remote_flush  : standby sudah flush WAL ke durable storage
remote_apply  : standby sudah replay/apply sehingga query di standby bisa melihat perubahan
```

Trade-off:

```text
Lebih kuat durability/read consistency semantics
    ditukar dengan
commit latency lebih tinggi dan availability risk jika standby tidak tersedia
```

## 6.3 Kapan Synchronous Replication Masuk Akal?

Cocok ketika:

```text
- kehilangan committed transaction tidak dapat diterima
- primary dan standby berada di network latency rendah
- sistem punya HA manager yang matang
- aplikasi siap dengan commit latency lebih tinggi
- operator paham failure mode synchronous standby down
```

Tidak cocok sebagai default untuk semua sistem karena:

```text
- commit latency ikut latency network/storage standby
- standby bermasalah bisa menahan transaksi primary
- salah konfigurasi bisa membuat outage
```

## 6.4 Synchronous Replication Bukan Distributed Consensus Penuh

Synchronous replication bukan berarti:

```text
- semua node bisa write
- split brain mustahil tanpa HA discipline
- failover selalu aman tanpa orchestration
- aplikasi tidak perlu retry
```

Synchronous replication memperbaiki sebagian durability semantics, tetapi HA tetap membutuhkan:

```text
- leader election
- fencing
- routing update
- promotion discipline
- timeline handling
- client retry behavior
```

---

# 7. Replication Slots

Replication slot adalah mekanisme PostgreSQL untuk mengingat posisi consumer replication.

Mental model:

```text
Slot = janji primary untuk tidak membuang WAL yang masih dibutuhkan consumer.
```

Tanpa slot:

```text
Replica tertinggal terlalu jauh
    ↓
Primary sudah menghapus WAL lama
    ↓
Replica tidak bisa catch up
    ↓
Perlu rebuild/reinitialize
```

Dengan slot:

```text
Replica tertinggal
    ↓
Primary tetap menyimpan WAL yang dibutuhkan slot
    ↓
Replica bisa catch up
```

Tapi ada bahaya besar:

```text
Jika consumer mati lama dan slot tetap aktif,
primary akan menahan WAL,
disk primary bisa penuh.
```

## 7.1 Physical Replication Slot

Physical slot biasa dipakai untuk standby fisik.

Tujuannya:

```text
- mencegah WAL yang dibutuhkan standby dibuang terlalu cepat
- membuat standby lebih aman saat lag sementara
```

Risikonya:

```text
- standby mati lama -> WAL menumpuk -> disk full primary
```

## 7.2 Logical Replication Slot

Logical slot menyimpan posisi logical decoding consumer.

Dipakai oleh:

```text
- logical replication subscription
- CDC connector
- Debezium-like pipeline
- custom logical decoding consumer
```

Risiko logical slot lebih sensitif karena selain WAL retention, logical decoding bisa menahan informasi yang mempengaruhi vacuum/catalog.

## 7.3 Monitoring Slot

Query penting:

```sql
SELECT
    slot_name,
    slot_type,
    active,
    restart_lsn,
    confirmed_flush_lsn,
    wal_status,
    safe_wal_size
FROM pg_replication_slots;
```

Yang harus dilihat:

```text
active              : apakah consumer sedang terhubung
restart_lsn         : WAL tertua yang masih dibutuhkan slot
confirmed_flush_lsn : posisi logical consumer yang sudah confirmed
wal_status          : status ketersediaan WAL untuk slot
safe_wal_size       : estimasi sisa aman sebelum slot bermasalah, jika tersedia
```

Operational invariant:

```text
Tidak boleh ada replication slot yatim piatu.
```

Slot yatim piatu adalah slot yang:

```text
- consumer-nya sudah tidak ada
- tidak aktif lama
- tetap menahan WAL
- tidak dimonitor
```

---

# 8. Replication Lag

Replication lag adalah jarak antara primary dan replica.

Namun ada beberapa bentuk lag.

## 8.1 Byte Lag

Byte lag mengukur jarak LSN.

Contoh query dari primary:

```sql
SELECT
    application_name,
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_byte_lag
FROM pg_stat_replication;
```

Byte lag berguna untuk menjawab:

```text
Berapa banyak WAL yang belum direplay standby?
```

## 8.2 Time Lag

Time lag menjawab:

```text
Seberapa tua data yang terlihat di standby?
```

Di standby:

```sql
SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay;
```

Hati-hati:

```text
Jika primary idle dan tidak ada transaksi baru, timestamp lag bisa tampak besar/aneh tergantung interpretasi.
```

Lag harus dibaca bersama workload.

## 8.3 Receive vs Replay Lag

Replica mungkin sudah menerima WAL tapi belum replay.

Penyebab replay lag:

```text
- standby query panjang
- IO lambat
- CPU lambat
- recovery conflict
- huge transaction
- vacuum cleanup conflict
```

Jika `receive_lsn` dekat primary tetapi `replay_lsn` jauh:

```text
network bukan masalah utama.
Masalahnya apply/replay di standby.
```

## 8.4 Huge Transaction Effect

Transaksi besar bisa membuat lag tampak “meledak”.

Contoh:

```text
BEGIN;
update 50 juta row;
COMMIT;
```

Efek:

```text
- WAL sangat besar
- standby harus mereplay banyak perubahan
- replica tertinggal
- logical replication bisa tertahan karena transaksi besar dikirim sebagai unit logis tertentu
```

Di aplikasi Java, ini sering berasal dari:

```text
- batch job tanpa chunking
- migration backfill terlalu besar
- delete massal
- update status massal
- import data besar
```

Solusi:

```text
- chunking
- commit periodik
- throttling
- partition detach/drop untuk retention
- staging table + controlled merge
```

---

# 9. Replication Conflicts pada Hot Standby

Standby fisik harus mereplay WAL agar tetap mengejar primary.

Namun standby juga bisa menjalankan query read-only.

Konflik muncul ketika:

```text
Query read-only di standby butuh snapshot lama
    tetapi
WAL replay perlu menghapus/merapikan row/page yang query itu masih butuh.
```

PostgreSQL harus memilih:

```text
- tunda WAL replay agar query selesai
- batalkan query agar replay lanjut
```

Parameter relevan:

```text
max_standby_streaming_delay
max_standby_archive_delay
hot_standby_feedback
```

## 9.1 `hot_standby_feedback`

`hot_standby_feedback` membuat standby memberi tahu primary tentang xmin yang masih dibutuhkan query standby.

Efek positif:

```text
- query di standby lebih jarang dibatalkan karena conflict
```

Efek negatif:

```text
- primary bisa menahan vacuum cleanup
- dead tuple/bloat di primary bisa meningkat
```

Trade-off:

```text
Lebih nyaman untuk query panjang di standby
    ditukar dengan
risiko bloat di primary
```

Ini bukan parameter yang boleh dinyalakan tanpa monitoring.

---

# 10. Failover Semantics

Failover berarti mengganti primary yang gagal dengan standby yang dipromote menjadi primary baru.

Proses konseptual:

```text
Primary lama gagal
    ↓
Pilih standby terbaik
    ↓
Promote standby menjadi primary
    ↓
Update routing aplikasi
    ↓
Aplikasi reconnect/retry
    ↓
Primary lama dicegah menerima write lagi
```

Bagian terakhir sangat penting:

```text
Primary lama harus difence.
```

Tanpa fencing, bisa terjadi split brain.

## 10.1 Split Brain

Split brain:

```text
Dua node sama-sama menerima write sebagai primary.
```

Akibat:

```text
- divergent history
- data conflict
- tidak bisa digabung otomatis secara aman
- audit trail rusak
- correctness sistem runtuh
```

Split brain adalah salah satu failure terburuk dalam database HA.

## 10.2 Promotion

Ketika standby dipromote:

```text
Standby berhenti recovery mode
Standby menjadi writable primary
Timeline baru dibuat
```

Setelah itu, primary lama tidak bisa begitu saja “join lagi” tanpa prosedur yang benar.

Biasanya perlu:

```text
- rewind dengan pg_rewind jika memungkinkan
- rebuild standby
- restore dari base backup
```

## 10.3 Timeline

Timeline PostgreSQL merepresentasikan cabang history WAL.

Mental model:

```text
Timeline 1:
A -> B -> C -> D
          
           failover
            
Timeline 2:
A -> B -> C -> E -> F
```

Setelah failover, history baru berjalan di timeline baru.

Jika primary lama sempat menerima write D yang tidak ada di promoted standby, maka D berada pada history yang tidak dipilih.

Itulah mengapa asynchronous failover dapat kehilangan transaksi yang sudah commit di primary lama tetapi belum sampai ke standby.

## 10.4 RPO saat Failover

RPO bergantung mode replication:

```text
Async replication:
    RPO > 0 mungkin terjadi.
    Commit terakhir bisa hilang jika belum replicated.

Sync replication remote_flush:
    RPO lebih kuat untuk standby sinkron tertentu.
    Commit menunggu standby flush.

Sync replication remote_apply:
    Lebih kuat untuk read-after-write dari standby sinkron,
    tapi latency lebih mahal.
```

Namun RPO bukan hanya parameter. RPO adalah hasil dari:

```text
- topology
- synchronous_standby_names
- network
- failover tool
- fencing
- monitoring
- operator procedure
- client behavior
```

---

# 11. Application Behavior During Failover

Aplikasi Java sering gagal bukan karena database tidak bisa failover, tetapi karena aplikasi tidak siap menghadapi failover.

## 11.1 Apa yang Terjadi ke Connection Pool?

Saat primary down/failover:

```text
Existing JDBC connections putus atau menjadi error.
Pool masih punya connection lama.
Query berikutnya gagal.
Aplikasi perlu evict/reconnect.
```

HikariCP akan mencoba memvalidasi/mengganti connection, tetapi aplikasi tetap harus siap menerima exception.

Kemungkinan error:

```text
- connection refused
- connection reset
- read timeout
- SQLTransientConnectionException
- transaction aborted
- could not serialize access
- database system is in recovery
- cannot execute INSERT in a read-only transaction
```

## 11.2 Retry Semantics

Tidak semua operasi aman diretry.

Kategori:

```text
Safe retry:
- idempotent read
- insert dengan idempotency key
- update conditional yang bisa dicek ulang
- outbox publish yang deduplicate

Dangerous retry:
- payment charge tanpa idempotency
- external side effect sudah terjadi tetapi DB commit uncertainty
- non-idempotent sequence of writes
```

Failover membuat ambiguous outcome mungkin terjadi:

```text
Client mengirim COMMIT
Connection putus sebelum menerima response
Apakah commit berhasil?
Tidak selalu bisa diketahui dari client saja.
```

Solusi:

```text
- idempotency key
- business operation id
- unique constraint
- retry by checking state
- outbox pattern
- external side effect after durable DB state
```

## 11.3 Read-only Error Setelah Failover

Aplikasi bisa tersambung ke standby yang belum promoted atau endpoint yang salah.

Error umum:

```text
cannot execute INSERT in a read-only transaction
```

Kemungkinan penyebab:

```text
- routing masih ke standby
- DNS/cache belum update
- connection pool memegang connection lama
- failover belum selesai
- transaction marked read-only
```

Runbook aplikasi:

```text
1. Evict broken connections.
2. Retry dengan backoff.
3. Pastikan write endpoint menunjuk primary baru.
4. Jangan infinite retry tanpa idempotency.
5. Surface degraded mode jika DB belum writable.
```

---

# 12. Read Routing Strategy

Jika memakai primary + read replica, aplikasi butuh strategy.

## 12.1 Naive Routing

```text
All writes -> primary
All reads  -> replica
```

Ini sering salah.

Masalah:

```text
- read-after-write broken
- transaction consistency broken
- stale authorization data
- stale workflow state
- stale account balance
```

## 12.2 Better Routing

```text
Critical reads          -> primary
Read-after-write reads  -> primary or LSN-aware replica
Eventually-consistent   -> replica
Reporting/dashboard     -> replica
Long analytics          -> dedicated replica
```

## 12.3 Transaction-aware Routing

Dalam Spring:

```java
@Transactional
public void approveCase(UUID caseId) {
    repository.updateStatus(caseId, APPROVED);
    Case c = repository.findById(caseId); // harus konsisten dengan write
}
```

Jika `findById` diarahkan ke replica, transaksi aplikasi menjadi tidak masuk akal.

Invariant:

```text
Di dalam transaksi write, semua DB access harus ke primary yang sama.
```

## 12.4 Sticky Reads

Setelah write, simpan marker di request/session:

```text
user/session has_recent_write = true
```

Selama window tertentu:

```text
route reads to primary
```

Ini sederhana dan sering cukup.

Kelemahannya:

```text
- meningkatkan load primary
- window terlalu pendek masih bisa stale
- window terlalu panjang mengurangi manfaat replica
```

## 12.5 LSN-aware Reads

Lebih presisi:

1. Setelah commit write, ambil commit/current LSN.
2. Saat membaca dari replica, pastikan replica sudah replay sampai LSN itu.
3. Jika belum, tunggu sebentar atau fallback ke primary.

Konsep:

```text
required_lsn <= replica_replay_lsn
```

Ini lebih kuat tetapi lebih kompleks.

---

# 13. Logical Replication

Logical replication memindahkan perubahan table-level dari publisher ke subscriber.

Komponen:

```text
Publisher database
├── publication
├── logical decoding
├── replication slot
└── WAL changes

Subscriber database
├── subscription
├── apply worker
└── target tables
```

## 13.1 Publication

Publication mendefinisikan data apa yang dipublikasikan.

Contoh:

```sql
CREATE PUBLICATION app_pub
FOR TABLE case_file, case_event, enforcement_action;
```

Bisa juga:

```sql
CREATE PUBLICATION app_pub FOR ALL TABLES;
```

Namun `FOR ALL TABLES` harus hati-hati karena:

```text
- semua tabel ikut stream
- perubahan schema/tabel baru bisa berdampak luas
- governance lebih sulit
```

## 13.2 Subscription

Subscriber menerima perubahan.

Contoh:

```sql
CREATE SUBSCRIPTION app_sub
CONNECTION 'host=primary.example.com dbname=app user=repl password=secret'
PUBLICATION app_pub;
```

Subscriber menjalankan apply worker yang menerapkan perubahan.

## 13.3 Initial Data Copy

Logical subscription dapat melakukan initial copy.

Mental model:

```text
1. Copy data awal tabel.
2. Sambil itu, logical slot mencatat perubahan baru.
3. Setelah copy selesai, subscriber apply perubahan yang tertinggal.
```

Untuk tabel besar:

```text
- initial copy bisa berat
- lock/IO/network harus diperhitungkan
- monitoring lag penting
```

## 13.4 DDL Tidak Otomatis Sama

Logical replication terutama mereplikasi DML/data changes.

DDL seperti:

```sql
ALTER TABLE ... ADD COLUMN ...
CREATE INDEX ...
DROP COLUMN ...
```

perlu dikelola secara terpisah.

Dalam migration, urutan DDL publisher/subscriber sangat penting.

## 13.5 Replica Identity

Untuk UPDATE/DELETE, subscriber perlu tahu row mana yang diubah/dihapus.

Biasanya memakai primary key.

Jika tidak ada primary key, perlu `REPLICA IDENTITY`.

Contoh:

```sql
ALTER TABLE audit_event REPLICA IDENTITY FULL;
```

Tapi `FULL` bisa mahal karena seluruh old row harus tersedia untuk identifying row.

Operational rule:

```text
Tabel yang dilogical-replicate sebaiknya punya primary key stabil.
```

---

# 14. Use Case Logical Replication

Logical replication cocok untuk:

```text
- major version upgrade dengan downtime kecil
- migration antar cluster
- selective replication antar service boundary
- building reporting database
- CDC ke pipeline data
- dual-run system migration
- tenant migration
- regional copy dengan subset data
```

Tidak cocok untuk:

```text
- general HA primary failover sederhana
- arbitrary conflict resolution multi-writer
- automatic schema synchronization
- high-write workload tanpa capacity planning
- tabel tanpa key jelas
```

## 14.1 Migration Antar Cluster

Pattern:

```text
Old primary
    ↓ logical replication
New cluster
    ↓ catch up
Cutover aplikasi
```

Keuntungan:

```text
- downtime bisa diperkecil
- bisa migrate major version
- bisa test target cluster sebelum cutover
```

Risiko:

```text
- schema drift
- sequence synchronization
- lag saat write tinggi
- trigger/constraint differences
- cutover correctness
```

## 14.2 CDC untuk Event Pipeline

Logical decoding dapat menjadi sumber CDC.

Namun CDC dari database bukan pengganti domain event secara otomatis.

Perbedaan:

```text
CDC:
    Row berubah.

Domain event:
    Meaningful business fact terjadi.
```

Contoh:

```text
CDC: case.status changed from REVIEW to APPROVED
Domain event: CaseApprovedBySupervisor
```

CDC berguna, tapi untuk regulatory audit dan workflow semantics, domain event/outbox sering lebih defensible.

---

# 15. Logical Replication Failure Modes

## 15.1 Subscriber Down

Jika subscriber down:

```text
logical slot di publisher menahan WAL
lag meningkat
disk publisher bisa tertekan
```

## 15.2 Apply Error

Apply worker bisa gagal karena:

```text
- constraint violation di subscriber
- missing table/column
- type mismatch
- duplicate key
- permission problem
- trigger side effect
```

Jika apply berhenti, lag bertambah.

## 15.3 Schema Drift

Publisher dan subscriber schema tidak kompatibel.

Contoh:

```text
Publisher menambah NOT NULL column tanpa default.
Subscriber belum punya column.
Apply gagal.
```

Migration rule:

```text
Logical replication membutuhkan migration choreography.
```

## 15.4 Sequence Drift

Logical replication tidak otomatis menyelesaikan semua problem sequence untuk cutover.

Jika target cluster akan menjadi writable, sequence perlu diset agar tidak menghasilkan duplicate key.

Contoh:

```sql
SELECT setval('case_file_id_seq', (SELECT max(id) FROM case_file));
```

Harus dilakukan dengan benar saat cutover.

---

# 16. Cascading Replication

Cascading replication memungkinkan standby menjadi source untuk standby lain.

Topology:

```text
Primary
  ↓
Standby A
  ↓
Standby B
```

Keuntungan:

```text
- mengurangi beban primary mengirim WAL ke banyak standby
- berguna untuk topology geografis
```

Risiko:

```text
- downstream lag bertambah
- failure standby tengah mempengaruhi downstream
- monitoring lebih kompleks
```

Prinsip:

```text
Semakin panjang chain replication, semakin besar latency dan kompleksitas diagnosis.
```

---

# 17. Replication dan Backup

Replication bukan backup.

Kenapa?

```text
Jika aplikasi menjalankan DELETE salah di primary,
replica akan mereplikasi DELETE itu.
```

Replication membantu availability dan read scaling, tetapi tidak menggantikan:

```text
- base backup
- WAL archiving
- PITR
- restore drill
- retention policy
```

Rule:

```text
Backup melindungi dari data corruption/logical mistakes.
Replication melindungi dari sebagian node failure dan membantu availability/read scaling.
```

Keduanya diperlukan untuk production serious system.

---

# 18. Replication dan Java Architecture

## 18.1 DataSource Separation

Sering ada dua DataSource:

```text
primaryDataSource
replicaDataSource
```

Tapi separation ini harus disertai rule.

Jangan hanya:

```text
repository method yang namanya find* diarahkan ke replica
```

Karena `find*` bisa berada di dalam workflow write transaction.

Lebih baik:

```text
- command path selalu primary
- query path boleh replica jika eventual consistency acceptable
- transactional context mengunci routing ke primary
- explicit annotation untuk replica read
```

## 18.2 Spring `@Transactional(readOnly = true)`

`readOnly = true` bukan otomatis berarti aman ke replica.

Read-only transaction bisa tetap membutuhkan fresh data.

Contoh:

```java
@Transactional(readOnly = true)
public CaseView loadAfterApproval(UUID caseId) {
    return caseRepository.findView(caseId);
}
```

Jika dipanggil setelah approval commit oleh user yang sama, stale read bisa membingungkan.

Pertanyaan bukan:

```text
Apakah method ini read-only?
```

Pertanyaan yang benar:

```text
Apakah method ini boleh membaca data stale?
```

## 18.3 Retry dengan Idempotency

Failover, network partition, dan connection reset membuat retry perlu.

Tapi retry harus berbasis invariant.

Pattern:

```sql
CREATE TABLE request_idempotency (
    request_key text PRIMARY KEY,
    operation_type text NOT NULL,
    result_ref uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Lalu aplikasi:

```text
1. Insert idempotency key.
2. Jika conflict, cek hasil lama.
3. Jalankan operasi dalam transaksi.
4. Simpan result_ref.
5. Commit.
```

Dengan begitu ambiguous commit bisa ditangani dengan state check.

---

# 19. Observability Replication

## 19.1 Primary-side Views

Query utama:

```sql
SELECT
    pid,
    application_name,
    client_addr,
    state,
    sync_state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes,
    write_lag,
    flush_lag,
    replay_lag
FROM pg_stat_replication;
```

Interpretasi:

```text
state       : streaming/catchup/etc.
sync_state  : async/sync/potential/quorum
sent_lsn    : dikirim primary
write_lsn   : ditulis standby
flush_lsn   : diflush standby
replay_lsn  : direplay standby
```

## 19.2 Standby-side Views

Di standby:

```sql
SELECT
    pg_is_in_recovery() AS is_standby,
    pg_last_wal_receive_lsn() AS receive_lsn,
    pg_last_wal_replay_lsn() AS replay_lsn,
    now() - pg_last_xact_replay_timestamp() AS replay_delay;
```

## 19.3 Slot Monitoring

```sql
SELECT
    slot_name,
    slot_type,
    active,
    restart_lsn,
    confirmed_flush_lsn,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;
```

Alert penting:

```text
- slot inactive terlalu lama
- retained WAL meningkat cepat
- replica replay lag tinggi
- synchronous standby tidak tersedia
- replication connection down
- WAL disk usage naik
```

## 19.4 Dashboard Minimal

Dashboard replication minimal harus punya:

```text
Primary:
- current WAL LSN
- pg_stat_replication per standby
- WAL generation rate
- replication slot retained WAL
- WAL disk usage
- checkpoint/WAL write pressure

Standby:
- receive LSN
- replay LSN
- replay delay
- recovery conflicts
- long-running queries
- read query load

Application:
- primary connection errors
- replica connection errors
- read routing rate
- stale read fallback count
- retry count after failover
```

---

# 20. Designing Replication Topology

## 20.1 Simple HA Topology

```text
Primary
  ↓ streaming replication
Standby
```

Use case:

```text
- basic HA
- simple failover
- standby for backup/read-only limited query
```

## 20.2 HA + Read Replica

```text
Primary
  ├── Synchronous standby for HA
  └── Async read replica for reporting
```

Reasoning:

```text
HA standby should not be overloaded by reporting.
Reporting replica can lag without blocking critical failover candidate.
```

## 20.3 Multi-region Async Replica

```text
Region A primary
  ↓ async replication
Region B standby/read replica
```

Trade-off:

```text
- DR benefit
- regional read benefit
- higher lag
- async RPO risk
- failover complexity
```

## 20.4 Logical Reporting Database

```text
OLTP primary
  ↓ logical replication subset
Reporting PostgreSQL
```

Keuntungan:

```text
- isolate reporting schema/indexes
- subset data
- independent tuning
```

Risiko:

```text
- eventual consistency
- DDL choreography
- apply lag
- conflict if subscriber mutated unexpectedly
```

---

# 21. Anti-pattern Replication

## 21.1 Menganggap Replica Selalu Fresh

Salah:

```text
Replica = primary copy real-time.
```

Benar:

```text
Replica = copy yang sedang mengejar primary.
```

## 21.2 Semua Read ke Replica

Salah jika ada:

```text
- user melihat hasil write sendiri
- authorization decision
- financial balance
- workflow transition validation
- optimistic lock check
```

## 21.3 Slot Tanpa Monitoring

Replication slot tanpa monitoring adalah bom waktu disk.

## 21.4 Reporting Query Berat di Failover Standby

Jika standby yang seharusnya jadi HA candidate juga dipakai reporting berat, failover readiness menurun.

Pisahkan:

```text
HA standby != analytics playground
```

## 21.5 Logical Replication Tanpa Primary Key

Update/delete menjadi mahal/rapuh.

## 21.6 Failover Tanpa Fencing

Promote standby tanpa memastikan primary lama tidak bisa menerima write adalah risiko split brain.

## 21.7 Retry Semua Exception

Retry tanpa idempotency bisa menggandakan side effect.

---

# 22. Case Study: Workflow Case Management dengan Read Replica

Misal sistem enforcement case:

```text
case_file(id, status, assigned_to, version, updated_at)
case_event(id, case_id, event_type, payload, created_at)
case_task(id, case_id, status, due_at)
```

Architecture:

```text
Command API -> primary
Dashboard   -> replica
Reporting   -> replica khusus
```

## 22.1 Status Transition

Approval flow:

```text
PENDING_REVIEW -> APPROVED
```

Harus primary karena:

```text
- butuh lock/invariant fresh
- status tidak boleh stale
- event/outbox harus atomic
```

Transaksi:

```sql
BEGIN;

SELECT status, version
FROM case_file
WHERE id = :case_id
FOR UPDATE;

UPDATE case_file
SET status = 'APPROVED', version = version + 1
WHERE id = :case_id
  AND status = 'PENDING_REVIEW';

INSERT INTO case_event(...);
INSERT INTO outbox_event(...);

COMMIT;
```

Setelah commit, UI redirect ke detail case.

Jika detail case dibaca dari replica, user bisa melihat status lama.

Solusi:

```text
- redirect read ke primary setelah command
- sticky primary for same request/session
- LSN-aware replica read
```

## 22.2 Dashboard

Dashboard “jumlah case per status” boleh eventual jika digunakan untuk overview.

Tapi dashboard “case yang harus saya approve sekarang” mungkin tidak boleh stale.

Pertanyaan desain:

```text
Apakah stale data menyebabkan hanya visual mismatch,
atau menyebabkan keputusan salah?
```

## 22.3 Audit Trail

Audit trail untuk regulatory defensibility sebaiknya tidak bergantung pada replica freshness untuk write path.

Audit write harus atomic dengan primary transaction.

Replica boleh dipakai untuk read-only audit browsing jika user menerima delay.

---

# 23. Runbook: Replica Lag Tinggi

Gejala:

```text
- dashboard stale
- read replica terlihat data lama
- pg_stat_replication replay lag meningkat
- WAL disk usage naik
```

Langkah diagnosis:

```sql
-- Di primary
SELECT
    application_name,
    state,
    sync_state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes,
    write_lag,
    flush_lag,
    replay_lag
FROM pg_stat_replication;
```

```sql
-- Di standby
SELECT
    pg_is_in_recovery(),
    pg_last_wal_receive_lsn(),
    pg_last_wal_replay_lsn(),
    now() - pg_last_xact_replay_timestamp() AS replay_delay;
```

Periksa:

```text
1. Apakah WAL dikirim tetapi belum replay?
2. Apakah standby CPU/IO saturated?
3. Apakah ada query panjang di standby?
4. Apakah ada recovery conflict?
5. Apakah primary menghasilkan WAL spike?
6. Apakah ada batch/migration besar?
7. Apakah network bermasalah?
```

Mitigasi:

```text
- hentikan/throttle query berat di standby
- pindahkan reporting ke replica khusus
- chunk batch job di primary
- tambah resource standby
- perbaiki index query standby
- temporarily route critical reads ke primary
- monitor retained WAL
```

---

# 24. Runbook: WAL Disk Primary Naik karena Slot

Gejala:

```text
- disk WAL primary naik
- pg_wal membesar
- replication slot inactive
- replica/consumer mati
```

Query:

```sql
SELECT
    slot_name,
    slot_type,
    active,
    restart_lsn,
    confirmed_flush_lsn,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots
ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC;
```

Keputusan:

```text
Jika consumer masih dibutuhkan:
    - hidupkan consumer
    - biarkan catch up
    - tambah disk sementara jika perlu

Jika consumer sudah tidak dipakai:
    - drop slot dengan hati-hati
```

Drop slot:

```sql
SELECT pg_drop_replication_slot('slot_name');
```

Hati-hati:

```text
Drop slot berarti consumer tidak bisa melanjutkan dari posisi lama.
Mungkin perlu reinitialize/rebuild.
```

---

# 25. Runbook: Failover Terjadi

Saat failover:

```text
1. Tentukan primary lama benar-benar tidak boleh menerima write.
2. Promote standby melalui HA tooling, bukan manual random command jika production.
3. Verifikasi primary baru writable.
4. Update routing/load balancer/DNS/service discovery.
5. Evict stale app connections.
6. Monitor errors dan retries.
7. Verifikasi replication topology baru.
8. Tentukan nasib primary lama: rewind/rebuild.
9. Audit kemungkinan data loss jika async.
```

Aplikasi:

```text
- retry transient DB errors dengan backoff
- jangan retry non-idempotent operation tanpa key
- expose degraded mode jika DB belum writable
- monitor connection pool churn
```

Post-failover checks:

```sql
SELECT pg_is_in_recovery(); -- false di primary baru
```

```sql
SELECT timeline_id FROM pg_control_checkpoint(); -- jika tersedia melalui extension/tooling atau pg_controldata OS-side
```

```sql
SELECT * FROM pg_stat_replication;
```

---

# 26. Design Checklist Replication

Sebelum memakai replication, jawab pertanyaan ini:

## 26.1 Consistency

```text
- Data apa yang boleh stale?
- Berapa stale window yang acceptable?
- Apakah read-after-write dibutuhkan?
- Apakah stale read bisa menyebabkan keputusan salah?
```

## 26.2 Availability

```text
- Apa RTO target saat primary gagal?
- Apa RPO target?
- Apakah async cukup?
- Apakah sync replication diperlukan?
- Apakah failover otomatis atau manual?
```

## 26.3 Topology

```text
- Berapa standby?
- Standby mana HA candidate?
- Standby mana reporting replica?
- Apakah cascading replication perlu?
- Apakah multi-region replication realistis dengan lag?
```

## 26.4 Application

```text
- Bagaimana routing primary/replica?
- Bagaimana connection pool refresh saat failover?
- Exception mana yang diretry?
- Operasi mana yang idempotent?
- Apakah transaksi write selalu ke primary?
```

## 26.5 Operations

```text
- Bagaimana monitoring lag?
- Bagaimana monitoring slot?
- Siapa yang boleh drop slot?
- Bagaimana rebuild standby?
- Bagaimana failover drill dilakukan?
- Bagaimana rollback setelah bad failover?
```

---

# 27. Practical SQL Reference

## 27.1 Cek Apakah Node Standby

```sql
SELECT pg_is_in_recovery();
```

Interpretasi:

```text
true  = standby/recovery mode
false = primary/writable normal mode
```

## 27.2 Primary: Lihat Replication Status

```sql
SELECT
    pid,
    application_name,
    client_addr,
    state,
    sync_state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_lag
FROM pg_stat_replication;
```

## 27.3 Standby: Lihat Receive dan Replay

```sql
SELECT
    pg_last_wal_receive_lsn() AS receive_lsn,
    pg_last_wal_replay_lsn() AS replay_lsn,
    pg_size_pretty(pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())) AS receive_replay_gap,
    now() - pg_last_xact_replay_timestamp() AS replay_delay;
```

## 27.4 Lihat Replication Slots

```sql
SELECT
    slot_name,
    slot_type,
    active,
    restart_lsn,
    confirmed_flush_lsn,
    wal_status,
    safe_wal_size
FROM pg_replication_slots;
```

## 27.5 Buat Physical Slot

```sql
SELECT pg_create_physical_replication_slot('standby_1');
```

## 27.6 Drop Slot

```sql
SELECT pg_drop_replication_slot('standby_1');
```

## 27.7 Buat Publication

```sql
CREATE PUBLICATION case_pub
FOR TABLE case_file, case_event, outbox_event;
```

## 27.8 Buat Subscription

```sql
CREATE SUBSCRIPTION case_sub
CONNECTION 'host=primary dbname=app user=repl password=secret'
PUBLICATION case_pub;
```

## 27.9 Cek Subscription

```sql
SELECT * FROM pg_stat_subscription;
```

---

# 28. Mental Model Final

Replication PostgreSQL bisa diringkas seperti ini:

```text
Primary menghasilkan WAL.
Physical replication mengirim dan mereplay WAL secara fisik.
Logical replication men-decode WAL menjadi perubahan data logis.
Replica selalu punya posisi, bukan magic mirror.
Lag adalah jarak antara posisi primary dan posisi replica.
Slot menjaga WAL tetap ada untuk consumer, tapi bisa memenuhi disk.
Failover memilih history baru dan membutuhkan fencing.
Aplikasi harus siap terhadap stale read, reconnect, retry, dan ambiguous commit.
```

Engineer PostgreSQL yang kuat tidak hanya bertanya:

```text
Apakah ada replica?
```

Ia bertanya:

```text
Replica ini untuk apa?
HA atau reporting?
Async atau sync?
RPO/RTO berapa?
Lag dimonitor bagaimana?
Slot dimonitor bagaimana?
Read routing rule-nya apa?
Bagaimana aplikasi menjaga read-after-write?
Apa runbook saat failover?
Bagaimana mencegah split brain?
```

Replication adalah boundary antara database internals, operasi infrastruktur, dan application correctness.

---

# 29. Latihan

## Latihan 1 — Read-after-write

Desain routing untuk flow:

```text
POST /cases/{id}/approve
GET  /cases/{id}
GET  /dashboard/my-tasks
GET  /reports/case-status-summary
```

Tentukan mana yang harus ke primary, mana boleh ke replica, dan alasannya.

## Latihan 2 — Slot Incident

Kamu melihat disk primary naik cepat. Query `pg_replication_slots` menunjukkan satu logical slot `active = false` dan retained WAL 400GB.

Jawab:

```text
1. Apa kemungkinan penyebab?
2. Apa risiko drop slot?
3. Apa mitigasi jangka pendek?
4. Apa perbaikan monitoring jangka panjang?
```

## Latihan 3 — Failover Ambiguous Commit

Client mengirim transaksi approve case. Saat commit, connection reset. Setelah failover, client tidak tahu apakah transaksi berhasil.

Desain cara aplikasi menentukan outcome dengan:

```text
- idempotency key
- unique constraint
- case_event
- outbox_event
```

## Latihan 4 — Logical Replication Migration

Rancang high-level migration dari PostgreSQL cluster lama ke cluster baru memakai logical replication.

Sertakan:

```text
- initial schema setup
- publication/subscription
- initial copy
- lag monitoring
- sequence sync
- cutover
- rollback plan
```

---

# 30. Ringkasan

Di bagian ini kita membahas:

```text
- physical streaming replication
- hot standby
- read replica
- async vs synchronous replication
- replication slot
- replication lag
- recovery conflict
- hot_standby_feedback
- failover semantics
- timeline
- split brain
- Java application behavior saat failover
- read routing
- logical replication
- publication/subscription
- replica identity
- CDC vs domain event
- monitoring dan runbook
```

Key takeaway:

```text
Replication bukan hanya fitur infrastruktur.
Replication mempengaruhi correctness aplikasi.
```

Jika aplikasi membaca dari replica tanpa memahami lag, maka bug yang muncul tampak seperti bug bisnis.

Jika failover dilakukan tanpa fencing, correctness bisa hancur.

Jika slot tidak dimonitor, primary bisa penuh disk.

Jika retry dilakukan tanpa idempotency, side effect bisa dobel.

PostgreSQL replication kuat, tetapi hanya aman jika application design, operational runbook, dan monitoring ikut matang.

---

# 31. Berikutnya

Bagian berikutnya:

```text
Part 028 — High Availability Architecture: Patroni, pgBackRest, HAProxy, Cloud-managed PostgreSQL
```

Di sana kita akan naik dari mekanisme replication ke arsitektur HA utuh:

```text
- leader election
- Patroni mental model
- DCS seperti etcd/Consul
- HAProxy/connection routing
- cloud-managed failover
- self-managed vs managed PostgreSQL
- failover drill
- data correctness saat topology berubah
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Backup, Restore, PITR, dan Disaster Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-028.md">Part 028 — High Availability Architecture: Patroni, pgBackRest, HAProxy, dan Cloud-managed PostgreSQL ➡️</a>
</div>
