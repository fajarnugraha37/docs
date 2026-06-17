# learn-java-sql-jdbc-hikaricp-part-018

# Part 018 — Connection Pooling Fundamentals

## Status Seri

- Seri: `learn-java-sql-jdbc-hikaricp`
- Part: `018`
- Total rencana part: `029`
- Status: **belum selesai**
- Part sebelumnya: `Part 017 — Performance Model of JDBC Calls`
- Part berikutnya: `Part 019 — HikariCP Architecture and Design Philosophy`

---

## Tujuan Pembelajaran

Di part ini kita membahas **connection pooling secara fundamental**, sebelum masuk ke HikariCP secara spesifik.

Targetnya bukan sekadar tahu bahwa pool itu “menyimpan koneksi agar reusable”, tetapi memahami:

1. kenapa koneksi database mahal dibuat;
2. kenapa pool bukan penambah kapasitas database;
3. bagaimana pool menjadi boundary concurrency, latency, dan backpressure;
4. apa arti active, idle, total, pending, borrow, return, validation, eviction, lifetime;
5. bagaimana salah konfigurasi pool menyebabkan outage;
6. bagaimana memodelkan pool sebagai bagian dari sistem terdistribusi;
7. bagaimana membaca gejala production seperti pool exhaustion, DB session explosion, slow query cascade, dan leak;
8. bagaimana menyiapkan mental model sebelum mempelajari HikariCP.

Setelah part ini, ketika melihat konfigurasi seperti:

```properties
maximumPoolSize=20
minimumIdle=10
connectionTimeout=30000
idleTimeout=600000
maxLifetime=1800000
keepaliveTime=120000
leakDetectionThreshold=60000
```

kita tidak membacanya sebagai daftar angka, tetapi sebagai **kontrak kapasitas dan failure behavior** antara aplikasi, pool, driver, network, dan database.

---

## 1. Definisi Awal: Apa Itu Connection Pool?

Secara sederhana, connection pool adalah komponen yang:

1. membuat sejumlah koneksi database fisik;
2. menyimpan koneksi tersebut agar bisa dipakai ulang;
3. memberi koneksi ke thread aplikasi saat diminta;
4. menerima kembali koneksi saat aplikasi selesai;
5. menjaga kesehatan koneksi;
6. membuang koneksi yang rusak, idle terlalu lama, atau melewati umur maksimal;
7. membatasi jumlah koneksi bersamaan ke database.

Namun definisi production yang lebih tepat:

> Connection pool adalah **resource scheduler** untuk database session yang mahal, terbatas, stateful, dan failure-prone.

Ini penting. Pool bukan sekadar cache. Pool adalah scheduler.

Karena itu, pool harus menjawab pertanyaan berikut:

| Pertanyaan | Jawaban Pool |
|---|---|
| Berapa banyak koneksi boleh dibuka? | `maximumPoolSize` |
| Apa yang terjadi jika semua koneksi sedang dipakai? | thread menunggu sampai `connectionTimeout` |
| Apakah koneksi idle tetap disimpan? | tergantung `minimumIdle` dan `idleTimeout` |
| Apakah koneksi lama perlu diganti? | `maxLifetime` |
| Apakah koneksi idle masih hidup? | validation / keepalive |
| Apakah ada connection leak? | leak detection |
| Apakah database sedang overload? | terlihat dari active/pending/wait time |

---

## 2. JDBC Connection: Kenapa Harus Dipool?

Membuat koneksi database bukan operasi ringan.

Saat aplikasi memanggil kira-kira:

```java
Connection connection = DriverManager.getConnection(url, username, password);
```

atau melalui `DataSource`, operasi ini dapat melibatkan:

1. parsing JDBC URL;
2. resolving host via DNS;
3. membuka TCP socket;
4. TLS negotiation, jika encrypted;
5. authentication handshake;
6. authorization check;
7. database process/session allocation;
8. memory allocation di database;
9. initialization session state;
10. driver-side object setup;
11. optional validation query;
12. network round-trip berulang.

Dibanding menjalankan satu query sederhana, membuat koneksi baru bisa sangat mahal.

Contoh kasar:

```text
Query sederhana via koneksi existing:
  2 ms - 20 ms

Membuat koneksi baru:
  20 ms - 500 ms+

Membuat koneksi baru saat DB/network bermasalah:
  ratusan ms - beberapa detik - timeout
```

Angka ini bukan hukum universal. Yang penting adalah cost model-nya:

```text
Connection creation = network + auth + database session allocation + driver setup
Connection reuse     = borrow logical handle dari pool
```

Jadi pooling menghindari biaya setup berulang.

Tetapi ada aspek kedua yang lebih penting: database tidak mampu menerima jumlah koneksi tak terbatas.

Setiap koneksi database biasanya membawa biaya:

1. server-side process/thread/session;
2. memory per session;
3. cursor state;
4. transaction state;
5. locks;
6. temporary buffers;
7. authentication context;
8. statistics/session metadata;
9. scheduler overhead.

Maka pool bukan hanya membuat aplikasi lebih cepat. Pool juga membatasi aplikasi agar tidak menghancurkan database.

---

## 3. Pool Sebagai Cache vs Pool Sebagai Governor

Pemahaman pemula:

```text
Pool menyimpan koneksi agar getConnection lebih cepat.
```

Pemahaman production:

```text
Pool mengatur berapa banyak pekerjaan database yang boleh berjalan bersamaan dari satu aplikasi.
```

Inilah pergeseran mental model yang krusial.

Jika pool hanya dianggap cache, biasanya orang akan berkata:

```text
Aplikasi lambat? Besarkan pool.
```

Padahal jika akar masalahnya database sudah saturasi, memperbesar pool sering membuat sistem lebih lambat.

Kenapa?

Karena lebih banyak koneksi berarti lebih banyak query bersamaan. Lebih banyak query bersamaan dapat berarti:

1. lebih banyak CPU contention di database;
2. lebih banyak disk IO contention;
3. lebih banyak lock contention;
4. lebih banyak memory pressure;
5. lebih banyak context switching;
6. lebih banyak buffer cache churn;
7. lebih banyak deadlock/timeout;
8. lebih panjang tail latency.

Pool harus dilihat seperti traffic light.

```text
Terlalu kecil:
  aplikasi antre di pool padahal DB masih sanggup.

Pas:
  DB sibuk sehat, antrean terkendali, latency stabil.

Terlalu besar:
  DB dibanjiri, semua query saling melambat, tail latency naik, timeout cascade.
```

---

## 4. Basic Lifecycle: Borrow, Use, Return

Secara konseptual:

```text
Application Thread
        |
        | getConnection()
        v
Connection Pool
        |
        | borrow logical connection
        v
JDBC Connection Proxy
        |
        | execute SQL
        v
Physical DB Connection / DB Session
        |
        | close()
        v
Return to Pool
```

