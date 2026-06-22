# learn-java-eclipse-glassfish-runtime-server-engineering-part-011

# Part 11 — Thread Pools, Executor Model, Blocking, Async, dan Virtual Threads

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Target: Java 8 sampai Java 25, dengan konteks Eclipse GlassFish 5.x, 6.x, 7.x, dan 8.x  
> Fokus: runtime concurrency engineering di GlassFish, bukan pengulangan teori Java concurrency umum.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas HTTP stack dan Grizzly runtime internals. Kita sudah melihat bahwa request tidak langsung “masuk ke method controller”. Request melewati network listener, protocol handler, transport, virtual server, web container, filter chain, security layer, transaction/resource boundary, lalu baru mencapai aplikasi.

Part ini melanjutkan pertanyaan yang lebih tajam:

> Setelah request diterima, **thread mana yang menjalankannya, siapa yang mengatur antreannya, apa yang terjadi ketika thread habis, dan bagaimana kita menyeimbangkan HTTP thread, executor, JDBC pool, JMS consumer, timer, dan virtual threads?**

Ini adalah salah satu area yang membedakan engineer biasa dan engineer senior/principal.

Engineer biasa melihat error:

```text
HTTP 504 Gateway Timeout
```

lalu berpikir:

```text
Mungkin timeout proxy terlalu kecil.
```

Engineer yang lebih matang bertanya:

```text
Di mana antreannya terbentuk?
Apakah request menunggu di load balancer, socket accept queue, HTTP worker queue, JDBC pool wait queue, DB lock wait, remote API call, JMS backlog, atau GC pause?
```

Part ini tidak akan mengulang detail `Thread`, `ExecutorService`, `CompletableFuture`, `synchronized`, `Lock`, atau reactive programming yang sudah dibahas pada seri Java concurrency. Di sini kita membahas concurrency sebagai **runtime capacity model** di GlassFish.

---

## 1. Mental Model Utama: Thread adalah Kapasitas Eksekusi yang Terbatas

Dalam application server, thread bukan sekadar objek Java. Thread adalah satuan kapasitas yang mengikat banyak resource lain:

- stack memory,
- CPU scheduling,
- request ownership,
- transaction context,
- security context,
- classloader context,
- JNDI context,
- MDC/logging context,
- connection/resource lifecycle,
- timeout behavior,
- dan failure propagation.

Jadi pertanyaan “berapa banyak thread pool size yang bagus?” tidak bisa dijawab dengan angka generik.

Pertanyaan yang benar:

```text
Berapa banyak pekerjaan konkuren yang boleh masuk ke boundary runtime ini sebelum sistem kehilangan latency, resource fairness, atau failure isolation?
```

Pada GlassFish, thread muncul di beberapa tempat:

1. HTTP/network listener worker threads.
2. ORB/IIOP threads untuk remote EJB / legacy RMI-IIOP.
3. EJB container pools dan invocation threads.
4. Managed executor service untuk Jakarta Concurrency.
5. Timer service threads.
6. JMS/OpenMQ broker dan consumer/MDB dispatch threads.
7. Connector/JCA work manager threads.
8. Background server maintenance threads.
9. Application-created threads, yang sebaiknya dihindari di Jakarta EE environment.
10. Java virtual threads pada runtime modern, terutama melalui Jakarta Concurrency 3.1 / Java 21+ semantics.

Top-level model:

```text
Incoming work
    ↓
Runtime boundary
    ↓
Queue
    ↓
Execution capacity: threads/executors
    ↓
Downstream capacity: DB / remote service / broker / disk / CPU
    ↓
Response or failure
```

Jika downstream lebih lambat daripada incoming work, antrean akan terbentuk di salah satu layer. Tugas engineer adalah menentukan **antrean mana yang paling aman** dan **antrean mana yang paling berbahaya**.

---

## 2. Thread Pool di GlassFish: Bukan Satu Pool untuk Semuanya

GlassFish mempertahankan satu atau lebih thread pool untuk menjalankan berbagai jenis pekerjaan. Secara konseptual, thread pool dapat digunakan oleh komponen seperti network listener, connector module, dan ORB.

Artinya, GlassFish bukan runtime dengan satu global thread pool tunggal. Ia punya beberapa concurrency surface.

Contoh surface penting:

```text
HTTP request path          → network listener / HTTP thread pool
Remote EJB/IIOP path       → ORB thread pool
JCA connector work         → connector work manager / thread pool
Jakarta Concurrency task   → managed executor service
EJB timer                  → timer service runtime
JMS/MDB                    → broker + container dispatch/concurrency
```

Implikasinya:

- HTTP thread pool besar tidak otomatis mempercepat DB.
- JDBC pool besar tidak otomatis mempercepat endpoint CPU-bound.
- Managed executor besar bisa memperparah overload jika downstream terbatas.
- Timer job berat bisa mengganggu runtime jika tidak dipisahkan atau dibatasi.
- JMS consumer concurrency terlalu tinggi bisa membuat DB lock contention meningkat.

Jadi tuning GlassFish harus dilakukan sebagai **multi-pool coordination**, bukan satu parameter tuning.

---

## 3. Thread Pool Default vs Custom Thread Pool

Pada GlassFish, biasanya ada thread pool default untuk HTTP request processing. Di banyak deployment, engineer tidak pernah menyentuh ini sampai terjadi masalah.

Namun GlassFish memungkinkan konfigurasi thread pool dan assignment ke listener tertentu.

Contoh konseptual:

```text
http-listener-1  → http-thread-pool
http-listener-2  → admin-thread-pool or custom pool
custom-listener  → api-heavy-thread-pool
```

Perlu dipahami:

- Listener adalah pintu masuk network.
- Thread pool adalah kapasitas eksekusi untuk pekerjaan yang diterima listener.
- Virtual server adalah routing logical host/context.
- Aplikasi berada di atas container, bukan langsung di thread pool.

Contoh mental model:

```text
Client
  ↓
Network listener :8080
  ↓
Protocol/transport
  ↓
Thread pool
  ↓
Web container
  ↓
Application endpoint
```

Jika thread pool listener habis, request baru bisa menunggu atau gagal sebelum aplikasi menerima request.

---

## 4. Parameter Thread Pool yang Harus Dipahami

Nama parameter bisa berbeda antar versi/command, tetapi modelnya umumnya sama.

### 4.1 Minimum / Steady Thread Pool Size

Ini jumlah thread yang dipertahankan saat steady state.

Mental model:

```text
Berapa thread yang selalu siap tanpa perlu dibuat baru?
```

Terlalu kecil:

- burst awal bisa kena overhead thread creation,
- latency awal meningkat.

Terlalu besar:

- memory stack terpakai lebih banyak,
- idle thread berlebihan,
- konteks runtime lebih berat.

### 4.2 Maximum Thread Pool Size

