# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-017.md

# Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 017 dari 035  
> Fokus: Spring Data MongoDB sebagai abstraction layer, bukan pengganti pemahaman MongoDB  
> Target pembaca: Java engineer yang sudah paham backend/service architecture dan ingin memakai MongoDB secara production-grade

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas Java Driver secara langsung: `MongoClient`, `MongoDatabase`, `MongoCollection`, codecs, sessions, transactions, change streams, connection pool, dan monitoring.

Sekarang kita masuk ke **Spring Data MongoDB**.

Banyak Java engineer masuk MongoDB melalui Spring Boot dan Spring Data, bukan melalui native driver. Ini wajar. Spring Data memberi produktivitas tinggi:

- autoconfiguration,
- repository abstraction,
- object mapping,
- `MongoTemplate`,
- query derivation,
- aggregation builder,
- auditing,
- converters,
- transaction integration,
- reactive support,
- integration dengan ekosistem Spring.

Tetapi ada bahaya besar: Spring Data dapat membuat MongoDB terasa seperti JPA versi dokumen.

Itu berbahaya.

MongoDB bukan relational database dengan annotation berbeda. MongoDB adalah document database yang correctness dan performancenya sangat bergantung pada:

- document boundary,
- query shape,
- index shape,
- atomicity boundary,
- schema evolution,
- update semantics,
- consistency expectation,
- read/write concern,
- operational topology.

Spring Data membantu mengurangi boilerplate, tetapi tidak boleh menyembunyikan keputusan-keputusan tersebut.

Setelah bagian ini, kamu harus mampu:

1. Memilih antara `MongoRepository`, `MongoTemplate`, native driver, atau kombinasi.
2. Mendesain entity mapping tanpa membawa mental model JPA secara membabi buta.
3. Menulis query dan update yang eksplisit terhadap query shape dan index.
4. Memahami kapan derived query methods cukup dan kapan harus dihindari.
5. Menggunakan aggregation Spring Data secara maintainable.
6. Memakai custom converters untuk menjaga domain model tetap bersih.
7. Menggunakan optimistic locking dan transactions secara sadar.
8. Menentukan batas abstraction yang sehat untuk sistem production.
9. Menguji repository MongoDB dengan Testcontainers.
10. Menghindari anti-pattern khas Spring Data MongoDB.

---

## 1. Posisi Spring Data MongoDB dalam Stack Java

Secara sederhana:

```text
Application Service
      |
Domain / Command / Query Logic
      |
Repository Interface milik aplikasi
      |
Spring Data MongoDB / MongoTemplate / Native Driver
      |
MongoDB Java Driver
      |
MongoDB Cluster
```

Spring Data MongoDB bukan database.

Spring Data MongoDB adalah layer yang menyediakan:

1. Object-document mapping.
2. Template API.
3. Repository abstraction.
4. Query builder berbasis Criteria.
5. Aggregation builder.
6. Transaction integration dengan Spring.
7. Lifecycle hooks.
8. Auditing.
9. Custom conversions.
10. Reactive APIs.

Yang perlu dijaga: **abstraction ini tidak boleh membuat database access terlihat lebih sederhana daripada realitasnya**.

Contoh bahaya:

```java
List<CaseDocument> findByStatusAndAssigneeId(String status, String assigneeId);
```

Method ini terlihat harmless.

Tetapi secara database, ia membawa pertanyaan:

- Apakah query ini punya compound index?
- Apakah sort-nya stabil?
- Apakah ada tenant filter?
- Apakah status cardinality rendah?
- Apakah assigneeId selective?
- Apakah hasilnya bisa jutaan?
- Apakah pagination wajib?
- Apakah projection dibutuhkan?
- Apakah query ini membaca document besar padahal hanya butuh summary?

Spring Data membuat query mudah ditulis, bukan otomatis benar.

---

## 2. Kapan Menggunakan Spring Data MongoDB

Spring Data MongoDB cocok ketika:

1. Aplikasi sudah berbasis Spring Boot.
2. Domain access pattern relatif stabil.
3. Kamu ingin mapping POJO yang nyaman.
4. Banyak operasi CRUD standar.
5. Kamu ingin integrasi dengan Spring transactions, metrics, config, profiles, dan testing.
6. Tim familiar dengan Spring Data style.
7. Kamu punya discipline untuk tetap memeriksa query shape dan index.

Spring Data MongoDB kurang cocok ketika:

1. Kamu butuh kontrol penuh atas command-level options.
2. Kamu melakukan heavy low-level tuning.
3. Banyak operasi highly custom menggunakan native MongoDB features terbaru yang belum terbungkus API Spring Data.
4. Kamu ingin minimize abstraction overhead.
5. Tim cenderung menganggap repository method sebagai magic.
6. Query sangat dinamis dan perlu explicit query planner discipline.

Praktik sehat untuk sistem serius:

```text
Gunakan Spring Data untuk produktivitas,
tetapi desain repository interface milik aplikasi tetap eksplisit terhadap access pattern.
```

Jangan expose `MongoRepository` langsung ke service layer jika domain kamu kompleks.

Lebih baik:

```java
public interface CaseStore {
    Optional<CaseRecord> findById(TenantId tenantId, CaseId caseId);

    PageSlice<CaseSummary> searchOpenCases(
        TenantId tenantId,
        CaseSearchCriteria criteria,
        SeekPageRequest page
    );

    boolean transitionState(
        TenantId tenantId,
        CaseId caseId,
        CaseState expectedState,
        CaseState nextState,
        long expectedVersion,
        TransitionMetadata metadata
    );
}
```

Lalu implementasinya boleh memakai `MongoTemplate`, repository Spring Data, atau native driver.

---

## 3. Jangan Membawa JPA Mindset ke MongoDB

Spring Data namanya mirip dengan Spring Data JPA. Banyak annotation juga terlihat familiar. Ini membuat banyak engineer membawa kebiasaan JPA ke MongoDB.

Kesalahan mental model yang paling umum:

| JPA Mindset | Mengapa Bermasalah di MongoDB |
|---|---|
| Satu class entity = satu table/collection | MongoDB harus dimodelkan berdasarkan aggregate dan access pattern |
| Relationship pakai reference default | MongoDB sering lebih cocok embed/subset/duplicate view |
| Lazy loading relationship | Document database tidak didesain untuk lazy graph traversal seperti ORM |
| Repository `save()` untuk semua update | Bisa menyebabkan lost update atau mengganti field secara tidak sengaja |
| Query method sebanyak mungkin | Query shape tidak terkendali, index meledak |
| Database schema fixed, migration seperti DDL | MongoDB membutuhkan reader/writer compatibility dan schema versioning |
| Join bisa dipindah ke `$lookup` | `$lookup` bukan pengganti modelling boundary yang buruk |

MongoDB bukan ORM problem.

MongoDB adalah **persistence shape problem**.

Jika kamu salah menentukan shape, Spring Data tidak menyelamatkanmu.

---

## 4. Dependency dan Setup Dasar

Dengan Spring Boot, dependency biasanya:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-mongodb</artifactId>
</dependency>
```

Untuk reactive:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-mongodb-reactive</artifactId>
</dependency>
```

Konfigurasi minimal:

```yaml
spring:
  data:
    mongodb:
      uri: mongodb://app_user:secret@localhost:27017/regulatory_cases?authSource=admin
```

Contoh lebih realistis:

```yaml
spring:
  data:
    mongodb:
      uri: mongodb+srv://app_user:${MONGODB_PASSWORD}@cluster.example.mongodb.net/regulatory_cases
      database: regulatory_cases
```

Catatan penting:

1. Jangan hardcode secret di config.
2. Gunakan secret manager/environment variable.
3. Pastikan TLS/SSL sesuai deployment.
4. Pastikan timeout dan pool bukan hanya default tanpa review.
5. Pastikan user database memiliki privilege minimal.

---

## 5. Mapping Dasar: `@Document`, `@Id`, dan Field Mapping

Contoh document model sederhana:

```java
@Document(collection = "cases")
public class CaseDocument {

    @Id
    private String id;

    @Field("tenantId")
    private String tenantId;

    @Field("caseNumber")
    private String caseNumber;

    @Field("status")
    private String status;

    @Field("assigneeId")
    private String assigneeId;

    @Field("createdAt")
    private Instant createdAt;

    @Field("updatedAt")
    private Instant updatedAt;

    @Version
    private Long version;

    // getters, constructors, mapping helpers
}
```

Annotation utama:

```java
@Document(collection = "cases")
```

Menentukan collection.

```java
@Id
```

Menandai primary identifier mapped ke `_id`.

```java
@Field("caseNumber")
```

Menentukan nama field BSON.

```java
@Version
```

Mendukung optimistic locking.

Prinsip penting:

```text
Nama class Java boleh berubah.
Nama field persistent jangan sering berubah.
```

Karena field MongoDB adalah contract persisted.

Jika kamu mengganti:

```java
private String assigneeId;
```

menjadi:

```java
private String assignedUserId;
```

lalu tidak memakai `@Field("assigneeId")`, kamu berpotensi membuat field baru di database dan meninggalkan field lama.

Untuk sistem production, explicit `@Field` sering lebih aman daripada mengandalkan naming convention otomatis.

---

## 6. Domain Model vs Persistence Document

Jangan selalu menjadikan class `@Document` sebagai domain model.

Untuk sistem kecil, mungkin cukup.

Untuk sistem serius, terutama yang punya workflow, auditability, compliance, dan invariants, lebih aman memisahkan:

```text
Domain Model        : ekspresi invariant dan behavior
Persistence Document: bentuk penyimpanan MongoDB
API DTO             : kontrak eksternal
Read Model          : bentuk response/query optimized
```

Contoh:

```java
public final class CaseAggregate {
    private final CaseId id;
    private final TenantId tenantId;
    private final CaseState state;
    private final Version version;
    private final List<CaseParty> parties;

    public CaseAggregate transitionTo(CaseState next, Actor actor) {
        if (!state.canTransitionTo(next)) {
            throw new IllegalStateException("Illegal transition");
        }
        return new CaseAggregate(id, tenantId, next, version.increment(), parties);
    }
}
```

