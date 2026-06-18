# Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-007.md`  
> Target Java: 8 sampai 25  
> Target ekosistem: Java EE `javax.inject.*`, Jakarta EE `jakarta.inject.*`, CDI, framework/runtime yang mendukung JSR-330  
> Status seri: Part 007 dari 035 — belum bagian terakhir

---

## 0. Tujuan Part Ini

Part sebelumnya membahas dependency injection secara konseptual: ownership inversion, object graph, dependency creation, dependency lookup, service locator, constructor injection, field injection, circular dependency, dan testability.

Part ini masuk ke vocabulary DI yang paling kecil tetapi sangat penting: **JSR-330 / Jakarta Dependency Injection**.

Tujuannya bukan hanya tahu bahwa ada `@Inject`. Tujuannya adalah memahami:

1. apa yang sebenarnya distandardkan oleh Jakarta Inject;
2. apa yang sengaja tidak distandardkan;
3. mengapa Jakarta Inject portable tetapi tidak cukup untuk seluruh kebutuhan enterprise runtime;
4. bagaimana `@Inject`, `@Qualifier`, `@Named`, `@Scope`, `@Singleton`, dan `Provider<T>` membentuk bahasa minimal untuk object graph;
5. bagaimana vocabulary ini dipakai oleh CDI, Guice, Spring, Quarkus, Weld, OpenWebBeans, dan container lain;
6. bagaimana memilih antara constructor injection, field injection, method injection, qualifier, named binding, provider, dan scope;
7. failure mode apa yang biasanya muncul ketika developer hanya menghafal annotation tanpa memahami resolution model.

---

## 1. Big Picture: Jakarta Inject Itu Bukan CDI

Satu kekeliruan umum:

> “Saya sudah pakai `@Inject`, berarti saya sudah memakai CDI secara penuh.”

Belum tentu.

`@Inject` berasal dari **Dependency Injection for Java**, awalnya dikenal sebagai **JSR-330**. Di era Java EE lama, package-nya biasanya:

```java
javax.inject.Inject
javax.inject.Named
javax.inject.Provider
javax.inject.Qualifier
javax.inject.Scope
javax.inject.Singleton
```

Di era Jakarta EE, package-nya menjadi:

```java
jakarta.inject.Inject
jakarta.inject.Named
jakarta.inject.Provider
jakarta.inject.Qualifier
jakarta.inject.Scope
jakarta.inject.Singleton
```

Jakarta Inject adalah **annotation vocabulary**. Ia menyediakan bahasa minimal untuk menyatakan:

- “field/constructor/method ini butuh dependency”;
- “dependency ini dibedakan dengan qualifier tertentu”;
- “dependency ini bernama string tertentu”;
- “type ini memiliki scope tertentu”;
- “saya ingin provider/lazy access ke dependency”.

Tetapi Jakarta Inject **bukan container lengkap**.

Ia tidak mendefinisikan secara lengkap:

- bean discovery;
- lifecycle context seperti request/session/application;
- event system;
- interceptor;
- decorator;
- portable extension;
- producer method;
- configuration integration;
- transaction integration;
- security integration;
- deployment validation behavior secara komprehensif.

Semua hal itu adalah wilayah CDI, Jakarta EE runtime, MicroProfile, Spring, Guice, atau framework tertentu.

Mental model ringkas:

```text
Jakarta Inject / JSR-330
    = vocabulary minimal DI

CDI
    = contextual DI container + lifecycle + scopes + events + interceptors + decorators + extensions

Jakarta EE runtime
    = CDI + Servlet + Transactions + Security + Persistence + Enterprise Beans + Resource model + deployment model
```

Jadi ketika sebuah codebase memakai:

```java
@Inject
private PaymentGateway paymentGateway;
```

annotation tersebut belum menjawab:

- siapa yang menemukan `PaymentGateway`?
- bagaimana memilih implementasinya?
- kapan instance dibuat?
- apakah instance singleton, request-scoped, dependent, pooled, atau proxied?
- apakah lifecycle callback dipanggil?
- apakah transaksi/security ikut aktif?
- apakah object bisa diganti di test?
- apakah dependency ini eager atau lazy?

Jawaban atas pertanyaan itu datang dari container/injector yang menjalankan annotation tersebut.

---

## 2. Mengapa Jakarta Inject Dibuat Minimal?

Jakarta Inject sengaja kecil karena ia ingin menjadi **common denominator** antar DI framework.

Framework yang berbeda bisa sepakat pada vocabulary dasar:

```java
@Inject
@Qualifier
@Named
@Scope
@Singleton
Provider<T>
```

Namun framework tidak harus sepakat pada seluruh model runtime.

Contoh:

- CDI punya contextual scope seperti request/session/application/conversation.
- Guice punya module binding DSL.
- Spring punya bean definition model, component scanning, profiles, conditional beans, dan lifecycle model sendiri.
- Quarkus memakai CDI/ArC dengan build-time augmentation.

Kalau Jakarta Inject terlalu besar, ia sulit diadopsi lintas framework. Kalau terlalu kecil, ia tidak cukup untuk enterprise runtime penuh. Itulah trade-off-nya.

Maka posisi arsitekturalnya:

```text
Jakarta Inject gives portable annotations.
The injector/container gives semantics.
```

Atau dalam Bahasa Indonesia:

> Jakarta Inject memberi kosakata. Container memberi makna operasional.

---

## 3. Package Migration: `javax.inject` ke `jakarta.inject`

Untuk Java 8 sampai Java 25, kita akan bertemu dua dunia:

### 3.1 Dunia Lama: `javax.inject`

Umumnya ada di:

- Java EE 6/7/8 application;
- CDI 1.x/2.x era;
- library lama;
- framework versi lama;
- enterprise app server lama;
- codebase yang belum migrasi ke Jakarta namespace.

Contoh:

```java
import javax.inject.Inject;
import javax.inject.Named;
import javax.inject.Provider;
```

### 3.2 Dunia Baru: `jakarta.inject`

Umumnya ada di:

- Jakarta EE 9+;
- Jakarta EE 10/11;
- CDI 3.x/4.x;
- Spring Framework 6+;
- Spring Boot 3+;
- Quarkus modern;
- Jakarta namespace ecosystem.

Contoh:

```java
import jakarta.inject.Inject;
import jakarta.inject.Named;
import jakarta.inject.Provider;
```

### 3.3 Jangan Dicampur Sembarangan

Ini sangat penting.

`javax.inject.Inject` dan `jakarta.inject.Inject` bukan annotation yang sama. Namanya mirip, semantics-nya mirip, tetapi binary type-nya berbeda.

```text
javax.inject.Inject   !=   jakarta.inject.Inject
```

Jika container modern hanya scan `jakarta.inject.Inject`, lalu class memakai `javax.inject.Inject`, injection bisa tidak berjalan.

Jika library lama expose `javax.inject.Provider<T>` tetapi aplikasi modern memakai `jakarta.inject.Provider<T>`, type mismatch bisa muncul.

Jika dependency graph berisi campuran library `javax` dan `jakarta`, error-nya bisa tidak langsung terlihat pada compile. Kadang baru muncul saat runtime/deployment.

Rule praktis:

```text
Dalam satu deployment unit, pilih satu namespace utama:
- Java EE 8 / legacy: javax.*
- Jakarta EE 9+: jakarta.*
```

Mixed namespace harus dianggap migration boundary, bukan style bebas.

---

## 4. Dependency Coordinates

### 4.1 Jakarta Inject API

Untuk Jakarta namespace:

```xml
<dependency>
  <groupId>jakarta.inject</groupId>
  <artifactId>jakarta.inject-api</artifactId>
  <version>2.0.1</version>
</dependency>
```

Pada Jakarta EE server, dependency API ini sering tidak perlu dibundel jika sudah disediakan oleh server/platform. Scope bisa `provided`, tergantung packaging dan runtime.

```xml
<dependency>
  <groupId>jakarta.inject</groupId>
  <artifactId>jakarta.inject-api</artifactId>
  <version>2.0.1</version>
  <scope>provided</scope>
</dependency>
```

Namun untuk aplikasi standalone, test, atau library compile, dependency ini mungkin dibutuhkan di compile classpath.

### 4.2 Legacy `javax.inject`

Untuk legacy namespace:

```xml
<dependency>
  <groupId>javax.inject</groupId>
  <artifactId>javax.inject</artifactId>
  <version>1</version>
</dependency>
```

Jangan membawa keduanya tanpa alasan kuat.

```text
Bad smell:
- javax.inject present
- jakarta.inject present
- CDI provider modern expects jakarta.*
- application classes mixed
```

### 4.3 BOM dan Platform

Dalam Jakarta EE project modern, biasanya lebih aman memakai BOM/platform dependency:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-bom</artifactId>
      <version>11.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Kemudian dependency API mengikuti versi platform.

Mental model:

```text
Single API version chosen by platform BOM
    -> fewer incompatible combinations
    -> easier runtime alignment
```

---

## 5. Annotation Set Jakarta Inject

Jakarta Inject vocabulary terdiri dari beberapa annotation/type inti:

```text
@Inject
@Qualifier
@Named
@Scope
@Singleton
Provider<T>
```

Mari kita bahas satu per satu.

---

# 6. `@Inject`: Menyatakan Injection Point

`@Inject` digunakan untuk menandai tempat di mana injector/container harus menyediakan dependency.

Tempat umum:

1. constructor;
2. field;
3. method.

---

## 6.1 Constructor Injection

Contoh:

```java
import jakarta.inject.Inject;

public class SubmitApplicationUseCase {

    private final ApplicationRepository applicationRepository;
    private final EligibilityPolicy eligibilityPolicy;
    private final AuditRecorder auditRecorder;

    @Inject
    public SubmitApplicationUseCase(
            ApplicationRepository applicationRepository,
            EligibilityPolicy eligibilityPolicy,
            AuditRecorder auditRecorder
    ) {
        this.applicationRepository = applicationRepository;
        this.eligibilityPolicy = eligibilityPolicy;
        this.auditRecorder = auditRecorder;
    }

    public SubmissionResult submit(SubmitApplicationCommand command) {
        eligibilityPolicy.check(command);
        Application application = Application.from(command);
        applicationRepository.save(application);
        auditRecorder.record("APPLICATION_SUBMITTED", application.id());
        return SubmissionResult.accepted(application.id());
    }
}
```

Constructor injection membuat dependency menjadi eksplisit. Saat membaca class, kita langsung tahu object ini tidak bisa hidup tanpa:

- `ApplicationRepository`;
- `EligibilityPolicy`;
- `AuditRecorder`.

Kelebihan:

- dependency mandatory jelas;
- mendukung immutability dengan `final` field;
- mudah dites tanpa container;
- object tidak pernah berada dalam partially-initialized state;
- cocok untuk domain/application service.

Kekurangan:

- constructor bisa panjang jika class punya terlalu banyak tanggung jawab;
- beberapa framework lama punya constraint tertentu;
- circular dependency lebih cepat terlihat.

Namun kekurangan pertama justru sering sinyal desain:

```text
Constructor terlalu panjang
    -> class mungkin terlalu banyak tanggung jawab
    -> perlu split service/policy/adapter
```

### 6.1.1 Constructor Injection Tanpa `@Inject`?

Beberapa container/framework bisa menganggap single constructor sebagai injectable constructor walau tanpa `@Inject`. Namun untuk portability, terutama jika targetnya JSR-330/Jakarta Inject, lebih jelas menulis `@Inject`.

```java
@Inject
public SubmitApplicationUseCase(...) { ... }
```

Top engineer biasanya memilih explicitness di boundary runtime.

---

## 6.2 Field Injection

Contoh:

```java
import jakarta.inject.Inject;

public class SubmitApplicationUseCase {

    @Inject
    ApplicationRepository applicationRepository;

    @Inject
    EligibilityPolicy eligibilityPolicy;

    @Inject
    AuditRecorder auditRecorder;
}
```

Field injection terlihat singkat, tetapi menyembunyikan beberapa hal:

- object bisa dibuat dengan `new SubmitApplicationUseCase()` dalam state tidak valid;
- field tidak bisa `final`;
- dependency tidak terlihat dari constructor signature;
- test tanpa container menjadi lebih sulit;
- injection terjadi setelah construction;
- class lebih bergantung pada reflection/container magic.

Field injection masih sering ditemukan di:

- legacy code;
- resource class JAX-RS/Servlet-era lama;
- examples/tutorials;
- test code;
- framework-managed objects dengan lifecycle khusus.

Tetapi untuk core business/application service, constructor injection biasanya lebih baik.

Rule praktis:

```text
Use constructor injection for mandatory business dependencies.
Avoid field injection in core code.
```

---

## 6.3 Method Injection

Contoh:

```java
import jakarta.inject.Inject;

public class ReportExporter {

    private Clock clock;
    private ReportFormatter formatter;

    @Inject
    public void configure(Clock clock, ReportFormatter formatter) {
        this.clock = clock;
        this.formatter = formatter;
    }
}
```

Method injection berguna untuk:

- optional setup model;
- framework lifecycle tertentu;
- grouping dependency yang sifatnya configuration-like;
- injection ke superclass method;
- cases ketika constructor tidak bisa dikontrol.

Namun method injection juga bisa membuat object tampak valid padahal belum di-configure.

Gunakan jarang.

---

## 6.4 Injection Point Itu Contract, Bukan Implementation Request

Saat menulis:

```java
@Inject
private PaymentGateway paymentGateway;
```

Anda sedang mengatakan:

```text
Class ini membutuhkan dependency dengan bean type PaymentGateway
serta qualifier yang sesuai.
```

Bukan:

```text
Buat object PaymentGatewayImpl secara manual.
```

Container akan memilih dependency berdasarkan rule-nya. Dalam CDI, rule itu melibatkan bean type dan qualifier. Dalam Guice, rule itu melibatkan binding. Dalam Spring, rule itu melibatkan bean definition, type, qualifier/name, primary, dan sebagainya.

Arsitektural implication:

```text
Inject abstractions at policy/application boundary.
Inject concrete classes only when concrete lifecycle is truly intended.
```

---

# 7. `@Qualifier`: Type-Safe Disambiguation

Masalah umum DI:

```java
public interface NotificationSender {
    void send(Notification notification);
}

public class EmailNotificationSender implements NotificationSender { ... }
public class SmsNotificationSender implements NotificationSender { ... }
```