Ini batas atas thread yang dapat dibuat.

Mental model:

```text
Berapa banyak pekerjaan yang boleh dieksekusi bersamaan di boundary ini?
```

Terlalu kecil:

- throughput dibatasi,
- request antre,
- proxy timeout,
- user melihat latency tinggi.

Terlalu besar:

- CPU context switching naik,
- DB pool cepat habis,
- remote service diserang oleh concurrency berlebihan,
- memory stack naik,
- failure semakin menyebar.

### 4.3 Idle Thread Timeout

Ini waktu sebelum thread idle dapat dihentikan.

Mental model:

```text
Seberapa agresif runtime mengecilkan pool ketika beban turun?
```

### 4.4 Work Queue

Thread pool biasanya punya queue/antrean kerja.

Pertanyaan penting:

```text
Jika semua thread sibuk, apakah request ditolak, antre, atau timeout?
```

Queue panjang tidak selalu bagus. Queue panjang sering menyembunyikan overload sampai latency buruk.

### 4.5 Number of Work Queues

Pada beberapa thread pool/config, jumlah work queue juga relevan.

Mental model:

```text
Apakah work distribution bottleneck terjadi di satu queue atau dapat diparalelkan?
```

Namun jangan mulai tuning dari sini. Mulai dari latency, utilization, thread dump, dan downstream bottleneck.

---

## 5. Cara Melihat dan Mengubah Thread Pool dengan `asadmin`

Contoh pola inspeksi:

```bash
asadmin list '*thread*'
```

Atau inspeksi config spesifik:

```bash
asadmin get 'server.thread-pools.*'
```

Contoh update parameter:

```bash
asadmin set server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=200
```

Contoh membuat thread pool baru secara konseptual:

```bash
asadmin create-threadpool \
  --maxthreadpoolsize 100 \
  --minthreadpoolsize 10 \
  --idletimeout 120 \
  api-thread-pool
```

Contoh mengasosiasikan listener ke thread pool tertentu bergantung command/config listener:

```bash
asadmin set configs.config.server-config.network-config.network-listeners.network-listener.http-listener-1.thread-pool=api-thread-pool
```

Catatan penting:

- Nama path config bisa berbeda tergantung versi dan domain config.
- Gunakan `asadmin get` untuk melihat struktur aktual sebelum menulis script.
- Jangan mengubah production tanpa snapshot config.
- Jangan menjadikan angka contoh sebagai angka final.

Pattern aman:

```bash
# 1. capture current config
asadmin get 'server.thread-pools.*' > before-thread-pools.txt

# 2. apply one controlled change
asadmin set server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=200

# 3. capture after config
asadmin get 'server.thread-pools.*' > after-thread-pools.txt

# 4. monitor metrics and thread dumps under load
```

---

## 6. Request Execution Model: Dari HTTP Thread ke Downstream Resource

Untuk memahami thread starvation, kita perlu melihat request sebagai pipeline.

Contoh endpoint sinkron klasik:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    public Response getCase(@PathParam("id") long id) {
        Case c = caseService.loadCase(id);      // DB call
        Audit a = auditClient.fetchAudit(id);   // remote HTTP call
        return Response.ok(toDto(c, a)).build();
    }
}
```

Jalur runtime:

```text
HTTP worker thread acquired
  ↓
security/context setup
  ↓
JAX-RS/Servlet dispatch
  ↓
DB connection acquired from JDBC pool
  ↓
SQL executed
  ↓
remote HTTP call
  ↓
response serialization
  ↓
