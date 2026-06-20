# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-016.md

# Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 016 dari 035  
> Fokus: menggunakan MongoDB Java Sync Driver untuk capability runtime yang lebih serius: session, transaction, retry semantics, change streams, monitoring, observability, dan failure handling.

---

## 0. Posisi Bagian Ini Dalam Seri

Di Part 015 kita sudah membahas fondasi Java Driver:

- lifecycle `MongoClient`
- connection string
- timeout
- connection pool
- database/collection handle
- CRUD builder API
- codec registry
- POJO mapping
- bulk write
- repository abstraction

Part 016 naik satu level: dari “bisa menjalankan operasi database” menjadi “bisa mengendalikan perilaku runtime ketika sistem nyata mulai gagal, lambat, failover, retry, atau perlu observability”.

Di production, sebagian besar bug MongoDB + Java bukan terjadi karena engineer tidak tahu `insertOne()` atau `find()`. Bug serius biasanya muncul di area berikut:

1. transaksi dipakai tanpa memahami session dan retry semantics;
2. operasi retry menyebabkan double side effect;
3. change stream dianggap sama dengan Kafka;
4. connection pool habis tetapi root cause-nya tidak terlihat;
5. primary failover dianggap error biasa;
6. timeout tidak dipisahkan antara server selection, checkout, dan execution;
7. repository menyembunyikan query sampai observability hilang;
8. driver event tidak dimonitor sehingga performa hanya ditebak.

Part ini bertujuan membangun mental model agar Java application tidak hanya “connect ke MongoDB”, tetapi **berperilaku benar saat sistem distributed mulai tidak ideal**.

---

## 1. Mental Model: Driver Bukan Sekadar Library, Driver Adalah Runtime Boundary

Dalam aplikasi Java, MongoDB Java Driver adalah boundary antara:

```text
Application thread
  -> repository/service code
    -> MongoDB Java Driver
      -> connection pool
        -> server selection
          -> network socket
            -> mongod / mongos
              -> replica set / sharded cluster
```

Setiap call ke MongoDB melewati beberapa fase:

1. memilih server yang sesuai;
2. mengambil connection dari pool;
3. mengirim command;
4. menunggu server menjalankan operasi;
5. membaca response;
6. melepaskan connection kembali ke pool;
7. menerjemahkan response/error ke Java exception/result.

Karena itu, ketika sebuah call lambat, penyebabnya belum tentu query lambat. Bisa saja:

- server selection lambat karena topology tidak stabil;
- connection checkout lambat karena pool exhaustion;
- socket read lambat karena network/server pressure;
- query execution lambat karena index buruk;
- transaksi menunggu lock/resource;
- failover sedang terjadi;
- DNS/TLS handshake bermasalah;
- aplikasi membuat terlalu banyak concurrent requests.

Top 1% engineer tidak hanya bertanya:

> “Query-nya pakai index atau tidak?”

Tetapi juga:

> “Di fase mana waktu habis?”

---

## 2. ClientSession: Unit Konteks Untuk Causal Consistency dan Transaction

### 2.1 Apa itu session?

`ClientSession` adalah konteks operasi yang dipakai driver/server untuk menghubungkan beberapa operasi sebagai satu rangkaian logical.

Session diperlukan untuk:

- multi-document transaction;
- causal consistency;
- retryable write tracking;
- operation ordering dalam konteks tertentu;
- menjaga metadata transaction seperti transaction number dan cluster time.

Contoh dasar:

```java
try (ClientSession session = mongoClient.startSession()) {
    MongoCollection<Document> cases = database.getCollection("cases");

    cases.insertOne(session, new Document("caseId", "CASE-001")
            .append("state", "DRAFT"));
}
```

Perhatikan bahwa method collection punya overload dengan `ClientSession`.

Tanpa session:

```java
collection.updateOne(filter, update);
```

Dengan session:

```java
collection.updateOne(session, filter, update);
```

Secara desain, ketika sebuah flow membutuhkan konsistensi lintas beberapa operasi, session harus dipassing secara eksplisit atau dikelola oleh abstraction yang tetap transparan.

---

## 3. Session Lifecycle dan Kesalahan Umum

### 3.1 Session harus ditutup

`ClientSession` adalah resource. Gunakan try-with-resources:

```java
try (ClientSession session = mongoClient.startSession()) {
    // operations
}
```

Jangan menyimpan session sebagai field singleton:

```java
// buruk
class CaseRepository {
    private final ClientSession session; // jangan
}
```

Session adalah konteks operasi, bukan dependency global.

### 3.2 Jangan share session antar thread sembarangan

Session mewakili logical sequence. Menggunakannya secara paralel dari banyak thread bisa membuat reasoning kacau. Perlakukan session sebagai scoped object untuk satu flow request/command.

### 3.3 Session bukan transaction secara otomatis

Ini penting.

```java
try (ClientSession session = mongoClient.startSession()) {
    collection.insertOne(session, doc1);
    collection.insertOne(session, doc2);
}
```

Kode di atas menggunakan session, tetapi belum tentu transaction. Transaction dimulai eksplisit dengan `startTransaction()` atau helper transaction callback.

---

## 4. Causal Consistency: Read Your Own Writes Dengan Batasan

Causal consistency membantu aplikasi membaca hasil write sebelumnya dalam session yang sama, selama konfigurasi read/write concern mendukung.

Mental model:

```text
write A happens-before read B
```

Jika aplikasi menulis data lalu membaca dari secondary tanpa causal consistency, ada risiko read melihat state lama karena replication lag.

Contoh flow bermasalah:

```text
1. User update profile ke primary.
2. API berikutnya read profile dari secondary.
3. Secondary belum catch up.
4. User melihat data lama.
```

