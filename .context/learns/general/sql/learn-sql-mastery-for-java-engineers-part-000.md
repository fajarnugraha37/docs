# learn-sql-mastery-for-java-engineers-part-000.md

# Part 0 — Orientation: What It Means to Master SQL as a Java Engineer

> Seri: **SQL Mastery for Java Engineers**  
> Bagian: **000 / 034**  
> Status: **Fondasi awal — belum bagian terakhir**  
> Target pembaca: **Java software engineer yang ingin memahami SQL sampai level production-grade, architectural, dan defensible**

---

## 0. Ringkasan Eksekutif

SQL sering disalahpahami sebagai sekadar “bahasa untuk ambil data dari tabel”. Itu hanya permukaan.

Untuk engineer Java yang bekerja di sistem nyata, SQL adalah kombinasi dari beberapa hal sekaligus:

1. **Bahasa deklaratif** untuk menyatakan data apa yang diinginkan.
2. **Model relasional** untuk menyusun fakta, hubungan, dan aturan domain.
3. **Kontrak konsistensi** antara aplikasi dan database.
4. **Input bagi query optimizer** yang menentukan cara fisik data diakses.
5. **Boundary transaksi** untuk mengatur perubahan data secara aman.
6. **Mekanisme enforcement invariant** melalui constraint, foreign key, unique key, check, trigger, dan transaction isolation.
7. **Operational risk surface** karena query buruk, index salah, lock panjang, migrasi sembarangan, atau transaksi tidak terkendali bisa menjatuhkan sistem.
8. **Evidence layer** untuk sistem yang membutuhkan auditability, traceability, dan regulatory defensibility.

Engineer yang benar-benar menguasai SQL tidak hanya bisa menulis:

```sql
SELECT * FROM users WHERE id = 10;
```

Tetapi mampu menjawab pertanyaan seperti:

- Apakah query ini benar secara semantik?
- Apakah hasilnya stabil ketika data membesar 100x?
- Apakah join ini menggandakan baris secara tidak sengaja?
- Apakah index yang ada benar-benar membantu?
- Apakah transaksi ini aman dari lost update?
- Apakah constraint database cukup menjaga invariant domain?
- Apakah migration ini aman dijalankan di production?
- Apakah data historis bisa direkonstruksi untuk audit?
- Apakah desain schema ini akan tetap masuk akal saat kebutuhan reporting, workflow, SLA, escalation, dan retention bertambah?

Bagian 0 ini tidak bertujuan mengajarkan syntax SQL secara langsung. Tujuannya adalah membangun **kerangka berpikir** agar seluruh bagian berikutnya tidak dipahami sebagai kumpulan trik, tetapi sebagai satu sistem mental yang utuh.

---

## 1. Kenapa SQL Layak Dipelajari Sangat Serius

Banyak engineer modern menghabiskan banyak waktu mempelajari framework, message broker, container, cloud, API gateway, dan observability stack. Semua itu penting. Tetapi di banyak sistem bisnis, data tetap berada di database relasional.

Database relasional sering menjadi tempat paling permanen dari sebuah sistem:

- source of truth akun pengguna,
- source of truth transaksi,
- source of truth case,
- source of truth invoice,
- source of truth status workflow,
- source of truth audit trail,
- source of truth decision history,
- source of truth enforcement lifecycle,
- source of truth legal/regulatory evidence.

Kode aplikasi bisa di-refactor. Service bisa di-split. API bisa di-versioning. UI bisa diganti. Tetapi data yang salah, hilang, ambigu, atau tidak bisa direkonstruksi bisa menjadi kerusakan yang jauh lebih mahal.

Di sistem enterprise dan regulatori, SQL bukan hanya alat teknis. SQL adalah bahasa untuk menyatakan realitas bisnis dalam bentuk yang bisa diverifikasi.

Contoh sederhana:

```sql
CREATE TABLE enforcement_case (
    case_id BIGINT PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    CONSTRAINT closed_case_must_have_closed_at
        CHECK (
            (status <> 'CLOSED' AND closed_at IS NULL)
            OR
            (status = 'CLOSED' AND closed_at IS NOT NULL)
        )
);
```

Constraint di atas bukan sekadar syntax. Ia menyatakan aturan domain:

> Case yang sudah closed harus punya waktu penutupan, dan case yang belum closed tidak boleh punya waktu penutupan.

Aturan ini bisa ditulis di Java service layer. Tetapi bila hanya ditulis di Java, maka aturan itu bisa dilanggar oleh:

- batch job,
- migration script,
- admin console,
- data repair manual,
- service lain,
- import ETL,
- bug ORM,
- akses langsung database.

Ketika invariant domain penting, database sering menjadi tempat terakhir untuk mencegah data invalid masuk.

Itulah alasan SQL harus dipelajari bukan sebagai “syntax query”, tetapi sebagai alat desain sistem.

---

## 2. Posisi SQL dalam Karier Java Engineer

Sebagai Java engineer, Anda mungkin sering bertemu SQL melalui salah satu jalur ini:

1. JDBC langsung.
2. Spring JDBC / JdbcTemplate.
3. JPA / Hibernate.
4. jOOQ.
5. MyBatis.
6. Flyway / Liquibase migration.
7. Report query.
8. Incident debugging.
9. Data repair script.
10. Performance tuning.
11. Database schema review.
12. Production migration.
13. Audit/compliance investigation.

Masalahnya, banyak engineer hanya mempelajari SQL saat sedang “terpaksa”. Akibatnya pengetahuan SQL menjadi fragmentaris:

- tahu `SELECT`, tapi tidak paham join cardinality;
- tahu index, tapi tidak paham selectivity;
- tahu transaction, tapi tidak paham isolation anomaly;
- tahu Hibernate, tapi tidak paham SQL yang dihasilkannya;
- tahu migration, tapi tidak paham lock DDL;
- tahu pagination, tapi tidak paham kenapa `OFFSET` bisa memburuk;
- tahu `EXPLAIN`, tapi tidak tahu membaca cardinality estimation;
- tahu foreign key, tapi takut menggunakannya karena “takut lambat”;
- tahu soft delete, tapi tidak paham dampaknya pada uniqueness, retention, query, dan audit.

Seri ini mengambil posisi berbeda:

> Java engineer yang kuat harus mampu berpikir melintasi application layer dan database layer sebagai satu sistem konsistensi, performa, dan evolusi data.

SQL mastery bukan berarti semua logic harus dipindahkan ke database. Itu juga kesalahan. SQL mastery berarti tahu:

- logic mana yang sebaiknya di aplikasi,
- logic mana yang sebaiknya di database,
- logic mana yang harus diduplikasi sebagai defense-in-depth,
- logic mana yang tidak boleh tersebar tanpa ownership jelas.

---

## 3. SQL Bukan Sekadar Bahasa Query

Mari pecah SQL menjadi beberapa lensa.

### 3.1 SQL sebagai Bahasa Deklaratif

Dalam Java, Anda biasa menulis instruksi langkah demi langkah:

```java
List<Order> result = new ArrayList<>();
for (Order order : orders) {
    if (order.status() == Status.PAID && order.total().compareTo(minTotal) > 0) {
        result.add(order);
    }
}
result.sort(Comparator.comparing(Order::createdAt).reversed());
```

Di SQL, Anda menulis tujuan:

```sql
SELECT order_id, customer_id, total_amount, created_at
FROM orders
WHERE status = 'PAID'
  AND total_amount > 100000
ORDER BY created_at DESC;
```

SQL tidak meminta Anda menentukan apakah database harus:

- membaca tabel dari awal,
- memakai index,
- melakukan bitmap scan,
- melakukan nested loop join,
- melakukan hash join,
- melakukan sort di memory,
- melakukan parallel scan.

Anda menyatakan **relasi hasil** yang diinginkan. Database memilih cara fisiknya.

Inilah kekuatan dan jebakan SQL.

Kekuatannya: optimizer bisa memilih rencana eksekusi yang efisien berdasarkan statistik data.

Jebakannya: query yang terlihat sederhana bisa menghasilkan eksekusi mahal jika predicate, join, index, statistik, atau cardinality estimation buruk.

