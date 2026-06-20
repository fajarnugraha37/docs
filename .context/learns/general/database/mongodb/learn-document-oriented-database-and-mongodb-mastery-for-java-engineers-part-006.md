# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-006.md

# Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Format: satu part = satu markdown  
> Status: Part 006 dari 035  
> Fokus: index sebagai bagian dari desain data, desain API query, dan desain operasional sistem.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun beberapa fondasi:

- document bukan sekadar JSON, tetapi boundary untuk locality, atomicity, ownership, dan evolution;
- query bukan sekadar filter, tetapi bentuk akses terhadap data;
- MongoDB bukan relational database tanpa join, tetapi database yang meminta kita mendesain data berdasarkan access pattern.

Part ini masuk ke topik yang biasanya membedakan penggunaan MongoDB yang matang dan penggunaan MongoDB yang berbahaya: **indexing**.

Banyak engineer baru MongoDB mengira index adalah urusan performa yang bisa ditambahkan nanti setelah aplikasi lambat. Cara berpikir itu berbahaya. Di MongoDB, index lebih dekat ke **bagian dari schema operasional** daripada sekadar tuning tambahan.

Sebuah collection tanpa index yang tepat mungkin tetap benar secara fungsional, tetapi salah secara sistemik. Query-nya bisa:

- membaca terlalu banyak document;
- menyebabkan latency tidak stabil;
- memaksa sort di memory;
- membuat CPU dan disk naik;
- menekan cache;
- memperbesar tail latency;
- merusak kapasitas cluster;
- menimbulkan retry storm di aplikasi Java;
- membuat sistem tampak intermittent, padahal akar masalahnya deterministic.

Part ini belum membahas semua jenis index MongoDB. Itu akan masuk Part 007. Fokus Part 006 adalah fondasi:

1. mental model B-tree;
2. single-field index;
3. compound index;
4. prefix property;
5. Equality-Sort-Range heuristic;
6. sort support;
7. covered query;
8. explain plan;
9. index cardinality;
10. cost index terhadap write path;
11. practical review checklist.

Referensi utama yang menjadi anchor konsep:

- MongoDB Manual — Indexes: <https://www.mongodb.com/docs/manual/indexes/>
- MongoDB Manual — Compound Indexes: <https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/>
- MongoDB Manual — ESR Guideline: <https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/>
- MongoDB Manual — Query Optimization: <https://www.mongodb.com/docs/manual/core/query-optimization/>
- MongoDB Manual — Explain Results: <https://www.mongodb.com/docs/manual/reference/explain-results/>
- MongoDB Manual — Sort Results With Indexes: <https://www.mongodb.com/docs/manual/tutorial/sort-results-with-indexes/>

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. menjelaskan kenapa index bukan sekadar optimisasi tambahan;
2. membaca query MongoDB sebagai access path;
3. membedakan query yang index-friendly dan query yang memaksa collection scan;
4. mendesain compound index berdasarkan equality, sort, dan range;
5. memahami kenapa urutan field dalam compound index sangat penting;
6. membaca `explain()` minimal pada level yang cukup untuk review engineering;
7. mengenali kapan sebuah query tampak benar tetapi operasionalnya buruk;
8. membuat checklist review index untuk collection production;
9. menghubungkan index design dengan desain API, pagination, tenancy, dan state machine;
10. menghindari jebakan “tambahkan index sebanyak mungkin”.

---

## 2. Premis Utama: Query Itu Bukan Hanya Predicate

Dalam SQL, banyak engineer terbiasa berpikir seperti ini:

```sql
SELECT *
FROM cases
WHERE tenant_id = ?
  AND status = ?
  AND created_at >= ?
ORDER BY created_at DESC
LIMIT 20;
```

Lalu berharap query planner database akan “mengurus sisanya”. Pada relational database matang seperti PostgreSQL, planner memang sangat powerful. Namun tetap saja index design sangat penting.

Di MongoDB, terutama untuk application workload yang access pattern-nya relatif bisa diketahui, cara berpikir yang lebih sehat adalah:

> Setiap query production harus punya access path yang bisa dijelaskan.

Artinya, untuk setiap endpoint serius, kita harus bisa menjawab:

- field apa yang dipakai equality filter?
- field apa yang dipakai range filter?
- field apa yang dipakai sorting?
- apakah projection mengambil field besar?
- apakah query butuh pagination?
- apakah query dibatasi tenant?
- apakah index yang ada mengikuti shape query?
- apakah query men-scan jauh lebih banyak document daripada yang dikembalikan?
- apakah sort dilakukan via index atau memory?
- apakah query masih aman jika collection tumbuh 10x, 100x, 1000x?

Query yang sama secara fungsional bisa punya dua profile operasional yang sangat berbeda.

### 2.1 Query Tanpa Access Path Yang Baik

Contoh:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  createdAt: { $gte: ISODate("2026-01-01T00:00:00Z") }
}).sort({ createdAt: -1 }).limit(20)
```

Jika tidak ada index yang cocok, MongoDB bisa harus melakukan collection scan:

```text
COLLSCAN -> SORT -> LIMIT
```

Konsekuensinya:

- semua atau banyak document diperiksa;
- sort bisa mahal;
- latency meningkat mengikuti ukuran collection;
- query kecil bisa menjadi query cluster-wide expensive;
- endpoint terlihat cepat di dev tapi rusak di production.

### 2.2 Query Dengan Access Path Yang Baik

Dengan index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  createdAt: -1
})
```

Query yang sama bisa menjadi:

```text
IXSCAN -> FETCH -> LIMIT
```

MongoDB dapat langsung menuju bagian index untuk tenant tertentu, status tertentu, lalu membaca `createdAt` dalam urutan yang sudah sesuai.

Perbedaan utama bukan hanya “pakai index atau tidak”, tetapi:

- berapa banyak key yang diperiksa;
- berapa banyak document yang di-fetch;
- apakah sort sudah dilayani index;
- apakah range mengganggu penggunaan field berikutnya;
- apakah index terlalu mahal untuk write path.

---

## 3. Index Sebagai Schema Operasional

Di relational database, schema biasanya berarti table, column, type, constraint, foreign key. Di MongoDB, schema formal bisa lebih fleksibel, tetapi workload production tetap butuh struktur yang ketat.

Ada tiga jenis schema yang perlu dibedakan:

| Jenis Schema | Pertanyaan Utama | Contoh |
|---|---|---|
| Document schema | Bentuk document seperti apa yang disimpan? | field, nested object, array, version |
| API/query schema | Bentuk query apa yang diizinkan aplikasi? | filter, sort, pagination |
| Operational schema | Access path apa yang menjamin query stabil? | indexes, shard key, TTL, validation |

Index adalah bagian besar dari operational schema.

Jika API mengizinkan filter bebas di 20 field dan sort bebas di 10 field, tetapi index hanya mendukung 3 query shape utama, maka API contract-mu palsu. Secara sintaks query valid, tetapi secara operasional tidak sustainable.

### 3.1 Rule Yang Perlu Diingat

> Jangan expose query flexibility yang tidak bisa kamu support dengan index dan kapasitas.

Ini sangat relevan untuk Java backend API.

Misalnya endpoint:

```http
GET /cases?status=OPEN&priority=HIGH&assignedTo=u123&from=2026-01-01&sort=createdAt_desc&page=1
```

Endpoint ini bukan hanya controller. Endpoint ini adalah kontrak terhadap database:

- `tenantId` mungkin wajib;
- `status` mungkin equality;
- `priority` mungkin equality;
- `assignedTo` mungkin equality;
- `createdAt` mungkin range sekaligus sort;
- page mungkin pakai seek pagination.

