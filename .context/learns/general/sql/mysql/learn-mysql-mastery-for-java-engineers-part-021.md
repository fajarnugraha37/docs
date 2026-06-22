# learn-mysql-mastery-for-java-engineers-part-021.md

# Part 021 — Replication Lag, Read/Write Splitting, and Consistency Boundaries

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `021 / 034`  
> Topik: Replication Lag, Read/Write Splitting, and Consistency Boundaries  
> Target pembaca: Java software engineer yang ingin memahami MySQL sebagai sistem produksi, bukan hanya sebagai tempat menyimpan data.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas fondasi binary log dan replication: primary/source menulis perubahan ke binary log, replica membaca event dari source, menyimpannya ke relay log, lalu mengaplikasikannya ke data lokal.

Bagian ini menjawab pertanyaan yang lebih sulit:

> “Kalau replica bisa tertinggal dari primary, bagaimana aplikasi Java tetap benar?”

Banyak engineer memahami replication sebagai fitur scaling:

```text
write -> primary
read  -> replica
```

Model itu terlalu sederhana dan berbahaya. Dalam production system, read/write splitting bukan hanya persoalan performa. Ia adalah persoalan **konsistensi, temporal correctness, user journey, dan failure mode**.

Setelah menyelesaikan bagian ini, kamu harus mampu menjawab:

1. Apa itu replication lag secara teknis dan secara semantik aplikasi?
2. Mengapa metric replication lag bisa menipu?
3. Query apa yang aman dibaca dari replica?
4. Query apa yang wajib membaca dari primary?
5. Bagaimana read-after-write bug muncul di aplikasi Java?
6. Bagaimana mendesain routing primary/replica tanpa menghancurkan correctness?
7. Bagaimana membuat consistency boundary eksplisit di domain model dan service layer?
8. Bagaimana read/write splitting berinteraksi dengan transaction, connection pool, retry, cache, dan distributed system?
9. Bagaimana menerapkan ini di sistem workflow/regulatory/case-management yang sensitif terhadap status dan audit?

---

## 1. Mental Model: Replica Bukan “Primary yang Lebih Murah”

Replica sering diperlakukan sebagai primary read-only yang bisa dipakai untuk semua read query. Itu framing yang salah.

Model yang lebih tepat:

```text
Primary  = source of truth untuk write dan read yang membutuhkan state terbaru.
Replica  = materialized copy yang bergerak mengikuti primary secara asynchronous.
```

Karena replication MySQL tradisional bersifat asynchronous by default, setelah transaksi commit di primary, tidak ada jaminan bahwa replica sudah melihat transaksi tersebut pada saat berikutnya.

Artinya:

```text
T0: user submit perubahan status case di primary
T1: commit sukses
T2: user diarahkan ke halaman detail case
T3: halaman detail membaca dari replica
T4: replica belum apply transaksi T1
T5: user melihat status lama
```

Bug ini bukan bug UI. Bukan bug cache. Bukan bug ORM.

Ini bug consistency boundary.

---

## 2. Replication Lag: Definisi Teknis

Secara teknis, replication lag adalah jarak antara perubahan yang sudah terjadi di source/primary dan perubahan yang sudah diterapkan di replica.

Pada replication pipeline sederhana:

```text
Primary transaction commit
        |
        v
Primary binary log
        |
        v
Replica receiver/I/O thread fetches event
        |
        v
Replica relay log
        |
        v
Replica applier/SQL thread applies event
        |
        v
Replica data becomes visible
```

Lag bisa muncul pada beberapa titik:

| Titik | Bentuk Lag | Penyebab Umum |
|---|---|---|
| Source binlog generation | commit menumpuk | primary overload, fsync lambat |
| Network transfer | event lambat sampai | network latency, bandwidth limit |
| Relay log write | receiver lambat | replica I/O bottleneck |
| Apply phase | event belum diterapkan | replica CPU/I/O lambat, lock conflict, single-thread bottleneck |
| Visibility | event sudah diterapkan sebagian | parallel apply ordering/commit visibility |

Jadi replication lag bukan satu hal. Ia adalah akumulasi keterlambatan pipeline.

---

## 3. Replication Lag: Definisi Semantik Aplikasi

Aplikasi tidak peduli apakah lag terjadi di receiver thread atau applier thread.

Aplikasi peduli:

> “Apakah read saya melihat write yang seharusnya sudah terlihat menurut ekspektasi user atau proses bisnis?”

Ada dua jenis lag yang harus dibedakan:

### 3.1 Physical Lag

Physical lag adalah jarak teknis di pipeline replication.

Contoh:

```text
Replica tertinggal 7 detik dari primary.
```

Metric seperti `Seconds_Behind_Source` mencoba merepresentasikan ini.

### 3.2 Semantic Lag

Semantic lag adalah jarak antara state yang dibaca aplikasi dan state yang dibutuhkan oleh user journey atau invariant bisnis.

Contoh:

```text
User baru saja approve enforcement action,
tapi dashboard masih menunjukkan action tersebut pending.
```

Walaupun lag hanya 500 ms, secara semantic bisa fatal jika read terjadi pada boundary yang membutuhkan read-your-writes.

Sebaliknya, lag 30 detik bisa acceptable untuk report harian.

Jadi pertanyaan utama bukan:

```text
Berapa detik lag replica?
```

Tetapi:

```text
Apakah read ini boleh melihat state yang sedikit lama?
```

---

## 4. Kenapa Replication Lag Bisa Terjadi

Replication lag bukan anomali. Ia konsekuensi normal dari asynchronous replication.

### 4.1 Write Rate Primary Lebih Tinggi dari Apply Rate Replica

Jika primary menghasilkan 10.000 row changes/detik, tetapi replica hanya bisa apply 6.000 row changes/detik, lag akan naik.

```text
produced events > consumed events
=> queue grows
=> lag grows
```

Ini sama seperti message queue.

Replica adalah consumer. Binary/relay log adalah queue. Kalau consumer kalah cepat, backlog naik.

### 4.2 Query Berat di Replica Mengganggu Apply

