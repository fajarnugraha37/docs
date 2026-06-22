# learn-mysql-mastery-for-java-engineers-part-022.md

# Part 022 — High Availability: Failover, Topologies, and Failure Modes

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `022 / 034`  
> Topik: High Availability, Failover, Replication Topology, MySQL Router/Proxy, Failure Modes, RTO/RPO, dan perilaku aplikasi Java saat primary berubah.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas replication lag, read/write splitting, dan consistency boundary. Bagian ini naik satu level: **bagaimana membuat MySQL tetap melayani sistem ketika node, network, storage, atau proses database gagal**.

Target bagian ini bukan membuat kamu hafal nama produk HA, tetapi membuat kamu mampu menjawab pertanyaan desain seperti:

1. Kalau primary mati, siapa yang boleh menjadi primary baru?
2. Bagaimana memastikan primary lama tidak hidup kembali dan menerima write secara diam-diam?
3. Apa yang terjadi pada transaksi yang sudah `COMMIT` dari sudut pandang aplikasi, tetapi belum aman di replica?
4. Apakah failover otomatis selalu lebih baik daripada manual?
5. Apakah read/write splitting aman selama failover?
6. Bagaimana Java service seharusnya bereaksi terhadap koneksi putus, transient error, duplicate execution, dan uncertain commit?
7. Apa beda high availability, disaster recovery, durability, dan consistency?

Setelah menyelesaikan bagian ini, kamu seharusnya bisa membaca arsitektur MySQL production dan langsung melihat:

- titik single point of failure,
- kemungkinan data loss,
- kemungkinan split brain,
- kemungkinan stale read,
- jalur failover,
- dependency pada operator manusia,
- dan kontrak yang harus dipenuhi aplikasi.

---

## 1. Mental Model: HA Bukan “Database Tidak Pernah Mati”

High availability sering disalahpahami sebagai:

> “Kalau primary mati, otomatis pindah ke replica dan semua baik-baik saja.”

Itu terlalu sederhana.

HA yang benar adalah kemampuan sistem untuk tetap menyediakan layanan dalam batas tertentu ketika terjadi failure. Kata pentingnya adalah **dalam batas tertentu**.

HA selalu memiliki trade-off:

| Dimensi | Pertanyaan |
|---|---|
| Availability | Berapa lama service boleh tidak tersedia? |
| Durability | Apakah transaksi committed boleh hilang? |
| Consistency | Apakah user boleh melihat state lama? |
| Correctness | Apakah boleh ada dua primary menerima write? |
| Operability | Siapa yang melakukan failover? Otomatis atau manual? |
| Complexity | Apakah sistem HA lebih rumit daripada failure yang ingin dicegah? |
| Cost | Berapa node, storage, network, observability, dan skill operasional yang dibutuhkan? |

Jadi, HA bukan hanya topologi. HA adalah **kontrak perilaku saat gagal**.

---

## 2. Istilah Fundamental

### 2.1 Primary

Primary adalah node yang menerima write utama.

Dalam topologi single-primary:

- aplikasi write ke primary,
- replica menerima perubahan melalui replication,
- sebagian read bisa diarahkan ke replica jika consistency boundary mengizinkan.

### 2.2 Replica

Replica adalah node yang menerima event perubahan dari primary dan menerapkannya.

Replica bisa dipakai untuk:

- high availability candidate,
- read scaling,
- reporting,
- backup offload,
- delayed recovery,
- migration rehearsal.

Namun replica bukan otomatis aman untuk semua kebutuhan. Replica dapat:

- lag,
- berhenti apply event,
- corrupt secara logical,
- berbeda konfigurasi,
- kehilangan binary log position,
- tidak memiliki data terbaru.

### 2.3 Failover

Failover adalah perpindahan layanan dari primary lama ke primary baru karena primary lama dianggap gagal.

Failover bisa:

- manual,
- semi-otomatis,
- otomatis.

Failover bukan hanya `promote replica`. Failover minimal membutuhkan:

1. mendeteksi primary gagal,
2. memilih replica kandidat,
3. memastikan kandidat cukup up-to-date,
4. mencegah primary lama menerima write,
5. mempromosikan kandidat,
6. mengalihkan traffic aplikasi,
7. mengonfigurasi ulang replica lain,
8. memvalidasi health,
9. menormalisasi topologi.

### 2.4 Switchover

Switchover adalah perpindahan primary secara terencana.

Contoh:

- maintenance OS,
- upgrade MySQL,
- pindah AZ,
- test runbook,
- mengurangi risk sebelum maintenance besar.

Switchover biasanya lebih aman daripada failover karena primary lama masih hidup dan bisa dikoordinasikan.

### 2.5 Split Brain

Split brain terjadi ketika dua node sama-sama percaya dirinya primary dan menerima write.

Ini salah satu failure mode paling berbahaya karena hasilnya bukan sekadar downtime, tetapi **data divergence**.

Contoh:

```text
T0: primary A menerima write
T1: network partition antara A dan orchestrator
T2: orchestrator mengira A mati
T3: replica B dipromosikan menjadi primary
T4: aplikasi sebagian masih write ke A, sebagian ke B
T5: dua sejarah data berbeda terbentuk
```

Setelah split brain, recovery bisa sangat sulit karena tidak selalu jelas write mana yang “benar”.

### 2.6 Fencing

Fencing adalah tindakan memastikan node lama tidak bisa lagi melakukan write setelah failover.

Bentuk fencing:

- mematikan proses MySQL lama,
- memblokir network,
- mencabut VIP,
- mengubah security group,
- memutus storage,
- membuat node read-only,
- isolasi melalui orchestrator/cloud control plane.

Tanpa fencing, failover otomatis dapat menciptakan split brain.

### 2.7 RTO dan RPO

**RTO — Recovery Time Objective**  
Berapa lama sistem boleh tidak tersedia.

Contoh:

- RTO 30 detik: service harus pulih dalam 30 detik.
- RTO 15 menit: operator manual masih mungkin.

**RPO — Recovery Point Objective**  
Berapa banyak data yang boleh hilang.

Contoh:

- RPO 0: tidak boleh ada committed transaction hilang.
- RPO 5 detik: boleh kehilangan perubahan beberapa detik terakhir.

Trade-off umum:

| Target | Konsekuensi |
|---|---|
| RTO sangat kecil | Butuh otomatisasi, routing cepat, observability kuat |
| RPO sangat kecil | Butuh synchronous/semi-sync/consensus, commit lebih mahal |
| RTO kecil + RPO kecil | Kompleksitas tinggi |
| RTO longgar + RPO longgar | Arsitektur lebih sederhana |

---

## 3. Availability vs Durability vs Consistency

Tiga hal ini sering dicampur.

### 3.1 Availability

Availability menjawab:

> “Apakah service bisa menerima request?”

Primary hidup tetapi semua query stuck karena lock juga berarti availability buruk.

Replica hidup tetapi lag 20 menit tidak otomatis membuat sistem “available” untuk workflow yang butuh state terbaru.

### 3.2 Durability

Durability menjawab:

> “Setelah transaksi commit, apakah datanya akan bertahan walau ada crash?”

Durability lokal dipengaruhi oleh:

- redo log,
- flush policy,
- fsync,
- storage behavior,
- binary log durability.

Durability lintas node dipengaruhi oleh:

- apakah event sudah sampai replica,
- apakah replica sudah menulis relay log,
- apakah replica sudah apply,
- apakah replica kandidat failover punya transaksi tersebut.

### 3.3 Consistency

Consistency menjawab:

> “Apakah pembaca melihat state yang valid sesuai aturan sistem?”

Dalam topologi replicated, consistency melibatkan:

- read-your-writes,
- monotonic reads,
- stale read,
- replication lag,
- routing ke primary/replica,
- failover timeline.

### 3.4 Correctness

Correctness lebih luas daripada consistency database.

Contoh sistem case-management:

- case tidak boleh pindah dari `CLOSED` ke `UNDER_INVESTIGATION`,
- enforcement action tidak boleh dibuat dua kali,
- escalation tidak boleh terlambat tanpa audit trail,
- SLA breach tidak boleh dihitung dari snapshot usang,
- state transition harus defensible.

HA yang buruk bisa membuat sistem “available” tetapi salah secara bisnis.

---

## 4. MySQL HA Building Blocks

MySQL HA biasanya dibangun dari kombinasi beberapa komponen.

### 4.1 Replication

Replication menyediakan salinan data ke node lain.

Jenis umum:

- asynchronous replication,
- semisynchronous replication,
- Group Replication.

Replication menjawab:

> “Bagaimana perubahan dari primary sampai ke node lain?”

Replication sendiri belum cukup untuk HA. Kamu masih butuh:

- failover decision,
- routing,
- fencing,
- monitoring,
- recovery procedure.

### 4.2 Topology Manager

Topology manager mengelola siapa primary, siapa replica, dan bagaimana failover dilakukan.

Contoh kategori:

- MySQL InnoDB Cluster melalui MySQL Shell AdminAPI,
- orchestrator-like topology manager,
- cloud-managed database control plane,
- custom operator.

Tugasnya:

- health check,
- topology discovery,
- promotion,
- reparenting replica,
- failover orchestration,
- metadata cluster management.

### 4.3 Router / Proxy / Endpoint

Aplikasi perlu endpoint stabil.

Alternatif routing:

| Strategi | Contoh | Trade-off |
|---|---|---|
| Direct primary host | JDBC ke host primary | Sederhana, failover manual sulit |
| DNS switch | hostname diarahkan ulang | TTL/cache bisa bermasalah |
| VIP | virtual IP pindah node | Butuh network control/fencing |
| Proxy | ProxySQL/HAProxy/MySQL Router | Fleksibel, komponen tambahan |
| Driver failover URL | Connector/J topology config | Perlu memahami behavior driver |
| Cloud endpoint | RDS/Aurora/Cloud SQL endpoint | Operasional mudah, detail tersembunyi |

### 4.4 Fencing Mechanism

Tanpa fencing, topologi HA tidak lengkap.

Pertanyaan wajib:

> “Setelah primary baru dipromosikan, apa yang menjamin primary lama tidak menerima write?”

Kalau jawabannya tidak jelas, HA design belum aman.

### 4.5 Observability

HA tidak bisa dipercaya tanpa observability.

Minimum signals:

- primary reachability,
- replication status,
- replication lag,
- GTID set,
- read-only/super-read-only state,
- transaction throughput,
- connection errors,
- lock wait,
- disk pressure,
- fsync latency,
- applier error,
- router/proxy health.

---

## 5. Topologi 1: Single Primary Tanpa Replica

```text
App ---> MySQL Primary
```

### 5.1 Kelebihan

- sederhana,
- mudah dipahami,
- tidak ada replication lag,
- tidak ada split brain antar database,
- operational surface kecil.

### 5.2 Kekurangan

- primary adalah single point of failure,
- maintenance butuh downtime,
- backup/restore adalah jalan recovery utama,
- read scaling terbatas,
- RTO biasanya lebih panjang.

### 5.3 Kapan Masih Masuk Akal?

- sistem kecil,
- internal tool,
- early-stage product,
- RTO longgar,
- data bisa restore dari backup,
- tidak ada kebutuhan read scale.

### 5.4 Failure Mode

| Failure | Dampak |
|---|---|
| mysqld crash | downtime sampai restart/recovery selesai |
| VM/host mati | downtime sampai host pulih atau restore |
| storage corrupt | restore backup |
| disk full | write failure, possible crash/recovery |
| migration stuck | semua traffic terdampak |

### 5.5 Lesson

Single primary tanpa replica bukan otomatis buruk. Yang buruk adalah memakai topologi ini sambil mengklaim HA tinggi.

---

## 6. Topologi 2: Primary + Async Replica

```text
             async replication
App ---> Primary ------------> Replica
```

### 6.1 Kelebihan

- replica bisa menjadi kandidat failover,
- backup bisa diambil dari replica,
- read tertentu bisa diarahkan ke replica,
- lebih baik daripada single node untuk recovery.

### 6.2 Kekurangan

- replication lag,
- committed transaction di primary bisa belum sampai replica,
- failover dapat menyebabkan data loss,
- promotion manual/otomatis butuh koordinasi,
- read/write split membuka stale read.

### 6.3 Failover Timeline

```text
T0: primary menerima COMMIT X
T1: client menerima sukses
T2: primary crash sebelum X sampai replica
T3: replica dipromosikan
T4: X hilang dari primary baru
```

