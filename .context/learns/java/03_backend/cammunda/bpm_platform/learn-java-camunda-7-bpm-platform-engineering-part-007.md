# learn-java-camunda-7-bpm-platform-engineering-part-007.md

# Part 007 — Persistence, Flush Ordering, Optimistic Locking, dan Database Isolation

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `007 / 035`  
> Fokus: persistence engine, command context cache, flush semantics, optimistic locking, isolation level, concurrency conflict, dan desain proses yang benar di bawah kontensi  
> Target pembaca: senior/principal Java engineer yang ingin memahami Camunda 7 bukan hanya sebagai BPMN runtime, tetapi sebagai transactional state machine engine berbasis database

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menjelaskan bagaimana satu command Camunda 7 membaca, mengubah, meng-cache, dan mem-flush entity ke database.
2. Membedakan **flush**, **commit**, **rollback**, dan **wait state**.
3. Memahami kenapa Camunda 7 memakai optimistic locking dan bukan pessimistic locking sebagai default concurrency control.
4. Membaca arti kolom `REV_` di tabel runtime/history/repository tertentu.
5. Menjelaskan kenapa `OptimisticLockingException` sering merupakan expected behavior, bukan selalu bug.
6. Mendesain BPMN supaya mengurangi hot row contention pada parallel gateway, multi-instance, concurrent message correlation, dan concurrent task completion.
7. Menentukan kapan perlu retry, kapan perlu async boundary, kapan perlu idempotency key, dan kapan perlu refactor model.
8. Memahami kenapa isolation level yang direkomendasikan Camunda adalah `READ COMMITTED` dan kenapa `REPEATABLE READ`/`SERIALIZABLE` tidak otomatis membuat sistem lebih aman.
9. Mendiagnosis conflict dari DB/runtime state tanpa melakukan manual mutation yang membahayakan engine.
10. Membangun mental model bahwa Camunda 7 adalah **database-coordinated process engine**, sehingga correctness sangat dipengaruhi oleh transaction boundary, entity revision, dan desain concurrency.

---

## 1. Kenapa Bagian Ini Sangat Penting

Banyak engineer belajar Camunda dari sisi BPMN:

- start event,
- service task,
- user task,
- gateway,
- timer,
- message event,
- external task.

Itu perlu, tetapi belum cukup. Di production, masalah Camunda yang paling mahal biasanya bukan salah menggambar gateway, melainkan:

- task selesai dua kali karena double click / double API call,
- message datang bersamaan dan process instance masuk conflict,
- parallel gateway join menghasilkan `OptimisticLockingException`,
- multi-instance menulis variable parent yang sama,
- retry job mengulang side effect eksternal,
- history table membengkak,
- database deadlock karena isolation/datasource salah,
- process terlihat stuck karena transaction sebelumnya rollback,
- incident muncul tetapi root cause-nya ada pada boundary desain,
- cluster node saling berebut job yang sama,
- developer mencoba “fix” row Camunda langsung di DB dan merusak state engine.

Untuk memahami ini, kamu harus melihat Camunda 7 sebagai:

> **transactional state machine engine yang menggunakan relational database sebagai durable coordination layer.**

BPMN adalah model. JavaDelegate adalah code hook. Job Executor adalah scheduler. Tetapi sumber kebenaran runtime tetap database. Karena itu, concurrency correctness bukan hanya urusan Java code; ia adalah gabungan dari:

- command context,
- persistence session,
- database transaction,
- wait state,
- entity revision,
- isolation level,
- retry behavior,
- BPMN structure.

---

## 2. Mental Model Besar: Camunda 7 Persistence dalam Satu Kalimat

Satu command Camunda 7 bekerja kira-kira seperti ini:

```text
API call / job execution / message correlation
  -> CommandExecutor
  -> CommandContext dibuka
  -> entity runtime dibaca dan di-cache
  -> BPMN atomic operations memodifikasi entity cache
  -> command selesai
  -> entity cache di-flush ke database dengan optimistic locking
  -> transaction commit
  -> state menjadi durable
```

Jika terjadi exception sebelum commit:

```text
exception
  -> transaction rollback
  -> perubahan entity dibatalkan
  -> state kembali ke last committed wait state
```

Jika terjadi optimistic locking conflict saat flush:

```text
UPDATE/DELETE affected rows = 0
  -> entity revision sudah berubah / row sudah tidak ada
  -> OptimisticLockingException
  -> transaction rollback
  -> caller harus retry atau job executor retry otomatis
```

Poin kunci:

> Camunda tidak langsung menulis setiap perubahan kecil ke database begitu model bergerak. Engine mengumpulkan perubahan dalam command context, lalu mem-flush perubahan saat command selesai.

---

## 3. Empat Istilah yang Sering Tertukar

### 3.1 Transaction Boundary

Transaction boundary adalah batas database transaction. Jika command berhasil sampai akhir, perubahan commit. Jika gagal, rollback.

Dalam Camunda, natural transaction boundary biasanya terjadi saat engine mencapai wait state:

- user task,
- receive task,
- message catch event,
- timer event,
- signal catch event,
- event-based gateway,
- external task,
- async continuation.

### 3.2 Wait State

Wait state adalah titik BPMN di mana engine berhenti, menyimpan state, dan menunggu trigger berikutnya.

Wait state bukan sekadar “pause”. Ia adalah **durable checkpoint**.

Contoh:

```text
Start -> Service Task A -> User Task Review -> Service Task B -> End
```

Jika process dimulai secara synchronous dan `Service Task A` berhasil, engine akan lanjut sampai `User Task Review`, lalu menyimpan runtime state ke DB. Setelah commit, thread caller kembali.

### 3.3 Flush

Flush adalah proses engine menulis perubahan entity dari in-memory command context ke database.

Flush bukan commit.

Flush berarti:

- SQL `INSERT`/`UPDATE`/`DELETE` dikirim,
- affected row count dicek,
- revision dicek,
- potential optimistic locking conflict terdeteksi.

Tetapi transaction masih bisa rollback setelah flush jika command/transaction manager memutuskan rollback.

### 3.4 Commit

Commit adalah saat database transaction benar-benar disahkan. Setelah commit:

- process state durable,
- row runtime terlihat oleh transaksi lain,
- job baru bisa diakuisisi node lain,
- task baru terlihat oleh user/task query,
- history changes menjadi persisted.

Ringkasnya:

| Konsep | Arti | Apa yang dijamin? |
|---|---|---|
| Wait state | BPMN stop point | Engine bisa berhenti dan menunggu trigger |
| Flush | SQL dikirim ke DB | Conflict bisa terdeteksi |
| Commit | Transaction disahkan | State durable dan visible |
| Rollback | Transaction dibatalkan | Kembali ke last committed state |

---

## 4. Command Context: Unit Kerja Internal Engine

Camunda public API tampak sederhana:

```java
runtimeService.startProcessInstanceByKey("caseReview", variables);

taskService.complete(taskId, variables);

runtimeService.correlateMessage("PaymentReceived", businessKey);
```

Tetapi di dalam engine, API tersebut dieksekusi sebagai command.

Secara konseptual:

```text
RuntimeService.startProcessInstanceByKey
  -> StartProcessInstanceCmd
  -> CommandExecutor
  -> CommandContext
  -> ExecutionEntity / VariableInstanceEntity / JobEntity / TaskEntity
  -> flush
```

