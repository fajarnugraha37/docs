# learn-mysql-mastery-for-java-engineers-part-031.md

# Part 031 — JSON, Generated Columns, Full-Text, and Semi-Structured Data

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `031 / 034`  
> Topik: JSON, generated columns, full-text search, dan semi-structured data di MySQL  
> Target pembaca: Java software engineer yang ingin memahami kapan MySQL bisa dipakai untuk semi-structured data dan kapan harus memakai model relasional/search engine terpisah.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas large table, partitioning, archiving, dan retention. Sekarang kita masuk ke area yang sering terlihat praktis tetapi berbahaya bila tidak dipahami dengan benar: **JSON dan semi-structured data di MySQL**.

Banyak sistem Java modern punya kebutuhan seperti:

- form dinamis,
- metadata fleksibel,
- integration payload,
- audit snapshot,
- external reference,
- regulatory case attributes,
- rule evaluation context,
- search screen dengan filter variatif,
- user preference,
- configuration blob,
- event payload,
- webhook payload,
- imported data yang schemanya berubah-ubah.

Saat kebutuhan seperti ini muncul, engineer sering tergoda berkata:

> “Simpan saja di kolom JSON. Nanti gampang.”

Kadang benar. Kadang itu awal dari schema debt yang sangat mahal.

Tujuan bagian ini adalah membuat kamu bisa membedakan:

1. kapan JSON di MySQL adalah keputusan yang baik,
2. kapan JSON hanya menunda desain schema yang sebenarnya,
3. bagaimana query JSON bekerja,
4. bagaimana indexing JSON harus didesain,
5. bagaimana generated column membantu membuat JSON lebih operasional,
6. bagaimana full-text search di MySQL bekerja dan batasannya,
7. kapan kebutuhan search harus dipindahkan ke Elasticsearch/OpenSearch,
8. bagaimana mengintegrasikan desain ini ke aplikasi Java secara defensible.

Bagian ini bukan pengulangan seri SQL. Kita tidak akan membahas JSON sebagai syntax kosmetik saja. Kita akan melihatnya sebagai **keputusan arsitektur data**.

---

## 1. Mental Model Utama: JSON Bukan Pengganti Relational Model

MySQL adalah database relasional dengan kemampuan JSON, bukan document database murni.

Kalimat ini penting.

Kolom JSON memberi fleksibilitas struktur, tetapi tidak menghapus kebutuhan untuk berpikir tentang:

- identity,
- constraint,
- relationship,
- indexing,
- query pattern,
- concurrency,
- migration,
- audit,
- validation,
- retention,
- observability.

Kalau data di JSON menjadi bagian dari invariant bisnis utama, maka data itu tidak benar-benar “semi-structured”. Ia sudah menjadi struktur domain.

Contoh:

```json
{
  "riskLevel": "HIGH",
  "assignedRegion": "JAKARTA",
  "slaDueAt": "2026-07-01T10:00:00+07:00",
  "requiresSupervisorApproval": true
}
```

Jika `riskLevel`, `assignedRegion`, dan `slaDueAt` digunakan untuk routing case, SLA queue, escalation, authorization, reporting, atau audit decision, maka atribut tersebut bukan sekadar metadata. Ia adalah bagian dari domain model.

Dalam kasus seperti itu, menyimpannya hanya di JSON sering menyebabkan:

- constraint lemah,
- query lambat,
- index sulit,
- schema evolution tidak terkontrol,
- data quality buruk,
- reporting rumit,
- migrasi mahal,
- auditability rendah,
- validasi tersebar di aplikasi.

Prinsip awal:

> JSON cocok untuk fleksibilitas terkontrol. JSON buruk untuk menyembunyikan struktur domain yang sebenarnya sudah stabil.

---

## 2. Kapan JSON Cocok Digunakan di MySQL

JSON di MySQL cocok bila data memenuhi beberapa karakteristik berikut.

### 2.1 Data Bersifat Tambahan, Bukan Invariant Utama

Contoh:

```sql
CREATE TABLE user_preference (
    user_id BIGINT NOT NULL PRIMARY KEY,
    preference_doc JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

`preference_doc` mungkin berisi:

```json
{
  "theme": "dark",
  "tableColumns": ["caseNo", "status", "dueDate"],
  "dashboardLayout": {
    "leftPanel": "collapsed"
  }
}
```

Ini relatif aman karena:

- jarang menjadi join utama,
- tidak menjadi constraint lintas entity,
- tidak menentukan transaction safety,
- tidak menjadi basis SLA legal,
- biasanya dibaca/ditulis sebagai satu dokumen kecil.

### 2.2 Data Berasal dari Sistem Eksternal dan Perlu Disimpan Apa Adanya

Contoh:

```sql
CREATE TABLE inbound_webhook_event (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider VARCHAR(64) NOT NULL,
    provider_event_id VARCHAR(128) NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload JSON NOT NULL,
    UNIQUE KEY uk_provider_event (provider, provider_event_id)
);
```

Payload eksternal sering perlu disimpan untuk:

- audit,
- replay,
- debugging,
- legal traceability,
- reconciliation.

Namun atribut penting tetap boleh diangkat ke kolom biasa:

```sql
ALTER TABLE inbound_webhook_event
ADD COLUMN event_type VARCHAR(64) NOT NULL,
ADD COLUMN subject_ref VARCHAR(128) NULL,
ADD KEY idx_event_type_received (event_type, received_at);
```

Pola ini disebut:

> Store raw payload, project important fields.

### 2.3 Data Memiliki Schema yang Sangat Dinamis tetapi Query Terbatas

Contoh:

- custom field untuk form dinamis,
- feature flag metadata,
- integration-specific options,
- non-critical UI configuration.

Kalau query terhadap field dinamis sangat terbatas, JSON bisa masuk akal.

Tapi kalau pengguna meminta filter dinamis terhadap semua field JSON, kamu sedang membangun query engine. MySQL JSON mungkin tidak cukup.

### 2.4 Data Berukuran Kecil dan Tidak Sering Diupdate Parsial

JSON cocok jika dokumen kecil dan update tidak terlalu sering.

Jika dokumen besar dan sering diupdate, risiko meningkat:

- row menjadi besar,
- undo/redo meningkat,
- binlog membesar,
- replication lag naik,
- buffer pool lebih cepat penuh,
- backup membesar,
- network response besar,
- ORM mapping boros.

---

## 3. Kapan JSON Tidak Cocok

### 3.1 Jika Field JSON Dipakai di Banyak WHERE/JOIN/ORDER BY

Contoh buruk:

```sql
SELECT *
FROM case_record
WHERE JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.riskLevel')) = 'HIGH'
  AND JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.region')) = 'JAKARTA'
