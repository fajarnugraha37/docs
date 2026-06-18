# learn-java-json-xml-soap-connectors-enterprise-integration-part-031

# Part 31 — Jakarta Connectors / JCA Mental Model

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Bagian: `31 / 34`  
> Topik: Jakarta Connectors / Java Connector Architecture / JCA Mental Model  
> Target: Java 8 sampai Java 25, Java EE `javax.resource` sampai Jakarta EE `jakarta.resource`

---

## 0. Tujuan Bagian Ini

Setelah mempelajari JSON, XML, JAXB, SOAP, WSDL, JAX-WS, WS-* dan pola modernisasi SOAP, sekarang kita masuk ke satu area enterprise Java yang jarang dipahami mendalam oleh developer modern: **Jakarta Connectors**, yang dulu dikenal sebagai **Java Connector Architecture / JCA**.

Bagian ini bukan bertujuan membuat kita langsung menulis resource adapter production-grade dari nol. Itu akan dibahas bertahap pada bagian berikutnya. Tujuan bagian ini adalah membangun **mental model**:

1. Apa masalah yang ingin diselesaikan oleh Jakarta Connectors.
2. Kenapa JCA berbeda dari sekadar “library client untuk konek ke sistem eksternal”.
3. Apa itu EIS, resource adapter, connection factory, managed connection, connection manager, transaction/security contract.
4. Kapan JCA masih relevan dan kapan tidak.
5. Bagaimana memikirkan JCA dalam konteks Java 8–25 dan `javax.resource` → `jakarta.resource`.
6. Bagaimana failure model JCA muncul di production: pool leak, stale connection, wrong credential subject, XA recovery, classloader, lifecycle, dan backpressure.

Dokumen ini harus dibaca sebagai **fondasi konseptual** untuk Part 32 dan Part 33:

- Part 32: inbound/outbound architecture, activation spec, work manager, lifecycle, deployment descriptor.
- Part 33: transaction, security, reliability, poison message, recovery, observability.

---

## 1. Kenapa Jakarta Connectors Ada?

Dalam aplikasi enterprise, sistem Java jarang berdiri sendiri. Ia harus terhubung ke:

- mainframe,
- ERP,
- transaction processing system,
- message broker,
- legacy queue,
- proprietary document management system,
- core banking,
- government registry,
- payment switch,
- insurance policy engine,
- identity repository,
- custom TCP protocol,
- file transfer gateway,
- resource manager yang mendukung XA transaction,
- sistem vendor yang bukan HTTP/REST.

Secara naif, developer bisa berkata:

> “Buat saja client library. Inject client-nya. Panggil method-nya.”

Itu cukup untuk kasus sederhana. Tetapi dalam application server enterprise, ada kebutuhan yang lebih berat:

1. **Connection pooling**  
   Jangan setiap request membuka physical connection baru ke EIS.

2. **Transaction enlistment**  
   Kalau request melakukan update database dan EIS dalam satu unit-of-work, siapa yang mengkoordinasikan commit/rollback?

3. **Security credential propagation**  
   Credential siapa yang dipakai untuk konek ke EIS? Application credential, container credential, caller identity, atau mapped subject?

4. **Lifecycle management**  
   Siapa yang start/stop adapter? Siapa yang menutup resource saat undeploy/redeploy?

5. **Inbound messaging**  
   Bagaimana kalau EIS yang memanggil aplikasi Java secara asynchronous?

6. **Thread management**  
   Bolehkah adapter membuat thread sendiri? Dalam container-managed runtime, sembarang thread bisa merusak transaction/security/classloader context.

7. **Recovery**  
   Kalau server crash setelah prepare tapi sebelum commit, siapa yang melakukan XA recovery?

8. **Portability across application servers**  
   Vendor EIS ingin menyediakan satu integration package yang bisa dipakai di WebLogic, WebSphere/Liberty, WildFly, Payara, GlassFish, Open Liberty, dan server kompatibel lain.

Jakarta Connectors menjawab masalah tersebut dengan mendefinisikan **standard architecture** untuk menghubungkan Jakarta EE application components ke **Enterprise Information Systems / EIS**. Spesifikasi Jakarta Connectors mendefinisikan kontrak standar antara application server dan resource adapter, termasuk connection management, transaction management, security, lifecycle, work management, transaction inflow, dan message inflow.

Referensi resmi Jakarta menyatakan bahwa Jakarta Connectors mendefinisikan arsitektur standar bagi komponen aplikasi Jakarta EE untuk terhubung ke Enterprise Information Systems. Versi 2.1 adalah release untuk Jakarta EE 10, sementara versi 3.0 sedang diarahkan untuk Jakarta EE 12.

---

## 2. Definisi Mental Model: JCA Bukan Client Library

Perbedaan utama:

```text
Plain Client Library
--------------------
Application code owns:
- connection creation
- connection close
- retry behavior
- credential handling
- thread behavior
- transaction boundary
- lifecycle
- recovery behavior
- pooling behavior

Jakarta Connector Resource Adapter
----------------------------------
Container + Resource Adapter share responsibility:
- application asks for logical connection
- container manages pooling
- adapter knows physical EIS protocol
- container can enlist connection into transaction
- container can apply security mapping
- container controls lifecycle
- adapter can deliver inbound work through container contract
- recovery can be coordinated by transaction manager
```

JCA bukan sekadar API koneksi. JCA adalah **kontrak system-level** antara:

- **Application component**: EJB, servlet, CDI bean, MDB, atau komponen Jakarta EE lain.
- **Application server / container**: runtime yang mengelola pooling, transaction, security, lifecycle, work manager.
- **Resource adapter**: integration component yang memahami protokol EIS.
- **EIS**: sistem enterprise eksternal.

Kalau REST client biasa adalah “aplikasi memanggil sistem eksternal”, maka JCA adalah “container dan adapter bekerja sama agar integrasi eksternal menjadi managed resource”.

---

## 3. Vocabulary Inti

Sebelum masuk diagram, kita kunci istilah.

### 3.1 EIS — Enterprise Information System

**EIS** adalah target eksternal yang diintegrasikan.

Contoh:

- ERP seperti SAP.
- Mainframe transaction processing.
- Banking core system.
- Legacy queue.
- Proprietary messaging system.
- Document archive system.
- Insurance claim engine.
- Payment switch.
- CICS transaction gateway.
- Vendor system yang punya custom protocol.

Dalam JCA, EIS bukan harus database. Database biasanya diakses via JDBC, tetapi secara konseptual JDBC juga adalah managed resource dengan pooling/transaction. JCA menyediakan model umum untuk resource non-JDBC.

### 3.2 Resource Adapter / RA

**Resource adapter** adalah komponen deployable yang mengimplementasikan kontrak JCA.

Biasanya dikemas sebagai:

```text
*.rar  (Resource Adapter Archive)
```

Isi RAR dapat mencakup:

- class implementasi adapter,
- deployment descriptor `ra.xml`,
- metadata konfigurasi,
- dependency library,
- native/protocol client library,
- outbound connection classes,
- inbound activation classes,
- message listener types.

