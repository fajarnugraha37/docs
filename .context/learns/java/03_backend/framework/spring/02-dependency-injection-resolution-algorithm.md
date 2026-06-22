# Part 2 — Dependency Injection Resolution Algorithm

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `02-dependency-injection-resolution-algorithm.md`  
> Status seri: Part 2 dari 35 — **belum selesai**  
> Target pembaca: Java engineer yang sudah memahami Java, Jakarta, JPA, servlet, security, build, deployment, observability, dan ingin memahami Spring di level runtime engineering.

---

## 0. Tujuan Part Ini

Pada Part 1, kita sudah membangun mental model bahwa Spring bukan sekadar kumpulan annotation, melainkan sebuah **container runtime** yang menyimpan `BeanDefinition`, membuat object, mengelola lifecycle, dan menyediakan dependency graph.

Part ini masuk ke pertanyaan yang lebih tajam:

> Ketika sebuah class meminta dependency, bagaimana Spring memutuskan object mana yang diberikan?

Pertanyaan ini terlihat sederhana, tetapi di sistem besar jawabannya menentukan:

- apakah aplikasi start atau gagal;
- apakah bean yang dipakai benar atau salah;
- apakah test memakai dependency production tanpa sadar;
- apakah circular dependency muncul;
- apakah transaction/security/cache/async bekerja;
- apakah module boundary bisa dipertahankan;
- apakah konfigurasi enterprise masih bisa dipahami setelah ratusan bean dan puluhan starter masuk ke classpath.

Spring dependency injection bukan hanya:

```java
@Autowired
private UserService userService;
```

Itu hanya gejala permukaan.

Yang sebenarnya terjadi adalah proses seperti ini:

```text
injection point ditemukan
        ↓
descriptor dependency dibuat
        ↓
tipe target dianalisis
        ↓
kandidat bean dicari
        ↓
kandidat difilter berdasarkan autowire candidacy
        ↓
qualifier/primary/fallback/priority/name/parameter diselesaikan
        ↓
jika single dependency: satu bean dipilih
jika collection/map: banyak bean dikumpulkan dan diurutkan
        ↓
bean target dibuat jika belum ada
        ↓
proxy mungkin dibuat atau dikembalikan
        ↓
dependency diinjeksi
```

Tujuan part ini bukan membuat Anda hafal urutan internal method Spring, tetapi membuat Anda mampu **memprediksi hasil dependency injection** dalam sistem nyata.

Setelah menyelesaikan part ini, Anda seharusnya bisa menjawab:

1. Kenapa Spring memilih bean A, bukan bean B?
2. Kenapa `@Primary` tidak menyelesaikan masalah pada collection injection?
3. Kenapa `@Qualifier` kadang tetap gagal?
4. Kenapa parameter name bisa memengaruhi resolusi bean?
5. Kenapa constructor injection lebih aman untuk service inti?
6. Kapan `ObjectProvider<T>` lebih tepat daripada `Optional<T>`?
7. Kenapa self-invocation dan proxy bisa membuat dependency terlihat benar tetapi behavior salah?
8. Bagaimana mendesain dependency graph agar module besar tetap jelas?

---

## 1. Dependency Injection: Masalah yang Sebenarnya Diselesaikan

Dependency injection sering dijelaskan sebagai cara agar object tidak membuat dependency sendiri.

Contoh buruk:

```java
public class OrderService {

    private final PaymentClient paymentClient = new PaymentClient();
}
```

Contoh lebih baik:

```java
public class OrderService {

    private final PaymentClient paymentClient;

    public OrderService(PaymentClient paymentClient) {
        this.paymentClient = paymentClient;
    }
}
```

Tetapi pada sistem Spring, dependency injection menyelesaikan masalah yang lebih besar daripada sekadar menghindari `new`.

Spring DI menyelesaikan masalah:

1. **Object graph construction**  
   Siapa membutuhkan siapa, dalam urutan apa, dengan lifecycle apa.

2. **Policy injection**  
   Dependency mana yang dipilih berdasarkan environment, profile, condition, qualifier, starter, atau customization.

3. **Cross-cutting behavior**  
   Object yang diinjeksi mungkin bukan object asli, tetapi proxy transaksi, security, cache, async, retry, observability, atau AOP lain.

4. **Configurability**  
   Implementasi bisa diganti tanpa mengubah consumer.

5. **Testability**  
   Dependency bisa diganti dengan fake, stub, mock, test bean, atau test configuration.

6. **Architecture enforcement**  
   Constructor dependency graph memperlihatkan coupling secara eksplisit.

Jadi dependency injection di Spring bukan hanya teknik membuat kode lebih rapi.

Ia adalah mekanisme runtime untuk membangun **application wiring model**.

---

## 2. Jangan Samakan Dependency Injection dengan Autowiring

Istilah yang sering tertukar:

| Istilah | Makna |
|---|---|
| Dependency Injection | Pola desain: object menerima dependency dari luar |
| Autowiring | Mekanisme Spring untuk mencari dependency secara otomatis |
| Bean resolution | Proses memilih bean yang cocok untuk injection point |
| Dependency descriptor | Representasi internal Spring terhadap kebutuhan dependency |
| Injection point | Lokasi dependency diminta: constructor parameter, method parameter, field, factory method parameter |

Dependency injection bisa dilakukan manual:

```java
PaymentClient client = new HttpPaymentClient();
OrderService service = new OrderService(client);
```

Autowiring adalah ketika Spring menyelesaikan ini:

```java
@Service
public class OrderService {

    private final PaymentClient paymentClient;

    public OrderService(PaymentClient paymentClient) {
        this.paymentClient = paymentClient;
    }
}
```

Spring melihat constructor parameter `PaymentClient`, lalu bertanya:

```text
Adakah bean yang bisa memenuhi dependency bertipe PaymentClient?
```

Jika ada satu, ia dipakai.

Jika tidak ada, gagal.

Jika ada banyak, Spring masuk ke algoritma disambiguation.

---

## 3. Injection Point: Lokasi Dependency Diminta

Spring dapat melakukan injection pada beberapa bentuk.

### 3.1 Constructor Injection

```java
@Service
public class InvoiceService {

    private final InvoiceRepository invoiceRepository;
    private final Clock clock;

    public InvoiceService(InvoiceRepository invoiceRepository, Clock clock) {
        this.invoiceRepository = invoiceRepository;
        this.clock = clock;
    }
}
```

Ini bentuk yang paling disarankan untuk dependency wajib.

Alasannya:

1. dependency terlihat eksplisit;
2. object tidak bisa dibuat dalam keadaan invalid;
3. field bisa `final`;
4. mudah dites tanpa Spring;
5. circular dependency cepat terlihat;
6. cocok untuk domain/application service;
7. invariant object lebih jelas.

Spring modern tidak membutuhkan `@Autowired` jika hanya ada satu constructor.

```java
@Service
public class CustomerService {

    private final CustomerRepository repository;

    public CustomerService(CustomerRepository repository) {
        this.repository = repository;
    }
}
```

### 3.2 Setter Injection

```java
@Service
public class ReportService {

    private Exporter exporter;

    @Autowired
    public void setExporter(Exporter exporter) {
        this.exporter = exporter;
    }
}
```

Setter injection cocok untuk dependency opsional atau dependency yang memang ingin bisa diganti setelah object dibuat, tetapi jarang ideal untuk service inti.

Risikonya:

- object bisa sementara berada dalam kondisi belum lengkap;
- dependency tidak terlihat dari constructor;
- test bisa lupa mengisi dependency;
- mutability meningkat.

### 3.3 Field Injection

```java
@Service
public class BadOrderService {

    @Autowired
    private PaymentClient paymentClient;
}
```

Field injection populer karena pendek, tetapi buruk untuk core engineering.

Masalahnya:

1. dependency tersembunyi;
2. field tidak bisa `final`;
3. object sulit dibuat tanpa Spring;
4. test mendorong reflection/mock framework;
5. invariant constructor hilang;
6. dependency graph tidak terlihat dari API class;
7. circular dependency bisa tersamarkan.

Field injection masih bisa ditemukan pada legacy code, sample, atau test tertentu, tetapi untuk service produksi, constructor injection hampir selalu lebih defensible.

### 3.4 Method Injection

Spring bisa melakukan injection ke method arbitrary.

```java
@Component
public class BillingPipeline {

    private Validator validator;
    private Enricher enricher;

    @Autowired
    public void configure(Validator validator, Enricher enricher) {
        this.validator = validator;
        this.enricher = enricher;
    }
}
```

Ini jarang diperlukan. Ia dapat berguna untuk lifecycle/configuration tertentu, tetapi mudah membuat object state kurang jelas.

### 3.5 Factory Method Parameter Injection

```java
@Configuration(proxyBeanMethods = false)
class ClientConfiguration {

    @Bean
    PaymentClient paymentClient(HttpClient httpClient, PaymentProperties properties) {
        return new PaymentClient(httpClient, properties.baseUrl());
    }
}
```

Parameter `httpClient` dan `properties` juga injection point. Spring harus menyelesaikan dependency untuk memanggil factory method tersebut.

Ini sangat penting karena banyak auto-configuration Spring Boot bekerja lewat pola ini.

---

## 4. Dependency Descriptor: Cara Spring Melihat Kebutuhan Dependency

Ketika Spring melihat constructor parameter seperti ini:

```java
public OrderService(PaymentClient paymentClient) {
    this.paymentClient = paymentClient;
}
```

Spring tidak hanya menyimpan `PaymentClient.class`.

Ia membangun informasi seperti:

```text
required type       : PaymentClient
required?           : true
injection point     : constructor parameter 0
parameter name      : paymentClient
annotations         : []
generic context     : none
declaring class     : OrderService
fallback allowed?   : depends on context
lazy?               : false
```

Jika parameter seperti ini:

```java
public OrderService(@Qualifier("stripe") PaymentClient client) { }
```

Descriptor-nya berubah:

```text
required type       : PaymentClient
qualifier           : stripe
parameter name      : client
required?           : true
```

Jika seperti ini:

```java
public OrderService(Optional<PaymentClient> client) { }
```

Descriptor-nya berubah lagi:

```text
container type      : Optional
nested type         : PaymentClient
required?           : false-ish semantic
```

Jika seperti ini:

```java
public CompositeHandler(List<Handler<OrderCommand>> handlers) { }
```

Spring harus memahami generic type:

```text
collection type     : List
nested type         : Handler<OrderCommand>
multi-valued?       : true
ordering required?  : yes
```

Mental model penting:

> Spring tidak sekadar mencari class. Spring menyelesaikan dependency berdasarkan descriptor yang kaya konteks.

---

## 5. Algoritma Resolusi Dependency: Versi Mental Model

Secara konseptual, untuk single-valued dependency Spring melakukan langkah seperti ini:

```text
1. Baca injection point
2. Bentuk dependency descriptor
3. Tentukan required type
4. Cari semua bean yang type-compatible
5. Filter bean yang eligible sebagai autowire candidate
6. Terapkan qualifier
7. Terapkan primary/fallback/default candidate semantics
8. Pertimbangkan priority/order jika relevan
9. Pertimbangkan nama parameter/field sebagai bean name match
10. Jika tersisa satu kandidat, pilih
11. Jika tidak ada kandidat, gagal atau inject empty/optional tergantung descriptor
12. Jika masih banyak kandidat, gagal dengan ambiguity error
13. Resolve bean instance, mungkin membuat bean baru
14. Jika bean diproxy, inject proxy, bukan target raw object
```

Spring versi berbeda dapat memiliki detail prioritas yang berubah. Misalnya Spring Framework 6.2 merevisi sebagian algoritma autowiring: pada kandidat yang cocok by type, parameter name match dan `@Qualifier("...")` terhadap bean name diberi prioritas berbeda dibanding `@Priority` dibanding versi sebelumnya.

Karena itu, engineer yang kuat tidak hanya mengandalkan intuisi lama. Ia memeriksa dokumentasi versi Spring yang sedang dipakai saat menghadapi kasus ambiguous injection di proyek besar.

---

## 6. Resolusi Berdasarkan Type

Kasus paling sederhana:

```java
public interface PaymentClient {
    PaymentResult pay(PaymentRequest request);
}

@Component
class StripePaymentClient implements PaymentClient {
    // ...
}

@Service
class CheckoutService {

    private final PaymentClient paymentClient;

    CheckoutService(PaymentClient paymentClient) {
        this.paymentClient = paymentClient;
    }
}
```

Spring melihat dependency `PaymentClient`, lalu menemukan satu bean yang assignable ke `PaymentClient`: `stripePaymentClient`.

Maka injection berhasil.

```text
required type: PaymentClient
candidate    : stripePaymentClient
result       : selected
```

Jika ada dua:

```java
@Component
class StripePaymentClient implements PaymentClient { }

@Component
class PaypalPaymentClient implements PaymentClient { }
```

Injection ini ambiguous:

```java
CheckoutService(PaymentClient paymentClient) { }
```

Spring melihat:

```text
required type: PaymentClient
candidates   : stripePaymentClient, paypalPaymentClient
result       : ambiguity
```

Maka gagal dengan error mirip:

```text
No qualifying bean of type 'PaymentClient' available:
expected single matching bean but found 2: stripePaymentClient,paypalPaymentClient
```

Ini bukan bug Spring. Ini Spring menolak menebak keputusan arsitektur.

---

## 7. Bean Name dan Parameter Name

Setiap bean punya nama.

Default bean name dari component scanning biasanya lower camel case dari class:

```java
@Component
class StripePaymentClient implements PaymentClient { }
```

Bean name default:

```text
stripePaymentClient
```

Jika constructor parameter bernama sama:

```java
@Service
class CheckoutService {

    CheckoutService(PaymentClient stripePaymentClient) {
        // ...
    }
}
```

Spring bisa memakai parameter name sebagai sinyal resolusi jika metadata parameter tersedia.

Namun, menjadikan parameter name sebagai mekanisme utama disambiguation biasanya kurang eksplisit untuk sistem besar.

Lebih jelas menggunakan `@Qualifier` atau desain interface yang lebih spesifik.

Masalah parameter name:

1. membutuhkan metadata parameter saat compile;
2. bisa berubah saat refactor;
3. tidak terlihat sebagai contract arsitektural;
4. mudah membingungkan reviewer;
5. perilakunya dapat dipengaruhi versi Spring dan compiler option.

Gunakan parameter-name matching sebagai kemudahan, bukan fondasi desain.

---

## 8. `@Primary`: Default untuk Single-Valued Dependency

Jika ada banyak bean bertipe sama, `@Primary` dapat menentukan default.

```java
public interface PaymentClient { }

@Component
@Primary
class StripePaymentClient implements PaymentClient { }

@Component
class PaypalPaymentClient implements PaymentClient { }

@Service
class CheckoutService {

    CheckoutService(PaymentClient paymentClient) {
        // StripePaymentClient dipilih
    }
}
```

Mental model:

```text
PaymentClient candidates:
- stripePaymentClient  primary=true
- paypalPaymentClient  primary=false

single-valued injection → pilih primary tunggal
```

`@Primary` cocok ketika ada satu implementasi yang merupakan default platform/application.

Contoh masuk akal:

```java
@Component
@Primary
class DatabaseFeatureFlagProvider implements FeatureFlagProvider { }

@Component
class InMemoryFeatureFlagProvider implements FeatureFlagProvider { }
```

Tetapi `@Primary` bukan solusi bagus jika consumer berbeda harus memakai implementasi berbeda.

Contoh kurang baik:

```java
@Component
@Primary
class StripePaymentClient implements PaymentClient { }

@Component
class PaypalPaymentClient implements PaymentClient { }
```

