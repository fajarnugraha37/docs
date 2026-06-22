# Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-020.md`  
Status: Part 020 of 035  
Target Java: Java 8 sampai Java 25  
Target Platform: Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI-based enterprise runtimes

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **Enterprise Beans**, dulu dikenal sebagai **EJB — Enterprise JavaBeans**, dari sudut pandang engineer modern.

Targetnya bukan membuat kita nostalgia pada arsitektur enterprise lama, dan bukan juga langsung menyimpulkan “EJB sudah mati”. Target yang benar adalah:

1. memahami mengapa EJB pernah menjadi pusat enterprise Java,
2. memahami runtime service apa yang diberikan EJB container,
3. membedakan mana bagian EJB yang masih relevan dan mana yang legacy,
4. memahami hubungan EJB dengan CDI,
5. mampu membaca, merawat, memigrasikan, atau mengganti EJB secara rasional,
6. mampu mengambil keputusan: keep, wrap, migrate, retire.

Top engineer tidak menilai teknologi hanya dari hype. Top engineer melihat:

- **runtime contract**,
- **failure mode**,
- **operational cost**,
- **migration risk**,
- **semantic guarantee**,
- **compatibility boundary**,
- **cost of replacing behavior that was previously supplied by container**.

EJB/Enterprise Beans adalah contoh sangat bagus dari teknologi yang sering diremehkan karena sintaksnya terlihat tua, padahal beberapa konsepnya masih hidup di banyak framework modern:

- transaction boundary,
- method-level security,
- async execution,
- scheduled job/timer,
- remoting boundary,
- pooling,
- lifecycle callback,
- container-managed concurrency,
- declarative metadata via annotation,
- business method invocation through proxy.

Banyak framework modern tidak menghapus konsep EJB. Mereka hanya **mengemas ulang** konsepnya dengan model yang lebih ringan, cloud-friendly, build-time friendly, atau developer-friendly.

---

## 1. Posisi Enterprise Beans dalam Peta Besar Enterprise Java

Sebelum CDI populer, sebelum Spring menjadi dominan di banyak enterprise stack, dan sebelum microservice/cloud-native menjadi default mental model, EJB adalah salah satu pusat pemrograman enterprise Java.

EJB lahir untuk menjawab masalah yang sangat nyata:

> Bagaimana membuat komponen bisnis server-side yang bisa mendapatkan transaction management, security, pooling, lifecycle, remoting, timer, dan resource access tanpa setiap aplikasi menulis infrastructure code sendiri?

Tanpa container, service bisnis sering berisi campuran seperti ini:

```java
public class PaymentService {
    public PaymentResult pay(PaymentCommand command) {
        Connection connection = null;
        try {
            connection = dataSource.getConnection();
            connection.setAutoCommit(false);

            if (!securityContext.hasRole("PAYMENT_APPROVER")) {
                throw new SecurityException();
            }

            // business logic
            // update database
            // call audit
            // call notification

            connection.commit();
            return PaymentResult.success();
        } catch (Exception e) {
            rollbackQuietly(connection);
            throw e;
        } finally {
            closeQuietly(connection);
        }
    }
}
```

Masalah dari kode seperti itu:

- business logic bercampur dengan transaction handling,
- security check tersebar,
- resource cleanup rawan bocor,
- concurrency dan pooling tidak eksplisit,
- test sulit,
- error handling tidak seragam,
- semua tim membuat mini-framework sendiri.

EJB mencoba memindahkan concern tersebut ke container:

```java
@Stateless
@RolesAllowed("PAYMENT_APPROVER")
public class PaymentService {

    @PersistenceContext
    private EntityManager em;

    public PaymentResult pay(PaymentCommand command) {
        // business logic only
        return PaymentResult.success();
    }
}
```

Pada contoh ini, banyak hal terjadi tanpa terlihat langsung di body method:

- instance dibuat oleh container,
- dependency diinjeksi oleh container,
- method dipanggil melalui proxy/container invocation chain,
- security dicek sebelum business method,
- transaction dibuka/bergabung sesuai default/annotation,
- exception menentukan commit/rollback behavior,
- instance mungkin berasal dari pool,
- lifecycle diatur oleh container.

Ini adalah inti Enterprise Beans:

> Enterprise Beans adalah model komponen bisnis server-side yang lifecycle dan cross-cutting runtime behavior-nya dimiliki oleh container.

---

## 2. Nama: EJB vs Jakarta Enterprise Beans

Secara historis, istilah yang umum adalah **EJB** atau **Enterprise JavaBeans**.

Di era Jakarta EE modern, nama spesifikasinya adalah **Jakarta Enterprise Beans**.

Namespace berubah:

```text
Java EE / Jakarta EE 8 era:
javax.ejb.*

Jakarta EE 9+ era:
jakarta.ejb.*
```

Contoh lama:

```java
import javax.ejb.Stateless;

@Stateless
public class CaseAssignmentService {
}
```

Contoh modern:

```java
import jakarta.ejb.Stateless;

@Stateless
public class CaseAssignmentService {
}
```

Perubahan namespace ini bukan cosmetic kecil. Ia adalah boundary kompatibilitas besar.

Jika aplikasi memakai `jakarta.ejb.Stateless`, runtime harus memahami Jakarta Enterprise Beans. Jika server hanya Java EE 8/`javax.*`, deployment akan gagal. Sebaliknya, library lama `javax.ejb.*` tidak otomatis cocok di runtime Jakarta EE 10/11 tanpa migrasi.

---

## 3. Enterprise Beans dalam Platform Modern

Jakarta Enterprise Beans 4.0 adalah spesifikasi Enterprise Beans untuk era namespace `jakarta.*`. Spesifikasi ini memindahkan API dari `javax.ejb` ke `jakarta.ejb` dan menghapus API deprecated tertentu. Jakarta Enterprise Beans sendiri didefinisikan sebagai arsitektur untuk pengembangan dan deployment aplikasi bisnis berbasis komponen.

Dalam Jakarta EE modern, khususnya Jakarta EE 10/11, posisi Enterprise Beans tidak lagi sedominan era Java EE klasik. Banyak aplikasi modern memilih:

- CDI managed beans,
- Jakarta REST,
- Jakarta Transactions,
- Jakarta Persistence,
- Jakarta Concurrency,
- MicroProfile,
- Spring,
- Quarkus,
- Micronaut,
- Helidon,
- Open Liberty profile tertentu,
- application-specific scheduling/worker model.

Namun Enterprise Beans tetap penting karena:

1. banyak sistem enterprise lama masih memakainya,
2. banyak konsepnya tetap menjadi dasar container-managed runtime,
3. migrasi enterprise Java sering harus memahami EJB semantics,
4. beberapa fitur seperti timer, declarative transaction, security, dan singleton concurrency masih muncul di sistem nyata,
5. kesalahan mengganti EJB tanpa memahami semantics dapat menciptakan bug transaksi, concurrency, dan security.

---

## 4. Masalah yang Diselesaikan Enterprise Beans

Enterprise Beans berusaha menyelesaikan beberapa masalah klasik enterprise server-side.

### 4.1 Transaction Management

Banyak operasi bisnis enterprise harus atomic.

Contoh:

- create case,
- assign officer,
- update case status,
- write audit trail,
- persist notification request,
- update SLA clock,
- insert workflow event.

Jika satu langkah gagal, sebagian perubahan mungkin harus rollback.

EJB menyediakan declarative transaction:

```java
@Stateless
public class EnforcementCaseService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approveCase(Long caseId) {
        // container opens/joins transaction
    }
}
```

Developer tidak membuka JDBC transaction secara manual. Container mengelola boundary.

### 4.2 Security

EJB dapat memakai declarative method-level security:

```java
@Stateless
public class PenaltyService {

    @RolesAllowed("PENALTY_APPROVER")
    public void approvePenalty(Long penaltyId) {
        // only allowed callers can execute
    }
}
```

Security berada di invocation boundary, bukan tersebar di tengah business code.

### 4.3 Pooling

Stateless session bean dapat dikelola melalui pool instance.

Aplikasi tidak harus membuat object baru untuk setiap request secara manual.

Container dapat:

- membuat beberapa instance,
- menyimpan di pool,
- memberikan instance untuk invocation,
- mengembalikan instance ke pool,
- membatasi concurrency via pool size,
- mengatur lifecycle instance.

### 4.4 Remoting

EJB pernah menjadi model standar untuk remote business method invocation.

```java
@Remote
public interface CaseRemoteService {
    CaseDto findCase(String caseNo);
}
```

Hari ini, remote EJB jarang menjadi pilihan baru dibanding HTTP/gRPC/messaging. Tetapi banyak sistem lama masih memilikinya.

### 4.5 Timer dan Scheduling

EJB menyediakan timer service:

```java
@Singleton
public class DailyEscalationTimer {

    @Schedule(hour = "2", minute = "0", persistent = true)
    public void runDailyEscalation() {
        // scheduled business process
    }
}
```

Timer dapat persistent, tergantung konfigurasi dan server.

### 4.6 Async Execution

EJB menyediakan `@Asynchronous`:

```java
@Stateless
public class ReportJobService {

    @Asynchronous
    public void generateReport(Long reportId) {
        // run asynchronously by container-managed executor/thread
    }
}
```

### 4.7 Container-Managed Concurrency

Singleton session bean dapat memakai lock:

```java
@Singleton
public class ReferenceDataCache {

    private Map<String, String> cache = new HashMap<>();

    @Lock(LockType.READ)
    public String get(String key) {
        return cache.get(key);
    }

    @Lock(LockType.WRITE)
    public void reload() {
        this.cache = loadFreshData();
    }
}
```

Container mengelola concurrency access ke singleton bean.

---

## 5. Jenis Enterprise Beans Utama

Enterprise Beans modern yang paling penting dipahami:

```text
Enterprise Beans
├── Session Beans
│   ├── Stateless Session Bean
│   ├── Stateful Session Bean
│   └── Singleton Session Bean
└── Message-Driven Bean
```

Selain itu, ada legacy entity bean model lama yang secara praktis tidak lagi menjadi arah modern. Entity bean lama berbeda dari JPA entity. Jangan disamakan.

---

## 6. Session Bean

Session bean adalah bean yang merepresentasikan business service atau business interaction.

Ada tiga jenis utama.

### 6.1 Stateless Session Bean

```java
@Stateless
public class CaseDecisionService {

    public DecisionResult decide(DecisionCommand command) {
        return DecisionResult.approved();
    }
}
```

Stateless session bean tidak menyimpan conversational state khusus untuk client tertentu.

Artinya:

- satu invocation tidak bergantung pada field yang diisi invocation sebelumnya untuk client yang sama,
- instance dapat dipakai untuk request berbeda secara bergantian,
- container dapat pooling instance,
- cocok untuk service operation yang atomic dan request-scoped secara logis.

Namun “stateless” bukan berarti class tidak boleh punya field sama sekali.

Field masih bisa ada untuk:

- injected dependency,
- immutable configuration,
- logger,
- cached metadata yang thread-safe,
- helper object yang aman.

Yang tidak boleh adalah menyimpan state bisnis per-user/per-request di field instance.

Buruk:

```java
@Stateless
public class ApprovalService {

    private Long currentCaseId;

    public void selectCase(Long caseId) {
        this.currentCaseId = caseId;
    }

    public void approveSelectedCase() {
        approve(currentCaseId);
    }
}
```

Masalah:

- instance dapat dipakai client berbeda,
- pool reuse membuat state bocor,
- concurrency/sequence tidak bisa dijamin,
- bug sulit direproduksi.

Baik:

```java
@Stateless
public class ApprovalService {

    public void approveCase(Long caseId) {
        approve(caseId);
    }
}
```

State bisnis harus lewat parameter, database, workflow state, atau external state store yang jelas.

### 6.2 Stateful Session Bean

```java
@Stateful
public class CaseDraftWizard {

    private DraftCase draft = new DraftCase();

    public void step1(BasicInfo info) {
        draft.setBasicInfo(info);
    }

    public void step2(PartyInfo party) {
        draft.setPartyInfo(party);
    }

    public Case submit() {
        return createCase(draft);
    }
}
```

Stateful session bean menyimpan conversational state untuk client.

Cocok secara historis untuk:

- wizard multi-step,
- shopping cart,
- conversational workflow,
- temporary stateful interaction.