Persistence document:

```java
@Document("cases")
public class CaseDocument {
    @Id
    private String id;
    private String tenantId;
    private String state;
    private Long version;
    private List<PartySubDocument> parties;
    private Instant createdAt;
    private Instant updatedAt;
}
```

Mapper:

```java
public final class CaseMapper {
    public CaseAggregate toDomain(CaseDocument doc) {
        return new CaseAggregate(
            new CaseId(doc.getId()),
            new TenantId(doc.getTenantId()),
            CaseState.valueOf(doc.getState()),
            new Version(doc.getVersion()),
            doc.getParties().stream().map(this::toDomainParty).toList()
        );
    }

    public CaseDocument toDocument(CaseAggregate aggregate) {
        // explicit mapping
    }
}
```

Keuntungan:

1. Domain tidak bocor annotation persistence.
2. Schema evolution lebih terkendali.
3. Migration lebih mudah.
4. Read model bisa berbeda dari write model.
5. Testing invariant tidak membutuhkan database.
6. Kamu bisa mengganti mapping tanpa mengubah domain.

Kekurangan:

1. Lebih banyak kode.
2. Perlu discipline mapping.
3. Bisa terasa overkill untuk modul sederhana.

Rule praktis:

```text
Jika collection menyimpan aggregate penting dengan invariant kompleks,
pisahkan domain model dari persistence document.

Jika collection hanya lookup/config/simple metadata,
@Document sebagai model aplikasi mungkin cukup.
```

---

## 7. `MongoRepository`: Cepat, Nyaman, tapi Harus Dibatasi

Contoh repository:

```java
public interface CaseMongoRepository
        extends MongoRepository<CaseDocument, String> {

    Optional<CaseDocument> findByTenantIdAndId(String tenantId, String id);

    List<CaseDocument> findByTenantIdAndStatus(String tenantId, String status);

    Page<CaseDocument> findByTenantIdAndStatus(
        String tenantId,
        String status,
        Pageable pageable
    );
}
```

Spring Data akan membuat query berdasarkan nama method.

Kelebihan:

1. Cepat untuk CRUD sederhana.
2. Mudah dipahami.
3. Cocok untuk lookup sederhana.
4. Mengurangi boilerplate.
5. Terintegrasi dengan pagination/sort.

Masalah:

1. Query shape tersembunyi di nama method.
2. Nama method bisa menjadi sangat panjang.
3. Sulit mengontrol projection.
4. Sulit mengontrol update operator.
5. Mudah lupa tenant/security filter.
6. Bisa mendorong proliferation query tanpa index review.
7. `save()` bisa dipakai terlalu bebas.

Contoh method yang mulai buruk:

```java
Page<CaseDocument> findByTenantIdAndStatusInAndAssigneeIdAndPriorityGreaterThanEqualAndCreatedAtBetweenAndRegionCodeIn(
    String tenantId,
    List<String> statuses,
    String assigneeId,
    int minPriority,
    Instant from,
    Instant to,
    List<String> regionCodes,
    Pageable pageable
);
```

Method seperti ini menyembunyikan masalah desain:

- Query terlalu dinamis.
- Index requirement kompleks.
- Pagination/sort belum jelas.
- Projection belum jelas.
- Security filter bisa tercampur dengan search filter.
- API filter mungkin terlalu bebas.

Untuk query seperti ini, gunakan `MongoTemplate` dengan query object eksplisit.

---

## 8. `MongoTemplate`: Boundary yang Lebih Jujur

`MongoTemplate` memberi API yang lebih dekat ke operasi MongoDB, tetapi tetap nyaman dalam Spring.

Contoh find:

```java
Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("status").is("OPEN"))
    .with(Sort.by(Sort.Direction.DESC, "createdAt"))
    .limit(50);

List<CaseDocument> result = mongoTemplate.find(query, CaseDocument.class, "cases");
```

Contoh projection:

```java
Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("status").is("OPEN"));

query.fields()
    .include("_id")
    .include("caseNumber")
    .include("status")
    .include("assigneeId")
    .include("createdAt")
    .exclude("largeEvidencePayload")
    .exclude("auditTrail");

List<CaseSummaryDocument> summaries = mongoTemplate.find(
    query,
    CaseSummaryDocument.class,
    "cases"
);
```

Contoh update operator:

```java
Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("_id").is(caseId.value()))
    .addCriteria(Criteria.where("state").is("SUBMITTED"))
    .addCriteria(Criteria.where("version").is(expectedVersion));

Update update = new Update()
    .set("state", "UNDER_REVIEW")
    .inc("version", 1)
    .set("updatedAt", Instant.now())
    .push("transitions", transitionDocument);

UpdateResult result = mongoTemplate.updateFirst(query, update, CaseDocument.class);

if (result.getMatchedCount() == 0) {
    throw new ConcurrentStateTransitionException();
}
```

Ini jauh lebih jujur daripada:

```java
caseRepository.save(modifiedCase);
```

Karena transition invariant terlihat di query.

---

## 9. Repository Boundary yang Sehat

Jangan membuat service layer bergantung langsung ke Spring Data repository untuk domain penting.

Kurang ideal:

```java
@Service
public class CaseService {
    private final CaseMongoRepository repository;

    public void submit(String caseId) {
        CaseDocument doc = repository.findById(caseId).orElseThrow();
        doc.setState("SUBMITTED");
        repository.save(doc);
    }
}
```

Masalah:

1. Tidak ada tenant guard.
2. Lost update risk.
3. Transition guard lemah.
4. `save()` mengganti document berdasarkan state di memory.
5. Tidak jelas index/query shape.
6. Domain invariant tersebar.

Lebih baik:

```java
public interface CaseStore {
    Optional<CaseAggregate> findForCommand(TenantId tenantId, CaseId caseId);

    boolean submit(
        TenantId tenantId,
        CaseId caseId,
        CaseState expectedState,
        Version expectedVersion,
        Actor actor,
        Instant now
    );
}
```

Implementasi:

```java
@Repository
public class MongoCaseStore implements CaseStore {

    private final MongoTemplate mongoTemplate;
    private final CaseMapper mapper;

    public MongoCaseStore(MongoTemplate mongoTemplate, CaseMapper mapper) {
        this.mongoTemplate = mongoTemplate;
        this.mapper = mapper;
    }

    @Override
    public Optional<CaseAggregate> findForCommand(TenantId tenantId, CaseId caseId) {
        Query query = new Query()
            .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
            .addCriteria(Criteria.where("_id").is(caseId.value()));

        CaseDocument doc = mongoTemplate.findOne(query, CaseDocument.class, "cases");
        return Optional.ofNullable(doc).map(mapper::toDomain);
    }

    @Override
    public boolean submit(
        TenantId tenantId,
        CaseId caseId,
        CaseState expectedState,
        Version expectedVersion,
        Actor actor,
        Instant now
    ) {
        Query query = new Query()
            .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
            .addCriteria(Criteria.where("_id").is(caseId.value()))
            .addCriteria(Criteria.where("state").is(expectedState.name()))
            .addCriteria(Criteria.where("version").is(expectedVersion.value()));

        Update update = new Update()
            .set("state", CaseState.SUBMITTED.name())
            .set("updatedAt", now)
            .inc("version", 1)
            .push("transitions", TransitionDocument.submittedBy(actor, now));

        UpdateResult result = mongoTemplate.updateFirst(query, update, CaseDocument.class, "cases");
        return result.getMatchedCount() == 1;
    }
}
```

Manfaat:

1. Domain repository method berbicara dalam bahasa use case.
2. Tenant guard selalu ada.
3. State transition atomic.
4. Optimistic concurrency eksplisit.
5. Tidak semua caller bisa melakukan arbitrary `save()`.
6. Query shape mudah direview.

---

## 10. Query Methods: Gunakan untuk Access Pattern yang Kecil dan Stabil

Query derivation cocok untuk:

```java
Optional<UserSettingsDocument> findByTenantIdAndUserId(String tenantId, String userId);

boolean existsByTenantIdAndCaseNumber(String tenantId, String caseNumber);

Optional<WorkflowConfigDocument> findByTenantIdAndWorkflowType(String tenantId, String workflowType);
```

Ciri query yang cocok:

1. Equality lookup.
2. Query shape stabil.
3. Index jelas.
4. Tidak banyak optional filter.
5. Tidak perlu update operator kompleks.
6. Tidak butuh projection berat.
7. Tidak berada di hot path yang perlu tuning detail.

Query derivation kurang cocok untuk:

1. Dynamic search screen.
2. Banyak optional filters.
3. Complex sorting.
4. Seek pagination.
5. Aggregation.
6. Conditional update.
7. State transition.
8. Large collection scan risk.
9. Security-sensitive query yang harus inject filter wajib.

Rule:

```text
Jika query method mulai panjang dan sulit dibaca,
itu bukan tanda untuk memformat ulang nama method.
Itu tanda untuk pindah ke explicit query object.
```

---

## 11. `@Query`: Berguna, tetapi Bisa Menjadi Stringly-Typed Trap

Spring Data mendukung query manual:

```java
@Query("{ 'tenantId': ?0, 'status': ?1 }")
List<CaseDocument> findCasesByStatus(String tenantId, String status);
```

Dengan projection:

```java
@Query(
    value = "{ 'tenantId': ?0, 'status': ?1 }",
    fields = "{ '_id': 1, 'caseNumber': 1, 'status': 1, 'createdAt': 1 }"
)
List<CaseSummaryDocument> findCaseSummaries(String tenantId, String status);
```

Kelebihan:

1. Dekat dengan MongoDB query syntax.
2. Bisa ringkas untuk query khusus.
3. Bisa mengontrol projection.

Kekurangan:

1. Stringly typed.
2. Refactor field rawan.
3. Validasi compile-time lemah.
4. Query kompleks sulit dipelihara.
5. Mudah mencampur security filter dengan query filter secara tidak konsisten.