Pseudocode aplikasi:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement("select * from users where id = ?")) {

    ps.setLong(1, userId);

    try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
            return mapUser(rs);
        }
        return null;
    }
}
```

Dari perspektif aplikasi, `connection.close()` terlihat seperti menutup koneksi.

Dari perspektif pool, `close()` biasanya berarti:

```text
Application finished using this logical connection.
Please reset and return it to the pool.
```

Jadi pada pooled connection:

```text
connection.close() != always close physical socket
connection.close() == return logical handle to pool
```

Physical connection baru benar-benar ditutup jika:

1. pool shutdown;
2. connection invalid;
3. connection melewati `maxLifetime`;
4. connection idle dan boleh dievict;
5. pool mengecil;
6. driver/database/network error;
7. explicit eviction oleh pool.

---

## 5. Istilah Penting dalam Pool

### 5.1 Physical Connection

Physical connection adalah koneksi nyata ke database:

```text
TCP socket + driver protocol state + database session
```

Ini resource mahal.

### 5.2 Logical Connection

Logical connection adalah object yang diberikan ke aplikasi.

Pada pool modern, object ini biasanya proxy/wrapper.

Aplikasi memanggil:

```java
Connection c = dataSource.getConnection();
```

Yang diterima bisa berupa proxy yang membungkus physical connection.

### 5.3 Active Connection

Active connection adalah koneksi yang sedang dipinjam aplikasi.

```text
active = borrowed and not yet returned
```

Jika query lambat, transaction panjang, atau kode lupa close, active naik.

### 5.4 Idle Connection

Idle connection adalah koneksi yang sedang tidak dipakai dan tersedia di pool.

```text
idle = ready to be borrowed
```

Idle bukan berarti buruk. Idle adalah kapasitas siap pakai.

Namun idle terlalu banyak bisa memboroskan resource database.

### 5.5 Total Connection

Total connection:

```text
total = active + idle
```

Biasanya total tidak boleh melebihi `maximumPoolSize`.

### 5.6 Pending Threads

Pending threads adalah thread yang sedang menunggu koneksi karena pool tidak punya idle connection dan tidak bisa/ tidak boleh membuat koneksi baru.

```text
pending > 0 = ada backpressure di pool
```

Pending sesaat normal. Pending panjang adalah sinyal.

### 5.7 Borrow Time / Acquisition Time

Borrow/acquisition time adalah waktu yang dibutuhkan untuk mendapatkan koneksi dari pool.

Jika pool sehat dan ada idle connection:

```text
borrow time ~ sangat kecil
```

Jika pool penuh:

```text
borrow time = wait until another thread returns connection
```

### 5.8 Usage Time

Usage time adalah berapa lama koneksi dipinjam aplikasi.

```text
usage time = from getConnection success until close
```

Usage time sangat penting.

Pool kecil bisa cukup jika usage time pendek. Pool besar tetap bisa habis jika usage time panjang.

---

## 6. Diagram State Connection dalam Pool

```text
                +----------------+
                |  NOT CREATED   |
                +-------+--------+
                        |
                        | create physical connection
                        v
                +----------------+
                |     IDLE       |
                +---+--------+---+
                    |        ^
        borrow      |        | return/reset
                    v        |
                +----------------+
                |    ACTIVE      |
                +---+--------+---+
                    |        |
                    |        | fatal error / invalid
                    |        v
                    |   +------------+
                    |   |  EVICTED   |
                    |   +------------+
                    |
                    | maxLifetime / idleTimeout / shutdown
                    v
                +----------------+
                |    CLOSED      |
                +----------------+
```

Connection pooling adalah state machine. Banyak bug production terjadi karena transisi state tidak terjadi seperti yang diasumsikan.

Contoh:

```text
ACTIVE tidak kembali ke IDLE
  -> leak atau transaction/query sangat lama

IDLE ternyata invalid
  -> firewall/NAT/DB membunuh connection diam-diam

CLOSED terlalu sering
  -> maxLifetime terlalu pendek atau DB/network tidak stabil

PENDING naik
  -> pool saturated atau leak
```

---

## 7. Kenapa Pool Bukan “Connection Cache” Biasa

Cache biasanya menyimpan data agar lookup berikutnya cepat.

Pool menyimpan resource stateful yang harus dikembalikan dalam kondisi bersih.

Perbedaannya:

| Aspek | Cache Data | Connection Pool |
|---|---|---|
| Resource | data/object | socket + DB session |
| State | relatif pasif | sangat stateful |
| Ownership | bisa shared immutable | harus exclusive saat dipinjam |
| Cleanup | eviction | reset session state |
| Failure | stale data | broken connection, leaked transaction |
| Capacity | memory-bound | DB/session/network-bound |
| Contention | cache miss | thread blocking/backpressure |

Connection pool harus menjaga invariant:

```text
Satu physical connection hanya boleh dipakai oleh satu execution flow pada satu waktu.
```

Karena JDBC `Connection` tidak boleh diperlakukan sebagai resource concurrent bebas.

---

## 8. Pool sebagai Boundary Eksklusivitas

Saat thread meminjam connection, thread itu memiliki hak eksklusif atas connection tersebut sampai dikembalikan.

```text
Thread A borrow Connection #1
Thread B tidak boleh memakai Connection #1 bersamaan
```

Kenapa?

Karena connection membawa:

1. transaction state;
2. auto-commit state;
3. isolation level;
4. current schema;
5. server cursor;
6. statement state;
7. warnings;
8. session variables;
9. temporary table;
10. user/session context.

Jika dua thread memakai connection yang sama bersamaan, hasilnya bisa kacau:

```text
Thread A begin transaction
Thread B execute update
Thread A commit
```

Pertanyaan: update milik siapa yang ikut commit?

Jawabannya: dari perspektif database, semua terjadi pada session/connection yang sama. Jadi boundary bisnis di aplikasi runtuh.

---

## 9. Connection State Leakage

Connection pooling hanya aman jika connection yang dikembalikan ke pool sudah bersih atau direset.

Contoh state yang bisa bocor:

| State | Risiko jika bocor |
|---|---|
| `autoCommit=false` | request berikutnya tanpa sadar masuk transaction manual |
| isolation `SERIALIZABLE` | request berikutnya lambat/lock-heavy |
| `readOnly=true` | write berikutnya gagal atau dioptimasi salah |
| schema berubah | query berikutnya ke schema salah |
| session variable berubah | security/tenant context bocor |
| open transaction | lock tertahan, idle in transaction |
| temporary table | data/context request sebelumnya terlihat |
| role berubah | privilege tidak sesuai |

Pool yang baik berusaha reset sebagian state umum. Tetapi tidak semua state vendor-specific bisa direset otomatis.

Karena itu aplikasi harus punya prinsip:

```text
Siapa yang mengubah state connection harus mengembalikannya atau memastikan pool reset dengan benar.
```

Lebih aman lagi:

```text
Jangan mengubah session state secara ad-hoc jika tidak ada boundary yang jelas.
```

---

## 10. Apa yang Terjadi Saat `getConnection()` pada Pool?

Secara konseptual:

```text
1. Aplikasi memanggil dataSource.getConnection()
2. Pool mencari idle connection valid
3. Jika ada:
     - tandai active
     - bungkus/proxy jika perlu
     - kembalikan ke caller
4. Jika tidak ada dan total < maximumPoolSize:
     - buat physical connection baru
     - validasi/init
     - tandai active
     - kembalikan
5. Jika tidak ada dan total == maximumPoolSize:
     - caller menunggu
     - jika connection tersedia sebelum timeout, borrow berhasil
     - jika tidak, throw SQLException / timeout exception