Lalu:

```java
@Inject
NotificationSender sender;
```

Pertanyaannya: sender yang mana?

Jika ada dua kandidat, container tidak bisa memilih dengan aman.

Solusinya adalah **qualifier**.

---

## 7.1 Membuat Custom Qualifier

```java
import jakarta.inject.Qualifier;
import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Qualifier
@Documented
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface EmailChannel {
}
```

Qualifier lain:

```java
@Qualifier
@Documented
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface SmsChannel {
}
```

Implementasi:

```java
@EmailChannel
public class EmailNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // send email
    }
}

@SmsChannel
public class SmsNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // send sms
    }
}
```

Injection:

```java
public class CaseEscalationService {

    private final NotificationSender emailSender;
    private final NotificationSender smsSender;

    @Inject
    public CaseEscalationService(
            @EmailChannel NotificationSender emailSender,
            @SmsChannel NotificationSender smsSender
    ) {
        this.emailSender = emailSender;
        this.smsSender = smsSender;
    }
}
```

Mental model:

```text
Type says what capability is needed.
Qualifier says which semantic variant is needed.
```

---

## 7.2 Qualifier Lebih Baik dari String Name

Bandingkan:

```java
@Inject
@Named("email")
NotificationSender sender;
```

Dengan:

```java
@Inject
@EmailChannel
NotificationSender sender;
```

Qualifier type-safe punya kelebihan:

- typo lebih mudah dideteksi oleh compiler;
- refactor lebih aman;
- semantic lebih jelas;
- bisa diberi member/metadata;
- cocok untuk domain language.

`@Named("email")` rawan:

- typo string;
- tidak discoverable sebaik annotation type;
- string name sering bercampur dengan naming framework lain;
- refactoring lebih lemah.

Rule praktis:

```text
Use custom qualifier for semantic selection.
Use @Named mainly for integration/name-based bridge.
```

---

## 7.3 Qualifier Bukan Profile

Salah satu kesalahan desain:

```java
@Prod
public class RealPaymentGateway implements PaymentGateway { ... }

@Dev
public class FakePaymentGateway implements PaymentGateway { ... }
```

Lalu code business inject:

```java
@Inject
@Prod
PaymentGateway gateway;
```

Masalahnya: business code menjadi tahu environment.

Lebih baik business code inject abstraction stabil:

```java
@Inject
PaymentGateway gateway;
```

Lalu environment selection dilakukan di composition layer:

- alternative;
- producer;
- profile-specific config;
- build-time conditional bean;
- test replacement;
- deployment descriptor;
- framework conditional.

Qualifier sebaiknya merepresentasikan **semantic role**, bukan environment leakage.

Contoh qualifier yang bagus:

```text
@PrimaryDataSource
@AuditDataSource
@ExternalPayment
@InternalPayment
@CaseWorkflow
@EnforcementWorkflow
@EmailChannel
@SmsChannel
@SystemClock
@BusinessClock
```

Contoh qualifier yang perlu hati-hati:

```text
@Dev
@Uat
@Prod
@Local
@Mock
```

Bukan berarti selalu salah, tetapi harus ditempatkan di boundary composition/test, bukan menyebar ke core business logic.

---

# 8. `@Named`: String-Based Name Binding

`@Named` memberi nama string pada bean atau injection point.

Contoh:

```java
import jakarta.inject.Named;

@Named("caseService")
public class CaseService {
}
```

Injection:

```java
@Inject
@Named("caseService")
CaseService caseService;
```

Atau pada interface:

```java
@Named("email")
public class EmailNotificationSender implements NotificationSender { ... }

@Named("sms")
public class SmsNotificationSender implements NotificationSender { ... }
```

Injection:

```java
@Inject
@Named("email")
NotificationSender sender;
```

---

## 8.1 Kapan `@Named` Berguna?

`@Named` berguna untuk:

1. integrasi dengan framework yang butuh nama string;
2. bridging ke expression language / JSF / templating legacy;
3. dynamic lookup by name pada framework tertentu;
4. compatibility dengan JSR-330 container berbeda;
5. simple example/prototype.

Namun untuk core architecture, custom qualifier biasanya lebih baik.

---

## 8.2 Bahaya `@Named`

String name tampak sederhana, tetapi punya biaya:

```java
@Named("auditRecorder")
```

Lalu injection:

```java
@Named("auditRecoder") // typo: missing r
```

Compiler tidak tahu typo ini.

Akibatnya bisa:

- unsatisfied dependency;
- wrong dependency;
- runtime failure;
- test pass karena mock berbeda;
- production deployment fail.

String binding juga melemahkan refactoring.

Rule praktis:

```text
If the name has business meaning, prefer a qualifier annotation.
If the name is integration-facing, @Named may be appropriate.
```

---

# 9. `@Scope`: Meta-Annotation untuk Scope

`@Scope` bukan scope yang langsung dipakai di class biasa. Ia adalah **meta-annotation** untuk membuat scope annotation.

Contoh built-in minimal:

```java
@Singleton
public class ExchangeRateClient {
}
```

`@Singleton` sendiri adalah scope annotation.

Secara konseptual:

```text
@Scope marks another annotation as a scope annotation.
```

Scope menjawab:

```text
How does the injector reuse instances?
```

Tanpa scope, injector bisa membuat instance baru untuk satu injection lalu melupakannya. Dengan scope, injector dapat menyimpan instance untuk reuse.

---

## 9.1 Scope di Jakarta Inject vs CDI Scope

Jakarta Inject hanya memberi vocabulary minimal:

```text
@Scope
@Singleton
```

CDI memberi scope yang jauh lebih kaya:

```text
@Dependent
@RequestScoped
@SessionScoped
@ApplicationScoped
@ConversationScoped
```

Dan custom scope model.

Jangan samakan `@Singleton` Jakarta Inject dengan seluruh scope model CDI/EJB/Spring. Masing-masing container bisa punya semantics tambahan.

---

# 10. `@Singleton`: One Instance? Hati-hati dengan Maknanya

`@Singleton` menyatakan bahwa injector dapat menggunakan satu instance untuk type tersebut.

Contoh:

```java
import jakarta.inject.Singleton;

@Singleton
public class SystemClock implements Clock {
    @Override
    public Instant now() {
        return Instant.now();
    }
}
```

Atau:

```java
@Singleton
public class ExchangeRateClient {
    private final HttpClient httpClient;

    @Inject
    public ExchangeRateClient(HttpClient httpClient) {
        this.httpClient = httpClient;
    }
}
```

---

## 10.1 Singleton Bukan Berarti Aman untuk Mutable State

Ini salah satu sumber bug production.

Buruk:

```java
@Singleton
public class CurrentUserHolder {
    private User currentUser;

    public void set(User user) {
        this.currentUser = user;
    }

    public User get() {
        return currentUser;
    }
}
```

Jika singleton dipakai oleh banyak request/thread, `currentUser` akan tercampur antar user.

Singleton hanya cocok untuk:

- stateless service;
- immutable configuration snapshot;
- thread-safe client;
- shared cache yang memang concurrency-safe;
- resource manager dengan lifecycle jelas;
- expensive object yang aman direuse.

