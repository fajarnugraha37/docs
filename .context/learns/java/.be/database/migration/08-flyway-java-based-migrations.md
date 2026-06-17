# Part 8 — Flyway Java-Based Migrations

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `08-flyway-java-based-migrations.md`  
**Target:** Java 8 hingga Java 25  
**Focus:** Java-based migration di Flyway untuk kasus yang tidak ideal dikerjakan dengan SQL biasa: complex backfill, transformasi data besar, transformasi berbasis aturan domain, enkripsi/dekripsi, chunking, checkpointing, observability, dan failure recovery.

---

## 1. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

1. orientasi database change engineering,
2. taxonomy perubahan database,
3. invariants dan failure model,
4. database versioning,
5. Flyway mental model,
6. setup Flyway di Java 8–25,
7. desain SQL migration,
8. repeatable migrations.

Sekarang kita masuk ke topik yang lebih berbahaya sekaligus powerful: **Java-based migration**.

Kalau SQL migration adalah bentuk paling eksplisit dan audit-friendly, Java-based migration adalah bentuk yang memberi kita kemampuan procedural penuh. Dengan Java, kita bisa melakukan loop, batching, validasi kompleks, parsing format legacy, transformasi menggunakan library, enkripsi, hashing, mapping domain, dan integrasi dengan algoritma yang sulit ditulis sebagai SQL.

Namun kekuatan ini punya harga: Java migration lebih mudah menjadi tidak transparan, sulit direview oleh DBA, sulit diprediksi durasinya, sulit dijalankan ulang, dan bisa membawa dependency aplikasi ke proses migrasi database.

Mental model utama part ini:

> Java-based migration bukan pengganti SQL migration. Java-based migration adalah escape hatch untuk perubahan data yang memang membutuhkan procedural logic, dan harus diperlakukan seperti production batch job yang versioned, deterministic, auditable, idempotent, observable, dan recoverable.

---

## 2. Apa Itu Flyway Java-Based Migration?

Dalam Flyway, migration umumnya berbentuk file SQL seperti:

```text
V001__create_customer_table.sql
V002__add_customer_status.sql
V003__seed_customer_status.sql
```

Namun Flyway juga mendukung migration yang ditulis sebagai class Java. Secara konseptual, class tersebut menjadi bagian dari rangkaian versioned migration yang dieksekusi berdasarkan versi dan nama.

Contoh nama konseptual:

```text
V004__BackfillCustomerNormalizedName.java
```

atau class Java:

```java
package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

public class V004__BackfillCustomerNormalizedName extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        // migration logic here
    }
}
```

Di dalam method `migrate`, kita mendapat akses ke `java.sql.Connection` melalui:

```java
Connection connection = context.getConnection();
```

Dari sana, kita bisa memakai JDBC biasa:

```java
try (PreparedStatement ps = connection.prepareStatement(
        "update customer set normalized_name = lower(name) where normalized_name is null")) {
    ps.executeUpdate();
}
```

Secara mekanis, Flyway memperlakukan Java migration sebagai migration versioned yang dicatat di schema history table sama seperti SQL migration.

Namun dari sisi engineering, Java migration punya karakter berbeda:

| Aspek | SQL Migration | Java Migration |
|---|---|---|
| Transparansi | Tinggi | Sedang/rendah jika logic panjang |
| Review DBA | Mudah | Lebih sulit |
| Expressiveness | Terbatas pada SQL/procedural DB | Sangat tinggi |
| Portability | Vendor-specific SQL bisa terbatas | Bisa abstrak tapi tetap bergantung SQL query |
| Risiko side effect | Relatif rendah | Lebih tinggi |
| Dependency risk | Rendah | Tinggi jika membawa library/app code |
| Cocok untuk DDL | Ya | Jarang perlu |
| Cocok untuk complex data transform | Kadang | Ya |
| Cocok untuk long-running backfill | Hati-hati | Bisa, tapi perlu desain batch |

---

## 3. Kapan Java-Based Migration Layak Dipakai?

Gunakan Java migration ketika SQL biasa menjadi terlalu rapuh, terlalu tidak readable, atau tidak mampu mengekspresikan transformasi secara aman.

### 3.1 Complex Data Transformation

Contoh:

- memecah field legacy `full_name` menjadi `first_name`, `middle_name`, `last_name` dengan aturan domain,
- parsing JSON lama ke struktur baru,
- migrasi serialized object lama ke format baru,
- normalisasi data berdasarkan rule yang banyak cabangnya,
- memperbaiki data historis berdasarkan kombinasi beberapa tabel,
- mengubah format nomor referensi berdasarkan algoritma tertentu.

SQL bisa melakukan banyak hal, tetapi ketika SQL berubah menjadi ratusan baris `case when`, `regexp_replace`, nested query, dan CTE yang sulit diuji, Java migration bisa lebih jelas.

Namun jangan langsung memilih Java hanya karena lebih nyaman. Pertanyaan pertama tetap:

> Apakah perubahan ini bisa dibuat sebagai SQL sederhana, deterministic, dan mudah direview?

Jika jawabannya ya, pakai SQL.

### 3.2 Data Transformation yang Membutuhkan Library Java

Contoh:

- hashing password lama ke format baru,
- mengenkripsi ulang field menggunakan library crypto,
- parsing format XML/JSON/custom legacy,
- validasi checksum,
- mapping format tanggal legacy,
- transliteration/unicode normalization,
- transformasi berdasarkan parser yang sudah tersedia di Java.

Tetapi hati-hati: membawa library ke migration berarti migration sekarang bergantung pada classpath, versi library, dan behavior library tersebut.

Migration yang dijalankan hari ini dan migration yang dijalankan dua tahun lagi harus menghasilkan output yang sama. Kalau library berubah behavior, determinisme rusak.

### 3.3 Migration yang Butuh Chunking dan Progress Control

Contoh:

- backfill 50 juta row,
- update table besar tanpa lock panjang,
- transformasi batch per primary key range,
- migration yang perlu checkpoint,
- migration yang perlu throttle agar tidak mengganggu production traffic.

SQL tunggal seperti ini sangat berbahaya:

```sql
update big_table
set normalized_value = lower(raw_value)
where normalized_value is null;
```

Pada table kecil, ini tidak masalah. Pada table besar, ini bisa:

- menahan lock terlalu lama,
- menghasilkan undo/redo/WAL besar,
- menyebabkan replication lag,
- memblokir transaksi aplikasi,
- memenuhi transaction log,
- gagal di tengah jalan tanpa progress yang jelas.

Java migration bisa melakukan batch:

```java
while (true) {
    int updated = updateNextBatch(connection, 1000);
    if (updated == 0) break;
    connection.commit();
    sleepBriefly();
}
```

Namun ini juga berarti migration menjadi seperti batch job. Maka perlu desain observability dan recovery.

### 3.4 Migration yang Membutuhkan Externalized Algorithm, Bukan External Service

Ada perbedaan penting:

- memakai algoritma/library lokal: bisa diterima,
- memanggil external API/service: hampir selalu buruk.

Java migration boleh menggunakan local deterministic function. Java migration sebaiknya tidak memanggil:

- payment service,
- user service,
- auth service,
- email service,
- third-party API,
- HTTP endpoint internal,
- message broker,
- object storage yang tidak versioned,
- config service yang mutable.