ORDER BY JSON_EXTRACT(attributes, '$.slaDueAt')
LIMIT 50;
```

Masalah:

- expression harus dievaluasi per row jika tidak ada index yang tepat,
- optimizer lebih sulit memperkirakan selectivity,
- collation/type mismatch mudah terjadi,
- sorting bisa jatuh ke filesort,
- pagination sulit stabil,
- query builder makin kompleks.

Jika field dipakai intensif, pertimbangkan kolom biasa:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_no VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    risk_level VARCHAR(16) NOT NULL,
    region_code VARCHAR(32) NOT NULL,
    sla_due_at TIMESTAMP NULL,
    attributes JSON NULL,
    KEY idx_work_queue (status, risk_level, region_code, sla_due_at, id)
);
```

JSON tetap bisa menyimpan atribut tambahan, tetapi field operasional utama naik ke schema relasional.

### 3.2 Jika Kamu Butuh Constraint Kuat di Dalam JSON

MySQL bisa memvalidasi bahwa sebuah kolom berisi JSON valid. Tetapi constraint domain di dalam JSON tidak sekuat kolom biasa.

Contoh kebutuhan constraint:

- `riskLevel` hanya boleh `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`,
- `slaDueAt` harus tanggal valid,
- `assignedUnitId` harus refer ke tabel unit,
- `approvalLevel` harus konsisten dengan `riskLevel`,
- field wajib ada untuk case type tertentu.

Semua bisa divalidasi di aplikasi, tetapi aplikasi bukan satu-satunya jalur perubahan data dalam sistem nyata. Ada migration, repair script, admin tools, ETL, integration jobs, dan operasi manual.

Jika constraint adalah invariant penting, database schema harus ikut menjaga.

### 3.3 Jika Kamu Butuh Foreign Key ke Field JSON

Relational database kuat karena relationship bisa dibuat eksplisit:

```sql
case_record.assigned_unit_id -> unit.id
```

Jika relationship disimpan seperti ini:

```json
{
  "assignedUnitId": 42
}
```

maka database tidak punya foreign key natural terhadap nilai tersebut.

Kamu bisa membuat generated column lalu index, tetapi FK terhadap generated column punya batasan dan kompleksitas. Biasanya lebih sehat menyimpan foreign key sebagai kolom biasa.

### 3.4 Jika JSON Menjadi Tempat Menyembunyikan Model yang Belum Dipikirkan

JSON sering dipakai karena tim belum sepakat model domainnya.

Itu bisa berguna untuk fase discovery, tapi harus diberi batas waktu.

Tanpa batas, JSON berubah menjadi:

- tempat field duplikat,
- tipe data tidak konsisten,
- nama field berbeda untuk makna sama,
- business rule tersebar,
- migration tak terencana,
- query tak teroptimasi,
- data historis tidak bisa dipercaya.

Prinsip:

> JSON boleh menjadi landing zone, tetapi jangan biarkan ia menjadi tempat pembuangan ketidakjelasan domain secara permanen.

---

## 4. MySQL JSON Data Type: Apa yang Perlu Dipahami

MySQL punya tipe `JSON` native.

Contoh:

```sql
CREATE TABLE case_attribute_snapshot (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    snapshot JSON NOT NULL,
    KEY idx_case_captured (case_id, captured_at)
);
```

Kolom `JSON` memastikan nilai yang disimpan adalah dokumen JSON valid.

Contoh insert valid:

```sql
INSERT INTO case_attribute_snapshot(case_id, snapshot)
VALUES (
    1001,
    JSON_OBJECT(
        'riskLevel', 'HIGH',
        'region', 'JAKARTA',
        'source', 'manual-review'
    )
);
```

Contoh insert invalid akan ditolak:

```sql
INSERT INTO case_attribute_snapshot(case_id, snapshot)
VALUES (1001, '{invalid json');
```

Tetapi valid JSON tidak berarti valid domain.

Ini valid JSON:

```json
{
  "riskLevel": 123,
  "slaDueAt": "not-a-date",
  "region": null
}
```

Database tahu itu JSON valid. Database tidak otomatis tahu bahwa `riskLevel` harus string tertentu atau `slaDueAt` harus ISO timestamp.

---

## 5. JSON Path dan Extraction

Untuk mengambil nilai dari JSON, MySQL menyediakan fungsi seperti:

```sql
JSON_EXTRACT(doc, '$.riskLevel')
```

Contoh:

```sql
SELECT
    id,
    JSON_EXTRACT(attributes, '$.riskLevel') AS risk_json
FROM case_record;
```

Hasil `JSON_EXTRACT` adalah nilai JSON, bukan selalu string SQL biasa.

Jika ingin string scalar:

```sql
SELECT
    id,
    JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.riskLevel')) AS risk_level
FROM case_record;
```

Shortcut operator umum:

```sql
attributes -> '$.riskLevel'
attributes ->> '$.riskLevel'
```

Secara mental:

- `->` mengembalikan JSON value,
- `->>` mengembalikan unquoted scalar text.

Contoh:

```sql
SELECT
    attributes -> '$.riskLevel'  AS risk_as_json,
    attributes ->> '$.riskLevel' AS risk_as_text
FROM case_record;
```

### Pitfall: Tipe Hasil Harus Disadari

Misalnya:

```sql
WHERE attributes -> '$.riskScore' > 70
```

Ini bisa membingungkan karena kamu membandingkan hasil JSON expression. Lebih eksplisit:

```sql
WHERE CAST(attributes ->> '$.riskScore' AS UNSIGNED) > 70
```

Tetapi expression seperti ini akan mahal jika dievaluasi di banyak row tanpa index.

---

## 6. JSON Modification Functions

MySQL menyediakan fungsi untuk memodifikasi JSON, misalnya:

```sql
JSON_SET()
JSON_INSERT()
JSON_REPLACE()
JSON_REMOVE()
JSON_ARRAY_APPEND()
```

Contoh:

```sql
UPDATE case_record
SET attributes = JSON_SET(attributes, '$.lastReviewedBy', 'user-123')
WHERE id = 1001;
```