Replica sering dipakai untuk report query besar.

Masalah:

```text
long SELECT on replica
        |
        v
I/O dan buffer pool replica terganggu
        |
        v
replication apply melambat
        |
        v
lag naik
```

Read replica bukan resource tak terbatas. Reporting workload bisa membuat replica semakin tertinggal dari primary.

### 4.3 Lock Conflict di Replica

Jika replica menjalankan long transaction/read yang memegang snapshot lama atau resource tertentu, applier bisa terkena konflik atau tertahan.

Contoh:

```sql
-- session report di replica
START TRANSACTION;
SELECT * FROM case_event WHERE created_at >= '2026-01-01';
-- transaksi dibiarkan lama

-- replication applier perlu apply perubahan besar
-- purge/history dan resource bisa tertekan
```

### 4.4 Single Hot Table atau Hot Row

Parallel replication tidak selalu berarti semua event bisa diterapkan paralel bebas. Ordering dan dependency tetap membatasi.

Jika banyak transaksi menyentuh entity yang saling bergantung, apply bisa menjadi bottleneck.

### 4.5 Large Transaction

Transaksi besar buruk untuk replication.

Contoh:

```sql
DELETE FROM audit_log WHERE created_at < '2020-01-01';
```

tanpa batching.

Efeknya:

```text
primary commit transaksi besar
        |
        v
replica harus apply event besar
        |
        v
apply lama
        |
        v
lag naik
```

Lebih buruk lagi, replica mungkin tampak tidak tertinggal, lalu tiba-tiba stuck lama saat apply transaksi besar.

### 4.6 DDL

DDL bisa menyebabkan replica tertahan, terutama jika DDL berat, rebuild table, atau menunggu metadata lock.

```text
ALTER TABLE besar di primary
        |
        v
event DDL dikirim ke replica
        |
        v
replica apply DDL
        |
        v
replication tertahan sampai DDL selesai
```

### 4.7 Replica Hardware Lebih Lemah

Sering terjadi:

```text
primary: high IOPS, high CPU
replica: cheaper instance
```

Lalu replica dipakai untuk report.

Ini desain yang kontradiktif: replica diberi hardware lebih lemah tetapi workload tambahan lebih berat.

### 4.8 Network dan Cross-Region

Cross-region replica memiliki latency dan bandwidth constraint.

Untuk disaster recovery, ini bisa diterima. Untuk read-your-writes, sangat berisiko.

---

## 5. Metric Replication Lag Bisa Menipu

Banyak tim terlalu percaya pada satu metric: `Seconds_Behind_Source`.

Metric ini berguna, tetapi tidak cukup untuk correctness.

### 5.1 Problem 1: Lag 0 Tidak Selalu Berarti Aman

`Seconds_Behind_Source = 0` bisa berarti applier sudah mengejar event yang diterima. Tetapi ada timing gap antara:

```text
primary commit
source binlog visibility
replica fetch
replica apply
application read
```

Pada traffic tinggi, read bisa tetap mengenai replica sebelum event spesifik yang dibutuhkan diterapkan.

### 5.2 Problem 2: Lag Metric Sampling Terlambat

Metric biasanya diambil periodik.

```text
10:00:00 metric lag = 0
10:00:01 spike write besar
10:00:02 user read dari replica
10:00:05 metric baru menunjukkan lag = 4
```

Aplikasi sudah salah baca sebelum monitoring menyadari.

### 5.3 Problem 3: Lag Secara Waktu Tidak Sama dengan Lag Secara Transaksi

Lag 1 detik bisa berarti 5 transaksi atau 50.000 transaksi, tergantung write rate.

Untuk aplikasi, yang penting sering kali bukan “detik”, tetapi:

```text
Apakah transaksi X sudah terlihat di replica Y?
```

### 5.4 Problem 4: Lag Per Replica Berbeda

Jika ada beberapa replica:

```text
replica_a lag = 0.1s
replica_b lag = 3s
replica_c lag = 30s
```

Load balancer yang memilih replica secara acak bisa menghasilkan pengalaman user yang tidak konsisten.

```text
refresh 1 -> status APPROVED
refresh 2 -> status PENDING
refresh 3 -> status APPROVED
```

Ini sangat merusak trust user.

### 5.5 Problem 5: Query Bisa Membaca Replica yang Berbeda

Jika aplikasi memakai pool/driver/proxy yang tidak menjaga session affinity, satu user request bisa membaca dari replica berbeda di request berbeda.

Tanpa stickiness:

```text
Request A reads replica_1: sees new state
Request B reads replica_2: sees old state
```

Ini melanggar monotonic reads.

---

## 6. Consistency Guarantees yang Relevan untuk Aplikasi

Kita perlu vocabulary yang lebih presisi.

### 6.1 Strong Read / Latest Read

Read harus melihat state terbaru yang sudah committed di primary.

Biasanya harus baca primary.

Contoh:

- detail setelah submit form
- authorization check
- state transition guard
- payment status setelah pembayaran
- case status setelah approval
- duplicate prevention
- idempotency key lookup

### 6.2 Read-Your-Writes

Setelah user/session melakukan write, read berikutnya oleh user/session yang sama harus melihat write tersebut.

Contoh:

```text
User update profile -> halaman profile harus menampilkan data baru.
```

Read-your-writes tidak otomatis tersedia jika read diarahkan ke replica.

### 6.3 Monotonic Reads

Jika user sudah pernah melihat state versi baru, user tidak boleh kemudian melihat versi lama.

Contoh buruk:

```text
10:00:00 user melihat case APPROVED
10:00:01 refresh, user melihat case PENDING
```

Ini biasanya terjadi karena request berpindah antar replica dengan lag berbeda.

### 6.4 Causal Reads

Jika event B terjadi karena event A, pembaca yang melihat B seharusnya juga melihat A.

Contoh:

```text
case approved -> notification generated
```

Jika user melihat notification tetapi detail case masih belum approved, causal ordering rusak secara UX.

### 6.5 Eventual Consistency