HTTP worker thread released
```

Thread HTTP tetap “terikat” selama semua operasi blocking berjalan.

Jika DB lambat 5 detik dan ada 200 request konkuren:

```text
200 HTTP worker threads can be occupied waiting on DB or remote IO
```

Masalahnya bukan CPU. Masalahnya adalah **thread occupancy**.

---

## 7. Blocking Workload Taxonomy

Tidak semua blocking sama. Ini taxonomy penting.

### 7.1 DB Blocking

Contoh:

- JDBC query lambat,
- lock wait,
- connection pool wait,
- transaction timeout,
- network latency ke DB,
- DB CPU tinggi,
- disk IO DB lambat.

Thread dump sering terlihat seperti:

```text
java.net.SocketInputStream.socketRead0
oracle.jdbc.driver.T4CPreparedStatement.executeForDescribe
org.postgresql.core.VisibleBufferedInputStream.readMore
```

Artinya thread Java tidak sedang menghitung. Ia menunggu DB.

### 7.2 Remote HTTP Blocking

Contoh:

- call service eksternal,
- DNS lambat,
- TLS handshake lambat,
- remote service timeout,
- connection pool HTTP client habis.

Thread dump bisa menunjukkan:

```text
sun.nio.ch.SocketDispatcher.read0
javax.net.ssl.SSLSocketInputRecord.read
okhttp3.internal.connection.RealCall
```

### 7.3 File IO Blocking

Contoh:

- upload/download file besar,
- generate report ke disk,
- read attachment,
- write audit file,
- shared network filesystem.

### 7.4 JMS/Broker Blocking

Contoh:

- broker unavailable,
- publish sync wait,
- transaction commit melibatkan JMS,
- consumer backlog.

### 7.5 CPU-bound Work

Contoh:

- PDF generation,
- encryption/compression,
- large JSON/XML transformation,
- rule engine,
- report aggregation,
- image processing.

CPU-bound berbeda. Menambah thread terlalu banyak justru bisa memperburuk throughput.

### 7.6 Lock/Monitor Blocking

Contoh:

- synchronized cache global,
- singleton bottleneck,
- static map lock,
- sequence generator lock,
- logging appender lock,
- connection pool internal lock.

Thread dump menunjukkan `BLOCKED` atau waiting on monitor.

---

## 8. The Most Important Question: Di Mana Queue Terbentuk?

Setiap sistem overloaded akan membentuk queue. Yang berbahaya adalah ketika queue muncul di tempat yang tidak terlihat.

Layer queue yang umum:

```text
Client retry queue
Load balancer pending queue
OS socket backlog
GlassFish HTTP listener queue
HTTP thread pool work queue
Application executor queue
JDBC connection pool wait queue
DB lock wait queue
Remote service queue
JMS broker queue
GC/safepoint pause accumulation
```

Top 1% engineer tidak hanya bertanya “thread pool kurang?” tetapi:

```text
Queue mana yang boleh panjang?
Queue mana yang harus pendek?
Queue mana yang harus fail-fast?
Queue mana yang harus punya backpressure?
```

Contoh:

- Queue di HTTP worker pool panjang → user latency buruk.
- Queue di DB connection pool panjang → thread HTTP tertahan.
- Queue di JMS broker bisa diterima jika workload async dan SLA-nya eventual.
- Queue di memory tanpa limit → OOM.
- Queue di client retry tanpa jitter → retry storm.

---

## 9. Thread Starvation: Gejala, Penyebab, dan Diagnosis

Thread starvation terjadi ketika pekerjaan baru tidak mendapat thread untuk berjalan dalam waktu wajar.

Gejala:

- latency naik tajam,
- request timeout,
- proxy 504,
- admin console lambat,
- CPU tidak selalu tinggi,
- DB mungkin terlihat normal atau justru overload,
- thread dump menunjukkan banyak thread waiting pada resource yang sama.

Penyebab umum:

1. DB query lambat membuat HTTP thread tertahan.
2. Remote API timeout terlalu panjang.
3. JDBC pool kecil dan wait timeout besar.
4. Thread pool terlalu kecil untuk workload blocking.
5. Thread pool terlalu besar lalu downstream collapse.
6. Deadlock atau lock contention.
7. Synchronous logging lambat.
8. Async task memakai executor yang sama dengan request path.
9. Timer job berat berjalan di runtime yang sama.
10. JMS consumer concurrency terlalu tinggi.

Diagnosis minimal:

```bash
# Ambil beberapa thread dump, bukan satu saja
jcmd <pid> Thread.print > tdump-1.txt
sleep 10
jcmd <pid> Thread.print > tdump-2.txt
sleep 10
jcmd <pid> Thread.print > tdump-3.txt
```

Yang dicari:

- banyak thread pada stack trace yang sama,
- banyak thread waiting DB socket,
- banyak thread menunggu connection pool,
- banyak thread blocked pada monitor yang sama,
- thread runnable CPU-heavy,
- deadlock section,
- GC threads/safepoint hints,
- executor worker semua busy.

---

## 10. HTTP Thread Pool Sizing: Jangan Mulai dari Angka, Mulai dari Model

### 10.1 Formula Konseptual

Untuk workload blocking, concurrency minimal yang dibutuhkan dapat diperkirakan dengan Little’s Law:

```text
Concurrency ≈ Throughput × Latency
```

Jika target:

```text
100 requests/second
average service time 200 ms
```

Maka kebutuhan concurrent execution kira-kira:

```text
100 × 0.2 = 20 concurrent requests
```

Tetapi jika DB lambat menjadi 2 detik:

```text
100 × 2 = 200 concurrent requests
```

Artinya thread pool yang cukup pada kondisi normal bisa habis saat downstream melambat.

### 10.2 Jangan Samakan Thread Pool dengan Throughput

Thread pool besar tidak menciptakan throughput jika bottleneck adalah DB.

Misalnya:

```text
HTTP max threads: 500
JDBC max pool: 50
DB mampu efektif: 50 concurrent queries
```

Maka 450 thread lain bisa berakhir menunggu connection atau menunggu downstream.

Ini bukan scaling. Ini memindahkan antrean dari listener ke aplikasi.

### 10.3 Rule of Thumb yang Lebih Aman

Untuk endpoint synchronous/blocking:

```text
HTTP max threads should be high enough to absorb normal concurrency,
but not so high that it overwhelms DB, remote services, heap, or CPU.
```

Untuk CPU-bound endpoint:

```text
Concurrent CPU-heavy work should be close to available CPU cores,
not hundreds of threads.
```

Untuk mixed workload:

```text
Separate by endpoint, listener, executor, queue, or workload architecture.
```

---

## 11. Coordination dengan JDBC Pool

JDBC pool adalah boundary paling sering menyebabkan starvation.

Misal:

```text
HTTP max threads = 200
JDBC max pool    = 30
```

Jika semua request butuh DB connection:

```text
30 request execute SQL
170 request wait for DB connection
```

Apakah ini buruk? Tergantung.

Bisa baik jika:

- DB hanya sanggup 30 concurrent sessions,
- wait timeout pendek,
- request cepat gagal saat overload,
- caller punya retry/backoff.

Bisa buruk jika:

- wait timeout 60 detik,
- HTTP thread tertahan lama,
- load balancer timeout 30 detik,
- user retry berkali-kali,
- thread pool habis.

Model yang lebih baik:

```text
HTTP thread budget > JDBC pool budget,
but wait timeout must be aligned with request timeout,
and overload must fail predictably.
```

Contoh alignment:

```text
ALB/proxy timeout        : 30s
GlassFish request path   : should finish < 25s
JDBC pool wait timeout   : 2s - 5s for interactive endpoint
DB query timeout         : endpoint-specific, e.g. 5s - 15s
Remote HTTP timeout      : explicit connect/read timeout
```

Jangan biarkan JDBC wait timeout lebih panjang daripada upstream timeout. Jika upstream sudah menyerah, server masih membakar thread untuk request yang hasilnya tidak berguna.

---

## 12. Coordination dengan Remote HTTP Client

Remote HTTP call sering menjadi silent killer.

Contoh buruk:

```java
String result = httpClient.get("https://external/api"); // no timeout
```

Masalah:

- thread HTTP GlassFish tertahan,
- remote service lambat,
- client retry,
- semua thread habis,
- health check ikut gagal,
- load balancer menganggap server down.

Setiap remote HTTP call harus punya:

- connect timeout,
- read timeout,
- overall deadline,
- connection pool limit,
- retry dengan backoff dan jitter,
- circuit breaker jika diperlukan,
- fallback jika business process mengizinkan.

Mental model:

```text
A remote service call is a borrowed failure domain.
```

Jika endpoint GlassFish memanggil 3 service eksternal secara serial, latency endpoint adalah penjumlahan latency dan failure risk.

Lebih baik:

- parallelize jika independent,
- cache jika data read-mostly,
- async/outbox jika tidak harus realtime,
- isolate executor jika workload lambat,
- batasi concurrency ke remote service.

---

## 13. Managed Executor Service: Cara Benar Membuat Async Task di Jakarta EE

Di Jakarta EE, aplikasi sebaiknya tidak membuat thread mentah secara bebas:

```java
new Thread(() -> doWork()).start(); // anti-pattern di managed runtime
```

Kenapa?

Karena container tidak bisa mengelola:

- lifecycle,
- shutdown,
- context propagation,
- classloader,
- security context,
- naming context,
- transaction boundary,
- resource cleanup,
- metrics.

Gunakan managed concurrency facility.

Contoh konseptual:

```java
@Resource
ManagedExecutorService executor;