CommandContext adalah unit kerja internal yang menyimpan:

- cache entity yang sudah dibaca,
- entity baru yang akan diinsert,
- entity dirty yang akan diupdate,
- entity yang akan dihapus,
- transaction listeners,
- session seperti DbEntityManager,
- reference ke process engine configuration.

### 4.1 Kenapa Ada Entity Cache?

Tanpa cache, setiap langkah atomic operation harus query DB ulang. Itu mahal dan rawan inconsistent read dalam satu command.

Dengan cache:

```text
command mulai
  -> baca execution E rev=3
  -> simpan di cache
  -> update activity id
  -> tambah variable
  -> create task
  -> update execution lagi
  -> flush semua perubahan
command selesai
```

Dalam satu command, entity yang sama biasanya direpresentasikan oleh object yang sama di memory.

### 4.2 Konsekuensi Cache

Cache membuat satu command konsisten terhadap dirinya sendiri, tetapi tidak berarti bebas conflict terhadap command lain.

Dua command bisa membaca row yang sama pada revision yang sama:

```text
Command A reads ACT_RU_EXECUTION id=E1 REV_=5
Command B reads ACT_RU_EXECUTION id=E1 REV_=5
```

A commit dulu:

```text
UPDATE ACT_RU_EXECUTION SET REV_=6 WHERE ID_=E1 AND REV_=5
-- affected rows = 1
```

B commit belakangan:

```text
UPDATE ACT_RU_EXECUTION SET REV_=6 WHERE ID_=E1 AND REV_=5
-- affected rows = 0
```

B kalah. Engine throw `OptimisticLockingException`.

---

## 5. `REV_`: Kolom Kecil yang Menjaga Consistency

Banyak tabel Camunda punya kolom `REV_`, misalnya:

- `ACT_RU_EXECUTION.REV_`,
- `ACT_RU_TASK.REV_`,
- `ACT_RU_VARIABLE.REV_`,
- `ACT_RU_JOB.REV_`,
- `ACT_RU_EXT_TASK.REV_`,
- `ACT_RU_INCIDENT.REV_`,
- beberapa tabel lain tergantung versi/schema.

`REV_` adalah revision number. Ia digunakan untuk optimistic locking.

Contoh update konseptual:

```sql
UPDATE ACT_RU_TASK
SET REV_ = REV_ + 1,
    ASSIGNEE_ = ?
WHERE ID_ = ?
  AND REV_ = ?;
```

Jika affected rows = 1:

```text
row belum berubah sejak command membacanya
update aman
```

Jika affected rows = 0:

```text
row sudah diubah/dihapus command lain
conflict
throw OptimisticLockingException
rollback current transaction
```

Camunda documentation menjelaskan pola ini: conflict dideteksi saat `UPDATE`/`DELETE` menghasilkan affected row count `0`, lalu engine melempar `OptimisticLockingException`. Banyak tabel engine memakai `REV_` sebagai revision version; update mencoba memodifikasi revision yang dibaca command saat itu.

---

## 6. Optimistic Locking: Bukan Error Aneh, Tapi Mekanisme Keselamatan

Optimistic locking berarti engine tidak mengunci semua row sejak awal. Engine mengasumsikan conflict jarang, membolehkan banyak thread membaca, lalu mendeteksi conflict saat update/delete.

### 6.1 Kenapa Tidak Pessimistic Locking?

Pessimistic locking akan melakukan lock lebih awal:

```sql
SELECT ... FOR UPDATE
```

Itu dapat mengurangi conflict, tetapi:

- mengurangi concurrency,
- meningkatkan blocking,
- memperbesar risiko deadlock,
- buruk untuk cluster multi-node,
- tidak cocok untuk engine yang banyak membaca state dan hanya sesekali bentrok.

Camunda memilih optimistic locking karena lebih cocok untuk model process engine dengan banyak command independen dan conflict yang seharusnya relatif jarang jika BPMN didesain baik.

### 6.2 Kapan OptimisticLockingException Normal?

Normal pada kondisi:

1. Dua user menyelesaikan task yang sama hampir bersamaan.
2. Dua branch parallel join bersamaan pada gateway yang sama.
3. Multi-instance body update counter bersamaan.
4. Dua message correlation menargetkan process instance yang sama.
5. Dua job executor node mengambil/mengeksekusi state yang berhubungan secara bersamaan.
6. Process modification bersamaan dengan job execution.
7. External API update variable saat process instance juga update variable yang sama.
8. Boundary event dan activity completion race.

Ini bukan berarti sistem rusak. Ini berarti engine menolak commit kedua agar state tidak corrupt.

### 6.3 Kapan OptimisticLockingException Menjadi Desain Buruk?

Ia menjadi tanda desain buruk jika:

- terjadi terus-menerus pada process normal,
- menyebabkan user-facing error berulang,
- retry job menyebabkan side effect duplicate,
- parallel branch selalu menulis variable parent yang sama,
- gateway join selalu high-contention,
- API caller tidak punya retry strategy,
- process model terlalu banyak synchronous convergence,
- external event ingestion tidak idempotent.

Top 1% engineer tidak sekadar bertanya:

> “Bagaimana menghilangkan OptimisticLockingException?”

Pertanyaan yang lebih benar:

> “Entity apa yang diperebutkan, kenapa command-command ini bisa bersamaan, apakah conflict ini expected, dan boundary desain apa yang perlu diubah?”

---

## 7. Flush Ordering: Kenapa Urutan SQL Penting

Camunda menyimpan perubahan dalam entity cache lalu flush ke DB. Flush tidak boleh random sepenuhnya. Ada dependency antar entity.

Contoh start process sampai user task:

```text
1. insert ACT_RU_EXECUTION process instance
2. insert ACT_RU_EXECUTION child execution jika perlu
3. insert ACT_RU_TASK
4. insert ACT_RU_VARIABLE jika ada
5. insert ACT_HI_PROCINST
6. insert ACT_HI_ACTINST
7. insert ACT_HI_TASKINST
8. insert ACT_HI_VARINST / ACT_HI_DETAIL tergantung history level
```

Jika task insert terjadi sebelum execution insert, FK/logical relation bisa bermasalah.

Camunda internal persistence layer mengelola dependency ini.

Sebagai application engineer, yang penting bukan menghafal persis order internal, tetapi memahami konsekuensi:

- semua entity changes dari satu command biasanya satu transaction,
- conflict bisa terjadi di salah satu update/delete saat flush,
- jika conflict terjadi, command rollback,
- perubahan sebelumnya di transaction yang sama ikut rollback,
- side effect eksternal tidak ikut rollback.

### 7.1 Flush Tidak Selalu Terlihat dari Java Code

Kode delegate:

```java
public class ApproveDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    execution.setVariable("approved", true);
    execution.setVariable("approvedAt", Instant.now().toString());
  }
}
```

Kamu mungkin merasa dua `setVariable` langsung menulis DB. Secara mental model, lebih aman menganggap:

```text
setVariable -> update entity cache
command ends -> flush variable changes
transaction commit -> durable
```

### 7.2 Implication for Debugging

Jika log delegate menunjukkan:

```text
set approved=true
calling next service
```

Tetapi setelah exception process variable tidak berubah, itu normal jika transaction rollback.

Log Java bukan bukti commit.

Untuk memastikan durable:

- cek apakah command selesai tanpa exception,
- cek DB setelah transaction commit,
- cek history/runtime state,
- cek apakah boundary async/wait state sudah tercapai.

---

## 8. Database Isolation Level: Kenapa `READ COMMITTED`

Camunda 7 documentation menyatakan isolation level yang diperlukan untuk menjalankan Camunda adalah `READ COMMITTED`; setting `REPEATABLE READ` diketahui dapat menyebabkan deadlock, sehingga perubahan isolation level harus hati-hati. Dokumentasi juga memperingatkan bahwa datasource dengan autocommit `true` dapat menyebabkan data inconsistency, deadlock, dan unexpected runtime behavior.

### 8.1 Kenapa Bukan Isolation Paling Tinggi?

Engineer sering berpikir:

```text
SERIALIZABLE lebih kuat -> pasti lebih aman
```

Dalam database application biasa, ini kadang benar. Dalam process engine, belum tentu.

Camunda sudah memiliki concurrency control sendiri melalui:

- `REV_`,
- affected row count,
- rollback on conflict,
- retry job,
- transaction boundaries,
- job locks.

Jika DB isolation dinaikkan terlalu tinggi:

- row/range lock bisa lebih luas,
- deadlock bisa meningkat,
- job acquisition bisa saling menghambat,
- parallel execution bisa lebih sering conflict/block,
- throughput turun,
- behavior berbeda antar vendor.

Karena itu, “lebih strict” tidak otomatis “lebih benar”.

### 8.2 `READ COMMITTED` Mental Model

Dengan `READ COMMITTED`:

- transaksi hanya membaca data yang sudah commit,
- data yang dibaca ulang bisa berubah jika transaksi lain commit di antara dua read,
- non-repeatable read bisa terjadi,
- Camunda mengandalkan optimistic locking untuk write conflict.

Ini cocok dengan model command Camunda yang relatif pendek:

```text
open command
read current state
advance process
flush mutation with REV_ check
commit or rollback
```

### 8.3 Autocommit Harus Mati

Camunda dirancang bekerja dalam transactional mode. Jika autocommit aktif, satu operasi SQL bisa commit sendiri sebelum command selesai. Itu menghancurkan asumsi atomic command.

Dampak buruk:

- partial state persisted,
- rollback tidak mengembalikan semua perubahan,
- entity relation bisa inconsistent,
- deadlock/unexpected runtime behavior,
- incident sulit didiagnosis.

Rule:

> Jangan bypass isolation/autocommit check kecuali kamu benar-benar tahu konsekuensinya dan sudah diuji dalam environment yang mirip production.

---

## 9. Transaction Integration: Standalone, Spring, JTA

Camunda 7 bisa berjalan dalam beberapa mode transaction management:

1. Standalone transaction management.
2. Spring transaction manager.
3. JTA / container-managed transaction.

### 9.1 Standalone

Engine mengelola JDBC transaction sendiri.

Cocok untuk:

- embedded engine sederhana,
- test runtime,
- standalone app,
- Camunda Run-like setup.

Konsekuensi:

- aplikasi harus memastikan datasource benar,
- boundary engine relatif jelas,
- external DB work aplikasi di luar engine transaction kecuali dikaitkan secara manual.

### 9.2 Spring Transaction

Dalam Spring, command Camunda dapat ikut dalam transaction Spring.

Contoh konseptual:

```java
@Transactional
public void approve(String taskId, ApprovalCommand command) {
  auditRepository.save(...);
  taskService.complete(taskId, Map.of("approved", true));
  caseRepository.updateStatus(...);
}
```

Pertanyaan penting:

- Apakah `auditRepository.save` dan `taskService.complete` berada dalam transaction yang sama?
- Jika `taskService.complete` rollback, apakah audit ikut rollback?
- Jika remote call terjadi di tengah, apakah remote side effect ikut rollback? Jawaban: tidak.

Top 1% engineer akan menggambar boundary:

```text
Spring @Transactional boundary
  - app DB write
  - Camunda command
  - maybe more app DB write
commit
```

Lalu memastikan side effect eksternal tidak berada di boundary yang salah.

### 9.3 JTA / Container Transaction

Dalam Java EE/Jakarta EE style, Camunda bisa ikut container-managed transaction.

Konsekuensinya mirip:

- engine command dapat ikut global transaction,
- rollback global transaction rollback state engine,
- external non-transactional side effect tetap tidak rollback,
- XA bukan silver bullet,
- long transaction berbahaya.

### 9.4 Jangan Membuat Transaction Terlalu Panjang

Anti-pattern:

```java
@Transactional
public void completeAndCallManySystems(String taskId) {
  taskService.complete(taskId);
  callSlowRemoteSystemA();
  callSlowRemoteSystemB();
  updateLargeReportTable();
}
```

Masalah:

- DB transaction lama,
- lock lebih lama,
- connection pool tertahan,
- optimistic conflict meningkat,
- rollback semakin mahal,
- remote side effect tidak rollback.

Lebih sehat:

```text
complete task -> async boundary/job -> outbox/external task -> remote call idempotent -> message callback
```

---

## 10. Nested Commands dan ProcessEngineContext

Kadang delegation code memanggil engine API lagi.

Contoh:

```java
public class StartSubCaseDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    execution.getProcessEngineServices()
      .getRuntimeService()
      .startProcessInstanceByKey("subCase", Map.of("parent", execution.getProcessInstanceId()));
  }
}
```

Secara default, nested command dapat menggunakan process engine context yang sama. Artinya:

- entity cache yang sama bisa terlihat,
- changes berada dalam satu transaction,
- rollback outer command bisa rollback nested engine work,
- conflict bisa sulit dipisahkan.

Camunda menyediakan `ProcessEngineContext.requiresNew()` untuk memaksa context baru pada nested engine command tertentu.

Tetapi ini bukan alat yang boleh dipakai sembarangan.

### 10.1 Kapan `requiresNew()` Masuk Akal?

Mungkin masuk akal saat:

- kamu sengaja ingin command engine kedua punya transaction/context terpisah,
- kamu paham konsekuensi partial commit,
- kamu membangun platform extension yang perlu isolasi khusus,
- kamu menghindari cache contamination antara command nested tertentu.

### 10.2 Kapan Berbahaya?

Berbahaya jika dipakai untuk “mengakali rollback”.

Misalnya:

```text
outer process command gagal
inner command sudah commit
```

Sekarang sistem bisa punya state partial:

- parent process rollback,
- child process sudah start,
- audit tidak sinkron,
- operator bingung.

Rule:

> `requiresNew()` adalah surgical tool, bukan reliability pattern umum.

Untuk business side effect, biasanya lebih aman memakai outbox/message/event, bukan nested independent engine transaction.

---

## 11. Common Conflict Pattern #1: Completing Same User Task Twice

### 11.1 Skenario

Dua request masuk hampir bersamaan:

```text
POST /tasks/T1/complete
POST /tasks/T1/complete
```

Penyebab:

- double click,
- browser retry,
- mobile network retry,
- two tabs,
- API consumer retry tanpa idempotency,
- load balancer retry,
- user A dan B sama-sama punya akses.

### 11.2 Apa yang Terjadi

Keduanya membaca task `T1`.

```text
Request A reads ACT_RU_TASK T1 REV_=2
Request B reads ACT_RU_TASK T1 REV_=2
```

