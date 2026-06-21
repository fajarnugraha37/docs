# learn-java-eclipse-glassfish-runtime-server-engineering-part-013

# Part 13 — Transaction Service: JTA, XA, Recovery, Timeout, dan Failure Semantics

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Bagian: `013 / 034`  
> Topik: Eclipse GlassFish Transaction Service  
> Target Java: Java 8 sampai Java 25  
> Fokus: runtime transaction engineering, bukan pengulangan API JPA/EJB/Jakarta Transactions dasar.

---

## 0. Posisi Part Ini dalam Series

Part sebelumnya membahas **JDBC Resources dan Connection Pool Engineering**. Di sana kita melihat bahwa JDBC pool bukan hanya kumpulan koneksi, tetapi boundary runtime antara aplikasi, database, thread pool, transaction manager, dan failure domain.

Part ini naik satu layer: **Transaction Service**.

Kalau connection pool menjawab:

> “Bagaimana aplikasi mendapatkan koneksi ke resource?”

maka transaction service menjawab:

> “Bagaimana runtime menentukan apakah rangkaian perubahan lintas komponen/resource harus commit, rollback, recover, atau dianggap gagal sebagian?”

Dalam aplikasi enterprise, terutama yang berjalan di application server seperti GlassFish, transaction bukan sekadar `commit()` dan `rollback()`. Transaction adalah **koordinasi state change**.

Transaction service menjadi pusat dari beberapa pertanyaan sulit:

- Apakah operasi database dan pengiriman message harus atomik?
- Apa yang terjadi jika database sudah prepare tetapi server crash sebelum commit selesai?
- Siapa yang bertanggung jawab melakukan recovery?
- Kapan timeout transaction harus lebih pendek dari HTTP timeout?
- Kenapa transaction terlalu panjang bisa membuat sistem lambat, bukan lebih aman?
- Kapan XA layak digunakan?
- Kapan XA justru desain yang salah?
- Bagaimana membedakan transaction failure, lock failure, pool exhaustion, dan network failure?

Part ini bertujuan membentuk mental model agar kamu tidak hanya bisa “mengaktifkan JTA”, tetapi bisa **mendesain, mengoperasikan, dan mendiagnosis transaction behavior** secara production-grade.

---

## 1. Apa Itu Transaction Service di GlassFish?

Di GlassFish, **Transaction Service** adalah subsystem yang mengelola transaksi terkoordinasi untuk aplikasi Jakarta EE.

Ia menyediakan runtime support untuk:

- Container-managed transaction.
- Bean-managed transaction.
- JTA / Jakarta Transactions.
- Resource enlistment.
- JDBC transactional connection.
- JMS transactional session.
- XA resource coordination.
- Transaction timeout.
- Rollback-only state.
- Transaction recovery.
- Transaction log.

Secara konseptual:

```text
Application Code
   |
   | calls business method / starts unit of work
   v
Container Boundary
   |
   | starts / joins / suspends / resumes transaction
   v
GlassFish Transaction Manager
   |
   | enlists resources
   | coordinates commit / rollback
   | writes recovery information when needed
   v
Resource Managers
   |-- Database
   |-- JMS Broker
   |-- Connector / RAR
   |-- Other XA-capable system
```

Yang perlu dipahami: transaction service bukan milik JPA, bukan milik EJB saja, bukan milik JDBC saja. Transaction service adalah **runtime coordinator**.

---

## 2. Mental Model Utama: Transaction sebagai Boundary Konsistensi, Bukan Boundary Kode

Engineer junior sering melihat transaction seperti ini:

```java
begin();
doSomething();
doSomethingElse();
commit();
```

Mental model ini terlalu dangkal.

Engineer senior melihat transaction seperti ini:

```text
Transaction = boundary konsistensi state change

Di dalamnya ada:
- resource yang ikut berpartisipasi
- lock yang mungkin ditahan
- connection yang mungkin dipinjam
- thread yang mungkin menunggu
- timeout yang terus berjalan
- recovery metadata yang mungkin ditulis
- side effect yang mungkin tidak bisa dibatalkan
```

Transaction harus dipikirkan sebagai kombinasi:

1. **Atomicity boundary**  
   Apa yang harus sukses/gagal sebagai satu unit?

2. **Isolation boundary**  
   Apa yang boleh terlihat oleh operasi lain selama transaction belum selesai?

3. **Resource lifetime boundary**  
   Berapa lama connection, lock, message session, dan memory dipegang?

4. **Failure recovery boundary**  
   Kalau server crash di tengah, siapa yang bisa melanjutkan keputusan commit/rollback?

5. **Operational blast radius**  
   Kalau transaction lambat, berapa banyak thread, pool, queue, dan user request ikut terdampak?

Dengan mental model ini, transaction bukan sekadar correctness tool. Transaction juga bisa menjadi **risk amplifier** jika salah desain.

---

## 3. Local Transaction vs Global Transaction

### 3.1 Local Transaction

Local transaction hanya melibatkan **satu resource manager**.

Contoh:

```text
Application
  -> one JDBC connection
  -> one database
```

Commit-nya sederhana:

```text
BEGIN
  INSERT order
  UPDATE stock
COMMIT
```

Selama semua perubahan terjadi pada satu database connection yang sama, database dapat mengelola atomicity sendiri.

Kelebihan:

- Lebih cepat.
- Lebih sederhana.
- Recovery lebih mudah.
- Lebih sedikit moving parts.
- Tidak butuh XA.

Kekurangan:

- Tidak bisa menjamin atomicity lintas dua resource berbeda.

Contoh yang tidak bisa dijamin oleh local transaction:

```text
1. Insert order ke Database A
2. Send message ke JMS Broker
```

Jika database commit sukses tetapi message gagal, state menjadi inconsistent.

---

### 3.2 Global Transaction

Global transaction melibatkan **lebih dari satu transactional resource** yang dikoordinasi oleh transaction manager.

Contoh:

```text
Application
  -> Database XAResource
  -> JMS XAResource
  -> Transaction Manager
```

Transaction manager harus memastikan semua resource mengambil keputusan yang sama:

```text
Either:
  DB commit + JMS commit
Or:
  DB rollback + JMS rollback
```

Untuk resource XA, koordinasi dilakukan melalui protokol **two-phase commit**.

---

## 4. JTA / Jakarta Transactions: Siapa Aktor di Dalamnya?

Jakarta Transactions mendefinisikan interface lokal antara beberapa pihak dalam sistem distributed transaction:

```text
Application
Application Server
Transaction Manager
Resource Manager
XAResource
Synchronization callbacks
```

### 4.1 Application

Aplikasi adalah kode bisnis yang membutuhkan transaction boundary.

Ia bisa menggunakan:

- Container-managed transaction via EJB atau interceptor container.
- Bean-managed transaction via `UserTransaction`.
- Framework integration seperti JPA yang join ke transaction aktif.

