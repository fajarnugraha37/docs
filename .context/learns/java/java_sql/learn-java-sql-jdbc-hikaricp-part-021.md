# learn-java-sql-jdbc-hikaricp-part-021

# Pool Sizing: From Guesswork to Capacity Model

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `021` dari `029`  
> Topik: JDBC Connection Pool Sizing, HikariCP `maximumPoolSize`, database capacity, queueing, latency, throughput, backpressure, Kubernetes multiplier, multi-service connection budget.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa ukuran connection pool bukan angka “semakin besar semakin baik”.
2. Melihat pool sebagai **capacity gate**, **concurrency limiter**, dan **backpressure boundary**.
3. Menentukan starting point `maximumPoolSize` secara rasional.
4. Membedakan antara:
   - jumlah request aplikasi,
   - jumlah thread aplikasi,
   - jumlah koneksi pool,
   - jumlah active database sessions,
   - jumlah transaksi yang benar-benar sedang bekerja.
5. Menghindari kesalahan klasik: menaikkan pool size saat database sedang lambat.
6. Menghitung efek Kubernetes replica terhadap total koneksi database.
7. Mendesain pool berbeda untuk workload berbeda: OLTP, reporting, batch, scheduler, background worker, read replica.
8. Membaca metrik HikariCP untuk memutuskan apakah pool terlalu kecil, terlalu besar, atau masalahnya bukan di pool.
9. Membuat tuning workflow berbasis measurement, bukan feeling.
10. Menyusun checklist production review untuk pool sizing.

---

## 1. Premis Utama: Pool Size adalah Batas Concurrency, Bukan Kapasitas Tambahan

Connection pool sering salah dipahami sebagai cara menambah kemampuan database.

Padahal connection pool tidak membuat database lebih kuat.

Pool hanya mengontrol **berapa banyak pekerjaan database yang boleh aktif secara bersamaan dari aplikasi tertentu**.

Mental model yang benar:

```text
Application requests
        |
        v
Application worker threads / virtual threads / request handlers
        |
        v
HikariCP pool queue
        |
        v
Borrowed JDBC connections
        |
        v
Database sessions / backend processes / server connections
        |
        v
Database CPU + memory + locks + buffer cache + disk + network
```

Jika database hanya mampu memproses 20 transaksi secara efektif, memberi 200 koneksi aktif tidak membuat 200 transaksi selesai lebih cepat.

Yang biasanya terjadi:

```text
lebih banyak koneksi
  -> lebih banyak active sessions
  -> lebih banyak context switching
  -> lebih banyak lock contention
  -> lebih banyak memory pressure
  -> lebih banyak query saling mengganggu
  -> latency naik
  -> timeout naik
  -> retry naik
  -> beban makin parah
```

Pool size yang baik bukan yang paling besar.

Pool size yang baik adalah yang membuat database **saturate secara sehat**, bukan **collapse karena oversubscription**.

---

## 2. Kenapa Intuisi Developer Sering Salah

Intuisi awal yang umum:

```text
Request makin banyak -> butuh connection makin banyak.
Connection makin banyak -> throughput makin tinggi.
Pool penuh -> berarti pool kurang besar.
Thread menunggu connection -> berarti maximumPoolSize harus dinaikkan.
```

Intuisi itu hanya benar dalam sebagian kecil kondisi.

Yang lebih akurat:

```text
Request makin banyak -> butuh admission control.
Connection makin banyak -> throughput naik hanya sampai titik saturasi.
Setelah saturasi -> connection tambahan menurunkan throughput.
Pool penuh -> bisa berarti database lambat, query lambat, transaksi terlalu panjang, atau pool memang terlalu kecil.
Thread menunggu connection -> bisa jadi backpressure yang justru menyelamatkan database.
```

Pool yang kecil dan terukur sering menghasilkan throughput lebih baik daripada pool besar yang membuat database diserbu terlalu banyak pekerjaan bersamaan.

---

## 3. Bedakan User Concurrency, Request Concurrency, dan Database Concurrency

Salah satu sumber sizing salah adalah mencampur banyak jenis concurrency.

### 3.1 User concurrency

Contoh:

```text
10.000 user sedang login.
```

Ini bukan berarti butuh 10.000 database connection.

Sebagian besar user:

- sedang membaca UI,
- berpikir,
- idle,
- menunggu network,
- melakukan aktivitas non-database,
- memakai cache,
- tidak sedang membuat transaksi database.

### 3.2 HTTP request concurrency

Contoh:

```text
500 request sedang diproses aplikasi.
```

Ini juga bukan berarti butuh 500 database connection.

Sebagian request bisa:

- tidak menyentuh database,
- memakai cache,
- hanya validasi input,
- menunggu service lain,
- menunggu queue,
- melakukan CPU work,
- sudah selesai query tetapi masih render response.

### 3.3 Application thread concurrency

Contoh:

```text
Tomcat max threads = 200.
```

Ini bukan berarti pool harus 200.

Application thread count menentukan berapa banyak pekerjaan aplikasi yang bisa berjalan bersamaan, bukan berapa banyak database transaction yang sehat.

### 3.4 Database concurrency

Yang paling relevan untuk pool sizing adalah:

```text
Berapa banyak database operations/transactions yang boleh aktif bersamaan tanpa membuat database melewati titik saturasi sehat?
```

Inilah yang diwakili oleh `maximumPoolSize`, walaupun tidak sempurna.

---

## 4. Pool sebagai Admission Control

Connection pool adalah bentuk **admission control**.

Artinya, pool menentukan pekerjaan mana yang boleh masuk ke database sekarang dan mana yang harus menunggu.

Tanpa admission control:

```text
1000 request datang
  -> 1000 transaksi mencoba masuk DB
  -> DB oversubscribed
  -> semua melambat
  -> sebagian timeout
  -> retry storm
  -> sistem collapse
```

Dengan admission control:

```text
1000 request datang
  -> hanya 20 transaksi aktif ke DB
  -> 980 menunggu di boundary aplikasi
  -> DB tetap stabil
  -> latency antrean bisa naik
  -> tetapi throughput dan recovery lebih terkendali
```

Ini terdengar kontraintuitif: “menunggu” bisa membuat transaksi selesai lebih cepat.

Namun jika database sudah penuh, menambah pekerjaan aktif hanya membuat semuanya saling berebut resource.

Lebih baik sebagian pekerjaan menunggu sebelum masuk database daripada semuanya masuk dan memperlambat satu sama lain.

---

## 5. Bentuk Kurva: Throughput vs Active Connections

Secara konseptual, performa database terhadap jumlah koneksi aktif berbentuk seperti ini:

```text
Throughput
   ^
   |                         ________
   |                       _/        \_
   |                    __/            \__
   |                 __/                  \__
   |              __/
   |           __/
   |        __/
   |______/____________________________________> Active DB connections
          underutilized   sweet spot   oversubscribed
```

Ada tiga zona.

### 5.1 Underutilized zone

Jumlah koneksi aktif terlalu kecil.

Gejala:

- database CPU rendah,
- disk/network tidak penuh,
- pool pending tinggi,
- query individual cepat,
- throughput naik saat pool dinaikkan.

Dalam zona ini, menaikkan pool size bisa membantu.

### 5.2 Sweet spot zone

Jumlah koneksi aktif cukup untuk menggunakan resource database secara optimal.

Gejala:

- throughput stabil/tinggi,
- latency masih sehat,
- DB CPU cukup tinggi tetapi tidak saturasi ekstrem,
- lock wait terkendali,
- pool pending sesekali saja,
- P95/P99 masih dalam budget.

Ini target.

### 5.3 Oversubscribed zone

Koneksi aktif terlalu banyak.

Gejala:

- DB CPU tinggi tetapi throughput tidak naik,
- latency P95/P99 memburuk,
- context switch meningkat,
- lock wait meningkat,
- memory pressure naik,
- query makin lambat,
- timeout naik,
- retry naik,
- pool terlihat “sibuk terus”.

Dalam zona ini, menaikkan pool size memperparah masalah.

---

## 6. Rumus Bukan Jawaban Final, Tapi Starting Point

Ada formula populer untuk starting point connection pool:

```text
connections ≈ (core_count * 2) + effective_spindle_count
```

Interpretasi:

- `core_count` = jumlah physical CPU core database server, bukan hyperthread.
- `effective_spindle_count` = seberapa banyak disk I/O blocking yang realistis.
- Jika working set mostly cached di RAM atau storage sangat cepat, effective spindle bisa mendekati 0.
- Jika banyak random I/O ke disk lambat, angka ini bisa lebih tinggi.

Namun formula ini bukan hukum alam.

Ia hanya starting point untuk memahami bahwa optimal active DB connections biasanya jauh lebih kecil daripada jumlah user/request/thread.

Contoh kasar:

```text
DB server:
- 8 physical cores
- active working set mostly cached
- effective_spindle_count = 0

Starting point:
(8 * 2) + 0 = 16 active connections
```

Banyak engineer terkejut karena angka ini jauh dari 100, 200, atau 500.

Tetapi untuk workload OLTP, angka kecil sering lebih sehat.

---

## 7. Kenapa SSD Tidak Berarti Pool Harus Lebih Besar

Intuisi salah:

```text
SSD lebih cepat -> database bisa menerima lebih banyak koneksi -> pool boleh jauh lebih besar.
```

Yang sering lebih benar:

```text
SSD lebih cepat -> query lebih sedikit blocking pada disk -> lebih dekat ke CPU-bound -> pool optimal bisa lebih dekat ke jumlah core.
```

Pada disk lambat, thread/koneksi sering menunggu I/O. Saat sebagian koneksi menunggu disk, CPU bisa dipakai koneksi lain. Maka active connection lebih banyak dari core bisa membantu.

Pada SSD/NVMe/cache yang cepat, blocking lebih kecil. Jika terlalu banyak koneksi aktif, mereka lebih cepat berebut CPU, memory bandwidth, lock, latch, buffer cache, dan internal DB structures.

Jadi storage lebih cepat tidak otomatis berarti pool harus lebih besar.

---

## 8. `maximumPoolSize` dalam HikariCP

Dalam HikariCP, knob utama pool sizing adalah:

```properties
maximumPoolSize=10
```

Maknanya:

```text
Jumlah maksimum physical JDBC connections yang boleh dibuka HikariCP ke database untuk pool tersebut.
```

Jika semua connection sedang dipakai dan request baru memanggil:

```java
DataSource.getConnection()
```

maka caller akan menunggu sampai:

1. ada connection dikembalikan,
2. connection baru bisa dibuat karena pool belum mencapai maksimum,
3. atau menunggu sampai `connectionTimeout` lalu gagal.

`maximumPoolSize` adalah batas concurrency database dari satu pool di satu process aplikasi.

Jika aplikasi berjalan di Kubernetes dengan 8 pod, total koneksi maksimum bukan `maximumPoolSize`.

Totalnya:

```text
maximumPoolSize per pod * jumlah pod
```

Jika ada beberapa service, totalnya:

```text
Σ(maximumPoolSize service_i * replicas_i * jumlah_pool_i)
```

Inilah alasan konfigurasi yang terlihat kecil per service bisa menjadi besar di level database.

---

## 9. Jangan Samakan Pool Size dengan Tomcat Threads

Contoh konfigurasi:

```properties
server.tomcat.threads.max=200
spring.datasource.hikari.maximumPoolSize=200
```

Ini sering buruk.

Kenapa?

Karena 200 HTTP worker bukan berarti database mampu menjalankan 200 query/transaction bersamaan.

Lebih sehat:

```properties
server.tomcat.threads.max=200
spring.datasource.hikari.maximumPoolSize=16
spring.datasource.hikari.connectionTimeout=1000
```

Artinya:

- aplikasi bisa menerima/memproses banyak request,
- tetapi hanya 16 operasi DB aktif dari pod itu,
- sisanya menunggu atau gagal cepat jika antrean terlalu lama.

Namun angka 16 bukan universal. Itu harus divalidasi.

---

## 10. Pool Wait Bukan Selalu Masalah

Saat thread menunggu connection, banyak engineer panik.

Tetapi pool wait memiliki dua interpretasi berbeda.

### 10.1 Pool wait sehat

Pool wait sehat terjadi saat:

- traffic spike sementara,
- database masih stabil,
- wait time kecil,
- P95/P99 masih dalam SLA,
- throughput tidak turun,
- tidak ada timeout signifikan.

Dalam kondisi ini, pool sedang bekerja sebagai backpressure.

### 10.2 Pool wait tidak sehat

Pool wait tidak sehat terjadi saat:

- pending threads terus tinggi,
- active connections selalu maximum,
- connection usage time panjang,
- DB query latency naik,
- transaction duration panjang,
- connection timeout error muncul,
- throughput turun.

Tetapi akar masalahnya belum tentu pool terlalu kecil.

Kemungkinan akar masalah:

1. Query lambat.
2. Lock wait.
3. Transaction terlalu panjang.
4. External call dilakukan saat connection masih dipegang.
5. Batch job memakai pool OLTP.
6. DB CPU/IO saturasi.
7. Connection leak.
8. Replica aplikasi bertambah tanpa connection budget.
9. Network/database failover.

Menaikkan pool size tanpa diagnosis bisa memperparah.

---

## 11. Cara Membaca Metrik HikariCP untuk Sizing