Mengapa?

Karena database migration harus bisa diprediksi. External service membuat migration bergantung pada network, auth, latency, rate limit, availability, dan behavior runtime di luar database.

Rule of thumb:

> Java migration boleh procedural, tetapi jangan distributed.

---

## 4. Kapan Java-Based Migration Tidak Boleh Dipakai?

### 4.1 Untuk DDL Sederhana

Jangan memakai Java untuk hal seperti:

```sql
alter table customer add normalized_name varchar(255);
```

DDL sederhana harus tetap SQL. Java wrapper hanya membuatnya kurang transparan.

Buruk:

```java
statement.execute("alter table customer add normalized_name varchar(255)");
```

Lebih baik:

```sql
alter table customer add normalized_name varchar(255);
```

### 4.2 Untuk Menyembunyikan Logic Bisnis

Java migration bukan tempat untuk menjalankan use case aplikasi.

Buruk:

```java
customerService.recalculateAllCustomerRiskScores();
```

Mengapa buruk?

Karena `customerService` mungkin:

- memakai repository JPA,
- bergantung pada Spring context,
- memanggil service lain,
- membaca config runtime,
- memproduksi event,
- mengirim notification,
- memiliki behavior berbeda di versi aplikasi berikutnya.

Migration harus stable. Business service adalah runtime behavior yang berubah mengikuti aplikasi.

### 4.3 Untuk Memakai ORM Entity

Sangat menggoda untuk menulis migration seperti:

```java
List<Customer> customers = customerRepository.findAll();
for (Customer customer : customers) {
    customer.setNormalizedName(normalize(customer.getName()));
}
customerRepository.saveAll(customers);
```

Ini hampir selalu anti-pattern.

Masalahnya:

1. Entity mapping berubah dari waktu ke waktu.
2. Migration lama bisa gagal karena entity baru tidak cocok dengan schema lama.
3. Lazy loading bisa memicu query tak terduga.
4. Lifecycle callback bisa jalan tanpa disadari.
5. Validation bisa berbeda dari saat migration dibuat.
6. Repository bisa membawa transaction semantics aplikasi.
7. Hibernate bisa menghasilkan SQL yang tidak optimal untuk batch besar.

Migration harus menggunakan JDBC eksplisit, bukan ORM runtime model.

Rule:

> Java migration should treat the database as the source, not the current application entity model.

### 4.4 Untuk Mengakses State yang Mutable di Luar Migration

Jangan membuat migration bergantung pada:

- current date tanpa alasan kuat,
- random UUID yang tidak stabil,
- environment-specific config tanpa kontrol,
- remote file yang bisa berubah,
- current application feature flag,
- current user session,
- current locale/timezone default JVM,
- current hostname/pod name.

Contoh buruk:

```java
String batchId = UUID.randomUUID().toString();
Timestamp now = new Timestamp(System.currentTimeMillis());
```

Kadang timestamp memang perlu, tetapi harus sadar bahwa ini membuat hasil migration tidak deterministic.

Lebih baik:

- gunakan timestamp fixed jika bagian dari seed,
- gunakan nilai dari data existing,
- gunakan deterministic UUID dari namespace + natural key,
- catat migration execution metadata terpisah dari business data.

---

## 5. Mental Model: Java Migration sebagai Deterministic Program

Java migration adalah program. Tetapi bukan program biasa.

Aplikasi biasa boleh bereaksi terhadap input runtime, user request, dan external dependency. Migration tidak boleh seperti itu. Migration harus seperti transformasi deterministic:

```text
Given database state S at version Vn,
when migration M runs,
then database becomes state S' at version Vn+1,
with predictable side effects,
and recorded execution history.
```

Dengan kata lain:

```text
Migration = deterministic state transition over database state.
```

### 5.1 Properti Migration yang Baik

Migration Java yang baik harus:

1. **Ordered** — berjalan pada posisi versi yang jelas.
2. **Deterministic** — input sama menghasilkan output sama.
3. **Bounded** — scope dan dampaknya jelas.
4. **Observable** — progress dan error terlihat.
5. **Recoverable** — bisa dipulihkan jika gagal.
6. **Idempotent-aware** — aman terhadap retry sejauh mungkin.
7. **Reviewable** — reviewer bisa memahami data apa yang berubah.
8. **Minimal dependency** — tidak bergantung pada service aplikasi yang berubah.
9. **Resource-aware** — tidak menghabiskan memory/connection/log secara liar.
10. **Production-aware** — mempertimbangkan lock, volume, timeout, dan traffic.

### 5.2 Java Migration Bukan Application Runtime

Perbedaan penting:

| Dimensi | Application Runtime | Java Migration |
|---|---|---|
| Tujuan | Melayani request | Mengubah database state |
| Input | User/API/event | Existing database state |
| Dependency | Bisa banyak | Harus minimal |
| Failure | Request bisa retry | DB bisa half-migrated |
| Observability | Logs/metrics request | Logs/progress migration |
| Duration | Millisecond-second | Bisa second-hour |
| Rollback | Transaksi request | Sulit jika data besar/DDL |
| Version coupling | Current app version | Harus survive future execution |

---

## 6. Struktur Dasar Java Migration Flyway

Contoh minimal:

```java
package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.PreparedStatement;

public class V008__BackfillCustomerNormalizedName extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();

        try (PreparedStatement ps = connection.prepareStatement(
                "update customer " +
                "set normalized_name = lower(name) " +
                "where normalized_name is null")) {
            int updated = ps.executeUpdate();
            System.out.println("Updated customer rows: " + updated);
        }
    }
}
```

Ini valid, tetapi masih terlalu sederhana untuk data besar.

### 6.1 Package Convention

Default umum:

```text
src/main/java/db/migration
```

Class:

```text
db.migration.V008__BackfillCustomerNormalizedName
```

Nama class harus mengikuti convention Flyway untuk versioned migration.

```text
V<version>__<Description>
```

Contoh:

```text
V202601151030__BackfillCustomerNormalizedName
V42__NormalizeLegacyStatusCode
```

### 6.2 Jangan Taruh di Package Domain Aplikasi

Buruk:

```text
com.company.customer.service.migration.V008__BackfillCustomerNormalizedName
```

Lebih baik:

```text
db.migration.V008__BackfillCustomerNormalizedName
```

Mengapa?

Karena migration adalah artifact database, bukan bagian dari domain service runtime. Semakin dekat migration ke package domain, semakin besar godaan memakai service/repository/entity aplikasi.

### 6.3 Jangan Extend Abstraction Terlalu Banyak

Boleh membuat helper kecil, tetapi jangan membuat framework migration internal yang terlalu besar.

Boleh:

```java
final class JdbcBatchSupport {
    static void setQueryTimeout(PreparedStatement ps, int seconds) throws SQLException {
        ps.setQueryTimeout(seconds);
    }
}
```

Berbahaya:

```java
abstract class EnterpriseMigrationFramework extends ApplicationServiceSupport {
    // autowire services, repositories, event publisher, cache, etc.
}
```

Migration harus sederhana, eksplisit, dan mudah dibaca.

---

## 7. Java Version Compatibility: Java 8 hingga 25

Karena seri ini menargetkan Java 8 hingga 25, gaya kode migration perlu mempertimbangkan fitur bahasa dan runtime.

