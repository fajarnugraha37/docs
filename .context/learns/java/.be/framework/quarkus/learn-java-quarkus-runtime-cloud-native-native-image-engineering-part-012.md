# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-012.md

# Part 012 — Persistence III: Hibernate Reactive, Reactive SQL Clients, dan Transaction Semantics

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / top 1% engineering mindset  
> Fokus: Quarkus persistence yang benar-benar reactive, bukan sekadar “return `Uni<T>` dari method database”  
> Status: Part 012 dari maksimal 35 part  
> Prasyarat seri sebelumnya: Java concurrency/reactive, JDBC/HikariCP, JPA/Hibernate ORM, Quarkus execution model, Mutiny, Quarkus REST, Panache, transaction boundary

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- Hibernate ORM blocking di Quarkus.
- Panache Active Record vs Repository vs domain-centric persistence.
- Transaction boundary dan persistence ownership dari sisi desain domain.

Sekarang kita masuk ke wilayah yang lebih rawan salah desain:

> **Persistence reactive di Quarkus.**

Banyak engineer melihat Hibernate Reactive atau Reactive SQL Client lalu langsung menyimpulkan:

> “Kalau pakai Quarkus, semua database access sebaiknya reactive.”

Itu asumsi yang lemah.

Reactive persistence bukan upgrade otomatis dari JDBC. Reactive persistence adalah **model eksekusi berbeda** dengan konsekuensi berbeda terhadap:

- thread,
- transaction,
- session,
- connection,
- retry,
- error propagation,
- lock contention,
- backpressure,
- testing,
- observability,
- dan maintainability.

Di akhir part ini kamu harus bisa menjawab:

1. Apa beda **Hibernate ORM blocking**, **Hibernate Reactive**, dan **Reactive SQL Client**?
2. Kapan reactive database access benar-benar memberi nilai?
3. Kapan reactive database access hanya menambah kompleksitas?
4. Kenapa `@Transactional` blocking tidak sama dengan transaction reactive?
5. Kenapa reactive pipeline harus mempertahankan session/transaction context?
6. Apa failure mode umum saat mencampur blocking ORM dan reactive execution?
7. Bagaimana mendesain persistence layer reactive yang tetap domain-centric dan production-grade?
8. Bagaimana mengevaluasi apakah service regulatory/case-management cocok memakai reactive persistence?

---

## 1. Core Thesis

Thesis utama part ini:

> **Reactive persistence bukan tentang membuat query menjadi lebih cepat. Reactive persistence adalah tentang menjaga thread event-loop tidak diblokir ketika workload IO-bound berjalan dengan concurrency tinggi.**

Database relational tetap memiliki constraint fisik:

- query tetap butuh waktu di database engine,
- lock tetap lock,
- transaction tetap menahan resource,
- connection tetap terbatas,
- index tetap menentukan performa,
- isolation level tetap mempengaruhi concurrency,
- row contention tetap menyebabkan waiting,
- query buruk tetap buruk.

Reactive tidak mengubah fakta itu.

Yang berubah adalah **cara aplikasi menunggu hasil IO**.

Pada JDBC blocking:

```text
request thread
  -> kirim query
  -> thread menunggu socket/database response
  -> response datang
  -> thread lanjut
```

Pada reactive SQL client:

```text
event-loop / reactive pipeline
  -> kirim query async
  -> thread tidak menunggu
  -> callback/promise/Uni dilanjutkan saat response datang
```

Jadi yang dihemat adalah **thread blocking time**, bukan waktu kerja database.

---

## 2. Tiga Model Persistence di Quarkus

Secara praktis ada tiga model besar.

```text
+--------------------------+---------------------------+-----------------------------+
| Model                    | API Style                 | Execution Nature            |
+--------------------------+---------------------------+-----------------------------+
| Hibernate ORM + JDBC     | EntityManager / Panache   | Blocking                    |
| Hibernate Reactive       | Mutiny.Session / Panache  | Async non-blocking DB IO    |
| Reactive SQL Client      | PgPool/MySQLPool/...      | Low-level async SQL client  |
+--------------------------+---------------------------+-----------------------------+
```

Mari pecah.

---

## 3. Model 1 — Hibernate ORM Blocking

Ini model yang paling umum.

Karakteristik:

- memakai JDBC driver,
- blocking IO,
- entity model JPA/Hibernate,
- `EntityManager`,
- `Session`,
- `@Transactional`,
- lazy loading,
- dirty checking,
- flush,
- persistence context,
- cocok untuk imperative service layer.

Contoh:

```java
@ApplicationScoped
public class CaseService {

    @Inject
    EntityManager em;

    @Transactional
    public CaseRecord approve(UUID id, UserId approver) {
        CaseRecord record = em.find(CaseRecord.class, id);

        record.approve(approver);

        return record;
    }
}
```

Mental model:

```text
method masuk
  -> transaction dibuka
  -> Hibernate session/persistence context aktif
  -> query blocking
  -> domain logic imperative
  -> flush/commit
  -> method selesai
```

Kelebihan:

- sederhana,
- mature,
- predictable,
- cocok untuk domain logic kompleks,
- debugging mudah,
- ecosystem sangat luas,
- cocok dengan transaction model tradisional.

Kekurangan:

- thread akan menunggu saat DB IO,
- perlu worker thread,
- concurrency tinggi butuh thread pool cukup,
- tidak ideal untuk event-loop path jika tidak diberi `@Blocking`,
- tidak native reactive.

Kapan cocok:

- CRUD/domain service kompleks,
- transaction-heavy workload,
- regulatory workflow,
- case lifecycle,
- audit,
- reporting command,
- back-office system,
- workload moderate,
- developer productivity dan correctness lebih penting daripada extreme connection concurrency.

---

## 4. Model 2 — Hibernate Reactive

Hibernate Reactive memberi model ORM yang memakai non-blocking database clients.

Bukan JDBC.

Ia memakai reactive SQL clients di bawahnya dan mengekspos API berbasis Mutiny:

- `Mutiny.SessionFactory`,
- `Mutiny.Session`,
- `Uni<T>`,
- `@WithSession`,
- `@WithTransaction`,
- Hibernate Reactive Panache.

Contoh konseptual:

```java
@ApplicationScoped
public class ReactiveCaseService {

    @WithTransaction
    public Uni<CaseRecord> approve(UUID id, UserId approver) {
        return CaseRecord.<CaseRecord>findById(id)
                .onItem().ifNull().failWith(() -> new NotFoundException("case not found"))
                .invoke(record -> record.approve(approver));
    }
}
```

Mental model:

```text
method masuk
  -> mengembalikan Uni
  -> session reactive tersedia
  -> query dikirim async
  -> pipeline lanjut saat result datang
  -> mutation dilakukan di pipeline
  -> flush/commit reactive
```

