# learn-aws-cloud-architecture-mastery-for-java-engineers-part-013.md

# Part 013 — DynamoDB for System Designers: Partition, Access Pattern, Transaction, Stream, dan Global Table

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead  
> Fokus: memahami DynamoDB sebagai primitive desain sistem, bukan sekadar NoSQL table  
> Status: Part 013 dari 035 — seri belum selesai

---

## 0. Tujuan Bagian Ini

Bagian ini membahas DynamoDB dari perspektif **system design**.

Kita tidak akan mengulang konsep NoSQL umum atau document/key-value database secara luas karena seri database sudah membahas fondasi itu. Fokus bagian ini adalah:

1. bagaimana DynamoDB berpikir tentang data;
2. bagaimana partition key menentukan scalability;
3. bagaimana sort key membentuk query surface;
4. bagaimana access pattern harus didesain sebelum schema;
5. bagaimana conditional write menggantikan banyak pola locking;
6. bagaimana transaction digunakan secara terbatas dan sengaja;
7. bagaimana stream membentuk event-driven projection;
8. bagaimana global table mengubah failure dan consistency model;
9. bagaimana Java application harus berinteraksi dengan DynamoDB secara aman, efisien, dan observable.

Mental model terpenting:

> DynamoDB bukan database yang “nanti query-nya disesuaikan”. DynamoDB adalah storage engine terkelola yang meminta kita mendesain **key space** berdasarkan **access pattern** sejak awal.

Top engineer tidak bertanya:

> “Tabel DynamoDB saya field-nya apa saja?”

Mereka bertanya:

> “Pertanyaan apa saja yang harus dijawab sistem, dengan latency berapa, pada volume berapa, dan dengan consistency guarantee apa?”

---

## 1. Apa Itu DynamoDB dalam Mental Model AWS

DynamoDB adalah managed, serverless, distributed NoSQL database untuk key-value dan document workload. AWS mendeskripsikannya sebagai fully managed, serverless, distributed NoSQL database dengan single-digit millisecond performance pada skala besar.

Tetapi definisi praktis untuk engineer:

> DynamoDB adalah distributed hash/range storage service yang memberi performa sangat stabil jika akses data mengikuti desain key yang benar.

DynamoDB cocok ketika:

1. access pattern dapat didefinisikan jelas;
2. query utama adalah lookup berbasis key atau range query berbasis partition + sort key;
3. workload membutuhkan scale tinggi tanpa operasi database tradisional;
4. availability dan operational simplicity lebih penting daripada relational expressiveness;
5. aplikasi dapat menerima model query terbatas;
6. data model dapat disesuaikan dengan query, bukan sebaliknya.

DynamoDB kurang cocok ketika:

1. query ad-hoc sangat dominan;
2. join kompleks sering dibutuhkan;
3. query shape belum stabil;
4. reporting/analytics langsung ke primary store dibutuhkan;
5. data relationship berubah-ubah tanpa access pattern jelas;
6. tim belum disiplin terhadap key design.

DynamoDB bukan pengganti universal PostgreSQL/MySQL. DynamoDB adalah primitive sangat kuat untuk workload tertentu.

---

## 2. Core Components

Komponen inti DynamoDB:

| Komponen | Makna |
|---|---|
| Table | Container utama item |
| Item | Record individual |
| Attribute | Field dalam item |
| Partition key | Key utama untuk menentukan distribusi fisik |
| Sort key | Key opsional untuk mengurutkan item dalam partition key yang sama |
| Primary key | Partition key saja, atau partition key + sort key |
| Local Secondary Index | Index dengan partition key sama, sort key berbeda |
| Global Secondary Index | Index dengan partition key/sort key berbeda dari table |
| Stream | Change log untuk item-level modification |
| TTL | Expiration attribute untuk penghapusan eventual |
| Capacity mode | On-demand atau provisioned |
| Global table | Multi-Region replicated table |

DynamoDB table dapat memiliki:

```text
Primary key = partition key
```

atau:

```text
Primary key = partition key + sort key
```

Jika hanya partition key, setiap item harus punya partition key unik.

Jika partition key + sort key, banyak item boleh punya partition key sama selama sort key berbeda.

Contoh:

```text
PK = CASE#123
SK = METADATA

PK = CASE#123
SK = EVENT#2026-06-20T10:15:00Z#EVT001

PK = CASE#123
SK = DOCUMENT#DOC789
```

Semua item dengan `PK = CASE#123` dapat diambil bersama dengan query pada partition key.

---

## 3. DynamoDB Bukan Relational Modeling

Relational modeling biasanya mulai dari entity relationship:

```text
Case
CaseEvent
Document
Officer
Decision
Violation
```

Lalu query dibuat dengan join.

DynamoDB modeling mulai dari access pattern:

```text
1. Get case by caseId
2. List events for case ordered by time
3. List documents for case
4. Get latest decision for case
5. List active cases by officer
6. List cases by status and deadline
7. Prevent duplicate external reference
8. Append audit event idempotently
```

Baru setelah itu kita desain table/index.

Perbedaan mindset:

| Relational | DynamoDB |
|---|---|
| Normalize first | Query first |
| Join at read time | Pre-shape data at write time |
| Flexible query | Predictable query |
| Schema expresses domain | Key schema expresses access path |
| Optimize with indexes later | Model indexes intentionally from start |
| Strong consistency common | Consistency choice per operation |

DynamoDB sering memindahkan kompleksitas dari read-time ke write-time.

Itu bukan kelemahan. Itu trade-off.

---

## 4. Access Pattern First Design

Sebelum membuat table, tulis access pattern dengan format eksplisit:

```text
AP-001: Get case metadata by caseId
Input: caseId
Output: case metadata
Cardinality: 1 item
Latency target: < 20 ms server-side
Consistency: strong preferred for command path
Frequency: high

AP-002: List case timeline
Input: caseId, time range, limit
Output: ordered case events
Cardinality: 10-500 items per case
Latency target: < 100 ms
Consistency: eventual acceptable for read UI, strong for command validation if needed
Frequency: medium/high

AP-003: List active cases assigned to officer
Input: officerId, status, optional deadline range
Output: case summaries
Cardinality: 0-1000 items
Latency target: < 200 ms with pagination
Consistency: eventual acceptable
Frequency: high
```

Setiap access pattern harus menjawab:

1. input key apa yang tersedia?
2. output item apa yang dibutuhkan?
3. apakah butuh exact lookup atau range query?
4. apakah urutan penting?
5. apakah pagination diperlukan?
6. apakah strongly consistent read diperlukan?
7. berapa cardinality maksimum?
8. apakah query ini command path atau read-only UI path?
9. apakah query ini tenant-scoped?
10. apakah query ini perlu cross-region?