Resource adapter adalah “driver enterprise” untuk EIS, tetapi lebih dari driver karena ia bernegosiasi dengan container untuk transaction, security, lifecycle, pooling, dan inbound delivery.

### 3.3 ConnectionFactory

**ConnectionFactory** adalah object yang dilihat aplikasi.

Aplikasi biasanya tidak langsung membuat physical connection. Aplikasi melakukan lookup/injection terhadap connection factory, lalu meminta logical connection.

Pseudo model:

```java
MyEisConnectionFactory factory = lookup("java:/eis/MySystem");
try (MyEisConnection conn = factory.getConnection()) {
    conn.executeSomething(...);
}
```

Dari sisi aplikasi, ini terlihat seperti client biasa. Tetapi di balik layar, request connection masuk ke container-managed connection manager dan pool.

### 3.4 Connection Handle

**Connection handle** adalah object yang diterima aplikasi sebagai “connection”.

Handle ini tidak selalu sama dengan physical socket/session ke EIS. Ia bisa berupa wrapper/logical object yang diasosiasikan dengan physical managed connection dari pool.

Analogi dengan JDBC:

```text
java.sql.Connection yang diterima aplikasi
    ≠ selalu physical TCP connection baru
```

Saat aplikasi memanggil `close()`, handle biasanya dikembalikan ke pool, bukan menutup socket fisik.

### 3.5 ManagedConnectionFactory / MCF

**ManagedConnectionFactory** adalah factory internal adapter untuk membuat dan mencocokkan `ManagedConnection`.

Perannya:

- membuat connection factory untuk aplikasi,
- membuat physical managed connection,
- mencocokkan request baru dengan managed connection yang sudah ada,
- membawa konfigurasi adapter seperti host, port, credential mode, client id, pool partitioning key.

Dokumentasi API menyatakan `ManagedConnectionFactory` adalah factory untuk `ManagedConnection` dan EIS-specific connection factory, serta mendukung connection pooling lewat creation/matching managed connection.

### 3.6 ManagedConnection

**ManagedConnection** merepresentasikan physical connection ke EIS.

Ia biasanya memiliki:

- physical socket/session/channel,
- protocol state,
- authentication state,
- transaction association,
- event listener ke container,
- cleanup/destroy operation,
- local transaction atau XA resource exposure.

Aplikasi jarang melihat `ManagedConnection` langsung. Ia adalah object SPI antara resource adapter dan container.

### 3.7 ConnectionManager

**ConnectionManager** biasanya disediakan application server.

Perannya:

- menerima request alokasi koneksi dari connection factory,
- mencari matching pooled connection,
- membuat connection baru jika perlu,
- mengasosiasikan connection dengan transaction/security context,
- mengembalikan connection ke pool,
- memvalidasi/destroy connection yang rusak.

Dalam managed environment, container-provided `ConnectionManager` adalah pusat pooling dan enlistment.

### 3.8 ResourceAdapter

`ResourceAdapter` adalah lifecycle root dari adapter.

Dalam API `jakarta.resource.spi`, `ResourceAdapter` merepresentasikan instance resource adapter dan berisi operasi lifecycle management dan message endpoint setup.

Peran konseptual:

- start adapter,
- stop adapter,
- receive `BootstrapContext`,
- endpoint activation/deactivation,
- XA recovery support,
- koordinasi inbound delivery.

### 3.9 BootstrapContext

`BootstrapContext` diberikan container saat resource adapter start.

Ia memberi akses ke service container seperti:

- `WorkManager`,
- `XATerminator`,
- timer context.

Ini penting karena adapter tidak boleh sembarang membuat thread sendiri tanpa sadar container context. Adapter seharusnya menggunakan mekanisme container untuk menjalankan work.

### 3.10 WorkManager

**WorkManager** adalah abstraction untuk menjalankan unit of work adapter di bawah kontrol container.

Ini terutama penting untuk inbound resource adapter:

- adapter menerima event dari EIS,
- adapter perlu menjalankan processing asynchronous,
- adapter meminta container mengeksekusi work,
- container bisa mengelola thread, lifecycle, context, dan policy.

### 3.11 ActivationSpec

**ActivationSpec** adalah konfigurasi inbound endpoint.

Contoh konsep:

```text
Listen to queue: CLAIM.EVENTS
Consumer group: aceas-case-sync
Selector: eventType = 'CASE_UPDATED'
Max sessions: 10
Durable: true
```

Dalam JCA, inbound adapter menggunakan activation spec untuk mengetahui endpoint apa yang harus diaktifkan.

### 3.12 MessageEndpointFactory

`MessageEndpointFactory` digunakan container untuk menyediakan endpoint object yang akan dipanggil resource adapter saat ada inbound event/message.

Dalam konteks messaging, endpoint ini sering diasosiasikan dengan MDB atau message listener contract.

---

## 4. Arsitektur Besar

### 4.1 Outbound Flow

Outbound berarti aplikasi Java memanggil EIS.

```text
+--------------------------+
| Application Component    |
| Servlet / EJB / CDI      |
+------------+-------------+
             |
             | getConnection()
             v
+--------------------------+
| ConnectionFactory        |  <-- adapter-provided application-facing API
+------------+-------------+
             |
             | allocateConnection(...)
             v
+--------------------------+
| ConnectionManager        |  <-- container-provided
| - pool lookup            |
| - transaction enlistment |
| - security mapping       |
+------------+-------------+
             |
             | create/match
             v
+--------------------------+
| ManagedConnectionFactory |  <-- adapter SPI
+------------+-------------+
             |
             | create physical connection
             v
+--------------------------+
| ManagedConnection        |  <-- physical EIS connection/session
+------------+-------------+
             |
             v
+--------------------------+
| EIS                      |
+--------------------------+
```

Core idea:

> Application meminta logical connection. Container menentukan apakah request tersebut bisa memakai existing managed connection dari pool, harus membuat baru, atau harus diasosiasikan dengan transaction/security context tertentu.

### 4.2 Inbound Flow

Inbound berarti EIS mengirim event/message ke aplikasi Java.

```text
+--------------------------+
| EIS                      |
| queue / event / callback |
+------------+-------------+
             |
             | inbound event
             v
+--------------------------+
| Resource Adapter         |
| - listener protocol      |
| - polling/subscription   |
+------------+-------------+
             |
             | schedule Work
             v
+--------------------------+
| WorkManager              |  <-- container-managed execution
+------------+-------------+
             |
             | obtain endpoint
             v
+--------------------------+
| MessageEndpointFactory   |
+------------+-------------+
             |
             v
+--------------------------+
| Message Endpoint         |
| MDB / listener endpoint  |
+--------------------------+
```

Core idea:

> Resource adapter tidak sekadar membuat thread dan memanggil object aplikasi. Ia harus menyerahkan eksekusi ke container contract agar lifecycle, transaction, security, dan concurrency tetap managed.

---

## 5. Kontrak System-Level dalam JCA

Jakarta Connectors penting karena ia bukan hanya interface koneksi. Ia mendefinisikan beberapa **system contracts**.