Jika sebagian service harus Stripe dan sebagian harus PayPal, `@Primary` hanya menyembunyikan keputusan. Gunakan qualifier atau interface berbeda.

### 8.1 `@Primary` Tidak Mengurangi Collection Injection

```java
@Service
class PaymentRouter {

    PaymentRouter(List<PaymentClient> clients) {
        // semua PaymentClient masuk, bukan hanya primary
    }
}
```

`@Primary` membantu single-valued injection:

```java
PaymentClient client
```

Tetapi untuk multi-valued injection:

```java
List<PaymentClient> clients
Map<String, PaymentClient> clients
```

Spring mengumpulkan semua candidate yang eligible.

Jadi jangan mengira `@Primary` berarti “bean lain tidak dipakai”.

---

## 9. `@Fallback`: Candidate yang Dipakai Jika Tidak Ada Kandidat Normal

Spring modern menyediakan konsep fallback candidate.

Mental model:

```text
normal candidates ada     → fallback diabaikan
normal candidates tidak ada → fallback bisa dipakai
```

Contoh:

```java
public interface AuditSink {
    void write(AuditEvent event);
}

@Component
class DatabaseAuditSink implements AuditSink { }

@Component
@Fallback
class NoopAuditSink implements AuditSink { }
```

Jika `DatabaseAuditSink` ada, ia dipakai.

Jika dalam konfigurasi tertentu tidak ada audit sink normal, fallback bisa menjadi default aman.

`@Fallback` cocok untuk library/starter yang ingin menyediakan bean cadangan tanpa mengalahkan bean aplikasi.

Design guideline:

- `@Primary` berarti: “pakai saya sebagai default utama”.
- `@Fallback` berarti: “pakai saya hanya kalau tidak ada pilihan lebih spesifik”.
- `@ConditionalOnMissingBean` berarti: “daftarkan saya hanya kalau bean lain tidak ada”.

Ketiganya mirip dari sisi outcome tertentu, tetapi berbeda dari sisi lifecycle dan registration.

---

## 10. `@Qualifier`: Disambiguation Eksplisit

`@Qualifier` mempersempit kandidat.

```java
@Component("stripe")
class StripePaymentClient implements PaymentClient { }

@Component("paypal")
class PaypalPaymentClient implements PaymentClient { }

@Service
class CheckoutService {

    CheckoutService(@Qualifier("stripe") PaymentClient paymentClient) {
        this.paymentClient = paymentClient;
    }
}
```

Mental model:

```text
required type : PaymentClient
qualifier     : stripe
candidates    : stripe, paypal
filtered      : stripe
result        : stripe
```

`@Qualifier` lebih eksplisit daripada bergantung pada parameter name.

Namun `@Qualifier` berbasis string punya risiko:

- typo baru ketahuan saat runtime/startup;
- refactor class name tidak selalu refactor qualifier string;
- string tidak membawa semantic domain yang kuat.

### 10.1 Custom Qualifier Annotation

Untuk sistem besar, custom qualifier lebih kuat.

```java
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Qualifier
public @interface ExternalPayment {
}
```

Penggunaan:

```java
@Component
@ExternalPayment
class StripePaymentClient implements PaymentClient { }

@Service
class CheckoutService {

    CheckoutService(@ExternalPayment PaymentClient paymentClient) {
        this.paymentClient = paymentClient;
    }
}
```

Lebih baik lagi jika qualifier mencerminkan capability atau role, bukan vendor spesifik.

Kurang baik:

```java
@Stripe
PaymentClient client
```

Lebih fleksibel:

```java
@ExternalPayment
PaymentClient client
```

Karena vendor bisa berubah, role sistem biasanya lebih stabil.

### 10.2 Qualifier dengan Attribute

```java
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Qualifier
public @interface Region {
    String value();
}
```

```java
@Component
@Region("sg")
class SingaporeTaxCalculator implements TaxCalculator { }

@Component
@Region("id")
class IndonesiaTaxCalculator implements TaxCalculator { }
```

```java
@Service
class TaxService {

    TaxService(@Region("sg") TaxCalculator calculator) {
        this.calculator = calculator;
    }
}
```

Ini berguna untuk multi-region/multi-tenant/multi-policy system.

Tetapi hati-hati: terlalu banyak qualifier attribute dapat menjadi configuration language tersembunyi.

---

## 11. `@Order`, `Ordered`, dan `@Priority`

Untuk collection injection, urutan sering penting.

Contoh pipeline:

```java
public interface CaseRule {
    void apply(CaseContext context);
}

@Component
@Order(10)
class ValidateApplicantRule implements CaseRule { }

@Component
@Order(20)
class CheckEligibilityRule implements CaseRule { }

@Component
@Order(30)
class AssignOfficerRule implements CaseRule { }
```

```java
@Service
class CaseRulePipeline {

    private final List<CaseRule> rules;

    CaseRulePipeline(List<CaseRule> rules) {
        this.rules = rules;
    }
}
```

Spring akan menyediakan list dengan urutan berdasarkan ordering metadata.

Mental model:

```text
multi-valued dependency → collect candidates → sort candidates
```

Gunakan order untuk pipeline yang memang explicit.

Jangan gunakan order untuk menyembunyikan dependency antar service yang seharusnya dimodelkan lebih jelas.

Buruk:

```text
Service B harus jalan setelah Service A karena @Order(20), tapi tidak ada contract jelas.
```

Lebih baik:

```java
class CaseWorkflow {
    private final ValidateApplicantStep validate;
    private final CheckEligibilityStep eligibility;
    private final AssignOfficerStep assign;
}
```

Atau jika memang plugin pipeline:

```java
interface CaseRule {
    int phase();
    boolean supports(CaseContext context);
    void apply(CaseContext context);
}
```

---

## 12. Generic Type Resolution

Spring dependency resolution tidak hanya melihat raw class.

Ia bisa membaca generic type.

```java
public interface Handler<T> {
    void handle(T command);
}

@Component
class CreateOrderHandler implements Handler<CreateOrderCommand> { }

@Component
class CancelOrderHandler implements Handler<CancelOrderCommand> { }
```

Injection:

```java
@Service
class CreateOrderUseCase {

    CreateOrderUseCase(Handler<CreateOrderCommand> handler) {
        this.handler = handler;
    }
}
```

Spring dapat memilih `CreateOrderHandler` karena generic type cocok.

Mental model:

```text
required type: Handler<CreateOrderCommand>

candidate:
- Handler<CreateOrderCommand> → match
- Handler<CancelOrderCommand> → not match
```

Ini sangat berguna untuk strategy/pipeline/handler architecture.

Namun ada batas:

- type erasure tetap ada di Java;
- Spring memakai metadata yang tersedia dari class signature;
- anonymous/lambda/factory method kadang menghilangkan informasi generic;
- raw type merusak presisi.

Buruk:

```java
@Component
class RawHandler implements Handler {
    public void handle(Object command) { }
}
```

Lebih baik:

```java
@Component
class CreateOrderHandler implements Handler<CreateOrderCommand> { }
```

---

## 13. `Optional<T>`: Dependency Opsional yang Jelas

```java
@Service
class NotificationService {

    private final Optional<SmsClient> smsClient;

    NotificationService(Optional<SmsClient> smsClient) {
        this.smsClient = smsClient;
    }
}
```

Jika tidak ada `SmsClient`, injection tetap berhasil dengan `Optional.empty()`.

Ini cocok untuk dependency yang benar-benar opsional.

Namun jangan menjadikan semua dependency optional untuk menghindari startup failure.

Buruk:

```java
@Service
class PaymentService {

    PaymentService(Optional<PaymentGateway> gateway) {
        this.gateway = gateway;
    }

    void pay() {
        gateway.orElseThrow().pay();
    }
}
```

Jika service tidak bisa bekerja tanpa gateway, dependency harus required.