```

Diagram:

```text
getConnection()
     |
     v
Has idle connection?
     | yes
     v
Validate/borrow -> return
     |
     no
     v
Total < maxPoolSize?
     | yes
     v
Create new physical connection -> return
     |
     no
     v
Wait up to connectionTimeout
     |
     +-- returned connection available -> borrow
     |
     +-- timeout -> fail fast to application
```

Hal penting:

```text
connectionTimeout bukan timeout query.
```

`connectionTimeout` adalah batas waktu menunggu koneksi dari pool.

Jika query lambat, `connectionTimeout` tidak menghentikan query yang sedang berjalan. Ia hanya memengaruhi thread lain yang sedang menunggu koneksi.

---

## 11. Apa yang Terjadi Saat `close()` pada Pooled Connection?

Secara konseptual:

```text
1. Aplikasi memanggil connection.close()
2. Proxy connection menangkap call close
3. Pool memeriksa state
4. Pool melakukan cleanup/reset
5. Jika connection valid dan masih layak:
     - return to idle
6. Jika connection broken/expired:
     - close physical connection
     - total berkurang
     - nanti diganti jika dibutuhkan
```

Potential cleanup:

1. rollback transaction jika belum commit;
2. reset auto-commit;
3. reset read-only;
4. reset isolation;
5. close statements/result sets yang terlacak;
6. clear warnings;
7. validate connection;
8. mark idle.

Namun jangan mengandalkan pool sebagai pengganti disiplin kode.

Kode tetap harus eksplisit:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);
    try {
        // business SQL
        connection.commit();
    } catch (Exception e) {
        connection.rollback();
        throw e;
    }
}
```

Bukan:

```java
Connection connection = dataSource.getConnection();
connection.setAutoCommit(false);
// work
// lupa commit/rollback/close
```

---

## 12. Pool Exhaustion

Pool exhaustion terjadi saat semua connection dalam pool sedang active dan thread baru tidak bisa mendapatkan connection sebelum `connectionTimeout`.

Gejala umum:

```text
SQLTransientConnectionException: Connection is not available, request timed out
```

atau variasi sesuai pool/driver.

Pool exhaustion bukan diagnosis akhir. Itu gejala.

Akar masalah bisa:

1. connection leak;
2. query lambat;
3. transaction terlalu panjang;
4. external call dilakukan saat connection masih dipinjam;
5. N+1 query;
6. deadlock/lock wait;
7. database CPU/IO saturated;
8. pool terlalu kecil;
9. traffic naik;
10. jumlah pod/replica naik sehingga DB saturasi;
11. thread pool aplikasi terlalu besar;
12. batch job memakai pool OLTP;
13. report query mengambil connection terlalu lama;
14. network/database stall.

Decision tree awal:

```text
Pool exhausted
   |
   +-- active tinggi, pending tinggi, DB active query tinggi
   |      -> DB/query bottleneck atau pool terlalu kecil untuk workload sehat
   |
   +-- active tinggi, pending tinggi, DB active query rendah
   |      -> connection leak, thread stuck, connection held while doing non-DB work
   |
   +-- active rendah, pending tinggi
   |      -> pool internal issue, connection creation stuck, validation stuck, metrics wrong, lock contention
   |
   +-- total rendah, creation gagal
          -> DB login/network/credential/max connection problem
```

---

## 13. Connection Leak

Connection leak berarti aplikasi meminjam connection dan tidak mengembalikannya.

Contoh klasik:

```java
public User findUser(long id) throws SQLException {
    Connection connection = dataSource.getConnection();
    PreparedStatement ps = connection.prepareStatement("select * from users where id = ?");
    ps.setLong(1, id);
    ResultSet rs = ps.executeQuery();

    if (rs.next()) {
        return map(rs);
    }

    return null;
}
```

Masalah:

```text
Connection, PreparedStatement, ResultSet tidak pernah ditutup.
```

Versi benar:

```java
public User findUser(long id) throws SQLException {
    String sql = "select * from users where id = ?";

    try (Connection connection = dataSource.getConnection();
         PreparedStatement ps = connection.prepareStatement(sql)) {

        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                return map(rs);
            }
            return null;
        }
    }
}
```

Leak juga bisa lebih halus:

```java
public Stream<User> streamUsers() throws SQLException {
    Connection connection = dataSource.getConnection();
    PreparedStatement ps = connection.prepareStatement("select * from users");
    ResultSet rs = ps.executeQuery();

    return toStream(rs); // dangerous: resource ownership escapes method
}
```

Masalahnya bukan hanya lupa close. Masalahnya ownership resource keluar dari scope yang jelas.

Pattern aman harus membawa close handler:

```java
public void forEachUser(Consumer<User> consumer) throws SQLException {
    String sql = "select * from users";

    try (Connection connection = dataSource.getConnection();
         PreparedStatement ps = connection.prepareStatement(sql);
         ResultSet rs = ps.executeQuery()) {

        while (rs.next()) {
            consumer.accept(map(rs));
        }
    }
}
```

Atau jika harus return stream, stream harus menutup resource ketika stream ditutup, dan caller harus wajib try-with-resources. Ini advanced dan rawan.

---

## 14. Pool Saturation Bukan Selalu Leak

Banyak engineer terlalu cepat menyimpulkan:

```text
Pool habis = connection leak.
```

Belum tentu.

Pool bisa habis karena connection memang dikembalikan, tetapi terlalu lama dipakai.

Misalnya:

```java
try (Connection connection = dataSource.getConnection()) {
    Order order = loadOrder(connection, orderId);

    paymentGateway.charge(order); // external HTTP call while holding DB connection

    markPaid(connection, orderId);
}
```

Masalah:

```text
Connection dipinjam selama external HTTP call.
```

Jika payment gateway lambat 3 detik, connection tertahan 3 detik padahal tidak sedang memakai database.

Versi lebih baik tergantung correctness:

```java
Order order;
try (Connection connection = dataSource.getConnection()) {
    order = loadOrder(connection, orderId);
}

PaymentResult result = paymentGateway.charge(order);

try (Connection connection = dataSource.getConnection()) {
    markPaymentResult(connection, orderId, result);
}
```

Tentu ini mengubah transaction boundary. Untuk pembayaran, biasanya perlu state machine/idempotency/outbox, bukan sekadar memindahkan kode.

Tetapi prinsipnya jelas:

```text
Jangan memegang connection ketika tidak sedang membutuhkan DB session, kecuali ada alasan transactionally valid.
```

---

## 15. Pool Sebagai Backpressure

Backpressure adalah mekanisme agar producer tidak membanjiri consumer.

Dalam konteks JDBC:

```text
Application threads = producer of database work
Database = consumer of database work
Connection pool = backpressure valve
```

Jika pool penuh, thread menunggu.

Itu sering lebih baik daripada membuka koneksi baru terus-menerus sampai database collapse.

Tanpa pool limit:

```text
Traffic naik
  -> aplikasi membuat banyak koneksi
  -> DB session meledak
  -> DB CPU/memory/context switching naik
  -> query makin lambat
  -> aplikasi timeout
  -> retry naik
  -> DB makin hancur
```

Dengan pool limit:

```text
Traffic naik
  -> pool mencapai max
  -> request antre / fail fast
  -> DB concurrency tetap dibatasi
  -> sistem punya peluang stabil
```

Ini sangat penting di microservices dan Kubernetes.

---

## 16. Kubernetes dan Multiplikasi Pool

Salah satu kesalahan production paling umum:

```text
maximumPoolSize dilihat per aplikasi, bukan per replica.
```

Jika konfigurasi:

```properties
maximumPoolSize=30
```

Dan deployment punya:

```text
10 pods
```

Maka potensi koneksi dari service itu:

```text
30 * 10 = 300 database connections
```

Jika ada 8 microservices dengan konfigurasi mirip:

```text
8 services * 10 pods * 30 pool = 2400 database connections
```

Database mungkin tidak sanggup.

Formula sederhana:

```text
total_possible_connections = sum(service_replicas * service_max_pool_size)
```

Harus dibandingkan dengan:

1. database max connections/session;
2. reserved connection untuk DBA/admin/maintenance;
3. background jobs;
4. reporting tools;
5. migration tools;
6. connection dari read replica/writer;
7. failover scenario;
8. burst during rolling deployment.

Rolling deployment juga bisa menggandakan sementara:

```text
old pods still terminating + new pods starting
```

Jika termination grace tidak baik, connection bisa bertahan lebih lama dari yang diperkirakan.

---

## 17. Pool Size: Kenapa Lebih Besar Tidak Selalu Lebih Baik

Misal satu database mampu menjalankan 16 query OLTP secara efektif sebelum contention naik drastis.

Jika pool size 16:

```text
16 query berjalan
sisanya antre di aplikasi
```

Jika pool size 100:

```text
100 query masuk database
semua berebut CPU/IO/lock
rata-rata latency naik
P99 latency naik parah
aplikasi makin lama memegang connection
pool tetap penuh
timeout meningkat
```

Pool besar bisa menurunkan throughput karena memperbesar contention.

Analogi:

```text
Restoran punya 5 koki.
Membiarkan 100 pelanggan masuk dapur tidak membuat makanan lebih cepat selesai.
Itu membuat dapur kacau.
```

Database punya concurrency optimal. Lewat titik itu, tambahan concurrency menghasilkan lebih banyak antrean internal.

---

## 18. Little’s Law untuk Intuisi Pool

Little’s Law:

```text
L = λ * W
```

Dalam konteks sederhana:

```text
concurrency_needed ≈ throughput_per_second * average_db_time_seconds
```

Misal:

```text
Target throughput DB work: 200 operasi/detik
Rata-rata waktu memegang connection: 50 ms = 0.05 detik

Concurrency needed = 200 * 0.05 = 10
```

Maka pool size sekitar 10 dapat cukup untuk workload tersebut, dengan margin tertentu.

Jika waktu memegang connection naik:

```text
200 operasi/detik * 0.2 detik = 40
```

Kebutuhan concurrency naik 4x.

Ini menunjukkan kenapa memperpendek connection usage time sangat kuat.

```text
Pool requirement lebih dipengaruhi durasi memegang connection daripada jumlah request mentah.
```

Namun ini hanya model awal. Production harus mempertimbangkan:

1. P95/P99, bukan hanya average;
2. variasi query;
3. lock wait;
4. batch job;
5. slow report;
6. spike traffic;
7. DB capacity;
8. pod count;
9. retry;
10. failover.

---

## 19. Dua Antrean: Antrean Pool dan Antrean Database

Sistem JDBC biasanya punya minimal dua level antrean:

```text
HTTP/request queue
    -> application executor/thread pool
        -> JDBC pool wait queue
            -> database internal wait/lock/CPU/IO queue
```

Jika pool terlalu kecil, antrean terlihat di aplikasi:

```text
pending threads naik
connection acquisition time naik
DB mungkin masih longgar
```

Jika pool terlalu besar, antrean pindah ke database:

```text
pool pending rendah
active tinggi
DB wait event tinggi
query latency naik
lock wait naik
```

Tujuannya bukan menghilangkan antrean sepenuhnya. Tujuannya meletakkan antrean di tempat yang paling aman dan observable.

Sering kali antrean lebih baik terjadi di aplikasi/pool daripada di database, karena:

1. bisa fail fast;
2. bisa reject request;
3. bisa apply bulkhead;
4. tidak membebani DB session;
5. lebih mudah dikontrol per service.

---

## 20. Minimum Idle

`minimumIdle` adalah jumlah koneksi idle minimum yang pool coba pertahankan.

Jika `minimumIdle=10`, pool berusaha punya 10 koneksi siap pakai saat idle.

Manfaat:

1. mengurangi cold start latency;
2. siap menghadapi burst kecil;
3. menghindari connection creation saat request datang.

Biaya:

1. memegang DB session meskipun tidak digunakan;
2. memperbesar baseline connection count;
3. bisa membebani database jika banyak pod;
4. saat startup banyak instance, semua mencoba membuka minimum idle.

Jika ada 20 pod dan `minimumIdle=10`:

```text
baseline connections = 20 * 10 = 200
```

Walau tidak ada traffic.

Pada sistem cloud/Kubernetes, nilai minimum idle harus dilihat secara agregat.

---

## 21. Maximum Pool Size

`maximumPoolSize` adalah batas maksimum koneksi physical dalam pool.

Ini adalah salah satu konfigurasi paling penting karena menentukan concurrency maksimal ke database dari instance aplikasi tersebut.

```text
maximumPoolSize = max active + idle physical connections in one pool
```

Bukan:

```text
maximumPoolSize = max request aplikasi
```

Bukan juga:

```text
maximumPoolSize = max query sepanjang waktu
```

Ia membatasi jumlah connection yang dapat dipakai bersamaan.

Jika request tidak selalu memakai database, request concurrency boleh lebih besar daripada pool size.

Contoh:

```text
HTTP threads: 200
max pool size: 20
```

Ini bisa valid jika tidak semua request memegang DB connection bersamaan dan DB capacity sekitar itu.

Yang berbahaya adalah:

```text
HTTP threads: 500
max pool size: 200
10 pods
= 2000 potential DB connections
```

---

## 22. Connection Timeout

`connectionTimeout` adalah batas waktu thread menunggu connection dari pool.

Jika semua connection active dan tidak ada yang kembali sebelum timeout, `getConnection()` gagal.

Mental model:

```text
connectionTimeout = max time willing to wait in pool queue
```

Bukan:

```text
connectionTimeout = max time query may run
```

Jika terlalu panjang:

1. request menggantung lama;
2. thread aplikasi tertahan;
3. user menunggu tanpa kepastian;
4. upstream timeout bisa terjadi dulu;
5. retry storm bisa muncul.

Jika terlalu pendek:

1. request gagal saat spike kecil;
2. sistem terlalu agresif reject;
3. false alarm pool exhaustion.

Connection timeout harus lebih kecil dari request timeout secara masuk akal.

Contoh buruk:

```text
HTTP timeout upstream: 10s
connectionTimeout: 30s
```

Artinya aplikasi bisa menunggu koneksi lebih lama daripada caller menunggu response.

Lebih masuk akal:

```text
HTTP timeout upstream: 10s
connectionTimeout: 500ms - 2s, tergantung workload
query timeout: sesuai budget sisa
transaction timeout: sesuai use case
```

Angka final harus diuji, bukan ditelan mentah.

---

## 23. Idle Timeout

`idleTimeout` menentukan berapa lama koneksi idle boleh tetap berada di pool sebelum kandidat eviction.

Tujuan:

1. mengurangi koneksi tidak terpakai;
2. menurunkan baseline DB sessions;
3. menyesuaikan pool dengan traffic rendah.

Namun jika idle timeout terlalu pendek:

1. pool sering close/create connection;
2. latency spike saat burst;
3. database melihat churn koneksi;
4. TLS/auth overhead meningkat.

Jika terlalu panjang:

1. banyak idle session bertahan;
2. firewall/NAT mungkin kill diam-diam;
3. resource database terpakai.

Dalam pool fixed-size, idle timeout sering kurang relevan jika minimum idle sama dengan maximum pool size.

---

## 24. Max Lifetime

`maxLifetime` adalah umur maksimal physical connection sebelum pool menggantinya.

Tujuan:

1. menghindari connection terlalu tua;
2. menghindari diputus oleh database/network lebih dulu;
3. membantu rotasi koneksi;
4. mengurangi risiko stale connection;
5. kompatibel dengan DB/proxy/firewall timeout.

Prinsip penting:

```text
maxLifetime harus lebih pendek dari timeout eksternal yang bisa membunuh connection.
```

Misal firewall membunuh koneksi idle/long-lived pada 60 menit, maka maxLifetime sebaiknya lebih pendek, misal 50-55 menit, tergantung pool behavior.

Jika maxLifetime terlalu pendek:

1. connection churn;
2. overhead create connection;
3. spike jika banyak connection retired bersamaan;
4. throughput terganggu.

Jika terlalu panjang:

1. connection dibunuh pihak luar;
2. aplikasi mendapat broken connection;
3. error sporadis.

Pool yang baik biasanya memberi jitter/attenuation agar semua connection tidak mati bersamaan.

---

## 25. Keepalive dan Validation

Idle connection bisa terlihat hidup dari sisi aplikasi, tetapi sebenarnya sudah mati.

Penyebab:

1. database restart;
2. firewall idle timeout;
3. NAT timeout;
4. load balancer timeout;
5. network partition;
6. database kill session;
7. failover.

Validation adalah mekanisme mengecek connection sebelum digunakan atau saat idle.

Bentuk validation:

1. JDBC `isValid(timeout)`;
2. test query seperti `SELECT 1`;
3. driver-specific lightweight ping;
4. keepalive periodic.

Trade-off:

```text
Validasi terlalu sering -> overhead
Validasi terlalu jarang -> broken connection sampai ke request
```

Pool modern biasanya menghindari test query jika driver `isValid()` baik.

Tetapi beberapa environment membutuhkan keepalive agar firewall/NAT tidak membunuh idle connection.

---

## 26. Leak Detection

Leak detection adalah mekanisme pool untuk memberi warning jika connection dipinjam lebih lama dari threshold tertentu.

Contoh:

```text
leakDetectionThreshold=60000
```

Jika connection dipinjam lebih dari 60 detik, pool log stack trace peminjam.

Namun leak detection tidak selalu berarti leak sungguhan.

Bisa jadi:

1. query memang berjalan 90 detik;
2. lock wait panjang;
3. transaction sengaja panjang;
4. thread blocked di external call sambil memegang connection;
5. application paused karena GC;
6. debugging breakpoint.

Leak detection adalah alarm investigasi, bukan bukti final.

Gunakan untuk menjawab:

```text
Siapa yang meminjam connection terlalu lama?
```

Bukan langsung:

```text
Kode pasti lupa close.
```

---

## 27. Pool Initialization

Saat aplikasi start, pool bisa:

1. membuat connection langsung;
2. membuat connection lazily saat request pertama;
3. gagal start jika DB tidak tersedia;
4. tetap start lalu retry background.

Pilihan ini berdampak pada behavior deployment.

Fail-fast:

```text
Aplikasi gagal start jika DB tidak bisa dihubungi.
```

Cocok jika service tidak berguna tanpa DB dan orchestrator harus tahu app belum ready.

Lazy/lenient:

```text
Aplikasi start walau DB belum siap, connection dibuat ketika dibutuhkan.
```

Cocok untuk beberapa service yang bisa degraded mode, tetapi bisa menyembunyikan masalah sampai runtime.

Di Kubernetes, readiness probe harus selaras dengan strategi ini.

Jika readiness hanya mengecek HTTP endpoint tetapi pool belum bisa connect DB, traffic bisa masuk ke pod yang belum benar-benar siap.

---

## 28. Pool Shutdown

Pool juga harus ditutup dengan benar saat aplikasi shutdown.

Shutdown yang benar:

1. stop menerima request baru;
2. tunggu request aktif selesai dalam grace period;
3. return active connection;
4. close pool;
5. close physical connections;
6. release DB sessions.

Jika shutdown kasar:

1. connection diputus mendadak;
2. transaction rollback;
3. query dibatalkan;
4. DB melihat session abnormal;
5. rolling deployment menyebabkan transient error.

Di Spring Boot misalnya, `DataSource` dikelola sebagai bean lifecycle. Tapi konsepnya tetap sama.

---

## 29. Interaction dengan Transaction

Pool tidak mengubah fakta fundamental:

```text
Transaction hidup di connection/session.
```