### 5.1 Connection Management Contract

Tujuan:

- connection pooling,
- connection reuse,
- logical vs physical connection separation,
- cleanup saat logical handle closed,
- validation/destroy saat connection rusak,
- matching connection berdasarkan credential/config/context.

Tanpa kontrak ini, setiap aplikasi/vendor membuat pooling sendiri. Akibatnya:

- pool tidak konsisten,
- monitoring sulit,
- transaction integration sulit,
- credential handling rawan,
- lifecycle saat redeploy rawan leak.

### 5.2 Transaction Management Contract

Tujuan:

- local transaction support,
- XA transaction support,
- enlistment dengan transaction manager,
- commit/rollback coordination,
- crash recovery.

JCA adapter dapat expose:

- `LocalTransaction` untuk transaction yang dikelola EIS secara lokal.
- `XAResource` untuk distributed transaction.

Mental model:

```text
Local Transaction
-----------------
Only EIS resource transaction is coordinated.
Good for single resource operation.
Simpler but cannot atomically coordinate DB + EIS.

XA Transaction
--------------
Transaction manager coordinates multiple resources.
Can involve DB + JMS/EIS.
More powerful but more complex and failure-prone.
```

### 5.3 Security Management Contract

Tujuan:

- credential mapping,
- container-managed sign-on,
- application-managed sign-on,
- subject-based matching,
- avoiding hardcoded credentials in application code,
- consistent authentication to EIS.

Security JCA bukan hanya “username/password”. Ia menyangkut pertanyaan:

- Apakah semua user aplikasi memakai satu technical account ke EIS?
- Apakah identity caller dipropagasikan?
- Apakah role user di-map ke EIS credential berbeda?
- Apakah connection pool dipartisi per credential?
- Apakah connection untuk credential A boleh dipakai credential B? Harus tidak.

### 5.4 Lifecycle Management Contract

Tujuan:

- container memulai adapter,
- container menghentikan adapter,
- adapter release resource saat undeploy,
- inbound endpoint activate/deactivate,
- crash/restart behavior jelas.

Ini penting karena resource adapter sering membuka:

- socket persistent,
- background listener,
- poller,
- subscription,
- native handle,
- file lock,
- JMS session,
- thread/work.

Tanpa lifecycle contract, redeploy bisa meninggalkan zombie connection/thread.

### 5.5 Work Management Contract

Tujuan:

- adapter dapat menjalankan background work melalui container,
- container tetap mengontrol thread usage,
- work bisa mengikuti policy runtime,
- mencegah unmanaged thread chaos.

Kesalahan umum developer:

```java
new Thread(() -> pollForever()).start();
```

Dalam container enterprise, ini rawan:

- thread tidak stop saat undeploy,
- classloader leak,
- security context hilang,
- transaction context salah,
- monitoring tidak melihat thread,
- resource tidak dikontrol.

JCA menyediakan WorkManager agar adapter dapat bekerja dalam boundary container.

### 5.6 Message Inflow Contract

Tujuan:

- EIS dapat mengirim message/event ke endpoint aplikasi,
- endpoint lifecycle dikelola container,
- resource adapter tidak perlu tahu implementasi endpoint secara langsung,
- delivery dapat diasosiasikan dengan transaction.

Ini menjadikan JCA sebagai plugin mechanism untuk provider messaging selain JMS built-in.

### 5.7 Transaction Inflow Contract

Tujuan:

- EIS dapat mengimpor transaction context ke application server,
- resource adapter dapat mengkoordinasikan completion/recovery,
- ACID property imported transaction dapat dijaga.

Ini advanced, biasanya relevan untuk mainframe/TP monitor/enterprise transaction system.

---

## 6. JCA vs JDBC vs JMS vs REST Client

### 6.1 JCA vs JDBC

JDBC adalah API database. Banyak application server mengelola JDBC datasource dengan pooling dan transaction enlistment.

JCA adalah arsitektur umum untuk EIS. Secara mental, JCA ingin memberi model “datasource-like” untuk sistem non-database.

```text
JDBC DataSource
---------------
Application -> DataSource -> Connection -> Database
Container handles pool/transaction/security

JCA ConnectionFactory
---------------------
Application -> ConnectionFactory -> Connection Handle -> EIS
Container handles pool/transaction/security through RA SPI
```

### 6.2 JCA vs JMS

JMS/Jakarta Messaging adalah API messaging. Banyak JMS provider menyediakan JCA resource adapter agar messaging provider dapat plug into application server dengan MDB, pooling, transaction, inbound delivery.

```text
Jakarta Messaging = messaging API
Jakarta Connectors = integration architecture/resource adapter contract
```

Beberapa JMS provider memakai JCA RA di application server untuk menghubungkan broker ke MDB dan managed connection factories.

### 6.3 JCA vs REST Client

REST client modern biasanya:

- HTTP based,
- stateless atau semi-stateless,
- connection pooling di HTTP client,
- transaction distributed jarang,
- security via token/mTLS/basic,
- lifecycle diatur aplikasi/framework.

JCA lebih cocok saat:

- protokol stateful,
- EIS proprietary,
- perlu container-managed transaction/security,
- inbound message endpoint,
- vendor ingin menyediakan portable adapter,
- resource perlu recovery/enlistment.

Untuk kebanyakan HTTP integration modern, JCA terlalu berat.

### 6.4 JCA vs Custom Spring Bean Client

Spring bean client cocok untuk microservice integration modern:

```java
@Component
class PaymentClient {
    private final WebClient webClient;
}
```

Tetapi Spring bean client tidak otomatis menyediakan:

- standard RA packaging,
- app-server-managed inbound message endpoint,
- XA recovery contract,
- ManagedConnection matching,
- EIS credential mapping oleh container,
- portable deployment as RAR.

JCA relevan jika integration layer harus menjadi **container-managed resource**.

---

## 7. Layering: Siapa Bertanggung Jawab atas Apa?

### 7.1 Application Code

Application code bertanggung jawab untuk:

- lookup/inject connection factory,
- meminta logical connection,
- menggunakan connection sesuai API,
- menutup logical handle,
- tidak menyimpan connection handle terlalu lama,
- tidak melakukan retry buta di atas transaction boundary,
- memahami idempotency operation.

Application code **tidak seharusnya**:

- membuat physical connection langsung,
- mengelola pool sendiri,
- menyimpan credential EIS mentah jika container-managed,
- memulai unmanaged thread untuk adapter,
- memanggil internal SPI seperti `ManagedConnection`.

### 7.2 Resource Adapter

Resource adapter bertanggung jawab untuk:

- implementasi protokol EIS,
- membuat physical connection,
- expose connection factory/connection handle,
- implementasi matching/cleanup/destroy,
- expose local/XA transaction jika didukung,
- handle inbound subscription/polling,
- lifecycle start/stop,
- report connection event ke container,
- translate error EIS ke `ResourceException` atau exception domain adapter,
- mendukung metadata dan konfigurasi.

### 7.3 Application Server / Container