Gunakan `@Query` untuk query kecil yang benar-benar stabil.

Untuk query kompleks, gunakan `MongoTemplate`.

---

## 12. Pagination: Jangan Membawa `Pageable` Secara Buta

Spring Data membuat pagination mudah:

```java
Page<CaseDocument> findByTenantIdAndStatus(
    String tenantId,
    String status,
    Pageable pageable
);
```

Ini nyaman, tetapi hati-hati.

`Page` biasanya membutuhkan:

1. Query data.
2. Count total.

Count total pada collection besar bisa mahal, tergantung filter dan index.

Selain itu, `Pageable` biasanya mendorong offset pagination:

```text
page=10000&size=50
```

Offset/skip besar buruk untuk dataset besar karena database tetap harus melewati banyak record.

Untuk operational system, sering lebih baik menggunakan seek pagination:

```java
public record CaseCursor(
    Instant createdAt,
    String id
) {}
```

Query:

```java
Criteria seekCriteria = new Criteria().orOperator(
    Criteria.where("createdAt").lt(cursor.createdAt()),
    new Criteria().andOperator(
        Criteria.where("createdAt").is(cursor.createdAt()),
        Criteria.where("_id").lt(cursor.id())
    )
);

Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("status").is("OPEN"))
    .addCriteria(seekCriteria)
    .with(Sort.by(
        Sort.Order.desc("createdAt"),
        Sort.Order.desc("_id")
    ))
    .limit(limit + 1);
```

Index pendukung:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, createdAt: -1, _id: -1 })
```

Jadi guideline:

```text
Gunakan Pageable untuk admin/simple UI.
Gunakan cursor/seek pagination untuk large operational dataset.
```

---

## 13. Sorting: API Sort Harus Dikendalikan

Spring Data memudahkan sort:

```java
PageRequest.of(0, 50, Sort.by("createdAt").descending())
```

Masalah muncul jika public API mengizinkan arbitrary sort field:

```http
GET /cases?sort=anyField,desc
```

Ini berbahaya karena:

1. Tidak semua field punya index.
2. Sort tanpa index bisa mahal.
3. Sort pada field nested/array bisa mengejutkan.
4. User bisa memicu query buruk.
5. Index permutations meledak.

Lebih sehat:

```java
public enum CaseSortOption {
    CREATED_AT_DESC,
    PRIORITY_DESC,
    UPDATED_AT_DESC
}
```

Mapping eksplisit:

```java
Sort toSort(CaseSortOption option) {
    return switch (option) {
        case CREATED_AT_DESC -> Sort.by(
            Sort.Order.desc("createdAt"),
            Sort.Order.desc("_id")
        );
        case PRIORITY_DESC -> Sort.by(
            Sort.Order.desc("priority"),
            Sort.Order.desc("createdAt"),
            Sort.Order.desc("_id")
        );
        case UPDATED_AT_DESC -> Sort.by(
            Sort.Order.desc("updatedAt"),
            Sort.Order.desc("_id")
        );
    };
}
```

Setiap sort option harus punya index review.

---

## 14. Projection: Jangan Selalu Membaca Full Document

Repository default cenderung membaca full document.

Padahal document MongoDB bisa besar:

- embedded parties,
- audit history,
- transition history,
- evidence metadata,
- computed fields,
- attachments metadata,
- notes,
- comments.

Untuk list page, biasanya hanya butuh summary.

Gunakan projection.

Dengan interface projection:

```java
public interface CaseSummaryProjection {
    String getId();
    String getCaseNumber();
    String getStatus();
    String getAssigneeId();
    Instant getCreatedAt();
}
```

Repository:

```java
List<CaseSummaryProjection> findByTenantIdAndStatus(String tenantId, String status);
```

Atau dengan `MongoTemplate`:

```java
Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("status").is("OPEN"));

query.fields()
    .include("_id")
    .include("caseNumber")
    .include("status")
    .include("assigneeId")
    .include("createdAt");

List<CaseSummaryDocument> docs = mongoTemplate.find(query, CaseSummaryDocument.class, "cases");
```

Projection adalah performance tool dan boundary tool.

```text
List screen sebaiknya tidak membawa full aggregate jika tidak perlu.
```

---

## 15. Update Semantics: `save()` vs Operator Update

Salah satu keputusan terpenting di Spring Data MongoDB adalah kapan memakai `save()` dan kapan memakai update operator.

`save()`:

```java
repository.save(document);
```

Secara mental, ini berarti:

```text
Ambil object di memory.
Serialize menjadi document.
Simpan sebagai state baru.
```

Cocok untuk:

1. Insert sederhana.
2. Replace seluruh document yang kecil.
3. Aggregate write yang memang controlled.
4. Admin/config object yang jarang konflik.

Tidak cocok untuk:

1. High-concurrency update.
2. Partial update.
3. State transition guarded.
4. Append history atomic.
5. Increment counter.
6. Update field kecil pada document besar.
7. Menghindari overwrite field yang tidak diketahui versi lama aplikasi.

Lebih baik gunakan operator:

```java
Update update = new Update()
    .set("assigneeId", assigneeId.value())
    .set("updatedAt", now)
    .inc("version", 1);
```

Contoh append note:

```java
Update update = new Update()
    .push("notes", noteDocument)
    .set("updatedAt", now)
    .inc("version", 1);
```

Contoh add tag tanpa duplicate:

```java
Update update = new Update()
    .addToSet("tags", "urgent")
    .set("updatedAt", now);
```

Rule:

```text
Gunakan save() hanya saat kamu benar-benar bermaksud menyimpan seluruh representasi document.
Untuk mutation spesifik, gunakan update operator.
```

---

## 16. Optimistic Locking dengan `@Version`

Spring Data MongoDB mendukung optimistic locking dengan `@Version`.

Contoh:

```java
@Document("cases")
public class CaseDocument {
    @Id
    private String id;

    private String tenantId;
    private String state;

    @Version
    private Long version;
}
```

Ketika object disimpan, Spring Data dapat memakai version untuk mendeteksi concurrent modification.

Contoh flow:

1. Request A membaca case version 5.
2. Request B membaca case version 5.
3. Request A update menjadi version 6.
4. Request B mencoba update berdasarkan version 5.
5. Request B gagal karena version sudah berubah.

Ini baik untuk pola read-modify-write.

Tetapi untuk state machine, sering lebih eksplisit memakai conditional update:

```java
Query query = new Query()
    .addCriteria(Criteria.where("_id").is(caseId.value()))
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("state").is("SUBMITTED"))
    .addCriteria(Criteria.where("version").is(expectedVersion));

Update update = new Update()
    .set("state", "UNDER_REVIEW")
    .inc("version", 1);

UpdateResult result = mongoTemplate.updateFirst(query, update, CaseDocument.class);
```

Kapan `@Version` cukup:

1. Simple aggregate update.
2. Save-based repository pattern.
3. Konflik cukup ditangani sebagai retry/failure.

Kapan explicit conditional update lebih baik:

1. State transition.
2. Workflow command.
3. Idempotent command.
4. Update sebagian field.
5. Invariant harus terlihat di query.
6. Audit transition harus append atomic.

---

## 17. Auditing: Useful, but Not Audit Trail

Spring Data menyediakan auditing annotation seperti:

```java
@CreatedDate
private Instant createdAt;

@LastModifiedDate
private Instant updatedAt;

@CreatedBy
private String createdBy;

@LastModifiedBy
private String updatedBy;
```

Enable:

```java
@EnableMongoAuditing
@Configuration
public class MongoAuditingConfig {
}
```

Auditor provider:

```java
@Bean
AuditorAware<String> auditorAware() {
    return () -> Optional.ofNullable(SecurityContextHolder.getContext())
        .map(SecurityContext::getAuthentication)
        .map(Authentication::getName);
}
```

Auditing berguna untuk metadata.

Tetapi jangan samakan dengan audit trail regulatoris.

```text
createdAt/updatedAt bukan audit trail.
```

Audit trail perlu:

1. Event apa yang terjadi.
2. Siapa aktor.
3. Kapan.
4. Dari state apa ke state apa.
5. Reason/comment.
6. Correlation ID.
7. Request ID.
8. Source channel.
9. Before/after penting.
10. Immutable record.
11. Retention/legal hold policy.

Contoh transition embedded:

```java
Update update = new Update()
    .set("state", "APPROVED")
    .set("updatedAt", now)
    .inc("version", 1)
    .push("transitions", new TransitionDocument(
        "APPROVE",
        "UNDER_REVIEW",
        "APPROVED",
        actorId,
        now,
        correlationId,
        reason
    ));
```

Auditing Spring Data membantu, tetapi audit defensibility tetap desain domain.

---

## 18. Custom Converters: Menjaga Domain Type Tetap Kaya

MongoDB menyimpan BSON, Java domain sering memakai value object.

Contoh domain type:

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("caseId is required");
        }
    }
}
```

Jika persistence document memakai langsung `CaseId`, perlu converter.

Writing converter:

```java
@WritingConverter
public class CaseIdWriteConverter implements Converter<CaseId, String> {
    @Override
    public String convert(CaseId source) {
        return source.value();
    }
}
```

Reading converter:

```java
@ReadingConverter
public class CaseIdReadConverter implements Converter<String, CaseId> {
    @Override
    public CaseId convert(String source) {
        return new CaseId(source);
    }
}
```

Register:

```java
@Configuration
public class MongoConfig {

    @Bean
    MongoCustomConversions mongoCustomConversions() {
        return new MongoCustomConversions(List.of(
            new CaseIdWriteConverter(),
            new CaseIdReadConverter()
        ));
    }
}
```

Gunakan custom converter untuk:

1. Strongly typed IDs.
2. Money.
3. Domain enum dengan stable code.
4. Encrypted/sensitive wrappers.
5. Value objects.

Hati-hati:

1. Converter global bisa berdampak luas.
2. Jangan ubah converter tanpa migration plan.
3. Pastikan query value juga memakai bentuk persisted yang sama.
4. Test round-trip serialization.

