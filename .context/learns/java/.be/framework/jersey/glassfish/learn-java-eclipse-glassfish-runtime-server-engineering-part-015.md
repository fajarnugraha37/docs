# learn-java-eclipse-glassfish-runtime-server-engineering-part-015
# Part 15 — EJB Container Runtime: Pooling, Passivation, Timers, Remote Calls, dan ORB

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: `015`  
> Topik: **Eclipse GlassFish — EJB Container Runtime Engineering**  
> Target pembaca: Java backend engineer / tech lead / platform engineer yang ingin memahami GlassFish bukan hanya sebagai “tempat deploy”, tetapi sebagai runtime enterprise yang mengatur lifecycle, pool, transaction, timer, remote invocation, dan resource coordination.  
> Fokus Java: Java 8 sampai Java 25, dengan perhatian khusus pada pergeseran Java EE `javax.*` ke Jakarta EE `jakarta.*`.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah masuk ke runtime service penting:

- Part 10: HTTP Stack dan Grizzly.
- Part 11: Thread pools, executor, blocking, async, dan virtual threads.
- Part 12: JDBC resource dan connection pool.
- Part 13: transaction service, JTA, XA, recovery.
- Part 14: JMS dan OpenMQ.

Part ini membahas **EJB container runtime** di GlassFish.

Ini bukan pengulangan materi EJB API dasar. Kita tidak akan menghabiskan waktu menjelaskan ulang apa itu `@Stateless`, `@Stateful`, `@Singleton`, `@MessageDriven`, `@TransactionAttribute`, atau lifecycle callback secara textbook. Fokusnya adalah:

1. Bagaimana GlassFish menjalankan EJB secara internal.
2. Apa yang di-pool, apa yang di-cache, apa yang di-passivate.
3. Bagaimana EJB berinteraksi dengan thread pool, transaction manager, JDBC, JMS, timer service, dan security context.
4. Mengapa error EJB sering terlihat sebagai error business code padahal root cause-nya ada di runtime configuration.
5. Bagaimana mengambil keputusan modern: kapan EJB masih layak, kapan lebih baik diganti oleh service biasa, scheduler eksternal, queue consumer, atau microservice pattern.

---

## 1. Mental Model Utama: EJB Container sebagai Runtime Coordinator

EJB container di GlassFish bukan hanya “object factory”.

Mental model yang lebih tepat:

```text
EJB Container
  = lifecycle manager
  + invocation interceptor chain
  + pool/cache manager
  + transaction boundary coordinator
  + security context propagator
  + timer scheduler
  + remote invocation endpoint
  + integration bridge to JMS/JCA/JTA/JNDI
```

Ketika aplikasi memanggil sebuah EJB method, yang terjadi bukan sekadar:

```java
service.doSomething();
```

Secara runtime, GlassFish harus menjawab banyak pertanyaan:

```text
1. Bean instance mana yang akan dipakai?
2. Apakah instance sudah tersedia di pool/cache?
3. Apakah method membutuhkan transaction?
4. Apakah caller punya security identity yang benar?
5. Apakah invocation lokal atau remote?
6. Apakah perlu interop IIOP/ORB?
7. Apakah timer/JMS sedang memanggil method ini?
8. Apakah exception harus memicu rollback?
9. Apakah instance harus dikembalikan ke pool?
10. Apakah stateful instance harus tetap di cache atau bisa dipassivate?
```

Dengan kata lain, EJB container adalah **runtime boundary** antara application code dan enterprise guarantees.

---

## 2. Kenapa EJB Masih Relevan untuk Dipahami?

Walaupun banyak aplikasi modern berpindah ke Spring Boot, Quarkus, Micronaut, atau lightweight services, EJB masih penting untuk dikuasai jika Anda bekerja pada:

- sistem pemerintahan atau regulated enterprise;
- aplikasi Java EE / Jakarta EE legacy;
- EAR monolith besar;
- aplikasi dengan JTA transaction-heavy workflow;
- sistem lama yang memakai remote EJB;
- batch/timer internal;
- JMS Message-Driven Bean;
- migrasi Java EE 8 ke Jakarta EE 10/11;
- aplikasi yang masih memakai GlassFish/Payara/WildFly/WebLogic/WebSphere/Open Liberty.

Engineer top-level tidak hanya berkata “EJB itu legacy”. Ia harus bisa menjawab:

```text
EJB mana yang legacy accidental complexity?
EJB mana yang masih menjadi runtime contract penting?
EJB mana yang aman diganti?
EJB mana yang tidak boleh disentuh tanpa migration strategy?
```

---

## 3. EJB Container di GlassFish: Apa yang Sebenarnya Dikelola?

GlassFish EJB container mengelola beberapa tipe komponen:

| Tipe Bean | Runtime Concern Utama | State? | Pool? | Cache? | Umum Digunakan Untuk |
|---|---:|---:|---:|---:|---|
| Stateless Session Bean | pooling, transaction, security | Tidak client-specific | Ya | Tidak | service layer, facade, transactional operation |
| Stateful Session Bean | cache, passivation, conversational state | Ya | Tidak seperti stateless | Ya | conversational workflow, legacy wizard/session |
| Singleton Session Bean | concurrency, initialization ordering | Shared singleton | Tidak | Tidak | startup service, shared coordinator |
| Message-Driven Bean | JMS delivery, concurrency, redelivery | Message-scoped | Ya | Tidak | async consumer |
| Entity Bean lama | pooling/cache legacy | Ya/DB-bound | Ya | Ya | legacy EJB 2.x, sebaiknya dimodernisasi |

GlassFish documentation menjelaskan bahwa EJB container melakukan pooling untuk anonymous instances seperti stateless session bean dan message-driven bean agar overhead create/destroy object berkurang, sedangkan stateful instances dikontrol melalui cache dan passivation.

Poin penting:

```text
Stateless = pool pressure.
Stateful  = cache/passivation pressure.
MDB       = pool + broker delivery pressure.
Singleton = concurrency policy pressure.
Timer     = scheduler + transaction/retry pressure.
Remote    = serialization + ORB/IIOP pressure.
```

Kalau Anda salah mengidentifikasi pressure point, tuning akan salah arah.

---

