# Part 004 — Entity Lifecycle and Persistence Context Internals

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Format file: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-004.md`  
> Scope: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7  
> Status seri: **belum selesai** — ini adalah **Part 004 dari 032**

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu melihat JPA/Hibernate bukan sebagai kumpulan annotation, melainkan sebagai **state machine + identity map + unit of work + write-behind synchronization engine**.

Target pemahaman:

1. Memahami status entity:
   - transient/new,
   - managed/persistent,
   - detached,
   - removed.
2. Memahami apa itu **persistence context** dan kenapa ia menjadi pusat dari semua perilaku JPA.
3. Memahami perbedaan:
   - `persist()` vs `merge()`,
   - `find()` vs `getReference()` / `getReferenceById()`,
   - `flush()` vs `commit()`,
   - `detach()` vs `clear()` vs `close()`.
4. Memahami dirty checking dan write-behind.
5. Memahami kapan SQL dikirim ke database.
6. Memahami kenapa managed entity bisa otomatis menghasilkan `UPDATE` tanpa pemanggilan `save()` eksplisit.
7. Memahami bahaya persistence context terlalu besar.
8. Memahami lazy proxy, detached entity, dan `LazyInitializationException` dari akar konsepnya.
9. Memahami failure modes produksi yang muncul dari salah paham lifecycle.
10. Mampu mendesain transaction boundary dan repository behavior dengan mental model yang benar.

Bagian ini adalah fondasi penting sebelum masuk relationship mapping, fetching, transaction isolation, locking, batching, dan performance.

---

## 2. Mental Model Besar

### 2.1 Persistence context adalah “ruang kerja transaksi”

Bayangkan sebuah use case:

```java
@Transactional
public void approveApplication(Long applicationId, String officerId) {
    Application app = applicationRepository.findById(applicationId)
        .orElseThrow(ApplicationNotFoundException::new);

    app.approve(officerId);

    auditTrailRepository.save(AuditTrail.approved(app.getId(), officerId));
}
```

Pada kode seperti ini, sering ada pertanyaan:

> “Kenapa `app` tidak dipanggil `save()`, tapi statusnya tetap berubah di database?”

Jawabannya: karena `app` berada dalam **managed state** di dalam **persistence context**. Selama entity managed, JPA provider akan melacak perubahan state entity tersebut. Pada saat flush, perubahan itu disinkronkan ke database sebagai SQL `UPDATE`.

Jadi persistence context bukan sekadar cache biasa. Ia adalah:

1. **Identity map**  
   Satu database row dengan identity tertentu hanya direpresentasikan oleh satu object instance managed di dalam persistence context yang sama.

2. **Unit of work**  
   Semua perubahan entity dikumpulkan sebagai satu unit pekerjaan sampai flush/commit.

3. **Dirty checking engine**  
   Provider membandingkan perubahan state entity managed dengan snapshot/trackable state.

4. **Write-behind buffer**  
   Perubahan Java object tidak langsung menjadi SQL saat field diubah. SQL biasanya ditunda sampai flush.

5. **Lifecycle state machine**  
   Entity berpindah dari transient → managed → detached/removed berdasarkan operasi `EntityManager` dan transaction/session lifecycle.

### 2.2 Entity bukan record pasif

Dalam JPA, entity bukan hanya “object hasil query”. Entity adalah object yang statusnya tergantung relasi dengan persistence context.

Object dengan isi field yang sama bisa memiliki perilaku berbeda tergantung state-nya:

```java
Application a = new Application();
a.setStatus(Status.DRAFT);
```

Object di atas belum otomatis punya hubungan dengan database. Ia hanya object Java biasa.

Setelah:

```java
entityManager.persist(a);
```

object tersebut masuk ke persistence context. Ia menjadi managed. Perubahan berikutnya dapat otomatis terdeteksi.

Setelah `entityManager.close()` atau transaction/request selesai, object itu bisa menjadi detached. Field masih ada, tapi tidak lagi dilacak.

Inilah akar banyak bug:

- object terlihat seperti entity,
- punya `id`,
- field lengkap,
- tapi tidak managed.

Akibatnya perubahan tidak otomatis disimpan.

### 2.3 Persistence context bukan database

Persistence context sering disebut first-level cache, tapi istilah “cache” bisa menyesatkan kalau dianggap seperti Redis atau query result cache.

Persistence context:

- scope-nya biasanya per transaction/request,
- menyimpan managed entity instance,
- menjaga identity consistency,
- menyimpan snapshot untuk dirty checking,
- menyimpan action queue untuk insert/update/delete,
- belum tentu merepresentasikan database terkini setelah query bulk/native/update dari tempat lain.

Database tetap source of truth. Persistence context adalah **working memory** JPA untuk satu sesi kerja.

### 2.4 Flush bukan commit

Ini salah satu konsep paling penting.

`flush()` berarti:

> “Sinkronkan perubahan entity managed di persistence context ke database connection saat ini sebagai SQL.”

`commit()` berarti:

> “Akhiri database transaction dan buat perubahan yang sudah dikirim menjadi durable/visible sesuai isolation database.”

Flush dapat terjadi sebelum commit. Bahkan constraint violation bisa muncul saat flush, bukan saat commit.

Contoh:

```java
@Transactional
public void createUser() {
    User user = new User();
    user.setEmail(null); // column NOT NULL

    entityManager.persist(user);

    entityManager.flush(); // error bisa muncul di sini

    // commit belum terjadi
}
```

Jika tidak ada explicit flush, error bisa muncul saat commit karena provider melakukan flush otomatis sebelum commit.

---

## 3. Terminologi Kunci

### 3.1 Persistence unit

Persistence unit adalah konfigurasi yang mendefinisikan sekumpulan entity dan konfigurasi persistence provider.

Di era JPA klasik, ini biasanya didefinisikan melalui `persistence.xml`:

```xml
<persistence-unit name="appPU" transaction-type="RESOURCE_LOCAL">
    <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
    <class>com.example.Application</class>
    <properties>
        <property name="jakarta.persistence.jdbc.url" value="jdbc:postgresql://localhost/app"/>
        <property name="jakarta.persistence.jdbc.user" value="app"/>
        <property name="jakarta.persistence.jdbc.password" value="secret"/>
    </properties>
</persistence-unit>
```

Di Spring Boot, banyak detail ini disusun otomatis melalui auto-configuration, `DataSource`, `EntityManagerFactory`, dan properties.

### 3.2 EntityManagerFactory

`EntityManagerFactory` adalah factory untuk membuat `EntityManager`.

Karakteristik:

- heavy object,
- biasanya dibuat sekali per aplikasi/persistence unit,
- thread-safe secara konsep penggunaan factory,
- menyimpan metadata mapping,
- menyimpan konfigurasi provider,
- dapat menjadi entry point ke second-level cache/provider services.

Jangan membuat `EntityManagerFactory` per request.

### 3.3 EntityManager

`EntityManager` adalah interface utama JPA untuk:

- membuat entity managed,
- mencari entity,
- menghapus entity,
- menjalankan query,
- flush,
- detach,
- clear,
- refresh,
- lock,
- mengakses persistence context.

Karakteristik penting:

- tidak boleh dipakai sembarangan lintas thread,
- biasanya scope-nya transaction/request,
- mewakili persistence context tertentu,
- di Spring biasanya di-bind ke thread selama transaction.

### 3.4 Persistence context

Persistence context adalah himpunan managed entity instance.

Sifat penting:

- Dalam satu persistence context, satu persistent identity direpresentasikan oleh satu object instance managed.
- Entity managed akan dilacak perubahannya.
- Query terhadap entity yang sudah managed akan mengembalikan instance yang sama.
- Persistence context bisa berisi perubahan yang belum di-flush ke database.
- Persistence context bisa tidak sinkron dengan database setelah bulk update/native update jika tidak di-clear/refresh.

### 3.5 Transaction

Transaction adalah boundary konsistensi database. Persistence context sering berjalan bersama transaction, tetapi keduanya bukan konsep yang sama.

Ada beberapa mode:

1. **Transaction-scoped persistence context**  
   Persistence context hidup selama transaction aktif. Ini model umum di aplikasi Spring/Jakarta EE.

2. **Extended persistence context**  
   Persistence context hidup lebih panjang dari satu transaction, misalnya stateful session bean di Jakarta EE. Ini jarang digunakan di aplikasi modern biasa, tetapi penting secara konseptual.

3. **Application-managed EntityManager**  
   Aplikasi sendiri membuat, menutup, dan mengelola `EntityManager`.

4. **Container-managed EntityManager**  
   Container/framework mengelola lifecycle `EntityManager`.

---

## 4. Entity State Machine

Entity state adalah status hubungan sebuah object entity dengan persistence context dan database.

Diagram sederhana:

```text
       new object
          |
          | persist()
          v