Read boleh stale sementara, selama akhirnya converge.

Cocok untuk:

- analytics
- dashboard non-critical
- export report
- trend aggregation
- approximate counts
- non-critical search index

### 6.6 Bounded Staleness

Read boleh stale, tetapi maksimal dalam batas tertentu.

Contoh:

```text
Dashboard SLA boleh tertinggal maksimal 60 detik.
```

Ini lebih baik daripada “boleh stale” tanpa batas.

---

## 7. Klasifikasi Read: Mana yang Boleh ke Replica?

Read/write splitting yang benar dimulai dari klasifikasi read.

### 7.1 Critical Read

Critical read adalah read yang menentukan correctness operasi berikutnya.

Contoh:

```sql
SELECT status, version
FROM enforcement_case
WHERE id = ?;
```

jika hasilnya dipakai untuk menentukan apakah transition boleh dilakukan.

Harus ke primary.

Mengapa?

Jika replica stale, service bisa mengambil keputusan berdasarkan state lama.

### 7.2 Post-Write Confirmation Read

Read yang terjadi setelah write sukses dan ditampilkan ke user.

Contoh:

```text
POST /cases/{id}/approve
redirect -> GET /cases/{id}
```

GET ini harus membaca state yang baru saja ditulis.

Opsinya:

1. baca primary selama periode tertentu
2. session stickiness ke primary setelah write
3. tunggu replica catch up ke GTID tertentu
4. return state dari write response tanpa read ulang, jika aman

### 7.3 Authorization/Security Read

Read yang memutuskan akses.

Contoh:

```sql
SELECT role FROM user_case_permission WHERE user_id = ? AND case_id = ?;
```

Biasanya harus ke primary, terutama setelah permission baru diubah.

Stale read bisa menyebabkan:

- akses ditolak padahal sudah diberi
- akses diberi padahal sudah dicabut

Yang kedua lebih berbahaya.

### 7.4 Idempotency Read

Read idempotency key hampir selalu harus strong.

Contoh:

```sql
SELECT response_body
FROM idempotency_record
WHERE idempotency_key = ?;
```

Jika dibaca dari stale replica, aplikasi bisa mengira request belum pernah diproses dan melakukan side effect ulang.

### 7.5 Workflow State Read

Read status workflow sebelum transition harus primary.

Contoh:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ENFORCED
```

Transition guard tidak boleh berbasis stale state.

### 7.6 Dashboard Read

Dashboard bisa dibaca dari replica jika secara eksplisit menerima staleness.

Contoh:

- jumlah case open per region
- backlog per officer
- trend 30 hari
- SLA aging summary

Tetapi tetap perlu label mental:

```text
Data may be delayed.
```

Atau secara internal:

```text
staleness budget = 60s
```

### 7.7 Search/List Read

Search screen sering bisa memakai replica, tetapi detail/aksi berikutnya harus primary.

Pattern:

```text
Search results -> replica allowed
Open detail   -> maybe primary if action-sensitive
Execute action -> primary mandatory
```

### 7.8 Export/Report Read

Export besar cocok ke replica khusus reporting.

Namun jangan campur dengan replica yang dipakai untuk interactive user read, karena export bisa menaikkan lag.

---

## 8. Read/Write Splitting: Model Dasar

Read/write splitting berarti aplikasi mengarahkan query write ke primary dan sebagian query read ke replica.

```text
               +----------------+
               | Java Service    |
               +-------+--------+
                       |
          +------------+------------+
          |                         |
          v                         v
   primary datasource         replica datasource
          |                         |
          v                         v
      MySQL primary          MySQL replica(s)
```

Secara teknis terlihat mudah:

```java
if (query.isReadOnly()) {
    useReplica();
} else {
    usePrimary();
}
```

Secara correctness, ini salah.

Karena kategori penting bukan read vs write, melainkan:

```text
stale-safe read vs stale-unsafe read
```

Query `SELECT` bisa stale-unsafe.

Query `SELECT` untuk authorization, idempotency, workflow guard, dan read-after-write harus dianggap primary read.

---

## 9. Anti-Pattern: Routing Berdasarkan SQL Verb

Routing berdasarkan SQL verb sering terlihat seperti ini:

```text
SELECT -> replica
INSERT/UPDATE/DELETE -> primary
```

Ini berbahaya.

### 9.1 Contoh Bug: Approve Case

```java
@Transactional
public void approveCase(long caseId, long officerId) {
    Case c = caseRepository.findById(caseId); // routed to replica because SELECT
    c.approve(officerId);
    caseRepository.save(c);                  // routed to primary
}
```

Jika `findById` membaca stale replica, service bisa approve case berdasarkan status lama.

Misalnya primary sudah punya:

```text
case_id=10 status=REJECTED
```

Replica masih punya:

```text
case_id=10 status=UNDER_REVIEW
```

Maka aplikasi bisa melakukan transition ilegal.

### 9.2 Contoh Bug: Duplicate Submit

```java
public SubmitResponse submit(String requestId) {
    if (idempotencyRepository.exists(requestId)) { // replica
        return previousResponse(requestId);
    }

    // primary write
    createCase();
    saveIdempotencyRecord(requestId);
}
```

Jika replica belum melihat idempotency record, request duplikat bisa diproses ulang.

### 9.3 Contoh Bug: Permission Revocation

```text
Admin mencabut akses user A ke case X.
User A melakukan read beberapa detik setelahnya.
Authorization query membaca replica stale.
Akses masih diberikan.
```

Ini security issue.

---

## 10. Better Model: Consistency-Aware Routing

Routing harus berdasarkan consistency requirement.

### 10.1 Kategori Routing

| Kategori | Routing Default | Contoh |
|---|---:|---|
| Write | Primary | insert/update/delete |
| Critical read | Primary | state guard, auth, idempotency |
| Read-after-write | Primary atau GTID wait | detail setelah update |
| Stale-tolerant read | Replica | report, dashboard |
| Bounded-stale read | Replica dengan lag check | near-real-time dashboard |
| Heavy analytical read | Reporting replica | export, aggregation |

### 10.2 Service-Level Annotation Mental Model

Daripada:

```java
@Transactional(readOnly = true)
```

sebagai sinyal otomatis ke replica, lebih baik pikirkan:

```java
@Consistency(STRONG)
@Consistency(STALE_OK)
@Consistency(BOUNDED_STALE)
```

Walaupun annotation tersebut tidak harus benar-benar ada, mental model-nya penting.

`readOnly=true` bukan berarti stale-safe.

---

## 11. Transaction Read-Only Bukan Berarti Replica-Safe

Di Spring, banyak engineer menganggap:

```java
@Transactional(readOnly = true)
```

berarti query bisa diarahkan ke replica.

Itu tidak selalu benar.

Read-only transaction bisa tetap membutuhkan primary.

Contoh:

```java
@Transactional(readOnly = true)
public CaseActionPage loadActionPage(long caseId, User user) {
    Permission p = permissionRepository.find(user.id(), caseId);
    Case c = caseRepository.findById(caseId);
    List<Action> allowed = policy.allowedActions(c.status(), p.role());
    return new CaseActionPage(c, allowed);
}
```

Secara SQL ini read-only.

Secara bisnis, ini menentukan aksi yang boleh dilakukan. Jika stale, user bisa melihat action yang salah.

Jadi routing datasource tidak boleh hanya membaca flag `readOnly`.

Flag tersebut berguna, tetapi harus dikombinasikan dengan domain consistency decision.

---

## 12. Session Stickiness Setelah Write

Salah satu strategi paling praktis:

> Setelah request/session melakukan write, paksa read berikutnya ke primary selama window tertentu.

Contoh:

```text
POST /case/10/approve -> primary
mark session/user as recentlyWritten until now + 5 seconds
GET /case/10 -> primary
GET /dashboard -> bisa replica jika explicitly stale-safe
```

### 12.1 Kelebihan

- Mudah dipahami.
- Melindungi read-your-writes.
- Tidak perlu menunggu replica.
- Cocok untuk monolith/modular monolith.

### 12.2 Kekurangan

- Window terlalu pendek bisa gagal saat lag tinggi.
- Window terlalu panjang mengurangi benefit replica.
- Tidak menjamin monotonic read jika user berpindah device/session.
- Tidak cukup untuk background process yang tidak punya user session.

### 12.3 Implementation Idea

```java
public final class ConsistencyContext {
    private static final ThreadLocal<Mode> MODE = new ThreadLocal<>();