public void submitWork() {
    executor.submit(() -> {
        // managed task
        process();
    });
}
```

Atau pada Jakarta EE modern, beberapa concurrency resources dapat lebih nyaman diinject sesuai dukungan spesifikasi/runtime.

Prinsip:

```text
If work runs inside an application server, let the server own the execution context.
```

---

## 14. Async Tidak Sama dengan Lebih Cepat

Async sering disalahpahami.

Async bisa membantu jika:

- request tidak perlu menunggu hasil,
- pekerjaan bisa diproses di background,
- caller dapat menerima eventual consistency,
- kita ingin membebaskan HTTP thread lebih cepat,
- kita punya executor/backpressure yang benar.

Async bisa memperburuk jika:

- task tetap blocking dan executor tidak dibatasi,
- queue unbounded,
- error tidak dimonitor,
- task kehilangan security/transaction context,
- DB tetap bottleneck,
- caller tetap menunggu hasil future.

Contoh anti-pattern:

```java
Future<Result> f = executor.submit(() -> slowDbCall());
return f.get(); // HTTP thread tetap menunggu
```

Ini hanya memindahkan kerja ke executor lain tetapi HTTP thread tetap blocking. Bahkan sekarang dua resource dipakai: HTTP thread + executor thread.

Pattern yang lebih jelas:

1. Synchronous endpoint untuk response cepat.
2. Async command submission untuk proses lama.
3. Job ID dikembalikan ke client.
4. Worker memproses dengan concurrency terbatas.
5. Status endpoint untuk polling/callback.

---

## 15. Timer Service Threads

EJB Timer atau scheduled workload tampak sederhana, tetapi secara operasional bisa berbahaya.

Contoh timer:

```java
@Schedule(hour = "*", minute = "*/5", persistent = false)
public void syncData() {
    // call remote system, update DB
}
```

Risiko:

- timer berjalan saat traffic tinggi,
- timer mengambil JDBC connection banyak,
- timer lambat lalu overlap,
- retry manual membuat duplicate work,
- cluster menjalankan timer lebih dari satu instance jika tidak dikontrol,
- timer failure tidak terlihat oleh user tetapi merusak data freshness.

Prinsip:

```text
Scheduled work is production traffic, even if no user clicks anything.
```

Timer harus punya:

- concurrency guard,
- timeout,
- idempotency key,
- logging correlation,
- metrics duration/error,
- retry policy,
- lock/distribution strategy jika cluster,
- resource budget terpisah bila berat.

---

## 16. JMS/MDB Consumer Threads dan Backpressure

Message-driven workload berbeda dari HTTP request.

HTTP:

```text
User waits for response.
```

JMS:

```text
Message can wait in broker queue.
```

Ini memberi kita tempat antre yang lebih sehat, tetapi bukan tanpa risiko.

MDB concurrency terlalu rendah:

- backlog naik,
- message latency tinggi,
- SLA async tidak tercapai.

MDB concurrency terlalu tinggi:

- DB overload,
- lock contention,
- duplicate processing saat rollback,
- downstream service overload,
- broker redelivery storm.

Prinsip:

```text
Consumer concurrency must be sized against the slowest committed side effect.
```

Jika message processing melakukan:

```text
read message → update DB → call external API → commit transaction
```

Maka concurrency harus memperhitungkan:

- DB connections,
- DB row locks,
- external API rate limit,
- transaction timeout,
- broker redelivery behavior.

---

## 17. Connector/JCA Work Manager

JCA resource adapter dapat memiliki inbound/outbound work yang dijalankan oleh container-managed work manager.

Contoh:

- adapter untuk messaging system,
- adapter untuk ERP/mainframe,
- adapter untuk custom protocol,
- inbound event delivery.

Work manager penting karena connector tidak boleh membuat thread sembarangan tanpa koordinasi container.

Risiko:

- adapter flooding runtime,
- thread starvation dari inbound messages,
- transaction enlistment lambat,
- resource adapter deadlock,
- shutdown tidak graceful.

Prinsip:

```text
JCA concurrency is integration concurrency. Treat it as a separate workload class.
```

---

## 18. Application-Created Threads: Kenapa Berbahaya

Aplikasi enterprise kadang melakukan:

```java
ExecutorService pool = Executors.newFixedThreadPool(100);
```

Atau:

```java
CompletableFuture.supplyAsync(() -> work()); // default ForkJoinPool
```

Di managed runtime, ini berisiko.

Masalah:

1. Container tidak tahu lifecycle thread tersebut.
2. Shutdown domain bisa menggantung.
3. Classloader leak setelah redeploy.
4. Security/JNDI context tidak otomatis benar.
5. Transaction context tidak valid.
6. Metrics tidak terlihat di GlassFish.
7. Thread count di luar capacity plan.
8. Default ForkJoinPool bisa dipakai oleh library lain.

Lebih aman:

- gunakan `ManagedExecutorService`,
- gunakan JMS untuk async durable work,
- gunakan external worker service,
- gunakan batch runtime jika cocok,
- gunakan managed scheduled executor jika tersedia,
- batasi queue dan concurrency.

---

## 19. Virtual Threads: Apa yang Berubah di Java 21+

Java 21 memperkenalkan virtual threads sebagai fitur final. Virtual thread adalah thread ringan yang dikelola JVM, bukan platform thread OS biasa.

Keunggulan utama:

```text
Virtual threads make blocking-style code scale better when the workload is mostly IO-bound.
```

Dengan virtual threads, kita bisa memiliki banyak task blocking tanpa satu task selalu mengikat satu OS thread selama ia park/wait pada IO yang mendukung unmounting.

Namun virtual threads bukan magic.

Virtual threads tidak memperbesar:

- kapasitas DB,
- kapasitas remote service,
- CPU core,
- transaction throughput,
- row lock throughput,
- broker throughput,
- network bandwidth,
- memory tanpa batas.

Virtual threads mengurangi biaya thread occupancy, bukan menghapus downstream bottleneck.

---

## 20. Virtual Threads dalam Konteks Jakarta EE / GlassFish

Jakarta EE 11 dan Jakarta Concurrency 3.1 mulai membawa virtual thread ke model concurrency enterprise modern. Karena GlassFish 8 berada pada garis Jakarta EE 11, topik virtual threads relevan untuk aplikasi modern berbasis Java 21+.

Namun ada pemisahan penting:

```text
Java supports virtual threads ≠ every server subsystem automatically uses virtual threads everywhere.
```

Pertanyaan yang harus diajukan:

1. Apakah HTTP request dispatch menggunakan platform thread atau virtual thread?
2. Apakah ManagedExecutorService dapat dikonfigurasi memakai virtual thread?
3. Apakah transaction/security/naming context propagated dengan benar?
4. Apakah library JDBC/HTTP yang digunakan compatible dengan virtual thread behavior?
5. Apakah ada synchronized/blocking region yang menyebabkan pinning?
6. Apakah observability bisa membedakan platform vs virtual threads?

Jangan mengasumsikan:

```text
Upgrade ke Java 21 → semua endpoint otomatis scale 10x.
```

Yang benar:

```text
Java 21 gives runtime a new concurrency primitive.
Application server support and workload design determine actual benefit.
```

---

## 21. Kapan Virtual Threads Membantu

Virtual threads paling membantu untuk workload:

- banyak request concurrent,
- sebagian besar waktu menunggu IO,
- kode sinkron sederhana,
- tidak CPU-bound,
- tidak bergantung pada monitor lock panjang,
- downstream diberi concurrency limit,
- timeout jelas,
- queue bounded.

Contoh workload cocok:

```text
HTTP request → DB query ringan → remote API → return
```

Jika remote API kadang butuh 500ms tetapi CPU hanya 5ms, virtual thread bisa mengurangi kebutuhan platform thread.

Namun tetap perlu limit:

```text
Virtual threads allow many callers to wait cheaply,
but they do not allow unlimited calls to the same database.
```

---

## 22. Kapan Virtual Threads Tidak Membantu

Virtual threads tidak banyak membantu untuk:

### 22.1 CPU-bound Work

Contoh:

- compression,
- encryption,
- report rendering,
- large JSON transformation,
- image processing,
- rules engine CPU-heavy.

Jika CPU bottleneck, virtual thread hanya menambah jumlah task yang ingin memakai CPU yang sama.

### 22.2 DB Bottleneck yang Sudah Saturated

Jika DB hanya mampu 50 query concurrent dengan latency stabil, menjalankan 5.000 virtual threads tidak membuat DB lebih cepat.

### 22.3 Long Synchronized Blocks

Jika banyak virtual threads masuk ke synchronized critical section, mereka tetap antre.

### 22.4 Pinning

Beberapa blocking operation atau synchronized/native boundary dapat membuat virtual thread tetap mengikat carrier platform thread. Ini mengurangi manfaat virtual thread.

### 22.5 Unbounded Fan-out

Virtual thread membuat fan-out mudah, tapi fan-out tanpa budget adalah cara cepat menghancurkan downstream.

Contoh buruk:

```java
for (Customer c : customers) {
    executor.submit(() -> callRemoteService(c));
}
```

Jika `customers` berisi 50.000 item, virtual threads membuat submission terasa murah, tapi remote service bisa collapse.

---

## 23. Carrier Threads dan Pinning: Model Praktis

Virtual thread dijalankan di atas carrier platform thread. Saat virtual thread blocking pada operasi yang dapat dipark/unmount, carrier bisa menjalankan virtual thread lain.

Mental model:

```text
Virtual thread = logical execution
Carrier thread = actual OS-backed execution slot
```

Jika virtual thread pinned, carrier tidak bisa dilepas.

Penyebab umum pinning:

- blocking di dalam `synchronized`,
- native call tertentu,
- legacy blocking region,
- library yang belum friendly terhadap virtual thread.

Praktik diagnosis:

- aktifkan JDK diagnostic untuk pinning saat testing,
- gunakan JFR event terkait virtual thread,
- jangan langsung deploy virtual-thread-heavy workload tanpa load test.

Guideline:

```text
Virtual threads reward simple blocking code,
but punish hidden global locks and unbounded downstream access.
```

---

## 24. Virtual Threads dan JDBC

JDBC tetap API blocking. Virtual threads dapat membuat blocking JDBC lebih murah dari sisi thread occupancy, tetapi tidak mengubah fakta:

- connection tetap resource terbatas,
- DB session tetap resource nyata,
- transaction lock tetap nyata,
- SQL lambat tetap lambat,
- connection pool tetap wajib.

Dengan virtual threads, risiko baru:

```text
Terlalu banyak virtual threads bisa menunggu connection pool,
sehingga latency distribution buruk jika wait timeout tidak dikontrol.
```

Pattern aman:

```text
Virtual thread count may be high,
but DB concurrency must still be limited by JDBC pool size and timeout.
```

Untuk endpoint interactive:

- connection acquisition timeout pendek,
- query timeout jelas,
- transaction timeout jelas,
- response timeout selaras dengan proxy,
- overload fail-fast.

---

## 25. Virtual Threads dan Remote HTTP

Remote HTTP workload cocok untuk virtual threads, tetapi hanya jika:

- client library bekerja baik dengan virtual threads,
- timeout eksplisit,
- connection pool limit ada,
- rate limit downstream dihormati,
- retry tidak agresif,
- fan-out dibatasi.

Contoh pattern:

```text
For each incoming request:
  call 3 independent services concurrently
  combine result
  return within deadline
