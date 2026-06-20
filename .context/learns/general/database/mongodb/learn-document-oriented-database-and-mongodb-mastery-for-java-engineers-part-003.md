# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-003.md

# Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard

> Seri: **Document-Oriented Database and MongoDB Mastery for Java Engineers**  
> Bagian: **003 dari 035**  
> Fokus: arsitektur inti MongoDB dari sudut pandang engineer aplikasi Java: bagaimana `database`, `collection`, `document`, `mongod`, replica set, shard, `mongos`, config server, dan deployment topology membentuk perilaku nyata aplikasi.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan struktur MongoDB dari level logical sampai deployment topology.
2. Membedakan `database`, `collection`, `document`, `mongod`, replica set, shard, `mongos`, dan config server.
3. Memahami bahwa MongoDB bukan hanya “JSON storage”, tetapi sistem database terdistribusi dengan aturan routing, replication, election, read/write concern, dan failure semantics.
4. Menjelaskan kenapa development standalone MongoDB tidak mewakili perilaku production replica set/sharded cluster.
5. Membaca topology MongoDB dari sudut pandang aplikasi Java: connection string, server selection, failover, read preference, retry, session, transaction, dan observability.
6. Mengidentifikasi failure mode dasar: primary down, secondary lag, network partition, write retry, stale read, chunk migration, scatter-gather query, dan config metadata issue.
7. Membuat mental model awal sebelum masuk indexing, transactions, performance, replication, dan sharding di part berikutnya.

Bagian ini bukan tutorial instalasi. Tujuannya adalah membentuk **mental model arsitektur**.

---

## 1. Posisi Part 003 dalam Seri

Kita sudah membahas:

- **Part 000**: kenapa document database ada dan kapan MongoDB cocok/tidak cocok.
- **Part 001**: document sebagai boundary: ownership, locality, atomicity, lifecycle.
- **Part 002**: BSON, tipe data, struktur document, dan konsekuensi mapping ke Java.

Sekarang kita naik satu level: **bagaimana MongoDB menjalankan document tersebut dalam arsitektur database nyata**.

Sebelum menulis query, membuat index, atau mendesain shard key, kamu perlu tahu:

- data kamu hidup di mana;
- operasi masuk lewat komponen apa;
- siapa yang menerima write;
- siapa yang boleh menjawab read;
- bagaimana failover terjadi;
- bagaimana data didistribusikan;
- kenapa topology memengaruhi correctness aplikasi.

Kesalahan umum engineer aplikasi adalah mengira database adalah black box sederhana:

```text
application -> database -> result
```

Untuk MongoDB production, mental model yang lebih benar:

```text
Java application
  -> MongoDB driver
  -> topology discovery / server selection
  -> mongod or mongos
  -> replica set primary/secondary
  -> storage engine / indexes / oplog
  -> replication / election / routing / balancing
```

Pada sharded cluster:

```text
Java application
  -> MongoDB driver
  -> mongos query router
  -> config metadata
  -> one shard / many shards
  -> each shard is usually a replica set
```

Artinya keputusan kecil di aplikasi, seperti memilih `readPreference=secondary`, tidak netral. Itu dapat mengubah consistency semantics.

---

## 2. MongoDB dari Dua Sudut Pandang: Logical vs Physical

MongoDB perlu dipahami dari dua layer:

1. **Logical data model**: bagaimana data terlihat oleh aplikasi.
2. **Physical/deployment model**: bagaimana data disimpan, direplikasi, dan didistribusikan.

### 2.1 Logical Model

Logical model:

```text
Cluster/Deployment
  └── Database
        └── Collection
              └── Document
                    └── Field / Array / Embedded Document
```

Contoh:

```text
regulatory_platform
  ├── cases
  ├── parties
  ├── case_documents
  ├── audit_events
  └── workflow_tasks
```

Setiap collection berisi banyak document.

Contoh document di collection `cases`:

```json
{
  "_id": "CASE-2026-000001",
  "tenantId": "OJK-ID",
  "caseType": "ENFORCEMENT",
  "status": "UNDER_REVIEW",
  "subject": {
    "subjectId": "SUBJ-981",
    "name": "PT Example Securities"
  },
  "assignedTo": {
    "userId": "USR-212",
    "displayName": "Ayu Pratama"
  },
  "riskScore": 87,
  "createdAt": { "$date": "2026-06-01T10:15:00Z" },
  "updatedAt": { "$date": "2026-06-18T14:20:00Z" },
  "version": 12
}
```

### 2.2 Physical/Deployment Model

Physical model:

```text
MongoDB deployment
  ├── standalone mongod
  ├── replica set
  │     ├── primary mongod
  │     ├── secondary mongod
  │     └── secondary mongod
  └── sharded cluster
        ├── mongos query routers
        ├── config server replica set
        ├── shard A replica set
        ├── shard B replica set
        └── shard C replica set
```

Logical model menjawab:

> “Data saya berbentuk apa?”

Physical model menjawab:

> “Operasi saya benar-benar dieksekusi di node mana, dengan consistency guarantee apa, dan apa yang terjadi saat node gagal?”

Top 1% engineer tidak berhenti di logical model. Mereka menghubungkan logical design ke physical behavior.

---

## 3. Database: Namespace Boundary, Bukan Isolation Boundary Mutlak

Dalam MongoDB, `database` adalah container logical untuk collection.

Contoh:

```javascript
use regulatory_platform
```

Collection di dalamnya:

```javascript
db.cases.findOne()
db.audit_events.findOne()
db.workflow_tasks.findOne()
```

### 3.1 Apa Fungsi Database?

Database memberi:

1. Namespace untuk collection.
2. Scope administrasi tertentu.
3. Tempat menyimpan metadata collection/index.
4. Boundary untuk beberapa operasi administrasi.
5. Organisasi aplikasi.

### 3.2 Database Bukan Selalu Tenant Boundary yang Cukup

Untuk multi-tenancy, database bisa dipakai sebagai tenant boundary:

```text
tenant_a_db.cases
tenant_b_db.cases
tenant_c_db.cases
```

Tetapi ini bukan keputusan otomatis. Trade-off-nya:

Keuntungan:

- isolasi namespace kuat;
- backup/restore per tenant lebih mudah;
- akses admin bisa dipisah;
- risiko query lupa `tenantId` lebih kecil.

Kerugian:

- banyak tenant berarti banyak database/collection/index;
- overhead administrasi meningkat;
- migrasi schema lintas tenant lebih kompleks;
- connection/metadata management bisa berat;
- query cross-tenant sulit.

Alternatif:

```text
shared_db.cases { tenantId: "A", ... }
shared_db.cases { tenantId: "B", ... }
```

Keuntungan:

- lebih sederhana untuk operasi massal;
- index governance lebih terpusat;
- cocok untuk banyak tenant kecil.

Risiko:

- wajib enforce `tenantId` di semua query;
- bug authorization bisa fatal;
- noisy neighbor lebih nyata;
- backup/restore per tenant lebih sulit.

Kita akan bahas multi-tenancy khusus di Part 022.

### 3.3 Database Naming

Praktik baik:

```text
regulatory_case_management
identity_access
case_document_metadata
audit_retention
```

Hindari nama ambigu:

```text
test
prod
mongo
main
data
```

Untuk environment, jangan hanya mengandalkan nama database; gunakan deployment separation, credentials, network, dan config.

Buruk:

```text
mongodb://prod-host/app_test
mongodb://prod-host/app_prod
```

Lebih baik:

```text
mongodb://dev-cluster/regulatory_platform
mongodb://staging-cluster/regulatory_platform
mongodb://prod-cluster/regulatory_platform
```

---

## 4. Collection: Bukan Table, Melainkan Set of Similar Access/Ownership Shape

Collection adalah container document.

Contoh:

```javascript
db.createCollection("cases")
db.createCollection("case_documents")
db.createCollection("audit_events")
```

Kalau dari SQL background, mudah menganggap collection = table. Ini tidak sepenuhnya benar.

### 4.1 Perbedaan Table dan Collection

Relational table biasanya berarti:

- schema kolom ketat;
- setiap row punya struktur sama;
- relasi eksplisit lewat foreign key;
- normalisasi kuat;
- join adalah operasi utama.

MongoDB collection berarti:

- kumpulan document dengan bentuk yang seharusnya terkait;
- schema bisa bervariasi, tetapi tetap perlu governance;
- relasi bisa embedded, referenced, duplicated, atau materialized;
- query shape dan aggregate boundary menentukan desain;
- join bukan default mental model.

Collection yang baik biasanya berisi document yang punya:

1. Lifecycle serupa.
2. Ownership serupa.
3. Access pattern serupa.
4. Retention policy serupa.
5. Security classification serupa.
6. Indexing needs serupa.
7. Growth pattern serupa.

### 4.2 Collection Design Contoh: Regulatory Case

Misalnya domain regulatory enforcement:

```text
cases
case_notes
case_documents
audit_events
workflow_tasks
case_search_projection
```

Kenapa tidak semua masuk `cases`?

Karena:

- notes bisa tumbuh tanpa batas;
- audit events append-only dan retention-nya berbeda;
- document metadata bisa punya indexing/search khusus;
- workflow tasks mungkin perlu worker claiming;
- search projection mungkin denormalized.

Kenapa tidak satu collection per Java class?

Misalnya:

```text
case_subjects
case_statuses
case_assignments
case_priorities
case_attachments
case_flags
```

Ini sering menghasilkan relational design buruk dalam MongoDB:

- terlalu banyak round trip;
- terlalu banyak application-side join;
- atomic boundary pecah;
- index tersebar;
- query lebih sulit dijaga.

### 4.3 Collection Tidak Wajib Homogen 100%, Tapi Harus Terkendali

MongoDB memungkinkan document dalam satu collection punya field berbeda. Ini powerful untuk evolusi schema dan polymorphic data.

Contoh collection `case_events`:

```json
{
  "_id": "EVT-1",
  "caseId": "CASE-1",
  "type": "CASE_CREATED",
  "createdAt": "2026-06-01T10:00:00Z",
  "actor": { "userId": "USR-1" }
}
```

```json
{
  "_id": "EVT-2",
  "caseId": "CASE-1",
  "type": "ESCALATED",
  "createdAt": "2026-06-02T11:00:00Z",
  "actor": { "userId": "USR-2" },
  "escalation": {
    "fromLevel": "L1",
    "toLevel": "L2",
    "reasonCode": "HIGH_RISK"
  }
}
```

Ini masuk akal karena semua document adalah event dengan envelope sama, meski payload berbeda.

Yang tidak sehat:

```text
misc_documents
  ├── user profile
  ├── case
  ├── payment
  ├── audit event
  ├── cache entry
  └── email template
```

Flexible schema bukan izin membuat “junk drawer database”.

---

## 5. Document: Unit Data, Unit Locality, Unit Atomic Update

Document adalah record utama MongoDB.

Document biasanya punya field `_id` sebagai primary identity.

```json
{
  "_id": "CASE-2026-000001",
  "status": "OPEN",
  "priority": "HIGH",
  "createdAt": "2026-06-01T10:00:00Z"
}
```

### 5.1 Document sebagai Unit Atomicity

Single-document writes bersifat atomic pada level document.

Artinya update seperti ini:

```javascript
db.cases.updateOne(
  { _id: "CASE-2026-000001", status: "OPEN" },
  {
    $set: {
      status: "UNDER_REVIEW",
      assignedTo: { userId: "USR-212", displayName: "Ayu" },
      updatedAt: new Date()
    },
    $inc: { version: 1 }
  }
)
```

Akan mengubah field-field dalam satu document sebagai satu operasi atomic.

Konsekuensinya:

- field yang harus konsisten bersama sering lebih baik berada dalam satu document;
- field yang tumbuh tanpa batas tidak selalu boleh berada dalam satu document;
- cross-document invariant perlu transaksi atau desain alternatif.

### 5.2 Document sebagai Unit Locality

Jika UI sering membutuhkan data berikut sekaligus:

```text
case id
case status
priority
subject summary
assigned reviewer
latest decision summary
```

Maka menaruh semuanya dalam document `cases` bisa masuk akal.

Kalau setiap page load harus melakukan:

```text
find case
find subject
find assignment
find latest decision
find priority
find risk score
```

MongoDB dipakai seperti relational database tanpa join engine.

### 5.3 Document sebagai Unit Growth Risk

Document bisa tumbuh:

```json
{
  "_id": "CASE-1",
  "notes": [
    { "noteId": "N1", "text": "..." },
    { "noteId": "N2", "text": "..." },
    { "noteId": "N3", "text": "..." }
  ]
}
```

Ini baik kalau notes terbatas.

Tetapi jika case bisa punya 100.000 notes, ini buruk:

- document membesar terus;
- update array makin mahal;
- contention meningkat;
- retrieval berat;
- batas ukuran document bisa tercapai;
- pagination notes sulit.

Maka notes sering lebih baik menjadi collection terpisah:

```json
{
  "_id": "NOTE-1",
  "caseId": "CASE-1",
  "text": "...",
  "createdAt": "2026-06-01T10:00:00Z"
}
```

### 5.4 Document Shape adalah Kontrak Arsitektur

Document shape menentukan:

- query apa yang murah;
- update apa yang atomic;
- index apa yang masuk akal;
- migration apa yang sulit;
- permission apa yang mudah;
- audit apa yang defensible;
- shard key apa yang mungkin.

Top 1% engineer tidak mulai dari “collection apa saja?”, tetapi dari:

```text
Apa aggregate boundary-nya?
Apa access pattern-nya?
Apa consistency invariant-nya?
Apa growth behavior-nya?
Apa operational lifecycle-nya?
```

---

## 6. `_id`: Identity, Routing Candidate, and Application Contract

Setiap document punya `_id` unik dalam collection.

Jika tidak disediakan, driver/server biasanya menghasilkan ObjectId.

Contoh ObjectId:

```json
{
  "_id": { "$oid": "666fc3a35a7d1b246aa4a111" }
}
```

Tapi untuk domain tertentu, natural/domain ID bisa lebih baik:

```json
{
  "_id": "CASE-2026-000001"
}
```

### 6.1 ObjectId vs Domain ID

ObjectId cocok ketika:

- identity teknis cukup;
- ID tidak perlu meaningful;
- document dibuat lokal oleh aplikasi;
- tidak ada external identifier requirement.

Domain ID cocok ketika:

- ID punya makna bisnis/regulasi;
- ID muncul di surat, laporan, audit, API, integrasi;
- ID harus bisa direkonstruksi/dicari secara manusiawi;
- ID berasal dari sistem upstream.

### 6.2 Jangan Campur Public API ID dan Storage Detail Sembarangan

Buruk:

```http
GET /cases/666fc3a35a7d1b246aa4a111
```

