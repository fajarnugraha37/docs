# learn-postgresql-mastery-for-java-engineers-part-016.md

# Part 016 — Schema Design PostgreSQL-specific: Types, Domains, ENUM, Range, JSONB, Array

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang sudah memahami SQL dasar dan ingin menguasai PostgreSQL sebagai database engine produksi.  
> Fokus bagian ini: desain schema yang memanfaatkan fitur spesifik PostgreSQL tanpa jatuh ke over-engineering, vendor lock-in yang tidak disadari, atau model data yang sulit berevolusi.

---

## 0. Posisi Part Ini dalam Seri

Di seri SQL umum, schema design biasanya dibahas sebagai:

- table,
- column,
- primary key,
- foreign key,
- normalization,
- denormalization,
- join,
- index.

Itu penting, tetapi belum cukup untuk PostgreSQL.

PostgreSQL bukan hanya relational database minimalis. PostgreSQL adalah object-relational database engine dengan tipe data kaya, constraint kuat, operator kaya, index method beragam, function system, extension system, dan planner yang memahami banyak operator native.

Artinya, desain schema PostgreSQL bukan hanya pertanyaan:

```text
Kolom ini string atau number?
```

Melainkan:

```text
Invariant domain apa yang ingin saya representasikan?
Operator apa yang akan sering dipakai?
Apakah nilai ini scalar, interval, set, document fragment, atau identifier?
Apakah bentuk datanya stabil atau masih berevolusi?
Apakah constraint perlu ditegakkan database?
Apakah query perlu indexable?
Bagaimana mapping-nya ke Java?
Bagaimana migrasinya jika model berubah?
```

Part ini membahas fitur schema yang khas PostgreSQL dan cara memakainya secara bertanggung jawab.

---

## 1. Prinsip Utama: Pilih Type Berdasarkan Invariant, Bukan Kebiasaan

Kesalahan umum engineer backend adalah memilih tipe data berdasarkan convenience di aplikasi:

```text
Semua ID jadi text.
Semua uang jadi double.
Semua waktu jadi timestamp tanpa timezone.
Status jadi varchar bebas.
Dynamic attributes langsung jadi JSONB.
List kecil jadi comma-separated string.
```

Model seperti ini mungkin cepat di awal, tetapi menimbulkan biaya besar di production:

- validasi tercecer di banyak service,
- data historis tidak konsisten,
- migration sulit,
- query lambat,
- index tidak efektif,
- bug timezone,
- race condition karena invariant tidak dijaga database,
- auditability lemah.

PostgreSQL memberi pilihan tipe data yang bisa mengekspresikan makna domain lebih presisi. Tetapi tipe yang lebih ekspresif juga membawa trade-off:

- lebih PostgreSQL-specific,
- kadang mapping Java lebih rumit,
- kadang migration lebih mahal,
- kadang ORM tidak mendukung natural,
- kadang query planner butuh index khusus.

Jadi prinsipnya:

```text
Gunakan tipe PostgreSQL-specific jika ia memperkuat correctness, queryability, atau operational clarity.
Jangan gunakan hanya karena terlihat canggih.
```

---

## 2. Mental Model Schema PostgreSQL

Satu column di PostgreSQL bukan hanya storage slot. Column adalah gabungan dari beberapa kontrak:

```text
column = type + nullability + default + constraint + operator semantics + indexability + migration behavior + Java mapping
```

Contoh:

```sql
created_at timestamptz NOT NULL DEFAULT now()
```

Ini bukan hanya “kolom tanggal”. Ini menyatakan:

- nilainya absolute point in time,
- tidak boleh kosong,
- default dihasilkan database,
- memakai timezone-aware semantics PostgreSQL,
- bisa dibandingkan dengan operator waktu,
- bisa diindex B-tree,
- bisa dipakai untuk retention query,
- mapping Java idealnya ke `Instant` atau `OffsetDateTime`, bukan `LocalDateTime` sembarangan.

Bandingkan dengan:

```sql
created_at varchar(255)
```

Secara storage masih bisa menyimpan tanggal, tetapi database kehilangan kemampuan memahami makna tanggal.

Top-tier PostgreSQL engineer selalu bertanya:

```text
Apa yang database bisa bantu jaga secara native?
```

---

## 3. Numeric Types: Jangan Salah Pilih untuk Uang, Count, Ratio, dan Measurement

PostgreSQL menyediakan beberapa tipe numeric utama:

- `smallint`,
- `integer`,
- `bigint`,
- `numeric` / `decimal`,
- `real`,
- `double precision`,
- `money`.

### 3.1 Integer Family

Gunakan integer untuk nilai diskret:

```sql
retry_count integer NOT NULL DEFAULT 0,
version bigint NOT NULL DEFAULT 0,
sequence_no bigint NOT NULL
```

Pilihan umum:

| Type | Use case |
|---|---|
| `smallint` | kode kecil, jarang perlu |
| `integer` | count umum, status numeric kecil |
| `bigint` | ID, sequence, counter besar, version panjang |

Untuk sistem production, `bigint` sering lebih aman untuk surrogate key dan counter jangka panjang.

Contoh:

```sql
id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

Kenapa bukan `integer`?

Karena beberapa sistem tumbuh lebih lama dan lebih besar dari perkiraan awal. Migrasi primary key dari integer ke bigint di tabel besar bisa mahal.

### 3.2 Numeric / Decimal

Gunakan `numeric` atau `decimal` untuk nilai yang butuh exact precision:

- uang,
- tax,
- penalty,
- interest,
- quota legal,
- measurement yang harus exact,
- financial audit.

Contoh:

```sql
penalty_amount numeric(19, 4) NOT NULL CHECK (penalty_amount >= 0)
```

Di Java, mapping ideal:

```java
BigDecimal penaltyAmount;
```

Jangan gunakan `double` untuk uang.

Masalah `double`:

- binary floating point tidak exact untuk banyak decimal,
- hasil rounding bisa mengejutkan,
- audit trail financial/regulatory bisa bermasalah.

### 3.3 Real dan Double Precision

Gunakan floating point untuk approximate measurement:

- sensor reading,
- probability,
- scoring,
- ML feature,
- geo approximation tertentu.

Contoh:

```sql
risk_score double precision NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1)
```

Tetapi jangan pakai untuk:

- nominal uang,
- jumlah pajak,
- saldo,
- denda,
- entitlement.

### 3.4 Tipe `money`

PostgreSQL punya type `money`, tetapi dalam banyak aplikasi modern lebih aman memakai `numeric` plus currency code eksplisit:

```sql
amount numeric(19, 4) NOT NULL,
currency_code char(3) NOT NULL
```

Alasannya:

- `money` terikat formatting locale,
- multi-currency butuh currency dimension,
- integrasi Java/ORM lebih predictable dengan `numeric`.

---

## 4. Text Types: `text`, `varchar`, `char`, dan Collation

PostgreSQL punya:

- `text`,
- `varchar(n)`,
- `character varying`,
- `char(n)`.

### 4.1 `text` vs `varchar(n)`

Di PostgreSQL, `text` dan `varchar` tanpa limit memiliki karakteristik penggunaan yang sangat mirip. Jangan membawa asumsi dari database lain bahwa `varchar(255)` selalu lebih efisien.

Gunakan `varchar(n)` jika panjang maksimum adalah invariant domain.

Contoh yang masuk akal:

```sql
country_code char(2) NOT NULL,
currency_code char(3) NOT NULL,
username varchar(64) NOT NULL
```

Contoh yang kurang bermakna:

```sql
description varchar(255)
```

Jika tidak ada alasan domain kenapa 255, gunakan:

```sql
description text
```

Atau jika memang ada batas produk:

```sql
description text CHECK (length(description) <= 500)
```

Keuntungan `CHECK`:

- constraint diberi nama bermakna,
- mudah dievolusi,
- invariant eksplisit.

### 4.2 Jangan Simpan List sebagai Comma-separated String

Anti-pattern:

```sql
tags text -- "urgent,legal,external"
```

Masalah:

- sulit query exact,
- sulit index,
- sulit constraint,
- sulit update individual element,
- raw string parsing bocor ke aplikasi.

Alternatif:

- table relasi jika tags entity penting,
- `text[]` jika list sederhana dan tidak perlu metadata,
- `jsonb` jika struktur lebih bebas.

### 4.3 Case-insensitive Text

Untuk email atau username, sering dibutuhkan uniqueness case-insensitive.

Opsi:

```sql
CREATE UNIQUE INDEX ux_user_email_lower ON app_user (lower(email));
```

Atau gunakan extension/type seperti `citext` jika policy organisasi membolehkan extension.

Namun expression index dengan `lower(email)` sering lebih eksplisit dan mudah dikontrol.

Contoh:

```sql
CREATE TABLE app_user (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    CONSTRAINT chk_email_not_blank CHECK (length(trim(email)) > 0)
);

CREATE UNIQUE INDEX ux_app_user_email_lower
ON app_user (lower(email));
```

Di Java, pastikan canonicalization policy jelas:

```text
Apakah email disimpan original-case tetapi dibandingkan lowercase?
Apakah username disimpan lowercase selalu?
Apakah display name berbeda dari login identifier?
```

---

## 5. Boolean: Sederhana tetapi Sering Disalahgunakan

Boolean cocok untuk state biner yang benar-benar biner:

```sql
is_active boolean NOT NULL DEFAULT true
```

Tetapi boolean buruk untuk lifecycle yang akan berkembang.

Anti-pattern:

```sql
is_approved boolean NOT NULL DEFAULT false,
is_rejected boolean NOT NULL DEFAULT false,
is_cancelled boolean NOT NULL DEFAULT false
```

Masalah:

- kombinasi invalid mungkin terjadi,
- state machine tersembunyi,
- query membingungkan,
- constraint makin rumit.

Lebih baik:

```sql
status text NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'))
```

Atau PostgreSQL enum jika domain sangat stabil.

Rule of thumb:

```text
Boolean untuk property.
Status untuk lifecycle.
```

---

## 6. Timestamp, Timezone, dan Temporal Correctness

Temporal modelling adalah sumber bug besar di sistem backend.

PostgreSQL menyediakan:

- `date`,
- `time`,
- `time with time zone`,
- `timestamp without time zone`,
- `timestamp with time zone` / `timestamptz`,
- `interval`.

### 6.1 `timestamptz` untuk Instant

Untuk event yang terjadi di waktu nyata, gunakan:

```sql
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
submitted_at timestamptz,
processed_at timestamptz
```

`timestamptz` menyimpan absolute point in time. Nama “with time zone” sering menyesatkan: PostgreSQL tidak menyimpan timezone original per row; ia menyimpan instant dan menampilkan sesuai session timezone.

Di Java, mapping yang sering paling jelas:

```java
Instant createdAt;
```

Atau:

```java
OffsetDateTime createdAt;
```

Hindari mapping ke `LocalDateTime` untuk event absolute karena `LocalDateTime` tidak punya timezone/offset.

### 6.2 `timestamp without time zone` untuk Local Schedule

Gunakan `timestamp without time zone` jika nilainya memang local civil time, bukan instant global.

Contoh:

```sql
appointment_local_time timestamp without time zone NOT NULL,
time_zone text NOT NULL
```

Ini berguna untuk jadwal yang terikat zona tertentu:

```text
Rapat setiap Senin 09:00 Asia/Jakarta
```

Jika hanya disimpan sebagai instant, perubahan daylight saving atau interpretasi jadwal lokal bisa rumit untuk negara yang memakai DST.

### 6.3 `date` untuk Tanggal Domain

Gunakan `date` untuk tanggal tanpa jam:

```sql
birth_date date,
due_date date NOT NULL,
reporting_period_start date NOT NULL,
reporting_period_end date NOT NULL
```

Jangan simpan birth date sebagai `timestamptz`. Birth date bukan instant.

### 6.4 `interval`

Gunakan `interval` untuk durasi:

```sql
sla_duration interval NOT NULL,
retention_period interval NOT NULL
```

Namun hati-hati: interval bulan dan hari tidak selalu sama panjang dalam detik. Untuk SLA yang presisi detik, kadang lebih aman menyimpan duration dalam integer seconds/milliseconds.

### 6.5 Temporal Invariant

Contoh constraint temporal:

```sql
CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    CONSTRAINT chk_case_closed_after_opened
        CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
