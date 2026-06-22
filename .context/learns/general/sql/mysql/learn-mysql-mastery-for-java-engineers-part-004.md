# learn-mysql-mastery-for-java-engineers-part-004.md

# Part 004 — MySQL Data Types: Physical Cost, Semantics, and Java Mapping

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `004 / 034`  
> Fokus: memahami tipe data MySQL sebagai keputusan arsitektur, bukan sekadar deklarasi kolom.  
> Target pembaca: Java software engineer yang ingin mampu mendesain schema MySQL yang benar, efisien, aman, dan tahan terhadap bug semantik di production.

---

## 0. Tujuan Bagian Ini

Di seri SQL umum, tipe data sering dipelajari sebagai daftar:

```sql
INT
VARCHAR
TEXT
DATE
DATETIME
TIMESTAMP
DECIMAL
JSON
```

Pendekatan seperti itu terlalu dangkal untuk production.

Di MySQL, tipe data adalah keputusan yang berdampak ke:

1. ukuran row,
2. jumlah page yang dibaca,
3. bentuk index,
4. locking dan write amplification,
5. kemampuan optimizer memakai index,
6. semantik perbandingan,
7. validasi data,
8. kompatibilitas Java,
9. risiko overflow,
10. risiko bug timezone,
11. risiko kehilangan presisi,
12. biaya migrasi schema di masa depan.

Tujuan bagian ini adalah membangun mental model bahwa:

> Tipe data bukan hanya “apa bentuk datanya”, tetapi kontrak antara domain, storage engine, optimizer, aplikasi Java, dan operasi production.

Setelah bagian ini, kamu harus bisa menjawab pertanyaan seperti:

- Haruskah monetary amount disimpan sebagai `DOUBLE`, `DECIMAL`, atau integer minor unit?
- Kapan memakai `DATETIME`, kapan `TIMESTAMP`, dan kapan menyimpan epoch?
- Kenapa `VARCHAR(255)` bukan default yang selalu aman?
- Kenapa `BIGINT` sering lebih murah secara evolusi daripada `INT` walaupun lebih besar?
- Kenapa `UUID CHAR(36)` bisa sangat mahal untuk InnoDB?
- Kapan `JSON` membantu, dan kapan menjadi schema debt?
- Apa mapping yang aman antara MySQL temporal type dan Java `Instant`, `LocalDateTime`, `LocalDate`, `OffsetDateTime`?
- Kenapa `BOOLEAN` di MySQL sebenarnya `TINYINT(1)` dan apa konsekuensinya?
- Bagaimana memilih tipe data untuk regulatory/case-management systems yang membutuhkan auditability dan defensibility?

---

## 1. Mental Model: Tipe Data Adalah Kontrak Berlapis

Setiap kolom MySQL punya beberapa lapisan makna:

```text
Domain meaning
  ↓
SQL type semantics
  ↓
MySQL implementation detail
  ↓
InnoDB physical storage
  ↓
Index representation
  ↓
Optimizer behavior
  ↓
JDBC/Connector/J conversion
  ↓
Java type and business logic
```

Contoh sederhana:

```sql
amount DOUBLE NOT NULL
```

Di permukaan, ini berarti “kolom amount angka”.

Tapi secara sistem:

- domain: nilai uang,
- SQL semantics: approximate numeric,
- storage: floating-point binary,
- comparison: tidak selalu presisi decimal,
- Java mapping: `double` atau `Double`,
- business effect: rounding error,
- audit effect: nilai uang bisa sulit dipertanggungjawabkan,
- regulatory effect: buruk untuk sistem enforcement, billing, penalty, fine, settlement, tax.

Versi yang lebih defensible:

```sql
amount_minor BIGINT NOT NULL
currency_code CHAR(3) NOT NULL
```

Atau:

```sql
amount DECIMAL(19, 4) NOT NULL
currency_code CHAR(3) NOT NULL
```

Keduanya membuat kontrak domain jauh lebih jelas.

---

## 2. Prinsip Umum Memilih Tipe Data

Gunakan prinsip berikut sebelum memilih tipe data.

### 2.1. Pilih tipe yang menyatakan makna domain, bukan hanya kapasitas teknis

Buruk:

```sql
status VARCHAR(255) NOT NULL
```

Lebih baik:

```sql
status VARCHAR(32) NOT NULL
```

Lebih ketat lagi:

```sql
status VARCHAR(32) NOT NULL,
CONSTRAINT chk_case_status
  CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLOSED'))
```

Atau gunakan table referensi bila status harus dikelola secara dinamis.

Mengapa?

Karena `VARCHAR(255)` tidak menjelaskan domain. Ia hanya berkata “teks bebas sampai 255 karakter”. Untuk field seperti status, type yang terlalu longgar meningkatkan risiko:

- typo,
- casing tidak konsisten,
- nilai ilegal,
- index membesar,
- domain rule pindah semua ke aplikasi,
- query analytics menjadi kotor.

### 2.2. Pilih tipe terkecil yang masih aman secara evolusi

Prinsip ini sering disalahpahami.

“Terkecil” bukan berarti selalu `TINYINT`.

Yang benar:

> Pilih tipe yang cukup kecil untuk efisiensi, tetapi cukup besar untuk pertumbuhan domain yang realistis.

Contoh:

```sql
user_id INT UNSIGNED
```

Maksimum sekitar 4.29 miliar. Untuk sistem internal kecil, cukup. Untuk platform global multi-tenant jangka panjang, mungkin lebih aman:

```sql
user_id BIGINT UNSIGNED
```

Biaya tambahan 4 byte per value bisa lebih murah daripada migrasi primary key raksasa beberapa tahun kemudian.

### 2.3. Bedakan identifier, quantity, measurement, money, dan code

Semua terlihat seperti “angka” atau “string”, tapi semantiknya berbeda.

| Domain | Contoh | Tipe yang umum |
|---|---|---|
| Identifier internal | `case_id`, `user_id` | `BIGINT`, `BINARY(16)`, kadang `CHAR(...)` |
| Quantity diskrit | jumlah item | `INT`, `BIGINT` |
| Measurement | suhu, skor, distance | `DECIMAL` atau `DOUBLE`, tergantung presisi |
| Money | denda, penalty, invoice | `DECIMAL` atau integer minor unit |
| Code | country code, currency code | `CHAR(2)`, `CHAR(3)` |
| Status | lifecycle state | `VARCHAR(32)` + constraint / lookup table |
| Free text | description, notes | `TEXT` |
| Structured dynamic data | metadata | `JSON`, hati-hati |

### 2.4. Jangan desain hanya untuk ORM

ORM sering mendorong pemodelan yang nyaman untuk object graph, bukan efisien untuk relational storage.

Contoh buruk:

```java
@Entity
class CaseEntity {
    @Id
    private String id; // UUID string
}
```

Lalu schema menjadi:

```sql
id VARCHAR(255) PRIMARY KEY
```

Ini buruk untuk MySQL/InnoDB karena:

- primary key adalah clustered index,
- semua secondary index menyimpan primary key,
- string besar membuat semua index membengkak,
- random UUID membuat page split,
- collation string ikut mempengaruhi comparison,
- storage dan cache efficiency turun.

Lebih baik:

```sql
id BINARY(16) PRIMARY KEY
```

Atau:

```sql
id BIGINT UNSIGNED PRIMARY KEY
```

Tergantung kebutuhan distribusi ID.

---

## 3. Ringkasan Kategori Tipe Data MySQL

MySQL mendukung beberapa kategori besar tipe data:

1. numeric,
2. date/time,
3. string character,
4. binary string,
5. JSON,
6. spatial,
7. enumerated types seperti `ENUM` dan `SET`.

Referensi resmi MySQL mengelompokkan tipe data ke kategori numeric, date/time, string character/byte, spatial, dan JSON. Untuk seri ini, spatial hanya disentuh ringan karena bukan fokus utama Java backend regulatori.

---

## 4. Numeric Types

Numeric type di MySQL terbagi menjadi:

1. exact integer,
2. exact decimal,
3. approximate floating point,
4. bit type.

### 4.1. Integer Types

Tipe integer umum:

| Type | Storage | Signed Range kira-kira | Unsigned Range kira-kira |
|---|---:|---:|---:|
| `TINYINT` | 1 byte | -128..127 | 0..255 |
| `SMALLINT` | 2 bytes | -32K..32K | 0..65K |
| `MEDIUMINT` | 3 bytes | -8M..8M | 0..16M |
| `INT` / `INTEGER` | 4 bytes | -2.1B..2.1B | 0..4.2B |
| `BIGINT` | 8 bytes | -9.22e18..9.22e18 | 0..18.44e18 |

Mental model:

```text
integer type = capacity + storage + comparison + index width
```

Untuk Java mapping:

| MySQL | Java |
|---|---|
| `TINYINT` | `byte`, `Byte`, sering `Boolean` bila `TINYINT(1)` |
| `SMALLINT` | `short`, `Short` |
| `INT` | `int`, `Integer` |
| `BIGINT` | `long`, `Long` |
| `BIGINT UNSIGNED` | hati-hati, bisa melebihi `Long.MAX_VALUE` |

#### Signed vs Unsigned

MySQL mendukung `UNSIGNED` untuk integer.

Contoh:

```sql
id BIGINT UNSIGNED NOT NULL
```

Secara kapasitas, `BIGINT UNSIGNED` memberi range positif lebih besar. Tetapi di Java, `long` signed hanya sampai `9,223,372,036,854,775,807`. `BIGINT UNSIGNED` maksimum bisa dua kali lebih besar.

Maka untuk identifier:

- `BIGINT` signed sering cukup dan lebih mudah di Java.
- `BIGINT UNSIGNED` memberi range lebih besar, tetapi butuh disiplin mapping.
- Jika memakai `BIGINT UNSIGNED`, pastikan generator ID tidak melewati `Long.MAX_VALUE` bila Java tetap memakai `long`.

Praktik aman untuk Java systems:

```sql
id BIGINT NOT NULL PRIMARY KEY
```

kecuali kamu punya alasan eksplisit memakai unsigned.

### 4.2. Display Width Sudah Bukan Hal Penting

Dulu orang sering menulis:

```sql
INT(11)
TINYINT(1)
```

Banyak yang salah memahami `INT(11)` sebagai “maksimal 11 digit”. Itu tidak benar. Kapasitas integer ditentukan oleh tipe (`INT`, `BIGINT`), bukan angka display width.

`TINYINT(1)` secara historis sering dipakai untuk boolean, tetapi bukan boolean sejati. Ia tetap menyimpan integer kecil.

### 4.3. BOOLEAN di MySQL

Di MySQL:

```sql
BOOLEAN
BOOL
```

adalah alias untuk `TINYINT(1)`.

Artinya:

```sql
is_active BOOLEAN NOT NULL
```

secara konseptual menjadi:

```sql
is_active TINYINT(1) NOT NULL
```

Konsekuensi:

```sql
INSERT INTO user_account (is_active) VALUES (2);
```

Secara storage, nilai 2 bisa masuk bila tidak ada constraint.

Maka untuk boolean defensible:

```sql
is_active TINYINT(1) NOT NULL DEFAULT 1,
CONSTRAINT chk_user_account_is_active
  CHECK (is_active IN (0, 1))
```

Atau minimal pastikan aplikasi selalu menulis 0/1.

Java mapping:

```java
private boolean active;
```

atau:

```java
private Boolean active; // bila nullable
```

Gunakan `boolean` untuk kolom `NOT NULL`, `Boolean` untuk nullable. Jangan membuat nullable boolean tanpa alasan, karena menghasilkan tiga state:

```text
true
false
unknown/null
```

Dalam regulatory workflow, tiga state kadang valid, tapi harus disengaja.

Contoh:

```sql
is_subject_notified TINYINT(1) NULL
```

Ini bisa berarti:

- `1`: sudah diberi notifikasi,
- `0`: belum diberi notifikasi,
- `NULL`: belum dievaluasi / tidak applicable.

Kalau ini memang domain, dokumentasikan. Kalau tidak, gunakan `NOT NULL`.

---

## 5. DECIMAL vs DOUBLE vs FLOAT

Ini salah satu keputusan paling penting.

### 5.1. Exact Numeric: DECIMAL

`DECIMAL(p, s)` menyimpan angka decimal fixed precision.

```sql
penalty_amount DECIMAL(19, 4) NOT NULL
```

Artinya:

- precision total: 19 digit,
- scale: 4 digit di belakang decimal.

Cocok untuk:

- uang,
- denda,
- pajak,
- interest rate yang harus presisi,
- angka yang harus audit-friendly,
- threshold legal/regulatory.

Java mapping:

```java
BigDecimal penaltyAmount;
```

Jangan mapping ke `double`.

Buruk:

```java
double amount;
```

Baik:

```java
BigDecimal amount;
```

### 5.2. Approximate Numeric: FLOAT dan DOUBLE

`FLOAT` dan `DOUBLE` memakai floating-point binary. Cocok untuk:

- measurement ilmiah,
- sensor,
- ranking score,
- probabilistic value,
- geo-ish approximate calculation,
- ML score.

Tidak cocok untuk:

- uang,
- saldo,
- denda,
- invoice,
- payment,
- settlement,
- tax,
- legal amount.

Contoh bug:

```sql
SELECT 0.1 + 0.2;
```

Secara floating point, hasilnya tidak selalu persis `0.3`.

Jika kamu membuat sistem denda enforcement dan menyimpan:

```sql
fine_amount DOUBLE NOT NULL
```

maka kamu sedang membangun sistem yang sulit diaudit.

### 5.3. Money: DECIMAL atau Minor Unit?

Ada dua pendekatan umum.

#### Opsi A: DECIMAL

```sql
amount DECIMAL(19, 4) NOT NULL,
currency_code CHAR(3) NOT NULL
```

Kelebihan:

- mudah dibaca,
- cocok untuk SQL reporting,
- cocok untuk multi-currency dengan fractional unit,
- mapping natural ke `BigDecimal`.

Kekurangan:

- perlu disiplin scale,
- operasi decimal lebih mahal daripada integer,
- rounding harus jelas.

#### Opsi B: integer minor unit

```sql
amount_minor BIGINT NOT NULL,
currency_code CHAR(3) NOT NULL
```

Contoh:

```text
IDR 100000 -> 100000 rupiah
USD 12.34 -> 1234 cents
```

Kelebihan:

- exact,
- cepat,
- mudah dibandingkan,
- tidak ada floating rounding.

Kekurangan:

- tidak semua mata uang punya 2 decimal,
- ada domain seperti crypto/token/interest yang butuh scale lebih fleksibel,
- UI/reporting perlu konversi.

Untuk regulatory penalty system, pilihan umum:

- gunakan `DECIMAL(19, 4)` bila domain perlu fractional decimal dan audit SQL mudah,
- gunakan `BIGINT amount_minor` bila domain uang selalu dalam minor unit fixed.

Yang tidak disarankan:

```sql
amount DOUBLE
```

---

## 6. Integer untuk Identifier

Identifier bukan angka matematika.

```sql
case_id BIGINT NOT NULL PRIMARY KEY
```

Walaupun bertipe angka, kamu tidak pernah melakukan:

```sql
case_id + 10
```

Identifier perlu:

- unik,
- stabil,
- efisien untuk join,
- efisien untuk index,
- mudah dibawa antar service,
- aman dari exposure bila dipublikasikan,
- tidak misleading.

### 6.1. AUTO_INCREMENT

```sql
id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY
```

Kelebihan:

- sederhana,
- insertion locality bagus,
- cocok untuk InnoDB clustered index,
- secondary index relatif kecil,
- mudah debug.

Kekurangan:

- predictable,
- sulit untuk multi-writer distributed ID,
- bisa menimbulkan coupling bila ID public,
- conflict saat merge data dari banyak environment.

Untuk internal OLTP service, ini sering sangat baik.

### 6.2. UUID sebagai CHAR(36)

```sql
id CHAR(36) PRIMARY KEY
```

Kelebihan:

- global uniqueness,
- bisa dibuat di aplikasi,
- tidak mudah ditebak.

Kekurangan besar di InnoDB:

- 36 byte plus collation overhead,
- primary key besar,
- semua secondary index membesar,
- random insert menyebabkan page split,
- cache efficiency buruk,
- comparison string lebih mahal daripada binary/integer.

Jangan jadikan `CHAR(36)` sebagai default primary key MySQL production tanpa alasan kuat.

### 6.3. UUID sebagai BINARY(16)

Lebih baik:

```sql
id BINARY(16) PRIMARY KEY
```

Storage turun dari 36 karakter ke 16 byte. Tetapi random insert problem masih ada bila UUID v4.

Aplikasi Java perlu konversi:

```java
UUID uuid;
```

ke binary 16 byte.

### 6.4. Time-ordered UUID / ULID / Snowflake

Untuk mengurangi random insert penalty, gunakan ID yang roughly ordered:

- UUID v7,
- ULID,
- Snowflake-style ID,
- database sequence-like generator,
- application-generated sortable ID.

Trade-off:

- lebih kompleks,
- perlu standar lintas service,
- clock issue,
- ordering tidak selalu sempurna,
- format storage harus disepakati.

Untuk MySQL/InnoDB, ID yang monotonic atau semi-monotonic biasanya lebih ramah terhadap clustered index.

---

## 7. String Types: CHAR, VARCHAR, TEXT

String type bukan hanya soal panjang.

String punya:

- character set,
- collation,
- length semantics,
- storage overhead,
- index limit,
- comparison behavior,
- sorting behavior,
- case sensitivity behavior.

### 7.1. CHAR

```sql
country_code CHAR(2) NOT NULL
currency_code CHAR(3) NOT NULL
```

Gunakan `CHAR` untuk fixed-length code yang benar-benar fixed:

- ISO country code,
- currency code,
- short fixed code,
- fixed hash prefix tertentu.

Jangan gunakan `CHAR(255)` untuk teks biasa.

### 7.2. VARCHAR

```sql
subject_name VARCHAR(200) NOT NULL
case_reference VARCHAR(64) NOT NULL
```

`VARCHAR` cocok untuk string variable-length dengan batas domain jelas.

Contoh batas domain yang masuk akal:

| Field | Tipe |
|---|---|
| email | `VARCHAR(254)` |
| username | `VARCHAR(64)` |
| status | `VARCHAR(32)` |
| external reference | `VARCHAR(128)` |
| display name | `VARCHAR(200)` |
| ISO currency | `CHAR(3)` |
| ISO country | `CHAR(2)` |

Jangan otomatis pakai:

```sql
VARCHAR(255)
```

karena:

- tidak menyatakan domain,
- bisa memperbesar index,
- bisa mempengaruhi memory temporary table,
- bisa membuat aplikasi tidak sadar batas sebenarnya,
- bisa membuat migrasi lebih sulit.

### 7.3. TEXT

`TEXT` cocok untuk teks panjang:

```sql
description TEXT NULL
internal_note TEXT NULL
```

Tetapi `TEXT` punya konsekuensi:

- tidak bisa diberi default value biasa seperti string kecil dalam banyak skenario,
- indexing butuh prefix index atau full-text,
- bisa disimpan off-page tergantung row format dan ukuran,
- query yang mengambil banyak `TEXT` meningkatkan I/O,
- sorting/grouping atas `TEXT` mahal,
- row menjadi lebih berat.

