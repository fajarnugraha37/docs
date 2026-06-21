# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-015.md

# Part 015 — Data Import, ETL, CDC, and Graph Projection Pipelines

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain, membangun, dan mengoperasikan sistem graph berbasis Neo4j secara production-grade.  
> Fokus part ini: bagaimana data masuk ke Neo4j dari sistem lain dengan benar, aman, idempotent, bisa diulang, bisa diaudit, dan tidak menghancurkan model graph.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- mental model graph,
- property graph model,
- arsitektur Neo4j,
- Cypher dasar,
- path semantics,
- modelling methodology,
- advanced modelling patterns,
- anti-pattern,
- schema/constraints/indexes,
- write modelling,
- query performance,
- supernodes,
- Java Driver,
- Spring Data Neo4j.

Sekarang kita masuk ke masalah yang sering terlihat sederhana tetapi sering menjadi sumber kegagalan besar di production:

> Bagaimana graph diisi, disinkronkan, diperbarui, diperbaiki, dan direkonsiliasi dari sistem nyata?

Graph database jarang hidup sebagai sistem tunggal. Dalam sistem enterprise, Neo4j sering menjadi:

1. **operational graph** untuk query relasi real-time,
2. **investigation graph** untuk analyst/officer,
3. **risk graph** untuk enrichment dan scoring,
4. **recommendation graph** untuk serving,
5. **knowledge graph** untuk reasoning/semantic discovery,
6. **projection graph** dari relational/document/event source,
7. **analytical graph** untuk Graph Data Science.

Artinya, tantangan sebenarnya bukan hanya `CREATE` dan `MERGE`, tetapi:

- data datang dari mana,
- siapa source-of-truth,
- kapan graph boleh dianggap benar,
- bagaimana mencegah duplicate node,
- bagaimana memproses relationship yang datang sebelum node,
- bagaimana melakukan backfill,
- bagaimana menangani event terlambat,
- bagaimana mengulang job tanpa membuat data rusak,
- bagaimana memastikan query graph tetap menjawab pertanyaan bisnis setelah import besar,
- bagaimana mengaudit asal-usul fakta graph.

Part ini membahas semua itu secara sistematis.

---

## 1. Mental Model: Import Bukan Sekadar Memasukkan Data

Banyak engineer menganggap import sebagai proses teknis:

```text
CSV / JSON / Kafka event / DB row -> Cypher -> Neo4j
```

Itu terlalu dangkal.

Dalam graph system, import adalah proses membangun **semantic topology**.

Yang dimasukkan bukan hanya record, tetapi:

- identity,
- hubungan,
- arah hubungan,
- evidence,
- temporal validity,
- confidence,
- provenance,
- traversal affordance,
- query contract.

Jika import salah, query graph akan tetap berjalan, tetapi jawaban bisnisnya salah.

Contoh sederhana:

```text
Customer A punya account X.
Account X menerima transfer dari account Y.
Account Y terkait organization Z.
Organization Z sedang dalam investigasi.
```

Jika import hanya membuat node tanpa relationship yang benar, graph kehilangan nilai.

Jika relationship arahnya salah, query path menjadi misleading.

Jika account duplicate karena external ID tidak distandarkan, fraud ring bisa terpecah.

Jika event lama menghapus state baru, hasil investigation bisa tidak defensible.

Karena itu, import pipeline harus diperlakukan sebagai bagian dari **domain architecture**, bukan hanya script migrasi.

---

## 2. Empat Tipe Aliran Data ke Neo4j

Secara praktis, data masuk ke Neo4j melalui empat tipe besar.

```text
1. One-time initial import
2. Batch recurring import
3. Streaming/event-driven update
4. Change Data Capture / replication-style sync
```

Masing-masing punya failure mode berbeda.

---

## 3. One-Time Initial Import

Initial import dipakai saat:

- membuat database graph pertama kali,
- migrasi dari sistem lama,
- membuat environment baru,
- melakukan full rebuild graph projection,
- load dataset besar untuk analytics.

Contoh sumber:

- CSV export dari relational DB,
- JSON export dari document store,
- parquet/CSV dari data lake,
- snapshot dari core system,
- dump dari investigation platform lama.

Tujuan initial import biasanya:

```text
Bangun baseline graph yang lengkap dan konsisten dari snapshot sumber.
```

Kunci desainnya:

1. database target boleh kosong atau tidak,
2. ukuran data,
3. apakah import harus online,
4. apakah constraints/indexes sudah ada,
5. apakah data perlu transformasi berat,
6. apakah import bisa diulang,
7. apakah hasil import bisa diverifikasi.

Neo4j menyediakan beberapa opsi import. Secara umum:

- `LOAD CSV` cocok untuk small-to-medium import ke database yang sudah ada.
- `neo4j-admin database import` cocok untuk bulk offline import besar ke database kosong.
- APOC import procedures dapat membantu format tertentu seperti CSV/JSON, dengan tetap harus memperhatikan ukuran dan operasional.
- Connector/Kafka/CDC lebih cocok untuk aliran berkelanjutan, bukan import awal sederhana.

---

## 4. Batch Recurring Import

Batch recurring import adalah job berkala:

```text
Setiap malam / setiap jam / setiap minggu:
ambil data sumber -> transform -> upsert graph -> validate -> publish status
```

Contoh:

- nightly account ownership refresh,
- daily sanctions list import,
- weekly company registry update,
- monthly regulatory rule graph refresh,
- periodic case relationship enrichment.

Batch recurring import berbeda dari one-time import karena harus aman dijalankan berkali-kali.

Prinsip utamanya:

```text
Batch import harus idempotent.
```

Artinya:

- menjalankan batch yang sama dua kali tidak boleh menggandakan node,
- tidak boleh menggandakan relationship,
- tidak boleh menghapus fakta yang masih valid,
- tidak boleh menurunkan versi data secara tidak sengaja,
- harus bisa resume setelah gagal sebagian.

---

## 5. Streaming/Event-Driven Update

Streaming update dipakai saat graph perlu mendekati real-time.

Contoh event:

```json
{
  "eventType": "ACCOUNT_OPENED",
  "accountId": "ACC-991",
  "customerId": "CUS-123",
  "occurredAt": "2026-06-21T10:15:00Z"
}
```

Atau:

```json
{
  "eventType": "CASE_ESCALATED",
  "caseId": "CASE-2026-0001",
  "fromUnit": "INTAKE",
  "toUnit": "ENFORCEMENT",
  "reason": "high_risk_related_party",
  "occurredAt": "2026-06-21T11:30:00Z"
}
```

Streaming cocok untuk:

- risk graph enrichment,
- fraud detection,
- access graph updates,
- operational investigation graph,
- recommendation graph updates,
- dependency graph update dari CI/CD events.

Tetapi streaming membawa problem:

- duplicate event,
- out-of-order event,
- missing event,
- poison message,
- partial graph state,
- schema evolution,
- replay,
- exactly-once illusion.

Mental model yang sehat:

```text
Kafka/event stream memberi urutan dan durabilitas event.
Neo4j memberi materialized connected state.
Pipeline harus menjembatani keduanya dengan idempotency dan reconciliation.
```

Jangan menganggap sink connector otomatis menyelesaikan correctness domain.

---

## 6. Change Data Capture / CDC

CDC adalah proses menangkap perubahan dari database dan mengirimkannya ke consumer.

Dalam konteks Neo4j, ada dua arah yang umum:

1. **source system CDC -> Neo4j**  
   Contoh: PostgreSQL/MySQL CDC dari core system masuk ke Neo4j sebagai graph projection.

2. **Neo4j CDC -> downstream system**  
   Contoh: perubahan graph Neo4j dipublikasikan ke Kafka atau sistem lain.

Neo4j modern menyediakan dokumentasi CDC untuk menangkap dan melacak perubahan database secara real-time. CDC berguna untuk downstream processing dan sink/source connector, tetapi Neo4j juga menegaskan bahwa CDC bukan alat untuk membuat salinan database Neo4j yang identik karena metadata tertentu tidak direplikasi. Untuk exact copy, backup/cluster/offline copy lebih tepat.

Poin penting:

```text
CDC is change feed, not semantic truth by itself.
```

CDC memberi informasi bahwa sesuatu berubah.

Pipeline tetap harus menentukan:

- perubahan itu menjadi node apa,
- relationship apa yang dibuat/dihapus,
- apakah event itu valid secara domain,
- bagaimana menangani delete,
- bagaimana menjaga identity,
- bagaimana memastikan graph tidak drift dari source.

---

## 7. Source-of-Truth vs Graph Projection

Sebelum menulis pipeline, jawab dulu:

```text
Apakah Neo4j adalah source-of-truth atau projection?
```

Ini keputusan arsitektur paling penting.

### 7.1 Neo4j sebagai Source-of-Truth

Neo4j menjadi authoritative store untuk fakta graph tertentu.

Contoh:

- curated knowledge graph,
- manually maintained investigation graph,
- entitlement graph,
- dependency graph yang memang dikelola di Neo4j,
- analyst annotations.

Implikasi:

- write API harus punya invariant kuat,
- audit trail sangat penting,
- constraints wajib matang,
- backup/restore lebih critical,
- downstream consumers mungkin membaca dari Neo4j.

### 7.2 Neo4j sebagai Projection

Neo4j hanyalah materialized view dari sistem lain.

Contoh:

- customer/account data dari core banking,
- case data dari case management relational DB,
- transaction data dari event stream,
- product catalog dari document DB,
- user/group/permission dari IAM system.

Implikasi:

- graph harus rebuildable,
- pipeline harus idempotent,
- Neo4j tidak boleh menerima mutation sembarang untuk data projected,
- drift detection penting,
- source metadata harus disimpan.

### 7.3 Hybrid

Paling umum di enterprise:

```text
Sebagian data projected dari source system.
Sebagian enrichment/annotation dikelola langsung di Neo4j.
```

Contoh investigation graph:

- Person, Organization, Account: projected dari master data.
- Case, Evidence, Review, AnalystNote: dikelola di Neo4j atau case platform.
- RiskScore: derived dari batch/ML/GDS.
- RELATED_TO: derived edge dari entity resolution.

Hybrid powerful, tetapi berbahaya kalau ownership tidak jelas.

Gunakan ownership matrix:

| Graph Element | Source-of-Truth | Writer | Rebuildable? | Manual Edit Allowed? |
|---|---:|---:|---:|---:|
| `(:Person {externalId})` | MDM | ingestion-service | yes | no |
| `(:Account {accountId})` | Core banking | ingestion-service | yes | no |
| `(:Case {caseId})` | Case platform | case-service | maybe | controlled |
| `(:Evidence)` | Evidence service | evidence-service | no/partial | controlled |
| `[:RELATED_TO]` | entity-resolution-job | graph-enrichment | yes | no |
| `(:AnalystNote)` | Neo4j/app | analyst-service | no | yes |

Tanpa matrix ini, graph cepat menjadi “data swamp dengan relationship”.

---

## 8. Import Strategy Decision Matrix

Gunakan matrix berikut saat memilih teknik import.

| Kondisi | Strategi Umum | Catatan |
|---|---|---|
| Data kecil/menengah, CSV, database existing | `LOAD CSV` | Cocok untuk iterative import dan development |
| Data sangat besar, initial load, database kosong | `neo4j-admin database import` | Offline/bulk import; cepat, tapi target harus empty/new |
| JSON/API/file semi-structured | ETL app atau APOC | Transformasi domain biasanya lebih aman di app/service |
| Real-time dari Kafka | Kafka Connector / custom consumer | Butuh idempotency dan dead-letter strategy |
| Perubahan Neo4j ke downstream | Neo4j CDC / Kafka source | CDC bukan backup/exact replica |
| Rebuild graph projection | Full snapshot + deterministic transform | Simpan manifest dan validation report |
| Complex domain mapping | Custom Java ingestion service | Lebih mudah enforce invariant dan observability |

Rule of thumb:

```text
Semakin semantic transform-nya kompleks, semakin pipeline harus explicit.
Jangan sembunyikan domain mapping terlalu banyak di connector config.
```

Connector bagus untuk mekanik aliran data.

Domain invariant tetap tanggung jawab desain aplikasi.

---

## 9. CSV Import dengan LOAD CSV

`LOAD CSV` adalah cara paling mudah untuk import CSV menggunakan Cypher.

Contoh file `persons.csv`:

```csv
person_id,name,date_of_birth,country
P001,Alice,1988-01-11,ID
P002,Bob,1982-05-20,SG
P003,Charlie,1991-09-07,MY
```

Cypher:

```cypher
LOAD CSV WITH HEADERS FROM 'file:///persons.csv' AS row
MERGE (p:Person {personId: row.person_id})
SET p.name = row.name,
    p.dateOfBirth = date(row.date_of_birth),
    p.country = row.country;
```

Untuk relationship file `ownerships.csv`:

```csv
person_id,company_id,percentage,valid_from
P001,C001,75.0,2024-01-01
P002,C001,25.0,2024-01-01
```

Cypher:

```cypher
LOAD CSV WITH HEADERS FROM 'file:///ownerships.csv' AS row
MATCH (p:Person {personId: row.person_id})
MATCH (c:Company {companyId: row.company_id})
MERGE (p)-[r:OWNS]->(c)
SET r.percentage = toFloat(row.percentage),
    r.validFrom = date(row.valid_from),
    r.source = 'company_registry';
```

Hal penting:

1. buat constraints sebelum import,
2. import node dulu,
3. import relationship setelah endpoint node tersedia,
4. parse type dengan eksplisit,
5. jangan simpan semua sebagai string,
6. hindari `MERGE` dengan property non-key,
7. gunakan batching untuk dataset besar,
8. validasi jumlah row vs jumlah node/relationship.

---

## 10. Constraint Sebelum Import

Sebelum import, buat constraint identity.

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;

CREATE CONSTRAINT company_id_unique IF NOT EXISTS
FOR (c:Company)
REQUIRE c.companyId IS UNIQUE;
```

Tanpa constraint, `MERGE` bisa menjadi lambat dan duplicate bisa tetap muncul di race condition tertentu.

Dengan constraint:

- lookup lebih cepat,
- duplicate dicegah,
- pipeline fail early jika data sumber buruk,
- idempotency lebih kuat.

Constraint bukan hanya optimasi. Constraint adalah kontrak integrity.

---

## 11. Node Import Sebelum Relationship Import

Graph import biasanya dua fase minimal:

```text
Phase 1: import all nodes
Phase 2: import all relationships between existing nodes
```

Mengapa?

Relationship membutuhkan endpoint node.

Jika relationship di-import sebelum node ada, ada tiga kemungkinan buruk:

1. query gagal,
2. pipeline membuat placeholder node tanpa metadata lengkap,
3. relationship hilang diam-diam.

Untuk pipeline production, pilihan harus eksplisit.

### 11.1 Strict Mode

Relationship hanya dibuat jika dua endpoint ditemukan.

```cypher
MATCH (p:Person {personId: row.person_id})
MATCH (c:Company {companyId: row.company_id})
MERGE (p)-[:OWNS]->(c)
```

Jika node tidak ada, row tidak menghasilkan relationship.

Kelebihan:

- tidak membuat node palsu,
- graph lebih bersih.

Kekurangan:

- relationship missing bisa tidak terlihat jika tidak divalidasi.

Karena itu perlu reject/missing report.

### 11.2 Placeholder Mode

Jika endpoint belum ada, buat placeholder.

```cypher
MERGE (p:Person {personId: row.person_id})
ON CREATE SET p.placeholder = true,
              p.createdFrom = 'ownership_import'
MERGE (c:Company {companyId: row.company_id})
ON CREATE SET c.placeholder = true,
              c.createdFrom = 'ownership_import'
MERGE (p)-[:OWNS]->(c)
```

Kelebihan:

- topology tidak hilang,
- berguna untuk incomplete intelligence data.

Kekurangan:

- placeholder bisa menyebar menjadi data berkualitas rendah,
- analyst bisa salah menganggap node lengkap,
- perlu reconciliation.

Gunakan placeholder hanya jika domain memang menerima incomplete facts.

---

## 12. Identity Normalization

Identity adalah sumber masalah nomor satu dalam graph ingestion.

Contoh buruk:

```text
"PT ABC"
"PT. ABC"
"ABC Ltd"
"A.B.C. Limited"
"ABC LIMITED"
```

Jika langsung di-`MERGE` berdasarkan nama, graph akan duplicate.

Gunakan external ID jika tersedia:

```cypher
MERGE (o:Organization {registryId: row.registry_id})
```

Jika external ID tidak tersedia, butuh entity resolution:

- normalize name,
- normalize address,
- compare tax ID,
- compare phone/email/domain,
- compute similarity,
- store candidate matches,
- human review untuk high-risk merge.

Jangan diam-diam merge entity hanya berdasarkan fuzzy name dalam sistem audit-heavy.

Lebih defensible:

```text
(:Organization {orgId:'ORG-001'})
(:Organization {orgId:'ORG-002'})
(:EntityMatchCandidate {score:0.91, method:'name_address_similarity'})
(:Organization)-[:POSSIBLY_SAME_AS]->(:Organization)
```

Setelah review:

```text
(:Organization)-[:CONFIRMED_SAME_AS {reviewedBy, reviewedAt, evidenceId}]->(:Organization)
```

Atau materialize canonical entity dengan provenance.

---

## 13. Idempotent Import

Idempotent import berarti:

```text
Same input + same graph state -> same resulting graph state
```

Contoh non-idempotent:

```cypher
CREATE (p:Person {personId: row.person_id})
```

Jika job dijalankan dua kali, node duplicate.

Contoh idempotent:

```cypher
MERGE (p:Person {personId: row.person_id})
SET p.name = row.name
```

Namun relationship lebih tricky.

Buruk:

```cypher
MATCH (p:Person {personId: row.person_id})
MATCH (c:Company {companyId: row.company_id})
CREATE (p)-[:OWNS {sourceFile: $fileName}]->(c)
```

Akan duplicate setiap run.

Lebih baik:

```cypher
MATCH (p:Person {personId: row.person_id})
MATCH (c:Company {companyId: row.company_id})
MERGE (p)-[r:OWNS]->(c)
SET r.percentage = toFloat(row.percentage),
    r.lastSeenInBatch = $batchId
```

Tetapi ini hanya benar jika satu person-company pair hanya boleh punya satu `OWNS` relationship.

Jika ownership bisa berubah temporal, key relationship harus memasukkan valid period.

```cypher
MATCH (p:Person {personId: row.person_id})
MATCH (c:Company {companyId: row.company_id})
MERGE (p)-[r:OWNS {validFrom: date(row.valid_from)}]->(c)
SET r.percentage = toFloat(row.percentage),
    r.source = row.source
```

Pelajaran:

```text
MERGE key harus merepresentasikan identity domain, bukan sekadar kenyamanan teknis.
```

---

## 14. Batch Manifest

Setiap import batch production sebaiknya punya manifest.

Contoh node:

```text
(:ImportBatch {
  batchId,
  sourceSystem,
  sourceSnapshotId,
  startedAt,
  completedAt,
  status,
  inputRowCount,
  importedNodeCount,
  importedRelationshipCount,
  rejectedRowCount,
  checksum,
  schemaVersion,
  pipelineVersion
})
```

Relationship provenance:

```text
(:ImportBatch)-[:IMPORTED]->(:Person)
(:ImportBatch)-[:IMPORTED]->(:Company)
(:ImportBatch)-[:IMPORTED]->(:OwnershipFact)
```

At scale, jangan selalu connect batch ke jutaan node jika tidak perlu untuk traversal. Bisa simpan metadata properti:

```cypher
SET p.lastImportBatchId = $batchId,
    p.lastImportedAt = datetime()