Solusi bisa berupa:

- baca dari primary untuk read-after-write critical path;
- gunakan session causal consistency;
- gunakan majority read/write concern bila sesuai;
- desain UI/API agar eventual consistency eksplisit.

Untuk sistem enforcement/regulatory, causal expectation harus dipetakan per use case. Tidak semua read perlu strict read-your-own-write, tetapi decision/action screen biasanya perlu.

---

## 5. Transaction Dengan Java Driver

### 5.1 Kapan transaction diperlukan?

Transaction diperlukan ketika beberapa perubahan di beberapa document/collection harus commit sebagai satu unit atomic.

Contoh:

```text
Approve case:
- update cases.currentState = APPROVED
- insert case_decisions record
- insert audit_events record
- update work_items status
```

Namun di MongoDB, pertanyaan pertama bukan:

> “Bagaimana membuat transaction?”

Pertanyaan pertama seharusnya:

> “Apakah boundary data sudah benar sehingga single-document atomic update cukup?”

Transaction adalah alat, bukan substitusi untuk modelling.

### 5.2 Transaction manual

```java
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();
    try {
        MongoCollection<Document> cases = db.getCollection("cases");
        MongoCollection<Document> audit = db.getCollection("audit_events");

        cases.updateOne(
                session,
                Filters.eq("caseId", "CASE-001"),
                Updates.combine(
                        Updates.set("state", "APPROVED"),
                        Updates.currentTimestamp("updatedAt")
                )
        );

        audit.insertOne(
                session,
                new Document("caseId", "CASE-001")
                        .append("eventType", "CASE_APPROVED")
                        .append("createdAt", Instant.now())
        );

        session.commitTransaction();
    } catch (RuntimeException ex) {
        session.abortTransaction();
        throw ex;
    }
}
```

Masalah kode di atas: retry belum benar. Dalam distributed system, commit bisa gagal dengan error yang ambiguity-nya harus ditangani.

---

## 6. Transaction Callback Pattern

Driver menyediakan pola callback transaction agar retry lebih rapi.

Contoh bentuk konseptual:

```java
TransactionOptions txnOptions = TransactionOptions.builder()
        .readConcern(ReadConcern.SNAPSHOT)
        .writeConcern(WriteConcern.MAJORITY)
        .readPreference(ReadPreference.primary())
        .build();

try (ClientSession session = mongoClient.startSession()) {
    session.withTransaction(() -> {
        cases.updateOne(
                session,
                Filters.and(
                        Filters.eq("caseId", command.caseId()),
                        Filters.eq("state", "UNDER_REVIEW")
                ),
                Updates.combine(
                        Updates.set("state", "APPROVED"),
                        Updates.inc("version", 1),
                        Updates.currentTimestamp("updatedAt")
                )
        );

        auditEvents.insertOne(session, new Document()
                .append("caseId", command.caseId())
                .append("eventType", "CASE_APPROVED")
                .append("actorId", command.actorId())
                .append("occurredAt", Instant.now()));

        return null;
    }, txnOptions);
}
```

Keuntungan callback:

- transaction lifecycle lebih aman;
- commit/abort lebih terstruktur;
- retry pattern lebih mudah distandarkan;
- semua operasi dalam callback memakai session yang sama.

Namun callback bukan alasan untuk menaruh side effect non-database di dalam transaksi.

Buruk:

```java
session.withTransaction(() -> {
    cases.updateOne(session, filter, update);
    emailClient.sendApprovalEmail(...); // buruk
    audit.insertOne(session, event);
    return null;
});
```

Kenapa buruk?

Karena transaction bisa di-retry. Email bisa terkirim dua kali. External side effect tidak otomatis rollback.

Prinsip:

> Di dalam transaction callback, hanya lakukan operasi yang aman diulang atau benar-benar berada dalam transaction boundary yang sama.

---

## 7. Retry Semantics: Error Bukan Hanya Error

Dalam MongoDB distributed deployment, beberapa error bersifat transient. Driver/server bisa memberi label error tertentu, misalnya konsep seperti:

- transient transaction error;
- unknown transaction commit result;
- retryable write error.

Mental model:

```text
Operation failed
  -> Apakah server pasti tidak menjalankan operasi?
  -> Apakah operasi mungkin sudah berhasil tetapi response hilang?
  -> Apakah aman diulang?
  -> Apakah command idempotent?
```

Contoh ambiguity:

```text
1. Client kirim commitTransaction.
2. Server commit berhasil.
3. Network putus sebelum client menerima response.
4. Client melihat exception.
```

Dari sisi client, hasilnya unknown. Jika client asal retry business command dari awal tanpa idempotency, bisa terjadi double side effect.

---

## 8. Idempotency Key Untuk Command-Level Safety

Retry teknis harus dipisahkan dari retry business command.

Contoh command:

```java
public record ApproveCaseCommand(
        String commandId,
        String caseId,
        String actorId,
        String reason
) {}
```

`commandId` harus unik untuk satu intent.

Document pattern:

```javascript
{
  _id: "CASE-001",
  state: "APPROVED",
  processedCommands: [
    {
      commandId: "CMD-2026-0001",
      type: "APPROVE_CASE",
      processedAt: ISODate("2026-06-21T10:00:00Z")
    }
  ]
}
```

Atau collection terpisah:

```javascript
{
  _id: "CMD-2026-0001",
  aggregateId: "CASE-001",
  commandType: "APPROVE_CASE",
  status: "PROCESSED",
  resultRef: "DECISION-9001",
  processedAt: ISODate("2026-06-21T10:00:00Z")
}
```

Dengan unique index pada `_id` atau `commandId`, retry command bisa dideteksi.

Command handler flow:

```text
1. Terima command dengan commandId.
2. Cek/insert idempotency marker.
3. Jalankan state transition.
4. Simpan result.
5. Jika command yang sama datang lagi, return result yang sama.
```

Ini lebih penting daripada sekadar “retry 3 kali”.

---

## 9. Optimistic Concurrency Dalam Transaction dan Non-Transaction

Untuk banyak use case, compare-and-set update cukup tanpa transaction.

Contoh:

```java
UpdateResult result = cases.updateOne(
        Filters.and(
                Filters.eq("caseId", command.caseId()),
                Filters.eq("state", "UNDER_REVIEW"),
                Filters.eq("version", command.expectedVersion())
        ),
        Updates.combine(
                Updates.set("state", "APPROVED"),
                Updates.inc("version", 1),
                Updates.currentTimestamp("updatedAt")
        )
);

if (result.getMatchedCount() == 0) {
    throw new ConcurrentModificationException("Case state or version changed");
}
```

Ini atomic pada satu document.

Jika audit event harus dijamin ikut commit, gunakan transaction. Jika audit event bisa dibangun dari change stream/outbox/reconciliation, single document update bisa lebih sederhana.

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Single-document CAS | cepat, sederhana, atomic | audit/event eksternal perlu strategi tambahan |
| Multi-document transaction | atomic lintas document | lebih mahal, retry lebih kompleks |
| Outbox embedded di aggregate | atomic dengan aggregate | document growth perlu dijaga |
| Separate outbox transaction | reliable integration | transaction tetap dibutuhkan |

---

## 10. Change Streams: Apa, Kapan, dan Batasannya

Change stream memungkinkan aplikasi mengamati perubahan pada collection, database, atau deployment.

Mental model:

```text
MongoDB write
  -> oplog/change stream machinery
    -> application watcher receives change event
      -> application updates cache/search/read model/etc.
```

Contoh penggunaan:

- invalidasi cache;
- update search index;
- sinkronisasi read model;
- trigger lightweight projection;
- audit enrichment;
- notifying internal worker;
- monitoring domain activity.

Tetapi change stream bukan pengganti Kafka untuk semua hal.

Change stream bukan ideal untuk:

- public business event contract jangka panjang;
- high fan-out event bus;
- event replay multi-year;
- cross-domain integration contract;
- exactly-once external side effects;
- complex stream processing;
- analytics-grade event retention.

Gunakan change stream sebagai **database change observation mechanism**, bukan default enterprise event backbone.

---

## 11. Basic Change Stream Dengan Java Driver

Contoh sederhana:

```java
MongoCollection<Document> cases = db.getCollection("cases");

try (MongoCursor<ChangeStreamDocument<Document>> cursor = cases.watch().iterator()) {
    while (cursor.hasNext()) {
        ChangeStreamDocument<Document> change = cursor.next();
        System.out.println("operationType = " + change.getOperationType());
        System.out.println("documentKey = " + change.getDocumentKey());
    }
}
```

Dalam production, jangan berhenti di contoh ini.

Production concern:

- blocking behavior;
- cancellation/shutdown;
- resume token persistence;
- retry loop;
- backoff;
- error classification;
- idempotent processing;
- lag monitoring;
- poison event handling;
- deployment topology;
- full document lookup cost.

---

## 12. Change Stream Pipeline Filtering

Jangan mengambil semua event lalu filter di Java bila bisa filter di server.

Contoh pipeline:

```java
List<Bson> pipeline = List.of(
        Aggregates.match(Filters.in("operationType", List.of("insert", "update", "replace"))),
        Aggregates.match(Filters.eq("ns.coll", "cases"))
);

cases.watch(pipeline).forEach(change -> {
    // process relevant change
});
```

Untuk domain event projection, lebih baik hanya observe perubahan yang relevan.

Contoh filter state changed ke `APPROVED` bisa sulit jika hanya melihat updateDescription. Kadang lebih mudah memakai `fullDocument(UPDATE_LOOKUP)`.

```java
cases.watch()
        .fullDocument(FullDocument.UPDATE_LOOKUP)
        .forEach(change -> {
            Document full = change.getFullDocument();
            if (full != null && "APPROVED".equals(full.getString("state"))) {
                // update projection/search/etc.
            }
        });
```

Trade-off `UPDATE_LOOKUP`:

- lebih mudah untuk consumer;
- ada extra lookup cost;
- full document yang diterima adalah versi setelah update, bukan necessarily diff semantic yang lengkap;
- jika document besar, network overhead meningkat.

---

## 13. Resume Token: Kunci Recovery Change Stream

Change stream menghasilkan resume token. Token ini memungkinkan consumer melanjutkan dari posisi terakhir.

Pseudo-flow:

```text
1. Start watcher.
2. Receive event E1.
3. Process E1 idempotently.
4. Persist resume token after successful processing.
5. Crash.
6. Restart watcher using saved resume token.
7. Continue from after E1.
```

Jangan persist resume token sebelum side effect selesai.

Buruk:

```text
1. Receive event.
2. Save resume token.
3. Crash sebelum update search index.
4. Restart after token.
5. Event hilang dari consumer perspective.
```

Lebih aman:

```text
1. Receive event.
2. Process event idempotently.
3. Commit side effect / projection update.
4. Save resume token.
```

Jika side effect dan token disimpan di storage berbeda, masih ada gap. Karena itu idempotency tetap diperlukan.

---

## 14. Designing a Robust Change Stream Worker

Komponen worker:

```text
ChangeStreamWorker
  -> ResumeTokenStore
  -> EventHandler
  -> IdempotencyStore
  -> DeadLetterStore
  -> Metrics
  -> BackoffPolicy
```

Pseudo-code:

```java
public final class CaseChangeStreamWorker implements Runnable {
    private final MongoCollection<Document> cases;
    private final ResumeTokenStore tokenStore;
    private final CaseChangeHandler handler;
    private volatile boolean running = true;

    @Override
    public void run() {
        while (running) {
            try {
                BsonDocument lastToken = tokenStore.load("case-worker");

                ChangeStreamIterable<Document> stream = cases.watch()
                        .fullDocument(FullDocument.UPDATE_LOOKUP);

                if (lastToken != null) {
                    stream = stream.resumeAfter(lastToken);
                }

                try (MongoCursor<ChangeStreamDocument<Document>> cursor = stream.iterator()) {
                    while (running && cursor.hasNext()) {
                        ChangeStreamDocument<Document> change = cursor.next();
                        handler.handle(change);
                        tokenStore.save("case-worker", change.getResumeToken());
                    }
                }
            } catch (Exception ex) {
                // log, metric, classify, then backoff
                sleepBackoff();
            }
        }
    }

    public void stop() {
        running = false;
    }
}
```

Catatan:

- ini skeleton, bukan production-complete;
- `handler.handle()` harus idempotent;
- token store harus reliable;
- shutdown perlu interrupt/cancel strategy;
- backoff perlu bounded dan observable;
- error tertentu bisa unrecoverable dan perlu operator action.

---

## 15. Idempotent Change Handler

Change event bisa diproses lebih dari sekali. Maka handler harus aman.

Contoh update search projection:

```java
public void handle(ChangeStreamDocument<Document> change) {
    String eventId = change.getResumeToken().toJson();

    boolean firstTime = idempotency.tryStart(eventId);
    if (!firstTime) {
        return;
    }

    try {
        Document full = change.getFullDocument();
        if (full == null) {
            idempotency.markIgnored(eventId);
            return;
        }

        searchIndex.upsertCaseProjection(
                full.getString("caseId"),
                mapToSearchProjection(full)
        );

        idempotency.markDone(eventId);
    } catch (Exception ex) {
        idempotency.markFailed(eventId, ex);
        throw ex;
    }
}
```

Untuk external system, upsert lebih aman daripada insert blind.

---

## 16. Monitoring: Driver-Level Observability

Monitoring driver berarti mengamati aktivitas runtime driver, bukan hanya query result.

Kategori event penting:

1. command monitoring;
2. connection pool monitoring;
3. cluster/server topology monitoring;
4. application metrics around repository calls.

MongoDB Java Driver mendukung event listener untuk memonitor aktivitas driver.

---

## 17. Command Monitoring

Command monitoring memberi visibility atas command yang dikirim ke server.

Contoh listener:

```java
public final class MongoCommandLogger implements CommandListener {
    @Override
    public void commandStarted(CommandStartedEvent event) {
        System.out.println("Mongo command started: " + event.getCommandName()
                + " requestId=" + event.getRequestId());
    }

    @Override
    public void commandSucceeded(CommandSucceededEvent event) {
        System.out.println("Mongo command succeeded: " + event.getCommandName()
                + " duration=" + event.getElapsedTime(TimeUnit.MILLISECONDS) + "ms");
    }

    @Override
    public void commandFailed(CommandFailedEvent event) {
        System.out.println("Mongo command failed: " + event.getCommandName()
                + " duration=" + event.getElapsedTime(TimeUnit.MILLISECONDS) + "ms"
                + " error=" + event.getThrowable().getClass().getSimpleName());
    }
}
```

Register:

```java
MongoClientSettings settings = MongoClientSettings.builder()
        .applyConnectionString(new ConnectionString(uri))
        .addCommandListener(new MongoCommandLogger())
        .build();

MongoClient client = MongoClients.create(settings);
```

Production note:

- jangan log full command sembarangan karena bisa berisi PII/secrets;
- redaction wajib untuk regulated systems;
- sampling bisa diperlukan;
- ukur duration per command name dan collection;
- jangan mengandalkan log string untuk metrics, gunakan metrics sink.

---

## 18. Connection Pool Monitoring

Connection pool adalah sumber bottleneck umum.

Gejala pool exhaustion:

- request latency naik;
- thread menunggu connection checkout;
- CPU database tidak tinggi tetapi aplikasi lambat;
- timeout terjadi sebelum command sampai server;
- idle change stream/long operation menahan resource;
- terlalu banyak concurrent request dibanding pool size.

Listener konseptual:

```java
public final class MongoPoolListener implements ConnectionPoolListener {
    @Override
    public void connectionCheckedOut(ConnectionCheckedOutEvent event) {
        // increment active connections
    }

    @Override
    public void connectionCheckedIn(ConnectionCheckedInEvent event) {
        // decrement active connections
    }

    @Override
    public void connectionCheckOutFailed(ConnectionCheckOutFailedEvent event) {
        // record checkout failure/timeouts
    }
}
```

Register:

```java
MongoClientSettings settings = MongoClientSettings.builder()
        .applyConnectionString(new ConnectionString(uri))
        .applyToConnectionPoolSettings(builder -> builder
                .addConnectionPoolListener(new MongoPoolListener()))
        .build();
```

Metrics yang berguna:

- active checked-out connections;
- wait queue time;
- checkout failures;
- pool size;
- created/closed connections;
- max pool utilization;
- timeout count;
- per endpoint repository latency.

---

## 19. Repository-Level Observability

Driver events penting, tetapi sering terlalu low-level untuk business diagnosis. Tambahkan metrics di repository/service boundary.

Contoh metric naming:

```text
mongo.repository.operation.duration
  tags:
    repository=CaseRepository
    operation=findByCaseId
    collection=cases
    outcome=success|failure
    exception=none|MongoTimeoutException|MongoCommandException
```

Kenapa perlu repository-level?