```

Constraint seperti ini mencegah data mustahil, bahkan jika bug aplikasi terjadi.

---

## 7. UUID: Identifier yang Praktis, tetapi Tidak Gratis

PostgreSQL mendukung `uuid` sebagai native type.

Contoh:

```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid()
```

Kelebihan UUID:

- bisa dibuat di client/app atau database,
- tidak mudah ditebak,
- cocok untuk distributed ID generation,
- aman untuk public identifier dibanding sequence integer,
- mengurangi coupling ke central sequence.

Biaya UUID:

- lebih besar dari `bigint`,
- index lebih besar,
- random UUID bisa buruk untuk locality B-tree,
- cache efficiency lebih rendah,
- insert bisa menyebabkan page split lebih acak.

### 7.1 Internal ID vs Public ID

Pola yang sering baik:

```sql
CREATE TABLE case_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id uuid NOT NULL DEFAULT gen_random_uuid(),
    case_number text NOT NULL,
    CONSTRAINT ux_case_file_public_id UNIQUE (public_id),
    CONSTRAINT ux_case_file_case_number UNIQUE (case_number)
);
```

Manfaat:

- `bigint` efisien untuk FK internal,
- `uuid` aman untuk API/public URL,
- domain identifier seperti `case_number` tetap bisa punya uniqueness sendiri.

Kapan langsung UUID primary key masuk akal:

- multi-region/client-side creation,
- offline creation,
- event-driven distributed system,
- tidak ingin expose sequence inference,
- schema sederhana lebih penting daripada storage locality.

Kapan bigint lebih masuk akal:

- OLTP besar dengan banyak FK,
- write-heavy workload,
- join-heavy workload,
- data warehouse/reporting join intensif,
- storage/index efficiency penting.

### 7.2 Java Mapping

Gunakan:

```java
java.util.UUID
```

Jangan simpan UUID sebagai `String` kecuali ada alasan kuat. Native `uuid` memberi validasi dan storage lebih baik.

---

## 8. Identity Columns dan Sequence

PostgreSQL modern mendukung SQL-standard identity columns:

```sql
id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

Atau:

```sql
id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY
```

Perbedaan:

- `GENERATED ALWAYS`: database selalu generate kecuali override eksplisit.
- `GENERATED BY DEFAULT`: aplikasi bisa menyediakan nilai sendiri.

Untuk kebanyakan primary key internal:

```sql
GENERATED ALWAYS AS IDENTITY
```

lebih aman karena mencegah aplikasi sembarangan memasukkan ID.

### 8.1 Sequence Tidak Transactional seperti yang Sering Diasumsikan

Sequence value bisa memiliki gap.

Contoh:

```text
Transaction mengambil id 101 lalu rollback.
ID 101 tidak otomatis dipakai ulang.
```

Ini normal dan benar.

Jangan membuat logic bisnis yang mengasumsikan ID sequence tanpa gap.

Untuk nomor dokumen regulatif yang harus gapless, jangan gunakan primary key sequence langsung. Butuh desain khusus:

- separate numbering process,
- lock/serialization,
- audit event,
- retry-safe allocation,
- legal cancellation semantics.

---

## 9. ENUM: Bagus untuk Domain Stabil, Buruk untuk Domain yang Sering Berubah

PostgreSQL enum:

```sql
CREATE TYPE case_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'CLOSED'
);

CREATE TABLE case_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status case_status NOT NULL
);
```

Kelebihan:

- validasi kuat,
- storage compact,
- semantik eksplisit,
- tidak bisa isi nilai sembarang.

Kelemahan:

- perubahan enum adalah DDL,
- menghapus/rename value tidak sesederhana text,
- deployment multi-version bisa rumit,
- integrasi Java enum harus backward/forward compatible.

### 9.1 ENUM vs TEXT + CHECK

Alternatif:

```sql
status text NOT NULL,
CONSTRAINT chk_case_status CHECK (
    status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED')
)
```

Kelebihan `text + check`:

- lebih mudah migration,
- constraint bisa diganti dengan expand-contract,
- cocok untuk status yang masih berkembang.

Kelebihan enum:

- lebih kuat sebagai domain type,
- bagus jika nilai sangat stabil,
- lebih rapi jika dipakai di banyak table.

Rule of thumb:

```text
Gunakan enum untuk vocabulary yang benar-benar stabil.
Gunakan text + check untuk lifecycle yang masih berevolusi.
Gunakan lookup table jika value punya metadata, policy, ordering, localization, atau lifecycle sendiri.
```

### 9.2 Lookup Table untuk Status yang Kaya

Jika status punya metadata:

```sql
CREATE TABLE case_status_ref (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    is_terminal boolean NOT NULL,
    sort_order integer NOT NULL
);

CREATE TABLE case_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status_code text NOT NULL REFERENCES case_status_ref(code)
);
```

Ini lebih fleksibel untuk:

- UI label,
- localization,
- enable/disable status,
- workflow configuration,
- regulatory metadata.

---

