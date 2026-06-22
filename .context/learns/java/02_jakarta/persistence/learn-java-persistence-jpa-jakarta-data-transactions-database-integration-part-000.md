# Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-000.md`  
> Scope: Java 8 sampai Java 25, JPA `javax.persistence`, Jakarta Persistence `jakarta.persistence`, Jakarta Data, Jakarta Transactions, Hibernate ORM, dan integrasi database produksi.

---

## 0. Posisi Bagian Ini dalam Seri

Bagian ini bukan tutorial `@Entity`, bukan kumpulan annotation, dan bukan pengulangan JDBC atau SQL dasar. Bagian ini adalah fondasi mental model.

Setelah melewati banyak seri Java sebelumnya, kita sekarang masuk ke wilayah yang sering terlihat sederhana tetapi justru menjadi sumber banyak bug produksi: persistence. Banyak engineer bisa membuat CRUD berjalan. Lebih sedikit yang benar-benar memahami apa yang terjadi ketika object Java berubah menjadi row database, kapan SQL benar-benar dikirim, bagaimana transaction menentukan batas kebenaran, kenapa `@Transactional` bisa gagal diam-diam, kenapa N+1 muncul, kenapa data bisa stale, kenapa update hilang, kenapa audit tidak defensible, dan kenapa sistem yang “lulus testing” tetap gagal di production.

Persistence adalah boundary. Ia mempertemukan beberapa dunia yang modelnya berbeda:

1. **Object model**: object Java, identity object, reference, inheritance, lifecycle di heap.
2. **Relational model**: table, row, column, primary key, foreign key, constraint, index, set-based query.
3. **Transaction model**: ACID, isolation, locking, commit, rollback, retry, anomaly.
4. **Consistency model**: invariant, uniqueness, state transition, idempotency, eventual consistency.
5. **Integration model**: event, message, outbox, CDC, external system, distributed failure.
6. **Operational model**: connection pool, slow query, lock wait, deadlock, migration, observability, incident response.

Engineer yang kuat tidak hanya bertanya, “annotation apa yang dipakai?” tetapi bertanya:

- Invariant apa yang harus selalu benar?
- Boundary transaction-nya di mana?
- Data apa yang harus dibaca sebagai entity dan apa yang cukup sebagai projection?
- SQL apa yang akan dihasilkan?
- Constraint apa yang dijaga database?
- Failure mode apa yang terjadi jika commit sukses tetapi publish event gagal?
- Apa yang terjadi jika dua request menjalankan transisi status yang sama secara bersamaan?
- Apakah read path ini akan men-trigger N+1?
- Apakah transaction terlalu panjang?
- Apakah persistence context membesar tanpa disadari?
- Apakah perubahan schema aman untuk deployment rolling?

Bagian ini membangun peta besar untuk menjawab pertanyaan-pertanyaan itu.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat persistence sebagai **boundary kebenaran sistem**, bukan sekadar layer CRUD.
2. Membedakan peran JPA/Jakarta Persistence, Hibernate, Jakarta Data, Spring Data, JDBC, transaction manager, connection pool, dan database.
3. Memahami kenapa ORM bukan pengganti pemahaman SQL dan database.
4. Menentukan kapan memakai entity, projection, native query, repository abstraction, atau SQL eksplisit.
5. Memahami bahwa transaction boundary adalah desain use case, bukan dekorasi method.
6. Menghindari mental model lemah seperti “entity = DTO”, “repository = table wrapper”, dan “ORM menyembunyikan database”.
7. Memiliki vocabulary awal untuk membaca failure persistence di production.
8. Menyiapkan cara berpikir untuk part selanjutnya: identity, lifecycle, mapping, fetching, query, transaction, locking, caching, audit, migration, dan observability.

---

## 2. Peta Teknologi: Siapa Bertanggung Jawab atas Apa?

Sebelum masuk detail, kita perlu membedakan setiap layer. Banyak bug arsitektural muncul karena semua istilah dicampur: JPA disamakan dengan Hibernate, Hibernate disamakan dengan Spring Data, transaction disamakan dengan connection, dan repository disamakan dengan table.

### 2.1 JDBC

JDBC adalah API rendah untuk berbicara dengan database relasional dari Java.

Tanggung jawabnya:

- Membuka connection.
- Menjalankan SQL.
- Mengirim parameter.
- Membaca `ResultSet`.
- Mengontrol commit/rollback pada connection.
- Berinteraksi dengan driver database.

JDBC tidak tahu:

- Entity.
- Dirty checking.
- Persistence context.
- Lazy loading.
- Object graph.
- JPQL.
- Repository method.

JDBC adalah jalur paling eksplisit. Ia kuat, tetapi verbose. Ia cocok untuk hot path yang sangat sensitif, batch tertentu, native feature database, atau query yang lebih natural ditulis sebagai SQL.

### 2.2 JPA / Jakarta Persistence

JPA, dan penerusnya Jakarta Persistence, adalah specification untuk object/relational mapping dan management persistence menggunakan domain model Java. Jakarta Persistence 3.2 mendefinisikan standard untuk management persistence dan ORM di Java environment, termasuk Java SE dan Jakarta EE.

Tanggung jawab specification:

- Menentukan annotation standard seperti `@Entity`, `@Id`, `@ManyToOne`, `@OneToMany`, `@Column`, `@Version`.
- Menentukan konsep `EntityManager`.
- Menentukan persistence context.
- Menentukan lifecycle entity.
- Menentukan JPQL dan Criteria API.
- Menentukan standard behavior untuk persist, merge, remove, find, flush, dan query.
- Menentukan integration dengan transaction.

JPA/Jakarta Persistence bukan implementation. Ia adalah kontrak. Butuh provider.

Provider umum:

- Hibernate ORM.
- EclipseLink.
- OpenJPA, historis.

### 2.3 Hibernate ORM

Hibernate adalah ORM provider. Ia mengimplementasikan JPA/Jakarta Persistence dan menyediakan fitur tambahan di luar standard.

Hibernate bertanggung jawab atas:

- SQL generation.
- Dirty checking implementation.
- Proxy/lazy loading implementation.
- Fetch strategy provider-specific.
- Batch fetching.
- Second-level cache integration.
- Custom type.
- HQL.
- Hibernate-specific annotations.
- Hibernate statistics.
- Dialect database.

Hibernate sangat powerful, tetapi tidak semua fitur Hibernate portable ke provider lain. Engineer harus bisa membedakan:

- **JPA portable feature**: relatif aman lintas provider.
- **Hibernate-specific feature**: kuat, tetapi coupling ke Hibernate.
- **Database-specific feature**: paling kuat, tetapi coupling ke vendor database.

Coupling bukan selalu buruk. Coupling yang disadari dan terdokumentasi sering lebih baik daripada abstraksi palsu yang menyembunyikan kebutuhan nyata.

### 2.4 Spring Data JPA

Spring Data JPA adalah abstraction di atas JPA. Ia bukan JPA provider.

Tanggung jawabnya:

- Membuat repository interface.
- Derived query method.
- `@Query`.
- Pagination/sorting abstraction.
- Specification support.
- Query method parsing.
- Integrasi dengan Spring transaction.

Spring Data JPA tidak menghilangkan JPA/Hibernate behavior. Ia hanya memberi programming model lebih ringkas. Jika underlying query N+1, salah transaction, salah mapping, atau salah locking, Spring Data tidak otomatis menyelamatkan.

### 2.5 Jakarta Data

Jakarta Data adalah specification di ekosistem Jakarta EE untuk menyederhanakan data access melalui repository interface. Ia memberikan model repository standard sehingga aplikasi dapat mendefinisikan interface dengan method untuk insert, update, delete, dan query entity. Jakarta Data ditujukan bukan hanya untuk relational database; modelnya juga berupaya lebih umum untuk data access.

Posisinya mirip secara ide dengan repository abstraction, tetapi bukan identik dengan Spring Data. Karena Jakarta Data adalah specification, detail implementasi bergantung pada provider. Hibernate modern menyediakan dukungan terhadap Jakarta Data repository pada versi yang sesuai.

Penting: Jakarta Data tidak menggantikan pemahaman persistence. Ia menyederhanakan sebagian akses data, tetapi correctness, transaction, query shape, isolation, locking, dan database behavior tetap harus dipahami.

### 2.6 Jakarta Transactions / JTA

Jakarta Transactions mendefinisikan standard interface antara transaction manager dan pihak yang terlibat dalam distributed transaction system: aplikasi, resource manager, dan application server. Di level aplikasi, ia memberi API untuk demarcation transaction boundary.

Tanggung jawabnya:

- Transaction demarcation.
- Coordination dengan resource manager.
- Support untuk distributed/XA transaction pada environment yang mendukung.
- API seperti `UserTransaction`, `TransactionManager`, dan annotation `jakarta.transaction.Transactional`.

Tetapi transaction manager tidak mendesain use case untukmu. Ia hanya menjalankan boundary yang kamu tentukan.

### 2.7 Connection Pool

Connection pool seperti HikariCP mengelola koneksi fisik/logis ke database.

Tanggung jawabnya:

- Reuse connection.
- Limit concurrency ke database.
- Timeout saat tidak ada connection.
- Leak detection.
- Connection health check.

Connection pool bukan transaction manager, bukan ORM, bukan query optimizer.

### 2.8 Database

Database bukan storage bodoh. Database adalah execution engine dan consistency engine.

Tanggung jawabnya:

- Menyimpan data durable.
- Menjalankan SQL.
- Menjaga constraint.
- Mengelola lock/MVCC.
- Menentukan isolation behavior.
- Memilih execution plan.
- Menggunakan index.
- Menjamin commit/rollback.

Jika application layer dan ORM tidak menghormati database sebagai engine yang kuat, sistem akan rapuh.

---

## 3. Relasi Antara Layer

Gambaran sederhana:

```text
Application Use Case
        |
        v
Service / Application Layer  <-- transaction boundary biasanya di sini
        |
        v
Repository / DAO / Query Object
        |
        v
JPA EntityManager / Jakarta Data / Spring Data JPA
        |
        v
Hibernate ORM / JPA Provider
        |
        v
JDBC Driver
        |
        v
Connection Pool
        |
        v
Database
```

Namun alur runtime-nya tidak selalu linear. Misalnya:

- Repository method dipanggil.
- Hibernate mengambil connection saat perlu SQL.
- Query dieksekusi.
- Row diubah menjadi entity managed.
- Entity disimpan di persistence context.
- Field entity diubah.
- SQL update belum tentu langsung dikirim.
- Flush terjadi sebelum query tertentu atau commit.
- Commit dilakukan oleh transaction manager.
- Connection dikembalikan ke pool.

Karena itu, membaca kode Java saja tidak cukup. Harus bisa membayangkan timeline runtime.

---

## 4. Core Mental Model: Persistence Context sebagai Unit of Work

Salah satu konsep paling penting di JPA adalah persistence context.

Persistence context dapat dipahami sebagai:

1. **Identity map**: dalam satu context, satu row database dengan identity tertentu direpresentasikan oleh satu object entity managed.
2. **Unit of work**: perubahan pada entity managed dikumpulkan dan disinkronkan ke database saat flush.
3. **Change tracker**: provider mendeteksi perubahan entity managed melalui dirty checking.
4. **Boundary lifecycle**: entity bisa transient, managed, detached, atau removed.

Contoh:

```java
@Transactional
public void changeEmail(Long userId, String newEmail) {
    User user = entityManager.find(User.class, userId);
    user.changeEmail(newEmail);
}
```

Tidak ada `save()` eksplisit di contoh tersebut. Jika `user` adalah managed entity, Hibernate dapat mendeteksi perubahan dan mengirim `UPDATE` saat flush/commit.

Ini powerful, tetapi juga berbahaya.

Pertanyaan yang harus muncul:

- Kapan entity menjadi managed?
- Berapa lama ia managed?
- Apakah perubahan ini disengaja atau accidental?
- Kapan SQL update dikirim?
- Apakah update semua column atau hanya column tertentu?
- Apa yang terjadi jika object dikirim ke layer lain lalu dimodifikasi?
- Apa yang terjadi jika transaction sudah selesai dan entity menjadi detached?

Engineer yang tidak memahami persistence context akan bingung oleh bug seperti:

- Update terjadi padahal tidak ada `save()`.
- Update tidak terjadi padahal object berubah.
- Lazy loading gagal setelah transaction selesai.
- Entity lama/stale setelah bulk update.
- Memory naik saat batch processing.
- `merge()` membuat data overwrite tanpa sadar.

---

## 5. Persistence Bukan CRUD: CRUD Hanya Satu Irisan Kecil

CRUD adalah operasi dasar:

- Create.
- Read.
- Update.
- Delete.

Tetapi sistem bisnis nyata jarang hanya CRUD. Yang lebih penting adalah:

- State transition.
- Invariant.
- Authorization-aware mutation.
- Auditability.
- Consistency under concurrency.
- Integration event.
- Retry semantics.
- Reporting read model.
- Data retention.
- Migration.
- Archival.
- Idempotency.

Contoh CRUD lemah:

```java
public Case updateCase(Long id, Case input) {
    Case existing = repository.findById(id).orElseThrow();
    existing.setStatus(input.getStatus());
    existing.setAssignedOfficer(input.getAssignedOfficer());
    existing.setRemarks(input.getRemarks());
    return repository.save(existing);
}
```

Masalah:

- Siapa yang boleh mengubah status?
- Transisi status apa yang valid?
- Apakah status bisa mundur?
- Apakah update remarks harus audit?
- Apakah dua officer bisa submit bersamaan?
- Apakah update ini menimpa field yang tidak dikirim client?
- Apakah entity dikirim langsung sebagai request body?
- Apakah ada optimistic lock?
- Apakah ada event setelah status berubah?
- Apakah event publish transactional?

Model lebih baik:

```java
@Transactional
public void submitCase(SubmitCaseCommand command) {
    CaseRecord caseRecord = caseRepository.getForUpdate(command.caseId());

    caseRecord.submit(
        command.actor(),
        command.submissionReason(),
        clock.now()
    );

    auditTrail.recordCaseSubmitted(caseRecord, command.actor());
    outbox.add(CaseSubmittedEvent.from(caseRecord));
}
```

Walaupun contoh ini masih sederhana, arahnya berbeda:

- Use case spesifik.
- Command eksplisit.
- Transaction boundary jelas.
- Domain operation jelas.
- Audit dan event berada dalam boundary yang dipikirkan.
- Repository tidak sekadar table wrapper.

---

## 6. Object Model vs Relational Model

ORM disebut object/relational mapping karena ia memetakan dua model yang berbeda secara fundamental.

### 6.1 Object Model

Object model memiliki karakteristik:

- Identity berdasarkan reference/object instance.
- Navigasi lewat object reference.
- Encapsulation.
- Inheritance.
- Polymorphism.
- Collection sebagai object graph.
- Lifecycle di memory.
- Mutation melalui method/field.

Contoh:

```java
caseRecord.getApplicant().getProfile().getAddress().getPostalCode();
```

Ini terlihat murah di Java, tetapi bisa mahal jika setiap navigasi memicu query.

### 6.2 Relational Model

Relational model memiliki karakteristik:

- Data dalam table.
- Row tidak punya pointer object, hanya value dan key.
- Relationship lewat foreign key.
- Query berbasis set.
- Constraint eksplisit.
- Index memengaruhi akses.
- Join adalah operasi query, bukan field access.
- Update adalah perubahan row/column.

Contoh SQL:

```sql
select c.id, a.name, p.postal_code
from case_record c
join applicant a on a.id = c.applicant_id
join applicant_profile p on p.applicant_id = a.id
where c.id = ?;
```

### 6.3 Object/Relational Impedance Mismatch

Perbedaan ini menciptakan mismatch:

| Area | Object Model | Relational Model | Risiko |
|---|---|---|---|
| Identity | Object reference | Primary key | `equals/hashCode` salah |
| Relationship | Object graph | Foreign key/join | N+1, cascade salah |
| Inheritance | Natural di Java | Tidak natural di table | Query kompleks |
| Collection | List/Set/Map | Child rows | Duplicate, ordering, bag issue |
| Lifecycle | GC/object reachability | Insert/update/delete | Orphan/cascade salah |
| Constraint | Method/validation | DB constraint | Race condition |
| Transaction | Tidak terlihat di object | Commit/rollback | Data anomaly |

ORM membantu, tetapi mismatch tidak hilang. Ia hanya dipindahkan ke mapping dan runtime behavior.

---

## 7. Transaction sebagai Boundary Kebenaran

Transaction bukan sekadar “supaya rollback kalau error”. Transaction menentukan kapan perubahan dianggap satu kesatuan yang benar.

Pertanyaan desain transaction:

- Operasi bisnis apa yang harus atomic?
- Data apa yang harus dibaca dan ditulis dalam boundary yang sama?
- Apakah external call boleh berada di dalam transaction?
- Apakah event harus disimpan bersama perubahan state?
- Apakah perlu optimistic locking?
- Apakah perlu pessimistic locking?
- Apakah retry aman?
- Apakah operation idempotent?

Contoh buruk:

```java
@Transactional
public void approveCase(Long caseId) {
    CaseRecord c = repository.findById(caseId).orElseThrow();
    c.approve();

    externalNotificationClient.sendApproval(c); // external call inside transaction
}
```

Risiko:

- Transaction DB tetap terbuka selama network call.
- Lock bisa tertahan lebih lama.
- Jika external call sukses lalu DB rollback, external system sudah menerima state yang tidak pernah commit.
- Jika DB commit sukses tetapi response external gagal, retry bisa double-send.

Model lebih robust:

```java
@Transactional
public void approveCase(Long caseId, Actor actor) {
    CaseRecord c = repository.get(caseId);
    c.approve(actor, clock.now());

    auditTrail.recordApproval(c, actor);
    outbox.add(NotificationRequested.approval(c.id()));
}
```

Lalu publisher asynchronous membaca outbox setelah commit.

Prinsipnya: external side effect tidak boleh diperlakukan seolah-olah atomic dengan DB lokal kecuali ada transaction coordinator yang memang didesain untuk itu. Dalam banyak sistem modern, pendekatan yang lebih umum adalah local transaction + outbox + idempotent consumer.

---

## 8. Consistency: Invariant Lebih Penting daripada Annotation

Invariant adalah kondisi yang harus selalu benar.

Contoh invariant:

- Nomor aplikasi harus unik.
- Case hanya boleh `APPROVED` jika semua mandatory check selesai.
- Appeal tidak boleh dibuat jika case belum final.
- Officer tidak boleh approve case yang ia submit sendiri.
- Quota tidak boleh negatif.
- Status tidak boleh lompat dari `DRAFT` langsung ke `CLOSED`.
- Data audit tidak boleh berubah setelah dibuat.

Annotation membantu, tetapi invariant tidak otomatis aman hanya dengan annotation.

Contoh:

```java
@Column(unique = true)
private String applicationNo;
```

Ini belum tentu cukup jika schema production tidak memiliki unique constraint. Bahkan jika JPA schema generation bisa membuat unique constraint, production biasanya memakai migration tool. Jadi invariant penting harus dijaga di database melalui constraint/migration eksplisit.

Contoh race condition:

```java
if (!repository.existsByApplicationNo(no)) {
    repository.save(new Application(no));
}
```

Dua request concurrent bisa sama-sama melihat `exists=false`, lalu dua-duanya insert. Solusi sesungguhnya adalah unique constraint di database, lalu aplikasi menangani duplicate key exception dengan benar.

Prinsip:

- UI validation untuk user experience.
- DTO/Bean Validation untuk input contract.
- Domain validation untuk rule bisnis.
- Database constraint untuk impossible states under concurrency.
- Audit untuk explainability.

---

## 9. Repository Bukan Table Wrapper

Repository sering disalahpahami sebagai wrapper per table.

Contoh mental model lemah:

```java
UserRepository -> user table
RoleRepository -> role table
UserRoleRepository -> user_role table
CaseRepository -> case table
```

Ini menghasilkan desain anemic dan query tersebar.

Repository yang baik lebih dekat ke access pattern atau aggregate boundary.

Contoh:

```java
interface CaseRepository {
    CaseRecord get(CaseId id);
    CaseRecord getForDecision(CaseId id);
    void add(CaseRecord caseRecord);
}

interface CaseSearchQuery {
    Page<CaseListingRow> search(CaseSearchCriteria criteria, PageRequest page);
}

interface CaseAuditQuery {
    List<CaseAuditTimelineRow> timeline(CaseId id);
}
```

Di sini kita membedakan:

- Repository untuk aggregate mutation.
- Query object untuk read model.
- Projection untuk listing/timeline.
- Entity tidak dipaksa menjadi semua bentuk data.

Prinsip penting:

- Write model dan read model tidak harus sama.
- Entity cocok untuk consistency boundary.
- Projection cocok untuk read-heavy/listing/reporting.
- Native SQL boleh dipakai jika query memang lebih natural dalam SQL.
- Repository seharusnya menyembunyikan persistence detail yang tidak perlu diketahui use case, tetapi tidak boleh menyembunyikan cost dan semantics penting.

---

## 10. Entity Bukan DTO

Entity adalah object yang memiliki identity dan lifecycle persistence. DTO adalah data transfer object.

Jika entity dipakai sebagai DTO:

- API contract terikat schema internal.
- Lazy field bisa terakses saat serialization.
- Sensitive field bisa bocor.
- Client bisa mengirim field yang tidak boleh diubah.
- Bidirectional relationship bisa infinite recursion.
- Partial update bisa menimpa data.
- Persistence behavior masuk ke boundary API.

Contoh buruk:

```java
@PostMapping("/cases/{id}")
public CaseRecord update(@PathVariable Long id, @RequestBody CaseRecord input) {
    return caseService.update(id, input);
}
```

Masalah:

- Client bisa mengirim `status`, `createdBy`, `createdAt`, `assignedOfficer`, atau relationship internal.
- Sulit membedakan absent field vs null field.
- Entity lifecycle tercampur dengan request lifecycle.

Lebih baik:

```java
public record UpdateCaseRemarksRequest(
    String remarks,
    Long expectedVersion
) {}

public record CaseDetailResponse(
    Long id,
    String caseNo,
    String status,
    String applicantName,
    String remarks,
    Long version
) {}
```

Entity tetap internal. API punya contract eksplisit.

---

## 11. ORM Tidak Menghapus SQL

ORM menghasilkan SQL. Jadi SQL tetap ada. Perbedaannya, SQL sering tidak terlihat langsung di source code.

Ini menciptakan bahaya: engineer merasa tidak menulis SQL, padahal production database tetap menjalankan SQL.

Hal yang harus selalu dipikirkan:

- Berapa query yang dieksekusi?
- Query apa saja?
- Apakah join-nya benar?
- Apakah index digunakan?
- Berapa row yang dibaca?
- Berapa column yang diambil?
- Apakah query melakukan full table scan?
- Apakah pagination terjadi di database atau memory?
- Apakah collection lazy memicu N+1?
- Apakah query count untuk pagination mahal?
- Apakah update memegang lock terlalu lama?

Contoh kode sederhana:

```java
List<CaseRecord> cases = caseRepository.findByStatus(Status.SUBMITTED);

for (CaseRecord c : cases) {
    System.out.println(c.getApplicant().getName());
}
```

Bisa menjadi:

```text
1 query untuk cases
N query untuk applicant masing-masing case
```

Ini N+1. Kode Java terlihat kecil, SQL runtime bisa banyak.

Prinsip: setiap repository method harus punya expected query shape.

---

## 12. Read Path dan Write Path Tidak Sama

Banyak desain buruk muncul karena satu entity dipakai untuk semua kebutuhan:

- create form,
- update form,
- detail page,
- listing page,
- reporting,
- export,
- audit,
- search,
- workflow transition.

Padahal kebutuhan tiap path berbeda.

### 12.1 Write Path

Write path butuh:

- invariant enforcement,
- transaction boundary,
- locking/versioning,
- audit,
- event/outbox,
- validation,
- permission check.

Entity cocok di sini karena entity dapat membawa behavior dan consistency.

### 12.2 Read Path

Read path butuh:

- data shape spesifik,
- performa,
- filtering,
- sorting,
- pagination,
- projection,
- join eksplisit,
- kadang denormalized read model.

Projection/DTO/native query sering lebih cocok.

Contoh:

```java
public record CaseListingRow(
    Long id,
    String caseNo,
    String applicantName,
    String status,
    Instant submittedAt,
    String assignedOfficerName
) {}
```

Listing tidak perlu load full `CaseRecord` aggregate dengan seluruh relationship.

---

## 13. Persistence Layer dalam Sistem Enterprise

Dalam sistem enterprise/case management/regulatory, persistence layer biasanya harus menjawab requirement non-trivial:

- Multi-role authorization.
- Workflow state machine.
- Escalation logic.
- Audit trail.
- Historical view.
- Document metadata.
- Correspondence.
- Report.
- Data retention.
- Archival.
- Cross-module reference.
- Integration dengan external system.
- SLA tracking.
- Manual correction.
- Operational support.

Dalam konteks seperti ini, desain persistence tidak boleh hanya berdasarkan table.

Lebih masuk akal memikirkan:

- Aggregate apa yang dimutasi bersama?
- Query apa yang high-volume?
- Data apa yang immutable?
- Data apa yang legally auditable?
- Data apa yang boleh soft delete?
- Data apa yang harus hard delete karena privacy/retention?
- Field apa yang sering dicari?
- Index apa yang dibutuhkan?
- Workflow transition apa yang concurrent?
- External event apa yang harus keluar setelah commit?

---

## 14. Boundary Tanggung Jawab: Layer by Layer

### 14.1 Controller/API Layer

Tanggung jawab:

- Menerima request.
- Validasi bentuk input dasar.
- Authentication/authorization entry point.
- Mapping request ke command/query.
- Mapping result ke response.

Bukan tanggung jawab:

- Memanipulasi entity secara langsung.
- Membuka transaction kompleks.
- Menentukan fetch strategy detail.
- Menyimpan audit detail secara manual tanpa use case.

### 14.2 Application Service Layer

Tanggung jawab:

- Orkestrasi use case.
- Transaction boundary.
- Authorization rule yang berhubungan dengan use case.
- Memanggil repository/query service/domain service.
- Menentukan kapan audit/outbox dibuat.
- Mengelola idempotency.

Ini sering menjadi tempat paling natural untuk `@Transactional`.

### 14.3 Domain Layer / Entity Behavior

Tanggung jawab:

- Rule bisnis yang melekat pada aggregate/entity.
- State transition valid.
- Guard invariant lokal.
- Menghindari setter bebas untuk field penting.

Contoh:

```java
public void approve(Actor actor, Instant approvedAt) {
    if (this.status != Status.UNDER_REVIEW) {
        throw new InvalidCaseTransitionException(this.status, Status.APPROVED);
    }
    if (this.submittedBy.equals(actor.userId())) {
        throw new SelfApprovalNotAllowedException();
    }
    this.status = Status.APPROVED;
    this.approvedBy = actor.userId();
    this.approvedAt = approvedAt;
}
```

### 14.4 Repository

Tanggung jawab:

- Load aggregate/entity untuk use case.
- Persist aggregate/entity.
- Encapsulate query mechanics yang relevan.
- Memberi method yang sesuai intent, bukan sekadar generic CRUD.

### 14.5 Query Service / Read Repository

Tanggung jawab:

- Listing.
- Search.
- Report.
- Timeline.
- Projection.
- Native SQL bila perlu.

### 14.6 Database

Tanggung jawab:

- Durability.
- Constraint final.
- Index.
- Lock/isolation.
- Execution plan.
- Referential integrity.

---

## 15. The Persistence Correctness Stack

Untuk sistem yang kuat, correctness biasanya dibangun bertingkat:

```text
UI constraint
  ↓
Request DTO validation
  ↓
Application authorization + use-case rule
  ↓
Domain invariant / state transition
  ↓
JPA mapping correctness
  ↓
Database constraint
  ↓
Transaction isolation / locking
  ↓
Audit / outbox / observability
```

Jangan hanya mengandalkan satu lapisan.

Contoh uniqueness:

- UI bisa memberi feedback cepat.
- DTO validation memastikan format.
- Service melakukan business check untuk pesan error bagus.
- Database unique constraint memastikan tidak ada race condition.
- Exception translation mengubah duplicate key menjadi error domain.
- Audit mencatat attempt bila perlu.

---

## 16. Unit of Work Timeline: Apa yang Terjadi Saat Request Menulis Data?

Contoh use case:

```java
@Transactional
public void changeApplicantAddress(ChangeAddressCommand command) {
    Application app = applicationRepository.get(command.applicationId());
    app.changeAddress(command.newAddress(), command.actor(), clock.now());
    auditTrail.recordAddressChanged(app, command.actor());
}
```

Timeline konseptual:

1. Request masuk.
2. Application service dipanggil.
3. Transaction dimulai.
4. Persistence context dibuat/di-bind ke transaction.
5. Repository memanggil `EntityManager.find()` atau query.
6. Hibernate menghasilkan SQL select.
7. JDBC menjalankan SQL via connection.
8. Row database di-hydrate menjadi entity.
9. Entity masuk persistence context sebagai managed.
10. Method domain mengubah field entity.
11. Hibernate belum tentu langsung update database.
12. Audit entity dibuat dan dipersist.
13. Sebelum commit, flush terjadi.
14. Hibernate dirty checking.
15. SQL update/insert dikirim.
16. Database constraint dicek.
17. Transaction commit.
18. Connection dikembalikan ke pool.
19. Persistence context selesai; entity menjadi detached.
20. Response dikirim.

Bug bisa muncul di setiap titik.

Contoh:

- Step 6: SQL select terlalu banyak join.
- Step 8: hydration terlalu mahal.
- Step 10: domain method lupa guard transition.
- Step 13: flush terjadi lebih awal karena query tambahan.
- Step 16: constraint violation muncul saat flush, bukan saat `persist()`.
- Step 17: commit gagal karena deadlock.
- Step 19: response serializer mencoba akses lazy field setelah context closed.

---

## 17. Flush Bukan Commit

Ini konsep yang sering salah.

- **Flush**: sinkronisasi perubahan persistence context ke database melalui SQL `insert/update/delete`.
- **Commit**: mengakhiri transaction dan membuat perubahan durable/visible sesuai isolation database.

Flush bisa terjadi sebelum commit.

Misalnya:

```java
@Transactional
public void example() {
    User user = entityManager.find(User.class, 1L);
    user.changeName("A");

    entityManager.createQuery("select count(u) from User u", Long.class)
        .getSingleResult(); // bisa trigger flush sebelum query

    // commit belum terjadi
}
```

Kenapa penting?

- Constraint violation bisa muncul sebelum akhir method.
- SQL update bisa memegang lock sebelum commit.
- Query setelah perubahan bisa melihat perubahan yang sudah di-flush dalam transaction yang sama.
- Bulk operation bisa berinteraksi aneh dengan persistence context.

---

## 18. Lazy Loading: Convenience yang Harus Dikendalikan

Lazy loading membuat relationship tidak langsung di-load sampai diakses. Ini berguna, tetapi bisa menjadi jebakan.

Contoh:

```java
CaseRecord c = caseRepository.findById(id).orElseThrow();
String name = c.getApplicant().getName();
```

Jika `applicant` lazy, akses `getApplicant()` bisa memicu query tambahan.

Risiko lazy loading:

- N+1.
- Query terjadi di tempat yang tidak terlihat.
- LazyInitializationException setelah transaction selesai.
- Serialization memicu query tak terkendali.
- Performance tidak deterministik.

Prinsip:

- Fetch plan harus didesain per use case.
- Jangan mengandalkan “nanti lazy loading saja”.
- Untuk detail page, gunakan fetch join/entity graph/projection sesuai kebutuhan.
- Untuk listing, hampir selalu projection lebih aman.

---

## 19. Versioning dan Concurrency

Dalam sistem multi-user, dua request bisa membaca row yang sama lalu update bersamaan.

Contoh lost update:

1. User A membaca case version 1.
2. User B membaca case version 1.
3. User A update remarks menjadi “A”. Commit.
4. User B update remarks menjadi “B”. Commit.
5. Perubahan A hilang.

Optimistic locking dengan `@Version` membantu:

```java
@Version
private long version;
```

Update akan menyertakan version di `where` clause secara konseptual:

```sql
update case_record
set remarks = ?, version = version + 1
where id = ? and version = ?;
```

Jika row count 0, berarti data sudah berubah. Aplikasi harus menangani conflict.

Optimistic lock bukan hanya fitur teknis. Ia adalah UX dan business decision:

- Apakah user diminta reload?
- Apakah perubahan bisa merge?
- Apakah command bisa retry otomatis?
- Apakah retry aman untuk side effect?

---

## 20. Pessimistic Locking dan High Contention

Optimistic locking cocok saat konflik jarang. Jika konflik sering dan resource benar-benar harus serial, pessimistic locking bisa diperlukan.

Contoh:

- Queue worker mengambil task.
- Reservation kuota terbatas.
- Sequential number generator tertentu.
- State transition yang tidak boleh paralel.

Pessimistic lock biasanya menghasilkan SQL seperti `select ... for update`.

Risiko:

- Lock wait.
- Deadlock.
- Throughput turun.
- Transaction panjang memperburuk contention.

Prinsip:

- Gunakan lock sesingkat mungkin.
- Tentukan urutan lock yang konsisten.
- Hindari external call saat lock dipegang.
- Pakai timeout.
- Pastikan retry policy jelas.

---

## 21. Mapping Bukan Sekadar Annotation

Mapping adalah kontrak antara object model dan schema database.

Contoh field:

```java
@Column(name = "application_no", nullable = false, length = 50, unique = true)
private String applicationNo;
```

Hal yang harus dipikirkan:

- Apakah database benar-benar `not null`?
- Apakah ada unique constraint di migration?
- Apakah length cukup untuk semua format masa depan?
- Apakah collation memengaruhi uniqueness case-sensitive/case-insensitive?
- Apakah index dibutuhkan untuk lookup?
- Apakah field immutable setelah create?
- Apakah field masuk audit?

Annotation adalah representasi mapping, bukan desain mapping itu sendiri.

---

