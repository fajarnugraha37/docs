# Part 023 — Jakarta Common Annotations and Resource Injection

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-023.md`  
Status: Part 023 of 035  
Target Java: 8 sampai 25  
Target platform vocabulary: Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, EJB/Enterprise Beans, Servlet/Web container, full Jakarta EE runtime

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- CDI bean model
- scopes
- proxies
- qualifiers
- producers/disposers
- events
- interceptors
- decorators
- stereotypes
- lifecycle callbacks
- CDI extensions
- Enterprise Beans / EJB
- EJB transactions, timers, async, dan security boundary

Bagian ini membahas satu lapisan yang sering terlihat sederhana tetapi sangat penting di enterprise Java: **Jakarta Common Annotations dan resource injection**.

Topik ini penting karena banyak engineer mencampuradukkan beberapa hal berikut:

```text
@Inject      -> dependency injection berbasis CDI type/qualifier
@Resource    -> resource injection berbasis container/JNDI/resource reference
@PostConstruct -> lifecycle callback setelah injection selesai
@PreDestroy    -> lifecycle callback sebelum instance dihancurkan
@RolesAllowed  -> declarative security metadata
@Priority      -> ordering metadata untuk interceptor/alternative/provider tertentu
```

Secara permukaan semuanya annotation. Tetapi secara runtime, masing-masing annotation menjelaskan **kontrak yang berbeda**.

Kesalahan besar yang sering terjadi:

```java
@Inject DataSource dataSource;   // sering salah jika DataSource bukan CDI bean
@Resource DataSource dataSource; // resource dari container, bukan CDI bean biasa
```

Atau:

```java
@PostConstruct
public void init() {
    // melakukan koneksi eksternal berat tanpa timeout
    // lalu startup aplikasi menggantung
}
```

Atau:

```java
@RolesAllowed("ADMIN")
public void approve() { ... }
```

tetapi method dipanggil secara direct self-invocation sehingga security interceptor/container boundary tidak pernah dilewati.

Bagian ini akan membangun pemahaman bahwa annotation bukan dekorasi syntax. Annotation adalah **metadata contract** antara kode aplikasi dan container/runtime.

---

## 1. Mental Model Utama

### 1.1 Annotation adalah bahasa metadata untuk runtime

Di enterprise Java, annotation dipakai untuk memberi tahu container:

```text
"Object ini bukan object biasa. Tolong kelola lifecycle-nya."
"Field ini butuh resource dari environment."
"Method ini harus dipanggil setelah injection selesai."
"Method ini hanya boleh dipanggil oleh role tertentu."
"Interceptor ini punya urutan prioritas tertentu."
```

Annotation tidak selalu melakukan sesuatu sendiri.

Annotation hanya metadata. Yang membuatnya bermakna adalah:

- compiler
- annotation processor
- CDI container
- EJB container
- Servlet container
- Jakarta EE platform runtime
- framework integration
- build-time augmentation tool
- app server deployment processor

Jadi saat melihat annotation, pertanyaan top engineer bukan:

```text
Annotation ini syntax-nya apa?
```

Tetapi:

```text
Siapa yang membaca annotation ini?
Kapan annotation ini dibaca?
Di phase apa efeknya terjadi?
Apa syarat agar annotation ini aktif?
Apa failure mode jika container tidak mendukungnya?
Apakah efeknya terjadi melalui proxy/interceptor/container boundary?
```

---

### 1.2 `@Inject` dan `@Resource` bukan hal yang sama

Perbedaan paling penting:

```text
@Inject
  -> cari dependency dalam bean graph CDI berdasarkan type + qualifier

@Resource
  -> cari resource yang disediakan container/environment, biasanya melalui naming/resource reference/JNDI
```

Mental model:

```text
CDI bean graph:

  CaseService
      |
      | @Inject
      v
  CaseRepository
      |
      | @Inject
      v
  AuditPublisher

Resource graph:

  CaseRepository
      |
      | @Resource
      v
  java:comp/env/jdbc/CaseDS
      |
      v
  Container-managed DataSource
      |
      v
  DB connection pool / server resource definition
```

CDI menjawab:

```text
"Bean mana yang cocok untuk injection point ini?"
```

Resource injection menjawab:

```text
"Resource environment mana yang harus di-bind ke komponen ini?"
```

---

### 1.3 Resource injection adalah boundary ke dunia luar

Resource biasanya bukan domain object. Resource adalah handle ke kapabilitas eksternal/container:

- `DataSource`
- JMS connection factory
- JMS destination
- mail session
- executor service
- timer service tertentu
- web service reference
- environment entry
- resource adapter
- managed thread/executor

Artinya resource injection menghubungkan kode aplikasi ke:

- database
- message broker
- mail server
- external system
- container thread pool
- server-defined resource
- deployment descriptor
- infrastructure configuration

Karena itu resource injection adalah **runtime contract** antara aplikasi dan environment.

---

## 2. Jakarta Common Annotations: Posisi dan Evolusi

### 2.1 Dari `javax.annotation` ke `jakarta.annotation`

Pada era Java EE / Java 8, banyak annotation berada di package:

```java
javax.annotation.*
```

Pada era Jakarta EE 9+, namespace berubah menjadi:

```java
jakarta.annotation.*
```

Contoh:

```java
// Java EE / javax world
import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import javax.annotation.Resource;

// Jakarta EE / jakarta world
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
```

Perubahan namespace ini bukan sekadar import cleanup. Ia memengaruhi:

- source compatibility
- binary compatibility
- dependency graph
- application server compatibility
- transitive dependency compatibility
- library compatibility
- test runtime compatibility

Jika aplikasi Jakarta memakai `jakarta.annotation.PostConstruct`, tetapi runtime/framework hanya memproses `javax.annotation.PostConstruct`, callback bisa tidak terpanggil.

Sebaliknya, jika aplikasi masih memakai `javax.annotation.Resource` tetapi server Jakarta EE 10/11 hanya memproses namespace Jakarta, injection bisa gagal atau annotation diabaikan.

---

### 2.2 Java 8 sampai Java 25: apa yang berubah?

Untuk Java 8, sebagian annotation `javax.annotation` historically terasa seperti bagian dari platform Java standar.

Namun setelah modularisasi Java 9+ dan pergeseran Java EE/Jakarta EE, asumsi itu tidak aman lagi. Pada Java modern, jangan berpikir:

```text
"Annotation enterprise pasti tersedia dari JDK."
```

Pikirkan:

```text
"Annotation enterprise berasal dari API artifact/platform runtime yang sesuai."
```

Untuk build modern, dependency biasanya eksplisit:

```xml
<dependency>
  <groupId>jakarta.annotation</groupId>
  <artifactId>jakarta.annotation-api</artifactId>
  <version>3.0.0</version>
