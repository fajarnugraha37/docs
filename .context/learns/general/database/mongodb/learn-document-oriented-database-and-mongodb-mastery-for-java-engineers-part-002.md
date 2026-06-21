# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-002.md

# Part 002 — BSON, JSON, Document Structure, and Type Semantics

> Seri: **Document-Oriented Database and MongoDB Mastery for Java Engineers**  
> Posisi: **Part 002 dari 035**  
> Fokus: memahami struktur document MongoDB dari level tipe data, BSON, JSON, field semantics, Java mapping, dan konsekuensi desain.

---

## 0. Tujuan Pembelajaran

Di Part 000 kita membangun orientasi: document database bukan “SQL tanpa JOIN”, melainkan model penyimpanan berbasis **application-shaped aggregate**. Di Part 001 kita memperdalam bahwa document adalah boundary: boundary untuk locality, ownership, atomicity, versioning, dan shape.

Part 002 masuk ke lapisan yang lebih rendah: **apa sebenarnya yang disimpan MongoDB?**

Banyak kesalahan desain MongoDB tidak dimulai dari query atau index. Kesalahan sering dimulai lebih awal: dari asumsi keliru tentang tipe data.

Contoh:

- menganggap document MongoDB adalah JSON biasa;
- menyimpan uang sebagai `double`;
- menyimpan timestamp sebagai string;
- memakai `LocalDateTime` tanpa timezone model yang jelas;
- memperlakukan `null`, field kosong, dan field tidak ada sebagai hal yang sama;
- menyimpan enum Java mentah tanpa strategi evolusi;
- memakai array tanpa memahami query dan update semantics;
- mengekspos `_id` internal sebagai ID publik sistem;
- menganggap schema fleksibel berarti setiap document boleh berbeda tanpa kontrak.

Setelah bagian ini, kamu harus mampu:

1. membedakan JSON, Extended JSON, BSON, dan Java object;
2. memilih tipe data MongoDB yang tepat untuk domain Java;
3. memahami konsekuensi `ObjectId`, `Date`, `Decimal128`, `UUID`, array, embedded document, `null`, dan missing field;
4. membuat aturan field naming dan schema representation yang stabil;
5. mendesain document yang aman untuk evolusi jangka panjang;
6. menghindari bug production yang muncul dari type mismatch, precision loss, timezone ambiguity, dan nullable semantics.

Referensi resmi yang menjadi anchor bagian ini: MongoDB menyimpan record sebagai **BSON document**, dan BSON menyediakan tipe data tambahan dibanding JSON seperti `ObjectId`, `Date`, `Decimal128`, binary, dan integer-sized numeric types. BSON Date direpresentasikan sebagai integer 64-bit dalam milliseconds sejak Unix epoch dan secara resmi disebut UTC datetime dalam spesifikasi BSON. MongoDB Extended JSON menyediakan representasi JSON untuk tipe BSON yang tidak native di JSON biasa. [MongoDB BSON Types](https://www.mongodb.com/docs/manual/reference/bson-types/), [MongoDB Extended JSON](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/)

---

## 1. Mental Model Utama: Document yang Kamu Lihat Bukan Persis Document yang Disimpan

Saat memakai MongoDB, kamu sering melihat bentuk seperti ini:

```json
{
  "_id": "665e8fae3e9eaa1f5a4e78a1",
  "caseNumber": "ENF-2026-000123",
  "status": "UNDER_REVIEW",
  "createdAt": "2026-06-20T08:15:30Z",
  "amount": 1250000.50,
  "parties": [
    {
      "partyId": "PTY-001",
      "role": "SUBJECT"
    }
  ]
}
```

Secara visual ini mirip JSON. Tetapi secara storage dan query semantics, MongoDB tidak menyimpan “JSON string”. MongoDB menyimpan **BSON**.

Lapisan-lapisannya seperti ini:

```text
Java domain object
        ↓ mapping / codec / converter
Java driver BSON representation
        ↓ wire protocol
BSON document in MongoDB
        ↓ shell / logs / API / export
Extended JSON / relaxed visual representation
```

Kesalahan umum adalah mengira semua lapisan ini sama.

Padahal:

- Java `BigDecimal` bukan otomatis BSON `Decimal128` tanpa mapping yang benar.
- Java `Instant` bukan sama dengan `LocalDateTime`.
- JSON number tidak membedakan `int32`, `int64`, `double`, dan decimal.
- JSON tidak punya native `ObjectId`.
- JSON tidak punya native binary data.
- JSON tidak punya native UTC datetime.
- Field yang hilang tidak sama dengan field bernilai `null`.

Untuk engineer Java, peta mental yang aman adalah:

```text
Domain concept
  -> Java type
  -> BSON type
  -> query/update semantics
  -> index behavior
  -> API representation
```

Jangan mulai dari “apa yang gampang diserialize”. Mulailah dari “apa arti domain-nya, bagaimana dikueri, bagaimana diindeks, dan bagaimana berevolusi”.

---

## 2. JSON vs BSON vs Extended JSON

### 2.1 JSON

JSON adalah format teks yang sederhana:

- object;
- array;
- string;
- number;
- boolean;
- null.

JSON bagus sebagai format interoperabilitas API. Tetapi JSON terlalu miskin untuk database engine yang butuh tipe data lebih eksplisit.

Contoh ambiguity:

```json
{
  "a": 1,
  "b": 1.0,
  "c": 9223372036854775807,
  "d": "2026-06-20T08:15:30Z",
  "e": "665e8fae3e9eaa1f5a4e78a1"
}
```

Di JSON biasa:

- `a` dan `b` sama-sama number;
- tidak jelas apakah `c` aman untuk semua parser JavaScript;
- `d` hanyalah string;
- `e` hanyalah string, bukan ObjectId.

### 2.2 BSON

BSON adalah binary representation untuk document MongoDB.

BSON menambahkan tipe yang lebih kaya, seperti:

- ObjectId;
- Date;
- Binary;
- Decimal128;
- Int32;
- Int64;
- Double;
- Timestamp;
- Regular Expression;
- MinKey/MaxKey;
- embedded document;
- array.

Artinya, dua field yang terlihat mirip di UI bisa berbeda tipe di database.

Contoh konseptual:

```javascript
{
  amountA: 100.25,                  // Double
  amountB: NumberDecimal("100.25"), // Decimal128
  createdAtA: "2026-06-20T08:15:30Z", // String
  createdAtB: ISODate("2026-06-20T08:15:30Z") // Date
}
```

Keduanya mungkin terlihat mirip saat ditampilkan, tetapi query, sorting, precision, dan index behavior-nya berbeda.

### 2.3 Extended JSON

Extended JSON adalah representasi JSON untuk tipe BSON.

Contoh canonical-ish representation:

```json
{
  "_id": { "$oid": "665e8fae3e9eaa1f5a4e78a1" },
  "createdAt": { "$date": "2026-06-20T08:15:30Z" },
  "amount": { "$numberDecimal": "1250000.50" },
  "count": { "$numberLong": "9223372036854775807" }
}
```

Kenapa ini penting?

Karena export/import, logs, REST adapters, tests, snapshots, dan fixtures sering menggunakan JSON. Kalau kamu menyimpan fixture seperti ini:

```json
{
  "amount": 1250000.50,
  "createdAt": "2026-06-20T08:15:30Z"
}
```

kamu mungkin tidak sedang menguji tipe yang sama dengan production document.

Untuk sistem serius, terutama yang punya uang, waktu, audit, dan state machine, fixture harus jelas:

```json
{
  "amount": { "$numberDecimal": "1250000.50" },
  "createdAt": { "$date": "2026-06-20T08:15:30Z" }
}
```

---

## 3. Struktur Document MongoDB

Document MongoDB pada dasarnya adalah kumpulan field-value berurutan.

Contoh:

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1"),
  caseNumber: "ENF-2026-000123",
  status: "UNDER_REVIEW",
  priority: 3,
  createdAt: ISODate("2026-06-20T08:15:30Z"),
  subject: {
    subjectId: "SUB-001",
    type: "LEGAL_ENTITY",
    name: "PT Example Entity"
  },
  assignedUnits: ["SUPERVISION", "ENFORCEMENT"],
  tags: ["AML", "HIGH_RISK"],
  version: NumberLong(7)
}
```

### 3.1 Field Name

Field name adalah string.

Prinsip desain field name:

1. **Stabil**: jangan sering rename field.
2. **Domain-oriented**: nama harus mencerminkan konsep domain, bukan UI widget.
3. **Query-aware**: field yang sering dikueri harus jelas dan konsisten.
4. **Avoid ambiguity**: `date`, `value`, `type`, `status` terlalu generik jika document kompleks.
5. **Avoid Java leakage**: jangan biarkan nama class internal bocor menjadi field persisted jika tidak sengaja.

Contoh buruk:

```javascript
{
  date: ISODate("2026-06-20T08:15:30Z"),
  value: "APPROVED",
  type: "A",
  data: { ... }
}
```

Contoh lebih baik:

```javascript
{
  decisionMadeAt: ISODate("2026-06-20T08:15:30Z"),
  decisionStatus: "APPROVED",
  subjectType: "LEGAL_ENTITY",
  caseFacts: { ... }
}
```

### 3.2 Dot Notation

MongoDB memakai dot notation untuk mengakses nested fields.

```javascript
{ "subject.type": "LEGAL_ENTITY" }
```

Artinya field structure menjadi bagian dari query API internal.

Kalau kamu rename:

```javascript
subject.type
```

menjadi:

```javascript
subject.category
```

maka yang terdampak bukan hanya mapping Java, tetapi juga:

- query;
- index;
- aggregation;
- dashboard;
- change stream consumer;
- migration scripts;
- test fixtures;
- support tools.

### 3.3 Document Size

MongoDB punya batas maksimum ukuran BSON document. Batas yang umum diketahui adalah **16 MB per document**. Jangan menjadikan angka ini sebagai target. Untuk desain sehat, document biasanya jauh lebih kecil.

Masalah document terlalu besar:

- network payload besar;
- memory pressure;
- update lebih mahal;
- document relocation/fragmentation risk;
- projection menjadi wajib;
- lock/contention lebih terasa;
- sulit difetch sebagai aggregate biasa;
- array cenderung tidak terkendali.

Rule praktis:

```text
Batas 16 MB adalah pagar jurang, bukan ukuran ideal rumah.
```

Kalau document bisa tumbuh tanpa batas, modelnya kemungkinan salah.

---

## 4. `_id`: Identity, ObjectId, dan Public ID

Setiap document MongoDB punya field `_id` sebagai primary key dalam collection. Jika kamu tidak menyediakannya, driver/server dapat menghasilkan ObjectId.

### 4.1 Apa Itu ObjectId?

ObjectId adalah tipe BSON 12-byte yang lazim digunakan sebagai identifier document.

Secara konseptual ObjectId mengandung komponen yang membuatnya unik dan roughly time-ordered. Namun, jangan membangun business logic berat di atas struktur internal ObjectId.

Contoh:

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1")
}
```