Namun di arsitektur modern, stateful session bean semakin jarang dipilih karena:

- sulit scale horizontally,
- passivation/activation menambah kompleksitas,
- memory retention risk,
- clustering dan failover menjadi lebih rumit,
- HTTP/stateless API model lebih umum,
- frontend SPA biasanya menyimpan draft di client atau backend persistence store.

Modern alternative:

- persist draft ke database,
- gunakan Redis/session store eksplisit,
- gunakan workflow state machine,
- gunakan stateless service + durable state.

### 6.3 Singleton Session Bean

```java
@Singleton
@Startup
public class CodeTableCache {

    private volatile Map<String, String> codes;

    @PostConstruct
    void init() {
        this.codes = loadCodes();
    }

    @Lock(LockType.READ)
    public String getLabel(String code) {
        return codes.get(code);
    }

    @Lock(LockType.WRITE)
    public void reload() {
        this.codes = loadCodes();
    }
}
```

Singleton session bean memiliki satu instance per application/module/container context tertentu.

Cocok untuk:

- startup initialization,
- shared cache kecil,
- application-wide coordinator,
- scheduled job coordinator,
- container-managed concurrency example.

Risikonya:

- global mutable state,
- lock contention,
- cluster inconsistency,
- startup failure,
- hidden coupling,
- false sense of distributed singleton.

Penting:

> Singleton EJB biasanya singleton dalam satu JVM/application context, bukan otomatis distributed singleton lintas cluster.

Jika aplikasi berjalan di 4 pod Kubernetes, bisa ada 4 singleton instance.

---

## 7. Message-Driven Bean

Message-driven bean atau MDB digunakan untuk memproses message, biasanya dari JMS destination.

Contoh konseptual:

```java
@MessageDriven(activationConfig = {
    @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/CaseQueue"),
    @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
public class CaseMessageListener implements MessageListener {

    @Override
    public void onMessage(Message message) {
        // process message
    }
}
```

MDB menyediakan:

- message listener lifecycle,
- transaction integration,
- container-managed concurrency,
- message acknowledgment integration,
- pooling/instance management.

Dalam sistem modern, MDB sering digantikan atau disejajarkan dengan:

- Kafka consumer,
- RabbitMQ listener,
- Spring listener container,
- MicroProfile Reactive Messaging,
- cloud queue trigger,
- custom worker service.

Namun konsepnya sama:

> message datang dari broker, container/runtime memanggil business handler dengan transaction/concurrency/error semantics tertentu.

Yang penting bukan annotation-nya, tetapi semantics:

- kapan message dianggap sukses?
- kapan message di-redeliver?
- bagaimana rollback memengaruhi acknowledgment?
- berapa concurrency consumer?
- apakah handler idempotent?
- bagaimana poison message ditangani?
- apakah retry bounded?
- apakah order dijamin?

---

## 8. EJB vs CDI Managed Bean

Ini salah satu kebingungan paling umum.

CDI dan EJB sama-sama bisa membuat object managed by container. Tetapi fokus awalnya berbeda.

| Aspek | CDI Managed Bean | Enterprise Bean |
|---|---|---|
| Fokus utama | Dependency injection, context, type-safe composition | Business component dengan container services |
| Scope model | CDI scopes: dependent, request, session, application, conversation, custom | Stateless, stateful, singleton, MDB lifecycle |
| Transaction | Bisa via Jakarta Transactions/CDI interceptor di platform modern | Built-in declarative transaction semantics historis kuat |
| Security | Bisa lewat Jakarta Security/interceptor/integration | Method-level role annotations historically central |
| Pooling | Tidak sama dengan stateless EJB pooling | Stateless/MDB pooling adalah konsep utama |
| Remoting | Bukan fokus CDI | Local/remote business view historis penting |
| Timer | Bukan fitur CDI core | EJB Timer Service |
| Async | Bukan fitur CDI core | `@Asynchronous` |
| Concurrency | Tidak otomatis kecuali scope/impl tertentu | Singleton lock/container concurrency tersedia |

Perhatikan: CDI modern sangat kuat, tetapi CDI core tidak otomatis memberi semua service EJB. Banyak fitur dapat diperoleh dari spesifikasi Jakarta lain:

- Jakarta Transactions,
- Jakarta Concurrency,
- Jakarta Security,
- Jakarta Messaging,
- MicroProfile Fault Tolerance,
- MicroProfile Reactive Messaging,
- framework runtime.

Jadi pertanyaan yang benar bukan:

> “EJB atau CDI mana yang lebih bagus?”

Pertanyaan yang lebih benar:

> “Runtime semantic apa yang dibutuhkan komponen ini, dan platform mana yang menyediakannya dengan paling jelas, portable, testable, dan operasional?”

---

## 9. Invocation Model: Mengapa Method Call EJB Tidak Sama dengan `new Service().method()`

Ketika client memanggil EJB, biasanya ia tidak memanggil instance langsung. Ia memanggil proxy/stub/contextual reference.

Diagram konseptual:

```text
Caller
  |
  v
EJB proxy / business view
  |
  v
Container invocation chain
  |-- security check
  |-- transaction boundary
  |-- interceptor chain
  |-- concurrency/pooling dispatch
  |-- resource/context setup
  v
Actual bean instance
  |
  v
Business method
```

Karena ada invocation chain, behavior berikut bisa terjadi:

- transaction dibuat sebelum method body,
- role dicek sebelum method body,
- interceptor berjalan sebelum/sesudah method body,
- exception diterjemahkan ke rollback/remote exception semantics,
- instance dipilih dari pool,
- lock diterapkan untuk singleton,
- async method dijalankan di thread container.

Ini mirip dengan CDI proxy/interceptor model yang sudah dibahas, tetapi EJB memiliki kontrak tambahan.

Konsekuensi besar:

> Self-invocation dapat melewati container boundary.

Contoh masalah:

```java
@Stateless
public class CaseService {

    public void submit(Long caseId) {
        validate(caseId);
        approve(caseId); // direct self-call
    }

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void approve(Long caseId) {
        // expected new transaction, but may not apply if direct self-invocation
    }
}
```

Jika `approve()` dipanggil langsung dari method dalam class yang sama, call mungkin tidak melewati proxy/container invocation chain. Akibatnya annotation pada `approve()` tidak berlaku seperti yang diharapkan.