Tidak cocok untuk:

- per-request state;
- per-user state;
- temporary workflow state;
- mutable accumulator tanpa lock;
- transaction-local data;
- correlation context.

Rule praktis:

```text
Singleton service should be stateless or explicitly thread-safe.
```

---

## 10.2 Singleton vs CDI `@ApplicationScoped`

Di CDI, banyak tim lebih sering memakai:

```java
@ApplicationScoped
public class CaseService { ... }
```

Daripada:

```java
@Singleton
public class CaseService { ... }
```

Kenapa?

Karena CDI normal scopes punya client proxy semantics. `@ApplicationScoped` adalah CDI scope, sedangkan `@Singleton` dari Jakarta Inject punya semantics minimal dan tidak selalu identik di semua container.

Dalam CDI, perbedaan praktis bisa penting untuk:

- proxy behavior;
- interception;
- lifecycle;
- normal scope semantics;
- test substitution;
- extension handling.

Untuk portable CDI application, biasanya gunakan CDI scope (`@ApplicationScoped`, `@RequestScoped`, `@Dependent`) ketika memang sedang menulis CDI bean.

`@Singleton` tetap berguna untuk portability dan beberapa framework, tetapi jangan asumsikan semua behavior sama dengan CDI `@ApplicationScoped` atau EJB `@Singleton`.

```text
jakarta.inject.Singleton
    != jakarta.enterprise.context.ApplicationScoped
    != jakarta.ejb.Singleton
    != classic GoF Singleton pattern
```

---

## 10.3 Singleton Bukan GoF Singleton

GoF Singleton sering berarti:

```java
public final class Registry {
    private static final Registry INSTANCE = new Registry();

    private Registry() {}

    public static Registry getInstance() {
        return INSTANCE;
    }
}
```

DI singleton berbeda:

```java
@Singleton
public class Registry {
    @Inject
    public Registry(...) { ... }
}
```

Perbedaannya:

| Aspek | GoF Singleton | DI Singleton |
|---|---|---|
| Ownership | class sendiri | container/injector |
| Testability | lemah | lebih baik |
| Lifecycle | static/global | container lifecycle |
| Dependency | sering hidden/static | injected |
| Replacement | sulit | bisa via binding/alternative/test config |
| Shutdown | manual/sulit | bisa integrated dengan container |

Rule:

```text
Prefer container-managed singleton over static singleton when working inside a DI runtime.
```

---

# 11. `Provider<T>`: Lazy, Repeated, or Dynamic Access

`Provider<T>` adalah interface kecil:

```java
public interface Provider<T> {
    T get();
}
```

Ia memungkinkan dependency diakses nanti, bukan langsung saat object dibuat.

Contoh:

```java
import jakarta.inject.Inject;
import jakarta.inject.Provider;

public class ReportJobRunner {

    private final Provider<ReportGenerator> reportGeneratorProvider;

    @Inject
    public ReportJobRunner(Provider<ReportGenerator> reportGeneratorProvider) {
        this.reportGeneratorProvider = reportGeneratorProvider;
    }

    public void run(JobRequest request) {
        ReportGenerator generator = reportGeneratorProvider.get();
        generator.generate(request);
    }
}
```

---

## 11.1 Kapan Provider Berguna?

Provider berguna ketika:

1. dependency mahal dibuat dan belum tentu dipakai;
2. dependency harus diambil sesuai context aktif saat itu;
3. ingin mendapatkan instance baru/relevant per call sesuai scope container;
4. ingin memutus sebagian circular dependency dengan hati-hati;
5. ingin lazy initialization;
6. ingin optional-ish behavior, tergantung container;
7. ingin memperkecil startup cost pada path tertentu.

Contoh expensive object:

```java
public class ExportService {

    private final Provider<PdfRenderer> pdfRenderer;

    @Inject
    public ExportService(Provider<PdfRenderer> pdfRenderer) {
        this.pdfRenderer = pdfRenderer;
    }

    public byte[] export(ExportRequest request) {
        if (request.format() == ExportFormat.PDF) {
            return pdfRenderer.get().render(request);
        }
        return exportAsCsv(request);
    }
}
```

Jika hanya 5% request memakai PDF, `Provider<PdfRenderer>` bisa menunda pembuatan renderer sampai dibutuhkan.

---

## 11.2 Provider Bukan Alasan untuk Service Locator

Buruk:

```java
public class WorkflowService {

    @Inject
    Provider<EmailSender> emailSender;

    @Inject
    Provider<SmsSender> smsSender;

    @Inject
    Provider<AuditRecorder> auditRecorder;

    @Inject
    Provider<PaymentGateway> paymentGateway;

    public void execute(Command command) {
        // get dependencies randomly everywhere
    }
}
```

Jika semua dependency dibungkus Provider tanpa alasan, code menjadi service locator terselubung. Dependency tidak lagi jelas mana yang mandatory dan mana yang optional/lazy.

Rule:

```text
Use Provider<T> only when timing/context/laziness/repeated lookup matters.
Do not use Provider<T> to hide poor dependency design.
```

---

## 11.3 Provider dan Scope

Provider tidak selalu berarti instance baru.

Jika target bean singleton/application-scoped, `provider.get()` bisa mengembalikan instance/proxy yang sama.

Jika target dependent/prototype-like, `provider.get()` bisa membuat instance baru.

Jika target request-scoped, `provider.get()` bisa resolve instance sesuai request context aktif.

Mental model:

```text
Provider<T>.get()
    asks the injector/container for T now.

What you receive depends on target bean scope and container semantics.
```

Karena itu jangan membuat asumsi:

```text
Provider.get() == new instance
```

Belum tentu.

---

## 11.4 Provider dan Error Timing

Tanpa provider:

```java
@Inject
HeavyService heavyService;
```

Dependency biasanya divalidasi/resolved saat deployment/startup atau saat object dibuat.

Dengan provider:

```java
@Inject
Provider<HeavyService> heavyService;
```

Sebagian error bisa bergeser ke waktu `get()` dipanggil, tergantung container.

Implikasi:

- startup mungkin lebih ringan;
- error bisa muncul lebih lambat;
- test harus memanggil path yang memicu `get()`;
- observability perlu mencatat failure pada lazy path.

Rule:

```text
Lazy dependency should still be tested and observable.
```

---

# 12. Injection Resolution: Apa yang Sebenarnya Dicari?

Jakarta Inject sendiri tidak mendefinisikan full algorithm seperti CDI. Tetapi secara umum injector harus menjawab:

```text
Given an injection point:
    type + qualifiers/name + metadata
Find a binding/bean/provider that can supply it.
```

Contoh:

```java
@Inject
@EmailChannel
NotificationSender sender;
```

Injection point metadata:

```text
Required type     : NotificationSender
Required qualifier: @EmailChannel
Required location : field sender
Owning class      : SomeService
```

Injector mencari kandidat yang match.

Dalam CDI, kandidatnya adalah bean dengan bean type `NotificationSender` dan qualifier `@EmailChannel`.

Dalam Guice, kandidatnya adalah binding yang cocok.

Dalam Spring, kandidatnya adalah bean definition yang cocok dengan type/name/qualifier.

---

## 12.1 Unsatisfied Dependency

Tidak ada kandidat.

