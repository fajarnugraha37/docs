# learn-sql-mastery-for-java-engineers-part-001.md

# Part 1 — Relational Thinking: Tables, Relations, Tuples, Predicates, and Sets

> Seri: SQL Mastery for Java Engineers  
> Bagian: 001 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-000.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-002.md`

---

## 0. Tujuan Bagian Ini

Bagian ini membangun fondasi berpikir relasional.

Banyak engineer belajar SQL dari syntax:

```sql
SELECT *
FROM users
WHERE status = 'ACTIVE';
```

Lalu cepat merasa “sudah bisa SQL”.

Padahal level mastery SQL tidak dimulai dari syntax. Ia dimulai dari cara berpikir:

> Database relasional bukan sekadar tempat menyimpan object.  
> Ia adalah sistem untuk menyimpan, menjaga, dan menanyakan fakta yang tersusun dalam bentuk relasi.

Sebagai Java engineer, kamu terbiasa berpikir dalam:

- class
- object
- reference
- collection
- method call
- loop
- service boundary
- aggregate root
- object graph

SQL meminta kamu berpikir dengan cara berbeda:

- relation
- tuple
- attribute
- predicate
- set
- constraint
- join
- projection
- selection
- declarative transformation

Perbedaan cara berpikir ini sangat penting. Banyak bug SQL yang terlihat seperti bug syntax sebenarnya berasal dari model mental yang salah.

Contoh:

```sql
SELECT c.id, c.case_number, a.name
FROM cases c
JOIN assignments a ON a.case_id = c.id;
```

Query ini terlihat sederhana. Tapi pertanyaan sebenarnya:

- Apakah satu case boleh punya banyak assignment?
- Apakah assignment historis atau current?
- Jika case belum assigned, apakah tetap harus muncul?
- Apakah join ini menggandakan row?
- Apakah hasil query masih merepresentasikan satu row per case?
- Apakah query ini kehilangan case yang belum punya assignment?
- Apakah downstream Java code mengira hasilnya unik?

SQL mastery adalah kemampuan melihat pertanyaan-pertanyaan itu sebelum production incident terjadi.

---

## 1. Referensi Konseptual Singkat

Model relasional modern berakar dari paper klasik E. F. Codd, *A Relational Model of Data for Large Shared Data Banks*, yang diterbitkan pada tahun 1970 di Communications of the ACM. Paper ini memperkenalkan pendekatan data berbasis relation dan memisahkan cara pengguna melihat data dari detail penyimpanan fisik.

SQL sendiri saat ini distandarkan dalam keluarga ISO/IEC 9075. Versi modernnya adalah SQL:2023. Dokumen ISO/IEC 9075-1:2023 mendefinisikan framework konseptual, grammar, dan hasil pemrosesan statement SQL. PostgreSQL juga mendokumentasikan bahwa SQL standard terbaru mengacu pada ISO/IEC 9075:2023.

Sumber resmi dan historis yang relevan:

- ISO/IEC 9075-1:2023 — Database languages SQL
- PostgreSQL Documentation — SQL conformance
- PostgreSQL Documentation — Table expressions
- E. F. Codd, 1970 — A Relational Model of Data for Large Shared Data Banks

Referensi lengkap ada di bagian akhir file.

---

## 2. Mengapa “Relational Thinking” Penting untuk Java Engineer

### 2.1 Java Mendorong Object Thinking

Dalam Java, model domain sering tampak seperti ini:

```java
class Case {
    UUID id;
    String caseNumber;
    CaseStatus status;
    List<Assignment> assignments;
    List<Evidence> evidences;
    List<Decision> decisions;
}
```

Ini natural di aplikasi.

Tapi ketika masuk ke database relasional, model itu tidak disimpan sebagai object graph utuh. Ia dipecah menjadi beberapa relasi:

```text
cases
assignments
evidences
decisions
case_parties
case_events
```

Masalah muncul ketika engineer memaksakan cara berpikir object ke SQL.

Misalnya berpikir:

> “Saya mau ambil Case beserta Assignment dan Evidence-nya.”

Lalu menulis:

```sql
SELECT *
FROM cases c
JOIN assignments a ON a.case_id = c.id
JOIN evidences e ON e.case_id = c.id;
```

Jika satu case punya:

- 3 assignments
- 5 evidences

Maka hasil join bisa menjadi:

```text
3 × 5 = 15 rows
```

Bukan 1 case.

Ini bukan bug database. Ini konsekuensi relasional.

Object graph dan relation memiliki bentuk matematika yang berbeda.

---

### 2.2 SQL Meminta Kamu Menyatakan Fakta, Bukan Mengontrol Langkah

Dalam Java, kamu mungkin menulis:

```java
List<Case> result = new ArrayList<>();

for (Case c : cases) {
    if (c.status() == CaseStatus.OPEN) {
        result.add(c);
    }
}
```

Dalam SQL:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Java code menjelaskan **cara**.

SQL query menjelaskan **kondisi fakta yang diinginkan**.

SQL tidak berkata:

1. buka file table
2. scan row satu per satu
3. cek status
4. masukkan ke result

SQL berkata:

> Berikan semua tuple dari relation `cases` yang memenuhi predicate `status = 'OPEN'`.

Optimizer bebas memilih:

- sequential scan
- index scan
- bitmap scan
- partition pruning
- parallel execution
- join reordering
- predicate pushdown

Jadi SQL bukan loop yang ditulis dengan syntax berbeda. SQL adalah deklarasi hasil.

---

## 3. Relation vs Table

### 3.1 Table Adalah Representasi Praktis

Dalam database sehari-hari, kita melihat table:

```text
cases
+----+-------------+---------+
| id | case_number | status  |
+----+-------------+---------+
| 1  | C-001       | OPEN    |
| 2  | C-002       | CLOSED  |
| 3  | C-003       | OPEN    |
+----+-------------+---------+
```

Secara praktis, table terdiri dari:

- nama table
- columns
- rows
- data types
- constraints
- indexes
- privileges
- storage representation

PostgreSQL, misalnya, menjelaskan table expression sebagai sesuatu yang “computes a table”, dan table expression dapat berasal dari base table atau kombinasi yang lebih kompleks dari `FROM`, `WHERE`, `GROUP BY`, dan `HAVING`.

Namun secara konseptual, table hanyalah tampilan implementasi dari ide yang lebih fundamental: **relation**.

---

### 3.2 Relation Adalah Set of Tuples

Secara relasional, sebuah relation adalah sekumpulan tuple dengan attribute tertentu.

Contoh relation:

```text
Case(id, case_number, status)
```

Tuple:

```text
(1, 'C-001', 'OPEN')
(2, 'C-002', 'CLOSED')
(3, 'C-003', 'OPEN')
```

Relation dapat dibaca sebagai kumpulan fakta.

Misalnya:

```text
Case(1, 'C-001', 'OPEN') is true
Case(2, 'C-002', 'CLOSED') is true
Case(3, 'C-003', 'OPEN') is true
```

Artinya database menyatakan bahwa fakta-fakta tersebut benar menurut state database saat itu.

Ketika kamu menjalankan:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Kamu tidak sedang “memfilter array”. Kamu sedang meminta subset dari fakta `Case(...)` yang memenuhi predicate tambahan:

```text
status = 'OPEN'
```

---

### 3.3 Table Bukan Class

Kesalahan umum:

```text
table = class
row   = object
column = field
foreign key = object reference
```

Mapping ini berguna untuk onboarding awal, tapi berbahaya kalau dibawa terlalu jauh.

Perbandingan:

| Konsep | Java/OOP | Relational |
|---|---|---|
| Unit utama | Object | Tuple/fact |
| Struktur | Class | Relation schema |
| Identity | Object identity/reference | Key |
| Navigasi | Pointer/reference | Join |
| Constraint | Code validation | Declarative invariant |
| Collection | List/Set/Map | Relation/result set |
| Behavior | Method | Query/transformation |
| Missing value | `null` reference | SQL `NULL` dengan three-valued logic |

Table bukan class karena table tidak memiliki method, inheritance behavior, encapsulation runtime, atau object identity.

Row bukan object karena row tidak “menunjuk” langsung ke row lain. Hubungan antar-row diekspresikan lewat value dan constraint.

Foreign key bukan pointer. Foreign key adalah constraint bahwa value pada satu relation harus cocok dengan candidate key pada relation lain.

---

## 4. Tuple vs Row

### 4.1 Row dalam Implementasi

Dalam database, kita sering bicara row:

```text
row in table cases
```

Row adalah istilah implementasi/praktis.

Row bisa punya:

- physical location
- MVCC metadata
- transaction visibility
- storage page
- internal tuple version
- locking state

Tapi dalam relational thinking, row lebih baik dipahami sebagai tuple.

---

### 4.2 Tuple Sebagai Fakta

Tuple adalah satu fakta yang sesuai dengan schema relation.

Contoh:

```text
Assignment(case_id, officer_id, assigned_at, ended_at)
```

Tuple:

```text
Assignment(101, 501, '2026-01-10 09:00:00Z', null)
```

Ini dapat dibaca sebagai:

> Case 101 assigned ke officer 501 sejak 2026-01-10 09:00:00Z dan belum berakhir.

Jika `ended_at` bernilai `NULL`, fakta tersebut mengandung ketidaklengkapan atau kondisi khusus. Ini harus dimaknai hati-hati.

Apakah `NULL` berarti:

- belum berakhir?
- tidak diketahui?
- tidak berlaku?
- data belum dimigrasi?
- optional?

Relational thinking memaksa kamu menjelaskan makna data, bukan hanya menyimpan value.

---

## 5. Attribute vs Column

### 5.1 Column Adalah Representasi Implementasi

Column adalah komponen table di database:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL
);
```