Desain lebih aman:

```java
@Stateless
public class CaseSubmissionService {

    @EJB
    private CaseApprovalService approvalService;

    public void submit(Long caseId) {
        validate(caseId);
        approvalService.approve(caseId); // crosses container boundary
    }
}

@Stateless
public class CaseApprovalService {

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void approve(Long caseId) {
    }
}
```

Atau di CDI modern, pecah boundary service secara eksplisit dan panggil lewat injected dependency.

---

## 10. Lifecycle Model Enterprise Beans

EJB lifecycle berbeda tergantung tipe bean.

### 10.1 Stateless Session Bean Lifecycle

Konseptual:

```text
class discovered/deployed
  -> container creates instance
  -> dependency injection
  -> @PostConstruct
  -> instance enters pool
  -> business method invocation
  -> instance returns to pool
  -> @PreDestroy
  -> destroyed
```

Stateless bean dapat memiliki banyak instance dalam pool.

Poin penting:

- jangan simpan per-client state,
- instance bisa dipakai ulang,
- initialization harus aman untuk pooled instances,
- cleanup harus melepas resource milik instance.

### 10.2 Stateful Session Bean Lifecycle

Konseptual:

```text
client obtains stateful bean reference
  -> instance created for conversation
  -> injection
  -> @PostConstruct
  -> business calls over time
  -> possible passivation
  -> possible activation
  -> @Remove or timeout
  -> @PreDestroy
```

Stateful bean memiliki risiko memory lebih tinggi.

Hal yang harus dipikirkan:

- kapan conversation berakhir?
- apakah ada timeout?
- apakah state serializable/passivation-capable?
- bagaimana failover?
- bagaimana user abandon session?
- apakah state lebih baik disimpan di database?

### 10.3 Singleton Session Bean Lifecycle

Konseptual:

```text
application starts
  -> singleton instance created, maybe @Startup eager
  -> injection
  -> @PostConstruct
  -> shared business invocations
  -> @PreDestroy during shutdown
```

Pertanyaan penting:

- apakah startup boleh gagal jika init gagal?
- apakah cache reload blocking?
- apakah lock read/write benar?
- apa yang terjadi di cluster?
- apakah singleton mengandung state yang harus durable?

### 10.4 MDB Lifecycle

Konseptual:

```text
application deploys
  -> MDB instances created/pool
  -> injection
  -> @PostConstruct
  -> message delivered by resource adapter/container
  -> onMessage invoked
  -> ack/commit/rollback handling
  -> @PreDestroy on undeploy/shutdown
```

Pertanyaan penting:

- apakah message processing idempotent?
- bagaimana retry?
- apakah poison message masuk DLQ?
- apakah transaction mencakup DB + broker ack?
- apakah order penting?

---

## 11. Enterprise Beans dan Transaction Boundary

EJB sangat erat dengan transaction management.

Default transaction behavior sering membuat EJB terasa “magis”. Ini membantu, tapi bisa berbahaya jika tidak disadari.

Contoh:

```java
@Stateless
public class CaseWorkflowService {

    public void approve(Long caseId) {
        // often runs with REQUIRED by default in typical EJB semantics
    }
}
```

Artinya method dapat otomatis berjalan dalam transaction meskipun tidak ada annotation eksplisit.

Top engineer tidak bergantung pada “saya kira default-nya apa”. Ia membuat boundary penting eksplisit:

```java
@Stateless
public class CaseWorkflowService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approve(Long caseId) {
    }
}
```

Transaction attribute penting:

```text
REQUIRED      : join existing transaction or create new one
REQUIRES_NEW  : suspend existing transaction and create new one
MANDATORY     : must already have transaction
SUPPORTS      : join if exists, otherwise no transaction
NOT_SUPPORTED : suspend existing transaction and run without transaction
NEVER         : fail if transaction exists
```

Part 022 akan membahas ini jauh lebih detail. Pada bagian ini cukup pegang mental model:

> EJB method call sering merupakan transaction boundary, bukan sekadar Java method call.

---

## 12. Enterprise Beans dan Security Boundary

EJB mendukung method-level role security.

```java
@Stateless
public class EnforcementActionService {

    @RolesAllowed({"ENFORCEMENT_MANAGER", "SUPERVISOR"})
    public void issueWarning(Long caseId) {
    }
}
```

Ini membuat security berada dekat dengan business operation.

Namun dalam sistem modern, security bisa tersebar di beberapa lapisan:

- API gateway,
- web filter,
- JAX-RS resource,
- method-level annotation,
- domain policy service,
- database row-level policy,
- workflow authorization.

EJB security berguna sebagai boundary method-level, tapi jangan menganggap cukup untuk semua authorization domain.

Contoh:

```java
@RolesAllowed("CASE_OFFICER")
public void updateCase(Long caseId, UpdateCommand command) {
    // role says caller is officer,
    // but does not prove officer is assigned to this specific case
}
```

Domain authorization tetap perlu:

```java
public void updateCase(Long caseId, UpdateCommand command) {
    Case c = caseRepository.get(caseId);
    casePolicy.assertCanUpdate(currentUser(), c);
    c.update(command);
}
```

Jadi security model yang baik:

```text
coarse-grained method role boundary
+ fine-grained domain policy check
+ audit trail
+ traceability
```

---

## 13. Enterprise Beans dan Resource Injection

EJB dapat memakai injection untuk resource container:

```java
@Stateless
public class AuditWriter {

    @Resource(lookup = "java:comp/env/jdbc/AuditDS")
    private DataSource dataSource;

    @PersistenceContext
    private EntityManager em;
}
```

Resource injection bukan sama persis dengan CDI injection.

CDI injection menyelesaikan bean berdasarkan type dan qualifier.

Resource injection sering menyelesaikan resource berdasarkan naming/JNDI binding yang disediakan deployment/container.

Artinya error resource injection sering bukan karena class tidak ada, tetapi karena:

- JNDI name salah,
- resource belum didefinisikan di server,
- datasource tidak aktif,
- credential salah,
- module tidak punya visibility,
- environment binding berbeda antara DEV/UAT/PROD,
- deployment descriptor override annotation.

Part 023–024 akan membahas Jakarta Common Annotations, `@Resource`, JNDI, dan environment entry secara lebih detail.

