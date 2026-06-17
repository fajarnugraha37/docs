# Part 25 — EclipseLink Deep Dive: Sessions, Descriptors, Weaving, Cache, and Advanced Mappings

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: `25 / 34`  
> File: `25-eclipselink-sessions-descriptors-weaving-cache-advanced-mappings.md`

---

## 0. Tujuan Bagian Ini

Bagian ini membahas EclipseLink sebagai **JPA provider nyata**, bukan hanya sebagai alternatif Hibernate. Tujuannya bukan membuat kita hafal semua annotation EclipseLink, tetapi memahami **mesin internal** yang membuat EclipseLink berbeda:

- bagaimana `EntityManagerFactory` di JPA diterjemahkan menjadi **Session** dan **ServerSession**,
- bagaimana metadata entity dibentuk menjadi **Descriptor**,
- bagaimana EclipseLink melakukan **UnitOfWork** untuk tracking perubahan,
- bagaimana **weaving** memungkinkan lazy loading, change tracking, fetch group, dan optimisasi runtime,
- bagaimana **shared cache** EclipseLink bekerja dan kapan ia berbahaya,
- bagaimana fitur advanced mapping seperti fetch group, batch reading, join fetching, converter, descriptor customizer, dan transformation mapping memengaruhi correctness/performance,
- bagaimana membaca failure mode EclipseLink dalam production system.

Setelah bagian ini, targetnya: ketika melihat aplikasi memakai EclipseLink, kita tidak memperlakukannya seperti “Hibernate with different dependency”. Kita mampu membaca arsitektur provider-nya, memahami konsekuensi konfigurasi, dan mengambil keputusan engineering yang defensible.

---

## 1. Posisi EclipseLink dalam Ekosistem JPA/Jakarta Persistence

### 1.1 EclipseLink sebagai provider, bukan sekadar library mapping

Dalam aplikasi JPA/Jakarta Persistence, kode aplikasi biasanya berinteraksi dengan abstraction:

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("appPU");
EntityManager em = emf.createEntityManager();
```

Secara specification-level, kita melihat:

- `EntityManagerFactory`,
- `EntityManager`,
- persistence context,
- transaction,
- entity lifecycle,
- JPQL/Criteria/native query.

Tetapi saat provider-nya EclipseLink, abstraction tersebut dibangun di atas konsep internal seperti:

- `Session`,
- `ServerSession`,
- `UnitOfWork`,
- `ClassDescriptor`,
- `DatabaseMapping`,
- identity map/cache,
- weaving,
- query hint processor,
- database platform,
- descriptor event/listener/customizer.

Mental model penting:

```text
JPA API
  ↓
EclipseLink JPA integration layer
  ↓
EclipseLink session + descriptor + unit-of-work engine
  ↓
SQL generation + cache + change tracking + database platform
  ↓
JDBC / transaction manager / database
```

### 1.2 Kenapa EclipseLink layak dipelajari mendalam

Walaupun Hibernate lebih dominan di banyak Spring ecosystem, EclipseLink tetap penting karena:

1. EclipseLink historis kuat di Jakarta EE/container environment.
2. Banyak application server menjadikannya default atau first-class provider.
3. Ia memiliki arsitektur internal yang berbeda dari Hibernate.
4. Ia punya fitur advanced seperti weaving, shared cache, fetch group, descriptor customization, transformation mapping, MOXy, dan extended mapping behavior.
5. Ia sering muncul di enterprise/government/legacy system yang berjalan bertahun-tahun.
6. Provider portability ke/dari EclipseLink sering gagal jika tim hanya memahami “JPA annotation surface”.

### 1.3 Versi dan namespace yang harus dipahami

Untuk Java 8–25, peta besar EclipseLink adalah:

| Era | API namespace | Common provider line | Runtime concern |
|---|---|---:|---|
| Java 8 legacy | `javax.persistence` | EclipseLink 2.x | JPA 2.1/2.2, Java EE/Jakarta transition risk |
| Java 11+ transition | `jakarta.persistence` | EclipseLink 3.x | Jakarta EE 9 namespace migration |
| Java 11/17+ modern Jakarta EE 10 | `jakarta.persistence` | EclipseLink 4.x | Jakarta Persistence 3.1 style ecosystem |
| Java 17/21/25 modern Jakarta EE 11+ | `jakarta.persistence` | EclipseLink 5.x | Jakarta Persistence 3.2 modernization |

Prinsip penting:

- Jangan mencampur `javax.persistence.*` dan `jakarta.persistence.*` dalam satu runtime.
- Jangan menganggap semua behavior EclipseLink 2.x otomatis sama dengan 4.x/5.x.
- Jangan menganggap semua fitur Hibernate punya padanan langsung di EclipseLink.
- Jangan menganggap JPA portability berarti konfigurasi cache/weaving/fetch behavior portable.

---

## 2. Mental Model EclipseLink: Session + Descriptor + UnitOfWork

### 2.1 Tiga pilar internal EclipseLink

EclipseLink dapat dipahami melalui tiga pilar:

```text
Descriptor
  = metadata bagaimana class dipetakan ke storage

Session
  = runtime access point yang memegang database connection policy,
    cache, login, platform, query execution, transaction coordination

UnitOfWork
  = scope perubahan object yang akan disinkronkan ke database
```

Dalam istilah sederhana:

| Konsep | Tugas |
|---|---|
| Descriptor | Menjawab: “class ini disimpan di mana dan bagaimana?” |
| Session | Menjawab: “provider ini beroperasi terhadap database dengan konfigurasi apa?” |
| UnitOfWork | Menjawab: “object mana berubah dan SQL apa yang harus dilakukan?” |

### 2.2 Perbandingan dengan mental model Hibernate

| Area | Hibernate | EclipseLink |
|---|---|---|
| Factory utama | `SessionFactory` | `ServerSession`/JPA `EntityManagerFactory` backed by sessions |
| Work context | `Session` + persistence context | `UnitOfWork` through `EntityManager` |
| Metadata | entity persister, mapping model | `ClassDescriptor`, mapping descriptors |
| First-level cache | persistence context identity map | UnitOfWork identity map/clone model |
| Shared cache | second-level cache optional | shared cache is a prominent native concept |
| Enhancement | bytecode enhancement | weaving |
| Fetch customization | fetch joins, entity graph, batch/subselect | batch reading, join fetching, fetch groups, indirection |
| Extensions | annotations, SPI, event listeners | descriptor customizer, session customizer, query hints, policies |

Keduanya sama-sama provider JPA, tetapi cara berpikir internalnya berbeda. Pada Hibernate, kita sering berpikir lewat `Session`, persistence context, action queue. Pada EclipseLink, kita perlu lebih nyaman dengan konsep **descriptor**, **unit of work**, **identity map**, dan **weaving**.

---

## 3. Session Architecture

### 3.1 Apa itu Session dalam EclipseLink?

Dalam EclipseLink, `Session` adalah abstraction inti untuk komunikasi dengan datastore. Ia memegang:

- database login/connection settings,
- database platform,
- query execution,
- descriptor registry,
- cache/identity maps,
- event manager,
- profiler/logging,
- transaction coordination.

Dalam aplikasi JPA biasa, developer jarang membuat `Session` langsung. Tetapi `EntityManagerFactory` dan `EntityManager` EclipseLink bekerja di atas session infrastructure.

### 3.2 Jenis session secara konseptual

Nama dan detail internal dapat berubah antar versi, tetapi mental model-nya:

| Session concept | Makna |
|---|---|
| `DatabaseSession` | Session yang terhubung ke database relational |
| `ServerSession` | Session untuk environment multi-user/server, mengelola pool dan shared resources |
| `ClientSession` | Session client yang diperoleh dari server session untuk unit kerja tertentu |
| `UnitOfWork` | Session turunan/scope kerja untuk tracking dan commit perubahan |

Dalam server application, pattern-nya kira-kira:

```text
Application startup
  → build ServerSession
  → load descriptors
  → initialize cache/weaving/platform/query policies