```

Virtual threads dapat menyederhanakan concurrency tanpa callback hell. Tapi tetap butuh deadline:

```text
No subcall should outlive the request budget.
```

---

## 26. Virtual Threads dan Context Propagation

Di application server, “thread” membawa banyak context:

- classloader context,
- security principal,
- naming/JNDI context,
- transaction context,
- CDI context,
- logging MDC,
- request context.

Jika aplikasi membuat virtual thread sendiri secara mentah:

```java
Thread.startVirtualThread(() -> doWork());
```

maka pertanyaannya:

```text
Context mana yang ikut? Context mana yang hilang? Siapa yang shutdown? Siapa yang monitor?
```

Di managed runtime, lebih aman memakai container-provided managed executor/concurrency resource yang memang didesain untuk context propagation.

Prinsip:

```text
Virtual thread should still be managed when running inside managed runtime.
```

---

## 27. Workload Segmentation: Jangan Semua Masuk Pool yang Sama

Aplikasi enterprise biasanya punya beberapa workload class:

1. Interactive API cepat.
2. Interactive API berat.
3. Admin/reporting.
4. Batch/timer.
5. JMS async consumer.
6. Integration callback.
7. File upload/download.
8. CPU-heavy document generation.

Jika semua memakai kapasitas yang sama, satu workload bisa menjatuhkan lainnya.

Contoh masalah:

```text
Report endpoint lambat memakai semua HTTP threads.
Health check ikut timeout.
Load balancer keluarkan instance dari rotation.
Traffic berpindah ke node lain.
Node lain ikut collapse.
```

Segmentation pattern:

- pisahkan endpoint berat ke listener/pool berbeda jika cocok,
- pisahkan aplikasi/module berat ke instance/domain berbeda,
- pindahkan batch ke worker instance,
- gunakan JMS untuk decoupling,
- gunakan rate limit di reverse proxy/API gateway,
- gunakan DB pool terpisah untuk workload reporting jika perlu,
- gunakan circuit breaker untuk remote integration.

---

## 28. Concurrency Budget: Cara Berpikir Principal Engineer

Jangan mulai dari:

```text
max-thread-pool-size = 500
```

Mulai dari budget:

```text
CPU cores: 8
HTTP target RPS: 200
p95 endpoint latency target: 300ms
DB max safe active sessions for app: 80
Remote API rate limit: 300/min
JMS consumer max DB-safe concurrency: 20
Report generation CPU concurrency: 4
```

Lalu turunkan konfigurasi:

```text
HTTP threads: enough for normal blocking concurrency but bounded
JDBC pool: <= DB safe session budget
Remote client concurrency: <= API rate limit / latency model
JMS concurrency: <= DB and downstream safe budget
Report executor: close to CPU core budget
Timeouts: aligned so work dies before upstream gives up
Queues: bounded and observable
```

Contoh simple model:

```text
DB safe sessions for this app: 80
Reserve for admin/manual ops: 10
Reserve for batch: 20
Interactive budget: 50
```

Maka:

```text
interactive JDBC pool max ≈ 50
batch JDBC pool max ≈ 20
admin/report pool max ≈ 10
```

HTTP threads boleh lebih besar dari 50, tapi connection wait timeout harus pendek.

---

## 29. Timeout Alignment Matrix

Timeout harus berurutan dari luar ke dalam.

Contoh buruk:

```text
Load balancer timeout     = 30s
GlassFish processing      = no deadline
JDBC pool wait timeout    = 60s
Remote HTTP read timeout  = 120s
DB query timeout          = none
Transaction timeout       = 300s
```

Akibat:

- client/proxy sudah timeout,
- server masih bekerja,
- thread tetap tertahan,
- DB tetap memproses,
- retry menciptakan duplikasi beban.

Contoh lebih sehat untuk interactive endpoint:

```text
Load balancer timeout     = 30s
Application deadline      = 25s
Remote HTTP read timeout  = 3s - 10s per call
JDBC pool wait timeout    = 2s - 5s
DB query timeout          = 5s - 15s sesuai endpoint
Transaction timeout       = 20s - 25s
```

Prinsip:

```text
No internal wait should exceed the useful lifetime of the request.
```

---

## 30. Thread Dump Reading for GlassFish Workloads

### 30.1 Thread States

`RUNNABLE`:

- bisa benar-benar memakai CPU,
- bisa juga sedang native socket read tergantung stack.

`WAITING`:

- menunggu monitor/condition/future.

`TIMED_WAITING`:

- sleep,
- timed poll,
- socket timeout wait,
- scheduled wait.

`BLOCKED`:

- menunggu monitor lock.

### 30.2 Pattern: DB Wait

```text
"http-thread-pool::http-listener-1(42)" ... RUNNABLE
  at java.net.SocketInputStream.socketRead0(Native Method)
  at oracle.jdbc.driver.T4CMAREngineNIO.prepareForUnmarshall(...)
  at oracle.jdbc.driver.T4CPreparedStatement.executeForRows(...)
