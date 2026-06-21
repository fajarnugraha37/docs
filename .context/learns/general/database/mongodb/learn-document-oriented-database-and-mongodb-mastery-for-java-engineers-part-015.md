# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-015.md

# Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 015 dari 035  
> Fokus: MongoDB Java Sync Driver sebagai runtime boundary antara aplikasi Java dan MongoDB  
> Target pembaca: Java software engineer yang ingin menulis akses MongoDB yang production-grade, eksplisit, observable, dan tidak terjebak gaya JPA/SQL yang salah tempat.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 014, kita sudah membangun fondasi:

- document database bukan “SQL tanpa table”, melainkan model data berbasis **aggregate, locality, ownership, lifecycle, dan access shape**;
- CRUD bukan sekadar operasi teknis, melainkan cara mengekspresikan invariant;
- query harus dipikirkan sebagai **predicate + sort + projection + index path**;
- index adalah bagian dari desain schema dan API;
- aggregation pipeline adalah dataflow, bukan tempat membuang semua kompleksitas reporting;
- transaction di MongoDB ada, tetapi bukan lisensi untuk mendesain model relasional lalu menambal dengan transaksi;
- state machine bisa dieksekusi dengan conditional update, versioning, idempotency, dan transition history.

Part ini mulai masuk ke sisi Java secara konkret.

Tujuan utamanya bukan menghafal API driver, tetapi memahami:

1. bagaimana aplikasi Java seharusnya membuat dan memakai `MongoClient`;
2. bagaimana connection pooling dan timeout memengaruhi failure behavior;
3. bagaimana menulis CRUD yang eksplisit dan aman;
4. bagaimana menggunakan builder API tanpa kehilangan kontrol terhadap query shape;
5. bagaimana memilih antara `Document`, POJO, dan mapping custom;
6. bagaimana codec bekerja;
7. bagaimana membangun repository layer yang membantu, bukan menyembunyikan realitas MongoDB.

---

## 1. Mental Model: Java Driver Bukan ORM

Hal pertama yang harus jelas: **MongoDB Java Driver bukan JPA**.

JPA/Hibernate punya model mental seperti ini:

```text
Java Entity <-> Persistence Context <-> Dirty Checking <-> SQL Generation <-> Database
```

MongoDB Java Driver lebih dekat ke:

```text
Explicit Command <-> BSON Serialization <-> Wire Protocol <-> MongoDB Server
```

Artinya:

- tidak ada persistence context seperti Hibernate;
- tidak ada automatic dirty checking;
- tidak ada lazy loading association sebagai default;
- tidak ada automatic join;
- tidak ada implicit unit-of-work kecuali kamu memakai session/transaction secara eksplisit;
- operasi yang kamu tulis biasanya langsung merepresentasikan command ke server.

Ini bagus untuk sistem yang membutuhkan kontrol tinggi.

Tapi konsekuensinya:

- kamu harus sengaja mendesain query;
- kamu harus sengaja mendesain update;
- kamu harus sengaja mendesain projection;
- kamu harus sengaja mendesain retry/idempotency;
- kamu harus sengaja mendesain mapping;
- kamu harus sengaja mengamati latency, timeout, pool saturation, dan error code.

Top 1% engineer tidak memakai driver sebagai “database helper”. Mereka memperlakukan driver sebagai **runtime contract** antara aplikasi dan storage engine.

---

## 2. Dependency dan Driver Variant

MongoDB Java ecosystem biasanya punya beberapa pilihan:

1. **MongoDB Java Sync Driver**
   - blocking API;
   - cocok untuk aplikasi Spring MVC / servlet / worker tradisional;
   - paling mudah dipahami dan dipakai dengan thread-per-request model.

2. **MongoDB Reactive Streams Driver**
   - non-blocking/reactive;
   - cocok untuk stack reactive seperti Project Reactor/Spring WebFlux;
   - butuh pemahaman backpressure, scheduler, dan reactive error handling.

3. **Spring Data MongoDB**
   - abstraction di atas driver;
   - nyaman untuk repository dan template;
   - tetap perlu memahami driver dan MongoDB behavior di bawahnya.

Part ini fokus pada **Java Sync Driver** karena ia fondasi paling eksplisit.

Contoh dependency Maven umum:

```xml
<dependency>
  <groupId>org.mongodb</groupId>
  <artifactId>mongodb-driver-sync</artifactId>
  <version>${mongodb.driver.version}</version>
</dependency>
```

Dalam proyek production, version driver sebaiknya:

- dikelola lewat dependency management/BOM bila tersedia;
- diuji kompatibilitasnya dengan versi MongoDB server/Atlas yang dipakai;
- tidak di-upgrade diam-diam tanpa regression test untuk connection, codec, transaction, dan error handling.

---

## 3. Objek Penting Dalam Java Sync Driver

Secara konseptual, kamu akan sering melihat object berikut:

```text
MongoClient
  -> MongoDatabase
      -> MongoCollection<T>
          -> operations: find, insertOne, updateOne, aggregate, bulkWrite, deleteOne, ...
```

### 3.1 `MongoClient`

`MongoClient` adalah entry point utama.

Mental model:

```text
MongoClient = cluster-aware client + connection pool manager + command executor
```

Ia bukan object ringan yang dibuat per request.

Rule penting:

```text
Buat MongoClient sekali untuk aplikasi, reuse sepanjang lifecycle aplikasi, close saat shutdown.
```

Salah:

```java
public CaseRepository() {
    this.client = MongoClients.create(connectionString); // jangan dibuat per repository instance sembarangan
}
```

Lebih buruk:

```java
public Case findById(String id) {
    try (MongoClient client = MongoClients.create(connectionString)) {
        return client.getDatabase("app")
            .getCollection("cases", Case.class)
            .find(eq("_id", id))
            .first();
    }
}
```

Masalahnya:

- setiap request membuat pool baru;
- server selection diulang;
- TLS/auth handshake berulang;
- latency naik;
- koneksi bocor lebih mudah;
- database bisa terkena connection storm.

Benar:

```java
public final class MongoProvider implements AutoCloseable {
    private final MongoClient client;
    private final MongoDatabase database;

    public MongoProvider(String connectionString, String databaseName) {
        this.client = MongoClients.create(connectionString);
        this.database = client.getDatabase(databaseName);
    }

    public MongoDatabase database() {
        return database;
    }

    @Override
    public void close() {
        client.close();
    }
}
```