## 4. Invocation Path: Apa yang Terjadi Saat EJB Method Dipanggil?

Sederhananya:

```text
Caller
  ↓
EJB reference / proxy
  ↓
Container invocation pipeline
  ↓
Security check
  ↓
Transaction interceptor
  ↓
Concurrency / lock interceptor
  ↓
Lifecycle / context setup
  ↓
Bean instance acquisition
  ↓
Business method execution
  ↓
Exception classification
  ↓
Transaction commit/rollback
  ↓
Instance return / cache update / discard
  ↓
Response to caller
```

Untuk local invocation, caller mungkin berada dalam JVM yang sama. Untuk remote invocation, ada tambahan:

```text
serialization
network call
IIOP/ORB layer or remote protocol bridge
remote exception semantics
client stub/proxy behavior
```

Untuk MDB invocation, caller bukan HTTP/EJB client, tetapi message broker:

```text
OpenMQ/JMS broker
  ↓
JMS connection/session
  ↓
MDB container
  ↓
transaction boundary
  ↓
onMessage()
  ↓
ack/commit/rollback
  ↓
redelivery/dead message behavior
```

Untuk EJB timer:

```text
EJB Timer Service
  ↓
timer persistence table
  ↓
scheduler dispatch
  ↓
timeout callback
  ↓
transaction boundary
  ↓
success / exception / retry
```

Jadi EJB method bukan hanya function call. Ia adalah **managed invocation**.

---

## 5. Stateless Session Bean Runtime

### 5.1 Mental Model

Stateless bean tidak menyimpan state client-specific. Karena itu semua instance dianggap interchangeable.

```text
Client A  ─┐
Client B  ─┼──> Stateless bean pool ──> any free instance
Client C  ─┘
```

Container dapat membuat beberapa instance dari class yang sama dan menaruhnya dalam pool.

Pool bertujuan:

- mengurangi object creation overhead;
- menjaga ready-to-serve instances;
- membatasi jumlah concurrent bean instances;
- mengontrol memory footprint;
- mengurangi pressure pada initialization dependency.

### 5.2 Pool Lifecycle

Siklus high-level:

```text
Create bean instance
  ↓
Dependency injection
  ↓
@PostConstruct
  ↓
Put into free pool
  ↓
Acquire for method invocation
  ↓
Execute business method
  ↓
Return to pool
  ↓
Idle timeout / resize / destroy
  ↓
@PreDestroy
```

Stateless bean tidak boleh menyimpan state spesifik user/request di field instance.

Contoh buruk:

```java
@Stateless
public class PaymentService {
    private String currentUserId; // SALAH: instance dipakai bergantian oleh banyak caller

    public void approve(String userId, String paymentId) {
        this.currentUserId = userId;
        // ...
    }
}
```

Masalahnya bukan hanya thread-safety. Masalahnya adalah **semantic violation**: pool membuat instance reuse lintas caller.

Contoh benar:

```java
@Stateless
public class PaymentService {
    public void approve(String userId, String paymentId) {
        // state request hidup di stack/local variable, bukan field instance
    }
}
```

### 5.3 Pool Configuration

GlassFish-specific descriptor memakai elemen seperti:

```xml
<glassfish-ejb-jar>
  <enterprise-beans>
    <ejb>
      <ejb-name>PaymentService</ejb-name>
      <bean-pool>
        <steady-pool-size>8</steady-pool-size>
        <resize-quantity>16</resize-quantity>
        <max-pool-size>64</max-pool-size>
        <pool-idle-timeout-in-seconds>600</pool-idle-timeout-in-seconds>
      </bean-pool>
    </ejb>
  </enterprise-beans>
</glassfish-ejb-jar>
```

Nama lama `sun-ejb-jar.xml` banyak muncul pada dokumentasi/histori GlassFish lama. Pada GlassFish modern, nama yang relevan adalah `glassfish-ejb-jar.xml`, tetapi konsep properti pool/cache tetap serupa.

### 5.4 Arti Parameter Pool

| Parameter | Arti | Risiko Jika Terlalu Kecil | Risiko Jika Terlalu Besar |
|---|---|---|---|
| `steady-pool-size` | jumlah minimum/awal instance yang dipertahankan | cold creation saat traffic naik | memory idle waste |
| `resize-quantity` | jumlah instance dibuat/dihapus saat resize | lambat bereaksi terhadap spike | resize terlalu agresif |
| `max-pool-size` | batas maksimum instance | contention/wait | memory waste, downstream overload |
| `pool-idle-timeout-in-seconds` | durasi idle sebelum instance bisa dihancurkan | pool churn | pool tetap besar terlalu lama |

### 5.5 Pool Bukan Throughput Magic

Kesalahan umum:

```text
Latency tinggi → max-pool-size dinaikkan.
```

Ini sering salah.

Jika method EJB menunggu DB selama 2 detik, menaikkan pool dari 32 ke 256 hanya menambah jumlah concurrent request yang sedang menunggu DB. Throughput belum tentu naik; DB bisa makin collapse.

Formula mental:

```text
EJB concurrent demand ≈ arrival_rate × service_time
```

Jika:

```text
100 request/second × 200 ms = 20 concurrent invocation
```

Maka pool 32 mungkin cukup.

Jika DB melambat:

```text
100 request/second × 2 seconds = 200 concurrent invocation
```

Jika pool dinaikkan ke 256, Anda mengizinkan 200 invocation menekan DB secara bersamaan.

Pertanyaan yang benar:

```text
Apakah bottleneck ada pada EJB instance availability,
atau pada resource downstream seperti JDBC pool, DB lock, remote HTTP, JMS, CPU?
```

---

## 6. Stateful Session Bean Runtime

### 6.1 Mental Model

Stateful bean menyimpan conversational state per client.

```text
Client A ──> SFSB instance A
Client B ──> SFSB instance B
Client C ──> SFSB instance C
```

Tidak seperti stateless bean, instance tidak interchangeable.

Stateful bean cocok untuk:

- wizard flow legacy;
- conversational transaction pattern lama;
- stateful shopping cart pattern lama;
- aplikasi desktop/remote enterprise client lama.

Namun untuk web modern, stateful bean sering menjadi liability karena:

- memory footprint tinggi;
- sulit diskalakan horizontal;
- passivation error;
- failover rumit;
- state tersembunyi di memory server;
- sulit diobservasi;
- tidak cocok untuk stateless REST design.

### 6.2 Cache dan Passivation

Karena setiap client punya instance sendiri, container tidak mem-pool stateful bean seperti stateless bean. Container menyimpan instance aktif di cache.

Jika cache penuh atau instance idle, GlassFish dapat melakukan **passivation**:

```text
Active stateful instance
  ↓
serialize conversational state
  ↓
write to passivation store
  ↓
remove from memory
```

Saat client memanggil lagi:

```text
lookup stateful identity
  ↓
load serialized state
  ↓
activate instance
  ↓
continue invocation
```

### 6.3 Syarat Passivation

Agar stateful bean aman dipassivate:

- field state harus serializable;
- dependency non-serializable harus transient atau container-managed;
- resource handle seperti JDBC connection tidak boleh disimpan di field;
- thread, socket, file handle, stream tidak boleh menjadi conversational state;
- extended persistence context perlu dipahami dengan hati-hati;
- object graph tidak boleh terlalu besar.

Contoh buruk:

```java
@Stateful
public class ReportWizard {
    private Connection connection;      // SALAH
    private InputStream uploadedStream; // SALAH
    private Thread workerThread;        // SALAH
}
```

Contoh lebih aman:

```java
@Stateful
public class ReportWizard {
    private String draftId;
    private List<String> selectedColumns;
    private Map<String, String> filters;
}
```

Bahkan contoh aman pun harus diuji dengan passivation, bukan hanya happy path.

### 6.4 Cache Configuration

GlassFish EJB cache biasanya dikendalikan melalui:

```xml
<bean-cache>
  <max-cache-size>512</max-cache-size>
  <resize-quantity>32</resize-quantity>
  <cache-idle-timeout-in-seconds>600</cache-idle-timeout-in-seconds>
  <removal-timeout-in-seconds>3600</removal-timeout-in-seconds>
  <victim-selection-policy>nru</victim-selection-policy>
</bean-cache>
```

Parameter spesifik dapat berbeda antar versi, jadi selalu validasi terhadap descriptor documentation untuk versi GlassFish yang dipakai.

Mental model parameter:

| Parameter | Fungsi |
|---|---|
| `max-cache-size` | batas jumlah instance yang dapat hidup di cache |
| `cache-resize-quantity` / `resize-quantity` | jumlah instance dieviction ketika cache perlu dirampingkan |
| `cache-idle-timeout-in-seconds` | idle threshold sebelum candidate eviction/passivation |
| `removal-timeout-in-seconds` | berapa lama instance boleh bertahan sebelum removal |
| `victim-selection-policy` | strategi memilih instance yang dikorbankan |

### 6.5 Failure Mode Stateful Bean

| Symptom | Kemungkinan Root Cause |
|---|---|
| `NotSerializableException` | stateful field tidak serializable saat passivation |
| state hilang setelah failover/restart | passivation/replication tidak dikonfigurasi sesuai ekspektasi |
| memory naik seiring user aktif | terlalu banyak conversational state di cache |
| latency spike periodik | passivation/activation berat |
| stale data | stateful object menyimpan snapshot lama |
| sulit scale-out | state terikat ke instance server |

### 6.6 Prinsip Modernisasi

Untuk aplikasi modern, tanyakan:

```text
Apakah state ini benar-benar harus hidup di EJB instance?
Atau bisa diekspresikan sebagai:
- row di database,
- Redis/session store,
- workflow state machine,
- event-sourced aggregate,
- client-side draft,
- stateless REST resource?
```

Untuk domain regulatory/case management, state eksplisit di database biasanya jauh lebih defensible daripada state implisit dalam stateful bean.

---

## 7. Singleton Session Bean Runtime

### 7.1 Mental Model

Singleton bean adalah satu instance per application/module context.

```text
Application
  ↓
Singleton Bean Instance
  ↓
Shared by all callers
```

Digunakan untuk:

- startup initialization;
- in-memory registry;
- scheduled coordinator;
- cache warmer;
- simple in-VM coordination;
- exposing shared runtime state.

Tetapi singleton bean sangat mudah disalahgunakan sebagai global mutable state.

### 7.2 Concurrency Policy

EJB singleton mendukung container-managed concurrency dengan lock semantics:

```java
@Singleton
@Startup
public class RuntimeRegistry {

    private final Map<String, String> cache = new HashMap<>();

    @Lock(LockType.READ)
    public String get(String key) {
        return cache.get(key);
    }

    @Lock(LockType.WRITE)
    public void put(String key, String value) {
        cache.put(key, value);
    }
}
```

Mental model:

```text
@Lock(READ)  = banyak caller boleh membaca bersamaan
@Lock(WRITE) = exclusive access
```

Risiko:

- write lock lama dapat memblokir semua read;
- read method yang sebenarnya mutating menyebabkan race;
- external call di bawah write lock dapat menciptakan cascading latency;
- deadlock jika singleton memanggil komponen lain yang balik memanggil singleton.

### 7.3 Startup Ordering

`@Startup` sering dipakai untuk init logic:

```java
@Singleton
@Startup
public class BootstrapService {
    @PostConstruct
    public void init() {
        // init
    }
}
```

Aturan produksi:

```text
@PostConstruct tidak boleh menjadi tempat kerja berat tanpa batas waktu.
```

Jika startup singleton:

- memanggil remote service;
- melakukan migration;
- preload data besar;
- menunggu lock DB;
- membuat thread sendiri;

maka server startup bisa terlihat “hang”.

Lebih baik:

- init minimal;
- validasi dependency penting;
- pekerjaan berat dipindahkan ke managed executor/timer/job eksternal;
- readiness endpoint mencerminkan dependency state.

---

## 8. Message-Driven Bean Runtime

MDB sudah dibahas sebagian pada Part 14, tetapi di sini kita lihat dari sisi EJB container.

### 8.1 MDB sebagai EJB yang Dipanggil Broker

MDB tidak dipanggil oleh HTTP client atau local EJB caller.

```text
Broker
  ↓
JMS provider
  ↓
MDB container
  ↓
MDB instance from pool
  ↓
onMessage()
```

MDB instance biasanya pooled karena instance tidak menyimpan conversational state.

