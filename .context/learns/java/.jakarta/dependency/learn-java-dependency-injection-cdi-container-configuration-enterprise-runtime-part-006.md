# Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-006.md`  
Target Java: 8 → 25  
Target runtime: Java SE, Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI-capable runtimes, application servers, cloud-native runtimes

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya sudah membahas:

- dependency graph dan build-time dependency correctness;
- API, SPI, implementation, provider;
- migrasi `javax.*` ke `jakarta.*`;
- container/runtime model;
- classloader, module, dan deployment isolation.

Part ini masuk ke fondasi paling penting sebelum belajar Jakarta Inject dan CDI secara detail:

> **Dependency Injection adalah teknik untuk membuat object graph aplikasi dikonstruksi dari luar object yang membutuhkan dependency, sehingga object tidak perlu mengetahui cara membuat, menemukan, memilih, dan mengelola lifecycle dependency-nya sendiri.**

Namun untuk level advanced, definisi itu belum cukup.

Pada sistem enterprise, DI bukan hanya “pakai `@Inject`”. DI adalah cara membagi tanggung jawab antara:

1. object yang melakukan pekerjaan bisnis;
2. dependency yang dibutuhkan object tersebut;
3. runtime/container yang membangun graph;
4. configuration yang memilih implementation;
5. lifecycle boundary yang menentukan kapan object dibuat/dihancurkan;
6. test/runtime environment yang mengganti implementation;
7. production operator yang harus memahami apa yang terjadi saat startup gagal.

Kalau mental model ini tidak kuat, developer mudah jatuh ke salah satu ekstrem:

- semua dibuat manual dengan `new`, akhirnya sulit dites dan sulit diganti;
- semua diinjeksi tanpa desain boundary, akhirnya graph besar, implicit, dan sulit dipahami;
- semua dependency diambil dari global/static registry, seolah-olah DI tetapi sebenarnya service locator;
- semua variation diselesaikan dengan `if (profile.equals("prod"))`, akhirnya business code tercemar runtime concern;
- semua class dijadikan bean, akhirnya container menjadi tempat sampah object lifecycle.

Part ini membahas DI dari nol sampai level arsitektural, tetapi tidak mengulang detail CDI yang akan masuk part berikutnya.

---

## 1. Core Problem: Object Butuh Object Lain

Hampir semua aplikasi nyata terdiri dari object yang saling membutuhkan.

Contoh sederhana:

```java
public final class CaseAssignmentService {
    private final OfficerRepository officerRepository;
    private final CaseRepository caseRepository;
    private final AssignmentPolicy assignmentPolicy;
    private final AuditTrail auditTrail;

    public CaseAssignmentService(
            OfficerRepository officerRepository,
            CaseRepository caseRepository,
            AssignmentPolicy assignmentPolicy,
            AuditTrail auditTrail
    ) {
        this.officerRepository = officerRepository;
        this.caseRepository = caseRepository;
        this.assignmentPolicy = assignmentPolicy;
        this.auditTrail = auditTrail;
    }

    public void assign(CaseId caseId, OfficerId officerId) {
        CaseRecord caseRecord = caseRepository.findRequired(caseId);
        Officer officer = officerRepository.findRequired(officerId);

        assignmentPolicy.validate(caseRecord, officer);
        caseRepository.assign(caseId, officerId);
        auditTrail.record("CASE_ASSIGNED", caseId.value(), officerId.value());
    }
}
```

`CaseAssignmentService` butuh beberapa dependency:

- repository officer;
- repository case;
- policy;
- audit trail.

Pertanyaan arsitekturalnya bukan sekadar “bagaimana cara class ini mendapatkan dependency?”. Pertanyaannya lebih luas:

1. Siapa yang memilih implementation `OfficerRepository`?
2. Siapa yang membuat instance repository?
3. Siapa yang memberi repository koneksi database?
4. Siapa yang memutuskan apakah audit trail menulis ke database, Kafka, file, atau external service?
5. Siapa yang menentukan lifecycle object-object itu?
6. Bagaimana test bisa mengganti repository dengan fake/in-memory implementation?
7. Bagaimana runtime prod bisa memakai implementation berbeda dari runtime local?
8. Bagaimana kegagalan wiring terdeteksi lebih awal?

Dependency Injection menjawab sebagian besar pertanyaan tersebut dengan memindahkan tanggung jawab construction dan wiring keluar dari business object.

---

## 2. Object Construction vs Object Collaboration

Salah satu mental model terpenting:

> **Object harus fokus pada kolaborasi, bukan pada cara menemukan atau membangun collaborator-nya.**

Bandingkan dua model berikut.

### 2.1 Object Membuat Dependency Sendiri

```java
public final class CaseAssignmentService {
    private final CaseRepository caseRepository = new JdbcCaseRepository();
    private final OfficerRepository officerRepository = new JdbcOfficerRepository();
    private final AssignmentPolicy assignmentPolicy = new DefaultAssignmentPolicy();
    private final AuditTrail auditTrail = new DatabaseAuditTrail();
}
```

Masalah:

- implementation terkunci;
- sulit dites;
- object tahu terlalu banyak tentang infrastructure;
- tidak bisa mudah diganti untuk local/UAT/prod;
- lifecycle dependency tersembunyi;
- constructor dependency sebenarnya tidak terlihat;
- sulit mengatur resource seperti datasource, connection pool, transaction, security context.

### 2.2 Object Menerima Dependency

```java
public final class CaseAssignmentService {
    private final CaseRepository caseRepository;
    private final OfficerRepository officerRepository;
    private final AssignmentPolicy assignmentPolicy;
    private final AuditTrail auditTrail;

    public CaseAssignmentService(
            CaseRepository caseRepository,
            OfficerRepository officerRepository,
            AssignmentPolicy assignmentPolicy,
            AuditTrail auditTrail
    ) {
        this.caseRepository = caseRepository;
        this.officerRepository = officerRepository;
        this.assignmentPolicy = assignmentPolicy;
        this.auditTrail = auditTrail;
    }
}
```

Keuntungannya:

- class tidak tahu implementation concrete;
- dependency terlihat eksplisit;
- test bisa memberi fake;
- runtime bisa memberi production implementation;
- wiring bisa dipusatkan;
- lifecycle bisa dikelola container;
- boundary lebih jelas.

---

## 3. Dependency Injection vs Inversion of Control

Dua istilah ini sering dicampur.

### 3.1 Inversion of Control

Inversion of Control adalah prinsip lebih umum:

> **Sebagian kontrol yang biasanya dimiliki application code dipindahkan ke framework/container/runtime.**

Contoh IoC:

- Servlet container memanggil method resource/filter/listener;
- JAX-RS runtime memanggil resource method ketika HTTP request masuk;
- CDI container membuat dan menginjeksi bean;
- EJB container membuka/commit/rollback transaction;
- scheduler memanggil job callback;
- test framework memanggil test lifecycle method;
- ORM memanggil entity callback.

IoC berarti application code tidak selalu “main program” yang mengatur semuanya. Dalam enterprise runtime, application code sering menjadi component yang dipanggil oleh container.

### 3.2 Dependency Injection

Dependency Injection adalah salah satu bentuk IoC yang fokus pada object dependency:

> **Object tidak mengambil dependency sendiri. Dependency diberikan dari luar.**

DI adalah IoC pada construction/wiring.

### 3.3 Hubungan Keduanya

```text
Inversion of Control
│
├── Dependency Injection
├── Callback / Listener model
├── Template method framework
├── Event dispatch
├── Request dispatch
├── Transaction interceptor
└── Lifecycle callback
```

DI bukan seluruh IoC. Tetapi pada Jakarta/CDI/container runtime, DI menjadi fondasi karena banyak layanan container masuk melalui injection/proxy/interceptor.

---

## 4. Tiga Cara Object Mendapat Dependency

Secara umum ada tiga model.

### 4.1 Direct Construction

```java
PaymentGateway gateway = new HttpPaymentGateway();
```

Cocok untuk:

- value object;
- object ephemeral;
- object tanpa dependency eksternal;
- object domain kecil;
- data structure;
- helper internal yang tidak perlu diganti.

Tidak cocok untuk:

- service boundary;
- infrastructure adapter;
- database client;
- HTTP client;
- object dengan lifecycle/resource;
- object yang perlu diganti per environment.

### 4.2 Lookup

```java
DataSource ds = (DataSource) context.lookup("java:comp/env/jdbc/MainDS");
```

Atau:

```java
CaseRepository repository = ServiceRegistry.get(CaseRepository.class);
```

Lookup berarti object aktif mencari dependency.

Kelebihan:

- flexible;
- bisa dynamic;
- cocok untuk plugin tertentu;
- bisa dipakai pada low-level integration.

Kelemahan:

- dependency tidak eksplisit di constructor;
- business code tahu registry/JNDI/container;
- sulit dites;
- runtime error sering muncul terlambat;
- mudah berubah menjadi service locator anti-pattern.

### 4.3 Injection

```java
public CaseAssignmentService(CaseRepository repository) {
    this.repository = repository;
}
```

Injection berarti dependency diberikan dari luar.

Kelebihan:

- dependency eksplisit;
- testable;
- bisa divalidasi lebih awal;
- object lebih reusable;
- wiring bisa dikelola composition root/container.

Kelemahan:

- graph bisa menjadi implicit kalau terlalu banyak annotation;
- salah scope bisa membuat memory/thread-safety issue;
- circular dependency bisa tersembunyi;
- butuh disiplin boundary;
- container error bisa kompleks.

---

## 5. Composition Root: Tempat Object Graph Dirakit

Dalam aplikasi tanpa container, kita biasanya punya composition root.

```java
public final class Main {
    public static void main(String[] args) {
        DataSource dataSource = createDataSource();
        CaseRepository caseRepository = new JdbcCaseRepository(dataSource);
        OfficerRepository officerRepository = new JdbcOfficerRepository(dataSource);
        AssignmentPolicy policy = new DefaultAssignmentPolicy();
        AuditTrail auditTrail = new DatabaseAuditTrail(dataSource);

        CaseAssignmentService service = new CaseAssignmentService(
                caseRepository,
                officerRepository,
                policy,
                auditTrail
        );

        Application app = new Application(service);
        app.run();
    }
}
```

Composition root adalah lokasi tempat:

- implementation concrete dipilih;
- object dibuat;
- dependency disambungkan;
- lifecycle global dimulai;
- configuration dibaca;
- resources disiapkan.

Pada CDI/Jakarta runtime, composition root banyak diambil alih oleh container:

```text
Manual Java SE
--------------
main()
  ├─ read config
  ├─ create datasource
  ├─ create repositories
  ├─ create services
  └─ run app

CDI/Jakarta Runtime
-------------------
container bootstrap
  ├─ scan bean archive
  ├─ discover bean definitions
  ├─ resolve injection points
  ├─ create proxies/contextual instances
  ├─ run lifecycle callbacks
  └─ dispatch request/message/timer/etc.
```

Tetapi konsep composition root tetap penting. Hanya saja bentuknya berubah:

- `beans.xml`;
- annotation metadata;
- producer method;
- alternative selection;
- qualifier design;
- config source;
- deployment descriptor;
- application server resource binding;
- build-time augmentation pada runtime seperti Quarkus.

Top engineer tidak hanya bertanya “container bisa inject atau tidak?”, tetapi:

> **Di mana composition root sistem ini secara nyata? Apakah berada di code, metadata, configuration, build plugin, deployment descriptor, atau runtime server?**

---

## 6. Dependency Bukan Selalu “Object”

Dalam DI, dependency sering dianggap object/service. Itu terlalu sempit.

Dependency bisa berupa:

1. **Service dependency**
   - `CaseRepository`
   - `AuditTrail`
   - `NotificationSender`

2. **Policy dependency**
   - `AssignmentPolicy`
   - `EscalationPolicy`
   - `RetryPolicy`

3. **Configuration dependency**
   - timeout;
   - feature flag;
   - endpoint URL;
   - batch size;
   - max retry.

4. **Resource dependency**
   - datasource;
   - executor;
   - HTTP client;
   - JMS connection factory;
   - cache client.

5. **Runtime capability dependency**
   - transaction manager;
   - security context;
   - request context;
   - clock;
   - tracing context.

6. **Environment dependency**
   - active profile;
   - tenant;
   - agency;
   - deployment zone;
   - region.

7. **Temporal dependency**
   - current time;
   - scheduler;
   - timeout source;
   - monotonic clock.

8. **Randomness/id dependency**
   - UUID generator;
   - sequence generator;
   - secure random.

Salah satu tanda maturity adalah tidak membiarkan dependency tersembunyi.

Contoh buruk:

```java
public CaseRecord createCase(CreateCaseCommand command) {
    String prefix = System.getenv("CASE_PREFIX");
    String id = UUID.randomUUID().toString();
    Instant now = Instant.now();
    // ...
}
```

Masalah:

- environment dibaca langsung;
- ID generator fixed;
- waktu fixed ke wall-clock system;
- sulit dites deterministik;
- tidak ada validation config;
- tidak ada observability terhadap config.

Lebih baik:

```java
public final class CaseCreationService {
    private final CaseIdGenerator idGenerator;
    private final Clock clock;
    private final CaseNumberPolicy caseNumberPolicy;

    public CaseCreationService(
            CaseIdGenerator idGenerator,
            Clock clock,
            CaseNumberPolicy caseNumberPolicy
    ) {
        this.idGenerator = idGenerator;
        this.clock = clock;
        this.caseNumberPolicy = caseNumberPolicy;
    }
}
```

DI bukan berarti semua hal harus menjadi class besar. Tetapi dependency yang memengaruhi correctness, repeatability, auditability, dan environment behavior perlu terlihat.

---

## 7. Jenis Dependency Berdasarkan Stabilitas

Tidak semua dependency sama. Kita perlu membedakan berdasarkan stabilitas dan perubahan.

| Jenis dependency | Contoh | Cara pikir |
|---|---|---|
| Stable domain dependency | `AssignmentPolicy` | bagian dari model bisnis, eksplisitkan |
| Infrastructure dependency | `CaseRepository`, `HttpClient` | inject lewat interface/port |
| Runtime resource | `DataSource`, executor | dikelola container/runtime |
| Config dependency | timeout, endpoint | validasi di startup |
| Environment-specific dependency | mock provider local, real provider prod | pilih di composition root/profile |
| Request-specific dependency | current user, request id | jangan simpan di singleton biasa |
| Dynamic dependency | feature flag, tenant route | akses melalui evaluator/strategy |
| Ephemeral dependency | DTO, entity, value object | boleh `new` langsung |

Kesalahan umum adalah memperlakukan semua dependency dengan cara yang sama.

- Value object tidak perlu diinjeksi.
- Repository sebaiknya diinjeksi.
- Config perlu typed/validated.
- Request context tidak boleh disimpan pada application singleton tanpa proxy/context handling.
- Feature flag tidak boleh disembunyikan sebagai `System.getenv()` di tengah business logic.

---

## 8. Constructor Injection, Field Injection, Method Injection

Ada tiga bentuk injection utama.

### 8.1 Constructor Injection

```java
public final class CaseAssignmentService {
    private final CaseRepository caseRepository;
    private final AssignmentPolicy assignmentPolicy;

    public CaseAssignmentService(
            CaseRepository caseRepository,
            AssignmentPolicy assignmentPolicy
    ) {
        this.caseRepository = Objects.requireNonNull(caseRepository);
        this.assignmentPolicy = Objects.requireNonNull(assignmentPolicy);
    }
}
```

Kelebihan:

- dependency wajib terlihat;
- object tidak bisa dibuat dalam keadaan setengah jadi;
- cocok dengan `final` field;
- mudah dites tanpa container;
- dependency graph terlihat dari signature;
- mendukung immutability.

Kekurangan:

- constructor bisa panjang kalau class terlalu banyak tanggung jawab;
- circular dependency langsung terlihat dan gagal;
- pada beberapa framework lama butuh constructor no-arg/proxy constraints;
- kurang nyaman untuk optional dependency kalau tidak didesain baik.

Rule of thumb:

> **Gunakan constructor injection untuk dependency wajib.**

### 8.2 Field Injection

```java
public class CaseAssignmentService {
    @Inject
    private CaseRepository caseRepository;
}
```

Kelebihan:

- pendek;
- populer di contoh tutorial;
- mudah untuk managed class yang hanya dibuat container;
- mengurangi boilerplate.

Kelemahan:

- dependency tersembunyi dari constructor;
- field sulit dibuat `final`;
- object bisa dibuat manual dalam keadaan invalid;
- test tanpa container lebih sulit;
- class terlihat sederhana padahal dependency banyak;
- circular dependency lebih mudah tersembunyi;
- mendorong terlalu banyak dependency.

Field injection masih ada di banyak codebase enterprise lama. Namun untuk desain baru, terutama service/application logic, constructor injection biasanya lebih defensible.

### 8.3 Method / Setter Injection

