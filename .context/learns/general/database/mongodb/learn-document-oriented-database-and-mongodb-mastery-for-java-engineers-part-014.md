# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-014.md

# Part 014 — Concurrency Control and State Machines in MongoDB

> Seri: **Document-Oriented Database and MongoDB Mastery for Java Engineers**  
> Bagian: **014 / 035**  
> Fokus: **atomic transition, optimistic concurrency, idempotency, workflow state, lease/claim pattern, dan failure modelling untuk sistem Java production-grade**

---

## 0. Posisi Part Ini Dalam Seri

Pada bagian sebelumnya kita membahas transaction, atomicity, consistency, retryable writes, dan optimistic concurrency secara umum. Part ini mengambil konsep tersebut lalu menerapkannya ke salah satu masalah paling sering muncul dalam sistem bisnis serius:

> Bagaimana membuat perubahan status, assignment, approval, escalation, dan workflow berjalan benar meskipun ada concurrency, retry, worker paralel, actor stale, timeout, failover, dan duplicate request?

Ini sangat penting untuk sistem seperti:

- case management,
- enforcement lifecycle,
- complaint handling,
- loan approval,
- KYC review,
- fraud investigation,
- task orchestration,
- onboarding workflow,
- moderation queue,
- fulfillment pipeline,
- regulated decisioning system.

Di sistem seperti ini, bug biasanya bukan sekadar “query lambat”, tetapi:

- case diputuskan dua kali,
- reviewer lama masih bisa approve setelah reassignment,
- escalation terjadi setelah case closed,
- worker memproses task yang sama dua kali,
- retry menciptakan duplicate side effect,
- history tidak cocok dengan current state,
- audit trail tidak dapat membuktikan siapa mengubah apa dan kapan,
- transition ilegal lolos karena validasi hanya dilakukan di aplikasi sebelum update.

Document database bisa sangat kuat untuk masalah ini jika kita memakai satu prinsip pusat:

> **Di MongoDB, document adalah boundary natural untuk atomic state transition.**

MongoDB menjamin write operation bersifat atomic pada level single document. Artinya jika beberapa field dalam satu document harus berubah bersama, menaruh field tersebut dalam document yang sama memungkinkan update atomic tanpa distributed transaction. MongoDB juga menekankan bahwa untuk mencegah konflik concurrent update, filter update sebaiknya memasukkan expected current value, bukan hanya `_id`. Prinsip ini akan menjadi fondasi seluruh bagian ini.

---

## 1. Core Mental Model: State Transition Bukan “Set Field”

Banyak engineer memperlakukan perubahan status sebagai update sederhana:

```javascript
db.cases.updateOne(
  { _id: caseId },
  { $set: { status: "APPROVED" } }
)
```

Secara sintaks ini valid. Secara sistem bisnis ini berbahaya.

Kenapa?

Karena operation di atas tidak menyatakan invariant.

Ia tidak menjawab:

- status sebelumnya harus apa?
- siapa actor yang boleh melakukan transition?
- reviewer masih assigned atau tidak?
- case sudah closed atau belum?
- version yang dibaca user masih current atau stale?
- command ini duplicate atau genuinely new?
- apakah transition history ikut ditulis?
- apakah decision metadata ikut berubah?
- apakah side effect downstream aman jika retry?

Update status yang benar bukan:

> “ubah status menjadi APPROVED.”

Melainkan:

> “ubah case dari UNDER_REVIEW menjadi APPROVED hanya jika version masih 12, reviewer masih user-123, decision belum pernah dibuat, command id belum pernah dipakai, dan tulis transition history secara atomic.”

Dalam MongoDB, hal ini biasanya diekspresikan dengan **conditional update**.

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    status: "UNDER_REVIEW",
    version: 12,
    assignedReviewerId: "user-123",
    processedCommandIds: { $ne: "cmd-789" }
  },
  {
    $set: {
      status: "APPROVED",
      decision: {
        type: "APPROVAL",
        decidedBy: "user-123",
        decidedAt: ISODate("2026-06-21T10:15:00Z"),
        reasonCode: "SUFFICIENT_EVIDENCE"
      },
      updatedAt: ISODate("2026-06-21T10:15:00Z")
    },
    $inc: { version: 1 },
    $push: {
      transitions: {
        commandId: "cmd-789",
        from: "UNDER_REVIEW",
        to: "APPROVED",
        actorId: "user-123",
        occurredAt: ISODate("2026-06-21T10:15:00Z"),
        reason: "Decision submitted"
      }
    },
    $addToSet: {
      processedCommandIds: "cmd-789"
    }
  }
)
```

Jika `matchedCount == 1`, transition berhasil.

Jika `matchedCount == 0`, transition tidak terjadi. Tetapi alasan bisa bermacam-macam:

- case tidak ada,
- status sudah berubah,
- version stale,
- reviewer sudah bukan actor tersebut,
- command duplicate,
- invariant lain gagal.

Application layer harus membedakan ini dengan membaca ulang document atau memakai pola error resolution yang eksplisit.

---

## 2. Kenapa Conditional Update Lebih Penting Daripada Pre-Validation

Pola buruk:

```java
Case c = repository.findById(caseId);

if (!c.status().equals(UNDER_REVIEW)) {
    throw new InvalidTransitionException();
}

c.approve(actorId);
repository.save(c);
```

Kode ini tampak bersih, apalagi jika domain object punya method `approve()`. Tetapi ada race condition:

```text
T1 reads case: UNDER_REVIEW, version 12
T2 reads case: UNDER_REVIEW, version 12
T1 approves -> APPROVED, version 13
T2 rejects  -> REJECTED, version 13 or overwrite APPROVED depending save semantics
```

Validasi di memory hanya valid terhadap snapshot yang dibaca. Begitu ada actor lain mengubah document, validasi itu basi.

Pola benar:

```text
Validation that protects concurrency must be encoded in the write filter.
```

Artinya:

```javascript
{
  _id: caseId,
  status: "UNDER_REVIEW",
  version: 12
}
```

bukan hanya:

```javascript
{ _id: caseId }
```

Inilah inti optimistic concurrency di MongoDB.

---

## 3. State Machine: Explicit, Not Emergent

Workflow yang sehat harus punya state machine eksplisit.

Contoh lifecycle enforcement case:

```text
DRAFT
  -> SUBMITTED
  -> TRIAGE
  -> UNDER_REVIEW
  -> AWAITING_INFORMATION
  -> UNDER_REVIEW
  -> ESCALATED
  -> DECISION_PENDING
  -> APPROVED
  -> CLOSED

DRAFT
  -> CANCELLED

TRIAGE
  -> REJECTED_INTAKE
  -> CLOSED

UNDER_REVIEW
  -> REJECTED
  -> CLOSED
```

Kesalahan umum adalah menyimpan status sebagai string, tetapi tidak punya transition table yang jelas.

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    TRIAGE,
    UNDER_REVIEW,
    AWAITING_INFORMATION,
    ESCALATED,
    DECISION_PENDING,
    APPROVED,
    REJECTED,
    REJECTED_INTAKE,
    CANCELLED,
    CLOSED
}
```

Enum saja belum cukup. Yang lebih penting adalah legal transition matrix.

```java
record TransitionRule(
    CaseStatus from,
    CaseStatus to,
    Set<Permission> requiredPermissions,
    Set<CaseFlag> forbiddenFlags,
    boolean requiresAssignee,
    boolean requiresReason,
    boolean terminal
) {}
```

Atau sederhana:

```java
private static final Map<CaseStatus, Set<CaseStatus>> LEGAL_TRANSITIONS = Map.of(
    DRAFT, Set.of(SUBMITTED, CANCELLED),
    SUBMITTED, Set.of(TRIAGE),
    TRIAGE, Set.of(UNDER_REVIEW, REJECTED_INTAKE),
    UNDER_REVIEW, Set.of(AWAITING_INFORMATION, ESCALATED, DECISION_PENDING, REJECTED),
    AWAITING_INFORMATION, Set.of(UNDER_REVIEW),
    ESCALATED, Set.of(DECISION_PENDING),
    DECISION_PENDING, Set.of(APPROVED, REJECTED),
    APPROVED, Set.of(CLOSED),
    REJECTED, Set.of(CLOSED),
    REJECTED_INTAKE, Set.of(CLOSED),
    CANCELLED, Set.of(),
    CLOSED, Set.of()
);
```

