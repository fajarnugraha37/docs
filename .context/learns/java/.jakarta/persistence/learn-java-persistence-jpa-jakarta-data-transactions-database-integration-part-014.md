# Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 hingga Java 25  
> Fokus: Jakarta/Javax Persistence, JPA, Hibernate, transaction correctness, database integration, dan production-grade concurrency design

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami **pessimistic locking** bukan sebagai “cara agar aman”, tetapi sebagai mekanisme eksplisit untuk mengatur kompetisi akses terhadap row/resource database.
2. Membedakan optimistic locking, pessimistic locking, isolation level, unique constraint, conditional update, dan application-level mutex.
3. Menggunakan `LockModeType.PESSIMISTIC_READ`, `PESSIMISTIC_WRITE`, dan `PESSIMISTIC_FORCE_INCREMENT` secara tepat.
4. Memahami kapan JPA/Hibernate menghasilkan SQL seperti `SELECT ... FOR UPDATE`, `NOWAIT`, `SKIP LOCKED`, atau lock timeout hint, tergantung dialect dan provider.
5. Mendesain high-contention workflow seperti queue claim, quota reservation, counter update, assignment, approval, dan payment-like reservation dengan benar.
6. Menganalisis deadlock: mengapa terjadi, bagaimana database mendeteksinya, dan bagaimana mengurangi kemungkinannya lewat deterministic lock ordering.
7. Menentukan kapan perlu retry, kapan tidak boleh retry, dan bagaimana retry harus dibatasi dengan idempotency.
8. Menghindari jebakan umum: lock terlalu lama, external call di dalam lock, pagination dengan lock, locking parent-child tanpa urutan, dan menyangka pessimistic lock adalah distributed lock.

---

## 2. Mental Model: Pessimistic Locking adalah “Antrian Paksa” di Database

Optimistic locking berkata:

> “Silakan semua jalan dulu. Saat commit/update, kita cek apakah ada konflik.”

Pessimistic locking berkata:

> “Sebelum melanjutkan, saya harus memegang lock resource ini. Yang lain harus menunggu, gagal cepat, atau lompat ke resource lain.”

Pessimistic locking berguna ketika biaya konflik lebih mahal daripada biaya menunggu.

Contoh:

- Dua officer tidak boleh mengambil case yang sama.
- Dua worker tidak boleh memproses job yang sama.
- Kuota hanya tersisa sedikit dan request sangat kompetitif.
- Resource harus “reserved” sebelum operasi lanjutan.
- State transition harus serialized karena invariant sulit dijaga hanya dengan optimistic retry.

Tetapi pessimistic locking juga berbahaya karena:

- mengurangi concurrency,
- memperpanjang lock wait,
- meningkatkan deadlock risk,
- mengikat connection selama menunggu,
- memperbesar tail latency,
- dapat menjalar menjadi outage ketika traffic naik.

Pessimistic lock bukan alat default. Ia adalah alat bedah.

---

## 3. Apa yang Sebenarnya Dikunci?

Di JPA/Hibernate, kamu memanggil lock pada entity.

```java
Application app = entityManager.find(
    Application.class,
    applicationId,
    LockModeType.PESSIMISTIC_WRITE
);
```

Namun yang benar-benar melakukan locking adalah database, biasanya terhadap row/index/key/range tertentu sesuai SQL, isolation level, query plan, dan database engine.

Artinya:

- JPA tidak mengunci object di heap JVM.
- Hibernate tidak membuat global Java mutex.
- Lock tidak otomatis berlaku lintas database.
- Lock tidak otomatis berlaku lintas service kalau service lain tidak memakai database transaction yang sama.
- Lock hidup selama database transaction belum selesai.
- Lock biasanya dilepas saat commit/rollback.

Mental model penting:

```text
Java EntityManager lock request
        ↓
Hibernate translates lock mode + dialect
        ↓
JDBC executes SQL
        ↓
Database acquires row/table/range/key lock
        ↓
Other transactions wait/fail/skip depending SQL + timeout + DB behavior
```

---

## 4. Pessimistic Locking vs Optimistic Locking

| Aspek | Optimistic Locking | Pessimistic Locking |
|---|---|---|
| Strategi | Deteksi konflik belakangan | Cegah konflik dari awal |
| Mekanisme umum | `@Version` | `SELECT FOR UPDATE` / DB lock |
| Cocok untuk | Konflik jarang | Konflik sering / resource sempit |
| Dampak latency | Konflik menyebabkan rollback/retry | Request bisa menunggu lock |
| Risiko utama | Banyak retry jika contention tinggi | Deadlock, lock wait, throughput turun |
| User experience | Conflict saat save | Loading/wait/fail fast |
| Kebutuhan transaction | Ya | Sangat penting, lock hidup dalam transaction |

Rule praktis:

- Pakai **optimistic locking** untuk mayoritas edit form, update record, workflow yang konflik jarang.
- Pakai **pessimistic locking** untuk claim/reserve/consume resource yang kompetitif dan harus serialized.
- Pakai **conditional update + affected row count** untuk operasi atomic sederhana yang tidak perlu hydrate entity.
- Pakai **unique constraint** untuk mencegah duplicate creation.
- Pakai **outbox/idempotency** untuk side effect setelah commit.

---

## 5. JPA Lock Modes untuk Pessimistic Locking

Jakarta Persistence/JPA menyediakan lock mode berikut.

### 5.1 `PESSIMISTIC_READ`

Niat konseptual:

> Ambil shared lock. Transaction lain boleh membaca, tetapi tidak boleh update/delete resource yang sama.

Namun behavior sangat database-specific.

Beberapa database tidak punya shared row lock yang sama persis seperti abstraksi JPA. Provider dapat menerjemahkannya menjadi bentuk SQL yang lebih kuat, bahkan mendekati `FOR UPDATE`.

Gunakan ketika:

- kamu ingin membaca data stabil untuk beberapa operasi lanjutan,
- data tidak boleh berubah sampai transaksi selesai,
- tetapi kamu tidak berniat mengubah data tersebut.

Hati-hati:

- `PESSIMISTIC_READ` tetap bisa menimbulkan lock wait.
- Jangan dipakai untuk read-only listing biasa.
- Jangan dipakai sebagai “biar aman” pada query dashboard/report.