Container bertanggung jawab untuk:

- menyediakan `ConnectionManager`,
- pooling,
- transaction enlistment,
- security context/mapping,
- lifecycle deployment,
- WorkManager,
- endpoint activation,
- recovery orchestration,
- metrics/configuration integration,
- JNDI binding.

### 7.4 EIS

EIS bertanggung jawab untuk:

- protocol behavior,
- authentication/authorization,
- transaction semantics yang ia dukung,
- message/event semantics,
- recovery compatibility,
- error code semantics.

---

## 8. Logical Connection vs Physical Connection

Ini konsep paling penting dalam JCA.

### 8.1 Physical Connection

Physical connection adalah resource nyata:

- TCP socket,
- session ke mainframe,
- proprietary channel,
- authenticated protocol session,
- broker connection,
- native handle.

Physical connection mahal:

- butuh handshake,
- butuh authentication,
- memakai memory/socket/file descriptor,
- mungkin dibatasi license,
- mungkin punya server-side session state.

### 8.2 Logical Connection

Logical connection adalah handle yang diberikan ke aplikasi.

Aplikasi boleh menganggapnya “connection”, tetapi container/adapter dapat:

- mengambil physical connection dari pool,
- mengasosiasikan handle ke physical connection,
- melepaskan association saat close,
- mengembalikan physical connection ke pool.

### 8.3 Kenapa Separation Ini Penting?

Karena aplikasi bisa menulis pola sederhana:

```java
try (EisConnection conn = factory.getConnection()) {
    conn.submitCase(caseData);
}
```

Sementara runtime tetap efisien:

```text
getConnection() -> borrow physical connection from pool
close()         -> return physical connection to pool
```

### 8.4 Failure yang Sering Terjadi

| Failure | Penyebab | Dampak |
|---|---|---|
| Connection leak | Application tidak close handle | Pool habis, request block/time out |
| Stale connection | EIS menutup socket idle | First request gagal setelah idle lama |
| Credential contamination | Pool tidak dipartisi benar per subject | User A memakai session User B |
| Dirty session state | Cleanup tidak reset state | Request berikutnya inherit state lama |
| Invalid matching | `matchManagedConnections` salah | Wrong connection reused |
| Destroy tidak lengkap | Native/socket tidak ditutup | file descriptor/thread leak |

---

## 9. ManagedConnection Matching

`ManagedConnectionFactory` biasanya memiliki method untuk mencocokkan request koneksi dengan pooled connection yang tersedia.

Mental model:

```text
Request wants:
- EIS endpoint A
- credential/subject X
- connection request info R
- transaction/security context C

Pool contains:
- ManagedConnection #1: endpoint A, subject X, state clean
- ManagedConnection #2: endpoint A, subject Y, state clean
- ManagedConnection #3: endpoint B, subject X, state clean

Only #1 is safe match.
```

Matching harus mempertimbangkan:

- host/port/environment,
- application name/client id,
- credential subject,
- connection request info,
- protocol mode,
- transaction capability,
- clean/dirty state,
- health status.

Top 1% engineer tidak menganggap pool hanya “list connection”. Pool adalah **set of reusable physical sessions with compatibility constraints**.

---

## 10. Transaction Mental Model

### 10.1 Tanpa Transaction Management

```text
1. Update database status = SENT
2. Send command to EIS
3. EIS timeout
```

Pertanyaan:

- Apakah DB harus rollback?
- Apakah EIS sebenarnya menerima command?
- Apakah retry aman?
- Apakah operation idempotent?

Tanpa transaction semantics, aplikasi harus mendesain compensation/idempotency sendiri.

### 10.2 Local Transaction

Local transaction hanya di satu EIS.

```text
begin local transaction on EIS
  execute operation A
  execute operation B
commit local transaction
```

Cocok jika hanya EIS tersebut yang dimodifikasi.

Tidak cukup untuk atomicity dengan database aplikasi.

### 10.3 XA Transaction

XA transaction memungkinkan transaction manager mengkoordinasikan beberapa resource:

```text
Global TX
  DB update
  EIS operation through XAResource
prepare all
commit all
```

Keuntungan:

- atomic commit across resources secara teoritis.

Biaya:

- kompleks,
- lebih lambat,
- recovery perlu benar,
- heuristic outcome mungkin terjadi,
- debugging sulit,
- tidak semua EIS benar-benar robust XA.

### 10.4 Top 1% View tentang XA

XA bukan silver bullet. XA adalah tool untuk kasus tertentu.

Di banyak sistem modern, kita lebih sering memilih:

- outbox pattern,
- saga/compensation,
- idempotent command,
- retry with deduplication,
- event-driven consistency,
- explicit reconciliation.

Tetapi di enterprise legacy, XA masih bisa wajib karena:

- regulatory atomicity,
- vendor contract,
- mainframe transaction integration,
- existing app-server architecture,
- MDB + transactional receive/send.

JCA membuat XA secara teknis mungkin melalui `ManagedConnection.getXAResource()`.

---

## 11. Security Mental Model

### 11.1 Application-Managed Sign-On

Aplikasi memberikan credential secara eksplisit:

```java
factory.getConnection("user", "password");
```

Kelebihan:

- eksplisit,
- mudah dipahami.

Kekurangan:

- credential handling di aplikasi,
- rawan secret leak,
- pooling harus hati-hati per credential,
- audit/security mapping tersebar.

### 11.2 Container-Managed Sign-On

Container melakukan mapping credential berdasarkan config/security context.

Aplikasi cukup:

```java
factory.getConnection();
```

Container menentukan credential ke EIS.

Kelebihan:

- secret lebih terpusat,
- bisa pakai security domain/credential store,
- lebih konsisten.

Kekurangan:

- konfigurasi server-specific,
- debugging credential mapping lebih sulit,
- portability detail berbeda antar server.

### 11.3 Credential Mapping Patterns

| Pattern | Deskripsi | Risiko |
|---|---|---|
| Technical account | Semua request pakai satu account EIS | Audit per-user hilang kecuali dikirim eksplisit |
| Per-role account | Role aplikasi di-map ke account EIS | Mapping complexity |
| Per-user propagation | Identity user dipropagasikan | Pool fragmentation, credential lifecycle |
| Token exchange | Container/app exchange token ke EIS token | Expiry/refresh complexity |

### 11.4 Security Failure Mode

| Failure | Contoh |
|---|---|
| Credential reused incorrectly | Pooled connection user A dipakai user B |
| Credential not refreshed | Long-lived physical connection memakai expired token |
| Secret in logs | Adapter log connection request info berisi password |
| Overprivileged technical account | Semua operation bisa dilakukan walau caller tidak berhak |
| Weak subject matching | `Subject` tidak ikut matching pool |
| Missing audit propagation | EIS hanya melihat technical user, tidak tahu actor asli |

---

## 12. Resource Adapter sebagai Anti-Corruption Layer

Resource adapter sering menjadi tempat terbaik untuk menyembunyikan kompleksitas EIS.

Namun ada dua gaya desain.

### 12.1 Thin Adapter