Kalau endpoint berubah, index mungkin ikut berubah. Kalau produk meminta filter baru, itu bukan hanya perubahan DTO. Itu perubahan access pattern.

---

## 4. Mental Model B-Tree

MongoDB indexes secara konseptual menggunakan struktur B-tree/B-tree-like sorted structure untuk banyak index tradisional. Detail internal bisa berubah antar versi, tetapi mental model sorted tree tetap sangat berguna.

Bayangkan index seperti daftar terurut yang menunjuk ke document.

Collection:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "t-001",
  status: "OPEN",
  createdAt: ISODate("2026-05-01T10:00:00Z"),
  title: "Investigate suspicious filing"
}
```

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Secara konseptual, index entries tersusun seperti:

```text
(t-001, CLOSED, 2026-06-01) -> pointer to document A
(t-001, CLOSED, 2026-05-30) -> pointer to document B
(t-001, OPEN,   2026-06-10) -> pointer to document C
(t-001, OPEN,   2026-06-08) -> pointer to document D
(t-002, OPEN,   2026-06-11) -> pointer to document E
...
```

Karena sorted, database bisa melakukan pencarian seperti membuka kamus:

- cari `tenantId = t-001`;
- di dalam tenant itu, cari `status = OPEN`;
- di dalam status itu, baca `createdAt` dari terbaru ke lama;
- berhenti setelah 20 entry.

Tanpa index, database tidak punya kamus. Ia harus membaca document satu per satu.

### 4.1 Index Entry Bukan Document

Index biasanya tidak menyimpan seluruh document. Index menyimpan key terurut dan pointer/reference ke document.

Konsekuensinya:

1. mencari key di index bisa cepat;
2. tetapi mengambil field yang tidak ada di index tetap perlu fetch document;
3. fetch document bisa mahal jika banyak;
4. query yang hanya butuh field di index bisa menjadi covered query.

### 4.2 Sortedness Adalah Kekuatan Utama Index

Index bukan hanya untuk lookup equality. Index juga berguna karena urutan datanya sudah tertata.

Itulah kenapa index bisa membantu:

- equality search;
- range search;
- prefix scan;
- sorting;
- pagination;
- min/max-like access;
- top-N query.

Namun sortedness hanya berguna jika query mengikuti urutan index.

---

## 5. Collection Scan vs Index Scan

Ada dua konsep dasar yang harus selalu kamu lihat di explain plan:

```text
COLLSCAN
IXSCAN
```

### 5.1 COLLSCAN

`COLLSCAN` berarti MongoDB memindai collection secara langsung.

Ini tidak selalu buruk untuk collection kecil atau query admin yang jarang. Tetapi untuk endpoint production dengan collection besar, `COLLSCAN` biasanya red flag.

Contoh:

```javascript
db.cases.find({ status: "OPEN" })
```

Jika tidak ada index pada `status`, MongoDB harus memeriksa banyak atau semua document.

Masalahnya bukan hanya latency satu query. Masalahnya adalah efek sistemik:

- cache pressure;
- CPU tinggi;
- disk read tinggi;
- query lain ikut lambat;
- autoscaling aplikasi tidak menyelesaikan akar masalah;
- retry dari Java client bisa memperburuk beban.

### 5.2 IXSCAN

`IXSCAN` berarti MongoDB menggunakan index scan.

Namun `IXSCAN` tidak otomatis berarti query sudah baik. Query bisa menggunakan index tetapi tetap buruk jika:

- keys examined terlalu banyak;
- docs examined terlalu banyak;
- index tidak selective;
- sort masih dilakukan di memory;
- index hanya membantu sedikit;
- query memakai range terlalu awal;
- index tidak match dengan query shape utama.

Jadi review index bukan hanya mencari `IXSCAN`. Review yang lebih matang bertanya:

```text
nReturned berapa?
totalKeysExamined berapa?
totalDocsExamined berapa?
apakah ada SORT stage?
apakah FETCH terlalu besar?
apakah query stable saat data tumbuh?
```

---

## 6. Single-Field Index

Single-field index adalah index pada satu field.

Contoh:

```javascript
db.cases.createIndex({ status: 1 })
```

Query yang bisa terbantu:

```javascript
db.cases.find({ status: "OPEN" })
```

Atau:

```javascript
db.cases.find({ status: { $in: ["OPEN", "ESCALATED"] } })
```

Atau sort:

```javascript
db.cases.find({}).sort({ status: 1 })
```

### 6.1 Kapan Single-Field Index Cukup?

Single-field index cukup jika:

- query benar-benar hanya berdasarkan field itu;
- field punya selectivity bagus;
- query tidak butuh sort tambahan;
- collection relatif kecil;
- workload belum kompleks;
- field tersebut dipakai di banyak query berbeda sebagai filter awal.

Contoh field yang kadang layak single-field index:

```text
caseId
externalReference
email
username
tokenHash
correlationId
```

Field-field ini sering dipakai untuk lookup spesifik.

### 6.2 Kapan Single-Field Index Tidak Cukup?

Single-field index sering tidak cukup untuk query aplikasi nyata.

Contoh:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1 }).limit(20)
```

Index hanya pada `status`:

```javascript
db.cases.createIndex({ status: 1 })
```

bisa membantu menemukan semua `OPEN`, tetapi database masih harus:

- memfilter tenant;
- sort by `createdAt`;
- mungkin membaca banyak document;
- mungkin tidak efisien di multi-tenant system.

Query seperti ini biasanya butuh compound index.

---

## 7. Compound Index

Compound index adalah index yang berisi lebih dari satu field.

Contoh:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  createdAt: -1
})
```

MongoDB documentation menyatakan urutan field dalam compound index penting, dan compound index dapat digunakan untuk query pada field pertama atau prefix field dari index. Compound index juga mengikuti guideline ESR untuk membuat index efisien.

### 7.1 Cara Membaca Compound Index

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Jangan dibaca sebagai “ada index di tenantId, status, dan createdAt”.

Baca sebagai:

```text
Data index disortir pertama berdasarkan tenantId,
lalu di dalam tenantId berdasarkan status,
lalu di dalam status berdasarkan createdAt descending.
```

Urutan ini menentukan query apa yang efisien.

### 7.2 Analogi Kamus Telepon

Bayangkan buku telepon diurutkan berdasarkan:

```text
country -> city -> lastName -> firstName
```

Kamu bisa mencari:

- semua orang di country tertentu;
- semua orang di country + city tertentu;
- semua orang di country + city + lastName tertentu.

Tapi buku itu tidak efisien untuk mencari semua orang dengan `firstName = "Ari"` di seluruh dunia, karena `firstName` bukan urutan awal.

Compound index bekerja mirip.

---

## 8. Prefix Property

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Punya prefix:

```javascript
{ tenantId: 1 }
{ tenantId: 1, status: 1 }
{ tenantId: 1, status: 1, createdAt: -1 }
```

Query yang cocok dengan prefix:

```javascript
db.cases.find({ tenantId: "t-001" })
```

```javascript
db.cases.find({ tenantId: "t-001", status: "OPEN" })
```

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  createdAt: { $gte: ISODate("2026-01-01") }
})
```

Query yang tidak cocok secara ideal:

```javascript
db.cases.find({ status: "OPEN" })
```

Karena `tenantId` sebagai leading field tidak diberikan.

### 8.1 Kenapa Prefix Penting?

Karena index diurutkan dari kiri ke kanan.

