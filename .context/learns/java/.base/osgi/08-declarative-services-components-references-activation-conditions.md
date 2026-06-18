# Part 8 — Declarative Services Deep Dive: Components, References, Activation, and Conditions

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `08-declarative-services-components-references-activation-conditions.md`  
Target Java: 8 hingga 25  
Level: Advanced / Platform Engineering

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membangun fondasi:

1. OSGi bukan sekadar plugin framework, melainkan dynamic module runtime.
2. Bundle memiliki lifecycle, identity, wiring, classloader, dan metadata kontraktual.
3. Class loading OSGi bersifat eksplisit dan terisolasi per bundle.
4. Dependency model OSGi bekerja di level package/capability, bukan hanya artifact.
5. Resolver bekerja seperti constraint solver.
6. Versioning OSGi harus dipikirkan di level package/API contract.
7. Service registry menyediakan dynamic in-process service model.

Part ini masuk ke salah satu komponen paling penting dalam OSGi modern: **Declarative Services**, sering disingkat **DS**.

Kalau Service Registry adalah “mekanisme publish/discover/bind service”, maka Declarative Services adalah **component model** yang membuat service dynamics bisa digunakan secara aman, eksplisit, testable, dan maintainable.

Tanpa DS, developer biasanya menulis banyak kode manual:

- `BundleActivator`
- `ServiceTracker`
- manual `registerService`
- manual `getService`
- manual `ungetService`
- manual listener
- manual lifecycle state
- manual config update handling

Kode seperti itu cepat berubah menjadi runtime spaghetti.

Dengan DS, kita mendeskripsikan komponen:

- service apa yang disediakan
- service apa yang dibutuhkan
- berapa banyak reference yang dibutuhkan
- apakah reference mandatory/optional
- apakah binding static/dynamic
- apakah component langsung aktif atau lazy
- configuration apa yang dibutuhkan
- bagaimana activation/deactivation berjalan

Lalu Service Component Runtime, atau **SCR**, mengelola lifecycle component berdasarkan deskripsi tersebut.

Mental model penting:

> Declarative Services bukan dependency injection biasa. DS adalah runtime component lifecycle manager yang bereaksi terhadap perubahan service registry dan configuration.

---

## 1. Problem Yang Diselesaikan Declarative Services

### 1.1 Problem Manual OSGi Service Programming

Misalnya kita punya service `PaymentGateway` dan component `InvoiceService` yang membutuhkannya.

Dengan API manual, pola kasarnya seperti ini:

```java
public class InvoiceActivator implements BundleActivator {
    private ServiceTracker<PaymentGateway, PaymentGateway> tracker;
    private ServiceRegistration<InvoiceService> registration;

    @Override
    public void start(BundleContext context) {
        tracker = new ServiceTracker<>(context, PaymentGateway.class, null);
        tracker.open();

        PaymentGateway gateway = tracker.getService();
        if (gateway != null) {
            InvoiceService service = new DefaultInvoiceService(gateway);
            registration = context.registerService(InvoiceService.class, service, null);
        }
    }

    @Override
    public void stop(BundleContext context) {
        if (registration != null) {
            registration.unregister();
        }
        if (tracker != null) {
            tracker.close();
        }
    }
}
```

Masalahnya:

1. Apa yang terjadi jika `PaymentGateway` muncul setelah bundle start?
2. Apa yang terjadi jika `PaymentGateway` hilang saat `InvoiceService` sedang aktif?
3. Apa yang terjadi jika ada implementation baru dengan ranking lebih tinggi?
4. Apa yang terjadi jika config berubah?
5. Apa yang terjadi jika activation gagal?
6. Apa yang terjadi jika unregister dipanggil dua kali?
7. Bagaimana menghindari stale reference?
8. Bagaimana memastikan `ungetService` benar?
9. Bagaimana mencegah service dipublish sebelum dependency siap?

Manual service tracking mungkin cocok untuk runtime primitive atau framework-level code, tetapi untuk business/application component, ia terlalu raw.

### 1.2 Problem Dependency Injection Biasa Di Runtime Dinamis

Dependency injection tradisional seperti Spring/CDI umumnya berpikir seperti ini:

```text
Application starts
  -> container creates beans
  -> inject dependencies
  -> application runs
  -> dependencies assumed stable
  -> application stops
```

OSGi service model tidak sestatis itu.

```text
Framework starts
  -> bundles installed/resolved/started
  -> services appear/disappear
  -> components become satisfied/unsatisfied
  -> configs change
  -> bundles updated/refreshed
  -> services rebound
  -> runtime continues
```

Jadi yang dibutuhkan bukan hanya “inject object”, tetapi:

- track dependency availability
- activate component only when conditions are satisfied
- deactivate component when mandatory dependency disappears
- optionally rebind when better service appears
- handle config change
- publish service only when component is valid
- clean up reliably

Inilah wilayah DS.

---

## 2. Apa Itu Declarative Services?

Declarative Services adalah spesifikasi OSGi Compendium untuk mendeklarasikan component dan dependencies-nya. Runtime yang menjalankan deklarasi tersebut disebut **Service Component Runtime** atau **SCR**.

Sebuah DS component pada dasarnya adalah class Java biasa yang disertai metadata component.

Metadata ini dapat ditulis sebagai XML, tetapi praktik modern biasanya memakai annotation dari package:

```java
org.osgi.service.component.annotations
```

Lalu build tool seperti bnd akan menghasilkan XML descriptor ke dalam bundle, biasanya melalui header:

```text
Service-Component: OSGI-INF/*.xml
```

SCR membaca descriptor itu dan mengelola component.

Inti DS:

```text
Component Description
  -> read by SCR
  -> creates Component Configuration
  -> waits until references/config/conditions are satisfied
  -> activates Component Instance
  -> optionally registers service
  -> tracks dependency changes
  -> modifies/deactivates as needed
```

---

## 3. Vocabulary Penting

### 3.1 Component

Component adalah unit implementasi Java yang dikelola oleh SCR.

Contoh:

```java
@Component
public class DefaultCaseAssignmentService implements CaseAssignmentService {
    @Override
    public AssignmentResult assign(CaseContext context) {
        return AssignmentResult.manualReview();
    }
}
```

Class ini bukan otomatis “service” hanya karena diberi `@Component`. Ia menjadi service jika DS metadata menyatakan service interface yang dipublish. Secara default, annotation modern dapat menginfer service dari implemented interfaces, tetapi dalam sistem besar lebih baik eksplisit.

```java
@Component(service = CaseAssignmentService.class)
public class DefaultCaseAssignmentService implements CaseAssignmentService {
}
```

### 3.2 Component Description

Component description adalah metadata deklaratif tentang component:

- implementation class
- provided service
- references
- activation method
- deactivation method
- modified method
- configuration policy
- properties
- scope
- immediate/delayed behavior

Dalam source code kita menulis annotation. Dalam bundle hasil build, annotation diproses menjadi XML descriptor.

### 3.3 Service Component Runtime / SCR

SCR adalah runtime extender yang:

1. menemukan DS descriptor dalam bundle
2. mendaftarkan component description
3. memantau service registry
4. memantau configuration admin
5. membuat/menghancurkan component instance
6. melakukan bind/unbind dependency
7. register/unregister service yang disediakan component

SCR bukan compile-time dependency injection. SCR adalah runtime manager.

### 3.4 Component Configuration

Component description adalah definisi. Component configuration adalah realisasi runtime dari definisi itu.

Satu component description bisa menghasilkan:

- satu component configuration
- nol component configuration
- banyak component configuration, terutama pada factory component atau factory configuration

### 3.5 Component Instance

Component instance adalah object Java yang benar-benar dibuat oleh SCR.

Lifecycle-nya dikontrol SCR:

```text
construct -> inject references/config -> activate -> use -> modified? -> deactivate -> destroy
```

### 3.6 Satisfied vs Active

Ini sangat penting.

Sebuah component bisa **satisfied** tetapi belum **active**.

- Satisfied: semua mandatory references/config/conditions tersedia.
- Active: component instance sudah dibuat dan activated.

Delayed component yang menyediakan service biasanya tidak langsung dibuat. Ia baru dibuat saat servicenya dibutuhkan.

---

## 4. Component Lifecycle Mental Model

Secara konseptual:

```text
DISABLED
   |
   | enable
   v
UNSATISFIED_REFERENCE / UNSATISFIED_CONFIGURATION / UNSATISFIED_CONDITION
   |
   | required references/config/conditions available
   v
SATISFIED
   |
   | activate trigger
   v
ACTIVE
   |
   | config modified / reference changes
   v
ACTIVE with rebound/modified state
   |
   | mandatory dependency removed / disabled / bundle stopping
   v
DEACTIVATED
```

Dalam DS, banyak transisi dikendalikan oleh SCR.

Developer sebaiknya tidak menganggap constructor adalah tempat component “siap”. Constructor hanya membuat object. Component baru siap setelah activate berhasil.

---

## 5. Component Types: Immediate, Delayed, Factory

### 5.1 Immediate Component

Immediate component diaktifkan segera setelah satisfied.

```java
@Component(immediate = true)
public class StartupAuditComponent {
    @Activate
    void activate() {
        System.out.println("Audit component active");
    }
}
```

Cocok untuk:

- background worker
- scheduler initializer
- event listener yang harus aktif segera
- bridge/subscriber
- component yang tidak hanya dipakai sebagai service callable

Risiko:

- memperlambat startup
- activation melakukan IO berat
- urutan activation tidak dipahami
- component aktif terlalu dini sebelum system readiness

Rule of thumb:

> Gunakan `immediate = true` hanya jika component memang harus menjalankan behavior ketika runtime hidup, bukan hanya saat servicenya dipakai.

### 5.2 Delayed Component

Delayed component menyediakan service, tetapi instancenya dapat ditunda sampai service dipakai.

```java
@Component(service = CaseScoringService.class)
public class DefaultCaseScoringService implements CaseScoringService {
}
```

Cocok untuk stateless service biasa.

Keuntungan:

- startup lebih cepat
- component tidak dibuat jika tidak digunakan
- service tersedia sebagai registration proxy/placeholder sebelum instance dibuat

Catatan penting:

Delayed bukan berarti dependency tidak dicek. Component tetap harus satisfied sebelum service tersedia.

### 5.3 Factory Component

Factory component digunakan saat ingin membuat banyak instance component berdasarkan konfigurasi atau request factory.

Contoh use case:

- banyak connector external agency dengan config berbeda
- banyak tenant-specific policy engine
- banyak SMTP profile
- banyak routing rule instance

Biasanya dipakai bersama factory PID di Configuration Admin.

---

## 6. Basic Declarative Services Annotation

### 6.1 Minimal Component

```java
import org.osgi.service.component.annotations.Component;

@Component(service = GreetingService.class)
public class DefaultGreetingService implements GreetingService {
    @Override
    public String greet(String name) {
        return "Hello " + name;
    }
}
```

Interface:

```java
public interface GreetingService {
    String greet(String name);
}
```

Pada build, bnd menghasilkan descriptor kira-kira seperti:

```xml
<component name="com.example.DefaultGreetingService">
  <implementation class="com.example.DefaultGreetingService"/>
  <service>
    <provide interface="com.example.GreetingService"/>
  </service>
</component>
```

Bundle manifest mengandung:

```text
Service-Component: OSGI-INF/com.example.DefaultGreetingService.xml
```

### 6.2 Explicit Service Lebih Baik

Hindari terlalu mengandalkan inference di sistem besar.

Kurang eksplisit:

```java
@Component
public class DefaultGreetingService implements GreetingService {
}
```

Lebih eksplisit:

```java
@Component(service = GreetingService.class)
public class DefaultGreetingService implements GreetingService {
}
```

Alasannya:

- lebih jelas API yang dipublish
- tidak tidak sengaja expose interface internal
- refactoring lebih aman
- review arsitektur lebih mudah

