# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool

> Seri: **Document-Oriented Database and MongoDB Mastery for Java Engineers**  
> Target pembaca: **Java software engineer / tech lead** yang sudah memahami SQL, PostgreSQL/MySQL, Redis, Kafka/RabbitMQ, HTTP/backend, dan ingin memahami document database secara arsitektural, bukan hanya sintaks MongoDB.  
> Tujuan part ini: membangun mental model awal agar semua part berikutnya tidak jatuh ke kesalahan umum: memakai MongoDB seperti relational database yang syntax-nya beda.

---

## 0. Posisi Part Ini dalam Seri

Part ini bukan tutorial `insertOne`, `find`, indexing, aggregation, atau Spring Data MongoDB. Semua itu akan dibahas setelah mental modelnya kuat.

Bagian ini menjawab pertanyaan yang lebih mendasar:

1. Kenapa document-oriented database ada?
2. Problem apa yang membuat model document masuk akal?
3. Apa bedanya document database dengan relational database, Redis, Kafka, dan RabbitMQ?
4. Apa yang sebenarnya disimpan dalam MongoDB: data bebas, aggregate, object, JSON, event, atau state?
5. Kapan MongoDB adalah pilihan kuat?
6. Kapan MongoDB adalah pilihan buruk?
7. Bagaimana Java engineer harus mengubah cara berpikir saat mendesain schema MongoDB?

Kalau bagian ini dilewati, biasanya engineer akan melakukan salah satu dari dua ekstrem:

- Membuat MongoDB menjadi “SQL buruk”: banyak collection kecil, reference manual, join di aplikasi, query lambat, integrity kacau.
- Membuat MongoDB menjadi “dumping ground JSON”: semua masuk sebagai blob, schema tidak jelas, index tidak dirancang, migration sulit, observability buruk.

MongoDB bukan magic. MongoDB kuat jika model datanya sesuai dengan cara aplikasi membaca, menulis, mengubah, dan menjaga invariant.

---

## 1. Apa Itu Document-Oriented Database?

Document-oriented database adalah database yang menyimpan data sebagai **document**. Dalam MongoDB, document disimpan dalam format **BSON**, yaitu representasi binary dari struktur JSON-like yang mendukung tipe tambahan seperti `ObjectId`, `Date`, `Decimal128`, binary data, nested document, dan array.

Contoh document sederhana:

```json
{
  "_id": "case-2026-000123",
  "caseNumber": "REG-2026-000123",
  "status": "UNDER_REVIEW",
  "subject": {
    "type": "COMPANY",
    "name": "Acme Finance Ltd",
    "registrationNumber": "AFC-99102"
  },
  "allegations": [
    {
      "code": "MISREPORTING",
      "severity": "HIGH",
      "description": "Potential inaccurate regulatory filing"
    }
  ],
  "assignedTeam": "enforcement-review",
  "createdAt": "2026-06-20T10:15:30Z",
  "version": 7
}
```

Yang penting: document bukan sekadar “JSON row”. Document biasanya merepresentasikan **satu aggregate aplikasi**: satu unit data yang sering dibaca bersama, dimutasi dalam boundary yang sama, dan memiliki lifecycle yang relatif kohesif.

Dalam relational database, kita cenderung berpikir:

```text
case
case_subject
case_allegation
case_assignment
case_status_history
```

Dalam document database, kita bertanya lebih dulu:

```text
Untuk use case utama, bagian mana yang selalu dibaca bersama?
Bagian mana yang berubah bersama?
Bagian mana yang punya lifecycle sendiri?
Bagian mana yang tumbuh tanpa batas?
Bagian mana yang perlu consistency atomik?
```

Jawaban dari pertanyaan itu menentukan apakah data di-*embed* dalam satu document atau dipisahkan menjadi collection lain dengan reference.

---

## 2. Kenapa Document Database Muncul?

Relational database sangat kuat untuk model data yang memiliki relasi formal, constraint kuat, transaksi lintas banyak entity, query ad-hoc, reporting, dan data integrity yang eksplisit. Tetapi tidak semua aplikasi cocok dimodelkan sebagai kumpulan table normalisasi tinggi.

Banyak aplikasi modern memiliki karakteristik seperti ini:

1. Data berbentuk object/aggregate, bukan grid baris-kolom sederhana.
2. Struktur data bervariasi antar jenis object.
3. Sebagian besar operasi membaca satu object lengkap atau satu view yang sudah dekat dengan bentuk UI/API.
4. Relasi internal object jauh lebih sering diakses daripada relasi lintas object.
5. Schema berubah mengikuti fitur produk.
6. Aplikasi ingin menghindari banyak join untuk read path yang sangat sering.
7. Data memiliki nested structure natural: profile, address, settings, metadata, form answers, case dossier, product attributes, document metadata.

Contoh yang tidak nyaman jika dimodelkan terlalu relational:

```json
{
  "userId": "u-123",
  "preferences": {
    "language": "id-ID",
    "timezone": "Asia/Jakarta",
    "notification": {
      "email": true,
      "sms": false,
      "push": true,
      "channels": ["case-assigned", "case-escalated", "decision-issued"]
    }
  },
  "featureFlags": {
    "newDashboard": true,
    "advancedSearch": false
  },
  "uiState": {
    "lastOpenedCase": "case-2026-000123",
    "collapsedPanels": ["history", "attachments"]
  }
}
```

Relational model bisa menyimpan ini, tetapi sering menjadi terlalu banyak table kecil, join, atau kolom nullable. Document model membiarkan data yang memang dibaca sebagai satu unit disimpan sebagai satu unit.

Namun fleksibilitas itu tidak gratis. Kalau tidak dikendalikan, aplikasi akan kehilangan predictability, integrity, dan performance.

---

## 3. MongoDB Bukan “No Schema”; MongoDB Adalah “Application-Shaped Schema”

Istilah “schemaless” sering menyesatkan. MongoDB memang tidak memaksa semua document dalam collection memiliki field yang sama secara default. Tetapi aplikasi production tetap punya schema, hanya tempat schema itu berada berbeda.

Dalam relational database:

```text
Schema utama berada di database:
- table
- column
- type
- foreign key
- unique constraint
- check constraint
- migration DDL
```

Dalam MongoDB:

```text
Schema tersebar di beberapa tempat:
- document shape
- application model
- validation rules
- indexes
- serialization/deserialization code
- API contract
- migration/backfill logic
- read/write access patterns
```

MongoDB memiliki flexible schema. Artinya document dalam satu collection dapat berbeda field atau tipe field. Tetapi untuk production system, fleksibilitas ini harus dipakai untuk **evolusi schema**, bukan untuk membiarkan data menjadi liar.

Mental model yang benar:

```text
MongoDB bukan database tanpa schema.
MongoDB adalah database dengan schema yang lebih dekat ke aplikasi dan access pattern.
```

Konsekuensinya:

1. Schema design harus dilakukan sejak awal.
2. Index adalah bagian dari schema.
3. Field optional harus punya makna jelas.
4. Null dan missing field harus dibedakan.
5. Versi document harus direncanakan.
6. Migration/backfill tetap dibutuhkan.
7. Schema validation tetap berguna untuk mencegah data buruk.
8. Aplikasi harus kompatibel dengan document lama dan baru.

---

## 4. Apa yang Dimaksud dengan “Document” secara Arsitektural?

Untuk engineer yang terbiasa SQL, istilah document sering dianggap:

```text
Document = row dengan format JSON
```

Itu tidak cukup. Dalam desain yang matang:

```text
Document = unit data yang menyatukan shape, locality, ownership, atomicity, dan lifecycle.
```

Mari uraikan.

### 4.1 Document sebagai Shape Boundary

Document menentukan bentuk data yang disimpan dan biasanya mendekati bentuk data yang dibutuhkan aplikasi.

Contoh API membaca detail case:

```http
GET /cases/{caseId}
```

Response mungkin butuh:

- case number
- status
- subject
- allegations
- assigned reviewer
- current SLA
- risk classification
- latest decision summary

Jika semua field itu hampir selalu dibaca bersama, menyimpannya berdekatan membuat read path sederhana.

### 4.2 Document sebagai Locality Boundary

Data yang berada dalam satu document dapat dibaca dalam satu operasi document lookup. Ini mengurangi join dan network round-trip.

Tetapi locality bukan berarti semua data harus di-embed.

Contoh buruk:

```json
{
  "caseId": "case-1",
  "notes": [
    { "noteId": "n1", "text": "..." },
    { "noteId": "n2", "text": "..." }
    // tumbuh tanpa batas selama bertahun-tahun
  ]
}
```

Jika notes bisa tumbuh ribuan atau jutaan entry, embed dalam satu document akan membuat document membesar, update mahal, contention meningkat, dan pagination buruk.

### 4.3 Document sebagai Atomicity Boundary

MongoDB memberikan atomicity pada level single document. Jika beberapa field dalam satu document di-update dalam satu operasi, perubahan itu atomik untuk document tersebut.

Ini membuat desain aggregate sangat penting. Jika invariant penting berada dalam satu document, enforcement bisa lebih sederhana.

Contoh:

```text
Jika status case berubah dari UNDER_REVIEW ke ESCALATED,
field escalationReason, escalatedAt, escalatedBy, currentOwner juga harus berubah bersama.
```

Jika semua ada dalam satu case document, update bisa dilakukan atomik dengan conditional update.

### 4.4 Document sebagai Ownership Boundary

Field/subdocument yang di-embed seharusnya dimiliki oleh parent aggregate.

Contoh yang cocok di-embed:

```json
{
  "caseId": "case-1",
  "subjectSnapshot": {
    "name": "Acme Finance Ltd",
    "registrationNumber": "AFC-99102",
    "capturedAt": "2026-06-20T10:00:00Z"
  }
}
```

`subjectSnapshot` adalah snapshot yang dimiliki case. Jika data master company berubah, snapshot pada case tidak harus ikut berubah karena snapshot punya makna historis.

Contoh yang tidak selalu cocok di-embed:

```json
{
  "caseId": "case-1",
  "company": {
    "companyId": "company-9",
    "currentName": "Acme Finance Ltd",
    "licenses": [...],
    "directors": [...],
    "allCases": [...]
  }
}
```

Company adalah aggregate sendiri. Memasukkan seluruh company ke setiap case menyebabkan duplikasi besar dan inconsistency.

### 4.5 Document sebagai Lifecycle Boundary

Kalau child data dibuat, berubah, dan dihapus bersama parent, embed sering masuk akal.

Kalau child data punya lifecycle sendiri, permission sendiri, query sendiri, atau retention sendiri, reference sering lebih aman.

---

## 5. Perbandingan dengan Relational Database

### 5.1 Relational Model: Strength

Relational database unggul pada:

1. Data integrity formal.
2. Foreign key.
3. Constraint kuat.
4. Ad-hoc query.
5. Join fleksibel.
6. Normalisasi.
7. Multi-entity transaction.
8. Reporting dan analytical query.
9. Mature optimizer.
10. Strong consistency default untuk banyak use case.

Model relational bertanya:

```text
Apa entity-nya?
Apa relasinya?
Apa cardinality-nya?
Bagaimana normalisasi agar tidak ada redundant truth?
Apa constraint-nya?
```

### 5.2 Document Model: Strength

Document database unggul pada:

1. Aggregate-oriented storage.
2. Nested data natural.
3. Read locality.
4. Flexible schema evolution.
5. Polymorphic document shapes.
6. Application-shaped data.
7. Fewer joins for common read path.
8. Easier persistence for rich object structures.
9. Natural fit untuk metadata, profile, catalog, case dossier, configuration, form-like data.

Model document bertanya:

```text
Apa access pattern utamanya?
Data apa yang dibaca bersama?
Data apa yang berubah bersama?
Apa aggregate boundary-nya?
Apa invariant yang harus dijaga atomik?
Apa yang tumbuh tanpa batas?
Apa yang sering dicari/filter/sort?
```

### 5.3 Perbedaan Paling Penting

Relational schema biasanya dimulai dari **truth normalization**.

Document schema biasanya dimulai dari **use-case locality**.

Relational design sering bertujuan:

```text
Minimize duplication.
Keep facts in exactly one place.
Use joins to assemble views.
```

Document design sering bertujuan:

```text
Keep frequently accessed data together.
Duplicate deliberately when it improves read path.
Make aggregate boundary explicit.
Pay consistency cost consciously.
```

Ini bukan berarti document database tidak peduli correctness. Artinya correctness harus dimodelkan dengan boundary berbeda.

---

## 6. Perbandingan MongoDB dengan PostgreSQL JSONB

Karena Anda sudah belajar PostgreSQL, pertanyaan naturalnya:

```text
Kenapa tidak pakai PostgreSQL JSONB saja?
```

Jawaban singkat: sering kali, PostgreSQL JSONB memang cukup. MongoDB bukan otomatis lebih baik hanya karena datanya nested.

### 6.1 PostgreSQL JSONB Cocok Jika

1. Core system sudah relational.
2. JSON hanya sebagian kecil dari model.
3. Anda tetap butuh foreign key, joins, constraints, relational transactions.
4. Query utama tetap relational.
5. JSON dipakai untuk metadata tambahan, bukan primary data model.
6. Team sudah kuat di PostgreSQL dan operational footprint ingin sederhana.

Contoh:

```sql
CREATE TABLE enforcement_case (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL,
  subject_id UUID NOT NULL REFERENCES subject(id),
  metadata JSONB NOT NULL
);
```

Ini sangat masuk akal jika `metadata` hanya extension field.

### 6.2 MongoDB Cocok Jika

1. Mayoritas data utama memang aggregate-shaped.
2. Nested structure adalah first-class, bukan tambahan.
3. Read path sering mengambil document lengkap.
4. Data polymorphic antar subtype.
5. Schema sering evolve mengikuti produk.
6. Anda ingin collection/document menjadi persistence boundary utama.
7. Query pattern dapat dirancang eksplisit dan di-index dengan baik.