Request/transaction
  → EntityManager operation
  → UnitOfWork scope
  → read/write objects
  → calculate changes
  → write SQL
  → commit/rollback
```

### 3.3 EntityManager vs EclipseLink session

JPA:

```java
EntityManager em = emf.createEntityManager();
```

EclipseLink extension:

```java
import org.eclipse.persistence.jpa.JpaEntityManager;
import org.eclipse.persistence.sessions.Session;

JpaEntityManager jpaEm = em.unwrap(JpaEntityManager.class);
Session session = jpaEm.getActiveSession();
```

Atau:

```java
Session session = em.unwrap(Session.class);
```

Catatan desain:

- Unwrap hanya dilakukan saat kita memang sadar memakai provider-specific feature.
- Jangan menyebarkan `Session` EclipseLink ke seluruh codebase jika targetnya tetap JPA-portable.
- Buat boundary jelas: misalnya adapter/infrastructure layer, bukan domain/service layer.

### 3.4 Failure mode session-level

| Failure | Penyebab umum | Dampak |
|---|---|---|
| Wrong platform | Database platform auto-detection salah atau konfigurasi salah | SQL syntax salah, locking/pagination rusak |
| Descriptor missing | Entity tidak masuk persistence unit | Runtime mapping error |
| Shared session cache stale | Cache tidak invalidated dengan benar | User melihat data lama |
| Session customization global berlebihan | Customizer mengubah descriptor/query policy terlalu luas | Behavior sulit diprediksi |
| Mixing provider unwrap | Code mengasumsikan Hibernate/EclipseLink sekaligus | Runtime class cast/error |

---

## 4. Descriptor: Metadata Engine di EclipseLink

### 4.1 Apa itu descriptor?

Descriptor adalah representasi metadata tentang bagaimana class Java dipetakan ke database atau datastore.

Descriptor menjawab:

- table apa untuk class ini?
- primary key-nya apa?
- field Java mana mapped ke column mana?
- relationship ini memakai FK atau join table?
- policy change tracking apa yang dipakai?
- cache policy apa yang dipakai?
- query default apa yang tersedia?
- inheritance strategy apa?
- event callback apa?
- converter apa?

JPA annotation seperti:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {
    @Id
    @Column(name = "CASE_ID")
    private Long id;
}
```

akan diterjemahkan EclipseLink menjadi descriptor internal.

### 4.2 Descriptor bukan hanya annotation reflection

Banyak engineer membayangkan provider hanya membaca annotation lalu langsung generate SQL. Realitasnya lebih kompleks:

```text
Entity class + annotations + XML metadata + persistence properties
  ↓
Metadata processing
  ↓
Descriptor construction
  ↓
Mapping validation
  ↓
Descriptor customization
  ↓
Session deployment
  ↓
Runtime query/change/cache behavior
```

Karena itu bug mapping bisa muncul bukan hanya dari annotation, tetapi dari:

- XML override,
- default naming,
- descriptor customizer,
- weaving setting,
- cache policy,
- database platform,
- query hint,
- inheritance descriptor,
- relationship ownership.

### 4.3 Descriptor customizer

EclipseLink memungkinkan customization pada descriptor level.

Contoh konseptual:

```java
import org.eclipse.persistence.config.DescriptorCustomizer;
import org.eclipse.persistence.descriptors.ClassDescriptor;

public class CaseFileDescriptorCustomizer implements DescriptorCustomizer {
    @Override
    public void customize(ClassDescriptor descriptor) {
        descriptor.setAlias("CaseFile");
        // Tambahkan policy/configuration provider-specific dengan hati-hati.
    }
}
```

Entity:

```java
import org.eclipse.persistence.annotations.Customizer;

@Entity
@Customizer(CaseFileDescriptorCustomizer.class)
public class CaseFile {
    @Id
    private Long id;
}
```

Kapan masuk akal:

- butuh mapping behavior yang tidak nyaman diekspresikan annotation standar,
- butuh cache/query policy khusus,
- butuh event/listener descriptor-level,
- migrasi legacy schema dengan mapping yang kompleks.

Kapan berbahaya:

- dipakai untuk business logic,
- menyembunyikan behavior penting dari entity annotation,
- tidak dites secara eksplisit,
- membuat provider migration hampir mustahil.

### 4.4 Descriptor sebagai pusat extension point

EclipseLink punya banyak extension yang melekat ke descriptor:

- change tracking policy,
- identity map/cache policy,
- event listeners,
- inheritance policy,
- query manager,
- mapping customizations,
- fetch group behavior,
- optimistic locking policy,
- descriptor alias.

Mental model:

```text
Jika Hibernate sering di-customize lewat SPI/event/type/filter,
EclipseLink sering di-customize lewat descriptor/session/policy.
```

---

## 5. UnitOfWork: Cara EclipseLink Mengelola Perubahan

### 5.1 UnitOfWork sebagai scope perubahan

`UnitOfWork` adalah konsep EclipseLink untuk mengelola object yang dibaca, diubah, lalu di-commit.

Dalam JPA, ini tampak sebagai persistence context:

```java
em.getTransaction().begin();

CaseFile file = em.find(CaseFile.class, 100L);
file.changeStatus(CaseStatus.APPROVED);

em.getTransaction().commit();
```

Secara internal, EclipseLink perlu:

1. membaca row dari database,
2. membuat object entity,
3. menaruh object dalam identity map/unit of work,
4. mendeteksi perubahan,
5. menghitung SQL,
6. mengirim SQL,
7. menyinkronkan cache/shared state.

### 5.2 Clone model

Salah satu mental model penting EclipseLink adalah penggunaan clone/copy dalam UnitOfWork.

Simplified model:

```text
Shared/cache object
  ↓ clone into UnitOfWork
Working copy modified by application
  ↓ commit
Changes calculated and written
  ↓ merge back/update cache depending policy
```

Ini berbeda nuansa dari Hibernate persistence context snapshot model. Keduanya sama-sama mendeteksi perubahan entity, tetapi internal lifecycle dan cache interaction bisa berbeda.

### 5.3 Change tracking dalam EclipseLink

EclipseLink mendukung beberapa approach change tracking, antara lain:

| Approach | Intuisi |
|---|---|
| Deferred change detection | Provider membandingkan state saat commit/flush |
| Attribute change tracking | Perubahan attribute diketahui saat setter/field berubah melalui weaving |
| Object change tracking | Object-level tracking |

Weaving membuat change tracking lebih efisien karena object bisa memberitahu provider field mana yang berubah.

### 5.4 Failure mode UnitOfWork

| Failure | Penyebab | Dampak |
|---|---|---|
| Change tidak terdeteksi | Weaving/field access/mutable value issue | Update hilang |
| Update terlalu banyak | Deferred check atas banyak object | Commit/flush lambat |
| Shared cache stale | Commit tidak sinkron dengan cache expectation | Data lama terbaca |
| Detached object overwrite | Merge/copy state tidak dikontrol | Data terbaru tertimpa |
| Huge UnitOfWork | Batch job tidak clear | Memory pressure tinggi |

---

## 6. Weaving: Mesin Bytecode EclipseLink

### 6.1 Apa itu weaving?

Weaving adalah proses memodifikasi bytecode class agar provider dapat menambahkan behavior runtime. EclipseLink memakai weaving untuk:

- lazy loading relationship,
- lazy loading attribute tertentu,
- change tracking,
- fetch group,
- internal optimization,
- indirection/proxy behavior.

Tanpa weaving, beberapa fitur tetap bisa berjalan, tetapi tidak semua fitur advanced bekerja optimal.

### 6.2 Dynamic weaving vs static weaving

| Mode | Kapan terjadi | Kelebihan | Risiko |
|---|---|---|---|
| Dynamic weaving | Runtime saat class loading | Setup lebih mudah di container yang mendukung | Bisa gagal karena classloader/agent/module restriction |
| Static weaving | Build time setelah compile | Predictable, cocok untuk restricted runtime | Build pipeline lebih kompleks |

### 6.3 Dynamic weaving

Dynamic weaving biasanya bekerja jika environment memberi EclipseLink kontrol terhadap class loading. Dalam Jakarta EE server, ini sering lebih natural. Dalam standalone/Spring Boot/custom runtime, dynamic weaving dapat butuh javaagent atau konfigurasi khusus.

Konfigurasi umum:

```xml
<property name="eclipselink.weaving" value="true"/>
```

Atau untuk environment tertentu:

```xml
<property name="eclipselink.weaving" value="static"/>
```

Nilai aktual dan behavior bisa berbeda berdasarkan versi dan runtime. Prinsipnya: jangan menganggap weaving aktif hanya karena annotation lazy ditulis.

### 6.4 Static weaving

Static weaving dilakukan dalam build pipeline:

```text
javac compile entity classes
  ↓
EclipseLink static weaver modifies bytecode
  ↓
package jar/war
  ↓
runtime uses already-woven classes
```

Kapan static weaving masuk akal:

- aplikasi berjalan di runtime yang tidak mengizinkan dynamic class transformation,
- native image/AOT-like environment,
- modular Java dengan classloader ketat,
- production ingin behavior sama dengan test,
- ingin menghindari surprise dynamic weaving failure.

### 6.5 Weaving dan final class/method

Bytecode-based provider sering bermasalah dengan entity yang terlalu final atau tidak extensible.

Rule praktis:

- Entity jangan `final`.
- Relationship field jangan bergantung pada final immutable semantics yang menghalangi provider.
- Hati-hati dengan records sebagai entity: bagus untuk DTO/value projection, tidak ideal untuk mutable JPA entity lifecycle.
- Lombok `@Value`, final fields, private no-arg constructor pattern perlu diuji dengan provider.

### 6.6 Failure mode weaving

| Symptom | Kemungkinan penyebab |
|---|---|
| Lazy relationship selalu eager | Weaving tidak aktif atau mapping tidak mendukung lazy secara efektif |
| Change tracking tidak efisien | Attribute change tracking tidak aktif |
| Fetch group tidak bekerja | Weaving/fetch group setup salah |
| Test berbeda dari production | Dynamic weaving aktif di server tapi tidak di unit test, atau sebaliknya |
| Runtime classloader error | Java module/classloader/security restriction |
| Strange serialization behavior | Woven fields/proxies bocor ke serialization layer |

Diagnostic checklist:

```text
1. Apakah log EclipseLink menyebut weaving enabled/disabled?
2. Apakah runtime memakai Java agent?
3. Apakah test memakai provider yang sama?
4. Apakah entity class sudah loaded sebelum weaving?
5. Apakah build menghasilkan woven classes?
6. Apakah module-info membuka package entity untuk provider?
7. Apakah lazy/fetch group diverifikasi lewat SQL count, bukan asumsi?
```

---

## 7. Indirection, Lazy Loading, and ValueHolder

### 7.1 Indirection mental model

EclipseLink menggunakan konsep indirection untuk menunda load relationship. Alih-alih langsung memuat object target, field relationship dapat diwakili oleh holder/proxy/wrapper yang tahu cara mengambil data saat dibutuhkan.

Simplified:

```text
CaseFile
  └── documents = indirection wrapper
          ↓ when accessed
       SELECT * FROM DOCUMENT WHERE CASE_ID = ?
```

### 7.2 Lazy loading bukan free optimization

Lazy loading menunda biaya, bukan menghapus biaya.

Trade-off:

| Strategy | Biaya |
|---|---|
| Lazy relationship | Risiko N+1 jika diakses per row |
| Eager relationship | Risiko over-fetch dan cartesian explosion |
| Batch reading | Mengurangi round trip tapi tetap load group |
| Join fetch | Satu query tapi bisa row multiplication |
| Fetch group | Membatasi attribute yang dimuat tapi butuh weaving/disiplin |

### 7.3 Lazy dalam boundary API

Entity lazy tidak boleh keluar sembarangan ke REST/JSON serialization boundary.

Anti-pattern:

```java
@GetMapping("/cases/{id}")
public CaseFile getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Risiko:

- serializer memicu lazy load,
- SQL terjadi setelah service boundary,
- transaction sudah tutup,
- graph terlalu besar,
- sensitive relationship bocor,
- circular reference.

Lebih aman:

```java
@GetMapping("/cases/{id}")
public CaseDetailResponse getCase(@PathVariable Long id) {
    return caseQueryService.getCaseDetail(id);
}
```

Dengan query/fetch plan eksplisit.

---

## 8. Shared Cache / Identity Map

### 8.1 EclipseLink shared cache sebagai fitur native penting

EclipseLink punya konsep shared cache/identity map yang kuat. Cache ini dapat menyimpan object yang sudah dibaca agar query berikutnya tidak selalu harus hydrate ulang dari database.

Namun cache correctness lebih penting daripada cache hit ratio.

### 8.2 First-level vs shared cache

| Cache | Scope | Fungsi |
|---|---|---|
| Persistence context / UnitOfWork cache | Transaction/request/work unit | Identity consistency dan change tracking |
| Shared cache / identity map | EntityManagerFactory/session-level | Reuse object across transactions |
| Query cache | Query result reuse | Menghindari query execution tertentu, dengan invalidation risk |

### 8.3 Cache isolation issue

Shared cache dapat menyebabkan stale data jika:

- database diubah oleh aplikasi lain,
- native SQL bypass provider,
- bulk update tidak invalidasi cache dengan benar,
- cluster node tidak sinkron,
- cache policy terlalu agresif,
- entity mutable tapi dipakai seolah immutable.

### 8.4 Cache configuration patterns

Prinsip:

- Cache entity reference/static/lookup lebih aman.
- Cache entity high-write lebih berbahaya.
- Cache entity multi-tenant perlu isolasi ekstra.
- Cache entity security-sensitive harus sangat hati-hati.
- Query cache harus dipakai hanya jika invalidation semantics jelas.

Contoh entity reference data:

```java
@Entity
@Cacheable(true)
public class ModuleDimension {
    @Id
    private Long id;