---

## 14. Local View vs Remote View

EJB mengenal business view.

### 14.1 No-interface Local View

```java
@Stateless
public class CaseQueryService {
    public CaseDto getCase(Long id) {
        return null;
    }
}
```

Client dalam aplikasi sama dapat inject langsung class-nya.

### 14.2 Local Interface

```java
@Local
public interface CaseQuery {
    CaseDto getCase(Long id);
}

@Stateless
public class CaseQueryBean implements CaseQuery {
    public CaseDto getCase(Long id) {
        return null;
    }
}
```

Local view dipakai dalam same application/server boundary.

### 14.3 Remote Interface

```java
@Remote
public interface CaseQueryRemote {
    CaseDto getCase(Long id);
}
```

Remote view memungkinkan invocation dari luar JVM/server boundary, tergantung server/protocol.

Namun remote EJB membawa konsekuensi:

- network failure,
- serialization requirement,
- version compatibility,
- latency,
- distributed transaction temptation,
- tight coupling antar aplikasi Java,
- vendor/server-specific behavior.

Modern replacement biasanya:

- REST API,
- gRPC,
- messaging,
- event stream,
- API contract with OpenAPI/AsyncAPI,
- explicit client library.

Rule praktis:

> Jangan desain remote boundary seolah-olah method call lokal. Remote call adalah distributed systems boundary.

---

## 15. Enterprise Beans Lite vs Full/Optional Feature

Tidak semua runtime modern mendukung seluruh fitur Enterprise Beans klasik.

Ada subset seperti Enterprise Beans Lite, dan ada fitur yang optional/legacy.

Ini penting untuk engineer modern karena saat memilih runtime seperti Open Liberty, WildFly, Payara, WebLogic, atau embedded profile tertentu, tidak semua fitur tersedia sama.

Pertanyaan deployment yang harus ditanyakan:

1. Apakah runtime mendukung Enterprise Beans Full atau Lite?
2. Apakah MDB tersedia?
3. Apakah remote EJB tersedia?
4. Apakah timer service persistent tersedia?
5. Apakah EJB 2.x entity bean legacy masih didukung atau optional?
6. Apakah clustering/failover EJB tersedia?
7. Apakah transaction manager mendukung use case kita?
8. Apakah fitur yang dipakai portable atau vendor-specific?

Kesalahan umum:

> Aplikasi compile karena `jakarta.ejb-api` ada, tetapi deployment gagal karena runtime tidak menyediakan fitur Enterprise Beans yang dipakai.

Ingat pola dari part dependency sebelumnya:

```text
API JAR available at compile time ≠ feature available at runtime
```

---

## 16. Kapan EJB Masih Masuk Akal?

EJB masih bisa masuk akal dalam kondisi tertentu.

### 16.1 Existing Application Sudah Banyak EJB

Jika sistem stabil memakai EJB, mengganti semuanya hanya demi modernisasi kosmetik bisa berbahaya.

Pertanyaan yang lebih baik:

- apa pain point nyata?
- apakah EJB menghambat delivery?
- apakah server sulit dioperasikan?
- apakah migration risk sebanding dengan benefit?
- apakah ada security/transaction bug karena EJB?
- apakah skill tim cukup?

Jika tidak ada masalah besar, strategi awal bisa:

```text
keep stable EJB
+ document semantics
+ add tests
+ isolate boundaries
+ modernize around edges
```

### 16.2 Need Container-Managed Transaction and Timer in Full Jakarta EE Server

Jika aplikasi memang berjalan di full Jakarta EE server dan membutuhkan timer/transaction/security method boundary, EJB bisa tetap praktis.

### 16.3 Legacy Integration

Jika sistem lain sudah memanggil remote EJB atau memakai vendor-specific enterprise integration, EJB mungkin perlu dipertahankan sementara.

### 16.4 Migration Bridge

EJB dapat dipakai sebagai bridge sementara saat memindahkan business logic ke CDI/service baru.

Contoh:

```java
@Stateless
public class LegacyCaseEJB {

    @Inject
    private NewCaseApplicationService newService;

    public void approve(Long caseId) {
        newService.approve(caseId);
    }
}
```

EJB tetap menjadi compatibility facade, sementara logic berpindah ke service yang lebih modern/testable.

---

## 17. Kapan EJB Sebaiknya Dihindari untuk Development Baru?

EJB mungkin bukan pilihan terbaik jika:

1. aplikasi targetnya cloud-native lightweight runtime,
2. deployment target bukan full Jakarta EE server,
3. tim tidak memiliki operational skill app server,
4. use case cukup dengan CDI + Jakarta Transactions + Jakarta Concurrency,
5. remote communication lebih tepat via HTTP/gRPC/messaging,
6. stateful session bean akan menyulitkan horizontal scaling,
7. scheduling lebih baik dikelola platform/job scheduler eksternal,
8. runtime harus native-image/build-time optimized,
9. sistem butuh explicit boundary untuk observability dan distributed tracing,
10. ingin mengurangi vendor lock-in app server feature.

Namun hindari alasan dangkal seperti:

> “EJB jelek karena tua.”

Alasan yang kuat adalah:

> “Semantic yang diberikan EJB tidak cocok dengan operational/deployment model kita, dan bisa diganti oleh kombinasi runtime service yang lebih eksplisit dan teruji.”

---

## 18. Migration Thinking: Jangan Menghapus Annotation Sebelum Mengganti Semantics

Ini bagian terpenting untuk modernization.

Misal ada EJB:

```java
@Stateless
@TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
@RolesAllowed("APPROVER")
public class ApprovalAuditService {

    public void writeApprovalAudit(Long caseId) {
        // insert audit record
    }
}
```

Mengubahnya menjadi CDI biasa:

```java
@ApplicationScoped
public class ApprovalAuditService {

    public void writeApprovalAudit(Long caseId) {
        // insert audit record
    }
}
```

Ini bukan migration yang aman jika semantics hilang.

Yang hilang mungkin:

- `REQUIRES_NEW` transaction boundary,
- method-level role check,
- EJB proxy behavior,
- pooling assumption,
- exception rollback semantics,
- remote/local view compatibility,
- lifecycle behavior.