A complete:

```text
delete/update task row succeeds
commit
```

B complete:

```text
delete/update task row affected rows = 0
OptimisticLockingException or task not found depending timing
rollback
```

### 11.3 Desain yang Benar

Di API layer:

- gunakan idempotency key untuk complete task command,
- disable double submit di UI tetapi jangan bergantung pada UI,
- return semantic response yang aman:
  - `completed`,
  - `already completed by same command`,
  - `conflict: task no longer active`,
- jangan retry blindly jika command bukan idempotent.

Contoh pattern:

```java
public CompleteTaskResult completeTask(String taskId, String idempotencyKey, Map<String, Object> variables) {
  Optional<CommandResult> existing = idempotencyStore.find(idempotencyKey);
  if (existing.isPresent()) {
    return existing.get().toCompleteTaskResult();
  }

  try {
    taskService.complete(taskId, variables);
    idempotencyStore.saveSuccess(idempotencyKey, taskId);
    return CompleteTaskResult.completed();
  } catch (OptimisticLockingException ex) {
    // Do not blindly hide it.
    // Re-read task/process state and decide whether this is duplicate, stale command, or true conflict.
    return CompleteTaskResult.conflict("Task was modified concurrently; re-read task state.");
  }
}
```

---

## 12. Common Conflict Pattern #2: Parallel Gateway Join

### 12.1 Skenario

```text
          +--> User Task A --+
Start --> |                  | --> Parallel Join --> Continue
          +--> User Task B --+
```

Jika Task A dan Task B selesai hampir bersamaan, dua transaction mencoba meng-update execution/join state yang sama.

### 12.2 Kenapa Conflict Terjadi

Closing parallel gateway perlu tahu:

- branch mana sudah tiba,
- apakah semua branch sudah tiba,
- apakah execution parent bisa dilanjutkan,
- execution mana harus dihapus/merge.

Jika dua branch tiba secara concurrent, keduanya mungkin membaca state join yang sama dan mencoba menjadi “yang pertama” atau “yang terakhir”. Salah satu harus kalah agar state tidak double-advance.

Camunda documentation menyebut synchronization point seperti parallel gateway dan multi-instance sebagai common place untuk optimistic locking.

### 12.3 Apakah Ini Masalah?

Jika conflict terjadi sesekali dan triggered by job executor, biasanya engine retry otomatis.

Jika conflict terjadi karena user API call, salah satu user bisa menerima error. Itu perlu ditangani secara UX/API.

Jika conflict terjadi sangat sering, model mungkin high contention.

### 12.4 Pattern Mitigasi

1. Tambahkan async boundary sebelum/after join jika perlu.
2. Pastikan side effect terjadi sebelum/after boundary yang benar.
3. Hindari parallel branch menulis variable parent yang sama.
4. Gunakan local variables untuk branch-specific data.
5. Consolidate data setelah join dalam satu deterministic step.
6. Untuk high throughput automation, pertimbangkan external task/topic partitioning.

Contoh desain variable:

```text
BAD:
Branch A: setVariable("result", ...)
Branch B: setVariable("result", ...)

BETTER:
Branch A: setVariableLocal("branchAResult", ...)
Branch B: setVariableLocal("branchBResult", ...)
After join: aggregate into parent variable
```

---

## 13. Common Conflict Pattern #3: Multi-Instance Completion

### 13.1 Skenario

Multi-instance service/user task:

```text
Review by N officers
completionCondition: approvedCount >= 2
```

Setiap instance selesai dan update:

- MI body counters,
- completion condition,
- shared variables,
- parent execution.

Jika banyak instance selesai bersamaan, conflict meningkat.

### 13.2 Smell

```java
Integer approvedCount = (Integer) execution.getVariable("approvedCount");
execution.setVariable("approvedCount", approvedCount + 1);
```

Ini read-modify-write pada shared variable.

Di bawah concurrency:

```text
A reads approvedCount=1
B reads approvedCount=1
A writes 2
B writes 2
```

Optimistic locking bisa mencegah lost update pada entity tertentu, tetapi desain tetap high-contention.

### 13.3 Better Patterns

1. Setiap reviewer menulis result per reviewer:

```text
reviewResults[officerId] = APPROVED
```

2. Aggregation dilakukan di satu step setelah MI selesai.
3. Jika perlu early completion, simpan result external di application table dengan unique key.
4. Gunakan idempotent review submission.
5. Jangan menaruh counter mutable shared tanpa concurrency strategy.

---

## 14. Common Conflict Pattern #4: Concurrent Message Correlation

### 14.1 Skenario

Process menunggu message:

```text
Wait for PaymentReceived
Wait for DocumentUploaded
Wait for RiskScoreReturned
```

External systems mengirim event bersamaan untuk business key yang sama.

### 14.2 Apa yang Bisa Bentrok?

- event subscription row,
- execution row,
- process variables,
- parent scope,
- boundary/event subprocess state,
- business table jika satu transaction.

### 14.3 Pattern Mitigasi

1. Event ingestion idempotent.
2. Satu event = satu unique event id.
3. Simpan inbound event di inbox table.
4. Correlate event dalam controlled worker.
5. Partition by business key supaya event untuk case yang sama diproses serial.
6. Jangan semua event langsung memanggil `runtimeService.correlateMessage` dari banyak thread tanpa ordering strategy.

Contoh inbox:

```sql
CREATE TABLE inbound_event (
  event_id        VARCHAR(100) PRIMARY KEY,
  business_key    VARCHAR(100) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  payload_json    CLOB NOT NULL,
  status          VARCHAR(30) NOT NULL,
  received_at     TIMESTAMP NOT NULL,
  processed_at    TIMESTAMP NULL
);
```

Processing:

```text
receive event
  -> insert inbox(event_id) idempotently
  -> worker groups by business_key
  -> correlate message
  -> mark processed
```

---

## 15. Common Conflict Pattern #5: Job Executor Cluster

Dalam cluster, beberapa node menjalankan Job Executor.

Job acquisition memakai DB sebagai coordination layer:

```text
node A scans acquirable jobs
node B scans acquirable jobs
node A locks job J1
node B may also race for J1 or related jobs
```

Camunda menggunakan job lock fields seperti:

- `LOCK_OWNER_`,
- `LOCK_EXP_TIME_`,
- `RETRIES_`,
- `DUEDATE_`.

Conflict bisa terjadi pada:

- acquisition,
- execution state,
- exclusive job ordering,
- parallel jobs pada process instance sama.

### 15.1 Tuning Bukan Hanya Thread Count

Jika conflict tinggi, jangan hanya menaikkan thread pool. Itu bisa memperparah.

Tuning axis:

- acquisition batch size,
- max jobs per acquisition,
- wait time/backoff,
- queue size,
- exclusive jobs,
- job priority,
- async boundary placement,
- process model structure,
- DB index health,
- connection pool sizing.

### 15.2 Exclusive Jobs

Exclusive jobs mencoba menghindari concurrent execution untuk process instance yang sama.

Tetapi ini bukan global serializability guarantee untuk semua interaksi eksternal.

Exclusive jobs membantu untuk:

- async continuations dalam process instance sama,
- mengurangi optimistic locking pada parallel branches tertentu,
- serialisasi sebagian execution path.

Tetap butuh idempotency untuk side effect.

---

