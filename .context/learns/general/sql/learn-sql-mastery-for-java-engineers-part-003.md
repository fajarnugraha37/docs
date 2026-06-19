# learn-sql-mastery-for-java-engineers-part-003.md

# Part 3 — Data Types, NULL, Three-Valued Logic, and Semantic Correctness

> Seri: SQL Mastery for Java Engineers  
> Bagian: 003 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-002.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-004.md`

---

## 0. Tujuan Bagian Ini

Bagian ini membahas salah satu fondasi paling sering diremehkan dalam SQL: **tipe data dan makna nilai**.

Banyak engineer menganggap tipe data hanya detail teknis:

```sql
id UUID
name TEXT
amount DECIMAL
created_at TIMESTAMP
status VARCHAR(20)
```

Padahal tipe data adalah bagian dari domain model.

Tipe data menentukan:

- nilai apa yang boleh disimpan
- operasi apa yang valid
- bagaimana comparison dilakukan
- bagaimana index bekerja
- bagaimana sorting dilakukan
- bagaimana precision dijaga
- bagaimana timezone ditafsirkan
- bagaimana Java membaca/menulis data
- bagaimana constraint dapat diekspresikan
- bagaimana bug semantik muncul atau dicegah

Di SQL, bug tipe data sering lebih berbahaya daripada syntax error karena query tetap jalan tetapi hasilnya salah.

Contoh:

```sql
WHERE closed_at = NULL
```

Query ini tidak error, tetapi hampir pasti salah.

Contoh lain:

```sql
WHERE created_at BETWEEN '2026-01-01' AND '2026-01-31'
```

Query ini terlihat benar, tapi bisa kehilangan data pada tanggal 31 setelah jam 00:00:00.

Contoh lain:

```sql
amount FLOAT
```

Untuk nilai uang, ini bisa menghasilkan rounding error yang sulit dilacak.

Contoh lain:

```sql
status TEXT NOT NULL
```

Tanpa constraint, database menerima `OPNE`, `open`, `Closed`, atau string kosong.

Bagian ini bertujuan membangun mental model yang tepat untuk:

- numeric types
- text/string types
- boolean
- date/time/timestamp/timezone
- UUID
- JSON/JSONB
- enum/domain/custom types
- binary data
- `NULL`
- three-valued logic
- type conversion
- Java mapping
- semantic correctness

---

## 1. Prinsip Utama: Type Is Domain Semantics

Tipe data bukan hanya ukuran storage.

Tipe data adalah klaim:

```text
Kolom ini hanya boleh berisi value dengan bentuk dan operasi tertentu.
```

Contoh:

```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY,
    amount NUMERIC(19, 4) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL
);
```

Statement ini mengandung beberapa klaim domain:

- `id` adalah identifier, bukan angka yang dihitung.
- `amount` butuh precision fixed, bukan approximate floating point.
- `currency_code` harus tiga karakter, walaupun masih perlu FK/check untuk validitas.
- `paid_at` adalah timestamp absolute yang perlu timezone-aware.
- semua field wajib ada.

Jika dibuat longgar:

```sql
CREATE TABLE payments (
    id TEXT,
    amount FLOAT,
    currency TEXT,
    paid_at TEXT
);
```

Database menjadi hampir tidak menjaga kebenaran.

Aplikasi Java mungkin punya validation, tetapi database tetap bisa menerima data buruk dari:

- migration
- manual SQL
- admin tool
- ETL
- batch import
- integration service
- test script
- old application version
- emergency fix
- replication/replay process

Top 1% SQL engineer melihat tipe data sebagai **garis pertahanan pertama** untuk domain correctness.

---

## 2. Type Choice Memiliki Konsekuensi Sistemik

Pemilihan tipe data memengaruhi banyak hal.

| Area | Dampak tipe data |
|---|---|
| Correctness | apakah value valid bisa dibedakan dari invalid |
| Constraint | apakah invariant mudah diekspresikan |
| Index | apakah index efektif dan kecil |
| Query | apakah comparison dan sorting benar |
| Storage | ukuran row, cache efficiency |
| Performance | CPU cost, cast cost, index lookup |
| Java mapping | class Java yang cocok |
| Migration | perubahan tipe bisa mahal |
| Reporting | aggregation dan formatting |
| Integration | serialisasi/deserialisasi |
| Security | PII, binary, token, encrypted value |
| Auditability | apakah historical value dapat dipercaya |

Contoh sederhana:

```sql
case_number TEXT
```

vs:

```sql
case_number VARCHAR(30)
```

vs:

```sql
case_number CASE_NUMBER_DOMAIN
```

Pertanyaannya bukan hanya “mana yang lebih cepat”, tetapi:

- apakah panjang case number punya batas domain?
- apakah case number case-sensitive?
- apakah formatnya valid?
- apakah ada jurisdiction prefix?
- apakah perlu unique per jurisdiction?
- apakah sorting lexicographic sesuai business expectation?
- apakah value ini PII?
- apakah akan dipakai di URL/API?
- apakah akan diintegrasikan dengan external system?

---

## 3. Numeric Types

Numeric types terbagi kasar menjadi:

1. integer/exact whole number
2. fixed/exact decimal
3. approximate floating point

Kesalahan paling umum:

> Menggunakan floating point untuk nilai yang memerlukan exactness.

---

## 4. Integer Types

Umum di banyak database:

```text
SMALLINT
INTEGER / INT
BIGINT
```

Vendor bisa punya variasi:

- `TINYINT`
- `SERIAL`
- `BIGSERIAL`
- identity columns
- unsigned integer, terutama MySQL
- sequence-backed integer

### 4.1 Kapan Menggunakan Integer

Integer cocok untuk:

- count
- quantity whole number
- version number
- sequence number
- retry count
- priority rank
- enum code jika dikelola hati-hati
- synthetic numeric primary key

Contoh:

```sql
CREATE TABLE case_retry_jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id UUID NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,

    CHECK (retry_count >= 0)
);
```

### 4.2 Overflow

Jangan anggap `INTEGER` selalu cukup.

`INTEGER` signed biasanya sekitar -2.1 miliar sampai 2.1 miliar.

Untuk table besar, event log, audit trail, atau sequence jangka panjang, `BIGINT` lebih aman.

Contoh buruk:

```sql
CREATE TABLE audit_events (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);
```

Jika sistem menghasilkan jutaan event per hari, batas integer bisa tercapai.

Lebih aman:

```sql
CREATE TABLE audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);
```

### 4.3 Integer untuk Identifier: Hati-Hati

Integer sequence sebagai primary key umum dan valid. Tapi pahami trade-off:

Kelebihan:

- kecil
- index compact
- locality bagus
- join efisien
- mudah debug

Kekurangan:

- mudah ditebak jika diekspos
- koordinasi multi-region/multi-writer lebih sulit
- merge data antar sistem bisa bentrok
- bisa mengungkap volume data
- sequence gap normal terjadi

Jika identifier diekspos ke publik, pertimbangkan:

- UUID
- ULID
- public opaque ID terpisah
- hashids, dengan caveat
- natural public reference number

---

## 5. Decimal / Numeric Types

Untuk nilai exact decimal, gunakan:

```sql
NUMERIC(p, s)
DECIMAL(p, s)
```

Biasanya `NUMERIC` dan `DECIMAL` setara atau sangat mirip.

Contoh:

```sql
amount NUMERIC(19, 4)
```

Artinya:

- total digit precision: 19
- scale setelah decimal point: 4

Cocok untuk:

- uang
- fee
- rate
- percentage exact
- tax
- measurement yang butuh exact decimal
- regulatory threshold

### 5.1 Uang Jangan Pakai FLOAT

Buruk:

```sql
amount FLOAT
```

Karena floating point binary tidak merepresentasikan banyak decimal secara exact.

Contoh konseptual:

```text
0.1 + 0.2 != exactly 0.3
```

Untuk payment/regulatory penalty:

```sql
penalty_amount NUMERIC(19, 2) NOT NULL
```

atau jika butuh minor unit:

```sql
penalty_amount_minor BIGINT NOT NULL
currency_code CHAR(3) NOT NULL
```

Pattern minor unit:

```text
10000 IDR -> amount_minor = 10000
10.50 USD -> amount_minor = 1050
```

Tapi currency punya decimal place berbeda, sehingga minor unit tetap perlu currency awareness.

### 5.2 Precision dan Scale Harus Domain-Driven

Contoh:

```sql
tax_rate NUMERIC(9, 6)
```

Jika tax rate perlu 6 digit decimal.

Contoh:

```sql
risk_score NUMERIC(5, 2)
```

Jika risk score 0.00 sampai 999.99.

Tambahkan constraint:

```sql
CHECK (risk_score >= 0 AND risk_score <= 100)
```

Tipe data saja tidak cukup.

---

## 6. Floating Point Types

Umum:

```text
REAL
DOUBLE PRECISION
FLOAT
```

Cocok untuk:

- scientific measurement
- approximate analytics
- ML feature
- sensor reading
- probability approximation
- geospatial calculation internal
- performance metric

Tidak cocok untuk:

- uang
- legal threshold exact
- tax
- fee
- count
- identifier
- equality comparison domain-critical

### 6.1 Equality Comparison pada Float

Buruk:

```sql
WHERE score = 0.3
```

Lebih aman untuk approximate domain:

```sql
WHERE ABS(score - 0.3) < 0.000001
```

Namun untuk SQL business domain, jika kamu butuh equality exact, kemungkinan tipe datanya harus `NUMERIC`, bukan float.

---

## 7. Text/String Types

Umum:

```text
CHAR(n)
VARCHAR(n)
TEXT
```

Vendor berbeda dalam implementasi/performance detail.

### 7.1 TEXT vs VARCHAR

Di PostgreSQL, `TEXT` dan `VARCHAR` tanpa batas sering punya karakteristik mirip. Di database lain, perbedaan bisa lebih signifikan.

Pertanyaan domain:

- Apakah panjang maksimum bermakna?
- Apakah value harus fixed length?
- Apakah perlu check format?
- Apakah case-sensitive?
- Apakah whitespace harus significant?
- Apakah collation memengaruhi sorting/search?
- Apakah perlu full-text search?
- Apakah value sensitif/PII?

### 7.2 CHAR(n)

`CHAR(n)` fixed length dan bisa padding space tergantung vendor.

Cocok untuk:

- kode fixed-length yang benar-benar fixed
- ISO country code
- currency code, dengan catatan validation tetap perlu

Contoh:

```sql
currency_code CHAR(3) NOT NULL
```

Tapi `CHAR(3)` hanya memastikan panjang, bukan memastikan currency valid.

Lebih baik:

```sql
CREATE TABLE currencies (
    code CHAR(3) PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE penalties (
    id UUID PRIMARY KEY,
    amount NUMERIC(19, 2) NOT NULL,
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code)
);
```

### 7.3 VARCHAR(n)

Cocok jika domain punya batas panjang.

Contoh:

```sql
case_number VARCHAR(40) NOT NULL
```

Tapi jangan asal membuat semua string `VARCHAR(255)`.

`255` sering warisan kebiasaan lama, bukan domain rule.

Tanya:

```text
Kenapa 255?
Apa yang terjadi kalau lebih?
Apakah external system punya batas?
Apakah UI punya batas?
Apakah legal format punya batas?
```

### 7.4 TEXT

Cocok untuk:

- description
- notes
- comments
- free-form text
- JSON string representation, meskipun JSON type lebih baik jika ingin query JSON
- external payload raw, bila sengaja

Contoh:

```sql
note_text TEXT NOT NULL
```

Tambahkan constraint jika empty string tidak valid:

```sql
CHECK (length(trim(note_text)) > 0)
```

---

## 8. Collation, Case Sensitivity, and Text Comparison

Text comparison bukan hanya byte comparison.

Database menggunakan collation untuk menentukan:

- sorting
- case sensitivity
- accent sensitivity
- locale-specific rules

Contoh:

```sql
ORDER BY legal_name;
```

Hasilnya bisa berbeda tergantung collation.

### 8.1 Case-Insensitive Search

Buruk untuk index biasa:

```sql
WHERE lower(email) = lower(:email)
```

Ini bisa membuat index biasa pada `email` tidak terpakai kecuali ada expression index.

PostgreSQL-style:

```sql
CREATE INDEX idx_users_lower_email
ON users (lower(email));
```

Lalu:

```sql
WHERE lower(email) = lower(:email)
```

Atau gunakan tipe/fitur case-insensitive jika vendor mendukung.

### 8.2 Email Case Sensitivity

Email technically memiliki nuance, tapi secara aplikasi biasanya diperlakukan case-insensitive untuk domain part dan sering juga local part.

Praktik umum:

- normalize email ke lowercase
- simpan original jika perlu display
- enforce unique pada normalized email

Contoh:

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email_original TEXT NOT NULL,
    email_normalized TEXT NOT NULL UNIQUE,

    CHECK (email_normalized = lower(email_normalized))
);
```