Jika connection dipinjam lama karena transaction panjang, pool capacity turun.

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    updateCase(connection, caseId);
    insertAudit(connection, caseId);

    Thread.sleep(10_000); // simulating external dependency or user wait

    connection.commit();
}
```

Selama 10 detik, connection active dan transaction open.

Dampak:

1. pool slot tertahan;
2. lock mungkin tertahan;
3. undo/version storage bertambah;
4. request lain antre;
5. deadlock/timeout lebih mungkin;
6. database cleanup terganggu.

Rule praktis:

```text
Transaction harus sesingkat mungkin, tetapi sepanjang yang diperlukan untuk menjaga invariant bisnis.
```

Jangan memperpendek transaction dengan mengorbankan consistency. Tetapi jangan memperpanjang transaction karena desain service boundary yang malas.

---

## 30. Interaction dengan Thread Pool Aplikasi

Misal:

```text
HTTP worker threads: 200
JDBC max pool size: 20
```

Jika 200 request serentak semua butuh DB, maka hanya 20 yang bisa menjalankan DB work. 180 menunggu.

Ini bisa normal jika DB memang hanya boleh diberi concurrency 20.

Namun harus diatur agar:

1. thread waiting tidak menyebabkan thread starvation total;
2. request timeout lebih jelas;
3. upstream tidak retry brutal;
4. circuit breaker bisa aktif;
5. endpoint non-DB tidak ikut lumpuh.

Di aplikasi modern dengan virtual threads, jumlah thread bisa jauh lebih banyak. Tetapi JDBC tetap blocking dan database connection tetap terbatas.

Virtual threads tidak menghapus kebutuhan pool sizing.

```text
Virtual thread membuat blocking thread lebih murah.
Database connection tetap mahal.
```

Jika 10.000 virtual threads semua mencoba query database, pool tetap menjadi valve utama.

---

## 31. Interaction dengan Async Code

JDBC adalah API blocking.

Jika aplikasi memakai async/reactive framework tetapi di dalamnya memanggil JDBC blocking, maka connection pool tetap harus dikelola hati-hati.

Anti-pattern:

```text
Event loop thread -> blocking JDBC call
```

Akibat:

1. event loop blocked;
2. throughput async runtime jatuh;
3. latency seluruh request naik.

Jika tetap memakai JDBC di sistem async:

1. offload ke dedicated blocking executor;
2. batasi concurrency executor sesuai DB capacity;
3. jangan samakan async concurrency dengan DB concurrency;
4. tetap gunakan connection pool;
5. ukur pending pool dan executor queue.

---

## 32. Multi-Pool Pattern

Kadang satu pool tidak cukup sebagai boundary.

Contoh workload:

1. OLTP request cepat;
2. report query panjang;
3. batch job;
4. background reconciliation;
5. audit export;
6. read replica query.

Jika semua memakai pool yang sama:

```text
report query panjang bisa menghabiskan pool OLTP
```

Pattern:

```text
oltpDataSource       maximumPoolSize=20
reportingDataSource  maximumPoolSize=5
batchDataSource      maximumPoolSize=3
```

Manfaat:

1. bulkhead antar workload;
2. OLTP tidak kelaparan karena report;
3. batch tidak menghancurkan request path;
4. alert lebih jelas;
5. capacity planning lebih presisi.

Namun multi-pool juga menambah total possible connection.

```text
total per pod = sum(all pool max sizes)
```

Jangan membuat 5 pool masing-masing 20 tanpa menghitung total.

---

## 33. Read/Write Pool Separation

Dalam database dengan read replica, aplikasi bisa punya:

```text
writerDataSource
readerDataSource
```

Manfaat:

1. write ke primary;
2. read berat ke replica;
3. mengurangi load primary;
4. pool sizing berbeda.

Risiko:

1. replication lag;
2. read-after-write inconsistency;
3. transaction read/write boundary rumit;
4. failover routing;
5. stale data;
6. pool config ganda.

Pattern:

```text
Command path requiring consistency -> writer
Query path eventually consistent -> reader
```

Jangan asal route semua SELECT ke replica. Beberapa SELECT adalah bagian dari invariant write transaction.

---

## 34. Database Max Connection Budget

Pool sizing harus dimulai dari database budget.

Misal database aman untuk 500 connections.

Reserve:

```text
Admin/DBA/reserved: 50
Migration/tools: 20
Monitoring: 10
Emergency headroom: 70
Available for apps: 350
```

Lalu distribusi:

```text
service-a: 10 pods * 10 = 100
service-b: 5 pods * 20 = 100
service-c: 10 pods * 5 = 50
batch: 5 workers * 5 = 25
reporting: 5 pods * 5 = 25
remaining headroom = 50
```

Tanpa budget, setiap tim bisa menaikkan pool masing-masing sampai database collapse.

Ini masalah governance, bukan hanya coding.

---

## 35. Pool Metrics yang Wajib Dipahami

Minimal metrics:

| Metric | Arti |
|---|---|
| active connections | koneksi sedang dipinjam |
| idle connections | koneksi siap dipakai |
| total connections | active + idle |
| pending threads | thread menunggu koneksi |
| max pool size | limit pool |
| connection acquisition time | waktu tunggu mendapatkan koneksi |
| connection usage time | durasi koneksi dipinjam |
| connection creation time | waktu membuat koneksi baru |
| timeout count | jumlah gagal borrow |

Interpretasi cepat:

| Active | Idle | Pending | Kemungkinan |
|---:|---:|---:|---|
| rendah | tinggi | 0 | pool longgar |
| tinggi | rendah/0 | tinggi | pool saturated |
| tinggi | 0 | tinggi lama | query/transaction/leak/DB lambat |
| rendah | 0 | tinggi | creation/validation issue atau pool stuck |
| total sering naik turun | bervariasi | bervariasi | churn koneksi |
| creation time tinggi | rendah | bisa tinggi | DB login/network lambat |

Metrics harus dikorelasikan dengan database metrics:

1. active sessions;
2. CPU;
3. IO wait;
4. lock wait;
5. deadlocks;
6. slow queries;
7. connection count;
8. transaction age;
9. idle in transaction;
10. wait events.

Pool metrics tanpa DB metrics sering menyesatkan.

---

## 36. Common Production Scenarios

### 36.1 Scenario: Pool Full karena Query Lambat

Gejala:

```text
active = max
idle = 0
pending naik
DB CPU tinggi atau IO tinggi
slow query log penuh
```

Kemungkinan:

1. query plan buruk;
2. missing index;
3. table bloat/statistics stale;
4. report query masuk OLTP pool;
5. database overload.

Solusi tidak selalu menaikkan pool.

Langkah:

1. cari top query by elapsed time;
2. cek execution plan;
3. cek rows scanned vs returned;
4. cek lock wait;
5. pisahkan reporting;
6. kurangi result set;
7. optimasi index;
8. tune pool hanya setelah DB capacity jelas.

### 36.2 Scenario: Pool Full karena Connection Leak

Gejala:

```text
active naik bertahap sampai max
pending naik
DB active query tidak sebanding
beberapa connection idle in transaction atau tidak menjalankan query
leak detection stack trace muncul
```

Langkah:

1. aktifkan leak detection sementara;
2. cari stack peminjam;
3. audit try-with-resources;
4. cari stream/lazy iterator yang membawa ResultSet keluar scope;
5. cek exception path;
6. cek manual transaction path.

### 36.3 Scenario: Pool Full saat External API Lambat

Gejala:

```text
active tinggi
DB tidak terlalu sibuk
thread dump menunjukkan banyak thread di HTTP client call
connection sudah dipinjam sebelum external call
```

Solusi:

1. jangan pegang connection saat external call;
2. ubah transaction boundary;
3. gunakan outbox/state machine;
4. gunakan idempotency key;
5. short transaction for state transition.

### 36.4 Scenario: Setelah DB Failover Banyak Error

Gejala:

```text
connection reset
broken pipe
stale connection
SQLRecoverableException / transient connection exception
pool perlahan recover
```

Langkah:

1. pastikan validation benar;
2. maxLifetime lebih pendek dari infra timeout;
3. connection error dianggap evict;
4. retry hanya untuk operasi idempotent atau transaction-level safe retry;
5. cek DNS cache;
6. cek driver failover support.

### 36.5 Scenario: Scaling Pod Membuat DB Habis Connection

Gejala:

```text
deployment scale dari 5 ke 20 pod
DB max connection reached
semua service mulai gagal connect
```

Solusi:

1. hitung total pool across pods;
2. kecilkan per-pod max pool;
3. gunakan HPA dengan DB-aware limit;
4. set startup staggering;
5. gunakan PgBouncer/DRCP/proxy jika sesuai;
6. pisahkan workloads.

---

## 37. Anti-Patterns Connection Pooling

### 37.1 Membuat Pool per Request

```java
public void handle() {
    HikariDataSource ds = new HikariDataSource(config);
    try (Connection c = ds.getConnection()) {
        // work
    }
    ds.close();
}
```

Ini menghancurkan tujuan pooling.

Pool harus long-lived, biasanya satu per aplikasi/workload/database target.

### 37.2 Menyimpan Connection sebagai Field Singleton

```java
class UserRepository {
    private final Connection connection;
}
```

Ini salah karena connection bukan dependency singleton yang aman dipakai bersama.

Yang disimpan adalah `DataSource`:

```java
class UserRepository {
    private final DataSource dataSource;
}
```

Lalu borrow per operation/transaction boundary.

### 37.3 Membesarkan Pool Saat Query Lambat

Kadang membantu jika DB underutilized.

Tetapi jika DB sudah bottleneck, ini memperparah.

### 37.4 Satu Pool untuk Semua Workload

Report, batch, OLTP, scheduler semua berbagi pool besar.

Risiko starvation tinggi.

### 37.5 Tidak Menghitung Total Pool per Cluster

Melihat `maximumPoolSize=20` terasa kecil, tetapi 50 pod berarti 1000 connections.

### 37.6 Connection Dipinjam Terlalu Awal

```java
try (Connection c = ds.getConnection()) {
    validateRequest();
    callExternalService();
    executeSql(c);
}
```

Borrow connection sedekat mungkin dengan kebutuhan DB.

### 37.7 Transaction Terbuka Saat Menunggu User/Input

Tidak boleh ada transaction yang menunggu user action manusia.

### 37.8 Menonaktifkan Timeout

Tanpa timeout, sistem gagal secara lambat dan tidak terkendali.

### 37.9 Mengandalkan Finalizer/GC untuk Close

JDBC resource harus ditutup deterministik.

### 37.10 Mengabaikan Pool Metrics

Tanpa metrics, pool tuning berubah menjadi tebak-tebakan.

---

## 38. Pool dan Statement Cache

Connection pool dan statement cache adalah hal berbeda.

Connection pool:

```text
reuse database connection/session
```

Statement cache:

```text
reuse prepared statement/server cursor/parse state
```

Beberapa driver punya prepared statement cache. Beberapa pool lama pernah menyediakan statement cache, tetapi pool modern sering mendorong statement caching ke driver karena driver lebih tahu protocol/database behavior.

Jangan mengasumsikan:

```text
Karena pakai pool, PreparedStatement otomatis dicache.
```

Itu tergantung driver dan konfigurasi.

---

## 39. Pool dan Database Proxy

Kadang arsitektur memakai database proxy/pooler:

1. PgBouncer;
2. Oracle DRCP;
3. RDS Proxy;
4. Cloud SQL Auth Proxy;
5. vendor-specific connection broker.

Ini tidak otomatis menghapus kebutuhan application-side pool.

Tetapi total model berubah:

```text
Application pool -> proxy/pooler -> database sessions
```

Manfaat proxy:

1. mengurangi session pressure di DB;
2. membantu failover;
3. credential management;
4. multiplexing;
5. connection warmup.

Risiko:

1. transaction/session semantics berubah;
2. prepared statement behavior berubah;
3. session variables tidak aman pada transaction pooling;
4. debugging lebih kompleks;
5. timeout layer bertambah.

Jika memakai proxy, pahami mode-nya:

```text
session pooling vs transaction pooling vs statement pooling
```

JDBC connection mengasumsikan session stateful. Proxy yang melakukan multiplexing bisa mengubah asumsi itu.

---

## 40. Pool Sizing Workflow Praktis

Langkah rasional:

### Step 1 — Tentukan Database Budget

```text
DB max safe app connections = X
```

Bukan hanya max_connections teknis, tetapi safe operating capacity.

### Step 2 — Hitung Semua Service dan Replica

```text
service_count * replicas * maxPoolSize
```

### Step 3 — Klasifikasi Workload

Pisahkan:

1. OLTP;
2. reporting;
3. batch;
4. scheduler;
5. admin;
6. integration.

### Step 4 — Ukur Connection Usage Time

Cari:

1. average;
2. p95;
3. p99;
4. max;
5. by endpoint;
6. by query class.

### Step 5 — Gunakan Little’s Law sebagai Estimasi Awal

```text
pool_needed ≈ target_db_ops_per_sec * db_connection_hold_time_sec
```

Tambah margin, tetapi jangan buta.

### Step 6 — Load Test

Uji beberapa ukuran pool:

```text
5, 10, 20, 30, 40
```

Amati:

1. throughput;
2. p95/p99 latency;
3. DB CPU;
4. DB wait;
5. pool pending;
6. timeout;
7. error rate.

### Step 7 — Pilih Titik Sebelum Saturasi

Jangan pilih pool size yang menghasilkan throughput tertinggi tetapi P99 liar.

Pilih ukuran yang memberi:

1. throughput cukup;
2. latency stabil;
3. DB headroom;
4. failure behavior terkendali.

### Step 8 — Tetapkan Alert

Alert bukan hanya CPU.

Minimal:

1. pending threads > 0 selama periode tertentu;
2. active mendekati max terlalu lama;
3. acquisition timeout > threshold;
4. usage p99 naik;
5. DB connection count mendekati limit;
6. DB lock wait/deadlock naik.

---

## 41. Worked Example: OLTP Service

Kondisi:

```text
Service: case-management-api
Replicas: 6 pods
Target: 300 request/sec cluster-wide
Request yang menyentuh DB: 80%
Rata-rata DB hold time: 40 ms
P95 DB hold time: 120 ms
Database budget untuk service ini: 120 connections
```

DB operations per second:

```text
300 * 0.8 = 240 db ops/sec
```

Cluster-wide concurrency by average:

```text
240 * 0.04 = 9.6 connections
```

By P95:

```text
240 * 0.12 = 28.8 connections
```

Per pod:

```text
28.8 / 6 = 4.8
```

Pool awal yang masuk akal mungkin:

```text
maximumPoolSize=8 atau 10 per pod
```

Total:

```text
6 * 10 = 60 connections
```

Masih di bawah budget 120.

Jika langsung memilih 30 per pod:

```text
6 * 30 = 180 connections
```

Melebihi budget.

Ini menunjukkan angka pool sering lebih kecil dari intuisi awal.

---

## 42. Worked Example: Report Query Mengganggu OLTP

Kondisi:

```text
Pool size: 20
OLTP query: 20-80 ms
Report query: 30-120 detik
Report endpoint bisa dipanggil 10 user bersamaan
```

Saat 10 report query berjalan:

```text
10 dari 20 connection tertahan lama
```

OLTP hanya punya sisa 10 connection. Jika traffic naik, pool pending.

Solusi:

```text
oltp pool: 20
report pool: 3
```

Efek:

1. report dibatasi maksimal 3 concurrent;
2. OLTP tetap punya kapasitas;
3. report user mungkin antre/fail fast;
4. sistem utama tetap sehat.

Ini contoh pool sebagai bulkhead.

---

## 43. Worked Example: Long Transaction dalam Workflow Regulatori

Misal flow:

```text
1. officer claim case
2. system update case status
3. system insert audit trail
4. system generate PDF
5. system call external notification service
6. system commit
```

Jika semua dalam satu transaction:

```text
DB connection held during PDF generation and external call
Locks held too long
Audit insert not visible until commit
Pool slot held too long
```

Desain lebih baik:

```text
Transaction A:
  - validate case version
  - claim case
  - insert audit
  - insert outbox notification event
  - commit