Tanpa daftar access pattern, desain DynamoDB hampir pasti spekulatif.

---

## 5. Partition Key: Keputusan Paling Penting

Partition key digunakan DynamoDB untuk menentukan distribusi data. Nilai partition key diproses oleh internal hash function untuk menentukan physical partition.

Implikasi:

> Partition key menentukan apakah workload tersebar rata atau menumpuk pada satu hot partition.

Partition key yang baik:

1. punya cardinality tinggi;
2. dipakai dalam access pattern utama;
3. menyebarkan read/write load;
4. tidak menjadikan satu nilai menerima traffic berlebihan;
5. mendukung tenant isolation bila multi-tenant;
6. tidak mudah berubah;
7. punya makna operasional yang jelas.

Partition key buruk:

```text
PK = STATUS#OPEN
PK = COUNTRY#ID
PK = TENANT#largeTenantOnly
PK = DATE#2026-06-20
PK = TYPE#CASE
```

Kenapa buruk?

Karena banyak item dan request terkonsentrasi pada sedikit nilai key.

Partition key lebih baik:

```text
PK = CASE#<caseId>
PK = TENANT#<tenantId>#CASE#<caseId>
PK = OFFICER#<officerId>
PK = DEADLINE#2026-06-20#SHARD#07
PK = EXTERNAL_REF#<sourceSystem>#<externalId>
```

---

## 6. Sort Key: Membentuk Struktur Query

Sort key menentukan urutan item di dalam partition key yang sama.

Sort key memungkinkan query seperti:

1. `begins_with(SK, 'EVENT#')`;
2. `SK BETWEEN 'EVENT#2026-01' AND 'EVENT#2026-12'`;
3. latest item dengan reverse scan;
4. hierarchy dengan prefix;
5. one-to-many relationship dalam satu partition.

Contoh sort key:

```text
SK = METADATA
SK = EVENT#2026-06-20T10:15:00Z#EVT001
SK = DOCUMENT#DOC789
SK = DECISION#2026-06-20T11:00:00Z#DEC456
SK = COMMENT#2026-06-20T11:30:00Z#CMT999
```

Dengan desain ini:

```text
PK = CASE#123
```

query dapat mengambil:

```text
case metadata
case events
case documents
case decisions
case comments
```

berdasarkan prefix sort key.

Composite sort key sangat berguna untuk hierarchy:

```text
SK = ORG#<orgId>#DEPT#<deptId>#USER#<userId>
SK = STATUS#OPEN#DUE#2026-06-21#CASE#123
SK = TYPE#DOCUMENT#CREATED#2026-06-20#DOC#789
```

Aturan penting:

> Sort key bukan sekadar secondary field. Sort key adalah query language terbatas yang kita desain sendiri.

---

## 7. Query vs Scan

Dalam DynamoDB, `Query` dan `Scan` berbeda secara fundamental.

`Query`:

1. membutuhkan partition key;
2. dapat memakai condition pada sort key;
3. efisien jika key design benar;
4. sesuai untuk production access path.

`Scan`:

1. membaca banyak item tanpa key targeting;
2. mahal;
3. lambat pada table besar;
4. dapat mengganggu workload;
5. biasanya tanda data model salah jika dipakai pada request path.

Rule:

> Production user request path tidak boleh bergantung pada Scan.

Scan masih dapat digunakan untuk:

1. backfill;
2. admin maintenance;
3. migration;
4. offline repair;
5. controlled batch operation;
6. small table yang memang bounded.

Tetapi harus diberi throttle, pagination, observability, dan time budget.

---

## 8. Single-Table Design: Powerful, Tapi Bukan Agama

Single-table design berarti beberapa entity type disimpan dalam satu DynamoDB table dengan key convention yang sama.

Contoh:

```text
Table: RegulatoryCaseTable

Item 1:
PK = CASE#123
SK = METADATA
entityType = Case
status = OPEN
assignedOfficer = OFFICER#45

Item 2:
PK = CASE#123
SK = EVENT#2026-06-20T10:15:00Z#EVT001
entityType = CaseEvent
message = Case created

Item 3:
PK = CASE#123
SK = DOCUMENT#DOC789
entityType = Document
s3Key = cases/123/documents/DOC789.pdf
```

Kelebihan:

1. query related data dengan satu partition key;
2. mengurangi round trip;
3. cocok untuk aggregate-oriented access;
4. mendukung item collection;
5. dapat memodelkan banyak access pattern dengan GSI.

Risiko:

1. key convention kompleks;
2. debugging lebih sulit;
3. accidental coupling antar entity;
4. perubahan access pattern dapat mahal;
5. GSI overload sulit dipahami;
6. tim yang belum matang bisa membuat table sulit dirawat.

Prinsip sehat:

> Gunakan single-table design ketika access pattern memang saling terkait dan tim siap menjaga key schema sebagai kontrak arsitektur.

Jangan gunakan single-table design hanya karena “best practice internet”.

Multi-table design tetap valid jika:

1. entity benar-benar punya lifecycle berbeda;
2. access pattern tidak overlap;
3. security boundary berbeda;
4. backup/restore boundary berbeda;
5. TTL/lifecycle berbeda;
6. ownership tim berbeda;
7. single-table akan membuat model terlalu sulit.

---

## 9. Item Collection

Item collection adalah kumpulan item dengan partition key yang sama.

Contoh:

```text
PK = CASE#123
```

Item collection-nya:

```text
SK = METADATA
SK = EVENT#...
SK = DOCUMENT#...
SK = DECISION#...
SK = COMMENT#...
```

Item collection bagus untuk aggregate seperti:

1. case;
2. order;
3. account;
4. workflow execution;
5. document package;
6. enforcement action.

Tetapi hati-hati jika satu aggregate bisa tumbuh tanpa batas.

Contoh berbahaya:

```text
PK = TENANT#bigTenant
SK = EVENT#...
```

Jika tenant besar punya miliaran event, partition key tenant menjadi hot dan item collection menjadi terlalu besar.

Lebih baik:

```text
PK = TENANT#<tenantId>#CASE#<caseId>
```

atau untuk event besar:

```text
PK = CASE#<caseId>#EVENT_BUCKET#2026-06
SK = EVENT#<timestamp>#<eventId>
```

---

## 10. Secondary Indexes

DynamoDB primary key mendukung access pattern utama. Access pattern tambahan biasanya membutuhkan secondary index.

Ada dua jenis:

1. Local Secondary Index; 
2. Global Secondary Index.

### 10.1 Local Secondary Index

LSI:

1. dibuat saat table dibuat;
2. memiliki partition key sama dengan table;
3. sort key berbeda;
4. berguna untuk alternative ordering dalam item collection.