### 5.2 `PESSIMISTIC_WRITE`

Niat konseptual:

> Ambil exclusive lock. Transaction lain tidak boleh mengubah resource yang sama, dan pada beberapa database/mode juga dapat terblokir untuk lock/read tertentu.

Ini mode paling umum untuk operasi seperti:

- claim job,
- reserve quota,
- transition state,
- update counter,
- allocate sequence business,
- assign case.

Contoh:

```java
CaseRecord caseRecord = entityManager.find(
    CaseRecord.class,
    caseId,
    LockModeType.PESSIMISTIC_WRITE
);

caseRecord.assignTo(officerId);
```

### 5.3 `PESSIMISTIC_FORCE_INCREMENT`

Niat konseptual:

> Ambil pessimistic write lock dan increment version field pada versioned entity.

Ini berguna jika kamu ingin:

- memaksa entity dianggap berubah walaupun field bisnis belum berubah,
- memberi sinyal konflik ke optimistic readers/writers lain,
- menggabungkan pessimistic lock dan version-based consistency.

Contoh:

```java
Application app = entityManager.find(
    Application.class,
    appId,
    LockModeType.PESSIMISTIC_FORCE_INCREMENT
);
```

Gunakan secara selektif. Jangan increment version tanpa alasan karena dapat membuat conflict rate meningkat.

---

## 6. Cara Meminta Pessimistic Lock

### 6.1 Saat `find`

```java
Application app = entityManager.find(
    Application.class,
    applicationId,
    LockModeType.PESSIMISTIC_WRITE
);
```

Cocok untuk lock by primary key.

### 6.2 Setelah entity managed

```java
Application app = entityManager.find(Application.class, applicationId);
entityManager.lock(app, LockModeType.PESSIMISTIC_WRITE);
```

Hati-hati: antara `find` dan `lock`, data bisa saja berubah oleh transaksi lain, tergantung isolation dan timing.

### 6.3 Pada JPQL query

```java
Application app = entityManager.createQuery("""
        select a
        from Application a
        where a.id = :id
        """, Application.class)
    .setParameter("id", applicationId)
    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
    .getSingleResult();
```

### 6.4 Dengan Spring Data JPA

```java
public interface ApplicationRepository extends JpaRepository<Application, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Application a where a.id = :id")
    Optional<Application> findByIdForUpdate(@Param("id") Long id);
}
```

### 6.5 Dengan timeout hint

JPA menyediakan lock timeout hint.

Untuk era `javax.persistence`:

```java
query.setHint("javax.persistence.lock.timeout", 1000);
```

Untuk era `jakarta.persistence`:

```java
query.setHint("jakarta.persistence.lock.timeout", 1000);
```

Makna timeout tergantung provider dan database. Nilai `0` sering dipakai sebagai konsep fail-fast/nowait jika didukung provider+dialect.

---

## 7. SQL yang Biasanya Dihasilkan

Secara konseptual, `PESSIMISTIC_WRITE` sering diterjemahkan menjadi:

```sql
select *
from application
where id = ?
for update
```

Variasi database:

```sql
-- Oracle / PostgreSQL style
select * from application where id = ? for update

-- Fail fast
select * from application where id = ? for update nowait

-- Queue processing pattern
select * from job
where status = 'READY'
order by priority desc, created_at asc
fetch first 10 rows only
for update skip locked
```

Namun jangan hardcode asumsi bahwa semua database sama.

Perbedaan dapat terjadi pada:

- syntax SQL,
- lock strength,
- shared vs exclusive lock,
- row lock vs key/range lock,
- interaction dengan index,
- interaction dengan isolation level,
- apakah `SKIP LOCKED` tersedia,
- apakah lock timeout disupport,
- apakah lock ikut association/ joined table.

---

## 8. Lock Scope: Entity, Row, Association, dan Query Plan

Pessimistic locking sering dianggap “mengunci entity”. Secara fisik, database mengunci row/key/range yang disentuh oleh query.

Contoh sederhana:

```java
entityManager.find(CaseRecord.class, caseId, LockModeType.PESSIMISTIC_WRITE);
```

Biasanya mengunci row `case_record` dengan `id = ?`.

Namun query lebih kompleks dapat mengunci lebih dari yang kamu kira:

```java
select c
from CaseRecord c
join fetch c.tasks
where c.id = :id
```

Jika diberi lock mode, provider/database dapat memutuskan lock pada row yang terlibat di join. Semantics lock scope bisa berbeda.

Prinsip desain:

1. Lock query harus sesederhana mungkin.
2. Lock by primary key lebih predictable.
3. Jangan gabungkan lock acquisition dengan fetch graph besar.
4. Ambil lock resource utama dulu, lalu query data lain seperlunya.
5. Gunakan deterministic order kalau perlu lock banyak row.

---

## 9. Transaction Boundary: Lock Hidup Selama Transaction

Pessimistic lock tanpa transaction yang benar hampir selalu salah.

Contoh buruk:

```java
public void assign(Long caseId, Long officerId) {
    CaseRecord c = repository.findByIdForUpdate(caseId).orElseThrow();
    c.assignTo(officerId);
}
```

Jika method ini tidak transactional, behavior bergantung pada framework dan auto-commit. Lock dapat langsung dilepas setelah statement selesai.

Contoh benar:

```java
@Transactional
public void assign(Long caseId, Long officerId) {
    CaseRecord c = repository.findByIdForUpdate(caseId).orElseThrow();
    c.assignTo(officerId);
}
```

Namun transaction jangan terlalu panjang:

```java
@Transactional
public void assignAndNotify(Long caseId, Long officerId) {
    CaseRecord c = repository.findByIdForUpdate(caseId).orElseThrow();
    c.assignTo(officerId);

    // Buruk: external call di dalam transaction + lock masih dipegang.
    emailGateway.sendAssignmentEmail(c.getApplicantEmail());
}
```

Lebih baik:

```java
@Transactional
public void assign(Long caseId, Long officerId) {
    CaseRecord c = repository.findByIdForUpdate(caseId).orElseThrow();
    c.assignTo(officerId);
    outboxRepository.save(OutboxEvent.assignmentCreated(c.getId(), officerId));
}

// Publisher terpisah setelah commit.
```

