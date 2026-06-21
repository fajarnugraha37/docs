# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-016.md

# Part 016 — Transactions, Consistency, and Correctness in Graph Workloads

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Part: `016`  
> Topik: Transactions, Consistency, and Correctness in Graph Workloads  
> Target pembaca: Java software engineer / tech lead yang ingin membangun sistem graph production-grade dengan Neo4j  
> Status seri: Part 016 dari 032 — seri belum selesai

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas import, ETL, CDC, dan graph projection pipeline. Sekarang kita masuk ke lapisan yang lebih fundamental untuk production system: **correctness**.

Banyak engineer mempelajari graph database dari sisi query:

```cypher
MATCH path = (a)-[:RELATED_TO*1..3]->(b)
RETURN path
```

Tetapi sistem production gagal bukan hanya karena query lambat. Sistem juga bisa gagal karena:

- node duplikat,
- relationship duplikat,
- ingestion tidak idempotent,
- command diproses dua kali,
- retry membuat efek samping ganda,
- constraint tidak cukup,
- transaction boundary salah,
- concurrent write saling mengunci,
- graph projection tertinggal dari source-of-truth,
- audit trail tidak bisa menjelaskan kenapa sebuah edge ada,
- read dari cluster tidak melihat write terbaru,
- path-based decision berubah karena data graph berubah di tengah proses bisnis.

Bagian ini bertujuan membangun mental model agar kamu mampu menjawab:

1. Apa arti ACID di graph workload?
2. Apa yang harus ada di satu transaction?
3. Apa yang tidak boleh dipaksa masuk ke satu transaction?
4. Bagaimana Neo4j mengunci node/relationship saat write?
5. Bagaimana mendesain write yang idempotent?
6. Bagaimana menangani deadlock dan transient error dari Java?
7. Bagaimana membedakan transactional graph dan eventually consistent graph projection?
8. Bagaimana menjaga invariant domain yang melibatkan banyak node dan relationship?
9. Bagaimana membuat graph decision dapat diaudit?
10. Bagaimana menyusun checklist correctness untuk sistem graph production?

---

## 1. Core Mental Model: Graph Correctness Is Relationship Correctness

Di relational system, banyak invariant dinyatakan lewat table constraint:

- primary key,
- foreign key,
- unique constraint,
- check constraint,
- transaction isolation,
- normalized schema.

Di graph system, correctness tetap membutuhkan constraint, tetapi invariant sering berada pada **struktur hubungan**.

Contoh sederhana:

```text
A Person must not have two active PRIMARY_ADDRESS relationships.
```

Ini bukan sekadar constraint pada satu property. Ini constraint pada pola graph:

```text
(:Person)-[:HAS_ADDRESS {type:'PRIMARY', validTo:null}]->(:Address)
```

Invariant-nya adalah:

```text
For each Person, at most one active primary address relationship exists.
```

Contoh lain:

```text
A regulatory case can be escalated only if at least one open allegation exists and at least one evidence item supports that allegation.
```

Pattern-nya:

```text
(:Case)-[:HAS_ALLEGATION]->(:Allegation {status:'OPEN'})
(:Allegation)-[:SUPPORTED_BY]->(:Evidence)
```

Ini adalah invariant lintas node dan relationship.

Karena itu, graph correctness bukan hanya:

```text
Apakah node valid?
```

Tetapi juga:

```text
Apakah relationship valid?
Apakah path valid?
Apakah pattern valid?
Apakah tidak ada pattern yang dilarang?
Apakah decision masih benar terhadap snapshot data yang dipakai?
```

---

## 2. Neo4j Transaction Mental Model

Neo4j adalah database transaksional. Untuk workload operasional, kamu bisa menganggap unit write Neo4j sebagai:

```text
read graph state → validate condition → mutate nodes/relationships → commit atomically
```

Dalam satu transaction, perubahan graph yang berhasil commit akan terlihat sebagai satu perubahan atomik. Jika gagal, perubahan dalam transaction tersebut rollback.

Mental model praktis:

```text
Transaction adalah boundary untuk satu perubahan graph yang harus benar atau tidak terjadi sama sekali.
```

Contoh yang cocok berada dalam satu transaction:

```text
Create customer node + create account node + connect customer to account.
```

```cypher
MERGE (c:Customer {customerId: $customerId})
  ON CREATE SET c.createdAt = datetime()
MERGE (a:Account {accountId: $accountId})
  ON CREATE SET a.createdAt = datetime()
MERGE (c)-[r:OWNS]->(a)
  ON CREATE SET r.createdAt = datetime()
RETURN c.customerId, a.accountId
```

Kalau node `Customer` berhasil dibuat tetapi relationship `OWNS` gagal, graph menjadi tidak lengkap. Maka wajar disatukan.

Contoh yang tidak selalu cocok dalam satu transaction:

```text
Import 50 million relationship from external warehouse.
```

Itu harus dibatch, idempotent, dan dapat dilanjutkan ulang.

---

## 3. Transaction Scope: Jangan Terlalu Kecil, Jangan Terlalu Besar

Transaction terlalu kecil menyebabkan invariant bocor.

Contoh buruk:

```text
Transaction 1: create Case
Transaction 2: create Allegation
Transaction 3: connect Case to Allegation
Transaction 4: create Evidence
Transaction 5: connect Evidence to Allegation
```

Jika transaction 3 gagal, kamu punya allegation tanpa case. Jika transaction 5 gagal, evidence tidak terhubung. Bisa diperbaiki oleh reconciliation job, tetapi untuk command operasional inti ini biasanya buruk.

Transaction terlalu besar menyebabkan:

- lock ditahan terlalu lama,
- deadlock lebih mungkin,
- memory transaction membengkak,
- retry mahal,
- failure blast radius besar,
- timeout,
- latency user-facing buruk.

Rule of thumb:

```text
Satu transaction harus mencakup satu invariant bisnis yang harus berubah atomically.
```

Bukan:

```text
Satu HTTP request = satu transaction selalu.
```

Bukan juga:

```text
Satu node write = satu transaction selalu.
```

Gunakan domain boundary.

---

## 4. Graph Invariant: Dari Local Constraint ke Structural Constraint

Neo4j constraint sangat berguna untuk:

- uniqueness,
- node key,
- property existence,
- property type,
- relationship property existence/type.

Tetapi tidak semua graph invariant bisa dinyatakan sebagai schema constraint.

### 4.1 Invariant yang Cocok dengan Constraint