```

Gunakan batch node untuk:

- audit,
- rollback planning,
- reconciliation,
- validation,
- operational observability.

---

## 15. Handling Deletes

Delete adalah bagian paling sering diremehkan.

Sumber mengirim:

```text
Customer removed
Account closed
Ownership ended
Case reassigned
Permission revoked
```

Apakah graph harus `DELETE`?

Belum tentu.

Ada beberapa model.

### 15.1 Physical Delete

```cypher
MATCH (p:Person {personId: $id})
DETACH DELETE p
```

Bahaya:

- menghapus history,
- menghapus evidence,
- memutus audit trail,
- menghilangkan alasan keputusan masa lalu,
- bisa melanggar retention/legal hold.

Cocok untuk:

- temporary staging graph,
- rebuildable projection,
- data yang memang harus dihapus karena privacy request setelah validasi.

### 15.2 Soft Delete

```cypher
MATCH (a:Account {accountId: $id})
SET a.deleted = true,
    a.deletedAt = datetime(),
    a.deleteSource = $source
```

Query production harus filter:

```cypher
MATCH (a:Account {deleted: false})
```

Atau lebih baik gunakan status:

```cypher
SET a.status = 'CLOSED'
```

### 15.3 Temporal End-Dating Relationship

Untuk relationship yang historis:

```cypher
MATCH (:Person {personId: $personId})-[r:OWNS]->(:Company {companyId: $companyId})
WHERE r.validTo IS NULL
SET r.validTo = date($endedAt),
    r.endedByBatch = $batchId
```

Ini lebih defensible untuk compliance/investigation.

### 15.4 Tombstone Node

Untuk distributed ingestion:

```text
(:Tombstone {entityType, externalId, deletedAt, sourceSystem})
```

Berguna untuk:

- mencegah resurrect dari late event,
- audit deletion,
- reconciliation.

---

## 16. Late Arriving Facts dan Out-of-Order Events

Dalam event-driven pipeline, event tidak selalu tiba sesuai waktu kejadian.

Contoh:

```text
T1: Account opened
T2: Account closed
T3: Event T1 terlambat diproses setelah T2
```

Jika pipeline naif, account bisa kembali `ACTIVE` setelah sudah closed.

Gunakan dua waktu:

```text
occurredAt  = waktu kejadian domain
processedAt = waktu pipeline memproses event
```

Jangan urutkan semantik domain berdasarkan `processedAt`.

Contoh pattern:

```cypher
MATCH (a:Account {accountId: $accountId})
WHERE a.lastEventOccurredAt IS NULL OR datetime($occurredAt) >= a.lastEventOccurredAt
SET a.status = $status,
    a.lastEventOccurredAt = datetime($occurredAt),
    a.lastProcessedAt = datetime()
```

Namun untuk audit, jangan selalu overwrite state tanpa menyimpan event/fact.

Model lebih kuat:

```text
(:Account)-[:HAS_EVENT]->(:AccountStatusEvent {status, occurredAt, eventId})
```

Lalu current state bisa materialized:

```text
(:Account {currentStatus:'CLOSED'})
```

Ingat:

```text
Event history dan current state adalah dua hal berbeda.
```

Graph sering membutuhkan keduanya.

---

## 17. Poison Message dan Dead Letter Queue

Poison message adalah event/record yang terus gagal diproses.

Penyebab:

- schema tidak valid,
- required field kosong,
- foreign key missing,
- type conversion gagal,
- constraint violation,
- Cypher bug,
- transient database issue yang diperlakukan sebagai permanent,
- data domain invalid.

Pipeline harus membedakan:

```text
Transient error -> retry
Permanent data error -> reject/DLQ
Bug/config error -> stop pipeline
```

Contoh classification:

| Error | Handling |
|---|---|
| Neo4j transient deadlock | retry with backoff |
| connection timeout | retry with circuit breaker |
| uniqueness violation | investigate duplicate identity / reject |
| missing required ID | reject to DLQ |
| unknown event type | DLQ or stop depending severity |
| invalid date format | reject with reason |
| Cypher syntax error | stop deployment/pipeline |

DLQ record minimal:

```json
{
  "messageId": "...",
  "sourceTopic": "account-events",
  "partition": 3,
  "offset": 99123,
  "errorType": "VALIDATION_ERROR",
  "errorMessage": "accountId is missing",
  "payloadHash": "...",
  "failedAt": "2026-06-21T12:00:00Z",
  "pipelineVersion": "graph-ingest-1.7.3"
}
```

Untuk audit-heavy systems, DLQ bukan tempat sampah. DLQ adalah controlled exception workflow.

---

## 18. Graph Projection Pipeline Architecture

Arsitektur umum:

```text
[Source Systems]
   | snapshot / events / CDC
   v
[Ingestion Boundary]
   | validate, normalize, deduplicate
   v
[Transform Layer]
   | domain -> graph commands
   v
[Neo4j Write Layer]
   | parameterized Cypher, transactions, retries
   v
[Validation/Reconciliation]
   | counts, samples, invariants, drift check
   v
[Graph Consumers]
   | API, analyst, GDS, search, downstream
```

Untuk Java engineer, pecah menjadi komponen:

```text
GraphIngestionController / Consumer
GraphEventValidator
IdentityNormalizer
GraphCommandMapper
Neo4jGraphWriter
IngestionCheckpointStore
DeadLetterPublisher
ReconciliationJob
ImportAuditRepository
```

Jangan jadikan consumer Kafka langsung menjalankan Cypher besar tanpa lapisan domain.

---

## 19. Graph Command Pattern

Daripada event langsung menjadi Cypher, ubah dulu menjadi command graph eksplisit.

Event:

```json
{
  "eventId": "evt-1001",
  "type": "OWNERSHIP_REGISTERED",
  "personId": "P001",
  "companyId": "C001",
  "percentage": 75.0,
  "occurredAt": "2026-06-21T10:00:00Z"
}
```

Command:

```java
public record UpsertOwnershipCommand(
    String eventId,
    String personId,
    String companyId,
    BigDecimal percentage,
    Instant occurredAt,
    String sourceSystem
) {}
```

Writer:

```java
public void upsertOwnership(UpsertOwnershipCommand command) {
    driver.executableQuery("""
        MERGE (e:IngestedEvent {eventId: $eventId})
        ON CREATE SET e.sourceSystem = $sourceSystem,
                      e.occurredAt = datetime($occurredAt),
                      e.processedAt = datetime()
        WITH e
        MATCH (p:Person {personId: $personId})
        MATCH (c:Company {companyId: $companyId})
        MERGE (p)-[r:OWNS]->(c)
        SET r.percentage = $percentage,
            r.lastEventId = $eventId,
            r.lastUpdatedAt = datetime()
        MERGE (e)-[:APPLIED_TO]->(r)
        """)
        .withParameters(Map.of(
            "eventId", command.eventId(),
            "sourceSystem", command.sourceSystem(),
            "occurredAt", command.occurredAt().toString(),
            "personId", command.personId(),
            "companyId", command.companyId(),
            "percentage", command.percentage()
        ))
        .execute();
}
```

Catatan penting:

- contoh ini konseptual,
- relationship sebagai target `MERGE (e)-[:APPLIED_TO]->(r)` tidak selalu valid dalam semua bentuk Cypher modelling karena relationship tidak bisa menjadi node; jika butuh event-to-fact linking, reify relationship menjadi `(:OwnershipFact)`, atau simpan `lastEventId` di relationship.

Model yang lebih audit-friendly:

```text
(:Person)-[:HAS_OWNERSHIP_FACT]->(:OwnershipFact)-[:OF_COMPANY]->(:Company)
(:IngestedEvent)-[:CREATED_FACT]->(:OwnershipFact)
```

Trade-off:

- relationship langsung lebih cepat untuk traversal,
- reified fact lebih kuat untuk provenance/history/audit.

---

## 20. Rebuildable Projection Strategy

Jika Neo4j adalah projection, desain agar bisa dibangun ulang.

```text
Source snapshot + deterministic transform + versioned pipeline = reproducible graph
```

Simpan:

- source snapshot ID,
- pipeline version,
- schema version,
- transform config,
- input checksum,
- output counts,
- validation report.

Rebuild flow:

```text
1. Create new database or staging graph
2. Apply constraints/indexes
3. Import nodes
4. Import relationships
5. Run validation
6. Run performance smoke tests
7. Switch consumers / promote database
8. Keep old graph until rollback window passes
```

Jangan rebuild langsung di production database tanpa strategi swap/rollback untuk graph besar.

---

## 21. Staging Graph vs Production Graph

Untuk import besar, gunakan staging.

```text
staging graph -> validate -> promote -> production
```

Staging memungkinkan:

- import gagal tanpa merusak production,
- validasi invariant,
- test query performance,
- compare counts,
- run analyst sampling,
- rollback mudah.

Promosi bisa berupa:

- database switch,
- application config switch,
- blue/green Neo4j database,
- alias switch jika arsitektur mendukung,
- controlled cutover.

---

## 22. Validation: Jangan Percaya Import yang “Sukses”

Import sukses secara teknis belum tentu benar secara domain.

Validasi minimal:

### 22.1 Count Validation

```cypher
MATCH (p:Person)
RETURN count(p) AS personCount;