Tetapi ingat: transition table di Java membantu domain clarity. Untuk concurrency safety, expected state tetap harus masuk ke MongoDB update filter.

---

## 4. Document Shape Untuk Stateful Aggregate

Contoh document untuk case lifecycle:

```javascript
{
  _id: ObjectId("..."),
  caseNumber: "ENF-2026-0000123",
  tenantId: "tenant-a",
  status: "UNDER_REVIEW",
  version: 12,

  assignedReviewerId: "user-123",
  assignedTeamId: "team-market-conduct",

  subject: {
    type: "ORGANIZATION",
    displayName: "Acme Securities Ltd",
    externalRef: "ORG-991"
  },

  flags: ["HIGH_RISK", "TIME_SENSITIVE"],

  decision: null,

  transitionSummary: {
    submittedAt: ISODate("2026-06-01T08:00:00Z"),
    triagedAt: ISODate("2026-06-02T09:30:00Z"),
    reviewStartedAt: ISODate("2026-06-03T10:00:00Z"),
    closedAt: null
  },

  transitions: [
    {
      seq: 1,
      from: "DRAFT",
      to: "SUBMITTED",
      actorId: "user-001",
      occurredAt: ISODate("2026-06-01T08:00:00Z"),
      commandId: "cmd-001",
      reason: "Initial submission"
    },
    {
      seq: 2,
      from: "SUBMITTED",
      to: "TRIAGE",
      actorId: "system",
      occurredAt: ISODate("2026-06-02T09:30:00Z"),
      commandId: "cmd-002",
      reason: "Auto triage"
    },
    {
      seq: 3,
      from: "TRIAGE",
      to: "UNDER_REVIEW",
      actorId: "user-100",
      occurredAt: ISODate("2026-06-03T10:00:00Z"),
      commandId: "cmd-003",
      reason: "Assigned for review"
    }
  ],

  processedCommandIds: ["cmd-001", "cmd-002", "cmd-003"],

  createdAt: ISODate("2026-06-01T07:55:00Z"),
  updatedAt: ISODate("2026-06-03T10:00:00Z")
}
```

Perhatikan beberapa field penting:

| Field | Fungsi |
|---|---|
| `status` | current state yang dipakai untuk query dan guard |
| `version` | optimistic concurrency control |
| `assignedReviewerId` | authorization/concurrency guard untuk action tertentu |
| `decision` | business outcome, harus atomic dengan final transition |
| `transitionSummary` | denormalized timestamp untuk query cepat |
| `transitions` | embedded history untuk audit ringan dan local reasoning |
| `processedCommandIds` | idempotency guard untuk command yang sudah diproses |
| `updatedAt` | observability dan stale detection |

Apakah semua history harus embedded?

Tidak selalu.

Jika history bisa tumbuh tanpa batas, simpan current state di `cases`, lalu simpan append-only event/audit di collection terpisah seperti `case_events`. Namun untuk transition history yang bounded atau dipotong ringkas, embedding bisa memberi atomicity dan locality.

Rule praktis:

```text
Jika transition history kecil, bounded, dan sering dibaca bersama case -> embed.
Jika transition history besar, unbounded, retention-heavy, atau audit-grade -> separate collection.
Jika butuh atomic current state + audit append -> pertimbangkan transaction atau outbox/audit pattern.
```

---

## 5. Atomic Transition Dengan `updateOne`

Contoh command:

```java
record SubmitCaseCommand(
    String commandId,
    ObjectId caseId,
    String actorId,
    long expectedVersion,
    Instant occurredAt
) {}
```

Expected transition:

```text
DRAFT -> SUBMITTED
```

MongoDB update:

```java
Bson filter = Filters.and(
    Filters.eq("_id", command.caseId()),
    Filters.eq("status", "DRAFT"),
    Filters.eq("version", command.expectedVersion()),
    Filters.ne("processedCommandIds", command.commandId())
);

Bson update = Updates.combine(
    Updates.set("status", "SUBMITTED"),
    Updates.set("transitionSummary.submittedAt", Date.from(command.occurredAt())),
    Updates.set("updatedAt", Date.from(command.occurredAt())),
    Updates.inc("version", 1),
    Updates.push("transitions", new Document()
        .append("from", "DRAFT")
        .append("to", "SUBMITTED")
        .append("actorId", command.actorId())
        .append("occurredAt", Date.from(command.occurredAt()))
        .append("commandId", command.commandId())
        .append("reason", "Case submitted")),
    Updates.addToSet("processedCommandIds", command.commandId())
);

UpdateResult result = collection.updateOne(filter, update);

if (result.getMatchedCount() == 1) {
    return TransitionResult.applied();
}

return resolveFailedTransition(command);
```

Kunci utamanya:

```text
The filter is part of the invariant.
```

Bukan hanya update body yang penting. Filter adalah pagar state machine.

---

## 6. Resolving `matchedCount == 0`

Jangan langsung menganggap `matchedCount == 0` berarti “not found”. Dalam conditional update, nol bisa berarti banyak hal.

Resolution pattern:

```java
private TransitionResult resolveFailedTransition(SubmitCaseCommand command) {
    Document current = collection.find(Filters.eq("_id", command.caseId())).first();

    if (current == null) {
        return TransitionResult.notFound();
    }

    List<String> processed = current.getList("processedCommandIds", String.class, List.of());
    if (processed.contains(command.commandId())) {
        return TransitionResult.duplicateAlreadyApplied();
    }

    long currentVersion = current.getLong("version");
    if (currentVersion != command.expectedVersion()) {
        return TransitionResult.staleVersion(currentVersion);
    }

    String status = current.getString("status");
    if (!status.equals("DRAFT")) {
        return TransitionResult.invalidState(status);
    }

    return TransitionResult.conflictUnknown();
}
```

Ini lebih jujur daripada satu exception generik.

Untuk API, mapping bisa seperti:

| Result | HTTP-ish Response | Makna |
|---|---:|---|
| `notFound` | 404 | aggregate tidak ada |
| `duplicateAlreadyApplied` | 200/204 | idempotent success |
| `staleVersion` | 409 | client memakai snapshot lama |
| `invalidState` | 409/422 | transition tidak legal dari current state |
| `conflictUnknown` | 409 | invariant gagal tapi perlu investigasi |

---

## 7. Optimistic Concurrency Dengan Version Field

Version field adalah pola sederhana tapi powerful.

Document:

```javascript
{
  _id: ObjectId("..."),
  status: "UNDER_REVIEW",
  version: 12,
  updatedAt: ISODate("2026-06-21T10:00:00Z")
}
```

Client membaca version 12.

Update harus menyertakan:

```javascript
{ _id: caseId, version: 12 }
```

lalu:

```javascript
{ $inc: { version: 1 } }
```

Jika actor lain sudah update lebih dulu, version menjadi 13, sehingga update actor lama gagal.

Ini mencegah lost update.

### 7.1 Version Harus Monotonic

Jangan set version manual dari aplikasi:

```javascript
{ $set: { version: 13 } }
```

Lebih aman:

```javascript
{ $inc: { version: 1 } }
```

Karena `$inc` terjadi server-side secara atomic dalam update yang sama.

### 7.2 Version Bukan Audit Trail

Version hanya concurrency token.

Ia tidak menjelaskan:

- siapa mengubah,
- kenapa berubah,
- field apa yang berubah,
- transition apa yang terjadi.

Untuk audit, tetap butuh event/history.

### 7.3 Version Bukan Global Ordering

Version per document bukan global sequence seluruh sistem.

Jangan gunakan `case.version` untuk mengurutkan event lintas case.