```text
No two Person nodes have the same external personId.
```

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;
```

```text
No two Case nodes have the same caseId.
```

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;
```

### 4.2 Invariant yang Butuh Query + Transaction

```text
A Case cannot be closed if it still has open InvestigationTask.
```

Pattern check:

```cypher
MATCH (c:Case {caseId: $caseId})
OPTIONAL MATCH (c)-[:HAS_TASK]->(t:InvestigationTask {status:'OPEN'})
WITH c, count(t) AS openTasks
CALL apoc.util.validate(openTasks > 0, 'CASE_HAS_OPEN_TASKS', [])
SET c.status = 'CLOSED', c.closedAt = datetime()
RETURN c.caseId, c.status
```

Tanpa APOC, validation bisa dilakukan di application layer:

```cypher
MATCH (c:Case {caseId: $caseId})
OPTIONAL MATCH (c)-[:HAS_TASK]->(t:InvestigationTask {status:'OPEN'})
RETURN c.caseId AS caseId, count(t) AS openTasks
```

Lalu jika `openTasks == 0`, jalankan mutation dalam transaction yang sama.

Namun hati-hati: jika check dan mutation dipisah transaction, ada race.

---

## 5. Read-Validate-Write Race

Salah satu bug klasik:

```text
1. Read current graph state.
2. Decide write is allowed.
3. Write in separate transaction.
```

Masalahnya: state bisa berubah antara langkah 1 dan 3.

Contoh:

```text
At most one active primary officer can be assigned to a Case.
```

Thread A:

```text
Reads no active primary officer.
```

Thread B:

```text
Reads no active primary officer.
```

Keduanya membuat relationship:

```text
(:Officer)-[:PRIMARY_OFFICER_OF {active:true}]->(:Case)
```

Hasilnya dua primary officer aktif.

Correctness membutuhkan salah satu dari:

1. constraint-backed model,
2. transaction yang mengunci resource yang sama,
3. serial command processing per aggregate/key,
4. application-level optimistic concurrency,
5. refactoring model agar invariant bisa dinyatakan sebagai uniqueness.

---

## 6. Constraint-Backed Modelling untuk Invariant yang Sulit

Jika invariant penting tidak bisa dijaga langsung, ubah model.

Masalah:

```text
At most one active primary officer per Case.
```

Relationship uniqueness per `(caseId, activePrimaryRole)` tidak langsung sesederhana unique constraint pada node.

Solusi modelling: buat assignment node sebagai resource unik.

```text
(:Case {caseId})-[:HAS_PRIMARY_ASSIGNMENT]->(:PrimaryOfficerAssignment {assignmentKey})-[:ASSIGNED_TO]->(:Officer)
```

Dengan key:

```text
assignmentKey = caseId + ':PRIMARY:ACTIVE'
```

Constraint:

```cypher
CREATE CONSTRAINT primary_assignment_key IF NOT EXISTS
FOR (a:PrimaryOfficerAssignment)
REQUIRE a.assignmentKey IS UNIQUE;
```

Write:

```cypher
MATCH (c:Case {caseId: $caseId})
MATCH (o:Officer {officerId: $officerId})
MERGE (a:PrimaryOfficerAssignment {assignmentKey: $caseId + ':PRIMARY:ACTIVE'})
  ON CREATE SET a.createdAt = datetime(), a.status = 'ACTIVE'
MERGE (c)-[:HAS_PRIMARY_ASSIGNMENT]->(a)
MERGE (a)-[:ASSIGNED_TO]->(o)
RETURN a.assignmentKey
```

Sekarang konflik concurrent write akan bertemu pada node unik yang sama.

Prinsip:

```text
If an invariant is important, give it a physical anchor in the graph.
```

---

## 7. Locks in Neo4j: Apa yang Perlu Dipahami Engineer Aplikasi

Kamu tidak perlu menghafal seluruh detail internal locking, tetapi perlu tahu prinsip operasionalnya.

Saat write transaction mengubah node atau relationship, Neo4j mengambil lock untuk menjaga consistency. Write lock dapat terjadi pada node dan relationship. Pada operasi relationship creation/deletion, node yang terhubung juga relevan karena degree/relationship chain harus diperbarui.

Implikasinya:

```text
Node populer yang sering menjadi endpoint relationship dapat menjadi titik contention.
```

Contoh:

```text
(:Merchant {merchantId:'M1'}) menerima relationship transaksi dari ribuan account secara paralel.
```

```text
(:Category {name:'HIGH_RISK'}) dihubungkan ke jutaan entity secara paralel.
```

```text
(:Case {caseId:'C-123'}) mendapat banyak evidence/task/notes/assignment update secara bersamaan.
```

Semakin banyak transaction menulis ke node yang sama, semakin besar potensi contention/deadlock/retry.

---

## 8. Deadlock: Bukan Selalu Bug, Tetapi Harus Didesain

Deadlock terjadi ketika dua atau lebih transaction saling menunggu lock yang dipegang satu sama lain.

Contoh sederhana:

```text
Transaction A locks node X, lalu butuh node Y.
Transaction B locks node Y, lalu butuh node X.
```

Keduanya menunggu. Database mendeteksi deadlock, membatalkan salah satu transaction, dan mengembalikan error transient.

Di aplikasi production, deadlock harus diperlakukan sebagai:

```text
expected operational condition under concurrency
```

bukan selalu sebagai:

```text
catastrophic database corruption
```

Strategi:

1. Gunakan managed transaction / retryable transaction.
2. Pastikan command idempotent.
3. Batasi retry count.
4. Gunakan exponential backoff + jitter.
5. Kurangi lock overlap.
6. Tulis resource dalam order deterministik.
7. Hindari batch paralel yang menulis endpoint sama secara liar.
8. Monitor frequency deadlock.

Jika deadlock sering, jangan hanya naikkan retry. Itu sinyal model/write pattern salah.

---

## 9. Deterministic Lock Ordering

Ketika satu transaction perlu mengubah banyak node, urutan akses yang tidak konsisten meningkatkan deadlock.

Contoh buruk:

```text
Command A connects Person P1 to P2.
Command B connects Person P2 to P1.
```

Jika A lock P1 lalu P2, B lock P2 lalu P1, deadlock mungkin terjadi.

Solusi: lock/access dengan urutan deterministik.

```text
Sort IDs ascending, always match/update lower ID first.
```

Pseudo-flow:

```java
String first = min(personAId, personBId);
String second = max(personAId, personBId);
```

Cypher:

```cypher
MATCH (p1:Person {personId: $first})
MATCH (p2:Person {personId: $second})
MERGE (p1)-[:ASSOCIATED_WITH]-(p2)
RETURN p1.personId, p2.personId
```

Untuk undirected semantic relationship, tentukan canonical direction.

```text
(:Person with smaller ID)-[:ASSOCIATED_WITH]->(:Person with larger ID)
```

Ini bukan sekadar style. Ini concurrency control.

---

## 10. Idempotency: Correctness Saat Retry dan Duplicate Event

Distributed systems membuat duplicate request/event normal terjadi:

- HTTP client retry,
- message broker redelivery,
- CDC connector restart,
- batch job rerun,
- user double submit,
- network timeout setelah commit berhasil,
- service crash setelah database commit tetapi sebelum ack.

Karena itu write graph harus idempotent.

Idempotent artinya:

```text
Menjalankan command/event yang sama lebih dari sekali menghasilkan state akhir yang sama.
```

### 10.1 Idempotent Node Upsert

```cypher
MERGE (p:Person {personId: $personId})
ON CREATE SET
  p.createdAt = datetime(),
  p.createdBy = $actor
SET
  p.name = $name,
  p.updatedAt = datetime()
RETURN p
```

### 10.2 Idempotent Relationship Upsert

```cypher
MATCH (p:Person {personId: $personId})
MATCH (o:Organization {organizationId: $organizationId})
MERGE (p)-[r:WORKS_FOR]->(o)
ON CREATE SET
  r.createdAt = datetime(),
  r.sourceEventId = $eventId
SET
  r.title = $title,
  r.updatedAt = datetime()
RETURN r
```

### 10.3 Event Idempotency Ledger

Untuk event processing, tambahkan event ledger.

```cypher
MERGE (e:ProcessedEvent {eventId: $eventId})
ON CREATE SET e.createdAt = datetime(), e.eventType = $eventType
WITH e
WHERE e.processedAt IS NULL
// perform mutation
SET e.processedAt = datetime()
RETURN e.eventId
```

Namun pattern ini perlu hati-hati. Jika kamu `MERGE` event lalu gagal sebelum mutation selesai, ledger bisa berada di status setengah. Gunakan status:

```text
RECEIVED → APPLIED
```

atau lakukan ledger dan mutation dalam satu transaction.

Better pattern:

```cypher
MERGE (e:ProcessedEvent {eventId: $eventId})
ON CREATE SET e.createdAt = datetime(), e.status = 'NEW'
WITH e
WHERE e.status = 'NEW'
MATCH (p:Person {personId: $personId})
MATCH (c:Case {caseId: $caseId})
MERGE (p)-[r:SUBJECT_OF]->(c)
  ON CREATE SET r.createdAt = datetime(), r.sourceEventId = $eventId
SET e.status = 'APPLIED', e.appliedAt = datetime()
RETURN e.status AS status
```

Jika query mengembalikan 0 row karena event sudah applied, aplikasi harus menganggapnya duplicate safe.

---

## 11. MERGE Is Not Magic: Correctness Tergantung Pattern

`MERGE` memastikan pattern yang diberikan ada, tetapi pattern yang terlalu besar dapat berperilaku tidak sesuai harapan.

Contoh berbahaya:

```cypher
MERGE (p:Person {personId: $personId})-[:WORKS_FOR]->(o:Organization {organizationId: $organizationId})
```

Jika person ada tetapi organization tidak ada, atau sebaliknya, `MERGE` pada pattern panjang bisa membuat bagian yang tidak diinginkan tergantung pattern match. Lebih aman pecah:

```cypher
MERGE (p:Person {personId: $personId})
MERGE (o:Organization {organizationId: $organizationId})
MERGE (p)-[:WORKS_FOR]->(o)
```

Tetapi bahkan ini belum cukup jika relationship butuh identity unik berbasis source.

Misalnya seseorang bisa bekerja di organisasi yang sama beberapa kali pada periode berbeda:

```text
Person P worked for Org O from 2019-2021.
Person P worked again for Org O from 2024-now.
```

Relationship `(p)-[:WORKS_FOR]->(o)` tunggal tidak cukup.

Gunakan employment node:

```text
(:Person)-[:HAS_EMPLOYMENT]->(:Employment {employmentId})-[:AT]->(:Organization)
```

atau relationship dengan relationship key dari source jika semantics memang satu relationship per source fact.

Prinsip:

```text
MERGE correctness follows model correctness.
```

---

## 12. Transaction Retry dari Java: Apa yang Aman dan Tidak Aman

Neo4j Java Driver menyediakan managed transaction pattern yang dapat melakukan retry untuk transient failures. Tetapi retry hanya aman jika transaction function tidak melakukan external side effect yang tidak idempotent.

Buruk:

```java
session.executeWrite(tx -> {
    tx.run("MATCH ... SET ...");
    emailClient.send("case closed");
    return null;
});
```

Jika transaction function diretry, email bisa terkirim dua kali.

Benar:

```java
session.executeWrite(tx -> {
    tx.run("MATCH ... SET ... CREATE (:OutboxMessage {...})");
    return null;
});
```

Lalu worker outbox mengirim email dengan idempotency key.

Prinsip:

```text
Inside retryable database transaction: only database operations or idempotent pure computation.
Outside transaction: external side effects via outbox/inbox pattern.
```

---

## 13. Java Transaction Boundary Pattern

Contoh service method yang lebih sehat:

```java
public CaseAssignmentResult assignPrimaryOfficer(
        String caseId,
        String officerId,
        String commandId,
        String actorId
) {
    return driver.executableQuery("""
        MERGE (cmd:Command {commandId: $commandId})
          ON CREATE SET cmd.status = 'NEW', cmd.createdAt = datetime(), cmd.actorId = $actorId
        WITH cmd
        WHERE cmd.status = 'NEW'
        MATCH (c:Case {caseId: $caseId})
        MATCH (o:Officer {officerId: $officerId})
        MERGE (a:PrimaryOfficerAssignment {assignmentKey: $caseId + ':PRIMARY:ACTIVE'})
          ON CREATE SET a.createdAt = datetime(), a.status = 'ACTIVE'
        MERGE (c)-[:HAS_PRIMARY_ASSIGNMENT]->(a)
        MERGE (a)-[:ASSIGNED_TO]->(o)
        SET cmd.status = 'APPLIED', cmd.appliedAt = datetime()
        RETURN c.caseId AS caseId, o.officerId AS officerId, a.assignmentKey AS assignmentKey
        """)
        .withParameters(Map.of(
            "caseId", caseId,
            "officerId", officerId,
            "commandId", commandId,
            "actorId", actorId
        ))
        .execute()
        .records()
        .stream()
        .findFirst()
        .map(record -> new CaseAssignmentResult(
            record.get("caseId").asString(),
            record.get("officerId").asString(),
            record.get("assignmentKey").asString(),
            false
        ))
        .orElseGet(() -> new CaseAssignmentResult(caseId, officerId, null, true));
}
```