+------------------+        detach()/clear()/close()
|    MANAGED       | ------------------------------+
| tracked by PC    |                               |
+------------------+                               v
      | remove()                              +-----------+
      v                                       | DETACHED  |
+------------------+                          | not tracked|
|    REMOVED       |                          +-----------+
| scheduled delete |                               |
+------------------+                               | merge()
      | flush/commit                               v
      v                                      +-------------+
 database DELETE                            | MANAGED copy |
                                            +-------------+

TRANSIENT/NEW: object biasa, belum ada di persistence context
```

### 4.1 Transient / new

Entity transient adalah object Java biasa yang belum diasosiasikan dengan persistence context.

Contoh:

```java
Application app = new Application();
app.setApplicantName("Alice");
app.setStatus(ApplicationStatus.DRAFT);
```

Pada titik ini:

- belum ada row database,
- belum ada tracking,
- perubahan field tidak akan menghasilkan SQL,
- `id` mungkin null jika generated id belum dialokasikan,
- object ini tidak dikenali persistence context.

Transient bukan error. Ini state normal sebelum entity dibuat persistent.

### 4.2 Managed / persistent

Entity managed adalah entity yang sedang diasosiasikan dengan persistence context.

Cara entity menjadi managed:

1. `persist(newEntity)`
2. `find(Entity.class, id)`
3. Query JPQL/Criteria/native mapping entity
4. `merge(detachedEntity)` mengembalikan managed copy
5. Traversal cascade persist/merge dari entity lain
6. `getReference()` menghasilkan managed reference/proxy

Contoh:

```java
@Transactional
public void updateStatus(Long id) {
    Application app = entityManager.find(Application.class, id);
    app.setStatus(ApplicationStatus.SUBMITTED);
}
```

Tidak ada `entityManager.update(app)`. Selama `app` managed, provider akan mendeteksi perubahan.

### 4.3 Detached

Entity detached adalah entity yang pernah managed, tetapi sekarang tidak lagi diasosiasikan dengan persistence context.

Penyebab:

- transaction selesai dan persistence context ditutup,
- `entityManager.detach(entity)`,
- `entityManager.clear()`,
- `entityManager.close()`,
- serialization/deserialization,
- entity dikirim keluar layer persistence lalu digunakan lagi di request lain.

Contoh:

```java
Application app;

try (EntityManager em = emf.createEntityManager()) {
    app = em.find(Application.class, 1L);
}

// em sudah close, app menjadi detached
app.setStatus(ApplicationStatus.APPROVED);

// perubahan ini tidak otomatis tersimpan
```

Detached object tetap object Java valid. Ia bisa punya `id` dan data lengkap. Tetapi tidak ada dirty checking.

### 4.4 Removed

Entity removed adalah entity managed yang dijadwalkan untuk delete.

Contoh:

```java
Application app = entityManager.find(Application.class, id);
entityManager.remove(app);
```

Pada titik ini:

- entity masih ada di persistence context,
- delete belum tentu langsung dikirim ke database,
- SQL `DELETE` terjadi saat flush,
- jika transaction rollback, delete dibatalkan.

### 4.5 State bukan hanya properti object

State entity bukan ditentukan hanya oleh ada/tidaknya `id`.

Object dengan `id != null` bisa:

- managed,
- detached,
- transient dengan assigned id,
- removed.

Maka jangan menyimpulkan state hanya dari `id`.

---

## 5. Persistence Context sebagai Identity Map

### 5.1 Satu row, satu object instance dalam satu persistence context

Contoh:

```java
@Transactional
public void identityMapExample(Long id) {
    Application a1 = entityManager.find(Application.class, id);
    Application a2 = entityManager.find(Application.class, id);

    System.out.println(a1 == a2); // true dalam persistence context yang sama
}
```

Kenapa true?

Karena persistence context memastikan identity map:

```text
(Entity class, primary key) -> managed object instance
```

Jadi saat entity dengan identity yang sama diminta lagi, provider mengembalikan instance yang sudah ada.

### 5.2 Kenapa identity map penting?

Tanpa identity map, aplikasi bisa mengalami konflik seperti:

```java
Application a1 = loadApplication(1L);
Application a2 = loadApplication(1L);

// Dua object berbeda merepresentasikan row yang sama.
a1.setStatus(SUBMITTED);
a2.setStatus(APPROVED);

// Mana yang menang?
```

Persistence context menghindari ini dalam satu unit kerja. Semua perubahan terhadap row yang sama terkonsolidasi pada object yang sama.

### 5.3 Identity map bukan query cache

Contoh:

```java
Application app = entityManager.find(Application.class, 1L);

List<Application> apps = entityManager.createQuery(
    "select a from Application a where a.id = :id", Application.class)
    .setParameter("id", 1L)
    .getResultList();

System.out.println(app == apps.get(0)); // true
```

Query tetap bisa ke database, tetapi hasil entity akan di-resolve ke managed instance yang sama jika identity-nya sudah ada di persistence context.

### 5.4 Persistence context bisa berisi data stale

Misal:

```java
Application app = entityManager.find(Application.class, 1L);

jdbcTemplate.update("update application set status = 'APPROVED' where id = 1");

Application again = entityManager.find(Application.class, 1L);
System.out.println(again.getStatus());
```

Kemungkinan nilai status masih nilai lama, karena `find()` mengembalikan managed instance yang sudah ada di persistence context, bukan otomatis reload dari database.

Solusi tergantung kebutuhan:

```java
entityManager.refresh(app);
```

atau:

```java
entityManager.clear();
Application fresh = entityManager.find(Application.class, 1L);
```

Tapi `clear()` akan melepaskan semua managed entity. Gunakan dengan sengaja.

---

## 6. Unit of Work dan Write-Behind

### 6.1 Unit of work

Unit of work berarti semua perubahan entity dalam persistence context dikumpulkan dan disinkronkan bersama.

Contoh:

```java
@Transactional
public void submitApplication(Long applicationId) {
    Application app = entityManager.find(Application.class, applicationId);
    app.submit();

    Submission submission = new Submission(app.getId(), Instant.now());
    entityManager.persist(submission);

    AuditTrail audit = AuditTrail.submitted(app.getId());
    entityManager.persist(audit);
}
```

Dalam unit kerja ini mungkin ada:

- update `application`,
- insert `submission`,
- insert `audit_trail`.

Provider menyusun SQL saat flush, bukan saat setiap setter dipanggil.

### 6.2 Write-behind

Write-behind berarti perubahan di Java object ditunda sebelum dikirim ke database.

```java
Application app = entityManager.find(Application.class, id);

app.setStatus(DRAFT);
app.setStatus(SUBMITTED);
app.setStatus(UNDER_REVIEW);

// Biasanya satu UPDATE final saat flush, bukan tiga UPDATE.
```

Manfaat:

- mengurangi SQL tidak perlu,
- memungkinkan ordering antar operation,
- memungkinkan batching,
- menjaga unit of work.

Risiko:

- error database muncul belakangan,
- developer salah mengira data sudah tersimpan,
- query tertentu memicu flush tidak terduga,
- memory persistence context membesar.

### 6.3 Action queue

Hibernate secara internal memiliki konsep antrian aksi seperti:

- entity insert actions,
- entity update actions,
- entity delete actions,
- collection recreate/update/remove actions.

JPA spec tidak memaksa istilah implementasi ini, tetapi mental model action queue sangat membantu.

Saat flush, provider mengubah perubahan object menjadi aksi SQL dengan urutan yang memenuhi constraint sebisa mungkin.

---

## 7. Operasi EntityManager secara Mendalam

## 7.1 `persist()`

`persist()` digunakan untuk membuat entity baru menjadi managed dan dijadwalkan untuk insert.

```java
Application app = new Application();
app.setApplicantName("Alice");
app.setStatus(ApplicationStatus.DRAFT);

entityManager.persist(app);
```

Setelah `persist(app)`:

- `app` menjadi managed,
- insert dijadwalkan,
- `id` mungkin langsung tersedia atau baru tersedia setelah insert, tergantung generator,
- perubahan berikutnya akan dilacak.

Contoh:

```java
Application app = new Application();
entityManager.persist(app);

app.setStatus(ApplicationStatus.DRAFT);
app.setApplicantName("Alice");

// Field yang diubah setelah persist tetap masuk ke INSERT/UPDATE sesuai provider timing.
```

### 7.1.1 `persist()` bukan “save or update”

Ini penting.

`persist()` bukan operasi upsert. Jika object detached dengan id existing diberikan ke `persist()`, provider dapat melempar exception seperti detached entity passed to persist.

Salah:

```java
Application detached = new Application();
detached.setId(1L);
detached.setStatus(APPROVED);

