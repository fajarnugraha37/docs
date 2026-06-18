# Part 012 — Isolation Levels and Concurrency Anomalies

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 hingga Java 25  
> Fokus: Java/Jakarta Persistence, JPA, Hibernate, Jakarta Transactions, Spring Transaction, dan integrasi database produksi

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami **isolation level** sebagai kontrak visibilitas antar transaksi, bukan sekadar konfigurasi `@Transactional(isolation = ...)`.
2. Membedakan anomaly seperti:
   - dirty read,
   - non-repeatable read,
   - phantom read,
   - lost update,
   - read skew,
   - write skew,
   - stale read,
   - deadlock,
   - lock wait timeout.
3. Menjelaskan kenapa **ACID tidak otomatis berarti semua concurrent bug hilang**.
4. Memahami hubungan antara:
   - database isolation level,
   - JPA/Hibernate persistence context,
   - optimistic locking,
   - pessimistic locking,
   - transaction boundary,
   - retry strategy,
   - database constraint.
5. Menentukan kapan cukup memakai `READ_COMMITTED`, kapan perlu optimistic locking, kapan perlu pessimistic locking, kapan perlu serializable, dan kapan perlu redesign invariant.
6. Menganalisis concurrency pada sistem kompleks seperti approval workflow, quota, assignment, reservation, enforcement case, payment-like state transition, dan regulatory decision.
7. Mendesain persistence logic yang aman untuk multi-user, multi-node, retry, duplicate request, dan asynchronous processing.

Bagian ini bukan sekadar teori database. Kita akan fokus pada cara berpikir yang dapat dipakai ketika mendesain aplikasi Java enterprise dengan JPA/Hibernate/Spring/Jakarta EE.

---

## 2. Mental Model: Isolation Adalah “Apa yang Boleh Terlihat” Saat Transaksi Berjalan

Transaction punya dua dimensi besar:

1. **Atomicity**: semua perubahan dalam transaksi berhasil bersama atau gagal bersama.
2. **Isolation**: transaksi yang berjalan bersamaan tidak saling melihat efek sementara dengan cara yang melanggar kontrak isolation level.

Banyak engineer berhenti di atomicity:

```java
@Transactional
public void approve(Long caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    c.approve();
}
```

Kode di atas terlihat benar untuk satu request. Tapi pertanyaan yang lebih penting:

- Apa yang terjadi jika dua officer approve case yang sama bersamaan?
- Apa yang terjadi jika satu officer escalate sementara officer lain reject?
- Apa yang terjadi jika background job auto-close case sementara user sedang update?
- Apa yang terjadi jika dua node aplikasi melakukan assignment dari pool yang sama?
- Apa yang terjadi jika query validasi membaca state lama karena transaksi lain belum commit?
- Apa yang terjadi jika database mengizinkan dua transaksi membaca kondisi yang sama lalu menulis hasil yang saling bertentangan?

Isolation adalah jawaban database terhadap pertanyaan semacam itu.

Namun, isolation bukan satu tombol ajaib. Ia bekerja bersama:

- database engine,
- isolation level,
- lock manager,
- MVCC/snapshot mechanism,
- SQL statement pattern,
- index,
- transaction duration,
- ORM flush behavior,
- JPA persistence context,
- optimistic version,
- pessimistic lock,
- retry policy,
- database constraint.

### 2.1 Satu kalimat penting

> Transaction boundary menentukan **kapan perubahan dianggap satu unit konsistensi**. Isolation level menentukan **apa yang boleh dilihat transaksi lain selama unit itu berjalan**. Locking/versioning menentukan **cara kita mencegah conflict yang tidak cukup dicegah oleh isolation default**.

---

## 3. Core Vocabulary

Sebelum masuk anomaly, kita perlu menyamakan istilah.

### 3.1 Transaction

Satu unit kerja yang commit atau rollback. Pada aplikasi Java, transaction bisa dikelola oleh:

- JDBC `Connection` manual,
- JPA `EntityTransaction`,
- Jakarta Transactions/JTA,
- Spring `@Transactional`,
- container-managed transaction pada Jakarta EE.

### 3.2 Isolation Level

Konfigurasi yang mengatur visibility dan interleaving antar transaksi.

Level yang umum dikenal:

- `READ_UNCOMMITTED`
- `READ_COMMITTED`
- `REPEATABLE_READ`
- `SERIALIZABLE`

Beberapa database juga punya konsep seperti:

- snapshot isolation,
- read committed snapshot,
- serializable snapshot isolation,
- repeatable read berbasis MVCC,
- vendor-specific lock behavior.

### 3.3 Lock

Mekanisme database untuk membatasi operasi concurrent.

Contoh:

- shared/read lock,
- exclusive/write lock,
- row lock,
- table lock,
- gap lock,
- predicate lock,
- key-range lock,
- advisory lock.

### 3.4 MVCC

Multi-Version Concurrency Control. Database menyimpan beberapa versi row agar reader tidak selalu memblok writer dan writer tidak selalu memblok reader.

Konsekuensinya:

- read bisa melihat snapshot lama,
- writer conflict mungkin baru ketahuan saat update/commit,
- anomaly tertentu masih bisa terjadi tergantung isolation level.

### 3.5 Anomaly

Hasil concurrent execution yang tidak sesuai invariant aplikasi.

Tidak semua anomaly berarti database “salah”. Banyak anomaly memang diperbolehkan oleh isolation level tertentu.

### 3.6 Invariant

Aturan yang harus selalu benar.

Contoh:

- Satu case hanya boleh punya satu final decision.
- Case tidak boleh di-approve jika mandatory document belum lengkap.
- Quota daily review tidak boleh negatif.
- Dua officer tidak boleh memproses assignment yang sama.
- Appeal tidak boleh dibuat dua kali untuk decision yang sama.
- Enforcement action tidak boleh dieksekusi jika case sudah withdrawn.

Concurrency design harus dimulai dari invariant, bukan dari annotation.

---

## 4. Isolation Level Overview

### 4.1 READ_UNCOMMITTED

Transaksi boleh membaca perubahan yang belum commit dari transaksi lain.

Kemungkinan anomaly:

- dirty read,
- non-repeatable read,
- phantom read,
- lost update,
- read skew,
- write skew.

Di aplikasi enterprise, level ini hampir tidak pernah layak untuk data bisnis.

### 4.2 READ_COMMITTED

Transaksi hanya membaca data yang sudah commit.