Untuk menggunakan bagian tengah index secara efisien, database perlu tahu bagian sebelumnya.

Jika index adalah:

```text
tenantId -> status -> createdAt
```

maka semua status `OPEN` tersebar di banyak tenant. Tanpa `tenantId`, database tidak bisa langsung melompat ke satu range kecil yang contiguous.

### 8.2 Prefix dan Redundant Index

Jika kamu punya compound index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Maka index ini bisa melayani sebagian query dengan prefix `tenantId` dan `tenantId + status`.

Karena itu index berikut mungkin redundant:

```javascript
{ tenantId: 1 }
```

Tetapi tidak selalu. Kadang index pendek tetap berguna karena:

- lebih kecil;
- lebih murah di memory;
- lebih cepat untuk query yang hanya butuh field itu;
- bisa menjadi covered query tertentu;
- compound index terlalu besar untuk workload umum.

Jadi rule-nya bukan “hapus semua prefix index”, tetapi:

> Evaluasi apakah index prefix pendek masih punya workload signifikan dan cost-benefit positif.

---

## 9. Equality, Sort, Range — ESR Guideline

MongoDB documentation memiliki guideline terkenal untuk compound index: **ESR**.

ESR berarti:

```text
Equality -> Sort -> Range
```

Artinya, saat mendesain compound index untuk query umum:

1. field equality diletakkan lebih dulu;
2. field sort diletakkan setelah equality;
3. field range diletakkan setelah sort.

Contoh query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  createdAt: { $gte: ISODate("2026-01-01") }
}).sort({ priority: -1 }).limit(20)
```

Kemungkinan index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  priority: -1,
  createdAt: 1
})
```

Interpretasi:

- `tenantId` equality;
- `status` equality;
- `priority` sort;
- `createdAt` range.

### 9.1 Equality

Equality adalah filter exact match:

```javascript
{ tenantId: "t-001" }
{ status: "OPEN" }
{ assignedTo: "u-123" }
```

Equality field bagus diletakkan di depan karena mempersempit ruang pencarian.

Jika query selalu punya tenant:

```javascript
{ tenantId: "t-001", status: "OPEN" }
```

maka `tenantId` hampir selalu menjadi leading field untuk multi-tenant collection.

Namun urutan equality fields kadang tidak sesederhana “paling selective dulu”. MongoDB ESR guideline mengatakan exact-match fields harus lebih dulu, dan di antara equality fields, urutan tidak selalu harus berdasarkan selectivity dalam cara yang sama dengan range/sort. Tetapi secara desain API, kamu tetap harus memikirkan:

- field mana selalu ada;
- field mana opsional;
- field mana cocok untuk prefix query lain;
- field mana mendukung tenant isolation;
- field mana mendukung sort setelahnya.

### 9.2 Sort

Sort field sebaiknya muncul setelah equality fields agar database dapat membaca hasil dalam urutan yang sudah benar.

Contoh:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1 }).limit(20)
```

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Ini ideal karena setelah `tenantId` dan `status` dikunci, `createdAt` sudah tersusun descending.

### 9.3 Range

Range adalah filter seperti:

```javascript
{ createdAt: { $gte: start, $lt: end } }
{ amount: { $gt: 1000 } }
{ score: { $lte: 70 } }
```

Range biasanya diletakkan setelah equality dan sort karena range bisa “membuka” scan interval. Setelah field range dipakai, kemampuan index untuk memanfaatkan field setelahnya secara efisien sering berkurang.

Contoh buruk:

```javascript
{ tenantId: 1, createdAt: -1, status: 1 }
```

Untuk query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  createdAt: { $gte: start }
}).sort({ createdAt: -1 })
```

Karena `createdAt` range/sort muncul sebelum `status`, database mungkin harus membaca banyak record dalam date range lalu memfilter status.

Index yang lebih umum baik:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

### 9.4 ESR Bukan Hukum Mutlak

ESR adalah guideline, bukan hukum absolut.

Kadang range perlu sebelum sort jika range sangat selective dan sort kecil. MongoDB documentation juga membahas variasi ERS jika range predicate sangat selective sehingga lebih baik mengurangi jumlah document lebih dulu sebelum sort.

Contoh:

```javascript
db.payments.find({
  tenantId: "t-001",
  amount: { $gte: 100000000 },
  status: "SETTLED"
}).sort({ createdAt: -1 }).limit(20)
```

Jika `amount >= 100000000` sangat jarang, index dengan range lebih awal bisa masuk akal:

```javascript
{ tenantId: 1, status: 1, amount: 1, createdAt: -1 }
```

Namun ini harus dibuktikan dengan:

- distribution data nyata;
- explain plan;
- workload frequency;
- latency target;
- write cost;
- production-like testing.

Rule senior-nya:

> ESR adalah default yang baik. Deviate hanya jika kamu punya alasan data-distribution dan hasil explain yang mendukung.

---

## 10. Compound Index Design Step-by-Step

Mari kita desain index dari access pattern.

### 10.1 Access Pattern

Endpoint:

```http
GET /tenants/{tenantId}/cases?status=OPEN&assignedTo=u-123&sort=createdAt_desc&limit=20
```

MongoDB query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  assignedTo: "u-123"
}).sort({ createdAt: -1 }).limit(20)
```

### 10.2 Identify Equality Fields

Equality:

```text
tenantId
status
assignedTo
```

### 10.3 Identify Sort Fields

Sort:

```text
createdAt desc
```

### 10.4 Identify Range Fields

Tidak ada range eksplisit di query ini.

### 10.5 Candidate Index

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  assignedTo: 1,
  createdAt: -1
})
```

### 10.6 Validate Prefix Use Cases

Apakah query lain butuh:

```javascript
{ tenantId, status }
```

Jika ya, index ini juga bisa membantu prefix.

Apakah query lain butuh:

```javascript
{ tenantId, assignedTo }
```

Index di atas kurang ideal karena `status` berada di antara `tenantId` dan `assignedTo`. Query `{ tenantId, assignedTo }` tidak menggunakan prefix penuh sampai `assignedTo` karena `status` dilewati.

Mungkin perlu index lain:

```javascript
{ tenantId: 1, assignedTo: 1, createdAt: -1 }
```

Atau API dipaksa selalu filter status untuk assigned workload.

Ini menunjukkan bahwa index design tidak bisa dipisahkan dari API design.

---

## 11. Sort Support Dalam Compound Index

Sort adalah salah satu sumber hidden cost paling umum.

Query:

```javascript
db.cases.find({ tenantId: "t-001" })
  .sort({ createdAt: -1 })
  .limit(20)
```

Index:

```javascript
{ tenantId: 1, createdAt: -1 }
```

Bagus.

Namun query:

```javascript
db.cases.find({ tenantId: "t-001" })
  .sort({ status: 1, createdAt: -1 })
  .limit(20)
```

butuh index yang sort order-nya mendukung:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

### 11.1 Sort Field Harus Sesuai Urutan Index

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Bisa mendukung sort setelah `tenantId` equality:

```javascript
.sort({ status: 1, createdAt: -1 })
```

Tetapi tidak sama dengan:

```javascript
.sort({ createdAt: -1, status: 1 })
```

Sort order field harus mengikuti urutan index.

### 11.2 Reverse Sort

Compound index dapat mendukung sort dalam arah index atau arah reverse penuh.

Index:

```javascript
{ status: 1, createdAt: -1 }
```

Dapat mendukung:

```javascript
.sort({ status: 1, createdAt: -1 })
```

Dan reverse penuh:

```javascript
.sort({ status: -1, createdAt: 1 })
```

