# learn-mysql-mastery-for-java-engineers-part-005.md

# Part 005 — Character Sets, Collations, and Text Comparison Bugs

## Status Seri

- Seri: `learn-mysql-mastery-for-java-engineers`
- Part: `005 / 034`
- Status: **belum selesai**
- Bagian sebelumnya: `part-004` — MySQL Data Types: Physical Cost, Semantics, and Java Mapping
- Bagian ini: **Character Sets, Collations, and Text Comparison Bugs**
- Bagian berikutnya: `part-006` — InnoDB MVCC: Read Views, Undo Logs, and Consistent Reads

---

## 1. Tujuan Bagian Ini

Banyak engineer menganggap character set dan collation sebagai detail konfigurasi kecil:

> “Yang penting pakai UTF-8.”

Di MySQL, asumsi itu terlalu dangkal.

Character set dan collation mempengaruhi:

- apakah karakter tertentu bisa disimpan;
- apakah dua string dianggap sama;
- bagaimana `ORDER BY` mengurutkan data;
- apakah `UNIQUE INDEX` menolak atau menerima nilai tertentu;
- apakah query bisa memakai index dengan efisien;
- berapa besar index untuk kolom teks;
- bagaimana Java `String` dipetakan ke database;
- bagaimana migration lama dari `latin1` atau `utf8mb3` dilakukan;
- apakah pencarian nama orang, organisasi, nomor dokumen, dan kode legal menjadi valid secara semantik.

Untuk sistem enforcement, regulatory, compliance, case management, atau workflow yang menyimpan nama subjek, badan hukum, alamat, kode perkara, nomor izin, identifier eksternal, dan free-text evidence, kesalahan collation dapat berubah dari sekadar bug teknis menjadi masalah defensibilitas data.

Bagian ini akan membangun mental model yang presisi:

> **Character set menentukan karakter apa yang bisa disimpan. Collation menentukan bagaimana karakter dibandingkan dan diurutkan.**

Dua hal ini tidak boleh dicampuradukkan.

---

## 2. Core Mental Model

### 2.1 Character Set

Character set adalah kumpulan karakter dan encoding yang digunakan untuk menyimpan teks.

Contoh:

- `latin1`
- `utf8mb3`
- `utf8mb4`
- `ascii`
- `binary`

Di MySQL modern, default yang biasanya diharapkan untuk aplikasi baru adalah:

```sql
CHARACTER SET utf8mb4
```

Kenapa bukan sekadar `utf8`?

Secara historis, MySQL `utf8` lama merujuk ke `utf8mb3`, yaitu encoding UTF-8 maksimum 3 byte per karakter. Itu tidak bisa menyimpan seluruh Unicode, termasuk banyak emoji dan beberapa karakter supplementary plane.

`utf8mb4` mendukung sampai 4 byte per karakter dan merupakan pilihan aman untuk sistem modern.

Mental model:

```text
character set = bagaimana karakter direpresentasikan sebagai byte
```

---

### 2.2 Collation

Collation adalah aturan perbandingan dan pengurutan string dalam character set tertentu.

Contoh collation untuk `utf8mb4`:

- `utf8mb4_0900_ai_ci`
- `utf8mb4_0900_as_cs`
- `utf8mb4_bin`
- `utf8mb4_unicode_ci`
- `utf8mb4_general_ci`

Suffix umum:

| Suffix | Arti | Dampak |
|---|---|---|
| `_ci` | case-insensitive | `abc` dan `ABC` dianggap sama |
| `_cs` | case-sensitive | `abc` dan `ABC` dianggap berbeda |
| `_ai` | accent-insensitive | `e` dan `é` dianggap sama |
| `_as` | accent-sensitive | `e` dan `é` dianggap berbeda |
| `_bin` | binary comparison | dibandingkan berdasarkan byte/code point |

Mental model:

```text
collation = bagaimana dua string dibandingkan dan diurutkan
```

Contoh:

```sql
SELECT 'a' = 'A' COLLATE utf8mb4_0900_ai_ci;
-- bisa bernilai true

SELECT 'a' = 'A' COLLATE utf8mb4_bin;
-- false
```

Yang sering mengejutkan engineer:

> Collation bukan hanya mempengaruhi `ORDER BY`. Collation juga mempengaruhi equality, uniqueness, join predicate, grouping, dan index behavior.

---

## 3. Kenapa Ini Penting untuk Java Engineer

Java `String` adalah sequence Unicode code units. Di level aplikasi, kita sering berpikir bahwa:

```java
"ABC".equals("abc") == false
```

Tetapi di MySQL, hasil perbandingan dapat berbeda tergantung collation:

```sql
SELECT 'ABC' = 'abc';
```

Pada collation case-insensitive, hasilnya bisa `1`.

Artinya:

```text
Java equality != database equality
```

Ini berbahaya untuk:

- validasi duplicate sebelum insert;
- unique constraint;
- login username;
- email uniqueness;
- external reference number;
- legal identifier;
- case number;
- API idempotency key;
- audit key;
- state transition guard;
- deduplication logic;
- cache key.

Jika aplikasi menganggap dua string berbeda, tetapi database menganggap sama, insert bisa gagal karena duplicate key.

Jika aplikasi menganggap dua string sama, tetapi database menganggap berbeda, duplicate data bisa masuk.

---

## 4. Levels of Character Set and Collation

Di MySQL, character set dan collation dapat ditentukan di beberapa level:

1. server;
2. database/schema;
3. table;
4. column;
5. expression/literal;
6. connection/session.

Urutannya penting karena default diwariskan.

### 4.1 Database Level

```sql
CREATE DATABASE enforcement_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

### 4.2 Table Level

```sql
CREATE TABLE cases (
  id BIGINT PRIMARY KEY,
  case_number VARCHAR(64) NOT NULL,
  subject_name VARCHAR(255) NOT NULL
) CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

### 4.3 Column Level

```sql
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  username VARCHAR(100)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_as_cs NOT NULL,
  display_name VARCHAR(255)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL
);
```

Column-level collation override sering dibutuhkan karena tidak semua teks punya semantik yang sama.

Contoh:

| Kolom | Semantik | Collation yang mungkin cocok |
|---|---|---|
| `display_name` | nama manusia untuk pencarian fleksibel | accent-insensitive, case-insensitive |
| `username` | identifier login | case-sensitive atau normalized lowercase |
| `case_number` | kode resmi | binary/case-sensitive atau normalized uppercase |
| `external_reference` | identifier dari sistem lain | biasanya case-sensitive |
| `email` | umumnya dibandingkan lowercase normalized | bisa case-insensitive setelah normalisasi |
| `free_text_note` | text search biasa | collation human-friendly |
| `idempotency_key` | byte-exact token | binary/case-sensitive |

