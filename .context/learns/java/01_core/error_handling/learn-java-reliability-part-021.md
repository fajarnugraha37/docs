# learn-java-reliability-part-021.md

# Part 021 — Data Reliability and Persistence Failure

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability untuk Java Software Engineer  
> Status: Part 021 / 030  
> Materi sebelumnya: Part 020 — Reliability Patterns for External Integrations  
> Materi berikutnya: Part 022 — Consistency, Compensation, and Distributed Failure

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas reliability ketika sistem berinteraksi dengan dependency eksternal: HTTP API, token, rate limit, timeout, retry, circuit breaker, bulkhead, dan fallback.

Bagian ini masuk ke boundary yang sering terlihat “lebih aman” karena berada di dalam kontrol kita sendiri: **database dan persistence layer**.

Namun di production, database bukan komponen pasif yang selalu berhasil ketika query benar. Database adalah sistem concurrent, transactional, resource-bound, failure-prone, dan stateful. Karena itu, failure persistence tidak boleh diperlakukan sebagai satu kategori generik seperti:

```text
Database error -> HTTP 500 -> log stack trace -> selesai
```

Cara berpikir seperti itu terlalu dangkal.

Di sistem enterprise, persistence failure bisa berarti banyak hal yang sangat berbeda:

- request user melanggar unique constraint;
- optimistic lock gagal karena state sudah berubah;
- deadlock terjadi akibat urutan locking tidak konsisten;
- lock timeout terjadi karena transaksi lain terlalu lama memegang resource;
- pool habis karena query lambat atau leak connection;
- database unavailable;
- read replica tertinggal;
- commit berhasil tapi response ke aplikasi gagal;
- rollback terjadi tapi side effect eksternal sudah terlanjur dikirim;
- storage penuh;
- LOB segment membengkak;
- migration DDL tertahan lock;
- query sukses tapi membaca data stale;
- transaction isolation terlalu lemah untuk invariant bisnis tertentu.

Target bagian ini adalah membangun mental model dan desain praktis agar kamu mampu menjawab pertanyaan berikut:

> Ketika persistence layer gagal, apa arti kegagalan itu terhadap correctness, retryability, user response, observability, dan recovery?

---

## 1. Core Problem

Persistence failure sering disederhanakan menjadi “DB lagi error”. Padahal, database failure harus dibaca sebagai kombinasi dari lima dimensi:

```text
1. Apa yang gagal?
2. Pada tahap mana gagal?
3. Apakah ada state yang sudah berubah?
4. Apakah operasi aman diulang?
5. Siapa yang dapat memperbaiki?
```

Contoh:

```text
INSERT user gagal karena duplicate email
```

Ini bukan incident database. Ini kemungkinan conflict bisnis atau validation gap.

```text
UPDATE case gagal karena optimistic lock version mismatch
```

Ini bukan sekadar error teknis. Ini conflict state akibat concurrent modification.

```text
Transaction gagal commit karena connection lost setelah COMMIT dikirim
```

Ini bukan failure biasa. Ini **unknown outcome**: aplikasi tidak tahu apakah DB sudah commit atau belum.

```text
SELECT lambat hingga pool exhausted
```

Ini bukan hanya query lambat. Ini saturation yang dapat menyebabkan cascading failure ke seluruh service.

Karena itu, persistence failure handling harus menjawab:

- apakah response ke client harus `400`, `404`, `409`, `422`, `429`, `503`, atau `500`?
- apakah retry aman?
- apakah retry harus satu statement, satu method, atau seluruh transaction?
- apakah failure perlu alert?
- apakah perlu compensation?
- apakah perlu reconciliation?
- apakah perlu circuit breaker terhadap database?
- apakah failure ini menunjukkan bug, data defect, capacity incident, atau expected conflict?

---

## 2. Mental Model: Database Is a Concurrent State Machine

Cara paling berguna memahami database dalam konteks reliability adalah melihatnya sebagai **concurrent state machine**.

```text
Command masuk
  -> validation
  -> read current state
  -> decide transition
  -> acquire locks / verify version
  -> mutate rows
  -> enforce constraints
  -> commit / rollback
  -> release locks
```

Setiap tahap punya failure mode berbeda.

```text
[before transaction]
  - invalid input
  - missing required data
  - impossible command

[during read]
  - timeout
  - stale replica read
  - connection unavailable
  - inconsistent read due to isolation

[during mutation]
  - constraint violation
  - deadlock
  - lock timeout
  - optimistic lock failure
  - disk/segment/resource error

[during commit]
  - serialization failure
  - connection drop
  - unknown commit outcome

[after commit]
  - response lost
  - event publish failed
  - cache update failed
  - audit write failed if outside transaction
```

Top-tier engineer tidak hanya bertanya:

> Exception apa yang dilempar?

Tapi:

> Pada titik state machine mana failure terjadi, dan state apa yang mungkin sudah berubah?

---

## 3. Persistence Failure Classification

Persistence failure dapat diklasifikasikan ke dalam beberapa kategori besar.

### 3.1 Client-Correctable Data Failure

Failure yang terjadi karena command/request tidak valid terhadap aturan data.

Contoh:

- required field missing;
- invalid date range;
- reference ID tidak ditemukan;
- duplicate business key;
- foreign key target tidak valid;
- value terlalu panjang.

Biasanya response:

```text
400 Bad Request
404 Not Found
409 Conflict
422 Unprocessable Content
```

Tergantung kontrak API.

Karakteristik:

- tidak perlu retry otomatis;
- client/user perlu mengubah input;
- bukan incident infrastructure;
- tidak perlu alert high severity;
- perlu log minimal atau info-level jika expected.

