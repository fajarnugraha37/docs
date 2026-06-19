# learn-postgresql-mastery-for-java-engineers-part-018.md

# Part 018 — Partitioning: Range, List, Hash, Pruning, Maintenance, dan Operational Trade-off

## Status Seri

- Nama seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `018` dari `034`
- Topik: PostgreSQL declarative partitioning
- Fokus: memahami partitioning sebagai desain fisik dan operasional, bukan sekadar trik performa
- Prasyarat utama:
  - memahami SQL dasar
  - memahami indexing PostgreSQL
  - memahami planner statistics
  - memahami EXPLAIN
  - memahami MVCC, vacuum, WAL, dan locking secara konseptual

> Tujuan bagian ini: setelah selesai, kamu tidak hanya tahu cara menulis `PARTITION BY`, tetapi mampu memutuskan kapan partitioning layak dipakai, bagaimana mendesain partition key, bagaimana mengoperasikan partitioned table di production, dan bagaimana menghindari failure mode yang sering muncul pada sistem Java berskala besar.

---

## 1. Inti Mental Model

Partitioning adalah teknik memecah satu tabel logis menjadi beberapa tabel fisik yang lebih kecil, disebut partition.

Dari sisi aplikasi:

```sql
SELECT * FROM enforcement_case WHERE created_at >= now() - interval '7 days';
```

terlihat seperti query ke satu tabel.

Dari sisi PostgreSQL:

```text
logical table: enforcement_case
  ├── physical partition: enforcement_case_2026_01
  ├── physical partition: enforcement_case_2026_02
  ├── physical partition: enforcement_case_2026_03
  └── physical partition: enforcement_case_2026_04
```

PostgreSQL planner dapat memilih partition mana yang relevan dan mengabaikan sisanya. Proses mengabaikan partition yang tidak relevan disebut **partition pruning**.

Partitioning bukan fitur ajaib. Ia tidak otomatis membuat semua query lebih cepat. Ia membantu bila:

1. data sangat besar,
2. query sering menyaring berdasarkan partition key,
3. maintenance perlu dilakukan per bagian data,
4. retention/archival perlu cepat,
5. index pada satu tabel besar mulai mahal,
6. vacuum/analyze pada satu tabel monolitik menjadi berat,
7. data punya natural lifecycle, misalnya per waktu atau tenant.

Partitioning merugikan bila:

1. query tidak memakai partition key,
2. partition terlalu banyak,
3. partition key salah,
4. unique constraint lintas partition dibutuhkan tetapi tidak didesain sejak awal,
5. aplikasi/ORM menghasilkan query yang tidak memungkinkan pruning,
6. operational tooling belum siap,
7. DDL automation buruk,
8. monitoring tidak aware terhadap partition.

---

## 2. Partitioning Bukan Sharding

Ini penting.

Partitioning PostgreSQL biasanya berada dalam satu PostgreSQL cluster dan satu database. Partition tetap dikelola oleh satu PostgreSQL instance atau satu primary dalam satu topology.

Sharding membagi data ke beberapa database/server berbeda.

```text
Partitioning:
  one logical database
  one PostgreSQL primary
  many physical partitions inside same database

Sharding:
  many databases or nodes
  data distributed across independent storage/compute boundaries
```

Partitioning membantu mengelola tabel besar dalam satu database.

Sharding membantu melewati batas satu node.

Jangan memakai partitioning lalu menganggap masalah horizontal scaling otomatis selesai.

---

## 3. PostgreSQL Declarative Partitioning

PostgreSQL modern memakai declarative partitioning:

```sql
CREATE TABLE enforcement_event (
    id bigint generated always as identity,
    case_id bigint not null,
    event_type text not null,
    occurred_at timestamptz not null,
    payload jsonb not null,
    created_at timestamptz not null default now()
) PARTITION BY RANGE (occurred_at);
```

Parent table adalah tabel logis. Ia tidak menyimpan row langsung, kecuali pada desain tertentu dengan default partition. Data masuk ke child partition.

Contoh partition bulanan:

```sql
CREATE TABLE enforcement_event_2026_01
PARTITION OF enforcement_event
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE enforcement_event_2026_02
PARTITION OF enforcement_event
FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

Insert:

```sql
INSERT INTO enforcement_event (
    case_id,
    event_type,
    occurred_at,
    payload
) VALUES (
    101,
    'CASE_ESCALATED',
    '2026-01-15 10:00:00+00',
    '{"from":"review","to":"investigation"}'::jsonb
);
```

PostgreSQL akan route row ke `enforcement_event_2026_01`.

Jika tidak ada matching partition, insert gagal, kecuali ada default partition.

---

## 4. Tiga Jenis Declarative Partitioning

PostgreSQL mendukung tiga strategi utama:

1. range partitioning,
2. list partitioning,
3. hash partitioning.

Masing-masing cocok untuk bentuk data berbeda.

---

## 5. Range Partitioning

Range partitioning membagi data berdasarkan rentang nilai.

Paling umum untuk:

1. waktu,
2. numeric range,
3. sequence range,
4. lifecycle data.

Contoh:

```sql
CREATE TABLE audit_log (
    id bigint generated always as identity,
    actor_id bigint,
    action text not null,
    resource_type text not null,
    resource_id text not null,
    occurred_at timestamptz not null,
    details jsonb not null
) PARTITION BY RANGE (occurred_at);
```

Partition:

```sql
CREATE TABLE audit_log_2026_01
PARTITION OF audit_log
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE audit_log_2026_02
PARTITION OF audit_log
FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

Query yang bagus:

```sql
SELECT *
FROM audit_log
WHERE occurred_at >= '2026-02-01'
  AND occurred_at <  '2026-03-01'
  AND actor_id = 42;
```

Query ini memungkinkan PostgreSQL memilih hanya partition Februari.

Query yang buruk:

```sql
SELECT *
FROM audit_log
WHERE actor_id = 42;
```

Query ini tidak menyaring berdasarkan `occurred_at`, sehingga PostgreSQL mungkin harus mencari di semua partition.

### Rule utama range partitioning

Range partitioning efektif bila query utama hampir selalu punya predicate terhadap range key.

Untuk data waktu, itu berarti query harus punya filter waktu.

---

## 6. List Partitioning

List partitioning membagi data berdasarkan daftar nilai diskrit.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id bigint not null,
    jurisdiction_code text not null,
    case_number text not null,
    status text not null,
    created_at timestamptz not null default now()
) PARTITION BY LIST (jurisdiction_code);
```

Partition:

```sql
CREATE TABLE enforcement_case_id
PARTITION OF enforcement_case
FOR VALUES IN ('ID');

CREATE TABLE enforcement_case_sg
PARTITION OF enforcement_case
FOR VALUES IN ('SG');