Metrik HikariCP yang penting:

```text
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.max
hikaricp.connections.min
hikaricp.connections.timeout
hikaricp.connections.acquire
hikaricp.connections.usage
hikaricp.connections.creation
```

Nama aktual bisa berbeda tergantung Micrometer/Dropwizard/Prometheus integration, tetapi konsepnya sama.

### 11.1 Active connections

```text
connections.active
```

Menunjukkan jumlah connection yang sedang dipinjam aplikasi.

Jika selalu mendekati `maximumPoolSize`, jangan langsung naikkan pool.

Tanya dulu:

```text
Connection sedang aktif karena query memang banyak?
Atau karena connection dipegang terlalu lama?
```

### 11.2 Idle connections

```text
connections.idle
```

Menunjukkan connection siap dipakai.

Jika idle selalu tinggi:

- pool mungkin terlalu besar,
- traffic rendah,
- `minimumIdle` terlalu tinggi,
- resources DB terpakai untuk session idle.

### 11.3 Pending threads

```text
connections.pending
```

Menunjukkan caller yang sedang menunggu connection.

Pending tidak selalu buruk. Pending buruk jika terus-menerus tinggi dan menyebabkan timeout/SLA breach.

### 11.4 Acquisition time

```text
connection acquire duration
```

Waktu dari `getConnection()` sampai connection berhasil dipinjam.

Jika acquisition naik:

- pool penuh,
- connection creation lambat,
- DB login lambat,
- network lambat,
- pool sedang recovery,
- active connection usage terlalu lama.

### 11.5 Usage time

```text
connection usage duration
```

Waktu connection dipinjam sampai dikembalikan.

Ini sangat penting.

Jika usage time tinggi, penyebabnya sering bukan pool size, melainkan:

- query lambat,
- lock wait,
- result set besar,
- mapping lambat,
- external call terjadi di dalam transaction,
- business logic berat dilakukan sambil memegang connection,
- streaming terlalu lama,
- batch terlalu besar.

### 11.6 Creation time

```text
connection creation duration
```

Jika tinggi:

- DB login lambat,
- TLS handshake mahal,
- DNS lambat,
- network bermasalah,
- database overloaded,
- credential/auth backend lambat,
- connection storm saat startup.

---

## 12. Little's Law untuk Pool Sizing

Little's Law:

```text
L = λ * W
```

Dalam konteks JDBC:

```text
concurrent DB work ≈ DB throughput * average DB service time
```

Atau lebih praktis:

```text
required active connections ≈ target_db_ops_per_second * average_connection_hold_time_seconds
```

Contoh:

```text
Target throughput: 200 DB operations/second
Average connection hold time: 40 ms = 0.04 second

Required concurrency ≈ 200 * 0.04 = 8 connections
```

Jika pakai P95 agar lebih konservatif:

```text
Target throughput: 200 ops/sec
P95 connection hold time: 100 ms = 0.1 second

Concurrency ≈ 200 * 0.1 = 20 connections
```

Namun hati-hati.

Little's Law membantu memperkirakan kebutuhan concurrency, tetapi tidak menjamin database mampu menjalankan concurrency itu dengan sehat.

Kamu tetap harus mengecek:

- DB CPU,
- DB wait events,
- lock wait,
- IO wait,
- query plans,
- memory pressure,
- pool pending,
- error rate.

---

## 13. Connection Hold Time adalah Variabel Paling Penting

Pool size sering dibahas terlalu banyak, sementara connection hold time diabaikan.

Padahal:

```text
Semakin lama connection dipegang,
semakin sedikit throughput yang bisa dilayani oleh pool yang sama.
```

Contoh:

```text
Pool size = 10
Average hold time = 50 ms
Approx max throughput = 10 / 0.05 = 200 ops/sec
```

Jika hold time memburuk:

```text
Pool size = 10
Average hold time = 500 ms
Approx max throughput = 10 / 0.5 = 20 ops/sec
```

Tanpa mengubah pool size, throughput turun 10x.

Karena itu optimasi terbaik sering bukan:

```text
maximumPoolSize 10 -> 50
```

Tetapi:

```text
connection hold time 500 ms -> 80 ms
```

Cara menurunkan hold time:

1. Ambil connection sedekat mungkin dengan query.
2. Kembalikan connection secepat mungkin.
3. Jangan melakukan HTTP call saat connection masih dipegang.
4. Jangan melakukan file processing besar dalam transaction.
5. Jangan mapping/serialization berat sebelum close connection.
6. Jangan stream response lambat sambil connection terbuka kecuali memang didesain.
7. Pisahkan query reporting dari OLTP pool.
8. Perbaiki query plan dan index.
9. Kecilkan batch jika lock terlalu lama.
10. Hindari transaction boundary terlalu lebar.

---

## 14. Formula Throughput Sederhana

Sebagai model kasar:

```text
max throughput ≈ pool_size / average_connection_hold_time
```

Contoh:

| Pool Size | Avg Hold Time | Approx Throughput |
|---:|---:|---:|
| 10 | 50 ms | 200 ops/sec |
| 10 | 100 ms | 100 ops/sec |
| 10 | 500 ms | 20 ops/sec |
| 20 | 50 ms | 400 ops/sec |
| 20 | 500 ms | 40 ops/sec |

Namun ini bukan kapasitas database final.

Ini hanya kapasitas pool secara matematis jika DB mampu melayani load itu.

Jika database saturasi di 150 ops/sec, maka pool size 50 tidak membuat throughput 1000 ops/sec. Ia hanya membuat lebih banyak pekerjaan bersamaan yang melambat.

---

## 15. Sizing dari Sisi Database: Connection Budget

Database punya batas resources.

Kita perlu membuat connection budget.

Misal database PostgreSQL/RDS/Oracle punya limit praktis:

```text
Total safe application active connections: 120
```

Jangan gunakan semua untuk satu service.

Butuh reserved capacity untuk:

- admin connection,
- DBA session,
- migration tool,
- monitoring,
- incident response,
- BI/reporting controlled access,
- emergency direct connection,
- other applications,
- replication/internal process tergantung engine.

Contoh budget:

```text
Database safe app connection budget: 120
Reserved admin/monitoring/emergency: 20
Budget untuk services: 100
```

Jika ada 5 service:

```text
Service A critical OLTP: 30
Service B case workflow: 25
Service C reporting API: 10
Service D scheduler: 10
Service E background worker: 15
Buffer: 10
```

Setiap service harus menghitung replica.

Contoh:

```text
Service A replicas = 5
Budget Service A = 30
maximumPoolSize per pod = floor(30 / 5) = 6
```

Jika kamu set per pod 30:

```text
30 * 5 = 150 connections
```

