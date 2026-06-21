# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-010.md

# Part 010 — Write Modelling: `MERGE`, Idempotency, Upserts, and Concurrency

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: correctness dan robustness saat menulis data graph ke Neo4j  
> Status seri: Part 010 dari 032

---

## 0. Posisi Bagian Ini dalam Seri

Sampai Part 009, kita sudah membangun fondasi:

- kapan graph database masuk akal,
- cara berpikir node/relationship/path,
- property graph model,
- arsitektur Neo4j,
- dasar Cypher,
- path semantics,
- modelling methodology,
- advanced modelling patterns,
- anti-pattern modelling,
- constraints dan indexes.

Bagian ini masuk ke wilayah yang sering terlihat sederhana tetapi menjadi sumber bug production paling mahal: **menulis graph dengan benar**.

Di relational database, banyak engineer terbiasa berpikir:

```sql
INSERT ... ON CONFLICT DO UPDATE
```

atau:

```sql
UPDATE ... WHERE id = ?
```

Di document database, kita terbiasa dengan:

```text
upsert document by _id
```

Di Neo4j, write operation tampak sederhana karena ada `CREATE`, `MERGE`, dan `SET`. Namun di graph database, write operation bukan hanya “buat record”. Sering kali write berarti:

- buat node jika belum ada,
- hubungkan node jika relationship belum ada,
- update property relationship,
- jaga invariant lintas node,
- hindari duplicate entity,
- hindari duplicate relationship,
- tangani concurrent writes,
- jaga idempotency dari event ingestion,
- retry transient failure dengan aman,
- batasi transaction agar tidak terlalu besar,
- dan pastikan model tetap queryable.

Kalau bagian query performance menjawab pertanyaan:

> “Bagaimana membaca graph dengan cepat?”

maka bagian ini menjawab:

> “Bagaimana menulis graph tanpa merusak kebenaran model?”

---

## 1. Core Mental Model: Graph Write Bukan Sekadar Insert

Dalam graph database, satu command write sering memodifikasi beberapa hal sekaligus:

```text
(:Person {personId})
(:Organization {orgId})
(:Case {caseId})
(:Evidence {evidenceId})
(:Officer {officerId})

(:Person)-[:OWNS]->(:Organization)
(:Organization)-[:SUBJECT_OF]->(:Case)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Officer)-[:REVIEWED]->(:Case)
```

Satu event seperti “case opened” bisa berarti:

1. pastikan subject entity ada,
2. pastikan case node ada,
3. buat relationship `SUBJECT_OF`,
4. buat initial state node atau property,
5. hubungkan source system,
6. simpan evidence/provenance,
7. catat officer/context,
8. update derived edge atau status projection.

Jadi write path di Neo4j biasanya lebih mirip **small graph transformation** daripada single-row mutation.

Mental model yang perlu dipegang:

```text
Write command = transition dari graph state lama ke graph state baru,
dengan invariant yang harus tetap benar sebelum dan sesudah transition.
```

Sebagai Java engineer, pikirkan setiap write sebagai command handler:

```text
Command
  -> validate input
  -> resolve identity
  -> acquire/derive required nodes
  -> create/update relationships
  -> update properties
  -> preserve invariants
  -> commit transaction
  -> emit/return result
```

Jika tidak diperlakukan seperti command handler, Neo4j write mudah berubah menjadi kumpulan query ad-hoc yang tidak idempotent dan sulit diaudit.

---

## 2. `CREATE` vs `MERGE`: Perbedaan Fundamental

Dua primitive write paling awal:

```cypher
CREATE
MERGE
```

Secara kasar:

```text
CREATE = selalu buat sesuatu yang baru.
MERGE  = cocokkan pattern; jika tidak ada, buat pattern tersebut.
```

Namun definisi kasar ini sering menipu.

### 2.1 `CREATE`: “Saya Ingin Object Baru”

Contoh:

```cypher
CREATE (:Case {
  caseId: $caseId,
  status: 'OPEN',
  createdAt: datetime()
})
```

`CREATE` cocok untuk fakta bahwa sesuatu memang selalu baru:

- audit log entry,
- immutable event node,
- observation baru,
- evidence artifact baru,
- review note baru,
- snapshot baru,
- state transition record baru.

Contoh:

```cypher
MATCH (c:Case {caseId: $caseId})
CREATE (c)-[:HAS_EVENT]->(:CaseEvent {
  eventId: $eventId,
  type: 'STATUS_CHANGED',
  fromStatus: $from,
  toStatus: $to,
  occurredAt: datetime($occurredAt),
  source: $source
})
```

Jika event memang immutable dan `eventId` unik, `CREATE` bisa valid, tetapi tetap sebaiknya didukung constraint jika event bisa dikirim ulang.

### 2.2 `MERGE`: “Saya Ingin State Ini Ada Tepat Satu Kali Menurut Pattern Tertentu”

Contoh:

```cypher
MERGE (p:Person {personId: $personId})
ON CREATE SET
  p.createdAt = datetime(),
  p.source = $source
ON MATCH SET
  p.lastSeenAt = datetime()
RETURN p
```

`MERGE` cocok untuk:

- upsert entity by stable identity,
- idempotent ingestion,
- relationship yang secara domain hanya boleh ada satu antara dua node untuk type tertentu,
- materialized edge yang bisa dihitung ulang,
- external reference node.

Tetapi `MERGE` bukan magic deduplication. `MERGE` hanya menjamin pattern yang ditulis di query, bukan intent yang ada di kepala engineer.

---

## 3. `MERGE` adalah Pattern-Based, Bukan Entity-Based

Ini aturan paling penting:

```text
MERGE bekerja pada keseluruhan pattern yang diberikan.
```

Contoh buruk:

```cypher
MERGE (p:Person {personId: $personId, name: $name})
```

Jika nama berubah dari `"Budi"` ke `"Budi Santoso"`, query ini dapat membuat node baru karena pattern full property tidak sama.

Lebih baik:

```cypher
MERGE (p:Person {personId: $personId})
ON CREATE SET
  p.createdAt = datetime()
SET
  p.name = $name,
  p.updatedAt = datetime()
```

Prinsip:

```text
Properties untuk identity masuk ke MERGE.
Properties mutable masuk ke SET.
```

### 3.1 Identity Properties vs Attribute Properties

Pisahkan dua kategori:

| Kategori | Contoh | Masuk `MERGE`? |
|---|---|---:|
| Stable identity | `personId`, `caseId`, `accountId`, `sourceSystemId` | Ya |
| Mutable display attribute | `name`, `emailDisplay`, `status`, `riskScore` | Tidak |
| Audit property | `createdAt`, `updatedAt`, `lastSeenAt` | Tidak |
| Derived property | `caseCount`, `centralityScore` | Tidak |
| External classification | `segment`, `riskBand` | Biasanya tidak |

Contoh:

```cypher
MERGE (a:Account {accountId: $accountId})
ON CREATE SET
  a.createdAt = datetime(),
  a.createdBy = $actor
SET
  a.status = $status,
  a.updatedAt = datetime(),
  a.lastSourceEventId = $eventId
```