### 7.1 Jika Project Masih Java 8

Gunakan style konservatif:

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    // execute
}
```

Hindari fitur Java baru seperti:

- `var`,
- records,
- switch expression,
- text blocks,
- pattern matching,
- virtual threads.

String SQL bisa ditulis dengan concatenation:

```java
private static final String SELECT_BATCH =
        "select id, raw_name " +
        "from customer " +
        "where normalized_name is null " +
        "order by id " +
        "fetch first ? rows only";
```

Tetapi hati-hati: `fetch first ? rows only` tidak sama support-nya di semua DB/vendor/version.

### 7.2 Jika Project Java 17+

Bisa memakai text blocks:

```java
private static final String SELECT_BATCH = """
        select id, raw_name
        from customer
        where normalized_name is null
        order by id
        fetch first ? rows only
        """;
```

Text block meningkatkan readability SQL.

Namun jangan memakai fitur modern hanya karena tersedia. Migration code harus long-lived. Semakin sederhana syntax-nya, semakin mudah dipelihara lintas versi.

### 7.3 Jika Project Java 21/25

Virtual threads bisa menarik untuk parallel migration, tetapi hati-hati.

Migration bukan workload request server. Parallelism berlebihan bisa:

- membebani database,
- meningkatkan lock contention,
- meningkatkan redo/WAL,
- membuat progress sulit diprediksi,
- memperburuk blast radius saat ada bug.

Untuk migration, throttled sequential atau limited parallelism sering lebih aman daripada memaksimalkan concurrency.

Rule:

> Database migration should optimize for safety and predictability first, throughput second.

---

## 8. Transaction Handling dalam Java Migration

Transaction behavior adalah salah satu aspek paling penting.

Flyway mengatur transaction tergantung database dan konfigurasi. Namun Java migration yang melakukan batching mungkin perlu mengelola commit boundary dengan sangat hati-hati.

### 8.1 Single Transaction Migration

Untuk perubahan kecil, single transaction bagus:

```java
@Override
public void migrate(Context context) throws Exception {
    Connection connection = context.getConnection();

    try (PreparedStatement ps = connection.prepareStatement(
            "update customer set normalized_name = lower(name) where normalized_name is null")) {
        ps.executeUpdate();
    }
}
```

Keuntungan:

- atomic,
- gagal berarti rollback semua,
- mudah reasoning.

Kekurangan:

- buruk untuk data besar,
- lock lama,
- undo/redo besar,
- transaction log besar,
- bisa timeout.

### 8.2 Chunked Transaction Migration

Untuk data besar, kita ingin commit per batch.

Namun ini mengubah failure model:

```text
Jika batch 1-100 berhasil commit lalu batch 101 gagal,
database berada dalam state partially migrated.
```

Maka migration harus bisa dilanjutkan.

Contoh pattern:

```java
public class V008__BackfillCustomerNormalizedName extends BaseJavaMigration {

    private static final int BATCH_SIZE = 1000;

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        boolean oldAutoCommit = connection.getAutoCommit();

        try {
            connection.setAutoCommit(false);

            while (true) {
                int updated = updateBatch(connection);
                connection.commit();

                System.out.println("Updated batch rows: " + updated);

                if (updated == 0) {
                    break;
                }
            }
        } catch (Exception e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(oldAutoCommit);
        }
    }

    private int updateBatch(Connection connection) throws Exception {
        String sql =
                "update customer " +
                "set normalized_name = lower(name) " +
                "where normalized_name is null " +
                "and id in (" +
                "  select id from customer " +
                "  where normalized_name is null " +
                "  order by id " +
                "  fetch first ? rows only" +
                ")";

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, BATCH_SIZE);
            return ps.executeUpdate();
        }
    }
}
```

Catatan: SQL di atas vendor-sensitive. Untuk Oracle, PostgreSQL, MySQL, SQL Server, syntax batch selection bisa berbeda. Nanti vendor-specific migration dibahas lebih dalam di Part 22.

### 8.3 Transactional DDL vs Non-Transactional DDL

Beberapa database mendukung transactional DDL lebih baik daripada yang lain. DDL seperti `alter table` bisa auto-commit pada beberapa DB, atau memegang metadata lock besar.

Java migration sebaiknya tidak mencampur:

- DDL,
- DML besar,
- batch loop,
- data validation,
- cleanup,

dalam satu migration raksasa.

Lebih baik split:

```text
V010__add_customer_normalized_name_column.sql
V011__backfill_customer_normalized_name.java
V012__add_customer_normalized_name_not_null_constraint.sql
```

Dengan split ini, failure boundary lebih jelas.

---

## 9. Idempotency dalam Java Migration

Flyway versioned migration normalnya hanya berjalan sekali. Namun kita tetap perlu idempotency awareness karena:

- migration bisa gagal setelah sebagian commit,
- operator bisa melakukan repair dan retry,
- migration bisa dijalankan di clone environment,
- data mungkin sudah sebagian berubah karena hotfix/manual fix,
- batch job bisa restart.

### 9.1 Idempotent Predicate

Contoh:

```sql
where normalized_name is null
```

Ini membuat migration hanya mengubah row yang belum diproses.

Buruk:

```sql
update customer set normalized_name = lower(name);
```

Lebih baik:

```sql
update customer
set normalized_name = lower(name)
where normalized_name is null;
```

### 9.2 Processed Marker

Untuk transformasi kompleks, kita bisa memakai marker column:

```sql
alter table customer add name_migration_status varchar(20);
```

Lalu Java migration:

```sql
where name_migration_status is null
```

Setelah berhasil:

```sql
set name_migration_status = 'DONE'
```

Tetapi marker column harus direncanakan:

- apakah akan dihapus di contract phase?
- apakah boleh terlihat di aplikasi?
- apakah perlu index?
- apakah status failed perlu disimpan?

### 9.3 Checkpoint Table

Untuk backfill besar, bisa pakai checkpoint table:

```sql
create table migration_checkpoint (
    migration_name varchar(200) primary key,
    last_processed_id bigint not null,
    updated_at timestamp not null
);
```

Java migration membaca `last_processed_id`, memproses range berikutnya, lalu update checkpoint.

Pattern ini cocok jika:

- data sangat besar,
- migration commit per batch,
- restart harus efisien,
- scan `where target is null` terlalu mahal.

Namun jangan over-engineer untuk data kecil.

---

## 10. Batch Processing Pattern

### 10.1 Pattern 1: Update by Predicate Until Zero

Pseudo:

```text
repeat:
  update next N rows where target is null
  commit
until updated = 0
```

Keuntungan:

- sederhana,
- tidak perlu checkpoint explicit,
- bisa resume karena predicate `target is null`.

Kekurangan:

- repeated scanning bisa mahal,
- perlu index yang mendukung predicate,
- row ordering bisa vendor-specific.

### 10.2 Pattern 2: Select IDs then Update by IDs

Pseudo:

```text
repeat:
  select N ids where target is null order by id
  compute transformed values in Java
  update rows by id
  commit