Pattern yang baik:

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL PRIMARY KEY,
    case_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    summary VARCHAR(500) NULL,
    description TEXT NULL,
    created_at DATETIME(6) NOT NULL
);
```

Gunakan field pendek untuk list/search screen, field panjang hanya saat detail view.

### 7.4. Jangan Campur Search Use Case dengan OLTP Field

Jika user butuh full search atas notes, comments, attachments, legal text, jangan langsung memaksa semua ke `LIKE '%keyword%'` atas `TEXT`.

Pilihan:

- MySQL full-text index untuk kebutuhan sederhana,
- external search engine untuk relevance, stemming, highlighting, fuzzy search, complex filtering,
- event-driven indexing untuk sync.

MySQL bagus untuk transactional truth. Ia bukan selalu search engine terbaik.

---

## 8. Character Set dan Collation Singkat

Bagian collation akan dibahas lebih dalam di Part 005, tetapi tipe string tidak bisa dipisahkan dari charset/collation.

### 8.1. Character Set

Character set menentukan karakter apa yang bisa disimpan.

Default modern yang aman:

```sql
CHARACTER SET utf8mb4
```

`utf8mb4` mendukung Unicode penuh, termasuk emoji dan banyak karakter multibahasa.

### 8.2. Collation

Collation menentukan cara membandingkan dan mengurutkan string.

Contoh efek:

```text
"abc" = "ABC" ?
"é" = "e" ?
"ß" = "ss" ?
```

Jawabannya tergantung collation.

Untuk field yang harus exact:

- token,
- API key,
- external id,
- case-sensitive code,

gunakan collation binary atau tipe binary.

Contoh:

```sql
external_token VARBINARY(64) NOT NULL
```

atau:

```sql
external_code VARCHAR(64)
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_bin NOT NULL
```

---

## 9. Binary String Types: BINARY, VARBINARY, BLOB

Binary type menyimpan byte, bukan karakter.

Gunakan binary untuk:

- UUID binary,
- hash,
- encrypted payload,
- token digest,
- file checksum,
- compact external identifier,
- cryptographic material.

### 9.1. VARBINARY untuk Token/Hash

```sql
token_hash VARBINARY(32) NOT NULL
```

Untuk SHA-256 raw bytes, 32 byte.

Jangan simpan hash sebagai hex string kecuali ada alasan operasional.

Hex SHA-256:

```text
64 hex chars
```

Raw SHA-256:

```text
32 bytes
```

Storage raw binary lebih efisien.

### 9.2. BLOB

`BLOB` cocok untuk binary besar, tapi jangan terlalu cepat menyimpan file besar di MySQL.

Pertimbangkan object storage untuk:

- PDF,
- images,
- scanned evidence,
- large attachments.

Schema yang lebih baik:

```sql
CREATE TABLE evidence_file (
    id BIGINT NOT NULL PRIMARY KEY,
    case_id BIGINT NOT NULL,
    storage_bucket VARCHAR(128) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    sha256 VARBINARY(32) NOT NULL,
    content_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL
);
```

MySQL menyimpan metadata transactional; object storage menyimpan payload besar.

---

## 10. Date and Time Types

MySQL temporal types utama:

- `DATE`
- `TIME`
- `DATETIME`
- `TIMESTAMP`
- `YEAR`

Referensi resmi MySQL menyebut tipe temporal ini punya range valid dan beberapa perilaku khusus, termasuk automatic initialization/update untuk `TIMESTAMP` dan `DATETIME`.

### 10.1. DATE

Gunakan `DATE` untuk tanggal kalender tanpa jam dan timezone.

Contoh:

```sql
birth_date DATE NULL
document_date DATE NOT NULL
effective_date DATE NOT NULL
```

Java mapping:

```java
LocalDate
```

Jangan mapping `DATE` ke `java.util.Date` bila bisa dihindari. `java.util.Date` merepresentasikan instant, bukan tanggal kalender murni.

### 10.2. TIME

`TIME` merepresentasikan waktu atau durasi, tergantung konteks. Hati-hati karena MySQL `TIME` bisa menyimpan range yang lebih luas daripada jam sehari.

Gunakan untuk:

```sql
office_open_time TIME NOT NULL
```

Java mapping:

```java
LocalTime
```

Untuk durasi, sering lebih eksplisit:

```sql
duration_seconds INT NOT NULL
```

daripada:

```sql
duration TIME NOT NULL
```

karena duration tidak selalu “jam dalam hari”.

### 10.3. DATETIME

`DATETIME` menyimpan tanggal dan waktu tanpa konversi timezone otomatis.

Contoh:

```sql
submitted_at DATETIME(6) NOT NULL
```

`DATETIME` cocok untuk:

- local civil time,
- jadwal yang bermakna dalam zona tertentu,
- timestamp aplikasi bila semua layer sepakat UTC,
- audit timestamp bila session timezone dikunci UTC.

Namun secara semantik, `DATETIME` sendiri tidak menyimpan timezone.

Jika kamu menyimpan UTC di `DATETIME`, nama dan kontraknya harus jelas:

```sql
created_at_utc DATETIME(6) NOT NULL
```

Atau minimal standar sistem: semua `*_at` adalah UTC.

Java mapping:

- `LocalDateTime` bila benar-benar local datetime tanpa zona.
- `Instant` bisa digunakan bila aplikasi mengonversi dengan disiplin UTC.
- Hindari ambiguity.

### 10.4. TIMESTAMP

`TIMESTAMP` di MySQL memiliki perilaku timezone conversion: nilai dikonversi dari session time zone ke UTC untuk storage, dan dari UTC ke session time zone saat retrieval.

Ini dapat membantu bila semua connection timezone benar.

Tapi juga bisa menyebabkan bug bila:

- JVM timezone berbeda antar environment,
- session timezone tidak dikunci,
- DB timezone berubah,
- Connector/J configuration tidak eksplisit,
- developer mengira `TIMESTAMP` menyimpan local time apa adanya.

Gunakan `TIMESTAMP` bila kamu memahami konversi session timezone dan ingin menyimpan instant.

Java mapping ideal:

```java
Instant
```

Tetapi pastikan Connector/J dan session timezone dikonfigurasi dengan benar.

### 10.5. Fractional Seconds

Gunakan precision:

```sql
created_at DATETIME(6) NOT NULL
updated_at DATETIME(6) NOT NULL
```

`(6)` berarti microseconds.

Mengapa penting?

- Java `Instant` punya nanosecond precision, tapi MySQL umum menyimpan microseconds.
- Tanpa fractional seconds, event berurutan dalam detik yang sama bisa terlihat sama.
- Audit trail dan ordering bisa terganggu bila timestamp terlalu kasar.

Namun jangan mengandalkan timestamp saja untuk ordering total. Untuk event log, lebih baik:

```sql
case_id BIGINT NOT NULL,
sequence_no BIGINT NOT NULL,
occurred_at DATETIME(6) NOT NULL,
PRIMARY KEY (case_id, sequence_no)
```

Timestamp menunjukkan waktu. Sequence menunjukkan urutan domain.

---

## 11. Timezone: Bug yang Sangat Sering Terjadi

Timezone bug biasanya bukan karena developer tidak tahu waktu, tetapi karena ada beberapa “waktu” berbeda:

```text
database server timezone
session timezone
JVM default timezone
application business timezone
user timezone
storage convention
serialization timezone
```

### 11.1. Aturan Aman untuk Backend Java

Untuk kebanyakan sistem backend:

1. Simpan instant audit dalam UTC.
2. Gunakan `Instant` di Java untuk event/audit timestamp.
3. Gunakan `LocalDate` untuk tanggal kalender.
4. Gunakan `LocalDateTime` hanya bila memang timezone-independent atau disertai zone context.
5. Set DB/session/JVM timezone secara eksplisit.
6. Jangan bergantung pada default timezone environment.
7. Dokumentasikan semua `*_at`.

### 11.2. Contoh Kontrak Aman

```sql
created_at DATETIME(6) NOT NULL,
updated_at DATETIME(6) NOT NULL,
submitted_at DATETIME(6) NULL
```

Konvensi:

```text
All *_at columns are stored in UTC as DATETIME(6).
Application maps them to Instant.
JDBC connection/session timezone is configured as UTC.
UI converts to user timezone.
```

Atau:

```sql
created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
```

Konvensi:

```text
TIMESTAMP stores instants with MySQL timezone conversion.
All sessions must use UTC.
Java maps to Instant.
```

Kedua pendekatan bisa benar. Yang berbahaya adalah tidak punya kontrak.

### 11.3. DATETIME untuk Jadwal Lokal

Contoh:

```sql
hearing_local_datetime DATETIME(6) NOT NULL,
hearing_timezone VARCHAR(64) NOT NULL
```

Mengapa tidak cukup `TIMESTAMP`?

Karena hearing “10:00 Asia/Jakarta” adalah civil time. Jika aturan timezone berubah atau user perlu melihat local schedule, zona adalah bagian dari domain.

Java:

```java
LocalDateTime hearingLocalDateTime;
ZoneId hearingTimezone;
```

Ketika perlu instant:

```java
ZonedDateTime zdt = hearingLocalDateTime.atZone(hearingTimezone);
Instant instant = zdt.toInstant();
```

---

## 12. YEAR Type

`YEAR` ada di MySQL, tetapi jarang perlu.

Gunakan:

```sql
fiscal_year SMALLINT NOT NULL
```

lebih eksplisit dan portabel daripada:

```sql
fiscal_year YEAR NOT NULL
```

`YEAR` bisa berguna untuk domain yang memang hanya tahun, tetapi untuk sistem enterprise, `SMALLINT` sering lebih mudah dikontrol.

---

## 13. ENUM dan SET

### 13.1. ENUM

Contoh:

```sql
status ENUM('DRAFT', 'SUBMITTED', 'CLOSED') NOT NULL
```

Kelebihan:

- compact,
- validasi di DB,
- mudah untuk domain kecil yang stabil.

Kekurangan:

- perubahan enum perlu DDL,
- urutan internal bisa membingungkan,
- bisa menyulitkan deployment multi-version,
- tidak ideal untuk domain yang sering berubah,
- kurang fleksibel untuk workflow complex.

Untuk status lifecycle yang stabil, `ENUM` bisa dipakai. Tetapi untuk sistem besar dengan migration pipeline, sering lebih aman:

```sql
status VARCHAR(32) NOT NULL,
CONSTRAINT chk_case_status CHECK (
  status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLOSED')
)
```

Atau:

```sql
status_id SMALLINT NOT NULL
```

dengan reference table.

### 13.2. SET

`SET` memungkinkan satu kolom berisi beberapa nilai dari daftar.

Contoh:

```sql
flags SET('A', 'B', 'C')
```

Biasanya hindari untuk sistem serius karena:

- query membership bisa aneh,
- mapping Java kurang natural,
- normalisasi buruk,
- sulit enforce relasi,
- sulit untuk audit/change history.

Lebih baik table relasi:

```sql
CREATE TABLE case_flag (
    case_id BIGINT NOT NULL,
    flag_code VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (case_id, flag_code)
);
```

---

## 14. JSON Type

MySQL mendukung tipe `JSON` native yang memvalidasi dokumen JSON dan menyediakan fungsi/path untuk akses data JSON.

### 14.1. Kapan JSON Cocok

Gunakan `JSON` untuk:

- metadata semi-structured,
- integration payload yang bentuknya bervariasi,
- dynamic form draft,
- external system response snapshot,
- optional attributes yang tidak sering difilter,
- audit payload,
- policy evaluation context.

Contoh:

```sql
CREATE TABLE case_event (
    id BIGINT NOT NULL PRIMARY KEY,
    case_id BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    occurred_at DATETIME(6) NOT NULL
);
```

Ini masuk akal karena event payload bisa berbeda per event type.

### 14.2. Kapan JSON Buruk

Jangan pakai JSON untuk field yang:

- sering difilter,
- sering di-join,
- punya integrity constraint,
- punya lifecycle sendiri,
- harus di-update sebagian secara high frequency,
- perlu foreign key,
- penting untuk reporting reguler.

Buruk:

```sql
case_data JSON NOT NULL
```

isi:

```json
{
  "status": "UNDER_REVIEW",
  "assignedOfficerId": 123,
  "submittedAt": "2026-06-22T10:30:00Z"
}
```

Lalu query:

```sql
WHERE JSON_EXTRACT(case_data, '$.status') = 'UNDER_REVIEW'
```

Untuk field core workflow seperti status, ini buruk. Lebih baik:

```sql
status VARCHAR(32) NOT NULL,
assigned_officer_id BIGINT NULL,
submitted_at DATETIME(6) NULL,
extra_attributes JSON NULL
```

### 14.3. Generated Columns untuk JSON

Jika ada field JSON yang perlu diindex:

```sql
ALTER TABLE case_record
ADD COLUMN risk_score DECIMAL(10, 4)
  GENERATED ALWAYS AS (
    JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.riskScore'))
  ) STORED,
