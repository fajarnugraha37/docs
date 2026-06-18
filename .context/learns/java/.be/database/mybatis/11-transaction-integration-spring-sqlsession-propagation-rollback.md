# Part 11 — Transaction Integration: Spring, SqlSession, Propagation, Rollback

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `11-transaction-integration-spring-sqlsession-propagation-rollback.md`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami transaction integration MyBatis secara benar, terutama saat digunakan bersama Spring/Spring Boot.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas mapper method sebagai API contract. Namun mapper method saja belum cukup untuk menjamin correctness. Dalam aplikasi production, query yang benar bisa tetap menghasilkan sistem yang salah bila transaction boundary-nya salah.

Bagian ini menjawab pertanyaan inti:

1. Siapa yang membuka koneksi database?
2. Siapa yang memegang `SqlSession`?
3. Kapan perubahan di-commit?
4. Kapan perubahan di-rollback?
5. Apa yang terjadi kalau satu service memanggil banyak mapper?
6. Bagaimana `@Transactional` Spring berhubungan dengan MyBatis?
7. Apa risiko mixing MyBatis, JPA, JDBC, event publishing, dan external call dalam satu flow?
8. Bagaimana mendesain transaction boundary untuk sistem enterprise/case-management yang punya state transition, audit, approval, escalation, dan integration event?

Target akhir bagian ini bukan sekadar tahu cara menulis:

```java
@Transactional
public void submitCase(...) { ... }
```

Tetapi mampu menjawab:

> Apakah method ini membentuk satu unit of work yang benar, tahan error, bisa di-retry, tidak bocor session, tidak commit sebagian, tidak menahan lock terlalu lama, dan tidak membuat efek samping eksternal menjadi tidak konsisten?

---

## 2. Mental Model Utama

MyBatis sendiri punya konsep transaction melalui `SqlSession`. Dalam penggunaan manual, aplikasi bisa membuka `SqlSession`, menjalankan statement, lalu melakukan `commit()` atau `rollback()`.

Namun dalam aplikasi Spring, biasanya kita **tidak** mengelola `SqlSession` secara manual. MyBatis-Spring menghubungkan MyBatis ke Spring transaction management. Ketika Spring transaction aktif, satu `SqlSession` akan diikat ke transaction tersebut dan digunakan selama transaction berjalan. Session itu akan di-commit atau di-rollback mengikuti hasil transaction Spring.

Mental model yang paling aman:

```text
Service method
  owns transaction boundary

Mapper method
  owns SQL statement contract

SqlSessionTemplate / MyBatis-Spring
  bridges mapper call into transaction-bound SqlSession

Spring PlatformTransactionManager
  owns commit/rollback decision

Database connection
  executes SQL under transaction isolation
```

Artinya:

```text
Mapper tidak boleh menjadi pemilik transaction semantics.
Service/application use-case-lah yang menentukan unit of work.
```

---

## 3. Transaction Bukan Sekadar “Rollback Kalau Error”

Banyak developer memahami transaction terlalu sempit:

```text
transaction = kalau error maka rollback
```

Itu benar, tapi tidak lengkap.

Dalam sistem nyata, transaction juga menentukan:

1. **atomicity** — apakah beberapa perubahan harus sukses/gagal bersama.
2. **visibility** — kapan perubahan terlihat oleh transaction lain.
3. **isolation** — bagaimana pembacaan/penulisan bersamaan berinteraksi.
4. **lock lifetime** — berapa lama row/table/index lock ditahan.
5. **cache consistency** — kapan cache/session melihat data lama atau baru.
6. **error boundary** — exception mana yang menyebabkan rollback.
7. **retry boundary** — bagian mana yang aman diulang.
8. **side-effect boundary** — kapan email/event/API call boleh dilakukan.

Contoh sederhana:

```java
@Transactional
public void approveCase(Long caseId, Long officerId) {
    caseMapper.updateStatus(caseId, "APPROVED");
    auditMapper.insertAudit(caseId, "APPROVED", officerId);
    notificationClient.sendApprovedEmail(caseId); // bahaya bila dilakukan di dalam transaction
}
```

Secara SQL mungkin benar. Tapi secara transaction design ada pertanyaan besar:

- Kalau email berhasil dikirim tapi transaction rollback, user menerima email untuk approval yang tidak pernah tersimpan.
- Kalau transaction commit tapi email gagal, database sudah approved tetapi notifikasi tidak terkirim.
- Kalau external call lambat, lock database ditahan lebih lama.

Jadi transaction boundary harus dipahami sebagai **consistency boundary**, bukan hanya annotation.

---

## 4. MyBatis Tanpa Spring: Manual SqlSession Transaction

MyBatis core dapat digunakan tanpa Spring.

Contoh manual:

```java
try (SqlSession session = sqlSessionFactory.openSession(false)) {
    CaseMapper caseMapper = session.getMapper(CaseMapper.class);
    AuditMapper auditMapper = session.getMapper(AuditMapper.class);

    caseMapper.updateStatus(caseId, "SUBMITTED");
    auditMapper.insertAudit(caseId, "SUBMITTED");

    session.commit();
} catch (Exception ex) {
    // try-with-resources closes the session; explicit rollback is often used before closing
    throw ex;
}
```

Lebih eksplisit:

```java
SqlSession session = sqlSessionFactory.openSession(false);
try {
    CaseMapper caseMapper = session.getMapper(CaseMapper.class);
    AuditMapper auditMapper = session.getMapper(AuditMapper.class);

    caseMapper.updateStatus(caseId, "SUBMITTED");
    auditMapper.insertAudit(caseId, "SUBMITTED");

    session.commit();
} catch (Exception ex) {
    session.rollback();
    throw ex;
} finally {
    session.close();
}
```

Di sini aplikasi bertanggung jawab langsung atas:

- membuka session;
- memilih auto-commit atau manual commit;
- commit;
- rollback;
- close;
- memastikan semua mapper yang terlibat memakai session yang sama.

Ini cocok untuk:

- aplikasi kecil tanpa Spring;
- command-line batch sederhana;
- migration utility;
- internal tooling;
- kasus di mana dependency Spring tidak diinginkan.

Namun untuk aplikasi enterprise Spring Boot, manual session hampir selalu lebih rawan daripada menggunakan Spring transaction.

---

## 5. MyBatis Dengan Spring: Siapa Mengatur Apa?

Saat menggunakan MyBatis-Spring:

```text
Mapper proxy
  -> SqlSessionTemplate
      -> transaction-bound SqlSession
          -> JDBC Connection from DataSourceTransactionManager
```

`SqlSessionTemplate` adalah implementasi `SqlSession` yang dikelola Spring, thread-safe, dan memastikan session aktual yang digunakan adalah session yang terkait dengan Spring transaction saat ini.

Contoh service:

```java
@Service
public class CaseSubmissionService {

    private final CaseMapper caseMapper;
    private final AuditMapper auditMapper;

    public CaseSubmissionService(CaseMapper caseMapper, AuditMapper auditMapper) {
        this.caseMapper = caseMapper;
        this.auditMapper = auditMapper;
    }

    @Transactional
    public void submit(SubmitCaseCommand command) {
        int updated = caseMapper.markSubmitted(command.caseId(), command.submittedBy());
        if (updated != 1) {
            throw new IllegalStateException("Case cannot be submitted");
        }

        auditMapper.insertSubmissionAudit(command.caseId(), command.submittedBy());
    }
}
```

Dalam contoh ini:

- service method membuka Spring transaction;
- mapper tidak tahu ada transaction annotation;
- MyBatis-Spring memakai session yang terikat dengan transaction;
- commit terjadi setelah method selesai normal;
- rollback terjadi bila transaction manager memutuskan rollback.

Yang penting:

```text
@Transactional diletakkan di service/use-case layer, bukan mapper layer.
```

---

## 6. Mapper Tidak Boleh Mengatur Commit/Rollback

Dalam kode Spring, jangan lakukan ini:

```java
@Repository
public class BadCaseRepository {
    private final SqlSession sqlSession;

    public void updateSomething(...) {
        sqlSession.update("...");
        sqlSession.commit(); // buruk dalam Spring-managed transaction
    }
}
```

Masalahnya:

1. Commit manual bisa bertabrakan dengan Spring transaction.
2. Boundary business use-case menjadi pecah.
3. Service tidak lagi bisa menjamin atomicity lintas mapper.
4. Testing menjadi misleading.
5. Saat ada rollback di service, sebagian perubahan mungkin sudah commit.

Dalam Spring-managed MyBatis, commit/rollback harus ditentukan oleh transaction manager, bukan DAO/mapper.

---

## 7. Unit of Work: Cara Menentukan Transaction Boundary

Transaction boundary idealnya mengikuti **business unit of work**.

Contoh unit of work:

```text
Submit application
  - validate current status
  - update status to SUBMITTED
  - create audit trail
  - insert workflow task
  - persist domain event/outbox record
```

Ini seharusnya satu transaction karena perubahan-perubahan itu merepresentasikan satu fakta bisnis.

Bukan unit of work yang baik:

```text
Submit application
  - update status
  - send email via SMTP
  - call external scoring API
  - upload file to object storage
  - wait for external response
  - write audit
```

Di sini transaction database dicampur dengan side effect eksternal. Lebih baik:

```text
Transaction A:
  - update status
  - write audit
  - write outbox event

After commit / async worker:
  - send email
  - call external API
  - update delivery status
```

Prinsip:

```text
Database transaction should protect database consistency.
External side effects need their own reliability pattern.
```

---

## 8. Transaction Boundary Layering

Struktur umum yang sehat:

```text
Controller / API Adapter
  - parse request
  - authenticate/authorize high-level
  - call application service

Application Service / Use Case
  - owns @Transactional
  - orchestrates mapper calls
  - enforces business workflow
  - emits outbox/event records

Mapper
  - SQL execution contract
  - no business orchestration
  - no commit/rollback

Database
  - constraints
  - indexes
  - isolation
  - locking
```

Contoh:

```java
@RestController
class CaseController {
    private final SubmitCaseUseCase submitCaseUseCase;

    @PostMapping("/cases/{caseId}/submit")
    ResponseEntity<Void> submit(@PathVariable long caseId, @RequestBody SubmitCaseRequest request) {
        submitCaseUseCase.submit(new SubmitCaseCommand(caseId, request.submittedBy()));
        return ResponseEntity.noContent().build();
    }
}
```

```java
@Service
class SubmitCaseUseCase {
    private final CaseMapper caseMapper;
    private final AuditMapper auditMapper;
    private final OutboxMapper outboxMapper;

    @Transactional
    public void submit(SubmitCaseCommand command) {
        int updated = caseMapper.transitionStatus(
            command.caseId(),
            "DRAFT",
            "SUBMITTED",
            command.submittedBy()
        );

        if (updated != 1) {
            throw new InvalidCaseTransitionException(command.caseId(), "DRAFT", "SUBMITTED");
        }

        auditMapper.insertAudit(AuditRecord.caseSubmitted(command));
        outboxMapper.insertEvent(OutboxEvent.caseSubmitted(command));
    }
}
```

Mapper XML:

```xml
<update id="transitionStatus">
  UPDATE case_main
  SET status = #{toStatus},
      updated_by = #{updatedBy},
      updated_at = CURRENT_TIMESTAMP,
      version = version + 1
  WHERE case_id = #{caseId}
    AND status = #{fromStatus}
</update>
```

Kenapa ini kuat?

- State transition atomic.
- Audit hanya masuk bila transition berhasil.
- Outbox hanya masuk bila transition berhasil.
- External notification tidak terjadi sebelum commit.
- Rows affected menjadi correctness signal.

---

## 9. Propagation: Transaction Ada atau Dibuat Baru?

Spring transaction propagation menentukan bagaimana method transactional berperilaku saat dipanggil dari method lain yang sudah punya transaction.

Yang paling sering:

| Propagation | Makna Praktis |
|---|---|
| `REQUIRED` | Pakai transaction yang ada; kalau belum ada, buat baru. Default. |
| `REQUIRES_NEW` | Suspend transaction saat ini, buat transaction baru. |
| `SUPPORTS` | Ikut transaction bila ada; kalau tidak ada, jalan tanpa transaction. |
| `MANDATORY` | Harus ada transaction; kalau tidak ada, error. |
| `NOT_SUPPORTED` | Jalan tanpa transaction; suspend transaction yang ada. |
| `NEVER` | Harus tidak ada transaction. |
| `NESTED` | Nested transaction/savepoint jika didukung. |

Untuk MyBatis service biasa, default `REQUIRED` biasanya benar.

```java
@Transactional
public void approveCase(...) {
    approvalService.validateAndApprove(...); // ikut transaction yang sama bila REQUIRED
    auditService.recordApproval(...);        // ikut transaction yang sama bila REQUIRED
}
```

---

## 10. `REQUIRED`: Default yang Paling Aman untuk Use Case

Contoh:

```java
@Service
class ApprovalService {
    @Transactional
    public void approve(long caseId, long officerId) {
        caseMapper.approve(caseId, officerId);
        auditMapper.insertApprovalAudit(caseId, officerId);
    }
}
```

Jika method ini dipanggil dari luar tanpa transaction, Spring membuat transaction baru.

Jika dipanggil dari method lain yang sudah transaction:

```java
@Transactional
public void approveAndAssign(...) {
    approvalService.approve(...); // ikut transaction existing
    assignmentService.assign(...); // ikut transaction existing
}
```

Maka semua operasi berada dalam satu unit of work.

Ini baik bila semua operasi memang harus atomic bersama.

---

## 11. `REQUIRES_NEW`: Berguna Tapi Berbahaya

`REQUIRES_NEW` membuat transaction baru yang independen dari transaction luar.

Contoh penggunaan yang sering terlihat:

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void writeAuditEvenIfMainFails(AuditRecord record) {
    auditMapper.insertAudit(record);
}
```

Ini bisa berguna untuk:

- audit teknis yang harus tercatat walau business transaction gagal;
- retry log;
- dead letter record;
- failure diagnostic;
- out-of-band progress tracking.

Tapi berbahaya bila digunakan sembarangan.

Contoh buruk:

```java
@Transactional
public void submitCase(...) {
    caseMapper.markSubmitted(...);
    auditService.insertAuditRequiresNew(...);
    throw new RuntimeException("fail after audit");
}
```

Hasil:

```text
case status rollback
 audit tetap commit
```

Apakah itu benar? Tergantung jenis audit.

Untuk **business audit**, biasanya salah, karena audit menyatakan perubahan bisnis yang ternyata tidak commit.

Untuk **technical failure log**, bisa benar, karena log menyatakan percobaan gagal.

Prinsip:

```text
REQUIRES_NEW should represent a consciously separate fact.
```

Jangan pakai `REQUIRES_NEW` hanya untuk “memastikan audit masuk” tanpa membedakan audit bisnis vs audit teknis.

---

## 12. `NESTED` dan Savepoint

`NESTED` memakai savepoint dalam transaction yang sama jika transaction manager/database mendukung.

Contoh mental model:

```text
Outer transaction starts
  update A
  savepoint created
    update B
    error -> rollback to savepoint
  update C