Contoh:

Table:

```text
PK = CASE#123
SK = EVENT#timestamp#eventId
```

LSI:

```text
PK = CASE#123
LSI_SK = SEVERITY#HIGH#timestamp
```

Dapat mengambil event case berdasarkan severity.

Gunakan LSI jika access pattern masih berada dalam partition key yang sama.

### 10.2 Global Secondary Index

GSI:

1. punya partition key sendiri;
2. sort key opsional sendiri;
3. dapat dibuat setelah table dibuat;
4. eventually consistent;
5. punya capacity/cost sendiri;
6. dapat menjadi bottleneck sendiri.

Contoh GSI untuk assigned officer:

```text
GSI1PK = OFFICER#45
GSI1SK = STATUS#OPEN#DUE#2026-06-21#CASE#123
```

Query:

```text
List open cases for officer 45 ordered by due date
```

GSI adalah materialized access path.

Jangan pikirkan GSI sebagai “index relational biasa”. GSI adalah projection asynchronous dari item base table ke key space lain.

---

## 11. Sparse Index

Sparse index terjadi ketika hanya sebagian item memiliki attribute key GSI.

Contoh hanya active cases memiliki:

```text
GSI1PK = OFFICER#45
GSI1SK = STATUS#OPEN#DUE#2026-06-21#CASE#123
```

Ketika case closed, hapus `GSI1PK/GSI1SK` dari item.

Akibatnya item closed tidak muncul di index.

Ini sangat berguna untuk:

1. active tasks;
2. pending approvals;
3. overdue cases;
4. unprocessed events;
5. open incidents;
6. expiring sessions.

Sparse index menghemat biaya dan membuat query lebih targeted.

---

## 12. Overloaded GSI

Overloaded GSI berarti satu GSI dipakai untuk banyak access pattern dengan key prefix berbeda.

Contoh:

```text
GSI1PK = OFFICER#45
GSI1SK = STATUS#OPEN#DUE#2026-06-21#CASE#123

GSI1PK = TENANT#abc#STATUS#OPEN
GSI1SK = DUE#2026-06-21#CASE#123

GSI1PK = EXTERNAL_REF#SYSTEM_A#998877
GSI1SK = CASE#123
```

Kelebihan:

1. mengurangi jumlah GSI;
2. lebih hemat cost;
3. fleksibel jika convention jelas.

Risiko:

1. index menjadi sulit dipahami;
2. key collision jika convention buruk;
3. observability per access pattern lebih sulit;
4. IAM/resource-level control tidak granular;
5. perubahan satu pola bisa memengaruhi pola lain.

Gunakan overloaded GSI hanya dengan dokumentasi key schema yang disiplin.

---

## 13. Capacity Mode: On-Demand vs Provisioned

DynamoDB mendukung dua mode utama:

1. on-demand;
2. provisioned.

### 13.1 On-Demand

Cocok untuk:

1. workload unpredictable;
2. early stage product;
3. traffic bursty;
4. tim ingin mengurangi capacity planning;
5. cost bukan constraint utama awal.

Kelebihan:

1. sederhana;
2. auto scales based on request traffic;
3. mengurangi risiko underprovision.

Kekurangan:

1. dapat lebih mahal pada workload stabil besar;
2. tetap punya quota dan hot key limitation;
3. bukan izin untuk key design buruk.

### 13.2 Provisioned

Cocok untuk:

1. workload predictable;
2. cost optimization matang;
3. high steady traffic;
4. sistem dengan capacity planning jelas.

Kelebihan:

1. cost lebih terkendali;
2. dapat memakai auto scaling;
3. cocok untuk workload besar yang stabil.

Kekurangan:

1. perlu planning;
2. risiko throttling jika salah sizing;
3. butuh observability lebih kuat.

Rule praktis:

> Mulai dengan on-demand untuk membuktikan access pattern, lalu evaluasi provisioned jika traffic sudah stabil dan cost signifikan.

---

## 14. Read Capacity dan Write Capacity

DynamoDB mengenakan kapasitas berdasarkan ukuran item dan jenis operasi.

Hal yang harus dipahami:

1. item besar lebih mahal;
2. strong consistent read lebih mahal daripada eventual consistent read;
3. transaction lebih mahal daripada operasi biasa;
4. GSI write ikut menambah biaya;
5. stream consumer dan downstream juga punya biaya;
6. scan sangat mahal pada data besar.

Top engineer tidak hanya menghitung request per second.

Mereka menghitung:

```text
request rate × item size × consistency × index amplification × retry behavior × peak factor
```

Contoh write amplification:

```text
Base table write: 1 item
GSI1 projection: yes
GSI2 projection: yes
Stream record: yes
Lambda consumer: yes
OpenSearch projection: yes
```

Satu write domain dapat menjadi lima side effect operasional.

---

## 15. Hot Partition

Hot partition terjadi ketika satu atau sedikit partition key menerima traffic jauh lebih tinggi daripada lainnya.

Contoh buruk:

```text
PK = STATUS#OPEN
```

Semua case open masuk ke key sama.

Contoh buruk:

```text
PK = TENANT#enterprise_customer_1
```

Satu tenant besar menerima traffic dominan.

Contoh buruk:

```text
PK = DATE#2026-06-20
```

Semua event hari itu masuk ke partition yang sama.

Mitigasi:

1. pilih key cardinality tinggi;
2. tambahkan shard suffix jika query pattern mengizinkan;
3. bucket berdasarkan waktu + shard;
4. gunakan write sharding;
5. pecah aggregate besar;
6. gunakan GSI yang lebih merata;
7. batasi tenant besar dengan token bucket;
8. observasi `ThrottledRequests` dan key-level access pattern.

Write sharding contoh:

```text
PK = DEADLINE#2026-06-20#SHARD#00
PK = DEADLINE#2026-06-20#SHARD#01
PK = DEADLINE#2026-06-20#SHARD#02
...
PK = DEADLINE#2026-06-20#SHARD#15
```

Saat membaca, query semua shard lalu merge.

Trade-off:

1. write lebih tersebar;
2. read lebih kompleks;
3. pagination lebih kompleks;
4. cost read bisa naik.

---

## 16. Adaptive Capacity

DynamoDB memiliki adaptive capacity yang dapat membantu menangani uneven access pattern secara otomatis.

Tetapi adaptive capacity bukan alasan untuk desain key sembarangan.

Adaptive capacity membantu jika:

1. workload tidak terlalu ekstrem;
2. item/key distribution masih punya ruang distribusi;
3. traffic pattern tidak semuanya menuju satu item;
4. partition split memungkinkan.

Adaptive capacity tidak menyelamatkan desain seperti:

```text
PK = GLOBAL_COUNTER
SK = METADATA
```

jika semua write menghantam satu item.

Rule:

> Adaptive capacity adalah safety net, bukan fondasi desain.

---

## 17. Large Item dan Item Size Discipline

DynamoDB item memiliki batas ukuran. Secara desain, jangan gunakan DynamoDB untuk menyimpan payload besar seperti file, HTML besar, PDF, atau audit blob masif.

Pattern yang sehat:

```text
DynamoDB item:
PK = CASE#123
SK = DOCUMENT#DOC789
s3Bucket = regulated-documents-prod
s3Key = tenant-a/cases/123/documents/DOC789.pdf
checksum = sha256:...
contentType = application/pdf
sizeBytes = 1234567
```

Payload besar disimpan di S3.

DynamoDB menyimpan metadata, pointer, state, ownership, dan index attributes.

Manfaat:

1. biaya lebih baik;
2. query lebih cepat;
3. item tidak membesar tak terkendali;
4. S3 lifecycle bisa dipakai;
5. object lock dapat dipakai untuk evidence;
6. DynamoDB tetap fokus pada access path.

---

## 18. Conditional Write

Conditional write adalah salah satu fitur terpenting DynamoDB.

Ia memungkinkan operasi write hanya berhasil jika kondisi tertentu terpenuhi.

Contoh use case:

1. create only if not exists;
2. update only if version matches;
3. prevent duplicate external reference;
4. transition state only from allowed previous state;
5. reserve resource if still available;
6. append idempotency record;
7. enforce uniqueness.

Contoh konsep:

```text
PutItem Case
ConditionExpression: attribute_not_exists(PK)
```

Artinya: buat case hanya jika item belum ada.

Optimistic locking:

```text
UpdateItem Case
ConditionExpression: version = :expectedVersion
SET version = version + 1, status = :newStatus
```

State transition:

```text
UpdateItem Case
ConditionExpression: status IN (:open, :underReview)
SET status = :closed
```

Conditional write mengubah database menjadi penjaga invariant.

Jangan hanya enforce invariant di Java memory, karena request concurrent dapat melewati validasi aplikasi.

Invariant kritis harus berada di write condition.

---

## 19. Idempotency dengan DynamoDB

Idempotency penting untuk distributed system karena retry dapat membuat operasi dikirim lebih dari sekali.

Pattern idempotency:

```text
PK = IDEMPOTENCY#<operationName>#<idempotencyKey>
SK = REQUEST
status = IN_PROGRESS | COMPLETED | FAILED
responseHash = ...
expiresAt = epochSeconds
```

Flow:

1. request datang dengan idempotency key;
2. aplikasi mencoba `PutItem` idempotency record dengan `attribute_not_exists(PK)`;
3. jika sukses, aplikasi menjalankan operasi;
4. jika gagal karena item sudah ada, aplikasi membaca status;
5. jika completed, return previous result;
6. jika in progress, return conflict/retry-after;
7. TTL membersihkan record lama.

Contoh enforcement case creation:

```text
Idempotency key = externalSystem + externalCaseReference
```

Manfaat:

1. retry aman;
2. duplicate create dicegah;
3. client/network failure tidak menghasilkan side effect ganda;
4. audit lebih defensible.

---

## 20. Transactions

DynamoDB transactions memungkinkan atomic operation pada beberapa item.

Gunakan transaction untuk invariant lintas item yang benar-benar perlu atomicity.

Contoh:

1. create case metadata;
2. create uniqueness guard item;
3. append initial event;
4. create assignment item.

Pseudo transaction:

```text
TransactWriteItems:
- Put CASE#123 / METADATA if not exists
- Put EXTERNAL_REF#SYSTEM_A#998877 if not exists
- Put CASE#123 / EVENT#created
- Put OFFICER#45 / CASE#123 assignment projection
```

Kelebihan:

1. atomic multi-item write;
2. menjaga invariant penting;
3. mengurangi race condition.

Kekurangan:

1. lebih mahal;
2. ada limit jumlah item/ukuran transaksi;
3. latency lebih tinggi;
4. konflik transaksi bisa terjadi;
5. tidak boleh jadi default untuk semua operasi.

Rule:

> Pakai transaction untuk invariant, bukan untuk kenyamanan modeling.

Jika side effect bisa dibuat eventual dengan stream/projection, jangan dipaksa transactional.

---

## 21. Uniqueness Constraint Pattern

DynamoDB tidak punya unique constraint arbitrary seperti relational database.

Namun uniqueness bisa dibuat dengan guard item.

Contoh: external reference harus unik.

```text
PK = UNIQUE#EXTERNAL_REF#SYSTEM_A#998877
SK = UNIQUE
caseId = CASE#123
```

Saat create case:

```text
TransactWriteItems:
1. Put UNIQUE#EXTERNAL_REF#SYSTEM_A#998877 if not exists
2. Put CASE#123 / METADATA if not exists
```

Jika external reference sudah dipakai, transaksi gagal.

Pattern ini sangat berguna untuk:

1. username;
2. email;
3. external id;
4. case number;
5. document hash;
6. registration number.

---

## 22. State Machine Pattern dengan DynamoDB

Untuk workload enforcement/case management, state transition harus defensible.

Contoh item:

```text
PK = CASE#123
SK = METADATA
status = UNDER_REVIEW
version = 7
assignedOfficer = OFFICER#45
updatedAt = 2026-06-20T10:00:00Z
```

Transition:

```text
UNDER_REVIEW -> DECISION_PENDING
```

Update condition:

```text
ConditionExpression:
  status = :underReview AND version = :expectedVersion

UpdateExpression:
  SET status = :decisionPending,
      version = version + :one,
      updatedAt = :now
```

Audit event ditulis dalam transaction:

```text
PK = CASE#123
SK = EVENT#2026-06-20T10:30:00Z#EVT123
fromStatus = UNDER_REVIEW
toStatus = DECISION_PENDING
actor = USER#abc
reason = Evidence review completed
```

Invariant:

1. status tidak boleh lompat ilegal;
2. concurrent update tidak boleh overwrite diam-diam;
3. audit event harus ada jika status berubah;
4. actor dan reason harus tercatat;
5. version harus meningkat.

DynamoDB conditional write + transaction cocok untuk invariant seperti ini.

---

## 23. Streams

DynamoDB Streams menangkap perubahan item.

Stream berguna untuk:

1. update read model;
2. publish domain event;
3. sink ke OpenSearch;
4. sink ke analytics pipeline;
5. trigger notification;
6. maintain materialized view;
7. audit projection;
8. cache invalidation.

Contoh:

```text
Case metadata updated -> stream record -> Lambda consumer -> update OpenSearch case index
```

