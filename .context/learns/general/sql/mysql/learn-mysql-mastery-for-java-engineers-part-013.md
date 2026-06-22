# learn-mysql-mastery-for-java-engineers-part-013.md

# Part 013 — Query Execution Patterns: Joins, Sorting, Temp Tables, Filesort

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas optimizer MySQL: bagaimana MySQL memilih access path, join order, dan execution plan berdasarkan cost model, statistik, histogram, serta informasi index.

Bagian ini bergerak satu lapisan lebih konkret: **apa yang benar-benar terjadi ketika plan itu dieksekusi**.

Banyak engineer melihat query hanya sebagai teks SQL:

```sql
SELECT ...
FROM a
JOIN b ON ...
WHERE ...
ORDER BY ...
LIMIT ...;
```

Namun MySQL melihatnya sebagai rangkaian kerja fisik:

1. ambil row dari table pertama,
2. cari matching row di table berikutnya,
3. lakukan filter,
4. materialisasi intermediate result bila perlu,
5. sort bila perlu,
6. deduplicate bila perlu,
7. aggregate bila perlu,
8. kirim result ke client.

Di production, bottleneck besar sering muncul bukan karena query "salah syntax", tetapi karena pola eksekusinya membuat database harus:

- scan terlalu banyak row,
- melakukan nested loop jutaan kali,
- membuat temporary table besar,
- melakukan filesort,
- membaca row dari table utama padahal secondary index sudah dipakai,
- mengirim result terlalu besar ke Java service,
- atau membuat memory per-connection meledak karena sort/join/temp buffer.

Bagian ini akan membangun mental model untuk membaca query bukan sebagai string SQL, tetapi sebagai **pipeline kerja fisik**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membaca execution plan sebagai pola kerja, bukan sekadar daftar kolom `EXPLAIN`.
2. Memahami kenapa join di MySQL sering dominan berbasis nested-loop style execution.
3. Menilai kapan query menghasilkan intermediate result besar.
4. Membedakan `Using filesort` sebagai mekanisme sort, bukan berarti selalu memakai file disk.
5. Membedakan temporary table in-memory vs on-disk.
6. Memahami bagaimana `ORDER BY`, `GROUP BY`, `DISTINCT`, window function, derived table, dan CTE memengaruhi eksekusi.
7. Menghubungkan query buruk dengan pola yang sering dihasilkan ORM/JPA/Spring Data.
8. Mendesain query yang lebih stabil untuk workload production.

---

## 2. Mental Model Besar: Query Execution Adalah Pipeline

Bayangkan query execution sebagai pipeline:

```text
client request
   ↓
parse SQL
   ↓
resolve tables/columns/functions
   ↓
optimize plan
   ↓
execute access path
   ↓
join/filter/project/aggregate/sort
   ↓
return rows to client
```

Yang penting: **optimizer memilih plan, executor menjalankan plan**.

Optimizer bertanya:

> “Menurut statistik dan cost model, cara termurah mengeksekusi query ini apa?”

Executor bertanya:

> “Plan sudah dipilih. Sekarang bagaimana saya mengambil row, join, filter, sort, dan kirim hasil?”

Masalahnya, plan yang tampak kecil di teks SQL bisa menghasilkan kerja fisik besar.

Contoh:

```sql
SELECT c.id, c.case_no, p.name
FROM cases c
JOIN parties p ON p.case_id = c.id
WHERE c.status = 'OPEN'
ORDER BY p.name
LIMIT 50;
```

Tampak sederhana. Tetapi pertanyaan fisiknya:

- Berapa banyak `cases` dengan status `OPEN`?
- Apakah ada index `cases(status)`?
- Apakah ada index `parties(case_id)`?
- Apakah `ORDER BY p.name` bisa memakai index?
- Apakah MySQL harus join dulu semua row lalu sort?
- Apakah `LIMIT 50` bisa diterapkan awal, atau baru setelah sort?
- Apakah result sementara harus dimaterialisasi?

Dalam query tuning, pertanyaan seperti ini jauh lebih penting daripada “apakah query sudah pakai index”.

---

## 3. The Dangerous Illusion: LIMIT Tidak Selalu Membuat Query Murah

Banyak engineer berpikir:

```sql
LIMIT 50
```

berarti database hanya bekerja untuk 50 row.

Itu hanya benar bila plan bisa menemukan 50 row yang sudah memenuhi filter dan order tanpa memproses kandidat besar.

Contoh murah:

```sql
SELECT id, created_at, status
FROM cases
WHERE tenant_id = 42
ORDER BY created_at DESC
LIMIT 50;
```

Dengan index:

```sql
CREATE INDEX idx_cases_tenant_created
ON cases (tenant_id, created_at DESC);
```

MySQL dapat:

1. masuk ke range `tenant_id = 42`,
2. baca dari `created_at DESC`,
3. berhenti setelah 50 row.

Contoh mahal:

```sql
SELECT id, created_at, status
FROM cases
WHERE tenant_id = 42
ORDER BY priority DESC
LIMIT 50;
```

Jika index hanya `(tenant_id, created_at)`, database mungkin harus:

1. ambil seluruh row tenant 42,
2. sort berdasarkan `priority`,
3. baru ambil 50 teratas.

`LIMIT` hanya mengurangi jumlah row yang dikirim ke client, bukan otomatis mengurangi jumlah row yang harus diproses.

### Rule of thumb

`LIMIT` murah bila access path sudah sejalan dengan:

```text
WHERE equality prefix → ORDER BY columns → LIMIT stop early
```

`LIMIT` mahal bila database harus:

```text
collect many candidates → sort/group/deduplicate → limit
```

---

## 4. Join Execution in MySQL: Nested Loop Mental Model

Dalam banyak kasus, join MySQL dapat dipahami sebagai variasi nested-loop execution.

Secara konseptual:

```text
for each row in outer_table:
    find matching rows in inner_table
```

Contoh:

```sql
SELECT c.id, a.action_type
FROM cases c
JOIN enforcement_actions a ON a.case_id = c.id
WHERE c.tenant_id = 42
  AND c.status = 'OPEN';
```

Jika optimizer memilih `cases` sebagai outer table:

```text
1. cari cases dengan tenant_id=42 dan status=OPEN
2. untuk setiap case, cari enforcement_actions berdasarkan case_id
```

Kalau ada index:

```sql
CREATE INDEX idx_cases_tenant_status ON cases (tenant_id, status);
CREATE INDEX idx_actions_case_id ON enforcement_actions (case_id);
```