---

## 5. `utf8mb4`: Default Modern yang Seharusnya Dipakai

Untuk sistem baru, gunakan `utf8mb4` kecuali ada alasan kuat untuk tidak menggunakannya.

Rekomendasi dasar:

```sql
CREATE DATABASE appdb
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

Kenapa `utf8mb4_0900_ai_ci`?

Karena pada MySQL 8.0+, collation `0900` didasarkan pada Unicode Collation Algorithm versi yang lebih baru dibanding keluarga collation lama seperti `utf8mb4_general_ci` dan `utf8mb4_unicode_ci`.

Namun default ini bukan berarti selalu benar untuk semua kolom.

Prinsip yang lebih presisi:

```text
Gunakan utf8mb4 sebagai character set default.
Pilih collation per semantic field, bukan hanya ikut default global.
```

---

## 6. Case Sensitivity

### 6.1 Contoh Perbandingan Case-Insensitive

```sql
CREATE TABLE accounts_ci (
  username VARCHAR(100)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL,
  UNIQUE KEY uq_username (username)
);

INSERT INTO accounts_ci(username) VALUES ('admin');
INSERT INTO accounts_ci(username) VALUES ('ADMIN');
-- Duplicate key error, karena collation case-insensitive
```

Database menganggap `admin` dan `ADMIN` sama.

### 6.2 Contoh Perbandingan Case-Sensitive

```sql
CREATE TABLE accounts_cs (
  username VARCHAR(100)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_as_cs NOT NULL,
  UNIQUE KEY uq_username (username)
);

INSERT INTO accounts_cs(username) VALUES ('admin');
INSERT INTO accounts_cs(username) VALUES ('ADMIN');
-- Berhasil, karena case-sensitive
```

### 6.3 Mana yang Benar?

Tidak ada jawaban universal.

Untuk username, biasanya ada dua pendekatan valid:

#### Approach A — Normalize di aplikasi

```text
Store username canonical lowercase.
Display name disimpan terpisah.
UNIQUE(username_canonical).
```

Contoh:

```sql
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  username_display VARCHAR(100) NOT NULL,
  username_canonical VARCHAR(100)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  UNIQUE KEY uq_username_canonical (username_canonical)
);
```

Java:

```java
String canonical = username.trim().toLowerCase(Locale.ROOT);
```

Kelebihan:

- aturan jelas;
- tidak tergantung collation untuk business identity;
- mudah dipakai sebagai cache key;
- portable ke sistem lain.

Kekurangan:

- harus disiplin di semua write path;
- perlu aturan normalisasi yang eksplisit.

#### Approach B — Biarkan database collation case-insensitive

```sql
username VARCHAR(100) COLLATE utf8mb4_0900_ai_ci UNIQUE
```

Kelebihan:

- sederhana;
- database menolak duplicate case variant.

Kekurangan:

- equality di aplikasi dan database bisa berbeda;
- cache/key comparison raw string bisa keliru;
- cross-system integration bisa mengejutkan.

Untuk sistem serius, approach A biasanya lebih defensible.

---

## 7. Accent Sensitivity

Accent sensitivity menentukan apakah karakter beraksen dianggap sama dengan karakter tanpa aksen.

Contoh konseptual:

```sql
SELECT 'Jose' = 'José' COLLATE utf8mb4_0900_ai_ci;
-- true, accent-insensitive

SELECT 'Jose' = 'José' COLLATE utf8mb4_0900_as_cs;
-- false, accent-sensitive
```

Untuk nama manusia, accent-insensitive bisa membantu pencarian.

Namun untuk legal record, kita perlu hati-hati.

Misalnya:

- `José Alvarez`
- `Jose Alvarez`

Apakah itu orang yang sama?

Tidak selalu.

Untuk search UI, mungkin ingin keduanya match.

Untuk legal identity atau duplicate enforcement, tidak boleh hanya bergantung pada collation accent-insensitive.

Mental model:

```text
Search friendliness dan legal identity bukan hal yang sama.
```

Desain yang lebih baik:

```text
raw_legal_name        = nilai asli sebagaimana dokumen
search_normalized_name = nilai hasil normalisasi untuk pencarian
identity_key          = identifier lain yang lebih kuat jika tersedia
```

Contoh:

```sql
CREATE TABLE regulated_subjects (
  id BIGINT PRIMARY KEY,
  legal_name VARCHAR(512)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_as_cs NOT NULL,
  legal_name_search VARCHAR(512)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL,
  national_id VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NULL,
  UNIQUE KEY uq_national_id (national_id),
  KEY idx_legal_name_search (legal_name_search)
);
```

---

## 8. Binary Collation

Binary collation membandingkan string secara byte/code-point oriented.

```sql
VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
```

Gunakan binary collation untuk nilai yang secara semantik adalah token/identifier, bukan bahasa manusia.

Contoh cocok:

- API token;
- idempotency key;
- external event ID;
- correlation ID;
- request ID;
- case code jika case-sensitive;
- cryptographic hash text representation;
- canonical encoded value.

Contoh kurang cocok:

- nama orang;
- alamat;
- nama organisasi;
- deskripsi;
- catatan investigator.

### 8.1 `VARBINARY` vs `VARCHAR ... COLLATE utf8mb4_bin`

Untuk data benar-benar byte-oriented, gunakan `BINARY` / `VARBINARY`.

Untuk data teks yang ingin dibandingkan secara case-sensitive/code-sensitive, gunakan `VARCHAR` dengan binary collation.

Contoh:

```sql
-- text token, masih valid UTF-8
idempotency_key VARCHAR(128)
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_bin NOT NULL