```

Interpretasi:

```text
HTTP thread sedang menunggu DB response.
```

### 30.3 Pattern: Pool Wait

```text
at com.sun.enterprise.resource.pool.ConnectionPool.getResource(...)
at com.sun.enterprise.connectors.ConnectionManagerImpl.getResource(...)
```

Interpretasi:

```text
Thread menunggu connection dari pool atau pool sedang contention.
```

### 30.4 Pattern: Remote HTTP Wait

```text
at sun.nio.ch.SocketDispatcher.read0(Native Method)
at okhttp3.internal.http1.Http1ExchangeCodec.readResponseHeaders(...)
```

Interpretasi:

```text
Thread menunggu service eksternal.
```

### 30.5 Pattern: Lock Contention

```text
"http-thread-pool::http-listener-1(77)" BLOCKED
  waiting to lock <0x000000070abc1234>
  at com.company.Cache.get(Cache.java:42)
```

Interpretasi:

```text
Aplikasi punya critical section yang membatasi concurrency.
```

### 30.6 Pattern: Executor Saturation

```text
at java.util.concurrent.ThreadPoolExecutor.getTask(...)
```

Jika banyak worker idle, executor bukan bottleneck.  
Jika queue panjang tapi worker semua sibuk di stack lambat, executor saturated.

---

## 31. Metrics yang Perlu Dipantau

Minimal runtime metrics:

### 31.1 HTTP

- request count,
- response time p50/p95/p99,
- active requests,
- error rate,
- status code distribution,
- access log latency.

### 31.2 Thread Pool

- current thread count,
- busy thread count,
- queue size,
- rejected tasks,
- utilization percentage.

### 31.3 JDBC Pool

- num connections used,
- num connections free,
- wait queue length,
- wait time,
- timeout count,
- leak count,
- validation failure.

### 31.4 JMS

- queue depth,
- consumer count,
- redelivery count,
- dead message count,
- message age.

### 31.5 JVM

- CPU usage,
- heap usage,
- GC pause,
- thread count,
- native memory,
- safepoint pauses.

### 31.6 Application

- endpoint latency,
- downstream call latency,
- transaction duration,
- business operation failure,
- async job backlog,
- job age.

---

## 32. Failure Scenario: Slow DB Menjatuhkan Semua HTTP Thread

### 32.1 Kondisi Awal

```text
HTTP max threads = 200
JDBC pool max    = 80
Proxy timeout    = 30s
JDBC wait        = 60s
DB query normal  = 100ms
```

Normal:

```text
RPS 100, latency 150ms, OK
```

### 32.2 Incident

DB tiba-tiba lambat:

```text
query p95 = 10s
```

Efek:

```text
80 requests hold DB connections
120 requests wait for DB connection
new requests wait for HTTP thread
proxy starts timing out at 30s
users retry
traffic doubles
```

### 32.3 Kenapa CPU Tidak Tinggi?

Karena thread sedang menunggu IO/DB. CPU rendah bukan tanda sehat.

### 32.4 Mitigasi Darurat

- Turunkan traffic dari upstream jika bisa.
- Disable endpoint berat sementara.
- Kurangi retry storm.
- Periksa DB wait/lock.
- Ambil thread dump.
- Pantau JDBC pool wait.
- Jika aman, fail-fast dengan wait timeout lebih pendek.
- Scale instance hanya jika DB masih punya kapasitas.

### 32.5 Perbaikan Permanen

- Query tuning/index.
- Timeout alignment.
- Pool sizing berdasarkan DB capacity.
- Circuit breaker untuk fitur non-critical.
- Cache read-heavy lookup.
- Async untuk operasi yang tidak perlu synchronous.
- Separate workload/reporting.
- Load test dengan DB latency injection.

---

## 33. Failure Scenario: Report Endpoint Membuat Thread Pool Habis

### 33.1 Kondisi

Endpoint:

```text
GET /reports/monthly/export
```

Melakukan:

- query besar,
- generate Excel/PDF,
- memory allocation besar,
- response streaming lama.

Jika 100 user klik bersamaan:

```text
100 HTTP threads stuck generating report
DB pool consumed
heap pressure naik
GC pause naik
normal API ikut lambat
```

### 33.2 Solusi Arsitektural

Jangan hanya menaikkan thread pool.

Pattern lebih sehat:

```text
POST /report-jobs
  → create job
  → enqueue JMS/batch
  → return job id

GET /report-jobs/{id}
  → status

GET /report-jobs/{id}/download
  → download when ready