entityManager.persist(detached); // salah untuk update existing entity
```

Benar untuk update biasanya:

```java
Application app = entityManager.find(Application.class, 1L);
app.approve();
```

atau untuk detached:

```java
Application managed = entityManager.merge(detached);
```

Namun `merge()` juga punya konsekuensi besar yang akan dijelaskan.

### 7.1.2 `persist()` dan generated id

Dengan sequence generator, provider bisa mengambil id sebelum insert.

Dengan identity column, insert sering harus terjadi lebih awal untuk mendapatkan generated id dari database.

Dampaknya:

- `IDENTITY` sering menghambat batching insert,
- `SEQUENCE` dengan allocation/pooled optimizer lebih batch-friendly,
- behavior `id` availability berbeda antar generator/provider.

Ini sudah disentuh di Part 003, tetapi relevan untuk lifecycle karena `persist()` bisa menyebabkan SQL lebih awal tergantung id strategy.

---

## 7.2 `find()`

`find()` mengambil entity berdasarkan primary key dan mengembalikan managed instance.

```java
Application app = entityManager.find(Application.class, 1L);
```

Behavior:

1. Cek persistence context.
2. Jika ada managed entity dengan identity tersebut, return instance itu.
3. Jika tidak ada, query database.
4. Jika ditemukan, entity menjadi managed.
5. Jika tidak ditemukan, return `null`.

### 7.2.1 `find()` menghormati identity map

```java
Application a1 = entityManager.find(Application.class, 1L);
Application a2 = entityManager.find(Application.class, 1L);

assert a1 == a2;
```

### 7.2.2 `find()` bukan selalu database hit

Karena first-level cache, `find()` bisa tidak mengirim SQL jika entity sudah managed.

Ini bisa menjadi optimasi, tetapi juga bisa menyebabkan stale read dalam satu persistence context.

---

## 7.3 `getReference()`

`getReference()` mengembalikan reference/proxy entity berdasarkan id tanpa harus langsung mengambil semua state dari database.

```java
Application appRef = entityManager.getReference(Application.class, 1L);
```

Kegunaan umum:

```java
Application appRef = entityManager.getReference(Application.class, applicationId);
Comment comment = new Comment(appRef, "Need clarification");
entityManager.persist(comment);
```

Dalam kasus ini, kita hanya butuh FK ke application. Tidak perlu load full application.

### 7.3.1 Proxy mental model

Proxy adalah object yang mewakili entity tapi belum tentu fully initialized.

```text
Application$HibernateProxy
    id = 1
    initialized = false
```

Saat field non-id diakses:

```java
appRef.getApplicantName();
```

provider dapat melakukan SQL select untuk initialize proxy.

### 7.3.2 Risiko `getReference()`

1. Jika row tidak ada, error bisa muncul terlambat saat proxy diakses atau flush FK constraint terjadi.
2. Jika proxy diakses setelah persistence context tertutup, lazy initialization error bisa terjadi.
3. Proxy dapat memengaruhi `equals()` jika implementasi entity tidak proxy-safe.

### 7.3.3 `find()` vs `getReference()`

Gunakan `find()` jika:

- butuh data entity,
- perlu validasi existence segera,
- perlu menjalankan business method yang membaca state.

Gunakan `getReference()` jika:

- hanya butuh reference untuk FK,
- yakin id valid atau rela FK constraint menangkap error,
- ingin menghindari SELECT tidak perlu.

---

## 7.4 `remove()`

`remove()` menjadwalkan managed entity untuk deletion.

```java
Application app = entityManager.find(Application.class, id);
entityManager.remove(app);
```

Jika entity detached:

```java
entityManager.remove(detachedApp); // bisa error
```

Biasanya perlu:

```java
Application managed = entityManager.find(Application.class, detachedApp.getId());
entityManager.remove(managed);
```

atau:

```java
Application managed = entityManager.merge(detachedApp);
entityManager.remove(managed);
```

Namun merge hanya untuk delete sering tidak ideal karena bisa load/copy state tidak perlu.

### 7.4.1 Remove belum tentu langsung delete

SQL `DELETE` biasanya terjadi saat flush.

```java
entityManager.remove(app);

// app removed state, delete scheduled
// database row mungkin masih ada sampai flush
```

### 7.4.2 Remove dan cascade

Jika relationship memiliki cascade remove, operasi remove bisa menyebar ke child entity.

Ini powerful sekaligus berbahaya.

Contoh bahaya:

```java
@ManyToOne(cascade = CascadeType.REMOVE)
private Customer customer;
```

Jika order dihapus lalu cascade remove ke customer, data customer bisa ikut terhapus tanpa niat.

Aturan kasar:

- cascade dari parent aggregate ke child owned entity dapat masuk akal,
- cascade dari child ke parent/shared reference hampir selalu berbahaya.

---

## 7.5 `merge()`

`merge()` adalah salah satu operasi JPA yang paling sering disalahpahami.

Definisi mental:

> `merge(detached)` menyalin state dari object detached/new ke managed instance dan mengembalikan managed instance tersebut.

Contoh:

```java
Application detached = receiveFromClient();

Application managed = entityManager.merge(detached);

// managed adalah entity yang dilacak
// detached tetap detached
```

### 7.5.1 `merge()` tidak membuat object argumen menjadi managed

Ini jebakan utama.

```java
Application detached = new Application();
detached.setId(1L);
detached.setStatus(APPROVED);

Application managed = entityManager.merge(detached);

System.out.println(entityManager.contains(detached)); // false
System.out.println(entityManager.contains(managed));  // true
```

Setelah merge, perubahan pada `detached` tidak dilacak.

Salah:

```java
Application managed = entityManager.merge(detached);

detached.setStatus(REJECTED); // tidak dilacak
```

Benar:

```java
Application managed = entityManager.merge(detached);
managed.setStatus(REJECTED); // dilacak
```

### 7.5.2 `merge()` bisa menimpa data

Karena merge menyalin state dari detached object, field yang null di detached object dapat menimpa field managed menjadi null.

Contoh request partial update:

```json
{
  "id": 1,
  "status": "APPROVED"
}
```

Jika JSON langsung di-bind ke entity:

```java
Application detached = objectMapper.readValue(json, Application.class);
entityManager.merge(detached);
```

Field yang tidak dikirim client bisa menjadi null dan ikut tersalin ke managed entity.

Ini salah satu alasan entity tidak boleh dijadikan API request DTO.

Lebih aman:

```java
@Transactional
public void approve(Long id, ApproveCommand command) {
    Application app = entityManager.find(Application.class, id);
    app.approve(command.officerId(), command.reason());
}
```

### 7.5.3 `merge()` pada graph entity

Jika entity punya relationship dan cascade merge, merge bisa menyebar ke graph.

Risiko:

- unexpected insert/update child,
- delete orphan tidak sesuai ekspektasi,
- detached graph besar memicu query besar,
- stale data client menimpa state baru di database,
- security issue karena client dapat mengirim nested entity yang tidak seharusnya diubah.

Untuk sistem enterprise, hindari pola:

```java
repository.save(entityFromRequestBody);
```

Kecuali benar-benar sederhana dan terkontrol.

### 7.5.4 Kapan `merge()` masuk akal?

`merge()` masuk akal untuk:

- aplikasi desktop/stateful yang mengedit detached object lalu reconnect,
- graph detached yang memang controlled,
- legacy pattern,
- simple CRUD internal admin dengan risiko rendah,
- reattachment scenario yang dipahami penuh.

Untuk aplikasi web/API modern, biasanya lebih baik:

1. Load managed entity.
2. Jalankan business method/change method.
3. Biarkan dirty checking bekerja.

---

## 7.6 `detach()`

`detach(entity)` melepaskan satu entity dari persistence context.

```java
Application app = entityManager.find(Application.class, id);
entityManager.detach(app);