-- raw bytes
payload_hash BINARY(32) NOT NULL
```

---

## 9. Unique Index dan Collation

Ini salah satu area paling sering menyebabkan bug.

```sql
CREATE TABLE documents (
  id BIGINT PRIMARY KEY,
  document_number VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL,
  UNIQUE KEY uq_document_number (document_number)
);
```

Dengan collation case-insensitive:

```sql
INSERT INTO documents VALUES (1, 'ABC-001');
INSERT INTO documents VALUES (2, 'abc-001');
-- duplicate key
```

Apakah ini benar?

Tergantung aturan bisnis.

Untuk nomor dokumen resmi, biasanya kita butuh satu dari dua strategi:

### Strategi 1 — Canonical uppercase

```sql
CREATE TABLE documents (
  id BIGINT PRIMARY KEY,
  document_number_raw VARCHAR(64) NOT NULL,
  document_number_canonical VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  UNIQUE KEY uq_document_number_canonical (document_number_canonical)
);
```

Java:

```java
String canonical = raw.trim().toUpperCase(Locale.ROOT);
```

### Strategi 2 — Exact preserved identifier

```sql
CREATE TABLE documents (
  id BIGINT PRIMARY KEY,
  document_number VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  UNIQUE KEY uq_document_number (document_number)
);
```

Gunakan jika `ABC-001` dan `abc-001` memang berbeda secara resmi.

### Kesimpulan

Jangan membuat `UNIQUE` pada kolom teks tanpa memutuskan:

```text
Apakah uniqueness-nya case-sensitive?
Apakah accent-sensitive?
Apakah whitespace normalized?
Apakah punctuation normalized?
Apakah Unicode normalized?
```

---

## 10. Sorting Behavior

`ORDER BY` pada string tidak selalu byte order.

Contoh:

```sql
SELECT name
FROM subjects
ORDER BY name;
```

Urutannya bergantung pada collation kolom `name`.

Ini penting untuk:

- pagination;
- alphabetical lists;
- export report;
- deterministic ordering;
- legal document generation;
- cursor-based pagination.

### 10.1 Sorting dan Pagination

Jika query:

```sql
SELECT id, name
FROM subjects
ORDER BY name
LIMIT 50 OFFSET 1000;
```

Maka urutan `name` mengikuti collation.

Jika ada banyak nama yang dianggap equal oleh collation, urutan antar row bisa tidak stabil jika tidak diberi tie-breaker.

Lebih aman:

```sql
SELECT id, name
FROM subjects
ORDER BY name, id
LIMIT 50 OFFSET 1000;
```

Untuk keyset pagination:

```sql
SELECT id, name
FROM subjects
WHERE (name, id) > (?, ?)
ORDER BY name, id
LIMIT 50;
```

Namun ingat: comparison terhadap `name` tetap mengikuti collation.

Jika collation case-insensitive, maka `'abc'`, `'ABC'`, dan `'Abc'` bisa memiliki perbandingan yang tidak intuitif.

Untuk pagination yang benar-benar deterministic, tie-breaker primary key wajib.

---

## 11. Index Size dan `VARCHAR(255)`

`VARCHAR(255)` sering dipakai sebagai default malas.

Di `utf8mb4`, satu karakter dapat memakai sampai 4 byte.

Maka secara maksimum:

```text
VARCHAR(255) ≈ sampai 1020 byte untuk payload karakter
```

Belum termasuk overhead internal.

Dampaknya:

- index lebih besar;
- page fanout lebih rendah;
- lebih banyak page read;
- buffer pool lebih cepat penuh;
- composite index bisa membesar;
- temporary table/sort cost meningkat;
- memory per operation naik.

Prinsip:

```text
Panjang kolom teks adalah keputusan kapasitas, bukan dekorasi schema.
```

Contoh lebih baik:

```sql
email VARCHAR(320) NOT NULL
country_code CHAR(2) NOT NULL
case_number VARCHAR(64) NOT NULL
idempotency_key VARCHAR(128) NOT NULL
status VARCHAR(32) NOT NULL
```

Jangan otomatis:

```sql
VARCHAR(255)
```

Untuk semua hal.

---

## 12. Prefix Indexes

Untuk kolom teks panjang, kadang index penuh terlalu mahal atau tidak diperbolehkan dalam desain tertentu.

MySQL mendukung prefix index:

```sql
CREATE INDEX idx_subject_name_prefix
ON subjects (legal_name(100));
```

Artinya hanya 100 karakter awal yang diindex.

Kelebihan:

- index lebih kecil;
- bisa membantu prefix search;
- mengurangi storage.

Kekurangan:

- tidak selalu cukup selektif;
- tidak bisa selalu menjadi covering index penuh;
- uniqueness prefix bisa berbahaya;
- query yang membutuhkan full comparison tetap perlu cek row.

Hindari unique prefix index kecuali benar-benar paham konsekuensinya.

Contoh berbahaya:

```sql
CREATE UNIQUE INDEX uq_name_prefix
ON subjects (legal_name(10));
```

Ini berarti dua nama yang sama pada 10 karakter awal bisa dianggap duplicate oleh index, walau full name berbeda.

---

## 13. Collation Mismatch Error

Salah satu error umum:

```text
Illegal mix of collations
```

Ini terjadi saat MySQL harus membandingkan dua string dengan collation yang tidak compatible atau tidak bisa ditentukan coercion-nya.

Contoh situasi:

```sql
SELECT *
FROM a
JOIN b ON a.code = b.code;
```

Jika:

```text
a.code = utf8mb4_0900_ai_ci
b.code = utf8mb4_bin
```

maka hasil comparison bisa:

- gagal;
- memakai coercion tertentu;
- tidak memakai index seperti yang diharapkan;
- menghasilkan behavior yang sulit dipahami.

### 13.1 Solusi Buruk

```sql
SELECT *
FROM a
JOIN b ON a.code COLLATE utf8mb4_bin = b.code;
```

Ini bisa menyelesaikan error, tetapi mungkin membuat query tidak sargable atau mengubah plan.

### 13.2 Solusi Baik

Samakan definisi semantic field di schema.

Jika `code` adalah identifier exact:

```sql
code VARCHAR(64)
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_bin NOT NULL
```

Gunakan definisi yang sama di semua table yang menyimpan nilai sejenis.

Prinsip:

```text
Collation compatibility harus didesain di schema, bukan ditambal di query.
```

---

## 14. Connection Character Set

Selain column/table/database, connection juga punya character set.

Saat Java mengirim string ke MySQL, ada proses encoding/decoding melalui Connector/J dan server connection variables.

Masalah dapat muncul jika:

- database/table `utf8mb4`, tetapi connection tidak diset benar;
- legacy JDBC URL memakai konfigurasi lama;
- migration dari sistem lama menyimpan byte yang salah;
- aplikasi membaca data sebagai mojibake.

Contoh mojibake:

```text
José -> JosÃ©
```

Atau:

```text
Müller -> MÃ¼ller
```

Ini bukan sekadar tampilan. Data byte di database bisa sudah rusak.

### 14.1 Prinsip Untuk Java Modern

Gunakan driver modern dan pastikan:

- database default `utf8mb4`;
- table/column tidak legacy `latin1`;
- JDBC URL tidak membawa opsi lama yang bertentangan;
- test menyimpan dan membaca karakter non-ASCII;
- test menyimpan emoji jika domain mengizinkan.

Contoh test sederhana:

```java
String original = "José Müller 👩‍⚖️ Jakarta";
repository.save(original);
String loaded = repository.find(...);
assertEquals(original, loaded);
```

Jika test ini gagal, ada masalah encoding.

---

## 15. `latin1` Legacy Trap

Banyak database MySQL lama dibuat dengan `latin1` default.

Masalahnya tidak selalu terlihat karena:

- karakter ASCII tetap aman;
- aplikasi lama mungkin encode/decode secara tidak konsisten tetapi “terlihat benar”;
- data sudah terlanjur rusak tapi UI menampilkannya seolah benar;
- migration naïf bisa menggandakan kerusakan.

### 15.1 Dua Jenis Masalah Legacy

#### Case A — Data benar-benar latin1

Byte di database memang latin1 dan perlu dikonversi ke utf8mb4.

#### Case B — UTF-8 bytes disimpan di kolom latin1

Ini sering disebut “double encoding” atau mojibake legacy.

Contoh:

```text
Original: é
UTF-8 bytes: C3 A9
Disimpan seolah latin1: Ã©
```

Jika langsung:

```sql
ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4;
```

bisa mempermanenkan mojibake.

### 15.2 Migration Strategy

Jangan langsung convert production tanpa profiling data.

Langkah aman:

1. inventory charset/collation semua schema/table/column;
2. sample data non-ASCII;
3. deteksi mojibake pattern;
4. tentukan apakah data actual latin1 atau misencoded UTF-8;
5. buat migration script teruji;
6. lakukan rehearsal di copy database;
7. validasi row count, checksum, sample semantic;
8. backup sebelum cutover;
9. monitor error aplikasi setelah migration.

Query inventory:

```sql
SELECT
  table_schema,
  table_name,
  column_name,
  character_set_name,
  collation_name,
  data_type,
  character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'your_db'
  AND character_set_name IS NOT NULL