Perhatikan: method tidak “langsung return entity”; method return **deskripsi pekerjaan async** (`Uni`).

Kelebihan:

- non-blocking database IO,
- cocok dengan Quarkus REST reactive path,
- tidak membakar worker thread saat menunggu DB,
- dapat meningkatkan scalability untuk IO-bound high concurrency,
- masih memberi ORM abstraction.

Kekurangan:

- transaction semantics lebih sulit,
- session context harus dijaga dalam reactive chain,
- tidak semua pola ORM blocking bisa dipindah langsung,
- lazy loading lebih rawan,
- debugging stacktrace lebih sulit,
- domain logic imperative kompleks bisa menjadi pipeline yang susah dibaca,
- library blocking tidak boleh masuk pipeline event-loop.

Kapan cocok:

- high-concurrency IO-bound API,
- simple-to-medium data access,
- banyak request menunggu database/network,
- endpoint reactive end-to-end,
- team sudah paham Mutiny,
- latency/cost benefit terbukti lewat benchmark.

---

## 5. Model 3 — Reactive SQL Client

Reactive SQL Client lebih rendah level daripada Hibernate Reactive.

Ia tidak memberi ORM. Kamu berinteraksi dengan SQL dan row secara eksplisit.

Contoh:

```java
@ApplicationScoped
public class CaseQueryDao {

    @Inject
    PgPool client;

    public Uni<List<CaseSummary>> findOpenCases(String officerId) {
        return client.preparedQuery("""
                select id, reference_no, status, created_at
                from case_record
                where assigned_officer_id = $1
                  and status in ('OPEN', 'IN_REVIEW')
                order by created_at desc
                limit 100
                """)
            .execute(Tuple.of(officerId))
            .onItem().transform(rows -> {
                List<CaseSummary> result = new ArrayList<>();
                for (Row row : rows) {
                    result.add(new CaseSummary(
                            row.getUUID("id"),
                            row.getString("reference_no"),
                            row.getString("status"),
                            row.getOffsetDateTime("created_at")
                    ));
                }
                return result;
            });
    }
}
```

Mental model:

```text
SQL explicit
  -> async execution
  -> map rows manually
  -> no persistence context
  -> no dirty checking
  -> no entity lifecycle
```

Kelebihan:

- sangat eksplisit,
- predictable query shape,
- cocok untuk read model,
- cocok untuk performance-sensitive query,
- tidak ada ORM magic,
- tidak ada lazy loading surprise,
- lebih mudah mengontrol projection.

Kekurangan:

- mapping manual,
- tidak ada entity state management,
- transaction manual/reactive,
- domain write model bisa verbose,
- lebih mudah duplikasi SQL,
- lebih banyak boilerplate.

Kapan cocok:

- read-heavy API,
- dashboard,
- listing/search,
- reporting lightweight,
- projection query,
- performance-critical path,
- query yang terlalu kompleks untuk ORM,
- CQRS read model.

---

## 6. Perbandingan Decision Matrix

```text
+------------------------------+----------------------+----------------------+----------------------+
| Kriteria                     | Hibernate ORM JDBC   | Hibernate Reactive   | Reactive SQL Client  |
+------------------------------+----------------------+----------------------+----------------------+
| IO model                     | Blocking             | Non-blocking         | Non-blocking         |
| API style                    | Imperative           | Mutiny reactive      | Mutiny reactive      |
| ORM abstraction              | Strong               | Strong-ish           | None                 |
| Entity lifecycle             | Full Hibernate       | Reactive Hibernate   | Manual               |
| Dirty checking               | Yes                  | Yes, constrained     | No                   |
| Query control                | Medium               | Medium               | High                 |
| Debugging simplicity         | High                 | Medium/Low           | Medium               |
| Domain complexity fit        | High                 | Medium               | Low/Medium           |
| Read model fit               | Medium               | Medium               | High                 |
| High concurrency IO fit      | Medium               | High                 | High                 |
| Team learning curve          | Low/Medium           | High                 | Medium/High          |
| Migration from JPA           | Easy                 | Medium/Hard          | Hard                 |
| Native image compatibility   | Good with Quarkus    | Good with constraints| Good with constraints|
+------------------------------+----------------------+----------------------+----------------------+
```

Simple rule:

```text
Complex domain write model -> Hibernate ORM blocking is often better.
High-concurrency reactive API with manageable domain logic -> Hibernate Reactive may fit.
Performance-sensitive projection/read model -> Reactive SQL Client may fit.
```

---

## 7. The Biggest Misconception: Reactive DB Does Not Increase DB Capacity

Misconception:

> “Kalau pakai reactive, database bisa handle lebih banyak query.”

Tidak otomatis.

Database tetap punya batas:

- CPU,
- memory,
- buffer cache,
- IO,
- connection handling,
- lock manager,
- query planner,
- index quality,
- transaction contention.

Reactive client bisa membuat aplikasi mampu **menunggu lebih banyak IO tanpa thread banyak**, tetapi database tetap harus memproses query.

Bahkan reactive bisa memperburuk situasi jika:

- concurrency tidak dibatasi,
- semua request langsung membuka query,
- tidak ada backpressure,
- tidak ada rate limit,
- transaction terlalu lama,
- query lambat,
- pool size terlalu besar,
- retry storm terjadi.

Model buruk:

```text
10_000 incoming requests
  -> semua membuat Uni database
  -> semua subscribe hampir bersamaan
  -> pool penuh
  -> queue menumpuk
  -> latency naik
  -> timeout
  -> retry
  -> database makin overload
```

Reactive butuh **concurrency governance**.

---

## 8. JDBC Blocking vs Reactive Client: Apa yang Sebenarnya Berubah?

JDBC blocking:

```text
Thread A:
  query()
  wait
  wait
  wait
  result
```

Reactive:

```text
Event loop:
  send query
  register continuation
  free to process other work

Later:
  DB response arrives
  continue Uni pipeline
```

Di JVM, thread itu mahal relatif terhadap callback continuation, tetapi bukan gratis juga. Java virtual threads mengubah trade-off ini, tapi tidak menghapus kebutuhan memahami blocking vs non-blocking.

Dengan virtual threads:

```text
virtual thread blocks
  -> carrier thread can be released in many blocking cases
```

Namun:

- JDBC driver masih blocking API,
- database connection tetap resource terbatas,
- pinning bisa terjadi,
- transaction tetap menahan connection,
- connection pool tetap membatasi concurrency.

Jadi pilihan modern bukan lagi:

```text
reactive selalu lebih scalable daripada blocking
```

Tapi:

```text
Reactive, blocking worker thread, dan virtual threads adalah tiga model concurrency dengan trade-off berbeda.
```

---

## 9. Reactive End-to-End Requirement