Dari sudut pandang aplikasi, ini sangat berat:

- user melihat operasi sukses,
- setelah failover data tidak ada,
- retry bisa membuat duplikasi atau konflik,
- audit trail bisa tidak lengkap.

### 6.4 Kapan Cocok?

- RPO tidak harus nol,
- workload bisa menoleransi kehilangan transaksi sangat baru,
- sistem punya idempotency/reconciliation,
- read scaling diperlukan,
- biaya latency commit harus rendah.

### 6.5 Anti-Pattern

Mengatakan:

> “Kami punya replica, jadi sudah HA.”

Replica hanya bahan baku HA. Tanpa prosedur failover, fencing, dan routing, belum menjadi HA solution.

---

## 7. Topologi 3: Primary + Multiple Replicas

```text
                      +--> Replica A
App ---> Primary -----+--> Replica B
                      +--> Replica C
```

### 7.1 Kelebihan

- lebih banyak kandidat failover,
- read scaling lebih baik,
- bisa memisahkan fungsi replica:
  - online read,
  - reporting,
  - backup,
  - delayed recovery.

### 7.2 Tantangan

Replica tidak selalu sama.

Perbedaan yang harus diperhatikan:

- lag berbeda,
- hardware berbeda,
- config berbeda,
- index mungkin berbeda jika migration tidak seragam,
- applier error di satu replica,
- GTID set tidak sama,
- salah satu replica dipakai query reporting berat.

### 7.3 Candidate Selection

Saat failover, kandidat terbaik bukan selalu replica dengan CPU paling idle.

Kriteria kandidat:

| Kriteria | Alasan |
|---|---|
| Paling up-to-date | Mengurangi data loss |
| GTID set valid | Memudahkan reparenting |
| Tidak error | Jangan promote node rusak |
| Durability config kuat | Primary baru harus aman |
| Network reachable | Aplikasi dan replica lain bisa connect |
| Tidak dedicated reporting | Jangan promote node dengan workload menyimpang |
| Sama schema/config | Mengurangi surprise |

### 7.4 Cascade Replication

```text
Primary ---> Replica A ---> Replica B
```

Kelebihan:

- mengurangi beban primary,
- berguna untuk topologi lintas region.

Kekurangan:

- lag bertingkat,
- failover lebih rumit,
- B bisa kehilangan event jika A bermasalah,
- topology recovery lebih sulit.

---

## 8. Topologi 4: Semisynchronous Replication

Semisynchronous replication mencoba mengurangi risiko data loss dibanding async replication.

Simplified flow:

```text
Client -> Primary: COMMIT
Primary -> Replica: send binlog event
Replica -> Primary: acknowledge receipt/logging
Primary -> Client: commit success
```

Penting: semisynchronous bukan fully synchronous replication.

Secara praktis, primary menunggu setidaknya satu replica mengakui bahwa transaksi telah diterima/logged sebelum mengembalikan sukses ke client. Ini mengurangi risiko kehilangan transaksi pada failover, tetapi tidak menghilangkan semua failure mode.

### 8.1 Kelebihan

- RPO lebih baik daripada async,
- mengurangi kemungkinan transaksi committed hilang,
- tidak serumit consensus penuh.

### 8.2 Kekurangan

- commit latency naik,
- bergantung pada replica acknowledgment,
- bisa fallback/timeout ke async tergantung konfigurasi,
- transaksi mungkin sudah acknowledged oleh replica tetapi belum applied,
- failover tetap butuh kandidat selection dan fencing.

### 8.3 Failure Scenario

```text
T0: primary mengirim event ke replica
T1: replica acknowledge receipt
T2: primary mengembalikan COMMIT success ke client
T3: primary crash
T4: replica dipromosikan
```

Kemungkinan lebih aman daripada async karena event sudah sampai minimal satu replica. Namun tetap perlu memastikan replica kandidat yang dipromosikan adalah yang memiliki event tersebut.

### 8.4 Kapan Cocok?

- ingin menekan RPO,
- latency tambahan masih dapat diterima,
- workload write tidak terlalu latency-sensitive,
- topologi dan monitoring matang.

---

## 9. Topologi 5: Group Replication dan InnoDB Cluster

Group Replication adalah mekanisme replication berbasis group membership dan distributed coordination. MySQL InnoDB Cluster dibangun di atas Group Replication, biasanya dikelola menggunakan MySQL Shell AdminAPI dan dapat memakai MySQL Router sebagai routing layer.

Konsep sederhana:

```text
             Group Replication
        +--------------------------+
        | MySQL A  MySQL B MySQL C |
        +--------------------------+
                  ^
                  |
             MySQL Router
                  ^
                  |
                 App
```

### 9.1 Single-Primary Mode

Dalam single-primary mode:

- satu node menerima write,
- node lain read-only,
- jika primary gagal, group dapat memilih primary baru,
- routing layer mengarahkan aplikasi ke endpoint yang sesuai.

Ini mode yang lebih mudah dipahami dan sering lebih cocok untuk aplikasi OLTP tradisional.

### 9.2 Multi-Primary Mode

Dalam multi-primary mode:

- beberapa node dapat menerima write,
- konflik write harus dideteksi/diselesaikan,
- aplikasi harus lebih disiplin,
- hot row/hot entity dapat bermasalah,
- operational complexity lebih tinggi.

Untuk kebanyakan Java OLTP business system, single-primary lebih aman sebagai default mental model.

### 9.3 Kelebihan

- membership management,
- automatic failover capability,
- built-in HA stack dengan MySQL Shell/Router,
- mengurangi custom failover logic,
- cocok untuk organisasi yang ingin stack resmi MySQL.

### 9.4 Kekurangan

- lebih kompleks daripada async replication,
- butuh minimum node/quorum thinking,
- network partition behavior harus dipahami,
- write latency dapat lebih tinggi,
- tidak semua workload cocok,
- troubleshooting membutuhkan skill khusus.

### 9.5 Quorum Mental Model

Dalam cluster, keputusan harus dibuat oleh mayoritas sehat.

Jika cluster 3 node:

```text
A B C
```

Mayoritas = 2.

Jika A terisolasi sendirian, A seharusnya tidak terus menerima write jika tidak memiliki quorum. Ini adalah mekanisme penting untuk menghindari split brain.

