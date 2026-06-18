# 23 — Migration Testing Strategy

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Bagian: 23 dari 34  
> Topik: strategi testing database migration, seed, backfill, rollback, dan compatibility  
> Target: Java 8 sampai Java 25, Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, CI/CD, production-grade systems

---

## 1. Mengapa migration testing berbeda dari application testing

Database migration testing bukan sekadar memastikan SQL bisa dieksekusi. Tujuannya adalah memastikan **perubahan database aman ketika bertemu realitas production**: schema lama, data lama, volume besar, constraint historis, index, lock, deployment order, rollback plan, dan aplikasi versi lama/baru.

Unit test aplikasi biasanya menguji behaviour code dalam kondisi yang relatif dikontrol. Migration test harus menguji **transisi state**:

```text
Database state lama + migration baru + data nyata/representatif
        ↓
Database state baru yang kompatibel dengan aplikasi baru
        ↓
Tetap aman bila aplikasi lama masih berjalan sementara
        ↓
Tetap bisa dipulihkan bila deployment gagal
```

Dalam sistem production, database jarang berada dalam kondisi “fresh empty database”. Ia membawa sejarah: hotfix manual, data legacy, row invalid, constraint longgar, duplicate lama, enum string tidak konsisten, null tersembunyi, sequence tidak sinkron, index bloat, view dependency, dan object yang hanya ada di environment tertentu.

Karena itu, testing migration harus menjawab lima pertanyaan utama:

1. **Fresh install**: apakah database kosong bisa dibangun dari nol?
2. **Upgrade**: apakah database dari versi release sebelumnya bisa naik ke versi sekarang?
3. **Compatibility**: apakah aplikasi lama dan baru bisa hidup selama window transisi?
4. **Correctness**: apakah data hasil migration benar secara domain?
5. **Operability**: apakah migration cukup cepat, observable, recoverable, dan aman terhadap lock?

Engineer biasa menguji “migration bisa jalan”. Engineer kuat menguji “migration aman sebagai perubahan production”.

---

## 2. Prinsip utama migration testing

### 2.1 Test the transition, not only the destination

Kesalahan umum adalah hanya mengecek schema akhir:

```text
Apakah table baru ada? Ya.
Apakah column baru ada? Ya.
Apakah app start? Ya.
```

Itu belum cukup. Migration adalah proses transisi. Yang harus diuji:

```text
Before state → migration steps → intermediate state → after state
```

Contoh: rename column `customer.full_name` menjadi `customer.display_name`.

Destination-only thinking:

```sql
ALTER TABLE customer RENAME COLUMN full_name TO display_name;
```

Transition-aware thinking:

```text
Release A:
- Add display_name nullable.
- App writes full_name and display_name.
- Backfill display_name from full_name.

Release B:
- App reads display_name.
- Verify no null display_name.

Release C:
- Drop full_name.
```

Testing harus mencakup semua fase, bukan hanya schema akhir.

---

### 2.2 Test against the real database engine

H2/HSQLDB/Derby berguna untuk test cepat, tetapi sering menipu migration test. Mereka tidak selalu merepresentasikan:

- transactional DDL;
- metadata lock;
- index creation behaviour;
- constraint validation;
- collation;
- timestamp/timezone;
- JSON type;
- CLOB/BLOB;
- sequence/identity;
- generated column;
- function/procedure syntax;
- online DDL;
- lock timeout;
- optimizer behaviour.

Untuk migration test serius, gunakan database engine yang sama dengan production: PostgreSQL dengan PostgreSQL, Oracle dengan Oracle, MySQL dengan MySQL, SQL Server dengan SQL Server.

Tool seperti Testcontainers untuk Java membantu menjalankan database nyata sebagai container ephemeral untuk integration test. Dokumentasi Testcontainers menjelaskan bahwa library ini menyediakan instance ringan dan throwaway untuk database dan dependency lain yang berjalan di Docker. Ini cocok untuk migration test karena setiap test bisa memiliki database bersih dan reproducible.

---

### 2.3 Test from known historical versions

Migration harus diuji bukan hanya dari kosong, tetapi dari snapshot versi lama.

Minimal matrix:

```text
empty database        → latest migration
previous release DB   → latest migration
current prod-like DB   → latest migration
failed partial state   → recovery path
```

Untuk sistem besar, jangan hanya test dari satu versi. Pilih beberapa baseline:

| Baseline | Tujuan |
|---|---|
| Empty DB | Memastikan install baru tetap valid |
| Last release | Jalur upgrade paling umum |
| Last LTS/stable release | Jalur upgrade untuk client lama |
| Production sanitized snapshot | Menangkap data historis yang tidak ada di fixture |
| Drifted environment sample | Menguji ketahanan terhadap perbedaan non-ideal |

---

### 2.4 Test schema and data contract together

Migration tidak berdiri sendiri. Ia mengubah kontrak antara database dan aplikasi.

Contoh kontrak:

```java
record UserView(
    long id,
    String username,
    AccountStatus status,
    Instant createdAt
) {}
```

Kontrak database yang tersirat:

```text
users.id exists and maps to long
users.username non-null
users.status contains values known by AccountStatus
users.created_at is timestamp with usable timezone semantics
```

Jika migration mengubah `status` dari `VARCHAR` ke FK table `account_status`, test harus membuktikan bahwa:

- semua value lama berhasil dipetakan;
- tidak ada unknown status;
- query aplikasi masih benar;
- index baru cukup untuk query path;
- rollback/roll-forward behaviour jelas.

---

### 2.5 Test what production will actually execute

Jangan test SQL yang berbeda dari yang akan dijalankan di production.

Anti-pattern:

```text
CI test: pakai Hibernate ddl-auto=create-drop
Production: pakai Flyway SQL migration
```

Atau:

```text
CI test: pakai H2 schema auto-generation
Production: pakai Liquibase changelog Oracle
```

Ini menguji dunia paralel, bukan deployment nyata.

Prinsipnya:

```text
The tested migration artifact must be the deployed migration artifact.
```

Artinya:

- file migration/changelog sama;
- tool version sama atau dikunci;
- config penting sama;
- driver database compatible;
- placeholder/context/label diuji;
- database vendor sama untuk test serius.

---

## 3. Lapisan migration test

Migration testing sebaiknya dibuat berlapis. Tidak semua test harus mahal. Ada test cepat untuk feedback developer, dan test berat untuk pipeline release.

```text
Layer 1: Static checks / linting
Layer 2: Fresh database migration test
Layer 3: Upgrade migration test
Layer 4: Application compatibility test
Layer 5: Data correctness test
Layer 6: Rollback / roll-forward test
Layer 7: Performance / lock / volume test
Layer 8: Operational rehearsal
```

---

## 4. Layer 1 — Static checks dan migration linting

Static checks menangkap kesalahan sebelum database dijalankan.

### 4.1 Yang bisa dicek secara statis

- Naming convention migration.
- Duplicate version Flyway.
- Duplicate Liquibase changeset identity.
- File ordering.
- Forbidden command.
- Missing rollback block untuk Liquibase changeset tertentu.
- Missing precondition untuk destructive change.
- `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE without WHERE`.
- `ALTER TABLE ... NOT NULL` tanpa backfill.
- `CREATE INDEX` non-concurrent di table besar.
- `UPDATE` tanpa batching di table besar.
- Environment-specific SQL.
- Placeholder yang belum didefinisikan.
- Editing old migration yang sudah applied.

### 4.2 Contoh policy lint sederhana

```text
Reject migration if:
- contains DROP TABLE outside /contract/ folder;
- contains DELETE FROM without WHERE;
- contains UPDATE large_table without WHERE id range or batch marker;
- contains ALTER TABLE ADD COLUMN ... NOT NULL without DEFAULT or separate backfill plan;
- contains CREATE INDEX on PostgreSQL without CONCURRENTLY for known large table;
- contains baselineOnMigrate=true in production config;
- contains Flyway clean enabled in production profile;
- contains hardcoded password, token, or secret.
```

### 4.3 Static check bukan pengganti runtime test

Static check hanya mendeteksi pattern berbahaya. Ia tidak bisa membuktikan:

- data lama valid;
- index build tidak blocking;
- constraint tidak gagal;
- procedure compile sukses;
- query aplikasi tetap benar;
- migration cukup cepat.

Jadi static check adalah pagar pertama, bukan validasi akhir.

---

## 5. Layer 2 — Fresh database migration test

Fresh migration test memastikan semua migration dari awal bisa membangun database kosong.

### 5.1 Tujuan

- Menjamin developer baru bisa bootstrap database.
- Menjamin test environment bisa dibuat dari nol.
- Menangkap migration yang hilang dependency.
- Menangkap repeatable migration rusak.
- Menangkap view/procedure yang tidak compile.
- Menangkap urutan migration salah.

### 5.2 Flyway fresh migration test

Plain Java/JUnit style:

```java
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;

import static org.assertj.core.api.Assertions.assertThat;

class FlywayFreshMigrationTest {

    @Test
    void shouldMigrateFreshDatabaseToLatestVersion() {
        DataSource dataSource = TestDatabase.createDataSource();

        Flyway flyway = Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .cleanDisabled(false) // only test DB
                .load();

        flyway.clean();
        var result = flyway.migrate();

        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).isGreaterThanOrEqualTo(0);
    }
}
```

Catatan:

- `clean()` hanya aman di test database throwaway.
- Di production, `clean` harus disabled.
- Test ini tidak membuktikan upgrade dari production lama. Ia hanya membuktikan install baru.

### 5.3 Liquibase fresh migration test

Plain Java/JUnit style:

```java
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.Test;

import java.sql.Connection;

class LiquibaseFreshMigrationTest {

    @Test
    void shouldUpdateFreshDatabaseToLatestChangelog() throws Exception {
        try (Connection connection = TestDatabase.openConnection()) {
            Database database = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));

            Liquibase liquibase = new Liquibase(
                    "db/changelog/db.changelog-master.yaml",
                    new ClassLoaderResourceAccessor(),
                    database
            );

            liquibase.update();
        }
    }
}
```

### 5.4 Validasi setelah fresh migration

Jangan hanya assert “migrate sukses”. Tambahkan smoke checks:

```sql
SELECT COUNT(*) FROM flyway_schema_history;
SELECT COUNT(*) FROM databasechangelog;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM role_permission;
```

Dan object existence:

```text
- expected tables exist;
- expected constraints exist;
- expected indexes exist;
- expected views compile;
- expected seed rows exist;
- expected privileges/roles exist if managed by migration.
```

---

## 6. Layer 3 — Upgrade migration test

Upgrade test adalah test paling penting untuk production. Ia menguji database dari versi lama ke versi baru.

### 6.1 Mengapa fresh test tidak cukup

Fresh database sering ideal:

- tidak ada data kotor;
- tidak ada duplicate;
- tidak ada null legacy;
- tidak ada old enum;
- sequence sinkron;
- no manual drift;
- no volume.

Production database sebaliknya membawa sejarah.

Contoh migration yang lolos fresh test tapi gagal upgrade:

```sql
ALTER TABLE user_account
ADD CONSTRAINT uk_user_email UNIQUE (email);
```

Fresh DB kosong: sukses.  
Production: gagal karena ada duplicate email lama.

Contoh lain:

```sql
ALTER TABLE case_record
ALTER COLUMN status SET NOT NULL;
```

Fresh DB: sukses.  
Production: gagal karena ada row lama dengan `status IS NULL`.

### 6.2 Cara membuat upgrade baseline

Ada beberapa strategi.

#### Strategi A — migrate sampai versi lama, lalu migrate ke latest

```text
1. Start empty DB.
2. Run migrations until version N.
3. Insert representative old data.
4. Run latest migrations.
5. Validate schema and data.
```

Flyway pseudo-flow:

```java
Flyway oldFlyway = Flyway.configure()
        .dataSource(dataSource)
        .target("2026.03.0")
        .locations("classpath:db/migration")
        .load();
oldFlyway.migrate();

insertOldReleaseData(dataSource);

Flyway latestFlyway = Flyway.configure()
        .dataSource(dataSource)
        .locations("classpath:db/migration")
        .load();
latestFlyway.migrate();

assertLatestContract(dataSource);
```

#### Strategi B — restore sanitized snapshot

```text
1. Restore dump from previous release / production-like data.
2. Run latest migrations.
3. Validate.
```

Ini lebih realistis, tetapi lebih mahal dan butuh sanitization.

#### Strategi C — use golden dataset

Golden dataset adalah dataset kecil tetapi kaya kasus:

```text
- normal rows;
- null legacy rows;
- duplicate candidates;
- old enum values;
- boundary dates;
- unicode text;
- large CLOB/BLOB rows;
- missing optional FK;
- soft-deleted rows;
- records across tenant/module/state.
```

Golden dataset sebaiknya versioned bersama test.

### 6.3 Upgrade test matrix

Contoh matrix sederhana:

| Test | Baseline | Data | Expected |
|---|---|---|---|
| fresh-latest | empty | seed only | DB install succeeds |
| upgrade-last-release | v1.8.0 | golden dataset | migration succeeds |
| upgrade-lts | v1.5.0 | golden dataset | migration succeeds |
| upgrade-prod-sample | prod sanitized | sampled real data | migration succeeds |
| upgrade-drifted | v1.8.0 + manual drift | controlled drift | fail fast or recover clearly |

---

## 7. Layer 4 — Application compatibility test

Migration harus diuji terhadap aplikasi, bukan hanya database.

### 7.1 Compatibility matrix

Dalam zero-downtime deployment, sering ada waktu singkat ketika beberapa instance aplikasi lama dan baru berjalan bersamaan.

Matrix penting:

| App version | DB version | Harus jalan? | Catatan |
|---|---:|---|---|
| old app | old DB | Ya | Before deployment |
| new app | old DB | Kadang | Bergantung deployment order |
| old app | expanded DB | Ya | Wajib untuk expand phase |
| new app | expanded DB | Ya | Wajib |
| old app | contracted DB | Tidak selalu | Setelah old app sudah tidak ada |
| new app | contracted DB | Ya | Final state |

Untuk zero downtime, rule aman:

```text
Expand must be backward compatible.
Contract may be breaking only after old code is gone.
```

### 7.2 Test old app against expanded schema

Contoh:

```text
Migration V20 adds new nullable column `display_name`.
Old app still reads/writes `full_name`.
```

Test:

1. Run DB to old version.
2. Start old app integration test.
3. Apply expand migration.
4. Run old app flows again.
5. Assert no failure.

Tujuannya memastikan migration tidak merusak old app.

### 7.3 Test new app against migrated schema

Test standar:

1. Migrate DB to latest.
2. Start new app.
3. Run repository/service/API integration tests.
4. Validate queries, inserts, updates, deletes.

### 7.4 Test mixed writes

Untuk dual-write migration:

```text
Old column: full_name
New column: display_name
```

Test harus memastikan:

- old flow writes old column;
- new flow writes both columns atau new column;
- backfill fills old rows;
- read-switch works;
- no divergence after write.

Example assertion:

```sql
SELECT COUNT(*)
FROM customer
WHERE display_name IS NULL
  AND deleted = false;
```

Expected after backfill:

```text
0
```

---

## 8. Layer 5 — Data correctness test

Migration yang sukses secara teknis bisa salah secara domain.

### 8.1 Schema success is not business success

Contoh migration:

```sql
UPDATE application_case
SET risk_level = 'LOW'
WHERE risk_level IS NULL;
```

SQL berhasil. Tetapi apakah domain benar? Mungkin null lama harus dipetakan berdasarkan `score`, `case_type`, atau `submitted_date`.

Data correctness test harus menguji aturan mapping.

### 8.2 Backfill correctness test

Misal migrasi dari `status VARCHAR` ke `status_id`:

Before:

```text
case.status = 'NEW', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'
```

After:

```text
case.status_id -> case_status.id
```

Test cases:

| Old status | Expected status code |
|---|---|
| NEW | NEW |
| Pending Review | PENDING_REVIEW |
| pending_review | PENDING_REVIEW |
| APPROVED | APPROVED |
| null | UNKNOWN or fail, tergantung policy |

Test query:

```sql
SELECT c.id, c.old_status, s.code
FROM case_record c
LEFT JOIN case_status s ON s.id = c.status_id
WHERE c.status_id IS NULL;
```

Jika status wajib:

```text
Expected: 0 rows
```

### 8.3 Conservation checks

Untuk migration data, gunakan conservation rule.

Contoh split table:

```text
order(id, customer_id, address_text)
        ↓
order(id, customer_id, shipping_address_id)
shipping_address(id, order_id, address_text)
```

Conservation checks:

```sql
-- jumlah order tidak berubah
SELECT COUNT(*) FROM orders;

-- semua order lama dengan address menghasilkan shipping_address
SELECT COUNT(*)
FROM orders o
LEFT JOIN shipping_address a ON a.order_id = o.id
WHERE o.address_text IS NOT NULL
  AND a.id IS NULL;

-- text address tidak berubah
SELECT COUNT(*)
FROM orders o
JOIN shipping_address a ON a.order_id = o.id
WHERE o.address_text <> a.address_text;
```

### 8.4 Aggregate checks

Untuk financial/regulatory data, gunakan aggregate invariant:

```sql
SELECT SUM(amount) FROM payment_before;
SELECT SUM(amount) FROM payment_after;
```

Atau:

```sql
SELECT case_status, COUNT(*)
FROM case_record
GROUP BY case_status;
```

Bandingkan sebelum dan sesudah.

### 8.5 Sampling checks

Untuk data besar, full comparison bisa mahal. Gunakan sampling deterministik:

```sql
SELECT *
FROM case_record
WHERE MOD(id, 1000) = 17;
```

Atau range representative:

```text
- oldest records;
- newest records;
- high-value records;
- edge-case records;
- records per tenant/module/status.
```

---

## 9. Layer 6 — Rollback dan roll-forward test

### 9.1 Jangan menguji rollback secara naif

Rollback database sering tidak simetris.

Contoh irreversible:

```sql
ALTER TABLE customer DROP COLUMN legacy_identifier;
```

Setelah drop, data hilang. Rollback hanya bisa mengembalikan column kosong, bukan data.

Karena itu test harus membedakan:

| Tipe perubahan | Rollback realistis? | Strategi |
|---|---|---|
| Add nullable column | Ya | Drop column atau ignore |
| Add table kosong | Ya | Drop table |
| Add index | Ya | Drop index |
| Rename column | Risky | Prefer expand/contract |
| Drop column | Tidak tanpa backup | Roll-forward/restore |
| Destructive data update | Tidak tanpa snapshot | Roll-forward/correction |
| Backfill derived data | Bisa jika source masih ada | Recompute/revert marker |

### 9.2 Flyway rollback strategy

Flyway Community umumnya dipakai dengan pola forward-only. Undo migrations ada pada edisi tertentu dan tidak selalu direkomendasikan untuk production karena rollback database sering bukan reverse mekanis.

Test yang lebih realistis:

```text
1. Apply migration.
2. Simulate app deployment failure.
3. Verify old app can still run if migration is expand-compatible.
4. Or apply forward fix migration.
5. Or restore DB snapshot in rehearsal environment.
```

### 9.3 Liquibase rollback test

Liquibase punya konsep rollback lebih eksplisit. Test rollback bisa dilakukan dengan:

```text
update → rollback to tag → validate old contract
```

Pseudo-flow:

```java
liquibase.tag("before_release_2026_06");
liquibase.update();

// validate latest

liquibase.rollback("before_release_2026_06");

// validate previous schema contract
```

Tetapi rollback block harus diuji, bukan hanya ditulis.

### 9.4 Roll-forward test

Untuk banyak production system, roll-forward lebih aman daripada rollback.

Test:

```text
1. Apply broken-but-successful migration in test environment.
2. Apply corrective migration.
3. Validate final state.
4. Ensure no editing old migration.
```

Contoh:

```text
V120__add_wrong_index.sql
V121__drop_wrong_index_add_correct_index.sql
```

Bukan:

```text
Edit V120 after it has reached shared environment.
```

---

## 10. Layer 7 — Performance, lock, dan volume testing

Migration yang benar secara fungsi bisa gagal secara operasional.

### 10.1 Yang harus diuji

- Durasi migration.
- Lock duration.
- Rows affected.
- Transaction size.
- WAL/redo generation.
- Temp space usage.
- Undo usage.
- CPU/IO impact.
- Blocking sessions.
- Deadlock possibility.
- Replication lag.
- Index build time.
- Backfill throughput.

### 10.2 Kapan performance test wajib

Performance/volume test wajib untuk:

- table besar;
- `UPDATE` massal;
- `DELETE` massal;
- adding non-null constraint;
- adding unique constraint;
- creating index on hot table;
- changing column type;
- moving LOB/CLOB/BLOB;
- table rewrite operation;
- multi-tenant batch migration;
- backfill dengan business rule kompleks.

### 10.3 Test data volume

Fixture kecil tidak cukup. Gunakan volume representative.

```text
Small: 1k rows untuk functional correctness
Medium: 100k–1M rows untuk query plan/backfill behaviour
Large: production-like sample untuk release rehearsal
```

### 10.4 Example backfill performance test

Misal Java-based migration backfill:

```java
final int batchSize = 1_000;
long lastId = 0;

while (true) {
    List<Record> batch = loadBatchAfterId(connection, lastId, batchSize);
    if (batch.isEmpty()) {
        break;
    }

    updateBatch(connection, batch);
    connection.commit();

    lastId = batch.get(batch.size() - 1).id();
}
```

Test harus mengukur:

```text
- rata-rata batch duration;
- max batch duration;
- total duration;
- rows per second;
- failed batch recovery;
- ability to resume from last checkpoint.
```

### 10.5 Lock timeout rehearsal

Untuk migration yang berpotensi lock, set timeout eksplisit.