### 3.2 Concurrency Conflict

Failure karena dua atau lebih operasi berusaha mengubah state yang beririsan.

Contoh:

- optimistic lock version mismatch;
- stale update;
- unique constraint race;
- serialization failure;
- deadlock;
- lock timeout.

Karakteristik:

- sebagian bisa diretry;
- sebagian harus dikembalikan sebagai conflict;
- harus dibedakan antara **expected contention** dan **bug desain locking**;
- retry harus dilakukan pada boundary yang benar.

### 3.3 Transient Resource Failure

Failure karena resource database sementara tidak tersedia.

Contoh:

- transient connection failure;
- pool acquisition timeout;
- temporary network glitch;
- failover sedang terjadi;
- read replica temporarily unavailable;
- database overload sementara.

Karakteristik:

- mungkin retryable;
- retry harus dibatasi;
- bisa memicu circuit breaker/load shedding;
- perlu metrics dan alert jika rate naik.

### 3.4 Non-Transient Infrastructure Failure

Failure yang tidak akan selesai hanya dengan retry cepat.

Contoh:

- schema mismatch;
- column missing;
- permission revoked;
- tablespace/storage full;
- invalid SQL generated by code;
- migration corrupt;
- incompatible driver;
- wrong credentials;
- database down lama.

Karakteristik:

- retry biasanya memperburuk beban;
- harus fail fast;
- perlu alert operator;
- response umumnya `500` atau `503`;
- butuh remediation manual/deployment/config fix.

### 3.5 Unknown Outcome Failure

Failure paling berbahaya: aplikasi tidak tahu apakah perubahan sudah commit.

Contoh:

```text
App sends COMMIT
Network drops before commit result received
```

Kemungkinan:

```text
A. DB menerima COMMIT dan berhasil commit
B. DB menerima COMMIT tapi gagal
C. DB tidak menerima COMMIT
D. app tidak tahu hasilnya
```

Karakteristik:

- retry buta dapat menyebabkan duplicate mutation;
- butuh idempotency key / business key / reconciliation;
- response sebaiknya tidak mengklaim sukses palsu;
- operator harus bisa menemukan final state.

---

## 4. Spring DataAccessException: Kenapa Hierarchy Ini Penting

Spring menyediakan `DataAccessException` sebagai root hierarchy untuk exception persistence. Tujuannya adalah agar kode aplikasi dapat merespons jenis error tanpa bergantung langsung pada API persistence spesifik seperti JDBC.

Spring mendokumentasikan bahwa hierarchy ini memungkinkan user code menemukan dan menangani jenis error tanpa mengetahui detail data access API yang digunakan. Spring juga membedakan transient dan non-transient data access exceptions.

Secara konseptual:

```text
DataAccessException
  ├── TransientDataAccessException
  ├── NonTransientDataAccessException
  ├── RecoverableDataAccessException
  └── UncategorizedDataAccessException
```

Maknanya:

| Kategori | Meaning | Retry? | Contoh |
|---|---|---:|---|
| Transient | Operasi yang sama mungkin berhasil jika dicoba lagi | Mungkin | deadlock, transient resource issue |
| Non-transient | Retry operasi yang sama kemungkinan tetap gagal kecuali penyebab diperbaiki | Tidak langsung | bad SQL, constraint violation |
| Recoverable | Ada langkah recovery eksplisit sebelum retry | Mungkin setelah recovery | reconnect, resource recovery |
| Uncategorized | Spring tidak bisa klasifikasikan dengan jelas | Jangan asumsi | vendor-specific error |

Poin penting:

> Jangan menelan `DataAccessException` sebagai satu blob. Hierarchy-nya adalah sinyal reliability.

Namun, jangan juga mempercayai hierarchy secara buta. Dalam sistem enterprise, kamu sering tetap perlu membaca:

- SQLState;
- vendor error code;
- constraint name;
- operation type;
- transaction boundary;
- apakah command idempotent;
- apakah failure terjadi sebelum atau sesudah side effect.

---

## 5. Transaction Rollback Is Not the Same as System Recovery

Di Spring, default rollback behavior penting untuk dipahami.

Default-nya:

```text
RuntimeException -> rollback
Error            -> rollback
Checked Exception -> tidak rollback kecuali dikonfigurasi
```

Spring documentation menjelaskan checked exception tidak menyebabkan rollback dalam default configuration, tetapi rollback rules dapat dikonfigurasi eksplisit.