</dependency>
```

Pada Jakarta EE server, API bisa disediakan oleh server sehingga scope dependency bisa `provided`.

Untuk standalone/unit test, artifact mungkin perlu ada di test classpath.

---

## 3. Annotation yang Akan Dibahas

Bagian ini fokus pada annotation umum berikut:

```text
jakarta.annotation.PostConstruct
jakarta.annotation.PreDestroy
jakarta.annotation.Resource
jakarta.annotation.Resources
jakarta.annotation.Priority
jakarta.annotation.security.RolesAllowed
jakarta.annotation.security.PermitAll
jakarta.annotation.security.DenyAll
jakarta.annotation.security.DeclareRoles
jakarta.annotation.security.RunAs
jakarta.annotation.Generated
```

Beberapa annotation lain mungkin muncul sebagai konteks, tetapi fokus utamanya adalah annotation yang berdampak pada runtime container.

---

## 4. `@PostConstruct`: Initialization Setelah Injection

### 4.1 Makna runtime

`@PostConstruct` menandai method yang harus dipanggil setelah dependency injection selesai dan sebelum instance digunakan oleh application code/container.

Urutan mental model:

```text
1. Container membuat object
2. Constructor berjalan
3. Injection dilakukan
4. @PostConstruct dipanggil
5. Object siap dipakai
```

Diagram:

```text
new Bean()
   |
   v
constructor
   |
   v
field/method injection
   |
   v
@PostConstruct
   |
   v
ready for service
```

---

### 4.2 Apa yang aman dilakukan di `@PostConstruct`?

Aman:

- validasi dependency sudah tersedia
- validasi configuration required
- membuat struktur in-memory kecil
- precompute immutable mapping
- register local metadata
- initialize lightweight adapter
- fail-fast jika konfigurasi fatal invalid

Contoh:

```java
@ApplicationScoped
public class CaseRoutingPolicy {

    @Inject
    RoutingConfig config;

    private Map<String, EscalationLevel> routingTable;

    @PostConstruct
    void init() {
        this.routingTable = Map.copyOf(config.loadStaticRoutingTable());
        if (routingTable.isEmpty()) {
            throw new IllegalStateException("Routing table must not be empty");
        }
    }
}
```

---

### 4.3 Apa yang berbahaya dilakukan di `@PostConstruct`?

Berbahaya:

- external call tanpa timeout
- migration database besar
- membuka unmanaged thread
- memulai scheduler manual tanpa lifecycle control
- melakukan network call wajib ke service yang belum siap
- membaca secret lalu menulisnya ke log
- membuat koneksi manual tanpa cleanup
- menjalankan heavy warmup tanpa batas
- mengabaikan exception sehingga bean terlihat sehat padahal invalid

Contoh buruk:

```java
@PostConstruct
void init() {
    // buruk: tidak ada timeout, tidak ada fallback, startup bisa hang
    externalSystemClient.ping();

    // buruk: unmanaged thread di container runtime
    new Thread(this::runForever).start();
}
```

Versi lebih baik:

```java
@PostConstruct
void init() {
    config.validateRequiredValues();
    // External dependency readiness sebaiknya dicek oleh health check,
    // bukan selalu memblokir startup tanpa strategi.
}
```

---

### 4.4 Rule desain untuk `@PostConstruct`

Gunakan `@PostConstruct` untuk membuat instance **valid**, bukan untuk membuat seluruh dunia eksternal **pasti tersedia**.

Checklist:

```text
[ ] Apakah operasi init deterministic?
[ ] Apakah cepat?
[ ] Apakah memiliki timeout jika menyentuh I/O?
[ ] Apakah exception fatal memang harus menggagalkan deployment?
[ ] Apakah tidak membuat unmanaged resource?
[ ] Apakah cleanup-nya jelas jika init sebagian gagal?
[ ] Apakah tidak bergantung pada order startup implisit antar bean?
```

---

## 5. `@PreDestroy`: Cleanup Sebelum Instance Dihancurkan

### 5.1 Makna runtime

`@PreDestroy` menandai method yang dipanggil saat container akan menghancurkan instance.

Urutan mental model:

```text
active contextual instance
   |
   v
container decides to destroy
   |
   v
@PreDestroy
   |
   v
resource release
   |
   v
instance gone
```

---

### 5.2 Apa yang cocok dilakukan di `@PreDestroy`?

Cocok:

- close client/resource yang dibuat sendiri oleh bean
- flush buffer lokal
- unregister listener lokal
- stop local scheduler yang dikelola bean
- release cache in-memory jika perlu
- log shutdown event tanpa sensitive data

Contoh:

```java
@ApplicationScoped
public class ExternalGatewayClient implements AutoCloseable {

    private HttpClientWrapper client;

    @PostConstruct
    void init() {
        this.client = HttpClientWrapper.create();
    }

    @PreDestroy
    public void close() {
        if (client != null) {
            client.close();
        }
    }
}
```

---

### 5.3 Hal yang perlu diingat

`@PreDestroy` bukan tempat ideal untuk operasi bisnis kritikal.

Alasannya:

- shutdown bisa dipaksa
- container mungkin punya timeout shutdown
- node bisa mati tiba-tiba
- pod bisa di-kill
- process bisa crash
- network mungkin sudah tidak stabil

Jangan menaruh operasi seperti:

```text
"pastikan semua transaksi bisnis pending selesai"
```

hanya di `@PreDestroy`.

Untuk pekerjaan kritikal, gunakan mekanisme durable:

- database state
- transactional outbox
- message broker
- checkpoint
- idempotent retry
- graceful shutdown protocol

---

## 6. `@Resource`: Resource Injection

### 6.1 Makna utama

`@Resource` meminta container menghubungkan komponen dengan resource dari environment.

Contoh umum:

```java
@Resource(name = "jdbc/CaseDS")
private DataSource dataSource;
```

atau:

```java
@Resource(lookup = "java:global/jdbc/CaseDS")
private DataSource dataSource;
```

Mental model:

```text
Application code
   |
   | @Resource(name="jdbc/CaseDS")
   v
