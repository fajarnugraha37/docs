# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-008.md

# Part 008 — Partitioning Strategy: Lifecycle Boundary, Not Query Silver Bullet

> Series: `learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers`  
> Audience: Java software engineer / backend engineer / tech lead  
> Focus: OLAP, column-oriented database, ClickHouse, production analytics architecture  
> Part: 008 of 034

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas **sorting key** sebagai keputusan performa paling penting di ClickHouse. Sekarang kita membahas konsep yang sering disalahpahami: **partitioning**.

Banyak engineer yang datang dari PostgreSQL, MySQL, atau data warehouse tradisional membawa asumsi seperti ini:

> “Kalau table besar, partition saja supaya query cepat.”

Di ClickHouse, asumsi itu terlalu lemah dan sering salah.

Partition memang dapat membantu query tertentu, tetapi fungsi utamanya bukan menjadi index utama. Fungsi utamanya adalah:

1. membagi data menjadi boundary lifecycle,
2. memudahkan drop/move/backup data,
3. membatasi scope background merge,
4. membantu TTL bekerja lebih murah,
5. memberi unit operasional untuk data management,
6. membantu query pruning hanya jika query filter cocok dengan partition expression.

Tetapi partition yang salah dapat membuat sistem lebih lambat, lebih rapuh, dan lebih mahal.

Setelah menyelesaikan part ini, kamu harus bisa menjawab:

- Apa beda `PARTITION BY` dan `ORDER BY` di ClickHouse?
- Kenapa partition bukan pengganti primary index?
- Kapan partition membantu query?
- Kapan partition justru merusak performa?
- Kenapa terlalu banyak partition berbahaya?
- Bagaimana memilih partition key untuk event analytics, logs, metrics, audit trail, dan regulatory case lifecycle?
- Bagaimana partition berinteraksi dengan TTL, backfill, retention, dan delete?
- Bagaimana membaca requirement analytics menjadi strategi partition yang defensible?

---

## 1. Mental Model Utama

Kalau hanya mengingat satu hal dari part ini, ingat ini:

> Di ClickHouse, `ORDER BY` adalah access path utama. `PARTITION BY` adalah boundary data management.

Atau lebih ringkas:

```text
ORDER BY     -> bagaimana data diurutkan dan diskip saat query
PARTITION BY -> bagaimana data dikelompokkan untuk lifecycle dan operasi fisik
```

Partition bukan row-level index. Partition bukan B-tree. Partition bukan hash index. Partition bukan magic accelerator.

Partition adalah cara ClickHouse memisahkan data menjadi kelompok fisik-logis. Di dalam setiap partition, data masih terdiri dari banyak **parts**. Setiap part punya primary index sparse berdasarkan sorting key.

Struktur mentalnya:

```text
Table
└── Partition: 202601
    ├── Part A
    │   ├── column files
    │   ├── marks
    │   └── sparse primary index
    ├── Part B
    │   ├── column files
    │   ├── marks
    │   └── sparse primary index
    └── Part C
        ├── column files
        ├── marks
        └── sparse primary index

└── Partition: 202602
    ├── Part D
    └── Part E
```

Query dapat melakukan pruning pada beberapa level:

```text
1. partition pruning
   -> skip partition jika predicate cocok dengan partition expression

2. part-level pruning
   -> skip part tertentu berdasarkan metadata

3. primary-index/granule pruning
   -> skip granule berdasarkan sparse index dari ORDER BY/PRIMARY KEY

4. column pruning
   -> hanya baca kolom yang diperlukan

5. late filtering/execution
   -> filter rows setelah data dibaca
```

Kesalahan umum adalah mengira partition pruning adalah alat utama. Padahal pada banyak workload ClickHouse, keuntungan terbesar justru datang dari:

- column pruning,
- compression,
- sparse primary index,
- sorting key alignment,
- pre-aggregation,
- batching insert,
- dan desain schema fisik.

Partition hanyalah satu layer.

---

## 2. Definisi Praktis: Apa Itu Partition di ClickHouse?

Pada table `MergeTree`, partition ditentukan saat membuat table:

```sql
CREATE TABLE events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    event_type LowCardinality(String),
    user_id UInt64,
    amount Decimal(18, 2)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time, user_id);
```

Di sini:

```sql
PARTITION BY toYYYYMM(event_date)
```

berarti data dikelompokkan per bulan.

Contoh partition:

```text
202601
202602
202603
...
```

ClickHouse menyimpan partition secara terpisah agar operasi seperti drop partition, move partition, detach partition, attach partition, dan merge dalam partition menjadi lebih manageable.

Dokumentasi ClickHouse menjelaskan bahwa `PARTITION BY` membagi data berdasarkan ekspresi tertentu, misalnya per bulan, hari, atau event type. Tetapi dokumentasi MergeTree juga menekankan bahwa dalam kebanyakan kasus partition key tidak diperlukan, dan bila diperlukan umumnya tidak perlu lebih granular dari bulanan.

---

## 3. Partition vs Part: Jangan Dicampur

Dua istilah yang sangat mudah tertukar:

```text
Partition -> logical grouping berdasarkan PARTITION BY
Part      -> immutable physical data chunk hasil insert/merge
```

Ketika kamu melakukan insert, ClickHouse membuat **part**.

Jika batch insert berisi data untuk beberapa partition, ClickHouse memecahnya ke partition masing-masing dan menghasilkan part di setiap partition terkait.

Contoh:

```text
Insert batch contains:
- January rows
- February rows
- March rows

ClickHouse creates:
- part in partition 202601
- part in partition 202602
- part in partition 202603
```

Jika kamu sering insert batch kecil yang tersebar ke banyak partition, jumlah part dapat meledak.

Ini penting:

> Background merge hanya menggabungkan parts dalam partition yang sama. Parts dari partition berbeda tidak digabung menjadi satu.

Maka partition yang terlalu granular mempersempit ruang merge dan meningkatkan jumlah part yang harus dikelola.

---

## 4. Apa yang Dilakukan Partition untuk Query?

Partition dapat membantu query jika filter query membuat ClickHouse bisa menyimpulkan partition mana yang relevan.

Contoh table:

```sql
PARTITION BY toYYYYMM(event_date)
```

Query:

```sql
SELECT count()
FROM events
WHERE event_date >= '2026-01-01'
  AND event_date <  '2026-02-01';
```

ClickHouse dapat membaca hanya partition Januari 2026.

Query:

```sql
SELECT count()
FROM events
WHERE event_date >= '2026-01-01'
  AND event_date <  '2026-04-01';
```

ClickHouse dapat membaca partition Januari, Februari, Maret.

Tetapi query seperti ini:

```sql
SELECT count()
FROM events
WHERE user_id = 123;
```

Tidak mendapat manfaat dari partition bulanan jika tidak ada filter waktu. ClickHouse mungkin harus mengecek banyak partition.

Query seperti ini:

```sql
SELECT count()
FROM events
WHERE tenant_id = 10;
```

juga tidak mendapat partition pruning jika partition key hanya waktu.

Maka partition hanya membantu query jika:

1. query memiliki predicate yang sejalan dengan partition expression,
2. predicate cukup selektif pada level partition,
3. jumlah partition yang dibaca jauh lebih sedikit dari total partition,
4. metadata partition tidak menjadi overhead yang lebih besar dari manfaatnya.

---

## 5. Apa yang Tidak Dilakukan Partition?

Partition tidak melakukan ini:

```text
- tidak menjamin row lookup cepat
- tidak menggantikan ORDER BY
- tidak menggantikan sparse primary index
- tidak otomatis mempercepat GROUP BY
- tidak otomatis mempercepat JOIN
- tidak otomatis mempercepat query tanpa filter partition key
- tidak menyelesaikan high cardinality problem
- tidak membuat small inserts aman
- tidak menghilangkan kebutuhan schema design yang baik
```

Jika query utama kamu:

```sql
WHERE tenant_id = ?
  AND case_status = ?
  AND event_time BETWEEN ? AND ?
```

maka performa biasanya lebih ditentukan oleh:

```sql
ORDER BY (tenant_id, case_status, event_time, ...)
```

daripada hanya:

```sql
PARTITION BY toYYYYMM(event_time)
```

Partition bulanan membantu membatasi bulan yang dibaca. Tetapi di dalam bulan itu, sorting key menentukan granule mana yang bisa diskip.

---

## 6. Analogi untuk Java Engineer

Bayangkan kamu punya file log besar.

Strategi A:

```text
/logs/2026-01.log
/logs/2026-02.log
/logs/2026-03.log
```

Ini seperti partition by month.

Jika ingin menghapus data Januari, mudah:

```text
rm /logs/2026-01.log
```

Jika ingin membaca hanya Februari, mudah:

```text
buka /logs/2026-02.log
```

Tetapi jika ingin mencari semua log untuk `tenant_id = 42`, dan tiap file bulanan isinya acak, kamu tetap harus scan semua file bulanan.

Strategi B:

```text
/logs/2026-02.log sorted by (tenant_id, service, timestamp)
```

Di sini pencarian tenant/service/time jauh lebih efisien karena data di dalam file punya locality.

Dalam ClickHouse:

```text
folder/file boundary -> partition
internal ordering    -> ORDER BY
sparse skip metadata -> primary index + marks
```

---

## 7. Lifecycle Boundary: Fungsi Utama Partition

Partition sangat berguna untuk operasi lifecycle.

### 7.1 Drop Old Data

Misalnya retention 13 bulan:

```sql
ALTER TABLE events DROP PARTITION 202501;
```

Dropping whole partition jauh lebih murah daripada menghapus row satu per satu.

Ini sangat penting untuk:

- logs,
- events,
- metrics,
- audit trail dengan retention jelas,
- temporary analytics,
- staging/import table,
- backfill validation table.

### 7.2 Detach/Attach Data

Kamu bisa detach partition:

```sql
ALTER TABLE events DETACH PARTITION 202601;
```

Lalu attach kembali:

```sql
ALTER TABLE events ATTACH PARTITION 202601;
```

Ini berguna untuk:

- maintenance,
- data recovery,
- manual correction,
- migration,
- controlled rollback.

### 7.3 Move Data Across Storage Policies

Pada deployment tertentu, data lama bisa dipindahkan ke storage yang lebih murah.

Misalnya:

```text
hot local SSD  -> last 30 days
warm disk      -> last 6 months
cold object    -> older data
```

Partition menjadi boundary alami untuk movement.

### 7.4 TTL Alignment

Jika TTL expression sejalan dengan partition key, ClickHouse bisa membuang partition/part secara lebih murah daripada rewrite row-level.

Contoh:

```sql
PARTITION BY toYYYYMM(event_date)
TTL event_date + INTERVAL 13 MONTH DELETE
```

Jika data lama sudah berada dalam partition yang sepenuhnya expired, sistem dapat menghapusnya secara jauh lebih murah dibanding menghapus sebagian row dari banyak part.

Dokumentasi ClickHouse menjelaskan bahwa ketika partition key selaras dengan TTL expression, ClickHouse dapat menjatuhkan whole partition/part saat expired, bukan rewrite data part secara row-level.

---

## 8. Granularity Partition: Year, Month, Day, Hour?

Pertanyaan praktis:

> Harus partition by month, day, hour, atau tenant?

Jawabannya tergantung volume, retention, query pattern, dan operasi lifecycle.

Tetapi default yang aman untuk banyak event analytics adalah:

```sql
PARTITION BY toYYYYMM(event_date)
```

atau untuk volume sangat besar/retention pendek:

```sql
PARTITION BY toYYYYMMDD(event_date)
```

### 8.1 Yearly Partition

Contoh:

```sql
PARTITION BY toYYYY(event_date)
```

Cocok jika:

- data volume per tahun tidak terlalu besar,
- retention tahunan,
- query sering lintas bulan,
- drop data dilakukan per tahun,
- merge parts dalam satu tahun masih manageable.

Kelemahan:

- partition terlalu besar untuk drop/move bulanan,
- TTL bulanan kurang selaras,
- backfill bulanan lebih sulit diisolasi.

### 8.2 Monthly Partition

Contoh:

```sql
PARTITION BY toYYYYMM(event_date)
```

Cocok untuk mayoritas event analytics:

- retention bulanan,
- dashboard sering filter range beberapa hari/bulan,
- jumlah partition per tahun hanya 12,
- drop old data mudah,
- part management relatif sehat.

Ini biasanya baseline yang defensible.

### 8.3 Daily Partition

Contoh:

```sql
PARTITION BY toYYYYMMDD(event_date)
```

Cocok jika:

- volume harian sangat besar,
- retention pendek,
- drop/move harian diperlukan,
- query hampir selalu per hari atau beberapa hari,
- jumlah parts per day tetap sehat.