### 9.6 Kapan Cocok?

- membutuhkan HA lebih otomatis,
- ingin stack resmi MySQL,
- tim siap memahami group membership/quorum,
- RTO ingin lebih pendek,
- bisa menerima kompleksitas operasi.

---

## 10. Routing Layer: Bagaimana Aplikasi Menemukan Primary?

Failover tidak berguna jika aplikasi tetap connect ke primary lama.

### 10.1 Direct Host Connection

```properties
jdbc:mysql://mysql-primary-01:3306/app
```

Kelebihan:

- sederhana,
- mudah debug.

Kekurangan:

- saat failover, config aplikasi harus berubah,
- reconnect tidak otomatis ke primary baru,
- tidak cocok untuk RTO kecil.

### 10.2 DNS-Based Failover

```properties
jdbc:mysql://mysql-primary.internal:3306/app
```

Saat failover, DNS diarahkan ke node baru.

Masalah:

- DNS TTL,
- JVM DNS cache,
- OS resolver cache,
- connection pool existing connection,
- stale endpoint.

Di Java, DNS caching bisa menjadi jebakan. Walau DNS sudah berubah, JVM/aplikasi/proxy bisa tetap memakai alamat lama sampai cache habis atau connection direcycle.

### 10.3 VIP

Virtual IP pindah dari primary lama ke primary baru.

Kelebihan:

- endpoint stabil,
- aplikasi tidak perlu tahu node berubah.

Kekurangan:

- butuh network control,
- fencing harus kuat,
- tidak selalu mudah di cloud managed environment.

### 10.4 Proxy

Proxy seperti MySQL Router, ProxySQL, atau HAProxy dapat berada antara aplikasi dan MySQL.

```text
App -> Proxy/Router -> Current Primary
                  \-> Replicas
```

Kelebihan:

- endpoint aplikasi stabil,
- routing bisa lebih pintar,
- read/write split bisa dikontrol,
- failover dapat disembunyikan sebagian.

Kekurangan:

- proxy sendiri harus HA,
- menambah latency dan operational surface,
- bug/konfigurasi proxy bisa menjadi incident,
- observability harus mencakup proxy.

### 10.5 Driver-Level Failover

Connector/J memiliki fitur koneksi dengan beberapa host dan mode tertentu. Namun driver-level failover tidak boleh dipahami sebagai pengganti desain HA.

Driver tidak selalu tahu:

- node mana yang benar-benar primary,
- apakah primary lama sudah fenced,
- apakah transaksi sebelumnya committed,
- apakah replica cukup up-to-date,
- apakah routing read aman.

Driver membantu konektivitas. Ia tidak menggantikan konsensus/topology manager.

---

## 11. Failure Detection: “Mati” Itu Tidak Sederhana

Salah satu bagian tersulit HA adalah menentukan apakah primary benar-benar gagal.

### 11.1 Jenis Failure

| Failure | Contoh |
|---|---|
| Process failure | `mysqld` crash |
| Host failure | VM mati |
| Storage failure | disk read/write error |
| Network failure | packet loss, partition |
| Slow failure | latency sangat tinggi tapi tidak mati |
| Partial failure | app tidak bisa connect, orchestrator bisa |
| Control plane failure | cloud API/network manager bermasalah |
| Logical failure | primary hidup tapi data/schema corrupt |

### 11.2 False Positive

False positive terjadi ketika system mengira primary mati padahal tidak.

Dampaknya bisa fatal:

- primary baru dipromosikan,
- primary lama masih menerima write,
- split brain.

### 11.3 False Negative

False negative terjadi ketika system mengira primary sehat padahal tidak melayani dengan benar.

Dampak:

- failover terlambat,
- downtime lebih panjang,
- aplikasi terus retry ke node buruk,
- connection pool penuh.

### 11.4 Health Check yang Baik

Health check harus lebih dari sekadar TCP connect.

Layer health:

1. port terbuka,
2. authentication berhasil,
3. simple query berhasil,
4. node writable/read-only sesuai role,
5. replication state valid,
6. disk tidak penuh,
7. lag dalam batas,
8. transaction latency wajar.

Namun health check terlalu berat juga bisa membebani sistem saat incident.

---

## 12. Failover Step-by-Step

Berikut alur konseptual failover yang sehat.

### 12.1 Detect

Sistem mendeteksi primary bermasalah.

Pertanyaan:

- siapa yang mendeteksi?
- dari jaringan mana?
- menggunakan quorum atau single observer?
- berapa threshold?
- bagaimana menghindari false positive?

### 12.2 Decide

Sistem memutuskan failover perlu dilakukan.

Pertanyaan:

- apakah primary benar-benar tidak bisa dipulihkan cepat?
- apakah ada kandidat aman?
- apakah RTO menuntut otomatis?
- apakah operator perlu approval?

### 12.3 Fence

Primary lama harus dibuat tidak bisa menerima write.

Pertanyaan:

- apakah proses mati?
- apakah host mati?
- apakah network diblokir?
- apakah `super_read_only` diset?
- apakah endpoint aplikasi sudah dicabut?

### 12.4 Select Candidate

Pilih replica paling tepat.

Kriteria:

- data paling lengkap,
- replication healthy,
- schema sama,
- config tepat,
- hardware cukup,
- tidak sedang overload.

### 12.5 Promote

Replica dipromosikan menjadi primary.

Umumnya:

- stop replication applier sesuai kebutuhan,
- ubah read-only state,
- pastikan binary logging/GTID benar,
- siapkan user/privilege,
- validasi writable.

### 12.6 Repoint Traffic

Traffic diarahkan ke primary baru.

Melalui:

- router/proxy,
- VIP,
- DNS,
- driver config,
- service discovery.

### 12.7 Reparent Replicas

Replica lain diarahkan ke primary baru.

Pertanyaan:

- apakah GTID memudahkan reparenting?
- apakah ada replica yang lebih maju?
- apakah ada divergent transaction?

### 12.8 Validate

Validasi pasca-failover:

- write berhasil,
- read berhasil,
- replication berjalan,
- lag terkendali,
- application error rate turun,
- no split brain,
- data sanity check.

### 12.9 Stabilize

Setelah layanan pulih:

- rebuild node lama,
- rejoin sebagai replica,
- review data loss,
- review audit trail,
- run postmortem,
- update runbook.

