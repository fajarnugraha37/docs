# Part 20 — Merge, Detach, DTO Mapping, and API Boundary Safety

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `20-merge-detach-dto-mapping-api-boundary-safety.md`  
> Scope Java: 8–25  
> Scope API: JPA 2.1/2.2 `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`  
> Provider focus: Hibernate ORM 5/6/7, EclipseLink 2/3/4

---

## 0. Posisi Materi Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membangun fondasi ORM dari beberapa sisi:

1. entity identity,
2. persistence context,
3. dirty checking,
4. flush,
5. SQL generation,
6. mapping,
7. association,
8. collection,
9. cascade,
10. fetch plan,
11. query,
12. bulk mutation,
13. transaction,
14. concurrency control.

Bagian ini menghubungkan semuanya ke satu area yang sering menjadi sumber bug aplikasi enterprise modern:

> **bagaimana state dari luar aplikasi — HTTP request, message queue, import file, UI form, API payload — masuk ke persistence layer tanpa merusak aggregate, tanpa menimpa data yang tidak seharusnya, tanpa bypass authorization, dan tanpa menghasilkan update/delete yang tidak disengaja.**

Topik utamanya adalah:

- `detach`,
- `merge`,
- DTO,
- API boundary,
- partial update,
- command object,
- stale object,
- mass assignment,
- collection replacement,
- provider-specific merge behavior,
- safe update pattern untuk production.

Ini bukan materi “cara pakai DTO” biasa. Ini adalah materi tentang **state boundary safety**.

---

## 1. Masalah Besarnya: Aplikasi Modern Tidak Hidup di Dalam Persistence Context

ORM seperti Hibernate/EclipseLink bekerja paling natural saat semua perubahan terjadi pada entity managed di dalam persistence context aktif:

```java
@Transactional
public void approveCase(Long caseId, String officerId) {
    CaseEntity c = em.find(CaseEntity.class, caseId);
    c.approveBy(officerId);
}
```

Kode ini terlihat sederhana karena:

1. entity di-load dalam transaction,
2. entity menjadi managed,
3. method domain mengubah state,
4. dirty checking mendeteksi perubahan,
5. flush menghasilkan SQL update.

Masalahnya, sistem nyata sering bekerja seperti ini:

```text
Browser / mobile / external system
        |
        | JSON payload
        v
Controller / API endpoint
        |
        | DTO / request object
        v
Service boundary
        |
        | load entity? merge entity? map DTO?
        v
ORM persistence context
        |
        | SQL
        v
Database
```

State dari luar aplikasi bukan entity managed. Ia hanyalah data yang datang dari boundary:

- JSON request,
- form submit,
- CSV import,
- Kafka/RabbitMQ message,
- batch file,
- integration callback,
- external system payload,
- admin UI,
- public API.

Kesalahan umum adalah memperlakukan payload dari luar seolah-olah ia adalah entity yang aman:

```java
@PostMapping("/cases/{id}")
@Transactional
public void update(@PathVariable Long id, @RequestBody CaseEntity requestEntity) {
    requestEntity.setId(id);
    em.merge(requestEntity);
}
```

Secara teknis bisa berjalan. Secara engineering, ini sangat berbahaya.

Kenapa?

Karena `merge()` bukan “apply user intent”. `merge()` adalah operasi **copy state dari object detached/new ke managed instance** berdasarkan aturan provider dan cascade.

Ia tidak tahu:

- field mana yang user berniat ubah,
- field mana yang tidak dikirim karena UI tidak menampilkannya,
- field mana yang tidak boleh diubah user,
- collection mana yang hanya partial view,
- association mana yang harus divalidasi,
- apakah request stale,
- apakah null berarti clear atau “not provided”,
- apakah perubahan state legal menurut workflow,
- apakah user punya authorization untuk setiap field.

Jadi mental model pertama:

> **Persistence provider hanya tahu state. Ia tidak tahu intent. API boundary harus menerjemahkan intent sebelum menyentuh entity.**

---

## 2. Terminologi Penting

### 2.1 Managed Entity

Entity yang sedang berada di dalam persistence context aktif.

```java
CaseEntity c = em.find(CaseEntity.class, id); // managed
c.setStatus(APPROVED);                       // dirty checked
```

Perubahan pada managed entity akan disinkronkan saat flush.

---

### 2.2 Detached Entity

Entity yang pernah managed, tetapi persistence context-nya sudah selesai atau entity dilepas.

```java
CaseEntity c;

try (EntityManager em = emf.createEntityManager()) {
    c = em.find(CaseEntity.class, id); // managed
}

// di sini c detached
c.setTitle("Changed outside persistence context");
```

Detached entity punya identity dan state, tetapi provider tidak lagi tracking perubahannya.

---

### 2.3 DTO

DTO adalah object boundary, bukan persistence object.

```java
public record UpdateCaseTitleRequest(
    String title,
    Long version
) {}
```

DTO digunakan untuk menyatakan **contract input/output**, bukan database mapping.

---

### 2.4 Command Object

Command object lebih sempit daripada DTO. Ia merepresentasikan niat operasi.

```java
public record ApproveCaseCommand(
    Long caseId,
    Long expectedVersion,
    String officerId,
    String remarks
) {}
```

Command object biasanya lebih aman daripada generic update DTO karena domain intent-nya eksplisit.

---

### 2.5 Merge

Menurut Jakarta Persistence API, `merge()` menyalin state entity baru atau detached ke persistence context dan mengembalikan managed instance. Managed instance yang dikembalikan dapat memiliki Java object identity yang berbeda dari object input. Artinya, object yang dipassing ke `merge()` tidak otomatis menjadi managed. Referensi resmi API Jakarta Persistence menjelaskan bahwa `merge()` mengembalikan managed instance dengan persistent state yang sama, tetapi bisa merupakan object Java yang berbeda dari argument-nya. Lihat Jakarta Persistence `EntityManager.merge` API.  
Reference: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager

Mental model:

```text
input detached object
        |
        | merge copies state
        v
managed object inside persistence context
        |
        | dirty checking / flush
        v
SQL
```

Bukan:

```text
input detached object becomes managed
```

---

## 3. Kenapa `merge()` Sering Disalahpahami

Banyak developer menganggap `merge()` berarti:

> “update row ini dengan data dari object ini.”

Padahal lebih tepat:

> “ambil state dari object ini, cari/buat managed instance dengan identity yang sama, copy state ke managed instance itu, lalu biarkan flush menentukan SQL.”

Konsekuensinya besar.

Contoh:

```java
CaseEntity detached = new CaseEntity();
detached.setId(100L);
detached.setTitle("New title");

CaseEntity managed = em.merge(detached);
```

Yang aman digunakan setelah itu adalah `managed`, bukan `detached`.

```java
managed.setDescription("More changes");  // tracked

detached.setDescription("Ignored later"); // not tracked, unless merge called again
```

Bug umum:

```java
CaseEntity c = em.merge(detached);
detached.setStatus(APPROVED); // developer kira ini ikut tersimpan
```

Tidak. Yang managed adalah return value.

---

## 4. Lifecycle State Refresher

```text
new/transient
    |
    | persist
    v
managed  <---------------------+
    |                           |
    | detach / close / clear    | merge copies state
    v                           |
detached -----------------------+

managed
    |
    | remove
    v
removed
```

Operasi penting:

| Operation | Input | Efek |
|---|---|---|
| `persist(x)` | transient | membuat x managed, insert saat flush |
| `merge(x)` | transient/detached | copy state ke managed instance, return managed instance |
| `detach(x)` | managed | x keluar dari persistence context |
| `clear()` | persistence context | semua managed entity menjadi detached |
| `refresh(x)` | managed | reload dari database, overwrite in-memory state |
| `remove(x)` | managed | mark deleted |

Kesalahan umum:

```java
em.persist(detachedEntity);
```

Untuk detached entity, ini biasanya menghasilkan exception seperti “detached entity passed to persist” pada Hibernate, karena `persist` dimaksudkan untuk object baru, bukan object existing detached.

---

## 5. Merge Step-by-Step: Apa yang Sebenarnya Terjadi

Misalkan kita punya entity:

```java
@Entity
@Table(name = "cases")
public class CaseEntity {
    @Id
    private Long id;

    @Version
    private Long version;

    private String title;
    private String status;
    private String assignedOfficerId;
    private String internalRiskNote;

    // getters/setters
}
```

Dan request:

```json
{
  "id": 100,
  "version": 5,
  "title": "Updated title"
}
```

Kalau JSON langsung di-bind ke entity:

```java
CaseEntity detached = objectMapper.readValue(json, CaseEntity.class);
CaseEntity managed = em.merge(detached);
```

Kemungkinan state detached:

```text
id = 100
version = 5
title = "Updated title"
status = null
assignedOfficerId = null
internalRiskNote = null
```

Jika `merge()` copy semua state scalar, maka field-field yang tidak ada di JSON bisa dianggap null.

Akibatnya SQL bisa menjadi:

```sql
update cases
set title = ?,
    status = ?,
    assigned_officer_id = ?,
    internal_risk_note = ?,
    version = ?
where id = ?
  and version = ?
```

Dengan nilai:

```text
title = Updated title
status = null
assigned_officer_id = null
internal_risk_note = null
```

Itu bukan partial update. Itu full state overwrite.

Jadi rule penting:

> **Entity merge cocok untuk state graph lengkap yang dipercaya, bukan untuk partial API payload yang tidak lengkap dan tidak dipercaya.**

---

## 6. Managed Update Pattern vs Detached Merge Pattern

### 6.1 Detached Merge Pattern

```java
@Transactional
public CaseEntity update(CaseEntity incoming) {
    return em.merge(incoming);
}
```

Karakteristik:

- cepat ditulis,
- berbahaya untuk API,
- sulit membedakan missing vs null,
- rawan overwrite,
- rawan collection replacement,
- rawan mass assignment,
- rawan stale data,
- rawan cascade merge storm.

---

### 6.2 Managed Update Pattern

```java
@Transactional
public void updateTitle(Long caseId, UpdateCaseTitleRequest request) {
    CaseEntity c = em.find(CaseEntity.class, caseId, LockModeType.OPTIMISTIC);
    if (c == null) {
        throw new NotFoundException("Case not found");
    }

    c.changeTitle(request.title());
}
```

Karakteristik:

- entity di-load dulu,
- perubahan dilakukan pada managed entity,
- field yang berubah eksplisit,
- authorization bisa dicek per operation,
- invariant domain bisa dipanggil,
- version bisa diverifikasi,
- collection bisa dimutasi dengan helper method,
- audit lebih jelas.

Untuk API biasa, ini jauh lebih aman.

---

## 7. Top 1% Rule: Do Not Let External Payload Become Your Persistence Model

Boundary buruk:

```java
@PutMapping("/users/{id}")
public void update(@PathVariable Long id, @RequestBody UserEntity user) {
    user.setId(id);
    userService.save(user);
}
```

Boundary lebih baik:

```java
public record UpdateUserProfileRequest(
    String displayName,
    String phoneNumber,
    Long expectedVersion
) {}
```

```java
@Transactional
public void updateProfile(Long userId, UpdateUserProfileRequest request, Actor actor) {
    User user = userRepository.get(userId);

    authorization.checkCanUpdateProfile(actor, user);

    user.updateProfile(
        request.displayName(),
        request.phoneNumber(),
        request.expectedVersion()
    );
}
```

Boundary sangat baik:

```java
public record ChangeUserPhoneNumberCommand(
    Long userId,
    String newPhoneNumber,
    Long expectedVersion,
    Actor actor
) {}
```

```java
@Transactional
public void handle(ChangeUserPhoneNumberCommand command) {
    User user = userRepository.get(command.userId());
    policy.requireCanChangePhone(command.actor(), user);
    user.changePhoneNumber(command.newPhoneNumber(), command.expectedVersion());
}
```

Perbedaannya bukan style. Perbedaannya adalah **kontrol atas intent**.

---

## 8. PUT, PATCH, Command, dan Semantik Null

### 8.1 PUT

Secara konsep REST, PUT sering dimaknai sebagai replacement representasi resource.

Kalau API kamu benar-benar menerima full representation, maka missing field bisa dianggap remove/null/default.

Contoh:

```json
{
  "title": "Case title",
  "description": "Full description",
  "priority": "HIGH",
  "assignedOfficerId": "A001"
}
```