### 3.2 `MERGE` pada Full Pattern Bisa Membuat Node Tak Terduga

Contoh problematis:

```cypher
MERGE (p:Person {personId: $personId})-[:OWNS]->(o:Organization {orgId: $orgId})
```

Kelihatannya benar. Tapi pattern tersebut terdiri dari:

```text
person node + relationship + organization node
```

Jika person sudah ada tapi organization belum ada, Neo4j akan membuat organization dan relationship. Jika organization sudah ada tapi person belum ada, person dibuat. Jika dua-duanya ada tapi relationship belum ada, relationship dibuat.

Itu bisa valid, tetapi sering kali terlalu banyak tanggung jawab dalam satu `MERGE`.

Untuk write production, lebih eksplisit:

```cypher
MERGE (p:Person {personId: $personId})
  ON CREATE SET p.createdAt = datetime()
MERGE (o:Organization {orgId: $orgId})
  ON CREATE SET o.createdAt = datetime()
MERGE (p)-[r:OWNS]->(o)
  ON CREATE SET r.createdAt = datetime()
SET
  r.source = $source,
  r.updatedAt = datetime()
RETURN p, r, o
```

Lebih verbose, tetapi lebih defensible.

---

## 4. `ON CREATE SET` dan `ON MATCH SET`

`MERGE` dapat dibedakan antara saat object baru dibuat dan saat sudah ditemukan.

```cypher
MERGE (c:Case {caseId: $caseId})
ON CREATE SET
  c.createdAt = datetime(),
  c.status = 'OPEN',
  c.createdBy = $actor
ON MATCH SET
  c.lastSeenAt = datetime()
RETURN c
```

Gunakan `ON CREATE SET` untuk property yang hanya boleh diset sekali:

- `createdAt`,
- `createdBy`,
- initial status,
- first source,
- initial ingestion metadata.

Gunakan `ON MATCH SET` untuk update ketika entity ditemukan:

- `updatedAt`,
- `lastSeenAt`,
- last source event,
- enrichment attribute.

Tetapi hati-hati: `ON MATCH SET` tidak otomatis berarti update tersebut benar secara domain.

Contoh:

```cypher
MERGE (c:Case {caseId: $caseId})
ON MATCH SET c.status = $status
```

Kalau event lama datang terlambat, status bisa mundur dari `CLOSED` ke `OPEN`.

Maka untuk stateful domain, status update harus guarded:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.version = $expectedVersion
SET
  c.status = $newStatus,
  c.version = c.version + 1,
  c.updatedAt = datetime()
RETURN c
```

atau gunakan event ordering:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.lastEventSequence IS NULL OR c.lastEventSequence < $eventSequence
SET
  c.status = $status,
  c.lastEventSequence = $eventSequence,
  c.updatedAt = datetime()
RETURN c
```

---

## 5. Constraint-Backed `MERGE`: Jangan Mengandalkan Query Saja

`MERGE` sebaiknya didukung oleh constraint untuk identity.

Contoh:

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;

CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;

CREATE CONSTRAINT org_id_unique IF NOT EXISTS
FOR (o:Organization)
REQUIRE o.orgId IS UNIQUE;
```

Mengapa penting?

Karena tanpa constraint:

```cypher
MERGE (p:Person {personId: $personId})
```

bisa tetap berisiko pada concurrent writes. Dua transaction berbeda bisa sama-sama tidak menemukan node lalu mencoba membuat node. Constraint adalah safety net yang membuat uniqueness menjadi invariant database, bukan hanya convention aplikasi.

Mental model:

```text
MERGE expresses desired state.
Constraint enforces uniqueness invariant.
Retry handles transient concurrency conflict.
```

Untuk production:

```text
MERGE tanpa constraint pada key penting = red flag.
```

---

## 6. Relationship `MERGE`: Lebih Berbahaya dari Node `MERGE`

Node upsert relatif mudah karena punya identity property yang jelas.

Relationship lebih tricky karena relationship identity sering implicit:

```text
(source node, relationship type, target node)
```

Contoh:

```cypher
MATCH (p:Person {personId: $personId})
MATCH (o:Organization {orgId: $orgId})
MERGE (p)-[r:OWNS]->(o)
SET r.updatedAt = datetime()
RETURN r
```

Ini berarti:

```text
Antara person P dan organization O hanya boleh ada satu relationship OWNS.
```

Apakah domain memang begitu?

Mungkin tidak.

Jika ownership punya periode historis:

```text
P owns O from 2020 to 2022
P owns O from 2024 to now
```

maka relationship identity perlu menyertakan period atau dibuat sebagai node reifikasi.

### 6.1 Relationship dengan Properti Identity

Neo4j mendukung property pada relationship. Tapi `MERGE` relationship dengan property perlu hati-hati.

Contoh:

```cypher
MERGE (p)-[r:OWNS {sourceRecordId: $sourceRecordId}]->(o)
```

Ini berarti relationship uniqueness berdasarkan pattern:

```text
p - OWNS with sourceRecordId - o
```

Jika ada source berbeda untuk ownership yang sama, query bisa membuat multiple relationship.

Itu bisa valid jika relationship adalah evidence-level fact:

```text
(:Person)-[:OWNS {sourceRecordId: 'A'}]->(:Organization)
(:Person)-[:OWNS {sourceRecordId: 'B'}]->(:Organization)
```

Tapi tidak valid jika business view hanya ingin satu current ownership edge.

### 6.2 Pisahkan Evidence Relationship dan Current-State Relationship

Pattern yang sering lebih sehat:

```text
(:Person)-[:CURRENTLY_OWNS {percentage, updatedAt}]->(:Organization)
(:OwnershipEvidence {sourceRecordId, observedAt, source})
(:OwnershipEvidence)-[:ASSERTS_OWNER]->(:Person)
(:OwnershipEvidence)-[:ASSERTS_OWNED_ENTITY]->(:Organization)
```

Atau:

```text
(:Person)-[:OWNS]->(:Organization)
(:Person)-[:OWNERSHIP_EVIDENCED_BY]->(:Evidence)-[:ABOUT]->(:Organization)
```

Pilih berdasarkan query utama:

- Jika query utama butuh traversal cepat “siapa owns apa sekarang”, buat current edge.
- Jika query utama butuh audit/provenance kuat, simpan evidence sebagai node.
- Jika keduanya penting, gunakan keduanya dengan aturan derivasi yang jelas.

---

## 7. Idempotency: Requirement Utama untuk Ingestion dan Event-Driven Graph

Idempotency berarti:

```text
Menjalankan command yang sama lebih dari sekali menghasilkan graph state yang sama seperti menjalankannya sekali.
```

Dalam distributed system, idempotency bukan nice-to-have. Ini wajib karena:

- event bisa dikirim ulang,
- producer bisa retry,
- consumer bisa crash setelah commit tapi sebelum ack,
- network timeout bisa membuat client tidak tahu apakah commit sukses,
- batch job bisa rerun,
- CDC bisa replay,
- operator bisa menjalankan ulang import.

### 7.1 Non-Idempotent Write

```cypher
MATCH (c:Case {caseId: $caseId})
CREATE (c)-[:HAS_NOTE]->(:Note {
  text: $text,
  createdAt: datetime()
})
```

Jika request retry, note terduplikasi.

### 7.2 Idempotent Write dengan Event ID

```cypher
MATCH (c:Case {caseId: $caseId})
MERGE (e:CaseEvent {eventId: $eventId})
ON CREATE SET
  e.type = 'NOTE_ADDED',
  e.text = $text,
  e.createdAt = datetime($createdAt)