ORDER BY table_name, ordinal_position;
```

---

## 16. Unicode Normalization Trap

Unicode memiliki lebih dari satu cara merepresentasikan karakter yang secara visual sama.

Contoh konseptual:

```text
é
```

Bisa direpresentasikan sebagai:

```text
U+00E9 LATIN SMALL LETTER E WITH ACUTE
```

atau:

```text
U+0065 LATIN SMALL LETTER E + U+0301 COMBINING ACUTE ACCENT
```

Secara visual mirip, tetapi byte berbeda.

Java `String.equals()` akan menganggapnya berbeda jika code unit berbeda.

Database collation tertentu mungkin menganggapnya sama atau berbeda tergantung aturan.

Untuk identifier, ini berbahaya.

### 16.1 Solusi: Normalisasi Eksplisit

Untuk field yang menjadi key, lakukan Unicode normalization di aplikasi.

Java:

```java
import java.text.Normalizer;

String canonical = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Untuk identifier yang case-insensitive:

```java
String canonical = Normalizer.normalize(input, Normalizer.Form.NFC)
    .trim()
    .toLowerCase(Locale.ROOT);
```

Untuk free text/nama legal, jangan sembarangan mengubah raw value.

Pola yang lebih aman:

```text
raw value preserved
canonical/search value derived
```

---

## 17. Whitespace and Invisible Character Bugs

String yang terlihat sama bisa berbeda karena:

- leading/trailing spaces;
- multiple spaces;
- non-breaking space;
- zero-width joiner;
- zero-width non-joiner;
- newline;
- tab;
- carriage return;
- Unicode homoglyph;
- smart quote vs normal quote.

Contoh:

```text
"ABC-001"
"ABC-001 "
"ABC‑001"   -- non-breaking hyphen
"АBC-001"   -- huruf A Cyrillic, bukan Latin A
```

Untuk sistem enforcement, ini sangat penting pada:

- nomor dokumen;
- kode perkara;
- nomor izin;
- nomor registrasi;
- nama entitas hukum;
- alamat;
- imported CSV/Excel;
- data dari external agency.

### 17.1 Canonicalization Pipeline

Untuk field identifier:

```text
input raw
  -> trim
  -> Unicode normalize
  -> whitespace normalize
  -> case normalize if applicable
  -> punctuation normalize if applicable
  -> validate allowed characters
  -> store raw + canonical
```

Contoh Java:

```java
static String canonicalizeCaseNumber(String input) {
    if (input == null) throw new IllegalArgumentException("case number is required");

    String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
    normalized = normalized.trim();
    normalized = normalized.replaceAll("\\s+", "");
    normalized = normalized.toUpperCase(Locale.ROOT);

    if (!normalized.matches("[A-Z0-9\\-_/]+")) {
        throw new IllegalArgumentException("invalid case number format");
    }

    return normalized;
}
```

Catatan: regex di atas hanya contoh. Aturan sebenarnya harus mengikuti domain.

---

## 18. `CHAR` vs `VARCHAR` and Trailing Space Semantics

MySQL memiliki behavior yang perlu dipahami terkait `CHAR` dan trailing spaces.

`CHAR(N)` menyimpan fixed-length string secara logis dan sering memiliki padding semantics.

Untuk kode fixed length seperti country code:

```sql
country_code CHAR(2) NOT NULL
```

masuk akal.

Untuk identifier variable length:

```sql
case_number VARCHAR(64) NOT NULL
```

lebih aman.

Hati-hati pada perbandingan string dengan trailing spaces. Dalam beberapa konteks SQL dan collation, trailing spaces dapat diabaikan atau diperlakukan khusus.

Prinsip:

```text
Jangan gunakan trailing spaces sebagai informasi bisnis.
```

Untuk token byte-exact, gunakan `VARBINARY` atau canonical text dengan binary collation.

---

## 19. Collation and LIKE Queries

Query:

```sql
SELECT *
FROM subjects
WHERE legal_name LIKE 'jo%';
```

Behavior matching tergantung collation.

Jika collation case-insensitive:

```text
jo% dapat match Jo, JO, jó, JÓ tergantung accent sensitivity
```

Jika binary:

```text
jo% hanya match byte/code exact prefix
```

### 19.1 Index Use

Prefix `LIKE 'abc%'` bisa memakai index dalam banyak kondisi.

Leading wildcard:

```sql
WHERE legal_name LIKE '%abc%'
```

biasanya tidak bisa memakai B-tree index secara efisien.

Ini bukan hanya masalah MySQL, tetapi B-tree secara umum.

Untuk search UI, jangan menganggap collation menyelesaikan semua kebutuhan search.

Gunakan:

- normalized search column;
- prefix search;
- full-text index;
- external search engine jika kebutuhan search kompleks.

---

## 20. Full-Text Search and Collation

MySQL memiliki full-text index, tetapi full-text search bukan pengganti search engine seperti Elasticsearch/OpenSearch untuk semua use case.

Full-text search dapat berguna untuk:

- pencarian catatan sederhana;
- keyword matching;
- small/medium workload;
- aplikasi yang tidak membutuhkan ranking/search pipeline kompleks.

Namun untuk:

- stemming multi-language;
- typo tolerance;
- fuzzy matching;
- advanced relevance tuning;
- synonym;
- faceted search besar;
- audit-grade search explainability;
- high-volume search UI;

search engine khusus sering lebih tepat.

Collation tetap penting karena field asal dan normalized field tetap perlu konsisten.

---

## 21. Collation and GROUP BY / DISTINCT

`GROUP BY` pada kolom teks mengikuti collation.

Contoh:

```sql
SELECT username, COUNT(*)
FROM users
GROUP BY username;
```

Jika collation case-insensitive, maka `admin`, `Admin`, dan `ADMIN` bisa digabung dalam satu group.

Begitu juga:

```sql
SELECT DISTINCT username
FROM users;
```

Dapat menghilangkan variasi yang secara raw berbeda tetapi dianggap sama oleh collation.

Ini berdampak pada:

- report;
- deduplication;
- export;
- data quality analysis;
- migration validation;
- reconciliation.

Untuk audit atau investigasi data, sering perlu query binary/exact.

Contoh:

```sql
SELECT BINARY username, COUNT(*)
FROM users
GROUP BY BINARY username;
```

Namun jangan jadikan `BINARY` di query sebagai desain permanen. Kalau exact semantics penting, desain kolomnya begitu sejak awal.

---

## 22. Collation and Joins

Join pada text column mengikuti collation.

```sql
SELECT *
FROM external_events e
JOIN cases c
  ON e.case_number = c.case_number;
```

Jika `case_number` case-insensitive, maka:

```text
abc-001 == ABC-001
```

Jika domain mengatakan itu sama, oke.

Jika tidak, join menghasilkan false positive.

Lebih buruk lagi, jika satu table menyimpan raw dan table lain menyimpan canonical, join bisa silently salah.

Desain yang lebih baik:

```sql
CREATE TABLE cases (
  id BIGINT PRIMARY KEY,
  case_number_raw VARCHAR(64) NOT NULL,
  case_number_canonical VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  UNIQUE KEY uq_case_number_canonical (case_number_canonical)
);

CREATE TABLE external_events (
  id BIGINT PRIMARY KEY,
  case_number_raw VARCHAR(64) NOT NULL,
  case_number_canonical VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  KEY idx_case_number_canonical (case_number_canonical)
);
```

Join:

```sql
SELECT *
FROM external_events e
JOIN cases c
  ON e.case_number_canonical = c.case_number_canonical;
```

---

## 23. Designing Text Columns by Semantic Category

Jangan desain semua text column sama.

Gunakan kategori semantik.

### 23.1 Human Language Text

Contoh:

- display name;
- legal name;
- address;
- description;
- notes.

Biasanya:

```sql
CHARACTER SET utf8mb4
COLLATE utf8mb4_0900_ai_ci
```

atau accent-sensitive jika legal exactness lebih penting.

### 23.2 Machine Identifier

Contoh:

- idempotency key;
- external ID;
- request ID;
- hash string;
- event ID;
- tenant code jika case-sensitive.

Biasanya:

```sql
CHARACTER SET utf8mb4
COLLATE utf8mb4_bin
```

atau `VARBINARY` jika benar-benar bytes.

### 23.3 Canonical Business Identifier

Contoh:

- case number canonical;
- license number canonical;
- registration number canonical.

Biasanya:

```sql
VARCHAR(...)
CHARACTER SET utf8mb4
COLLATE utf8mb4_bin
```

Nilai sudah dinormalisasi aplikasi.

### 23.4 Search Helper Column

Contoh:

- normalized subject name;
- normalized organization name;
- address search key.

Biasanya:

```sql
COLLATE utf8mb4_0900_ai_ci
```

Atau pendekatan generated column jika normalisasi cukup sederhana.

---

## 24. Schema Example: Regulatory Case System

Contoh table yang lebih sadar semantik:

```sql
CREATE TABLE enforcement_cases (
  id BIGINT NOT NULL PRIMARY KEY,

  case_number_raw VARCHAR(128)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_as_cs NOT NULL,

  case_number_canonical VARCHAR(128)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,

  title VARCHAR(512)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL,

  subject_legal_name VARCHAR(512)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_as_cs NOT NULL,

  subject_name_search VARCHAR(512)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL,

  external_reference VARCHAR(128)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NULL,

  created_by_username VARCHAR(128)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,

  UNIQUE KEY uq_case_number_canonical (case_number_canonical),
  KEY idx_subject_name_search (subject_name_search),
  KEY idx_external_reference (external_reference),
  KEY idx_created_by_username (created_by_username)
) CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

Perhatikan:

- table default human-friendly;
- identifier override ke binary;
- legal raw name accent/case-sensitive;
- search field accent/case-insensitive;
- canonical case number unique exact.

Ini jauh lebih defensible daripada:

```sql
CREATE TABLE enforcement_cases (
  id BIGINT PRIMARY KEY,
  case_number VARCHAR(255),
  title VARCHAR(255),
  subject_name VARCHAR(255),
  external_reference VARCHAR(255)
);
```

---

## 25. Java Entity Design

Jangan hanya punya satu field jika domain membutuhkan raw dan canonical.

Contoh value object:

```java
public record CaseNumber(String raw, String canonical) {
    public CaseNumber {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("case number is required");
        }
        canonical = canonicalize(raw);
    }

    private static String canonicalize(String value) {
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFC);
        normalized = normalized.trim();
        normalized = normalized.replaceAll("\\s+", "");
        normalized = normalized.toUpperCase(Locale.ROOT);
        return normalized;
    }
}
```

Entity:

```java
@Entity
@Table(name = "enforcement_cases")
public class EnforcementCase {

    @Id
    private Long id;

    @Column(name = "case_number_raw", nullable = false, length = 128)
    private String caseNumberRaw;

    @Column(name = "case_number_canonical", nullable = false, length = 128, unique = true)
    private String caseNumberCanonical;

    protected EnforcementCase() {}