Migration yang benar harus membuat semantic replacement eksplisit.

Contoh:

```java
@ApplicationScoped
public class ApprovalAuditService {

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    @RolesAllowed("APPROVER")
    public void writeApprovalAudit(Long caseId) {
        // insert audit record
    }
}
```

Tetapi ini pun harus diverifikasi:

- apakah `@Transactional` aktif di runtime?
- apakah method dipanggil melalui CDI proxy?
- apakah self-invocation terjadi?
- apakah security annotation didukung pada CDI bean di runtime tersebut?
- apakah rollback rule sama?
- apakah exception behavior sama?

Migration bukan rename annotation. Migration adalah preserving or intentionally changing runtime semantics.

---

## 19. Decision Matrix: Keep, Wrap, Migrate, Retire

Saat menemukan EJB dalam sistem existing, gunakan matrix berikut.

### 19.1 Keep

Pilih keep jika:

- bean stabil,
- business critical,
- tidak menghambat delivery,
- semantic EJB dibutuhkan,
- test coverage cukup,
- runtime mendukung baik,
- migration risk tinggi tanpa benefit jelas.

Aksi:

- dokumentasikan transaction/security/timer semantics,
- tambahkan integration tests,
- observability sekitar boundary,
- hindari menambah complexity baru.

### 19.2 Wrap

Pilih wrap jika:

- client masih butuh EJB interface,
- logic ingin dipindah ke service modern,
- perlu compatibility facade.

Pattern:

```text
Legacy EJB facade
  -> delegates to CDI application service
      -> domain/infrastructure modules
```

Aksi:

- EJB menjadi thin adapter,
- business logic keluar dari EJB,
- transaction boundary diputuskan eksplisit,
- tests fokus pada service baru.

### 19.3 Migrate

Pilih migrate jika:

- EJB semantics bisa diganti jelas,
- runtime target tidak ingin EJB,
- ada benefit nyata: testability, cloud deployment, startup, vendor reduction,
- tim punya kapasitas testing.

Aksi:

- inventory annotation,
- map semantic replacement,
- buat characterization tests,
- migrate per boundary,
- monitor behavior.

### 19.4 Retire

Pilih retire jika:

- bean tidak lagi dipakai,
- remote endpoint deprecated,
- timer diganti scheduler lain,
- business process berubah,
- logic duplicate.

Aksi:

- usage analysis,
- log deprecation,
- remove safely,
- clean deployment descriptors/resources.

---

## 20. Inventory Checklist untuk Sistem Legacy EJB

Sebelum modernisasi, buat inventory.

```text
Bean identity
- class name
- package
- module/JAR/WAR/EAR
- javax or jakarta namespace
- server/runtime

Bean type
- @Stateless
- @Stateful
- @Singleton
- @MessageDriven

Business view
- no-interface local
- @Local
- @Remote
- legacy home interface

Runtime annotations
- @TransactionAttribute
- @TransactionManagement
- @RolesAllowed / @PermitAll / @DenyAll
- @RunAs
- @Asynchronous
- @Schedule / @Timeout
- @Lock / @ConcurrencyManagement
- @Startup
- @DependsOn
- @Remove

Injection/resource
- @EJB
- @Inject
- @Resource
- @PersistenceContext
- @PersistenceUnit
- JMS/resource adapter binding

Operational behavior
- timer persistent/non-persistent
- pool size config
- transaction timeout
- security realm mapping
- remote clients
- cluster behavior
- failover behavior

Risk
- business criticality
- test coverage
- known incidents
- dependency on vendor features
```

Tanpa inventory ini, migrasi EJB sering menjadi gambling.

---

## 21. Common Failure Modes

### 21.1 Treating EJB as POJO

Masalah:

```java
ApprovalService service = new ApprovalService();
service.approve(caseId);
```

Jika `ApprovalService` adalah EJB, `new` melewati container.

Yang hilang:

- injection,
- transaction,
- security,
- interceptor,
- lifecycle,
- resource binding.

Rule:

> Managed component must be obtained from container, not manually constructed, unless explicitly designed as pure POJO.

### 21.2 Self-Invocation

Method annotation tidak berlaku karena call tidak melewati proxy/container.

Solusi:

- pecah service boundary,
- inject collaborator,
- pastikan call melewati managed reference.

### 21.3 Stateful Bean Memory Leak

Client tidak mengakhiri conversation.

Solusi:

- explicit remove,
- timeout,
- prefer durable state store.

### 21.4 Singleton False Distributed Lock

Singleton EJB dianggap global lintas cluster.

Padahal setiap JVM/pod bisa punya singleton sendiri.

Solusi:

- distributed lock jika perlu,
- database lease,
- scheduler leader election,
- external coordinator.

### 21.5 Remote EJB Treated as Local Call

Remote EJB dipanggil dalam loop granular.

Buruk:

```java
for (Long id : ids) {
    remoteService.getCase(id);
}
```

Lebih baik:

```java
remoteService.getCases(ids);
```

Remote boundary butuh coarse-grained API.

### 21.6 Timer Duplicate Execution in Cluster

Scheduled process berjalan di banyak node atau failover menciptakan duplicate.

Solusi:

- pahami timer service server,
- idempotency,
- lock/lease,
- job execution table,
- unique business key,
- audit execution id.

### 21.7 Transaction Semantics Lost During Migration

EJB diganti CDI biasa tanpa mengganti `REQUIRES_NEW`, rollback rule, atau method security.

Solusi:

- semantic inventory,
- characterization tests,
- explicit replacement annotations,
- integration tests.

---

## 22. Enterprise Beans dalam Regulatory / Case Management System

Untuk domain regulatory/case management, EJB sering muncul di area seperti:

- case workflow service,
- escalation timer,
- SLA calculation job,
- audit writer,
- approval service,
- payment/revenue posting,
- notification dispatcher,
- external agency integration,
- nightly batch trigger,
- reference data cache,
- message listener for integration queue.

Contoh desain legacy:

```text
JAX-RS Resource
  -> @EJB CaseWorkflowBean
      -> @EJB AuditBean
      -> @EJB NotificationBean
      -> @PersistenceContext EntityManager
```

Risiko yang perlu dibaca:

- apakah semua call dalam satu transaction terlalu panjang?
- apakah audit harus `REQUIRES_NEW`?
- apakah notification dikirim sebelum transaction commit?
- apakah escalation timer idempotent?
- apakah role check cukup untuk per-case authorization?
- apakah remote call terjadi dalam transaction?
- apakah async job kehilangan security/request context?

Dalam sistem regulatory, traceability dan defensibility sangat penting. Maka migration EJB harus menjaga:

- audit completeness,
- transaction integrity,
- authorization semantics,
- deterministic workflow transition,
- retry/idempotency,
- evidence trail.

---

## 23. EJB Concepts Reappearing in Modern Frameworks

Bahkan jika tidak memakai EJB, konsepnya masih ada.

| EJB Concept | Modern Equivalent / Similar Concept |
|---|---|
| `@Stateless` service | CDI/Spring/Quarkus application service |
| Container-managed transaction | `@Transactional` interceptor |
| Method security | `@RolesAllowed`, Spring Security method security, Jakarta Security |
| Timer service | Scheduler, Quartz, Kubernetes CronJob, MicroProfile Scheduled/vendor scheduler |
| MDB | Message listener container, Kafka/Rabbit consumer, reactive messaging |
| `@Asynchronous` | managed executor, CompletableFuture, reactive pipeline, worker pool |
| Singleton EJB lock | synchronized service, distributed lock, leader election |
| Remote EJB | REST/gRPC/client SDK |
| Pooling | connection pool, worker pool, object pool, executor pool |

Karena itu, memahami EJB membantu membaca banyak runtime modern.

Pertanyaan tetap sama:

```text
Who creates it?
Who calls it?
Through what proxy/interceptor chain?
Who opens transaction?
Who checks security?
Who owns thread?
Who owns state?
Who retries failure?
Who shuts it down?
```

---

## 24. Practical Design Heuristics

### 24.1 Untuk Kode Baru

Gunakan EJB baru hanya jika:

- runtime memang full Jakarta EE,
- fitur EJB yang dipakai jelas,
- tim paham operational model,
- benefit lebih besar dari coupling ke EJB model.

Jika tidak, pertimbangkan:

- CDI bean + Jakarta Transactions,
- CDI bean + Jakarta Concurrency,
- MicroProfile Config/Fault Tolerance/Reactive Messaging,
- scheduler eksternal,
- explicit queue consumer,
- framework-native model.

### 24.2 Untuk Kode Lama

Jangan buru-buru rewrite.

Langkah benar:

1. inventory EJB,
2. kelompokkan by risk,
3. tulis characterization tests,
4. pindahkan business logic ke service murni jika mungkin,
5. jadikan EJB thin adapter,
6. migrasi semantics satu per satu,
7. hapus EJB setelah tidak ada external dependency.

### 24.3 Untuk Transaction Boundary

Jangan sembunyikan transaction penting.

Buat eksplisit:

- operation mana atomic,
- operation mana `REQUIRES_NEW`,
- operation mana tidak boleh transaction,
- operation mana read-only secara konseptual,
- operation mana harus after-commit.

### 24.4 Untuk Timer/Scheduler

Selalu desain idempotent.

Timer dapat duplicate, retry, overlap, atau fail mid-flight.

Gunakan:

- execution table,
- lock/lease,
- unique key,
- status transition,
- retry count,
- dead-letter/manual recovery.

### 24.5 Untuk Remote Boundary

Remote API harus coarse-grained dan versioned.

Jangan expose internal entity atau domain object yang volatile.

Gunakan DTO/contract.

---

## 25. Minimal Code Comparison: EJB vs CDI Service

### 25.1 EJB Style

```java
@Stateless
public class CaseApprovalBean {

    @PersistenceContext
    private EntityManager em;

    @EJB
    private ApprovalAuditBean auditBean;

    @RolesAllowed("CASE_APPROVER")
    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approve(Long caseId) {
        CaseEntity c = em.find(CaseEntity.class, caseId);
        c.approve();
        auditBean.writeApprovalAudit(caseId);
    }
}
```

```java
@Stateless
public class ApprovalAuditBean {

    @PersistenceContext
    private EntityManager em;

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void writeApprovalAudit(Long caseId) {
        em.persist(new AuditEntity(caseId, "APPROVED"));
    }
}
```

Runtime semantics:

- `approve()` runs in required transaction,
- audit writes in separate new transaction,
- role check before approval,
- both beans are managed by EJB container,
- call to audit crosses EJB boundary.

### 25.2 CDI-Oriented Style

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    ApprovalAuditService auditService;

    @RolesAllowed("CASE_APPROVER")
    @Transactional(Transactional.TxType.REQUIRED)
    public void approve(Long caseId) {
        CaseEntity c = caseRepository.get(caseId);
        c.approve();
        auditService.writeApprovalAudit(caseId);
    }
}
```

```java
@ApplicationScoped
public class ApprovalAuditService {

    @Inject
    AuditRepository auditRepository;

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void writeApprovalAudit(Long caseId) {
        auditRepository.save(new AuditRecord(caseId, "APPROVED"));
    }
}
```

Runtime semantics harus diverifikasi:

- apakah `@Transactional` aktif untuk CDI bean?
- apakah `@RolesAllowed` aktif untuk CDI bean di platform ini?
- apakah call melewati CDI proxy?
- apakah repository menggunakan persistence context benar?
- apakah rollback semantics sama?

### 25.3 Pure Domain Core

Lebih baik lagi, business decision bisa dipisahkan dari runtime annotation:

```java
public class CaseApprovalPolicy {

    public void approve(CaseEntity c, User actor) {
        if (!c.canBeApprovedBy(actor)) {
            throw new ForbiddenCaseOperationException();
        }
        c.approveBy(actor);
    }
}
```

Runtime service mengorkestrasi:

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject CaseRepository caseRepository;
    @Inject ApprovalAuditService auditService;
    @Inject CurrentUser currentUser;
    @Inject CaseApprovalPolicy policy;

    @Transactional
    public void approve(Long caseId) {
        CaseEntity c = caseRepository.get(caseId);
        policy.approve(c, currentUser.get());
        auditService.writeApprovalAudit(caseId);
    }
}
```

Ini membuat domain logic testable tanpa container, sementara runtime service tetap memegang transaction/injection boundary.

---

## 26. Mental Model Ringkas