Column punya:

- name
- type
- nullability
- default
- constraints
- collation
- generated expression
- statistics
- storage behavior

---

### 5.2 Attribute Adalah Bagian dari Predicate

Secara konseptual, attribute adalah variabel bernama dalam relation.

Relation:

```text
Case(id, case_number, status)
```

Predicate:

```text
A case exists with identifier id, case number case_number, and lifecycle status status.
```

Tuple:

```text
Case('7bd...', 'CASE-2026-0001', 'OPEN')
```

Attribute `status` bukan hanya field string. Ia bagian dari klaim domain.

Jika status boleh bernilai:

```text
OPEN
UNDER_REVIEW
ESCALATED
CLOSED
CANCELLED
```

Maka relation schema perlu menjaga agar value lain tidak masuk sembarangan.

Di Java, kamu mungkin punya enum:

```java
enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    ESCALATED,
    CLOSED,
    CANCELLED
}
```

Tapi kalau database column hanya:

```sql
status TEXT NOT NULL
```

tanpa constraint, maka database menerima:

```text
'open'
'Open'
'OPNE'
'CLOSE'
'ARCHIVED'
''
```

Java enum tidak cukup jika database dapat diubah dari:

- migration script
- admin console
- ETL process
- reporting job
- another service
- manual fix
- legacy integration

Relational thinking melihat attribute sebagai bagian dari invariant, bukan sekadar slot penyimpanan.

---

## 6. Predicate: Inti Tersembunyi dari Relational Modelling

### 6.1 Apa Itu Predicate?

Predicate adalah pernyataan dengan variabel yang bisa bernilai benar atau salah ketika variabelnya diisi.

Contoh:

```text
Case(id, case_number, status)
```

Predicate-nya:

> Ada sebuah case dengan identifier `id`, nomor `case_number`, dan status `status`.

Tuple:

```text
Case(1, 'C-001', 'OPEN')
```

Menyatakan predicate tersebut benar untuk value itu.

Ini sangat penting.

Sebuah table yang baik bukan hanya punya kolom. Ia punya arti predikatif yang jelas.

---

### 6.2 Contoh Predicate yang Buruk

Table:

```text
case_data
```

Columns:

```text
id
type
value1
value2
value3
date1
flag1
flag2
```

Masalah:

- Apa arti satu row?
- Apa arti `value1`?
- Apakah `date1` selalu mandatory?
- Apa hubungan `flag1` dan `flag2`?
- Apakah `type` mengubah arti kolom lain?
- Apakah query perlu `CASE WHEN type = ...` di mana-mana?

Ini bukan sekadar naming buruk. Ini predicate buruk.

Predicate yang tidak jelas menghasilkan:

- constraint lemah
- query sulit
- index tidak jelas
- test sulit
- laporan rawan salah
- migration berisiko
- data quality turun
- business rule tersebar di aplikasi

---

### 6.3 Contoh Predicate yang Lebih Baik

Alih-alih:

```text
case_data(id, type, value1, value2, date1)
```

Gunakan relation yang mempresentasikan fakta domain:

```text
cases(id, case_number, status, opened_at)
case_assignments(id, case_id, officer_id, assigned_at, ended_at)
case_escalations(id, case_id, from_level, to_level, reason, escalated_at)
case_decisions(id, case_id, decision_type, decided_by, decided_at)
```

Masing-masing punya predicate:

```text
cases:
A regulatory case exists with identifier id, number case_number, current status status, opened at opened_at.

case_assignments:
Officer officer_id was assigned to case case_id starting assigned_at and ending ended_at.

case_escalations:
Case case_id was escalated from from_level to to_level for reason reason at escalated_at.

case_decisions:
A decision of type decision_type was made for case case_id by decided_by at decided_at.
```

Dengan predicate jelas, constraint menjadi natural.

Contoh:

```sql
ALTER TABLE case_assignments
ADD CONSTRAINT case_assignments_time_valid
CHECK (ended_at IS NULL OR ended_at > assigned_at);
```

Constraint ini bukan teknis semata. Ia menjaga kebenaran predicate.

---

## 7. Set vs Bag: SQL Tidak Murni Set

### 7.1 Relational Model Idealnya Set

Dalam matematika, set tidak punya duplicate.

```text
{1, 2, 3}
```

sama dengan:

```text
{1, 1, 2, 3, 3}
```

karena duplicate tidak berarti dalam set.

Relational model klasik memandang relation sebagai set of tuples. Artinya tuple yang identik tidak muncul dua kali.

---

### 7.2 SQL Menggunakan Bag/Multiset Semantics

SQL secara praktis mengizinkan duplicate row pada hasil query.

Contoh:

```sql
SELECT status
FROM cases;
```

Hasil:

```text
OPEN
OPEN
CLOSED
OPEN
```

Ini bukan set murni. Ini bag/multiset.

Untuk menghilangkan duplicate:

```sql
SELECT DISTINCT status
FROM cases;
```

Hasil:

```text
OPEN
CLOSED
```

Kenapa ini penting?

Karena banyak bug SQL berasal dari lupa bahwa SQL mempertahankan duplicate kecuali kamu secara eksplisit menghilangkannya.

---

### 7.3 Duplicate Bisa Bermakna atau Bisa Menjadi Bug

Contoh duplicate yang bermakna:

```sql
SELECT status
FROM cases;
```

Jika ada 10.000 case dengan status `OPEN`, maka 10.000 row `OPEN` memang merepresentasikan jumlah case.

Contoh duplicate yang menjadi bug:

```sql
SELECT c.id, c.case_number
FROM cases c
JOIN case_assignments a ON a.case_id = c.id;
```

Jika satu case punya 3 assignment historis, case tersebut muncul 3 kali.

Jika downstream code melakukan:

```java
List<CaseDto> cases = jdbcTemplate.query(...);
```

lalu UI menampilkan list case, user melihat duplicate case.

Masalahnya bukan UI. Masalahnya query tidak menjaga grain.

---

## 8. Grain: Pertanyaan Paling Penting dalam SQL Query

### 8.1 Apa Itu Grain?

Grain adalah arti satu row dalam hasil query.

Contoh:

```sql
SELECT *
FROM cases;
```

Grain:

```text
one row per case
```

Query:

```sql
SELECT c.id, c.case_number, a.officer_id
FROM cases c
JOIN case_assignments a ON a.case_id = c.id;
```

Grain:

```text
one row per case assignment
```

Bukan lagi one row per case.

Query:

```sql
SELECT c.status, COUNT(*)
FROM cases c
GROUP BY c.status;
```

Grain:

```text
one row per case status
```

Query:

```sql
SELECT c.id, COUNT(e.id)
FROM cases c
LEFT JOIN evidences e ON e.case_id = c.id
GROUP BY c.id;
```

Grain:

```text
one row per case, with evidence count
```

Jika kamu tidak tahu grain query, kamu tidak benar-benar tahu query itu menghasilkan apa.

---

### 8.2 Grain Harus Ditentukan Sebelum Menulis Query

Sebelum menulis query, tanyakan:

> Satu row hasil query merepresentasikan apa?

Kemungkinan:

- one row per case
- one row per party
- one row per active assignment
- one row per case transition
- one row per evidence item
- one row per officer per month
- one row per SLA breach
- one row per escalation event
- one row per regulatory entity
- one row per case summary

Tanpa grain, query mudah salah.

---

### 8.3 Grain dan Join Explosion

Misalnya:

```text
cases
case_assignments
case_evidences
case_notes
```

Satu case punya:

- 2 assignments
- 4 evidences
- 10 notes

Query:

```sql
SELECT *
FROM cases c
JOIN case_assignments a ON a.case_id = c.id
JOIN case_evidences e ON e.case_id = c.id
JOIN case_notes n ON n.case_id = c.id;
```

Hasil untuk satu case:

```text
2 × 4 × 10 = 80 rows
```

Jika kamu ingin one row per case, query ini salah secara grain.

Untuk summary, kamu perlu pre-aggregate:

```sql
WITH assignment_counts AS (
    SELECT case_id, COUNT(*) AS assignment_count
    FROM case_assignments
    GROUP BY case_id
),
evidence_counts AS (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
note_counts AS (
    SELECT case_id, COUNT(*) AS note_count
    FROM case_notes
    GROUP BY case_id
)
SELECT
    c.id,
    c.case_number,
    COALESCE(ac.assignment_count, 0) AS assignment_count,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    COALESCE(nc.note_count, 0) AS note_count
FROM cases c
LEFT JOIN assignment_counts ac ON ac.case_id = c.id
LEFT JOIN evidence_counts ec ON ec.case_id = c.id
LEFT JOIN note_counts nc ON nc.case_id = c.id;
```

Sekarang grain kembali:

```text
one row per case
```

Ini contoh relational thinking yang matang.

---

## 9. Keys: Identity dalam Relational Model

### 9.1 Object Identity vs Relational Identity

Dalam Java, dua object bisa berbeda meskipun field-nya sama:

```java
User a = new User("alice@example.com");
User b = new User("alice@example.com");

System.out.println(a == b); // false
```

Object identity berasal dari reference.

Dalam relational database, identity harus diekspresikan lewat value.

Contoh:

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
);
```

Di sini ada dua konsep:

- `id` sebagai primary key
- `email` sebagai alternate/candidate key jika domain menganggap email unik

Relational database tidak peduli object reference. Ia peduli value yang membedakan fakta.

---

### 9.2 Candidate Key

Candidate key adalah attribute atau kombinasi attribute yang dapat mengidentifikasi tuple secara unik.

Contoh:

```text
users(id, email, username)
```

Candidate keys:

```text
id
email
username
```

jika semua dijamin unik.

Contoh:

```text
case_assignments(case_id, officer_id, assigned_at)
```

Mungkin candidate key-nya:

```text
(case_id, officer_id, assigned_at)
```

Jika seorang officer bisa assigned ke case yang sama berkali-kali di waktu berbeda.

---

### 9.3 Primary Key

Primary key adalah candidate key yang dipilih sebagai identitas utama table.

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE
);
```

`id` primary key.

`case_number` unique alternate key.

Pilihan primary key bukan hanya style. Ia berdampak pada:

- foreign key design
- indexing
- join performance
- URL/API exposure
- migration
- data import
- sharding
- idempotency
- auditability

---

### 9.4 Natural Key vs Surrogate Key

Natural key berasal dari domain.

Contoh:

```text
case_number
taxpayer_registration_number
license_number
email
national_id
```

Surrogate key dibuat sistem.

Contoh:

```text
UUID
BIGSERIAL
ULID
Snowflake ID
sequence-generated ID
```

#### Natural Key — Kelebihan

- Bermakna domain
- Bisa mencegah duplicate berdasarkan business identity
- Mudah untuk reconciliation
- Cocok untuk reference data stabil

#### Natural Key — Kekurangan

- Bisa berubah
- Bisa salah input
- Bisa punya exception
- Bisa sensitif/PII
- Bisa berbeda antar jurisdiction/system
- Bisa terlalu panjang untuk FK

#### Surrogate Key — Kelebihan

- Stabil secara teknis
- Kecil/seragam
- Cocok untuk FK
- Tidak mengekspos domain identifier
- Memudahkan migration

#### Surrogate Key — Kekurangan

- Tidak mencegah duplicate domain
- Butuh unique constraint tambahan
- Bisa menyembunyikan masalah data quality

Praktik matang:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT cases_case_number_per_jurisdiction_unique
    UNIQUE (jurisdiction_code, case_number)
);
```

Gunakan surrogate key untuk identity teknis, tapi tetap deklarasikan business uniqueness.

---

## 10. Foreign Key: Relationship Bukan Pointer

### 10.1 Foreign Key Sebagai Constraint

Contoh:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY
);

CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL
);
```

`case_id` bukan pointer seperti object reference.

Ia adalah value yang dibatasi oleh constraint:

> Setiap `case_assignments.case_id` harus cocok dengan `cases.id`.

Foreign key menjaga integritas fakta.

Tanpa foreign key, database dapat menyimpan:

```text
assignment refers to case_id = 'abc'
but no case with id = 'abc' exists
```

Itu orphan fact.

Dalam sistem regulatory/case-management, orphan fact sangat berbahaya karena audit trail dan evidence chain bisa rusak.

---

### 10.2 Foreign Key Tidak Otomatis Berarti Join Selalu Aman

Foreign key menjamin existence, bukan grain.

Contoh:

```sql
SELECT c.id, a.officer_id
FROM cases c
JOIN case_assignments a ON a.case_id = c.id;
```

FK menjamin assignment punya case. Tapi query tetap bisa menggandakan case jika case punya banyak assignment.

Constraint menjaga validity. Query tetap butuh reasoning.

---

### 10.3 Optional Relationship

Jika relationship optional:

```sql
case_assignments.case_id UUID NULL REFERENCES cases(id)
```

Pertanyaan domain:

- Apakah assignment boleh tanpa case?
- Jika iya, apa artinya?
- Draft assignment?
- Imported but unresolved?
- Temporary staging?
- Data corruption tolerated?

Sering kali optional FK menunjukkan model belum jelas.

Untuk staging/import, lebih baik pisahkan:

```text
raw_import_assignments
case_assignments
```

Jangan membuat production relation menampung fakta setengah benar tanpa predicate yang jelas.

---

## 11. Relational Algebra: Bahasa Mental di Balik SQL

Kamu tidak perlu menjadi matematikawan untuk menguasai SQL, tetapi memahami operasi dasar relational algebra membuat query jauh lebih jelas.

Operasi penting:

- selection
- projection
- join
- union
- difference
- intersection
- rename
- aggregation, secara SQL modern
- grouping, secara SQL modern

---

### 11.1 Selection

Selection memilih tuple berdasarkan predicate.

SQL:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Relational thinking:

```text
σ status='OPEN' (cases)
```

Artinya:

> Ambil subset tuple dari `cases` yang status-nya OPEN.

---

### 11.2 Projection

Projection memilih attribute tertentu.

SQL:

```sql
SELECT id, case_number
FROM cases;
```

Relational thinking:

```text
π id, case_number (cases)
```

Projection mengubah bentuk relation.

Dalam SQL, projection tidak otomatis menghilangkan duplicate kecuali pakai `DISTINCT`.

---

### 11.3 Join

Join menggabungkan relation berdasarkan predicate.

SQL:

```sql
SELECT c.id, c.case_number, a.officer_id
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id;
```

Relational thinking:

```text
cases ⋈ case_assignments
```

