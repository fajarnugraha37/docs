# Part 23 — DynamoDB for Java Engineers

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> Bagian: `23 / 35`  
> Fokus: DynamoDB sebagai persistence boundary untuk Java cloud-native, Lambda, event-driven system, idempotency, high-scale access pattern, dan production operations.

---

## 1. Tujuan Bagian Ini

Setelah mempelajari bagian ini, targetnya bukan sekadar bisa melakukan `putItem()` dan `getItem()` dengan AWS SDK. Targetnya adalah mampu **mendesain model data DynamoDB yang benar**, mengintegrasikannya dengan Java secara production-grade, serta memahami konsekuensi arsitekturalnya terhadap consistency, latency, cost, throttling, idempotency, auditability, dan operability.

DynamoDB sering terlihat sederhana karena API dasarnya kecil: table, item, key, read, write, query, scan. Tetapi justru karena ia bukan relational database, kesalahan desain awal biasanya mahal. Di RDBMS, kita sering mulai dari entity model lalu mengoptimalkan query belakangan dengan index. Di DynamoDB, pola pikirnya berbeda: **mulai dari access pattern**, lalu bentuk primary key, sort key, index, conditional write, TTL, stream, dan capacity model mengikuti kebutuhan akses itu.

Bagian ini membahas DynamoDB dari sudut Java engineer yang sudah paham backend, reliability, event-driven architecture, AWS SDK, Lambda, SQS/SNS, dan security. Jadi kita tidak mengulang dasar-dasar Java atau dasar-dasar HTTP/SDK yang sudah dibahas. Kita akan fokus pada mental model dan desain implementasi.

Rujukan resmi utama:

- AWS SDK for Java 2.x menyediakan contoh dan dokumentasi untuk bekerja dengan DynamoDB, termasuk table, item, dan Enhanced Client.  
  <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/examples-dynamodb.html>
- DynamoDB Enhanced Client adalah high-level API di SDK Java 2.x untuk mapping Java object ke item DynamoDB, penerus `DynamoDBMapper` dari SDK v1.  
  <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/dynamodb-enhanced-client.html>
- DynamoDB conditional write memungkinkan operasi write hanya berhasil jika kondisi item terpenuhi; ini fundamental untuk idempotency dan optimistic concurrency.  
  <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html>
- DynamoDB partition key best practices menekankan distribusi workload agar tidak menciptakan hot partition.  
  <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html>
- Global Secondary Index digunakan untuk query access pattern alternatif dari base table.  
  <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html>
- DynamoDB TTL menghapus item expired secara otomatis tanpa menggunakan write throughput untuk delete tersebut.  
  <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html>
- DynamoDB read consistency membedakan eventually consistent read dan strongly consistent read.  
  <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html>
- Powertools for AWS Lambda Java menyediakan utility idempotency yang umum memakai DynamoDB sebagai persistence store.  
  <https://docs.aws.amazon.com/powertools/java/latest/utilities/idempotency/>

---

## 2. Posisi DynamoDB dalam Arsitektur Java AWS

DynamoDB adalah managed NoSQL key-value dan document database. Dari sudut aplikasi Java, DynamoDB biasanya muncul dalam beberapa peran:

1. **Primary operational store** untuk workload low-latency, high-scale, access-pattern-defined.
2. **Idempotency store** untuk Lambda, SQS consumer, event handler, API command handler.
3. **State store** untuk workflow ringan, saga state, job state, deduplication state.
4. **Projection store** untuk read model event-driven system.
5. **Metadata store** untuk object di S3.
6. **Lock/lease store** untuk koordinasi ringan, walaupun harus hati-hati karena DynamoDB bukan distributed lock silver bullet.
7. **Inbox/outbox support store** untuk event processing.
8. **TTL-backed ephemeral store** untuk token, cache metadata, temporary correlation, retry suppression.

DynamoDB cocok ketika:

- Access pattern bisa didefinisikan jelas.
- Query utama berbasis key, bukan join kompleks.
- Skala throughput dan latency lebih penting daripada fleksibilitas query ad-hoc.
- Data model bisa didenormalisasi.
- Aplikasi butuh conditional write atomik pada item.
- Workload event-driven membutuhkan deduplication/idempotency cepat.
- Operasi harus tetap stabil saat traffic naik tajam.

DynamoDB kurang cocok ketika:

- Query ad-hoc sangat banyak dan berubah-ubah.
- Membutuhkan join kompleks antar banyak entity.
- Membutuhkan relational constraint lintas entity secara kuat.
- Membutuhkan aggregate analytical query besar secara langsung dari OLTP store.
- Tim belum bisa mendefinisikan access pattern dan tetap ingin “database fleksibel dulu, optimasi nanti”.

Mental model utama:

```text
RDBMS mindset:
  Entity model -> normalize -> SQL query -> index optimization

DynamoDB mindset:
  Access pattern -> key design -> item shape -> index design -> capacity/failure model
```

Kesalahan paling umum adalah membawa mental model relational ke DynamoDB:

- Membuat satu table per entity tanpa memikirkan query.
- Mengandalkan `Scan` untuk list screen.
- Membuat GSI setelah production karena access pattern tidak dipikirkan.
- Memakai UUID random sebagai partition key untuk semua hal tanpa sort key yang bermakna.
- Menyimpan item besar tanpa memperhatikan limit, biaya, dan read amplification.
- Menganggap conditional write sama dengan transaction penuh RDBMS.
- Menganggap DynamoDB “serverless” berarti tidak perlu capacity dan partition thinking.

---

## 3. DynamoDB Bukan RDBMS, Bukan Cache, Bukan Queue

### 3.1 Bukan RDBMS

DynamoDB tidak didesain untuk join. Ia tidak memaksa schema relational antar table. Ia tidak memberi foreign key. Ia tidak memberi SQL optimizer untuk memilih execution plan terbaik dari query arbitrer.

Itu bukan kekurangan jika masalahnya cocok. Itu trade-off. Dengan membatasi query model, DynamoDB bisa memberi latency dan scaling behavior yang sangat predictable.

Konsekuensi bagi Java engineer:

- Jangan mulai dari class diagram domain lalu otomatis mapping ke table.
- Jangan menjadikan setiap aggregate/entity sebagai table default.
- Jangan mengejar normalisasi tinggi jika access pattern butuh satu query cepat.
- Jangan takut duplikasi data jika duplikasi itu disengaja, versioned, dan punya update strategy.

### 3.2 Bukan Cache

DynamoDB bisa cepat, tetapi bukan cache in-memory seperti Redis. DynamoDB adalah durable operational database. TTL bukan eviction policy real-time. TTL delete bersifat asynchronous. Item expired bisa masih terlihat beberapa waktu sebelum dihapus oleh background process.

Konsekuensi:

- Jika butuh expiration strict, aplikasi harus memeriksa `expiresAt` sendiri saat read.
- Jangan mengandalkan TTL sebagai mekanisme authorization expiry yang presisi.
- Gunakan DynamoDB untuk durable state/idempotency, bukan hot volatile cache yang membutuhkan sub-millisecond latency.

### 3.3 Bukan Queue

DynamoDB Streams bisa memancarkan perubahan item, tetapi DynamoDB bukan queue replacement. Queue seperti SQS memberi visibility timeout, long polling, DLQ, retry semantics, dan consumer isolation. DynamoDB Streams memberi ordered change records per shard, cocok untuk CDC/projection/trigger, bukan general-purpose work queue.

Konsekuensi:

- Untuk work dispatch, gunakan SQS/EventBridge/SNS sesuai semantics.
- Untuk change propagation dari state store, gunakan DynamoDB Streams.
- Untuk audit/event log domain yang harus replayable, pertimbangkan event store/outbox pattern, bukan hanya stream mentah.

---

## 4. Core Components: Table, Item, Attribute, Primary Key

### 4.1 Table

Table adalah container logical untuk item. Namun di desain DynamoDB modern, terutama single-table design, satu table bisa menyimpan banyak tipe item.

Contoh:

```text
Table: CasePlatform

Items:
  CASE#123                 metadata case
  CASE#123 / EVENT#001     event case
  CASE#123 / DOC#abc       document metadata
  USER#u1 / ASSIGN#123     officer assignment projection
  IDEMP#hash               idempotency record
```

Table bukan selalu entity. Table bisa menjadi **access-pattern container**.

### 4.2 Item

Item adalah record. Item bisa punya attribute berbeda dari item lain dalam table yang sama.

Contoh item case metadata:

```json
{
  "pk": "CASE#C-2026-0001",
  "sk": "META",
  "entityType": "CASE",
  "caseId": "C-2026-0001",
  "status": "UNDER_REVIEW",
  "createdAt": "2026-06-19T03:12:00Z",
  "version": 7
}
```

Contoh item event:

```json
{
  "pk": "CASE#C-2026-0001",
  "sk": "EVENT#2026-06-19T03:13:22.123Z#01J...",
  "entityType": "CASE_EVENT",
  "eventType": "CASE_ASSIGNED",
  "actorId": "OFFICER#123",
  "payload": "..."
}
```

### 4.3 Attribute

Attribute adalah field pada item. Tipe data DynamoDB meliputi string, number, binary, boolean, null, list, map, string set, number set, binary set.

Catatan penting untuk Java:

- DynamoDB number dikirim sebagai string representation agar presisi lintas bahasa terjaga.
- Hindari floating-point untuk uang/amount. Gunakan integer minor unit atau `BigDecimal` dengan policy jelas.
- Jangan menyimpan object Java serialized binary sebagai default. Itu buruk untuk evolusi schema dan debugging.
- Gunakan attribute eksplisit untuk field yang dipakai query/index/filter.

### 4.4 Primary Key

Primary key bisa:

1. **Simple primary key**: partition key saja.
2. **Composite primary key**: partition key + sort key.

Partition key menentukan distribusi data. Sort key menentukan urutan dan grouping dalam partition.

Model paling fleksibel biasanya composite key:

```text
pk = CASE#<caseId>
sk = META
sk = EVENT#<timestamp>#<eventId>
sk = DOC#<documentId>
sk = TASK#<taskId>
```

Dengan bentuk ini, kita bisa query:

- Ambil metadata case: `pk = CASE#id AND sk = META`
- Ambil semua event case: `pk = CASE#id AND begins_with(sk, EVENT#)`
- Ambil semua dokumen case: `pk = CASE#id AND begins_with(sk, DOC#)`
- Ambil timeline case: `pk = CASE#id` lalu urut berdasarkan `sk`

---

## 5. Access-Pattern-First Design

Pertanyaan pertama DynamoDB bukan “entity apa saja?”, tetapi:

> “Screen/API/worker apa saja yang harus membaca/menulis data, dengan key apa, urutan apa, cardinality berapa, latency berapa, dan consistency apa?”

Template access pattern:

```text
AP-001
Name: Get case by caseId
Caller: Case detail API
Input: caseId
Operation: GetItem
Key: pk=CASE#<caseId>, sk=META
Consistency: strongly consistent if immediately after write required
Expected size: 1 item
Latency target: p95 < 30 ms service-side + network
Failure action: return 404 or retry transient

AP-002
Name: List documents for case
Caller: Case document tab
Input: caseId
Operation: Query
Key: pk=CASE#<caseId>, sk begins_with DOC#
Consistency: eventually consistent acceptable
Expected size: 0-500 items
Pagination: yes

AP-003
Name: Find cases assigned to officer by status
Caller: Officer dashboard
Input: officerId, status
Operation: Query GSI1
GSI1PK: OFFICER#<officerId>#STATUS#<status>
GSI1SK: DUE#<dueDate>#CASE#<caseId>
Consistency: eventually consistent only because GSI does not support strongly consistent reads
Pagination: yes
```

Access pattern harus mencakup:

- Siapa caller-nya.
- Input query yang tersedia.
- Apakah butuh exact item atau list.
- Sort order.
- Filter yang benar-benar harus terjadi di key condition, bukan filter expression setelah read.
- Cardinality maksimum.
- Konsistensi yang dibutuhkan.
- Pagination behavior.
- Write/update path yang menjaga projection/index tetap benar.
- Error handling.
- Cost implication.

### 5.1 Query vs Scan

`Query` mencari item berdasarkan partition key dan optional sort key condition. Ini operasi utama DynamoDB.

`Scan` membaca banyak/semua item table/index. Scan bukan selalu haram, tetapi biasanya tidak boleh menjadi request path user-facing untuk data besar.

Gunakan `Scan` hanya untuk:

- Admin one-off kecil.
- Background migration dengan rate limiting.
- Backfill controlled.
- Diagnostics terbatas.
- Table kecil yang memang bounded dan non-critical.

Jangan gunakan `Scan` untuk:

- Dashboard production.
- Search/filter user-facing.
- API list besar.
- Polling worker.
- Report OLAP.

### 5.2 Filter Expression Bukan Index

Filter expression dievaluasi setelah DynamoDB membaca item dari key condition. Artinya filter tidak mengurangi read capacity untuk item yang sudah dibaca dari partition/index. Banyak engineer salah mengira filter expression seperti `WHERE` SQL yang dapat memakai optimizer.

Mental model:

```text
SQL WHERE with index:
  Database may use index to avoid reading irrelevant rows.

DynamoDB Query + FilterExpression:
  Read matching key condition first, then discard non-matching items.
```

Jika filter membuang 99% item, desain key/index salah.

---

## 6. Partition Key Design and Hot Partition Avoidance

Partition key adalah salah satu keputusan paling penting. Tujuan utamanya:

1. Menentukan item grouping untuk query.
2. Mendistribusikan traffic ke physical partitions.
3. Menghindari hot key/hot partition.

AWS best practice menekankan desain partition key agar load tersebar efektif, karena partition key dipakai DynamoDB untuk distribusi data dan workload.

### 6.1 Good Partition Key

Partition key bagus jika:

- Cardinality tinggi.
- Traffic tersebar.
- Sesuai access pattern.
- Tidak membuat satu key menerima mayoritas write/read.
- Tidak membuat item collection tumbuh tanpa batas tak terkendali.

Contoh baik:

```text
CASE#<caseId>
USER#<userId>
ORDER#<orderId>
TENANT#<tenantId>#CASE#<caseId>
IDEMP#<hash>
JOB#<jobId>
```

Contoh berisiko:

```text
STATUS#PENDING
DATE#2026-06-19
TENANT#largeTenant
GLOBAL_COUNTER
ALL_CASES
```

Kenapa berisiko?

- `STATUS#PENDING` bisa sangat hot.
- `DATE#today` membuat semua write hari ini masuk partition logical yang sama.
- `TENANT#largeTenant` bisa hot jika satu tenant sangat besar.
- `GLOBAL_COUNTER` menciptakan single hot item.

### 6.2 Write Sharding

Jika access pattern butuh key logical yang hot, gunakan sharding.

Contoh: ingin menyimpan event harian global.

Buruk:

```text
pk = EVENT_DATE#2026-06-19
sk = EVENT#timestamp#id
```

Lebih baik:

```text
pk = EVENT_DATE#2026-06-19#SHARD#00
pk = EVENT_DATE#2026-06-19#SHARD#01
...
pk = EVENT_DATE#2026-06-19#SHARD#31
```

Write memilih shard berdasarkan hash event id.

Trade-off:

- Write tersebar.
- Read global per hari harus query semua shard dan merge hasil.
- Pagination lebih kompleks.
- Ordering global tidak natural.

Untuk top-tier engineer, ini bukan sekadar “pakai random shard”. Harus ditentukan:

- Jumlah shard awal.
- Cara menaikkan jumlah shard.
- Apakah shard count disimpan dalam config.
- Bagaimana reader tahu shard yang valid.
- Bagaimana paging across shards.
- Apakah ordering global benar-benar dibutuhkan.

### 6.3 Tenant-Aware Key Design

Multi-tenant system sering tergoda membuat:

```text
pk = TENANT#<tenantId>
sk = CASE#<caseId>
```

Ini bisa baik untuk tenant kecil, tetapi berbahaya jika ada tenant besar. Satu tenant besar bisa menjadi hot partition logical dan item collection sangat besar.

Alternatif:

```text
pk = TENANT#<tenantId>#CASE#<caseId>
sk = META
```

Untuk list by tenant, gunakan GSI dengan sharding:

```text
gsi1pk = TENANT#<tenantId>#CASE_SHARD#<00..15>
gsi1sk = CREATED#<createdAt>#CASE#<caseId>
```

Trade-off-nya: get by case cepat dan tersebar, list tenant perlu fan-out ke shard.

---

## 7. Sort Key Design

Sort key memberi kemampuan:

- Range query.
- Prefix query dengan `begins_with`.
- Ordered timeline.
- Hierarchical grouping.
- Multiple entity types dalam item collection.

Contoh sort key:

```text
META
EVENT#2026-06-19T03:13:22.123Z#01JXYZ
DOC#PASSPORT#doc123
TASK#DUE#2026-06-20#task987
STATE#2026-06-19T03:14:00Z
```

### 7.1 Lexicographical Order

Sort key string diurutkan lexicographically. Maka format harus sortable.

Baik:

```text
2026-06-19T03:13:22.123Z
000000000123
STATUS#OPEN#2026-06-19T00:00:00Z
```

Buruk:

```text
1, 2, 10 as string without padding -> 1, 10, 2
19-06-2026 -> not naturally sortable by year
June 19 2026 -> not machine-sortable
```

### 7.2 Prefix as Query Contract

Jika memakai prefix:

```text
sk = DOC#<docType>#<docId>
```

Maka prefix adalah contract. Jangan sembarangan ubah prefix karena reader, migration, index, dan operational tools bergantung padanya.