until no ids
```

Contoh:

```java
private List<CustomerRow> fetchBatch(Connection connection, long lastId, int batchSize) throws SQLException {
    String sql =
            "select id, name " +
            "from customer " +
            "where id > ? " +
            "and normalized_name is null " +
            "order by id";

    List<CustomerRow> rows = new ArrayList<CustomerRow>();

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setLong(1, lastId);
        ps.setMaxRows(batchSize);

        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                rows.add(new CustomerRow(rs.getLong("id"), rs.getString("name")));
            }
        }
    }

    return rows;
}
```

Update:

```java
private int updateRows(Connection connection, List<CustomerRow> rows) throws SQLException {
    String sql = "update customer set normalized_name = ? where id = ? and normalized_name is null";

    int total = 0;

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        for (CustomerRow row : rows) {
            ps.setString(1, normalize(row.name));
            ps.setLong(2, row.id);
            ps.addBatch();
        }

        int[] results = ps.executeBatch();
        for (int result : results) {
            if (result >= 0) {
                total += result;
            }
        }
    }

    return total;
}
```

### 10.3 Pattern 3: Primary Key Range Window

Pseudo:

```text
min_id = select min(id)
max_id = select max(id)
for start in range(min_id, max_id, batch_size):
  update where id >= start and id < start + batch_size
  commit
```

Keuntungan:

- predictable window,
- tidak perlu repeated select IDs,
- cocok untuk numeric monotonic PK.

Kekurangan:

- gap di ID membuat batch tidak seimbang,
- tidak cocok untuk UUID random,
- perlu hati-hati kalau row baru masuk saat migration.

### 10.4 Pattern 4: Cursor Streaming

Cursor streaming bisa dipakai untuk membaca data besar, tetapi harus hati-hati:

- jangan tahan transaction terlalu lama,
- jangan tahan cursor saat update table yang sama secara kompleks,
- jangan load semua row ke memory,
- pastikan fetch size benar untuk driver/vendor.

Pattern ini lebih cocok untuk read-only export/validation dibanding update massal dalam migration.

---

## 11. Memory Safety

Java migration yang buruk sering gagal karena menganggap data production kecil.

Buruk:

```java
List<Customer> all = new ArrayList<>();
while (rs.next()) {
    all.add(map(rs));
}
```

Jika table berisi jutaan row, ini bisa OutOfMemoryError.

Lebih baik:

- proses per batch,
- batasi list size,
- commit dan clear batch,
- jangan simpan semua ID,
- jangan membangun string SQL raksasa,
- jangan menyimpan object domain besar,
- jangan memakai JSON parser yang memuat semua document besar jika bisa streaming.

### 11.1 Memory Budget Thinking

Sebelum migration, tanyakan:

1. Berapa row yang akan diproses?
2. Berapa ukuran rata-rata row?
3. Apakah ada CLOB/BLOB?
4. Apakah transformasi membuat object tambahan?
5. Berapa heap migration process?
6. Apakah migration berjalan di app startup dengan heap aplikasi?
7. Apakah ada risk GC pause?

Jika migration dijalankan saat aplikasi startup, memory yang dipakai migration bersaing dengan memory aplikasi.

Untuk backfill besar, lebih aman menjalankan migration sebagai external job/container dengan resource khusus daripada di startup path aplikasi.

---

## 12. Query Timeout, Lock Timeout, dan Throttling

Migration production harus tidak hanya benar, tetapi juga sopan terhadap database.

### 12.1 Query Timeout

Dengan JDBC:

```java
ps.setQueryTimeout(60);
```

Ini memberi batas waktu eksekusi statement. Namun behavior detail bisa bergantung driver.

### 12.2 Lock Timeout

Lock timeout biasanya vendor-specific dan bisa diatur dengan SQL session setting.

Contoh konseptual:

```java
try (Statement st = connection.createStatement()) {
    st.execute("set lock_timeout = '5s'");
}
```

Atau untuk database lain syntax-nya berbeda.

Tujuannya:

- jangan menunggu lock selamanya,
- fail fast jika migration mengganggu traffic,
- memberi operator kesempatan retry di window yang lebih aman.

### 12.3 Throttling

Untuk backfill besar:

```java
private void throttle() throws InterruptedException {
    Thread.sleep(100);
}
```

Sederhana, tetapi efektif.

Throttle berdasarkan:

- batch count,
- rows updated,
- elapsed time,
- database load,
- replication lag,
- lock wait metric.

Namun jangan membuat migration terlalu pintar membaca banyak metric external kecuali benar-benar perlu. Semakin banyak dependency, semakin rapuh.

---

## 13. Observability Java Migration

Java migration harus meninggalkan jejak yang jelas.

Minimal log:

```text
migration=V008__BackfillCustomerNormalizedName phase=start
migration=V008__BackfillCustomerNormalizedName batch=1 selected=1000 updated=1000 lastId=1000 elapsedMs=320
migration=V008__BackfillCustomerNormalizedName batch=2 selected=1000 updated=998 lastId=2000 elapsedMs=340
migration=V008__BackfillCustomerNormalizedName phase=complete totalUpdated=1998 elapsedMs=8120
```

### 13.1 Apa yang Perlu Dilog?

Untuk migration kecil:

- start,
- end,
- rows affected,
- duration.

Untuk migration besar:

- batch number,
- batch size,
- rows selected,
- rows updated,
- last processed key,
- duration per batch,
- total duration,
- error detail,
- retry count jika ada,
- throttle/sleep jika relevan.

### 13.2 Jangan Log Data Sensitif

Jangan log:

- email,
- phone number,
- national ID,
- access token,
- password hash,
- address,
- raw JSON PII,
- business confidential data.

Log identifier teknis secukupnya:

```text
id=12345
```

Bahkan ID pun harus dipertimbangkan jika sensitif. Untuk audit, lebih baik punya report query terkontrol daripada log PII.

### 13.3 Migration Audit Table Tambahan

Flyway schema history memberi tahu migration mana yang jalan. Tetapi untuk batch besar, kita kadang perlu audit tambahan.

Contoh:

```sql
create table migration_audit_log (
    migration_name varchar(200) not null,
    batch_no bigint not null,
    started_at timestamp not null,
    ended_at timestamp,
    rows_selected bigint,
    rows_updated bigint,
    last_processed_id bigint,
    status varchar(20) not null,
    error_message varchar(1000),
    primary key (migration_name, batch_no)
);
```

Namun hati-hati: audit table migration juga menjadi bagian dari schema. Jangan membuatnya sembarangan tanpa ownership.

---

## 14. Error Handling

### 14.1 Fail Fast untuk Data Unexpected

Misalnya status legacy hanya boleh `A`, `I`, `S`.

```java
private String mapStatus(String legacyStatus) {
    if ("A".equals(legacyStatus)) return "ACTIVE";
    if ("I".equals(legacyStatus)) return "INACTIVE";
    if ("S".equals(legacyStatus)) return "SUSPENDED";
    throw new IllegalStateException("Unknown legacy status: " + legacyStatus);
}
```

Namun jangan log data sensitif. Untuk status code, aman. Untuk PII, jangan.

Fail fast cocok jika data unexpected menunjukkan corruption dan migration tidak boleh menebak.

### 14.2 Quarantine Pattern

Untuk data besar, kadang lebih baik row invalid dicatat ke quarantine table dan migration lanjut.

Contoh:

```sql
create table migration_customer_name_quarantine (
    customer_id bigint primary key,
    reason varchar(500) not null,
    created_at timestamp not null
);
```

Kapan cocok?

- invalid data jumlah kecil,
- business menerima manual remediation,
- migration utama tidak boleh berhenti karena 5 row buruk,
- ada post-migration cleanup plan.

Kapan tidak cocok?

- invalid data mengindikasikan bug sistemik,
- hasil akhir harus 100% konsisten sebelum aplikasi baru jalan,
- migration mempengaruhi security/financial/legal correctness.

### 14.3 Retry

Retry di migration harus dibatasi.

Retry cocok untuk:

- transient deadlock,
- transient lock timeout,
- temporary serialization failure.

Retry tidak cocok untuk:

- syntax error,
- missing column,
- invalid data logic,
- constraint violation sistemik.

Contoh retry terbatas:

```java
private void executeWithRetry(SqlRunnable runnable) throws Exception {
    int maxAttempts = 3;
    long sleepMs = 500;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            runnable.run();
            return;
        } catch (SQLException e) {
            if (!isTransient(e) || attempt == maxAttempts) {
                throw e;
            }
            Thread.sleep(sleepMs);
            sleepMs *= 2;
        }
    }
}
```

Tetapi `isTransient` harus vendor-aware. Jangan retry semua SQLException secara buta.

---

## 15. Deterministic Transformation

### 15.1 Hindari Default Locale

Buruk:

```java
String normalized = name.toLowerCase();
```

Ini memakai default locale JVM. Dalam beberapa locale, hasil bisa berbeda.

Lebih baik:

```java
String normalized = name.toLowerCase(Locale.ROOT);
```

### 15.2 Hindari Default Timezone

Buruk:

```java
LocalDate date = legacyDate.toInstant()
        .atZone(ZoneId.systemDefault())
        .toLocalDate();