Outer transaction commits A and C
```

Ini bukan transaction independen seperti `REQUIRES_NEW`.

`NESTED` bisa berguna untuk:

- partial validation step;
- optional sub-operation;
- batch chunk kecil dalam transaction besar;
- recoverable section.

Namun dalam sistem enterprise, `NESTED` perlu sangat hati-hati karena:

- dukungan bergantung transaction manager/database;
- perilaku bisa membingungkan tim;
- lock mungkin tetap ditahan sampai outer transaction selesai;
- tidak selalu menyelesaikan masalah partial failure.

Sering kali lebih mudah dan eksplisit memakai chunk transaction terpisah di service/batch boundary.

---

## 13. Isolation Level: Bukan Dekorasi

Isolation level menentukan fenomena concurrency apa yang bisa terjadi.

Level umum:

| Isolation | Intuisi |
|---|---|
| `READ_UNCOMMITTED` | Bisa membaca data belum commit; jarang layak. |
| `READ_COMMITTED` | Hanya baca data committed. Umum di banyak DB enterprise. |
| `REPEATABLE_READ` | Row yang sama dibaca konsisten dalam transaction. |
| `SERIALIZABLE` | Seolah transaction berjalan satu per satu; paling kuat dan mahal. |

Dalam Spring:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void approve(...) { ... }
```

Namun jangan berpikir isolation annotation selalu menyelesaikan race condition.

Contoh race:

```text
T1 reads case status = DRAFT
T2 reads case status = DRAFT
T1 updates to SUBMITTED
T2 updates to CANCELLED
```

Solusi lebih kuat di MyBatis biasanya bukan hanya menaikkan isolation, tetapi membuat update statement menjadi guarded:

```xml
<update id="submitIfDraft">
  UPDATE case_main
  SET status = 'SUBMITTED', version = version + 1
  WHERE case_id = #{caseId}
    AND status = 'DRAFT'
</update>
```

Lalu service mengecek rows affected:

```java
int updated = caseMapper.submitIfDraft(caseId);
if (updated != 1) {
    throw new InvalidTransitionException(caseId);
}
```

Ini sering lebih scalable daripada mengandalkan transaction isolation tinggi.

---

## 14. Read-Only Transaction

Spring mendukung:

```java
@Transactional(readOnly = true)
public CaseDetail getCaseDetail(long caseId) {
    return caseMapper.findDetail(caseId);
}
```

Read-only transaction bisa memberi sinyal ke transaction manager/database/driver bahwa operasi bersifat baca.

Namun jangan menjadikannya security boundary. Read-only transaction bukan pengganti permission database yang benar.

Gunakan untuk:

- query service;
- listing/search;
- report read kecil;
- consistency scope untuk beberapa SELECT;
- dokumentasi intensi.

Jangan gunakan untuk method yang mungkin menulis audit, update last_accessed, atau mark notification read.

Anti-pattern:

```java
@Transactional(readOnly = true)
public CaseDetail openCase(long caseId, long userId) {
    CaseDetail detail = caseMapper.findDetail(caseId);
    auditMapper.insertViewAudit(caseId, userId); // buruk: write dalam readOnly
    return detail;
}
```

Lebih jelas:

```java
@Transactional
public CaseDetail openCase(long caseId, long userId) {
    CaseDetail detail = caseMapper.findDetail(caseId);
    auditMapper.insertViewAudit(caseId, userId);
    return detail;
}
```

Atau pisahkan view audit menjadi async/outbox bila bukan bagian dari read consistency.

---

## 15. Rollback Rules: Checked Exception vs Runtime Exception

Default Spring transaction rollback umumnya terjadi pada unchecked exception (`RuntimeException`) dan `Error`, bukan checked exception biasa.

Contoh berbahaya:

```java
@Transactional
public void importFile(...) throws IOException {
    importMapper.insertRows(...);
    if (fileInvalid) {
        throw new IOException("Invalid file");
    }
}
```

Jika tidak dikonfigurasi, checked exception seperti `IOException` bisa tidak memicu rollback.

Pilihan desain:

### Opsi A — pakai domain runtime exception

```java
@Transactional
public void importFile(...) {
    try {
        importMapper.insertRows(...);
        validateFile(...);
    } catch (IOException ex) {
        throw new ImportFailedException("Import failed", ex);
    }
}
```

### Opsi B — konfigurasi rollbackFor

```java
@Transactional(rollbackFor = IOException.class)
public void importFile(...) throws IOException {
    importMapper.insertRows(...);
    validateFile(...);
}
```

Untuk enterprise codebase, biasanya lebih bersih memakai domain-specific runtime exception untuk business/application failure.

---

## 16. Jangan Menelan Exception di Dalam Transaction

Anti-pattern:

```java
@Transactional
public void submitCase(...) {
    try {
        caseMapper.markSubmitted(...);
        auditMapper.insertAudit(...);
    } catch (Exception ex) {
        log.warn("failed", ex);
    }
}
```

Masalah:

- Exception ditelan.
- Method selesai normal.
- Spring menganggap transaction sukses.
- Perubahan sebelum error bisa commit.

Lebih baik:

```java
@Transactional
public void submitCase(...) {
    try {
        caseMapper.markSubmitted(...);
        auditMapper.insertAudit(...);
    } catch (Exception ex) {
        log.warn("submit failed", ex);
        throw ex;
    }
}
```

Atau wrap:

```java
@Transactional
public void submitCase(...) {
    try {
        caseMapper.markSubmitted(...);
        auditMapper.insertAudit(...);
    } catch (Exception ex) {
        throw new CaseSubmissionFailedException(caseId, ex);
    }
}
```

Prinsip:

```text
Inside transactional method, do not convert failure into success unless you intentionally want commit.
```

---

## 17. Self-Invocation Trap pada `@Transactional`

Dalam Spring proxy-based AOP, pemanggilan method transactional dari method lain dalam class yang sama bisa tidak melewati proxy.

Anti-pattern:

```java
@Service
class CaseService {

    public void submitAll(List<Long> caseIds) {
        for (Long caseId : caseIds) {
            submitOne(caseId); // self-invocation, @Transactional may not apply
        }
    }

    @Transactional
    public void submitOne(Long caseId) {
        caseMapper.submit(caseId);
    }
}
```

Solusi umum:

### Pisahkan service

```java
@Service
class CaseBatchService {
    private final CaseSingleSubmitService singleSubmitService;

    public void submitAll(List<Long> caseIds) {
        for (Long caseId : caseIds) {
            singleSubmitService.submitOne(caseId);
        }
    }
}
```

```java
@Service
class CaseSingleSubmitService {
    @Transactional
    public void submitOne(Long caseId) {
        caseMapper.submit(caseId);
    }
}
```

### Letakkan transaction di outer method bila memang satu unit

```java
@Transactional
public void submitAll(List<Long> caseIds) {
    for (Long caseId : caseIds) {
        caseMapper.submit(caseId);
    }
}
```

Namun outer transaction untuk batch besar bisa menahan lock terlalu lama. Jadi boundary harus dipilih secara sadar.

---

## 18. Transaction Boundary untuk Batch

Batch operation punya dua strategi umum.

### Strategi A — all-or-nothing

```java
@Transactional
public void approveAll(List<Long> caseIds) {
    for (Long caseId : caseIds) {
        caseMapper.approve(caseId);
        auditMapper.insertApprovalAudit(caseId);
    }
}
```

Cocok bila:

- semua item harus sukses bersama;
- jumlah item kecil;
- lock contention rendah;
- rollback seluruh batch acceptable.

Risiko:

- transaction lama;
- lock lama;
- rollback mahal;
- memory/cache membesar;
- satu item gagal membatalkan semua.

### Strategi B — chunked transaction

```java
public void approveInChunks(List<Long> caseIds) {
    for (List<Long> chunk : chunks(caseIds, 100)) {
        approvalChunkService.approveChunk(chunk);
    }
}
```