```text
Injection point requires PaymentGateway
but no bean/binding/provider can supply PaymentGateway.
```

Penyebab umum:

- class belum jadi bean;
- class tidak discan;
- package salah;
- namespace salah (`javax` vs `jakarta`);
- dependency JAR tidak ada;
- qualifier injection tidak sama dengan qualifier bean;
- implementation tidak registered;
- profile/alternative tidak aktif;
- bean class abstract/interface tanpa provider;
- constructor tidak injectable.

---

## 12.2 Ambiguous Dependency

Lebih dari satu kandidat.

```text
Injection point requires NotificationSender
Candidates:
- EmailNotificationSender
- SmsNotificationSender
```

Solusi:

- gunakan qualifier;
- pilih default implementation;
- buat producer;
- gunakan alternative/priority pada CDI;
- inject collection/registry jika memang butuh banyak strategy;
- desain ulang abstraction.

---

## 12.3 Wrong Dependency

Ini lebih berbahaya karena deployment bisa sukses, tetapi behavior salah.

Contoh:

```java
@Named("primary")
public class PrimaryPaymentGateway implements PaymentGateway { ... }

@Named("secondary")
public class SecondaryPaymentGateway implements PaymentGateway { ... }
```

Lalu typo atau copy-paste membuat injection memakai gateway salah.

Solusi:

- gunakan qualifier type-safe;
- test behavior dengan contract test;
- log selected implementation saat startup untuk komponen kritis;
- expose runtime wiring secara aman di debug/health endpoint internal;
- hindari string name untuk behavior critical.

---

# 13. Constructor, Field, Method: Decision Matrix

| Teknik | Cocok untuk | Hindari jika | Catatan |
|---|---|---|---|
| Constructor injection | mandatory dependency, core service, domain/application logic | constructor terlalu panjang tanpa refactor | default pilihan terbaik |
| Field injection | legacy, framework objects, examples, test tertentu | core service, immutable object, library code | menyembunyikan dependency |
| Method injection | lifecycle khusus, optional grouped setup, superclass injection | mandatory core dependency | gunakan jarang |
| Provider injection | lazy/contextual/repeated lookup | sekadar malas desain dependency | jangan jadi service locator |

Recommended default:

```java
public class Service {
    private final Dependency dependency;

    @Inject
    public Service(Dependency dependency) {
        this.dependency = dependency;
    }
}
```

---

# 14. Annotation Target dan Retention: Kenapa Penting?

Custom qualifier harus punya retention runtime.

Benar:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface AuditChannel {
}
```

Salah:

```java
@Qualifier
@Retention(CLASS)
public @interface AuditChannel {
}
```

Jika retention bukan runtime, container tidak bisa membaca annotation saat runtime.

Target juga penting. Jika qualifier hanya bisa ditempel di `TYPE`, maka tidak bisa dipakai di parameter constructor.

```java
@Target(TYPE) // terlalu sempit
public @interface AuditChannel { }
```

Lalu ini gagal compile:

```java
@Inject
public Service(@AuditChannel Sender sender) { ... }
```

Karena `PARAMETER` tidak diizinkan.

Rule custom qualifier:

```java
@Qualifier
@Documented
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface SomeSemanticQualifier {
}
```

Untuk CDI producer method, `METHOD` juga penting.

---

# 15. Qualifier dengan Member

Qualifier bisa punya member.

Contoh:

```java
@Qualifier
@Documented
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface Channel {
    ChannelType value();
}
```

Enum:

```java
public enum ChannelType {
    EMAIL,
    SMS,
    PUSH
}
```

Implementasi:

```java
@Channel(ChannelType.EMAIL)
public class EmailSender implements NotificationSender { ... }

@Channel(ChannelType.SMS)
public class SmsSender implements NotificationSender { ... }
```

Injection:

```java
@Inject
public NotificationService(
        @Channel(ChannelType.EMAIL) NotificationSender email,
        @Channel(ChannelType.SMS) NotificationSender sms
) {
    this.email = email;
    this.sms = sms;
}
```

Kelebihan:

- jumlah annotation tidak meledak;
- semantic variant lebih terstruktur;
- cocok untuk enum tertutup.

Kekurangan:

- annotation lebih verbose;
- member harus hati-hati terhadap equality/matching;
- untuk CDI ada konsep `@Nonbinding`, tetapi itu milik CDI, bukan vocabulary minimal Jakarta Inject murni.

Rule:

```text
Use marker qualifier for major semantic roles.
Use member qualifier for small closed variation set.
```

---

# 16. Jakarta Inject dan Library Design

Jika Anda membuat library yang ingin dipakai di banyak DI framework, Jakarta Inject menarik karena portable.

Contoh library class:

```java
public class RetryableHttpExecutor {

    private final HttpTransport transport;
    private final RetryPolicy retryPolicy;

    @Inject
    public RetryableHttpExecutor(HttpTransport transport, RetryPolicy retryPolicy) {
        this.transport = transport;
        this.retryPolicy = retryPolicy;
    }
}
```

Library ini tidak bergantung ke CDI, Spring, Guice, atau app server tertentu. Ia hanya memakai Jakarta Inject.

Namun hati-hati: kalau library menaruh annotation CDI seperti:

```java
@ApplicationScoped
public class RetryableHttpExecutor { ... }
```

maka library menjadi lebih CDI-specific.

Kadang itu tepat, kadang tidak.

Decision:

```text
Reusable Java library:
    prefer constructor + optional jakarta.inject annotations

CDI application component:
    use CDI annotations and lifecycle intentionally

Framework integration library:
    may provide CDI extension / Spring auto-config / Guice module separately
```

---

# 17. Jakarta Inject di CDI

CDI memakai Jakarta Inject annotation untuk injection point.

Contoh CDI bean:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class CaseAssignmentService {

    private final AssignmentPolicy assignmentPolicy;

    @Inject
    public CaseAssignmentService(AssignmentPolicy assignmentPolicy) {
        this.assignmentPolicy = assignmentPolicy;
    }
}
```

Di CDI, `@Inject` bekerja bersama:

- bean discovery;
- CDI scopes;
- CDI qualifiers;
- producer/disposer;
- alternatives;
- interceptors;
- decorators;
- events;
- extensions;
- contextual reference/proxy.

Jadi annotation sama, semantics lebih kaya.

---

## 17.1 CDI Qualifier vs Jakarta Inject Qualifier

CDI memakai `jakarta.inject.Qualifier` sebagai basis qualifier.

Namun CDI menambahkan behavior lebih detail:

- built-in `@Default`;
- built-in `@Any`;
- qualifier member matching;
- `@Nonbinding`;
- alternatives;
- specialization;
- producer method resolution;
- type-safe resolution algorithm.

Part ini hanya vocabulary. Detail CDI resolution akan dibahas di Part 008 dan Part 012.

---

# 18. Jakarta Inject di Spring

Spring Framework modern juga mendukung JSR-330/Jakarta Inject annotations.

Contoh:

```java
import jakarta.inject.Inject;
import jakarta.inject.Named;

@Named
public class InvoiceService {

    private final TaxCalculator taxCalculator;

    @Inject
    public InvoiceService(TaxCalculator taxCalculator) {
        this.taxCalculator = taxCalculator;
    }
}
```