    private String code;
    private String label;
}
```

Entity high-write:

```java
@Entity
@Cacheable(false)
public class CaseAssignment {
    @Id
    private Long id;

    private Long officerId;
    private Instant assignedAt;
}
```

### 8.5 Cache invalidation sebagai desain, bukan afterthought

Pertanyaan wajib:

```text
1. Siapa saja yang bisa mengubah table ini?
2. Apakah semua perubahan lewat EclipseLink?
3. Apakah ada bulk update/native SQL/job eksternal?
4. Apakah ada multi-node cluster?
5. Apakah tenant/security context masuk ke query result?
6. Berapa toleransi stale read?
7. Apakah entity ini reference data atau transactional data?
8. Apakah audit/legal correctness mengizinkan cache stale?
```

### 8.6 Failure mode shared cache

| Symptom | Root cause |
|---|---|
| User melihat status lama | Entity cached, DB sudah berubah di luar provider |
| Tenant A melihat data Tenant B | Cache key tidak mengandung tenant boundary/filter bocor |
| Native update tidak terlihat | Cache tidak evicted/invalidated |
| Data berubah tanpa SQL baru | Object dari shared cache dipakai ulang |
| Query result salah | Query cache invalidation tidak sesuai mutation pattern |

---

## 9. Fetch Groups

### 9.1 Apa itu fetch group?

Fetch group adalah EclipseLink feature untuk menentukan subset attribute entity yang akan dimuat.

Tujuannya:

- menghindari load field besar seperti CLOB/BLOB,
- mengurangi hydration cost,
- membuat read path lebih spesifik,
- mengontrol lazy basic attribute.

Contoh konseptual:

```java
import org.eclipse.persistence.annotations.FetchGroup;
import org.eclipse.persistence.annotations.FetchGroups;
import org.eclipse.persistence.annotations.FetchAttribute;

@Entity
@FetchGroups({
    @FetchGroup(
        name = "case.summary",
        attributes = {
            @FetchAttribute(name = "id"),
            @FetchAttribute(name = "caseNo"),
            @FetchAttribute(name = "status"),
            @FetchAttribute(name = "createdAt")
        }
    )
})
public class CaseFile {
    @Id
    private Long id;

    private String caseNo;
    private String status;
    private Instant createdAt;

    @Lob
    private String fullText;
}
```

Query hint:

```java
List<CaseFile> result = em.createQuery("select c from CaseFile c", CaseFile.class)
    .setHint("eclipselink.fetch-group.name", "case.summary")
    .getResultList();
```

### 9.2 Fetch group vs DTO projection

| Approach | Kapan cocok |
|---|---|
| Fetch group | Masih butuh entity managed tapi tidak semua field |
| DTO projection | Read-only API/report/query model |
| Native SQL | Query sangat database-specific atau butuh plan khusus |
| Entity graph | Standard JPA fetch relation graph |

Rule praktis:

- Untuk API response/read-only list: DTO projection sering lebih aman.
- Untuk workflow update yang butuh entity managed: fetch group bisa berguna.
- Untuk LOB besar: fetch group/lazy basic wajib diuji dengan SQL dan memory profile.

### 9.3 Failure mode fetch group

| Failure | Penyebab |
|---|---|
| Attribute null padahal ada di DB | Partial object tidak dipahami developer |
| Lazy load terjadi saat serialization | Field di luar fetch group diakses belakangan |
| Update overwrite field tidak loaded | Partial entity salah dipakai untuk mutation |
| Behavior beda test/prod | Weaving/fetch group tidak aktif konsisten |

---

## 10. Batch Reading and Join Fetching

### 10.1 Batch reading

Batch reading adalah teknik EclipseLink untuk mengurangi N+1 dengan mengambil relationship untuk beberapa parent sekaligus.

Simplified:

```text
SELECT * FROM CASE_FILE WHERE STATUS = 'OPEN'

Instead of:
  SELECT * FROM DOCUMENT WHERE CASE_ID = 1
  SELECT * FROM DOCUMENT WHERE CASE_ID = 2
  SELECT * FROM DOCUMENT WHERE CASE_ID = 3

Batch reading:
  SELECT * FROM DOCUMENT WHERE CASE_ID IN (1, 2, 3, ...)
```

Contoh annotation provider-specific:

```java
import org.eclipse.persistence.annotations.BatchFetch;
import org.eclipse.persistence.annotations.BatchFetchType;

@OneToMany(mappedBy = "caseFile")
@BatchFetch(BatchFetchType.IN)
private List<Document> documents = new ArrayList<>();
```

Batch fetch type umum:

| Type | Intuisi |
|---|---|
| `JOIN` | Memakai join untuk batch relationship |
| `EXISTS` | Memakai exists/subquery-like strategy |
| `IN` | Memakai `IN (...)` atas key parent |

### 10.2 Join fetching

Join fetch mengambil parent dan relationship dalam query join.

JPQL standard:

```java
select c
from CaseFile c
join fetch c.applicant
where c.id = :id
```

Provider hint EclipseLink juga tersedia untuk join fetch dalam beberapa scenario.

### 10.3 Batch vs join decision

| Kondisi | Pilihan cenderung aman |
|---|---|
| Many parents, one small to-one relation | join fetch |
| Many parents, collection medium | batch fetch |
| Multiple collections | batch fetch/projection, hindari join semua |
| Pagination root entity | batch fetch/entity graph/projection |
| Report read-only | DTO/native query |
| Deep graph | explicit read model, bukan lazy chain |

### 10.4 Failure mode fetch optimization

| Symptom | Penyebab |
|---|---|
| Query result duplikat | Join fetch collection menghasilkan row multiplication |
| Memory spike | Join fetch graph terlalu besar |
| Pagination salah | Pagination diterapkan ke row join, bukan root semantic |
| IN clause terlalu besar | Batch fetch size tidak sesuai database limit |
| DB CPU naik | Fix N+1 berubah menjadi heavy join |

---

## 11. EclipseLink Query Hints

### 11.1 Query hint sebagai provider contract

JPA menyediakan query hint standard terbatas. EclipseLink menambah banyak hint provider-specific.

Contoh pola:

```java
List<CaseFile> cases = em.createQuery("select c from CaseFile c where c.status = :status", CaseFile.class)
    .setParameter("status", CaseStatus.OPEN)
    .setHint("eclipselink.batch", "c.documents")
    .setHint("eclipselink.read-only", "true")
    .getResultList();