### 4.2 Kapan ObjectId Cocok?

ObjectId cocok ketika:

- document butuh ID teknis internal;
- ID tidak harus bermakna bagi user;
- ID tidak berasal dari upstream system;
- collection tidak perlu natural key sebagai `_id`;
- kamu ingin ID dibuat client-side tanpa round-trip;
- kamu tidak ingin collision manual.

Contoh:

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1"),
  caseNumber: "ENF-2026-000123"
}
```

Di sini `_id` adalah technical identity, sedangkan `caseNumber` adalah business identity.

### 4.3 Kapan Domain ID Lebih Cocok?

Gunakan domain ID sebagai `_id` jika:

- ID sudah dijamin unik oleh domain/upstream;
- query paling sering by ID tersebut;
- ID adalah canonical identity dalam semua sistem;
- kamu ingin idempotent write berbasis natural identity;
- duplicate prevention lebih penting daripada generated identity.

Contoh:

```javascript
{
  _id: "CASE-2026-000123",
  status: "UNDER_REVIEW"
}
```

Tetapi hati-hati: domain ID sering berubah jika ternyata bukan benar-benar immutable.

Contoh domain ID yang berisiko:

- nomor registrasi yang bisa direvisi;
- nomor case sementara;
- kode eksternal dari sistem yang belum stabil;
- identifier yang mengandung format bisnis versi lama.

Kalau ID bisa berubah, jangan jadikan `_id`.

### 4.4 `_id` Internal vs Public API ID

Untuk sistem enterprise/regulatory, sering lebih aman memisahkan:

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1"),
  caseId: "case_01J0XYZ8M9Q7ABCD1234",
  caseNumber: "ENF-2026-000123"
}
```

Peran:

| Field | Peran |
|---|---|
| `_id` | technical MongoDB identity |
| `caseId` | stable public/API identity |
| `caseNumber` | human-readable business reference |

Keuntungan:

- kamu bisa mengganti storage tanpa mengubah public API;
- kamu bisa menyembunyikan ObjectId;
- kamu tidak membuat consumer bergantung pada detail MongoDB;
- kamu bisa punya format public ID yang tidak mengungkap timestamp/sequence;
- kamu bisa menggunakan ID domain untuk idempotency.

### 4.5 Jangan Menganggap ObjectId Sebagai Security Boundary

ObjectId tidak boleh dipakai sebagai pengganti authorization.

Buruk:

```text
User bisa akses /cases/{objectId}, maka aman karena ObjectId sulit ditebak.
```

Benar:

```text
User bisa akses case hanya jika authorization policy membuktikan user berhak atas case tersebut.
```

Opaque ID membantu mengurangi enumeration, tetapi bukan security model.

---

## 5. Numeric Types: Int32, Int64, Double, Decimal128

Numeric type adalah sumber bug tersembunyi. Di SQL kamu terbiasa memilih `integer`, `bigint`, `numeric`, `decimal`. Di MongoDB, kamu juga harus eksplisit secara mental.

### 5.1 Double

`double` cocok untuk nilai approximate:

- sensor measurement yang toleran error;
- scoring;
- ratio;
- probability;
- geo coordinate;
- approximate analytics.

Tidak cocok untuk:

- uang;
- denda;
- saldo;
- pajak;
- bunga;
- nilai legal yang harus exact.

Contoh buruk:

```javascript
{
  penaltyAmount: 1000000.10 // likely Double
}
```

Masalahnya bukan terlihat di satu angka. Masalah muncul ketika nilai dijumlahkan, dibandingkan, dikonversi, atau direkonsiliasi.

### 5.2 Int32

`Int32` cocok untuk angka kecil:

- priority;
- count kecil;
- enum numeric internal;
- retry count;
- page size;
- score integer sederhana.

Contoh:

```javascript
{
  priority: 3,
  retryCount: 2
}
```

### 5.3 Int64 / Long

`Int64` cocok untuk:

- counter besar;
- version;
- sequence;
- epoch millis jika sengaja;
- long-running accumulated count;
- external ID numeric besar.

Contoh:

```javascript
{
  version: NumberLong(17),
  totalEvents: NumberLong(98234421)
}
```

Di Java mapping:

```java
long version;
Long totalEvents;
```

Gunakan primitive `long` jika wajib selalu ada. Gunakan `Long` jika memang nullable atau backward compatibility field lama.

### 5.4 Decimal128

Decimal128 cocok untuk nilai decimal exact.