Reactive persistence paling aman jika pipeline reactive end-to-end:

```text
HTTP request
  -> Quarkus REST returns Uni<Response>
  -> service returns Uni<DomainResult>
  -> repository returns Uni<Entity>
  -> reactive DB client
  -> response serialization
```

Jangan seperti ini:

```java
public Uni<Response> endpoint() {
    CaseRecord record = blockingService.approve(id); // blocking call
    return Uni.createFrom().item(Response.ok(record).build());
}
```

Itu bukan reactive. Itu blocking call yang dibungkus `Uni`.

Anti-pattern:

```java
public Uni<CaseRecord> find(UUID id) {
    return Uni.createFrom().item(() -> entityManager.find(CaseRecord.class, id));
}
```

Masalah:

- `entityManager.find` tetap blocking,
- kalau berjalan di event loop, event loop terblokir,
- kalau dipindah ke worker, kamu hanya membuat imperative async wrapper,
- transaction context bisa kacau,
- tidak memberi benefit reactive database.

Correct principle:

```text
Reactive API harus didukung oleh non-blocking implementation.
```

---

## 10. Hibernate Reactive Session Semantics

Pada Hibernate ORM blocking, session sering terasa implicit:

```java
@Transactional
public CaseRecord load(UUID id) {
    return em.find(CaseRecord.class, id);
}
```

Pada Hibernate Reactive, session adalah bagian dari reactive chain.

Konseptual:

```java
@Inject
Mutiny.SessionFactory sessionFactory;

public Uni<CaseRecord> load(UUID id) {
    return sessionFactory.withSession(session ->
        session.find(CaseRecord.class, id)
    );
}
```

Atau dengan annotation:

```java
@WithSession
public Uni<CaseRecord> load(UUID id) {
    return CaseRecord.findById(id);
}
```

Invariants:

1. Entity operation reactive harus terjadi saat reactive session tersedia.
2. Session tidak boleh dipakai seperti object imperative jangka panjang.
3. Jangan menyimpan session di field.
4. Jangan memecah pipeline sehingga entity operation terjadi di luar session.
5. Jangan mengira semua lazy access aman setelah `Uni` selesai.

---

## 11. Hibernate Reactive Transaction Semantics

Blocking transaction:

```java
@Transactional
public void approve(UUID id) {
    CaseRecord record = em.find(CaseRecord.class, id);
    record.approve();
}
```

Reactive transaction:

```java
@WithTransaction
public Uni<CaseRecord> approve(UUID id) {
    return CaseRecord.<CaseRecord>findById(id)
            .onItem().ifNull().failWith(NotFoundException::new)
            .invoke(CaseRecord::approve);
}
```

Perbedaan penting:

```text
Blocking:
  transaction scope ~= method call stack

Reactive:
  transaction scope ~= asynchronous pipeline
```

Dalam reactive, transaction harus mengikuti chain `Uni`.

Masalah umum:

```java
@WithTransaction
public Uni<CaseRecord> approve(UUID id) {
    Uni<CaseRecord> uni = CaseRecord.findById(id);

    uni.subscribe().with(record -> record.approve()); // buruk

    return uni;
}
```

Kenapa buruk?

- subscribe manual memecah lifecycle,
- transaction annotation mengharapkan chain dikembalikan,
- error propagation bisa terpisah,
- commit bisa terjadi sebelum side effect selesai,
- observability kacau.

Invariant:

> Di reactive Quarkus, jangan manual subscribe di application service biasa. Return pipeline ke framework.

---

## 12. `@Transactional` vs `@WithTransaction`

Jangan disamakan.

```java
@Transactional
public CaseRecord imperative() {
    ...
}
```

Digunakan untuk blocking transaction/JTA style.

```java
@WithTransaction
public Uni<CaseRecord> reactive() {
    ...
}
```

Digunakan untuk Hibernate Reactive transaction.

Anti-pattern:

```java
@Transactional
public Uni<CaseRecord> reactiveWrong(UUID id) {
    return CaseRecord.findById(id);
}
```

Masalah:

- `@Transactional` mengelola transaction imperative,
- method return cepat dengan `Uni`,
- pekerjaan database terjadi kemudian,
- transaction imperative bisa sudah selesai,
- context mismatch.

Rule:

```text
Blocking ORM -> @Transactional
Hibernate Reactive -> @WithTransaction / sessionFactory.withTransaction(...)
Reactive SQL Client -> transaction API reactive client
```

---

## 13. Reactive SQL Client Transaction

Dengan reactive SQL client, transaction lebih eksplisit.

Konseptual:

```java
public Uni<Void> transfer(UUID from, UUID to, BigDecimal amount) {
    return pool.withTransaction(conn ->
        conn.preparedQuery("""
                update account
                set balance = balance - $1
                where id = $2
                """)
            .execute(Tuple.of(amount, from))
            .chain(() ->
                conn.preparedQuery("""
                        update account
                        set balance = balance + $1
                        where id = $2
                        """)
                    .execute(Tuple.of(amount, to))
            )
            .replaceWithVoid()
    );
}
```

Mental model:

```text
withTransaction opens transaction
  -> first async query
  -> second async query
  -> if all success: commit
  -> if any failure: rollback
```

Invariants:

1. Semua operation dalam transaction harus memakai connection transaction yang sama.
2. Jangan keluar dari `withTransaction` lalu menjalankan query lain dengan pool biasa.
3. Jangan melakukan side effect eksternal irreversible di tengah transaction tanpa outbox.
4. Error harus propagate agar rollback terjadi.
5. Retry transaction harus idempotent atau guarded.

---

## 14. Mutiny Pipeline Patterns untuk Persistence

### 14.1 `chain` untuk dependent async operation

```java
return findCase(id)
        .chain(record -> findOfficer(record.assignedOfficerId())
                .map(officer -> new CaseWithOfficer(record, officer)));
```

Gunakan `chain` ketika operation kedua menghasilkan `Uni`.

### 14.2 `map` / `transform` untuk synchronous transformation

```java
return repository.findSummary(id)
        .map(summary -> Response.ok(summary).build());
```

Jangan pakai `map` untuk method yang return `Uni`.

Buruk:

```java
return findCase(id)
        .map(record -> repository.save(record)); // hasilnya Uni<Uni<T>>
```

Benar:

```java
return findCase(id)
        .chain(record -> repository.save(record));
```

### 14.3 `invoke` untuk side effect synchronous ringan

```java
return findCase(id)
        .invoke(record -> log.debugf("Loaded case %s", record.id));
```

Jangan taruh blocking side effect di `invoke`.

Buruk:

```java
return findCase(id)
        .invoke(record -> auditFileWriter.write(record)); // blocking IO
```

### 14.4 `call` untuk side effect async