```

Provider hint berguna, tetapi harus dilihat sebagai **contract eksplisit dengan EclipseLink**.

### 11.2 Hint yang sering penting secara konseptual

| Hint category | Tujuan |
|---|---|
| Batch/fetch hints | Mengontrol relationship loading |
| Read-only | Mengurangi tracking untuk query read-only |
| Cache usage | Bypass/check/use cache |
| Query timeout | Membatasi durasi query |
| Fetch group | Mengontrol attribute subset |
| Refresh | Memaksa reload dari DB |

### 11.3 Rule penggunaan query hint

Gunakan query hint jika:

- query path critical,
- behavior provider-specific memang dibutuhkan,
- sudah ada SQL/log verification,
- ada test yang memastikan jumlah query/shape result,
- ada dokumentasi di repository layer.

Hindari jika:

- hanya copy-paste dari internet,
- digunakan global tanpa profiling,
- mengubah correctness cache tanpa pemahaman,
- dipakai untuk menutupi domain/query design yang salah.

---

## 12. Advanced Mappings

### 12.1 Transformation mapping

Transformation mapping memungkinkan satu attribute/object dibentuk dari beberapa column atau transformation custom.

Contoh kebutuhan:

```text
Table ADDRESS
  STREET_LINE_1
  STREET_LINE_2
  POSTAL_CODE
  COUNTRY_CODE

Java value object:
  AddressDisplay display
```

Transformation mapping berguna untuk legacy schema yang tidak cocok dengan mapping sederhana.

Risiko:

- queryability menurun,
- mapping logic tersembunyi di provider layer,
- sulit dipindah ke provider lain,
- testing harus lebih eksplisit.

### 12.2 Converter

EclipseLink mendukung converter provider-specific selain `AttributeConverter` standard JPA.

Gunakan standard `AttributeConverter` jika cukup:

```java
@Converter(autoApply = true)
public class CaseStatusConverter implements AttributeConverter<CaseStatus, String> {
    @Override
    public String convertToDatabaseColumn(CaseStatus attribute) {
        return attribute == null ? null : attribute.code();
    }

    @Override
    public CaseStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : CaseStatus.fromCode(dbData);
    }
}
```

Gunakan EclipseLink-specific converter jika:

- butuh akses session/platform,
- legacy mapping sangat kompleks,
- conversion tidak cocok dengan standard converter,
- ada optimization provider-level.

### 12.3 Object type converter

Object type converter sering dipakai untuk mapping code database ke enum/object.

Example conceptual:

```text
DB value: 'P', 'A', 'R'
Java enum: PENDING, APPROVED, REJECTED
```

Namun untuk portability, `AttributeConverter` standard sering lebih baik.

### 12.4 Struct/object-relational mapping

EclipseLink memiliki dukungan advanced untuk database feature tertentu, termasuk mapping object-relational/structured types pada database yang mendukung. Ini biasanya muncul di Oracle-heavy enterprise systems.

Rule:

- gunakan hanya jika schema/database memang mengharuskan,
- isolasi di infrastructure layer,
- hindari menyebarkan database-specific type ke domain model,
- dokumentasikan migration risk.

---

## 13. Descriptor and Session Customizers

### 13.1 SessionCustomizer

Session customizer dipakai untuk mengubah konfigurasi session saat bootstrap.

Contoh:

```java
import org.eclipse.persistence.config.SessionCustomizer;
import org.eclipse.persistence.sessions.Session;

public class AppSessionCustomizer implements SessionCustomizer {
    @Override
    public void customize(Session session) throws Exception {
        session.getSessionLog().setLevel(6);
        // Tambahkan custom policy dengan hati-hati.
    }
}
```

`persistence.xml`:

```xml
<property name="eclipselink.session.customizer"
          value="com.example.persistence.AppSessionCustomizer" />
```

### 13.2 Kapan customizer masuk akal

- central logging/profiling setup,
- descriptor policy adjustment untuk legacy schema,
- custom platform behavior,
- event listener registration,
- strict validation policy.

### 13.3 Kapan customizer menjadi technical debt

- business rule dimasukkan ke customizer,
- mutation metadata global tanpa test,
- environment-specific behavior tidak terdokumentasi,
- customizer tergantung urutan bootstrap rapuh,
- migration ke provider/versi lain menjadi sulit.

### 13.4 Rule arsitektur

```text
Customizer boleh mengatur provider behavior.
Customizer tidak boleh menjadi tempat business logic.
Customizer harus punya test startup/mapping behavior.
Customizer harus terdokumentasi sebagai provider-specific contract.
```

---

## 14. Descriptor Events and Listeners

### 14.1 Event pada entity/descriptor lifecycle

JPA punya callback seperti:

```java
@PrePersist
@PreUpdate
@PostLoad
```

EclipseLink juga menyediakan event/listener provider-specific di descriptor/session level.

Kegunaan:

- audit technical metadata,
- normalization,
- validation provider-level,
- logging/profiling,
- legacy integration.

### 14.2 Risiko listener

Listener sering berbahaya karena berjalan “diam-diam”.

Failure mode:

| Failure | Penyebab |
|---|---|
| Update tambahan tidak dipahami | Listener memodifikasi field saat flush |
| Infinite recursion | Listener melakukan query/mutation yang memicu event lain |
| Audit tidak konsisten | Listener tidak berjalan pada bulk update/native SQL |
| Performance spike | Listener melakukan remote call atau heavy computation |
| Order dependency | Banyak listener saling bergantung |

Rule:

- Listener tidak boleh melakukan I/O eksternal berat.
- Listener tidak boleh menjadi tempat workflow utama.
- Listener harus idempotent jika mungkin.
- Bulk operation bypass harus terdokumentasi.
- Observability harus menunjukkan listener impact.

---

## 15. Read-Only Query and Read-Only Entity Patterns

### 15.1 Kenapa read-only penting

ORM secara default mengasumsikan entity managed bisa berubah. Untuk read-heavy path, tracking perubahan bisa menjadi biaya besar.

Read-only query dapat mengurangi:

- clone/snapshot overhead,
- dirty checking,
- memory retention,
- flush impact.

Contoh conceptual:

```java
List<CaseSummary> summaries = em.createQuery("""
    select new com.example.CaseSummary(c.id, c.caseNo, c.status)
    from CaseFile c
    where c.status = :status
""", CaseSummary.class)
.setParameter("status", CaseStatus.OPEN)
.getResultList();
```

DTO projection sering lebih aman daripada read-only entity.

### 15.2 EclipseLink read-only hint

```java
List<CaseFile> cases = em.createQuery("select c from CaseFile c where c.status = :status", CaseFile.class)
    .setParameter("status", CaseStatus.OPEN)
    .setHint("eclipselink.read-only", "true")
    .getResultList();