Component environment reference
   |
   v
JNDI/resource binding
   |
   v
Container-managed resource
   |
   v
Actual infrastructure resource
```

---

### 6.2 `name` vs `lookup` secara mental

Walau detail spesifik bisa bervariasi berdasarkan server dan versi spec, secara mental:

```text
name
  -> nama referensi resource di environment komponen

lookup
  -> nama JNDI target eksplisit yang akan dicari
```

Contoh:

```java
@Resource(name = "jdbc/CaseDS")
private DataSource ds;
```

Ini sering berarti aplikasi punya resource reference bernama `jdbc/CaseDS` di component environment. Container/deployment config dapat mengikat reference itu ke actual server resource.

Contoh lain:

```java
@Resource(lookup = "java:global/jdbc/CaseDS")
private DataSource ds;
```

Ini lebih eksplisit mengarah ke JNDI name tertentu.

Trade-off:

```text
name/resource reference
  + lebih portable secara deployment
  + bisa di-bind berbeda per environment
  - perlu konfigurasi deployment/server

lookup eksplisit
  + jelas target runtime-nya
  + mudah dibaca saat debugging
  - lebih mudah vendor/environment-coupled
```

---

### 6.3 Resource injection field vs method

Field injection:

```java
@Resource(name = "jdbc/CaseDS")
private DataSource dataSource;
```

Setter/method injection:

```java
private DataSource dataSource;

@Resource(name = "jdbc/CaseDS")
public void setDataSource(DataSource dataSource) {
    this.dataSource = dataSource;
}
```

Di enterprise Java lama, field injection sangat umum untuk resource. Namun untuk testability dan clarity, banyak tim modern membungkus resource dengan producer/adapter agar business code tidak langsung bergantung pada `@Resource`.

---

## 7. `@Resource` vs CDI Producer: Pola Modern yang Lebih Bersih

Alih-alih menyebar `@Resource DataSource` di banyak class, kita bisa memusatkan resource injection di satu producer/adapter.

Contoh:

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(name = "jdbc/CaseDS")
    private DataSource caseDataSource;

    @Produces
    @CaseDatabase
    public DataSource caseDataSource() {
        return caseDataSource;
    }
}
```

Kemudian business/infrastructure adapter memakai CDI:

```java
@ApplicationScoped
public class CaseJdbcRepository {

    private final DataSource dataSource;

    @Inject
    public CaseJdbcRepository(@CaseDatabase DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

Keuntungan:

```text
[+] Binding resource terpusat
[+] Business code tidak tersebar annotation container-specific
[+] Qualifier CDI bisa memberi makna domain
[+] Test bisa mengganti producer/bean
[+] Migration dari JNDI ke config/cloud secret lebih mudah
```

Namun hati-hati: jika producer hanya membungkus semua global lookup secara acak, ia bisa berubah menjadi service locator terselubung.

---

## 8. Environment Entry dengan `@Resource`

Resource tidak selalu datasource atau JMS. Bisa juga value sederhana dari environment.

Contoh konseptual:

```java
@Resource(name = "maxApprovalAmount")
private Integer maxApprovalAmount;
```

Namun untuk aplikasi modern, environment entry sering digantikan atau dilengkapi dengan:

- MicroProfile Config
- system properties
- environment variables
- Kubernetes ConfigMap/Secret
- cloud parameter store
- application config file

Kapan `@Resource` env-entry masih masuk akal?

```text
[+] Aplikasi masih strongly Jakarta EE/app-server centric
[+] Deployment descriptor sudah menjadi standar organisasi
[+] Resource binding dikontrol operator/server admin
[+] Value relatif statis per deployment
```

Kapan MicroProfile Config lebih cocok?

```text
[+] Butuh typed config yang lebih fleksibel
[+] Butuh banyak config source
[+] Butuh mapping env var modern
[+] Butuh override test lebih mudah
[+] Aplikasi berjalan di cloud/container
[+] Runtime tidak selalu full Jakarta EE server
```

---

## 9. `@Resources`: Mengelompokkan Resource Declaration

`@Resources` adalah container annotation untuk mendeklarasikan beberapa `@Resource`.

Contoh:

```java
@Resources({
    @Resource(name = "jdbc/CaseDS", type = DataSource.class),
    @Resource(name = "mail/NotificationSession", type = jakarta.mail.Session.class)
})
@ApplicationScoped
public class ResourceDeclarations {
}
```

Di praktik modern, annotation ini jarang muncul dibanding deklarasi resource eksplisit di server config/deployment descriptor atau konfigurasi platform.

Namun ia penting untuk membaca legacy code.

Saat melihat `@Resources`, jangan anggap itu dependency biasa. Itu deklarasi resource environment.

---

## 10. Resource Injection untuk `DataSource`

### 10.1 Contoh direct injection

```java
@ApplicationScoped
public class CaseJdbcGateway {

    @Resource(name = "jdbc/CaseDS")
    private DataSource dataSource;

    public CaseRecord findById(String id) throws SQLException {
        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement("select * from case_record where id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return map(rs);
            }
        }
    }
}
```

Hal penting:

```text
DataSource biasanya container-managed.
Connection yang didapat dari DataSource harus ditutup oleh aplikasi.
Menutup Connection biasanya mengembalikan connection ke pool, bukan mematikan physical DB connection.
```

---

### 10.2 Anti-pattern: menyimpan `Connection` sebagai field

Buruk:

```java
@ApplicationScoped
public class BadRepository {

    @Resource(name = "jdbc/CaseDS")
    private DataSource dataSource;

    private Connection connection;

    @PostConstruct
    void init() throws SQLException {
        this.connection = dataSource.getConnection();
    }
}
```

Masalah:

- connection leak
- thread safety buruk
- transaksi container bisa salah
- stale connection
- failover buruk
- pool starvation
- sulit cleanup

Lebih baik:

```java
try (Connection connection = dataSource.getConnection()) {
    // use connection per operation boundary
}
```

---

## 11. Resource Injection untuk JMS

Contoh konseptual:

```java
@ApplicationScoped
public class AuditMessageSender {