    public EnforcementCase(Long id, CaseNumber caseNumber) {
        this.id = id;
        this.caseNumberRaw = caseNumber.raw();
        this.caseNumberCanonical = caseNumber.canonical();
    }
}
```

Important principle:

```text
Database constraints protect invariants.
Java value objects produce canonical data.
Do not rely on UI validation only.
```

---

## 26. Collation and Caching Bugs

Misalnya database `username` case-insensitive.

Database:

```sql
username VARCHAR(100) COLLATE utf8mb4_0900_ai_ci UNIQUE
```

Java cache:

```java
Map<String, User> byUsername = new ConcurrentHashMap<>();
byUsername.put("Admin", user1);
byUsername.put("admin", user2);
```

Java map menganggap dua key berbeda.

Database menganggap sama.

Ini dapat menyebabkan:

- cache inconsistency;
- duplicate processing;
- wrong authorization lookup;
- failed insert only in production;
- race condition saat concurrent create.

Solusi:

```java
String key = canonicalizeUsername(input);
cache.put(key, user);
```

Gunakan canonical key yang sama dengan uniqueness database.

---

## 27. Collation and API Contract

Jika API menerima identifier teks, kontrak harus jelas.

Contoh buruk:

```http
GET /cases/abc-001
GET /cases/ABC-001
```

Apakah dua request itu sama?

Jika tidak dijelaskan, client bisa membuat asumsi salah.

API contract yang lebih baik:

```text
caseNumber is case-insensitive.
Server canonicalizes by trimming whitespace and converting to uppercase using Locale.ROOT.
Response preserves original submitted representation separately as displayCaseNumber.
```

Atau:

```text
caseNumber is case-sensitive and must be supplied exactly as issued.
```

Collation database harus mendukung kontrak itu, bukan bertentangan dengannya.

---

## 28. Testing Strategy

Tambahkan test khusus character/collation.

### 28.1 Equality Test

```sql
SELECT 'abc' = 'ABC' COLLATE utf8mb4_0900_ai_ci;
SELECT 'abc' = 'ABC' COLLATE utf8mb4_bin;
```

### 28.2 Unique Constraint Test

Test insert:

- `ABC-001`
- `abc-001`
- `ÁBC-001`
- `ÁBC-001` using combining mark
- `ABC-001 ` trailing space
- `ABC‑001` non-breaking hyphen

### 28.3 Roundtrip Test

Java integration test:

```java
@ParameterizedTest
@ValueSource(strings = {
    "José",
    "Müller",
    "Siti Nurhaliza",
    "株式会社東京",
    "👩‍⚖️ enforcement",
    "A\u0301BC",
    "ABC-001",
    "ABC‑001"
})
void textRoundtripShouldPreserveValue(String input) {
    repository.save(input);
    assertEquals(input, repository.loadLast());
}
```

### 28.4 Sorting Test

Test `ORDER BY` untuk data:

```text
A
Á
a
á
B
b
```

Pastikan hasilnya sesuai ekspektasi bisnis.

---

## 29. Operational Inventory Queries

### 29.1 Check Database Defaults

```sql
SELECT
  schema_name,
  default_character_set_name,
  default_collation_name
FROM information_schema.schemata
WHERE schema_name NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
ORDER BY schema_name;
```

### 29.2 Check Table Defaults

```sql
SELECT
  table_schema,
  table_name,
  table_collation
FROM information_schema.tables
WHERE table_schema = 'your_db'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

### 29.3 Check Column Collations

```sql
SELECT
  table_name,
  column_name,
  data_type,
  character_maximum_length,
  character_set_name,
  collation_name
FROM information_schema.columns
WHERE table_schema = 'your_db'
  AND character_set_name IS NOT NULL
ORDER BY table_name, ordinal_position;
```

### 29.4 Find Non-utf8mb4 Columns

```sql
SELECT
  table_schema,
  table_name,
  column_name,
  character_set_name,
  collation_name
FROM information_schema.columns
WHERE table_schema = 'your_db'
  AND character_set_name IS NOT NULL
  AND character_set_name <> 'utf8mb4'
ORDER BY table_name, column_name;
```

### 29.5 Find Mixed Collations in Same Semantic Column Name

```sql
SELECT
  column_name,
  character_set_name,
  collation_name,
  COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'your_db'
  AND character_set_name IS NOT NULL
GROUP BY column_name, character_set_name, collation_name
HAVING COUNT(*) > 1
ORDER BY column_name, column_count DESC;
```

Ini bukan bukti bug, tetapi sinyal untuk audit.

---

## 30. Migration to `utf8mb4`

Migration charset/collation adalah operasi serius.

Contoh perintah:

```sql
ALTER TABLE subjects
CONVERT TO CHARACTER SET utf8mb4
COLLATE utf8mb4_0900_ai_ci;
```

Namun jangan sembarang menjalankan ini di production.

Risiko:

- table rebuild;
- metadata lock;
- index size berubah;
- duplicate key muncul karena collation baru menganggap nilai sama;
- sorting/report berubah;
- query plan berubah;
- replication lag;
- migration lama mempermanenkan mojibake.

### 30.1 Duplicate Risk Before Collation Change

Misalnya dari case-sensitive ke case-insensitive.

Data existing:

```text
admin
Admin
ADMIN
```

Jika kolom punya unique index dan diubah ke case-insensitive, migration bisa gagal karena duplicate menurut collation baru.

Cek candidate duplicate:

```sql
SELECT LOWER(username) AS normalized, COUNT(*)
FROM users
GROUP BY LOWER(username)
HAVING COUNT(*) > 1;
```

Untuk accent-insensitive, cek lebih kompleks. Biasanya perlu aplikasi atau temporary migration tooling.

### 30.2 Migration Checklist

Sebelum migration:

- inventory semua charset/collation;
- identifikasi kolom identifier vs human text;
- tentukan target collation per semantic category;
- scan duplicate potential;
- scan mojibake;
- rehearsal di staging dengan data production copy;
- ukur durasi DDL;
- pahami apakah DDL online/instant/copy;
- siapkan rollback plan realistis;
- backup;
- monitor replication lag.

Sesudah migration:

- test read/write non-ASCII;
- test duplicate behavior;
- compare report sample;
- cek query plan penting;
- cek slow query log;
- cek error application logs.

---

## 31. MySQL Collation Choice Heuristics

### 31.1 Default Table/Database

Untuk aplikasi modern multilingual:

```sql
utf8mb4 + utf8mb4_0900_ai_ci
```

Baik untuk default human-friendly.

### 31.2 Identifier Exact

```sql
utf8mb4_bin
```

Atau `VARBINARY` jika bytes.

### 31.3 Human Legal Name