Join bukan “load child collection”. Join menghasilkan relation baru.

---

### 11.4 Union

SQL:

```sql
SELECT case_id
FROM case_assignments

UNION

SELECT case_id
FROM case_escalations;
```

Artinya:

> Case yang pernah punya assignment atau escalation.

`UNION` menghilangkan duplicate.

`UNION ALL` mempertahankan duplicate.

---

### 11.5 Difference

SQL:

```sql
SELECT id
FROM cases

EXCEPT

SELECT case_id
FROM case_assignments;
```

Artinya:

> Case yang tidak pernah punya assignment.

Berguna untuk finding gaps, reconciliation, data quality, dan audit.

---

### 11.6 Intersection

SQL:

```sql
SELECT case_id
FROM case_assignments

INTERSECT

SELECT case_id
FROM case_escalations;
```

Artinya:

> Case yang punya assignment dan escalation.

---

## 12. Declarative Thinking vs Imperative Thinking

### 12.1 Imperative Thinking

Dalam Java:

```java
Map<UUID, Integer> counts = new HashMap<>();

for (Evidence e : evidences) {
    UUID caseId = e.caseId();
    counts.put(caseId, counts.getOrDefault(caseId, 0) + 1);
}
```

Kamu menjelaskan step by step.

---

### 12.2 Declarative Thinking

Dalam SQL:

```sql
SELECT case_id, COUNT(*) AS evidence_count
FROM case_evidences
GROUP BY case_id;
```

Kamu menyatakan hasil yang diinginkan:

> Untuk setiap case_id, hitung jumlah evidence.

Database menentukan caranya.

Mungkin ia menggunakan:

- sequential scan
- hash aggregate
- sort aggregate
- parallel aggregate
- partition-wise aggregate
- index-only scan

Relational thinking berarti kamu berhenti mengontrol loop dan mulai merancang predicate, grain, constraint, dan transformation.

---

## 13. Query Result Juga Relation

Salah satu ide paling kuat:

> Hasil query adalah relation baru.

Contoh:

```sql
SELECT case_id, COUNT(*) AS evidence_count
FROM case_evidences
GROUP BY case_id;
```

Hasilnya relation:

```text
EvidenceCount(case_id, evidence_count)
```

Query lain bisa join ke hasil itu:

```sql
WITH evidence_counts AS (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
)
SELECT c.id, c.case_number, ec.evidence_count
FROM cases c
LEFT JOIN evidence_counts ec ON ec.case_id = c.id;
```

Ini composability.

Di Java, kamu sering membuat intermediate object.

Di SQL, kamu membuat intermediate relation.

CTE, subquery, view, materialized view, dan derived table semuanya memanfaatkan prinsip ini.

---

## 14. Closed World Assumption: Apa yang Tidak Ada di Database?

Database sering dipakai dengan asumsi:

> Jika fakta tidak ada di database, maka fakta itu tidak benar atau tidak diketahui sebagai benar.

Contoh:

```sql
SELECT *
FROM case_assignments
WHERE case_id = 'C1'
  AND ended_at IS NULL;
```

Jika tidak ada row, apakah artinya:

- case tidak assigned?
- assignment belum dimigrasi?
- data corrupt?
- access policy menyembunyikan row?
- assignment ada di sistem lain?
- query salah?

Relational model menyimpan fakta yang diketahui. Tapi makna absence harus dirancang.

Dalam sistem kompleks, absence adalah bagian dari domain semantics.

Contoh yang lebih eksplisit:

```text
case_assignment_status
- UNASSIGNED
- ASSIGNED
- SUSPENDED
- TRANSFER_PENDING
```

Kadang lebih aman menyimpan state eksplisit daripada menyimpulkan terlalu banyak dari ketiadaan row.

---

## 15. Open World vs Closed World di Sistem Terintegrasi

Dalam satu database OLTP, closed-world assumption sering masuk akal.

Tapi dalam sistem enterprise:

- ada data dari external regulator
- ada batch import
- ada event stream
- ada legacy system
- ada manual upload
- ada asynchronous integration
- ada eventual consistency

Maka absence bisa berarti:

```text
not yet received
not applicable
not authorized
not found
not synchronized
not valid
```

Ini penting dalam desain SQL karena memengaruhi:

- nullable column
- status table
- staging table
- reconciliation query
- idempotency key
- audit trail
- reporting accuracy

Top 1% SQL engineer tidak asal membuat `LEFT JOIN ... WHERE x IS NULL` tanpa memikirkan apa arti “tidak ada”.

---

## 16. Relationship Cardinality: 1:1, 1:N, M:N

### 16.1 One-to-One

Contoh:

```text
cases
case_confidential_details
```

Satu case punya maksimal satu confidential detail.

```sql
CREATE TABLE case_confidential_details (
    case_id UUID PRIMARY KEY REFERENCES cases(id),
    sealed_reason TEXT NOT NULL
);
```

`case_id` sebagai primary key memastikan satu row detail per case.

---

### 16.2 One-to-Many

Contoh:

```text
cases
case_evidences
```

Satu case punya banyak evidence.

```sql
CREATE TABLE case_evidences (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    evidence_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL
);
```

FK di sisi many.

---

### 16.3 Many-to-Many

Contoh:

```text
cases
parties
case_parties
```

Satu case punya banyak party. Satu party bisa terlibat di banyak case.

```sql
CREATE TABLE parties (
    id UUID PRIMARY KEY,
    legal_name TEXT NOT NULL
);

CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE
);

CREATE TABLE case_parties (
    case_id UUID NOT NULL REFERENCES cases(id),
    party_id UUID NOT NULL REFERENCES parties(id),
    role TEXT NOT NULL,

    PRIMARY KEY (case_id, party_id, role)
);
```

Join table bukan noise. Ia relation yang menyatakan fakta:

> Party tertentu berperan sebagai role tertentu dalam case tertentu.

Jika role punya detail tambahan, join table menjadi semakin penting:

```text
joined_at
ended_at
representation_status
liability_share
```

---

## 17. Relationship Direction: Database Tidak Berpikir Navigasi Object

Dalam Java:

```java
case.getAssignments()
assignment.getCase()
```

Object graph punya arah navigasi.

Dalam relational model, relationship berasal dari predicate dan matching values.

Kamu bisa query dari mana saja:

```sql
-- from case to assignment
SELECT *
FROM cases c
JOIN case_assignments a ON a.case_id = c.id;

-- from assignment to case
SELECT *
FROM case_assignments a
JOIN cases c ON c.id = a.case_id;
```

Arah query adalah kebutuhan analisis, bukan arah reference object.

Ini penting agar kamu tidak mendesain database hanya berdasarkan traversal object model.

---

## 18. Impedance Mismatch: OOP vs Relational

### 18.1 Apa Itu Object-Relational Impedance Mismatch?

Impedance mismatch adalah ketidaksesuaian antara model object dan model relational.

Beberapa sumber masalah:

| Area | OOP | Relational |
|---|---|---|
| Identity | Reference/object identity | Key/value identity |
| Relationship | Object reference | Foreign key + join |
| Collection | Nested collection | Separate relation |
| Inheritance | Class hierarchy | Table design strategy |
| Null | Null reference | SQL NULL + unknown |
| Behavior | Method | Constraint/query/procedure |
| Transaction | Often hidden in service | Explicit ACID boundary |
| Lazy access | Field navigation | Query execution |

ORM seperti Hibernate membantu mapping, tetapi tidak menghapus mismatch.

Ia hanya menyembunyikan sebagian.

---

### 18.2 Bahaya Menganggap ORM Menggantikan SQL

Dengan ORM, Java engineer sering menulis:

```java
caseRepository.findByStatus(CaseStatus.OPEN)
```

Tapi di baliknya tetap ada SQL.

Pertanyaan yang tetap harus dijawab:

- Query apa yang dihasilkan?
- Join apa yang terjadi?
- Index apa yang dipakai?
- Berapa row yang dibaca?
- Apakah ada N+1?
- Apakah transaction boundary benar?
- Apakah isolation level cukup?
- Apakah lazy loading terjadi di luar transaction?
- Apakah constraint database sejalan dengan entity validation?
- Apakah pagination stabil?