Jika ObjectId diekspos sebagai kontrak publik, kamu mengikat client pada storage detail.

Lebih baik:

```http
GET /cases/CASE-2026-000001
```

Atau pisahkan:

```json
{
  "_id": { "$oid": "666fc3a35a7d1b246aa4a111" },
  "caseNumber": "CASE-2026-000001"
}
```

Tetapi jika `caseNumber` unik dan selalu dipakai untuk lookup, pertimbangkan menjadikannya `_id`.

### 6.3 `_id` dan Sharding

Dalam sharded cluster, `_id` bukan otomatis shard key. Kalau query selalu berdasarkan `_id`, tetapi shard key bukan `_id`, query mungkin tetap perlu routing tambahan tergantung desain.

Shard key akan dibahas lebih dalam di Part 021.

Untuk sekarang pahami:

```text
_id = unique identity dalam collection
shard key = data distribution/routing key dalam sharded cluster
```

Mereka bisa sama, bisa berbeda.

---

## 7. `mongod`: Database Server Process

`mongod` adalah proses server MongoDB yang menyimpan data, menjalankan query, mengelola index, menerima koneksi, melakukan replication, dan berpartisipasi dalam replica set/shard.

Secara sederhana:

```text
mongod = MongoDB database server daemon
```

Dalam standalone:

```text
Java app -> mongod
```

Dalam replica set:

```text
Java app -> replica set members (mongod, mongod, mongod)
```

Dalam sharded cluster:

```text
Java app -> mongos -> shard replica sets -> mongod members
```

### 7.1 Apa yang Dilakukan `mongod`?

`mongod` bertanggung jawab untuk:

1. Menerima command/query.
2. Mengakses collection dan index.
3. Menjalankan query planner.
4. Membaca/menulis data ke storage engine.
5. Menulis ke journal/oplog sesuai konfigurasi.
6. Mengikuti replication protocol.
7. Mengikuti election jika bagian replica set.
8. Menjalankan background task tertentu seperti TTL monitor.
9. Menyediakan metadata node dan status.

### 7.2 Dari Sudut Pandang Java App

Java app tidak “memanggil file database”. Java app bicara ke driver, driver bicara ke server.

```text
application code
  -> MongoClient
  -> connection pool
  -> server discovery and monitoring
  -> selected server
  -> command execution
```

Konsekuensi:

- `MongoClient` harus long-lived, bukan dibuat per request.
- Connection pool perlu sizing.
- Timeouts perlu eksplisit.
- Server selection failure harus dianggap failure mode normal.
- Topology change harus diamati lewat metrics/logging.

Contoh buruk:

```java
public Case loadCase(String id) {
    try (MongoClient client = MongoClients.create(uri)) {
        return client.getDatabase("regulatory")
            .getCollection("cases", Case.class)
            .find(eq("_id", id))
            .first();
    }
}
```

Masalah:

- membuat client per request;
- pool tidak efektif;
- topology discovery berulang;
- latency meningkat;
- resource leak risk.

Lebih baik:

```java
public final class CaseRepository {
    private final MongoCollection<CaseDocument> cases;

    public CaseRepository(MongoClient client) {
        this.cases = client
            .getDatabase("regulatory")
            .getCollection("cases", CaseDocument.class);
    }

    public Optional<CaseDocument> findById(String id) {
        return Optional.ofNullable(cases.find(eq("_id", id)).first());
    }
}
```

---

## 8. Standalone Deployment: Useful for Learning, Dangerous as Mental Model

Standalone MongoDB:

```text
Java app -> single mongod
```

Ini sering dipakai untuk:

- local development;
- quick test;
- tutorial;
- prototype.

Tetapi production MongoDB hampir selalu perlu replica set, minimal untuk high availability dan fitur tertentu.

### 8.1 Apa yang Tidak Terlihat di Standalone?

Standalone tidak memperlihatkan:

- primary/secondary election;
- replication lag;
- read preference behavior;
- write concern majority;
- failover;
- retryable write behavior yang realistis;
- transaction behavior dalam topology replicated;
- change stream production semantics;
- stale read scenario;
- oplog pressure.

Jika kamu hanya pernah test di standalone, kamu belum menguji banyak failure mode penting.

### 8.2 Local Development yang Lebih Realistis

Untuk aplikasi serius, gunakan replica set lokal bahkan satu-node replica set untuk beberapa fitur.

Contoh konseptual:

```text
local-dev-rs
  └── mongod as replica set primary
```

Lebih baik lagi untuk integration test tertentu:

```text
test replica set
  ├── mongod-1 primary
  ├── mongod-2 secondary
  └── mongod-3 secondary
```

Dengan Testcontainers, ini bisa diotomasi. Detail testing akan dibahas di Part 028.

---

## 9. Replica Set: High Availability and Replication Boundary

Replica set adalah group `mongod` yang menjaga dataset yang sama.

Typical deployment:

```text
Replica Set rs0
  ├── node1:27017  PRIMARY
  ├── node2:27017  SECONDARY
  └── node3:27017  SECONDARY
```

### 9.1 Primary

Primary menerima write.

```text
writes -> primary
```

Read default juga ke primary.

```text
reads -> primary
```

### 9.2 Secondary

Secondary mereplikasi data dari primary.

Secondary bisa menjawab read jika read preference mengizinkan.

```text
reads with secondary preference -> secondary
```

Tetapi secondary bisa lag.

Artinya read dari secondary bisa melihat data lama.

### 9.3 Arbiter

Arbiter bisa ikut voting election tetapi tidak menyimpan data. Dalam desain modern, arbiter perlu sangat hati-hati dan biasanya dihindari untuk deployment serius, terutama pada sharded cluster.

Untuk mental model awal:

```text
lebih baik 3 data-bearing nodes daripada 2 data-bearing + 1 arbiter
```

### 9.4 Election

Jika primary tidak tersedia, replica set melakukan election untuk memilih primary baru.

Flow konseptual:

```text
primary unavailable
  -> members detect failure
  -> election occurs
  -> eligible secondary becomes primary
  -> driver detects topology change
  -> writes resume to new primary
```

Selama election:

- write bisa gagal sementara;
- driver bisa mengalami server selection timeout;
- retryable writes bisa membantu, tetapi tidak menghapus kebutuhan desain idempotent;
- aplikasi harus siap menerima transient errors.

### 9.5 Oplog

Replica set menggunakan oplog sebagai log operasi yang direplikasi.

Mental model:

```text
primary applies write
primary records operation in oplog
secondary tails oplog
secondary applies operation
```

Jika secondary tertinggal terlalu jauh dan oplog tidak cukup, secondary bisa perlu initial sync ulang.

Untuk aplikasi, oplog relevan karena:

- replication lag memengaruhi secondary read;
- change streams bergantung pada stream perubahan;
- failover semantics terkait operasi yang sudah/ belum majority committed.

### 9.6 Majority Write Concern

Write concern menentukan kapan write dianggap sukses.

Contoh mental model:

```text
w:1       -> acknowledged by primary
majority  -> acknowledged by majority of voting data-bearing nodes
```

Untuk data regulatori penting, `majority` sering lebih defensible daripada `w:1`, walau latency bisa lebih tinggi.

Trade-off:

```text
w:1
  + lebih cepat
  - lebih rentan rollback saat failover ekstrem

majority
  + lebih kuat untuk durability/consistency
  - latency lebih tinggi
```

### 9.7 Read Concern

Read concern menentukan level visibility/consistency data yang dibaca.

Konsep sederhana:

- `local`: baca data lokal node, bisa belum majority committed.
- `majority`: baca data yang sudah majority committed.
- `snapshot`: snapshot konsisten untuk transaksi/operasi tertentu.

Untuk part ini, cukup pahami bahwa “read” bukan satu jenis. Read punya consistency semantics.

### 9.8 Read Preference

Read preference menentukan node mana yang boleh menjawab read.

Umum:

```text
primary
primaryPreferred
secondary
secondaryPreferred
nearest
```

Default biasanya primary.

Kesalahan umum:

> “Kita arahkan read ke secondary supaya scale.”

Itu mungkin benar untuk read yang toleran stale data, tetapi berbahaya untuk operation yang membutuhkan read-your-writes atau decision correctness.

Contoh aman:

- dashboard statistik yang toleran delay;
- reporting non-critical;
- background export.

Contoh berbahaya:

- setelah submit case, langsung baca status terbaru;
- authorization decision;
- workflow transition guard;
- payment/regulatory decision;
- duplicate prevention check.

---

## 10. Replica Set dari Sudut Pandang Java Driver

Connection string replica set biasanya berisi beberapa host dan replica set name:

```text
mongodb://mongo1:27017,mongo2:27017,mongo3:27017/regulatory?replicaSet=rs0
```

Driver melakukan:

1. Initial connection.
2. Topology discovery.
3. Server monitoring.
4. Primary detection.
5. Server selection untuk tiap operasi.
6. Retry jika dikonfigurasi dan aman.
7. Pool management.

### 10.1 Server Selection

Saat aplikasi melakukan write, driver mencari primary.

```text
write command
  -> select primary
  -> send operation
```

Jika tidak ada primary yang diketahui:

```text
No suitable server found
```

Ini bukan “MongoDB down total” selalu. Bisa jadi:

- election sedang terjadi;
- network ke semua node terganggu;
- DNS issue;
- TLS/auth error;
- replica set name salah;
- firewall memblokir sebagian node;
- driver tidak bisa resolve host internal yang diiklankan server.

### 10.2 Retryable Writes

Retryable writes membantu ketika error terjadi setelah command dikirim tetapi sebelum client yakin hasilnya.

Namun retry tidak menyelesaikan semua masalah.

Jika operation non-idempotent secara bisnis, kamu tetap perlu idempotency design.

Contoh raw operation:

```javascript
db.accounts.updateOne(
  { _id: "A" },
  { $inc: { balance: -100 } }
)
```

Jika retry terjadi tanpa guard bisnis, kamu perlu yakin MongoDB retryable write semantics dan command identity digunakan benar. Untuk command bisnis, lebih defensible menggunakan idempotency key:

```json
{
  "commandId": "CMD-2026-000001",
  "caseId": "CASE-1",
  "type": "ESCALATE_CASE"
}
```

Lalu enforce unique command processing.

### 10.3 Failover Handling di Java Service

Service Java yang matang harus punya:

- timeout eksplisit;
- retry policy terbatas;
- idempotency;
- metrics error by category;
- logging command context;
- circuit breaker untuk mencegah retry storm;
- health check yang tidak terlalu naif;
- graceful degradation untuk read-only feature.

Contoh prinsip:

```text
Transient DB failure is normal.
Silent double execution is unacceptable.
Infinite retry is production incident amplifier.
```

---

## 11. Sharded Cluster: Horizontal Distribution Boundary

Sharding membagi data ke beberapa shard.

Tujuan:

- dataset lebih besar dari satu replica set;
- throughput write/read perlu didistribusikan;
- storage/IO perlu diskalakan horizontal;
- data placement perlu dikontrol.

Arsitektur umum:

```text
Java app
  -> mongos router(s)
      -> config server replica set
      -> shard01 replica set
      -> shard02 replica set
      -> shard03 replica set
```

### 11.1 Shard

Shard menyimpan subset data.

Dalam production, shard biasanya replica set:

```text
Shard 01 / rs-shard-01
  ├── primary
  ├── secondary
  └── secondary

Shard 02 / rs-shard-02
  ├── primary
  ├── secondary
  └── secondary
```

Artinya sharding tidak menggantikan replication. Sharding dan replication menjawab masalah berbeda:

```text
replication -> availability/durability/read scaling terbatas
sharding    -> horizontal data distribution/throughput/storage scaling
```

### 11.2 `mongos`: Query Router

`mongos` adalah query router. Dari sudut pandang aplikasi, sharded cluster diakses lewat `mongos`, bukan langsung ke shard.

```text
Java app -> mongos -> appropriate shard(s)
```

`mongos`:

- menerima command dari client;
- membaca metadata dari config server;
- menentukan shard target;
- menggabungkan hasil jika query menyentuh banyak shard;
- tidak menyimpan data permanen.

### 11.3 Config Server

Config server menyimpan metadata sharded cluster:

- shard list;
- database metadata;
- collection sharding metadata;
- chunk/range metadata;
- zone metadata;
- cluster state.

Tanpa metadata yang benar, routing tidak bisa dilakukan dengan benar.

Config server biasanya replica set.

### 11.4 Shard Key

Shard key menentukan distribusi document dalam sharded collection.

Contoh:

```javascript
sh.shardCollection(
  "regulatory.cases",
  { tenantId: 1, caseId: 1 }
)
```

Shard key adalah salah satu keputusan paling mahal untuk diubah. Salah shard key bisa menyebabkan:

- hotspot;
- scatter-gather query;
- imbalance;
- poor write distribution;
- transaksi lebih mahal;
- query latency tidak stabil.

Part 021 akan khusus membahas ini.

Untuk sekarang, pahami:

```text
Good shard key = supports distribution + routing + workload locality.
Bad shard key = cluster exists physically, but workload still bottlenecks logically.
```

---

## 12. Targeted Query vs Scatter-Gather Query

Dalam sharded cluster, query bisa diarahkan ke shard tertentu atau disebar ke banyak shard.

### 12.1 Targeted Query

Jika query mengandung shard key yang cukup, `mongos` bisa menargetkan shard tertentu.

Contoh shard key:

```javascript
{ tenantId: 1, caseId: 1 }
```

Query:

```javascript
db.cases.find({
  tenantId: "TENANT-A",
  caseId: "CASE-2026-000001"
})
```

Routing:

```text
mongos -> shard02 only
```

Ini baik.

### 12.2 Scatter-Gather Query

Jika query tidak menyertakan shard key:

```javascript
db.cases.find({
  status: "UNDER_REVIEW"
})
```

Routing:

```text
mongos -> shard01
       -> shard02
       -> shard03
       -> merge results
```

Ini bisa mahal.

Bukan berarti selalu dilarang, tetapi harus disengaja.

### 12.3 Sharded Cluster Tidak Otomatis Membuat Query Cepat

Sharding dapat memperburuk query jika query pattern tidak cocok dengan shard key.

Kesalahan umum:

> “Data besar, pakai sharding, selesai.”

Lebih benar:

```text
Data besar + access pattern jelas + shard key tepat + index tepat + routing terarah = sharding membantu.

Data besar + access pattern liar + shard key buruk + query tanpa shard key = sharding membuat masalah tersebar.
```

---

## 13. Chunk, Range, Balancer: Data Movement Mental Model

Dalam sharded collection, data dibagi menjadi range/chunk berdasarkan shard key.

Mental model sederhana:

```text
Shard key range A-F -> shard01
Shard key range G-P -> shard02
Shard key range Q-Z -> shard03
```