## 10. Domain Types: Reusable Invariant

PostgreSQL domain adalah type berbasis type lain dengan constraint tambahan.

Contoh:

```sql
CREATE DOMAIN email_address AS text
CHECK (
    VALUE ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
);
```

Lalu:

```sql
CREATE TABLE app_user (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email email_address NOT NULL
);
```

Kelebihan domain:

- invariant reusable,
- schema lebih ekspresif,
- constraint tidak perlu diulang.

Kelemahan:

- migration domain bisa berdampak luas,
- error handling Java perlu memahami constraint domain,
- beberapa ORM kurang nyaman dengan domain custom.

### 10.1 Domain Cocok untuk Apa?

Cocok untuk value object sederhana:

- email,
- country code,
- currency code,
- positive amount,
- non-empty text,
- normalized identifier.

Contoh:

```sql
CREATE DOMAIN non_empty_text AS text
CHECK (length(trim(VALUE)) > 0);

CREATE DOMAIN currency_code AS char(3)
CHECK (VALUE ~ '^[A-Z]{3}$');
```

Tetapi domain bukan pengganti semua validation. Untuk validasi kompleks yang butuh table lookup, lifecycle, atau external policy, gunakan FK/constraint/function/service logic.

---

## 11. Range Types: Representasi Interval yang Bisa Diquery dengan Benar

PostgreSQL punya range types, seperti:

- `int4range`,
- `int8range`,
- `numrange`,
- `tsrange`,
- `tstzrange`,
- `daterange`.

Range menyimpan interval dengan boundary.

Contoh:

```sql
valid_period tstzrange NOT NULL
```

Operator range:

- overlap: `&&`,
- contains: `@>`,
- contained by: `<@`,
- adjacent: `-|-`,
- intersection, union, dan lain-lain.

### 11.1 Contoh: Effective-dated Policy

```sql
CREATE TABLE penalty_policy (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    policy_code text NOT NULL,
    effective_period tstzrange NOT NULL,
    rate numeric(10, 4) NOT NULL,
    CONSTRAINT chk_policy_non_empty_period CHECK (NOT isempty(effective_period))
);
```

Query policy yang berlaku pada waktu tertentu:

```sql
SELECT *
FROM penalty_policy
WHERE policy_code = 'LATE_PAYMENT'
  AND effective_period @> now();
```

### 11.2 Mencegah Overlap dengan Exclusion Constraint