## 22. Database Constraint adalah Safety Net Terakhir

Application check bisa gagal karena concurrency. Database constraint adalah guard terakhir.

Constraint penting:

- Primary key.
- Foreign key.
- Unique constraint.
- Not null.
- Check constraint.
- Exclusion constraint pada database tertentu.
- Deferrable constraint pada database tertentu.

Contoh state transition sulit dijaga hanya dengan constraint, tetapi beberapa invariant struktural tetap bisa diletakkan di DB.

Contoh:

```sql
alter table case_record
add constraint chk_case_status
check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'));
```

Jangan berpikir “validasi sudah di Java, jadi DB constraint tidak perlu”. Dalam sistem serius, DB constraint adalah bagian dari desain correctness.

---

## 23. Audit, Event, dan Persistence

Audit dan event sering dicampur, padahal berbeda.

### 23.1 Audit

Audit menjawab:

- Siapa melakukan apa?
- Kapan?
- Nilai sebelum/sesudah apa?
- Dari channel mana?
- Dengan alasan apa?
- Correlation id apa?

Audit untuk explainability dan defensibility.

### 23.2 Domain Event

Domain event menyatakan sesuatu yang bermakna sudah terjadi di domain.

Contoh:

- `CaseSubmitted`
- `AppealCreated`
- `OfficerAssigned`
- `ComplianceBreachDetected`

Event bisa dipakai untuk integrasi, notifikasi, downstream projection, atau workflow lanjutan.

### 23.3 Outbox

Outbox menyimpan event dalam database yang sama dengan aggregate update. Ini menghindari dual-write problem antara DB dan message broker.

Dalam transaction:

```text
update case status
insert audit row
insert outbox event
commit
```

Setelah commit, publisher membaca outbox dan mengirim ke broker.

Ini lebih robust daripada publish message langsung di tengah transaction.

---

## 24. Migration dan Schema Evolution

Persistence design tidak selesai saat entity compile. Schema berubah seiring sistem berkembang.

Pertanyaan migration:

- Apakah perubahan backward compatible?
- Apakah aplikasi versi lama dan baru bisa berjalan bersamaan saat rolling deployment?
- Apakah column baru nullable dulu?
- Bagaimana backfill dilakukan?
- Kapan constraint ditambahkan?
- Apakah index dibuat online?
- Apakah rename column aman?
- Apakah data lama valid terhadap rule baru?

Strategi umum zero-downtime:

1. **Expand**: tambah struktur baru tanpa merusak versi lama.
2. **Migrate**: isi/backfill data.
3. **Switch**: aplikasi mulai memakai struktur baru.
4. **Contract**: hapus struktur lama setelah aman.

JPA schema generation boleh membantu development, tetapi production sebaiknya menggunakan migration eksplisit seperti Flyway/Liquibase atau mekanisme change management yang setara.

---

## 25. Performance Model Persistence

Performance persistence bukan hanya “query cepat”. Modelnya melibatkan banyak biaya:

1. Query count.
2. Network roundtrip.
3. Rows scanned.
4. Rows returned.
5. Columns returned.
6. Join cost.
7. Index selectivity.
8. Hydration entity.
9. Dirty checking.
10. Persistence context size.
11. Lock wait.
12. Connection wait.
13. Cache hit/miss.
14. Serialization response.
15. Transaction duration.

Contoh performa buruk:

```java
Page<CaseRecord> page = caseRepository.findByStatus(SUBMITTED, pageable);
return page.map(caseMapper::toResponse);
```

Jika mapper mengakses banyak lazy relationship, satu page bisa menghasilkan puluhan/ratusan query.

Model lebih eksplisit:

```java
Page<CaseListingRow> page = caseListingQuery.search(criteria, pageable);
```

Query listing dapat dibuat projection dengan join yang diperlukan saja.

---

## 26. Observability: Persistence Harus Bisa Dilihat

Sistem persistence yang baik bisa dijelaskan saat incident.

Minimal yang perlu terlihat:

- SQL lambat.
- Query count per request/use case.
- Connection pool active/idle/pending.
- Transaction duration.
- Lock wait.
- Deadlock count.
- Timeout.
- Rollback count.
- Hibernate entity load/fetch count.
- Flush count.
- Batch execution.
- Cache hit/miss.
- Correlation id dari request ke SQL/log.

Tanpa observability, bug persistence menjadi spekulasi.

Contoh incident:

- API 504.
- Thread pool penuh.
- Connection pool exhausted.
- DB CPU tinggi.
- Ada query listing tanpa index.
- Satu endpoint memicu N+1.
- Transaction panjang menahan lock.

Engineer top-tier tidak hanya “menambah timeout”. Ia mencari causal chain.

---

## 27. Anti-Pattern Besar dalam Persistence

### 27.1 Entity sebagai API Contract

Gejala:

- Controller menerima/mengembalikan entity.
- Lazy serialization error.
- Field sensitif bocor.
- Client bisa update field internal.

Perbaikan:

- Gunakan request/response DTO eksplisit.
- Mapping di boundary.

### 27.2 Repository sebagai Generic CRUD untuk Semua

Gejala:

- Semua entity punya `GenericRepository<T, ID>`.
- Use case hanya memanggil `save()` dan `findById()`.
- Rule bisnis tersebar.

Perbaikan:

- Repository method berdasarkan intent/use case.
- Pisahkan command repository dan query service.

### 27.3 Open Session in View sebagai Penopang Desain Lemah

Gejala:

- Lazy loading terjadi saat render response.
- Query muncul di serializer/view.
- Transaction boundary kabur.

Perbaikan:

- Desain fetch plan di service/query layer.
- Gunakan projection/entity graph/fetch join.

### 27.4 Semua Query Dipaksa ORM

Gejala:

- Reporting query kompleks dipaksa jadi object graph.
- Banyak relationship hanya demi read page.
- SQL sulit dikontrol.

Perbaikan:

- Gunakan projection/native SQL/read model bila tepat.

### 27.5 Transaction Terlalu Besar

Gejala:

- External API call di dalam transaction.
- User think time masuk transaction.
- Batch besar satu transaction.
- Lock ditahan lama.

Perbaikan:

- Perkecil boundary.
- Gunakan chunking.
- Gunakan outbox.
- Jangan campur network side effect dengan DB transaction tanpa desain eksplisit.

### 27.6 Application-Only Constraint

Gejala:

- Check uniqueness dengan query sebelum insert tanpa DB unique constraint.
- Race condition.

Perbaikan:

- DB constraint final.
- Exception translation.

### 27.7 Blind `merge()`

Gejala:

- Detached object dari request di-merge ke persistence context.
- Field null menimpa data.
- Data lama overwrite.

Perbaikan:

- Load managed entity lalu apply command field eksplisit.

### 27.8 Fetch Everything

Gejala:

- Semua relationship eager.
- Query join besar.
- Cartesian explosion.

Perbaikan:

- Default lazy untuk relationship besar.
- Fetch plan per use case.

---

## 28. Design Heuristics untuk Engineer Senior