Atau:

```sql
UPDATE case_record
SET attributes = JSON_SET(
    attributes,
    '$.riskLevel', 'HIGH',
    '$.review.required', true,
    '$.review.reason', 'threshold-exceeded'
)
WHERE id = 1001;
```

### Mental Model Update JSON

Walaupun kamu terlihat mengubah satu field, secara operasional tetap ada konsekuensi:

- row berubah,
- undo dibuat,
- redo dibuat,
- binlog mencatat perubahan,
- replica harus apply perubahan,
- index terkait generated/functional/multi-valued bisa ikut berubah,
- lock terhadap row tetap terjadi.

Jangan berpikir update JSON sebagai operasi gratis.

---

## 7. JSON dan Indexing: Masalah Utama

Masalah besar JSON di database relasional adalah indexing.

Kolom biasa:

```sql
WHERE risk_level = 'HIGH'
```

bisa memakai index langsung:

```sql
KEY idx_risk_level (risk_level)
```

Sedangkan JSON expression:

```sql
WHERE attributes ->> '$.riskLevel' = 'HIGH'
```

butuh strategi khusus.

Secara umum ada tiga pendekatan:

1. generated column + index,
2. functional index,
3. multi-valued index untuk array JSON.

---

## 8. Generated Columns: Menjadikan Field JSON Terlihat oleh Optimizer

Generated column adalah kolom yang nilainya dihitung dari expression.

Contoh:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_no VARCHAR(64) NOT NULL,
    attributes JSON NOT NULL,

    risk_level VARCHAR(16)
        GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.riskLevel'))) STORED,

    KEY idx_risk_level (risk_level)
);
```

Sekarang query ini bisa memakai index `idx_risk_level`:

```sql
SELECT id, case_no
FROM case_record
WHERE risk_level = 'HIGH';
```

### 8.1 Virtual vs Stored Generated Column

Generated column bisa:

- `VIRTUAL`, dihitung saat dibaca,
- `STORED`, disimpan secara fisik.

Contoh virtual:

```sql
risk_level VARCHAR(16)
    GENERATED ALWAYS AS (attributes ->> '$.riskLevel') VIRTUAL
```

Contoh stored:

```sql
risk_level VARCHAR(16)
    GENERATED ALWAYS AS (attributes ->> '$.riskLevel') STORED
```

Perbedaan mental model:

| Aspek | Virtual | Stored |
|---|---|---|
| Penyimpanan nilai | Tidak disimpan sebagai kolom fisik penuh | Disimpan |
| Biaya baca | Bisa ada biaya compute | Lebih murah dibaca |
| Biaya tulis | Lebih ringan dari stored, tetapi index tetap perlu maintenance bila diindex | Lebih berat karena nilai disimpan |
| Cocok untuk | Expression ringan, jarang dibaca, atau hanya untuk index tertentu | Expression sering dipakai, dibaca langsung, butuh predictable performance |

Catatan penting: jika generated column diindex, index tetap menyimpan nilai hasil expression. Jadi walaupun kolom virtual tidak disimpan sebagai kolom fisik biasa, index-nya tetap punya storage dan maintenance cost.

### 8.2 Generated Column untuk Normalisasi Bertahap

Generated column bisa menjadi jembatan migrasi dari JSON ke schema relasional.

Fase 1: semua di JSON.

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attributes JSON NOT NULL
);
```

Fase 2: expose field penting sebagai generated column.

```sql
ALTER TABLE case_record
ADD COLUMN risk_level VARCHAR(16)
    GENERATED ALWAYS AS (attributes ->> '$.riskLevel') STORED,
ADD KEY idx_risk_level (risk_level);
```

Fase 3: buat kolom normal dan backfill.

```sql
ALTER TABLE case_record
ADD COLUMN risk_level_v2 VARCHAR(16) NULL;

UPDATE case_record
SET risk_level_v2 = attributes ->> '$.riskLevel'
WHERE risk_level_v2 IS NULL;
```

Fase 4: aplikasi menulis kolom normal, JSON menjadi snapshot/extension.

Fase 5: tambahkan constraint dan hapus dependensi JSON untuk field utama.

Ini lebih sehat daripada membiarkan query penting selamanya bergantung pada JSON path.

---

## 9. Functional Indexes: Index Expression Tanpa Kolom Eksplisit

MySQL mendukung index atas expression.

Contoh:

```sql
CREATE INDEX idx_case_risk_expr
ON case_record ((CAST(attributes ->> '$.riskLevel' AS CHAR(16))));
```

Lalu query:

```sql
SELECT id, case_no
FROM case_record
WHERE CAST(attributes ->> '$.riskLevel' AS CHAR(16)) = 'HIGH';
```

### 9.1 Pitfall: Expression Harus Cocok

Functional index hanya membantu jika expression query kompatibel dengan expression index.

Index:

```sql
CREATE INDEX idx_case_risk_expr
ON case_record ((CAST(attributes ->> '$.riskLevel' AS CHAR(16))));
```

Query mungkin tidak memakai index jika expression berbeda secara tipe/collation:

```sql
WHERE attributes ->> '$.riskLevel' = 'HIGH'
```

Untuk sistem production, generated column sering lebih jelas daripada functional index karena:

- nama kolom eksplisit,
- query lebih mudah dibaca,
- bisa dianalisis sebagai schema contract,
- lebih mudah dipakai ORM/query builder,
- lebih mudah masuk checklist migrasi,
- lebih mudah diberi statistik/observability.

Functional index cocok jika kamu ingin menghindari kolom tambahan di schema tetapi tetap harus hati-hati menjaga expression consistency.

---

## 10. Multi-Valued Index: JSON Array Bukan Sama dengan Relasi

Multi-valued index dirancang untuk JSON array.

Misalnya field JSON:

```json
{
  "tags": ["fraud", "priority", "cross-border"]
}
```