Karena command monitoring tahu `find`, tetapi tidak selalu tahu use case domain mana yang memanggilnya.

Layer observability ideal:

```text
API endpoint metrics
  -> service/command handler metrics
    -> repository operation metrics
      -> driver command metrics
        -> server metrics
```

Saat latency naik, kamu bisa trace dari endpoint sampai command database.

---

## 20. Timeout Taxonomy

Timeout bukan satu hal.

Beberapa timeout penting:

1. server selection timeout;
2. connection checkout timeout;
3. connect timeout;
4. socket read timeout;
5. client-side operation timeout;
6. application/request timeout;
7. transaction timeout;
8. load balancer/proxy timeout.

Jika semua timeout diset asal “30s”, diagnosis menjadi sulit.

Prinsip:

- application timeout harus menjadi budget total;
- database operation timeout harus lebih kecil dari request timeout;
- retry harus muat dalam budget;
- transaction tidak boleh menggantung terlalu lama;
- slow query harus gagal lebih awal daripada menumpuk thread;
- checkout timeout harus memberi sinyal pool pressure.

Contoh reasoning:

```text
API budget: 2s
Mongo operation budget: 700ms
Retry max: 1 retry untuk transient read tertentu
Pool checkout max: 100ms
Server selection max: 300ms
```

Ini bukan angka universal, tetapi menunjukkan bahwa timeout adalah desain, bukan default config.

---

## 21. Failure Mode: Primary Failover

Saat primary failover:

```text
1. Primary lama down/terisolasi.
2. Replica set election terjadi.
3. Selama window tertentu, write bisa gagal.
4. Driver topology view berubah.
5. Server selection bisa timeout sementara.
6. Retryable operation mungkin berhasil setelah primary baru tersedia.
```

Aplikasi harus siap menerima error transient.

Yang tidak boleh dilakukan:

- menganggap semua Mongo exception sebagai 500 permanent;
- retry tanpa idempotency;
- retry storm tanpa backoff;
- memperbesar timeout tanpa observability;
- fallback write ke secondary;
- menelan exception lalu menganggap sukses.

Yang sebaiknya dilakukan:

- classify exception;
- gunakan retry bounded;
- pastikan command idempotent;
- surface degraded state;
- monitor failover event;
- test failover di staging.

---

## 22. Failure Mode: Unknown Commit Result

Ini salah satu failure mode transaction paling penting.

Skenario:

```text
commitTransaction sent
  -> server commits
    -> response lost
      -> client sees exception
```

Aplikasi tidak boleh langsung menjalankan kompensasi yang menganggap transaction gagal.

Strategi:

1. gunakan driver transaction helper bila sesuai;
2. desain command idempotent;
3. simpan command result/idempotency marker;
4. jika result unknown, lakukan read-after-error untuk menentukan state;
5. jangan kirim external side effect sebelum transaction outcome jelas.

Contoh command recovery:

```text
Approve command timeout during commit.
System reads case by caseId.
If state APPROVED and commandId recorded -> return success.
If state UNDER_REVIEW and no command marker -> safe to retry.
If inconsistent -> escalate/reconcile.
```

---

## 23. Failure Mode: Change Stream Consumer Lag

Change stream worker bisa tertinggal.

Penyebab:

- handler lambat;
- external system lambat;
- event volume naik;
- fullDocument lookup mahal;
- worker crash loop;
- token store bermasalah;
- network issue;
- projection write bottleneck.

Metric yang perlu:

- last processed event time;
- lag duration;
- events processed per second;
- handler failure count;
- retry count;
- dead-letter count;
- resume count;
- current resume token age;
- fullDocument missing count.

Jika lag tinggi, jangan langsung menambah worker paralel tanpa memahami ordering dan partitioning.

---

## 24. Parallelizing Change Stream Processing

Change stream secara natural memberi ordered stream. Paralelisasi harus hati-hati.

Aman jika:

- event untuk aggregate berbeda bisa diproses independen;
- handler idempotent;
- ordering per aggregate dijaga;
- partition key jelas, misalnya `caseId`;
- projection upsert tolerant terhadap out-of-order update.

Pattern:

```text
watcher thread
  -> reads change events
  -> routes by aggregateId hash
    -> worker partition 0
    -> worker partition 1
    -> worker partition N
```

Ordering per aggregate:

```text
partition = hash(caseId) % workerCount
```

Tetapi resume token commit menjadi lebih kompleks karena event diproses paralel. Jangan menyimpan global token melewati event yang belum selesai.

Alternatif lebih sederhana:

- satu worker dulu;
- optimize handler;
- batch external updates;
- gunakan dedicated outbox collection;
- gunakan Kafka jika stream processing mulai kompleks.

---

## 25. Change Stream vs Outbox Pattern

### 25.1 Change stream langsung

```text
cases collection changed
  -> change stream worker
    -> publish/update external system
```

Kelebihan:

- tidak perlu menulis outbox eksplisit;
- observasi perubahan natural;
- cocok untuk internal projection/cache/search.

Risiko:

- event contract mengikuti database change shape;
- sulit menjamin semantic event;
- replay terbatas oleh oplog/history;
- filtering semantic bisa rumit;
- external integration bergantung pada DB internals.

### 25.2 Outbox eksplisit

```text
transaction:
  update aggregate
  insert outbox event

publisher:
  reads outbox
  publishes to broker/search/etc.
```

Kelebihan:

- event semantic eksplisit;
- idempotency lebih jelas;
- bisa retry/publish status;
- lebih cocok untuk business integration.

Risiko:

- butuh transaction atau embedded outbox;
- outbox cleanup;
- publisher complexity.

Rule praktis:

```text
Internal operational projection -> change stream acceptable
Business integration contract -> explicit outbox lebih defensible
```