SQL mastery tetap diperlukan meskipun memakai ORM.

Bahkan, semakin tinggi abstraction, semakin penting kamu memahami apa yang disembunyikan.

---

## 19. Relation sebagai Boundary Kebenaran, Bukan Sekadar Storage

Database production sering menjadi sumber kebenaran utama.

Jika Java service crash, database tetap menyimpan state.

Jika message broker replay event, database menentukan apakah write idempotent.

Jika dua request race, database constraint menentukan apakah duplicate bisa terjadi.

Jika laporan audit dipertanyakan, database history menentukan bukti.

Karena itu relation harus dirancang sebagai boundary kebenaran.

Contoh buruk:

```sql
CREATE TABLE case_actions (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL,
    action_type TEXT NOT NULL,
    payload JSONB NOT NULL
);
```

Semua business invariant disimpan dalam `payload`.

Masalah:

- database tidak tahu apakah action valid
- query reporting sulit
- constraint lemah
- index sulit
- migration sulit
- data quality bergantung pada aplikasi
- audit defensibility rendah

Contoh lebih defensible:

```sql
CREATE TABLE enforcement_actions (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    action_type TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    issued_by UUID NOT NULL,
    legal_basis_code TEXT NOT NULL,
    status TEXT NOT NULL,

    CONSTRAINT enforcement_actions_status_valid
    CHECK (status IN ('DRAFT', 'ISSUED', 'WITHDRAWN', 'EXPIRED')),

    CONSTRAINT enforcement_actions_issued_after_case_opened
    -- cross-table constraint biasanya butuh trigger atau desain lain,
    -- tapi invariant ini tetap harus diidentifikasi secara eksplisit.
    CHECK (issued_at IS NOT NULL)
);
```

Tidak semua invariant bisa diekspresikan dengan `CHECK`, tetapi semua invariant penting harus diketahui.

---

## 20. How to Read a Table Like a Senior Engineer

Ketika melihat table, jangan hanya baca kolom.

Baca sebagai kontrak.

Contoh:

```sql
CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL REFERENCES officers(id),
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NULL
);
```

Pertanyaan senior:

1. Satu row merepresentasikan apa?
2. Apakah assignment historis atau current?
3. Apakah satu case boleh punya lebih dari satu active assignment?
4. Apakah satu officer boleh punya banyak active assignment?
5. Apakah `ended_at NULL` berarti masih aktif?
6. Apakah `ended_at > assigned_at` dijaga?
7. Apakah assignment bisa overlap?
8. Apakah ada transfer assignment?
9. Apakah assignment deletion diperbolehkan?
10. Apakah audit trail assignment disimpan?
11. Apakah query current assignment efisien?
12. Apakah ada index untuk `case_id`?
13. Apakah ada index untuk active assignment?
14. Apakah timezone disimpan benar?
15. Apakah constraint cukup untuk mencegah invalid lifecycle?
16. Apakah downstream reporting memahami grain?

Schema kecil bisa menyimpan banyak keputusan domain.

---

## 21. How to Read a Query Like a Senior Engineer

Contoh query:

```sql
SELECT
    c.id,
    c.case_number,
    o.name AS officer_name
FROM cases c
JOIN case_assignments a ON a.case_id = c.id
JOIN officers o ON o.id = a.officer_id
WHERE c.status = 'OPEN'
  AND a.ended_at IS NULL;
```

Pertanyaan senior:

1. Grain hasil query apa?
2. Apakah satu case bisa punya banyak active assignment?
3. Jika ya, apakah duplicate case diterima?
4. Jika tidak, apakah constraint menjaminnya?
5. Apakah case tanpa assignment harus muncul?
6. Jika iya, kenapa `JOIN`, bukan `LEFT JOIN`?
7. Apakah `a.ended_at IS NULL` adalah definisi current assignment?
8. Apakah ada partial index untuk active assignment?
9. Apakah status `OPEN` valid secara constraint?
10. Apakah query dipakai untuk UI, report, atau business decision?
11. Apakah ordering deterministic?
12. Apakah pagination akan aman?
13. Apakah read consistency perlu transaction khusus?

Query bukan hanya text. Query adalah klaim tentang domain.

---

## 22. Practical Mental Model: SQL Query as Relation Pipeline

PostgreSQL documentation menjelaskan table expression sebagai computed table: `FROM`, lalu optional `WHERE`, `GROUP BY`, dan `HAVING` membentuk table expression.

Mental model pipeline:

```text
FROM        -> tentukan sumber relation
JOIN        -> kombinasikan relation
WHERE       -> pilih tuple yang memenuhi predicate
GROUP BY    -> ubah grain menjadi group
HAVING      -> filter group
SELECT      -> bentuk output attribute
DISTINCT    -> hilangkan duplicate
ORDER BY    -> urutkan output
LIMIT       -> ambil subset output
```

Catatan penting:

Urutan ini adalah logical processing order, bukan jaminan physical execution order.

Optimizer boleh menjalankan secara berbeda selama hasil semantik sama.

---

## 23. Example: Dari Business Question ke Relational Query

Business question:

> Tampilkan semua open case yang belum punya active assignment.

Jangan langsung tulis SQL.

### Step 1 — Tentukan Grain

```text
one row per case
```

### Step 2 — Definisikan Predicate

Case harus:

```text
status = OPEN
and no active assignment exists
```

Active assignment:

```text
assignment.ended_at IS NULL
```

### Step 3 — Pilih Pola Query

Pola anti-join dengan `NOT EXISTS`:

```sql
SELECT
    c.id,
    c.case_number,
    c.opened_at
FROM cases c
WHERE c.status = 'OPEN'
  AND NOT EXISTS (
      SELECT 1
      FROM case_assignments a
      WHERE a.case_id = c.id
        AND a.ended_at IS NULL
  );
```

### Step 4 — Validasi Grain

Hasil tetap one row per case karena query utama hanya dari `cases`.

Subquery hanya mengecek existence, tidak menggandakan row.

### Step 5 — Review Invariant

Perlu constraint/index:

```sql
CREATE INDEX idx_case_assignments_active_by_case
ON case_assignments (case_id)
WHERE ended_at IS NULL;
```

Jika business rule mengatakan satu case hanya boleh punya satu active assignment, perlu constraint tambahan.

Di PostgreSQL bisa memakai partial unique index:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_per_case
ON case_assignments (case_id)
WHERE ended_at IS NULL;
```

Sekarang query dan invariant selaras.

---

## 24. Example: Kesalahan LEFT JOIN yang Sering Terjadi

Business question:

> Tampilkan semua case beserta active assignment jika ada.

Query salah:

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a ON a.case_id = c.id
WHERE a.ended_at IS NULL;
```

Masalah:

`WHERE a.ended_at IS NULL` bisa membuat reasoning ambigu.

Untuk unmatched row dari `LEFT JOIN`, kolom `a.ended_at` juga `NULL`, sehingga case tanpa assignment tetap muncul. Tapi query ini juga mencampur dua makna `NULL`:

- no assignment row exists
- assignment row exists and ended_at is null

Lebih jelas:

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.ended_at IS NULL;
```

Filter active assignment diletakkan pada join condition, bukan `WHERE`.

Sekarang maknanya:

> Untuk setiap case, join hanya assignment yang active jika ada.

Namun tetap perlu bertanya:

- Jika ada dua active assignments, apakah hasil duplicate diterima?
- Jika tidak, apakah constraint mencegahnya?

---

## 25. Example: Aggregate Bug karena Join

Business question:

> Hitung jumlah evidence per case.

Query awal:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id
GROUP BY c.id;
```

Ini benar jika hanya join ke evidence.

Tapi lalu ditambahkan assignment:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id
LEFT JOIN case_assignments a ON a.case_id = c.id
GROUP BY c.id;
```

Jika satu case punya 5 evidence dan 3 assignment, count menjadi 15.

Query menjadi salah karena join mengubah multiplicity sebelum aggregation.

Solusi:

Pre-aggregate evidence terlebih dahulu:

```sql
WITH evidence_counts AS (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
)
SELECT
    c.id,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN evidence_counts ec ON ec.case_id = c.id;