```

Lebih baik tentukan timezone eksplisit sesuai domain:

```java
private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Jakarta");
```

atau UTC:

```java
private static final ZoneId UTC = ZoneOffset.UTC;
```

### 15.3 Hindari Random Tanpa Deterministic Seed

Buruk:

```java
UUID id = UUID.randomUUID();
```

Jika perlu UUID deterministik, gunakan namespace/name-based UUID:

```java
UUID id = UUID.nameUUIDFromBytes(
        ("customer-status:" + legacyCode).getBytes(StandardCharsets.UTF_8));
```

### 15.4 Hindari Current Time untuk Business Data

Buruk:

```java
ps.setTimestamp(1, Timestamp.from(Instant.now()));
```

Jika field adalah migration metadata, `now` mungkin boleh. Jika field adalah business timestamp, cari sumber yang lebih benar dari data existing.

---

## 16. Dependency Management

Java migration hidup di classpath aplikasi/build. Ini bisa berbahaya.

### 16.1 Jangan Bergantung pada Domain Classes yang Berubah

Buruk:

```java
import com.company.customer.CustomerStatus;
```

Jika enum berubah di masa depan, migration lama bisa berbeda behavior.

Lebih baik copy mapping eksplisit di migration:

```java
private String mapStatus(String legacy) {
    if ("A".equals(legacy)) return "ACTIVE";
    if ("I".equals(legacy)) return "INACTIVE";
    throw new IllegalArgumentException("Unknown status");
}
```

Ya, ada duplikasi. Tapi ini duplikasi yang disengaja untuk historical stability.

### 16.2 Jangan Bergantung pada Spring Bean

Buruk:

```java
@Autowired
private CustomerService customerService;
```

Flyway Java migration sebaiknya tidak bergantung pada Spring dependency injection. Migration harus bisa dipahami sebagai database script dengan sedikit procedural logic.

### 16.3 Library Stabil Boleh, Tapi Pin Versinya

Boleh memakai:

- Jackson untuk parsing JSON legacy,
- XML parser,
- crypto provider,
- commons-codec,
- ICU4J untuk transliteration jika memang perlu.

Tapi versi library harus stabil dan perilakunya dipahami.

Jika migration memakai library yang nanti di-upgrade, hasil migration lama di environment baru bisa berbeda.

Mitigasi:

- test migration dengan golden dataset,
- pin behavior melalui unit test,
- hindari API yang behavior-nya locale/config-dependent,
- copy minimal algorithm jika lebih aman daripada dependency besar.

---

## 17. Java Migration dan Application Startup

Banyak Spring Boot app menjalankan Flyway saat startup. Ini nyaman, tetapi untuk Java migration besar bisa berisiko.

### 17.1 Startup Migration Cocok Untuk

- DDL kecil,
- seed kecil,
- metadata update kecil,
- view/function/procedure update kecil,
- data correction kecil.

### 17.2 Startup Migration Tidak Cocok Untuk

- backfill jutaan row,
- migration yang bisa berjalan puluhan menit,
- migration yang butuh throttle,
- migration yang butuh koordinasi operator,
- migration yang bisa lock table besar,
- migration dengan risk rollback manual,
- migration yang harus dilakukan sebelum/selama/after deploy choreography.

Jika migration besar dijalankan saat startup:

```text
Pod starts → migration runs 40 minutes → readiness false → rollout stuck → old pods may be terminated → traffic risk.
```

Atau lebih buruk:

```text
Multiple pods start together → all try migration → lock contention → startup storm.
```

Flyway punya locking mechanism untuk mencegah migration parallel, tetapi deployment orchestration tetap bisa terganggu.

### 17.3 External Migration Job Pattern

Untuk production-grade setup:

```text
1. Build app artifact.
2. Build migration artifact/container.
3. Run migration job before app rollout.
4. Validate migration result.
5. Rollout app.
```

Dalam Kubernetes:

```text
kubectl apply -f migration-job.yaml
wait until job complete
kubectl rollout restart deployment/app
```

Atau pipeline melakukan:

```text
flyway migrate
then deploy app
```

Part CI/CD akan membahas ini lebih dalam.

---

## 18. Concurrency and Locking

### 18.1 Jangan Asumsikan Tidak Ada Traffic

Production database mungkin tetap menerima traffic saat migration berjalan.

Pertanyaan wajib:

1. Apakah aplikasi lama masih menulis ke table yang sama?
2. Apakah aplikasi baru sudah deploy?
3. Apakah row yang sedang dimigrasi bisa berubah saat migration?
4. Apakah perlu freeze window?
5. Apakah perlu dual-write?
6. Apakah migration safe jika ada insert baru?

Contoh:

```sql
where normalized_name is null
```

Jika aplikasi lama terus insert row baru dengan `normalized_name = null`, migration loop `until zero` bisa terus mengejar data baru.

Solusi:

- deploy app yang mulai menulis field baru sebelum backfill,
- gunakan cutoff ID/timestamp,
- lakukan backfill untuk existing data saja,
- validasi delta setelah app switch.

### 18.2 Cutoff Pattern

```java
long maxIdAtStart = findMaxId(connection);