---

## 9. Boolean Types

Boolean biasanya punya nilai:

```text
TRUE
FALSE
NULL, jika nullable
```

Contoh:

```sql
active BOOLEAN NOT NULL DEFAULT TRUE
```

### 9.1 Boolean Nullable Berarti Tiga State

```sql
verified BOOLEAN
```

Value:

```text
TRUE
FALSE
NULL
```

Apa arti `NULL`?

- belum diverifikasi?
- tidak berlaku?
- tidak diketahui?
- data lama?
- user belum submit?

Jika tiga state memang domain-valid, pertimbangkan enum/status yang eksplisit:

```sql
verification_status TEXT NOT NULL
CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'NOT_APPLICABLE'));
```

Boolean nullable sering membuat query ambigu.

### 9.2 Hindari Boolean yang Terlalu Banyak

Contoh buruk:

```sql
is_open BOOLEAN
is_closed BOOLEAN
is_cancelled BOOLEAN
is_escalated BOOLEAN
```

Bisa menghasilkan state invalid:

```text
is_open = true
is_closed = true
```

Lebih baik:

```sql
status TEXT NOT NULL
CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED', 'ESCALATED'))
```

Boolean cocok untuk independent property, bukan mutually exclusive lifecycle state.

---

## 10. Date and Time Types