### 8.2 MDB Pool Pressure

MDB concurrency ditentukan oleh kombinasi:

- broker delivery behavior;
- JMS connection/session count;
- MDB pool size;
- transaction duration;
- message processing latency;
- downstream resource seperti DB/HTTP;
- redelivery policy.

Jika MDB lambat karena DB, meningkatkan MDB pool bisa memperburuk DB.

Model sederhana:

```text
MDB concurrency ≈ message_rate × processing_time
```

Jika:

```text
50 msg/sec × 500 ms = 25 concurrent MDB invocation
```

Maka MDB pool 32 mungkin masuk akal.

Jika downstream melambat:

```text
50 msg/sec × 5 sec = 250 concurrent MDB invocation
```

Menaikkan pool ke 250 mungkin hanya mengubah DB menjadi bottleneck yang lebih parah.

### 8.3 MDB dan Transaction

Dengan container-managed transaction:

```text
onMessage() success
  → transaction commit
  → message acknowledged

onMessage() throws runtime exception / rollback
  → transaction rollback
  → message eligible for redelivery
```

Karena itu MDB handler harus idempotent.

Anti-pattern:

```java
public void onMessage(Message message) {
    paymentGateway.charge(...); // external side effect
    paymentRepository.markPaid(...); // DB update
}
```

Jika DB update gagal setelah charge berhasil, rollback JMS dapat menyebabkan redelivery dan charge ulang.

Pattern lebih aman:

```text
1. Receive message.
2. Insert/process idempotency key in DB.
3. Execute side effect with idempotency key.
4. Mark completed.
5. Commit.
```

Atau gunakan outbox/inbox pattern.

---

## 9. EJB Timer Service Runtime

### 9.1 Timer Service sebagai Internal Scheduler

EJB Timer Service memberikan scheduler terkelola oleh container.

Jenis timer:

- programmatic timer;
- calendar-based timer;
- automatic timer via annotation;
- persistent timer;
- non-persistent timer.

Runtime concern:

```text
Timer callback = managed EJB invocation.
```

Artinya callback timer masih melewati:

- transaction interceptor;
- security context;
- thread/container dispatch;
- exception handling;
- retry/redelivery policy;
- persistence table untuk persistent timer.

### 9.2 Timer Persistence

GlassFish menggunakan datasource timer untuk persistent EJB timer. Dokumentasi GlassFish menjelaskan bahwa Timer DataSource default adalah `jdbc/__TimerPool`, dan jika EJB Timer Service sudah dimulai di server instance, table timer juga perlu dibuat ketika datasource diganti.

Mental model:

```text
Persistent timer bukan hanya memory schedule.
Ia adalah runtime schedule + database state + recovery semantics.
```

Jika database timer bermasalah:

- timer tidak fire;
- timer fire terlambat;
- recovery gagal;
- duplicate timer execution bisa muncul dalam kondisi tertentu;
- startup bisa terganggu.

### 9.3 Timer dan XA

Dokumentasi GlassFish juga menekankan bahwa menggunakan EJB Timer Service setara dengan berinteraksi dengan satu JDBC resource manager. Jika EJB component juga mengakses database lain dalam transaction yang sama, maka datasource perlu dipikirkan secara XA agar transaction semantics benar.

Contoh risiko:

```text
Timer callback:
  - membaca timer state dari TimerPool
  - update business database
  - mengirim JMS message
```

Jika semua dilakukan dalam satu transaction boundary, Anda masuk ke koordinasi multi-resource.

Pertanyaan desain:

```text
Apakah timer callback harus atomic dengan business DB?
Apakah duplicate execution dapat ditoleransi?
Apakah idempotency lebih murah daripada XA?
```

### 9.4 Timer Redelivery

GlassFish menyediakan setting seperti:

- minimum delivery interval;
- maximum redeliveries;
- redelivery interval;
- timer datasource.

Jika timeout callback gagal, timer service dapat mencoba redelivery sesuai konfigurasi.

Karena itu timer callback harus:

- idempotent;
- pendek;
- tidak memegang lock lama;
- punya correlation id/job id;
- mencatat attempt;
- aman terhadap duplicate execution;
- tidak melakukan pekerjaan batch besar tanpa checkpoint.

### 9.5 Timer Anti-Pattern

Buruk:

```java
@Schedule(hour = "*", minute = "*/5", persistent = true)
public void runHugeJob() {
    // proses 1 juta row dalam satu transaction besar
}
```

Lebih baik:

```text
Timer hanya trigger coordinator.
Coordinator mengambil batch kecil.
Setiap batch punya checkpoint.
Processing idempotent.
Long work dipisah dari transaction timer utama.
```

---

## 10. Remote EJB Runtime

### 10.1 Remote EJB Bukan Local Method Call

Remote EJB terlihat seperti interface call:

```java
paymentRemote.approve(request);
```

Tetapi runtime-nya mencakup:

```text
client proxy
  ↓
serialization / marshalling
  ↓
network transport
  ↓
remote endpoint / ORB/IIOP layer
  ↓
EJB container invocation
  ↓
business method
  ↓
response serialization
```

Konsekuensi:

- parameter harus serializable;
- exception semantics berbeda;
- latency network harus diperhitungkan;
- version compatibility interface penting;
- chatty call sangat mahal;
- transaction propagation remote perlu hati-hati;
- security principal propagation harus jelas.

### 10.2 Local vs Remote Interface

Prinsip:

```text
Local interface = same JVM / same application server boundary.
Remote interface = distributed system boundary.
```

Jangan memakai remote EJB hanya karena “ingin modular”.

Jika modul berada di aplikasi yang sama, gunakan local boundary.

Jika benar-benar remote, desain seperti distributed API:

- coarse-grained method;
- DTO stabil;
- timeout eksplisit;
- retry policy;
- idempotency;
- versioning;
- compatibility contract;
- observability.

### 10.3 Serialization Compatibility

Remote EJB membawa risiko Java serialization/class compatibility.

Risiko umum:

| Risiko | Dampak |
|---|---|
| DTO berubah tanpa `serialVersionUID` stabil | `InvalidClassException` |
| client dan server beda versi class | runtime failure |
| object graph terlalu besar | latency/memory tinggi |
| lazy JPA entity dikirim remote | serialization error / data leakage |
| exception custom tidak tersedia di client | unmarshalling failure |