app.setStatus(APPROVED); // tidak dilacak
```

Kegunaan:

- mencegah accidental update,
- mengurangi memory tracking,
- mengirim snapshot read-only ke layer lain,
- menghindari dirty checking entity tertentu.

Risiko:

- lazy association yang belum initialized tidak bisa diakses setelah detach,
- perubahan tidak tersimpan,
- graph relationship mungkin masih berisi managed entity lain tergantung operasi/cascade detach.

---

## 7.7 `clear()`

`clear()` melepaskan semua entity dari persistence context.

```java
entityManager.clear();
```

Kegunaan penting dalam batch:

```java
for (int i = 0; i < rows.size(); i++) {
    entityManager.persist(rows.get(i));

    if (i % 100 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

Tanpa `clear()`, semua entity yang diproses tetap managed dan memory bisa membesar.

Risiko `clear()`:

- semua pending changes yang belum flush bisa hilang dari tracking,
- semua reference menjadi detached,
- setelah clear, object lama tidak lagi auto-saved.

Maka urutan batch biasanya:

```text
flush -> clear
```

bukan:

```text
clear -> flush
```

---

## 7.8 `refresh()`

`refresh(entity)` memuat ulang state entity dari database dan menimpa state managed entity.

```java
Application app = entityManager.find(Application.class, id);
app.setStatus(APPROVED);

entityManager.refresh(app); // perubahan lokal bisa hilang
```

Kegunaan:

- reload DB-generated value,
- membuang perubahan lokal,
- sinkron ulang setelah external update,
- memastikan state terbaru dari database.

Risiko:

- local changes hilang,
- bisa memicu query tambahan,
- relationship lazy/eager behavior perlu diperhatikan.

---

## 7.9 `contains()`

`contains(entity)` mengecek apakah entity managed oleh persistence context saat ini.

```java
boolean managed = entityManager.contains(app);
```

Berguna untuk debugging lifecycle.

Namun jangan membuat business logic terlalu bergantung pada `contains()`; lebih baik desain boundary jelas.

---

## 8. Dirty Checking

### 8.1 Apa itu dirty checking?

Dirty checking adalah mekanisme provider untuk mendeteksi perubahan pada managed entity.

Contoh:

```java
@Transactional
public void changeName(Long id) {
    Applicant applicant = entityManager.find(Applicant.class, id);
    applicant.setName("Alice Updated");
}
```

Tidak ada explicit update. Provider akan mendeteksi `name` berubah dan menghasilkan SQL saat flush:

```sql
update applicant
set name = ?
where id = ?
```

### 8.2 Snapshot-based dirty checking

Model umum:

1. Saat entity diload, provider menyimpan snapshot state.
2. Saat flush, provider membandingkan current state dengan snapshot.
3. Jika berbeda, entity dirty.
4. SQL update disusun.

Diagram:

```text
Load row:
    DB row -> Entity object
    DB row -> Snapshot

During transaction:
    Entity object mutated

Flush:
    compare Entity object vs Snapshot
    if different -> UPDATE
```

### 8.3 Bytecode enhancement dan field interception

Hibernate modern dapat menggunakan bytecode enhancement untuk tracking yang lebih efisien.

Alih-alih selalu membandingkan semua field, enhanced entity dapat memberi sinyal field mana yang berubah.

Namun mental model tetap sama:

- perubahan managed entity terdeteksi,
- SQL terjadi saat flush,
- detached entity tidak dilacak.

### 8.4 Dirty checking cost

Dirty checking punya biaya:

- jumlah managed entity,
- jumlah field entity,
- kompleksitas embedded object,
- collection tracking,
- flush frequency,
- bytecode enhancement atau tidak.

Jika persistence context berisi 50.000 managed entity, flush bisa berat walaupun hanya sedikit yang berubah.

Maka batch job JPA harus memakai pola flush/clear berkala.

### 8.5 Dirty checking dan immutable style

JPA entity tradisional mutable. Tapi domain logic sebaiknya menghindari setter bebas.

Lebih baik:

```java
public class Application {
    public void submit(String submittedBy) {
        if (status != DRAFT) {
            throw new InvalidApplicationStateException(...);
        }
        this.status = SUBMITTED;
        this.submittedBy = submittedBy;
        this.submittedAt = Instant.now();
    }
}
```

Daripada:

```java
app.setStatus(SUBMITTED);
app.setSubmittedBy(user);
app.setSubmittedAt(now);
```

Dirty checking tidak peduli apakah perubahan lewat setter atau method domain. Tetapi desain method domain menjaga invariant.

### 8.6 Dirty checking bukan audit

Dirty checking mendeteksi perubahan untuk SQL update. Ia bukan audit trail.

Jika butuh tahu:

- siapa mengubah,
- kapan,
- field apa berubah,
- before/after value,
- reason/correlation id,

maka butuh audit mechanism sendiri, Envers, event listener, domain event, atau audit table.

---

## 9. Flush secara Mendalam

### 9.1 Apa itu flush?

Flush adalah proses menyinkronkan state persistence context ke database.

Saat flush, provider dapat melakukan:

- SQL `INSERT`,
- SQL `UPDATE`,
- SQL `DELETE`,
- collection table operation,
- FK update,
- version increment,
- constraint interaction.

Flush tidak mengakhiri transaction.

### 9.2 Kapan flush terjadi?

Flush dapat terjadi:

1. Sebelum transaction commit.
2. Sebelum query tertentu dieksekusi, agar query melihat perubahan pending.
3. Saat `entityManager.flush()` dipanggil manual.
4. Saat provider butuh insert lebih awal untuk generated id tertentu.
5. Saat native query/provider-specific behavior tertentu.

Contoh flush sebelum query:

```java
Application app = entityManager.find(Application.class, id);
app.setStatus(SUBMITTED);

Long count = entityManager.createQuery(
    "select count(a) from Application a where a.status = :status", Long.class)
    .setParameter("status", SUBMITTED)
    .getSingleResult();
```

Provider dapat flush sebelum `select count` supaya query konsisten dengan perubahan pending.

### 9.3 Flush mode

JPA memiliki flush mode seperti:

- `AUTO`,
- `COMMIT`.

#### AUTO

Provider boleh flush sebelum query jika perlu menjaga konsistensi query terhadap persistence context.

#### COMMIT

Flush terutama dilakukan saat commit. Namun provider/database behavior tertentu tetap perlu dipahami.

Hibernate juga punya mode provider-specific seperti manual flush dalam API tertentu.

### 9.4 Flush ordering

Provider harus mempertimbangkan constraint database.

Misalnya:

```java
Customer customer = new Customer("Alice");
Order order = new Order(customer);

entityManager.persist(customer);
entityManager.persist(order);
```

SQL harus insert customer dulu, baru order, jika order punya FK ke customer.

Urutan operasi dapat menjadi kompleks dengan:

- bidirectional relationship,
- nullable FK,
- join table,
- orphan removal,
- many-to-many,
- cascade,
- unique constraint,
- self-reference.

### 9.5 Constraint violation muncul saat flush

Contoh:

```java
@Transactional
public void createDuplicateEmail() {
    User user = new User("same@example.com");
    entityManager.persist(user);

    // belum tentu error di sini

    entityManager.flush();
    // unique constraint error bisa muncul di sini
}
```

Maka error handling persistence harus sadar bahwa exception bisa muncul:

- saat persist,
- saat query yang memicu flush,
- saat explicit flush,
- saat commit,
- saat transaction completion.

### 9.6 Flush dan rollback

Jika flush sudah mengirim SQL ke database, lalu transaction rollback, perubahan tetap dibatalkan oleh database transaction.

```java
entityManager.persist(app);
entityManager.flush(); // INSERT dikirim

throw new RuntimeException(); // rollback
```

Setelah rollback, row tidak committed.

Namun efek samping non-transactional di luar database tidak ikut rollback.

Contoh bahaya:

```java
entityManager.persist(app);
entityManager.flush();

emailClient.sendEmail(...); // external side effect

throw new RuntimeException(); // DB rollback, email sudah terkirim
```

Ini akan dibahas lebih lanjut di transaction/outbox part.

---

## 10. Commit secara Mendalam

### 10.1 Commit adalah operasi transaction

Commit bukan operasi JPA entity lifecycle semata. Commit berada di level database transaction/resource transaction/JTA transaction.

Pada commit:

1. Provider biasanya flush persistence context.
2. Database transaction commit.
3. Resource dibersihkan.
4. Persistence context transaction-scoped berakhir.
5. Entity menjadi detached jika context ditutup.

### 10.2 Error saat commit

Commit bisa gagal karena:

- constraint deferred,
- network failure,
- database crash/failover,
- deadlock detected late,
- serialization failure,
- transaction timeout,
- connection issue.

Jangan berasumsi semua error muncul saat repository method dipanggil.

### 10.3 Ambiguous commit

Dalam distributed/system failure, ada kasus sulit:

- aplikasi mengirim commit,
- koneksi putus sebelum aplikasi menerima hasil,
- database mungkin commit berhasil atau tidak.

Ini dikenal sebagai ambiguous outcome.

Untuk sistem kritis, desain harus punya:

- idempotency key,
- natural/business reference unique,
- retry-safe command,
- reconciliation query,
- audit/event trail.

---

## 11. Lazy Proxy dan Lifecycle

### 11.1 Lazy loading tergantung persistence context aktif

Contoh:

```java
@Transactional
public ApplicationDto getApplication(Long id) {
    Application app = entityManager.find(Application.class, id);
    return new ApplicationDto(
        app.getId(),
        app.getApplicant().getName()
    );
}
```

Jika `applicant` lazy dan diakses dalam transaction/persistence context aktif, provider bisa load applicant.

Tapi:

```java
public Application getApplication(Long id) {
    return repository.findById(id).orElseThrow();
}

// Di luar transaction/session
Application app = service.getApplication(1L);
app.getApplicant().getName(); // bisa LazyInitializationException di Hibernate
```

Akar masalah bukan “Hibernate error aneh”, tapi:

> lazy association butuh persistence context aktif untuk initialize.

### 11.2 Open Session in View

Open Session in View membuat persistence context tetap terbuka sampai rendering response selesai.

Manfaat:

- lazy loading masih bisa terjadi di view/serialization layer,
- mengurangi error lazy initialization pada aplikasi sederhana.

Risiko:

- query terjadi di luar service boundary,
- N+1 tersembunyi di serialization,
- transaction boundary tidak jelas,
- API response dapat memicu query tidak terduga,
- persistence behavior bocor ke presentation layer.

Untuk aplikasi enterprise kompleks, lebih baik eksplisit:

- fetch plan per use case,
- DTO projection,
- entity graph,
- fetch join,
- service method membentuk response model dalam boundary yang jelas.

### 11.3 Lazy proxy dan serialization

Jangan expose entity langsung ke JSON.

Masalah:

- lazy proxy serialization error,
- infinite recursion bidirectional relationship,
- data leak,
- N+1 saat serialization,
- detached lazy field error,
- API contract berubah mengikuti entity mapping.

Lebih aman:

```java
public record ApplicationDetailResponse(
    Long id,
    String referenceNo,
    String applicantName,
    String status
) {}
```

---

## 12. Detached Entity Problem

### 12.1 Detached entity sering terjadi di aplikasi web

Request 1:

```java
Application app = repository.findById(1L).orElseThrow();
return app; // keluar dari transaction, menjadi detached
```

Request 2:

```java
app.setStatus(APPROVED);
repository.save(app); // save bisa berarti merge di Spring Data JPA
```

Masalahnya:

- state app mungkin stale,
- field tidak lengkap bisa overwrite,
- relationship graph bisa kacau,
- optimistic lock diperlukan,
- merge cascade bisa tidak terduga.

### 12.2 DTO lebih aman daripada detached entity sebagai command

Daripada mengirim entity ke client dan menerima entity kembali:

```java
@PostMapping("/applications/{id}/approve")
public void approve(@PathVariable Long id, @RequestBody Application entity) {
    repository.save(entity);
}
```

Lebih aman:

```java
@PostMapping("/applications/{id}/approve")
public void approve(@PathVariable Long id, @RequestBody ApproveApplicationRequest request) {
    applicationService.approve(id, request.reason());
}
```

Service:

```java
@Transactional
public void approve(Long id, String reason) {
    Application app = repository.findById(id).orElseThrow();
    app.approve(currentUserId(), reason);
}
```

Ini menjaga:

- transaction boundary,
- invariant,
- authorization,
- audit,
- optimistic locking,
- update minimal sesuai use case.

### 12.3 Detached entity dan optimistic lock

Jika entity punya `@Version`, merge/update stale dapat dideteksi.

```java
@Version
private long version;
```

Jika client mengirim version lama, provider dapat melempar optimistic lock exception saat flush/commit.

Namun `@Version` bukan alasan untuk expose entity sebagai API model. Ia hanya satu mekanisme correctness.

---

## 13. Extended Persistence Context dan Long Conversation

### 13.1 Transaction-scoped vs extended

Transaction-scoped persistence context:

```text
request/use case transaction begins
    persistence context active
transaction commits/rollbacks
    persistence context ends
```

Extended persistence context:

```text
conversation begins
    persistence context active across multiple transactions
transaction 1
transaction 2
transaction 3
conversation ends
```

Extended context historically berguna untuk stateful UI flow.

### 13.2 Long conversation problem

Misal proses aplikasi multi-step:

1. Draft input applicant.
2. Upload document.
3. Review declaration.
4. Submit.

Jangan otomatis menyimpan managed entity hidup selama seluruh wizard multi-menit/jam. Risiko:

- stale data,
- memory retention,
- concurrency conflict terlambat,
- detached/proxy confusion,
- session serialization issue,
- accidental update.

Lebih baik desain eksplisit:

- simpan draft per step dengan transaction pendek,
- gunakan version untuk conflict,
- gunakan command per transition,
- validasi final saat submit,
- audit setiap significant transition.

---

## 14. Persistence Context Scope dan Spring

### 14.1 EntityManager di Spring biasanya transaction-bound

Di Spring, `@PersistenceContext` atau repository JPA biasanya memakai EntityManager proxy. Proxy ini mengarah ke actual EntityManager yang di-bind ke thread saat transaction aktif.

Mental model:

```text
@Transactional method starts
    Spring opens/binds EntityManager
    transaction begins
    repository uses same EntityManager
method returns
    flush
    commit
    close/unbind EntityManager
```

### 14.2 Self-invocation problem

```java
@Service
public class ApplicationService {
    public void outer() {
        inner(); // transactional annotation on inner may not apply via proxy
    }

    @Transactional
    public void inner() {
        // may run without transaction if called internally
    }
}
```

Jika transaction tidak aktif, persistence context behavior berubah:

- lazy loading bisa gagal,
- changes may not flush as expected,
- repository method bisa membuat transaction sendiri tergantung konfigurasi,
- boundary menjadi tidak jelas.

Ini akan dibahas lebih dalam di Spring Transaction part, tetapi lifecycle entity sangat bergantung pada boundary ini.

### 14.3 Async/thread boundary

EntityManager tidak boleh dianggap aman dibawa ke thread lain.

Salah:

```java
@Transactional
public void process(Long id) {
    Application app = repository.findById(id).orElseThrow();

    CompletableFuture.runAsync(() -> {
        app.approve("system"); // entity managed di thread lain? berbahaya/salah
    });
}
```

Masalah:

- persistence context thread-bound,
- entity bisa detached/unsafe,
- transaction tidak ikut pindah,
- lazy loading error,
- race condition object state.

Benar:

```java
CompletableFuture.runAsync(() -> applicationAsyncService.approveInNewTransaction(id));
```

Thread lain load entity sendiri dalam transaction sendiri.

### 14.4 Virtual threads consideration

Java 21+ virtual threads tidak mengubah aturan persistence context.

Yang penting:

- EntityManager tetap tidak untuk dipakai concurrent lintas thread,
- transaction context tetap perlu dikelola framework,
- blocking JDBC tetap pinning/driver/pool concern tersendiri,
- connection pool tetap resource bottleneck,
- jangan membiarkan banyak virtual thread memegang transaction panjang.

Virtual threads mempermudah concurrency request, tetapi persistence context tetap harus pendek, jelas, dan bounded.

---

## 15. Lifecycle dan Repository `save()`

### 15.1 `save()` bukan konsep murni JPA

JPA `EntityManager` punya:

- `persist`,
- `merge`,
- `remove`,
- `find`.

`save()` biasanya datang dari Spring Data JPA atau abstraction lain.

Di Spring Data JPA, `save()` dapat memilih persist atau merge berdasarkan apakah entity dianggap baru.

Masalahnya, developer sering menganggap:

```java
repository.save(entity)
```

selalu berarti:

```sql
insert or update safely
```

Padahal secara konseptual bisa:

- persist new entity,
- merge detached entity,
- return managed copy,
- trigger lifecycle cascade,
- tidak langsung flush.

### 15.2 Jangan panggil `save()` untuk managed entity hanya karena kebiasaan

Contoh:

```java
@Transactional
public void approve(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();
    repository.save(app); // redundant untuk managed entity
}
```

`save(app)` tidak diperlukan jika `app` already managed.

Lebih bersih:

```java
@Transactional
public void approve(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();
}
```

Namun, dalam tim, kadang `save()` tetap dipakai sebagai convention eksplisit. Jika demikian, pahami bahwa itu bukan yang menyebabkan dirty checking bekerja.

### 15.3 `saveAndFlush()`

`saveAndFlush()` memaksa flush lebih awal.

Gunakan hanya jika butuh:

- constraint violation diketahui segera,
- generated DB value dibutuhkan segera,
- ordering dengan operation berikutnya memang perlu,
- testing behavior tertentu.

Jangan jadikan default. Flush terlalu sering mengurangi manfaat unit of work dan batching.

---

## 16. Lifecycle Callback

JPA menyediakan callback lifecycle:

- `@PrePersist`,
- `@PostPersist`,
- `@PreUpdate`,
- `@PostUpdate`,
- `@PreRemove`,
- `@PostRemove`,
- `@PostLoad`.

Contoh:

```java
@Entity
public class Application {
    @PrePersist
    void prePersist() {
        this.createdAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() {
        this.updatedAt = Instant.now();
    }
}
```

### 16.1 Kapan callback berguna?

Cocok untuk:

- timestamp teknis,
- default internal,
- simple derived field,
- audit metadata sederhana.

Tidak cocok untuk:

- logic bisnis kompleks,
- call external service,
- publish message,
- query repository lain secara bebas,
- authorization,
- workflow orchestration.

### 16.2 Callback dapat terjadi saat flush

`@PreUpdate` dapat dipanggil saat provider menentukan entity dirty pada flush.

Karena itu jangan membuat callback yang efeknya sulit diprediksi atau bergantung pada urutan query.

### 16.3 Entity listener

Callback dapat dipindah ke listener:

```java
@EntityListeners(AuditingEntityListener.class)
@Entity
public class Application {
    // ...
}
```

Spring Data JPA juga punya auditing support seperti `@CreatedDate`, `@LastModifiedDate`, tetapi tetap pahami bahwa ini berjalan dalam lifecycle persistence.

---

## 17. Persistence Context Memory Model

### 17.1 Managed entity disimpan sampai context selesai/clear/detach

Jika kamu load 100.000 row dalam satu transaction:

```java
@Transactional
public void processAll() {
    List<Application> apps = entityManager.createQuery(
        "select a from Application a", Application.class)
        .getResultList();

    for (Application app : apps) {
        app.recalculateScore();
    }
}
```

Masalah:

- semua entity masuk memory,
- semua snapshot disimpan,
- dirty checking flush mahal,
- GC pressure naik,
- transaction panjang,
- lock/undo/MVCC pressure di database.

### 17.2 Batch processing pattern

Lebih baik proses per chunk:

```java
public void processInChunks() {
    int page = 0;
    int size = 500;

    while (true) {
        List<Long> ids = findNextIds(page, size);
        if (ids.isEmpty()) {
            break;
        }

        processChunk(ids);
        page++;
    }
}

@Transactional
public void processChunk(List<Long> ids) {
    for (int i = 0; i < ids.size(); i++) {
        Application app = entityManager.find(Application.class, ids.get(i));
        app.recalculateScore();

        if (i % 100 == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }
}
```

Namun offset pagination pada changing dataset juga punya risiko. Untuk batch serius, gunakan keyset/cursor/claiming strategy.

### 17.3 Read-only query tidak otomatis free

Walaupun hanya membaca, entity hasil query tetap managed secara default.

Untuk read-heavy listing/report, gunakan projection/DTO agar tidak memenuhi persistence context dengan entity managed.

```java
select new com.example.ApplicationListItem(a.id, a.referenceNo, a.status)
from Application a
where a.status = :status
```

DTO projection tidak menjadi managed entity.

---

## 18. Bulk Update/Delete dan Persistence Context

### 18.1 Bulk JPQL bypass managed entity state

Contoh:

```java
Application app = entityManager.find(Application.class, 1L);

entityManager.createQuery(
    "update Application a set a.status = :status where a.id = :id")
    .setParameter("status", APPROVED)
    .setParameter("id", 1L)
    .executeUpdate();

System.out.println(app.getStatus()); // bisa masih nilai lama
```

Bulk update langsung ke database dan tidak otomatis menyinkronkan managed entity yang sudah ada di persistence context.

Solusi:

```java
entityManager.clear();
```

atau:

```java
entityManager.refresh(app);
```

### 18.2 Bulk operation dan lifecycle callback

Bulk update/delete biasanya tidak memanggil lifecycle callback per entity dan tidak melakukan dirty checking entity satu per satu.

Ini cocok untuk operasi massal, tetapi berbahaya jika kamu mengandalkan:

- `@PreUpdate`,
- audit listener,
- domain invariant method,
- optimistic version increment otomatis,
- cache invalidation tertentu.

Untuk bulk operation, desain explicit:

- audit mass operation,
- clear persistence context,
- handle cache invalidation,
- versioning strategy,
- where clause aman.

---

## 19. Lifecycle dan Transaction Rollback

### 19.1 Rollback memengaruhi database, bukan otomatis mengembalikan object Java secara intuitif

Contoh:

```java
Application app = entityManager.find(Application.class, id);
app.approve();

try {
    entityManager.flush();
    throw new RuntimeException();
} catch (RuntimeException e) {
    transaction.rollback();
}

System.out.println(app.getStatus()); // object Java bisa tetap APPROVED
```

Database rollback, tetapi object Java di memory tidak otomatis kembali seperti semula dalam cara yang bisa kamu andalkan.

Setelah rollback, persistence context biasanya tidak boleh dipakai lagi untuk melanjutkan business operation. Tutup/clear dan mulai transaction baru.

### 19.2 Rollback-only state

Dalam framework seperti Spring/JTA, jika exception tertentu terjadi, transaction bisa ditandai rollback-only.

Setelah itu, walaupun exception ditangkap, commit tetap gagal.

Contoh konseptual:

```java
@Transactional
public void process() {
    try {
        riskyRepositoryOperation();
    } catch (Exception e) {
        // ditangkap
    }

    // transaction mungkin sudah rollback-only
    // commit di akhir method bisa gagal
}
```

Pahami bahwa exception persistence bukan sekadar control flow biasa; ia bisa merusak transaction state.

---

## 20. Failure Modes Umum

## 20.1 Mengubah detached entity dan berharap auto-save

Salah:

```java
Application app = service.getApplication(id); // detached
app.approve();
// tidak ada update
```

Solusi:

- lakukan perubahan dalam transaction,
- load managed entity di method command,
- jangan jadikan entity sebagai state antar request.

## 20.2 Merge object dari API request

Salah:

```java
@PutMapping("/{id}")
public void update(@RequestBody Application app) {
    repository.save(app);
}
```

Risiko:

- mass assignment,
- field null overwrite,
- unauthorized relationship update,
- stale state overwrite,
- cascade merge graph.

Solusi:

- command DTO,
- load managed entity,
- apply allowed changes,
- enforce invariant.

## 20.3 Lazy loading di serializer

Salah:

```java
@GetMapping("/{id}")
public Application get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Risiko:

- lazy initialization error,
- infinite recursion,
- N+1,
- data leak.

Solusi:

- DTO/projection,
- fetch plan explicit,
- map inside transaction.

## 20.4 Persistence context bloat

Salah:

```java
@Transactional
public void importAll(List<Row> rows) {
    for (Row row : rows) {
        entityManager.persist(toEntity(row));
    }
}
```

Jika rows besar, memory naik.

Solusi:

```java
if (i % batchSize == 0) {
    entityManager.flush();
    entityManager.clear();
}
```

## 20.5 Bulk update stale entity

Salah:

```java
Application app = entityManager.find(Application.class, id);
bulkApprove(id);
return app.getStatus(); // stale
```

Solusi:

- clear/refresh,
- jangan mix entity update dan bulk update dalam context sama tanpa strategi.

## 20.6 Flush surprise before query

Salah asumsi:

```java
app.setInvalidState();

// developer kira select aman
repository.countSomething(); // query memicu flush, constraint error muncul di sini
```

Solusi:

- pahami flush mode,
- validasi sebelum state invalid masuk entity,
- explicit flush di titik yang disengaja jika butuh error dini.

## 20.7 Transaction too long

Salah:

```java
@Transactional
public void approveAndNotify(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();

    externalSystem.call(); // lama

    auditRepository.save(...);
}
```

Risiko:

- DB transaction lama,
- lock lebih lama,
- connection tertahan,
- timeout,
- external success DB rollback.

Solusi:

- pisahkan external side effect,
- outbox,
- after-commit hook,
- transaction pendek.

---

## 21. Design Reasoning: Cara Berpikir Saat Menulis Persistence Code

### 21.1 Untuk command/update use case

Pertanyaan wajib:

1. Entity apa yang harus managed?
2. Transaction boundary di mana?
3. Apa invariant yang harus dijaga sebelum state berubah?
4. Apakah butuh optimistic lock?
5. Apakah ada external side effect?
6. Apakah perubahan cukup melalui dirty checking?
7. Apakah perlu explicit flush?
8. Apakah response butuh state setelah DB-generated value?
9. Apakah ada lazy association yang akan diakses?
10. Apakah entity akan keluar dari boundary sebagai DTO atau entity?

Pattern umum:

```java
@Transactional
public void command(Command cmd) {
    Aggregate aggregate = repository.findById(cmd.id()).orElseThrow();
    aggregate.performBusinessOperation(cmd);
    audit.record(...);
    // no save required if aggregate is managed
}
```

### 21.2 Untuk query/read use case

Pertanyaan wajib:

1. Apakah butuh entity managed atau hanya DTO?
2. Berapa banyak row?
3. Apakah relationship perlu di-fetch?
4. Apakah pagination aman?
5. Apakah response serialization akan menyentuh lazy field?
6. Apakah query perlu read-only hint?
7. Apakah persistence context akan membesar?
8. Apakah data harus fresh dari DB atau boleh dari context/cache?

Pattern umum:

```java
@Transactional(readOnly = true)
public ApplicationDetailResponse getDetail(Long id) {
    return queryRepository.findDetail(id)
        .orElseThrow(ApplicationNotFoundException::new);
}
```

### 21.3 Untuk batch use case

Pertanyaan wajib:

1. Berapa ukuran dataset?
2. Apakah entity lifecycle/callback dibutuhkan?
3. Apakah bulk SQL lebih tepat?
4. Berapa chunk size?
5. Apakah retry per chunk aman?
6. Apakah operation idempotent?
7. Apakah persistence context di-clear berkala?
8. Apakah transaction terlalu panjang?
9. Apakah ada lock contention?
10. Apakah audit/reporting butuh detail per row?

Pattern umum:

```text
read ids in stable order
for each chunk:
    transaction begin
    load/process limited rows
    flush
    clear
    commit
```

---

## 22. Example: Case Management Workflow

Misal entity:

```java
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    private Long id;

    @Version
    private long version;

    @Column(nullable = false, unique = true, length = 50)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CaseStatus status;

    @Column(nullable = false)
    private Instant createdAt;

    private Instant submittedAt;
    private Instant approvedAt;
    private String approvedBy;

    protected CaseFile() {
        // JPA
    }

    public CaseFile(String caseNo) {
        this.caseNo = Objects.requireNonNull(caseNo);
        this.status = CaseStatus.DRAFT;
        this.createdAt = Instant.now();
    }

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
        this.submittedAt = Instant.now();
    }

    public void approve(String officerId) {
        if (status != CaseStatus.SUBMITTED) {
            throw new IllegalStateException("Only submitted case can be approved");
        }
        this.status = CaseStatus.APPROVED;
        this.approvedBy = Objects.requireNonNull(officerId);
        this.approvedAt = Instant.now();
    }
}
```

Service:

```java
@Service
public class CaseCommandService {
    private final CaseFileRepository caseFileRepository;
    private final AuditTrailRepository auditTrailRepository;