```

Gunakan hati-hati: entity yang dibaca read-only tidak boleh diasumsikan aman untuk dimodifikasi dan di-commit.

### 15.3 Rule praktis

| Use case | Pattern |
|---|---|
| API list | DTO projection |
| Detail page read-only | DTO projection atau fetch group read-only |
| Internal workflow update | Managed entity normal |
| Large report | Native SQL/read model |
| Reference data | Cacheable entity/DTO, dengan invalidation jelas |

---

## 16. Logging, Profiling, and Diagnostics in EclipseLink

### 16.1 Logging categories

EclipseLink logging dapat menunjukkan:

- SQL,
- transaction,
- cache,
- connection,
- query,
- metadata/bootstrap,
- weaving.

Contoh property:

```xml
<property name="eclipselink.logging.level" value="INFO"/>
<property name="eclipselink.logging.level.sql" value="FINE"/>
<property name="eclipselink.logging.parameters" value="true"/>
```

Catatan keamanan:

- Jangan aktifkan bind parameter penuh di production jika mengandung PII/sensitive data.
- Gunakan correlation ID pada request logging.
- Sampling lebih aman daripada full SQL log untuk high traffic.

### 16.2 Profiler

EclipseLink punya profiling/logging support yang dapat membantu melihat query cost dan provider behavior. Dalam production modern, integrasikan dengan:

- application metrics,
- database slow query log,
- distributed tracing,
- request correlation,
- connection pool metrics.

### 16.3 Diagnostic minimum untuk production

Untuk aplikasi enterprise, minimal harus bisa menjawab:

```text
1. Endpoint mana menjalankan query apa?
2. Berapa jumlah SQL per request?
3. Query mana paling lambat?
4. Apakah bind parameter aman dilihat?
5. Apakah lazy load terjadi di serializer/view layer?
6. Apakah cache hit/miss terlihat?
7. Apakah flush/commit lambat terlihat?
8. Apakah transaction rollback-only terlihat?
9. Apakah deadlock/lock timeout bisa dikorelasikan ke request?
10. Apakah provider hint/fetch group terlihat dalam query behavior?
```

---

## 17. EclipseLink in Spring Boot / Jakarta EE / Standalone

### 17.1 Jakarta EE/container environment

Di Jakarta EE, EclipseLink sering lebih natural karena:

- container mengelola persistence unit,
- JTA integration tersedia,
- classloader/weaving support lebih matang,
- provider default bisa disediakan server,
- deployment descriptor lebih umum.

Namun tetap perlu:

- memastikan provider version server,
- memastikan namespace Jakarta sesuai,
- memahami default cache/weaving server,
- tidak mengandalkan behavior yang berubah antar server.

### 17.2 Spring Boot environment

Spring Boot ecosystem default-nya Hibernate. Memakai EclipseLink membutuhkan konfigurasi tambahan, misalnya:

- dependency EclipseLink,
- exclude Hibernate jika perlu,
- set provider class,
- configure `JpaVendorAdapter`,
- pastikan weaving/static weaving jika diperlukan,
- test behavior dengan database nyata.

Contoh conceptual configuration:

```java
@Configuration
public class JpaConfig {
    @Bean
    public LocalContainerEntityManagerFactoryBean entityManagerFactory(
            DataSource dataSource) {

        var factory = new LocalContainerEntityManagerFactoryBean();
        factory.setDataSource(dataSource);
        factory.setPackagesToScan("com.example.domain");
        factory.setPersistenceProviderClass(
            org.eclipse.persistence.jpa.PersistenceProvider.class
        );

        Map<String, Object> props = new HashMap<>();
        props.put("eclipselink.weaving", "false");
        props.put("eclipselink.logging.level", "INFO");
        factory.setJpaPropertyMap(props);

        return factory;
    }
}
```

Catatan:

- `weaving=false` sering dipakai di environment tanpa weaving setup, tetapi artinya fitur tertentu tidak optimal.
- Untuk production, jangan hanya mematikan weaving demi startup berhasil tanpa memahami konsekuensi lazy/change tracking/fetch group.

### 17.3 Standalone Java SE

Java SE cocok untuk:

- batch job,
- CLI migration utility,
- offline processing,
- small service.

Tetapi kita harus explicit:

- transaction resource-local,
- connection config,
- weaving/static weaving,
- lifecycle `EntityManagerFactory`,
- close resources.

---

## 18. Java 8–25 Compatibility Notes

### 18.1 Java 8

Pada Java 8, kebanyakan EclipseLink usage berada di `javax.persistence` era:

- EclipseLink 2.x,
- JPA 2.1/2.2,
- Java EE 7/8 style,
- older application servers.

Risiko utama:

- migration namespace,
- old bytecode/weaving assumptions,
- old database platform behavior,
- old dependency transitive conflicts.

### 18.2 Java 11/17

Java 11/17 membawa:

- stronger module/classloader concerns,
- Jakarta namespace migration,
- container upgrade pressure,
- static weaving relevance lebih tinggi,
- reflection access concern.

### 18.3 Java 21/25

Pada Java 21/25:

- runtime modern lebih ketat terhadap illegal reflective access,
- build pipeline cenderung lebih AOT/containerized,
- observability dan profiling harus modern,
- provider version harus benar-benar mendukung bytecode/runtime target,
- gunakan Jakarta namespace modern.

Checklist:

```text
1. Apakah provider line support Java runtime target?
2. Apakah namespace API cocok?
3. Apakah app server mendukung provider line tersebut?
4. Apakah static/dynamic weaving bekerja di runtime target?
5. Apakah test pipeline menjalankan bytecode yang sama dengan production?
6. Apakah dependency lama membawa javax.persistence?
7. Apakah module-info membuka package entity jika perlu?
```

---

## 19. EclipseLink vs Hibernate: Cara Berpikir Berbeda

### 19.1 Jangan translasi satu-lawan-satu

Contoh mistake:

```text
Hibernate @BatchSize = EclipseLink @BatchFetch?
Hibernate bytecode enhancement = EclipseLink weaving?
Hibernate L2 cache = EclipseLink shared cache?
Hibernate filter = EclipseLink descriptor/query mechanism?
```

Jawabannya: mirip secara tujuan, tidak identik secara behavior.

### 19.2 Portability boundary

Jika ingin tetap portable:

- gunakan JPA standard mapping,
- hindari provider-specific hints di domain layer,
- pakai DTO projection untuk read model,
- test SQL shape per provider,
- jangan mengandalkan default cache/fetch behavior.

Jika memilih EclipseLink-specific:

- tulis sebagai keputusan eksplisit,
- isolasi di repository/infrastructure,
- dokumentasikan provider contract,
- buat migration note,
- test behavior yang diandalkan.

---

## 20. Production Failure Modes Playbook

### 20.1 Lazy loading tidak berjalan

Symptom:

- relationship selalu loaded,
- query terlalu besar,
- memory naik,
- fetch group tidak efektif.

Possible root cause:

- weaving disabled,
- entity class sudah loaded sebelum weaving,
- runtime tidak support dynamic weaving,
- mapping memakai eager/default yang salah,
- serializer memaksa load.

Fix:

- verifikasi log weaving,
- pakai static weaving jika perlu,
- ubah fetch plan,
- pakai DTO response,
- test SQL count.

### 20.2 Stale data karena shared cache

Symptom:

- DB sudah berubah tetapi app masih melihat nilai lama,
- hanya terjadi pada node tertentu,
- refresh manual memperbaiki.

Possible root cause:

- shared cache aktif untuk entity mutable,
- update dilakukan native SQL/job eksternal,
- cache invalidation antar node tidak ada,
- query cache dipakai salah.

Fix:

- disable cache untuk entity transactional,
- evict/refresh setelah bulk/native operation,
- gunakan cache coordination jika memang perlu,
- jangan cache tenant/security-sensitive entity tanpa desain kuat.

### 20.3 Commit lambat

Symptom:

- query cepat, commit lambat,
- CPU aplikasi naik,
- memory naik saat transaksi.

Possible root cause:

- UnitOfWork terlalu besar,
- deferred change detection atas banyak object,
- cascade graph besar,
- listener berat,
- batch writing tidak aktif,
- flush terlalu jarang dalam batch.

Fix:

- batasi transaction scope,
- flush/clear chunk,
- read-only query/DTO,
- aktifkan batch writing dengan benar,
- profiling UnitOfWork/SQL.

### 20.4 N+1 tetap terjadi

Symptom:

- query root satu, lalu banyak query child,
- latency naik linear terhadap row count.

Possible root cause:

- relationship lazy diakses loop,
- batch fetch tidak aktif,
- query hint salah path,
- fetch group tidak mencakup relation,
- serialization memicu access.

Fix:

- batch fetch/join fetch/DTO projection,
- SQL count test,
- explicit read use case query,
- jangan return entity ke API boundary.

### 20.5 Wrong update / missing update

Symptom:

- perubahan field tidak tersimpan,
- field lain ikut berubah,
- update SQL tidak sesuai ekspektasi.

Possible root cause:

- change tracking/weaving issue,
- mutable value object tidak terdeteksi,
- detached merge overwrite,
- partial object/fetch group dipakai untuk update,
- listener/converter mengubah value.

Fix:

- hindari update partial entity dari fetch group,
- gunakan command object dan managed entity loaded lengkap untuk mutation,
- periksa converter/listener,
- test update SQL dan DB result.

---

## 21. Design Rules untuk EclipseLink Production System

### Rule 1 — Treat EclipseLink-specific features as infrastructure contracts

Jangan menyembunyikan provider-specific behavior di domain model tanpa alasan kuat.

Lebih baik:

```text
repository/query layer explicitly uses EclipseLink hint
  + test verifies SQL/cache behavior
  + documentation explains why