Tapi banyak API memakai PUT seolah partial update. Ini sumber bug.

---

### 8.2 PATCH

PATCH lebih cocok untuk partial update.

Namun PATCH juga harus jelas:

Apakah:

```json
{
  "description": null
}
```

berarti:

1. hapus description, atau
2. field tidak diberikan, atau
3. invalid?

JSON tidak cukup sendiri untuk membedakan missing field dan explicit null jika langsung bind ke POJO biasa.

---

### 8.3 Null-as-Clear vs Null-as-Not-Provided

Ini critical.

DTO biasa:

```java
public class UpdateCaseRequest {
    public String title;
    public String description;
}
```

Tidak bisa membedakan:

```json
{}
```

vs

```json
{"description": null}
```

Keduanya menjadi:

```text
title = null
description = null
```

Solusi:

#### Option A — Separate command per operation

```java
public record ClearCaseDescriptionCommand(Long caseId, Long expectedVersion) {}
public record ChangeCaseDescriptionCommand(Long caseId, String description, Long expectedVersion) {}
```

Paling aman untuk domain penting.

#### Option B — JSON Merge Patch / JsonNode

```java
public void patchCase(Long id, JsonNode patch) {
    if (patch.has("description")) {
        JsonNode node = patch.get("description");
        if (node.isNull()) {
            entity.clearDescription();
        } else {
            entity.changeDescription(node.asText());
        }
    }
}
```

#### Option C — Optional wrapper with presence tracking

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;
}
```

Dengan custom deserializer.

---

## 9. Mass Assignment: Security Bug yang Sering Masuk Lewat ORM

Mass assignment terjadi saat client dapat mengisi field yang tidak seharusnya bisa dia ubah.

Entity:

```java
@Entity
public class UserAccount {
    @Id
    private Long id;

    private String displayName;
    private String email;
    private boolean admin;
    private boolean locked;
    private String internalRiskFlag;
}
```

Endpoint buruk:

```java
@PostMapping("/me")
public void updateMe(@RequestBody UserAccount account) {
    em.merge(account);
}
```

Client bisa mengirim:

```json
{
  "id": 10,
  "displayName": "Fajar",
  "admin": true,
  "locked": false,
  "internalRiskFlag": "LOW"
}
```

Jika field ikut di-bind dan di-merge, ini fatal.

Rule:

> **Authorization bukan hanya di endpoint. Authorization juga harus ada di field/operation boundary.**

DTO aman:

```java
public record UpdateMyProfileRequest(
    String displayName
) {}
```

Service aman:

```java
@Transactional
public void updateMyProfile(Long userId, UpdateMyProfileRequest request) {
    UserAccount account = em.find(UserAccount.class, userId);
    account.changeDisplayName(request.displayName());
}
```

Field `admin`, `locked`, `internalRiskFlag` tidak mungkin berubah dari endpoint ini.

---

## 10. Collection Replacement: Bug Paling Mahal dari DTO-to-Entity Mapping

Misalkan entity:

```java
@Entity
public class CaseEntity {
    @Id
    private Long id;

    @OneToMany(mappedBy = "caseEntity", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CaseDocument> documents = new ArrayList<>();

    public void addDocument(CaseDocument doc) {
        documents.add(doc);
        doc.setCaseEntity(this);
    }

    public void removeDocument(CaseDocument doc) {
        documents.remove(doc);
        doc.setCaseEntity(null);
    }
}
```

Request partial:

```json
{
  "title": "Updated title"
}
```

Jika DTO mapper melakukan ini:

```java
entity.setDocuments(request.getDocuments());
```

atau MapStruct/Lombok generated setter mengganti collection dengan null/empty list, maka provider bisa melihat semua child lama sebagai orphan.

Akibat:

```sql
delete from case_document where id = ?
delete from case_document where id = ?
delete from case_document where id = ?
```

Bukan karena user ingin delete document, tetapi karena mapping layer mengganti collection.

Rule:

> **Jangan expose setter collection mentah pada aggregate root. Mutasi collection harus lewat operation eksplisit: add, remove, reorder, replaceWithBusinessRule.**

Buruk:

```java
public void setDocuments(List<CaseDocument> documents) {
    this.documents = documents;
}
```

Lebih aman:

```java
public List<CaseDocument> getDocuments() {
    return Collections.unmodifiableList(documents);
}

public void attachDocument(DocumentRef ref, Actor actor) {
    ensureCanAttachDocument(actor);
    CaseDocument doc = CaseDocument.attach(this, ref);
    documents.add(doc);
}

public void removeDocument(Long documentId, Actor actor) {
    ensureCanRemoveDocument(actor);
    CaseDocument doc = findDocument(documentId);
    documents.remove(doc);
    doc.detachFromCase();
}
```

---

## 11. `merge()` dengan Association Graph

Misalkan:

```java
@Entity
public class CaseEntity {
    @Id
    private Long id;

    @ManyToOne
    private Officer assignedOfficer;