Namun, jika membaca row yang sama dua kali, hasilnya bisa berubah jika transaksi lain commit di antaranya.

Kemungkinan anomaly:

- non-repeatable read,
- phantom read,
- lost update jika tidak ada lock/version/conditional update,
- read skew,
- write skew.

Banyak database production memakai `READ_COMMITTED` sebagai default, misalnya Oracle dan PostgreSQL default ke read committed. Ini practical, tapi bukan berarti aman untuk semua invariant.

### 4.3 REPEATABLE_READ

Row yang sudah dibaca dalam satu transaksi akan konsisten jika dibaca ulang. Namun behavior phantom dan predicate conflict berbeda antar database.

Kemungkinan anomaly tergantung database:

- phantom read mungkin masih terjadi pada definisi textbook,
- write skew masih mungkin pada snapshot-like implementation,
- deadlock tetap mungkin,
- lost update bisa dicegah atau tidak tergantung write pattern.

MySQL InnoDB default historically memakai repeatable read, tetapi implementasinya memiliki next-key/gap lock behavior yang tidak identik dengan database lain.

### 4.4 SERIALIZABLE

Database berusaha membuat hasil transaksi concurrent setara dengan seolah-olah transaksi dijalankan satu per satu.

Ini isolation terkuat dalam SQL standard vocabulary.

Konsekuensi:

- correctness lebih kuat,
- conflict/serialization failure lebih mungkin,
- throughput bisa turun,
- retry wajib dipikirkan,
- query/index design semakin penting.

Serializable bukan berarti aplikasi bebas dari retry. Justru aplikasi harus siap menerima serialization failure lalu menjalankan ulang transaksi yang aman diulang.

### 4.5 Snapshot Isolation

Snapshot isolation sering terasa seperti repeatable read: transaksi membaca snapshot konsisten dari awal transaksi. Namun snapshot isolation tidak selalu sama dengan serializable.

Anomaly penting yang bisa muncul:

- write skew.

Contoh write skew:

- Ada aturan “minimal satu reviewer harus aktif”.
- Dua transaksi membaca bahwa ada dua reviewer aktif.
- Transaksi A menonaktifkan reviewer 1.
- Transaksi B menonaktifkan reviewer 2.
- Keduanya update row berbeda.
- Keduanya commit.
- Hasil akhir: nol reviewer aktif.

Tidak ada lost update pada row yang sama, tapi invariant lintas row rusak.

---

## 5. Mapping Isolation ke Java/Spring/JPA

### 5.1 JDBC isolation

Pada level JDBC, isolation adalah property connection:

```java
connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
```

Nilai umum:

```java
Connection.TRANSACTION_READ_UNCOMMITTED
Connection.TRANSACTION_READ_COMMITTED
Connection.TRANSACTION_REPEATABLE_READ
Connection.TRANSACTION_SERIALIZABLE
```

Namun di aplikasi modern, kamu jarang mengatur langsung via `Connection`. Framework transaction manager biasanya mengatur ini saat membuka transaksi.

### 5.2 Spring `@Transactional` isolation

Contoh:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void submitApplication(Long applicationId) {
    // use case logic
}
```

Atau:

```java
@Transactional(isolation = Isolation.SERIALIZABLE)
public void allocateLimitedQuota(Long quotaId) {
    // allocation logic
}
```

Hal penting:

- isolation hanya berlaku saat transaksi baru dibuat;
- jika method ikut transaksi existing, isolation method tersebut belum tentu mengubah isolation actual;
- tidak semua database mendukung semua isolation level dengan semantik yang sama;
- connection pool harus mengembalikan isolation ke default setelah transaksi selesai;
- transaction manager tertentu bisa menolak perubahan isolation jika tidak compatible.

### 5.3 Jakarta Transactions/JTA

Jakarta Transactions mendefinisikan API untuk transaction demarcation dan kontrak antara application, transaction manager, resource manager, dan application server. Namun isolation level sering kali tetap dikendalikan oleh resource/database/connection configuration atau container-specific setting.

Dengan kata lain:

- JTA mengkoordinasikan transaksi,
- database tetap menentukan isolation behavior actual,
- XA/distributed transaction tidak otomatis menghilangkan anomaly bisnis.

### 5.4 JPA lock modes

JPA/Jakarta Persistence menyediakan `LockModeType` untuk optimistic dan pessimistic locking, misalnya:

```java
LockModeType.OPTIMISTIC
LockModeType.OPTIMISTIC_FORCE_INCREMENT
LockModeType.PESSIMISTIC_READ
LockModeType.PESSIMISTIC_WRITE
LockModeType.PESSIMISTIC_FORCE_INCREMENT
```

Lock mode bisa dipakai lewat:

```java
entityManager.find(CaseFile.class, id, LockModeType.PESSIMISTIC_WRITE);
```

atau query:

```java
entityManager.createQuery("select c from CaseFile c where c.id = :id", CaseFile.class)
    .setParameter("id", id)
    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
    .getSingleResult();