PostgreSQL example:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '10min';
```

Oracle conceptually:

```sql
ALTER SESSION SET ddl_lock_timeout = 5;
```

Test behaviour:

```text
Given another transaction holds a conflicting lock
When migration runs
Then migration fails fast or waits within allowed timeout
And application is not blocked indefinitely
```

---

## 11. Testcontainers strategy untuk Java migration testing

### 11.1 Kenapa Testcontainers cocok

Testcontainers memberi database nyata, isolated, disposable. Ini cocok untuk:

- fresh migration test;
- upgrade migration test;
- Spring Boot integration test;
- Flyway/Liquibase verification;
- repository test terhadap schema asli;
- vendor-specific behaviour.

### 11.2 PostgreSQL example dengan Flyway

```java
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class FlywayPostgresMigrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("app")
            .withUsername("app")
            .withPassword("app");

    @Test
    void shouldApplyAllMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(
                        postgres.getJdbcUrl(),
                        postgres.getUsername(),
                        postgres.getPassword()
                )
                .locations("classpath:db/migration/postgresql")
                .load();

        var result = flyway.migrate();

        assertThat(result.success).isTrue();
    }
}
```

### 11.3 PostgreSQL example dengan Liquibase

```java
@Testcontainers
class LiquibasePostgresMigrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("app")
            .withUsername("app")
            .withPassword("app");

    @Test
    void shouldApplyChangelog() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                postgres.getJdbcUrl(),
                postgres.getUsername(),
                postgres.getPassword())) {

            Database database = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));

            Liquibase liquibase = new Liquibase(
                    "db/changelog/db.changelog-master.yaml",
                    new ClassLoaderResourceAccessor(),
                    database
            );

            liquibase.update();
        }
    }
}
```

### 11.4 Reuse vs isolation

Testcontainers bisa dibuat per class atau per suite. Trade-off:

| Mode | Pro | Con |
|---|---|---|
| New container per test | Isolasi kuat | Lambat |
| Container per class | Lebih cepat | Harus clean/reset DB |
| Reusable container | Cepat lokal | Risky untuk CI reproducibility |

Untuk migration test, lebih baik reproducibility daripada kecepatan ekstrem. CI release gate harus isolated.

---

## 12. Spring Boot migration test strategy

### 12.1 Jangan biarkan Hibernate membuat schema saat migration test

Untuk migration test, disable auto DDL:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Atau untuk test migration only:

```properties
spring.jpa.hibernate.ddl-auto=none
```

Spring Boot documentation juga menekankan bahwa penggunaan basic SQL initialization (`schema.sql`, `data.sql`) sebaiknya tidak dicampur dengan tool level tinggi seperti Flyway/Liquibase untuk schema management utama.

### 12.2 Flyway + Spring Boot integration test

```java
@SpringBootTest
@Testcontainers
class ApplicationMigrationCompatibilityTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
    }

    @Test
    void applicationShouldStartAgainstMigratedSchema() {
        // If context starts and repositories work, basic compatibility passed.
    }
}
```

### 12.3 Add repository/API smoke tests

```java
@Test
void shouldCreateAndReadUser() {
    User user = userRepository.save(new User("fajar@example.com"));

    Optional<User> found = userRepository.findById(user.getId());

    assertThat(found).isPresent();
}
```

Tujuannya bukan mengulang semua service test, tetapi memastikan schema hasil migration compatible dengan persistence layer.

---

## 13. Testing Flyway-specific behaviours

### 13.1 Validate test

Flyway validate harus dijadikan gate:

```java
flyway.validate();
```

Tujuannya menangkap:

- checksum mismatch;
- missing migration;
- failed migration;
- out-of-order issue;
- resolved migration berbeda dengan applied migration.

### 13.2 Schema history assertion

Flyway menyimpan metadata migration pada schema history table. Gunakan ini untuk test auditability.

Contoh check:

```sql
SELECT version, description, type, script, checksum, success
FROM flyway_schema_history
ORDER BY installed_rank;
```

Assert:

```text
- no failed migration;
- expected latest version exists;
- installed order correct;
- repeatables applied after versioned migrations;
- no unexpected out-of-order migration unless intentionally enabled.
```

### 13.3 Repeatable migration test

Repeatable migration perlu diuji khusus:

1. Migrate fresh DB.
2. Validate view/function exists.
3. Re-run migrate without change.
4. Assert no repeatable re-execution unexpectedly.
5. Modify repeatable in controlled test or rely on checksum pipeline.
6. Assert object definition remains valid.

---

## 14. Testing Liquibase-specific behaviours

### 14.1 updateSQL test

Liquibase bisa menghasilkan SQL tanpa menjalankannya. Ini berguna untuk review.

Pipeline bisa menyimpan artifact:

```text
liquibase updateSQL > build/liquibase/update.sql
```

Review checks:

- SQL sesuai target DBMS;
- destructive operations jelas;
- order benar;
- generated constraint/index names acceptable;
- no unexpected table rewrite.

### 14.2 rollbackSQL test

Untuk changeset yang mengklaim rollback support:

```text
liquibase rollbackSQL <tag>
```

Tujuannya:

- memastikan rollback SQL bisa digenerate;
- reviewer bisa melihat efek rollback;
- destructive rollback terlihat.

### 14.3 DATABASECHANGELOG assertion

Liquibase menyimpan applied changeset di `DATABASECHANGELOG` dan lock di `DATABASECHANGELOGLOCK`.

Check:

```sql
SELECT id, author, filename, dateexecuted, orderexecuted, md5sum
FROM databasechangelog
ORDER BY orderexecuted;
```

Assert:

```text
- expected changeset applied;
- no duplicate identity;
- checksum stable;
- lock released after migration;
- contexts/labels applied as expected.
```

### 14.4 Contexts and labels test

Liquibase contexts/labels sangat powerful tetapi bisa menjadi sumber environment drift.

Test matrix:

| Context/Label | Expected |
|---|---|
| `dev` | dev seed applied |
| `test` | test fixture applied |
| `prod` | no fake data applied |
| `feature-x` | feature-specific object applied |
| no context | only universal changes applied |

---

## 15. Testing seed data

### 15.1 Seed correctness

Untuk seed role/permission:

```sql
SELECT r.code, p.code
FROM role r
JOIN role_permission rp ON rp.role_id = r.id
JOIN permission p ON p.id = rp.permission_id
ORDER BY r.code, p.code;
```

Expected result bisa disimpan sebagai golden assertion.

### 15.2 Idempotency test

Seed harus aman dijalankan ulang jika didesain idempotent.

Test:

```text
1. Apply seed.
2. Count rows.
3. Apply migration/seed again if repeatable/idempotent.
4. Count rows again.
5. Assert no duplicates.
```

Example:

```sql
SELECT code, COUNT(*)
FROM permission
GROUP BY code
HAVING COUNT(*) > 1;
```

Expected:

```text
0 rows
```

### 15.3 Drift detection

Jika production seed boleh diubah oleh admin UI, seed test harus membedakan:

```text
managed seed value      → must match source control
user-managed config     → must not be overwritten blindly
hybrid config           → default only, user override preserved
```

---

## 16. Testing destructive migration

Destructive migration adalah perubahan yang menghapus atau mempersempit kemungkinan data.

Contoh:

- drop table;
- drop column;
- truncate;
- delete old data;
- shrink type length;
- set not null;
- add unique constraint;
- add restrictive FK;
- change enum domain.

### 16.1 Required tests before destructive change

Sebelum destructive change:

```text
- prove no active code reads/writes old object;
- prove data has been copied/backfilled;
- prove monitoring shows no usage;
- prove backup/snapshot exists;
- prove rollback/roll-forward decision is documented;
- prove old app version will not run after contract phase.
```

### 16.2 Contract phase test

Jika drop column dilakukan di contract phase:

1. Run latest app without old column dependency.
2. Drop old column.
3. Run full persistence smoke test.
4. Assert old app fails in controlled compatibility test if expected.
5. Ensure deployment procedure prevents old app rollback.

---

## 17. Testing environment drift

### 17.1 Drift types

Environment drift bisa berupa:

- object missing;
- object extra;
- column type berbeda;
- index berbeda;
- constraint disabled;
- manual hotfix applied;
- seed changed;
- Flyway checksum mismatch;
- Liquibase checksum mismatch;
- migration history table edited;
- privileges berbeda.

### 17.2 Drift detection test

Untuk release gate:

```text
1. Compare expected migration history with target environment.
2. Run Flyway validate or Liquibase status.
3. Generate schema diff if available.
4. Block deployment on unexpected drift.
```

### 17.3 Controlled drift test

Buat test khusus yang menyimulasikan drift:

```sql
ALTER TABLE customer DROP COLUMN display_name;
```

Kemudian jalankan migration/validate.

Expected:

```text
Deployment fails fast with clear error, not silently corrupting schema.
```

---

## 18. CI/CD pipeline design untuk migration testing

### 18.1 Developer PR pipeline

Fast feedback:

```text
1. Static migration lint.
2. Flyway validate / Liquibase validate.
3. Fresh DB migration test with Testcontainers.
4. App starts against migrated DB.
5. Repository smoke tests.
```

### 18.2 Merge pipeline

Lebih lengkap:

```text
1. All PR checks.
2. Upgrade from previous release.
3. Seed idempotency test.
4. RollbackSQL/updateSQL artifact generation.
5. Schema diff artifact.
6. Contract compatibility tests.
```

### 18.3 Release pipeline

Production-grade:

```text
1. Restore sanitized prod snapshot.
2. Run migration.
3. Run data correctness validation.
4. Run performance/lock rehearsal.
5. Generate pre/post validation report.
6. Require approval for destructive operations.
7. Publish migration artifact immutable.
```

### 18.4 Production preflight

Before migration:

```text
- check DB connectivity;
- check migration history;
- check no failed migration;
- check lock table not stuck;
- check active long-running transactions;
- check disk space/temp/undo/WAL capacity;
- check replication health;
- check backup/snapshot status;
- check app compatibility window;
- check kill-switch/rollback plan.
```

---

## 19. Migration test data strategy

### 19.1 Fixture levels

| Fixture | Purpose |
|---|---|
| Minimal fixture | Smoke test |
| Golden fixture | Domain correctness |
| Legacy fixture | Upgrade edge cases |
| Volume fixture | Performance |
| Sanitized production sample | Realism |

### 19.2 Golden dataset design

Golden dataset harus kecil tetapi kaya:

```text
- every status/state;
- every role/permission class;
- nullable optional field;
- invalid legacy field;
- old enum spelling;
- unicode;
- max length;
- min/max date;
- cross-tenant data;
- soft-deleted row;
- archived row;
- row with attachments/CLOB/BLOB reference;
- row with missing optional relation;
- row with historical schema assumption.
```

### 19.3 Jangan pakai production data mentah

Production data mengandung risiko:

- PII;
- secrets;
- confidential business records;
- regulatory data;
- audit-sensitive data.

Jika memakai snapshot:

```text
- sanitize PII;
- mask identifiers;
- remove secrets;
- preserve relational integrity;
- preserve statistical distribution where needed;
- restrict access;
- delete snapshot after test window if required.
```

---

## 20. Assertions yang baik untuk migration test

### 20.1 Bad assertions

```text
- migration did not throw exception;
- application context starts;
- row count > 0;
- table exists.
```

Itu berguna, tetapi terlalu lemah.

### 20.2 Better assertions

```text
- all required constraints exist and are validated;
- all old values mapped to expected new values;
- no orphan records after migration;
- row counts conserved where expected;
- aggregate totals conserved where expected;
- unknown values quarantined or rejected;
- old app still works during expand phase;
- new app works after migration;
- migration history has expected latest version;
- lock released;
- no duplicate seed;
- no production-forbidden test seed applied.
```

### 20.3 Example assertion set

For status migration:

```sql
-- no unmapped status
SELECT COUNT(*)
FROM case_record
WHERE status_id IS NULL;