---

## 19. Enum Mapping: Jangan Bergantung pada Nama Enum Secara Buta

Contoh enum:

```java
public enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Jika disimpan sebagai string nama enum, refactor nama enum bisa merusak data lama.

Lebih aman untuk domain yang long-lived:

```java
public enum CaseState {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");

    private final String code;

    CaseState(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseState fromCode(String code) {
        return Arrays.stream(values())
            .filter(v -> v.code.equals(code))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unknown state: " + code));
    }
}
```

Persisted value sebaiknya stable code, bukan accidental Java symbol.

---

## 20. Index Management dengan Spring Data

Spring Data menyediakan annotation seperti:

```java
@Indexed
private String caseNumber;
```

Compound index:

```java
@CompoundIndex(
    name = "idx_tenant_status_created_id",
    def = "{ 'tenantId': 1, 'status': 1, 'createdAt': -1, '_id': -1 }"
)
@Document("cases")
public class CaseDocument {
    // fields
}
```

Kelebihan annotation index:

1. Dekat dengan model.
2. Mudah untuk simple indexes.
3. Bisa membantu development/testing.

Kekurangan:

1. Production index lifecycle perlu kontrol lebih besar.
2. Index build bisa mahal.
3. Perubahan index butuh rollout plan.
4. Index tidak selalu hanya property entity; sering mengikuti use case/query shape.
5. Compound index kompleks bisa membuat annotation ramai.

Untuk production, pertimbangkan index management eksplisit:

```java
@Component
public class MongoIndexVerifier {

    private final MongoTemplate mongoTemplate;

    public MongoIndexVerifier(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void verifyIndexes() {
        IndexOperations ops = mongoTemplate.indexOps("cases");

        Index index = new Index()
            .on("tenantId", Sort.Direction.ASC)
            .on("status", Sort.Direction.ASC)
            .on("createdAt", Sort.Direction.DESC)
            .on("_id", Sort.Direction.DESC)
            .named("idx_tenant_status_created_id");

        ops.ensureIndex(index);
    }
}
```

Namun untuk database besar, bahkan `ensureIndex` saat startup harus hati-hati.

Lebih mature:

1. Index didefinisikan sebagai migration script.
2. Review manual di deployment plan.
3. Dibuat hidden/background sesuai capability/version.
4. Diobservasi selama build.
5. Query explain diverifikasi.
6. Index lama di-drop setelah aman.

Rule:

```text
Annotation index baik untuk local/dev/simple apps.
Production index lifecycle sebaiknya diperlakukan sebagai database migration.
```

---

## 21. Aggregation dengan Spring Data

Spring Data menyediakan aggregation builder.

Contoh pipeline sederhana:

```java
Aggregation aggregation = Aggregation.newAggregation(
    Aggregation.match(Criteria.where("tenantId").is(tenantId.value())),
    Aggregation.match(Criteria.where("createdAt").gte(from).lt(to)),
    Aggregation.group("state").count().as("count"),
    Aggregation.project("count").and("_id").as("state")
);

AggregationResults<StateCount> results = mongoTemplate.aggregate(
    aggregation,
    "cases",
    StateCount.class
);
```

Output:

```java
public record StateCount(String state, long count) {}
```

Untuk pipeline kompleks, jangan inline semua di service.

Buruk:

```java
@Service
public class DashboardService {
    public Dashboard dashboard(...) {
        Aggregation aggregation = Aggregation.newAggregation(
            // 100 lines pipeline here
        );
    }
}
```

Lebih baik:

```java
public final class CaseDashboardAggregation {

    public static Aggregation build(TenantId tenantId, Instant from, Instant to) {
        return Aggregation.newAggregation(
            tenantFilter(tenantId),
            timeRange(from, to),
            groupByState(),
            shapeOutput()
        );
    }

    private static MatchOperation tenantFilter(TenantId tenantId) {
        return Aggregation.match(Criteria.where("tenantId").is(tenantId.value()));
    }

    private static MatchOperation timeRange(Instant from, Instant to) {
        return Aggregation.match(Criteria.where("createdAt").gte(from).lt(to));
    }

    private static GroupOperation groupByState() {
        return Aggregation.group("state").count().as("count");
    }

    private static ProjectionOperation shapeOutput() {
        return Aggregation.project("count").and("_id").as("state");
    }
}
```

Aggregation harus diperlakukan seperti code penting:

1. Punya builder/function jelas.
2. Punya unit/integration test.
3. Punya sample input-output.
4. Punya explain review.
5. Punya index review.
6. Punya memory/performance expectation.

---

## 22. Transactions dengan Spring Data MongoDB

Spring Data bisa diintegrasikan dengan Spring transaction management.

Konfigurasi biasanya melibatkan `MongoTransactionManager` untuk imperative stack:

```java
@Configuration
public class MongoTxConfig {

    @Bean
    MongoTransactionManager transactionManager(MongoDatabaseFactory dbFactory) {
        return new MongoTransactionManager(dbFactory);
    }
}
```

Lalu:

```java
@Transactional
public void createCaseAndInitialTask(CreateCaseCommand command) {
    caseStore.insert(command.toCase());
    taskStore.insert(command.toInitialTask());
}
```

Namun ingat prinsip dari Part 013:

```text
Transaction bukan pengganti aggregate design.
```

Gunakan transaction ketika:

1. Dua document harus berubah atomically.
2. Tidak bisa diremodel menjadi satu aggregate.
3. Consistency requirement jelas.
4. Volume dan latency masih masuk budget.
5. Retry behavior didesain.

Jangan gunakan transaction hanya karena terbiasa dari relational/JPA.

Hati-hati dengan `@Transactional`:

1. Self-invocation tidak memicu proxy transaction.
2. Method harus dipanggil dari bean lain/proxy.
3. Exception handling mempengaruhi rollback.
4. Transaction dengan external call sangat buruk.
5. Long transaction meningkatkan risiko conflict/resource pressure.
6. Tidak semua operasi/collection/deployment mode cocok.

Buruk:

```java
@Transactional
public void approveCase(...) {
    caseStore.approve(...);
    emailClient.sendApprovalEmail(...); // external side effect inside transaction
    auditPublisher.publish(...);        // external side effect inside transaction
}
```

Lebih baik:

```java
@Transactional
public void approveCase(...) {
    caseStore.approve(...);
    outboxStore.insert(...);
}
```

Lalu worker mengirim email/event dari outbox.

---

## 23. Reactive Spring Data MongoDB

Reactive MongoDB stack memakai:

```java
ReactiveMongoTemplate
ReactiveMongoRepository
Flux<T>
Mono<T>
```

Cocok ketika:

1. Stack aplikasi memang reactive end-to-end.
2. Banyak concurrent I/O.
3. Tim memahami backpressure dan reactive debugging.
4. Tidak mencampur blocking calls.

Tidak cocok ketika:

1. Aplikasi mayoritas imperative MVC.
2. Tim belum nyaman dengan Reactor.
3. Service banyak melakukan blocking call.
4. Kamu hanya ingin “lebih cepat” tanpa memahami model.

Contoh reactive query:

```java
Flux<CaseDocument> findOpenCases(TenantId tenantId) {
    Query query = new Query()
        .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
        .addCriteria(Criteria.where("status").is("OPEN"))
        .limit(100);

    return reactiveMongoTemplate.find(query, CaseDocument.class, "cases");
}
```

Reactive bukan silver bullet.

Jika kamu memakai reactive, perhatikan:

1. Jangan block:

```java
mono.block(); // biasanya buruk di reactive pipeline
```

2. Jangan panggil JDBC/blocking HTTP client di event loop.
3. Pahami retry/backpressure.
4. Pahami transaction support reactive berbeda secara mekanik.
5. Observability/debugging lebih kompleks.

Rule praktis:

```text
Gunakan reactive jika seluruh request path memang reactive dan tim siap.
Jangan gunakan reactive hanya karena terdengar modern.
```

---

## 24. Exception Handling dan Error Mapping

Spring Data membungkus banyak exception database menjadi Spring `DataAccessException` hierarchy.

Contoh penting:

- duplicate key,
- optimistic locking failure,
- timeout,
- connectivity issue,
- transaction failure,
- mapping failure.

Service layer sebaiknya tidak membocorkan exception database mentah ke API.

Contoh mapping:

```java
try {
    caseStore.create(caseAggregate);
} catch (DuplicateKeyException e) {
    throw new CaseNumberAlreadyExistsException(command.caseNumber());
} catch (OptimisticLockingFailureException e) {
    throw new ConcurrentModificationException("Case was modified by another actor", e);
}
```

Untuk command handler:

```java
public CommandResult handle(SubmitCaseCommand command) {
    try {
        boolean updated = caseStore.submit(...);
        if (!updated) {
            return CommandResult.conflict("Case state changed or version mismatch");
        }
        return CommandResult.success();
    } catch (DuplicateCommandException e) {
        return CommandResult.idempotentSuccess();
    } catch (DataAccessResourceFailureException e) {
        return CommandResult.retryableFailure();
    }
}
```

Klasifikasi error:

| Error | Biasanya |
|---|---|
| Duplicate key | business conflict / idempotent duplicate |
| Optimistic lock failure | concurrency conflict |
| Timeout | retryable dengan batas |
| Network transient | retryable dengan idempotency |
| Mapping exception | bug/schema mismatch |
| Validation exception | bad input/data corruption |
| Transaction unknown commit | butuh idempotency/read-after |

Jangan retry semua error.

Retry tanpa idempotency dapat menciptakan duplicate mutation.

---

## 25. Schema Validation dengan Spring Data

MongoDB mendukung schema validation di server side. Spring Data mapping bukan pengganti schema validation.

Spring validation/Bean Validation:

```java
@NotBlank
private String tenantId;

@NotNull
private Instant createdAt;
```

Ini validasi aplikasi.

Server-side validation melindungi database dari writer lain, bug, script, dan service lama.

Dalam sistem production, pertimbangkan dua lapis:

1. Application validation.
2. MongoDB collection validation.

Namun hati-hati:

1. Schema validation terlalu ketat bisa menghambat rolling deployment.
2. Harus kompatibel dengan schema evolution.
3. Gunakan mode/level sesuai migration strategy.

Rule:

```text
Application validation menjaga command correctness.
Database validation menjaga persisted contract minimum.
```

---

## 26. `DBRef`: Hampir Selalu Jangan Default

Spring Data mendukung `@DBRef`.

Contoh:

```java
@DBRef
private CustomerDocument customer;
```

Ini tampak mirip relationship.

Tetapi dalam MongoDB, reference bukan lazy relational association yang magically efficient.

Masalah `DBRef`:

1. Bisa menyebabkan banyak round-trip.
2. Menyembunyikan access pattern.
3. Mendorong graph traversal ala ORM.
4. Tidak otomatis menjaga referential integrity seperti relational FK.
5. Sulit mengontrol projection/index/query.
6. Bisa membuat performance tidak transparan.

Lebih eksplisit:

```java
private String customerId;
private CustomerSnapshot customerSnapshot;
```

Contoh:

```java
public class CaseDocument {
    private String customerId;
    private CustomerSummary customer;
}

public class CustomerSummary {
    private String name;
    private String riskRating;
    private String segment;
}
```

Ini menyatakan:

- `customerId` adalah identity reference.
- `customer` adalah snapshot/subset untuk read locality.

Rule:

```text
Gunakan explicit reference ID dan optional embedded snapshot.
Jangan default ke @DBRef hanya karena terbiasa relationship annotation.
```

---

## 27. Lifecycle Events dan Callbacks

Spring Data menyediakan lifecycle events/callbacks seperti before convert, before save, after save.

Contoh:

```java
@Component
public class CaseBeforeConvertCallback
        implements BeforeConvertCallback<CaseDocument> {

    @Override
    public CaseDocument onBeforeConvert(CaseDocument entity, String collection) {
        if (entity.getCreatedAt() == null) {
            entity.setCreatedAt(Instant.now());
        }
        entity.setUpdatedAt(Instant.now());
        return entity;
    }
}
```

Berguna untuk:

1. Default metadata.
2. Audit metadata ringan.
3. Normalisasi field.
4. Derived field sederhana.

Jangan gunakan callback untuk:

1. Business rule penting yang tidak terlihat.
2. External side effect.
3. Complex validation tersembunyi.
4. Security logic.
5. State transition.

Kenapa?

Karena callback bisa membuat mutation tersembunyi.

Top 1% engineer menjaga invariant utama tetap eksplisit di command handler/domain service/repository method.

---

## 28. Testing dengan Testcontainers

Untuk MongoDB repository, mocking `MongoTemplate` sering memberi false confidence.

Lebih baik integration test dengan MongoDB real via Testcontainers.

Dependency:

```xml
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>mongodb</artifactId>
    <scope>test</scope>
</dependency>
```

Contoh test:

```java
@Testcontainers
@SpringBootTest
class MongoCaseStoreTest {