```

Lock mode bukan pengganti isolation level. Ia adalah alat tambahan untuk conflict tertentu.

---

## 6. Persistence Context vs Database Isolation

Ini sumber banyak kebingungan.

JPA persistence context adalah first-level cache/identity map. Database isolation adalah visibility rule antar transaksi di database.

Contoh:

```java
@Transactional
public void example(Long id) {
    CaseFile a = em.find(CaseFile.class, id);
    // transaksi lain commit perubahan ke row yang sama
    CaseFile b = em.find(CaseFile.class, id);
}
```

Dalam persistence context yang sama, `a == b`. JPA bisa mengembalikan object managed yang sama tanpa query ulang.

Artinya:

- kamu mungkin tidak melihat perubahan transaksi lain bukan karena isolation level saja,
- tapi karena persistence context sudah punya entity instance tersebut.

Untuk memaksa sinkronisasi:

```java
em.refresh(a);
```

atau detach/clear lalu load ulang:

```java
em.clear();
CaseFile fresh = em.find(CaseFile.class, id);
```

Tapi ini harus dilakukan dengan hati-hati. Refresh bukan solusi default; sering kali tanda transaction boundary/query design perlu diperbaiki.

---

## 7. Anomaly 1: Dirty Read

### 7.1 Definisi

Dirty read terjadi ketika transaksi membaca data yang ditulis transaksi lain tetapi belum commit.

### 7.2 Timeline

```text
T1: update case set status = 'APPROVED' where id = 10
T2: select status from case where id = 10  -> sees APPROVED
T1: rollback
T2: already made decision based on data that never committed
```

### 7.3 Dampak bisnis

- Notification dikirim untuk approval yang akhirnya rollback.
- Dashboard menampilkan state yang tidak pernah benar-benar terjadi.
- Rule engine mengambil keputusan dari data sementara.

### 7.4 Prevention

Gunakan minimal `READ_COMMITTED`. Untuk sistem bisnis, dirty read hampir selalu tidak boleh.

---

## 8. Anomaly 2: Non-Repeatable Read

### 8.1 Definisi

Transaksi membaca row yang sama dua kali dan mendapat value berbeda karena transaksi lain commit di antaranya.

### 8.2 Timeline

```text
T1: select status from case where id = 10 -> DRAFT
T2: update case set status = 'SUBMITTED' where id = 10
T2: commit
T1: select status from case where id = 10 -> SUBMITTED
```

### 8.3 Kapan ini masalah?

Jika T1 membuat keputusan berdasarkan asumsi bahwa data yang dibaca pertama tetap sama.

Contoh:

```java
@Transactional
public void validateThenProcess(Long caseId) {
    CaseFile c = repository.findById(caseId).orElseThrow();
    if (!c.isProcessable()) throw new IllegalStateException();

    // do other reads/work

    // asumsi c masih processable
    c.process();
}
```

Di JPA, karena persistence context meng-cache entity, kamu mungkin tidak melihat non-repeatable read sebagai value berubah di object yang sama. Tapi database state actual bisa berubah dan conflict baru ketahuan saat flush/commit, atau tidak ketahuan sama sekali jika tidak ada version/condition.

### 8.4 Prevention

Pilihan:

- optimistic locking dengan `@Version`,
- pessimistic lock saat read,
- conditional update,
- higher isolation,
- short transaction,
- state transition guarded by SQL condition.

---

## 9. Anomaly 3: Phantom Read

### 9.1 Definisi

Transaksi menjalankan predicate query dua kali dan mendapat set row berbeda karena transaksi lain insert/delete row yang memenuhi predicate.

### 9.2 Timeline

```text
T1: select count(*) from assignment where officer_id = 7 and status = 'ACTIVE' -> 4
T2: insert assignment(officer_id, status) values(7, 'ACTIVE')
T2: commit
T1: select count(*) ... -> 5
```

### 9.3 Contoh bisnis

Rule: officer maksimal punya 5 active assignments.

Dua request concurrent:

```text
T1: count active = 4, boleh assign
T2: count active = 4, boleh assign
T1: insert assignment #5
T2: insert assignment #6
```

Hasil akhir melanggar invariant.

### 9.4 Prevention

Tergantung invariant:

- unique/constraint jika bisa diekspresikan di database,
- counter row dengan pessimistic lock,
- serializable isolation,
- advisory lock/provider-specific,
- allocation table dengan deterministic locking,
- conditional update pada quota row,
- redesign model agar invariant menjadi row-level conflict.

---

## 10. Anomaly 4: Lost Update

### 10.1 Definisi

Dua transaksi membaca value yang sama, menghitung update masing-masing, lalu salah satu update menimpa update lain.

### 10.2 Timeline

```text
Initial: case.priority = 10

T1: read priority = 10
T2: read priority = 10
T1: set priority = 11
T2: set priority = 12
T1: commit
T2: commit

Final: priority = 12
T1 update hilang.
```

### 10.3 Contoh JPA tanpa version

```java
@Entity
class CaseFile {
    @Id
    Long id;

    int priority;
}
```

```java
@Transactional
public void increasePriority(Long id) {
    CaseFile c = repository.findById(id).orElseThrow();
    c.setPriority(c.getPriority() + 1);
}
```

Jika dua transaksi membaca priority yang sama, hasil akhir bisa hanya +1, bukan +2.

### 10.4 Prevention dengan optimistic locking

```java
@Entity
class CaseFile {
    @Id
    private Long id;

    @Version
    private long version;

