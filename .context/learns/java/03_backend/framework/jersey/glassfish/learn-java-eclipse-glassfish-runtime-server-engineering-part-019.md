# learn-java-eclipse-glassfish-runtime-server-engineering-part-019  
# Part 19 — Resource Adapter / JCA Engineering

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 19 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **Jakarta Connectors / JCA runtime engineering di GlassFish**, terutama resource adapter, connector resource, admin object, work manager, transaction, security, dan failure diagnosis

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami Resource Adapter / JCA bukan sebagai teknologi “legacy”, tetapi sebagai **standard connector architecture** untuk integrasi enterprise;
2. memahami perbedaan outbound connector, inbound connector, dan bi-directional connector;
3. memahami `.rar` sebagai deployment unit resource adapter;
4. memahami kontrak antara GlassFish dan resource adapter:
   - connection management;
   - transaction management;
   - security management;
   - work management;
   - message inflow;
   - lifecycle management;
5. memahami objek penting seperti:
   - `ResourceAdapter`;
   - `ManagedConnectionFactory`;
   - `ManagedConnection`;
   - `ConnectionFactory`;
   - `Connection`;
   - `ConnectionManager`;
   - `ActivationSpec`;
   - admin object;
   - work manager;
6. memahami bagaimana GlassFish membuat connector resource dan connection pool;
7. memahami hubungan JCA dengan JMS/OpenMQ;
8. memahami kapan JCA masih tepat dan kapan sebaiknya memilih integrasi modern;
9. mampu mendiagnosis failure seperti RAR deployment gagal, connection allocation failure, transaction enlistment failure, endpoint activation failure, dan classloading issue;
10. mampu mendesain integration boundary yang aman, observable, dan maintainable.

Part ini tidak mengulang JMS API, EJB MDB API, JTA API, atau JDBC pool secara detail. Fokusnya adalah **connector runtime**.

---

## 1. Mental Model: JCA adalah Driver Model untuk Enterprise Systems

Jika JDBC adalah standard driver model untuk database, maka JCA/Jakarta Connectors adalah standard connector model untuk **Enterprise Information Systems**.

EIS dapat berupa:

- ERP;
- mainframe;
- legacy transaction system;
- custom queue/broker;
- proprietary payment gateway;
- document management system;
- government integration gateway;
- file transfer system dengan protocol khusus;
- CRM/SCM;
- core banking;
- message platform;
- industrial control system;
- system lama yang tidak berbicara HTTP/JDBC/JMS standar.

Mental model:

```text
Application
  |
  | standard Jakarta EE programming model
  v
GlassFish Application Server
  |
  | connector contracts:
  | - pooling
  | - transaction
  | - security
  | - lifecycle
  | - work management
  | - message inflow
  v
Resource Adapter (.rar)
  |
  | proprietary protocol / EIS client library
  v
Enterprise Information System
```

Resource adapter adalah “system-level driver” yang dipasang ke application server. Jakarta Connectors specification sendiri mendefinisikan resource adapter sebagai system-level software driver yang plug into application server dan menyediakan connectivity antara EIS, application server, dan enterprise application.

---

## 2. Kenapa Resource Adapter Ada?

Tanpa JCA, tiap vendor EIS akan membuat client library sendiri:

```text
Application A -> vendor SDK -> EIS
Application B -> vendor SDK -> EIS
Application C -> vendor SDK -> EIS
```

Masalah:

- pooling dibuat manual;
- transaction tidak terintegrasi;
- security credential tersebar;
- threading liar;
- lifecycle tidak dikontrol server;
- monitoring sulit;
- recovery sulit;
- semua aplikasi mengulang integration logic;
- vendor SDK bisa membuat thread sendiri tanpa koordinasi container.

Dengan JCA:

```text
Application
  |
  v
GlassFish container-managed connector resource
  |
  v
Resource Adapter
  |
  v
EIS
```

GlassFish ikut mengelola:

- connection allocation;
- pooling;
- transaction enlistment;
- security context;
- lifecycle start/stop;
- work thread;
- inbound message delivery;
- resource configuration;
- admin objects;
- monitoring.

Ini membuat integrasi lebih konsisten dan lebih operasional.

---

## 3. JCA vs JDBC vs JMS vs HTTP Client

JCA sering membingungkan karena terlihat mirip dengan banyak hal.

| Technology | Primary Purpose | Managed by App Server? | Typical Use |
|---|---:|---:|---|
| JDBC | Database access | Yes, via DataSource/pool | RDBMS |
| JMS | Messaging API | Yes, often via resource adapter | Queue/topic |
| JCA | Generic EIS connector architecture | Yes | ERP/mainframe/custom protocol |
| HTTP Client | HTTP calls | Usually app/framework-managed | REST/SOAP/HTTP APIs |
| Vendor SDK direct | Proprietary access | Usually app-managed | Custom integration |

JCA bukan pengganti semua integrasi. Ia berguna ketika integrasi membutuhkan:

- pooling yang dikelola container;
- transaction participation;
- security mapping;
- inbound message delivery;
- resource lifecycle yang terstandar;
- integration driver yang dipakai banyak aplikasi;
- compliance/governance di server.

---

## 4. Kapan JCA Masih Relevan?

JCA masih relevan jika:

1. EIS vendor menyediakan `.rar`;
2. sistem legacy butuh transaction-aware connector;
3. integrasi bukan sekadar HTTP stateless call;
4. koneksi mahal dan harus dipool;
5. sistem butuh inbound event ke application server;
6. resource harus ikut JTA/XA transaction;
7. security credential harus dikelola server;
8. adapter dipakai lintas banyak aplikasi;
9. organisasi sudah punya investment Java EE/Jakarta EE app server.