---

## 10. Kapan Pessimistic Locking Tepat?

### 10.1 Claim work item

```text
Banyak worker mencari job READY.
Satu job hanya boleh diproses oleh satu worker.
```

Pola:

```sql
select id
from job
where status = 'READY'
order by priority desc, created_at asc
for update skip locked
fetch first 10 rows only
```

Lalu update status:

```sql
update job
set status = 'PROCESSING', claimed_by = ?, claimed_at = current_timestamp
where id in (...)
```

Di JPA, support `SKIP LOCKED` bisa provider-specific. Kadang native SQL lebih tepat.

### 10.2 Reserve quota

```text
Quota tersisa 1.
Banyak request ingin mengambil quota.
```

Opsi A: pessimistic lock row quota.

```java
@Transactional
public void reserveQuota(Long quotaId, Long requestId) {
    Quota quota = entityManager.find(
        Quota.class,
        quotaId,
        LockModeType.PESSIMISTIC_WRITE
    );

    quota.reserveOne(requestId);
}
```

Opsi B: conditional update lebih ringan.

```sql
update quota
set remaining = remaining - 1
where id = ?
  and remaining > 0
```

Jika affected rows = 1, berhasil. Jika 0, quota habis.

Untuk counter/quota sederhana, conditional update sering lebih scalable daripada hydrate entity + lock.

### 10.3 Prevent duplicate processing

```text
Webhook/event bisa datang paralel dengan idempotency key sama.
```

Solusi utama biasanya unique constraint:

```sql
create unique index uq_inbox_message_key on inbox_message(message_key);
```

Pessimistic lock bisa dipakai setelah idempotency row dibuat, tetapi bukan pengganti uniqueness.

### 10.4 State transition yang high-contention

```text
Banyak officer/action mencoba transition case yang sama.
```

Optimistic locking biasanya cukup. Tetapi jika conflict sangat tinggi dan retry mahal, pessimistic lock dapat dipilih.

```java
@Transactional
public void approve(Long caseId, DecisionCommand command) {
    CaseRecord c = entityManager.find(
        CaseRecord.class,
        caseId,
        LockModeType.PESSIMISTIC_WRITE
    );

    c.approve(command.actorId(), command.reason());
    auditTrailRepository.save(AuditTrail.approved(c));
}
```

---

## 11. Kapan Pessimistic Locking Tidak Tepat?

Jangan pakai pessimistic lock untuk:

1. Read-only listing.
2. Dashboard/report/export.
3. Search page.
4. API GET biasa.
5. Long user interaction.
6. Mengunci data sambil menunggu approval manusia.
7. Mengunci data sambil upload file besar.
8. Mengunci data sambil memanggil external API lambat.
9. Menyelesaikan desain invariant yang seharusnya ada di unique/check constraint.
10. Menggantikan distributed coordination lintas database/service.

Contoh sangat buruk:

```java
@Transactional
public void startHumanReview(Long caseId) {
    CaseRecord c = repository.findByIdForUpdate(caseId).orElseThrow();

    // Jangan pernah lock DB transaction menunggu manusia.
    waitUntilOfficerClicksApprove();

    c.approve();
}
```

Database transaction harus pendek.

---

## 12. Deadlock: Apa dan Mengapa Terjadi?

Deadlock terjadi ketika dua atau lebih transaksi saling menunggu resource yang dipegang satu sama lain.

Contoh klasik:

```text
T1 lock Case A
T2 lock Case B
T1 mencoba lock Case B → menunggu T2
T2 mencoba lock Case A → menunggu T1
Deadlock
```

Diagram:

```text
T1 ──holds──> A
T1 ──waits──> B

T2 ──holds──> B
T2 ──waits──> A
```

Database biasanya memiliki deadlock detector. Salah satu transaksi akan dibatalkan agar yang lain bisa lanjut.

Di aplikasi Java, ini muncul sebagai exception seperti:

- `PessimisticLockException`,
- `LockTimeoutException`,
- Hibernate `LockAcquisitionException`,
- Spring `CannotAcquireLockException`,
- Spring `DeadlockLoserDataAccessException`,
- vendor-specific SQL exception.

Nama exception berbeda tergantung stack.

---

## 13. Deterministic Lock Ordering

Cara paling penting mengurangi deadlock adalah memastikan semua transaksi mengambil lock dalam urutan yang sama.

Buruk:

```java
@Transactional
public void linkCases(Long sourceId, Long targetId) {
    CaseRecord source = lockCase(sourceId);
    CaseRecord target = lockCase(targetId);
    source.linkTo(target);
}
```

Jika request paralel datang:

```text
Request 1: linkCases(1, 2)
Request 2: linkCases(2, 1)
```

Deadlock risk tinggi.

Lebih baik:

```java
@Transactional
public void linkCases(Long a, Long b) {
    Long first = Math.min(a, b);
    Long second = Math.max(a, b);

    CaseRecord c1 = lockCase(first);
    CaseRecord c2 = lockCase(second);

    // Setelah lock didapat secara deterministic, baru jalankan logic bisnis.
    linkAccordingToBusinessDirection(c1, c2, a, b);
}
```

Untuk banyak row:

```java
List<Long> sortedIds = ids.stream()
    .distinct()
    .sorted()
    .toList();

List<CaseRecord> lockedCases = repository.findAllByIdForUpdateOrdered(sortedIds);
```

Query juga harus menjaga urutan lock jika memungkinkan.

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("""
    select c
    from CaseRecord c
    where c.id in :ids
    order by c.id asc
    """)
List<CaseRecord> lockCasesInOrder(@Param("ids") List<Long> ids);
```

Catatan: database optimizer tidak selalu menjamin lock acquisition order sesuai `ORDER BY` dalam semua kondisi. Untuk invariant sangat kritis, lock satu per satu by primary key dengan urutan deterministic kadang lebih predictable.

---

## 14. Lock Timeout dan Fail Fast

Tanpa timeout, request bisa menunggu terlalu lama.

Contoh:

```java
Map<String, Object> hints = Map.of(
    "jakarta.persistence.lock.timeout", 1000
);