---

## 8. Guard Field Selain Version

Version berguna, tetapi sering tidak cukup.

Contoh approval:

```javascript
{
  _id: caseId,
  status: "DECISION_PENDING",
  version: 18,
  assignedReviewerId: actorId,
  "decision.exists": { $ne: true }
}
```

Guard dapat mencakup:

| Guard | Tujuan |
|---|---|
| `status` | legal source state |
| `version` | stale write prevention |
| `tenantId` | tenant isolation |
| `assignedReviewerId` | actor still owns work |
| `assignedTeamId` | team boundary |
| `decision: null` | prevent double decision |
| `flags: { $ne: ... }` | block action under special condition |
| `processedCommandIds: { $ne: commandId }` | idempotency |
| `lockedUntil: { $lt: now }` | lease availability |
| `deletedAt: null` | soft-delete guard |
| `legalHold: { $ne: true }` | retention/compliance guard |

High-quality MongoDB write design sering terlihat dari seberapa tepat filternya, bukan dari seberapa banyak service-layer `if` statement.

---

## 9. Idempotency: Retry Tanpa Duplicate Side Effect

Distributed systems akan retry.

Retry bisa datang dari:

- HTTP client,
- gateway,
- message consumer,
- scheduler,
- Java driver retryable write,
- operator manual replay,
- batch job restart,
- failover.

Jika command tidak idempotent, retry bisa menciptakan duplicate effect.

Contoh buruk:

```javascript
{
  $push: {
    transitions: {
      from: "UNDER_REVIEW",
      to: "ESCALATED",
      commandId: "cmd-123"
    }
  }
}
```

Jika retry terjadi, transition bisa masuk dua kali bila tidak ada guard.

Pola idempotent:

```javascript
filter: {
  _id: caseId,
  status: "UNDER_REVIEW",
  processedCommandIds: { $ne: "cmd-123" }
}

update: {
  $set: { status: "ESCALATED" },
  $push: { transitions: { commandId: "cmd-123", ... } },
  $addToSet: { processedCommandIds: "cmd-123" }
}
```

Tetapi ada batas: `processedCommandIds` array bisa tumbuh. Untuk command volume tinggi, gunakan collection idempotency terpisah.

---

## 10. Idempotency Collection Pattern

Collection:

```javascript
{
  _id: "tenant-a:cmd-123",
  tenantId: "tenant-a",
  commandId: "cmd-123",
  aggregateId: ObjectId("..."),
  commandType: "ESCALATE_CASE",
  status: "PROCESSING",
  createdAt: ISODate("2026-06-21T10:00:00Z"),
  completedAt: null,
  result: null
}
```

Unique `_id` atau unique index pada `(tenantId, commandId)` memastikan command hanya didaftarkan sekali.

Flow:

```text
1. Insert idempotency record with unique command id.
2. If duplicate key, read existing result.
3. Apply state transition.
4. Mark idempotency record completed.
```

Jika state transition dan idempotency record harus atomic lintas collection, gunakan transaction.

Jika tidak ingin transaction, simpan command id dalam aggregate document untuk transition tertentu.

Trade-off:

| Pattern | Kelebihan | Kekurangan |
|---|---|---|
| command id embedded di aggregate | single-document atomic | array growth, per-aggregate only |
| idempotency collection | scalable, global command tracking | butuh transaction/compensation |
| unique operation document | strong uniqueness | modelling lebih kompleks |

---

## 11. `findOneAndUpdate`: Claim, Return, and Act

Untuk worker queue atau assignment, sering perlu:

> cari satu task eligible, claim secara atomic, lalu return task tersebut ke worker.

Jika dilakukan read lalu update, race condition terjadi.

Buruk:

```java
Task task = collection.find(eq("status", "READY")).first();
collection.updateOne(eq("_id", task.id()), set("status", "PROCESSING"));
```

Dua worker bisa membaca task yang sama sebelum salah satu update.

Lebih baik:

```java
Document claimed = collection.findOneAndUpdate(
    Filters.and(
        Filters.eq("status", "READY"),
        Filters.or(
            Filters.exists("leaseUntil", false),
            Filters.lt("leaseUntil", Date.from(now))
        )
    ),
    Updates.combine(
        Updates.set("status", "PROCESSING"),
        Updates.set("workerId", workerId),
        Updates.set("leaseUntil", Date.from(now.plusSeconds(60))),
        Updates.inc("attempt", 1),
        Updates.set("updatedAt", Date.from(now))
    ),
    new FindOneAndUpdateOptions()
        .sort(Sorts.ascending("priority", "createdAt"))
        .returnDocument(ReturnDocument.AFTER)
);
```

MongoDB menyediakan `findAndModify`/`findOneAndUpdate` untuk melakukan find dan update sebagai compound operation terhadap satu document. Ini penting untuk menghindari celah antara read dan write.

---

## 12. Lease Pattern Untuk Distributed Worker

Lease bukan lock permanen. Lease adalah klaim sementara dengan expiry.

Document:

```javascript
{
  _id: ObjectId("..."),
  type: "GENERATE_CASE_SUMMARY",
  status: "READY",
  priority: 10,
  createdAt: ISODate("2026-06-21T10:00:00Z"),
  attempt: 0,
  lease: null
}
```

Claim:

```javascript
filter: {
  status: "READY",
  $or: [
    { "lease.until": { $exists: false } },
    { "lease.until": { $lt: now } }
  ]
}

update: {
  $set: {
    status: "PROCESSING",
    lease: {
      owner: workerId,
      until: now + 60s
    },
    updatedAt: now
  },
  $inc: { attempt: 1 }
}
```

Complete:

```javascript
filter: {
  _id: taskId,
  status: "PROCESSING",
  "lease.owner": workerId,
  "lease.until": { $gt: now }
}

update: {
  $set: {
    status: "DONE",
    completedAt: now,
    updatedAt: now
  },
  $unset: { lease: "" }
}
```

Fail/release:

```javascript
filter: {
  _id: taskId,
  status: "PROCESSING",
  "lease.owner": workerId
}

update: {
  $set: {
    status: "READY",
    lastError: errorSummary,
    updatedAt: now
  },
  $unset: { lease: "" }
}
```

Important invariant:

```text
Only the worker that owns a non-expired lease can complete the task.
```

Tanpa guard `lease.owner`, worker lama bisa menyelesaikan task setelah lease expired dan task sudah diambil worker lain.

---

## 13. Failure Case: Stale Worker Completion

Timeline:

```text
10:00:00 Worker A claims task, lease until 10:01:00
10:00:30 Worker A stalls due to GC pause/network hang
10:01:05 Worker B claims same task, lease until 10:02:05
10:01:10 Worker A resumes and marks task DONE
10:01:20 Worker B also marks task DONE or fails oddly
```

Jika complete filter hanya:

```javascript
{ _id: taskId }
```

maka Worker A bisa merusak state.

Complete filter harus:

```javascript
{
  _id: taskId,
  status: "PROCESSING",
  "lease.owner": "worker-A",
  "lease.until": { $gt: now }
}
```

Jika matched count 0, Worker A harus berhenti dan tidak melakukan side effect lanjutan.

---

## 14. Lock Document Pattern

Kadang yang ingin dijaga bukan satu task, tetapi resource logical.

Contoh:

- hanya satu nightly reconciliation per tenant,
- hanya satu migration per collection,
- hanya satu export per case,
- hanya satu workflow repair job per aggregate.

Collection `locks`:

```javascript
{
  _id: "tenant-a:nightly-reconciliation",
  owner: "worker-17",
  acquiredAt: ISODate("2026-06-21T10:00:00Z"),
  expiresAt: ISODate("2026-06-21T10:10:00Z"),
  fencingToken: 42
}
```

Acquire with upsert-like logic is tricky. Safer approach:

```javascript
findOneAndUpdate(
  {
    _id: lockId,
    $or: [
      { expiresAt: { $lt: now } },
      { owner: workerId }
    ]
  },
  {
    $set: {
      owner: workerId,
      acquiredAt: now,
      expiresAt: now + ttl
    },
    $inc: { fencingToken: 1 }
  },
  { upsert: true, returnDocument: AFTER }
)
```

Namun distributed lock punya banyak edge case. Untuk critical distributed coordination, gunakan system yang memang didesain untuk coordination jika konsekuensinya besar. MongoDB lock pattern cocok untuk coarse-grained operational guard, bukan pengganti consensus system untuk safety-critical orchestration.

---

## 15. Fencing Token

Lease alone can fail under pause.

Fencing token adalah angka monotonic yang naik setiap kali lock/lease diperoleh.

Contoh:

```javascript
{
  _id: "resource-123",
  owner: "worker-B",
  fencingToken: 43,
  expiresAt: ISODate("...")
}
```

Worker yang melakukan side effect membawa token.

Resource target menolak token lama.

```text
Worker A has token 42.
Worker B has token 43.
If Worker A resumes late, its write with token 42 must be rejected.
```

Di MongoDB aggregate yang sama, token bisa masuk filter:

```javascript
{
  _id: resourceId,
  currentFencingToken: 42
}
```

lalu update menaikkan token.

Untuk external side effect, external system juga harus mendukung compare token. Jika tidak, fencing hanya setengah solusi.

---

## 16. State History: Current State vs Event History

Ada dua kebutuhan berbeda:

1. current state untuk operasi cepat,
2. history untuk audit/reasoning.

Document bisa menyimpan dua-duanya:

```javascript
{
  status: "ESCALATED",
  version: 19,
  transitions: [ ... ]
}
```

Keuntungan:

- current state dan transition append bisa atomic,
- mudah membaca case timeline,
- cocok untuk history kecil.

Kekurangan:

- array bisa tumbuh,
- document size limit,
- update semakin berat,
- concurrent append ke document yang sama bisa menjadi hotspot,
- audit retention mungkin berbeda dari case retention.

Alternatif:

```text
cases
case_events
```

`cases`:

```javascript
{
  _id: caseId,
  status: "ESCALATED",
  version: 19,
  updatedAt: now
}
```

`case_events`:

```javascript
{
  _id: ObjectId("..."),
  caseId: caseId,
  seq: 19,
  type: "CASE_ESCALATED",
  actorId: "user-123",
  occurredAt: now,
  commandId: "cmd-789",
  payload: { ... }
}
```

Agar atomic lintas collection, gunakan transaction atau outbox-style compensation.

---

## 17. Audit-Grade Transition Event

Untuk regulated system, transition event harus cukup kaya.

Minimal:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tenant-a",
  aggregateType: "CASE",
  aggregateId: ObjectId("..."),
  aggregateVersion: 19,
  commandId: "cmd-789",

  eventType: "CASE_ESCALATED",
  fromStatus: "UNDER_REVIEW",
  toStatus: "ESCALATED",

  actor: {
    id: "user-123",
    type: "HUMAN",
    displayName: "Jane Reviewer",
    rolesAtTime: ["REVIEWER", "ESCALATION_INITIATOR"]
  },

  reason: {
    code: "HIGH_IMPACT",
    text: "Potential systemic market impact"
  },

  requestContext: {
    requestId: "req-abc",
    ipAddressHash: "...",
    userAgentHash: "..."
  },

  policyContext: {
    policyVersion: "enforcement-policy-2026.04",
    transitionRuleId: "TR-ESC-001"
  },

  occurredAt: ISODate("2026-06-21T10:15:00Z"),
  recordedAt: ISODate("2026-06-21T10:15:01Z")
}
```

Important distinction:

```text
occurredAt = when business action happened.
recordedAt = when system persisted it.
```

Untuk audit, jangan hanya menyimpan `updatedBy` dan `updatedAt`. Itu terlalu tipis.

---

## 18. Transactional State + Event Append

Jika `cases` dan `case_events` harus selalu konsisten, gunakan transaction:

```java
client.startSession().withTransaction(() -> {
    UpdateResult update = cases.updateOne(session,
        Filters.and(
            Filters.eq("_id", caseId),
            Filters.eq("status", "UNDER_REVIEW"),
            Filters.eq("version", expectedVersion)
        ),
        Updates.combine(
            Updates.set("status", "ESCALATED"),
            Updates.inc("version", 1),
            Updates.set("updatedAt", Date.from(now))
        )
    );

    if (update.getMatchedCount() != 1) {
        throw new TransitionConflictException();
    }

    caseEvents.insertOne(session, new Document()
        .append("caseId", caseId)
        .append("aggregateVersion", expectedVersion + 1)
        .append("eventType", "CASE_ESCALATED")
        .append("fromStatus", "UNDER_REVIEW")
        .append("toStatus", "ESCALATED")
        .append("commandId", commandId)
        .append("occurredAt", Date.from(now))
    );

    return null;
});
```

Gunakan transaction dengan sadar:

- baik untuk cross-collection consistency yang benar-benar wajib,
- buruk jika dipakai untuk menutupi aggregate boundary yang salah,
- perlu retry handling,
- perlu timeout budget,
- perlu observability.

---

## 19. Outbox Pattern Dengan MongoDB

Jika transition harus memicu external event ke Kafka/RabbitMQ, jangan publish langsung setelah update tanpa recovery plan.

Buruk:

```text
1. Update case to ESCALATED.
2. Publish CaseEscalated event.
```

Jika proses crash setelah step 1 sebelum step 2, state berubah tetapi event hilang.

Pola outbox:

Within transaction:

```text
1. Update case.
2. Insert outbox message.
```

Outbox document:

```javascript
{
  _id: ObjectId("..."),
  aggregateType: "CASE",
  aggregateId: caseId,
  aggregateVersion: 19,
  eventType: "CaseEscalated",
  payload: { ... },
  status: "PENDING",
  createdAt: now,
  publishedAt: null,
  attempts: 0
}
```

Publisher worker:

```text
1. Claim pending outbox message with lease.
2. Publish to broker.
3. Mark as published.
```

Downstream consumer must still be idempotent, because publish confirmation and DB update can have ambiguity.

---

## 20. Transition as Command Handler

A clean Java architecture often separates:

- command DTO,
- authorization check,
- transition rule validation,
- atomic repository operation,
- failure resolution,
- event/outbox handling.

Example:

```java
public final class EscalateCaseHandler {
    private final CaseRepository caseRepository;
    private final PermissionService permissionService;
    private final Clock clock;