### 6.3 Component Tanpa Service

Tidak semua component harus publish service.

```java
@Component(service = {}, immediate = true)
public class MetricsBootstrapper {
    @Activate
    void activate() {
        // start metrics bridge
    }
}
```

`service = {}` berarti component tidak menyediakan service.

Cocok untuk:

- bootstrapper
- event subscriber
- scheduled job
- runtime bridge

Tetapi hati-hati: component seperti ini biasanya harus `immediate = true`, karena tidak ada service demand yang akan memicu delayed activation.

---

## 7. Activation and Deactivation

### 7.1 `@Activate`

`@Activate` dipanggil setelah component instance dibuat dan dependencies/configuration yang dibutuhkan sudah siap.

```java
@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {

    @Activate
    void activate() {
        // initialize component state
    }
}
```

`@Activate` bisa menerima parameter tertentu, misalnya:

```java
@Activate
void activate(ComponentContext context) {
}
```

Atau bundle context:

```java
@Activate
void activate(BundleContext bundleContext) {
}
```

Atau config typed object jika menggunakan component property type/metatype pattern.

### 7.2 Constructor Injection with Activation Object

DS modern mendukung constructor injection untuk references/config tertentu tergantung versi DS dan annotation usage.

Contoh konseptual:

```java
@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {
    private final CaseRepository repository;

    @Activate
    public DefaultCaseService(@Reference CaseRepository repository) {
        this.repository = repository;
    }
}
```

Kelebihan:

- dependency mandatory menjadi immutable
- lebih mudah diuji
- object tidak pernah berada dalam state setengah jadi

Kekurangan:

- kurang fleksibel untuk dynamic references
- tidak cocok untuk multiple/dynamic bind/unbind list
- perlu paham DS version support dan build tooling

### 7.3 `@Deactivate`

`@Deactivate` dipanggil saat component dinonaktifkan.

```java
@Deactivate
void deactivate() {
    // cleanup resources
}
```

Harus digunakan untuk:

- close executor
- stop scheduler
- unregister listener non-OSGi
- close file handle
- flush buffer
- stop background thread
- release external resource

`@Deactivate` harus idempotent secara desain.

Jangan mengasumsikan deactivate hanya dipanggil saat application shutdown. Ia juga bisa terjadi karena:

- mandatory reference hilang
- config hilang/invalid
- component disabled
- bundle stopped
- bundle updated
- framework refresh

### 7.4 `@Modified`

`@Modified` dipanggil saat configuration berubah dan component dapat menerima perubahan tanpa full deactivate/activate.

```java
@Modified
void modified(MyConfig config) {
    this.timeout = Duration.ofMillis(config.timeoutMillis());
}
```

Tantangan:

- update harus thread-safe
- state baru tidak boleh separuh teraplikasi
- long-running operation tidak boleh melihat config inconsistent

Pattern aman:

```java
private volatile RuntimeSettings settings;

@Activate
void activate(MyConfig config) {
    this.settings = RuntimeSettings.from(config);
}

@Modified
void modified(MyConfig config) {
    this.settings = RuntimeSettings.from(config);
}
```

Dengan immutable settings object, pembaca selalu melihat snapshot valid.

---

## 8. Reference Fundamentals

### 8.1 Mandatory Unary Reference

```java
@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {

    private CaseRepository repository;

    @Reference
    void bindRepository(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Secara default, reference biasanya:

```text
cardinality = 1..1
policy = static
policyOption = reluctant
```

Artinya:

- component butuh tepat satu `CaseRepository`
- component tidak satisfied jika repository tidak tersedia
- jika repository hilang, component perlu deactivate/rebind
- jika service baru yang lebih baik muncul, tidak otomatis pindah kecuali kondisi policy option mendorongnya

### 8.2 Field Injection

```java
@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {

    @Reference
    private CaseRepository repository;
}
```

Kelebihan:

- ringkas
- mudah dibaca untuk simple component

Kekurangan:

- field mutation dikelola runtime
- test perlu reflection atau framework
- dynamic field perlu attention terhadap thread-safety

### 8.3 Constructor Injection

```java
@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {
    private final CaseRepository repository;

    @Activate
    public DefaultCaseService(@Reference CaseRepository repository) {
        this.repository = repository;
    }
}
```

Kelebihan:

- dependency mandatory immutable
- class mudah diuji dengan plain unit test
- object selalu valid setelah construct

Kekurangan:

- cocok terutama untuk static mandatory dependency
- dynamic service replacement butuh pattern lain

### 8.4 Method Injection / Bind-Unbind

```java
private volatile CaseRepository repository;

@Reference
void setRepository(CaseRepository repository) {
    this.repository = repository;
}