Optional dependency hanya masuk akal jika behavior tanpa dependency memang valid.

Contoh bagus:

```java
@Service
class AuditPublisher {

    private final Optional<AuditSink> auditSink;

    AuditPublisher(Optional<AuditSink> auditSink) {
        this.auditSink = auditSink;
    }

    void publish(AuditEvent event) {
        auditSink.ifPresent(sink -> sink.write(event));
    }
}
```

Tetapi untuk sistem regulated, bahkan audit noop pun harus diputuskan eksplisit. Jangan jadikan optional jika compliance membutuhkan audit wajib.

---

## 14. `ObjectProvider<T>`: Lazy, Optional, Iterable, dan On-Demand Lookup

`ObjectProvider<T>` adalah interface Spring untuk mendapatkan bean secara lazy dan fleksibel.

```java
@Service
class ReportService {

    private final ObjectProvider<Exporter> exporterProvider;

    ReportService(ObjectProvider<Exporter> exporterProvider) {
        this.exporterProvider = exporterProvider;
    }

    void export(Report report) {
        Exporter exporter = exporterProvider.getIfAvailable(DefaultExporter::new);
        exporter.export(report);
    }
}
```

Fungsi umum:

```java
provider.getObject();        // required, fail jika tidak ada
provider.getIfAvailable();   // null jika tidak ada
provider.ifAvailable(...);   // callback jika ada
provider.stream();           // semua candidate
provider.orderedStream();    // semua candidate terurut
```

Gunakan `ObjectProvider<T>` ketika:

1. dependency mahal dibuat dan hanya kadang dipakai;
2. dependency opsional tapi ingin default supplier;
3. ingin semua plugin secara lazy;
4. ingin menghindari eager initialization;
5. ingin memecah dependency cycle secara sadar;
6. sedang menulis auto-configuration/starter.

Namun jangan gunakan `ObjectProvider` untuk menyembunyikan desain buruk.

Buruk:

```java
@Service
class EverythingService {

    private final ObjectProvider<ApplicationContext> context;

    // mengambil bean apapun kapan saja
}
```

Itu service locator disguised as DI.

### 14.1 `ObjectProvider<T>` vs `Optional<T>`

| Kebutuhan | Pilihan |
|---|---|
| Dependency opsional dan langsung diketahui saat object dibuat | `Optional<T>` |
| Dependency opsional dan ingin diambil saat dibutuhkan | `ObjectProvider<T>` |
| Dependency mahal dan ingin lazy | `ObjectProvider<T>` |
| Ingin default supplier | `ObjectProvider<T>` |
| Ingin semua beans sebagai stream | `ObjectProvider<T>` |
| Ingin API class tetap framework-agnostic | `Optional<T>` lebih netral |

Untuk domain/application service inti, terlalu banyak `ObjectProvider` adalah bau desain. Untuk configuration/starter/infrastructure layer, `ObjectProvider` sangat berguna.

---

## 15. `@Lazy`: Lazy Dependency dan Lazy Proxy

`@Lazy` bisa digunakan pada bean atau injection point.

```java
@Component
@Lazy
class ExpensiveReportGenerator { }
```

Bean dibuat hanya saat dibutuhkan.

Pada injection point:

```java
@Service
class ReportController {

    private final ReportGenerator generator;

    ReportController(@Lazy ReportGenerator generator) {
        this.generator = generator;
    }
}
```

Spring dapat menginjeksi proxy lazy. Object target baru dibuat ketika method dipanggil.

Manfaat:

- mempercepat startup;
- menghindari eager creation dependency mahal;
- kadang membantu memecah cycle.

Risiko:

- error dependency muncul terlambat saat runtime;
- startup terlihat sukses padahal dependency rusak;
- latency call pertama meningkat;
- debugging lebih sulit;
- proxy behavior perlu dipahami.

Untuk production, lazy initialization global harus hati-hati. Startup failure yang cepat sering lebih baik daripada failure pertama di request user.

---

## 16. Collection Injection: Plugin dan Pipeline Model

Collection injection adalah salah satu fitur Spring paling kuat jika dipakai benar.

```java
public interface DocumentValidator {
    ValidationResult validate(Document document);
}

@Component
class FileSizeValidator implements DocumentValidator { }

@Component
class FileTypeValidator implements DocumentValidator { }

@Component
class MalwareScanValidator implements DocumentValidator { }
```

```java
@Service
class DocumentValidationService {

    private final List<DocumentValidator> validators;

    DocumentValidationService(List<DocumentValidator> validators) {
        this.validators = validators;
    }

    ValidationResult validate(Document document) {
        for (DocumentValidator validator : validators) {
            ValidationResult result = validator.validate(document);
            if (!result.ok()) {
                return result;
            }
        }
        return ValidationResult.ok();
    }
}
```

Ini bagus untuk:

- validators;
- enrichers;
- handlers;
- filters;
- policies;
- rule engines ringan;
- exporters;
- listeners;
- plugins internal.

Tapi collection injection juga bisa menjadi sumber chaos jika tidak ada contract.

Checklist collection injection yang sehat:

1. interface punya semantic tunggal;
2. urutan jelas jika order penting;
3. failure behavior jelas;
4. duplicate behavior dicegah;
5. observability per item ada jika pipeline penting;
6. item tidak saling bergantung implisit;
7. test mencakup kombinasi plugin.

---

## 17. Map Injection: Registry by Bean Name

Spring bisa menginjeksi map:

```java
@Service
class ExportService {

    private final Map<String, Exporter> exporters;

    ExportService(Map<String, Exporter> exporters) {
        this.exporters = exporters;
    }

    void export(String type, Report report) {
        Exporter exporter = exporters.get(type + "Exporter");
        if (exporter == null) {
            throw new UnsupportedExportTypeException(type);
        }
        exporter.export(report);
    }
}
```

Map key default adalah bean name.

Contoh:

```java
@Component("pdf")
class PdfExporter implements Exporter { }

@Component("xlsx")
class XlsxExporter implements Exporter { }
```

```java
@Service
class ExportService {

    ExportService(Map<String, Exporter> exporters) {
        this.exporters = exporters;
    }

    void export(String type, Report report) {
        Exporter exporter = exporters.get(type);
        if (exporter == null) {
            throw new UnsupportedExportTypeException(type);
        }
        exporter.export(report);
    }
}
```

Map injection cocok untuk strategy registry.

Namun jangan terlalu bergantung pada bean name sebagai external contract jika nama itu bisa berubah.

Lebih eksplisit:

```java
public interface Exporter {
    String type();
    void export(Report report);
}
```

```java
@Service
class ExportRegistry {

    private final Map<String, Exporter> byType;

    ExportRegistry(List<Exporter> exporters) {
        this.byType = exporters.stream()
                .collect(Collectors.toUnmodifiableMap(Exporter::type, Function.identity()));
    }
}
```

Dengan cara ini, key adalah contract domain, bukan nama bean Spring.

---

## 18. Constructor Resolution: Ketika Ada Banyak Constructor

Jika class punya satu constructor, Spring menggunakannya.

```java
@Service
class AccountService {

    AccountService(AccountRepository repository) { }
}
```

Jika ada beberapa constructor:

```java
@Service
class AccountService {

    AccountService(AccountRepository repository) { }

    AccountService(AccountRepository repository, AuditSink auditSink) { }
}
```

Spring harus memilih constructor.

Anda bisa menandai constructor:

```java
@Service
class AccountService {

    private final AccountRepository repository;
    private final AuditSink auditSink;

    @Autowired
    AccountService(AccountRepository repository, AuditSink auditSink) {
        this.repository = repository;
        this.auditSink = auditSink;
    }
}
```

Design guideline:

- untuk service produksi, usahakan satu constructor;
- jangan membuat constructor overload untuk optional dependency;
- pakai `Optional<T>` atau `ObjectProvider<T>` jika memang opsional;
- hindari constructor default kosong hanya untuk framework lama/test.