    @Container
    static MongoDBContainer mongo = new MongoDBContainer("mongo:8.0");

    @DynamicPropertySource
    static void mongoProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", mongo::getReplicaSetUrl);
    }

    @Autowired
    MongoCaseStore caseStore;

    @Autowired
    MongoTemplate mongoTemplate;

    @Test
    void submitShouldTransitionOnlyFromDraftWithExpectedVersion() {
        // arrange
        CaseDocument doc = new CaseDocument(...);
        mongoTemplate.insert(doc, "cases");

        // act
        boolean updated = caseStore.submit(
            tenantId,
            caseId,
            CaseState.DRAFT,
            new Version(0),
            actor,
            Instant.parse("2026-01-01T00:00:00Z")
        );

        // assert
        assertThat(updated).isTrue();
        CaseDocument stored = mongoTemplate.findById(caseId.value(), CaseDocument.class, "cases");
        assertThat(stored.getState()).isEqualTo("SUBMITTED");
        assertThat(stored.getVersion()).isEqualTo(1);
    }
}
```

Test yang perlu dibuat:

1. Mapping round-trip.
2. Query returns correct result.
3. Projection tidak membaca field besar.
4. Conditional update conflict.
5. Optimistic locking failure.
6. Duplicate key handling.
7. Aggregation output.
8. Index existence expectation.
9. Migration/backward compatibility.
10. Transaction behavior jika dipakai.

Untuk transaksi, MongoDB biasanya butuh replica set. Testcontainers MongoDB dapat menyediakan replica set URL melalui method yang sesuai container version/library.

---

## 29. Index Verification Test

Index adalah bagian dari contract.

Buat test untuk memastikan index penting ada.

```java
@Test
void casesShouldHaveExpectedIndexes() {
    List<IndexInfo> indexes = mongoTemplate.indexOps("cases").getIndexInfo();

    assertThat(indexes)
        .anySatisfy(index -> {
            assertThat(index.getName()).isEqualTo("idx_tenant_status_created_id");
        });
}
```

Lebih baik lagi, cek keys:

```java
boolean found = indexes.stream().anyMatch(index ->
    index.getIndexFields().stream().map(IndexField::getKey).toList()
        .equals(List.of("tenantId", "status", "createdAt", "_id"))
);

assertThat(found).isTrue();
```

Kenapa ini penting?

Karena query correctness tanpa index bisa tetap lulus functional test, tetapi gagal production.

---

## 30. Explain Plan dalam Test atau Review Tool

Spring Data tidak otomatis membuatmu melihat explain plan.

Untuk query kritis, buat util atau manual review.

Dengan `MongoTemplate`, kamu bisa menjalankan command atau memakai native collection.

Pseudo-pattern:

```java
Document filter = new Document("tenantId", tenantId)
    .append("status", "OPEN");

Document command = new Document("explain",
    new Document("find", "cases")
        .append("filter", filter)
        .append("sort", new Document("createdAt", -1).append("_id", -1))
        .append("limit", 50)
);

Document explain = mongoTemplate.getDb().runCommand(command);
```

Yang direview:

1. Apakah menggunakan index yang diharapkan?
2. Apakah `COLLSCAN` muncul?
3. Berapa docs examined?
4. Berapa keys examined?
5. Apakah sort di-memory?
6. Apakah projection covered atau butuh fetch?

Untuk production-grade codebase, minimal query penting harus punya explain review dalam ADR/performance note.

---

## 31. Multi-Tenancy Guard di Spring Data

Salah satu bahaya repository method adalah lupa tenant filter.

Buruk:

```java
Optional<CaseDocument> findById(String id);
```

Dalam multi-tenant system, ini dangerous.

Lebih baik:

```java
Optional<CaseDocument> findByTenantIdAndId(String tenantId, String id);
```

Namun discipline manusia bisa gagal.

Untuk sistem serius:

1. Jangan expose repository generic ke service.
2. Buat `TenantScopedCaseStore`.
3. Semua method menerima `TenantId`.
4. Query builder wajib inject tenant criteria.
5. Test memastikan cross-tenant access impossible.

Contoh helper:

```java
public final class TenantCriteria {
    public static Criteria tenant(TenantId tenantId) {
        return Criteria.where("tenantId").is(tenantId.value());
    }
}
```

Use:

```java
Query query = new Query()
    .addCriteria(TenantCriteria.tenant(tenantId))
    .addCriteria(Criteria.where("_id").is(caseId.value()));
```

Untuk search:

```java
public Query buildCaseSearchQuery(TenantId tenantId, CaseSearchCriteria criteria) {
    Query query = new Query();
    query.addCriteria(TenantCriteria.tenant(tenantId));
    // add allowed filters only
    return query;
}
```

Rule:

```text
Tenant filter bukan optional query condition.
Tenant filter adalah security boundary.
```

---

## 32. Security Filter dan Authorization-Aware Query

Selain tenant, regulatory/case systems sering punya authorization dimension:

- assigned unit,
- region,
- role,
- confidentiality level,
- case classification,
- need-to-know access,
- legal hold team,
- supervisory hierarchy.

Jangan lakukan:

```java
List<CaseDocument> docs = repository.findByStatus("OPEN");
return docs.stream()
    .filter(doc -> authorizationService.canView(user, doc))
    .toList();
```

Ini buruk karena:

1. Mengambil data yang tidak perlu.
2. Bisa bocor lewat log/metrics/cache.
3. Pagination salah.
4. Count salah.
5. Performance buruk.
6. Security boundary terlambat.

Lebih baik authorization menjadi bagian query:

```java
Criteria authCriteria = new Criteria().orOperator(
    Criteria.where("assigneeId").is(user.id()),
    Criteria.where("permittedUnitIds").in(user.unitIds()),
    Criteria.where("visibility").is("PUBLIC_TO_UNIT")
);

Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(authCriteria)
    .addCriteria(Criteria.where("status").is("OPEN"));
```

Tetapi ini juga perlu index design.

Security model dan index model harus dibahas bersama.

---

## 33. Dynamic Search Criteria Pattern

Untuk search screen, jangan buat repository method untuk setiap kombinasi.

Buat criteria object:

```java
public record CaseSearchCriteria(
    Set<CaseState> states,
    Optional<String> assigneeId,
    Optional<String> regionCode,
    Optional<Instant> createdFrom,
    Optional<Instant> createdTo,
    Optional<Integer> minPriority
) {}
```

Builder:

```java
public Query build(TenantId tenantId, CaseSearchCriteria criteria, SeekPageRequest page) {
    Query query = new Query();

    query.addCriteria(Criteria.where("tenantId").is(tenantId.value()));

    if (!criteria.states().isEmpty()) {
        query.addCriteria(Criteria.where("state").in(
            criteria.states().stream().map(CaseState::code).toList()
        ));
    }

    criteria.assigneeId().ifPresent(value ->
        query.addCriteria(Criteria.where("assigneeId").is(value))
    );

    criteria.regionCode().ifPresent(value ->
        query.addCriteria(Criteria.where("regionCode").is(value))
    );

    if (criteria.createdFrom().isPresent() || criteria.createdTo().isPresent()) {
        Criteria created = Criteria.where("createdAt");
        criteria.createdFrom().ifPresent(created::gte);
        criteria.createdTo().ifPresent(created::lt);
        query.addCriteria(created);
    }

    criteria.minPriority().ifPresent(value ->
        query.addCriteria(Criteria.where("priority").gte(value))
    );

    query.with(page.sort());
    query.limit(page.limitPlusOne());

    return query;
}
```

Namun jangan jadikan semua filter bebas.

Buat supported query profile:

```text
Case Search Profile A:
tenantId + state + createdAt desc
index: {tenantId:1, state:1, createdAt:-1, _id:-1}

Case Search Profile B:
tenantId + assigneeId + state + priority desc
index: {tenantId:1, assigneeId:1, state:1, priority:-1, _id:-1}

Case Search Profile C:
tenantId + regionCode + createdAt desc
index: {tenantId:1, regionCode:1, createdAt:-1, _id:-1}
```

Query builder harus mengarahkan request ke profile yang didukung.

---

## 34. Validation of Query Contract

Public API search harus menolak kombinasi filter/sort yang tidak didukung.

Contoh:

```java
public void validate(CaseSearchCriteria criteria, CaseSortOption sort) {
    if (criteria.hasFreeText() && sort == CaseSortOption.PRIORITY_DESC) {
        throw new UnsupportedSearchCombinationException(
            "Free text search only supports relevance or createdAt sorting"
        );
    }

    if (criteria.hasRegionCode() && criteria.hasAssigneeId()) {
        throw new UnsupportedSearchCombinationException(
            "regionCode + assigneeId combination is not indexed"
        );
    }
}
```

Ini mungkin terasa membatasi.

Tetapi sistem production yang sehat lebih baik eksplisit:

```text
Bukan semua query yang bisa diekspresikan harus diizinkan.
Yang diizinkan adalah query yang benar, aman, dan terindeks.
```

---

## 35. Mapping Nested Documents

Embedded subdocument:

```java
public class PartySubDocument {
    private String partyId;
    private String type;
    private String name;
    private String role;
}
```

Parent:

```java
@Document("cases")
public class CaseDocument {
    @Id
    private String id;
    private String tenantId;
    private List<PartySubDocument> parties;
}
```

Query nested:

```java
Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("parties.partyId").is(partyId.value()));
```

Untuk array dengan multiple conditions pada same element, gunakan `$elemMatch` via Criteria:

```java
Criteria partyCriteria = Criteria.where("parties").elemMatch(
    Criteria.where("partyId").is(partyId.value())
        .and("role").is("RESPONDENT")
);

Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(partyCriteria);
```

Jangan lupa multikey index implication.

---

## 36. Bulk Operations

Spring Data mendukung bulk operations via `MongoTemplate`.

Contoh:

```java
BulkOperations bulk = mongoTemplate.bulkOps(
    BulkOperations.BulkMode.UNORDERED,
    CaseDocument.class,
    "cases"
);