```java
return findCase(id)
        .call(record -> auditPublisher.publish(record.toAuditEvent()));
```

`call` menjaga item asli tetapi menunggu async side effect selesai.

---

## 15. Error Propagation dan Rollback

Dalam reactive transaction, rollback bergantung pada failure propagation.

Benar:

```java
@WithTransaction
public Uni<CaseRecord> approve(UUID id) {
    return CaseRecord.<CaseRecord>findById(id)
            .onItem().ifNull().failWith(() -> new NotFoundException("not found"))
            .invoke(CaseRecord::approve);
}
```

Jika NotFoundException terjadi, pipeline failure, transaction rollback.

Buruk:

```java
@WithTransaction
public Uni<CaseRecord> approve(UUID id) {
    return CaseRecord.<CaseRecord>findById(id)
            .onFailure().recoverWithNull()
            .invoke(record -> {
                if (record != null) {
                    record.approve();
                }
            });
}
```

Masalah:

- failure disembunyikan,
- transaction bisa commit,
- caller menerima success/null,
- audit/contract kacau.

Rule:

```text
Recover hanya jika benar-benar ada fallback semantic.
Jangan recover hanya supaya pipeline "tidak error".
```

---

## 16. Retry Semantics pada Reactive Persistence

Retry database operation berbahaya jika tidak dipahami.

Contoh:

```java
return repository.insertApplication(command)
        .onFailure(TransientDatabaseException.class)
        .retry()
        .atMost(3);
```

Pertanyaan wajib:

1. Apakah insert idempotent?
2. Apakah command punya idempotency key?
3. Jika commit berhasil tapi response hilang, retry akan duplicate?
4. Apakah unique constraint melindungi?
5. Apakah retry memperbesar lock contention?
6. Apakah retry dilakukan di dalam atau luar transaction?
7. Apakah error transient atau constraint/domain error?

Untuk write operation, retry aman jika:

- command idempotent,
- unique key ada,
- conflict ditangani sebagai success/known outcome,
- retry memiliki backoff,
- retry budget kecil,
- ada observability.

Pattern:

```java
return createWithIdempotencyKey(command)
        .onFailure(this::isTransient)
        .retry().withBackOff(Duration.ofMillis(50), Duration.ofMillis(500)).atMost(3);
```

Tapi jangan retry:

- validation error,
- authorization error,
- constraint violation yang domain-significant,
- optimistic lock conflict tanpa re-read strategy,
- non-idempotent external side effect.

---

## 17. Timeout Semantics

Timeout reactive:

```java
return repository.findCase(id)
        .ifNoItem().after(Duration.ofSeconds(2)).fail();
```

Timeout harus diposisikan sebagai **time budget**, bukan kosmetik.

Layer timeout:

```text
HTTP request timeout
  > service operation timeout
    > database query timeout
      > pool acquisition timeout
```

Kalau urutan salah:

```text
HTTP timeout 2s
DB timeout 30s
```

Maka request sudah gagal di caller, tetapi DB query masih bisa berjalan/menunggu.

Good principle:

```text
Lower-level timeout harus sejalan dengan upper-level time budget.
```

Untuk transaction:

```text
transaction timeout <= service operation budget <= API budget
```

---

## 18. Pool Size dan Concurrency Governance

Reactive client tidak berarti unlimited concurrency.

Misal pool size 20:

```text
pool connections = 20
incoming concurrent DB operations = 1000
```

Maka 980 operation akan menunggu queue/pool.

Masalah:

- latency naik,
- timeout,
- retry,
- memory pressure,
- fairness issue,
- event loop tetap hidup tapi sistem tidak sehat.

Perlu governance:

```text
incoming request
  -> admission control
  -> rate limit / semaphore / bulkhead
  -> DB pool
  -> query
```

Contoh konseptual Mutiny dengan semaphore async tidak sesederhana imperative. Tetapi secara desain kamu harus punya:

- max concurrent DB workflows,
- max queue,
- timeout,
- reject early,
- metrics untuk queue/pool,
- circuit breaker jika DB degraded.

Rule:

> Reactive mengurangi thread waiting, bukan menghilangkan kebutuhan capacity planning.

---

## 19. Lazy Loading dalam Hibernate Reactive

Lazy loading di reactive lebih tricky.

Pada blocking ORM:

```java
CaseRecord record = em.find(CaseRecord.class, id);
record.getDocuments().size(); // bisa trigger lazy load saat session aktif
```

Pada reactive ORM, lazy association perlu asynchronous handling.

Jangan mengandalkan lazy load tersembunyi seperti imperative.

Lebih baik:

- fetch join eksplisit,
- DTO projection,
- query khusus,
- load association dalam chain,
- desain aggregate boundary kecil.

Bad design:

```java
return CaseRecord.<CaseRecord>findById(id)
        .map(record -> new CaseDto(
                record.id,
                record.documents.size() // hidden lazy access problem
        ));
```

Better:

```java
return CaseRecord.find("""
        select c
        from CaseRecord c
        left join fetch c.documents
        where c.id = ?1
        """, id)
    .firstResult()
    .map(CaseDto::from);
```

Tetapi fetch join juga punya risiko:

- duplicate rows,
- pagination rusak,
- cartesian explosion,
- memory besar.

Untuk listing:

```text
Jangan fetch seluruh object graph.
Gunakan projection/query khusus.
```

---

## 20. Domain Logic dalam Reactive Pipeline

Reactive pipeline bisa membuat domain logic terlihat terfragmentasi.

Buruk:

```java
return CaseRecord.<CaseRecord>findById(id)
    .onItem().ifNull().failWith(NotFoundException::new)
    .invoke(record -> record.validateA())
    .chain(record -> checkSomething(record)
        .invoke(result -> {
            if (!result.allowed()) {
                throw new ForbiddenException();
            }
        })
        .replaceWith(record))
    .invoke(record -> record.transitionToApproved())
    .chain(record -> audit(record))
    .replaceWith(record);
```

Pipeline terlalu banyak mencampur:

- load,
- validation,
- authorization,
- transition,
- audit,
- persistence.

Lebih baik pecah semantic operation:

```java
@WithTransaction
public Uni<ApproveResult> approve(ApproveCommand command) {
    return loadAggregate(command.caseId())
            .chain(record -> authorizationPolicy.ensureCanApprove(command.user(), record)
                    .replaceWith(record))
            .invoke(record -> record.approve(command))
            .call(record -> auditOutbox.append(AuditEvent.caseApproved(record, command)))
            .map(ApproveResult::from);
}
```

Lebih baik lagi, domain logic imperative tetap di entity/domain object:

```java
record.approve(command);
```

Reactive hanya mengatur IO orchestration.

Rule:

```text
Jangan jadikan Mutiny operator sebagai pengganti domain model.
```