Interpretasi:

- `commandId` membuat command idempotent.
- `PrimaryOfficerAssignment.assignmentKey` memberi anchor uniqueness.
- Jika command sudah applied, query return 0 row dan aplikasi bisa menganggap duplicate.
- Tidak ada external side effect di dalam transaction.

Catatan: contoh ini konseptual. Di production, mapping/error handling/logging harus lebih rapi.

---

## 14. Exactly-Once Illusion dalam Graph Ingestion

Banyak pipeline mengklaim exactly-once. Dalam praktik enterprise integration, yang lebih defensible adalah:

```text
At-least-once delivery + idempotent write + reconciliation.
```

Kenapa?

Karena sistem biasanya melibatkan:

- source database,
- CDC connector,
- broker,
- consumer,
- Neo4j,
- external API,
- retry,
- deploy restart,
- network partition.

Tidak semua boundary bisa berada dalam satu distributed transaction.

Maka desain graph ingestion sebaiknya:

1. Setiap source entity punya stable external ID.
2. Setiap source relationship/fact punya stable fact ID atau deterministic key.
3. Write memakai `MERGE` + constraint.
4. Event punya idempotency key.
5. Pipeline bisa rerun dari offset/snapshot.
6. Reconciliation membandingkan source dan graph projection.
7. Delete/expire ditangani eksplisit, bukan diasumsikan.

Prinsip:

```text
Graph projection should be rebuildable or reconcilable.
```

Jika graph tidak bisa direbuild atau direconcile, kamu sedang membuat source-of-truth baru tanpa governance yang cukup.

---

## 15. Transactional Graph vs Graph Projection

Ada dua tipe besar penggunaan Neo4j:

### 15.1 Neo4j sebagai Operational Source-of-Truth

Contoh:

```text
Case graph lives in Neo4j as primary operational store.
```

Maka:

- transaction correctness sangat penting,
- graph invariant dijaga langsung,
- audit trail wajib,
- write API harus strongly controlled,
- migration harus ketat,
- backup/restore sangat penting,
- semantic versioning model perlu jelas.

### 15.2 Neo4j sebagai Projection dari Sistem Lain

Contoh:

```text
Customer/account/transaction data comes from core systems; Neo4j stores relationship projection for investigation.
```

Maka:

- source-of-truth berada di sistem asal,
- Neo4j boleh eventually consistent,
- ingestion idempotency sangat penting,
- lag harus dimonitor,
- reconciliation wajib,
- user-facing decision harus tahu freshness,
- jangan menulis balik sembarangan ke source tanpa workflow jelas.

Kesalahan besar:

```text
Menganggap projection eventually consistent sebagai source-of-truth strongly consistent.
```

Contoh failure:

```text
Investigator menutup case karena graph tidak menunjukkan hubungan risiko.
Padahal CDC lag 30 menit dan relationship risiko belum masuk.
```

Solusi:

- tampilkan data freshness,
- gunakan decision snapshot,
- untuk keputusan kritis, query source-of-truth atau tunggu projection catch-up,
- simpan evidence snapshot saat decision dibuat.

---

## 16. Read-Your-Write dan Causal Consistency

Dalam single instance, aplikasi biasanya mengharapkan setelah write commit, read berikutnya melihat write tersebut.

Dalam cluster/read replica/routing setup, konsepnya lebih rumit. Jika write pergi ke primary/leader dan read berikutnya diarahkan ke server lain yang belum catch up, aplikasi bisa membaca state lama jika tidak memakai mekanisme causal consistency/bookmark/routing yang benar.

Untuk Java application:

- gunakan driver routing dengan benar,
- deklarasikan access mode read/write dengan benar,
- gunakan session/transaction pattern resmi,
- pahami bookmark/causal chaining jika request flow membutuhkan read-after-write lintas session/service,
- jangan mengarahkan read kritis ke replica yang bisa lag tanpa sadar.

Contoh domain:

```text
User assigns officer, then immediately opens case detail page.
```

Expected:

```text
New officer assignment visible.
```

Jika read diarahkan ke replica yang belum apply, UI tampak gagal.

Solusi arsitektural:

1. gunakan causal consistency,
2. force read from writer untuk read-after-write critical path,
3. return changed state dari write command,
4. expose pending state,
5. desain UX dengan eventual consistency jika memang projection async.

---

## 17. Isolation: Jangan Salah Mengira Semua Read Terproteksi

Transaction isolation bukan berarti semua traversal result otomatis stabil terhadap perubahan concurrent transaction lain untuk seluruh durasi proses bisnis di luar transaction.

Kesalahan:

```text
I read all related risk nodes at 10:00.
At 10:05 I make decision assuming graph is still same.
```

Di antara 10:00 dan 10:05, graph bisa berubah.

Untuk keputusan kritis:

- buat decision dalam transaction yang membaca dan menulis decision record,
- simpan snapshot evidence/path yang dipakai,
- simpan query version/model version,
- simpan timestamp/freshness,
- simpan actor dan rationale,
- jika perlu, gunakan optimistic version check.

Contoh decision record:

```text
(:Decision {
  decisionId,
  type,
  createdAt,
  actorId,
  graphSnapshotTime,
  queryVersion,
  rationale
})
```

Relationships:

```text
(:Decision)-[:DECIDED_ON]->(:Case)
(:Decision)-[:SUPPORTED_BY]->(:Evidence)
(:Decision)-[:USED_PATH]->(:PathSnapshot)
(:Decision)-[:USED_SCORE]->(:RiskScoreSnapshot)
```

Graph yang berubah setelahnya tidak menghapus basis historis keputusan.

---

## 18. Optimistic Concurrency untuk Graph Aggregate

Untuk aggregate-like entity, gunakan version field.

```cypher
MATCH (c:Case {caseId: $caseId})
WHERE c.version = $expectedVersion
SET c.status = $newStatus,
    c.version = c.version + 1,
    c.updatedAt = datetime()
RETURN c.caseId AS caseId, c.version AS newVersion
```

Jika return 0 row:

```text
Concurrent modification detected.
```

Aplikasi dapat:

- reload state,
- tampilkan conflict,
- retry jika command commutative,
- reject jika decision harus dibuat ulang.

Optimistic concurrency cocok ketika:

- collision jarang,
- UX bisa menangani conflict,
- update tidak terlalu high-contention.

Tidak cocok ketika:

- node sangat panas,
- banyak update per detik,
- conflict harus dihindari bukan hanya dideteksi.

---

## 19. Pessimistic Anchor Pattern

Untuk invariant penting, buat anchor node yang sengaja menjadi lock point.

Contoh:

```text
Only one active escalation per Case.
```

Anchor:

```text
(:CaseControl {caseId})
```

Write selalu menyentuh control node:

```cypher
MATCH (ctrl:CaseControl {caseId: $caseId})
SET ctrl.lastTouchedAt = datetime()
WITH ctrl
MATCH (c:Case {caseId: $caseId})
OPTIONAL MATCH (c)-[:HAS_ESCALATION]->(e:Escalation {status:'ACTIVE'})
WITH c, count(e) AS activeEscalations
WHERE activeEscalations = 0
CREATE (new:Escalation {escalationId: $escalationId, status:'ACTIVE', createdAt: datetime()})
MERGE (c)-[:HAS_ESCALATION]->(new)
RETURN new.escalationId
```

`SET ctrl.lastTouchedAt` memaksa write ke anchor sehingga concurrent commands untuk case sama berurutan pada lock yang sama.

Trade-off:

- lebih aman untuk invariant penting,
- tetapi bisa menjadi contention point,
- cocok untuk aggregate command boundary,
- tidak cocok untuk high-volume append-only facts.

---

## 20. Relationship Creation Race

Relationship creation sering terlihat sederhana:

```cypher
MATCH (a:Account {accountId:$a})
MATCH (b:Account {accountId:$b})
MERGE (a)-[:TRANSFERRED_TO]->(b)
```

Tetapi semantics-nya harus jelas.

Apakah `TRANSFERRED_TO` berarti:

1. pernah ada transfer minimal sekali?
2. transfer spesifik dengan transactionId?
3. aggregate relationship dengan count/amount?
4. latest transfer?

Jika event transfer individual, relationship tunggal salah karena event berikutnya overwrite/merge ke edge yang sama.

Better:

```text
(:Account)-[:SENT]->(:Transaction {transactionId})-[:RECEIVED_BY]->(:Account)
```

Jika ingin shortcut relationship:

```text
(:Account)-[:HAS_TRANSFERRED_TO {count,totalAmount,lastAt}]->(:Account)
```

Itu derived edge dan harus dikelola dengan concurrency hati-hati.

Update aggregate edge:

```cypher
MATCH (a:Account {accountId:$from})
MATCH (b:Account {accountId:$to})
MERGE (a)-[r:HAS_TRANSFERRED_TO]->(b)
ON CREATE SET r.count = 0, r.totalAmount = 0, r.createdAt = datetime()
SET r.count = r.count + 1,
    r.totalAmount = r.totalAmount + $amount,
    r.lastAt = datetime()
RETURN r.count, r.totalAmount
```

Concurrent increments harus dipahami sebagai hot relationship write. Jika volume tinggi, aggregate mungkin lebih baik dihitung batch/offline atau dipartisi per time bucket.

---

## 21. Delete, Soft Delete, Expiry, dan Historical Correctness

Graph operational system jarang boleh menghapus fakta begitu saja, terutama untuk audit-heavy domain.

Jenis deletion:

### 21.1 Physical Delete

```cypher
MATCH (n:TempNode {id:$id})
DETACH DELETE n
```

Cocok untuk:

- temporary data,
- wrong import before production exposure,
- test data,
- privacy deletion dengan governance.

Risiko:

- path historis hilang,
- decision tidak bisa direkonstruksi,
- audit trail rusak.

### 21.2 Soft Delete

```cypher
MATCH (r:RelationshipFact {factId:$factId})
SET r.deletedAt = datetime(), r.deletedBy = $actor
```

Atau relationship property:

```cypher
MATCH (:Person {personId:$p})-[r:ASSOCIATED_WITH]->(:Person {personId:$q})
SET r.validTo = datetime(), r.status = 'INACTIVE'
```

### 21.3 Temporal Validity

```text
validFrom / validTo
```

Query harus selalu sadar temporal filter:

```cypher
MATCH (p:Person {personId:$personId})-[r:WORKS_FOR]->(o:Organization)
WHERE r.validFrom <= $asOf
  AND (r.validTo IS NULL OR r.validTo > $asOf)
RETURN o
```

Correctness problem:

```text
Jika satu query lupa filter validTo, sistem membaca relationship historis sebagai aktif.
```

Solusi:

- buat query catalogue,
- wrap query di repository/domain service,
- gunakan relationship type berbeda untuk active vs historical jika cocok,
- materialize active edge,
- test query semantics.

---

## 22. Auditability: Correctness yang Bisa Dijelaskan

Untuk sistem enforcement/regulatory, correctness bukan hanya state benar. Correctness harus bisa dijelaskan.

Pertanyaan auditor:

```text
Kenapa Case C dinaikkan ke high risk?
Data apa yang digunakan?
Relationship apa yang mendukung?
Siapa yang membuat keputusan?
Versi query/aturan apa yang dipakai?
Apakah data itu masih sama sekarang?
Jika tidak, apa state saat keputusan dibuat?
```

Graph modelling untuk audit:

```text
(:Decision)-[:DECIDED_ON]->(:Case)
(:Decision)-[:MADE_BY]->(:Officer)
(:Decision)-[:SUPPORTED_BY]->(:Evidence)
(:Decision)-[:BASED_ON_RULE]->(:RuleVersion)
(:Decision)-[:OBSERVED_PATH]->(:PathSnapshot)
(:Evidence)-[:SOURCED_FROM]->(:SourceSystem)
```

Snapshot node:

```text
(:PathSnapshot {
  pathSnapshotId,
  capturedAt,
  pathHash,
  serializedPath,
  queryName,
  queryVersion
})
```

Jangan hanya menyimpan hasil skor akhir.

```text
RiskScore = 87
```

Simpan basisnya:

```text
RiskScore 87 because:
- shared address with sanctioned entity,
- ownership chain within 2 hops,
- previous enforcement action in same beneficial owner cluster,
- transaction path to high-risk account within 3 hops.
```

Graph bagus untuk explainability jika modelnya menyimpan provenance. Graph buruk untuk audit jika semua edge dianggap fakta tanpa sumber.