```

Daripada:

```text
annotation/hint scattered across entity with no ownership
```

### Rule 2 — Verify weaving, do not assume weaving

Lazy/fetch group/change tracking behavior harus diverifikasi dengan:

- startup log,
- SQL count test,
- integration test,
- bytecode/build artifact check jika static weaving.

### Rule 3 — Disable shared cache for volatile transactional data unless proven safe

Untuk data seperti:

- case status,
- assignment,
- approval,
- payment state,
- compliance result,
- security/authorization relation,

cache default harus skeptis.

### Rule 4 — Prefer DTO/read model for API and reporting

Entity managed cocok untuk mutation workflow, bukan universal response object.

### Rule 5 — Keep UnitOfWork small and purposeful

Transaction boundary harus mencerminkan business operation, bukan seluruh request panjang.

### Rule 6 — Do not put workflow in descriptor/listener magic

Workflow/state transition harus terlihat di service/domain layer. Listener boleh mengisi technical metadata, bukan menjalankan proses bisnis utama.

### Rule 7 — Test with real provider and real database

Jika production memakai EclipseLink + Oracle/PostgreSQL, test critical ORM behavior dengan kombinasi itu. H2/embedded DB tidak cukup untuk:

- dialect behavior,
- locking,
- LOB,
- sequence,
- pagination,
- timestamp precision,
- constraint behavior.

---

## 22. Case Study: Regulatory Case Management dengan EclipseLink

### 22.1 Domain sederhana

Misalnya sistem punya:

- `CaseFile`,
- `Application`,
- `OfficerAssignment`,
- `CaseDocument`,
- `AuditEntry`,
- `ModuleDimension`,
- `CaseTask`,
- `WorkflowStateHistory`.

### 22.2 Klasifikasi entity

| Entity | Character | Cache policy suggestion |
|---|---|---|
| `ModuleDimension` | Reference data, rarely changed | cacheable with invalidation plan |
| `CaseFile` | Transactional, status changes | cache cautious/off |
| `OfficerAssignment` | Transactional/security-sensitive | cache off |
| `CaseDocument` | Potential LOB/metadata | metadata query DTO; LOB lazy/fetch group |
| `AuditEntry` | Append-only large table | no entity graph explosion; projection/native query |
| `WorkflowStateHistory` | Append-only history | read model/projection |
| `CaseTask` | High-write task lifecycle | cache off, optimistic lock |

### 22.3 Fetch design

Use case: case listing.

Bad:

```java
select c from CaseFile c
```

Lalu serializer/accessor mengambil applicant, assignment, documents, audit trail.

Better:

```java
select new com.example.CaseListRow(
    c.id,
    c.caseNo,
    c.status,
    c.createdAt,
    a.displayName
)
from CaseFile c
left join c.currentAssignment a
where c.status = :status
order by c.createdAt desc
```

Use case: case mutation.

Better:

```java
CaseFile caseFile = em.find(CaseFile.class, id, LockModeType.OPTIMISTIC);
caseFile.approve(command.actorId(), command.reason());
```

Dengan aggregate kecil dan explicit child manipulation.

Use case: document preview.

- Query metadata DTO dulu.
- Load LOB hanya saat download/preview specific document.
- Jangan join fetch semua document content pada case detail.

### 22.4 EclipseLink-specific considerations

- `ModuleDimension` bisa cacheable.
- `CaseFile` sebaiknya tidak shared-cache agresif.
- `CaseDocument.fullText` perlu fetch group/lazy basic diverifikasi weaving.
- Batch fetch documents metadata jika list kecil; projection lebih baik untuk list besar.
- Audit trail sebaiknya projection/native query, bukan entity graph.
- Assignment/security relation tidak boleh bocor lewat cache/filter.

---

## 23. Anti-Patterns

### Anti-pattern 1 — “EclipseLink is just Hibernate with different dependency”

Salah. Provider behavior berbeda pada weaving, cache, query hint, descriptor, change tracking, dan advanced mappings.

### Anti-pattern 2 — Enable shared cache everywhere

Cache global tanpa invalidation plan adalah sumber stale data.

### Anti-pattern 3 — Disable weaving blindly

Mematikan weaving bisa menyelesaikan startup error, tetapi mematikan/menurunkan fitur lazy/change tracking/fetch group.

### Anti-pattern 4 — Descriptor customizer as hidden business logic

Business rule yang hidup di customizer sulit dibaca, sulit dites, dan sulit dimigrasikan.

### Anti-pattern 5 — Entity returned directly to API

Lazy loading, cache behavior, security leakage, dan graph explosion akan menjadi sulit dikontrol.

### Anti-pattern 6 — Fetch group for mutation without discipline

Partial entity yang dipakai update bisa menyebabkan field tidak loaded, lazy load tak terduga, atau overwrite salah.

### Anti-pattern 7 — Testing provider behavior with H2 only

H2 tidak mewakili Oracle/PostgreSQL/MySQL behavior untuk banyak hal penting.

---

## 24. Diagnostic Checklist

Saat debugging EclipseLink issue, gunakan checklist ini:

```text
Provider/version
[ ] EclipseLink versi berapa?
[ ] Namespace javax atau jakarta?
[ ] Java runtime berapa?
[ ] App server/Spring Boot/standalone?