while (lastId < maxIdAtStart) {
    // process id <= maxIdAtStart only
}
```

Ini membuat migration bounded.

Namun row baru setelah migration mulai harus ditangani oleh aplikasi baru atau migration lanjutan.

### 18.3 Select For Update?

`select for update` bisa mencegah race, tetapi juga bisa meningkatkan lock contention.

Gunakan hanya jika:

- perlu guarantee row tidak berubah saat transformasi,
- batch kecil,
- lock timeout dikontrol,
- efek ke traffic dipahami.

Untuk banyak backfill, optimistic update lebih baik:

```sql
update customer
set normalized_name = ?
where id = ?
and normalized_name is null
```

Jika update count 0, berarti row sudah berubah oleh proses lain. Migration bisa skip atau re-read sesuai kebutuhan.

---

## 19. Java Migration untuk Encryption / Re-Encryption

Salah satu use case Java migration adalah crypto migration.

Contoh:

- plaintext ke encrypted column,
- old encryption key ke new encryption key,
- old algorithm ke new algorithm,
- hash lama ke hash baru.

### 19.1 Risiko Khusus Crypto Migration

Crypto migration berisiko tinggi karena:

- data bisa rusak permanen,
- key management sensitif,
- hasil tidak bisa diverifikasi dengan mudah tanpa decrypt,
- logging berbahaya,
- rollback sulit,
- compliance impact tinggi.

### 19.2 Pattern Aman

Jangan overwrite langsung tanpa backup/dual column.

Lebih aman:

```text
1. Add new encrypted column.
2. Backfill new_encrypted_value from old_value.
3. Validate decryptability/sample/full check.
4. Switch application read path.
5. Stop writing old column.
6. Contract old column later.
```

Contoh schema:

```sql
alter table customer_secret add secret_value_v2 blob;
alter table customer_secret add secret_migration_status varchar(20);
```

Migration:

```text
for each row where secret_value_v2 is null:
  decrypt old value using old key
  encrypt using new key
  update v2 column
  commit batch