MongoDB docs menyebut Decimal128 menggunakan format IEEE 754 decimal128 dengan 34 decimal digits dan exponent range tertentu. Ini penting untuk nilai presisi seperti uang. [MongoDB BSON Types](https://www.mongodb.com/docs/manual/reference/bson-types/)

Gunakan Decimal128 untuk:

- money;
- penalty amount;
- tax amount;
- regulatory threshold;
- precise percentage yang legally material;
- quantity yang membutuhkan decimal exact.

Contoh:

```javascript
{
  penaltyAmount: NumberDecimal("1250000.50"),
  currency: "IDR"
}
```

Di Java:

```java
BigDecimal penaltyAmount;
String currency;
```

Tetapi jangan mengasumsikan semua `BigDecimal` otomatis tersimpan sebagai Decimal128 tanpa konfigurasi mapping/codec yang benar. Validasi hasil persisted document.

### 5.5 Money Modelling

Jangan simpan uang sebagai satu field number tanpa currency.

Buruk:

```javascript
{
  amount: NumberDecimal("1250000.50")
}
```

Lebih baik:

```javascript
{
  penalty: {
    amount: NumberDecimal("1250000.50"),
    currency: "IDR"
  }
}
```

Untuk domain yang sangat ketat, pertimbangkan minor units:

```javascript
{
  penalty: {
    amountMinor: NumberLong("125000050"),
    currency: "IDR",
    scale: 2
  }
}
```

Trade-off:

| Model | Keuntungan | Risiko |
|---|---|---|
| Decimal128 | natural untuk decimal | mapping harus benar |
| minor unit long | exact, mudah compare | butuh scale/currency discipline |
| double | mudah | salah untuk money |

Untuk regulatory systems, default aman: **Decimal128 atau minor unit long**, bukan double.

---

## 6. Date, Time, Timestamp, dan Timezone

Waktu adalah domain yang sering terlihat sederhana tetapi paling sering rusak.

MongoDB BSON Date adalah integer 64-bit yang merepresentasikan milliseconds sejak Unix epoch, dan disebut UTC datetime dalam spesifikasi BSON. [MongoDB BSON Types](https://www.mongodb.com/docs/manual/reference/bson-types/)

### 6.1 BSON Date Bukan LocalDateTime

BSON Date merepresentasikan instant waktu UTC.

Contoh:

```javascript
{
  createdAt: ISODate("2026-06-20T08:15:30Z")
}
```

Di Java, mapping mental yang paling tepat biasanya:

```java
Instant createdAt;
```

Bukan:

```java
LocalDateTime createdAt;
```

`LocalDateTime` tidak punya timezone/offset. Ia berarti “tanggal dan jam lokal tanpa konteks zona”. Untuk event timestamp, ini berbahaya.

### 6.2 Gunakan `Instant` untuk Event Time

Gunakan `Instant` untuk:

- createdAt;
- updatedAt;
- submittedAt;
- approvedAt;
- decisionMadeAt;
- eventOccurredAt;
- expiresAt;
- lockedUntil.

Contoh:

```java
public record CaseDocument(
    String caseId,
    Instant createdAt,
    Instant updatedAt,
    Instant decisionMadeAt
) {}
```

Document:

```javascript
{
  caseId: "case_01J0XYZ8M9Q7ABCD1234",
  createdAt: ISODate("2026-06-20T08:15:30Z"),
  updatedAt: ISODate("2026-06-20T09:10:00Z"),
  decisionMadeAt: ISODate("2026-06-20T09:00:00Z")
}
```

### 6.3 Gunakan `LocalDate` untuk Calendar Date

Ada konsep tanggal yang bukan timestamp:

- tanggal lahir;
- tanggal efektif regulasi;
- tanggal cut-off bisnis;
- tanggal periode laporan;
- tanggal jatuh tempo kalender.

Contoh:

```text
Tanggal lahir: 1990-05-12
```

Ini bukan instant. Tidak terjadi pada jam tertentu UTC. Kalau dipaksa ke `Date`, bisa bergeser ketika ditampilkan di timezone lain.

Untuk `LocalDate`, ada beberapa strategi:

#### Strategi A — Simpan sebagai string ISO date

```javascript
{
  birthDate: "1990-05-12"
}
```

Keuntungan:

- jelas sebagai calendar date;
- mudah dibaca;
- tidak timezone-sensitive;
- lexicographic order ISO date tetap cocok untuk range date.

Risiko:

- bukan BSON Date;
- harus disiplin format `YYYY-MM-DD`;
- validasi diperlukan.

#### Strategi B — Simpan sebagai embedded object

```javascript
{
  birthDate: {
    year: 1990,
    month: 5,
    day: 12
  }
}
```

Keuntungan:

- sangat eksplisit;
- bisa query by year/month/day.

Risiko:

- lebih verbose;
- range query lebih tidak natural.

#### Strategi C — Simpan sebagai UTC midnight Date

```javascript
{
  birthDate: ISODate("1990-05-12T00:00:00Z")
}
```

Risiko:

- consumer bisa salah menampilkan menjadi tanggal berbeda di timezone lokal;
- semantic-nya terlihat seperti instant padahal bukan.

Untuk kebanyakan aplikasi Java enterprise, strategi A sering paling aman untuk pure calendar date.

### 6.4 Simpan Timezone Jika Domain Membutuhkannya

Jika domain membutuhkan konteks lokal, simpan timezone/offset terpisah.

Contoh hearing/sidang/jadwal lokal:

```javascript
{
  hearing: {
    scheduledAt: ISODate("2026-06-20T02:00:00Z"),
    zoneId: "Asia/Jakarta",
    localDate: "2026-06-20",
    localTime: "09:00"
  }
}
```

Kenapa redundant?

Karena ada dua kebutuhan:

- instant untuk ordering, reminder, timeout;
- local representation untuk legal/business meaning.

Dalam sistem regulasi, “deadline sampai tanggal 20 Juni waktu Jakarta” bukan sama dengan “instant tertentu tanpa konteks”.

### 6.5 Jangan Simpan Timestamp sebagai String untuk Event Time

Buruk:

```javascript
{
  createdAt: "2026-06-20T08:15:30Z"
}
```

Masalah:

- sorting bisa tampak benar hanya kalau format konsisten;
- range query bergantung pada string format;
- type mismatch dengan index Date;
- aggregation date operators tidak langsung natural;
- validasi lebih berat;
- timezone parsing bisa kacau.

Lebih baik:

```javascript
{
  createdAt: ISODate("2026-06-20T08:15:30Z")
}
```

---

## 7. Null, Missing Field, Empty String, Empty Array, Empty Object

Ini salah satu bagian terpenting.

Di document database, tidak adanya field adalah informasi struktural. Jangan samakan semua “kosong”.

Ada beberapa kondisi:

```javascript
// missing
{}

// null
{ middleName: null }

// empty string
{ middleName: "" }

// empty array
{ aliases: [] }

// empty object
{ riskAssessment: {} }
```

Masing-masing punya arti berbeda.

### 7.1 Missing Field

Missing field berarti field tidak ada di document.

Makna yang mungkin:

- belum dikenal pada schema versi lama;
- tidak berlaku untuk subtype ini;
- belum dihitung;
- tidak pernah diisi;
- sengaja dihilangkan untuk menghemat storage;
- bug mapping.

Contoh:

```javascript
{
  caseId: "case-1",
  status: "OPEN"
}
```

Tidak ada field `closedAt`.

Ini bisa berarti case belum closed.

### 7.2 Null

`null` berarti field ada tetapi nilainya null.

Makna yang mungkin:

- diketahui kosong;
- eksplisit tidak ada;
- belum diisi;
- hasil migrasi;
- mapping Java nullable.

Contoh:

```javascript
{
  caseId: "case-1",
  closedAt: null
}
```

Apakah sama dengan missing? Secara domain bisa sama atau tidak. Secara query dan index, kamu harus sadar bedanya.

### 7.3 Empty String

Empty string biasanya buruk sebagai missing/null substitute.

Buruk:

```javascript
{
  middleName: ""
}
```

Masalah:

- apakah user memang mengisi kosong?
- apakah field optional?
- apakah UI mengirim default?
- apakah validasi gagal?

Untuk field text optional, lebih baik pilih satu policy:

```text
Optional text absent -> field missing
Explicit unknown -> null only jika domain membutuhkan
```

### 7.4 Empty Array

Empty array berarti field array ada, tetapi tidak punya element.

Contoh:

```javascript
{
  aliases: []
}
```

Ini berbeda dari:

```javascript
{}
```

Makna empty array:

- sudah diketahui tidak ada aliases;
- user sudah mengisi dan hasilnya kosong;
- collection child sudah diinisialisasi.

Missing array:

- field belum tersedia pada schema lama;
- subtype tidak punya konsep aliases;
- belum dimuat/dihitung.

### 7.5 Empty Object

Empty object sering tanda desain belum matang.

```javascript
{
  riskAssessment: {}
}
```

Pertanyaannya:

- apakah risk assessment sudah dibuat tapi kosong?
- apakah belum dihitung?
- apakah semua field optional?
- apakah schema nested terlalu bebas?

Lebih baik eksplisit:

```javascript
{
  riskAssessment: {
    status: "NOT_STARTED"
  }
}
```

atau hilangkan field sampai tersedia:

```javascript
{
  caseId: "case-1"
}
```

### 7.6 Policy yang Direkomendasikan

Untuk sistem serius, buat aturan:

| Kondisi | Representasi yang disarankan |
|---|---|
| Field wajib | selalu ada, non-null |
| Field optional dan belum ada | missing |
| Field optional tapi eksplisit tidak diketahui | null hanya jika domain perlu membedakan |
| List kosong yang sudah diketahui | `[]` |
| List belum dimuat/tidak berlaku | missing |
| Text kosong | validasi tolak atau normalize menjadi missing |
| Object belum dimulai | missing atau status eksplisit |
| Object ada tapi belum lengkap | object dengan `status`/`version`, bukan `{}` |

Di Java, jangan asal memakai nullable field tanpa policy. Nullability adalah bagian dari schema contract.

---

## 8. String: Human Text, Codes, IDs, and Normalization

String terlihat sederhana, tetapi string sering dipakai untuk terlalu banyak hal:

- free text;
- enum;
- code;
- public ID;
- external ID;
- normalized key;
- date;
- money;
- JSON blob;
- serialized object.

Tidak semua string sama.

### 8.1 Free Text

Contoh:

```javascript
{
  summary: "Potential violation detected during supervision review."
}
```

Pertimbangan:

- max length;
- sanitization;
- search requirement;
- language;
- PII/sensitive content;
- audit immutability;
- redaction.

### 8.2 Code / Enum String

Contoh:

```javascript
{
  status: "UNDER_REVIEW",
  priority: "HIGH",
  subjectType: "LEGAL_ENTITY"
}
```

Keuntungan enum string:

- readable;
- stable across Java enum ordinal changes;
- easier debugging;
- safer for data migration.

Hindari ordinal:

```javascript
{
  status: 3
}
```

Jika memakai numeric code karena integrasi legacy, simpan juga meaning jika perlu:

```javascript
{
  statusCode: "03",
  status: "UNDER_REVIEW"
}
```

Tetapi hati-hati duplikasi. Harus ada source of truth.

### 8.3 Public ID

Contoh:

```javascript
{
  caseId: "case_01J0XYZ8M9Q7ABCD1234"
}
```

Public ID sebaiknya:

- stable;
- opaque;
- tidak mengungkap internal storage;
- mudah dilog;
- aman untuk URL;
- panjangnya masuk akal;
- punya uniqueness guarantee.

### 8.4 External ID

External ID perlu disimpan dengan konteks source.

Buruk:

```javascript
{
  externalId: "12345"
}
```

Lebih baik:

```javascript
{
  externalRefs: [
    {
      sourceSystem: "SUPERVISION_CORE",
      refType: "INSPECTION_ID",
      refValue: "12345"
    }
  ]
}
```

Atau jika hanya satu source jelas:

```javascript
{
  supervisionInspectionId: "12345"
}
```

### 8.5 Normalized String for Search/Uniqueness

Jika butuh uniqueness case-insensitive, jangan hanya mengandalkan UI.

Contoh:

```javascript
{
  email: "User.Name@Example.com",
  emailNormalized: "user.name@example.com"
}
```

Index unique bisa ditempatkan di normalized field.

Untuk nama orang/perusahaan, normalisasi jauh lebih kompleks. Jangan oversimplify.

---

## 9. Boolean: Simple Type, Dangerous Semantics

Boolean cocok untuk fakta biner yang benar-benar biner.

Contoh:

```javascript
{
  active: true,
  deleted: false
}
```

Tetapi banyak domain tidak biner.

Buruk:

```javascript
{
  approved: false
}
```

Apakah `false` berarti:

- rejected?
- pending?
- not reviewed?
- withdrawn?
- expired?
- unknown?

Lebih baik:

```javascript
{
  approvalStatus: "PENDING"
}
```

atau:

```javascript
{
  decision: {
    status: "REJECTED",
    decidedAt: ISODate("2026-06-20T08:15:30Z"),
    decidedBy: "user_123"
  }
}
```

Rule:

```text
Gunakan boolean hanya jika domain tidak punya state ketiga.
```

Untuk workflow, hampir selalu gunakan enum/state, bukan boolean flags.

Buruk:

```javascript
{
  submitted: true,
  reviewed: false,
  approved: false,
  rejected: false,
  escalated: true
}
```

Lebih baik:

```javascript
{
  status: "ESCALATED",
  statusChangedAt: ISODate("2026-06-20T08:15:30Z")
}
```

Dengan history:

```javascript
{
  status: "ESCALATED",
  statusHistory: [
    {
      from: "UNDER_REVIEW",
      to: "ESCALATED",
      changedAt: ISODate("2026-06-20T08:15:30Z"),
      changedBy: "user_123"
    }
  ]
}
```

Nanti di Part 014 kita akan bahas state machine lebih dalam.

---

## 10. Array Semantics

Array adalah kekuatan besar MongoDB sekaligus sumber desain buruk.

Contoh:

```javascript
{
  caseId: "case-1",
  tags: ["AML", "HIGH_RISK", "URGENT"]
}
```

Array cocok untuk:

- small bounded list;
- tags;
- aliases;
- embedded value objects;
- recent snapshots;
- fixed-size historical summary;
- child objects yang lifecycle-nya dimiliki parent.

Array berbahaya untuk:

- unbounded event log;
- comments tanpa batas;
- messages;
- audit records besar;
- tasks yang sering diupdate banyak actor;
- high-contention append;
- child entity yang sering dikueri independen.

### 10.1 Array of Scalars

```javascript
{
  tags: ["AML", "SANCTION", "HIGH_RISK"]
}
```

Query:

```javascript
{ tags: "AML" }
```

Ini mencari document yang array `tags` mengandung `AML`.

### 10.2 Array of Embedded Documents

```javascript
{
  parties: [
    {
      partyId: "party-1",
      role: "SUBJECT",
      name: "PT Example"
    },
    {
      partyId: "party-2",
      role: "REPRESENTATIVE",
      name: "Jane Doe"
    }
  ]
}
```

Query nested array butuh hati-hati. Jika ingin kondisi berlaku pada element yang sama, gunakan `$elemMatch`.

Misalnya cari case yang punya party role `SUBJECT` dan type `LEGAL_ENTITY` pada element yang sama.

Benar:

```javascript
{
  parties: {
    $elemMatch: {
      role: "SUBJECT",
      type: "LEGAL_ENTITY"
    }
  }
}
```

Tanpa `$elemMatch`, kondisi pada field array berbeda bisa match element yang berbeda. Ini bug yang umum.

### 10.3 Array Ordering

Array punya urutan. Jangan abaikan itu.

Jika urutan bermakna:

```javascript
{
  approvalSteps: [
    { stepNo: 1, role: "REVIEWER" },
    { stepNo: 2, role: "SUPERVISOR" },
    { stepNo: 3, role: "DIRECTOR" }
  ]
}
```

Simpan `stepNo` juga, jangan hanya mengandalkan posisi array.

Kenapa?

- update bisa reorder;
- migration bisa mengubah struktur;
- query/aggregation lebih jelas;
- diff lebih mudah.

### 10.4 Array Growth

Pertanyaan wajib untuk setiap array:

```text
Apakah array ini bounded?
```

Kalau tidak bounded, jangan embed langsung.

Buruk:

```javascript
{
  caseId: "case-1",
  auditEvents: [
    { eventId: "evt-1", ... },
    { eventId: "evt-2", ... },
    ... potentially millions ...
  ]
}
```

Lebih baik:

```javascript
// cases
{
  _id: "case-1",
  status: "UNDER_REVIEW",
  latestAuditEventAt: ISODate("2026-06-20T08:15:30Z")
}

// caseAuditEvents
{
  _id: "evt-1",
  caseId: "case-1",
  eventType: "STATUS_CHANGED",
  occurredAt: ISODate("2026-06-20T08:15:30Z")
}
```

Atau bucket pattern jika cocok:

```javascript
{
  _id: "case-1:2026-06",
  caseId: "case-1",
  month: "2026-06",
  events: [ ... bounded by policy ... ]
}
```

### 10.5 Array Update Semantics

MongoDB punya operator seperti:

- `$push`;
- `$addToSet`;
- `$pull`;
- positional `$`;
- filtered positional `$[identifier]`;
- array filters.

Ini powerful, tetapi bisa menjadi rumit jika array merepresentasikan child entity kompleks.

Jika kamu sering melakukan update seperti:

```text
update one nested child by child ID, with concurrency control, audit, independent permissions, and independent lifecycle
```

kemungkinan child itu harus menjadi collection sendiri.

---

## 11. Embedded Document Semantics

Embedded document adalah nested object.

Contoh:

```javascript
{
  caseId: "case-1",
  subject: {
    subjectId: "subject-1",
    type: "LEGAL_ENTITY",
    name: "PT Example",
    risk: {
      rating: "HIGH",
      assessedAt: ISODate("2026-06-20T08:15:30Z")
    }
  }
}
```

Embedded document cocok ketika nested object:

- owned by parent;
- dibaca bersama parent;
- diupdate bersama parent;
- tidak tumbuh tanpa batas;
- tidak punya lifecycle independen;
- tidak butuh permission independen;
- tidak sering dikueri sebagai root.

### 11.1 Value Object Ideal untuk Embed

Contoh value object:

```javascript
{
  address: {
    line1: "Jl. Example No. 1",
    city: "Jakarta",
    province: "DKI Jakarta",
    country: "ID",
    postalCode: "10110"
  }
}
```

Address dalam konteks case subject bisa diembed jika address adalah snapshot untuk case tersebut.

Tetapi jika address adalah master data yang dipakai banyak sistem, mungkin harus referenced.

### 11.2 Snapshot vs Reference

Regulatory systems sering butuh snapshot.

Contoh: saat case dibuat, subject name adalah “PT Example A”. Nanti master data berubah menjadi “PT Example B”. Case lama mungkin harus tetap menyimpan nama saat kejadian.

Model:

```javascript
{
  caseId: "case-1",
  subjectSnapshot: {
    subjectId: "subj-123",
    nameAtCaseCreation: "PT Example A",
    type: "LEGAL_ENTITY",
    registrationNumber: "REG-123"
  }
}
```

Ini bukan duplikasi buruk. Ini snapshot domain yang defensible.

### 11.3 Embedded Document Jangan Dijadikan Dumping Ground

Buruk:

```javascript
{
  caseId: "case-1",
  metadata: {
    anything: "goes here",
    randomField1: true,
    randomField2: 123,
    nestedBlob: { ... }
  }
}
```

Jika memang butuh flexible attributes, desain eksplisit:

```javascript
{
  attributes: [
    {
      code: "SECTOR",
      valueType: "STRING",
      stringValue: "BANKING"
    },
    {
      code: "RISK_SCORE",
      valueType: "DECIMAL",
      decimalValue: NumberDecimal("87.5")
    }
  ]
}
```

Atau:

```javascript
{
  dynamicAttributes: {
    sector: "BANKING",
    riskScore: NumberDecimal("87.5")
  },
  dynamicAttributeSchemaVersion: 3
}
```

Tentukan mana yang boleh fleksibel dan mana yang harus ketat.

---

## 12. Binary, UUID, and Large Content

MongoDB BSON mendukung binary data. Tetapi “bisa menyimpan binary” bukan berarti semua file sebaiknya disimpan langsung di document.

### 12.1 Binary Data

Binary cocok untuk:

- small opaque payload;
- hash;
- signature;
- encrypted field blob;
- compact encoded value;
- UUID binary representation.

Tidak cocok untuk:

- PDF besar;
- image besar;
- video;
- file evidence besar;
- document archive besar dalam field biasa.

Untuk file besar, biasanya simpan metadata di MongoDB dan content di object storage/GridFS tergantung kebutuhan.

Contoh metadata:

```javascript
{
  documentId: "doc_01J0ABC",
  caseId: "case_01J0XYZ",
  filename: "evidence.pdf",
  contentType: "application/pdf",
  sizeBytes: NumberLong(4823912),
  sha256: "...",
  storage: {
    provider: "S3",
    bucket: "case-evidence-prod",
    objectKey: "cases/case_01J0XYZ/doc_01J0ABC.pdf"
  },
  uploadedAt: ISODate("2026-06-20T08:15:30Z")
}
```

### 12.2 UUID

Java systems sering memakai UUID.

Pilihan penyimpanan:

1. sebagai string:

```javascript
{
  requestId: "550e8400-e29b-41d4-a716-446655440000"
}
```

2. sebagai BSON binary UUID.

String lebih mudah dibaca dan interoperable. Binary lebih compact tetapi butuh konsistensi representation. Dalam sistem multi-language atau legacy driver, UUID representation bisa menjadi sumber bug jika tidak distandarkan.

Rule praktis:

```text
Jika UUID adalah public/API ID dan sering dilog/debug, string sering lebih sederhana.
Jika storage efficiency dan driver consistency terjamin, binary UUID bisa dipakai.
```

Yang penting: pilih satu convention dan enforce.

---

## 13. Regular Expression, Timestamp, MinKey, MaxKey, and Special Types

MongoDB punya tipe khusus. Tidak semua harus sering dipakai.

### 13.1 Regular Expression

MongoDB bisa menyimpan regex sebagai BSON type dan query juga mendukung regex.

Tetapi regex query sering menjadi performance trap.

Contoh berbahaya:

```javascript
{ name: /example/i }
```

Risiko:

- index mungkin tidak efektif;
- case-insensitive regex mahal;
- leading wildcard tidak index-friendly;
- search behavior buruk untuk user-facing search.

Untuk search serius, gunakan search engine atau Atlas Search, bukan regex liar.

### 13.2 BSON Timestamp

BSON Timestamp bukan general application timestamp. Ia punya penggunaan internal/oplog-oriented. Untuk waktu aplikasi, gunakan BSON Date.

Buruk:

```javascript
{
  createdAt: Timestamp(...)
}
```

Benar:

```javascript
{
  createdAt: ISODate("2026-06-20T08:15:30Z")
}
```

### 13.3 MinKey / MaxKey

MinKey dan MaxKey dipakai untuk nilai sentinel dalam sorting/range internal atau kasus khusus.

Jarang dibutuhkan untuk domain application biasa.

Jika kamu merasa butuh MinKey/MaxKey untuk business state, kemungkinan ada model yang lebih jelas.

---

## 14. Type Consistency dalam Satu Field

MongoDB flexible schema memungkinkan field yang sama punya tipe berbeda antar document.

Contoh buruk:

```javascript
// document 1
{ caseId: "case-1", priority: 3 }

// document 2
{ caseId: "case-2", priority: "HIGH" }

// document 3
{ caseId: "case-3", priority: null }
```

Ini legal secara storage, tetapi buruk untuk sistem.

Masalah:

- query menjadi tidak predictable;
- sorting aneh;
- index behavior sulit dipahami;
- Java mapping bisa gagal;
- aggregation butuh type checks;
- data quality turun;
- migration makin mahal.

Rule:

```text
Flexible schema berarti flexible shape evolution, bukan inconsistent type chaos.
```

### 14.1 Type Drift

Type drift terjadi ketika field berubah tipe seiring waktu tanpa migrasi jelas.

Contoh evolution buruk:

Versi 1:

```javascript
{ riskScore: "HIGH" }
```

Versi 2:

```javascript
{ riskScore: 87 }
```

Versi 3:

```javascript
{ riskScore: { level: "HIGH", numeric: 87 } }
```

Kalau semua hidup bersama tanpa `schemaVersion`, query menjadi rumit:

```javascript
{
  $or: [
    { riskScore: "HIGH" },
    { riskScore: { $gte: 80 } },
    { "riskScore.level": "HIGH" }
  ]
}
```

Lebih baik:

```javascript
{
  schemaVersion: 3,
  risk: {
    level: "HIGH",
    score: 87
  }
}
```

Lalu migrasi/backward reader dikelola eksplisit.

### 14.2 Field Reuse Anti-Pattern

Jangan reuse field untuk arti berbeda.

Buruk:

```javascript
{
  reference: "CASE-123"
}
```

Di beberapa document `reference` berarti case number, di lain document berarti external transaction ID, di lain lagi berarti customer ID.

Lebih baik:

```javascript
{
  caseNumber: "CASE-123",
  externalTransactionId: "TX-999",
  customerId: "CUST-777"
}
```

Field name adalah contract.

---

## 15. Java Type Mapping: Dari Domain ke BSON

Untuk Java engineer, keputusan tipe harus dibuat di tiga level:

```text
Domain type -> Java type -> BSON type
```

Contoh mapping umum:

| Domain concept | Java type | BSON type yang disarankan |
|---|---|---|
| Technical document ID | `ObjectId` / `String` | ObjectId / String |
| Public ID | `String` | String |
| Created timestamp | `Instant` | Date |
| Calendar date | `LocalDate` | String `YYYY-MM-DD` atau custom representation |
| Money | `BigDecimal` / Money value object | Decimal128 atau Int64 minor units |
| Version | `long` / `Long` | Int64 |
| Priority | `int` / enum | Int32 / String |
| Status | enum | String |
| Tags | `List<String>` / `Set<String>` | Array string |
| Embedded value object | record/class | Embedded document |
| Large file | metadata object | Document metadata + external storage |
| UUID public ID | `UUID` / `String` | String or Binary UUID |

### 15.1 Avoid `Map<String, Object>` as Default Model

Buruk:

```java
Map<String, Object> document;
```

Ini memang fleksibel, tetapi menghilangkan contract.

Masalah:

- tidak ada compile-time signal;
- tipe runtime bisa kacau;
- refactoring sulit;
- validation tersebar;
- IDE tidak membantu;
- business invariant tidak punya tempat.

Gunakan `Map<String, Object>` hanya untuk area yang memang dynamic dan dibatasi.

Lebih baik:

```java
public record CaseDocument(
    String caseId,
    String caseNumber,
    CaseStatus status,
    Instant createdAt,
    SubjectSnapshot subject,
    RiskAssessment risk,
    long version
) {}
```

Dengan dynamic section eksplisit:

```java
public record CaseDocument(
    String caseId,
    String caseNumber,
    CaseStatus status,
    Instant createdAt,
    Map<String, AttributeValue> dynamicAttributes,
    int dynamicAttributeSchemaVersion,
    long version
) {}
```

### 15.2 Enum Mapping

Java enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    DECIDED,
    CLOSED
}
```

Persist as string:

```javascript
{
  status: "UNDER_REVIEW"
}
```

Jangan persist ordinal:

```javascript
{
  status: 2
}
```

Karena ordinal berubah jika enum diubah urutannya.

Untuk backward compatibility, jangan rename enum sembarangan.

Jika business label berubah, pertimbangkan code yang stabil:

```java
public enum CaseStatus {
    UNDER_REVIEW("UNDER_REVIEW");

    private final String code;
}
```

### 15.3 Value Object Mapping

Domain value object:

```java
public record Money(
    BigDecimal amount,
    String currency
) {}
```

BSON:

```javascript
{
  penalty: {
    amount: NumberDecimal("1250000.50"),
    currency: "IDR"
  }
}
```

Jangan sebar `BigDecimal amount` dan `String currency` tanpa grouping jika domain-nya satu konsep.

Buruk:

```javascript
{
  penaltyAmount: NumberDecimal("1250000.50"),
  penaltyCurrency: "IDR"
}
```

Bisa diterima untuk query/index tertentu, tetapi value object embedded biasanya lebih jelas.

### 15.4 Records and Immutability

Java records cocok untuk document/value object yang immutable.

Contoh:

```java
public record SubjectSnapshot(
    String subjectId,
    SubjectType type,
    String name,
    String registrationNumber
) {}
```

Keuntungan:

- jelas;
- immutable;
- constructor-based;
- mudah dites;
- cocok untuk read model.

Tetapi pastikan mapping framework/codec mendukung constructor binding/records sesuai versi yang kamu pakai.

---

## 16. Schema Versioning dari Awal

Flexible schema bukan alasan untuk tidak punya versi.

Tambahkan `schemaVersion` pada document yang penting.

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1"),
  schemaVersion: 2,
  caseId: "case_01J0XYZ",
  status: "UNDER_REVIEW",
  createdAt: ISODate("2026-06-20T08:15:30Z")
}
```

### 16.1 Kenapa schemaVersion Penting?

Karena suatu saat kamu akan:

- rename field;
- split embedded document;
- change enum;
- change date representation;
- move array to collection;
- add required field;
- normalize string;
- change money representation;
- migrate old documents lazily.

Tanpa schema version, reader harus menebak.

### 16.2 Schema Version Bukan Migration Version Global

`schemaVersion` document adalah versi shape document.

Migration version global adalah versi eksekusi migrasi sistem.

Contoh:

```javascript
{
  schemaVersion: 3,
  caseId: "case-1"
}
```

Sedangkan migration log:

```javascript
{
  migrationId: "2026-06-20-add-risk-assessment-v3",
  appliedAt: ISODate("2026-06-20T08:15:30Z")
}
```

Keduanya berbeda.

### 16.3 Reader Compatibility

Reader sebaiknya bisa membaca beberapa versi document selama masa transisi.

Contoh:

```java
RiskAssessment readRisk(CaseDocumentRaw raw) {
    return switch (raw.schemaVersion()) {
        case 1 -> deriveRiskFromLegacyFields(raw);
        case 2 -> raw.riskAssessment();
        default -> throw new UnknownSchemaVersionException(raw.schemaVersion());
    };
}
```

Jangan biarkan old document menyebabkan runtime ClassCastException yang tidak jelas.

---

## 17. Schema Validation: Fleksibel Tapi Tetap Ada Guardrail

MongoDB mendukung schema validation di collection. Ini tidak menggantikan validasi domain di aplikasi, tetapi berguna sebagai safety net.

Gunakan schema validation untuk hal yang benar-benar harus dijaga di database:

- required fields;
- BSON type;
- enum allowed values;
- range sederhana;
- nested required structure;
- additional constraints dasar.

Contoh konseptual:

```javascript
db.createCollection("cases", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["caseId", "status", "createdAt", "schemaVersion"],
      properties: {
        caseId: { bsonType: "string" },
        status: {
          enum: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ESCALATED", "DECIDED", "CLOSED"]
        },
        createdAt: { bsonType: "date" },
        schemaVersion: { bsonType: "int" }
      }
    }
  }
})
```

### 17.1 Validation Level

Dalam praktik, kamu perlu memikirkan:

- strict vs moderate;
- error vs warn;
- rollout untuk legacy data;
- migration compatibility;
- environment difference.

Jika collection sudah berisi data lama, menerapkan validation terlalu ketat bisa mengganggu deployment.

### 17.2 Database Validation vs Application Validation

Database validation cocok untuk invariant struktural minimal.

Application validation cocok untuk business invariant kompleks.

Contoh business invariant:

```text
Case hanya boleh DECIDED jika semua mandatory review task complete dan decision maker punya authority.
```

Jangan berharap JSON Schema database menjaga invariant seperti ini.

Gunakan database validation sebagai pagar, bukan otak domain.

---

## 18. API Representation vs Persistence Representation

Jangan samakan API JSON dengan BSON document.

API response:

```json
{
  "caseId": "case_01J0XYZ",
  "status": "UNDER_REVIEW",
  "createdAt": "2026-06-20T08:15:30Z",
  "penalty": {
    "amount": "1250000.50",
    "currency": "IDR"
  }
}
```

Persistence:

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1"),
  caseId: "case_01J0XYZ",
  status: "UNDER_REVIEW",
  createdAt: ISODate("2026-06-20T08:15:30Z"),
  penalty: {
    amount: NumberDecimal("1250000.50"),
    currency: "IDR"
  },
  schemaVersion: 2,
  version: NumberLong(7)
}
```

Perbedaan wajar:

| Concern | API | Persistence |
|---|---|---|
| ID | public ID | `_id` + public ID |
| Date | ISO string | BSON Date |
| Money | string amount | Decimal128/minor unit |
| Internal version | hidden | stored |
| Schema version | hidden | stored |
| Sensitive fields | redacted | stored/encrypted |
| Query projection | tailored | full document |

API adalah contract eksternal. Persistence adalah contract internal. Jangan membuat keduanya identik tanpa alasan.

---

## 19. Designing a Document Type Contract

Sebelum membuat collection, tulis kontrak tipe field.

Contoh untuk `cases`:

| Field | Required | BSON Type | Java Type | Meaning | Notes |
|---|---:|---|---|---|---|
| `_id` | yes | ObjectId | ObjectId/String internal | technical ID | not public |
| `caseId` | yes | string | String | public stable ID | unique index |
| `caseNumber` | yes | string | String | human reference | unique per jurisdiction/year |
| `status` | yes | string | CaseStatus | lifecycle state | enum string |
| `createdAt` | yes | date | Instant | creation instant | UTC |
| `updatedAt` | yes | date | Instant | last update instant | UTC |
| `closedAt` | no | date/null policy | Instant | close instant | missing if not closed |
| `priority` | yes | int | int | operational priority | bounded 1-5 |
| `subjectSnapshot` | yes | object | SubjectSnapshot | subject at case creation | embedded snapshot |
| `tags` | yes | array string | Set<String> | classification tags | empty array allowed |
| `penalty.amount` | no | decimal | BigDecimal | penalty amount | only when decided |
| `penalty.currency` | no | string | String | ISO currency | required with amount |
| `version` | yes | long | long | optimistic lock | increment on update |
| `schemaVersion` | yes | int | int | document shape version | current = 2 |

Kontrak seperti ini mengurangi kebingungan dan menjadi dasar:

- Java model;
- schema validation;
- index design;
- migration;
- API mapping;
- test fixtures;
- support query;
- documentation.

---

## 20. Practical Example: Regulatory Case Document

### 20.1 Naive Document

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1"),
  number: "ENF-2026-000123",
  status: 2,
  date: "2026-06-20",
  subject: "PT Example",
  amount: 1000000.5,
  notes: null,
  data: {
    type: "bank",
    risk: "high"
  },
  history: [
    { status: "created", date: "2026-06-20" }
  ]
}
```