```java
public class ReportService {
    private AuditTrail auditTrail;

    @Inject
    public void setAuditTrail(AuditTrail auditTrail) {
        this.auditTrail = auditTrail;
    }
}
```

Kelebihan:

- bisa untuk optional dependency;
- bisa untuk dependency yang memang mutable/reconfigurable;
- bisa membantu framework tertentu.

Kelemahan:

- object bisa berada pada intermediate state;
- invariant lebih sulit dijaga;
- setter bisa dipanggil ulang jika tidak hati-hati;
- kurang jelas untuk dependency wajib.

Rule of thumb:

> **Gunakan setter/method injection hanya kalau dependency memang optional, late-bound, atau framework-specific. Jangan pakai untuk dependency inti bisnis.**

---

## 9. Dependency Wajib vs Optional

Dependency wajib harus eksplisit dan fail-fast.

```java
public CaseAssignmentService(CaseRepository repository) {
    this.repository = Objects.requireNonNull(repository, "repository");
}
```

Optional dependency sebaiknya tidak disamarkan sebagai nullable field tanpa contract.

Buruk:

```java
@Inject
private NotificationSender notificationSender; // mungkin null?
```

Lebih baik:

```java
public final class CaseAssignmentService {
    private final Optional<NotificationSender> notificationSender;

    public CaseAssignmentService(Optional<NotificationSender> notificationSender) {
        this.notificationSender = Objects.requireNonNull(notificationSender);
    }
}
```

Atau lebih baik lagi, gunakan Null Object jika behavior default jelas:

```java
public final class NoopNotificationSender implements NotificationSender {
    @Override
    public void send(NotificationMessage message) {
        // intentionally no-op
    }
}
```

Dalam CDI/Jakarta, optional dependency punya mekanisme sendiri seperti `Instance<T>` atau `Provider<T>`, tetapi prinsipnya sama:

- jangan sembunyikan optionality;
- jangan buat dependency diam-diam null;
- jangan membuat business code penuh defensive null check karena wiring tidak jelas.

---

## 10. Lazy Dependency

Tidak semua dependency perlu dibuat/dipakai segera.

Contoh:

```java
public final class ExportService {
    private final Supplier<LargeReportRenderer> rendererSupplier;

    public ExportService(Supplier<LargeReportRenderer> rendererSupplier) {
        this.rendererSupplier = rendererSupplier;
    }

    public byte[] export(ExportRequest request) {
        LargeReportRenderer renderer = rendererSupplier.get();
        return renderer.render(request);
    }
}
```

Lazy dependency berguna untuk:

- object mahal dibuat;
- dependency hanya dipakai pada cabang tertentu;
- menghindari startup cost;
- mengambil instance scoped lebih sempit;
- memutus circular dependency sementara.

Namun lazy dependency juga berbahaya:

- failure pindah dari startup ke runtime;
- observability lebih sulit;
- bisa menyembunyikan circular design problem;
- bisa memunculkan latency spike pada request pertama;
- bisa mempersulit transaction/request context.

Rule:

> **Lazy injection adalah alat runtime, bukan cara menyembunyikan desain dependency yang kacau.**

---

## 11. Circular Dependency

Circular dependency terjadi ketika A membutuhkan B dan B membutuhkan A.

```text
A ──depends on──> B
B ──depends on──> A
```

Contoh:

```java
public final class CaseService {
    public CaseService(AuditService auditService) { }
}

public final class AuditService {
    public AuditService(CaseService caseService) { }
}
```

Circular dependency biasanya tanda desain buruk:

- boundary tidak jelas;
- service terlalu saling tahu;
- orchestration dan detail logic tercampur;
- event/audit/notification tidak dipisah;
- domain policy salah ditempatkan.

Cara memecahkan:

### 11.1 Ekstrak Interface Lebih Kecil

```text
CaseService depends on AuditRecorder
AuditService implements AuditRecorder
AuditService does not depend on CaseService
```

### 11.2 Pisahkan Orchestrator

```text
CaseAssignmentUseCase
  ├─ CaseService
  └─ AuditService
```

Alih-alih `CaseService` dan `AuditService` saling panggil, buat orchestrator di atasnya.

### 11.3 Gunakan Event Lokal Dengan Hati-hati

```text
CaseService publishes CaseAssignedEvent
AuditObserver observes CaseAssignedEvent
```

Ini bisa mengurangi coupling, tetapi jangan sampai event menjadi dependency tersembunyi yang sulit ditrace.

### 11.4 Gunakan Lazy Provider Jika Memang Siklus Lifecycle, Bukan Siklus Desain

Kadang circular dependency muncul karena lifecycle/proxy, bukan business design. Provider bisa membantu, tetapi harus menjadi pengecualian.

---

## 12. DI dan Interface: Apakah Semua Harus Interface?

Tidak.

Salah satu nasihat lama adalah “selalu inject interface”. Itu terlalu mekanis.

Gunakan interface jika:

- ada lebih dari satu implementation;
- implementation environment-specific;
- dependency adalah boundary ke external system;
- dependency ingin dimock/fake pada test;
- dependency mewakili port dalam hexagonal architecture;
- dependency punya contract stabil.

Tidak harus interface jika:

- hanya ada satu implementation internal;
- class adalah domain service kecil;
- abstraction hanya dibuat karena “katanya harus”; 
- interface hanya menduplikasi class tanpa value.

Contoh interface yang bernilai:

```java
public interface CaseRepository {
    CaseRecord findRequired(CaseId id);
    void assign(CaseId caseId, OfficerId officerId);
}
```

Karena repository adalah boundary persistence.

Contoh interface yang mungkin tidak bernilai:

```java
public interface CaseNumberFormatter {
    String format(CaseNumber number);
}

public final class DefaultCaseNumberFormatter implements CaseNumberFormatter {
    // only one trivial implementation forever
}
```

Jika tidak ada variasi dan tidak ada boundary penting, interface mungkin hanya noise.

Advanced rule:

> **Inject contract, bukan selalu interface. Contract bisa berupa interface, abstract class, concrete class yang stabil, atau qualifier-specific bean.**

---

## 13. DI dan Layered / Hexagonal Architecture

DI sangat cocok untuk mengarahkan dependency dari luar ke dalam.

```text
[ Web / REST Adapter ]
          │
          v
[ Application Service / Use Case ]
          │
          v
[ Domain Model / Domain Policy ]
          │
          v
[ Port Interface ] <── implemented by ── [ Infrastructure Adapter ]
```

Dalam code:

```java
public interface CaseRepository {
    CaseRecord findRequired(CaseId id);
}

public final class AssignCaseUseCase {
    private final CaseRepository caseRepository;
    private final AssignmentPolicy assignmentPolicy;

    public AssignCaseUseCase(
            CaseRepository caseRepository,
            AssignmentPolicy assignmentPolicy
    ) {
        this.caseRepository = caseRepository;
        this.assignmentPolicy = assignmentPolicy;
    }
}

public final class JpaCaseRepository implements CaseRepository {
    // infrastructure implementation
}
```

Dependency direction:

```text
Application service depends on repository interface.
Repository implementation depends on database/JPA.
Application service does not depend on JPA implementation details.
```

DI container menyambungkan:

```text
CaseRepository -> JpaCaseRepository
```

Business layer tidak perlu tahu.

Ini penting untuk sistem regulasi/case management karena:

- workflow logic harus stabil;
- infrastructure bisa berubah;
- audit/policy harus testable;
- integration ke external agency/system bisa diganti;
- migration database/API tidak boleh merusak domain/application contract.

---

## 14. DI Bukan Pengganti Desain Modul

DI sering disalahgunakan untuk menyembunyikan coupling.

Buruk:

```java
public final class MegaCaseService {
    public MegaCaseService(
            CaseRepository caseRepository,
            OfficerRepository officerRepository,
            AppealRepository appealRepository,
            EmailSender emailSender,
            SmsSender smsSender,
            PdfGenerator pdfGenerator,
            AuditTrail auditTrail,
            FeatureFlagService featureFlagService,
            PermissionService permissionService,
            PaymentService paymentService,
            ReportService reportService,
            WorkflowEngine workflowEngine
    ) { }
}
```

Constructor panjang bukan masalah DI. Itu sinyal desain:

- class punya terlalu banyak tanggung jawab;
- orchestration terlalu luas;
- use case tidak dipisah;
- module boundary lemah;
- cross-cutting concern belum dipisah;
- domain capability bercampur infrastructure.

DI membuat masalah dependency terlihat. Jangan salahkan DI jika desain terlalu besar.

Pertanyaan review:

1. Apakah class ini punya satu alasan utama untuk berubah?
2. Apakah semua dependency dipakai oleh mayoritas method?
3. Apakah ada group dependency yang bisa diekstrak menjadi collaborator?
4. Apakah cross-cutting concern sebaiknya interceptor/decorator?
5. Apakah ada orchestration yang sebaiknya naik ke use-case layer?
6. Apakah ada policy yang sebaiknya menjadi domain service?

---

## 15. DI vs Service Locator

Service locator sering terlihat mirip DI, tetapi berbeda secara prinsip.

### 15.1 Service Locator

```java
public final class CaseAssignmentService {
    public void assign(CaseId caseId, OfficerId officerId) {
        CaseRepository caseRepository = ServiceLocator.get(CaseRepository.class);
        AuditTrail auditTrail = ServiceLocator.get(AuditTrail.class);
        // ...
    }
}
```

Dependency tidak terlihat dari constructor. Class terlihat tidak punya dependency, padahal punya.

Masalah:

- contract palsu;
- test harus setup global registry;
- failure terjadi runtime;
- dependency bisa berubah per method tanpa jelas;
- static global state;
- susah reasoning;
- susah refactor.

### 15.2 Dependency Injection

```java
public final class CaseAssignmentService {
    private final CaseRepository caseRepository;
    private final AuditTrail auditTrail;

    public CaseAssignmentService(CaseRepository caseRepository, AuditTrail auditTrail) {
        this.caseRepository = caseRepository;
        this.auditTrail = auditTrail;
    }
}
```

Dependency terlihat dari object contract.

### 15.3 Kapan Lookup Masih Valid?

Lookup tidak selalu salah. Ia valid di boundary tertentu:

- framework integration;
- plugin loading;
- dynamic optional extension;
- low-level JNDI/resource bridge;
- container extension;
- admin tooling;
- scripting/runtime registry.

Tetapi business service biasanya tidak boleh lookup dependency utama sendiri.

Rule:

> **Lookup boleh ada di composition/root/infrastructure boundary. Jangan sebarkan lookup ke business code.**

---

## 16. DI vs Factory

Factory membuat object. DI menyambungkan dependency.

Factory valid untuk object yang perlu dibuat berkali-kali dengan input runtime.

```java
public interface CaseSnapshotFactory {
    CaseSnapshot create(CaseRecord record, SnapshotReason reason);
}
```

Contoh:

```java
public final class CaseSnapshotService {
    private final CaseRepository caseRepository;
    private final CaseSnapshotFactory snapshotFactory;

    public CaseSnapshotService(
            CaseRepository caseRepository,
            CaseSnapshotFactory snapshotFactory
    ) {
        this.caseRepository = caseRepository;
        this.snapshotFactory = snapshotFactory;
    }

    public CaseSnapshot snapshot(CaseId id, SnapshotReason reason) {
        CaseRecord record = caseRepository.findRequired(id);
        return snapshotFactory.create(record, reason);
    }
}
```

Factory cocok untuk:

- object dibuat berdasarkan parameter runtime;
- complex construction logic;
- aggregate/domain object creation;
- object bukan singleton/service;
- variasi object berdasarkan command.

Jangan gunakan factory untuk menyembunyikan dependency yang seharusnya diinjeksi.

Buruk:

```java
public final class RepositoryFactory {
    public CaseRepository create() {
        return new JdbcCaseRepository(new DriverManagerDataSource(...));
    }
}
```

Jika factory membaca config, membuat datasource, memilih implementation, dan dipakai di banyak tempat, ia mungkin sudah menjadi mini container yang tidak terkontrol.

---

## 17. DI vs Static Utility

Static utility cocok untuk pure function tanpa state dan tanpa dependency eksternal.

Contoh masih wajar:

```java
public final class CaseNumberFormats {
    private CaseNumberFormats() {}

    public static String normalize(String raw) {
        return raw == null ? null : raw.trim().toUpperCase(Locale.ROOT);
    }
}
```

Tidak wajar:

```java
public final class AuditUtils {
    public static void record(String action, String entityId) {
        DataSource ds = GlobalDataSource.get();
        // insert audit
    }
}
```

Karena ini menyembunyikan:

- datasource;
- transaction;
- error handling;
- config;
- testability;
- security context.

Rule:

> **Static utility hanya untuk pure/stateless computation. Jika butuh resource, config, context, time, randomness, atau external system, jadikan dependency eksplisit.**

---

## 18. DI dan Immutability

Constructor injection mendorong immutability.

```java
public final class EscalationPolicyService {
    private final EscalationRuleRepository ruleRepository;
    private final Clock clock;

    public EscalationPolicyService(EscalationRuleRepository ruleRepository, Clock clock) {
        this.ruleRepository = ruleRepository;
        this.clock = clock;
    }
}
```

Manfaat:

- thread-safety lebih mudah;
- object invariant jelas;
- dependency tidak berubah di tengah runtime;
- test lebih deterministik;
- race condition berkurang;
- reasoning lebih mudah.

Tetapi pada container proxy tertentu, final class/final method bisa bermasalah. Ini akan dibahas di part proxy/CDI.

Untuk sekarang cukup pegang prinsip:

> **Immutability baik untuk service design, tetapi runtime proxy model perlu dipahami agar tidak bertabrakan dengan container constraint.**

---

## 19. Object Lifetime dan Scope

DI tanpa lifecycle model tidak cukup.

Pertanyaan penting:

- Apakah object dibuat satu kali per aplikasi?
- Satu kali per request?
- Satu kali per session?
- Satu kali per injection point?
- Setiap kali diminta?
- Apakah thread-safe?
- Apakah menyimpan state user?
- Apakah perlu cleanup?

Contoh salah:

```java
@ApplicationScoped
public class CurrentUserHolder {
    private UserId currentUser;
}
```

Jika ini singleton application-wide, `currentUser` bisa bocor antar request/user.

Contoh lebih benar secara konsep:

```java
public interface CurrentUser {
    UserId id();
}
```

Implementation-nya harus request-scoped/contextual, bukan singleton mutable global.

DI harus selalu dilihat bersama lifecycle:

```text
Dependency injection answers: how is dependency supplied?
Scope/lifecycle answers: how long does dependency live?
Context answers: which instance is current now?
```

Tanpa scope model, injection bisa benar secara compile tetapi salah secara runtime.

---

## 20. Request Dependency vs Application Dependency

Aplikasi enterprise sering punya object yang hidup pada level berbeda.

```text
Application-wide
  ├─ config
  ├─ repositories
  ├─ HTTP client
  ├─ policy services
  └─ feature flag client

Request-specific
  ├─ current user
  ├─ request id
  ├─ correlation id
  ├─ locale
  └─ transaction/request context

Operation-specific
  ├─ command object
  ├─ validation result
  ├─ domain event list
  └─ temporary computation state
```

Jangan campur sembarangan.

Salah:

```java
public final class CaseService {
    private UserId currentUser; // mutable per request, dangerous if singleton
}
```

Benar:

```java
public final class CaseService {
    private final CurrentUserProvider currentUserProvider;

    public CaseService(CurrentUserProvider currentUserProvider) {
        this.currentUserProvider = currentUserProvider;
    }

    public void update(CaseId id) {
        UserId userId = currentUserProvider.currentUserId();
        // ...
    }
}
```

Atau lebih eksplisit lagi:

```java
public void update(CaseId id, UserId currentUserId) {
    // ...
}
```

Pilihannya tergantung boundary:

- Untuk pure domain/application logic, parameter eksplisit sering lebih jelas.
- Untuk cross-cutting context seperti correlation ID, provider/context abstraction bisa membantu.
- Untuk framework resource, injection lebih cocok.

---

## 21. Configuration as Dependency

Configuration sering menjadi dependency paling berbahaya karena tampak sederhana.

Contoh buruk:

```java
public final class ExternalScreeningClient {
    public ScreeningResult screen(Person person) {
        String endpoint = System.getenv("SCREENING_ENDPOINT");
        int timeoutMs = Integer.parseInt(System.getenv("SCREENING_TIMEOUT_MS"));
        // call endpoint
    }
}
```

Masalah:

- parsing berulang;
- tidak fail-fast;
- invalid config baru ketahuan saat request;
- sulit dites;
- environment variable name tersebar;
- tidak ada default/validation policy;
- config contract tidak terdokumentasi.

Lebih baik:

```java
public record ScreeningClientConfig(
        URI endpoint,
        Duration timeout,
        int maxRetries
) {
    public ScreeningClientConfig {
        Objects.requireNonNull(endpoint);
        Objects.requireNonNull(timeout);
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
        if (maxRetries < 0 || maxRetries > 5) {
            throw new IllegalArgumentException("maxRetries must be between 0 and 5");
        }
    }
}
```