---

### 3.2 SQL sebagai Aljabar Relasional Praktis

SQL berakar dari relational model. Dalam praktik, SQL tidak identik 100% dengan relational algebra karena SQL memiliki:

- duplicate rows,
- `NULL`,
- ordering,
- vendor-specific behavior,
- procedural extensions,
- aggregate,
- window function,
- JSON support,
- recursive CTE,
- transaction syntax.

Tetapi mental model relasional tetap penting.

Operasi inti SQL bisa dipahami sebagai transformasi relasi:

| SQL | Mental Model |
|---|---|
| `SELECT columns` | projection |
| `WHERE predicate` | selection/filter |
| `JOIN` | combine related relations |
| `GROUP BY` | partition rows into groups |
| aggregate | reduce group into value |
| `HAVING` | filter groups |
| `UNION` | combine compatible result sets |
| `EXCEPT` | difference between result sets |
| `INTERSECT` | overlap between result sets |
| window function | compute value over related row window without collapsing rows |

Jika Anda memahami SQL sebagai transformasi relasi, query kompleks menjadi lebih masuk akal.

---

### 3.3 SQL sebagai Input untuk Optimizer

Saat Anda menulis query, database tidak langsung menjalankannya secara naif. Umumnya database akan melakukan beberapa tahap:

1. Parse SQL.
2. Validate object, column, type, permission.
3. Rewrite query jika ada rule/view/optimization tertentu.
4. Estimate cardinality.
5. Generate candidate plans.
6. Estimate cost.
7. Pick plan.
8. Execute.

Query ini:

```sql
SELECT c.customer_id, c.name, SUM(o.total_amount) AS total_spend
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE o.status = 'PAID'
GROUP BY c.customer_id, c.name
ORDER BY total_spend DESC
LIMIT 10;
```

Bagi manusia terlihat seperti “ambil 10 customer dengan belanja terbesar”.

Bagi optimizer, ini adalah masalah fisik:

- Mulai dari `orders` atau `customers`?
- Filter `status = 'PAID'` memakai index atau scan?
- Join pakai nested loop, hash join, atau merge join?
- Aggregate sebelum atau sesudah join?
- Sort semua hasil atau pakai top-N optimization?
- Apakah statistik status cukup akurat?
- Apakah distribusi `customer_id` skewed?

Karena itu SQL mastery mensyaratkan kemampuan membaca query sebagai deklarasi **dan** sebagai kemungkinan rencana eksekusi.

---

### 3.4 SQL sebagai Kontrak Konsistensi

Aplikasi Java bisa mengatur business logic. Tetapi database bisa mengatur invariant.

Contoh invariant:

- email harus unique,
- case number harus unique,
- invoice tidak boleh punya total negatif,
- child row tidak boleh menunjuk parent yang tidak ada,
- status tertentu mensyaratkan timestamp tertentu,
- assignment aktif hanya boleh satu per case,
- transition tidak boleh mundur ke state ilegal,
- satu user tidak boleh memiliki dua role aktif yang saling bertentangan.

Sebagian invariant bisa diekspresikan dengan:

- primary key,
- foreign key,
- unique constraint,
- check constraint,
- exclusion constraint,
- generated column,
- trigger,
- transaction isolation,
- locking strategy.

SQL mastery berarti tahu kapan constraint database adalah fitur desain, bukan hambatan.

---

### 3.5 SQL sebagai Boundary Transaksi

Dalam Java service, Anda sering melihat:

```java
@Transactional
public void approveCase(long caseId, long reviewerId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    c.approve(reviewerId);
    caseRepository.save(c);
    auditRepository.insertApprovalEvent(caseId, reviewerId);
}
```

Annotation `@Transactional` terlihat sederhana. Tetapi di baliknya ada pertanyaan serius:

- Transaction dimulai kapan?
- Connection dari pool diambil kapan?
- Isolation level apa?
- Apakah read pertama konsisten dengan read berikutnya?
- Apakah ada concurrent update?
- Apakah terjadi lost update?
- Apakah audit event bisa committed tanpa perubahan case?
- Apakah external call terjadi di dalam transaction?
- Apakah lock ditahan terlalu lama?
- Apa yang terjadi jika deadlock?
- Apakah retry aman?

Transaction adalah boundary antara dunia Java yang imperative dan dunia database yang konsisten secara terkontrol.

SQL mastery berarti Anda tidak menganggap transaction sebagai magic annotation.

---

### 3.6 SQL sebagai Operational Risk Surface

Database sering jatuh bukan karena query sintaksnya salah, tetapi karena query “benar” dijalankan dalam kondisi yang salah.

Contoh:

```sql
DELETE FROM audit_event
WHERE created_at < now() - interval '7 years';
```

Secara syntax benar. Secara bisnis mungkin benar. Tetapi secara operasi bisa berbahaya jika:

- menghapus jutaan row dalam satu transaksi,
- menahan lock terlalu lama,
- menghasilkan replication lag,
- mengisi WAL/binlog besar,
- memblokir query lain,
- menyebabkan vacuum pressure,
- tidak punya backup/restore plan,
- salah timezone,
- retention rule ternyata lebih kompleks.

SQL di production harus dipikirkan bersama:

- volume data,
- lock behavior,
- transaction duration,
- rollback cost,
- replication,
- backup,
- observability,
- migration safety,
- retry strategy,
- auditability.

---

## 4. Apa Artinya “Top 1%” dalam SQL untuk Java Engineer

“Top 1%” bukan berarti hafal semua dialect atau semua function vendor. Itu tidak realistis dan tidak perlu.

Dalam konteks engineer aplikasi/backend, top-tier SQL competence berarti memiliki kombinasi berikut.

### 4.1 Semantic Accuracy

Anda mampu memastikan query menjawab pertanyaan yang benar.

Contoh pertanyaan:

> Berapa jumlah case aktif per investigator?

Query salah yang umum:

```sql
SELECT investigator_id, COUNT(*)
FROM cases
WHERE status <> 'CLOSED'
GROUP BY investigator_id;
```

Mengapa bisa salah?

- Apakah `status <> 'CLOSED'` mengecualikan `NULL`?
- Apakah status `CANCELLED` dianggap aktif?
- Apakah case bisa punya multiple investigator assignment?
- Apakah investigator lama atau investigator aktif?
- Apakah reassignment history dihitung?
- Apakah case soft-deleted harus dikecualikan?
- Apakah timezone memengaruhi status efektif?

Top-tier SQL engineer tidak langsung menulis query. Ia menstabilkan definisi bisnis lebih dulu.

---

### 4.2 Relational Modelling Skill

Anda mampu mengubah domain menjadi schema yang menjaga kebenaran.

Contoh domain:

> Satu case bisa memiliki banyak allegation. Satu allegation bisa menghasilkan banyak enforcement action. Setiap action bisa punya appeal. Appeal bisa mengubah outcome action tetapi tidak menghapus action historis.

Engineer lemah mungkin membuat satu tabel besar:

```text
case_id, allegation_text, action_type, appeal_status, final_status, ...
```

Engineer kuat akan bertanya:

- Apa entity yang memiliki identity?
- Apa fakta yang immutable?
- Apa yang temporal?
- Apa yang derived?
- Apa relationship cardinality-nya?
- Apa invariant yang harus dijaga?
- Apa query utama?
- Apa retention/audit requirement?
- Apa lifecycle state-nya?

---

### 4.3 Query Reasoning Skill

Anda mampu membaca query kompleks dan memprediksi risiko.

Misalnya:

```sql
SELECT c.case_id, COUNT(e.evidence_id) AS evidence_count
FROM cases c
LEFT JOIN allegations a ON a.case_id = c.case_id
LEFT JOIN evidence e ON e.allegation_id = a.allegation_id
WHERE c.status = 'OPEN'
GROUP BY c.case_id;
```

Pertanyaan yang harus muncul:

- Apakah evidence terkait allegation atau bisa terkait case langsung?
- Apakah join ini menggandakan evidence jika ada relationship lain?
- Apakah `COUNT(e.evidence_id)` sudah benar untuk `LEFT JOIN`?
- Apakah open case tanpa allegation tetap muncul?
- Apakah filter di `WHERE` mengubah outer join menjadi inner join?
- Apakah index mendukung join path?

---

### 4.4 Execution Awareness

Anda tidak hanya bertanya “apakah query berhasil?”, tetapi:

- berapa row yang diproses?
- berapa row yang dikembalikan?
- apakah ada sort besar?
- apakah ada scan besar?
- apakah join order masuk akal?
- apakah estimasi row meleset jauh?
- apakah query CPU-bound atau I/O-bound?
- apakah query menunggu lock?
- apakah query menghasilkan temp file?
- apakah query bisa memburuk saat data tumbuh?

---

### 4.5 Transaction and Concurrency Awareness

Anda memahami bahwa correctness tidak hanya soal single-threaded logic.

Contoh bug klasik:

```java
@Transactional
public void assignCase(long caseId, long investigatorId) {
    if (!assignmentRepository.hasActiveAssignment(caseId)) {
        assignmentRepository.insert(caseId, investigatorId);
    }
}
```

Di bawah concurrency, dua request bisa sama-sama melihat belum ada assignment aktif lalu sama-sama insert.

Solusi top-tier bukan sekadar `synchronized` di Java, karena aplikasi bisa berjalan di banyak instance. Solusi harus melibatkan database:

- unique constraint parsial,
- transaction isolation,
- row locking,
- idempotency key,
- retryable failure handling.

---

### 4.6 Migration Discipline

Top-tier SQL engineer tahu bahwa schema berubah dalam sistem hidup.

Ia memahami pola:

1. Expand: tambah struktur baru tanpa merusak kode lama.
2. Backfill: isi data lama secara aman.
3. Dual write atau compatibility period bila perlu.
4. Switch read path.
5. Contract: hapus struktur lama setelah aman.

Ia tidak menjalankan migration berisiko besar tanpa memikirkan:

- lock,
- table size,
- index build,
- rollback,
- replication lag,
- application compatibility,
- deploy order,
- observability.

---

### 4.7 Ability to Debug Production Incidents

Saat latency naik, top-tier engineer bisa menelusuri:

- query mana yang lambat,
- apakah lambat karena plan berubah,
- apakah statistik stale,
- apakah index hilang/tidak dipakai,
- apakah ada lock wait,
- apakah connection pool exhausted,
- apakah ORM menghasilkan N+1 query,
- apakah transaction terlalu panjang,
- apakah batch job mengganggu workload online,
- apakah replica lag membuat read-your-write rusak.

SQL mastery sangat terlihat saat incident.

---

## 5. Perbedaan “Bisa SQL” vs “Menguasai SQL”

| Level | Karakteristik |
|---|---|
| Pemula | Bisa `SELECT`, `WHERE`, `ORDER BY`, `JOIN` dasar |
| Junior capable | Bisa CRUD, join, group by, query aplikasi biasa |
| Intermediate | Mengerti index dasar, transaksi dasar, constraint, migration |
| Senior | Bisa desain schema, membaca execution plan, menghindari concurrency bug |
| Staff/Principal-level | Bisa menghubungkan SQL dengan architecture, domain invariants, operability, migration strategy, auditability, dan organizational risk |

Seri ini ditulis untuk bergerak dari “bisa SQL” menuju “mampu membuat keputusan engineering dengan SQL”.

---

## 6. Mental Model Utama Seri Ini

Bagian ini penting. Simpan sebagai peta utama.

### 6.1 Table Bukan Class

Java class biasanya memodelkan behavior dan state lokal.

```java
class Case {
    private CaseId id;
    private CaseStatus status;
    private List<Allegation> allegations;

    void close() { ... }
}
```

Table memodelkan kumpulan fakta.

```sql
CREATE TABLE cases (
    case_id BIGINT PRIMARY KEY,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL
);
```

Jika Anda memaksa table menjadi cermin 1:1 dari object graph, Anda sering mendapat desain buruk:

- terlalu banyak nullable columns,
- nested object dipaksa jadi JSON tanpa alasan,
- relationship kabur,
- constraint lemah,
- query reporting sulit,
- update anomaly,
- duplication.

Relational design tidak bertanya “object saya bentuknya apa?”, tetapi:

- fakta apa yang benar?
- entity apa yang punya identity?
- dependency apa yang ada?
- relationship apa yang perlu dijaga?
- invariant apa yang tidak boleh dilanggar?
- history apa yang harus dipertahankan?

---

### 6.2 Row Bukan Object Instance Biasa

Object instance hidup di memory, punya identity runtime, dan bisa berubah sebelum disimpan.

Row adalah fakta persistensi yang berada di bawah aturan database:

- constraint,
- transaction,
- isolation,
- lock,
- visibility,
- index,
- referential integrity.

Dua object Java bisa menunjuk data yang sama dengan versi berbeda jika persistence context berbeda. Dua transaction bisa melihat snapshot berbeda. Row yang sama bisa terlihat berbeda tergantung isolation level dan waktu baca.

Karena itu jangan menganggap database sebagai `Map<Long, Object>`.

---

### 6.3 Query Bukan Loop

Engineer Java sering membaca SQL seperti loop:

```sql
SELECT *
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
WHERE o.status = 'PAID';
```

Mereka membayangkan:

> Loop orders, cari customer satu-satu, filter status.

Kadang eksekusinya memang mirip nested loop. Tetapi database bisa memilih strategi lain:

- filter orders lebih dulu,
- scan customers lebih dulu,
- hash customers,
- hash orders,
- merge join,
- parallel scan,
- use index-only scan,
- push predicate,
- reorder joins.

SQL adalah deklarasi relasional. Loop hanya salah satu kemungkinan fisik.

---

### 6.4 Index Bukan Magic Speed Button

Index mempercepat akses tertentu dengan biaya:

- memperlambat write,
- memakai storage,
- butuh maintenance,
- bisa menjadi bloat,
- bisa tidak dipakai optimizer,
- bisa salah urutan kolom,
- bisa memperburuk plan jika statistik salah.

Index harus dirancang dari workload:

- query apa paling penting?
- predicate apa paling selektif?
- join path apa sering dipakai?
- ordering apa sering diminta?
- apakah query bisa index-only?
- apakah write rate tinggi?
- apakah data skewed?
- apakah partial index lebih tepat?

---

### 6.5 Transaction Bukan Sekadar Annotation

`@Transactional` bukan jaminan semua race condition hilang.

Transaction harus dilihat sebagai:

- boundary atomicity,
- visibility rule,
- lock scope,
- failure unit,
- retry unit,
- consistency mechanism.

Transaction yang salah bisa menyebabkan:

- lost update,
- duplicate assignment,
- stale decision,
- deadlock,
- lock contention,
- connection pool exhaustion,
- long rollback,
- inconsistent external side effect.

---

### 6.6 Constraint Bukan Hambatan, Constraint Adalah Desain

Banyak tim menghindari constraint karena merasa aplikasi sudah melakukan validasi.

Masalahnya, aplikasi bukan satu-satunya penulis data.

Data bisa berubah melalui:

- service lain,
- migration,
- ETL,
- admin script,
- repair script,
- integration job,
- direct database access,
- legacy system,
- manual operation.

Constraint membuat database ikut menjaga domain.

Constraint yang baik membuat invalid state sulit atau mustahil terjadi.

---

### 6.7 Schema Adalah API Internal yang Paling Persisten

API HTTP bisa versioned dan deprecated. Class Java bisa diganti. Tetapi schema database sering hidup bertahun-tahun.

Schema memengaruhi:

- aplikasi,
- query report,
- migration,
- data warehouse,
- audit,
- analytics,
- support operation,
- compliance,
- future feature.

Karena itu schema design harus diperlakukan sebagai keputusan arsitektural.

---

## 7. SQL dalam Arsitektur Sistem Modern

### 7.1 SQL dalam Monolith

Dalam monolith, database sering menjadi satu pusat data. Keuntungannya:

- transaksi lebih mudah,
- join lintas domain lebih langsung,
- konsistensi lebih kuat,
- schema ownership lebih terpusat.

Risikonya:

- schema menjadi terlalu besar,
- module boundary kabur,
- query lintas module liar,
- migration makin sulit,
- semua orang menyentuh tabel semua orang.

SQL mastery dalam monolith berarti mampu menjaga modularitas database:

- schema per bounded context,
- ownership tabel jelas,
- view sebagai contract bila perlu,
- constraint tetap kuat,
- migration disiplin,
- query lintas boundary dikontrol.

---

### 7.2 SQL dalam Microservices

Dalam microservices, prinsip umum adalah service memiliki database-nya sendiri. Tetapi realitas sering lebih kompleks.

Masalah yang muncul:

- distributed transaction sulit,
- join lintas service tidak bisa langsung,
- data duplication diperlukan,
- eventual consistency muncul,
- reporting butuh read model,
- referential integrity lintas service tidak bisa dijaga foreign key,
- migration antar service harus dikoordinasi lewat contract/event.

SQL mastery di microservices berarti tahu batasnya:

- SQL kuat di dalam service boundary,
- SQL bukan solusi join lintas ownership sembarangan,
- outbox/inbox pattern sering dibutuhkan,
- idempotency penting,
- read model harus dirancang,
- consistency expectation harus eksplisit.

---

### 7.3 SQL dalam Event-Driven Systems

Event-driven architecture sering tetap memakai SQL untuk:

- outbox table,
- inbox deduplication,
- projection/read model,
- event store sederhana,
- materialized view,
- offset tracking,
- replay status,
- poison message tracking.

Contoh outbox sederhana:

```sql
CREATE TABLE outbox_event (
    outbox_event_id BIGSERIAL PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);
```

Top-tier engineer akan bertanya:

- Bagaimana menjamin event ditulis atomik bersama perubahan state?
- Bagaimana publisher memilih event tanpa double-publish?
- Bagaimana retry dilakukan?
- Bagaimana idempotency consumer dijaga?
- Bagaimana cleanup outbox dilakukan?
- Bagaimana replay?
- Bagaimana ordering per aggregate?

---

### 7.4 SQL dalam Regulatory / Case Management Systems

Dalam sistem case management, enforcement, compliance, investigation, atau regulatory lifecycle, SQL sering sangat cocok karena domainnya penuh dengan:

- entity jelas,
- relationship eksplisit,
- state lifecycle,
- audit trail,
- effective dates,
- assignments,
- evidence,
- parties,
- decisions,
- appeals,
- escalation,
- SLA,
- reporting,
- defensibility.

Di domain seperti ini, desain SQL yang baik harus mampu menjawab:

- Apa status case sekarang?
- Bagaimana status itu berubah?
- Siapa yang mengubahnya?
- Berdasarkan evidence apa?
- Keputusan apa yang dibuat?
- Apakah SLA dilanggar?
- Apakah assignment sah pada waktu itu?
- Apakah action bisa dipertanggungjawabkan?
- Apakah data historis berubah atau hanya ditambahkan?
- Apakah kita bisa membuktikan chain of custody?

SQL bukan hanya storage. SQL menjadi representasi formal dari proses bisnis.

---

## 8. Kesalahan Umum Java Engineer Saat Menggunakan SQL

### 8.1 Mengandalkan ORM Tanpa Memahami SQL

Hibernate/JPA bisa sangat produktif. Tetapi ORM tidak menghapus kebutuhan memahami SQL.

Masalah umum:

- N+1 query,
- lazy loading tidak terkontrol,
- fetch join menggandakan data,
- pagination dengan collection fetch,
- dirty checking tidak disadari,
- flush timing mengejutkan,
- transaction terlalu panjang,
- generated SQL tidak optimal,
- query tidak memakai index,
- batch insert tidak aktif,
- entity graph terlalu besar,
- object identity dikira sama dengan database identity.

Prinsipnya:

> ORM adalah abstraction. SQL adalah realitas yang tetap dieksekusi.

---

### 8.2 Menggunakan `SELECT *`

`SELECT *` nyaman untuk eksplorasi, tetapi buruk untuk banyak kode aplikasi production.

Risikonya:

- over-fetching,
- coupling ke schema,
- perubahan kolom bisa memengaruhi payload,
- index-only scan sulit,
- network overhead,
- memory overhead,
- data sensitif ikut terbaca,
- query review kurang eksplisit.

Lebih baik tulis kolom yang benar-benar dibutuhkan:

```sql
SELECT case_id, case_number, status, opened_at
FROM enforcement_case
WHERE investigator_id = ?
ORDER BY opened_at DESC;
```

---

### 8.3 Salah Memahami `NULL`

`NULL` bukan string kosong, bukan nol, bukan false. `NULL` berarti unknown / not applicable / missing, tergantung model.

Bug umum:

```sql
WHERE closed_at = NULL
```

Seharusnya:

```sql
WHERE closed_at IS NULL
```

Bug lain:

```sql
WHERE status NOT IN ('CLOSED', NULL)
```

Tiga-valued logic membuat hasil bisa tidak seperti dugaan.

---

### 8.4 Join Tanpa Memahami Cardinality

Jika satu case punya banyak allegations dan satu allegation punya banyak evidence, join bisa menggandakan row.

Contoh:

```sql
SELECT c.case_id, COUNT(*)
FROM cases c
JOIN allegations a ON a.case_id = c.case_id
JOIN evidence e ON e.allegation_id = a.allegation_id
GROUP BY c.case_id;
```

`COUNT(*)` di sini menghitung kombinasi hasil join, bukan selalu “jumlah case” atau “jumlah allegation”.

Top-tier SQL engineer selalu bertanya:

- grain hasil query apa?
- satu row output merepresentasikan apa?
- join ini 1:1, 1:N, atau M:N?
- aggregate dilakukan di level mana?

---

### 8.5 Mengira Index Selalu Dipakai

Membuat index tidak berarti optimizer akan menggunakannya.

Index mungkin tidak dipakai karena:

- predicate tidak selective,
- query mengambil terlalu banyak row,
- fungsi diterapkan pada kolom,
- tipe data tidak cocok,
- statistik tidak akurat,
- urutan composite index salah,
- collation berbeda,
- parameter sniffing/plan caching issue,
- cost scan lebih murah.

---

### 8.6 Menggunakan Offset Pagination untuk Semua Kasus

Pagination umum:

```sql
SELECT *
FROM orders
ORDER BY created_at DESC
LIMIT 50 OFFSET 100000;
```

Masalah:

- database tetap harus melewati banyak row,
- hasil bisa tidak stabil jika data berubah,
- semakin jauh halaman semakin mahal,
- butuh deterministic order.

Untuk infinite scroll atau feed besar, keyset pagination sering lebih baik:

```sql
SELECT order_id, created_at, total_amount
FROM orders
WHERE (created_at, order_id) < (?, ?)
ORDER BY created_at DESC, order_id DESC
LIMIT 50;
```

---

### 8.7 Transaction Terlalu Lama

Transaction panjang bisa menahan lock, memperbesar konflik, memperlambat vacuum/cleanup, dan menghabiskan connection pool.

Anti-pattern:

```java
@Transactional
public void processCase(long caseId) {
    Case c = repository.load(caseId);
    externalFraudService.call(c); // external call di dalam transaction
    c.markReviewed();
    repository.save(c);
}
```

External call bisa lambat, timeout, atau retry. Selama itu transaction terbuka.

Lebih baik pisahkan boundary jika memungkinkan:

- baca data minimal,
- commit,
- external call,
- buka transaction baru untuk update dengan concurrency guard.

Tentu desain detail tergantung consistency requirement.

---

### 8.8 Migration Tanpa Memikirkan Production Data

Migration yang aman di local belum tentu aman di production.

Contoh:

```sql
ALTER TABLE large_table ADD COLUMN new_col TEXT NOT NULL DEFAULT 'x';
```

Di beberapa database/versi/skenario, operasi seperti ini bisa memicu rewrite besar atau lock yang mengganggu.