void unsetRepository(CaseRepository repository) {
    if (this.repository == repository) {
        this.repository = null;
    }
}
```

Method injection berguna ketika perlu custom logic saat bind/unbind.

Tapi hati-hati: bind/unbind bukan tempat menjalankan business operation berat.

---

## 9. Cardinality

Cardinality menjawab: **berapa banyak service yang dibutuhkan?**

### 9.1 `1..1` Mandatory Unary

Butuh tepat satu service.

```java
@Reference(cardinality = ReferenceCardinality.MANDATORY)
private CaseRepository repository;
```

Atau default.

Cocok untuk dependency inti:

- repository
- transaction manager
- serializer wajib
- policy engine utama

Konsekuensi:

- component tidak aktif jika dependency tidak ada
- hilangnya dependency menyebabkan deactivation untuk static policy

### 9.2 `0..1` Optional Unary

```java
@Reference(cardinality = ReferenceCardinality.OPTIONAL)
private volatile AuditSink auditSink;
```

Cocok untuk optional capability:

- metrics sink
- optional audit sink
- optional external enrichment
- optional cache

Konsekuensi:

- component bisa aktif tanpa service
- kode harus siap `null`
- atau gunakan Optional-like pattern secara internal

Contoh aman:

```java
public void process(CaseCommand command) {
    AuditSink sink = this.auditSink;
    if (sink != null) {
        sink.record(command);
    }
    // continue main flow
}
```

### 9.3 `0..n` Multiple Optional

```java
@Reference(cardinality = ReferenceCardinality.MULTIPLE)
private volatile List<CaseRule> rules;
```

Cocok untuk plugin list:

- validators
- enrichers
- renderers
- notification channels
- event handlers

Pertanyaan desain:

- apakah urutan penting?
- apakah semua plugin harus berhasil?
- apakah plugin boleh menolak command?
- apakah plugin error mengganggu whole flow?
- apakah plugin list snapshot konsisten saat request berjalan?

### 9.4 `1..n` Multiple Mandatory

```java
@Reference(cardinality = ReferenceCardinality.AT_LEAST_ONE)
private volatile List<CaseRule> rules;
```

Cocok jika component tidak boleh aktif tanpa minimal satu implementation.

Contoh:

- harus ada minimal satu `AuthenticationProvider`
- harus ada minimal satu `CaseAssignmentStrategy`
- harus ada minimal satu `ReportRenderer`

Konsekuensi:

- jika semua provider hilang, component deactivate
- operationally perlu memastikan provider baseline selalu ada

---

## 10. Reference Policy: Static vs Dynamic

Reference policy menjawab: **apa yang dilakukan SCR saat bound service berubah?**

### 10.1 Static Policy

Static policy berarti dependency dipilih saat activation. Jika dependency harus berubah, component biasanya deactivate lalu activate ulang.

Cocok untuk:

- dependency fundamental
- dependency yang tidak aman diganti saat runtime
- repository / transaction manager
- configuration-heavy client
- component yang stateful

Keuntungan:

- state lebih stabil
- concurrency lebih mudah
- tidak perlu handle dependency berubah saat method berjalan

Kerugian:

- service replacement menyebabkan lifecycle churn
- update dependency bisa menyebabkan downtime component sementara

### 10.2 Dynamic Policy

Dynamic policy memungkinkan SCR bind/unbind/rebind saat component masih aktif.

Cocok untuk:

- optional dependency
- list plugin
- metrics/audit/log sink
- dynamic routing
- rule registry

Contoh:

```java
@Reference(
    cardinality = ReferenceCardinality.MULTIPLE,
    policy = ReferencePolicy.DYNAMIC
)
private volatile List<CaseRule> rules;
```

Tantangan:

- reference bisa berubah saat method berjalan
- collection harus dipakai sebagai snapshot
- object harus thread-safe
- unbind bisa terjadi kapan saja

Pattern:

```java
public ValidationResult validate(CaseData data) {
    List<CaseRule> snapshot = this.rules;
    for (CaseRule rule : snapshot) {
        rule.validate(data);
    }
    return ValidationResult.ok();
}
```

Jangan iterate field mutable yang bisa berubah tanpa snapshot.

---

## 11. Reference Policy Option: Reluctant vs Greedy

Policy option menjawab: **jika ada service baru yang lebih baik, apakah component harus pindah?**

### 11.1 Reluctant

Reluctant adalah conservative default.

Artinya component tetap memakai service yang sudah bound selama masih valid.

Cocok untuk:

- stabilitas runtime
- dependency stateful
- menghindari churn
- long-lived service

### 11.2 Greedy

Greedy berarti component cenderung rebind ke service yang lebih baik, misalnya ranking lebih tinggi.

Cocok untuk:

- override service
- plugin precedence
- hot replacement
- dynamic policy engine
- failover provider

Contoh:

```java
@Reference(
    policy = ReferencePolicy.DYNAMIC,
    policyOption = ReferencePolicyOption.GREEDY
)
private volatile NotificationSender sender;
```

Risiko:

- rebind terlalu sering
- service ranking berubah menyebabkan churn
- request bisa melihat provider berbeda antar call
- observability harus jelas provider mana yang aktif

Rule:

> Gunakan greedy jika replacement adalah fitur eksplisit, bukan kebetulan.

---

## 12. Reference Target Filter

Reference bisa dipersempit dengan LDAP filter.

```java
@Reference(target = "(channel=email)")
private NotificationSender emailSender;
```

Service provider:

```java
@Component(
    service = NotificationSender.class,
    property = {
        "channel=email",
        "region=sg"
    }
)
public class EmailNotificationSender implements NotificationSender {
}
```

Filter bisa lebih kompleks:

```java
@Reference(target = "(&(channel=email)(region=sg))")
private NotificationSender sender;
```

Gunakan target filter untuk:

- memilih provider berdasarkan capability
- multi-tenant routing
- environment-specific adapter
- protocol-specific implementation

Hindari filter string yang tersebar tanpa constant atau typed metadata.

Lebih baik buat constants:

```java
public final class NotificationServiceProperties {
    public static final String CHANNEL = "channel";
    public static final String REGION = "region";