Application app = entityManager.find(
    Application.class,
    id,
    LockModeType.PESSIMISTIC_WRITE,
    hints
);
```

Strategi timeout:

| Use Case | Strategi |
|---|---|
| User action interaktif | timeout pendek, tampilkan “data sedang diproses” |
| Background worker | `SKIP LOCKED` atau retry dengan backoff |
| Critical batch | timeout sedang, chunk retry |
| Administrative operation | timeout jelas + observability |
| High priority command | fail fast atau bounded wait |

Jangan membuat semua lock wait unlimited.

---

## 15. `NOWAIT` dan `SKIP LOCKED`

### 15.1 `NOWAIT`

`NOWAIT` berarti:

> Kalau row sedang dikunci transaksi lain, jangan tunggu. Langsung gagal.

Cocok untuk user action:

```text
“Case ini sedang diproses oleh officer lain. Coba lagi nanti.”
```

### 15.2 `SKIP LOCKED`

`SKIP LOCKED` berarti:

> Kalau row sedang dikunci, abaikan row itu dan ambil row lain.

Cocok untuk job queue:

```text
Banyak worker mengambil READY jobs tanpa saling menunggu job yang sama.
```

Pola:

```sql
select id
from job
where status = 'READY'
order by priority desc, created_at asc
for update skip locked
fetch first 10 rows only
```

Risiko `SKIP LOCKED`:

- starvation jika row tertentu terus terkunci,
- fairness tidak selalu sempurna,
- query plan dan index sangat penting,
- order semantics bisa bergeser karena locked rows dilewati,
- harus ada recovery untuk stuck `PROCESSING` jobs.

---

## 16. Queue Consumer dengan Database Locking

Database-backed queue sering muncul pada sistem enterprise karena simpel dan transactional.

### 16.1 Tabel job

```sql
create table background_job (
    id bigint primary key,
    status varchar(30) not null,
    priority int not null,
    payload clob not null,
    claimed_by varchar(100),
    claimed_at timestamp,
    attempts int not null,
    next_attempt_at timestamp,
    created_at timestamp not null,
    updated_at timestamp not null
);

create index idx_job_ready
on background_job(status, next_attempt_at, priority, created_at);
```

### 16.2 Claim native SQL

```java
@Transactional
public List<Long> claimJobs(String workerId, int limit) {
    List<Long> ids = entityManager.createNativeQuery("""
        select id
        from background_job
        where status = 'READY'
          and next_attempt_at <= current_timestamp
        order by priority desc, created_at asc
        fetch first :limit rows only
        for update skip locked
        """)
        .setParameter("limit", limit)
        .getResultList();

    if (ids.isEmpty()) {
        return List.of();
    }

    entityManager.createNativeQuery("""
        update background_job
        set status = 'PROCESSING',
            claimed_by = :workerId,
            claimed_at = current_timestamp,
            updated_at = current_timestamp
        where id in (:ids)
        """)
        .setParameter("workerId", workerId)
        .setParameter("ids", ids)
        .executeUpdate();

    return ids;
}
```

Catatan: parameter list pada native query berbeda support-nya antar provider. Di production, kamu mungkin perlu batching atau query builder provider-specific.

### 16.3 Recovery stuck job

```sql
update background_job
set status = 'READY',
    claimed_by = null,
    claimed_at = null,
    next_attempt_at = current_timestamp,
    updated_at = current_timestamp
where status = 'PROCESSING'
  and claimed_at < current_timestamp - interval '15 minutes';
```

Untuk Oracle syntax interval berbeda.

### 16.4 Prinsip queue DB

- Claim cepat.
- Transaction claim pendek.
- Proses job di transaction terpisah.
- Side effect harus idempotent.
- Ada retry dengan attempt count.
- Ada dead-letter status.
- Ada recovery untuk stuck job.
- Ada index khusus READY jobs.

---

## 17. Hot Row Problem

Hot row adalah row yang terlalu sering dikunci/diupdate oleh banyak transaksi.

Contoh:

```text
quota(id=1, remaining=10)
```

Semua request mengunci row yang sama.

Dampak:

- throughput turun,
- lock wait naik,
- tail latency naik,
- connection pool penuh,
- timeout cascade,
- retry storm.

Solusi desain:

### 17.1 Conditional update

```sql
update quota
set remaining = remaining - 1
where id = ?
  and remaining > 0