maka inner lookup relatif murah.

Tanpa `idx_actions_case_id`, pola menjadi fatal:

```text
for each matching case:
    scan enforcement_actions
```

Jika ada 20.000 case dan 5.000.000 action, ini bisa menjadi bencana.

---

## 5. Join Order: SQL Text Order Bukan Selalu Execution Order

SQL ini:

```sql
SELECT ...
FROM cases c
JOIN parties p ON p.case_id = c.id
JOIN obligations o ON o.case_id = c.id
WHERE o.due_date < CURRENT_DATE
  AND o.status = 'OVERDUE';
```

Tidak berarti MySQL selalu mulai dari `cases`.

Optimizer bisa memilih mulai dari `obligations` bila filter `o.status='OVERDUE'` dan `due_date` sangat selective.

Execution order mungkin:

```text
obligations → cases → parties
```

Bukan:

```text
cases → parties → obligations
```

Ini penting karena index yang dibutuhkan tergantung execution order.

Jika mulai dari `obligations`, maka index penting:

```sql
CREATE INDEX idx_obligations_status_due_case
ON obligations (status, due_date, case_id);
```

Lalu join ke `cases` dengan primary key.

Jika mulai dari `cases`, index berbeda mungkin lebih relevan.

### Kesimpulan

Jangan mendesain index hanya berdasarkan urutan table di SQL. Desain berdasarkan:

- selectivity filter,
- join cardinality,
- available access path,
- order/group requirement,
- dan plan aktual.

---

## 6. Join Cardinality: Satu Row Bisa Meledak Menjadi Banyak Row

Cardinality join menentukan apakah intermediate result tetap kecil atau meledak.

Contoh domain case-management:

```text
case
 ├─ parties
 ├─ documents
 ├─ notes
 ├─ obligations
 └─ enforcement_actions
```

Satu case bisa punya:

- 5 parties,
- 20 documents,
- 40 notes,
- 10 obligations,
- 8 actions.

Query naïf:

```sql
SELECT c.id, p.name, d.file_name, n.note_text, o.due_date, a.action_type
FROM cases c
LEFT JOIN parties p ON p.case_id = c.id
LEFT JOIN documents d ON d.case_id = c.id
LEFT JOIN notes n ON n.case_id = c.id
LEFT JOIN obligations o ON o.case_id = c.id
LEFT JOIN enforcement_actions a ON a.case_id = c.id
WHERE c.id = 1001;
```

Jumlah row hasil bisa menjadi perkalian:

```text
5 × 20 × 40 × 10 × 8 = 1,600,000 rows
```

Padahal hanya satu case.

Ini sering terjadi saat engineer mencoba “menghindari N+1” dengan melakukan satu query besar yang join semua child collection.

### Dalam ORM/JPA

Ini mirip masalah:

```java
@EntityGraph(attributePaths = {
    "parties",
    "documents",
    "notes",
    "obligations",
    "actions"
})
```

atau `JOIN FETCH` banyak collection sekaligus.

Masalahnya bukan hanya SQL lambat. Masalahnya adalah **cartesian multiplication across one-to-many relationships**.

### Solusi praktis

Untuk aggregate root besar:

1. Ambil parent case.
2. Ambil child collection dalam query terpisah per collection atau batch.
3. Gunakan `WHERE case_id IN (...)` untuk batch loading.
4. Hindari join-fetch banyak bag/list collection sekaligus.
5. Gunakan projection DTO untuk screen tertentu, bukan entity graph universal.

---

## 7. Join Buffer: Ketika Inner Lookup Tidak Bisa Efisien

MySQL memiliki mekanisme join buffer untuk beberapa pola join ketika lookup ke inner table tidak optimal.

Secara mental:

```text
collect rows from outer table into buffer
scan/probe inner table more efficiently than row-by-row naive scan
```

Namun join buffer bukan pengganti index yang benar.

Jika join predicate seperti ini:

```sql
ON p.case_id = c.id
```

dan `p.case_id` tidak punya index, join bisa tetap mahal walaupun ada join buffer.

### Rule

Untuk join antar table OLTP, foreign key side hampir selalu butuh index.

Contoh:

```sql
parties.case_id
obligations.case_id
documents.case_id
notes.case_id
case_events.case_id
```

Jika kolom tersebut sering dipakai untuk join, buat index.

```sql
CREATE INDEX idx_parties_case_id ON parties (case_id);
CREATE INDEX idx_obligations_case_id ON obligations (case_id);
CREATE INDEX idx_documents_case_id ON documents (case_id);
```

Foreign key constraint di InnoDB membutuhkan index yang sesuai pada child side. Namun jangan hanya bergantung pada implicit behavior. Jadikan index relation eksplisit dalam desain schema agar jelas untuk review dan tuning.

---

## 8. Sorting: ORDER BY yang Murah vs Mahal

`ORDER BY` murah bila bisa dipenuhi oleh urutan index.

Contoh:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = 42
ORDER BY created_at DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_tenant_created_desc
ON cases (tenant_id, created_at DESC);
```

Execution ideal:

```text
seek tenant_id=42 → read index in created_at desc order → stop at 50
```

Tidak perlu sort besar.

### ORDER BY mahal

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = 42
ORDER BY updated_by_user_name;
```

Jika `updated_by_user_name` tidak sejalan dengan access path, MySQL harus:

1. ambil semua row tenant 42,
2. masukkan sort buffer / temp structure,
3. sort,
4. return result.

### ORDER BY multi-column

```sql
ORDER BY status ASC, created_at DESC
```

Index yang cocok:

```sql
CREATE INDEX idx_cases_tenant_status_created
ON cases (tenant_id, status ASC, created_at DESC);
```

Tapi index ini hanya cocok bila filter dan order menggunakan prefix yang sejalan.

---

## 9. `Using filesort`: Nama yang Sering Menyesatkan

Dalam output `EXPLAIN`, kamu bisa melihat:

```text
Using filesort
```

Banyak orang langsung berpikir:

> “Oh, MySQL menulis file ke disk.”

Itu tidak selalu benar.

`filesort` adalah nama algoritma sorting MySQL ketika sort tidak bisa dipenuhi langsung oleh index. Sort bisa terjadi di memory atau bisa spill ke disk tergantung ukuran data, memory, tipe kolom, dan konfigurasi.

Jadi arti praktisnya:

> MySQL harus melakukan sort eksplisit, bukan membaca row dalam urutan index yang sudah sesuai.

`Using filesort` tidak selalu buruk. Buruk bila:

- jumlah candidate row besar,
- sort sering terjadi,
- sort memakai kolom besar,
- sort tidak dibatasi secara efektif,
- sort menyebabkan temp table disk,
- query ada di hot path OLTP.

### Contoh acceptable

```sql
SELECT id, title
FROM announcements
WHERE active = true
ORDER BY display_order
LIMIT 10;
```

Jika table kecil, filesort mungkin tidak masalah.

### Contoh berbahaya

```sql
SELECT id, case_no, summary
FROM cases
WHERE tenant_id = 42
ORDER BY last_activity_at DESC
LIMIT 100;
```

Jika tenant punya 10 juta case dan tidak ada index `(tenant_id, last_activity_at)`, filesort bisa sangat mahal.

---

## 10. Sort Buffer dan Memory Per Connection

Sort membutuhkan memory. MySQL punya buffer tertentu untuk operasi sort per session/per operation.

Hal yang sering dilupakan Java engineer:

> Banyak buffer MySQL bersifat per-connection atau per-operation, bukan global tunggal.

Jika aplikasi membuka terlalu banyak koneksi dan banyak query melakukan sort/temp/join besar secara bersamaan, memory database bisa naik drastis.

Contoh mental:

```text
200 active connections
× beberapa MB sort/join/temp buffer
= ratusan MB hingga beberapa GB transient memory
```

Connection pool sizing tidak bisa dipisahkan dari memory model MySQL.

Ini salah satu alasan mengapa menaikkan pool dari 30 ke 300 sering memperburuk latency, bukan memperbaiki.

---

## 11. Temporary Tables: Kapan MySQL Membuat Intermediate Result

MySQL dapat membuat temporary table untuk mengeksekusi query tertentu.

Pola yang sering menyebabkan temporary table:

- `GROUP BY`
- `DISTINCT`
- `ORDER BY` yang tidak sejalan dengan index
- derived table
- CTE yang dimaterialisasi
- union
- window functions
- beberapa bentuk aggregation

Contoh:

```sql
SELECT status, COUNT(*)
FROM cases
WHERE tenant_id = 42
GROUP BY status;
```

Jika index mendukung:

```sql
CREATE INDEX idx_cases_tenant_status
ON cases (tenant_id, status);
```

MySQL mungkin bisa aggregate lebih efisien berdasarkan urutan index.

Tanpa index yang cocok, MySQL mungkin harus scan candidate rows dan membangun temporary structure untuk grouping.

---

## 12. In-Memory Temporary Table vs On-Disk Temporary Table

Temporary table tidak selalu buruk. Yang berbahaya adalah:

- terlalu besar,
- terlalu sering,
- spill ke disk,
- memakai kolom besar,
- terjadi di query hot path,
- terjadi serentak dari banyak connection.

Temporary table dapat menjadi on-disk karena beberapa alasan, misalnya:

- ukuran melebihi limit memory temporary table,
- mengandung tipe data tertentu,
- operasi membutuhkan struktur disk-based,
- result intermediate terlalu besar.

### Dampak production

Jika query dashboard membuat banyak temp table disk, gejalanya bisa berupa:

- latency query naik,
- disk I/O naik,
- CPU naik karena sort/aggregation,
- throughput write turun karena I/O contention,
- replica lag naik bila query berat berjalan di replica.

---

## 13. GROUP BY Execution Pattern

Query:

```sql
SELECT officer_id, COUNT(*) AS open_cases
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
GROUP BY officer_id;
```

Pertanyaan fisik:

1. Bagaimana MySQL menemukan row tenant 42 status OPEN?
2. Apakah row sudah terurut berdasarkan `officer_id`?
3. Apakah aggregation bisa dilakukan sambil membaca index?
4. Apakah perlu temporary table?

Index mungkin:

```sql
CREATE INDEX idx_cases_tenant_status_officer
ON cases (tenant_id, status, officer_id);
```

Dengan index ini, row untuk tenant/status tertentu tersusun berdasarkan `officer_id`, sehingga grouping lebih natural.

Namun jika query juga butuh order lain:

```sql
ORDER BY open_cases DESC
```

maka hasil aggregate tetap harus diurutkan berdasarkan hasil `COUNT(*)`, yang tidak bisa langsung berasal dari index biasa.

---

## 14. DISTINCT Execution Pattern

`DISTINCT` sering terlihat harmless:

```sql
SELECT DISTINCT p.name
FROM parties p
JOIN cases c ON c.id = p.case_id
WHERE c.tenant_id = 42;
```

Namun `DISTINCT` berarti MySQL harus menghilangkan duplikasi.

Itu bisa membutuhkan:

- sorting,
- hashing/internal temp structure,
- temporary table,
- atau index order yang cocok.

Jika result candidate besar, `DISTINCT` bisa mahal.

### Anti-pattern umum

Developer menambahkan `DISTINCT` untuk “memperbaiki duplikasi” akibat join yang salah.

Contoh:

```sql
SELECT DISTINCT c.*
FROM cases c
JOIN parties p ON p.case_id = c.id
JOIN documents d ON d.case_id = c.id;
```

Masalah utamanya bukan kurang `DISTINCT`. Masalahnya adalah join menghasilkan multiplication.

`DISTINCT` hanya menutup gejala dengan biaya tambahan.

---

## 15. ORDER BY + GROUP BY + LIMIT: Kombinasi yang Sering Mahal

Contoh dashboard:

```sql
SELECT officer_id, COUNT(*) AS overdue_count
FROM obligations
WHERE tenant_id = 42
  AND status = 'OVERDUE'
GROUP BY officer_id
ORDER BY overdue_count DESC
LIMIT 10;
```

Banyak engineer berharap `LIMIT 10` membuat murah.

Namun database harus tahu top 10 berdasarkan `COUNT(*)`. Untuk tahu itu, ia harus menghitung group terlebih dahulu.

Pipeline:

```text
filter obligations
→ group by officer_id
→ count each group
→ sort groups by count desc
→ return top 10
```

Index bisa membantu filter dan grouping, tetapi `ORDER BY COUNT(*) DESC` tetap butuh sort atas hasil aggregate.

Untuk dashboard yang sering diakses, solusi mungkin bukan tuning query terus-menerus, melainkan:

- pre-aggregation,
- summary table,
- materialized read model,
- async projection,
- OLAP store,
- cache dengan invalidation yang jelas.