Table:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_no VARCHAR(64) NOT NULL,
    attributes JSON NOT NULL,
    INDEX idx_tags ((CAST(attributes -> '$.tags' AS CHAR(32) ARRAY)))
);
```

Query:

```sql
SELECT id, case_no
FROM case_record
WHERE 'fraud' MEMBER OF(attributes -> '$.tags');
```

Multi-valued index bisa membantu query membership pada array JSON.

### 10.1 Tetapi Jangan Menganggap Ini Pengganti Join Table

Jika tag adalah domain serius, relasi biasa sering lebih baik:

```sql
CREATE TABLE case_tag (
    case_id BIGINT NOT NULL,
    tag_code VARCHAR(64) NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by BIGINT NULL,
    PRIMARY KEY (case_id, tag_code),
    KEY idx_tag_case (tag_code, case_id)
);
```

Relasi biasa memberi:

- constraint lebih jelas,
- indexing fleksibel,
- audit assignment lebih mudah,
- metadata per tag,
- query agregasi lebih natural,
- join dengan master tag,
- foreign key,
- history.

JSON array cocok jika:

- array kecil,
- semantics sederhana,
- tidak butuh metadata per element,
- tidak butuh relationship kuat,
- query membership terbatas.

---

## 11. JSON_TABLE: Mengubah JSON Menjadi Bentuk Relasional Sementara

`JSON_TABLE()` bisa mengubah JSON menjadi row/column untuk query.

Contoh payload:

```json
{
  "violations": [
    {"code": "AML-001", "severity": "HIGH"},
    {"code": "KYC-002", "severity": "MEDIUM"}
  ]
}
```

Query:

```sql
SELECT
    c.id,
    jt.violation_code,
    jt.severity
FROM case_record c,
JSON_TABLE(
    c.attributes,
    '$.violations[*]'
    COLUMNS (
        violation_code VARCHAR(32) PATH '$.code',
        severity VARCHAR(16) PATH '$.severity'
    )
) AS jt
WHERE jt.severity = 'HIGH';
```

Ini berguna untuk:

- ad-hoc analysis,
- migration,
- data repair,
- projection,
- occasional reporting,
- transforming imported payload.

Tetapi untuk workload intensif, jangan jadikan `JSON_TABLE()` sebagai jalan utama query produksi jika data bisa dimodelkan sebagai child table.

Relasi lebih stabil:

```sql
CREATE TABLE case_violation (
    case_id BIGINT NOT NULL,
    violation_code VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    PRIMARY KEY (case_id, violation_code),
    KEY idx_severity_case (severity, case_id)
);
```

---

## 12. Hybrid Relational + JSON Model

Model yang paling sehat sering bukan “relasional semua” atau “JSON semua”, tetapi hybrid.

Contoh:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_no VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    risk_level VARCHAR(16) NOT NULL,
    assigned_unit_id BIGINT NULL,
    opened_at TIMESTAMP NOT NULL,
    sla_due_at TIMESTAMP NULL,
    attributes JSON NULL,

    UNIQUE KEY uk_case_no (case_no),
    KEY idx_work_queue (status, risk_level, assigned_unit_id, sla_due_at, id),
    KEY idx_opened (opened_at, id)
);
```

Relational columns menyimpan:

- identity,
- status,
- workflow,
- routing,
- SLA,
- ownership,
- authorization,
- filtering utama,
- reporting utama.

JSON menyimpan:

- metadata tambahan,
- integration payload subset,
- UI extension,
- non-critical attributes,
- snapshot detail,
- experimental field.

Prinsip:

> Kolom relasional untuk invariant dan query penting. JSON untuk extension yang terkontrol.

---

## 13. Desain untuk Dynamic Forms

Dynamic form adalah salah satu alasan paling umum orang memakai JSON.

Misalnya sistem case-management punya form berbeda per case type:

- complaint,
- enforcement action,
- inspection,
- investigation,
- license review,
- suspicious transaction review.

Pendekatan naif:

```sql
CREATE TABLE case_form_submission (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    form_code VARCHAR(64) NOT NULL,
    answers JSON NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Ini bisa baik untuk menyimpan snapshot form.

Tetapi pertanyaannya:

- Apakah jawaban akan difilter?
- Apakah jawaban menentukan workflow?
- Apakah jawaban harus divalidasi lintas field?
- Apakah jawaban akan masuk report?
- Apakah jawaban perlu audit perubahan per field?
- Apakah jawaban perlu retention/legal hold berbeda?
- Apakah jawaban perlu permission per field?

Jika jawabannya “ya” untuk banyak poin, JSON tunggal tidak cukup.

### 13.1 Pola Hybrid Dynamic Form

```sql
CREATE TABLE form_definition (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    form_code VARCHAR(64) NOT NULL,
    version INT NOT NULL,
    schema_doc JSON NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY uk_form_version (form_code, version)
);

CREATE TABLE form_submission (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    form_definition_id BIGINT NOT NULL,
    submitted_by BIGINT NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answer_doc JSON NOT NULL,
    KEY idx_case_submission (case_id, submitted_at)
);
```

Untuk field yang penting secara query, buat projection table:

```sql
CREATE TABLE form_answer_projection (
    submission_id BIGINT NOT NULL,
    field_code VARCHAR(128) NOT NULL,
    value_text VARCHAR(512) NULL,
    value_number DECIMAL(18,4) NULL,
    value_date DATE NULL,
    value_bool BOOLEAN NULL,
    PRIMARY KEY (submission_id, field_code),
    KEY idx_field_text (field_code, value_text),
    KEY idx_field_number (field_code, value_number),
    KEY idx_field_date (field_code, value_date)
);
```

Ini memberi:

- JSON snapshot tetap utuh,
- schema form versioned,
- field penting bisa dicari,
- type-aware indexing,
- migration lebih terkontrol,
- audit lebih mudah.

Trade-off:

- write lebih kompleks,
- projection harus konsisten,
- query builder lebih rumit,
- storage lebih besar.

Tetapi untuk sistem regulatory/case-management, trade-off ini sering layak karena auditability dan queryability penting.

---

## 14. Full-Text Search di MySQL

MySQL menyediakan full-text index untuk pencarian teks.

Contoh:

```sql
CREATE TABLE case_note (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT KEY ft_note_text (note_text),
    KEY idx_case_created (case_id, created_at)
);
```

Query natural language:

```sql
SELECT id, case_id, note_text
FROM case_note
WHERE MATCH(note_text) AGAINST ('suspicious transfer');
```

Boolean mode:

```sql
SELECT id, case_id, note_text
FROM case_note
WHERE MATCH(note_text) AGAINST ('+suspicious +transfer -duplicate' IN BOOLEAN MODE);
```

### 14.1 Kapan Full-Text MySQL Cukup

MySQL full-text bisa cukup jika:

- search sederhana,
- dataset sedang,
- relevance tidak terlalu kompleks,
- tidak butuh fuzzy search kuat,
- tidak butuh typo tolerance,
- tidak butuh stemming bahasa kompleks,
- tidak butuh ranking canggih,
- tidak butuh highlight/snippet advanced,
- tidak butuh faceting kompleks,
- search bukan fitur utama produk.

Contoh cocok:

- search catatan internal sederhana,
- search subject name basic,
- search description field,
- admin utility search,
- low-volume backoffice lookup.

### 14.2 Kapan Full-Text MySQL Tidak Cukup

Gunakan search engine seperti Elasticsearch/OpenSearch jika butuh:

- relevance ranking kompleks,
- typo tolerance,
- fuzzy matching,
- stemming/analyzer bahasa,
- synonym,
- autocomplete,
- highlighting,
- faceted navigation,
- scalable search workload terpisah,
- aggregated search across many entities,
- near-real-time indexing pipeline,
- search observability khusus,
- query DSL yang kompleks.

Dalam sistem regulatory, contoh kebutuhan search engine:

- cari case berdasarkan nama pihak dengan variasi ejaan,
- pencarian across note, attachment metadata, subject, address, aliases,
- filter facet berdasarkan region/status/risk/period,
- relevance score,
- typo tolerance,
- audit search query,
- search di volume besar tanpa membebani OLTP primary.

### 14.3 Boundary Penting: MySQL adalah Source of Truth, Search Engine adalah Projection

Jika memakai search engine, jangan jadikan search index sebagai source of truth.

Pola sehat:

```text
MySQL transaction commit
        ↓