Masalah:

- `number` terlalu generik;
- `status` numeric tidak self-describing;
- `date` tidak jelas: created? submitted? local? instant?;
- `subject` cuma string, tidak ada ID/snapshot structure;
- `amount` kemungkinan double;
- `notes: null` tidak jelas;
- `data` dumping ground;
- `history` bisa tumbuh tanpa batas;
- `history.date` string;
- tidak ada schemaVersion;
- tidak ada version untuk concurrency;
- tidak ada public/internal ID separation.

### 20.2 Improved Document

```javascript
{
  _id: ObjectId("665e8fae3e9eaa1f5a4e78a1"),
  schemaVersion: 1,
  version: NumberLong(7),

  caseId: "case_01J0XYZ8M9Q7ABCD1234",
  caseNumber: "ENF-2026-000123",
  jurisdiction: "ID-OJK",

  status: "UNDER_REVIEW",
  priority: 3,
  tags: ["AML", "HIGH_RISK"],

  createdAt: ISODate("2026-06-20T08:15:30Z"),
  updatedAt: ISODate("2026-06-20T09:10:00Z"),
  submittedAt: ISODate("2026-06-20T08:30:00Z"),

  subjectSnapshot: {
    subjectId: "subj_01J0AAA",
    subjectType: "LEGAL_ENTITY",
    legalName: "PT Example Entity",
    registrationNumber: "REG-123456",
    sector: "BANKING"
  },

  riskAssessment: {
    level: "HIGH",
    score: NumberDecimal("87.50"),
    assessedAt: ISODate("2026-06-20T08:45:00Z"),
    modelVersion: "risk-model-2026-01"
  },

  currentAssignment: {
    unitId: "unit_enforcement_aml",
    assigneeUserId: "user_123",
    assignedAt: ISODate("2026-06-20T09:00:00Z")
  },

  latestTransition: {
    from: "SUBMITTED",
    to: "UNDER_REVIEW",
    changedAt: ISODate("2026-06-20T09:00:00Z"),
    changedBy: "user_123"
  }
}
```