```

Ini masih hot row, tetapi lebih pendek daripada lock + entity lifecycle.

### 17.2 Sharded counter

```text
quota_bucket(id, quota_id, bucket_no, remaining)
```

Request memilih bucket, sehingga contention tersebar.

Kompensasinya:

- logic lebih kompleks,
- reporting total butuh aggregation,
- fairness tidak sempurna,
- perlu rebalance.

### 17.3 Reservation rows

Daripada update counter pusat, buat reservation record dengan unique constraint.

```sql
create table quota_reservation (
    id bigint primary key,
    quota_id bigint not null,
    requester_id bigint not null,
    status varchar(30) not null,
    created_at timestamp not null
);
```

Lalu gunakan query count atau materialized state tergantung workload.

### 17.4 Queue serialization

Semua request masuk queue, satu worker mengalokasikan.

Cocok jika fairness dan determinism lebih penting daripada latency rendah.

---

## 18. Counter Update: Pessimistic Lock atau Atomic SQL?

Misal:

```text
Decrease remaining seat if available.
```

Pendekatan entity lock:

```java
@Transactional
public boolean reserve(Long seatPoolId) {
    SeatPool pool = entityManager.find(
        SeatPool.class,
        seatPoolId,
        LockModeType.PESSIMISTIC_WRITE
    );

    if (pool.getRemaining() <= 0) {
        return false;
    }

    pool.decrease();
    return true;
}
```

Pendekatan atomic SQL:

```java
@Transactional
public boolean reserve(Long seatPoolId) {
    int updated = entityManager.createQuery("""
        update SeatPool p
        set p.remaining = p.remaining - 1
        where p.id = :id
          and p.remaining > 0
        """)
        .setParameter("id", seatPoolId)
        .executeUpdate();

    return updated == 1;
}
```

Atomic SQL sering lebih baik untuk operasi sederhana karena:

- satu statement,
- lock duration pendek,
- tidak hydrate entity,
- tidak perlu dirty checking,
- invariant ada di predicate.

Namun entity lock lebih ekspresif jika:

- banyak field/invariant harus diperiksa,
- audit detail perlu dibangun dari state,
- state transition kompleks,
- domain method penting.

---

## 19. Parent-Child Locking

Masalah umum:

```text
Parent: Application
Child: ApplicationDocument
Child: ApplicationTask
```

Dua transaksi:

```text
T1 lock parent lalu child A
T2 lock child A lalu parent
```

Deadlock risk.

Prinsip:

1. Tentukan aggregate lock root.
2. Semua operasi mutasi aggregate lock root dulu.
3. Lock child setelah root jika perlu.
4. Urutkan child by primary key.
5. Jangan ada use case lain yang lock child dulu lalu parent.

Contoh:

```java
@Transactional
public void updateDocuments(Long applicationId, List<DocumentCommand> commands) {
    Application app = entityManager.find(
        Application.class,
        applicationId,
        LockModeType.PESSIMISTIC_WRITE
    );

    List<Long> docIds = commands.stream()
        .map(DocumentCommand::documentId)
        .filter(Objects::nonNull)
        .distinct()
        .sorted()
        .toList();

    List<ApplicationDocument> docs = documentRepository.lockByIdsOrdered(docIds);

    app.updateDocuments(docs, commands);
}
```

---

## 20. Pessimistic Locking dan Isolation Level

Pessimistic lock tidak menggantikan isolation level. Ia bekerja di atas behavior database transaction.

Contoh:

- Pada `READ_COMMITTED`, read biasa biasanya melihat committed data terbaru dan tidak terblokir oleh read lain.
- `SELECT FOR UPDATE` mengambil lock untuk update intent.
- Pada MVCC database, reader biasa bisa tetap membaca versi lama meskipun row sedang dikunci untuk update.
- Pada beberapa database/isolation, range/gap lock bisa muncul untuk predicate tertentu.

Kesimpulan:

- Selalu pahami database target.
- Test dengan database asli, bukan H2 saja.
- Jangan membuat asumsi berdasarkan satu dialect lalu menganggap portable.

---

## 21. Database-Specific Behavior yang Perlu Diwaspadai

### 21.1 Oracle

Karakteristik umum:

- MVCC/read consistency kuat.
- `SELECT ... FOR UPDATE` lazim digunakan.
- Mendukung `NOWAIT` dan `SKIP LOCKED`.
- Reader biasa tidak memblok writer seperti lock-based read tradisional.
- Writer dapat saling menunggu pada row yang sama.

Contoh:

```sql
select *
from case_record
where id = :id
for update nowait
```

### 21.2 PostgreSQL

Karakteristik umum:

- MVCC.
- Mendukung `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`.
- Mendukung `NOWAIT` dan `SKIP LOCKED`.
- `SKIP LOCKED` umum untuk queue worker.

### 21.3 MySQL/InnoDB

Karakteristik umum:

- MVCC dengan locking behavior yang sangat dipengaruhi isolation level.
- `REPEATABLE READ` default pada banyak instalasi.
- Gap lock/next-key lock dapat muncul pada range query.
- Index sangat penting; query tanpa index dapat mengunci lebih luas.

### 21.4 SQL Server

Karakteristik umum:

- Lock hints seperti `UPDLOCK`, `ROWLOCK`, `READPAST`.
- Snapshot isolation optional/configurable.
- Lock escalation dapat terjadi.

---

## 22. Index Design untuk Locking Query

Locking query buruk tanpa index.

Contoh buruk:

```sql
select *
from job
where status = 'READY'
order by priority desc, created_at asc
for update skip locked
```

Jika tidak ada index yang sesuai, database dapat scan banyak row dan mengunci/menunggu lebih banyak dari yang diharapkan.

Index lebih baik:

```sql
create index idx_job_claim
on job(status, priority desc, created_at asc, id);
```

Untuk query:

```sql
where status = 'READY'
order by priority desc, created_at asc
```

Prinsip:

- Predicate locking query harus indexed.
- Order by untuk queue harus didukung index.
- Lock by primary key paling aman.
- Hindari function pada indexed column dalam predicate.
- Pastikan query plan stabil.
- Pantau rows scanned vs rows returned.

---

## 23. Pessimistic Locking dalam Spring Transaction

Spring Data JPA:

```java
public interface CaseRepository extends JpaRepository<CaseRecord, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CaseRecord c where c.id = :id")
    Optional<CaseRecord> findByIdForUpdate(@Param("id") Long id);
}
```

Service:

```java
@Service
public class CaseAssignmentService {

    private final CaseRepository caseRepository;

    public CaseAssignmentService(CaseRepository caseRepository) {
        this.caseRepository = caseRepository;
    }

    @Transactional
    public void assign(Long caseId, Long officerId) {
        CaseRecord c = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(() -> new CaseNotFoundException(caseId));

        c.assignTo(officerId);
    }
}
```

Hindari:

```java
public void outer() {
    innerTransactionalMethod(); // self-invocation problem jika proxy-based
}