```java
@Service
class ApprovalChunkService {
    @Transactional
    public void approveChunk(List<Long> caseIds) {
        for (Long caseId : caseIds) {
            caseMapper.approve(caseId);
            auditMapper.insertApprovalAudit(caseId);
        }
    }
}
```

Cocok bila:

- jumlah item besar;
- partial success dapat diterima;
- retry per chunk lebih mudah;
- lock lifetime harus dibatasi.

Untuk top-tier design, jangan hanya bertanya “bisa batch atau tidak”, tetapi:

```text
Apa atomicity requirement batch ini?
Apa recovery strategy saat item ke-751 gagal?
Apa user expectation terhadap partial success?
Apa audit semantics-nya?
```

---

## 19. MyBatis Batch Executor dan Transaction

MyBatis punya `ExecutorType.BATCH`. Ini berbeda dari sekadar loop insert biasa.

Mental model:

```text
Mapper calls are queued as batch statements
  -> flush sends batch to JDBC driver
  -> commit finalizes transaction
```

Dengan Spring, batch executor perlu dikonfigurasi hati-hati, biasanya dengan `SqlSessionTemplate` tertentu.

Contoh konseptual:

```java
@Bean
public SqlSessionTemplate batchSqlSessionTemplate(SqlSessionFactory sqlSessionFactory) {
    return new SqlSessionTemplate(sqlSessionFactory, ExecutorType.BATCH);
}
```

Lalu mapper/DAO khusus batch memakai template tersebut.

Risiko batch executor:

- error baru muncul saat flush/commit, bukan saat method mapper dipanggil;
- partial failure diagnosis lebih sulit;
- generated keys bisa vendor/driver-specific;
- memory bisa membesar sebelum flush;
- statement order penting;
- mixing executor type dalam transaction yang sama bisa membingungkan.

Rule:

```text
Batch executor should be isolated into explicit batch repository/service, not silently used everywhere.
```

---

## 20. Mixing MyBatis dan JPA Dalam Satu Transaction

Kadang codebase enterprise menggunakan JPA untuk domain write dan MyBatis untuk query/report.

Secara prinsip bisa berada dalam satu Spring transaction bila:

- memakai datasource yang sama;
- transaction manager yang sama atau properly coordinated;
- tidak ada dua unit of work yang tidak sinkron;
- flush behavior dipahami.

Contoh risiko:

```java
@Transactional
public CaseDetail updateThenQuery(long caseId) {
    CaseEntity entity = entityManager.find(CaseEntity.class, caseId);
    entity.setStatus("APPROVED");

    return caseMapper.findDetail(caseId); // apakah melihat update JPA?
}
```

JPA mungkin belum flush perubahan ke database sebelum MyBatis SELECT dijalankan.

Solusi:

```java
@Transactional
public CaseDetail updateThenQuery(long caseId) {
    CaseEntity entity = entityManager.find(CaseEntity.class, caseId);
    entity.setStatus("APPROVED");

    entityManager.flush();

    return caseMapper.findDetail(caseId);
}
```

Atau lebih baik desain boundary:

- JPA untuk write use-case;
- MyBatis query dilakukan setelah commit;
- atau gunakan MyBatis saja untuk flow tersebut.

Prinsip:

```text
Mixing persistence technologies is allowed, but flush/visibility semantics must be explicit.
```

---

## 21. Mixing MyBatis dan Plain JDBC

Plain JDBC bisa ikut Spring transaction bila connection diperoleh melalui Spring-aware mechanism, misalnya `JdbcTemplate`.

Aman:

```java
@Transactional
public void doWork(...) {
    caseMapper.update(...);
    jdbcTemplate.update("insert into technical_log ...");
}
```

Keduanya bisa memakai transaction yang sama bila datasource/transaction manager sama.

Berbahaya:

```java
@Transactional
public void doWork(...) throws SQLException {
    caseMapper.update(...);

    try (Connection con = DriverManager.getConnection(url, user, pass)) {
        con.prepareStatement("insert ...").executeUpdate();
        con.commit();
    }
}
```

Masalah:

- connection berbeda;
- transaction berbeda;
- commit manual;
- rollback Spring tidak memengaruhi JDBC manual.

Rule:

```text
In Spring application, do not bypass Spring-managed DataSource for transactional work.
```

---

## 22. Transaction dan Local Cache MyBatis

MyBatis memiliki local cache level `SqlSession`. Dalam transaction Spring, session yang sama digunakan selama transaction.

Ini berarti beberapa SELECT yang sama dalam session yang sama dapat berinteraksi dengan local cache, tergantung konfigurasi dan statement behavior.

Risiko konseptual:

```java
@Transactional
public CaseDetail example(long caseId) {
    CaseDetail before = caseMapper.findDetail(caseId);
    caseMapper.updateStatus(caseId, "APPROVED");
    CaseDetail after = caseMapper.findDetail(caseId);
    return after;
}
```

Apakah `after` pasti fresh? MyBatis biasanya melakukan cache flush untuk update statements dengan `flushCache=true` default pada insert/update/delete, tetapi engineer harus memahami bahwa cache adalah bagian dari session behavior.

Best practice:

- Jangan mengandalkan cache untuk correctness.
- Untuk read-after-write penting, pahami statement cache behavior.
- Hindari second-level cache untuk entity yang sering berubah kecuali invalidation benar-benar dipahami.
- Gunakan explicit query atau design command/query separation bila perlu.

---

## 23. Second-Level Cache dan Transaction

Second-level cache MyBatis bersifat namespace-level dan transactional. Cache diperbarui saat session commit, bukan di tengah transaction.

Namun dalam sistem enterprise, second-level cache sering lebih berisiko daripada bermanfaat karena:

- invalidation sulit;
- multi-node deployment butuh distributed cache strategy;
- transaction semantics tidak selalu sesuai ekspektasi tim;
- stale read bisa menjadi bug bisnis;
- mapper namespace cache terlalu kasar.

Rule praktis:

```text
Use MyBatis second-level cache only after proving data volatility, invalidation boundary, and consistency requirement.
```

Untuk aplikasi case management/regulatory workflow, sering lebih aman memakai:

- no mapper second-level cache;
- Redis/application cache eksplisit untuk lookup/reference data;
- cache key/version/invalidation yang jelas;
- auditability atas source of truth.

---

## 24. External Call di Dalam Transaction

Anti-pattern klasik:

```java
@Transactional
public void submitApplication(long applicationId) {
    applicationMapper.submit(applicationId);
    auditMapper.insertAudit(applicationId, "SUBMITTED");
    myInfoClient.fetchApplicantData(applicationId); // external call inside transaction
}
```

Risiko:

1. Transaction menunggu network.
2. Lock database ditahan lebih lama.
3. Timeout external menyebabkan rollback DB yang sebetulnya sudah valid.
4. External service bisa melihat efek yang tidak commit.
5. Retry bisa menghasilkan duplikasi side effect.

Pattern yang lebih baik:

```java
@Transactional
public void submitApplication(long applicationId) {
    applicationMapper.submit(applicationId);
    auditMapper.insertAudit(applicationId, "SUBMITTED");
    outboxMapper.insertEvent("APPLICATION_SUBMITTED", applicationId);
}
```

Worker setelah commit:

```java
public void processOutboxEvent(OutboxEvent event) {
    myInfoClient.fetchApplicantData(event.applicationId());
    outboxMapper.markProcessed(event.id());
}
```

Rule:

```text
Inside DB transaction: persist intent.
Outside DB transaction: execute side effect.
```

---

## 25. After-Commit Hook

Kadang kita ingin menjalankan aksi hanya setelah transaction commit.

Spring menyediakan mekanisme transaction synchronization/event. Secara desain, ini bisa digunakan untuk:

- publish in-memory event after commit;
- trigger async job;
- clear local state;
- notify non-critical component.