Kenapa lebih baik?

- ID jelas;
- tipe waktu benar;
- status self-describing;
- money/score decimal exact;
- subject adalah snapshot defensible;
- assignment embedded karena current assignment sering dibaca bersama case;
- transition summary embedded, full history bisa collection terpisah;
- versioning tersedia;
- schemaVersion tersedia;
- field names domain-oriented.

### 20.3 Separate Audit Events

```javascript
{
  _id: "evt_01J0EVT001",
  caseId: "case_01J0XYZ8M9Q7ABCD1234",
  eventType: "STATUS_CHANGED",
  occurredAt: ISODate("2026-06-20T09:00:00Z"),
  actorUserId: "user_123",
  payload: {
    from: "SUBMITTED",
    to: "UNDER_REVIEW",
    reason: "Initial reviewer accepted case"
  },
  schemaVersion: 1
}
```

Full audit history tidak diembed jika bisa tumbuh tanpa batas. Case document menyimpan current/latest summary untuk operational read.

---

## 21. Type-Driven Query Consequences

Tipe data mempengaruhi query.

### 21.1 Date as Date vs String

Jika `createdAt` adalah Date:

```javascript
{
  createdAt: {
    $gte: ISODate("2026-06-01T00:00:00Z"),
    $lt: ISODate("2026-07-01T00:00:00Z")
  }
}
```