Buruk:

```java
@Service
class LegacyService {

    public LegacyService() {
        // for framework
    }

    public LegacyService(Repository repository) {
        this.repository = repository;
    }
}
```

Ini membuka kemungkinan object invalid.

---

## 19. Required vs Optional Dependency

Secara default, dependency yang diminta constructor adalah required.

```java
@Service
class OrderService {

    OrderService(PaymentClient paymentClient) { }
}
```

Jika tidak ada `PaymentClient`, startup gagal.

Ini bagus.

Aplikasi sebaiknya gagal start jika dependency wajib hilang.

Opsional dapat dimodelkan dengan:

```java
Optional<PaymentClient>
ObjectProvider<PaymentClient>
@Nullable PaymentClient
@Autowired(required = false)
```

Namun pilihan ini tidak setara.

| Bentuk | Catatan |
|---|---|
| `Optional<T>` | jelas, cocok untuk constructor, dependency opsional eksplisit |
| `ObjectProvider<T>` | lazy/on-demand, cocok untuk infrastructure/configuration |
| `@Nullable T` | ringkas, tetapi mudah terlewat |
| `@Autowired(required=false)` | lebih legacy, kurang ideal untuk constructor modern |

Untuk kode enterprise, `Optional<T>` dan `ObjectProvider<T>` biasanya lebih terbaca daripada null.

---

## 20. Circular Dependency: Gejala Desain dan Mekanisme Container

Circular dependency terjadi ketika bean saling membutuhkan.

```java
@Service
class A {
    A(B b) { }
}

@Service
class B {
    B(A a) { }
}
```

Graph:

```text
A → B → A
```

Dengan constructor injection, ini gagal jelas.

Itu biasanya baik.

Kenapa?

Karena siklus dependency sering berarti desain boundary salah.

Contoh domain buruk:

```text
OrderService → InvoiceService → OrderService
```

Mungkin seharusnya ada service ketiga:

```text
OrderApplicationService
    → OrderService
    → InvoiceService
```

Atau event:

```text
OrderService publishes OrderConfirmedEvent
InvoiceListener creates invoice
```

### 20.1 Setter/Field Circular Dependency

Spring historically bisa menyelesaikan sebagian circular dependency setter/field dengan early singleton exposure.

Tetapi ini menghasilkan object yang belum sepenuhnya initialized dan rentan terhadap proxy/lifecycle problem.

Jangan desain sistem yang bergantung pada kemampuan ini.

### 20.2 Memecah Cycle dengan Lazy atau Provider

Kadang cycle terjadi di infrastructure dan bisa dipecah:

```java
@Service
class A {
    A(ObjectProvider<B> bProvider) { }
}
```

Atau:

```java
@Service
class A {
    A(@Lazy B b) { }
}
```

Namun ini harus dianggap workaround sadar, bukan default.

Checklist saat menemukan cycle:

1. Apakah dua service sebenarnya berada di module yang sama?
2. Apakah salah satunya orchestration service?
3. Apakah ada domain event yang lebih tepat?
4. Apakah salah satu dependency hanya butuh interface kecil?
5. Apakah dependency arah seharusnya dibalik?
6. Apakah ada shared utility yang salah ditempatkan?
7. Apakah cycle muncul karena transaction/security proxy?

---

## 21. Proxy dan Dependency Injection: Yang Diinjeksi Bisa Bukan Object Asli

Spring sering menginjeksi proxy.

Contoh:

```java
@Service
class PaymentService {

    @Transactional
    public void pay() { }
}
```

Bean yang masuk ke consumer mungkin bukan instance raw `PaymentService`, tetapi proxy yang membungkus `PaymentService`.

```text
CheckoutService
    ↓
PaymentService proxy
    ↓
PaymentService target
```

Proxy diperlukan agar annotation seperti ini bekerja:

- `@Transactional`
- `@Async`
- `@Cacheable`
- method security
- AOP custom

Implikasi injection:

1. type proxy harus kompatibel;
2. interface-based proxy bisa membatasi type yang terlihat;
3. final class/method bisa bermasalah pada class proxy;
4. self-invocation melewati proxy;
5. injection by concrete class bisa gagal jika proxy berbasis interface.

### 21.1 Interface Proxy vs Class Proxy

Jika Spring memakai JDK dynamic proxy:

```text
proxy implements PaymentOperations
```

Consumer yang meminta interface berhasil:

```java
PaymentOperations payment
```

Consumer yang meminta concrete class bisa gagal:

```java
PaymentService payment
```

Class-based proxy lebih fleksibel untuk concrete type, tetapi punya batas dengan final class/method.

Design guideline:

- injeksikan interface untuk role bisnis/infrastructure yang stabil;
- jangan injeksikan concrete class hanya karena mudah;
- pahami proxy mode jika memakai AOP berat.

---

## 22. Self-Invocation: Dependency Benar, Behavior Salah

Masalah klasik:

```java
@Service
class BillingService {

    public void checkout() {
        charge();
    }

    @Transactional
    public void charge() {
        // expected transaction
    }
}
```

Call `checkout()` ke `charge()` terjadi dalam object yang sama.

```text
external caller → proxy → checkout() target
                         ↓
                      charge() target directly
```

Method `charge()` tidak melewati proxy.

Akibatnya `@Transactional` tidak aktif.

Ini bukan masalah dependency resolution secara langsung, tetapi sangat terkait dengan apa yang diinjeksi.

Solusi yang lebih sehat:

```java
@Service
class BillingApplicationService {

    private final ChargeService chargeService;

    BillingApplicationService(ChargeService chargeService) {
        this.chargeService = chargeService;
    }

    public void checkout() {
        chargeService.charge();
    }
}

@Service
class ChargeService {

    @Transactional
    public void charge() { }
}
```

Boundary transaksi menjadi eksplisit.

---

## 23. Dependency Injection dan Module Boundary

Dalam sistem besar, DI bukan hanya teknis. Ia adalah peta coupling.

Buruk:

```java
@Service
class AppealService {
    AppealService(
        UserRepository userRepository,
        CaseRepository caseRepository,
        PaymentRepository paymentRepository,
        EmailRepository emailRepository,
        AuditRepository auditRepository,
        TemplateRepository templateRepository,
        NotificationClient notificationClient,
        ReportGenerator reportGenerator
    ) { }
}
```

Constructor seperti ini memberi sinyal:

```text
AppealService terlalu banyak tahu.
```

Kemungkinan masalah:

- service menjadi god service;
- module boundary bocor;
- transaction boundary tidak jelas;
- test sulit;
- perubahan satu module memengaruhi banyak service;
- dependency graph rapuh.

Lebih baik pecah berdasarkan role:

```java
@Service
class AppealApplicationService {

    private final AppealRepository appeals;
    private final CaseAccessPolicy caseAccessPolicy;
    private final AppealDecisionWorkflow decisionWorkflow;
    private final AppealNotificationPort notificationPort;
    private final AuditPort auditPort;
}
```

Dependency lebih semantic.

Rule praktis:

> Constructor adalah architectural confession. Jika constructor terlalu ramai, desain sedang berbicara.

---

## 24. Interface Design untuk Dependency Injection

Tidak semua dependency perlu interface.

Tetapi interface berguna ketika ada:

1. lebih dari satu implementasi;
2. boundary antar module;
3. external system port;
4. testing replacement yang meaningful;
5. proxy-based behavior yang lebih stabil via interface;
6. policy/strategy/plugin.

Interface yang baik menggambarkan role:

```java
public interface PaymentPort {
    PaymentResult authorize(PaymentCommand command);
}
```

Interface yang buruk hanya mirror class:

```java
public interface PaymentServiceInterface {
    void method1();
    void method2();
}
```

Jika hanya ada satu service internal dan tidak ada boundary, class langsung juga tidak masalah.

```java
@Service
class PricingCalculator { }

@Service
class CheckoutService {
    CheckoutService(PricingCalculator pricingCalculator) { }
}
```