Dalam Spring Boot, biasanya `MongoClient` dibuat sebagai singleton bean.

---

### 3.2 `MongoDatabase`

`MongoDatabase` merepresentasikan handle ke database.

Penting: handle ini ringan. Ia bukan koneksi fisik.

Kamu bisa melakukan:

```java
MongoDatabase db = client.getDatabase("regulatory_case_management");
```

Kamu juga bisa mengatur default concern pada database handle:

```java
MongoDatabase db = client
    .getDatabase("regulatory_case_management")
    .withReadConcern(ReadConcern.MAJORITY)
    .withWriteConcern(WriteConcern.MAJORITY)
    .withReadPreference(ReadPreference.primary());
```

Catatan desain:

- jangan menyetel concern sembarangan global tanpa memahami konsekuensi latency dan consistency;
- read/write concern sering lebih tepat ditentukan per operation/use case;
- tetapi default yang aman bisa membantu menghindari bug konsistensi.

---

### 3.3 `MongoCollection<T>`

Collection handle punya generic type.

Contoh berbasis `Document`:

```java
MongoCollection<Document> cases = db.getCollection("cases");
```

Contoh berbasis POJO:

```java
MongoCollection<CaseDocument> cases = db.getCollection("cases", CaseDocument.class);
```

Mental model:

```text
MongoCollection<T> = typed view of a collection + codec selection + operation entry point
```

`T` menentukan bagaimana BSON dikonversi ke/dari Java object.

---

## 4. Connection String: Kontrak Deployment

Connection string bukan sekadar URL.

Ia membawa informasi:

- host/server list;
- authentication database;
- credential;
- replica set name;
- TLS setting;
- read preference;
- write concern;
- retryable write;
- app name;
- timeout options;
- SRV discovery untuk Atlas;
- compression;
- load balancer option.

Contoh lokal:

```text
mongodb://localhost:27017
```

Contoh replica set:

```text
mongodb://mongo1:27017,mongo2:27017,mongo3:27017/app?replicaSet=rs0
```

Contoh SRV/Atlas style:

```text
mongodb+srv://user:password@cluster.example.mongodb.net/app?retryWrites=true&w=majority
```

Best practice:

1. Jangan hardcode credential.
2. Gunakan secret manager/environment variable.
3. Set `appName` agar observability di server lebih mudah.
4. Jangan menyembunyikan timeout default tanpa review.
5. Pisahkan connection string per environment.
6. Dokumentasikan pilihan read/write concern.
7. Jangan memakai user database superuser dari aplikasi.

Contoh dengan `ConnectionString` dan settings:

```java
ConnectionString connectionString = new ConnectionString(System.getenv("MONGODB_URI"));

MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(connectionString)
    .applicationName("case-management-service")
    .build();

MongoClient client = MongoClients.create(settings);
```

---

## 5. Connection Pool Mental Model

Aplikasi Java tidak membuka koneksi baru untuk setiap operasi.

Driver mengelola connection pool.

Mental model:

```text
Application threads
    -> borrow connection from pool
        -> send command
        -> receive response
    -> return connection to pool
```

Jika pool habis:

```text
thread menunggu connection tersedia
```

Jika terlalu lama menunggu:

```text
timeout / failure
```

### 5.1 Kenapa Pool Penting?

Misal:

- service menerima 500 concurrent HTTP requests;
- tiap request melakukan 3 query MongoDB;
- query p95 = 80 ms;
- pool max size = 20;
- thread pool HTTP = 300.

Jika query lambat atau pool terlalu kecil:

```text
HTTP threads blocked waiting for MongoDB connection
-> request latency naik
-> client retry
-> traffic naik
-> pool makin penuh
-> cascading failure
```

Pool bukan hanya konfigurasi teknis. Ia bagian dari **backpressure architecture**.

---

### 5.2 Pool Setting yang Sering Dipakai

Contoh:

```java
MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(new ConnectionString(uri))
    .applyToConnectionPoolSettings(builder -> builder
        .maxSize(100)
        .minSize(5)
        .maxWaitTime(2, TimeUnit.SECONDS)
        .maxConnectionIdleTime(60, TimeUnit.SECONDS)
    )
    .build();
```

Parameter penting:

| Setting | Makna | Risiko jika salah |
|---|---|---|
| `maxSize` | jumlah maksimum koneksi per server dalam pool | terlalu kecil: queue; terlalu besar: DB overload |
| `minSize` | koneksi minimum yang dipertahankan | terlalu tinggi: resource idle; terlalu rendah: cold latency |
| `maxWaitTime` | waktu maksimum menunggu connection dari pool | terlalu tinggi: request menggantung; terlalu rendah: false failure |
| `maxConnectionIdleTime` | koneksi idle bisa ditutup | terlalu agresif: churn; terlalu longgar: resource idle |

Rule praktis:

```text
Pool size harus selaras dengan concurrency aplikasi, latency query, kapasitas MongoDB, dan timeout request.
```

Jangan hanya menaikkan pool size untuk “memperbaiki” latency. Bisa jadi query/index yang salah.

---

## 6. Timeout: Failure Boundary yang Harus Eksplisit

Timeout adalah bagian dari correctness.

Tanpa timeout yang benar, sistem bisa gagal dengan cara lambat dan berantai.

### 6.1 Jenis Timeout Penting

| Timeout | Makna |
|---|---|
| Server selection timeout | waktu mencari server yang cocok untuk operasi |
| Connect timeout | waktu membuka koneksi TCP |
| Socket read timeout | waktu menunggu response socket |
| Max wait time | waktu menunggu connection dari pool |
| Application request timeout | deadline HTTP/job di level aplikasi |

Contoh konfigurasi:

```java
MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(new ConnectionString(uri))
    .applyToClusterSettings(builder -> builder
        .serverSelectionTimeout(3, TimeUnit.SECONDS)
    )
    .applyToSocketSettings(builder -> builder
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
    )
    .applyToConnectionPoolSettings(builder -> builder
        .maxWaitTime(1, TimeUnit.SECONDS)
    )
    .build();
```

### 6.2 Timeout Budget

Jangan konfigurasi seperti ini:

```text
HTTP timeout     = 2 seconds
Mongo readTimeout = 30 seconds
Pool maxWaitTime  = 10 seconds
```