Jika `createdAt` string, kamu kehilangan date semantics dan rawan format inconsistency.

### 21.2 Decimal vs Double

Jika amount Decimal128:

```javascript
{
  "penalty.amount": {
    $gte: NumberDecimal("1000000.00")
  }
}
```

Jika sebagian document double dan sebagian decimal, query bisa membingungkan dan hasil sorting/filtering tidak sesuai ekspektasi.

### 21.3 Null/Missing Query

Misalnya mencari case belum closed.

Jika policy: `closedAt` missing untuk open case:

```javascript
{ closedAt: { $exists: false } }
```

Jika policy: `closedAt: null` untuk open case:

```javascript
{ closedAt: null }
```

Tetapi query `{ closedAt: null }` juga bisa match missing field dalam banyak konteks query MongoDB. Karena itu policy harus jelas dan diuji.

Untuk sistem serius, hindari ambiguity dengan status eksplisit:

```javascript
{ status: { $ne: "CLOSED" } }
```

atau:

```javascript
{ lifecycle.closed: false }
```

Namun boolean juga punya risiko jika lifecycle lebih dari dua state.

### 21.4 Array Query

```javascript
{ tags: "AML" }
```

berbeda dari:

```javascript
{ tags: ["AML"] }
```

Yang pertama mencari array mengandung `AML`. Yang kedua mencari array yang persis sama dengan `['AML']` dalam beberapa semantics.