Tetapi bukan arbitrary mix yang tidak cocok.

### 11.3 Equality Sebelum Sort

Jika field sebelum sort sudah equality, sort masih bisa didukung.

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1 })
```

Meskipun sort hanya pada `createdAt`, ini valid karena `tenantId` dan `status` sudah fixed.

---

## 12. Range Query dan Dampaknya Terhadap Field Setelahnya

Range query sering membuat engineer salah desain compound index.

Contoh:

```javascript
db.cases.find({
  tenantId: "t-001",
  createdAt: { $gte: start, $lt: end },
  status: "OPEN"
})
```

Index A:

```javascript
{ tenantId: 1, createdAt: -1, status: 1 }
```

Index B:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Mana yang lebih baik?

Jawaban tergantung access pattern, tetapi untuk query yang selalu memfilter status dan date range, Index B sering lebih sehat:

```text
tenantId equality -> status equality -> createdAt range
```

Dengan Index A:

```text
tenantId equality -> createdAt range -> status filter
```

Database mungkin harus membaca semua case tenant dalam range tanggal, lalu memfilter status. Jika date range besar dan status selective, ini buruk.

### 12.1 Range Mengurangi Kekuatan Field Setelahnya

Secara mental model, begitu kamu membuka range pada field kedua, field ketiga tidak lagi berada dalam satu posisi yang sempit. Data yang memenuhi range bisa tersebar menurut field setelahnya.

Karena itu range biasanya di akhir index untuk query shape umum.

### 12.2 Range + Sort Pada Field Yang Sama

Query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  createdAt: { $lt: cursorCreatedAt }
}).sort({ createdAt: -1 }).limit(20)
```

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Ini sangat cocok untuk seek pagination:

- equality mempersempit tenant dan status;
- `createdAt` dipakai untuk range cursor;
- index juga sudah tersortir sesuai kebutuhan;
- limit 20 membuat scan berhenti cepat.

---

## 13. Covered Query

Covered query terjadi ketika MongoDB bisa menjawab query hanya dari index tanpa fetch document penuh.

Contoh index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  createdAt: -1,
  title: 1
})
```

Query:

```javascript
db.cases.find(
  { tenantId: "t-001", status: "OPEN" },
  { _id: 0, title: 1, status: 1, createdAt: 1 }
).sort({ createdAt: -1 }).limit(20)
```

Jika semua field yang dibutuhkan ada di index, MongoDB tidak perlu fetch document.

### 13.1 Kenapa Covered Query Penting?

Fetch document bisa mahal karena:

- document besar;
- field yang dibutuhkan hanya sedikit;
- working set document tidak resident di memory;
- pointer lookup acak lebih mahal daripada index-only scan.

Untuk list endpoint, covered query kadang sangat powerful.

Contoh list API:

```json
{
  "caseId": "C-2026-0001",
  "title": "Suspicious filing",
  "status": "OPEN",
  "priority": "HIGH",
  "createdAt": "2026-06-01T10:00:00Z"
}
```

Index bisa memasukkan field summary:

```javascript
{
  tenantId: 1,
  status: 1,
  createdAt: -1,
  caseId: 1,
  title: 1,
  priority: 1
}
```

Tapi hati-hati. Index besar punya cost.

### 13.2 Covered Query Trade-Off

Covered query mengurangi read cost tetapi menaikkan:

- index size;
- memory footprint;
- write amplification;
- index maintenance cost;
- storage cost.

Jangan masukkan field besar ke index hanya demi covered query. Index dengan string panjang, array besar, atau field low-value bisa memperburuk sistem.

Rule praktis:

> Covered query cocok untuk high-frequency list/read endpoint dengan projection kecil dan stable.

---

## 14. Selectivity dan Cardinality

Index paling berguna jika mampu mengurangi jumlah candidate document secara signifikan.

### 14.1 Cardinality

Cardinality adalah jumlah distinct value pada field.

High cardinality:

```text
email
userId
caseId
transactionId
externalReference
```

Low cardinality:

```text
status: OPEN/CLOSED
isDeleted: true/false
priority: LOW/MEDIUM/HIGH
countryCode jika hanya beberapa negara
```

Index pada high-cardinality field biasanya lebih selective.

Index pada low-cardinality field kadang kurang membantu jika digunakan sendiri.

### 14.2 Index Low-Cardinality Tidak Selalu Buruk

Field `status` low-cardinality. Apakah berarti tidak boleh diindex?

Tidak begitu.

Index `{ status: 1 }` sendiri mungkin kurang berguna jika 80% document `OPEN`.

Tetapi compound index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

bisa sangat berguna karena status menjadi bagian dari shape yang lebih selective.

### 14.3 Selectivity Dalam Multi-Tenant System

`tenantId` bisa high-cardinality secara global, tetapi untuk tenant besar, query tetap bisa besar.

Contoh:

```text
10.000 tenant
1 tenant enterprise punya 70% data
9.999 tenant kecil punya 30% data
```

Index `{ tenantId: 1 }` bagus untuk tenant kecil, tetapi query tenant enterprise masih bisa scan besar.

Karena itu multi-tenant index sering butuh field tambahan:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
{ tenantId: 1, assignedTo: 1, dueAt: 1 }
{ tenantId: 1, caseNumber: 1 }
```

---

## 15. Index Intersection

MongoDB dapat menggunakan index intersection dalam beberapa kondisi, yaitu menggabungkan beberapa index untuk satu query.

Misal ada index:

```javascript
{ status: 1 }
{ assignedTo: 1 }
```

Query:

```javascript
{ status: "OPEN", assignedTo: "u-123" }
```

Secara konsep, database bisa memakai dua index lalu menggabungkan hasil.

Namun sebagai desain utama, jangan terlalu bergantung pada index intersection untuk high-throughput query utama.

Compound index yang sesuai query shape biasanya lebih predictable:

```javascript
{ assignedTo: 1, status: 1, createdAt: -1 }
```

atau untuk multi-tenant:

```javascript
{ tenantId: 1, assignedTo: 1, status: 1, createdAt: -1 }
```

### 15.1 Kenapa Jangan Bergantung Pada Intersection?

Karena:

- planner bisa memilih plan berbeda tergantung statistik;
- intersection bisa membaca banyak key dari dua index;
- hasil intersection masih mungkin butuh fetch dan sort;
- latency bisa kurang stabil;
- compound index lebih jelas untuk query kritikal.

Rule praktis:

> Untuk query utama production, desain compound index eksplisit. Anggap index intersection sebagai bonus, bukan fondasi.

---

## 16. Explain Plan: Tujuan dan Cara Membaca

`explain()` adalah alat untuk melihat bagaimana MongoDB mengeksekusi query.