Lalu:

```java
public final class ExternalScreeningClient {
    private final ScreeningClientConfig config;
    private final HttpClient httpClient;

    public ExternalScreeningClient(ScreeningClientConfig config, HttpClient httpClient) {
        this.config = config;
        this.httpClient = httpClient;
    }
}
```

Prinsip:

> **Configuration adalah dependency. Treat it as typed, validated, observable runtime contract.**

---

## 22. DI dan Feature Flag

Feature flag juga dependency, tetapi dynamic.

Buruk:

```java
if (System.getenv("ENABLE_NEW_ASSIGNMENT").equals("true")) {
    newAssignment();
} else {
    oldAssignment();
}
```

Masalah:

- string tersebar;
- tidak ada audit flag decision;
- sulit test kombinasi;
- sulit rollout per tenant/user;
- fallback tidak jelas;
- business code penuh deployment concern.

Lebih baik:

```java
public interface FeatureDecisions {
    boolean useNewAssignmentPolicy(AssignmentContext context);
}
```

Lalu:

```java
public final class AssignmentPolicyRouter implements AssignmentPolicy {
    private final FeatureDecisions featureDecisions;
    private final AssignmentPolicy oldPolicy;
    private final AssignmentPolicy newPolicy;

    public AssignmentPolicyRouter(
            FeatureDecisions featureDecisions,
            AssignmentPolicy oldPolicy,
            AssignmentPolicy newPolicy
    ) {
        this.featureDecisions = featureDecisions;
        this.oldPolicy = oldPolicy;
        this.newPolicy = newPolicy;
    }

    @Override
    public void validate(CaseRecord caseRecord, Officer officer) {
        AssignmentContext context = AssignmentContext.from(caseRecord, officer);
        if (featureDecisions.useNewAssignmentPolicy(context)) {
            newPolicy.validate(caseRecord, officer);
        } else {
            oldPolicy.validate(caseRecord, officer);
        }
    }
}
```

DI tidak menghilangkan feature flag complexity. Tetapi DI membantu menempatkan complexity di boundary yang jelas.

---

## 23. DI dan Testability

Salah satu alasan terbesar DI adalah testability.

Tanpa DI:

```java
public final class CaseAssignmentService {
    private final CaseRepository repository = new JdbcCaseRepository();
}
```

Test harus memakai database nyata atau hacking.

Dengan DI:

```java
@Test
void assignsCaseWhenOfficerIsEligible() {
    FakeCaseRepository caseRepository = new FakeCaseRepository();
    FakeOfficerRepository officerRepository = new FakeOfficerRepository();
    AssignmentPolicy policy = new DefaultAssignmentPolicy();
    InMemoryAuditTrail auditTrail = new InMemoryAuditTrail();

    CaseAssignmentService service = new CaseAssignmentService(
            caseRepository,
            officerRepository,
            policy,
            auditTrail
    );

    service.assign(new CaseId("CASE-001"), new OfficerId("OFF-001"));

    assertTrue(caseRepository.wasAssigned("CASE-001", "OFF-001"));
    assertTrue(auditTrail.containsAction("CASE_ASSIGNED"));
}
```

Test ini:

- tidak butuh container;
- tidak butuh database;
- cepat;
- deterministic;
- fokus pada business behavior.

Advanced testing principle:

> **Semakin murni application/domain service-mu, semakin sedikit container yang dibutuhkan untuk mengetes behavior. Container test tetap perlu, tetapi untuk wiring/runtime contract, bukan semua business logic.**

---

## 24. DI dan Runtime Validation

DI container bisa melakukan validation saat startup/deployment.

Contoh error yang bisa dideteksi lebih awal:

- no bean available for dependency;
- multiple beans match dependency;
- circular dependency tertentu;
- unproxyable type;
- invalid scope combination;
- missing producer;
- deployment descriptor mismatch.

Manual wiring juga bisa fail-fast jika composition root didesain baik.

Buruk:

```java
public void handle(Request request) {
    Service service = maybeCreateService(); // can fail after app runs for hours
}
```

Lebih baik:

```java
public static void main(String[] args) {
    Application app = ApplicationFactory.createValidated(args);
    app.run();
}
```

Dalam enterprise runtime:

```text
startup/deployment phase should validate object graph as much as possible
runtime phase should handle business/runtime failures, not basic wiring errors
```

Namun dynamic/lazy dependency bisa menunda failure. Karena itu harus dipakai sadar.

---

## 25. DI dan Error Locality

Error locality berarti error terjadi dekat dengan sumber masalah.

Tanpa DI eksplisit:

```java
public void process() {
    ServiceLocator.get(PaymentClient.class).charge(...);
}
```

Jika `PaymentClient` tidak tersedia, error terjadi saat method dipanggil, mungkin pada request production tertentu.

Dengan constructor injection:

```java
public PaymentService(PaymentClient paymentClient) {
    this.paymentClient = Objects.requireNonNull(paymentClient);
}
```

Failure terjadi saat object dibuat/wiring.

Lebih baik lagi jika container memvalidasi injection point saat deployment.

Error locality tinggi membuat:

- debugging lebih cepat;
- production incident lebih kecil;
- deployment failure lebih aman daripada runtime partial failure;
- root cause lebih jelas.

---

## 26. DI dan Observability

Dependency graph adalah runtime structure. Kalau tidak observable, incident analysis sulit.

Hal yang perlu bisa dijawab:

- implementation mana yang aktif untuk interface tertentu?
- config mana yang dipakai untuk memilih implementation?
- profile mana yang aktif?
- feature flag mana yang memengaruhi routing?
- interceptor/decorator apa yang membungkus service?
- apakah dependency dibuat eager atau lazy?
- apakah object scoped request/session/application?
- apakah ada fallback/noop implementation aktif?

Pada production-grade system, minimal:

1. log startup menampilkan profile/config source penting;
2. health/readiness mengecek required dependency;
3. safe diagnostic endpoint bisa menampilkan non-secret runtime selection;
4. feature flag decision bisa ditrace;
5. dependency/provider mismatch bisa ditemukan dari logs;
6. deployment artifact menyimpan dependency tree/SBOM.

DI yang baik bukan hanya “jalan”, tetapi bisa dijelaskan ketika gagal.

---

## 27. Dependency Graph sebagai Struktur Arsitektur

Object graph bukan detail kecil.

Contoh graph:

```text
AssignCaseResource
  └─ AssignCaseUseCase
      ├─ CaseRepository
      │   └─ DataSource
      ├─ OfficerRepository
      │   └─ DataSource
      ├─ AssignmentPolicy
      │   ├─ WorkloadPolicy
      │   └─ ConflictOfInterestPolicy
      ├─ AuditTrail
      │   ├─ AuditRepository
      │   │   └─ DataSource
      │   └─ Clock
      └─ FeatureDecisions
          └─ FeatureFlagClient
```

Dari graph ini kita bisa melihat:

- persistence dependency terkonsentrasi di repository;
- policy terpisah dari repository;
- audit punya dependency sendiri;
- feature flag ada di decision boundary;
- resource layer hanya masuk ke use case.

Graph buruk:

```text
AssignCaseResource
  ├─ EntityManager
  ├─ DataSource
  ├─ AuditTableWriter
  ├─ FeatureFlagClient
  ├─ EmailClient
  ├─ PdfGenerator
  ├─ OfficerRepository
  ├─ WorkflowEngine
  └─ System.getenv(...)
```

Ini menunjukkan resource layer terlalu banyak tahu.

Review dependency graph adalah review architecture.

---

## 28. Anti-Pattern: Hidden Dependency

Hidden dependency adalah dependency yang tidak terlihat dari public contract object.

Contoh:

```java
public final class CaseDecisionService {
    public Decision decide(CaseRecord caseRecord) {
        String mode = System.getProperty("decision.mode");
        User user = SecurityContextHolder.currentUser();
        AuditTrail.global().record("DECIDE");
        return Decision.approve();
    }
}
```

Dependency tersembunyi:

- system property;
- current user context;
- audit trail global;
- maybe current time;
- maybe transaction context.

Dampak:

- test tidak jelas;
- production behavior tergantung global state;
- concurrency risk;
- migration sulit;
- compliance/audit sulit dipertanggungjawabkan;
- dependency graph palsu.

Perbaikan:

```java
public final class CaseDecisionService {
    private final DecisionModeProvider decisionModeProvider;
    private final CurrentUserProvider currentUserProvider;
    private final AuditTrail auditTrail;

    public CaseDecisionService(
            DecisionModeProvider decisionModeProvider,
            CurrentUserProvider currentUserProvider,
            AuditTrail auditTrail
    ) {
        this.decisionModeProvider = decisionModeProvider;
        this.currentUserProvider = currentUserProvider;
        this.auditTrail = auditTrail;
    }
}
```