@Transactional
public void innerTransactionalMethod() {
    // transaction mungkin tidak aktif jika dipanggil dari class yang sama
}
```

Pastikan method transactional dipanggil lewat proxy atau gunakan programmatic transaction bila perlu.

---

## 24. Exception Handling dan Retry

Pessimistic locking dapat gagal karena:

- row sudah dikunci dan timeout,
- deadlock,
- transaction rollback-only,
- connection/network failure,
- database overload.

Klasifikasi:

| Failure | Retriable? | Catatan |
|---|---:|---|
| Lock timeout pada user action | Kadang tidak | Lebih baik return conflict/busy |
| Deadlock victim | Ya, bounded retry | Ulang seluruh transaction |
| Connection lost before commit result known | Sulit | Butuh idempotency/reconciliation |
| Constraint violation | Tidak | Biasanya business/data error |
| Optimistic conflict | Tergantung | Bisa retry untuk machine command, jangan auto-merge user intent |
| Duplicate idempotency key | Tidak sebagai error | Return previous result/status |

Retry harus mengulang seluruh transaction, bukan hanya statement terakhir.

Contoh dengan Spring Retry style konseptual:

```java
@Retryable(
    retryFor = { CannotAcquireLockException.class, DeadlockLoserDataAccessException.class },
    maxAttempts = 3,
    backoff = @Backoff(delay = 100, multiplier = 2.0, random = true)
)
@Transactional
public void transferWork(Long fromQueueId, Long toQueueId, Long caseId) {
    // lock resources in deterministic order
}
```

Namun jangan gunakan retry tanpa idempotency. Jika transaction mengandung external side effect, retry dapat menggandakan efek.

---

## 25. Idempotency untuk Operasi dengan Lock

Contoh command:

```json
{
  "requestId": "REQ-2026-0001",
  "caseId": 1001,
  "action": "ASSIGN",
  "officerId": 501
}
```

Simpan request id:

```sql
create table command_log (
    request_id varchar(100) primary key,
    command_type varchar(100) not null,
    target_id bigint not null,
    status varchar(30) not null,
    result_json clob,
    created_at timestamp not null,
    updated_at timestamp not null
);
```

Flow:

```text
1. Insert command_log(request_id) dengan unique constraint.
2. Jika duplicate, return result/status lama.
3. Dalam transaction, lock target row.
4. Jalankan mutation.
5. Simpan audit/outbox.
6. Mark command success.
7. Commit.
```

Dengan idempotency, retry transaction jauh lebih aman.

---

## 26. Case Study: Case Assignment dengan Pessimistic Lock

### 26.1 Requirement

```text
- Case hanya boleh assigned jika status = READY_FOR_ASSIGNMENT.
- Case tidak boleh assigned ke dua officer secara paralel.
- Officer punya max active case quota.
- Audit harus tercatat atomically.
- Notification dikirim setelah commit.
```

### 26.2 Entity sederhana

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 50)
    private CaseStatus status;

    @Column(name = "assigned_officer_id")
    private Long assignedOfficerId;

    protected CaseRecord() {
    }

    public void assignTo(Long officerId) {
        if (status != CaseStatus.READY_FOR_ASSIGNMENT) {
            throw new InvalidCaseStateException(id, status);
        }
        this.assignedOfficerId = officerId;
        this.status = CaseStatus.ASSIGNED;
    }
}
```

### 26.3 Repository

```java
public interface CaseRepository extends JpaRepository<CaseRecord, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CaseRecord c where c.id = :id")
    Optional<CaseRecord> findByIdForUpdate(@Param("id") Long id);
}
```

### 26.4 Service

```java
@Service
public class AssignCaseService {

    private final CaseRepository caseRepository;
    private final OfficerQuotaRepository quotaRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final OutboxRepository outboxRepository;

    public AssignCaseService(
        CaseRepository caseRepository,
        OfficerQuotaRepository quotaRepository,
        AuditTrailRepository auditTrailRepository,
        OutboxRepository outboxRepository
    ) {
        this.caseRepository = caseRepository;
        this.quotaRepository = quotaRepository;
        this.auditTrailRepository = auditTrailRepository;
        this.outboxRepository = outboxRepository;
    }

    @Transactional
    public void assign(AssignCaseCommand command) {
        CaseRecord caseRecord = caseRepository.findByIdForUpdate(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        int updatedQuota = quotaRepository.incrementActiveCaseIfBelowLimit(command.officerId());
        if (updatedQuota != 1) {
            throw new OfficerQuotaExceededException(command.officerId());
        }

        caseRecord.assignTo(command.officerId());

        auditTrailRepository.save(AuditTrail.caseAssigned(
            command.caseId(),
            command.officerId(),
            command.actorId(),
            command.reason()
        ));

        outboxRepository.save(OutboxEvent.caseAssigned(
            command.caseId(),
            command.officerId()
        ));
    }
}
```

### 26.5 Quota update sebagai conditional update

```java
public interface OfficerQuotaRepository extends JpaRepository<OfficerQuota, Long> {

    @Modifying
    @Query("""
        update OfficerQuota q
        set q.activeCaseCount = q.activeCaseCount + 1
        where q.officerId = :officerId
          and q.activeCaseCount < q.maxActiveCaseCount
        """)
    int incrementActiveCaseIfBelowLimit(@Param("officerId") Long officerId);
}
```

Ini menghindari lock entity quota yang lebih lama.

---

## 27. Case Study: Prevent Double Approval

Requirement:

```text
- Application bisa approved satu kali.
- Dua approver bisa submit action hampir bersamaan.
- Sistem harus mencegah double approval.
- Audit harus jelas siapa yang berhasil dan siapa yang gagal.
```

Opsi optimistic:

```java
@Transactional
public void approve(Long applicationId, long expectedVersion, Actor actor) {
    Application app = repository.findById(applicationId).orElseThrow();

    if (app.getVersion() != expectedVersion) {
        throw new ConflictException();
    }

    app.approve(actor);
}
```

Opsi pessimistic:

```java
@Transactional
public void approve(Long applicationId, Actor actor) {
    Application app = repository.findByIdForUpdate(applicationId).orElseThrow();
    app.approve(actor);
    auditTrailRepository.save(AuditTrail.approved(applicationId, actor.id()));
}
```

Opsi conditional update:

```java
@Modifying
@Query("""
    update Application a
    set a.status = 'APPROVED',
        a.approvedBy = :actorId,
        a.approvedAt = :now
    where a.id = :id
      and a.status = 'PENDING_APPROVAL'
    """)
int approveIfPending(
    @Param("id") Long id,
    @Param("actorId") Long actorId,
    @Param("now") Instant now
);
```

Trade-off:

- Optimistic: bagus untuk UI edit flow.
- Pessimistic: bagus jika transition perlu banyak read/side data dan konflik tinggi.
- Conditional update: bagus untuk transition sederhana dan sangat scalable.

---

## 28. Pessimistic Locking dan External Side Effects

Jangan lakukan ini:

```java
@Transactional
public void approveAndSend(Long id) {
    Application app = repository.findByIdForUpdate(id).orElseThrow();
    app.approve();

    // Risiko: lock masih dipegang selama network call.
    emailClient.sendApprovalEmail(app.getEmail());
}
```

Masalah:

- lock duration mengikuti latency email service,
- jika email sukses lalu DB rollback, state tidak konsisten,
- jika DB commit lalu response gagal, caller bisa retry dan email double,
- deadlock/timeout risk naik.

Lebih baik outbox:

```java
@Transactional
public void approve(Long id) {
    Application app = repository.findByIdForUpdate(id).orElseThrow();
    app.approve();
    outboxRepository.save(OutboxEvent.approvalEmailRequested(id));
}
```

Publisher terpisah membaca outbox setelah commit.

---

## 29. Pessimistic Locking dan Cache

Cache bisa mengaburkan concurrency.

Contoh masalah:

```text
T1 lock row dan update status.
T2 membaca status lama dari Redis/cache.
T2 memutuskan action berdasarkan data stale.
```

Prinsip:

- Jangan gunakan cache sebagai sumber keputusan untuk operasi yang butuh lock/correctness.
- Untuk command, baca state authoritative dari DB dalam transaction.
- Invalidate/update cache setelah commit, bukan sebelum commit.
- Cache lock bukan pengganti DB constraint.
- Distributed lock seperti Redis lock punya failure mode berbeda dari DB transaction.

---

## 30. Pessimistic Locking dan Read Replicas

Pessimistic lock harus terjadi di primary/write database.

Jangan:

```text
Read from replica → decide available → write primary
```

Replica lag dapat membuat keputusan salah.

Untuk command:

- baca dari primary,
- lock di primary,
- update di primary,
- commit,
- publish/invalidate.

Read replica cocok untuk query baca yang tidak membuat keputusan mutasi kritis.

---

## 31. Pessimistic Locking dan Virtual Threads

Java modern dengan virtual threads membuat thread blocking lebih murah di sisi JVM, tetapi tidak membuat database lock wait murah.

Jika 10.000 virtual threads menunggu lock/database connection:

- connection pool tetap terbatas,
- DB session tetap terbatas,
- row lock tetap bottleneck,
- transaction tetap memegang resource,
- database tetap bisa overload.

Virtual thread bukan solusi contention database.

Prinsip:

- Batasi concurrency ke DB dengan connection pool/bulkhead.
- Gunakan timeout.
- Gunakan queue/backpressure.
- Jangan membanjiri DB dengan retry paralel.

---

## 32. Observability: Apa yang Harus Dimonitor?

Aplikasi:

- lock acquisition duration,
- transaction duration,
- repository method latency,
- retry count,
- deadlock exception count,
- lock timeout count,
- connection pool active/idle/pending,
- HTTP 409/423/503 karena lock conflict,
- queue claim rate,
- stuck job count.

Hibernate/JPA:

- SQL count,
- slow query,
- flush count,
- entity load count,
- transaction count,
- connection acquisition time.

Database:

- lock wait sessions,
- blocking session,
- deadlock logs,
- top locked objects,
- long-running transaction,
- rows scanned,
- execution plan,
- index usage,
- undo/redo pressure,
- CPU/I/O wait.

Log context:

```text
correlationId
requestId
actorId
useCase
entityType
entityId
transactionAttempt
lockMode
lockTimeoutMs
elapsedMs
```

---

## 33. Production Failure Modes

### 33.1 Lock wait storm

Gejala:

- response time naik,
- DB session banyak menunggu lock,
- connection pool penuh,
- CPU mungkin tidak tinggi tetapi throughput turun.

Penyebab:

- satu transaction memegang lock terlalu lama,
- external call dalam transaction,
- batch job mengunci banyak row,
- missing index pada locking query,
- traffic spike ke hot row.

Mitigasi:

- cari blocking session,
- kill/rollback transaction bila aman,
- kurangi concurrency worker,
- tambah timeout,
- fix query/index,
- pendekkan transaction.

### 33.2 Deadlock spike

Penyebab umum:

- lock order tidak konsisten,
- batch update parent-child,
- dua workflow menyentuh tabel sama dalam urutan berbeda,
- foreign key cascade/delete,
- trigger yang mengupdate tabel lain.

Mitigasi:

- deterministic lock order,
- pecah transaction besar,
- review cascade/trigger,
- index FK,
- retry bounded.

### 33.3 Queue starvation dengan `SKIP LOCKED`

Penyebab:

- job tertentu selalu dilewati karena terkunci/stuck,
- worker mati setelah claim,
- tidak ada recovery.

Mitigasi:

- claimed timeout,
- heartbeat,
- max attempts,
- dead-letter,
- stuck job monitor.

### 33.4 Retry storm

Penyebab:

- semua request retry bersamaan setelah timeout/deadlock,
- retry tanpa jitter,
- max attempt terlalu tinggi,
- tidak ada idempotency.

Mitigasi:

- exponential backoff dengan jitter,
- circuit breaker/bulkhead,
- reduce concurrency,
- deduplicate command,
- retry hanya error retriable.

---

## 34. Anti-Pattern

### 34.1 Lock everything

```java
@Lock(PESSIMISTIC_WRITE)
List<Application> findAllByStatus(ApplicationStatus status);
```

Bahaya:

- mengunci banyak row,
- menurunkan throughput,
- deadlock risk besar,
- query plan bisa berubah.

### 34.2 Lock lalu external call

```java
@Transactional
void process(Long id) {
    Entity e = lock(id);
    externalApi.call();
    e.markDone();
}
```

### 34.3 Lock dalam loop tidak terurut

```java
for (Long id : idsFromRequest) {
    lock(id);
}
```

Request order bisa berbeda-beda. Sort dulu.

### 34.4 Pessimistic lock untuk long user editing

User membuka form 20 menit. Jangan tahan DB lock selama itu. Gunakan optimistic locking dengan version.

### 34.5 Mengandalkan lock tanpa constraint

Jika invariant adalah uniqueness, gunakan unique constraint. Lock saja tidak cukup karena path lain bisa bypass.

### 34.6 Menganggap lock timeout selalu portable

Hint JPA tidak selalu diterjemahkan sama di semua database/provider. Test dialect target.

### 34.7 Mengunci hasil query tanpa index

Predicate tanpa index dapat menyebabkan scan dan lock behavior buruk.

---

## 35. Design Decision Matrix