-- no orphan status
SELECT COUNT(*)
FROM case_record c
LEFT JOIN case_status s ON s.id = c.status_id
WHERE s.id IS NULL;

-- expected status distribution
SELECT s.code, COUNT(*)
FROM case_record c
JOIN case_status s ON s.id = c.status_id
GROUP BY s.code
ORDER BY s.code;
```

---

## 21. Handling partial migration failure in tests

### 21.1 Why partial failure matters

Migration can fail after:

- some DDL committed;
- some rows updated;
- index partially created;
- lock acquired then timeout;
- history table updated or not updated depending on tool/DB;
- procedure compiled invalid;
- Java migration committed partial batches.

### 21.2 Partial failure test

Simulate failure:

```text
1. Create test migration that fails halfway.
2. Run migration.
3. Inspect DB state.
4. Run recovery script/procedure.
5. Run validate/repair if appropriate.
6. Re-run migration or roll-forward.
```

For Java backfill, intentionally throw after N batches:

```java
if (processedRows > 10_000 && failForTest) {
    throw new RuntimeException("simulated failure");
}
```

Then verify resume:

```text
- already processed rows not duplicated;
- checkpoint correct;
- remaining rows processed;
- final data consistent.
```

---

## 22. Testing migration observability

Migration should produce enough evidence for operations.

### 22.1 What to log

```text
- migration version/id;
- migration description;
- start/end timestamp;
- duration;
- DB/schema name;
- actor/pipeline run id;
- rows affected;
- batch progress;
- warnings;
- lock wait events if available;
- final status.
```

### 22.2 Test observability hooks

If using Flyway callbacks:

```text
beforeMigrate logs deployment id
beforeEachMigrate logs migration script
afterEachMigrate logs duration
afterMigrate logs summary
afterMigrateError logs failure context
```

If using Liquibase wrapper:

```text
log changelog file
log contexts/labels
log updateSQL artifact path
log applied changesets count
log rollback tag
```

Test should assert logs/metrics exist where critical.

---

## 23. Team review checklist for migration tests

Before approving migration PR, ask:

```text
1. Is this migration schema-only, data-changing, seed, backfill, or destructive?
2. Is there a fresh DB test?
3. Is there an upgrade-from-previous-release test?
4. Is there a data correctness assertion?
5. Is there a compatibility test if zero downtime matters?
6. Is rollback or roll-forward tested/documented?
7. Is the migration tested against the real DB engine?
8. Does it avoid H2-only confidence?
9. Does it have performance/lock test if table is large?
10. Does it use deterministic seed/backfill logic?
11. Does it avoid editing already-applied migrations?
12. Does it produce migration history/audit evidence?
13. Does CI run the same artifact production will run?
14. Are contexts/labels/placeholders tested?
15. Is production preflight defined?
```

---

## 24. Common anti-patterns

### 24.1 “It passed locally on empty DB”

Empty DB success does not imply production upgrade success.

### 24.2 Using H2 as proof for PostgreSQL/Oracle migration

H2 can be useful, but not as final migration proof.

### 24.3 Letting ORM generate schema in tests

If production uses Flyway/Liquibase, tests must use Flyway/Liquibase.

### 24.4 No test for previous release upgrade

Most production deployments are upgrades, not fresh installs.

### 24.5 No test for dirty data

Real data often violates assumptions.

### 24.6 No lock/performance rehearsal

Migration can be logically correct but operationally dangerous.

### 24.7 Rollback script never tested

Untested rollback is documentation fiction.

### 24.8 Editing old migration after merge

Creates checksum mismatch and destroys auditability.

### 24.9 Treating seed as harmless

Bad seed can grant wrong permission, disable feature, or corrupt workflow semantics.

### 24.10 No production preflight

Running migration blindly is not engineering; it is gambling.

---

## 25. A production-grade migration testing blueprint

A strong team can standardize this blueprint.

### 25.1 Pull request stage

```text
- migration file naming check
- destructive SQL lint
- Flyway/Liquibase validate
- fresh DB migration test
- seed uniqueness test
- app startup against migrated DB
```

### 25.2 Integration stage

```text
- upgrade from last release
- golden dataset correctness
- repository/API smoke tests
- updateSQL/rollbackSQL artifact generation for Liquibase
- Flyway info/schema history assertion
```

### 25.3 Release candidate stage

```text
- sanitized production snapshot restore
- full migration rehearsal
- data validation report
- performance and lock measurement
- rollback/roll-forward rehearsal
- approval evidence attached
```

### 25.4 Production stage

```text
- preflight checks
- backup/snapshot verification
- migration execution with logs
- post-migration validation queries
- app deployment compatibility checks
- monitoring during and after release
- incident decision tree if failed
```

---

## 26. Concrete example: adding non-null column safely

Bad migration:

```sql
ALTER TABLE customer ADD COLUMN country_code VARCHAR(2) NOT NULL;
```

Risks:

- fails if table has rows;
- locks table depending DB;
- no backfill logic;
- no compatibility plan.

Better phased plan:

### Phase 1 — expand

```sql
ALTER TABLE customer ADD COLUMN country_code VARCHAR(2);
```

Test:

```text
- old app still works;
- new app can write country_code;
- column exists nullable.
```

### Phase 2 — backfill

```sql
UPDATE customer
SET country_code = 'ID'
WHERE country_code IS NULL
  AND phone_number LIKE '+62%';