    private int priority;
}
```

Saat commit/flush, Hibernate/JPA akan memasukkan version check dalam update. Secara konseptual:

```sql
update case_file
set priority = ?, version = version + 1
where id = ? and version = ?
```

Jika row count 0, berarti entity sudah berubah oleh transaksi lain. Framework melempar optimistic lock exception.

### 10.5 Prevention dengan conditional update

Untuk operasi counter sederhana:

```java
@Modifying
@Query("""
    update CaseFile c
       set c.priority = c.priority + 1
     where c.id = :id
""")
int incrementPriority(@Param("id") Long id);
```

Untuk state transition:

```java
@Modifying
@Query("""
    update CaseFile c
       set c.status = :nextStatus
     where c.id = :id
       and c.status = :expectedStatus
""")
int transition(
    @Param("id") Long id,
    @Param("expectedStatus") CaseStatus expectedStatus,
    @Param("nextStatus") CaseStatus nextStatus
);
```

Jika return `0`, transition tidak valid lagi.

### 10.6 Rule praktis

Untuk entity bisnis mutable yang bisa diedit concurrent, `@Version` hampir selalu layak dipakai.

---

## 11. Anomaly 5: Read Skew

### 11.1 Definisi

Satu transaksi membaca beberapa row yang secara logical harus konsisten, tapi melihat kombinasi state dari waktu berbeda.

### 11.2 Contoh

Invariant:

```text
case.status = APPROVED harus punya decision.status = FINAL
```

Timeline:

```text
T1: read case.status -> APPROVED
T2: update decision.status from DRAFT to FINAL
T2: commit
T1: read decision.status -> FINAL
```

Atau kebalikannya, T1 melihat combination yang tidak pernah ada sebagai satu snapshot konsisten.

### 11.3 Kapan terjadi?

Pada isolation yang tidak memberi consistent snapshot untuk keseluruhan transaksi, atau ketika aplikasi melakukan beberapa query terpisah tanpa boundary yang benar.

### 11.4 Prevention

- snapshot/repeatable-read-like isolation jika diperlukan,
- join query tunggal untuk consistent read di statement level,
- version/invariant row,
- aggregate root version,
- materialized read model,
- transaction boundary yang lebih pendek.

---

## 12. Anomaly 6: Write Skew

### 12.1 Definisi

Dua transaksi membaca predicate/invariant yang sama, lalu menulis row berbeda sehingga invariant global rusak.

Write skew lebih halus daripada lost update karena tidak ada row yang sama ditulis oleh dua transaksi.

### 12.2 Contoh reviewer aktif

Rule:

```text
Setidaknya satu reviewer harus aktif untuk setiap case type.
```

Data awal:

```text
Reviewer A active
Reviewer B active
```

Timeline:

```text
T1: count active reviewers = 2
T2: count active reviewers = 2
T1: deactivate reviewer A
T2: deactivate reviewer B
T1: commit
T2: commit
Final: 0 active reviewers
```

Tidak ada lost update karena T1 update row A, T2 update row B.

### 12.3 Contoh regulatory workflow

Rule:

```text
Case tidak boleh final jika masih ada unresolved mandatory finding.
```

Timeline:

```text
T1: read unresolved findings count = 0
T2: read case not final
T1: final approve case
T2: insert mandatory finding
T1: commit
T2: commit
Final: case final tetapi punya unresolved mandatory finding
```

### 12.4 Prevention

Tidak cukup hanya `@Version` pada row yang berbeda.

Pilihan:

1. Jadikan invariant sebagai single-row conflict:

```text
case_invariant row / aggregate root row / quota row
```

Lock/update row itu setiap kali invariant terkait berubah.

2. Gunakan serializable isolation untuk transaksi tersebut.

3. Gunakan database constraint jika bisa diekspresikan.

4. Gunakan pessimistic lock pada parent/aggregate root:

```java
CaseFile c = em.find(CaseFile.class, id, LockModeType.PESSIMISTIC_WRITE);
```

5. Gunakan conditional update dengan guard.

6. Redesign workflow agar perubahan finding tidak boleh masuk setelah case masuk finalization lock/state.

---

## 13. Deadlock

### 13.1 Definisi

Deadlock terjadi ketika dua atau lebih transaksi saling menunggu lock yang dipegang transaksi lain.

### 13.2 Timeline sederhana

```text
T1: lock case 1
T2: lock case 2
T1: tries lock case 2 -> waits
T2: tries lock case 1 -> waits
Database detects deadlock and aborts one transaction
```

### 13.3 Penyebab umum di aplikasi JPA/Hibernate

- Update banyak row dengan urutan tidak deterministik.
- Batch job dan request online update row yang sama.
- Parent-child update dengan order berbeda.
- Cascade delete besar.
- Flush terjadi di tengah method sebelum query.
- Index buruk menyebabkan lock lebih luas/scan lebih banyak.
- Pessimistic lock diambil terlalu lama.
- Dua use case memakai lock order berbeda.

### 13.4 Prevention

1. Tentukan lock order deterministic.

```java
List<Long> sortedIds = ids.stream().sorted().toList();
for (Long id : sortedIds) {
    em.find(CaseFile.class, id, LockModeType.PESSIMISTIC_WRITE);
}
```

2. Buat transaksi pendek.
3. Jangan panggil external API saat lock masih dipegang.
4. Pastikan query lock memakai index.
5. Kurangi cascade update/delete besar.
6. Gunakan chunking untuk batch.
7. Implement retry untuk deadlock victim.

### 13.5 Deadlock bukan selalu bug fatal

Dalam high concurrency system, deadlock bisa terjadi walaupun desain cukup baik. Yang penting:

- frekuensi rendah,
- terobservasi,
- retriable,
- tidak menyebabkan side effect duplicate,
- root cause dianalisis jika meningkat.

---

## 14. Lock Wait Timeout

Lock wait timeout terjadi ketika transaksi menunggu lock terlalu lama dan database menghentikan statement/transaksi.

Penyebab:

- transaksi lain terlalu lama,
- batch job memegang lock besar,
- user request melakukan external call dalam transaction,
- query tidak memakai index sehingga lock/scan melebar,
- isolation terlalu kuat untuk workload,
- hot row.

Mitigation:

- short transaction,
- proper index,
- lower contention design,
- lock timeout explicit,
- queueing,
- optimistic locking,
- partitioning workload,
- retry dengan backoff.

JPA pessimistic lock dapat menerima timeout hint, misalnya:

```java
Map<String, Object> hints = Map.of(
    "jakarta.persistence.lock.timeout", 3000
);

CaseFile c = em.find(
    CaseFile.class,
    id,
    LockModeType.PESSIMISTIC_WRITE,
    hints
);
```

Provider/database support bervariasi.

---

## 15. Optimistic Locking

### 15.1 Mental model

Optimistic locking berasumsi conflict jarang. Transaksi tidak mengunci row sejak awal. Saat flush/commit, provider memverifikasi version masih sama.

Cocok untuk:

- form edit,
- case update oleh user,
- low to medium contention,
- user-driven workflow,
- API update yang bisa dikembalikan sebagai conflict,
- data yang tidak boleh silently overwritten.

### 15.2 Entity version

```java
@Entity
@Table(name = "case_file")
public class CaseFile {

    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    private String title;

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        status = CaseStatus.SUBMITTED;
    }
}
```

### 15.3 Exception handling

Spring/JPA/Hibernate bisa membungkus exception menjadi jenis berbeda tergantung stack:

- `OptimisticLockException`,
- `ObjectOptimisticLockingFailureException`,
- `StaleObjectStateException`,
- provider-specific exception.

Respons API yang umum:

```text
409 Conflict
```

Pesan user:

```text
Data sudah berubah oleh pengguna/proses lain. Silakan refresh dan ulangi perubahan.
```

### 15.4 Retry atau tidak?

Tidak semua optimistic lock boleh auto-retry.

Auto-retry cocok jika operasi:

- commutative,
- idempotent,
- tidak bergantung input user lama,
- tidak punya external side effect,
- bisa dihitung ulang dari state terbaru.

Contoh relatif aman:

- increment metric internal,
- update derived counter,
- background recomputation.

Tidak cocok auto-retry:

- user edit form,
- approval decision,
- legal/regulatory decision,
- financial-like state transition,
- perubahan yang perlu user awareness.

---

## 16. Pessimistic Locking

### 16.1 Mental model

Pessimistic locking berasumsi conflict mungkin/mahal. Transaksi mengunci data agar transaksi lain menunggu/gagal.

Cocok untuk:

- high contention row,
- assignment queue,
- quota allocation,
- reservation,
- final state transition,
- preventing concurrent processors,
- worker claiming tasks,
- invariant yang harus dilindungi segera.

### 16.2 Example

```java
@Transactional
public void approve(Long caseId, Long officerId) {
    CaseFile c = em.find(
        CaseFile.class,
        caseId,
        LockModeType.PESSIMISTIC_WRITE
    );

    c.approveBy(officerId);
}
```

Conceptually provider may generate SQL like:

```sql
select *
from case_file
where id = ?
for update
```

Actual SQL depends on database dialect.

### 16.3 Trade-off

Pros:

- simple mental model untuk row-level conflict,
- prevents concurrent modification early,
- useful for queue/claim/reservation.

Cons:

- lock wait,
- deadlock risk,
- lower throughput,
- transaction duration matters,
- external call inside transaction becomes dangerous,
- database vendor behavior differs.

### 16.4 Pessimistic lock is not a magic invariant solver

Jika invariant tersebar di banyak row dan query predicate, mengunci satu row mungkin tidak cukup.

Contoh:

```text
Maksimal 5 active assignments per officer.
```

Mengunci assignment yang sudah ada belum tentu mencegah insert assignment baru oleh transaksi lain, kecuali desainnya mengunci parent/counter/quota row atau memakai isolation/constraint yang sesuai.

---

## 17. Conditional Update as Concurrency Control

Conditional update sering lebih efisien daripada load entity lalu mutate.

### 17.1 State transition

```java
@Modifying
@Query("""
    update CaseFile c
       set c.status = :nextStatus,
           c.updatedAt = :now
     where c.id = :id
       and c.status = :expectedStatus
""")
int transition(
    Long id,
    CaseStatus expectedStatus,
    CaseStatus nextStatus,
    Instant now
);
```

Usage:

```java
int updated = repository.transition(
    id,
    CaseStatus.SUBMITTED,
    CaseStatus.UNDER_REVIEW,
    clock.instant()
);