Important mental model:

> Stream consumer adalah asynchronous side effect. Jangan gunakan stream untuk invariant yang harus sudah benar saat command commit.

Jika invariant wajib atomic, gunakan transaction/condition di write path.

Jika projection boleh eventual, gunakan stream.

---

## 24. Stream Failure Mode

Stream consumer dapat gagal.

Failure mode:

1. poison record;
2. retry berulang;
3. batch gagal karena satu item;
4. downstream OpenSearch/SQS/API throttling;
5. duplicate event processing;
6. out-of-date projection;
7. ordering assumption salah;
8. Lambda concurrency terlalu tinggi;
9. shard iterator age meningkat.

Mitigasi:

1. idempotent consumer;
2. checkpoint-aware processing;
3. partial batch failure jika didukung integration;
4. DLQ/on-failure destination;
5. poison message handling;
6. metric `IteratorAge`;
7. replay strategy;
8. projection reconciliation job;
9. event schema versioning.

Consumer harus dianggap at-least-once.

Jangan menulis consumer yang mengasumsikan exactly once.

---

## 25. TTL

TTL memungkinkan item expired dihapus secara eventual.

Use case:

1. idempotency record;
2. session;
3. temporary token;
4. cache item;
5. pending import state;
6. ephemeral lock;
7. short-lived workflow marker.

Contoh:

```text
PK = IDEMPOTENCY#CreateCase#abc123
SK = REQUEST
expiresAt = 1781971200
```

Catatan penting:

1. TTL bukan real-time scheduler;
2. penghapusan bersifat eventual;
3. jangan pakai TTL untuk deadline yang harus dieksekusi tepat waktu;
4. jangan bergantung pada TTL untuk compliance deletion yang butuh bukti immediate;
5. stream dapat menerima delete event TTL tergantung konfigurasi.

Untuk deadline bisnis, gunakan scheduler/workflow/queue, bukan TTL semata.

---

## 26. Global Tables

Global table mereplikasi DynamoDB table ke beberapa Region.

Mental model:

> Global table adalah multi-Region replicated table, bukan relational distributed transaction system.

Cocok untuk:

1. low-latency multi-region reads/writes;
2. active-active application;
3. disaster recovery;
4. globally distributed user base;
5. workload yang bisa menerima conflict semantics.

Risiko:

1. replication lag;
2. conflict resolution;
3. write-write conflict antar Region;
4. increased cost;
5. operational complexity;
6. regional failover logic;
7. harder audit reasoning.

Jika dua Region menulis item sama, desain harus jelas:

1. apakah last writer wins acceptable?
2. apakah writes harus region-owned?
3. apakah item ownership dibagi berdasarkan tenant?
4. apakah command path hanya active di satu Region?
5. apakah conflict harus dideteksi di aplikasi?

Pattern aman:

```text
Tenant A owned by ap-southeast-1
Tenant B owned by eu-west-1
```

atau:

```text
Command writes active only in primary Region
Read replicas serve local reads
```

Global table tidak menghapus kebutuhan desain consistency.

Ia hanya memindahkan sebagian problem ke architecture layer.

---

## 27. Consistency Model

DynamoDB mendukung eventually consistent read dan strongly consistent read untuk table/LSI dalam Region tertentu. GSI read bersifat eventually consistent.

Design implication:

1. command validation sebaiknya baca dari primary item dengan strong read bila perlu;
2. UI listing dari GSI harus menerima eventual consistency;
3. after-write read dari GSI bisa belum terlihat;
4. global table replication juga eventual antar Region;
5. projection dari stream juga eventual.

Contoh bug umum:

```text
1. Create case
2. Immediately query GSI list open cases
3. Case belum muncul
4. Test dianggap gagal
```

Solusi:

1. command response langsung return created entity;
2. UI optimistically updates;
3. eventual list diberi toleransi;
4. test menunggu eventual consistency dengan retry bounded;
5. invariant tidak divalidasi via GSI eventual.

---

## 28. Pagination

DynamoDB query dapat mengembalikan hasil bertahap.

Aplikasi Java harus mendesain pagination secara eksplisit.

Jangan load semua item timeline jika bisa ribuan.

API design:

```http
GET /cases/{caseId}/events?limit=50&pageToken=...
```

Internal mapping:

```text
Limit = 50
ExclusiveStartKey = decoded pageToken
```

Page token harus:

1. opaque bagi client;
2. signed/encrypted jika mengandung key sensitif;
3. tidak mudah dimodifikasi;
4. versioned;
5. bounded.

Jangan expose raw DynamoDB key sembarangan jika mengandung tenant/account/internal id.

---

## 29. Java SDK: Low-Level Client vs Enhanced Client

AWS SDK for Java 2.x menyediakan beberapa cara akses DynamoDB.

### 29.1 Low-Level Client

```java
DynamoDbClient client = DynamoDbClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Kelebihan:

1. kontrol penuh;
2. cocok untuk dynamic item;
3. cocok untuk single-table polymorphic model;
4. mudah melihat expression secara eksplisit.

Kekurangan:

1. verbose;
2. mapping manual;
3. raw attribute value lebih banyak boilerplate.

### 29.2 Enhanced Client

Enhanced Client memetakan Java class ke item DynamoDB.

Cocok untuk:

1. model yang cukup stabil;
2. CRUD sederhana;
3. table-per-entity;
4. developer productivity.

Perlu hati-hati untuk:

1. single-table design polymorphic;
2. partial update;
3. expression kompleks;
4. overloaded GSI;
5. item dengan banyak entity type.

Rule:

> Gunakan Enhanced Client jika mapping membantu tanpa menyembunyikan key design. Gunakan low-level client jika key dan expression adalah bagian penting dari arsitektur.

---

## 30. Java Client Lifecycle

DynamoDB client harus direuse.

Jangan membuat client per request.

Contoh Spring-style:

```java
@Configuration
class DynamoDbConfig {

    @Bean
    DynamoDbClient dynamoDbClient() {
        return DynamoDbClient.builder()
                .region(Region.AP_SOUTHEAST_1)
                .build();
    }
}
```

Untuk async/high-throughput workload:

```java
DynamoDbAsyncClient client = DynamoDbAsyncClient.builder()
        .region(Region.AP_SOUTHEAST_1)
        .build();