Atau jika current user adalah bagian use-case input:

```java
public Decision decide(CaseRecord caseRecord, UserId currentUserId) {
    // ...
}
```

---

## 29. Anti-Pattern: Ambient Context Everywhere

Ambient context adalah context global yang bisa dibaca dari mana saja.

Contoh:

```java
TenantId tenantId = TenantContext.getCurrentTenant();
UserId userId = UserContext.getCurrentUser();
String requestId = RequestContext.getRequestId();
```

Ini kadang perlu, tetapi berbahaya jika dipakai tanpa boundary.

Masalah:

- dependency tersembunyi;
- ThreadLocal leak;
- async context hilang;
- request data bocor antar thread;
- test perlu setup global;
- function terlihat pure padahal tidak.

Lebih defensible:

- gunakan context object eksplisit untuk application use case;
- gunakan provider/injection hanya di boundary;
- jangan baca ambient context di domain model;
- pastikan context propagation pada async;
- cleanup ThreadLocal selalu;
- trace context sebagai cross-cutting concern, bukan business dependency.

Contoh eksplisit:

```java
public record RequestActor(
        UserId userId,
        TenantId tenantId,
        Set<Role> roles
) {}

public void approveCase(CaseId caseId, RequestActor actor) {
    // actor visible as use-case input
}
```

---

## 30. Anti-Pattern: Configuration-Driven Business Logic Sprawl

Buruk:

```java
if (config.get("agency").equals("A")) {
    // special rule A
} else if (config.get("agency").equals("B")) {
    // special rule B
} else if (config.get("agency").equals("C")) {
    // special rule C
}
```

Ini sering muncul pada sistem multi-agency/multi-tenant.

Masalah:

- business rule tersebar;
- config menjadi programming language liar;
- testing matrix meledak;
- behavior sulit diaudit;
- perubahan agency dapat merusak agency lain.

Lebih baik:

```java
public interface AgencyCasePolicy {
    void validate(CaseRecord caseRecord);
}

public final class AgencyAPolicy implements AgencyCasePolicy { }
public final class AgencyBPolicy implements AgencyCasePolicy { }
```

Lalu pilih policy di boundary:

```java
public final class AgencyPolicyResolver {
    private final Map<AgencyCode, AgencyCasePolicy> policies;

    public AgencyCasePolicy resolve(AgencyCode agencyCode) {
        AgencyCasePolicy policy = policies.get(agencyCode);
        if (policy == null) {
            throw new UnknownAgencyPolicyException(agencyCode);
        }
        return policy;
    }
}
```

DI membantu menyediakan registry/strategies, tetapi business variation tetap harus dimodelkan.

---

## 31. Anti-Pattern: Everything Is Injectable

Tidak semua class harus masuk container.

Jangan inject:

- entity;
- DTO;
- command object;
- value object;
- collection biasa;
- domain event instance;
- temporary calculation object;
- simple immutable object yang dibuat dari input runtime.

Contoh buruk:

```java
@Inject
private CreateCaseCommand command;
```

Command berasal dari request. Ia bukan singleton bean.

Lebih benar:

```java
public CaseId create(CreateCaseCommand command) {
    // command is input, not container dependency
}
```

Container dependency adalah collaborator, bukan data input.

Rule:

> **Inject services/resources/policies/config/context providers. Pass data as parameters. Create values with constructors/factories.**

---

## 32. Anti-Pattern: Container-Only Business Logic

Jika business service hanya bisa dites dengan menjalankan full container, ada kemungkinan desainnya terlalu tergantung framework.

Contoh:

```java
@RequestScoped
public class CaseDecisionService {
    @Inject EntityManager em;
    @Inject HttpServletRequest request;
    @Inject SecurityContext securityContext;
    @Inject FeatureFlagService flags;

    public Decision decide(String caseId) {
        // all logic here
    }
}
```

Masalah:

- business logic bercampur HTTP;
- persistence detail langsung;
- security/request context langsung;
- sulit unit test;
- sulit reuse dari batch/message/timer;
- decision logic tidak portable.

Lebih baik:

```text
HTTP Resource
  └─ extracts request/user/input
      └─ calls UseCase
          ├─ domain policy
          ├─ repository port
          └─ audit port
```

Framework berada di tepi, bukan di jantung logic.

---

## 33. DI dan Transaction Boundary

DI tidak otomatis menentukan transaction boundary. Tetapi DI graph memengaruhi letak transaction.

Buruk:

```text
Repository method opens transaction individually
Service calls many repositories
Each repository commits separately
```

Dampak:

- partial update;
- audit tidak konsisten;
- rollback sulit;
- invariant lintas repository gagal.

Lebih baik:

```text
Use case/application service defines transaction boundary
Repositories participate in existing transaction
```

Dalam Jakarta/CDI/EJB, transaction sering diterapkan melalui interceptor/proxy. Itu berarti:

- method harus dipanggil melalui proxy;
- self-invocation bisa melewati interceptor;
- scope dan bean type penting;
- business method boundary harus jelas.

Part ini belum membahas transaksi detail, tetapi fondasinya:

> **Injection graph harus mendukung boundary transaksi, bukan membuat transaksi tersebar acak di dependency bawah.**

---

## 34. DI dan Security Boundary

Security juga sering masuk lewat container/proxy/context.

Pertanyaan:

- siapa current user?
- role/permission dari mana?
- authorization dicek di layer mana?
- apakah policy authorization bagian domain atau technical security?
- apakah audit tahu actor?
- apakah async process masih punya security context?

Buruk:

```java
public void approve(CaseId id) {
    if (!SecurityContextHolder.hasRole("ADMIN")) {
        throw new ForbiddenException();
    }
    // approve
}
```

Lebih eksplisit:

```java
public void approve(CaseId id, RequestActor actor) {
    authorizationPolicy.requireCanApprove(actor, id);
    // approve
}
```

Atau cross-cutting annotation/interceptor untuk boundary API, tetapi domain/application policy tetap jelas.

DI membantu inject `AuthorizationPolicy`, bukan menyembunyikan security rule di global static.

---

## 35. DI dan Time

Time adalah dependency.

Buruk:

```java
if (Instant.now().isAfter(caseRecord.deadline())) {
    escalate(caseRecord);
}
```

Sulit dites.

Lebih baik:

```java
public final class EscalationService {
    private final Clock clock;

    public EscalationService(Clock clock) {
        this.clock = clock;
    }

    public boolean shouldEscalate(CaseRecord caseRecord) {
        return Instant.now(clock).isAfter(caseRecord.deadline());
    }
}
```

Test:

```java
Clock fixedClock = Clock.fixed(
        Instant.parse("2026-06-16T10:00:00Z"),
        ZoneOffset.UTC
);
```

Untuk workflow/regulatory system, time dependency penting karena:

- SLA;
- escalation;
- due date;
- grace period;
- audit timestamp;
- retention/archive;
- legal effective date.

Jangan sembunyikan time jika memengaruhi business decision.

---

## 36. DI dan Randomness / ID

ID/randomness juga dependency.

Buruk:

```java
String caseId = UUID.randomUUID().toString();
```

Tidak selalu buruk, tetapi untuk beberapa domain perlu abstraction:

```java
public interface CaseIdGenerator {
    CaseId nextId();
}
```

Manfaat:

- test deterministic;
- format ID konsisten;
- bisa pakai sequence database;
- bisa encode agency/year;
- bisa audit ID generation;
- bisa ganti implementation tanpa ubah use case.

Jangan over-engineer semua UUID. Tetapi untuk ID yang menjadi business key/regulatory reference, treat generator as dependency.

---

## 37. DI dan Resource Management

Object seperti `DataSource`, HTTP client, executor, connection factory, cache client punya lifecycle.

Salah:

```java
public void send() {
    HttpClient client = HttpClient.newHttpClient();
    // every call creates client
}
```

Atau:

```java
public class ReportService {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);
}
```

Masalah:

- thread leak;
- tidak managed by container;
- shutdown tidak jelas;
- observability lemah;
- resource count tidak terkendali;
- duplicate connection pool.

Lebih baik:

- resource dibuat di composition root/container;
- injected sebagai shared dependency;
- lifecycle dikelola;
- shutdown hook jelas;
- config tervalidasi;
- metrics tersedia.

Dalam Jakarta runtime, resource sering dikelola container dan diinjeksi melalui resource/CDI producer.