    private NotificationServiceProperties() {}
}
```

---

## 13. Service Ranking Dalam DS

Jika ada banyak service dengan interface sama, SCR memilih berdasarkan OSGi service ordering.

Umumnya:

1. `service.ranking` lebih tinggi menang
2. jika ranking sama, service id lebih rendah biasanya lebih dulu

Provider:

```java
@Component(
    service = CaseAssignmentStrategy.class,
    property = "service.ranking:Integer=100"
)
public class PriorityCaseAssignmentStrategy implements CaseAssignmentStrategy {
}
```

Use case:

- default implementation ranking 0
- custom override ranking 100
- emergency fallback ranking -100

Hati-hati:

- ranking adalah runtime selection policy, bukan authorization policy
- ranking yang tidak terdokumentasi membuat behavior unpredictable
- plugin platform perlu governance ranking range

Contoh governance:

```text
-1000..-1    fallback/internal default
0            standard default
1..999       product extension
1000..1999   customer/tenant override
9000+        emergency/manual override only
```

---

## 14. Component Scope and Service Scope

DS component scope menentukan bagaimana instance component dikaitkan dengan service consumer.

### 14.1 Singleton Scope

Satu component instance untuk semua consumer.

Cocok untuk:

- stateless service
- shared manager
- registry
- connector pool

Risiko:

- shared mutable state
- concurrency bug

### 14.2 Bundle Scope

Satu service object per consuming bundle.

Cocok jika setiap consumer bundle butuh view/adapter sendiri.

### 14.3 Prototype Scope

Setiap request service bisa mendapatkan instance berbeda.

Cocok untuk:

- stateful session-like service
- builder/processor object
- per-consumer mutable state

Namun prototype scope lebih kompleks secara lifecycle. Jangan gunakan hanya karena ingin “lebih aman”; sering kali stateless singleton + explicit context object lebih sederhana.

---

## 15. Configuration Policy

Component bisa bergantung pada configuration.

### 15.1 Optional Configuration

Component aktif walaupun config tidak ada.

Cocok jika ada default aman.

```java
@Component(configurationPolicy = ConfigurationPolicy.OPTIONAL)
public class RetryPolicyService {
}
```

### 15.2 Require Configuration

Component hanya aktif jika config tersedia.

```java
@Component(configurationPolicy = ConfigurationPolicy.REQUIRE)
public class ExternalAgencyConnector {
}
```

Cocok untuk:

- external connector butuh base URL/token/config
- scheduled job butuh cron expression
- SMTP sender butuh host/port
- tenant-specific runtime

Manfaat:

- component tidak publish service dalam state invalid
- failure lebih eksplisit
- operational config menjadi readiness gate

### 15.3 Ignore Configuration

Component mengabaikan config admin.

Jarang dipakai secara eksplisit kecuali ingin memastikan component tidak terpengaruh config.

---

## 16. Typed Configuration Pattern

Gunakan typed config agar tidak menabur string key di mana-mana.

```java
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;

@ObjectClassDefinition(
    name = "Case Escalation Configuration",
    description = "Controls escalation timing and threshold."
)
public @interface CaseEscalationConfig {

    @AttributeDefinition(name = "Escalation threshold")
    int threshold() default 80;

    @AttributeDefinition(name = "Timeout milliseconds")
    long timeoutMillis() default 3000;
}
```

Component:

```java
@Component(
    service = CaseEscalationService.class,
    configurationPolicy = ConfigurationPolicy.REQUIRE
)
@Designate(ocd = CaseEscalationConfig.class)
public class DefaultCaseEscalationService implements CaseEscalationService {

    private volatile RuntimeSettings settings;

    @Activate
    void activate(CaseEscalationConfig config) {
        this.settings = RuntimeSettings.from(config);
    }

    @Modified
    void modified(CaseEscalationConfig config) {
        this.settings = RuntimeSettings.from(config);
    }
}
```

Pattern penting:

- config interface adalah schema
- runtime settings adalah validated immutable object
- component logic membaca `volatile` snapshot

---

## 17. Component Properties

Component bisa mendaftarkan service properties.

```java
@Component(
    service = ReportRenderer.class,
    property = {
        "format=pdf",
        "priority:Integer=100"
    }
)
public class PdfReportRenderer implements ReportRenderer {
}
```

Properties berguna untuk:

- filtering reference
- metadata discovery
- whiteboard registration
- routing
- capability classification

Jangan menaruh data besar atau mutable state sebagai service property.

Service property sebaiknya:

- kecil
- immutable secara konsep
- serializable/simple type
- documented
- stable

---

## 18. Immediate vs Delayed Revisited: Operational Meaning

Salah satu kesalahan umum adalah mengira `ACTIVE` bundle berarti semua DS component aktif.

Tidak benar.

Bundle bisa `ACTIVE`, tetapi component delayed belum instantiated.

```text
Bundle ACTIVE
  DS descriptors registered
  Component descriptions known
  Some components satisfied
  Some delayed services registered
  Some instances not created yet
```

Operational impact:

- readiness check tidak boleh hanya mengecek bundle state
- harus cek DS component state/service availability
- delayed component failure mungkin muncul saat first use
- integration test harus memicu service usage, bukan hanya runtime startup

---

## 19. Conditions and Satisfying Conditions

OSGi DS modern memiliki konsep condition yang dapat mempengaruhi kepuasan component.

Secara mental:

```text
Component can activate only if:
  mandatory references satisfied
  required configuration available
  required conditions satisfied
```

Condition berguna untuk gating runtime readiness.

Contoh konsep:

- component hanya aktif setelah database migration selesai
- connector hanya aktif setelah secrets loaded
- worker hanya aktif setelah cluster leadership acquired
- module hanya aktif setelah license/capability enabled

Daripada component aktif lalu gagal saat dipakai, condition membuat activation menjadi explicit.

Pattern:

```text
MigrationCompletedCondition service appears
  -> dependent components become satisfied
  -> SCR activates them
```

Ini lebih bersih daripada setiap component melakukan polling sendiri.

---

## 20. DS and Lifecycle Safety

### 20.1 Jangan Publish Service Sebelum Siap

Dengan manual service registry, mudah sekali mendaftarkan service terlalu awal.

Dengan DS, jika component menyediakan service, SCR mendaftarkannya setelah component satisfied dan activation berhasil.

Ini invariant penting.

```text
No activation success -> no valid service exposure
```

### 20.2 Activation Harus Cepat

`@Activate` bukan tempat ideal untuk proses berat.

Hindari:

- full table scan
- network call panjang
- blocking remote dependency
- migration besar
- cache warming tak terbatas
- synchronous external health check lambat

Jika butuh background startup:

1. activate cepat
2. start internal worker secara controlled
3. expose readiness state eksplisit
4. jangan klaim service siap jika belum siap

### 20.3 Deactivation Harus Bersih

`@Deactivate` harus:

- menghentikan worker
- menghentikan menerima work baru
- drain atau cancel work berjalan
- release resource
- aman dipanggil saat dependency sedang hilang

Pattern:

```java
private final AtomicBoolean running = new AtomicBoolean();
private ExecutorService executor;

@Activate
void activate() {
    this.executor = Executors.newSingleThreadExecutor();
    running.set(true);
}