Itu tidak masuk akal.

Karena request HTTP sudah dianggap gagal jauh sebelum MongoDB operation berhenti.

Lebih baik pikirkan budget:

```text
Total request budget: 2 seconds
  - auth/context: 100 ms
  - business logic: 200 ms
  - MongoDB total: 1.2 sec
  - serialization/network: 200 ms
  - safety buffer: 300 ms
```

Lalu MongoDB operation harus punya deadline yang kompatibel.

---

## 7. Read Concern, Write Concern, Read Preference di Driver

Tiga konsep ini sering dianggap konfigurasi, padahal sebenarnya bagian dari **consistency contract**.

### 7.1 Write Concern

Write concern menentukan level acknowledgment.

Contoh:

```java
MongoCollection<CaseDocument> collection = db
    .getCollection("cases", CaseDocument.class)
    .withWriteConcern(WriteConcern.MAJORITY);
```

Makna praktis:

```text
Write dianggap sukses setelah memenuhi acknowledgment majority.
```

Trade-off:

- lebih kuat terhadap failover;
- latency bisa lebih tinggi dibanding acknowledgment minimal.

### 7.2 Read Concern

Read concern menentukan visibility/consistency level read.

Contoh:

```java
MongoCollection<CaseDocument> collection = db
    .getCollection("cases", CaseDocument.class)
    .withReadConcern(ReadConcern.MAJORITY);
```

### 7.3 Read Preference

Read preference menentukan server mana yang boleh dipakai untuk read.

Contoh:

```java
MongoCollection<CaseDocument> collection = db
    .getCollection("cases", CaseDocument.class)
    .withReadPreference(ReadPreference.primary());
```

Rule awal untuk sistem regulasi/case management:

```text
Default read preference sebaiknya primary untuk operasi yang consistency-sensitive.
```

Secondary read bisa berguna untuk:

- dashboard non-kritis;
- reporting ringan;
- background scan;
- read-only workloads yang tahan stale data.

Tapi jangan pakai secondary read hanya karena “ingin scaling read” tanpa memahami replication lag.

---

## 8. `Document` vs POJO vs Domain Object

Ada tiga representasi yang sering tercampur:

```text
Domain object       = model perilaku bisnis
Persistence document = struktur yang disimpan di MongoDB
API DTO             = kontrak eksternal
```

Mereka tidak harus sama.

### 8.1 Menggunakan `Document`

`org.bson.Document` fleksibel dan eksplisit.

Contoh:

```java
Document caseDoc = new Document("_id", "CASE-2026-0001")
    .append("tenantId", "TENANT-A")
    .append("status", "OPEN")
    .append("createdAt", Instant.now())
    .append("subject", new Document("type", "PERSON").append("name", "Alice"));

collection.insertOne(caseDoc);
```

Kelebihan:

- cepat untuk eksplorasi;
- cocok untuk dynamic schema;
- mudah membangun aggregation result;
- tidak perlu mapping class.

Kekurangan:

- raw string field name everywhere;
- refactoring lemah;
- type-safety rendah;
- typo field mudah lolos;
- domain invariant sulit diekspresikan.

Gunakan `Document` untuk:

- admin/internal tooling;
- aggregation output dinamis;
- migration script;
- prototyping;
- area dengan shape sangat fleksibel.

Jangan menjadikan `Document` sebagai default untuk seluruh production domain model tanpa governance.

---

### 8.2 Menggunakan POJO Persistence Model

Contoh:

```java
public final class CaseDocument {
    private String id;
    private String tenantId;
    private String status;
    private Instant createdAt;
    private SubjectDocument subject;
    private long version;

    public CaseDocument() {
        // required by many codec/mapping strategies
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public SubjectDocument getSubject() { return subject; }
    public void setSubject(SubjectDocument subject) { this.subject = subject; }

    public long getVersion() { return version; }
    public void setVersion(long version) { this.version = version; }
}
```

Kelebihan:

- type-safe;
- refactoring lebih aman;
- cocok untuk repository;
- kontrak internal lebih jelas;
- lebih mudah diuji.

Kekurangan:

- perlu codec/mapping setup;
- class bisa menjadi mirror database tanpa perilaku;
- schema evolution butuh disiplin;
- dynamic fields lebih sulit.

---

### 8.3 Domain Object Tidak Harus Sama Dengan Persistence Object

Contoh domain object:

```java
public final class CaseAggregate {
    private final CaseId id;
    private final TenantId tenantId;
    private final CaseStatus status;
    private final long version;

    public CaseAggregate(CaseId id, TenantId tenantId, CaseStatus status, long version) {
        this.id = Objects.requireNonNull(id);
        this.tenantId = Objects.requireNonNull(tenantId);
        this.status = Objects.requireNonNull(status);
        this.version = version;
    }

    public CaseAggregate assignReviewer(UserId reviewerId) {
        if (status != CaseStatus.OPEN) {
            throw new IllegalStateException("Only OPEN case can be assigned");
        }
        // return new aggregate or produce command result
        return this;
    }
}
```

Persistence document:

```java
public final class CaseDocument {
    private String _id;
    private String tenantId;
    private String status;
    private String assignedReviewerId;
    private List<TransitionDocument> transitions;
    private long version;
}
```

Mapping:

```text
CaseDocument <-> CaseAggregate
```

Kenapa dipisah?

Karena persistence model sering punya hal-hal teknis:

- `_id`;
- schema version;
- denormalized fields;
- index helper fields;
- search projection fields;
- audit fragments;
- raw status string;
- timestamps;
- migration compatibility fields.

Domain model seharusnya lebih fokus pada invariant dan behavior.

---

## 9. Codec Registry: Cara Driver Mengubah Java Object Menjadi BSON

Driver perlu tahu bagaimana mengubah object Java menjadi BSON dan sebaliknya.

Itulah fungsi codec.

Mental model:

```text
Java Object -> Codec.encode() -> BSON
BSON -> Codec.decode() -> Java Object
```

Default driver tahu tipe-tipe umum:

- `String`
- `Integer`
- `Long`
- `Double`
- `Boolean`
- `Date`
- `ObjectId`
- `Document`
- `List`
- `Map`
- beberapa BSON-specific types

Untuk POJO, kita butuh POJO codec provider.

Contoh setup:

```java
CodecRegistry pojoCodecRegistry = fromRegistries(
    MongoClientSettings.getDefaultCodecRegistry(),
    fromProviders(PojoCodecProvider.builder().automatic(true).build())
);

MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(new ConnectionString(uri))
    .codecRegistry(pojoCodecRegistry)
    .build();

MongoClient client = MongoClients.create(settings);
```

Import yang biasanya dibutuhkan:

```java
import static org.bson.codecs.configuration.CodecRegistries.fromProviders;
import static org.bson.codecs.configuration.CodecRegistries.fromRegistries;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import org.bson.codecs.configuration.CodecRegistry;
import org.bson.codecs.pojo.PojoCodecProvider;
```

---

## 10. POJO Mapping: Field, Constructor, dan Annotation

POJO codec bisa otomatis, tapi otomatis bukan berarti tanpa konsekuensi.

### 10.1 `_id` Mapping

MongoDB memakai `_id` sebagai primary identifier document.

Dalam POJO, kamu bisa memakai field `id` dan annotation:

```java
import org.bson.codecs.pojo.annotations.BsonId;
import org.bson.codecs.pojo.annotations.BsonProperty;

public final class CaseDocument {
    @BsonId
    private String id;

    @BsonProperty("tenantId")
    private String tenantId;

    @BsonProperty("status")
    private String status;

    // getters/setters
}
```

Catatan:

- `@BsonId` memetakan field ke `_id`;
- `@BsonProperty` mengontrol nama field BSON;
- explicit annotation membantu mencegah refactoring Java merusak field database.

### 10.2 No-Arg Constructor

Banyak strategi mapping membutuhkan no-arg constructor.

```java
public CaseDocument() {
}
```

Jika kamu ingin immutable object, perlu strategi lebih hati-hati.

### 10.3 Immutable POJO

Immutable object lebih aman untuk domain logic, tetapi mapping bisa lebih rumit.

Alternatif:

1. gunakan mutable persistence document, lalu convert ke immutable domain object;
2. gunakan codec custom;
3. gunakan annotation/constructor mapping jika sesuai;
4. gunakan record dengan library/framework yang mendukungnya secara jelas.

Untuk sistem besar, opsi paling mudah dirawat sering kali:

```text
Mutable Persistence POJO -> Immutable Domain Model
```

Bukan karena mutable bagus, tetapi karena persistence boundary sebaiknya eksplisit.

---

## 11. Field Name Constants: Mengurangi Stringly-Typed Bug

MongoDB query memakai field name string.

Contoh raw:

```java
collection.find(eq("tenantId", tenantId));
```

Masalah:

```java
collection.find(eq("tenatId", tenantId)); // typo, compile tetap sukses
```

Solusi sederhana:

```java
public final class CaseFields {
    private CaseFields() {}

    public static final String ID = "_id";
    public static final String TENANT_ID = "tenantId";
    public static final String STATUS = "status";
    public static final String VERSION = "version";
    public static final String CREATED_AT = "createdAt";
    public static final String SUBJECT_NAME = "subject.name";
}
```

Lalu:

```java
collection.find(and(
    eq(CaseFields.TENANT_ID, tenantId),
    eq(CaseFields.STATUS, "OPEN")
));
```

Ini bukan solusi sempurna, tapi mengurangi typo dan membuat index/query review lebih mudah.

---

## 12. CRUD Dengan Builder API

Driver menyediakan builder seperti:

- `Filters`
- `Updates`
- `Projections`
- `Sorts`
- `Indexes`
- `Aggregates`
- `Accumulators`

Tujuannya:

- mengurangi raw BSON manual;
- membuat command lebih terstruktur;
- tetap dekat dengan MongoDB semantics.

Import umum:

```java
import static com.mongodb.client.model.Filters.*;
import static com.mongodb.client.model.Updates.*;
import static com.mongodb.client.model.Projections.*;
import static com.mongodb.client.model.Sorts.*;
```

---

## 13. Insert

### 13.1 Insert One

```java
CaseDocument doc = new CaseDocument();
doc.setId("CASE-2026-0001");
doc.setTenantId("TENANT-A");
doc.setStatus("OPEN");
doc.setCreatedAt(Instant.now());
doc.setVersion(1L);

InsertOneResult result = cases.insertOne(doc);
```

Jika `_id` duplicate, MongoDB akan mengembalikan duplicate key error.

Dalam domain, duplicate key sering berarti:

- idempotent create command sudah pernah diproses;
- bug ID generation;
- race condition;
- retry tanpa idempotency.

Jangan selalu treat duplicate key sebagai “500 internal server error”.

Untuk command idempotent, duplicate key bisa diterjemahkan menjadi:

```text
create request already applied
```

tergantung desain.

---

### 13.2 Insert Many

```java
List<CaseDocument> docs = List.of(case1, case2, case3);
InsertManyResult result = cases.insertMany(docs);
```

Secara default ordered behavior bisa menghentikan batch saat error.

Untuk bulk ingestion, kamu mungkin ingin unordered:

```java
InsertManyOptions options = new InsertManyOptions().ordered(false);
cases.insertMany(docs, options);
```

Trade-off:

| Mode | Behavior | Cocok untuk |
|---|---|---|
| Ordered | berhenti saat error pertama | batch yang urutannya penting |
| Unordered | lanjut sebanyak mungkin | ingestion, backfill, migration |

---

## 14. Find

### 14.1 Find by ID

```java
CaseDocument found = cases
    .find(eq("_id", caseId))
    .first();
```

Dengan tenant guard:

```java
CaseDocument found = cases
    .find(and(
        eq("_id", caseId),
        eq("tenantId", tenantId)
    ))
    .first();
```

Untuk multi-tenant system, tenant filter bukan optional.

Rule:

```text
Semua query business data harus punya tenant boundary kecuali terbukti global/admin.
```

---

### 14.2 Projection

Jangan selalu mengambil seluruh document.

```java
Bson projection = fields(
    include("_id", "tenantId", "status", "createdAt", "subject.name"),
    excludeId() // hanya jika memang tidak butuh _id
);

List<CaseSummaryDocument> summaries = cases
    .find(eq("tenantId", tenantId))
    .projection(projection)
    .sort(descending("createdAt"))
    .limit(50)
    .into(new ArrayList<>());
```

Catatan:

- jika memakai POJO `CaseDocument`, projection sebagian bisa menghasilkan object dengan field null/missing;
- untuk summary query, lebih baik pakai class khusus seperti `CaseSummaryDocument` atau `Document`;
- projection adalah bagian dari API/query design.

---

### 14.3 Sort dan Limit

```java
List<CaseDocument> openCases = cases
    .find(and(
        eq("tenantId", tenantId),
        eq("status", "OPEN")
    ))
    .sort(descending("createdAt"))
    .limit(100)
    .into(new ArrayList<>());
```

Pastikan ada index yang mendukung:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Jika tidak, query bisa scan/sort mahal.

---

### 14.4 Iteration dan Cursor

```java
try (MongoCursor<CaseDocument> cursor = cases
    .find(eq("tenantId", tenantId))
    .batchSize(500)
    .iterator()) {

    while (cursor.hasNext()) {
        CaseDocument doc = cursor.next();
        process(doc);
    }
}
```

Gunakan cursor untuk scan besar.

Jangan:

```java
List<CaseDocument> all = cases.find(eq("tenantId", tenantId)).into(new ArrayList<>());
```

jika hasil bisa jutaan document.

---

## 15. Update

Update adalah area paling penting untuk correctness.

Di MongoDB, update bisa menjadi:

1. partial update dengan operator;
2. full replacement;
3. pipeline update;
4. upsert.

### 15.1 Partial Update

```java
UpdateResult result = cases.updateOne(
    and(eq("_id", caseId), eq("tenantId", tenantId)),
    combine(
        set("title", newTitle),
        currentDate("updatedAt"),
        inc("version", 1)
    )
);
```

Cek result:

```java
if (result.getMatchedCount() == 0) {
    throw new CaseNotFoundException(caseId);
}
```

`matchedCount` dan `modifiedCount` tidak sama.

- `matchedCount = 1`, `modifiedCount = 0` bisa berarti value yang diset sama dengan sebelumnya;
- bukan selalu error.

---

### 15.2 Conditional Update Untuk Concurrency

```java
UpdateResult result = cases.updateOne(
    and(
        eq("_id", caseId),
        eq("tenantId", tenantId),
        eq("version", expectedVersion),
        eq("status", "OPEN")
    ),
    combine(
        set("status", "UNDER_REVIEW"),
        set("assignedReviewerId", reviewerId),
        currentDate("updatedAt"),
        inc("version", 1),
        push("transitions", new TransitionDocument("ASSIGN_REVIEWER", actorId, Instant.now()))
    )
);

if (result.getMatchedCount() == 0) {
    throw new ConcurrentModificationOrInvalidStateException(caseId);
}
```

Ini adalah pattern penting:

```text
filter = identity + tenant + expected state/version
update = state mutation + audit fragment + version increment
```

Dengan ini, MongoDB mengeksekusi guard dan mutation secara atomic pada satu document.

---

### 15.3 Replacement

```java
ReplaceOptions options = new ReplaceOptions().upsert(false);

UpdateResult result = cases.replaceOne(
    and(eq("_id", doc.getId()), eq("tenantId", doc.getTenantId())),
    doc,
    options
);
```

Replacement berbahaya jika kamu tidak membawa semua field.

Contoh bug:

```text
read summary projection -> map to CaseDocument partial -> replaceOne -> field lain hilang
```

Rule:

```text
Gunakan replacement hanya jika kamu yakin object merepresentasikan seluruh document persistable.
```

Untuk command update spesifik, partial update lebih aman.

---

### 15.4 Upsert

```java
UpdateOptions options = new UpdateOptions().upsert(true);

UpdateResult result = cases.updateOne(
    and(eq("_id", caseId), eq("tenantId", tenantId)),
    combine(
        setOnInsert("_id", caseId),
        setOnInsert("tenantId", tenantId),
        setOnInsert("createdAt", Instant.now()),
        set("status", "OPEN"),
        currentDate("updatedAt")
    ),
    options
);
```

Upsert powerful tapi berbahaya.

Pertanyaan sebelum upsert:

1. Apakah create dan update memang semantik yang sama?
2. Apakah filter punya semua field identity yang benar?
3. Apakah ada unique index yang melindungi duplicate?
4. Apakah `setOnInsert` lengkap?
5. Apakah retry aman?

Blind upsert adalah sumber bug besar.

---

## 16. Delete

### 16.1 Delete One

```java
DeleteResult result = cases.deleteOne(and(
    eq("_id", caseId),
    eq("tenantId", tenantId)
));

if (result.getDeletedCount() == 0) {
    throw new CaseNotFoundException(caseId);
}
```

Dalam sistem regulasi, delete fisik sering tidak boleh sembarangan.

Lebih umum:

- soft delete;
- archive;
- retention-based delete;
- legal hold;
- redaction;
- anonymization.

### 16.2 Soft Delete

```java
cases.updateOne(
    and(eq("_id", caseId), eq("tenantId", tenantId), ne("deleted", true)),
    combine(
        set("deleted", true),
        set("deletedAt", Instant.now()),
        set("deletedBy", actorId),
        inc("version", 1)
    )
);
```

Setelah soft delete, semua read query harus punya predicate:

```text
deleted != true
```

Atau gunakan status lifecycle yang lebih eksplisit.

---

## 17. Bulk Writes

Bulk write berguna untuk:

- migration;
- backfill;
- import;
- batch command;
- update banyak document dengan bentuk berbeda.

Contoh:

```java
List<WriteModel<CaseDocument>> writes = new ArrayList<>();

writes.add(new UpdateOneModel<>(
    and(eq("_id", "CASE-1"), eq("tenantId", "TENANT-A")),
    set("priority", "HIGH")
));

writes.add(new UpdateOneModel<>(
    and(eq("_id", "CASE-2"), eq("tenantId", "TENANT-A")),
    set("priority", "LOW")
));

BulkWriteOptions options = new BulkWriteOptions().ordered(false);
BulkWriteResult result = cases.bulkWrite(writes, options);
```

### 17.1 Ordered vs Unordered

| Mode | Makna | Failure behavior |
|---|---|---|
| ordered true | operasi dieksekusi berurutan | berhenti di error pertama |
| ordered false | driver/server bisa mengoptimalkan urutan | lanjut meski sebagian error |

Untuk backfill, unordered sering lebih cocok.