Pilihan tergantung domain:

```text
raw legal name: accent/case-sensitive or preserve-only
search name: accent/case-insensitive
```

### 31.4 Email

Email rumit karena local-part secara standar teknis bisa case-sensitive, tetapi dalam praktik banyak sistem memperlakukannya case-insensitive.

Praktik umum aplikasi:

```text
email_raw
email_canonical = lowercase trimmed normalized
UNIQUE(email_canonical)
```

Schema:

```sql
email_raw VARCHAR(320)
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_as_cs NOT NULL,
email_canonical VARCHAR(320)
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_bin NOT NULL,
UNIQUE KEY uq_email_canonical (email_canonical)
```

### 31.5 Status Code

Jika status berasal dari enum aplikasi:

```sql
status VARCHAR(32)
  CHARACTER SET ascii
  COLLATE ascii_bin NOT NULL
```

Atau `utf8mb4_bin` untuk konsistensi.

Namun untuk status, biasanya lebih penting ada CHECK constraint/domain validation daripada collation.

---

## 32. Common Anti-Patterns

### Anti-Pattern 1 — Semua Kolom `VARCHAR(255)` Default Collation

```sql
name VARCHAR(255),
code VARCHAR(255),
token VARCHAR(255),
status VARCHAR(255)
```

Masalah:

- semantic field berbeda diperlakukan sama;
- index boros;
- uniqueness tidak jelas;
- bug equality tersembunyi.

---

### Anti-Pattern 2 — Mengandalkan `LOWER()` di Query

```sql
SELECT *
FROM users
WHERE LOWER(username) = LOWER(?);
```

Masalah:

- bisa membuat index tidak efektif;
- normalisasi tidak konsisten;
- tidak menyelesaikan Unicode/canonicalization penuh;
- sulit enforce uniqueness.

Lebih baik:

```text
username_canonical stored and indexed
```

---

### Anti-Pattern 3 — Menggunakan Binary Collation untuk Semua Hal

```sql
COLLATE utf8mb4_bin
```

untuk semua kolom.

Masalah:

- search manusia menjadi buruk;
- sorting tidak natural;
- user experience buruk;
- report terlihat aneh.

Binary bagus untuk identifier, bukan semua teks.

---

### Anti-Pattern 4 — Collation Ditambal di Query

```sql
WHERE a.code COLLATE utf8mb4_bin = b.code
```

Masalah:

- schema semantic tidak jelas;
- query tersebar dengan patch berbeda;
- performance bisa buruk;
- mudah lupa di query lain.

Lebih baik perbaiki schema.

---

### Anti-Pattern 5 — Migration Charset Tanpa Data Profiling

```sql
ALTER TABLE all_tables CONVERT TO CHARACTER SET utf8mb4;
```

Masalah:

- mojibake bisa permanen;
- duplicate key muncul;
- DDL lock;
- report berubah;
- plan berubah.

---

## 33. Decision Framework

Untuk setiap kolom teks, jawab pertanyaan berikut:

1. Apakah ini bahasa manusia atau identifier mesin?
2. Apakah case membedakan nilai?
3. Apakah accent membedakan nilai?
4. Apakah whitespace signifikan?
5. Apakah Unicode normalization diperlukan?
6. Apakah nilai dipakai di `UNIQUE`?
7. Apakah nilai dipakai untuk join?
8. Apakah nilai dipakai untuk search UI?
9. Apakah nilai dipakai untuk sorting/pagination?
10. Apakah nilai harus cocok dengan sistem eksternal?
11. Apakah Java cache menggunakan nilai ini sebagai key?
12. Apakah nilai harus preserved persis untuk audit/legal?
13. Apakah ada raw dan canonical representation?

Jika jawaban belum jelas, jangan buru-buru membuat schema.

---

## 34. Practical Design Patterns

### Pattern 1 — Raw + Canonical

Gunakan untuk identifier bisnis.

```sql
raw_value VARCHAR(128) COLLATE utf8mb4_0900_as_cs NOT NULL,
canonical_value VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
UNIQUE KEY uq_canonical_value (canonical_value)
```

### Pattern 2 — Raw + Search Normalized

Gunakan untuk nama/alamat.

```sql
legal_name VARCHAR(512) COLLATE utf8mb4_0900_as_cs NOT NULL,
legal_name_search VARCHAR(512) COLLATE utf8mb4_0900_ai_ci NOT NULL,
KEY idx_legal_name_search (legal_name_search)
```

### Pattern 3 — Exact Token

Gunakan untuk token/idempotency.

```sql
idempotency_key VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
UNIQUE KEY uq_idempotency_key (idempotency_key)
```

### Pattern 4 — Binary Bytes

Gunakan untuk hash bytes.

```sql
sha256_hash BINARY(32) NOT NULL,
UNIQUE KEY uq_sha256_hash (sha256_hash)
```

### Pattern 5 — Domain Code

Gunakan untuk status/code controlled vocabulary.

```sql
status VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED'))
```

---

## 35. Worked Example: Bug from Wrong Collation

### 35.1 Scenario

Sistem case management punya table:

```sql
CREATE TABLE cases (
  id BIGINT PRIMARY KEY,
  case_number VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL,
  UNIQUE KEY uq_case_number (case_number)
);
```

Business rule:

```text
Case number resmi case-sensitive karena berasal dari external regulator.
AB-100 dan ab-100 dapat merujuk ke record berbeda.
```

### 35.2 Bug

Insert pertama:

```sql
INSERT INTO cases VALUES (1, 'AB-100');
```

Insert kedua:

```sql
INSERT INTO cases VALUES (2, 'ab-100');
```

Gagal duplicate key.

Aplikasi menganggap ini bug database.

Sebenarnya bug ada di schema: collation tidak sesuai semantic field.

### 35.3 Fix

Jika case-sensitive exact:

```sql
ALTER TABLE cases
  MODIFY case_number VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL;
```

Namun di production, harus cek:

- apakah ada duplicate menurut collation baru/lama;
- apakah index rebuild;
- apakah query berubah;
- apakah API contract berubah;
- apakah downstream report terdampak.

Lebih baik dari awal:

```sql
case_number_raw VARCHAR(64) COLLATE utf8mb4_0900_as_cs NOT NULL,
case_number_canonical VARCHAR(64) COLLATE utf8mb4_bin NOT NULL
```

Tergantung domain.

---

## 36. Worked Example: Search vs Identity

### 36.1 Requirement

User ingin mencari subjek bernama:

```text
Jose
```

Dan sistem harus menemukan:

```text
José
JOSE
Jose
```