if (updated == 0) {
    throw new ConflictException("Case state has changed");
}
```

### 17.2 Quota decrement

```sql
update quota
   set remaining = remaining - 1
 where id = ?
   and remaining > 0
```

Jika affected row `0`, quota habis.

### 17.3 Keunggulan

- atomic di database,
- tidak perlu load full entity,
- mengurangi lost update,
- cocok untuk hot path,
- jelas sebagai compare-and-swap.

### 17.4 Risiko

Bulk/JPQL update bypass persistence context. Jika entity terkait sudah managed di persistence context, state object bisa stale.

Mitigasi:

- lakukan conditional update di transaction terpisah,
- clear persistence context setelah bulk update,
- jangan campur managed entity mutation dan bulk update sembarangan,
- gunakan repository command khusus.

---

## 18. Database Constraint as Concurrency Control

Application check tidak cukup untuk concurrency.

### 18.1 Bad pattern

```java
if (!repository.existsByDecisionId(decisionId)) {
    repository.save(new Appeal(decisionId));
}
```

Dua transaksi bisa sama-sama melihat `false`, lalu insert duplicate.

### 18.2 Correct pattern

Database unique constraint:

```sql
alter table appeal
add constraint uk_appeal_decision unique (decision_id);
```

Application tetap boleh melakukan pre-check untuk UX, tapi correctness berasal dari constraint.

### 18.3 Handle violation

```java
try {
    appealRepository.save(appeal);
} catch (DataIntegrityViolationException ex) {
    throw new ConflictException("Appeal already exists for this decision");
}
```

### 18.4 Constraint types

- `NOT NULL`
- unique constraint
- foreign key
- check constraint
- exclusion constraint/vendor-specific
- partial unique index/vendor-specific
- deferrable constraint/vendor-specific

### 18.5 Principle

> Jika invariant bisa diekspresikan sebagai database constraint, gunakan database constraint. Application validation adalah UX; database constraint adalah correctness boundary.

---

## 19. Isolation Level vs Locking vs Constraint: Decision Matrix

| Problem | Recommended first tool | Additional tool |
|---|---|---|
| User edit conflict | `@Version` optimistic locking | 409 conflict UX |
| State transition from expected state | conditional update or `@Version` | pessimistic lock for high contention |
| Prevent duplicate business key | unique constraint | pre-check for UX |
| Quota decrement | conditional update | pessimistic lock on quota row |
| Worker claims task | `FOR UPDATE SKIP LOCKED` / pessimistic lock | retry/backoff |
| Multi-row invariant | parent/invariant row lock or serializable | constraint if possible |
| Reporting consistent snapshot | snapshot/repeatable read/read-only transaction | materialized read model |
| High contention counter | atomic SQL update | partitioned counter |
| Approval finalization | optimistic version + state guard | pessimistic lock for final transition |
| Batch updates online data | chunking + deterministic order | retry deadlock/timeout |

---

## 20. Common Database Behavior Differences

This section is intentionally conceptual. Exact behavior depends on version/configuration.

### 20.1 Oracle

Typical characteristics:

- default `READ COMMITTED`,
- MVCC/read consistency,
- readers generally do not block writers and writers generally do not block readers for normal reads,
- `SELECT FOR UPDATE` for row locking,
- serializable available but can raise serialization errors,
- sequence is common for id generation,
- LOB behavior has operational implications.

Design implication:

- do not assume read committed prevents lost update;
- use `@Version`/conditional update;
- understand `ORA-08177`-like serialization failure if using serializable;
- avoid long transactions holding row locks.

### 20.2 PostgreSQL

Typical characteristics:

- default `READ COMMITTED`,
- MVCC,
- repeatable read uses snapshot isolation-like behavior,
- serializable uses SSI-like behavior and can abort transactions with serialization failure,
- `FOR UPDATE`, `FOR NO KEY UPDATE`, `SKIP LOCKED`, advisory locks,
- powerful constraints/indexes such as partial index/exclusion constraint.

Design implication:

- use database constraints aggressively;
- use `SKIP LOCKED` for worker queue carefully;
- serializable requires retry;
- partial unique index can model soft-delete uniqueness.

### 20.3 MySQL/InnoDB

Typical characteristics:

- commonly default `REPEATABLE READ`,
- MVCC,
- next-key/gap locks in some cases,
- locking behavior depends heavily on index and query shape,
- deadlocks are common enough that retry strategy matters.

Design implication:

- index design directly affects lock range;
- query without proper index can lock more than expected;
- test concurrency on real MySQL/InnoDB, not H2.

### 20.4 SQL Server

Typical characteristics:

- locking-based read committed by default in many installations,
- optional read committed snapshot isolation,
- lock escalation possible,
- snapshot isolation available when enabled,
- deadlock victim selection.

Design implication:

- know whether RCSI/snapshot is enabled;
- monitor lock escalation;
- index design and transaction duration are critical.

---

## 21. Isolation in Spring Transaction Design

### 21.1 Example: isolation setting

```java
@Service
public class QuotaService {

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void allocateNormal(Long quotaId) {
        // often enough when using conditional update
    }