Contoh:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) throws BusinessCheckedException {
    Case c = caseRepository.findById(command.caseId())
        .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

    c.approve(command.approverId());

    if (someBusinessCondition()) {
        throw new BusinessCheckedException("approval cannot continue");
    }
}
```

Jika `BusinessCheckedException` adalah checked exception dan tidak dikonfigurasi rollback, perubahan entity bisa tetap commit.

Lebih aman:

```java
@Transactional(rollbackFor = BusinessCheckedException.class)
public void approveCase(ApproveCaseCommand command) throws BusinessCheckedException {
    // mutation logic
}
```

Atau gunakan unchecked domain exception untuk failure yang memang harus rollback:

```java
public final class ApprovalRejectedException extends RuntimeException {
    public ApprovalRejectedException(String message) {
        super(message);
    }
}
```

Namun jangan salah paham:

```text
Rollback transaction != seluruh sistem kembali seperti semula
```

Karena mungkin sebelum rollback terjadi sudah ada:

- HTTP call ke sistem eksternal;
- email terkirim;
- message dikirim ke broker;
- file ditulis;
- cache diubah;
- audit non-transactional ditulis;
- distributed lock dilepas.

Karena itu, transaction safety harus dibaca bersama:

```text
transaction boundary + side effect boundary + retry boundary + observability boundary
```

---

## 6. Constraint Violation: Validation, Conflict, atau Bug?

Constraint violation sering dianggap “error database”, padahal constraint adalah salah satu mekanisme paling penting untuk menjaga invariant.

Contoh constraint:

```sql
ALTER TABLE users ADD CONSTRAINT uk_users_email UNIQUE (email);
ALTER TABLE orders ADD CONSTRAINT chk_amount_positive CHECK (amount > 0);
ALTER TABLE case_attachments ADD CONSTRAINT fk_attachment_case FOREIGN KEY (case_id) REFERENCES cases(id);
```

Jika constraint violation terjadi, artinya salah satu dari ini benar:

1. input belum divalidasi dengan benar;
2. race condition terjadi;
3. aplikasi punya bug invariant;
4. data existing corrupt;
5. database constraint lebih benar daripada asumsi aplikasi.

### 6.1 Duplicate Unique Key

Contoh:

```text
User creates account with email existing@example.com
```

Kemungkinan mapping:

```text
409 Conflict
```

Jika duplicate terjadi karena request retry dengan idempotency key yang sama, response bisa saja mengembalikan result lama.

Jika duplicate terjadi karena dua request bersamaan membuat resource sama, response conflict lebih tepat daripada 500.

### 6.2 Foreign Key Violation

Contoh:

```text
Create attachment for case_id that does not exist
```

Kemungkinan mapping:

```text
404 Not Found, jika parent resource memang tidak ada
409 Conflict, jika parent state berubah/hilang saat operasi
422, jika command referentially invalid
```

Jangan otomatis menjadikan FK violation sebagai 500. Tetapi jika FK violation terjadi karena aplikasi seharusnya sudah memastikan parent ada dalam transaction yang sama, itu bisa menjadi invariant bug.

### 6.3 Check Constraint Violation

Contoh:

```text
amount <= 0
```

Jika user input buruk:

```text
400 / 422
```

Jika domain logic menghasilkan nilai buruk:

```text
500 + invariant breach alert
```

### 6.4 Constraint Name sebagai Signal

Dalam production-grade system, constraint name harus dirancang agar bisa dipetakan.

Buruk:

```sql
SYS_C0089123
```

Baik:

```sql
uk_user_email
fk_attachment_case
chk_payment_amount_positive
```

Dengan nama constraint yang stabil, exception translator bisa melakukan mapping:

```java
public ApiError translateConstraintViolation(String constraintName) {
    return switch (constraintName) {
        case "uk_user_email" -> ApiError.conflict("USER_EMAIL_ALREADY_EXISTS");
        case "fk_attachment_case" -> ApiError.notFound("CASE_NOT_FOUND");
        case "chk_payment_amount_positive" -> ApiError.validation("PAYMENT_AMOUNT_INVALID");
        default -> ApiError.internal("DATA_INTEGRITY_VIOLATION");
    };
}
```

---

## 7. Optimistic Locking and Stale Updates

Optimistic locking dipakai ketika kita mengizinkan concurrent reads, tetapi ingin mencegah lost update saat write.

Model umum:

```text
row: case_id=123, status=OPEN, version=7

User A reads version 7
User B reads version 7
User A updates status -> APPROVED where version=7, new version=8
User B updates status -> REJECTED where version=7
  -> update count 0 / optimistic lock failure
```

Ini bukan database outage. Ini conflict bisnis.

Response yang umum:

```text
409 Conflict
```

Dengan body:

```json
{
  "type": "https://example.com/problems/stale-resource",
  "title": "Resource was modified by another transaction",
  "status": 409,
  "code": "CASE_STALE_VERSION",
  "detail": "The case has changed since it was loaded. Refresh and try again.",
  "resourceId": "123",
  "expectedVersion": 7
}
```

### 7.1 Kapan Auto-Retry Optimistic Lock Aman?

Auto-retry optimistic lock tidak selalu aman.

Aman jika:

- command bersifat commutative;
- tidak ada keputusan user berdasarkan state lama;
- mutation deterministik terhadap state terbaru;
- retry tidak mengubah makna bisnis.

Tidak aman jika:

- user memilih action berdasarkan data yang dia lihat;
- approval/rejection harus berdasarkan versi tertentu;
- state transition punya konsekuensi legal/regulatory;
- retry dapat mengabaikan conflict manusia.

Contoh tidak aman:

```text
Officer A melihat case status OPEN dan approve.
Officer B lebih dulu reject.
Auto-retry approval terhadap state REJECTED bisa melanggar workflow.
```

Jadi optimistic lock failure sering lebih baik dikembalikan sebagai conflict daripada diretry diam-diam.

---

## 8. Deadlock: Retryable Symptom, Design Smell Jika Sering

Deadlock terjadi ketika transaksi saling menunggu lock secara melingkar.

Contoh:

```text
Tx A locks case 1
Tx B locks case 2
Tx A tries to lock case 2
Tx B tries to lock case 1
=> deadlock
```

Database biasanya mendeteksi deadlock lalu membatalkan salah satu transaksi.

Deadlock sering retryable, tetapi jika sering terjadi, itu bukan sekadar transient noise. Itu tanda desain:

- lock ordering tidak konsisten;
- transaction terlalu panjang;
- query menyentuh terlalu banyak row;
- index buruk sehingga lock range melebar;
- batch update tidak deterministik;
- ada hidden lock dari FK/index;
- isolation level terlalu kuat untuk workload;
- application-level workflow terlalu banyak menggabungkan mutation.

### 8.1 Retry Deadlock Harus Retry Seluruh Transaction

Untuk banyak database, serialization/deadlock retry harus dilakukan pada seluruh transaction, bukan statement terakhir saja.

Buruk:

```java
try {
    repository.updateA();
    repository.updateB();
} catch (DeadlockLoserDataAccessException e) {
    repository.updateB(); // salah: hanya retry sebagian
}
```

Lebih benar:

```java
retryTemplate.execute(context -> {
    return transactionTemplate.execute(status -> {
        updateA();
        updateB();
        return null;
    });
});
```

Dengan syarat:

- command idempotent;
- tidak ada side effect eksternal di tengah transaction;
- retry memiliki max attempt;
- memakai backoff dan jitter;
- exception benar-benar diklasifikasikan retryable.

### 8.2 Lock Ordering Rule

Salah satu pencegahan paling sederhana:

```text
Jika perlu lock banyak row/entity, lock dalam urutan deterministik.
```

Contoh:

```java
List<Long> ids = command.caseIds().stream()
    .sorted()
    .toList();