CREATE TABLE enforcement_case_my
PARTITION OF enforcement_case
FOR VALUES IN ('MY');
```

List partitioning cocok bila:

1. jumlah nilai relatif terkendali,
2. setiap nilai punya lifecycle/maintenance berbeda,
3. akses sering difilter berdasarkan nilai tersebut,
4. ada kebutuhan isolasi operasional per kategori.

List partitioning buruk bila nilai sangat banyak dan terus bertambah, misalnya jutaan tenant.

Untuk tenant, list partitioning hanya cocok bila tenant sedikit atau hanya tenant besar tertentu yang dipisah.

---

## 7. Hash Partitioning

Hash partitioning membagi data berdasarkan hash dari key.

Contoh:

```sql
CREATE TABLE case_assignment (
    case_id bigint not null,
    officer_id bigint not null,
    assigned_at timestamptz not null,
    status text not null
) PARTITION BY HASH (case_id);
```

Partition:

```sql
CREATE TABLE case_assignment_p0
PARTITION OF case_assignment
FOR VALUES WITH (MODULUS 4, REMAINDER 0);

CREATE TABLE case_assignment_p1
PARTITION OF case_assignment
FOR VALUES WITH (MODULUS 4, REMAINDER 1);

CREATE TABLE case_assignment_p2
PARTITION OF case_assignment
FOR VALUES WITH (MODULUS 4, REMAINDER 2);

CREATE TABLE case_assignment_p3
PARTITION OF case_assignment
FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

Hash partitioning cocok bila:

1. tidak ada natural range,
2. data perlu disebar merata,
3. operasi sering berdasarkan equality pada hash key,
4. ingin mengurangi ukuran index per partition.

Hash partitioning tidak cocok untuk retention waktu.

Problem besar: mengubah jumlah hash partition tidak trivial. Jika sejak awal memakai modulus 4 lalu ingin menjadi 8, redistribusi data bukan operasi ringan.

---

## 8. Partition Key adalah Keputusan Arsitektural

Partition key bukan sekadar kolom teknis. Ia menentukan:

1. query mana yang cepat,
2. query mana yang tetap mahal,
3. constraint apa yang bisa dibuat,
4. retention seberapa mudah,
5. index shape,
6. vacuum/analyze behavior,
7. migration complexity,
8. application query contract.

Pertanyaan utama sebelum memilih partition key:

```text
Apakah mayoritas query penting menyertakan kolom ini sebagai filter?
```

Jika tidak, partitioning mungkin tidak membantu.

Contoh buruk:

```text
Partition table audit_log by occurred_at,
tetapi aplikasi paling sering mencari by resource_id tanpa filter waktu.
```

Akibatnya query harus mencari ke banyak partition.

Solusi mungkin:

1. tambahkan mandatory time range di API,
2. buat secondary lookup table,
3. gunakan search/indexing engine lain,
4. gunakan composite partitioning,
5. buat desain read model terpisah.

---

## 9. Partition Pruning

Partition pruning adalah proses PostgreSQL menghindari partition yang tidak mungkin berisi row sesuai predicate.

Contoh:

```sql
SELECT *
FROM audit_log
WHERE occurred_at >= '2026-01-01'
  AND occurred_at <  '2026-02-01';
```

Jika table dipartisi bulanan berdasarkan `occurred_at`, PostgreSQL hanya perlu membaca partition Januari.

EXPLAIN idealnya menunjukkan hanya partition relevan.

```sql
EXPLAIN
SELECT *
FROM audit_log
WHERE occurred_at >= '2026-01-01'
  AND occurred_at <  '2026-02-01';
```

Kamu ingin melihat plan yang tidak menyentuh semua partition.

### Kesalahan umum yang merusak pruning

#### 9.1 Predicate tidak memakai partition key

```sql
SELECT *
FROM audit_log
WHERE actor_id = 42;
```

Semua partition mungkin diperiksa.

#### 9.2 Partition key dibungkus fungsi

```sql
SELECT *
FROM audit_log
WHERE date(occurred_at) = date '2026-01-15';
```

Lebih baik:

```sql
SELECT *
FROM audit_log
WHERE occurred_at >= '2026-01-15 00:00:00+00'
  AND occurred_at <  '2026-01-16 00:00:00+00';
```

#### 9.3 Timezone logic tidak eksplisit

Aplikasi Java sering memakai `LocalDate`, `LocalDateTime`, `Instant`, dan timezone yang bercampur.

Query seperti:

```sql
WHERE occurred_at >= ?
  AND occurred_at < ?
```

lebih aman daripada:

```sql
WHERE date(occurred_at AT TIME ZONE 'Asia/Jakarta') = ?
```

Yang kedua bisa benar secara bisnis, tetapi lebih sulit untuk pruning dan index usage jika tidak didesain dengan generated column/expression index.

#### 9.4 OR predicate tidak rapi

```sql
WHERE occurred_at >= '2026-01-01'
   OR status = 'OPEN'
```

Predicate seperti ini bisa membuat pruning tidak efektif.

#### 9.5 ORM menyembunyikan filter waktu

Misalnya repository method:

```java
List<AuditLog> findByResourceId(String resourceId);
```

Tanpa time range, query akan scan banyak partition.

Untuk partitioned audit table, API lebih baik memaksa:

```java
List<AuditLog> findByResourceIdAndOccurredAtBetween(
    String resourceId,
    Instant from,
    Instant to
);
```

---

## 10. Partitioning dan Index

Parent partitioned table tidak memiliki satu index fisik global seperti tabel biasa. Index dibuat sebagai partitioned index yang punya index per child partition.

Contoh:

```sql
CREATE INDEX idx_audit_log_actor_time
ON audit_log (actor_id, occurred_at DESC);
```

PostgreSQL akan membuat index pada partition yang ada, dan partition baru perlu index yang sesuai ketika dibuat atau di-attach.

Secara praktis, kamu harus berpikir:

```text
Index di partitioned table = kumpulan index lokal per partition
```

Implikasi:

1. index maintenance dapat lebih kecil per partition,
2. index rebuild bisa dilakukan per partition,
3. query yang menyentuh banyak partition bisa melakukan banyak index scan,
4. unique constraint memiliki batasan penting,
5. monitoring index harus melihat child partitions.

---

## 11. Unique Constraint pada Partitioned Table

Ini salah satu jebakan terbesar.

Pada partitioned table, unique constraint/primary key harus mencakup semua partition key agar uniqueness dapat ditegakkan secara lokal per partition.

Contoh table:

```sql
CREATE TABLE audit_log (
    id bigint generated always as identity,
    occurred_at timestamptz not null,
    details jsonb not null
) PARTITION BY RANGE (occurred_at);
```

Ini bermasalah:

```sql
ALTER TABLE audit_log ADD PRIMARY KEY (id);
```

Kenapa? Karena `id` saja tidak mengandung partition key `occurred_at`.

PostgreSQL tidak punya global unique index lintas semua partition seperti beberapa database lain.

Yang valid secara prinsip:

```sql
ALTER TABLE audit_log ADD PRIMARY KEY (id, occurred_at);
```

Tapi ini mengubah model referensi. Foreign key ke audit log harus membawa `(id, occurred_at)`, bukan hanya `id`.

### Dampak desain

Untuk event/audit table, kadang primary key global tidak dibutuhkan untuk referential integrity.