    @Resource(lookup = "java:/jms/queue/AuditQueue")
    private Queue auditQueue;

    @Resource(lookup = "java:/jms/ConnectionFactory")
    private ConnectionFactory connectionFactory;

    public void send(AuditMessage message) {
        // create context/session/producer depending on JMS version and runtime
    }
}
```

Mental model:

```text
@Resource Queue
  -> reference ke destination

@Resource ConnectionFactory
  -> resource untuk membuat connection/session/context ke broker
```

Jangan mencampuradukkan:

```text
Queue object injection != message sudah dikirim
ConnectionFactory injection != active connection selalu terbuka
```

Resource injection hanya menyediakan handle.

Lifecycle koneksi/penggunaan tetap harus sesuai API JMS dan container policy.

---

## 12. Resource Injection untuk Managed Executor

Pada Jakarta EE, membuat thread manual bukan praktik aman.

Buruk:

```java
new Thread(() -> process()).start();
```

Lebih container-friendly:

```java
@Resource
private ManagedExecutorService executor;
```

Kemudian:

```java
executor.submit(() -> process());
```

Kenapa?

Container perlu mengelola:

- thread lifecycle
- shutdown
- context propagation tertentu
- security boundary
- resource accounting
- monitoring
- backpressure policy

Catatan: detail context propagation bisa membutuhkan Jakarta Concurrency/MicroProfile Context Propagation tergantung runtime dan kebutuhan.

---

## 13. `@Generated`

`@Generated` dipakai untuk menandai source yang dihasilkan tool/code generator.

Contoh:

```java
@Generated(
    value = "com.example.codegen.DtoGenerator",
    date = "2026-06-16T10:15:30Z",
    comments = "Generated from enforcement-case-schema.yaml"
)
public class GeneratedCaseDto {
}
```

Manfaat:

- membantu tool static analysis
- membedakan code manual vs generated
- membantu exclude coverage tertentu
- membantu audit generation source

Namun jangan gunakan `@Generated` untuk menyembunyikan code buruk dari quality gate tanpa governance.

Rule yang lebih sehat:

```text
Generated code boleh dikecualikan dari style manual,
tetapi generator-nya harus diuji dan versioned.
```

---

## 14. `@Priority`

`@Priority` adalah metadata ordering.

Di CDI/interceptor context, priority sering memengaruhi urutan atau enablement.

Contoh:

```java
@Audited
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditInterceptor {
    @AroundInvoke
    Object around(InvocationContext ctx) throws Exception {
        return ctx.proceed();
    }
}
```

Mental model:

```text
@Priority tidak berarti "lebih penting secara bisnis".
@Priority berarti "runtime ordering/selection metadata".
```

Gunakan dengan disiplin:

```text
[ ] Apakah urutan interceptor terdokumentasi?
[ ] Apakah priority number tidak magic?
[ ] Apakah ada konvensi range priority tim?
[ ] Apakah perubahan priority diuji?
```

Contoh konvensi:

```java
public final class RuntimePriorities {
    public static final int CORRELATION = 1000;
    public static final int SECURITY_AUDIT = 1100;
    public static final int IDEMPOTENCY = 1200;
    public static final int METRICS = 3000;

    private RuntimePriorities() {}
}
```

Lalu:

```java
@Priority(RuntimePriorities.SECURITY_AUDIT)
```

---

## 15. Security Annotations

Package umum:

```java
jakarta.annotation.security.*
```

Annotation penting:

```text
@RolesAllowed
@PermitAll
@DenyAll
@DeclareRoles
@RunAs
```

---

### 15.1 `@RolesAllowed`

Contoh:

```java
@Stateless
public class ApprovalService {

    @RolesAllowed({"CASE_MANAGER", "SUPERVISOR"})
    public void approve(String caseId) {
        // approval logic
    }
}
```

Makna:

```text
Method hanya boleh dijalankan oleh caller dengan role tertentu,
sejauh runtime/container/security interceptor mendukung dan invocation melewati boundary yang diproses.
```

Hal penting:

```text
Annotation ini bukan pengganti domain authorization.
```

`@RolesAllowed` baik untuk coarse-grained access:

```text
"hanya officer boleh akses operation ini"
```

Tetapi domain rule tetap perlu code/policy:

```text
"officer ini hanya boleh approve case pada agency/division tertentu"
"case dengan status escalated butuh supervisor"
"user tidak boleh approve case yang dia submit sendiri"
```

---

### 15.2 `@PermitAll`

```java
@PermitAll
public CaseSummary viewPublicSummary(String caseId) {
    return ...;
}
```

Makna:

```text
Semua authenticated/allowed caller menurut container policy boleh masuk.
```

Tergantung runtime/security setup, `PermitAll` bukan selalu berarti anonymous public internet endpoint. Jangan gunakan tanpa memahami security layer di atasnya.

---

### 15.3 `@DenyAll`

```java
@DenyAll
public void dangerousOperation() {
    ...
}
```

Makna:

```text
Tidak ada role yang boleh invoke method ini melalui container security boundary.
```

Use case:

- method reserved for internal framework path
- operation disabled
- inherited method yang harus ditutup
- temporary hard block during migration

Namun jangan jadikan `@DenyAll` sebagai feature flag. Untuk feature enable/disable, gunakan feature flag atau config yang eksplisit dan observable.

---

### 15.4 `@DeclareRoles`

Contoh:

```java
@DeclareRoles({"CASE_OFFICER", "CASE_MANAGER", "SYSTEM_ADMIN"})
@Stateless
public class CaseService {
}
```

Makna:

```text
Mendeklarasikan role security yang digunakan aplikasi/komponen.
```

Di aplikasi modern, role mapping sering juga berada di:

- deployment descriptor
- app server config
- identity provider mapping
- OIDC/SAML claims mapping
- Keycloak/client roles/realm roles
- application authorization policy

Jadi `@DeclareRoles` bukan keseluruhan IAM model.

---

### 15.5 `@RunAs`

`@RunAs` memungkinkan komponen menjalankan call berikutnya dengan identity/role tertentu menurut container security model.

Contoh konseptual:

```java
@RunAs("SYSTEM_AUDITOR")
@Stateless
public class AuditBridgeBean {
    public void publishSystemAudit(...) {
        ...
    }
}
```

Gunakan dengan sangat hati-hati.

Risiko:

- privilege escalation tidak disengaja
- audit trail membingungkan
- caller asli hilang jika tidak dicatat
- policy menjadi tersembunyi di annotation

Rule sehat:

```text
Jika menggunakan RunAs, selalu dokumentasikan:
- caller asli
- effective identity
- alasan privilege switch
- operation yang boleh dilakukan
- audit record yang wajib dibuat
```

---

## 16. Declarative Security vs Domain Authorization

Ini salah satu pemisahan paling penting.

Declarative security:

```java
@RolesAllowed("CASE_MANAGER")
public void approveCase(String caseId) { ... }
```

Menjawab:

```text
Apakah caller punya role global/teknis yang boleh masuk method ini?
```

Domain authorization:

```java
if (!policy.canApprove(user, caseRecord)) {
    throw new ForbiddenOperationException(...);
}
```

Menjawab:

```text
Apakah caller ini boleh melakukan action ini terhadap entity ini dalam state ini?
```

Untuk sistem regulatory/case management, domain authorization biasanya lebih penting daripada role annotation saja.

Contoh:

```text
Role: ENFORCEMENT_OFFICER
Case status: PENDING_APPROVAL
Assigned agency: CEA
Officer agency: CEA
Officer is submitter: false
Case severity: HIGH
Required approval level: SUPERVISOR
```

Policy bukan sekadar:

```text
user has role ENFORCEMENT_OFFICER
```

Tetapi:

```text
user has sufficient role
AND belongs to correct agency
AND is not conflicted
AND case is in approvable state
AND required escalation level satisfied
AND workflow transition allowed
```

Jadi annotation security adalah **outer gate**, bukan seluruh policy engine.

---

## 17. Invocation Boundary: Annotation Bisa Tidak Berefek Jika Tidak Lewat Container

Contoh masalah:

```java
@ApplicationScoped
public class CaseService {