    public EscalateCaseResult handle(EscalateCaseCommand command) {
        permissionService.require(command.actorId(), Permission.ESCALATE_CASE);

        Instant now = clock.instant();

        TransitionAttempt attempt = TransitionAttempt.builder()
            .caseId(command.caseId())
            .commandId(command.commandId())
            .actorId(command.actorId())
            .expectedVersion(command.expectedVersion())
            .fromStatus(CaseStatus.UNDER_REVIEW)
            .toStatus(CaseStatus.ESCALATED)
            .occurredAt(now)
            .reason(command.reason())
            .build();

        return caseRepository.applyEscalation(attempt);
    }
}
```

Repository method should not be a generic `save(case)`.

It should encode atomic operation:

```java
EscalateCaseResult applyEscalation(TransitionAttempt attempt);
```

Why?

Because `save(case)` hides concurrency semantics. A named transition method can encode exact filter/update.

---

## 21. Avoid Generic Save for Stateful Aggregates

Generic save often does this:

```java
replaceOne({ _id: id }, fullDocument)
```

Danger:

- can overwrite concurrent changes,
- can erase fields unknown to current application version,
- can replace arrays accidentally,
- can ignore legal transition guards,
- can bypass idempotency,
- can make audit history inconsistent.

For stateful aggregates, prefer command-specific updates:

```java
submitCase(command)
assignReviewer(command)
startReview(command)
requestInformation(command)
escalateCase(command)
recordDecision(command)
closeCase(command)
```

Each method owns:

- allowed source state,
- required actor/role/assignment,
- version expectation,
- state mutation,
- summary field updates,
- transition append,
- idempotency behavior.

This style is less “generic”, but much safer.

---

## 22. State Transition Table as Code + Data

For complex regulated workflows, hardcoding all transitions in Java can become difficult to govern.

Alternative: transition rule table/config.

```javascript
{
  _id: "CASE:UNDER_REVIEW:ESCALATED:v2026.04",
  workflowType: "CASE",
  from: "UNDER_REVIEW",
  to: "ESCALATED",
  policyVersion: "2026.04",
  requiredPermissions: ["ESCALATE_CASE"],
  requiresAssignedReviewer: true,
  requiresReason: true,
  forbiddenFlags: ["LEGAL_HOLD_BLOCKS_ESCALATION"],
  effectiveFrom: ISODate("2026-04-01T00:00:00Z"),
  effectiveTo: null
}
```

But be careful: dynamic workflow config can make behavior harder to reason about.

A good compromise:

- transition topology in code for compile-time clarity,
- policy metadata/config for effective rules,
- event records store policy version used at time of decision.

---

## 23. Authorization Is Also a Concurrency Problem

Authorization check at start of request can become stale.

Timeline:

```text
T1 reads: user-123 assigned reviewer
T2 reassigns case to user-999
T1 approves based on old screen
```

If T1 update filter does not include assigned reviewer, approval may pass.

Correct filter:

```javascript
{
  _id: caseId,
  status: "DECISION_PENDING",
  assignedReviewerId: "user-123",
  version: expectedVersion
}
```

This means authorization facts that are essential to action validity should appear in the write guard.

General rule:

```text
If a fact must still be true at commit time, put it in the update filter.
```

---

## 24. Tenant Isolation as Write Guard

Always include `tenantId` when operating in multi-tenant shared collections.

```javascript
{
  _id: caseId,
  tenantId: tenantId,
  status: "UNDER_REVIEW",
  version: expectedVersion
}
```

Do not rely only on `_id` if application bugs could mix tenant context.

Tenant filter belongs in:

- read queries,
- update filters,
- delete filters,
- aggregation `$match`,
- change stream processing logic,
- index prefixes for tenant-scoped access patterns.

---

## 25. Handling Duplicate Commands

There are two duplicate cases:

### 25.1 Duplicate After Success

Command already applied.

Expected behavior:

```text
Return previous success result.
```

Not:

```text
Throw conflict.
```

Because idempotency means same command can be safely repeated.

### 25.2 Duplicate While In Progress

Another request with same command id is currently processing.

Possible responses:

- return `202 Accepted`,
- wait/poll result,
- return conflict with retry-after,
- use idempotency result collection.

### 25.3 Same Semantic Action With Different Command ID

Example: user double-clicks Approve, frontend sends two different command IDs.

The first succeeds; second fails due to status/version guard.

This is not duplicate-id idempotency. This is conflict protection.

Both are needed.

---

## 26. Retryable Writes and Application Idempotency

MongoDB drivers can retry certain write operations after transient errors such as network errors or primary unavailability. This is useful, but it does not remove the need for application-level idempotency.

Why?

Because ambiguity remains:

```text
Client sends write.
Server applies write.
Network fails before client receives response.
Client sees timeout.
```

Did write happen?

The client may not know.

If the write is:

```javascript
{ $inc: { balance: -100 } }
```

blind retry is dangerous unless operation is protected by command id/invariant.

Safer:

```javascript
filter: {
  _id: accountId,
  processedCommandIds: { $ne: commandId },
  availableBalance: { $gte: 100 }
}

update: {
  $inc: { availableBalance: -100 },
  $addToSet: { processedCommandIds: commandId }
}
```

Application-level idempotency should be designed explicitly for business side effects.

---

## 27. Sequence Numbers Inside an Aggregate

For audit ordering per aggregate, use `version` or `seq`.

Example transition append:

```javascript
{
  $inc: { version: 1 },
  $push: {
    transitions: {
      seq: 13,
      from: "UNDER_REVIEW",
      to: "ESCALATED"
    }
  }
}
```

But setting `seq` to `expectedVersion + 1` is computed in application. It is safe only if filter includes expectedVersion.

```javascript
filter: { _id: caseId, version: 12 }
update: {
  $inc: { version: 1 },
  $push: { transitions: { seq: 13, ... } }
}
```

If filter fails, no duplicate seq is written.

For separate event collection, unique index helps:

```javascript
db.case_events.createIndex(
  { caseId: 1, aggregateVersion: 1 },
  { unique: true }
)
```

---

## 28. Terminal States Must Be Protected

Terminal states:

- `CLOSED`,
- `CANCELLED`,
- `REJECTED`,
- `APPROVED` depending domain,
- `ARCHIVED`,
- `DELETED`.

No update should accidentally modify business state after terminal state.

Guard:

```javascript
{
  _id: caseId,
  status: { $nin: ["CLOSED", "CANCELLED"] }
}
```

Better for specific transition:

```javascript
{
  _id: caseId,
  status: "APPROVED"
}
```

Avoid broad update commands that mutate all active and closed cases unless intentionally designed.

---

## 29. Soft Delete and State Machines

Soft delete is a state transition, not just setting `deletedAt`.

Bad:

```javascript
{ $set: { deletedAt: now } }
```

Better:

```javascript
filter: {
  _id: caseId,
  tenantId: tenantId,
  status: { $in: ["DRAFT", "CANCELLED"] },
  legalHold: { $ne: true },
  version: expectedVersion
}

update: {
  $set: {
    status: "DELETED",
    deletedAt: now,
    deletedBy: actorId,
    updatedAt: now
  },
  $inc: { version: 1 },
  $push: { transitions: { from: current, to: "DELETED", ... } }
}
```

If legal hold exists, deletion must fail at write filter level.

---

## 30. Arrays, Concurrent Updates, and Subdocument State

Suppose case has tasks embedded:

```javascript
{
  _id: caseId,
  tasks: [
    { taskId: "t1", status: "OPEN", assignedTo: "u1", version: 3 },
    { taskId: "t2", status: "OPEN", assignedTo: "u2", version: 1 }
  ]
}
```

Update one task:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    "tasks.taskId": "t1",
    "tasks.status": "OPEN"
  },
  {
    $set: {
      "tasks.$.status": "DONE"
    }
  }
)
```

But this can be ambiguous if multiple conditions are across array elements. Use `$elemMatch` in filter:

```javascript
{
  _id: caseId,
  tasks: {
    $elemMatch: {
      taskId: "t1",
      status: "OPEN",
      assignedTo: "u1",
      version: 3
    }
  }
}
```

And array filters for update:

```javascript
updateOne(
  filter,
  {
    $set: {
      "tasks.$[t].status": "DONE",
      "tasks.$[t].completedAt": now
    },
    $inc: {
      "tasks.$[t].version": 1,
      version: 1
    }
  },
  {
    arrayFilters: [
      { "t.taskId": "t1", "t.status": "OPEN", "t.version": 3 }
    ]
  }
)
```

However, if embedded tasks become independently assigned, queried, and updated frequently, they may deserve their own collection.

---

## 31. Hot Document Problem in Workflow Systems

A document becomes hot when many concurrent writers update the same document.

Examples:

- one case has thousands of notes appended rapidly,
- one tenant config stores all counters,
- one queue document tracks all worker progress,
- one aggregate contains all child task updates,
- one audit array receives every event.

Symptoms:

- write latency spikes,
- conflicts increase,
- retries increase,
- document grows fast,
- update lock contention,
- high CPU on one shard/primary.

Solution options:

| Problem | Possible Design |
|---|---|
| unbounded notes | separate `case_notes` collection |
| frequent task updates | separate `case_tasks` collection |
| high-volume audit | append-only `case_events` collection |
| counters | bucketed counters or computed periodically |
| queue workload | dedicated task documents, not one giant queue doc |

Document modelling should optimize locality, but not create a single write bottleneck.

---