---

## 23. Compensating Action

Tidak semua workflow bisa rollback secara database transaction.

Contoh:

```text
Case escalated in Neo4j.
Notification sent.
External workflow started.
Document generated.
```

Jika langkah eksternal gagal setelah database commit, tidak bisa rollback semua secara ACID.

Gunakan saga/compensation:

```text
ESCALATION_REQUESTED
ESCALATION_APPLIED
NOTIFICATION_PENDING
NOTIFICATION_SENT
WORKFLOW_START_FAILED
ESCALATION_REVIEW_REQUIRED
```

Graph cocok untuk merepresentasikan lifecycle:

```text
(:Escalation)-[:HAS_STATE]->(:EscalationState)
(:Escalation)-[:TRIGGERED]->(:Notification)
(:Notification)-[:FAILED_WITH]->(:Failure)
```

Correctness bukan berarti semua atomic. Correctness berarti state machine jelas, transisi valid, failure visible, dan kompensasi terdefinisi.

---

## 24. Command, Event, Fact, and State Separation

Dalam graph workload, campur aduk command/event/fact/state sering menyebabkan desain tidak jelas.

### Command

```text
Intent to change state.
```

Contoh:

```text
Assign officer to case.
```

### Event

```text
Something happened.
```

Contoh:

```text
OfficerAssignedToCase.
```

### Fact

```text
A statement about the world from some source.
```

Contoh:

```text
Person P controls Organization O according to registry R.
```

### State

```text
Current operational representation.
```

Contoh:

```text
Case C has active primary officer O.
```

Neo4j model bisa menyimpan semuanya, tetapi jangan campur semantics.

Pattern:

```text
(:Command)-[:PRODUCED]->(:Event)
(:Event)-[:ASSERTED]->(:Fact)
(:Fact)-[:PROJECTED_AS]->(:CurrentRelationship)
```

Tidak semua sistem butuh model sedetail ini. Tetapi domain high-risk sering butuh pemisahan ini untuk audit dan reconstruction.

---

## 25. Correctness di Batch dan Large Ingestion

Batch write berbeda dari user command.

Masalah batch:

- partial completion,
- duplicate rows,
- bad ordering,
- missing endpoint nodes,
- concurrent batch conflict,
- memory pressure,
- deadlock karena shared endpoints,
- rerun setelah crash.

Checklist batch correctness:

1. Setiap row punya deterministic key.
2. Endpoint nodes sudah ada atau dibuat idempotently.
3. Relationship identity jelas.
4. Batch size terkendali.
5. Error row disimpan.
6. Rerun aman.
7. Progress checkpoint jelas.
8. Constraint dibuat sebelum import jika perlu idempotency.
9. Constraint dibuat setelah import jika bulk offline dan performance butuh itu, lalu validasi.
10. Reconciliation menghitung expected vs actual.

Contoh relationship fact key:

```text
factKey = sourceSystem + ':' + sourceRecordId + ':' + relationshipType
```

Cypher:

```cypher
MERGE (f:RelationshipFact {factKey:$factKey})
ON CREATE SET f.createdAt = datetime(), f.sourceSystem = $sourceSystem
SET f.lastSeenAt = datetime(), f.payloadHash = $payloadHash
WITH f
MATCH (a:Entity {entityId:$fromId})
MATCH (b:Entity {entityId:$toId})
MERGE (f)-[:FROM_ENTITY]->(a)
MERGE (f)-[:TO_ENTITY]->(b)
RETURN f.factKey
```

---

## 26. Freshness and Staleness as First-Class Correctness

Graph projection sering dipakai untuk investigation, recommendation, risk scoring, dan network analysis. Dalam kasus tersebut, hasil query benar hanya relatif terhadap freshness.

Simpan metadata ingestion:

```text
(:IngestionRun {
  runId,
  sourceSystem,
  startedAt,
  completedAt,
  status,
  highWatermark,
  rowCount,
  errorCount
})
```

Hubungkan fact ke ingestion:

```text
(:RelationshipFact)-[:IMPORTED_IN]->(:IngestionRun)
```

Untuk decision:

```text
(:Decision)-[:USED_INGESTION_SNAPSHOT]->(:IngestionRun)
```

UI/decision logic harus bisa mengatakan:

```text
Graph includes core banking transactions up to 2026-06-21T10:15:00+07:00.
Corporate registry data up to 2026-06-20.
Sanctions list version 2026-06-18.
```

Tanpa freshness, graph result terlihat objektif padahal mungkin stale.

---

## 27. Multi-Entity Invariant: Regulatory Case Example

Invariant:

```text
A case can be escalated to Enforcement Review only when:
1. Case status is OPEN.
2. At least one allegation is OPEN.
3. At least one evidence supports each escalated allegation.
4. No unresolved conflict-of-interest exists for assigned officer.
5. Case has not already active escalation.
```

Graph pattern:

```text
(:Case)-[:HAS_ALLEGATION]->(:Allegation)
(:Allegation)-[:SUPPORTED_BY]->(:Evidence)
(:Case)-[:ASSIGNED_TO]->(:Officer)
(:Officer)-[:HAS_CONFLICT_WITH]->(:Subject)
(:Subject)-[:SUBJECT_OF]->(:Case)
(:Case)-[:HAS_ESCALATION]->(:Escalation)
```

Transaction flow:

```cypher
MATCH (c:Case {caseId:$caseId})
WHERE c.status = 'OPEN'

OPTIONAL MATCH (c)-[:HAS_ESCALATION]->(activeEsc:Escalation {status:'ACTIVE'})
WITH c, count(activeEsc) AS activeEscalations
WHERE activeEscalations = 0

MATCH (c)-[:HAS_ALLEGATION]->(a:Allegation {status:'OPEN'})
MATCH (a)-[:SUPPORTED_BY]->(e:Evidence)
WITH c, collect(DISTINCT a) AS allegations, collect(DISTINCT e) AS evidence
WHERE size(allegations) > 0 AND size(evidence) > 0

MATCH (c)-[:ASSIGNED_TO]->(o:Officer)
OPTIONAL MATCH (o)-[:HAS_CONFLICT_WITH]->(:Subject)-[:SUBJECT_OF]->(c)
WITH c, allegations, evidence, count(*) AS conflicts
WHERE conflicts = 0

CREATE (esc:Escalation {
  escalationId: $escalationId,
  status: 'ACTIVE',
  createdAt: datetime(),
  reason: $reason
})
MERGE (c)-[:HAS_ESCALATION]->(esc)
FOREACH (a IN allegations | MERGE (esc)-[:ESCALATES_ALLEGATION]->(a))
FOREACH (e IN evidence | MERGE (esc)-[:SUPPORTED_BY]->(e))
RETURN esc.escalationId AS escalationId
```