MATCH (:Person)-[r:OWNS]->(:Company)
RETURN count(r) AS ownershipCount;
```

Bandingkan dengan source.

### 22.2 Missing Endpoint Validation

Jika strict mode:

```text
relationship_rows_source - relationship_created = rejected_or_missing_rows
```

Jangan biarkan selisih tanpa penjelasan.

### 22.3 Duplicate Validation

```cypher
MATCH (p:Person)
WITH p.personId AS id, count(*) AS c
WHERE c > 1
RETURN id, c
LIMIT 100;
```

Jika constraint sudah benar, ini tidak boleh terjadi.

### 22.4 Orphan Validation

```cypher
MATCH (c:Company)
WHERE NOT (:Person)-[:OWNS]->(c)
RETURN c.companyId
LIMIT 100;
```

Orphan tidak selalu salah, tetapi harus diketahui.

### 22.5 Domain Invariant Validation

Contoh ownership percentage:

```cypher
MATCH (:Person)-[r:OWNS]->(c:Company)
WITH c, sum(r.percentage) AS total
WHERE total > 100.0
RETURN c.companyId, total;
```

Contoh active case harus punya subject:

```cypher
MATCH (case:Case {status: 'ACTIVE'})
WHERE NOT (case)-[:HAS_SUBJECT]->(:Subject)
RETURN case.caseId
LIMIT 100;
```

### 22.6 Traversal Smoke Test

Jalankan query critical path.

```cypher
MATCH path = (:Person {personId: $id})-[:OWNS|CONTROLS*1..3]->(:Company)
RETURN count(path) AS pathCount;
```

Validasi bukan hanya data ada, tapi graph bisa menjawab pertanyaan.

---

## 23. Reconciliation

Reconciliation menjawab:

```text
Apakah graph masih sama secara semantic dengan source-of-truth?
```

Jenis reconciliation:

1. **count-based**  
   jumlah entity/relationship per type.

2. **checksum-based**  
   hash subset field penting.

3. **sample-based**  
   ambil random sample source, cek graph.

4. **invariant-based**  
   aturan domain.

5. **query-result-based**  
   bandingkan hasil query bisnis.

6. **temporal reconciliation**  
   cek drift sejak batch/event tertentu.

Reconciliation job harus menghasilkan report.

```text
ReconciliationReport
- reportId
- graphDatabase
- sourceSnapshotId
- startedAt
- completedAt
- status
- entityCounts
- relationshipCounts
- mismatchSamples
- invariantViolations
- recommendedAction
```

Dalam sistem regulated, report ini bisa sama pentingnya dengan pipeline itu sendiri.

---

## 24. Backfill vs Replay

Backfill dan replay sering tertukar.

### 24.1 Backfill

Backfill berarti mengisi data historis yang belum pernah ada di graph.

Contoh:

```text
Import transaksi 5 tahun terakhir untuk membangun fraud network.
```

Backfill biasanya:

- volume besar,
- urutan historis penting,
- bisa mempengaruhi derived edges/scores,
- butuh staging.

### 24.2 Replay

Replay berarti menjalankan ulang event yang sudah pernah diproses.

Contoh:

```text
Replay event sejak offset Kafka tertentu setelah bug fix.
```

Replay harus idempotent.

Jika tidak, graph duplicate atau state corrupt.

### 24.3 Recompute

Recompute berarti menghitung ulang derived graph.

Contoh:

```text
Hapus semua :RELATED_TO hasil entity-resolution v1, lalu buat ulang dengan v2.
```

Derived edge harus diberi metadata:

```cypher
MATCH ()-[r:RELATED_TO {derivedBy: 'entity-resolution-v1'}]->()
DELETE r;
```

Tanpa metadata, Anda tidak tahu mana edge manual, mana edge derived.

---

## 25. Derived Edge Materialization

Graph projection sering membuat derived edge untuk mempercepat traversal.

Contoh raw graph:

```text
(:Person)-[:HAS_ACCOUNT]->(:Account)-[:TRANSFERRED_TO]->(:Account)<-[:HAS_ACCOUNT]-(:Person)
```

Derived edge:

```text
(:Person)-[:TRANSACTED_WITH {count, amount, firstSeen, lastSeen}]->(:Person)
```

Keuntungan:

- query fraud ring lebih cepat,
- analyst lebih mudah melihat network,
- GDS projection lebih sederhana.

Risiko:

- derived edge bisa stale,
- double counting,
- provenance hilang,
- update incremental sulit,
- query bisa mencampur raw dan derived edge.

Best practice:

```text
Selalu tandai derived relationship dengan method/version/source/window.
```

Contoh:

```cypher
MERGE (p1)-[r:TRANSACTED_WITH]->(p2)
SET r.amount30d = $amount30d,
    r.txCount30d = $count30d,
    r.window = 'P30D',
    r.derivedBy = 'tx-aggregation-job',
    r.derivedVersion = '2.1.0',
    r.computedAt = datetime()