    public void process(String caseId) {
        approve(caseId); // self-invocation
    }

    @RolesAllowed("SUPERVISOR")
    public void approve(String caseId) {
        ...
    }
}
```

Jika security diterapkan melalui proxy/interceptor/container boundary, call `this.approve()` bisa melewati mekanisme tersebut.

Masalah sama terjadi untuk:

- interceptor
- transaction boundary
- async annotation
- security annotation
- metrics interceptor
- audit interceptor

Rule:

```text
Declarative behavior biasanya aktif saat invocation melewati managed reference/proxy/container boundary.
```

Solusi desain:

```java
@ApplicationScoped
public class CaseProcessingService {

    @Inject
    ApprovalService approvalService;

    public void process(String caseId) {
        approvalService.approve(caseId);
    }
}

@ApplicationScoped
public class ApprovalService {

    @RolesAllowed("SUPERVISOR")
    public void approve(String caseId) {
        ...
    }
}
```

---

## 18. CDI `@Inject` vs `@Resource`: Decision Matrix

| Kebutuhan | Pilihan Utama | Alasan |
|---|---|---|
| Inject service/domain/application component | `@Inject` | Bean graph type-safe |
| Inject implementation by qualifier | `@Inject` + qualifier | CDI resolution |
| Inject container-managed datasource | `@Resource` atau producer wrapper | Resource dari environment |
| Inject JMS destination/factory | `@Resource` atau messaging abstraction | Resource binding |
| Inject config value modern | MicroProfile Config | Typed config source precedence |
| Inject env-entry legacy Jakarta EE | `@Resource` | Component environment |
| Inject test replacement | CDI alternative/producer/mock | Lebih mudah dikendalikan |
| Direct JNDI lookup | Hindari kecuali boundary khusus | Coupling tinggi |

---

## 19. Anti-Pattern Catalog

### 19.1 Menyebar `@Resource` di semua class

Buruk:

```java
public class A { @Resource DataSource ds; }
public class B { @Resource DataSource ds; }
public class C { @Resource DataSource ds; }
public class D { @Resource DataSource ds; }
```

Masalah:

- binding tersebar
- sulit test
- sulit migrasi
- sulit audit resource usage
- coupling ke container makin luas

Lebih baik:

```text
Resource boundary terpusat -> producer/adapter -> CDI qualifier/domain abstraction
```

---

### 19.2 Menganggap `@Resource` sama dengan config modern

Buruk:

```java
@Resource(name = "featureXEnabled")
private Boolean featureXEnabled;
```

Jika feature flag perlu runtime dynamic, audit, rollout, targeting, atau kill switch, `@Resource` env-entry terlalu statis.

Lebih baik gunakan feature flag service/config layer.

---

### 19.3 Menaruh domain authorization hanya di `@RolesAllowed`

Buruk:

```java
@RolesAllowed("OFFICER")
public void closeCase(String caseId) {
    repository.close(caseId);
}
```

Lebih baik:

```java
@RolesAllowed("OFFICER")
public void closeCase(String caseId) {
    CaseRecord record = repository.find(caseId);
    policy.assertCanClose(currentUser(), record);
    repository.close(caseId);
}
```

---

### 19.4 Heavy startup di `@PostConstruct`

Buruk:

```java
@PostConstruct
void init() {
    loadMillionsOfRowsIntoMemory();
    callAllExternalServices();
    runSchemaMigration();
}
```

Lebih baik:

- schema migration di migration tool
- readiness check untuk external dependency
- lazy cache dengan bounded loading
- startup validation minimal
- background warmup dengan managed executor dan observability

---

### 19.5 Direct JNDI lookup di business logic

Buruk:

```java
public void process() {
    DataSource ds = (DataSource) new InitialContext().lookup("java:comp/env/jdbc/CaseDS");
    ...
}
```

Masalah:

- service locator
- sulit test
- hidden dependency
- runtime failure terlambat
- coupling tinggi

Lebih baik:

```java
@Inject
public CaseService(CaseRepository repository) { ... }
```

Dan resource lookup hanya di boundary adapter/producer.

---

## 20. Resource Injection dan Deployment Descriptor

Annotation bukan satu-satunya sumber metadata.

Enterprise Java historically mendukung:

```text
annotation metadata
+ deployment descriptor
+ server resource configuration
+ vendor-specific deployment descriptor
+ runtime admin config
```

Contoh file yang bisa terlibat:

```text
web.xml
ejb-jar.xml
application.xml
server.xml
standalone.xml
domain.xml
glassfish-resources.xml
weblogic.xml
jboss-web.xml
vendor-specific resource config
```

Mental model:

```text
Application declares what it needs.
Deployment/server binds it to what environment provides.
```

Contoh:

```text
App says:
  I need jdbc/CaseDS