Adapter hanya expose protokol low-level.

```java
conn.sendRawCommand("UPDCASE|123|APPROVED");
```

Kelebihan:

- fleksibel,
- sedikit mapping.

Kekurangan:

- aplikasi bocor detail EIS,
- banyak duplikasi parsing,
- error handling tersebar,
- kontrak domain tidak jelas.

### 12.2 Domain-Oriented Adapter

Adapter expose operation bermakna.

```java
conn.approveCase(new ApproveCaseCommand(caseId, officerId, reason));
```

Kelebihan:

- application code lebih bersih,
- protocol detail tersembunyi,
- error mapping konsisten,
- validasi boundary lebih kuat.

Kekurangan:

- adapter lebih opinionated,
- versioning adapter lebih berat,
- risiko memasukkan business logic terlalu banyak ke RA.

### 12.3 Rekomendasi

Untuk enterprise integration, gunakan adapter sebagai **technical anti-corruption layer**, bukan tempat business workflow.

Adapter boleh tahu:

- protocol,
- message shape,
- EIS error code,
- retryability,
- transaction capability,
- credential semantics,
- conversion dari EIS DTO ke Java boundary DTO.

Adapter sebaiknya tidak menjadi:

- orchestrator bisnis utama,
- workflow engine,
- policy authorization utama,
- tempat rules domain yang sering berubah.

---

## 13. Packaging dan Deployment Mental Model

### 13.1 RAR

Resource adapter biasanya dikemas sebagai RAR:

```text
my-eis-adapter.rar
├── META-INF/ra.xml
├── com/vendor/eis/adapter/*.class
├── com/vendor/eis/client/*.class
└── dependency jars
```

`ra.xml` mendeskripsikan:

- adapter class,
- outbound connection definitions,
- inbound message listeners,
- admin objects,
- config properties,
- transaction support,
- authentication mechanisms.

### 13.2 Deployment Scope

Resource adapter bisa dideploy:

1. **Standalone ke server**  
   RA tersedia untuk banyak aplikasi.

2. **Embedded dalam EAR**  
   RA khusus untuk aplikasi tertentu.

3. **Server-specific configured adapter**  
   RAR dideploy lalu connection factory/admin object dikonfigurasi via server config.

### 13.3 Java 8–25 Concern

| Era | Package | Catatan |
|---|---|---|
| Java EE 7/8 | `javax.resource.*` | Umum di app server lama, Java 8 legacy enterprise |
| Jakarta EE 9+ | `jakarta.resource.*` | Namespace berubah dari `javax` ke `jakarta` |
| Jakarta Connectors 2.1 | `jakarta.resource.*` | Jakarta EE 10 era, Java SE 11 baseline untuk platform |
| Jakarta Connectors 3.0 | `jakarta.resource.*` | Under development untuk Jakarta EE 12 |

Java 11+ tidak menghapus JCA dari JDK karena JCA bukan bagian JDK standard module seperti JAXB/JAX-WS dulu. JCA selalu bergantung pada application server / Jakarta EE API. Namun migration `javax.resource` → `jakarta.resource` tetap signifikan karena binary/source compatibility berubah.

---

## 14. Kapan Menggunakan JCA?

### 14.1 Gunakan JCA Jika

Gunakan JCA jika banyak kondisi berikut benar:

1. Integrasi ke EIS proprietary/legacy.
2. Connection stateful dan mahal.
3. Perlu container-managed pooling.
4. Perlu integration dengan transaction manager.
5. Perlu XA/local transaction formal.
6. Perlu inbound message/event endpoint.
7. Adapter akan dipakai di beberapa aplikasi/server.
8. Vendor menyediakan RAR resmi.
9. Security credential harus dikelola container.
10. Runtime target adalah full/profile Jakarta EE server yang mendukung connectors.

Contoh kuat:

```text
Aplikasi Jakarta EE on WildFly/Open Liberty/Payara perlu integrasi ke mainframe transaction gateway dengan pooling, credential mapping, dan XA recovery.
```

### 14.2 Jangan Gunakan JCA Jika

Jangan gunakan JCA jika:

1. Integrasi hanya HTTP REST biasa.
2. Aplikasi berjalan di Spring Boot embedded tanpa Jakarta EE connector container.
3. Tidak butuh XA/inbound/container-managed lifecycle.
4. Client library sudah punya pooling dan observability cukup.
5. Tim tidak punya kemampuan operasional app server/JCA.
6. Deployment RAR menyulitkan platform Kubernetes modern.
7. Sistem lebih cocok dengan async messaging/outbox.

Contoh:

```text
Microservice Spring Boot memanggil external REST API dengan OAuth2 client credentials.
```

Gunakan HTTP client/WebClient/Feign/MicroProfile Rest Client, bukan JCA.

---

## 15. JCA dalam Dunia Modern: Masih Relevan?

Jawaban realistis:

> JCA bukan mainstream untuk greenfield microservices, tetapi masih sangat relevan di enterprise Java yang berinteraksi dengan EIS legacy, mainframe, messaging provider, dan application server-managed systems.

### 15.1 Kenapa Terlihat Jarang?

Karena banyak developer modern bekerja di:

- Spring Boot,
- Quarkus standalone,
- Micronaut,
- REST/GraphQL APIs,
- Kafka/RabbitMQ client direct,
- Kubernetes sidecar/gateway pattern.

Di dunia itu, JCA terlihat berat.

### 15.2 Kenapa Masih Ada?

Karena enterprise reality masih memiliki:

- mainframe,
- CICS/IMS,
- ERP adapters,
- IBM MQ resource adapters,
- legacy JMS providers,
- transaction monitors,
- regulated systems requiring managed integration,
- application servers yang sudah menjadi platform operasi.

### 15.3 Top 1% Engineer View

Top engineer tidak fanatik “modern” atau “legacy”. Ia bertanya:

1. Apa contract yang harus dijaga?
2. Siapa yang mengelola transaction?
3. Siapa yang mengelola connection lifecycle?
4. Siapa yang bertanggung jawab saat crash recovery?
5. Apa observability model-nya?
6. Apakah adapter membuat system safer atau justru menambah complexity?
7. Apakah operational team mampu mendukungnya?

---

## 16. Common Production Failure Models

### 16.1 Pool Exhaustion

Gejala:

```text
NoManagedConnectionsAvailableException
Timeout waiting for connection
Request threads stuck
Slow degradation under load
```

Penyebab:

- logical connection tidak ditutup,
- operation terlalu lama,
- pool terlalu kecil,
- EIS lambat,
- retry memperbanyak concurrent borrow,
- connection validation terlalu mahal,
- transaction menahan connection sampai commit.

Mitigasi:

- wajib `try-with-resources` untuk logical handle,
- timeout borrow jelas,
- metric active/idle/wait count,
- operation timeout,
- circuit breaker di atas boundary,
- pool sizing berbasis capacity EIS, bukan hanya traffic aplikasi.

### 16.2 Stale Physical Connections

Gejala:

- error pertama setelah idle,
- broken pipe,
- connection reset,
- protocol session invalid.