Untuk memastikan tidak ada dua policy aktif overlap untuk kode yang sama:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE penalty_policy
ADD CONSTRAINT ex_penalty_policy_no_overlap
EXCLUDE USING gist (
    policy_code WITH =,
    effective_period WITH &&
);
```

Ini sangat kuat untuk domain:

- booking,
- schedule,
- policy validity,
- rate period,
- assignment period,
- case ownership period,
- license validity.

Tanpa range + exclusion constraint, logic overlap sering bocor ke aplikasi dan rentan race condition.

### 11.3 Java Mapping

Range type tidak selalu didukung natural oleh ORM. Pilihan:

- pakai custom type,
- mapping ke dua kolom `start_at` dan `end_at`,
- gunakan jOOQ yang lebih nyaman dengan PostgreSQL-specific type,
- simpan range di database tetapi expose sebagai value object Java.

Jika ORM menjadi penghalang untuk invariant penting, jangan otomatis menurunkan kualitas model database. Evaluasi tool mapping, bukan mengorbankan correctness.

---

## 12. Array: Berguna untuk Nilai Multi-valued Sederhana, Bukan Relasi Kompleks

PostgreSQL mendukung array native:

```sql
tags text[] NOT NULL DEFAULT '{}'
```

Array cocok untuk:

- list kecil,
- scalar values,
- tidak butuh metadata per item,
- query containment sederhana,
- denormalized read model.

Contoh:

```sql
CREATE TABLE document (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL,
    tags text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX ix_document_tags_gin
ON document USING gin (tags);
```

Query:

```sql
SELECT *
FROM document
WHERE tags @> ARRAY['urgent'];
```

### 12.1 Kapan Jangan Pakai Array

Jangan pakai array jika item:

- punya metadata,
- perlu FK,
- sering diupdate satu per satu,
- jumlahnya besar,
- butuh audit per element,
- punya lifecycle,
- perlu permission per item.

Anti-pattern:

```sql
assigned_user_ids bigint[]
```

Jika assignment adalah entity penting, buat table relasi:

```sql
CREATE TABLE case_assignment (
    case_id bigint NOT NULL REFERENCES case_file(id),
    user_id bigint NOT NULL REFERENCES app_user(id),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    assigned_by bigint NOT NULL REFERENCES app_user(id),
    PRIMARY KEY (case_id, user_id)
);
```

Rule:

```text
Array untuk embedded scalar set kecil.
Join table untuk relationship yang bermakna.
```

---

## 13. JSONB: Fleksibilitas dengan Biaya Model

PostgreSQL punya `json` dan `jsonb`.

Dalam kebanyakan kasus queryable, gunakan `jsonb`.

Contoh:

```sql
metadata jsonb NOT NULL DEFAULT '{}'::jsonb
```

Kelebihan JSONB:

- flexible schema,
- cocok untuk metadata bervariasi,
- cocok untuk external payload,
- bisa diquery,
- bisa diindex dengan GIN/expression index,
- cocok untuk audit/event payload.

Kelemahan JSONB:

- constraint lebih lemah dibanding column biasa,
- type safety lebih rendah,
- migration data internal JSON lebih rumit,
- query bisa lebih sulit dibaca,
- ORM mapping sering menjadi raw object/string,
- overuse membuat relational model rusak.

### 13.1 JSONB Cocok untuk Apa?

Cocok untuk:

- metadata opsional,
- payload event immutable,
- external API response snapshot,
- audit detail,
- dynamic attributes yang jarang difilter,
- feature flags per entity,
- regulatory submission raw payload.

Contoh event log:

```sql
CREATE TABLE case_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL REFERENCES case_file(id),
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_id bigint,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

### 13.2 JSONB Tidak Cocok untuk Core Invariant

Anti-pattern:

```sql
CREATE TABLE case_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data jsonb NOT NULL
);
```

Lalu semua field penting ada di JSON:

```json
{
  "status": "APPROVED",
  "tenantId": 42,
  "openedAt": "2026-01-01T00:00:00Z",
  "assignedOfficerId": 99
}
```

Masalah:

- FK tidak natural,
- status constraint sulit,
- index tersembunyi,
- query verbose,
- migration sulit,
- report lambat,
- data invalid bisa masuk,
- Java dan database tidak punya kontrak kuat.

Lebih baik hybrid:

```sql
CREATE TABLE case_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL,
    status text NOT NULL,
    opened_at timestamptz NOT NULL DEFAULT now(),
    assigned_officer_id bigint,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT chk_case_status CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'CLOSED'))
);
```

Rule:

```text
Kolom relational untuk invariant, join, filtering, sorting, lifecycle, FK, dan reporting utama.
JSONB untuk variasi yang tidak layak menjadi kolom inti.
```

### 13.3 Index JSONB

GIN index umum:

```sql
CREATE INDEX ix_case_file_metadata_gin
ON case_file USING gin (metadata);
```

Expression index untuk path tertentu:

```sql
CREATE INDEX ix_case_file_external_ref
ON case_file ((metadata ->> 'externalReference'));
```

Query:

```sql
SELECT *
FROM case_file
WHERE metadata ->> 'externalReference' = 'EXT-123';
```

Jika path sering diquery dan penting, pertimbangkan generated column atau kolom normal.

---

## 14. Generated Columns: Menyimpan Derivasi yang Harus Konsisten

PostgreSQL mendukung generated column stored.

Contoh:

```sql
CREATE TABLE app_user (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    email_normalized text GENERATED ALWAYS AS (lower(email)) STORED
);

CREATE UNIQUE INDEX ux_app_user_email_normalized
ON app_user (email_normalized);
```

Kelebihan:

- derivasi konsisten,
- tidak bergantung aplikasi,
- bisa diindex,
- query lebih sederhana.

Cocok untuk:

- normalized email,
- extracted JSONB field,
- computed search key,
- derived date bucket,
- canonical code.

Contoh JSONB extraction:

```sql
CREATE TABLE inbound_message (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payload jsonb NOT NULL,
    external_id text GENERATED ALWAYS AS (payload ->> 'externalId') STORED
);

CREATE UNIQUE INDEX ux_inbound_message_external_id
ON inbound_message (external_id);
```

Hati-hati:

- generated expression harus immutable sesuai aturan PostgreSQL,
- perubahan expression butuh migration,
- jangan jadikan generated column sebagai tempat business logic kompleks.

---

## 15. Composite Types: Ekspresif, tetapi Jarang Pilihan Pertama untuk OLTP Java

PostgreSQL mendukung composite type:

```sql
CREATE TYPE money_amount AS (
    amount numeric,
    currency_code char(3)
);
```

Namun untuk aplikasi Java OLTP umum, composite type sering kurang praktis:

- ORM mapping tidak natural,
- query/reporting bisa lebih rumit,
- constraint per field kurang langsung dibanding column biasa,
- migration lebih kompleks.

Biasanya lebih baik:

```sql
amount numeric(19, 4) NOT NULL,
currency_code char(3) NOT NULL
```

Composite type bisa masuk akal untuk:

- function return type,
- internal database API,
- advanced PostgreSQL-heavy systems,
- data modelling yang sangat dekat dengan database.

---

## 16. Network, Geometric, dan Specialized Types

PostgreSQL menyediakan specialized types seperti:

- `inet`,
- `cidr`,
- `macaddr`,
- geometric types,
- full-text types,
- range types,
- UUID,
- JSONB.

Gunakan specialized type jika domain-nya memang cocok.

Contoh IP address:

```sql
login_ip inet
```

Lebih baik daripada:

```sql
login_ip text
```

Karena `inet` memahami operator network dan validasi IP.

Contoh audit login:

```sql
CREATE TABLE login_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_user(id),
    login_at timestamptz NOT NULL DEFAULT now(),
    ip_address inet,
    user_agent text
);
```

---

## 17. Nullability: `NULL` sebagai Semantik, Bukan Default Malas

`NULL` harus berarti sesuatu.

Makna umum:

- unknown,
- not applicable,
- not yet provided,
- intentionally absent.

Jangan biarkan semua kolom nullable hanya karena memudahkan insert.

Contoh buruk:

```sql
status text,
created_at timestamptz,
tenant_id bigint
```

Contoh lebih baik:

```sql
status text NOT NULL,
created_at timestamptz NOT NULL DEFAULT now(),
tenant_id bigint NOT NULL
```

### 17.1 Null dan Unique Constraint

Di PostgreSQL, unique constraint memperlakukan `NULL` dengan semantics tertentu: multiple null bisa dianggap tidak sama dalam banyak kasus. Untuk domain yang butuh “hanya satu null” atau uniqueness conditional, gunakan partial unique index atau fitur `NULLS NOT DISTINCT` jika cocok.

Contoh partial unique:

```sql
CREATE UNIQUE INDEX ux_user_active_email
ON user_email (user_id)
WHERE is_primary = true;
```

Artinya:

```text
Satu user hanya boleh punya satu primary email.
```

Ini invariant domain, bukan sekadar index performa.

---

## 18. Defaults: Database Default vs Application Default

Default bisa diletakkan di aplikasi atau database. Untuk field yang merupakan invariant teknis, database default sering lebih aman.

Contoh:

```sql
created_at timestamptz NOT NULL DEFAULT now(),
version bigint NOT NULL DEFAULT 0,
is_active boolean NOT NULL DEFAULT true,
metadata jsonb NOT NULL DEFAULT '{}'::jsonb
```

Manfaat:

- semua writer konsisten,
- migration/backfill lebih mudah,
- mengurangi bug ketika ada batch job/tool lain,
- database menjaga baseline valid.

Tetapi jangan semua default disembunyikan di database jika aplikasinya perlu explicit intent.

Contoh status:

```sql
status text NOT NULL DEFAULT 'DRAFT'
```

Boleh, tetapi pastikan ini memang policy domain. Jika status awal tergantung use case, lebih baik aplikasi mengirim explicit status.

---

## 19. Schema Design untuk Java/Hibernate/JPA

PostgreSQL-specific type kadang berbenturan dengan ORM abstraction.

Top-tier Java engineer tidak berpikir:

```text
ORM tidak nyaman, jadi database model dikorbankan.
```

Melainkan:

```text
Apa invariant yang harus dijaga?
Tool mapping apa yang paling tepat?
Apakah bagian ini sebaiknya pakai native SQL/jOOQ/custom type?
```

### 19.1 Common Mapping

| PostgreSQL | Java recommended |
|---|---|
| `bigint` | `Long` |
| `integer` | `Integer` |
| `numeric` | `BigDecimal` |
| `text` | `String` |
| `uuid` | `UUID` |
| `timestamptz` | `Instant` / `OffsetDateTime` |
| `date` | `LocalDate` |
| `boolean` | `Boolean` / `boolean` |
| `jsonb` | custom object / `JsonNode` / string with converter |
| `text[]` | `List<String>` with custom mapping or jOOQ |
| enum | Java enum with migration discipline |

### 19.2 Avoid Primitive Trap

Jika kolom nullable, jangan mapping ke primitive Java:

```java
private int retryCount; // buruk jika DB nullable
```

Gunakan:

```java
private Integer retryCount;
```

Lebih baik lagi, buat DB `NOT NULL DEFAULT 0` jika null tidak punya makna.

### 19.3 Enum Deployment Compatibility

Jika Java enum dan DB enum/check constraint berubah, deployment harus hati-hati.

Contoh masalah:

```text
Version A aplikasi belum mengenal status ESCALATED.
Migration menambahkan ESCALATED.
Version B mulai menulis ESCALATED.
Sebagian node Version A membaca row ESCALATED lalu gagal deserialize.
```

Solusi:

- expand-contract,
- deploy reader compatibility dulu,
- jangan langsung menulis value baru sebelum semua reader siap,
- siapkan fallback unknown enum jika domain mengizinkan,
- gunakan text + check jika evolusi cepat.

---

## 20. Schema Design untuk Regulatory/Case Management System

Untuk sistem regulasi, enforcement lifecycle, atau complex case management, schema bukan hanya performa. Schema adalah artefak defensibility.

Pertanyaan penting:

```text
Bisakah kita membuktikan data tidak mungkin berada dalam state invalid?
Bisakah audit menjelaskan kapan dan kenapa nilai berubah?
Bisakah constraint mencegah double-active assignment?
Bisakah period policy overlap dicegah di database?
Bisakah nomor case unik dijamin secara concurrency-safe?
Bisakah soft delete tidak merusak uniqueness?
```

### 20.1 Example: Case File

```sql
CREATE TABLE case_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id bigint NOT NULL,
    case_number text NOT NULL,
    status text NOT NULL,
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT ux_case_file_public_id UNIQUE (public_id),
    CONSTRAINT ux_case_file_tenant_case_number UNIQUE (tenant_id, case_number),
    CONSTRAINT chk_case_status CHECK (
        status IN ('DRAFT', 'OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')
    ),
    CONSTRAINT chk_case_closed_after_opened CHECK (
        closed_at IS NULL OR closed_at >= opened_at
    ),
    CONSTRAINT chk_case_closed_status_consistency CHECK (
        (closed_at IS NULL AND status <> 'CLOSED')
        OR
        (closed_at IS NOT NULL AND status = 'CLOSED')
    )
);
```

Catatan: constraint terakhir mungkin terlalu ketat jika ada status terminal lain seperti `CANCELLED`. Ini menunjukkan bahwa constraint harus mengikuti domain nyata, bukan template.

### 20.2 Example: Assignment Period tanpa Overlap

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE case_assignment_period (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL REFERENCES case_file(id),
    officer_id bigint NOT NULL,
    assigned_period tstzrange NOT NULL,
    assigned_by bigint NOT NULL,
    reason text NOT NULL,

    CONSTRAINT chk_assignment_period_not_empty CHECK (NOT isempty(assigned_period)),
    CONSTRAINT ex_case_assignment_no_overlap
        EXCLUDE USING gist (
            case_id WITH =,
            assigned_period WITH &&
        )
);
```

Invariant:

```text
Satu case tidak boleh punya dua assignment aktif/overlap pada waktu yang sama.
```

Ini jauh lebih kuat daripada cek manual di aplikasi sebelum insert, karena constraint aman di bawah concurrency.

---

## 21. Decision Framework: Memilih Tipe PostgreSQL

Gunakan checklist ini saat mendesain column.

### 21.1 Pertanyaan Domain

```text
Apakah nilai ini wajib ada?
Apakah nilai ini identifier, amount, instant, local date, duration, status, interval, set, document, atau reference?
Apakah nilainya punya batas valid?
Apakah validasinya lokal ke row atau butuh table lain?
Apakah value ini akan berubah vocabulary-nya?
Apakah ada invariant lintas row?
```

### 21.2 Pertanyaan Query

```text
Apakah kolom ini dipakai filter?
Apakah dipakai join?
Apakah dipakai sorting?
Apakah dipakai grouping/reporting?
Apakah dipakai full-text/search?
Apakah operator yang dipakai equality, range, containment, overlap, similarity?
```

### 21.3 Pertanyaan Operational

```text
Seberapa sering column ini berubah?
Apakah update-nya akan memicu index write amplification?
Apakah nilai ini besar dan masuk TOAST?
Apakah migration type akan mahal?
Apakah perubahan vocabulary perlu zero-downtime?
Apakah backup/restore/reporting akan terpengaruh?
```

### 21.4 Pertanyaan Java Integration

```text
Apakah JDBC/ORM mapping natural?
Apakah perlu converter?
Apakah enum evolution aman?
Apakah nullability Java sesuai DB?
Apakah timezone mapping eksplisit?
Apakah BigDecimal scale ditangani benar?
```

---

## 22. Anti-pattern Schema PostgreSQL yang Sering Terjadi

### 22.1 Semua Jadi `text`

```sql
amount text,
created_at text,
status text,
is_active text
```

Database kehilangan type semantics.

### 22.2 Semua Jadi JSONB

```sql
data jsonb NOT NULL
```

Relational invariant hilang.

### 22.3 Status Pakai Banyak Boolean

```sql
is_open boolean,
is_closed boolean,
is_cancelled boolean
```

State invalid mudah muncul.

### 22.4 Timestamp tanpa Kesadaran Timezone

```sql
created_at timestamp without time zone
```

Untuk event absolute, ini rentan salah interpretasi.

### 22.5 `double` untuk Uang

```sql
amount double precision
```

Audit financial/regulatory berisiko.

### 22.6 `varchar(255)` Default Tanpa Makna

```sql
description varchar(255)
```

Angka 255 sering warisan, bukan invariant.

### 22.7 ID Public Pakai Sequence Internal

```text
/api/cases/1001
/api/cases/1002
```

Bisa mengekspos volume dan urutan. Pertimbangkan `public_id uuid` atau domain-specific case number.

### 22.8 Nullable Everywhere

Semua kolom nullable membuat invariant kabur.

### 22.9 Enum untuk Domain yang Sering Berubah

Membuat deployment dan migration sulit.

### 22.10 Array untuk Relasi Bermakna

Jika item perlu metadata/FK/audit, gunakan join table.

---

## 23. Production Migration Considerations

Tipe data bukan hanya desain awal. Tipe data menentukan biaya evolusi.

### 23.1 Menambah Column Aman

Umumnya:

```sql
ALTER TABLE case_file ADD COLUMN priority text;
```

Lalu backfill, kemudian constraint:

```sql
ALTER TABLE case_file
ADD CONSTRAINT chk_case_priority
CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')) NOT VALID;

ALTER TABLE case_file
VALIDATE CONSTRAINT chk_case_priority;
```

Setelah semua row valid:

```sql
ALTER TABLE case_file
ALTER COLUMN priority SET NOT NULL;
```

### 23.2 Mengubah Type Bisa Mahal

Contoh:

```sql
ALTER TABLE event_log
ALTER COLUMN payload TYPE jsonb USING payload::jsonb;
```

Pada tabel besar, ini bisa rewrite dan lock signifikan. Rencanakan dengan expand-contract:

1. tambah kolom baru,
2. dual write,
3. backfill batch,
4. switch read,
5. drop kolom lama.

### 23.3 Enum Evolution

Menambah enum value relatif mudah dibanding rename/remove. Tetapi deployment multi-version tetap harus dirancang.

### 23.4 JSONB ke Column Normal

Jika field JSONB makin penting:

1. tambah column normal,
2. backfill dari JSONB,
3. add constraint/index,
4. update writer,
5. update reader,
6. opsional hapus dari JSONB atau biarkan sebagai historical payload.

---

## 24. Practical Design Examples

### 24.1 User Table

```sql
CREATE TABLE app_user (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id uuid NOT NULL DEFAULT gen_random_uuid(),
    email text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ux_app_user_public_id UNIQUE (public_id),
    CONSTRAINT chk_app_user_email_not_blank CHECK (length(trim(email)) > 0),
    CONSTRAINT chk_app_user_display_name_not_blank CHECK (length(trim(display_name)) > 0),
    CONSTRAINT chk_app_user_status CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED'))
);

CREATE UNIQUE INDEX ux_app_user_email_lower
ON app_user (lower(email));
```

### 24.2 Idempotency Key Table

```sql
CREATE TABLE idempotency_key (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response_payload jsonb,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,

    CONSTRAINT ux_idempotency_key_tenant_key UNIQUE (tenant_id, key),
    CONSTRAINT chk_idempotency_status CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT chk_idempotency_expiry CHECK (expires_at > created_at)
);
```

### 24.3 Outbox Event Table

```sql
CREATE TABLE outbox_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    event_type text NOT NULL,
    event_version integer NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    retry_count integer NOT NULL DEFAULT 0,

    CONSTRAINT chk_outbox_retry_count CHECK (retry_count >= 0),
    CONSTRAINT chk_outbox_event_version CHECK (event_version > 0)
);