Pattern:

```text
Entity type prefix:
  META
  EVENT#...
  DOC#...
  TASK#...

Query:
  begins_with(sk, "DOC#")
```

### 7.3 Reverse Chronological Ordering

DynamoDB Query bisa `scanIndexForward=false` untuk sort descending. Untuk timestamp ISO-8601 ascending natural, cukup query descending.

Jika butuh custom reverse key, bisa gunakan inverted timestamp, tetapi ini menambah kompleksitas. Jangan lakukan kecuali benar-benar perlu.

---

## 8. Global Secondary Index and Local Secondary Index

### 8.1 GSI

Global Secondary Index adalah index dengan partition key dan sort key sendiri, berbeda dari base table. GSI dipakai untuk access pattern alternatif.

Contoh base table:

```text
pk = CASE#<caseId>
sk = META
```

Officer dashboard:

```text
gsi1pk = OFFICER#<officerId>#STATUS#<status>
gsi1sk = DUE#<dueDate>#CASE#<caseId>
```

Query:

```text
GSI1 where gsi1pk = OFFICER#123#STATUS#UNDER_REVIEW
order by due date
```

Penting:

- GSI punya throughput/capacity sendiri pada provisioned mode.
- Write ke base table juga memperbarui GSI jika item punya attribute index.
- GSI read hanya eventually consistent.
- GSI projection menentukan attribute apa yang tersedia dari index.
- GSI bisa menjadi bottleneck jika key-nya hot.

### 8.2 Sparse Index

GSI hanya berisi item yang memiliki attribute key index tersebut. Ini bisa dimanfaatkan sebagai sparse index.

Contoh hanya overdue task yang punya:

```text
gsi2pk = OVERDUE_TASKS
gsi2sk = DUE#<date>#TASK#<taskId>
```

Item yang tidak overdue tidak punya `gsi2pk`, sehingga tidak masuk GSI.

Sparse index cocok untuk:

- Pending task.
- Failed job.
- Active session.
- Case requiring action.
- Items needing retry.

### 8.3 LSI

Local Secondary Index memiliki partition key sama dengan base table, tetapi sort key berbeda. LSI harus dibuat saat table creation. Dalam banyak desain modern, GSI lebih sering dipakai karena lebih fleksibel, tetapi LSI berguna jika butuh alternate ordering dalam item collection yang sama.

### 8.4 Jangan Membuat GSI sebagai Pelarian dari Desain Buruk

GSI bukan magic. Setiap GSI:

- Menambah biaya write.
- Menambah storage.
- Menambah eventual consistency surface.
- Menambah operational concern.
- Bisa punya hot partition sendiri.
- Perlu schema evolution strategy.

Rule:

```text
1 GSI = 1 explicit access pattern family
```

Bukan:

```text
Tambah GSI karena query baru gagal.
```

---

## 9. Read Consistency

DynamoDB mendukung eventually consistent read dan strongly consistent read untuk table dan LSI. GSI hanya eventually consistent.

### 9.1 Eventually Consistent Read

Eventually consistent read biasanya lebih murah dan cukup untuk banyak UI/projection/list.

Cocok untuk:

- Dashboard yang toleran sedikit lag.
- List setelah background update.
- Projection event-driven.
- Read path yang tidak langsung bergantung pada write sebelumnya.

### 9.2 Strongly Consistent Read

Strongly consistent read memastikan read melihat write yang sudah berhasil sebelum read dimulai pada table/LSI yang sama.

Cocok untuk:

- Read-after-write critical.
- Command validation setelah update.
- Optimistic concurrency path.
- State transition check.

Namun:

- Tidak tersedia untuk GSI.
- Bisa lebih mahal dari eventually consistent read.
- Bukan pengganti desain transaksi yang benar.

### 9.3 Mental Model untuk Java Service

Jangan menjadikan semua read strongly consistent karena takut. Tentukan per access pattern.

Contoh:

```text
Get case detail immediately after update:
  maybe strong read for META item

Officer dashboard list:
  eventually consistent via GSI acceptable

Idempotency check:
  use conditional write, not read-then-write

State transition:
  use conditional update on current version/status
```

---

## 10. Write Semantics: Put, Update, Delete, Condition

### 10.1 PutItem

`PutItem` menulis item penuh. Secara default, jika key sudah ada, item lama diganti.

Untuk create-only, gunakan condition:

```text
attribute_not_exists(pk)
```

Contoh use case:

- Create case only if not exists.
- Create idempotency record only if not exists.
- Insert event only if event id belum ada.

### 10.2 UpdateItem

`UpdateItem` mengubah attribute tertentu. Bisa dipakai untuk:

- Set field.
- Remove field.
- Increment counter.
- Append list.
- Conditional state transition.

Contoh mental model:

```text
Update case status from SUBMITTED to UNDER_REVIEW only if current status is SUBMITTED and version = 3.
```

Expression:

```text
SET #status = :next, #version = #version + :one
WHERE #status = :expected AND #version = :currentVersion
```

### 10.3 DeleteItem

Delete bisa conditional juga.

Contoh:

- Delete lock only if owner token matches.
- Delete temporary state only if version matches.
- Delete assignment only if still assigned to same officer.

### 10.4 Conditional Write as Safety Primitive

Conditional write adalah salah satu fitur paling penting DynamoDB. Banyak correctness problem harus diselesaikan dengan conditional write, bukan read-before-write.

Buruk:

```text
1. Get item
2. If status == SUBMITTED
3. Update status to APPROVED
```

Race condition: dua worker bisa membaca status sama lalu sama-sama update.

Benar:

```text
Update status to APPROVED
Condition: status == SUBMITTED AND version == expectedVersion
```

Jika condition gagal, itu bukan always “technical error”. Itu bisa berarti:

- Duplicate command.
- State sudah berubah.
- Actor terlambat.
- Optimistic lock conflict.
- Request stale.

Java code harus membedakan `ConditionalCheckFailedException` dari network/server error.

---

## 11. Optimistic Locking and Versioning

Optimistic locking di DynamoDB biasanya memakai attribute `version`.

Item:

```json
{
  "pk": "CASE#C-1",
  "sk": "META",
  "status": "SUBMITTED",
  "version": 4
}
```

Update:

```text
SET status = :approved, version = version + 1
Condition: version = :expectedVersion AND status = :submitted
```

Jika update sukses, version naik. Jika gagal, caller harus memutuskan:

- Return conflict ke API client.
- Reload state dan retry jika command idempotent.
- Ignore jika desired final state sudah tercapai.
- Send to manual review jika state transition invalid.

### 11.1 Versioning Bukan Hanya untuk UI

Versioning berguna untuk:

- Prevent lost update.
- State machine integrity.
- Audit trail correlation.
- Idempotency replay decision.
- Debugging race condition.

### 11.2 State Transition Invariant

Untuk case management/regulatory workflow, jangan update status tanpa invariant.

Contoh invariant:

```text
Allowed:
  SUBMITTED -> UNDER_REVIEW
  UNDER_REVIEW -> APPROVED
  UNDER_REVIEW -> REJECTED
  REJECTED -> APPEALED

Not allowed:
  APPROVED -> SUBMITTED
  REJECTED -> APPROVED without appeal review
```

DynamoDB conditional write bisa menjaga invariant minimal:

```text
Condition: status IN (:allowedCurrentStatuses) AND version = :expectedVersion
```

Namun decision logic tetap di domain service. DynamoDB hanya enforcement atomik di write boundary.

---

## 12. Transactions in DynamoDB

DynamoDB mendukung transactional write/read untuk beberapa item. Ini berguna, tetapi harus dipakai selektif.

Use case:

- Create case metadata + initial event + assignment projection atomik.
- Update account balance-like invariant antar item kecil.
- Insert idempotency record + domain state dalam satu transaction.
- Ensure uniqueness via uniqueness marker item.

Contoh uniqueness marker:

```text
Item 1:
  pk = USER#123
  sk = META

Item 2:
  pk = UNIQUE#EMAIL#alice@example.com
  sk = MARKER
```

Create user transaction:

```text
Put USER#123 META if not exists
Put UNIQUE#EMAIL#alice@example.com if not exists
```

Jika email sudah dipakai, marker condition gagal.

Trade-off transaction:

- Lebih mahal.
- Lebih kompleks error handling.
- Bisa terkena transaction conflict.
- Tidak boleh dipakai untuk menggantikan desain aggregate boundary yang buruk.

Rule:

```text
Use transaction when correctness requires atomic multi-item change.
Do not use transaction just because relational intuition feels safer.
```

---

## 13. Capacity Modes, Cost, and Throttling

DynamoDB punya dua mode utama:

1. **On-demand**: kapasitas otomatis berdasarkan request, cocok untuk workload unpredictable atau early-stage.
2. **Provisioned**: tentukan RCU/WCU, bisa memakai auto scaling, cocok untuk workload predictable dan cost optimization.

### 13.1 Read Capacity and Write Capacity