Pola aman sering berupa:

1. Tambah kolom nullable.
2. Deploy aplikasi yang menulis kolom baru.
3. Backfill bertahap.
4. Validasi data.
5. Tambah constraint.
6. Ubah aplikasi membaca kolom baru.
7. Bersihkan struktur lama.

---

## 9. Cara Belajar SQL dalam Seri Ini

Seri ini dirancang bertahap.

Anda akan melihat pola berulang:

1. **Concept first** — apa masalah dasarnya?
2. **Mental model** — bagaimana harus memikirkannya?
3. **Syntax** — bagaimana menulisnya?
4. **Correctness** — kapan hasilnya benar atau salah?
5. **Performance** — bagaimana database mengeksekusinya?
6. **Concurrency** — apa yang terjadi saat banyak user/process?
7. **Operational impact** — apa risiko production?
8. **Java integration** — bagaimana dampaknya di aplikasi?
9. **Design trade-off** — kapan menggunakan atau menghindari teknik itu?
10. **Checklist** — bagaimana mereviewnya secara praktis?

Ini sengaja berbeda dari tutorial syntax biasa.

---

## 10. Minimal Environment yang Akan Digunakan

Seri ini akan netral vendor, tetapi contoh utama akan sering memakai PostgreSQL karena:

- dokumentasinya terbuka dan kuat,
- fitur SQL cukup lengkap,
- execution plan mudah dipelajari,
- banyak dipakai di backend modern,
- cocok untuk membahas constraint, transaction, indexing, JSON, CTE, window function, dan extensibility.

Namun kita akan sering membandingkan dengan:

- MySQL / MariaDB,
- SQL Server,
- Oracle Database,
- SQLite untuk konteks embedded/local,
- analytical databases bila masuk OLAP.

Untuk Java, seri ini akan menyentuh:

- JDBC,
- DataSource,
- connection pool,
- HikariCP,
- Spring transaction,
- JPA/Hibernate,
- jOOQ,
- MyBatis,
- Flyway,
- Liquibase.

Tetapi bagian awal akan fokus pada SQL dan database mental model dulu.

---

## 11. SQL Standard vs Vendor Dialect

SQL memiliki standar formal. Edisi modern yang relevan adalah ISO/IEC 9075:2023, sering disebut SQL:2023. Standar mendefinisikan framework konseptual, grammar, dan hasil pemrosesan statement SQL.

Namun database nyata tidak pernah identik sepenuhnya.

Contoh variasi:

| Area | PostgreSQL | MySQL | SQL Server | Oracle |
|---|---|---|---|---|
| Upsert | `ON CONFLICT` | `ON DUPLICATE KEY UPDATE` | `MERGE` | `MERGE` |
| Limit | `LIMIT` | `LIMIT` | `TOP` / `OFFSET FETCH` | `FETCH FIRST` |
| Boolean | native `boolean` | `TINYINT(1)` historically/common | `bit` | historically no simple boolean column in older SQL usage |
| Auto increment | identity/serial | auto_increment | identity | identity/sequence |
| JSON | JSON/JSONB | JSON | JSON functions | JSON support |
| Procedural language | PL/pgSQL | stored routines | T-SQL | PL/SQL |

Prinsip seri:

1. Pelajari konsep umum dulu.
2. Pahami standar bila relevan.
3. Kuasai satu database utama secara dalam.
4. Ketahui vendor differences yang berbahaya.
5. Jangan mengejar portability palsu jika sistem jelas terikat vendor tertentu.

Portability penting untuk library/framework umum. Tetapi untuk aplikasi production yang sudah memilih PostgreSQL atau Oracle, sering lebih baik menggunakan fitur vendor secara sadar daripada menulis SQL generik yang lemah dan lambat.

---

## 12. SQL dan Domain Modelling

SQL yang baik dimulai dari pemahaman domain.

Misalnya domain case management:

- case,
- party,
- allegation,
- evidence,
- decision,
- action,
- appeal,
- assignment,
- SLA,
- escalation,
- audit event.

Pertanyaan desain:

### 12.1 Apa Entity Utama?

Entity punya identity dan lifecycle.

Contoh:

- `case`
- `party`
- `evidence`
- `enforcement_action`

### 12.2 Apa Relationship?

Relationship bisa:

- one-to-one,
- one-to-many,
- many-to-many,
- temporal,
- optional,
- mandatory.

Contoh:

- satu case punya banyak allegations,
- satu allegation bisa punya banyak evidence,
- satu evidence bisa terkait beberapa allegations,
- satu case punya banyak assignments dari waktu ke waktu,
- hanya satu assignment yang aktif pada satu waktu.

### 12.3 Apa Invariant?

Invariant adalah aturan yang harus selalu benar.

Contoh:

- case number unique,
- active assignment maksimal satu per case,
- closed case harus punya closed_at,
- evidence tidak boleh orphan,
- decision harus terkait reviewer valid,
- appeal tidak boleh dibuat sebelum action final.

### 12.4 Apa History yang Harus Dipertahankan?

Tidak semua update boleh overwrite.

Dalam sistem audit-heavy, sering lebih baik append event/history daripada update destructively.

Contoh buruk:

```sql
UPDATE cases
SET status = 'APPROVED'
WHERE case_id = 10;
```

Jika tidak ada history, kita kehilangan:

- status sebelumnya,
- kapan berubah,
- siapa yang mengubah,
- alasan perubahan,
- evidence saat keputusan dibuat.

Desain lebih defensible:

```sql
INSERT INTO case_status_history (
    case_id,
    old_status,
    new_status,
    changed_by,
    changed_at,
    reason
) VALUES (?, ?, ?, ?, now(), ?);
```

Lalu current status bisa tetap disimpan untuk query cepat, tetapi history tidak hilang.

---

## 13. SQL dan Correctness

Correctness di SQL memiliki beberapa lapisan.

### 13.1 Syntax Correctness

Query valid secara grammar.

```sql
SELECT name FROM users;
```

Ini level paling rendah.

### 13.2 Type Correctness

Expression dan comparison masuk akal secara tipe.

Contoh buruk:

```sql
WHERE created_at = '2024-01-01'
```

Mungkin valid, tetapi ada implicit cast. Pertanyaan:

- timezone apa?
- apakah dibandingkan timestamp tepat midnight?
- apakah ingin seluruh hari?

Lebih jelas:

```sql
WHERE created_at >= TIMESTAMPTZ '2024-01-01 00:00:00+00'
  AND created_at <  TIMESTAMPTZ '2024-01-02 00:00:00+00'
```

### 13.3 Relational Correctness

Join, grouping, dan filtering sesuai grain yang dimaksud.

Contoh:

> Hitung jumlah case per investigator aktif.

Harus jelas apakah `investigator_id` ada di case, assignment aktif, atau history assignment.

### 13.4 Business Correctness

Query menjawab definisi bisnis yang benar.

Contoh `active case` bisa berarti:

- status bukan closed,
- status dalam `OPEN`, `UNDER_REVIEW`, `ESCALATED`,
- belum punya `closed_at`,
- effective status pada tanggal tertentu,
- bukan archived,
- bukan duplicate merged case.

### 13.5 Temporal Correctness

Banyak bug muncul karena waktu.

Pertanyaan:

- Waktu disimpan dalam timezone apa?
- Query berdasarkan local date atau instant?
- Apakah `created_at` sama dengan effective date?
- Apakah data late-arriving?
- Apakah report memakai waktu transaksi atau waktu kejadian?
- Apakah daylight saving relevan?

### 13.6 Concurrency Correctness

Query benar dalam single-user belum tentu benar saat concurrent.

Contoh:

```sql
SELECT COUNT(*) FROM assignment WHERE case_id = ? AND active = true;
-- kalau 0, insert assignment baru
```

Di bawah race condition, dua transaksi bisa lolos.

Correctness membutuhkan constraint/lock/isolation.

---

## 14. SQL dan Performance

Performance SQL tidak bisa dipisahkan dari model data.

Query lambat bisa berasal dari:

- schema buruk,
- missing index,
- index salah,
- query salah bentuk,
- statistics stale,
- data skew,
- join explosion,
- sorting besar,
- aggregate besar,
- transaction lock,
- disk I/O,
- memory pressure,
- network overhead,
- ORM over-fetching,
- N+1 query,
- connection pool bottleneck.

Top-tier approach:

1. Definisikan query dan workload.
2. Ukur baseline.
3. Lihat execution plan.
4. Bandingkan estimated rows vs actual rows.
5. Identifikasi operator mahal.
6. Evaluasi index/schema/query rewrite.
7. Test dengan data realistis.
8. Pastikan correctness tetap sama.
9. Monitor setelah deploy.

Performance bukan kegiatan menambahkan index secara acak.

---

## 15. SQL dan Evolusi Sistem

Database schema akan berubah.

Perubahan bisa berupa:

- tambah kolom,
- hapus kolom,
- rename kolom,
- ubah tipe data,
- tambah constraint,
- tambah index,
- pecah tabel,
- gabung tabel,
- tambah history,
- tambah partition,
- ubah primary key,
- backfill data,
- migrate enum/status,
- ubah relationship cardinality.

Setiap perubahan harus dipikirkan sebagai perubahan kontrak.

### 15.1 Backward Compatibility

Aplikasi lama dan baru mungkin berjalan bersamaan saat rolling deployment.

Migration harus aman untuk situasi:

- kode lama membaca schema baru,
- kode baru membaca data lama,
- kode lama menulis saat schema baru ada,
- kode baru menulis field yang kode lama tidak tahu,
- job lama masih berjalan.

### 15.2 Expand and Contract

Pola umum:

1. Expand schema.
2. Deploy code yang kompatibel.
3. Backfill.
4. Switch reads/writes.
5. Validate.
6. Contract schema lama.

### 15.3 Data Migration Lebih Berbahaya dari Code Migration

Code salah bisa rollback. Data salah tidak selalu bisa rollback tanpa backup, audit, atau compensating migration.

Karena itu migration SQL harus punya:

- dry run,
- count validation,
- checksum bila perlu,
- backup/PITR awareness,
- rollback atau roll-forward plan,
- monitoring,
- batch size,
- lock analysis.

---

## 16. SQL dan Java: Boundary yang Harus Dipahami

Java code dan SQL bertemu di beberapa boundary.

### 16.1 Type Boundary

Java type dan SQL type tidak selalu cocok sempurna.

Contoh:

| Java | SQL |
|---|---|
| `String` | `VARCHAR`, `TEXT`, `CHAR` |
| `Long` | `BIGINT` |
| `BigDecimal` | `NUMERIC`, `DECIMAL` |
| `Instant` | `TIMESTAMP WITH TIME ZONE` / vendor equivalent |
| `LocalDate` | `DATE` |
| `UUID` | `UUID` atau `CHAR/VARCHAR` |
| `Boolean` | `BOOLEAN`, `BIT`, numeric workaround |
| enum | text, integer, enum type, lookup table |

Kesalahan type mapping bisa menghasilkan bug subtle:

- rounding uang,
- timezone bergeser,
- enum ordinal berubah,
- UUID disimpan sebagai string tidak konsisten,
- nullable primitive bermasalah,
- timestamp tanpa timezone disalahartikan.

---

### 16.2 Transaction Boundary

Di Spring, transaction sering dibuka oleh proxy.

Pertanyaan penting:

- Apakah method dipanggil dari luar proxy atau self-invocation?
- Apakah exception memicu rollback?
- Apakah checked exception rollback?
- Apakah propagation sesuai?
- Apakah read-only benar-benar read-only?
- Apakah transaction mencakup terlalu banyak logic?

SQL mastery untuk Java engineer harus memahami transaction dari dua sisi:

- framework side,
- database side.

---

### 16.3 Connection Pool Boundary

Connection pool bukan hanya optimisasi. Ia adalah resource limiter.

Masalah umum:

- pool terlalu kecil,
- pool terlalu besar,
- query lambat menghabiskan connection,
- transaction idle menahan connection,
- leak connection,
- timeout tidak jelas,
- thread pool lebih besar dari connection pool tanpa backpressure,
- DB max connection dilampaui.

SQL buruk bisa terlihat sebagai masalah aplikasi karena semua request menunggu connection.

---

### 16.4 ORM Boundary

ORM memetakan object ke row. Tetapi relationship object tidak selalu cocok dengan relationship relational.

Contoh:

- `@OneToMany` bisa memicu lazy load banyak query.
- `cascade = ALL` bisa menghapus data terlalu luas.
- `orphanRemoval` bisa berbahaya jika domain tidak tepat.
- `equals/hashCode` entity bisa mengacaukan persistence context.
- `merge` bisa menulis state yang tidak dimaksud.
- fetch join collection bisa menggandakan root entity.

Menguasai SQL membuat Anda bisa menggunakan ORM dengan sadar.

---

## 17. SQL sebagai Alat Review Desain

SQL mastery berguna bukan hanya saat coding, tetapi saat review desain.

Ketika membaca design document, tanyakan:

### 17.1 Data Ownership

- Service mana memiliki tabel ini?
- Siapa boleh menulis?
- Siapa boleh membaca?
- Apakah ada shared table tanpa owner jelas?

### 17.2 Data Lifecycle

- Row dibuat kapan?
- Row berubah kapan?
- Row dihapus kapan?
- Apakah soft delete atau hard delete?
- Apakah retention rule jelas?
- Apakah archival diperlukan?

### 17.3 Invariant

- Apa yang tidak boleh terjadi?
- Apakah invariant dijaga database?
- Jika hanya dijaga aplikasi, apakah semua write path tercakup?

### 17.4 Query Workload

- Query utama apa?
- Query reporting apa?
- Query admin/support apa?
- Query audit apa?
- Apakah index mendukung workload?

### 17.5 Concurrency

- Apa operasi yang bisa berjalan bersamaan?
- Apa race condition yang mungkin?
- Apakah ada unique constraint atau lock strategy?
- Apakah retry aman?

### 17.6 Migration

- Bagaimana schema akan berubah?
- Apakah deploy bisa rolling?
- Apakah backfill diperlukan?
- Apakah DDL akan lock besar?

### 17.7 Observability

- Bagaimana tahu query lambat?
- Bagaimana tahu lock contention?
- Bagaimana tahu replication lag?
- Bagaimana tahu row count abnormal?

---

## 18. Cara Membaca Query Secara Profesional

Saat melihat query, jangan baca dari atas ke bawah seperti kode imperative. Gunakan urutan analisis berikut.

### Step 1 — Tentukan Grain Output

Satu row hasil merepresentasikan apa?

- satu user?
- satu case?
- satu assignment?
- satu case per investigator?
- satu hari per status?
- satu event?

Jika grain tidak jelas, query rawan salah.

### Step 2 — Identifikasi Base Relation

Tabel utama apa?

- Apakah dari entity utama?
- Apakah dari event/history?
- Apakah dari assignment aktif?
- Apakah dari read model?

### Step 3 — Baca Join sebagai Relationship Graph

Untuk setiap join:

- relationship apa?
- cardinality apa?
- optional atau mandatory?
- apakah join condition lengkap?
- apakah ada effective date?
- apakah butuh filter active/current?

### Step 4 — Baca Predicate

Untuk setiap `WHERE`:

- apakah predicate business-correct?
- apakah `NULL` diperlakukan benar?
- apakah range waktu benar?
- apakah predicate sargable?
- apakah filter pada outer join diletakkan di tempat benar?

### Step 5 — Baca Aggregation

Jika ada `GROUP BY`:

- grouping level apa?
- aggregate menghitung apa?
- apakah duplicate join memengaruhi hasil?
- apakah `COUNT(*)` atau `COUNT(column)` tepat?
- apakah butuh distinct?

### Step 6 — Baca Ordering dan Limit

- Apakah ordering deterministic?
- Apakah ada tie-breaker?
- Apakah pagination stabil?
- Apakah sort mahal?

### Step 7 — Prediksi Execution