Rule:

```text
Remote EJB DTO harus dianggap sebagai wire contract,
bukan internal domain object.
```

---

## 11. ORB dan IIOP di GlassFish

### 11.1 Apa Itu ORB/IIOP dalam Konteks GlassFish?

GlassFish historically mendukung remote EJB melalui ORB/IIOP. ORB adalah Object Request Broker, dan IIOP adalah protocol interoperabilitas CORBA.

Untuk banyak aplikasi modern, ORB/IIOP terasa legacy. Tetapi pada enterprise Java lama, remote EJB sering bergantung padanya.

Mental model:

```text
Remote EJB classic
  = EJB proxy/stub
  + Java serialization/RMI semantics
  + ORB/IIOP transport
  + naming lookup
  + security/transaction context propagation
```

### 11.2 Kapan ORB Masih Muncul?

Anda mungkin melihat ORB/IIOP saat:

- deploy EJB remote interface;
- aplikasi lama memakai application client container;
- remote lookup dari client Java SE;
- EAR lama punya remote EJB dependency;
- server startup menginisialisasi IIOP listener;
- port IIOP konflik;
- classloading remote stub bermasalah;
- ada error `IIOP Protocol Manager initialization failed`.

### 11.3 Operational Concern

ORB/IIOP membawa concern:

- port management;
- firewall rules;
- client stub compatibility;
- serialization;
- network timeout;
- failover behavior;
- security configuration;
- difficulty in cloud-native environments.

Jika aplikasi modern tidak membutuhkan remote EJB, hindari membuka surface IIOP yang tidak perlu.

### 11.4 Migration Direction

Remote EJB sering dimigrasikan ke:

- REST API;
- gRPC;
- messaging/event;
- internal service call;
- module merge dalam monolith;
- explicit application service interface.

Tetapi migrasi harus dilakukan hati-hati karena remote EJB mungkin membawa implicit semantics:

- transaction propagation;
- security identity propagation;
- checked exception contract;
- retry behavior;
- lookup lifecycle;
- synchronous consistency expectation.

---

## 12. EJB dan Transaction Boundary

### 12.1 EJB sebagai Transaction Boundary

EJB sering menjadi tempat container-managed transaction.

Contoh:

```java
@Stateless
public class CaseApprovalService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approve(CaseId id) {
        // update DB
        // insert audit trail
        // publish JMS
    }
}
```

Runtime:

```text
Caller enters EJB method
  ↓
container checks transaction attribute
  ↓
start/join/suspend transaction
  ↓
execute business logic
  ↓
commit or rollback
```

### 12.2 TransactionAttribute sebagai Runtime Contract

| Attribute | Meaning |
|---|---|
| `REQUIRED` | join existing transaction or create new |
| `REQUIRES_NEW` | suspend existing, create new |
| `MANDATORY` | fail if no transaction exists |
| `SUPPORTS` | join if exists, otherwise no transaction |
| `NOT_SUPPORTED` | suspend existing, run without transaction |
| `NEVER` | fail if transaction exists |

Top-level engineer harus memahami efek chaining:

```text
HTTP resource
  → Stateless A REQUIRED
    → Stateless B REQUIRES_NEW
      → DAO
```

Jika B commit, lalu A rollback, hasil bisa partial.

Ini bisa benar untuk audit log, tetapi berbahaya untuk business state.

### 12.3 Exception Semantics

Simplifikasi:

```text
Runtime/system exception biasanya rollback.
Checked/application exception tidak selalu rollback kecuali dikonfigurasi.
```

Masalah umum:

```java
public void approve() throws BusinessException {
    if (invalid) {
        throw new BusinessException("Invalid"); // transaction mungkin tidak rollback
    }
}
```

Jika ingin checked exception menyebabkan rollback, perlu desain explicit, misalnya `@ApplicationException(rollback = true)`.

### 12.4 EJB Transaction dan Downstream

EJB transaction bukan hanya DB:

- JDBC resource;
- JMS resource;
- Timer service datasource;
- JCA adapter;
- XA resource.

Setiap resource yang masuk transaction menambah complexity.

Pertanyaan desain:

```text
Apakah semua side effect harus atomic?
Apakah bisa diganti idempotent outbox?
Apakah rollback benar-benar mengembalikan external world?
```

---

## 13. EJB dan Security Context

EJB container juga melakukan security check.

Contoh:

```java
@Stateless
@RolesAllowed("CASE_APPROVER")
public class CaseApprovalService {
    public void approve(String caseId) {
        // ...
    }
}
```

Runtime:

```text
Caller principal
  ↓
role mapping
  ↓
EJB method authorization
  ↓
business method
```

Concern GlassFish:

- realm;
- group-to-role mapping;
- deployment descriptor mapping;
- `glassfish-ejb-jar.xml`;
- propagation dari web tier ke EJB tier;
- remote caller identity;
- run-as identity.

Anti-pattern:

```text
Authorization hanya dilakukan di web/controller,
sedangkan EJB method internal bisa dipanggil dari path lain tanpa check.
```

Jika EJB adalah domain service boundary, authorization di EJB bisa menjadi defense-in-depth. Tetapi jangan jadikan annotation saja sebagai pengganti domain-level authorization rule yang kompleks.

---

## 14. EJB Monitoring di GlassFish

GlassFish monitoring dapat memberikan statistik EJB seperti pool/cache metrics jika monitoring aktif.

Hal yang penting dimonitor:

### 14.1 Stateless/MDB Pool

- total beans in pool;
- beans in use;
- wait count;
- create/destroy count;
- pool hits/misses;
- method invocation count;
- method execution time.

### 14.2 Stateful Cache

- total beans in cache;
- cache hits;
- cache misses;
- passivation count;
- activation count;
- passivation error count;
- expired/removed instances.

### 14.3 Timer

- active timers;
- failed executions;
- redeliveries;
- timer datasource errors;
- callback duration.

### 14.4 Transaction

- rollback count;
- timeout count;
- heuristic/in-doubt transaction;
- recovery error.

### 14.5 Thread

- EJB thread pool saturation;
- blocked/waiting threads;
- timer thread behavior;
- MDB consumer threads.