Async worker:
  - generate PDF if needed
  - send notification
  - mark outbox sent
```

Connection pool impact:

1. transaction pendek;
2. connection cepat kembali;
3. lock duration pendek;
4. external failure tidak menahan DB transaction;
5. retry bisa dikontrol di outbox.

---

## 44. Red Flags dalam Code Review

Cari pattern berikut:

```java
private Connection connection;
```

```java
static Connection connection;
```

```java
DataSource ds = new HikariDataSource(config); // inside method/request
```

```java
Connection c = dataSource.getConnection();
// many lines of validation/external call before SQL
```

```java
connection.setAutoCommit(false);
// no finally rollback
```

```java
return resultSet;
```

```java
return streamBackedByResultSet;
```

```java
catch (SQLException e) {
    // ignore
}
```

```java
maximumPoolSize=100
```

tanpa capacity justification.

```java
minimumIdle=maximumPoolSize=50
```

di banyak pod tanpa DB budget.

```java
connectionTimeout=60000
```

padahal upstream timeout 10 detik.

---

## 45. Review Checklist Connection Pooling

### 45.1 Lifecycle

- [ ] Pool dibuat sekali per application lifecycle, bukan per request.
- [ ] Pool ditutup saat shutdown.
- [ ] `DataSource` adalah dependency, bukan `Connection`.
- [ ] Semua JDBC resource memakai try-with-resources.

### 45.2 Capacity

- [ ] `maximumPoolSize` dihitung per pod/instance.
- [ ] Total connection semua replica dihitung.
- [ ] Ada DB connection budget.
- [ ] Ada headroom untuk admin/migration/monitoring.
- [ ] Pool report/batch dipisah jika workload panjang.

### 45.3 Transaction

- [ ] Transaction pendek.
- [ ] Tidak ada external call saat memegang connection kecuali benar-benar perlu.
- [ ] Rollback dijamin pada exception.
- [ ] Connection tidak menyeberang thread sembarangan.

### 45.4 Timeout

- [ ] `connectionTimeout` selaras dengan request timeout.
- [ ] Query timeout/statement timeout dipertimbangkan.
- [ ] Socket/network timeout driver dikonfigurasi jika perlu.
- [ ] `maxLifetime` lebih pendek dari infra timeout.

### 45.5 Observability

- [ ] Active/idle/total/pending metrics tersedia.
- [ ] Acquisition time tersedia.
- [ ] Usage time tersedia.
- [ ] Timeout count tersedia.
- [ ] Slow query logs tersedia.
- [ ] DB session/wait metrics dikorelasikan.

### 45.6 Failure

- [ ] DB restart/failover pernah diuji.
- [ ] Credential failure behavior dipahami.
- [ ] Broken connection dievict.
- [ ] Retry policy tidak menyebabkan storm.
- [ ] Startup readiness sesuai DB dependency.

---

## 46. Mental Model Final

Connection pool harus dipahami sebagai:

```text
A bounded scheduler for expensive, stateful, failure-prone database sessions.
```

Bukan sekadar:

```text
A cache of database connections.
```

Tiga fungsi besarnya:

```text
1. Latency optimization
   Reuse connection agar tidak membuat koneksi baru setiap request.