Outbox event / binlog CDC
        ↓
Indexer service
        ↓
Elasticsearch/OpenSearch document
```

Query detail tetap ke MySQL:

```text
Search engine returns matching IDs
        ↓
Application loads authoritative records from MySQL
        ↓
Permission/status/business validation
        ↓
Response
```

Kenapa?

Karena search index bisa:

- lag,
- stale,
- gagal update,
- punya analyzer berbeda,
- kehilangan sebagian document,
- rebuild,
- tidak punya constraint relational,
- tidak ideal untuk transaksi.

---

## 15. JSON, Full-Text, dan Search Screen yang Kompleks

Search screen sering menjadi sumber query yang memburuk pelan-pelan.

Contoh UI filter:

- status,
- risk level,
- region,
- assigned unit,
- opened date,
- due date,
- subject name,
- external reference,
- custom attributes,
- text note,
- tags,
- violation type,
- officer,
- priority,
- legal hold flag.

Jika semua filter diarahkan ke satu query MySQL dengan banyak JSON extraction dan full-text expression, kamu akan menghadapi:

- plan instability,
- index tidak bisa optimal untuk semua kombinasi,
- sort mahal,
- temp table,
- filesort,
- inconsistent pagination,
- lock/CPU spike,
- endpoint latency tidak stabil.

### 15.1 Desain Search Boundary

Pisahkan query menjadi kategori:

#### A. Operational Queue Query

Contoh:

```text
“Ambil 50 case HIGH risk berstatus OPEN untuk unit A, urut SLA terdekat.”
```

Ini harus relational + index kuat.

```sql
KEY idx_queue (status, risk_level, assigned_unit_id, sla_due_at, id)
```

#### B. Lookup by Exact Identifier

Contoh:

```text
Cari case_no, external_ref, national_id hash.
```

Ini harus relational unique/non-unique index.

#### C. Ad-Hoc Flexible Search

Contoh:

```text
Cari semua case dengan kata mirip X di note, alias, address, payload.
```

Ini kandidat search engine.

#### D. Dynamic Field Filter

Contoh:

```text
Filter by custom form answer.
```

Gunakan projection table atau search index, bukan JSON scan masif.

---

## 16. Java Mapping untuk JSON

Di aplikasi Java, JSON column biasanya dimapping sebagai:

1. `String`,
2. `JsonNode`,
3. `Map<String, Object>`,
4. domain-specific value object,
5. custom Hibernate type.

### 16.1 Mapping sebagai String

```java
public class CaseRecord {
    private Long id;
    private String caseNo;
    private String attributesJson;
}
```

Kelebihan:

- sederhana,
- tidak ada magic,
- mudah disimpan mentah,
- cocok untuk raw payload.

Kekurangan:

- validasi domain manual,
- parsing manual,
- mudah membuat bug string manipulation,
- tidak type-safe.

### 16.2 Mapping sebagai JsonNode

```java
public class CaseRecord {
    private Long id;
    private String caseNo;
    private JsonNode attributes;
}
```

Kelebihan:

- fleksibel,
- cocok untuk semi-structured payload,
- tidak perlu membuat class untuk semua variasi.

Kekurangan:

- business logic mudah tersebar dengan path string,
- refactor sulit,
- validasi harus disiplin,
- null/missing/type mismatch perlu ditangani.

### 16.3 Mapping sebagai Value Object

```java
public record CaseAttributes(
    String sourceSystem,
    Map<String, Object> extension,
    List<String> tags
) {}
```

Kelebihan:

- lebih type-aware,
- validasi lebih jelas,
- cocok jika schema JSON semi-stabil.

Kekurangan:

- schema evolution perlu versioning,
- backward compatibility perlu dipikirkan,
- unknown field handling harus jelas.

### 16.4 Jangan Sebar JSON Path di Banyak Service

Buruk:

```java
String risk = node.at("/riskLevel").asText();
String region = node.at("/region").asText();
boolean urgent = node.at("/flags/urgent").asBoolean();
```

Jika tersebar di banyak class, field rename menjadi mimpi buruk.

Lebih baik buat adapter:

```java
public final class CaseAttributesView {
    private final JsonNode root;

    public CaseAttributesView(JsonNode root) {
        this.root = Objects.requireNonNull(root);
    }

    public Optional<String> riskLevel() {
        JsonNode node = root.path("riskLevel");
        return node.isTextual() ? Optional.of(node.asText()) : Optional.empty();
    }

    public Optional<String> region() {
        JsonNode node = root.path("region");
        return node.isTextual() ? Optional.of(node.asText()) : Optional.empty();
    }