Balancer dapat memindahkan chunk untuk menjaga distribusi.

### 13.1 Kenapa Ini Penting untuk Aplikasi?

Karena data movement bisa memengaruhi:

- latency;
- write distribution;
- query routing;
- hotspot;
- operational windows;
- observability.

Biasanya aplikasi tidak perlu tahu chunk detail, tetapi architect perlu tahu bahwa sharded cluster bersifat dinamis.

### 13.2 Monotonic Key Problem

Jika shard key selalu naik:

```text
createdAt: now()
caseNumber: increasing sequence
```

Maka write baru bisa menumpuk di range terakhir.

Efek:

```text
all new writes -> one shard -> hotspot
```

Ini mirip masalah “rightmost index page” di database B-tree, tetapi di level distribusi cluster.

Shard key perlu mempertimbangkan cardinality, frequency, monotonicity, dan query pattern.

---

## 14. MongoDB Atlas vs Self-Managed

MongoDB bisa dijalankan self-managed atau melalui MongoDB Atlas.

### 14.1 Self-Managed

Kamu bertanggung jawab untuk:

- provisioning server;
- OS tuning;
- disk;
- TLS;
- auth;
- backup;
- upgrade;
- monitoring;
- alerting;
- failover testing;
- sharding operations;
- incident response.

Keuntungan:

- kontrol penuh;
- bisa cocok untuk environment tertentu;
- bisa memenuhi constraint infrastruktur khusus.

Kerugian:

- operational burden tinggi;
- butuh keahlian DBA/SRE MongoDB;
- risiko misconfiguration.

### 14.2 MongoDB Atlas

Atlas adalah managed service.

Biasanya menyediakan:

- cluster provisioning;
- backups;
- monitoring;
- scaling options;
- upgrades;
- security integrations;
- search/vector/time-series ecosystem;
- network controls.

Keuntungan:

- lebih cepat operationally;
- banyak fitur managed;
- lebih mudah untuk team aplikasi.

Kerugian:

- biaya;
- vendor/platform dependency;
- beberapa constraint compliance/network;
- perlu memahami batas managed service.

### 14.3 Managed Tidak Berarti Tidak Perlu Paham Arsitektur

Atlas tidak menghapus kebutuhan memahami:

- document design;
- index design;
- read/write concern;
- shard key;
- query shape;
- connection pool;
- retry semantics;
- migration;
- observability.

Managed service mengurangi beban operasional, bukan menggantikan engineering judgement.

---

## 15. Storage Engine Mental Model: WiredTiger Without Going Too Deep

MongoDB modern menggunakan WiredTiger sebagai storage engine default.

Untuk Part 003, kita tidak perlu masuk detail internal, tetapi perlu mental model dasar:

```text
query/update
  -> query planner / execution engine
  -> index/data pages
  -> cache
  -> disk/journal
```

### 15.1 Kenapa Storage Engine Relevan untuk Java Engineer?

Karena aplikasi memengaruhi storage behavior lewat:

- document size;
- index count;
- update pattern;
- array growth;
- query selectivity;
- projection;
- write concern;
- batch size;
- transaction duration.

Kalau aplikasi membuat document besar dan update acak terus-menerus, kamu menciptakan storage pressure.

Kalau aplikasi membuat terlalu banyak index, kamu memperlambat write path.

Kalau aplikasi membaca field besar yang tidak perlu, kamu membuang IO/network.

### 15.2 Cache and Working Set

MongoDB performance sangat dipengaruhi apakah working set muat di memory/cache.

Working set mencakup:

- data yang sering dibaca;
- index yang sering digunakan;
- halaman data panas;
- update target.

Jika working set tidak muat:

```text
more disk IO -> higher latency -> more connection occupancy -> app thread waits -> cascading latency
```

Ini akan dibahas detail di Part 018.

---

## 16. Deployment Topology and Application Semantics

Topology bukan urusan DBA saja. Topology mengubah semantics aplikasi.

### 16.1 Standalone Semantics

```text
single node
no failover
no replication lag
simple read/write path
```

Bagus untuk belajar, buruk untuk validasi production behavior.

### 16.2 Replica Set Semantics

```text
primary writes
secondary replication
failover/election
read preference choices
write concern/read concern choices
```

Aplikasi harus siap:

- primary berubah;
- write sementara gagal;
- secondary stale;
- read concern/write concern berpengaruh;
- retry perlu idempotency.

### 16.3 Sharded Cluster Semantics

```text
mongos routing
config metadata
shard key
targeted vs scatter-gather
chunk movement
cross-shard transaction/query cost
```

Aplikasi harus sadar:

- query tanpa shard key bisa mahal;
- tenant filter bisa jadi routing key;
- transaction lintas shard lebih mahal;
- aggregation bisa tersebar;
- unique constraint punya aturan tambahan;
- shard key memengaruhi lifecycle sistem.

---

## 17. Connection String: Architecture Encoded as Configuration

Connection string bukan sekadar URL. Ia membawa asumsi topology.

### 17.1 Standalone

```text
mongodb://localhost:27017/regulatory
```

### 17.2 Replica Set

```text
mongodb://mongo1:27017,mongo2:27017,mongo3:27017/regulatory?replicaSet=rs0
```

### 17.3 Atlas/SRV

```text
mongodb+srv://app_user:secret@cluster0.example.mongodb.net/regulatory
```

SRV dapat membantu discovery host lewat DNS.

### 17.4 Parameter Penting

Contoh parameter yang sering relevan:

```text
retryWrites=true
w=majority
readPreference=primary
connectTimeoutMS=...
serverSelectionTimeoutMS=...
maxPoolSize=...
minPoolSize=...
tls=true
appName=regulatory-case-service
```

### 17.5 `appName` Itu Penting

`appName` membantu observability di server logs/monitoring.

Contoh:

```text
appName=regulatory-case-command-service
```

Jangan semua service pakai nama generik:

```text
appName=myapp
```

Lebih baik:

```text
regulatory-case-api
regulatory-case-worker
regulatory-search-indexer
regulatory-audit-exporter
```

---

## 18. Java Service Topology Pattern

Dalam sistem Java microservices, pola umum:

```text
case-command-service
  -> cases collection
  -> audit_events collection
  -> workflow_tasks collection

case-query-service
  -> cases collection
  -> case_search_projection collection

case-document-service
  -> case_documents collection
  -> object storage metadata

case-audit-service
  -> audit_events collection
```

Pertanyaan arsitektur:

1. Apakah setiap service punya database user berbeda?
2. Apakah setiap service boleh write collection yang sama?
3. Apakah collection ownership jelas?
4. Bagaimana cross-service consistency dijaga?
5. Apakah change stream dipakai sebagai integration mechanism?
6. Apakah ada outbox/event log terpisah?
7. Apakah read concern/write concern seragam?
8. Apakah transaction dipakai lintas collection?
9. Apakah service bisa bertahan saat primary failover?

### 18.1 Collection Ownership

Buruk:

```text
all services can read/write all collections
```

Lebih baik:

```text
case-command-service owns cases write model
case-audit-service owns audit_events append model
case-query-service owns search projection
```

Read sharing boleh, write ownership harus disiplin.

### 18.2 Database User Per Service

Aplikasi serius sebaiknya tidak semua memakai superuser.

Contoh:

```text
case-api-user
  readWrite on regulatory.cases
  readWrite on regulatory.workflow_tasks
  read on regulatory.case_documents

case-audit-user
  readWrite on regulatory.audit_events
  read on regulatory.cases

case-query-user
  read on regulatory.cases
  read on regulatory.case_search_projection
```