```

Jika butuh assignment summary, aggregate terpisah.

Prinsip:

> Aggregate pada grain yang benar sebelum join ke relation lain yang bisa memperbanyak row.

---

## 26. SQL Result Shape vs Java DTO Shape

Java DTO:

```java
record CaseSummaryDto(
    UUID caseId,
    String caseNumber,
    String status,
    int evidenceCount,
    String currentOfficerName
) {}
```

SQL harus menghasilkan:

```text
one row per case
```

Maka query harus menjaga grain tersebut.

Tidak boleh asal:

```sql
SELECT ...
FROM cases c
JOIN evidences e ...
JOIN assignments a ...
```

Karena DTO satu row per case, sedangkan join bisa menghasilkan one row per case-evidence-assignment combination.

Senior engineer mulai dari DTO grain:

```text
CaseSummaryDto = one row per case
```

Lalu semua child collection harus:

- aggregated
- selected as current single row
- queried separately
- represented as JSON aggregate secara sadar
- handled via application composition

Bukan dibiarkan menggandakan row diam-diam.

---

## 27. Relational Thinking untuk API Backend

Misalnya endpoint:

```http
GET /cases?status=OPEN&include=currentAssignment,evidenceCount
```

Walaupun endpoint HTTP tidak dibahas ulang di seri ini, SQL thinking-nya:

Response item grain:

```text
one row per case
```

Needed facts:

```text
case core attributes
current assignment if exists
evidence count
```

Possible SQL shape:

```sql
WITH evidence_counts AS (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
current_assignments AS (
    SELECT case_id, officer_id
    FROM case_assignments
    WHERE ended_at IS NULL
)
SELECT
    c.id,
    c.case_number,
    c.status,
    ca.officer_id,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN current_assignments ca ON ca.case_id = c.id
LEFT JOIN evidence_counts ec ON ec.case_id = c.id
WHERE c.status = 'OPEN';
```

Tapi ini hanya aman jika `current_assignments` one row per case.

Jika tidak dijamin, perlu pilih satu secara eksplisit:

```sql
WITH ranked_assignments AS (
    SELECT
        a.*,
        ROW_NUMBER() OVER (
            PARTITION BY a.case_id
            ORDER BY a.assigned_at DESC, a.id DESC
        ) AS rn
    FROM case_assignments a
    WHERE a.ended_at IS NULL
)
SELECT
    c.id,
    c.case_number,
    ra.officer_id
FROM cases c
LEFT JOIN ranked_assignments ra
  ON ra.case_id = c.id
 AND ra.rn = 1;
```

Tapi ini juga harus ditanya:

> Jika ada lebih dari satu active assignment, apakah memilih terbaru adalah business rule atau hanya menutupi data corruption?

Query bisa menyembunyikan masalah domain. Engineer senior membedakan query workaround dari invariant yang benar.

---

## 28. Relational Thinking untuk Regulatory/Case Management

Karena konteksmu dekat dengan regulatory systems dan enforcement lifecycle, relational thinking sangat relevan.

Sistem seperti ini biasanya penuh dengan:

- case lifecycle
- party relationships
- evidence chains
- assignments
- escalations
- decisions
- approvals
- audit events
- deadlines/SLA
- regulatory actions
- cross-entity impact

Di domain seperti ini, SQL bukan hanya reporting tool. SQL adalah alat untuk memastikan state yang tersimpan defensible.

Contoh invariant:

```text
A closed case must have at least one final decision.
An issued enforcement action must reference a legal basis.
An active assignment must reference an active officer.
A case cannot transition from CLOSED back to UNDER_REVIEW unless reopened through an approved process.
A party role must be valid for the case type.
A decision timestamp cannot be before case opened_at.
Only one current primary officer may exist per case.
```

Sebagian invariant bisa dijaga dengan:

- `NOT NULL`
- `CHECK`
- `FOREIGN KEY`
- `UNIQUE`
- partial unique index
- exclusion constraint
- trigger
- transaction logic
- workflow table design
- append-only event table
- stored procedure
- application service plus database constraint

Relational thinking membantu memilih invariant mana yang harus hidup di database, bukan hanya di Java code.

---

## 29. Anti-Pattern: “Database as Dumb Storage”

Pola buruk:

```text
Java service owns all logic.
Database only stores blobs/rows.
Constraints minimal.
Foreign keys omitted for flexibility.
Everything validated in application.
Reports query raw data with assumptions.
```

Awalnya terasa fleksibel.

Efek jangka panjang:

- duplicate business identity
- orphan rows
- invalid state
- migration sulit
- inconsistent reports
- debugging sulit
- manual data repair berisiko
- audit trail tidak defensible
- integration antar service rapuh
- performance tuning tidak punya struktur

SQL mastery berarti tahu kapan database harus menjadi passive storage dan kapan harus menjadi guardian of invariants.

Untuk sistem regulatory, database sebaiknya tidak bodoh. Ia harus menjaga minimal invariants yang menentukan kebenaran data.

---

## 30. Anti-Pattern: “Everything Is JSON”

Modern relational databases mendukung JSON. Itu berguna.

Tapi kesalahan umum:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    data JSONB NOT NULL
);
```

Lalu semua field domain masuk ke JSON:

```json
{
  "caseNumber": "C-001",
  "status": "OPEN",
  "assignment": {
    "officerId": "..."
  },
  "evidences": [...]
}
```

Masalah:

- constraint sulit
- foreign key sulit
- unique business key sulit
- query reporting sulit
- indexing kompleks
- migration opaque
- data quality buruk
- partial update risk
- schema drift
- audit query sulit

JSON cocok untuk:

- semi-structured metadata
- external payload snapshot
- low-value optional attributes
- schema-on-read analytics
- integration envelope
- rare extension fields

JSON buruk untuk:

- core identity
- lifecycle status
- financial amount
- legal basis
- ownership
- assignment
- relationship
- audit-critical field
- fields yang sering difilter/join/group

Relational thinking membedakan fakta inti dari metadata tambahan.

---

## 31. Anti-Pattern: EAV Abuse

EAV = Entity-Attribute-Value.

Contoh:

```sql
CREATE TABLE entity_attributes (
    entity_id UUID NOT NULL,
    attribute_name TEXT NOT NULL,
    attribute_value TEXT
);
```

Kadang berguna untuk dynamic metadata.

Tapi jika dipakai untuk core domain, query menjadi buruk:

```sql
SELECT e1.entity_id
FROM entity_attributes e1
JOIN entity_attributes e2 ON e2.entity_id = e1.entity_id
JOIN entity_attributes e3 ON e3.entity_id = e1.entity_id
WHERE e1.attribute_name = 'status'
  AND e1.attribute_value = 'OPEN'
  AND e2.attribute_name = 'jurisdiction'
  AND e2.attribute_value = 'ID'
  AND e3.attribute_name = 'riskLevel'
  AND e3.attribute_value = 'HIGH';
```

Masalah:

- type hilang
- constraint hilang
- optimizer sulit
- index rumit
- query verbose
- data quality rendah
- refactoring sulit
- reporting berat

EAV bisa diterima untuk extension attributes jika:

- attribute dictionary jelas
- type divalidasi
- scope terbatas
- tidak untuk core query
- ada governance
- ada indexing strategy
- ada archival strategy

---

## 32. Anti-Pattern: Comma-Separated Values

Buruk:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tags TEXT
);
```

Value:

```text
'high-risk,urgent,appeal'
```

Masalah:

- tidak bisa FK ke tag table
- query pakai string matching
- duplicate tag
- typo
- whitespace bug
- index buruk
- update sulit
- constraint sulit

Lebih relasional:

```sql
CREATE TABLE tags (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE case_tags (
    case_id UUID NOT NULL REFERENCES cases(id),
    tag_id UUID NOT NULL REFERENCES tags(id),
    PRIMARY KEY (case_id, tag_id)
);
```

Sekarang satu fakta tag assignment adalah satu tuple.

---

## 33. Anti-Pattern: Status Without Transition Model

Buruk:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL
);
```

Hanya menyimpan status current tanpa history.

Untuk domain lifecycle, ini sering tidak cukup.

Lebih baik:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    current_status TEXT NOT NULL
);

CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT
);
```

Sekarang kamu bisa menjawab:

- status sekarang apa?
- kapan berubah?
- siapa mengubah?
- dari status apa?
- kenapa berubah?
- apakah transisi valid?
- berapa lama di status tertentu?
- apakah SLA breached?

Relational thinking memisahkan:

```text
current state
historical facts
transition facts
```

---

## 34. Anti-Pattern: Missing Business Uniqueness

Buruk:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL
);
```

Tanpa unique constraint, database menerima:

```text
CASE-001
CASE-001
CASE-001
```

Java service mungkin mencegahnya, tapi race condition bisa tetap terjadi:

1. Request A cek CASE-001 belum ada
2. Request B cek CASE-001 belum ada
3. A insert
4. B insert
5. duplicate terjadi

Benar:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,

    CONSTRAINT uq_cases_jurisdiction_case_number
    UNIQUE (jurisdiction_code, case_number)
);
```

Unique constraint adalah concurrency-safe invariant.

---

## 35. Latihan Mental Model

### Latihan 1 — Tentukan Predicate

Diberikan table:

```sql
CREATE TABLE case_notes (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL,
    author_id UUID NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
```

Tulis predicate-nya.

Jawaban ideal:

> A note with identifier `id` was authored by `author_id` for case `case_id` with content `note_text` at time `created_at`.

Pertanyaan lanjut:

- Apakah note bisa diedit?
- Jika bisa, apakah update in-place atau history?
- Apakah author harus active user?
- Apakah note bisa dihapus?
- Apakah note_text boleh empty?
- Apakah note visibility perlu dimodelkan?

---

### Latihan 2 — Tentukan Grain

Query:

```sql
SELECT
    c.id,
    c.case_number,
    e.id AS evidence_id
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id;
```

Grain:

```text
one row per case-evidence pair, plus one row for case without evidence
```

Bukan one row per case.

---

### Latihan 3 — Cari Bug Multiplicity

Query:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count
FROM cases c
JOIN case_evidences e ON e.case_id = c.id
JOIN case_parties p ON p.case_id = c.id
GROUP BY c.id;
```

Bug:

Jika satu case punya banyak parties, evidence count akan dikalikan jumlah party.

Solusi:

Pre-aggregate evidence sebelum join ke parties, atau hilangkan join parties jika tidak dibutuhkan.

---

### Latihan 4 — Model Many-to-Many

Business rule:

> Satu officer dapat menangani banyak case. Satu case dapat ditangani banyak officer dengan role berbeda.

Model:

```sql
CREATE TABLE officers (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE
);

CREATE TABLE case_officers (
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL REFERENCES officers(id),
    role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    PRIMARY KEY (case_id, officer_id, role, assigned_at),

    CHECK (ended_at IS NULL OR ended_at > assigned_at)
);
```

Pertanyaan lanjut:

- Apakah satu case boleh punya lebih dari satu PRIMARY officer aktif?
- Jika tidak, butuh partial unique index.
- Apakah role harus enum/reference table?
- Apakah officer inactive boleh tetap assigned?
- Apakah assignment transfer perlu event terpisah?

---

## 36. Checklist: Relational Thinking Sebelum Menulis SQL

Sebelum menulis query, tanyakan:

```text
[ ] Apa grain hasil query?
[ ] Satu row merepresentasikan apa?
[ ] Relation apa saja yang dibutuhkan?
[ ] Predicate utama apa?
[ ] Apakah join akan mengubah multiplicity?
[ ] Apakah duplicate diharapkan?
[ ] Apakah perlu DISTINCT, atau DISTINCT hanya menutupi bug?
[ ] Apakah relationship optional?
[ ] Apakah LEFT JOIN atau INNER JOIN sesuai domain?
[ ] Apakah aggregation terjadi pada grain yang benar?
[ ] Apakah NULL punya makna jelas?
[ ] Apakah absence of row punya makna jelas?
[ ] Apakah query bergantung pada invariant yang dijaga database?
[ ] Apakah invariant itu benar-benar ada?
[ ] Apakah result shape cocok dengan DTO/report?
```

---

## 37. Checklist: Relational Thinking Saat Mendesain Table

Sebelum membuat table, tanyakan:

```text
[ ] Apa predicate table ini?
[ ] Apakah nama table mencerminkan fakta yang disimpan?
[ ] Apa arti satu row?
[ ] Apa primary key-nya?
[ ] Apa candidate/business key-nya?
[ ] Apa relationship ke table lain?
[ ] Apakah FK diperlukan?
[ ] Kolom mana yang wajib NOT NULL?
[ ] Kolom mana yang boleh NULL dan apa maknanya?
[ ] Apa CHECK constraint yang jelas?
[ ] Apa UNIQUE constraint yang menjaga business invariant?
[ ] Apakah ada lifecycle/history?
[ ] Apakah table ini current state, event history, atau reference data?
[ ] Apakah ada audit requirement?
[ ] Apakah ada retention requirement?
[ ] Query utama terhadap table ini apa?
[ ] Index apa yang kemungkinan dibutuhkan?
[ ] Apakah desain ini terlalu object-oriented?
[ ] Apakah desain ini terlalu JSON/EAV?
```

---

## 38. Checklist: Relational Thinking Saat Review PR

Saat review migration atau query SQL di PR:

```text
[ ] Apakah table baru punya predicate jelas?
[ ] Apakah constraint cukup, atau semua diserahkan ke Java?
[ ] Apakah FK sengaja dihilangkan? Apa alasannya?
[ ] Apakah query menjaga grain?
[ ] Apakah JOIN menyebabkan duplicate?
[ ] Apakah DISTINCT dipakai sebagai plester?
[ ] Apakah NOT IN aman terhadap NULL?
[ ] Apakah LEFT JOIN berubah menjadi INNER JOIN karena WHERE?
[ ] Apakah aggregate count bisa inflated?
[ ] Apakah pagination deterministic?
[ ] Apakah enum domain dijaga database?
[ ] Apakah migration aman untuk data existing?
[ ] Apakah query akan tetap benar ketika data tumbuh?
```

---

## 39. Mini Case Study: Designing Case Assignment Correctly

### 39.1 Business Requirement

> A regulatory case can be assigned to officers. A case must have at most one active primary officer, but may have multiple supporting officers. Assignment history must be preserved.

### 39.2 Naive Design

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    primary_officer_id UUID
);
```

Masalah:

- hanya menyimpan current primary officer
- history hilang
- supporting officers tidak terwakili
- assignment time tidak ada
- transfer tidak auditable
- officer FK mungkin tidak ada
- tidak ada reason
- tidak ada ended_at

---

### 39.3 Better Relational Design

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE,
    current_status TEXT NOT NULL
);

CREATE TABLE officers (
    id UUID PRIMARY KEY,
    officer_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    active BOOLEAN NOT NULL
);

CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL REFERENCES officers(id),
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    assigned_by UUID NOT NULL,
    reason TEXT,

    CHECK (assignment_role IN ('PRIMARY', 'SUPPORTING')),
    CHECK (ended_at IS NULL OR ended_at > assigned_at)
);
```

PostgreSQL-specific invariant:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### 39.4 Query Current Primary Officer

```sql
SELECT
    c.id,
    c.case_number,
    o.full_name AS primary_officer_name
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.assignment_role = 'PRIMARY'
 AND a.ended_at IS NULL
LEFT JOIN officers o
  ON o.id = a.officer_id;
```

Grain:

```text
one row per case
```

Aman karena partial unique index menjamin maksimal satu active primary assignment per case.

Tanpa index itu, query bisa duplicate.

Relational mastery adalah menyelaraskan:

```text
business rule
schema constraint
query assumption
application DTO
operational monitoring
```

---

## 40. Mini Case Study: Current State vs History

### 40.1 Requirement

> A case has a current status, and every status transition must be auditable.