Namun legal record harus tetap menyimpan nama asli.

### 36.2 Bad Design

```sql
legal_name VARCHAR(512) COLLATE utf8mb4_0900_ai_ci NOT NULL,
UNIQUE KEY uq_legal_name (legal_name)
```

Masalah:

- `Jose` dan `José` bisa dianggap duplicate;
- legal identity disamakan dengan search convenience;
- raw legal distinction hilang.

### 36.3 Better Design

```sql
CREATE TABLE subjects (
  id BIGINT PRIMARY KEY,
  legal_name_raw VARCHAR(512)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_as_cs NOT NULL,
  legal_name_search VARCHAR(512)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci NOT NULL,
  national_id VARCHAR(64)
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NULL,
  KEY idx_legal_name_search (legal_name_search),
  UNIQUE KEY uq_national_id (national_id)
);
```

Search:

```sql
SELECT *
FROM subjects
WHERE legal_name_search LIKE 'jose%'
ORDER BY legal_name_search, id
LIMIT 50;
```

Identity:

```sql
WHERE national_id = ?
```

atau domain-specific matching process.

---

## 37. How This Connects to Previous and Future Parts

Dari Part 004, kita sudah melihat bahwa tipe data bukan hanya syntax. Di Part 005 ini, kita memperdalam khusus teks.

Bagian ini akan terhubung langsung ke:

- Part 010 — index internals, karena collation mempengaruhi index order dan size;
- Part 011 — index design, karena string index harus mengikuti workload;
- Part 012 — optimizer, karena collation mismatch dapat mempengaruhi plan;
- Part 014 — search/filtering UI;
- Part 024 — schema migration;
- Part 026 — security dan injection/identity;
- Part 030 — large table retention/archive;
- Part 031 — JSON/generated columns/full-text;
- Part 034 — production readiness checklist.

---

## 38. Checklist: Text Column Design

Gunakan checklist ini saat mendesain table.

### Character Set

- [ ] Apakah database default sudah `utf8mb4`?
- [ ] Apakah table default sudah `utf8mb4`?
- [ ] Apakah ada kolom legacy `latin1` atau `utf8mb3`?
- [ ] Apakah aplikasi sudah test roundtrip non-ASCII?

### Collation

- [ ] Apakah kolom human text dan machine identifier dibedakan?
- [ ] Apakah uniqueness mengikuti collation yang benar?
- [ ] Apakah join key punya collation sama di semua table?
- [ ] Apakah sorting/pagination deterministic?
- [ ] Apakah collation mismatch mungkin terjadi?

### Canonicalization

- [ ] Apakah identifier punya canonical form?
- [ ] Apakah raw value perlu disimpan?
- [ ] Apakah normalization dilakukan di semua write path?
- [ ] Apakah Java cache memakai canonical key?
- [ ] Apakah API contract menjelaskan case/accent sensitivity?

### Migration

- [ ] Apakah migration charset/collation diuji dengan data realistis?
- [ ] Apakah duplicate potential dicek?
- [ ] Apakah mojibake dicek?
- [ ] Apakah DDL lock behavior dipahami?
- [ ] Apakah backup dan restore plan tersedia?

---

## 39. Summary

Character set dan collation adalah bagian fundamental dari data correctness.

Ringkasan mental model:

```text
Character set menentukan karakter apa yang bisa disimpan.
Collation menentukan bagaimana string dibandingkan dan diurutkan.
```

Untuk MySQL modern:

```text
Gunakan utf8mb4 sebagai default.
Jangan gunakan satu collation untuk semua semantic field tanpa berpikir.
```

Prinsip desain:

1. Human text dan machine identifier harus dibedakan.
2. Unique index pada text column mengikuti collation.
3. Java equality dan MySQL equality bisa berbeda.
4. Search convenience tidak sama dengan legal/business identity.
5. Raw dan canonical representation sering perlu dipisahkan.
6. Collation mismatch sebaiknya diselesaikan di schema, bukan ditambal di query.
7. Migration charset/collation harus diperlakukan sebagai migration data correctness, bukan cosmetic DDL.

Jika bagian ini dipahami, banyak bug aneh seperti duplicate key unexpected, search tidak konsisten, pagination tidak stabil, mojibake, dan data identity conflict menjadi jauh lebih mudah dijelaskan.

---

## 40. Latihan

### Latihan 1 — Audit Schema

Ambil satu schema MySQL existing dan jalankan query inventory:

```sql
SELECT
  table_name,
  column_name,
  data_type,
  character_maximum_length,
  character_set_name,
  collation_name
FROM information_schema.columns
WHERE table_schema = 'your_db'
  AND character_set_name IS NOT NULL
ORDER BY table_name, ordinal_position;
```

Kategorikan setiap kolom menjadi:

- human text;
- machine identifier;
- business identifier;
- search field;
- free text;
- code/status.

Tentukan apakah collation-nya tepat.

### Latihan 2 — Duplicate Semantics

Buat table dengan unique index case-insensitive dan coba insert:

```text
ABC
abc
ÁBC
ÁBC
ABC<space>
```

Catat mana yang dianggap duplicate.

### Latihan 3 — Java Roundtrip

Buat integration test untuk menyimpan dan membaca:

```text
José Müller 👩‍⚖️ Jakarta
```

Pastikan hasilnya identik.

### Latihan 4 — Raw + Canonical

Desain table untuk `license_number` dengan requirement:

- user boleh input dengan spasi dan lowercase;
- sistem harus treat `ab 123`, `AB123`, dan ` ab123 ` sebagai sama;
- display tetap menyimpan input asli pertama;
- uniqueness berdasarkan canonical.

Buat:

- DDL;
- Java canonicalizer;
- unique constraint;
- test duplicate.

---

## 41. Penutup

Bagian ini selesai.

Kita belum selesai dengan seri.

Bagian berikutnya adalah:

```text
learn-mysql-mastery-for-java-engineers-part-006.md
```

Judul:

```text
InnoDB MVCC: Read Views, Undo Logs, and Consistent Reads
```

Di bagian berikutnya, kita akan masuk ke salah satu pusat perilaku transaksi MySQL: bagaimana InnoDB membuat consistent read, bagaimana snapshot dibentuk, bagaimana undo log digunakan, kenapa long-running transaction berbahaya, dan kenapa Java transaction boundary dapat merusak performa database walau query-nya terlihat sederhana.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — MySQL Data Types: Physical Cost, Semantics, and Java Mapping</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-006.md">Part 006 — InnoDB MVCC: Read Views, Undo Logs, and Consistent Reads ➡️</a>
</div>