@Deactivate
void deactivate() {
    running.set(false);
    ExecutorService ex = this.executor;
    if (ex != null) {
        ex.shutdownNow();
    }
}
```

Pada Java 21+, virtual threads bisa membantu model concurrency, tetapi lifecycle shutdown tetap harus explicit.

---

## 21. Dynamic Reference Safety Patterns

### 21.1 Volatile Unary Reference

Untuk optional dynamic reference:

```java
@Reference(
    cardinality = ReferenceCardinality.OPTIONAL,
    policy = ReferencePolicy.DYNAMIC
)
private volatile AuditSink auditSink;
```

Use:

```java
AuditSink sink = auditSink;
if (sink != null) {
    sink.record(event);
}
```

Kenapa snapshot lokal?

Karena field bisa berubah antara null-check dan method call.

### 21.2 Immutable Snapshot List

Untuk multiple dynamic reference:

```java
@Reference(
    cardinality = ReferenceCardinality.MULTIPLE,
    policy = ReferencePolicy.DYNAMIC
)
private volatile List<CaseRule> rules = List.of();
```

Use:

```java
List<CaseRule> snapshot = rules;
for (CaseRule rule : snapshot) {
    rule.apply(context);
}
```

Pastikan collection yang diberikan SCR aman sesuai DS semantics/tooling. Jika custom bind/unbind method dipakai, gunakan copy-on-write.

### 21.3 Copy-On-Write Manual Binding

```java
private final AtomicReference<List<CaseRule>> rules =
    new AtomicReference<>(List.of());

@Reference(
    cardinality = ReferenceCardinality.MULTIPLE,
    policy = ReferencePolicy.DYNAMIC
)
void bindRule(CaseRule rule) {
    rules.updateAndGet(old -> {
        List<CaseRule> next = new ArrayList<>(old);
        next.add(rule);
        return List.copyOf(next);
    });
}

void unbindRule(CaseRule rule) {
    rules.updateAndGet(old -> {
        List<CaseRule> next = new ArrayList<>(old);
        next.remove(rule);
        return List.copyOf(next);
    });
}
```

Kelebihan:

- pembaca selalu melihat immutable snapshot
- update atomic
- tidak ada ConcurrentModificationException

Kekurangan:

- overhead jika churn sangat tinggi

Untuk registry plugin yang jarang berubah, ini sangat aman.

---

## 22. Avoiding Circular Dependencies

Circular DS reference sering terjadi:

```text
A requires B
B requires C
C requires A
```

Atau lebih halus:

```text
CaseService requires RuleRegistry
RuleRegistry requires CaseMetadataProvider
CaseMetadataProvider requires CaseService
```

Gejala:

- component unsatisfied
- activation deadlock-like behavior
- service never appears
- developer menambahkan optional reference untuk “memperbaiki” tapi menciptakan null runtime bug

Cara menyelesaikan:

1. Pisahkan API dari implementation.
2. Extract lower-level service.
3. Gunakan event untuk arah dependency yang tidak perlu synchronous.
4. Gunakan provider pattern.
5. Hindari component high-level dipakai dependency low-level.
6. Hindari domain service saling memanggil tanpa orchestration boundary.

Jika dependency cyclic secara domain, biasanya boundary desainnya salah.

---

## 23. DS vs BundleActivator

Gunakan `BundleActivator` untuk:

- framework-level bootstrap sangat rendah
- integrasi library yang benar-benar butuh bundle lifecycle raw
- custom extender/hook
- eksperimen/debug

Gunakan DS untuk hampir semua application component:

- service provider
- service consumer
- worker
- listener
- connector
- registry
- web whiteboard component
- event handler

`BundleActivator` sering memberi ilusi kontrol, tetapi meningkatkan lifecycle bug.

DS memberi lifecycle declarative dan observable.

---

## 24. DS vs Spring/CDI Dependency Injection

DS bukan “Spring versi OSGi”.

Perbandingan mental:

| Aspek | Spring/CDI umum | OSGi DS |
|---|---|---|
| Runtime | application context | dynamic service registry |
| Dependency | mostly stable beans | services can appear/disappear |
| Lifecycle | startup/shutdown centric | continuous activation/deactivation |
| Selection | bean qualifier/profile | service property/ranking/filter |
| Module boundary | classpath/modulepath | bundle wiring/classloader |
| Config | environment/properties | Config Admin integration |
| Deployment | whole app usually | bundles/features can update |

DS lebih kecil, eksplisit, dan service-registry-native.

Spring/CDI lebih kaya untuk application programming model, tetapi jika dipakai di OSGi harus hati-hati terhadap dual lifecycle.

---

## 25. DS Metadata Generation With bnd

Biasanya source annotation diproses oleh bnd.

Contoh `bnd.bnd`:

```properties
Bundle-SymbolicName: com.example.case.service
Bundle-Version: 1.0.0
Export-Package: com.example.case.api;version=1.0.0
Private-Package: com.example.case.internal.*
```

Jika ada annotation DS, bnd akan menghasilkan:

```text
Service-Component: OSGI-INF/com.example.case.internal.DefaultCaseService.xml
```

Hal yang harus dicek:

- apakah XML descriptor masuk bundle?
- apakah `Service-Component` header ada?
- apakah package `org.osgi.service.component.annotations` hanya compile-time?
- apakah SCR runtime bundle tersedia?
- apakah component package tidak keliru diexport?

Annotation package biasanya tidak dibutuhkan runtime karena retention-nya untuk processing metadata, bukan reflection runtime biasa.

---

## 26. Common DS Failure Modes

### 26.1 Component Tidak Muncul

Kemungkinan:

- tidak ada `Service-Component` header
- DS annotations tidak diproses build
- SCR bundle tidak installed/active
- XML descriptor path salah
- bundle belum resolved

Diagnosis:

```text
bundle headers <id>
scr:list
scr:info <component>
```

Command tergantung runtime, misalnya Felix/Karaf/Equinox.

### 26.2 Component Unsatisfied

Kemungkinan:

- mandatory reference tidak ada
- target filter terlalu ketat
- service interface class berbeda karena classloader/package version
- config required tidak ada
- condition tidak satisfied

Diagnosis:

- lihat unsatisfied reference name
- cek service registry untuk interface terkait
- cek property service
- cek package wiring API interface

### 26.3 Component Satisfied Tapi Tidak Active

Kemungkinan:

- delayed component belum digunakan
- service belum diminta
- component bukan immediate

Ini bukan selalu bug.

### 26.4 Activation Gagal

Kemungkinan:

- exception di constructor
- exception di `@Activate`
- config invalid
- dependency method call gagal
- missing resource
- classloading issue saat lazy load

Rule:

> Exception di activation harus dianggap startup/runtime lifecycle failure, bukan business exception biasa.

### 26.5 Dynamic Reference Race

Gejala:

- intermittent NPE
- ConcurrentModificationException
- provider berubah saat request
- stale provider dipakai setelah unbind

Solusi:

- volatile snapshot
- immutable collection
- static policy untuk dependency critical
- drain strategy untuk service replacement

### 26.6 Config Modified Tidak Thread-Safe

Gejala:

- sebagian field config lama, sebagian baru
- timeout berubah tapi endpoint belum berubah
- validation inconsistent

Solusi:

- immutable settings object
- single volatile assignment
- validate before publish

---

## 27. Case Study: Dynamic Case Validation Platform

Kita ingin membuat platform validation rule untuk case management.

Requirement:

1. Core case service dapat memvalidasi case sebelum submit.
2. Rule bisa ditambah/hapus sebagai bundle plugin.
3. Rule punya priority/order.
4. Rule bisa difilter berdasarkan module.
5. Core service tetap aktif walau tidak ada optional enrichment rule.
6. Minimal satu critical validation rule harus tersedia untuk submit.

### 27.1 API Bundle

```java
package com.example.casevalidation.api;