    public enum Mode {
        PRIMARY_REQUIRED,
        REPLICA_ALLOWED
    }

    public static void requirePrimary() {
        MODE.set(Mode.PRIMARY_REQUIRED);
    }

    public static boolean isPrimaryRequired() {
        return MODE.get() == Mode.PRIMARY_REQUIRED;
    }

    public static void clear() {
        MODE.remove();
    }
}
```

Routing datasource:

```java
public class ConsistencyRoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        if (ConsistencyContext.isPrimaryRequired()) {
            return "primary";
        }
        return "replica";
    }
}
```

Tetapi hati-hati: ThreadLocal harus dibersihkan di akhir request.

---

## 13. GTID-Based Read-After-Write Waiting

Strategi lebih presisi:

> Setelah write, catat posisi/GTID transaksi. Sebelum membaca dari replica, tunggu sampai replica sudah mencapai GTID tersebut.

Mental model:

```text
write committed at GTID X
        |
        v
read from replica only if replica has applied GTID X
```

### 13.1 Kelebihan

- Lebih presisi daripada time window.
- Bisa tetap memakai replica setelah replica catch up.
- Cocok untuk sistem dengan banyak read setelah write.

### 13.2 Kekurangan

- Menambah latency.
- Butuh akses ke GTID/position.
- Perlu timeout handling.
- Jika replica lag tinggi, request bisa lambat atau fallback primary.
- Lebih rumit secara implementasi.

### 13.3 Policy yang Masuk Akal

```text
If read needs own write:
    try replica wait for GTID up to 50-200ms
    if timeout:
        fallback to primary
```

Jangan menunggu terlalu lama di request interactive.

### 13.4 Pseudocode

```java
public CaseDto loadAfterWrite(long caseId, GtidToken token) {
    if (replicaLagGuard.replicaHasApplied(token, Duration.ofMillis(100))) {
        return replicaCaseRepository.findById(caseId);
    }
    return primaryCaseRepository.findById(caseId);
}
```

Pattern ini bagus secara teori, tetapi implementasinya harus disederhanakan dan diuji serius.

---

## 14. Lag-Aware Replica Selection

Jika punya banyak replica, jangan pilih secara random tanpa memperhatikan lag.

```text
replica_1 lag 50ms
replica_2 lag 5s
replica_3 lag 40s
```

Untuk bounded-stale read dengan budget 2 detik, hanya replica_1 yang boleh dipilih.

### 14.1 Replica Pool Metadata

Aplikasi/proxy bisa menjaga metadata:

```text
replica_id
current_lag_estimate
last_health_check
role
region
serves_interactive_reads
serves_reporting_reads
```

### 14.2 Routing Rule

```text
if stale_budget = 2s:
    choose healthy replica with lag <= 2s
else:
    fallback primary or fail gracefully
```

### 14.3 Jangan Campur Semua Replica

Pisahkan replica berdasarkan fungsi:

| Replica Type | Workload |
|---|---|
| interactive read replica | read ringan, latency rendah |
| reporting replica | query besar, export |
| delayed replica | recovery dari human error |
| DR replica | disaster recovery, cross-region |

Satu replica tidak ideal untuk semua tujuan.

---

## 15. Delayed Replica: Bukan Untuk Read Scaling Umum

Delayed replica sengaja dibuat tertinggal.

Kegunaan:

```text
Jika operator salah DELETE data di primary,
delayed replica mungkin masih punya data sebelum kesalahan.
```

Delayed replica berguna untuk recovery dari human error atau bad deployment.

Tetapi delayed replica buruk untuk interactive read.

Jangan memasukkan delayed replica ke pool read normal.

---

## 16. Read/Write Splitting dan Connection Pool

Dalam Java, read/write splitting biasanya berarti ada dua datasource:

```text
primaryDataSource
replicaDataSource
```

Masing-masing punya HikariCP pool.

### 16.1 Pool Terpisah

```yaml
app:
  datasource:
    primary:
      jdbcUrl: jdbc:mysql://mysql-primary:3306/app
      maximumPoolSize: 30
    replica:
      jdbcUrl: jdbc:mysql://mysql-replica-1:3306/app
      maximumPoolSize: 50
