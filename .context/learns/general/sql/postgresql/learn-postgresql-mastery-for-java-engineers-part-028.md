# learn-postgresql-mastery-for-java-engineers-part-028.md

# Part 028 — High Availability Architecture: Patroni, pgBackRest, HAProxy, dan Cloud-managed PostgreSQL

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `028 / 034`  
> Fokus: memahami PostgreSQL High Availability sebagai desain sistem end-to-end, bukan sekadar “punya replica”.

---

## 0. Posisi Bagian Ini dalam Seri

Di Part 027 kita sudah membahas **replication**:

- physical streaming replication,
- asynchronous vs synchronous replication,
- hot standby,
- replication lag,
- replication slot,
- failover semantics,
- timeline,
- split brain,
- read-after-write consistency,
- logical replication.

Part 028 naik satu level: dari **mekanisme replikasi** menjadi **arsitektur high availability**.

Replication menjawab:

```text
Bagaimana data dari primary dikirim ke standby?
```

High availability menjawab:

```text
Ketika primary gagal, siapa yang memutuskan node pengganti?
Bagaimana mencegah dua primary aktif bersamaan?
Bagaimana aplikasi diarahkan ke primary baru?
Bagaimana memastikan backup tetap valid?
Bagaimana retry dilakukan tanpa merusak correctness?
Bagaimana membuktikan sistem benar-benar pulih, bukan hanya tampak hidup?
```

Ini sangat penting untuk Java engineer karena aplikasi Java biasanya melihat database sebagai satu endpoint stabil. Padahal di belakang endpoint itu bisa terjadi:

- primary crash,
- standby promoted,
- old primary hidup kembali,
- DNS berubah,
- connection pool menyimpan connection lama,
- transaction commit status ambigu,
- read replica tertinggal,
- migration berjalan di node yang salah,
- backup tertahan karena WAL archiving bermasalah.

Engineer top-tier tidak hanya bertanya:

```text
Apakah PostgreSQL punya replica?
```

Mereka bertanya:

```text
Apa state machine HA-nya?
Apa invariant-nya?
Apa failure mode-nya?
Apa bukti bahwa failover tidak menyebabkan split brain?
Apa yang aplikasi lakukan saat commit status tidak diketahui?
Apa RPO/RTO realistis berdasarkan desain ini?
```

---

## 1. Replication Bukan High Availability

Kesalahan paling umum:

```text
Kami punya standby, berarti sudah HA.
```

Belum tentu.

Replica hanya menyediakan **salinan data**. HA membutuhkan seluruh mekanisme berikut:

1. failure detection,
2. leader election,
3. promotion,
4. fencing,
5. connection routing,
6. application reconnection,
7. consistency policy,
8. backup/WAL continuity,
9. observability,
10. runbook,
11. failover testing,
12. recovery of failed old primary.

Tanpa itu, replica hanyalah node pasif yang mungkin berguna, mungkin juga menjadi sumber split brain.

### 1.1 Mental Model Minimal

Bayangkan cluster PostgreSQL sebagai state machine:

```text
Healthy
  ├─ primary accepts writes
  ├─ standby follows WAL
  └─ router sends writes to primary

Primary suspected failed
  ├─ failure detector observes timeout
  ├─ cluster manager checks quorum/DCS
  └─ promotion decision pending

Failover in progress
  ├─ chosen standby promoted
  ├─ old primary must be fenced or rejected
  ├─ routing endpoint updated
  └─ applications reconnect

Recovered
  ├─ new primary accepts writes
  ├─ replicas follow new timeline
  └─ old primary reinitialized or rewound
```

Jika desain tidak bisa menjelaskan transisi ini, desain HA belum matang.

---

## 2. Tujuan HA: Availability dengan Correctness

High availability bukan berarti database tidak pernah error.

HA berarti:

```text
Sistem mampu kembali melayani request dalam batas waktu yang disepakati,
dengan kehilangan data dan risiko inkonsistensi yang dipahami, dibatasi,
dan diuji.
```

Ada tiga angka penting:

| Konsep | Pertanyaan | Contoh |
|---|---|---|
| RTO | Berapa lama layanan boleh tidak tersedia? | 30 detik, 5 menit, 1 jam |
| RPO | Berapa banyak data boleh hilang? | 0 transaksi, 5 detik, 1 menit |
| Consistency policy | Apa yang boleh stale/ulang/gagal? | retry idempotent, read-after-write wajib, audit tidak boleh hilang |

Untuk sistem regulatory, enforcement, payment, workflow, atau audit-heavy, RPO/RTO tidak boleh menjadi slogan. Harus diterjemahkan ke desain:

```text
Jika RPO = 0,
  maka commit harus menunggu synchronous standby tertentu atau quorum tertentu.

Jika RTO < 30 detik,
  maka failover manual kemungkinan tidak cukup.

Jika read-after-write wajib,
  maka read routing ke replica harus dikontrol.

Jika audit event tidak boleh hilang,
  maka outbox/idempotency/replay design wajib.
```

---

## 3. Komponen Arsitektur HA PostgreSQL

Arsitektur HA PostgreSQL biasanya terdiri dari beberapa layer.

```text
Application Layer
  └─ Java service, connection pool, retries, idempotency

Connection Routing Layer
  └─ HAProxy / PgBouncer / DNS / VIP / cloud endpoint

Cluster Management Layer
  └─ Patroni / repmgr / cloud control plane

Consensus / Coordination Layer
  └─ etcd / Consul / ZooKeeper / Kubernetes API

Database Layer
  └─ PostgreSQL primary + standby nodes

Backup & Recovery Layer
  └─ pgBackRest / WAL-G / Barman / cloud snapshots

Observability Layer
  └─ metrics, logs, tracing, alerts, runbooks
```

PostgreSQL core menyediakan replication dan recovery primitives, tetapi biasanya tidak menyediakan seluruh cluster management stack sendiri. Karena itu tools seperti Patroni, repmgr, pgBackRest, HAProxy, PgBouncer, dan cloud-managed PostgreSQL muncul sebagai bagian dari ecosystem.

---

## 4. Primary/Standby Topology

Topologi paling umum:

```text
        +-------------+
        |  primary    |
        | read/write  |
        +------+------+
               |
          WAL stream
               |
    +----------+----------+
    |                     |
+---v---------+     +-----v-------+
| standby-1   |     | standby-2   |
| read-only   |     | read-only   |
+-------------+     +-------------+
```

Primary menerima write. Standby menerima WAL dan bisa melayani read-only query jika hot standby aktif.

Namun topology saja belum menjawab:

- standby mana yang dipromote,
- bagaimana memastikan standby paling up-to-date,
- bagaimana aplikasi tahu primary berubah,
- bagaimana old primary dicegah menerima write,
- bagaimana standby lain mengikuti timeline baru.

---

## 5. Failure Detection

Failure detection adalah proses menentukan apakah primary benar-benar gagal.

Ini lebih sulit daripada kelihatannya.

Primary bisa:

1. benar-benar mati,
2. hidup tapi network-isolated,
3. overload sehingga lambat merespons,
4. storage hang,
5. PostgreSQL process mati tapi host hidup,
6. host hidup tapi disk read-only,
7. primary masih menerima sebagian koneksi.

Masalahnya:

```text
Tidak ada observer tunggal yang selalu tahu kebenaran global dalam distributed system.
```

Jika timeout terlalu pendek:

```text
false positive failover meningkat.
```

Jika timeout terlalu panjang:

```text
RTO memburuk.
```

Maka desain HA harus memilih trade-off, bukan mencari setting ajaib.

### 5.1 Failure Detection Anti-pattern

Anti-pattern umum:

```text
Jika aplikasi tidak bisa connect ke database selama 5 detik,
promote standby.
```

Ini berbahaya karena aplikasi bisa gagal connect karena:

- network segment aplikasi putus,
- DNS issue,
- firewall issue,
- pool exhaustion,
- TLS issue,
- max connection reached,
- load balancer issue.

Aplikasi bukan sumber kebenaran yang cukup untuk memutuskan failover database.

---

## 6. Leader Election dan Distributed Configuration Store

Agar failover otomatis aman, cluster manager butuh tempat koordinasi yang relatif konsisten.

Contoh DCS/coordination layer:

- etcd,
- Consul,
- ZooKeeper,
- Kubernetes API.

Tujuannya:

```text
Hanya satu node yang boleh memiliki leadership lease pada satu waktu.
```

Mental model:

```text
primary leadership = lease yang harus diperpanjang secara berkala
```

Jika primary tidak bisa memperbarui lease:

```text
cluster manager dapat memilih standby baru untuk promote
```

Namun ini hanya aman bila quorum dan fencing dipahami.

### 6.1 Quorum

Quorum mencegah dua sisi network partition sama-sama merasa berhak memilih primary.

Contoh DCS 3 node:

```text
DCS nodes: dcs-1, dcs-2, dcs-3
Quorum: 2 dari 3
```

Jika primary berada di partition yang hanya bisa melihat 1 DCS node, ia tidak boleh mempertahankan leadership.

### 6.2 Kenapa DCS Tidak Boleh Dianggap Detail Kecil

DCS adalah bagian kritis dari database availability.

Jika DCS down:

- failover mungkin tidak bisa terjadi,
- leadership renewal bisa gagal,
- cluster bisa masuk safe mode,
- routing bisa stale,
- automation bisa berhenti.

Jadi saat mendesain HA PostgreSQL, availability DCS harus dihitung sebagai bagian dari availability database.

---

## 7. Split Brain: Musuh Utama HA Database

Split brain terjadi ketika dua node sama-sama menerima write sebagai primary.

```text
      Network partition

    app-A                app-B
      |                    |
      v                    v
+-------------+      +-------------+
| primary old |      | primary new |
| accepts W   |      | accepts W   |
+-------------+      +-------------+
```

Akibatnya:

- dua timeline divergen,
- data conflict,
- audit trail rusak,
- restore sulit,
- regulatory defensibility hancur,
- manual reconciliation mahal.

Dalam PostgreSQL physical replication, split brain bukan conflict yang bisa di-merge otomatis.

### 7.1 Invariant HA Paling Penting

```text
Dalam satu cluster logical, pada satu waktu hanya boleh ada satu writer yang sah.
```

Semua desain HA harus menjaga invariant ini.

---

## 8. Fencing

Fencing adalah mekanisme untuk memastikan node lama yang dianggap gagal tidak bisa lagi menulis.

Bentuk fencing:

1. shutdown PostgreSQL pada old primary,
2. revoke route dari load balancer,
3. STONITH/power off host,
4. detach storage,
5. remove network access,
6. cloud control plane action,
7. DCS leadership lease enforcement,
8. PostgreSQL timeline rejection setelah node lama rejoin.

Tanpa fencing, failover otomatis bisa lebih berbahaya daripada downtime manual.

### 8.1 Soft Fencing vs Hard Fencing

Soft fencing:

```text
Node lama kehilangan leadership dan diharapkan berhenti menerima write.
```

Hard fencing:

```text
Node lama dipastikan tidak bisa melakukan write secara fisik/operasional.
```

Untuk workload sensitif, hard fencing atau equivalent safety mechanism perlu dipikirkan serius.

---

## 9. Promotion

Promotion mengubah standby menjadi primary.

Setelah promoted:

- standby keluar dari recovery mode,
- mulai menerima write,
- timeline baru dibuat,
- standby lain harus mengikuti primary baru,
- old primary tidak bisa begitu saja kembali sebagai primary lama.

Promotion bukan sekadar:

```bash
pg_ctl promote
```

Promotion adalah transisi state arsitektur.

### 9.1 Memilih Standby untuk Dipromote

Kriteria umum:

1. paling kecil replication lag,
2. sehat secara host/storage/network,
3. berada di zone/region yang tepat,
4. punya WAL cukup,
5. tidak sedang tertinggal jauh,
6. bisa dijangkau aplikasi,
7. cocok dengan synchronous replication policy.

Jika memilih standby yang tertinggal:

```text
RPO memburuk.
```

Jika memilih standby yang tidak sehat:

```text
RTO memburuk.
```

---

## 10. Timeline dan Old Primary

Setelah failover, cluster PostgreSQL masuk timeline baru.

Simplifikasi:

```text
Timeline 1:
primary lama menghasilkan WAL sampai titik X

Failover:
standby dipromote pada titik X atau sebelum/sesudahnya tergantung lag

Timeline 2:
primary baru menghasilkan WAL baru
```

Old primary yang hidup kembali membawa data timeline lama. Ia harus:

- direinitialize dari primary baru, atau
- di-rewind jika memungkinkan, atau
- dibuang dan dibuat ulang.

Tidak boleh langsung dimasukkan kembali sebagai standby tanpa validasi timeline.

### 10.1 `pg_rewind`

`pg_rewind` dapat membantu menyinkronkan old primary agar mengikuti timeline baru jika kondisi tertentu terpenuhi.

Namun secara mental model:

```text
old primary setelah failover adalah node mencurigakan sampai dibuktikan aman.
```

Jangan perlakukan sebagai standby sehat hanya karena process bisa start.

---

## 11. Patroni Mental Model

Patroni adalah template/manager untuk membangun HA PostgreSQL dengan bantuan distributed configuration store seperti etcd, Consul, ZooKeeper, atau Kubernetes API.

Mental model Patroni:

```text
Patroni agent berjalan di setiap node PostgreSQL.
Setiap agent memantau PostgreSQL lokal.
Cluster state disimpan/ditentukan lewat DCS.
Hanya node dengan leadership lease valid yang boleh menjadi primary.
Jika leader gagal, Patroni memilih candidate standby dan melakukan promotion.
```

Arsitektur umum:

```text
           +-------------------+
           | etcd / Consul /   |
           | ZooKeeper / K8s   |
           +---------+---------+
                     |
        leadership / cluster state
                     |
+--------------------+--------------------+
|                    |                    |
| Patroni            | Patroni            | Patroni
| PostgreSQL primary | PostgreSQL standby | PostgreSQL standby
|                    |                    |
+--------------------+--------------------+
```

Patroni bukan “magic HA”. Ia mengorkestrasi primitives PostgreSQL dan menjaga state cluster dengan bantuan DCS.

### 11.1 Yang Harus Dipahami dari Patroni

Top-tier engineer harus memahami:

1. Apa yang dianggap leader.
2. Bagaimana leader lease diperbarui.
3. Kapan failover terjadi.
4. Bagaimana candidate dipilih.
5. Bagaimana replication lag mempengaruhi eligibility.
6. Bagaimana old primary ditangani.
7. Bagaimana routing layer tahu primary baru.
8. Bagaimana maintenance/switchover dilakukan.
9. Bagaimana backup dan WAL archiving tetap berjalan.
10. Bagaimana cluster diuji.

### 11.2 Failover vs Switchover

Failover:

```text
Primary gagal tidak terencana, standby dipromote.
```

Switchover:

```text
Primary sehat, role dipindahkan secara terencana.
```

Switchover lebih aman untuk:

- maintenance,
- patching,
- OS upgrade,
- testing runbook,
- validating application reconnection.

Jika tim tidak pernah melakukan switchover terencana, kemungkinan besar failover sungguhan akan mengejutkan.

---

## 12. repmgr, pg_auto_failover, dan Tooling Lain

Selain Patroni, ada opsi lain:

- repmgr,
- pg_auto_failover,
- cloud provider HA,
- Kubernetes operator,
- custom automation.

Yang penting bukan nama tool, tetapi invariant desain:

```text
1. Siapa yang memutuskan primary?
2. Bagaimana quorum dibuktikan?
3. Bagaimana old primary dicegah menulis?
4. Bagaimana routing berubah?
5. Bagaimana aplikasi reconnect?
6. Bagaimana failback dilakukan?
7. Bagaimana backup tetap konsisten?
```

Tool berbeda punya trade-off berbeda. Jangan memilih tool hanya karena populer.

---

## 13. Connection Routing Layer

Setelah failover, aplikasi harus terhubung ke primary baru.

Routing bisa dilakukan dengan:

1. DNS,
2. virtual IP,
3. HAProxy,
4. PgBouncer,
5. cloud endpoint,
6. driver multi-host connection string,
7. service discovery,
8. Kubernetes Service.

### 13.1 DNS

DNS sederhana, tetapi punya risiko:

- TTL tidak selalu dihormati sempurna,
- JVM DNS cache bisa memperpanjang stale endpoint,
- connection pool menyimpan connection lama,
- failover detection lambat,
- cache di OS/network layer.

Untuk Java, DNS failover harus memperhatikan:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

Namun mengandalkan DNS saja sering kurang deterministik.

### 13.2 Virtual IP

VIP bisa berpindah dari node lama ke node baru.

Kelebihan:

- endpoint aplikasi stabil,
- cepat di jaringan tertentu.

Risiko:

- tidak selalu cocok di cloud/Kubernetes,
- ARP/cache issue,
- butuh integrasi network,
- fencing tetap diperlukan.

### 13.3 HAProxy

HAProxy sering digunakan untuk mengarahkan koneksi:

- write endpoint ke current primary,
- read endpoint ke standby,
- health check role PostgreSQL,
- route update saat failover.

Contoh mental topology:

```text
Java services
    |
    v
+---------+
| HAProxy |
+----+----+
     |
     +-----------> current primary
     |
     +-----------> standbys for read-only endpoint
```

HAProxy harus tahu mana primary. Biasanya health check memanggil endpoint Patroni atau mengecek PostgreSQL role.

### 13.4 PgBouncer dalam HA

PgBouncer menyelesaikan masalah pooling, bukan otomatis menyelesaikan HA.

Pertanyaan penting:

- PgBouncer ada di app host atau database side?
- PgBouncer reconnect ke primary baru bagaimana?
- Saat failover, apakah client connection diputus?
- Apakah transaction pooling compatible dengan prepared statement/session state?
- Apakah migration tool melewati PgBouncer?

PgBouncer dapat membantu mengurangi connection storm setelah failover, tetapi bisa juga menyembunyikan error sampai terlambat jika tidak dikonfigurasi dengan benar.

---

## 14. Multi-host Connection String dan `target_session_attrs`

libpq dan beberapa driver/client mendukung multiple host dalam connection string. Konsepnya:

```text
Coba host A, host B, host C sampai menemukan server yang sesuai.
```

Dengan `target_session_attrs`, client bisa meminta atribut tertentu, misalnya koneksi harus ke primary/read-write server.

Mental model:

```text
host=pg1,pg2,pg3 target_session_attrs=read-write
```

Artinya client mencoba menemukan node yang menerima read-write.

Namun untuk Java pgJDBC, perlu cek parameter driver yang tersedia dan perilakunya. Jangan mengasumsikan semua fitur libpq identik di JDBC driver.

### 14.1 Kenapa Ini Tidak Menggantikan Cluster Manager

Multi-host connection string membantu aplikasi menemukan node, tetapi tidak menjawab:

- siapa yang promote,
- bagaimana fencing,
- bagaimana quorum,
- bagaimana backup,
- bagaimana old primary ditangani.

Jadi ini routing aid, bukan HA architecture lengkap.

---

## 15. Read/Write Splitting

Banyak sistem ingin:

```text
write -> primary
read  -> standby
```

Tampak sederhana, tetapi correctness-nya rumit.

### 15.1 Problem: Read-after-write

Flow:

```text
1. User update case status ke APPROVED di primary.
2. Response sukses.
3. UI reload membaca dari replica.
4. Replica masih lag.
5. UI melihat status lama: PENDING.
```

Dari perspektif user dan audit workflow, ini bisa terlihat seperti bug.

### 15.2 Strategi Mengatasi

Opsi:

1. Semua read kritis ke primary.
2. Setelah write, session/user diarahkan sementara ke primary.
3. Gunakan lag-aware routing.
4. Gunakan LSN tracking.
5. Read replica hanya untuk report/analytics yang tolerate stale data.
6. Pisahkan endpoint read model yang secara eksplisit eventual.

Untuk sistem regulatory/case management, read staleness harus menjadi bagian dari kontrak domain, bukan detail infrastruktur.

---

## 16. Synchronous Replication dan RPO

Jika asynchronous replication:

```text
primary bisa commit sebelum standby menerima WAL
```

Jika primary hilang sebelum WAL terkirim:

```text
transaksi committed di primary bisa hilang setelah failover
```

Ini RPO > 0.

Synchronous replication mengurangi risiko ini dengan membuat primary menunggu acknowledgement dari standby tertentu.

Trade-off:

| Mode | Availability | Write latency | Data loss risk |
|---|---:|---:|---:|
| Async | lebih tinggi | lebih rendah | lebih tinggi |
| Sync | lebih rendah jika standby bermasalah | lebih tinggi | lebih rendah |

### 16.1 Synchronous Commit Tidak Sama dengan Semua Data Aman Selamanya

Synchronous replication tetap perlu dipahami bersama:

- level acknowledgement,
- quorum setting,
- lokasi standby,
- behavior saat standby down,
- failover candidate selection,
- application timeout.

Jika synchronous standby berada di region jauh:

```text
write latency naik.
```

Jika synchronous standby down dan tidak ada fallback:

```text
write availability turun.
```

---

## 17. HAProxy + Patroni Pattern

Pattern umum self-managed:

```text
                +-------------------+
                | etcd / Consul     |
                +---------+---------+
                          |
+-------------------------+-------------------------+
|                         |                         |
| Patroni + PostgreSQL    | Patroni + PostgreSQL    | Patroni + PostgreSQL
| node-1                  | node-2                  | node-3
|                         |                         |
+------------+------------+------------+------------+
             |                         |
             v                         v
        +---------+              +---------+
        | HAProxy |              | HAProxy |
        +----+----+              +----+----+
             |                        |
             +----------+-------------+
                        |
                 Java services
```

Routing endpoints:

```text
postgres-write.example.internal -> current primary
postgres-read.example.internal  -> healthy replicas
```

Health check:

- write endpoint only passes for leader/primary,
- read endpoint passes for replicas under lag threshold,
- unhealthy or lagged replicas removed.

### 17.1 Failure Flow

```text
1. Primary node fails.
2. Patroni agent cannot renew leadership.
3. DCS confirms lease expired/quorum.
4. Standby candidate promoted.
5. HAProxy health check detects new primary.
6. Old connections fail.
7. Java pool discards broken connections.
8. New connections go to new primary.
9. App retries safe operations.
10. Old primary reinitialized/rewound before rejoin.
```

Setiap langkah bisa gagal. Karena itu runbook harus eksplisit.

---

## 18. Java Application Behavior During Failover

Dari sisi Java, failover biasanya tampak sebagai kombinasi error:

- connection reset,
- timeout,
- SQL transient connection exception,
- read-only transaction error,
- serialization/retryable error,
- broken pipe,
- server closed connection unexpectedly,
- connection refused,
- statement canceled,
- ambiguous commit result.

Aplikasi harus membedakan:

```text
safe to retry
```

vs

```text
unsafe to retry blindly
```

### 18.1 Ambiguous Commit

Kasus penting:

```text
1. App mengirim COMMIT.
2. PostgreSQL berhasil commit.
3. Network putus sebelum app menerima response.
4. App tidak tahu apakah commit berhasil.
```

Jika app retry operasi tanpa idempotency:

```text
duplicate side effect bisa terjadi.
```

Solusi:

- idempotency key,
- unique constraint,
- outbox pattern,
- deterministic operation ID,
- read-after-error check,
- business operation table.

### 18.2 Retry Rule

Retry boleh jika operasi:

1. idempotent,
2. guarded by unique constraint,
3. has operation ID,
4. can safely detect prior success,
5. does not duplicate irreversible external side effect.

Retry berbahaya jika:

1. menghasilkan nomor baru tiap percobaan,
2. mengirim email/payment/external call di tengah transaction,
3. tidak punya idempotency key,
4. insert audit duplicate tidak dikontrol,
5. workflow transition tidak dicek state sebelumnya.

---

## 19. HikariCP dan Failover

HikariCP tidak membuat database HA, tetapi harus dikonfigurasi agar tidak memperburuk failover.

Pertimbangan:

- connection timeout,
- validation timeout,
- max lifetime,
- keepalive time,
- leak detection,
- pool size,
- initialization fail timeout,
- exception override/adjudication jika perlu,
- fast failure saat DB down.

### 19.1 Anti-pattern

```text
Pool terlalu besar + failover = connection storm ke primary baru.
```

Jika 100 service instance masing-masing punya pool 50:

```text
5000 koneksi mencoba reconnect bersamaan.
```

Primary baru baru saja promoted dan sedang recovery pressure. Connection storm bisa membuat RTO jauh lebih buruk.

### 19.2 Pattern Lebih Aman

1. Pool size realistis.
2. PgBouncer bila connection count besar.
3. Retry dengan jitter.
4. Circuit breaker di service layer.
5. Short connection timeout.
6. Backoff saat database unavailable.
7. Health check aplikasi tidak melakukan query berat.
8. Startup tidak membuat semua instance reconnect serentak.

---

## 20. HA dan Migration Tool

Migration saat HA punya risiko khusus.

Pertanyaan:

1. Migration diarahkan ke primary yang benar?
2. Apa yang terjadi jika failover terjadi di tengah migration?
3. Apakah migration idempotent?
4. Apakah lock timeout diset?
5. Apakah DDL transactional?
6. Apakah schema version table konsisten?
7. Apakah migration tool retry otomatis?
8. Apakah migration boleh berjalan di multiple service instance?

### 20.1 Flyway/Liquibase Guardrail

Untuk sistem HA:

- pastikan hanya satu migrator aktif,
- migration endpoint harus ke primary,
- set `lock_timeout`,
- set `statement_timeout`,
- migration besar harus expand-contract,
- hindari long transaction,
- jangan jalankan destructive migration otomatis saat startup semua service.