Enterprise Beans dapat dipahami dengan formula ini:

```text
Enterprise Bean = business component + container invocation semantics
```

Atau:

```text
EJB is not mainly about annotation.
EJB is about what the container promises around a business method call.
```

Setiap kali melihat EJB, tanyakan:

```text
1. What kind of bean is this?
2. Who calls it?
3. Is the call local or remote?
4. Is the method transactional?
5. Is security enforced at method boundary?
6. Is there pooling or singleton locking?
7. Is there conversational state?
8. Is there timer or async execution?
9. Is resource injection involved?
10. What breaks if this becomes plain CDI/POJO?
```

---

## 27. Anti-Patterns

### 27.1 EJB as God Service

```text
CaseManagementBean
- create case
- update case
- approve case
- reject case
- assign officer
- calculate SLA
- write audit
- send notification
- generate report
- call external agency
```

Masalah:

- transaction boundary kabur,
- security rule campur,
- test sulit,
- high coupling,
- migration sulit.

Solusi:

- split by use case,
- explicit application service,
- domain service/policy,
- infrastructure adapter.

### 27.2 Stateful Bean as Backend Session Dump

Menyimpan terlalu banyak state user di stateful bean.

Solusi:

- durable draft table,
- stateless API,
- explicit workflow state.

### 27.3 Remote EJB Fine-Grained Chatty API

Remote service dipanggil berkali-kali untuk data kecil.

Solusi:

- bulk endpoint,
- query DTO,
- pagination,
- coarse-grained API.

### 27.4 Timer Without Idempotency

Scheduled job tidak aman terhadap retry/duplicate.

Solusi:

- execution id,
- lock,
- idempotent transition,
- retry policy.

### 27.5 Migration by Annotation Removal

Menghapus `@Stateless` tanpa mengganti semantics.

Solusi:

- semantic inventory,
- replacement map,
- integration tests.

---

## 28. Relation to Previous and Next Parts

Bagian sebelumnya membangun CDI model:

- bean discovery,
- scope,
- proxy,
- qualifier,
- producer,
- event,
- interceptor,
- decorator,
- stereotype,
- lifecycle,
- extension.

Bagian ini memperluas konteks ke Enterprise Beans:

- EJB bukan hanya DI,
- EJB adalah component model dengan container service kuat,
- banyak behavior EJB terjadi di method invocation boundary.

Bagian berikutnya akan masuk lebih detail ke:

```text
Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics
```

Di sana kita akan membahas lebih teknis:

- stateless pooling,
- stateful conversational identity,
- singleton lifecycle,
- passivation,
- activation,
- concurrency,
- reentrancy,
- lifecycle callback,
- migration dari EJB service ke CDI service.

---

## 29. Practical Checklist

Gunakan checklist ini saat membaca atau mendesain komponen Enterprise Beans.

```text
Bean Type
[ ] Is it @Stateless, @Stateful, @Singleton, or @MessageDriven?
[ ] Is that bean type actually appropriate?

State
[ ] Does it store mutable state?
[ ] Is the state per request, per client, or application-wide?
[ ] Is the state safe in pool/reuse/cluster?

Transaction
[ ] What transaction attribute applies?
[ ] Is it default or explicit?
[ ] Does any method need REQUIRES_NEW?
[ ] Are rollback rules understood?

Security
[ ] Are roles declared?
[ ] Is domain-level authorization also required?
[ ] Is caller identity available?

Invocation
[ ] Are calls crossing proxy/container boundary?
[ ] Is there self-invocation risk?
[ ] Are interceptors involved?

Resources
[ ] Are @Resource/@PersistenceContext bindings portable?
[ ] Are JNDI names environment-specific?
[ ] Are resources available in target runtime?

Concurrency
[ ] Is singleton locking needed?
[ ] Is async execution safe?
[ ] Is timer execution idempotent?

Remote
[ ] Is the interface local or remote?
[ ] Are DTOs serializable/versioned?
[ ] Is the API coarse-grained?

Migration
[ ] What semantics would be lost if converted to CDI/POJO?
[ ] Are there characterization tests?
[ ] Is there a replacement for transaction/security/timer/async?
```

---

## 30. Key Takeaways

1. Enterprise Beans are about **container-managed business component semantics**, not just annotations.
2. Stateless, stateful, singleton, and message-driven beans each encode a different lifecycle and concurrency model.
3. EJB method invocation often passes through a container chain that can apply transaction, security, interceptor, pooling, async, timer, and resource semantics.
4. CDI and EJB overlap, but they are not identical. CDI is primarily contextual DI/composition; EJB historically bundles stronger business component services.
5. EJB is less dominant in new greenfield systems, but still important for legacy, migration, and understanding enterprise runtime semantics.
6. Migration from EJB must preserve or intentionally replace semantics; removing `@Stateless` is not enough.
7. Remote EJB is a distributed boundary and must not be treated like local Java method calls.
8. Stateful beans and singleton beans require careful memory/concurrency/cluster thinking.
9. Timer and async features require idempotency and operational design.
10. A top engineer evaluates EJB by runtime contract and risk, not by whether the technology feels old.

---

## 31. Mini Exercise

Ambil satu service enterprise yang kamu kenal, misalnya `CaseApprovalService`, `AuditTrailService`, atau `EscalationJobService`.

Jawab:

```text
1. Jika service ini adalah EJB, tipe bean apa yang paling cocok?
2. Apakah service ini butuh transaction boundary?
3. Apakah ada operasi yang harus REQUIRES_NEW?
4. Apakah security cukup role-based atau perlu domain policy?
5. Apakah service menyimpan state?
6. Apakah aman jika jalan di 4 node/pod?
7. Apakah ada timer/async/message handling?
8. Jika dimigrasi ke CDI, semantic apa yang harus diganti?
9. Failure mode apa yang paling berbahaya?
10. Test apa yang harus ada sebelum migrasi?
```

Jika kamu bisa menjawab ini secara jelas, kamu sudah mulai berpikir seperti engineer yang memahami runtime, bukan hanya syntax.

---

## 32. Status Seri

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
```

Berikutnya:

```text
Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-019.md">⬅️ Part 019 — CDI Extensions and Portable Runtime Customization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-021.md">Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics ➡️</a>
</div>