```

Dengan:

- report worker concurrency terbatas,
- DB/report pool terpisah,
- output disimpan di object storage/file store,
- progress/status observable,
- retry idempotent.

---

## 34. Failure Scenario: Async Executor Membuat Overload Tersembunyi

### 34.1 Kode Buruk

```java
@Resource
ManagedExecutorService executor;

public Response submit(List<Item> items) {
    for (Item item : items) {
        executor.submit(() -> process(item));
    }
    return Response.accepted().build();
}
```

Jika `items` berisi 10.000 item, aplikasi memasukkan 10.000 task.

Masalah:

- queue membesar,
- memory naik,
- DB/remote service overload,
- error terjadi setelah response 202,
- user menganggap sukses,
- retry membuat duplikasi.

### 34.2 Pattern Lebih Aman

- Persist job dan item.
- Worker mengambil batch terbatas.
- Concurrency limit eksplisit.
- Idempotency key per item.
- Retry terkontrol.
- Dead-letter/failed table.
- Status observable.

---

## 35. GlassFish + Kubernetes: Thread Pool vs Pod Scaling

Jika GlassFish berjalan di Kubernetes, thread tuning harus memperhatikan pod CPU/memory limit.

Contoh buruk:

```text
Pod CPU limit: 1 core
HTTP max threads: 500
JDBC pool: 200
```

Ini hampir pasti buruk untuk workload CPU/mixed. Thread banyak tidak membuat 1 core menjadi 20 core.

Kubernetes HPA juga bukan solusi otomatis:

- scale out bisa memperbanyak connection ke DB,
- semua pod bisa menyerang downstream yang sama,
- readiness bisa gagal saat thread starvation,
- rolling update bisa memicu load spike jika drain tidak benar.

Prinsip:

```text
Pod-level concurrency × replica count must fit downstream capacity.
```

Contoh:

```text
DB safe app sessions = 200
replicas = 4
max JDBC pool per pod should not exceed ~50, minus reserve
```

---

## 36. Java 8 sampai Java 25: Perubahan Cara Berpikir

### 36.1 Java 8 Era

Ciri:

- platform threads mahal,
- executor pool sizing sangat penting,
- `CompletableFuture` ada tapi managed runtime caveat,
- app server mostly platform-thread model,
- Java EE 8 / GlassFish 5.x legacy.

Mental model:

```text
Threads are expensive. Pool carefully.
```

### 36.2 Java 11/17 Era

Ciri:

- GC lebih matang,
- container awareness lebih baik,
- Jakarta namespace migration mulai relevan,
- modern TLS/security defaults berubah,
- thread still platform-thread dominated.

Mental model:

```text
Runtime is more container/cloud aware, but concurrency budget remains essential.
```

### 36.3 Java 21 Era

Ciri:

- virtual threads final,
- Jakarta EE 11 aligns with Java 21 capabilities,
- blocking code can scale differently,
- but downstream capacity remains hard limit.

Mental model:

```text
Thread occupancy is cheaper, but resource concurrency is still limited.
```

### 36.4 Java 25 Era

Untuk Java 25, prinsipnya sama: jangan menganggap JDK baru menghapus kebutuhan workload isolation, pool sizing, timeout, dan backpressure. Fitur JVM bisa memperbaiki runtime ergonomics dan performance envelope, tetapi architecture capacity tetap harus dihitung.

---

## 37. Configuration Anti-Patterns

### 37.1 “Naikkan Semua Pool”

```text
HTTP threads: 1000
JDBC pool: 500
Executor: 500
```

Biasanya memperparah:

- DB overload,
- context switching,
- memory usage,
- tail latency,
- cascading failure.

### 37.2 Unbounded Queue

Queue tanpa batas membuat overload berubah menjadi memory pressure.

### 37.3 Timeout Kosong

No timeout berarti thread bisa hidup lebih lama daripada business value request.

### 37.4 Async Tanpa Observability

Background failure yang tidak dipantau lebih berbahaya daripada synchronous failure.

### 37.5 Default ForkJoinPool di App Server

`CompletableFuture.supplyAsync()` tanpa executor eksplisit bisa memakai common pool yang tidak dikelola container.

### 37.6 Timer Heavy Work di Instance yang Sama dengan User Traffic

Scheduled workload bisa mencuri kapasitas dari request interaktif.

### 37.7 Health Check Memakai Pool yang Sama dan Bergantung DB Berat

Health check harus ringan. Jika health check ikut antre di HTTP thread/JDBC pool yang saturated, orchestrator bisa melakukan restart berantai.

---

## 38. Production Checklist: Thread/Executor Readiness

Gunakan checklist ini sebelum production.

### 38.1 Inventory Workload

- [ ] Endpoint cepat diidentifikasi.
- [ ] Endpoint berat diidentifikasi.
- [ ] Batch/timer job diidentifikasi.
- [ ] JMS/MDB consumer diidentifikasi.
- [ ] Remote integration diidentifikasi.
- [ ] CPU-heavy task diidentifikasi.

### 38.2 Capacity Budget

- [ ] CPU core budget jelas.
- [ ] HTTP concurrency target jelas.
- [ ] JDBC max safe sessions jelas.
- [ ] Remote API rate limit jelas.
- [ ] JMS consumer concurrency jelas.
- [ ] Report/batch concurrency jelas.

### 38.3 Timeout

- [ ] Proxy timeout diketahui.
- [ ] App request deadline ada.
- [ ] JDBC wait timeout ada.
- [ ] Query timeout ada.
- [ ] Remote connect/read timeout ada.
- [ ] Transaction timeout selaras.

### 38.4 Executor

- [ ] Tidak ada unmanaged thread pool sembarangan.
- [ ] ManagedExecutorService dipakai untuk async managed work.
- [ ] Queue bounded atau ada backpressure.
- [ ] Error async tercatat dan termonitor.
- [ ] Shutdown behavior diuji.

### 38.5 Monitoring

- [ ] Thread pool busy/queue termonitor.
- [ ] JDBC pool used/wait termonitor.
- [ ] Endpoint p95/p99 termonitor.
- [ ] JVM thread count termonitor.
- [ ] JMS backlog termonitor.
- [ ] Timer duration/error termonitor.

### 38.6 Load Test

- [ ] Normal load test.
- [ ] Burst test.
- [ ] Slow DB test.
- [ ] Remote API slow test.
- [ ] Pool exhaustion test.
- [ ] Rolling restart test.
- [ ] Graceful shutdown test.

---

## 39. Decision Framework

### 39.1 Ketika Terjadi 504

Tanya:

```text
Apakah request sudah masuk aplikasi?
Apakah HTTP thread tersedia?
Apakah thread menunggu DB?
Apakah thread menunggu remote API?
Apakah thread blocked lock?
Apakah proxy timeout lebih pendek dari internal timeout?
Apakah user retry memperparah?
```

### 39.2 Ketika CPU Rendah tapi Latency Tinggi

Kemungkinan:

- IO wait,
- DB wait,
- remote wait,
- pool wait,
- lock wait,
- queue wait.

CPU rendah bukan alasan menambah thread tanpa diagnosis.

### 39.3 Ketika CPU Tinggi

Kemungkinan:

- CPU-bound endpoint,
- JSON/XML serialization berat,
- GC overhead,
- logging overhead,
- compression/encryption,
- too many runnable threads,
- spin/lock contention.

### 39.4 Ketika JDBC Pool Habis

Tanya:

```text
Pool terlalu kecil?
DB lambat?
Connection leak?
Transaction terlalu panjang?
Query lock wait?
Thread terlalu banyak menyerang DB?
Batch/report mencuri pool?
```

### 39.5 Ketika Async Backlog Naik

Tanya:

```text
Producer terlalu cepat?
Consumer terlalu sedikit?
Downstream lambat?
Retry storm?
Poison message?
Concurrency limit terlalu rendah atau terlalu tinggi?
```

---

## 40. Mini Lab: Membaca Gejala dari Thread Dump

Bayangkan thread dump menunjukkan 180 dari 200 HTTP threads seperti ini:

```text
"http-thread-pool::http-listener-1(153)" #312 daemon prio=5 os_prio=0 tid=0x... nid=0x... runnable
   java.lang.Thread.State: RUNNABLE
    at java.net.SocketInputStream.socketRead0(Native Method)
    at java.net.SocketInputStream.socketRead(SocketInputStream.java:115)
    at oracle.net.ns.Packet.receive(Packet.java:...)
    at oracle.jdbc.driver.T4CPreparedStatement.executeForRows(...)
    at com.company.caseapp.CaseRepository.findById(CaseRepository.java:88)