    public boolean urgent() {
        return root.path("flags").path("urgent").asBoolean(false);
    }
}
```

Ini membuat path menjadi contract terpusat.

---

## 17. JSON Schema Versioning

Jika JSON akan bertahan lama, versioning harus eksplisit.

Contoh:

```json
{
  "schemaVersion": 3,
  "risk": {
    "level": "HIGH",
    "score": 87
  },
  "source": {
    "system": "AML_GATEWAY",
    "reference": "EXT-9912"
  }
}
```

Java reader:

```java
public CaseAttributes parse(JsonNode root) {
    int version = root.path("schemaVersion").asInt(1);

    return switch (version) {
        case 1 -> parseV1(root);
        case 2 -> parseV2(root);
        case 3 -> parseV3(root);
        default -> throw new UnsupportedSchemaVersionException(version);
    };
}
```

### 17.1 Forward dan Backward Compatibility

Pikirkan:

- Apakah reader lama boleh membaca writer baru?
- Apakah field baru optional?
- Apakah field lama masih dipertahankan?
- Apakah migration perlu backfill?
- Apakah search projection perlu reindex?
- Apakah audit snapshot harus tetap bisa dibaca setelah 5 tahun?

Untuk sistem regulatory, data lama harus tetap dapat dijelaskan. Jangan membuat parser yang hanya bisa membaca schema terbaru.

---

## 18. Validasi JSON: Database, Application, atau Keduanya?

Validasi bisa terjadi di beberapa tempat.

### 18.1 Database-Level Basic Validation

Kolom `JSON` memastikan JSON valid.

Generated column bisa memaksa tipe tertentu secara tidak langsung:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attributes JSON NOT NULL,
    risk_score INT
        GENERATED ALWAYS AS (CAST(attributes ->> '$.riskScore' AS UNSIGNED)) STORED
);
```

Jika `riskScore` tidak bisa di-cast sesuai kebutuhan, kamu bisa mendapatkan error atau hasil yang tidak diinginkan tergantung expression dan mode. Karena itu harus diuji.

### 18.2 Application-Level Validation

Aplikasi bisa memakai JSON Schema atau validator custom.

Contoh mental model:

```text
Incoming DTO
   ↓
Syntax validation
   ↓
JSON schema validation
   ↓
Domain invariant validation
   ↓
Relational projection extraction
   ↓
Transaction write
```

Validasi aplikasi tetap penting karena database tidak tahu seluruh business rule.

### 18.3 Defense in Depth

Untuk field penting:

- validasi di aplikasi,
- simpan sebagai kolom relasional,
- beri constraint/check/reference jika mungkin,
- simpan raw JSON untuk audit jika perlu.

Jangan hanya mengandalkan JSON blob.

---

## 19. Anti-Pattern Umum

### 19.1 “Everything Attributes” Table

```sql
CREATE TABLE entity (
    id BIGINT PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    attributes JSON NOT NULL
);
```

Awalnya fleksibel. Lama-lama semua entity masuk ke satu tabel.

Masalah:

- query semua entity bercampur,
- index tidak jelas,
- constraint tidak ada,
- lifecycle berbeda disatukan,
- retention berbeda sulit,
- authorization sulit,
- data quality jatuh,
- optimizer sulit,
- migration domain tidak jelas.

### 19.2 JSON untuk Avoid Migration

Tim menaruh field baru ke JSON karena takut migration.

Padahal field tersebut dipakai sebagai filter/report utama.

Ini memindahkan biaya dari migration yang terkontrol menjadi query dan data debt yang menyebar.

### 19.3 JSON Array untuk Relationship Penting

```json
{
  "assignedOfficerIds": [101, 102, 103]
}
```

Buruk jika kamu perlu:

- siapa assigned kapan,
- role assignment,
- revoke history,
- FK ke officer,
- query semua case milik officer,
- unique active assignment,
- audit.

Gunakan table:

```sql
CREATE TABLE case_assignment (
    case_id BIGINT NOT NULL,
    officer_id BIGINT NOT NULL,
    role_code VARCHAR(32) NOT NULL,
    assigned_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,
    PRIMARY KEY (case_id, officer_id, role_code, assigned_at),
    KEY idx_officer_active (officer_id, revoked_at, case_id)
);
```

### 19.4 JSON Tanpa Schema Version

Tanpa version, perubahan payload akan membuat reader ambigu.

Contoh evolusi buruk:

V1:

```json
{"riskLevel": "HIGH"}
```

V2:

```json
{"risk": {"level": "HIGH"}}
```

Jika reader tidak tahu versi, ia harus menebak.

Dalam sistem audit/regulatory, menebak adalah musuh defensibility.

### 19.5 Full-Text untuk Semua Search Problem

MySQL full-text bukan replacement penuh untuk search platform.

Jangan memaksa MySQL menjadi:

- fuzzy search engine,
- vector search platform,
- document relevance engine,
- analytics search engine,
- multi-entity search aggregator.

Gunakan MySQL untuk source of truth dan operational query. Gunakan search engine untuk search projection bila kebutuhan search memang kompleks.

---

## 20. Pola Desain yang Disarankan

### 20.1 Raw + Projection Pattern

Cocok untuk integration/event payload.

```sql
CREATE TABLE inbound_event (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider VARCHAR(64) NOT NULL,
    provider_event_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    subject_ref VARCHAR(128) NULL,
    occurred_at TIMESTAMP NULL,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload JSON NOT NULL,

    UNIQUE KEY uk_provider_event (provider, provider_event_id),
    KEY idx_event_type_received (event_type, received_at),
    KEY idx_subject (subject_ref)
);
```

Raw payload disimpan, field penting diproyeksikan.

### 20.2 Relational Core + JSON Extension

Cocok untuk entity domain utama.

```sql
CREATE TABLE regulated_entity (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    registration_no VARCHAR(64) NOT NULL,
    legal_name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    extension JSON NULL,

    UNIQUE KEY uk_registration_no (registration_no),
    KEY idx_status_type (status, entity_type)
);
```

Core jelas, extension fleksibel.

### 20.3 Versioned Document Snapshot

Cocok untuk audit snapshot.

```sql
CREATE TABLE case_decision_snapshot (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    decision_id BIGINT NOT NULL,
    schema_version INT NOT NULL,
    captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    snapshot JSON NOT NULL,

    KEY idx_case_captured (case_id, captured_at),
    KEY idx_decision (decision_id)
);
```

Snapshot tidak harus queryable secara luas. Ia harus immutable dan readable secara historis.