---

## 38. Manual DI vs Container DI

Manual DI:

```java
DataSource ds = createDataSource(config);
CaseRepository repo = new JdbcCaseRepository(ds);
CaseService service = new CaseService(repo);
```

Container DI:

```java
@Inject
CaseRepository repo;
```

Atau constructor injection pada managed bean.

### Manual DI Cocok Untuk

- aplikasi kecil;
- library;
- domain test;
- command-line tool;
- composition root eksplisit;
- tempat ingin full control.

### Container DI Cocok Untuk

- aplikasi enterprise besar;
- banyak integration point;
- lifecycle/scopes/context;
- interceptor/decorator;
- transaction/security/resource integration;
- deployment validation;
- runtime extension.

### Trade-off

| Aspek | Manual DI | Container DI |
|---|---|---|
| Explicitness | tinggi | bisa tinggi jika disiplin, bisa implicit |
| Boilerplate | lebih banyak | lebih sedikit |
| Startup validation | manual | container-supported |
| Scopes/context | manual sulit | native |
| Testing pure unit | mudah | mudah jika constructor tetap dipakai |
| Debugging graph | eksplisit di code | perlu memahami container |
| Dynamic features | manual | powerful |
| Hidden magic risk | rendah | sedang/tinggi jika sembarangan |

Top engineer tidak fanatik. Mereka memilih berdasarkan runtime need.

---

## 39. DI Container as Graph Compiler

Cara berpikir advanced:

> **DI container adalah graph compiler runtime/build-time.**

Input:

- classes;
- annotations;
- qualifiers;
- scopes;
- producer methods;
- alternatives;
- config;
- deployment descriptors;
- extensions.

Output:

- validated dependency graph;
- contextual instances;
- proxies;
- interceptors;
- lifecycle callbacks;
- error report jika graph invalid.

```text
Source metadata
  ├─ types
  ├─ annotations
  ├─ scopes
  ├─ qualifiers
  ├─ producers
  └─ config
        │
        v
DI container resolution
        │
        ├─ valid graph -> runtime objects/proxies
        └─ invalid graph -> deployment/startup error
```

Maka error DI bukan “annotation error” saja. Ia bisa berasal dari:

- class tidak discoverable;
- dependency graph ambiguous;
- type assignability gagal;
- qualifier salah;
- scope tidak aktif;
- proxy tidak bisa dibuat;
- implementation tidak ada karena dependency scope build salah;
- classloader memuat class berbeda;
- config memilih bean yang tidak tersedia.

---

## 40. Type-Safe Resolution: Mengapa DI Modern Tidak Berbasis String

DI modern seperti CDI berusaha type-safe.

Buruk:

```java
Object service = registry.get("caseAssignmentService");
```

Lebih baik:

```java
CaseAssignmentService service = container.get(CaseAssignmentService.class);
```

Lebih baik lagi dengan qualifier ketika ada banyak implementation:

```java
@Fast
AssignmentPolicy fastPolicy;

@Strict
AssignmentPolicy strictPolicy;
```

String-based lookup rentan:

- typo;
- rename tidak terdeteksi compiler;
- refactoring sulit;
- ambiguity tersembunyi;
- IDE support lemah.

Namun type saja tidak cukup jika ada banyak implementation. Maka qualifier diperlukan.

Part qualifier detail akan dibahas nanti. Untuk sekarang:

> **Type menjawab “jenis dependency apa?” Qualifier menjawab “varian mana?” Scope menjawab “hidup berapa lama?”**

---

## 41. Dependency Direction dan Stability

Gunakan prinsip stabilitas:

- high-level policy tidak boleh tergantung low-level detail;
- low-level implementation boleh tergantung interface/contract high-level;
- runtime wiring menyambungkan keduanya.

Buruk:

```java
public final class AssignmentPolicy {
    private final OracleAssignmentRuleDao dao;
}
```

Policy domain tergantung Oracle DAO.

Lebih baik:

```java
public interface AssignmentRuleRepository {
    List<AssignmentRule> findActiveRules();
}

public final class AssignmentPolicy {
    private final AssignmentRuleRepository rules;
}

public final class OracleAssignmentRuleRepository implements AssignmentRuleRepository {
    // Oracle-specific
}
```

Dependency direction:

```text
AssignmentPolicy -> AssignmentRuleRepository <- OracleAssignmentRuleRepository
```

Wiring memilih implementation.

---

## 42. Designing Constructor Signatures as Architecture Documentation

Constructor adalah dokumentasi dependency paling jujur.

```java
public FinalDecisionService(
        DecisionRuleRepository ruleRepository,
        EligibilityPolicy eligibilityPolicy,
        ConflictCheckPolicy conflictCheckPolicy,
        AuditTrail auditTrail,
        Clock clock
) { }
```

Dari signature, reviewer bisa bertanya:

- mengapa decision service perlu audit langsung?
- mengapa clock dipakai di decision?
- apakah policy sudah terpisah?
- apakah repository dependency terlalu banyak?
- apakah ini application service atau domain service?
- apakah audit cross-cutting atau explicit business record?

Constructor panjang bukan otomatis buruk. Kadang use case memang orchestration. Tetapi constructor membuat complexity terlihat.

Field injection menyembunyikannya:

```java
@Inject DecisionRuleRepository ruleRepository;
@Inject EligibilityPolicy eligibilityPolicy;
@Inject ConflictCheckPolicy conflictCheckPolicy;
@Inject AuditTrail auditTrail;
@Inject Clock clock;
```

Lebih mudah terlihat pendek, tetapi dependency tetap banyak.

---

## 43. Dependency Injection and Records / Modern Java

Java 16+ records berguna untuk immutable data/config, bukan biasanya untuk service bean kompleks.

Config record:

```java
public record AuditConfig(
        boolean enabled,
        Duration retentionPeriod,
        int batchSize
) {
    public AuditConfig {
        Objects.requireNonNull(retentionPeriod);
        if (batchSize <= 0) {
            throw new IllegalArgumentException("batchSize must be positive");
        }
    }
}
```

Command record:

```java
public record AssignCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        String reason
) {}
```

Service as record?

```java
public record AssignCaseUseCase(
        CaseRepository caseRepository,
        AssignmentPolicy assignmentPolicy
) {
    public void handle(AssignCaseCommand command) {
        // ...
    }
}
```

Ini bisa bagus untuk pure Java/manual DI, tetapi perlu hati-hati dengan framework/container yang butuh proxy/subclass/no-arg constructor. Banyak CDI normal scoped beans perlu proxyability yang mungkin tidak cocok dengan final record. Jadi record lebih aman untuk:

- config object;
- command;
- event;
- DTO;
- immutable domain value;
- test fixture.

Untuk managed service/proxied bean, pahami constraint runtime dulu.

---

## 44. Java 8 sampai 25: Apa yang Berubah Untuk DI?

DI concept stabil dari Java 8 sampai 25, tetapi language/runtime berubah.

### Java 8

- lambdas;
- functional interfaces;
- `Optional`;
- default methods;
- `java.time.Clock` tersedia.

Dampak DI:

- strategy bisa functional interface;
- time dependency bisa lebih baik via `Clock`;
- supplier/provider pattern lebih natural.

### Java 9+

- JPMS module system;
- stronger encapsulation;
- reflective access lebih kompleks.

Dampak DI:

- container/proxy/reflection butuh akses module/package;
- split package makin bermasalah;
- classpath vs module path decision penting.

### Java 11/17

- baseline LTS modern;
- banyak Jakarta EE modern mengarah ke Java 11/17+;
- deployment runtime makin cloud-native.

Dampak DI:

- migration `javax` ke `jakarta` sering sekaligus upgrade Java;
- container compatibility matrix penting.

### Java 21

- virtual threads final;
- records/patterns sudah matang;
- modern concurrency model memengaruhi resource/context propagation.

Dampak DI:

- jangan inject/request-scope sembarangan ke virtual-thread workload tanpa pahami context;
- managed executor vs virtual thread perlu runtime-specific evaluation.

### Java 25

- modern LTS generation;
- enterprise runtime perlu compatibility check;
- DI concept tetap sama, tetapi runtime/provider support menentukan real behavior.

Prinsip lintas versi:

> **DI bukan fitur bahasa Java. DI adalah architectural/runtime pattern yang memakai fitur bahasa Java. Karena itu compatibility-nya sangat bergantung pada container/provider/framework.**

---

## 45. Minimal Manual DI Example: From Bad to Better

### 45.1 Naive Implementation