## 16. Business Key Uniqueness dan Duplicate Start

Camunda default tidak selalu memaksa business key unik per process definition. Dokumentasi database configuration menyediakan contoh tambahan unique constraint untuk business key pada runtime/history process instance.

### 16.1 Problem

Dua request start process untuk case sama:

```text
POST /case/C-2026-001/start
POST /case/C-2026-001/start
```

Tanpa uniqueness/idempotency:

```text
Process instance P1 businessKey=C-2026-001
Process instance P2 businessKey=C-2026-001
```

Sekarang correlation by business key ambiguous.

### 16.2 Pattern

1. Application-level idempotency store.
2. Unique business key constraint jika cocok dengan domain.
3. Start process dalam transaction yang juga mencatat case creation.
4. Treat duplicate start as successful retrieval jika same command.

Contoh conceptual:

```java
public StartCaseResult startCase(StartCaseCommand command) {
  String businessKey = command.caseId();

  Optional<StartedProcess> existing = processStartStore.findByBusinessKey(businessKey);
  if (existing.isPresent()) {
    return StartCaseResult.alreadyStarted(existing.get().processInstanceId());
  }

  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "caseLifecycle",
      businessKey,
      command.variables()
  );

  processStartStore.insert(businessKey, pi.getId());
  return StartCaseResult.started(pi.getId());
}
```

### 16.3 Caveat

DB unique constraint pada engine table adalah keputusan serius:

- harus sesuai vendor DB,
- harus sesuai lifecycle history/runtime,
- harus diuji pada migration/update,
- jangan asal tambah index di production tanpa memahami query/write pattern.

---

## 17. Side Effect Problem: Rollback Tidak Menghapus Email

Camunda transaction rollback bisa membatalkan:

- execution update,
- task creation,
- variable update,
- job creation,
- history insert dalam DB transaction yang sama.

Tetapi rollback tidak bisa membatalkan:

- email yang sudah terkirim,
- file yang sudah dibuat,
- HTTP request yang sudah diterima service lain,
- Kafka message yang sudah dipublish tanpa transaction coupling,
- pembayaran yang sudah diproses,
- S3 object yang sudah diupload,
- notifikasi push yang sudah terkirim.

### 17.1 Dangerous Delegate

```java
public class SendApprovalEmailDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    emailClient.send(...);                 // non-transactional side effect
    execution.setVariable("emailSent", true);
  }
}
```

Jika setelah email terkirim terjadi optimistic locking conflict, transaction rollback. Variable `emailSent` hilang, tetapi email sudah terkirim.

Saat retry, email terkirim lagi.

### 17.2 Safer Pattern: Outbox

```text
Camunda command transaction:
  -> create outbox row: SEND_APPROVAL_EMAIL(caseId, emailId)
  -> commit

Outbox worker:
  -> read pending outbox
  -> send email idempotently
  -> mark sent
```

Dengan outbox:

- side effect hanya dilakukan setelah command commit,
- retry bisa idempotent,
- duplicate suppression lebih mudah,
- operator bisa melihat pending/failed side effect.

### 17.3 Safer Pattern: External Task

External task adalah wait state. Engine commit dulu bahwa work tersedia. Worker fetch-lock-complete dengan retry/idempotency.

```text
Process reaches external task
  -> commit external task row
Worker fetches task
  -> calls external system
  -> complete/fail task
```

Tetap at-least-once, tetapi boundary lebih jelas.

---

## 18. Retry Semantics: API Caller vs Job Executor

Camunda memperlakukan optimistic locking berbeda tergantung command dipicu oleh siapa.

### 18.1 Job Executor

Jika command dipicu Job Executor dan terjadi `OptimisticLockingException`, engine menganggap ini expected concurrency conflict. Job execution dapat diulang. Dokumentasi Camunda menyatakan optimistic locking pada job execution ditangani otomatis dan tidak mengurangi retry count.

Mental model:

```text
job execution conflict
  -> rollback
  -> job remains / will be retried
  -> no business retry decrement for pure optimistic conflict
```

### 18.2 External API Call

Jika command dipicu user/API:

```java
taskService.complete(taskId)
```

Lalu terjadi conflict:

- transaction rollback,
- exception keluar ke caller,
- caller/application harus memutuskan retry atau tidak,
- non-transactional side effect tetap tidak rollback.

### 18.3 Design Implication

Untuk API-facing commands:

- jangan expose raw stack trace,
- map conflict menjadi domain response,
- re-read state sebelum retry,
- retry hanya jika command idempotent,
- berikan UX yang benar: “task already completed or modified”.

Untuk job-facing commands:

- pastikan delegate idempotent,
- hindari side effect sebelum durable boundary,
- gunakan retry policy yang sadar failure taxonomy.

---

## 19. Async Boundary sebagai Conflict Management Tool

Async boundary bukan obat semua masalah, tetapi sangat penting.

### 19.1 Tanpa Async Boundary

```text
User completes task
  -> Service A
  -> Service B
  -> Parallel join
  -> Service C
  -> next user task
commit
```

Satu transaction besar:

- banyak entity berubah,
- long-running,
- side effect risk besar,
- conflict rollback mahal,
- user request lama.

### 19.2 Dengan Async Boundary

```text
User completes task
  -> asyncBefore Service A
commit
Job executes Service A
  -> asyncBefore Service B
commit
Job executes Service B
  -> next wait state
commit
```

Keuntungan:

- checkpoint lebih sering,
- retry lebih lokal,
- user request cepat kembali,
- conflict scope lebih kecil,
- incident bisa ditangani pada step tertentu.

Biaya:

- lebih banyak jobs,
- lebih banyak DB writes,
- latency tambahan,
- perlu job executor sehat,
- model lebih eksplisit.

### 19.3 Boundary Placement Heuristic

Tambahkan async boundary sebelum/after activity jika activity tersebut:

- memanggil external system,
- mahal/lama,
- rentan failure,
- punya side effect,
- berada sebelum synchronization point,
- perlu retry independen,
- harus meninggalkan audit checkpoint sebelum lanjut,
- triggered by user request tetapi tidak boleh membuat user menunggu.

Jangan tambahkan async boundary hanya karena:

- “biar aman”,
- “biar cepat”,
- “semua service task wajib async”,
- tanpa memahami retry/idempotency.

---

## 20. Database Vendor Differences

Camunda mendukung beberapa relational DB, tetapi behavior concurrency tidak identik.

### 20.1 PostgreSQL

Karakteristik:

- MVCC kuat,
- `READ COMMITTED` default,
- dead tuple/vacuum perlu diperhatikan,
- high churn runtime/history tables butuh autovacuum tuning,
- index bloat bisa mempengaruhi job acquisition.

Potential issue:

- job table hot under high throughput,
- history cleanup massive delete,
- long transaction menghambat vacuum.

### 20.2 Oracle

Karakteristik:

- MVCC via undo,
- read consistency kuat,
- sequence/id generation behavior,
- LOB storage penting untuk byte array/serialized variables/history,
- tablespace growth perlu dipantau.

Potential issue:

- undo pressure,
- row lock waits,
- LOB segment growth,
- high water mark tidak turun hanya karena delete,
- index maintenance untuk hot tables.

### 20.3 MySQL / MariaDB

Karakteristik:

- InnoDB default isolation sering `REPEATABLE READ`, tetapi Camunda membutuhkan `READ COMMITTED`.
- gap locks/next-key locks bisa mempengaruhi concurrency.
- binlog/replication config perlu hati-hati.

Potential issue:

- deadlock jika isolation tidak sesuai,
- lock wait timeout,
- job acquisition contention.

### 20.4 SQL Server

Karakteristik:

- locking/isolation behavior berbeda,
- read committed snapshot setting perlu dipahami,
- index/statistics maintenance penting.

Potential issue:

- blocking read/write,
- deadlock graph perlu dianalisis,
- parameter sniffing/query plan instability pada query besar.

### 20.5 Rule Umum

Jangan mengasumsikan:

```text
Camunda behavior sama persis di semua DB
```

Yang sama adalah engine semantic. Yang bisa berbeda:

- lock wait behavior,
- deadlock detection,
- index usage,
- isolation implementation,
- LOB storage,
- query plan,
- cleanup cost.

---

## 21. Diagnostic: Cara Membaca Optimistic Locking di Production

### 21.1 Pertanyaan Pertama

Jangan langsung bertanya:

```text
Bagaimana suppress exception ini?
```

Tanyakan:

1. Command apa yang gagal?
2. Dipicu oleh user/API atau job executor?
3. Entity apa yang bentrok?
4. Process instance mana?
5. BPMN activity mana?
6. Apakah ada parallel branch/multi-instance/join?
7. Apakah ada concurrent external events?
8. Apakah ada side effect sebelum rollback?
9. Apakah retry aman?
10. Apakah conflict sporadic atau systemic?

### 21.2 Log yang Perlu Ada

Untuk setiap command penting, log:

- correlation id,
- business key,
- process instance id,
- execution id jika ada,
- task id jika ada,
- activity id,
- command type,
- idempotency key,
- external event id,
- job id,
- attempt/retry count,
- exception class.

Contoh log structured:

```json
{
  "event": "task_complete_conflict",
  "businessKey": "CASE-2026-001",
  "processInstanceId": "...",
  "taskId": "...",
  "activityId": "reviewTask",
  "commandId": "approve-req-123",
  "idempotencyKey": "client-abc-789",
  "exception": "OptimisticLockingException"
}
```

### 21.3 SQL Diagnostic: Runtime State

Contoh membaca process instance:

```sql
SELECT ID_, REV_, PROC_INST_ID_, ROOT_PROC_INST_ID_, BUSINESS_KEY_, PROC_DEF_ID_,
       ACT_ID_, IS_ACTIVE_, IS_CONCURRENT_, IS_SCOPE_, PARENT_ID_, SUPER_EXEC_
FROM ACT_RU_EXECUTION
WHERE PROC_INST_ID_ = :processInstanceId
ORDER BY PARENT_ID_, ID_;
```

Baca tasks:

```sql
SELECT ID_, REV_, NAME_, TASK_DEF_KEY_, ASSIGNEE_, PROC_INST_ID_, EXECUTION_ID_, CREATE_TIME_
FROM ACT_RU_TASK
WHERE PROC_INST_ID_ = :processInstanceId;
```

Baca jobs:

```sql
SELECT ID_, REV_, TYPE_, HANDLER_TYPE_, PROC_INST_ID_, EXECUTION_ID_,
       DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, RETRIES_, EXCEPTION_MSG_
FROM ACT_RU_JOB
WHERE PROCESS_INSTANCE_ID_ = :processInstanceId
ORDER BY DUEDATE_;
```

Baca variables:

```sql
SELECT ID_, REV_, NAME_, TYPE_, PROC_INST_ID_, EXECUTION_ID_, TASK_ID_, BYTEARRAY_ID_,
       TEXT_, TEXT2_, LONG_, DOUBLE_
FROM ACT_RU_VARIABLE
WHERE PROC_INST_ID_ = :processInstanceId
ORDER BY NAME_;
```

Baca incidents:

```sql
SELECT ID_, INCIDENT_TYPE_, INCIDENT_MSG_, PROC_INST_ID_, EXECUTION_ID_, ACTIVITY_ID_,
       CAUSE_INCIDENT_ID_, ROOT_CAUSE_INCIDENT_ID_, CONFIGURATION_, CREATE_TIME_
FROM ACT_RU_INCIDENT
WHERE PROC_INST_ID_ = :processInstanceId;
```

### 21.4 Jangan Manual Update Runtime Row

Hindari:

```sql
UPDATE ACT_RU_EXECUTION SET ACT_ID_ = 'nextTask' WHERE ID_ = '...';
DELETE FROM ACT_RU_JOB WHERE ID_ = '...';
UPDATE ACT_RU_TASK SET ASSIGNEE_ = 'x' WHERE ID_ = '...';
```

Gunakan engine API:

- `RuntimeService`,
- `TaskService`,
- `ManagementService`,
- `RepositoryService`,
- process instance modification API,
- incident/job retry API.

Manual mutation bisa:

- merusak execution tree,
- membuat history tidak sinkron,
- menyebabkan orphan variable/job/task,
- merusak deployment cache assumptions,
- membuat migration gagal,
- menciptakan bug yang baru muncul minggu berikutnya.

---

## 22. Decision Matrix: Conflict Handling

| Situasi | Expected? | Retry otomatis? | Respons desain |
|---|---:|---:|---|
| Job executor kena optimistic locking saat parallel join | Ya | Ya | Pastikan delegate idempotent, monitor frequency |
| User double submit complete task | Ya | Tidak otomatis | Idempotency key, re-read state, UX conflict response |
| Multi-instance high contention setiap hari | Tidak sehat | Tergantung trigger | Refactor variable strategy, local result, aggregate later |
| Message duplicate dari external system | Ya | Tidak cukup | Inbox/idempotent event processing |
| Business key duplicate process start | Tergantung domain | Tidak | Unique constraint/app idempotency |
| Delegate kirim email lalu rollback | Berbahaya | Bisa duplicate | Outbox/external task/idempotent email key |
| Deadlock DB setelah isolation dinaikkan | Misconfig/design issue | Bisa retry tetapi root cause tetap ada | Kembalikan recommended isolation, analyze query/locks |
| Conflict sporadic pada high load | Normal sampai batas tertentu | Tergantung | Metrics, threshold, identify hot entities |

---

## 23. Process Design for Low Contention

### 23.1 Hindari Shared Mutable Parent Variable

Bad:

```text
parallel branch A -> setVariable("status", "A_DONE")
parallel branch B -> setVariable("status", "B_DONE")
parallel branch C -> setVariable("status", "C_DONE")
```

Better:

```text
branch A -> setVariableLocal("aDone", true)
branch B -> setVariableLocal("bDone", true)
branch C -> setVariableLocal("cDone", true)
after join -> setVariable("status", "ALL_DONE")
```

### 23.2 Serialisasi Berdasarkan Business Key Jika Domain Memang Serial

Jika domain case tidak boleh diproses paralel untuk event tertentu, jangan biarkan thread bebas memprosesnya.

Gunakan:

- queue partition by business key,
- DB advisory lock application-side,
- inbox worker single-flight per business key,
- idempotency store.

### 23.3 Gunakan Async Boundary untuk Memecah Transaction Besar

Bad:

```text
Complete user task -> 5 service tasks -> join -> remote call -> create next task
```

Better:

```text
Complete user task -> commit
Job step 1 -> commit
Job step 2 -> commit
External task / outbox -> external side effect
Message callback -> continue
```

### 23.4 Jangan Over-Parallelize BPMN

Parallel gateway bukan gratis. Ia menambah:

- execution rows,
- join coordination,
- conflict point,
- cognitive complexity,
- variable scope complexity,
- history volume.

Gunakan parallelism jika:

- domain memang paralel,
- latency benefit nyata,
- state merge jelas,
- retry/idempotency aman,
- operator bisa memahami model.

---

## 24. Java 8–25 Perspective

Camunda 7 estate bisa hidup di berbagai generasi Java, tetapi compatibility tergantung Camunda version, Spring/Boot version, application server, dan library. Untuk bagian persistence/concurrency, prinsipnya stabil lintas Java version, tetapi implementasi aplikasi sebaiknya disesuaikan.

### 24.1 Java 8

Konteks:

- banyak Camunda 7 legacy estate berjalan di Java 8,
- terbatas pada API modern,
- `CompletableFuture` ada tetapi virtual threads belum ada,
- framework version sering tua.

Discipline:

- jangan spawn thread manual di delegate,
- jangan async sendiri di luar engine boundary,
- gunakan transaction manager dengan benar,
- fokus idempotency dan outbox sederhana.

### 24.2 Java 11/17

Konteks:

- baseline enterprise modern,
- better GC/runtime,
- library ecosystem lebih baik,
- Spring Boot 2.x/3.x transition depending Camunda starter.

Discipline:

- gunakan structured logging,
- gunakan HTTP client resilient,
- gunakan records hanya jika runtime/library mendukung,
- jangan simpan Java object serialized sebagai process variable lintas deployment.

### 24.3 Java 21

Konteks:

- virtual threads tersedia,
- modern LTS,
- lebih menarik untuk worker/service layer.

Tetapi:

- virtual threads tidak mengubah transaction semantics Camunda,
- menambah concurrency tanpa backpressure bisa memperparah DB contention,
- job executor masih punya mekanisme sendiri,
- external task worker bisa menggunakan virtual threads dengan throttle yang jelas.

Rule:

> Virtual threads memperbesar kemampuan menjalankan blocking IO, bukan memperbaiki optimistic locking secara otomatis.

### 24.4 Java 25

Untuk Java 25, treat sebagai forward-looking runtime planning. Jangan asumsikan Camunda 7 lama otomatis compatible. Pastikan:

- Camunda version support,
- app server support,
- Spring version support,
- JDBC driver support,
- bytecode target,
- module/classpath behavior,
- test regression.

Persistence/concurrency principle tetap sama:

```text
more threads != more correctness
```

---

## 25. Anti-Patterns

### 25.1 “Catch OptimisticLockingException and Ignore”

Bad:

```java
try {
  taskService.complete(taskId);
} catch (OptimisticLockingException ignored) {
  // assume okay
}
```

Masalah:

- task mungkin belum selesai,
- side effect mungkin partial,
- caller mendapat false success,
- audit misleading,
- process bisa stuck.

Better:

```text
catch conflict
  -> re-read task/process state
  -> classify duplicate/stale/real conflict
  -> return domain response or retry idempotently
```

### 25.2 “Increase Isolation Level to SERIALIZABLE”

Biasanya salah arah. Bisa meningkatkan deadlock/blocking.

Better:

- pakai recommended `READ COMMITTED`,
- perbaiki BPMN contention,
- tambahkan async boundary,
- gunakan idempotency,
- tune job executor,
- cek DB indexes.

### 25.3 “Manual Fix Runtime Tables”

Sangat berbahaya.

Better:

- gunakan API,
- buat admin operation dengan `ManagementService`,
- process instance modification,
- retry failed job,
- migrate instance,
- resolve incident via supported mechanism.

### 25.4 “All Service Tasks Synchronous”

Buruk untuk reliability.

Better:

- activity dengan failure/IO/side-effect diberi boundary yang jelas,
- gunakan async/external task/outbox.

### 25.5 “All Service Tasks Async”

Juga bisa buruk.

Dampak:

- job table bengkak,
- latency bertambah,
- incident bertambah,
- debugging lebih sulit,
- throughput DB turun.

Better:

- async berdasarkan failure boundary, bukan dogma.

---

## 26. Worked Example: Enforcement Case Review

### 26.1 Domain

Regulatory case workflow:

```text
Case Submitted
  -> Screening
  -> Assign Officer
  -> Officer Review
  -> Parallel: Legal Review + Financial Review
  -> Consolidate Findings
  -> Supervisor Approval
  -> Issue Decision
```

### 26.2 Naive Model

```text
Officer Review complete
  -> Legal Review service task sync
  -> Financial Review service task sync
  -> both write variable "reviewStatus"
  -> parallel join
  -> Issue Decision sends email directly
```

Risks:

- long user transaction,
- parallel branch shared variable conflict,
- direct email duplicate on rollback,
- no durable checkpoint before external side effect,
- user sees error if join conflicts,
- audit ambiguous.

### 26.3 Better Model

```text
Officer Review complete
  -> asyncAfter Officer Review
  -> Parallel split
      -> Legal Review external task
         writes local/legal result
      -> Financial Review external task
         writes local/financial result
  -> Parallel join
  -> asyncBefore Consolidate Findings
  -> Consolidate Findings aggregates variables
  -> Supervisor Approval user task
  -> asyncAfter Supervisor Approval
  -> Create Decision Outbox
  -> End / Wait for delivery confirmation
```

### 26.4 Boundary Rationale

| Boundary | Reason |
|---|---|
| `asyncAfter Officer Review` | user action commits before automation starts |
| external task for reviews | remote/long-running work outside engine thread |
| local branch result | avoids shared parent variable contention |
| `asyncBefore Consolidate` | retry aggregation separately after join |
| outbox for decision email | prevents duplicate email on rollback |

### 26.5 Idempotency Keys

| Operation | Key |
|---|---|
| Complete officer review | `taskId + submittedFormVersion` |
| Legal review worker | `processInstanceId + legalReviewActivityInstanceId` |
| Financial review worker | `processInstanceId + financialReviewActivityInstanceId` |
| Decision email | `caseId + decisionVersion + recipient` |
| Message callback | `externalEventId` |

---

## 27. Checklist: Production Persistence & Concurrency Readiness

### 27.1 Engine Configuration

- [ ] Database isolation level is `READ COMMITTED` or vendor equivalent.
- [ ] Autocommit is disabled.
- [ ] Connection pool size aligns with job executor + API traffic.
- [ ] JDBC driver version is supported/tested.
- [ ] Schema version matches engine version.
- [ ] No unsupported manual schema mutation except reviewed indexes/constraints.

### 27.2 BPMN Model

- [ ] Wait states are intentionally placed.
- [ ] Async boundaries exist around failure-prone side effects.
- [ ] Parallel branches do not update same parent variable unnecessarily.
- [ ] Multi-instance writes are partitioned/local/idempotent.
- [ ] Joins are not overloaded as high-throughput synchronization bottlenecks.
- [ ] Message correlations have deterministic keys.
- [ ] Business key uniqueness is defined at domain/application level.

### 27.3 Java Code