MERGE (c)-[:HAS_EVENT]->(e)
RETURN e
```

Constraint:

```cypher
CREATE CONSTRAINT case_event_id_unique IF NOT EXISTS
FOR (e:CaseEvent)
REQUIRE e.eventId IS UNIQUE;
```

Sekarang replay event tidak membuat duplicate event.

### 7.3 Idempotency Key untuk Command

Jika command berasal dari API, gunakan idempotency key:

```cypher
MERGE (cmd:CommandReceipt {idempotencyKey: $idempotencyKey})
ON CREATE SET
  cmd.commandType = $commandType,
  cmd.receivedAt = datetime(),
  cmd.status = 'STARTED'
RETURN cmd
```

Namun hati-hati: command receipt sendiri perlu transaction boundary yang benar. Kalau receipt dibuat tapi domain write gagal, status harus jelas.

Pattern yang lebih defensible:

```cypher
MERGE (cmd:CommandReceipt {idempotencyKey: $idempotencyKey})
ON CREATE SET
  cmd.commandType = $commandType,
  cmd.createdAt = datetime(),
  cmd.status = 'PROCESSING'
WITH cmd
CALL {
  WITH cmd
  // domain mutation here
  RETURN count(*) AS mutationCount
}
SET
  cmd.status = 'COMPLETED',
  cmd.completedAt = datetime()
RETURN cmd
```

Tetapi jika query terlalu kompleks, lebih baik command receipt dan domain mutation ditangani dalam transaction function di Java.

---

## 8. Upsert Strategy: Jangan Campur Identity Resolution dan Attribute Update Sembarangan

Upsert terdiri dari dua bagian:

```text
1. Resolve identity.
2. Apply changes.
```

Masalah terjadi ketika dua bagian ini dicampur dalam satu pattern yang terlalu kaya.

### 8.1 Bad Upsert

```cypher
MERGE (p:Person {
  personId: $personId,
  name: $name,
  dateOfBirth: date($dob),
  nationality: $nationality
})
```

Ini buruk karena:

- nama bisa berubah,
- date of birth bisa salah input lalu dikoreksi,
- nationality bisa berubah atau multi-valued,
- perubahan attribute membuat duplicate node.

### 8.2 Better Upsert

```cypher
MERGE (p:Person {personId: $personId})
ON CREATE SET
  p.createdAt = datetime(),
  p.createdBy = $actor
SET
  p.name = $name,
  p.dateOfBirth = CASE
    WHEN $dob IS NULL THEN p.dateOfBirth
    ELSE date($dob)
  END,
  p.nationality = $nationality,
  p.updatedAt = datetime(),
  p.updatedBy = $actor
RETURN p
```

### 8.3 Best Upsert untuk Domain Audit-Heavy

Untuk domain regulatory, jangan selalu overwrite fakta tanpa provenance. Gunakan evidence/provenance:

```cypher
MERGE (p:Person {personId: $personId})
ON CREATE SET
  p.createdAt = datetime()
SET p.updatedAt = datetime()

MERGE (src:SourceRecord {sourceRecordId: $sourceRecordId})
ON CREATE SET
  src.sourceSystem = $sourceSystem,
  src.ingestedAt = datetime(),
  src.payloadHash = $payloadHash

MERGE (src)-[:IDENTIFIES]->(p)
SET
  p.displayName = $name,
  p.lastSourceSystem = $sourceSystem,
  p.lastSeenAt = datetime()