---

## 26. Transaction + Outbox Dalam MongoDB

Contoh:

```java
try (ClientSession session = mongoClient.startSession()) {
    session.withTransaction(() -> {
        UpdateResult updated = cases.updateOne(
                session,
                Filters.and(
                        Filters.eq("caseId", command.caseId()),
                        Filters.eq("state", "UNDER_REVIEW")
                ),
                Updates.combine(
                        Updates.set("state", "APPROVED"),
                        Updates.inc("version", 1),
                        Updates.currentTimestamp("updatedAt")
                )
        );

        if (updated.getMatchedCount() == 0) {
            throw new IllegalStateException("Invalid transition");
        }

        outbox.insertOne(session, new Document()
                .append("eventId", UUID.randomUUID().toString())
                .append("eventType", "CaseApproved")
                .append("aggregateId", command.caseId())
                .append("payload", new Document()
                        .append("caseId", command.caseId())
                        .append("actorId", command.actorId()))
                .append("status", "PENDING")
                .append("createdAt", Instant.now()));

        return null;
    });
}
```

Publisher kemudian mengambil `PENDING`, publish, lalu mark `PUBLISHED`.

Gunakan unique index pada `eventId`, dan mungkin compound index:

```javascript
db.outbox.createIndex({ status: 1, createdAt: 1 })
db.outbox.createIndex({ eventId: 1 }, { unique: true })
```

---

## 27. Monitoring Transaction Health

Transaction yang buruk bisa menyebabkan latency dan contention.

Yang perlu diamati:

- transaction duration;
- abort count;
- retry count;
- transient transaction errors;
- unknown commit results;
- documents touched per transaction;
- collections touched;
- lock/contention symptoms;
- operation timeout inside transaction;
- transaction per endpoint.

Guideline:

- transaction harus pendek;
- jangan lakukan remote call di dalam transaction;
- jangan menunggu user input di dalam transaction;
- jangan menjalankan aggregation berat di dalam transaction;
- jangan memproses batch besar dalam satu transaction;
- hindari transaction sebagai default repository behavior.

---

## 28. Error Mapping Untuk Java Application

MongoDB exception harus diterjemahkan ke error domain/application yang meaningful.

Contoh kategori:

| Mongo/Runtime Condition | Application Meaning | Response |
|---|---|---|
| duplicate key | conflict/idempotent duplicate | 409 atau return existing result |
| matched count 0 on CAS | stale version/invalid transition | 409 |
| timeout | dependency timeout | 503/504 tergantung layer |
| transient transaction error | retryable internal | retry bounded lalu 503 |
| unauthorized | config/security bug | 500 internal + alert |
| validation failed | invalid persisted shape/input bug | 400 atau 500 tergantung source |
| network failover | temporary dependency failure | retry/degrade |

Repository jangan langsung leak semua driver exception ke API.

Namun jangan juga menghapus detail observability. Simpan:

- exception type;
- command name;
- collection;
- operation name;
- correlation ID;
- retry count;
- elapsed time.

---

## 29. Production-Grade Repository Boundary

Contoh interface:

```java
public interface CaseRepository {
    Optional<CaseDocument> findByCaseId(String tenantId, String caseId);

    TransitionResult transitionState(
            String tenantId,
            String caseId,
            String expectedState,
            String nextState,
            long expectedVersion,
            String commandId
    );

    void insertAuditEvent(ClientSession session, AuditEventDocument event);
}
```

Catatan:

- `tenantId` eksplisit;
- transition method mengekspresikan invariant, bukan generic update bebas;
- session muncul hanya pada method yang memang perlu transaction composition;
- query shape diketahui;
- result mengekspresikan matched/modified/conflict.

Buruk:

```java
void update(String collection, Bson filter, Bson update);
```

Abstraction terlalu generic sering menghapus domain invariant dan observability.

---

## 30. Example: Transaction Boundary Dengan Domain Service

```java
public final class ApproveCaseService {
    private final MongoClient mongoClient;
    private final CaseRepository caseRepository;
    private final OutboxRepository outboxRepository;

    public ApproveCaseResult approve(ApproveCaseCommand command) {
        try (ClientSession session = mongoClient.startSession()) {
            return session.withTransaction(() -> {
                TransitionResult transition = caseRepository.transitionToApproved(
                        session,
                        command.tenantId(),
                        command.caseId(),
                        command.expectedVersion(),
                        command.commandId(),
                        command.actorId(),
                        command.reason()
                );

                if (transition == TransitionResult.ALREADY_PROCESSED) {
                    return ApproveCaseResult.alreadyProcessed(command.caseId());
                }

                if (transition == TransitionResult.CONFLICT) {
                    throw new CaseTransitionConflictException(command.caseId());
                }

                outboxRepository.insert(session, OutboxEvent.caseApproved(
                        command.commandId(),
                        command.tenantId(),
                        command.caseId(),
                        command.actorId()
                ));

                return ApproveCaseResult.approved(command.caseId());
            });
        }
    }
}
```

Prinsip:

- service mengatur transaction boundary;
- repository menjalankan operation yang konkret;
- idempotency masuk ke transition;
- outbox event dibuat dalam transaction yang sama;
- external publish tidak dilakukan di transaction.

---

## 31. Read Preference Dalam Java Driver

Read preference menentukan dari mana read dilakukan.

Common options:

- primary;
- primaryPreferred;
- secondary;
- secondaryPreferred;
- nearest.

Default yang aman untuk consistency-sensitive path biasanya primary.

Contoh:

```java
MongoCollection<Document> cases = db.getCollection("cases")
        .withReadPreference(ReadPreference.primary());
```

Untuk reporting/dashboard yang toleran stale:

```java
MongoCollection<Document> dashboard = db.getCollection("case_summaries")
        .withReadPreference(ReadPreference.secondaryPreferred());
```

Jangan memakai secondary read hanya karena ingin “scale read” tanpa menilai stale read impact.

Use case matrix:

| Use Case | Read Preference |
|---|---|
| submit approval decision | primary |
| read immediately after update | primary/session causal |
| dashboard approximate | secondaryPreferred mungkin boleh |
| export/report non-critical | secondaryPreferred mungkin boleh |
| authorization decision | primary atau causally consistent |
| workflow task claim | primary |

---

## 32. ReadConcern dan WriteConcern Dalam Java

Contoh collection-level configuration:

```java
MongoCollection<Document> cases = db.getCollection("cases")
        .withReadConcern(ReadConcern.MAJORITY)
        .withWriteConcern(WriteConcern.MAJORITY);
```

Read/write concern harus dipilih berdasarkan invariant, bukan copy-paste.

### 32.1 WriteConcern majority

Memberi jaminan lebih kuat bahwa write sudah direplikasi ke mayoritas voting nodes sebelum dianggap acknowledged.

Trade-off:

- durability lebih kuat;
- latency bisa lebih tinggi;
- saat replica bermasalah, write bisa gagal/tertunda.

### 32.2 ReadConcern majority

Membaca data yang sudah majority-committed.

Trade-off:

- lebih konsisten;
- mungkin lebih mahal;
- tidak selalu diperlukan untuk semua read.

### 32.3 Transaction options

Untuk transaction, explicit options sering lebih baik:

```java
TransactionOptions options = TransactionOptions.builder()
        .readPreference(ReadPreference.primary())
        .readConcern(ReadConcern.SNAPSHOT)
        .writeConcern(WriteConcern.MAJORITY)
        .build();
```

---

## 33. Stable API

MongoDB Stable API memungkinkan aplikasi memilih API version tertentu agar command behavior lebih stabil terhadap upgrade server.

Contoh konseptual:

```java
ServerApi serverApi = ServerApi.builder()
        .version(ServerApiVersion.V1)
        .build();

MongoClientSettings settings = MongoClientSettings.builder()
        .applyConnectionString(new ConnectionString(uri))
        .serverApi(serverApi)
        .build();
```

Kapan berguna:

- regulated/enterprise environment;
- strict upgrade control;
- aplikasi besar dengan banyak query/aggregation;
- ingin mengurangi risiko behavior drift saat upgrade server.

Tetapi Stable API bukan pengganti integration test terhadap versi MongoDB baru.

---

## 34. Advanced Concern: Long-Running Cursor

Change streams dan query cursor panjang bisa memengaruhi resource.

Risiko:

- cursor tidak ditutup;
- thread blocked;
- connection/resource tertahan;
- idle stream dengan pool kecil;
- consumer lambat;
- shutdown tidak graceful.

Praktik:

- gunakan try-with-resources;
- pisahkan pool/client untuk long-running watcher bila perlu;
- monitor checked-out connections;
- gunakan bounded worker;
- pastikan shutdown menutup cursor;
- jangan menjalankan change stream worker di request thread.

---

## 35. Separate MongoClient Untuk Workload Berbeda?

Kadang satu `MongoClient` cukup. Tetapi workload tertentu bisa lebih aman dipisah.

Contoh pemisahan:

```text
MongoClient appClient
  -> normal API CRUD/query

MongoClient streamClient
  -> long-running change stream workers

MongoClient migrationClient
  -> batch/backfill jobs with separate pool/timeouts
```

Alasan:

- menghindari background job menghabiskan pool API;
- timeout berbeda;
- metrics lebih mudah;
- operational blast radius lebih kecil.

Risiko:

- terlalu banyak connection total;
- config drift;
- lifecycle lebih kompleks.

Rule:

> Pisahkan client jika workload punya karakteristik resource dan failure yang benar-benar berbeda.

---

## 36. Performance Pitfall: Monitoring Yang Terlalu Verbose

Command monitoring bisa mahal jika:

- semua command dilog penuh;
- payload besar;
- synchronous logging;
- log sink lambat;
- tidak ada sampling;
- redaction berat dilakukan di hot path.

Praktik aman:

- log summary, bukan full document;
- gunakan async logging;
- tag operation dengan repository/use case;
- sample success path;
- selalu log failure dengan redaction;
- export metrics numeric;
- trace only selected operations.

---

## 37. Integration With OpenTelemetry / APM

Tujuan tracing:

```text
HTTP request
  -> service method
    -> repository method
      -> MongoDB command
```

Span attributes yang berguna:

```text
db.system=mongodb
db.name=regulatory_cases
db.mongodb.collection=cases
db.operation=find|update|aggregate
app.repository=CaseRepository
app.operation=transitionToApproved
mongo.command=find|update|aggregate
mongo.retry_count=0|1|2
```

Jangan masukkan PII seperti full query filter jika berisi nama, NIK, alamat, dokumen rahasia, atau case-sensitive text.

---

## 38. Practical Failure-Handling Matrix

| Failure | Symptom | Likely Handling |
|---|---|---|
| primary failover | temporary write failures | bounded retry + idempotency |
| pool exhaustion | checkout timeout | reduce concurrency, tune pool, find leaked/long ops |
| slow query | high command duration | explain plan, index, query shape review |
| transient transaction error | transaction abort | retry whole transaction if safe |
| unknown commit | ambiguous success | read state/idempotency marker |
| duplicate key | unique violation | conflict or idempotent success |
| change stream resume failure | worker cannot continue | inspect token/oplog window, rebuild projection |
| external projection down | handler failures | retry/backoff/dead-letter |
| stale secondary read | user sees old state | primary read/causal session/change UX |
| network partition | timeouts, topology changes | retry bounded, alert, degrade |