```

### 16.2 Bahaya Pool Terlalu Besar

Menambah replica pool tidak otomatis aman.

Jika 10 service instance masing-masing punya:

```text
primary pool = 30
replica pool = 50
```

maka potensi koneksi:

```text
primary = 300 connections
replica = 500 connections
```

Koneksi idle pun punya biaya memory dan resource di MySQL.

### 16.3 Transaction Pinning

Dalam satu transaction, jangan berpindah datasource sembarangan.

Buruk:

```text
BEGIN on primary
SELECT from replica
UPDATE primary
COMMIT primary
```

Jika operasi berada dalam satu unit konsistensi, gunakan satu connection ke primary.

### 16.4 Lazy Routing Trap

Routing datasource yang memilih target saat `getConnection()` dipanggil bisa salah jika context diset setelah connection sudah diambil.

Contoh:

```java
@Transactional
public void method() {
    // transaction manager mungkin sudah ambil connection di awal
    ConsistencyContext.requirePrimary(); // terlambat
    repository.findById(...);
}
```

Pastikan routing decision terjadi sebelum connection acquisition.

---

## 17. Read/Write Splitting dengan Spring

### 17.1 Simplified Architecture

```text
Controller
   |
Service
   |
Consistency policy
   |
Routing DataSource
   |------------------ primary HikariCP -> MySQL primary
   |------------------ replica HikariCP -> MySQL replica
```

### 17.2 Jangan Otomatis dari `readOnly`

Boleh menjadikan `readOnly=true` sebagai default hint, tetapi jangan sebagai sumber kebenaran tunggal.

Lebih aman:

```text
Explicit primary required > recent write marker > transaction write mode > readOnly hint > replica default
```

Contoh priority:

```java
if (ConsistencyContext.primaryRequired()) return PRIMARY;
if (RecentWriteContext.active()) return PRIMARY;
if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) return REPLICA;
return PRIMARY; // conservative default
```

Perhatikan default terakhir. Untuk sistem kritikal, default primary lebih aman daripada default replica.

### 17.3 Domain Service Example

```java
@Service
public class CaseCommandService {
    @Transactional
    public void approve(long caseId, long officerId) {
        ConsistencyContext.requirePrimary();

        EnforcementCase c = caseRepository.getForUpdate(caseId);
        c.approve(officerId);
        caseRepository.save(c);

        RecentWriteMarker.mark(caseId);
    }
}
```

Read side:

```java
@Service
public class CaseQueryService {
    @Transactional(readOnly = true)
    public CaseDetail detail(long caseId) {
        if (RecentWriteMarker.hasRecentWrite(caseId)) {
            ConsistencyContext.requirePrimary();
        }
        return caseRepository.detail(caseId);
    }