RETURN p, src
```

Di sini graph membedakan:

```text
current display property
vs
source record yang mendukung data tersebut.
```

---

## 9. External Identity: Kunci Utama Graph Integration

Graph sering menjadi integrasi banyak sistem. Maka identity harus eksplisit.

Contoh source:

- CRM person ID,
- core banking account ID,
- registry company number,
- case management case ID,
- document management evidence ID,
- identity provider user ID,
- government registry ID.

Jangan pakai Neo4j internal id sebagai business identity.

Bad:

```cypher
MATCH (p)
WHERE id(p) = $id
```

Better:

```cypher
MATCH (p:Person {personId: $personId})
```

Atau kalau multi-source:

```cypher
MERGE (x:ExternalIdentity {
  sourceSystem: $sourceSystem,
  externalId: $externalId
})
MERGE (p:Person {personId: $canonicalPersonId})
MERGE (x)-[:IDENTIFIES]->(p)
```

Pattern ini membantu entity resolution dan audit.

---

## 10. Duplicate Prevention: Di Graph, Duplicate Bukan Hanya Node

Duplicate dapat muncul pada beberapa level:

```text
1. duplicate node,
2. duplicate relationship,
3. duplicate evidence,
4. duplicate event,
5. duplicate derived edge,
6. duplicate semantic fact,
7. duplicate canonical entity karena identity resolution gagal.
```

### 10.1 Duplicate Node

```cypher
(:Person {personId: 'P1'})
(:Person {personId: 'P1'})
```

Prevent dengan uniqueness constraint.

### 10.2 Duplicate Relationship

```cypher
(:Person {P1})-[:OWNS]->(:Org {O1})
(:Person {P1})-[:OWNS]->(:Org {O1})
```

Prevent dengan `MERGE (p)-[:OWNS]->(o)`, tetapi concurrency masih harus diperhatikan. Pada Neo4j modern, relationship property uniqueness constraints bisa membantu untuk relationship yang punya explicit key.

Contoh:

```cypher
CREATE CONSTRAINT ownership_fact_id_unique IF NOT EXISTS
FOR ()-[r:OWNS]-()
REQUIRE r.ownershipFactId IS UNIQUE;
```

Lalu:

```cypher
MERGE (p)-[r:OWNS {ownershipFactId: $ownershipFactId}]->(o)
```

Jika relationship uniqueness hanya berdasarkan start/end/type, tidak selalu bisa diekspresikan langsung sebagai constraint. Maka query discipline dan model pattern penting.

### 10.3 Duplicate Semantic Fact

Dua relationship berbeda bisa sebenarnya merepresentasikan fakta yang sama:

```text
P1 OWNS O1 source=A
P1 CONTROLS O1 source=B
```

Apakah itu duplicate? Tergantung ontology domain.

Karena itu, duplicate prevention bukan hanya masalah database constraint. Ini juga masalah semantic modelling.

---

## 11. Transaction Boundary: Satu Command, Satu Invariant Boundary

Transaction terlalu kecil:

```text
create person commit
create organization commit
create ownership commit
```

Risiko:

- graph intermediate state bocor,
- relationship gagal setelah node dibuat,
- retry membuat state ambigu,
- invariant lintas entity rusak.

Transaction terlalu besar:

```text
import 5 juta node dan relationship dalam satu transaction
```

Risiko:

- memory pressure,
- long lock duration,
- transaction log besar,
- rollback mahal,
- query lain tertahan,
- deadlock probability naik.

Prinsip:

```text
Transaction boundary harus mengikuti invariant boundary.
```

Contoh command:

```text
OpenCaseCommand
```

Dalam satu transaction:

- create/merge case,
- link subject,
- link initial evidence,
- create case event,
- assign initial owner,
- set initial status.

Jangan commit sebagian jika semua bagian diperlukan agar case valid.

Untuk batch ingestion:

```text
Chunk besar menjadi transaction kecil yang idempotent.
```

Contoh:

```text
10.000 records -> batch 500 atau 1.000 per transaction,
tergantung ukuran graph fragment dan memory.
```

---

## 12. Locking Mental Model di Neo4j

Neo4j memakai locks untuk menjaga konsistensi concurrent writes. Saat dua transaction mencoba memodifikasi node/relationship yang sama, salah satu bisa menunggu. Jika dua transaction saling menunggu, deadlock dapat terjadi.

Contoh konseptual:

```text
Tx A locks Person P1, lalu ingin lock Org O1.
Tx B locks Org O1, lalu ingin lock Person P1.
```

Keduanya saling menunggu.

Neo4j dapat mendeteksi deadlock dan membatalkan salah satu transaction dengan transient error. Ini bukan selalu bug fatal; ini bagian dari concurrent database reality. Yang penting adalah aplikasi Java menanganinya dengan retry yang aman.

### 12.1 Mengurangi Deadlock

Beberapa prinsip:

1. Gunakan urutan lock yang konsisten.
2. Pecah batch besar.
3. Hindari query yang memodifikasi high-degree node tanpa batas.
4. Hindari `MERGE` pattern besar yang mengunci banyak entity tanpa kontrol.
5. Gunakan constraint untuk identity resolution.
6. Gunakan transaction retry.
7. Jangan menahan transaction sambil melakukan IO eksternal.
8. Jangan melakukan user interaction di tengah transaction.

### 12.2 Urutan Lock Konsisten

Misalnya selalu resolve node berdasarkan urutan label/key:

```cypher
MERGE (a:Account {accountId: $fromAccountId})
MERGE (b:Account {accountId: $toAccountId})
MERGE (a)-[:TRANSFERRED_TO {transferId: $transferId}]->(b)
```

Untuk transfer antara dua account, jika beberapa transaction bisa memproses arah berbeda, pertimbangkan ordering deterministik di aplikasi:

```java
String first = min(accountA, accountB);
String second = max(accountA, accountB);
```

Lalu lock/access node dalam urutan yang konsisten jika operasi bersifat symmetric.

---

## 13. Concurrent Relationship Creation

Skenario umum:

```text
Dua worker menerima event yang sama atau related event.
Keduanya mencoba membuat relationship yang sama.
```

Query:

```cypher
MATCH (p:Person {personId: $personId})
MATCH (c:Case {caseId: $caseId})
MERGE (p)-[r:SUBJECT_OF]->(c)
RETURN r
```

Jika tidak ada relationship, dua transaction concurrent bisa mencoba create relationship. Dalam banyak kasus, Neo4j akan mengelola locks, tetapi duplicate atau transient conflict tetap perlu dipikirkan, terutama jika pattern lebih kompleks atau tidak ada constraint.

Untuk relationship dengan explicit fact id:

```cypher
MATCH (p:Person {personId: $personId})
MATCH (c:Case {caseId: $caseId})
MERGE (p)-[r:SUBJECT_OF {subjectFactId: $subjectFactId}]->(c)
ON CREATE SET r.createdAt = datetime()
RETURN r
```

Constraint:

```cypher
CREATE CONSTRAINT subject_fact_id_unique IF NOT EXISTS
FOR ()-[r:SUBJECT_OF]-()
REQUIRE r.subjectFactId IS UNIQUE;
```

Tapi jika domain ingin “hanya satu SUBJECT_OF antara p dan c” tanpa fact id, Anda perlu menjaga dengan query dan possibly cleanup checks.

---

## 14. Write Amplification di Graph

Write amplification berarti satu business event menyebabkan banyak mutation.

Contoh event:

```text
TransactionObserved
```

Mungkin menulis:

- account source,
- account destination,
- transaction node,
- amount property,
- timestamp,
- relationship source -> transaction,
- transaction -> destination,
- involved parties,
- risk flag,
- merchant,
- geolocation,
- derived account-account edge,
- case linkage.

Graph write amplification bisa besar karena relationship first-class.

### 14.1 Kapan Write Amplification Dibenarkan

Dibenarkan jika mutation tambahan mempercepat query penting.

Contoh:

```text
Raw event:
(:Account)-[:SENT]->(:Transaction)-[:TO]->(:Account)

Derived edge:
(:Account)-[:TRANSFERRED_TO {count, totalAmount, lastAt}]->(:Account)
```

Derived edge membantu query network-level cepat.

Tapi ada trade-off:

- harus update counter,
- race condition,
- consistency antara raw event dan derived edge,
- rebuild strategy,
- drift detection.

### 14.2 Derived Edge Harus Rebuildable

Jika derived edge bisa rusak karena bug, harus bisa dibangun ulang dari source-of-truth.

Prinsip:

```text
Derived relationship should be reproducible.
```

Simpan metadata:

```cypher
SET r.derivedFrom = 'TransactionObserved',
    r.lastRecomputedAt = datetime(),
    r.algorithmVersion = 'v3'
```

Atau jangan simpan semua metadata di relationship jika terlalu ramai; gunakan graph metadata node.

---

## 15. Batch Writes: Throughput vs Correctness

Batching meningkatkan throughput, tetapi berisiko jika tidak idempotent.

Pattern umum:

```cypher
UNWIND $rows AS row
MERGE (p:Person {personId: row.personId})
ON CREATE SET p.createdAt = datetime()
SET
  p.name = row.name,
  p.updatedAt = datetime()
```

Untuk relationship:

```cypher
UNWIND $rows AS row
MERGE (p:Person {personId: row.personId})
MERGE (o:Organization {orgId: row.orgId})
MERGE (p)-[r:OWNS]->(o)
SET
  r.percentage = row.percentage,
  r.updatedAt = datetime()