---

## 16. Window Functions: Powerful, But Not Free

MySQL mendukung window functions seperti:

```sql
SELECT
    case_id,
    event_type,
    created_at,
    ROW_NUMBER() OVER (
        PARTITION BY case_id
        ORDER BY created_at DESC
    ) AS rn
FROM case_events;
```

Window functions sangat berguna untuk:

- latest event per case,
- ranking,
- running totals,
- deduplication,
- selecting first/last record per group.

Namun window function sering membutuhkan:

- partitioning intermediate rows,
- sorting per partition atau global sort,
- temporary table.

Contoh “latest event per case”:

```sql
WITH ranked AS (
    SELECT
        case_id,
        event_type,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY case_id
            ORDER BY created_at DESC
        ) AS rn
    FROM case_events
    WHERE tenant_id = 42
)
SELECT *
FROM ranked
WHERE rn = 1;
```

Untuk table `case_events` besar, query ini bisa mahal.

Alternative design:

1. Maintain `cases.last_event_id`.
2. Maintain `cases.last_activity_at`.
3. Maintain projection table `case_latest_event`.
4. Use index `(tenant_id, case_id, created_at DESC)` bila query tetap dibutuhkan.

Window function bukan masalah. Masalahnya adalah memakai window function di hot path tanpa memahami volume dan sort cost.

---

## 17. Derived Tables: Query di FROM Clause

Derived table:

```sql
SELECT x.officer_id, x.open_count
FROM (
    SELECT officer_id, COUNT(*) AS open_count
    FROM cases
    WHERE status = 'OPEN'
    GROUP BY officer_id
) x
WHERE x.open_count > 100;
```

Derived table bisa:

- di-merge ke outer query oleh optimizer,
- atau dimaterialisasi sebagai intermediate table.

Materialisasi berarti MySQL menjalankan subquery, menyimpan hasil sementara, lalu query luar membaca hasil tersebut.

Ini bisa baik atau buruk.

Baik bila:

- derived result jauh lebih kecil,
- menghindari repeated computation,
- membuat logic lebih jelas dan optimizer dapat menangani.

Buruk bila:

- derived result sangat besar,
- filter outer seharusnya bisa didorong ke inner tetapi tidak terjadi,
- derived table kehilangan index fisik yang diperlukan,
- query nested membuat plan sulit diprediksi.

---

## 18. CTE: Bukan Selalu Optimization Boundary, Tapi Bisa Jadi Materialization Cost

Common Table Expression:

```sql
WITH open_cases AS (
    SELECT id, officer_id
    FROM cases
    WHERE tenant_id = 42
      AND status = 'OPEN'
)
SELECT officer_id, COUNT(*)
FROM open_cases
GROUP BY officer_id;
```

CTE membantu readability.

Namun secara performance, kamu harus memeriksa apakah CTE:

- di-merge/inlined,
- atau dimaterialisasi.

Jangan memakai CTE sebagai asumsi bahwa query pasti lebih cepat.

### CTE bagus untuk

- readability query kompleks,
- recursive query tertentu,
- membagi transformasi logis,
- menghindari duplikasi subquery.

### CTE berbahaya bila

- menghasilkan intermediate besar,
- dipakai berulang tanpa index intermediate yang cocok,
- membuat predicate pushdown gagal,
- dipakai untuk query hot path tanpa `EXPLAIN ANALYZE`.

---

## 19. Predicate Pushdown: Filter Sedini Mungkin

Predicate pushdown berarti filter didorong sedekat mungkin ke sumber data.

Contoh buruk:

```sql
SELECT *
FROM (
    SELECT c.*, p.name
    FROM cases c
    JOIN parties p ON p.case_id = c.id
) x
WHERE x.status = 'OPEN'
  AND x.tenant_id = 42;
```

Secara ideal, filter `tenant_id` dan `status` harus diterapkan sebelum join.

Bentuk lebih jelas:

```sql
SELECT c.*, p.name
FROM cases c
JOIN parties p ON p.case_id = c.id
WHERE c.tenant_id = 42
  AND c.status = 'OPEN';
```

Optimizer mungkin bisa melakukan pushdown sendiri, tetapi jangan menulis query dengan bentuk yang membuat filter terlambat tanpa alasan.

### Dalam ORM

Predicate pushdown sering gagal secara konseptual ketika aplikasi:

1. mengambil data besar dari database,
2. filter di Java stream,
3. baru mapping ke DTO.

Contoh buruk:

```java
repository.findAll().stream()
    .filter(c -> c.getTenantId().equals(tenantId))
    .filter(c -> c.getStatus() == OPEN)
    .toList();
```

Untuk data production, filter harus terjadi di database dengan index yang sesuai.

---

## 20. Projection: Jangan Ambil Kolom yang Tidak Dipakai

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = 42
ORDER BY created_at DESC
LIMIT 50;
```

Jika table `cases` punya kolom besar:

- `summary TEXT`,
- `payload JSON`,
- `resolution_note TEXT`,
- `internal_comment TEXT`,

maka `SELECT *` bisa mahal meski hanya 50 row.

Biayanya:

- row read lebih besar,
- network payload lebih besar,
- deserialization di driver lebih mahal,
- Java heap pressure naik,
- GC pressure naik,
- covering index tidak bisa dipakai secara optimal.

Lebih baik:

```sql
SELECT id, case_no, status, priority, created_at
FROM cases
WHERE tenant_id = 42
ORDER BY created_at DESC
LIMIT 50;
```

Untuk list screen, pakai projection/list DTO. Detail page baru ambil field besar.

### Java implication

Hati-hati dengan repository method yang mengembalikan entity penuh untuk semua use case.

```java
List<CaseEntity> findByTenantIdOrderByCreatedAtDesc(Long tenantId);
```

Mungkin lebih aman:

```java
List<CaseListItem> findCaseListItems(Long tenantId, Pageable pageable);
```

---

## 21. Covering Index and Execution Cost

Covering index terjadi ketika semua kolom yang dibutuhkan query tersedia di index.

Contoh:

```sql
SELECT id, status, created_at
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_tenant_status_created_id
ON cases (tenant_id, status, created_at DESC, id);
```

Jika query hanya butuh kolom dalam index, MySQL tidak perlu lookup ke clustered primary key untuk membaca full row.

Ini mengurangi:

- random I/O,
- buffer pool pressure,
- CPU,
- latency.

Namun jangan membuat semua index menjadi “covering super wide index”. Index lebar menaikkan:

- storage,
- write cost,
- memory pressure,
- page split cost,
- replication volume.

Covering index cocok untuk hot read path dengan projection kecil dan stabil.

---

## 22. Execution Pattern untuk Pagination

Offset pagination:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = 42
ORDER BY created_at DESC
LIMIT 50 OFFSET 100000;
```