Capacity dipengaruhi:

- Ukuran item.
- Strong vs eventual read.
- Jumlah item dibaca.
- Index yang ikut diupdate.
- Transactional operation.

Top-tier engineer harus bisa membaca cost sebagai bagian dari desain access pattern.

Contoh:

```text
Dashboard query membaca 500 item, masing-masing 10 KB, setiap refresh.
```

Ini bukan sekadar “query cepat atau lambat”. Ini:

- RCU cost.
- Network payload.
- Java heap allocation.
- Serialization/deserialization cost.
- UI pagination behavior.
- Hot partition risk.

### 13.2 Throttling

Throttling terjadi ketika request melebihi kapasitas/batas partition/table/index/account. SDK retry bisa membantu transient throttling, tetapi retry tanpa backpressure dapat memperburuk overload.

Tanda desain buruk:

- `ProvisionedThroughputExceededException` sering muncul.
- Latency spike saat traffic burst.
- Retry count naik tajam.
- GSI tertentu throttle padahal base table tidak.
- Satu tenant/user/status menyebabkan spike.

Mitigasi:

- Perbaiki partition key.
- Tambah write sharding.
- Gunakan on-demand atau naikkan provisioned capacity.
- Kurangi item size.
- Batch dengan bijak.
- Gunakan backpressure di Java worker.
- Pisahkan hot access pattern ke table/index khusus.
- Cache read yang aman jika pattern cocok.

---

## 14. Java SDK Client Choices

DynamoDB dengan AWS SDK for Java 2.x punya beberapa level:

1. `DynamoDbClient` — sync low-level client.
2. `DynamoDbAsyncClient` — async low-level client.
3. `DynamoDbEnhancedClient` — high-level object mapping sync.
4. `DynamoDbEnhancedAsyncClient` — high-level object mapping async.

### 14.1 Low-Level Client

Low-level client memakai `Map<String, AttributeValue>`.

Kelebihan:

- Kontrol penuh.
- Cocok untuk dynamic/single-table design yang item type-nya banyak.
- Mudah membuat expression kompleks.
- Tidak tersembunyi oleh mapper.

Kekurangan:

- Verbose.
- Rawan typo attribute name.
- Perlu mapper manual.

### 14.2 Enhanced Client

Enhanced Client memetakan Java class ke table item secara lebih idiomatis.

Kelebihan:

- Lebih nyaman untuk CRUD model jelas.
- Annotation/schema membantu mapping.
- Lebih type-safe.
- Mengurangi boilerplate.

Kekurangan:

- Bisa membuat engineer lupa access pattern dan key design.
- Single-table design polymorphic bisa lebih tricky.
- Abstraction dapat menyembunyikan expression/capacity detail jika tidak disiplin.

### 14.3 Rule of Thumb

Gunakan Enhanced Client untuk:

- Item type stabil.
- Mapping sederhana.
- Table-per-aggregate atau projection sederhana.
- Tim butuh maintainability dan type safety.

Gunakan low-level client untuk:

- Single-table design kompleks.
- Generic repository/gateway.
- Dynamic item shape.
- Advanced condition/update expression.
- Internal platform library.

Dalam top-tier codebase, sering ada kombinasi:

```text
Domain-specific gateway:
  public methods type-safe

Internal implementation:
  low-level DynamoDbClient for precise control
```

---

## 15. Maven/Gradle Dependency