Contoh relevan:

```text
GlassFish app harus bicara ke mainframe transaction gateway
dengan connection pooling, security mapping, dan XA transaction.
```

Atau:

```text
Vendor ERP menyediakan certified resource adapter .rar.
```

---

## 5. Kapan JCA Kemungkinan Overkill?

JCA bisa overkill jika:

- integrasi hanya REST/HTTP sederhana;
- tidak butuh transaction enlistment;
- tidak butuh inbound connector;
- tidak ada vendor `.rar`;
- team tidak punya skill JCA;
- deployment target cloud-native lightweight;
- lifecycle lebih mudah dikelola di microservice terpisah;
- observability adapter kurang matang;
- resource adapter proprietary sulit di-debug.

Alternatif modern:

- HTTP client dengan resilience pattern;
- messaging via Kafka/RabbitMQ client library;
- integration microservice;
- outbox pattern;
- CDC/Debezium;
- API gateway;
- workflow/orchestration;
- batch sync service;
- sidecar/adapter service.

Prinsip:

> Gunakan JCA ketika kamu benar-benar membutuhkan kontrak container-managed integration. Jangan gunakan hanya karena “enterprise”.

---

## 6. Deployment Unit: `.rar`

Resource adapter dikemas sebagai **Resource Adapter Archive** dengan ekstensi:

```text
.rar
```

Struktur umum:

```text
legacy-adapter.rar
  |
  |-- META-INF/ra.xml
  |-- adapter classes
  |-- vendor client libraries
  |-- optional native/config resources
```

`ra.xml` adalah deployment descriptor yang menjelaskan:

- resource adapter class;
- outbound connection definitions;
- inbound message listener;
- admin objects;
- transaction support;
- config properties;
- authentication/security;
- required work context;
- activation spec.

Pada versi modern, metadata juga dapat berasal dari annotations seperti `@Connector`, tetapi descriptor tetap penting dalam dunia enterprise karena explicit, reviewable, dan sering dipakai vendor.

---

## 7. Resource Adapter Lifecycle di GlassFish

Lifecycle konseptual:

```text
Deploy RAR
  |
  v
Parse ra.xml / annotations
  |
  v
Load adapter classes
  |
  v
Instantiate ResourceAdapter
  |
  v
Configure RA properties
  |
  v
Start ResourceAdapter
  |
  v
Create connection definitions/admin objects
  |
  v
Application uses connector resource
  |
  v
Stop/undeploy ResourceAdapter
```

Saat domain/instance startup:

```text
GlassFish starts
  |
  v
Loads deployed RARs
  |
  v
Starts RAs
  |
  v
Activates endpoints if inbound
  |
  v
Connector resources become available
```

Failure bisa terjadi di tiap tahap:

- descriptor invalid;
- class missing;
- vendor library missing;
- RA start exception;
- EIS unreachable;
- config property missing;
- transaction support mismatch;
- security config invalid;
- activation endpoint invalid.

---

## 8. Outbound Connector

Outbound connector berarti aplikasi memulai komunikasi ke EIS.

Flow:

```text
Application
  |
  | inject/lookup ConnectionFactory
  v
ConnectionFactory
  |
  | createConnection()
  v
GlassFish ConnectionManager
  |
  | allocate from pool / create ManagedConnection
  v
ManagedConnectionFactory
  |
  | create physical ManagedConnection
  v
EIS
```

Contoh:

```text
Case application calls legacy mainframe to retrieve license status.
```

Aplikasi melakukan call keluar.

---

## 9. Inbound Connector

Inbound connector berarti EIS/resource adapter memulai komunikasi masuk ke aplikasi.

Flow:

```text
EIS event/message
  |
  v
Resource Adapter receives event
  |
  v
GlassFish endpoint activation
  |
  v
Message endpoint / MDB-like component
  |
  v
Application logic
```

Contoh:

```text
Mainframe emits "case status changed" event.
Resource adapter delivers event into GlassFish endpoint.
```

Inbound connector membutuhkan kontrak:

- endpoint activation;
- `ActivationSpec`;
- message listener type;
- work manager;
- transaction/security context.

---

## 10. Bi-Directional Connector

Bi-directional connector mendukung keduanya:

```text
Application -> EIS
EIS -> Application
```

Contoh:

```text
Application submits instruction to EIS.
EIS asynchronously sends status callback/event.
```

Ini lebih kompleks karena harus memikirkan:

- outbound connection pooling;
- inbound threading;
- message ordering;
- transaction demarcation;
- retry/redelivery;
- endpoint lifecycle;
- duplicate event handling;
- correlation ID.

---

## 11. Core Object Model

### 11.1 `ResourceAdapter`

`ResourceAdapter` merepresentasikan adapter utama.

Tanggung jawab:

- start/stop lifecycle;
- endpoint activation/deactivation;
- access ke `BootstrapContext`;
- work manager access;
- transaction inflow support;
- adapter-wide config.

Mental model:

```text
ResourceAdapter = runtime plugin instance managed by GlassFish
```

---

### 11.2 `ManagedConnectionFactory`

`ManagedConnectionFactory` bertugas membuat physical managed connection ke EIS.

Tanggung jawab:

- create managed connection;
- match existing managed connection;
- provide connection factory;
- hold connection definition config;
- support credentials/request info.

Mental model:

```text
ManagedConnectionFactory = factory for physical connections
```

---