### 6.3 Pertanyaan Praktis

Gunakan PostgreSQL JSONB jika:

```text
Relational truth tetap pusat sistem, JSON hanya fleksibilitas tambahan.
```

Pertimbangkan MongoDB jika:

```text
Document/aggregate adalah pusat sistem, dan relational join bukan cara utama membaca data.
```

---

## 7. Perbandingan MongoDB dengan Redis

Redis adalah in-memory data structure store. Redis sangat kuat untuk:

- cache
- session
- distributed lock tertentu
- rate limiting
- ephemeral data
- counters
- pub/sub ringan
- sorted sets
- low-latency lookup

MongoDB adalah document database persistent untuk operational data.

Perbedaan mental model:

```text
Redis:
- key-oriented
- memory-first
- structure per key
- often transient/derived
- extremely low latency

MongoDB:
- document-oriented
- disk-backed with working set optimization
- indexed query over collections
- operational persistence
- richer query and aggregation
```

Contoh salah:

```text
Menyimpan authoritative regulatory case state hanya di Redis.
```

Redis bisa menjadi cache atau ephemeral coordination layer, tetapi authoritative case state yang butuh audit, query, retention, dan migration lebih cocok di database persistent seperti PostgreSQL atau MongoDB.

Contoh benar:

```text
MongoDB menyimpan case document.
Redis menyimpan cache case summary atau rate limit API search.
```

---

## 8. Perbandingan MongoDB dengan Kafka/RabbitMQ

Kafka/RabbitMQ adalah messaging/event streaming systems, bukan document database.

Kafka unggul untuk:

- durable event log
- stream processing
- replay
- decoupled integration
- high-throughput event distribution

RabbitMQ unggul untuk:

- message routing
- work queue
- command delivery
- flexible exchange/routing topology
- consumer acknowledgement

MongoDB unggul untuk:

- current operational state
- document aggregate persistence
- queryable application data
- indexed retrieval
- aggregate mutation

Kesalahan umum:

```text
Menggunakan MongoDB sebagai event bus.
```

Change streams memang dapat mengamati perubahan di MongoDB, tetapi itu tidak sama dengan desain event streaming. Change streams berguna untuk integrasi tertentu, cache invalidation, search indexing, atau projection update. Tetapi untuk business event contract yang perlu replay jangka panjang, fan-out tinggi, retention event, dan stream processing, Kafka tetap lebih natural.

Kesalahan lain:

```text
Menggunakan Kafka sebagai database utama untuk query operational.
```

Kafka menyimpan log, tetapi aplikasi biasanya tetap membutuhkan state store/query store. MongoDB bisa menjadi salah satu query/operational state store.

Mental model sehat:

```text
Kafka/RabbitMQ memindahkan kejadian atau perintah.
MongoDB menyimpan state dokumen yang bisa ditanya aplikasi.
Redis mempercepat akses atau menyimpan state ephemeral.
PostgreSQL menjaga relational truth ketika modelnya relational.
```

---

## 9. Kapan MongoDB Cocok?

MongoDB cocok ketika struktur data dan access pattern Anda selaras dengan document model.

### 9.1 Aggregate-Centric Domain

Domain Anda punya aggregate yang jelas.

Contoh:

```text
Case
 ├── subject snapshot
 ├── current classification
 ├── current assignment
 ├── allegations
 ├── current SLA
 ├── decision summary
 └── workflow state
```

Jika sebagian besar operasi membaca dan mengubah case sebagai satu unit, document model kuat.

### 9.2 Read Path Membutuhkan Data yang Sudah Dekat dengan Bentuk Aplikasi

Contoh API:

```http
GET /cases/{caseId}/summary
```

Jika response selalu membutuhkan beberapa nested subdocument kecil, embed bisa menghindari join.

### 9.3 Data Polymorphic

Contoh product catalog:

```json
{
  "type": "BOOK",
  "title": "...",
  "isbn": "...",
  "authors": [...]
}
```

```json
{
  "type": "LAPTOP",
  "brand": "...",
  "cpu": "...",
  "memoryGb": 32,
  "ports": [...]
}
```

Dalam relational database, ini sering menjadi banyak subtype table, EAV anti-pattern, atau JSONB hybrid. MongoDB bisa lebih natural jika query pattern tetap terkendali.

### 9.4 Metadata-Heavy Data

Contoh:

- document metadata
- evidence metadata
- form submissions
- compliance checklist
- dynamic configuration
- user preferences
- integration payload snapshots

Data seperti ini sering berubah bentuk, tetapi tetap butuh persistence dan query.

### 9.5 Content or Dossier-Like Structures

Contoh regulatory case dossier:

```json
{
  "caseId": "case-1",
  "overview": {...},
  "riskAssessment": {...},
  "currentDecision": {...},
  "documentsSummary": [...],
  "taskSummary": {...}
}
```

Aplikasi sering membaca satu dossier untuk UI atau API.

### 9.6 High-Volume Operational Reads dengan Query Pattern Jelas

Jika query pattern jelas dan bisa di-index, MongoDB dapat melayani read path operational dengan baik.

Contoh:

```text
Find active cases by tenantId + status + assignedTeam + dueDate sort.
Find company profile by registrationNumber.
Find documents by caseId + documentType + createdAt.
```

### 9.7 Schema Evolution Cepat

MongoDB cocok untuk domain yang berubah bentuk secara iteratif, selama evolusinya tetap dikontrol.

Contoh:

```text
Versi awal riskAssessment hanya punya score.
Versi berikutnya punya score, factors, modelVersion, reviewerOverride.
Versi berikutnya punya regionalPolicyImpact.
```

Dalam document database, field baru bisa ditambahkan tanpa migrasi semua document seketika. Tetapi aplikasi tetap harus tahu cara membaca document lama.

---

## 10. Kapan MongoDB Tidak Cocok?

MongoDB sering gagal bukan karena teknologinya buruk, tetapi karena problemnya tidak cocok atau desainnya salah.

### 10.1 Highly Relational Core Domain

Jika domain utama berisi relasi kompleks yang perlu dijaga formal oleh database, relational database lebih natural.

Contoh:

```text
General ledger
Double-entry accounting
Complex entitlement graph
Highly normalized master data
Inventory with strict relational constraints
```

MongoDB bisa digunakan, tetapi Anda akan membangun ulang banyak constraint di aplikasi.

### 10.2 Query Ad-Hoc Lintas Banyak Entity

Jika user harus bebas membuat query apa pun lintas entity:

```text
Join A, B, C, D, E dengan filter arbitrer dan grouping arbitrer.
```

Relational database atau analytical database lebih cocok.

MongoDB aggregation kuat, tetapi bukan pengganti universal untuk relational analytical workload.

### 10.3 Cross-Aggregate Consistency Berat

Jika hampir setiap operasi harus mengubah banyak aggregate dan invariant lintas aggregate harus selalu kuat, MongoDB bisa menjadi rumit.