```

Pertimbangan:

1. timeout harus eksplisit;
2. retry mode harus dipahami;
3. connection pool harus sesuai throughput;
4. metric SDK harus diobservasi;
5. client close saat shutdown;
6. credential provider jangan hardcoded.

---

## 31. Java Pattern: Conditional Create

Contoh create item hanya jika belum ada:

```java
PutItemRequest request = PutItemRequest.builder()
    .tableName(tableName)
    .item(Map.of(
        "PK", AttributeValue.fromS("CASE#123"),
        "SK", AttributeValue.fromS("METADATA"),
        "status", AttributeValue.fromS("OPEN"),
        "version", AttributeValue.fromN("1")
    ))
    .conditionExpression("attribute_not_exists(PK) AND attribute_not_exists(SK)")
    .build();

try {
    dynamoDbClient.putItem(request);
} catch (ConditionalCheckFailedException e) {
    throw new DuplicateCaseException("Case already exists", e);
}
```

Catatan:

1. `ConditionalCheckFailedException` bukan infrastructure failure;
2. itu domain conflict;
3. jangan retry buta;
4. map ke HTTP 409 jika API;
5. log sebagai business conflict, bukan error sistem kritis.

---

## 32. Java Pattern: Optimistic Locking

```java
UpdateItemRequest request = UpdateItemRequest.builder()
    .tableName(tableName)
    .key(Map.of(
        "PK", AttributeValue.fromS("CASE#123"),
        "SK", AttributeValue.fromS("METADATA")
    ))
    .updateExpression("SET #status = :newStatus, #version = #version + :one")
    .conditionExpression("#version = :expectedVersion AND #status = :currentStatus")
    .expressionAttributeNames(Map.of(
        "#status", "status",
        "#version", "version"
    ))
    .expressionAttributeValues(Map.of(
        ":newStatus", AttributeValue.fromS("DECISION_PENDING"),
        ":currentStatus", AttributeValue.fromS("UNDER_REVIEW"),
        ":expectedVersion", AttributeValue.fromN("7"),
        ":one", AttributeValue.fromN("1")
    ))
    .build();
```

Interpretasi exception:

```text
ConditionalCheckFailedException -> stale version or illegal transition
ProvisionedThroughputExceededException / ThrottlingException -> capacity/retry concern
ResourceNotFoundException -> deployment/config concern
AccessDeniedException -> IAM concern
```

Top engineer tidak menangani semua exception dengan `RuntimeException` generik.

---

## 33. Java Pattern: Query Timeline

```java
QueryRequest request = QueryRequest.builder()
    .tableName(tableName)
    .keyConditionExpression("PK = :pk AND begins_with(SK, :prefix)")
    .expressionAttributeValues(Map.of(
        ":pk", AttributeValue.fromS("CASE#123"),
        ":prefix", AttributeValue.fromS("EVENT#")
    ))
    .limit(50)
    .scanIndexForward(false)
    .build();

QueryResponse response = dynamoDbClient.query(request);
```

Hal yang perlu dipikirkan:

1. apakah reverse order dibutuhkan?
2. apakah limit cukup?
3. apakah page token dikembalikan?
4. apakah event item cukup kecil?
5. apakah filter expression dipakai secara salah?

Filter expression bukan pengganti key design.

Filter expression menyaring setelah data dibaca, sehingga tetap membayar read untuk data yang discan dalam query result set.

---

## 34. Java Pattern: Transactional Create with Uniqueness

```java
TransactWriteItemsRequest request = TransactWriteItemsRequest.builder()
    .transactItems(
        TransactWriteItem.builder()
            .put(Put.builder()
                .tableName(tableName)
                .item(uniqueExternalRefItem)
                .conditionExpression("attribute_not_exists(PK)")
                .build())
            .build(),
        TransactWriteItem.builder()
            .put(Put.builder()
                .tableName(tableName)
                .item(caseMetadataItem)
                .conditionExpression("attribute_not_exists(PK)")
                .build())
            .build(),
        TransactWriteItem.builder()
            .put(Put.builder()
                .tableName(tableName)
                .item(caseCreatedEventItem)
                .conditionExpression("attribute_not_exists(PK)")
                .build())
            .build()
    )
    .build();