---

## 13. The Hardest Problem: Uncertain Commit

Salah satu failure mode paling penting untuk Java engineer adalah **uncertain commit**.

Scenario:

```text
App: COMMIT
Network: connection drops
App: receives exception / timeout
Database: maybe committed, maybe not
```

Dari sudut pandang aplikasi, hasilnya ambigu.

### 13.1 Kenapa Ini Terjadi?

Ketika aplikasi mengirim `COMMIT`, ada beberapa tahap:

1. request dikirim ke server,
2. server memproses commit,
3. redo/binlog flush sesuai config,
4. server mengirim response,
5. client menerima response.

Jika koneksi putus di antara tahap 2–5, aplikasi mungkin tidak tahu apakah transaksi berhasil.

### 13.2 Kesalahan Umum

```java
try {
    repository.save(payment);
} catch (Exception e) {
    repository.save(payment); // dangerous naive retry
}
```

Jika transaksi pertama sebenarnya commit, retry dapat membuat duplikasi.

### 13.3 Solusi Desain

Gunakan:

- idempotency key,
- unique constraint,
- request table,
- operation ID,
- natural business id,
- retry-safe command handler,
- reconciliation job,
- outbox pattern.

Contoh:

```sql
CREATE TABLE command_request (
    request_id BINARY(16) PRIMARY KEY,
    command_type VARCHAR(64) NOT NULL,
    aggregate_id BINARY(16) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6)
);
```

Jika client retry dengan `request_id` yang sama, sistem bisa menentukan apakah operasi sudah diterima.

### 13.4 Rule

Untuk operasi penting:

> Retry hanya aman jika operasi idempotent atau dilindungi constraint.

---

## 14. Java Connection Pool Behavior During Failover

Failover sering terlihat sebagai database problem, tetapi aplikasi Java dapat memperburuk atau memperbaikinya.

### 14.1 Apa yang Terjadi pada HikariCP?

Saat primary down:

- existing connections error,
- new connection attempts timeout,
- pool bisa menunggu sampai connection timeout,
- request thread menumpuk,
- servlet/reactive worker bisa penuh,
- circuit breaker mungkin membuka,
- retry storm bisa terjadi.

### 14.2 Timeout Layer

Ada beberapa timeout berbeda:

| Layer | Contoh |
|---|---|
| Connection acquisition | waktu menunggu connection dari pool |
| Connection creation | waktu membuat koneksi DB baru |
| Socket read/write | koneksi hidup tapi respons tidak datang |
| Query timeout | statement terlalu lama |
| Transaction timeout | boundary service terlalu lama |
| Lock wait timeout | menunggu lock di InnoDB |
| App request timeout | HTTP/gRPC request timeout |

Kesalahan umum adalah hanya mengatur satu timeout dan mengira semua aman.

### 14.3 Pool Sizing During Incident

Pool terlalu besar dapat memperparah failover:

- banyak koneksi reconnect serentak,
- primary baru langsung dibanjiri,
- MySQL thread/connections penuh,
- proxy overload,
- application retry storm.

Rule praktis:

> Connection pool harus dibatasi berdasarkan kapasitas database, bukan jumlah thread aplikasi.

### 14.4 Fail Fast vs Hang

Selama failover, sering lebih baik request gagal cepat daripada menggantung lama.

Karena request menggantung:

- menghabiskan thread,
- menahan memory,
- memperpanjang queue,
- membuat user melihat timeout panjang,
- menciptakan retry bersamaan di client.

### 14.5 Circuit Breaker

Circuit breaker bisa membantu jika:

- database sedang failover,
- error rate tinggi,
- retry hanya memperparah kondisi.

Namun circuit breaker tidak boleh menyembunyikan masalah consistency.

Untuk write penting, circuit breaker harus dipadukan dengan:

- durable queue,
- command idempotency,
- user feedback jelas,
- reconciliation.

---

## 15. Read/Write Splitting During Failover

Read/write splitting menjadi jauh lebih sulit saat failover.

Scenario:

```text
T0: user write ke primary A
T1: primary A crash
T2: replica B dipromosikan
T3: router belum update semua app instance
T4: sebagian read ke replica C yang masih reparenting
```

Kemungkinan masalah:

- read stale,
- read error,
- read dari node yang belum catch up,
- write diarahkan ke read-only node,
- transaction yang mulai sebelum failover memakai connection lama,
- application-level cache memegang state lama.

### 15.1 Safe Policy

Untuk workflow kritis:

- setelah write, read dari primary,
- selama failover, disable replica reads sementara,
- gunakan primary-only mode untuk command workflow,
- pisahkan reporting dari operational command path.

### 15.2 Regulatory/Case Management Example

Misalnya user mengubah status case:

```text
UNDER_REVIEW -> ENFORCEMENT_RECOMMENDED
```

Setelah write sukses, sistem langsung menampilkan detail case.

Jika detail page membaca dari replica lagging, user bisa melihat status lama:

```text
UNDER_REVIEW
```

Dampaknya:

- user mengulang aksi,
- workflow menciptakan duplicate transition,
- audit menjadi membingungkan,
- SLA calculation salah,
- operator kehilangan trust.

Untuk workflow semacam ini, read-your-writes lebih penting daripada read scaling.

---

## 16. Split Brain: Root Cause dan Pencegahan

Split brain biasanya terjadi karena kombinasi:

- failure detection salah,
- fencing tidak ada,
- routing tidak seragam,
- operator manual keliru,
- network partition,
- automation terlalu agresif.

### 16.1 Example

```text
Region/AZ 1: Primary A
Region/AZ 2: Replica B

Network antara orchestrator dan A putus.
A masih menerima traffic dari sebagian aplikasi.
Orchestrator promote B.
Sebagian aplikasi pindah ke B.
```

Sekarang ada dua write histories:

```text
A: X1, X2, X3
B: Y1, Y2, Y3
```

Jika `X` dan `Y` menyentuh row berbeda, divergence mungkin tidak langsung terlihat. Jika menyentuh aggregate yang sama, constraint/business invariant bisa rusak.

### 16.2 Pencegahan

