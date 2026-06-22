# learn-mysql-mastery-for-java-engineers-part-015.md

# Part 015 — Transactions in Java Applications: Boundaries, Timeouts, and Side Effects

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `015 / 034`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: MySQL transaction behavior di aplikasi Java production, terutama boundary, timeout, retry, idempotency, dan side effect.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membangun fondasi teknis MySQL dari sisi engine:

- arsitektur MySQL;
- model penyimpanan InnoDB;
- primary key sebagai keputusan fisik;
- tipe data dan collation;
- MVCC;
- isolation level;
- locking;
- deadlock dan lock wait timeout;
- index internals;
- optimizer;
- query execution;
- pagination, search, dan filtering.

Bagian ini menggeser fokus dari **database sebagai engine** ke **database sebagai boundary konsistensi dalam aplikasi Java**.

Kesalahan umum Java engineer bukan hanya query lambat atau index kurang. Banyak incident muncul karena transaksi diletakkan di boundary yang salah:

- transaksi terlalu panjang;
- transaksi membungkus call ke sistem eksternal;
- retry dilakukan pada level yang tidak idempotent;
- timeout aplikasi, JDBC, dan MySQL tidak sinkron;
- `@Transactional` dianggap sebagai magic;
- event dikirim sebelum commit;
- rollback dianggap bisa membatalkan side effect di luar database;
- connection pool kehabisan koneksi karena transaksi idle;
- read/write split membaca replica setelah write ke primary;
- service method tampak transactional tetapi sebenarnya tidak kena proxy.

Tujuan bagian ini adalah membuat kamu mampu menjawab pertanyaan ini:

> “Di mana transaksi seharusnya dimulai, apa saja yang boleh terjadi di dalamnya, kapan harus commit, bagaimana menangani kegagalan, dan bagaimana menjaga konsistensi ketika sistem lain terlibat?”

---

## 1. Mental Model Utama: Transaction Boundary adalah Design Boundary

Banyak developer memperlakukan transaksi sebagai detail teknis:

```java
@Transactional
public void approveCase(Long caseId) {
    // do things
}
```

Padahal transaksi adalah **batas desain**.

Transaction boundary menentukan:

1. data mana yang berubah secara atomik;
2. invariant mana yang dilindungi;
3. lock mana yang ditahan;
4. berapa lama row tidak bisa dimodifikasi transaksi lain;
5. kapan perubahan terlihat oleh session lain;
6. kapan event boleh dianggap valid;
7. apa yang harus diulang ketika terjadi deadlock atau timeout;
8. apakah side effect eksternal bisa menjadi inconsistent.