Untuk array embedded document, gunakan `$elemMatch` saat perlu kondisi pada elemen yang sama.

---

## 22. Type-Driven Index Consequences

Index di MongoDB menyimpan nilai dengan tipe. Jika field yang sama memiliki tipe campuran, index menjadi kurang predictable.

Contoh buruk:

```javascript
{ createdAt: ISODate("2026-06-20T08:15:30Z") }
{ createdAt: "2026-06-20T08:15:30Z" }
```

Index pada `createdAt` akan mengandung tipe Date dan String. Query Date tidak sama dengan query String.

Demikian juga:

```javascript
{ amount: NumberDecimal("100.00") }
{ amount: 100.00 }
{ amount: "100.00" }
```

Ini membuat range query dan aggregation berisiko.

Rule:

```text
Indexable field harus memiliki type contract yang sangat konsisten.
```

Field yang sering masuk query/index harus lebih ketat daripada field yang hanya disimpan untuk display.

---

## 23. Defensive Type Design Checklist

Sebelum menyimpan field baru, jawab:

1. Apa arti domain field ini?
2. Apakah field wajib atau optional?
3. Jika optional, apakah missing dan null dibedakan?
4. Apa Java type-nya?
5. Apa BSON type-nya?
6. Apakah field ini akan dikueri?
7. Apakah field ini akan di-sort?
8. Apakah field ini akan di-index?
9. Apakah field ini akan masuk aggregation?
10. Apakah field ini akan diekspos di API?
11. Apakah field ini bisa berubah nama/format?
12. Apakah field ini butuh backward compatibility?
13. Apakah field ini punya sensitivity/security classification?
14. Apakah field ini bagian dari business invariant?
15. Apakah field ini bisa tumbuh tanpa batas?
16. Apakah field ini punya timezone/calendar semantics?
17. Apakah field ini butuh exact precision?
18. Apakah field ini bisa diduplikasi sebagai snapshot?
19. Apakah field ini harus menjadi value object?
20. Bagaimana field ini dimigrasi jika representation berubah?

Jika kamu tidak bisa menjawab, field belum siap menjadi persisted contract.

---

## 24. Common Production Bugs from Type Mistakes

### 24.1 Money Stored as Double

Symptom:

- reconciliation mismatch;
- sum tidak exact;
- legal report berbeda beberapa sen;
- equality comparison gagal.

Prevention:

- Decimal128 atau minor units;
- Money value object;
- test precision;
- avoid JSON float for money API; use string amount.