```

### 15.1 Batch Size

Tidak ada angka universal. Faktor:

- jumlah properties,
- jumlah relationships per row,
- index/constraint cost,
- page cache hit ratio,
- heap,
- concurrent workload,
- transaction timeout,
- disk latency.

Mulai konservatif:

```text
100 - 1.000 rows per transaction
```

Lalu ukur:

- latency per batch,
- memory,
- locks,
- db hits,
- deadlock rate,
- transaction log growth,
- checkpoint impact.

### 15.2 Batch yang Buruk

```cypher
UNWIND $rows AS row
MATCH (root:Root {id: 'GLOBAL'})
MERGE (root)-[:HAS_RECORD]->(:Record {id: row.id})
```

Semua row menyentuh root node yang sama. Ini bisa membuat contention.

Solusi:

- hindari global root untuk write-heavy path,
- partition root by tenant/time/domain,
- tulis relationship root secara async,
- gunakan derived relationship setelah ingest.

---

## 16. Import-Time Writes vs Runtime Writes

Ada dua jenis write workload:

```text
1. import/backfill writes,
2. runtime/online writes.
```

### 16.1 Import/Backfill

Karakteristik:

- volume besar,
- bisa offline atau semi-offline,
- throughput penting,
- idempotency tetap penting,
- bisa rerun,
- sering butuh staging/validation.

Strategi:

- create constraints dulu,
- load nodes dulu,
- load relationships setelah node ada,
- chunk transaction,
- gunakan deterministic IDs,
- simpan import batch metadata,
- validate counts dan sample paths,
- jangan campur enrichment kompleks terlalu awal.

### 16.2 Runtime Writes

Karakteristik:

- latency penting,
- concurrency tinggi,
- user-facing correctness,
- retry harus aman,
- transaction kecil,
- error harus terklasifikasi.

Strategi:

- gunakan Java driver transaction function,
- constrain keys,
- query pendek dan deterministic,
- hindari batch besar,
- handle retryable exceptions,
- expose meaningful error to application.

---

## 17. Java Driver: Write Transaction Pattern

Neo4j Java Driver adalah jalur idiomatis untuk aplikasi Java. Pola penting:

- driver dibuat sebagai singleton/application-scoped,
- session short-lived,
- transaction function untuk unit of work,
- parameterized query,
- consume result dalam transaction scope,
- handle retryable/transient error.

Contoh konseptual:

```java
public final class CaseGraphRepository {
    private final Driver driver;

    public CaseGraphRepository(Driver driver) {
        this.driver = driver;
    }

    public OpenCaseResult openCase(OpenCaseCommand command) {
        try (Session session = driver.session(SessionConfig.builder()
                .withDatabase("neo4j")
                .build())) {

            return session.executeWrite(tx -> {
                Result result = tx.run("""
                    MERGE (c:Case {caseId: $caseId})
                    ON CREATE SET
                      c.status = 'OPEN',
                      c.createdAt = datetime(),
                      c.createdBy = $actor
                    ON MATCH SET
                      c.lastSeenAt = datetime()

                    MERGE (s:Subject {subjectId: $subjectId})
                    ON CREATE SET s.createdAt = datetime()

                    MERGE (s)-[r:SUBJECT_OF]->(c)
                    ON CREATE SET r.createdAt = datetime(), r.source = $source

                    MERGE (e:CaseEvent {eventId: $eventId})
                    ON CREATE SET
                      e.type = 'CASE_OPENED',
                      e.occurredAt = datetime($occurredAt),
                      e.source = $source

                    MERGE (c)-[:HAS_EVENT]->(e)
                    RETURN c.caseId AS caseId, c.status AS status
                    """, Map.of(
                        "caseId", command.caseId(),
                        "subjectId", command.subjectId(),
                        "actor", command.actor(),
                        "source", command.source(),
                        "eventId", command.eventId(),
                        "occurredAt", command.occurredAt().toString()
                    ));

                Record record = result.single();
                return new OpenCaseResult(
                    record.get("caseId").asString(),
                    record.get("status").asString()
                );
            });
        }
    }
}
```

Catatan:

- Jangan return `Result` keluar dari transaction function.
- Map hasil ke object aplikasi di dalam transaction scope.
- Query harus parameterized.
- Transaction function memungkinkan retry untuk transient failure sesuai mekanisme driver.

---

## 18. Error Classification untuk Write Path

Tidak semua error harus diperlakukan sama.

Kategori praktis:

| Kategori | Contoh | Perlakuan |
|---|---|---|
| Validation error | input missing, invalid state transition | jangan retry |
| Constraint violation | duplicate identity, missing required property | tergantung: bug/data conflict |
| Transient error | deadlock, leader switch, temporary unavailable | retry |
| Timeout | query terlalu berat atau database sibuk | retry terbatas + investigate |
| Auth/config error | bad credentials, database not found | jangan retry terus |
| Mapping error | result shape berubah | bug aplikasi |

### 18.1 Retry Hanya Aman Jika Command Idempotent

Retry tanpa idempotency bisa membuat duplicate.

Bad:

```cypher
CREATE (:Notification {message: $message, createdAt: datetime()})
```

Jika retry setelah ambiguous commit, duplicate notification bisa terjadi.

Better:

```cypher
MERGE (:Notification {notificationId: $notificationId})
ON CREATE SET
  message: $message,
  createdAt: datetime()
```

Retry policy harus dibangun di atas idempotent write.

---

## 19. Optimistic Concurrency untuk State Transition

Graph sering menyimpan workflow state:

```text
Case: OPEN -> UNDER_REVIEW -> ESCALATED -> CLOSED
```

Jangan update state tanpa guard.

Bad:

```cypher
MATCH (c:Case {caseId: $caseId})
SET c.status = $newStatus
RETURN c
```

Better:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.status = $expectedStatus
SET
  c.status = $newStatus,
  c.updatedAt = datetime(),
  c.version = coalesce(c.version, 0) + 1
RETURN c.caseId AS caseId, c.status AS status, c.version AS version
```

Jika result kosong, berarti:

```text
state sudah berubah / command tidak valid / concurrent update menang lebih dulu.
```

Untuk version-based optimistic locking:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.version = $expectedVersion
SET
  c.status = $newStatus,
  c.version = c.version + 1,
  c.updatedAt = datetime()
RETURN c
```

Aplikasi Java harus membedakan:

```text
No result karena not found
vs
No result karena version mismatch
```

Caranya bisa dengan query dua tahap atau return diagnostic.

---

## 20. Modelling State Transition sebagai Event Node

Untuk audit-heavy systems, property `status` saja tidak cukup.

Pattern:

```text
(:Case {status: 'ESCALATED'})
(:Case)-[:HAS_EVENT]->(:CaseEvent {type: 'STATUS_CHANGED', from, to, actor, occurredAt})
```

Query:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.status = $expectedStatus
SET
  c.status = $newStatus,
  c.version = coalesce(c.version, 0) + 1,
  c.updatedAt = datetime()
CREATE (e:CaseEvent {
  eventId: $eventId,
  type: 'STATUS_CHANGED',
  fromStatus: $expectedStatus,
  toStatus: $newStatus,
  actor: $actor,
  occurredAt: datetime($occurredAt)
})
CREATE (c)-[:HAS_EVENT]->(e)
RETURN c, e
```