Penyebab:

- firewall idle timeout,
- EIS server restart,
- load balancer close idle socket,
- adapter tidak validate sebelum borrow,
- keepalive tidak sesuai.

Mitigasi:

- validation-on-match,
- idle eviction,
- heartbeat,
- retry hanya untuk safe/idempotent operation,
- destroy connection on fatal protocol error.

### 16.3 Dirty Session State

Gejala:

- request B melihat state request A,
- wrong tenant/user/context,
- strange authorization failure.

Penyebab:

- physical session punya mutable state,
- cleanup tidak reset state saat handle close,
- matching terlalu longgar,
- credential/context tidak dipisahkan.

Mitigasi:

- `cleanup()` harus reset state,
- pool partitioning by credential/tenant/mode,
- avoid stateful session if possible,
- integration test borrow-close-borrow state isolation.

### 16.4 XA Recovery Failure

Gejala:

- in-doubt transaction,
- duplicate commit,
- heuristic mixed outcome,
- transaction log warning saat restart,
- resource unavailable during recovery.

Penyebab:

- XAResource identity berubah,
- recovery credential salah,
- EIS tidak reachable saat recovery,
- adapter tidak implement recovery benar,
- transaction timeout terlalu pendek/panjang.

Mitigasi:

- recovery config eksplisit,
- stable resource manager identity,
- test crash during prepare/commit,
- monitor in-doubt transaction,
- documented manual recovery runbook.

### 16.5 Classloader Leak

Gejala:

- memory naik setelah redeploy,
- old application classes tetap referenced,
- thread masih hidup dari deployment lama.

Penyebab:

- adapter membuat unmanaged thread,
- static cache menyimpan app class,
- listener tidak deregister,
- native resource tidak release.

Mitigasi:

- gunakan WorkManager,
- stop lifecycle bersih,
- no static mutable global pointing to deployment classes,
- close all sockets/subscriptions,
- redeploy stress test.

### 16.6 Backpressure Failure

Gejala:

- inbound event menumpuk,
- WorkManager saturated,
- MDB backlog,
- EIS timeout,
- downstream DB overload.

Penyebab:

- adapter consume lebih cepat dari processing capacity,
- no max sessions,
- retry storm,
- poison message blocking queue,
- transaction timeout.

Mitigasi:

- bounded concurrency,
- activation spec max sessions,
- dead letter/poison strategy,
- retry with backoff,
- flow control to EIS if supported,
- metric queue lag/in-flight/error rate.

---

## 17. Observability Model untuk JCA

JCA integration harus diamati di beberapa layer.

### 17.1 Pool Metrics

Minimal:

- active connections,
- idle connections,
- max pool size,
- wait count,
- average wait time,
- borrow timeout count,
- destroyed connection count,
- validation failure count.

### 17.2 Operation Metrics

Minimal:

- operation name,
- success/failure count,
- latency percentiles,
- timeout count,
- retry count,
- EIS error code distribution,
- payload size distribution.

### 17.3 Transaction Metrics

Minimal:

- local transaction count,
- XA enlistment count,
- prepare/commit/rollback latency,
- rollback reason,
- in-doubt count,
- recovery attempt count,
- heuristic outcome count.

### 17.4 Security Metrics

Minimal:

- credential mapping failure,
- authentication failure to EIS,
- authorization failure from EIS,
- token expiry/refresh count if token-based,
- subject/credential pool partition count.

### 17.5 Lifecycle Metrics/Logs

Minimal logs:

```text
RA starting
RA started with config hash/version
Endpoint activated: name=..., concurrency=...
Connection pool initialized: min/max/validation
RA stopping
Endpoint deactivated
Outstanding work count
RA stopped
```

Jangan log secret, raw password, token, private key, atau full payload sensitif.

---

## 18. Design Heuristics

### 18.1 Treat EIS as a Resource Manager, Not Just Endpoint

Kalau EIS punya transaction, sessions, locks, stateful protocol, atau recovery semantics, ia adalah **resource manager**.

Jangan desain seperti HTTP stateless endpoint.

### 18.2 Pool Boundary Harus Sama dengan Compatibility Boundary

Kalau dua request tidak boleh berbagi physical session, mereka tidak boleh berada dalam partition pool yang sama.

Pool key harus mencakup:

- endpoint,
- credential/subject,
- protocol mode,
- tenant jika relevan,
- transaction capability jika relevan.

### 18.3 Close Logical Connection Cepat

Jangan simpan connection handle di field singleton.

Buruk:

```java
@ApplicationScoped
class EisService {
    private EisConnection conn; // dangerous
}
```

Lebih benar:

```java
class EisService {
    void submit(Command command) {
        try (EisConnection conn = factory.getConnection()) {
            conn.submit(command);
        }
    }
}
```

### 18.4 Jangan Campur Retry dengan Transaction secara Buta

Retry operation dalam global transaction bisa menghasilkan efek ganda jika EIS sebenarnya menerima request tetapi response timeout.

Gunakan:

- idempotency key,
- request correlation id,
- deduplication di EIS/adapter,
- safe retry classification,
- reconciliation.

### 18.5 Adapter Harus Memisahkan Error Protocol dan Error Bisnis

Contoh:

```text
Protocol/system errors:
- connection reset
- authentication failed
- transaction timeout
- EIS unavailable

Business/application errors:
- customer not found
- case already closed
- insufficient balance
- duplicate reference
```

Protocol error mungkin menyebabkan connection destroyed/retry. Business error biasanya tidak.

### 18.6 Resource Adapter API Harus Stabil

Jika adapter expose API ke aplikasi, API itu menjadi kontrak internal.

Hindari:

- expose raw vendor object,
- expose mutable protocol state,
- expose generated classes yang berubah setiap schema update tanpa governance,
- exception terlalu low-level.

---

## 19. Minimal Conceptual Example

Bagian ini bukan tutorial implementasi lengkap, tetapi contoh mental mapping.

### 19.1 Application-Facing API

```java
public interface CaseEisConnection extends AutoCloseable {
    SubmitResult submitCase(SubmitCaseCommand command) throws CaseEisException;

    @Override
    void close();
}
```

```java
public interface CaseEisConnectionFactory {
    CaseEisConnection getConnection() throws ResourceException;
}
```

Aplikasi melihat API sederhana.

### 19.2 Internal Adapter SPI

Di dalam adapter:

```text
CaseManagedConnectionFactory
    creates CaseManagedConnection
    creates CaseEisConnectionFactory
    matches pooled connections

CaseManagedConnection
    owns physical EIS session
    creates logical CaseEisConnection handle
    exposes LocalTransaction/XAResource if supported
    cleanup/destroy

CaseResourceAdapter
    lifecycle start/stop
    endpoint activation if inbound supported
```

### 19.3 Runtime Flow

```text
Application calls factory.getConnection()
  -> connection factory calls ConnectionManager.allocateConnection(...)
  -> container checks current transaction/security context
  -> container finds matching ManagedConnection or asks MCF to create one
  -> adapter returns logical connection handle
  -> application calls submitCase(...)
  -> handle delegates to ManagedConnection physical session
  -> application closes handle
  -> container returns ManagedConnection to pool after cleanup
```