Server says in DEV:
  jdbc/CaseDS -> dev Oracle datasource

Server says in UAT:
  jdbc/CaseDS -> uat Oracle datasource

Server says in PROD:
  jdbc/CaseDS -> prod Oracle datasource
```

Ini adalah separation yang sehat jika dikelola dengan governance.

---

## 21. JNDI Namespace Mental Model

JNDI akan dibahas lebih dalam di Part 024. Namun untuk resource injection, kita perlu gambaran awal.

Namespace umum:

```text
java:comp/env
java:module
java:app
java:global
```

Mental model sederhana:

```text
java:comp/env
  -> environment milik komponen

java:module
  -> namespace module

java:app
  -> namespace aplikasi

java:global
  -> namespace global runtime/server
```

Jika `@Resource(name = "jdbc/CaseDS")` dipakai tanpa namespace eksplisit, container biasanya menginterpretasikan sebagai reference di component environment.

Jangan menghafal nama saja. Pahami level isolasinya.

---

## 22. Resource Injection dalam WAR, EJB-JAR, dan EAR

### 22.1 WAR

Dalam web application:

- Servlet/JAX-RS/CDI bean bisa membutuhkan resource
- resource reference bisa dideklarasikan di `web.xml`
- server mengikat resource ke web app context

Contoh:

```text
WAR
 ├── WEB-INF/classes
 ├── WEB-INF/lib
 ├── WEB-INF/web.xml
 └── resource references
```

---

### 22.2 EJB-JAR

Dalam EJB module:

- session bean sering memakai `@Resource`
- EJB container menyediakan transaction/security/resource integration
- resource reference bisa muncul di `ejb-jar.xml`

---

### 22.3 EAR

Dalam EAR:

- beberapa module berbagi aplikasi
- namespace `java:app` menjadi relevan
- classloader/resource binding lebih kompleks

Masalah umum:

```text
Resource dideklarasikan di module A tetapi dipakai di module B.
JNDI name valid di satu module tetapi tidak di module lain.
Server-specific binding tidak konsisten antar environment.
```

---

## 23. Testing Code yang Menggunakan `@Resource`

### 23.1 Masalah unit test

Jika class langsung bergantung pada `@Resource`, unit test plain Java tidak otomatis menginjeksi field.

Contoh:

```java
public class CaseJdbcGatewayTest {

    @Test
    void testFindById() {
        CaseJdbcGateway gateway = new CaseJdbcGateway();
        // dataSource null karena container tidak berjalan
    }
}
```

Solusi buruk:

```java
ReflectionTestUtils.setField(gateway, "dataSource", fakeDs);
```

Bisa dipakai sementara, tetapi bukan desain ideal.

---

### 23.2 Solusi desain: adapter constructor injection

```java
@ApplicationScoped
public class CaseJdbcGateway {

    private final DataSource dataSource;

    @Inject
    public CaseJdbcGateway(@CaseDatabase DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

Producer:

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(name = "jdbc/CaseDS")
    private DataSource ds;

    @Produces
    @CaseDatabase
    DataSource caseDatabase() {
        return ds;
    }
}
```

Test:

```java
DataSource fake = createFakeDataSource();
CaseJdbcGateway gateway = new CaseJdbcGateway(fake);
```

Ini membuat business/adapter logic lebih testable tanpa container penuh.

---

### 23.3 Container integration test

Untuk memastikan resource binding benar, tetap perlu test/deployment validation di runtime target.

Unit test menjawab:

```text
Apakah logic repository benar jika diberi DataSource?
```

Integration/container test menjawab:

```text
Apakah runtime menyediakan jdbc/CaseDS dan injection/binding berhasil?
```

Keduanya berbeda.

---

## 24. Production Failure Model

### 24.1 Resource not found

Gejala:

```text
NameNotFoundException
DeploymentException
resource lookup failed
injection target not satisfied
```

Kemungkinan penyebab:

- resource belum dibuat di server
- nama JNDI salah
- namespace salah
- resource hanya ada di environment tertentu
- descriptor tidak terdeploy
- lookup name vendor-specific berubah
- module tidak punya akses ke resource

Diagnosis:

```text
[ ] Cek nama di annotation
[ ] Cek deployment descriptor
[ ] Cek server resource config
[ ] Cek namespace java:comp/env vs java:global
[ ] Cek environment DEV/UAT/PROD parity
[ ] Cek log deployment processor
```

---

### 24.2 Wrong resource bound

Gejala:

```text
Aplikasi jalan tetapi connect ke DB yang salah.
Message masuk queue environment lain.
Email terkirim ke SMTP yang salah.
```

Ini lebih berbahaya daripada resource not found.

Mitigasi:

```text
[ ] Startup log non-sensitive resource identity
[ ] Validate DB schema/environment marker
[ ] Validate endpoint allowlist
[ ] Separate credential per environment
[ ] Prevent PROD app using DEV resource and vice versa
[ ] Runtime health endpoint menampilkan environment fingerprint aman
```

Contoh environment fingerprint aman:

```text
DB schema: ACEAS_PROD_APP
DB host alias: prod-rds-cluster-01
Application environment: PROD
Build version: 2026.06.16.1
```

Jangan log password, token, full JDBC URL jika mengandung secret.

---

### 24.3 Resource leak

Penyebab umum:

- connection tidak ditutup
- JMS context/session tidak ditutup
- stream tidak ditutup
- executor manual tidak dimatikan
- producer membuat resource tanpa disposer
- `@PreDestroy` tidak membersihkan resource custom

Gejala:

```text
Connection pool exhausted
Thread count naik terus
Memory leak
File descriptor leak
Slow shutdown
Intermittent timeout
```

Mitigasi:

```text
[ ] try-with-resources
[ ] disposer method untuk producer
[ ] @PreDestroy untuk resource milik bean
[ ] use container-managed resource where possible
[ ] metrics pool usage
[ ] leak detection threshold
```

---

### 24.4 Security annotation tidak aktif

Kemungkinan penyebab:

- method dipanggil via self-invocation
- class bukan managed component
- security belum dikonfigurasi
- role mapping tidak sesuai
- annotation di private method
- runtime tidak memproses annotation untuk tipe komponen tersebut
- test berjalan tanpa security container

Diagnosis:

```text
[ ] Apakah object dibuat oleh container?
[ ] Apakah invocation lewat proxy/container boundary?
[ ] Apakah role mapping dari IdP ke container benar?
[ ] Apakah annotation ditempatkan di method/class yang tepat?
[ ] Apakah endpoint/security layer luar sudah authenticate caller?
```

---

## 25. Design Pattern: Resource Boundary Adapter

Untuk sistem besar, pola yang sehat:

```text
[Container Resource]
        |
        | @Resource
        v
[Resource Producer / Infrastructure Boundary]
        |
        | @Produces + Qualifier
        v
[Infrastructure Adapter]
        |
        | interface
        v
[Application Service]
        |
        v
[Domain Policy]
```

Contoh:

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD})
public @interface CaseDatabase {}
```

```java
@ApplicationScoped
public class ResourceBoundary {

    @Resource(name = "jdbc/CaseDS")
    private DataSource caseDs;

    @Produces
    @CaseDatabase
    public DataSource caseDataSource() {
        return caseDs;
    }
}
```

```java
@ApplicationScoped
public class JdbcCaseRepository implements CaseRepository {

    private final DataSource dataSource;

    @Inject
    public JdbcCaseRepository(@CaseDatabase DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

```java
@ApplicationScoped
public class CloseCaseUseCase {