Untuk command bisnis yang urutannya bermakna, ordered mungkin dibutuhkan.

### 17.2 Bulk Write dan Error Handling

Bulk write bisa partial success.

Jangan hanya:

```java
try {
    collection.bulkWrite(writes);
} catch (Exception e) {
    throw new RuntimeException(e);
}
```

Kamu perlu memahami:

- operasi mana yang sukses;
- operasi mana yang gagal;
- error duplicate key;
- retry aman atau tidak;
- apakah batch idempotent.

---

## 18. Repository Layer: Membantu Tanpa Menyembunyikan MongoDB

Repository layer yang baik:

- menyembunyikan detail driver boilerplate;
- mengekspresikan operation bisnis;
- menjaga tenant guard;
- menjaga index-aware query shape;
- menjaga concurrency guard;
- tidak membuat MongoDB terasa seperti JPA generic repository.

Repository buruk:

```java
public interface GenericRepository<T, ID> {
    T save(T entity);
    Optional<T> findById(ID id);
    List<T> findAll();
    void deleteById(ID id);
}
```

Kenapa buruk untuk MongoDB serius?

Karena menyembunyikan:

- tenant boundary;
- projection;
- index shape;
- consistency need;
- update semantics;
- concurrency guard;
- lifecycle state.

Repository lebih baik:

```java
public final class CaseRepository {
    private final MongoCollection<CaseDocument> cases;

    public CaseRepository(MongoDatabase db) {
        this.cases = db.getCollection("cases", CaseDocument.class);
    }

    public Optional<CaseDocument> findOpenCaseForUpdate(
        String tenantId,
        String caseId
    ) {
        CaseDocument doc = cases.find(and(
                eq("_id", caseId),
                eq("tenantId", tenantId),
                eq("status", "OPEN"),
                ne("deleted", true)
            ))
            .first();

        return Optional.ofNullable(doc);
    }

    public boolean assignReviewer(
        String tenantId,
        String caseId,
        long expectedVersion,
        String reviewerId,
        String actorId,
        Instant now
    ) {
        UpdateResult result = cases.updateOne(
            and(
                eq("_id", caseId),
                eq("tenantId", tenantId),
                eq("version", expectedVersion),
                eq("status", "OPEN")
            ),
            combine(
                set("status", "UNDER_REVIEW"),
                set("assignedReviewerId", reviewerId),
                set("updatedAt", now),
                inc("version", 1),
                push("transitions", new Document("type", "ASSIGN_REVIEWER")
                    .append("actorId", actorId)
                    .append("at", now))
            )
        );

        return result.getMatchedCount() == 1;
    }
}
```

Operation names should represent business intent.

Compare:

```java
save(case)
```

vs:

```java
assignReviewer(tenantId, caseId, expectedVersion, reviewerId, actorId, now)
```

The second one encodes invariant.

---

## 19. Error Handling: Jangan Semua Jadi RuntimeException

MongoDB driver exception membawa informasi penting.

Kategori error yang harus dibedakan:

1. duplicate key;
2. validation error;
3. timeout;
4. server selection failure;
5. network error;
6. write concern error;
7. transient transaction error;
8. unauthorized;
9. command error;
10. codec/mapping error.

Contoh duplicate key:

```java
try {
    cases.insertOne(doc);
} catch (MongoWriteException e) {
    if (e.getError().getCategory() == ErrorCategory.DUPLICATE_KEY) {
        throw new DuplicateCaseException(doc.getId(), e);
    }
    throw e;
}
```

Untuk API layer, mapping bisa seperti:

| Database condition | Domain/API response |
|---|---|
| Duplicate key on create | 409 Conflict atau idempotent success |
| Matched count 0 on versioned update | 409 Conflict / stale version |
| Matched count 0 on identity lookup | 404 Not Found |
| Timeout | 503/504 tergantung boundary |
| Unauthorized DB | deployment/config incident |
| Codec error | programming/config bug |

---

## 20. Retry: Hanya Aman Kalau Operasi Idempotent

Driver dan MongoDB mendukung retryable writes untuk operasi tertentu, tetapi aplikasi tetap harus memahami idempotency.

Contoh operasi aman:

```java
updateOne(
    eq("_id", id),
    set("status", "OPEN")
)
```

Lebih idempotent.

Contoh operasi berbahaya:

```java
updateOne(
    eq("_id", id),
    inc("balance", 100)
)
```

Jika retry terjadi setelah server sukses tapi client tidak menerima response, increment bisa menjadi masalah jika operasi tidak dilindungi idempotency/transaction semantics yang benar.

Untuk command bisnis:

```text
Gunakan commandId/idempotencyKey.
```

Contoh:

```java
UpdateResult result = cases.updateOne(
    and(
        eq("_id", caseId),
        eq("tenantId", tenantId),
        ne("processedCommandIds", commandId)
    ),
    combine(
        set("status", "UNDER_REVIEW"),
        addToSet("processedCommandIds", commandId),
        inc("version", 1)
    )
);
```

Tapi hati-hati: `processedCommandIds` bisa tumbuh tanpa batas. Untuk production, sering perlu collection idempotency terpisah atau retention strategy.

---

## 21. Example: Production-Oriented Mongo Module

Berikut contoh struktur minimal tanpa Spring.

```text
src/main/java/com/example/caseapp/mongo/
  MongoModule.java
  MongoConfig.java
  MongoHealthCheck.java
  MongoExceptionMapper.java

src/main/java/com/example/caseapp/case/domain/
  CaseAggregate.java
  CaseId.java
  TenantId.java
  CaseStatus.java

src/main/java/com/example/caseapp/case/persistence/
  CaseDocument.java
  CaseFields.java
  CaseRepository.java
  CaseMapper.java
```

### 21.1 Config

```java
public record MongoConfig(
    String uri,
    String databaseName,
    int maxPoolSize,
    int minPoolSize,
    int maxWaitMillis,
    int serverSelectionTimeoutMillis,
    int connectTimeoutMillis,
    int readTimeoutMillis
) {}
```

### 21.2 Module