Spring bisa memperlakukan `@Named` mirip component name dan `@Inject` mirip autowiring.

Namun Spring tetap punya semantics sendiri:

- `@Component`;
- `@Service`;
- `@Autowired`;
- `@Qualifier` Spring;
- `@Primary`;
- `@Profile`;
- `@Conditional`;
- bean lifecycle Spring;
- scope Spring.

Maka code dengan Jakarta Inject bisa portable secara annotation, tetapi tidak seluruh runtime behavior portable.

Rule:

```text
JSR-330 annotations improve portability at source level.
They do not make Spring/CDI/Guice runtime semantics identical.
```

---

# 19. Jakarta Inject di Guice

Guice adalah salah satu framework awal yang sangat dekat dengan JSR-330 model.

Guice memakai binding module:

```java
public class AppModule extends AbstractModule {
    @Override
    protected void configure() {
        bind(PaymentGateway.class).to(StripePaymentGateway.class);
    }
}
```

Class:

```java
public class CheckoutService {
    private final PaymentGateway paymentGateway;

    @Inject
    public CheckoutService(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }
}
```

Di sini `@Inject` portable, tetapi binding datang dari Guice module, bukan CDI bean discovery.

---

# 20. Jakarta Inject di Quarkus / Build-Time Runtime

Quarkus memakai CDI programming model lewat ArC, tetapi banyak hal diproses pada build time.

Dampaknya:

- injection errors bisa muncul saat build;
- unused beans bisa dioptimasi;
- reflection bisa dikurangi;
- native-image compatibility lebih baik;
- beberapa dynamic CDI pattern mungkin dibatasi/diatur.

Annotation `@Inject` sama, tetapi runtime model berbeda dari traditional application server.

Mental model:

```text
Same annotation does not imply same bootstrap strategy.
```

---

# 21. Portable Code vs Portable Behavior

Ini distinction penting untuk top-level engineer.

Portable code:

```java
@Inject
public Service(Repository repository) { ... }
```

Bisa compile di banyak framework.

Portable behavior:

```text
The same object graph, lifecycle, proxying, scope, startup validation,
interceptor behavior, config selection, and failure timing across runtimes.
```

Ini jauh lebih sulit.

Jakarta Inject membantu portable code, tetapi behavior masih harus diverifikasi di target runtime.

Checklist:

```text
[ ] Apakah runtime mendukung jakarta.inject atau javax.inject?
[ ] Apakah class ini discoverable/registered?
[ ] Apakah scope semantics sama?
[ ] Apakah qualifier matching sama?
[ ] Apakah named binding semantics sama?
[ ] Apakah Provider.get() behavior sama?
[ ] Apakah lifecycle callback/interceptor ikut aktif?
[ ] Apakah test runtime sama dengan production runtime?
```

---

# 22. Anti-Patterns

## 22.1 Field Injection Everywhere

```java
public class CaseService {
    @Inject Repository repository;
    @Inject Policy policy;
    @Inject Audit audit;
}
```

Masalah:

- dependency tersembunyi;
- object bisa invalid;
- test sulit;
- field tidak final;
- design smell tidak terlihat.

Lebih baik:

```java
public class CaseService {
    private final Repository repository;
    private final Policy policy;
    private final Audit audit;

    @Inject
    public CaseService(Repository repository, Policy policy, Audit audit) {
        this.repository = repository;
        this.policy = policy;
        this.audit = audit;
    }
}
```

---

## 22.2 String Name as Architecture

```java
@Inject
@Named("fast")
RiskEngine riskEngine;
```

Apa itu `fast`? Fast untuk apa? Untuk dev? Untuk low-latency path? Untuk non-regulatory path? Untuk approximate risk?

Lebih baik:

```java
@Inject
@PreScreening
RiskEngine riskEngine;
```

Atau:

```java
@Inject
@FullAssessment
RiskEngine riskEngine;
```

Semantic annotation mengurangi ambiguity.

---

## 22.3 Singleton with Request State

```java
@Singleton
public class CaseContext {
    private String currentCaseId;
}
```

Ini berbahaya jika banyak request/thread.

Gunakan request context, method parameter, explicit context object, atau ThreadLocal managed dengan sangat hati-hati.

Lebih baik:

```java
public Decision decide(CaseContext context, DecisionRequest request) {
    ...
}
```

State request lewat parameter sering lebih defensible daripada disimpan dalam singleton.

---

## 22.4 Provider as Escape Hatch

```java
@Inject
Provider<Everything> everything;
```

Jika Provider dipakai untuk semua hal, dependency graph menjadi kabur.

Gunakan Provider hanya jika ada alasan runtime yang jelas.

---

## 22.5 Injecting Container Everywhere

Misal framework tertentu menyediakan `Injector`, `BeanManager`, `ApplicationContext`, atau registry. Lalu code melakukan lookup manual di mana-mana.

```java
Object bean = container.getBean(name);
```

Ini mengembalikan service locator anti-pattern.

Kadang diperlukan di framework layer/plugin system, tetapi jangan menyebar ke business logic.

Rule:

```text
Container access belongs at framework/composition boundary, not core business logic.
```

---

# 23. Design Patterns dengan Jakarta Inject

## 23.1 Strategy Pattern

```java
public interface AssignmentStrategy {
    AssignmentResult assign(CaseFile caseFile);
}
```

Qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface ManualReview {
}

@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface AutoAssignment {
}
```

Implementasi:

```java
@ManualReview
public class ManualReviewAssignmentStrategy implements AssignmentStrategy { ... }

@AutoAssignment
public class AutoAssignmentStrategy implements AssignmentStrategy { ... }
```

Use case:

```java
public class AssignmentCoordinator {
    private final AssignmentStrategy auto;
    private final AssignmentStrategy manual;

    @Inject
    public AssignmentCoordinator(
            @AutoAssignment AssignmentStrategy auto,
            @ManualReview AssignmentStrategy manual
    ) {
        this.auto = auto;
        this.manual = manual;
    }

    public AssignmentResult assign(CaseFile caseFile) {
        if (caseFile.isEligibleForAutoAssignment()) {
            return auto.assign(caseFile);
        }
        return manual.assign(caseFile);
    }
}
```

Catatan: pemilihan runtime masih ada di coordinator. Untuk selection yang lebih dynamic/banyak variant, gunakan registry pattern di layer composition.

---

## 23.2 Port and Adapter

Application service:

```java
public class IssueNoticeUseCase {
    private final NoticeRepository noticeRepository;
    private final DocumentGenerator documentGenerator;
    private final NotificationPort notificationPort;

    @Inject
    public IssueNoticeUseCase(
            NoticeRepository noticeRepository,
            DocumentGenerator documentGenerator,
            NotificationPort notificationPort
    ) {
        this.noticeRepository = noticeRepository;
        this.documentGenerator = documentGenerator;
        this.notificationPort = notificationPort;
    }
}
```

Adapter:

```java
public class EmailNotificationAdapter implements NotificationPort {
    @Override
    public void notify(Notice notice) { ... }
}
```

DI menghubungkan application policy ke infrastructure adapter tanpa application service tahu detail transport.

---

## 23.3 Lazy Expensive Adapter

```java
public class DocumentExportUseCase {
    private final Provider<PdfDocumentRenderer> pdfRenderer;