Alternatif:

1. gunakan `id` sebagai identifier teknis non-unique global secara constraint,
2. gunakan `(occurred_at, id)` sebagai key fisik,
3. gunakan UUID dan terima bahwa global uniqueness tidak ditegakkan oleh parent constraint kecuali mencakup partition key,
4. simpan natural uniqueness di table kecil terpisah,
5. hindari FK ke event/audit log partitioned table.

### Untuk Java engineer

Jangan asal membuat entity JPA dengan:

```java
@Id
private Long id;
```

pada partitioned table lalu menganggap database menjamin global primary key jika constraint tidak bisa dibuat.

ORM model harus mengikuti constraint nyata database.

---

## 12. Partitioning dan Foreign Key

Foreign key pada partitioned table bisa digunakan, tetapi perlu dipahami dari sisi biaya dan desain.

Pertimbangkan table `case_note` partitioned by `created_at`:

```sql
CREATE TABLE case_note (
    id bigint generated always as identity,
    case_id bigint not null references enforcement_case(id),
    note_text text not null,
    created_at timestamptz not null
) PARTITION BY RANGE (created_at);
```

Setiap insert note perlu validasi FK ke `enforcement_case`.

Ini normal.

Namun bila partitioned table menjadi target FK, constraint unik yang direferensikan harus valid sesuai aturan unique constraint partitioned table.

Desain yang biasanya lebih aman:

1. parent/master table tidak dipartisi bila ukurannya manageable,
2. child/event/log table dipartisi berdasarkan waktu,
3. FK dari child ke parent tetap dipertahankan jika write rate dan locking cost masih aman,
4. audit/event append-only high-volume kadang tidak memakai FK untuk menghindari coupling operasional, tetapi menyimpan identifier dan validasi di write path.

Trade-off harus eksplisit.

---

## 13. Partitioning dan Query Planner

Partitioned table memperbesar search space planner.

Jika ada terlalu banyak partition, planning time bisa meningkat. Query yang sederhana bisa menjadi mahal sebelum eksekusi dimulai.

Contoh anti-pattern:

```text
1 partition per tenant per day
10.000 tenant
365 hari
= 3.650.000 partitions
```

Ini bukan desain yang sehat.

Partition count harus dijaga.

Guideline kasar:

1. puluhan partition: biasanya aman,
2. ratusan partition: perlu disiplin dan monitoring,
3. ribuan partition: perlu alasan kuat dan testing serius,
4. puluhan ribu partition: red flag besar.

Batas tepat bergantung workload, versi PostgreSQL, hardware, query shape, dan operasi DDL.

---

## 14. Granularity: Harian, Bulanan, Tahunan, atau Tenant?

Granularity partition adalah keputusan penting.

### 14.1 Partition harian

Cocok bila:

1. data per hari sangat besar,
2. retention perlu hapus per hari,
3. query umumnya rentang pendek,
4. maintenance harian masuk akal.

Risiko:

1. partition count cepat besar,
2. index dan stats banyak,
3. automation wajib matang.

### 14.2 Partition bulanan

Cocok untuk banyak aplikasi bisnis.

Keuntungan:

1. jumlah partition rendah,
2. retention masih mudah,
3. query bulanan/kuartalan efisien,
4. maintenance lebih sederhana.

Risiko:

1. partition bulan aktif bisa sangat besar,
2. hot partition tetap ada,
3. vacuum pada active partition tetap penting.

### 14.3 Partition tahunan

Cocok bila data tidak terlalu besar atau retention tahunan.

Risiko:

1. partition terlalu besar,
2. index besar,
3. maintenance kurang granular.

### 14.4 Tenant partition

Cocok bila:

1. tenant sedikit,
2. tenant besar perlu isolasi,
3. query selalu tenant-scoped,
4. operasional per tenant dibutuhkan.

Risiko:

1. tenant kecil banyak membuat partition berlebihan,
2. onboarding tenant butuh DDL,
3. query lintas tenant lebih kompleks.

### 14.5 Hybrid

Contoh:

```text
Partition by month
Subpartition by region
```

Atau:

```text
Partition by tenant class
Subpartition by month
```

Hybrid menambah fleksibilitas tetapi juga kompleksitas. Jangan mulai dari hybrid kecuali ada kebutuhan nyata.

---

## 15. Multi-level Partitioning

PostgreSQL mendukung partition di bawah partition.

Contoh:

```sql
CREATE TABLE enforcement_event (
    id bigint not null,
    jurisdiction_code text not null,
    occurred_at timestamptz not null,
    event_type text not null,
    payload jsonb not null
) PARTITION BY RANGE (occurred_at);
```

Partition bulanan yang masih dipartisi lagi:

```sql
CREATE TABLE enforcement_event_2026_01
PARTITION OF enforcement_event
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')
PARTITION BY LIST (jurisdiction_code);
```

Subpartition:

```sql
CREATE TABLE enforcement_event_2026_01_id
PARTITION OF enforcement_event_2026_01
FOR VALUES IN ('ID');

CREATE TABLE enforcement_event_2026_01_sg
PARTITION OF enforcement_event_2026_01
FOR VALUES IN ('SG');
```

Kapan masuk akal?

1. data sangat besar,
2. lifecycle berbeda per dimensi,
3. query selalu menyaring dua dimensi tersebut,
4. jumlah total partition tetap terkendali,
5. automation kuat.

Kapan buruk?

1. hanya karena terlihat rapi,
2. query tidak selalu pakai dua key,
3. jumlah kombinasi besar,
4. tim belum punya observability/maintenance matang.

---

## 16. Default Partition

Default partition menangkap row yang tidak cocok ke partition mana pun.

```sql
CREATE TABLE audit_log_default
PARTITION OF audit_log
DEFAULT;
```

Keuntungan:

1. insert tidak gagal saat partition belum dibuat,
2. sistem lebih toleran terhadap kesalahan jadwal partition creation,
3. bisa menjadi safety net.

Risiko:

1. default partition bisa diam-diam membesar,
2. query pruning bisa terganggu,
3. data salah periode masuk ke tempat tidak diharapkan,
4. operasi memindahkan data dari default partition ke partition benar bisa mahal.

Default partition cocok sebagai safety net, bukan tempat tinggal permanen.

Monitoring default partition wajib.

---

## 17. Attach dan Detach Partition

Salah satu alasan utama memakai partitioning adalah operasi attach/detach yang cepat dibanding delete massal.

### 17.1 Retention dengan DELETE biasa

```sql
DELETE FROM audit_log
WHERE occurred_at < now() - interval '2 years';
```

Pada tabel besar, ini bisa:

1. menghasilkan banyak WAL,
2. membuat banyak dead tuple,
3. membutuhkan vacuum,
4. memicu bloat,
5. mengganggu workload normal.

### 17.2 Retention dengan detach/drop partition

```sql
ALTER TABLE audit_log DETACH PARTITION audit_log_2024_01;
DROP TABLE audit_log_2024_01;
```

Ini jauh lebih murah secara operasional dibanding menghapus jutaan/miliaran row satu per satu.