Jangan membuat interface palsu hanya untuk “best practice”.

---

## 25. Bean Ambiguity sebagai Sinyal Desain

Ketika Spring berkata:

```text
expected single matching bean but found 3
```

Jangan langsung tambahkan `@Primary`.

Tanya dulu:

1. Apakah consumer sebenarnya butuh satu implementasi spesifik?
2. Apakah consumer seharusnya menerima list/registry?
3. Apakah interface terlalu generik?
4. Apakah module boundary salah?
5. Apakah ada bean test yang bocor ke production context?
6. Apakah auto-configuration menambahkan bean yang tidak disadari?
7. Apakah perlu custom qualifier?
8. Apakah dependency seharusnya capability-specific?

Contoh interface terlalu generik:

```java
interface Processor {
    void process(Object input);
}
```

Lebih baik:

```java
interface AppealSubmissionProcessor { }
interface RenewalApplicationProcessor { }
interface EnforcementCaseProcessor { }
```

Atau generic handler dengan type parameter:

```java
interface CommandHandler<C extends Command> {
    void handle(C command);
}
```

---

## 26. Dependency Injection di `@Configuration` dan Auto-Configuration

Banyak dependency resolution terjadi bukan di service, tetapi di configuration.

```java
@Configuration(proxyBeanMethods = false)
class PaymentConfiguration {

    @Bean
    PaymentClient paymentClient(HttpClient httpClient, PaymentProperties properties) {
        return new PaymentClient(httpClient, properties.baseUrl());
    }
}
```

Factory method parameter harus di-resolve.

Jika `HttpClient` ambiguous, bean `paymentClient` gagal dibuat.

Auto-configuration sering memakai optional/lazy provider:

```java
@Bean
PaymentClient paymentClient(
        ObjectProvider<PaymentCustomizer> customizers,
        PaymentProperties properties
) {
    PaymentClient client = new PaymentClient(properties.baseUrl());
    customizers.orderedStream().forEach(customizer -> customizer.customize(client));
    return client;
}
```

Ini pattern umum untuk starter:

```text
starter menyediakan default
aplikasi bisa menambahkan customizer
Spring mengumpulkan semua customizer
starter menerapkan sesuai order
```

Pattern ini jauh lebih baik daripada starter memaksa semua konfigurasi lewat subclass atau global static.

---

## 27. Conditional Beans dan Dependency Resolution

Auto-configuration sering memakai condition.

Contoh konseptual:

```java
@Bean
@ConditionalOnMissingBean
PaymentClient paymentClient() {
    return new DefaultPaymentClient();
}
```

Maknanya:

```text
jika aplikasi sudah punya PaymentClient, jangan daftarkan default
```

Ini berbeda dari `@Fallback`.

- `@ConditionalOnMissingBean`: bean fallback bahkan tidak didaftarkan jika ada bean lain.
- `@Fallback`: bean didaftarkan, tetapi kalah saat resolusi jika ada kandidat normal.

Implikasi:

| Mekanisme | Efek |
|---|---|
| `@ConditionalOnMissingBean` | mengontrol registration |
| `@Primary` | mengontrol selection |
| `@Fallback` | mengontrol selection |
| `@Qualifier` | mengontrol matching/filtering |

Memahami perbedaan ini penting untuk menulis starter yang bisa di-override.

---

## 28. Test Context dan Dependency Replacement

Dalam test, dependency resolution sering berubah.

Contoh:

```java
@SpringBootTest
class CheckoutServiceTest {

    @MockBean
    PaymentClient paymentClient;
}
```

Mock bean mengganti atau menambahkan bean dalam context.

Risiko:

1. test pass karena dependency diganti mock;
2. production context gagal karena ambiguous;
3. test slice tidak memuat auto-configuration yang sama;
4. test profile mengubah bean candidate;
5. mock bean terlalu broad dan menutupi wiring bug.

Testing guideline:

- gunakan unit test tanpa Spring untuk domain/application logic murni;
- gunakan slice test untuk boundary;
- gunakan full context test terbatas untuk wiring critical;
- sediakan test khusus untuk memastikan context production bisa start;
- jangan menjadikan mock sebagai cara menutupi dependency graph buruk.

---

## 29. Dependency Resolution Failure Model

### 29.1 No Bean Found

```text
No qualifying bean of type 'X' available
```

Kemungkinan:

1. class belum menjadi bean;
2. component scan tidak mencakup package;
3. bean condition tidak match;
4. profile salah;
5. dependency optional seharusnya required atau sebaliknya;
6. starter tidak aktif;
7. module tidak ada di classpath;
8. generic type tidak cocok;
9. bean dibuat di parent/child context yang berbeda.

Checklist:

```text
Apakah bean definition ada?
Apakah context yang benar memuat bean?
Apakah condition/profiles aktif?
Apakah type yang diminta sama dengan type bean?
Apakah proxy mengubah exposed type?
```

### 29.2 Multiple Beans Found

```text
expected single matching bean but found 2
```

Kemungkinan:

1. interface terlalu umum;
2. ada bean default dari auto-config;
3. ada bean test/config tambahan;
4. duplicate component scan;
5. `@Bean` dan `@Component` mendaftarkan hal yang sama;
6. perlu qualifier;
7. perlu collection injection;
8. perlu `@Primary` untuk default yang benar.

### 29.3 Circular Dependency

```text
The dependencies of some of the beans in the application context form a cycle
```

Kemungkinan:

1. service boundary salah;
2. orchestration dicampur dengan domain service;
3. event lebih tepat;
4. dependency hanya dibutuhkan lazy;
5. utility/common module disalahgunakan;
6. transaction boundary salah.

### 29.4 Bean Currently in Creation

```text
BeanCurrentlyInCreationException
```

Biasanya terkait cycle atau premature access saat lifecycle.

### 29.5 Proxy Type Mismatch

```text
Bean named 'x' is expected to be of type 'ConcreteClass' but was actually of type 'jdk.proxy...'
```

Kemungkinan:

1. consumer meminta concrete class;
2. bean diproxy berbasis interface;
3. configuration proxy mode berbeda;
4. AOP/security/transaction membuat proxy.

Solusi sering: injeksikan interface atau atur proxy mode dengan sadar.

---

## 30. Design Heuristics untuk Top-Tier Spring Engineer

### 30.1 Constructor Injection sebagai Default

Gunakan constructor injection untuk dependency wajib.

```java
@Service
class GoodService {

    private final PortA portA;
    private final PortB portB;

    GoodService(PortA portA, PortB portB) {
        this.portA = portA;
        this.portB = portB;
    }
}
```

### 30.2 Hindari Field Injection di Production Service

Field injection menyembunyikan dependency dan membuat object invalid mudah terjadi.

### 30.3 Jangan Terlalu Cepat Memakai `@Primary`

`@Primary` adalah global default, bukan context-specific decision.

Jika tiap consumer butuh implementasi berbeda, pakai qualifier atau interface berbeda.

### 30.4 Gunakan Qualifier untuk Role, Bukan Vendor Jika Bisa

Kurang fleksibel:

```java
@Stripe PaymentClient client
```

Lebih semantic:

```java
@ExternalPayment PaymentPort paymentPort
```

### 30.5 Gunakan Collection Injection untuk Plugin, Bukan Dependency Acak

Baik:

```java
List<DocumentValidator> validators
```

Buruk:

```java
List<Service> services
```

### 30.6 Jadikan Ambiguity sebagai Feedback Desain

Ambiguity bukan selalu masalah konfigurasi. Sering kali ia memberi tahu bahwa abstraction terlalu kabur.

### 30.7 Gunakan `ObjectProvider` di Infrastructure Layer

Bagus untuk starter, auto-config, optional customizers.

Kurang bagus untuk domain service inti.

### 30.8 Jangan Menyembunyikan Cycle

Cycle harus dianalisis, bukan langsung dilazy-kan.