    @Transactional(isolation = Isolation.SERIALIZABLE)
    public void allocateWithPredicateInvariant(Long officerId) {
        // only if needed and tested against target DB
    }
}
```

### 21.2 Beware existing transaction

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void outer() {
    innerSerializable();
}

@Transactional(isolation = Isolation.SERIALIZABLE)
public void innerSerializable() {
    // may not start a new transaction if self-invocation or REQUIRED joins existing transaction
}
```

Issues:

- self-invocation bypasses proxy in Spring;
- `REQUIRED` joins existing transaction;
- isolation of inner method may not apply;
- use `REQUIRES_NEW` only if semantics justify separate transaction;
- do not use propagation as patch without understanding consistency.

### 21.3 Validate actual behavior

For high-risk code, confirm:

- actual database isolation,
- actual generated SQL,
- lock mode SQL,
- lock wait behavior,
- exception type on conflict,
- retry behavior.

---

## 22. Retry Strategy

Concurrency control without retry is incomplete.

### 22.1 Retriable cases

Usually retriable:

- deadlock victim,
- serialization failure,
- transient lock timeout,
- optimistic lock for internal idempotent operation,
- transient connection issue after safe rollback.

Usually not blindly retriable:

- unique constraint violation from user duplicate request,
- validation failure,
- business rule conflict,
- user edit conflict,
- non-idempotent external side effect already executed.

### 22.2 Retry boundary

Retry should wrap the whole transaction, not only the failing SQL statement.

Bad:

```java
try {
    repository.save(entity);
} catch (OptimisticLockException e) {
    repository.save(entity); // stale object, same transaction context, wrong
}
```

Better conceptual pattern:

```java
retryTemplate.execute(ctx -> transactionTemplate.execute(status -> {
    CaseFile c = repository.findById(id).orElseThrow();
    c.recomputeDerivedField();
    return null;
}));
```

### 22.3 Backoff

Use bounded retry:

- max attempt 2-5 depending use case,
- exponential backoff with jitter,
- log final failure with correlation id,
- avoid retry storm.

### 22.4 Idempotency

Before retrying, ask:

- If transaction ran twice, is final state correct?
- If HTTP request is retried by client, do we duplicate row/event/email?
- If message consumer retries, do we duplicate side effect?
- If commit succeeded but response failed, what happens?

Idempotency is not optional in distributed systems.

---

## 23. Case Study 1: Case Approval Race

### 23.1 Problem

Two officers approve/reject same case concurrently.

### 23.2 Bad design

```java
@Transactional
public void approve(Long caseId) {
    CaseFile c = repository.findById(caseId).orElseThrow();
    if (c.getStatus() != UNDER_REVIEW) {
        throw new BusinessException("Not under review");
    }
    c.setStatus(APPROVED);
}
```

Without `@Version`, second commit may silently overwrite first.

### 23.3 Better design with optimistic lock

```java
@Entity
class CaseFile {
    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    public void approve() {
        if (status != CaseStatus.UNDER_REVIEW) {
            throw new InvalidTransitionException();
        }
        status = CaseStatus.APPROVED;
    }
}
```

If both read version 5, only one update succeeds. The other gets conflict.

### 23.4 Better design with conditional update

```java
@Modifying
@Query("""
    update CaseFile c
       set c.status = 'APPROVED'
     where c.id = :id
       and c.status = 'UNDER_REVIEW'
""")
int approveIfUnderReview(Long id);
```

This is strong for simple state transitions.

### 23.5 Audit trail consideration

Audit insert must be atomic with state transition.

If using conditional update, ensure audit is inserted only when `updated == 1`.

```java
@Transactional
public void approve(Long id, Long actorId) {
    int updated = repository.approveIfUnderReview(id);
    if (updated == 0) throw new ConflictException();

    auditRepository.insert(id, actorId, "APPROVED");
}
```

---

## 24. Case Study 2: Assignment Queue

### 24.1 Problem

Multiple workers need to claim pending tasks without duplicate processing.

### 24.2 Bad design

```java
List<Task> tasks = taskRepository.findTop100ByStatus(PENDING);
for (Task task : tasks) {
    task.setStatus(PROCESSING);
}
```

Multiple workers can read same pending tasks.

### 24.3 Pessimistic lock approach

Conceptually:

```sql
select *
from task
where status = 'PENDING'
order by created_at
for update skip locked
fetch first 100 rows only
```

Then update to `PROCESSING` in same transaction.

### 24.4 JPA/Hibernate reality

`SKIP LOCKED` is vendor/provider-specific. You may need native query or Hibernate-specific hint.

### 24.5 Safer model

- Claim in small batch.
- Commit claim quickly.
- Process outside claim transaction.
- Record idempotency/attempt count.
- Use heartbeat/lease timeout for crashed worker.
- Use deterministic ordering.

---

## 25. Case Study 3: Officer Quota

### 25.1 Problem

Officer can have max 5 active assignments.

### 25.2 Bad design

```java
@Transactional
public void assign(Long officerId, Long caseId) {
    long active = assignmentRepository.countActive(officerId);
    if (active >= 5) throw new QuotaExceededException();
    assignmentRepository.save(new Assignment(officerId, caseId));
}
```

Concurrent transactions can both see `4` and insert, ending at `6`.

### 25.3 Better: quota row

Table:

```sql
create table officer_quota (
    officer_id bigint primary key,
    active_count int not null,
    max_count int not null
);
```

Atomic update:

```sql
update officer_quota
   set active_count = active_count + 1
 where officer_id = ?
   and active_count < max_count
```

If affected row `1`, insert assignment. If `0`, quota exceeded.

### 25.4 Why this is better

It transforms predicate invariant into row-level conflict.

---

## 26. Case Study 4: Duplicate Appeal

### 26.1 Rule

One decision can have at most one active appeal.

### 26.2 Correctness boundary

Use database unique constraint or partial unique index depending soft-delete semantics.

Simple:

```sql
alter table appeal add constraint uk_appeal_decision unique(decision_id);
```

If soft delete:

- PostgreSQL: partial unique index where deleted = false.
- Other DBs: generated column or alternative model.