for (CaseAssignment assignment : assignments) {
    Query query = new Query()
        .addCriteria(Criteria.where("tenantId").is(assignment.tenantId().value()))
        .addCriteria(Criteria.where("_id").is(assignment.caseId().value()))
        .addCriteria(Criteria.where("state").is("OPEN"));

    Update update = new Update()
        .set("assigneeId", assignment.assigneeId().value())
        .set("updatedAt", now)
        .inc("version", 1);

    bulk.updateOne(query, update);
}

BulkWriteResult result = bulk.execute();
```

Ordered vs unordered:

| Mode | Behavior |
|---|---|
| Ordered | stop/sequence-sensitive, lebih predictable, bisa lebih lambat |
| Unordered | lanjut walau ada failure tertentu, throughput lebih baik |

Bulk cocok untuk:

1. Backfill.
2. Batch assignment.
3. Migration.
4. Import.
5. Maintenance job.

Hati-hati:

1. Batch size.
2. Write concern.
3. Duplicate key handling.
4. Partial failure.
5. Retry idempotency.
6. Operational load.

---

## 37. Upsert dengan Spring Data: Powerful but Dangerous

Contoh upsert:

```java
Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
    .addCriteria(Criteria.where("caseNumber").is(caseNumber));

Update update = new Update()
    .set("status", "OPEN")
    .set("updatedAt", now)
    .setOnInsert("createdAt", now);

mongoTemplate.upsert(query, update, CaseDocument.class, "cases");
```

Upsert bagus untuk:

1. Idempotent creation.
2. Cache/materialized view update.
3. External sync record.
4. Configuration default.

Bahaya:

1. Query salah bisa insert record baru yang tidak diinginkan.
2. Missing unique index membuat duplicate logical entity.
3. `setOnInsert` sering dilupakan.
4. Business distinction create vs update bisa hilang.
5. Partial data bisa tercipta.

Rule:

```text
Upsert harus didukung unique key/index yang sesuai.
Jangan pakai upsert untuk menyembunyikan ketidakjelasan command semantics.
```

---

## 38. Handling Duplicate Key untuk Idempotency

Unique index:

```javascript
db.cases.createIndex(
  { tenantId: 1, commandId: 1 },
  { unique: true, name: "uq_tenant_command" }
)
```

Insert command record:

```java
try {
    mongoTemplate.insert(commandRecord, "processed_commands");
} catch (DuplicateKeyException e) {
    return CommandResult.alreadyProcessed();
}
```

Ini pattern penting untuk retry-safe command handling.

Dengan Spring Data, duplicate key exception bisa ditangkap sebagai Spring exception.

Pastikan:

1. Unique index benar.
2. Key mencakup tenant/scope.
3. Command ID dari caller atau generated deterministically.
4. Response idempotent bisa direkonstruksi.
5. Retention command record jelas.

---

## 39. Field Naming Strategy

Spring Data dapat memakai naming strategy, tetapi untuk production contract, explicit field name sering lebih baik.

Contoh:

```java
@Field("caseNumber")
private String caseNumber;
```

Field naming guideline:

1. Gunakan nama stabil.
2. Jangan rename tanpa migration.
3. Hindari nama terlalu panjang untuk field hot karena index/storage overhead.
4. Hindari abbreviation yang tidak jelas.
5. Konsisten camelCase atau snake_case.
6. Jangan tergantung nama Java property jika domain sering refactor.

Untuk regulatory systems, field name adalah bagian dari audit/data contract.

---

## 40. Object Mapping Pitfalls

Pitfall 1: No-arg constructor required/expected in beberapa konfigurasi.

Pitfall 2: Lombok menyembunyikan mutability.

```java
@Data
@Document("cases")
public class CaseDocument {
    // everything mutable
}
```

Untuk persistence DTO, mutable mungkin acceptable. Untuk domain model, hindari.

Pitfall 3: `Optional` sebagai field.

```java
private Optional<String> assigneeId; // usually bad as persisted field
```

Lebih baik:

```java
@Nullable
private String assigneeId;
```

atau explicit state modelling.

Pitfall 4: Default value tidak sama dengan missing field.

Jika field baru ditambahkan:

```java
private boolean urgent;
```

Data lama mungkin missing. Java default `false` dapat menyembunyikan perbedaan antara “not urgent” dan “unknown because old schema”.

Untuk schema evolution, pertimbangkan:

```java
private Boolean urgent;
```

atau reader migration:

```java
boolean isUrgent() {
    return Boolean.TRUE.equals(urgent);
}
```

Pitfall 5: Recursive object graph.

Document mapping tidak cocok untuk arbitrary cyclic graph.

---

## 41. Spring Data Events vs Domain Events

Spring Data event:

```text
BeforeConvert
BeforeSave
AfterSave
AfterLoad
AfterConvert
```

Domain event:

```text
CaseSubmitted
CaseAssigned
EvidenceAdded
DecisionApproved
```

Jangan campur.

Spring Data event adalah persistence lifecycle.
Domain event adalah business fact.

Buruk:

```java
@EventListener
public void afterSave(AfterSaveEvent<CaseDocument> event) {
    kafka.send("case-submitted", ...); // too implicit and broad
}
```

Lebih baik:

1. Command handler menghasilkan domain event.
2. Store aggregate + outbox dalam transaction jika perlu.
3. Publisher memproses outbox.
4. Persistence callback hanya untuk persistence concern kecil.

---

## 42. Mixing Spring Data and Native Driver

Kadang Spring Data belum menutup feature tertentu atau kamu perlu command-level control.

Kamu bisa memakai native driver dari `MongoTemplate`:

```java
MongoCollection<Document> collection = mongoTemplate
    .getCollection("cases");
```

Atau:

```java
Document result = mongoTemplate.getDb().runCommand(command);
```

Ini acceptable jika:

1. Dibungkus dalam repository/adapter.
2. Tidak menyebar ke service layer.
3. Mapping output jelas.
4. Error handling konsisten.
5. Test integration ada.

Jangan biarkan codebase punya tiga style random:

- sebagian repository derived,
- sebagian `MongoTemplate`,
- sebagian native driver,
- tanpa aturan.

Buat policy:

```text
Simple lookup       -> repository method allowed
Dynamic query       -> MongoTemplate
State mutation      -> MongoTemplate conditional update
Complex aggregation -> MongoTemplate aggregation builder/native if needed
Low-level command   -> native driver wrapped in adapter
```

---

## 43. Suggested Package Structure

Contoh struktur untuk service kompleks:

```text
com.example.cases
  application
    CaseCommandService.java
    CaseQueryService.java
  domain
    CaseAggregate.java
    CaseState.java
    CaseId.java
    CaseTransition.java
  persistence
    mongo
      CaseDocument.java
      PartySubDocument.java
      TransitionDocument.java
      MongoCaseStore.java
      MongoCaseQueryRepository.java
      CaseMapper.java
      CaseSearchQueryBuilder.java
      CaseIndexes.java
      CaseAggregations.java
  api
    CaseController.java
    CaseResponse.java
    CaseSearchRequest.java