### 11.3 `ManagedConnection`

`ManagedConnection` adalah physical connection ke EIS yang dikelola server.

Tanggung jawab:

- physical communication;
- cleanup/destroy;
- transaction association;
- event listener to container;
- local transaction support if available.

Mental model:

```text
ManagedConnection = pooled physical connection to EIS
```

---

### 11.4 Application-Level `Connection`

Aplikasi biasanya tidak melihat `ManagedConnection` langsung. Aplikasi melihat connection handle.

```text
Application Connection handle
  |
  | backed by
  v
ManagedConnection
```

Ini mirip JDBC:

```text
java.sql.Connection handle
  |
  | backed by pooled physical DB connection
```

---

### 11.5 `ConnectionFactory`

ConnectionFactory adalah object yang di-inject/lookup aplikasi.

Contoh konseptual:

```java
@Resource(name = "eis/legacy/customer")
private LegacyConnectionFactory connectionFactory;
```

Aplikasi:

```java
try (LegacyConnection conn = connectionFactory.getConnection()) {
    ...
}
```

---

### 11.6 `ConnectionManager`

`ConnectionManager` disediakan oleh application server.

Tanggung jawab:

- allocate connection;
- pooling;
- transaction enlistment;
- security association;
- lifecycle management;
- connection matching.

Dalam JCA, ini boundary penting:

```text
Application calls ConnectionFactory.
ConnectionFactory delegates to ConnectionManager.
ConnectionManager manages pool/tx/security.
```

---

### 11.7 `ActivationSpec`

`ActivationSpec` digunakan untuk inbound connector.

Ia mendeskripsikan konfigurasi endpoint activation.

Contoh property:

- destination;
- subscription;
- endpoint type;
- concurrency;
- filter/selector;
- durable flag;
- connection parameters.

Mental model:

```text
ActivationSpec = subscription/activation configuration for inbound delivery
```

---

### 11.8 Admin Object

Admin object adalah object administratif/resource yang dikonfigurasi di server dan bisa digunakan aplikasi.

Contoh:

- queue destination;
- topic destination;
- vendor-specific administered object;
- endpoint configuration object.

Dalam JMS, queue/topic sering terlihat seperti admin objects.

---

## 12. GlassFish Connector Resources

GlassFish menyediakan command untuk:

- deploy resource adapter;
- create connector connection pool;
- create connector resource;
- create admin object;
- create resource adapter config;
- create work security map;
- list/delete resources.

Command names umum yang relevan:

```bash
asadmin deploy legacy-adapter.rar
asadmin create-connector-connection-pool
asadmin create-connector-resource
asadmin create-admin-object
asadmin create-resource-adapter-config
asadmin create-connector-security-map
asadmin list-connector-connection-pools
asadmin list-connector-resources
asadmin list-admin-objects
asadmin list-resource-adapter-configs
```

Catatan:

- opsi command perlu dicek sesuai versi GlassFish;
- beberapa resource juga bisa dibuat melalui `glassfish-resources.xml` dan `add-resources`;
- resource harus ditargetkan ke server/cluster yang benar;
- connector pool mirip JDBC pool, tapi untuk resource adapter.

---

## 13. Outbound Connector Configuration Flow

Flow konseptual:

```text
1. Deploy RAR
2. Create connector connection pool
3. Create connector resource with JNDI name
4. Map application resource-ref to JNDI resource
5. Application injects/looks up connection factory
6. GlassFish allocates connection from pool
7. Resource adapter communicates with EIS
```

Contoh konseptual command:

```bash
asadmin deploy legacy-mainframe-adapter.rar

asadmin create-connector-connection-pool \
  --raname legacy-mainframe-adapter \
  --connectiondefinition com.vendor.legacy.api.LegacyConnectionFactory \
  --transactionsupport XATransaction \
  --property host=mainframe.internal:port=1234 \
  legacyMainframePool

asadmin create-connector-resource \
  --poolname legacyMainframePool \
  eis/legacy/mainframe

asadmin deploy case-app.ear
```

Aplikasi:

```java
@Resource(name = "eis/legacy/mainframe")
private LegacyConnectionFactory legacyConnectionFactory;
```

Atau lebih portable:

```text
Logical reference:
  eis/mainframe/customer

Physical JNDI:
  eis/legacy/mainframe
```

Descriptor mapping:

```text
eis/mainframe/customer -> eis/legacy/mainframe
```

---

## 14. Transaction Support

Resource adapter dapat menyatakan transaction support:

```text
NoTransaction
LocalTransaction
XATransaction
```

### 14.1 `NoTransaction`

Resource tidak ikut transaction container.

Cocok untuk:

- read-only lookup;
- non-transactional service;
- idempotent external API;
- call yang tidak perlu rollback.

Risiko:

```text
DB transaction rollback tidak membatalkan call ke EIS.
```

---

### 14.2 `LocalTransaction`

Resource punya local transaction sendiri, tetapi tidak ikut 2PC global penuh.

Cocok untuk:

- satu resource EIS;
- local commit/rollback;
- tidak perlu atomic dengan DB/JMS lain.

Risiko:

```text
DB commit berhasil, EIS local commit gagal.
Atau sebaliknya.
```

---

### 14.3 `XATransaction`

Resource bisa ikut distributed transaction / two-phase commit.

Cocok untuk:

- atomicity lintas DB/JMS/EIS benar-benar diperlukan;
- resource adapter dan EIS mendukung XA dengan benar;
- recovery behavior teruji;
- throughput dan operational complexity diterima.

Risiko:

- performance overhead;
- in-doubt transaction;
- heuristic outcome;
- recovery log complexity;
- lock duration panjang;
- vendor implementation bug;
- sulit dioperasikan.

Prinsip:

> XA harus dipilih karena ada kebutuhan consistency yang kuat, bukan karena tersedia.

---

## 15. JCA dan JTA Enlistment

Dalam transaction container:

```text
EJB method starts JTA transaction
  |
  v
Application uses connector connection
  |
  v
GlassFish ConnectionManager allocates connection
  |
  v
Resource is enlisted into transaction
  |
  v
Commit/rollback coordinated by transaction manager
```

Jika resource adapter mendukung XA:

```text
TransactionManager
  |
  | prepare
  | commit/rollback
  v
XAResource from adapter
```

Jika local/no transaction:

```text
Container cannot provide full atomicity across resources.
```

Incident yang sering muncul:

```text
Transaction rolled back,
but external EIS operation already happened.
```

Solusi design:

- idempotency key;
- compensating action;
- outbox/event pattern;
- saga;
- external operation after commit;
- avoid XA unless necessary and tested.

---

## 16. Security Contract

Resource adapter bisa memakai security contract agar credential dikelola container.

Security dapat mencakup:

- container-managed sign-on;
- application-managed sign-on;
- credential mapping;
- principal mapping;
- connection request info;
- security map.

Mental model:

```text
Application user/principal
  |
  | mapped by GlassFish connector security
  v
EIS credential
```

Contoh:

```text
User alice in app
  -> maps to EIS user CASE_APP_USER

Batch job principal
  -> maps to EIS user BATCH_EIS_USER
```

Pertanyaan engineering:

1. Apakah EIS pakai shared technical user atau per-user credential?
2. Apakah credential disimpan di GlassFish?
3. Apakah credential memakai password alias?
4. Apakah principal mapping diperlukan?
5. Apakah akses EIS diaudit per user atau per system?
6. Bagaimana rotasi credential dilakukan?
7. Apakah failure auth EIS terlihat di log/metrics?

---

## 17. Connector Security Map

GlassFish mendukung connector security map untuk memetakan principal/group aplikasi ke credential EIS.

Konsep:

```text
GlassFish principal/group
  -> backend EIS user/password
```

Contoh:

```text
app group CASE_OFFICER
  -> EIS credential CASE_READWRITE

app group READ_ONLY
  -> EIS credential CASE_READONLY
```

Risiko:

- credential banyak;
- mapping salah bisa privilege escalation;
- password rotation kompleks;
- group/principal source harus jelas;
- auditing harus membedakan app user vs EIS credential.

Best practice:

- gunakan least privilege;
- dokumentasikan mapping;
- jangan hard-code credential;
- gunakan alias/secret flow;
- test negative authorization;
- log principal dan EIS operation secara aman.

---

## 18. Work Management

Inbound adapter atau adapter internal sering butuh menjalankan pekerjaan asynchronous.

JCA menyediakan Work Management contract.

Resource adapter dapat meminta server menjalankan `Work`.

Mental model:

```text
ResourceAdapter
  |
  | submit Work
  v
GlassFish Work Manager / thread pool
  |
  | executes work under container control
  v
Adapter code
```

Kenapa penting?

Karena resource adapter tidak seharusnya membuat thread liar tanpa koordinasi container.

Server-managed work memungkinkan:

- thread control;
- lifecycle control;
- context propagation;
- monitoring;
- shutdown coordination;
- resource constraint.

Failure jika adapter membuat thread liar:

- shutdown menggantung;
- thread leak;
- context/security hilang;
- classloader leak saat undeploy;
- CPU spike tidak terlihat di pool resmi;
- container tidak bisa mengatur lifecycle.

---

## 19. Message Inflow

Message inflow adalah kemampuan resource adapter mengirim pesan/event ke endpoint aplikasi.

Flow:

```text
EIS
  |
  | event/message
  v
Resource Adapter
  |
  | endpoint activation
  v
GlassFish
  |
  | message endpoint
  v
Application component
```

Dalam JMS, ini sering terlihat sebagai Message-Driven Bean. Namun konsep JCA lebih umum dari JMS.

Komponen penting:

- `MessageEndpointFactory`;
- `ActivationSpec`;
- message listener interface;
- transaction context;
- delivery semantics.

Pertanyaan engineering:

1. Apakah delivery at-least-once?
2. Bagaimana redelivery?
3. Bagaimana poison message?
4. Apakah ordering dijamin?
5. Apakah endpoint concurrent?
6. Apakah transaction mencakup message ack?
7. Apakah duplicate handling ada?
8. Apakah backpressure tersedia?

---

## 20. Admin Object

Admin object adalah object yang dikonfigurasi di server dan disediakan oleh adapter.

Contoh generic:

```text
eis/legacy/customerDestination
eis/erp/paymentChannel
eis/mainframe/requestQueue
```

Pada JMS:

```text
Queue
Topic
```

Admin object sering dipakai untuk merepresentasikan destination atau konfigurasi resource tertentu.

Command konseptual:

```bash
asadmin create-admin-object \
  --raname legacy-adapter \
  --restype com.vendor.LegacyDestination \
  --property name=CASE_STATUS \
  eis/legacy/caseStatusDestination
```

Aplikasi:

```java
@Resource(name = "eis/legacy/caseStatusDestination")
private LegacyDestination destination;
```

---

## 21. Relationship dengan JMS/OpenMQ di GlassFish

GlassFish mengimplementasikan JMS menggunakan resource adapter sistem bernama seperti `jmsra` pada GlassFish era lama/umum.