```

---

## 26. Importing for GDS vs Importing for Operational Query

Operational graph dan analytical graph tidak selalu sama.

Operational graph:

- kaya metadata,
- audit-friendly,
- temporal detail,
- property lengkap,
- query transaction-oriented,
- update sering.

GDS graph:

- projection sederhana,
- node/relationship type terbatas,
- weight jelas,
- memory-efficient,
- algorithm-ready.

Jangan paksa operational model langsung menjadi GDS model.

Lebih baik:

```text
Operational Neo4j graph -> GDS projection query -> in-memory analytical graph -> algorithm result -> write/mutate score if needed
```

Contoh:

```cypher
MATCH (a:Account)-[t:TRANSFERRED_TO]->(b:Account)
WHERE t.amount > 1000000
RETURN id(a) AS source, id(b) AS target, t.amount AS weight
```

Untuk GDS, pertanyaannya:

- node apa yang masuk projection,
- relationship apa yang masuk,
- directed atau undirected,
- weight dari mana,
- time window apa,
- apakah relationship aggregated,
- apakah graph terlalu besar untuk memory.

---

## 27. Multi-Tenant Import

Jika graph multi-tenant, import harus menjaga isolasi.

Pattern umum:

### 27.1 Tenant Property

```text
(:Person {tenantId, personId})
```

Constraint composite:

```cypher
CREATE CONSTRAINT tenant_person_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE (p.tenantId, p.personId) IS UNIQUE;
```

Query harus selalu filter tenant.

Risiko:

- query lupa filter tenant,
- accidental cross-tenant relationship.

### 27.2 Tenant Node

```text
(:Tenant {tenantId})-[:HAS_PERSON]->(:Person)
```

Bisa membantu traversal dan visibility, tetapi tetap butuh constraints.

### 27.3 Database per Tenant

Lebih kuat isolasi, lebih mahal operasional.

Import pipeline harus tenant-aware:

- tenant validation,
- tenant-specific source mapping,
- no cross-tenant merge,
- tenant-level reconciliation.

Rule:

```text
Relationship cross-tenant harus explicit dan rare.
```

---

## 28. Performance Design for Import

Import performa buruk biasanya karena:

- constraint/index belum dibuat,
- `MERGE` memakai banyak property,
- relationship endpoint lookup tidak indexed,
- terlalu banyak transaction kecil,
- transaction terlalu besar,
- query menciptakan cartesian product,
- repeated parsing query karena tidak parameterized,
- page cache tidak cukup,
- disk I/O bottleneck,
- import mencampur transform kompleks dan write besar.

Guideline:

1. buat constraint/index sebelum import,
2. batch berdasarkan ukuran realistis,
3. gunakan parameterized queries,
4. pisahkan node dan relationship import,
5. hindari `MERGE` dengan dynamic label/type sembarangan,
6. hindari `MATCH` tanpa key indexed,
7. commit berkala,
8. ukur `PROFILE` pada sample query import,
9. monitor page cache, heap, GC, disk,
10. jangan import besar saat peak traffic tanpa isolasi.

---

## 29. Java Batch Writer Pattern

Contoh struktur sederhana:

```java
public final class Neo4jBatchWriter<T> {
    private final Driver driver;
    private final int batchSize;
    private final Function<List<T>, QuerySpec> queryFactory;

    public void write(Stream<T> records) {
        List<T> batch = new ArrayList<>(batchSize);
        records.forEach(record -> {
            batch.add(record);
            if (batch.size() >= batchSize) {
                flush(batch);
                batch.clear();
            }
        });
        if (!batch.isEmpty()) {
            flush(batch);
        }
    }

    private void flush(List<T> batch) {
        QuerySpec query = queryFactory.apply(batch);
        try (Session session = driver.session()) {
            session.executeWrite(tx -> {
                tx.run(query.cypher(), query.parameters()).consume();
                return null;
            });
        }
    }
}
```

Cypher batch pattern:

```cypher
UNWIND $rows AS row
MERGE (p:Person {personId: row.personId})
SET p.name = row.name,
    p.country = row.country,
    p.updatedAt = datetime()
```

Relationship batch:

```cypher
UNWIND $rows AS row
MATCH (p:Person {personId: row.personId})
MATCH (c:Company {companyId: row.companyId})
MERGE (p)-[r:OWNS]->(c)
SET r.percentage = row.percentage,
    r.updatedAt = datetime()