---

## 21. Reactive Repository Design

Interface reactive repository harus eksplisit.

```java
public interface ReactiveCaseRepository {

    Uni<Optional<CaseRecord>> findById(CaseId id);

    Uni<Void> persist(CaseRecord record);

    Uni<List<CaseSummary>> findAssignedSummaries(OfficerId officerId, PageRequest page);

    Uni<Boolean> existsByReferenceNo(String referenceNo);
}
```

Hindari:

```java
CaseRecord findById(CaseId id); // blocking
Uni<CaseRecord> findById(CaseId id); // null ambiguous
```

Lebih baik:

```java
Uni<Optional<CaseRecord>>
```

Atau domain result:

```java
Uni<FindCaseResult>
```

Namun dalam Mutiny, `Uni<Optional<T>>` kadang lebih jelas untuk boundary repository.

Untuk command operation:

```java
Uni<SaveResult> save(CaseRecord record);
```

Jangan return entity jika tidak perlu.

```java
Uni<Void> save(CaseRecord record);
```

atau

```java
Uni<VersionedId> save(CaseRecord record);
```

---

## 22. Reactive Service Boundary

Service reactive idealnya return `Uni<DomainResult>`.

```java
@ApplicationScoped
public class CaseApplicationService {

    private final ReactiveCaseRepository cases;
    private final ReactiveAuditOutbox outbox;
    private final ReactiveAuthorizationPolicy authorization;

    public CaseApplicationService(
            ReactiveCaseRepository cases,
            ReactiveAuditOutbox outbox,
            ReactiveAuthorizationPolicy authorization
    ) {
        this.cases = cases;
        this.outbox = outbox;
        this.authorization = authorization;
    }

    @WithTransaction
    public Uni<ApproveCaseResult> approve(ApproveCaseCommand command) {
        return cases.findById(command.caseId())
                .chain(optional -> optional
                        .map(Uni.createFrom()::item)
                        .orElseGet(() -> Uni.createFrom().failure(
                                new CaseNotFoundException(command.caseId())
                        )))
                .chain(record -> authorization.ensureCanApprove(command.actor(), record)
                        .replaceWith(record))
                .invoke(record -> record.approve(command.actor(), command.reason()))
                .call(record -> outbox.append(CaseApprovedEvent.from(record, command)))
                .map(record -> new ApproveCaseResult(record.id(), record.version()));
    }
}
```

Perhatikan:

- domain transition tetap imperative (`record.approve(...)`),
- IO operations reactive (`find`, `ensureCanApprove`, `outbox.append`),
- transaction membungkus DB operations,
- audit event memakai outbox, bukan publish langsung ke broker di tengah transaction.

---

## 23. Reactive Outbox Pattern

Reactive service tetap butuh outbox.

Jangan publish message eksternal langsung di dalam DB transaction:

```java
@WithTransaction
public Uni<ApproveResult> approve(Command command) {
    return findCase(command.id())
        .invoke(record -> record.approve())
        .call(record -> kafkaPublisher.publish(CaseApproved.from(record))) // risk
        .map(...);
}
```

Failure scenario:

```text
DB update success
Kafka publish success
commit DB fails
=> external world melihat event yang tidak committed

DB update success
commit success
Kafka publish fails
=> DB committed tapi event hilang
```

Outbox:

```text
transaction:
  update case
  insert outbox event

after commit:
  publisher reads outbox
  publishes event
  marks sent
```

Reactive outbox append:

```java
.call(record -> outbox.append(CaseApprovedEvent.from(record, command)))
```

Publisher bisa reactive juga, tetapi harus punya:

- retry,
- idempotency,
- unique event id,
- delivery status,
- poison event handling,
- observability.

---

## 24. Mixing Blocking and Reactive: Failure Modes

### 24.1 Blocking call on event loop

```java
public Uni<Response> endpoint() {
    return Uni.createFrom().item(() -> blockingRepository.findAll());
}
```

Jika supplier berjalan di event loop, event loop terblokir.

Solusi:

- gunakan reactive repository,
- atau tandai endpoint/service blocking,
- atau pindah ke worker dengan sadar,
- atau gunakan virtual thread jika sesuai.

### 24.2 Reactive call inside blocking transaction

```java
@Transactional
public void approve(UUID id) {
    reactiveRepository.findById(id)
        .subscribe().with(record -> record.approve());
}
```

Masalah:

- transaction imperative tidak menunggu reactive operation,
- transaction selesai terlalu cepat,
- side effect berjalan di luar boundary,
- failure hilang.

### 24.3 Manual subscribe

Manual subscribe di application service hampir selalu smell.

Framework Quarkus REST yang harus subscribe ke `Uni`.

Application code harus return chain.

### 24.4 `await().indefinitely()` di event loop

```java
CaseRecord record = repository.findById(id).await().indefinitely();
```

Ini mengubah reactive menjadi blocking. Jika di event loop, fatal.

Boleh hanya di:

- test tertentu,
- bootstrap controlled,
- command-line tool,
- worker thread dengan alasan jelas.

### 24.5 Entity keluar dari session

```java
Uni<CaseRecord> uni = findCase(id);
return uni.map(record -> {
   // access lazy field after session closed?
});
```

Pastikan mapping masih dalam session/transaction chain dan association sudah loaded.

---

## 25. Reactive SQL Client untuk Read Model

Untuk read model, Reactive SQL Client sering lebih cocok daripada Hibernate Reactive.

Contoh:

```java
public Uni<PagedResult<CaseListItem>> search(CaseSearchCriteria criteria) {
    String sql = """
        select c.id,
               c.reference_no,
               c.status,
               c.priority,
               c.created_at,
               o.display_name as officer_name
        from case_record c
        left join officer o on o.id = c.assigned_officer_id
        where ($1::varchar is null or c.status = $1)
          and ($2::varchar is null or c.priority = $2)
        order by c.created_at desc
        limit $3 offset $4
        """;

    return pool.preparedQuery(sql)
            .execute(Tuple.of(
                    criteria.status(),
                    criteria.priority(),
                    criteria.limit(),
                    criteria.offset()
            ))
            .map(rows -> mapCaseList(rows, criteria));
}
```

Keunggulan:

- SQL jelas,
- projection jelas,
- tidak load entity graph,
- tidak ada dirty checking,
- query tuning langsung,
- cocok untuk listing/search/dashboard.

Namun:

- jangan menyebar SQL sembarangan,
- query ownership tetap perlu,
- map row harus tested,
- schema evolution perlu discipline.

Pattern:

```text
Command/write model:
  Hibernate ORM or Hibernate Reactive

Read/list/report model:
  Reactive SQL Client projection
```

Ini bentuk CQRS ringan.

---

## 26. Transaction Isolation dan Locking Tetap Penting