```

For large table, use chunked backfill.

Test:

```sql
SELECT COUNT(*)
FROM customer
WHERE country_code IS NULL;
```

Expected depends on rule. If all must be filled, zero.

### Phase 3 — validate readiness

```sql
SELECT country_code, COUNT(*)
FROM customer
GROUP BY country_code;
```

### Phase 4 — enforce constraint

```sql
ALTER TABLE customer
ALTER COLUMN country_code SET NOT NULL;
```

Test:

```text
- insert without country_code fails;
- insert with country_code succeeds;
- app always supplies country_code;
- old app is no longer deployed if it cannot supply country_code.
```

---

## 27. Concrete example: testing role/permission seed

Seed:

```sql
INSERT INTO permission(code, description)
VALUES ('CASE_APPROVE', 'Approve case')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'CASE_MANAGER'
  AND p.code = 'CASE_APPROVE'
ON CONFLICT DO NOTHING;
```

Test assertions:

```sql
-- permission exists exactly once
SELECT COUNT(*)
FROM permission
WHERE code = 'CASE_APPROVE';

-- role mapping exists exactly once
SELECT COUNT(*)
FROM role r
JOIN role_permission rp ON rp.role_id = r.id
JOIN permission p ON p.id = rp.permission_id
WHERE r.code = 'CASE_MANAGER'
  AND p.code = 'CASE_APPROVE';