Tapi retry bisa duplicate event jika `CREATE` digunakan. Lebih aman:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.status = $expectedStatus
MERGE (e:CaseEvent {eventId: $eventId})
ON CREATE SET
  e.type = 'STATUS_CHANGED',
  e.fromStatus = $expectedStatus,
  e.toStatus = $newStatus,
  e.actor = $actor,
  e.occurredAt = datetime($occurredAt)
SET
  c.status = $newStatus,
  c.version = coalesce(c.version, 0) + 1,
  c.updatedAt = datetime()
MERGE (c)-[:HAS_EVENT]->(e)
RETURN c, e
```

Namun ada subtle issue: jika event sudah ada tetapi case status belum berubah karena previous transaction failed mid-way, transaction atomicity mencegah partial commit dalam satu transaction. Jadi aman selama event dan status update ada dalam transaction yang sama.

---

## 21. Handling Late Events dan Out-of-Order Events

Dalam event-driven ingestion, event tidak selalu datang berurutan.

Contoh:

```text
Event 10: Case ESCALATED
Event 9: Case UNDER_REVIEW
```

Jika Event 9 diproses setelah Event 10, status bisa mundur.

Guard dengan sequence:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE coalesce(c.lastSequence, -1) < $sequence
SET
  c.status = $status,
  c.lastSequence = $sequence,
  c.updatedAt = datetime()
RETURN c
```

Jika result kosong, event lama diabaikan untuk current state. Tetapi event tetap bisa disimpan sebagai historical event:

```cypher
MERGE (e:CaseEvent {eventId: $eventId})
ON CREATE SET
  e.sequence = $sequence,
  e.status = $status,
  e.occurredAt = datetime($occurredAt)
WITH e
MATCH (c:Case {caseId: $caseId})
MERGE (c)-[:HAS_EVENT]->(e)
WITH c, e
CALL {
  WITH c, e
  WITH c, e
  WHERE coalesce(c.lastSequence, -1) < e.sequence
  SET
    c.status = e.status,
    c.lastSequence = e.sequence,
    c.updatedAt = datetime()
  RETURN count(*) AS updated
}
RETURN e, updated
```

Ini membedakan:

```text
historical fact ingestion
vs
current state projection.
```

---

## 22. Write Path untuk Derived Counter

Counter sering menggoda:

```cypher
MATCH (p:Person {personId: $personId})
SET p.caseCount = p.caseCount + 1
```

Masalah:

- concurrent update,
- duplicate event increment dua kali,
- rollback/retry ambiguity,
- drift dari graph actual.

Lebih aman jika counter derived dari idempotent event:

```cypher
MATCH (p:Person {personId: $personId})
MATCH (c:Case {caseId: $caseId})
MERGE (p)-[r:SUBJECT_OF]->(c)
ON CREATE SET
  r.createdAt = datetime(),
  p.caseCount = coalesce(p.caseCount, 0) + 1
RETURN p.caseCount AS caseCount
```

Tetapi `ON CREATE SET` pada relationship dan update node counter dalam same merge perlu diuji dengan baik. Untuk high contention, counter di node hot bisa menjadi bottleneck.

Alternatif:

- jangan simpan counter; hitung saat query jika murah,
- simpan counter dalam materialized projection batch,
- simpan counter per bucket,
- gunakan separate analytics pipeline,
- rebuild periodically.

Untuk graph, counter sering bukan sumber kebenaran; relationship-lah sumber kebenaran.

---

## 23. High-Contention Writes dan Supernode Mutation

Dari Part 008/012, supernode adalah node dengan degree sangat besar. Dalam write path, supernode juga bisa jadi hotspot.

Contoh buruk:

```cypher
MATCH (tenant:Tenant {tenantId: $tenantId})
CREATE (tenant)-[:HAS_EVENT]->(:Event {...})
```

Jika tenant besar menerima ribuan events per detik, semua writes menyentuh tenant node.

Alternatif:

```text
(:Tenant)-[:HAS_EVENT_BUCKET]->(:EventBucket {tenantId, date})-[:HAS_EVENT]->(:Event)
```

Atau:

```text
(:Event {tenantId, eventId})
```

dan relationship tenant dibuat batch/offline jika tidak dibutuhkan di hot path.

Prinsip:

```text
Jangan membuat semua write harus melewati node pusat kecuali memang perlu.
```

---

## 24. Soft Delete, Retraction, dan Correction

Dalam graph, delete sering berbahaya karena relationship membuat konteks hilang.

Bad:

```cypher
MATCH (p:Person {personId: $personId})
DETACH DELETE p
```

Ini menghapus node dan semua relationship. Untuk audit-heavy domain, ini hampir selalu salah.

Alternatif soft delete:

```cypher
MATCH (p:Person {personId: $personId})
SET
  p.deleted = true,
  p.deletedAt = datetime(),
  p.deletedBy = $actor
RETURN p
```

Untuk relationship:

```cypher
MATCH (p:Person {personId: $personId})-[r:OWNS]->(o:Organization {orgId: $orgId})
SET
  r.validTo = datetime($validTo),
  r.retracted = true,
  r.retractedBy = $actor,
  r.retractionReason = $reason
RETURN r
```

Atau buat retraction event:

```cypher
MATCH (p:Person {personId: $personId})-[r:OWNS]->(o:Organization {orgId: $orgId})
CREATE (e:RetractionEvent {
  eventId: $eventId,
  reason: $reason,
  actor: $actor,
  occurredAt: datetime()
})
CREATE (e)-[:RETRACTS]->(r)
SET r.retracted = true
RETURN e, r
```

Catatan: relationship sebagai target relationship tidak selalu sesuai dengan semua kebutuhan modelling; kadang reifikasi relationship menjadi node lebih baik jika facts perlu lifecycle panjang.

---

## 25. Write Query Design Checklist

Sebelum menaruh write query di production, tanyakan:

### 25.1 Identity

```text
- Apa identity node ini?
- Apakah identity stabil?
- Apakah constraint sudah ada?
- Apakah property mutable tidak masuk ke MERGE?
```

### 25.2 Relationship

```text
- Apakah relationship ini current state, historical fact, atau evidence?
- Apakah hanya boleh satu relationship antara dua node?
- Kalau bisa lebih dari satu, apa identity relationship?
- Apakah relationship perlu validity period?
```

### 25.3 Idempotency

```text
- Kalau command/event diulang, apakah graph tetap sama?
- Apakah ada eventId/idempotencyKey?
- Apakah CREATE dipakai untuk object yang bisa ter-retry?
```

### 25.4 Concurrency

```text
- Node mana yang bisa menjadi hot lock?
- Apakah batch menyentuh root/supernode?
- Apakah urutan lock konsisten?
- Apakah transient error diretry?
```

### 25.5 Transaction

```text
- Apakah semua mutation yang menjaga invariant ada dalam satu transaction?
- Apakah transaction terlalu besar?
- Apakah query melakukan IO eksternal? Seharusnya tidak.
```

### 25.6 Audit

```text
- Apakah kita tahu siapa/apa yang membuat perubahan?
- Apakah source event/source record disimpan?
- Apakah correction/retraction bisa direpresentasikan?
```