| Problem | Solusi utama | Catatan |
|---|---|---|
| User edit conflict | Optimistic locking | `@Version`, HTTP 409 |
| Claim job by many workers | `SKIP LOCKED` / conditional claim | Native SQL sering lebih tepat |
| Decrement quota | Conditional update | Lebih ringan dari entity lock |
| Complex transition high contention | Pessimistic lock aggregate root | Keep transaction short |
| Duplicate request | Unique idempotency key | Jangan hanya lock |
| Duplicate business key | Unique constraint | Tangani violation |
| Cross-service side effect | Outbox/inbox | Lock tidak menyelesaikan dual-write |
| Long human workflow | Optimistic/state token | Jangan tahan DB transaction |
| Hot counter | Sharded counter / queue / atomic update | Pilih sesuai correctness/latency |
| Deadlock-prone multi-row update | Deterministic lock order | Retry bounded |

---

## 36. Checklist Pessimistic Locking

Sebelum memakai pessimistic lock, jawab:

1. Resource apa yang sebenarnya harus serialized?
2. Apakah invariant bisa dijaga dengan unique/check constraint?
3. Apakah conditional update cukup?
4. Apakah optimistic locking cukup?
5. Berapa lama transaction akan memegang lock?
6. Apakah ada external call di dalam transaction?
7. Apakah lock query menggunakan index?
8. Apakah lock order deterministic?
9. Apakah timeout sudah ditentukan?
10. Apakah retry bounded dan memakai jitter?
11. Apakah command idempotent?
12. Apakah exception lock timeout/deadlock diklasifikasikan?
13. Apakah metrics lock wait dan deadlock dimonitor?
14. Apakah behavior sudah dites pada database asli?
15. Apakah ada fallback/recovery untuk stuck processing?

---

## 37. Latihan / Scenario

### Scenario 1 — Assignment Race

Dua officer mengambil case yang sama dari queue.

Tentukan:

- apakah perlu pessimistic lock,
- query claim seperti apa,
- constraint apa yang perlu,
- bagaimana audit dicatat,
- bagaimana response untuk officer yang kalah.

### Scenario 2 — Quota Allocation

Kuota per officer maksimal 20 active case. Banyak assignment terjadi paralel.

Bandingkan:

- lock row officer quota,
- conditional update,
- optimistic locking,
- recalculated count dari case table.

Pilih satu dan jelaskan failure mode.

### Scenario 3 — Bulk Reassignment

Admin memindahkan 1.000 case dari officer A ke B saat worker lain juga assign case baru.

Desain:

- chunk size,
- lock order,
- transaction boundary,
- retry strategy,
- monitoring.

### Scenario 4 — Database Queue

Buat desain tabel job dan worker yang aman untuk 20 pod consumer.

Harus menjawab:

- bagaimana claim job,
- bagaimana menghindari double process,
- bagaimana recover stuck job,
- bagaimana retry/dead-letter,
- index apa yang diperlukan.

### Scenario 5 — Deadlock Investigation

Log menunjukkan deadlock antara `case_record`, `case_task`, dan `audit_trail`.

Analisis:

- kemungkinan lock order,
- FK/index issue,
- transaction terlalu besar,
- trigger/cascade,
- solusi jangka pendek dan panjang.

---

## 38. Ringkasan

Pessimistic locking adalah mekanisme eksplisit untuk membuat transaksi lain menunggu, gagal cepat, atau melewati resource yang sedang dikunci. Ia sangat berguna untuk high-contention workload seperti queue claim, quota reservation, state transition kritis, dan resource allocation. Namun ia juga membawa risiko besar: lock wait, deadlock, connection pool exhaustion, retry storm, dan throughput collapse.

Mental model utama:

1. Pessimistic lock adalah database lock, bukan Java object lock.
2. Lock hidup selama transaction, sehingga transaction harus pendek.
3. Lock query harus sederhana, indexed, dan predictable.
4. Multi-row lock harus mengikuti deterministic order.
5. Timeout dan retry harus explicit.
6. Retry harus idempotent.
7. External side effect jangan dilakukan di dalam lock-holding transaction.
8. Untuk operasi sederhana, conditional update sering lebih baik daripada entity lock.
9. Untuk duplicate prevention, database constraint lebih kuat daripada lock.
10. Untuk production, observability lock wait/deadlock sama pentingnya dengan code.

Top engineer tidak memakai pessimistic lock karena takut race condition. Ia memakai pessimistic lock hanya ketika sudah jelas resource mana yang harus serialized, berapa lama lock dipegang, bagaimana lock gagal, bagaimana retry aman, dan bagaimana failure-nya terlihat di production.

---

## 39. Referensi Utama

- Jakarta Persistence 3.2 Specification — Locking, entity manager, lock modes, persistence context.
- Jakarta EE Tutorial — Controlling Concurrent Access to Entity Data with Locking.
- Hibernate ORM User Guide — Locking, pessimistic locks, lock timeout, dialect behavior.
- Spring Framework Reference — Declarative transaction management and rollback behavior.
- Database vendor documentation — Oracle, PostgreSQL, MySQL/InnoDB, SQL Server locking behavior.

---

## 40. Status Seri

Seri belum selesai.

Part yang sudah dibuat sampai bagian ini:

- Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer
- Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions
- Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction
- Part 003 — Entity Identity: Object Identity, Database Identity, Business Identity
- Part 004 — Entity Lifecycle and Persistence Context Internals
- Part 005 — Mapping Fundamentals Done Correctly
- Part 006 — Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many
- Part 007 — Fetching Strategy: Lazy, Eager, N+1, Entity Graph, Fetch Join
- Part 008 — Query Model: JPQL, HQL, Criteria, Native SQL, QuerySpecification
- Part 009 — Projection, DTO, Read Model, and Reporting Queries
- Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers
- Part 011 — Transaction Boundary Design in Real Applications
- Part 012 — Isolation Levels and Concurrency Anomalies
- Part 013 — Optimistic Locking, Versioning, and State Machine Persistence
- Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads

Bagian berikutnya:

- Part 015 — Flush, Dirty Checking, Write-Behind, and SQL Generation

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 013 — Optimistic Locking, Versioning, and State Machine Persistence](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 015 — Flush, Dirty Checking, Write-Behind, and SQL Generation](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-015.md)

</div>