-- no duplicate permission code
SELECT code, COUNT(*)
FROM permission
GROUP BY code
HAVING COUNT(*) > 1;
```

Expected:

```text
permission count = 1
mapping count = 1
duplicate query returns 0 rows
```

---

## 28. Concrete example: testing status normalization

Before:

```text
case_record.status VARCHAR
```

After:

```text
case_record.status_id FK → case_status.id
```

Migration stages:

```text
1. Create case_status table.
2. Seed statuses.
3. Add nullable status_id.
4. Backfill status_id from old status.
5. Validate no unmapped statuses.
6. Add FK.
7. Later drop old status after contract phase.
```

Test dataset:

| id | status |
|---:|---|
| 1 | NEW |
| 2 | pending_review |
| 3 | APPROVED |
| 4 | Rejected |
| 5 | null |
| 6 | LEGACY_UNKNOWN |

Test policy options:

```text
Option A: unknown/null maps to UNKNOWN.
Option B: unknown/null blocks migration.
Option C: unknown/null is quarantined in migration_error table.
```

Top-tier migration test does not hide this policy. It makes the policy explicit.

---

## 29. Java 8–25 compatibility notes

Migration testing concepts are stable across Java versions, but tooling setup differs.

### 29.1 Java 8/11 legacy projects

Common constraints:

- older Flyway/Liquibase versions may be required;
- older JUnit version may be used;
- Testcontainers version must match Java baseline;
- Spring Boot version may limit Flyway/Liquibase version;
- old JDBC drivers may not support latest DB features.

Recommended approach:

```text
- pin tool versions explicitly;
- use CI matrix if upgrading Java/tooling;
- avoid relying on latest plugin defaults;
- keep migration artifact independent from app runtime if needed.
```

### 29.2 Java 17/21/25 modern projects

Advantages:

- modern Testcontainers support;
- modern Spring Boot support;
- better Docker-based CI maturity;
- records/sealed types can improve test model clarity;
- virtual threads may help migration tooling wrappers, but do not fix database lock issues.

Caution:

```text
Java runtime upgrade and migration tool upgrade should be tested separately when possible.
```

If a deployment changes Java runtime, Spring Boot version, Flyway/Liquibase version, JDBC driver, and migration scripts all at once, debugging failure becomes much harder.

---

## 30. Final mental model

Migration testing is not only about “does SQL run”. It is about proving a controlled state transition:

```text
known old database state
+ versioned migration artifact
+ representative data
+ real database engine
+ application compatibility checks
+ operational constraints
= safe deployable database change
```

The strongest migration test strategy has these properties:

- tests fresh install;
- tests upgrade path;
- tests real DB engine;
- tests data correctness;
- tests seed determinism;
- tests app compatibility;
- tests rollback or roll-forward;
- tests performance and lock risk for large changes;
- produces audit evidence;
- runs in CI/CD using the same artifact production will run.

A migration is not ready when it works once locally. It is ready when the team can explain:

```text
What state are we starting from?
What state are we moving to?
What can fail?
How do we detect failure?
How do we recover?
How do we prove data correctness?
How do we know old and new app versions are safe?
How do we know production will execute the same thing we tested?
```

That is the difference between database migration as a script and database migration as engineering.

---

## 31. Ringkasan

Di Part 23 ini kita membangun strategi testing migration yang production-grade:

- Migration test harus menguji transisi, bukan hanya schema akhir.
- Fresh DB test penting, tetapi upgrade test jauh lebih penting untuk production.
- Test harus memakai database engine nyata, bukan hanya H2/HSQLDB.
- Application compatibility matrix wajib untuk zero-downtime deployment.
- Data correctness harus diuji dengan invariant, conservation checks, aggregate checks, dan golden dataset.
- Rollback harus diuji jika diklaim tersedia; jika tidak realistis, gunakan roll-forward/recovery plan.
- Performance, lock, dan volume test wajib untuk perubahan besar.
- Seed harus diuji deterministik dan idempotent.
- CI/CD harus menjalankan migration artifact yang sama dengan production.
- Production preflight dan post-migration validation adalah bagian dari testing strategy, bukan aktivitas ops tambahan.

Part berikutnya akan masuk ke integrasi spesifik Spring Boot: bagaimana Flyway/Liquibase berinteraksi dengan auto-configuration, JPA initialization, `ddl-auto`, `schema.sql`/`data.sql`, actuator, multiple datasource, profile, dan Kubernetes deployment concern.

---

## 32. Checklist praktis

Sebelum merge migration:

```text
[ ] Migration type jelas: schema/data/seed/backfill/destructive.
[ ] Static lint lolos.
[ ] Flyway/Liquibase validate lolos.
[ ] Fresh database migration test lolos.
[ ] Upgrade from previous release test lolos.
[ ] Test memakai database engine yang sama dengan production, minimal di release pipeline.
[ ] Seed idempotency diuji jika ada seed.
[ ] Data correctness assertions tersedia untuk data migration.
[ ] Compatibility test tersedia untuk expand/contract.
[ ] Rollback atau roll-forward plan diuji/didokumentasikan.
[ ] Performance/lock test tersedia untuk table besar.
[ ] Migration history/audit table dicek.
[ ] Context/label/placeholder diuji jika dipakai.
[ ] Production preflight checklist tersedia.
[ ] Post-migration validation query tersedia.
```

---

## 33. Posisi dalam seri

Kita sudah menyelesaikan:

- Part 0 — Orientation: Database Change as Engineering Discipline
- Part 1 — Taxonomy of Database Changes
- Part 2 — Migration Invariants and Failure Models
- Part 3 — Versioning Models for Database Schema
- Part 4 — Flyway Mental Model
- Part 5 — Flyway Setup in Java 8–25 Projects
- Part 6 — Flyway SQL Migration Design
- Part 7 — Flyway Repeatable Migrations
- Part 8 — Flyway Java-Based Migrations
- Part 9 — Flyway Callbacks and Lifecycle Hooks
- Part 10 — Flyway Baseline, Repair, Validate, Clean
- Part 11 — Liquibase Mental Model
- Part 12 — Liquibase Setup in Java 8–25 Projects
- Part 13 — Liquibase Changelog Design
- Part 14 — Liquibase Preconditions, Contexts, Labels
- Part 15 — Liquibase Rollback Engineering
- Part 16 — Flyway vs Liquibase: Decision Framework
- Part 17 — Seeding Strategy: Reference Data, Master Data, and Bootstrap Data
- Part 18 — Idempotent and Deterministic Seed Design
- Part 19 — Data Migration and Backfill Engineering
- Part 20 — Expand/Contract Pattern for Zero-Downtime Migration
- Part 21 — Database Locking, Transactions, and Online DDL
- Part 22 — Vendor-Specific Migration Engineering
- Part 23 — Migration Testing Strategy

Seri belum selesai. Part berikutnya:

```text
24-migration-in-spring-boot-applications.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 22 — Vendor-Specific Migration Engineering](./22-vendor-specific-migration-engineering.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 24 — Migration in Spring Boot Applications](./24-migration-in-spring-boot-applications.md)

</div>