```

### 19.3 Jangan Log Secret

Log hanya:

```text
migration=... rowId=123 status=encrypted
```

Bukan:

```text
oldSecret=... newSecret=...
```

---

## 20. Java Migration untuk JSON/XML Legacy Data

Java migration bisa berguna untuk parsing data semi-structured.

Contoh CLOB JSON lama:

```json
{
  "name": "Alice",
  "status": "A",
  "address": {
    "postal": "123456"
  }
}
```

Target columns:

```text
name
status_code
postal_code
```

### 20.1 Pattern

```java
JsonNode root = objectMapper.readTree(rawJson);
String name = text(root, "name");
String status = mapStatus(text(root, "status"));
String postal = root.path("address").path("postal").asText(null);
```

### 20.2 Validation Strategy

Untuk setiap row:

- parse success,
- required field exists,
- status mappable,
- output fits target column length,
- invalid row masuk quarantine atau fail fast.

### 20.3 CLOB Handling

Untuk CLOB besar:

- jangan load semua row sekaligus,
- baca per row,
- hati-hati memory parser,
- batasi batch size lebih kecil,
- pertimbangkan streaming parser jika document besar.

---

## 21. Java Migration dan Checksum Flyway

Flyway menghitung checksum untuk migration. Pada SQL migration, checksum berasal dari file SQL. Pada Java migration, behavior checksum berbeda dari SQL file karena Java class dikompilasi.

Konsekuensi praktis:

- Jangan mengedit Java migration lama setelah applied.
- Jangan mengubah behavior helper class yang dipakai migration lama tanpa sadar.
- Jangan membuat migration lama bergantung pada shared helper yang terus berubah.

Ini poin penting.

Misalnya:

```java
public class V008__BackfillCustomerNormalizedName extends BaseJavaMigration {
    private String normalize(String value) {
        return NormalizationUtils.normalizeName(value);
    }
}
```

Lalu 6 bulan kemudian `NormalizationUtils.normalizeName` berubah untuk kebutuhan aplikasi baru. Jika database baru dari scratch menjalankan semua migration, hasil `V008` bisa berbeda dari production lama.

Lebih aman:

```java
private String normalize(String value) {
    if (value == null) return null;
    return value.trim().toLowerCase(Locale.ROOT);
}
```

Historical logic dikunci di migration itu sendiri.

Rule:

> Shared helper in Java migration must be treated as immutable once used by an applied migration.

---

## 22. Testing Java-Based Migration

Java migration harus diuji di beberapa level.

### 22.1 Unit Test untuk Pure Transformation

Jika ada logic mapping:

```java
static String normalizeName(String input) {
    if (input == null) return null;
    return input.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
}
```

Test:

```java
@Test
void normalizesWhitespaceAndCase() {
    assertEquals("alice tan", normalizeName("  Alice   Tan  "));
}
```

### 22.2 Integration Test dengan Real Database

Gunakan Testcontainers atau database test yang sama dengan production engine.

Test flow:

```text
1. Start database.
2. Apply migrations until before Java migration.
3. Insert legacy fixture data.
4. Run target migration.
5. Assert transformed data.
6. Run validation query.
```

### 22.3 Fresh Database Test

Pastikan semua migration dari awal bisa jalan.

```text
empty database → flyway migrate → success
```

### 22.4 Upgrade Test

Lebih penting:

```text
previous release database snapshot → current migration → success
```

Karena production bukan empty database.

### 22.5 Partial Failure/Resume Test

Untuk chunked migration:

```text
1. Process first batch.
2. Simulate failure.
3. Retry migration or resume logic.
4. Verify no duplicate/corrupt data.
```

Flyway versioned migration yang gagal biasanya belum dianggap sukses. Jika migration melakukan commit per batch lalu gagal, retry behavior harus dipikirkan dengan cermat.

---

## 23. Review Checklist untuk Java Migration

Sebelum merge, reviewer harus bertanya:

### 23.1 Scope

- Data apa yang berubah?
- Berapa row estimasi?
- Apakah DDL dan DML dipisah?
- Apakah migration bounded?
- Apakah ada cutoff?

### 23.2 Determinism

- Apakah memakai default locale/timezone?
- Apakah memakai random/current time?
- Apakah bergantung pada external service?
- Apakah bergantung pada mutable application class?
- Apakah helper logic immutable?

### 23.3 Safety

- Apakah ada predicate yang mencegah overwrite?
- Apakah update idempotent-aware?
- Apakah ada batch size?
- Apakah ada commit boundary yang jelas?
- Apakah lock/timeout dipikirkan?
- Apakah rollback/roll-forward plan jelas?

### 23.4 Observability

- Apakah log start/end tersedia?
- Apakah row count dilog?
- Apakah batch progress dilog untuk data besar?
- Apakah PII tidak dilog?
- Apakah ada validation query?

### 23.5 Testing

- Apakah transformation punya unit test?
- Apakah migration punya integration test?
- Apakah diuji terhadap database vendor yang sama?
- Apakah diuji dengan data invalid?
- Apakah diuji dengan volume representatif?

---

## 24. Example: Production-Grade Java Backfill

Contoh berikut adalah pola konservatif. Ini bukan template universal, tetapi menunjukkan struktur reasoning.

Scenario:

- Table `customer` punya column `name`.
- Kita menambahkan `normalized_name`.
- Backfill dilakukan dengan Java karena normalization logic ingin menghindari default locale dan ingin batch controlled.

Migration sebelumnya:

```sql
-- V020__add_customer_normalized_name.sql
alter table customer add normalized_name varchar(255);
```

Java migration:

```java
package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class V021__BackfillCustomerNormalizedName extends BaseJavaMigration {

    private static final int BATCH_SIZE = 1000;
    private static final String MIGRATION = "V021__BackfillCustomerNormalizedName";

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        boolean oldAutoCommit = connection.getAutoCommit();

        long startedAt = System.currentTimeMillis();
        long totalUpdated = 0;
        long lastId = 0;
        int batchNo = 0;

        System.out.println("migration=" + MIGRATION + " phase=start batchSize=" + BATCH_SIZE);

        try {
            connection.setAutoCommit(false);

            while (true) {
                batchNo++;
                long batchStart = System.currentTimeMillis();

                List<CustomerRow> rows = fetchBatch(connection, lastId, BATCH_SIZE);
                if (rows.isEmpty()) {
                    connection.commit();
                    break;
                }

                int updated = updateBatch(connection, rows);
                connection.commit();

                totalUpdated += updated;
                lastId = rows.get(rows.size() - 1).id;

                long elapsed = System.currentTimeMillis() - batchStart;
                System.out.println(
                        "migration=" + MIGRATION +
                        " batch=" + batchNo +
                        " selected=" + rows.size() +
                        " updated=" + updated +
                        " lastId=" + lastId +
                        " elapsedMs=" + elapsed);

                throttle();
            }

            long elapsed = System.currentTimeMillis() - startedAt;
            System.out.println("migration=" + MIGRATION + " phase=complete totalUpdated=" + totalUpdated + " elapsedMs=" + elapsed);
        } catch (Exception e) {
            try {
                connection.rollback();
            } catch (SQLException rollbackError) {
                e.addSuppressed(rollbackError);
            }
            System.out.println("migration=" + MIGRATION + " phase=failed error=" + e.getClass().getName());
            throw e;
        } finally {
            connection.setAutoCommit(oldAutoCommit);
        }
    }

    private List<CustomerRow> fetchBatch(Connection connection, long lastId, int limit) throws SQLException {
        String sql =
                "select id, name " +
                "from customer " +
                "where id > ? " +
                "and normalized_name is null " +
                "order by id";

        List<CustomerRow> rows = new ArrayList<CustomerRow>();

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setLong(1, lastId);
            ps.setMaxRows(limit);
            ps.setQueryTimeout(60);

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    rows.add(new CustomerRow(rs.getLong("id"), rs.getString("name")));
                }
            }
        }

        return rows;
    }

    private int updateBatch(Connection connection, List<CustomerRow> rows) throws SQLException {
        String sql =
                "update customer " +
                "set normalized_name = ? " +
                "where id = ? " +
                "and normalized_name is null";

        int total = 0;

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setQueryTimeout(60);

            for (CustomerRow row : rows) {
                ps.setString(1, normalize(row.name));
                ps.setLong(2, row.id);
                ps.addBatch();
            }

            int[] results = ps.executeBatch();
            for (int result : results) {
                if (result >= 0) {
                    total += result;
                }
            }
        }

        return total;
    }

    private static String normalize(String input) {
        if (input == null) {
            return null;
        }
        String trimmed = input.trim().replaceAll("\\s+", " ");
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.toLowerCase(Locale.ROOT);
    }

    private static void throttle() throws InterruptedException {
        Thread.sleep(50L);
    }

    private static final class CustomerRow {
        private final long id;
        private final String name;

        private CustomerRow(long id, String name) {
            this.id = id;
            this.name = name;
        }
    }
}
```

### 24.1 Apa yang Baik dari Contoh Ini?

- Tidak memakai ORM.
- Tidak memakai Spring service.
- Tidak memakai default locale.
- Batch size eksplisit.
- Commit per batch.
- Predicate `normalized_name is null` membuat update lebih aman.
- Query timeout diset.
- Progress dilog tanpa PII.
- Logic normalization lokal dan stabil.

### 24.2 Apa yang Masih Perlu Diperhatikan?

- `setMaxRows` behavior bisa berbeda per driver.
- Tidak ada checkpoint table eksplisit.
- Jika ada row baru masuk dengan ID kecil atau ID tidak monotonic, strategi perlu disesuaikan.
- Jika table sangat besar, `where id > ? and normalized_name is null order by id` butuh index yang cocok.
- Jika production traffic tinggi, perlu lock/impact analysis.
- Jika migration gagal setelah beberapa commit, Flyway akan melihat migration gagal; recovery perlu prosedur jelas.

---

## 25. Handling Partial Commit with Flyway

Ini bagian yang sering tidak dipahami.

Jika Java migration mengontrol commit per batch, lalu gagal di tengah:

```text
batch 1 committed
batch 2 committed
batch 3 failed and rolled back
Flyway marks migration as failed
```

Database sekarang sudah berubah sebagian, tetapi migration belum sukses menurut Flyway.

Apa pilihan recovery?

### 25.1 Fix and Retry Same Migration?

Biasanya jangan mengedit migration yang sudah pernah jalan di shared/prod environment kecuali sedang dalam controlled failed deployment window dan belum ada environment lain yang menganggapnya final.

Namun jika migration gagal di production sebelum tercatat sukses, operator kadang perlu:

1. analisis penyebab,
2. fix data atau migration,
3. repair Flyway history jika perlu,
4. retry.

Ini harus runbook-driven.

### 25.2 Make Migration Resume-Safe

Lebih baik migration dari awal didesain resume-safe:

```sql
where normalized_name is null
```

Jadi jika dijalankan ulang, batch yang sudah berhasil tidak diproses ulang.

### 25.3 Manual Repair

Flyway `repair` dapat memperbaiki metadata schema history tertentu, tetapi tidak memperbaiki data bisnis. Jangan menganggap repair sebagai undo.

Operational rule:

> Repair fixes migration metadata. It does not make a bad data migration correct.

---

## 26. Java Migration vs External Batch Job

Tidak semua data migration harus menjadi Flyway Java migration.

Kadang lebih baik membuat external batch job.

### 26.1 Java Migration Cocok Jika

- bagian dari schema version transition,
- harus selesai sebelum app version baru jalan,
- volume kecil/sedang,
- logic deterministic,
- tidak butuh monitoring panjang,
- failure bisa ditangani dalam deployment window.

### 26.2 External Batch Job Lebih Cocok Jika

- data sangat besar,
- migration bisa berjalan berjam-jam/hari,
- perlu pause/resume,
- perlu dashboard progress,
- perlu dynamic throttling,
- tidak harus selesai sebelum deploy,
- bagian dari expand/contract multi-release,
- perlu operator control.

Contoh:

```text
V100__add_new_column.sql
Deploy app dual-write
Run external backfill job over days
Validate
V101__enforce_constraint.sql
V102__drop_old_column.sql
```

Flyway tetap mengelola schema transitions, tetapi backfill besar dilakukan oleh job yang designed untuk batch operation.

---

## 27. Anti-Patterns Java-Based Migration

### 27.1 The “Use Existing Service” Anti-Pattern

```java
customerService.fixAllCustomers();
```

Masalah:

- service berubah,
- side effect tidak jelas,
- dependency besar,
- sulit audit.

### 27.2 The “Load Everything” Anti-Pattern

```java
select * from big_table
```

lalu dimasukkan ke `List` besar.

Masalah:

- OOM,
- GC pressure,
- long transaction,
- unpredictable runtime.

### 27.3 The “One Giant Transaction” Anti-Pattern

```java
update 100 million rows in one transaction
```

Masalah:

- lock lama,
- transaction log besar,
- rollback mahal,
- outage risk.

### 27.4 The “External API During Migration” Anti-Pattern

```java
httpClient.get("https://internal-service/customer/" + id)
```

Masalah:

- network failure,
- rate limit,
- inconsistent response,
- deployment dependency cycle.

### 27.5 The “Mutable Helper” Anti-Pattern

```java
NormalizationUtils.normalize(value)
```

Helper dipakai oleh migration lama, lalu diubah untuk kebutuhan baru.

Masalah:

- fresh environment menghasilkan data berbeda,
- audit history menjadi misleading.

### 27.6 The “Silent Migration” Anti-Pattern

Migration besar tanpa log progress.

Masalah:

- operator tidak tahu stuck atau jalan,
- sulit menentukan kill/retry,
- incident response buruk.

### 27.7 The “Migration as Business Workflow” Anti-Pattern

Migration mengirim email, publish event, call approval engine, generate invoice, dsb.

Masalah:

- bukan deterministic database transition,
- side effect sulit rollback,
- bisa duplicate saat retry.

---

## 28. Production Runbook untuk Java Migration

Sebelum menjalankan Java migration besar, siapkan runbook.

### 28.1 Pre-Flight

Checklist:

- Estimasi row count.
- Estimasi durasi.
- Estimasi batch size.
- Index pendukung tersedia.
- Query plan dicek.
- Lock impact dianalisis.
- Backup/snapshot tersedia jika perlu.
- Migration diuji di data representatif.
- Validation query disiapkan.
- Roll-forward plan disiapkan.
- Rollback decision disepakati.
- Log monitoring disiapkan.
- Owner teknis dan DBA standby jika production critical.

### 28.2 During-Flight

Monitor:

- progress batch,
- rows updated,
- DB CPU,
- lock wait,
- replication lag,
- transaction log growth,
- application error rate,
- slow query,
- disk usage.

Decision point:

- continue,
- throttle more,
- pause if external job,
- abort,
- roll-forward fix.

### 28.3 Post-Flight

Verify:

```sql
select count(*) from customer where normalized_name is null;
```

Check sample:

```sql
select id, name, normalized_name
from customer
where normalized_name is not null
fetch first 20 rows only;
```

Check constraint readiness:

```sql
select count(*)
from customer
where name is not null
and normalized_name is null;
```

Then proceed to next migration/release step.

---

## 29. Decision Framework: SQL Migration, Java Migration, or Batch Job?

Gunakan framework ini:

| Situation | Prefer |
|---|---|
| Simple DDL | SQL migration |
| Simple seed/reference data | SQL migration or repeatable carefully |
| View/function/procedure definition | Repeatable SQL migration |
| Small deterministic data correction | SQL migration |
| Complex transformation but bounded | Java migration |
| Requires parsing JSON/XML/legacy format | Java migration |
| Requires crypto/hash library | Java migration with strict controls |
| Millions/billions rows, long-running | External batch job + Flyway schema migrations |
| Requires external service | Reconsider design; avoid migration-time service calls |
| Requires human remediation | Migration + quarantine/report workflow |
| Needs multi-release zero downtime | Expand/contract with possible external backfill |

Simplified decision tree:

```text
Can SQL express it clearly and safely?
  yes → SQL migration
  no  → Does it need deterministic local procedural logic?
          yes → Java migration
          no  → Is it long-running operational data movement?
                  yes → external batch job + migration orchestration
                  no  → redesign