Dalam MySQL, statement control transaksi seperti `START TRANSACTION`, `COMMIT`, `ROLLBACK`, dan `SET autocommit` mengatur kapan perubahan menjadi permanen atau dibatalkan. Secara default MySQL menjalankan session dalam mode autocommit enabled, sehingga setiap statement menjadi transaksi sendiri kecuali transaksi eksplisit dimulai. Referensi resmi MySQL menjelaskan bahwa `COMMIT` membuat perubahan permanen dan `ROLLBACK` membatalkannya, sedangkan `SET autocommit` mengatur mode autocommit session. [MySQL 8.4 Reference Manual — START TRANSACTION, COMMIT, and ROLLBACK](https://dev.mysql.com/doc/en/commit.html)

Di level Java, JDBC juga punya konsep `Connection.setAutoCommit(false)` untuk mengelompokkan beberapa statement menjadi satu transaksi. Dokumentasi Oracle JDBC tutorial menggambarkan transaksi sebagai mekanisme agar beberapa perubahan terjadi bersama atau tidak terjadi sama sekali. [Oracle Java Tutorials — Using Transactions](https://docs.oracle.com/javase/tutorial/jdbc/basics/transactions.html)

Namun mental model pentingnya bukan “pakai transaksi agar aman”. Mental model yang lebih kuat:

> Transaksi adalah alat untuk menjaga invariant database dalam jendela waktu terbatas. Semakin besar jendela itu, semakin besar biaya concurrency, lock, undo, retry, dan operational risk.

---

## 2. Tiga Jenis Boundary yang Sering Tercampur

Dalam aplikasi backend, ada tiga boundary yang sering disamakan padahal berbeda.

### 2.1 Request Boundary

Ini adalah boundary HTTP/API/message handler.

Contoh:

```text
POST /cases/{id}/approve
```

Request boundary dimulai saat request diterima dan selesai saat response dikirim.

Tidak semua request boundary harus sama dengan transaction boundary.

Kesalahan umum:

```text
request mulai
  buka transaksi
  validasi
  query data
  panggil external service
  update DB
  kirim email
  commit
request selesai
```

Ini buruk karena transaksi menahan resource selama seluruh request.

### 2.2 Service Method Boundary

Ini boundary method aplikasi:

```java
caseApprovalService.approve(caseId, actorId);
```

Di Spring, `@Transactional` sering ditempatkan di service method. Ini bisa benar, tapi tidak otomatis benar.

Pertanyaannya:

- Apakah seluruh method benar-benar satu unit atomik?
- Apakah ada I/O eksternal di dalamnya?
- Apakah method melakukan terlalu banyak orchestration?
- Apakah method memanggil method internal yang diharapkan transactional?

### 2.3 Database Transaction Boundary

Ini boundary aktual di connection MySQL:

```sql
START TRANSACTION;
UPDATE ...;
INSERT ...;
COMMIT;
```

Inilah boundary yang benar-benar memengaruhi:

- lock lifetime;
- snapshot lifetime;
- undo retention;
- commit visibility;
- deadlock possibility;
- rollback behavior.

Boundary ini sebaiknya lebih kecil daripada request boundary, dan sering kali lebih kecil daripada orchestration method.

---

## 3. Rule of Thumb: Transaction Harus Pendek, Deterministik, dan Database-Only

Prinsip produksi yang kuat:

> Masukkan hanya operasi database yang dibutuhkan untuk menjaga invariant atomik. Keluarkan semua hal yang tidak harus ikut atomik.

Transaction body ideal:

```text
start transaction
  read rows needed to validate invariant
  lock rows if needed
  check current state
  mutate rows
  write audit/outbox rows
commit
```

Yang sebaiknya tidak ada di dalam transaksi:

- HTTP call ke service lain;
- publish Kafka/RabbitMQ langsung;
- kirim email;
- upload file;
- call payment provider;
- call notification system;
- heavy CPU computation;
- sleep/retry loop;
- user interaction;
- long stream processing;
- membaca ribuan row lalu proses perlahan di memory;
- generate report besar;
- call ke AI/external API;
- locking unrelated aggregate.

Kenapa?

Karena selama transaksi hidup, MySQL bisa menahan:

- row locks;
- gap locks;
- metadata visibility;
- undo log versions;
- connection dari pool;
- transaction snapshot.

Di aplikasi Java, ini juga menahan:

- thread request;
- JDBC connection;
- HikariCP slot;
- database session;
- memory dari persistence context jika memakai JPA/Hibernate.

---

## 4. ACID dalam Praktik Aplikasi Java

Kita tidak akan mengulang definisi dasar ACID terlalu panjang, tetapi kita perlu mengaitkannya ke desain aplikasi.

### 4.1 Atomicity

Atomicity berarti perubahan dalam transaksi commit bersama atau rollback bersama.

Namun atomicity hanya berlaku untuk resource yang ikut transaksi database.

Contoh:

```java
@Transactional
public void approveCase(Long caseId) {
    caseRepository.approve(caseId);
    emailClient.sendApprovalEmail(caseId);
}
```

Jika email berhasil terkirim lalu database rollback, email tidak otomatis “di-rollback”.

Ini bukan pelanggaran MySQL. Ini desain boundary yang salah.

### 4.2 Consistency

Consistency bukan berarti “database selalu sesuai bisnis” secara ajaib. Database hanya menjaga constraint yang kamu definisikan:

- primary key;
- unique key;
- foreign key;
- check constraint;
- not null;
- transaction isolation;
- locking reads;
- trigger jika dipakai;
- application invariant yang dicek dalam transaksi.

Jika invariant tidak dimodelkan di database atau tidak dicek secara benar dalam transaksi, MySQL tidak bisa menebaknya.

### 4.3 Isolation

Isolation menentukan bagaimana transaksi bersamaan saling melihat perubahan.

Di InnoDB, isolation tidak bisa dipahami hanya dari textbook SQL. Kamu perlu memahami:

- consistent nonlocking read;
- locking read;
- current read;
- record lock;
- gap lock;
- next-key lock.

Dokumentasi resmi InnoDB menjelaskan bahwa InnoDB mendukung empat isolation level SQL: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, dan SERIALIZABLE. [MySQL 8.4 Reference Manual — Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)

### 4.4 Durability

Durability berarti setelah commit sukses, database berusaha mempertahankan perubahan walau crash, sesuai konfigurasi durability.

Namun aplikasi harus tetap menghadapi kasus abu-abu:

```text
client kirim COMMIT
server berhasil commit
network putus sebelum client menerima response
client tidak tahu commit berhasil atau tidak
```

Ini disebut **uncertain commit** dari perspektif aplikasi.

Solusinya bukan “anggap gagal lalu ulang bebas”. Solusinya:

- pakai idempotency key;
- pakai natural business key/unique constraint;
- bisa query state setelah reconnect;
- desain command agar retry-safe.

---

## 5. Autocommit: Default yang Sering Tidak Disadari

MySQL default autocommit adalah enabled. Artinya:

```sql
UPDATE account SET balance = balance - 100 WHERE id = 1;
```

adalah transaksi sendiri.

Setara secara konseptual dengan:

```sql
START TRANSACTION;
UPDATE account SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

Untuk satu statement sederhana, ini sering cukup.

Namun ketika operasi bisnis butuh beberapa statement atomik, autocommit default tidak cukup.

Contoh buruk:

```java
jdbcTemplate.update("UPDATE account SET balance = balance - ? WHERE id = ?", amount, fromId);
jdbcTemplate.update("UPDATE account SET balance = balance + ? WHERE id = ?", amount, toId);
```

Tanpa transaksi eksplisit, statement pertama bisa commit, statement kedua gagal.

Contoh benar:

```java
@Transactional
public void transfer(long fromId, long toId, BigDecimal amount) {
    debit(fromId, amount);
    credit(toId, amount);
}
```

Tapi transaksi eksplisit juga bisa buruk bila terlalu besar.

Jadi prinsipnya:

> Autocommit baik untuk statement independen. Transaksi eksplisit dibutuhkan untuk invariant multi-statement. Jangan memakai transaksi eksplisit sebagai default membungkus seluruh request tanpa alasan.

---

## 6. `@Transactional` Bukan Magic

Di Spring, `@Transactional` adalah deklarasi bahwa method harus dieksekusi dalam transaction context tertentu. Dokumentasi Spring menjelaskan penggunaan `@Transactional` untuk declarative transaction management, termasuk rollback rules dan atribut transaksi. [Spring Framework Reference — Using @Transactional](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)

Namun banyak bug muncul karena developer mengira annotation ini bekerja di semua situasi.

### 6.1 Proxy-Based Transaction

Dalam konfigurasi umum Spring, transaksi bekerja melalui proxy.

Artinya method transactional harus dipanggil melalui proxy Spring, bukan melalui self-invocation internal.

Contoh jebakan:

```java
@Service
public class CaseService {

    public void approveMany(List<Long> ids) {
        for (Long id : ids) {
            approveOne(id); // self-invocation, bisa tidak melewati proxy
        }
    }

    @Transactional
    public void approveOne(Long id) {
        // expected transactional
    }
}
```

Jika `approveOne` dipanggil dari method dalam object yang sama, call bisa tidak melewati proxy. Akibatnya `@Transactional` pada `approveOne` bisa tidak aktif dalam mode proxy umum.

Desain lebih eksplisit:

```java
@Service
public class CaseBatchService {
    private final CaseApprovalService caseApprovalService;

    public void approveMany(List<Long> ids) {
        for (Long id : ids) {
            caseApprovalService.approveOne(id);
        }
    }
}

@Service
public class CaseApprovalService {
    @Transactional
    public void approveOne(Long id) {
        // transactional boundary here
    }
}
```

### 6.2 Visibility Method

`@Transactional` pada private method umumnya tidak menjadi transaction boundary proxy.

Buruk:

```java
public void handle() {
    doInsideTransaction();
}

@Transactional
private void doInsideTransaction() {
    // misleading
}
```

Lebih baik transaction boundary ditempatkan pada public service method yang dipanggil dari bean lain.

### 6.3 Rollback Rules

Secara umum, Spring rollback default untuk unchecked exception/runtime exception, sementara checked exception perlu aturan eksplisit bila ingin rollback.

Contoh:

```java
@Transactional(rollbackFor = ExternalValidationException.class)
public void submitCase(...) throws ExternalValidationException {
    ...
}
```

Tetapi jangan asal menambahkan `rollbackFor = Exception.class` tanpa memahami efeknya. Kadang ada exception yang justru sudah ditangani secara bisnis dan tidak seharusnya rollback.

---

## 7. Propagation Modes: Jangan Hanya Hafal Nama

Transaction propagation menentukan apa yang terjadi jika method transactional dipanggil saat sudah ada transaksi.

Dokumentasi Spring memiliki bagian khusus tentang transaction propagation, termasuk `REQUIRED`, `REQUIRES_NEW`, dan nested savepoint behavior. [Spring Framework Reference — Transaction Propagation](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)

Kita fokus pada mode yang paling sering memengaruhi desain.

---

### 7.1 `REQUIRED`

Ini default.

Makna:

- jika sudah ada transaksi, ikut transaksi itu;
- jika belum ada, buat transaksi baru.

Contoh:

```java
@Transactional
public void approveCase(Long caseId) {
    validate(caseId);
    updateState(caseId);
    writeAudit(caseId);
}
```

Biasanya ini pilihan benar untuk satu use case atomik.

Namun masalah muncul saat method kecil diberi `@Transactional(REQUIRED)` tanpa sadar ia bisa bergabung ke transaksi besar caller.

Contoh:

```java
@Transactional
public void processBatch(List<Long> caseIds) {
    for (Long id : caseIds) {
        approveCase(id); // if same proxy/transaction, may join one huge transaction
    }
}
```

Jika semua item dalam batch masuk satu transaksi:

- lock ditahan lama;
- undo log membesar;
- rollback mahal;
- deadlock impact besar;
- connection tertahan lama;
- satu item gagal membatalkan semua.

Kadang benar, sering salah.

---

### 7.2 `REQUIRES_NEW`

Makna:

- suspend transaksi saat ini;
- buat transaksi fisik baru;
- commit/rollback independen;
- setelah selesai, lanjutkan transaksi luar.

Contoh umum:

```java
@Transactional
public void approveCase(Long caseId) {
    updateCase(caseId);
    auditService.writeAuditRequiresNew(caseId, "APPROVED");
    maybeFail();
}
```

Jika audit `REQUIRES_NEW`, audit bisa commit walau transaksi utama rollback.

Ini bisa berguna, tetapi berbahaya.

Pertanyaan desain:

- Apakah audit boleh mencatat event yang akhirnya tidak terjadi?
- Apakah audit itu attempt log atau state-change log?
- Apakah transaksi baru bisa membaca state belum committed dari transaksi luar? Tidak.
- Apakah ini menggandakan kebutuhan connection pool? Bisa.

`REQUIRES_NEW` sering dipakai untuk audit/error log, tetapi harus jelas semantiknya.

Untuk regulatory system, bedakan:

```text
Attempt audit:
  “User mencoba approve case X, tetapi gagal karena validation error.”
  Boleh commit terpisah.

State transition audit:
  “Case X berubah dari SUBMITTED ke APPROVED.”
  Harus commit atomik bersama perubahan state.
```

---

### 7.3 `NESTED`

`NESTED` biasanya menggunakan savepoint jika transaction manager dan database mendukung.

Makna konseptual:

```text
outer transaction starts
  do A
  savepoint
    do B
    if fail rollback to savepoint
  do C
outer commit
```

Ini bukan transaksi fisik independen seperti `REQUIRES_NEW`.

Gunakan dengan hati-hati karena:

- tidak selalu bekerja sama di semua stack;
- interaction dengan JPA bisa membingungkan;
- lock yang sudah diperoleh bisa tetap memengaruhi transaksi luar;
- tidak menyelesaikan masalah side effect eksternal.

---

### 7.4 `SUPPORTS`, `MANDATORY`, `NOT_SUPPORTED`, `NEVER`

Mode ini lebih jarang dipakai, tetapi berguna untuk mengekspresikan kontrak.

Contoh `MANDATORY`:

```java
@Transactional(propagation = Propagation.MANDATORY)
public void insertAuditRecord(...) {
    // must be called inside transaction
}
```

Ini berguna jika method tidak boleh berjalan di luar transaksi karena audit harus atomik dengan state change.

Contoh `NOT_SUPPORTED`:

```java
@Transactional(propagation = Propagation.NOT_SUPPORTED)
public ReportData generateLargeReport(...) {
    // explicitly avoid transactional context
}
```

Ini bisa berguna untuk operasi read/report panjang agar tidak menahan snapshot transaction tanpa perlu.

---

## 8. Timeout: Jangan Campuradukkan Semua Timeout

Dalam aplikasi Java + MySQL, ada banyak timeout berbeda.

Jika tidak dipahami, incident menjadi sulit didiagnosis.

### 8.1 Transaction Timeout

Transaction timeout adalah batas waktu transaksi di framework.

Contoh:

```java
@Transactional(timeout = 5)
public void approveCase(Long caseId) {
    ...
}
```

Ini menyatakan transaksi tidak seharusnya berjalan lebih dari 5 detik.

Namun efek aktual tergantung transaction manager, JDBC driver, dan kapan timeout dicek.

### 8.2 Query Timeout

Query timeout membatasi eksekusi statement tertentu.

Contoh JDBC:

```java
statement.setQueryTimeout(3);
```

Ini berbeda dari transaction timeout.

Query bisa timeout, tetapi transaksi mungkin masih perlu rollback.

### 8.3 Lock Wait Timeout

MySQL punya `innodb_lock_wait_timeout` untuk menunggu row lock sebelum statement gagal.

Ini bukan deadlock detector. Deadlock bisa dideteksi lebih cepat; lock wait timeout terjadi saat transaksi menunggu terlalu lama.

### 8.4 Socket/Network Timeout

Socket timeout mengatur seberapa lama client menunggu network read/write.

Jika socket timeout terjadi saat commit, aplikasi bisa tidak tahu apakah commit berhasil atau tidak.

### 8.5 Connection Pool Timeout

HikariCP `connectionTimeout` mengatur seberapa lama thread menunggu connection dari pool.

Jika pool exhausted, request gagal sebelum query dikirim ke MySQL.

### 8.6 Statement vs Transaction vs Request Timeout

Susunan timeout harus konsisten.

Contoh buruk:

```text
HTTP request timeout:       30s
Spring transaction timeout: 60s
JDBC query timeout:         none
Hikari connection timeout:  30s
MySQL lock wait timeout:    50s
```

Masalah:

- request bisa diputus client sebelum transaksi selesai;
- query bisa tetap berjalan di database;
- thread bisa menunggu connection terlalu lama;
- user melihat timeout, tetapi DB masih memproses;
- retry client bisa membuat duplicate command.

Contoh prinsip lebih baik:

```text
HTTP request timeout > service internal budget
transaction timeout <= service budget
query timeout <= transaction timeout
lock wait timeout reasonable for workload
connection acquisition timeout short enough to fail fast
```

Bukan angka absolut, tapi urutan budget harus masuk akal.

---

## 9. External Side Effects: Sumber Inconsistency Paling Umum

Database transaction tidak mengontrol dunia luar.

Side effect luar meliputi:

- publish event;
- kirim email;
- call service lain;
- tulis file;
- enqueue job;
- panggil payment;
- update search index;
- invalidate cache;
- kirim notification;
- call regulatory gateway.

Contoh buruk:

```java
@Transactional
public void approveCase(Long caseId) {
    Case c = caseRepository.findByIdForUpdate(caseId);
    c.approve();
    eventPublisher.publish(new CaseApproved(caseId));
    caseRepository.save(c);
}
```

Jika event publish berhasil tapi commit gagal, consumer melihat event yang tidak punya state database.

Contoh lain:

```java
@Transactional
public void approveCase(Long caseId) {
    Case c = caseRepository.findByIdForUpdate(caseId);
    c.approve();
    caseRepository.save(c);
    eventPublisher.publish(new CaseApproved(caseId));
}
```

Jika event publish dilakukan sebelum commit, consumer bisa membaca database dan belum melihat perubahan.

Jika event publish setelah commit tapi process crash sebelum publish, state berubah tetapi event hilang.

Jadi ada tiga failure mode:

```text
1. event emitted, DB rollback
2. event emitted before DB visible
3. DB commit, event not emitted
```

Solusi umum: **outbox pattern**.

---

## 10. Outbox Pattern: Commit State dan Event Secara Atomik

Outbox pattern menyimpan event sebagai row di database yang sama dengan perubahan state bisnis.

Dalam transaksi:

```text
start transaction
  update case status
  insert audit row
  insert outbox row
commit
```

Setelah commit:

```text
outbox relay reads unsent outbox rows
publishes to broker
marks as sent / records publish state
```

Contoh schema sederhana:

```sql
CREATE TABLE outbox_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_key VARCHAR(128) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    published_at TIMESTAMP(6) NULL,
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_outbox_event_key (event_key),
    KEY idx_outbox_status_id (status, id)
) ENGINE=InnoDB;
```

Transactional write:

```java
@Transactional
public void approveCase(long caseId, long actorId) {
    CaseRecord c = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow();

    c.approve(actorId);
    caseRepository.save(c);

    auditRepository.insertStateTransition(
        caseId,
        "SUBMITTED",
        "APPROVED",
        actorId
    );

    outboxRepository.insert(new OutboxEvent(
        "CASE",
        caseId,
        "CaseApproved",
        "case-approved-" + caseId + "-" + c.version(),
        payloadJson(c)
    ));
}
```

Relay:

```sql
SELECT *
FROM outbox_event
WHERE status = 'NEW'
ORDER BY id
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Then publish outside the transaction, and mark success/failure.

Important:

- outbox insert must be in same transaction as business state change;
- event must have idempotency key;
- consumer must be idempotent;
- relay may publish duplicate if crash happens after publish before marking sent;
- exactly-once is usually illusion at system boundary.

---

## 11. Idempotency: Retry Aman Membutuhkan Identitas Operasi

Jika operasi bisa diulang, ia harus punya identity.

Tanpa idempotency:

```http
POST /payments
{
  "amount": 100000
}
```

Client timeout, lalu retry. Apakah payment dibuat dua kali?

Dengan idempotency:

```http
POST /payments
Idempotency-Key: 9f29a2d2-...
{
  "amount": 100000
}
```

Database schema:

```sql
CREATE TABLE idempotency_record (
    idempotency_key VARCHAR(128) NOT NULL,
    operation_type VARCHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_payload JSON NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    completed_at TIMESTAMP(6) NULL,
    PRIMARY KEY (idempotency_key),
    KEY idx_idempotency_created_at (created_at)
) ENGINE=InnoDB;
```

Command handling:

```text
start transaction
  insert idempotency key if absent
  if duplicate key:
      load previous result/status
      return previous result or conflict
  perform mutation
  store result
commit
```

The unique key is the concurrency control.

Contoh Java outline:

```java
@Transactional
public ApprovalResult approveCase(ApproveCaseCommand cmd) {
    IdempotencyRecord record = idempotencyRepository.tryCreate(
        cmd.idempotencyKey(),
        "APPROVE_CASE",
        hash(cmd)
    );

    if (record.alreadyExists()) {
        return idempotencyRepository.replayOrReject(cmd.idempotencyKey(), hash(cmd));
    }

    CaseRecord c = caseRepository.findByIdForUpdate(cmd.caseId())
        .orElseThrow();

    ApprovalResult result = c.approve(cmd.actorId());
    caseRepository.save(c);

    outboxRepository.insert(CaseApprovedEvent.from(c));
    idempotencyRepository.markCompleted(cmd.idempotencyKey(), result);

    return result;
}
```

Idempotency bukan hanya untuk payment. Dalam regulatory/case-management system, ini berguna untuk:

- submit case;
- approve/reject decision;
- assign investigator;
- create enforcement action;
- generate notice;
- schedule hearing;
- publish decision;
- import external complaint;
- consume message.

---

## 12. Retry: Apa yang Boleh Diulang?

Tidak semua error boleh di-retry.

### 12.1 Deadlock

Deadlock biasanya retriable jika transaksi dirancang idempotent.

MySQL memilih salah satu transaksi sebagai victim dan rollback transaksi tersebut.

Aplikasi boleh retry seluruh unit transaksi.

Bukan hanya statement terakhir.

Buruk:

```java
try {
    repository.updateStatus(id, APPROVED);
} catch (DeadlockLoserDataAccessException e) {
    repository.updateStatus(id, APPROVED); // retry statement only, context lost
}
```

Lebih baik retry command-level:

```java
retryTemplate.execute(ctx -> approvalService.approveCase(command));
```

Namun hati-hati: jika `approvalService.approveCase` sendiri transactional dan dipanggil dari retry wrapper, boundary harus benar.

### 12.2 Lock Wait Timeout

Lock wait timeout kadang retriable, tetapi juga bisa menandakan desain lock buruk atau transaksi lain terlalu panjang.

Retry membabi buta bisa memperparah load.

Gunakan:

- bounded retry;
- exponential backoff;
- jitter;
- metrics;
- logging lock context;
- idempotency key.

### 12.3 Duplicate Key

Duplicate key bukan error teknis murni. Bisa berarti:

- request duplicate;
- race condition yang berhasil ditangani constraint;
- data conflict;
- bug.

Untuk idempotency, duplicate key bisa menjadi success replay.

Untuk unique business invariant, duplicate key bisa menjadi domain error.

### 12.4 Lost Connection / Socket Timeout During Commit

Ini paling berbahaya.

Jika koneksi putus saat commit, aplikasi mungkin tidak tahu hasil commit.

Retry tanpa idempotency bisa menggandakan efek.

Strategi:

1. gunakan idempotency key;
2. setelah reconnect, query berdasarkan business key;
3. jika state sudah berubah, treat as success/replay;
4. jika belum berubah, retry command;
5. jika ambiguous, mark for reconciliation.

---

## 13. Transaction Boundary untuk State Machine

Untuk sistem case management/regulatory, banyak operasi adalah state transition.

Contoh state:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ENFORCEMENT_ACTION_CREATED -> CLOSED
```

Setiap transition harus punya invariant.

Contoh approve:

```text
Precondition:
  case.status = UNDER_REVIEW
  assigned_reviewer_id = actor_id or actor has supervisor role
  required_documents_complete = true

Mutation:
  case.status = APPROVED
  case.approved_by = actor_id
  case.approved_at = now
  case.version += 1
  insert audit transition
  insert outbox event
```

Transaction:

```sql
START TRANSACTION;

SELECT id, status, assigned_reviewer_id, version
FROM regulatory_case
WHERE id = ?
FOR UPDATE;

-- validate in app or SQL

UPDATE regulatory_case
SET status = 'APPROVED',
    approved_by = ?,
    approved_at = NOW(6),
    version = version + 1
WHERE id = ?
  AND status = 'UNDER_REVIEW';

INSERT INTO case_audit (...);
INSERT INTO outbox_event (...);

COMMIT;
```

Stronger pattern:

```sql
UPDATE regulatory_case
SET status = 'APPROVED',
    approved_by = ?,
    approved_at = NOW(6),
    version = version + 1
WHERE id = ?
  AND status = 'UNDER_REVIEW'
  AND assigned_reviewer_id = ?;
```

Then check affected rows.

This encodes transition guard in the mutation itself.

Benefits:

- avoids stale read update;
- improves concurrency correctness;
- makes failure explicit;
- can be retried safely with idempotency.

---

## 14. Optimistic Locking vs Pessimistic Locking

### 14.1 Optimistic Locking

Optimistic locking assumes conflict is rare.

Schema:

```sql
ALTER TABLE regulatory_case
ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
```

Update:

```sql
UPDATE regulatory_case
SET status = ?,
    version = version + 1
WHERE id = ?
  AND version = ?;
```

If affected rows = 0, someone else changed the row.

Good for:

- UI editing forms;
- low-conflict updates;
- avoiding long locks;
- aggregate versioning;
- REST concurrency with ETag-like behavior.

Bad for:

- high-contention counters;
- queue consumers;
- operations requiring immediate exclusive claim;
- complex multi-row invariants.

### 14.2 Pessimistic Locking

Pessimistic locking assumes conflict is likely or correctness requires exclusive claim.

Example:

```sql
SELECT *
FROM regulatory_case
WHERE id = ?
FOR UPDATE;
```

Good for:

- state transition with strict invariant;
- inventory/reservation;
- assigning next work item;
- preventing concurrent approval;
- updating aggregate with dependent child rows.

Bad if:

- transaction does external call;
- lock order inconsistent;
- query does not use selective index;
- transaction scans ranges;
- user waits inside transaction.

---

## 15. The “External Validation Inside Transaction” Trap

Bad:

```java
@Transactional
public void approveCase(long caseId) {
    CaseRecord c = caseRepository.findByIdForUpdate(caseId);

    ExternalRiskResult risk = riskService.check(c.subjectId()); // network call

    if (!risk.allowed()) {
        throw new BusinessException("Risk rejected");
    }

    c.approve();
    caseRepository.save(c);
}
```

Problem:

- row lock held while waiting for network;
- risk service latency becomes DB lock latency;
- if risk service hangs, DB concurrency collapses;
- retry can duplicate external check;
- transaction timeout and HTTP timeout can conflict.

Better:

```text
1. Outside transaction:
   fetch data needed for external validation using normal read
   call external service

2. Inside short transaction:
   lock current case row
   re-check that state/version still valid
   apply decision based on validation result
   write audit/outbox
   commit
```

Example:

```java
public void approveCase(long caseId, long actorId) {
    CaseSnapshot snapshot = caseQueryService.getApprovalSnapshot(caseId);

    RiskResult risk = riskClient.check(snapshot.subjectId());

    approvalTxService.approveAfterRiskCheck(caseId, actorId, snapshot.version(), risk);
}

@Service
class ApprovalTxService {
    @Transactional
    public void approveAfterRiskCheck(long caseId, long actorId, long expectedVersion, RiskResult risk) {
        CaseRecord c = caseRepository.findByIdForUpdate(caseId);

        if (c.version() != expectedVersion) {
            throw new ConcurrentModificationException();
        }

        if (!risk.allowed()) {
            c.rejectRisk(actorId, risk.reason());
        } else {
            c.approve(actorId);
        }

        caseRepository.save(c);
        auditRepository.insert(...);
        outboxRepository.insert(...);
    }
}
```

Important subtlety:

The external validation result was based on snapshot version. Therefore the transaction must re-check the version/state before applying it.

---

## 16. Persistence Context and JPA/Hibernate Transaction Cost

If using JPA/Hibernate, transaction scope is also persistence context scope in common Spring setups.

Long transaction means:

- many entities managed;
- dirty checking cost increases;
- memory grows;
- flush timing can surprise you;
- queries may trigger flush before execution;
- lazy loading can happen inside transaction unexpectedly;
- entity graph can explode.

Example trap:

```java
@Transactional
public void processLargeBatch() {
    List<CaseEntity> cases = caseRepository.findAllPending();
    for (CaseEntity c : cases) {
        c.escalateIfNeeded();
    }
}
```

Problems:

- all cases loaded into persistence context;
- huge transaction;
- huge rollback;
- locks possibly held long;
- memory pressure;
- flush storm.

Better:

```text
select IDs in pages outside long transaction
for each page or item:
  run short transaction
  clear persistence context
```

Example:

```java
public void processDueEscalations() {
    while (true) {
        List<Long> ids = caseRepository.findNextDueEscalationIds(100);
        if (ids.isEmpty()) return;

        for (Long id : ids) {
            escalationTxService.escalateOne(id);
        }
    }
}

@Service
class EscalationTxService {
    @Transactional
    public void escalateOne(long caseId) {
        CaseEntity c = caseRepository.findByIdForUpdate(caseId);
        c.escalateIfStillDue(clock.now());
        outboxRepository.insert(...);
    }
}
```

---

## 17. Batch Processing: One Huge Transaction vs Many Small Transactions

Suppose you need to update 100,000 rows.

Bad:

```java
@Transactional
public void migrateAll() {
    List<Row> rows = repository.findAll();
    for (Row row : rows) {
        row.fix();
    }
}
```

Failure modes:

- undo log grows;
- locks held too long;
- replication lag can spike;
- rollback could be huge;
- transaction may hit timeout;
- buffer pool churn;
- application memory pressure.

Better:

```text
repeat:
  claim N rows
  update N rows in one short transaction
  commit
  sleep small amount if needed
```

Example SQL:

```sql
UPDATE case_document
SET normalized = 1,
    normalized_at = NOW(6)
WHERE normalized = 0
ORDER BY id
LIMIT 500;
```

But note: `UPDATE ... LIMIT` with ordering and indexes must be tested carefully.

For deterministic chunking:

```sql
SELECT id
FROM case_document
WHERE normalized = 0
  AND id > ?
ORDER BY id
LIMIT 500;
```

Then:

```sql
UPDATE case_document
SET normalized = 1,
    normalized_at = NOW(6)
WHERE id IN (...)
  AND normalized = 0;
```

Each chunk commits separately.

---

## 18. Read-Only Transactions: Not a Performance Magic Wand

Spring allows:

```java
@Transactional(readOnly = true)
public CaseView getCase(long id) {
    ...
}
```

This is a useful declaration of intent.

But do not assume it magically makes every query faster.

Read-only can help framework behavior:

- avoid dirty flush in ORM;
- communicate intent;
- maybe set connection read-only;
- enable routing to replica in custom datasource;
- make accidental writes easier to catch in some setups.

But in MySQL, consistent read still uses MVCC semantics. A long read-only transaction can still hold a snapshot and delay purge.

Bad:

```java
@Transactional(readOnly = true)
public Stream<CaseRow> streamAllCases() {
    return repository.streamAll();
}
```

If caller processes stream slowly, transaction and connection can remain open long.

Better:

- page results;
- avoid exposing DB-backed stream outside service;
- use explicit cursor/fetch carefully;
- set timeouts;
- avoid transaction for simple autocommit reads unless snapshot consistency is required.

---

## 19. Transaction Boundary and Read/Write Splitting

Some systems route:

- writes to primary;
- reads to replica.

Connector/J supports replication-aware connections and can route queries based on `Connection.getReadOnly()` in certain configurations. Official Connector/J docs describe source/replica replication connection support and query routing based on read-only state. [MySQL Connector/J Developer Guide — Source/Replica Replication](https://dev.mysql.com/doc/connector-j/en/connector-j-source-replica-replication-connection.html)

This creates application-level consistency issues.

Example:

```text
POST /cases/123/approve
  write primary
  commit
  return success

GET /cases/123
  routed to replica
  replica lagging
  returns old status
```

This violates user expectation of read-your-writes.

Strategies:

- after write, route user/session reads to primary for short window;
- critical reads always primary;
- use GTID/replication position awareness where available;
- separate reporting queries from command confirmation queries;
- do not route transactional command reads to replica;
- make stale-read tolerance explicit per use case.

For regulatory state transitions, stale reads can be legally/operationally dangerous.

Example:

- officer approves enforcement action;
- UI reads replica and still shows “PENDING_APPROVAL”;
- officer retries approval;
- second command conflicts or creates duplicate audit attempt.

Idempotency and primary-read-after-write reduce harm.

---

## 20. Transaction Anti-Patterns

### 20.1 Transaction Around Whole Controller

Bad:

```java
@PostMapping("/cases/{id}/approve")
@Transactional
public ResponseEntity<?> approve(@PathVariable long id) {
    ...
}
```

Controller often includes:

- request mapping;
- auth context;
- validation;
- response building;
- logging;
- external orchestration.

Keep transaction in service layer where invariant is managed.

### 20.2 Transaction Around External API Call

Already discussed. Avoid.

### 20.3 Transaction Around User Think Time

Never hold DB transaction while waiting for user input.

Use draft state, reservation expiry, optimistic lock, or workflow state.

### 20.4 Catching Exception and Continuing Without Rollback Awareness

Bad:

```java
@Transactional
public void process() {
    try {
        updateA();
        updateB();
    } catch (Exception e) {
        log.warn("ignored", e);
    }
    updateC();
}
```

Depending on exception and transaction manager state, transaction may be marked rollback-only. Later commit can fail unexpectedly.

### 20.5 Publishing Event Inside Transaction

Use outbox unless event semantics are explicitly best-effort non-transactional.

### 20.6 Mixing Different Aggregate Updates Casually

Bad:

```java
@Transactional
public void approveCaseAndUpdateTenOtherThings(...) {
    updateCase();
    updateUserStats();
    updateDashboardCounters();
    updateSearchProjection();
    updateNotificationState();
}
```

Ask:

- Which changes must be atomically consistent?
- Which can be derived asynchronously?
- Which should be eventual?
- Which should be outbox consumers?

### 20.7 Long Report in Transaction

Reports often do not need a single transaction snapshot. If they do, design explicitly because long snapshot can hurt purge.

---

## 21. Designing Transactional Service Methods

A strong service method has clear phases.

### 21.1 Command Handler Shape

Recommended shape:

```text
1. Accept command with idempotency key.
2. Do cheap syntactic validation outside transaction.
3. Do external reads/calls outside transaction if they do not need locked state.
4. Enter transaction.
5. Claim idempotency key or detect replay.
6. Load and lock aggregate if needed.
7. Re-check state/version/invariants.
8. Apply mutation.
9. Insert audit/outbox rows.
10. Commit.
11. Return result.
12. Let async relay publish side effects.
```

### 21.2 Example: Approve Case

```java
public ApprovalResponse approve(ApproveCaseRequest request) {
    validateSyntax(request);

    ExternalRiskResult risk = riskClient.preCheck(request.subjectId());

    return approvalTransaction.approveInTransaction(
        new ApproveCaseCommand(
            request.caseId(),
            request.actorId(),
            request.idempotencyKey(),
            risk.decision(),
            request.expectedVersion()
        )
    );
}
```

Transactional service:

```java
@Service
public class ApprovalTransaction {

    @Transactional(timeout = 5)
    public ApprovalResponse approveInTransaction(ApproveCaseCommand cmd) {
        IdempotencyDecision idem = idempotencyService.claim(
            cmd.idempotencyKey(),
            "APPROVE_CASE",
            cmd.requestHash()
        );

        if (idem.isReplay()) {
            return idem.previousResponse(ApprovalResponse.class);
        }

        CaseEntity c = caseRepository.findByIdForUpdate(cmd.caseId())
            .orElseThrow(() -> new NotFoundException("case not found"));

        if (c.version() != cmd.expectedVersion()) {
            throw new ConcurrentChangeException();
        }

        c.approve(cmd.actorId(), cmd.riskDecision());

        caseRepository.save(c);
        auditRepository.insertStateTransition(c.transitionAudit());
        outboxRepository.insert(CaseApprovedEvent.from(c));

        ApprovalResponse response = ApprovalResponse.from(c);
        idempotencyService.complete(cmd.idempotencyKey(), response);

        return response;
    }
}
```

Design notes:

- transaction short;
- external risk call outside transaction;
- version rechecked inside transaction;
- state mutation, audit, outbox atomically committed;
- idempotency row prevents duplicate command;
- event publishing happens later.

---

## 22. Where to Put Audit Rows

There are multiple audit categories.

### 22.1 State Transition Audit

Must be atomic with state change.

Example:

```sql
INSERT INTO case_state_audit (
    case_id,
    from_status,
    to_status,
    actor_id,
    reason_code,
    occurred_at
) VALUES (?, ?, ?, ?, ?, NOW(6));
```

This belongs in the same transaction.

### 22.2 Access Audit

Example:

```text
User viewed confidential case file.
```

This may be written separately, often with best-effort or durable logging pipeline.

### 22.3 Attempt Audit

Example:

```text
User attempted approval but failed permission check.
```

This may commit even though state does not change.

Design implication:

Do not use one audit table/model for all semantics without distinguishing event kind.

---

## 23. Savepoints: Useful but Not a Substitute for Good Boundary

MySQL supports savepoints inside transactions:

```sql
START TRANSACTION;

UPDATE ...;
SAVEPOINT before_optional_part;

UPDATE optional_table ...;

ROLLBACK TO SAVEPOINT before_optional_part;

COMMIT;
```

Use cases:

- optional sub-operation failure;
- partial rollback inside larger unit;
- complex import where some item can fail but batch transaction continues.

But beware:

- savepoint does not make external side effect rollbackable;
- locks may still be held until outer transaction ends;
- business semantics can become hard to reason about;
- nested transaction abstraction can hide complexity.

If you need many savepoints, reconsider aggregate boundary.

---

## 24. Transaction Size Checklist

A transaction is probably too large if:

- it includes network I/O;
- it processes thousands of rows;
- it lasts longer than normal request budget;
- it has user wait time;
- it holds locks while doing CPU-heavy work;
- it spans unrelated aggregates;
- rollback would be operationally painful;
- deadlock retry would duplicate external side effect;
- it causes replication lag spikes;
- it makes HikariCP pool exhaustion likely;
- it requires high timeout to “work”.

A transaction is probably too small if:

- business invariant spans multiple statements but each autocommits;
- audit row can be committed without state change;
- event row can be committed without aggregate mutation;
- uniqueness check and insert are not atomic;
- read-check-update race is possible;
- state transition guard is outside mutation.

---

## 25. Practical Failure Modeling

### 25.1 Case Approval Failure Matrix

Operation:

```text
approve case
```

Steps:

```text
1. receive request
2. validate actor permission
3. external risk check
4. start transaction
5. claim idempotency key
6. lock case
7. validate state
8. update case
9. insert audit
10. insert outbox
11. commit
12. return response
13. outbox relay publishes event
```

Failure analysis:

| Failure Point | DB State | External State | Correct Handling |
|---|---:|---:|---|
| Before transaction | unchanged | maybe risk checked | safe retry |
| After idempotency insert before commit | rolled back if tx aborts | none | safe retry |
| After case update before commit | not visible if rollback | none | rollback/retry |
| After commit before response | changed | outbox persisted | query by idempotency key and replay |
| After response before publish | changed | event not yet published | outbox relay eventually publishes |
| Publish succeeded before mark sent | changed | event published | relay may duplicate; consumer idempotent |

This table is the level of thinking expected in production-grade transaction design.

---

## 26. Transaction and Domain Invariants

A transaction should protect specific invariants.

Bad requirement:

```text
Make approval safe.
```

Better invariant:

```text
A case can transition from UNDER_REVIEW to APPROVED only once, by an authorized actor, if all required documents are complete, and the transition audit must exist exactly once for the committed transition.
```

Mapping:

- state guard in `WHERE` clause or locked row validation;
- actor authorization checked using current role/scope;
- document completeness checked inside transaction if it can change concurrently;
- unique audit/event key;
- idempotency key for command retries;
- outbox for event emission.

Example constraints:

```sql
ALTER TABLE case_state_audit
ADD UNIQUE KEY uk_case_transition_once (
    case_id,
    from_status,
    to_status,
    transition_version
);
```

Example guarded update:

```sql
UPDATE regulatory_case
SET status = 'APPROVED',
    version = version + 1,
    approved_by = ?,
    approved_at = NOW(6)
WHERE id = ?
  AND status = 'UNDER_REVIEW'
  AND version = ?;
```

If affected rows = 0, the invariant was not satisfied at mutation time.

---

## 27. Transaction Boundary with Message Consumers

Message consumers must assume at-least-once delivery unless proven otherwise.

Pattern:

```text
receive message
start transaction
  insert into inbox table with unique message_id
  if duplicate, skip/replay
  apply mutation
  insert outbox if needed
commit
ack message
```

Inbox table:

```sql
CREATE TABLE inbox_message (
    message_id VARCHAR(128) NOT NULL,
    source VARCHAR(64) NOT NULL,
    received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    processed_at TIMESTAMP(6) NULL,
    status VARCHAR(32) NOT NULL,
    PRIMARY KEY (message_id, source)
) ENGINE=InnoDB;
```

Consumer:

```java
@Transactional
public void handle(CaseSubmittedMessage msg) {
    boolean firstTime = inboxRepository.tryInsert(msg.messageId(), msg.source());
    if (!firstTime) {
        return;
    }

    caseRepository.createOrUpdateFromSubmission(msg);
    inboxRepository.markProcessed(msg.messageId(), msg.source());
    outboxRepository.insert(...);
}
```

Ack after commit:

```text
commit successful -> ack broker
commit failed -> do not ack; message redelivered
```

If ack succeeds but response to broker fails, broker may redeliver. Inbox unique key protects duplicate processing.

---

## 28. Transaction Boundary and Cache

Cache update is external side effect.

Bad:

```java
@Transactional
public void updateCase(...) {
    caseRepository.save(...);
    cache.put(caseId, newValue);
}
```

If DB rollback, cache contains value that does not exist.

Also bad:

```java
@Transactional
public void updateCase(...) {
    cache.evict(caseId);
    caseRepository.save(...);
}
```

If DB rollback, cache evicted unnecessarily. Usually less dangerous, but can cause inconsistency if repopulated before commit.

Common options:

1. evict after commit using transaction synchronization;
2. use outbox event consumed by cache invalidator;
3. use short TTL and tolerate temporary inconsistency;
4. read-through cache with version checks;
5. avoid caching mutable workflow state unless needed.

For regulatory state, stale cache can cause wrong UI/action availability. Treat cache as projection, not source of truth.

---

## 29. Transaction Synchronization: After Commit Hooks

Sometimes you need to run code after commit.

In Spring, transaction synchronization can register after-commit actions.

Conceptually:

```java
@Transactional
public void approveCase(...) {
    updateDb();

    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                cache.evict(caseId);
            }
        }
    );
}
```

But beware:

- after-commit action is not durable;
- if app crashes after commit before hook runs, action is lost;
- for critical side effects, prefer outbox;
- for cache invalidation, after-commit may be acceptable depending on tolerance.

Rule:

```text
Critical durable side effect -> outbox.
Best-effort local cleanup -> afterCommit hook acceptable.
```

---

## 30. Practical Timeout and Retry Policy Example

For a typical command endpoint:

```text
POST /cases/{id}/approve
```

Possible budget:

```text
HTTP timeout:                  10s
service-level target:           2s
external pre-check timeout:      1s
transaction timeout:             3s
single query timeout:            2s
connection acquisition timeout:  200ms-500ms
max retry for deadlock:          2-3 attempts
```

Do not copy these numbers blindly. The key is hierarchy.

Retry policy:

```text
Retry:
  deadlock
  transient lock wait timeout if command idempotent
  transient connection acquisition failure maybe at outer layer