List<Case> cases = caseRepository.findAllByIdForUpdate(ids);
```

Jangan lock berdasarkan urutan input user yang bisa berbeda antar request.

---

## 9. Lock Timeout and Resource Busy

Lock timeout berbeda dari deadlock.

Deadlock:

```text
A menunggu B, B menunggu A
```

Lock timeout:

```text
A menunggu B terlalu lama
```

Contoh:

- long transaction memegang row lock;
- report query tidak sengaja memblokir mutation;
- DDL menunggu lock;
- batch job memproses terlalu banyak row dalam satu transaction;
- `SELECT FOR UPDATE NOWAIT` gagal karena row sedang locked.

Mapping tergantung konteks:

| Konteks | Response | Retry? |
|---|---:|---|
| User action conflict dengan proses lain | 409 | manual retry mungkin |
| System overloaded/DB saturated | 503 | client retry dengan backoff |
| Batch worker lock contention | internal retry | ya, terbatas |
| DDL migration resource busy | fail deployment | operator fix |

### 9.1 Jangan Memperpanjang Timeout Tanpa Diagnosis

Anti-pattern:

```text
Query sering lock timeout -> naikkan timeout dari 5s ke 60s
```

Ini sering hanya mengubah failure cepat menjadi thread starvation lambat.

Lebih baik diagnosis:

- siapa memegang lock?
- berapa lama transaction berjalan?
- apakah ada missing index?
- apakah batch terlalu besar?
- apakah mutation order konsisten?
- apakah user request memegang transaction saat melakukan HTTP call?

---

## 10. Connection Pool Exhaustion

Connection pool exhaustion bukan hanya “butuh tambah pool”.

Gejalanya:

```text
Cannot acquire JDBC connection
Pool timeout
HikariPool - Connection is not available, request timed out
```

Penyebab umum:

- query lambat;
- transaction terlalu panjang;
- connection leak;
- pool size terlalu kecil;
- pool size terlalu besar sehingga DB overload;
- thread pool lebih besar dari connection pool;
- retry storm;
- report endpoint memakai OLTP DB;
- N+1 query;
- lock contention;
- external HTTP call dilakukan di dalam transaction;
- batch job memakan semua connection.

### 10.1 Pool Size Bukan Kapasitas Gratis

Jika pool dinaikkan:

```text
app concurrency naik
  -> DB active sessions naik
  -> CPU/IO/lock contention naik
  -> latency naik
  -> connection hold time naik
  -> pool tetap habis
```

Kadang solusi yang benar bukan menaikkan pool, tetapi:

- menurunkan concurrency;
- mempercepat query;
- memperpendek transaction;
- membatasi endpoint mahal;
- memisahkan read/report workload;
- memakai bulkhead untuk batch;
- memakai queue;
- memperbaiki index;
- menambahkan timeout;
- load shedding.

### 10.2 Alignment Thread Pool dan DB Pool

Misal:

```text
HTTP worker threads: 200
DB pool: 20
External call timeout: 30s
```

Jika sebagian besar request butuh DB, 180 thread bisa menunggu connection. Jika request tidak punya timeout jelas, service bisa terlihat hidup tapi tidak bisa melayani.

Rule praktis:

```text
DB-bound concurrency harus dikontrol eksplisit.
```

Jangan biarkan semua endpoint bebas berebut pool yang sama.

---

## 11. Transaction Isolation Anomalies

Transaction isolation menentukan anomaly apa yang mungkin terjadi.

Beberapa anomaly penting:

| Anomaly | Meaning |
|---|---|
| Dirty read | membaca data uncommitted |
| Non-repeatable read | membaca row yang sama dua kali tapi nilainya berubah |
| Phantom read | query range kedua melihat row tambahan/hilang |
| Lost update | dua update saling menimpa |
| Write skew | dua transaksi valid sendiri-sendiri, tapi bersama melanggar invariant |

Masalah reliability sering muncul karena engineer mengira:

```text
Saya pakai @Transactional, berarti invariant aman.
```

Belum tentu.

Contoh write skew:

```text
Invariant: at least one approver must remain active