Saat kamu membuat JMS resource, GlassFish di bawahnya dapat membuat connector resource terkait.

Mental model:

```text
Jakarta Messaging API
  |
  v
JMS ConnectionFactory / Queue / Topic
  |
  v
GlassFish connector resources
  |
  v
OpenMQ resource adapter / broker integration
```

Kenapa ini penting?

Karena banyak konsep JMS GlassFish sebenarnya berjalan di atas connector architecture:

- connection factory;
- destination;
- transaction support;
- XA/non-XA mode;
- message inflow ke MDB;
- pooling;
- resource adapter config.

Ini menghubungkan Part 14 dan Part 19.

---

## 22. Classloading Resource Adapter

RAR membawa library sendiri.

Masalah umum:

- adapter membawa API jar yang konflik;
- vendor library perlu native dependency;
- class visible ke server tapi tidak ke app;
- class visible ke app tapi tidak ke adapter;
- duplicate interface di app dan RAR;
- Jakarta namespace mismatch;
- Java version mismatch.

Contoh failure:

```text
ClassNotFoundException: com.vendor.LegacyConnectionFactory
NoClassDefFoundError: jakarta/resource/spi/ResourceAdapter
ClassCastException between app interface and adapter interface
UnsupportedClassVersionError
```

Prinsip:

```text
Resource adapter is a deployment unit with its own classloading concerns.
Application and adapter must agree on shared API types.
Do not duplicate API jars inconsistently across app and RAR.
```

Jika aplikasi perlu menggunakan vendor connection interface, interface jar mungkin harus tersedia di application scope atau packaged sesuai vendor instruction.

---

## 23. Java 8 sampai 25 Considerations

### Java 8

- Java EE era;
- namespace `javax.resource.*`;
- banyak vendor RAR lama dikompilasi untuk Java 6/7/8;
- cocok untuk GlassFish 4/5 legacy;
- security/TLS defaults lebih lama.

### Java 11

- transisi modular JDK;
- beberapa vendor library lama mulai bermasalah;
- JAXB/JAX-WS/activation dependency perlu dicek;
- masih banyak enterprise adapter belum modern.

### Java 17

- strong encapsulation lebih terasa;
- illegal reflective access bisa menjadi masalah;
- GlassFish 7 era Jakarta EE 10 lebih cocok;
- vendor adapter harus diuji.

### Java 21

- baseline GlassFish 8;
- resource adapter lama bisa gagal jika bytecode/dependency tidak compatible;
- virtual threads tidak otomatis berlaku ke adapter work manager;
- TLS/security defaults lebih ketat.

### Java 25

- target modern;
- adapter proprietary lama paling berisiko;
- jangan upgrade JDK dan adapter/server sekaligus tanpa matrix test;
- cek disabled algorithms, reflection, serialization, native libs.

Prinsip:

```text
Resource adapter compatibility is often weaker than application code compatibility.
```

Vendor `.rar` bisa menjadi blocker migrasi Java/GlassFish.

---

## 24. Deployment Descriptor: `ra.xml`

`ra.xml` dapat berisi:

- adapter class;
- display name;
- vendor/version;
- config properties;
- outbound connection definitions;
- managed connection factory class;
- connection factory interface;
- connection interface;
- transaction support;
- authentication mechanism;
- reauthentication support;
- message listener;
- activation spec;
- admin object.

Contoh konseptual sangat sederhana:

```xml
<connector>
    <display-name>Legacy Mainframe Adapter</display-name>
    <vendor-name>Example Vendor</vendor-name>
    <eis-type>Mainframe Gateway</eis-type>
    <resourceadapter-version>1.0</resourceadapter-version>

    <resourceadapter>
        <resourceadapter-class>
            com.vendor.legacy.LegacyResourceAdapter
        </resourceadapter-class>

        <outbound-resourceadapter>
            <connection-definition>
                <managedconnectionfactory-class>
                    com.vendor.legacy.LegacyManagedConnectionFactory
                </managedconnectionfactory-class>
                <connectionfactory-interface>
                    com.vendor.legacy.LegacyConnectionFactory
                </connectionfactory-interface>
                <connection-interface>
                    com.vendor.legacy.LegacyConnection
                </connection-interface>
            </connection-definition>

            <transaction-support>XATransaction</transaction-support>
        </outbound-resourceadapter>
    </resourceadapter>
</connector>
```

Catatan:

- schema/namespace aktual bergantung versi Connectors;
- descriptor vendor bisa jauh lebih kompleks;
- jangan mengedit vendor `ra.xml` sembarangan tanpa dokumentasi.

---

## 25. GlassFish-Specific Connector Descriptor

Selain `ra.xml`, GlassFish bisa memakai descriptor/config vendor-specific atau GlassFish-specific untuk deployment/resource mapping.

Kemungkinan konfigurasi:

- resource adapter config;
- connector connection pool;
- connector resource;
- admin object resource;
- security map;
- work security map;
- property override.

Seperti descriptor GlassFish lain, prinsipnya:

```text
Standard descriptor:
  defines portable adapter metadata

GlassFish configuration:
  defines runtime deployment/resource binding in GlassFish
```

---

## 26. Pooling pada Connector

Connector connection pool mirip dengan JDBC pool, tetapi underlying resource-nya adalah managed connection dari resource adapter.

Parameter umum yang perlu dipahami:

- steady/min pool size;
- max pool size;
- resize quantity;
- idle timeout;
- max wait time;
- validation support jika tersedia;
- fail all connections;
- transaction support;
- lazy association;
- connection leak tracing jika didukung;
- connection creation retry.