    public CaseCommandService(
        CaseFileRepository caseFileRepository,
        AuditTrailRepository auditTrailRepository
    ) {
        this.caseFileRepository = caseFileRepository;
        this.auditTrailRepository = auditTrailRepository;
    }

    @Transactional
    public void approveCase(Long caseId, String officerId, String reason) {
        CaseFile caseFile = caseFileRepository.findById(caseId)
            .orElseThrow(() -> new CaseNotFoundException(caseId));

        caseFile.approve(officerId);

        auditTrailRepository.save(AuditTrail.caseApproved(
            caseFile.getId(),
            officerId,
            reason,
            Instant.now()
        ));
    }
}
```

Yang terjadi:

1. Transaction dimulai.
2. Persistence context dibuat/bound.
3. `findById` load `CaseFile`, menjadi managed.
4. `caseFile.approve()` mengubah field managed entity.
5. AuditTrail baru di-persist.
6. Saat flush:
   - `UPDATE case_file ... WHERE id = ? AND version = ?`,
   - `INSERT audit_trail ...`,
   - version increment.
7. Commit.
8. Persistence context selesai, entity detached.

Tidak perlu:

```java
caseFileRepository.save(caseFile);
```

karena `caseFile` already managed.

Namun audit baru perlu `save()`/`persist()` karena itu new entity.

---

## 23. Example: Incorrect Merge-Based API Update

### 23.1 Kode yang terlihat ringkas tapi berbahaya

```java
@PutMapping("/cases/{id}")
public void updateCase(@PathVariable Long id, @RequestBody CaseFile caseFile) {
    caseFile.setId(id);
    caseFileRepository.save(caseFile);
}
```

Masalah:

1. Client bisa mengubah field yang seharusnya tidak boleh:
   - status,
   - approvedBy,
   - approvedAt,
   - version,
   - tenantId,
   - createdAt.
2. Field yang tidak dikirim bisa menjadi null.
3. Invariant method `approve()`/`submit()` dilewati.
4. Audit tidak tahu transition sebenarnya.
5. Relationship nested bisa ikut merge.
6. Stale object bisa overwrite state baru.

### 23.2 Kode yang lebih benar

```java
public record UpdateCaseDraftRequest(
    String applicantName,
    String contactEmail,
    String description
) {}
```

```java
@Transactional
public void updateDraft(Long id, UpdateCaseDraftRequest request) {
    CaseFile caseFile = caseFileRepository.findById(id)
        .orElseThrow(() -> new CaseNotFoundException(id));

    caseFile.updateDraftDetails(
        request.applicantName(),
        request.contactEmail(),
        request.description()
    );
}
```

Entity method:

```java
public void updateDraftDetails(String applicantName, String contactEmail, String description) {
    if (status != CaseStatus.DRAFT) {
        throw new IllegalStateException("Only draft case can be edited");
    }
    this.applicantName = requireNonBlank(applicantName);
    this.contactEmail = requireValidEmail(contactEmail);
    this.description = requireNonBlank(description);
}
```

Keuntungan:

- only allowed fields changed,
- invariant enforced,
- dirty checking tetap digunakan,
- no dangerous detached merge,
- audit bisa ditambahkan eksplisit.

---

## 24. Example: Batch Import dengan Flush/Clear

```java
@Service
public class ApplicationImportService {
    @PersistenceContext
    private EntityManager entityManager;