```

Principle:

```text
Spring Data annotations tinggal di persistence package,
bukan menyebar ke domain core.
```

Untuk modul kecil, struktur bisa lebih sederhana.
Tetapi jangan mengorbankan boundary untuk aggregate penting.

---

## 44. Practical Pattern: Command Store vs Query Store

Untuk case management:

Command store:

```java
public interface CaseCommandStore {
    Optional<CaseAggregate> findForUpdate(TenantId tenantId, CaseId caseId);

    boolean transition(
        TenantId tenantId,
        CaseId caseId,
        CaseState expected,
        CaseState next,
        Version expectedVersion,
        TransitionDocument transition
    );
}
```

Query store:

```java
public interface CaseQueryStore {
    Slice<CaseSummary> search(TenantId tenantId, CaseSearchCriteria criteria, SeekPageRequest page);

    Optional<CaseDetailView> findDetail(TenantId tenantId, CaseId caseId, Actor actor);

    DashboardSummary dashboard(TenantId tenantId, DashboardCriteria criteria);
}
```

Command side cares about:

- invariant,
- concurrency,
- state transition,
- atomic mutation.

Query side cares about:

- projection,
- filtering,
- authorization,
- pagination,
- index shape.

Spring Data can support both, but through different implementation style.

---

## 45. Practical Pattern: Custom Repository Implementation

Spring Data allows custom repository fragments.

Base repository:

```java
public interface CaseRepository
        extends MongoRepository<CaseDocument, String>, CaseRepositoryCustom {

    Optional<CaseDocument> findByTenantIdAndId(String tenantId, String id);
}
```

Custom interface:

```java
public interface CaseRepositoryCustom {
    Slice<CaseSummaryDocument> searchCases(
        TenantId tenantId,
        CaseSearchCriteria criteria,
        SeekPageRequest page
    );

    boolean transitionState(
        TenantId tenantId,
        CaseId caseId,
        CaseState expected,
        CaseState next,
        Version version,
        TransitionDocument transition
    );
}
```

Implementation:

```java
public class CaseRepositoryImpl implements CaseRepositoryCustom {

    private final MongoTemplate mongoTemplate;

    public CaseRepositoryImpl(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @Override
    public Slice<CaseSummaryDocument> searchCases(...) {
        Query query = CaseSearchQueryBuilder.build(...);
        List<CaseSummaryDocument> docs = mongoTemplate.find(query, CaseSummaryDocument.class, "cases");
        return SliceFactory.fromLimitPlusOne(docs, page.limit());
    }

    @Override
    public boolean transitionState(...) {
        Query query = ...;
        Update update = ...;
        return mongoTemplate.updateFirst(query, update, CaseDocument.class, "cases")
            .getMatchedCount() == 1;
    }
}
```

Ini memberi kombinasi:

- simple CRUD dari repository,
- operasi kompleks explicit via `MongoTemplate`.

---

## 46. Practical Pattern: Read Model Projection Class

Jangan selalu reuse `CaseDocument` untuk response.

```java
public record CaseSummaryDocument(
    String id,
    String caseNumber,
    String state,
    String assigneeId,
    Instant createdAt,
    Instant updatedAt
) {}
```

Query:

```java
query.fields()
    .include("_id")
    .include("caseNumber")
    .include("state")
    .include("assigneeId")
    .include("createdAt")
    .include("updatedAt");

List<CaseSummaryDocument> docs = mongoTemplate.find(
    query,
    CaseSummaryDocument.class,
    "cases"
);
```

Keuntungan:

1. Response tidak tergantung full document.
2. Projection eksplisit.
3. Menghindari accidental data exposure.
4. Mengurangi network/deserialization cost.
5. Lebih mudah mengoptimalkan list screen.

---

## 47. Production Checklist untuk Spring Data MongoDB

Sebelum production, jawab pertanyaan ini:

### Modelling

1. Apakah `@Document` mengikuti aggregate boundary, bukan class-per-table mindset?
2. Apakah embedded/reference decision sudah didokumentasikan?
3. Apakah schema versioning diperlukan?
4. Apakah field naming stabil?
5. Apakah domain model perlu dipisah dari persistence document?

### Query

1. Apakah semua query utama punya index?
2. Apakah query shape terdokumentasi?
3. Apakah dynamic search dibatasi?
4. Apakah pagination memakai seek untuk dataset besar?
5. Apakah sort option dikendalikan?
6. Apakah projection digunakan untuk list/summary?

### Mutation

1. Apakah `save()` dipakai hanya untuk kasus tepat?
2. Apakah state transition memakai conditional update?
3. Apakah optimistic concurrency diterapkan?
4. Apakah retry idempotent?
5. Apakah duplicate key ditangani benar?

### Transaction

1. Apakah transaksi benar-benar perlu?
2. Apakah transaction scope pendek?
3. Apakah tidak ada external call dalam transaction?
4. Apakah retry/unknown commit ditangani?

### Security

1. Apakah tenant filter wajib di semua query?
2. Apakah authorization filter masuk database query?
3. Apakah sensitive field tidak terprojection sembarangan?
4. Apakah DB user least privilege?

### Testing

1. Apakah repository diuji dengan MongoDB real/Testcontainers?
2. Apakah index existence diuji?
3. Apakah aggregation diuji dengan sample data?
4. Apakah concurrency conflict diuji?
5. Apakah schema evolution diuji?

### Operations

1. Apakah timeout/pool dikonfigurasi sadar?
2. Apakah slow query visible?
3. Apakah driver metrics tersedia?
4. Apakah logs tidak membocorkan data sensitif?
5. Apakah index migration punya runbook?

---

## 48. Anti-Pattern Catalogue

### Anti-pattern 1: Repository Method Explosion

Gejala:

```java
findByTenantIdAndStatusAndRegionAndPriorityAndAssigneeAndCreatedAtBetween...
```

Penyebab:

- dynamic search dipaksakan menjadi method name.

Solusi:

- criteria object + query builder + supported search profiles.

---

### Anti-pattern 2: `save()` untuk Semua Mutation

Gejala:

```java
var doc = repository.findById(id).orElseThrow();
doc.setState("APPROVED");
repository.save(doc);
```

Penyebab:

- JPA-style unit-of-work mindset.

Solusi:

- conditional update dengan expected state/version.

---

### Anti-pattern 3: `@DBRef` sebagai Relationship Default

Gejala:

```java
@DBRef
private List<TaskDocument> tasks;
```

Penyebab:

- ORM graph mindset.

Solusi:

- explicit ID reference, embedded subset, or separate query model.

---

### Anti-pattern 4: Exposing `MongoRepository` Directly to Service

Gejala:

- Service bebas call `findAll`, `save`, `delete`.

Penyebab:

- tidak ada domain-specific persistence boundary.

Solusi:

- application-owned repository interface.

---

### Anti-pattern 5: Pageable Everywhere

Gejala:

```java
Page<CaseDocument> findByTenantId(..., Pageable pageable)
```

untuk dataset besar.

Penyebab:

- convenience Spring Data.

Solusi:

- seek pagination + controlled sort + limit+1.

---

### Anti-pattern 6: Index Annotation as Production Migration Strategy

Gejala:

- semua index dibuat otomatis saat startup.

Penyebab:

- lifecycle index dianggap seperti annotation metadata.

Solusi:

- index migration/runbook untuk production.

---

### Anti-pattern 7: Business Rule in Persistence Callback

Gejala:

- state transition atau authorization terjadi di `BeforeSaveCallback`.

Penyebab:

- ingin “centralize” logic tapi malah menyembunyikan invariant.

Solusi:

- command/domain layer eksplisit.

---

### Anti-pattern 8: Full Document for List Page

Gejala:

- list API membaca full case document dengan audit/evidence besar.

Penyebab:

- repository default mapping.

Solusi:

- projection/read model.

---

### Anti-pattern 9: Tenant Filter Optional

Gejala:

```java
findById(id)
```

pada multi-tenant app.

Penyebab:

- ID dianggap globally safe.

Solusi:

- semua query tenant-scoped; index tenant-first jika sesuai access pattern.

---

### Anti-pattern 10: Mocking MongoTemplate Too Much

Gejala:

- test hanya verify method call, tidak membuktikan query benar.

Penyebab:

- unit-test obsession.

Solusi:

- integration test dengan Testcontainers.

---

## 49. Decision Matrix: Repository vs Template vs Native Driver

| Kebutuhan | Pilihan Umum | Catatan |
|---|---|---|
| Simple CRUD config | `MongoRepository` | Query kecil dan stabil |
| Equality lookup | derived query | Pastikan index |
| Dynamic search | `MongoTemplate` | Criteria builder eksplisit |
| State transition | `MongoTemplate` | Conditional update |
| Partial update | `MongoTemplate` | Update operator |
| Aggregation | `MongoTemplate` aggregation | Builder/test/explain |
| Complex native command | Native driver via adapter | Bungkus rapi |
| Transactions | Spring transaction + MongoTemplate/repository | Scope pendek |
| Change streams | Native driver or Spring support depending style | Perlu resume/idempotency |
| Reactive stack | Reactive template/repository | End-to-end reactive only |

---

## 50. Worked Example: Case Search Repository

### Requirement

Search open cases for a tenant with optional assignee, created range, and seek pagination. Return summary only.

### Supported Sort

```java
public enum CaseSortOption {
    CREATED_AT_DESC
}
```

### Index

```javascript
db.cases.createIndex(
  { tenantId: 1, state: 1, assigneeId: 1, createdAt: -1, _id: -1 },
  { name: "idx_case_search_open_assignee_created" }
)
```

### Criteria

```java
public record CaseSearchCriteria(
    Optional<String> assigneeId,
    Optional<Instant> createdFrom,
    Optional<Instant> createdTo
) {}
```

### Page Request

```java
public record SeekPageRequest(
    int limit,
    Optional<CaseCursor> cursor
) {
    public int limitPlusOne() {
        return limit + 1;
    }
}

public record CaseCursor(
    Instant createdAt,
    String id
) {}
```

### Query Builder

```java
public final class CaseSearchQueryBuilder {