    @Transactional(readOnly = true)
    public Dashboard dashboard(DashboardFilter filter) {
        ConsistencyContext.allowReplica();
        return dashboardRepository.load(filter);
    }
}
```

---

## 18. Read/Write Splitting dan ORM

ORM bisa menyembunyikan query.

Risiko:

1. lazy loading membaca dari datasource yang tidak diharapkan
2. entity manager/session terikat ke satu connection
3. transaction boundary tidak jelas
4. read-only method tetap memicu flush
5. repository method terlihat read tetapi dipakai untuk command decision

### 18.1 Lazy Loading Trap

```java
Case c = caseRepository.findById(caseId); // primary
List<Event> events = c.getEvents();       // lazy query, bisa replica?
```

Jika datasource routing berubah di tengah request, lazy query bisa membaca snapshot berbeda.

Lebih baik:

- matikan lazy loading di boundary kritikal
- gunakan explicit query/projection
- pisahkan command model dan query model
- jangan mengandalkan entity graph untuk consistency-critical read

### 18.2 Flush Trap

Method read-only yang memodifikasi managed entity secara tidak sengaja bisa menyebabkan flush.

```java
@Transactional(readOnly = true)
public CaseDto load(long id) {
    Case c = repo.findById(id);
    c.touchViewedAt(); // mutation accidental
    return mapper.toDto(c);
}
```

Jika routing ke replica, write akan gagal atau lebih buruk: behavior tidak terduga tergantung setting.

---

## 19. Cache dan Replica: Staleness Bertumpuk

Replica lag bukan satu-satunya sumber stale data.

Aplikasi sering punya:

```text
browser cache
CDN cache
application cache
Redis cache
search index
read replica
```

Jika semua punya staleness sendiri, total stale behavior sulit dipahami.

### 19.1 Contoh Staleness Stack

```text
MySQL replica lag: 3s
Redis cache TTL: 30s
Search index lag: 10s
Frontend cache: 5s
```

User bisa melihat data lama bukan 3 detik, tetapi puluhan detik.

### 19.2 Rule

Untuk data yang consistency-critical:

```text
primary read > bypass cache > explicit validation
```

Untuk data stale-tolerant:

```text
replica + cache acceptable if staleness budget explicit
```

---

## 20. Search Index dan Replica: Dua Bentuk Eventual Consistency

Jika aplikasi memakai Elasticsearch/OpenSearch untuk search, maka ada dua jalur data:

```text
Primary MySQL -> replica MySQL
Primary MySQL -> binlog/outbox -> search index
```

Keduanya bisa lag berbeda.

Contoh:

```text
Search result menunjukkan case APPROVED,
detail dari replica menunjukkan UNDER_REVIEW.
```

Atau sebaliknya:

```text
Detail sudah APPROVED,
search belum menemukan case.
```

Solusi bukan “hilangkan semua lag”, tetapi desain boundary:

- search results bersifat discovery, stale boleh
- action/detail critical baca primary
- setelah update, UI bisa menampilkan state dari command response
- eventual consistency diberi kompensasi UX jika perlu

---

## 21. Consistency Boundary dalam Regulatory / Case-Management System

Dalam sistem regulatory/case-management, tidak semua read sama.

### 21.1 Domain Entities

Contoh entitas:

```text
enforcement_case
case_subject
case_event
enforcement_action
case_assignment
sla_timer
risk_score
document_submission
audit_log
```

### 21.2 Critical Operations

Operasi berikut harus strong:

| Operation | Mengapa Primary |
|---|---|
| approve case | transition harus berdasarkan state terbaru |
| reject submission | mencegah double decision |
| assign officer | ownership dan workload harus benar |
| revoke permission | security-critical |
| check idempotency | mencegah duplicate side effect |
| submit enforcement action | legal/audit correctness |
| compute next allowed action | stale state bisa menampilkan aksi ilegal |

### 21.3 Stale-Tolerant Operations

Operasi berikut bisa replica jika jelas staleness-nya:

| Operation | Staleness Budget |
|---|---:|
| dashboard backlog | 30-120s |
| monthly report | minutes/hours |
| officer workload trend | 30-300s |
| search list | beberapa detik acceptable |
| audit export historical | replica/reporting acceptable |

### 21.4 Mixed Page Pattern

Satu halaman bisa punya beberapa consistency requirement.

Contoh case detail page:

```text
Header status              -> primary if after write/action-sensitive
Allowed actions            -> primary
Historical event timeline  -> replica maybe acceptable
Related reports            -> replica
Audit trail latest event   -> primary or response-derived
```

Jangan menganggap satu endpoint = satu consistency level.

Kadang perlu memisahkan endpoint atau data source per section.

---

## 22. Designing API Responses to Avoid Immediate Re-Read

Salah satu cara mengurangi read-after-write bug adalah mengembalikan state baru dari command response.

Buruk:

```text
POST /cases/10/approve
-> 204 No Content
frontend langsung GET /cases/10 dari replica
```

Lebih baik:

```text
POST /cases/10/approve
-> 200 OK
{
  "caseId": 10,
  "status": "APPROVED",
  "version": 17,
  "approvedAt": "2026-06-22T10:15:30Z"
}
```

UI bisa langsung menampilkan state hasil command tanpa menunggu replica.

Tetapi hati-hati:

- response harus berasal dari committed state
- jangan mengembalikan state yang belum commit
- untuk detail kompleks tetap mungkin perlu primary read

---

## 23. Version Token untuk Monotonic Reads

Tambahkan version field pada entity penting.

```sql
CREATE TABLE enforcement_case (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    version BIGINT NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL
);
```

Jika client sudah melihat `version=17`, maka read berikutnya tidak boleh menampilkan `version < 17`.

### 23.1 Client-Side Seen Version

Client bisa mengirim:

```http
GET /cases/10
X-Min-Version: 17
```

Server policy:

```text
If replica returns version >= 17:
    return replica result
else:
    read primary
```

Ini memberikan monotonic read per entity.

### 23.2 Kelebihan

- Lebih domain-oriented daripada GTID.
- Mudah dipahami frontend/backend.
- Cocok untuk workflow entity.

### 23.3 Kekurangan

- Perlu version di table.
- Tidak menyelesaikan multi-entity causality otomatis.
- Harus diterapkan disiplin.

---

## 24. Routing Berdasarkan Domain Use Case

Daripada memberi repository kebebasan menentukan primary/replica, lebih baik service layer menentukan.

### 24.1 Command Service

```java
public class CaseCommandService {
    public ApproveResult approve(ApproveCommand command) {
        // primary required
    }
}
```

### 24.2 Query Service

```java
public class CaseQueryService {
    public CaseDetail getDetail(CaseDetailRequest request) {
        // primary or replica based on request consistency
    }