Tx A reads: approver A active, approver B active
Tx B reads: approver A active, approver B active
Tx A disables approver A
Tx B disables approver B
Both commit
Result: no active approver
```

Masing-masing transaksi merasa valid berdasarkan snapshot-nya.

Solusi bisa berupa:

- stronger isolation;
- explicit locking;
- constraint redesign;
- aggregate boundary redesign;
- serialized command processing;
- state machine guard dengan version;
- materialized invariant row;
- advisory lock / application lock;
- unique/partial index jika database mendukung.

---

## 12. Read Replica Lag and Stale Reads

Dalam arsitektur read/write split, write biasanya ke primary, read bisa ke replica.

Failure mode:

```text
Client creates resource
DB primary commits
Client immediately reads resource
Read goes to replica
Replica belum catch up
Client receives 404
```

Ini bukan not found sebenarnya. Ini read-after-write inconsistency.

Strategi:

- read-your-write dari primary untuk request tertentu;
- sticky session / consistency token;
- return created representation dari write response;
- delay/retry read dengan bounded wait;
- expose eventual consistency kepada client;
- jangan gunakan replica untuk workflow decision yang membutuhkan freshness kuat.

Mapping error harus hati-hati. Jangan selalu menganggap 404 setelah write sebagai resource tidak ada.

---

## 13. Persistence Failure During Shutdown

Shutdown memperbesar risiko persistence failure karena ada deadline.

Skenario:

```text
SIGTERM received
App stops accepting new HTTP requests
Existing request still processing
Request opens transaction
Transaction mutates DB
Shutdown deadline approaches
Connection pool starts closing
Transaction interrupted / connection closed
```

Pertanyaan penting:

- apakah transaction sempat commit?
- apakah client menerima response?
- apakah side effect eksternal sudah terjadi?
- apakah retry client akan duplicate?
- apakah audit/outbox ditulis?
- apakah shutdown hook menutup pool terlalu cepat?

Rule:

```text
During shutdown, stop admission before closing persistence resources.
```

Urutan sehat:

```text
1. Mark app as draining / not ready
2. Stop accepting new work
3. Stop polling queue/scheduler
4. Let bounded in-flight work finish
5. Prevent new transactions from starting
6. Wait for active transactions within deadline
7. Close connection pool
8. Exit
```

Jangan menutup datasource saat request/worker masih aktif.

---

## 14. Large Object, Storage Pressure, and Persistence Capacity Failure

Di sistem enterprise, persistence failure sering bukan query syntax atau constraint, tapi storage/capacity.

Contoh:

- audit trail CLOB/BLOB membengkak;
- table tumbuh tapi index juga tumbuh lebih besar;
- delete row tidak langsung mengembalikan space ke OS/storage;
- undo/redo/temp usage meledak;
- transaction besar membuat log/undo pressure;
- tablespace penuh;
- vacuum/segment shrink/maintenance tertunda;
- LOB retention membuat space tidak turun setelah delete.

Mental model penting:

```text
Deleting rows != instantly reducing allocated storage
```

Database sering mempertahankan allocated blocks/segments untuk reuse internal. Karena itu, operational recovery untuk storage pressure bisa mencakup:

- stop growth source;
- archive old data;
- purge dengan batch kecil;
- rebuild/shrink/move segment;
- reclaim LOB segment;
- resize tablespace/datafile;
- add storage sebagai emergency action;
- review retention policy;
- partition table by time;
- move audit/report workload.

Application-level design juga harus membantu:

- batasi payload audit;
- compress jika layak;
- jangan simpan full serialized object tanpa retention logic;
- pisahkan hot table dan audit table;
- gunakan partitioning untuk purge;
- buat backpressure saat storage warning;
- expose metric growth rate.

---

## 15. Exception Translation for Persistence Layer

Persistence exception harus diterjemahkan pada boundary yang tepat.

Lapisan umum:

```text
JDBC / JPA / Hibernate / Driver exception
  -> Spring DataAccessException / JpaSystemException
  -> Application persistence failure classification
  -> Domain/application exception
  -> API error contract / worker decision
```

Jangan lakukan ini:

```java
catch (Exception e) {
    throw new RuntimeException("Database failed");
}
```

Masalah:

- constraint name hilang;
- SQLState hilang;
- retryability hilang;
- domain meaning hilang;
- observability buruk;
- semua jadi 500.

Lebih baik:

```java
public final class PersistenceFailureClassifier {

    public PersistenceFailure classify(Throwable error) {
        if (isOptimisticLock(error)) {
            return PersistenceFailure.conflict("STALE_VERSION", false);
        }

        if (isUniqueViolation(error, "uk_case_reference_no")) {
            return PersistenceFailure.conflict("CASE_REFERENCE_ALREADY_EXISTS", false);
        }

        if (isDeadlock(error)) {
            return PersistenceFailure.transientFailure("DB_DEADLOCK", true);
        }

        if (isConnectionPoolTimeout(error)) {
            return PersistenceFailure.transientFailure("DB_POOL_EXHAUSTED", true);
        }

        if (isBadSql(error)) {
            return PersistenceFailure.internalBug("DB_BAD_SQL", false);
        }

        return PersistenceFailure.unknown("DB_UNKNOWN_FAILURE", false);
    }
}
```

Kemudian API mapper:

```java
public ProblemDetail toProblem(PersistenceFailure failure) {
    return switch (failure.kind()) {
        case CONFLICT -> problem(409, failure.code(), "Data conflict");
        case VALIDATION -> problem(422, failure.code(), "Invalid data");
        case TRANSIENT -> problem(503, failure.code(), "Database temporarily unavailable");
        case INTERNAL_BUG -> problem(500, failure.code(), "Internal persistence error");
        case UNKNOWN -> problem(500, failure.code(), "Unexpected persistence failure");
    };
}
```

---

## 16. Retry Decision Matrix for Persistence Failure

Tidak semua DB error boleh diretry.

| Failure | Retry? | Boundary | Notes |
|---|---:|---|---|
| Unique constraint due to duplicate user input | No | none | return conflict/validation |
| Unique constraint due to idempotency key duplicate | Maybe return existing result | idempotency lookup | not blind retry |
| Optimistic lock | Usually no for user decision | user refresh | auto-retry only if safe |
| Deadlock | Yes, limited | whole transaction | fix lock ordering if frequent |
| Serialization failure | Yes | whole transaction | retry entire decision logic |
| Lock timeout | Maybe | whole transaction or command | depends on cause |
| Connection acquisition timeout | Maybe but risky | outer command | can amplify overload |
| Bad SQL / missing column | No | none | deploy/schema bug |
| FK violation | Usually no | none | not found/conflict or bug |
| Storage full | No quick retry | none | operator intervention |
| Unknown commit outcome | Not blind | idempotency/reconciliation | inspect final state |

Golden rule:

```text
Retry persistence operation only if:
1. failure is transient,
2. operation is idempotent or guarded by key/version,
3. retry boundary includes all decision logic,
4. side effects are not duplicated,
5. retry count and budget are bounded.
```

---

## 17. Idempotency and Database Constraints

Database constraints are your friend for idempotency.

Example table:

```sql
CREATE TABLE idempotency_record (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    request_hash VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_body CLOB,
    resource_id VARCHAR(64),
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL
);
```

Flow:

```text
1. Client sends Idempotency-Key
2. App attempts insert idempotency record
3. If insert succeeds, this request owns execution
4. If duplicate key:
   - same request hash -> return stored/in-progress result
   - different request hash -> 409 conflict