### 26.3 Application flow

```java
@Transactional
public Long createAppeal(Long decisionId) {
    Appeal appeal = new Appeal(decisionId);
    try {
        em.persist(appeal);
        em.flush(); // fail early inside use case
        return appeal.getId();
    } catch (PersistenceException ex) {
        if (isUniqueViolation(ex)) {
            throw new ConflictException("Appeal already exists");
        }
        throw ex;
    }
}
```

Flush early can be useful to classify constraint violation before doing later work.

---

## 27. Designing for Invariants

Concurrency-safe design starts with invariant classification.

### 27.1 Entity-local invariant

Example:

```text
Case title must not be empty.
```

Handled by:

- domain method,
- Bean Validation,
- DB not null/check.

### 27.2 Row-level state invariant

Example:

```text
Case can transition UNDER_REVIEW -> APPROVED only once.
```

Handled by:

- `@Version`,
- conditional update,
- pessimistic lock if high contention.

### 27.3 Cross-row invariant

Example:

```text
Officer max 5 active assignments.
```

Handled by:

- quota row,
- serializable,
- constraint if expressible,
- parent row lock.

### 27.4 Cross-service invariant

Example:

```text
Case finalization requires document service, payment service, and notification service consistency.
```

Handled by:

- local transaction,
- outbox,
- saga,
- idempotency,
- reconciliation,
- not by database isolation alone.

### 27.5 Regulatory invariant

Example:

```text
Final decision must have immutable audit trail, actor, timestamp, previous state, and reason.
```

Handled by:

- atomic state update + audit insert,
- immutable audit table,
- database constraints,
- correlation id,
- append-only event/audit model,
- restricted update/delete.

---

## 28. JPA/Hibernate Specific Pitfalls

### 28.1 Assuming `findById` locks row

It does not, unless lock mode is used or database isolation/statement locks cause it.

```java
repository.findById(id)
```

is normally just a read.

### 28.2 Assuming `@Transactional` prevents concurrent update

It does not by itself. It opens transaction. Conflict protection depends on database isolation, lock/version/constraints.

### 28.3 Assuming persistence context gives fresh data

It gives identity consistency inside context, not freshness from database.

### 28.4 Bulk update bypasses version

JPQL bulk update/delete may bypass entity lifecycle and persistence context synchronization.

If you bulk update versioned entity, understand whether version is incremented and whether managed objects become stale.

### 28.5 Mixing entity mutation and native SQL update

Native SQL can update rows behind Hibernate's back.

After native/bulk update:

```java
em.clear();
```

may be necessary.

### 28.6 Lazy loading after conflict

After transaction rollback due to lock exception, managed objects and session state should not be reused as if clean.

### 28.7 Retrying inside same persistence context

A failed flush/commit often leaves transaction marked rollback-only. Retry must start new transaction and persistence context.

---

## 29. Observability for Concurrency

You cannot fix what you cannot see.

### 29.1 Application metrics

Track:

- optimistic lock failure count,
- pessimistic lock timeout count,
- deadlock count,
- serialization failure count,
- retry attempts,
- retry final failure,
- transaction duration,
- slow transaction count,
- SQL timeout count,
- affected-row-zero count for conditional update,
- queue claim conflict rate.

### 29.2 Logs

Include:

- correlation id,
- transaction/use case name,
- entity type/id,
- actor/user id,
- expected state,
- actual conflict type,
- retry attempt,
- SQLState/vendor error code,
- lock mode if relevant.

Example structured log fields:

```json
{
  "event": "case_transition_conflict",
  "caseId": 123,
  "expectedStatus": "UNDER_REVIEW",
  "targetStatus": "APPROVED",
  "actorId": 456,
  "correlationId": "req-abc",
  "reason": "affected_rows_zero"
}
```

### 29.3 Database monitoring

Monitor:

- lock waits,
- deadlock graphs,
- blocked sessions,
- long-running transactions,
- top SQL by lock wait,
- top SQL by elapsed time,
- row/table hot spots,
- index usage,
- transaction rollback rate.

### 29.4 Hibernate/Spring observability

Useful signals:

- SQL statement count,
- flush count,
- entity update count,
- connection acquisition time,
- transaction duration,
- exception classification,
- generated SQL for lock queries.

---

## 30. Testing Concurrency

### 30.1 Do not rely on H2 for concurrency correctness

H2 can be useful for fast tests, but concurrency, locking, isolation, SQL dialect, and constraint behavior can differ significantly from production DB.

For isolation/locking tests, use actual target database via Testcontainers or integration environment.

### 30.2 Testing lost update prevention

Pseudo-test:

```java
@Test
void concurrentUpdateShouldFailOneTransaction() throws Exception {
    Long id = createCase();

    CountDownLatch bothLoaded = new CountDownLatch(2);
    CountDownLatch proceed = new CountDownLatch(1);

    Future<?> f1 = executor.submit(() -> updateTitle(id, "A", bothLoaded, proceed));
    Future<?> f2 = executor.submit(() -> updateTitle(id, "B", bothLoaded, proceed));

    bothLoaded.await();
    proceed.countDown();

    int optimisticFailures = countOptimisticFailures(f1, f2);
    assertThat(optimisticFailures).isEqualTo(1);
}
```

Key point:

- force both transactions to read before either commits,
- then allow both to write,
- assert one fails with optimistic lock.

### 30.3 Testing quota race

Run N concurrent assignments and assert active count never exceeds quota.

### 30.4 Testing deadlock retry

Harder but possible by intentionally acquiring locks in opposite order. Use short lock timeout and assert retry behavior.

### 30.5 Testing serialization retry

Use serializable transaction with concurrent predicate updates. Assert one transaction retries and final invariant holds.

---

## 31. Design Patterns for Concurrency-Safe Persistence

### 31.1 Versioned aggregate

Use `@Version` on aggregate root.

Good for:

- user edits,
- state transition,
- entity-local invariants.

### 31.2 Guarded command update

Use `update ... where state = expected`.

Good for:

- workflow transition,
- idempotent command,
- hot path.

### 31.3 Quota/counter row

Convert cross-row predicate into single-row update.

Good for:

- max active assignment,
- capacity reservation,
- stock/quota.

### 31.4 Parent row lock

Lock aggregate root before child changes.

Good for:

- preventing child insert during finalization,
- maintaining aggregate-level invariant.

### 31.5 Unique constraint command