Do not blindly retry:
  validation failure
  permission failure
  duplicate business key unless mapped to idempotency replay
  syntax/schema error
  data truncation
  foreign key violation caused by invalid command
```

Retry must be observable:

- count retries;
- log SQLState/error code;
- include command id/idempotency key;
- include aggregate id;
- alert if retry rate spikes.

---

## 31. MySQL Error Categories for Application Design

At application layer, classify errors by response strategy.

### 31.1 Business Conflict

Examples:

- case already approved;
- version mismatch;
- duplicate idempotency with different request hash;
- invalid transition.

Response:

- return 409 Conflict or domain-specific error;
- no retry unless user refreshes state.

### 31.2 Transient Concurrency Failure

Examples:

- deadlock victim;
- lock wait timeout;
- temporary connection issue.

Response:

- bounded retry if idempotent;
- otherwise return retryable error.

### 31.3 Infrastructure Failure

Examples:

- DB unavailable;
- connection pool exhausted;
- failover in progress;
- disk full.

Response:

- fail fast;
- circuit breaker/backpressure;
- operator alert;
- maybe no retry at request level.

### 31.4 Data/Schema Bug

Examples:

- data too long;
- unknown column;
- constraint missing;
- migration mismatch.

Response:

- do not retry;
- fix deployment/schema/data.

---

## 32. A Transaction Design Review Checklist

Before approving production code, ask:

### Boundary

- What exact invariant does this transaction protect?
- Is every statement inside needed for that invariant?
- Can any operation move outside transaction?
- Does transaction include network I/O?
- Does transaction include large loop/batch?

### Concurrency

- What rows are locked?
- In what order are locks acquired?
- Are predicates backed by indexes?
- What happens if another transaction changes state between read and write?
- Is there optimistic version check or pessimistic lock?

### Failure

- What happens if deadlock occurs?
- Is retry safe?
- What happens if commit succeeds but response is lost?
- Is there idempotency key?
- Are external side effects durable or best-effort?

### Timeout

- What is transaction timeout?
- What is query timeout?
- What is lock wait timeout?
- What is HTTP timeout?
- Are they aligned?

### Observability

- Can we identify slow transaction?
- Can we see retry count?
- Can we trace idempotency key?
- Can we inspect lock waits?
- Can we distinguish business conflict from DB incident?

### Operational

- What is rollback cost?
- What is replication impact?
- What happens during failover?
- Can this be replayed from message queue?
- Is audit legally defensible?

---

## 33. Compact Patterns

### 33.1 Safe State Transition Pattern

```text
outside transaction:
  validate syntax
  perform non-locking external pre-checks if needed