Gunakan pertanyaan ini saat mendesain persistence feature.

### 28.1 Saat Membuat Entity

- Apa identity-nya?
- Apakah ada natural key?
- Apakah natural key immutable?
- Field mana yang mandatory?
- Field mana yang immutable setelah create?
- Relationship mana yang benar-benar aggregate boundary?
- Apakah collection bisa tumbuh besar?
- Apakah cascade aman?
- Apakah delete benar-benar delete atau soft delete?
- Apakah entity ini cocok sebagai write model?

### 28.2 Saat Membuat Repository

- Use case apa yang dilayani?
- Apakah method ini load aggregate untuk mutation atau projection untuk read?
- Query shape-nya apa?
- Apakah perlu locking?
- Apakah return entity aman?
- Apakah pagination count mahal?
- Apakah sorting/filtering tervalidasi?

### 28.3 Saat Menentukan Transaction

- Apa yang harus atomic?
- Apakah ada external side effect?
- Apakah perlu outbox?
- Apakah retry aman?
- Apakah isolation default cukup?
- Apakah ada lost update risk?
- Apakah transaction terlalu lama?

### 28.4 Saat Menentukan Constraint

- Invariant apa yang harus mustahil dilanggar?
- Apakah invariant bisa dilanggar oleh race condition?
- Constraint apa yang harus ada di DB?
- Bagaimana error constraint diterjemahkan?
- Apakah constraint bisa ditambahkan ke data existing?

### 28.5 Saat Menentukan Fetch Strategy

- Data apa yang benar-benar dibutuhkan response?
- Apakah entity graph diperlukan?
- Apakah projection lebih tepat?
- Apakah collection size bounded?
- Apakah pagination aman dengan fetch join?
- Apakah ada N+1?

### 28.6 Saat Menentukan Integration Event

- Event dibuat sebelum atau setelah commit?
- Apakah event disimpan di outbox?
- Apakah consumer idempotent?
- Apakah event ordering penting?
- Apakah payload event berisi snapshot atau reference id?
- Bagaimana retry dan dead-letter?

---

## 29. Contoh Mini Architecture: Case Management Persistence

Misal kita punya domain case management:

- Applicant submit application.
- Officer review.
- Officer request clarification.
- Applicant resubmit.
- Supervisor approve/reject.
- Audit trail wajib.
- Notification dikirim.
- Listing dan reporting banyak.

### 29.1 Jangan Mulai dari Table Saja

Desain lemah:

```text
case table -> CaseEntity -> CaseRepository CRUD
applicant table -> ApplicantEntity -> ApplicantRepository CRUD
audit table -> AuditRepository CRUD
```

Desain ini belum menjawab workflow.

### 29.2 Mulai dari Use Case dan Invariant

Use case:

- `SubmitApplication`
- `AssignOfficer`
- `RequestClarification`
- `ResubmitClarification`
- `ApproveCase`
- `RejectCase`
- `SearchCaseListing`
- `ViewCaseTimeline`

Invariant:

- Application number unique.
- Draft hanya bisa submit oleh owner.
- Review hanya bisa dilakukan officer assigned.
- Approval tidak boleh oleh submitter yang sama jika rule mengharuskan segregation of duty.
- Clarification hanya bisa diminta saat under review.
- Closed case tidak boleh dimutasi kecuali reopening flow eksplisit.

### 29.3 Persistence Components

```text
ApplicationService:
  - transaction boundary
  - authorization orchestration
  - calls aggregate/repository/audit/outbox

CaseRecord entity:
  - state transition behavior
  - local invariant
  - versioning

CaseRepository:
  - get aggregate for mutation
  - optional lock method where needed

CaseListingQuery:
  - projection for listing
  - pagination/filtering/sorting

CaseTimelineQuery:
  - audit/event projection

AuditTrailRepository:
  - append audit entries

OutboxRepository:
  - append integration events transactionally
```