## 32. State Machine With Separate Task Collection

For large workflows, use task documents:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tenant-a",
  caseId: ObjectId("..."),
  taskType: "REVIEW_EVIDENCE",
  status: "READY",
  priority: 50,
  assignedTo: null,
  lease: null,
  attempt: 0,
  createdAt: now,
  updatedAt: now
}
```

Indexes:

```javascript
db.case_tasks.createIndex({ tenantId: 1, status: 1, priority: -1, createdAt: 1 })
db.case_tasks.createIndex({ tenantId: 1, caseId: 1, status: 1 })
db.case_tasks.createIndex({ "lease.until": 1 })
```

Claim:

```javascript
findOneAndUpdate(
  {
    tenantId: tenantId,
    status: "READY",
    $or: [
      { "lease.until": { $exists: false } },
      { "lease.until": { $lt: now } }
    ]
  },
  {
    $set: {
      status: "PROCESSING",
      lease: { owner: workerId, until: nowPlus60s },
      updatedAt: now
    },
    $inc: { attempt: 1 }
  },
  {
    sort: { priority: -1, createdAt: 1 },
    returnDocument: "after"
  }
)
```

This is a queue-like pattern. It can work for moderate operational workloads, but MongoDB is not a replacement for Kafka/RabbitMQ when you need high-throughput durable messaging, fanout, consumer groups, or long event log semantics.

---

## 33. Preventing Illegal Transition With Unique Indexes

Some invariants are better protected by unique index.

Example: only one active assignment per case.

```javascript
{
  _id: ObjectId("..."),
  caseId: ObjectId("..."),
  assigneeId: "user-123",
  status: "ACTIVE",
  assignedAt: now
}
```

Unique partial index:

```javascript
db.case_assignments.createIndex(
  { caseId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" }
  }
)
```

Now two concurrent inserts for active assignment cannot both succeed.

Use unique indexes for invariants like:

- one active decision per case,
- one active assignment per task,
- one idempotency key per tenant,
- one open workflow instance per aggregate,
- one current configuration per tenant and type.

Application checks alone are not enough under concurrency.

---

## 34. Compare-and-Set Decision Recording

Decision is often irreversible or heavily audited.

Command:

```java
record RecordDecisionCommand(
    String commandId,
    ObjectId caseId,
    String actorId,
    long expectedVersion,
    DecisionType decisionType,
    String reasonCode,
    String reasonText
) {}
```

MongoDB filter:

```javascript
{
  _id: caseId,
  tenantId: tenantId,
  status: "DECISION_PENDING",
  version: expectedVersion,
  assignedReviewerId: actorId,
  decision: null,
  processedCommandIds: { $ne: commandId }
}
```

Update:

```javascript
{
  $set: {
    status: decisionType == "APPROVE" ? "APPROVED" : "REJECTED",
    decision: {
      type: decisionType,
      reasonCode: reasonCode,
      reasonText: reasonText,
      decidedBy: actorId,
      decidedAt: now
    },
    "transitionSummary.decidedAt": now,
    updatedAt: now
  },
  $inc: { version: 1 },
  $push: {
    transitions: {
      from: "DECISION_PENDING",
      to: decisionType == "APPROVE" ? "APPROVED" : "REJECTED",
      actorId: actorId,
      commandId: commandId,
      occurredAt: now,
      reasonCode: reasonCode
    }
  },
  $addToSet: { processedCommandIds: commandId }
}
```

This avoids:

- double decision,
- stale reviewer approval,
- decision after state changed,
- duplicate command side effects.

---

## 35. Read Model Race: UI Shows Old State

Typical scenario:

```text
User opens case at version 12.
Another actor escalates case to version 13.
User clicks Approve from stale screen.
```

The backend should not silently apply approval.

Response should say:

```json
{
  "error": "STALE_AGGREGATE_VERSION",
  "message": "The case changed after you opened it.",
  "currentVersion": 13,
  "currentStatus": "ESCALATED"
}
```

Then UI can:

- refresh,
- show conflict banner,
- ask user to review latest state,
- disable invalid action.

Optimistic concurrency is not just backend safety; it shapes user experience.

---

## 36. State Machine Query Design

Stateful systems usually need queries like:

- all cases in `UNDER_REVIEW` assigned to me,
- escalated cases by priority,
- cases pending decision older than SLA,
- tasks ready for worker claim,
- cases stuck in same state for too long,
- transitions by actor/time.

Indexes should match these access patterns.

Examples:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, assignedReviewerId: 1, updatedAt: -1 })
```

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, "sla.dueAt": 1 })
```

```javascript
db.case_events.createIndex({ tenantId: 1, aggregateId: 1, aggregateVersion: 1 }, { unique: true })
```

```javascript
db.case_events.createIndex({ tenantId: 1, actorId: 1, occurredAt: -1 })
```

```javascript
db.case_tasks.createIndex({ tenantId: 1, status: 1, priority: -1, createdAt: 1 })
```

State machine modelling without query/index design is incomplete.

---

## 37. Expiry, SLA, and Escalation Jobs

SLA escalation job:

```text
Find cases where status = UNDER_REVIEW and sla.dueAt < now.
Escalate or create escalation task.
```

Naive batch update:

```javascript
db.cases.updateMany(
  { status: "UNDER_REVIEW", "sla.dueAt": { $lt: now } },
  { $set: { status: "ESCALATED" } }
)
```

This is dangerous because:

- no per-case transition history,
- no command id,
- no actor/system context,
- no version increment semantics per aggregate reasoning,
- no idempotency,
- no individual failure handling,
- updateMany as a whole is not an aggregate transition model.

Better:

```text
1. Query candidate IDs using index.
2. For each case, issue conditional transition command.
3. Use command id such as SLA-ESCALATE:<caseId>:<dueAt>.
4. Record transition event.
5. Continue on conflict because case may have changed.
```

This is slower but defensible.

For high volume, process in bounded batches with worker claim pattern.

---

## 38. Bulk Transitions: Be Careful

Bulk operations are useful, but business state transitions are often not safe as blind bulk updates.

Safe bulk-ish scenario:

- set `archivalCandidate: true` for old closed cases,
- recompute denormalized field,
- add missing schema version field,
- migrate field shape.

Risky bulk scenario:

- approve all pending cases,
- close all escalated cases,
- delete all old cases,
- reassign all active tasks without audit.

If bulk transition has business meaning, model it as:

- batch command,
- per-aggregate transition,
- audit event per aggregate,
- summary batch record,
- conflict count,
- skipped reason.

---

## 39. Workflow Repair and Manual Intervention

Production workflows get stuck.

Examples:

- task stuck `PROCESSING` with expired lease,
- case status `DECISION_PENDING` but no decision task,
- event inserted but projection missing,
- version gap in audit events,
- assignment points to inactive user,
- SLA due but escalation missing.

Build repair tools with same invariant discipline.

Repair command should record:

```javascript
{
  eventType: "WORKFLOW_REPAIR_APPLIED",
  actorId: "admin-001",
  reason: "Task lease expired and no worker heartbeat",
  before: { status: "PROCESSING", leaseOwner: "worker-7" },
  after: { status: "READY", leaseOwner: null },
  approvedBy: "supervisor-009",
  occurredAt: now
}
```

Manual DB updates without audit are dangerous in regulated systems.

---

## 40. Common Failure Modes and How to Prevent Them

### 40.1 Lost Update

Cause:

```javascript
replaceOne({ _id: id }, fullDocument)
```

without version guard.

Prevention:

```javascript
{ _id: id, version: expectedVersion }
```

with `$inc` version.

### 40.2 Illegal Transition

Cause:

```javascript
{ _id: id }
```

without status guard.

Prevention:

```javascript
{ _id: id, status: expectedFrom }
```

### 40.3 Stale Actor

Cause:

authorization checked before reassignment.

Prevention:

```javascript
{ assignedReviewerId: actorId }
```

in write filter.

### 40.4 Duplicate Command

Cause:

retry without command id.

Prevention:

- embedded processed command id,
- idempotency collection,
- unique operation key.

### 40.5 Double Worker Processing

Cause:

read then update claim.

Prevention:

`findOneAndUpdate` with lease owner and expiry.

### 40.6 Stale Worker Completion

Cause:

completion filter only by task id.

Prevention:

filter by task id + lease owner + non-expired lease.

### 40.7 Missing Event After State Change

Cause:

state update and event publish not atomic.

Prevention:

transactional outbox.

### 40.8 Audit History Mismatch

Cause:

current state updated separately from history.

Prevention:

single-document atomic update or transaction.

### 40.9 Tenant Data Leakage

Cause:

update by `_id` only.

Prevention:

include `tenantId` in every filter.

### 40.10 Terminal State Mutation

Cause:

broad update without state guard.

Prevention:

explicit source state or terminal exclusion.

---

## 41. Java Repository Pattern for Atomic Transitions

Bad repository:

```java
interface CaseRepository {
    Optional<Case> findById(ObjectId id);
    void save(Case c);
}
```

Better for stateful aggregate:

```java
interface CaseWorkflowRepository {
    TransitionResult submit(SubmitCaseCommand command);
    TransitionResult assignReviewer(AssignReviewerCommand command);
    TransitionResult startReview(StartReviewCommand command);
    TransitionResult requestInformation(RequestInformationCommand command);
    TransitionResult escalate(EscalateCaseCommand command);
    TransitionResult recordDecision(RecordDecisionCommand command);
    TransitionResult close(CloseCaseCommand command);
}
```

The implementation can use MongoDB atomic updates internally.

This makes concurrency behavior visible in the application architecture.

---

## 42. Example: Escalation Repository Method

```java
public TransitionResult escalate(EscalateCaseCommand command) {
    Instant now = clock.instant();

    Bson filter = Filters.and(
        Filters.eq("_id", command.caseId()),
        Filters.eq("tenantId", command.tenantId()),
        Filters.eq("status", "UNDER_REVIEW"),
        Filters.eq("version", command.expectedVersion()),
        Filters.eq("assignedReviewerId", command.actorId()),
        Filters.ne("processedCommandIds", command.commandId()),
        Filters.ne("flags", "ESCALATION_BLOCKED")
    );

    Document transition = new Document()
        .append("from", "UNDER_REVIEW")
        .append("to", "ESCALATED")
        .append("actorId", command.actorId())
        .append("commandId", command.commandId())
        .append("reasonCode", command.reasonCode())
        .append("occurredAt", Date.from(now));

    Bson update = Updates.combine(
        Updates.set("status", "ESCALATED"),
        Updates.set("escalation", new Document()
            .append("escalatedBy", command.actorId())
            .append("escalatedAt", Date.from(now))
            .append("reasonCode", command.reasonCode())
            .append("reasonText", command.reasonText())),
        Updates.set("transitionSummary.escalatedAt", Date.from(now)),
        Updates.set("updatedAt", Date.from(now)),
        Updates.inc("version", 1),
        Updates.push("transitions", transition),
        Updates.addToSet("processedCommandIds", command.commandId())
    );

    UpdateResult result = cases.updateOne(filter, update);

    if (result.getMatchedCount() == 1) {
        return TransitionResult.applied();
    }

    return resolveEscalationFailure(command);
}
```

This method has no separate read-before-write. The write itself is the decision point.

---

## 43. Error Taxonomy for Workflow Transitions

Use precise domain errors.

```java
sealed interface TransitionResult {
    record Applied(long newVersion) implements TransitionResult {}
    record NotFound() implements TransitionResult {}
    record DuplicateAlreadyApplied() implements TransitionResult {}
    record StaleVersion(long currentVersion) implements TransitionResult {}
    record InvalidState(String currentStatus) implements TransitionResult {}
    record ActorNoLongerAssigned(String currentAssignee) implements TransitionResult {}
    record BlockedByFlag(String flag) implements TransitionResult {}
    record TenantMismatchOrNotVisible() implements TransitionResult {}
    record UnknownConflict() implements TransitionResult {}
}
```

Avoid collapsing all conflicts into `RuntimeException`.

Good conflict handling improves:

- API behavior,
- UI feedback,
- audit logs,
- support diagnosis,
- retry policy.

---

## 44. Retry Policy by Result Type

| Result | Retry? | Reason |
|---|---:|---|
| Applied | no | success |
| DuplicateAlreadyApplied | no | idempotent success |
| NotFound | no | permanent unless eventual creation expected |
| StaleVersion | maybe after re-read | client must refresh |
| InvalidState | no | command no longer legal |
| ActorNoLongerAssigned | no | permission/assignment changed |
| BlockedByFlag | no | business condition |
| UnknownConflict | maybe limited | depends on diagnosis |
| Network timeout | maybe | but only if idempotent |
| Transient transaction error | yes | with transaction retry logic |

Blind retry on business conflict usually makes systems noisier.

---

## 45. Designing Commands for Idempotency and Audit

A serious command should include:

```java
record WorkflowCommandEnvelope<T>(
    String commandId,
    String tenantId,
    String actorId,
    String requestId,
    Instant requestedAt,
    long expectedVersion,
    T payload
) {}
```

Do not let backend invent command identity too late if client retries are possible.

For user-facing APIs, support idempotency key:

```http
POST /cases/{id}/escalations
Idempotency-Key: cmd-789
```

The server maps this to command id.

---

## 46. Time and Clock Issues

Do not overtrust client timestamps.

Use server-side application clock for:

- `updatedAt`,
- `occurredAt` if action is received by system,
- lease expiry,
- SLA calculations.

If client action time matters, store separately:

```javascript
{
  clientActionAt: ISODate("..."),
  receivedAt: ISODate("..."),
  recordedAt: ISODate("...")
}
```

For lease pattern, clock skew across application nodes can matter. Prefer short leases with renewal and use consistent infrastructure time synchronization. For stricter needs, avoid implementing complex distributed coordination only with wall-clock assumptions.

---

## 47. Lease Renewal

Long-running workers may need heartbeat/renewal.

```javascript
filter: {
  _id: taskId,
  status: "PROCESSING",
  "lease.owner": workerId,
  "lease.fencingToken": token,
  "lease.until": { $gt: now }
}