ADD INDEX idx_case_risk_score (risk_score);
```

Atau gunakan functional index bila cocok.

Tetap hati-hati: begitu field JSON sering diindex dan menjadi bagian query utama, mungkin field tersebut seharusnya menjadi kolom normal.

### 14.4. Java Mapping JSON

Pilihan:

```java
JsonNode attributes;
Map<String, Object> attributes;
String rawJson;
DomainSpecificAttributes attributes;
```

Trade-off:

| Mapping | Cocok untuk | Risiko |
|---|---|---|
| `String` | snapshot raw | validasi di aplikasi lemah |
| `JsonNode` | flexible read/write | domain kurang eksplisit |
| `Map<String,Object>` | sederhana | type safety buruk |
| class domain | kontrak kuat | migrasi payload perlu dipikirkan |

Untuk event/audit payload, `JsonNode` atau raw JSON bisa masuk akal. Untuk configuration domain yang penting, class domain lebih baik.

---

## 15. Spatial Types

MySQL punya spatial data types seperti `POINT`, `LINESTRING`, `POLYGON`, dan lainnya. Untuk mayoritas backend Java enterprise, ini hanya relevan bila ada use case lokasi/geospatial.

Contoh:

```sql
location POINT SRID 4326
```

Namun untuk seri ini, spatial tidak menjadi fokus utama. Bila sistem regulatory butuh jurisdiction boundary, inspection location, atau geo-fencing, spatial type bisa relevan, tetapi perlu pembahasan khusus tentang SRID, spatial index, dan geospatial query.

---

## 16. NULL vs NOT NULL

Tipe data tidak lengkap tanpa nullability.

### 16.1. NULL adalah State Domain

`NULL` bukan string kosong. `NULL` bukan 0. `NULL` berarti value tidak ada/unknown/not applicable.

Contoh:

```sql
closed_at DATETIME(6) NULL
```

Ini masuk akal:

- case yang belum closed tidak punya `closed_at`.

Contoh buruk:

```sql
status VARCHAR(32) NULL
```

Jika setiap case harus punya status, gunakan:

```sql
status VARCHAR(32) NOT NULL
```

### 16.2. NULL Mempengaruhi Query

```sql
WHERE closed_at = NULL
```

salah. Harus:

```sql
WHERE closed_at IS NULL
```

Java bug umum:

```java
if (entity.getClosedAt().equals(...)) // NPE
```

Gunakan nullability sebagai bagian desain domain.

### 16.3. NOT NULL Membantu Optimizer dan Aplikasi

`NOT NULL` memberikan informasi:

- ke database,
- ke developer,
- ke ORM,
- ke validation,
- ke query planner dalam beberapa konteks.

Default mindset:

> Gunakan `NOT NULL` kecuali domain benar-benar membutuhkan absence/unknown/not applicable.

---

## 17. DEFAULT Values

Default value adalah kontrak saat insert tidak mengirim field.

Contoh baik:

```sql
created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
```

Contoh yang perlu hati-hati:

```sql
status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
```

Ini baik jika semua insert tanpa status memang harus DRAFT.

Tapi buruk jika status harus dipilih secara eksplisit oleh domain service.

### 17.1. DEFAULT Bisa Menyembunyikan Bug

Contoh:

```sql
priority INT NOT NULL DEFAULT 0
```

Jika aplikasi lupa mengisi priority, database diam-diam memakai 0. Apakah 0 valid? Apakah itu bug?

Untuk domain penting, kadang lebih baik tidak punya default agar insert gagal bila aplikasi lupa.

### 17.2. `created_at` dan `updated_at`

Pattern umum:

```sql
created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  ON UPDATE CURRENT_TIMESTAMP(6)
```

Hati-hati:

- `ON UPDATE` berubah pada update apapun.
- Jika aplikasi butuh event-specific timestamps, jangan mengandalkan `updated_at`.
- Untuk audit legal, gunakan audit/event table, bukan hanya `updated_at`.

---

## 18. CHECK Constraints

MySQL 8.0+ mendukung enforcement `CHECK` constraints. Gunakan untuk domain kecil yang harus dijaga database.

Contoh:

```sql
risk_score DECIMAL(5, 2) NOT NULL,
CONSTRAINT chk_risk_score_range
  CHECK (risk_score >= 0 AND risk_score <= 100)