Contoh:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1 }).limit(20).explain("executionStats")
```

Kamu tidak perlu memahami seluruh detail internal sejak awal. Tetapi kamu harus bisa membaca sinyal utama.

### 16.1 Verbosity Level

Umumnya ada tiga level:

```text
queryPlanner
executionStats
allPlansExecution
```

#### `queryPlanner`

Menunjukkan plan yang dipilih tanpa menjalankan query sampai selesai untuk statistik runtime lengkap.

Berguna untuk:

- index apa yang dipilih;
- winning plan;
- rejected plans;
- stage tree.

#### `executionStats`

Menjalankan query dan memberi statistik eksekusi.

Berguna untuk:

- berapa document dikembalikan;
- berapa key diperiksa;
- berapa document diperiksa;
- waktu eksekusi;
- apakah ada scan berlebihan.

#### `allPlansExecution`

Memberi detail lebih banyak tentang plan candidate.

Berguna untuk tuning advanced, tetapi biasanya tidak perlu untuk review harian.

---

## 17. Explain Field Yang Wajib Kamu Pahami

Output explain bisa panjang. Fokus awal pada field/stage berikut.

### 17.1 `winningPlan`

Plan yang dipilih query planner.

Cari stage seperti:

```text
COLLSCAN
IXSCAN
FETCH
SORT
LIMIT
PROJECTION_COVERED
```

### 17.2 `COLLSCAN`

Red flag untuk query production besar.

Bukan selalu salah, tetapi harus bisa dijustifikasi.

### 17.3 `IXSCAN`

Index scan. Lihat index name/key pattern yang dipakai.

Pastikan index yang dipakai memang index yang kamu harapkan.

### 17.4 `FETCH`

Menandakan MongoDB mengambil document setelah membaca index.

`FETCH` normal jika projection membutuhkan field yang tidak ada di index.

Namun jika `docsExamined` tinggi dan `nReturned` rendah, ada masalah selectivity atau index shape.

### 17.5 `SORT`

Jika ada `SORT` stage, berarti sort tidak sepenuhnya dilayani oleh index.

Untuk result kecil mungkin aman. Untuk query besar, ini red flag.

### 17.6 `nReturned`

Jumlah document yang dikembalikan.

### 17.7 `totalKeysExamined`

Jumlah index keys yang diperiksa.

### 17.8 `totalDocsExamined`

Jumlah document yang diperiksa/fetch.

### 17.9 Rasio Penting

Untuk query list yang baik, idealnya:

```text
totalKeysExamined mendekati nReturned
totalDocsExamined mendekati nReturned
```

Tidak harus selalu sama, tetapi jika:

```text
nReturned = 20
totalKeysExamined = 500000
totalDocsExamined = 500000
```

maka query sangat tidak efisien meskipun memakai index.

---

## 18. Contoh Explain Reasoning

### 18.1 Query

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1 }).limit(20)
```

### 18.2 Index Yang Ada

```javascript
db.cases.createIndex({ tenantId: 1 })
```

### 18.3 Kemungkinan Plan

```text
IXSCAN { tenantId: 1 }
FETCH filter status
SORT createdAt desc
LIMIT 20
```

Ini lebih baik daripada full collection scan, tetapi masih buruk jika tenant punya banyak cases.

Masalah:

- status tidak ada di index;
- createdAt sort tidak ada di index;
- banyak document tenant harus di-fetch;
- sort bisa mahal.

### 18.4 Index Yang Lebih Baik

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  createdAt: -1
})
```

### 18.5 Kemungkinan Plan Baru

```text
IXSCAN { tenantId: 1, status: 1, createdAt: -1 }
FETCH
LIMIT 20
```

Jika projection kecil dan semua field ada di index, bisa menjadi index-only/covered.

---

## 19. Case Study: Regulatory Case Search

Kita gunakan domain regulatory case management karena relevan dengan sistem enforcement lifecycle.

### 19.1 Document Contoh

```javascript
{
  _id: ObjectId("..."),
  tenantId: "regulator-id",
  caseNumber: "CASE-2026-000123",
  status: "UNDER_REVIEW",
  priority: "HIGH",
  assignedTeamId: "team-enforcement-1",
  assignedTo: "user-789",
  subject: {
    type: "ORGANIZATION",
    name: "Acme Capital Ltd",
    registrationNumber: "REG-001"
  },
  createdAt: ISODate("2026-06-01T08:00:00Z"),
  updatedAt: ISODate("2026-06-15T10:20:00Z"),
  dueAt: ISODate("2026-07-01T00:00:00Z"),
  escalationLevel: 2,
  tags: ["aml", "late-filing"]
}
```

### 19.2 Access Pattern A: Open Cases For Reviewer

API:

```http
GET /my-cases?status=UNDER_REVIEW&sort=dueAt_asc
```

Query:

```javascript
db.cases.find({
  tenantId: "regulator-id",
  assignedTo: "user-789",
  status: "UNDER_REVIEW"
}).sort({ dueAt: 1 }).limit(50)
```

Index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  assignedTo: 1,
  status: 1,
  dueAt: 1
})
```

Reasoning:

- tenant isolation wajib;
- assignedTo equality;
- status equality;
- dueAt sort;
- limit kecil.

### 19.3 Access Pattern B: Case Lookup By Case Number

Query:

```javascript
db.cases.findOne({
  tenantId: "regulator-id",
  caseNumber: "CASE-2026-000123"
})
```

Index:

```javascript
db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true }
)
```

Reasoning:

- caseNumber mungkin unik per tenant;
- lookup harus exact;
- unique index menegakkan invariant teknis.

### 19.4 Access Pattern C: Dashboard By Status

Query:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "regulator-id" } },
  { $group: { _id: "$status", count: { $sum: 1 } } }
])
```

Index:

```javascript
{ tenantId: 1, status: 1 }
```

Namun pertanyaan senior:

> Apakah dashboard ini harus real-time dari collection utama, atau lebih baik computed summary/projection?

Jika dashboard sangat sering dibuka dan data besar, aggregation live bisa mahal. Index membantu, tetapi bukan solusi untuk semua dashboard.

### 19.5 Access Pattern D: Search Cases By Subject Name

Query naive:

```javascript
db.cases.find({
  tenantId: "regulator-id",
  "subject.name": /capital/i
})
```

Ini berbahaya jika regex tidak anchored atau case-insensitive tanpa index support yang tepat.

Kemungkinan solusi:

- normalized search field;
- Atlas Search;
- external search engine;
- prefix-only query dengan index;
- explicit search projection collection.

Index sederhana:

```javascript
{ tenantId: 1, "subject.normalizedName": 1 }
```

hanya cocok untuk exact/prefix search tertentu, bukan arbitrary contains search.

---

## 20. Index dan Pagination

Pagination adalah area yang sering merusak index design.

### 20.1 Skip Pagination

Query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1 }).skip(100000).limit(20)
```

Masalah:

- database tetap harus melewati banyak entry;
- makin dalam page, makin mahal;
- latency memburuk secara linear;
- hasil bisa tidak stabil jika data berubah.

### 20.2 Seek Pagination

Gunakan cursor berdasarkan sort key.

Query page pertama:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1, _id: -1 }).limit(20)
```

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1, _id: -1 }
```

Query page berikutnya:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  $or: [
    { createdAt: { $lt: lastCreatedAt } },
    { createdAt: lastCreatedAt, _id: { $lt: lastId } }
  ]
}).sort({ createdAt: -1, _id: -1 }).limit(20)
```

Kenapa `_id` ditambahkan?

Karena `createdAt` bisa sama untuk banyak document. `_id` menjadi tie-breaker untuk stable ordering.

### 20.3 Pagination Contract

API yang baik tidak berkata:

```http
GET /cases?page=5000&pageSize=20
```

Untuk large collection, lebih baik:

```http
GET /cases?limit=20&cursor=eyJjcmVhdGVkQXQiOiIyMDI2..."
```

Index design dan API design harus sinkron.

---

## 21. Index Direction: `1` vs `-1`

Single-field index direction sering tidak terlalu penting karena MongoDB bisa scan index forward atau backward.

Index:

```javascript
{ createdAt: 1 }
```

bisa mendukung sort ascending dan descending pada satu field.

Namun pada compound index dengan multi-field sort, direction penting.

Index:

```javascript
{ priority: 1, createdAt: -1 }
```

mendukung:

```javascript
.sort({ priority: 1, createdAt: -1 })
```

Dan reverse penuh:

```javascript
.sort({ priority: -1, createdAt: 1 })
```

Tapi tidak mendukung secara ideal:

```javascript
.sort({ priority: 1, createdAt: 1 })
```

Jadi saat API menawarkan sort multi-field, kamu harus tahu kombinasi mana yang benar-benar didukung.

---

## 22. Index Untuk Nested Field

MongoDB bisa membuat index pada nested field menggunakan dot notation.

Document:

```javascript
{
  subject: {
    type: "ORGANIZATION",
    registrationNumber: "REG-001",
    name: "Acme Capital Ltd"
  }
}
```

Index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  "subject.registrationNumber": 1
})
```