### 24.2 Date Stored as String

Symptom:

- sorting salah karena format inconsistent;
- range query lambat/salah;
- timezone bug;
- aggregation date operator tidak usable.

Prevention:

- BSON Date untuk instant;
- ISO date string hanya untuk pure calendar date;
- explicit timezone policy.

### 24.3 Null and Missing Mixed

Symptom:

- query count tidak konsisten;
- partial index tidak match ekspektasi;
- UI menampilkan status salah;
- migration sulit.

Prevention:

- null/missing policy;
- schema validation;
- repository normalization;
- contract tests.

### 24.4 Enum Rename Breaks Old Data

Symptom:

- Java mapping gagal;
- unknown enum value exception;
- dashboard tidak match;
- query status lama hilang.

Prevention:

- stable enum code;
- avoid ordinal;
- backward mapping;
- migration plan.

### 24.5 Mixed Numeric Types

Symptom:

- range query aneh;
- aggregation conversion error;
- Java ClassCastException;
- index not used as expected.

Prevention:

- explicit numeric policy;
- validation;
- migration checks;
- fixture uses Extended JSON.

### 24.6 Unbounded Array

Symptom:

- document too large;
- slow updates;
- high contention;
- difficult pagination;
- large network payload.

Prevention:

- bounded array rule;
- separate collection;
- bucket pattern;
- latest summary embedded only.

---

## 25. Practical Java Modelling Example

### 25.1 Domain Types

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    DECIDED,
    CLOSED
}

public enum SubjectType {
    INDIVIDUAL,
    LEGAL_ENTITY
}

public record Money(
    BigDecimal amount,
    String currency
) {}

public record SubjectSnapshot(
    String subjectId,
    SubjectType subjectType,
    String legalName,
    String registrationNumber,
    String sector
) {}

public record RiskAssessment(
    String level,
    BigDecimal score,
    Instant assessedAt,
    String modelVersion
) {}

public record Assignment(
    String unitId,
    String assigneeUserId,
    Instant assignedAt
) {}

public record CaseDocument(
    String id,
    int schemaVersion,
    long version,
    String caseId,
    String caseNumber,
    String jurisdiction,
    CaseStatus status,
    int priority,
    Set<String> tags,
    Instant createdAt,
    Instant updatedAt,
    Instant submittedAt,
    SubjectSnapshot subjectSnapshot,
    RiskAssessment riskAssessment,
    Assignment currentAssignment
) {}
```

### 25.2 Design Comments

- `id` could map to `_id`, but consider keeping internal ID separate from public `caseId`.
- `schemaVersion` is int because small bounded version.
- `version` is long because optimistic concurrency increments over time.
- `status` should be persisted as string code.
- `priority` is int if bounded 1-5. If priority has lifecycle and meaning, use enum.
- `tags` should be normalized uppercase controlled vocabulary, not free-form random strings.
- `createdAt/updatedAt/submittedAt` use `Instant`.
- `RiskAssessment.score` uses `BigDecimal`, mapped to Decimal128 if persisted.
- `SubjectSnapshot` is embedded because it is a historical snapshot for this case.
- `currentAssignment` embedded because current assignment is read with case. Assignment history may be separate.

---

## 26. Suggested Field Naming Conventions

Pick conventions early.

Recommended for MongoDB + Java:

| Concern | Recommendation |
|---|---|
| Field naming | camelCase |
| Technical ID | `_id` internal |
| Public ID | `<entity>Id`, e.g. `caseId` |
| Timestamps | suffix `At`, e.g. `createdAt` |
| Calendar dates | suffix `Date`, e.g. `birthDate` |
| Durations | suffix `Duration` or explicit unit |
| Amounts | value object with `amount` + `currency` |
| Boolean | prefix meaningful: `isDeleted` only if truly boolean |
| Enum | string uppercase code |
| Version | `version` for optimistic lock |
| Schema version | `schemaVersion` |
| Snapshots | suffix `Snapshot` |
| Normalized fields | suffix `Normalized` |
| External references | `externalRefs` array or source-specific field |

Avoid:

- `data`;
- `info`;
- `misc`;
- `details` as dumping ground;
- `type` without qualifier;
- `date` without qualifier;
- `value` without qualifier;
- `statusFlag`;
- `jsonPayload` unless truly opaque.

---

## 27. Mini Exercise: Classify the Field

For each field, decide representation.

### 27.1 `createdAt`

- Domain: instant when document created.
- Java: `Instant`.
- BSON: Date.
- Required: yes.
- Index: often yes.

### 27.2 `birthDate`

- Domain: calendar date.
- Java: `LocalDate`.
- BSON: string `YYYY-MM-DD` or explicit object.
- Required: depends.
- Index: maybe.

### 27.3 `penaltyAmount`

- Domain: precise money amount.
- Java: `BigDecimal` inside `Money`.
- BSON: Decimal128 or Int64 minor.
- Required: only after decision.
- Index: maybe for reports/search.

### 27.4 `status`

- Domain: lifecycle state.
- Java: enum with stable code.
- BSON: string.
- Required: yes.
- Index: often yes as compound with assignment/date.

### 27.5 `auditEvents`

- Domain: unbounded history.
- Java: separate document collection.
- BSON: separate collection or bucket, not unbounded embedded array.
- Required: no inside case.
- Index: by `caseId`, `occurredAt`, `eventType`.

### 27.6 `tags`

- Domain: bounded classification labels.
- Java: `Set<String>`.
- BSON: array string.
- Required: yes, empty array allowed.
- Index: maybe multikey index.

---

## 28. Summary Mental Model

Part 002 dapat diringkas begini:

```text
MongoDB document terlihat seperti JSON,
tetapi disimpan sebagai BSON,
dan setiap field adalah contract antara domain, Java type, BSON type, query semantics, index behavior, API mapping, dan migration strategy.
```

Kunci pemahaman:

1. BSON lebih kaya dari JSON.
2. JSON representation bisa menipu karena menyembunyikan tipe aktual.
3. `_id` adalah technical identity; public ID sebaiknya dipikirkan terpisah.
4. Date untuk instant, bukan pure calendar date.
5. Money harus exact: Decimal128 atau minor unit.
6. `null`, missing field, empty string, empty array, dan empty object berbeda.
7. Array harus bounded kecuali kamu memakai pattern khusus.
8. Embedded document cocok untuk owned/local value.
9. Field yang sama harus konsisten tipenya.
10. Schema fleksibel tetap membutuhkan contract, versioning, dan validation.
11. API JSON tidak harus sama dengan persistence BSON.
12. Java mapping harus eksplisit untuk enum, money, date/time, UUID, dan value object.

---

## 29. Checklist Sebelum Lanjut ke Part 003

Pastikan kamu bisa menjawab:

- Apa bedanya JSON, BSON, dan Extended JSON?
- Kenapa `createdAt` sebaiknya BSON Date, bukan string?
- Kenapa `LocalDateTime` berbahaya untuk event timestamp?
- Kapan `LocalDate` lebih cocok daripada `Instant`?
- Kenapa money tidak boleh double?
- Apa bedanya missing field dan `null`?
- Kapan array boleh diembed?
- Apa tanda array harus dipindah ke collection sendiri?
- Kenapa enum sebaiknya string code, bukan ordinal?
- Apa fungsi `schemaVersion`?
- Mengapa API model dan persistence model tidak harus sama?
- Bagaimana kamu mendesain field contract untuk collection baru?

Jika jawabanmu sudah jelas, kamu siap masuk Part 003.

---

## 30. Preview Part 003

Part berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-003.md
```

Judul:

```text
Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard
```

Kita akan naik satu level dari tipe data ke arsitektur runtime MongoDB:

- database;
- collection;
- document;
- `mongod`;
- replica set;
- primary/secondary;
- election;
- oplog;
- sharded cluster;
- `mongos`;
- config server;
- failure modes dari perspektif aplikasi Java.

Tujuan Part 003 adalah memahami bahwa MongoDB bukan hanya file document store, tetapi distributed database dengan topology, replication, routing, consistency knobs, dan failure behavior yang harus dipahami sejak desain aplikasi.

---

## Status Seri

- Selesai: **Part 000, Part 001, Part 002**
- Berikutnya: **Part 003**
- Total rencana: **Part 000 sampai Part 035**
- Status: **Seri belum selesai**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-003.md">Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard ➡️</a>
</div>