Jika failover terjadi saat migration:

```text
migration status bisa ambiguous.
```

Maka migration harus bisa diverifikasi manual:

- apakah DDL sudah apply,
- apakah schema history update,
- apakah index concurrent valid,
- apakah constraint valid,
- apakah backfill selesai.

---

## 21. Backup Layer dalam HA Architecture

HA tidak menggantikan backup.

Replica bukan backup karena:

```text
DELETE salah di primary akan direplikasi ke standby.
```

Bad migration juga akan direplikasi.

Corrupt application behavior juga akan direplikasi.

Backup menjawab failure class berbeda:

| Failure | Replica membantu? | Backup/PITR membantu? |
|---|---:|---:|
| Primary host mati | Ya | Tidak utama |
| Accidental DELETE | Tidak | Ya |
| Bad migration | Tidak | Ya |
| Region loss | Tergantung | Ya jika offsite |
| Data corruption logical | Tidak selalu | Ya jika diketahui waktu sehat |
| Ransomware/operator error | Tidak cukup | Ya jika isolated backup |

### 21.1 pgBackRest Mental Model

pgBackRest adalah tool backup/restore PostgreSQL yang umum dipakai untuk:

- full backup,
- differential backup,
- incremental backup,
- WAL archiving,
- restore,
- PITR,
- backup repository management.

Dalam HA architecture, pgBackRest biasanya berada sebagai recovery backbone:

```text
PostgreSQL primary/standby
        |
        | WAL archive + base backup
        v
pgBackRest repository
        |
        v
restore / PITR / new standby bootstrap
```

### 21.2 Backup Invariant

```text
Backup dianggap tidak ada sampai restore berhasil diuji.
```

High availability tanpa restore drill adalah kepercayaan, bukan evidence.

---

## 22. WAL Archiving dan HA

WAL archiving penting untuk:

- PITR,
- rebuilding standby,
- recovering gap,
- forensic reconstruction,
- disaster recovery.

Jika WAL archive rusak:

```text
backup chain bisa tidak bisa dipakai untuk PITR.
```

Monitor:

- archive success/failure,
- oldest required WAL,
- repository size,
- replication slot retention,
- disk usage,
- backup age,
- restore test age.

### 22.1 Disk Full karena WAL

Skenario produksi:

```text
1. Replication slot menahan WAL.
2. Standby mati atau lag lama.
3. WAL tidak bisa dibuang.
4. Disk primary penuh.
5. Primary berhenti menerima write.
```

HA yang tidak memonitor WAL retention bisa gagal karena mekanisme yang dimaksudkan untuk menjaga replica malah memenuhi disk primary.

---

## 23. Cloud-managed PostgreSQL

Cloud-managed PostgreSQL seperti Amazon RDS PostgreSQL, Aurora PostgreSQL, Google Cloud SQL for PostgreSQL, Azure Database for PostgreSQL, dan layanan sejenis menyediakan banyak komponen HA secara terkelola.

Keuntungan:

- failover managed,
- backup managed,
- monitoring baseline,
- patching lebih mudah,
- snapshot/PITR terintegrasi,
- replicas lebih mudah dibuat,
- storage management lebih sederhana.

Namun managed bukan berarti bebas desain.

### 23.1 Pertanyaan yang Tetap Harus Dijawab

1. Apa RTO failover aktual?
2. Apa RPO aktual?
3. Failover otomatis atau manual?
4. Endpoint berubah atau tetap?
5. Connection pool harus reconnect bagaimana?
6. Apakah read replica bisa stale?
7. Bagaimana PITR dilakukan?
8. Backup disimpan berapa lama?
9. Apakah backup cross-region?
10. Apakah major upgrade butuh downtime?
11. Apakah extension yang dibutuhkan didukung?
12. Bagaimana maintenance window mempengaruhi app?
13. Bagaimana audit log database diakses?
14. Apa batasan parameter tuning?
15. Bagaimana test failover dilakukan?

### 23.2 Aurora PostgreSQL

Aurora PostgreSQL punya storage/replication architecture berbeda dari vanilla self-managed PostgreSQL. Karena itu jangan menerapkan runbook Patroni/physical replica secara mentah ke Aurora.

Yang harus dipelajari dari provider:

- failover behavior,
- cluster endpoint vs instance endpoint,
- reader endpoint,
- replica lag semantics,
- parameter group,
- backup/PITR,
- failover priority,
- maintenance behavior.

### 23.3 Cloud SQL / Azure Flexible Server / RDS

Setiap provider punya HA mechanism berbeda. Namun mental model tetap sama:

```text
Endpoint stable tidak berarti transaction tidak pernah gagal.
Managed failover tidak berarti aplikasi bebas retry/idempotency.
Replica tidak berarti read-after-write aman.
Snapshot tidak berarti restore drill tidak perlu.
```

---

## 24. Kubernetes dan PostgreSQL HA

Menjalankan PostgreSQL HA di Kubernetes perlu kehati-hatian.

Kubernetes bagus untuk stateless workload, tetapi PostgreSQL adalah stateful system dengan:

- disk identity,
- WAL continuity,
- network identity,
- fencing requirement,
- backup lifecycle,
- ordered recovery,
- topology awareness.

Operator PostgreSQL dapat membantu, tetapi operator bukan pengganti pemahaman.

Pertanyaan:

1. Bagaimana PVC berpindah?
2. Bagaimana node failure dideteksi?
3. Bagaimana fencing dilakukan?
4. Bagaimana backup diuji?
5. Bagaimana anti-affinity diatur?
6. Bagaimana DCS/lease bekerja?
7. Bagaimana service mengarah ke primary?
8. Bagaimana standby bootstrap?
9. Bagaimana rolling upgrade?
10. Bagaimana resource limit mempengaruhi PostgreSQL?

### 24.1 Anti-pattern Kubernetes

```text
Menjalankan satu StatefulSet PostgreSQL replica count=3 lalu menganggap itu HA database.
```

PostgreSQL node tidak otomatis membentuk HA cluster hanya karena ada tiga pod.

---

## 25. Designing HA for Different Workloads

### 25.1 Internal Admin Tool

Karakteristik:

- write rendah,
- downtime beberapa menit bisa diterima,
- data loss kecil mungkin tidak diterima.

Desain mungkin cukup:

- managed PostgreSQL with HA,
- PITR enabled,
- daily restore test,
- app retry sederhana,
- no read splitting.

### 25.2 Regulatory Case Management

Karakteristik:

- correctness tinggi,
- audit penting,
- workflow state transition sensitif,
- read-after-write sering penting,
- data loss sulit diterima.

Desain:

- primary endpoint kuat,
- idempotency key,
- outbox,
- audit table dengan constraint,
- read kritis ke primary,
- replicas untuk reporting terpisah,
- PITR diuji,
- failover drill,
- migration controlled,
- strong observability.

### 25.3 High-throughput Event Ingestion

Karakteristik:

- write tinggi,
- duplicate mungkin bisa deduplicate,
- latency penting,
- batch/COPY mungkin digunakan.

Desain:

- async replication mungkin diterima,
- idempotent event ID,
- partitioning,
- WAL/disk monitoring,
- replica lag alert,
- backpressure,
- separate ingestion pool.

### 25.4 Financial-like Transaction System

Karakteristik:

- RPO sangat kecil/0,
- duplicate side effect tidak boleh,
- commit ambiguity harus ditangani.

Desain:

- synchronous replication dipertimbangkan,
- idempotency wajib,
- ledger invariant di database,
- retry sangat hati-hati,
- external side effect via outbox,
- audit immutable,
- failover tested.

---

## 26. RPO/RTO Trade-off Matrix

| Desain | RPO | RTO | Complexity | Notes |
|---|---:|---:|---:|---|
| Single primary + backup | tinggi | tinggi | rendah | cocok dev/small internal |
| Primary + async standby manual failover | detik-menit | menit-jam | sedang | butuh runbook kuat |
| Primary + async standby automatic failover | detik | detik-menit | tinggi | split brain risk harus dikontrol |
| Primary + sync standby automatic failover | rendah/0-ish | detik-menit | tinggi | write latency/availability trade-off |
| Managed HA PostgreSQL | provider-dependent | provider-dependent | sedang | tetap butuh app correctness |
| Multi-region active/passive | rendah-menengah | menit | tinggi | network/lag/cost trade-off |
| Multi-region active/active | sangat kompleks | kompleks | sangat tinggi | PostgreSQL core bukan simple multi-writer DB |

Catatan: “0-ish” sengaja dipakai karena RPO real harus dilihat dari konfigurasi synchronous replication, acknowledgement level, failover tooling, dan failure scenario.

---

## 27. Active-Active: Hati-hati dengan Fantasi Multi-writer

Banyak organisasi ingin:

```text
Dua region sama-sama bisa write.
Jika satu mati, region lain tetap jalan.
```

Ini terdengar ideal, tetapi sulit untuk relational database dengan invariant kuat.

Masalah:

- conflict resolution,
- global uniqueness,
- ordering,
- foreign key across regions,
- transaction isolation,
- sequence generation,
- audit ordering,
- regulatory traceability,
- split brain,
- latency antar region.

PostgreSQL core tidak menyediakan synchronous transparent multi-primary relational database yang sederhana.

Untuk sebagian sistem, solusi lebih realistis:

1. active/passive,
2. region-local read replica,
3. async event replication,
4. domain partitioning by region/tenant,
5. conflict-free subset,
6. queue-based reconciliation,
7. explicit ownership model.

Top-tier engineer tidak menjual active-active sebagai buzzword. Mereka mendefinisikan invariant dan conflict semantics terlebih dahulu.

---

## 28. Application-level Resilience Pattern

Database HA harus dipasangkan dengan resilience di aplikasi.

### 28.1 Idempotency Table

Contoh:

```sql
CREATE TABLE idempotency_keys (
    operation_key text PRIMARY KEY,
    operation_type text NOT NULL,
    request_hash text NOT NULL,
    status text NOT NULL,
    result_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

Saat retry setelah failover:

- jika operation key sudah sukses, return result lama,
- jika sedang diproses, reject/continue sesuai policy,
- jika request hash berbeda, reject sebagai conflict.

### 28.2 Outbox Pattern

External side effect tidak dilakukan langsung di tengah transaction domain.

```text
Transaction:
  update domain state
  insert outbox event
  commit

Async worker:
  read outbox
  send external side effect
  mark sent
```

Dengan ini, jika failover terjadi:

- domain state dan outbox tetap atomic,
- worker bisa retry,
- duplicate bisa dikontrol dengan event ID.

### 28.3 Operation State Machine

Untuk workflow kritis:

```text
REQUESTED -> PROCESSING -> SUCCEEDED
                     └──> FAILED_RETRYABLE
                     └──> FAILED_FINAL
```

State machine membuat recovery setelah failover lebih mudah karena sistem tahu operasi berada di fase apa.

---

## 29. Observability untuk HA

Minimal metrics:

### Database Role

- current primary,
- standby list,
- recovery mode,
- timeline,
- promotion timestamp,
- last failover timestamp.

### Replication

- replication lag bytes/time,
- replay lag,
- write/flush/replay LSN,
- replication slot retained WAL,
- standby connection status.

### WAL/Backup

- last successful archive,
- archive failures,
- last backup age,
- backup repository size,
- restore test age,
- WAL disk usage.

### Routing

- HAProxy backend status,
- failed health checks,
- current write target,
- read target lag threshold.

### Application

- connection acquisition latency,
- pool active/idle/pending,
- SQL transient errors,
- retry count,
- idempotency conflict count,
- request error rate,
- p95/p99 latency during failover.

### DCS/Cluster Manager

- leader lease status,
- DCS quorum health,
- Patroni member status,
- failover candidate state,
- last switchover/failover event.

---

## 30. Alert Design

Bad alert:

```text
PostgreSQL is down.
```

Better alerts:

```text
Primary unavailable for > 15s.
```

```text
No healthy write endpoint in HAProxy.
```

```text
Replication lag on synchronous candidate exceeds threshold.
```

```text
WAL archive failed for > 5 minutes.
```

```text
Replication slot retained WAL > 70% disk budget.
```

```text
Backup age > RPO policy.
```

```text
Restore drill older than 30 days.
```

```text
Application DB pool pending threads > threshold after failover.
```

Alert harus action-oriented. Jika alert tidak punya runbook, alert itu hanya noise.

---

## 31. Failover Testing

HA yang tidak pernah diuji adalah asumsi.

Test scenarios:

1. PostgreSQL process killed.
2. Host reboot.
3. Network partition primary from DCS.
4. Network partition app from primary.
5. Standby lagged then primary fails.
6. Disk full due to WAL.
7. HAProxy restart.
8. DCS node failure.
9. DCS quorum loss.
10. Failover during write load.
11. Failover during migration.
12. Failover during backup.
13. Old primary returns.
14. Read replica stale during UI reload.
15. Java pool reconnect storm.

### 31.1 Apa yang Diukur

- actual RTO,
- actual data loss/RPO,
- number of failed requests,
- number of ambiguous commits,
- application recovery time,
- connection pool stabilization time,
- replication catch-up time,
- alert firing correctness,
- runbook clarity,
- operator decision time.

---

## 32. Runbook Failover

Contoh runbook tingkat tinggi:

```text
1. Confirm incident scope.
   - Is primary unreachable from all observers or only app?
   - Is DCS healthy?
   - Is standby healthy?