Reactive tidak menyelesaikan masalah ini:

```text
Two officers approve same case concurrently.
```

Kamu tetap perlu:

- optimistic locking,
- pessimistic locking jika perlu,
- version check,
- state transition guard,
- unique constraints,
- idempotency key,
- transaction isolation awareness.

Example optimistic version:

```sql
update case_record
set status = 'APPROVED',
    version = version + 1
where id = $1
  and version = $2
  and status = 'PENDING_APPROVAL'
```

Jika row count 0:

```text
- case not found, atau
- version conflict, atau
- invalid state transition
```

Jangan treat semua sebagai generic 500.

Domain result:

```java
sealed interface ApproveCaseDbResult {
    record Updated(UUID id, long newVersion) implements ApproveCaseDbResult {}
    record Conflict(UUID id) implements ApproveCaseDbResult {}
    record InvalidState(UUID id, String currentStatus) implements ApproveCaseDbResult {}
    record NotFound(UUID id) implements ApproveCaseDbResult {}
}
```

Top-tier engineer tidak hanya bertanya:

> “Query berhasil?”

Tapi:

> “Apa semantic outcome dari query di bawah concurrency?”

---

## 27. Reactive Persistence dan Regulatory Case Management

Untuk domain seperti:

- enforcement lifecycle,
- case management,
- appeal,
- compliance,
- audit trail,
- correspondence,
- workflow escalation,

reactive persistence harus dipilih hati-hati.

Domain seperti ini biasanya punya:

- state machine kompleks,
- authorization kompleks,
- audit defensibility,
- cross-entity impact,
- long-running process,
- human approval,
- strict data consistency,
- reporting requirement.

Model yang sering paling sehat:

```text
Command/write side:
  imperative Hibernate ORM + @Transactional
  or carefully designed Hibernate Reactive if concurrency need is proven

Read/search/listing side:
  Reactive SQL Client projection can be useful

Integration/event side:
  outbox + reactive publisher
```

Jangan memaksa semua ke reactive jika hasilnya:

- domain transition tersebar di operator chain,
- exception handling tidak jelas,
- transaction semantics sulit diaudit,
- team sulit debug production,
- test jadi fragile.

Decision:

```text
Correctness > cleverness.
Auditability > async elegance.
Explicit state transition > fancy reactive flow.
```

---

## 28. Native Image Implications

Hibernate Reactive dan reactive clients bisa native-friendly karena Quarkus extensions menyiapkan metadata build-time.

Namun tetap hati-hati:

- dynamic reflection,
- custom row mapper via reflection,
- driver compatibility,
- TLS/cert resources,
- timezone/locale,
- serialization,
- proxies,
- generated classes,
- logging/tracing instrumentation.

Native image bukan hanya “compile”.

Checklist:

```text
[ ] Native integration test menjalankan real DB or Testcontainers.
[ ] Semua reflection custom terdaftar.
[ ] TLS/SSL path tested.
[ ] Query timeout tested.
[ ] Pool metrics available.
[ ] Error mapping sama dengan JVM mode.
[ ] Startup config sama dengan production.
[ ] Health check memakai real readiness semantics.
```

---

## 29. Testing Reactive Persistence

Testing reactive harus menghindari false confidence.

### 29.1 Jangan hanya test pipeline success

Test:

- not found,
- invalid state,
- optimistic lock conflict,
- DB timeout,
- duplicate key,
- transaction rollback,
- outbox append rollback,
- retry exhaustion,
- cancellation if relevant.

### 29.2 Reactive transaction test

Untuk Hibernate Reactive, gunakan mekanisme reactive transaction test yang sesuai. Jangan pakai asumsi `@Transactional` blocking.

### 29.3 Jangan overuse `await().indefinitely()`

Di test kadang boleh:

```java
ApproveResult result = service.approve(command).await().indefinitely();
```

Tetapi jangan sampai test menyembunyikan concurrency issue.

Lebih baik ada test concurrent:

```text
Given same case version
When two approve commands arrive concurrently
Then only one succeeds
And the other receives conflict/invalid-state
And audit event exactly one
```

### 29.4 Test row count semantics

Untuk Reactive SQL Client update command:

```java
return pool.preparedQuery(sql)
    .execute(tuple)
    .map(rowSet -> {
        if (rowSet.rowCount() == 1) {
            return Updated.INSTANCE;
        }
        return Conflict.INSTANCE;
    });
```

Test harus memvalidasi `rowCount`.

---

## 30. Observability untuk Reactive Persistence

Metrics wajib:

- DB pool active connections,
- DB pool pending acquisition,
- query duration,
- transaction duration,
- timeout count,
- retry count,
- optimistic conflict count,
- deadlock count,
- duplicate key count,
- outbox pending count,
- failed outbox publish,
- event loop blocked warnings,
- worker starvation if mixed model.

Logging:

- jangan log SQL bind value sensitif,
- log semantic command id,
- correlation id,
- case id/reference no jika aman,
- actor id,
- state transition,
- transaction outcome,
- duration.

Tracing:

```text
HTTP span
  -> service span
  -> DB query span
  -> outbox append span
```

Audit berbeda dari trace.

Trace menjawab:

> “Kenapa request lambat?”

Audit menjawab:

> “Siapa melakukan apa, kapan, dengan akibat hukum/domain apa?”

---

## 31. Design Patterns

### 31.1 Reactive Repository + Domain Entity

```text
Reactive repository handles IO.
Domain entity handles invariant.
Application service orchestrates transaction.
```

### 31.2 Read Model DAO

```text
DAO owns SQL projection.
DTO is explicit.
No entity graph.
```

### 31.3 Outbox Within Transaction

```text
DB change and event record committed together.
External publish happens later.
```

### 31.4 Idempotent Command

```text
Command has unique idempotency key.
Duplicate request returns previous known outcome.
```

### 31.5 Bulkhead Around DB Workflow

```text
Limit concurrent DB-heavy operation.
Reject early rather than queue infinitely.
```

---

## 32. Anti-Patterns

### Anti-pattern 1 — `Uni` wrapper around blocking JDBC

```java
Uni.createFrom().item(() -> entityManager.find(...))
```

### Anti-pattern 2 — `@Transactional` on method returning reactive DB operation

```java
@Transactional
public Uni<T> method() { ... }
```

### Anti-pattern 3 — manual subscribe inside service

```java
uni.subscribe().with(...)
```

### Anti-pattern 4 — mixing event-loop and blocking library

```java
return reactiveDb.find()
    .invoke(item -> blockingHttpClient.call());
```

### Anti-pattern 5 — using reactive for complex state machine just because it is fashionable

Reactive operator chain is not a state machine model.

### Anti-pattern 6 — no concurrency limit

Reactive service with unlimited DB operation can overload database.