- [ ] Delegates are idempotent or side-effect-free.
- [ ] External calls are not done inside risky rollback boundary unless safe.
- [ ] API commands use idempotency key where user/client retry is possible.
- [ ] `OptimisticLockingException` is classified, not blindly swallowed.
- [ ] Retry policy distinguishes technical retry vs business error.
- [ ] No manual thread spawning inside delegate.
- [ ] No long blocking transaction around engine command.

### 27.4 Operations

- [ ] Job executor metrics monitored.
- [ ] Optimistic locking frequency tracked.
- [ ] DB deadlocks/lock waits monitored.
- [ ] Slow queries on runtime/history tables tracked.
- [ ] Incident counts and failed job retries monitored.
- [ ] History cleanup strategy exists.
- [ ] Outbox/inbox backlog monitored.

---

## 28. Troubleshooting Playbook

### 28.1 Symptom: User Task Reappears After Completion

Possible causes:

- transaction rollback after `taskService.complete`,
- exception in following service task before next wait state,
- optimistic locking conflict,
- external side effect happened but engine rollback,
- UI stale cache.

Steps:

1. Check application log around complete command.
2. Check exception stack trace.
3. Check `ACT_RU_TASK` for task existence.
4. Check history `ACT_HI_TASKINST` if history enabled.
5. Check if BPMN after user task has synchronous service tasks.
6. Add asyncAfter user task if boundary is required.

### 28.2 Symptom: Duplicate Email/Notification

Possible causes:

- delegate sent email then transaction rollback,
- job retry after technical exception,
- optimistic locking retry,
- external client retry,
- no idempotency key.

Steps:

1. Identify email command id/key.
2. Check if email sent from delegate or outbox.
3. Check job retry logs.
4. Check optimistic locking logs.
5. Implement idempotent send or outbox.

### 28.3 Symptom: Frequent OptimisticLockingException at Parallel Join

Possible causes:

- high concurrency branch completion,
- no exclusive jobs,
- branches update shared variables,
- multi-instance convergence,
- high thread pool.

Steps:

1. Map BPMN activity id in stack/log.
2. Check if conflict is job-triggered or API-triggered.
3. Inspect branch variable writes.
4. Add local variable strategy.
5. Consider async boundary near join.
6. Tune job executor/exclusive job behavior.

### 28.4 Symptom: DB Deadlocks

Possible causes:

- wrong isolation level,
- autocommit misconfig,
- missing indexes,
- huge cleanup/delete,
- high job acquisition contention,
- long transactions.

Steps:

1. Confirm isolation level.
2. Confirm autocommit false.
3. Capture DB deadlock graph/AWR/pg_stat_activity/etc.
4. Identify tables involved.
5. Check job executor acquisition settings.
6. Review custom queries/indexes.
7. Avoid increasing thread count blindly.

---

## 29. Mini Lab: Reproducing Optimistic Locking

### 29.1 Model

Create BPMN:

```text
Start -> Parallel Split -> User Task A + User Task B -> Parallel Join -> End
```

### 29.2 Scenario

1. Start process.
2. Obtain task IDs A and B.
3. Complete both concurrently using two threads.

Pseudo-code:

```java
ExecutorService pool = Executors.newFixedThreadPool(2);
CountDownLatch ready = new CountDownLatch(2);
CountDownLatch start = new CountDownLatch(1);

Runnable completeA = () -> {
  ready.countDown();
  await(start);
  taskService.complete(taskAId);
};

Runnable completeB = () -> {
  ready.countDown();
  await(start);
  taskService.complete(taskBId);
};

pool.submit(completeA);
pool.submit(completeB);
ready.await();
start.countDown();
```

Expected:

- one complete may win,
- another may hit optimistic locking depending timing,
- if transaction is job-triggered, retry behavior differs,
- process should not corrupt.

### 29.3 Learning Goal

Observe:

- stack trace,
- `ACT_RU_EXECUTION.REV_`,
- task history,
- final process state,
- whether retry is needed at API layer.

---

## 30. Important Distinctions

### 30.1 Optimistic Locking vs Deadlock

| Aspect | Optimistic Locking | Deadlock |
|---|---|---|
| Detected by | Camunda affected row/revision check | Database lock manager |
| Meaning | concurrent modification conflict | transactions wait cyclically |
| Typical action | rollback loser, retry if safe | DB aborts one transaction |
| Often expected? | Yes in some Camunda patterns | Should be investigated |
| Fix | idempotency, async, reduce contention | isolation/index/query/transaction tuning |

### 30.2 Retry vs Idempotency

Retry means doing again.

Idempotency means doing again is safe.

Never confuse them.

```text
Retry without idempotency = duplicate side effect risk
Idempotency without retry = safe but may not recover automatically
```

### 30.3 Database Transaction vs Business Transaction

A database transaction is short and atomic.

A business transaction can run for days/months.

Camunda bridges long-running business transaction through durable wait states, not one giant DB transaction.

---

## 31. Top 1% Mental Model

A strong Camunda 7 engineer thinks like this:

```text
Every process move is a command.
Every command has a database transaction.
Every transaction reads entity revisions.
Every mutation must survive optimistic locking.
Every wait state is a checkpoint.
Every async boundary changes failure scope.
Every external side effect must be idempotent or delayed until after commit.
Every parallel model creates potential merge contention.
Every DB isolation change changes engine behavior.
```

A weaker engineer sees:

```text
Camunda randomly throws OptimisticLockingException.
```

A stronger engineer sees:

```text
Two commands attempted to mutate the same durable process state concurrently.
The engine rejected one to preserve correctness.
Now I need to decide whether this conflict is expected, retryable, user-facing, or a sign of model contention.
```

---

## 32. Ringkasan

Pada bagian ini kita membahas persistence dan concurrency model Camunda 7 secara mendalam:

- Camunda command berjalan dalam `CommandContext`.
- Entity dibaca dan dimodifikasi dalam cache sebelum di-flush.
- Flush mengirim SQL dan mendeteksi conflict.
- Commit membuat state durable.
- Rollback mengembalikan state ke last committed boundary.
- `REV_` adalah basis optimistic locking.
- `OptimisticLockingException` sering expected pada concurrent process execution.
- Job executor dapat menangani optimistic locking secara otomatis dalam konteks job.
- API caller harus punya retry/idempotency strategy sendiri.
- `READ COMMITTED` adalah isolation level yang diperlukan/direkomendasikan untuk Camunda 7.
- Autocommit harus mati.
- Async boundary, external task, outbox, local variable, dan event inbox adalah alat desain untuk mengurangi inconsistency.
- Manual mutation tabel Camunda adalah jalan cepat menuju corrupted runtime state.

---

## 33. Referensi

- Camunda 7.24 Documentation — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7.24 Documentation — Database Configuration: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-configuration/
- Camunda 7.24 Documentation — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7 Javadocs — OptimisticLockingException: https://docs.camunda.org/javadoc/camunda-bpm-platform/7.24/org/camunda/bpm/engine/OptimisticLockingException.html

---

## 34. Status Seri

Bagian ini selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-008.md` — **Variable System Deep Dive: Serialization, Typed Values, Spin, JSON/XML, Object Variables**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-006.md">⬅️ Part 006 — Database Schema Mastery: ACT_RU, ACT_HI, ACT_RE, ACT_GE, ACT_ID</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-008.md">Variable System Deep Dive: Serialization, Typed Values, Spin, JSON/XML, Object Variables ➡️</a>
</div>