### 20.4 Projection Table for Dynamic Attributes

Cocok untuk custom field searchable.

```sql
CREATE TABLE case_dynamic_attribute_value (
    case_id BIGINT NOT NULL,
    attribute_code VARCHAR(128) NOT NULL,
    value_text VARCHAR(512) NULL,
    value_number DECIMAL(18,4) NULL,
    value_date DATE NULL,
    value_bool BOOLEAN NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (case_id, attribute_code),
    KEY idx_attr_text (attribute_code, value_text, case_id),
    KEY idx_attr_number (attribute_code, value_number, case_id),
    KEY idx_attr_date (attribute_code, value_date, case_id),
    KEY idx_attr_bool (attribute_code, value_bool, case_id)
);
```

Ini bukan model yang selalu indah, tetapi jauh lebih queryable daripada scan JSON untuk dynamic filter.

---

## 21. Performance Considerations

### 21.1 JSON Function di WHERE Bisa Mahal

Query:

```sql
SELECT id
FROM case_record
WHERE attributes ->> '$.riskLevel' = 'HIGH';
```

Jika tidak ada index expression/generated column, database bisa harus mengevaluasi expression untuk banyak row.

Pada table besar, ini mahal.

### 21.2 JSON Besar Memperbesar Working Set

Jika row membawa JSON besar, page InnoDB bisa memuat lebih sedikit row efektif. Ini berdampak ke:

- buffer pool hit rate,
- read amplification,
- backup size,
- replication throughput,
- redo/binlog volume,
- network transfer.

### 21.3 Partial Update Tetap Berbiaya

Walaupun MySQL punya fungsi update JSON, jangan menganggap update satu path selalu ringan secara sistemik. Tetap ada transaksi, log, replication, dan locking.

### 21.4 Generated/Functional Index Menambah Write Cost

Setiap insert/update yang mengubah JSON field terkait harus menjaga index expression.

Jika kamu mengindeks banyak path JSON:

```sql
riskLevel
region
priority
source
category
dueDate
externalType
```

maka kamu pada dasarnya sedang mengakui bahwa field-field itu adalah schema. Pertimbangkan naikkan ke kolom biasa.

---

## 22. Observability untuk JSON dan Search

Pantau:

- slow query dengan JSON functions,
- statement digest untuk expression berulang,
- `EXPLAIN ANALYZE`,
- index usage,
- rows examined,
- temp table usage,
- filesort,
- generated column index selectivity,
- table size growth,
- average row length,
- binlog growth,
- replication lag setelah update JSON besar,
- search endpoint p95/p99.

Query smell:

```sql
WHERE JSON_EXTRACT(...)
ORDER BY JSON_EXTRACT(...)
```

Smell lain:

```sql
WHERE attributes LIKE '%something%'
```

Ini hampir selalu tanda desain search yang buruk.

---

## 23. Checklist Keputusan: JSON atau Kolom Biasa?

Gunakan kolom biasa jika jawabannya “ya”:

- Apakah field dipakai di WHERE penting?
- Apakah field dipakai di ORDER BY?
- Apakah field dipakai di JOIN?
- Apakah field perlu foreign key?
- Apakah field perlu unique constraint?
- Apakah field menentukan state transition?
- Apakah field menentukan SLA/escalation?
- Apakah field masuk report reguler?
- Apakah field perlu audit perubahan per nilai?
- Apakah field dipakai authorization?
- Apakah field perlu retention/legal hold berbeda?
- Apakah field wajib dan type-nya stabil?

Gunakan JSON jika:

- field optional,
- tidak sering difilter,
- tidak menjadi invariant utama,
- tidak butuh FK,
- tidak butuh unique constraint,
- schema bisa berubah,
- payload perlu disimpan utuh,
- digunakan sebagai extension/snapshot,
- ukuran dokumen terkendali,
- query pattern terbatas.

Gunakan generated/functional index jika:

- field masih di JSON,
- perlu query terbatas,
- field belum cukup stabil untuk dipromosikan,
- kamu sadar biaya write/index,
- expression dikontrol ketat.

Gunakan search engine jika:

- search lintas banyak field/entity,
- butuh relevance/fuzzy/highlight/facet,
- search traffic besar,
- search tidak boleh membebani OLTP primary,
- eventual consistency dapat diterima.

---

## 24. Case Study: Regulatory Case Attribute Design

Misalkan sistem enforcement lifecycle menyimpan case dengan atribut:

- case type,
- status,
- risk level,
- assigned unit,
- SLA due date,
- subject metadata,
- violation tags,
- dynamic form answers,
- external intelligence payload,
- officer notes.

Desain buruk:

```sql
CREATE TABLE case_record (
    id BIGINT PRIMARY KEY,
    attributes JSON NOT NULL
);
```

Semua disimpan di JSON.

Masalah akan muncul saat perlu:

- dashboard open case per unit,
- queue high risk due soon,
- report violation type per quarter,
- search by subject alias,
- audit assignment,
- retention by case type,
- escalation based on due date,
- permission by assigned unit,
- legal hold by investigation status.

Desain lebih baik:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_no VARCHAR(64) NOT NULL,
    case_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    risk_level VARCHAR(16) NOT NULL,
    assigned_unit_id BIGINT NULL,
    opened_at TIMESTAMP NOT NULL,
    sla_due_at TIMESTAMP NULL,
    legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
    extension JSON NULL,

    UNIQUE KEY uk_case_no (case_no),
    KEY idx_queue (status, risk_level, assigned_unit_id, sla_due_at, id),
    KEY idx_type_opened (case_type, opened_at, id),
    KEY idx_legal_hold (legal_hold, id)
);

CREATE TABLE case_tag (
    case_id BIGINT NOT NULL,
    tag_code VARCHAR(64) NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (case_id, tag_code),
    KEY idx_tag_case (tag_code, case_id)
);

CREATE TABLE case_note (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT KEY ft_note (note_text),
    KEY idx_case_note (case_id, created_at)
);