```

---

## 30. How Top Engineers Think About Java Migration

Engineer biasa bertanya:

> Bisa tidak migration ini ditulis dengan Java?

Engineer production-grade bertanya:

> Jika migration ini gagal setelah 37% data berubah, apa state database, apa yang dilihat aplikasi, bagaimana kita tahu progress-nya, bagaimana kita resume, dan bagaimana kita membuktikan hasilnya benar?

Pertanyaan top-tier:

1. Apakah migration ini harus blocking deploy?
2. Apakah migration ini harus online atau offline?
3. Apakah app lama kompatibel dengan schema baru?
4. Apakah app baru kompatibel dengan data lama?
5. Apakah migration bounded terhadap data baru yang masuk?
6. Apakah transformation deterministic across JVM versions/locales/timezones?
7. Apakah logic migration immutable historically?
8. Apakah batch size aman untuk DB log/lock/replication?
9. Apakah failure bisa dilanjutkan tanpa duplikasi?
10. Apakah operator punya signal cukup untuk keputusan?
11. Apakah audit/compliance bisa menjelaskan perubahan ini?
12. Apakah migration ini sebaiknya bukan Flyway migration melainkan external job?

---

## 31. Ringkasan Mental Model

Java-based migration adalah alat yang kuat, tetapi harus dipakai dengan disiplin.

Ingat prinsip berikut:

1. **Prefer SQL for simple schema/data changes.**
2. **Use Java only when procedural deterministic logic is genuinely needed.**
3. **Do not use ORM entities or application services.**
4. **Keep migration logic historically stable.**
5. **Design for partial failure if committing per batch.**
6. **Use batch processing for large data.**
7. **Avoid external services.**
8. **Avoid default locale/timezone/randomness.**
9. **Log progress without leaking sensitive data.**
10. **Test against real database engine and realistic data.**
11. **For very large data movement, consider external batch job.**
12. **Treat Java migration as production data engineering, not convenience scripting.**

---

## 32. Practical Checklist

Sebelum menulis Java migration:

```text
[ ] SQL migration tidak cukup atau tidak readable.
[ ] Logic procedural memang diperlukan.
[ ] Tidak memakai ORM/entity/repository/service aplikasi.
[ ] Tidak memanggil external API/service.
[ ] Transformation deterministic.
[ ] Locale/timezone eksplisit.
[ ] Tidak memakai random/current time untuk business data tanpa alasan.
[ ] Batch size ditentukan jika data besar.
[ ] Commit boundary dipahami.
[ ] Retry/resume behavior dipahami.
[ ] Query timeout/lock timeout dipertimbangkan.
[ ] Progress logging tersedia.
[ ] Tidak log PII/secret.
[ ] Validation query tersedia.
[ ] Unit test transformation tersedia.
[ ] Integration test migration tersedia.
[ ] Runbook production tersedia untuk migration besar.
```

---

## 33. Penutup

Java-based migration memberi kita kemampuan melakukan perubahan data yang tidak nyaman atau tidak aman ditulis dengan SQL murni. Tetapi kemampuan ini harus digunakan secara selektif. Semakin banyak logic Java yang kita masukkan ke migration, semakin besar kebutuhan untuk menjaga determinisme, observability, testing, dependency stability, dan recovery model.

Pada level top 1%, fokusnya bukan sekadar tahu bahwa Flyway bisa menjalankan Java class. Fokusnya adalah memahami kapan Java migration menjadi solusi yang tepat, kapan ia menjadi jebakan, dan bagaimana mendesainnya agar tetap aman dalam realitas production: data besar, lock, rollback sulit, traffic aktif, audit requirement, dan deployment pipeline yang harus reliable.

Part berikutnya akan membahas:

```text
09-flyway-callbacks-lifecycle-hooks.md
```

Di sana kita akan membahas lifecycle hooks Flyway: before/after migrate, before/after each migration, error callback, session settings, audit logging, dan bagaimana callback membantu mengelola behavior migration tanpa mencampur semua logic ke dalam migration utama.