public interface CaseValidationRule {
    ValidationResult validate(CaseDraft draft);
}
```

Service property constants:

```java
public final class CaseValidationRuleProperties {
    public static final String MODULE = "case.module";
    public static final String PHASE = "case.phase";
    public static final String ORDER = "case.order";

    private CaseValidationRuleProperties() {}
}
```

### 27.2 Rule Provider Bundle

```java
@Component(
    service = CaseValidationRule.class,
    property = {
        "case.module=appeal",
        "case.phase=submit",
        "case.order:Integer=100"
    }
)
public class AppealMandatoryFieldRule implements CaseValidationRule {
    @Override
    public ValidationResult validate(CaseDraft draft) {
        if (draft.subject() == null || draft.subject().isBlank()) {
            return ValidationResult.error("Subject is mandatory");
        }
        return ValidationResult.ok();
    }
}
```

### 27.3 Registry Component

```java
@Component(service = CaseValidationService.class)
public class DefaultCaseValidationService implements CaseValidationService {

    private final AtomicReference<List<RuleEntry>> rules =
        new AtomicReference<>(List.of());

    @Reference(
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindRule(CaseValidationRule rule, Map<String, Object> props) {
        RuleEntry entry = RuleEntry.from(rule, props);
        rules.updateAndGet(old -> {
            List<RuleEntry> next = new ArrayList<>(old);
            next.add(entry);
            next.sort(Comparator.comparingInt(RuleEntry::order));
            return List.copyOf(next);
        });
    }

    void unbindRule(CaseValidationRule rule) {
        rules.updateAndGet(old -> old.stream()
            .filter(entry -> entry.rule() != rule)
            .toList());
    }

    @Override
    public ValidationResult validate(String module, String phase, CaseDraft draft) {
        List<RuleEntry> snapshot = rules.get();
        for (RuleEntry entry : snapshot) {
            if (entry.matches(module, phase)) {
                ValidationResult result = entry.rule().validate(draft);
                if (!result.isOk()) {
                    return result;
                }
            }
        }
        return ValidationResult.ok();
    }
}
```

### 27.4 Design Reasoning

Kenapa dynamic multiple reference?

Karena rule plugin dapat muncul/hilang saat runtime.

Kenapa copy-on-write?

Karena validation request harus melihat snapshot konsisten.

Kenapa service property?

Karena module/phase/order adalah metadata provider, bukan hardcoded dependency.

Kenapa API bundle terpisah?

Karena provider dan consumer harus wire ke API package yang sama.

Kenapa tidak pakai static list injected sekali?

Karena plugin dynamics adalah requirement eksplisit.

---

## 28. Java 8 Hingga 25 Considerations

### 28.1 Java 8

Pada Java 8:

- OSGi berjalan di classpath world
- javax packages masih sering tersedia di ecosystem
- reflection lebih longgar
- DS annotation processing tetap build-time

Hati-hati dengan:

- old SCR version
- old bnd plugin
- old annotation package
- old generics support

### 28.2 Java 9+

JPMS memperkenalkan strong encapsulation, walau banyak OSGi runtime tetap menjalankan bundles di classpath/unnamed module area.

Perhatikan:

- reflective access library
- annotation scanning library
- proxy/bytecode generation
- `--add-opens` jika library lama butuh akses JDK internal

DS sendiri tetap berbasis OSGi metadata, bukan JPMS service binding.

### 28.3 Java 17/21/25

Pada Java modern:

- pastikan SCR/Felix/Equinox/Karaf version kompatibel
- gunakan bnd versi modern
- hindari old bytecode libraries
- virtual threads dapat digunakan dalam component, tetapi lifecycle shutdown tetap harus controlled
- structured concurrency preview/finalization status harus diperlakukan hati-hati untuk library API public

Jangan membuat DS component bergantung pada preview API jika bundle harus compatible across Java 17/21/25.

---

## 29. Design Checklist Untuk DS Component

Sebelum merge component baru, tanyakan:

1. Apakah component ini perlu publish service?
2. Interface service berada di API package yang benar?
3. Apakah implementation package private?
4. Apakah references mandatory/optional sudah tepat?
5. Apakah policy static/dynamic sudah sesuai semantics?
6. Apakah greedy benar-benar dibutuhkan?
7. Apakah target filter terdokumentasi?
8. Apakah service properties punya constants/schema?
9. Apakah activation cepat dan side effect terkendali?
10. Apakah deactivation membersihkan resource?
11. Apakah config required/optional sudah benar?
12. Apakah config update thread-safe?
13. Apakah dynamic reference dibaca via snapshot?
14. Apakah circular dependency sudah dicek?
15. Apakah component state observable via SCR command?
16. Apakah test mencakup service hilang/muncul?
17. Apakah first-use delayed activation sudah diuji?
18. Apakah failure activation menghasilkan log yang actionable?

---

## 30. Anti-Patterns

### 30.1 Semua Component `immediate = true`

Ini membuat startup berat dan menghilangkan manfaat delayed service.

### 30.2 Semua Reference Optional

Biasanya dilakukan untuk “menghindari unsatisfied component”. Akibatnya bug pindah dari startup ke runtime NPE atau degraded behavior diam-diam.

### 30.3 Dynamic Untuk Semua Dependency

Dynamic reference bukan selalu lebih advanced. Untuk dependency critical, static sering lebih aman.

### 30.4 Greedy Tanpa Governance

Greedy + ranking tanpa governance bisa membuat runtime behavior berubah hanya karena bundle baru muncul.

### 30.5 Activation Melakukan Business Flow

`@Activate` bukan tempat menjalankan proses bisnis besar.

### 30.6 Service Interface Terlalu Besar

Service besar membuat provider sulit diganti dan consumer terlalu tergantung.

### 30.7 Component Menyimpan ServiceReference Mentah Tanpa Alasan

Dalam DS, biasanya tidak perlu memegang `ServiceReference` kecuali butuh metadata detail. Bahkan saat butuh metadata, method parameter properties sering cukup.

### 30.8 Tidak Menangani Deactivation

Component yang membuka thread/socket/resource tanpa cleanup akan leak saat bundle update/refresh.

---

## 31. Troubleshooting Playbook

### 31.1 Bundle Active Tapi Service Tidak Ada

Cek:

1. Apakah DS runtime active?
2. Apakah `Service-Component` header ada?
3. Apakah component unsatisfied?
4. Apakah component delayed dan belum requested?
5. Apakah provided service interface benar?

### 31.2 Component Unsatisfied Karena Reference

Cek:

1. interface reference tersedia sebagai service?
2. provider service property cocok target filter?
3. provider component active?
4. API package provider/consumer wire ke package yang sama?
5. version range import cocok?

### 31.3 Component Activation Error

Cek:

1. log SCR
2. exception stacktrace
3. config value
4. classloading exception nested
5. external dependency call di activate

### 31.4 Service Replacement Tidak Terjadi

Cek:

1. policy dynamic atau static?
2. policy option greedy atau reluctant?
3. service ranking provider baru lebih tinggi?
4. target filter match?
5. cardinality unary atau multiple?

### 31.5 Component Deactivate Saat Service Hilang

Mungkin normal jika mandatory static reference hilang.

Pertanyaan:

- apakah dependency seharusnya optional?
- apakah component seharusnya degrade gracefully?
- apakah provider service flapping?
- apakah update deployment menyebabkan refresh terlalu luas?

---

## 32. Mental Model Akhir

Declarative Services adalah cara OSGi modern menyatakan:

```text
Component ini valid jika kondisi berikut terpenuhi.
Jika valid, aktifkan.
Jika aktif, publish service ini.
Jika dependency berubah, lakukan policy berikut.
Jika config berubah, modify atau recreate.
Jika tidak valid lagi, deactivate dan tarik service dari registry.
```

Dengan DS, desain service bukan hanya tentang method signature, tetapi juga tentang **availability contract**.

Top-tier OSGi engineer selalu berpikir:

- kapan component boleh aktif?
- kapan service boleh terlihat consumer?
- apa yang terjadi saat dependency hilang?
- apakah replacement aman saat request berjalan?
- apakah config update atomic?
- apakah lifecycle cleanup lengkap?
- apakah failure muncul di startup, first use, atau random runtime?

---

## 33. Ringkasan

Declarative Services membantu mengubah OSGi dari API service registry mentah menjadi component model yang lebih aman.

Konsep inti:

- SCR mengelola component berdasarkan descriptor.
- Component bisa unsatisfied, satisfied, active, atau deactivated.
- `@Component` mendeklarasikan service dan lifecycle behavior.
- `@Reference` mendeklarasikan dependency dengan cardinality, policy, policy option, target filter, dan scope.
- `@Activate`, `@Modified`, dan `@Deactivate` adalah lifecycle hook.
- Static reference cocok untuk dependency stabil dan critical.
- Dynamic reference cocok untuk optional/multiple/plugin-like dependency.
- Greedy harus digunakan dengan sengaja.
- Configuration Admin dan Metatype membuat runtime config menjadi bagian dari lifecycle contract.
- Component readiness tidak sama dengan bundle `ACTIVE`.
- DS membuat dynamic runtime lebih bisa dipahami, diuji, dan dioperasikan.

---

## 34. Apa Yang Selanjutnya

Part berikutnya akan masuk ke **Advanced Declarative Services Patterns**.

Kita akan membahas:

- whiteboard pattern
- adapter pattern
- extender-inspired component composition
- ordered service chain
- dynamic plugin registry
- strategy service pattern
- degraded service pattern
- quarantine pattern
- atomic service snapshot
- safe dynamic replacement
- real-world platform patterns untuk workflow/rule/connector systems

Part 8 selesai. Series belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 7 — Service Layer Fundamentals: Registry, References, Dynamics, and Contracts](./07-service-layer-fundamentals-registry-references-dynamics-contracts.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 9 — Advanced Declarative Services Patterns: Dynamic Topologies Without Chaos](./09-advanced-declarative-services-patterns-dynamic-topologies-without-chaos.md)

</div>