    @OneToMany(mappedBy = "caseEntity", cascade = CascadeType.MERGE)
    private List<CaseTask> tasks = new ArrayList<>();
}
```

Detached graph:

```text
CaseEntity id=100
  assignedOfficer id=10, name=null
  tasks=[
    CaseTask id=1, name="Review",
    CaseTask id=2, name=null
  ]
```

Ketika `merge(caseEntity)` dipanggil:

- state root dicopy,
- association bisa di-resolve,
- cascade merge dapat menyalin state child,
- child dengan field null bisa overwrite data lama,
- collection bisa dianggap representation lengkap,
- provider dapat load existing managed copy untuk merge,
- query tambahan bisa terjadi.

Jadi merge graph besar adalah operasi mahal dan berisiko.

Rule:

> **Cascade MERGE pada graph besar harus dianggap sebagai high-risk operation.**

Gunakan hanya jika:

1. graph benar-benar authoritative,
2. semua field lengkap,
3. semua child valid,
4. stale/version policy jelas,
5. user punya hak ubah seluruh graph,
6. collection semantics adalah replacement penuh.

Kalau tidak, gunakan managed update pattern.

---

## 12. MapStruct, Lombok, dan DTO Mapping: Useful but Dangerous

MapStruct sangat berguna, tetapi generated mapper tidak tahu invariant domain.

Contoh berbahaya:

```java
@Mapper
public interface CaseMapper {
    void updateEntity(UpdateCaseRequest request, @MappingTarget CaseEntity entity);
}
```

Jika tidak dikonfigurasi, mapper bisa:

- men-set null ke field entity,
- mengganti collection,
- mengganti association,
- bypass domain method,
- mengubah field internal,
- mengubah version,
- mengubah status workflow.

### 12.1 Safe MapStruct Pattern untuk Simple Mutable Fields

```java
@Mapper(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
public interface CasePatchMapper {
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "version", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "assignedOfficer", ignore = true)
    @Mapping(target = "documents", ignore = true)
    @Mapping(target = "auditEntries", ignore = true)
    void patch(UpdateCaseDraftRequest request, @MappingTarget CaseEntity entity);
}
```

Namun ini tetap bukan solusi universal, karena null mungkin memang bermakna clear.

### 12.2 Safer Pattern: Mapper ke Command, Domain Method ke Entity

```java
public record ChangeCaseTitleCommand(
    Long caseId,
    String title,
    Long expectedVersion
) {}
```

```java
@Transactional
public void changeTitle(ChangeCaseTitleCommand command) {
    CaseEntity c = em.find(CaseEntity.class, command.caseId());
    c.changeTitle(command.title(), command.expectedVersion());
}
```

Di sini mapper hanya mengisi command. Entity berubah lewat method domain.

### 12.3 Lombok Risk

`@Data` pada entity biasanya buruk:

```java
@Entity
@Data
public class CaseEntity { ... }
```

Karena menghasilkan:

- setter semua field,
- `equals/hashCode` yang mungkin memakai association,
- `toString` yang bisa trigger lazy loading,
- collection setter,
- accidental mutation.

Untuk entity, lebih aman:

```java
@Getter
@Entity
public class CaseEntity {
    protected CaseEntity() {}