Admin command style:

```bash
asadmin get "server.monitoring-service.module-monitoring-levels.*"
asadmin set "server.monitoring-service.module-monitoring-levels.ejb-container=HIGH"
asadmin get "server.applications.*"
```

Path monitoring detail berbeda antar versi dan target, jadi gunakan:

```bash
asadmin list "*"
asadmin get "*ejb*"
asadmin get "*bean-pool*"
asadmin get "*bean-cache*"
```

untuk discovery.

---

## 15. Tuning EJB Container

### 15.1 Tuning Order yang Benar

Jangan mulai dari angka pool.

Mulai dari:

```text
1. Apa tipe bean?
2. Apa invocation source?
3. Apa latency per method?
4. Apa downstream bottleneck?
5. Apa transaction duration?
6. Apa concurrency target?
7. Apa memory footprint per instance?
8. Apa failure mode saat overloaded?
```

### 15.2 Stateless Bean Pool Tuning

Gunakan pendekatan:

```text
required_pool ≈ peak_arrival_rate × p95_service_time
```

Contoh:

```text
Peak = 200 calls/sec
p95 method time = 80 ms
required concurrency = 200 × 0.08 = 16
```

Pool 32–64 mungkin cukup, tergantung burst dan variability.

Jika p95 naik karena DB menjadi 1.5 detik:

```text
200 × 1.5 = 300
```

Itu bukan sinyal otomatis untuk pool 300. Itu sinyal downstream bottleneck.

### 15.3 Stateful Cache Tuning

Pertanyaan:

```text
Berapa user/session aktif?
Berapa ukuran state per SFSB?
Berapa lama idle retention?
Apakah passivation store cepat?
Apakah state serializable?
Apakah failover diperlukan?
```

Formula kasar:

```text
memory_budget_for_sfsb / average_sfsb_size = max_cache_size upper bound
```

Jika average object graph 200 KB dan budget 512 MB:

```text
512 MB / 200 KB ≈ 2621 instances
```

Tetapi jangan gunakan angka ini tanpa overhead dan GC effect. Mulai konservatif.

### 15.4 MDB Tuning

Tuning MDB harus sinkron dengan:

- broker prefetch/flow;
- MDB pool;
- JDBC pool;
- DB concurrency;
- transaction timeout;
- redelivery policy;
- dead letter strategy.

Jika MDB melakukan DB update, pastikan:

```text
MDB max concurrency <= DB pool capacity untuk workload MDB
```

Jangan biarkan MDB menyedot seluruh JDBC pool sehingga HTTP request starvation.

### 15.5 Timer Tuning

Timer callback harus:

- cepat;
- batch kecil;
- idempotent;
- tidak block lama;
- punya timeout;
- tidak melakukan full table scan;
- punya checkpoint.

Jika timer job berat, pakai model:

```text
Timer tick
  ↓
enqueue work item
  ↓
worker process batch
  ↓
checkpoint
```

---

## 16. Failure Mode dan Diagnostic Pattern

### 16.1 Pool Exhaustion

Symptom:

- request lambat;
- EJB invocation wait;
- thread menunggu instance;
- throughput flat;
- CPU rendah;
- DB mungkin idle atau penuh tergantung cause.

Diagnosis:

```bash
asadmin get "*bean-pool*"
asadmin get "*thread-pool*"
jstack <pid>
```

Cari thread yang menunggu pool, DB, lock, remote call.

### 16.2 DB Bottleneck Disamarkan sebagai EJB Bottleneck

Symptom:

- EJB method latency naik;
- pool in-use tinggi;
- JDBC pool wait count tinggi;
- DB active sessions tinggi;
- thread dump banyak di JDBC driver/socket read.

Kesimpulan:

```text
EJB pool penuh bukan root cause.
Root cause bisa DB lock/slow query/pool exhaustion/downstream latency.
```

### 16.3 Stateful Passivation Error

Symptom:

- `NotSerializableException`;
- user session error setelah idle;
- memory naik;
- activation failure.

Diagnosis:

- cek stack trace passivation;
- cek field stateful bean;
- cek object graph;
- cek extended persistence context;
- cek descriptor cache/passivation setting.

Fix:

- hilangkan non-serializable state;
- kecilkan conversational state;
- pindahkan state ke DB;
- disable/ubah passivation hanya jika benar-benar paham konsekuensinya.

### 16.4 Timer Duplicate Execution

Symptom:

- job berjalan dua kali;
- audit/event double;
- batch duplicate;
- timer redelivery setelah exception.

Fix bukan hanya “matikan redelivery”.

Fix yang benar:

- idempotency key;
- job execution table;
- lock/lease;
- checkpoint;
- unique constraint;
- exactly-once illusion dihindari.

### 16.5 Remote EJB Timeout

Symptom:

- client hang;
- remote exception;
- ORB/IIOP timeout;
- firewall issue;
- serialization error.

Diagnosis:

- port IIOP;
- naming lookup;
- client/server interface version;
- network route;
- server thread dump;
- payload size;
- timeout configuration.

### 16.6 Singleton Lock Bottleneck

Symptom:

- banyak thread `BLOCKED`;
- stack trace menunggu singleton lock;
- one slow writer blocks all readers.

Fix:

- kurangi critical section;
- jangan external call di bawah write lock;
- gunakan immutable snapshot;
- gunakan concurrent data structure;
- pecah singleton responsibility.

---

## 17. Java 8 sampai Java 25: Apa yang Berubah untuk EJB Runtime?

### 17.1 Java 8

Banyak GlassFish 4/5 legacy application hidup di Java 8:

- Java EE 7/8;
- `javax.*`;
- remote EJB masih umum;
- CORBA/Java EE modules masih tersedia di JDK lama;
- JAXB/JAX-WS lebih “terasa built-in”.

### 17.2 Java 11+

Java 11 menghapus beberapa Java EE/CORBA module dari JDK. Dampak pada aplikasi lama:

- dependency yang dulu implicit harus explicit;
- CORBA-related expectation bisa berubah;
- JAXB/JAX-WS dependency perlu diperjelas;
- server/runtime version harus kompatibel.

### 17.3 Java 17/21

Java 17/21 membawa:

- stricter strong encapsulation;
- better GC;
- better container awareness;
- new profiling tools maturity;
- virtual threads di Java 21.

EJB container tetap managed runtime. Jangan mengasumsikan virtual threads otomatis mengganti EJB thread pool semantics.

### 17.4 Java 25

Untuk GlassFish 8, Java 25 mulai relevan sebagai runtime modern. Tetapi untuk aplikasi EJB legacy:

- cek server support;
- cek bytecode target;
- cek library reflection;
- cek serialization;
- cek removed/deprecated APIs;
- cek instrumentation/agent;
- cek namespace `javax`/`jakarta`.

### 17.5 Namespace Migration

Java EE 8:

```java
import javax.ejb.Stateless;
```

Jakarta EE 9+:

```java
import jakarta.ejb.Stateless;
```

Ini bukan hanya rename source import. Dampaknya:

- binary incompatibility;
- dependency coordinate berubah;
- descriptor namespace berubah;
- third-party library compatibility;
- generated code;
- remote client compatibility;
- test framework compatibility.

---

## 18. EJB vs CDI vs Plain Service vs Spring/Quarkus Bean

Jangan menilai EJB hanya dari annotation. Nilai dari runtime contract.

| Kebutuhan | EJB Cocok? | Alternatif |
|---|---:|---|
| container-managed transaction sederhana | Ya | CDI + JTA, Spring `@Transactional` |
| remote Java-to-Java call legacy | Ya, tapi legacy-heavy | REST/gRPC/messaging |
| JMS consumer | MDB masih valid | dedicated consumer service |
| persistent timer | Bisa | Quartz, Kubernetes CronJob, external scheduler |
| conversational session state | Bisa, tapi hati-hati | DB-backed workflow/session |
| startup singleton | Bisa | CDI singleton, app lifecycle hook |
| high-throughput stateless REST | Bisa, tapi sering tidak perlu | JAX-RS/CDI/Spring/Quarkus |
| cloud-native microservice | Biasanya tidak utama | Quarkus/Spring Boot/Helidon/Micronaut |

Framework modern sering memilih explicitness. EJB memilih container-managed semantics.

Top engineer harus bisa melihat trade-off ini:

```text
EJB mengurangi boilerplate tetapi menambah implicit runtime behavior.
Plain service menambah explicit code tetapi mengurangi hidden container semantics.
```

---

## 19. Production Checklist untuk EJB di GlassFish

### 19.1 Untuk Semua EJB

- [ ] Tidak ada mutable request/user state di stateless bean field.
- [ ] Transaction attribute eksplisit untuk method penting.
- [ ] Exception rollback semantics jelas.
- [ ] Security annotation/descriptor sesuai boundary.
- [ ] No hidden remote call tanpa timeout.
- [ ] Method latency dipantau.
- [ ] Pool/cache metrics aktif di non-production performance test.
- [ ] Thread dump playbook tersedia.
- [ ] Deployment descriptor tidak drift antar environment.

### 19.2 Stateless Bean

- [ ] `max-pool-size` sesuai concurrency model.
- [ ] Tidak menyimpan state caller.
- [ ] Tidak melakukan initialization berat per invocation.
- [ ] Downstream resource capacity dihitung.

### 19.3 Stateful Bean

- [ ] Semua conversational state serializable.
- [ ] Ukuran state diketahui.
- [ ] Passivation diuji.
- [ ] Idle/removal timeout sesuai user journey.
- [ ] State penting tidak hanya hidup di memory.
- [ ] Failover semantics jelas.

### 19.4 Singleton Bean

- [ ] Lock policy jelas.
- [ ] Tidak ada external slow call dalam write lock.
- [ ] Startup logic cepat.
- [ ] Shared state thread-safe.
- [ ] Tidak menjadi god object.

### 19.5 MDB

- [ ] Idempotent.
- [ ] Redelivery policy dipahami.
- [ ] Poison message handling tersedia.
- [ ] MDB concurrency tidak menghabiskan JDBC pool.
- [ ] Message ordering requirement eksplisit.
- [ ] Transaction boundary diuji.

### 19.6 Timer

- [ ] Callback idempotent.
- [ ] Persistent/non-persistent dipilih dengan alasan.
- [ ] Timer datasource sehat.
- [ ] Job punya checkpoint.
- [ ] Duplicate execution aman.
- [ ] Long job tidak berada dalam satu transaction besar.

### 19.7 Remote EJB

- [ ] Remote DTO stabil dan serializable.
- [ ] Timeout eksplisit.
- [ ] Version compatibility strategy ada.
- [ ] Network/security/IIOP port terdokumentasi.
- [ ] Tidak chatty.
- [ ] Migration path dipikirkan.

---

## 20. Contoh Diagnostic Scenario

### Scenario

Aplikasi case management berbasis EAR mengalami timeout saat officer approve case. Endpoint HTTP memanggil:

```text
CaseResource
  → CaseApprovalEJB
  → AuditEJB
  → NotificationMDB/JMS
  → Oracle DB
```

Symptom:

- HTTP 504 dari reverse proxy.
- GlassFish CPU rendah.
- JDBC pool in-use penuh.
- EJB pool CaseApprovalEJB penuh.
- Thread dump banyak di `oracle.jdbc.driver`.
- Beberapa transaction timeout.
- JMS message redelivery naik.

### Analisis Dangkal

```text
EJB pool penuh, naikkan max-pool-size.
```

### Analisis Runtime yang Benar

EJB pool penuh adalah akibat, bukan sebab.

Kemungkinan chain:

```text
Oracle query/lock lambat
  ↓
EJB method memegang transaction lebih lama
  ↓
JDBC connection tertahan
  ↓
JDBC pool habis
  ↓
EJB invocation menunggu
  ↓
HTTP thread menunggu
  ↓
reverse proxy timeout
  ↓
transaction rollback
  ↓
JMS redelivery / duplicate notification risk
```

### Investigation Order

1. Ambil thread dump 3 kali dengan jarak 10–15 detik.
2. Cek JDBC pool wait/in-use metrics.
3. Cek DB active session, lock, slow SQL.
4. Cek EJB pool/cache metrics.
5. Cek transaction timeout log.
6. Cek JMS redelivery.
7. Korelasikan request ID / case ID / transaction timestamp.