```java
public final class CaseApprovalService {
    public void approve(String caseId) {
        JdbcCaseRepository caseRepository = new JdbcCaseRepository();
        DatabaseAuditTrail auditTrail = new DatabaseAuditTrail();
        EmailNotificationSender emailSender = new EmailNotificationSender();

        CaseRecord record = caseRepository.find(caseId);
        record.approve();
        caseRepository.save(record);
        auditTrail.record("APPROVED", caseId);
        emailSender.sendApprovalNotice(record);
    }
}
```

Problems:

- creates infrastructure directly;
- no transaction boundary shown;
- no config;
- no test seam;
- no error policy;
- no clock/user/audit actor;
- approval logic mixed with infrastructure.

### 45.2 Dependency-Inverted Version

```java
public interface CaseRepository {
    CaseRecord findRequired(CaseId caseId);
    void save(CaseRecord record);
}

public interface AuditTrail {
    void record(AuditEvent event);
}

public interface NotificationSender {
    void sendApprovalNotice(CaseRecord record);
}

public final class CaseApprovalService {
    private final CaseRepository caseRepository;
    private final AuditTrail auditTrail;
    private final NotificationSender notificationSender;
    private final Clock clock;

    public CaseApprovalService(
            CaseRepository caseRepository,
            AuditTrail auditTrail,
            NotificationSender notificationSender,
            Clock clock
    ) {
        this.caseRepository = Objects.requireNonNull(caseRepository);
        this.auditTrail = Objects.requireNonNull(auditTrail);
        this.notificationSender = Objects.requireNonNull(notificationSender);
        this.clock = Objects.requireNonNull(clock);
    }

    public void approve(CaseId caseId, RequestActor actor) {
        CaseRecord record = caseRepository.findRequired(caseId);
        record.approve(actor.userId(), Instant.now(clock));
        caseRepository.save(record);

        auditTrail.record(AuditEvent.of(
                "CASE_APPROVED",
                caseId.value(),
                actor.userId().value(),
                Instant.now(clock)
        ));

        notificationSender.sendApprovalNotice(record);
    }
}
```

This is not automatically perfect, but better:

- infrastructure hidden behind ports;
- dependencies explicit;
- actor explicit;
- time injectable;
- testable;
- audit visible;
- notification replaceable.

### 45.3 Manual Composition Root

```java
public final class ApplicationFactory {
    public static CaseApprovalService create(AppConfig config) {
        DataSource dataSource = DataSources.create(config.database());
        CaseRepository caseRepository = new JdbcCaseRepository(dataSource);
        AuditTrail auditTrail = new DatabaseAuditTrail(dataSource);
        NotificationSender notificationSender = new SmtpNotificationSender(config.smtp());
        Clock clock = Clock.systemUTC();

        return new CaseApprovalService(
                caseRepository,
                auditTrail,
                notificationSender,
                clock
        );
    }
}
```

In CDI, this composition is distributed across bean definitions, producers, resources, and annotations. But the mental model stays the same.

---

## 46. DI Review Checklist

Gunakan checklist ini saat review class/service.

### 46.1 Dependency Visibility

- Apakah dependency wajib terlihat di constructor?
- Apakah ada hidden dependency via static/global/env lookup?
- Apakah time/random/config/context tersembunyi?
- Apakah dependency optional terlihat sebagai optional?

### 46.2 Boundary

- Apakah business logic tergantung implementation infrastructure?
- Apakah resource layer terlalu banyak tahu?
- Apakah domain model membaca container/context?
- Apakah application service memegang orchestration yang wajar?

### 46.3 Lifecycle

- Apakah dependency thread-safe untuk scope-nya?
- Apakah request/user state masuk singleton?
- Apakah resource punya cleanup?
- Apakah lazy dependency menunda failure berbahaya?

### 46.4 Testability

- Bisakah class dites tanpa container?
- Bisakah dependency diganti fake?
- Apakah test harus setup global registry?
- Apakah clock/id/config bisa dikontrol?

### 46.5 Configuration

- Apakah config typed dan validated?
- Apakah required config fail-fast?
- Apakah secret tidak bocor ke logs?
- Apakah profile/flag tidak tersebar ke business code?

### 46.6 Graph Health

- Apakah constructor terlalu banyak dependency?
- Apakah ada circular dependency?
- Apakah ada god service?
- Apakah implementation selection jelas?
- Apakah dependency graph bisa dijelaskan?

---

## 47. Failure Model: Jika DI Bermasalah, Cari Apa?

Saat ada masalah DI, klasifikasikan dulu.

```text
1. Dependency not visible?
   └─ hidden static/global lookup?

2. Dependency not available?
   └─ bean/provider/implementation tidak terdaftar?

3. Dependency ambiguous?
   └─ ada banyak implementation tanpa qualifier?

4. Dependency wrong lifecycle?
   └─ request object masuk singleton?

5. Dependency wrong classloader?
   └─ type sama nama tapi beda loader?

6. Dependency wrong namespace?
   └─ javax vs jakarta mixed?

7. Dependency wrong config?
   └─ profile/flag memilih implementation salah?

8. Dependency proxy problem?
   └─ final class/method/no proxyable constructor?

9. Dependency circular?
   └─ desain saling membutuhkan?

10. Dependency hidden in runtime lookup?
    └─ failure baru muncul saat method tertentu dipanggil?
```

Untuk part ini, yang penting adalah mental model. Detail CDI error akan dibahas pada part debugging nanti.

---

## 48. Practical Heuristics: Kapan Inject, Kapan New, Kapan Pass Parameter?

### Inject Jika

- object adalah service/collaborator;
- implementation bisa berbeda;
- object punya resource/lifecycle;
- object perlu configuration;
- object perlu diganti di test;
- object adalah boundary ke external system;
- object adalah policy/strategy;
- object mengandung runtime capability.

### Pakai `new` Jika

- value object;
- DTO;
- command;
- domain event;
- immutable result;
- temporary calculation object;
- object tidak punya external dependency;
- object dibuat berdasarkan input runtime.

### Pass Parameter Jika

- data berasal dari request/command;
- current actor bagian business action;
- value operation-specific;
- explicitness lebih penting daripada convenience;
- domain method harus pure/deterministic.

### Factory Jika

- object dibuat berulang dengan input runtime;
- construction complex;
- ada variasi object creation;
- creation itself is domain concept.

### Provider/Lazy Jika

- dependency mahal;
- dependency optional/dynamic;
- perlu instance dari scope lebih sempit;
- perlu menghindari startup cost dengan sadar;
- bukan untuk menyembunyikan desain circular yang buruk.

---

## 49. Mental Model Ringkas

```text
Object should declare what it needs.
Composition root/container decides what it gets.
Scope decides how long it lives.
Context decides which instance is active.
Qualifier decides which implementation variant.
Config decides environment/runtime values.
Feature flag decides controlled runtime behavior.
Interceptor/decorator decides cross-cutting wrapping.
Test decides substitute dependencies.
```

Atau versi lebih pendek:

```text
DI is not about avoiding `new`.
DI is about making collaboration explicit, replaceable, validated, and lifecycle-aware.
```

---

## 50. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum masuk Part 007, pastikan bisa menjawab:

1. Apa bedanya object construction dan object collaboration?
2. Apa bedanya IoC dan DI?
3. Mengapa constructor injection biasanya lebih baik untuk dependency wajib?
4. Mengapa field injection bisa menyembunyikan complexity?
5. Apa bedanya dependency injection dan service locator?
6. Kapan factory lebih tepat daripada DI?
7. Mengapa config/time/randomness bisa disebut dependency?
8. Mengapa request-specific data tidak boleh disimpan di singleton service?
9. Bagaimana DI membantu testing?
10. Bagaimana dependency graph mencerminkan architecture?
11. Kapan sebuah class tidak perlu menjadi bean/container-managed object?
12. Apa risiko lazy dependency?
13. Apa arti composition root dalam manual app vs CDI/Jakarta runtime?
14. Mengapa DI bukan pengganti desain module?
15. Apa tanda circular dependency menunjukkan desain buruk?

---

## 51. Preview Part Berikutnya

Part berikutnya:

```text
Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
```

Kita akan membahas vocabulary minimal DI yang menjadi dasar banyak runtime:

- `@Inject`;
- `@Named`;
- `@Qualifier`;
- `@Scope`;
- `@Singleton`;
- `Provider<T>`;
- injection point;
- constructor injection rule;
- minimal DI API vs CDI full model;
- kenapa Jakarta Inject kecil dan sengaja tidak menjadi full container specification.

---

## 52. Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
```

Belum selesai. Masih lanjut ke Part 007.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 005 — Classloaders, Modules, and Deployment Isolation](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-007.md)