Itu sudah melampaui budget Service A sendiri dan mungkin seluruh DB.

---

## 16. Kubernetes Multiplier Problem

Di VM monolith, pool size 30 berarti 30 connection.

Di Kubernetes, pool size 30 bisa berarti ratusan connection.

Contoh:

```text
service-a replicas: 8 pods
Hikari maximumPoolSize: 30
Total potential DB connections: 240
```

Jika ada 6 service dengan pola sama:

```text
6 services * 8 pods * 30 = 1440 connections
```

Ini sering terjadi saat konfigurasi pool dicopy-paste dari satu aplikasi ke semua service tanpa menghitung total.

Masalah makin parah karena autoscaling.

```text
normal replicas: 4
peak replicas: 12
maximumPoolSize: 20

normal connection cap: 80
peak connection cap: 240
```

HPA yang menaikkan pod bisa tanpa sengaja melakukan connection storm ke database.

### Aturan praktis untuk Kubernetes

Selalu hitung:

```text
max_connections_from_service = max_replicas * maximumPoolSize * number_of_pools_per_pod
```

Bukan:

```text
current_replicas * maximumPoolSize
```

Karena incident sering terjadi saat scaling, bukan saat normal.

---

## 17. Multi-Pool dalam Satu Aplikasi

Satu aplikasi bisa punya lebih dari satu pool:

```text
mainWriteDataSource
readReplicaDataSource
reportingDataSource
batchDataSource
schedulerDataSource
```

Total koneksi per pod:

```text
sum(maximumPoolSize semua pool)
```

Contoh:

```text
write pool: 10
read pool: 20
reporting pool: 5
batch pool: 5

Total per pod: 40
Replicas: 6
Total potential connections: 240
```

Jangan hanya melihat satu property `spring.datasource.hikari.maximumPoolSize` jika aplikasi punya custom datasource lain.

---

## 18. Pisahkan Pool berdasarkan Workload

Satu pool untuk semua jenis pekerjaan sering menyebabkan starvation.

Contoh buruk:

```text
Pool size = 20
- request OLTP cepat
- export Excel 5 menit
- nightly batch
- report query berat
- scheduler data correction
```

Jika 20 koneksi dihabiskan report/export, request OLTP ikut timeout.

Lebih sehat:

```text
OLTP pool: 12
reporting pool: 4
batch pool: 2
scheduler pool: 2
```

Ini bukan untuk menambah total kapasitas secara sembarangan, tetapi untuk membuat **bulkhead**.

Jika reporting lambat, OLTP tetap punya connection reserve.

---

## 19. OLTP Pool Sizing

OLTP workload biasanya:

- query pendek,
- transaction pendek,
- latency-sensitive,
- high QPS,
- banyak index lookup,
- banyak state transition,
- commit cepat.

Pool OLTP sebaiknya:

```text
kecil sampai sedang,
terukur,
connectionTimeout relatif pendek,
transaction boundary ketat,
query timeout jelas,
```

Contoh starting point per pod:

```properties
maximumPoolSize=8
minimumIdle=8
connectionTimeout=1000
```

Tetapi angka ini tergantung:

- jumlah pod,
- database capacity,
- target QPS,
- hold time,
- query shape,
- DB engine,
- lock contention.

Untuk OLTP, lebih penting menjaga transaction pendek daripada menaikkan pool.

---

## 20. Reporting Pool Sizing

Reporting workload biasanya:

- query panjang,
- scan besar,
- join berat,
- aggregation,
- result set besar,
- memory/temporary space besar,
- latency lebih longgar.

Reporting pool sebaiknya kecil.

Contoh:

```properties
reporting.maximumPoolSize=2
reporting.connectionTimeout=3000
```

Kenapa kecil?

Karena satu reporting query bisa sangat mahal. Jika 20 reporting query berat berjalan bersamaan, database bisa rusak performanya untuk semua workload.

Jika reporting penting dan berat:

- gunakan read replica,
- materialized view,
- data warehouse,
- async export job,
- precomputed projection,
- separate reporting DB,
- queue-based concurrency limiter.

Jangan biarkan reporting query memakai pool OLTP tanpa batas.

---

## 21. Batch/Worker Pool Sizing

Batch workload biasanya:

- write besar,
- delete besar,
- migration,
- reconciliation,
- sync external system,
- archival,
- backfill.

Pool batch harus kecil dan sengaja dibatasi.

Contoh:

```properties
batch.maximumPoolSize=2
batch.connectionTimeout=5000
```

Untuk batch, throughput sering lebih baik diatur melalui:

- batch size,
- chunk size,
- commit interval,
- sleep/backoff,
- partitioning,
- lock ordering,
- index strategy,
- off-peak schedule,
- queue concurrency.

Bukan dengan membuka 50 koneksi.

---

## 22. Scheduler Pool Sizing

Scheduler sering diremehkan.

Contoh scheduler:

- reminder email,
- deadline escalation,
- status synchronization,
- cleanup,
- archival,
- retry pending transaction,
- report generation.

Jika scheduler memakai pool yang sama dengan request API, scheduler bisa mengganggu user traffic.

Untuk scheduler yang ringan, pool kecil cukup:

```properties
scheduler.maximumPoolSize=1-3
```

Untuk scheduler berat, lebih baik:

- pisah deployment,
- pisah pool,
- pisah DB user,
- pisah lock/advisory lock,
- batasi concurrency.

---

## 23. Read Replica Pool

Read replica bisa membantu, tetapi bukan obat ajaib.

Read replica pool perlu sizing sendiri.

Pertanyaan penting:

1. Apakah query boleh membaca data stale?
2. Berapa replication lag acceptable?
3. Apakah read replica punya CPU/memory cukup?
4. Apakah workload read berat akan mengganggu replication apply?
5. Apakah query reporting tetap perlu dibatasi?

Contoh:

```text
write pool: 8
read replica pool: 12
reporting replica pool: 2
```

Namun jika read path juga bagian dari transaction consistency, hati-hati dengan read-after-write anomaly.

---

## 24. Pool Sizing dan Transaction Duration

Pool size tidak bisa dipisahkan dari transaction duration.

Contoh buruk:

```java
@Transactional
public void approveCase(UUID caseId) {
    Case c = repository.findForUpdate(caseId);
    externalDocumentService.generatePdf(c);       // HTTP call 2 seconds
    emailService.sendApprovalEmail(c);            // SMTP/API call 1 second
    repository.updateStatus(caseId, APPROVED);
    auditRepository.insert(...);
}
```

Masalah:

- connection dipegang selama external call,
- lock mungkin ditahan lama,
- pool slot habis,
- transaksi lain menunggu,
- deadlock/timeout risk naik.

Lebih sehat:

```java
public void approveCase(UUID caseId) {
    ApprovalResult result = transactionTemplate.execute(tx -> {
        Case c = repository.findForUpdate(caseId);
        repository.updateStatus(caseId, APPROVED);
        auditRepository.insert(...);
        outboxRepository.insertApprovalEvent(...);
        return new ApprovalResult(c.id());
    });

    // dilakukan setelah commit via outbox/worker/event handler
}
```

Pool sizing yang baik tidak bisa menyelamatkan transaction boundary yang buruk.

---

## 25. Pool Sizing dan Lock Contention

Saat lock contention terjadi, connection hold time naik.

Misal:

```text
Normal query time: 20 ms
Saat lock wait: 2 seconds
```

Pool size 10:

```text
normal throughput approx = 10 / 0.02 = 500 ops/sec
lock wait throughput approx = 10 / 2 = 5 ops/sec
```

Saat lock storm, pool bisa penuh bukan karena pool kecil, tetapi karena semua connection menunggu lock.

Menaikkan pool ke 50 bisa membuat 50 session menunggu lock, memperberat database.

Solusi lebih tepat:

- perbaiki transaction ordering,
- kurangi transaction duration,
- gunakan optimistic locking,
- gunakan `SELECT FOR UPDATE SKIP LOCKED` untuk worker queue jika cocok,
- gunakan unique constraint/idempotency key,
- retry dengan jitter untuk deadlock/serialization failure,
- pisahkan hot row/counter,
- kurangi batch lock footprint.

---

## 26. Pool Sizing dan Query Plan Buruk

Pool penuh sering akibat query plan buruk.

Gejala:

```text
active connections high
usage time high
DB CPU high or IO high
slow query log menunjukkan query yang sama
pool pending naik
```

Menaikkan pool membuat query buruk berjalan lebih banyak bersamaan.

Efek:

```text
satu query buruk -> 5 query buruk bersamaan -> DB lambat
pool dinaikkan -> 50 query buruk bersamaan -> DB collapse
```

Solusi:

- periksa execution plan,
- index missing,
- stale statistics,
- bind parameter selectivity,
- pagination buruk,
- function on indexed column,
- implicit conversion,
- N+1 query,
- fetching terlalu banyak kolom/baris,
- unnecessary joins,
- LOB ikut diambil pada listing query.

---

## 27. Pool Sizing dan N+1 Query

N+1 query memperbesar connection hold time dan database round-trip.

Contoh:

```text
1 query list cases
100 query fetch applicant per case
100 query fetch documents per case
100 query fetch audit summary per case

Total: 301 queries untuk satu request
```

Walaupun setiap query cepat, total hold time bisa besar.

Dengan pool size 10, beberapa request paralel cukup untuk membuat pool penuh.

Solusi:

- join/projection tepat,
- batch fetch,
- query aggregation,
- precomputed summary,
- cache read-only dimension,
- pagination yang benar,
- observability jumlah query per request.

---

## 28. Pool Sizing dan Connection Leak

Connection leak membuat pool tampak terlalu kecil.

Gejala:

```text
active connections naik dan tidak turun
idle connections turun ke 0
pending threads naik
connection timeout terjadi
DB query tidak menunjukkan aktivitas sebanding
```

Ini beda dengan query lambat.

Pada leak, connection dipinjam tetapi tidak dikembalikan.

Solusi:

- try-with-resources,
- perbaiki ownership boundary,
- aktifkan Hikari `leakDetectionThreshold` sementara,
- periksa async/lazy iterator yang membawa connection keluar scope,
- hindari menyimpan `Connection` sebagai field,
- pastikan streaming menutup resource.

Pool size dinaikkan hanya menunda kegagalan.

---

## 29. Pool Sizing dan Startup Storm

Saat banyak pod start bersamaan, setiap pod bisa mencoba membuka `minimumIdle` atau koneksi awal.

Contoh:

```text
20 pod rolling restart
minimumIdle=10

Potensi connection creation burst: 200
```

Jika database sedang restart/failover, ini bisa memperlambat recovery.

Mitigasi:

- rolling update bertahap,
- readiness probe yang benar,
- startup jitter,
- `minimumIdle` tidak terlalu tinggi untuk workload tertentu,
- DB connection limit budget,
- fail-fast policy sesuai kebutuhan,
- connectionTimeout/loginTimeout realistis,
- Hikari maxLifetime/keepalive tidak sinkron semua pod.

---

## 30. Pool Sizing dan Autoscaling

Autoscaling aplikasi berdasarkan CPU atau request latency bisa membuat database makin berat.

Skenario:

```text
DB lambat -> request latency naik
HPA melihat latency/CPU app naik -> tambah pod
pod baru membuka pool baru -> DB menerima connection tambahan
DB makin lambat -> latency makin naik
HPA tambah pod lagi
```

Ini positive feedback loop yang buruk.

Mitigasi:

1. Hitung max replica dalam connection budget.
2. Gunakan pool size per pod yang kecil.
3. Scale berdasarkan metrik yang tidak memperparah DB, atau kombinasikan dengan DB health.
4. Gunakan queue/backpressure.
5. Gunakan circuit breaker/degradation saat DB saturasi.
6. Pisahkan worker concurrency dari pod replica.
7. Pastikan HPA tidak membuat total connection melampaui DB budget.

---

## 31. Sizing Workflow Praktis

Berikut workflow yang bisa dipakai di production engineering.

### Step 1 — Inventory semua pool

Catat:

```text
service name
pool name
max replicas
current replicas
maximumPoolSize
minimumIdle
database target
DB user
workload type
```

Contoh tabel:

| Service | Pool | Max Replicas | Max Pool | Total Cap | Workload |
|---|---:|---:|---:|---:|---|
| case-api | write | 6 | 8 | 48 | OLTP |
| case-api | read | 6 | 8 | 48 | read |
| report-api | report | 3 | 3 | 9 | reporting |
| worker | batch | 4 | 2 | 8 | batch |
| scheduler | main | 2 | 2 | 4 | scheduler |

Total cap:

```text
48 + 48 + 9 + 8 + 4 = 117
```

### Step 2 — Tentukan database connection budget

Contoh:

```text
DB max connection setting: 200
Reserved system/admin/monitoring: 30
Reserved emergency buffer: 20
Application budget: 150
```

Jangan gunakan DB max connection penuh untuk aplikasi.

### Step 3 — Klasifikasikan workload

Untuk setiap pool:

```text
OLTP latency-sensitive?
Reporting heavy?
Batch write?
Scheduler?
Read replica?
External integration sync?
```

### Step 4 — Ukur connection hold time

Ambil:

```text
average usage time
p50 usage time
p95 usage time
p99 usage time
```

Jangan hanya rata-rata.

P99 sering menentukan pool starvation.

### Step 5 — Ukur target throughput