2. Check current cluster state.
   - current leader
   - replicas
   - lag
   - WAL archive status

3. If automatic failover occurred:
   - identify new primary
   - confirm old primary fenced
   - confirm write endpoint points to new primary
   - confirm app reconnecting

4. If manual failover needed:
   - choose candidate
   - verify lag
   - stop/fence old primary if possible
   - promote candidate
   - update routing
   - monitor app recovery

5. Post-failover validation.
   - write test
   - read-after-write test
   - replication to remaining standbys
   - backup/WAL archiving
   - critical business transaction validation

6. Old primary handling.
   - do not rejoin blindly
   - rewind or reinitialize
   - verify timeline

7. Incident record.
   - timeline
   - data loss assessment
   - failed/ambiguous operations
   - user impact
   - follow-up actions
```

---

## 33. Runbook Switchover

Switchover should be routine.

```text
1. Announce maintenance window if needed.
2. Check replicas healthy and low lag.
3. Pause risky jobs/migrations.
4. Perform controlled switchover.
5. Confirm new primary.
6. Confirm app reconnect.
7. Confirm old primary becomes standby.
8. Run smoke tests.
9. Resume jobs.
10. Record metrics.
```

Switchover is a safer way to test:

- routing,
- pool reconnect,
- Patroni behavior,
- HAProxy checks,
- backup continuity,
- application retry.

---

## 34. HA Design Review Checklist

Gunakan checklist ini saat mereview arsitektur PostgreSQL production.

### 34.1 Cluster

- [ ] Ada primary dan minimal satu standby.
- [ ] Standby lag dimonitor.
- [ ] Timeline/failover behavior dipahami.
- [ ] Old primary rejoin procedure jelas.
- [ ] Promotion candidate policy jelas.

### 34.2 Consensus/Fencing

- [ ] Ada cluster manager atau manual runbook eksplisit.
- [ ] Jika otomatis, ada DCS/quorum.
- [ ] Split brain prevention jelas.
- [ ] Fencing strategy jelas.
- [ ] DCS sendiri highly available.

### 34.3 Routing

- [ ] Write endpoint selalu ke primary.
- [ ] Read endpoint policy jelas.
- [ ] Health check membedakan primary/replica.
- [ ] Failover routing diuji.
- [ ] JVM/DNS/pool behavior dipahami.

### 34.4 Application

- [ ] Retry hanya untuk operasi aman.
- [ ] Idempotency key untuk operasi kritis.
- [ ] Outbox untuk external side effect.
- [ ] Connection pool tidak terlalu besar.
- [ ] Backoff/jitter ada.
- [ ] Ambiguous commit ditangani.

### 34.5 Backup/Recovery

- [ ] Backup terjadwal.
- [ ] WAL archiving aktif.
- [ ] PITR diuji.
- [ ] Restore drill berkala.
- [ ] Backup terenkripsi dan aksesnya dikontrol.
- [ ] Backup repository tidak satu nasib dengan primary.

### 34.6 Operations

- [ ] Failover drill dilakukan.
- [ ] Switchover drill dilakukan.
- [ ] Runbook jelas.
- [ ] Alert action-oriented.
- [ ] Maintenance/upgrade process ada.
- [ ] Incident review dilakukan setelah drill/kejadian.

---

## 35. Anti-pattern Besar

### 35.1 “Replica adalah Backup”

Salah. Replica mereplikasi kesalahan logical.

### 35.2 “HA Tool Membuat App Aman”

Salah. App tetap butuh retry/idempotency/timeout.

### 35.3 “DNS Failover Saja Cukup”

Kadang cukup untuk sistem sederhana, tapi sering bermasalah karena caching dan pool.

### 35.4 “Automatic Failover Selalu Lebih Baik”

Tidak selalu. Automatic failover tanpa fencing bisa menyebabkan split brain.

### 35.5 “Read Replica Bisa Dipakai untuk Semua Read”

Tidak jika read-after-write penting.

### 35.6 “Managed PostgreSQL Menghilangkan Kebutuhan Runbook”

Salah. Managed mengurangi sebagian beban, bukan menghapus tanggung jawab desain aplikasi.

### 35.7 “RPO 0 Tinggal Aktifkan Sync Replication”

Terlalu sederhana. Harus diuji dengan failure scenario nyata.

---

## 36. Case Study: Failover pada Sistem Case Management

Misal ada sistem enforcement lifecycle:

```text
Case -> Review -> Investigation -> Enforcement Action -> Appeal -> Closed
```

Tabel penting:

- `cases`,
- `case_transitions`,
- `case_assignments`,
- `case_notes`,
- `audit_events`,
- `outbox_events`,
- `idempotency_keys`.

### 36.1 Risiko Saat Failover

1. User submit transition `UNDER_REVIEW -> APPROVED`.
2. App mengirim commit.
3. Failover terjadi.
4. App tidak menerima response.
5. User klik submit lagi.
6. Tanpa idempotency, transition bisa duplicate.
7. Tanpa unique constraint, audit bisa duplicate.
8. Tanpa conditional state update, state bisa lompat.

### 36.2 Desain Lebih Aman

```sql
CREATE TABLE case_transition_requests (
    request_id uuid PRIMARY KEY,
    case_id uuid NOT NULL,
    from_state text NOT NULL,
    to_state text NOT NULL,
    requested_by uuid NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Transition dilakukan dengan:

```sql
UPDATE cases
SET state = :to_state,
    updated_at = now()
WHERE id = :case_id
  AND state = :from_state;
```

Lalu:

- insert audit event dengan deterministic event ID,
- insert outbox event,
- commit,
- retry berdasarkan `request_id`.

Jika failover terjadi, aplikasi bisa query `case_transition_requests` atau audit/event state untuk mengetahui apakah request sebelumnya berhasil.

---

## 37. Case Study: Connection Storm Setelah Failover

Situasi:

```text
- 80 Java service instances
- masing-masing Hikari maxPoolSize = 50
- PostgreSQL max_connections = 1000
- primary failover
- semua service reconnect bersamaan
```

Potensi koneksi:

```text
80 * 50 = 4000
```

Primary baru hanya mampu menerima 1000 connection. Akibat:

- connection refused,
- pool pending naik,
- app timeout,
- health check gagal,
- orchestrator restart pods,
- restart memperparah storm.

Solusi:

1. pool size realistis,
2. PgBouncer,
3. startup jitter,
4. retry backoff,
5. circuit breaker,
6. health check yang tidak agresif,
7. autoscaler tidak bereaksi berlebihan saat database incident.

---

## 38. Case Study: Read Replica Stale Menyebabkan Keputusan Salah

Situasi:

```text
1. Investigator menambahkan evidence baru.
2. Write sukses di primary.
3. Supervisor membuka case detail.
4. Read diarahkan ke replica yang lag 20 detik.
5. Evidence belum terlihat.
6. Supervisor mengambil keputusan berdasarkan data lama.
```

Ini bukan sekadar UI inconsistency. Ini correctness dan audit risk.

Solusi:

- read kritis ke primary,
- replica hanya untuk report non-kritis,
- explicit stale data indicator,
- LSN-aware read routing,
- workflow decision screen tidak memakai eventual replica.

---

## 39. What Good Looks Like

Arsitektur PostgreSQL HA yang matang memiliki ciri:

1. RPO/RTO tertulis dan diuji.
2. Failover bukan kejadian misterius.
3. Split brain prevention jelas.
4. Aplikasi punya idempotency dan retry policy.
5. Connection pool size masuk akal.
6. Routing endpoint jelas untuk read/write.
7. Replica lag dimonitor dan dipakai dalam routing policy.
8. Backup dan PITR diuji.
9. WAL archiving dimonitor.
10. Migration aman terhadap failover.
11. Switchover rutin dilakukan.
12. Old primary handling terdokumentasi.
13. Incident drill menghasilkan improvement.

---

## 40. Ringkasan Mental Model

High availability PostgreSQL bukan satu fitur. Ia adalah gabungan:

```text
replication
+ leader election
+ fencing
+ promotion
+ routing
+ application retry
+ idempotency
+ backup/PITR
+ observability
+ runbook
+ testing
```

Replication membuat standby punya data.

Cluster manager memutuskan siapa primary.

DCS/quorum mencegah dua primary.

Fencing mencegah old primary menulis.

Routing membawa aplikasi ke primary baru.

Aplikasi menangani error, retry, dan ambiguous commit.

Backup/PITR menyelamatkan dari logical corruption.

Observability memberi evidence.

Runbook dan drill membuktikan desain bekerja.

---

## 41. Pertanyaan Interview/Review untuk Top-tier Engineer

Kamu harus bisa menjawab pertanyaan berikut:

1. Apa perbedaan replication dan HA?
2. Apa invariant utama untuk mencegah split brain?
3. Bagaimana leader election bekerja di desainmu?
4. Apa yang terjadi jika primary network-isolated tetapi masih hidup?
5. Bagaimana aplikasi menemukan primary baru?
6. Apa yang terjadi pada connection pool saat failover?
7. Apa strategi retry untuk ambiguous commit?
8. Bagaimana kamu memastikan external side effect tidak duplicate?
9. Apa RPO/RTO desainmu dan bagaimana membuktikannya?
10. Bagaimana backup berbeda dari replica?
11. Bagaimana restore drill dilakukan?
12. Bagaimana old primary direjoin?
13. Bagaimana read-after-write consistency dijaga?
14. Kapan synchronous replication diperlukan?
15. Apa risiko synchronous replication terhadap availability?
16. Apa yang terjadi jika DCS kehilangan quorum?
17. Bagaimana migration berjalan aman saat HA?
18. Bagaimana kamu menguji failover tanpa menunggu bencana?

---

## 42. Latihan Praktis

### Latihan 1 — Desain Topology

Buat desain PostgreSQL HA untuk:

```text
- 3 node PostgreSQL
- 3 node etcd
- Patroni
- HAProxy
- Java services dengan HikariCP
- pgBackRest repository
```

Tuliskan:

- write endpoint,
- read endpoint,
- failover flow,
- backup flow,
- old primary recovery flow,
- alert utama.

### Latihan 2 — Failure Scenario

Simulasikan secara konseptual:

```text
Primary network-isolated dari DCS tetapi masih bisa menerima koneksi dari sebagian aplikasi.
```

Jawab:

- apakah failover boleh terjadi?
- bagaimana fencing dilakukan?
- bagaimana mencegah split brain?
- bagaimana aplikasi yang masih terkoneksi ke old primary diputus?

### Latihan 3 — Retry Policy

Ambil satu operasi domain:

```text
approve enforcement case
```

Desain:

- idempotency key,
- conditional update,
- audit event,
- outbox event,
- behavior saat commit ambiguous.

### Latihan 4 — RPO/RTO

Untuk tiga workload:

1. internal admin,
2. audit-heavy case management,
3. event ingestion,

pilih:

- async atau sync replication,
- automatic atau manual failover,
- read replica usage,
- backup frequency,
- restore drill frequency.

---

## 43. Kesimpulan Part 028

Bagian ini membangun mental model bahwa PostgreSQL HA bukan hanya “ada standby”. HA adalah desain distributed system yang harus menjaga satu invariant utama:

```text
hanya satu writer yang sah pada satu waktu
```

Namun menjaga invariant itu harus diseimbangkan dengan:

- RTO,
- RPO,
- latency,
- operational complexity,
- application retry,
- backup/PITR,
- observability,
- runbook maturity.

Untuk Java engineer, pelajaran paling penting:

```text
Database failover selalu terlihat di aplikasi.
```

Walaupun endpoint managed, HAProxy, Patroni, atau cloud provider menyembunyikan banyak detail, aplikasi tetap harus siap menghadapi:

- broken connection,
- transient failure,
- ambiguous commit,
- stale reads,
- duplicate retry,
- connection storm.

Maka PostgreSQL HA yang kuat selalu merupakan kerja sama antara:

```text
DB architecture + infrastructure + application correctness design
```

---

## 44. Status Seri

Selesai:

```text
Part 028 — High Availability Architecture: Patroni, pgBackRest, HAProxy, dan Cloud-managed PostgreSQL
```

Seri belum selesai.

Berikutnya:

```text
Part 029 — Security: Roles, Privileges, RLS, TLS, Secrets, dan Auditability
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Replication: Streaming, Logical, Slots, Lag, dan Failover Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-029.md">Part 029 — Security: Roles, Privileges, RLS, TLS, Secrets, dan Auditability ➡️</a>
</div>