Ini sumber bug besar di aplikasi Java.

Umum:

```text
DATE
TIME
TIMESTAMP
TIMESTAMP WITH TIME ZONE
TIMESTAMP WITHOUT TIME ZONE
INTERVAL
```

Vendor naming/semantics berbeda.

### 10.1 DATE

`DATE` menyimpan tanggal tanpa waktu.

Cocok untuk:

- birth date
- business date
- filing date
- effective date jika hanya tanggal
- due date berbasis tanggal
- holiday calendar

Contoh:

```sql
filing_date DATE NOT NULL
```

Jangan pakai timestamp jika domain memang tanggal.

### 10.2 TIME

`TIME` menyimpan jam tanpa tanggal.

Cocok untuk:

- office opening time
- schedule template
- daily cutoff time

Namun `TIME` tanpa timezone bisa ambigu jika dipakai untuk event actual.

### 10.3 TIMESTAMP WITHOUT TIME ZONE

Menyimpan tanggal+waktu tanpa offset/timezone.

Cocok untuk:

- local civil time yang sengaja tidak absolute
- jadwal lokal berulang
- kalender domain tertentu

Berbahaya untuk event actual lintas timezone.

Contoh ambiguous:

```text
2026-03-29 02:30
```

Di beberapa timezone, waktu ini bisa tidak ada karena DST.

Indonesia tidak punya DST saat ini, tetapi sistem enterprise sering lintas wilayah.

### 10.4 TIMESTAMP WITH TIME ZONE / TIMESTAMPTZ

Biasanya merepresentasikan instant absolute.

Cocok untuk:

- created_at
- updated_at
- event occurred_at
- audit timestamp
- login time
- payment time
- decision issued_at
- message received_at

Contoh:

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Untuk sistem audit/regulatory, event actual sebaiknya timezone-aware atau disimpan sebagai instant.

---

## 11. Timezone Mental Model untuk Java Engineer

Java punya beberapa type:

```text
Instant
OffsetDateTime
ZonedDateTime
LocalDateTime
LocalDate
LocalTime
Duration
Period
```

Mapping konseptual:

| Domain Need | Java Type | SQL Type |
|---|---|---|
| absolute moment | `Instant` | `TIMESTAMPTZ` |
| moment with explicit offset | `OffsetDateTime` | `TIMESTAMPTZ` atau vendor-specific |
| local date-time without zone | `LocalDateTime` | `TIMESTAMP WITHOUT TIME ZONE` |
| date only | `LocalDate` | `DATE` |
| time only | `LocalTime` | `TIME` |
| duration | `Duration` | interval/seconds numeric |
| calendar period | `Period` | app-level or interval carefully |

### 11.1 `LocalDateTime` untuk Audit Timestamp adalah Smell

Buruk:

```java
LocalDateTime createdAt;
```

untuk event actual.

Karena `LocalDateTime` tidak tahu timezone/offset. Ia bukan instant global.

Lebih baik:

```java
Instant createdAt;
```

atau:

```java
OffsetDateTime createdAt;
```

Di database:

```sql
created_at TIMESTAMPTZ NOT NULL
```

### 11.2 Simpan Timezone Asal Jika Penting

Untuk audit, instant cukup untuk urutan global.

Tapi untuk pengalaman user/legal local time, simpan juga timezone atau jurisdiction.

Contoh:

```sql
occurred_at TIMESTAMPTZ NOT NULL,
occurred_timezone TEXT,
occurred_local_date DATE
```

Tergantung domain.

Jika legal deadline berbasis local jurisdiction date, jangan hanya mengandalkan UTC instant tanpa model kalender lokal.

---

## 12. Date Range Filtering: Inclusive vs Exclusive

Bug umum:

```sql
WHERE created_at BETWEEN TIMESTAMP '2026-01-01'
                     AND TIMESTAMP '2026-01-31'
```

Ini mencakup:

```text
2026-01-31 00:00:00
```

tapi tidak mencakup:

```text
2026-01-31 10:30:00
```

Lebih aman:

```sql
WHERE created_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND created_at <  TIMESTAMPTZ '2026-02-01 00:00:00+00'
```

Pattern:

```text
[start, end)
```

atau inclusive start, exclusive end.

Ini sangat penting untuk:

- daily report
- monthly report
- audit period
- SLA calculation
- billing cycle
- regulatory reporting window

### 12.1 Untuk DATE

Jika column adalah `DATE`, ini aman:

```sql
WHERE filing_date BETWEEN DATE '2026-01-01' AND DATE '2026-01-31'
```

Karena tidak ada waktu.

Tipe data yang tepat menyederhanakan query.

---

## 13. UUID Types

