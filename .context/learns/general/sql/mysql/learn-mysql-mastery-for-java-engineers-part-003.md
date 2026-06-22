# learn-mysql-mastery-for-java-engineers-part-003.md

# Part 003 — Primary Key Design in MySQL: The Hidden Architecture Decision

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `003 / 034`  
> Topik: Primary key design di MySQL/InnoDB untuk Java engineer  
> Fokus: clustered index, secondary index amplification, ID generation, concurrency, distributed systems, dan mapping ke aplikasi Java.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa menjawab pertanyaan berikut dengan percaya diri:

1. Kenapa pemilihan primary key di MySQL bukan sekadar urusan “kolom ID”?  
2. Kenapa InnoDB sangat peduli terhadap primary key?  
3. Apa efek primary key terhadap physical layout, secondary index, insert throughput, page split, cache locality, dan replication?  
4. Kapan memakai `AUTO_INCREMENT`, UUID, UUID binary, ULID, Snowflake-style ID, composite key, atau natural key?  
5. Bagaimana primary key memengaruhi desain entity Java, JPA/Hibernate, Spring Data, batch insert, optimistic locking, dan event-driven architecture?  
6. Bagaimana merancang primary key untuk sistem regulatory/case-management yang punya lifecycle, audit, escalation, dan cross-entity relationship?

Bagian ini sengaja dibuat sebagai “arsitektur tersembunyi” karena banyak engineer menganggap primary key hanya sebagai identifier logis, padahal di InnoDB primary key adalah keputusan fisik.

---

## 1. Premis Utama: Di InnoDB, Primary Key Adalah Layout Table

Di banyak diskusi database, primary key dijelaskan sebagai:

> Kolom yang mengidentifikasi row secara unik.

Itu benar, tapi terlalu dangkal untuk MySQL/InnoDB.

Di InnoDB, table disimpan sebagai clustered index. Artinya, row data tidak disimpan sebagai heap terpisah yang kemudian ditunjuk oleh primary key. Row data berada di leaf page dari clustered index itu sendiri.

Dengan kata lain:

```text
InnoDB table ≈ B+Tree berdasarkan primary key
```

Jika table punya primary key, clustered index biasanya adalah primary key tersebut. Secondary index tidak menunjuk ke physical row address, melainkan menyimpan nilai primary key sebagai pointer logis menuju row di clustered index.

Konsekuensinya besar:

```text
Primary key memengaruhi:
- urutan fisik row
- ukuran semua secondary index
- biaya lookup dari secondary index ke row
- insert locality
- page split
- buffer pool efficiency
- replication determinism
- sharding/distributed ID strategy
- ORM mapping
```

Referensi resmi MySQL menjelaskan bahwa setiap table InnoDB memiliki clustered index yang menyimpan row data, dan clustered index biasanya identik dengan primary key. MySQL juga menjelaskan bahwa secondary index menyimpan primary key value untuk menemukan row di clustered index.

---

## 2. Mental Model: Table InnoDB sebagai B+Tree

Bayangkan table berikut:

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_number VARCHAR(64) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_number (case_number),
    KEY idx_subject_status_created (subject_id, status, created_at)
) ENGINE=InnoDB;
```

Secara logis, kamu melihat table seperti kumpulan row.

Secara fisik, InnoDB melihatnya kira-kira seperti ini:

```text
Clustered index PRIMARY(id)

Root page
  └── Internal pages
        └── Leaf pages berisi row lengkap:
            [id=1, case_number=..., subject_id=..., status=..., ...]
            [id=2, case_number=..., subject_id=..., status=..., ...]
            [id=3, case_number=..., subject_id=..., status=..., ...]
```

Secondary index `uk_case_number` kira-kira seperti ini:

```text
Secondary index uk_case_number(case_number)

Leaf entry:
  case_number -> primary_key(id)

CASE-2026-000001 -> 1
CASE-2026-000002 -> 2
CASE-2026-000003 -> 3
```

Secondary index `idx_subject_status_created` kira-kira seperti ini:

```text
(subject_id, status, created_at) -> id
```

Jadi jika query memakai secondary index:

```sql
SELECT *
FROM enforcement_case
WHERE case_number = 'CASE-2026-000001';
```

Alurnya:

```text
1. Cari 'CASE-2026-000001' di secondary index uk_case_number
2. Dapat id = 1
3. Cari id = 1 di clustered index
4. Ambil row lengkap
```

Ini disebut secondary index lookup followed by clustered index lookup.

Kalau query hanya butuh kolom yang sudah ada di secondary index, MySQL bisa melakukan covering index scan dan tidak perlu balik ke clustered index.

---

## 3. Mengapa Primary Key yang Besar Itu Mahal

Karena nilai primary key disimpan di setiap secondary index entry.

Misalnya table punya:

```text
10 secondary indexes
100 juta row
primary key BIGINT = 8 byte
```

Maka secara kasar nilai primary key ikut muncul di semua secondary index:

```text
100 juta row × 10 index × 8 byte = 8 GB raw PK payload
```

Itu belum termasuk overhead B+Tree, page metadata, alignment, fragmentation, dan internal structure.

Sekarang bandingkan dengan UUID string:

```sql
id CHAR(36) NOT NULL
```

```text
100 juta row × 10 index × 36 byte = 36 GB raw PK payload
```

Jika memakai `utf8mb4`, `CHAR(36)` bisa lebih mahal lagi dalam konteks storage/indexing dan comparison cost daripada angka 8-byte. Bahkan jika secara internal fixed-length tidak selalu berarti 4x untuk setiap karakter dalam semua kondisi, prinsipnya tetap: primary key panjang memperbesar semua secondary index.

Itu berarti:

```text
PK besar -> secondary index lebih besar
secondary index lebih besar -> lebih banyak page
lebih banyak page -> buffer pool pressure lebih tinggi
buffer pool pressure lebih tinggi -> lebih banyak disk I/O
lebih banyak disk I/O -> latency lebih tinggi
```

Primary key bukan hanya ukuran di table utama. Ia adalah multiplier.

---

## 4. Tiga Dimensi Primary Key

Saat memilih primary key, pikirkan dalam tiga dimensi:

```text
1. Logical identity
   Apakah nilai ini secara bisnis mengidentifikasi entity?