---

## 20. Versioning: Java EE `javax.resource` ke Jakarta `jakarta.resource`

### 20.1 Namespace Break

Java EE/Jakarta EE 8 era:

```java
import javax.resource.ResourceException;
import javax.resource.spi.ManagedConnection;
```

Jakarta EE 9+ era:

```java
import jakarta.resource.ResourceException;
import jakarta.resource.spi.ManagedConnection;
```

Ini bukan sekadar rename package kecil. Dampaknya:

- binary incompatible,
- app server target harus sesuai,
- resource adapter lama `javax` tidak otomatis jalan di Jakarta EE 9+ server kecuali ada compatibility/transformer vendor,
- dependencies harus konsisten.

### 20.2 Migration Matrix

| Source Adapter | Target Server | Risiko |
|---|---|---|
| `javax.resource` RA | Java EE 8 / Jakarta EE 8 server | Normal |
| `javax.resource` RA | Jakarta EE 9+ server | Namespace mismatch |
| `jakarta.resource` RA | Jakarta EE 9/10/11 server | Normal jika spec supported |
| Mixed `javax` + `jakarta` | Any | Sangat rawan class conflict |

### 20.3 Java Version

JCA bukan API JDK biasa. Ia berasal dari Jakarta EE API/server. Maka perhatian utama bukan “apakah Java 17 punya JCA module”, tetapi:

- apakah application server mendukung Java version tersebut,
- apakah Jakarta Connectors version sesuai,
- apakah adapter binary compatible,
- apakah vendor EIS client library support Java version tersebut,
- apakah native library/protocol dependency support OS/JDK target.

---

## 21. JCA dan Kubernetes / Cloud-Native

JCA lahir dari era application server, tetapi bisa berjalan di server modern yang dideploy di container/Kubernetes.

Namun ada friction:

### 21.1 Stateful Long-Lived Connections

Kubernetes pod bisa restart/reschedule. RA harus siap:

- connection drop,
- endpoint reactivation,
- duplicate inbound delivery,
- graceful shutdown,
- readiness/liveness semantics.

### 21.2 Configuration

Server config untuk RA sering berada di:

- XML server config,
- CLI management model,
- admin console,
- environment substitution,
- mounted secret.

Dalam Kubernetes, config harus reproducible:

- ConfigMap,
- Secret,
- immutable image + external config,
- GitOps-managed server config.

### 21.3 Horizontal Scaling

Jika inbound adapter berjalan di banyak pod:

- apakah semua pod boleh consume dari EIS?
- apakah subscription durable per pod atau shared?
- apakah ordering perlu dijaga?
- apakah EIS membatasi session count?
- bagaimana distributed lock/partitioning dilakukan?

### 21.4 Shutdown

Pod termination harus:

- stop accepting new inbound work,
- finish/rollback in-flight transaction,
- release EIS session,
- unregister subscription,
- close physical connections.

Tanpa graceful shutdown, duplicate/partial processing meningkat.

---

## 22. Decision Matrix

Gunakan matrix ini saat menilai apakah JCA tepat.

| Pertanyaan | Jika Ya | Implikasi |
|---|---|---|
| Target adalah EIS legacy/proprietary? | Ya | JCA mungkin cocok |
| Perlu managed pooling oleh app server? | Ya | JCA kuat |
| Perlu XA/local transaction contract? | Ya | JCA relevan |
| Perlu inbound event/message ke MDB/listener? | Ya | JCA relevan |
| Aplikasi berjalan di full Jakarta EE server? | Ya | JCA feasible |
| Hanya HTTP REST stateless? | Ya | JCA biasanya overkill |
| Tim mengoperasikan Spring Boot standalone? | Ya | JCA mungkin tidak cocok |
| Vendor menyediakan certified RAR? | Ya | Pakai vendor RA daripada tulis sendiri |
| Butuh portability antar app server? | Ya | JCA memberi standar, tapi detail config tetap vendor-specific |
| Butuh cloud-native simple deployment? | Ya | Pertimbangkan client library/gateway dulu |

---

## 23. Checklist Saat Menerima Vendor Resource Adapter

Jika vendor memberi `.rar`, jangan langsung deploy tanpa checklist.

### 23.1 Compatibility

- Support Java version berapa?
- `javax.resource` atau `jakarta.resource`?
- Support app server target?
- Support Jakarta EE version target?
- Dependency native ada?
- Tested di OS/container image target?

### 23.2 Connection Management

- Apa pool config yang tersedia?
- Apa validation mechanism?
- Apa idle timeout?
- Apa max lifetime?
- Bagaimana stale connection dideteksi?
- Bagaimana connection error event dikirim ke container?

### 23.3 Transaction

- Transaction support: none/local/XA?
- XA recovery documented?
- Recovery credential configurable?
- Resource manager identity stable?
- Heuristic outcome behavior?
- Timeout mapping?

### 23.4 Security

- Container-managed sign-on support?
- Application-managed sign-on support?
- Credential store integration?
- Password/token masked in logs?
- Credential rotation support?
- Per-user/technical account model?

### 23.5 Inbound

- Activation spec properties?
- Max concurrency?
- Durable subscription?
- Redelivery behavior?
- Poison message handling?
- Ordering guarantees?
- Transactional delivery?

### 23.6 Observability

- JMX/MicroProfile metrics?
- Server management metrics?
- Adapter logs structured?
- Error codes documented?
- Correlation id support?
- Payload logging configurable/masked?

### 23.7 Operations

- Graceful shutdown behavior?
- Redeploy behavior?
- Reconnect strategy?
- Backoff strategy?
- License/session limits?
- Runbook for EIS outage?
- Runbook for XA recovery?

---

## 24. Anti-Patterns

### 24.1 Treating JCA Connection Like Singleton

Buruk:

```java
static EisConnection connection = factory.getConnection();
```

Akibat:

- pool bypass/leak,
- stale session,
- transaction context salah,
- credential context salah.

### 24.2 Writing a JCA Adapter for Simple HTTP

Jika hanya butuh memanggil REST API, JCA biasanya berlebihan.

Gunakan:

- HTTP client,
- MicroProfile Rest Client,
- Spring WebClient,
- resilience/circuit breaker,
- token manager,
- normal app config.

### 24.3 Hiding Business Workflow inside Adapter

Adapter seharusnya integration boundary, bukan workflow engine.

Buruk:

```text
Resource adapter decides approval policy, escalation, SLA, and notification.
```

Lebih baik:

```text
Application service decides workflow.
Adapter sends command/query to EIS and translates protocol response.
```

### 24.4 XA by Default

Jangan memilih XA hanya karena tersedia.

Tanyakan:

- apakah atomicity benar-benar wajib?
- apakah EIS XA implementation mature?
- apakah team bisa melakukan recovery?
- apakah outbox/saga lebih operasional?

### 24.5 No Failure Classification

Semua error dianggap sama:

```java
catch (Exception e) {
    retry();
}
```

Ini berbahaya.

Harus bedakan:

- retryable transport error,
- non-retryable validation/business error,
- ambiguous timeout,
- authentication error,
- transaction rollback,
- duplicate request.

---

## 25. Mental Model Ringkas

Simpan model ini:

```text
JCA = standard managed integration architecture
      between Jakarta EE container and Enterprise Information System.

Application sees:
  ConnectionFactory -> Connection Handle

Container manages:
  pooling, transaction, security, lifecycle, work, recovery

Resource Adapter implements:
  EIS protocol, ManagedConnectionFactory, ManagedConnection,
  ResourceAdapter lifecycle, inbound activation if needed

EIS provides:
  actual enterprise capability, protocol, transaction/security semantics
```

Atau lebih pendek:

> JCA mengubah integrasi EIS dari “client library yang dipanggil aplikasi” menjadi “managed resource yang dikontrol container”.

---

## 26. Latihan Pemahaman

### Latihan 1 — Apakah JCA Tepat?

Kasus:

Aplikasi Java 21 Spring Boot perlu memanggil REST API external payment provider dengan OAuth2 client credentials. Tidak ada XA, tidak ada inbound event, tidak ada app server.

Pertanyaan:

- Apakah JCA cocok?
- Apa alternatifnya?

Jawaban mental:

- Tidak cocok.
- Gunakan HTTP client dengan connection pooling, timeout, token manager, circuit breaker, idempotency key, observability.

### Latihan 2 — Resource Adapter Vendor

Kasus:

Vendor mainframe menyediakan `cics-adapter.rar` untuk Jakarta EE 10, support XA, inbound transaction, dan connection pooling.

Pertanyaan:

- Apa yang harus dicek sebelum production?

Jawaban mental:

- Java/app server compatibility.
- `jakarta.resource` version.
- Pool sizing dan validation.
- XA recovery config.
- Credential mapping.
- Inbound concurrency.
- Graceful shutdown.
- Observability.
- Failure/retry/duplicate behavior.

### Latihan 3 — Pool Credential

Kasus:

Aplikasi memakai per-user credential ke EIS. Pool tidak memasukkan credential dalam matching key.

Pertanyaan:

- Apa risiko utama?

Jawaban mental:

- Credential contamination: physical session user A dapat dipakai request user B.
- Ini security incident, bukan sekadar bug pooling.

### Latihan 4 — Timeout Ambiguity

Kasus:

Aplikasi submit command ke EIS. Client timeout terjadi setelah request dikirim. Tidak ada response.

Pertanyaan:

- Apakah aman retry?

Jawaban mental:

- Belum tentu.
- Timeout after send adalah ambiguous outcome.
- Perlu idempotency key, query status, deduplication, atau reconciliation.

---

## 27. Production Checklist Ringkas

Sebelum memakai JCA resource adapter di production:

```text
[ ] Target app server mendukung Jakarta Connectors version yang dibutuhkan.
[ ] Namespace javax/jakarta konsisten.
[ ] Vendor adapter support Java version target.
[ ] Pool min/max/timeout/validation dikonfigurasi.
[ ] Connection leak detection tersedia.
[ ] Stale connection strategy jelas.
[ ] Credential mapping jelas.
[ ] Secret tidak muncul di log.
[ ] Local/XA transaction support dipahami.
[ ] XA recovery diuji jika dipakai.
[ ] Operation timeout dipasang.
[ ] Retry classification jelas.
[ ] Idempotency strategy tersedia untuk ambiguous operation.
[ ] Inbound concurrency dibatasi.
[ ] Poison message strategy tersedia.
[ ] Graceful shutdown diuji.
[ ] Redeploy tidak menyebabkan thread/classloader leak.
[ ] Metrics pool/latency/error tersedia.
[ ] Runbook outage/recovery tersedia.
```

---

## 28. Referensi Utama

1. Jakarta Connectors Specification 2.1 — `https://jakarta.ee/specifications/connectors/2.1/jakarta-connectors-spec-2.1`
2. Jakarta Connectors API Docs — `https://jakarta.ee/specifications/connectors/2.1/apidocs/`
3. Jakarta Connectors Specification Overview — `https://jakarta.ee/specifications/connectors/`
4. Jakarta Resource SPI Package Docs — `https://jakarta.ee/specifications/connectors/2.1/apidocs/jakarta.resource/jakarta/resource/spi/package-summary`
5. Eclipse Jakarta Connectors Project — `https://github.com/jakartaee/connectors`
6. Open Liberty Connectors 2.1 Feature Docs — `https://openliberty.io/docs/latest/reference/feature/connectors-2.1.html`
7. Red Hat EAP Jakarta Connectors Management Docs — `https://docs.redhat.com/en/documentation/red_hat_jboss_enterprise_application_platform/7.4/html/configuration_guide/jakarta_connectors_management`
8. Java EE 7 `ManagedConnectionFactory` API Docs for historical `javax.resource` reference — `https://docs.oracle.com/javaee/7/api/javax/resource/spi/ManagedConnectionFactory.html`

---

## 29. Ringkasan Akhir

Jakarta Connectors / JCA adalah salah satu teknologi enterprise Java yang paling mudah diremehkan karena ia jarang terlihat di aplikasi modern berbasis REST/microservices. Tetapi untuk integrasi EIS legacy, mainframe, transaction monitor, proprietary messaging, dan vendor resource adapter, JCA menyediakan sesuatu yang tidak diberikan client library biasa: **system-level contract** dengan container.

Hal terpenting dari bagian ini:

1. JCA bukan client library, melainkan managed integration architecture.
2. Resource adapter adalah bridge antara container dan EIS.
3. Application melihat logical connection, container mengelola physical connection.
4. ManagedConnectionFactory dan ManagedConnection adalah inti connection pooling/matching.
5. Transaction dan security adalah bagian dari kontrak, bukan tambahan belakangan.
6. Inbound integration membutuhkan WorkManager, ActivationSpec, dan endpoint contract.
7. JCA cocok untuk EIS stateful/transactional/legacy, bukan untuk semua HTTP integration.
8. Migration `javax.resource` → `jakarta.resource` adalah namespace/binary break yang harus direncanakan.
9. Failure production JCA biasanya terjadi pada pool, stale connection, credential contamination, XA recovery, classloader leak, dan backpressure.
10. Top engineer menilai JCA dari contract, lifecycle, recovery, security, dan operability, bukan dari apakah teknologinya terlihat modern.

---

## 30. Status Seri

Bagian ini adalah **Part 31 dari 34**.

Seri **belum selesai**.

Bagian berikutnya:

> **Part 32 — JCA Inbound/Outbound Architecture**  
> Fokus: outbound resource adapter, inbound message endpoint, activation spec, work manager, lifecycle, classloading, deployment descriptor, dan desain implementasi adapter yang lebih konkret.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-030.md">⬅️ Part 30 — Legacy SOAP Modernization Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-032.md">Part 032 — JCA Inbound/Outbound Architecture ➡️</a>
</div>