Masalahnya:

```text
database harus melewati 100000 row dulu
baru return 50 row
```

Index membantu, tetapi tetap harus skip banyak entry.

Seek pagination:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = 42
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_tenant_created_id
ON cases (tenant_id, created_at DESC, id DESC);
```

Seek pagination membuat database langsung melanjutkan dari cursor terakhir.

Untuk UI production dengan data besar, seek pagination jauh lebih stabil daripada offset pagination.

---

## 23. Query Builder dan Optional Filter Explosion

UI search sering punya banyak optional filters:

- status,
- priority,
- officer,
- region,
- created date,
- due date,
- party name,
- violation type,
- risk score,
- assigned unit.

Naïve query builder:

```sql
SELECT ...
FROM cases c
WHERE (:status IS NULL OR c.status = :status)
  AND (:priority IS NULL OR c.priority = :priority)
  AND (:officerId IS NULL OR c.officer_id = :officerId)
  AND (:region IS NULL OR c.region = :region)
ORDER BY c.created_at DESC
LIMIT 50;
```

Masalah:

- OR pattern bisa mengurangi kemampuan optimizer memakai index secara optimal.
- Plan menjadi generik dan sulit diprediksi.
- Kombinasi filter terlalu banyak untuk satu index sempurna.
- Query yang tampak fleksibel bisa buruk untuk semua kasus.

Lebih baik:

1. Bangun SQL dinamis yang hanya memasukkan predicate aktif.
2. Identifikasi 5–10 search pattern paling penting.
3. Buat index untuk pattern yang benar-benar hot.
4. Batasi kombinasi filter bila perlu.
5. Pisahkan search advanced ke search engine/read model bila eksplosif.

---

## 24. ORM-Generated SQL: Bahaya yang Tidak Terlihat di Code Review Java

Code Java:

```java
caseRepository.findByStatusAndTenantIdOrderByCreatedAtDesc(
    Status.OPEN,
    tenantId,
    pageable
);
```

Tampak aman.

Tapi SQL aktual bisa berupa:

```sql
SELECT c.*
FROM cases c
WHERE c.status = ?
  AND c.tenant_id = ?
ORDER BY c.created_at DESC
LIMIT ?;
```

Jika `SELECT c.*` menarik kolom besar, atau index tidak sesuai, query bisa mahal.

Lebih buruk, untuk pagination JPA sering membuat count query:

```sql
SELECT COUNT(*)
FROM cases c
WHERE c.status = ?
  AND c.tenant_id = ?;
```

Untuk table besar, count query bisa menjadi bottleneck tersendiri.

### Checklist untuk ORM query

Untuk setiap repository method penting, tanyakan:

- SQL aktualnya apa?
- Ada count query otomatis?
- Ada join tersembunyi?
- Ada `SELECT *`?
- Ada fetch join collection?
- Ada N+1?
- Ada `DISTINCT` otomatis?
- Ada sort yang tidak didukung index?
- Query ini jalan berapa kali per request?

---

## 25. Count Query: Sering Diremehkan

Pagination umum:

```java
Page<CaseEntity> page = repository.findByStatus(status, pageable);
```

`Page` biasanya butuh:

1. query data page,
2. query total count.

Count query:

```sql
SELECT COUNT(*)
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN';
```

Jika filter tidak selective atau table sangat besar, count bisa mahal.

Alternatif:

- gunakan `Slice` daripada `Page` bila total count tidak wajib,
- tampilkan “showing next results” bukan total exact,
- maintain approximate count,
- maintain summary table,
- cache count dengan invalidation,
- gunakan count hanya untuk filter yang bounded.

Dalam regulatory/case-management system, exact total count kadang dibutuhkan untuk report formal. Namun untuk interactive UI, exact count di setiap request sering tidak perlu.

---

## 26. N+1 Query vs Monster Join: Dua Ekstrem yang Sama-Sama Buruk

N+1:

```text
1 query ambil 50 cases
50 query ambil parties per case
50 query ambil documents per case
50 query ambil obligations per case
```

Monster join:

```text
1 query join cases + parties + documents + obligations + notes + actions
```

Keduanya bisa buruk.

Solusi tengah:

```text
1 query ambil cases page
1 query ambil parties WHERE case_id IN (...)
1 query ambil obligations WHERE case_id IN (...)
1 query ambil latest action WHERE case_id IN (...)
```

Ini sering menjadi pattern terbaik untuk aggregate list/detail yang kompleks.

Dalam Java:

- gunakan batch fetching,
- DTO projection,
- repository method eksplisit,
- hindari lazy loading tak terkendali di serialization layer,
- jangan expose entity langsung ke JSON response.

---

## 27. Anti-Pattern: Function on Indexed Column

Query:

```sql
SELECT *
FROM cases
WHERE DATE(created_at) = '2026-06-22';
```

Jika index ada pada `created_at`, fungsi `DATE(created_at)` dapat membuat index sulit dipakai secara optimal untuk range seek.

Lebih baik:

```sql
SELECT *
FROM cases
WHERE created_at >= '2026-06-22 00:00:00'
  AND created_at <  '2026-06-23 00:00:00';
```

Mental model:

```text
indexed_column should remain searchable as range/equality
```

Bukan:

```text
function(indexed_column) = value
```

Kecuali kamu memang memakai functional index/generated column yang didesain untuk itu.

---

## 28. Anti-Pattern: Leading Wildcard LIKE

Query:

```sql
SELECT *
FROM parties
WHERE name LIKE '%corp%';
```

B-tree index pada `name` tidak bisa dipakai efektif untuk leading wildcard karena pencarian tidak punya prefix awal.

Query yang lebih index-friendly:

```sql
WHERE name LIKE 'corp%'
```

Namun untuk contains search, gunakan:

- full-text index bila cocok,
- external search engine,
- normalized search tokens,
- trigram-like auxiliary table custom bila benar-benar perlu,
- atau dedicated search read model.

Jangan memaksa MySQL B-tree menjadi search engine universal.

---

## 29. Anti-Pattern: Implicit Type Conversion

Contoh:

```sql
SELECT *
FROM cases
WHERE case_no = 12345;
```

Jika `case_no` adalah `VARCHAR`, MySQL mungkin melakukan implicit conversion. Ini dapat menyebabkan hasil tak terduga atau index tidak optimal.

Lebih baik:

```sql
WHERE case_no = '12345'
```

Dalam Java, pastikan binding parameter sesuai tipe database.

```java
preparedStatement.setString(1, caseNo);
```

bukan:

```java
preparedStatement.setLong(1, Long.parseLong(caseNo));
```

untuk kolom identifier tekstual.

---

## 30. Anti-Pattern: OR Across Different Columns

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = 42
  AND (case_no = 'C-001' OR external_ref = 'C-001' OR subject_name = 'C-001');
```