Query:

```javascript
db.cases.find({
  tenantId: "regulator-id",
  "subject.registrationNumber": "REG-001"
})
```

Ini bisa efisien.

### 22.1 Nested Field Bukan Masalah

Dalam MongoDB, nested field bukan otomatis buruk. Yang penting:

- field path stabil;
- tipe field konsisten;
- query shape jelas;
- index path cocok;
- document schema tidak terlalu bebas.

### 22.2 Missing Field

Jika sebagian document tidak punya nested field, query dan index behavior harus dipahami. Ini akan lebih dalam dibahas di Part 007 saat masuk sparse dan partial index.

---

## 23. Index Pada Array: Pengantar Multikey

Jika kamu membuat index pada field array, MongoDB membuat multikey index. Detail mendalam akan dibahas Part 007, tetapi fondasi perlu disebut di sini.

Document:

```javascript
{
  tags: ["aml", "late-filing", "high-risk"]
}
```

Index:

```javascript
{ tenantId: 1, tags: 1 }
```

Query:

```javascript
{ tenantId: "regulator-id", tags: "aml" }
```

Index ini bisa membantu.

Namun array index punya kompleksitas:

- satu document menghasilkan banyak index entries;
- compound multikey punya limitation;
- array besar memperbesar index;
- update array bisa mahal;
- query `$elemMatch` perlu dipahami.

Rule awal:

> Index array hanya jika access pattern-nya jelas dan array growth terkontrol.

---

## 24. Cost Index Terhadap Write Path

Index mempercepat read tertentu, tetapi memperlambat write.

Setiap insert harus:

- menulis document;
- menulis entry untuk setiap index;
- menjaga struktur index tetap sorted;
- melakukan journaling/replication sesuai configuration.

Setiap update pada indexed field harus:

- menghapus/mengubah index entry lama;
- menulis index entry baru;
- mungkin menyebabkan lebih banyak page/cache churn.

### 24.1 Write Amplification

Jika collection punya 12 index, satu insert bisa berarti 1 document write + 12 index writes secara konseptual.

Tidak semua cost sama, tetapi prinsipnya jelas:

> Setiap index adalah pajak pada write path.

### 24.2 Index Terlalu Banyak

Gejala:

- insert latency naik;
- update latency naik;
- disk usage membesar;
- cache hit ratio turun;
- index build/migration makin sulit;
- write-heavy workload tidak stabil.

### 24.3 Index Terlalu Sedikit

Gejala:

- collection scan;
- slow query;
- CPU tinggi;
- disk read tinggi;
- memory pressure;
- endpoint latency buruk;
- timeout di Java service.

### 24.4 Balance

Index design adalah trade-off:

```text
read latency vs write latency
query flexibility vs operational predictability
covered query vs index size
API convenience vs storage cost
```

Senior engineer tidak bertanya “berapa banyak index yang bagus”, tetapi:

> Index mana yang membayar biayanya dengan workload nyata?

---

## 25. Index Size dan Working Set

Index harus disimpan di storage, tetapi performa terbaik terjadi saat working set index sering berada di memory/cache.

Jika index terlalu besar:

- cache tidak cukup;
- disk I/O naik;
- query latency lebih tidak stabil;
- cluster perlu memory lebih besar;
- cost meningkat.

### 25.1 Field Yang Membuat Index Besar

Hati-hati dengan:

- string panjang;
- array;
- nested field yang besar cardinality-nya;
- field yang sering berubah;
- field yang tidak dipakai query utama;
- field hanya demi covered query minor.

### 25.2 Projection vs Covered Index

Kadang lebih baik mengambil sedikit document via index selective lalu fetch document, daripada membuat index besar yang men-cover semua field.

Contoh:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

lalu fetch 20 document untuk list page mungkin cukup murah.

Tidak perlu selalu:

```javascript
{ tenantId: 1, status: 1, createdAt: -1, title: 1, summary: 1, ownerName: 1, ... }
```

---

## 26. Index dan Java Service Design

Untuk Java backend, index design harus terlihat di beberapa lapisan.

### 26.1 Controller/API Layer

API harus membatasi filter dan sort.

Buruk:

```java
@GetMapping("/cases")
public Page<CaseDto> search(@RequestParam Map<String, String> params) { ... }
```

Jika semua param diterjemahkan bebas ke MongoDB query, kamu membuat query engine liar.

Lebih baik:

```java
public record CaseSearchRequest(
    CaseStatus status,
    String assignedTo,
    Instant createdBefore,
    String cursor,
    int limit,
    CaseSort sort
) {}
```

Dengan enum sort terbatas:

```java
public enum CaseSort {
    CREATED_AT_DESC,
    DUE_AT_ASC,
    PRIORITY_DESC_CREATED_AT_DESC
}
```

Setiap sort enum harus punya index support yang jelas.

### 26.2 Repository Layer

Repository method sebaiknya mencerminkan query shape.

Buruk:

```java
List<CaseDocument> findCases(Map<String, Object> filters, Sort sort);
```

Lebih baik:

```java
List<CaseSummary> findOpenCasesAssignedTo(
    TenantId tenantId,
    UserId assignedTo,
    CaseCursor cursor,
    int limit
);
```

Kenapa?

Karena method kedua punya access pattern yang jelas dan bisa di-review terhadap index.

### 26.3 Index Contract Test

Di sistem serius, kamu bisa membuat test yang memverifikasi index ada.

Pseudo:

```java
@Test
void casesCollectionMustHaveExpectedIndexes() {
    List<IndexInfo> indexes = mongoTemplate.indexOps("cases").getIndexInfo();

    assertThat(indexes).anyMatch(index ->
        index.getIndexFields().equals(List.of(
            field("tenantId", ASC),
            field("assignedTo", ASC),
            field("status", ASC),
            field("dueAt", ASC)
        ))
    );
}
```

Test ini bukan pengganti explain test, tetapi membantu menjaga operational schema.

---

## 27. Designing Indexes From API: Worked Example

### 27.1 Requirements

Regulatory case platform punya endpoints:

1. lookup case by case number;
2. list my open cases by due date;
3. list team escalated cases by priority;
4. list recently updated cases;
5. search by subject registration number;
6. list archived cases by close date range.

### 27.2 Query Shapes

#### Lookup Case

```javascript
{ tenantId, caseNumber }
```

Index:

```javascript
{ tenantId: 1, caseNumber: 1 }
```

Unique.

#### My Open Cases

```javascript
{ tenantId, assignedTo, status }
sort { dueAt: 1 }
```

Index:

```javascript
{ tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 }
```

#### Team Escalated Cases

```javascript
{ tenantId, assignedTeamId, escalationLevel, status }
sort { priorityRank: -1, createdAt: 1 }
```

Index:

```javascript
{
  tenantId: 1,
  assignedTeamId: 1,
  escalationLevel: 1,
  status: 1,
  priorityRank: -1,
  createdAt: 1
}
```

