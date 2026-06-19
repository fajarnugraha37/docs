# learn-postgresql-mastery-for-java-engineers-part-017.md

# Part 017 — JSONB dan Hybrid Relational Modelling

## Status Seri

Kita berada di **Part 017 dari 034** dalam seri:

```text
learn-postgresql-mastery-for-java-engineers
```

Bagian sebelumnya membahas **schema design PostgreSQL-specific**: tipe data, UUID, timestamp, enum, domain, range, array, JSONB secara pengantar, generated columns, identity, dan implikasi mapping ke Java.

Bagian ini memperdalam satu topik yang sering terlihat sederhana tetapi sangat menentukan kualitas desain sistem: **JSONB dan hybrid relational modelling**.

Tujuan bagian ini bukan membuat semua data menjadi JSONB. Justru sebaliknya: membangun kemampuan untuk memutuskan **bagian mana harus tetap relasional**, **bagian mana boleh semi-struktural**, dan **bagaimana menjaga correctness, evolvability, observability, serta performance** ketika keduanya digabung.

---

## 1. Core Question

Pertanyaan inti bagian ini:

> Kapan PostgreSQL JSONB adalah desain yang kuat, dan kapan JSONB adalah tanda bahwa model domain belum dipahami?

Untuk Java backend engineer, JSONB sering menggoda karena terasa fleksibel:

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    case_number text NOT NULL,
    status text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Lalu aplikasi Java bisa menyimpan payload dinamis tanpa migration:

```json
{
  "riskScore": 87,
  "sourceSystem": "AML_GATEWAY",
  "assignedRegion": "APAC",
  "extraFlags": ["PEP", "HIGH_VALUE"]
}
```

Di permukaan, ini terlihat pragmatis. Tetapi di sistem produksi, pertanyaannya bukan hanya “bisa disimpan atau tidak”. Pertanyaan yang lebih penting:

1. Apakah field tersebut bagian dari invariant domain?
2. Apakah field tersebut perlu di-query secara sering?
3. Apakah field tersebut perlu di-index?
4. Apakah field tersebut perlu divalidasi database?
5. Apakah field tersebut akan ikut join/reporting?
6. Apakah field tersebut punya lifecycle migration?
7. Apakah field tersebut penting untuk audit/regulatory defensibility?
8. Apakah perubahan field tersebut harus terlihat oleh schema review?
9. Apakah Java service lain bergantung pada struktur internalnya?
10. Apakah kita siap menanggung biaya index/write amplification dari JSONB?

JSONB bukan pengganti relational modelling. JSONB adalah alat untuk area data yang memang semi-struktural, jarang berubah menjadi invariant inti, atau membutuhkan fleksibilitas terkontrol.

---

## 2. Mental Model: PostgreSQL Bukan Document Database, Tetapi Bisa Menyimpan Dokumen

PostgreSQL adalah relational database dengan kemampuan document-like melalui `json` dan `jsonb`.

Mental model yang sehat:

```text
PostgreSQL table
  = kumpulan fakta terstruktur dengan invariant kuat

JSONB column
  = kantong semi-struktural untuk atribut yang fleksibel, optional, bervariasi, atau berasal dari external payload
```

Yang keliru:

```text
PostgreSQL + JSONB = MongoDB di dalam PostgreSQL
```

Kenapa keliru?

Karena PostgreSQL tetap paling kuat ketika:

1. struktur utama data dinyatakan dalam kolom,
2. invariant penting dijaga constraint,
3. relasi penting dinyatakan foreign key,
4. query utama ditopang index yang jelas,
5. perubahan schema terlihat eksplisit,
6. domain model dapat dibaca dari DDL.

JSONB menambah fleksibilitas, tetapi jika seluruh domain disembunyikan di JSONB, database kehilangan banyak kemampuan terbaiknya:

1. type checking kuat,
2. foreign key,
3. unique constraint normal,
4. check constraint sederhana,
5. statistics planner yang kaya,
6. query readability,
7. schema discoverability,
8. migration discipline,
9. audit clarity.

Top-tier engineer tidak bertanya “bisa pakai JSONB atau tidak”. Ia bertanya:

> Bagian mana dari data ini harus menjadi kontrak relasional, dan bagian mana boleh menjadi dokumen fleksibel?

---

## 3. `json` vs `jsonb`

PostgreSQL menyediakan dua tipe utama:

```sql
json
jsonb
```

Secara praktis, sebagian besar aplikasi modern memakai `jsonb`.

### 3.1 `json`

`json` menyimpan teks JSON dalam bentuk yang mempertahankan representasi input lebih dekat ke aslinya.

Karakteristik konseptual:

1. Disimpan sebagai teks JSON valid.
2. Parsing dilakukan saat operasi tertentu.
3. Dapat mempertahankan detail tekstual tertentu seperti urutan key dan whitespace.
4. Umumnya kurang cocok untuk query/indexing intensif.

### 3.2 `jsonb`

`jsonb` menyimpan JSON dalam bentuk binary decomposed internal.

Karakteristik konseptual:

1. Lebih cocok untuk operasi query.
2. Mendukung operator containment yang kuat.
3. Mendukung indexing GIN.
4. Tidak mempertahankan urutan key object.
5. Duplicate key dinormalisasi sesuai aturan internal.
6. Cocok untuk kebanyakan use case aplikasi.

Dalam desain backend produksi, default yang umum:

```text
Gunakan jsonb, kecuali ada alasan kuat untuk menyimpan representasi JSON mentah secara tekstual.
```

Contoh alasan memakai `json`:

1. ingin menyimpan payload persis seperti diterima,
2. payload dipakai sebagai arsip mentah,
3. tidak banyak query ke field internal,
4. canonical representation penting di luar database.

Tetapi untuk hybrid modelling dan query:

```text
jsonb adalah pilihan utama.
```

---

## 4. JSONB sebagai Value, Bukan Magic Object

Salah satu kesalahan umum adalah memperlakukan JSONB seperti object Java biasa.

Di Java:

```java
metadata.get("riskScore")
metadata.put("assignedRegion", "APAC")
```

Tampak seperti update sebagian object.

Di PostgreSQL, update JSONB tetap update row version.

Jika row memiliki kolom JSONB besar:

```sql
UPDATE cases
SET metadata = jsonb_set(metadata, '{riskScore}', '88'::jsonb)
WHERE id = '...';
```

Secara logical hanya satu field berubah. Tetapi secara MVCC:

1. row version baru dibuat,
2. old tuple menjadi dead tuple,
3. WAL ditulis,
4. index terkait mungkin ikut berubah,
5. TOAST data mungkin terlibat,
6. vacuum nanti harus membersihkan versi lama.

Mental model penting:

```text
JSONB field update != in-place mutation murah seperti HashMap.
JSONB field update = row update PostgreSQL dengan konsekuensi MVCC.
```

Implikasi:

1. Jangan taruh field high-churn di JSONB besar jika sering diupdate.
2. Jangan campur payload besar dengan state kecil yang sering berubah.
3. Jangan update seluruh JSONB hanya untuk mengubah satu metadata kecil tanpa sadar biaya write amplification.
4. Pertimbangkan memisahkan tabel detail jika bagian data punya lifecycle sendiri.

---

## 5. Use Case JSONB yang Masuk Akal

JSONB kuat untuk beberapa kategori data.

### 5.1 External Payload Snapshot

Contoh:

```sql
CREATE TABLE inbound_messages (
    id uuid PRIMARY KEY,
    source_system text NOT NULL,
    received_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    processing_status text NOT NULL
);
```

Cocok karena:

1. struktur payload bisa berubah sesuai source system,
2. payload perlu disimpan untuk audit/debugging,
3. tidak semua field perlu dijadikan kolom,
4. query utama mungkin berdasarkan `source_system`, `received_at`, dan `processing_status`, bukan seluruh isi payload.

Tetapi field yang sering dipakai untuk routing sebaiknya dipromosikan menjadi kolom:

```sql
ALTER TABLE inbound_messages
ADD COLUMN external_reference text;
```

Lalu saat ingest:

```sql
INSERT INTO inbound_messages (
    id,
    source_system,
    received_at,
    external_reference,
    payload,
    processing_status
)
VALUES (
    gen_random_uuid(),
    'AML_GATEWAY',
    now(),
    $1,
    $2::jsonb,
    'RECEIVED'
);
```

Rule:

```text
Store raw payload in JSONB.
Promote operationally important fields to columns.
```

### 5.2 Optional Metadata

Contoh case management:

```sql
CREATE TABLE regulatory_cases (
    id uuid PRIMARY KEY,
    case_number text NOT NULL UNIQUE,
    lifecycle_status text NOT NULL,
    created_at timestamptz NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Metadata mungkin berisi:

```json
{
  "originChannel": "PORTAL",
  "riskCategory": "HIGH",
  "sourceTags": ["KYC", "SANCTION_SCREENING"],
  "importBatchId": "batch-2026-06-19-001"
}
```

Cocok bila:

1. metadata tidak menentukan state transition utama,
2. metadata berbeda antar source,
3. metadata bisa berkembang tanpa migration sering,
4. metadata kadang dicari tetapi bukan basis semua query utama.

### 5.3 Feature-specific Attributes

Misalnya sistem memiliki case type berbeda:

```text
AML case
Fraud case
Licensing violation case
Market conduct case
Consumer complaint case
```

Semua punya kolom umum:

1. `id`,
2. `case_number`,
3. `status`,
4. `created_at`,
5. `assigned_unit_id`,
6. `subject_id`.

Tetapi masing-masing punya atribut spesifik.

Desain hybrid:

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    case_number text NOT NULL UNIQUE,
    case_type text NOT NULL,
    status text NOT NULL,
    assigned_unit_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    created_at timestamptz NOT NULL,
    type_specific_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Cocok jika atribut spesifik:

1. tidak semua case type membutuhkannya,
2. query lintas case type tetap memakai kolom umum,
3. validasi spesifik bisa dilakukan di application layer atau trigger/check terbatas,
4. volume dan access pattern masih terkendali.

Tetapi jika atribut spesifik menjadi sangat penting dan sering di-query, lebih baik dipisah:

```sql
CREATE TABLE aml_case_details (
    case_id uuid PRIMARY KEY REFERENCES cases(id),
    risk_score integer NOT NULL,
    screening_reference text NOT NULL,
    matched_watchlist_count integer NOT NULL
);
```

Rule:

```text
JSONB baik untuk variasi peripheral.
Tabel relasional lebih baik untuk variasi yang menjadi domain utama.
```

### 5.4 Audit Context

Audit event sering membutuhkan context tambahan:

```sql
CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_id uuid,
    occurred_at timestamptz NOT NULL,
    context jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

`context` bisa berisi:

```json
{
  "oldStatus": "UNDER_REVIEW",
  "newStatus": "ESCALATED",
  "reasonCode": "HIGH_RISK_SIGNAL",
  "ipAddress": "203.0.113.10",
  "userAgent": "...",
  "requestId": "..."
}
```

Cocok karena audit context sering variatif. Tetapi field yang menjadi query utama tetap perlu kolom:

1. `entity_type`,
2. `entity_id`,
3. `event_type`,
4. `occurred_at`,
5. `actor_id`.

Jangan membuat audit table seperti ini:

```sql
CREATE TABLE audit_events_bad (
    id uuid PRIMARY KEY,
    payload jsonb NOT NULL
);
```

Karena query umum menjadi buruk:

```sql
SELECT *
FROM audit_events_bad
WHERE payload->>'entityType' = 'CASE'
  AND payload->>'entityId' = '...'
  AND payload->>'eventType' = 'STATUS_CHANGED'
ORDER BY (payload->>'occurredAt')::timestamptz DESC;
```

Itu membuat semua kontrak penting tersembunyi.

---

## 6. Use Case JSONB yang Biasanya Buruk

### 6.1 Menyimpan Domain Utama sebagai JSONB

Contoh buruk:

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    document jsonb NOT NULL
);
```

Payload:

```json
{
  "caseNumber": "CASE-2026-0001",
  "status": "UNDER_REVIEW",
  "assignedOfficerId": "...",
  "createdAt": "2026-06-19T10:00:00Z",
  "subjectId": "..."
}
```

Masalah:

1. `caseNumber` sulit diberi unique constraint normal.
2. `status` sulit dijaga transition-nya.
3. `assignedOfficerId` tidak punya foreign key.
4. `subjectId` tidak punya foreign key.
5. query utama butuh expression index banyak.
6. migration struktur tidak terlihat jelas.
7. schema contract pindah ke kode Java.
8. reporting lebih sulit.
9. data quality menurun.
10. planner statistics lebih lemah dibanding kolom normal.

Desain lebih baik:

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    case_number text NOT NULL UNIQUE,
    status text NOT NULL,
    assigned_officer_id uuid REFERENCES officers(id),
    subject_id uuid NOT NULL REFERENCES subjects(id),
    created_at timestamptz NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

### 6.2 Menghindari Migration dengan JSONB

Motif buruk:

```text
Kita taruh saja di JSONB supaya tidak perlu migration.
```

Ini sering hanya memindahkan migration dari database ke aplikasi, tetapi tanpa:

1. review DDL,
2. constraint,
3. type safety database,
4. migration script,
5. rollback plan,
6. discoverability.

Perubahan schema tetap terjadi, hanya menjadi implicit.

Contoh:

Versi lama:

```json
{
  "riskScore": 80
}
```

Versi baru:

```json
{
  "risk": {
    "score": 80,
    "level": "HIGH"
  }
}
```

Jika aplikasi membaca dua bentuk sekaligus, kamu tetap punya migration problem:

1. dual-read logic,
2. backfill,
3. compatibility,
4. validation,
5. test data,
6. reporting compatibility.

Rule:

```text
JSONB tidak menghilangkan schema evolution.
JSONB hanya mengubah tempat schema evolution berada.
```

### 6.3 Menaruh Field yang Sering Diupdate di JSONB Besar

Contoh:

```json
{
  "largeProfile": { ... 200KB ... },
  "lastViewedAt": "2026-06-19T12:00:00Z"
}
```

Jika `lastViewedAt` sering berubah, row besar ikut diupdate. Ini bisa menyebabkan:

1. dead tuple banyak,
2. WAL besar,
3. TOAST churn,
4. vacuum pressure,
5. cache churn,
6. replication lag.

Desain lebih baik:

```sql
CREATE TABLE case_views (
    case_id uuid PRIMARY KEY REFERENCES cases(id),
    last_viewed_at timestamptz NOT NULL
);
```

Atau kolom terpisah jika satu-ke-satu dan ukurannya kecil:

```sql
ALTER TABLE cases
ADD COLUMN last_viewed_at timestamptz;
```

### 6.4 JSONB sebagai Pengganti Relasi Many-to-Many

Contoh buruk:

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    related_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);
```

Payload:

```json
["user-1", "user-2", "user-3"]
```

Masalah:

1. tidak ada FK ke users,
2. sulit mencegah duplicate,
3. sulit menyimpan role per relation,
4. sulit query reverse relation,
5. sulit audit perubahan relation,
6. update array menyebabkan rewrite JSONB.

Desain lebih baik:

```sql
CREATE TABLE case_users (
    case_id uuid NOT NULL REFERENCES cases(id),
    user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL,
    assigned_at timestamptz NOT NULL,
    PRIMARY KEY (case_id, user_id, role)
);
```

Rule:

```text
Jika hubungan antar entity penting, gunakan tabel relasi.
Jangan sembunyikan relation di JSONB.
```

---

## 7. Hybrid Relational Modelling: Framework Keputusan

Untuk setiap field, tanyakan:

### 7.1 Apakah Field Ini Identitas?

Contoh:

1. `case_number`,
2. `external_reference`,
3. `customer_id`,
4. `tenant_id`,
5. `document_number`.

Jika ya, biasanya kolom.

Kenapa?

1. butuh unique constraint,
2. butuh lookup cepat,
3. butuh referensi jelas,
4. sering muncul di log/tracing,
5. penting untuk support/debugging.

### 7.2 Apakah Field Ini Bagian dari State Machine?

Contoh:

1. `status`,
2. `stage`,
3. `assigned_team_id`,
4. `decision_outcome`,
5. `escalation_level`.

Jika ya, biasanya kolom.

State machine field harus mudah:

1. di-lock,
2. di-update kondisional,
3. di-index untuk work queue,
4. diaudit,
5. dikontrol constraint.

Jangan desain seperti ini:

```sql
UPDATE cases
SET metadata = jsonb_set(metadata, '{status}', '"ESCALATED"')
WHERE id = $1;
```

Lebih baik:

```sql
UPDATE cases
SET status = 'ESCALATED',
    updated_at = now()
WHERE id = $1
  AND status = 'UNDER_REVIEW';
```

### 7.3 Apakah Field Ini Sering Menjadi Predicate Query?

Contoh:

```sql
WHERE risk_score >= 80
WHERE assigned_region = 'APAC'
WHERE source_system = 'AML_GATEWAY'
WHERE due_date < now()
```

Jika sering, pertimbangkan kolom.

JSONB bisa di-index, tetapi kolom normal biasanya lebih:

1. readable,
2. type-safe,
3. planner-friendly,
4. constraint-friendly,
5. ORM-friendly,
6. migration-friendly.

### 7.4 Apakah Field Ini Perlu Foreign Key?

Jika field menunjuk entity lain, gunakan kolom.

Buruk:

```json
{
  "assignedOfficerId": "..."
}
```

Baik:

```sql
assigned_officer_id uuid REFERENCES officers(id)
```

### 7.5 Apakah Field Ini Bervariasi Per Tipe Entity?

Jika field hanya relevan untuk sebagian tipe, JSONB bisa masuk akal.

Tetapi jika subtype punya banyak logic dan query khusus, pertimbangkan tabel detail subtype.

```text
Variasi kecil/metadata      -> JSONB
Variasi besar/domain utama  -> table per subtype/detail
```

### 7.6 Apakah Field Ini Butuh Audit/Regulatory Explanation?

Untuk sistem regulatory, enforcement, case management, dan workflow, auditability penting.

Field yang dipakai untuk keputusan formal sebaiknya eksplisit.

Contoh field yang sebaiknya kolom:

1. `decision_status`,
2. `decision_reason_code`,
3. `approved_by`,
4. `approved_at`,
5. `legal_basis_code`,
6. `escalation_reason`,
7. `sla_due_at`.

Jika alasan keputusan formal hanya ada di JSONB tanpa constraint, kamu berisiko saat perlu menjelaskan:

1. siapa mengubah,
2. kapan berubah,
3. nilai valid apa,
4. field wajib apa,
5. apakah formatnya konsisten,
6. bagaimana memastikan datanya tidak korup.

---

## 8. Pattern: Core Columns + Metadata JSONB

Pattern paling umum dan sehat:

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_number text NOT NULL,
    case_type text NOT NULL,
    status text NOT NULL,
    priority text NOT NULL,
    assigned_unit_id uuid,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (tenant_id, case_number)
);
```

Core columns menyimpan:

1. identity,
2. tenant boundary,
3. state,
4. ownership,
5. lifecycle timestamp,
6. frequently queried fields,
7. relational references.

`metadata` menyimpan:

1. source-specific attributes,
2. display hints,
3. optional flags,
4. external payload fragments,
5. integration-specific context,
6. rare filters.

Keuntungan:

1. query utama tetap cepat,
2. invariant utama tetap kuat,
3. JSONB tetap memberi fleksibilitas,
4. migration tidak terlalu sering untuk field minor,
5. reporting utama tetap mudah,
6. debug context tetap lengkap.

---

## 9. Pattern: Raw Payload + Extracted Columns

Untuk ingestion system, pattern kuat adalah menyimpan payload asli sekaligus mengekstrak field penting.

```sql
CREATE TABLE inbound_case_events (
    id uuid PRIMARY KEY,
    source_system text NOT NULL,
    external_event_id text NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    UNIQUE (source_system, external_event_id)
);
```

Aplikasi Java menerima JSON eksternal:

```json
{
  "eventId": "evt-123",
  "type": "CASE_ESCALATED",
  "occurredAt": "2026-06-19T10:15:30Z",
  "case": {
    "externalReference": "EXT-999",
    "riskScore": 92
  }
}
```

Saat insert, service mengekstrak:

1. `external_event_id`,
2. `event_type`,
3. `occurred_at`,
4. `source_system`.

Payload lengkap tetap disimpan.

Manfaat:

1. idempotency bisa ditegakkan dengan unique constraint,
2. routing cepat,
3. audit payload tersedia,
4. perubahan payload eksternal tidak langsung memaksa semua field menjadi kolom,
5. query operasional tidak harus parse JSONB setiap saat.

---

## 10. Pattern: JSONB for Sparse Attributes

Kadang entity memiliki banyak optional attributes, tetapi hanya sedikit yang terisi per row.

Contoh licensing system:

```text
License type A punya attribute a1, a2, a3
License type B punya attribute b1, b2, b3, b4
License type C punya attribute c1
```

Jika semua menjadi kolom:

```sql
CREATE TABLE licenses (
    id uuid PRIMARY KEY,
    license_type text NOT NULL,
    a1 text,
    a2 text,
    a3 text,
    b1 text,
    b2 text,
    b3 text,
    b4 text,
    c1 text
);
```

Ini bisa menjadi sparse dan sulit berkembang.

Alternatif:

```sql
CREATE TABLE licenses (
    id uuid PRIMARY KEY,
    license_type text NOT NULL,
    status text NOT NULL,
    holder_id uuid NOT NULL,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Namun perlu governance:

1. definisi attribute per license type,
2. validasi application-level,
3. optional generated columns untuk field penting,
4. index hanya untuk query penting,
5. dokumentasi schema JSON,
6. migration plan saat attribute menjadi penting.

Jika attribute mulai sering dipakai untuk workflow, constraint, atau reporting, promosikan ke kolom/tabel.

---

## 11. JSONB Operators yang Harus Dikuasai

### 11.1 Access Object Field sebagai JSON

```sql
SELECT metadata->'risk'
FROM cases;
```

`->` mengembalikan JSON/JSONB value.

### 11.2 Access Object Field sebagai Text

```sql
SELECT metadata->>'riskCategory'
FROM cases;
```

`->>` mengembalikan text.

Ini sering dipakai untuk comparison:

```sql
SELECT *
FROM cases
WHERE metadata->>'riskCategory' = 'HIGH';
```

### 11.3 Nested Access

```sql
SELECT metadata #> '{risk,score}'
FROM cases;
```

Sebagai text:

```sql
SELECT metadata #>> '{risk,score}'
FROM cases;
```

### 11.4 Containment

```sql
SELECT *
FROM cases
WHERE metadata @> '{"riskCategory": "HIGH"}'::jsonb;
```

Artinya: metadata mengandung object tersebut.

Ini operator penting untuk GIN index.

### 11.5 Key Existence

```sql
SELECT *
FROM cases
WHERE metadata ? 'riskCategory';
```

### 11.6 Any Key Exists

```sql
SELECT *
FROM cases
WHERE metadata ?| array['riskCategory', 'sourceSystem'];
```

### 11.7 All Keys Exist

```sql
SELECT *
FROM cases
WHERE metadata ?& array['riskCategory', 'sourceSystem'];
```

### 11.8 Delete Key

```sql
UPDATE cases
SET metadata = metadata - 'deprecatedField'
WHERE metadata ? 'deprecatedField';
```

### 11.9 Concatenate/Merge

```sql
UPDATE cases
SET metadata = metadata || '{"riskCategory": "HIGH"}'::jsonb
WHERE id = $1;
```

Perhatikan: merge object top-level, bukan deep merge kompleks.

### 11.10 Update Nested Field dengan `jsonb_set`

```sql
UPDATE cases
SET metadata = jsonb_set(metadata, '{risk,score}', '90'::jsonb, true)
WHERE id = $1;
```

Parameter terakhir `true` berarti create missing path.

---

## 12. JSON Path

PostgreSQL mendukung SQL/JSON path operations.

Contoh konseptual:

```sql
SELECT *
FROM cases
WHERE metadata @? '$.risk.score ? (@ >= 80)';
```

Atau:

```sql
SELECT jsonb_path_query(metadata, '$.sourceTags[*]')
FROM cases;
```

JSON path berguna ketika:

1. struktur nested,
2. perlu expression lebih kompleks,
3. array traversal,
4. filter berdasarkan nilai di dalam dokumen.

Tetapi untuk query operasional yang sering, jangan langsung menjadikan JSON path sebagai default. Tanyakan:

```text
Apakah ini sebenarnya field penting yang harus dipromosikan menjadi kolom?
```

---

## 13. Indexing JSONB

JSONB bisa di-index. Tetapi index JSONB harus dirancang berdasarkan operator.

### 13.1 GIN Index untuk JSONB Containment

```sql
CREATE INDEX idx_cases_metadata_gin
ON cases
USING gin (metadata);
```

Mendukung query seperti:

```sql
SELECT *
FROM cases
WHERE metadata @> '{"riskCategory": "HIGH"}'::jsonb;
```

Juga bisa membantu key existence tergantung operator class.

### 13.2 `jsonb_path_ops`

```sql
CREATE INDEX idx_cases_metadata_path_gin
ON cases
USING gin (metadata jsonb_path_ops);
```

Secara umum, `jsonb_path_ops` lebih spesifik untuk containment dan bisa lebih compact untuk beberapa workload. Tetapi operator yang didukung lebih terbatas dibanding default `jsonb_ops`.

Decision point:

```text
Butuh fleksibilitas operator luas  -> default jsonb_ops
Butuh containment-focused workload -> jsonb_path_ops bisa dipertimbangkan
```

Jangan pilih operator class tanpa melihat query nyata.

### 13.3 Expression Index untuk Field Tertentu

Jika query sering seperti:

```sql
SELECT *
FROM cases
WHERE metadata->>'riskCategory' = 'HIGH';
```

Buat expression index:

```sql
CREATE INDEX idx_cases_risk_category
ON cases ((metadata->>'riskCategory'));
```

Untuk numeric comparison:

```sql
CREATE INDEX idx_cases_risk_score
ON cases (((metadata #>> '{risk,score}')::integer));
```

Query harus match expression:

```sql
SELECT *
FROM cases
WHERE (metadata #>> '{risk,score}')::integer >= 80;
```

Tetapi perhatikan:

1. cast error jika nilai tidak numeric,
2. missing key menghasilkan null,
3. data quality harus dikontrol,
4. expression index menyembunyikan domain field dalam JSONB.

Jika field sangat penting, lebih baik kolom:

```sql
risk_score integer
```

### 13.4 Partial Index pada JSONB

Contoh:

```sql
CREATE INDEX idx_cases_high_risk_open
ON cases (created_at DESC)
WHERE status = 'OPEN'
  AND metadata @> '{"riskCategory": "HIGH"}'::jsonb;
```

Berguna bila query sangat spesifik:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
  AND metadata @> '{"riskCategory": "HIGH"}'::jsonb
ORDER BY created_at DESC
LIMIT 50;
```

Tetapi partial index harus sesuai predicate. Jika query berbeda sedikit, index mungkin tidak dipakai.

### 13.5 Generated Column untuk JSONB Field Penting

Jika field berasal dari JSONB tetapi sering dipakai, generated column bisa menjadi jembatan.

```sql
ALTER TABLE cases
ADD COLUMN risk_category text
GENERATED ALWAYS AS (metadata->>'riskCategory') STORED;

CREATE INDEX idx_cases_risk_category_generated
ON cases (risk_category);
```

Manfaat:

1. query lebih sederhana,
2. index normal,
3. field tetap derived dari JSONB,
4. aplikasi bisa membaca kolom eksplisit,
5. statistik planner lebih baik dibanding expression tertentu dalam beberapa kasus.

Tetapi jika field menjadi domain utama, pertimbangkan menjadikannya kolom normal yang ditulis eksplisit.

---

## 14. JSONB dan Planner Statistics

Planner PostgreSQL punya statistik yang kuat untuk kolom normal. Untuk JSONB, terutama ekspresi nested, kualitas estimasi bisa lebih terbatas.

Contoh:

```sql
SELECT *
FROM cases
WHERE metadata->>'riskCategory' = 'HIGH';
```

Tanpa expression index/statistik memadai, planner mungkin sulit memperkirakan berapa banyak row yang cocok.

Dampak:

1. join order buruk,
2. sequential scan tidak terduga,
3. nested loop explosion,
4. index tidak dipakai,
5. query lambat pada tenant tertentu,
6. prepared statement generic plan buruk.

Solusi yang mungkin:

1. promote field ke kolom,
2. expression index,
3. generated column,
4. extended statistics pada kolom/generator yang relevan,
5. query shape lebih eksplisit,
6. analyze yang cukup,
7. partial index untuk workload tertentu.

Rule:

```text
Semakin penting field untuk planner, semakin besar alasan field itu menjadi kolom eksplisit.
```

---

## 15. JSONB dan Constraint

JSONB bisa divalidasi sebagian dengan `CHECK` constraint.

Contoh memastikan key ada:

```sql
ALTER TABLE cases
ADD CONSTRAINT chk_metadata_has_source_system
CHECK (metadata ? 'sourceSystem');
```

Memastikan nilai tertentu:

```sql
ALTER TABLE cases
ADD CONSTRAINT chk_metadata_risk_category_valid
CHECK (
    metadata->>'riskCategory' IS NULL
    OR metadata->>'riskCategory' IN ('LOW', 'MEDIUM', 'HIGH')
);
```

Memastikan numeric:

```sql
ALTER TABLE cases
ADD CONSTRAINT chk_metadata_risk_score_numeric
CHECK (
    metadata #>> '{risk,score}' IS NULL
    OR (metadata #>> '{risk,score}') ~ '^[0-9]+$'
);
```

Namun constraint JSONB kompleks bisa menjadi:

1. sulit dibaca,
2. sulit dimigration,
3. sulit ditest,
4. rentan cast error,
5. tanda bahwa field seharusnya kolom.

Jika constraint JSONB mulai panjang, itu sinyal desain:

```text
Data ini mungkin bukan lagi metadata.
Data ini sudah menjadi domain model.
```

---

## 16. JSONB dan Type Safety di Java

Di Java, JSONB biasanya dimapping sebagai:

1. `String`,
2. `JsonNode`,
3. `Map<String, Object>`,
4. custom POJO,
5. Hibernate custom type,
6. jOOQ generated binding.

### 16.1 Mapping sebagai String

Paling sederhana:

```java
private String metadata;
```

Kelebihan:

1. tidak perlu mapping kompleks,
2. mudah simpan raw payload.

Kekurangan:

1. type safety rendah,
2. validasi manual,
3. manipulasi sulit,
4. bug runtime lebih mudah.

### 16.2 Mapping sebagai `JsonNode`

Dengan Jackson:

```java
private JsonNode metadata;
```

Kelebihan:

1. fleksibel,
2. cocok untuk semi-structured data,
3. mudah membaca field optional.

Kekurangan:

1. tidak ada compile-time schema,
2. field typo tidak terdeteksi,
3. business invariant mudah tersembunyi.

### 16.3 Mapping sebagai POJO

```java
public record CaseMetadata(
    String riskCategory,
    List<String> sourceTags,
    String importBatchId
) {}
```

Kelebihan:

1. lebih type-safe,
2. dokumentasi lebih jelas,
3. validasi lebih mudah,
4. test lebih baik.

Kekurangan:

1. perlu versioning,
2. backward compatibility,
3. schema JSON tetap implicit di Java.

### 16.4 Rule untuk Java

```text
Jika JSONB field punya struktur yang cukup stabil, buat type Java eksplisit.
Jika struktur benar-benar bebas, gunakan JsonNode tetapi batasi area aksesnya.
```

Jangan biarkan seluruh codebase melakukan:

```java
metadata.get("riskCategory").asText()
```

di banyak tempat. Itu menciptakan schema tersembunyi yang tersebar.

Lebih baik buat boundary:

```java
public final class CaseMetadataReader {
    public Optional<String> riskCategory(JsonNode metadata) { ... }
    public Optional<Integer> riskScore(JsonNode metadata) { ... }
    public List<String> sourceTags(JsonNode metadata) { ... }
}
```

Atau:

```java
public record CaseMetadata(
    Optional<String> riskCategory,
    Optional<Integer> riskScore,
    List<String> sourceTags
) {}
```

---

## 17. JSONB Schema Versioning

Karena JSONB bisa berubah bentuk, versioning sering diperlukan.

Contoh:

```json
{
  "schemaVersion": 2,
  "risk": {
    "score": 92,
    "category": "HIGH"
  }
}
```

Manfaat:

1. aplikasi tahu cara membaca payload lama,
2. migration bisa bertahap,
3. audit interpretasi lebih aman,
4. test compatibility lebih jelas.

### 17.1 Dual-read Pattern

Saat migrasi JSONB dari v1 ke v2:

v1:

```json
{
  "riskScore": 92,
  "riskCategory": "HIGH"
}
```

v2:

```json
{
  "risk": {
    "score": 92,
    "category": "HIGH"
  }
}
```

Java reader:

```java
Integer riskScore(JsonNode metadata) {
    JsonNode risk = metadata.path("risk").path("score");
    if (risk.isNumber()) {
        return risk.asInt();
    }

    JsonNode legacy = metadata.path("riskScore");
    if (legacy.isNumber()) {
        return legacy.asInt();
    }

    return null;
}
```

Lifecycle:

```text
1. deploy reader that supports v1 and v2
2. deploy writer that writes v2
3. backfill old rows
4. verify no v1 remains
5. remove v1 reader support
```

Ini sama seperti expand-contract migration di relational schema. JSONB tidak membebaskan dari migration discipline.

### 17.2 Backfill JSONB

Contoh:

```sql
UPDATE cases
SET metadata =
    jsonb_set(
        metadata - 'riskScore' - 'riskCategory',
        '{risk}',
        jsonb_build_object(
            'score', (metadata->>'riskScore')::integer,
            'category', metadata->>'riskCategory'
        ),
        true
    )
WHERE metadata ? 'riskScore'
   OR metadata ? 'riskCategory';
```

Untuk tabel besar, jangan lakukan satu transaksi raksasa. Gunakan batch:

```sql
WITH candidate AS (
    SELECT id
    FROM cases
    WHERE metadata ? 'riskScore'
    ORDER BY id
    LIMIT 1000
)
UPDATE cases c
SET metadata = jsonb_set(
    c.metadata - 'riskScore',
    '{risk,score}',
    to_jsonb((c.metadata->>'riskScore')::integer),
    true
)
FROM candidate
WHERE c.id = candidate.id;
```

Pertimbangkan:

1. lock duration,
2. WAL volume,
3. replication lag,
4. autovacuum pressure,
5. retry strategy,
6. observability progress.

---

## 18. JSONB dan Auditability

Dalam sistem regulatory/case management, JSONB sering dipakai untuk context. Ini berguna, tetapi jangan sampai audit meaning menjadi kabur.

Contoh audit event sehat:

```sql
CREATE TABLE case_audit_events (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES cases(id),
    event_type text NOT NULL,
    actor_id uuid,
    occurred_at timestamptz NOT NULL,
    old_status text,
    new_status text,
    reason_code text,
    context jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Mengapa `old_status`, `new_status`, dan `reason_code` tidak ditaruh di context saja?

Karena itu field penting untuk:

1. audit query,
2. reporting,
3. legal defensibility,
4. invariant review,
5. investigation,
6. SLA reconstruction,
7. incident diagnosis.

`context` tetap berguna untuk:

1. request ID,
2. IP address,
3. source system detail,
4. UI screen identifier,
5. additional notes,
6. raw external reason payload.

Rule:

```text
Formal audit facts -> columns.
Supplementary evidence/context -> JSONB.
```

---

## 19. JSONB dan Event/outbox Pattern

Outbox table sering menyimpan payload JSONB:

```sql
CREATE TABLE outbox_events (
    id uuid PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    published_at timestamptz,
    payload jsonb NOT NULL,
    headers jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_outbox_unpublished
ON outbox_events (occurred_at)
WHERE published_at IS NULL;
```

Ini contoh JSONB yang kuat:

1. event payload berbeda per event type,
2. payload harus dikirim ke message broker,
3. query utama berdasarkan publish status dan waktu,
4. event metadata utama tetap kolom,
5. payload disimpan untuk replay/debugging.

Jangan query outbox berdasarkan field payload terus-menerus jika tidak perlu. Jika perlu, mungkin field itu seharusnya header/kolom.

---

## 20. JSONB untuk Configuration dan Rule Snapshot

Kadang sistem perlu menyimpan konfigurasi/rule yang digunakan saat decision dibuat.

Contoh:

```sql
CREATE TABLE case_decisions (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES cases(id),
    decision_type text NOT NULL,
    outcome text NOT NULL,
    decided_at timestamptz NOT NULL,
    decided_by uuid NOT NULL,
    rule_version text NOT NULL,
    rule_snapshot jsonb NOT NULL
);
```

`rule_snapshot` berguna agar keputusan masa lalu bisa dijelaskan meskipun rule saat ini berubah.

Namun `outcome`, `decision_type`, `decided_at`, `decided_by`, dan `rule_version` tetap kolom.

Pattern:

```text
Column = searchable formal decision fact
JSONB  = evidence snapshot used to explain decision
```

---

## 21. JSONB dan Multi-tenant Workload

Multi-tenant systems sering punya tenant-specific metadata.

Contoh:

```sql
CREATE TABLE tenant_cases (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    case_number text NOT NULL,
    status text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, case_number)
);
```

Masalah muncul jika tiap tenant memakai metadata berbeda dan query berbeda:

Tenant A:

```sql
WHERE metadata->>'region' = 'APAC'
```

Tenant B:

```sql
WHERE metadata->>'productCode' = 'LOAN'
```

Tenant C:

```sql
WHERE metadata->>'riskCategory' = 'HIGH'
```

Jika semua diberi expression index, index bisa meledak.

Strategi:

1. core fields lintas tenant menjadi kolom,
2. tenant-specific rare filters tetap JSONB,
3. untuk tenant besar/hot, buat partial index spesifik tenant bila benar-benar perlu,
4. observasi query nyata sebelum membuat index,
5. pertimbangkan generated column untuk field yang menjadi standar lintas tenant,
6. governance metadata per tenant.

Contoh partial index tenant-specific:

```sql
CREATE INDEX idx_cases_tenant_a_region
ON tenant_cases ((metadata->>'region'))
WHERE tenant_id = '00000000-0000-0000-0000-00000000000a';
```

Tetapi ini meningkatkan complexity. Jangan jadikan default.

---

## 22. JSONB dan Reporting

JSONB buruk jika menjadi sumber utama laporan reguler yang luas.

Contoh laporan:

```text
Jumlah case per risk category, region, product type, decision outcome, per bulan.
```

Jika semua field ada di JSONB:

```sql
SELECT
    metadata->>'riskCategory',
    metadata->>'region',
    metadata->>'productType',
    count(*)
FROM cases
GROUP BY 1, 2, 3;
```

Bisa berjalan, tetapi masalah:

1. cast/type inconsistency,
2. missing key,
3. typo value,
4. planner statistics kurang baik,
5. index tidak selalu membantu aggregation,
6. reporting schema tidak jelas.

Solusi:

1. kolom eksplisit untuk reporting dimensions penting,
2. generated columns,
3. materialized view,
4. ETL ke warehouse,
5. projection table.

Contoh projection:

```sql
CREATE TABLE case_reporting_projection (
    case_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    risk_category text,
    region text,
    product_type text,
    decision_outcome text,
    case_month date NOT NULL
);
```

Rule:

```text
JSONB boleh menjadi sumber tambahan.
Laporan utama butuh kontrak data yang eksplisit.
```

---

## 23. Performance Cost JSONB

JSONB memberi fleksibilitas, tetapi tidak gratis.

Biaya yang perlu dipahami:

### 23.1 Storage Size

JSONB menyimpan struktur decomposed. Untuk payload kecil, overhead bisa relatif terasa. Untuk payload besar, TOAST bisa terlibat.

### 23.2 CPU Cost

Query field JSONB membutuhkan ekstraksi:

```sql
metadata->>'riskCategory'
```

Jika dilakukan pada banyak row, CPU cost bisa signifikan.

### 23.3 Index Size

GIN index pada JSONB bisa besar.

```sql
CREATE INDEX idx_metadata_gin ON cases USING gin (metadata);
```

Index besar berarti:

1. disk lebih besar,
2. cache pressure,
3. write amplification,
4. vacuum/index cleanup cost,
5. backup size lebih besar,
6. replication WAL lebih besar.

### 23.4 Update Cost

Update JSONB besar bisa menghasilkan banyak WAL dan dead tuple.

### 23.5 Planner Complexity

Query JSONB kompleks bisa menyulitkan cardinality estimation.

---

## 24. Anti-pattern: Universal Metadata GIN Index

Sering muncul desain:

```sql
CREATE INDEX idx_everything_metadata_gin
ON every_table
USING gin (metadata);
```

Tanpa bukti workload, ini bisa menjadi anti-pattern.

Masalah:

1. index besar,
2. write lambat,
3. vacuum lebih berat,
4. jarang dipakai,
5. query tetap tidak optimal karena predicate/order by lain,
6. tidak menyelesaikan masalah field penting.

Lebih baik:

1. lihat query aktual,
2. gunakan `pg_stat_statements`,
3. baca `EXPLAIN (ANALYZE, BUFFERS)`,
4. buat expression/partial index spesifik,
5. promote field penting ke kolom,
6. hapus index tidak berguna.

---

## 25. Anti-pattern: JSONB sebagai Escape Hatch untuk Poor Domain Understanding

Kalimat yang harus dicurigai:

```text
Kita belum tahu modelnya, taruh JSONB dulu saja.
```

Ini kadang benar untuk eksplorasi. Tetapi dalam sistem produksi, harus ada exit strategy.

Gunakan JSONB untuk fase awal jika:

1. field masih benar-benar unstable,
2. query belum jelas,
3. domain belum matang,
4. risiko kecil,
5. ada observability,
6. ada rencana promosi field ke kolom.

Tetapi jangan biarkan “sementara” menjadi permanen tanpa governance.

Exit strategy:

1. identifikasi field yang sering dipakai,
2. tambahkan kolom baru,
3. backfill dari JSONB,
4. dual-write/derive,
5. tambah constraint/index,
6. update application read path,
7. hapus penggunaan JSONB lama jika perlu.

---

## 26. Migration dari JSONB ke Kolom

Misalnya `riskCategory` awalnya ada di metadata:

```json
{
  "riskCategory": "HIGH"
}
```

Lalu menjadi field penting.

### 26.1 Add Column Nullable

```sql
ALTER TABLE cases
ADD COLUMN risk_category text;
```

### 26.2 Backfill Bertahap

```sql
WITH candidate AS (
    SELECT id
    FROM cases
    WHERE risk_category IS NULL
      AND metadata ? 'riskCategory'
    ORDER BY id
    LIMIT 1000
)
UPDATE cases c
SET risk_category = c.metadata->>'riskCategory'
FROM candidate
WHERE c.id = candidate.id;
```

Jalankan batch sampai selesai.

### 26.3 Add Constraint Not Valid

```sql
ALTER TABLE cases
ADD CONSTRAINT chk_cases_risk_category_valid
CHECK (risk_category IN ('LOW', 'MEDIUM', 'HIGH'))
NOT VALID;
```

### 26.4 Validate Constraint

```sql
ALTER TABLE cases
VALIDATE CONSTRAINT chk_cases_risk_category_valid;
```

### 26.5 Add Index Concurrently

```sql
CREATE INDEX CONCURRENTLY idx_cases_risk_category
ON cases (risk_category);
```

### 26.6 Update Application

Application mulai menulis `risk_category` sebagai kolom.

### 26.7 Optional Cleanup

Jika metadata lama tidak perlu:

```sql
UPDATE cases
SET metadata = metadata - 'riskCategory'
WHERE metadata ? 'riskCategory';
```

Atau biarkan untuk audit backward compatibility jika perlu.

---

## 27. Migration dari Kolom ke JSONB

Kadang field menjadi jarang dan tidak lagi core. Tetapi ini lebih jarang dan harus hati-hati.

Contoh:

```sql
ALTER TABLE cases
ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE cases
SET metadata = metadata || jsonb_build_object('legacyCode', legacy_code)
WHERE legacy_code IS NOT NULL;
```

Lalu application membaca dari metadata.

Sebelum drop column, pastikan:

1. tidak ada query/reporting bergantung pada kolom,
2. tidak ada FK/constraint penting,
3. historical interpretation aman,
4. backfill sukses,
5. rollback plan ada.

Jangan menurunkan kolom penting ke JSONB hanya untuk “merapikan table”.

---

## 28. Designing JSONB Contract

Jika JSONB dipakai, tetap butuh contract.

Dokumentasikan:

1. nama key,
2. tipe value,
3. optional/required,
4. allowed values,
5. meaning,
6. owner,
7. version,
8. migration history,
9. indexing,
10. query usage.

Contoh kontrak metadata:

```text
cases.metadata

schemaVersion: integer, required
sourceSystem: string, optional
sourceTags: array<string>, optional
riskCategory: LOW | MEDIUM | HIGH, optional, deprecated after v3; use cases.risk_category
importBatchId: string, optional
```

Tanpa kontrak, JSONB menjadi “tempat sampah data”.

---

## 29. Testing JSONB-heavy Code

Testing harus mencakup:

### 29.1 Missing Key

```json
{}
```

### 29.2 Null Value

```json
{"riskCategory": null}
```

### 29.3 Wrong Type

```json
{"riskScore": "HIGH"}
```

### 29.4 Legacy Shape

```json
{"riskScore": 90}
```

### 29.5 New Shape

```json
{"risk": {"score": 90}}
```

### 29.6 Extra Unknown Keys

```json
{"unexpectedField": "value"}
```

### 29.7 Large Payload

Test payload besar untuk melihat:

1. latency,
2. serialization cost,
3. DB write cost,
4. WAL growth,
5. memory usage,
6. API response size.

### 29.8 Index-backed Query

Test query dengan `EXPLAIN` untuk memastikan index dipakai sesuai harapan.

---

## 30. Observability JSONB

Pertanyaan yang harus bisa dijawab:

1. Query apa yang sering mengakses JSONB?
2. Index JSONB mana yang dipakai?
3. Index JSONB mana yang tidak dipakai?
4. Berapa ukuran JSONB rata-rata?
5. Payload mana yang terlalu besar?
6. Berapa banyak row punya key tertentu?
7. Berapa banyak row punya struktur lama?
8. Apakah JSONB update menyebabkan bloat?
9. Apakah GIN index terlalu besar?
10. Apakah replication lag meningkat setelah update JSONB massal?

Contoh inspeksi ukuran:

```sql
SELECT
    avg(pg_column_size(metadata)) AS avg_metadata_size,
    max(pg_column_size(metadata)) AS max_metadata_size
FROM cases;
```

Distribusi key:

```sql
SELECT key, count(*)
FROM cases,
LATERAL jsonb_object_keys(metadata) AS key
GROUP BY key
ORDER BY count(*) DESC;
```

Cari row dengan metadata besar:

```sql
SELECT id, pg_column_size(metadata) AS metadata_size
FROM cases
ORDER BY pg_column_size(metadata) DESC
LIMIT 20;
```

Index usage:

```sql
SELECT
    schemaname,
    relname,
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE relname = 'cases'
ORDER BY idx_scan ASC;
```

---

## 31. Security dan JSONB

JSONB bisa menyimpan sensitive data tanpa terlihat jelas dari schema.

Contoh buruk:

```json
{
  "nationalId": "...",
  "passportNumber": "...",
  "rawCredential": "...",
  "secretToken": "..."
}
```

Masalah:

1. data classification sulit,
2. masking sulit,
3. access control sulit,
4. audit sulit,
5. accidental exposure via API lebih mudah,
6. backup berisi sensitive fields tersembunyi,
7. logs bisa bocor jika payload dicetak.

Rule:

```text
Sensitive data sebaiknya eksplisit, diklasifikasi, dibatasi aksesnya, dan dienkripsi/masked sesuai kebutuhan.
```

Jika tetap harus di JSONB:

1. validasi key sensitive,
2. redact sebelum logging,
3. batasi API serialization,
4. dokumentasikan data classification,
5. pertimbangkan encryption boundary,
6. jangan expose metadata mentah ke frontend.

---

## 32. API Design: Jangan Bocorkan JSONB Internal Sembarangan

Banyak aplikasi menyimpan JSONB lalu mengembalikannya mentah:

```json
{
  "id": "...",
  "caseNumber": "CASE-1",
  "metadata": {
    "internalScore": 92,
    "debugReason": "...",
    "sourceSystemRawCode": "..."
  }
}
```

Risiko:

1. frontend menjadi bergantung pada schema internal,
2. field internal bocor,
3. perubahan metadata menjadi breaking API change,
4. authorization field-level terlewat,
5. regulatory data bisa terekspos.

Lebih baik buat DTO eksplisit:

```java
public record CaseResponse(
    UUID id,
    String caseNumber,
    String status,
    String riskCategory,
    List<String> displayTags
) {}
```

Metadata internal dibaca dan dipetakan secara sadar.

Rule:

```text
JSONB database contract tidak otomatis menjadi public API contract.
```

---

## 33. JSONB dan Optimistic Locking

Jika Java entity punya JSONB field dan memakai ORM, perubahan kecil pada metadata bisa menyebabkan update besar.

Contoh entity:

```java
@Entity
class CaseEntity {
    @Id UUID id;
    String status;
    JsonNode metadata;
    Long version;
}
```

Jika dua request mengubah bagian berbeda dari metadata:

Request A:

```json
{"riskCategory": "HIGH"}
```

Request B:

```json
{"sourceTags": ["AML"]}
```

Jika keduanya membaca metadata lama dan menulis ulang seluruh JSONB, salah satu perubahan bisa hilang tanpa locking/versioning yang benar.

Strategi:

1. optimistic locking dengan version column,
2. partial update SQL `jsonb_set`,
3. merge di application dengan conflict detection,
4. pecah field high-contention menjadi kolom/tabel,
5. hindari blind overwrite metadata.

Contoh safer update:

```sql
UPDATE cases
SET metadata = jsonb_set(metadata, '{riskCategory}', to_jsonb($2::text), true),
    version = version + 1
WHERE id = $1
  AND version = $3;
```

Jika affected rows = 0, retry atau return conflict.

---

## 34. JSONB dan Locking

Update JSONB tetap row-level update. Jika banyak worker mengupdate row yang sama pada path berbeda, tetap konflik di row yang sama.

Contoh:

```text
Worker A update metadata.risk.score
Worker B update metadata.assignment.note
Worker C update metadata.ui.lastViewedAt
```

Semua update row `cases` yang sama. Ini bisa menyebabkan:

1. lock wait,
2. lost update jika overwrite,
3. high dead tuple,
4. version conflict,
5. poor throughput.

Jika field punya concurrency berbeda, pisahkan storage:

```sql
cases                  -> core state
case_risk_assessment   -> risk data
case_assignment_notes  -> assignment notes
case_view_state        -> UI/high-churn state
```

Rule:

```text
Jika subdocument punya concurrency lifecycle berbeda, jangan paksa berada di satu JSONB column.
```

---

## 35. JSONB dan TOAST

JSONB besar bisa disimpan menggunakan TOAST, yaitu mekanisme PostgreSQL untuk menyimpan value besar di luar tuple utama.

Konsekuensi praktis:

1. row utama mungkin hanya menyimpan pointer ke TOAST value,
2. membaca field tertentu tetap bisa memerlukan de-toast tergantung operasi,
3. update value besar bisa mahal,
4. payload besar dapat meningkatkan IO,
5. replication/WAL cost bisa meningkat.

Prinsip desain:

```text
Jangan campur payload besar jarang dibaca dengan row OLTP panas yang sering diakses.
```

Alternatif:

```sql
CREATE TABLE case_payloads (
    case_id uuid PRIMARY KEY REFERENCES cases(id),
    payload jsonb NOT NULL,
    stored_at timestamptz NOT NULL
);
```

Row `cases` tetap kecil dan cepat untuk query operasional.

---

## 36. JSONB dan Generated Columns

Generated column adalah jembatan penting.

Contoh:

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    risk_category text GENERATED ALWAYS AS (metadata->>'riskCategory') STORED
);
```

Manfaat:

1. field dari JSONB terlihat sebagai kolom,
2. bisa di-index lebih mudah,
3. query lebih readable,
4. mengurangi duplikasi write dari application,
5. cocok untuk transitional design.

Index:

```sql
CREATE INDEX idx_cases_risk_category
ON cases (risk_category);
```

Tetapi generated column bukan magic. Jika field menjadi business-critical, kolom normal dengan write explicit dan constraint mungkin lebih jelas.

---

## 37. JSONB dan Partial Update API

Saat API ingin update metadata, jangan desain endpoint terlalu bebas:

```http
PATCH /cases/{id}/metadata
```

Dengan body arbitrary:

```json
{
  "anything": "anything"
}
```

Risiko:

1. user bisa menulis key internal,
2. invariant rusak,
3. schema menjadi liar,
4. audit sulit,
5. backward compatibility kacau.

Lebih baik buat command eksplisit:

```http
POST /cases/{id}/risk-assessment
POST /cases/{id}/source-tags
POST /cases/{id}/external-context
```

Atau batasi patch path yang diizinkan:

```json
{
  "riskCategory": "HIGH",
  "sourceTags": ["AML", "KYC"]
}
```

Dengan validation kuat di application.

Rule:

```text
Fleksibilitas storage tidak berarti fleksibilitas write API tanpa batas.
```

---

## 38. Decision Matrix: Column vs JSONB vs Separate Table

Gunakan matrix ini.

| Pertanyaan | Kolom | JSONB | Separate Table |
|---|---:|---:|---:|
| Field sering di-query | Kuat | Kadang | Kuat |
| Perlu FK | Kuat | Lemah | Kuat |
| Perlu unique constraint | Kuat | Lemah/sedang | Kuat |
| Struktur variatif | Sedang | Kuat | Kuat untuk subtype besar |
| High update frequency | Kuat jika kecil | Lemah jika payload besar | Kuat |
| Payload besar jarang dibaca | Lemah | Sedang | Kuat |
| Audit context variatif | Sedang | Kuat | Sedang |
| Many-to-many relation | Lemah | Buruk | Kuat |
| Reporting dimension | Kuat | Lemah/sedang | Kuat/projection |
| External raw payload | Sedang | Kuat | Kuat bila dipisah |
| Domain invariant penting | Kuat | Lemah/sedang | Kuat |

Simplifikasi:

```text
Kolom          -> fakta inti, invariant, query utama
JSONB          -> metadata, context, payload variatif
Separate table -> lifecycle/concurrency/relation tersendiri
```

---

## 39. Case Study: Regulatory Case Management

### 39.1 Desain Awal yang Buruk

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    data jsonb NOT NULL
);
```

Isi:

```json
{
  "tenantId": "...",
  "caseNumber": "CASE-2026-001",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "assignedOfficerId": "...",
  "subjectId": "...",
  "risk": {
    "score": 92,
    "category": "HIGH"
  },
  "sla": {
    "dueAt": "2026-06-25T00:00:00Z"
  },
  "source": {
    "system": "AML_GATEWAY",
    "reference": "EXT-123"
  }
}
```

Masalah:

1. tenant boundary tersembunyi,
2. case number uniqueness sulit,
3. status transition tidak jelas,
4. assignment tidak FK,
5. subject tidak FK,
6. SLA query buruk,
7. risk reporting buruk,
8. audit defensibility rendah.

### 39.2 Desain Hybrid yang Lebih Baik

```sql
CREATE TABLE cases (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_number text NOT NULL,
    status text NOT NULL,
    priority text NOT NULL,
    assigned_officer_id uuid,
    subject_id uuid NOT NULL,
    risk_category text,
    risk_score integer,
    sla_due_at timestamptz,
    source_system text NOT NULL,
    external_reference text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (tenant_id, case_number),
    UNIQUE (source_system, external_reference),
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CHECK (risk_category IS NULL OR risk_category IN ('LOW', 'MEDIUM', 'HIGH'))
);
```

Index operasional:

```sql
CREATE INDEX idx_cases_work_queue
ON cases (tenant_id, status, priority, sla_due_at)
WHERE status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED');

CREATE INDEX idx_cases_subject
ON cases (tenant_id, subject_id);

CREATE INDEX idx_cases_external_ref
ON cases (source_system, external_reference);
```

Metadata tetap bisa menyimpan:

```json
{
  "sourceTags": ["KYC", "SANCTION"],
  "importBatchId": "batch-001",
  "rawRiskSignals": {
    "pep": true,
    "watchlistHits": 3
  },
  "uiHints": {
    "highlight": true
  }
}
```

### 39.3 Mengapa Lebih Kuat?

Karena:

1. query utama memakai kolom,
2. invariant penting bisa constraint,
3. audit/reporting lebih jelas,
4. Java model lebih eksplisit,
5. JSONB tetap memberi fleksibilitas,
6. performance lebih bisa diprediksi,
7. migration lebih mudah dikontrol.

---

## 40. Case Study: External Integration Inbox

### 40.1 Requirements

Sistem menerima event dari banyak source:

1. AML gateway,
2. complaint portal,
3. licensing system,
4. market surveillance feed.

Payload berbeda-beda. Tetapi semua harus:

1. idempotent,
2. auditable,
3. retryable,
4. searchable by source reference,
5. processable by worker.

### 40.2 Design

```sql
CREATE TABLE integration_inbox (
    id uuid PRIMARY KEY,
    source_system text NOT NULL,
    external_message_id text NOT NULL,
    message_type text NOT NULL,
    received_at timestamptz NOT NULL,
    processed_at timestamptz,
    processing_status text NOT NULL,
    retry_count integer NOT NULL DEFAULT 0,
    last_error text,
    payload jsonb NOT NULL,
    headers jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (source_system, external_message_id)
);

CREATE INDEX idx_inbox_pending
ON integration_inbox (received_at)
WHERE processing_status = 'PENDING';

CREATE INDEX idx_inbox_failed
ON integration_inbox (received_at)
WHERE processing_status = 'FAILED';
```

### 40.3 Why JSONB Works Here

Karena:

1. payload external variatif,
2. payload lengkap perlu disimpan,
3. routing utama sudah kolom,
4. idempotency sudah constraint,
5. retry status sudah kolom,
6. worker tidak perlu query arbitrary nested field untuk semua operasi.

---

## 41. Case Study: Bad Metadata Growth Incident

### 41.1 Symptoms

Produksi mengalami:

1. query case list makin lambat,
2. disk usage naik cepat,
3. replication lag meningkat,
4. autovacuum sering berjalan,
5. update case status lambat,
6. WAL archive membengkak.

### 41.2 Discovery

Ternyata `cases.metadata` tumbuh dari rata-rata 2KB menjadi 250KB karena tim menyimpan raw API response setiap update:

```json
{
  "lastProviderResponse": { ... huge payload ... },
  "previousProviderResponses": [ ... many huge payloads ... ]
}
```

Setiap update status case ikut menulis row dengan JSONB besar.

### 41.3 Root Cause

Kesalahan modelling:

1. payload historis besar dicampur dengan row OLTP panas,
2. metadata dipakai sebagai archive,
3. no size monitoring,
4. no boundary antara case state dan integration evidence,
5. update kecil menyebabkan WAL besar.

### 41.4 Remediation

Pisahkan payload:

```sql
CREATE TABLE case_external_evidence (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES cases(id),
    provider text NOT NULL,
    received_at timestamptz NOT NULL,
    payload jsonb NOT NULL
);
```

Update aplikasi:

1. simpan raw response ke `case_external_evidence`,
2. metadata hanya menyimpan pointer/ringkasan,
3. tambahkan size monitoring,
4. backfill/migrate payload lama,
5. vacuum/repack sesuai kebutuhan,
6. review WAL/replication impact.

Lesson:

```text
JSONB besar yang sering berubah adalah sumber bloat dan WAL amplification.
```

---

## 42. Practical SQL Examples

### 42.1 Insert JSONB

```sql
INSERT INTO cases (
    id,
    tenant_id,
    case_number,
    status,
    priority,
    created_at,
    updated_at,
    metadata
)
VALUES (
    gen_random_uuid(),
    $1,
    $2,
    'OPEN',
    'HIGH',
    now(),
    now(),
    $3::jsonb
);
```

### 42.2 Query by JSONB Key

```sql
SELECT id, case_number, status
FROM cases
WHERE metadata->>'sourceSystem' = 'AML_GATEWAY';
```

### 42.3 Query by Containment

```sql
SELECT id, case_number, status
FROM cases
WHERE metadata @> '{"sourceTags": ["KYC"]}'::jsonb;
```

### 42.4 Update JSONB Key

```sql
UPDATE cases
SET metadata = jsonb_set(metadata, '{review,comment}', to_jsonb($2::text), true),
    updated_at = now()
WHERE id = $1;
```

### 42.5 Append to JSONB Array

```sql
UPDATE cases
SET metadata = jsonb_set(
    metadata,
    '{sourceTags}',
    COALESCE(metadata->'sourceTags', '[]'::jsonb) || to_jsonb($2::text),
    true
)
WHERE id = $1;
```

Be careful: this can create duplicates. For important tags, a relational table may be better.

### 42.6 Remove Key

```sql
UPDATE cases
SET metadata = metadata - 'deprecatedField'
WHERE metadata ? 'deprecatedField';
```

### 42.7 Extract as Typed Value

```sql
SELECT
    id,
    (metadata #>> '{risk,score}')::integer AS risk_score
FROM cases
WHERE metadata #>> '{risk,score}' IS NOT NULL;
```

Careful with invalid type. Use validation if needed.

---

## 43. Java/JDBC Example

### 43.1 Insert JSONB with JDBC

```java
String sql = """
    INSERT INTO cases (
        id,
        tenant_id,
        case_number,
        status,
        priority,
        created_at,
        updated_at,
        metadata
    )
    VALUES (?, ?, ?, ?, ?, now(), now(), ?::jsonb)
    """;

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setObject(1, caseId);
    ps.setObject(2, tenantId);
    ps.setString(3, caseNumber);
    ps.setString(4, "OPEN");
    ps.setString(5, "HIGH");
    ps.setString(6, objectMapper.writeValueAsString(metadata));
    ps.executeUpdate();
}
```

### 43.2 Update JSONB Path with JDBC

```java
String sql = """
    UPDATE cases
    SET metadata = jsonb_set(metadata, ?::text[], to_jsonb(?::text), true),
        updated_at = now()
    WHERE id = ?
    """;

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    Array path = connection.createArrayOf("text", new String[] {"review", "comment"});
    ps.setArray(1, path);
    ps.setString(2, comment);
    ps.setObject(3, caseId);
    ps.executeUpdate();
}
```

### 43.3 Safer Boundary Object

```java
public record CaseMetadata(
    Integer schemaVersion,
    String sourceSystem,
    List<String> sourceTags,
    Risk risk
) {
    public record Risk(Integer score, String category) {}
}
```

Reader/writer terpusat:

```java
public final class CaseMetadataCodec {
    private final ObjectMapper objectMapper;

    public CaseMetadataCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public CaseMetadata decode(String json) throws IOException {
        return objectMapper.readValue(json, CaseMetadata.class);
    }

    public String encode(CaseMetadata metadata) throws JsonProcessingException {
        return objectMapper.writeValueAsString(metadata);
    }
}
```

---

## 44. Hibernate Considerations

Hibernate dapat memakai custom type atau library tambahan untuk JSONB mapping. Tetapi konsep yang harus dijaga:

1. Hindari accidental full-row update.
2. Pahami dirty checking terhadap JSON object.
3. Hindari lazy/eager payload besar tanpa sadar.
4. Jangan expose metadata raw ke entity business logic sembarangan.
5. Pakai native query/jOOQ untuk operasi JSONB kompleks bila perlu.
6. Gunakan optimistic locking untuk mencegah lost update.
7. Pertimbangkan memisahkan JSONB besar ke entity/table lain.

Anti-pattern entity:

```java
@Entity
class CaseEntity {
    @Id UUID id;
    JsonNode metadata;

    public void setAnyMetadata(String key, Object value) {
        // arbitrary mutation everywhere
    }
}
```

Lebih baik:

```java
public void updateRiskMetadata(RiskMetadataUpdate command) {
    // validate allowed fields
    // preserve schema version
    // record audit event
}
```

---

## 45. jOOQ Considerations

jOOQ sering lebih nyaman untuk PostgreSQL-specific SQL.

Keuntungan:

1. explicit SQL shape,
2. easier JSONB operators via DSL/plain SQL,
3. type-safe generated columns,
4. better control over partial updates,
5. easier `RETURNING` usage.

Contoh SQL-first approach:

```sql
UPDATE cases
SET metadata = jsonb_set(metadata, '{risk,category}', to_jsonb(?::text), true),
    updated_at = now()
WHERE id = ?
RETURNING id, metadata;
```

Untuk fitur PostgreSQL seperti JSONB, jOOQ sering memberi kontrol lebih baik dibanding ORM-heavy abstraction.

---

## 46. JSONB dan API Compatibility

Jika payload JSONB berasal dari API, pikirkan compatibility:

1. field baru harus tolerated,
2. field lama tidak langsung hilang,
3. enum value baru harus dipahami,
4. missing field harus aman,
5. null semantics harus jelas,
6. schema version harus tersedia jika bentuk berubah besar.

Jangan menggunakan JSONB sebagai alasan untuk tidak punya contract test.

Contract test harus memastikan:

1. legacy payload masih bisa dibaca,
2. new payload bisa diproses,
3. unknown field tidak merusak,
4. invalid field ditolak di boundary yang benar,
5. metadata internal tidak bocor ke public API.

---

## 47. Common JSONB Mistakes

### Mistake 1: Semua Field Dinamis Masuk JSONB

Tidak semua field yang “mungkin berubah” harus JSONB. Banyak field berubah tetapi tetap domain utama.

### Mistake 2: Tidak Ada Index Strategy

Query JSONB tanpa index bisa buruk. Index JSONB tanpa query nyata juga buruk.

### Mistake 3: Tidak Ada Schema Version

Bentuk JSON berubah diam-diam dan aplikasi lama rusak.

### Mistake 4: Metadata Jadi Tempat Sampah

Setiap tim menaruh key sendiri tanpa governance.

### Mistake 5: JSONB Besar di Row Panas

Menyebabkan update mahal dan bloat.

### Mistake 6: Menyimpan Relasi di JSONB

Menghilangkan FK, constraint, dan queryability.

### Mistake 7: Expose JSONB Mentah ke Client

Menciptakan coupling dan risiko data leakage.

### Mistake 8: Tidak Menguji Wrong Type/Missing Key

Runtime bug muncul saat payload tidak sesuai asumsi.

### Mistake 9: Menggunakan JSONB untuk Menghindari Diskusi Domain

Fleksibilitas teknis dipakai untuk menunda modelling yang seharusnya dilakukan.

---

## 48. Production Checklist untuk JSONB Design

Sebelum menambahkan JSONB column, jawab:

```text
1. Apa nama kolom JSONB-nya?
2. Apa tujuan utamanya?
3. Field apa yang boleh masuk?
4. Field apa yang tidak boleh masuk?
5. Apakah ada sensitive data?
6. Apakah ada schema version?
7. Apakah ada key yang wajib?
8. Apakah ada key yang sering di-query?
9. Apakah key tersebut sebaiknya kolom?
10. Apakah perlu GIN index?
11. Apakah perlu expression index?
12. Apakah perlu generated column?
13. Bagaimana migration JSONB dilakukan?
14. Bagaimana validasi dilakukan?
15. Bagaimana Java type mapping-nya?
16. Apakah metadata raw akan diexpose ke API?
17. Berapa ukuran payload yang wajar?
18. Bagaimana mendeteksi payload terlalu besar?
19. Apakah field di JSONB sering diupdate?
20. Apakah JSONB ini akan menyebabkan row hot menjadi berat?
```

---

## 49. Heuristik Top-tier Engineer

### 49.1 Promote by Importance

Jika field menjadi penting, promosikan ke kolom.

```text
metadata today, column tomorrow
```

bukan kegagalan. Itu evolution yang sehat.

### 49.2 Separate by Lifecycle

Jika subdocument punya lifecycle sendiri, pisahkan tabel.

### 49.3 Index by Query, Not by Fear

Buat index berdasarkan query nyata dan `EXPLAIN`, bukan kekhawatiran abstrak.

### 49.4 Keep Core Model Visible

DDL harus tetap menjelaskan domain utama.

### 49.5 Avoid Hidden Contracts

Jika banyak kode bergantung pada key JSONB, contract itu harus didokumentasikan dan ditest.

### 49.6 Treat JSONB Migration Seriously

JSONB tetap punya schema evolution, walaupun tidak tertulis sebagai kolom.

### 49.7 Watch Write Amplification

Payload besar + update sering = masalah produksi.

---

## 50. Summary Mental Model

JSONB adalah alat kuat jika dipakai sebagai bagian dari desain hybrid yang sadar batas.

Model yang baik:

```text
Core facts      -> columns
Relationships   -> foreign keys / join tables
Invariants      -> constraints
Search paths    -> indexes
Variable context -> JSONB
Raw evidence    -> JSONB, often separate table
Large payloads  -> separate table/archive
Reporting dims  -> columns/projections
```

Model buruk:

```text
Everything -> JSONB
```

Karena itu mengorbankan:

1. correctness,
2. observability,
3. planner quality,
4. migration discipline,
5. operational performance,
6. auditability,
7. Java type safety.

Kalimat kunci:

```text
JSONB bukan cara untuk tidak mendesain schema.
JSONB adalah cara untuk mendesain bagian schema yang memang semi-struktural secara eksplisit.
```

---

## 51. Latihan Praktis

### Latihan 1 — Field Classification

Ambil entity `case` dan klasifikasikan field berikut sebagai `column`, `jsonb`, atau `separate table`:

1. `caseNumber`
2. `status`
3. `assignedOfficerId`
4. `sourceTags`
5. `rawProviderResponse`
6. `riskScore`
7. `lastViewedAt`
8. `relatedCaseIds`
9. `decisionReasonCode`
10. `uiDisplayPreference`

Jawaban yang matang harus menjelaskan:

1. query pattern,
2. invariant,
3. update frequency,
4. audit requirement,
5. relationship semantics.

### Latihan 2 — Refactor JSONB-heavy Table

Diberikan table:

```sql
CREATE TABLE enforcement_items (
    id uuid PRIMARY KEY,
    payload jsonb NOT NULL
);
```

Payload:

```json
{
  "tenantId": "...",
  "itemNumber": "ENF-001",
  "status": "OPEN",
  "subjectId": "...",
  "priority": "HIGH",
  "dueAt": "2026-07-01T00:00:00Z",
  "source": {
    "system": "SURVEILLANCE",
    "reference": "SRC-1"
  },
  "notes": [
    {"at": "...", "text": "..."}
  ]
}
```

Tugas:

1. buat desain hybrid,
2. tentukan constraints,
3. tentukan indexes,
4. tentukan field yang tetap JSONB,
5. tentukan field yang pindah ke tabel terpisah.

### Latihan 3 — JSONB Migration Plan

Field `metadata.riskCategory` sering dipakai di dashboard. Buat rencana migration zero-downtime dari JSONB ke kolom `risk_category`.

Rencana minimal:

1. add nullable column,
2. backfill batch,
3. add constraint not valid,
4. validate constraint,
5. create index concurrently,
6. deploy read path baru,
7. deploy write path baru,
8. cleanup old metadata jika perlu.

### Latihan 4 — Diagnose Slow JSONB Query

Query:

```sql
SELECT *
FROM cases
WHERE metadata->>'riskCategory' = 'HIGH'
ORDER BY created_at DESC
LIMIT 50;
```

Tugas:

1. jalankan `EXPLAIN (ANALYZE, BUFFERS)`,
2. identifikasi apakah sequential scan terjadi,
3. usulkan index,
4. pertimbangkan apakah `riskCategory` harus menjadi kolom,
5. jelaskan trade-off write/read.

---

## 52. Bridge ke Part Berikutnya

Bagian ini menutup topik JSONB dan hybrid relational modelling.

Kita sekarang punya mental model:

```text
relational core + semi-structured edge
```

Part berikutnya akan masuk ke:

```text
Part 018 — Partitioning: Range, List, Hash, Pruning, Maintenance, dan Operational Trade-off
```

Partitioning penting ketika data tumbuh besar, retention menjadi isu, query perlu pruning, dan operational lifecycle seperti archival/detach/drop partition menjadi bagian desain.

---

## Status Akhir Part 017

```text
Seri belum selesai.
Saat ini selesai sampai Part 017 dari 034.
Lanjut berikutnya: Part 018 — Partitioning.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Schema Design PostgreSQL-specific: Types, Domains, ENUM, Range, JSONB, Array</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-018.md">Part 018 — Partitioning: Range, List, Hash, Pruning, Maintenance, dan Operational Trade-off ➡️</a>
</div>