### Anti-pattern 7 — hiding failures with recover

```java
.onFailure().recoverWithItem(defaultValue)
```

without semantic justification.

### Anti-pattern 8 — publishing external message inside DB transaction

Use outbox.

### Anti-pattern 9 — returning entity directly from reactive REST

DTO boundary still matters.

### Anti-pattern 10 — no native-mode test

Reactive/native combination must be tested as deployed artifact.

---

## 33. Practical Architecture Options

### Option A — Fully Imperative

```text
Quarkus REST endpoint @Blocking / worker
  -> @Transactional service
  -> Hibernate ORM JDBC
  -> DTO response
```

Best for:

- complex domain,
- moderate concurrency,
- team strong in JPA,
- operational simplicity.

### Option B — Fully Reactive

```text
Quarkus REST returns Uni
  -> @WithTransaction service
  -> Hibernate Reactive / Reactive SQL Client
  -> DTO response
```

Best for:

- high concurrency,
- IO-bound APIs,
- simple/medium domain,
- team strong in Mutiny,
- proven need.

### Option C — Hybrid by Boundary

```text
Command/write:
  imperative Hibernate ORM

Read/list/search:
  reactive SQL client

Integration publishing:
  reactive outbox publisher
```

Best for:

- enterprise systems,
- complex write model,
- high-volume read/listing,
- pragmatic migration.

### Option D — Virtual Thread Imperative

```text
Quarkus REST on virtual thread
  -> blocking Hibernate ORM
  -> imperative domain service
```

Best for:

- simpler code,
- blocking ecosystem,
- high concurrency with manageable DB constraints,
- Java 21+ environment,
- benchmark-proven.

Still needs:

- pool sizing,
- lock handling,
- timeout,
- observability.

---

## 34. Migration Strategy from Blocking ORM to Reactive Persistence

Jangan big bang.

### Step 1 — Identify workload

```text
Which endpoints are actually bottlenecked by thread blocking?
Which are DB CPU/lock/query bottlenecked?
Which are slow because SQL is bad?
```

### Step 2 — Separate read and write models

Read endpoints are easier to migrate first.

### Step 3 — Introduce reactive client for projection

Keep command side blocking.

### Step 4 — Benchmark

Measure:

- throughput,
- p95/p99 latency,
- memory,
- thread count,
- DB CPU,
- DB wait events,
- pool queue,
- error rate.

### Step 5 — Migrate only if benefit is real

If reactive version is harder and not faster/cheaper/more stable, do not migrate.

### Step 6 — Formalize coding rules

Rules:

```text
No blocking call in reactive service.
No manual subscribe.
No @Transactional for reactive DB.
No entity returned from REST.
All DB pipelines have timeout.
All write commands have idempotency strategy.
```

---

## 35. Mini Case Study — Case Approval Endpoint

### Requirement

A case officer approves an enforcement case.

Rules:

- case must exist,
- status must be `PENDING_APPROVAL`,
- actor must have permission,
- approval changes status to `APPROVED`,
- audit event must be recorded,
- integration event must eventually be published,
- concurrent approval must not create duplicate approval,
- result must be traceable.

### Bad reactive implementation

```java
@POST
@Path("/{id}/approve")
public Uni<Response> approve(@PathParam("id") UUID id) {
    return CaseRecord.<CaseRecord>findById(id)
        .invoke(record -> record.status = "APPROVED")
        .call(record -> kafka.publish(new CaseApproved(record.id)))
        .map(record -> Response.ok(record).build());
}
```

Problems:

- no transaction annotation,
- no null handling,
- no state guard,
- no authorization,
- direct entity response,
- direct Kafka publish,
- no optimistic lock,
- no audit outbox,
- no error contract.

### Better reactive implementation

```java
@POST
@Path("/{id}/approve")
public Uni<Response> approve(@PathParam("id") UUID id, ApproveCaseRequest request) {
    ApproveCaseCommand command = new ApproveCaseCommand(
            new CaseId(id),
            currentActor(),
            request.reason(),
            request.idempotencyKey()
    );

    return caseService.approve(command)
            .map(result -> Response.ok(ApproveCaseResponse.from(result)).build());
}
```

Service:

```java
@WithTransaction
public Uni<ApproveCaseResult> approve(ApproveCaseCommand command) {
    return idempotency.ensureNotProcessed(command)
            .chain(() -> cases.findById(command.caseId()))
            .chain(optional -> optional
                    .map(Uni.createFrom()::item)
                    .orElseGet(() -> Uni.createFrom().failure(
                            new CaseNotFoundException(command.caseId())
                    )))
            .chain(record -> authorization.ensureCanApprove(command.actor(), record)
                    .replaceWith(record))
            .invoke(record -> record.approve(command.actor(), command.reason()))
            .call(record -> outbox.append(CaseApprovedEvent.from(record, command)))
            .chain(record -> cases.save(record)
                    .replaceWith(record))
            .chain(record -> idempotency.markProcessed(command, record.version())
                    .replaceWith(record))
            .map(record -> new ApproveCaseResult(record.id(), record.version(), record.status()));
}
```

This is still illustrative. In a high-contention case approval, explicit SQL update with version guard may be preferable:

```sql
update case_record
set status = 'APPROVED',
    approved_by = $1,
    approved_at = now(),
    version = version + 1
where id = $2
  and status = 'PENDING_APPROVAL'
  and version = $3
```

Then derive semantic result from `rowCount`.

---

## 36. Production Checklist

### Model selection

- [ ] Is the endpoint truly IO-bound?
- [ ] Is reactive persistence justified by benchmark or scalability need?
- [ ] Is domain complexity manageable in reactive style?
- [ ] Is the team comfortable with Mutiny?
- [ ] Is virtual thread imperative model considered?

### Transaction

- [ ] Blocking ORM uses `@Transactional`.
- [ ] Hibernate Reactive uses `@WithTransaction` or `withTransaction`.
- [ ] Reactive SQL Client uses client transaction API.
- [ ] No manual subscribe in service.
- [ ] No external irreversible side effect inside DB transaction.

### Session/entity

- [ ] No entity access outside session.
- [ ] Lazy loading strategy explicit.
- [ ] DTO projection used for listing.
- [ ] Entity not returned directly from REST.

### Concurrency

- [ ] Optimistic lock or state guard exists.
- [ ] Idempotency key for non-idempotent command.
- [ ] DB pool sized intentionally.
- [ ] Max concurrent DB workflows controlled.
- [ ] Retry has backoff and budget.

### Failure

- [ ] Timeout exists.
- [ ] Constraint violation mapped.
- [ ] Not found mapped.
- [ ] Conflict mapped.
- [ ] Invalid state mapped.
- [ ] Transaction rollback tested.
- [ ] Outbox failure tested.