#### Recently Updated Cases

```javascript
{ tenantId }
sort { updatedAt: -1 }
```

Index:

```javascript
{ tenantId: 1, updatedAt: -1 }
```

#### Subject Registration Lookup

```javascript
{ tenantId, "subject.registrationNumber" }
```

Index:

```javascript
{ tenantId: 1, "subject.registrationNumber": 1 }
```

#### Archived By Close Date Range

```javascript
{ tenantId, status: "ARCHIVED", closedAt: { $gte, $lt } }
sort { closedAt: -1 }
```

Index:

```javascript
{ tenantId: 1, status: 1, closedAt: -1 }
```

### 27.3 Review

Index list:

```javascript
db.cases.createIndex({ tenantId: 1, caseNumber: 1 }, { unique: true })
db.cases.createIndex({ tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 })
db.cases.createIndex({ tenantId: 1, assignedTeamId: 1, escalationLevel: 1, status: 1, priorityRank: -1, createdAt: 1 })
db.cases.createIndex({ tenantId: 1, updatedAt: -1 })
db.cases.createIndex({ tenantId: 1, "subject.registrationNumber": 1 })
db.cases.createIndex({ tenantId: 1, status: 1, closedAt: -1 })
```

Pertanyaan review:

- Apakah ada index redundant?
- Apakah write cost masih masuk akal?
- Apakah field sering berubah di banyak index?
- Apakah `status` field sering berubah dan muncul di banyak index?
- Apakah query dashboard butuh summary collection?
- Apakah `assignedTeamId + escalationLevel + status` query cukup sering untuk index panjang?
- Apakah `priorityRank` numeric lebih baik daripada enum string untuk sort?
- Apakah semua query selalu punya `tenantId`?
- Apakah ada query internal yang lupa tenant filter?

---

## 28. Index Naming

MongoDB bisa membuat nama index otomatis, tetapi untuk production, nama eksplisit sering lebih mudah dioperasikan.

Contoh:

```javascript
db.cases.createIndex(
  { tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 },
  { name: "idx_cases_tenant_assignee_status_dueAt" }
)
```

Nama index membantu saat:

- membaca explain;
- membaca slow query log;
- drop/hide index;
- migrasi;
- komunikasi antar engineer;
- incident review.

Naming convention sederhana:

```text
idx_<collection>_<field1>_<field2>_<field3>
uniq_<collection>_<field1>_<field2>
ttl_<collection>_<field>
partial_<collection>_<purpose>
```

Part 007 akan membahas partial/TTL lebih jauh.

---

## 29. Hidden Problem: Optional Filters

Endpoint search sering punya optional filters.

```http
GET /cases?status=OPEN&assignedTo=u1&priority=HIGH&from=2026-01-01&to=2026-06-01
```

Jika semua optional, kombinasi query bisa meledak.

Misalnya field optional:

```text
status
assignedTo
priority
team
createdAt range
dueAt range
```

Jumlah kombinasi bisa sangat banyak. Tidak mungkin membuat compound index untuk semua kombinasi.

### 29.1 Solusi Desain

Beberapa strategi:

1. wajibkan anchor filter seperti `tenantId` dan minimal satu discriminator;
2. batasi sort options;
3. pisahkan endpoint berdasarkan use case;
4. gunakan search engine untuk ad-hoc search;
5. gunakan aggregation/reporting store untuk analytics;
6. buat index hanya untuk top query patterns;
7. tolak query yang tidak didukung;
8. gunakan max date range;
9. gunakan cursor pagination;
10. monitor actual query patterns.

### 29.2 API Honesty

Jangan membuat endpoint terlihat fleksibel jika database tidak mampu mendukung fleksibilitas itu.

Lebih baik API jujur:

```http
GET /cases/assigned-to-me
GET /cases/by-case-number/{caseNumber}
GET /cases/escalated
GET /cases/recently-updated
GET /cases/archive?from=&to=
```

Daripada satu endpoint search monster:

```http
GET /cases?anything=anything&sort=anything
```

---

## 30. Index and State Machines

Dalam sistem workflow/regulatory lifecycle, state transition sering memakai conditional update.

Contoh:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: "t-001",
    status: "UNDER_REVIEW",
    version: 7
  },
  {
    $set: {
      status: "ESCALATED",
      escalationLevel: 2,
      updatedAt: new Date()
    },
    $inc: { version: 1 }
  }
)
```

Jika `_id` dipakai, default `_id` index biasanya cukup untuk menemukan document. Field `status` dan `version` menjadi guard setelah document ditemukan.

Namun untuk worker claim pattern:

```javascript
db.tasks.findOneAndUpdate(
  {
    tenantId: "t-001",
    status: "READY",
    runAfter: { $lte: now },
    lockedUntil: { $lt: now }
  },
  {
    $set: {
      status: "LOCKED",
      lockedBy: workerId,
      lockedUntil: leaseUntil
    }
  },
  {
    sort: { priority: -1, runAfter: 1 }
  }
)
```

Index sangat penting:

```javascript
{
  tenantId: 1,
  status: 1,
  lockedUntil: 1,
  priority: -1,
  runAfter: 1
}
```

Atau variasi berdasarkan selectivity dan sort.

Tanpa index, worker bisa melakukan scan besar berulang-ulang. Ini bisa menjadi self-inflicted denial of service.

---

## 31. Index and Multi-Tenancy

Untuk shared collection multi-tenant, `tenantId` hampir selalu menjadi leading field.

Contoh:

```javascript
{ tenantId: 1, caseNumber: 1 }
{ tenantId: 1, status: 1, createdAt: -1 }
{ tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 }
```

Kenapa?

1. tenant isolation;
2. query safety;
3. access pattern hampir selalu tenant-scoped;
4. future sharding consideration;
5. index prefix untuk tenant-level operation.

Namun ada edge case:

- internal admin global search;
- regulator-wide aggregate;
- background migration;
- cross-tenant operational dashboard.

Untuk query global, index dengan `tenantId` leading mungkin tidak ideal. Tapi query global harus diperlakukan sebagai workload khusus, bukan alasan melemahkan tenant-scoped design.

---

## 32. Common Mistakes

### 32.1 Index Every Field

Buruk karena:

- write lambat;
- storage besar;
- memory pressure;
- planner punya terlalu banyak pilihan;
- maintenance sulit.

### 32.2 Single-Field Index Untuk Semua Filter

Contoh:

```javascript
{ tenantId: 1 }
{ status: 1 }
{ assignedTo: 1 }
{ createdAt: -1 }
```

Lalu berharap query compound otomatis optimal.

Untuk query utama, compound index biasanya lebih baik.

### 32.3 Salah Urutan Compound Index

Index:

```javascript
{ createdAt: -1, tenantId: 1, status: 1 }
```

Query:

```javascript
{ tenantId, status }
sort { createdAt: -1 }
```

Ini sering kurang baik karena leading field `createdAt` tidak dibatasi equality.

### 32.4 Range Terlalu Awal

Index:

```javascript
{ tenantId: 1, createdAt: -1, status: 1 }
```

Query status tertentu dalam date range bisa membaca terlalu banyak.

### 32.5 Sort Tidak Didukung Index

Query terlihat cepat di dev karena data sedikit, tetapi di production muncul `SORT` besar.

### 32.6 Regex Search Mengira Index Akan Menyelamatkan

Case-insensitive contains regex sering tidak index-friendly.

```javascript
{ name: /capital/i }
```

Untuk search serius, gunakan search-specific design.

### 32.7 Skip Pagination

`skip(100000)` tetap mahal meski ada index.

### 32.8 Tidak Melihat Explain

Index dibuat berdasarkan intuisi, bukan bukti.

### 32.9 Tidak Menghubungkan Index Dengan API

Product menambah sort/filter baru tanpa review index.

### 32.10 Tidak Menghapus Index Mati

Index lama tidak dipakai tetapi terus membebani write path.

---

## 33. Practical Explain Review Checklist

Untuk setiap query production penting, jalankan:

```javascript
.explain("executionStats")
```

Checklist:

```text
[ ] Apakah winningPlan memakai index yang diharapkan?
[ ] Apakah ada COLLSCAN?
[ ] Apakah ada SORT stage?
[ ] Apakah totalKeysExamined masuk akal dibanding nReturned?
[ ] Apakah totalDocsExamined masuk akal dibanding nReturned?
[ ] Apakah filter equality berada di leading fields index?
[ ] Apakah sort dilayani index?
[ ] Apakah range field berada di posisi yang masuk akal?
[ ] Apakah projection menyebabkan fetch besar?
[ ] Apakah query tetap aman untuk tenant terbesar?
[ ] Apakah query tetap aman jika data tumbuh 10x?
[ ] Apakah index terlalu besar untuk manfaatnya?
[ ] Apakah index menambah cost ke write-heavy field?
[ ] Apakah API memungkinkan variasi query yang tidak didukung?
```

---

## 34. Index Design Review Checklist

Untuk collection production:

```text
[ ] Daftar semua access pattern utama.
[ ] Kelompokkan query berdasarkan shape.
[ ] Identifikasi equality, sort, range untuk tiap shape.
[ ] Tentukan index candidate dengan ESR.
[ ] Validasi prefix reuse.
[ ] Hindari index redundant kecuali ada alasan ukuran/performa.
[ ] Pastikan tenantId ada di query tenant-scoped.
[ ] Validasi sort support.
[ ] Validasi pagination strategy.
[ ] Evaluasi cardinality/selectivity field.
[ ] Evaluasi write amplification.
[ ] Evaluasi index size.
[ ] Jalankan explain pada data representative.
[ ] Monitor slow query setelah release.
[ ] Revisit index setelah access pattern berubah.
```

---

## 35. Java-Oriented Repository Checklist

Untuk setiap repository method:

```text
[ ] Method punya access pattern jelas.
[ ] Filter tidak berbentuk Map liar.
[ ] Sort dibatasi enum yang didukung index.
[ ] Pagination tidak memakai skip untuk data besar.
[ ] Projection sesuai kebutuhan endpoint.
[ ] Query selalu memasukkan tenantId jika tenant-scoped.
[ ] Query punya index terkait yang terdokumentasi.
[ ] Method punya test minimal untuk shape query.
[ ] Slow query bisa dipetakan ke method aplikasi.
[ ] Timeout dan limit ditentukan.
```

Contoh dokumentasi repository method:

```java
/**
 * Access pattern:
 *   tenantId equality
 *   assignedTo equality
 *   status equality
 *   dueAt ascending sort
 *
 * Required index:
 *   { tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 }
 *
 * Pagination:
 *   seek by dueAt + _id for future large-result variant
 */