Let database enforce uniqueness.

Good for:

- idempotency key,
- one appeal per decision,
- unique business reference.

### 31.6 Outbox + idempotent consumer

For cross-system side effects.

Good for:

- event publish after DB commit,
- notification,
- integration sync,
- search index update.

### 31.7 Lease-based claiming

For worker processing.

Good for:

- batch workers,
- background job,
- async task table.

Fields:

```text
status
locked_by
locked_until
attempt_count
last_error
```

---

## 32. Anti-Patterns

### 32.1 “We use `@Transactional`, so concurrency is safe”

False. `@Transactional` gives atomicity and resource demarcation. It does not automatically protect every business invariant.

### 32.2 “READ_COMMITTED is enough for everything”

Often enough for simple CRUD, not enough for predicate invariants and lost update without version/lock/constraint.

### 32.3 “Just use SERIALIZABLE everywhere”

May reduce throughput, increase aborts, require retry, and still does not solve external side effect/idempotency problem.

### 32.4 “Just add pessimistic lock”

Can create deadlocks/lock waits and may lock wrong row if invariant is predicate/cross-row.

### 32.5 “Application pre-check prevents duplicate”

False under concurrency. Use database constraint.

### 32.6 “Auto-retry all conflicts”

Dangerous for user decisions and external side effects.

### 32.7 “Bulk update is same as entity update”

False. Bulk update bypasses persistence context and entity lifecycle.

### 32.8 “Concurrency bug is rare, so ignore”

Concurrency bugs are often rare until production load, batch job, retry storm, or multi-node deployment makes them frequent.

---

## 33. Practical Checklist

### 33.1 For every write use case

Ask:

- What invariant must hold after commit?
- Is invariant single-row, multi-row, cross-table, or cross-service?
- Can database constraint enforce it?
- Do we need `@Version`?
- Do we need conditional update?
- Do we need pessimistic lock?
- Do we need higher isolation?
- Is retry safe?
- Are external side effects inside transaction?
- What happens if request is duplicated?
- What happens if commit succeeds but response fails?

### 33.2 For every query used for validation

Ask:

- Is this query only for UX or correctness?
- If another transaction commits after this query, can invariant break?
- Should validation be repeated at write time?
- Should the write be conditional?
- Should database constraint enforce it?

### 33.3 For every lock

Ask:

- What exact row/predicate is locked?
- Does query use index?
- How long is lock held?
- Can deadlock happen?
- Is lock order deterministic?
- What exception occurs on timeout?
- Is retry implemented?

### 33.4 For every retry

Ask:

- Is operation idempotent?
- Are side effects duplicated?
- Does retry open a new transaction?
- Is backoff bounded?
- Are metrics/logs emitted?

---

## 34. Scenario Latihan

### Scenario 1 — Duplicate Appeal

Requirement:

```text
A decision can have at most one active appeal.
```

Question:

- Would you use application pre-check, unique constraint, optimistic locking, or serializable transaction?
- How would soft delete affect the design?
- How would you map database error into API response?

Expected direction:

- database uniqueness as correctness boundary,
- application pre-check only for UX,
- partial unique index/generated column depending DB,
- handle unique violation as 409 conflict.

### Scenario 2 — Officer Assignment Quota

Requirement:

```text
Officer can have at most 5 active cases.
```

Question:

- Why is `countActive()` then insert unsafe?
- How can quota row solve this?
- Would `@Version` on Assignment help?

Expected direction:

- count predicate race causes phantom/write skew,
- quota row converts invariant into atomic row update,
- `@Version` on each assignment does not protect cross-row max count.

### Scenario 3 — Finalize Case While Finding Is Inserted

Requirement:

```text
Case cannot be finalized if unresolved mandatory finding exists.
```

Question:

- What can go wrong if finalization and finding insertion happen concurrently?
- Which row should be locked?
- Would serializable be acceptable?

Expected direction:

- write skew possible,
- lock case aggregate root when inserting mandatory finding and when finalizing,
- or use serializable with retry,
- possibly redesign lifecycle: no new mandatory finding after finalization starts.

### Scenario 4 — Worker Queue

Requirement:

```text
Multiple workers process pending integration events.
Each event must be processed at least once but side effect must be idempotent.
```

Question:

- How to claim rows safely?
- What if worker crashes after claim?
- What if event is processed twice?

Expected direction:

- claim with lock/skip locked or conditional update,
- lease timeout,
- attempt count,
- idempotent external call or inbox/dedup table,
- retry with backoff.

---

## 35. Summary

Isolation level is not an academic setting. It is a production correctness tool.

Key takeaways:

1. `@Transactional` does not automatically make concurrent business logic safe.
2. `READ_COMMITTED` prevents dirty read but still allows many business-level races.
3. Persistence context identity is not the same as database freshness.
4. `@Version` is a strong default for mutable business entities.
5. Conditional update is often the cleanest model for state transition and quota-like operations.
6. Database constraints are the strongest protection for uniqueness and structural invariants.
7. Pessimistic locking is useful but must be designed around lock order, transaction duration, and index usage.
8. Serializable isolation can protect predicate invariants but requires retry and performance testing.
9. Cross-row and cross-service invariants need explicit design, not hope.
10. Concurrency failures must be classified, observed, and tested against the real database.

The senior/staff engineer mindset is not “which isolation level should I use?” but:

> What invariant am I protecting, what concurrent interleaving can break it, and which combination of constraint, version, lock, isolation, conditional write, retry, and idempotency makes the invariant true under production behavior?

---

## 36. Referensi Resmi dan Lanjutan

- Jakarta Persistence 3.2 Specification — entity versioning, locking, query, persistence context.
- Jakarta Persistence `LockModeType` API — optimistic and pessimistic lock modes.
- Jakarta Transactions 2.0 Specification — transaction manager, resource manager, application, and application server contracts.
- Spring Framework Reference — declarative transaction management, propagation, isolation, rollback behavior.
- Hibernate ORM User Guide — locking, optimistic/pessimistic strategy, session/persistence context, SQL generation.
- Vendor database documentation for exact isolation behavior:
  - Oracle Database Concepts / SQL Language Reference,
  - PostgreSQL Transaction Isolation,
  - MySQL InnoDB Transaction Model,
  - SQL Server Transaction Locking and Row Versioning.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 011 — Transaction Boundary Design in Real Applications](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-011.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 013 — Optimistic Locking, Versioning, and State Machine Persistence](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-013.md)

</div>