Risiko:

- 365 partition per tahun per table,
- lebih banyak metadata,
- lebih banyak active partitions,
- insert batch yang menyentuh banyak hari menghasilkan banyak parts,
- backfill historis bisa menciptakan part explosion.

### 8.4 Hourly Partition

Contoh:

```sql
PARTITION BY toStartOfHour(event_time)
```

Biasanya harus dihindari kecuali untuk kasus sangat khusus.

Risiko:

- 24 partition per hari,
- 720 partition per bulan,
- 8.760 partition per tahun,
- metadata overhead tinggi,
- part explosion sangat mudah,
- merge scope terlalu kecil.

Hourly partition mungkin masuk akal hanya jika:

- data volume per jam sangat besar,
- retention sangat pendek,
- query dan drop selalu hourly,
- ingestion batching sangat terkendali,
- tim punya observability dan operational maturity kuat.

Untuk kebanyakan tim, hourly partition adalah smell.

---

## 9. Kenapa Terlalu Banyak Partition Berbahaya?

Partition terlalu granular menyebabkan beberapa masalah.

### 9.1 Metadata Overhead

Setiap partition memiliki metadata dan parts. Semakin banyak partition, semakin banyak metadata yang harus dikelola.

### 9.2 Merge Fragmentation

ClickHouse tidak menggabungkan parts antar partition. Jika data terlalu tersebar, setiap partition punya parts kecil sendiri-sendiri.

Contoh buruk:

```sql
PARTITION BY (tenant_id, toYYYYMMDD(event_date))
```

Jika ada 10.000 tenant aktif per hari, dalam 30 hari:

```text
10,000 tenants * 30 days = 300,000 logical partitions
```

Ini hampir pasti buruk.

### 9.3 Small Insert Amplification

Misalnya service mengirim batch kecil setiap detik dan batch mengandung row untuk banyak partition.

Jika satu batch menyentuh 20 partition, satu insert dapat membuat 20 part.

Jika ada 100 insert per menit:

```text
100 inserts/minute * 20 partitions = 2,000 new parts/minute
```

Background merges akan tertinggal.

### 9.4 Operational Complexity

Terlalu banyak partition membuat operasi berikut lebih berat:

- listing parts,
- mutation,
- TTL merge,
- backup metadata,
- replication queue,
- recovery,
- ALTER operations,
- monitoring.

### 9.5 False Sense of Performance

Engineer melihat query tertentu cepat karena hanya baca satu partition, lalu mengira desain benar. Tetapi query lain yang tidak cocok partition key menjadi lambat karena sorting key tidak mendukung access pattern.

---

## 10. Partition by Tenant: Sangat Menggoda, Sering Berbahaya

Untuk multi-tenant system, engineer sering berpikir:

```sql
PARTITION BY tenant_id
```

atau:

```sql
PARTITION BY (tenant_id, toYYYYMM(event_date))
```

Ini tampak natural karena banyak query filter tenant.

Tetapi ini sering buruk.

### 10.1 Kenapa Buruk?

Jika tenant banyak, partition banyak.

Contoh:

```text
5,000 tenants
24 monthly partitions retained
= 120,000 tenant-month partitions
```

Jika banyak tenant kecil, tiap partition kecil. Merge tidak efisien. Metadata membesar. Insert menyebar.

### 10.2 Kapan Tenant Partition Bisa Masuk Akal?

Tenant partition bisa dipertimbangkan jika:

- jumlah tenant sangat kecil,
- tenant besar dan isolasi fisik penting,
- lifecycle data berbeda per tenant,
- tenant dapat di-drop/migrate secara terpisah,
- query selalu single-tenant,
- operational model memang tenant-isolated,
- volume per tenant cukup besar agar partition tidak tiny.

Contoh:

```text
10 enterprise tenants
masing-masing ratusan GB/bulan
retention berbeda per tenant
perlu export/drop tenant-level
```

Dalam kasus ini, `(tenant_id, toYYYYMM(date))` mungkin masuk akal.

Tetapi untuk SaaS dengan ribuan tenant, pilihan lebih umum:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time, ...)
```

Tenant dijadikan bagian awal sorting key, bukan partition key.

---

## 11. Partition by Event Type: Biasanya Salah

Contoh:

```sql
PARTITION BY event_type
```

Ini terlihat berguna karena query sering filter event type.

Masalah:

1. lifecycle data biasanya bukan berdasarkan event type,
2. event type baru menciptakan partition baru,
3. event type cardinality bisa tumbuh,
4. skew besar antar event type,
5. retention per event type jarang benar-benar terpisah,
6. query time-range masih sulit dikelola.

Lebih umum:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time)
```

Jika event type memang boundary lifecycle, misalnya log category dengan retention berbeda, lebih baik pertimbangkan table terpisah atau TTL berbeda, bukan langsung partition by event type.

---

## 12. Partition by Hash: Jarang Dibutuhkan untuk MergeTree Analytics

Kadang engineer berpikir:

```sql
PARTITION BY cityHash64(user_id) % 64
```

Ini bisa menyebarkan data, tetapi sering menghilangkan manfaat lifecycle.

Hash partition mungkin berguna untuk kasus khusus:

- data sangat skewed,
- lifecycle tidak berbasis waktu,
- operasi data management per hash bucket masuk akal,
- query pattern cocok,
- tim memahami konsekuensi part management.

Tetapi untuk event analytics, hash partition sering smell karena:

- drop old data sulit,
- TTL kurang efisien,
- partition pruning berbasis waktu hilang,
- query time range harus membaca semua hash partition.

Biasanya sharding cluster lebih cocok untuk distribusi fisik daripada hash partition lokal.

---

## 13. Partition Key Harus Stabil

Partition key sebaiknya berbasis kolom yang:

- stabil,
- tidak berubah,
- selalu ada,
- mudah dihitung,
- sejalan dengan lifecycle,
- tidak high-cardinality tanpa alasan kuat.

Hindari partition key dari field yang bisa dikoreksi.

Contoh buruk:

```sql
PARTITION BY toYYYYMM(status_changed_at)
```

Jika `status_changed_at` bisa dikoreksi, row secara konseptual “pindah partition”. Mutation akan lebih berat.

Lebih baik gunakan event date yang immutable:

```sql
PARTITION BY toYYYYMM(event_date)
```

Untuk regulatory/case lifecycle, perlu hati-hati memilih antara:

```text
- event_time
- ingestion_time
- effective_time
- decision_time
- case_opened_at
- case_closed_at
```

Setiap waktu punya makna berbeda.

---

## 14. Event Time vs Ingestion Time untuk Partition

Ini keputusan penting.

### 14.1 Partition by Event Time

Contoh:

```sql
PARTITION BY toYYYYMM(event_date)
```

Kelebihan:

- cocok dengan analytical time semantics,
- query range event time mudah dipruning,
- retention berdasarkan event age natural,
- dashboard historis natural.

Kekurangan:

- late events masuk partition lama,
- backfill menulis partition lama,
- insert batch bisa menyentuh banyak partition,
- TTL/old partitions bisa berubah jika late data datang.

### 14.2 Partition by Ingestion Time

Contoh:

```sql
PARTITION BY toYYYYMM(ingested_date)
```

Kelebihan:

- insert path lebih predictable,
- late events tetap masuk partition saat ini,
- operational retention berdasarkan arrival mudah,
- backpressure dan batching lebih sederhana.

Kekurangan:

- query by event time kurang optimal untuk partition pruning,
- retention event-time semantics sulit,
- audit/reporting berdasarkan actual event date bisa membaca banyak partition.

### 14.3 Rule of Thumb

Untuk analytics umum:

```text
partition by event time jika query dan retention berbasis event time
partition by ingestion time jika ingestion/replay/arrival semantics lebih penting
```

Untuk regulatory/audit systems, sering butuh dua tabel:

```text
raw_ingest_events
- partition by ingestion_date
- untuk audit ingestion/replay/debugging

case_lifecycle_events
- partition by event_date/effective_date
- untuk analytics/reporting
```

---

## 15. Retention dan TTL Strategy

Partition sangat terkait retention.

Contoh retention 13 bulan:

```sql
CREATE TABLE case_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    case_id UUID,
    event_type LowCardinality(String),
    actor_role LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time, case_id)
TTL event_date + INTERVAL 13 MONTH DELETE;
```

Jika retention berbasis bulan, monthly partition selaras.

Jika retention 7 hari untuk logs ber-volume tinggi:

```sql
PARTITION BY toYYYYMMDD(log_date)
TTL log_date + INTERVAL 7 DAY DELETE
```

Daily partition bisa masuk akal karena lifecycle harian.

### 15.1 Jangan Menganggap TTL Instant

TTL diproses melalui background merges. Data tidak selalu hilang tepat di detik TTL tercapai.

Untuk compliance, ini penting:

> TTL adalah mekanisme data lifecycle background, bukan jaminan hard real-time deletion.

Jika perlu deletion guarantee yang ketat, desain perlu:

- partition-aligned drop,
- scheduled verification,
- audit logs,
- backup deletion policy,
- object storage lifecycle policy,
- documented deletion SLA.

### 15.2 Drop Partition vs TTL Delete

Jika data retention dapat diekspresikan sebagai whole partition, drop partition lebih straightforward.

Contoh:

```sql
ALTER TABLE case_events DROP PARTITION 202501;
```

Kelebihan:

- cepat,
- lebih murah,
- operasional jelas,
- mudah diaudit.

Kekurangan:

- harus yakin seluruh data dalam partition memang boleh dihapus,
- partition boundary harus sesuai retention semantics,
- ada risiko salah drop jika partition expression tidak dipahami.

---

## 16. Backfill dan Partition

Backfill adalah operasi mengisi ulang data historis.

Partition memengaruhi backfill secara besar.

### 16.1 Backfill yang Baik

Backfill idealnya dilakukan per partition boundary.

Contoh:

```text
Backfill January 2026
1. load into staging table
2. validate counts/checksums
3. swap/attach partition or insert into target
4. verify query output
5. mark complete
```

### 16.2 Kenapa Per Partition?

Karena partition memberi unit natural untuk:

- load,
- validate,
- compare,
- detach,
- drop,
- retry,
- rollback.

### 16.3 Anti-Pattern Backfill

Buruk:

```text
insert tiny batches across 3 years of daily partitions
```

Akibat:

- banyak old partitions aktif kembali,
- banyak part kecil,
- background merges terganggu,
- query historis bisa melambat,
- replication queue membengkak.

Lebih baik:

```text
backfill per month/day using large batches
```

atau:

```text
load to separate table -> validate -> exchange/attach partition
```

---

## 17. Partition Pruning: Contoh Konkret

Misalnya table:

```sql
CREATE TABLE api_requests
(
    tenant_id UInt64,
    request_time DateTime64(3),
    request_date Date MATERIALIZED toDate(request_time),
    service LowCardinality(String),
    endpoint LowCardinality(String),
    status_code UInt16,
    latency_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(request_date)
ORDER BY (tenant_id, service, endpoint, request_time);
```

Query A:

```sql
SELECT count()
FROM api_requests
WHERE request_date >= '2026-06-01'
  AND request_date <  '2026-07-01'
  AND tenant_id = 42
  AND service = 'case-api';
```

Bagus:

```text
partition pruning -> hanya 202606
sorting key       -> tenant_id/service membantu skip granule
column pruning    -> hanya kolom count/filter dibaca
```

Query B:

```sql
SELECT count()
FROM api_requests
WHERE tenant_id = 42;
```

Kurang bagus:

```text
partition pruning -> tidak ada, baca banyak bulan
sorting key       -> tenant_id membantu di dalam setiap part
```

Query C:

```sql
SELECT endpoint, quantile(0.95)(latency_ms)
FROM api_requests
WHERE request_date >= '2026-06-01'
  AND request_date <  '2026-06-02'
GROUP BY endpoint;
```

Partition monthly hanya membaca partition Juni, tetapi masih perlu scan subset besar dalam bulan itu. Jika query seperti ini sangat umum dan volume Juni besar, mungkin perlu:

- daily partition untuk log high-volume,
- sorting key dengan date/service/endpoint,
- materialized view rollup,
- projection,
- atau table khusus observability.

---

## 18. Partition dan Sorting Key Harus Saling Melengkapi

Desain umum yang sehat:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time, entity_id)
```

Interpretasi:

```text
PARTITION BY month
-> lifecycle bulanan, retention bulanan, pruning kasar berdasarkan waktu

ORDER BY tenant/event_type/time/entity
-> skip granule untuk query tenant/type/time
```

Desain lain:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_type, event_date, tenant_id, entity_id)
```

Cocok jika query utama cross-tenant per event type.