```

Boolean:

```sql
is_active TINYINT(1) NOT NULL,
CONSTRAINT chk_is_active_bool CHECK (is_active IN (0, 1))
```

Status:

```sql
status VARCHAR(32) NOT NULL,
CONSTRAINT chk_case_status CHECK (
  status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLOSED')
)
```

CHECK constraint bukan pengganti domain model, tapi lapisan pertahanan.

---

## 19. Tipe Data dan Index Cost

Setiap kolom yang diindex membawa biaya.

### 19.1. Index Width

Index entry menyimpan key value. Untuk secondary index InnoDB, entry juga menyimpan primary key.

Jika primary key besar, semua secondary index ikut besar.

Contoh buruk:

```sql
id CHAR(36) PRIMARY KEY,
status VARCHAR(255),
INDEX idx_status (status)
```

Secondary index `idx_status` menyimpan:

```text
status + primary key
```

Jika status dan id sama-sama besar, index membengkak.

Lebih baik:

```sql
id BIGINT PRIMARY KEY,
status VARCHAR(32),
INDEX idx_status (status)
```

### 19.2. String Index dan Collation

Index atas string tidak hanya menyimpan bytes. Comparison mengikuti collation.

Untuk token exact:

```sql
token VARCHAR(128)
```

dengan case-insensitive collation bisa menghasilkan perilaku mengejutkan:

```text
abc == ABC
```

Untuk exact byte match:

```sql
token_hash VARBINARY(32)
```

lebih baik.

### 19.3. Prefix Index

Untuk kolom panjang:

```sql
INDEX idx_description_prefix (description(100))
```

Prefix index bisa membantu beberapa query, tetapi:

- tidak selalu cukup selective,
- tidak bisa selalu membantu ORDER BY penuh,
- bisa menghasilkan false positives yang perlu dicek ulang.

Jangan pakai prefix index sebagai obat generik untuk desain tipe data yang buruk.

---

## 20. Tipe Data dan Temporary Table

Ukuran tipe data juga mempengaruhi temporary table dan memory.

Query seperti:

```sql
SELECT status, COUNT(*)
FROM case_record
GROUP BY status;
```

Jika `status VARCHAR(255)`, temporary structure lebih berat daripada `VARCHAR(32)`.

Query sorting:

```sql
ORDER BY long_varchar_column
```

lebih mahal daripada sorting numeric/date kecil.

Prinsip:

> Field yang sering dipakai untuk filtering, grouping, sorting, dan joining harus punya tipe yang ketat dan kecil.

---

## 21. Java Mapping Cheatsheet

### 21.1. Numeric

| MySQL | Java Recommended | Catatan |
|---|---|---|
| `TINYINT(1)` | `boolean` / `Boolean` | Tambahkan CHECK untuk 0/1 |
| `TINYINT` | `byte` / `Byte` | Jarang perlu |
| `SMALLINT` | `short` / `Short` | Cocok untuk small code |
| `INT` | `int` / `Integer` | Hati-hati overflow |
| `BIGINT` | `long` / `Long` | Default bagus untuk ID |
| `DECIMAL` | `BigDecimal` | Money/exact numeric |
| `FLOAT` | `float` / `Float` | Jarang untuk business |
| `DOUBLE` | `double` / `Double` | Measurement/score, bukan money |

### 21.2. Temporal

| MySQL | Java Recommended | Catatan |
|---|---|---|
| `DATE` | `LocalDate` | Tanggal kalender |
| `TIME` | `LocalTime` | Waktu lokal, bukan durasi besar |
| `DATETIME(6)` | `LocalDateTime` / `Instant` dengan konvensi UTC | Tidak menyimpan timezone |
| `TIMESTAMP(6)` | `Instant` | Ada conversion session timezone |
| year-like | `short` / `int` | Sering lebih baik dari `YEAR` |

### 21.3. String/Binary

| MySQL | Java |
|---|---|
| `CHAR`, `VARCHAR`, `TEXT` | `String` |
| `BINARY(16)` UUID | `UUID` dengan converter |
| `VARBINARY`, `BLOB` | `byte[]` |
| `JSON` | `JsonNode`, domain class, `String`, atau `Map` |

---

## 22. Schema Design Example: Case Management Core

Mari desain contoh schema untuk regulatory case management.

### 22.1. Versi Buruk

```sql
CREATE TABLE cases (
    id VARCHAR(255) PRIMARY KEY,
    status VARCHAR(255),
    priority VARCHAR(255),
    amount DOUBLE,
    created_at TIMESTAMP,
    closed_at TIMESTAMP,
    data JSON,
    description TEXT
);
```

Masalah:

- `id VARCHAR(255)` buruk untuk primary key.
- `status VARCHAR(255)` terlalu longgar.
- `priority VARCHAR(255)` seharusnya numeric/code kecil.
- `amount DOUBLE` buruk untuk money.
- temporal type tanpa precision/kontrak timezone.
- `data JSON` mungkin menyembunyikan field core.
- semua nullable secara implisit.
- tidak ada constraint domain.
- tidak ada audit-friendly naming.

### 22.2. Versi Lebih Baik

```sql
CREATE TABLE case_record (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_number VARCHAR(64) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority SMALLINT NOT NULL,
    penalty_amount DECIMAL(19, 4) NULL,
    penalty_currency CHAR(3) NULL,
    summary VARCHAR(500) NULL,
    description TEXT NULL,
    attributes JSON NULL,
    submitted_at DATETIME(6) NULL,
    closed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ON UPDATE CURRENT_TIMESTAMP(6),

    PRIMARY KEY (id),
    UNIQUE KEY uk_case_number (case_number),
    KEY idx_case_status_priority_created (status, priority, created_at),
    KEY idx_case_subject (subject_id),

    CONSTRAINT chk_case_status CHECK (
      status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED')
    ),
    CONSTRAINT chk_case_priority CHECK (
      priority BETWEEN 1 AND 5
    ),
    CONSTRAINT chk_penalty_currency_required CHECK (
      (penalty_amount IS NULL AND penalty_currency IS NULL)
      OR
      (penalty_amount IS NOT NULL AND penalty_currency IS NOT NULL)
    )
);
```

Ini lebih baik karena:

- primary key compact,
- business identifier (`case_number`) dipisah dari storage identifier,
- status dibatasi,
- priority numeric dengan range,
- money pakai `DECIMAL`,
- currency explicit,
- `DATETIME(6)` explicit,
- nullable field punya makna,
- JSON hanya untuk attributes tambahan,
- index sesuai workflow query.

### 22.3. Mapping Java

```java
public final class CaseRecord {
    private Long id;
    private String caseNumber;
    private Long subjectId;
    private CaseStatus status;
    private short priority;
    private BigDecimal penaltyAmount;
    private String penaltyCurrency;
    private String summary;
    private String description;
    private JsonNode attributes;
    private Instant submittedAt;
    private Instant closedAt;
    private Instant createdAt;
    private Instant updatedAt;
}
```

Catatan:

- `CaseStatus` enum di Java harus selaras dengan DB constraint.
- `Instant` butuh konvensi UTC bila DB memakai `DATETIME(6)`.
- `BigDecimal` untuk penalty.
- nullable database harus tercermin sebagai nullable Java field atau `Optional` di boundary, bukan di entity JPA secara sembarangan.

---

## 23. Schema Design Example: Audit/Event Table

Audit trail berbeda dari current state table.

```sql
CREATE TABLE case_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    event_sequence BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    actor_user_id BIGINT NULL,
    source_system VARCHAR(64) NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    payload JSON NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_case_event_sequence (case_id, event_sequence),
    KEY idx_case_event_case_time (case_id, occurred_at),
    KEY idx_case_event_type_time (event_type, occurred_at),

    CONSTRAINT chk_case_event_sequence_positive CHECK (event_sequence > 0)
);
```

Mengapa desain ini baik:

- `id` internal storage key.
- `(case_id, event_sequence)` memberi urutan domain.
- `occurred_at` dan `recorded_at` dibedakan.
- `payload JSON` cocok karena event berbeda-beda.
- `event_type` tetap kolom normal karena sering difilter.
- actor nullable karena event bisa berasal dari sistem.

Java:

```java
public final class CaseEvent {
    private Long id;
    private Long caseId;
    private long eventSequence;
    private String eventType;
    private Long actorUserId;
    private String sourceSystem;
    private Instant occurredAt;
    private Instant recordedAt;
    private JsonNode payload;
}
```

---

## 24. Anti-Patterns Tipe Data yang Sering Terjadi

### 24.1. `VARCHAR(255)` Everywhere

Gejala:

```sql
name VARCHAR(255),
status VARCHAR(255),
type VARCHAR(255),
code VARCHAR(255),
country VARCHAR(255),
currency VARCHAR(255)
```

Dampak:

- domain kabur,
- index besar,
- validasi lemah,
- query berat,
- migration sulit.

Perbaikan:

```sql
status VARCHAR(32)
type VARCHAR(32)
country_code CHAR(2)
currency_code CHAR(3)
external_ref VARCHAR(128)
```

### 24.2. `DOUBLE` untuk Money

Buruk:

```sql
balance DOUBLE
```

Baik:

```sql
balance DECIMAL(19, 4)
```

atau:

```sql
balance_minor BIGINT
```

### 24.3. `TEXT` untuk Semua String

Buruk:

```sql
status TEXT
email TEXT
code TEXT
```

Dampak:

- indexing buruk,
- temporary table berat,
- domain tidak jelas,
- storage lebih kompleks.

### 24.4. Nullable Semua Kolom

Buruk:

```sql
status VARCHAR(32) NULL
created_at DATETIME NULL
```

Baik:

```sql
status VARCHAR(32) NOT NULL
created_at DATETIME(6) NOT NULL
```

Nullable hanya untuk domain yang benar-benar optional/unknown/not applicable.

### 24.5. Timestamp Tanpa Kontrak Timezone

Buruk:

```sql
created_at TIMESTAMP
```

tanpa standar session timezone, JVM timezone, UI timezone.

Baik:

```sql
created_at DATETIME(6) NOT NULL
```

dengan konvensi UTC, atau:

```sql
created_at TIMESTAMP(6) NOT NULL
```

dengan session timezone eksplisit UTC.

### 24.6. UUID String sebagai Clustered Primary Key

Buruk:

```sql
id CHAR(36) PRIMARY KEY
```

Lebih baik:

```sql
id BINARY(16) PRIMARY KEY
```

atau gunakan `BIGINT`/sortable ID bila cocok.

### 24.7. JSON untuk Core Fields

Buruk:

```sql
data JSON -- contains status, assignee, dueDate, priority
```

Baik:

```sql
status VARCHAR(32)
assignee_user_id BIGINT
due_at DATETIME(6)
priority SMALLINT
attributes JSON
```

---

## 25. Decision Framework

Gunakan pertanyaan berikut saat memilih tipe data.

### 25.1. Untuk Angka

1. Apakah ini identifier?
   - Ya: `BIGINT`, `BINARY(16)`, atau sortable ID.
2. Apakah ini uang?
   - Ya: `DECIMAL` atau integer minor unit.
3. Apakah ini measurement approximate?
   - Ya: `DOUBLE` mungkin cocok.
4. Apakah ada range domain?
   - Gunakan tipe yang cukup dan CHECK.
5. Apakah bisa overflow dalam 5-10 tahun?
   - Jika mungkin, naikkan kapasitas dari awal.

### 25.2. Untuk String

1. Apakah panjangnya fixed?
   - Ya: `CHAR(n)`.
2. Apakah ini code?
   - Gunakan `CHAR`/`VARCHAR` kecil.
3. Apakah ini free text panjang?
   - `TEXT`.
4. Apakah ini token/hash?
   - Pertimbangkan `VARBINARY`.
5. Apakah comparison harus case-sensitive?
   - Perhatikan collation/binary.
6. Apakah field sering diindex?
   - Batasi panjang dan collation dengan sadar.

### 25.3. Untuk Waktu

1. Apakah ini tanggal kalender?
   - `DATE` + Java `LocalDate`.
2. Apakah ini instant audit?
   - `DATETIME(6)` UTC convention atau `TIMESTAMP(6)` dengan session timezone disiplin.
3. Apakah ini jadwal lokal?
   - `DATETIME(6)` + `timezone`.
4. Apakah ordering harus total?
   - Tambahkan sequence, jangan hanya timestamp.
5. Apakah precision penting?
   - Gunakan `(6)`.

### 25.4. Untuk JSON

1. Apakah field sering difilter/join/sort?
   - Jangan simpan hanya di JSON.
2. Apakah struktur bervariasi antar event/type?
   - JSON mungkin cocok.
3. Apakah perlu constraint relational?
   - Kolom normal/table normal.
4. Apakah butuh index?
   - Generated column/functional index, tapi evaluasi ulang desain.
5. Apakah payload untuk audit?
   - JSON cocok bila immutable.

---

## 26. Practical Checklist untuk Code Review Schema

Saat review DDL MySQL, tanyakan:

- Apakah setiap kolom punya tipe yang mencerminkan domain?
- Apakah ada `VARCHAR(255)` tanpa alasan?
- Apakah money memakai `DECIMAL`/minor unit, bukan `DOUBLE`?
- Apakah boolean diberi constraint 0/1?
- Apakah timestamp punya precision dan timezone convention?
- Apakah `NULL` digunakan secara sengaja?
- Apakah `DEFAULT` menyembunyikan bug?
- Apakah primary key terlalu besar?
- Apakah string indexed terlalu panjang?
- Apakah JSON menyembunyikan field core workflow?
- Apakah Java mapping aman?
- Apakah tipe data mendukung growth 5-10 tahun?
- Apakah constraint domain penting ditegakkan di DB?
- Apakah migration masa depan masih realistis?

---

## 27. Latihan

### Latihan 1: Perbaiki Schema

Schema awal:

```sql
CREATE TABLE enforcement_action (
    id VARCHAR(255) PRIMARY KEY,
    caseId VARCHAR(255),
    actionType VARCHAR(255),
    amount DOUBLE,
    currency VARCHAR(255),
    dueDate VARCHAR(255),
    completed BOOLEAN,
    createdAt TIMESTAMP,
    metadata TEXT
);
```

Tugas:

1. Ubah ke naming MySQL snake_case.
2. Pilih tipe data yang lebih tepat.
3. Tentukan nullability.
4. Tambahkan constraint penting.
5. Jelaskan Java mapping.

Salah satu kemungkinan jawaban:

```sql
CREATE TABLE enforcement_action (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    amount DECIMAL(19, 4) NULL,
    currency_code CHAR(3) NULL,
    due_date DATE NULL,
    is_completed TINYINT(1) NOT NULL DEFAULT 0,
    completed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    metadata JSON NULL,

    PRIMARY KEY (id),
    KEY idx_enforcement_action_case (case_id),
    KEY idx_enforcement_action_type_due (action_type, due_date),

    CONSTRAINT chk_enforcement_action_completed
      CHECK (is_completed IN (0, 1)),
    CONSTRAINT chk_enforcement_action_money_pair
      CHECK (
        (amount IS NULL AND currency_code IS NULL)
        OR
        (amount IS NOT NULL AND currency_code IS NOT NULL)
      )
);
```

### Latihan 2: Pilih Temporal Type

Untuk masing-masing field, pilih tipe MySQL dan Java:

| Field | MySQL | Java |
|---|---|---|
| Tanggal lahir subject | `DATE` | `LocalDate` |
| Waktu event audit terjadi | `DATETIME(6)` UTC atau `TIMESTAMP(6)` | `Instant` |
| Jadwal hearing lokal | `DATETIME(6)` + timezone column | `LocalDateTime` + `ZoneId` |
| Tanggal jatuh tempo dokumen | `DATE` | `LocalDate` |
| Durasi SLA dalam detik | `INT`/`BIGINT` | `int`/`long` |

### Latihan 3: Evaluasi JSON

Apakah field berikut boleh disimpan dalam JSON?

| Field | JSON? | Alasan |
|---|---|---|
| `case.status` | Tidak | core workflow, sering difilter |
| `event.payload.previousStatus` | Ya | event snapshot |
| `case.dynamic_form_answers` | Mungkin | tergantung query/reporting |
| `subject.national_id` | Tidak | identity core, perlu constraint/security |
| `external_api_raw_response` | Ya | snapshot integration |
| `case.priority` | Tidak | queue/filter/sort |

---

## 28. Ringkasan Mental Model

Tipe data MySQL harus dipilih dengan mempertimbangkan:

```text
domain meaning
+ physical storage
+ index cost
+ optimizer behavior
+ Java mapping
+ production migration
+ auditability
```

Kesimpulan penting:

1. `VARCHAR(255)` bukan default universal.
2. `DOUBLE` bukan untuk uang.
3. `BOOLEAN` adalah `TINYINT(1)`, tambahkan constraint bila perlu.
4. `DATETIME` tidak menyimpan timezone.
5. `TIMESTAMP` melakukan conversion berdasarkan session timezone.
6. `DATE` map ke `LocalDate`, bukan instant.
7. `DECIMAL` map ke `BigDecimal`.
8. Primary key besar memperbesar semua secondary index InnoDB.
9. JSON cocok untuk semi-structured metadata, bukan core workflow fields.
10. Nullability adalah bagian dari domain, bukan detail teknis.
11. Constraint di DB adalah lapisan pertahanan, bukan musuh aplikasi.
12. Java type harus selaras dengan tipe SQL, bukan sekadar “yang bisa jalan”.

---

## 29. Referensi Utama

- MySQL 8.4 Reference Manual — Data Types.
- MySQL 8.4 Reference Manual — Numeric Data Types.
- MySQL 8.4 Reference Manual — Date and Time Data Types.
- MySQL 8.4 Reference Manual — JSON Data Type.
- MySQL Server Time Zone Support.
- MySQL Connector/J Developer Guide — datetime/timezone processing.
- Java `java.time` API: `Instant`, `LocalDate`, `LocalDateTime`, `OffsetDateTime`, `ZonedDateTime`.
- JDBC type mapping documentation.

---

## 30. Penutup

Bagian ini membangun fondasi bahwa tipe data adalah keputusan desain sistem.

Di bagian berikutnya, kita akan masuk lebih dalam ke:

```text
Character Sets, Collations, and Text Comparison Bugs
```

Ini penting karena banyak bug MySQL production bukan berasal dari query yang salah, tetapi dari asumsi string comparison yang salah:

- case-insensitive comparison,
- accent-insensitive comparison,
- collation mismatch,
- index behavior,
- sorting nama manusia,
- token yang tidak exact,
- Unicode/emoji,
- migration dari `latin1`,
- dan perbedaan antara Java `String.equals()` dengan MySQL collation comparison.

Status seri: belum selesai. Ini baru Part 004 dari 034.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Primary Key Design in MySQL: The Hidden Architecture Decision</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-005.md">Part 005 — Character Sets, Collations, and Text Comparison Bugs ➡️</a>
</div>