    @Inject
    public DocumentExportUseCase(Provider<PdfDocumentRenderer> pdfRenderer) {
        this.pdfRenderer = pdfRenderer;
    }

    public ExportedDocument export(ExportRequest request) {
        return switch (request.format()) {
            case PDF -> pdfRenderer.get().render(request);
            case CSV -> renderCsv(request);
        };
    }
}
```

Gunakan jika renderer mahal atau context-sensitive.

---

## 23.4 Test Replacement

Dengan constructor injection, test mudah:

```java
@Test
void submitsApplication() {
    ApplicationRepository repository = new InMemoryApplicationRepository();
    EligibilityPolicy policy = command -> { };
    AuditRecorder audit = new InMemoryAuditRecorder();

    SubmitApplicationUseCase useCase = new SubmitApplicationUseCase(
            repository,
            policy,
            audit
    );

    SubmissionResult result = useCase.submit(command);

    assertTrue(result.accepted());
}
```

Tidak perlu container untuk unit test business logic.

Ini salah satu alasan constructor injection sangat kuat.

---

# 24. Failure Diagnosis Playbook

Ketika injection gagal, jangan langsung menebak. Gunakan taxonomy.

## 24.1 Pertanyaan Pertama: Namespace Benar?

```text
Apakah project target Jakarta EE 9+?
    -> gunakan jakarta.inject.*

Apakah project target Java EE 8?
    -> gunakan javax.inject.*
```

Cek import class.

```java
// wrong in Jakarta EE 10/11 runtime if container expects jakarta namespace
import javax.inject.Inject;
```

---

## 24.2 Apakah Class Terdaftar/Discoverable?

`@Inject` pada class bukan berarti class itu otomatis menjadi bean di semua framework.

Tergantung runtime:

- CDI perlu bean discovery/bean-defining annotation/beans.xml/rules;
- Spring perlu component scanning atau bean definition;
- Guice perlu binding/module atau injectable concrete construction;
- app server perlu deployment unit benar.

Pertanyaan:

```text
[ ] Apakah class ada di classpath runtime?
[ ] Apakah JAR/WAR benar terdeploy?
[ ] Apakah package discan?
[ ] Apakah bean-defining annotation ada?
[ ] Apakah binding/module ada?
[ ] Apakah profile/condition mengaktifkan bean?
```

---

## 24.3 Apakah Type Match?

Injection:

```java
@Inject
PaymentGateway gateway;
```

Implementation:

```java
public class StripeGateway implements ExternalPaymentGateway { ... }
```

Jika `StripeGateway` tidak implement `PaymentGateway`, tidak match.

Atau generic mismatch:

```java
@Inject
Repository<Application> repository;
```

Candidate:

```java
Repository<CaseFile>
```

Tidak sama.

---

## 24.4 Apakah Qualifier Match?

Injection:

```java
@Inject
@EmailChannel
NotificationSender sender;
```

Candidate:

```java
@SmsChannel
public class SmsNotificationSender implements NotificationSender { ... }
```

Tidak match.

Jika qualifier punya member, nilainya juga harus match sesuai semantics container.

---

## 24.5 Apakah Terlalu Banyak Kandidat?

Jika ambiguous:

```text
Candidates:
- RealPaymentGateway
- MockPaymentGateway
```

Mungkin mock test class masuk production classpath. Atau implementation lama belum dihapus. Atau qualifier tidak dipasang.

Solusi bukan sekadar “hapus satu class”. Pahami intended selection model.

---

## 24.6 Apakah Scope Membuat Masalah?

Contoh:

- singleton menyimpan request state;
- request-scoped dependency dipakai di async thread;
- provider dipanggil saat context tidak aktif;
- object final tidak bisa diproxy oleh CDI normal scope;
- dependent object lifecycle tidak ditutup.

Walau Part ini belum membahas CDI scope detail, catat bahwa injection success tidak menjamin lifecycle correctness.

---

# 25. Runtime Mental Model Diagram

```text
Source Code
    |
    | uses annotations
    v
@Inject / @Qualifier / @Named / @Scope / @Singleton / Provider<T>
    |
    | interpreted by
    v
Injector / Container
    |
    | using runtime-specific rules
    v
Binding / Bean / Provider / Component Definition
    |
    | creates or returns
    v
Dependency Instance or Proxy
    |
    | injected into
    v
Application Object
```

Critical point:

```text
Annotations do not inject anything by themselves.
The runtime interprets annotations.
```

---

# 26. Jakarta Inject vs CDI: Feature Comparison

| Capability | Jakarta Inject | CDI |
|---|---:|---:|
| `@Inject` | Yes | Yes, uses it |
| custom qualifier | Yes | Yes, richer matching |
| `@Named` | Yes | Yes |
| `@Singleton` | Yes | Can support, but CDI scopes richer |
| request scope | No | Yes |
| session scope | No | Yes |
| application scope | No | Yes |
| dependent scope | No as standard annotation | Yes |
| producer methods | No | Yes |
| disposer methods | No | Yes |
| events | No | Yes |
| interceptors integration | No | Yes/Jakarta Interceptors |
| decorators | No | Yes |
| alternatives | No | Yes |
| portable extension | No | Yes |
| contextual lifecycle | Minimal | Core feature |
| deployment validation | Not fully | Yes |

Kesimpulan:

```text
Jakarta Inject is a vocabulary.
CDI is a contextual runtime model.
```

---

# 27. Practical Coding Standard

Untuk enterprise Java project, standar yang saya sarankan:

## 27.1 Constructor Injection by Default

```java
private final Dependency dependency;

@Inject
public Service(Dependency dependency) {
    this.dependency = dependency;
}
```

## 27.2 No Field Injection in Core Services

Field injection boleh dipakai hanya dengan alasan jelas:

- framework-managed legacy class;
- generated/proxy-bound class;
- test fixture;
- migration phase.

## 27.3 Qualifier over `@Named` for Business Semantics

```java
@AuditChannel
AuditRecorder auditRecorder;
```

lebih baik daripada:

```java
@Named("audit")
AuditRecorder auditRecorder;
```

## 27.4 Use `Provider<T>` Sparingly

Provider harus punya alasan eksplisit:

- lazy;
- context-sensitive;
- expensive;
- repeated lookup;
- circular dependency mitigation sementara.

## 27.5 Avoid Static Singleton

Dalam DI runtime, hindari:

```java
SomeService.getInstance()
```

Prefer:

```java
@Inject
SomeService service;
```

## 27.6 Keep Namespace Consistent

```text
Jakarta runtime -> jakarta.inject.*
Legacy Java EE -> javax.inject.*
```

## 27.7 Do Not Put Environment Selection in Business Injection Points

Buruk:

```java
@Inject
@Prod
PaymentGateway gateway;
```

Lebih baik environment selection di composition/config layer.

---

# 28. Example: Regulatory Case Management Runtime

Kita gunakan contoh domain case management / enforcement lifecycle.

## 28.1 Domain Ports

```java
public interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);
    void save(CaseFile caseFile);
}

public interface CaseRiskPolicy {
    RiskAssessment assess(CaseFile caseFile);
}

public interface CaseAuditRecorder {
    void record(CaseAuditEvent event);
}