### Fix yang Mungkin

- optimasi query/lock;
- kecilkan transaction scope;
- pisahkan audit/notification via outbox;
- set timeout yang konsisten;
- batasi EJB/MDB concurrency agar tidak menghancurkan DB;
- tambah idempotency untuk notification;
- jangan langsung menaikkan semua pool.

---

## 21. Heuristik Top 1% untuk EJB Runtime

### 21.1 Selalu Tanya: “Container Sedang Menjamin Apa?”

EJB container bisa menjamin:

- lifecycle;
- transaction;
- security;
- pooling;
- caching;
- timer retry;
- JMS delivery integration;
- remote invocation.

Tetapi tiap guarantee punya cost.

### 21.2 Pool Adalah Backpressure Boundary

Pool bukan hanya performance optimization. Pool adalah batas concurrency.

Jika semua pool dibuat unbounded, Anda kehilangan backpressure.

### 21.3 Stateful State Harus Dapat Dipertanggungjawabkan

Jika state penting untuk audit/regulatory/business correctness, state itu harus eksplisit, durable, dan inspectable. Stateful bean memory bukan tempat ideal untuk state defensible.

### 21.4 Timer dan MDB Harus Idempotent

Timer retry dan message redelivery berarti duplicate execution adalah realitas. Exactly-once biasanya ilusi. Desainlah idempotency.

### 21.5 Remote EJB adalah Distributed System

Perlakukan remote EJB seperti API remote, bukan method call.

### 21.6 Transaction Boundary Harus Terlihat

Jika transaction boundary hanya “default EJB behavior”, sistem menjadi sulit dianalisis. Method penting harus punya transaction semantics eksplisit.

### 21.7 Jangan Tuning dari Gejala Pertama

EJB pool penuh, HTTP thread penuh, JDBC pool penuh, dan JMS backlog sering merupakan gejala dari satu bottleneck yang sama. Cari queue paling awal yang mulai penuh.

---

## 22. Mini Lab: Observing EJB Pool and Timer Behavior

### 22.1 Stateless Pool Lab

Buat bean:

```java
@Stateless
public class SlowService {
    public String work() {
        try {
            Thread.sleep(500);
            return "ok";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EJBException(e);
        }
    }
}
```

Tambahkan endpoint yang memanggil `work()`.

Uji dengan load:

```bash
ab -n 1000 -c 50 http://localhost:8080/app/api/slow
```

Observasi:

```bash
asadmin get "*ejb*"
asadmin get "*bean-pool*"
jcmd <pid> Thread.print
```

Pertanyaan:

```text
Apakah bottleneck di EJB pool, HTTP thread, atau downstream sleep?
Bagaimana latency berubah jika concurrency dinaikkan?
Apa yang terjadi jika max-pool-size terlalu kecil?
```

### 22.2 Stateful Passivation Lab

Buat stateful bean dengan field non-serializable, lalu paksa idle/passivation.

Expected:

```text
Passivation error / NotSerializableException
```

Tujuan bukan membuat app bagus, tapi memahami bagaimana error muncul.

### 22.3 Timer Idempotency Lab

Buat timer callback yang sengaja throw exception pada attempt pertama.

Observasi:

- apakah redelivery terjadi;
- apakah callback double-run;
- apakah side effect duplicate;
- bagaimana log mencatat attempt.

---

## 23. Ringkasan

EJB container di GlassFish adalah salah satu subsystem paling “enterprise” karena ia menggabungkan banyak concern:

```text
object lifecycle
+ pooling/cache/passivation
+ transaction
+ security
+ remote invocation
+ timer
+ messaging
+ monitoring
```

Untuk engineer biasa, EJB adalah annotation.

Untuk engineer top-level, EJB adalah runtime contract dan failure boundary.

Hal yang harus diingat:

1. Stateless bean = pool dan transaction boundary.
2. Stateful bean = cache, passivation, dan conversational state risk.
3. Singleton bean = shared state dan lock policy.
4. MDB = JMS delivery + transaction + redelivery.
5. Timer = scheduler + persistence + retry semantics.
6. Remote EJB = distributed system, bukan local call.
7. ORB/IIOP = legacy surface yang harus dipahami jika masih aktif.
8. Pool tuning harus mengikuti bottleneck analysis.
9. Transaction semantics harus eksplisit.
10. Modernisasi EJB harus preserve implicit guarantees yang sebelumnya diberikan container.

---

## 24. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

- Eclipse GlassFish Application Development Guide — bagian Enterprise JavaBeans dan EJB Timer Service.
- Eclipse GlassFish Performance Tuning Guide — bagian EJB container tuning, pooling, caching, monitoring.
- Eclipse GlassFish Reference Manual — command `asadmin`, monitoring, deployment, dan administrative reference.
- Jakarta Enterprise Beans specification — semantics EJB modern.
- Jakarta Transactions specification — transaction actor, JTA/XA semantics.
- Eclipse OpenMQ documentation — konteks MDB/JMS runtime.

Catatan penting dari dokumentasi resmi GlassFish:

- GlassFish EJB container melakukan pooling untuk anonymous instances seperti stateless session bean dan message-driven bean untuk mengurangi overhead create/destroy.
- Pool settings relevan untuk stateless session bean, sedangkan cache settings relevan untuk stateful session bean.
- EJB Timer Service dapat memakai Timer DataSource seperti `jdbc/__TimerPool`; perubahan datasource timer memerlukan perhatian pada table timer dan restart.
- Timer redelivery memiliki setting seperti maximum redeliveries dan redelivery interval.
- Monitoring EJB dapat digunakan untuk melihat statistik pool/cache jika monitoring diaktifkan.

---

## 25. Status Seri

Part ini adalah:

```text
Part 15 dari 35
```

Status:

```text
Belum selesai.
```

Part berikutnya:

```text
Part 16 — CDI/HK2 Boundary: Service Locator, Injection Runtime, dan Extension Point GlassFish
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-014.md">⬅️ Part 14 — JMS dan OpenMQ di GlassFish: Broker, Destination, MDB, Reliability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-016.md">Part 16 — CDI/HK2 Boundary: Service Locator, Injection Runtime, dan Extension Point GlassFish ➡️</a>
</div>