- Index apa yang mungkin dipakai?
- Berapa row kira-kira diproses?
- Join strategy apa yang mungkin?
- Apakah ada scan besar?
- Apakah ada sort/hash besar?

### Step 8 — Pikirkan Concurrent Behavior

Jika query bagian dari write flow:

- apakah read-then-write aman?
- apakah butuh lock?
- apakah unique constraint menangkap race?
- apakah retry aman?

---

## 19. Contoh Mini: Dari Query Naif ke Query yang Dipikirkan

Misalnya kebutuhan:

> Tampilkan 20 case aktif terbaru untuk investigator tertentu, termasuk jumlah evidence dan timestamp update terakhir.

Query naif:

```sql
SELECT c.*, COUNT(e.evidence_id) AS evidence_count
FROM cases c
LEFT JOIN allegations a ON a.case_id = c.case_id
LEFT JOIN evidence e ON e.allegation_id = a.allegation_id
WHERE c.investigator_id = ?
  AND c.status <> 'CLOSED'
GROUP BY c.case_id
ORDER BY c.updated_at DESC
LIMIT 20;
```

Masalah potensial:

1. `SELECT c.*` dengan `GROUP BY c.case_id` tidak portable dan bisa ambigu tergantung DB.
2. `status <> 'CLOSED'` mungkin salah jika active status lebih spesifik.
3. `NULL` status tidak jelas.
4. Investigator mungkin assignment historis, bukan kolom di `cases`.
5. Join allegations/evidence sebelum limit bisa mahal.
6. Count evidence bisa terdistorsi jika evidence punya relasi lain.
7. `updated_at` mungkin tidak mencerminkan update evidence.
8. Ordering tidak deterministic jika banyak case punya timestamp sama.
9. Pagination belum stabil.
10. Index belum jelas.

Pendekatan lebih sadar:

```sql
WITH selected_cases AS (
    SELECT c.case_id, c.case_number, c.status, c.opened_at, c.updated_at
    FROM cases c
    WHERE c.investigator_id = ?
      AND c.status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
    ORDER BY c.updated_at DESC, c.case_id DESC
    LIMIT 20
), evidence_counts AS (
    SELECT a.case_id, COUNT(e.evidence_id) AS evidence_count
    FROM allegations a
    JOIN evidence e ON e.allegation_id = a.allegation_id
    WHERE a.case_id IN (SELECT case_id FROM selected_cases)
    GROUP BY a.case_id
)
SELECT sc.case_id,
       sc.case_number,
       sc.status,
       sc.opened_at,
       sc.updated_at,
       COALESCE(ec.evidence_count, 0) AS evidence_count
FROM selected_cases sc
LEFT JOIN evidence_counts ec ON ec.case_id = sc.case_id
ORDER BY sc.updated_at DESC, sc.case_id DESC;
```

Ini bukan selalu query terbaik. Tetapi reasoning-nya lebih baik:

- pilih 20 case dulu,
- hindari join besar sebelum limit,
- eksplisit status aktif,
- eksplisit kolom,
- deterministic order,
- aggregate evidence terpisah,
- hasil lebih mudah direview.

Namun masih ada pertanyaan:

- apakah CTE materialized atau inline di DB tersebut?
- apakah `IN (SELECT...)` dioptimalkan baik?
- apakah index `(investigator_id, status, updated_at DESC, case_id DESC)` tepat?
- apakah evidence count harus mencakup deleted evidence?
- apakah allegation soft-deleted?
- apakah investigator aktif berasal dari assignment table?

SQL mastery adalah kebiasaan bertanya sampai query benar secara domain, bukan hanya jalan.

---

## 20. Apa yang Tidak Akan Kita Lakukan di Seri Ini

Agar efisien dan tidak mengulang seri sebelumnya, kita tidak akan menghabiskan waktu pada:

- dasar Git,
- HTTP request/response,
- frontend HTTP caching,
- backend HTTP routing,
- Nginx reverse proxy,
- TLS termination,
- API gateway detail,
- Docker/Kubernetes setup kecuali ketika relevan untuk database operation,
- cloud database provisioning detail mendalam kecuali pada bagian scaling/ops.

Kita akan fokus pada SQL dan database relasional.

---

## 21. Roadmap Mental per Bagian

### Part 0–4: Foundation

Anda akan membangun bahasa dasar:

- apa itu SQL,
- apa itu relational thinking,
- apa itu data type,
- apa itu NULL,
- bagaimana query dasar diproses.

### Part 5–10: Query Power

Anda akan belajar membaca dan menulis query kompleks:

- filtering,
- join,
- aggregation,
- subquery,
- CTE,
- set operation,
- window function.

### Part 11–14: Data Correctness and Modelling

Anda akan belajar membuat data tetap benar:

- insert/update/delete,
- upsert,
- constraint,
- normalization,
- workflow/state modelling,
- regulatory case modelling.

### Part 15–18: Performance and Optimizer

Anda akan belajar kenapa query lambat:

- index,
- access path,
- execution plan,
- optimizer,
- statistics,
- slow query diagnosis.

### Part 19–20: Transaction and Concurrency

Anda akan belajar bug yang tidak muncul di single-threaded test:

- isolation,
- MVCC,
- locks,
- deadlocks,
- lost update,
- write skew,
- concurrent workflow safety.

### Part 21–24: Database Capabilities

Anda akan belajar fitur database sebagai design tools:

- procedures,
- triggers,
- views,
- materialized views,
- temporal model,
- security,
- row-level security,
- audit.

### Part 25–27: Java Integration

Anda akan menghubungkan SQL dengan Java:

- JDBC,
- connection pool,
- transaction management,
- ORM,
- jOOQ,
- MyBatis,
- Flyway/Liquibase.

### Part 28–31: Production and Scale

Anda akan belajar SQL sebagai sistem operasi data:

- bulk load,
- ETL,
- reconciliation,
- partitioning,
- replication,
- backup/restore,
- observability,
- OLAP/reporting.

### Part 32–34: Mastery Layer

Anda akan menyatukan semuanya:

- vendor comparison,
- patterns/anti-patterns,
- capstone regulatory case management database.

---

## 22. Checklist Awal: Bagaimana Menilai Skill SQL Anda Sekarang

Gunakan pertanyaan ini sebagai baseline.

### Query Semantics

- Bisakah Anda menjelaskan logical processing order dari SQL query?
- Bisakah Anda membedakan `WHERE` dan `HAVING`?
- Bisakah Anda menjelaskan kenapa filter pada tabel kanan `LEFT JOIN` di `WHERE` bisa mengubah hasil?
- Bisakah Anda menjelaskan `COUNT(*)` vs `COUNT(column)`?
- Bisakah Anda menjelaskan `NOT IN` dengan `NULL`?

### Joins and Aggregation

- Bisakah Anda memprediksi duplicate amplification dari join?
- Bisakah Anda menentukan grain output query?
- Bisakah Anda menulis anti-join dengan `NOT EXISTS`?
- Bisakah Anda menghitung aggregate tanpa double-counting?

### Index and Performance

- Bisakah Anda membaca execution plan dasar?
- Bisakah Anda menjelaskan composite index order?
- Bisakah Anda menjelaskan selectivity?
- Bisakah Anda tahu kapan index tidak dipakai?
- Bisakah Anda membedakan index scan, sequential scan, bitmap scan?

### Transaction and Concurrency

- Bisakah Anda menjelaskan lost update?
- Bisakah Anda menjelaskan phantom read?
- Bisakah Anda memilih optimistic vs pessimistic locking?
- Bisakah Anda mendesain unique constraint untuk mencegah race?
- Bisakah Anda menangani deadlock dengan retry aman?

### Modelling

- Bisakah Anda mendesain M:N relationship?
- Bisakah Anda menjelaskan normalisasi dan kapan denormalisasi?
- Bisakah Anda mendesain audit history?
- Bisakah Anda memodelkan state transition?
- Bisakah Anda membedakan valid time dan transaction time?

### Java Integration