Namun untuk reliability tinggi, after-commit hook saja belum cukup bila proses crash setelah commit tapi sebelum hook selesai.

Lebih reliable:

```text
DB transaction commits business data + outbox row
separate worker reads outbox row
worker retries until success/dead-letter
```

Gunakan after-commit untuk convenience, bukan sebagai satu-satunya reliability mechanism pada critical integration.

---

## 26. Idempotency dan Transaction

Transaction tidak otomatis membuat operasi idempotent.

Contoh retry HTTP request:

```text
Client sends submit request
Server commits transaction
Network timeout before response
Client retries submit request
```

Tanpa idempotency, retry bisa:

- membuat audit dobel;
- membuat task dobel;
- mengirim event dobel;
- gagal karena status sudah berubah;
- membingungkan user.

Pattern MyBatis:

### Guarded state transition

```xml
<update id="submitIfDraft">
  UPDATE application
  SET status = 'SUBMITTED', version = version + 1
  WHERE application_id = #{applicationId}
    AND status = 'DRAFT'
</update>
```

### Unique idempotency key

```xml
<insert id="insertCommandRequest">
  INSERT INTO command_request(command_key, command_type, created_at)
  VALUES (#{commandKey}, #{commandType}, CURRENT_TIMESTAMP)
</insert>
```

Dengan unique constraint:

```sql
ALTER TABLE command_request
ADD CONSTRAINT uq_command_request_key UNIQUE (command_key);
```

### Outbox unique event

```sql
ALTER TABLE outbox_event
ADD CONSTRAINT uq_outbox_business_event UNIQUE (aggregate_type, aggregate_id, event_type, event_version);
```

Transaction boundary yang baik sering menggabungkan:

```text
state guard + unique constraint + rows affected + outbox
```

---

## 27. Lock Lifetime dan Long Transaction

Transaction yang lama bukan hanya masalah “lambat”. Ia bisa menyebabkan:

- lock contention;
- deadlock probability naik;
- connection pool exhaustion;
- undo/redo pressure;
- replication lag;
- timeout;
- user-facing latency;
- cascading incident.

Contoh buruk:

```java
@Transactional
public void exportLargeReport(SearchCriteria criteria) {
    List<ReportRow> rows = reportMapper.searchHuge(criteria);
    fileWriter.writeCsv(rows);
    auditMapper.insertExportAudit(...);
}
```

Masalah:

- transaction terbuka saat proses file writing;
- result besar dimaterialisasi;
- connection ditahan lama.

Alternatif:

```text
1. Create export request transaction
2. Worker reads data using cursor/read-only controlled transaction
3. Write file outside long write transaction
4. Update export status in short transaction
```

Rule:

```text
Keep write transactions short. Keep read transactions intentional. Never hold DB transaction while waiting for slow IO unless deliberately justified.
```

---

## 28. Deadlock dan Retry Boundary

Deadlock bisa terjadi walau SQL benar.

Contoh:

```text
T1 locks case A then case B
T2 locks case B then case A
```

Database memilih salah satu sebagai victim dan rollback transaction tersebut.

Mitigasi:

1. Lock rows dalam urutan deterministik.
2. Gunakan guarded update satu row bila cukup.
3. Perkecil transaction duration.
4. Hindari user/network wait dalam transaction.
5. Tambahkan retry pada boundary yang aman.

Contoh deterministic ordering:

```java
@Transactional
public void transferOwnership(List<Long> caseIds, long officerId) {
    List<Long> sorted = caseIds.stream().sorted().toList(); // Java 16+, untuk Java 8 gunakan collect
    for (Long caseId : sorted) {
        caseMapper.lockCase(caseId);
        caseMapper.assignOfficer(caseId, officerId);
    }
}
```

Untuk Java 8:

```java
List<Long> sorted = caseIds.stream()
    .sorted()
    .collect(Collectors.toList());
```

Retry harus berada di level use-case yang idempotent, bukan asal mengulang statement individual.

---

## 29. `SELECT FOR UPDATE` dengan MyBatis

Kadang kita perlu pessimistic locking.

```xml
<select id="lockById" resultMap="CaseLockResultMap">
  SELECT case_id, status, version
  FROM case_main
  WHERE case_id = #{caseId}
  FOR UPDATE
</select>
```

Service:

```java
@Transactional
public void approveWithLock(long caseId, long officerId) {
    CaseLockRow row = caseMapper.lockById(caseId);

    if (!"PENDING_APPROVAL".equals(row.status())) {
        throw new InvalidTransitionException(caseId);
    }

    caseMapper.approve(caseId, officerId);
    auditMapper.insertApprovalAudit(caseId, officerId);
}
```

Gunakan pessimistic lock bila:

- invariant sulit dijaga hanya dengan single guarded update;
- harus membaca beberapa row lalu menulis berdasarkan snapshot;
- conflict mahal;
- business process membutuhkan exclusive decision.

Jangan gunakan bila:

- traffic tinggi dan conflict rendah;
- optimistic locking cukup;
- transaction punya external calls;
- lock order tidak jelas.

---

## 30. Transaction dan Optimistic Locking

Optimistic locking biasanya lebih scalable.

Mapper:

```xml
<update id="updateDecisionIfVersionMatches">
  UPDATE case_main
  SET decision = #{decision},
      status = #{newStatus},
      version = version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE case_id = #{caseId}
    AND version = #{expectedVersion}
</update>
```

Service:

```java
@Transactional
public void decide(DecisionCommand command) {
    int updated = caseMapper.updateDecisionIfVersionMatches(command);
    if (updated != 1) {
        throw new ConcurrentModificationException("Case was modified by another transaction");
    }

    auditMapper.insertDecisionAudit(command);
}
```

Keuntungan:

- tidak menahan lock lama sebelum update;
- conflict terdeteksi jelas;
- cocok untuk UI edit form;
- cocok untuk state transition sederhana.

Kelemahan:

- user bisa mendapat conflict error;
- perlu expected version;
- perlu retry/refresh UX;
- tidak cocok bila invariant lintas banyak row kompleks.

---

## 31. Multiple Datasource dan Transaction Manager

Dalam Spring Boot enterprise, bisa ada lebih dari satu datasource:

```text
primaryDataSource
reportingDataSource
archiveDataSource
externalSystemDataSource
```

Setiap datasource biasanya punya:

- `SqlSessionFactory` sendiri;
- mapper package sendiri;
- transaction manager sendiri.

Contoh:

```java
@Transactional(transactionManager = "primaryTransactionManager")
public void updatePrimary(...) { ... }
```

Jika service menulis ke dua datasource dalam satu method:

```java
@Transactional(transactionManager = "primaryTransactionManager")
public void updateTwoDatabases(...) {
    primaryMapper.update(...);
    archiveMapper.insert(...); // mungkin tidak ikut transaction yang sama
}
```

Ini bahaya bila `archiveMapper` memakai datasource lain.

Solusi tergantung kebutuhan:

1. Hindari atomic write lintas database.
2. Gunakan outbox/integration event.
3. Gunakan distributed transaction/JTA hanya bila benar-benar perlu dan infrastrukturnya matang.
4. Desain eventual consistency.

Rule:

```text
A single @Transactional is not automatically a distributed transaction across datasources.
```

---

## 32. Transaction Manager yang Tepat untuk MyBatis

Untuk MyBatis + JDBC datasource tunggal, umumnya gunakan `DataSourceTransactionManager`.

Dalam Spring Boot starter, banyak konfigurasi dapat dibuat otomatis bila satu datasource dan dependency benar.

Namun di sistem multi datasource, konfigurasi harus eksplisit:

```java
@Configuration
@MapperScan(
    basePackages = "com.example.caseapp.persistence.primary",
    sqlSessionFactoryRef = "primarySqlSessionFactory"
)
class PrimaryMyBatisConfig {
    // DataSource, SqlSessionFactory, SqlSessionTemplate, TransactionManager
}
```

Dan untuk datasource kedua:

```java
@Configuration
@MapperScan(
    basePackages = "com.example.caseapp.persistence.reporting",
    sqlSessionFactoryRef = "reportingSqlSessionFactory"
)
class ReportingMyBatisConfig {
    // separate config
}
```

Checklist:

- Mapper package tidak overlap.
- XML mapper location tidak overlap secara salah.
- Transaction manager dipilih eksplisit bila ada lebih dari satu.
- Integration test membuktikan rollback pada datasource yang benar.

---

## 33. Exception Translation

MyBatis-Spring dapat menerjemahkan exception persistence menjadi Spring `DataAccessException` hierarchy.

Manfaat:

- service tidak harus bergantung pada exception vendor JDBC;
- error handling lebih konsisten;
- retry classifier bisa lebih mudah;
- abstraction boundary lebih bersih.

Namun jangan terlalu banyak menangkap `DataAccessException` secara generic.

Buruk:

```java
try {
    mapper.insert(command);
} catch (DataAccessException ex) {
    return false;
}
```

Lebih baik:

```java
try {
    mapper.insert(command);
} catch (DuplicateKeyException ex) {
    throw new DuplicateSubmissionException(command.idempotencyKey(), ex);
}
```

Atau biarkan bubble up bila bukan business-handled error.

---

## 34. Unique Constraint sebagai Transaction Partner

Transaction saja tidak cukup untuk enforce uniqueness di concurrency tinggi.

Contoh:

```java
@Transactional
public void createApplication(CreateApplicationCommand command) {
    boolean exists = applicationMapper.existsByReferenceNo(command.referenceNo());
    if (exists) {
        throw new DuplicateReferenceException(command.referenceNo());
    }
    applicationMapper.insert(command);
}
```

Race:

```text
T1 exists=false
T2 exists=false
T1 insert
T2 insert
```

Solusi utama:

```sql
ALTER TABLE application
ADD CONSTRAINT uq_application_reference_no UNIQUE (reference_no);
```

Service:

```java
@Transactional
public void createApplication(CreateApplicationCommand command) {
    try {
        applicationMapper.insert(command);
    } catch (DuplicateKeyException ex) {
        throw new DuplicateReferenceException(command.referenceNo(), ex);
    }
}
```

Rule:

```text
Use database constraints as the final concurrency authority.
```

MyBatis mapper harus dirancang untuk bekerja bersama constraint, bukan menggantikannya.

---

## 35. State Machine dan Transaction

Untuk workflow/case management, state transition harus transactional.

Contoh state:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
                         |              |
                         v              v
                      REJECTED       CLOSED
```

Jangan lakukan:

```java
CaseRow row = caseMapper.findById(caseId);
if (row.status().equals("DRAFT")) {
    caseMapper.updateStatus(caseId, "SUBMITTED");
}
```

Race-prone.

Lebih kuat:

```xml
<update id="transition">
  UPDATE case_main
  SET status = #{toStatus},
      version = version + 1,
      updated_by = #{actorId},
      updated_at = CURRENT_TIMESTAMP
  WHERE case_id = #{caseId}
    AND status = #{fromStatus}
</update>
```

Service:

```java
@Transactional
public void transition(CaseTransitionCommand command) {
    int updated = caseMapper.transition(command);
    if (updated != 1) {
        throw new InvalidTransitionException(command.caseId(), command.fromStatus(), command.toStatus());
    }

    auditMapper.insertTransitionAudit(command);
    outboxMapper.insertCaseTransitionedEvent(command);
}
```

Ini pattern yang sangat penting untuk sistem enforcement/regulatory workflow.

---

## 36. Audit Trail Dalam Transaction

Audit perlu dibedakan:

### Business audit

Mencatat perubahan bisnis yang berhasil commit.

Contoh:

```text
Case submitted
Case approved
Document uploaded
Officer assigned
```

Harus berada dalam transaction yang sama dengan perubahan bisnis.

```java
@Transactional
public void approve(...) {
    caseMapper.approve(...);
    auditMapper.insertBusinessAudit(...);
}
```

Jika transaction rollback, audit bisnis juga rollback.

### Technical audit / failure log

Mencatat percobaan, error, atau aktivitas teknis walau business transaction gagal.

Contoh:

```text
Approval attempt failed due to stale version
External callback rejected due to invalid signature
Login attempt failed
```

Bisa memakai transaction terpisah, outbox, atau logging store lain.

Prinsip:

```text
Do not mix business audit and failure diagnostics under one vague "audit" concept.
```

---

## 37. Transaction dan Authorization Check

Authorization bisa dilakukan sebelum transaction atau di dalam transaction tergantung datanya.

### Authorization stateless/request-level

Contoh:

- role check;
- permission claim;
- endpoint access.

Bisa sebelum transaction.

### Authorization data-level

Contoh:

- officer hanya boleh approve case agency tertentu;
- user hanya boleh melihat case yang assigned kepadanya;
- supervisor hanya boleh escalate case dalam division-nya.

Harus dekat dengan query/update.

Contoh guarded update:

```xml
<update id="approveIfAuthorized">
  UPDATE case_main c
  SET c.status = 'APPROVED',
      c.updated_by = #{officerId},
      c.updated_at = CURRENT_TIMESTAMP
  WHERE c.case_id = #{caseId}
    AND c.status = 'PENDING_APPROVAL'
    AND EXISTS (
      SELECT 1
      FROM officer_agency_access a
      WHERE a.officer_id = #{officerId}
        AND a.agency_id = c.agency_id
    )
</update>
```

Service:

```java
int updated = caseMapper.approveIfAuthorized(command);
if (updated != 1) {
    throw new NotAuthorizedOrInvalidStateException(command.caseId());
}
```

Ini membuat authorization dan state guard atomic.

---

## 38. Transaction dan Soft Delete

Soft delete sering terlihat sederhana:

```sql
UPDATE document SET deleted = 1 WHERE document_id = ?
```

Namun transaction design perlu menjawab:

- Apakah child record ikut soft delete?
- Apakah audit harus dicatat?
- Apakah unique constraint harus memperhitungkan deleted flag?
- Apakah concurrent update boleh terjadi pada row yang sedang di-delete?
- Apakah restore memungkinkan?

Mapper:

```xml
<update id="softDeleteIfActive">
  UPDATE document
  SET deleted = 1,
      deleted_by = #{actorId},
      deleted_at = CURRENT_TIMESTAMP,
      version = version + 1
  WHERE document_id = #{documentId}
    AND deleted = 0
    AND version = #{expectedVersion}
</update>
```

Service:

```java
@Transactional
public void deleteDocument(DeleteDocumentCommand command) {
    int updated = documentMapper.softDeleteIfActive(command);
    if (updated != 1) {
        throw new DocumentDeleteConflictException(command.documentId());
    }
    auditMapper.insertDocumentDeletedAudit(command);
}
```

---

## 39. Transaction dan Domain Event / Outbox

Untuk event-driven integration, jangan publish event langsung sebelum commit.

Anti-pattern:

```java
@Transactional
public void approveCase(...) {
    caseMapper.approve(...);
    eventPublisher.publish(new CaseApprovedEvent(caseId)); // bisa terjadi sebelum commit
}
```

Lebih reliable:

```java
@Transactional
public void approveCase(...) {
    caseMapper.approve(...);
    auditMapper.insertApprovalAudit(...);
    outboxMapper.insert(new OutboxEvent("CASE_APPROVED", caseId, payload));
}
```

Outbox table:

```sql
CREATE TABLE outbox_event (
  event_id        VARCHAR(64) PRIMARY KEY,
  aggregate_type  VARCHAR(100) NOT NULL,
  aggregate_id    VARCHAR(100) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  payload_json    CLOB NOT NULL,
  status          VARCHAR(30) NOT NULL,
  created_at      TIMESTAMP NOT NULL,
  processed_at    TIMESTAMP NULL,
  retry_count     INTEGER NOT NULL
);
```

Worker:

```xml
<select id="claimPendingEvents" resultMap="OutboxEventResultMap">
  SELECT event_id, aggregate_type, aggregate_id, event_type, payload_json, retry_count
  FROM outbox_event
  WHERE status = 'PENDING'
  ORDER BY created_at
  FETCH FIRST #{limit} ROWS ONLY
  FOR UPDATE SKIP LOCKED