public interface NotificationSender {
    void send(Notification notification);
}
```

## 28.2 Use Case

```java
public class EscalateCaseUseCase {

    private final CaseRepository caseRepository;
    private final CaseRiskPolicy riskPolicy;
    private final CaseAuditRecorder auditRecorder;
    private final NotificationSender notificationSender;

    @Inject
    public EscalateCaseUseCase(
            CaseRepository caseRepository,
            CaseRiskPolicy riskPolicy,
            CaseAuditRecorder auditRecorder,
            @EmailChannel NotificationSender notificationSender
    ) {
        this.caseRepository = caseRepository;
        this.riskPolicy = riskPolicy;
        this.auditRecorder = auditRecorder;
        this.notificationSender = notificationSender;
    }

    public EscalationResult escalate(EscalateCaseCommand command) {
        CaseFile caseFile = caseRepository.findById(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        RiskAssessment risk = riskPolicy.assess(caseFile);
        caseFile.escalate(risk.reason());

        caseRepository.save(caseFile);

        auditRecorder.record(CaseAuditEvent.escalated(caseFile.id(), risk.reason()));

        notificationSender.send(Notification.caseEscalated(caseFile.id()));

        return EscalationResult.success(caseFile.id());
    }
}
```

Notice:

- dependency mandatory lewat constructor;
- use case tidak tahu concrete database;
- use case tidak tahu email implementation detail;
- qualifier hanya untuk semantic channel;
- tidak ada service locator;
- test bisa dibuat tanpa container.

## 28.3 Qualifier

```java
@Qualifier
@Documented
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface EmailChannel {
}
```

## 28.4 Implementation

```java
@EmailChannel
public class SmtpNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // SMTP adapter
    }
}
```

## 28.5 Test Without Container

```java
@Test
void escalatesHighRiskCase() {
    CaseRepository repository = new InMemoryCaseRepository();
    CaseRiskPolicy riskPolicy = caseFile -> RiskAssessment.high("Repeated breach");
    CaseAuditRecorder audit = new InMemoryCaseAuditRecorder();
    NotificationSender notification = new InMemoryNotificationSender();

    EscalateCaseUseCase useCase = new EscalateCaseUseCase(
            repository,
            riskPolicy,
            audit,
            notification
    );

    EscalationResult result = useCase.escalate(command);

    assertTrue(result.success());
}
```

Ini adalah manfaat besar: DI annotation tidak membuat business logic tidak bisa dites.

---

# 29. How Top Engineers Think About Jakarta Inject

Junior view:

```text
@Inject means framework creates object for me.
```

Mid-level view:

```text
@Inject wires dependencies by type/name/qualifier.
```

Senior view:

```text
@Inject defines an explicit runtime contract between a component and its composition root/container.
The correctness of that contract depends on namespace, discovery, binding, qualifier, scope, lifecycle, proxying, and deployment.
```

Top-level view:

```text
Injection is not only convenience.
It is runtime architecture.
It controls coupling, lifecycle, test seams, failure timing, startup validation, and operational debuggability.
```

---

# 30. Review Questions

Gunakan pertanyaan ini untuk memastikan pemahaman:

1. Apa perbedaan Jakarta Inject dan CDI?
2. Mengapa `@Inject` sendiri tidak membuat object apa pun?
3. Apa risiko mencampur `javax.inject.Inject` dan `jakarta.inject.Inject`?
4. Mengapa constructor injection lebih baik untuk mandatory dependency?
5. Kapan field injection masih masuk akal?
6. Apa perbedaan qualifier dan `@Named`?
7. Mengapa `@Named` rawan untuk business-critical routing?
8. Apa fungsi `@Scope`?
9. Mengapa `@Singleton` bukan berarti aman menyimpan mutable state?
10. Apa perbedaan `jakarta.inject.Singleton`, CDI `@ApplicationScoped`, EJB `@Singleton`, dan GoF Singleton?
11. Kapan `Provider<T>` layak digunakan?
12. Mengapa `Provider<T>` bisa menjadi service locator terselubung?
13. Bagaimana Anda mendiagnosis unsatisfied dependency?
14. Bagaimana Anda mendiagnosis ambiguous dependency?
15. Apa bedanya portable code dan portable behavior?

---

# 31. Cheat Sheet

```java
// Constructor injection — default recommendation
@Inject
public Service(Dependency dependency) {
    this.dependency = dependency;
}
```

```java
// Custom qualifier
@Qualifier
@Documented
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface AuditChannel {
}
```

```java
// Qualified implementation
@AuditChannel
public class DatabaseAuditRecorder implements AuditRecorder {
}
```

```java
// Qualified injection
@Inject
public CaseService(@AuditChannel AuditRecorder auditRecorder) {
    this.auditRecorder = auditRecorder;
}
```

```java
// Provider for lazy/contextual access
@Inject
public ExportService(Provider<PdfRenderer> pdfRenderer) {
    this.pdfRenderer = pdfRenderer;
}
```

```java
// Avoid for core services
@Inject
private Dependency dependency;
```

```text
Prefer:
- constructor injection
- custom qualifier
- explicit namespace
- stateless singleton
- Provider only with reason

Avoid:
- field injection everywhere
- @Named as architecture
- singleton request state
- mixed javax/jakarta imports
- container lookup in business logic
```

---

# 32. Key Takeaways

1. Jakarta Inject is the minimal standard vocabulary for dependency injection.
2. It is not a full container and not the same as CDI.
3. `@Inject` marks injection points; it does not perform injection by itself.
4. The injector/container decides how dependencies are discovered, created, scoped, proxied, and destroyed.
5. `javax.inject.*` and `jakarta.inject.*` are different namespaces and should not be mixed casually.
6. Constructor injection is the best default for mandatory dependencies.
7. Field injection is convenient but weakens explicitness, immutability, and testability.
8. Qualifiers are type-safe semantic selectors.
9. `@Named` is useful for name-based integration but weaker for business-critical routing.
10. `@Singleton` means container/injector reuse, not automatic thread safety.
11. `Provider<T>` is for lazy/contextual/repeated access, not for hiding poor design.
12. Portable annotations do not guarantee portable runtime behavior.

---

# 33. What Comes Next

Part berikutnya masuk ke CDI core mental model:

```text
Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
```

Di Part 008, kita akan naik dari vocabulary minimal Jakarta Inject menuju model CDI penuh:

- bean;
- bean type;
- qualifier;
- scope;
- context;
- contextual reference;
- client proxy;
- `@Default`;
- `@Any`;
- type-safe resolution;
- ambiguity dan unsatisfied dependency dalam CDI;
- mengapa CDI bukan sekadar “framework yang scan annotation”.

---

# References

- Jakarta Dependency Injection 2.0 Specification: https://jakarta.ee/specifications/dependency-injection/2.0/
- Jakarta Dependency Injection API docs: https://jakarta.ee/specifications/dependency-injection/2.0/apidocs/
- Jakarta CDI 4.1 Specification: https://jakarta.ee/specifications/cdi/4.1/
- Jakarta EE Platform 11: https://jakarta.ee/specifications/platform/11/
- Spring Framework JSR-330 standard annotations reference: https://docs.spring.io/spring-framework/reference/core/beans/standard-annotations.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-008.md)

</div>