- Bisakah Anda menjelaskan `PreparedStatement`?
- Bisakah Anda menjelaskan connection pool sizing?
- Bisakah Anda menjelaskan Hibernate N+1?
- Bisakah Anda menjelaskan transaction propagation?
- Bisakah Anda menulis migration zero-downtime?

Jika banyak jawaban belum stabil, seri ini akan mengisi celah tersebut secara bertahap.

---

## 23. Prinsip Praktis yang Akan Kita Pakai

### Prinsip 1 — Correctness Before Performance

Query cepat tetapi salah lebih buruk daripada query lambat tetapi benar. Pertama pastikan semantics benar. Setelah itu optimalkan.

### Prinsip 2 — Data Model Before Query Tricks

Banyak query buruk berasal dari schema buruk. Jangan selalu menambal query jika akar masalahnya model data.

### Prinsip 3 — Constraints Are Executable Documentation

Constraint bukan hanya validasi. Constraint mendokumentasikan dan menegakkan aturan domain.

### Prinsip 4 — Measure Before Optimizing

Jangan menebak performa. Gunakan execution plan, metrics, dan data realistis.

### Prinsip 5 — Think in Workloads, Not Individual Queries

Index yang bagus untuk satu query bisa buruk untuk write-heavy workload. Desain database harus melihat keseluruhan workload.

### Prinsip 6 — Transactions Are Design Decisions

Isolation level, lock, retry, dan transaction boundary adalah bagian dari desain, bukan detail implementasi kecil.

### Prinsip 7 — Schema Changes Are Product Changes

Migration memengaruhi aplikasi, data, reporting, audit, dan operasi. Perlakukan dengan disiplin.

### Prinsip 8 — SQL Is a Shared Language Between Humans and Machines

SQL harus bisa dibaca manusia dan dioptimalkan mesin. Query yang terlalu clever tetapi tidak bisa direview adalah risiko.

---

## 24. Cara Mencatat Saat Belajar

Untuk setiap topik SQL, buat catatan dalam format:

```text
Concept:
  Apa ide utamanya?

Mental model:
  Bagaimana membayangkannya?

Syntax:
  Bagaimana menulisnya?

Correctness risks:
  Bagaimana hasil bisa salah?

Performance risks:
  Bagaimana bisa lambat?

Concurrency risks:
  Bagaimana bisa rusak saat paralel?

Operational risks:
  Apa dampak production?

Java integration:
  Apa dampaknya pada JDBC/ORM/transaction?

Review checklist:
  Apa yang harus dicek saat code review?
```

Format ini akan membuat Anda belajar SQL secara struktural.

---

## 25. Latihan Awal: Ubah Cara Membaca Database

Sebelum masuk Part 1, lakukan latihan mental berikut.

Ambil satu database aplikasi yang Anda kenal. Lalu jawab:

1. Apa 10 tabel paling penting?
2. Untuk setiap tabel, satu row merepresentasikan apa?
3. Apa primary key-nya?
4. Apa foreign key yang seharusnya ada?
5. Apa unique constraint yang penting?
6. Apa check constraint yang mungkin hilang?
7. Apa tabel yang menyimpan current state?
8. Apa tabel yang menyimpan history?
9. Apa query paling sering dijalankan?
10. Apa query paling mahal?
11. Apa operasi write paling berisiko concurrency?
12. Apa migration terakhir yang berisiko?
13. Apa data yang harus bisa diaudit?
14. Apa row yang tidak boleh dihapus?
15. Apa invariant yang saat ini hanya dijaga aplikasi?

Jika Anda bisa menjawab ini, Anda sudah mulai berpikir seperti database/system engineer, bukan hanya query writer.

---

## 26. Mini Glossary Awal

| Istilah | Makna Praktis |
|---|---|
| Relation | Kumpulan tuple dengan atribut tertentu; dalam praktik sering direpresentasikan sebagai tabel |
| Tuple | Satu record/baris fakta |
| Attribute | Kolom/field dalam relation |
| Predicate | Kondisi logis yang menentukan apakah row memenuhi syarat |
| Projection | Memilih kolom tertentu |
| Selection | Memilih row berdasarkan predicate |
| Join | Menggabungkan row dari beberapa relation berdasarkan kondisi |
| Cardinality | Jumlah row atau karakteristik jumlah nilai unik/relasi |
| Selectivity | Seberapa sempit predicate memfilter data |
| Constraint | Aturan yang ditegakkan database |
| Transaction | Unit kerja atomik dan terisolasi |
| Isolation | Aturan visibilitas antar transaksi |
| Index | Struktur akses untuk mempercepat lookup/order tertentu |
| Execution plan | Rencana fisik database untuk menjalankan query |
| Optimizer | Komponen yang memilih execution plan |
| DDL | Data Definition Language: create/alter/drop schema |
| DML | Data Manipulation Language: insert/update/delete/merge |
| DQL | Query, terutama select |
| TCL | Transaction Control Language: commit/rollback/savepoint |
| DCL | Data Control Language: grant/revoke |

---

## 27. Sumber Referensi Utama Seri

Sumber yang akan sering menjadi rujukan konseptual dan praktis:

1. ISO/IEC 9075:2023 — Database languages SQL. Standar formal SQL modern.
2. PostgreSQL Documentation — SQL language, query planning, indexes, transactions, MVCC, constraints.
3. MySQL Reference Manual — dialect, optimizer, InnoDB locking, indexing behavior.
4. Oracle Database Documentation — SQL language, optimizer, PL/SQL, transaction concepts.
5. Microsoft SQL Server Documentation — T-SQL, execution plan, indexing, transaction isolation.
6. Oracle Java JDBC Tutorial / JDBC API documentation — Java database access fundamentals.
7. Hibernate ORM Documentation — ORM behavior, mapping, query generation, persistence context.
8. jOOQ Documentation — SQL-first Java database access patterns.
9. Flyway / Liquibase Documentation — migration discipline.
10. Vendor-specific performance guides and production incident learnings.

Catatan penting: standar SQL memberi bahasa umum, tetapi production behavior selalu harus diverifikasi pada database engine dan versi yang digunakan.

---

## 28. Sumber Web yang Dicek untuk Bagian Ini

- ISO/IEC 9075-1:2023 menjelaskan framework konseptual dan terminologi SQL standard.
- PostgreSQL documentation menyediakan bagian khusus tentang SQL language dan SQL conformance.
- Oracle Java Tutorials menyediakan trail JDBC untuk membuat tabel, insert, query, update, prepared statement, transaction, exception, dan stored procedure.
- Hibernate ORM documentation menjelaskan ORM sebagai mekanisme object/relational mapping untuk Java.

Sumber-sumber ini tidak menggantikan pemahaman praktis, tetapi membantu menjaga framing seri tetap terhubung dengan standar dan dokumentasi resmi.

---

## 29. Kesimpulan Bagian 0

SQL mastery untuk Java engineer bukan sekadar kemampuan menulis query.

Yang ingin kita bangun adalah kemampuan untuk:

1. Mendesain schema yang mencerminkan domain dengan benar.
2. Menulis query yang benar secara semantik.
3. Membaca query sebagai transformasi relasi.
4. Memahami bagaimana optimizer mungkin mengeksekusi query.
5. Mendesain index berdasarkan workload.
6. Menggunakan constraint sebagai penjaga invariant.
7. Mengelola transaksi dan concurrency dengan sadar.
8. Mengintegrasikan SQL dengan Java tanpa tertipu abstraction ORM.
9. Melakukan migration secara aman.
10. Mengoperasikan database sebagai bagian dari sistem production.
11. Menjaga auditability dan defensibility untuk sistem bisnis/regulasi.

Mulai Part 1, kita akan masuk ke fondasi paling penting: **relational thinking**.

Tanpa relational thinking, SQL hanya terlihat seperti syntax. Dengan relational thinking, SQL menjadi cara berpikir tentang fakta, hubungan, constraint, dan transformasi data.

---

## 30. Status Seri

- Bagian ini: **Part 0 selesai**.
- Seri belum selesai.
- Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-001.md`.
- Topik berikutnya: **Relational Thinking: Tables, Relations, Tuples, Predicates, and Sets**.