    public CaseSearchResult search(CaseSearchRequest request) {
        // replica allowed
    }
}
```

### 24.3 Explicit Query Contract

```java
public enum ConsistencyRequirement {
    STRONG,
    READ_YOUR_WRITES,
    MONOTONIC,
    BOUNDED_STALE,
    STALE_OK
}
```

Request:

```java
public record CaseDetailRequest(
    long caseId,
    ConsistencyRequirement consistency,
    Long minVersion
) {}
```

Ini lebih eksplisit daripada magic routing.

---

## 25. Handling Replica Unavailability

Read/write splitting memperkenalkan failure mode baru:

```text
primary healthy, replica down
```

Apa yang harus terjadi?

Jawabannya tergantung kategori read.

### 25.1 Stale-Safe Interactive Read

Jika replica down:

```text
fallback primary
```

Tetapi hati-hati: jika semua replica down dan semua traffic read fallback ke primary, primary bisa overload.

Perlu circuit breaker dan load shedding.

### 25.2 Heavy Reporting Read

Jika reporting replica down:

```text
do not fallback to primary automatically
```

Karena report query berat bisa membunuh primary.

Lebih baik:

```text
return 503/report temporarily unavailable
```

### 25.3 Critical Read

Critical read memang primary. Replica down tidak relevan.

### 25.4 Policy Table

| Read Type | Replica Down Policy |
|---|---|
| critical read | primary only |
| post-write read | primary fallback |
| dashboard | fallback primary only if cheap |
| export/report | fail/queue, do not primary fallback |
| search | degrade gracefully |

---

## 26. Handling Lag Spike

Jika lag spike, aplikasi harus tahu apa yang dilakukan.

### 26.1 Policy Options

1. Fallback primary
2. Return stale data with warning/internal marker
3. Return partial data
4. Defer report
5. Fail fast
6. Queue job

### 26.2 Jangan Satu Policy untuk Semua

Contoh:

```text
case action page lag spike -> primary
monthly export lag spike -> wait/queue
analytics dashboard lag spike -> show stale indicator
security permission check -> primary
```

### 26.3 Circuit Breaker

Jika replica lag > threshold:

```text
remove replica from interactive read pool
```

Jika primary mulai overload karena fallback:

```text
shed stale-safe traffic
protect write and critical reads
```

---

## 27. Observability untuk Replication Lag

Minimal pantau:

1. replica receiver status
2. replica applier status
3. seconds behind source
4. relay log backlog
5. apply throughput
6. transaction apply latency
7. lag per replica
8. replication errors
9. replica disk/CPU/I/O
10. number of long-running queries on replica
11. primary write rate
12. fallback-to-primary rate dari aplikasi
13. percentage read served by replica
14. stale read incidents

### 27.1 Application-Level Metrics

Database metric saja tidak cukup.

Tambahkan metric aplikasi:

```text
read_route{route="primary", reason="critical"}
read_route{route="primary", reason="recent_write"}
read_route{route="primary", reason="replica_lag"}
read_route{route="replica", reason="stale_ok"}
read_route{route="failed", reason="replica_unavailable"}
```

Ini membuat keputusan routing bisa diaudit.

### 27.2 Trace Annotation

Pada distributed tracing, tambahkan tag:

```text
db.role=primary|replica
consistency=strong|stale_ok|bounded_stale
replica.lag_ms=...
route.reason=recent_write|critical|dashboard|fallback
```

Saat incident, ini jauh lebih berguna daripada hanya tahu query lambat.

---

## 28. Testing Read/Write Splitting

Banyak bug read/write splitting tidak muncul di local development karena hanya ada satu database.

### 28.1 Local Test Topology

Untuk test lebih realistis:

```text
mysql-primary
mysql-replica
application
```

Lalu injeksi lag.

### 28.2 Lag Injection

Strategi:

- stop applier thread sementara
- delay replication
- proxy delay
- heavy query di replica
- throttled I/O

Tujuannya bukan meniru production sempurna, tetapi memaksa aplikasi menghadapi stale read.

### 28.3 Test Cases Penting

1. write lalu immediate read harus melihat write
2. permission revoke lalu read harus tidak mengizinkan akses
3. duplicate idempotency request tidak boleh double process
4. dashboard boleh stale
5. report tidak fallback ke primary saat replica down
6. lag spike membuat route berubah sesuai policy
7. user tidak melihat version lebih lama setelah melihat version baru

### 28.4 Contract Test Example

```java
@Test
void detailAfterApproveMustReadNewStatusEvenWhenReplicaLags() {
    long caseId = createCase(Status.UNDER_REVIEW);

    replicationController.pauseReplicaApply();

    ApproveResult result = commandService.approve(caseId, officerId);
    CaseDetail detail = queryService.detail(new CaseDetailRequest(
        caseId,
        ConsistencyRequirement.READ_YOUR_WRITES,
        result.version()
    ));

    assertThat(detail.status()).isEqualTo(Status.APPROVED);
    assertThat(detail.version()).isGreaterThanOrEqualTo(result.version());
}
```

---

## 29. Common Incident Patterns

### 29.1 Incident: User Sees Old Status After Submit

Symptoms:

```text
POST succeeded
GET shows old state
refresh later fixes it
```

Likely cause:

```text
read-after-write routed to replica
```

Fix:

- primary stickiness after write
- return command result
- min-version read
- GTID wait/fallback

### 29.2 Incident: Permission Revocation Not Immediate

Symptoms:

```text
user whose access was revoked still sees data for a few seconds
```

Likely cause:

```text
authorization read from stale replica/cache
```

Fix:

- permission checks primary
- cache invalidation
- revoke event forces primary path

### 29.3 Incident: Dashboard Causes Replica Lag

Symptoms:

```text
replica lag increases during office hours
slow report queries on replica
interactive reads stale
```

Likely cause:

```text
reporting and interactive reads share same replica
```

Fix:

- separate reporting replica
- query limits
- materialized summary
- schedule heavy exports

### 29.4 Incident: Random Old/New State Across Refreshes

Symptoms:

```text
refresh sometimes shows old, sometimes new
```

Likely cause:

```text
load balancer sends reads to replicas with different lag
```

Fix:

- lag-aware selection
- session stickiness
- min-version read
- remove lagging replica from pool

### 29.5 Incident: Primary Overload After Replica Failure

Symptoms:

```text
replica down
all read fallback to primary
primary CPU spikes
writes slow/fail
```

Likely cause:

```text
unbounded fallback
```

Fix:

- classify fallback policy
- block heavy reporting fallback
- circuit breaker
- load shed stale-safe traffic

---

## 30. Design Checklist untuk Read/Write Splitting

Sebelum mengaktifkan read/write splitting, jawab ini:

### 30.1 Domain Consistency

- Query mana yang stale-safe?
- Query mana yang stale-unsafe?
- Apakah authorization pernah membaca replica?
- Apakah idempotency pernah membaca replica?
- Apakah workflow transition guard pernah membaca replica?
- Apakah user perlu read-your-writes?
- Apakah monotonic read diperlukan?

### 30.2 Technical Routing

- Apakah datasource primary/replica terpisah?
- Apakah routing eksplisit atau magic?
- Apakah routing decision terjadi sebelum connection acquisition?
- Apakah transaction dipin ke satu datasource?
- Apakah ORM lazy loading bisa keluar dari consistency boundary?

### 30.3 Lag Handling

- Apakah lag dipantau per replica?
- Apakah ada threshold untuk remove replica dari pool?
- Apakah fallback policy berbeda untuk dashboard/report/critical read?
- Apakah delayed replica dikeluarkan dari read pool?

### 30.4 Observability

- Apakah setiap query tahu ia ke primary atau replica?
- Apakah route reason dicatat?
- Apakah fallback-to-primary rate dipantau?
- Apakah stale read incident bisa direkonstruksi?

### 30.5 Testing

- Apakah test environment punya replica lag?
- Apakah ada test read-after-write?
- Apakah ada test permission revoke?
- Apakah ada test idempotency duplicate?
- Apakah ada test replica down?

---

## 31. Recommended Policy untuk Java Production System

Untuk sistem penting, gunakan default konservatif:

```text
Default read: primary
Explicit stale-safe read: replica
```

Ini kebalikan dari banyak optimasi prematur.

Read/write splitting harus diaktifkan karena ada kebutuhan nyata:

- primary read load tinggi
- query tertentu jelas stale-safe
- observability sudah siap
- fallback policy sudah jelas
- testing lag sudah ada

Bukan karena “kita punya replica, jadi semua SELECT diarahkan ke replica”.

### 31.1 Policy Baseline

| Use Case | Route |
|---|---|
| command handler | primary |
| workflow guard | primary |
| authorization | primary |
| idempotency | primary |
| detail after mutation | primary/read-your-writes mechanism |
| search result list | replica allowed |
| dashboard summary | replica allowed with budget |
| export/report | reporting replica only |
| audit/legal latest view | primary unless explicitly historical |

---

## 32. Mental Model Akhir

Read/write splitting bukan optimization murni. Ia adalah distributed consistency decision.

Kalimat penting:

> Semua replica read adalah klaim bahwa query tersebut boleh melihat masa lalu.

Jika kamu tidak bisa menjelaskan seberapa lama masa lalu itu boleh terjadi dan apa konsekuensinya, query tersebut belum layak diarahkan ke replica.

Model akhir:

```text
Query correctness
    > SQL verb
    > framework annotation
    > performance optimization