</select>
```

This pattern separates:

```text
business transaction commit
from
external event delivery
```

---

## 40. Transaction Timeout

Transaction timeout melindungi sistem dari transaction yang berjalan terlalu lama.

```java
@Transactional(timeout = 10)
public void approve(...) { ... }
```

Namun timeout bukan solusi utama untuk query lambat. Timeout adalah safety net.

Jika timeout sering terjadi, investigasi:

- execution plan;
- missing index;
- lock wait;
- connection pool saturation;
- slow network/storage;
- long external call dalam transaction;
- batch size terlalu besar;
- deadlock/retry storm.

Rule:

```text
Set timeout intentionally, but fix root cause of long transaction.
```

---

## 41. Transaction dan Connection Pool

Setiap transaction aktif biasanya memegang satu database connection.

Jika transaksi lama:

```text
thread holds transaction
transaction holds connection
connection unavailable to others
pool exhausts
requests queue
latency increases
timeouts cascade
```

Contoh penyebab:

- external API call dalam transaction;
- report/export besar;
- waiting user input;
- batch sangat besar;
- lock wait;
- slow query;
- infinite retry.

Metrics yang perlu dipantau:

- active connections;
- idle connections;
- pending acquisition;
- connection timeout count;
- transaction duration;
- slow query duration;
- lock wait;
- deadlock count.

MyBatis tidak bisa menyelamatkan desain transaction yang menahan connection terlalu lama.

---

## 42. Transaction dengan Virtual Threads Java 21+

Java 21 memperkenalkan virtual threads sebagai fitur final. MyBatis tetap memakai JDBC blocking API.

Virtual threads dapat membantu mengurangi biaya blocking thread, tetapi tidak mengurangi biaya:

- database connection;
- lock;
- transaction duration;
- query execution;
- row contention;
- connection pool limit.

Misleading assumption:

```text
Virtual threads membuat blocking database aman tanpa batas.
```

Yang benar:

```text
Virtual threads reduce platform-thread cost, not database resource cost.
```

Dengan virtual threads, risiko baru bisa muncul:

- lebih banyak concurrent request mencapai DB;
- pool exhaustion lebih cepat terlihat;
- lock contention meningkat;
- DB menjadi bottleneck utama.

Rule:

```text
When using virtual threads with MyBatis/JDBC, connection pool and transaction duration become even more important control points.
```

---

## 43. Java 8 sampai 25: API Style untuk Transactional Service

### Java 8 style

```java
public final class SubmitCaseCommand {
    private final long caseId;
    private final long submittedBy;

    public SubmitCaseCommand(long caseId, long submittedBy) {
        this.caseId = caseId;
        this.submittedBy = submittedBy;
    }

    public long getCaseId() { return caseId; }
    public long getSubmittedBy() { return submittedBy; }
}
```

Service:

```java
@Transactional
public void submit(SubmitCaseCommand command) {
    int updated = caseMapper.submitIfDraft(command.getCaseId(), command.getSubmittedBy());
    if (updated != 1) {
        throw new InvalidTransitionException(command.getCaseId());
    }
}
```

### Java 16+/17+ record style

```java
public record SubmitCaseCommand(long caseId, long submittedBy) {}
```

Service:

```java
@Transactional
public void submit(SubmitCaseCommand command) {
    int updated = caseMapper.submitIfDraft(command.caseId(), command.submittedBy());
    if (updated != 1) {
        throw new InvalidTransitionException(command.caseId());
    }
}
```

Transaction mental model sama. Yang berubah hanya expressiveness bahasa.

---

## 44. Testing Transaction Rollback

Jangan hanya test mapper SQL. Test juga transaction behavior.

Contoh:

```java
@SpringBootTest
class CaseSubmissionTransactionTest {

    @Autowired SubmitCaseUseCase useCase;
    @Autowired CaseMapper caseMapper;
    @Autowired AuditMapper auditMapper;

    @Test
    void shouldRollbackCaseUpdateWhenAuditFails() {
        long caseId = givenDraftCase();

        assertThatThrownBy(() -> useCase.submitWithForcedAuditFailure(caseId))
            .isInstanceOf(RuntimeException.class);

        CaseRow row = caseMapper.findById(caseId);
        assertThat(row.status()).isEqualTo("DRAFT");

        List<AuditRow> audits = auditMapper.findByCaseId(caseId);
        assertThat(audits).isEmpty();
    }
}
```

Test penting:

1. Update + audit rollback bersama.
2. Checked exception rollback rule.
3. Duplicate key handling.
4. Optimistic lock conflict.
5. Self-invocation trap jika desain rawan.
6. Multi-datasource transaction boundary.
7. External call tidak terjadi sebelum commit.
8. Outbox row commit bersama business data.

---

## 45. Testing `@Transactional` Bisa Menipu

Spring test sering menjalankan test method dalam transaction dan rollback di akhir test.

Ini bagus untuk cleanup, tapi bisa menipu:

- after-commit hook tidak berjalan seperti production;
- lazy/cursor lifecycle berbeda;
- commit constraint yang deferrable mungkin tidak terlihat;
- transaction boundary service bisa tertutup oleh transaction test;
- read-after-commit behavior tidak diuji.

Untuk menguji commit behavior, gunakan strategi seperti:

- jangan beri `@Transactional` pada test;
- gunakan `TestTransaction` bila perlu;
- verify data setelah service commit;
- gunakan integration test dengan database real/Testcontainers.

---

## 46. Common Failure Model

### 46.1 Rollback tidak terjadi

Kemungkinan:

- exception ditelan;
- checked exception tanpa `rollbackFor`;
- method `@Transactional` tidak dipanggil lewat Spring proxy;
- class/method tidak eligible untuk proxy;
- transaction manager salah;
- datasource berbeda;
- manual commit dilakukan;
- autocommit connection dipakai di luar Spring.

### 46.2 Data commit sebagian

Kemungkinan:

- `REQUIRES_NEW` dipakai tanpa sadar;
- mapper memakai datasource lain;
- external JDBC manual;
- audit teknis dipisah dari business audit;
- batch flush sebagian lalu error handling buruk.

### 46.3 Lock timeout/deadlock

Kemungkinan:

- transaction terlalu lama;
- lock order tidak konsisten;
- missing index menyebabkan lock terlalu luas;
- batch besar;
- external call dalam transaction;
- isolation terlalu tinggi.

### 46.4 Mapper melihat data lama

Kemungkinan:

- MyBatis local cache;
- JPA belum flush;
- second-level cache;
- read replica lag;
- transaction isolation behavior;
- query ke datasource berbeda.

### 46.5 Event/email terkirim walau transaction rollback

Kemungkinan:

- side effect dipanggil sebelum commit;
- no outbox;
- no after-commit boundary;
- retry tidak idempotent.

---

## 47. Transaction Design Decision Framework

Gunakan pertanyaan ini saat mendesain use-case:

### Atomicity

```text
Operasi apa saja yang harus sukses/gagal bersama?
```

### Visibility

```text
Kapan perubahan boleh terlihat oleh user/proses lain?
```

### Conflict

```text
Apa yang terjadi bila dua actor mengubah object yang sama?
```

### Lock

```text
Row apa yang dikunci, dalam urutan apa, dan selama apa?
```

### Retry

```text
Jika transaction gagal setelah commit tidak diketahui oleh client, apakah retry aman?
```

### Side effect

```text
Apakah ada email/event/API call/file operation? Apakah dilakukan setelah commit?
```

### Audit

```text
Audit ini business audit atau technical failure log?
```

### Datasource

```text
Apakah semua mapper memakai datasource dan transaction manager yang sama?
```

### Error

```text
Exception apa yang harus rollback? Apakah ada checked exception?
```

### Scale

```text
Apakah transaction ini tetap aman saat data 100x lebih besar dan concurrency 10x lebih tinggi?
```

---

## 48. Production-Grade Transaction Template

Contoh template untuk command use-case:

```java
@Service
public class ApproveCaseUseCase {