```java
public final class MongoModule implements AutoCloseable {
    private final MongoClient client;
    private final MongoDatabase database;

    public MongoModule(MongoConfig config) {
        CodecRegistry codecRegistry = fromRegistries(
            MongoClientSettings.getDefaultCodecRegistry(),
            fromProviders(PojoCodecProvider.builder().automatic(true).build())
        );

        MongoClientSettings settings = MongoClientSettings.builder()
            .applyConnectionString(new ConnectionString(config.uri()))
            .applicationName("case-management-service")
            .codecRegistry(codecRegistry)
            .applyToConnectionPoolSettings(builder -> builder
                .maxSize(config.maxPoolSize())
                .minSize(config.minPoolSize())
                .maxWaitTime(config.maxWaitMillis(), TimeUnit.MILLISECONDS)
            )
            .applyToClusterSettings(builder -> builder
                .serverSelectionTimeout(config.serverSelectionTimeoutMillis(), TimeUnit.MILLISECONDS)
            )
            .applyToSocketSettings(builder -> builder
                .connectTimeout(config.connectTimeoutMillis(), TimeUnit.MILLISECONDS)
                .readTimeout(config.readTimeoutMillis(), TimeUnit.MILLISECONDS)
            )
            .build();

        this.client = MongoClients.create(settings);
        this.database = client.getDatabase(config.databaseName());
    }

    public MongoDatabase database() {
        return database;
    }

    @Override
    public void close() {
        client.close();
    }
}
```

---

## 22. Example Repository With Explicit Query Shape

```java
public final class CaseRepository {
    private final MongoCollection<CaseDocument> cases;

    public CaseRepository(MongoDatabase database) {
        this.cases = database
            .getCollection("cases", CaseDocument.class)
            .withReadPreference(ReadPreference.primary())
            .withWriteConcern(WriteConcern.MAJORITY);
    }

    public void insert(CaseDocument doc) {
        try {
            cases.insertOne(doc);
        } catch (MongoWriteException e) {
            if (e.getError().getCategory() == ErrorCategory.DUPLICATE_KEY) {
                throw new DuplicateCaseException(doc.getId(), e);
            }
            throw e;
        }
    }

    public Optional<CaseDocument> findById(String tenantId, String caseId) {
        CaseDocument doc = cases.find(and(
                eq(CaseFields.ID, caseId),
                eq(CaseFields.TENANT_ID, tenantId),
                ne(CaseFields.DELETED, true)
            ))
            .first();

        return Optional.ofNullable(doc);
    }

    public List<CaseSummaryDocument> findOpenCases(
        String tenantId,
        Instant before,
        int limit
    ) {
        int safeLimit = Math.min(Math.max(limit, 1), 100);

        return cases
            .withDocumentClass(CaseSummaryDocument.class)
            .find(and(
                eq(CaseFields.TENANT_ID, tenantId),
                eq(CaseFields.STATUS, "OPEN"),
                lt(CaseFields.CREATED_AT, before),
                ne(CaseFields.DELETED, true)
            ))
            .projection(fields(
                include(
                    CaseFields.ID,
                    CaseFields.TENANT_ID,
                    CaseFields.STATUS,
                    CaseFields.CREATED_AT,
                    CaseFields.SUBJECT_NAME
                )
            ))
            .sort(descending(CaseFields.CREATED_AT))
            .limit(safeLimit)
            .into(new ArrayList<>());
    }

    public boolean transitionToUnderReview(
        String tenantId,
        String caseId,
        long expectedVersion,
        String reviewerId,
        String actorId,
        Instant now
    ) {
        UpdateResult result = cases.updateOne(
            and(
                eq(CaseFields.ID, caseId),
                eq(CaseFields.TENANT_ID, tenantId),
                eq(CaseFields.VERSION, expectedVersion),
                eq(CaseFields.STATUS, "OPEN"),
                ne(CaseFields.DELETED, true)
            ),
            combine(
                set(CaseFields.STATUS, "UNDER_REVIEW"),
                set(CaseFields.ASSIGNED_REVIEWER_ID, reviewerId),
                set(CaseFields.UPDATED_AT, now),
                inc(CaseFields.VERSION, 1),
                push(CaseFields.TRANSITIONS, new Document("type", "ASSIGN_REVIEWER")
                    .append("actorId", actorId)
                    .append("at", now))
            )
        );

        return result.getMatchedCount() == 1;
    }
}
```

Catatan penting:

- repository method tidak generic;
- setiap method punya business meaning;
- tenant filter eksplisit;
- query shape stabil;
- projection eksplisit;
- limit dibatasi;
- update memakai concurrency guard;
- write concern majority disetel untuk collection handle.

---

## 23. Index Bootstrap vs Index Governance

Driver bisa membuat index:

```java
cases.createIndex(
    Indexes.compoundIndex(
        Indexes.ascending("tenantId"),
        Indexes.ascending("status"),
        Indexes.descending("createdAt")
    ),
    new IndexOptions().name("idx_cases_tenant_status_createdAt")
);
```

Tapi hati-hati.

Di production, index creation bisa berdampak besar.

Strategi yang umum:

1. local/dev/test: aplikasi boleh bootstrap index;
2. staging/prod: index dikelola via migration/change management;
3. service startup boleh **verify** index existence, bukan selalu create;
4. index besar dibuat melalui prosedur operasional terkontrol.

Contoh verification mindset:

```text
Application startup checks:
- expected index exists?
- name correct?
- key pattern correct?
- uniqueness correct?
- partial filter correct?
```

Jika tidak sesuai:

```text
fail fast di non-prod
alert/fail controlled di prod tergantung policy
```

---

## 24. Common Driver-Level Anti-Patterns

### 24.1 Membuat `MongoClient` Per Request

Gejala:

- latency tinggi;
- koneksi banyak;
- MongoDB log penuh connection open/close;
- aplikasi collapse saat traffic naik.

Solusi:

```text
MongoClient singleton per application/process.
```

---

### 24.2 Tidak Mengatur Timeout

Gejala:

- request menggantung;
- thread pool penuh;
- failure lambat;
- cascading timeout.

Solusi:

```text
Set timeout sesuai request budget.
```

---

### 24.3 Generic `save()` Untuk Semua Update

Gejala:

- lost update;
- field hilang karena replacement;
- invariant bypass;
- audit tidak konsisten.

Solusi:

```text
Gunakan operation-specific update dengan filter guard.
```

---

### 24.4 Query Tanpa Tenant Guard

Gejala:

- data leak antar tenant;
- security incident;
- index tidak optimal;
- compliance failure.

Solusi:

```text
Tenant boundary menjadi mandatory parameter repository.
```