CREATE INDEX ix_outbox_unpublished
ON outbox_event (occurred_at, id)
WHERE published_at IS NULL;
```

---

## 25. How Top-tier Engineers Think About PostgreSQL Types

Engineer biasa bertanya:

```text
Tipe apa yang paling gampang dimapping ORM?
```

Engineer kuat bertanya:

```text
Apa invariant domain?
Apa operator query dominan?
Apa failure mode jika aplikasi bug?
Apa biaya migrasi jika domain berubah?
Apa bentuk index yang akan dibutuhkan?
Apa konsekuensi terhadap storage, WAL, vacuum, dan Java mapping?
```

PostgreSQL type system adalah alat desain sistem. Tujuannya bukan membuat schema “terlihat advanced”, tetapi membuat data model:

- lebih benar,
- lebih mudah dijelaskan,
- lebih mudah diobservasi,
- lebih sulit rusak,
- lebih efisien untuk query nyata,
- lebih aman saat concurrency,
- lebih defensible secara audit.

---

## 26. Checklist Review Schema PostgreSQL

Gunakan checklist ini sebelum merge migration.

### Correctness

- Apakah kolom penting `NOT NULL`?
- Apakah status punya constraint?
- Apakah amount memakai `numeric`, bukan floating point?
- Apakah timestamp event memakai `timestamptz`?
- Apakah FK dipakai untuk reference penting?
- Apakah invariant lintas row butuh unique/exclusion constraint?
- Apakah soft delete memerlukan partial unique index?

### Queryability

- Apakah tipe mendukung operator query yang dibutuhkan?
- Apakah JSONB field yang sering difilter sebaiknya jadi column?
- Apakah array benar-benar lebih tepat daripada join table?
- Apakah range bisa menyederhanakan overlap query?

### Evolution

- Apakah enum terlalu kaku?
- Apakah check constraint lebih mudah dievolusi?
- Apakah migration type akan rewrite tabel besar?
- Apakah deployment multi-version aman?

### Java Integration

- Apakah `timestamptz` dimapping ke `Instant`/`OffsetDateTime`?
- Apakah `numeric` dimapping ke `BigDecimal`?
- Apakah UUID native dimapping ke `UUID`?
- Apakah nullable DB sesuai nullable Java?
- Apakah enum reader kompatibel dengan value baru?

### Operations

- Apakah default database mencegah invalid insert dari tool/batch?
- Apakah index untuk constraint dan query penting sudah ada?
- Apakah kolom besar/JSONB akan menyebabkan TOAST dan update cost?
- Apakah schema mendukung audit dan incident diagnosis?

---

## 27. Ringkasan Part 016

PostgreSQL schema design bukan hanya memilih tipe data. Ini adalah desain kontrak antara domain, database engine, query planner, aplikasi Java, migration process, dan operasi produksi.

Poin utama:

1. Pilih type berdasarkan invariant dan operator, bukan kebiasaan.
2. Gunakan `numeric`/`BigDecimal` untuk uang dan nilai exact.
3. Gunakan `timestamptz`/`Instant` untuk event absolute.
4. Gunakan `date` untuk tanggal domain tanpa jam.
5. Gunakan UUID native jika butuh public/distributed identifier, tetapi pahami biaya index-nya.
6. Gunakan identity column untuk surrogate key internal.
7. Gunakan enum hanya untuk vocabulary stabil.
8. Gunakan `text + CHECK` atau lookup table untuk lifecycle yang berevolusi.
9. Gunakan domain type untuk reusable invariant sederhana.
10. Gunakan range type dan exclusion constraint untuk interval/overlap invariant.
11. Gunakan array hanya untuk scalar set kecil, bukan relasi bermakna.
12. Gunakan JSONB untuk fleksibilitas, bukan untuk mengganti relational model.
13. Gunakan generated column untuk derivasi yang harus konsisten dan indexable.
14. Jangan biarkan ORM menjadi alasan melemahkan invariant database.
15. Desain schema harus mempertimbangkan migration, observability, dan failure mode.

---

## 28. Latihan Mandiri

### Latihan 1 — Review Tipe Data

Ambil satu table dari aplikasi yang pernah kamu kerjakan. Untuk setiap kolom, jawab:

```text
Apa tipe PostgreSQL-nya?
Apakah tipe itu merepresentasikan domain dengan benar?
Apakah nullability-nya benar?
Apakah ada constraint yang hilang?
Apakah Java mapping-nya tepat?
```

### Latihan 2 — Refactor JSONB Overuse

Desain ulang table berikut:

```sql
CREATE TABLE case_file (
    id bigint PRIMARY KEY,
    data jsonb NOT NULL
);
```

Dengan asumsi `data` berisi:

```json
{
  "tenantId": 10,
  "caseNumber": "CASE-2026-0001",
  "status": "OPEN",
  "openedAt": "2026-06-01T10:00:00Z",
  "assignedOfficerId": 99,
  "priority": "HIGH",
  "externalReference": "EXT-777"
}
```

Pisahkan mana yang harus menjadi column normal, mana yang boleh tetap JSONB.

### Latihan 3 — Model Effective-dated Policy

Buat schema untuk `tax_rate_policy` yang:

- punya `policy_code`,
- punya effective period,
- punya rate exact decimal,
- tidak boleh overlap untuk policy code yang sama,
- bisa query rate yang berlaku pada waktu tertentu.

Gunakan range type dan exclusion constraint.

### Latihan 4 — Java Mapping Review

Untuk schema berikut:

```sql
CREATE TABLE payment_obligation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    amount numeric(19, 4) NOT NULL,
    currency_code char(3) NOT NULL,
    due_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Tentukan tipe Java yang tepat untuk setiap kolom dan jelaskan alasannya.

---

## 29. Penutup

Part ini memberi fondasi schema design PostgreSQL-specific. Setelah ini, kita akan masuk lebih dalam ke salah satu fitur yang paling sering disalahgunakan sekaligus sangat berguna: `JSONB` dan hybrid relational modelling.

Di Part 017, fokusnya bukan hanya syntax JSONB, tetapi bagaimana menentukan batas antara relational column dan document fragment, bagaimana index JSONB bekerja, bagaimana menjaga invariant, dan kapan JSONB justru merusak architecture.

---

**Status seri:** belum selesai.  
**Selesai sampai:** Part 016 dari 034.  
**Berikutnya:** Part 017 — JSONB dan Hybrid Relational Modelling.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Constraints as Invariants: PostgreSQL untuk Menjaga Kebenaran Domain</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-017.md">Part 017 — JSONB dan Hybrid Relational Modelling ➡️</a>
</div>