```

Transaction cancellation harus dianalisis.

Jangan hanya bilang “transaction failed”.

Bedakan:

1. uniqueness conflict;
2. duplicate case id;
3. capacity issue;
4. IAM denial;
5. validation error;
6. transient service failure.

---

## 35. Error Handling Taxonomy

Untuk Java service, error DynamoDB sebaiknya dipetakan ke kategori:

| Error | Kategori | Perlakuan |
|---|---|---|
| ConditionalCheckFailedException | Domain conflict | Tidak retry buta |
| TransactionCanceledException | Mixed; inspect reason | Domain/conflict/infrastructure |
| ProvisionedThroughputExceededException | Capacity/throttling | Retry with backoff, alarm |
| ThrottlingException | Throttling | Retry bounded, backpressure |
| ResourceNotFoundException | Config/deployment | Fail fast, alert |
| AccessDeniedException | IAM/security | Fail fast, alert |
| InternalServerErrorException | AWS transient | Retry bounded |
| ValidationException | Bug/request invalid | Fail fast |

Retry policy harus dibatasi.

Jangan biarkan retry memperbesar overload.

Untuk write command penting, gunakan idempotency key agar retry aman.

---

## 36. Observability

Metric penting:

1. successful request latency;
2. p95/p99 latency per access pattern;
3. throttled requests;
4. conditional check failed count;
5. transaction canceled count;
6. consumed read/write capacity;
7. returned item count;
8. scanned count;
9. system errors;
10. user errors;
11. stream iterator age;
12. DLQ depth;
13. GSI throttling;
14. replication latency untuk global table;
15. application-level conflict rate.

Log harus mencatat:

1. access pattern id;
2. table name logical;
3. partition key hash/masked, bukan selalu raw sensitive key;
4. consistency mode;
5. item count;
6. page size;
7. retry count;
8. AWS request id;
9. idempotency key;
10. tenant id.

Contoh log structured:

```json
{
  "event": "dynamodb.query",
  "accessPattern": "AP-002_LIST_CASE_EVENTS",
  "tenantId": "tenant-a",
  "table": "RegulatoryCaseTable",
  "pkHash": "sha256:...",
  "limit": 50,
  "itemCount": 50,
  "hasNextPage": true,
  "durationMs": 18,
  "retryCount": 0
}
```

---

## 37. Security

Security concern:

1. IAM role aplikasi;
2. least privilege action;
3. table/index resource scope;
4. KMS encryption;
5. VPC endpoint jika ingin private path;
6. CloudTrail audit;
7. data classification;
8. tenant isolation;
9. backup access;
10. stream consumer permission.

IAM action contoh:

```text
dynamodb:GetItem
dynamodb:PutItem
dynamodb:UpdateItem
dynamodb:DeleteItem
dynamodb:Query
dynamodb:TransactWriteItems
dynamodb:DescribeTable
```

Jangan berikan:

```text
dynamodb:*
```

kecuali untuk role admin/IaC yang scoped dan diaudit.

Untuk multi-tenant, jangan hanya mengandalkan aplikasi jika risiko tinggi. Pertimbangkan:

1. account isolation;
2. table per tenant untuk tenant besar/regulasi tinggi;
3. IAM condition jika applicable;
4. encryption context;
5. per-tenant KMS key untuk requirement tertentu;
6. audit query per tenant.

---

## 38. Backup dan Restore

DynamoDB operational design harus mencakup:

1. point-in-time recovery;
2. on-demand backup;
3. restore drill;
4. backup retention;
5. restore account/Region;
6. table recreation dependency;
7. GSI restore behavior;
8. stream consumer reattachment;
9. application cutover;
10. data reconciliation.

Backup bukan hanya “enabled”.

Pertanyaan sebenarnya:

1. berapa RPO?
2. berapa RTO?
3. apakah restore pernah diuji?
4. siapa boleh restore?
5. bagaimana mencegah accidental deletion?
6. bagaimana restore subset tenant/case?
7. bagaimana audit setelah restore?

---

## 39. Cost Engineering

Cost driver:

1. read request;
2. write request;
3. item size;
4. storage size;
5. GSI storage;
6. GSI write amplification;
7. stream read;
8. backup/PITR;
9. global table replicated write;
10. data export;
11. Lambda consumer;
12. OpenSearch projection;
13. CloudWatch logs.

Cost anti-pattern:

1. storing large JSON blob in every item;
2. many GSIs projecting all attributes;
3. scan-heavy admin UI;
4. high-cardinality logs of every item raw;
5. global table without clear need;
6. transaction for every write;
7. overusing strong consistency;
8. unbounded timeline query.

Projection discipline:

| Projection | Kapan digunakan |
|---|---|
| KEYS_ONLY | Index hanya perlu key untuk lookup balik |
| INCLUDE | Index perlu sebagian attribute |
| ALL | Hanya jika benar-benar perlu dan cost diterima |

Jangan default ke `ALL` untuk semua GSI.

---

## 40. Data Modeling Case Study: Regulated Case Management

Requirement:

1. create case from external system;
2. external reference must be unique;
3. get case metadata by id;
4. list case timeline;
5. append audit event;
6. assign officer;
7. list open cases by officer ordered by due date;
8. prevent illegal state transition;
9. store documents in S3 but metadata in DynamoDB;
10. update OpenSearch projection asynchronously;
11. support tenant isolation;
12. support idempotent create;
13. support audit defensibility.

### 40.1 Table

```text
Table: RegulatoryCaseTable
PK: string
SK: string
```

### 40.2 Case metadata

```text
PK = TENANT#tenant-a#CASE#case-123
SK = METADATA
entityType = Case
caseId = case-123
tenantId = tenant-a
status = UNDER_REVIEW
assignedOfficer = officer-45
dueDate = 2026-07-01
version = 7
createdAt = 2026-06-20T10:00:00Z
updatedAt = 2026-06-20T11:00:00Z
GSI1PK = TENANT#tenant-a#OFFICER#officer-45
GSI1SK = STATUS#UNDER_REVIEW#DUE#2026-07-01#CASE#case-123
```

### 40.3 Timeline event

```text
PK = TENANT#tenant-a#CASE#case-123
SK = EVENT#2026-06-20T10:15:00Z#evt-001
entityType = CaseEvent
eventType = CASE_CREATED
actor = SYSTEM#external-a
message = Case created from external referral
```

### 40.4 Document metadata

```text
PK = TENANT#tenant-a#CASE#case-123
SK = DOCUMENT#doc-789
entityType = Document
documentId = doc-789
s3Bucket = regulated-documents-prod
s3Key = tenant-a/cases/case-123/documents/doc-789.pdf
checksum = sha256:...
classification = CONFIDENTIAL
createdAt = 2026-06-20T10:20:00Z
```

### 40.5 Uniqueness guard

```text
PK = UNIQUE#TENANT#tenant-a#EXTERNAL_REF#external-a#998877
SK = UNIQUE
casePk = TENANT#tenant-a#CASE#case-123
createdAt = 2026-06-20T10:00:00Z
```

### 40.6 Idempotency record

```text
PK = IDEMPOTENCY#tenant-a#CreateCase#abc123
SK = REQUEST
status = COMPLETED
caseId = case-123
expiresAt = 1781971200
```

### 40.7 GSI1

```text
GSI1PK = TENANT#tenant-a#OFFICER#officer-45
GSI1SK = STATUS#UNDER_REVIEW#DUE#2026-07-01#CASE#case-123
```

Access pattern:

```text
List officer workload by status and due date
```

### 40.8 Stream projection

DynamoDB Stream -> Lambda -> OpenSearch:

```text
Case metadata changed -> update search document
Document metadata changed -> update search document
Timeline event added -> optionally update activity summary
```

Invariant tetap di DynamoDB write path.

Search hanya projection.

---

## 41. Anti-Patterns

### 41.1 Relational Thinking in DynamoDB

Gejala:

1. table per entity tanpa access pattern jelas;
2. mencoba join di aplikasi secara berlebihan;
3. scan untuk mencari entity;
4. GSI dibuat reaktif untuk setiap query baru;
5. key tidak punya semantic query.

Solusi:

1. tulis access pattern;
2. desain key untuk query;
3. denormalisasi dengan sengaja;
4. gunakan projection;
5. pilih relational database jika query memang relational.

### 41.2 Filter Expression as Query Design

Filter expression bukan key condition.

Jika query membaca 10.000 item lalu filter menjadi 10, biaya tetap mengikuti item yang dibaca.

### 41.3 Giant Tenant Partition

```text
PK = TENANT#abc
```

Semua data tenant masuk satu partition key.

Ini sering buruk untuk tenant besar.

### 41.4 Unbounded Item Collection

Timeline atau event tanpa bucket dapat tumbuh terlalu besar.

Gunakan time bucket jika perlu.

### 41.5 GSI Explosion

Membuat GSI untuk setiap layar UI tanpa melihat access pattern domain.

Solusi:

1. consolidate dengan overloaded GSI jika masuk akal;
2. gunakan search projection untuk query bebas;
3. redesign UX query;
4. pindah workload analytics/search ke service yang tepat.

### 41.6 Using DynamoDB as Queue

DynamoDB bisa menyimpan state pekerjaan, tetapi queue semantics lebih cocok di SQS/Kinesis/EventBridge sesuai kebutuhan.

Jangan membangun queue polling buruk di DynamoDB jika SQS sudah menyelesaikan masalah.

### 41.7 Global Table Without Conflict Model

Multi-region write tanpa ownership/conflict policy adalah desain rapuh.

---

## 42. DynamoDB vs RDS vs ElastiCache vs OpenSearch

| Need | Service lebih cocok |
|---|---|
| Transactional relational query | RDS/Aurora |
| High-scale key-value lookup | DynamoDB |
| Low-latency ephemeral cache | ElastiCache/MemoryDB |
| Search text/filtering/ranking | OpenSearch |
| Audit event append/query by aggregate | DynamoDB atau relational tergantung query |
| Ad-hoc reporting | Athena/Redshift/OpenSearch, bukan primary DynamoDB |
| Complex join | Relational |
| Multi-region active-active key-value | DynamoDB global table, jika conflict model jelas |

DynamoDB sangat kuat jika pertanyaan yang diajukan cocok dengan key-value/range access.

Jika pertanyaannya berubah-ubah dan analitis, gunakan projection atau data lake/search engine.

---

## 43. Design Review Checklist

Sebelum approve DynamoDB design, jawab:

1. Apa semua access pattern sudah ditulis?
2. Mana access pattern command path?
3. Mana access pattern UI/read model?
4. Apa primary key mendukung query utama?
5. Apa GSI benar-benar diperlukan?
6. Apakah ada hot partition risk?
7. Apa cardinality partition key cukup tinggi?
8. Apakah item collection bounded?
9. Apakah ada unbounded scan di request path?
10. Apakah consistency requirement jelas?
11. Apakah conditional write menjaga invariant penting?
12. Apakah idempotency key dipakai untuk command yang retryable?
13. Apakah transaction hanya untuk invariant atomic?
14. Apakah GSI projection cost disadari?
15. Apakah stream consumer idempotent?
16. Apakah DLQ/replay strategy ada?
17. Apakah TTL dipakai hanya untuk expiry eventual?
18. Apakah backup/PITR/restore diuji?
19. Apakah IAM least privilege?
20. Apakah observability per access pattern tersedia?
21. Apakah Java SDK client direuse dan timeout eksplisit?
22. Apakah error taxonomy dibedakan?
23. Apakah global table punya conflict model?
24. Apakah data besar disimpan di S3, bukan DynamoDB?
25. Apakah ada ADR untuk key schema?

---

## 44. ADR Template untuk DynamoDB Table

```md
# ADR: DynamoDB Data Model for <Workload>