Desain lain:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (service, severity, event_time, trace_id)
```

Cocok untuk logs observability yang sering filter service/severity/time.

Yang perlu dihindari:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_time)
```

Jika query hampir selalu filter tenant, karena semua tenant bercampur dalam time order.

Juga hindari:

```sql
PARTITION BY tenant_id
ORDER BY (event_time)
```

jika tenant banyak dan retention berbasis waktu.

---

## 19. Should Partition Key Be Included in ORDER BY?

Tidak selalu.

Jika partition key adalah bulan:

```sql
PARTITION BY toYYYYMM(event_date)
```

apakah `event_date` harus ada di `ORDER BY`?

Jawaban:

```text
tergantung query pattern
```

Contoh:

```sql
ORDER BY (tenant_id, event_type, event_time)
```

Ini sudah menyertakan `event_time`, yang berkaitan dengan partition date.

Jika query selalu filter tenant + time, ini bagus.

Tetapi kalau `ORDER BY`:

```sql
ORDER BY (tenant_id, user_id)
```

Query time range di dalam partition mungkin tidak bisa skip granule berdasarkan waktu dengan baik.

Secara umum:

- partition key tidak wajib secara literal ada di sorting key,
- tetapi kolom waktu yang berkaitan dengan partition biasanya tetap perlu muncul di sorting key,
- posisi kolom waktu bergantung pada query pattern.

Contoh multi-tenant analytics:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time, case_id)
```

Contoh time-first observability:

```sql
PARTITION BY toYYYYMMDD(log_date)
ORDER BY (service, log_time, severity, trace_id)
```

Contoh cross-tenant compliance report:

```sql
PARTITION BY toYYYYMM(effective_date)
ORDER BY (jurisdiction, regulation_code, effective_time, case_id)
```

---

## 20. Active Partitions dan Insert Pattern

Partition strategy tidak bisa dipisahkan dari ingestion.

Pertanyaan penting:

> Dalam satu batch insert, berapa banyak partition yang disentuh?

Ideal:

```text
1 batch -> 1 atau sedikit partition
```

Buruk:

```text
1 batch -> ratusan partition
```

Contoh buruk:

```text
service menerima delayed events dari 180 hari terakhir
batch kecil setiap detik
partition by day
```

Akibat:

```text
setiap batch bisa menyentuh 180 partitions
```

Solusi:

- buffer dan group by partition sebelum insert,
- bulk load per date range,
- staging table partition by ingestion date,
- periodic re-sort/reload ke serving table,
- use async insert carefully,
- limit late arrival window,
- separate hot path and repair path.

---

## 21. Partition untuk Late Arriving Events

Late arriving events adalah event yang `event_time`-nya lama, tetapi baru datang sekarang.

Contoh:

```text
current date: 2026-06-21
received event_time: 2026-03-03
```

Jika partition by event month, row masuk partition `202603`.

Risiko:

- old partition jadi aktif lagi,
- TTL/merge behavior di old partition berubah,
- materialized view rollup historis perlu update,
- backfill/repair logic lebih kompleks.

Strategi:

### 21.1 Accept Late Writes

Cocok jika late events sedikit.

```text
partition by event month
late events inserted normally
background merges handle it
```

### 21.2 Separate Correction Stream

Cocok jika late/correction events signifikan.

```text
raw_events_by_ingestion
correction_events
serving_events_by_event_time
```

### 21.3 Rebuild Historical Partitions

Cocok untuk correctness tinggi.

```text
load corrected data for month -> validate -> replace partition
```

### 21.4 Use Versioned/Replacing Model

Jika event correction berupa new version, gunakan table design yang mendukung latest version semantics. Tetapi hati-hati dengan `FINAL` cost.

---

## 22. Partition untuk Regulatory / Case Lifecycle Analytics

Untuk domain case management/regulatory enforcement, partitioning perlu defensible karena data punya banyak time semantics.

Misalnya event:

```text
case_id
case_type
jurisdiction
regulated_entity_id
lifecycle_state
transition_type
event_time
effective_time
ingested_time
decision_time
actor_role
source_system
```

Pertanyaan desain:

1. Report resmi berbasis waktu apa?
2. Retention berbasis event occurrence atau ingestion?
3. Apakah correction diperbolehkan?
4. Apakah audit harus mempertahankan original ingestion sequence?
5. Apakah query utama per tenant/entity/jurisdiction/time?
6. Apakah data bisa dihapus per jurisdiction?
7. Apakah case closure memengaruhi retention?

### 22.1 Pattern A: Lifecycle Event Analytics

```sql
CREATE TABLE case_lifecycle_events
(
    tenant_id UInt64,
    jurisdiction LowCardinality(String),
    case_id UUID,
    regulated_entity_id UInt64,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    effective_time DateTime64(3),
    ingested_time DateTime64(3),
    from_state LowCardinality(String),
    to_state LowCardinality(String),
    transition_type LowCardinality(String),
    actor_role LowCardinality(String),
    source_system LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, jurisdiction, transition_type, event_time, case_id);
```

Cocok jika reporting utama berbasis event occurrence.

### 22.2 Pattern B: Ingestion Audit Trail

```sql
CREATE TABLE case_event_ingestion_audit
(
    tenant_id UInt64,
    ingested_time DateTime64(3),
    ingested_date Date MATERIALIZED toDate(ingested_time),
    source_system LowCardinality(String),
    source_offset String,
    case_id UUID,
    event_time DateTime64(3),
    payload String,
    validation_status LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ingested_date)