Aplikasi seharusnya tidak mengimplementasikan 2PC sendiri.

---

### 4.2 Application Server

GlassFish sebagai application server menyediakan container boundary.

Container dapat:

- Memulai transaction sebelum method dijalankan.
- Men-join transaction yang sudah ada.
- Men-suspend transaction.
- Men-resume transaction.
- Menentukan rollback ketika exception tertentu terjadi.
- Mengatur transaction timeout.
- Menghubungkan resource injection dengan transaction manager.

---

### 4.3 Transaction Manager

Transaction manager adalah koordinator.

Tugasnya:

- Membuat transaction context.
- Melacak resource yang enlisted.
- Menjalankan commit atau rollback.
- Menjalankan 2PC jika XA.
- Menulis transaction log untuk recovery.
- Melakukan recovery setelah crash.
- Menentukan final outcome.

Di GlassFish, subsystem transaction service memainkan peran ini.

---

### 4.4 Resource Manager

Resource manager adalah sistem yang menyimpan atau mengelola state transactional.

Contoh:

- RDBMS.
- JMS broker.
- Enterprise information system via connector.
- XA-capable external system.

Resource manager harus menyediakan kontrak tertentu agar bisa dikoordinasi.

---

### 4.5 XAResource

`XAResource` adalah interface yang memungkinkan transaction manager berbicara dengan resource manager dalam protokol XA.

Secara konseptual, transaction manager dapat berkata:

```text
start branch
end branch
prepare branch
commit branch
rollback branch
recover prepared branches
forget heuristic branch
```

Aplikasi business biasanya tidak memanggil ini langsung. Ini dipakai oleh runtime dan driver/provider.

---

## 5. Container-Managed Transaction vs Bean-Managed Transaction

### 5.1 Container-Managed Transaction

Dalam container-managed transaction, aplikasi mendeklarasikan intent, lalu container menjalankan transaction boundary.

Contoh konseptual:

```java
@Stateless
public class PaymentService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void pay(PaymentCommand command) {
        debitAccount(command);
        creditMerchant(command);
    }
}
```

Runtime behavior:

```text
Client call
  -> container intercepts method
  -> transaction exists?
      yes: join existing transaction
      no : begin new transaction
  -> business method executes
  -> if success: commit
  -> if failure requiring rollback: rollback
```

Kelebihan:

- Konsisten.
- Less boilerplate.
- Integrasi baik dengan EJB/JPA/JMS.
- Mudah dipantau oleh container.

Kekurangan:

- Boundary transaction bisa tidak terlihat jika developer tidak paham annotation/default behavior.
- Nested call antar bean dapat menghasilkan behavior yang tidak intuitif.

---

### 5.2 Bean-Managed Transaction

Dalam bean-managed transaction, aplikasi memakai `UserTransaction`.

Contoh konseptual:

```java
@Resource
private UserTransaction tx;

public void process() throws Exception {
    tx.begin();
    try {
        stepOne();
        stepTwo();
        tx.commit();
    } catch (Exception e) {
        tx.rollback();
        throw e;
    }
}
```

Kelebihan:

- Boundary eksplisit.
- Cocok untuk flow tertentu yang tidak cocok dengan deklarasi container.

Kekurangan:

- Mudah salah rollback handling.
- Mudah lupa commit/rollback.
- Mudah membuat transaction terlalu panjang.
- Lebih sulit distandardisasi lintas tim.

Prinsip praktis:

> Gunakan container-managed transaction sebagai default. Gunakan bean-managed transaction hanya jika ada alasan desain yang jelas.

---

## 6. Transaction Attribute sebagai State Machine

Untuk EJB container-managed transaction, attribute seperti `REQUIRED`, `REQUIRES_NEW`, `MANDATORY`, `SUPPORTS`, `NOT_SUPPORTED`, dan `NEVER` harus dipahami sebagai **state transition rule**, bukan sekadar annotation.

### 6.1 REQUIRED

```text
If transaction exists:
  join it
Else:
  create new transaction
```

Cocok sebagai default business operation.

Risiko:

- Method yang dipanggil dalam transaction besar ikut memperpanjang transaction.
- Remote call atau slow IO bisa ikut berada dalam transaction tanpa disadari.

---

### 6.2 REQUIRES_NEW

```text
If transaction exists:
  suspend existing transaction
  create new transaction
  commit/rollback new transaction
  resume previous transaction
Else:
  create new transaction
```

Cocok untuk:

- Audit log yang harus persist walaupun main transaction rollback.
- Outbox record tertentu.
- Isolated update.

Risiko:

- Bisa menghasilkan partial state yang disengaja.
- Developer sering mengira rollback outer transaction akan rollback inner transaction; tidak selalu.

Contoh:

```text
Outer transaction inserts Order
  -> inner REQUIRES_NEW inserts AuditLog and commits
Outer transaction rollback

Result:
  Order rollback
  AuditLog tetap ada
```

Ini bisa benar, bisa juga bug, tergantung intent.

---

### 6.3 MANDATORY

```text
If transaction exists:
  join it
Else:
  fail
```

Cocok untuk method low-level yang tidak boleh dipanggil tanpa transaction.

Ini membuat invariant eksplisit:

> “Method ini hanya valid sebagai bagian dari unit-of-work yang lebih besar.”

---

### 6.4 SUPPORTS

```text
If transaction exists:
  join it
Else:
  run without transaction
```

Risiko:

- Behavior berubah tergantung caller.
- Method yang tampak read-only bisa ikut menahan lock jika dipanggil dari transaction aktif.

Gunakan hati-hati.

---

### 6.5 NOT_SUPPORTED

```text
If transaction exists:
  suspend it
Run without transaction
Resume existing transaction
```

Cocok untuk:

- Remote HTTP call yang tidak boleh menahan transaction.
- Long read-only operation yang tidak perlu transaction.
- Logging non-transactional.

---

### 6.6 NEVER

```text
If transaction exists:
  fail
Else:
  run without transaction
```

Cocok untuk mencegah misuse.

---

## 7. Transaction Timeout: Batas Waktu Konsistensi

Transaction timeout bukan sekadar timeout teknis. Ia adalah batas maksimal sistem bersedia menahan:

- database connection,
- database lock,
- transaction context,
- recovery state,
- JMS session,
- thread execution,
- user request dependency.

Kalau timeout terlalu panjang:

- lock ditahan terlalu lama,
- pool habis,
- deadlock/lock wait meningkat,
- user request menggantung,
- recovery menjadi lebih berat,
- throughput turun.

Kalau timeout terlalu pendek:

- operasi valid sering rollback,
- retry storm bisa terjadi,
- user melihat false failure,
- transaction sering abort saat beban tinggi.

### 7.1 Timeout Layering

Dalam production, transaction timeout harus dibandingkan dengan timeout lain:

```text
Client timeout
Reverse proxy timeout
HTTP listener/request timeout
Application operation timeout
Transaction timeout
JDBC query timeout
DB lock wait timeout
DB statement timeout
JMS receive/send timeout
```

Prinsip umum:

```text
query timeout <= transaction timeout <= request timeout <= proxy/client timeout
```

Kenapa?

Karena kalau client/proxy timeout lebih dulu tetapi transaction masih jalan, server bisa terus memproses operation yang user anggap gagal.

Contoh buruk:

```text
Proxy timeout        = 30s
Transaction timeout  = 300s
DB query timeout     = none
```

Dampak:

```text
User mendapat 504 di detik ke-30
Server tetap memegang DB connection dan lock sampai 300s atau lebih
Retry user masuk
Load berlipat
Pool makin habis
```

Contoh lebih sehat:

```text
DB query timeout     = 20s
Transaction timeout  = 25s
HTTP/proxy timeout   = 30s
Client timeout       = 35s
```

Tidak selalu angka ini cocok, tetapi urutan logikanya penting.

---

## 8. Rollback-Only State

Salah satu konsep penting dalam JTA adalah **rollback-only**.

Rollback-only berarti:

> Transaction masih aktif secara teknis, tetapi sudah ditandai tidak boleh commit.

Contoh:

```text
Business method starts transaction
  -> step A succeeds
  -> step B catches exception internally
  -> container/resource marks transaction rollback-only
  -> code continues to step C
  -> method returns normally
  -> container tries commit
  -> commit fails because transaction is rollback-only
```

Ini sering membingungkan developer karena exception asli terjadi jauh sebelum commit.

### 8.1 Kenapa Rollback-Only Terjadi?

Beberapa penyebab:

- Runtime exception dalam CMT method.
- EJB exception policy.
- Persistence exception dari JPA provider.
- SQL exception yang membuat transaction invalid.
- Transaction timeout.
- Explicit `setRollbackOnly()`.
- Resource manager failure.

### 8.2 Anti-Pattern: Catch Exception lalu Lanjut

Contoh buruk:

```java
try {
    repository.save(entity);
} catch (Exception e) {
    log.warn("save failed, continue", e);
}

repository.save(otherEntity);
```

Jika exception pertama membuat transaction rollback-only, save kedua mungkin tampak berjalan, tetapi akhirnya semua rollback.

Prinsip:

> Dalam transaction boundary, jangan swallow exception yang menandakan state persistence gagal kecuali kamu benar-benar paham apakah transaction masih valid.

---

## 9. Resource Enlistment: Kapan Resource Ikut Transaction?

Resource enlistment adalah proses ketika transaction manager mencatat resource sebagai peserta transaction.

Contoh:

```text
Transaction starts
  -> application obtains JDBC connection from transactional pool
  -> connection is enlisted
  -> application sends JMS message through XA connection factory
  -> JMS resource is enlisted
```

Jika hanya satu resource enlisted, commit bisa one-phase.

Jika lebih dari satu XA resource enlisted, transaction manager biasanya perlu 2PC.

### 9.1 Auto-Enlistment

Dalam application server, resource yang diperoleh dari container-managed resource biasanya otomatis ikut transaction aktif.

Contoh:

```java
@Resource(lookup = "jdbc/app")
DataSource ds;
```

Saat connection diambil dalam transaction aktif, GlassFish dapat menghubungkan connection itu dengan transaction manager.

### 9.2 Non-Transactional Connection

GlassFish connection pool dapat dikonfigurasi agar mengembalikan non-transactional connection. Connection seperti ini tidak otomatis enlisted ke transaction manager.

Ini berguna untuk kasus khusus seperti:

- menulis log teknis yang tidak ingin rollback,
- membaca metadata,
- transaction log store tertentu,
- operation yang harus berada di luar global transaction.

Namun ini berbahaya jika digunakan tanpa desain.

Contoh masalah:

```text
Main transaction rollback
Non-transactional audit insert tetap commit
```

Bisa benar jika audit harus immutable. Bisa salah jika audit menyatakan operasi sukses padahal rollback.

---

## 10. One-Phase Commit vs Two-Phase Commit

### 10.1 One-Phase Commit

Jika transaction hanya melibatkan satu resource, transaction manager dapat memakai one-phase commit.

```text
TM -> Resource: commit
Resource -> TM: ok/fail
```

Lebih sederhana dan lebih cepat.

---

### 10.2 Two-Phase Commit

Jika transaction melibatkan beberapa XA resource, 2PC digunakan untuk mencapai keputusan bersama.

```text
Phase 1: Prepare
  TM -> Resource A: prepare?
  TM -> Resource B: prepare?

If all vote yes:
  Phase 2: Commit
    TM -> Resource A: commit
    TM -> Resource B: commit
Else:
  Phase 2: Rollback
    TM -> Resource A: rollback
    TM -> Resource B: rollback
```

Mental model:

```text
prepare = resource berjanji bisa commit nanti
commit  = keputusan final
```

Setelah resource menjawab prepare sukses, resource harus mampu commit meskipun ada crash/restart. Karena itu recovery log penting.

---

## 11. XA Recovery: Kenapa Transaction Log Penting?

Bayangkan flow ini:

```text
1. Transaction manager asks DB: prepare
2. DB replies: prepared
3. Transaction manager asks JMS: prepare
4. JMS replies: prepared
5. Transaction manager decides: commit
6. Server crashes before sending commit to all resources
```

Sekarang sistem berada di state berbahaya:

```text
Resource A mungkin sudah commit
Resource B mungkin masih prepared
Transaction manager harus tahu final decision setelah restart
```

Di sinilah transaction log/recovery information dipakai.

Transaction manager harus bisa menjawab:

- Transaction mana yang in-doubt?
- Resource mana yang sudah prepared?
- Keputusan final-nya commit atau rollback?
- Resource mana yang perlu dihubungi ulang?

### 11.1 In-Doubt Transaction

In-doubt transaction adalah transaction branch yang outcome final-nya belum jelas bagi salah satu pihak.

Contoh:

```text
DB branch prepared
TM crash sebelum commit/rollback final diterima DB
```

DB menunggu recovery.

Jika recovery tidak berjalan:

- lock bisa tertahan,
- prepared transaction menumpuk,
- data tidak bisa diubah,
- manual DBA intervention mungkin dibutuhkan.

---

## 12. Transaction Recovery di GlassFish

GlassFish Administration Guide membahas administrasi transaction service, konfigurasi transaction log, rollback management, dan recovery transaction.

Secara operasional, recovery penting untuk kasus:

- server crash saat XA transaction,
- resource manager restart,
- network failure saat commit,
- cluster/instance failover,
- transaction log tidak tersedia,
- database transaction log store rusak/salah konfigurasi.

### 12.1 Recovery Invariant

Agar recovery mungkin dilakukan, sistem harus menjaga invariant berikut:

```text
Transaction manager identity stable
Transaction logs durable
Resource manager reachable again
XA resource identity consistent
Driver/provider supports recovery correctly
```

Jika salah satu hilang, recovery bisa gagal.

Contoh:

```text
Container pod restart dengan emptyDir transaction log
XA transaction sedang prepared
Pod hilang, log hilang
TM baru tidak tahu final decision
```

Ini alasan kenapa stateful transaction log tidak boleh dianggap sepele dalam container/Kubernetes.

---

## 13. Transaction Log Store: File vs JDBC

Transaction service membutuhkan tempat menyimpan informasi recovery.

Secara umum, ada dua pendekatan:

1. File-based transaction log.
2. JDBC/database transaction log.

### 13.1 File-Based Transaction Log

Kelebihan:

- Sederhana.
- Cepat.
- Cocok untuk standalone server.

Kekurangan:

- Harus durable.
- Harus ikut backup/restore.
- Dalam container harus dipikirkan volume persistence.
- Dalam failover, instance lain mungkin tidak bisa membaca log.

### 13.2 JDBC Transaction Log

GlassFish mendukung konfigurasi transaction logging melalui database/JDBC untuk skenario tertentu.

Kelebihan:

- Lebih cocok untuk recovery/failover tertentu.
- Bisa lebih mudah dikelola dalam infra yang sudah database-centric.

Kekurangan:

- Membutuhkan datasource khusus.
- Harus hati-hati agar logging transaction tidak ikut transaction yang sama.
- Menambah dependency ke database.
- Jika database down, transaction service juga terdampak.

Prinsip:

> Transaction log store adalah bagian dari reliability architecture, bukan sekadar file konfigurasi.

---

## 14. XA vs Non-XA Datasource

### 14.1 Non-XA Datasource

Non-XA datasource cocok untuk:

- single database transaction,
- aplikasi yang tidak membutuhkan atomicity lintas resource,
- high-throughput OLTP sederhana,
- arsitektur dengan outbox/eventual consistency.

Kelebihan:

- Lebih ringan.
- Lebih mudah dioperasikan.
- Lebih sedikit recovery complexity.

### 14.2 XA Datasource

XA datasource dibutuhkan jika resource harus ikut distributed transaction.

Contoh:

```text
Transaction:
  - update Oracle DB
  - send JMS message transactionally
```

Kelebihan:

- Atomicity lintas resource.
- Container-managed coordination.

Kekurangan:

- Lebih lambat.
- Lebih kompleks.
- Butuh driver XA benar.
- Butuh recovery benar.
- Bisa menghasilkan in-doubt branch.
- Sulit di-debug.

### 14.3 Decision Rule

Gunakan XA jika:

```text
- ada dua atau lebih resource transactional,
- atomicity kuat benar-benar dibutuhkan,
- semua resource mendukung XA dengan benar,
- recovery dapat diuji,
- operational team siap menangani in-doubt transaction.
```

Jangan gunakan XA jika:

```text
- hanya satu database,
- atomicity lintas resource bisa diganti outbox,
- broker/driver XA tidak matang,
- workload high-throughput dan latency-sensitive,
- tim tidak punya recovery playbook,
- environment container tidak menyimpan transaction log secara durable.
```

---

## 15. Last Resource Optimization: Jalan Tengah yang Berbahaya

Beberapa transaction manager mendukung pola yang dikenal sebagai **last resource optimization** atau sejenisnya: satu resource non-XA ikut dalam global transaction bersama XA resource.

Konsepnya:

```text
XA Resource A prepare
XA Resource B prepare
Non-XA Resource C commit as last resource
Then XA resources commit
```

Masalahnya:

- Non-XA resource tidak bisa prepare.
- Jika non-XA commit sukses lalu XA commit gagal, atomicity rusak.
- Jika XA prepared tapi last resource gagal, recovery tricky.

Pola ini bisa dipakai dalam kondisi sangat terbatas, tetapi jangan dianggap setara dengan XA penuh.

Decision:

> Jika correctness benar-benar kritikal, jangan bergantung pada last-resource trick tanpa memahami failure window-nya.

---

## 16. Transaction dan JDBC Pool: Coupling yang Sering Dilupakan

Transaction memegang connection sampai transaction selesai.

Artinya:

```text
long transaction = long connection checkout
long connection checkout = pool pressure
pool pressure = request blocking
request blocking = thread pool pressure
thread pool pressure = system-wide slowdown
```

Contoh:

```java
@Transactional
public void process() {
    repository.updateStatus();      // DB connection checked out
    callExternalApi();              // waits 8 seconds
    repository.updateResult();      // same transaction
}
```

Jika connection tetap dipegang selama external API call, maka external latency mengonsumsi DB pool.

Lebih baik:

```text
Transaction 1:
  mark processing
Commit

External API call outside transaction

Transaction 2:
  save result
Commit
```

Atau gunakan outbox/state machine.

---

## 17. Transaction dan Lock

Database transaction dapat menahan lock.

Lock bisa berupa:

- row lock,
- table lock,
- index range lock,
- metadata lock,
- foreign key related lock,
- sequence/unique constraint contention.

Semakin lama transaction hidup, semakin lama lock bisa tertahan.

### 17.1 Hidden Lock Amplifier

Beberapa operasi terlihat kecil tetapi bisa menahan lock lama:

- update status row populer,
- insert dengan unique key hot spot,
- update parent row dengan banyak child,
- select for update,
- batch update besar,
- long-running report dalam isolation terlalu kuat,
- transaction yang melakukan remote call di tengah.

### 17.2 Timeout Layer dengan DB Lock

Jika DB lock wait timeout lebih panjang dari transaction timeout, error yang muncul bisa membingungkan.

Jika transaction timeout lebih dulu:

```text
GlassFish marks transaction rollback-only
DB operation masih menunggu/terputus kemudian
Application melihat transaction rollback error
```

Jika DB lock timeout lebih dulu:

```text
SQL exception terjadi
Transaction biasanya invalid/rollback-only
Commit akhir gagal
```

Yang penting adalah korelasi log:

```text
server.log transaction timeout
application log persistence exception
DB log lock wait/deadlock
JDBC pool metrics
thread dump socket read / DB driver wait
```

---

## 18. Transaction dan JMS

JMS dalam transaction punya behavior penting.

### 18.1 Sending Message in Transaction

Jika aplikasi mengirim JMS message dalam transaction:

```text
Begin transaction
  update DB
  send JMS message
Commit
```

Message biasanya tidak visible ke consumer sampai transaction commit.

Jika rollback:

```text
DB rollback
JMS send rollback
```

Ini berguna untuk atomic DB + message jika XA dipakai.

### 18.2 Consuming Message in Transaction

Untuk MDB/consumer transactional:

```text
Receive message
Begin transaction
  process message
  update DB
Commit
Ack message
```

Jika rollback:

```text
DB rollback
Message not acknowledged
Message redelivered
```

Dampak:

- consumer harus idempotent,
- poison message harus ditangani,
- redelivery policy penting,
- dead letter queue penting.

### 18.3 Transaction Tidak Menghapus Kebutuhan Idempotency

Bahkan dengan XA, idempotency tetap penting karena:

- client retry,
- message redelivery,
- timeout ambiguous,
- external side effect non-transactional,
- manual recovery.

---

## 19. Transaction dan External HTTP Call

External HTTP call hampir selalu **non-transactional side effect** dari sudut pandang JTA.

Contoh buruk:

```text
Begin transaction
  insert payment row
  call payment gateway charge API
  update payment status
Commit
```

Jika commit gagal setelah gateway charge sukses:

```text
Money charged
DB rollback
System does not record charge
```

Transaction database tidak bisa rollback payment gateway.

Prinsip:

> Jangan menaruh irreversible external side effect di tengah database transaction lalu menganggap transaction akan melindungi semuanya.

Pola lebih sehat:

```text
1. DB transaction: create PaymentIntent=PENDING
2. Commit
3. Call external gateway with idempotency key
4. DB transaction: record result
5. Reconcile async if uncertain
```

Untuk top 1% engineering, ini sangat penting: **transaction boundary tidak sama dengan business consistency boundary** jika sistem melibatkan external side effect.

---

## 20. Outbox Pattern vs XA

### 20.1 Problem

Kita ingin:

```text
Update database
Publish event/message
```

XA approach:

```text
Global transaction with DB XA + JMS XA
```

Outbox approach:

```text
Local DB transaction:
  update business table
  insert outbox event row
Commit

Async publisher:
  read outbox
  publish message
  mark published
```

### 20.2 Trade-off

XA:

- Strong atomicity lintas resource.
- Higher operational complexity.
- Recovery complexity.
- Latency overhead.

Outbox:

- Atomicity antara business state dan event record dalam satu DB.
- Eventual delivery ke broker.
- Butuh publisher/retry/idempotency.
- Lebih cloud/microservice friendly.

### 20.3 Decision

Gunakan outbox jika:

- broker publish bisa eventual,
- consumer idempotent,
- ordering bisa didesain,
- local DB adalah source of truth,
- sistem butuh scalability/operability.

Gunakan XA jika:

- atomicity lintas resource benar-benar strict,
- resource XA mature,
- recovery diuji,
- operational overhead diterima.

---

## 21. Saga vs Transaction

Saga adalah koordinasi business process melalui serangkaian local transaction dan compensating action.

Contoh:

```text
Reserve inventory
Authorize payment
Create shipment
Confirm order
```

Jika shipment gagal:

```text
Cancel payment authorization
Release inventory
Mark order failed
```

Saga bukan pengganti ACID dalam satu database. Saga adalah strategi untuk **distributed business consistency**.

Gunakan saga ketika:

- workflow lintas service,
- external side effect tidak bisa rollback teknis,
- operation panjang,
- user journey punya state transition,
- compensation bisa didefinisikan.

Jangan gunakan saga untuk mengganti transaction kecil dalam satu database jika ACID lokal cukup.

---

## 22. Transaction Timeout vs Business SLA

Transaction timeout harus diturunkan dari business dan technical SLA.

Contoh:

```text
User checkout endpoint SLA: p95 < 2s, timeout 10s
DB normal latency: 50ms
External payment call: 3s p95
```

Desain buruk:

```text
One transaction wraps DB + external payment call
Transaction timeout 60s
```

Desain lebih baik:

```text
Transaction A: create payment intent < 200ms
External call: max 5s with idempotency key
Transaction B: save payment result < 200ms
Async reconciliation for uncertain result
```

Rule:

> Long business process should not equal long database transaction.

---

## 23. Transaction Isolation: Bukan Semakin Tinggi Semakin Baik

Transaction isolation menentukan fenomena concurrency yang dicegah.

Level umum:

- READ UNCOMMITTED.
- READ COMMITTED.
- REPEATABLE READ.
- SERIALIZABLE.

Dalam GlassFish/JDBC pool, isolation level dapat dikonfigurasi pada connection pool.

Namun isolation bukan tuning sembarangan.

### 23.1 Risiko Isolation Terlalu Rendah

- Dirty read.
- Non-repeatable read.
- Phantom read.
- Inconsistent business decision.

### 23.2 Risiko Isolation Terlalu Tinggi

- Lock lebih banyak.
- Deadlock lebih sering.
- Throughput turun.
- Long transaction makin berbahaya.

### 23.3 Practical Rule

Gunakan default database/application yang sudah dipahami, lalu naikkan isolation hanya untuk use case yang benar-benar membutuhkan.

Untuk invariant bisnis, sering kali lebih baik memakai:

- unique constraint,
- optimistic locking,
- version column,
- explicit status transition,
- idempotency key,
- conditional update,

bukan langsung menaikkan isolation seluruh pool.

---

## 24. Optimistic Locking dan Transaction Manager

Optimistic locking biasanya terjadi di level JPA/database.

Contoh:

```text
Read entity version=5
Another transaction updates version=6
This transaction tries update version=5
OptimisticLockException
Transaction marked rollback-only
```

Dampak runtime:

- exception bukan sekadar validation error,
- transaction biasanya harus rollback,
- retry harus memulai transaction baru,
- jangan retry dalam transaction yang sama setelah rollback-only.

Pola benar:

```text
Attempt transaction
If optimistic lock failure:
  rollback
  reload current state
  decide retry/merge/conflict response
Start new transaction if retry
```

---

## 25. Deadlock dan Transaction Service

Deadlock adalah database-level concurrency failure.

Contoh:

```text
Tx A locks row 1, waits row 2
Tx B locks row 2, waits row 1
DB detects deadlock
DB aborts one transaction
```

Dari sisi GlassFish:

- JDBC driver mengembalikan SQL exception.
- Persistence provider mungkin membungkus exception.
- Transaction menjadi rollback-only.
- Commit akhir gagal/rollback.

### 25.1 Mengurangi Deadlock

Prinsip:

- update resource dalam urutan konsisten,
- transaction pendek,
- hindari user/external wait dalam transaction,
- index query dengan benar,
- gunakan batch size masuk akal,
- pisahkan hot row,
- gunakan optimistic locking jika cocok,
- gunakan queue untuk serialisasi hot aggregate.

---

## 26. Heuristic Outcome

Heuristic outcome terjadi ketika resource mengambil keputusan commit/rollback sendiri yang mungkin berbeda dari global outcome.

Contoh:

```text
TM decides rollback
Resource heuristically commits branch
```

Ini adalah kondisi serius.

Dampaknya:

- atomicity rusak,
- perlu manual reconciliation,
- transaction manager mungkin mencatat heuristic state,
- operator harus memahami resource-specific recovery.

Rule:

> Jika sistem kamu menggunakan XA, kamu harus punya playbook untuk heuristic dan in-doubt transaction, bukan hanya happy path.

---

## 27. Manual Recovery Mindset

Manual recovery bukan berarti langsung edit data.

Urutan pikir:

```text
1. Identifikasi transaction id / branch id.
2. Identifikasi resource yang terlibat.
3. Cek transaction manager log.
4. Cek resource manager prepared/in-doubt state.
5. Tentukan global outcome yang seharusnya.
6. Gunakan mekanisme recovery resmi jika ada.
7. Jika manual intervention, dokumentasikan keputusan.
8. Rekonsiliasi business state.
9. Tambahkan preventive control.
```

Dalam sistem regulated, recovery action harus audit-ready:

- siapa yang memutuskan,
- berdasarkan log apa,
- data apa yang terdampak,
- action apa yang dilakukan,
- validasi setelah action,
- preventive follow-up.

---

## 28. GlassFish Configuration Surface untuk Transaction Service

Transaction service dapat dikonfigurasi via:

- Admin Console.
- `asadmin set`.
- `domain.xml` melalui supported path/config management.

Contoh pola inspeksi:

```bash
asadmin get "server-config.transaction-service.*"
```

Contoh pola update konseptual:

```bash
asadmin set server-config.transaction-service.timeout-in-seconds=120
```

Nama attribute spesifik dapat berbeda antar versi, jadi selalu verifikasi dengan:

```bash
asadmin get "*.transaction-service.*"
```

atau dokumentasi reference manual versi yang digunakan.

### 28.1 Configuration Principle

Jangan mengubah transaction timeout secara global tanpa memahami semua workload.

Lebih baik pisahkan:

- transaction service global default,
- method-level timeout jika tersedia/cocok,
- query timeout,
- endpoint timeout,
- batch timeout,
- async worker timeout.

---

## 29. Transaction dan Cluster

Dalam cluster, transaction service menjadi lebih kompleks.

Pertanyaan penting:

- Apakah transaction log lokal per instance?
- Apakah recovery bisa dilakukan oleh instance lain?
- Apakah resource identity stabil per instance?
- Apakah JMS broker embedded atau remote?
- Apakah DB XA recovery melihat TM id yang sama?
- Apa yang terjadi jika instance mati saat prepared transaction?

### 29.1 Cluster Invariant

```text
Each instance must have stable transaction identity
Transaction log must survive required failure mode
Resource recovery credentials must be available
Recovery procedure must be tested
```

Jika tidak, cluster hanya memberi ilusi HA.

---

## 30. Transaction di Kubernetes / Container

Container memperkenalkan masalah baru:

```text
Pod is disposable
Filesystem may be ephemeral
IP/name can change
Restart can happen anytime
```

Untuk local transaction biasa, ini sering manageable.

Untuk XA transaction, ini serius.

### 30.1 Risiko

- Transaction log hilang saat pod mati.
- Pod baru punya identity berbeda.
- XA resource recovery tidak mengenali coordinator lama.
- Prepared branch tertinggal di database/broker.
- Manual recovery diperlukan.

### 30.2 Prinsip

Jika menggunakan XA di Kubernetes:

- gunakan persistent transaction log atau JDBC log sesuai desain,
- pastikan instance identity stabil,
- uji crash saat prepare/commit,
- uji broker/database restart,
- dokumentasikan recovery.

Jika tidak siap, pertimbangkan:

- local transaction + outbox,
- idempotent consumer,
- saga,
- state machine.

---

## 31. Diagnosing Transaction Timeout

Gejala:

- request lambat lalu gagal,
- log transaction timeout,
- rollback exception,
- DB pool penuh,
- thread dump banyak menunggu DB/socket,
- user retry menyebabkan beban naik.

### 31.1 Diagnosis Flow

```text
1. Cari timestamp timeout di server.log.
2. Korelasikan dengan request/access log.
3. Cari thread yang menjalankan request tersebut.
4. Cek apakah thread menunggu DB, HTTP, JMS, lock, atau CPU.
5. Cek JDBC pool active/idle/waiting.
6. Cek DB active session/lock wait.
7. Cek transaction duration.
8. Cek apakah external call terjadi dalam transaction.
9. Cek apakah query timeout lebih panjang dari transaction timeout.
10. Tentukan apakah timeout adalah root cause atau symptom.
```

### 31.2 Common Root Causes

- DB query lambat.
- Lock contention.
- External API call dalam transaction.
- Transaction mencakup batch terlalu besar.
- Pool exhausted.
- Thread starvation.
- JMS broker slow.
- Deadlock/lock wait.
- Transaction timeout terlalu pendek untuk legitimate workload.

---

## 32. Diagnosing Rollback Exception Saat Commit

Gejala:

```text
Business method seems successful
Commit fails
RollbackException appears
```

Kemungkinan:

- Earlier persistence exception swallowed.
- Transaction marked rollback-only.
- Timeout occurred before commit.
- Resource manager voted rollback.
- XA prepare failed.
- Constraint violation flushed at commit time.

Diagnosis:

```text
1. Cari exception pertama, bukan exception terakhir.
2. Periksa log sebelum RollbackException.
3. Cari transaction timeout marker.
4. Periksa JPA flush behavior.
5. Periksa DB constraint log.
6. Periksa whether exception was caught and ignored.
```

Prinsip:

> RollbackException di commit sering hanya final symptom. Root cause biasanya lebih awal.

---

## 33. Diagnosing XA Recovery Failure

Gejala:

- server startup recovery error,
- prepared transaction stuck di DB,
- JMS message tidak commit/rollback,
- repeated recovery attempt,
- transaction log read error,
- resource not available during recovery.

Diagnosis:

```text
1. Identifikasi transaction id.
2. Identifikasi resources enlisted.
3. Cek transaction log availability.
4. Cek DB/JMS XA recovery credentials.
5. Cek apakah driver/provider berubah setelah crash.
6. Cek apakah server identity berubah.
7. Cek apakah transaction log path berubah/hilang.
8. Cek resource manager prepared branch.
9. Jalankan recovery sesuai prosedur resmi.
```

Pencegahan:

- jangan upgrade driver/server saat ada in-doubt transaction,
- drain traffic sebelum maintenance,
- stop server graceful,
- monitor prepared transactions,
- test crash recovery.

---

## 34. Designing Transaction Boundary: Step-by-Step Framework

Untuk setiap use case, jawab pertanyaan ini:

### Step 1 — Apa state yang berubah?

```text
- DB table apa?
- JMS message apa?
- external API apa?
- file/object storage apa?
- cache apa?
```

### Step 2 — Mana yang transactional resource?

```text
- DB local transaction?
- DB XA?
- JMS XA?
- external HTTP non-transactional?
- cache non-transactional?
```

### Step 3 — Atomicity apa yang benar-benar wajib?