UUID cocok untuk identifier unik lintas node/sistem.

Contoh:

```sql
id UUID PRIMARY KEY
```

Kelebihan:

- global uniqueness
- cocok distributed system
- tidak mudah ditebak
- merge antar system lebih mudah
- tidak mengungkap volume

Kekurangan:

- lebih besar dari integer
- random UUID dapat membuat index locality buruk
- debugging manual sedikit lebih sulit
- URL panjang
- generation strategy perlu dipilih

### 13.1 UUID v4 vs Time-Ordered IDs

UUID v4 random.

Dampak:

- insert ke B-tree index menyebar
- page split lebih banyak
- cache locality lebih buruk dibanding sequence

Alternatif:

- UUID v7
- ULID
- database sequence
- Snowflake-like ID
- ordered UUID variant

Jika database/vendor sudah mendukung UUID v7 atau time-ordered UUID, pertimbangkan untuk high-write table.

Namun jangan optimasi prematur. Untuk banyak aplikasi, UUID v4 cukup.

### 13.2 Jangan Simpan UUID sebagai TEXT Jika Ada Native Type

Buruk:

```sql
id TEXT PRIMARY KEY
```

Lebih baik:

```sql
id UUID PRIMARY KEY
```

Native UUID memberi:

- validation format
- storage lebih efisien
- operator/index yang sesuai
- driver mapping lebih jelas

---

## 14. JSON / JSONB Types

Modern relational database sering mendukung JSON.

PostgreSQL:

```sql
metadata JSONB
```

MySQL:

```sql
metadata JSON
```

SQL Server/Oracle punya pendekatan sendiri.

JSON cocok untuk:

- optional metadata
- external payload snapshot
- flexible integration data
- rarely queried extension fields
- audit raw payload
- semi-structured attributes
- feature flags/config snapshot

JSON buruk untuk core relational facts:

- status
- identity
- foreign key
- amount
- timestamp utama
- lifecycle state
- assignment
- ownership
- legal basis
- fields yang sering difilter/join/group
- fields yang butuh constraint kuat

### 14.1 Hybrid Model

Baik:

```sql
CREATE TABLE case_events (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_id UUID,
    payload JSONB NOT NULL,

    CHECK (event_type IN ('CASE_OPENED', 'CASE_ASSIGNED', 'CASE_ESCALATED', 'CASE_CLOSED'))
);
```

Core query fields dijadikan column:

- case_id
- event_type
- occurred_at
- actor_id

Detail event fleksibel masuk JSON.

### 14.2 JSON Constraint

Jika field JSON penting, lebih baik naikkan menjadi column.

Bisa saja membuat check expression pada JSON, tetapi biasanya lebih rumit dan vendor-specific.

Jika kamu sering menulis:

```sql
WHERE payload ->> 'status' = 'OPEN'
```

mungkin `status` harus menjadi column.

---

## 15. Enum, Domain, and Reference Tables

Untuk value terbatas, ada beberapa pilihan:

1. check constraint
2. database enum type
3. domain type
4. reference table
5. application enum only

### 15.1 CHECK Constraint

```sql
status TEXT NOT NULL
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED'));
```

Kelebihan:

- sederhana
- jelas
- portable relatif baik
- mudah dibaca

Kekurangan:

- update value butuh alter constraint
- reuse antar table copy-paste

### 15.2 Database Enum

PostgreSQL:

```sql
CREATE TYPE case_status AS ENUM (
    'OPEN',
    'UNDER_REVIEW',
    'ESCALATED',
    'CLOSED'
);
```

Kelebihan:

- domain jelas
- compact
- reusable

Kekurangan:

- vendor-specific
- mengubah enum bisa punya caveat
- mapping ORM perlu diperhatikan

### 15.3 Reference Table

```sql
CREATE TABLE case_statuses (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    terminal BOOLEAN NOT NULL
);
```