```

Caution:

- batch terlalu besar bisa membebani memory/transaction,
- batch terlalu kecil overhead tinggi,
- ukur dengan data nyata,
- retry harus memperhatikan idempotency.

---

## 30. Checkpointing

Streaming consumer harus tahu sampai mana event diproses.

Kafka sudah punya offset, tetapi graph pipeline mungkin butuh checkpoint domain.

Checkpoint bisa disimpan di:

- Kafka consumer group offset,
- external checkpoint store,
- Neo4j `(:IngestionCheckpoint)` node,
- relational metadata table.

Contoh:

```text
(:IngestionCheckpoint {
  pipeline: 'account-to-graph',
  source: 'kafka:account-events',
  partition: 3,
  offset: 99123,
  updatedAt: datetime()
})
```

Masalah penting:

```text
Kapan offset dianggap committed?
```

Idealnya setelah write ke Neo4j sukses.

Jika commit offset sebelum write sukses, event hilang.

Jika write sukses tapi offset gagal commit, event diproses ulang.

Karena itu writer harus idempotent.

---

## 31. Exactly-Once Illusion

Banyak sistem mengklaim exactly-once, tetapi end-to-end across source -> pipeline -> Neo4j -> downstream tetap sulit.

Mental model yang lebih aman:

```text
Assume at-least-once delivery.
Make writes idempotent.
Detect duplicates.
Use reconciliation.
```

Gunakan `eventId`:

```cypher
MERGE (e:IngestedEvent {eventId: $eventId})
ON CREATE SET e.processedAt = datetime(), e.status = 'APPLIED'
ON MATCH SET e.duplicateSeenAt = datetime()
```

Tetapi hati-hati:

Jika query selalu lanjut setelah event sudah ada, duplicate masih bisa mengubah state.

Pattern:

```cypher
MERGE (e:IngestedEvent {eventId: $eventId})
ON CREATE SET e.processedAt = datetime(), e.new = true
WITH e
WHERE e.new = true
// apply mutation only once
```

Di Neo4j, property temporary seperti `e.new` perlu dibersihkan atau dimodelkan lebih baik. Di application layer, sering lebih jelas:

1. coba create event marker dengan uniqueness constraint,
2. jika duplicate, skip,
3. jika create sukses, apply mutation dalam transaction yang sama.

---

## 32. Schema Evolution in Pipeline

Source schema berubah.

Event v1:

```json
{
  "personId": "P001",
  "companyId": "C001"
}
```

Event v2:

```json
{
  "subject": {"type": "PERSON", "id": "P001"},
  "object": {"type": "COMPANY", "id": "C001"},
  "relationship": "OWNS",
  "confidence": 0.93
}
```

Pipeline harus version-aware.

Simpan:

- event schema version,
- graph schema version,
- transform version,
- mapping version.

Jangan biarkan transform berubah diam-diam tanpa metadata, karena hasil graph lama dan baru akan campur.

Untuk derived data:

```text
derivedVersion wajib.
```

---

## 33. Security dan Data Governance dalam Import

Import pipeline sering punya privilege tinggi.

Risiko:

- memasukkan data lintas tenant,
- memasukkan PII tanpa masking,
- log payload sensitif,
- DLQ berisi data rahasia,
- staging database tidak diamankan,
- analyst melihat data sebelum validasi,
- pipeline service account bisa melakukan destructive query.

Checklist:

1. service account terpisah,
2. least privilege,
3. environment isolation,
4. secret management,
5. payload redaction di log,
6. DLQ encrypted/controlled,
7. audit import action,
8. validation sebelum publish,
9. retention policy untuk raw files,
10. legal hold awareness.

Untuk regulatory/enforcement system, provenance bukan opsional.

---

## 34. Import Failure Modes

| Failure Mode | Gejala | Penyebab | Pencegahan |
|---|---|---|---|
| Duplicate nodes | entity sama muncul berkali-kali | no constraint, bad key normalization | unique constraint, identity normalization |
| Duplicate relationships | edge count terus naik setiap replay | `CREATE` bukan `MERGE` | relationship identity design |
| Missing relationships | graph terlihat sparse | endpoint missing, strict match silently drops | reject report, placeholder policy |
| Stale derived edges | query memberi hasil lama | recompute gagal/partial | derived version + computedAt |
| Tenant leakage | data tenant A connect tenant B | missing tenant key/filter | composite key, tenant validation |
| Graph drift | graph beda dari source | missed events, failed batch | reconciliation |
| State regression | old event overwrite new state | out-of-order processing | occurredAt guard/version check |
| Poison message loop | consumer stuck | permanent bad data retried forever | DLQ + error classification |
| Import overload | DB latency naik | huge transaction, peak-time import | batching, staging, scheduling |
| Audit gap | tidak tahu asal fakta | no provenance | batch/event metadata |
| Delete damage | history hilang | physical delete naive | temporal/end-date/tombstone |

---

## 35. Case Study: Enforcement Investigation Graph Pipeline

Bayangkan sistem enforcement lifecycle.

Source systems:

```text
- Master Data Management: Person, Organization
- Core Registry: Company ownership
- Transaction Platform: Transaction events
- Case Management: Case, Allegation, Action
- Evidence Store: Documents, Attachments, Statements
- Officer Directory: Staff, Unit, Role
- Regulation Repository: Regulation, Article, Violation Type
```

Target graph questions:

1. Siapa related party dari subject case ini dalam 3 hop?
2. Apakah subject punya hubungan dengan case sebelumnya?
3. Apakah ada officer conflict-of-interest?
4. Apakah entity ini terhubung ke organization high-risk?
5. Evidence mana yang mendukung allegation tertentu?
6. Bagaimana escalation path case ini?
7. Apakah pattern transaksi mirip dengan fraud ring sebelumnya?

### 35.1 Ownership Matrix

| Element | Source | Pipeline | Mutable in Graph? |
|---|---|---|---|
| Person | MDM | mdm-snapshot-import | no |
| Organization | MDM/Registry | org-import | no |
| Company ownership | Registry | ownership-cdc | no, temporal |
| Case | Case Management | case-event-consumer | controlled |
| Evidence | Evidence Store | evidence-sync | controlled |
| Officer | Directory | staff-import | no |
| Regulation | Regulation Repository | regulation-import | controlled/versioned |
| Risk score | GDS/ML job | risk-score-job | derived |
| Analyst note | Investigation UI | analyst-service | yes |

### 35.2 Pipeline Design

```text
Initial snapshot:
1. Import Person/Organization/Officer/Regulation nodes
2. Import Company ownership relationships
3. Import Cases and Evidence
4. Validate constraints and counts
5. Run critical traversal tests

Streaming:
1. Consume case lifecycle events
2. Consume ownership changes
3. Consume evidence metadata updates
4. Consume risk signal events
5. Update graph idempotently
6. Write event markers
7. Reconcile nightly

Batch enrichment:
1. Run entity resolution
2. Create POSSIBLY_SAME_AS candidates
3. Run analyst review workflow
4. Materialize CONFIRMED_SAME_AS
5. Recompute related-party derived edges
6. Update risk score
```

### 35.3 Example Model

```text
(:Person {personId})
(:Organization {orgId})
(:Case {caseId})
(:Evidence {evidenceId})
(:Regulation {regulationId})
(:Officer {officerId})
(:ImportBatch {batchId})
(:IngestedEvent {eventId})