MongoDB mendukung multi-document transactions, tetapi document modelling yang baik biasanya berusaha membuat transaksi lintas document bukan default path.

Jika desain Anda butuh transaksi lintas 8 collection untuk operasi normal, kemungkinan modelnya tidak cocok atau boundary aggregate-nya salah.

### 10.4 Data Relationship Lebih Penting daripada Document Shape

Jika pertanyaan utama sistem adalah traversal relationship:

```text
Siapa terhubung dengan siapa?
Apa shortest path?
Apa network influence?
Apa dependency graph?
```

Graph database atau relational recursive query bisa lebih cocok, tergantung kasus.

### 10.5 Reporting Berat sebagai Workload Utama

Jika workload utama adalah reporting/ad-hoc analytics, gunakan data warehouse/lakehouse/OLAP system. MongoDB bisa menjadi source operational, lalu data diproyeksikan ke analytical store.

### 10.6 Team Mengira Flexible Schema Berarti Tidak Perlu Desain

Ini red flag besar.

Jika alasan memilih MongoDB adalah:

```text
Kita belum tahu schema-nya, jadi pakai MongoDB saja.
```

Itu bukan alasan kuat. Ketidaktahuan domain bukan alasan untuk menghilangkan desain. MongoDB memberi fleksibilitas, bukan membebaskan Anda dari modelling.

---

## 11. Kesalahan Umum Java Engineer Saat Pertama Memakai MongoDB

### 11.1 Membuat Collection seperti Table

Contoh buruk:

```text
cases
case_subjects
case_allegations
case_statuses
case_assignments
case_priorities
case_flags
case_slas
```

Lalu aplikasi melakukan banyak query untuk assemble case detail.

Masalah:

1. Banyak round-trip.
2. Manual join di aplikasi.
3. Invariant tersebar.
4. Transaction makin sering dibutuhkan.
5. Performance tergantung orchestration aplikasi.
6. MongoDB kehilangan keunggulan locality.

Bukan berarti banyak collection selalu salah. Yang salah adalah memecah aggregate tanpa alasan lifecycle/query/size yang kuat.

### 11.2 Menganggap Document = Serialized Java Object

Contoh buruk:

```text
Class Case punya semua field internal domain, lalu langsung disimpan apa adanya.
```

Masalah:

1. Persistence schema bocor dari class design.
2. Refactor Java class dapat merusak data lama.
3. Field internal ikut tersimpan.
4. API, domain, dan persistence model tercampur.
5. Migration sulit.

Model yang lebih sehat:

```text
Domain model: merepresentasikan behavior dan invariant.
Persistence document: merepresentasikan storage shape.
DTO/API model: merepresentasikan external contract.
```

Kadang ketiganya mirip. Tapi jangan diasumsikan selalu sama.

### 11.3 Tidak Mendesain Index dari Awal

MongoDB tanpa index yang sesuai akan melakukan collection scan. Untuk dataset kecil terlihat baik, lalu runtuh saat data besar.

Index bukan optimasi belakangan. Index adalah bagian dari desain query.

Sebelum membuat collection production, Anda harus tahu:

```text
Query apa yang wajib cepat?
Filter field apa yang dipakai?
Sort field apa yang dipakai?
Apakah query menggunakan tenantId?
Apakah query menggunakan status?
Apakah query menggunakan time range?
Apakah pagination pakai skip atau cursor?
```

### 11.4 Membuat Array Tumbuh Tanpa Batas

Contoh:

```json
{
  "caseId": "case-1",
  "auditEvents": [
    { "type": "CREATED", "at": "..." },
    { "type": "ASSIGNED", "at": "..." }
  ]
}
```

Untuk audit kecil, ini terlihat nyaman. Tetapi audit event pada sistem regulasi bisa tumbuh panjang selama bertahun-tahun.

Risiko:

1. Document membesar.
2. Update array makin mahal.
3. Pagination event buruk.
4. Write contention meningkat.
5. Document size limit bisa tercapai.

Solusi bisa berupa collection `case_audit_events` terpisah, bucket pattern, atau hybrid summary + event collection.

### 11.5 Mengabaikan Consistency Boundary

Contoh:

```text
Case status ada di collection cases.
Task status ada di collection tasks.
SLA status ada di collection slas.
Dashboard status dihitung dari collection lain.
```

Jika operasi escalate case harus mengubah semua itu, Anda perlu memikirkan:

1. Apakah harus atomik?
2. Apa yang terjadi jika update kedua gagal?
3. Apakah ada retry?
4. Apakah command idempotent?
5. Apakah UI bisa melihat intermediate state?
6. Apakah audit tetap benar?

MongoDB mendukung transaction, tetapi desain yang baik tetap menghindari transaksi lintas banyak aggregate sebagai default.

### 11.6 Menganggap `$lookup` Sama dengan Join Relational

MongoDB punya `$lookup` untuk join-like aggregation. Tetapi jika setiap query utama membutuhkan `$lookup` lintas banyak collection, kemungkinan model document Anda tidak memanfaatkan locality.

`$lookup` berguna. Tetapi `$lookup` bukan alasan untuk mendesain MongoDB seperti normalized relational database.

### 11.7 Tidak Punya Schema Evolution Strategy

Flexible schema membuat Anda mudah menambah field. Tetapi setelah satu tahun, Anda mungkin punya:

```text
riskScore
risk_score
risk.score
riskAssessment.score
riskAssessment.finalScore
```

Tanpa governance, flexible schema menjadi entropy.

Perlu:

1. Naming convention.
2. Schema version.
3. Migration plan.
4. Reader compatibility.
5. Writer compatibility.
6. Validation rules.
7. Contract tests.

---

## 12. Core Trade-Off: Duplication vs Join

Relational database cenderung menghindari duplikasi. Document database menerima duplikasi jika duplikasi itu memperbaiki locality dan performance.

Tetapi duplikasi selalu punya harga.

Contoh:

```json
{
  "caseId": "case-1",
  "subjectId": "company-9",
  "subjectSnapshot": {
    "name": "Acme Finance Ltd",
    "registrationNumber": "AFC-99102",
    "riskTierAtCaseCreation": "HIGH"
  }
}
```

Ini duplikasi dari company master data. Tapi ini bisa benar karena snapshot historis memang harus stabil.

Contoh duplikasi berbahaya:

```json
{
  "caseId": "case-1",
  "companyCurrentLicenseStatus": "ACTIVE"
}
```

Jika license status harus selalu current dan berubah di company master, Anda harus punya mekanisme update semua case terkait atau menerima staleness.

Pertanyaan desain:

```text
Apakah field duplikat ini snapshot historis atau cache current state?
Jika snapshot, kapan diambil dan apakah immutable?
Jika cache, siapa yang memperbarui?
Berapa lama boleh stale?
Bagaimana repair jika tidak sinkron?
```

Duplikasi bukan dosa. Duplikasi tanpa ownership dan staleness contract adalah dosa.

---