### 40.2 Option A — Current Only

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL
);
```

Kelebihan:

- simple
- query current status mudah

Kekurangan:

- history hilang
- audit lemah
- tidak bisa analisis duration
- tidak bisa validasi transition path historis
- sulit menjawab “siapa mengubah status?”

---

### 40.3 Option B — History Only

```sql
CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL
);
```

Current status diambil dari latest transition.

Kelebihan:

- audit kuat
- append-only
- historical reconstruction

Kekurangan:

- current query lebih mahal
- perlu handle tie-breaking
- perlu constraint transisi
- perlu materialized current state atau index yang baik

---

### 40.4 Option C — Current + History

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE,
    current_status TEXT NOT NULL
);

CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT
);
```

Kelebihan:

- current query cepat
- history tersedia
- cocok untuk OLTP + audit

Kekurangan:

- harus menjaga consistency antara current dan history
- update status harus transactional
- tidak boleh update current tanpa insert transition

Transaction pattern:

```sql
BEGIN;

INSERT INTO case_status_transitions (
    id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
SELECT
    gen_random_uuid(),
    id,
    current_status,
    'ESCALATED',
    now(),
    :user_id,
    :reason
FROM cases
WHERE id = :case_id
  AND current_status = 'UNDER_REVIEW';

UPDATE cases
SET current_status = 'ESCALATED'
WHERE id = :case_id
  AND current_status = 'UNDER_REVIEW';

COMMIT;
```

Di production, perlu memastikan kedua statement affect row sesuai ekspektasi dan berjalan dalam transaction boundary yang benar.

---

## 41. Common Misconceptions

### Misconception 1 — “SQL Table Sama dengan Java Class”

Tidak. Table menyimpan fakta. Class memodelkan behavior dan object identity.

---

### Misconception 2 — “JOIN Itu Mengambil Child Object”

Tidak. Join menghasilkan relation baru dengan kombinasi tuple yang memenuhi predicate.

---

### Misconception 3 — “Duplicate Bisa Dibereskan dengan DISTINCT”

Kadang bisa, tapi sering menutupi bug grain atau join.

Jika kamu butuh `DISTINCT`, tanyakan dulu:

> Duplicate ini wajar atau hasil desain query yang salah?

---

### Misconception 4 — “Foreign Key Membuat Query Lambat, Jadi Hindari”

Foreign key punya biaya, tetapi menghapus FK berarti menghapus database-level referential integrity. Dalam sistem yang butuh auditability dan correctness, itu keputusan serius, bukan default.

---

### Misconception 5 — “Semua Constraint Bisa di Java”

Tidak aman untuk invariant penting, terutama saat ada:

- concurrency
- multiple services
- manual operations
- migrations
- ETL
- admin scripts
- replay events
- integration jobs

Database constraint adalah garis pertahanan terakhir.

---

### Misconception 6 — “NULL Itu Sama dengan Kosong”

Tidak. SQL `NULL` merepresentasikan missing/unknown/inapplicable tergantung desain. Ia berinteraksi dengan three-valued logic. Ini akan dibahas detail di part 003.

---

### Misconception 7 — “Kalau Query Benar di Sample Data, Berarti Benar”

Sample data sering tidak mengandung edge cases:

- duplicate child rows
- missing relationship
- null values
- historical records
- overlapping assignments
- invalid state
- concurrent writes
- timezone boundary
- large cardinality

Query correctness harus dibuktikan terhadap model data, bukan hanya dicoba di dataset kecil.

---

## 42. Practical Heuristics

### Heuristic 1 — Always Name the Grain

Sebelum query:

```text
This query returns one row per ______.
```

Jika kamu tidak bisa mengisi bagian kosong, jangan lanjut.

---

### Heuristic 2 — Avoid Joining Multiple One-to-Many Relations Directly

Jika query utama one row per parent, dan kamu join banyak child table, kemungkinan terjadi row multiplication.

Gunakan:

- pre-aggregation
- subquery
- CTE
- lateral join
- separate query
- JSON aggregation dengan sadar
- window function untuk memilih satu child row

---

### Heuristic 3 — DISTINCT Is a Smell, Not Always a Bug

`DISTINCT` valid untuk pertanyaan set:

```sql
SELECT DISTINCT status FROM cases;
```

Tapi mencurigakan jika dipakai untuk menghapus duplicate akibat join:

```sql
SELECT DISTINCT c.*
FROM cases c
JOIN case_assignments a ON a.case_id = c.id;
```

Tanyakan:

> Kenapa duplicate muncul?

---

### Heuristic 4 — Foreign Key Is a Domain Statement

FK bukan hanya performance/DBA concern.

Ia menyatakan:

> Fakta ini tidak boleh ada tanpa fakta induknya.

---

### Heuristic 5 — Unique Constraint Is a Concurrency Tool

Cek manual di aplikasi tidak cukup.

```java
if (!caseRepository.existsByCaseNumber(caseNumber)) {
    caseRepository.save(newCase);
}
```

Race condition tetap mungkin.

Unique constraint membuat database menjadi arbiter final.

---

### Heuristic 6 — Model History Explicitly

Jika domain perlu menjawab:

```text
when?
who?
why?
from what?
to what?
under what authority?
```

maka jangan hanya simpan current value.

---

### Heuristic 7 — Separate Core Facts from Flexible Metadata

Core facts layak menjadi column dengan type dan constraint.

Flexible metadata boleh JSON/EAV jika governance jelas.

---

## 43. Koneksi ke Part Berikutnya

Part ini membahas cara berpikir relasional secara konseptual.

Part berikutnya akan masuk ke language model SQL:

```text
DDL
DML
DQL
DCL
TCL
```

Kita akan memetakan kategori statement SQL ke lifecycle sistem nyata:

- mendefinisikan struktur
- membaca data
- mengubah data
- mengontrol akses
- mengontrol transaksi

Ini penting karena SQL bukan hanya `SELECT`. SQL adalah bahasa lengkap untuk mendesain, mengubah, mengamankan, dan mengoperasikan database.

---

## 44. Ringkasan Bagian Ini

Hal paling penting dari part 001:

1. Table bukan class.
2. Row bukan object.
3. Foreign key bukan pointer.
4. Relation adalah kumpulan tuple/fakta.
5. Predicate adalah makna dari table.
6. SQL bekerja dengan deklarasi hasil, bukan instruksi loop.
7. Query result juga relation.
8. SQL memakai bag/multiset semantics, sehingga duplicate harus dipahami.
9. Grain adalah pertanyaan pertama sebelum menulis query.
10. Join dapat mengubah multiplicity.
11. Constraint adalah invariant domain, bukan dekorasi.
12. Database bukan sekadar storage jika correctness penting.
13. ORM tidak menghapus kebutuhan memahami SQL.
14. Relational thinking adalah fondasi untuk join, aggregation, normalization, indexing, transaction, dan performance.

Jika kamu hanya mengingat satu kalimat:

> SQL mastery dimulai ketika kamu berhenti melihat table sebagai object storage dan mulai melihat relation sebagai kumpulan fakta yang dikontrol oleh predicate, key, constraint, dan transformation.

---

## 45. Referensi

1. ISO — `ISO/IEC 9075-1:2023`, Database languages SQL — Part 1: Framework.  
   https://www.iso.org/standard/76583.html

2. PostgreSQL Documentation — SQL Conformance.  
   https://www.postgresql.org/docs/current/features.html

3. PostgreSQL Documentation — Table Expressions.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html

4. PostgreSQL Documentation — Tutorial, relational database concepts and SQL language.  
   https://www.postgresql.org/docs/current/tutorial.html

5. E. F. Codd — `A Relational Model of Data for Large Shared Data Banks`, Communications of the ACM, 1970.  
   https://dl.acm.org/doi/10.1145/362384.362685

6. Public PDF copy of Codd paper.  
   https://kataix.umag.cl/~jaguila/Databases/Paper_Codd.pdf

---

## 46. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-002.md` — SQL Language Model: DDL, DML, DQL, DCL, TCL


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-000.md">⬅️ Part 0 — Orientation: What It Means to Master SQL as a Java Engineer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-002.md">Part 2 — SQL Language Model: DDL, DML, DQL, DCL, TCL ➡️</a>
</div>