    private final CaseRepository repository;
    private final CasePolicy policy;

    @Inject
    public CloseCaseUseCase(CaseRepository repository, CasePolicy policy) {
        this.repository = repository;
        this.policy = policy;
    }
}
```

Keuntungan arsitektural:

- resource binding tidak bocor ke use case
- test use case tidak perlu app server
- datasource bisa diganti saat migration
- domain tidak tahu JNDI
- observability resource bisa dikonsentrasikan

---

## 26. Design Pattern: Security Outer Gate + Domain Policy Inner Gate

```java
@ApplicationScoped
public class CaseApprovalUseCase {

    private final CaseRepository repository;
    private final CasePolicy policy;
    private final CurrentUser currentUser;

    @Inject
    public CaseApprovalUseCase(
            CaseRepository repository,
            CasePolicy policy,
            CurrentUser currentUser
    ) {
        this.repository = repository;
        this.policy = policy;
        this.currentUser = currentUser;
    }

    @RolesAllowed({"CASE_MANAGER", "SUPERVISOR"})
    public void approve(String caseId) {
        CaseRecord record = repository.requireById(caseId);
        User user = currentUser.require();

        policy.assertCanApprove(user, record);

        record.approveBy(user.id());
        repository.save(record);
    }
}
```

Layering:

```text
@RolesAllowed
  -> coarse-grained role gate

policy.assertCanApprove
  -> fine-grained domain gate
```

Untuk regulatory system, pola ini jauh lebih defensible daripada hanya annotation role.

---

## 27. Design Pattern: Startup Validation Without Startup Fragility

Buruk:

```java
@PostConstruct
void init() {
    externalApiClient.callRequiredEndpoint();
}
```

Lebih baik:

```java
@PostConstruct
void init() {
    config.validate();
    localRules = ruleLoader.loadFromClasspathOrConfig();
}
```

Readiness check:

```java
@ApplicationScoped
public class ExternalSystemReadiness {