Contoh Maven dengan BOM:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>bom</artifactId>
            <version>${aws.sdk.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>dynamodb</artifactId>
    </dependency>

    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>dynamodb-enhanced</artifactId>
    </dependency>
</dependencies>
```

Contoh Gradle Kotlin DSL:

```kotlin
dependencies {
    implementation(platform("software.amazon.awssdk:bom:<version>"))
    implementation("software.amazon.awssdk:dynamodb")
    implementation("software.amazon.awssdk:dynamodb-enhanced")
}
```

Untuk Java 8 sampai 25:

- SDK v2 mendukung Java 8+, tetapi runtime modern seperti Java 17/21/25 memberi benefit performa, TLS, GC, startup tuning, dan language ergonomics.
- Jika library internal harus kompatibel Java 8, hindari API Java 9+ di module core.
- Jika aplikasi berjalan di Java 21/25, tetap bisa memakai SDK v2 yang sama, tetapi tuning runtime berbeda.

---

## 16. Client Lifecycle

AWS SDK client harus dibuat sekali dan di-reuse.

Buruk:

```java
public CaseItem get(String caseId) {
    DynamoDbClient client = DynamoDbClient.create();
    // use client
}
```

Masalah:

- Connection pool tidak efektif.
- Credential/region resolution berulang.
- Resource leak.
- Latency tinggi.
- Thread/resource overhead.

Benar:

```java
public final class DynamoDbClients {
    private final DynamoDbClient client;

    public DynamoDbClients(Region region) {
        this.client = DynamoDbClient.builder()
                .region(region)
                .build();
    }

    public DynamoDbClient client() {
        return client;
    }

    public void close() {
        client.close();
    }
}
```

Dalam Spring Boot:

```java
@Bean
DynamoDbClient dynamoDbClient(AwsProperties props) {
    return DynamoDbClient.builder()
            .region(Region.of(props.region()))
            .build();
}
```

Untuk Lambda:

```java
public final class Handler implements RequestHandler<Input, Output> {
    private static final DynamoDbClient DDB = DynamoDbClient.builder().build();

    @Override
    public Output handleRequest(Input input, Context context) {
        // reuse DDB across warm invocations
    }
}
```

Catatan Lambda:

- Static initialization bisa memperbesar cold start.
- Tetapi client reuse penting untuk warm performance.
- Untuk SnapStart, pikirkan credential refresh dan network resource behavior sesuai best practice Lambda/SnapStart.

---

## 17. Example: Low-Level GetItem and PutItem

### 17.1 Model

```java
public record CaseRecord(
        String caseId,
        String status,
        long version,
        Instant createdAt
) {}
```

Untuk Java 8, gunakan class biasa:

```java
public final class CaseRecord {
    private final String caseId;
    private final String status;
    private final long version;
    private final Instant createdAt;

    public CaseRecord(String caseId, String status, long version, Instant createdAt) {
        this.caseId = caseId;
        this.status = status;
        this.version = version;
        this.createdAt = createdAt;
    }

    public String getCaseId() { return caseId; }
    public String getStatus() { return status; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
}
```

### 17.2 Key Helper

```java
final class CaseKeys {
    static String pk(String caseId) {
        return "CASE#" + requireNonBlank(caseId, "caseId");
    }

    static String metaSk() {
        return "META";
    }

    private static String requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

Untuk Java 8, `String.isBlank()` belum ada. Gunakan:

```java
value.trim().isEmpty()
```

### 17.3 Put Create-Only

```java
public void createCase(CaseRecord record) {
    Map<String, AttributeValue> item = new HashMap<>();
    item.put("pk", AttributeValue.fromS(CaseKeys.pk(record.caseId())));
    item.put("sk", AttributeValue.fromS(CaseKeys.metaSk()));
    item.put("entityType", AttributeValue.fromS("CASE"));
    item.put("caseId", AttributeValue.fromS(record.caseId()));
    item.put("status", AttributeValue.fromS(record.status()));
    item.put("version", AttributeValue.fromN(Long.toString(record.version())));
    item.put("createdAt", AttributeValue.fromS(record.createdAt().toString()));

    PutItemRequest request = PutItemRequest.builder()
            .tableName(tableName)
            .item(item)
            .conditionExpression("attribute_not_exists(pk) AND attribute_not_exists(sk)")
            .build();

    try {
        dynamoDb.putItem(request);
    } catch (ConditionalCheckFailedException e) {
        throw new DuplicateCaseException(record.caseId(), e);
    }
}
```

### 17.4 GetItem

```java
public Optional<CaseRecord> getCase(String caseId, boolean consistentRead) {
    Map<String, AttributeValue> key = Map.of(
            "pk", AttributeValue.fromS(CaseKeys.pk(caseId)),
            "sk", AttributeValue.fromS(CaseKeys.metaSk())
    );

    GetItemRequest request = GetItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .consistentRead(consistentRead)
            .build();

    GetItemResponse response = dynamoDb.getItem(request);
    if (!response.hasItem()) {
        return Optional.empty();
    }

    return Optional.of(mapCase(response.item()));
}

private CaseRecord mapCase(Map<String, AttributeValue> item) {
    return new CaseRecord(
            item.get("caseId").s(),
            item.get("status").s(),
            Long.parseLong(item.get("version").n()),
            Instant.parse(item.get("createdAt").s())
    );
}
```

Untuk Java 8, `Map.of` tidak tersedia. Gunakan `HashMap`.

---

## 18. Example: Conditional State Transition

```java
public CaseRecord transitionStatus(
        String caseId,
        String expectedStatus,
        long expectedVersion,
        String nextStatus,
        String actorId
) {
    Map<String, AttributeValue> key = Map.of(
            "pk", AttributeValue.fromS(CaseKeys.pk(caseId)),
            "sk", AttributeValue.fromS("META")
    );

    Map<String, String> names = Map.of(
            "#status", "status",
            "#version", "version",
            "#updatedAt", "updatedAt",
            "#updatedBy", "updatedBy"
    );

    Instant now = Instant.now();

    Map<String, AttributeValue> values = Map.of(
            ":expectedStatus", AttributeValue.fromS(expectedStatus),
            ":nextStatus", AttributeValue.fromS(nextStatus),
            ":expectedVersion", AttributeValue.fromN(Long.toString(expectedVersion)),
            ":one", AttributeValue.fromN("1"),
            ":updatedAt", AttributeValue.fromS(now.toString()),
            ":updatedBy", AttributeValue.fromS(actorId)
    );

    UpdateItemRequest request = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .updateExpression("SET #status = :nextStatus, #version = #version + :one, #updatedAt = :updatedAt, #updatedBy = :updatedBy")
            .conditionExpression("#status = :expectedStatus AND #version = :expectedVersion")
            .expressionAttributeNames(names)
            .expressionAttributeValues(values)
            .returnValues(ReturnValue.ALL_NEW)
            .build();

    try {
        UpdateItemResponse response = dynamoDb.updateItem(request);
        return mapCase(response.attributes());
    } catch (ConditionalCheckFailedException e) {
        throw new OptimisticConflictException(caseId, expectedStatus, expectedVersion, e);
    }
}
```

Kenapa ini bagus?

- Tidak ada read-then-write race.
- Status transition dijaga di write boundary.
- Version naik atomik.
- Caller mendapat item terbaru jika sukses.
- Conflict bisa dibedakan dari error teknis.

Namun ini belum cukup untuk audit trail jika regulatory requirement mengharuskan setiap transition dicatat. Untuk itu, gunakan transaction: update META + put EVENT item.

---

## 19. Example: Transactional Case Transition + Event Append

```java
public void transitionWithAuditEvent(
        String caseId,
        String expectedStatus,
        long expectedVersion,
        String nextStatus,
        String actorId,
        String commandId
) {
    Instant now = Instant.now();
    String eventId = UUID.randomUUID().toString();

    Map<String, AttributeValue> caseKey = Map.of(
            "pk", AttributeValue.fromS("CASE#" + caseId),
            "sk", AttributeValue.fromS("META")
    );

    Map<String, AttributeValue> eventItem = Map.of(
            "pk", AttributeValue.fromS("CASE#" + caseId),
            "sk", AttributeValue.fromS("EVENT#" + now + "#" + eventId),
            "entityType", AttributeValue.fromS("CASE_EVENT"),
            "eventType", AttributeValue.fromS("CASE_STATUS_CHANGED"),
            "fromStatus", AttributeValue.fromS(expectedStatus),
            "toStatus", AttributeValue.fromS(nextStatus),
            "actorId", AttributeValue.fromS(actorId),
            "commandId", AttributeValue.fromS(commandId),
            "createdAt", AttributeValue.fromS(now.toString())
    );

    Update updateCase = Update.builder()
            .tableName(tableName)
            .key(caseKey)
            .updateExpression("SET #status = :next, #version = #version + :one, #updatedAt = :now")
            .conditionExpression("#status = :expected AND #version = :version")
            .expressionAttributeNames(Map.of(
                    "#status", "status",
                    "#version", "version",
                    "#updatedAt", "updatedAt"
            ))
            .expressionAttributeValues(Map.of(
                    ":next", AttributeValue.fromS(nextStatus),
                    ":one", AttributeValue.fromN("1"),
                    ":now", AttributeValue.fromS(now.toString()),
                    ":expected", AttributeValue.fromS(expectedStatus),
                    ":version", AttributeValue.fromN(Long.toString(expectedVersion))
            ))
            .build();

    Put putEvent = Put.builder()
            .tableName(tableName)
            .item(eventItem)
            .conditionExpression("attribute_not_exists(pk) AND attribute_not_exists(sk)")
            .build();

    TransactWriteItemsRequest request = TransactWriteItemsRequest.builder()
            .transactItems(
                    TransactWriteItem.builder().update(updateCase).build(),
                    TransactWriteItem.builder().put(putEvent).build()
            )
            .clientRequestToken(commandId)
            .build();

    dynamoDb.transactWriteItems(request);
}
```

Catatan:

- `clientRequestToken` membantu idempotency pada transaction request.
- Event append dan state update atomik.
- Event sort key memakai timestamp + unique id.
- Untuk Java 8, ganti `Map.of` dengan mutable map builder.

---

## 20. Enhanced Client Example

### 20.1 Bean

```java
@DynamoDbBean
public class CaseItem {
    private String pk;
    private String sk;
    private String caseId;
    private String status;
    private Long version;
    private String createdAt;

    @DynamoDbPartitionKey
    public String getPk() {
        return pk;
    }

    public void setPk(String pk) {
        this.pk = pk;
    }

    @DynamoDbSortKey
    public String getSk() {
        return sk;
    }

    public void setSk(String sk) {
        this.sk = sk;
    }

    public String getCaseId() { return caseId; }
    public void setCaseId(String caseId) { this.caseId = caseId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }

    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
}
```

### 20.2 Table

```java
DynamoDbEnhancedClient enhancedClient = DynamoDbEnhancedClient.builder()
        .dynamoDbClient(dynamoDbClient)
        .build();

DynamoDbTable<CaseItem> caseTable = enhancedClient.table(
        tableName,
        TableSchema.fromBean(CaseItem.class)
);
```

### 20.3 Put with Condition

```java
public void createCaseEnhanced(CaseItem item) {
    PutItemEnhancedRequest<CaseItem> request = PutItemEnhancedRequest.builder(CaseItem.class)
            .item(item)
            .conditionExpression(Expression.builder()
                    .expression("attribute_not_exists(pk) AND attribute_not_exists(sk)")
                    .build())
            .build();

    caseTable.putItem(request);
}
```

### 20.4 Query by Partition

```java
public List<CaseItem> listCaseItems(String caseId) {
    QueryConditional condition = QueryConditional.keyEqualTo(
            Key.builder()
                    .partitionValue("CASE#" + caseId)
                    .build()
    );

    List<CaseItem> results = new ArrayList<>();
    caseTable.query(condition).items().forEach(results::add);
    return results;
}
```

Enhanced Client bisa sangat nyaman, tetapi tetap pastikan semua operation dipetakan ke access pattern yang eksplisit.

---

## 21. Pagination

DynamoDB query bisa mengembalikan hasil bertahap. Jangan desain API yang diam-diam membaca semua page tanpa limit.

Buruk:

```java
List<Item> all = new ArrayList<>();
for (Page<Item> page : table.query(condition)) {
    all.addAll(page.items());
}
return all;
```

Ini bisa membunuh latency, heap, dan cost.

Lebih baik:

```text
Request:
  limit = 50
  nextToken = optional

Response:
  items
  nextToken
```

DynamoDB memakai `LastEvaluatedKey`. API publik sebaiknya tidak expose key mentah tanpa proteksi. Encode sebagai opaque token.

Contoh isi token internal:

```json
{
  "pk": "CASE#C-1",
  "sk": "DOC#abc",
  "issuedAt": "2026-06-19T04:00:00Z"
}
```

Lalu encode Base64URL + sign/HMAC jika token keluar ke client. Jangan biarkan client memanipulasi pagination key untuk membaca data yang tidak berhak.

---

## 22. Batch Operations

DynamoDB mendukung batch get dan batch write.

### 22.1 BatchGetItem

Gunakan untuk mengambil banyak item by key.

Perhatikan:

- Bisa ada unprocessed keys.
- Harus retry dengan backoff.
- Hasil tidak selalu ordered sesuai input.
- Jangan batch terlalu besar di request path latency-sensitive tanpa timeout jelas.

### 22.2 BatchWriteItem

Batch write mendukung put/delete, bukan update condition kompleks.

Perhatikan:

- Tidak atomic across all items.
- Bisa ada unprocessed items.
- Harus retry unprocessed item.
- Tidak cocok untuk correctness yang membutuhkan condition.

Rule:

```text
Batch for throughput and efficiency.
Transaction/condition for correctness.
```

---

## 23. TTL Design

TTL memungkinkan item dihapus otomatis setelah timestamp epoch seconds tertentu.

Use case:

- Idempotency record expiry.
- Temporary token/session metadata.
- Retry suppression record.
- Short-lived lock/lease marker.
- Cache metadata yang durable.

Item:

```json
{
  "pk": "IDEMP#abc123",
  "sk": "META",
  "status": "COMPLETED",
  "resultHash": "...",
  "expiresAt": 1781836800
}
```

Penting:

- TTL delete tidak real-time.
- Expired item bisa tetap muncul sebelum dihapus.
- Aplikasi harus treat expired item sebagai tidak valid jika expiry strict.
- TTL delete bisa muncul di stream sebagai service delete, tergantung konfigurasi/region behavior yang harus diverifikasi untuk use case.

Pattern read:

```java
boolean isExpired(long expiresAtEpochSeconds, Clock clock) {
    return expiresAtEpochSeconds <= clock.instant().getEpochSecond();
}
```

Jangan hanya mengandalkan item hilang.

---

## 24. DynamoDB Streams

DynamoDB Streams menangkap perubahan item. Stream record bisa diproses Lambda untuk:

- Build projection.
- Publish event ke EventBridge/SNS.
- Sync ke OpenSearch.
- Maintain aggregate read model.
- Trigger downstream workflow.

Stream event types:

- INSERT
- MODIFY
- REMOVE

Stream view types:

- Keys only.
- New image.
- Old image.
- New and old images.

### 24.1 Streams Are Not Domain Events by Default

Stream record adalah data-change event, bukan otomatis domain event.

Contoh stream:

```text
Item status changed from SUBMITTED to APPROVED
```

Domain event:

```text
CaseApprovedBySupervisor
with actor, reason, commandId, policyVersion, decision timestamp
```

Jika regulated workflow membutuhkan audit defensibility, jangan hanya mengandalkan stream diff. Simpan domain event/audit event eksplisit.

### 24.2 Stream Processing Failure

Saat Lambda memproses stream:

- Record bisa diproses ulang.
- Handler harus idempotent.
- Poison record bisa menahan shard progress.
- Batch failure strategy penting.
- Monitoring iterator age penting.

---

## 25. Idempotency Store Pattern

Dalam AWS event-driven systems, duplicate adalah normal. SQS at-least-once, SNS retry, Lambda retry, API client retry, network timeout after success — semua bisa menghasilkan duplicate processing.

Idempotency store menjawab:

> “Apakah command/event dengan idempotency key ini sudah pernah diproses? Jika sudah, apa hasilnya?”

### 25.1 Basic Idempotency Record

```json
{
  "pk": "IDEMP#<hash>",
  "sk": "META",
  "status": "IN_PROGRESS",
  "createdAt": "2026-06-19T04:00:00Z",
  "expiresAt": 1781836800,
  "requestHash": "sha256(...)",
  "responsePayload": null
}
```

Statuses:

```text
IN_PROGRESS
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
```

### 25.2 Acquire Idempotency Lock

Use conditional put:

```text
Put IDEMP#key
Condition: attribute_not_exists(pk)
```

Jika sukses, caller boleh memproses.

Jika condition gagal:

- Read record.
- Jika `COMPLETED`, return cached result atau no-op.
- Jika `IN_PROGRESS` belum expired, reject/skip/retry later.
- Jika `IN_PROGRESS` expired, attempt takeover dengan conditional update.
- Jika requestHash berbeda, reject sebagai idempotency key reuse conflict.

### 25.3 Complete

Set status to `COMPLETED` conditionally:

```text
Condition: status = IN_PROGRESS AND ownerToken = :owner
```

Kenapa owner token? Agar worker lama tidak menimpa hasil worker baru setelah timeout/takeover.

### 25.4 Powertools Java

Powertools for AWS Lambda Java menyediakan idempotency utility yang bisa mengubah Lambda handler menjadi idempotent operation dan sering memakai DynamoDB sebagai persistence layer. Ini berguna untuk Lambda standardization, tetapi engineer tetap harus memahami semantics-nya: idempotency key extraction, payload validation, expiration, in-progress expiry, dan result handling.

---

## 26. Outbox and Inbox Pattern with DynamoDB

### 26.1 Inbox

Inbox mencegah duplicate event processing.

Item:

```text
pk = INBOX#<consumerName>#<eventId>
sk = META
```

Saat consumer menerima event:

```text
Put inbox marker if not exists.
If success -> process.
If exists -> duplicate, skip.
```

Jika process dan marker write harus atomik dengan state update, gunakan transaction.

### 26.2 Outbox

Outbox memastikan state change dan event-to-publish tercatat atomik.

Transaction:

```text
Update domain item
Put outbox item status=PENDING
Put audit event
```

Publisher worker:

```text
Query pending outbox by GSI
Publish to SNS/EventBridge
Mark outbox published conditionally
```

Outbox item:

```json
{
  "pk": "OUTBOX#2026-06-19#SHARD#03",
  "sk": "EVENT#2026-06-19T04:00:00Z#evt123",
  "status": "PENDING",
  "topic": "case-events",
  "payload": "...",
  "attempt": 0,
  "nextAttemptAt": "2026-06-19T04:01:00Z"
}
```

GSI for pending:

```text
gsi1pk = OUTBOX#PENDING#SHARD#03
gsi1sk = NEXT#<nextAttemptAt>#EVENT#<eventId>
```

Trade-off:

- Lebih kompleks dari langsung publish.
- Tetapi jauh lebih defensible jika event tidak boleh hilang.

---

## 27. Single-Table Design: When and How

Single-table design menyimpan beberapa entity type dalam satu table untuk memenuhi access pattern dengan query efisien.

Contoh regulatory case platform:

```text
pk                         sk                                      entityType
CASE#C1                    META                                    CASE
CASE#C1                    EVENT#2026-06-19T01:00:00Z#E1          CASE_EVENT
CASE#C1                    DOC#PASSPORT#D1                        DOCUMENT
CASE#C1                    TASK#T1                                TASK
CASE#C1                    ASSIGNMENT#OFFICER#U1                  ASSIGNMENT
OFFICER#U1                 CASE#C1                                OFFICER_CASE_LINK
IDEMP#abc                  META                                    IDEMPOTENCY
OUTBOX#2026-06-19#S01      EVENT#2026-06-19T01:00:01Z#E2          OUTBOX
```

Advantages:

- Query related item collection efficiently.
- Fewer tables to operate.
- Transaction across related items in same table still possible.
- Flexible polymorphic access pattern.

Disadvantages:

- Harder mental model.
- Harder generic mapper.
- Attribute name governance needed.
- GSI overloaded keys can become confusing.
- Mistakes can affect many entity types.

### 27.1 Attribute Naming Discipline

Common generic keys:

```text
pk, sk
gsi1pk, gsi1sk
gsi2pk, gsi2sk
entityType
createdAt, updatedAt
version
ttlExpiresAt
```

Domain attributes:

```text
caseId
status
officerId
documentId
eventType
```

Avoid random naming per team:

```text
PK, partitionKey, hashKey, mainKey mixed across items
created_date, createdAt, createTime mixed without reason
```

### 27.2 Single Table Is Not Religion

Use single-table design when access patterns benefit. Do not force everything into one table if:

- Different lifecycle/security/capacity boundaries are needed.
- Operational blast radius should be separated.
- Workloads have radically different traffic patterns.
- Team cannot safely maintain overloaded schema.
- Regulatory isolation requires separate resources.

A top-tier engineer can choose either design and explain trade-off.

---

## 28. Multi-Table Design

Multi-table design can be appropriate:

```text
CaseTable
CaseEventTable
IdempotencyTable
OutboxTable
ProjectionTable
```

Advantages:

- Simpler per table.
- Clear IAM boundary.
- Separate capacity and alarms.
- Easier TTL/stream settings per table.
- Easier ownership by bounded context.

Disadvantages:

- More resources.
- More cross-table transactions if atomicity needed.
- More operational overhead.
- Querying related data may require multiple calls.

Decision matrix:

| Concern | Single Table | Multi Table |
|---|---:|---:|
| Query related item collection | Strong | Medium |
| Simplicity for junior team | Medium/Low | High |
| IAM isolation per entity | Medium | High |
| Operational blast radius | Medium | High |
| Cross-entity transaction | Strong if same table | Possible but explicit |
| Schema governance burden | High | Medium |
| Access-pattern density | High | Medium |

---

## 29. Item Size and Large Payloads

DynamoDB item size limit is an important design constraint. Even before hitting limit, large items increase cost and latency.

Do not store large document payloads in DynamoDB. Store large payload in S3, store metadata and pointer in DynamoDB.

Pattern:

```json
{
  "pk": "CASE#C1",
  "sk": "DOC#D1",
  "documentId": "D1",
  "s3Bucket": "case-documents-prod",
  "s3Key": "tenant/t1/case/C1/doc/D1/original.pdf",
  "sha256": "...",
  "contentType": "application/pdf",
  "sizeBytes": 10485760,
  "status": "SCANNED"
}
```

Benefits:

- DynamoDB remains fast.
- S3 handles large object lifecycle.
- Metadata query remains cheap.
- Integrity via checksum.
- Audit via immutable object key/version.

---

## 30. Error Handling in Java

Common exceptions:

- `ConditionalCheckFailedException`: business/concurrency condition failed.
- `ProvisionedThroughputExceededException`: capacity/throttling issue.
- `ThrottlingException`: throttling.
- `ResourceNotFoundException`: table/index missing or wrong region/account/env.
- `TransactionCanceledException`: transaction condition/conflict/cancel.
- `SdkClientException`: client/network/config issue.
- `DynamoDbException`: service exception base.

### 30.1 Do Not Treat All Exceptions Equally

Bad:

```java
catch (Exception e) {
    retry();
}
```

Better classification:

```text
ConditionalCheckFailedException:
  no blind retry; handle conflict/duplicate/state mismatch

Throughput/throttling:
  retry with backoff if within caller deadline; apply backpressure

SdkClientException network timeout:
  retry if operation idempotent or guarded by idempotency key

ResourceNotFoundException:
  configuration/deployment error; fail fast and alert

TransactionCanceledException:
  inspect cancellation reasons if available; classify condition vs conflict
```

### 30.2 Retry Needs Idempotency

Retrying `PutItem` without condition can overwrite. Retrying `UpdateItem ADD counter` can double increment if prior attempt succeeded but response timed out.

Safer patterns:

- Use idempotency key.
- Use condition expression.
- Use transaction client request token.
- Store command id in item history.
- Make update set deterministic value instead of increment when possible.

---

## 31. Timeout and Backpressure

DynamoDB calls are remote calls. Use SDK timeout strategy from earlier Part 4.

Example conceptual policy:

```text
API request path:
  apiCallAttemptTimeout: 300 ms
  apiCallTimeout: 900 ms
  max attempts: 2-3

Background worker:
  apiCallAttemptTimeout: 1 s
  apiCallTimeout: 5 s
  max attempts: 3-5 with jitter

Migration/backfill:
  controlled concurrency
  adaptive backoff
  explicit rate limit
```

Backpressure examples:

- Limit concurrent DynamoDB calls in SQS consumer.
- Stop polling SQS when DynamoDB throttling rises.
- Use bounded executor, not unbounded `CompletableFuture` fanout.
- Apply per-tenant concurrency limit for noisy tenant.
- Use batch carefully with retry of unprocessed items.

---

## 32. Security and IAM

Least privilege examples:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:Query"
  ],
  "Resource": [
    "arn:aws:dynamodb:ap-southeast-1:123456789012:table/CasePlatform",
    "arn:aws:dynamodb:ap-southeast-1:123456789012:table/CasePlatform/index/GSI1"
  ]
}
```

Avoid:

```json
{
  "Action": "dynamodb:*",
  "Resource": "*"
}
```

Security considerations:

- Use IAM role, not static access key.
- Use VPC endpoint if private network architecture requires it.
- Encrypt table with AWS owned/AWS managed/customer managed KMS depending governance.
- Restrict table/index ARNs.
- Separate read/write roles if necessary.
- Do not log full item if it contains PII/secret.
- Treat DynamoDB Streams as sensitive because old/new images may contain PII.
- Use CloudTrail/data event strategy where audit requires it.

---

## 33. Observability

Minimum metrics:

- Successful request count by operation.
- Failed request count by exception type.
- Latency p50/p90/p95/p99 by operation and table/index.
- Retry count.
- Throttling count.
- Conditional check failed count, separated from technical error.
- Consumed capacity if sampled/enabled.
- Item size distribution if relevant.
- Query result count.
- Pagination count.
- Hot key suspicion metrics.

Log fields:

```json
{
  "operation": "DynamoDB.UpdateItem",
  "table": "CasePlatform",
  "accessPattern": "AP-CASE-TRANSITION",
  "caseId": "C-2026-0001",
  "conditionFailed": false,
  "attempt": 1,
  "latencyMs": 24,
  "awsRequestId": "...",
  "correlationId": "..."
}
```

Do not log:

- Full item with PII.
- Secret values.
- Raw idempotency payload if sensitive.
- Authorization-sensitive fields unless redacted.

### 33.1 Access Pattern as Metric Dimension

Instead of only metric by table, add access pattern name:

```text
DynamoDBLatency{table=CasePlatform, operation=Query, accessPattern=OfficerDashboardByStatus}
```

This helps identify which screen/worker causes load.

---

## 34. Testing Strategy

### 34.1 Unit Test

Test:

- Key generation.
- Expression generation.
- Mapper correctness.
- State transition decision.
- Idempotency decision.
- Pagination token encode/decode.

Do not require DynamoDB for pure logic.

### 34.2 Integration Test

Use LocalStack/Testcontainers where useful, but remember emulation can differ from AWS edge semantics.

Test in real AWS sandbox for:

- IAM permission.
- GSI behavior.
- TTL expectations.
- Streams behavior.
- Transaction cancellation reason.
- Capacity/throttling behavior.
- KMS/table encryption permission.

### 34.3 Contract Test Access Pattern

Every access pattern should have tests:

```text
Given items seeded
When query AP-003
Then result ordered by due date
And no Scan is used
And pagination token works
```

### 34.4 Failure Injection

Simulate:

- Conditional check failure.
- Throttling.
- Timeout after write success.
- Duplicate event.
- Expired idempotency lock.
- GSI eventual consistency lag.
- Partial batch unprocessed items.

---

## 35. Case Study: Idempotent SQS Consumer with DynamoDB

Scenario:

- SQS receives `CaseScreeningRequested` event.
- Java worker processes screening.
- Worker updates case screening status.
- Duplicate SQS messages must not trigger duplicate screening.

### 35.1 Access Patterns

```text
AP-001 Acquire idempotency key
Input: eventId or deterministic command id
Operation: PutItem
Condition: attribute_not_exists(pk)

AP-002 Read idempotency result
Input: idempotency key
Operation: GetItem

AP-003 Update case screening state
Input: caseId, expected version/status
Operation: UpdateItem or TransactWriteItems
Condition: version/status match

AP-004 Mark idempotency completed
Input: idempotency key, owner token
Operation: UpdateItem
Condition: status=IN_PROGRESS and ownerToken match
```

### 35.2 Flow

```text
1. Receive SQS message.
2. Compute idempotency key from event id + consumer name.
3. Conditional put IN_PROGRESS record with owner token.
4. If condition fails:
   a. read idempotency record
   b. if COMPLETED -> delete SQS message
   c. if IN_PROGRESS not expired -> leave/retry later or change visibility
   d. if expired -> try takeover
5. Process screening.
6. Transactionally update case state and append audit event.
7. Mark idempotency COMPLETED.
8. Delete SQS message.
```

### 35.3 Invariants

```text
Invariant 1:
  Same eventId for same consumer cannot process concurrently unless lock expired.

Invariant 2:
  Worker can complete only if ownerToken matches.

Invariant 3:
  Case state update must be conditional on allowed state/version.

Invariant 4:
  Duplicate completed event must be acknowledged safely.

Invariant 5:
  Failed processing must not create permanent IN_PROGRESS deadlock; expiry/takeover path exists.
```

### 35.4 Failure Matrix

| Failure | Risk | Mitigation |
|---|---|---|
| Worker dies after acquiring idempotency | Permanent stuck | `inProgressExpiresAt` + takeover |
| Worker times out after DynamoDB update before SQS delete | Duplicate message | Idempotency record + conditional state transition |
| Duplicate SQS message arrives concurrently | Double process | Conditional put idempotency record |
| DynamoDB throttles | Worker overload | Backpressure + retry + SQS visibility handling |
| Conditional state update fails | State changed | Treat as conflict/duplicate depending current state |
| Mark completed fails after domain update | Duplicate may retry | Domain update also must be idempotent/conditional; recovery reads state |

---

## 36. Case Study: Case Management Single-Table Sketch

### 36.1 Requirements

- Get case by id.
- List case timeline.
- List documents by case.
- List cases assigned to officer by status and due date.
- Prevent invalid state transition.
- Append audit event on every transition.
- Support idempotent commands.
- Support outbox event publishing.

### 36.2 Table

```text
Table: CasePlatform
PK: pk
SK: sk
GSI1: gsi1pk, gsi1sk
GSI2: gsi2pk, gsi2sk
TTL: expiresAt
```

### 36.3 Items

Case metadata:

```text
pk = CASE#<caseId>
sk = META
entityType = CASE
status = UNDER_REVIEW
version = 7
gsi1pk = OFFICER#<officerId>#STATUS#UNDER_REVIEW
gsi1sk = DUE#<dueDate>#CASE#<caseId>
```

Case event:

```text
pk = CASE#<caseId>
sk = EVENT#<timestamp>#<eventId>
entityType = CASE_EVENT
eventType = CASE_STATUS_CHANGED
```

Document metadata:

```text
pk = CASE#<caseId>
sk = DOC#<documentType>#<documentId>
entityType = DOCUMENT
s3Key = ...
sha256 = ...
```

Idempotency:

```text
pk = IDEMP#<consumer>#<key>
sk = META
entityType = IDEMPOTENCY
status = IN_PROGRESS | COMPLETED
expiresAt = epochSeconds
```

Outbox:

```text
pk = OUTBOX#<date>#SHARD#<n>
sk = EVENT#<timestamp>#<eventId>
entityType = OUTBOX_EVENT
status = PENDING
gsi2pk = OUTBOX#PENDING#SHARD#<n>
gsi2sk = NEXT#<nextAttemptAt>#EVENT#<eventId>
```

### 36.4 Access Pattern Mapping

| Access Pattern | Operation | Key/Index |
|---|---|---|
| Get case | GetItem | `CASE#id`, `META` |
| List timeline | Query | `CASE#id`, `begins_with(EVENT#)` |
| List docs | Query | `CASE#id`, `begins_with(DOC#)` |
| Officer dashboard | Query GSI1 | `OFFICER#id#STATUS#x`, sort by due date |
| Acquire idempotency | PutItem condition | `IDEMP#...`, `META` |
| Poll outbox | Query GSI2 | `OUTBOX#PENDING#SHARD#n` |

---

## 37. Anti-Patterns

### 37.1 Scan-Driven UI

If every dashboard uses `Scan + FilterExpression`, DynamoDB will work in DEV and collapse in PROD.

### 37.2 Read-Then-Write State Transition

Any transition that reads status then writes later without condition is race-prone.

### 37.3 One Hot Partition Key

`pk = STATUS#PENDING` for all pending jobs creates hot key.

### 37.4 Blind Retry of Non-Idempotent Update

Retrying counter increment or append without idempotency can duplicate side effect.

### 37.5 Treating GSI as Strongly Consistent

GSI reads are eventually consistent. Do not validate critical immediate state from GSI.

### 37.6 Storing Large JSON Blob

Large blob hides queryable fields, increases cost, and complicates schema evolution.

### 37.7 Mapper-First Design

Starting from Java POJO and annotations before access pattern is backwards.

### 37.8 TTL as Exact Scheduler

TTL is not exact-time execution. Use EventBridge Scheduler/SQS delay/Step Functions if timing semantics matter.

### 37.9 DLQ Without Replay Contract

DLQ alone is not recovery. You need event schema, idempotent handler, redrive process, and operator playbook.

---

## 38. Production Checklist

### 38.1 Data Model

- [ ] Every access pattern documented.
- [ ] Every query uses partition key.
- [ ] No production user-facing scan.
- [ ] Sort key supports required ordering/prefix.
- [ ] GSI exists only for explicit access pattern.
- [ ] Hot key analysis done.
- [ ] Large tenant strategy defined.
- [ ] Item size estimated.
- [ ] Pagination designed.

### 38.2 Correctness

- [ ] Create-only writes use condition.
- [ ] State transitions use conditional update.
- [ ] Optimistic versioning used where needed.
- [ ] Duplicate event handling defined.
- [ ] Idempotency key source defined.
- [ ] Transaction used only where atomic multi-item correctness required.
- [ ] TTL expiry checked by app if strict.

### 38.3 Java Integration

- [ ] SDK client reused.
- [ ] Timeout configured.
- [ ] Retry mode understood.
- [ ] Backpressure implemented for workers.
- [ ] Exception classification implemented.
- [ ] Mapper tested.
- [ ] Pagination token safe.
- [ ] Java 8 compatibility considered if required.

### 38.4 Security

- [ ] IAM least privilege table/index ARNs.
- [ ] No static credentials.
- [ ] Encryption policy defined.
- [ ] PII redaction in logs.
- [ ] Streams access controlled.
- [ ] CloudTrail/audit requirement checked.

### 38.5 Observability

- [ ] Latency metrics by operation/access pattern.
- [ ] Throttling metrics.
- [ ] Conditional failure metrics separated.
- [ ] Retry metrics.
- [ ] Consumed capacity sampled if needed.
- [ ] Dashboard for table/index health.
- [ ] Alarms for throttling, system errors, stream iterator age.

### 38.6 Operations

- [ ] Capacity mode chosen intentionally.
- [ ] GSI backfill/migration plan exists.
- [ ] DLQ/replay process tested.
- [ ] Data backfill rate-limited.
- [ ] PITR/backup policy decided.
- [ ] Runbook for hot partition incident.
- [ ] Runbook for accidental bad deploy/write.

---

## 39. Mental Model Summary

DynamoDB expertise is not memorizing API calls. It is the ability to map workload shape into key design and failure-safe operations.

The core mental model:

```text
Access pattern determines key.
Key determines scalability.
Condition determines correctness.
Idempotency determines retry safety.
Index determines alternative query.
TTL determines cleanup, not exact expiry.
Stream determines change propagation, not domain truth.
Metrics determine operability.
```

For Java engineers, the production-grade view is:

```text
Java service does not “use DynamoDB”.
Java service owns a persistence contract implemented over DynamoDB.

That contract must define:
  - keys
  - item shapes
  - conditions
  - consistency
  - pagination
  - retry/idempotency
  - error classification
  - observability
  - IAM boundary
  - migration behavior
```

If those are explicit, DynamoDB becomes a powerful low-latency operational store. If those are implicit, DynamoDB becomes an expensive key-value dump with hidden race conditions.

---

## 40. Latihan Praktis

### Latihan 1 — Access Pattern Inventory

Ambil satu modul case management. Tulis minimal 10 access pattern:

```text
Name:
Caller:
Input:
Operation:
Key/index:
Sort:
Pagination:
Consistency:
Expected cardinality:
Failure handling:
```

Jangan membuat table sebelum access pattern selesai.

### Latihan 2 — Design Key Schema

Untuk access pattern berikut:

- Get case by id.
- List case events by case id sorted newest first.
- List pending cases by officer and due date.
- List documents by case and document type.
- Deduplicate command by command id.

Buat:

- `pk`
- `sk`
- `gsi1pk`
- `gsi1sk`
- item examples
- query examples

### Latihan 3 — Conditional Transition

Implementasikan method Java:

```java
approveCase(caseId, expectedVersion, approverId, commandId)
```

Syarat:

- Case hanya bisa approve dari `UNDER_REVIEW`.
- Version harus cocok.
- Audit event harus tercatat.
- Command idempotent.
- Duplicate command tidak boleh approve dua kali.

### Latihan 4 — Hot Partition Review

Identifikasi apakah key berikut aman:

```text
pk = TENANT#<tenantId>
pk = STATUS#PENDING
pk = CASE#<caseId>
pk = DATE#<yyyy-MM-dd>
pk = IDEMP#<sha256>
pk = OFFICER#<officerId>#STATUS#<status>
```

Untuk yang berisiko, desain alternatifnya.

### Latihan 5 — Failure Matrix

Buat failure matrix untuk SQS consumer yang menulis DynamoDB:

- Duplicate message.
- Timeout after successful write.
- Conditional check failed.
- DynamoDB throttling.
- Worker crash after idempotency lock.
- DLQ redrive after 3 days.

Tentukan behavior yang benar.

---

## 41. Kapan Part Ini Dianggap Dikuasai

Anda dianggap menguasai Part 23 jika bisa:

1. Menjelaskan kenapa DynamoDB harus access-pattern-first.
2. Mendesain partition key/sort key untuk workload nyata.
3. Membedakan Query, Scan, FilterExpression, GSI, LSI secara operational.
4. Memakai conditional write untuk correctness.
5. Membuat optimistic locking/state transition aman.
6. Mendesain idempotency store untuk Lambda/SQS.
7. Memahami TTL sebagai cleanup asynchronous.
8. Memakai Enhanced Client tanpa kehilangan kontrol access pattern.
9. Mengklasifikasikan exception DynamoDB dengan benar.
10. Mendesain observability dan alarm untuk DynamoDB integration.
11. Menjelaskan trade-off single-table vs multi-table tanpa fanatisme.
12. Menulis Java gateway yang menjaga invariant, bukan hanya wrapper SDK.

---

## 42. Penutup

DynamoDB adalah salah satu service AWS yang paling kuat sekaligus paling sering disalahgunakan. Ia terlihat sederhana karena tidak memaksa schema relational, tetapi justru menuntut kedisiplinan desain yang lebih awal. Untuk engineer yang ingin naik ke level top-tier, DynamoDB harus dipahami sebagai kombinasi dari:

- data modelling,
- distributed systems,
- workload shaping,
- failure modelling,
- cost engineering,
- security boundary,
- operational observability,
- dan Java integration discipline.

Part berikutnya akan membahas **CloudWatch, CloudTrail, and Auditability**. Di sana kita akan memperluas observability dari level aplikasi menjadi level forensic dan audit: bagaimana log, metric, trace, CloudTrail, request ID, dan operational evidence disusun agar sistem Java AWS bisa dipahami saat incident maupun audit formal.

---

## Status Seri

Seri belum selesai.

- Selesai: Part 0 sampai Part 23.
- Berikutnya: Part 24 — CloudWatch, CloudTrail, and Auditability.
- Target akhir: Part 35.