Misal:

```text
peak normal QPS endpoint DB-bound
peak DB operations/sec
transaction/sec dari DB
```

### Step 6 — Gunakan Little's Law sebagai estimasi

```text
needed concurrency ≈ target throughput * p95 hold time
```

Contoh:

```text
target = 100 ops/sec per service
p95 hold time = 80ms = 0.08s
needed concurrency = 8
```

### Step 7 — Validasi terhadap DB capacity

Cek:

- CPU,
- DB active sessions,
- wait events,
- lock wait,
- IO latency,
- buffer cache hit,
- temp usage,
- memory,
- slow queries,
- connection count.

### Step 8 — Load test incremental

Uji beberapa angka:

```text
maximumPoolSize = 4
maximumPoolSize = 8
maximumPoolSize = 12
maximumPoolSize = 16
maximumPoolSize = 24
```

Ukur:

- throughput,
- p50/p95/p99 latency,
- pool pending,
- pool timeout,
- DB CPU,
- DB wait events,
- error rate,
- retry rate,
- lock wait.

Cari knee point.

### Step 9 — Pilih angka konservatif

Jangan pilih angka tertinggi yang masih “lolos test”.

Pilih angka yang:

- memenuhi SLA,
- menyisakan DB headroom,
- tidak menyebabkan tail latency buruk,
- tidak membuat service lain kelaparan,
- tetap aman saat max replicas.

### Step 10 — Revisit setelah perubahan besar

Sizing harus diulang saat:

- query berubah,
- index berubah,
- traffic naik,
- jumlah pod berubah,
- DB instance class berubah,
- storage berubah,
- batch job baru ditambah,
- reporting fitur baru masuk,
- driver/database version upgrade,
- transaction boundary berubah.

---

## 32. Decision Matrix: Pool Penuh, Apa yang Dilakukan?

| Observasi | Interpretasi Mungkin | Aksi Pertama |
|---|---|---|
| Active=max, pending tinggi, DB CPU rendah, query cepat | Pool mungkin terlalu kecil | Naikkan bertahap dan test |
| Active=max, pending tinggi, DB CPU tinggi | DB saturasi | Jangan langsung naikkan pool; analisis DB bottleneck |
| Active=max, usage time tinggi, slow query ada | Query lambat | Tuning query/index |
| Active=max, usage time tinggi, lock wait tinggi | Lock contention | Perbaiki transaction/locking |
| Active naik tidak turun, DB activity rendah | Leak | Cari leak, aktifkan leak detection |
| Pending spike sebentar, timeout tidak ada | Backpressure sehat | Monitor, tidak perlu ubah |
| Connection creation time tinggi | DB/network/login lambat | Investigasi network/auth/DB startup |
| Idle selalu tinggi | Pool terlalu besar/minIdle tinggi | Turunkan pool/minIdle |
| Timeout saat deployment/startup | Startup storm | Rolling/jitter/minIdle/lifecycle tuning |

---

## 33. Anti-Pattern Pool Sizing

### Anti-pattern 1 — Copy-paste default semua service

```properties
maximumPoolSize=50
```

Dipakai di 20 service, masing-masing 5 pod.

```text
20 * 5 * 50 = 5000 potential connections
```

Ini bukan konfigurasi. Ini bom waktu.

### Anti-pattern 2 — Samakan dengan max HTTP threads

```properties
server.tomcat.threads.max=200
maximumPoolSize=200
```

Ini menganggap semua request harus punya DB connection bersamaan.

### Anti-pattern 3 — Naikkan pool saat query lambat

Query 2 detik, pool 10 penuh.

Naik ke 100.

Hasil:

```text
100 query lambat berjalan bersamaan,
DB makin lambat,
timeout makin banyak.
```

### Anti-pattern 4 — Satu pool untuk semua workload

OLTP, reporting, batch, scheduler memakai pool yang sama.

Saat export/report berjalan, user API timeout.

### Anti-pattern 5 — Abaikan Kubernetes max replicas

Menghitung current replica, bukan max replica.

Saat incident dan HPA scale up, DB justru makin rusak.

### Anti-pattern 6 — Pool besar untuk menyembunyikan connection leak

Pool 10 leak dalam 1 jam.

Naik ke 100 leak dalam 10 jam.

Masalah tetap ada.

### Anti-pattern 7 — `minimumIdle` besar tanpa alasan

Idle connection juga memakan resource database.

Untuk banyak service, `minimumIdle` besar bisa menciptakan session idle massal.

---

## 34. Pattern yang Lebih Baik

### Pattern 1 — Small fixed pool for OLTP

Untuk latency-sensitive service:

```properties
maximumPoolSize=8
minimumIdle=8
connectionTimeout=1000
```

Fixed-size pool bisa menghindari connection creation latency saat traffic normal.

Tetapi angka harus sesuai budget.

### Pattern 2 — Separate reporting pool

```properties
oltp.maximumPoolSize=10
reporting.maximumPoolSize=2
```

Report berat tidak mengambil semua slot OLTP.

### Pattern 3 — Worker concurrency <= pool size

Jika worker memiliki concurrency 20 tetapi pool 5, 15 worker akan menunggu connection.

Itu bisa acceptable, tetapi lebih jelas jika worker concurrency memang diset selaras.

```text
worker concurrency = 4
batch pool size = 4
```

Atau:

```text
worker concurrency = 20
pool size = 4
```

jika sengaja ingin pool sebagai throttle. Yang penting sadar.

### Pattern 4 — Connection budget by service ownership

Setiap service punya budget eksplisit.

```text
case-api owns max 48 DB connections
report-api owns max 9 DB connections
worker owns max 8 DB connections
```

Budget ini direview saat replica berubah.

### Pattern 5 — Fast fail instead of infinite waiting

`connectionTimeout` jangan terlalu besar.

Jika connection tidak tersedia dalam budget waktu request, lebih baik gagal terkontrol daripada menggantung sampai upstream timeout.

Contoh:

```properties
connectionTimeout=1000
```

Untuk OLTP, 1-2 detik sering lebih masuk akal daripada 30 detik, tetapi harus disesuaikan SLA.

---

## 35. Example: Sizing OLTP Case Management Service

Misal service regulatory case management:

```text
Service: case-api
Pods normal: 4
Pods max: 8
DB app connection budget for this service: 64
Peak request: 300 req/sec
DB-bound requests: 70%
Average connection hold: 25 ms
P95 connection hold: 80 ms
```

Estimasi DB ops/sec:

```text
300 * 0.70 = 210 DB ops/sec
```

Estimasi concurrency dengan P95:

```text
210 * 0.08 = 16.8 ≈ 17 active connections total service
```

Dengan max pods 8:

```text
17 / 8 = 2.125 connections per pod
```