Ini mengurangi blast radius.

---

## 19. Failure Mode 1: Primary Down

Scenario:

```text
primary node crashes
```

What happens:

```text
1. secondaries detect primary unavailable
2. election starts
3. one secondary becomes new primary
4. driver discovers topology change
5. writes route to new primary
```

Application symptoms:

- temporary write failures;
- increased latency;
- server selection timeout;
- transient transaction errors;
- unknown commit result;
- retryable write attempts;
- logs mentioning topology change.

Bad application behavior:

- infinite retry loop;
- duplicate business command execution;
- user sees success though write failed;
- health check marks service dead too aggressively;
- thread pool exhausted waiting on DB.

Better behavior:

- bounded retry for transient categories;
- idempotency key;
- clear error mapping;
- expose “try again” for user-safe operations;
- queue command only if command processing semantics are designed;
- metrics and alerts.

---

## 20. Failure Mode 2: Secondary Lag

Scenario:

```text
secondary is behind primary
```

If app reads from secondary:

```text
write case status = APPROVED on primary
immediate read from secondary returns UNDER_REVIEW
```

Potential incident:

- user submits transition twice;
- UI shows stale status;
- workflow engine makes decision on old data;
- report inconsistent;
- authorization check stale.

Mitigation:

- use primary reads for consistency-sensitive paths;
- use causal consistency/session when needed;
- use majority read concern where appropriate;
- tolerate staleness only for explicitly stale-safe features;
- expose data freshness for dashboards.

Rule:

```text
Secondary read is not a free performance optimization. It is a consistency trade-off.
```

---

## 21. Failure Mode 3: Network Partition

Scenario:

```text
app can reach some nodes but not others
nodes can reach each other partially
```

Possible symptoms:

- driver sees no primary;
- one AZ unavailable;
- writes fail;
- reads from reachable secondary may still work depending read preference;
- election happens;
- latency spikes.

Design considerations:

- deploy replica set across failure domains carefully;
- avoid split-brain assumptions;
- tune timeouts;
- understand majority requirement;
- do not hide write failures as success.

Regulatory systems must be especially careful: availability degradation is acceptable; silent inconsistency is not.

---

## 22. Failure Mode 4: Write Retry and Duplicate Business Intent

MongoDB retryable writes help at driver/protocol level. Business operations still need idempotency.

Example command:

```text
Escalate CASE-1 to level L2 because high risk
```

Bad implementation:

```javascript
db.cases.updateOne(
  { _id: "CASE-1" },
  {
    $set: { status: "ESCALATED" },
    $push: { events: { type: "ESCALATED", at: new Date() } }
  }
)
```

If user double-clicks or service retries at wrong layer, duplicate event may appear.

Better:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-1",
    status: "UNDER_REVIEW",
    processedCommandIds: { $ne: "CMD-123" }
  },
  {
    $set: { status: "ESCALATED" },
    $addToSet: { processedCommandIds: "CMD-123" },
    $push: {
      events: {
        commandId: "CMD-123",
        type: "ESCALATED",
        at: new Date()
      }
    },
    $inc: { version: 1 }
  }
)
```

Even better for unbounded command history: separate idempotency/command collection with unique index.

---

## 23. Failure Mode 5: Sharded Scatter-Gather Surprise

Scenario:

Query works fine in development with small data.

```javascript
db.cases.find({ status: "OPEN" }).sort({ createdAt: -1 }).limit(50)
```

In production sharded cluster:

```text
mongos sends query to every shard
each shard sorts/returns candidates
mongos merges
latency unpredictable
```

Mitigation:

- include shard key prefix where possible;
- design query-specific compound indexes;
- create tenant-scoped query patterns;
- use search/projection collection;
- avoid arbitrary global operational search without dedicated architecture.

---

## 24. Failure Mode 6: Dev/Prod Topology Mismatch

Development:

```text
localhost standalone
small dataset
no auth
no TLS
no replication
no sharding
no latency
```

Production:

```text
Atlas/self-managed cluster
TLS/auth
replica set/sharded cluster
cross-AZ network
real indexes
large data
failover
backups
monitoring
```

Symptoms when mismatch is ignored:

- integration tests pass, production fails under election;
- transaction code fails because local standalone not configured as replica set;
- query passes locally but scans millions in production;
- connection string works locally but DNS/TLS fails in deployment;
- app cannot resolve internal hostnames returned by replica set members;
- load test misses secondary lag and failover.

Best practice:

```text
Local can be simple.
CI/integration should be topology-aware.
Pre-prod should mimic production semantics.
```

---

## 25. Mapping Architecture to Application Decisions

| Architecture Concept | Application Consequence |
|---|---|
| Collection | Repository boundary, index ownership, schema validation, retention policy |
| Document | Atomic update boundary, aggregate design, Java mapping |
| Replica set | Retry, failover, read/write concern, stale read risk |
| Primary | Write target, consistency-sensitive read target |
| Secondary | Read scaling with staleness trade-off |
| Oplog | Replication, change streams, lag considerations |
| Shard | Data distribution, throughput/storage scale |
| Shard key | Routing, data placement, hotspot risk |
| `mongos` | Query router, app endpoint for sharded cluster |
| Config server | Cluster metadata dependency |
| Connection pool | Latency/concurrency resource boundary |
| Server selection | Failure mode visible to Java app |

---

## 26. Practical Architecture Diagrams

### 26.1 Single Node Local Development

```text
+-------------------+
| Java Application  |
+---------+---------+
          |
          v
+-------------------+
| mongod standalone |
+-------------------+
```

Good for:

- syntax learning;
- local CRUD;
- simple repository test.

Not enough for:

- failover;
- production transaction behavior;
- read preference;
- replication lag;
- sharding.

### 26.2 Replica Set Production

```text
+-------------------+
| Java Application  |
+---------+---------+
          |
          v
+-------------------------------+
| MongoDB Driver                |
| topology discovery + pool     |
+----+--------------+-----------+
     |              |
     v              v
+----------+   +-----------+   +-----------+
| PRIMARY  |   | SECONDARY |   | SECONDARY |
| mongod   |   | mongod    |   | mongod    |
+----------+   +-----------+   +-----------+
```

Write:

```text
app -> driver -> primary
```

Default read:

```text
app -> driver -> primary
```

Secondary read if configured:

```text
app -> driver -> secondary
```

### 26.3 Sharded Cluster

```text
+-------------------+
| Java Application  |
+---------+---------+
          |
          v
+-------------------+
| mongos router(s)  |
+----+---------+----+
     |         |
     v         v
+-------------------+
| config server RS  |
+-------------------+
     |
     +----------------------+----------------------+
                            |                      |
                            v                      v
                    +---------------+      +---------------+
                    | shard01 RS    |      | shard02 RS    |
                    | P/S/S mongod  |      | P/S/S mongod  |
                    +---------------+      +---------------+