    @Transactional
    public void importRows(List<ApplicationImportRow> rows) {
        int batchSize = 100;

        for (int i = 0; i < rows.size(); i++) {
            Application app = mapToApplication(rows.get(i));
            entityManager.persist(app);

            if (i > 0 && i % batchSize == 0) {
                entityManager.flush();
                entityManager.clear();
            }
        }

        entityManager.flush();
        entityManager.clear();
    }
}
```

Penjelasan:

- `persist()` membuat setiap entity managed.
- Tanpa flush/clear, semua entity tetap ada di persistence context sampai transaction selesai.
- `flush()` mengirim SQL batch ke database.
- `clear()` melepas managed entity agar memory tidak terus naik.

Caveat:

- satu transaction besar masih bisa berat untuk database.
- Untuk data sangat besar, lebih baik chunk transaction per batch.
- Jika butuh retry, chunk harus idempotent.

---

## 25. Production Considerations

### 25.1 Logging SQL

Untuk development:

```properties
hibernate.show_sql=false
hibernate.format_sql=true
hibernate.highlight_sql=true
```

Lebih baik gunakan logger:

```properties
logging.level.org.hibernate.SQL=DEBUG
logging.level.org.hibernate.orm.jdbc.bind=TRACE
```

Nama logger berbeda antar versi Hibernate; sesuaikan versi.

Di production, hati-hati:

- bind parameter bisa mengandung PII,
- SQL log besar bisa memperparah incident,
- sampling lebih aman,
- gunakan slow query log database/APM.

### 25.2 Hibernate statistics

Hibernate statistics dapat memberi insight:

- entity load count,
- entity fetch count,
- query execution count,
- flush count,
- second-level cache hit/miss,
- collection fetch count.

Gunakan untuk mendeteksi:

- N+1,
- flush terlalu sering,
- query count abnormal,
- cache tidak efektif.

### 25.3 Metrics yang relevan

Untuk persistence context/lifecycle, monitor:

- transaction duration,
- connection checkout time,
- active connection count,
- pending connection threads,
- slow query count,
- lock wait,
- deadlock,
- rollback count,
- flush count,
- entity load count,
- heap usage saat batch,
- GC pause saat import/report.

### 25.4 Incident debugging checklist

Jika ada incident seperti API lambat/504:

1. Apakah request membuka transaction terlalu lama?
2. Apakah lazy loading terjadi saat serialization?
3. Apakah query count meningkat drastis?
4. Apakah persistence context memuat terlalu banyak entity?
5. Apakah flush terjadi sebelum query mahal?
6. Apakah ada lock wait saat flush/commit?
7. Apakah connection pool habis karena transaction panjang?
8. Apakah batch job berjalan bersamaan?
9. Apakah bulk update membuat stale context?
10. Apakah external call dilakukan di dalam transaction?

---

## 26. Anti-Pattern

### 26.1 Entity as API contract

```java
@PostMapping
public Application create(@RequestBody Application application) {
    return repository.save(application);
}
```

Masalah:

- lifecycle tidak terkendali,
- security lemah,
- persistence mapping bocor,
- lazy serialization,
- merge risk.

### 26.2 Blind save everywhere

```java
entity.setX(...);
repository.save(entity);
```

Pada managed entity, ini redundant dan membuat developer tidak memahami dirty checking.

### 26.3 Long transaction with external calls

```java
@Transactional
public void submit() {
    updateDb();
    callExternalApi();
    sendEmail();
}
```

Risiko konsistensi dan resource tinggi.

### 26.4 Batch tanpa flush/clear

```java
for (...) {
    entityManager.persist(entity);
}
```

Berbahaya untuk dataset besar.

### 26.5 Merge detached graph dari client

```java
entityManager.merge(requestBodyEntity);
```

Salah satu sumber bug paling mahal di aplikasi enterprise.

### 26.6 Mengandalkan lazy loading di luar transaction

```java
Application app = service.find(id);
return app.getApplicant().getName();
```

Jika `applicant` lazy dan context sudah tutup, gagal.

### 26.7 Menganggap flush = commit

```java
entityManager.flush();
externalSystem.notifySuccess();
// transaction bisa rollback setelah ini
```

Flush bukan durable success.

---

## 27. Checklist Praktis

### 27.1 Saat membuat entity baru

- [ ] Apakah entity benar-benar new/transient?
- [ ] Apakah id strategy sesuai use case?
- [ ] Apakah business key/unique constraint ada?
- [ ] Apakah `persist()` cukup?
- [ ] Apakah cascade persist disengaja?
- [ ] Apakah insert perlu flush segera?
- [ ] Apakah audit perlu dicatat?

### 27.2 Saat update entity

- [ ] Apakah entity managed?
- [ ] Apakah update dilakukan dalam transaction?
- [ ] Apakah business method menjaga invariant?
- [ ] Apakah perlu optimistic lock?
- [ ] Apakah update partial aman?
- [ ] Apakah tidak memakai merge dari request body?
- [ ] Apakah relationship lazy sudah difetch jika dibutuhkan?

### 27.3 Saat delete entity

- [ ] Apakah entity managed sebelum remove?
- [ ] Apakah delete fisik memang benar?
- [ ] Apakah soft delete lebih tepat?
- [ ] Apakah cascade remove aman?
- [ ] Apakah FK constraint dipahami?
- [ ] Apakah audit delete perlu?
- [ ] Apakah bulk delete akan bypass callback?

### 27.4 Saat membaca data

- [ ] Apakah butuh entity managed atau DTO?
- [ ] Apakah read-only projection lebih tepat?
- [ ] Apakah lazy association akan diakses?
- [ ] Apakah query memicu flush pending changes?
- [ ] Apakah result set besar?
- [ ] Apakah persistence context perlu clear?

### 27.5 Saat batch

- [ ] Apakah chunk size ditentukan?
- [ ] Apakah flush/clear berkala?
- [ ] Apakah transaction per chunk?
- [ ] Apakah retry idempotent?
- [ ] Apakah query pagination stabil?
- [ ] Apakah entity lifecycle callback memang dibutuhkan?
- [ ] Apakah native/bulk SQL lebih cocok?

---

## 28. Latihan dan Scenario

### Scenario 1 — Missing update

Kode:

```java
public Application load(Long id) {
    return repository.findById(id).orElseThrow();
}