### Observability

- [ ] DB pool metrics.
- [ ] Query duration metrics.
- [ ] Transaction duration.
- [ ] Retry/timeout count.
- [ ] Event loop blocked warning monitored.
- [ ] Correlation ID propagated.
- [ ] Audit event separate from technical logs.

### Native/deployment

- [ ] Native integration test if native image is target.
- [ ] TLS/cert tested.
- [ ] Driver compatibility tested.
- [ ] Config build-time/runtime verified.
- [ ] Kubernetes readiness reflects DB dependency correctly.

---

## 37. Latihan Top 1% Engineer

### Latihan 1 — Decision memo

Ambil satu service yang kamu punya, lalu buat ADR:

```text
Should this service use:
A. Hibernate ORM blocking
B. Hibernate Reactive
C. Reactive SQL Client
D. Hybrid
E. Virtual-thread imperative
```

Wajib jawab:

- workload profile,
- concurrency target,
- DB bottleneck,
- transaction complexity,
- team maintainability,
- native image target,
- observability plan.

### Latihan 2 — Reactive failure matrix

Untuk endpoint approval:

```text
case not found
actor unauthorized
case already approved
optimistic conflict
DB timeout
duplicate idempotency key
outbox insert fails
transaction commit fails
```

Buat mapping:

```text
failure -> HTTP response -> audit behavior -> retry behavior -> metric
```

### Latihan 3 — Pool sizing simulation

Misal:

```text
p95 query duration = 80ms
target throughput = 500 req/s
pool size = ?
max queue = ?
timeout = ?
```

Gunakan Little's Law sebagai starting point:

```text
concurrency ~= throughput * latency
```

```text
500 req/s * 0.08s = 40 concurrent DB operations
```

Lalu tambahkan margin dan validasi DB capacity.

### Latihan 4 — Rewrite blocking service to reactive

Ambil service imperative:

```java
@Transactional
public ApproveResult approve(Command command)
```

Rewrite menjadi:

```java
@WithTransaction
public Uni<ApproveResult> approve(Command command)
```

Tapi pastikan:

- tidak ada blocking call,
- tidak ada manual subscribe,
- all side effects are part of chain,
- outbox is transactional,
- failure mapping jelas.

### Latihan 5 — Prove reactive benefit

Buat benchmark:

- blocking ORM worker thread,
- blocking ORM virtual thread,
- Hibernate Reactive,
- Reactive SQL Client projection.

Bandingkan:

- p50/p95/p99,
- throughput,
- CPU,
- memory,
- thread count,
- DB CPU,
- DB connections,
- timeout/error.

Jika reactive tidak menang secara signifikan, jangan pilih reactive hanya karena modern.

---

## 38. Ringkasan Invariants

Pegang invariants ini:

1. **Reactive persistence bukan membuat database lebih cepat; ia mengurangi blocking thread di aplikasi.**
2. **JDBC blocking yang dibungkus `Uni` tetap blocking.**
3. **Reactive transaction mengikuti asynchronous pipeline, bukan call stack imperative.**
4. **`@Transactional` untuk blocking ORM; `@WithTransaction` untuk Hibernate Reactive.**
5. **Manual subscribe di service adalah smell. Return `Uni` ke framework.**
6. **Reactive SQL Client cocok untuk explicit query/projection/read model.**
7. **Hibernate Reactive cocok jika butuh ORM abstraction di pipeline non-blocking.**
8. **Complex domain write model sering lebih maintainable dengan imperative transaction.**
9. **Outbox tetap wajib untuk reliable event publishing.**
10. **Concurrency harus dibatasi; reactive bukan infinite capacity.**
11. **Lazy loading harus eksplisit dan hati-hati.**
12. **Failure harus dipropagasikan dengan benar agar rollback terjadi.**
13. **Retry write operation hanya aman dengan idempotency.**
14. **Timeout harus mengikuti time budget dari API sampai DB.**
15. **Correctness, auditability, dan operability lebih penting daripada reactive purity.**

---

## 39. Kapan Menggunakan Apa?

Gunakan rule of thumb ini:

```text
Use Hibernate ORM blocking when:
  - domain write model kompleks
  - transaction semantics penting
  - team butuh debugging sederhana
  - concurrency moderate
  - correctness lebih penting dari non-blocking purity

Use Hibernate Reactive when:
  - endpoint reactive end-to-end
  - workload IO-bound high concurrency
  - domain logic manageable
  - team kuat di Mutiny
  - benchmark membuktikan benefit

Use Reactive SQL Client when:
  - query harus eksplisit
  - read/list/projection-heavy
  - performance-sensitive
  - tidak butuh ORM state management
  - SQL shape harus fully controlled

Use hybrid when:
  - enterprise domain kompleks
  - write side butuh transaction clarity
  - read side butuh high concurrency/projection
  - migration bertahap lebih aman
```

---

## 40. Penutup

Part ini harus membuat kamu lebih skeptis sekaligus lebih powerful.

Skeptis karena:

> Tidak semua yang reactive otomatis lebih baik.

Powerful karena:

> Kamu sekarang bisa memilih persistence model berdasarkan execution semantics, transaction semantics, failure mode, dan operational reality.

Quarkus memberi banyak pilihan:

- Hibernate ORM blocking,
- Hibernate Reactive,
- Hibernate Reactive Panache,
- Reactive SQL Client,
- virtual threads,
- native image,
- reactive REST.

Top-tier engineer tidak memilih karena fitur terlihat modern.

Top-tier engineer memilih karena bisa menjelaskan:

```text
Untuk workload ini,
dengan transaction boundary ini,
dengan failure mode ini,
dengan team skill ini,
dengan deployment target ini,
model persistence terbaik adalah X,
karena trade-off Y dapat diterima,
sedangkan risiko Z dimitigasi dengan mekanisme W.
```

Itulah level yang kita kejar.

---

# Referensi Resmi

- Quarkus — Using Hibernate Reactive
- Quarkus — Simplified Hibernate Reactive with Panache
- Quarkus — Reactive SQL Clients
- Quarkus — Quarkus Reactive Architecture
- Quarkus — Mutiny primer
- Quarkus — Vert.x Reference Guide
- Quarkus — Data sources configuration

---

# Status Seri

Part 012 selesai.

Seri belum selesai dan belum mencapai bagian terakhir.

Part berikutnya:

> **Part 013 — Transaction Engineering: Narayana, JTA, Reactive Transactions, Outbox, dan Consistency Boundary**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-011.md">⬅️ Part 011 — Persistence II: Panache Active Record vs Repository vs Domain-Centric Persistence</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-013.md">Part 013 — Transaction Engineering: Narayana, JTA, Reactive Transactions, Outbox, dan Consistency Boundary ➡️</a>
</div>