### 17.3 Archival dengan detach

Kamu bisa detach partition lama lalu backup/archive:

```sql
ALTER TABLE audit_log DETACH PARTITION audit_log_2024_01;
```

Setelah itu partition menjadi table biasa dan bisa:

1. diekspor,
2. dipindahkan tablespace,
3. dikompres di luar,
4. disimpan sebagai archive,
5. di-drop setelah verifikasi.

---

## 18. Partition Lifecycle Automation

Partitioning production butuh automation.

Minimal harus ada proses untuk:

1. membuat partition masa depan,
2. membuat index pada partition baru,
3. memastikan constraint benar,
4. memastikan privileges benar,
5. memastikan autovacuum settings benar,
6. memastikan monitoring mengenali partition baru,
7. detach/drop/archive partition lama,
8. alert jika insert masuk default partition,
9. alert jika partition masa depan belum ada.

Contoh fungsi sederhana membuat partition bulanan:

```sql
CREATE TABLE audit_log_2026_03
PARTITION OF audit_log
FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

Dalam production, nama partition dan boundary harus deterministic:

```text
audit_log_YYYY_MM
```

Jangan membuat nama random.

---

## 19. Migration dari Tabel Biasa ke Partitioned Table

PostgreSQL tidak selalu memungkinkan mengubah tabel biasa menjadi partitioned table secara langsung dengan cara sederhana tanpa strategi. Untuk production, biasanya dipakai pola migrasi bertahap.

### 19.1 Strategi high-level

1. buat partitioned table baru,
2. buat partition sesuai range data,
3. buat index dan constraint,
4. backfill data dari tabel lama,
5. sinkronisasi perubahan baru,
6. cutover aplikasi,
7. validasi,
8. archive/drop tabel lama.

### 19.2 Pattern expand-contract

Misalnya tabel lama:

```text
audit_log_old
```

Tabel baru:

```text
audit_log_new partitioned by occurred_at
```

Langkah:

```text
Expand:
  create new partitioned structure
  dual-write or sync new writes
  backfill historical data

Contract:
  switch reads/writes to new table
  stop old writes
  validate counts/checksums
  drop/archive old table
```

### 19.3 Risiko migrasi

1. row hilang saat cutover,
2. duplicate row,
3. foreign key berubah,
4. sequence/id generation berbeda,
5. query plan berubah,
6. ORM mapping perlu update,
7. lock DDL terlalu lama,
8. backup/restore assumption berubah.

Migration partitioning adalah proyek, bukan migration script kecil.

---

## 20. Partitioning dan Vacuum

Partitioning membantu vacuum karena dead tuple tersebar per partition.

Keuntungan:

1. partition lama yang read-only hampir tidak perlu vacuum agresif,
2. partition aktif bisa dituning khusus,
3. autovacuum bekerja per relation/partition,
4. bloat bisa dianalisis per partition,
5. reindex/vacuum bisa dilakukan per partition.

Namun partitioning tidak menghilangkan kebutuhan vacuum.

Active partition tetap bisa mengalami:

1. dead tuple banyak,
2. HOT update gagal,
3. index bloat,
4. autovacuum tertinggal,
5. long transaction menahan cleanup.

Jika workload update-heavy pada active partition, partitioning tidak otomatis menyelesaikan bloat.

---

## 21. Partitioning dan Statistics

Setiap partition punya statistics sendiri. Parent table juga dapat memiliki statistics terkait perencanaan query.

Implikasi:

1. `ANALYZE` perlu berjalan untuk partition baru,
2. partition baru yang kosong bisa punya stats buruk,
3. partition aktif dengan distribusi berubah cepat perlu auto-analyze cukup agresif,
4. query lintas partition membutuhkan estimasi gabungan,
5. skew antar partition bisa menyebabkan plan berbeda.

Contoh:

```sql
ANALYZE audit_log_2026_02;
```

Atau:

```sql
ANALYZE audit_log;
```

Untuk sistem append-only, partition terbaru sering paling penting dan paling berubah.

Per-table autovacuum/analyze setting bisa dibutuhkan:

```sql
ALTER TABLE audit_log_2026_02 SET (
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_analyze_threshold = 1000
);
```

---

## 22. Partitioning dan WAL

Partitioning tidak menghilangkan WAL.

Insert ke partition tetap menghasilkan WAL. Index pada partition tetap menghasilkan WAL. Backfill ke partition tetap menghasilkan WAL.

Namun partitioning dapat mengurangi WAL untuk retention karena drop/detach partition jauh lebih murah daripada delete massal.

Compare:

```text
DELETE 500 million rows:
  huge WAL
  huge dead tuples
  vacuum required
  possible bloat

DROP old partition:
  metadata/storage removal
  much lower operational cost
```

Untuk sistem audit/event besar, ini salah satu alasan partitioning paling kuat.

---

## 23. Partitioning dan Locking

DDL partition tetap mengambil lock. Walaupun sering lebih ringan dibanding operasi pada satu tabel besar, tetap harus direncanakan.

Operasi yang perlu diperhatikan:

1. `CREATE TABLE ... PARTITION OF`,
2. `ATTACH PARTITION`,
3. `DETACH PARTITION`,
4. `DROP TABLE partition`,
5. `CREATE INDEX` pada partition,
6. `ALTER TABLE` parent,
7. constraint validation.

Untuk production:

1. set `lock_timeout`,
2. jalankan DDL pada window aman,
3. monitor blocking,
4. gunakan migration tool dengan retry,
5. hindari transaksi panjang saat DDL.

Contoh:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE audit_log DETACH PARTITION audit_log_2024_01;
```

Jika lock tidak bisa didapat cepat, lebih baik gagal daripada menggantung dan memblokir sistem.

---

## 24. Partitioning dan Java/Hibernate

Dari sisi Java, partitioned table biasanya tetap terlihat sebagai satu tabel.

Namun ada beberapa jebakan.

### 24.1 Entity ID assumption

Jika partitioned table tidak punya primary key global `id`, JPA entity model harus realistis.

Jangan membuat model yang menganggap uniqueness dijamin jika database tidak menjamin.

### 24.2 Query harus membawa partition key

Repository method harus memaksa filter waktu/tenant bila itu partition key.

Buruk:

```java
List<AuditLog> findByResourceId(String resourceId);
```

Lebih baik:

```java
List<AuditLog> findByResourceIdAndOccurredAtBetween(
    String resourceId,
    Instant from,
    Instant to
);
```

### 24.3 Pagination lintas partition

Offset pagination lintas banyak partition bisa buruk.

Lebih baik keyset pagination:

```sql
SELECT *
FROM audit_log
WHERE occurred_at < :cursorOccurredAt
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

Dengan index:

```sql
CREATE INDEX idx_audit_log_time_id
ON audit_log (occurred_at DESC, id DESC);
```

### 24.4 Batch insert

Jika batch insert berisi row dari banyak partition, PostgreSQL harus route setiap row. Ini normal, tetapi bisa memengaruhi locality.

Untuk bulk load besar, kadang lebih efisien mengelompokkan data per partition.

### 24.5 ORM-generated SQL

ORM bisa menghasilkan predicate yang tidak friendly untuk pruning.

Contoh buruk:

```sql
WHERE extract(year from occurred_at) = ?
```

Lebih baik aplikasi menghitung boundary:

```sql
WHERE occurred_at >= ? AND occurred_at < ?
```

---

## 25. Common Use Case: Audit Log

Audit log biasanya cocok untuk range partitioning by time.

```sql
CREATE TABLE audit_log (
    id bigint generated always as identity,
    actor_id bigint,
    action text not null,
    resource_type text not null,
    resource_id text not null,
    occurred_at timestamptz not null,
    details jsonb not null
) PARTITION BY RANGE (occurred_at);
```

Indexes:

```sql
CREATE INDEX idx_audit_log_actor_time
ON audit_log (actor_id, occurred_at DESC);

CREATE INDEX idx_audit_log_resource_time
ON audit_log (resource_type, resource_id, occurred_at DESC);
```

Query API harus mewajibkan time range:

```sql
SELECT *
FROM audit_log
WHERE resource_type = :type
  AND resource_id = :id
  AND occurred_at >= :from
  AND occurred_at < :to
ORDER BY occurred_at DESC
LIMIT 100;
```

Retention:

```sql
ALTER TABLE audit_log DETACH PARTITION audit_log_2024_01;
DROP TABLE audit_log_2024_01;
```

Good fit karena:

1. append-heavy,
2. time-oriented,
3. retention jelas,
4. query biasanya time bounded,
5. historical partition relatif immutable.

---

## 26. Common Use Case: Event Store / Outbox

Outbox table sering tumbuh cepat.

```sql
CREATE TABLE outbox_event (
    id bigint generated always as identity,
    aggregate_type text not null,
    aggregate_id text not null,
    event_type text not null,
    payload jsonb not null,
    status text not null,
    created_at timestamptz not null default now(),
    published_at timestamptz
) PARTITION BY RANGE (created_at);
```

Tapi outbox punya active updates:

```text
NEW -> PUBLISHED
```

Artinya active partition mengalami update dan dead tuples.

Index:

```sql
CREATE INDEX idx_outbox_unpublished
ON outbox_event (created_at, id)
WHERE status = 'NEW';
```

Partitioning membantu retention, tetapi active partition tetap perlu vacuum tuning.

Untuk outbox, pertimbangkan:

1. active queue table kecil,
2. published archive partitioned table,
3. move/archive setelah publish,
4. atau partition by created_at dengan partial index status.

Jangan menganggap append-only bila ada status update.

---

## 27. Common Use Case: Workflow/Case Management

Untuk case management, partitioning harus hati-hati.

Table utama `enforcement_case` biasanya tidak otomatis cocok dipartisi by time jika query utama adalah by case id, assignee, status, SLA, jurisdiction, atau workflow state.

Contoh query:

```sql
SELECT *
FROM enforcement_case
WHERE assigned_officer_id = :officerId
  AND status in ('OPEN', 'UNDER_REVIEW')
ORDER BY priority DESC, created_at ASC
LIMIT 50;
```

Jika table dipartisi by `created_at`, query ini mungkin harus cek banyak partition.

Lebih baik:

1. table utama tetap non-partitioned dengan index yang kuat,
2. event/audit/history table dipartisi by time,
3. reporting table/materialized read model dipartisi bila besar,
4. archival case lama dipindahkan ke archive table.

Partitioning table utama workflow sering tidak perlu kecuali ukurannya sangat besar dan query selalu punya partition key.

---

## 28. Common Use Case: Multi-tenant SaaS

Ada beberapa desain:

### 28.1 Tenant column tanpa partitioning

```sql
tenant_id uuid not null
```

Dengan index:

```sql
CREATE INDEX idx_case_tenant_status
ON enforcement_case (tenant_id, status, created_at DESC);
```

Ini sering cukup.

### 28.2 List partition by tenant

Cocok untuk tenant besar dan jumlah tenant kecil.

Risiko bila tenant banyak.

### 28.3 Hash partition by tenant

Cocok untuk menyebar data antar partition.

Tapi tidak memberi isolasi operasional per tenant tertentu.

### 28.4 Hybrid hot tenant split

Pattern realistis:

1. mayoritas tenant di table/partition umum,
2. tenant besar dipisah ke partition khusus,
3. query tetap tenant-scoped,
4. routing dan monitoring eksplisit.

Jangan membuat partition per tenant secara membabi buta.

---

## 29. Partitioning dan Reporting

Reporting sering query lintas waktu panjang.

Partitioning membantu bila:

1. filter waktu selalu ada,
2. aggregation per periode,
3. partition-wise aggregate/join bisa digunakan,
4. historical partition read-only,
5. summary/materialized view dibuat per partition/periode.

Namun query seperti:

```sql
SELECT officer_id, count(*)
FROM enforcement_case_event
GROUP BY officer_id;
```

tanpa filter waktu tetap harus membaca semua partition.

Untuk reporting berat, pertimbangkan:

1. materialized view,
2. summary table,
3. warehouse,
4. incremental aggregation,
5. read replica,
6. columnar/analytical system jika workload dominan OLAP.

Partitioning bukan pengganti data warehouse.

---

## 30. Partition-wise Join dan Aggregate

PostgreSQL dapat melakukan optimisasi tertentu bila dua partitioned table punya skema partitioning kompatibel.

Misalnya:

```text
event table partitioned by occurred_at month
summary table partitioned by occurred_at month
```

Query join/filter per bulan dapat dieksekusi lebih lokal per partition.

Namun ini membutuhkan:

1. partition key compatible,
2. boundary compatible,
3. query predicate mendukung,
4. planner setting dan estimasi memadai.

Jangan mendesain partitioning hanya berharap partition-wise join menyelamatkan desain query buruk.

---

## 31. CHECK Constraint dan Partition Bound

Setiap partition memiliki partition bound yang secara konseptual mirip constraint.

Contoh:

```sql
CREATE TABLE audit_log_2026_01
PARTITION OF audit_log
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

PostgreSQL tahu partition ini hanya berisi data Januari 2026.

Ini yang memungkinkan pruning.

Untuk attach table existing sebagai partition, PostgreSQL perlu memastikan data cocok dengan bound. Jika ada CHECK constraint yang membuktikan kesesuaian, attach bisa lebih efisien karena tidak perlu scan validasi penuh.

Pattern:

```sql
ALTER TABLE audit_log_2026_03_staging
ADD CONSTRAINT audit_log_2026_03_check
CHECK (
    occurred_at >= '2026-03-01'::timestamptz
    AND occurred_at < '2026-04-01'::timestamptz
);
```

Lalu attach:

```sql
ALTER TABLE audit_log
ATTACH PARTITION audit_log_2026_03_staging
FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

---

## 32. Tablespace per Partition

Partition bisa ditempatkan di tablespace berbeda.

Contoh use case:

1. active partition di fast storage,
2. old partition di cheaper storage,
3. archive partition di separate disk,
4. reporting partition di storage tertentu.

Namun ini menambah kompleksitas operasi.

Pastikan:

1. backup mencakup semua tablespace,
2. monitoring disk per tablespace,
3. restore drill valid,
4. failover environment punya path compatible,
5. storage performance tidak mengejutkan planner/workload.

---

## 33. Performance Benefit yang Realistis

Partitioning bisa meningkatkan performa melalui:

1. partition pruning,
2. index lebih kecil,
3. cache locality lebih baik,
4. maintenance lebih granular,
5. retention lebih murah,
6. statistics lebih representatif per partition,
7. parallelism lebih baik pada beberapa query,
8. reduced bloat scope.

Namun partitioning bisa menurunkan performa melalui:

1. planning overhead,
2. append/merge banyak partition,
3. query tanpa partition predicate,
4. terlalu banyak local indexes,
5. DDL overhead,
6. ORM query tidak prunable,
7. index per partition yang tidak seragam,
8. statistics tidak konsisten.

---

## 34. EXPLAIN untuk Partitioned Table

Gunakan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM audit_log
WHERE occurred_at >= '2026-01-01'
  AND occurred_at < '2026-02-01'
ORDER BY occurred_at DESC
LIMIT 100;
```

Yang harus diperhatikan:

1. partition mana yang muncul di plan,
2. apakah partition pruning terjadi,
3. apakah banyak partition tetap discan,
4. apakah `Append` atau `Merge Append` muncul,
5. apakah index lokal dipakai,
6. apakah sort terjadi di banyak partition,
7. apakah planning time tinggi,
8. apakah actual rows jauh dari estimate,
9. apakah buffers menunjukkan pembacaan berlebihan.

Plan yang menyentuh semua partition padahal query seharusnya sempit adalah red flag.

---

## 35. Anti-pattern Partitioning

### 35.1 Partitioning karena tabel “terasa besar”

Ukuran besar bukan alasan cukup. Pertanyaan sebenarnya:

```text
Apa access pattern dan maintenance operation yang akan membaik?
```

### 35.2 Partition key tidak muncul di query

Partitioning by `created_at`, tetapi API sering query by `external_reference` tanpa waktu.

### 35.3 Terlalu banyak partition

Partition per tenant per day sering menjadi bencana.

### 35.4 Menganggap partitioning menggantikan index

Partition tetap butuh index yang sesuai.

### 35.5 Menganggap partitioning menggantikan vacuum

Active partition tetap perlu vacuum.

### 35.6 Tidak membuat partition masa depan

Insert gagal ketika tanggal baru masuk.

### 35.7 Default partition dibiarkan membesar

Default partition menjadi tempat sampah diam-diam.

### 35.8 Unique key tidak dipahami

Aplikasi menganggap `id` unique global, database tidak menjamin.

### 35.9 ORM repository tidak partition-aware

Method tanpa time range menghancurkan pruning.

### 35.10 Tidak punya runbook retention

Partition lama tidak pernah detach/drop, sehingga manfaat operasional hilang.

---

## 36. Decision Framework: Perlu Partitioning atau Tidak?

Gunakan pertanyaan berikut.

### 36.1 Apakah tabel sangat besar?

Jika tabel masih kecil/menengah dan performa bisa diselesaikan dengan index, partitioning mungkin belum perlu.

### 36.2 Apakah ada natural partition key?

Contoh kuat:

1. `occurred_at`,
2. `created_at`,
3. `tenant_id`,
4. `jurisdiction_code`,
5. `region`,
6. `hash(account_id)`.

### 36.3 Apakah query penting memakai partition key?

Jika tidak, manfaat pruning kecil.

### 36.4 Apakah retention/archival penting?

Jika ya, time partitioning sering kuat.

### 36.5 Apakah maintenance tabel monolitik sudah mahal?

Misalnya vacuum, reindex, analyze, backup partial, atau delete lama.

### 36.6 Apakah constraint model cocok?

Jika butuh unique global tanpa partition key, hati-hati.

### 36.7 Apakah operational automation siap?

Tanpa automation, partitioning adalah hutang operasional.

### 36.8 Apakah jumlah partition terkendali?

Jika tidak, desain ulang.

---

## 37. Design Template: Time-partitioned Audit/Event Table

Contoh desain yang relatif sehat:

```sql
CREATE TABLE case_event (
    id bigint generated always as identity,
    case_id bigint not null,
    event_type text not null,
    occurred_at timestamptz not null,
    actor_id bigint,
    payload jsonb not null,
    created_at timestamptz not null default now(),
    CHECK (event_type <> '')
) PARTITION BY RANGE (occurred_at);
```

Partition:

```sql
CREATE TABLE case_event_2026_01
PARTITION OF case_event
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE case_event_2026_02
PARTITION OF case_event
FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

Indexes:

```sql
CREATE INDEX idx_case_event_case_time
ON case_event (case_id, occurred_at DESC, id DESC);

CREATE INDEX idx_case_event_type_time
ON case_event (event_type, occurred_at DESC);

CREATE INDEX idx_case_event_actor_time
ON case_event (actor_id, occurred_at DESC)
WHERE actor_id IS NOT NULL;
```

Query:

```sql
SELECT *
FROM case_event
WHERE case_id = :caseId
  AND occurred_at >= :from
  AND occurred_at < :to
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

Retention:

```sql
ALTER TABLE case_event DETACH PARTITION case_event_2024_01;
DROP TABLE case_event_2024_01;
```

Operational requirements:

1. create next 3 months partitions,
2. monitor missing partition,
3. monitor default partition if used,
4. analyze new partition after bulk load,
5. test query pruning in CI/performance suite,
6. ensure repository methods require time range.

---

## 38. Design Template: Hot/Cold Split

Kadang partitioning bukan solusi terbaik untuk active table. Hot/cold split bisa lebih sederhana.

```text
case_current
case_archive_2025
case_archive_2024
case_archive_2023
```

Active case tetap di `case_current`. Case selesai dan lama dipindah ke archive table.

Keuntungan:

1. active queries cepat,
2. active table kecil,
3. archive bisa partitioned,
4. constraint active lebih sederhana,
5. ORM untuk active model tetap mudah.

Kerugian:

1. query all-history butuh union/view,
2. migration/archive job perlu benar,
3. data lifecycle lebih eksplisit.

Untuk workflow systems, hot/cold split sering lebih realistis daripada mempartition table utama berdasarkan waktu.

---

## 39. Design Template: Partitioned Read Model

Untuk sistem event-driven:

```text
OLTP tables:
  enforcement_case
  case_assignment
  case_status

Event/audit tables:
  case_event partitioned by occurred_at

Reporting read model:
  case_daily_summary partitioned by summary_date
```

Ini lebih sehat daripada membuat semua tabel dipartisi.

Partitioning cocok untuk:

1. event history,
2. audit trail,
3. daily summary,
4. large append-only logs,
5. historical reporting.

Core OLTP aggregate tetap dirancang untuk correctness dan low-latency access.

---

## 40. Runbook: Query Lambat pada Partitioned Table