### 30.9 Dependency Graph Adalah Architecture Graph

Review constructor dependencies seperti review architecture diagram.

Jika service import terlalu banyak module, masalahnya bukan Spring.

### 30.10 Pahami Proxy Sebelum Percaya Annotation

Banyak annotation Spring bekerja karena proxy.

Kalau call tidak lewat proxy, behavior tidak aktif.

---

## 31. Pattern: Strategy Registry dengan Spring

Contoh production-grade sederhana.

```java
public interface NotificationChannel {
    String channel();
    void send(NotificationCommand command);
}
```

```java
@Component
class EmailNotificationChannel implements NotificationChannel {

    @Override
    public String channel() {
        return "email";
    }

    @Override
    public void send(NotificationCommand command) {
        // send email
    }
}
```

```java
@Component
class SmsNotificationChannel implements NotificationChannel {

    @Override
    public String channel() {
        return "sms";
    }

    @Override
    public void send(NotificationCommand command) {
        // send sms
    }
}
```

```java
@Service
class NotificationChannelRegistry {

    private final Map<String, NotificationChannel> byChannel;

    NotificationChannelRegistry(List<NotificationChannel> channels) {
        this.byChannel = channels.stream()
                .collect(Collectors.toUnmodifiableMap(
                        NotificationChannel::channel,
                        Function.identity(),
                        (a, b) -> {
                            throw new IllegalStateException(
                                    "Duplicate notification channel: " + a.channel());
                        }
                ));
    }

    NotificationChannel get(String channel) {
        NotificationChannel result = byChannel.get(channel);
        if (result == null) {
            throw new UnsupportedNotificationChannelException(channel);
        }
        return result;
    }
}
```

Kenapa lebih baik daripada langsung `Map<String, NotificationChannel>`?

Karena registry bisa:

1. memvalidasi duplicate channel;
2. memakai domain key, bukan bean name;
3. memberi error yang jelas;
4. menambahkan metrics/logging;
5. menjadi boundary yang bisa dites.

---

## 32. Pattern: Customizer untuk Internal Starter

Misal platform ingin menyediakan `CaseHttpClient` default, tapi aplikasi bisa menambahkan custom behavior.

```java
public interface CaseHttpClientCustomizer {
    void customize(CaseHttpClientBuilder builder);
}
```

Auto-configuration:

```java
@Configuration(proxyBeanMethods = false)
class CaseHttpClientAutoConfiguration {

    @Bean
    CaseHttpClient caseHttpClient(
            CaseHttpClientProperties properties,
            ObjectProvider<CaseHttpClientCustomizer> customizers
    ) {
        CaseHttpClientBuilder builder = new CaseHttpClientBuilder()
                .baseUrl(properties.baseUrl())
                .connectTimeout(properties.connectTimeout())
                .readTimeout(properties.readTimeout());

        customizers.orderedStream()
                .forEach(customizer -> customizer.customize(builder));

        return builder.build();
    }
}
```

Aplikasi:

```java
@Bean
@Order(10)
CaseHttpClientCustomizer correlationIdCustomizer(CorrelationIdProvider provider) {
    return builder -> builder.addInterceptor(request -> {
        request.header("X-Correlation-Id", provider.currentId());
    });
}
```

Ini pattern penting untuk platform engineering:

```text
auto-config menyediakan default
aplikasi menyumbang customizer
container mengumpulkan semua customizer
order mengontrol urutan
starter tetap extensible
```

---

## 33. Pattern: Port and Adapter dengan Spring DI

Domain/application layer:

```java
public interface CaseDocumentStoragePort {
    StoredDocument store(StoreDocumentCommand command);
    DocumentContent load(DocumentId id);
}
```

Adapter S3:

```java
@Component
@Profile("aws")
class S3CaseDocumentStorageAdapter implements CaseDocumentStoragePort {
    // ...
}
```

Adapter local:

```java
@Component
@Profile("local")
class LocalCaseDocumentStorageAdapter implements CaseDocumentStoragePort {
    // ...
}
```

Consumer:

```java
@Service
class CaseDocumentService {

    private final CaseDocumentStoragePort storage;

    CaseDocumentService(CaseDocumentStoragePort storage) {
        this.storage = storage;
    }
}
```

Jika profile salah dan dua adapter aktif, startup gagal karena ambiguous.

Itu bagus.

Karena konfigurasi environment salah harus diketahui saat startup, bukan setelah document hilang.

---

## 34. Anti-Pattern: ApplicationContext sebagai Service Locator

```java
@Service
class DynamicService {

    private final ApplicationContext context;

    DynamicService(ApplicationContext context) {
        this.context = context;
    }

    void execute(String type) {
        Processor processor = context.getBean(type + "Processor", Processor.class);
        processor.process();
    }
}
```

Masalah:

1. dependency tersembunyi;
2. startup tidak memvalidasi graph;
3. typo baru muncul runtime;
4. test sulit;
5. module boundary hilang;
6. logic bergantung pada bean name;
7. Spring menjadi global registry.

Lebih baik:

```java
@Service
class ProcessorRegistry {

    private final Map<String, Processor> processors;

    ProcessorRegistry(List<Processor> processors) {
        this.processors = processors.stream()
                .collect(Collectors.toUnmodifiableMap(Processor::type, Function.identity()));
    }
}
```

ApplicationContext boleh digunakan di infrastructure/framework layer, tetapi hindari di application/domain service.

---

## 35. Anti-Pattern: Dependency Injection untuk Semua Hal

Tidak semua object harus bean.

Value object:

```java
public record Money(BigDecimal amount, Currency currency) { }
```

Entity/domain object:

```java
public class Order {
    private OrderStatus status;
}
```

Command/DTO:

```java
public record SubmitApplicationCommand(String applicantId, String licenseType) { }
```

Object seperti ini tidak perlu menjadi Spring bean.

Spring bean cocok untuk:

- service singleton;
- repository adapter;
- external client;
- configuration object;
- handler/strategy/policy;
- lifecycle-managed resource;
- infrastructure component.

Jangan menjadikan domain model sebagai Spring-managed object tanpa alasan kuat.

---

## 36. Dependency Injection dan Java 8–25

### 36.1 Java 8 Era

Pada Java 8/Spring 4/5 legacy:

- parameter name metadata tidak selalu tersedia;
- `javax.*` masih dominan;
- field injection dan XML config banyak ditemukan;
- proxy issue sering muncul dengan older configuration;
- optional injection sudah ada tetapi style bervariasi.

### 36.2 Java 11–17 Transition

Pada era transisi:

- constructor injection semakin dominan;
- Spring Boot 2 ke 3 membawa `jakarta.*` migration;
- Java module system kadang memengaruhi reflection;
- build harus menyimpan parameter metadata jika ingin parameter-name resolution kuat.

### 36.3 Java 21–25 Modern Spring

Pada modern Spring:

- record dipakai untuk config properties/DTO;
- virtual threads mengubah execution model tetapi bukan DI model;
- AOT/native image membuat reflection/proxy metadata lebih penting;
- null-safety dan type metadata makin diperhatikan;
- Spring Boot 4/Spring Framework 7 memperkuat baseline modern.

Dependency injection tetap konsep yang sama, tetapi constraint runtime berubah.

AOT/native misalnya membuat dynamic lookup/reflection yang liar menjadi lebih mahal secara desain.

---

## 37. Practical Debugging Workflow

Saat dependency injection gagal, jangan langsung trial-and-error annotation.

Gunakan workflow:

```text
1. Identifikasi injection point yang gagal
2. Catat required type dan qualifier
3. Cari semua bean candidate dari type itu
4. Periksa profile/condition
5. Periksa primary/fallback/qualifier/order/name
6. Periksa generic type
7. Periksa proxy type
8. Periksa parent-child context
9. Periksa test vs production context
10. Baru tentukan solusi desain
```

Pertanyaan kunci:

```text
Apakah harus ada tepat satu bean?
Apakah sebenarnya butuh banyak bean?
Apakah abstraction terlalu generic?
Apakah default global masuk akal?
Apakah consumer harus lebih eksplisit?
Apakah module boundary bocor?
Apakah auto-config mendaftarkan bean tak terduga?
```

---

## 38. Mini Lab: Membaca Hasil Resolusi

Bayangkan kode berikut:

```java
interface CasePolicy { }

@Component
class DefaultCasePolicy implements CasePolicy { }

@Component
@Primary
class StrictCasePolicy implements CasePolicy { }

@Component
class ExperimentalCasePolicy implements CasePolicy { }
```

Injection:

```java
CaseService(CasePolicy policy) { }
```

Hasil:

```text
StrictCasePolicy
```

Karena single-valued dependency memilih primary tunggal.

Injection:

```java
CasePipeline(List<CasePolicy> policies) { }
```

Hasil:

```text
DefaultCasePolicy
StrictCasePolicy
ExperimentalCasePolicy
```

Semua candidate masuk. `@Primary` tidak memfilter collection.

Injection:

```java
CaseService(@Qualifier("defaultCasePolicy") CasePolicy policy) { }
```

Hasil:

```text
DefaultCasePolicy
```

Qualifier mempersempit kandidat.

---

## 39. Checklist Desain Dependency Graph

Gunakan checklist ini saat review code Spring:

```text
[ ] Apakah semua dependency wajib memakai constructor injection?
[ ] Apakah field injection dihindari pada production service?
[ ] Apakah interface benar-benar merepresentasikan role/boundary?
[ ] Apakah ambiguity diselesaikan dengan desain, bukan asal @Primary?
[ ] Apakah qualifier punya makna domain/infrastructure yang stabil?
[ ] Apakah collection injection punya ordering/failure contract?
[ ] Apakah map injection tidak bergantung buta pada bean name?
[ ] Apakah optional dependency benar-benar optional?
[ ] Apakah ObjectProvider hanya dipakai saat lazy/optional/on-demand memang perlu?
[ ] Apakah circular dependency dianalisis sebagai design smell?
[ ] Apakah proxy behavior dipahami untuk transactional/security/cache/async?
[ ] Apakah test context tidak menyembunyikan wiring issue?
[ ] Apakah auto-config default bisa di-override dengan jelas?
[ ] Apakah constructor terlalu besar dan memberi sinyal god service?
[ ] Apakah dependency graph sesuai module boundary?
```

---

## 40. Ringkasan Mental Model

Dependency injection di Spring bukan magic. Ia adalah algoritma resolusi dependency berdasarkan descriptor.

Ringkasan:

```text
Injection point → DependencyDescriptor → Candidate discovery → Candidate filtering → Disambiguation → Bean instance/proxy → Injection
```

Prinsip utama:

1. Type adalah filter pertama, bukan satu-satunya.
2. Qualifier mempersempit kandidat secara eksplisit.
3. Primary memilih default untuk single-valued injection.
4. Fallback menyediakan candidate cadangan.
5. Collection injection mengambil banyak candidate.
6. Order mengatur urutan, bukan memilih satu bean.
7. Optional dependency harus benar-benar optional.
8. ObjectProvider berguna untuk lazy/on-demand/infrastructure, tetapi bisa menjadi service locator terselubung.
9. Constructor injection memperlihatkan architecture graph.
10. Ambiguity dan circular dependency sering lebih penting sebagai sinyal desain daripada sebagai error teknis.
11. Proxy membuat dependency yang diinjeksi bisa berbeda dari object asli.
12. Banyak annotation Spring bekerja hanya jika call melewati proxy.

Top-tier Spring engineer tidak hanya tahu cara menambahkan `@Autowired`, `@Qualifier`, atau `@Primary`.

Ia tahu kapan annotation itu menunjukkan desain yang benar, dan kapan annotation itu hanya menutupi desain yang kabur.

---

## 41. Latihan Pemahaman

Jawab tanpa menjalankan kode.

### Latihan 1

Ada tiga bean `PaymentClient`: `stripe`, `paypal`, `mockPaymentClient`. Satu diberi `@Primary`. Apa yang terjadi jika consumer meminta `List<PaymentClient>`?

### Latihan 2

Sebuah service memakai `@Transactional` pada method private. Apakah transaksi aktif?

### Latihan 3

Sebuah class punya constructor dengan 11 dependency. Apakah solusinya memakai field injection agar constructor pendek?

### Latihan 4

Kapan `ObjectProvider<T>` lebih tepat daripada `Optional<T>`?

### Latihan 5

Kenapa custom qualifier annotation lebih baik daripada string qualifier pada sistem besar?

### Latihan 6

Jika Spring gagal karena circular dependency `A → B → A`, sebutkan minimal tiga kemungkinan redesign.

### Latihan 7

Kenapa injecting concrete class dapat gagal saat bean diproxy dengan JDK dynamic proxy?

---

## 42. Jawaban Singkat Latihan

### Jawaban 1

Semua `PaymentClient` eligible masuk ke list. `@Primary` tidak memfilter collection injection.

### Jawaban 2

Tidak. Method private tidak bisa menjadi boundary proxy Spring AOP biasa. Selain itu self-invocation/internal call tidak melewati proxy.

### Jawaban 3

Tidak. Constructor besar adalah sinyal desain. Pecah service, buat role interface, pisahkan orchestration, atau perbaiki module boundary.

### Jawaban 4

Ketika dependency ingin diambil lazy/on-demand, ingin default supplier, ingin stream semua candidate, atau sedang menulis infrastructure/auto-configuration.

### Jawaban 5

Karena custom qualifier lebih semantic, lebih mudah direview, lebih aman dari typo string, dan dapat membawa attribute yang meaningful.

### Jawaban 6

Pecah orchestration service, gunakan domain/application event, balik arah dependency melalui port/interface, gabungkan module jika memang satu konsep, atau gunakan lazy/provider hanya jika dependency benar-benar runtime-optional.

### Jawaban 7

JDK dynamic proxy hanya mengimplementasikan interface. Jika consumer meminta concrete class, proxy mungkin tidak assignable ke concrete class tersebut.

---

## 43. Koneksi ke Part Berikutnya

Part ini membahas bagaimana dependency dipilih.

Part berikutnya akan membahas apa yang terjadi setelah bean dipilih dan dibuat:

```text
03-bean-lifecycle-extension-points.md
```

Kita akan masuk ke:

- instantiation;
- property population;
- aware callbacks;
- bean post processors;
- initialization;
- destruction;
- `SmartLifecycle`;
- `BeanFactoryPostProcessor`;
- `BeanDefinitionRegistryPostProcessor`;
- bagaimana Spring library dan starter menyisipkan behavior ke container.

Jika Part 2 membuat Anda memahami **siapa dependency yang dipilih**, Part 3 akan membuat Anda memahami **kapan dan bagaimana dependency itu hidup**.

---

## 44. Referensi Resmi untuk Pendalaman

Gunakan dokumentasi sesuai versi Spring yang dipakai proyek Anda.

- Spring Framework Reference — Core Technologies — Beans
- Spring Framework Reference — Annotation-based Container Configuration
- Spring Framework Reference — `@Autowired`
- Spring Framework Reference — Qualifiers
- Spring Framework Reference — `@Primary` dan `@Fallback`
- Spring Framework Reference — Validation, Data Binding, Type Conversion
- Spring Framework Reference — AOP APIs and Proxying
- Spring Boot Reference — Features — Auto-configuration
- Spring Boot Reference — Testing

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./01-ioc-container-beandefinition-beanfactory-applicationcontext.md">⬅️ Part 1 — IoC Container Deep Dive: `BeanDefinition`, `BeanFactory`, and `ApplicationContext`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./03-bean-lifecycle-extension-points.md">Bean Lifecycle and Extension Points ➡️</a>
</div>