Lalu:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    status_code TEXT NOT NULL REFERENCES case_statuses(code)
);
```

Kelebihan:

- bisa punya metadata
- bisa dikelola data-driven
- cocok untuk status yang punya rule/label/order
- mudah query/reporting

Kekurangan:

- join tambahan
- perlu seed/migration data
- tidak semua constraint transisi otomatis terjaga

### 15.4 Application Enum Only

Java:

```java
enum CaseStatus {
    OPEN, UNDER_REVIEW, ESCALATED, CLOSED
}
```

Database:

```sql
status TEXT NOT NULL
```

Ini paling lemah jika tidak ada constraint database.

Application enum bagus, tapi harus selaras dengan database constraint.

---

## 16. Binary Data

Umum:

```text
BLOB
BYTEA
VARBINARY
RAW
```

Binary data cocok untuk:

- file kecil
- hash
- encrypted payload
- signature
- certificate
- binary token
- compressed data

Pertanyaan desain:

- apakah file sebaiknya di database atau object storage?
- apakah binary perlu versioning?
- apakah perlu checksum?
- apakah perlu encryption?
- apakah perlu streaming?
- apakah backup database akan membesar?
- apakah query butuh metadata saja?

Pattern umum:

```sql
CREATE TABLE evidence_files (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    storage_uri TEXT NOT NULL,
    sha256_hash BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL,

    CHECK (size_bytes > 0)
);
```

Simpan file di object storage, metadata dan hash di database.

Untuk regulatory evidence, hash sangat penting untuk integrity proof.

---

## 17. NULL: Bukan Zero, Bukan Empty String, Bukan False

`NULL` adalah salah satu sumber bug terbesar di SQL.

`NULL` berarti value tidak ada/unknown/inapplicable, tergantung desain.

Yang penting:

```text
NULL bukan 0
NULL bukan ''
NULL bukan false
NULL bukan tanggal kosong
NULL bukan UUID kosong
```

Contoh:

```sql
SELECT 1 = NULL;
```

Hasil bukan `TRUE` atau `FALSE`, tetapi `UNKNOWN`.

Karena itu:

```sql
WHERE column = NULL
```

tidak akan match seperti yang kamu harapkan.

Gunakan:

```sql
WHERE column IS NULL
```

atau:

```sql
WHERE column IS NOT NULL
```

---

## 18. Three-Valued Logic

SQL menggunakan three-valued logic:

```text
TRUE
FALSE
UNKNOWN
```

Ketika `NULL` terlibat, banyak ekspresi menghasilkan `UNKNOWN`.

Contoh:

```sql
NULL = NULL        -- UNKNOWN
NULL <> NULL       -- UNKNOWN
5 = NULL           -- UNKNOWN
5 <> NULL          -- UNKNOWN
NULL > 3           -- UNKNOWN
```

Dalam `WHERE`, hanya row dengan predicate `TRUE` yang lolos.

Row dengan `FALSE` atau `UNKNOWN` tidak lolos.

---

## 19. Truth Tables

### 19.1 AND

| A | B | A AND B |
|---|---|---|
| TRUE | TRUE | TRUE |
| TRUE | FALSE | FALSE |
| TRUE | UNKNOWN | UNKNOWN |
| FALSE | TRUE | FALSE |
| FALSE | FALSE | FALSE |
| FALSE | UNKNOWN | FALSE |
| UNKNOWN | TRUE | UNKNOWN |
| UNKNOWN | FALSE | FALSE |
| UNKNOWN | UNKNOWN | UNKNOWN |

### 19.2 OR

| A | B | A OR B |
|---|---|---|
| TRUE | TRUE | TRUE |
| TRUE | FALSE | TRUE |
| TRUE | UNKNOWN | TRUE |
| FALSE | TRUE | TRUE |
| FALSE | FALSE | FALSE |
| FALSE | UNKNOWN | UNKNOWN |
| UNKNOWN | TRUE | TRUE |
| UNKNOWN | FALSE | UNKNOWN |
| UNKNOWN | UNKNOWN | UNKNOWN |

### 19.3 NOT

| A | NOT A |
|---|---|
| TRUE | FALSE |
| FALSE | TRUE |
| UNKNOWN | UNKNOWN |

Mental model:

```text
UNKNOWN is sticky, unless TRUE/FALSE short-circuit determines result logically.
```

---

## 20. WHERE dan UNKNOWN

Table:

```text
cases
+----+----------+
| id | closed_at |
+----+----------+
| 1  | NULL      |
| 2  | 2026-01-01|
+----+----------+
```

Query salah:

```sql
SELECT *
FROM cases
WHERE closed_at = NULL;
```

Untuk row id=1:

```text
NULL = NULL -> UNKNOWN
```

`WHERE` hanya mengambil TRUE, maka row tidak muncul.

Benar:

```sql
SELECT *
FROM cases
WHERE closed_at IS NULL;
```

---

## 21. `NOT IN` dan NULL Trap

Ini bug klasik.

Misal:

```sql
SELECT id
FROM cases
WHERE id NOT IN (
    SELECT case_id
    FROM case_assignments
);
```

Jika subquery menghasilkan satu `NULL`, maka `NOT IN` bisa menghasilkan hasil kosong/tidak terduga.

Contoh:

```text
case_assignments.case_id:
1
2
NULL
```

Predicate:

```sql
id NOT IN (1, 2, NULL)
```

Untuk id=3:

```text
3 <> 1 TRUE
3 <> 2 TRUE
3 <> NULL UNKNOWN
TRUE AND TRUE AND UNKNOWN -> UNKNOWN
```

Row tidak lolos.

Lebih aman pakai `NOT EXISTS`:

```sql
SELECT c.id
FROM cases c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_assignments a
    WHERE a.case_id = c.id
);
```

Prinsip:

> Untuk anti-join, `NOT EXISTS` sering lebih aman daripada `NOT IN`, terutama jika nullable value mungkin muncul.

---

## 22. `IN` dengan NULL

```sql
WHERE status IN ('OPEN', NULL)
```

Ini bukan berarti status `OPEN` atau `NULL`.

Untuk mencari NULL, harus eksplisit:

```sql
WHERE status = 'OPEN'
   OR status IS NULL
```

Namun jika status bisa NULL, tanyakan lagi apakah modelnya benar.

---

## 23. `COUNT(*)` vs `COUNT(column)`

`COUNT(*)` menghitung row.

```sql
SELECT COUNT(*)
FROM cases;
```

`COUNT(column)` menghitung row di mana column tidak NULL.

```sql
SELECT COUNT(closed_at)
FROM cases;
```

Contoh:

```text
id | closed_at
1  | NULL
2  | 2026-01-01
3  | NULL
```

```sql
COUNT(*)       -> 3
COUNT(closed_at) -> 1
```

Bug umum di reporting berasal dari salah memilih count.

---

## 24. Aggregates dan NULL

Umumnya aggregate mengabaikan NULL, kecuali `COUNT(*)`.

```sql
SUM(amount)
AVG(amount)
MIN(amount)
MAX(amount)
```

mengabaikan NULL.

Jika semua row NULL, hasil `SUM` bisa NULL, bukan 0 tergantung database/standard behavior.

Gunakan:

```sql
COALESCE(SUM(amount), 0)
```

jika domain menginginkan nol.

Tapi hati-hati:

> Mengubah NULL menjadi 0 adalah keputusan domain, bukan kosmetik.

---

## 25. COALESCE

`COALESCE` mengambil argumen pertama yang tidak NULL.

```sql
SELECT COALESCE(closed_at, now())
FROM cases;
```

Contoh untuk display:

```sql
SELECT
    case_number,
    COALESCE(assigned_officer_name, 'Unassigned') AS assignment_label
FROM case_summary;
```

Namun jangan sembarangan memakai `COALESCE` di predicate indexed column:

```sql
WHERE COALESCE(status, 'UNKNOWN') = 'OPEN'
```

Ini bisa mengganggu index usage dan menyembunyikan model yang lemah.

Lebih jelas:

```sql
WHERE status = 'OPEN'
```

atau jika memang status nullable:

```sql
WHERE status = 'OPEN'
   OR status IS NULL
```

---

## 26. NULL dalam UNIQUE Constraint

Perilaku `NULL` dalam unique constraint berbeda antar vendor.

Secara umum, banyak database memperlakukan `NULL` sebagai tidak sama dengan `NULL`, sehingga multiple row dengan nullable unique column dapat memiliki NULL.

Contoh:

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE
);
```

Bisa saja database mengizinkan banyak user dengan `email NULL`.

Jika ini tidak diinginkan, gunakan:

```sql
email TEXT NOT NULL UNIQUE
```

atau partial unique index/policy sesuai vendor.

Pertanyaan domain:

```text
Apakah email wajib?
Jika optional, apakah boleh banyak NULL?
Jika belum diketahui, apakah perlu status terpisah?
```

---

## 27. NULL dalam Foreign Key

Foreign key nullable biasanya berarti relationship optional.

```sql
case_id UUID REFERENCES cases(id)
```

Jika `case_id` NULL, FK constraint tidak dicek sebagai reference ke parent.

Artinya row boleh tidak punya parent.

Ini bisa valid untuk staging atau optional domain, tetapi harus jelas.

Jika relationship wajib:

```sql
case_id UUID NOT NULL REFERENCES cases(id)
```

Jangan biarkan FK nullable hanya karena “nanti gampang”.

---

## 28. NULL vs Empty String

Beberapa database membedakan NULL dan empty string:

```text
NULL
''
```

Oracle historically memperlakukan empty string sebagai NULL untuk beberapa tipe string. Vendor behavior penting.

Secara domain:

- `NULL` = value tidak ada/tidak diketahui/tidak berlaku
- `''` = value ada tetapi kosong

Untuk banyak field, empty string tidak valid.

Gunakan constraint:

```sql
CHECK (length(trim(name)) > 0)
```

atau:

```sql
name TEXT NOT NULL CHECK (name <> '')
```

Hati-hati whitespace:

```text
'   '
```

mungkin harus invalid.

---

## 29. Type Conversion and Casting

SQL bisa melakukan explicit dan implicit cast.

Explicit:

```sql
SELECT CAST('2026-01-01' AS DATE);
```

PostgreSQL-style:

```sql
SELECT '2026-01-01'::date;
```

Implicit cast bisa membantu, tetapi juga berbahaya.

Contoh buruk:

```sql
WHERE id::text = :id_text
```

Jika `id` punya index UUID/integer, cast pada column bisa menghambat index usage.

Lebih baik bind parameter dengan type yang benar:

```sql
WHERE id = :id_uuid
```

Java side:

```java
ps.setObject(1, uuid);
```

bukan:

```java
ps.setString(1, uuid.toString());
```

tergantung driver/vendor.

---

## 30. Sargability dan Type Mismatch

Sargability akan dibahas detail di part 005, tapi terkait kuat dengan tipe data.

Buruk:

```sql
WHERE CAST(created_at AS DATE) = DATE '2026-01-01'
```

Karena fungsi/cast pada column bisa membuat index `created_at` tidak efektif.

Lebih baik:

```sql
WHERE created_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND created_at <  TIMESTAMPTZ '2026-01-02 00:00:00+00'
```

Buruk:

```sql
WHERE numeric_id = '123'
```

Jika database melakukan implicit cast, plan bisa berbeda atau error tergantung vendor.

Lebih baik gunakan type benar:

```sql
WHERE numeric_id = 123
```

---

## 31. Java Mapping: SQL Types to Java Types

Mapping harus disengaja.

| SQL Type | Java Type Umum | Catatan |
|---|---|---|
| UUID | `java.util.UUID` | Jangan string jika driver support UUID |
| BIGINT | `long` / `Long` | `Long` jika nullable |
| INTEGER | `int` / `Integer` | hati-hati null |
| NUMERIC/DECIMAL | `BigDecimal` | wajib untuk money/exact decimal |
| FLOAT/DOUBLE | `float`/`double` | approximate only |
| TEXT/VARCHAR | `String` | validate domain |
| BOOLEAN | `boolean`/`Boolean` | `Boolean` jika nullable |
| DATE | `LocalDate` | date-only |
| TIME | `LocalTime` | time-only |
| TIMESTAMP | `LocalDateTime` | tanpa instant global |
| TIMESTAMPTZ | `Instant`/`OffsetDateTime` | event timestamp |
| JSON | `String`/JsonNode/domain object | beware schema drift |
| BYTEA/BLOB | `byte[]`/stream | large data handling |

### 31.1 Primitive vs Wrapper

Java primitive tidak bisa null.

```java
boolean active;
int retryCount;
```

Jika SQL column nullable, gunakan wrapper:

```java
Boolean active;
Integer retryCount;
```

Tapi lebih baik desain database:

```sql
active BOOLEAN NOT NULL DEFAULT TRUE
retry_count INTEGER NOT NULL DEFAULT 0
```

Jika null tidak punya makna domain.

---

## 32. BigDecimal Pitfalls

Untuk `NUMERIC`, gunakan `BigDecimal`.

Hindari:

```java
double amount;
```

Gunakan:

```java
BigDecimal amount;
```

Namun `BigDecimal` juga punya nuance:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
```

Karena scale berbeda.

Untuk comparison nilai:

```java
amount.compareTo(other) == 0
```

Untuk domain money, pertimbangkan value object:

```java
record Money(BigDecimal amount, Currency currency) {}
```

Dan enforce di database:

```sql
amount NUMERIC(19, 2) NOT NULL,
currency_code CHAR(3) NOT NULL
```

---

## 33. Semantic Correctness Patterns

### 33.1 Use NOT NULL Aggressively When Domain Requires

Buruk:

```sql
status TEXT
```

Lebih baik:

```sql
status TEXT NOT NULL
CHECK (status IN ('OPEN', 'CLOSED'))
```

Nullable column harus punya alasan domain.

### 33.2 Use CHECK for Local Invariants

```sql
CHECK (closed_at IS NULL OR closed_at >= opened_at)
```

### 33.3 Use FK for Referential Integrity

```sql
officer_id UUID NOT NULL REFERENCES officers(id)
```

### 33.4 Use UNIQUE for Business Identity

```sql
UNIQUE (jurisdiction_code, case_number)
```

### 33.5 Use Reference Tables for Managed Codes

```sql
status_code TEXT NOT NULL REFERENCES case_statuses(code)
```

### 33.6 Use Date Range Pattern

```sql
WHERE occurred_at >= :start_inclusive
  AND occurred_at <  :end_exclusive