Catatan penting:

- Ini masih contoh konseptual.
- Untuk conflict count, query harus dirancang hati-hati agar tidak salah akibat row multiplication.
- Untuk invariant penting, gunakan anchor/control node atau unique assignment/escalation key.
- Untuk audit, buat decision/escalation snapshot.

---

## 28. Row Multiplication Can Break Correctness

Cypher row pipeline bisa membuat count salah jika tidak hati-hati.

Contoh:

```cypher
MATCH (c:Case {caseId:$caseId})
MATCH (c)-[:HAS_ALLEGATION]->(a:Allegation)
MATCH (a)-[:SUPPORTED_BY]->(e:Evidence)
MATCH (c)-[:ASSIGNED_TO]->(o:Officer)
RETURN count(a) AS allegations, count(e) AS evidence, count(o) AS officers
```

Jika satu allegation punya 3 evidence dan case punya 2 officers, row menjadi kombinasi:

```text
allegation × evidence × officer
```

Count bisa inflated.

Benar:

```cypher
RETURN
  count(DISTINCT a) AS allegations,
  count(DISTINCT e) AS evidence,
  count(DISTINCT o) AS officers
```

Atau pecah query dengan `WITH` agar setiap subproblem dihitung di boundary yang benar.

Correctness Cypher bukan hanya performance; row multiplication bisa mengubah keputusan bisnis.

---

## 29. Query Contract Tests untuk Correctness

Setiap query critical harus punya test dataset kecil yang mengekspresikan edge case.

Contoh untuk escalation:

1. case open + allegation + evidence → allowed,
2. case closed → rejected,
3. no allegation → rejected,
4. allegation without evidence → rejected,
5. officer conflict → rejected,
6. existing active escalation → rejected,
7. duplicate evidence relationships → still one logical evidence,
8. historical inactive conflict → ignored,
9. stale relationship without validTo filter → should fail test,
10. concurrent duplicate command → idempotent.

Test dataset sebaiknya kecil tetapi semantically dense.

Untuk Java:

- gunakan Testcontainers Neo4j,
- seed graph dengan Cypher scripts,
- jalankan repository/service method,
- assert graph state setelah command,
- assert query returns expected rows,
- assert duplicate command safe,
- assert constraint violation mapped ke domain error.

---

## 30. Error Classification in Java Service

Tidak semua error sama.

Kategori praktis:

### 30.1 Domain Rejection

```text
Case cannot be closed because open tasks exist.
```

HTTP/API response:

```text
409 Conflict or 422 Unprocessable Entity
```

### 30.2 Constraint Violation

```text
Duplicate external ID.
```

Bisa berarti:

- duplicate request,
- data quality issue,
- race condition,
- bug in key construction.

### 30.3 Retryable/Transient Error

```text
Deadlock, temporary unavailability, session expired.
```

Strategy:

- retry with bounded policy,
- ensure idempotency,
- observe retry count.

### 30.4 Non-Retryable Infrastructure Error

```text
Authentication, syntax error, missing procedure, invalid database.
```

Do not blind retry.

### 30.5 Data Corruption/Inconsistent State

```text
Invariant expected by application is violated.
```

Strategy:

- stop dangerous operation,
- alert,
- quarantine entity/case,
- reconciliation/repair workflow.

Do not hide this as generic 500 forever.

---

## 31. Observability for Correctness

Correctness issues need metrics, not only logs.

Track:

- transaction retry count,
- deadlock count,
- transient error count,
- constraint violation count by constraint,
- duplicate command/event count,
- idempotency ledger hit ratio,
- ingestion lag,
- reconciliation mismatch count,
- active long-running transactions,
- lock acquisition timeout,
- failed domain invariant checks,
- number of orphan nodes by label,
- number of relationships missing required properties,
- number of facts without source/provenance,
- stale projection warnings shown to users.

Example data quality queries:

```cypher
MATCH (a:Allegation)
WHERE NOT (a)<-[:HAS_ALLEGATION]-(:Case)
RETURN count(a) AS orphanAllegations
```

```cypher
MATCH ()-[r:SUPPORTED_BY]->(e:Evidence)
WHERE e.sourceSystem IS NULL
RETURN count(r) AS supportEdgesWithoutEvidenceSource
```

```cypher
MATCH (c:Case)-[:HAS_ESCALATION]->(e:Escalation {status:'ACTIVE'})
WITH c, count(e) AS activeEscalations
WHERE activeEscalations > 1
RETURN c.caseId, activeEscalations
```

Correctness observability means you can detect semantic damage before users do.

---

## 32. Correctness Checklist

Gunakan checklist ini saat review desain Neo4j production.

### 32.1 Identity

- Apakah setiap node penting punya stable external ID?
- Apakah setiap fact/relationship penting punya deterministic identity?
- Apakah constraint dibuat untuk key penting?
- Apakah key construction deterministic dan documented?

### 32.2 Transaction Boundary

- Apa invariant yang harus berubah atomically?
- Apakah transaction terlalu besar?
- Apakah transaction terlalu kecil?
- Apakah external side effect terjadi di dalam retryable transaction?

### 32.3 Idempotency

- Apakah command punya commandId?
- Apakah event punya eventId?
- Apakah duplicate delivery aman?
- Apakah retry setelah timeout aman?
- Apakah batch rerun aman?

### 32.4 Concurrency

- Node/relationship mana yang hot?
- Apakah write order deterministik?
- Apakah invariant penting punya anchor?
- Apakah deadlock retry bounded?
- Apakah retry metrics dimonitor?

### 32.5 Consistency

- Apakah Neo4j source-of-truth atau projection?
- Jika projection, berapa lag yang diterima?
- Apakah freshness terlihat di decision/UI?
- Apakah read-after-write membutuhkan causal consistency?

### 32.6 Audit

- Apakah edge punya provenance?
- Apakah decision menyimpan evidence/path/snapshot?
- Apakah query/rule version disimpan?
- Apakah historical state bisa direkonstruksi?

### 32.7 Testing

- Apakah query critical punya golden dataset?
- Apakah row multiplication diuji?
- Apakah duplicate command diuji?
- Apakah concurrency scenario diuji?
- Apakah migration punya invariant validation?

---

## 33. Common Failure Modes and Fixes