Terlalu kecil untuk traffic imbalance. Bisa mulai dengan:

```text
maximumPoolSize per pod = 4
Total cap = 8 * 4 = 32
```

Ini masih di bawah budget 64.

Uji:

```text
pool 4 per pod -> total 32
pool 6 per pod -> total 48
pool 8 per pod -> total 64
```

Pilih berdasarkan load test dan DB wait.

Jangan langsung set 64 per pod.

Karena:

```text
64 per pod * 8 pod = 512 connections
```

Itu berbeda total satu order of magnitude.

---

## 36. Example: Reporting Endpoint Mengganggu OLTP

Kondisi awal:

```text
one shared pool = 20
OLTP request = 100/sec
report export = query 30-120 sec
5 report user menekan export bersamaan
```

Akibat:

```text
5 connection tertahan lama
15 tersisa untuk OLTP
Jika export query berat menyebabkan DB IO tinggi,
OLTP query ikut lambat,
hold time naik,
pool active jadi 20,
pending naik,
request timeout.
```

Solusi:

```text
OLTP pool = 14
report pool = 2
batch/export queue concurrency = 2
report query diarahkan ke replica/materialized view jika memungkinkan
```

Ini mungkin mengurangi concurrency report, tetapi menjaga sistem utama.

---

## 37. Example: Batch Job Backfill

Kondisi buruk:

```text
batch job concurrency = 50
pool size = 50
chunk size = 10.000 rows
commit per chunk
```

Akibat:

- lock footprint besar,
- undo/redo/WAL besar,
- buffer cache churn,
- replication lag,
- OLTP terganggu,
- deadlock/timeout risk naik.

Lebih sehat:

```text
batch pool size = 2-4
worker concurrency = 2-4
chunk size = 500-2000 rows
commit cepat
sleep/backoff adaptif
run off-peak
monitor DB wait/replication lag
```

Throughput total bisa lebih tinggi karena database tidak thrashing.

---

## 38. Example: Connection Budget di Microservices

Misal database punya safe application budget 180 connections.

Services:

| Service | Max Replicas | Pool per Pod | Total |
|---|---:|---:|---:|
| auth-api | 4 | 5 | 20 |
| case-api | 8 | 8 | 64 |
| application-api | 6 | 8 | 48 |
| report-api | 3 | 4 | 12 |
| notification-worker | 4 | 3 | 12 |
| scheduler | 2 | 2 | 4 |
| migration/admin buffer | - | - | 20 |

Total:

```text
20 + 64 + 48 + 12 + 12 + 4 + 20 = 180
```

Ini explicit budget.

Jika `case-api` ingin naik dari 8 ke 12 max replicas, harus ada perubahan:

```text
case-api total = 12 * 8 = 96
```

Maka total menjadi:

```text
212
```

Harus dilakukan salah satu:

- turunkan pool per pod,
- naikkan DB capacity,
- pindahkan workload ke replica,
- batasi HPA max,
- optimasi hold time,
- redistribusi budget.

---

## 39. Production Dashboard untuk Pool Sizing

Dashboard minimal per pool:

```text
Pool state:
- active connections
- idle connections
- pending threads
- max connections
- connection timeout count

Timing:
- acquisition time p50/p95/p99
- usage time p50/p95/p99
- creation time p50/p95/p99

App:
- request rate
- request latency p95/p99
- error rate
- retry rate
- endpoint breakdown

DB:
- active sessions
- CPU
- wait events
- lock wait
- IO latency
- slow queries
- deadlocks
- connection count by app/user
```

Grafik yang paling berguna:

```text
active connections vs pending threads vs DB CPU vs request p95 latency
```

Dengan kombinasi ini, kamu bisa membedakan:

- pool bottleneck,
- DB bottleneck,
- query bottleneck,
- lock bottleneck,
- leak,
- external dependency di dalam transaction.

---

## 40. Alert yang Masuk Akal

Alert buruk:

```text
active connections > 80% for 1 minute
```

Ini bisa noisy karena active tinggi saat traffic normal.

Alert lebih baik:

```text
pending threads > 0 for sustained duration AND acquisition p95 > threshold
```

atau:

```text
connection timeout count > 0
```

atau:

```text
usage p99 naik 3x baseline AND active=max
```

atau:

```text
idle=0 AND active=max AND pending high AND DB CPU high
```

Alert harus mengarah ke tindakan.

---

## 41. Pool Sizing dengan Virtual Threads

Virtual threads membuat blocking Java lebih murah dari sisi thread scheduling aplikasi.

Namun JDBC connection tetap resource terbatas.

Artinya:

```text
100.000 virtual threads tidak berarti boleh punya 100.000 DB connections.
```

Dengan virtual threads, risiko baru adalah aplikasi bisa menciptakan jauh lebih banyak blocking tasks yang semuanya mencoba `getConnection()`.

Pool menjadi semakin penting sebagai admission control.

Prinsip:

```text
Virtual thread concurrency boleh tinggi.
Database concurrency tetap harus dibatasi oleh pool.
```

Pastikan:

- `connectionTimeout` jelas,
- caller tidak menunggu terlalu lama,
- bulk task punya concurrency limiter sendiri,
- jangan menjadikan pool queue sebagai satu-satunya queue untuk jutaan task.

---

## 42. Pool Sizing dan Circuit Breaker

Saat database tidak sehat, pool queue bisa penuh.

Tanpa circuit breaker:

```text
request terus masuk
semua menunggu pool
thread/request menumpuk
upstream timeout
retry storm
```

Dengan circuit breaker atau adaptive rejection:

```text
DB acquisition timeout/error naik
circuit open
request tertentu fail fast/degrade
DB diberi waktu recovery
```

Namun circuit breaker database harus hati-hati.

Tidak semua endpoint sama:

- read-only non-critical bisa degrade/cache,
- write critical mungkin harus fail explicit,
- idempotent operation bisa retry terbatas,
- non-idempotent operation jangan retry sembarangan.

Pool sizing, timeout, retry, dan circuit breaker harus dirancang bersama.

---

## 43. `minimumIdle`: Size Tetap atau Elastis?

HikariCP merekomendasikan pendekatan sederhana: sering kali tidak perlu mengatur `minimumIdle`, sehingga pool bertindak sebagai fixed-size pool sesuai `maximumPoolSize`.

Namun dalam praktik, ada trade-off.

### Fixed-size pool

```properties
maximumPoolSize=10
minimumIdle=10
```

Kelebihan:

- predictable,
- tidak ada latency membuat connection saat spike normal,
- cocok untuk OLTP steady traffic.

Kekurangan:

- idle sessions tetap memakan DB resource,
- jika banyak pod/service, total idle connection besar.

### Elastic-ish pool