```

Targeted query:

```text
app -> mongos -> one shard
```

Scatter-gather:

```text
app -> mongos -> all shards -> merge
```

---

## 27. Production Readiness Questions

Sebelum menyatakan desain MongoDB siap production, jawab pertanyaan berikut.

### 27.1 Logical Data Questions

1. Apa collection utama?
2. Apa aggregate root tiap collection?
3. Apa document yang bisa tumbuh tanpa batas?
4. Apa field yang selalu ada?
5. Apa field yang optional/evolving?
6. Apa schema version strategy?
7. Apa retention policy tiap collection?
8. Apa security classification tiap collection?

### 27.2 Query/Index Questions

1. Query apa yang paling sering?
2. Query apa yang paling mahal?
3. Query mana yang user-facing synchronous?
4. Query mana yang background/reporting?
5. Index apa yang mendukung setiap query utama?
6. Apakah query sort didukung index?
7. Apakah pagination berbasis skip atau seek?
8. Apakah ada query regex/dynamic search yang perlu search engine?

### 27.3 Replica Set Questions

1. Apa write concern default?
2. Apa read concern default?
3. Apakah aplikasi pernah read dari secondary?
4. Feature mana yang stale-safe?
5. Apa retry policy?
6. Bagaimana idempotency dijaga?
7. Apa yang terjadi saat primary failover?
8. Apakah integration test mencakup failover?

### 27.4 Sharding Questions

1. Apakah data benar-benar perlu sharding?
2. Apa shard key candidate?
3. Apakah query utama menyertakan shard key?
4. Apakah write distribution seimbang?
5. Apakah ada monotonic hotspot?
6. Apakah tenant isolation butuh zone/placement?
7. Apakah transaksi lintas shard bisa muncul?
8. Apa konsekuensi shard key terhadap unique constraint?

### 27.5 Java Runtime Questions

1. Apakah `MongoClient` singleton/long-lived?
2. Berapa max pool size?
3. Apa timeout values?
4. Apakah `appName` diset?
5. Apakah command monitoring aktif?
6. Apakah metrics connection pool diekspor?
7. Apakah error mapping jelas?
8. Apakah health check terlalu agresif?

---

## 28. Minimal Java Configuration Mental Model

Contoh konfigurasi konseptual, bukan final best practice universal:

```java
ConnectionString connectionString = new ConnectionString(
    "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/regulatory" +
    "?replicaSet=rs0" +
    "&retryWrites=true" +
    "&w=majority" +
    "&appName=regulatory-case-service"
);

MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(connectionString)
    .applyToConnectionPoolSettings(builder -> builder
        .maxSize(100)
        .minSize(5)
        .maxWaitTime(2, TimeUnit.SECONDS))
    .applyToClusterSettings(builder -> builder
        .serverSelectionTimeout(3, TimeUnit.SECONDS))
    .applyToSocketSettings(builder -> builder
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS))
    .build();

MongoClient client = MongoClients.create(settings);
```

Hal penting:

- angka timeout/pool harus disesuaikan workload;
- jangan copy tanpa memahami latency budget;
- `w=majority` bagus untuk durability, tetapi latency perlu diukur;
- pool besar bukan selalu lebih baik;
- timeout terlalu panjang dapat menahan thread terlalu lama;
- timeout terlalu pendek dapat membuat false failure.

---

## 29. Architecture Smells

### 29.1 Smell: “Kami Pakai MongoDB karena Tidak Perlu Schema”

Masalah:

- schema tetap ada, hanya tidak selalu enforced di tempat yang sama;
- tanpa governance, data quality memburuk;
- migration makin sulit;
- aplikasi harus menangani terlalu banyak variasi.

Better framing:

```text
MongoDB gives flexible schema evolution, not schema nihilism.
```

### 29.2 Smell: “Semua Read Kita Arahkan ke Secondary”

Masalah:

- stale reads;
- read-your-writes hilang;
- decision bisa salah;
- bug sulit direproduksi.

Better framing:

```text
Only stale-tolerant reads should use secondary preference.
```

### 29.3 Smell: “Kita Shard Saja Biar Cepat”

Masalah:

- shard key salah membuat cluster mahal tapi lambat;
- query tanpa shard key scatter-gather;
- operational complexity naik.

Better framing:

```text
Shard when workload and shard key justify distribution.
```

### 29.4 Smell: “Semua Service Boleh Tulis Collection yang Sama”

Masalah:

- invariant tersebar;
- audit sulit;
- debugging sulit;
- schema evolution kacau;
- ownership tidak jelas.

Better framing:

```text
Shared read is manageable. Shared write needs strong ownership protocol.
```

### 29.5 Smell: “Local Test Sudah Cukup”

Masalah:

- failover tidak diuji;
- replication tidak diuji;
- transaction topology tidak diuji;
- performance tidak realistis.

Better framing:

```text
Local verifies syntax. Topology-aware tests verify production behavior.
```

---

## 30. Case Study: Regulatory Case Management Topology

Bayangkan platform enforcement lifecycle:

```text
case-command-service
case-query-service
case-worker-service
case-audit-service
case-document-service
```

Collections:

```text
cases
case_documents
case_notes
audit_events
workflow_tasks
case_search_projection
```

### 30.1 Initial Production Topology

Jika volume sedang dan belum butuh sharding:

```text
Replica Set rs0
  ├── primary in AZ-A
  ├── secondary in AZ-B
  └── secondary in AZ-C