```

### 33.7 Avoid Ambiguous Nullable Boolean

Prefer explicit status if three or more states exist.

---

## 34. Mini Case Study: Case Table Type Design

### 34.1 Naive Design

```sql
CREATE TABLE cases (
    id TEXT,
    case_number TEXT,
    status TEXT,
    opened_at TEXT,
    closed_at TEXT,
    risk_score FLOAT,
    assigned BOOLEAN
);
```

Problems:

- `id` tidak divalidasi UUID
- `case_number` nullable
- `status` bebas
- timestamp disimpan text
- `closed_at` text sulit dibandingkan
- `risk_score` float mungkin tidak perlu approximate
- `assigned` boolean tidak menjelaskan siapa/kapan
- tidak ada primary key
- tidak ada uniqueness
- tidak ada lifecycle invariant

### 34.2 Better Design

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    risk_score NUMERIC(5, 2),

    CONSTRAINT uq_cases_jurisdiction_case_number
    UNIQUE (jurisdiction_code, case_number),

    CONSTRAINT ck_cases_status_valid
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_time_order
    CHECK (closed_at IS NULL OR closed_at >= opened_at),

    CONSTRAINT ck_cases_risk_score_range
    CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),

    CONSTRAINT ck_cases_closed_status
    CHECK (
        (status = 'CLOSED' AND closed_at IS NOT NULL)
        OR
        (status <> 'CLOSED')
    )
);
```

Masih ada nuance:

- Apakah cancelled juga perlu closed_at?
- Apakah `closed_at` harus null untuk non-terminal status?
- Apakah risk_score nullable berarti belum calculated?
- Apakah status sebaiknya reference table?
- Apakah jurisdiction_code harus FK?
- Apakah case_number format harus check regex?
- Apakah lifecycle transition perlu history table?

Tipe data membuka diskusi domain, bukan menutupnya.

---

## 35. Mini Case Study: SLA Deadline

### 35.1 Requirement

> Case harus direview maksimal 5 business days setelah dibuka, berdasarkan timezone jurisdiction.

Naive:

```sql
review_due_at TIMESTAMP NOT NULL
```

Masalah:

- timezone tidak jelas
- business day tidak sama dengan calendar day
- holiday berbeda per jurisdiction
- due date mungkin domain date, bukan instant
- daylight saving di jurisdiction tertentu bisa berpengaruh
- audit perlu tahu rule yang dipakai

Better possible model:

```sql
CREATE TABLE case_review_slas (
    case_id UUID PRIMARY KEY REFERENCES cases(id),
    jurisdiction_code TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    due_local_date DATE NOT NULL,
    due_timezone TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    calendar_id TEXT NOT NULL,
    rule_version TEXT NOT NULL
);
```

Penjelasan:

- `opened_at` menyimpan instant actual.
- `due_local_date` menyimpan tanggal legal lokal.
- `due_timezone` menjelaskan zona hukum.
- `due_at` menyimpan instant deadline operasional.
- `calendar_id` dan `rule_version` membantu audit.

Ini mungkin terlihat berlebihan untuk aplikasi sederhana, tetapi untuk regulatory system, deadline calculation sering harus defensible.

---

## 36. Mini Case Study: Optional Assignment