## 13. Core Trade-Off: Flexible Schema vs Predictability

Flexible schema membantu evolusi. Tetapi sistem production membutuhkan predictability.

### 13.1 Flexible Schema Membantu Saat

1. Menambah field baru tanpa downtime.
2. Mendukung subtype berbeda dalam satu collection.
3. Menyimpan metadata yang berbeda antar domain object.
4. Melakukan gradual migration.
5. Mendukung backward compatibility.

### 13.2 Flexible Schema Berbahaya Saat

1. Tidak ada canonical field name.
2. Tipe field berubah tanpa aturan.
3. Query harus meng-handle terlalu banyak variasi.
4. Index tidak bisa dirancang stabil.
5. Data quality tidak dijaga.
6. Aplikasi lama dan baru menulis format berbeda tanpa koordinasi.

### 13.3 Rule of Thumb

Gunakan fleksibilitas untuk **evolusi terkendali**, bukan untuk **ketidakdisiplinan data**.

---

## 14. Core Trade-Off: Single Document Atomicity vs Multi-Document Transaction

MongoDB menyediakan atomicity pada single document dan juga mendukung multi-document transactions. Namun pilihan desain terbaik biasanya dimulai dari pertanyaan:

```text
Bisakah invariant utama saya berada dalam satu document?
```

Jika ya, operasi lebih sederhana, lebih cepat, dan lebih mudah dipikirkan.

Contoh:

```json
{
  "caseId": "case-1",
  "status": "UNDER_REVIEW",
  "assignment": {
    "team": "review-team-a",
    "reviewerId": "user-7"
  },
  "sla": {
    "dueAt": "2026-06-25T00:00:00Z",
    "breachRisk": "MEDIUM"
  },
  "version": 3
}
```

Escalation bisa dilakukan dengan conditional update:

```javascript
db.cases.updateOne(
  {
    _id: "case-1",
    status: "UNDER_REVIEW",
    version: 3
  },
  {
    $set: {
      status: "ESCALATED",
      "assignment.team": "senior-enforcement",
      "sla.breachRisk": "HIGH",
      escalatedAt: ISODate("2026-06-20T12:00:00Z")
    },
    $inc: { version: 1 }
  }
)
```

Jika `matchedCount = 0`, berarti state sudah berubah atau version stale. Ini sangat berguna untuk workflow/state machine.

Multi-document transaction tetap valid saat benar-benar diperlukan, misalnya:

1. Membuat case dan ledger-like allocation yang harus konsisten.
2. Memindahkan ownership antar aggregate dengan invariant kuat.
3. Menulis beberapa document yang harus terlihat atomik.

Tetapi jika semua operasi normal butuh transaction, evaluasi ulang model.

---

## 15. Core Trade-Off: Query Freedom vs Query Governance

Relational database sering lebih toleran terhadap query ad-hoc karena optimizer, join, dan schema formal kuat. MongoDB tetap punya query language dan aggregation pipeline kuat, tetapi performance sangat tergantung pada index dan document shape.

Dalam MongoDB production, Anda harus mengelola query sebagai kontrak.

Contoh search screen:

```text
Filter:
- tenantId
- status
- assignedTeam
- priority
- createdAt range
- dueAt range
- subjectName prefix
- allegationCode

Sort:
- createdAt desc
- dueAt asc
- priority desc
```

Jangan membiarkan API menerima filter/sort arbitrer tanpa batas. Itu akan menciptakan kombinasi query yang tidak bisa semua di-index.

Query governance berarti:

1. Tetapkan filter yang didukung.
2. Tetapkan sort yang didukung.
3. Tetapkan compound index sesuai query paling penting.
4. Tolak query mahal atau beri async export flow.
5. Gunakan pagination yang scalable.
6. Monitor slow query.

---

## 16. Kapan Embed, Kapan Reference: Preview Mental Model

Part khusus embed/reference akan dibahas nanti. Untuk orientasi, gunakan heuristic awal berikut.

### 16.1 Embed Jika

1. Data selalu dibaca bersama parent.
2. Data dimiliki parent.
3. Data berubah bersama parent.
4. Data ukurannya kecil/terbatas.
5. Data tidak perlu query independen intensif.
6. Atomic update bersama parent penting.

Contoh:

```json
{
  "caseId": "case-1",
  "riskAssessment": {
    "score": 87,
    "tier": "HIGH",
    "factors": ["late-filing", "prior-warning"]
  }
}
```

### 16.2 Reference Jika

1. Data punya lifecycle sendiri.
2. Data tumbuh tanpa batas.
3. Data sering dicari independen.
4. Data digunakan oleh banyak parent.
5. Data punya permission/retention berbeda.
6. Data terlalu besar untuk parent document.

Contoh:

```json
{
  "caseId": "case-1",
  "primaryDocumentIds": ["doc-1", "doc-2"]
}
```

Document detail bisa berada di collection `case_documents`.

### 16.3 Hybrid Sering Paling Realistis

Contoh:

```json
{
  "caseId": "case-1",
  "documentSummary": [
    {
      "documentId": "doc-1",
      "title": "Initial Filing",
      "type": "FILING",
      "receivedAt": "2026-06-19T09:30:00Z"
    }
  ]
}
```

Detail document tetap di collection lain, tetapi summary kecil di-embed untuk read path case detail.

Ini adalah deliberate duplication.

---

## 17. MongoDB dari Perspektif Java Engineer

Java engineer sering membawa mindset dari JPA/Hibernate:

```text
Entity class -> table
@OneToMany -> relationship
Repository -> CRUD
Transaction boundary -> service method
Lazy loading -> navigation
```

Mindset ini harus diubah saat memakai MongoDB.

### 17.1 Jangan Membawa JPA Mindset Mentah-Mentah

MongoDB bukan object graph persistence engine. Jika Anda membuat model seperti:

```java
class Case {
    private Subject subject;
    private List<Allegation> allegations;
    private List<Task> tasks;
    private List<Document> documents;
    private List<AuditEvent> auditEvents;
}
```

Lalu otomatis menyimpan semua object graph ke satu document, Anda mungkin membuat document terlalu besar dan lifecycle kacau.

Sebaliknya, jika semua field menjadi reference karena terbiasa normalized, Anda kehilangan locality.

### 17.2 Repository Harus Access-Pattern Aware

Repository tidak cukup hanya:

```java
save(Case c)
findById(String id)
delete(String id)
```

Repository MongoDB production perlu method sesuai command/query shape:

```java
Optional<CaseDocument> findCaseForDetail(String tenantId, String caseId);
Page<CaseListItem> findOpenCasesByTeam(String tenantId, String teamId, Cursor cursor);
boolean transitionStatus(String caseId, CaseStatus from, CaseStatus to, long expectedVersion);
void appendAuditEvent(AuditEvent event);
```

Nama method harus mengungkap access pattern dan invariant.

### 17.3 Serialization Adalah Contract

Field name dalam BSON adalah contract jangka panjang. Refactor Java tidak boleh sembarangan mengubah persisted field.

Contoh:

```java
private String caseNumber;
```

Jika field BSON adalah `caseNumber`, lalu Java refactor menjadi `referenceNumber`, Anda harus tetap mempertimbangkan data lama.

Gunakan explicit mapping jika perlu.

### 17.4 Immutability dan Versioning Penting

Untuk workflow dan concurrency, document sebaiknya punya:

```json
{
  "_id": "case-1",
  "status": "UNDER_REVIEW",
  "version": 12,
  "updatedAt": "2026-06-20T12:00:00Z"
}
```

Version field membantu optimistic concurrency.

---

## 18. Cara Memilih Database: Decision Framework

Gunakan framework ini sebelum memilih MongoDB.

### 18.1 Pertanyaan Domain

1. Apakah data punya aggregate boundary yang jelas?
2. Apakah nested structure natural?
3. Apakah data sering dibaca sebagai satu unit?
4. Apakah child data dimiliki parent?
5. Apakah ada banyak subtype/polymorphic shape?
6. Apakah schema sering evolve?

Jika banyak jawaban “ya”, MongoDB mungkin cocok.

### 18.2 Pertanyaan Consistency

1. Apakah invariant utama bisa berada dalam satu document?
2. Apakah transaksi lintas document jarang?
3. Apakah staleness pada duplicate field bisa diterima/dikelola?
4. Apakah aplikasi siap mengelola idempotency dan retry?
5. Apakah read concern/write concern dipahami?

Jika semua operasi butuh consistency lintas banyak aggregate, hati-hati.

### 18.3 Pertanyaan Query

1. Query utama apa saja?
2. Filter dan sort apa yang wajib cepat?
3. Apakah query bisa di-index?
4. Apakah search ad-hoc perlu dibatasi?
5. Apakah reporting berat perlu sistem terpisah?
6. Apakah pagination scalable?

Jika query pattern tidak jelas, jangan mulai dari schema. Mulai dari use case.

### 18.4 Pertanyaan Operasional

1. Siapa yang mengoperasikan cluster?
2. Bagaimana backup/restore?
3. Bagaimana monitoring slow query?
4. Bagaimana schema migration?
5. Bagaimana index rollout?
6. Bagaimana handle failover?
7. Bagaimana data retention?
8. Bagaimana security dan audit?

MongoDB production tetap membutuhkan operational discipline.

### 18.5 Pertanyaan Team

1. Apakah team memahami document modelling?
2. Apakah team hanya ingin menghindari migration SQL?
3. Apakah team siap membuat index governance?
4. Apakah team bisa menulis query explain-driven?
5. Apakah team punya testing untuk migration dan schema compatibility?

Teknologi yang cocok secara teori bisa gagal jika team mental model-nya salah.

---

## 19. Contoh Pilihan: Case Management Platform

Karena konteks Anda dekat dengan regulatory/enforcement lifecycle, mari gunakan contoh domain ini.

### 19.1 Use Case

Sistem case management punya:

- case
- subject
- allegation
- evidence
- document
- task
- workflow state
- assignment
- review
- decision
- audit trail
- SLA
- escalation

Pertanyaan pertama bukan:

```text
Table apa saja?
```

Pertanyaan pertama:

```text
Apa aggregate utama?
Apa yang dibaca bersama?
Apa yang tumbuh tanpa batas?
Apa yang harus atomik?
Apa yang punya retention berbeda?
```

### 19.2 Candidate Aggregate

`Case` bisa menjadi aggregate utama:

```json
{
  "_id": "case-2026-000123",
  "tenantId": "regulator-id",
  "caseNumber": "REG-2026-000123",
  "status": "UNDER_REVIEW",
  "subjectSnapshot": {
    "subjectId": "subject-9",
    "name": "Acme Finance Ltd",
    "type": "COMPANY",
    "registrationNumber": "AFC-99102"
  },
  "allegations": [
    {
      "code": "MISREPORTING",
      "severity": "HIGH",
      "summary": "Potential inaccurate regulatory filing"
    }
  ],
  "assignment": {
    "teamId": "enforcement-review",
    "reviewerId": "user-7"
  },
  "sla": {
    "dueAt": "2026-06-25T00:00:00Z",
    "breachRisk": "MEDIUM"
  },
  "decisionSummary": null,
  "version": 7,
  "createdAt": "2026-06-20T10:15:30Z",
  "updatedAt": "2026-06-20T12:00:00Z"
}
```

Ini masuk akal jika case detail UI sering butuh semua field ini.

### 19.3 Apa yang Tidak Di-Embed?

Audit events mungkin tidak di-embed jika tumbuh panjang:

```json
{
  "_id": "audit-1",
  "caseId": "case-2026-000123",
  "eventType": "STATUS_CHANGED",
  "from": "TRIAGE",
  "to": "UNDER_REVIEW",
  "actorId": "user-7",
  "at": "2026-06-20T12:00:00Z"
}
```

Documents/evidence juga mungkin collection terpisah karena:

1. Ukuran besar.
2. Lifecycle sendiri.
3. Permission berbeda.
4. Search/filter sendiri.
5. Retention/legal hold berbeda.

### 19.4 Hybrid Summary

Case document bisa menyimpan summary kecil:

```json
{
  "evidenceSummary": {
    "count": 18,
    "latestReceivedAt": "2026-06-20T11:45:00Z",
    "hasCriticalEvidence": true
  }
}
```

Detail evidence tetap collection lain.

### 19.5 Invariant

Contoh invariant:

```text
Case hanya boleh pindah dari UNDER_REVIEW ke ESCALATED jika:
- status saat ini UNDER_REVIEW
- reviewer assigned
- escalationReason diberikan
- version belum berubah
```

MongoDB conditional update cocok:

```javascript
db.cases.updateOne(
  {
    _id: "case-2026-000123",
    tenantId: "regulator-id",
    status: "UNDER_REVIEW",
    "assignment.reviewerId": { $exists: true },
    version: 7
  },
  {
    $set: {
      status: "ESCALATED",
      escalationReason: "Potential systemic issue",
      escalatedAt: ISODate("2026-06-20T12:30:00Z"),
      updatedAt: ISODate("2026-06-20T12:30:00Z")
    },
    $inc: { version: 1 }
  }
)
```

Jika tidak ada match, command gagal secara aman.

---

## 20. Anti-Pattern: “Kita Pakai MongoDB Supaya Tidak Perlu Migration”

Ini asumsi lemah.

MongoDB mengurangi kebutuhan migration tertentu, terutama saat menambah optional field. Tetapi production system tetap membutuhkan migration untuk:

1. Rename field.
2. Split field.
3. Merge field.
4. Change type.
5. Backfill computed field.
6. Create index.
7. Move embedded data to collection.
8. Move referenced data into embedded snapshot.
9. Add schema validation.
10. Change shard key strategy.

Bedanya, MongoDB memungkinkan strategi migration lebih gradual:

```text
1. Deploy reader yang bisa membaca schema lama dan baru.
2. Deploy writer yang menulis schema baru.
3. Backfill data lama secara batch.
4. Monitor compatibility.
5. Hapus fallback setelah aman.
```