Capacity model:

```text
needed connections ≈ concurrent external calls
                   ≈ throughput * external latency
```

Contoh:

```text
100 requests/sec call EIS
average EIS latency 200ms
concurrent calls ≈ 100 * 0.2 = 20
pool minimal harus > 20 + headroom
```

Tetapi:

```text
Max pool size <= EIS max allowed sessions
```

Anti-pattern:

```text
Increase connector max pool size until timeout disappears.
```

Itu bisa memindahkan bottleneck ke EIS.

---

## 27. Backpressure dan External System Protection

EIS sering lebih rapuh daripada aplikasi modern.

Resource adapter pool harus menjadi protection boundary.

Jika EIS lambat:

```text
Requests pile up waiting for connector connection.
```

Jika pool terlalu besar:

```text
GlassFish overwhelms EIS.
```

Jika timeout terlalu lama:

```text
HTTP threads stuck.
```

Jika timeout terlalu pendek:

```text
false failures during normal latency spike.
```

Design:

```text
HTTP request concurrency
  > app worker budget
  > connector pool budget
  > EIS capacity
```

Harus ada:

- max pool size;
- max wait time;
- circuit breaker di application layer jika perlu;
- timeout EIS;
- retry budget;
- idempotency key;
- queue/backoff untuk workload async.

---

## 28. Transaction + External System Side Effect

Contoh bahaya:

```text
JTA transaction:
  update DB case status
  call EIS submit instruction
  commit DB
```

Jika EIS call non-transactional:

```text
EIS instruction succeeded
DB transaction rolled back
```

Maka system inconsistent.

Pilihan desain:

### Option A — XA

```text
DB + EIS both XA
2PC transaction
```

Pro:

- stronger atomicity.

Con:

- complex, slower, recovery burden.

### Option B — Outbox

```text
DB transaction writes case status + outbox event
Async worker sends to EIS after commit
```

Pro:

- simpler operationally;
- retryable;
- observable.

Con:

- eventual consistency.

### Option C — Saga/Compensation

```text
If EIS succeeds but later step fails, send compensating instruction.
```

Pro:

- fits distributed systems.

Con:

- business compensation must exist.

Top-level decision:

```text
Use XA only if the business truly requires atomic commit
and adapter/EIS recovery is proven.
```

---

## 29. Inbound Delivery Semantics

Inbound adapter delivery can be:

- at-most-once;
- at-least-once;
- effectively-once with idempotency;
- ordered;
- unordered;
- transactional;
- non-transactional.

JCA by itself does not magically guarantee business exactly-once.

Jika EIS event delivered twice:

```text
Application must handle duplicate.
```

Jika endpoint throws exception:

```text
Adapter/container may redeliver depending config.
```

Jika transaction rollback:

```text
message/event handling may be retried.
```

Prinsip:

```text
Inbound connector consumers must be idempotent unless the adapter and EIS provide a proven stronger guarantee.
```

---

## 30. Observability untuk Resource Adapter

Metrics yang perlu dipantau:

```text
Connector pool:
- active connections
- idle connections
- wait queue
- wait time
- max pool usage
- allocation failures
- connection creation failures
- destroy count

EIS:
- latency
- error rate
- timeout count
- authentication failure
- protocol error
- throttling/rejection

Inbound:
- event rate
- processing latency
- redelivery count
- poison event count
- endpoint failures
- backlog

Thread/work:
- active work
- rejected work
- long-running work
- stuck thread
```

Logging harus punya:

- correlation ID;
- adapter name;
- resource JNDI name;
- EIS endpoint;
- operation name;
- transaction id jika aman;
- error code vendor;
- retry count;
- redelivery count.

Jangan log:

- password;
- full credential;
- sensitive payload;
- token;
- private key;
- unmasked PII.

---

## 31. Troubleshooting: RAR Deployment Fails

Symptom:

```text
asadmin deploy legacy-adapter.rar
Deployment failed
```

Checklist:

```text
1. Cek server.log.
2. Cek ra.xml valid.
3. Cek class ResourceAdapter ada.
4. Cek semua vendor library ada.
5. Cek Java bytecode version.
6. Cek javax/jakarta namespace mismatch.
7. Cek dependency duplicate/conflict.
8. Cek native library path jika adapter butuh native lib.
9. Cek config property required.
10. Cek GlassFish/Jakarta Connectors version compatibility.
```

Common root cause:

```text
Adapter compiled for old javax.resource,
but deployed to Jakarta namespace runtime requiring jakarta.resource.
```

Atau:

```text
Vendor adapter depends on Java 8 behavior and fails on Java 21.
```

---

## 32. Troubleshooting: Connection Allocation Fails

Symptom:

```text
ResourceException: Unable to allocate connection
Connection pool exhausted
ManagedConnectionFactory error
```

Checklist:

```text
1. Apakah connector resource JNDI benar?
2. Apakah connector pool ada dan target benar?
3. Apakah EIS reachable?
4. Apakah credential benar?
5. Apakah pool max tercapai?
6. Apakah max wait time habis?
7. Apakah connection leak?
8. Apakah adapter matchManagedConnections gagal?
9. Apakah transaction context membuat connection tidak reusable?
10. Apakah EIS menolak session baru?
```

Diagnosis:

```bash
asadmin list-connector-resources
asadmin list-connector-connection-pools
asadmin get resources.connector-connection-pool.*
```

Tambahkan monitoring pool untuk melihat saturation.

---