5. Business mutation happens once
6. Store final response/resource reference
```

This converts unknown outcome/retry problem into lookup problem.

Without this, retry after timeout can duplicate:

```text
POST /payments
  -> DB commit succeeds
  -> response lost
client retries
  -> second payment created
```

With idempotency:

```text
POST /payments with key K
  -> payment P created
  -> response lost
client retries with key K
  -> return payment P
```

---

## 18. Persistence Observability

Persistence error handling must create evidence.

Log fields:

```text
correlation_id
trace_id
operation
entity_type
entity_id
transaction_name
exception_class
sql_state
vendor_error_code
constraint_name
retryable
attempt
isolation_level
pool_active
pool_idle
pool_pending
query_duration_ms
lock_wait_ms
rows_affected
```

Metrics:

```text
db_error_total{category="constraint"}
db_error_total{category="deadlock"}
db_error_total{category="lock_timeout"}
db_error_total{category="pool_timeout"}
db_error_total{category="bad_sql"}
db_transaction_retry_total
db_transaction_retry_exhausted_total
db_pool_active
db_pool_pending
db_query_duration_seconds
db_lock_wait_seconds
db_transaction_duration_seconds
db_storage_used_bytes
db_storage_growth_bytes_per_day
```

Alert examples:

| Signal | Possible Meaning |
|---|---|
| pool pending > 0 sustained | saturation / leak / slow query |
| deadlock spike | locking design regression |
| lock timeout spike | long transaction / missing index |
| constraint violation spike | client bug / validation regression / attack |
| bad SQL any occurrence | deployment/schema mismatch |
| storage growth abnormal | retention/audit runaway |
| retry exhausted | dependency no longer transient |

Log once rule tetap berlaku:

```text
Log detailed persistence failure at boundary that owns handling.
Do not log same stack trace at repository, service, controller, filter, and global handler.
```

---

## 19. API Mapping Examples

### 19.1 Duplicate Business Key

```text
DB: unique constraint uk_user_email violated
Application: USER_EMAIL_ALREADY_EXISTS
HTTP: 409 Conflict
Retry: no
Alert: no unless spike
```

### 19.2 Optimistic Lock

```text
DB/JPA: OptimisticLockException
Application: CASE_STALE_VERSION
HTTP: 409 Conflict
Retry: user refresh or safe command retry only
Alert: no unless abnormal rate
```

### 19.3 DB Pool Exhausted

```text
DB pool: connection acquisition timeout
Application: DB_SATURATED
HTTP: 503 Service Unavailable
Retry: client with backoff, server avoid local retry storm
Alert: yes
```

### 19.4 Deadlock

```text
DB: deadlock victim
Application: DB_DEADLOCK_RETRYABLE
Worker/API internal: retry whole transaction up to small max
If exhausted: 503 or internal failure
Alert: if frequent
```

### 19.5 Missing Column After Deployment

```text
DB: column not found / bad SQL grammar
Application: DB_SCHEMA_MISMATCH
HTTP: 500
Retry: no
Alert: immediate
Action: rollback/fix migration
```

---

## 20. Worker Mapping Examples

Persistence failure in workers often needs different response than API.

### 20.1 Duplicate Message

```text
Message received twice
DB insert duplicate idempotency key / inbox message id
Action: ack message as already processed
Do not DLQ
Do not retry endlessly
```

### 20.2 Deadlock in Batch Worker

```text
Action: rollback transaction
Retry whole batch or smaller chunk
If repeated: split batch / deterministic lock ordering
```

### 20.3 Constraint Violation Due to Bad Payload

```text
Action: classify as poison message
Ack + send to DLQ with reason
Do not retry forever
```

### 20.4 Pool Exhaustion

```text
Action: pause consumer / reduce concurrency
Do not increase consumer concurrency
Alert operator
```

---

## 21. Anti-Patterns

### Anti-Pattern 1 — All Persistence Errors Become 500

```java
catch (DataAccessException e) {
    throw new InternalServerException("Database error");
}
```

Why bad:

- duplicate key becomes server error;
- stale update becomes server error;
- user cannot correct;
- support cannot distinguish incident vs conflict;
- retry behavior becomes wrong.

### Anti-Pattern 2 — Retrying Every SQLException

```java
@Retryable(SQLException.class)
public void save(...) { ... }
```

Why bad:

- bad SQL will be repeated;
- constraint violation will be repeated;
- storage full will be hammered;
- retry storm can overload DB;
- side effects may duplicate.

### Anti-Pattern 3 — Long Transaction Around External Calls

```java
@Transactional
public void approveCase(...) {
    caseRepository.save(case);
    externalApi.notifyApproval(case); // dangerous inside tx
    auditRepository.save(audit);
}
```

Problems:

- DB lock held while waiting external API;
- timeout can rollback DB after external side effect;
- retry can duplicate external call;
- shutdown can interrupt in confusing window.

Better:

```text
transaction:
  mutate case
  write outbox event