Ini tetap butuh engineering discipline.

---

## 21. Anti-Pattern: “Kita Pakai MongoDB karena Data Kita JSON”

Banyak data modern berbentuk JSON karena API memakai JSON. Tetapi format transport bukan alasan cukup untuk memilih storage engine.

Pertanyaan yang lebih benar:

```text
Apakah data JSON ini adalah aggregate yang punya lifecycle dan query pattern cocok dengan document model?
```

Contoh JSON yang cocok MongoDB:

```text
Dynamic form submission dengan field berbeda per form type,
perlu disimpan, dicari berdasarkan metadata, dan ditampilkan kembali sebagai document.
```

Contoh JSON yang mungkin lebih cocok PostgreSQL JSONB:

```text
Order relational system dengan metadata tambahan kecil di tiap order.
Core integrity tetap relational.
```

Contoh JSON yang lebih cocok object storage:

```text
Payload besar yang jarang di-query field internalnya,
hanya perlu disimpan dan diambil sebagai blob.
```

---

## 22. Anti-Pattern: “MongoDB Lebih Cepat daripada SQL”

Pertanyaan “lebih cepat” tidak bermakna tanpa workload.

MongoDB bisa sangat cepat jika:

1. Data yang dibutuhkan berada dalam satu document.
2. Query memakai index yang tepat.
3. Working set muat di memory.
4. Document tidak terlalu besar.
5. Query shape stabil.
6. Write contention terkendali.

MongoDB bisa lambat jika:

1. Query melakukan collection scan.
2. Banyak `$lookup` mahal.
3. Array besar di-update terus.
4. Index terlalu banyak atau salah.
5. Query ad-hoc tidak terkendali.
6. Document terlalu besar.
7. Shard key buruk.
8. Pagination pakai `skip` besar.

SQL database juga bisa cepat atau lambat tergantung desain.

Jangan memilih MongoDB karena klaim generic performance. Pilih karena model data dan access pattern cocok.

---

## 23. Anti-Pattern: “Nanti Index Belakangan”

Dalam MongoDB, index design hampir selalu bagian dari modelling.

Misalnya Anda punya query:

```text
Find active cases for tenant by team, sorted by dueAt.
```

Kemungkinan index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  "assignment.teamId": 1,
  "sla.dueAt": 1
})
```

Jika field ini belum ada dalam document shape atau namanya berubah-ubah, index sulit efektif.

Maka schema dan index saling terkait:

```text
Access pattern -> document shape -> index -> query implementation -> monitoring
```

Bukan:

```text
Document dulu bebas -> query nanti -> index kalau lambat
```

---

## 24. Mental Model “Top 1%” untuk MongoDB

Engineer MongoDB yang kuat tidak hanya tahu syntax. Mereka bisa menjawab:

1. Apa aggregate boundary-nya?
2. Kenapa field ini di-embed?
3. Kenapa field ini di-reference?
4. Apa query paling penting?
5. Index mana yang mendukung query itu?
6. Apa invariant yang dijaga single-document atomic update?
7. Kapan transaction diperlukan?
8. Apa risiko duplicate field?
9. Berapa besar document ini bisa tumbuh?
10. Apa yang terjadi saat concurrent update?
11. Bagaimana migration dilakukan tanpa downtime?
12. Bagaimana data lama dibaca oleh app baru?
13. Apa slow query yang mungkin muncul?
14. Bagaimana failover mempengaruhi aplikasi Java?
15. Apa read/write concern yang dipakai dan kenapa?
16. Bagaimana backup/restore diuji?
17. Bagaimana retention/legal hold diterapkan?
18. Apakah shard key akan bertahan saat data tumbuh 100x?

Jika Anda bisa menjawab pertanyaan-pertanyaan itu, Anda bukan sekadar pengguna MongoDB. Anda mendesain sistem berbasis document database secara sadar.

---

## 25. Practical Decision Matrix

Gunakan matrix berikut saat memilih storage.

| Karakteristik | PostgreSQL/MySQL | MongoDB | Redis | Kafka/RabbitMQ |
|---|---:|---:|---:|---:|
| Relational integrity kuat | Sangat kuat | Sedang/aplikasi | Lemah | Tidak cocok |
| Nested aggregate storage | Bisa, kurang natural | Sangat kuat | Per key bisa | Tidak cocok |
| Ad-hoc join/query | Sangat kuat | Terbatas/aggregation | Tidak cocok | Tidak cocok |
| Flexible evolving schema | Sedang | Kuat | Kuat tapi sederhana | Event schema perlu disiplin |
| Current operational state | Kuat | Kuat | Biasanya cache/ephemeral | Tidak utama |
| Event log/replay | Bisa, bukan utama | Bisa terbatas, bukan utama | Lemah | Sangat kuat |
| Ultra-low latency cache | Bisa tapi bukan utama | Bisa tapi bukan utama | Sangat kuat | Tidak utama |
| Aggregate read locality | Sedang | Sangat kuat | Kuat per key | Tidak utama |
| Transaction lintas entity | Sangat kuat | Ada, tapi desain hati-hati | Terbatas | Tidak cocok |
| Search nested metadata | Bisa | Kuat jika indexed/search | Terbatas | Tidak cocok |

Matrix ini bukan aturan mutlak. Ini membantu menempatkan teknologi sesuai peran.

---

## 26. MongoDB sebagai Bagian dari Arsitektur, Bukan Seluruh Arsitektur

Dalam sistem besar, MongoDB sering menjadi salah satu komponen.

Contoh arsitektur enforcement platform:

```text
API / Backend Services
        |
        v
MongoDB --------------> Change Stream / Outbox Processor
  |                                  |
  |                                  v
  |                              Kafka Topics
  |
  +----> Redis Cache
  |
  +----> Search Index / Atlas Search / OpenSearch
  |
  +----> Data Warehouse for reporting