### 29.4 Transaction Example

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseRecord caseRecord = caseRepository.get(command.caseId());

    authorizationPolicy.checkCanApprove(command.actor(), caseRecord);

    caseRecord.approve(command.actor(), clock.now());

    auditTrail.append(AuditEntry.caseApproved(
        caseRecord.id(),
        command.actor().userId(),
        clock.now(),
        command.reason(),
        correlationId.current()
    ));

    outbox.append(CaseApprovedEvent.from(caseRecord));
}
```

Hal yang sengaja terjadi:

- Mutasi status, audit, dan outbox berada dalam satu local DB transaction.
- Notification tidak dikirim langsung.
- Entity mengontrol transition.
- Service mengontrol authorization dan orchestration.
- Versioning bisa mencegah lost update.

---

## 30. Version dan Migration Awareness: Java 8 sampai 25

Karena seri ini mencakup Java 8 sampai 25, perlu sadar generasi teknologi.

### 30.1 Era Java 8 / Java EE / JPA 2.x

Umum ditemukan:

- `javax.persistence.*`
- JPA 2.1/2.2
- Hibernate 5.x
- Spring Boot 2.x
- Java EE server lama

Karakteristik:

- Banyak aplikasi enterprise masih memakai namespace `javax`.
- Migrasi ke Jakarta tidak hanya rename import jika library ecosystem belum kompatibel.
- Hibernate 5 behavior berbeda dari Hibernate 6 dalam beberapa query/type/dialect behavior.

### 30.2 Era Java 17+ / Jakarta EE / Jakarta Persistence 3.x

Umum ditemukan:

- `jakarta.persistence.*`
- Jakarta Persistence 3.0/3.1/3.2
- Hibernate 6.x/7.x
- Spring Boot 3.x

Karakteristik:

- Namespace pindah dari `javax` ke `jakarta`.
- Hibernate 6 membawa perubahan besar pada query engine, type system, dan SQL generation.
- Hibernate 7 bergerak dengan baseline Java modern dan Jakarta Persistence terbaru.

### 30.3 Java 21/25 Consideration

Java modern membawa fitur bahasa/runtime yang membantu desain persistence, tetapi tidak menghapus constraint ORM:

- `record` cocok untuk DTO/projection, bukan entity mutable tradisional kecuali specification/provider mendukung use case tertentu.
- Virtual threads membantu concurrency blocking I/O, tetapi database connection tetap resource terbatas.
- Pattern matching/sealed class membantu domain modeling, tetapi ORM inheritance mapping tetap punya trade-off.
- Modern GC membantu memory, tetapi persistence context bloat tetap desain buruk.

Prinsip: fitur Java modern meningkatkan ergonomics, bukan mengganti pemahaman database.

---

## 31. Bagaimana Membaca Dokumentasi Persistence

Untuk menjadi sangat kuat, biasakan membaca sumber dengan urutan:

1. **Specification** untuk kontrak portable.
2. **Provider documentation** untuk behavior aktual.
3. **Database documentation** untuk locking/isolation/index/SQL behavior.
4. **Framework documentation** untuk integration semantics.
5. **Production metrics/logs** untuk fakta runtime.

Contoh:

- Untuk `@Version`, baca JPA/Jakarta Persistence concept, lalu Hibernate behavior, lalu SQL yang dihasilkan, lalu bagaimana database mengunci row.
- Untuk transaction, baca Jakarta Transactions/Spring transaction, lalu provider behavior, lalu database isolation.
- Untuk pagination, baca framework API, lalu SQL generated, lalu execution plan.

Jangan berhenti di blog/tutorial jika masalahnya menyangkut correctness produksi.

---

## 32. Checklist Mental Sebelum Menulis Kode Persistence

Sebelum implement feature persistence, jawab ini:

```text
1. Use case ini read, write, atau integration side effect?
2. Data apa yang harus atomic?
3. Transaction boundary-nya di method mana?
4. Entity apa yang harus managed?
5. Apakah entity atau projection yang lebih tepat?
6. Query shape yang diharapkan apa?
7. Apakah ada N+1 risk?
8. Apakah ada lost update risk?
9. Apakah perlu optimistic/pessimistic locking?
10. Invariant apa yang harus dijaga domain?
11. Constraint apa yang harus dijaga database?
12. Apakah ada external call/event?
13. Apakah perlu outbox/idempotency?
14. Bagaimana audit dicatat?
15. Bagaimana error database diterjemahkan?
16. Bagaimana observability-nya?
17. Bagaimana migration schema-nya?
18. Bagaimana test membuktikan correctness?
```

Jika banyak jawaban belum jelas, jangan langsung membuat repository method.

---

## 33. Vocabulary Awal yang Harus Dikuasai

| Istilah | Makna Praktis |
|---|---|
| Entity | Object Java yang punya persistence identity dan lifecycle |
| Persistence Context | Unit of work dan identity map untuk managed entity |
| Managed Entity | Entity yang sedang dilacak oleh persistence context |
| Detached Entity | Entity yang pernah managed tetapi context-nya sudah selesai |
| Dirty Checking | Mekanisme mendeteksi perubahan entity managed |
| Flush | Sinkronisasi perubahan ke DB lewat SQL, bukan commit |
| Commit | Mengakhiri transaction dan membuat perubahan durable |
| JPQL | Query object/entity model portable JPA |
| HQL | Hibernate query language, superset/provider-specific |
| Fetch Join | Query join yang juga menginisialisasi association |
| Entity Graph | Deklarasi fetch plan untuk use case tertentu |
| N+1 | Satu query utama + N query tambahan karena lazy association |
| Optimistic Lock | Conflict detection menggunakan version |
| Pessimistic Lock | Lock database untuk mencegah concurrent modification |
| Outbox | Table event yang ditulis satu transaction dengan state change |
| Projection | DTO/read model dari query, bukan managed entity penuh |
| Migration | Perubahan schema/data terkontrol |
| Dialect | Adaptasi ORM terhadap SQL vendor database |

---

## 34. Latihan Berpikir

### Scenario 1 — Update Profile

User mengubah alamat profile.

Pertanyaan:

- Apakah perlu load full profile entity?
- Apakah perlu audit before/after?
- Apakah update boleh concurrent?
- Apakah address punya value object?
- Apakah ada validation postal code?
- Apakah event perlu dikirim?

### Scenario 2 — Approve Case

Officer approve case.

Pertanyaan:

- Status awal apa yang valid?
- Siapa boleh approve?
- Apakah perlu version?
- Apa yang terjadi jika dua officer approve bersamaan?
- Apakah notification dikirim langsung atau via outbox?
- Apakah audit mencatat reason?

### Scenario 3 — Listing 10.000 Case

UI menampilkan listing case dengan filter status, tanggal submit, officer, applicant name.

Pertanyaan:

- Entity atau projection?
- Index apa yang dibutuhkan?
- Apakah count query mahal?
- Apakah sorting stable?
- Apakah filter applicant name butuh search index?
- Apakah pagination offset cukup atau perlu keyset?

### Scenario 4 — Batch Close Expired Draft

Job menutup draft yang expired.

Pertanyaan:

- Satu transaction besar atau chunk?
- Apakah entity lifecycle diperlukan atau bulk update cukup?
- Apakah audit per row wajib?
- Apakah event per case wajib?
- Bagaimana retry jika chunk gagal?
- Bagaimana mencegah job paralel mengerjakan row yang sama?

---

## 35. Ringkasan

Persistence adalah salah satu boundary paling kritis dalam sistem backend. Ia bukan sekadar CRUD dan bukan sekadar annotation. Ia adalah tempat bertemunya object model, relational model, transaction model, consistency model, integration model, dan operational model.

JPA/Jakarta Persistence memberi standard ORM. Hibernate memberi implementation dan banyak fitur tambahan. Jakarta Data memberi repository abstraction standard di ekosistem Jakarta. Jakarta Transactions memberi API transaction coordination/demarcation. Spring Data/Spring Transaction memberi abstraction populer di ekosistem Spring. Namun semua abstraction itu tetap berdiri di atas database nyata, SQL nyata, lock nyata, constraint nyata, dan failure nyata.

Mental model utama bagian ini:

1. Entity punya identity dan lifecycle; entity bukan DTO.
2. Persistence context adalah unit of work; perubahan bisa di-flush otomatis.
3. Flush bukan commit.
4. Repository bukan table wrapper.
5. Transaction boundary adalah desain use case.
6. Database constraint adalah safety net correctness.
7. ORM tidak menghapus SQL; ia menghasilkan SQL.
8. Read path dan write path sering butuh model berbeda.
9. External side effect harus didesain dengan outbox/idempotency, bukan disisipkan sembarang dalam transaction.
10. Production persistence harus observable.

Jika prinsip-prinsip ini kuat, annotation dan API detail pada part berikutnya akan jauh lebih mudah dipahami secara benar.

---

## 36. Referensi Utama

Referensi ini digunakan sebagai anchor untuk terminologi dan posisi teknologi. Detail implementasi akan diperdalam di part-part berikutnya.

1. Jakarta Persistence 3.2 Specification — `https://jakarta.ee/specifications/persistence/3.2/`
2. Jakarta Persistence 3.2 Specification Document — `https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2`
3. Jakarta Data 1.0 Specification — `https://jakarta.ee/specifications/data/1.0/`
4. Jakarta Data 1.1 Development Page — `https://jakarta.ee/specifications/data/1.1/`
5. Jakarta Transactions 2.0 Specification — `https://jakarta.ee/specifications/transactions/2.0/`
6. Jakarta Transactions Specification Document — `https://jakarta.ee/specifications/transactions/2.0/jakarta-transactions-spec-2.0.html`
7. Hibernate ORM Documentation — `https://hibernate.org/orm/documentation/`
8. Hibernate ORM User Guide — `https://docs.hibernate.org/stable/orm/userguide/html_single/`

---

## 37. Status Seri

Part ini adalah **Part 000 dari 032**.

Seri **belum selesai**. Bagian berikutnya:

```text
Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-001.md">Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions ➡️</a>
</div>