ORDER BY (tenant_id, source_system, ingested_time, source_offset);
```

Cocok untuk audit ingestion, replay, dan defensibility.

### 22.3 Kenapa Dua Table?

Karena satu table sulit optimal untuk dua semantics:

```text
analytics/reporting -> event/effective time
replay/audit        -> ingestion time
```

Memaksakan satu partition key untuk semua use case sering menghasilkan desain yang tidak optimal untuk keduanya.

---

## 23. Partition untuk Observability Logs

Logs biasanya:

- volume tinggi,
- retention pendek,
- query time-bounded,
- filter service/severity/trace_id,
- banyak string,
- high-cardinality attributes.

Contoh:

```sql
CREATE TABLE service_logs
(
    log_time DateTime64(3),
    log_date Date MATERIALIZED toDate(log_time),
    service LowCardinality(String),
    environment LowCardinality(String),
    severity LowCardinality(String),
    trace_id String,
    span_id String,
    message String,
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(log_date)
ORDER BY (service, environment, severity, log_time, trace_id)
TTL log_date + INTERVAL 14 DAY DELETE;
```

Daily partition masuk akal jika:

- volume per hari besar,
- retention 7–30 hari,
- drop harian natural,
- query sering per beberapa jam/hari.

Monthly partition mungkin terlalu besar untuk logs ber-volume tinggi dan short retention.

Hourly partition tetap harus hati-hati.

---

## 24. Partition untuk Metrics Time-Series

Metrics sering memiliki:

- timestamp,
- metric name,
- labels,
- numeric value,
- retention/downsampling.

Contoh raw metrics:

```sql
CREATE TABLE raw_metrics
(
    ts DateTime64(3),
    metric_date Date MATERIALIZED toDate(ts),
    metric_name LowCardinality(String),
    service LowCardinality(String),
    environment LowCardinality(String),
    labels Map(String, String),
    value Float64
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(metric_date)
ORDER BY (metric_name, service, environment, ts)
TTL metric_date + INTERVAL 14 DAY DELETE;
```

Untuk rollup metrics:

```sql
CREATE TABLE hourly_metrics
(
    bucket_start DateTime,
    bucket_date Date MATERIALIZED toDate(bucket_start),
    metric_name LowCardinality(String),
    service LowCardinality(String),
    environment LowCardinality(String),
    count UInt64,
    sum_value Float64,
    max_value Float64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(bucket_date)
ORDER BY (metric_name, service, environment, bucket_start);
```

Raw dan rollup bisa punya partition berbeda karena lifecycle berbeda.

---

## 25. Partition untuk Product/Event Analytics

Product analytics biasanya:

- event stream besar,
- tenant/org/user/project dimension,
- event type,
- session/user funnel,
- retention panjang,
- dashboard bulanan/kuartalan.

Contoh:

```sql
CREATE TABLE product_events
(
    org_id UInt64,
    user_id UInt64,
    session_id String,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    event_name LowCardinality(String),
    platform LowCardinality(String),
    country LowCardinality(String),
    properties Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (org_id, event_name, event_time, user_id);
```

Monthly partition biasanya bagus karena:

- retention panjang,
- query sering multi-day/multi-month,
- data volume per month manageable,
- lifecycle bulanan natural.

Daily partition hanya jika volume sangat besar atau retention/drop harian penting.

---

## 26. Partition untuk Snapshot Tables

Snapshot table menyimpan state pada waktu tertentu.

Contoh daily snapshot:

```sql
CREATE TABLE daily_case_snapshot
(
    snapshot_date Date,
    tenant_id UInt64,
    jurisdiction LowCardinality(String),
    case_id UUID,
    current_state LowCardinality(String),
    risk_level LowCardinality(String),
    assigned_team LowCardinality(String),
    age_days UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (tenant_id, jurisdiction, snapshot_date, current_state, case_id);
```

Jika snapshot dibuat harian, monthly partition tetap bisa cocok.

Jika snapshot sangat besar dan retention pendek, daily partition bisa dipertimbangkan.

---

## 27. Partition dan Materialized Views

Materialized view target table sering punya partition yang berbeda dari source table.

Raw events:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time, case_id)
```

Hourly aggregate:

```sql
PARTITION BY toYYYYMM(bucket_date)
ORDER BY (tenant_id, event_type, bucket_start)
```

Daily aggregate:

```sql
PARTITION BY toYYYY(bucket_date)
ORDER BY (tenant_id, event_type, bucket_date)
```

Kenapa berbeda?

Karena granularity dan lifecycle berbeda.

Raw data mungkin retention 13 bulan. Daily aggregate mungkin retention 7 tahun. Maka partition boundary-nya bisa berbeda.

---

## 28. Partition dan Distributed ClickHouse

Dalam cluster, ada konsep berbeda:

```text
partition -> grouping within table on each shard
shard     -> horizontal distribution across nodes
replica   -> copy of shard data
```

Jangan campur:

```text
PARTITION BY bukan SHARD BY
```

Distributed engine memiliki sharding expression. Itu berbeda dari partition expression pada local MergeTree table.

Contoh:

```sql
-- local table
CREATE TABLE events_local ON CLUSTER cluster
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    event_type LowCardinality(String),
    user_id UInt64
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/events_local', '{replica}')
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_time, user_id);

-- distributed table
CREATE TABLE events ON CLUSTER cluster AS events_local
ENGINE = Distributed(cluster, default, events_local, cityHash64(tenant_id));
```

Di sini:

```text
PARTITION BY toYYYYMM(event_date)
-> lifecycle per shard

cityHash64(tenant_id)
-> routing/distribution across shards
```

Partition tidak menggantikan sharding.

---

## 29. Decision Framework Memilih Partition Key

Gunakan urutan pertanyaan ini.

### Step 1 — Apa Lifecycle Boundary Data?

Tanya:

```text
Kapan data boleh dihapus?
Kapan data dipindah ke cold storage?
Kapan data di-backup/restore?
Kapan data di-rebuild?
```

Jika jawabannya bulanan, gunakan monthly partition.

Jika jawabannya harian dan volume besar, daily partition.

### Step 2 — Apa Query Time Range Umum?

Tanya:

```text
Apakah query sering filter by date/time?
Berapa range umum: hours, days, months, years?
```

Partition harus membantu range kasar, bukan menggantikan sorting key.

### Step 3 — Berapa Volume per Partition?

Partition terlalu kecil buruk. Partition terlalu besar bisa menyulitkan lifecycle.

Tanya:

```text
Berapa GB/TB per partition?
Berapa rows per partition?
Berapa parts per partition?
```

### Step 4 — Berapa Banyak Active Partitions?

Active partition adalah partition yang masih sering menerima insert.

Tanya:

```text
Apakah insert hanya ke current month/day?
Apakah late events menyentuh banyak old partitions?
Apakah replay menyentuh years of data?
```

### Step 5 — Apakah Partition Key High Cardinality?

Jika iya, berhenti dulu.

High-cardinality partition key biasanya berbahaya.

### Step 6 — Apakah Partition Membantu Operasi?

Partition yang baik membuat operasi lebih mudah:

```text
drop
move
backup
restore
backfill
validate
rebuild
```

Jika partition tidak membantu operasi dan tidak membantu query, mungkin tidak perlu partition khusus.

---

## 30. Practical Defaults

Gunakan default ini sebagai starting point, bukan hukum absolut.

### 30.1 General Event Analytics

```sql
PARTITION BY toYYYYMM(event_date)
```

### 30.2 High-Volume Logs with Short Retention

```sql
PARTITION BY toYYYYMMDD(log_date)
```

### 30.3 Metrics Raw Data with Short Retention

```sql
PARTITION BY toYYYYMMDD(metric_date)
```

### 30.4 Aggregated Metrics Long Retention

```sql
PARTITION BY toYYYYMM(bucket_date)
```

atau:

```sql
PARTITION BY toYYYY(bucket_date)
```

### 30.5 Regulatory Case Events

```sql
PARTITION BY toYYYYMM(event_date)
```

atau jika report resmi berbasis effective date:

```sql
PARTITION BY toYYYYMM(effective_date)
```

### 30.6 Ingestion Audit

```sql
PARTITION BY toYYYYMM(ingested_date)
```

### 30.7 Avoid by Default

Hindari kecuali ada alasan kuat:

```sql
PARTITION BY tenant_id
PARTITION BY user_id
PARTITION BY case_id
PARTITION BY event_type
PARTITION BY toStartOfHour(event_time)
PARTITION BY cityHash64(id) % N
PARTITION BY (tenant_id, toYYYYMMDD(date)) -- jika tenant banyak
```

---

## 31. SQL Examples: Good, Risky, Bad

### 31.1 Good: Monthly Lifecycle + Tenant-Aware Sorting

```sql
CREATE TABLE case_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    case_id UUID,
    transition_type LowCardinality(String),
    from_state LowCardinality(String),
    to_state LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, transition_type, event_time, case_id);
```

Good because:

```text
- lifecycle by month
- tenant queries supported by sorting key
- transition filtering supported
- time range still in sorting key
- partition count controlled
```

### 31.2 Good: Daily Logs with Short Retention

```sql
CREATE TABLE access_logs
(
    log_time DateTime64(3),
    log_date Date MATERIALIZED toDate(log_time),
    service LowCardinality(String),
    status_code UInt16,
    path String,
    latency_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(log_date)
ORDER BY (service, status_code, log_time)
TTL log_date + INTERVAL 14 DAY DELETE;
```

Good if volume is high and retention short.

### 31.3 Risky: Daily Partition for Low Volume Events

```sql
PARTITION BY toYYYYMMDD(event_date)
```

Risky if:

```text
- only a few MB/day
- retention years
- inserts often touch many days
- query often monthly/yearly
```

Monthly may be better.

### 31.4 Bad: Tenant Partition for Many Tenants

```sql
PARTITION BY tenant_id
ORDER BY (event_time)
```

Bad if tenant count is high.

Problems:

```text
- too many partitions
- retention by time hard
- old data drop expensive
- small tenant partitions
- time queries across tenant poor
```

### 31.5 Bad: Case ID Partition

```sql
PARTITION BY case_id
```

Usually disastrous.

Problems:

```text
- extremely high cardinality
- millions of partitions possible
- tiny partitions
- metadata explosion
- no lifecycle value
```

### 31.6 Bad: Hourly Partition Without Massive Volume

```sql
PARTITION BY toStartOfHour(event_time)
```

Problems:

```text
- thousands of partitions quickly
- merge fragmentation
- metadata overhead
- operational noise
```

---

## 32. How to Inspect Partition Health

Useful system tables:

```sql
SELECT
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE database = 'default'
  AND table = 'events'
  AND active
GROUP BY partition
ORDER BY partition DESC;
```

Look for:

```text
- too many parts per partition
- tiny partitions
- skewed partitions
- old partitions still receiving new parts
- partitions much larger than expected
- partitions with too many small parts
```

Inspect active partitions touched recently:

```sql
SELECT
    partition,
    max(modification_time) AS last_modified,
    count() AS active_parts,
    sum(rows) AS rows
FROM system.parts
WHERE database = 'default'
  AND table = 'events'
  AND active
GROUP BY partition
ORDER BY last_modified DESC;
```

If many old partitions have recent modification time, late events/backfill may be causing merge pressure.

Inspect part size distribution:

```sql
SELECT
    partition,
    count() AS parts,
    min(rows) AS min_rows,
    quantile(0.5)(rows) AS p50_rows,
    quantile(0.95)(rows) AS p95_rows,
    max(rows) AS max_rows,
    formatReadableSize(min(bytes_on_disk)) AS min_size,
    formatReadableSize(max(bytes_on_disk)) AS max_size
FROM system.parts
WHERE database = 'default'
  AND table = 'events'
  AND active
GROUP BY partition
ORDER BY parts DESC;
```

---

## 33. How to Test Partition Design Before Production

Do not choose partition key by intuition only.

### 33.1 Build Candidate Tables

Create variants:

```text
events_monthly_partition
events_daily_partition
events_ingestion_month_partition
```

Same schema except partition expression.

### 33.2 Load Realistic Data

Use realistic:

- volume,
- tenant distribution,
- time distribution,
- late events,
- event type cardinality,
- batch size,
- compression.

### 33.3 Run Real Query Set

Use query log or expected dashboard/API queries.

Measure:

```text
read_rows
read_bytes
result_rows
memory_usage
query_duration_ms
selected_parts
selected_marks
```

### 33.4 Test Operations

Test:

```text
DROP PARTITION
TTL behavior
backfill one month
late event insertion
mutation impact
backup/restore unit
```

### 33.5 Compare Part Health

Use `system.parts`.

A partition design that wins one query by 10% but creates 100x more parts may be worse.

---

## 34. Failure Modes

### 34.1 Too Many Parts

Symptoms:

```text
- insert latency increases
- background merges constantly running
- system.parts shows many active parts
- Too many parts error
- replication queue grows
```

Causes:

```text
- small inserts
- too many active partitions
- over-partitioning
- late events across many partitions
- insufficient merge capacity
```

### 34.2 TTL Not Deleting Fast Enough

Symptoms:

```text
- old data remains after TTL interval
- disk usage not dropping
- merges backlog
```

Causes:

```text
- TTL depends on background merges
- partition not aligned with TTL
- old parts not being merged
- too many parts
```

### 34.3 Slow Queries Despite Partitioning

Symptoms:

```text
- query filters partition key but still slow
- read_rows huge within selected partition
```

Causes:

```text
- partition too coarse for query
- sorting key misaligned
- high cardinality group by
- no pre-aggregation
- too many columns read
```

### 34.4 Backfill Breaks Production

Symptoms:

```text
- insert backlog
- merges backlog
- query latency spike
- old partitions become active
```

Causes:

```text
- tiny backfill batches
- backfill touches many partitions
- no staging table
- no throttling
```

### 34.5 Tenant Skew

Symptoms:

```text
- one tenant dominates partition size
- queries for large tenant slow
- shard imbalance if sharding by tenant
```

Partitioning alone does not solve tenant skew.

---

## 35. Production Checklist

Before choosing `PARTITION BY`, answer these:

```text
[ ] What is the retention policy?
[ ] Is retention based on event time, ingestion time, effective time, or another time?
[ ] What is the natural lifecycle unit: day, month, year, tenant, jurisdiction?
[ ] How many partitions will exist after 1 month, 1 year, 5 years?
[ ] How many partitions are actively written at once?
[ ] Can one insert batch touch many partitions?
[ ] Is the partition key low-cardinality enough?
[ ] Does the partition key align with TTL?
[ ] Does it make DROP PARTITION safe and meaningful?
[ ] Does it help backfill and validation?
[ ] Does it conflict with sorting key design?
[ ] Are query predicates aligned with partition expression?
[ ] What happens with late events?
[ ] What happens with correction/replay?
[ ] What happens during migration/backfill?
[ ] Have we tested with realistic data volume?
[ ] Have we inspected system.parts after load?
[ ] Do we have alerting for too many parts?
```

---

## 36. Strong Opinions, Weakly Held

Use these as default heuristics:

1. Start with monthly partition for general event analytics.
2. Use daily partition for high-volume logs/metrics with short retention.
3. Avoid hourly partition unless you can prove necessity.
4. Avoid tenant partition for many tenants.
5. Avoid partition by high-cardinality IDs.
6. Keep partition aligned with retention/lifecycle.
7. Use `ORDER BY` for query access path.
8. Use materialized views/projections/pre-aggregates for repeated expensive analytical shapes.
9. Design ingestion batching with partition strategy.
10. Validate with `system.parts`, not just query speed.

---

## 37. Exercises

### Exercise 1 — Product Events

You have product events:

```text
20 billion rows/year
retention: 3 years
query: org_id + event_name + date range
late events: up to 7 days
org count: 50,000
```

Choose:

```text
PARTITION BY ?
ORDER BY ?
```

Think about:

- tenant partition risk,
- monthly vs daily,
- late events,
- sorting key prefix.

Suggested direction:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (org_id, event_name, event_time, user_id)
```

Daily may be considered only if monthly partitions are too large operationally.

### Exercise 2 — Logs

You have service logs:

```text
5 TB/day
retention: 14 days
query: service + severity + last 1h/24h
late events: rare
```

Suggested direction:

```sql
PARTITION BY toYYYYMMDD(log_date)
ORDER BY (service, severity, log_time, trace_id)
TTL log_date + INTERVAL 14 DAY DELETE
```

### Exercise 3 — Case Lifecycle Audit

You have case lifecycle events:

```text
retention: 7 years
reports: monthly/quarterly/yearly
query: tenant + jurisdiction + transition_type + event date range
late corrections: possible
must preserve ingestion audit
```

Suggested direction:

```text
case_lifecycle_events:
  PARTITION BY toYYYYMM(event_date)
  ORDER BY (tenant_id, jurisdiction, transition_type, event_time, case_id)

case_ingestion_audit:
  PARTITION BY toYYYYMM(ingested_date)
  ORDER BY (tenant_id, source_system, ingested_time, source_offset)
```

### Exercise 4 — Bad Design Diagnosis

Given:

```sql
PARTITION BY (tenant_id, toYYYYMMDD(event_date))
ORDER BY (event_time)
```

Tenant count: 30,000.

Explain why this is bad.

Expected reasoning:

```text
- too many partitions
- tenant lifecycle likely not partition boundary
- ORDER BY ignores tenant access path benefit because tenant already overused in partition
- event_time only sorting mixes event types/entities
- high metadata/merge overhead
```

---

## 38. Summary

Partitioning in ClickHouse is powerful, but easy to misuse.

The most important distinction:

```text
PARTITION BY -> lifecycle/data management boundary
ORDER BY     -> physical query access path
```

Good partitioning helps:

- retention,
- TTL,
- drop partition,
- move partition,
- backfill,
- restore,
- query pruning for coarse ranges.

Bad partitioning causes:

- too many parts,
- merge backlog,
- metadata explosion,
- poor ingestion behavior,
- slow queries despite “partitioning”,
- fragile operations.

For most event analytics, a defensible starting point is:

```sql
PARTITION BY toYYYYMM(event_date)
```

For high-volume short-retention logs/metrics:

```sql
PARTITION BY toYYYYMMDD(event_date)
```

For regulatory/case analytics, choose partition time semantics carefully:

```text
event_time     -> reporting occurrence
effective_time -> legal/business effectiveness
ingested_time  -> audit/replay/debugging
```

When in doubt, ask:

> What data do I want to drop, move, rebuild, validate, or isolate as one operational unit?

That answer usually gives a better partition key than simply asking:

> What column appears in my WHERE clause?

---

## 39. What Comes Next

Part 009 will cover:

```text
Data Types, Compression, Encoding, and Storage Cost Engineering
```

We will go deeper into:

- how type choices affect storage and CPU,
- compression codecs,
- `LowCardinality`,
- `Nullable` overhead,
- `DateTime64`, `Decimal`, `UUID`, `String`, `Map`, JSON,
- storage cost analysis,
- and how to inspect real column sizes.

---

## 40. References

- ClickHouse Docs — Table partitions: https://clickhouse.com/docs/partitions
- ClickHouse Docs — Custom partitioning key: https://clickhouse.com/docs/engines/table-engines/mergetree-family/custom-partitioning-key
- ClickHouse Docs — MergeTree table engine: https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree
- ClickHouse Docs — Choosing a partitioning key: https://clickhouse.com/docs/best-practices/choosing-a-partitioning-key
- ClickHouse Docs — Manage data with TTL: https://clickhouse.com/docs/guides/developer/ttl
- ClickHouse Docs — Dropping partitions: https://clickhouse.com/docs/managing-data/drop_partition

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Sorting Key Design: The Most Important Performance Decision</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-009.md">Part 009 — Data Types, Compression, Encoding, and Storage Cost Engineering ➡️</a>
</div>