Naive:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    assigned_officer_id UUID NULL
);
```

Pertanyaan:

- apakah hanya satu officer?
- apakah perlu history?
- apakah supporting officer ada?
- apakah null berarti unassigned?
- kapan assigned?
- siapa assign?
- apakah reassignment perlu audit?

Better:

```sql
CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL REFERENCES officers(id),
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    CHECK (assignment_role IN ('PRIMARY', 'SUPPORTING')),
    CHECK (ended_at IS NULL OR ended_at > assigned_at)
);
```

PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Sekarang `NULL` pada `ended_at` punya makna jelas:

```text
assignment is currently active
```

Tetapi makna ini harus didokumentasikan dan dipakai konsisten.

---

## 37. Common Type Anti-Patterns

### 37.1 Everything as TEXT

```sql
id TEXT,
amount TEXT,
created_at TEXT,
status TEXT
```

Masalah:

- database tidak bisa validasi
- sorting numeric salah
- date comparison salah
- index selectivity buruk
- cast runtime mahal
- Java mapping rapuh

### 37.2 Everything Nullable

```sql
status TEXT NULL,
created_at TIMESTAMPTZ NULL,
amount NUMERIC NULL
```

Masalah:

- setiap query harus handle unknown
- invariant lemah
- report ambigu
- bug three-valued logic

### 37.3 Magic Values

```text
closed_at = '9999-12-31'
amount = -1
officer_id = '00000000-0000-0000-0000-000000000000'
```

Magic value sering menggantikan NULL/status yang lebih eksplisit.

Lebih baik:

- nullable dengan makna jelas
- explicit status
- separate state
- CHECK constraint
- domain-specific table

### 37.4 Float for Money

Sudah dibahas: gunakan numeric atau minor unit integer.

### 37.5 Boolean Lifecycle

```sql
is_open
is_closed
is_cancelled
```

Gunakan status.

### 37.6 Timestamp for Date-Only Domain

Jika domain hanya tanggal, gunakan `DATE`.

### 37.7 LocalDateTime for Absolute Event

Untuk audit/event actual, gunakan instant/timezone-aware type.

---

## 38. Checklist: Choosing a SQL Type

Sebelum memilih tipe data:

```text
[ ] Apa makna domain value ini?
[ ] Apakah value wajib ada?
[ ] Apakah value bisa unknown/inapplicable?
[ ] Apakah ada range valid?
[ ] Apakah ada format valid?
[ ] Apakah value exact atau approximate?
[ ] Apakah value akan dibandingkan?
[ ] Apakah value akan diurutkan?
[ ] Apakah value akan dijumlahkan/di-average?
[ ] Apakah value akan dipakai join?
[ ] Apakah value akan dipakai index?
[ ] Apakah value akan diekspos ke API?
[ ] Apakah value PII/sensitive?
[ ] Apakah value butuh timezone?
[ ] Apakah value date-only atau instant?
[ ] Apakah value punya unit/currency?
[ ] Apakah Java type-nya jelas?
[ ] Apakah vendor mendukung type native yang lebih tepat?
```

---

## 39. Checklist: NULL Review

Untuk setiap nullable column:

```text
[ ] Apa arti NULL?
[ ] Unknown?
[ ] Not applicable?
[ ] Not yet assigned?
[ ] Not yet calculated?
[ ] Legacy missing data?
[ ] Apakah NULL sementara atau permanen?
[ ] Apakah query perlu IS NULL?
[ ] Apakah aggregate akan mengabaikan NULL?
[ ] Apakah UNIQUE behavior dengan NULL sesuai?
[ ] Apakah FK nullable memang optional?
[ ] Apakah nullable boolean sebaiknya status enum?
[ ] Apakah empty string perlu dicegah?
[ ] Apakah Java field menggunakan wrapper type?
```

Jika kamu tidak bisa menjelaskan arti NULL, kolom itu mungkin tidak boleh nullable.

---

## 40. Checklist: Java Mapping Review

```text
[ ] NUMERIC/DECIMAL dipetakan ke BigDecimal?
[ ] TIMESTAMPTZ dipetakan ke Instant/OffsetDateTime?
[ ] DATE dipetakan ke LocalDate?
[ ] UUID dipetakan ke UUID, bukan String?
[ ] Nullable SQL column dipetakan ke wrapper/Optional handling?
[ ] Boolean nullable dihindari jika tidak perlu?
[ ] Enum Java disinkronkan dengan DB constraint/reference table?
[ ] Timezone conversion diuji?
[ ] Parameter binding memakai type benar?
[ ] Tidak ada cast column karena parameter salah type?
```

---

## 41. Practical Exercises

### Exercise 1 — Fix Type Design

Naive:

```sql
CREATE TABLE penalties (
    id TEXT,
    amount FLOAT,
    currency TEXT,
    issued_at TEXT,
    paid BOOLEAN
);
```

Better:

```sql
CREATE TABLE penalties (
    id UUID PRIMARY KEY,
    amount NUMERIC(19, 2) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    payment_status TEXT NOT NULL,

    CHECK (amount >= 0),
    CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED'))
);
```

Further improvement:

```sql
currency_code CHAR(3) NOT NULL REFERENCES currencies(code)
```

### Exercise 2 — Fix NULL Query

Wrong:

```sql
SELECT *
FROM cases
WHERE closed_at = NULL;
```

Correct:

```sql
SELECT *
FROM cases
WHERE closed_at IS NULL;
```

### Exercise 3 — Fix Date Range

Wrong:

```sql
WHERE created_at BETWEEN '2026-01-01' AND '2026-01-31'
```

Correct:

```sql
WHERE created_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND created_at <  TIMESTAMPTZ '2026-02-01 00:00:00+00'
```

### Exercise 4 — Fix NOT IN

Risky:

```sql
SELECT c.id
FROM cases c
WHERE c.id NOT IN (
    SELECT case_id
    FROM case_assignments
);
```

Safer:

```sql
SELECT c.id
FROM cases c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_assignments a
    WHERE a.case_id = c.id
);
```

---

## 42. Koneksi ke Part Berikutnya

Part ini menjelaskan nilai dan tipe.

Part berikutnya akan mulai membahas query dasar:

```text
SELECT
FROM
WHERE
ORDER BY
LIMIT
```

Namun setelah memahami part ini, kamu akan membaca query dasar dengan cara lebih tajam:

- apakah predicate benar terhadap NULL?
- apakah date range aman?
- apakah comparison memakai type benar?
- apakah ordering deterministic?
- apakah filter bisa memakai index?
- apakah output column semantik cocok untuk DTO/report?

Dengan kata lain, query dasar tidak akan dipelajari sebagai template, tetapi sebagai transformation terhadap relation dengan type semantics yang benar.

---

## 43. Ringkasan Bagian Ini

Hal penting dari part 003:

1. Tipe data adalah domain semantics, bukan detail storage saja.
2. Gunakan exact decimal untuk uang/amount exact.
3. Hindari float untuk nilai domain-critical.
4. Gunakan `DATE` untuk tanggal tanpa waktu.
5. Gunakan `TIMESTAMPTZ`/instant-aware type untuk event actual.
6. Jangan pakai `LocalDateTime` untuk audit timestamp absolute.
7. Gunakan UUID native jika memang identifier UUID.
8. JSON cocok untuk metadata fleksibel, bukan core relational facts.
9. Enum/status harus dijaga database, bukan hanya Java.
10. `NULL` bukan zero, empty string, atau false.
11. SQL memakai three-valued logic: TRUE, FALSE, UNKNOWN.
12. `WHERE` hanya meloloskan TRUE.
13. Gunakan `IS NULL`, bukan `= NULL`.
14. `NOT IN` berbahaya jika subquery bisa menghasilkan NULL; gunakan `NOT EXISTS`.
15. `COUNT(*)` berbeda dari `COUNT(column)`.
16. Nullable column harus punya makna domain yang eksplisit.
17. Type mismatch dan cast pada column bisa mengganggu index.
18. Java mapping harus menjaga exactness, timezone, dan nullability.

Kalimat inti:

> SQL correctness dimulai dari pemilihan tipe data dan makna NULL; query yang syntactically valid tetap bisa salah jika value semantics-nya tidak benar.

---

## 44. Referensi

1. ISO — `ISO/IEC 9075-1:2023`, Database languages SQL — Part 1: Framework.  
   https://www.iso.org/standard/76583.html

2. PostgreSQL Documentation — Data Types.  
   https://www.postgresql.org/docs/current/datatype.html

3. PostgreSQL Documentation — Numeric Types.  
   https://www.postgresql.org/docs/current/datatype-numeric.html

4. PostgreSQL Documentation — Date/Time Types.  
   https://www.postgresql.org/docs/current/datatype-datetime.html

5. PostgreSQL Documentation — UUID Type.  
   https://www.postgresql.org/docs/current/datatype-uuid.html

6. PostgreSQL Documentation — JSON Types.  
   https://www.postgresql.org/docs/current/datatype-json.html

7. PostgreSQL Documentation — Comparison Functions and Operators.  
   https://www.postgresql.org/docs/current/functions-comparison.html

8. PostgreSQL Documentation — Conditional Expressions, including `COALESCE`.  
   https://www.postgresql.org/docs/current/functions-conditional.html

9. Oracle JDBC Documentation — Java SQL type mappings.  
   https://docs.oracle.com/javase/8/docs/technotes/guides/jdbc/

10. Java Platform Documentation — `java.time` package.  
    https://docs.oracle.com/javase/8/docs/api/java/time/package-summary.html

---

## 45. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-004.md` — Basic Query Semantics: SELECT, FROM, WHERE, ORDER BY, LIMIT

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-002.md">⬅️ Part 2 — SQL Language Model: DDL, DML, DQL, DCL, TCL</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-004.md">Part 4 — Basic Query Semantics: SELECT, FROM, WHERE, ORDER BY, LIMIT ➡️</a>
</div>