commit

async publisher:
  publish external notification with idempotency
```

### Anti-Pattern 4 — Increasing Pool Size as First Response

```text
Pool exhausted -> increase maxPoolSize
```

Maybe correct, often wrong. Diagnose latency, lock, leak, query plan, transaction duration, and concurrency first.

### Anti-Pattern 5 — Ignoring Constraint Names

If all constraint violations are generic, you lose domain signal. Name constraints intentionally.

### Anti-Pattern 6 — Auto-Retrying User Decisions

Optimistic lock auto-retry can override the fact that user made decision based on stale data.

### Anti-Pattern 7 — Catching and Continuing After Persistence Failure

```java
try {
    repository.save(audit);
} catch (Exception ignored) {
}
```

This is dangerous for audit, compliance, financial, legal, and regulatory flows.

---

## 22. Production Checklist

### 22.1 Exception Classification

- [ ] Do we distinguish constraint, conflict, transient, non-transient, unknown outcome?
- [ ] Do we preserve root cause and vendor metadata?
- [ ] Do we avoid generic `catch Exception` at repository/service layers?
- [ ] Do we map persistence errors to correct domain/API semantics?

### 22.2 Transaction Safety

- [ ] Are transaction boundaries explicit?
- [ ] Are external side effects outside DB transaction or outboxed?
- [ ] Are checked exceptions rollback rules reviewed?
- [ ] Are long-running operations outside transaction?
- [ ] Are read-only transactions marked read-only where useful?

### 22.3 Retry Safety

- [ ] Do we retry only known transient errors?
- [ ] Do we retry whole transaction when required?
- [ ] Is retry bounded with backoff/jitter?
- [ ] Is command idempotent or protected by key/version?
- [ ] Are retries disabled for bad SQL, constraint validation, and schema errors?

### 22.4 Concurrency and Locking

- [ ] Is lock ordering deterministic?
- [ ] Are batch chunks bounded?
- [ ] Do we handle optimistic lock as conflict?
- [ ] Are deadlock/lock timeout metrics visible?
- [ ] Are transaction durations measured?

### 22.5 Pool and Capacity

- [ ] Is DB pool sized relative to DB capacity, not only app threads?
- [ ] Are pool wait times monitored?
- [ ] Are slow queries monitored?
- [ ] Are batch/report workloads isolated?
- [ ] Is storage growth monitored?

### 22.6 Shutdown

- [ ] Does shutdown stop new DB work before closing pool?
- [ ] Are active transactions allowed bounded completion?
- [ ] Are workers paused before datasource closes?
- [ ] Are unknown outcomes reconciliable?

### 22.7 Observability

- [ ] Are SQLState/vendor codes captured safely?
- [ ] Are constraint names visible in internal logs?
- [ ] Are duplicate/conflict errors not over-alerted?
- [ ] Are bad SQL/schema mismatch errors high severity?
- [ ] Are retry exhausted events alerted?

---

## 23. Reference Implementation Sketch

### 23.1 PersistenceFailure Model

```java
public record PersistenceFailure(
    PersistenceFailureKind kind,
    String code,
    boolean retryable,
    boolean alertable,
    String safeMessage
) {
    public static PersistenceFailure conflict(String code, String message) {
        return new PersistenceFailure(
            PersistenceFailureKind.CONFLICT,
            code,
            false,
            false,
            message
        );
    }

    public static PersistenceFailure transientFailure(String code, String message) {
        return new PersistenceFailure(
            PersistenceFailureKind.TRANSIENT,
            code,
            true,
            true,
            message
        );
    }

    public static PersistenceFailure internalBug(String code, String message) {
        return new PersistenceFailure(
            PersistenceFailureKind.INTERNAL_BUG,
            code,
            false,
            true,
            message
        );
    }
}
```

```java
public enum PersistenceFailureKind {
    VALIDATION,
    CONFLICT,
    TRANSIENT,
    NON_TRANSIENT,
    UNKNOWN_OUTCOME,
    INTERNAL_BUG,
    UNKNOWN
}
```

### 23.2 Classifier Skeleton

```java
@Component
public final class PersistenceFailureClassifier {

    public PersistenceFailure classify(Throwable error) {
        Throwable root = rootCause(error);

        if (isOptimisticLock(error)) {
            return PersistenceFailure.conflict(
                "STALE_RESOURCE_VERSION",
                "The resource was modified by another transaction."
            );
        }

        ConstraintInfo constraint = extractConstraint(error);
        if (constraint != null) {
            return classifyConstraint(constraint);
        }

        if (isDeadlock(error)) {
            return PersistenceFailure.transientFailure(
                "DB_DEADLOCK",
                "The database transaction conflicted with another transaction."
            );
        }

        if (isLockTimeout(error)) {
            return PersistenceFailure.transientFailure(
                "DB_LOCK_TIMEOUT",
                "The database resource was busy."
            );
        }

        if (isPoolExhausted(error)) {
            return PersistenceFailure.transientFailure(
                "DB_POOL_EXHAUSTED",
                "The database is temporarily saturated."
            );
        }

        if (isBadSql(error)) {
            return PersistenceFailure.internalBug(
                "DB_BAD_SQL_OR_SCHEMA_MISMATCH",
                "The application query does not match the database schema."
            );
        }

        return new PersistenceFailure(
            PersistenceFailureKind.UNKNOWN,
            "DB_UNKNOWN_FAILURE",
            false,
            true,
            "Unexpected persistence failure."
        );
    }