### 25.7 Rebuildability

```text
- Apakah derived edge/counter bisa dibangun ulang?
- Apakah ada metadata versi derivasi?
- Apakah ada reconciliation job?
```

---

## 26. Command Handler Pattern untuk Java Service

Sebagai tech lead, Anda sebaiknya tidak membiarkan Cypher write tersebar liar di controller/service.

Gunakan struktur:

```text
Application Service
  -> validates use case
  -> builds command
  -> calls GraphCommandHandler
  -> maps domain result

GraphCommandHandler
  -> owns transaction boundary
  -> runs parameterized Cypher
  -> maps result
  -> classifies errors

CypherCatalog / Query Object
  -> stores named queries
  -> versioned and tested
```

Contoh package:

```text
com.example.casegraph
  application
    OpenCaseService.java
  graph
    CaseGraphRepository.java
    queries
      OpenCaseCypher.java
      AssignOfficerCypher.java
      LinkEvidenceCypher.java
  domain
    OpenCaseCommand.java
    OpenCaseResult.java
  error
    GraphWriteException.java
    GraphConcurrencyException.java
    GraphInvariantViolationException.java
```

### 26.1 Jangan Membuat Generic Graph Repository Berlebihan

Anti-pattern:

```java
graphRepository.saveNode(label, properties);
graphRepository.createRelationship(from, type, to, props);
```

Ini membuat domain semantics hilang.

Better:

```java
caseGraphRepository.openCase(command);
caseGraphRepository.assignOfficer(command);
caseGraphRepository.linkEvidence(command);
caseGraphRepository.escalateCase(command);
```

Graph write harus domain-specific karena invariant-nya domain-specific.

---

## 27. Testing Write Query

Write query harus dites dengan dataset kecil tapi meaningful.

Test categories:

### 27.1 Idempotency Test

Run command dua kali:

```text
Given empty graph
When OpenCaseCommand executed twice with same eventId
Then exactly one Case node exists
And exactly one CaseEvent node exists
And exactly one SUBJECT_OF relationship exists
```

Cypher assertion:

```cypher
MATCH (c:Case {caseId: $caseId})
RETURN count(c) AS count
```

```cypher
MATCH (:Subject {subjectId: $subjectId})-[r:SUBJECT_OF]->(:Case {caseId: $caseId})
RETURN count(r) AS count
```

### 27.2 Concurrent Write Test

Simulate multiple threads writing same entity/relationship.

Expectation:

```text
- no duplicate nodes,
- no duplicate relationships if domain requires uniqueness,
- transient errors retried,
- final graph valid.
```

### 27.3 Out-of-Order Event Test

Process higher sequence first, then lower sequence.

Expectation:

```text
- all events stored if required,
- current projection remains latest,
- no status regression.
```

### 27.4 Constraint Violation Test

Attempt conflicting identity.

Expectation:

```text
- error classified,
- no partial graph,
- application response meaningful.
```

---

## 28. Observability untuk Write Path

Monitor:

```text
- write latency p50/p95/p99,
- transaction retry count,
- deadlock count,
- constraint violation count,
- timeout count,
- batch size,
- rows per second,
- failed command count,
- duplicate prevention metrics,
- graph reconciliation drift,
- transaction log growth,
- heap/page cache pressure.
```

Log minimal untuk write failure:

```text
- command type,
- idempotency key/event id,
- domain identifiers,
- retry attempt,
- Neo4j error code/classification,
- query name/version,
- elapsed time,
- database name,
- correlation id.
```

Jangan log full payload sensitif tanpa redaction.

---

## 29. Practical Example: Idempotent Case Opening

### 29.1 Constraints

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;

CREATE CONSTRAINT subject_id_unique IF NOT EXISTS
FOR (s:Subject)
REQUIRE s.subjectId IS UNIQUE;

CREATE CONSTRAINT case_event_id_unique IF NOT EXISTS
FOR (e:CaseEvent)
REQUIRE e.eventId IS UNIQUE;
```

### 29.2 Command Query

```cypher
MERGE (c:Case {caseId: $caseId})
ON CREATE SET
  c.status = 'OPEN',
  c.version = 0,
  c.createdAt = datetime($occurredAt),
  c.createdBy = $actor
ON MATCH SET
  c.lastSeenAt = datetime()

MERGE (s:Subject {subjectId: $subjectId})
ON CREATE SET
  s.createdAt = datetime(),
  s.createdBy = $actor

MERGE (s)-[subjectRel:SUBJECT_OF]->(c)
ON CREATE SET
  subjectRel.createdAt = datetime($occurredAt),
  subjectRel.source = $source

MERGE (e:CaseEvent {eventId: $eventId})
ON CREATE SET
  e.type = 'CASE_OPENED',
  e.occurredAt = datetime($occurredAt),
  e.actor = $actor,
  e.source = $source

MERGE (c)-[:HAS_EVENT]->(e)
RETURN
  c.caseId AS caseId,
  c.status AS status,
  s.subjectId AS subjectId,
  e.eventId AS eventId
```

### 29.3 Idempotency Result

Run once:

```text
creates Case, Subject, SUBJECT_OF, CaseEvent, HAS_EVENT
```

Run again with same parameters:

```text
matches existing graph; no duplicate semantic objects
```

Run with same `caseId` but different `eventId`:

```text
depends on business rule.
Could represent a second event about same case,
or invalid duplicate command.
```

If duplicate open event should be rejected, use command receipt or state guard.

---

## 30. Practical Example: Safe Case Escalation

Business rule:

```text
A case can be escalated only from UNDER_REVIEW.
Escalation must create an audit event exactly once.
Retry must not duplicate event.
```

Query:

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.status = 'UNDER_REVIEW'
MERGE (e:CaseEvent {eventId: $eventId})
ON CREATE SET
  e.type = 'CASE_ESCALATED',
  e.fromStatus = 'UNDER_REVIEW',
  e.toStatus = 'ESCALATED',
  e.actor = $actor,
  e.reason = $reason,
  e.occurredAt = datetime($occurredAt)
SET
  c.status = 'ESCALATED',
  c.version = coalesce(c.version, 0) + 1,
  c.updatedAt = datetime($occurredAt),
  c.updatedBy = $actor
MERGE (c)-[:HAS_EVENT]->(e)
RETURN
  c.caseId AS caseId,
  c.status AS status,
  c.version AS version,
  e.eventId AS eventId
```

If no row returned:

```text
- case does not exist, or
- status is not UNDER_REVIEW.
```

For clearer diagnosis:

```cypher
MATCH (c:Case {caseId: $caseId})
WITH c
RETURN
  c IS NOT NULL AS exists,
  c.status AS currentStatus
```

But avoid doing separate pre-check and update in separate transactions if correctness depends on the result.

---

## 31. Practical Example: Ownership Evidence vs Current Ownership

Requirement:

```text
Multiple source records can assert ownership.
Current ownership edge should be one per Person-Organization pair.
Evidence must remain auditable.
```