## Context

<Business capability, scale, consistency, latency, and operational constraints.>

## Access Patterns

| ID | Description | Input | Output | Consistency | Frequency | Cardinality |
|---|---|---|---|---|---|---|
| AP-001 | Get case metadata | caseId | 1 case | Strong/Eventual | High | 1 |
| AP-002 | List case timeline | caseId, range | events | Eventual | Medium | 10-500 |

## Table Design

Table: `<name>`

Primary key:

- PK: `<definition>`
- SK: `<definition>`

## Item Types

### Case Metadata

PK = ...
SK = ...

### Event

PK = ...
SK = ...

## Indexes

### GSI1

Purpose: ...
GSI1PK = ...
GSI1SK = ...
Projection = ...

## Consistency Decisions

<Which paths need strong read, which accept eventual.>

## Invariants

<Which invariants are enforced through condition expressions or transactions.>

## Capacity and Cost

<Expected item size, request rate, index amplification, mode.>

## Failure Modes

<Hot partitions, throttling, duplicate events, stream failures, projection lag.>

## Alternatives Considered

<RDS, OpenSearch projection, separate tables, different keys.>

## Decision

<Chosen model and why.>
```

---

## 45. Latihan Praktis

### Latihan 1 — Access Pattern Inventory

Ambil domain case management dan tulis minimal 20 access pattern.

Untuk setiap access pattern, isi:

1. input;
2. output;
3. cardinality;
4. consistency;
5. frequency;
6. latency target;
7. whether it is command path or query path.

### Latihan 2 — Key Design

Desain primary key dan minimal dua GSI untuk:

1. get case by id;
2. list case timeline;
3. list active cases by officer;
4. list overdue cases by tenant;
5. prevent duplicate external reference.

### Latihan 3 — Hot Partition Analysis

Untuk setiap key, estimasi:

1. cardinality;
2. max request per key;
3. largest tenant risk;
4. largest case risk;
5. mitigation strategy.

### Latihan 4 — Conditional Transition

Implementasikan state transition:

```text
OPEN -> UNDER_REVIEW -> DECISION_PENDING -> CLOSED
```

Dengan invariant:

1. tidak boleh skip state;
2. concurrent update harus gagal;
3. audit event harus dibuat;
4. external command harus idempotent.

### Latihan 5 — Stream Projection

Desain stream consumer untuk update OpenSearch projection.

Harus punya:

1. idempotency;
2. retry;
3. DLQ;
4. reconciliation job;
5. metric iterator age;
6. schema version handling.

---

## 46. Ringkasan Mental Model

DynamoDB mastery bukan hafal API.

DynamoDB mastery adalah kemampuan menjawab:

1. access pattern apa yang dilayani?
2. key mana yang membuat access itu O(1) atau bounded range?
3. apakah partition key menyebarkan load?
4. apakah sort key mengekspresikan urutan/hierarchy yang tepat?
5. apakah invariant dijaga di write path?
6. apakah eventual consistency diterima di read path?
7. apakah stream hanya dipakai untuk projection/side effect?
8. apakah retry aman karena idempotency?
9. apakah GSI menambah value lebih besar dari cost/complexity-nya?
10. apakah global table punya conflict model?

Kalimat kunci:

> DynamoDB memberi scalability sangat besar jika kita memberi key design yang jujur terhadap access pattern.

---

## 47. Referensi Resmi

- Amazon DynamoDB Developer Guide — Introduction: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html
- DynamoDB core components: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html
- Partitions and data distribution: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html
- Best practices for partition keys: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html
- Designing partition keys to distribute workload: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-uniform-load.html
- Write sharding: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html
- Sort key best practices: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html
- Global Secondary Indexes: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html
- Condition expressions: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html
- Transactions: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html
- Read consistency: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
- Global tables: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html
- DynamoDB Enhanced Client for AWS SDK for Java 2.x: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBEnhanced.html
- AWS SDK for Java 2.x DynamoDB examples: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/examples-dynamodb.html

---

## 48. Status Seri

Part 013 selesai.

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-014.md
```

Judul:

```text
Event Integration on AWS: SQS, SNS, EventBridge, Kinesis, Step Functions
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Application Data on AWS: Managed Relational, Key-Value, Document, Search, Cache without Repeating Database Internals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-014.md">Part 014 — Event Integration on AWS: SQS, SNS, EventBridge, Kinesis, Step Functions ➡️</a>
</div>