```properties
maximumPoolSize=10
minimumIdle=2
```

Kelebihan:

- idle resource lebih hemat,
- cocok untuk service low traffic atau sporadis.

Kekurangan:

- spike bisa membayar connection creation latency,
- startup/scale behavior perlu diamati,
- connection creation storm bisa terjadi jika banyak pod spike bersamaan.

Pilihan harus berdasarkan workload.

---

## 44. `connectionTimeout` sebagai Backpressure Deadline

`connectionTimeout` menentukan berapa lama caller boleh menunggu connection dari pool.

Jika terlalu panjang:

```text
request menggantung lama
upstream mungkin timeout dulu
resource aplikasi tertahan
user experience buruk
root cause terlambat terlihat
```

Jika terlalu pendek:

```text
traffic spike kecil bisa gagal terlalu cepat
false positive error meningkat
```

Untuk OLTP, biasanya `connectionTimeout` harus lebih kecil dari request timeout.

Contoh:

```text
HTTP request timeout: 5s
JDBC query timeout: 2s
Hikari connectionTimeout: 500ms-1s
```

Ini hanya contoh; ordering-nya yang penting.

Jangan biarkan request timeout 5s tetapi pool wait 30s.

---

## 45. Relationship dengan Database `max_connections`

Database `max_connections` bukan target pool size.

Itu adalah batas atas kasar untuk koneksi yang boleh ada.

Prinsip:

```text
sum(all application pool maximums) < safe database connection budget < database max_connections
```

Jika database `max_connections=500`, bukan berarti aplikasi boleh memakai 500.

Kenapa?

Karena setiap connection bisa memakan:

- memory,
- process/thread,
- file descriptor,
- lock table overhead,
- work memory,
- temp memory,
- CPU scheduling,
- internal DB structures.

Batas `max_connections` sering lebih tinggi daripada sweet spot throughput.

---

## 46. Pool Sizing Checklist

Gunakan checklist ini saat review.

### 46.1 Inventory

- [ ] Semua datasource/pool terdaftar.
- [ ] Semua service yang mengakses database terdaftar.
- [ ] Current replicas dan max replicas diketahui.
- [ ] Jumlah pool per pod diketahui.
- [ ] `maximumPoolSize` per pool diketahui.
- [ ] Total potential connections dihitung.

### 46.2 Budget

- [ ] DB `max_connections` diketahui.
- [ ] Safe app connection budget disepakati.
- [ ] Admin/monitoring/emergency reserve disediakan.
- [ ] Budget per service disepakati.
- [ ] Budget memperhitungkan autoscaling.

### 46.3 Workload

- [ ] OLTP, reporting, batch, scheduler dipisahkan secara konsep.
- [ ] Workload berat tidak memakai pool OLTP tanpa batas.
- [ ] Worker concurrency selaras dengan pool atau sengaja dibatasi pool.
- [ ] Reporting/export punya concurrency limiter.

### 46.4 Timing

- [ ] Connection acquisition p95/p99 dimonitor.
- [ ] Connection usage p95/p99 dimonitor.
- [ ] Connection creation p95/p99 dimonitor.
- [ ] Request latency dikorelasikan dengan pool metrics.

### 46.5 Database

- [ ] DB CPU dimonitor.
- [ ] DB active sessions dimonitor.
- [ ] Lock wait/deadlock dimonitor.
- [ ] Slow query dimonitor.
- [ ] IO wait dimonitor.
- [ ] Connection count by service/user dimonitor.

### 46.6 Failure

- [ ] Pool exhaustion alert ada.
- [ ] Connection timeout alert ada.
- [ ] Leak detection tersedia untuk diagnosis.
- [ ] Startup storm dipertimbangkan.
- [ ] DB failover behavior diuji.
- [ ] HPA max replica tidak melampaui connection budget.

---

## 47. Review Questions

Gunakan pertanyaan berikut untuk menguji pemahaman.

1. Mengapa 10.000 user aktif tidak berarti butuh 10.000 connection?
2. Apa perbedaan HTTP thread concurrency dan DB concurrency?
3. Mengapa pool wait kadang sehat?
4. Kapan pending connection berarti pool terlalu kecil?
5. Kapan pending connection berarti database sedang lambat?
6. Mengapa menaikkan `maximumPoolSize` bisa menurunkan throughput?
7. Bagaimana menghitung total koneksi di Kubernetes?
8. Kenapa max replicas lebih penting daripada current replicas?
9. Apa hubungan Little's Law dengan connection hold time?
10. Kenapa connection hold time sering lebih penting daripada pool size?
11. Apa risiko memakai satu pool untuk OLTP dan reporting?
12. Mengapa SSD tidak otomatis berarti pool size lebih besar?
13. Apa yang harus dicek sebelum menaikkan pool?
14. Apa tanda connection leak dari metrik pool?
15. Kenapa database `max_connections` bukan target sizing?

---

## 48. Ringkasan Mental Model

Pool sizing adalah masalah capacity modelling, bukan konfigurasi kosmetik.

Mental model inti:

```text
Pool size membatasi jumlah database work aktif dari aplikasi.
```

Bukan:

```text
Pool size = jumlah user
Pool size = jumlah request
Pool size = jumlah thread
Pool size = database capacity
```

Ukuran pool yang baik:

1. Cukup besar untuk memanfaatkan database.
2. Cukup kecil untuk mencegah oversubscription.
3. Sesuai budget total semua service/pod.
4. Dipisahkan berdasarkan workload.
5. Diverifikasi dengan metrics dan load test.
6. Direview ulang saat traffic, query, replica, atau database berubah.

Kalimat paling penting:

```text
Saat pool penuh, jangan otomatis menaikkan pool.
Tanyakan dulu: connection sedang menunggu apa?
```

Jika connection menunggu karena pool terlalu kecil dan DB masih sehat, naikkan bertahap.

Jika connection menunggu karena query lambat, lock, DB saturasi, leak, atau transaction panjang, memperbesar pool hanya memperbesar kerusakan.

---

## 49. Referensi

1. HikariCP README — configuration, design notes, production guidance.  
   `https://github.com/brettwooldridge/HikariCP`

2. HikariCP Wiki — About Pool Sizing.  
   `https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing`

3. PostgreSQL Wiki — Number Of Database Connections.  
   `https://wiki.postgresql.org/wiki/Number_Of_Database_Connections`

4. Java SE API — `javax.sql.DataSource`.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/javax/sql/DataSource.html`

5. Java SE API — `java.sql.Connection`.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html`

---

## 50. Status Seri

```text
Part 021 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 022 — Timeout Design: Connection Timeout, Query Timeout, Socket Timeout, Transaction Timeout
File berikutnya: learn-java-sql-jdbc-hikaricp-part-022.md
```