```

MongoDB menyimpan operational case state. Kafka menyebarkan business events. Redis mempercepat akses tertentu. Search engine membantu full-text discovery. Warehouse menangani analytics.

Desain matang tidak memaksa satu database menyelesaikan semua jenis workload.

---

## 27. Checklist Awal Sebelum Membuat Collection MongoDB

Sebelum membuat collection production, jawab ini:

### 27.1 Domain & Aggregate

- Apa aggregate root-nya?
- Field mana bagian dari aggregate?
- Field mana snapshot?
- Field mana reference ke aggregate lain?
- Field mana computed/derived?

### 27.2 Growth

- Field/array mana bisa tumbuh tanpa batas?
- Berapa estimasi ukuran document setelah 1 tahun?
- Apakah ada document yang menjadi hot spot?
- Apakah ada retention policy?

### 27.3 Query

- Query apa yang paling sering?
- Query apa yang paling latency-sensitive?
- Query apa yang paling mahal?
- Filter/sort mana yang didukung?
- Apakah ada query ad-hoc yang perlu dibatasi?

### 27.4 Index

- Index apa yang wajib ada sejak awal?
- Apakah compound index mengikuti equality/sort/range pattern?
- Apakah index mengandung `tenantId` untuk multi-tenant?
- Apakah index terlalu banyak?
- Bagaimana rollout/drop index?

### 27.5 Consistency

- Apa invariant utama?
- Apakah invariant berada dalam satu document?
- Apakah perlu transaction?
- Bagaimana optimistic concurrency?
- Bagaimana retry/idempotency?

### 27.6 Evolution

- Apakah document punya schema version?
- Bagaimana app membaca document lama?
- Bagaimana migration/backfill?
- Apakah ada schema validation?
- Bagaimana contract test?

### 27.7 Operations

- Bagaimana backup/restore?
- Bagaimana monitoring slow query?
- Bagaimana alert replication lag?
- Bagaimana handle failover?
- Bagaimana audit/security?

---

## 28. Latihan Mental Model

Coba klasifikasikan data berikut: embed, reference, separate store, atau bukan MongoDB.

### 28.1 User Preferences

```text
User punya language, timezone, UI preferences, notification channels.
```

Kemungkinan: embed dalam user profile document atau collection user preferences.

Alasan: kecil, owned by user, sering dibaca bersama.

### 28.2 Case Audit Events

```text
Setiap case punya ribuan event audit selama lifecycle panjang.
```

Kemungkinan: collection terpisah atau bucket pattern.

Alasan: grows unbounded, perlu pagination, retention/legal hold, query by time.

### 28.3 Product Catalog dengan Atribut Berbeda per Kategori

```text
Laptop, book, insurance product, financial product punya atribut berbeda.
```

Kemungkinan: MongoDB cocok.

Alasan: polymorphic shape, metadata-rich, read-oriented catalog.

### 28.4 Double-Entry Ledger

```text
Debit/credit entries harus selalu balance, financial correctness critical.
```

Kemungkinan: relational database lebih natural.

Alasan: strict transactional invariant dan audit accounting formal.

### 28.5 Search Across Legal Documents

```text
Full-text search, relevance ranking, highlight, faceting.
```

Kemungkinan: MongoDB Atlas Search/OpenSearch/Elasticsearch tergantung requirement. MongoDB bisa menyimpan metadata dan operational state, search index menangani retrieval.

### 28.6 Temporary OTP Code

```text
OTP valid 5 menit, lookup by phone/email.
```

Kemungkinan: Redis lebih natural, MongoDB TTL bisa dipakai jika requirement sederhana dan persistence/audit diperlukan.

---

## 29. Apa yang Tidak Akan Kita Ulang dari Seri Sebelumnya

Agar belajar efisien, seri ini tidak akan mengulang secara panjang:

1. SQL normalization dasar.
2. Transaction theory umum yang sudah dibahas di SQL/PostgreSQL.
3. Index B-tree generic terlalu detail kecuali yang relevan untuk MongoDB query shape.
4. Redis caching pattern secara umum.
5. Kafka event streaming dasar.
6. RabbitMQ queue semantics dasar.
7. HTTP/API dasar.

Yang akan kita lakukan adalah membandingkan secukupnya saat keputusan desain membutuhkan.

---

## 30. Rangkuman Part 000

Document-oriented database ada karena banyak aplikasi tidak selalu cocok dimodelkan sebagai table normalisasi tinggi. Banyak data aplikasi lebih natural sebagai aggregate nested yang dibaca dan dimutasi sebagai satu unit.

MongoDB kuat jika:

1. Data punya aggregate boundary jelas.
2. Access pattern diketahui.
3. Data yang dibaca bersama dapat disimpan bersama.
4. Schema butuh evolusi, bukan chaos.
5. Query bisa di-index.
6. Single-document atomicity cocok dengan invariant utama.
7. Team memahami trade-off duplikasi, consistency, dan migration.

MongoDB buruk jika:

1. Dipakai karena “tidak mau desain schema”.
2. Dipakai seperti relational database tanpa join optimizer.
3. Dipakai untuk highly relational transactional core.
4. Dipakai untuk arbitrary reporting workload.
5. Dipakai tanpa index governance.
6. Dipakai tanpa schema evolution strategy.
7. Dipakai sebagai pengganti Kafka/Redis/warehouse untuk semua hal.

Mental model utama:

```text
MongoDB schema design dimulai dari access pattern dan aggregate boundary,
bukan dari daftar class Java dan bukan dari daftar table relational.
```

Dan prinsip paling penting:

```text
Data that is accessed together should be stored together —
tetapi hanya jika lifecycle, growth, ownership, dan consistency boundary-nya masuk akal.
```

---

## 31. Referensi Resmi untuk Part Ini

Referensi berikut menjadi anchor konseptual untuk part ini dan part-part berikutnya:

1. MongoDB Manual — overview document database, flexible schema, query language, full-text search support:  
   https://www.mongodb.com/docs/manual/
2. MongoDB Data Modeling — flexible data model, polymorphic data, access-pattern-based design:  
   https://www.mongodb.com/docs/manual/data-modeling/
3. MongoDB Best Practices for Data Modeling — schema planning, indexes, working set concerns:  
   https://www.mongodb.com/docs/manual/data-modeling/best-practices/
4. MongoDB Embedded Data — related data in a single document structure:  
   https://www.mongodb.com/docs/manual/data-modeling/embedding/
5. MongoDB Referenced Data — references between documents:  
   https://www.mongodb.com/docs/manual/data-modeling/referencing/
6. MongoDB Indexes — indexes support efficient query execution; without indexes MongoDB scans documents:  
   https://www.mongodb.com/docs/manual/indexes/
7. MongoDB Schema Validation — flexible schema plus validation rules:  
   https://www.mongodb.com/docs/manual/core/schema-validation/
8. MongoDB Atomicity and Transactions — single-document atomicity and distributed transactions:  
   https://www.mongodb.com/docs/manual/core/write-operations-atomicity/
9. MongoDB Transactions — multi-operation/multi-document transaction support:  
   https://www.mongodb.com/docs/manual/core/transactions/
10. MongoDB Aggregation Pipeline — stage-based document processing:  
    https://www.mongodb.com/docs/manual/core/aggregation-pipeline/
11. MongoDB Java Sync Driver — official synchronous Java driver:  
    https://www.mongodb.com/docs/drivers/java/sync/current/
12. MongoDB Java Driver Monitoring — observing driver resource usage and performance:  
    https://www.mongodb.com/docs/drivers/java/sync/current/logging-monitoring/monitoring/

---

## 32. Status Seri

Part ini adalah **Part 000 dari 035**.

Seri **belum selesai**. Bagian berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-001.md
```

Judul berikutnya:

```text
Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape
```

Part berikutnya akan masuk lebih dalam ke konsep aggregate boundary, locality, ownership, lifecycle, dan shape. Di sana kita akan mulai membangun decision framework embed/reference yang lebih tajam dan reusable untuk desain sistem nyata.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-001.md">Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape ➡️</a>
</div>