List<CaseSummary> findOpenCasesAssignedTo(
    TenantId tenantId,
    UserId assignedTo,
    int limit
);
```

Ini mungkin terlihat verbose, tetapi untuk sistem besar, dokumentasi access pattern seperti ini mencegah regresi arsitektural.

---

## 36. Mental Model Summary

Index di MongoDB harus dipahami sebagai:

```text
sorted access path over document fields
```

Bukan:

```text
magic performance button
```

Compound index harus dibaca dari kiri ke kanan.

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Berarti:

```text
tenantId dulu,
lalu status di dalam tenant,
lalu createdAt di dalam tenant+status.
```

ESR guideline adalah default reasoning:

```text
Equality -> Sort -> Range
```

Explain plan adalah alat validasi:

```text
Apakah database mengeksekusi query seperti yang kita pikirkan?
```

API design dan index design harus satu paket:

```text
filter/sort yang diexpose API harus didukung access path database
```

Index punya biaya:

```text
read lebih cepat untuk query tertentu,
write lebih mahal untuk semua write yang menyentuh collection/indexed fields
```

Senior-level MongoDB engineering bukan tentang hafal operator index, tetapi mampu membuat trade-off:

- query flexibility vs predictable performance;
- compound index vs index explosion;
- covered query vs index size;
- read optimization vs write amplification;
- API convenience vs operational safety;
- current workload vs future growth.

---

## 37. Latihan Mandiri

### Latihan 1 — Design Index

Collection `cases` punya query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN",
  priority: "HIGH",
  createdAt: { $gte: ISODate("2026-01-01") }
}).sort({ createdAt: -1 }).limit(20)
```

Desain index awal.

Pertanyaan:

1. field mana equality?
2. field mana range?
3. field mana sort?
4. apakah `createdAt` sebagai range dan sort perlu muncul sekali saja?
5. apakah `priority` low-cardinality tetap layak di compound index?

Candidate:

```javascript
{ tenantId: 1, status: 1, priority: 1, createdAt: -1 }
```

### Latihan 2 — Diagnose Query

Index:

```javascript
{ tenantId: 1, createdAt: -1 }
```

Query:

```javascript
db.cases.find({
  tenantId: "t-001",
  status: "OPEN"
}).sort({ createdAt: -1 }).limit(20)
```

Pertanyaan:

1. apakah index dipakai?
2. apakah status dipakai di index?
3. apakah query bisa tetap membaca banyak document?
4. index apa yang lebih baik jika query sering dipakai?

Jawaban:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

### Latihan 3 — API Design

Product meminta endpoint:

```http
GET /cases?status=&priority=&assignedTo=&team=&from=&to=&sort=
```

Pertanyaan:

1. kombinasi query apa saja yang benar-benar dibutuhkan?
2. sort mana yang boleh?
3. filter mana yang wajib?
4. apakah satu endpoint fleksibel lebih baik daripada beberapa endpoint use-case specific?
5. bagaimana mencegah query yang tidak punya index?

---

## 38. Koneksi Ke Part Berikutnya

Part ini baru membahas fondasi index:

- B-tree mental model;
- single-field index;
- compound index;
- prefix;
- ESR;
- sort;
- covered query;
- explain;
- cardinality;
- write amplification.

Part berikutnya akan masuk ke jenis-jenis index yang lebih spesifik:

- multikey index;
- unique index;
- partial index;
- sparse index;
- TTL index;
- hashed index;
- wildcard index;
- text/geospatial/clustered overview;
- index lifecycle.

---

## 39. Ringkasan Eksekutif

Jika hanya membawa 10 hal dari part ini, bawa ini:

1. Index adalah operational schema.
2. Query production harus punya access path yang jelas.
3. Compound index dibaca dari kiri ke kanan.
4. Prefix property menentukan query mana yang bisa dilayani index.
5. ESR adalah default heuristic: Equality, Sort, Range.
6. `IXSCAN` tidak otomatis berarti query optimal.
7. Lihat `nReturned`, `totalKeysExamined`, dan `totalDocsExamined`.
8. `SORT` stage pada query besar adalah red flag.
9. API filter/sort harus dibatasi sesuai index support.
10. Setiap index mempercepat sebagian read tetapi membebani write path.

---

## 40. Status Seri

Part 006 selesai.

Seri belum selesai. Lanjut ke:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-007.md
```

Dengan judul:

```text
Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-007.md">Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered ➡️</a>
</div>