---

### 24.5 Projection Diabaikan

Gejala:

- network payload besar;
- latency naik;
- memory pressure;
- accidental data exposure.

Solusi:

```text
Gunakan projection untuk query summary/list/search.
```

---

### 24.6 Semua Error Jadi 500

Gejala:

- duplicate key dianggap internal error;
- stale update tidak dibedakan dari not found;
- client retry salah;
- observability buruk.

Solusi:

```text
Map driver error ke domain/application error.
```

---

### 24.7 Tidak Mengamati Pool

Gejala:

- latency naik tanpa sebab jelas;
- thread blocked;
- DB tampak normal tapi aplikasi lambat.

Solusi:

```text
Monitor pool checkout time, checked-out connections, wait queue, timeout.
```

Monitoring lebih dalam akan dibahas di Part 016 dan Part 029.

---

## 25. Checklist Desain Java Driver Untuk Production

Gunakan checklist ini saat membuat service baru.

### 25.1 Client Lifecycle

- [ ] `MongoClient` singleton per process.
- [ ] Ditutup saat graceful shutdown.
- [ ] Tidak dibuat per request/job.
- [ ] `appName` disetel.
- [ ] Credential tidak hardcoded.

### 25.2 Pool dan Timeout

- [ ] `maxPoolSize` direview terhadap concurrency.
- [ ] `maxWaitTime` disetel.
- [ ] `serverSelectionTimeout` disetel.
- [ ] `connectTimeout` disetel.
- [ ] `readTimeout` selaras dengan request budget.
- [ ] Pool metrics tersedia.

### 25.3 Mapping

- [ ] Pilihan `Document` vs POJO jelas.
- [ ] Domain model tidak dicampur mentah dengan persistence model jika invariant kompleks.
- [ ] `_id` mapping eksplisit.
- [ ] Field names dikontrol.
- [ ] Date/time mapping konsisten.
- [ ] Decimal/money tidak memakai `double` sembarangan.

### 25.4 Query

- [ ] Tenant guard mandatory.
- [ ] Query shape diketahui.
- [ ] Projection dipakai untuk summary/list.
- [ ] Sort didukung index.
- [ ] Limit dibatasi.
- [ ] Pagination tidak memakai skip besar.

### 25.5 Update

- [ ] State-changing update memakai conditional filter.
- [ ] Version guard dipakai untuk concurrency-sensitive aggregate.
- [ ] Audit/transition ditulis bersama mutation jika perlu.
- [ ] Replacement dipakai hanya untuk full document.
- [ ] Upsert direview ketat.

### 25.6 Error dan Retry

- [ ] Duplicate key dimapping jelas.
- [ ] Stale version dimapping jelas.
- [ ] Timeout dimapping jelas.
- [ ] Retry hanya untuk operasi aman/idempotent.
- [ ] Idempotency key dipakai untuk command penting.

---

## 26. Latihan Praktis

### Latihan 1 — Repository Review

Ambil repository MongoDB yang pernah kamu tulis atau bayangkan repository berikut:

```java
public class CaseRepository {
    public Case save(Case c) { ... }
    public Case findById(String id) { ... }
    public List<Case> findAll() { ... }
}
```

Tulis ulang menjadi operation-specific repository dengan method:

- `createCase`
- `findCaseForTenant`
- `findOpenCaseSummaries`
- `assignReviewer`
- `closeCase`
- `markDeleted`

Pastikan setiap method punya:

- tenant guard;
- query shape jelas;
- projection jika list/summary;
- version guard jika state-changing;
- result handling.

---

### Latihan 2 — Timeout Budget

Misal API kamu punya SLA p95 500 ms.

Rancang budget:

```text
HTTP request total = 500 ms
MongoDB operation  = ?
Pool wait          = ?
Read timeout       = ?
Server selection   = ?
```

Tentukan timeout mana yang terlalu besar dan bisa menyebabkan cascading failure.

---

### Latihan 3 — Mapping Decision

Untuk document berikut:

```json
{
  "_id": "CASE-2026-001",
  "tenantId": "TENANT-A",
  "status": "OPEN",
  "schemaVersion": 3,
  "subject": {
    "type": "PERSON",
    "name": "Alice"
  },
  "transitions": [
    {
      "type": "CREATE",
      "actorId": "user-1",
      "at": "2026-06-21T10:00:00Z"
    }
  ]
}
```

Tentukan:

- mana field persistence-only;
- mana field domain;
- mana field yang sebaiknya masuk API response;
- apakah domain object harus sama dengan persistence POJO;
- bagaimana mapping enum dan timestamp.

---

## 27. Ringkasan Part 015

Poin paling penting:

1. `MongoClient` adalah singleton runtime boundary, bukan object per request.
2. Connection pool adalah bagian dari backpressure dan latency behavior.
3. Timeout adalah correctness boundary, bukan sekadar konfigurasi infrastruktur.
4. Java Driver bukan ORM; operasi harus eksplisit.
5. `Document` fleksibel tetapi raw dan lemah type-safety.
6. POJO memberi struktur tetapi butuh codec/mapping discipline.
7. Domain model, persistence document, dan API DTO tidak harus sama.
8. Query harus membawa tenant guard, projection, sort, limit, dan index awareness.
9. Update harus mengekspresikan invariant lewat conditional filter.
10. Replacement dan upsert adalah operasi kuat yang mudah disalahgunakan.
11. Bulk write harus dirancang dengan partial failure dan idempotency.
12. Repository yang baik mengekspresikan operation bisnis, bukan generic CRUD palsu.
13. Error handling harus membedakan duplicate key, stale update, timeout, dan not found.
14. Retry hanya aman jika operasi idempotent atau dilindungi idempotency key.

---

## 28. Apa yang Akan Dibahas di Part 016

Part 016 akan melanjutkan Java Driver ke area yang lebih advanced:

```text
Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring
```

Fokusnya:

- client session;
- transaction callback;
- transaction retry;
- read/write concern dalam transaksi;
- causal consistency;
- change streams;
- resume token;
- command monitoring;
- connection pool monitoring;
- failure handling saat primary failover;
- production driver checklist lanjutan.

---

## Status Seri

Selesai sampai: **Part 015 dari 035**  
Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Concurrency Control and State Machines in MongoDB</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-016.md">Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring ➡️</a>
</div>