    private PersistenceFailure classifyConstraint(ConstraintInfo c) {
        return switch (c.name()) {
            case "uk_user_email" -> PersistenceFailure.conflict(
                "USER_EMAIL_ALREADY_EXISTS",
                "A user with this email already exists."
            );
            case "uk_case_reference_no" -> PersistenceFailure.conflict(
                "CASE_REFERENCE_ALREADY_EXISTS",
                "A case with this reference number already exists."
            );
            case "fk_attachment_case" -> PersistenceFailure.conflict(
                "CASE_NOT_AVAILABLE_FOR_ATTACHMENT",
                "The target case does not exist or is no longer available."
            );
            default -> PersistenceFailure.internalBug(
                "DATA_INTEGRITY_VIOLATION",
                "Data integrity constraint was violated."
            );
        };
    }
}
```

### 23.3 Transaction Retry Wrapper

```java
@Component
public final class TransactionalRetryRunner {

    private final TransactionTemplate transactionTemplate;
    private final RetryPolicy retryPolicy;

    public <T> T runRetryableTransaction(Supplier<T> work) {
        int attempt = 0;

        while (true) {
            attempt++;
            try {
                return transactionTemplate.execute(status -> work.get());
            } catch (DataAccessException e) {
                if (!isRetryableTransactionFailure(e) || attempt >= retryPolicy.maxAttempts()) {
                    throw e;
                }

                sleepWithJitter(attempt);
            }
        }
    }
}
```

Important:

```text
Do not put external side effects inside work.get().
```

---

## 24. Design Heuristics

### Heuristic 1 — Database Constraint Is Last Line of Defense

Application validation improves UX, but DB constraint protects truth.

### Heuristic 2 — Retry Must Be Designed with State Awareness

Retry is not safe because the exception is transient. Retry is safe only if the operation semantics are repeatable.

### Heuristic 3 — Conflict Is Not Failure

409 conflict is often a correct outcome in concurrent systems.

### Heuristic 4 — Pool Exhaustion Is Usually a Symptom

Treat it as a saturation signal. Find the resource that increased connection hold time.

### Heuristic 5 — Transaction Boundary Should Be Smaller Than Business Process Boundary

A business process can span multiple transactions with explicit state transitions, outbox, compensation, and reconciliation.

### Heuristic 6 — Unknown Outcome Requires Lookup, Not Guessing

If you do not know whether commit happened, inspect state using idempotency/business key.

### Heuristic 7 — Persistence Errors Need Domain Translation

A raw DB exception is not a user contract.

---

## 25. Review Questions

1. Apa perbedaan constraint violation sebagai validation error, conflict, dan invariant bug?
2. Mengapa optimistic lock failure biasanya lebih tepat menjadi `409 Conflict` daripada auto-retry?
3. Mengapa deadlock retry harus mengulang seluruh transaction?
4. Mengapa connection pool exhaustion tidak otomatis berarti pool harus diperbesar?
5. Apa perbedaan rollback transaction dan system recovery?
6. Bagaimana read replica lag bisa menghasilkan false 404?
7. Apa itu unknown commit outcome dan mengapa idempotency key penting?
8. Kapan persistence failure harus menghasilkan alert high severity?
9. Mengapa side effect eksternal tidak boleh dilakukan sembarangan di dalam transaction?
10. Metadata apa yang perlu dicatat untuk persistence observability?

---

## 26. Ringkasan

Persistence reliability bukan sekadar “handle SQLException”. Persistence layer adalah boundary state paling kritis di banyak sistem enterprise.

Mental model yang harus dibawa:

```text
Database failure = state transition uncertainty + concurrency conflict + resource signal + domain invariant evidence
```

Engineer yang matang tidak bertanya hanya:

```text
Exception apa yang dilempar?
```

Tetapi:

```text
Apakah state berubah?
Apakah retry aman?
Apakah user bisa memperbaiki?
Apakah operator harus bertindak?
Apakah invariant masih terjaga?
Apakah evidence cukup untuk recovery?
```

Prinsip inti:

- constraint violation harus diterjemahkan, bukan digenerikkan;
- optimistic lock adalah conflict semantic;
- deadlock/serialization failure bisa retryable, tapi harus retry seluruh transaction;
- pool exhaustion adalah saturation signal;
- rollback bukan full recovery;
- unknown outcome butuh idempotency/reconciliation;
- observability persistence harus membawa SQLState/vendor code/constraint/retryability;
- shutdown harus menghormati active transaction dan datasource lifecycle.

Jika bagian ini dipahami, kamu mulai melihat database bukan sekadar storage, tetapi sebagai **consistency engine** yang harus didesain bersama exception handling, retry, shutdown, observability, dan recovery.

---

## 27. Status Seri

```text
Part 021 / 030 completed
Seri belum selesai.
```

Materi berikutnya:

```text
Part 022 — Consistency, Compensation, and Distributed Failure
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-reliability-part-020.md">⬅️ Part 020 — Reliability Patterns for External Integrations</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-reliability-part-022.md">Part 022 — Consistency, Compensation, and Distributed Failure ➡️</a>
</div>