---

## 39. Case Study: Approval Workflow Runtime Design

### 39.1 Requirements

A regulatory case can be approved by a reviewer.

Invariants:

1. only `UNDER_REVIEW` case can become `APPROVED`;
2. stale reviewer action must fail;
3. duplicate command must not duplicate decision/event;
4. audit must be written with approval;
5. search index should eventually reflect approval;
6. notification should be sent once;
7. system must tolerate primary failover.

### 39.2 Design

Collections:

```text
cases
case_audit_events
outbox_events
idempotency_commands
```

Transaction:

```text
insert idempotency marker
update case with CAS
insert audit event
insert outbox event CaseApproved
commit
```

After commit:

```text
outbox publisher publishes CaseApproved
notification service consumes event idempotently
search projection updated either from outbox consumer or change stream
```

### 39.3 Why not send notification in transaction?

Because email/notification is external side effect and cannot rollback with MongoDB transaction. If transaction retries, notification might duplicate.

### 39.4 Why not only change stream?

For search projection, change stream is acceptable. For business notification/event contract, explicit outbox is more defensible.

---

## 40. Production Checklist

### 40.1 Sessions and transactions

- [ ] session scoped per operation/request/command
- [ ] no shared global session
- [ ] transaction boundary owned by service layer
- [ ] no external side effects inside transaction
- [ ] transaction options explicit for critical flows
- [ ] retry semantics understood
- [ ] idempotency key exists for retried commands
- [ ] unknown commit result recovery designed

### 40.2 Change streams

- [ ] use case suitable for change stream
- [ ] resume token persisted after successful processing
- [ ] handler idempotent
- [ ] backoff implemented
- [ ] worker shutdown graceful
- [ ] lag metrics available
- [ ] dead-letter/reconciliation strategy exists
- [ ] fullDocument lookup cost understood

### 40.3 Monitoring

- [ ] command listener or APM integration configured
- [ ] connection pool metrics available
- [ ] repository latency metrics available
- [ ] slow operations correlated to endpoint/use case
- [ ] PII redaction enforced
- [ ] checkout timeout tracked separately from command timeout
- [ ] retry count visible
- [ ] transaction failure visible

### 40.4 Timeout and pool

- [ ] server selection timeout explicit
- [ ] operation timeout aligned with API budget
- [ ] pool size justified by concurrency and DB capacity
- [ ] background workers do not starve API pool
- [ ] long-running cursors isolated if needed
- [ ] load test includes failover/latency scenarios

---

## 41. Common Senior-Level Questions

### 41.1 “Should we wrap every write in transaction?”

No. In MongoDB, single-document atomicity is powerful. If every write needs transaction, revisit aggregate boundary. Use transaction when multiple independent documents must commit atomically and the invariant justifies the cost.

### 41.2 “Can change streams replace Kafka?”

Not generally. Change streams observe database changes. Kafka is an event log/broker platform with different retention, fan-out, replay, integration, and stream processing properties. Use change streams for internal projections/cache/search; use explicit outbox/broker for durable business event contracts.

### 41.3 “Can we retry MongoDB errors automatically?”

Only with classification and idempotency. Retrying non-idempotent business commands can duplicate side effects. Retry technical operations within a defined budget and design command-level idempotency.

### 41.4 “Why is our app slow when MongoDB CPU is low?”

Possibilities:

- connection pool exhaustion;
- server selection waits;
- network latency;
- lock/contention;
- thread starvation;
- downstream logging/APM overhead;
- large response deserialization;
- slow external side effects inside transaction/change handler.

### 41.5 “Should change stream workers share the same MongoClient as API requests?”

Maybe. For small systems, yes. For production systems with long-running streams or heavy background work, separate clients/pools can reduce blast radius.

---

## 42. Mental Model Summary

MongoDB Java Driver mastery is not about memorizing method names. It is about controlling runtime behavior:

```text
Session controls operation context.
Transaction controls atomic multi-operation commit.
Retry controls transient failure response.
Idempotency controls duplicate intent.
Change stream controls database change observation.
Monitoring controls visibility.
Timeout controls resource waiting.
Pool controls concurrency pressure.
```

Jika bagian-bagian ini tidak dirancang eksplisit, aplikasi akan tetap berjalan di development, tetapi rapuh di production.

Aplikasi Java yang matang terhadap MongoDB memiliki ciri:

- transaction dipakai deliberate;
- state transition atomic dan guarded;
- retry tidak menyebabkan duplicate side effect;
- change stream consumer bisa resume;
- repository metric bisa menjawab latency berasal dari mana;
- connection pool tidak menjadi black box;
- read/write concern dipilih berdasarkan invariant;
- failure handling diuji, bukan diasumsikan.

---

## 43. Hubungan Dengan Part Berikutnya

Part 016 menutup pembahasan Java Driver tingkat lanjut.

Part berikutnya akan membahas Spring Data MongoDB:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-017.md
```

Judul:

```text
Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries
```

Di sana kita akan membahas bagaimana Spring Data membantu produktivitas, tetapi juga bisa menyembunyikan query shape, transaction semantics, mapping detail, dan performance cost jika dipakai dengan mindset JPA.

---

## 44. Referensi Resmi Untuk Pendalaman

Gunakan dokumentasi resmi MongoDB Java Sync Driver sebagai anchor utama untuk bagian ini:

- Java Sync Driver — Transactions
- Java Sync Driver — Change Streams
- Java Sync Driver — Monitoring
- Java Sync Driver — Connection Pools
- Java Sync Driver — Client-Side Operation Timeout
- Java Sync Driver — Stable API



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-017.md">Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries ➡️</a>
</div>