2. Capacity protection
   Batasi concurrency agar database tidak dibanjiri.

3. Failure containment
   Beri timeout, validation, eviction, leak detection, dan backpressure.
```

Jika pool sehat:

```text
borrow cepat
usage time terkendali
pending rendah/sesaat
DB active session masuk akal
latency stabil
```

Jika pool tidak sehat:

```text
pending naik
acquisition timeout
active stuck
DB wait naik
request timeout cascade
retry storm
```

Top 1% engineer tidak men-tune pool dengan feeling.

Ia bertanya:

1. workload apa yang memakai pool ini?
2. berapa lama connection dipinjam?
3. berapa concurrency database yang aman?
4. berapa total pool semua pod/service?
5. di mana antrean paling aman diletakkan?
6. apa failure behavior saat DB lambat, down, atau failover?
7. metrics apa yang membuktikan hipotesis?
8. apakah pool melindungi sistem atau justru memperbesar blast radius?

---

## 47. Ringkasan

Di part ini kita membangun fondasi connection pooling:

1. Connection pool adalah scheduler resource database, bukan sekadar cache.
2. JDBC connection mahal karena membawa network socket, authentication, dan DB session.
3. Pool membatasi concurrency ke database.
4. `close()` pada pooled connection biasanya berarti return to pool, bukan close physical socket.
5. Active, idle, total, pending, acquisition time, dan usage time adalah vocabulary wajib.
6. Pool exhaustion adalah gejala, bukan diagnosis final.
7. Leak hanyalah salah satu penyebab pool exhaustion.
8. Query lambat, transaction panjang, external call, lock wait, dan DB saturation juga bisa menghabiskan pool.
9. Pool sizing harus dilihat per cluster, bukan per instance saja.
10. Kubernetes membuat pool multiplication menjadi risiko besar.
11. Pool terlalu besar bisa memperburuk latency dan menurunkan throughput.
12. Little’s Law membantu estimasi awal, tetapi load test dan metrics tetap wajib.
13. Timeout, validation, idle timeout, max lifetime, dan leak detection adalah bagian dari failure design.
14. Multi-pool dapat menjadi bulkhead antar workload.
15. Observability pool harus selalu dikorelasikan dengan observability database.

---

## 48. Referensi

Referensi utama yang relevan untuk part ini:

1. Java SE `javax.sql.DataSource` — DataSource sebagai factory koneksi dan alternatif yang direkomendasikan dibanding `DriverManager`.
2. Java SE `javax.sql.ConnectionPoolDataSource` — factory untuk physical connection yang dapat digunakan sebagai pooled connection.
3. Java SE `javax.sql.PooledConnection` — representasi physical connection yang dapat didaur ulang oleh connection pool.
4. Oracle Java Tutorials — penggunaan `DataSource`, distributed transaction, dan connection pooling.
5. HikariCP README — konfigurasi dasar pool seperti `maximumPoolSize`, `minimumIdle`, `connectionTimeout`, `idleTimeout`, `maxLifetime`, dan lifecycle behavior.
6. HikariCP Wiki “About Pool Sizing” — prinsip bahwa pool sizing sering counter-intuitive dan pool besar tidak selalu lebih baik.
7. Dokumentasi vendor database/driver terkait connection/session timeout, validation, dan pooling behavior.

---

## 49. Transisi ke Part Berikutnya

Part ini membahas konsep connection pooling secara umum.

Part berikutnya akan masuk ke HikariCP secara spesifik:

```text
Part 019 — HikariCP Architecture and Design Philosophy
```

Fokus berikutnya:

1. apa itu HikariCP;
2. kenapa HikariCP populer;
3. `HikariConfig` dan `HikariDataSource`;
4. fast-path borrow;
5. proxy connection;
6. connection state reset;
7. housekeeper;
8. validation;
9. fail-fast behavior;
10. kenapa HikariCP sengaja punya sedikit knob;
11. implikasi desain HikariCP untuk production tuning.