    public static Query build(
        TenantId tenantId,
        CaseSearchCriteria criteria,
        SeekPageRequest page
    ) {
        Query query = new Query();

        query.addCriteria(Criteria.where("tenantId").is(tenantId.value()));
        query.addCriteria(Criteria.where("state").is("OPEN"));

        criteria.assigneeId().ifPresent(assignee ->
            query.addCriteria(Criteria.where("assigneeId").is(assignee))
        );

        if (criteria.createdFrom().isPresent() || criteria.createdTo().isPresent()) {
            Criteria created = Criteria.where("createdAt");
            criteria.createdFrom().ifPresent(created::gte);
            criteria.createdTo().ifPresent(created::lt);
            query.addCriteria(created);
        }

        page.cursor().ifPresent(cursor -> query.addCriteria(seek(cursor)));

        query.with(Sort.by(
            Sort.Order.desc("createdAt"),
            Sort.Order.desc("_id")
        ));

        query.limit(page.limitPlusOne());

        query.fields()
            .include("_id")
            .include("caseNumber")
            .include("state")
            .include("assigneeId")
            .include("createdAt")
            .include("priority");

        return query;
    }

    private static Criteria seek(CaseCursor cursor) {
        return new Criteria().orOperator(
            Criteria.where("createdAt").lt(cursor.createdAt()),
            new Criteria().andOperator(
                Criteria.where("createdAt").is(cursor.createdAt()),
                Criteria.where("_id").lt(cursor.id())
            )
        );
    }
}
```

### Store Implementation

```java
@Repository
public class MongoCaseQueryStore implements CaseQueryStore {

    private final MongoTemplate mongoTemplate;

    public MongoCaseQueryStore(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @Override
    public Slice<CaseSummary> searchOpenCases(
        TenantId tenantId,
        CaseSearchCriteria criteria,
        SeekPageRequest page
    ) {
        Query query = CaseSearchQueryBuilder.build(tenantId, criteria, page);

        List<CaseSummaryDocument> docs = mongoTemplate.find(
            query,
            CaseSummaryDocument.class,
            "cases"
        );

        return SliceMapper.toSlice(docs, page.limit(), this::toSummary);
    }
}
```

### Why This Is Better than Derived Query

1. Tenant filter explicit.
2. State fixed to supported access pattern.
3. Projection explicit.
4. Sort stable.
5. Seek pagination scalable.
6. Index can be reviewed.
7. Cursor logic visible.
8. Query can be tested.
9. No arbitrary sort/filter combinations.

---

## 51. Worked Example: State Transition with Spring Data

### Requirement

Move case from `SUBMITTED` to `UNDER_REVIEW` only if:

1. tenant matches,
2. case ID matches,
3. current state is `SUBMITTED`,
4. version matches,
5. transition history appended atomically.

### Implementation

```java
@Repository
public class MongoCaseCommandStore implements CaseCommandStore {

    private final MongoTemplate mongoTemplate;

    public MongoCaseCommandStore(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @Override
    public TransitionResult startReview(
        TenantId tenantId,
        CaseId caseId,
        Version expectedVersion,
        Actor actor,
        Instant now,
        CorrelationId correlationId
    ) {
        Query query = new Query()
            .addCriteria(Criteria.where("tenantId").is(tenantId.value()))
            .addCriteria(Criteria.where("_id").is(caseId.value()))
            .addCriteria(Criteria.where("state").is("SUBMITTED"))
            .addCriteria(Criteria.where("version").is(expectedVersion.value()));

        TransitionDocument transition = new TransitionDocument(
            "START_REVIEW",
            "SUBMITTED",
            "UNDER_REVIEW",
            actor.id(),
            now,
            correlationId.value()
        );

        Update update = new Update()
            .set("state", "UNDER_REVIEW")
            .set("review.startedAt", now)
            .set("review.reviewerId", actor.id())
            .set("updatedAt", now)
            .inc("version", 1)
            .push("transitions", transition);

        UpdateResult result = mongoTemplate.updateFirst(
            query,
            update,
            CaseDocument.class,
            "cases"
        );

        if (result.getMatchedCount() == 1) {
            return TransitionResult.applied();
        }

        return TransitionResult.conflictOrNotFound();
    }
}
```

Ini adalah Spring Data MongoDB yang sehat:

- abstraction membantu syntax,
- invariant tetap eksplisit,
- MongoDB semantics tetap terlihat.

---

## 52. Worked Example: Custom Converter for Money

Domain:

```java
public record Money(BigDecimal amount, String currency) {
    public Money {
        if (amount == null) throw new IllegalArgumentException("amount required");
        if (currency == null || currency.isBlank()) throw new IllegalArgumentException("currency required");
    }
}
```

BSON shape:

```json
{
  "amount": { "$numberDecimal": "1250.50" },
  "currency": "USD"
}
```

Converters:

```java
@WritingConverter
public class MoneyWriteConverter implements Converter<Money, Document> {
    @Override
    public Document convert(Money source) {
        return new Document("amount", new Decimal128(source.amount()))
            .append("currency", source.currency());
    }
}
```

```java
@ReadingConverter
public class MoneyReadConverter implements Converter<Document, Money> {
    @Override
    public Money convert(Document source) {
        Decimal128 amount = source.get("amount", Decimal128.class);
        String currency = source.getString("currency");
        return new Money(amount.bigDecimalValue(), currency);
    }
}
```

Register:

```java
@Bean
MongoCustomConversions customConversions() {
    return new MongoCustomConversions(List.of(
        new MoneyWriteConverter(),
        new MoneyReadConverter()
    ));
}
```

Test:

```java
@Test
void moneyShouldRoundTrip() {
    PaymentDocument payment = new PaymentDocument(
        "p1",
        new Money(new BigDecimal("1250.50"), "USD")
    );

    mongoTemplate.insert(payment, "payments");
    PaymentDocument loaded = mongoTemplate.findById("p1", PaymentDocument.class, "payments");

    assertThat(loaded.amount()).isEqualTo(payment.amount());
}
```

---

## 53. Spring Data MongoDB in Architecture Review

Saat mereview desain yang memakai Spring Data MongoDB, jangan hanya tanya:

```text
Apakah CRUD sudah jalan?
```

Tanya:

1. Apa aggregate boundary collection ini?
2. Query utama apa saja?
3. Index apa yang mendukung setiap query?
4. Apakah repository method menyembunyikan query terlalu kompleks?
5. Apakah update menggunakan `save()` atau operator?
6. Bagaimana concurrency conflict ditangani?
7. Apakah tenant/security filter wajib?
8. Apakah projection menghindari full document read?
9. Apakah pagination scalable?
10. Apakah transaction dipakai karena perlu atau karena kebiasaan?
11. Apakah schema evolution aman untuk rolling deployment?
12. Apakah query sudah diuji dengan data realistis?
13. Apakah explain plan pernah direview?
14. Apakah index lifecycle aman di production?
15. Apakah Spring abstraction membuat behavior database tidak terlihat?

---

## 54. Mental Model Akhir

Spring Data MongoDB adalah tool produktivitas.

Ia membantu kamu:

- mengurangi boilerplate,
- mapping object-document,
- membuat query sederhana,
- menulis aggregation lebih terstruktur,
- memakai Spring transaction,
- testing dengan ekosistem Spring,
- mengintegrasikan MongoDB ke aplikasi Java modern.

Tetapi Spring Data tidak menggantikan:

- data modelling,
- index design,
- query planning,
- concurrency modelling,
- consistency decision,
- migration strategy,
- operational observability,
- security boundary.

Kalimat kuncinya:

```text
Spring Data MongoDB should reduce accidental complexity,
not hide essential MongoDB design decisions.
```

Engineer biasa berhenti di:

```java
extends MongoRepository<Entity, String>
```

Engineer senior bertanya:

```text
Apa access pattern-nya?
Apa index-nya?
Apa mutation invariant-nya?
Apa concurrency guard-nya?
Apa projection-nya?
Apa failure behavior-nya?
```

Top 1% engineer memakai Spring Data sebagai adapter yang disiplin, bukan sebagai magic persistence layer.

---

## 55. Ringkasan

Di bagian ini kita membahas:

1. Posisi Spring Data MongoDB dalam stack Java.
2. Kapan menggunakan repository, template, native driver, dan reactive API.
3. Bahaya membawa JPA mindset ke MongoDB.
4. Mapping dengan `@Document`, `@Id`, `@Field`, dan `@Version`.
5. Pemisahan domain model dan persistence document.
6. Kapan query method cukup dan kapan harus dihindari.
7. Penggunaan `MongoTemplate` untuk query, projection, update, dan aggregation.
8. Pagination dan sort yang aman untuk dataset besar.
9. Optimistic locking dan conditional update.
10. Auditing vs audit trail.
11. Custom converters untuk value object.
12. Index management dengan annotation maupun migration.
13. Transactions dan batasannya.
14. Reactive Spring Data MongoDB.
15. Error handling dan duplicate key/idempotency.
16. Anti-pattern Spring Data MongoDB.
17. Worked examples untuk case search, state transition, dan custom converter.

---

## 56. Koneksi ke Part Berikutnya

Part ini menutup blok integrasi Java/Spring dasar.

Berikutnya kita masuk ke performance engineering.

Spring Data membuat query mudah ditulis. Tetapi performa MongoDB tetap ditentukan oleh:

- working set,
- index residency,
- query selectivity,
- document size,
- projection,
- pagination,
- write amplification,
- connection pool,
- slow query diagnostics,
- profiler,
- explain plan,
- realistic load testing.

Itu akan dibahas di:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-018.md
```

Dengan judul:

```text
Part 018 — Performance Engineering I: Query, Index, Memory, Working Set
```

---

## 57. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 017
Belum:   Part 018 sampai Part 035
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-018.md">Part 018 — Performance Engineering I: Query, Index, Memory, Working Set ➡️</a>
</div>