```

Interpretasi:

```text
Sebagian besar HTTP threads menunggu Oracle JDBC response.
Ini bukan masalah kekurangan CPU.
Ini kemungkinan DB latency, query plan, lock wait, network DB, atau pool pressure.
```

Aksi:

1. Cek DB active session/wait event.
2. Cek query SQL terkait.
3. Cek JDBC pool used/wait.
4. Cek endpoint yang memicu query.
5. Cek timeout alignment.
6. Cek apakah recent deployment mengubah query.
7. Jangan langsung menaikkan HTTP thread pool.

---

## 41. Mini Lab: Merancang Budget untuk Aplikasi Case Management

Misal aplikasi regulatory case management memiliki workload:

- interactive case search,
- case detail open,
- document upload,
- audit trail listing,
- nightly reminder job,
- JMS notification sender,
- report export.

Budget awal:

```text
Pod replicas: 4
CPU per pod: 4 cores
DB max safe app sessions: 160
Remote notification API limit: 300/min
Interactive p95 target: 500ms
Report allowed concurrency: 2 per pod
JMS notification concurrency: 5 per pod
```

Turunan:

```text
DB sessions per pod: about 40
Reserve report: 5
Reserve JMS: 5
Interactive JDBC pool: 30
HTTP threads: 80-150 depending measured latency
Report executor: 2
Notification worker: 5
Remote API limiter: cluster-wide or per-pod adjusted
```

Kenapa HTTP threads boleh lebih dari JDBC pool?

Karena tidak semua request selalu memegang DB connection sepanjang waktu. Tetapi jika semua endpoint DB-heavy, wait timeout harus pendek dan backpressure harus jelas.

---

## 42. Mini Lab: Virtual Thread Migration Thought Experiment

Aplikasi lama Java 8/GlassFish 5:

```text
HTTP thread pool: 200
JDBC pool: 80
Remote service calls blocking
Average request latency: 800ms
CPU usage: 35%
```

Mau migrate ke Java 21/GlassFish 8 dan virtual-thread-aware concurrency.

Pertanyaan sebelum optimis:

1. Apakah library JDBC/HTTP compatible?
2. Apakah remote service punya rate limit?
3. Apakah DB pool tetap 80?
4. Apakah ada global synchronized cache?
5. Apakah request context/security context aman?
6. Apakah load test menunjukkan platform thread starvation saat ini?
7. Apakah latency dominated by IO wait?
8. Apakah ada CPU-heavy serialization?

Jika bottleneck utama adalah thread occupancy karena remote IO wait, virtual thread bisa membantu.

Jika bottleneck utama adalah DB lock dan query lambat, virtual thread tidak menyelesaikan root cause.

---

## 43. Prinsip Final Part Ini

Simpan prinsip berikut:

```text
Thread pool tuning is not about making numbers bigger.
It is about placing concurrency, queueing, timeout, and failure boundaries deliberately.
```

```text
Every blocking operation consumes some kind of budget.
If not CPU, then thread occupancy, connection capacity, transaction time, queue memory, or downstream quota.
```

```text
Async moves waiting somewhere else.
It does not remove work.
```

```text
Virtual threads reduce the cost of waiting.
They do not remove the need for backpressure.
```

```text
The safest system is not the system with the largest thread pools.
It is the system whose overload behavior is predictable, observable, and contained.
```

---

## 44. Apa yang Tidak Dibahas Detail di Part Ini

Untuk menghindari pengulangan seri sebelumnya, part ini tidak mendalami:

- Java memory model,
- lock implementation,
- `CompletableFuture` API detail,
- reactive streams API,
- structured concurrency syntax detail,
- low-level virtual thread implementation internal,
- JMH benchmarking concurrency.

Semua itu sudah menjadi fondasi Java concurrency. Di sini kita fokus pada **GlassFish runtime concurrency engineering**.

---

## 45. Ringkasan

Di part ini kita membangun mental model bahwa GlassFish concurrency bukan sekadar `ThreadPoolExecutor`.

Kita membahas:

- thread pool sebagai runtime capacity boundary,
- HTTP worker thread dan request lifecycle,
- blocking workload taxonomy,
- queue placement,
- thread starvation,
- coordination dengan JDBC pool,
- coordination dengan remote HTTP client,
- ManagedExecutorService,
- async task pitfalls,
- timer service,
- JMS/MDB concurrency,
- JCA work manager,
- bahaya unmanaged thread,
- virtual threads di Java 21+,
- pinning dan carrier thread,
- timeout alignment,
- Kubernetes interaction,
- thread dump reading,
- capacity budgeting,
- dan failure scenario production.

Jika hanya satu hal yang perlu diingat:

> **Thread adalah tempat failure menunggu. Pool, queue, timeout, dan downstream limit menentukan apakah failure itu tertahan, menyebar, atau berubah menjadi outage.**

---

## 46. Status Seri

Part 11 selesai.

Seri **belum selesai**.

Part berikutnya:

> **Part 12 — JDBC Resources dan Connection Pool Engineering**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-010.md">⬅️ Part 10 — HTTP Stack dan Grizzly Runtime Internals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-012.md">Part 12 — JDBC Resources dan Connection Pool Engineering ➡️</a>
</div>