Bootstrap
[ ] Persistence unit terbaca benar?
[ ] Provider class benar?
[ ] Descriptor entity lengkap?
[ ] Session customizer aktif?

Weaving
[ ] Weaving aktif atau tidak?
[ ] Dynamic atau static?
[ ] Test dan production sama?
[ ] Lazy/fetch group terbukti lewat SQL?

Cache
[ ] Entity cacheable atau tidak?
[ ] Shared cache aktif?
[ ] Ada native/bulk/external update?
[ ] Cluster invalidation ada?
[ ] Tenant/security boundary aman?

Query/fetch
[ ] Query menghasilkan SQL apa?
[ ] Ada N+1?
[ ] Ada cartesian explosion?
[ ] Query hint path benar?
[ ] Pagination aman?

Transaction/UnitOfWork
[ ] Transaction terlalu besar?
[ ] Commit lambat karena change detection?
[ ] Cascade graph terlalu luas?
[ ] Listener berat?

Mapping
[ ] Descriptor customization mengubah behavior?
[ ] Converter null-safe?
[ ] Relationship ownership benar?
[ ] Inheritance strategy masuk akal?

Production safety
[ ] SQL logging aman dari PII?
[ ] Correlation ID ada?
[ ] Slow query bisa dikaitkan ke endpoint?
[ ] Cache stale bisa diamati?
```

---

## 25. Practice Scenarios

### Scenario 1 — Lazy field tidak lazy

Entity:

```java
@Entity
public class CaseDocument {
    @Id
    private Long id;

    private String fileName;

    @Lob
    @Basic(fetch = FetchType.LAZY)
    private String fullText;
}
```

Masalah:

- query listing document metadata tetap mengambil `FULL_TEXT`,
- memory naik drastis.

Analisis:

- Apakah provider mendukung lazy basic tanpa weaving?
- Apakah weaving aktif di runtime?
- Apakah SQL membuktikan column `FULL_TEXT` diambil?
- Apakah DTO projection lebih tepat?

Solusi defensible:

- Untuk listing, gunakan DTO projection tanpa `fullText`.
- Untuk detail/download, query specific document content.
- Jika tetap ingin lazy basic, aktifkan dan test weaving.

### Scenario 2 — User melihat status case lama

Masalah:

- `CASE_FILE.STATUS` sudah berubah di database oleh batch job,
- aplikasi masih menampilkan status lama.

Analisis:

- Apakah `CaseFile` masuk shared cache?
- Apakah batch job lewat EclipseLink atau native SQL?
- Apakah cache invalidation dilakukan?
- Apakah ada multi-node?

Solusi:

- Disable cache untuk `CaseFile` atau refresh/evict setelah batch.
- Hindari shared cache untuk mutable workflow state.
- Untuk reference data, cache boleh dengan invalidation plan.

### Scenario 3 — Commit approval lambat

Masalah:

- approval endpoint query-nya cepat,
- commit butuh 3 detik.

Analisis:

- Apakah persistence context membawa graph besar?
- Apakah cascade merge luas?
- Apakah listener audit melakukan heavy work?
- Apakah deferred change detection mengecek banyak entity?
- Apakah flush menghasilkan banyak SQL?

Solusi:

- Load aggregate minimal untuk approval.
- Hindari merge detached full graph.
- Gunakan command update terhadap managed entity.
- Audit append dibuat eksplisit.
- Batasi transaction boundary.

### Scenario 4 — Spring Boot migration dari Hibernate ke EclipseLink

Masalah:

- test lulus dengan Hibernate,
- runtime EclipseLink punya fetch/cache behavior berbeda.

Checklist:

- remove Hibernate dependency?
- configure provider class?
- verify JPA properties are EclipseLink properties?
- rewrite provider-specific annotations?
- verify lazy/weaving?
- test generated SQL?
- review cache default?

Lesson:

```text
JPA portability is not binary. Mapping may compile, behavior may still change.
```

---

## 26. Summary

EclipseLink harus dipahami sebagai provider dengan arsitektur internal yang khas:

```text
Entity metadata
  → Descriptor

Runtime provider context
  → Session / ServerSession

Transaction/work scope
  → UnitOfWork

Lazy/change/fetch optimization
  → Weaving + indirection + fetch groups

Cross-transaction reuse
  → Shared cache / identity map

Advanced behavior
  → Query hints + customizers + descriptor policies
```

Poin paling penting:

1. EclipseLink bukan Hibernate versi lain; ia punya model session/descriptor/unit-of-work/weaving sendiri.
2. Descriptor adalah pusat metadata dan extension behavior.
3. UnitOfWork adalah scope perubahan yang harus dijaga kecil dan jelas.
4. Weaving menentukan efektivitas lazy loading, change tracking, dan fetch group.
5. Shared cache sangat powerful tetapi bisa menjadi sumber stale data dan data leakage.
6. Provider-specific hints dan customizer harus diperlakukan sebagai infrastructure contract.
7. DTO/read model sering lebih aman untuk API/reporting dibanding entity graph.
8. Production debugging harus selalu menghubungkan endpoint → transaction → UnitOfWork → SQL → cache behavior.

Dengan memahami EclipseLink sampai level ini, kita bisa membaca aplikasi EclipseLink lama maupun modern bukan sebagai “JPA black box”, tetapi sebagai state synchronization engine dengan mekanisme internal yang dapat diuji, dioptimalkan, dan dikendalikan.

---

## 27. Referensi Utama

- EclipseLink Documentation 4.x — JPA extensions, solutions guide, weaving, cache, sessions, and mapping concepts.
- EclipseLink Downloads / Releases — EclipseLink 4.0.x and 5.0.x release context.
- Jakarta Persistence 3.x Specification — standard API contract that EclipseLink implements.
- Oracle TopLink / EclipseLink concepts documentation — weaving, persistence unit, sessions, and provider behavior lineage.
- EclipseLink GitHub release notes — Jakarta Persistence 3.2 / Jakarta EE 11 modernization notes for EclipseLink 5.x.

---

## 28. Status Seri

Bagian ini adalah **Part 25 dari 34**.

Seri **belum selesai**.

Bagian berikutnya:

```text
26-hibernate-vs-eclipselink-behavioral-differences-that-matter.md
```