public void approve(Long id) {
    Application app = load(id);
    app.approve();
}
```

Pertanyaan:

1. Kenapa update mungkin tidak masuk database?
2. Apakah `app` managed atau detached saat `approve()` dipanggil?
3. Bagaimana memperbaikinya?

Jawaban arah:

- Jika tidak ada transaction/persistence context yang mencakup load dan mutation, entity bisa detached.
- Buat method command `@Transactional`, load entity di dalam method itu, lalu mutate.

### Scenario 2 — Partial update overwrite

Client mengirim:

```json
{
  "id": 10,
  "status": "APPROVED"
}
```

Controller:

```java
repository.save(requestBodyEntity);
```

Pertanyaan:

1. Field apa yang bisa rusak?
2. Kenapa merge berbahaya?
3. Pattern apa yang lebih benar?

Jawaban arah:

- Null overwrite, unauthorized field update, stale data, cascade graph.
- Gunakan command DTO dan managed entity update.

### Scenario 3 — Constraint error muncul di query count

Kode:

```java
app.setReferenceNo(null);
Long count = repository.countByStatus(SUBMITTED);
```

Error `NOT NULL` muncul saat count.

Pertanyaan:

1. Kenapa query count bisa memunculkan update error?
2. Apa hubungan flush mode AUTO?
3. Bagaimana debugging-nya?

Jawaban arah:

- Query dapat memicu flush pending changes sebelum select.
- Error berasal dari dirty entity, bukan count query itu sendiri.

### Scenario 4 — Batch memory leak

Kode import 500.000 row dengan `persist()` dalam satu transaction.

Pertanyaan:

1. Kenapa heap naik?
2. Apa yang disimpan persistence context?
3. Bagaimana pattern flush/clear?
4. Kapan bulk/native lebih tepat?

### Scenario 5 — Bulk update stale

Kode:

```java
Application app = entityManager.find(Application.class, id);
bulkApprove(id);
return app.getStatus();
```

Pertanyaan:

1. Kenapa status bisa lama?
2. Apa solusi `refresh` vs `clear`?
3. Apa risiko bulk update terhadap callback/audit/version?

---

## 29. Ringkasan

Persistence context adalah inti JPA/Hibernate. Ia bukan sekadar cache, tetapi gabungan:

- identity map,
- unit of work,
- dirty checking engine,
- write-behind buffer,
- lifecycle state manager.

Empat state utama entity:

1. **Transient/new** — object Java biasa, belum dilacak.
2. **Managed/persistent** — dilacak persistence context, dirty checking aktif.
3. **Detached** — pernah managed, sekarang tidak dilacak.
4. **Removed** — managed entity yang dijadwalkan untuk delete.

Operasi penting:

- `persist()` untuk entity baru.
- `find()` untuk load managed entity.
- `getReference()` untuk lazy reference/proxy.
- `merge()` untuk menyalin detached state ke managed copy, bukan membuat argumen menjadi managed.
- `remove()` untuk delete managed entity.
- `flush()` untuk sinkronisasi SQL, bukan commit.
- `clear()` untuk detach semua entity.
- `refresh()` untuk reload dari database.

Prinsip desain:

- Untuk update use case, load managed entity di dalam transaction lalu jalankan business method.
- Jangan merge entity dari request body.
- Jangan expose entity langsung sebagai API response.
- Jangan mengandalkan lazy loading di luar transaction boundary.
- Jangan memproses batch besar tanpa flush/clear/chunking.
- Jangan mengira flush berarti commit.
- Jangan membawa entity managed lintas thread/request.

Kalau kamu memahami bagian ini dengan benar, banyak behavior JPA/Hibernate yang sebelumnya terasa “magis” akan menjadi predictable.

---

## 30. Referensi Resmi dan Lanjutan

Referensi utama:

1. Jakarta Persistence 3.2 Specification — persistence and object/relational mapping standard untuk Jakarta EE dan Java SE.
2. Jakarta Persistence `EntityManager` API — operasi yang memengaruhi persistence context dan lifecycle entity.
3. Hibernate ORM User Guide — dokumentasi provider Hibernate untuk persistence context, flushing, dirty checking, mapping, query, dan behavior provider-specific.
4. Hibernate ORM 7 Introduction — penjelasan modern tentang persistence context sebagai first-level cache dan dirty checking.
5. Spring Framework / Spring Data JPA documentation — untuk integrasi transaction-bound EntityManager, repository `save`, dan transaction proxy behavior.

---

## 31. Koneksi ke Part Berikutnya

Part ini menjelaskan **state dan engine internal**. Part berikutnya akan masuk ke mapping dasar secara benar:

```text
Part 005 — Mapping Fundamentals Done Correctly
```

Kita akan membahas bagaimana field Java dipetakan ke column database, termasuk `@Entity`, `@Table`, `@Column`, enum, Java Time, LOB, converter, default value, generated column, dan contract antara entity mapping dengan schema database.