```

Replica membantu scaling read, tetapi ia memperkenalkan waktu sebagai dimensi baru dalam correctness.

Dalam sistem workflow/regulatory, waktu sangat penting:

- status berubah
- permission berubah
- assignment berubah
- SLA berubah
- decision dibuat
- audit dicatat

Jika read stale dipakai untuk decision, kamu tidak sedang mengoptimalkan performa. Kamu sedang memasukkan nondeterminism ke proses bisnis.

---

## 33. Latihan Praktis

### Latihan 1 — Klasifikasi Query

Ambil 20 query dari aplikasi nyata. Klasifikasikan:

```text
STRONG
READ_YOUR_WRITES
MONOTONIC
BOUNDED_STALE
STALE_OK
```

Lalu tentukan routing-nya.

### Latihan 2 — Simulasi Lag

Buat test dengan primary dan replica. Pause replica apply, lalu jalankan:

1. create case
2. approve case
3. immediate detail read
4. dashboard read
5. permission revoke
6. permission check

Pastikan behavior sesuai policy.

### Latihan 3 — Design Recent Write Marker

Desain mekanisme:

```text
after write -> mark entity/user/session
read -> primary if marker active
expire marker after window
```

Diskusikan kelemahannya.

### Latihan 4 — Define Staleness Budget

Untuk sistem case-management, definisikan staleness budget untuk:

- case detail
- search result
- officer dashboard
- SLA report
- audit timeline
- permission check
- monthly export

### Latihan 5 — Failure Policy

Tentukan behavior saat:

- replica down
- replica lag 60s
- reporting replica down
- primary overloaded due fallback
- one replica stale, one healthy

---

## 34. Ringkasan

Kamu sekarang harus membawa beberapa prinsip utama:

1. Replica adalah copy asynchronous, bukan primary murah.
2. Lag harus dipahami secara teknis dan semantik.
3. `SELECT` tidak otomatis aman untuk replica.
4. `@Transactional(readOnly = true)` tidak berarti stale-safe.
5. Read-after-write perlu perlakuan khusus.
6. Authorization, idempotency, dan workflow guard biasanya harus primary.
7. Dashboard/search/report bisa replica jika staleness budget eksplisit.
8. Lag metric bisa menipu; observability aplikasi tetap diperlukan.
9. Fallback primary harus dibatasi agar tidak membunuh primary saat replica gagal.
10. Testing harus menginjeksi lag, bukan hanya test dengan single database.

---

## 35. Referensi Resmi dan Bacaan Lanjutan

Dokumen resmi MySQL yang relevan untuk bagian ini:

- MySQL Reference Manual — Replication
- MySQL Reference Manual — Replication Implementation
- MySQL Reference Manual — Checking Replication Status
- MySQL Reference Manual — Relay Log
- MySQL Reference Manual — GTID Concepts
- MySQL Reference Manual — Semisynchronous Replication
- MySQL Reference Manual — Delayed Replication

Topik lanjutan yang akan tersambung ke part berikutnya:

- HA topology
- failover
- semi-sync vs async trade-off
- InnoDB Cluster
- split brain
- fencing
- application behavior during failover
- RTO/RPO

---

# Status Seri

Seri belum selesai.

Kita sudah menyelesaikan:

- Part 000 — Orientation
- Part 001 — MySQL Architecture
- Part 002 — InnoDB Storage Model
- Part 003 — Primary Key Design
- Part 004 — MySQL Data Types
- Part 005 — Character Sets and Collations
- Part 006 — InnoDB MVCC
- Part 007 — Isolation Levels
- Part 008 — InnoDB Locking
- Part 009 — Deadlocks and Lock Wait Timeouts
- Part 010 — Index Internals
- Part 011 — Designing Indexes for Real Workloads
- Part 012 — MySQL Optimizer
- Part 013 — Query Execution Patterns
- Part 014 — Pagination, Search, Filtering
- Part 015 — Transactions in Java Applications
- Part 016 — JDBC, Connector/J, HikariCP
- Part 017 — Write Path Internals
- Part 018 — Buffer Pool, Memory, and I/O Behavior
- Part 019 — Configuration That Actually Matters
- Part 020 — Binary Log and Replication Fundamentals
- Part 021 — Replication Lag, Read/Write Splitting, and Consistency Boundaries

Bagian berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-022.md
```

Topik berikutnya:

```text
High Availability: Failover, Topologies, and Failure Modes
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Binary Log and Replication Fundamentals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-022.md">Part 022 — High Availability: Failover, Topologies, and Failure Modes ➡️</a>
</div>