update: {
  $set: {
    "lease.until": nowPlus60s,
    "lease.lastHeartbeatAt": now,
    updatedAt: now
  }
}
```

If renewal fails, worker should stop processing and avoid completing side effects.

---

## 48. Projection Consistency

If MongoDB stores current state and a separate read model/projection, projection lag can show stale UI.

Example:

- `cases` says `ESCALATED`,
- `case_search_projection` still says `UNDER_REVIEW`.

Mitigation:

- include version in projection,
- UI action sends expected aggregate version from source of truth,
- command handler checks source of truth, not projection,
- projection updater is idempotent and monotonic by version.

Projection update rule:

```javascript
filter: {
  caseId: event.caseId,
  projectedVersion: { $lt: event.aggregateVersion }
}

update: {
  $set: {
    status: event.toStatus,
    projectedVersion: event.aggregateVersion,
    updatedAt: now
  }
}
```

This prevents old projection events overwriting newer projection state.

---

## 49. Change Streams and State Machines

Change streams can observe changes and drive projections, indexing, notifications, or cache invalidation. Change streams are resumable using resume tokens.

But do not confuse change streams with explicit domain events.

Change stream event says:

```text
A document changed.
```

Domain event says:

```text
Case was escalated by actor X under policy Y for reason Z.
```

For regulated workflows, explicit domain event/outbox is usually more defensible.

Change streams are useful for:

- updating search index,
- cache invalidation,
- low-coupling internal projections,
- operational monitoring.

They are less ideal as the only business event contract.

---

## 50. Checklist: Designing a MongoDB State Machine

Use this checklist before implementing workflow logic.

### 50.1 Aggregate Boundary

- What is the aggregate root?
- Which fields must transition atomically?
- Is history bounded or unbounded?
- Are child tasks embedded or separate?

### 50.2 State Model

- What are all states?
- Which states are terminal?
- What transitions are legal?
- Which transitions require reason?
- Which transitions require actor assignment?
- Which transitions are system-triggered?

### 50.3 Concurrency

- Is there a `version` field?
- Does every transition filter include expected version?
- Does filter include expected source status?
- Does filter include assignment/ownership if relevant?
- Does filter include tenantId?

### 50.4 Idempotency

- Does every command have commandId/idempotency key?
- Where are processed command ids stored?
- Is duplicate success distinguishable from conflict?
- Are external side effects idempotent?

### 50.5 Audit

- Is current state updated with history/event atomically?
- Is actor captured?
- Is reason captured?
- Is policy/rule version captured?
- Is request context captured?
- Are occurredAt and recordedAt separated?

### 50.6 Operations

- What happens if worker dies mid-task?
- What happens if lease expires?
- Can stale worker complete?
- Can repair be audited?
- Are stuck states detectable?

### 50.7 Query and Index

- How does UI find actionable work?
- How do workers claim tasks?
- How do SLA jobs find overdue cases?
- Are those queries indexed?

---

## 51. Mini Case Study: Enforcement Case Escalation

### 51.1 Business Requirement

A case can be escalated only when:

- tenant matches,
- case is `UNDER_REVIEW`,
- actor is currently assigned reviewer,
- case is not blocked by legal hold,
- client version is current,
- command has not already been processed,
- reason code is supplied.

### 51.2 Document

```javascript
{
  _id: ObjectId("64f..."),
  tenantId: "regulator-id",
  status: "UNDER_REVIEW",
  version: 7,
  assignedReviewerId: "u-100",
  flags: ["HIGH_RISK"],
  processedCommandIds: [],
  transitions: []
}
```

### 51.3 Atomic Update

```javascript
db.cases.updateOne(
  {
    _id: ObjectId("64f..."),
    tenantId: "regulator-id",
    status: "UNDER_REVIEW",
    version: 7,
    assignedReviewerId: "u-100",
    flags: { $ne: "LEGAL_HOLD" },
    processedCommandIds: { $ne: "cmd-esc-001" }
  },
  {
    $set: {
      status: "ESCALATED",
      escalation: {
        reasonCode: "SYSTEMIC_RISK",
        reasonText: "Potential systemic impact detected",
        escalatedBy: "u-100",
        escalatedAt: ISODate("2026-06-21T10:00:00Z")
      },
      updatedAt: ISODate("2026-06-21T10:00:00Z")
    },
    $inc: { version: 1 },
    $push: {
      transitions: {
        from: "UNDER_REVIEW",
        to: "ESCALATED",
        actorId: "u-100",
        commandId: "cmd-esc-001",
        reasonCode: "SYSTEMIC_RISK",
        occurredAt: ISODate("2026-06-21T10:00:00Z")
      }
    },
    $addToSet: { processedCommandIds: "cmd-esc-001" }
  }
)
```

### 51.4 Outcomes

| `matchedCount` | Meaning |
|---:|---|
| 1 | escalation applied |
| 0 + command exists | duplicate already applied |
| 0 + version changed | stale screen/request |
| 0 + status changed | no longer under review |
| 0 + assignee changed | actor no longer owns case |
| 0 + legal hold flag | blocked by compliance condition |
| 0 + not found | case not visible or absent |

This is the difference between a simple update and a defensible workflow transition.

---

## 52. What Top Engineers Internalize

Top engineers do not ask only:

```text
How do I update this field?
```

They ask:

```text
What facts must still be true at the exact moment this write commits?
```

They do not rely only on service-layer validation.

They encode critical invariants in the write filter.

They do not treat retries as rare anomalies.

They assume retry, timeout, stale reads, duplicate commands, and concurrent actors will happen.

They do not design state machine as UI button logic.

They design it as persistent transition rules with atomic guards, audit evidence, and failure semantics.

---

## 53. Key Takeaways

1. In MongoDB, single-document atomicity is the foundation for safe state transitions.
2. State transition is not just `$set status`; it is a guarded mutation.
3. The update filter is part of the invariant.
4. Use expected `status`, `version`, `tenantId`, assignment, and idempotency key in filters.
5. `matchedCount == 0` must be resolved into domain-specific conflict categories.
6. Generic `save()` is risky for stateful aggregates.
7. Use command-specific repository methods for workflow transitions.
8. Idempotency is mandatory when retry is possible.
9. Lease/claim patterns need owner and expiry guards, not just status changes.
10. Stale workers must be prevented from completing work after lease loss.
11. Current state and history must be kept consistent using single-document atomic updates or transactions.
12. Change streams are useful, but explicit domain events/outbox are more defensible for business event contracts.
13. Workflow repair must be audited like any other state transition.
14. State machine design includes query/index design, not just enum design.
15. Regulated systems need reason, actor, policy version, and request context captured at transition time.

---

## 54. Latihan

### Latihan 1 — Design Transition Guard

Buat filter MongoDB untuk transition:

```text
AWAITING_INFORMATION -> UNDER_REVIEW
```

Rules:

- tenant must match,
- version must match,
- actor must be assigned reviewer,
- requested information must have been received,
- command id must not be duplicate,
- case must not be closed/cancelled.

Tulis filter dan update document.

### Latihan 2 — Claim Pattern

Desain collection `case_tasks` dan query `findOneAndUpdate` untuk worker yang mengambil task berdasarkan:

- tenant,
- status READY,
- priority descending,
- createdAt ascending,
- lease expired or absent.

Tambahkan complete operation yang aman dari stale worker.

### Latihan 3 — Audit Event

Desain audit event untuk transition:

```text
DECISION_PENDING -> REJECTED
```

Wajib mencakup:

- actor,
- reason,
- policy version,
- command id,
- aggregate version,
- request context,
- occurredAt,
- recordedAt.

### Latihan 4 — Failure Resolution

Buat pseudo-code Java untuk membedakan:

- not found,
- duplicate command,
- stale version,
- invalid state,
- actor no longer assigned,
- blocked by legal hold.

setelah `updateOne` menghasilkan `matchedCount == 0`.

---

## 55. Referensi Resmi yang Relevan

- MongoDB Manual — Atomicity and Transactions: single-document atomicity dan filter-based conflict prevention.
- MongoDB Manual — Model Data for Atomic Operations: embedding fields that must be atomically updated together.
- MongoDB Manual — Retryable Writes: driver retry behavior for supported writes.
- MongoDB Manual — Transactions: distributed transaction support for multi-document/multi-collection atomicity.
- MongoDB Manual — `findAndModify` / `findOneAndUpdate`: compound read-modify-write operation.
- MongoDB Manual — Change Streams: resumable observation of changes using resume tokens.
- MongoDB Java Sync Driver — Compound Operations: Java `findOneAndUpdate` style APIs.

---

## 56. Penutup Part 014

Part ini adalah salah satu fondasi paling penting untuk memakai MongoDB dalam sistem bisnis serius.

MongoDB tidak otomatis membuat workflow benar. Tetapi jika kita memahami document sebagai atomic boundary, lalu menulis state transition sebagai conditional update yang membawa invariant, MongoDB bisa menjadi platform yang sangat kuat untuk workflow-centric systems.

Mental model yang harus dibawa ke part berikutnya:

```text
State transition correctness lives at the write boundary.
```

Bukan hanya di controller.
Bukan hanya di service validation.
Bukan hanya di UI button.
Bukan hanya di enum.

Ia harus muncul di filter, update, versioning, idempotency, audit, dan error resolution.

Pada part berikutnya kita masuk ke Java Driver secara lebih praktis: connection lifecycle, connection pool, CRUD builders, codecs, POJO mapping, bulk write, dan repository abstraction yang aman.

---

**Status seri:** belum selesai.  
**Selesai sampai:** Part 014 / 035.  
**Berikutnya:** Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-015.md">Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs ➡️</a>
</div>