```text
Hard atomicity:
  all commit or all rollback technically

Business consistency:
  can be eventually reconciled

Audit consistency:
  must preserve evidence even on rollback
```

### Step 4 — Berapa lama transaction boleh hidup?

```text
- p95 normal latency?
- worst case latency?
- lock tolerance?
- user SLA?
- retry behavior?
```

### Step 5 — Apa failure window-nya?

```text
- crash before commit
- crash after external API call
- broker unavailable
- DB lock wait
- duplicate message
- timeout ambiguous
```

### Step 6 — Recovery strategy apa?

```text
- automatic JTA recovery
- outbox retry
- saga compensation
- manual reconciliation
- idempotent retry
```

### Step 7 — Observability apa yang dibutuhkan?

```text
- transaction duration
- rollback count
- timeout count
- DB lock wait
- pool waiting
- message redelivery
- outbox backlog
```

---

## 35. Good Patterns

### 35.1 Short Transaction Pattern

```text
Begin transaction
  validate current state
  update minimal rows
  write event/outbox if needed
Commit
Do slow side effect outside transaction
```

### 35.2 Outbox Pattern

```text
Begin transaction
  update aggregate
  insert outbox_event
Commit
Publisher asynchronously publishes event
Consumer idempotently processes event
```

### 35.3 Audit Requires-New Pattern

```text
Main transaction
  business update
  call audit service with REQUIRES_NEW if audit must survive rollback
```

Caveat:

- audit wording must not falsely claim business success before final commit.

### 35.4 Idempotency Key Pattern

```text
External side effect call includes idempotency key
DB records request id / external correlation id
Retry safe if timeout ambiguous
```

### 35.5 Conditional Update Pattern

```sql
UPDATE case_table
SET status = 'APPROVED'
WHERE id = ?
  AND status = 'PENDING'
```

Then check affected rows.

This reduces race condition without overusing serializable isolation.

---

## 36. Bad Patterns

### 36.1 Remote Call Inside DB Transaction

```text
Begin transaction
  update DB
  call slow external API
  update DB
Commit
```

Risk:

- long lock,
- pool exhaustion,
- ambiguous external side effect,
- rollback cannot undo external call.

### 36.2 Huge Batch in One Transaction

```text
Begin transaction
  process 1,000,000 rows
Commit
```

Risk:

- undo/redo pressure,
- lock pressure,
- timeout,
- rollback very expensive,
- memory pressure.

Better:

```text
chunked transaction with checkpointing
```

### 36.3 XA Without Recovery Test

```text
DB XA + JMS XA configured
No crash recovery test
No runbook
No monitoring prepared branches
```

This is fragile.

### 36.4 Catch-and-Continue Inside Transaction

```text
catch persistence exception
log warning
continue
```

Risk:

- transaction already rollback-only.

### 36.5 Increasing Timeout as First Response

Timeout is often symptom.

Before increasing:

- check lock,
- query latency,
- pool pressure,
- external call,
- transaction size,
- thread dump.

---

## 37. Production Checklist

### 37.1 Design Checklist

- [ ] Transaction boundary is explicit.
- [ ] Transaction does not wrap slow external call unless intentionally justified.
- [ ] Local vs global transaction decision documented.
- [ ] XA used only when required.
- [ ] Outbox/saga considered for distributed workflow.
- [ ] Idempotency strategy exists for retries/redelivery.
- [ ] Timeout layering reviewed.
- [ ] Locking behavior understood.
- [ ] Rollback-only behavior understood.
- [ ] Audit side effects intentionally transactional or non-transactional.

### 37.2 Configuration Checklist

- [ ] Transaction timeout configured intentionally.
- [ ] JDBC query timeout aligned.
- [ ] DB lock wait timeout understood.
- [ ] JDBC pool max size aligned with transaction concurrency.
- [ ] XA datasource only where needed.
- [ ] Transaction log store durable.
- [ ] Recovery credentials available.
- [ ] Cluster/container identity stable if XA recovery required.

### 37.3 Observability Checklist

- [ ] Transaction timeout count visible.
- [ ] Rollback count visible.
- [ ] JDBC pool wait count visible.
- [ ] DB lock wait/deadlock visible.
- [ ] JMS redelivery visible.
- [ ] Outbox backlog visible if using outbox.
- [ ] Correlation ID links request, DB, JMS, and logs.

### 37.4 Operations Checklist

- [ ] Graceful shutdown procedure exists.
- [ ] Crash recovery tested.
- [ ] In-doubt transaction procedure exists.
- [ ] Manual recovery is auditable.
- [ ] Driver/server upgrade avoids pending in-doubt transactions.
- [ ] DBA and app team share recovery vocabulary.

---

## 38. Incident Playbook: Transaction Timeout in Production

### Situation

Users report checkout endpoint timing out.

### Symptoms

```text
HTTP 504 from proxy
GlassFish transaction timeout logs
JDBC pool active near max
DB active sessions waiting on row lock
Repeated user retries
```

### Reasoning

Do not immediately increase transaction timeout.

Ask:

```text
Where is the wait?
Which resource is held?
Which lock is blocking?
Which transaction started first?
Are external calls inside transaction?
Are retries multiplying load?
```

### Action Flow

```text
1. Temporarily reduce incoming pressure if needed.
2. Identify blocking DB session.
3. Capture thread dump and DB lock graph.
4. Correlate transaction/request id.
5. Decide whether to kill blocker or let it finish.
6. Stop retry storm if possible.
7. After stabilization, redesign transaction boundary.
```

### Postmortem Questions

- Why did transaction live that long?
- Why was lock held during wait?
- Why did timeout layering allow 504 before backend finished?
- Why did retry amplify the incident?
- What metric would have caught it earlier?

---

## 39. Incident Playbook: XA In-Doubt Transaction

### Situation

After server crash, database shows prepared XA transaction.

### Symptoms

```text
GlassFish recovery warning
DB prepared/in-doubt branch
Some rows locked
JMS state uncertain
Application errors on affected records
```

### Reasoning

Do not blindly force commit/rollback.

Need to know global outcome.

### Action Flow

```text
1. Preserve logs.
2. Identify XID/transaction branch.
3. Check GlassFish transaction log.
4. Check resource managers involved.
5. Restart recovery path if safe.
6. If automatic recovery fails, determine intended outcome from TM log.
7. Coordinate with DBA/broker admin.
8. Execute official recovery action.
9. Reconcile business data.
10. Document action.
```

### Prevention

- Persistent transaction log.
- Tested recovery scenario.
- Stable server identity.
- XA resource monitoring.
- Maintenance drain procedure.

---

## 40. GlassFish-Specific Operational Commands

Exact attributes can vary by GlassFish version, but the pattern is:

### Inspect Transaction Service

```bash
asadmin get "*.transaction-service.*"
```

or narrower:

```bash
asadmin get "server-config.transaction-service.*"
```