(:Person)-[:OWNS {validFrom, validTo, percentage, source}]->(:Organization)
(:Person)-[:SUBJECT_OF]->(:Case)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Case)-[:ALLEGES_VIOLATION_OF]->(:Regulation)
(:Officer)-[:REVIEWED]->(:Case)
(:Person)-[:RELATED_TO {method, confidence, derivedVersion}]->(:Person)
(:ImportBatch)-[:PRODUCED]->(:IngestionReport)
```

### 35.4 Defensibility Requirements

Untuk setiap fakta penting:

```text
What is the source?
When was it imported?
Which pipeline version transformed it?
Was it manually reviewed?
Is it current or historical?
Can we reproduce it?
Can we explain it to an auditor?
```

Jika jawabannya tidak jelas, graph belum production-grade untuk enforcement.

---

## 36. Practical Checklist: Before Writing Any Import Pipeline

Jawab pertanyaan ini:

1. Apakah Neo4j source-of-truth atau projection?
2. Apa external ID untuk setiap node utama?
3. Apa identity relationship?
4. Apakah relationship historical atau current-state only?
5. Apakah delete berarti remove, close, end-date, atau tombstone?
6. Apakah event bisa duplicate?
7. Apakah event bisa out-of-order?
8. Apakah pipeline bisa replay?
9. Apa constraint yang harus ada sebelum import?
10. Apa batch size aman?
11. Apa error yang retryable?
12. Apa error yang masuk DLQ?
13. Bagaimana reconciliation dilakukan?
14. Bagaimana provenance disimpan?
15. Bagaimana import divalidasi sebelum dipublish?
16. Bagaimana rollback/rebuild?
17. Apakah data sensitif masuk log/DLQ?
18. Siapa owner setiap graph element?
19. Apa critical graph questions yang harus diuji setelah import?
20. Apa metric/alert pipeline?

---

## 37. Recommended Pipeline Observability

Metrics:

```text
records_read_total
records_validated_total
records_rejected_total
nodes_created_total
nodes_matched_total
relationships_created_total
relationships_matched_total
write_latency_ms
batch_duration_ms
neo4j_transient_errors_total
constraint_violations_total
dlq_messages_total
reconciliation_mismatch_total
last_successful_batch_timestamp
consumer_lag
```

Logs:

- batch ID,
- source snapshot ID,
- schema version,
- pipeline version,
- query name, not full sensitive payload,
- error class,
- rejected reason,
- correlation ID.

Dashboards:

- ingestion throughput,
- lag,
- error rate,
- Neo4j CPU/memory/page cache,
- slow query logs,
- DLQ volume,
- reconciliation status.

Alerts:

- no successful batch in expected window,
- DLQ spike,
- constraint violation spike,
- consumer lag above threshold,
- reconciliation mismatch above tolerance,
- Neo4j write latency degradation,
- import job stuck.

---

## 38. Common Design Smells

### Smell 1: “We Just Need to Dump Tables into Neo4j”

Itu bukan graph modelling. Itu table mirroring.

Perbaikan:

- mulai dari graph questions,
- tentukan path yang harus murah,
- transform rows menjadi semantic relationships.

### Smell 2: “Connector Config Is Our Business Logic”

Jika relationship semantics, temporal rules, tenant isolation, dan provenance tersembunyi di config connector, sulit diuji dan diaudit.

Perbaikan:

- gunakan explicit transform layer,
- version mapping,
- test graph command.

### Smell 3: “We Can Always Rebuild” Tapi Tidak Ada Snapshot

Rebuildable hanya benar jika input dan transform version tersedia.

Perbaikan:

- simpan manifest,
- simpan source snapshot ID,
- simpan transform version,
- run rebuild drill.

### Smell 4: “MERGE Everything”

`MERGE` tanpa identity domain yang benar bisa menyatukan fakta yang seharusnya berbeda.

Perbaikan:

- definisikan identity per node/relationship/fact,
- gunakan constraints,
- gunakan temporal fact node jika perlu.

### Smell 5: “Delete Means Delete”

Dalam compliance/investigation, delete sering berarti status berubah, bukan fakta hilang.

Perbaikan:

- gunakan validTo,
- tombstone,
- retention policy,
- legal hold.

---

## 39. Summary Mental Model

Part ini bisa diringkas seperti ini:

```text
Graph import adalah proses membangun topology bermakna dari sumber data eksternal.
Topology itu harus benar secara identity, relationship, waktu, provenance, dan invariant domain.
```

Untuk Neo4j production-grade:

1. jangan mulai dari file/connector; mulai dari source ownership dan graph questions,
2. buat constraints sebelum import,
3. bedakan node import dan relationship import,
4. desain identity secara eksplisit,
5. buat pipeline idempotent,
6. simpan provenance,
7. tangani delete secara domain-aware,
8. siapkan DLQ dan retry classification,
9. lakukan validation dan reconciliation,
10. buat graph projection rebuildable,
11. jangan percaya import sukses sebelum query critical path lolos,
12. perlakukan import sebagai bagian dari architecture, bukan script sementara.

---

## 40. Latihan Praktis

### Latihan 1 — Import Design Review

Ambil domain sederhana:

```text
Person, Organization, Account, Transaction, Case
```

Buat:

1. source-of-truth matrix,
2. node identity table,
3. relationship identity table,
4. delete handling policy,
5. import order,
6. validation queries,
7. reconciliation report structure.

### Latihan 2 — Idempotent Cypher

Buat Cypher import untuk:

```text
Person owns Organization with percentage and validFrom.
```

Syarat:

- bisa dijalankan dua kali tanpa duplicate,
- ownership historis tidak overwrite periode berbeda,
- source batch disimpan,
- invalid percentage ditolak di application layer.

### Latihan 3 — Out-of-Order Event

Desain handler untuk event:

```text
ACCOUNT_STATUS_CHANGED(accountId, status, occurredAt, eventId)
```

Syarat:

- duplicate event tidak mengubah state dua kali,
- event lama tidak menimpa state baru,
- history event tetap tersimpan,
- current status mudah dibaca.

### Latihan 4 — Reconciliation Query

Buat minimal lima query untuk memastikan:

- tidak ada duplicate Person,
- semua active Case punya subject,
- semua Evidence terhubung ke Case,
- ownership percentage tidak melebihi 100 untuk active ownership,
- tidak ada cross-tenant relationship ilegal.

---

## 41. Referensi Resmi

- Neo4j Getting Started — Data Import: https://neo4j.com/docs/getting-started/data-import/
- Neo4j Getting Started — Import CSV using `LOAD CSV`: https://neo4j.com/docs/getting-started/data-import/csv-import/
- Neo4j Cypher Manual — `LOAD CSV`: https://neo4j.com/docs/cypher-manual/current/clauses/load-csv/
- Neo4j Operations Manual — `neo4j-admin database import`: https://neo4j.com/docs/operations-manual/current/import/
- Neo4j Operations Manual — Kubernetes import data: https://neo4j.com/docs/operations-manual/current/kubernetes/import-data/
- Neo4j Change Data Capture Documentation: https://neo4j.com/docs/cdc/current/
- Neo4j Connector for Kafka: https://neo4j.com/docs/kafka/current/
- Neo4j Kafka Connector Sink Configuration: https://neo4j.com/docs/kafka/current/sink/
- Neo4j Kafka Connector CDC Source Strategy: https://neo4j.com/docs/kafka/current/source/cdc/
- Neo4j APOC Import CSV: https://neo4j.com/docs/apoc/current/import/import-csv/
- Neo4j APOC Load JSON: https://neo4j.com/docs/apoc/current/import/load-json/

---

## 42. Penutup

Jika Part 014 membahas bagaimana aplikasi Java berbicara dengan Neo4j, Part 015 membahas bagaimana graph hidup dari aliran data nyata.

Kesalahan import jarang terlihat langsung. Query masih bisa return data. UI masih bisa menampilkan node. Tetapi secara semantic graph bisa salah total.

Seorang engineer yang kuat di graph database harus bisa bertanya:

```text
Apakah graph ini benar, bisa diulang, bisa dijelaskan, dan bisa dipertanggungjawabkan?
```

Bukan hanya:

```text
Apakah script import selesai tanpa error?
```

Pada part berikutnya, kita akan masuk ke **Transactions, Consistency, and Correctness in Graph Workloads**: bagaimana menjaga invariant graph saat aplikasi melakukan mutation kompleks, concurrent writes, retry, causal consistency, dan compensating action.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Spring Data Neo4j: Productivity, Boundaries, and Traps</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-016.md">Part 016 — Transactions, Consistency, and Correctness in Graph Workloads ➡️</a>
</div>