## 33. Troubleshooting: Transaction Enlistment Fails

Symptom:

```text
javax.transaction.RollbackException
XAException
ResourceException during enlistment
```

Checklist:

```text
1. Transaction support pool sesuai adapter?
2. Adapter benar-benar mendukung XA?
3. EIS XA mode aktif?
4. Credential punya permission transaction?
5. Recovery config benar?
6. Transaction timeout cukup?
7. Apakah mixing XA/non-XA resource?
8. Apakah last resource optimization terlibat?
9. Apakah same resource enlisted multiple times?
10. Apakah adapter bug pada XAResource implementation?
```

Prinsip:

```text
XA support di descriptor tidak cukup.
XA recovery harus diuji dengan crash/failure scenario.
```

---

## 34. Troubleshooting: Inbound Endpoint Tidak Menerima Event

Symptom:

```text
RAR deployed, app deployed, but no inbound event consumed.
```

Checklist:

```text
1. Apakah endpoint/MDB deployed?
2. Apakah activation spec benar?
3. Apakah destination/channel benar?
4. Apakah adapter started?
5. Apakah EIS mengirim event?
6. Apakah network dari EIS ke adapter tersedia?
7. Apakah message listener interface match?
8. Apakah transaction/security config menolak delivery?
9. Apakah endpoint activation error di server.log?
10. Apakah thread/work manager stuck?
```

Common root cause:

```text
ActivationSpec property wrong.
Endpoint activation failed silently except server.log warning.
EIS event sent to wrong destination.
```

---

## 35. Troubleshooting: Undeploy/Restart Hang

Resource adapter dapat membuat thread/socket sendiri.

Symptom:

```text
undeploy hangs
domain stop slow
classloader leak after redeploy
```

Checklist:

```text
1. Apakah RA stop() dipanggil?
2. Apakah RA menutup socket?
3. Apakah RA membatalkan work?
4. Apakah thread vendor masih hidup?
5. Apakah Timer/Executor dibuat manual?
6. Apakah classloader leak dari static field?
7. Apakah inbound listener masih blocking?
```

Jika adapter tidak compliant, kamu mungkin perlu:

- vendor patch;
- configuration workaround;
- avoid hot redeploy;
- isolate in separate domain;
- process restart as deployment strategy;
- run integration as external service.

---

## 36. Designing a Resource Adapter Integration Boundary

Untuk integrasi serius, jangan biarkan resource adapter menyebar ke seluruh domain logic.

Pattern:

```text
Application Service
  |
  v
Integration Port Interface
  |
  v
JCA Adapter Gateway
  |
  v
ConnectionFactory / Connector Resource
  |
  v
Resource Adapter
  |
  v
EIS
```

Contoh:

```java
public interface CustomerRegistryPort {
    CustomerSnapshot getCustomer(String customerId);
}
```

Implementation:

```java
@ApplicationScoped
public class MainframeCustomerRegistryGateway implements CustomerRegistryPort {
    @Resource(name = "eis/mainframe/customer")
    private LegacyConnectionFactory connectionFactory;

    @Override
    public CustomerSnapshot getCustomer(String customerId) {
        // acquire connection, call EIS, map result, handle error
    }
}
```

Kelebihan:

- JCA code isolated;
- easier testing;
- vendor API tidak bocor;
- error mapping konsisten;
- retry/timeout/correlation centralized;
- future migration ke HTTP/Kafka/microservice lebih mudah.

---

## 37. Error Mapping

Vendor adapter error harus dipetakan ke domain/application error.

Contoh:

```text
EIS_TIMEOUT
  -> retryable infrastructure failure

EIS_AUTH_FAILED
  -> configuration/security failure

EIS_NOT_FOUND
  -> business not found

EIS_DUPLICATE
  -> idempotency/business conflict

EIS_UNAVAILABLE
  -> external dependency unavailable
```

Jangan membiarkan seluruh app bergantung pada exception vendor:

```java
catch (VendorLegacyProtocolException e)
```

di mana-mana.

Buat boundary:

```java
catch (VendorTimeoutException e) {
    throw new ExternalSystemTimeoutException("Mainframe timeout", e);
}
```

---

## 38. Naming Convention untuk Connector Resource

Gunakan nama yang jelas.

Logical:

```text
eis/customer-registry
eis/license-status
eis/payment-gateway
eis/mainframe/case
```

Physical:

```text
eis/aceas/prod/mainframe/customer-registry
eis/aceas/prod/mainframe/license-status
eis/aceas/prod/erp/payment
```

Pool:

```text
pool/aceas/prod/mainframe/customer-registry
```

Admin object:

```text
eis/aceas/prod/mainframe/case-status-destination
```

Hindari:

```text
eis/adapter
eis/legacy
eis/main
eis/test
```

---

## 39. Security Review Checklist untuk JCA

```text
[Credential]
- Credential EIS disimpan di mana?
- Password alias/secret manager dipakai?
- Credential per app/per group/per user?
- Rotasi tested?

[Authorization]
- Apakah app principal dimap ke EIS user?
- Apakah least privilege?
- Apakah role/group mapping terdokumentasi?

[Transport]
- Apakah koneksi ke EIS terenkripsi?
- Certificate/truststore dikelola?
- Host allowlist/firewall?

[Adapter]
- Vendor adapter trusted?
- Version supported?
- CVE monitored?
- Native dependency reviewed?

[Logging]
- Payload sensitif tidak tercetak?
- Credential tidak tercetak?
- Error code cukup untuk investigation?

[Transaction]
- XA benar-benar dibutuhkan?
- Recovery tested?
- Duplicate side effect handled?
```