- gunakan quorum-based design,
- enforce single writer,
- gunakan `super_read_only` untuk non-primary,
- pastikan routing hanya ke primary sah,
- fencing sebelum promotion,
- monitor dual-writable condition,
- jangan allow manual promotion tanpa checklist,
- test network partition scenario.

### 16.3 Recovery Setelah Split Brain

Recovery sulit karena perlu:

- freeze writes,
- dump conflicting transactions,
- compare binary logs,
- identify authoritative source,
- reconcile data,
- rebuild replica,
- audit impacted business operation.

Dalam sistem regulatory, split brain bukan hanya technical incident. Ia bisa menjadi data integrity incident.

---

## 17. Failover dan Schema Migration

Schema migration selama HA event adalah kombinasi berbahaya.

### 17.1 Failure Scenarios

1. Migration berjalan di primary lama, lalu failover.
2. Replica kandidat belum punya DDL terbaru.
3. App versi baru connect ke primary baru dengan schema lama.
4. Metadata lock menahan failover validation.
5. Online DDL masih copy/rebuild ketika primary gagal.
6. Replica apply DDL lambat dan tertinggal jauh.

### 17.2 Rule Praktis

- Jangan lakukan risky DDL saat cluster tidak sehat.
- Pastikan migration compatible dengan failover.
- Gunakan expand-contract pattern.
- Validasi schema di semua node.
- Jangan promote replica yang schema-nya berbeda dari expectation aplikasi.
- Observability migration harus include replication state.

### 17.3 Java Deployment Coupling

Deployment aplikasi dan migration harus mempertimbangkan failover.

Aman:

```text
v1 app works with old schema
v1 app works with expanded schema
v2 app works with expanded schema
contract old schema only after all stable
```

Berbahaya:

```text
deploy app requiring new column
migration half complete
failover to replica without column
app crashes
```

---

## 18. HA dan Backup/Restore: Jangan Disamakan

HA bukan pengganti backup.

Replication dapat mereplikasi kesalahan:

- accidental delete,
- bad migration,
- corrupted business update,
- application bug,
- malicious update.

Jika primary menjalankan:

```sql
DELETE FROM enforcement_action;
```

Replica akan menerima delete itu juga.

### 18.1 Kebutuhan Tetap Ada

Walau punya HA, tetap butuh:

- full backup,
- incremental/binlog archive,
- point-in-time recovery,
- delayed replica,
- restore rehearsal,
- data integrity check.

### 18.2 Delayed Replica

Delayed replica sengaja tertinggal.

Kegunaan:

- recovery dari human error,
- restore sebelum bad transaction diterapkan,
- investigasi data drift.

Kekurangan:

- tidak cocok sebagai failover candidate utama,
- datanya by design stale,
- perlu monitoring berbeda.

---

## 19. Cloud-Managed MySQL: Tetap Harus Paham Failure Model

Managed database seperti RDS MySQL, Cloud SQL, Azure Database for MySQL, atau vendor lain menyederhanakan banyak hal.

Namun managed bukan berarti tanpa desain.

Yang biasanya disediakan:

- automated backup,
- replica,
- failover option,
- monitoring dasar,
- patching workflow,
- managed endpoint.

Yang tetap tanggung jawab engineer:

- memahami RTO/RPO aktual,
- menguji failover dari aplikasi,
- timeout/circuit breaker/retry,
- schema migration aman,
- read/write consistency,
- backup restore rehearsal,
- observability end-to-end,
- incident runbook.

Pertanyaan yang harus diajukan ke managed DB:

1. Failover biasanya berapa lama?
2. Apakah endpoint berubah atau stabil?
3. Apa yang terjadi pada existing connections?
4. Apakah read replica otomatis menjadi primary?
5. Bagaimana RPO dijamin?
6. Apakah ada semi-sync/consensus?
7. Bagaimana backup + PITR bekerja?
8. Apakah failover bisa diuji tanpa data loss?
9. Apa batasan DDL saat HA?
10. Apa metric resmi untuk replication lag dan failover event?

---

## 20. Application Contract During HA

Database HA harus diterjemahkan menjadi kontrak aplikasi.

### 20.1 Untuk Write Endpoint

Write endpoint harus siap menghadapi:

- transient connection failure,
- lock timeout,
- deadlock,
- failover mid-transaction,
- uncertain commit,
- duplicate retry.

Strategi:

- idempotency key,
- transaction retry untuk error yang aman,
- unique constraints,
- business operation log,
- outbox,
- clear user-visible operation status.

### 20.2 Untuk Read Endpoint

Read endpoint harus diklasifikasi:

| Read Type | Replica Aman? |
|---|---|
| Static reference data | Biasanya aman |
| Reporting dashboard | Bisa, jika staleness diterima |
| After-write detail page | Sebaiknya primary |
| Authorization/permission check | Biasanya primary/strong consistency |
| SLA/escalation decision | Primary atau controlled snapshot |
| Audit/legal evidence | Jangan dari stale replica tanpa metadata |

### 20.3 Untuk Background Job

Background job harus:

- tolerate failover,
- checkpoint progress,
- avoid long transaction,
- idempotent,
- use lease/lock carefully,
- avoid assuming single process forever.

### 20.4 Untuk Scheduler

Scheduler yang memakai MySQL sebagai coordination store harus hati-hati.

Jika failover terjadi:

- lease bisa tampak expired,
- job bisa double-run,
- old worker bisa masih hidup,
- clock skew bisa berpengaruh.

Gunakan:

- fencing token,
- versioned lease,
- idempotent job,
- unique execution key.

---

## 21. Case Study: Regulatory Enforcement Case Platform

Bayangkan platform dengan entity:

- `case_file`,
- `case_state_transition`,
- `enforcement_action`,
- `subject_party`,
- `evidence_item`,
- `sla_timer`,
- `audit_event`,
- `notification_outbox`.

### 21.1 Requirement

- case state transition harus konsisten,
- audit event tidak boleh hilang,
- duplicate enforcement action tidak boleh terjadi,
- read-after-write untuk operator harus benar,
- reporting boleh tertinggal beberapa menit,
- backup harus bisa restore untuk audit investigation,
- failover tidak boleh menghasilkan dua primary.

### 21.2 Suggested HA Design

Operational path:

```text
Java Services -> DB Router/Primary Endpoint -> MySQL Primary
                                      \-> Replicas for reporting/read-only
```

Core decisions:

- command writes ke primary,
- read-after-write dari primary,
- dashboard reporting dari replica dengan staleness label,
- idempotency key untuk command penting,
- outbox table untuk notification/event publishing,
- migration expand-contract,
- delayed replica atau PITR untuk recovery human error,
- failover runbook tested.

### 21.3 State Transition Guard

```sql
UPDATE case_file
SET status = 'ENFORCEMENT_RECOMMENDED',
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE case_id = ?
  AND status = 'UNDER_REVIEW'
  AND version = ?;
```

Jika affected rows = 0:

- state sudah berubah,
- version stale,
- duplicate command,
- atau read source stale.

Aplikasi harus membedakan failure ini.

### 21.4 Audit Event in Same Transaction

```text
BEGIN
  update case_file state
  insert case_state_transition
  insert audit_event
  insert outbox_event
COMMIT
```

Konsekuensi HA:

- uncertain commit harus bisa direkonsiliasi,
- retry command harus idempotent,
- failover tidak boleh membuat audit event hilang tanpa deteksi,
- outbox publisher harus retry-safe.

---

## 22. Practical Failure Mode Catalog

### 22.1 Primary Crash

Symptoms:

- connection reset,
- connection refused,
- query timeout,
- increased app error rate.

Questions:

- crash recovery selesai berapa lama?
- failover terjadi atau restart primary?
- transaksi terakhir ada di replica?
- aplikasi retry aman?

### 22.2 Primary Slow/Hung

Symptoms:

- TCP connect berhasil,
- query menggantung,
- CPU/disk/lock tinggi,
- health check mungkin masih pass.

Danger:

- failover decision sulit,
- false negative umum terjadi,
- aplikasi pool exhaustion.

### 22.3 Replica Lag Spike

Symptoms:

- reporting stale,
- read-after-write gagal,
- failover candidate buruk,
- applier thread behind.

Actions:

- disable replica reads for critical path,
- check long query on replica,
- check large transaction,
- check DDL,
- check I/O/CPU.

### 22.4 Network Partition

Symptoms:

- some clients reach primary, others cannot,
- orchestrator view berbeda dari application view,
- replica connection drops.

Danger:

- split brain.

Need:

- quorum/fencing,
- conservative automation,
- clear control-plane authority.

### 22.5 Disk Full

Symptoms:

- writes fail,
- binlog cannot grow,
- relay log issue,
- temp table failure,
- crash risk.

Actions:

- understand what filled disk,
- avoid deleting active binlog blindly,
- verify backup/PITR impact,
- check replication.

### 22.6 Bad Deployment with DB Failover

Symptoms:

- app errors after failover,
- schema mismatch,
- driver URL misconfiguration,
- old app version connected to new primary.

Prevention:

- deployment/runbook integration,
- compatibility matrix,
- migration state validation.

---

## 23. Runbook: Minimal MySQL Failover Checklist

Ini bukan command vendor-spesifik, tetapi checklist konseptual.

### 23.1 Before Incident

- [ ] Define RTO/RPO.
- [ ] Identify failover authority.
- [ ] Document topology.
- [ ] Enable GTID if chosen by architecture.
- [ ] Ensure replicas are monitored.
- [ ] Ensure backups are restorable.
- [ ] Test failover with app.
- [ ] Test DNS/proxy/router behavior.
- [ ] Configure application timeouts.
- [ ] Ensure idempotency for critical writes.
- [ ] Document rollback/rebuild steps.

### 23.2 During Incident

- [ ] Confirm primary health from multiple perspectives.
- [ ] Freeze risky automation if needed.
- [ ] Identify freshest healthy replica.
- [ ] Fence old primary.
- [ ] Promote selected replica.
- [ ] Redirect traffic.
- [ ] Validate writes.
- [ ] Validate critical reads.
- [ ] Reconfigure replicas.
- [ ] Monitor error rate and lag.
- [ ] Record timeline.

### 23.3 After Incident

- [ ] Confirm no split brain.
- [ ] Check data loss window.
- [ ] Reconcile uncertain operations.
- [ ] Rebuild old primary as replica.
- [ ] Review app retry behavior.
- [ ] Review observability gaps.
- [ ] Update runbook.
- [ ] Run postmortem.

---

## 24. Common Anti-Patterns

### 24.1 “Replica Means HA”

Replica tanpa failover/routing/fencing adalah standby copy, bukan HA solution lengkap.

### 24.2 “Automatic Failover Always Better”

Automatic failover dengan poor detection/fencing bisa lebih buruk daripada manual karena menciptakan split brain.

### 24.3 “Read Replica Is Always Safe for Reads”

Tidak semua read sama. Authorization, state transition, audit, and read-after-write sering tidak boleh stale.

### 24.4 “Retry Everything”

Retry tanpa idempotency dapat menggandakan efek.

### 24.5 “DNS Switch Is Instant”

DNS TTL, JVM cache, connection pool, dan proxy cache bisa membuat switch tidak instan.

### 24.6 “HA Replaces Backup”

Replication mereplikasi kesalahan. Backup/PITR tetap wajib.

### 24.7 “Failover Tested at DB Layer Means App Safe”

Aplikasi memiliki connection pool, transaction boundary, retry, cache, and read routing sendiri. Harus diuji end-to-end.

---

## 25. Design Heuristics

### 25.1 Prefer Single-Writer Unless You Truly Need Multi-Writer

Multi-writer terlihat menarik tetapi menaikkan kompleksitas consistency, conflict, dan debugging.

Untuk mayoritas OLTP Java systems, single-primary lebih mudah dipertanggungjawabkan.

### 25.2 Treat Failover as Data Integrity Event

Failover bukan hanya availability event. Ia dapat memengaruhi:

- committed transaction,
- audit trail,
- outbox event,
- read consistency,
- duplicate command,
- reporting correctness.

### 25.3 Make Writes Idempotent

HA tanpa idempotency di aplikasi akan rapuh.

### 25.4 Keep Transactions Short

Long transaction membuat:

- failover lebih lambat,
- rollback lebih mahal,
- lock lebih lama,
- replication apply lebih berat,
- recovery lebih kompleks.

### 25.5 Test Realistic Failure

Test bukan hanya “kill mysqld”.

Test juga:

- network partition,
- primary slow,
- replica lag,
- app connection pool exhaustion,
- proxy restart,
- DNS stale,
- failover during migration,
- failover during high write load.

### 25.6 Define Staleness Contract

Untuk setiap read path, jawab:

> “Berapa stale data yang boleh diterima?”

Jika jawabannya “tidak boleh stale”, jangan routing ke replica biasa.

---

## 26. Checklist Arsitektur HA untuk Java Engineer

### 26.1 Database Layer

- [ ] Topologi jelas.
- [ ] Primary election/failover jelas.
- [ ] Replica candidate policy jelas.
- [ ] GTID/binlog strategy jelas.
- [ ] Fencing mechanism jelas.
- [ ] Backup/PITR tidak bergantung hanya pada replica.
- [ ] Delayed replica dipertimbangkan untuk human error.

### 26.2 Routing Layer

- [ ] Aplikasi punya endpoint stabil.
- [ ] Router/proxy/DNS behavior dipahami.
- [ ] Existing connection behavior saat failover diuji.
- [ ] Read/write split dapat dinonaktifkan saat incident.
- [ ] Router/proxy juga HA.

### 26.3 Java Application Layer

- [ ] HikariCP timeout masuk akal.
- [ ] Connection pool size tidak membanjiri DB.
- [ ] Query timeout dan transaction timeout disetel.
- [ ] Retry hanya untuk operasi aman.
- [ ] Critical write idempotent.
- [ ] Uncertain commit direkonsiliasi.
- [ ] Read-after-write dari primary.
- [ ] Outbox publisher retry-safe.

### 26.4 Operational Layer

- [ ] Runbook tersedia.
- [ ] Failover drill dilakukan.
- [ ] Alert meaningful.
- [ ] Observability mencakup DB, proxy, app.
- [ ] Operator tahu kapan tidak melakukan failover.
- [ ] Post-failover validation otomatis sebagian.

---

## 27. Latihan Mental Model

### Latihan 1 — Async Replica Data Loss

Sebuah aplikasi menerima sukses untuk `approve enforcement action`. Satu detik kemudian primary crash. Replica dipromosikan, tetapi event approval belum sampai replica.

Jawab:

1. Apa yang user lihat?
2. Bagaimana audit trail terdampak?
3. Bagaimana desain idempotency/reconciliation?
4. Apakah sistem boleh mengklaim RPO 0?

### Latihan 2 — DNS Failover dan JVM Cache

DNS `mysql-primary.internal` sudah diarahkan ke primary baru, tetapi sebagian instance Java masih gagal connect.

Jawab:

1. Cache apa saja yang mungkin terlibat?
2. Bagaimana connection pool berperilaku?
3. Bagaimana menguji ini sebelum production?

### Latihan 3 — Split Brain

Primary lama tidak bisa dijangkau orchestrator, tetapi masih bisa dijangkau 20% app instance. Orchestrator promote replica.

Jawab:

1. Apa failure mode-nya?
2. Apa fencing yang seharusnya ada?
3. Bagaimana mendeteksi divergence?
4. Mengapa automatic failover bisa berbahaya?

### Latihan 4 — Read Replica untuk Authorization

Aplikasi membaca permission dari replica. Setelah admin mencabut role user, user masih bisa melakukan aksi selama 10 detik karena replica lag.

Jawab:

1. Apakah ini acceptable?
2. Read mana yang harus primary?
3. Bagaimana mengklasifikasikan read path?

---

## 28. Ringkasan

High availability MySQL bukan hanya urusan database node. Ia adalah desain end-to-end yang melibatkan:

- replication,
- topology management,
- routing,
- fencing,
- application timeout,
- retry/idempotency,
- read consistency,
- backup/PITR,
- observability,
- dan runbook manusia.

Mental model paling penting:

1. Replica bukan otomatis HA.
2. Failover tanpa fencing berisiko split brain.
3. Async replication dapat kehilangan committed transaction saat failover.
4. Semisynchronous replication mengurangi risiko data loss, tetapi bukan magic.
5. Group Replication/InnoDB Cluster memberi mekanisme HA lebih lengkap, tetapi menambah kompleksitas quorum dan operasi.
6. Java application harus siap menghadapi transient error, uncertain commit, stale read, dan connection pool behavior.
7. Read/write splitting harus didesain berdasarkan staleness contract, bukan sekadar performa.
8. HA tidak menggantikan backup.
9. Failover harus diuji end-to-end, bukan hanya di database layer.

Jika kamu sudah memahami bagian ini, kamu bisa mulai menilai arsitektur MySQL production dengan pertanyaan yang benar:

> “Ketika primary gagal, siapa yang memutuskan, siapa yang dicegah menulis, siapa yang dipromosikan, bagaimana aplikasi tahu, data apa yang mungkin hilang, dan operasi mana yang harus direkonsiliasi?”

Itulah level berpikir yang membedakan engineer yang hanya memakai MySQL dari engineer yang mampu mendesain sistem MySQL yang defensible di production.

---

## 29. Referensi Resmi yang Relevan

Untuk pendalaman setelah membaca materi ini:

- MySQL 8.4 Reference Manual — Replication.
- MySQL 8.4 Reference Manual — Replication Solutions.
- MySQL 8.4 Reference Manual — Semisynchronous Replication.
- MySQL Reference Manual — Group Replication.
- MySQL Reference Manual — InnoDB Cluster.
- MySQL Shell Documentation — AdminAPI and InnoDB Cluster.
- MySQL Router Documentation.
- Connector/J Documentation — multiple-host connection behavior and failover-related configuration.

---

## 30. Penutup Part 022

Bagian ini menutup blok replication/failover dari sudut arsitektur. Kita sudah membangun mental model untuk memahami bahwa HA adalah kombinasi mekanisme database, keputusan topology, routing, fencing, dan kontrak aplikasi.

Bagian berikutnya akan membahas **Backup, Restore, Point-in-Time Recovery, and Disaster Recovery**.

Di sana fokusnya bergeser dari:

> “Bagaimana sistem tetap melayani saat node gagal?”

menjadi:

> “Bagaimana kita benar-benar memulihkan data yang rusak, hilang, atau salah berubah?”

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Replication Lag, Read/Write Splitting, and Consistency Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-023.md">Part 023 — Backup, Restore, PITR, and Disaster Recovery ➡️</a>
</div>