### Set Global Transaction Timeout

```bash
asadmin set server-config.transaction-service.timeout-in-seconds=120
```

### Inspect JDBC Pool Transaction-Related Settings

```bash
asadmin get "resources.jdbc-connection-pool.<pool-name>.*"
```

### Create XA JDBC Pool Conceptual Pattern

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname <XADataSourceClass> \
  --restype javax.sql.XADataSource \
  --property user=<user>:password=<password>:serverName=<host>:databaseName=<db> \
  appXaPool
```

For Jakarta-era versions and specific drivers, verify the exact datasource class and property names from the driver vendor.

### Create JDBC Resource

```bash
asadmin create-jdbc-resource \
  --connectionpoolid appXaPool \
  jdbc/appXa
```

### Important

Never copy command blindly across:

- GlassFish major versions,
- Java EE vs Jakarta EE namespace,
- database vendor,
- JDBC driver version,
- XA vs non-XA datasource.

Always verify with:

```bash
asadmin get
asadmin list
asadmin ping-connection-pool
server.log
DB-side session/transaction views
```

---

## 41. Java 8 sampai Java 25 Considerations

### 41.1 Java 8 Era

Common reality:

- Java EE 7/8 applications.
- `javax.transaction.*`.
- Older GlassFish 4/5 deployments.
- Older JDBC drivers.
- Older XA driver behavior.
- Less containerized deployment.

Risk:

- legacy driver bugs,
- old TLS/security constraints,
- old GC behavior,
- classpath conflicts.

### 41.2 Java 11/17 Era

Common reality:

- More modular JDK pressure.
- Removed Java EE modules from JDK after Java 8.
- Need explicit JAXB/JAX-WS dependencies if app relies on them.
- Jakarta migration begins.

Transaction-specific impact:

- driver compatibility must be revalidated,
- reflection/module behavior may affect frameworks,
- timeout/performance characteristics can shift.

### 41.3 Java 21/25 Era

Common reality:

- Modern GlassFish 8 line requires Java 21+.
- Jakarta EE 11 uses modern API baseline.
- Virtual threads exist in Java platform, but Jakarta EE transaction semantics remain container-managed.

Transaction-specific caution:

- Do not assume virtual threads make long transaction safe.
- Long lock remains long lock.
- Long DB connection checkout remains pool pressure.
- Long XA recovery window remains recovery complexity.

Virtual threads may improve thread scalability, but they do not eliminate:

- database contention,
- transaction timeout,
- XA coordination cost,
- external side effect ambiguity.

---

## 42. Top 1% Mental Models

### 42.1 Transaction Is a Consistency Contract

Not every method needs transaction.

Not every workflow should be one transaction.

Correct question:

> “What consistency contract does this boundary provide, and what cost does it impose?”

### 42.2 Transaction Holds Resources

Every open transaction may hold:

- connection,
- lock,
- memory,
- thread dependency,
- recovery metadata.

### 42.3 Rollback Cannot Undo the Outside World

Database rollback cannot undo:

- email sent,
- HTTP API call,
- payment captured,
- file uploaded,
- message published outside transaction,
- cache mutation outside transaction.

### 42.4 XA Gives Atomicity but Demands Recovery Maturity

XA is not “set and forget”.

It requires:

- correct drivers,
- durable logs,
- stable identity,
- recovery testing,
- operational playbook.

### 42.5 Timeout Is a Design Signal

Timeout means some boundary exceeded its budget.

Do not treat it only as a number to increase.

Ask:

```text
Which resource was waited on?
Which queue grew?
Which lock was held?
Which external dependency was inside transaction?
Which retry policy amplified it?
```

### 42.6 Commit Failure Is Often Not the First Failure

Always search backward in logs.

The first exception usually matters more than the final rollback exception.

---

## 43. Summary

Part 13 membahas GlassFish Transaction Service sebagai runtime coordinator untuk local/global transaction, JTA/Jakarta Transactions, resource enlistment, XA, 2PC, timeout, rollback-only, recovery, dan failure semantics.

Inti pemahaman:

- Transaction adalah boundary konsistensi, bukan sekadar block kode.
- Local transaction jauh lebih sederhana daripada global transaction.
- XA memberi atomicity lintas resource, tetapi membawa recovery complexity.
- Transaction timeout harus disejajarkan dengan HTTP, query, DB lock, dan client timeout.
- Rollback-only state sering menjelaskan kenapa commit gagal setelah business method tampak sukses.
- External side effect tidak otomatis bisa di-rollback oleh transaction manager.
- Outbox dan saga sering lebih operable untuk distributed workflow modern.
- Long transaction bisa menghancurkan throughput melalui lock, pool, dan thread pressure.
- Recovery harus dipikirkan sebelum production, bukan saat incident.

---

## 44. Checklist Penguasaan

Kamu dianggap memahami bagian ini jika bisa menjawab:

1. Apa beda local transaction dan global transaction?
2. Kapan GlassFish transaction manager perlu 2PC?
3. Apa arti resource enlistment?
4. Apa bedanya XA datasource dan non-XA datasource?
5. Kenapa prepared transaction butuh recovery log?
6. Apa itu rollback-only state?
7. Kenapa commit bisa gagal walaupun method return normal?
8. Kenapa remote HTTP call di dalam DB transaction berbahaya?
9. Kapan outbox lebih baik daripada XA?
10. Apa urutan timeout yang sehat antara query, transaction, HTTP, proxy, dan client?
11. Bagaimana mendiagnosis transaction timeout?
12. Bagaimana mendiagnosis XA in-doubt transaction?
13. Kenapa container/Kubernetes memperumit XA recovery?
14. Kenapa virtual thread tidak otomatis membuat long transaction aman?
15. Apa checklist sebelum menaikkan transaction timeout?

---

## 45. Referensi

- Eclipse GlassFish Administration Guide — Administering Transactions  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish 5.1 Administration Guide — Administering Transactions  
  https://glassfish.org/docs/5.1.0/administration-guide/transactions.html

- Eclipse GlassFish Application Development Guide — Using the Transaction Service  
  https://glassfish.org/docs/5.1.0/application-development-guide/transaction-service.html

- Eclipse GlassFish Reference Manual  
  https://glassfish.org/docs/latest/reference-manual.html

- Jakarta Transactions Specification  
  https://jakarta.ee/specifications/transactions/

- Jakarta Transactions 2.0 Specification  
  https://jakarta.ee/specifications/transactions/2.0/

---

## 46. Status Series

Part 13 selesai.

Seri belum selesai.

Part berikutnya:

**Part 14 — JMS dan OpenMQ di GlassFish: Broker, Destination, MDB, Reliability**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-012.md">⬅️ Part 12 — JDBC Resources dan Connection Pool Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-014.md">Part 14 — JMS dan OpenMQ di GlassFish: Broker, Destination, MDB, Reliability ➡️</a>
</div>