    public HealthStatus check() {
        return externalApiClient.pingWithTimeout(Duration.ofSeconds(2));
    }
}
```

Mental model:

```text
Startup validation:
  "Apakah instance valid secara konfigurasi?"

Readiness:
  "Apakah dependency eksternal siap menerima traffic?"
```

Jangan campur semuanya di `@PostConstruct`.

---

## 28. Java 8–25 Compatibility Notes

### 28.1 Java 8

- Banyak legacy code masih memakai `javax.annotation.*`.
- Java EE 7/8 app server umum.
- EJB/JNDI/resource injection masih sering dominan.

### 28.2 Java 11+

- Jangan mengasumsikan `javax.annotation` tersedia dari JDK.
- Dependency API perlu eksplisit jika standalone/non-container.
- Migration pressure ke Jakarta mulai terasa.

### 28.3 Java 17+

- Jakarta EE 10/11 modern baseline umumnya memakai Java 11/17+ tergantung platform/version.
- Jakarta EE 11 mensyaratkan Java SE 17+.
- Namespace Jakarta adalah arah modern.

### 28.4 Java 21–25

- Virtual threads membuat concurrency model makin menarik, tetapi container-managed resource/thread model tetap penting.
- Jangan langsung mengganti managed executor dengan thread manual tanpa memahami container contract.
- Annotation/resource injection tetap platform-level concern, bukan Java language feature semata.

---

## 29. Practical Checklist untuk Code Review

Saat review kode enterprise Java yang memakai annotation/resource injection, cek:

```text
[ ] Apakah annotation namespace benar? javax atau jakarta?
[ ] Apakah runtime target mendukung namespace tersebut?
[ ] Apakah class dikelola container?
[ ] Apakah @PostConstruct tidak melakukan heavy blocking I/O tanpa timeout?
[ ] Apakah @PreDestroy hanya cleanup best-effort?
[ ] Apakah @Resource dipakai hanya di boundary yang tepat?
[ ] Apakah DataSource/Connection digunakan dengan try-with-resources?
[ ] Apakah resource binding terpusat atau tersebar?
[ ] Apakah @RolesAllowed hanya coarse gate, bukan domain policy final?
[ ] Apakah invocation melewati proxy/container boundary?
[ ] Apakah JNDI name portable atau vendor-specific?
[ ] Apakah DEV/UAT/PROD resource binding tervalidasi?
[ ] Apakah secret tidak pernah dilog?
[ ] Apakah test bisa berjalan tanpa full app server untuk logic murni?
[ ] Apakah integration test memvalidasi resource binding runtime?
```

---

## 30. Interview-Level Understanding

Jika ditanya:

```text
Apa perbedaan @Inject dan @Resource?
```

Jawaban top-level:

```text
@Inject adalah CDI/Jakarta Inject dependency injection berbasis type-safe bean resolution.
Container mencari bean yang cocok berdasarkan type dan qualifier.
@Resource adalah resource injection berbasis component environment/resource reference/JNDI.
Ia digunakan untuk resource yang disediakan container seperti DataSource, JMS resource,
executor, mail session, atau env-entry. Jadi @Inject menghubungkan object graph aplikasi,
sedangkan @Resource menghubungkan komponen dengan resource environment.
```

Jika ditanya:

```text
Kapan @PostConstruct dipanggil?
```

Jawaban:

```text
Setelah object dibuat dan dependency injection selesai, tetapi sebelum instance digunakan
untuk melayani invocation. Ini cocok untuk validasi dan initialization ringan, bukan untuk
heavy external startup work tanpa timeout.
```

Jika ditanya:

```text
Apakah @RolesAllowed cukup untuk authorization?
```

Jawaban:

```text
Tidak selalu. @RolesAllowed bagus untuk coarse-grained declarative security pada boundary
container, tetapi sistem bisnis biasanya membutuhkan domain authorization yang melihat entity,
state, ownership, agency, conflict, escalation level, dan workflow transition. Untuk sistem
regulatory, role annotation harus dipadukan dengan policy check eksplisit.
```

Jika ditanya:

```text
Mengapa annotation security/interceptor kadang tidak aktif?
```

Jawaban:

```text
Karena declarative behavior biasanya diterapkan saat invocation melewati managed proxy atau
container boundary. Self-invocation, object yang dibuat manual dengan new, private method,
atau runtime yang tidak memproses annotation tersebut dapat membuat annotation tidak berefek.
```

---

## 31. Ringkasan Mental Model

Bagian ini bisa diringkas sebagai berikut:

```text
Annotation is metadata.
Container gives metadata meaning.
```

```text
@Inject
  -> application bean graph

@Resource
  -> environment/resource graph

@PostConstruct
  -> after injection, before service

@PreDestroy
  -> before container destroys instance

@RolesAllowed / @PermitAll / @DenyAll
  -> declarative security boundary

@Priority
  -> ordering/selection metadata
```

Jangan melihat annotation sebagai magic. Lihat sebagai kontrak:

```text
Who reads it?
When is it read?
What runtime phase does it affect?
What boundary must invocation pass?
What happens if resource/config/security mapping is missing?
```

---

## 32. Latihan Praktis

### Latihan 1 — Refactor direct resource injection

Diberikan:

```java
@ApplicationScoped
public class ReportRepository {
    @Resource(name = "jdbc/ReportDS")
    private DataSource ds;
}
```

Refactor menjadi:

```text
@Resource hanya di ResourceBoundary/Producer.
Repository memakai constructor injection + qualifier.
```

Tujuan:

- memisahkan container resource binding dari repository logic
- meningkatkan testability
- memberi nama domain pada datasource melalui qualifier

---

### Latihan 2 — Pisahkan security gate dan domain policy

Diberikan:

```java
@RolesAllowed("OFFICER")
public void closeCase(String caseId) {
    repository.close(caseId);
}
```

Tambahkan:

- current user
- load case record
- policy check
- state transition validation
- audit reason

Tujuan:

- tidak mengandalkan role saja
- membuat authorization defensible

---

### Latihan 3 — Analisis startup failure

Diberikan error:

```text
NameNotFoundException: jdbc/CaseDS not found
```

Buat checklist investigasi:

- annotation name
- descriptor
- server config
- namespace
- environment parity
- module boundary
- deployment logs

---

### Latihan 4 — Audit `@PostConstruct`

Cari semua `@PostConstruct` di project dan klasifikasikan:

```text
SAFE:
  - local validation
  - small immutable setup

RISKY:
  - network call
  - DB query besar
  - thread creation
  - scheduler start
  - secret logging
  - migration logic
```

---

## 33. Apa yang Tidak Dibahas Mendalam di Part Ini

Agar tidak mengulang dan tetap efisien:

- Detail CDI lifecycle sudah dibahas di Part 018.
- Detail interceptor sudah dibahas di Part 015.
- Detail EJB security/transaction sudah dibahas di Part 022.
- Detail JNDI namespace akan dibahas lebih dalam di Part 024.
- Detail MicroProfile Config akan dibahas di Part 026.
- Detail feature flags akan dibahas di Part 028.

---

## 34. Preview Part Berikutnya

Part berikutnya:

```text
Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources
```

Kita akan masuk lebih detail ke:

- JNDI mental model
- `java:comp/env`
- `java:module`
- `java:app`
- `java:global`
- resource reference
- env-entry
- resource-ref
- portable vs vendor-specific JNDI name
- deployment descriptor vs annotation
- binding resource per environment
- bridging JNDI resource ke CDI producer
- failure diagnosis untuk naming/resource binding

---

## 35. Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
[x] Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
[x] Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
[x] Part 009 — Bean Discovery and Archive Model
[x] Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
[x] Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
[x] Part 012 — Qualifiers, Alternatives, Specialization, and Priority
[x] Part 013 — Producers and Disposers: Programmatic Object Supply
[x] Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
[x] Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
[x] Part 016 — Decorators: Semantic Wrapping of Business Interfaces
[x] Part 017 — Stereotypes and Annotation Composition
[x] Part 018 — Lifecycle Callbacks: Construction, Initialization, Destruction
[x] Part 019 — CDI Extensions and Portable Runtime Customization
[x] Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters
[x] Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics
[x] Part 022 — EJB Transactions, Timers, Async, and Security Boundaries
[x] Part 023 — Jakarta Common Annotations and Resource Injection
```

Belum selesai. Lanjut ke:

```text
[ ] Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources
```