inside transaction:
  claim idempotency key
  lock aggregate row
  verify expected state/version
  apply state transition
  write audit row
  write outbox row
  store idempotency result
commit
```

### 33.2 Safe Consumer Pattern

```text
receive message
inside transaction:
  insert inbox message_id unique key
  if duplicate -> return
  apply mutation
  insert outbox event if needed
commit
ack message
```

### 33.3 Safe Batch Pattern

```text
select small chunk of IDs
for each chunk:
  transaction:
    update chunk with deterministic predicate
    write progress/audit if needed
  commit
  observe lag/load
```

### 33.4 Safe External Event Pattern

```text
inside business transaction:
  insert outbox event
commit

outside transaction:
  relay publishes event
  mark sent or retry
consumer idempotent
```

---

## 34. Mini Case Study: Approval Workflow Gone Wrong

### 34.1 Initial Implementation

```java
@Transactional
public void approve(long caseId, long actorId) {
    CaseEntity c = caseRepository.findById(caseId).orElseThrow();

    if (!permissionClient.canApprove(actorId, caseId)) {
        throw new ForbiddenException();
    }

    RiskResult risk = riskClient.check(c.getSubjectId());

    c.setStatus(APPROVED);
    c.setApprovedBy(actorId);

    caseRepository.save(c);

    kafkaTemplate.send("case-events", new CaseApproved(caseId));
    emailClient.sendApprovalEmail(c.getOwnerEmail());
}
```

### 34.2 Failure Modes

- permission call inside transaction;
- risk call inside transaction;
- no `FOR UPDATE` or version guard;
- event published before commit certainty;
- email sent before commit certainty;
- no idempotency;
- no audit row atomically tied to state;
- no outbox;
- retry can send duplicate email/event;
- concurrent approval race possible;
- transaction lifetime includes network latency.

### 34.3 Improved Implementation

```java
public ApprovalResponse approve(ApproveRequest request) {
    validateSyntax(request);

    PermissionDecision permission = permissionClient.canApprove(
        request.actorId(),
        request.caseId()
    );

    if (!permission.allowed()) {
        throw new ForbiddenException();
    }

    CaseApprovalSnapshot snapshot = caseQueryService.getApprovalSnapshot(request.caseId());

    RiskResult risk = riskClient.check(snapshot.subjectId());

    return approvalTx.approve(
        new ApproveCommand(
            request.caseId(),
            request.actorId(),
            request.idempotencyKey(),
            request.expectedVersion(),
            risk
        )
    );
}
```

Transactional part:

```java
@Transactional(timeout = 3)
public ApprovalResponse approve(ApproveCommand cmd) {
    IdempotencyDecision idem = idempotencyRepository.claim(
        cmd.idempotencyKey(),
        "APPROVE_CASE",
        cmd.hash()
    );

    if (idem.isReplay()) {
        return idem.responseAs(ApprovalResponse.class);
    }

    CaseEntity c = caseRepository.findByIdForUpdate(cmd.caseId())
        .orElseThrow();

    c.assertVersion(cmd.expectedVersion());
    c.assertStatus(UNDER_REVIEW);
    c.approve(cmd.actorId(), cmd.riskResult());

    caseRepository.save(c);
    auditRepository.insertTransition(c.transitionAudit());
    outboxRepository.insert(CaseApprovedEvent.from(c));

    ApprovalResponse response = ApprovalResponse.from(c);
    idempotencyRepository.complete(cmd.idempotencyKey(), response);

    return response;
}
```

Now:

- external calls outside transaction;
- locked row only during short mutation;
- idempotency protects retry;
- audit and outbox are atomic with state change;
- event/email handled asynchronously by outbox consumers;
- version check prevents applying stale external validation;
- transaction timeout is small and meaningful.

---

## 35. What Top Engineers Internalize

A strong MySQL + Java engineer does not ask only:

```text
Does this method have @Transactional?
```

They ask:

```text
What invariant does this transaction protect?
Which rows does it lock?
For how long?
What happens if it deadlocks?
What happens if commit succeeds but response is lost?
What happens if external side effect succeeds but DB rolls back?
Can this command be retried safely?
Can the audit trail be defended?
Can a replica return stale state?
What does the user see during failure?
```

This is the difference between using MySQL and engineering with MySQL.

---

## 36. Summary

Key takeaways:

1. Transaction boundary is an application design boundary, not just a technical annotation.
2. Keep transactions short, deterministic, and mostly database-only.
3. `@Transactional` depends on proxy mechanics, propagation, rollback rules, and method call path.
4. Do not put external side effects inside database transactions.
5. Use outbox for durable event publishing.
6. Use idempotency keys for retry-safe commands.
7. Retry whole transactional commands, not random individual statements.
8. Align HTTP, transaction, query, lock wait, socket, and pool timeouts.
9. State transitions should encode invariants through locking, version checks, guarded updates, constraints, audit, and outbox.
10. Production transaction design must include failure modeling.

---

## 37. References

- MySQL 8.4 Reference Manual — `START TRANSACTION`, `COMMIT`, and `ROLLBACK`: https://dev.mysql.com/doc/en/commit.html
- MySQL 8.4 Reference Manual — InnoDB Locking and Transaction Model: https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-transaction-model.html
- MySQL 8.4 Reference Manual — Transaction Isolation Levels: https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html
- MySQL Connector/J Developer Guide — Source/Replica Replication Connections: https://dev.mysql.com/doc/connector-j/en/connector-j-source-replica-replication-connection.html
- Spring Framework Reference — Using `@Transactional`: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html
- Spring Framework Reference — Transaction Propagation: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html
- Oracle Java Tutorials — Using Transactions: https://docs.oracle.com/javase/tutorial/jdbc/basics/transactions.html

---

## 38. Status Seri

Seri belum selesai.

Progress saat ini:

- Selesai: Part 000 sampai Part 015
- Berikutnya: Part 016 — `JDBC, Connector/J, HikariCP, and MySQL Protocol Details`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Pagination, Search, Filtering, and Case-Management Query Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-016.md">Part 016 — JDBC, Connector/J, HikariCP, and MySQL Protocol Details ➡️</a>
</div>