---

## 40. Production Readiness Checklist

```text
[Deployment]
- RAR version pinned.
- RAR source/vendor documented.
- Compatibility with GlassFish/JDK verified.
- Deployment repeatable via asadmin/IaC.

[Resource]
- Connector pool configured.
- Connector resource JNDI named clearly.
- Admin objects configured.
- Target cluster/server correct.

[Capacity]
- Max pool <= EIS capacity.
- Max wait time defined.
- Timeout defined.
- Load test done.

[Failure]
- EIS down scenario tested.
- Timeout scenario tested.
- Auth failure tested.
- Pool exhaustion tested.
- Restart/undeploy tested.

[Transaction]
- Transaction support selected intentionally.
- XA recovery tested if XA.
- Idempotency/compensation designed if non-XA.

[Observability]
- Pool metrics monitored.
- EIS latency measured.
- Error rate alerted.
- Correlation ID propagated.
- Logs centralized.

[Operations]
- Runbook exists.
- Vendor support path known.
- Rollback strategy known.
- Adapter upgrade process documented.
```

---

## 41. Case Study: Legacy Mainframe Status Adapter

Scenario:

```text
Regulatory case management app needs to query license status from mainframe.
Vendor provides mainframe-status-adapter.rar.
The call is read-only.
Latency p95 = 250ms.
Mainframe allows max 50 concurrent sessions.
Application peak = 120 requests/sec, but only 20% require mainframe call.
```

Demand:

```text
mainframe calls/sec = 120 * 0.20 = 24/sec
concurrent calls ≈ 24 * 0.25 = 6
```

Pool design:

```text
steady/min: 5
max: 15
max wait: 2s
EIS timeout: 1s
```

Why not max 50?

```text
Because application does not need 50 normally.
Leaving headroom protects mainframe and other consumers.
```

Failure design:

```text
If mainframe timeout:
  return degraded status / retry async / show temporary unavailable depending business.

If duplicate query:
  safe because read-only.

If mainframe down:
  circuit breaker opens to avoid exhausting HTTP threads.
```

Transaction:

```text
NoTransaction, because read-only external query not part of DB commit.
```

---

## 42. Case Study: Payment Instruction Adapter

Scenario:

```text
Application sends payment instruction to ERP.
Instruction must not be duplicated.
ERP adapter supports LocalTransaction but not XA.
Application DB update and ERP instruction cannot be atomically committed.
```

Bad design:

```text
Begin DB transaction
Update payment status SENT
Call ERP
Commit DB
```

Failure:

```text
ERP succeeds, DB rollback -> lost record.
DB commits, ERP fails -> status wrong.
```

Better design:

```text
DB transaction:
  insert payment instruction
  insert outbox event

After commit:
  worker sends instruction to ERP with idempotency key

ERP response:
  update instruction status
```

Adapter use:

```text
Worker uses connector resource to call ERP.
Connection pool protects ERP.
Idempotency key prevents duplicate instruction.
```

This avoids false atomicity.

---

## 43. Top 1% Takeaways

1. **JCA is not just legacy; it is a standard app-server connector contract.**
2. **Resource adapter is like a driver for EIS**, but container-managed.
3. **Outbound connector = app calls EIS.**
4. **Inbound connector = EIS calls app through adapter/endpoint.**
5. **ConnectionManager is the key boundary** where GlassFish manages pooling, transaction, and security.
6. **XA is a serious operational commitment**, not just a config value.
7. **Resource adapter compatibility can block Java/GlassFish upgrades.**
8. **Pool sizing must protect the EIS**, not just the app.
9. **Inbound delivery must be designed for duplicate/redelivery unless proven otherwise.**
10. **Hide vendor connector API behind an integration port/gateway.**

---

## 44. Mini Exercise

Design a GlassFish JCA integration for:

```text
System: ACEAS
External EIS: Legacy Enforcement Registry
Capabilities:
- Query party status
- Submit enforcement action
- Receive async enforcement result
Vendor provides:
- enforcement-registry-adapter.rar
- outbound connection factory
- inbound activation spec
Transaction:
- query is non-transactional
- submit supports local transaction only
- inbound result is at-least-once
```

Answer:

1. What connector resources do you create?
2. What admin objects are needed?
3. What JNDI names do you choose?
4. What pool sizes do you start with?
5. Which operations are idempotent?
6. Do you use XA?
7. How do you avoid duplicate enforcement action?
8. How do you handle inbound duplicate result?
9. What metrics do you monitor?
10. What failure scenarios must be tested before production?

---

## 45. Referensi

Referensi utama:

- Eclipse GlassFish Application Development Guide, Release 8  
  https://glassfish.org/docs/latest/application-development-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Jakarta Connectors 2.1 Specification  
  https://jakarta.ee/specifications/connectors/2.1/jakarta-connectors-spec-2.1

- Jakarta Connectors 2.1 API  
  https://jakarta.ee/specifications/connectors/2.1/apidocs/

- Eclipse GlassFish OpenMQ / JMS Resource Adapter Context  
  https://eclipse-ee4j.github.io/openmq/

---

## 46. Status Seri

Part ini selesai.

Progress:

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
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 20 — Logging Architecture: Server Logs, App Logs, JUL, Log Rotation, Correlation
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-018.md">⬅️ Part 18 — Naming, JNDI, Resource References, dan Cross-Module Binding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-020.md">Part 20 — Logging Architecture: Server Logs, App Logs, JUL, Log Rotation, Correlation ➡️</a>
</div>