OR lintas kolom sering sulit dioptimalkan dengan satu index.

Alternatif:

1. Pecah menjadi `UNION ALL` dengan index berbeda.
2. Gunakan search table/token table.
3. Gunakan external search engine.
4. Buat explicit search endpoint per field.

Contoh:

```sql
SELECT id FROM cases WHERE tenant_id = 42 AND case_no = ?
UNION ALL
SELECT id FROM cases WHERE tenant_id = 42 AND external_ref = ?
UNION ALL
SELECT id FROM case_subjects WHERE tenant_id = 42 AND subject_name = ?;
```

Masing-masing branch bisa memakai index yang sesuai.

---

## 31. Anti-Pattern: Big `IN` List Tanpa Kontrol

Query:

```sql
SELECT *
FROM case_events
WHERE case_id IN (?, ?, ?, ..., ?);
```

`IN` list kecil sampai sedang sering OK.

Namun jika list sangat besar:

- SQL string besar,
- parsing cost naik,
- plan cost naik,
- network payload naik,
- memory naik,
- query bisa tidak stabil.

Alternatif:

- batch ukuran wajar,
- temporary table untuk IDs,
- staging table,
- join ke table filter,
- redesign data access.

Untuk Java batch loading, gunakan chunking.

```text
caseIds chunks of 500/1000 depending workload
```

Bukan satu query dengan 50.000 IDs.

---

## 32. Anti-Pattern: Sorting by Expression

Query:

```sql
ORDER BY COALESCE(last_activity_at, created_at) DESC
```

atau:

```sql
ORDER BY CASE
    WHEN priority = 'HIGH' THEN 1
    WHEN priority = 'MEDIUM' THEN 2
    ELSE 3
END
```

Sorting expression sering tidak bisa memakai index biasa.

Solusi:

- simpan derived sort key,
- gunakan generated column,
- buat functional index bila sesuai,
- desain enum/rank numeric column,
- pisahkan business ordering menjadi kolom eksplisit.

Contoh:

```sql
priority_rank TINYINT NOT NULL
```

lalu:

```sql
CREATE INDEX idx_cases_tenant_priority_created
ON cases (tenant_id, priority_rank, created_at DESC);
```

---

## 33. Query Execution dan Network Cost

Database execution bukan satu-satunya biaya.

Setelah row ditemukan, MySQL harus:

1. encode result ke protocol,
2. kirim lewat network,
3. Connector/J decode,
4. mapping ke Java object,
5. aplikasi serialize ke JSON bila API,
6. client menerima response.

Query ini:

```sql
SELECT *
FROM audit_events
WHERE case_id = ?
ORDER BY created_at DESC;
```

Jika case punya 200.000 audit event, database mungkin bisa membaca cepat dengan index. Tapi network dan Java heap bisa hancur.

Production rule:

> Query yang cepat di database belum tentu aman untuk aplikasi bila result set terlalu besar.

Selalu batasi result:

```sql
LIMIT
```

Gunakan pagination, streaming dengan hati-hati, atau export pipeline khusus untuk data besar.

---

## 34. Streaming Result Set: Bukan Solusi Universal

Connector/J mendukung pola streaming/fetching result untuk menghindari load semua row ke memory aplikasi.

Namun streaming result punya konsekuensi:

- connection tertahan lebih lama,
- transaction/read view bisa hidup lebih lama,
- server resource tertahan,
- failure di tengah stream harus ditangani,
- tidak cocok untuk request API biasa yang harus cepat,
- bisa mengganggu purge bila transaction panjang.

Gunakan streaming untuk:

- export job,
- ETL,
- background processing,
- bounded operational task.

Jangan gunakan streaming sebagai alasan untuk query tak terbatas di endpoint interaktif.

---

## 35. Practical EXPLAIN Reading for Execution Patterns

Saat melihat `EXPLAIN`, jangan hanya mencari `type = ALL`.

Cari sinyal:

```text
Using where
Using index
Using temporary
Using filesort
Using index condition
```

Dan lihat:

- table order,
- access type,
- possible keys,
- chosen key,
- key length,
- rows estimated,
- filtered percentage,
- Extra.

### Interpretasi umum

`Using index`:

- query bisa dilayani dari index saja, sering berarti covering index.

`Using where`:

- filter diterapkan setelah row ditemukan dari access path.

`Using index condition`:

- Index Condition Pushdown digunakan; sebagian filter dievaluasi di storage engine terhadap index.

`Using temporary`:

- MySQL membuat temporary table untuk intermediate result.

`Using filesort`:

- MySQL melakukan sort eksplisit, bukan memakai urutan index.

### Yang harus ditanyakan

Untuk setiap plan:

1. Dari table mana query mulai?
2. Berapa row yang diperkirakan dibaca?
3. Apakah row estimate masuk akal?
4. Apakah sort bisa dihindari dengan index yang tepat?
5. Apakah temp table wajar atau red flag?
6. Apakah `LIMIT` bisa stop early?
7. Apakah projection memungkinkan covering index?
8. Apakah join menyebabkan multiplication?

---

## 36. EXPLAIN ANALYZE: Membandingkan Estimasi vs Realitas

`EXPLAIN` memberi estimasi.

`EXPLAIN ANALYZE` menjalankan query dan memberi informasi runtime aktual.

Gunakan untuk menjawab:

- apakah row estimate salah besar?
- step mana paling mahal?
- apakah join loop terlalu banyak?
- apakah optimizer salah memilih driving table?
- apakah filter sebenarnya sangat selective?

Namun hati-hati:

> `EXPLAIN ANALYZE` mengeksekusi query.

Jangan sembarang menjalankannya pada query write atau query read berat di production tanpa kontrol.

Untuk query read, gunakan:

- environment staging dengan data representatif,
- replica observability,
- limit/scope aman,
- atau production session dengan kehati-hatian tinggi.

---

## 37. Case Study 1: Dashboard Query Lambat

### Query

```sql
SELECT officer_id, COUNT(*) AS open_count
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
GROUP BY officer_id
ORDER BY open_count DESC
LIMIT 10;
```

### Gejala

- dashboard lambat saat jam kerja,
- CPU database naik,
- slow query log menunjukkan query ini sering,
- `EXPLAIN` menunjukkan `Using temporary; Using filesort`.

### Analisis

Query harus:

```text
filter open cases
→ group by officer
→ count
→ sort by count desc
→ return top 10
```

Index dapat membantu filter/group:

```sql
CREATE INDEX idx_cases_tenant_status_officer
ON cases (tenant_id, status, officer_id);
```

Namun sorting by count tetap perlu.

### Solusi bertingkat

Level 1: index filter/group.

Level 2: batasi dashboard scope.

Level 3: cache hasil beberapa detik/menit.

Level 4: maintain summary table:

```sql
case_officer_summary(
    tenant_id,
    officer_id,
    open_count,
    overdue_count,
    high_priority_count,
    updated_at
)
```

Level 5: event-driven projection dari case state changes.

### Lesson

Tidak semua query dashboard harus diselesaikan dengan index. Kadang masalahnya adalah query membutuhkan agregasi real-time atas data besar.

---

## 38. Case Study 2: Search Screen Fleksibel Tapi Tidak Stabil

### Query

```sql
SELECT id, case_no, status, priority, created_at
FROM cases
WHERE tenant_id = 42
  AND (? IS NULL OR status = ?)
  AND (? IS NULL OR priority = ?)
  AND (? IS NULL OR officer_id = ?)
  AND (? IS NULL OR region = ?)
ORDER BY created_at DESC
LIMIT 50;
```

### Masalah

- Banyak OR optional.
- Plan sulit optimal untuk semua kombinasi.
- Index `(tenant_id, created_at)` membantu default list, tetapi tidak semua filter.
- Index untuk semua kombinasi tidak realistis.

### Solusi

1. Generate SQL hanya untuk filter aktif.
2. Pisahkan common query patterns:
   - default recent cases,
   - open by officer,
   - overdue by region,
   - high priority by status.
3. Buat index untuk pattern utama.
4. Untuk advanced search, gunakan batasan:
   - date range wajib,
   - max result window,
   - async export,
   - atau search engine.

### Lesson

Search fleksibel tanpa constraint sering menjadi denial-of-service internal.

---

## 39. Case Study 3: JPA Fetch Join Meledakkan Row

### Code

```java
@Query("""
    select distinct c
    from CaseEntity c
    left join fetch c.parties
    left join fetch c.documents
    left join fetch c.obligations
    where c.id = :id
""")
Optional<CaseEntity> findDetail(@Param("id") Long id);
```

### SQL effect

```text
case × parties × documents × obligations
```

Jika:

- 1 case,
- 8 parties,
- 30 documents,
- 12 obligations,

hasil join = 2.880 rows untuk satu case.

`distinct` di JPQL tidak menghapus biaya database join multiplication. Ia hanya membantu deduplicate entity di ORM layer atau SQL layer tergantung konfigurasi.

### Solusi

Ambil aggregate detail dalam beberapa query:

```text
query case header
query parties by case_id
query documents by case_id
query obligations by case_id
```

Atau gunakan DTO/projection khusus untuk section UI.

### Lesson

Menghindari N+1 dengan satu monster join sering mengganti satu masalah dengan masalah lain.

---

## 40. Case Study 4: Report Query Mengganggu OLTP

### Query

```sql
SELECT region, status, COUNT(*), AVG(days_open)
FROM cases
WHERE created_at >= '2026-01-01'
GROUP BY region, status
ORDER BY region, status;
```

### Gejala

- query report jalan 2 menit,
- application write latency naik,
- buffer pool churn,
- replica lag jika dijalankan di replica,
- temp table disk meningkat.

### Analisis

Query report membaca banyak row dan membuat aggregate besar. Walaupun read-only, ia tetap memakai CPU, I/O, memory, dan buffer pool.

### Solusi

- jalankan di reporting replica,
- jadwalkan di off-peak,
- summary table,
- OLAP store,
- partition pruning bila sesuai,
- export pipeline,
- throttle report.

### Lesson

Read query berat tetap bisa merusak OLTP performance.

---

## 41. Query Review Checklist

Gunakan checklist ini untuk query penting.

### 41.1 Shape

- Query ini untuk OLTP, dashboard, report, export, atau background job?
- Apakah butuh exact real-time result?
- Apakah query berada di request path user?
- Berapa kali dipanggil per request?
- Berapa QPS estimasi?

### 41.2 Access path

- Filter utama apa?
- Index mana yang dipakai?
- Apakah index sejalan dengan equality/range/order?
- Apakah access path bisa stop early dengan LIMIT?
- Apakah ada function di indexed column?

### 41.3 Join

- Table mana driving table?
- Apakah join key punya index?
- Apakah join one-to-many bisa multiply row?
- Apakah join sebenarnya hanya untuk existence check?
- Bisa diganti `EXISTS`?

### 41.4 Sort/group/temp

- Ada `ORDER BY`?
- Sort memakai index atau filesort?
- Ada `GROUP BY`?
- Ada `DISTINCT`?
- Ada `Using temporary`?
- Temporary result bounded atau bisa besar?

### 41.5 Projection/result

- Apakah `SELECT *`?
- Apakah menarik JSON/TEXT/BLOB?
- Apakah result set dibatasi?
- Apakah network payload besar?
- Apakah Java object mapping mahal?

### 41.6 Operational

- Apakah query aman di primary?
- Bisa dijalankan di replica?
- Apakah stale read acceptable?
- Ada timeout?
- Ada cancellation?
- Ada observability?

---

## 42. Design Heuristics

### 42.1 Untuk list screen

Gunakan:

```text
small projection + stable order + seek pagination + index matching filter/order
```

Hindari:

```text
SELECT * + offset besar + sort expression + join banyak collection
```

### 42.2 Untuk detail screen

Gunakan:

```text
parent query + bounded child queries
```

Hindari:

```text
monster join semua child collection
```

### 42.3 Untuk dashboard

Gunakan:

```text
summary/projection/cache bila aggregate besar atau sering
```

Hindari:

```text
GROUP BY real-time atas table OLTP besar setiap request
```

### 42.4 Untuk search fleksibel

Gunakan:

```text
query pattern inventory + dynamic SQL + index untuk pattern utama
```

Hindari:

```text
OR optional universal query untuk semua kombinasi
```

### 42.5 Untuk report/export

Gunakan:

```text
replica/reporting DB + chunking + async job + streaming hati-hati
```

Hindari:

```text
unbounded query dari request API
```

---

## 43. Java Engineer Practical Guidelines

### 43.1 Log SQL aktual

Jangan hanya percaya repository method name.

Pastikan kamu tahu SQL aktual:

- generated SQL,
- bind parameters,
- count query,
- join fetch,
- pagination query,
- batch query.

### 43.2 Pisahkan entity model dari read model

Entity cocok untuk transactional write model.

Read path sering butuh DTO projection.

```java
record CaseListItem(
    Long id,
    String caseNo,
    String status,
    String priority,
    Instant createdAt
) {}
```

Jangan memaksa semua screen memakai entity penuh.

### 43.3 Jangan biarkan serializer memicu lazy loading

Pattern buruk:

```java
return caseRepository.findById(id).orElseThrow();
```

lalu JSON serializer menyentuh lazy collections.

Gunakan service method eksplisit:

```java
CaseDetailDto getCaseDetail(Long id) {
    CaseHeader header = caseQueryRepository.findHeader(id);
    List<PartyDto> parties = partyRepository.findByCaseId(id);
    List<DocumentDto> documents = documentRepository.findByCaseId(id);
    return assemble(header, parties, documents);
}
```

### 43.4 Treat SQL as part of architecture

Untuk path penting, SQL bukan implementation detail ORM. SQL adalah bagian dari kontrak performa sistem.

Review SQL seperti review kode concurrency.

---

## 44. Common Red Flags in Code Review

Cari pola berikut:

```java
findAll()
```

di service production.

```java
Page<Entity>
```

untuk table besar tanpa mempertanyakan count query.

```java
JOIN FETCH
```

lebih dari satu collection.

```sql
SELECT *
```

untuk list API.

```sql
ORDER BY function(column)
```

di hot path.

```sql
LIKE '%keyword%'
```

pada table besar.

```sql
OFFSET 100000
```

untuk pagination data besar.

```sql
DISTINCT
```

untuk menutupi join multiplication.

```sql
GROUP BY ... ORDER BY COUNT(*) DESC
```

pada dashboard real-time besar.

```sql
WHERE (:param IS NULL OR column = :param)
```

untuk search fleksibel hot path.

---

## 45. Mini Lab: Membaca Query Sebagai Pipeline

Ambil query:

```sql
SELECT c.id, c.case_no, c.status, p.name, MAX(e.created_at) AS last_event_at
FROM cases c
JOIN parties p ON p.case_id = c.id
LEFT JOIN case_events e ON e.case_id = c.id
WHERE c.tenant_id = 42
  AND c.status = 'OPEN'
  AND p.role = 'RESPONDENT'
GROUP BY c.id, c.case_no, c.status, p.name
ORDER BY last_event_at DESC
LIMIT 50;
```

Pertanyaan:

1. Table mana sebaiknya driving table?
2. Index apa yang dibutuhkan di `cases`?
3. Index apa yang dibutuhkan di `parties`?
4. Index apa yang dibutuhkan di `case_events`?
5. Apakah `MAX(e.created_at)` membuat aggregate besar?
6. Apakah `ORDER BY last_event_at` bisa memakai index?
7. Apakah `LIMIT 50` bisa stop early?
8. Apakah lebih baik maintain `cases.last_event_at`?

Kemungkinan desain lebih baik:

```sql
SELECT c.id, c.case_no, c.status, p.name, c.last_event_at
FROM cases c
JOIN parties p ON p.case_id = c.id
WHERE c.tenant_id = 42
  AND c.status = 'OPEN'
  AND p.role = 'RESPONDENT'
ORDER BY c.last_event_at DESC
LIMIT 50;
```

Dengan index:

```sql
CREATE INDEX idx_cases_tenant_status_last_event
ON cases (tenant_id, status, last_event_at DESC, id);

CREATE INDEX idx_parties_case_role
ON parties (case_id, role);
```

Lesson:

> Kadang query tuning terbaik adalah memindahkan derived value ke model data yang lebih tepat.

---

## 46. Mental Model Final

Query execution bukan magic.

Setiap query akan membayar biaya dalam bentuk:

```text
rows read
+ index lookups
+ row lookups
+ join loops
+ intermediate rows
+ sort cost
+ temp table cost
+ network transfer
+ Java mapping cost
```

Tuning yang baik bukan sekadar “tambahkan index”.

Tuning yang baik bertanya:

1. Apakah query shape sesuai dengan workload?
2. Apakah index mendukung filter/order/join?
3. Apakah intermediate result terkendali?
4. Apakah aggregation/sort memang harus real-time?
5. Apakah Java layer meminta data yang tepat?
6. Apakah endpoint perlu exact result, approximate result, atau async result?

Top 1% engineer tidak hanya membaca `EXPLAIN`; ia menghubungkan query plan dengan:

- domain model,
- user journey,
- concurrency,
- operational risk,
- memory/I/O/network,
- dan failure mode production.

---

## 47. Ringkasan

Pada bagian ini kita mempelajari:

- query execution sebagai pipeline fisik,
- nested-loop mental model untuk join,
- join order dan cardinality explosion,
- sorting dan `Using filesort`,
- temporary table in-memory vs on-disk,
- `GROUP BY`, `DISTINCT`, `ORDER BY`, `LIMIT`, window function,
- derived table dan CTE,
- predicate pushdown,
- projection dan covering index,
- pagination execution,
- ORM-generated SQL pitfalls,
- count query cost,
- N+1 vs monster join,
- dan query review checklist.

Bagian ini menjadi fondasi untuk bagian berikutnya tentang **pagination, search, filtering, dan case-management query design**.

---

## 48. Status Seri

Seri belum selesai.

Kamu sekarang berada di:

```text
Part 013 / 034
```

Bagian berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-014.md
```

Judul:

```text
Pagination, Search, Filtering, and Case-Management Query Design
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — MySQL Optimizer: Cost Model, Statistics, and Execution Plans</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-014.md">Part 014 — Pagination, Search, Filtering, and Case-Management Query Design ➡️</a>
</div>