    // domain methods, selected setters only if truly needed
}
```

---

## 13. Versioned Update: API Boundary Harus Membawa Expected Version

Optimistic locking hanya efektif jika request membawa version yang user lihat.

Response:

```json
{
  "id": 100,
  "title": "Old title",
  "status": "DRAFT",
  "version": 5
}
```

Request update:

```json
{
  "title": "New title",
  "expectedVersion": 5
}
```

Domain method:

```java
public void changeTitle(String newTitle, long expectedVersion) {
    if (this.version != expectedVersion) {
        throw new StaleObjectException("Case was modified by another transaction");
    }
    this.title = validateTitle(newTitle);
}
```

Atau rely pada `@Version` saat flush, tetapi explicit expected version memberi error lebih cepat dan lebih jelas.

```java
@Entity
public class CaseEntity {
    @Version
    private long version;
}
```

SQL pada flush biasanya:

```sql
update cases
set title = ?, version = ?
where id = ? and version = ?
```

Jika row count 0, provider melempar optimistic lock exception.

Rule:

> **Untuk UI/API workflow, version harus menjadi bagian dari write contract, bukan hanya field internal ORM.**

---

## 14. Stale Detached Entity Wins: Scenario

Timeline:

```text
T1: User A loads Case #100 version 5
T2: User B loads Case #100 version 5
T3: User B updates priority to HIGH, commit -> version 6
T4: User A submits old form version 5
```

Jika tidak ada `@Version`, User A bisa overwrite perubahan User B.

Dengan entity merge full-state:

```text
User A payload:
title = "Changed by A"
priority = "NORMAL"   // old value from stale form
```

SQL:

```sql
update cases
set title = 'Changed by A', priority = 'NORMAL'
where id = 100
```

Priority dari User B hilang.

Dengan `@Version`:

```sql
update cases
set title = 'Changed by A', priority = 'NORMAL', version = 6
where id = 100 and version = 5
```

Row count 0, optimistic lock exception.

Namun lebih baik lagi:

- User A command hanya mengubah title,
- priority tidak ikut dalam payload,
- service load managed current entity,
- `changeTitle()` hanya ubah title.

Maka update User B tidak tertimpa walaupun field berbeda.

---

## 15. Detached Entity as Serialization Object: Kenapa Berbahaya

Kadang orang melakukan:

```java
CaseEntity c = em.find(CaseEntity.class, id);
return c; // serialized to JSON
```

Risiko:

1. lazy association trigger saat serialization,
2. infinite recursion bidirectional association,
3. internal field bocor,
4. proxy class serialization issue,
5. API contract berubah saat entity berubah,
6. detached graph dikirim kembali lalu di-merge,
7. security field ikut terekspos,
8. N+1 terjadi di serializer.

Entity bukan response DTO.

Response DTO lebih aman:

```java
public record CaseDetailResponse(
    Long id,
    String title,
    String status,
    Long version,
    List<DocumentSummaryResponse> documents
) {}
```

Projection lebih aman untuk read-heavy endpoint:

```java
select new com.example.CaseSummaryResponse(c.id, c.title, c.status, c.version)
from CaseEntity c
where c.assignedOfficerId = :officerId
```

---

## 16. API Boundary Patterns

### 16.1 Bad Pattern: Entity as Request and Response

```java
@PostMapping("/cases")
public CaseEntity save(@RequestBody CaseEntity entity) {
    return repository.save(entity);
}
```

Masalah:

- persistence model bocor,
- API schema tidak stabil,
- mass assignment,
- lazy serialization,
- merge full overwrite,
- collection replacement,
- authorization sulit,
- domain invariant mudah dilewati.

---

### 16.2 Acceptable Pattern: DTO to Managed Entity Patch for Simple CRUD Admin

```java
@Transactional
public void updateCategory(Long id, UpdateCategoryRequest request) {
    Category c = em.find(Category.class, id);
    c.setName(request.name());
    c.setDescription(request.description());
}
```

Cocok untuk:

- table kecil,
- admin internal,
- invariant ringan,
- no complex workflow,
- no nested graph.

Tetap jangan `merge(requestEntity)`.

---

### 16.3 Strong Pattern: Command Handler

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseEntity c = caseRepository.get(command.caseId());

    authorization.requireCanApprove(command.actor(), c);

    c.approve(
        command.actor().id(),
        command.remarks(),
        command.expectedVersion()
    );

    audit.recordCaseApproved(c.id(), command.actor().id());
}
```

Cocok untuk:

- workflow,
- regulatory system,
- approval,
- escalation,
- case management,
- sensitive domain.

---

### 16.4 Read Model Pattern

Untuk endpoint list/search:

```java
public record CaseListingRow(
    Long id,
    String referenceNo,
    String title,
    String status,
    String assignedOfficerName,
    Instant updatedAt
) {}
```

Gunakan projection/native SQL/view/materialized view bila perlu.

Jangan load aggregate besar hanya untuk listing.

---

## 17. `merge()` Provider Behavior: Hibernate vs EclipseLink

### 17.1 Jakarta Persistence Contract

Spec/API memberi kontrak umum:

- `merge` menerima entity baru atau detached,
- state dicopy ke persistence context,
- returned object adalah managed instance,
- argument object tidak otomatis menjadi managed,
- jika entity detached, returned entity punya persistent identity yang sama,
- update/insert terjadi saat synchronization/flush.

Detail seperti kapan provider melakukan SELECT, bagaimana cascade merge dioptimasi, dan bagaimana unsaved-value/existence detection dilakukan dapat berbeda.

---

### 17.2 Hibernate Behavior

Hibernate mendeskripsikan merge sebagai proses menyalin data dari detached instance ke managed instance. Dalam Hibernate, managed instance bisa sudah ada di persistence context atau perlu di-load. Hibernate juga punya event/cascade mechanism yang memproses graph merge. Dokumentasi Hibernate menjelaskan bahwa merge mengambil incoming detached entity dan menyalin data ke managed instance baru/yang ada di persistence context.  
Reference: https://docs.hibernate.org/stable/orm/userguide/html_single/

Konsekuensi Hibernate:

- input detached tetap detached,
- return value harus digunakan,
- cascade merge mengikuti mapping,
- entity copy detection dapat memunculkan issue jika ada multiple detached representations untuk identity sama,
- versioned merge behavior dapat berubah antar versi untuk kasus row sudah hilang.

Hibernate 6.6 migration guide mencatat perubahan terkait merge versioned entity ketika row database sudah dihapus: sebelumnya merge detached entity dapat menghasilkan insert jika tidak ada row matching; behavior baru lebih ketat untuk entity versioned/generated id agar tidak diam-diam reinsert row yang sudah hilang. Ini penting untuk migration karena semantic “merge missing row” bisa berubah.  
Reference: https://docs.hibernate.org/orm/6.6/migration-guide/

---

### 17.3 EclipseLink Behavior

EclipseLink juga mengikuti JPA contract, tetapi memiliki konsep internal UnitOfWork, shared cache, descriptors, dan extension seperti existence checking. EclipseLink menyediakan extension `@ExistenceChecking` untuk mengatur bagaimana provider menentukan object baru atau existing pada operasi seperti merge, misalnya menggunakan cache atau membaca dari database.  
Reference: https://eclipse.dev/eclipselink/documentation/2.5/jpa/extensions/a_existencechecking.htm

Konsekuensi EclipseLink:

- shared cache dapat memengaruhi cost/read behavior,
- weaving/change tracking dapat memengaruhi dirty detection,
- existence checking dapat memengaruhi apakah provider membaca database,
- descriptor customization bisa mengubah behavior mapping.

Rule provider-neutral:

> **Jangan bergantung pada detail merge provider untuk API correctness. Gunakan managed update pattern agar correctness tidak ditentukan oleh heuristic merge.**

---

## 18. Merge vs Update vs Save: Jangan Samakan Istilah Framework

Di JPA standar ada:

- `persist`,
- `merge`,
- `remove`,
- `find`,
- `getReference`,
- `detach`,
- `refresh`.

Hibernate native API historically punya operasi seperti:

- `save`,
- `update`,
- `saveOrUpdate`,
- `merge`,
- `persist`.

Spring Data JPA punya:

```java
repository.save(entity)
```

Namun `save()` bukan konsep JPA spec. Di Spring Data JPA, save biasanya memilih persist atau merge berdasarkan strategi “is new”. Jadi:

```java
repository.save(entity)
```

bisa berarti:

```java
em.persist(entity)
```

atau:

```java
em.merge(entity)
```

Ini menyebabkan developer menganggap `save` adalah universal upsert. Untuk aggregate penting, jangan desain service sebagai generic save.

Buruk:

```java
public CaseEntity save(CaseEntity entity) {
    return caseRepository.save(entity);
}
```

Lebih baik:

```java
public void submitCase(SubmitCaseCommand command) { ... }
public void assignOfficer(AssignOfficerCommand command) { ... }
public void approveCase(ApproveCaseCommand command) { ... }
public void rejectCase(RejectCaseCommand command) { ... }
```

---

## 19. Practical Safe Update Recipes

### 19.1 Simple Scalar Update

```java
public record RenameCategoryRequest(
    String name,
    Long expectedVersion
) {}
```

```java
@Transactional
public void renameCategory(Long id, RenameCategoryRequest request) {
    Category c = em.find(Category.class, id);
    if (c == null) throw new NotFoundException();

    c.rename(request.name(), request.expectedVersion());
}
```

Entity:

```java
@Entity
public class Category {
    @Id
    private Long id;

    @Version
    private Long version;

    private String name;

    public void rename(String newName, Long expectedVersion) {
        requireVersion(expectedVersion);
        this.name = normalizeAndValidateName(newName);
    }
}
```

---

### 19.2 Association Change by ID

Request:

```java
public record AssignOfficerRequest(
    String officerId,
    Long expectedVersion
) {}
```

Service:

```java
@Transactional
public void assignOfficer(Long caseId, AssignOfficerRequest request, Actor actor) {
    CaseEntity c = em.find(CaseEntity.class, caseId);
    Officer officer = em.getReference(Officer.class, request.officerId());

    authorization.requireCanAssign(actor, c, officer);

    c.assignOfficer(officer, request.expectedVersion());
}
```

Jangan kirim nested officer object dari client:

```json
{
  "assignedOfficer": {
    "id": "A001",
    "name": "User supplied name"
  }
}
```

Karena nested object bisa membawa stale/wrong state.

Gunakan ID/reference command.

---

### 19.3 Add Child

```java
public record AddDocumentRequest(
    Long documentId,
    String purpose,
    Long expectedVersion
) {}
```

```java
@Transactional
public void addDocument(Long caseId, AddDocumentRequest request, Actor actor) {
    CaseEntity c = em.find(CaseEntity.class, caseId);
    Document d = em.getReference(Document.class, request.documentId());

    authorization.requireCanAttachDocument(actor, c, d);

    c.attachDocument(d, request.purpose(), request.expectedVersion());
}
```

Entity:

```java
public void attachDocument(Document d, String purpose, Long expectedVersion) {
    requireVersion(expectedVersion);
    ensureEditable();
    ensureDocumentNotAlreadyAttached(d.getId());

    CaseDocument link = CaseDocument.create(this, d, purpose);
    this.documents.add(link);
}
```

---

### 19.4 Remove Child

```java
public record RemoveDocumentRequest(
    Long documentId,
    Long expectedVersion
) {}
```

```java
@Transactional
public void removeDocument(Long caseId, RemoveDocumentRequest request, Actor actor) {
    CaseEntity c = em.find(CaseEntity.class, caseId);
    authorization.requireCanRemoveDocument(actor, c);
    c.removeDocument(request.documentId(), request.expectedVersion());
}
```

Entity:

```java
public void removeDocument(Long documentId, Long expectedVersion) {
    requireVersion(expectedVersion);
    ensureEditable();

    CaseDocument doc = documents.stream()
        .filter(d -> d.documentId().equals(documentId))
        .findFirst()
        .orElseThrow(() -> new DomainException("Document not attached"));

    documents.remove(doc);
    doc.detachFromCase();
}
```

Dengan `orphanRemoval=true`, delete terjadi karena domain operation eksplisit, bukan karena mapper mengganti collection.

---

### 19.5 Replace Collection Safely

Kadang replacement memang dibutuhkan, misalnya reorder checklist.

Request:

```java
public record ReorderChecklistRequest(
    List<Long> itemIdsInOrder,
    Long expectedVersion
) {}
```

Entity:

```java
public void reorderChecklist(List<Long> itemIdsInOrder, Long expectedVersion) {
    requireVersion(expectedVersion);
    ensureSameItems(itemIdsInOrder);

    Map<Long, ChecklistItem> byId = checklistItems.stream()
        .collect(Collectors.toMap(ChecklistItem::id, Function.identity()));

    checklistItems.clear();

    int order = 0;
    for (Long id : itemIdsInOrder) {
        ChecklistItem item = byId.get(id);
        item.changePosition(order++);
        checklistItems.add(item);
    }
}
```

Replacement dilakukan dengan invariant:

- item harus sama,
- tidak boleh ada duplicate,
- tidak boleh ada item asing,
- order field diupdate eksplisit.

---

## 20. Patch Implementation Without Accidental Null Overwrite

DTO:

```java
public record PatchCaseRequest(
    PatchField<String> title,
    PatchField<String> description,
    PatchField<String> priority,
    Long expectedVersion
) {}
```

PatchField:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    private PatchField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> PatchField<T> missing() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> of(T value) {
        return new PatchField<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T value() {
        return value;
    }
}
```

Service:

```java
@Transactional
public void patchCase(Long id, PatchCaseRequest request, Actor actor) {
    CaseEntity c = em.find(CaseEntity.class, id);
    authorization.requireCanEdit(actor, c);

    c.requireVersion(request.expectedVersion());

    if (request.title().isPresent()) {
        c.changeTitle(request.title().value());
    }

    if (request.description().isPresent()) {
        if (request.description().value() == null) {
            c.clearDescription();
        } else {
            c.changeDescription(request.description().value());
        }
    }

    if (request.priority().isPresent()) {
        authorization.requireCanChangePriority(actor, c);
        c.changePriority(Priority.valueOf(request.priority().value()));
    }
}
```

Ini lebih verbose, tetapi aman.

---

## 21. Anti-Pattern Catalog

### 21.1 Entity as API Contract

```java
@RequestBody CaseEntity entity
```

Risiko:

- mass assignment,
- lazy serialization,
- graph overwrite,
- version confusion,
- API-persistence coupling.

---

### 21.2 Generic Save Service

```java
public T save(T entity) { return repository.save(entity); }
```

Risiko:

- tidak ada intent,
- tidak ada authorization per operation,
- tidak ada invariant,
- persist/merge semantics tersembunyi.

---

### 21.3 Blind Mapper to Entity

```java
mapper.updateEntity(request, entity);
```

Risiko:

- null overwrite,
- collection replacement,
- internal field mutation.

---

### 21.4 Cascade Merge Everywhere

```java
@OneToMany(cascade = CascadeType.ALL)
private List<Child> children;
```

Risiko:

- merge storm,
- child overwrite,
- accidental insert/update/delete,
- huge graph traversal.

---

### 21.5 No Version in Write API

```json
{
  "title": "New title"
}
```

Risiko:

- last write wins,
- silent lost update,
- impossible conflict UX.

---

### 21.6 Public Setters for All Entity Fields

```java
public void setStatus(Status status) { this.status = status; }
public void setApprovedBy(String approvedBy) { this.approvedBy = approvedBy; }
public void setApprovedAt(Instant approvedAt) { this.approvedAt = approvedAt; }
```

Risiko:

- workflow invariant bypass,
- invalid state combination,
- audit inconsistency.

Lebih baik:

```java
public void approve(String officerId, String remarks) {
    ensureCanApprove();
    this.status = APPROVED;
    this.approvedBy = officerId;
    this.approvedAt = Instant.now();
    this.approvalRemarks = validateRemarks(remarks);
}
```

---

## 22. Case Management Example: Bad vs Good

### 22.1 Bad Design

```java
@Entity
@Data
public class EnforcementCase {
    @Id
    private Long id;