| Failure mode | Symptom | Root cause | Fix |
|---|---|---|---|
| Duplicate nodes | Same person appears twice | Missing unique constraint or unstable ID | Stable ID + constraint + merge strategy |
| Duplicate relationship | Same association repeated | Relationship identity unclear | Reify fact or define deterministic relationship key |
| Lost update | Final property misses concurrent update | Read-modify-write without version/lock | Optimistic version or anchor lock |
| Deadlock storm | Many transient failures | Parallel writes to same hot nodes | Partition workload, deterministic ordering, reduce hot endpoint writes |
| Stale decision | User decision based on old graph | Projection lag hidden | Freshness metadata + snapshot + source verification |
| Audit gap | Cannot explain why edge exists | No provenance model | Source/fact/evidence graph |
| Bad count | Business rule allows invalid action | Row multiplication in Cypher | DISTINCT, WITH boundaries, query contract tests |
| Retry side effect | Duplicate emails/API calls | External side effect inside transaction retry | Outbox pattern |
| Partial import | Missing relationships | Batch crash without checkpoint/reconcile | Idempotent batch + run ledger + reconciliation |
| Over-transaction | Timeout/lock contention | Huge transaction | Batch, chunk, import strategy |

---

## 34. Practical Design Heuristics

1. **Every important relationship needs a story.**  
   Who asserted it? When? From where? Is it current or historical?

2. **Every retryable operation must be idempotent.**  
   Retrying non-idempotent graph writes is how duplicate facts are born.

3. **Every high-value invariant needs a physical anchor.**  
   If the invariant matters, model something that can be constrained or locked.

4. **Every projection needs freshness metadata.**  
   Stale graph is not wrong if labelled stale. It is dangerous if presented as current.

5. **Every critical query needs contract tests.**  
   Query correctness fails silently through row multiplication, missing temporal filters, and accidental optional matches.

6. **Every external side effect needs outbox/inbox discipline.**  
   Database retry and external APIs do not compose magically.

7. **Every audit-heavy decision needs evidence snapshot.**  
   Current graph state is not the same as decision-time graph state.

8. **Every hot node deserves suspicion.**  
   High-degree + high-write is often a concurrency smell.

---

## 35. Mini Case Study: Duplicate Escalation Bug

### 35.1 Initial Requirement

```text
A case can have only one active escalation.
```

### 35.2 Naive Implementation

```cypher
MATCH (c:Case {caseId:$caseId})
OPTIONAL MATCH (c)-[:HAS_ESCALATION]->(e:Escalation {status:'ACTIVE'})
WITH c, count(e) AS existing
WHERE existing = 0
CREATE (new:Escalation {escalationId:$escalationId, status:'ACTIVE'})
MERGE (c)-[:HAS_ESCALATION]->(new)
RETURN new.escalationId
```

### 35.3 Race

Two requests run concurrently:

```text
A sees existing = 0.
B sees existing = 0.
A creates escalation.
B creates escalation.
```

### 35.4 Improved Model

Create unique active escalation anchor:

```text
(:ActiveEscalationSlot {slotKey: caseId + ':ACTIVE_ESCALATION'})
```

Constraint:

```cypher
CREATE CONSTRAINT active_escalation_slot_key IF NOT EXISTS
FOR (s:ActiveEscalationSlot)
REQUIRE s.slotKey IS UNIQUE;
```

Write:

```cypher
MATCH (c:Case {caseId:$caseId})
MERGE (slot:ActiveEscalationSlot {slotKey:$caseId + ':ACTIVE_ESCALATION'})
ON CREATE SET slot.createdAt = datetime()
WITH c, slot
OPTIONAL MATCH (slot)-[:POINTS_TO]->(existing:Escalation {status:'ACTIVE'})
WITH c, slot, existing
WHERE existing IS NULL
CREATE (new:Escalation {escalationId:$escalationId, status:'ACTIVE', createdAt:datetime()})
MERGE (c)-[:HAS_ESCALATION]->(new)
MERGE (slot)-[:POINTS_TO]->(new)
RETURN new.escalationId
```

This forces concurrent commands through the same slot.

### 35.5 Even Better with Command Idempotency

```cypher
MERGE (cmd:Command {commandId:$commandId})
ON CREATE SET cmd.status = 'NEW', cmd.createdAt = datetime()
WITH cmd
WHERE cmd.status = 'NEW'
// escalation logic
SET cmd.status = 'APPLIED', cmd.appliedAt = datetime()
```

Now both duplicate command and concurrent command are handled more safely.

---

## 36. Key Takeaways

1. Graph correctness is mostly relationship correctness.
2. Neo4j transactions give atomicity, but you must choose the right boundary.
3. Schema constraints are necessary but not sufficient for structural graph invariants.
4. Critical invariants often need modelling anchors.
5. `MERGE` only protects the pattern you actually modelled.
6. Retryable transaction logic must be idempotent and free of non-idempotent external side effects.
7. Deadlocks are expected under concurrency; frequent deadlocks are design feedback.
8. Projection graphs must expose freshness and be reconcilable.
9. Audit-heavy domains require provenance, decision snapshots, and rule/query versioning.
10. Query correctness must be tested because row multiplication and temporal mistakes can silently corrupt decisions.

---

## 37. References

- Neo4j Operations Manual — Database internals and transactional behavior.
- Neo4j Operations Manual — Concurrent data access.
- Neo4j Operations Manual — Show and terminate transactions.
- Neo4j Java Driver Manual — Run your own transactions.
- Neo4j Java Driver Manual — Query the database and error handling.
- Neo4j Java Driver Manual — Performance recommendations and causal consistency.
- Neo4j Cypher Manual — Constraints.
- Neo4j Cypher Manual — `CALL { ... } IN TRANSACTIONS`.
- Neo4j Java Reference — Transaction management.

---

## 38. Apa Berikutnya

Part berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-017.md
```

Topik:

```text
Neo4j Operations: Deployment, Configuration, Backup, Monitoring, and Capacity
```

Di Part 017, kita akan berpindah dari correctness di level transaction/application ke production operations:

- deployment options,
- memory sizing,
- heap vs page cache,
- disk and transaction log,
- backup/restore,
- monitoring,
- slow query diagnosis,
- capacity planning,
- security baseline,
- production readiness checklist.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Data Import, ETL, CDC, and Graph Projection Pipelines</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-017.md">Part 017 — Neo4j Operations: Deployment, Configuration, Backup, Monitoring, and Capacity ➡️</a>
</div>