Ketika query lambat:

### Step 1 — Ambil query aktual

Jangan percaya query dari kode. Ambil SQL aktual dari log atau `pg_stat_statements`.

### Step 2 — Jalankan EXPLAIN

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

### Step 3 — Cek partition pruning

Apakah hanya partition relevan yang disentuh?

Jika semua partition disentuh:

1. predicate partition key hilang,
2. predicate dibungkus fungsi,
3. parameter/generic plan issue,
4. OR predicate merusak pruning,
5. query ORM buruk.

### Step 4 — Cek index lokal

Apakah partition relevan punya index yang sama?

```sql
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE tablename LIKE 'audit_log_%'
ORDER BY tablename, indexname;
```

### Step 5 — Cek statistics

```sql
ANALYZE audit_log_2026_02;
```

Lihat estimate vs actual rows.

### Step 6 — Cek planning time

Jika planning time tinggi, partition count mungkin terlalu banyak.

### Step 7 — Cek temp spill

Sort/aggregate lintas partition bisa spill ke disk.

### Step 8 — Cek query contract aplikasi

Pastikan endpoint/repository memaksa time range/partition key.

---

## 41. Runbook: Insert Gagal karena Tidak Ada Partition

Error umum:

```text
no partition of relation found for row
```

Penyebab:

1. partition masa depan belum dibuat,
2. timestamp masuk di luar range,
3. timezone conversion salah,
4. data backfill lebih tua dari partition paling lama,
5. default partition tidak ada.

Langkah:

1. cek nilai partition key dari row,
2. cek daftar partition,
3. buat partition yang sesuai,
4. retry insert/backfill,
5. perbaiki automation create future partition,
6. tambahkan alert.

Contoh:

```sql
CREATE TABLE audit_log_2026_04
PARTITION OF audit_log
FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

---

## 42. Runbook: Default Partition Membesar

Penyebab:

1. partition expected tidak dibuat,
2. boundary salah,
3. timezone bug,
4. backfill masuk default,
5. data invalid.

Langkah:

1. ukur ukuran default partition,
2. lihat distribusi partition key,
3. buat partition target,
4. move data secara batch,
5. validasi count,
6. detach/drop bila perlu,
7. perbaiki automation.

Contoh analisis:

```sql
SELECT date_trunc('month', occurred_at) AS month, count(*)
FROM audit_log_default
GROUP BY 1
ORDER BY 1;
```

Move data:

```sql
INSERT INTO audit_log
SELECT *
FROM audit_log_default
WHERE occurred_at >= '2026-03-01'
  AND occurred_at < '2026-04-01';

DELETE FROM audit_log_default
WHERE occurred_at >= '2026-03-01'
  AND occurred_at < '2026-04-01';
```

Untuk data besar, lakukan batch dan perhatikan WAL/vacuum.

---

## 43. Runbook: Retention Partition

Checklist retention:

1. pastikan retention policy jelas,
2. pastikan partition tidak lagi dibutuhkan aplikasi,
3. pastikan backup/archive selesai,
4. pastikan tidak ada long-running query membaca partition,
5. set lock timeout,
6. detach partition,
7. backup/export jika perlu,
8. drop partition,
9. validasi storage reclaimed,
10. catat audit operation.

Contoh:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '10min';

ALTER TABLE audit_log DETACH PARTITION audit_log_2024_01;
```

Setelah verifikasi:

```sql
DROP TABLE audit_log_2024_01;
```

Untuk regulatory systems, drop data harus mengikuti retention/legal hold policy. Jangan hanya menghapus karena partition lama.

---

## 44. Monitoring Partitioned Tables

Pantau minimal:

1. row count per partition,
2. size per partition,
3. index size per partition,
4. dead tuple per partition,
5. last vacuum/autovacuum,
6. last analyze/autoanalyze,
7. default partition row count,
8. missing future partition,
9. slow query touching too many partitions,
10. planning time,
11. locks pada parent/partition,
12. replication lag saat retention/backfill.

Contoh size:

```sql
SELECT
    relname,
    pg_size_pretty(pg_total_relation_size(oid)) AS total_size
FROM pg_class
WHERE relname LIKE 'audit_log_%'
ORDER BY pg_total_relation_size(oid) DESC;
```

Contoh dead tuple:

```sql
SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    last_autovacuum,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE relname LIKE 'audit_log_%'
ORDER BY n_dead_tup DESC;
```

---

## 45. Testing Partitioning

Partitioning harus diuji dengan data yang realistis.

Test kecil sering menipu.

Yang perlu diuji:

1. query dengan partition key,
2. query tanpa partition key,
3. query boundary antar partition,
4. insert ke partition masa depan,
5. insert ke missing partition,
6. backfill data lama,
7. detach/drop retention,
8. index creation on new partition,
9. EXPLAIN plan stability,
10. ORM generated SQL,
11. migration rollback,
12. backup/restore,
13. failover saat DDL partition,
14. replication lag saat bulk load.

Performance test harus punya:

1. jumlah partition realistis,
2. row count realistis,
3. skew realistis,
4. index realistis,
5. query mix realistis.

---

## 46. Partitioning Decision Examples

### Example A — Audit log 5 billion rows, query always time-bounded

Partitioning by month is likely good.

Reason:

1. natural time lifecycle,
2. retention easy,
3. pruning effective,
4. old partitions immutable,
5. index size manageable.

### Example B — Case table 30 million rows, query mostly by status/assignee without time

Partitioning by created_at may be bad.

Better:

1. strong composite indexes,
2. active/archive split,
3. partial indexes for open cases,
4. read model for dashboards.

### Example C — SaaS table with 50 tenants, 2 huge tenants

Maybe use tenant-aware strategy.

Options:

1. no partition, composite indexes by tenant,
2. list partition for hot tenants plus default/common partition,
3. separate database for extreme tenant,
4. hash partition if spread is main goal.

### Example D — IoT/time-series events 2 billion rows/month

Partitioning by day or month may be needed, but consider:

1. TimescaleDB or specialized time-series layer,
2. BRIN indexes,
3. bulk ingest path,
4. retention automation,
5. compression/warehouse.

### Example E — Outbox table with heavy updates

Partitioning by created_at helps retention, but active partition bloat remains.

Consider:

1. partial index for unpublished,
2. aggressive autovacuum on active partition,
3. separate processed archive,
4. delete/drop processed partitions after retention.

---

## 47. Practical Heuristics

Use partitioning when at least two or three are true:

1. table is very large,
2. data has clear lifecycle,
3. retention/archival matters,
4. query naturally filters by partition key,
5. maintenance on full table is painful,
6. index size is becoming operationally costly,
7. old data is mostly immutable,
8. bulk load/drop by period is common.

Avoid partitioning when:

1. table is not large,
2. access pattern does not use partition key,
3. uniqueness model conflicts with partition key,
4. application team cannot enforce query contract,
5. operational automation is absent,
6. partition count would explode,
7. goal is vague “performance improvement”.

---

## 48. Checklist Sebelum Memakai Partitioning