    @Version
    private Long version;

    private String status;
    private String assignedOfficerId;
    private String riskLevel;
    private String internalNote;
    private String decision;
    private Instant approvedAt;
    private String approvedBy;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CaseAttachment> attachments;
}
```

Endpoint:

```java
@PutMapping("/cases/{id}")
@Transactional
public EnforcementCase update(@PathVariable Long id, @RequestBody EnforcementCase body) {
    body.setId(id);
    return em.merge(body);
}
```

Bugs:

- user bisa update `status`,
- user bisa null-kan `approvedBy`,
- user bisa hapus attachments,
- stale payload overwrite risk level,
- internal note bocor,
- workflow invalid,
- audit tidak jelas.

---

### 22.2 Better Design

Requests:

```java
public record ChangeCaseRiskRequest(
    RiskLevel riskLevel,
    String reason,
    Long expectedVersion
) {}

public record AssignCaseRequest(
    String officerId,
    Long expectedVersion
) {}

public record ApproveCaseRequest(
    String decisionSummary,
    Long expectedVersion
) {}
```

Service:

```java
@Transactional
public void approveCase(Long caseId, ApproveCaseRequest request, Actor actor) {
    EnforcementCase c = em.find(EnforcementCase.class, caseId, LockModeType.OPTIMISTIC);

    authorization.requireCanApprove(actor, c);

    c.approve(
        actor.userId(),
        request.decisionSummary(),
        request.expectedVersion()
    );

    audit.record("CASE_APPROVED", c.getId(), actor.userId());
}
```

Entity:

```java
public void approve(String officerId, String decisionSummary, Long expectedVersion) {
    requireVersion(expectedVersion);
    requireStatus(Status.PENDING_APPROVAL);
    requireAssignedOfficer(officerId);

    this.status = Status.APPROVED;
    this.decision = validateDecision(decisionSummary);
    this.approvedBy = officerId;
    this.approvedAt = Instant.now(clock);
}
```

Ini membuat perubahan state:

- eksplisit,
- auditable,
- authorized,
- versioned,
- domain-valid,
- minimal update.

---

## 23. DTO Design Taxonomy

| Type | Purpose | Example | Persistence Safety |
|---|---|---|---|
| Request DTO | Input API | `UpdateProfileRequest` | Aman jika tidak langsung merge |
| Response DTO | Output API | `CaseDetailResponse` | Aman untuk serialization |
| Command | Intent mutation | `ApproveCaseCommand` | Paling aman untuk domain penting |
| Query DTO | Read projection | `CaseListingRow` | Aman untuk read model |
| Patch DTO | Partial mutation | `PatchCaseRequest` | Aman jika presence/null jelas |
| Import DTO | External file/message | `ImportedApplicationRow` | Perlu validation + reconciliation |
| Entity | Persistence state | `CaseEntity` | Jangan jadi API contract |

---

## 24. Detached Entity Use Cases yang Masih Valid

Tidak semua detached entity buruk.

Use case valid:

1. desktop app lama dengan long conversation,
2. batch processing dengan controlled graph,
3. offline editing dengan full representation dan version,
4. internal service trusted payload,
5. replication/synchronization engine,
6. import tool dengan explicit reconciliation,
7. admin tool yang memang mengganti full aggregate.

Namun syaratnya:

- graph lengkap,
- field authorization tidak masalah,
- version ada,
- cascade jelas,
- collection replacement memang diinginkan,
- merge behavior diuji,
- conflict resolution jelas.

Kalau tidak memenuhi syarat, jangan pakai detached merge.

---

## 25. Testing Boundary Safety

### 25.1 Test Missing Field Tidak Menghapus Data

```java
@Test
void patchTitleMustNotClearInternalNote() {
    Long id = givenCaseWithInternalNote("Sensitive note");

    service.patchCase(id, new PatchCaseRequest(
        PatchField.of("New title"),
        PatchField.missing(),
        PatchField.missing(),
        1L
    ), actor);

    CaseEntity reloaded = em.find(CaseEntity.class, id);
    assertThat(reloaded.getInternalNote()).isEqualTo("Sensitive note");
}
```

---

### 25.2 Test Unauthorized Field Cannot Change

```java
@Test
void regularUserCannotChangeRiskLevel() {
    PatchCaseRequest request = requestWithPriority("HIGH");

    assertThrows(AccessDeniedException.class,
        () -> service.patchCase(caseId, request, regularUser));
}
```

---

### 25.3 Test Collection Not Deleted by Scalar Update

```java
@Test
void changingTitleMustNotDeleteDocuments() {
    Long id = givenCaseWithDocuments(3);

    service.changeTitle(id, new ChangeTitleRequest("New", version));

    assertThat(countDocuments(id)).isEqualTo(3);
}
```

---

### 25.4 Test Stale Version Rejected

```java
@Test
void staleUpdateMustFail() {
    CaseDetailResponse a = api.getCase(id);
    CaseDetailResponse b = api.getCase(id);

    api.changeTitle(id, new ChangeTitleRequest("B update", b.version()));

    assertThrows(OptimisticLockException.class, () ->
        api.changeTitle(id, new ChangeTitleRequest("A update", a.version()))
    );
}
```

---

## 26. Diagnostic Checklist: Saat Ada Bug “Data Tiba-Tiba Hilang/Berubah”

Tanyakan:

1. Apakah endpoint menerima entity langsung?
2. Apakah service memanggil `merge()` pada object dari request?
3. Apakah DTO mapper men-set null ke entity?
4. Apakah collection diganti, bukan dimutasi?
5. Apakah `orphanRemoval=true` aktif?
6. Apakah cascade `MERGE`/`ALL` terlalu luas?
7. Apakah request membawa stale data?
8. Apakah entity punya `@Version`?
9. Apakah version dikirim balik ke write API?
10. Apakah field internal ikut dalam JSON?
11. Apakah Lombok `@Data` dipakai pada entity?
12. Apakah serializer memaksa lazy loading?
13. Apakah response entity dipakai kembali sebagai request?
14. Apakah provider melakukan SELECT sebelum merge?
15. Apakah SQL update mengandung kolom yang tidak seharusnya berubah?
16. Apakah audit trail bisa menunjukkan endpoint/actor/field berubah?

---

## 27. Design Rules

### Rule 1 — Entity adalah persistence model, bukan API model

Entity boleh punya behavior domain, tetapi jangan jadikan entity sebagai JSON contract.

---

### Rule 2 — External payload harus diterjemahkan menjadi intent

Payload harus menjadi:

- command,
- request DTO,
- patch operation,
- import instruction.

Bukan langsung menjadi entity state.

---

### Rule 3 — Load managed entity, lalu ubah dengan method eksplisit

Default safe update:

```text
load managed aggregate -> authorize -> validate version -> call domain method -> flush
```

---

### Rule 4 — Jangan pakai `merge()` untuk partial update API

`merge()` boleh untuk trusted full graph, bukan form partial biasa.

---

### Rule 5 — Null semantics harus eksplisit

Missing, null, clear, default, unchanged harus dibedakan.

---

### Rule 6 — Collection mutation harus operation-based

Jangan expose collection setter untuk aggregate child.

---

### Rule 7 — Cascade merge harus dibatasi

Cascade bukan convenience global. Cascade adalah lifecycle ownership contract.

---

### Rule 8 — Version harus masuk write contract

Tanpa expected version, conflict handling sering menjadi last-write-wins.

---

### Rule 9 — DTO mapper tidak boleh melewati invariant domain

Mapper boleh mengubah simple field hanya jika invariant ringan. Untuk workflow, gunakan method domain.

---

### Rule 10 — Test negative boundary behavior

Test bukan hanya “update berhasil”, tetapi juga:

- field lain tidak berubah,
- child tidak terhapus,
- unauthorized field tidak berubah,
- stale update gagal,
- partial null semantics benar.

---

## 28. Mental Model Akhir

```text
External world
(JSON, UI form, MQ, file, API client)
        |
        | untrusted data
        v
Boundary DTO / command
        |
        | validation + authorization + intent extraction
        v
Application service
        |
        | load managed aggregate
        v
Persistence context
        |
        | domain method mutates managed entity
        v
Dirty checking
        |
        | flush with version check
        v
Database
```

Bandingkan dengan anti-pattern:

```text
External JSON
        |
        | bind directly
        v
Entity object
        |
        | merge full graph
        v
Unknown overwrite/delete/cascade behavior
        |
        v
Database corruption risk
```

Top 1% persistence engineer tidak hanya tahu cara menyimpan entity. Ia tahu bagaimana mencegah state dari boundary merusak aggregate.

---

## 29. Practice Scenarios

### Scenario 1 — Partial Update

Endpoint menerima:

```json
{
  "title": "Updated"
}
```

Entity punya:

- title,
- description,
- status,
- assignedOfficer,
- internalNote.

Pertanyaan:

1. Field mana yang boleh berubah?
2. Bagaimana membedakan missing dan null?
3. Apakah perlu expected version?
4. Apakah DTO mapper aman?
5. SQL update seharusnya menyentuh kolom apa?

---

### Scenario 2 — Replace Child List

UI mengirim list document ID terbaru.

Pertanyaan:

1. Apakah ini add/remove delta atau full replacement?
2. Apakah document lama yang tidak ada harus dihapus?
3. Apakah user punya hak hapus document?
4. Bagaimana mencegah duplicate?
5. Bagaimana audit-nya?

---

### Scenario 3 — Approval Workflow

User mengirim:

```json
{
  "status": "APPROVED"
}
```

Pertanyaan:

1. Kenapa ini boundary buruk?
2. Field apa lagi yang harus berubah bersama status?
3. Apa invariant sebelum approval?
4. Bagaimana command yang lebih tepat?
5. Bagaimana optimistic locking diterapkan?

---

### Scenario 4 — Detached Entity from Batch Import

Batch menerima full snapshot external system.

Pertanyaan:

1. Apakah external snapshot authoritative?
2. Apakah boleh overwrite local field?
3. Bagaimana conflict resolution?
4. Apakah merge cocok?
5. Apakah lebih baik reconciliation service?

---

## 30. Summary

`merge()` adalah operasi ORM yang kuat, tetapi sering disalahgunakan. Ia menyalin state dari object detached/new ke managed instance. Ia tidak memahami API intent, authorization, null semantics, partial update, workflow invariant, atau domain rule.

Untuk aplikasi enterprise modern, terutama case management, regulatory workflow, approval, compliance, dan sistem dengan audit kuat, default yang lebih aman adalah:

```text
DTO/command -> load managed entity -> authorize -> validate version -> domain method -> dirty checking -> flush
```

Gunakan `merge()` hanya saat benar-benar menerima full trusted graph dan memahami cascade serta provider behavior.

Prinsip utama bagian ini:

> **Jangan pernah membiarkan object dari luar sistem menjadi sumber kebenaran penuh untuk aggregate tanpa proses intent extraction, authorization, validation, dan version check.**

---

## 31. Referensi Utama

- Jakarta Persistence 3.2 `EntityManager` API — `merge`, `persist`, `detach`, persistence context semantics: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager
- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Hibernate ORM User Guide: https://docs.hibernate.org/stable/orm/userguide/html_single/
- Hibernate ORM 6.6 Migration Guide — merge behavior for versioned entity when row is deleted: https://docs.hibernate.org/orm/6.6/migration-guide/
- EclipseLink JPA Extensions — `@ExistenceChecking`: https://eclipse.dev/eclipselink/documentation/2.5/jpa/extensions/a_existencechecking.htm
- EclipseLink 4.0 JPA Extensions Reference: https://eclipse.dev/eclipselink/documentation/4.0/jpa/extensions/jpa-extensions.html

---

## 32. Koneksi ke Bagian Berikutnya

Bagian ini menjelaskan bagaimana menjaga API boundary dan detached state agar aman. Bagian berikutnya akan masuk ke:

```text
21-second-level-cache-query-cache-natural-id-cache-correctness.md
```

Di sana fokusnya bergeser dari boundary input ke **cache correctness**:

- first-level vs second-level cache,
- entity cache,
- collection cache,
- query cache,
- natural ID cache,
- cache invalidation,
- cache concurrency strategy,
- stale reads,
- cache poisoning,
- cluster cache,
- tenant leakage,
- production rules.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 19 — Concurrency Control: Optimistic Locking, Pessimistic Locking, and Lost Updates](./19-concurrency-control-optimistic-pessimistic-locking-lost-updates.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 21 — Second-Level Cache, Query Cache, Natural ID Cache, and Cache Correctness](./21-second-level-cache-query-cache-natural-id-cache-correctness.md)

</div>