```

Application:

```text
all writes -> primary
consistency-sensitive reads -> primary
analytics/dashboard reads -> maybe secondary, explicitly stale-tolerant
```

Write concern:

```text
majority for critical case state and audit events
```

### 30.2 Query Patterns

Case detail:

```javascript
db.cases.findOne({ _id: "CASE-2026-000001", tenantId: "TENANT-A" })
```

Reviewer work queue:

```javascript
db.cases.find({
  tenantId: "TENANT-A",
  status: "UNDER_REVIEW",
  "assignedTo.userId": "USR-212"
}).sort({ priority: -1, updatedAt: -1 })
```

Audit timeline:

```javascript
db.audit_events.find({
  tenantId: "TENANT-A",
  caseId: "CASE-2026-000001"
}).sort({ occurredAt: 1 })
```

### 30.3 When Sharding Might Be Needed

Sharding bisa masuk akal jika:

- jumlah tenant besar;
- case volume sangat tinggi;
- audit_events sangat besar;
- write throughput melebihi satu replica set;
- data residency butuh placement;
- tenant isolation butuh zone.

Candidate shard keys:

```text
{ tenantId: 1, caseId: 1 }
{ tenantId: 1, occurredAt: 1 }
{ tenantId: 1, assignedRegion: 1, caseId: 1 }
```

Tapi ini harus dievaluasi terhadap query dan write distribution.

### 30.4 Regulatory Defensibility

Untuk sistem regulatori, arsitektur harus mendukung:

- audit trail durability;
- clear state transition record;
- restore ability;
- access control;
- retention/legal hold;
- deterministic decision reconstruction;
- incident investigation.

MongoDB bisa mendukung ini, tetapi hanya jika schema, write concern, audit model, dan operational process dirancang dengan disiplin.

---

## 31. Mental Model Ringkas

### 31.1 Logical Hierarchy

```text
Database -> Collection -> Document -> Field
```

### 31.2 Runtime Hierarchy

```text
Java App -> Driver -> Server Selection -> mongod/mongos
```

### 31.3 Replica Set Hierarchy

```text
Replica Set -> Primary + Secondaries -> Oplog Replication -> Election
```

### 31.4 Sharded Cluster Hierarchy

```text
Sharded Cluster -> mongos + config servers + shard replica sets
```

### 31.5 Decision Hierarchy

```text
Access pattern -> document shape -> collection design -> indexes -> topology -> consistency settings
```

Jangan dibalik menjadi:

```text
install MongoDB -> create collections -> hope queries work
```

---

## 32. Checklist: Apa yang Harus Kamu Ingat dari Part Ini

Kamu harus bisa menjawab dengan percaya diri:

1. Apa beda database, collection, dan document?
2. Kenapa collection bukan sekadar table?
3. Kenapa document adalah atomicity/locality boundary?
4. Apa itu `mongod`?
5. Apa beda standalone dan replica set?
6. Apa fungsi primary dan secondary?
7. Apa itu election?
8. Apa itu oplog secara mental model?
9. Apa risiko read dari secondary?
10. Apa itu `mongos`?
11. Apa fungsi config server?
12. Apa itu shard?
13. Apa beda replication dan sharding?
14. Apa itu targeted query vs scatter-gather?
15. Kenapa shard key adalah keputusan arsitektur besar?
16. Kenapa Java driver topology discovery penting?
17. Kenapa `MongoClient` harus long-lived?
18. Apa failure mode saat primary down?
19. Apa failure mode saat secondary lag?
20. Apa bahaya dev/prod topology mismatch?

---

## 33. Latihan Mental Model

### Latihan 1 — Classify Collections

Diberikan domain:

```text
Case
CaseParty
CaseDocument
CaseNote
CaseAuditEvent
CaseTask
CaseDecision
```

Tentukan mana yang kemungkinan:

- embedded di `cases`;
- collection sendiri;
- projection sendiri;
- append-only log;
- candidate time-series/audit style.

Jangan jawab dari nama entity. Jawab dari:

- growth;
- access pattern;
- ownership;
- retention;
- consistency;
- indexing.

### Latihan 2 — Read Preference Decision

Untuk setiap operasi, tentukan apakah aman membaca dari secondary:

1. User membuka dashboard jumlah case per status.
2. User baru saja approve case lalu redirect ke detail page.
3. Worker mengecek apakah task masih claimable.
4. Auditor membuka laporan historis bulan lalu.
5. API mengecek apakah user boleh melakukan escalation.

Jawaban yang baik harus menyebut stale tolerance.

### Latihan 3 — Sharding Risk

Collection `audit_events` punya 2 miliar document.

Query utama:

```javascript
db.audit_events.find({
  tenantId: "TENANT-A",
  caseId: "CASE-1"
}).sort({ occurredAt: 1 })
```

Query dashboard:

```javascript
db.audit_events.find({
  tenantId: "TENANT-A",
  occurredAt: { $gte: start, $lt: end }
})
```

Candidate shard key:

```text
{ caseId: 1 }
{ tenantId: 1, caseId: 1 }
{ tenantId: 1, occurredAt: 1 }
{ occurredAt: 1 }
```

Diskusikan trade-off. Tidak ada jawaban tunggal tanpa workload distribution.

### Latihan 4 — Failure Handling

Primary failover terjadi saat user submit transition:

```text
UNDER_REVIEW -> APPROVED
```

Apa yang harus dijaga?

- user feedback;
- duplicate prevention;
- audit event;
- retry behavior;
- final state certainty;
- observability.

---

## 34. Jebakan Wawancara dan Review Arsitektur

### Pertanyaan 1

> “Apakah MongoDB collection sama dengan table?”

Jawaban matang:

Collection adalah container document seperti table adalah container row, tetapi desainnya tidak semestinya satu-ke-satu. Collection sebaiknya merepresentasikan document dengan lifecycle, access pattern, growth, indexing, retention, dan ownership yang serupa. Jika kita membuat collection per class seperti table per entity, kita sering kehilangan benefit document locality dan single-document atomicity.

### Pertanyaan 2

> “Kenapa read dari secondary bisa berbahaya?”

Jawaban matang:

Secondary dapat tertinggal dari primary karena replication asynchronous. Jika operasi membutuhkan read-your-writes, authorization correctness, workflow guard, atau state transition yang akurat, secondary read bisa menghasilkan keputusan berdasarkan data stale. Secondary read cocok untuk stale-tolerant workload seperti dashboard atau report tertentu.

### Pertanyaan 3

> “Apakah sharding membuat semua query lebih cepat?”

Jawaban matang:

Tidak. Sharding mendistribusikan data dan workload jika shard key mendukung routing dan distribusi. Query yang tidak menyertakan shard key bisa menjadi scatter-gather ke semua shard. Sharding menambah kompleksitas, dan shard key yang buruk dapat menyebabkan hotspot atau latency tidak stabil.

### Pertanyaan 4

> “Apa beda replica set dan shard?”

Jawaban matang:

Replica set menyimpan salinan dataset yang sama untuk high availability dan durability. Shard menyimpan subset dataset untuk horizontal scale. Dalam production sharded cluster, tiap shard biasanya berupa replica set, sehingga sharding dan replication saling melengkapi.

### Pertanyaan 5

> “Kenapa aplikasi Java perlu tahu topology?”

Jawaban matang:

Karena driver melakukan server selection berdasarkan topology. Failover, read preference, write concern, retryable writes, transaction behavior, dan connection pool semua bergantung pada topology. Aplikasi yang tidak topology-aware mudah gagal saat primary election, secondary lag, atau sharded scatter-gather.

---

## 35. Sumber Resmi untuk Pendalaman

Gunakan dokumentasi resmi MongoDB sebagai rujukan utama ketika mengecek detail versi:

- MongoDB Manual — Data Modeling
- MongoDB Manual — Replication
- MongoDB Manual — Replica Set Deployment Architectures
- MongoDB Manual — Sharding
- MongoDB Manual — Sharded Cluster Components
- MongoDB Manual — Config Servers
- MongoDB Manual — Routing with `mongos`
- MongoDB Manual — Read Concern
- MongoDB Manual — Write Concern
- MongoDB Java Driver Documentation

Catatan: fitur dan batasan bisa berubah antar versi MongoDB. Untuk keputusan production, selalu cek dokumentasi sesuai versi deployment yang digunakan.

---

## 36. Ringkasan Akhir

Part ini membangun dasar arsitektur MongoDB:

1. **Database** adalah namespace logical.
2. **Collection** adalah set document dengan shape/lifecycle/access pattern yang seharusnya serupa.
3. **Document** adalah unit utama data, locality, dan atomic update.
4. **`mongod`** adalah proses server yang menyimpan data dan menjalankan operasi database.
5. **Standalone** cocok untuk belajar, tetapi tidak mencerminkan production semantics.
6. **Replica set** menyediakan replication, high availability, primary election, dan read/write consistency choices.
7. **Secondary read** adalah trade-off consistency, bukan optimasi gratis.
8. **Sharded cluster** mendistribusikan data melalui shard, `mongos`, dan config server.
9. **Shard key** menentukan routing, distribusi, dan risiko hotspot.
10. **Java driver** bukan konektor pasif; ia melakukan topology discovery, server selection, retry, dan pool management.
11. **Failure mode** seperti primary down, secondary lag, network partition, dan scatter-gather harus menjadi bagian dari desain aplikasi.

Mental model paling penting:

```text
MongoDB design is not only document shape.
MongoDB design is document shape + access pattern + index + consistency + topology + failure behavior.
```

Jika kamu memahami ini, bagian berikutnya tentang CRUD, query, indexing, modelling, transactions, sharding, dan performance akan terasa jauh lebih masuk akal.

---

## 37. Status Seri

Selesai:

- Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool
- Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape
- Part 002 — BSON, JSON, Document Structure, and Type Semantics
- Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard

Belum selesai. Masih ada Part 004 sampai Part 035.

Part berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-004.md
```

Judul:

```text
Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — BSON, JSON, Document Structure, and Type Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-004.md">Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking ➡️</a>
</div>