Query:

```cypher
MERGE (p:Person {personId: $personId})
ON CREATE SET p.createdAt = datetime()

MERGE (o:Organization {orgId: $orgId})
ON CREATE SET o.createdAt = datetime()

MERGE (src:SourceRecord {sourceRecordId: $sourceRecordId})
ON CREATE SET
  src.sourceSystem = $sourceSystem,
  src.ingestedAt = datetime(),
  src.payloadHash = $payloadHash

MERGE (src)-[:ASSERTS_OWNER]->(p)
MERGE (src)-[:ASSERTS_OWNED_ENTITY]->(o)

MERGE (p)-[r:CURRENTLY_OWNS]->(o)
ON CREATE SET r.createdAt = datetime()
SET
  r.percentage = $percentage,
  r.confidence = $confidence,
  r.lastSourceRecordId = $sourceRecordId,
  r.updatedAt = datetime()
RETURN p, r, o, src
```

This model separates:

```text
- source assertion,
- current operational traversal edge.
```

In audit context, this is usually superior to overwriting relationship properties with no evidence trail.

---

## 32. Common Mistakes and Better Alternatives

### Mistake 1: `MERGE` with mutable properties

Bad:

```cypher
MERGE (p:Person {personId: $id, name: $name})
```

Better:

```cypher
MERGE (p:Person {personId: $id})
SET p.name = $name
```

### Mistake 2: `CREATE` in retryable command

Bad:

```cypher
CREATE (:Event {type: $type})
```

Better:

```cypher
MERGE (:Event {eventId: $eventId})
ON CREATE SET type = $type
```

### Mistake 3: one giant `MERGE` pattern

Bad:

```cypher
MERGE (a:Account {id: $a})-[:TRANSFERRED_TO]->(b:Account {id: $b})
```

Better:

```cypher
MERGE (a:Account {id: $a})
MERGE (b:Account {id: $b})
MERGE (a)-[:TRANSFERRED_TO]->(b)
```

### Mistake 4: no constraints

Bad:

```cypher
MERGE (c:Case {caseId: $caseId})
```

without uniqueness constraint.

Better:

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;
```

### Mistake 5: overwriting state with old events

Bad:

```cypher
SET c.status = $status
```

Better:

```cypher
WHERE coalesce(c.lastSequence, -1) < $sequence
SET c.status = $status, c.lastSequence = $sequence
```

### Mistake 6: hot root node

Bad:

```cypher
MATCH (root:Root {id: 'global'})
CREATE (root)-[:HAS_EVENT]->(:Event {...})
```

Better:

```text
partition by tenant/time/domain or avoid root relationship in hot path.
```

---

## 33. Production Write Readiness Checklist

A Neo4j write path is production-ready when:

```text
[ ] All business identities use explicit external/stable keys.
[ ] Key nodes have uniqueness constraints.
[ ] Important relationship facts have clear uniqueness semantics.
[ ] MERGE uses identity properties only.
[ ] Mutable attributes are updated with SET/ON MATCH SET intentionally.
[ ] CREATE is used only for truly new immutable facts or guarded by idempotency.
[ ] Commands/events are idempotent.
[ ] Transaction boundary matches invariant boundary.
[ ] Java driver transaction functions are used for retryable work.
[ ] Retry policy only wraps idempotent operations.
[ ] State transitions are guarded by expected status/version/sequence.
[ ] Late/out-of-order events cannot corrupt current state.
[ ] High-contention nodes are identified.
[ ] Batch size is measured, not guessed.
[ ] Deadlocks/transient errors are observable and retried.
[ ] Constraint violations are classified.
[ ] Source/provenance is captured where required.
[ ] Derived edges/counters are rebuildable.
[ ] Write queries have integration tests.
[ ] Concurrent writes have stress tests.
[ ] Slow write queries are logged by query name/version.
```

---

## 34. Summary Mental Model

Write modelling in Neo4j is about expressing graph state transitions safely.

The core principles:

```text
1. Use CREATE when new means genuinely new.
2. Use MERGE when desired state should exist once.
3. Use constraints to enforce identity invariants.
4. Keep identity properties separate from mutable attributes.
5. Treat relationship identity as a first-class design decision.
6. Make every retryable write idempotent.
7. Keep transaction boundary aligned with domain invariant.
8. Expect concurrency conflicts; design retry-safe commands.
9. Avoid hot root/supernode writes.
10. Preserve provenance when overwriting would destroy auditability.
11. Make derived edges and counters rebuildable.
12. Test write queries as domain logic, not as incidental database calls.
```

A strong Neo4j engineer does not merely know Cypher syntax. They know how a write changes graph semantics, concurrency behavior, auditability, and future traversal cost.

---

## 35. What You Should Be Able to Do After This Part

After this part, you should be able to:

1. Explain the difference between `CREATE` and `MERGE` precisely.
2. Avoid `MERGE` with mutable properties.
3. Design idempotent graph writes for API commands and event ingestion.
4. Use constraints to support write correctness.
5. Decide relationship identity semantics.
6. Handle current-state edge vs evidence fact modelling.
7. Design transaction boundaries around invariants.
8. Reason about deadlocks, retries, and concurrent writes.
9. Build safe Java write transaction functions.
10. Test write queries for idempotency and concurrency.
11. Identify write hot spots caused by supernodes/root nodes.
12. Design write paths that remain defensible under audit.

---

## 36. References

- Neo4j Cypher Manual — `MERGE` clause.
- Neo4j Cypher Manual — constraints and indexes.
- Neo4j Operations Manual — concurrent data access and deadlocks.
- Neo4j Java Driver Manual — transactions and transaction functions.
- Neo4j Java Driver API — retryable exceptions.

---

## 37. Next Part

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-011.md
```

Topik:

```text
Query Performance: PROFILE, EXPLAIN, Cardinality, and Plan Tuning
```

Kita akan belajar membaca execution plan Cypher, memahami rows/db hits/operator, mendeteksi cartesian product, memahami expand operator, dan menulis ulang query agar traversal tetap terkendali.

---

## Status Seri

```text
Part 000 selesai — Orientation
Part 001 selesai — Graph Thinking
Part 002 selesai — Property Graph Model Deep Dive
Part 003 selesai — Neo4j Architecture
Part 004 selesai — Cypher Fundamentals
Part 005 selesai — Cypher Path Semantics
Part 006 selesai — Graph Modelling Methodology
Part 007 selesai — Advanced Graph Modelling Patterns
Part 008 selesai — Anti-Patterns in Graph Modelling
Part 009 selesai — Schema, Constraints, Indexes, and Data Integrity
Part 010 selesai — Write Modelling: MERGE, Idempotency, Upserts, and Concurrency

Seri belum selesai.
Masih ada Part 011 sampai Part 032.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Schema, Constraints, Indexes, and Data Integrity in Neo4j</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-011.md">Part 011 — Query Performance: `PROFILE`, `EXPLAIN`, Cardinality, and Plan Tuning ➡️</a>
</div>