    private final CaseMapper caseMapper;
    private final AuditMapper auditMapper;
    private final OutboxMapper outboxMapper;

    public ApproveCaseUseCase(
        CaseMapper caseMapper,
        AuditMapper auditMapper,
        OutboxMapper outboxMapper
    ) {
        this.caseMapper = caseMapper;
        this.auditMapper = auditMapper;
        this.outboxMapper = outboxMapper;
    }

    @Transactional(timeout = 10)
    public void approve(ApproveCaseCommand command) {
        int updated = caseMapper.approveIfPendingAndAuthorized(command);
        if (updated != 1) {
            throw new CaseApprovalRejectedException(command.caseId());
        }

        auditMapper.insertBusinessAudit(AuditRecord.caseApproved(command));
        outboxMapper.insert(OutboxEvent.caseApproved(command));
    }
}
```

Mapper:

```xml
<update id="approveIfPendingAndAuthorized">
  UPDATE case_main c
  SET c.status = 'APPROVED',
      c.approved_by = #{officerId},
      c.approved_at = CURRENT_TIMESTAMP,
      c.updated_at = CURRENT_TIMESTAMP,
      c.version = c.version + 1
  WHERE c.case_id = #{caseId}
    AND c.status = 'PENDING_APPROVAL'
    AND c.version = #{expectedVersion}
    AND EXISTS (
      SELECT 1
      FROM officer_agency_access a
      WHERE a.officer_id = #{officerId}
        AND a.agency_id = c.agency_id
    )
</update>
```

Kekuatan desain:

- state guard;
- authorization guard;
- optimistic lock;
- audit atomic;
- event intent atomic;
- no external call inside transaction;
- rows affected checked;
- transaction timeout;
- explicit command object.

---

## 49. Anti-Pattern Summary

Hindari:

1. `@Transactional` di mapper interface.
2. Manual `commit()`/`rollback()` dalam Spring-managed mapper/repository.
3. Menelan exception dalam transactional method.
4. Checked exception tanpa rollback rule.
5. External API/email/file IO dalam write transaction.
6. Long batch dalam satu transaction tanpa alasan atomicity.
7. `REQUIRES_NEW` untuk business audit tanpa semantics jelas.
8. Self-invocation method transactional.
9. Multi-datasource write dengan asumsi satu annotation cukup.
10. Query-before-insert untuk uniqueness tanpa unique constraint.
11. Read-modify-write tanpa guarded update/version/lock.
12. Mengandalkan isolation level untuk semua concurrency problem.
13. Transaction test yang tidak pernah benar-benar commit.
14. Second-level cache untuk mutable workflow data tanpa invalidation model.
15. Virtual threads digunakan untuk menaikkan concurrency tanpa memperhitungkan DB pool.

---

## 50. Review Checklist

Sebelum merge transactional use-case MyBatis, jawab:

```text
[ ] Transaction boundary ada di service/use-case layer.
[ ] Mapper tidak melakukan commit/rollback manual.
[ ] Semua mapper yang harus atomic memakai datasource/transaction manager yang sama.
[ ] Rows affected dicek untuk update/delete penting.
[ ] State transition memakai guarded update atau lock/version.
[ ] Business audit commit/rollback bersama perubahan bisnis.
[ ] External side effect tidak dipanggil sebelum commit.
[ ] Outbox/event intent ditulis dalam transaction bila perlu integration.
[ ] Exception tidak ditelan.
[ ] Checked exception rollback rule jelas.
[ ] Propagation selain REQUIRED punya alasan eksplisit.
[ ] Transaction tidak terlalu panjang.
[ ] Tidak ada network/file/user wait dalam write transaction.
[ ] Unique/business invariant penting didukung database constraint.
[ ] Testing membuktikan rollback behavior.
[ ] Testing membuktikan conflict behavior.
[ ] Multi-datasource behavior diuji bila ada.
```

---

## 51. Ringkasan Mental Model

MyBatis transaction integration harus dipahami sebagai berikut:

```text
MyBatis core
  gives SqlSession commit/rollback capability

MyBatis-Spring
  binds SqlSession to Spring transaction

Spring transaction manager
  decides commit/rollback

Service/use-case layer
  defines business unit of work

Mapper
  executes SQL contract only

Database
  enforces constraints, locks, isolation, and durability
```

Kalimat paling penting:

```text
Correct MyBatis transaction design is not about putting @Transactional everywhere.
It is about choosing the smallest correct business consistency boundary.
```

Untuk sistem workflow/regulatory/case-management, transaction yang baik biasanya menggabungkan:

```text
guarded state transition
+ rows affected check
+ database constraint
+ audit insert
+ outbox insert
+ short transaction
+ no external side effect before commit
```

---

## 52. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum masuk Part 12, pastikan sudah bisa menjelaskan:

1. Perbedaan transaction manual `SqlSession` dan Spring-managed transaction.
2. Peran `SqlSessionTemplate`.
3. Kenapa mapper tidak boleh commit/rollback.
4. Kenapa `@Transactional` biasanya di service layer.
5. Apa efek `REQUIRED`, `REQUIRES_NEW`, dan `NESTED`.
6. Kenapa checked exception bisa tidak rollback.
7. Kenapa external call dalam transaction berbahaya.
8. Cara membuat state transition atomic dengan guarded update.
9. Cara menggunakan rows affected sebagai correctness signal.
10. Cara mendesain audit dan outbox dalam transaction.
11. Risiko multi-datasource transaction.
12. Risiko self-invocation.
13. Risiko long transaction terhadap connection pool dan lock.
14. Kenapa virtual thread tidak menghilangkan batas DB transaction.

---

## 53. Referensi

Referensi utama untuk bagian ini:

- MyBatis 3 Java API — `SqlSession`, command execution, mapper access, transaction management.
- MyBatis-Spring Reference — transaction integration dengan Spring, `SqlSessionTemplate`, dan Spring-managed session lifecycle.
- MyBatis-Spring API — `SqlSessionTemplate` dan `SpringManagedTransaction`.
- MyBatis Mapper XML Reference — statement behavior, cache behavior, dan mapped statement contract.
- Spring Framework transaction abstraction — propagation, isolation, rollback rules, dan declarative transaction.

---

## 54. Status Seri

Progress saat ini:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
```

Seri belum selesai.

Bagian berikutnya:

```text
Part 12 — Spring Boot Integration: Auto Configuration, Mapper Scan, Configuration Customizer
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — Mapper Method API Design: Return Type, Optional, List, Cursor, Stream](./10-mapper-method-api-design-return-type-optional-list-cursor-stream.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 12 — Spring Boot Integration: Auto Configuration, Mapper Scan, Configuration Customizer](./12-spring-boot-integration-autoconfiguration-mapperscan-customizer.md)