2. Physical clustering
   Bagaimana nilai ini mengatur urutan row di B+Tree?

3. Distributed generation
   Siapa yang menghasilkan nilai ini, kapan, dan di node mana?
```

Banyak desain gagal karena hanya melihat dimensi pertama.

Contoh:

```text
“UUID bagus karena globally unique.”
```

Itu benar di dimensi distributed generation. Tapi secara physical clustering, UUID random bisa buruk karena insert tersebar ke banyak page.

Contoh lain:

```text
“AUTO_INCREMENT bagus karena cepat.”
```

Itu benar untuk locality dan ukuran. Tapi secara distributed generation, ia lebih terikat ke database primary dan kurang nyaman jika entity ID harus diketahui sebelum insert atau dibuat di banyak service.

Top 1% engineer tidak bertanya:

> “Mana ID terbaik?”

Tapi bertanya:

> “Trade-off ID ini terhadap clustering, indexing, concurrency, replication, service boundary, observability, dan domain invariants apa?”

---

## 5. AUTO_INCREMENT: Default yang Sering Benar, Tapi Tidak Selalu

### 5.1 Apa itu AUTO_INCREMENT?

`AUTO_INCREMENT` membuat MySQL menghasilkan angka unik ketika row baru dimasukkan.

Contoh:

```sql
CREATE TABLE officer_assignment (
    id BIGINT NOT NULL AUTO_INCREMENT,
    officer_id BIGINT NOT NULL,
    case_id BIGINT NOT NULL,
    assigned_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB;
```

Insert:

```sql
INSERT INTO officer_assignment (officer_id, case_id, assigned_at)
VALUES (1001, 90001, NOW(6));
```

MySQL mengisi `id`.

### 5.2 Kelebihan AUTO_INCREMENT

#### 1. Kecil

Biasanya memakai `BIGINT`, 8 byte.

```sql
id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
```

Ini jauh lebih kecil daripada UUID string.

#### 2. Sequential-ish

Nilai meningkat, sehingga insert cenderung terjadi di ujung kanan B+Tree clustered index.

```text
id=1
id=2
id=3
...
id=N
```

Efeknya:

```text
lebih sedikit page split acak
cache locality lebih baik
insert path lebih predictable
secondary index payload kecil
```

#### 3. Sederhana untuk aplikasi Java

Mapping mudah:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Dengan JDBC:

```java
PreparedStatement ps = connection.prepareStatement(
    "INSERT INTO enforcement_case (case_number, status, created_at) VALUES (?, ?, ?)",
    Statement.RETURN_GENERATED_KEYS
);
```

#### 4. Baik untuk single-primary OLTP

Untuk banyak sistem internal enterprise, case management, workflow, backoffice, admin platform, dan regulatory systems, single-primary database masih sangat umum dan cukup.

AUTO_INCREMENT sering menjadi pilihan sangat baik.

### 5.3 Kekurangan AUTO_INCREMENT

#### 1. ID baru diketahui setelah insert

Jika aplikasi butuh ID sebelum insert, misalnya untuk membuat event, file path, object storage key, atau cross-service command, `AUTO_INCREMENT` bisa kurang nyaman.

#### 2. Terikat ke database writer

Karena ID dibuat database, service perlu koneksi ke primary database untuk menghasilkan entity identity.

#### 3. Predictable

ID incremental mudah ditebak.

Untuk external-facing resource, jangan expose internal numeric ID mentah jika enumeration risk penting.

Contoh buruk:

```text
GET /cases/10001
GET /cases/10002
GET /cases/10003
```

Solusi umum:

```text
internal_id BIGINT primary key
public_id UUID/ULID/case_number unique external identifier
```

#### 4. Insert hotspot

Karena insert selalu ke kanan B+Tree, page terakhir menjadi hot area. Untuk workload umum ini justru bagus. Tapi pada extreme write concurrency, rightmost page/index contention bisa menjadi perhatian.

Namun jangan terlalu cepat menganggap ini masalah. Random UUID sering menciptakan masalah lebih besar: page split acak dan buffer churn.

#### 5. Multi-primary replication perlu konfigurasi khusus

Dalam topologi multi-writer, auto-increment perlu strategi agar tidak bentrok, misalnya offset/increment. Tapi multi-primary sendiri membawa kompleksitas besar dan bukan default yang aman untuk banyak sistem.

---

## 6. BIGINT vs INT untuk AUTO_INCREMENT

Kesalahan umum:

```sql
id INT NOT NULL AUTO_INCREMENT
```

`INT` signed maksimum sekitar 2.1 miliar. Untuk sistem kecil mungkin cukup, tapi banyak sistem tumbuh lebih lama daripada perkiraan.

Gunakan:

```sql
id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
```

Kapasitas `BIGINT UNSIGNED` sangat besar. Biaya tambahan dibanding `INT` adalah 4 byte per key, tapi biasanya worth it untuk table inti yang long-lived.

Rekomendasi praktis:

```text
Untuk production system jangka panjang:
- entity utama: BIGINT UNSIGNED AUTO_INCREMENT
- table event/audit/log bisnis: BIGINT UNSIGNED AUTO_INCREMENT atau time-sortable distributed ID
- lookup kecil/statis: INT bisa diterima
```

Namun di Java, hati-hati karena Java tidak punya unsigned primitive `long` yang natural untuk domain. Banyak tim tetap memakai `BIGINT` signed untuk kemudahan mapping ke `Long`.

Trade-off:

```text
BIGINT signed:
+ mudah di Java Long
+ cukup besar untuk hampir semua use case
- setengah range unsigned

BIGINT unsigned:
+ range maksimal
- perlu hati-hati mapping jika mendekati Long.MAX_VALUE
```

Dalam praktik enterprise, `BIGINT` signed sering sudah cukup.

---

## 7. UUID: Bukan Salah, Tapi Harus Dipakai dengan Sadar

### 7.1 Kenapa UUID menarik?

UUID menarik karena:

```text
- bisa dibuat di aplikasi
- globally unique secara probabilistik
- tidak perlu round-trip ke database untuk ID
- cocok untuk distributed systems
- aman untuk expose sebagai public identifier relatif terhadap sequential ID
- memudahkan offline creation
```

Contoh Java:

```java
UUID id = UUID.randomUUID();
```

Schema naive:

```sql
CREATE TABLE enforcement_case (
    id CHAR(36) NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB;
```

Ini sering menjadi desain buruk untuk InnoDB jika table besar dan write-heavy.

### 7.2 Problem UUID random sebagai primary key

UUID v4 random menyebabkan insert tersebar di seluruh B+Tree.

```text
Insert 1 -> page tengah
Insert 2 -> page kiri
Insert 3 -> page kanan
Insert 4 -> page tengah lain
```

Efek:

```text
- page split lebih sering
- locality buruk
- buffer pool churn
- random I/O lebih tinggi
- clustered index fragmentasi lebih tinggi
- secondary indexes membesar jika UUID disimpan sebagai CHAR(36)
```

Untuk table kecil, ini tidak terasa. Untuk table besar, write-heavy, dan banyak secondary index, ini bisa signifikan.

### 7.3 Jangan simpan UUID sebagai CHAR(36) jika performa/storage penting

`CHAR(36)` menyimpan textual representation:

```text
550e8400-e29b-41d4-a716-446655440000
```

Lebih baik simpan sebagai `BINARY(16)` jika UUID menjadi key penting.

```sql
CREATE TABLE document_ref (
    id BINARY(16) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB;
```

Di MySQL tersedia fungsi seperti `UUID_TO_BIN()` dan `BIN_TO_UUID()` untuk konversi.

Contoh:

```sql
INSERT INTO document_ref (id, file_name, created_at)
VALUES (UUID_TO_BIN(UUID()), 'case-evidence.pdf', NOW(6));

SELECT BIN_TO_UUID(id), file_name
FROM document_ref;
```

Untuk UUID time-based, MySQL memiliki opsi swap flag pada `UUID_TO_BIN(uuid, 1)` untuk membuat byte order lebih indeks-friendly terhadap UUID versi tertentu. Jangan pakai swap flag sembarangan untuk UUID random v4 dan pastikan semua read/write memakai konvensi yang sama.

### 7.4 UUID sebagai public ID, BIGINT sebagai primary key

Pattern yang sering bagus:

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    public_id BINARY(16) NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_public_id (public_id),
    UNIQUE KEY uk_case_number (case_number)
) ENGINE=InnoDB;
```

Makna:

```text
id         = internal physical identity, small, clustered, efficient
public_id  = external stable identifier, non-sequential, safe for URL/API
case_number = business identifier, human-readable
```

API:

```text
GET /cases/{publicId}
```

Internal join:

```sql
JOIN enforcement_action ea ON ea.case_id = c.id
```

Ini sering menjadi desain terbaik untuk enterprise Java systems.

---

## 8. UUID Version, ULID, dan Time-Sortable ID

### 8.1 Masalah utama UUID v4

UUID v4 random tidak punya locality.

Masalahnya bukan uniqueness. Masalahnya physical insertion pattern.

### 8.2 Time-sortable ID

Alternatif:

```text
- UUID v7
- ULID
- KSUID
- Snowflake-style ID
```

Karakteristik umum:

```text
- mengandung komponen waktu
- roughly sortable by creation time
- bisa dibuat di aplikasi
- lebih baik untuk clustered insertion daripada random UUID
```

Tapi ada detail penting:

```text
Time-sortable ID yang disimpan sebagai string belum tentu optimal.
BINARY representation biasanya lebih efisien.
```

### 8.3 ULID

ULID biasanya 128-bit dengan timestamp + randomness dan textual representation 26 karakter Crockford base32.

Kelebihan:

```text
+ sortable secara lexical jika format konsisten
+ bisa dibuat aplikasi
+ lebih pendek daripada UUID string
+ external-friendly
```

Kekurangan:

```text
- masih lebih besar daripada BIGINT
- string comparison lebih mahal daripada integer
- concurrency tinggi dalam timestamp sama tetap bergantung pada random component
- library consistency perlu dijaga
```

Schema opsi:

```sql
public_id CHAR(26) NOT NULL
```

atau representasi binary/custom jika ingin optimal.

### 8.4 UUID v7

UUID v7 dirancang time-ordered. Untuk workload yang butuh UUID-compatible identifier tapi lebih indeks-friendly daripada v4, UUID v7 sering menarik.

Namun pastikan:

```text
- library Java yang dipakai benar
- byte order penyimpanan konsisten
- query/debugging tetap nyaman
- external representation standar
```

### 8.5 Snowflake-style ID

Snowflake-style ID biasanya 64-bit integer berisi:

```text
timestamp bits + worker/node id + sequence bits
```

Kelebihan:

```text
+ muat dalam BIGINT
+ sortable by time
+ generated di aplikasi/service
+ lebih kecil daripada UUID/ULID
+ bagus untuk secondary index payload
```

Kekurangan:

```text
- butuh worker ID coordination
- clock skew risk
- sequence overflow per millisecond
- operational complexity
- format custom
```

Cocok untuk:

```text
- high-throughput event table
- distributed service needing pre-generated IDs
- systems with mature infra for node ID assignment
```

Tidak cocok jika tim belum siap mengelola clock, worker ID, dan failure mode generator.

---

## 9. Natural Key vs Surrogate Key

### 9.1 Natural key

Natural key berasal dari domain.

Contoh:

```text
case_number
license_number
national_identifier
email
regulatory_filing_number
```

Schema:

```sql
CREATE TABLE enforcement_case (
    case_number VARCHAR(64) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (case_number)
) ENGINE=InnoDB;
```

### 9.2 Kenapa natural key menggoda?

Karena terasa “bermakna”.

```text
CASE-2026-OJK-00000001
```

Engineer bisa langsung melihat identitas bisnisnya.

### 9.3 Risiko natural key sebagai primary key

#### 1. Bisa berubah

Banyak “natural key” ternyata tidak immutable.

```text
email bisa berubah
case number bisa dikoreksi
license number bisa reissued
external reference bisa berubah format
```

Primary key yang berubah mahal, karena semua child table dan secondary index harus ikut terdampak.

#### 2. Panjang

Natural key sering string panjang. Karena primary key ikut masuk ke secondary index, ini memperbesar semua secondary index.

#### 3. Mengandung policy/domain semantics

Jika business rule berubah, key ikut berubah.

Primary key idealnya stabil melampaui perubahan policy.

#### 4. Composite natural key lebih berat

Contoh:

```sql
PRIMARY KEY (regulator_code, year, sequence_number)
```

Ini bisa masuk akal untuk beberapa table, tapi jika menjadi foreign key di banyak table, semua child table membawa tiga kolom.

### 9.4 Pattern yang sering lebih baik

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_number VARCHAR(64) NOT NULL,
    regulator_code VARCHAR(16) NOT NULL,
    year SMALLINT NOT NULL,
    sequence_number BIGINT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_number (case_number),
    UNIQUE KEY uk_case_regulator_year_seq (regulator_code, year, sequence_number)
) ENGINE=InnoDB;
```

Makna:

```text
id = stable physical identity
case_number = business identity
(regulator_code, year, sequence_number) = domain uniqueness rule
```

Jangan hilangkan uniqueness domain. Pindahkan dari primary key ke unique constraint jika lebih tepat.

---

## 10. Composite Primary Key

Composite primary key berarti primary key terdiri dari beberapa kolom.

Contoh:

```sql
CREATE TABLE case_tag (
    case_id BIGINT NOT NULL,
    tag_id BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (case_id, tag_id)
) ENGINE=InnoDB;
```

Ini masuk akal untuk join table many-to-many.

### 10.1 Kapan composite primary key bagus?

Composite primary key bagus jika:

```text
- table secara natural adalah relationship table
- akses dominan mengikuti prefix key
- key relatif kecil
- key immutable
- tidak banyak table lain mereferensikan row ini
```

Contoh bagus:

```sql
CREATE TABLE officer_case_assignment (
    case_id BIGINT NOT NULL,
    officer_id BIGINT NOT NULL,
    role_code VARCHAR(32) NOT NULL,
    assigned_at DATETIME(6) NOT NULL,
    PRIMARY KEY (case_id, officer_id, role_code)
) ENGINE=InnoDB;
```

Jika akses utama:

```sql
SELECT *
FROM officer_case_assignment
WHERE case_id = ?;
```

Maka clustering by `case_id` bagus karena assignment satu case berdekatan.

### 10.2 Kapan composite primary key buruk?

Composite primary key buruk jika:

```text
- terlalu panjang
- dipakai sebagai foreign key oleh banyak table
- salah urutan kolom terhadap query pattern
- mengandung string panjang
- mengandung mutable business attribute
- ORM menjadi rumit tanpa manfaat jelas
```

Contoh rawan:

```sql
PRIMARY KEY (tenant_code, regulatory_program_code, case_number, action_number)
```

Jika child table banyak, semua foreign key perlu membawa empat kolom. Secondary index juga membawa empat kolom ini sebagai row locator.

### 10.3 Composite PK dan leftmost prefix

Primary key `(case_id, event_seq)` cocok untuk:

```sql
WHERE case_id = ?
WHERE case_id = ? AND event_seq = ?
ORDER BY case_id, event_seq
```

Tapi tidak ideal untuk:

```sql
WHERE event_seq = ?
```

Karena `event_seq` bukan leftmost prefix.

Untuk event table:

```sql
CREATE TABLE case_event (
    case_id BIGINT NOT NULL,
    event_seq BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (case_id, event_seq),
    KEY idx_case_event_occurred (occurred_at)
) ENGINE=InnoDB;
```

Ini bagus jika event selalu dibaca per case:

```sql
SELECT *
FROM case_event
WHERE case_id = ?
ORDER BY event_seq;
```

Tapi jika sering mencari event global berdasarkan waktu, perlu index tambahan.

---

## 11. Primary Key untuk Audit Trail dan Event Table

Audit/event table biasanya punya karakteristik:

```text
- append-heavy
- jumlah row sangat besar
- jarang update
- sering query by aggregate/entity id
- sering query by occurred_at
- perlu retention/archiving
```

Ada beberapa desain.

### 11.1 Desain A: Global auto-increment ID

```sql
CREATE TABLE audit_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    actor_id BIGINT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (id),
    KEY idx_audit_aggregate (aggregate_type, aggregate_id, occurred_at),
    KEY idx_audit_occurred (occurred_at)
) ENGINE=InnoDB;
```

Kelebihan:

```text
+ insert locality bagus
+ PK kecil
+ simple
+ global event ordering approximate by insert order
```

Kekurangan:

```text
- query per aggregate perlu secondary index
- occurred_at order tidak selalu sama dengan id order
- ID hanya diketahui setelah insert
```

### 11.2 Desain B: Composite PK per aggregate

```sql
CREATE TABLE case_event (
    case_id BIGINT NOT NULL,
    event_seq BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    actor_id BIGINT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (case_id, event_seq),
    KEY idx_case_event_occurred (occurred_at)
) ENGINE=InnoDB;
```

Kelebihan:

```text
+ event per case clustered bersama
+ read lifecycle per case sangat efisien
+ event_seq menjadi invariant domain
```

Kekurangan:

```text
- perlu generate sequence per case
- concurrent append ke case yang sama perlu kontrol
- query global by time butuh secondary index
```

### 11.3 Desain C: Time-sortable distributed ID

```sql
CREATE TABLE audit_event (
    id BIGINT NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (id),
    KEY idx_audit_aggregate (aggregate_type, aggregate_id, occurred_at)
) ENGINE=InnoDB;
```

`id` dibuat oleh aplikasi memakai Snowflake-style generator.

Kelebihan:

```text
+ ID diketahui sebelum insert
+ roughly ordered by time
+ kecil
+ cocok untuk distributed producer
```

Kekurangan:

```text
- generator complexity
- clock skew
- worker ID management
```

---

## 12. Primary Key dan Foreign Key

Primary key yang baik membuat foreign key murah.

Contoh:

```sql
CREATE TABLE enforcement_action (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    issued_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_action_case (case_id),
    CONSTRAINT fk_action_case
        FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE=InnoDB;
```

Jika `enforcement_case.id` adalah `BIGINT`, child table cukup menyimpan 8 byte.

Jika primary key parent adalah `CHAR(64)` case number, child table harus membawa string itu.

```sql
case_number VARCHAR(64) NOT NULL
```

Efek:

```text
- child table lebih besar
- index child lebih besar
- join comparison lebih mahal
- cache locality lebih buruk
```

Untuk domain yang punya banyak relationship, surrogate numeric key sering lebih baik secara fisik.

---

## 13. Primary Key dan Multi-Tenancy

Misalnya sistem multi-tenant:

```text
tenant_id
case_id
```

Ada beberapa opsi.

### 13.1 Opsi A: Global ID sebagai PK

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_tenant_case_number (tenant_id, case_number),
    KEY idx_tenant_status_created (tenant_id, status, created_at)
) ENGINE=InnoDB;
```

Kelebihan:

```text
+ PK kecil
+ FK sederhana
+ JPA mudah
+ global row identity mudah
```

Kekurangan:

```text
- tenant locality tidak otomatis di clustered index
- query per tenant harus punya secondary index yang benar
```

### 13.2 Opsi B: Composite PK `(tenant_id, id)`

```sql
CREATE TABLE enforcement_case (
    tenant_id BIGINT NOT NULL,
    id BIGINT NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE KEY uk_tenant_case_number (tenant_id, case_number)
) ENGINE=InnoDB;
```

Kelebihan:

```text
+ rows per tenant clustered together
+ natural for tenant-scoped access
+ can enforce tenant boundary in PK/FK
```

Kekurangan:

```text
- FK child lebih panjang
- secondary index membawa tenant_id + id
- ORM lebih rumit
- ID generation per tenant perlu dipikirkan
```

### 13.3 Opsi C: Global PK + tenant-aware unique/index

Ini sering paling seimbang:

```sql
PRIMARY KEY (id)
UNIQUE KEY uk_tenant_case_number (tenant_id, case_number)
KEY idx_tenant_status_created (tenant_id, status, created_at)
```

Dengan aturan aplikasi:

```text
Semua query tenant-scoped harus include tenant_id.
```

Dan bisa diperkuat dengan repository/service invariant.

---

## 14. Primary Key dan Regulatory Case Management

Untuk sistem regulatory enforcement lifecycle, biasanya ada entity seperti:

```text
- case
- subject / regulated entity
- allegation
- evidence
- enforcement action
- decision
- appeal
- payment / penalty
- audit event
- assignment
- escalation
- SLA timer
```

### 14.1 Case table

Recommended baseline:

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    public_id BINARY(16) NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    tenant_id BIGINT NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    opened_at DATETIME(6) NOT NULL,
    closed_at DATETIME(6) NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_public_id (public_id),
    UNIQUE KEY uk_case_tenant_number (tenant_id, case_number),
    KEY idx_case_subject (subject_id),
    KEY idx_case_tenant_status_opened (tenant_id, status, opened_at),
    KEY idx_case_tenant_severity_status (tenant_id, severity, status)
) ENGINE=InnoDB;
```

Rationale:

```text
id:
  internal clustered identity, small and stable

public_id:
  external API identity

case_number:
  human/legal/business identity

tenant_id + case_number:
  domain uniqueness

version:
  optimistic locking
```

### 14.2 Case event table

Jika event dibaca dominan per case:

```sql
CREATE TABLE case_event (
    case_id BIGINT NOT NULL,
    event_seq BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    actor_user_id BIGINT NULL,
    occurred_at DATETIME(6) NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (case_id, event_seq),
    KEY idx_case_event_occurred (occurred_at),
    CONSTRAINT fk_case_event_case
        FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE=InnoDB;
```

Rationale:

```text
- lifecycle event per case clustered bersama
- event_seq memberikan urutan legal/audit per case
- occurred_at tetap bisa dipakai untuk reporting/retention
```

### 14.3 Assignment table

```sql
CREATE TABLE case_assignment (
    case_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    role_code VARCHAR(32) NOT NULL,
    assigned_at DATETIME(6) NOT NULL,
    unassigned_at DATETIME(6) NULL,
    PRIMARY KEY (case_id, user_id, role_code),
    KEY idx_assignment_user_active (user_id, unassigned_at, assigned_at),
    CONSTRAINT fk_assignment_case
        FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE=InnoDB;
```

Composite PK masuk akal karena assignment adalah relationship.

### 14.4 Escalation/SLA table

```sql
CREATE TABLE case_sla_timer (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    timer_type VARCHAR(64) NOT NULL,
    due_at DATETIME(6) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    completed_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_timer_type_active (case_id, timer_type, status),
    KEY idx_sla_due_status (status, due_at),
    CONSTRAINT fk_sla_case
        FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE=InnoDB;
```

Kenapa bukan PK `(case_id, timer_type)`?

Karena timer bisa punya lifecycle, retry, re-open, historical timer, dan audit. Surrogate ID memberi ruang evolusi.

---

## 15. Java/JPA Mapping Implications

### 15.1 `GenerationType.IDENTITY`

Dengan MySQL `AUTO_INCREMENT`, JPA sering memakai:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Kelebihan:

```text
+ simple
+ sesuai MySQL auto-increment
```

Kekurangan penting:

```text
- ID baru diketahui setelah insert
- Hibernate sering perlu immediate insert untuk mendapatkan ID
- batch insert bisa kurang optimal dibanding sequence-based database
```

MySQL tidak punya sequence object seperti PostgreSQL/Oracle dalam model tradisional yang sama. Karena itu IDENTITY strategy punya konsekuensi terhadap batching.

### 15.2 UUID generated di aplikasi

```java
@Id
private UUID id;

@PrePersist
void prePersist() {
    if (id == null) id = UUID.randomUUID();
}
```

Kelebihan:

```text
+ ID tersedia sebelum persist
+ lebih mudah untuk graph object sebelum flush
+ cocok untuk distributed creation
```

Kekurangan:

```text
- jika menjadi clustered PK random, bisa buruk untuk InnoDB
- mapping BINARY(16) perlu converter/type mapping
```

### 15.3 Hybrid mapping

```java
@Entity
@Table(name = "enforcement_case")
public class EnforcementCase {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "public_id", nullable = false, unique = true)
    private UUID publicId;

    @Column(name = "case_number", nullable = false)
    private String caseNumber;

    @Version
    private long version;

    @PrePersist
    void prePersist() {
        if (publicId == null) {
            publicId = UUID.randomUUID();
        }
    }
}
```

Namun mapping UUID ke `BINARY(16)` perlu dipastikan benar.

Contoh converter konseptual:

```java
public final class UuidBytes {
    public static byte[] toBytes(UUID uuid) {
        ByteBuffer buffer = ByteBuffer.allocate(16);
        buffer.putLong(uuid.getMostSignificantBits());
        buffer.putLong(uuid.getLeastSignificantBits());
        return buffer.array();
    }

    public static UUID fromBytes(byte[] bytes) {
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        return new UUID(buffer.getLong(), buffer.getLong());
    }
}
```

Pastikan byte order konsisten antara Java dan MySQL function jika memakai `UUID_TO_BIN()`.

---

## 16. Batch Insert dan Generated Key

Dengan JDBC:

```java
String sql = """
    INSERT INTO case_event (case_id, event_seq, event_type, occurred_at, payload)
    VALUES (?, ?, ?, ?, ?)
    """;

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    for (CaseEvent event : events) {
        ps.setLong(1, event.caseId());
        ps.setLong(2, event.eventSeq());
        ps.setString(3, event.eventType());
        ps.setTimestamp(4, Timestamp.from(event.occurredAt()));
        ps.setString(5, event.payloadJson());
        ps.addBatch();
    }
    ps.executeBatch();
}
```

Composite key atau application-generated key bisa memudahkan batching karena aplikasi sudah tahu key.

Dengan auto-increment dan generated keys:

```java
try (PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
    // add batch
    ps.executeBatch();

    try (ResultSet keys = ps.getGeneratedKeys()) {
        while (keys.next()) {
            long id = keys.getLong(1);
        }
    }
}
```

Perhatikan:

```text
- driver behavior matters
- JDBC URL options can affect batching
- ORM may not batch as expected with IDENTITY
- generated key retrieval has operational cost
```

Ini akan dibahas lebih detail pada part Connector/J dan Java integration.

---

## 17. Primary Key dan Optimistic Locking

Primary key mengidentifikasi row. Version column mengontrol concurrency.

Jangan campur keduanya.

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    status VARCHAR(32) NOT NULL,
    version BIGINT NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB;
```

Update aman:

```sql
UPDATE enforcement_case
SET status = ?, version = version + 1, updated_at = NOW(6)
WHERE id = ?
  AND version = ?;
```

Jika affected rows = 0:

```text
- row tidak ada, atau
- version sudah berubah
```

Dalam Java:

```java
int updated = jdbcTemplate.update(
    """
    UPDATE enforcement_case
    SET status = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND version = ?
    """,
    newStatus,
    Timestamp.from(now),
    id,
    expectedVersion
);

if (updated == 0) {
    throw new OptimisticConcurrencyException(id);
}
```

Primary key harus stabil. Version yang berubah.

---

## 18. Primary Key dan State Machine

Untuk enforcement lifecycle, state transition harus dilindungi.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'UNDER_REVIEW',
    version = version + 1,
    updated_at = NOW(6)
WHERE id = ?
  AND status = 'OPEN'
  AND version = ?;
```

Di sini:

```text
id      = row identity
status  = domain guard
version = concurrency guard
```

Jangan menggunakan `case_number` sebagai update target jika `id` sudah diketahui internal. Gunakan primary key untuk physical targeting.

Namun tetap enforce business uniqueness:

```sql
UNIQUE KEY uk_case_tenant_number (tenant_id, case_number)
```

---

## 19. Primary Key dan Idempotency

Untuk command processing:

```sql
CREATE TABLE idempotency_key (
    key_hash BINARY(32) NOT NULL,
    scope VARCHAR(64) NOT NULL,
    request_id BINARY(16) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_json JSON NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (scope, key_hash)
) ENGINE=InnoDB;
```

Composite PK cocok karena identity idempotency memang `(scope, key_hash)`.

Insert-first pattern:

```sql
INSERT INTO idempotency_key (
    scope, key_hash, request_id, status, created_at, updated_at
)
VALUES (?, ?, ?, 'PROCESSING', NOW(6), NOW(6));
```

Jika duplicate key:

```text
request sudah pernah diproses atau sedang diproses
```

Di sini primary key adalah concurrency primitive.

---

## 20. Anti-Patterns Primary Key

### Anti-pattern 1: UUID string sebagai PK untuk semua table

```sql
id CHAR(36) NOT NULL PRIMARY KEY
```

Masalah:

```text
- besar
- random insert
- secondary index bloat
- join lebih mahal
```

Boleh untuk table kecil atau jika trade-off diterima, tapi jangan jadikan default tanpa analisis.

### Anti-pattern 2: Tidak mendefinisikan primary key

InnoDB tetap butuh clustered index. Jika tidak ada primary key, InnoDB memilih unique non-null index atau membuat hidden clustered index.

Masalahnya:

```text
- kamu kehilangan kontrol layout
- replication/CDC/tooling bisa lebih sulit
- row identity tidak eksplisit
- ORM dan operational debugging lebih buruk
```

Rule:

```text
Setiap table production harus punya primary key eksplisit.
```

### Anti-pattern 3: Primary key mutable

```sql
PRIMARY KEY (email)
```

Lalu email bisa berubah.

Buruk karena:

```text
- FK update mahal
- secondary locator berubah
- audit identity membingungkan
```

### Anti-pattern 4: Primary key terlalu bermakna

```text
CASE-2026-JKT-HIGH-INVESTIGATION-0000001
```

Jika severity atau location berubah, apakah key berubah? Jika tidak, key berisi informasi stale. Jika iya, key tidak stabil.

### Anti-pattern 5: Composite key panjang sebagai default

Composite key bagus untuk beberapa table, bukan semua table.

### Anti-pattern 6: Expose internal AUTO_INCREMENT ke public API tanpa kontrol

Risiko:

```text
- enumeration
- information leakage
- scraping
- accidental tenant boundary probing
```

Gunakan public ID atau case number.

### Anti-pattern 7: Menganggap primary key choice bisa diganti mudah nanti

Mengubah primary key table besar adalah operasi mahal dan berisiko.

Primary key adalah keputusan awal yang punya biaya migrasi besar.

---

## 21. Decision Matrix

| Use Case | Recommended PK | Additional ID | Rationale |
|---|---:|---:|---|
| Core OLTP entity | `BIGINT AUTO_INCREMENT` | `public_id BINARY(16)` | Efficient physical identity + safe external identity |
| Public API resource | `BIGINT AUTO_INCREMENT` | UUID/ULID public unique key | Avoid exposing sequential ID |
| Join table | Composite PK of parent IDs | none | Relationship identity natural and compact |
| Case event per case | `(case_id, event_seq)` or `BIGINT` | optional event UUID | Choose based on access pattern |
| Massive append audit | `BIGINT AUTO_INCREMENT` or Snowflake `BIGINT` | optional UUID | Insert locality and small key matter |
| Distributed pre-created entity | Snowflake `BIGINT` or UUIDv7/ULID | maybe public same as PK | Avoid DB round-trip for identity |
| Small lookup table | `SMALLINT/INT` or code | code unique | Simplicity |
| Multi-tenant table | `BIGINT` global PK | tenant-scoped unique keys | Balance ORM simplicity and tenant queries |
| Idempotency table | Composite key `(scope, key_hash)` | request ID | Key is concurrency invariant |

---

## 22. Recommended Defaults for Java Enterprise Systems

Jika tidak ada alasan kuat, gunakan baseline berikut:

```sql
CREATE TABLE some_entity (
    id BIGINT NOT NULL AUTO_INCREMENT,
    public_id BINARY(16) NOT NULL,
    tenant_id BIGINT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_some_entity_public_id (public_id)
) ENGINE=InnoDB;
```

Dengan variasi:

```text
- Tambahkan tenant_id jika multi-tenant
- Tambahkan business unique constraint sesuai domain
- Jangan jadikan public_id sebagai PK kecuali sadar trade-off
- Gunakan composite PK untuk relationship/event table bila access pattern cocok
```

Java entity:

```java
public class SomeEntity {
    private Long id;        // internal DB identity
    private UUID publicId;  // external identity
    private long version;   // concurrency control
}
```

API menggunakan:

```text
publicId atau business number
```

Internal persistence menggunakan:

```text
id
```

---

## 23. Migration: Kalau Terlanjur Salah Primary Key

### 23.1 CHAR(36) UUID PK terlalu mahal

Target:

```text
Dari: id CHAR(36) PRIMARY KEY
Ke:   internal_id BIGINT AUTO_INCREMENT PRIMARY KEY + uuid BINARY(16) UNIQUE
```

Ini sulit karena semua FK child perlu berubah.

Strategi high-level:

```text
1. Tambah kolom internal_id nullable/unique jika memungkinkan
2. Backfill internal_id
3. Tambah mapping di child tables
4. Backfill child internal FK
5. Deploy aplikasi dual-read/dual-write sementara
6. Validasi konsistensi
7. Switch FK/query ke internal_id
8. Rebuild PK/constraints dalam maintenance/online migration strategy
9. Remove old dependency secara bertahap
```

Ini bukan migrasi sederhana. Karena itu primary key harus dirancang serius sejak awal.

### 23.2 Tidak punya primary key

Tambahkan primary key eksplisit.

Namun untuk table besar, `ALTER TABLE` bisa mahal dan memicu metadata lock/DDL rebuild tergantung versi dan operasi. Ini akan dibahas di part schema migration.

---

## 24. Review Checklist Primary Key

Sebelum membuat table, jawab:

```text
Logical identity:
[ ] Apa entity ini?
[ ] Apakah key immutable?
[ ] Apakah ada business identifier yang harus unique?
[ ] Apakah public identifier berbeda dari internal identifier?

Physical storage:
[ ] Seberapa besar PK dalam byte?
[ ] Berapa banyak secondary index yang akan membawa PK ini?
[ ] Apakah insert pattern sequential, time-ordered, atau random?
[ ] Apakah table write-heavy?
[ ] Apakah table akan sangat besar?

Query pattern:
[ ] Query dominan by ID, tenant, time, status, parent, atau business number?
[ ] Apakah clustering by parent lebih berguna daripada clustering by global ID?
[ ] Apakah composite PK sesuai leftmost prefix query?

Java integration:
[ ] Apakah ID harus tersedia sebelum insert?
[ ] Apakah ORM perlu simple `Long id`?
[ ] Apakah batch insert penting?
[ ] Bagaimana generated key diambil?
[ ] Bagaimana UUID/BINARY(16) dimapping?

Distributed systems:
[ ] Apakah entity dibuat di lebih dari satu service/node?
[ ] Apakah butuh offline ID generation?
[ ] Apakah ID ordering penting?
[ ] Bagaimana clock skew jika memakai time-based ID?

Security/API:
[ ] Apakah internal ID diexpose ke user?
[ ] Apakah enumeration risk ada?
[ ] Apakah tenant boundary aman?

Operations:
[ ] Apakah PK mudah dipakai debugging?
[ ] Apakah backup/restore/CDC/replication friendly?
[ ] Apakah perubahan PK nanti mahal?
```

---

## 25. Latihan Desain

### Latihan 1: Core Case Entity

Desain table untuk `enforcement_case` dengan requirement:

```text
- internal system butuh join cepat
- public API tidak boleh expose sequential ID
- case_number human-readable dan unique per tenant
- status sering difilter
- optimistic locking diperlukan
```

Jawaban baseline:

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    public_id BINARY(16) NOT NULL,
    tenant_id BIGINT NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    opened_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_public_id (public_id),
    UNIQUE KEY uk_case_tenant_number (tenant_id, case_number),
    KEY idx_case_tenant_status_opened (tenant_id, status, opened_at)
) ENGINE=InnoDB;
```

### Latihan 2: Case Event

Requirement:

```text
- event selalu dibaca per case
- harus punya urutan deterministik per case
- append-only
```

Jawaban baseline:

```sql
CREATE TABLE case_event (
    case_id BIGINT NOT NULL,
    event_seq BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (case_id, event_seq),
    KEY idx_case_event_occurred (occurred_at)
) ENGINE=InnoDB;
```

### Latihan 3: Public Document Reference

Requirement:

```text
- document ID harus dibuat sebelum upload file
- ID dipakai di URL
- row tidak terlalu banyak dibanding event table
```

Opsi:

```sql
CREATE TABLE document_ref (
    id BIGINT NOT NULL AUTO_INCREMENT,
    public_id BINARY(16) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_document_public_id (public_id)
) ENGINE=InnoDB;
```

Atau jika public ID benar-benar menjadi primary identity dan volume moderate:

```sql
CREATE TABLE document_ref (
    id BINARY(16) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB;
```

Tapi pilih opsi kedua hanya jika kamu sadar biaya BINARY(16) PK terhadap semua secondary index.

---

## 26. Kesimpulan

Primary key di MySQL/InnoDB adalah keputusan arsitektur, bukan detail schema kecil.

Mental model paling penting:

```text
InnoDB table adalah clustered B+Tree berdasarkan primary key.
Secondary index menyimpan primary key sebagai row locator.
Karena itu primary key memengaruhi seluruh storage dan performance profile table.
```

Rekomendasi praktis:

```text
1. Selalu definisikan primary key eksplisit.
2. Untuk core OLTP entity, default aman adalah BIGINT AUTO_INCREMENT sebagai internal PK.
3. Jangan expose internal sequential ID jika ada enumeration/security concern.
4. Tambahkan public_id UUID/ULID sebagai unique key bila perlu.
5. Jangan pakai CHAR(36) UUID sebagai PK default untuk table besar/write-heavy.
6. Gunakan BINARY(16) untuk UUID bila storage/index efficiency penting.
7. Gunakan composite PK untuk relationship table atau event-per-parent bila access pattern cocok.
8. Jangan jadikan mutable business attribute sebagai primary key.
9. Treat primary key as physical clustering strategy.
10. Review primary key bersama query pattern, secondary index, Java mapping, dan failure model.
```

Top 1% engineer tidak memilih primary key berdasarkan kebiasaan. Mereka memilih berdasarkan invariant dan trade-off.

---

## 27. Referensi

- MySQL 8.4 Reference Manual — InnoDB Clustered and Secondary Indexes  
  https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html
- MySQL 8.4 Reference Manual — InnoDB Indexes  
  https://dev.mysql.com/doc/refman/8.4/en/innodb-indexes.html
- MySQL 8.4 Reference Manual — Using AUTO_INCREMENT  
  https://dev.mysql.com/doc/refman/8.4/en/example-auto-increment.html
- MySQL 8.4 Reference Manual — InnoDB Limits  
  https://dev.mysql.com/doc/refman/8.4/en/innodb-limits.html
- MySQL 8.4 Reference Manual — Column Indexes  
  https://dev.mysql.com/doc/refman/8.4/en/column-indexes.html
- MySQL 8.4 Reference Manual — Converting Tables from MyISAM to InnoDB / Primary Key Considerations  
  https://dev.mysql.com/doc/refman/8.4/en/converting-tables-to-innodb.html

---

## 28. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 000 selesai — Orientation: MySQL Mental Model for Java Engineers
Part 001 selesai — MySQL Architecture: From Client Connection to Storage Engine
Part 002 selesai — InnoDB Storage Model: Pages, Extents, Tablespaces, Rows
Part 003 selesai — Primary Key Design in MySQL: The Hidden Architecture Decision
```

Bagian berikutnya:

```text
Part 004 — MySQL Data Types: Physical Cost, Semantics, and Java Mapping
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — InnoDB Storage Model: Pages, Extents, Tablespaces, Rows</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-004.md">Part 004 — MySQL Data Types: Physical Cost, Semantics, and Java Mapping ➡️</a>
</div>