Sebelum memutuskan, jawab:

```text
1. Tabel apa yang mau dipartisi?
2. Berapa row sekarang?
3. Berapa growth per hari/bulan?
4. Query top 10 apa saja?
5. Apakah query top 10 memakai partition key?
6. Partition key apa?
7. Granularity apa?
8. Berapa partition setelah 1 tahun? 5 tahun?
9. Apa retention policy?
10. Apa constraint yang harus tetap dijamin?
11. Apakah primary key/unique key harus global?
12. Apakah FK masih dibutuhkan?
13. Index apa per partition?
14. Bagaimana create future partition?
15. Bagaimana detach/drop old partition?
16. Bagaimana monitoring default partition?
17. Bagaimana backup/restore?
18. Bagaimana migration dari tabel lama?
19. Bagaimana ORM query dipaksa partition-aware?
20. Bagaimana rollback jika performa memburuk?
```

Jika banyak jawaban belum jelas, jangan mulai dari DDL. Mulai dari workload analysis.

---

## 49. Hubungan dengan Part Sebelumnya

Partitioning menyatukan banyak konsep yang sudah dibahas:

1. Dari Part 003 storage model:
   - partition adalah relation fisik sendiri.

2. Dari Part 004 MVCC:
   - tiap partition punya dead tuple dan vacuum behavior sendiri.

3. Dari Part 006 WAL:
   - insert/update/drop/backfill partition punya dampak WAL.

4. Dari Part 007 memory:
   - query lintas partition bisa memperbanyak sort/hash/memory pressure.

5. Dari Part 009 planner statistics:
   - partition pruning dan estimasi bergantung statistik.

6. Dari Part 010 EXPLAIN:
   - validasi partitioning harus lewat plan aktual.

7. Dari Part 011-013 index:
   - index di partitioned table adalah kumpulan index lokal.

8. Dari Part 014 locking:
   - attach/detach/drop partition tetap butuh lock.

9. Dari Part 015 constraint:
   - unique constraint partitioned table punya batasan penting.

10. Dari Part 016-017 schema/JSONB:
   - partition key harus kompatibel dengan model data dan query shape.

---

## 50. Latihan Praktis

### Latihan 1 — Audit Log Partition Design

Desain table audit log untuk sistem enforcement dengan kebutuhan:

1. 100 juta row/bulan,
2. retention 7 tahun,
3. query by resource + time,
4. query by actor + time,
5. regulatory export per bulan,
6. data tidak boleh hilang,
7. old data jarang berubah.

Tentukan:

1. partition key,
2. granularity,
3. indexes,
4. retention mechanism,
5. query contract API,
6. monitoring.

### Latihan 2 — Case Table Partition Decision

Table `enforcement_case` memiliki 50 juta row. Query utama:

1. by case id,
2. by assigned officer + status,
3. by SLA deadline,
4. by jurisdiction,
5. dashboard open cases.

Apakah partition by `created_at` tepat?

Jelaskan trade-off dan alternatif.

### Latihan 3 — EXPLAIN Partition Pruning

Buat query berikut dan prediksi apakah pruning terjadi:

```sql
SELECT *
FROM audit_log
WHERE date(occurred_at) = date '2026-01-15';
```

Rewrite agar lebih pruning-friendly.

### Latihan 4 — Unique Constraint Problem

Table dipartisi by `created_at`, tetapi aplikasi ingin `id` sebagai primary key global.

Jelaskan kenapa ini bermasalah dan berikan minimal tiga opsi desain.

### Latihan 5 — Default Partition Incident

Default partition membesar 200GB.

Buat runbook diagnosis dan recovery.

---

## 51. Ringkasan

Partitioning adalah alat kuat, tetapi hanya jika dipakai untuk problem yang benar.

Mental model utama:

```text
Partitioning is not primarily a performance feature.
Partitioning is a physical data lifecycle and access-path design feature.
```

Ia membantu jika:

1. data punya lifecycle jelas,
2. query cocok dengan partition key,
3. maintenance per partition memberi manfaat nyata,
4. retention/archival penting,
5. index/statistics per bagian lebih manageable.

Ia merugikan jika:

1. partition key salah,
2. query tidak partition-aware,
3. partition terlalu banyak,
4. constraint model tidak cocok,
5. automation buruk,
6. monitoring tidak siap.

Untuk Java engineer, pelajaran paling penting:

```text
Partitioning bukan hanya keputusan DBA.
Partitioning mengubah kontrak query aplikasi, kontrak entity model, kontrak migration, dan kontrak operasi production.
```

Repository method, API filter, transaction design, migration script, dan monitoring semua harus selaras dengan partition key.

---

## 52. Checklist Mastery Part 018

Kamu dianggap memahami bagian ini jika bisa menjelaskan:

1. beda partitioning dan sharding,
2. range/list/hash partitioning,
3. kapan partitioning membantu,
4. kapan partitioning merugikan,
5. apa itu partition pruning,
6. kenapa function pada partition key bisa merusak pruning,
7. kenapa partition key adalah keputusan arsitektural,
8. bagaimana index bekerja pada partitioned table,
9. kenapa unique constraint harus mencakup partition key,
10. bagaimana foreign key berinteraksi dengan partitioned table,
11. bagaimana menentukan granularity partition,
12. risiko terlalu banyak partition,
13. fungsi default partition dan bahayanya,
14. bedanya delete massal dengan detach/drop partition,
15. bagaimana partitioning memengaruhi vacuum,
16. bagaimana partitioning memengaruhi statistics,
17. bagaimana partitioning memengaruhi WAL,
18. bagaimana DDL partition bisa menyebabkan lock,
19. bagaimana ORM query harus partition-aware,
20. bagaimana mendesain audit/event table partitioned,
21. kenapa table utama workflow tidak selalu cocok dipartisi,
22. bagaimana membuat runbook missing partition,
23. bagaimana membuat runbook default partition membesar,
24. bagaimana memvalidasi partitioning dengan EXPLAIN,
25. bagaimana memutuskan partitioning secara evidence-based.

---

## 53. Apa yang Akan Dibahas Berikutnya

Part berikutnya:

```text
Part 019 — Vacuum, Autovacuum, Freeze, dan Bloat
```

Partitioning membantu mengelola bloat dan vacuum scope, tetapi tidak menghilangkan MVCC garbage collection. Karena itu, bagian berikutnya akan membahas salah satu topik paling penting dalam PostgreSQL production: vacuum.

Kita akan masuk ke:

1. dead tuple,
2. vacuum dan autovacuum,
3. visibility map,
4. free space map,
5. freeze,
6. transaction ID wraparound,
7. autovacuum tuning,
8. HOT updates,
9. fillfactor,
10. bloat diagnosis,
11. long-running transaction,
12. production incident patterns.

---

## Status Akhir Part 018

- Part 018 selesai.
- Seri belum selesai.
- Progress saat ini: `018 / 034`.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — JSONB dan Hybrid Relational Modelling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-019.md">Part 019 — Vacuum, Autovacuum, Freeze, dan Bloat ➡️</a>
</div>