CREATE TABLE case_external_payload (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    source_system VARCHAR(64) NOT NULL,
    source_ref VARCHAR(128) NULL,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload JSON NOT NULL,
    KEY idx_case_payload (case_id, received_at),
    KEY idx_source_ref (source_system, source_ref)
);
```

Ini memberi:

- operational query cepat,
- audit lebih jelas,
- search note sederhana,
- payload eksternal tetap utuh,
- extension tetap fleksibel,
- relationship penting tidak disembunyikan.

---

## 25. Cara Berpikir Top 1% Engineer

Engineer biasa bertanya:

> “Bisa disimpan di JSON nggak?”

Engineer kuat bertanya:

> “Apa field ini invariant, query dimension, audit evidence, relationship, atau hanya extension?”

Engineer biasa bertanya:

> “Bisa diquery pakai JSON_EXTRACT nggak?”

Engineer kuat bertanya:

> “Berapa row yang akan dievaluasi, apakah expression bisa diindex, bagaimana selectivity-nya, dan apa dampaknya ke write path?”

Engineer biasa bertanya:

> “Bisa full-text di MySQL nggak?”

Engineer kuat bertanya:

> “Apakah kebutuhan search ini operational lookup, exact filter, simple text search, atau relevance engine?”

Engineer biasa menyimpan semua dynamic data di JSON.

Engineer kuat membuat boundary:

```text
Relational core
    untuk invariant, lifecycle, query utama, authorization, SLA, reporting

JSON extension
    untuk metadata fleksibel, raw payload, snapshot, non-critical attributes

Projection tables
    untuk dynamic fields yang perlu difilter secara typed dan indexed

Search index
    untuk full-text/fuzzy/facet/relevance workload
```

---

## 26. Praktik Latihan

### Latihan 1 — Klasifikasi Field

Ambil entity `case_record` dan klasifikasikan field berikut:

- `caseNo`
- `status`
- `riskLevel`
- `assignedUnitId`
- `externalPayload`
- `uiHints`
- `sourceSystemRawResponse`
- `customFormAnswer.heightenedRiskReason`
- `legalHold`
- `tags`
- `subjectAliases`

Untuk tiap field, tentukan:

- kolom biasa,
- JSON,
- child table,
- generated column,
- projection table,
- search index.

### Latihan 2 — Index JSON Path

Buat table dengan kolom JSON `attributes`, lalu tambahkan generated column `risk_level` dan index.

Uji:

```sql
EXPLAIN ANALYZE
SELECT id
FROM case_record
WHERE risk_level = 'HIGH';
```

Bandingkan dengan:

```sql
EXPLAIN ANALYZE
SELECT id
FROM case_record
WHERE attributes ->> '$.riskLevel' = 'HIGH';
```

### Latihan 3 — Design Search Boundary

Desain endpoint:

```text
GET /cases/search
```

Dengan filter:

- status,
- riskLevel,
- assignedUnit,
- openedFrom/openedTo,
- text keyword,
- tag,
- dynamic form field.

Pisahkan mana yang:

- MySQL relational query,
- MySQL full-text,
- projection table,
- external search engine.

---

## 27. Ringkasan

JSON di MySQL adalah alat yang kuat jika digunakan dengan batas yang jelas.

Yang harus kamu ingat:

1. MySQL adalah relational database dengan JSON capability, bukan document database murni.
2. JSON valid tidak sama dengan domain valid.
3. Field yang menjadi invariant/query utama sebaiknya menjadi kolom biasa.
4. Generated column membantu mengekspose JSON field ke index dan optimizer.
5. Functional index berguna, tetapi expression matching harus disiplin.
6. Multi-valued index membantu JSON array membership, tetapi bukan pengganti relationship table untuk domain penting.
7. `JSON_TABLE()` berguna untuk transformasi/ad-hoc, bukan selalu untuk workload intensif.
8. MySQL full-text cukup untuk search sederhana, bukan search platform penuh.
9. Search engine eksternal adalah projection, bukan source of truth.
10. Untuk sistem Java production, JSON path harus dikapsulasi, divalidasi, dan diberi schema version jika long-lived.

Prinsip akhir:

> Simpan struktur domain sebagai struktur domain. Gunakan JSON untuk fleksibilitas yang sadar batas, bukan untuk menunda desain.

---

## 28. Referensi Resmi dan Lanjutan

- MySQL 8.4 Reference Manual — The JSON Data Type
- MySQL 8.4 Reference Manual — JSON Search Functions
- MySQL 8.4 Reference Manual — JSON Table Functions
- MySQL 8.4 Reference Manual — Generated Columns
- MySQL 8.4 Reference Manual — Secondary Indexes and Generated Columns
- MySQL Reference Manual — CREATE INDEX and Multi-Valued Indexes
- MySQL Reference Manual — Full-Text Search Functions
- Oracle MySQL Blog — Indexing JSON Data in MySQL

---

## 29. Status Seri

Kamu sudah menyelesaikan:

- Part 000 — Orientation
- Part 001 — MySQL Architecture
- Part 002 — InnoDB Storage Model
- Part 003 — Primary Key Design
- Part 004 — MySQL Data Types
- Part 005 — Character Sets and Collations
- Part 006 — InnoDB MVCC
- Part 007 — Isolation Levels
- Part 008 — InnoDB Locking
- Part 009 — Deadlocks and Lock Wait Timeouts
- Part 010 — Index Internals
- Part 011 — Designing Indexes for Real Workloads
- Part 012 — MySQL Optimizer
- Part 013 — Query Execution Patterns
- Part 014 — Pagination, Search, Filtering
- Part 015 — Transactions in Java Applications
- Part 016 — JDBC, Connector/J, HikariCP
- Part 017 — Write Path Internals
- Part 018 — Buffer Pool, Memory, and I/O Behavior
- Part 019 — Configuration That Actually Matters
- Part 020 — Binary Log and Replication Fundamentals
- Part 021 — Replication Lag and Read/Write Splitting
- Part 022 — High Availability
- Part 023 — Backup, Restore, PITR, and DR
- Part 024 — Schema Migration Without Downtime
- Part 025 — Metadata Locks
- Part 026 — Security
- Part 027 — Observability
- Part 028 — Debugging Production Incidents
- Part 029 — Application-Level Concurrency Patterns
- Part 030 — Partitioning, Archiving, Retention, and Large Tables
- Part 031 — JSON, Generated Columns, Full-Text, and Semi-Structured Data

Seri belum selesai.

Bagian berikutnya:

`learn-mysql-mastery-for-java-engineers-part-032.md` — **MySQL in Distributed Systems and Microservices**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Partitioning, Archiving, Retention, and Large Tables</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-032.md">Part 032 — MySQL in Distributed Systems and Microservices ➡️</a>
</div>
