# Part 4 — Annotation Metadata and Component Scanning Internals

Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
File: `04-annotation-metadata-component-scanning-internals.md`  
Target pembaca: engineer Java/Spring advanced yang ingin memahami Spring sebagai runtime, bukan sekadar kumpulan annotation.  
Rentang versi: Java 8 sampai Java 25, Spring Framework 5.x sampai 7.x, Spring Boot 2.x sampai 4.x.

---

## 1. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. Spring sebagai runtime dan container.
2. `BeanDefinition`, `BeanFactory`, `ApplicationContext`.
3. Dependency injection resolution algorithm.
4. Bean lifecycle dan extension points.

Part ini masuk ke pertanyaan yang lebih spesifik:

> Bagaimana Spring menemukan class, membaca annotation, memahami annotation yang dibuat di atas annotation lain, lalu mengubah metadata itu menjadi `BeanDefinition` dan behavior runtime?

Ini penting karena banyak engineer memakai annotation Spring seperti formula:

```java
@Service
@Transactional
public class OrderService { }
```

Tetapi engineer yang benar-benar menguasai Spring harus bisa menjawab:

1. Kapan class ini ditemukan?
2. Siapa yang membaca `@Service`?
3. Apakah class langsung di-load oleh JVM saat scanning?
4. Apakah annotation pada interface akan terbaca?
5. Apakah composed annotation seperti `@UseCase` bisa menggantikan `@Service`?
6. Bagaimana `@AliasFor` memengaruhi attribute annotation?
7. Bagaimana Spring membedakan candidate component dan non-candidate?
8. Kenapa custom stereotype kadang tidak menghasilkan bean name sesuai ekspektasi?
9. Kenapa annotation di method tidak bekerja ketika method dipanggil dari method lain dalam class yang sama?
10. Bagaimana membuat annotation platform internal tanpa menciptakan hidden magic?

Tujuan part ini adalah membuat Anda mampu berpikir seperti orang yang membangun framework di atas Spring.

---

## 2. Core Mental Model

Spring annotation model dapat dipahami dengan pipeline berikut:

```text
classpath/resource
        |
        v
class metadata reading
        |
        v
annotation metadata extraction
        |
        v
merged annotation model
        |
        v
component candidate decision
        |
        v
bean definition creation
        |
        v
bean name/scope/qualifier/lazy/primary metadata applied
        |
        v
bean registered in BeanDefinitionRegistry
        |
        v
container later creates real object
```

Hal paling penting:

> Component scanning bukan proses membuat object. Component scanning adalah proses menemukan metadata class dan mengubahnya menjadi `BeanDefinition`.

Spring tidak perlu membuat instance class untuk mengetahui bahwa class tersebut memiliki `@Component`. Bahkan dalam banyak kasus Spring juga tidak perlu me-load class ke JVM secara penuh saat metadata scanning. Spring dapat membaca metadata class dari bytecode.

Ini alasan Spring bisa melakukan scanning ribuan class tanpa langsung menjalankan static initializer setiap class.

---

## 3. Annotation Bukan Behavior, Annotation Adalah Metadata

Annotation di Java pada dasarnya hanya metadata. Annotation tidak otomatis menjalankan logic.

Contoh:

```java
@Transactional
public void approve() {
    // business logic
}
```

`@Transactional` sendiri tidak membuka transaction. Yang membuat transaction aktif adalah kombinasi dari:

1. Bean terdaftar dalam container.
2. Infrastructure transaction management aktif.
3. Bean diproxy.
4. Method invocation melewati proxy.
5. Transaction interceptor membaca metadata `@Transactional`.
6. Interceptor membuka/commit/rollback transaction.

Maka annotation harus selalu dibaca sebagai:

```text
metadata + processor + runtime path = behavior
```

Tanpa processor dan runtime path yang benar, annotation hanya dekorasi pasif.

Contoh lain:

```java
@Service
public class PaymentService { }
```

`@Service` tidak membuat object. `@Service` hanya memberi sinyal kepada component scanner bahwa class ini adalah stereotype component. Object baru dibuat jauh setelah metadata diproses.

---

## 4. Dua Dunia Annotation di Spring

Spring memakai annotation untuk dua tujuan besar:

### 4.1 Annotation Untuk Registration Metadata

Annotation ini memengaruhi apakah sesuatu masuk ke container sebagai bean definition.

Contoh:

```java
@Component
@Service
@Repository
@Controller
@Configuration
@Bean
@Import
@ComponentScan
```

Efeknya berada di fase registration.

### 4.2 Annotation Untuk Runtime Behavior Metadata

Annotation ini biasanya baru bermakna ketika bean sudah ada, sering melalui proxy, interceptor, argument resolver, handler mapping, atau post processor.

Contoh:

```java
@Transactional
@Async
@Cacheable
@Scheduled
@EventListener
@RequestMapping
@GetMapping
@PreAuthorize
@Validated
```

Efeknya tidak otomatis muncul hanya karena class ada di classpath.

Perbedaan ini sangat penting.

`@Component` adalah metadata untuk menemukan bean.  
`@Transactional` adalah metadata untuk behavior method invocation.  
`@RequestMapping` adalah metadata untuk membangun handler mapping.  
`@Scheduled` adalah metadata yang dibaca oleh scheduled annotation processor.  
`@EventListener` adalah metadata yang diubah menjadi event listener adapter.

---

## 5. Retention dan Target: Kenapa Annotation Kadang Tidak Terlihat

Java annotation memiliki `@Retention` dan `@Target`.

Contoh:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface UseCase {
}
```

### 5.1 Retention

Retention menentukan sampai tahap mana annotation tersedia.

```text
SOURCE  -> hanya source code, hilang setelah compile
CLASS   -> ada di .class, belum tentu tersedia via reflection
RUNTIME -> tersedia di runtime reflection
```

Untuk sebagian besar annotation Spring yang dibaca runtime, gunakan:

```java
@Retention(RetentionPolicy.RUNTIME)
```

Namun perlu dipahami: Spring metadata reader dapat membaca metadata dari class file. Untuk custom annotation aplikasi, tetap gunakan `RUNTIME` kecuali ada alasan framework-level khusus.

### 5.2 Target

Target menentukan lokasi annotation boleh dipasang.

```java
@Target(ElementType.TYPE)
public @interface ApplicationService { }

@Target(ElementType.METHOD)
public @interface AuditedOperation { }

@Target({ElementType.TYPE, ElementType.METHOD})
public @interface InternalOnly { }
```

Jika target salah, annotation tidak dapat dipasang pada lokasi yang Anda inginkan.

### 5.3 Inherited

`@Inherited` hanya berlaku untuk class inheritance dan hanya untuk annotation pada type. Tidak berlaku untuk method, field, interface secara umum, atau parameter.

Contoh:

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface DomainComponent { }
```

Jika `BaseService` diberi `@DomainComponent`, subclass bisa mewarisi metadata tersebut dalam konteks class inheritance tertentu.

Namun hati-hati: Spring tidak selalu hanya memakai Java reflection biasa. Spring memiliki model merged annotation sendiri, sehingga hasil pembacaan annotation bisa lebih kaya daripada reflection sederhana, tetapi `@Inherited` tetap bukan mekanisme universal.

---

## 6. Stereotype Annotation

Spring memiliki beberapa stereotype utama:

```java
@Component
@Service
@Repository
@Controller
```

Secara mekanis, semuanya adalah cara memberi tahu Spring:

> class ini adalah candidate component yang dapat didaftarkan sebagai bean.

### 6.1 `@Component`

`@Component` adalah stereotype paling umum.

```java
@Component
public class TokenGenerator { }
```

Saat component scanning aktif, class ini bisa ditemukan dan didaftarkan sebagai bean definition.

### 6.2 `@Service`

`@Service` adalah specialization dari `@Component` untuk service layer.

```java
@Service
public class PaymentApplicationService { }
```

Secara container registration, `@Service` pada dasarnya membuat class menjadi component candidate. Secara desain, `@Service` menyampaikan maksud: class ini adalah service-layer component.

Jangan salah memahami: `@Service` tidak otomatis membuat transaction, validation, retry, audit, atau business semantic lain.

### 6.3 `@Repository`

`@Repository` adalah stereotype persistence layer.

```java
@Repository
public class JdbcOrderRepository { }
```

Selain sebagai component candidate, `@Repository` juga relevan untuk exception translation dalam konteks persistence exception translation Spring.

Namun jangan membuat semua class DAO menjadi `@Component` hanya karena “toh sama saja”. Jika class tersebut adalah persistence boundary, `@Repository` memberi sinyal arsitektural yang lebih benar.

### 6.4 `@Controller`

`@Controller` adalah stereotype web MVC.

```java
@Controller
public class OrderPageController { }
```

Untuk REST API, biasanya digunakan:

```java
@RestController
public class OrderRestController { }
```

`@RestController` adalah composed annotation yang menggabungkan `@Controller` dan `@ResponseBody`.

---

## 7. Meta-Annotation: Annotation di Atas Annotation

Salah satu kekuatan Spring adalah dukungan meta-annotation.

Contoh:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface ApplicationService {
}
```

Dengan annotation ini:

```java
@ApplicationService
public class ApproveApplicationService { }
```

Spring dapat memperlakukan `ApproveApplicationService` sebagai component karena `@ApplicationService` meta-annotated dengan `@Service`, dan `@Service` sendiri meta-annotated dengan `@Component`.

Mental model:

```text
@ApplicationService
        |
        v
@Service
        |
        v
@Component
        |
        v
candidate component
```

Ini membuat kita bisa membangun vocabulary arsitektural internal.

Contoh:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase {
}

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface DomainPolicy {
}

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Repository
public @interface ReadModelRepository {
}
```

Namun meta-annotation bisa menjadi berbahaya jika terlalu banyak hidden behavior.

Annotation yang baik harus membuat maksud lebih jelas, bukan menyembunyikan banyak behavior.

---

## 8. Composed Annotation: Menggabungkan Banyak Metadata

Composed annotation adalah custom annotation yang menggabungkan beberapa annotation Spring.

Contoh untuk test:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest
@ActiveProfiles("test")
@Transactional
public @interface IntegrationTest {
}
```

Lalu dipakai:

```java
@IntegrationTest
class OrderServiceIntegrationTest {
}
```

Manfaat:

1. Mengurangi duplikasi.
2. Membuat standar internal.
3. Menjaga test suite konsisten.
4. Mengurangi risiko lupa annotation penting.

Risiko:

1. Terlalu banyak behavior tersembunyi.
2. Sulit override attribute.
3. Developer baru tidak tahu efek sebenarnya.
4. Test menjadi lambat karena annotation terlalu berat.

Aturan desain:

> Composed annotation cocok untuk standardisasi yang stabil, bukan untuk shortcut lokal yang cepat dibuat.

---

## 9. `@AliasFor`: Menyatukan Attribute Annotation

`@AliasFor` digunakan untuk menyatakan bahwa satu attribute annotation adalah alias dari attribute lain.

Contoh sederhana:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface UseCase {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";
}
```

Dengan ini:

```java
@UseCase("approveOrderUseCase")
public class ApproveOrderUseCase { }
```

`value` pada `@UseCase` diteruskan sebagai `value` dari `@Component`, sehingga dapat menjadi bean name.

Tanpa alias yang benar, attribute `value` di custom stereotype bisa hanya menjadi attribute lokal yang tidak memengaruhi bean name.

### 9.1 Explicit Alias Within Same Annotation

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Monitored {

    @AliasFor("name")
    String value() default "";

    @AliasFor("value")
    String name() default "";
}
```

Maka:

```java
@Monitored("approve")
```

setara dengan:

```java
@Monitored(name = "approve")
```

### 9.2 Alias To Meta-Annotation

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface ApplicationService {

    @AliasFor(annotation = Service.class, attribute = "value")
    String value() default "";
}
```

Ini menyambungkan `ApplicationService.value` ke `Service.value`.

### 9.3 Common Failure

Salah:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase {
    String value() default "";
}
```

Dipakai:

```java
@UseCase("approveUseCase")
public class ApproveUseCase { }
```

Developer berharap bean name menjadi `approveUseCase`, tetapi belum tentu attribute tersebut diperlakukan sebagai alias ke `@Component.value`.

Lebih benar:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase {

    @AliasFor(annotation = Service.class, attribute = "value")
    String value() default "";
}
```

---

## 10. Merged Annotation Model

Spring tidak hanya membaca annotation secara datar.

Java reflection biasa memberi Anda annotation yang langsung ada pada element:

```java
clazz.getAnnotation(Service.class)
```

Tetapi Spring perlu membaca:

1. Direct annotation.
2. Meta-annotation.
3. Composed annotation.
4. Attribute override.
5. Alias attribute.
6. Repeatable annotation.
7. Annotation dari hierarchy tertentu.

Karena itu Spring memiliki model merged annotation.

Mental model:

```text
raw annotation graph
        |
        v
merged annotation view
        |
        v
framework decision
```

Contoh:

```java
@UseCase("approveOrder")
public class ApproveOrderUseCase { }
```

Spring tidak sekadar melihat `@UseCase`. Spring dapat melihat bahwa:

```text
@UseCase -> @Service -> @Component
```

Dan attribute `value` dapat dimerged ke attribute yang tepat jika `@AliasFor` dideklarasikan benar.

---

## 11. Component Scanning: Apa yang Sebenarnya Terjadi

Component scanning dilakukan oleh scanner yang mencari candidate class di package tertentu.

Contoh:

```java
@Configuration
@ComponentScan(basePackages = "com.example.order")
public class OrderModuleConfiguration {
}
```

Atau secara Boot:

```java
@SpringBootApplication
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

`@SpringBootApplication` mencakup component scanning dari package tempat application class berada dan sub-package-nya.

Pipeline scanning:

```text
base package
        |
        v
convert package to resource path
        |
        v
find .class resources
        |
        v
read class metadata
        |
        v
apply include/exclude filters
        |
        v
check candidate component
        |
        v
create ScannedGenericBeanDefinition
        |
        v
apply scope/name/lazy/primary metadata
        |
        v
register BeanDefinition
```

Hal penting:

> Scanner bekerja terhadap package boundary. Kesalahan lokasi main application class bisa membuat bean tidak ditemukan.

Contoh struktur aman:

```text
com.example.app
    OrderApplication.java
    order
        OrderService.java
    payment
        PaymentService.java
```

Contoh struktur bermasalah:

```text
com.example.app.boot
    OrderApplication.java

com.example.order
    OrderService.java
```

Jika scanning dimulai dari `com.example.app.boot`, maka `com.example.order` bukan sub-package dan tidak ikut discan.

Solusi:

```java
@SpringBootApplication(scanBasePackages = "com.example")
public class OrderApplication { }
```

Namun solusi yang lebih bersih sering kali adalah menaruh application class di root package yang benar.

---

## 12. Include Filter dan Exclude Filter

`@ComponentScan` mendukung filter.

Contoh include berdasarkan annotation:

```java
@Configuration
@ComponentScan(
    basePackages = "com.example",
    includeFilters = @ComponentScan.Filter(
        type = FilterType.ANNOTATION,
        classes = UseCase.class
    )
)
public class UseCaseScanConfiguration {
}
```

Contoh exclude:

```java
@Configuration
@ComponentScan(
    basePackages = "com.example",
    excludeFilters = @ComponentScan.Filter(
        type = FilterType.REGEX,
        pattern = "com\\.example\\.legacy\\..*"
    )
)
public class AppConfiguration {
}
```

Filter types:

```text
ANNOTATION      -> match annotation
ASSIGNABLE_TYPE -> match class assignability
ASPECTJ         -> match AspectJ type pattern
REGEX           -> match class name regex
CUSTOM          -> custom TypeFilter
```

### 12.1 Custom TypeFilter

```java
public final class InternalComponentFilter implements TypeFilter {

    @Override
    public boolean match(
            MetadataReader metadataReader,
            MetadataReaderFactory metadataReaderFactory) throws IOException {

        AnnotationMetadata metadata = metadataReader.getAnnotationMetadata();
        return metadata.hasAnnotation("com.example.platform.InternalComponent");
    }
}
```

Dipakai:

```java
@ComponentScan(
    basePackages = "com.example",
    includeFilters = @ComponentScan.Filter(
        type = FilterType.CUSTOM,
        classes = InternalComponentFilter.class
    )
)
```

Custom filter berguna untuk framework/platform internal, tetapi harus dipakai hati-hati karena dapat membuat registration rule sulit dipahami.

---

## 13. MetadataReader: Membaca Class Tanpa Membuat Object

Saat scanning, Spring menggunakan `MetadataReader` untuk membaca metadata class.

Konsepnya:

```java
MetadataReader reader = metadataReaderFactory.getMetadataReader(className);
ClassMetadata classMetadata = reader.getClassMetadata();
AnnotationMetadata annotationMetadata = reader.getAnnotationMetadata();
```

Dari sana Spring dapat mengetahui:

1. Nama class.
2. Apakah interface.
3. Apakah abstract.
4. Superclass.
5. Interface yang diimplementasikan.
6. Annotation pada class.
7. Meta-annotation.
8. Method metadata tertentu.

Keuntungan:

1. Tidak perlu instantiate class.
2. Tidak perlu menjalankan constructor.
3. Tidak perlu trigger static initializer seperti class loading penuh dalam banyak kasus.
4. Lebih cepat untuk scanning besar.
5. Cocok untuk conditional registration.

Engineering implication:

> Jangan menaruh logic penting di static initializer dengan asumsi Spring scanning akan menjalankannya. Itu desain yang salah.

---

## 14. Candidate Component: Class Mana yang Bisa Jadi Bean?

Tidak semua class yang punya annotation akan menjadi bean.

Spring perlu menilai apakah class adalah candidate component.

Secara umum candidate component harus:

1. Independen.
2. Concrete atau bisa diproses sebagai abstract tertentu.
3. Memenuhi include filter.
4. Tidak terkena exclude filter.
5. Cocok dengan condition jika ada.

Contoh yang biasanya bukan candidate biasa:

```java
public abstract class BaseService { }

public interface OrderPort { }

public class Outer {
    public class InnerNonStatic { }
}
```

Non-static inner class bermasalah karena membutuhkan instance outer class.

Static nested class lebih mungkin menjadi candidate:

```java
@Component
public class Outer {

    @Component
    public static class InnerComponent {
    }
}
```

Namun desain seperti ini jarang ideal untuk production code karena memperburuk discoverability.

---

## 15. Bean Name Generation

Jika component tidak diberi nama eksplisit, Spring membuat bean name default.

Contoh:

```java
@Service
public class OrderService { }
```

Default bean name:

```text
orderService
```

Contoh khusus:

```java
@Service
public class URLParser { }
```

Karena aturan decapitalize JavaBeans mempertahankan acronym tertentu, hasilnya bisa tetap:

```text
URLParser
```

Nama eksplisit:

```java
@Service("orderApprovalService")
public class OrderService { }
```

Untuk custom stereotype:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase {

    @AliasFor(annotation = Service.class, attribute = "value")
    String value() default "";
}
```

Dipakai:

```java
@UseCase("approveOrderUseCase")
public class ApproveOrderUseCase { }
```

Bean name menjadi sesuai attribute jika aliasing benar.

### 15.1 Custom BeanNameGenerator

Untuk platform besar, Anda bisa membuat `BeanNameGenerator`.

Contoh ide:

```java
public final class FullyQualifiedBeanNameGenerator implements BeanNameGenerator {

    @Override
    public String generateBeanName(
            BeanDefinition definition,
            BeanDefinitionRegistry registry) {
        return definition.getBeanClassName();
    }
}
```

Ini mengurangi collision, tetapi membuat nama bean panjang.

Gunakan hanya jika ada kebutuhan kuat seperti multi-module platform dengan collision risk tinggi.

---

## 16. Scope Metadata

Annotation juga bisa membawa scope metadata.

Contoh:

```java
@Component
@Scope("prototype")
public class ReportBuilder { }
```

Spring membaca `@Scope` saat membangun `BeanDefinition`.

Mental model:

```text
@Component -> candidate bean
@Scope    -> scope metadata on bean definition
```

Scope bukan perilaku constructor. Scope adalah aturan container ketika bean diminta.

Custom composed annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
@Scope("prototype")
public @interface PrototypeComponent {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";
}
```

Hati-hati: annotation seperti ini menyembunyikan scope. Developer bisa lupa bahwa setiap lookup menghasilkan instance baru.

Untuk scope non-singleton, dokumentasi dan naming harus jelas.

---

## 17. Lazy, Primary, Fallback, Qualifier Metadata

Component class dapat membawa metadata tambahan:

```java
@Service
@Lazy
@Primary
@Qualifier("fast")
public class FastPricingService implements PricingService { }
```

Saat scanning, metadata ini diterapkan ke `BeanDefinition` atau candidate resolution metadata.

Artinya annotation pada class dapat memengaruhi dependency resolution.

Custom composed annotation:

```java
@Target({ElementType.TYPE, ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Qualifier
public @interface ExternalGateway {
    String value() default "";
}
```

Dipakai:

```java
@Service
@ExternalGateway("payment")
public class PaymentGatewayClient implements GatewayClient { }
```

Injection:

```java
public OrderService(@ExternalGateway("payment") GatewayClient gatewayClient) {
    this.gatewayClient = gatewayClient;
}
```

Ini jauh lebih aman daripada string qualifier tersebar:

```java
@Qualifier("payment")
```

Namun qualifier custom harus dirancang sebagai vocabulary stabil.

---

## 18. Conditional Annotation

Spring Boot dan Spring Framework memakai condition untuk memutuskan apakah bean/configuration aktif.

Contoh:

```java
@Bean
@ConditionalOnProperty(name = "audit.enabled", havingValue = "true")
AuditService auditService() {
    return new AuditService();
}
```

Condition bekerja pada metadata dan environment.

Mental model:

```text
metadata + environment + classpath + bean registry state -> condition outcome
```

Condition sangat powerful, tetapi bisa membuat runtime sulit diprediksi.

Prinsip desain:

1. Gunakan condition untuk infrastructure/platform configuration.
2. Hindari condition kompleks untuk business behavior utama.
3. Selalu sediakan diagnostics.
4. Gunakan condition evaluation report saat debugging Boot.
5. Jangan membuat bean bisnis hilang diam-diam karena property tidak sengaja berubah.

Custom conditional annotation:

```java
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Conditional(OnFeatureEnabledCondition.class)
public @interface ConditionalOnFeature {
    String value();
}
```

Condition:

```java
public final class OnFeatureEnabledCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        Map<String, Object> attributes = metadata.getAnnotationAttributes(
                ConditionalOnFeature.class.getName());
        String feature = (String) attributes.get("value");
        String property = "features." + feature + ".enabled";
        return context.getEnvironment().getProperty(property, Boolean.class, false);
    }
}
```

Pemakaian:

```java
@Bean
@ConditionalOnFeature("case-escalation")
CaseEscalationPolicy caseEscalationPolicy() {
    return new CaseEscalationPolicy();
}
```

Catatan: feature flag untuk bean registration berbeda dari feature flag untuk runtime behavior. Jika bean tidak terdaftar, dependency graph bisa berubah. Untuk fitur bisnis yang sering berubah, runtime flag sering lebih aman.

---

## 19. `@Indexed` dan Component Index

Classpath scanning bisa mahal pada aplikasi besar. Spring mendukung component index melalui annotation processor tertentu.

Konsep:

```text
compile time index
        |
        v
runtime scanner can use index
        |
        v
less classpath traversal
```

Jika component index tersedia, scanner dapat menggunakannya. Jika tidak, scanner melakukan classpath scanning biasa.

Ini biasanya bukan optimasi pertama yang dilakukan aplikasi bisnis, tetapi relevan untuk:

1. Framework internal besar.
2. Aplikasi dengan ribuan class.
3. Startup time optimization.
4. Native/AOT-aware architecture.

Namun jangan mengorbankan package design hanya demi scanning performance. Struktur package yang jelas lebih penting.

---

## 20. Annotation Pada Interface vs Implementation

Ini sumber bug umum.

Contoh:

```java
public interface PaymentService {

    @Transactional
    void pay(PaymentCommand command);
}

@Service
public class DefaultPaymentService implements PaymentService {

    @Override
    public void pay(PaymentCommand command) {
        // logic
    }
}
```

Apakah `@Transactional` di interface terbaca?

Jawabannya bergantung pada mekanisme pembacaan metadata, proxy type, dan annotation yang digunakan. Spring banyak mendukung pembacaan annotation dari interface dalam beberapa konteks, tetapi menjadikan interface annotation sebagai standar universal dapat membingungkan.

Guideline kuat:

1. Untuk annotation behavior Spring seperti `@Transactional`, letakkan di implementation class atau method implementation jika ingin jelas.
2. Gunakan interface untuk contract, bukan tempat utama runtime policy, kecuali tim memiliki konvensi eksplisit.
3. Dokumentasikan jika annotation sengaja ditempatkan di interface.

Contoh lebih eksplisit:

```java
@Service
public class DefaultPaymentService implements PaymentService {

    @Transactional
    @Override
    public void pay(PaymentCommand command) {
        // logic
    }
}
```

---

## 21. Annotation Pada Method dan Self-Invocation Problem

Annotation method sering bergantung pada proxy.

Contoh:

```java
@Service
public class CaseService {

    public void submit() {
        validate();
        approve();
    }

    @Transactional
    public void approve() {
        // write database
    }
}
```

Ketika `submit()` memanggil `approve()` dalam object yang sama, call tersebut tidak melewati proxy.

Mental model:

```text
external caller -> proxy -> interceptor -> target.method()
```

Tetapi self-invocation:

```text
this.submit() -> this.approve()
```

Tidak melewati proxy.

Akibat:

1. `@Transactional` tidak aktif.
2. `@Async` tidak aktif.
3. `@Cacheable` tidak aktif.
4. `@PreAuthorize` method security bisa tidak aktif dalam jalur internal tertentu.

Solusi desain:

### 21.1 Pisahkan Boundary Ke Bean Lain

```java
@Service
public class CaseSubmissionService {

    private final CaseApprovalService approvalService;

    public CaseSubmissionService(CaseApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    public void submit() {
        approvalService.approve();
    }
}

@Service
public class CaseApprovalService {

    @Transactional
    public void approve() {
        // write database
    }
}
```

Ini solusi paling bersih.

### 21.2 Programmatic Boundary

Untuk transaction:

```java
@Service
public class CaseService {

    private final TransactionTemplate transactionTemplate;

    public CaseService(TransactionTemplate transactionTemplate) {
        this.transactionTemplate = transactionTemplate;
    }

    public void submit() {
        transactionTemplate.executeWithoutResult(status -> approveInternal());
    }

    private void approveInternal() {
        // write database
    }
}
```

### 21.3 Self Injection

```java
@Service
public class CaseService {

    private final CaseService self;

    public CaseService(@Lazy CaseService self) {
        this.self = self;
    }

    public void submit() {
        self.approve();
    }

    @Transactional
    public void approve() {
    }
}
```

Ini biasanya kurang disarankan karena membuat desain bergantung pada proxy container dan memperumit reasoning.

---

## 22. Annotation dan Proxy Type

Beberapa annotation Spring akhirnya diproses melalui proxy.

Contoh:

```java
@Transactional
@Async
@Cacheable
@PreAuthorize
```

Jika proxy JDK dipakai, proxy berbasis interface. Jika CGLIB, proxy subclass class target.

Efek terhadap annotation:

1. Annotation pada interface bisa relevan untuk JDK proxy.
2. Annotation pada class implementation biasanya lebih jelas.
3. Final class/method dapat menghambat subclass proxy.
4. Private method tidak bisa diintercept proxy biasa.
5. Self-invocation tidak melewati proxy.

Guideline:

> Annotation yang mengandalkan method interception sebaiknya dipasang pada public method yang dipanggil dari luar bean melalui dependency injection.

---

## 23. Annotation Pada Parameter, Field, dan Constructor

Spring juga membaca annotation pada injection point.

Contoh:

```java
public OrderService(
        @Qualifier("primaryPaymentGateway") PaymentGateway gateway) {
    this.gateway = gateway;
}
```

Custom qualifier:

```java
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Qualifier
public @interface PrimaryGateway {
}
```

Pemakaian:

```java
@Service
@PrimaryGateway
public class StripeGateway implements PaymentGateway { }

@Service
public class CheckoutService {

    public CheckoutService(@PrimaryGateway PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

Ini membuat dependency resolution lebih semantic daripada string.

Namun hindari qualifier terlalu banyak hingga dependency graph menjadi matrix tersembunyi.

---

## 24. Repeatable Annotation

Java mendukung repeatable annotation.

Contoh:

```java
@Rule("submit")
@Rule("approve")
public class CasePolicy { }
```

Spring merged annotation model dapat membantu membaca repeatable annotation secara konsisten.

Namun untuk application-level design, repeatable annotation harus dipakai jika benar-benar merepresentasikan metadata multi-value yang stabil.

Kadang lebih baik menggunakan attribute array:

```java
@PolicyRules({"submit", "approve"})
public class CasePolicy { }
```

Daripada repeatable annotation jika struktur metadata sederhana.

---

## 25. Membuat Custom Stereotype Untuk Architecture Vocabulary

Custom stereotype bisa sangat berguna pada codebase besar.

Contoh domain regulatory/case-management:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase {

    @AliasFor(annotation = Service.class, attribute = "value")
    String value() default "";
}
```

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface DomainPolicy {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";
}
```

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface WorkflowGuard {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";
}
```

Pemakaian:

```java
@UseCase
public class SubmitApplicationUseCase { }

@DomainPolicy
public class EligibilityPolicy { }

@WorkflowGuard
public class ApplicationSubmissionGuard { }
```

Manfaat:

1. Package scan tetap bekerja.
2. Code lebih menyatakan peran arsitektural.
3. Review lebih mudah.
4. Static analysis/internal tooling bisa membaca vocabulary.
5. Modul besar lebih mudah dinavigasi.

Namun jangan membuat annotation seperti ini:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
@Transactional
@Validated
@Retryable
@CacheConfig(cacheNames = "default")
public @interface MagicBusinessService { }
```

Ini terlalu banyak behavior tersembunyi.

Lebih baik pisahkan:

```java
@UseCase
@Transactional
@Validated
public class SubmitApplicationUseCase { }
```

Karena transaction dan validation adalah runtime policy yang perlu terlihat jelas.

---

## 26. Annotation Untuk Architecture Enforcement

Custom annotation tidak harus selalu membuat bean. Annotation juga bisa menjadi metadata untuk enforcement.

Contoh:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface InternalApi {
    String module();
}
```

```java
@InternalApi(module = "case-management")
public interface CaseInternalGateway { }
```

Annotation ini tidak perlu `@Component`. Ia bisa dibaca oleh:

1. ArchUnit test.
2. Build plugin.
3. Documentation generator.
4. Runtime validator.
5. Custom Spring post processor.

Contoh enforcement sederhana dengan `BeanFactoryPostProcessor`:

```java
public final class InternalApiBeanValidator implements BeanFactoryPostProcessor {

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        for (String name : beanFactory.getBeanDefinitionNames()) {
            BeanDefinition definition = beanFactory.getBeanDefinition(name);
            String className = definition.getBeanClassName();
            if (className == null) {
                continue;
            }
            // Load carefully only if needed; real implementation should handle errors.
        }
    }
}
```

Pada production-grade implementation, jangan sembarangan load semua class. Gunakan metadata jika memungkinkan atau jalankan enforcement di build/test layer.

---

## 27. Annotation Untuk Handler Mapping

Tidak semua annotation menghasilkan bean definition. Beberapa annotation dibaca setelah bean sudah terdaftar.

Contoh Spring MVC:

```java
@RestController
@RequestMapping("/orders")
public class OrderController {

    @GetMapping("/{id}")
    public OrderResponse get(@PathVariable String id) {
        return null;
    }
}
```

`@RestController` membantu component scanning.  
`@RequestMapping` dan `@GetMapping` dibaca oleh MVC infrastructure untuk membangun handler mapping.

Pipeline simplifikasi:

```text
component scan registers OrderController bean definition
        |
        v
container creates OrderController bean
        |
        v
RequestMappingHandlerMapping scans handler methods
        |
        v
/orders/{id} mapped to HandlerMethod
```

Maka jika controller tidak menjadi bean, `@GetMapping` tidak akan pernah aktif.

---

## 28. Annotation Untuk Event Listener

Contoh:

```java
@Component
public class CaseEventListener {

    @EventListener
    public void on(CaseSubmitted event) {
        // handle event
    }
}
```

`@Component` membuat class menjadi bean.  
`@EventListener` dibaca oleh event listener processor.

Jika class tidak menjadi bean, method tidak terdaftar sebagai listener.

Jika method private atau signature tidak cocok, listener bisa gagal atau tidak sesuai harapan.

---

## 29. Annotation Untuk Scheduled Task

Contoh:

```java
@Component
public class DailyReportJob {

    @Scheduled(cron = "0 0 1 * * *")
    public void run() {
        // job
    }
}
```

Syarat:

1. Scheduling enabled.
2. Bean terdaftar.
3. Scheduled annotation processor aktif.
4. Method signature sesuai.

`@Scheduled` bukan magic global. Ia adalah metadata yang dibaca processor.

---

## 30. Annotation Untuk Method Validation

Contoh:

```java
@Service
@Validated
public class RegistrationService {

    public void register(@Valid RegisterCommand command) {
    }
}
```

`@Validated` pada class memberi sinyal agar method validation infrastructure membuat proxy/interceptor.

Failure umum:

1. Method dipanggil internal, tidak melewati proxy.
2. Bean tidak diproxy karena infrastructure tidak aktif.
3. Annotation diletakkan di lokasi yang tidak dibaca.
4. Constraint pada nested object tidak diberi `@Valid`.

---

## 31. Annotation dan AOT/Native Image

Pada Spring modern, annotation metadata juga relevan untuk AOT.

AOT processing mencoba memindahkan sebagian analisis runtime ke build time.

Artinya:

1. Dynamic classpath scanning runtime dikurangi.
2. Reflection usage perlu diketahui lebih awal.
3. Proxy hint perlu tersedia.
4. Resource hint perlu tersedia.
5. Annotation-driven dynamic behavior perlu dapat dianalisis.

Custom annotation yang terlalu dinamis bisa menyulitkan AOT.

Contoh berisiko:

```java
@DynamicPlugin(classNameFromProperty = "...")
```

Jika annotation membuat class name ditentukan dari property runtime dan diload reflektif, native image bisa gagal tanpa runtime hints.

Prinsip:

> Semakin eksplisit metadata dan dependency, semakin mudah Spring AOT menganalisis aplikasi.

---

## 32. Version Awareness: Java 8 Sampai Java 25

### 32.1 Java 8 Era

Pada Java 8 dengan Spring 4/5 dan Boot 1/2:

1. Annotation model sudah sangat dominan.
2. `javax.*` masih umum.
3. Reflection-heavy runtime lebih diterima.
4. Component scanning dan proxy runtime menjadi model utama.
5. Native image belum menjadi mainstream Spring application design.

### 32.2 Java 11 Era

Java 11 membawa modular runtime awareness, meskipun banyak Spring app tetap berjalan di classpath.

Isu:

1. Illegal reflective access warning pada beberapa library lama.
2. Dependency compatibility.
3. Classpath vs module path.
4. Legacy Spring Boot 2 migration.

### 32.3 Java 17 Era

Spring Framework 6 dan Spring Boot 3 menjadikan Java 17 baseline.

Dampak:

1. `jakarta.*` menggantikan `javax.*` untuk banyak enterprise API.
2. AOT/native support menjadi lebih serius.
3. Observability modern masuk lebih dalam.
4. Deprecated legacy pattern makin banyak ditinggalkan.

### 32.4 Java 21 Era

Java 21 membawa virtual thread sebagai fitur penting.

Dampak terhadap annotation metadata tidak langsung, tetapi berdampak ke annotation behavior seperti:

1. `@Async` executor strategy.
2. Request handling thread model.
3. Transaction context dengan ThreadLocal.
4. MDC propagation.
5. Scheduling dan blocking behavior.

### 32.5 Java 25 Era

Pada era Java 25 dan Spring Boot 4, ekspektasi engineering bergeser:

1. Java 17 tetap minimum untuk Spring modern tertentu.
2. Java 25 menjadi LTS modern yang didukung Boot 4.
3. Null-safety dan API modernization makin penting.
4. AOT/native dan startup performance lebih diperhatikan.
5. Jakarta EE 11 menjadi baseline penting pada Spring Framework 7.

Untuk annotation design, pelajaran utamanya:

> Annotation internal yang Anda buat hari ini harus jelas, eksplisit, dan mudah dianalisis oleh runtime, test, static analysis, dan AOT toolchain.

---

## 33. Package Design dan Scanning Boundary

Component scanning sangat dipengaruhi package structure.

Package buruk:

```text
com.company.common
    UserService.java
    PaymentController.java
    CaseRepository.java
    StringUtils.java

com.company.app
    Application.java
```

Masalah:

1. Boundary kabur.
2. Terlalu banyak class discan.
3. Common module menjadi dumping ground.
4. Sulit menentukan ownership.

Package lebih baik:

```text
com.company.regulatory
    RegulatoryApplication.java

    caseapplication
        api
        application
        domain
        infrastructure

    enforcement
        api
        application
        domain
        infrastructure

    sharedkernel
        money
        time
        validation
```

Scanning dari root:

```java
@SpringBootApplication
public class RegulatoryApplication { }
```

Dengan ini scanning mencakup module internal secara eksplisit dalam satu root package.

Jika multi-module Maven/Gradle:

```text
regulatory-app
regulatory-case-module
regulatory-enforcement-module
regulatory-platform-starter
```

Pastikan package root tetap konsisten atau gunakan explicit import/configuration per module.

---

## 34. Explicit Registration vs Component Scanning

Component scanning nyaman, tetapi bukan satu-satunya cara.

Explicit registration:

```java
@Configuration
public class OrderConfiguration {

    @Bean
    OrderService orderService(OrderRepository repository) {
        return new OrderService(repository);
    }
}
```

Keuntungan:

1. Dependency jelas.
2. Object graph eksplisit.
3. Cocok untuk domain/service yang ingin minim Spring annotation.
4. Cocok untuk library module.
5. Mudah override dalam test.

Component scanning:

```java
@Service
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }
}
```

Keuntungan:

1. Lebih sedikit boilerplate.
2. Cocok untuk aplikasi besar dengan banyak component.
3. Integrasi Boot lebih natural.
4. Stereotype membantu navigation.

Decision matrix:

| Situasi | Lebih Cocok |
|---|---|
| Application service biasa | component scanning |
| Infrastructure adapter kompleks | explicit `@Bean` sering lebih jelas |
| Library reusable | explicit configuration / auto-configuration |
| Domain object murni | jangan jadikan Spring bean kecuali perlu |
| Conditional infrastructure | `@Bean` + condition |
| Internal platform starter | auto-configuration |
| Banyak implementation sejenis | explicit bean names/qualifier |

Rule of thumb:

> Gunakan scanning untuk application components. Gunakan explicit registration untuk infrastructure object yang construction-nya penting, conditional, atau butuh governance.

---

## 35. Annotation dan Layering Architecture

Annotation bisa membantu menegakkan layer, tetapi juga bisa merusak layer.

Contoh layering baik:

```java
@UseCase
public class SubmitCaseUseCase {
}

@DomainPolicy
public class CaseEligibilityPolicy {
}

@Repository
public class JpaCaseRepository implements CaseRepository {
}

@RestController
public class CaseController {
}
```

Contoh layering buruk:

```java
@RestController
@Transactional
@Repository
public class CaseController {
}
```

Masalah:

1. Web layer merangkap persistence layer.
2. Transaction boundary di controller menjadi terlalu luas.
3. Exception translation semantics kacau.
4. Test sulit.
5. Policy tersebar.

Annotation bukan sekadar syntax; annotation menyatakan architectural role.

Jika annotation role bercampur, design juga biasanya bercampur.

---

## 36. Annotation dan Domain Model

Pertanyaan penting:

> Apakah domain object perlu annotation Spring?

Jawaban umum:

> Tidak, kecuali domain object memang dikelola Spring sebagai policy/service/stateless component.

Domain entity biasanya tidak perlu:

```java
@Component
public class CaseApplication {
}
```

Lebih baik:

```java
public class CaseApplication {
    // pure domain state + behavior
}
```

Lalu application service menjadi Spring bean:

```java
@UseCase
public class SubmitCaseUseCase {

    public void submit(SubmitCaseCommand command) {
        CaseApplication application = repository.get(command.caseId());
        application.submit();
        repository.save(application);
    }
}
```

Spring annotation idealnya berada di boundary:

1. API/controller.
2. Application service/use case.
3. Infrastructure adapter.
4. Configuration.
5. Cross-cutting runtime policy.

Bukan disebar ke setiap object.

---

## 37. Annotation dan Generated Code

Dalam beberapa codebase, annotation dipakai untuk code generation atau compile-time processing.

Contoh:

1. MapStruct.
2. Lombok.
3. Configuration metadata processor.
4. Spring component indexer.
5. OpenAPI generator annotation.

Spring annotation model harus dipisahkan dari annotation processor lain.

Contoh:

```java
@Mapper(componentModel = "spring")
public interface OrderMapper {
}
```

Di sini `@Mapper` diproses MapStruct saat compile time, lalu generated implementation diberi Spring component annotation agar bisa discan.

Mental model:

```text
source annotation
        |
        v
annotation processor generates class
        |
        v
generated class carries Spring metadata
        |
        v
Spring scans/registers bean
```

Jika generated class tidak masuk package scanning, bean tidak ditemukan.

---

## 38. Annotation dan Reflection Cost

Banyak orang terlalu cepat menyalahkan reflection/annotation untuk performance.

Faktanya:

1. Annotation scanning terutama berpengaruh pada startup.
2. Runtime overhead biasanya berasal dari proxy/interceptor/serialization/database/network, bukan sekadar annotation presence.
3. Spring banyak melakukan caching metadata.
4. Performance harus diukur, bukan diasumsikan.

Namun annotation model bisa memperburuk startup jika:

1. Base package terlalu luas.
2. Classpath sangat besar.
3. Banyak condition kompleks.
4. Banyak auto-configuration aktif tanpa perlu.
5. Banyak bean tidak diperlukan tetapi tetap discan.
6. Banyak reflection dynamic yang sulit dianalisis.

Optimization order:

```text
reduce unnecessary dependencies
        -> narrow package scanning
        -> remove unused auto-configuration
        -> avoid accidental bean creation
        -> use lazy init selectively
        -> consider AOT/native/indexing if justified
```

---

## 39. Custom Annotation Design Checklist

Sebelum membuat custom annotation, jawab pertanyaan ini:

### 39.1 Purpose

1. Apakah annotation ini untuk registration?
2. Apakah untuk runtime behavior?
3. Apakah untuk documentation?
4. Apakah untuk static analysis?
5. Apakah untuk testing convention?

### 39.2 Visibility

1. Apakah behavior-nya jelas dari nama?
2. Apakah menyembunyikan transaction/security/cache?
3. Apakah developer baru bisa menebak efeknya?

### 39.3 Attribute

1. Apakah butuh `value()`?
2. Apakah `value()` harus alias ke meta-annotation?
3. Apakah attribute punya default aman?
4. Apakah attribute harus enum, bukan string?

### 39.4 Target

1. TYPE?
2. METHOD?
3. PARAMETER?
4. FIELD?
5. ANNOTATION_TYPE?

### 39.5 Retention

1. Butuh runtime?
2. Cukup compile-time?
3. Apakah tool Spring harus membacanya?

### 39.6 Override

1. Apakah composed annotation perlu expose attribute meta-annotation?
2. Apakah `@AliasFor` benar?
3. Apakah override behavior bisa membingungkan?

### 39.7 AOT/Native

1. Apakah annotation menyebabkan dynamic class loading?
2. Apakah perlu runtime hints?
3. Apakah bisa dianalisis build-time?

### 39.8 Governance

1. Siapa owner annotation?
2. Apakah masuk platform module?
3. Bagaimana deprecation-nya?
4. Apakah dokumentasinya wajib?

---

## 40. Good Custom Annotation Examples

### 40.1 `@UseCase`

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase {

    @AliasFor(annotation = Service.class, attribute = "value")
    String value() default "";
}
```

Tujuan:

1. Registration sebagai service bean.
2. Menyatakan application service/use case.
3. Tidak menyembunyikan transaction.

Pemakaian:

```java
@UseCase
public class ApproveLicenceApplicationUseCase {
}
```

### 40.2 `@DomainPolicy`

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface DomainPolicy {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";
}
```

Tujuan:

1. Stateless policy sebagai Spring bean.
2. Nama role lebih kuat daripada generic `@Component`.

### 40.3 `@ExternalSystemClient`

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface ExternalSystemClient {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";

    String system();
}
```

Pemakaian:

```java
@ExternalSystemClient(system = "OneMap")
public class OneMapClient {
}
```

Catatan:

Attribute `system` bisa dipakai untuk documentation, metrics tagging, atau architecture test.

### 40.4 `@Adapter`

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface Adapter {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";

    AdapterType type();
}
```

```java
public enum AdapterType {
    INBOUND,
    OUTBOUND,
    PERSISTENCE,
    MESSAGING
}
```

Pemakaian:

```java
@Adapter(type = AdapterType.OUTBOUND)
public class PaymentGatewayAdapter {
}
```

Lebih baik daripada string bebas.

---

## 41. Bad Custom Annotation Examples

### 41.1 Annotation Terlalu Banyak Behavior

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
@Transactional
@Validated
@Retryable
public @interface BusinessService {
}
```

Masalah:

1. Transaction tersembunyi.
2. Retry tersembunyi.
3. Validation tersembunyi.
4. Semua service dipaksa punya behavior sama.
5. Sulit override.

Lebih baik:

```java
@UseCase
@Transactional
@Validated
public class ApproveCaseUseCase {
}
```

### 41.2 Annotation Dengan String Semantik Tidak Terkontrol

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface Module {
    String value();
}
```

Dipakai bebas:

```java
@Module("case")
@Module("Case")
@Module("case-management")
@Module("CASE_MGMT")
```

Lebih baik gunakan enum atau centralized constants.

### 41.3 Annotation Yang Membuat Bean Hilang Diam-Diam

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
@ConditionalOnProperty("module.enabled")
public @interface ConditionalComponent {
}
```

Jika property tidak ada, bean hilang. Ini bisa membuat dependency graph gagal jauh dari lokasi masalah.

Lebih baik gunakan condition pada configuration/infrastructure bean, bukan semua component bisnis.

---

## 42. Debugging: Kenapa Bean Tidak Ditemukan?

Jika Anda melihat:

```text
No qualifying bean of type 'com.example.OrderService' available
```

Gunakan checklist ini.

### 42.1 Apakah Class Masuk Package Scanning?

Pastikan class berada di bawah root package aplikasi atau explicit scan base package.

### 42.2 Apakah Ada Stereotype?

```java
@Service
public class OrderService { }
```

Atau didaftarkan melalui `@Bean`.

### 42.3 Apakah Custom Stereotype Meta-Annotated Dengan `@Component`?

Salah:

```java
@Retention(RetentionPolicy.RUNTIME)
public @interface UseCase { }
```

Benar:

```java
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase { }
```

### 42.4 Apakah Retention RUNTIME?

```java
@Retention(RetentionPolicy.RUNTIME)
```

### 42.5 Apakah Class Concrete?

Interface/abstract class tidak menjadi bean biasa kecuali ada mekanisme factory/proxy khusus.

### 42.6 Apakah Condition Menolak Bean?

Cek condition evaluation report di Spring Boot.

### 42.7 Apakah Profile Aktif?

```java
@Profile("dev")
```

Bean hanya aktif pada profile tersebut.

### 42.8 Apakah Exclude Filter Menghapusnya?

Periksa `@ComponentScan(excludeFilters = ...)`.

### 42.9 Apakah Bean Overridden atau Name Collision?

Dua class bisa menghasilkan bean name sama.

### 42.10 Apakah Test Slice Tidak Memuat Bean Itu?

`@WebMvcTest` tidak memuat semua service. `@DataJpaTest` tidak memuat controller/service biasa.

---

## 43. Debugging: Kenapa Annotation Tidak Bekerja?

### 43.1 Annotation Untuk Registration Tapi Bean Tidak Discanned

Contoh:

```java
@UseCase
public class SubmitUseCase { }
```

Jika `@UseCase` tidak meta-annotated dengan `@Component`, bean tidak terdaftar.

### 43.2 Annotation Untuk Runtime Tapi Method Tidak Lewat Proxy

Contoh:

```java
@Transactional
public void approve() { }
```

Jika dipanggil via `this.approve()`, transaction tidak aktif.

### 43.3 Infrastructure Belum Diaktifkan

Contoh:

`@Scheduled` butuh scheduling enabled.

`@Async` butuh async processing enabled.

Method security butuh method security enabled.

### 43.4 Annotation Diletakkan di Lokasi Yang Tidak Dibaca

Contoh:

Annotation di private method untuk AOP proxy tidak efektif.

### 43.5 Annotation Tertutup Oleh Proxy/Interface Issue

Proxy type dapat memengaruhi pembacaan annotation.

### 43.6 Composed Annotation Alias Salah

Attribute custom annotation tidak diteruskan ke meta-annotation.

---

## 44. Practical Lab 1 — Membuat `@UseCase`

### 44.1 Annotation

```java
package com.example.platform.stereotype;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.annotation.AliasFor;
import org.springframework.stereotype.Service;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service
public @interface UseCase {

    @AliasFor(annotation = Service.class, attribute = "value")
    String value() default "";
}
```

### 44.2 Usage

```java
package com.example.caseapplication.application;

import com.example.platform.stereotype.UseCase;

@UseCase
public class SubmitCaseUseCase {

    public void submit(String caseId) {
        // application flow
    }
}
```

### 44.3 Test

```java
@SpringBootTest
class UseCaseRegistrationTest {

    @Autowired
    ApplicationContext context;

    @Test
    void useCaseShouldBeRegisteredAsBean() {
        assertThat(context.getBean(SubmitCaseUseCase.class)).isNotNull();
    }
}
```

### 44.4 Named Bean Test

```java
@UseCase("submitCase")
public class SubmitCaseUseCase {
}
```

```java
assertThat(context.containsBean("submitCase")).isTrue();
```

Jika test gagal, cek `@AliasFor`.

---

## 45. Practical Lab 2 — Custom Qualifier Annotation

### 45.1 Annotation

```java
@Target({ElementType.TYPE, ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Qualifier
public @interface ExternalSystem {
    String value();
}
```

### 45.2 Beans

```java
public interface AddressLookupClient {
    Address lookup(String postalCode);
}
```

```java
@Component
@ExternalSystem("onemap")
public class OneMapAddressLookupClient implements AddressLookupClient {
    @Override
    public Address lookup(String postalCode) {
        return null;
    }
}
```

```java
@Component
@ExternalSystem("internal-cache")
public class CachedAddressLookupClient implements AddressLookupClient {
    @Override
    public Address lookup(String postalCode) {
        return null;
    }
}
```

### 45.3 Injection

```java
@Service
public class AddressService {

    private final AddressLookupClient client;

    public AddressService(@ExternalSystem("onemap") AddressLookupClient client) {
        this.client = client;
    }
}
```

Keuntungan:

1. Semantik lebih kuat daripada `@Qualifier("onemap")`.
2. Bisa dicari sebagai annotation.
3. Bisa dipakai architecture test.
4. Bisa dikembangkan dengan attribute tambahan jika perlu.

---

## 46. Practical Lab 3 — Custom Component Scan Filter

Misal Anda ingin hanya scan class dengan `@UseCase` dalam module tertentu.

```java
@Configuration
@ComponentScan(
    basePackages = "com.example.caseapplication",
    includeFilters = @ComponentScan.Filter(
        type = FilterType.ANNOTATION,
        classes = UseCase.class
    ),
    useDefaultFilters = false
)
public class UseCaseOnlyConfiguration {
}
```

`useDefaultFilters = false` berarti default stereotype seperti `@Component`, `@Service`, `@Repository`, `@Controller` tidak otomatis masuk kecuali sesuai include filter.

Gunakan ini untuk scenario khusus, misalnya test slice internal atau module bootstrap khusus.

Untuk aplikasi biasa, terlalu banyak custom scanning rule dapat membingungkan.

---

## 47. Practical Lab 4 — Membaca Annotation Metadata Secara Manual

Contoh utility:

```java
public final class AnnotationInspectionExample {

    public static void inspect(Class<?> type) {
        MergedAnnotations annotations = MergedAnnotations.from(type);

        boolean component = annotations.isPresent(Component.class);
        boolean service = annotations.isPresent(Service.class);

        System.out.println("component = " + component);
        System.out.println("service = " + service);
    }
}
```

Jika class diberi `@UseCase` yang meta-annotated dengan `@Service`, model merged annotation dapat menemukan hubungan ke stereotype Spring.

Ini berguna untuk:

1. Internal tooling.
2. Architecture validation.
3. Documentation generator.
4. Custom Spring infrastructure.

Namun dalam aplikasi bisnis biasa, jangan terlalu sering membuat reflection scanner sendiri. Lebih baik gunakan Spring extension points yang tersedia.

---

## 48. Advanced Pattern — Annotation sebagai Contract Untuk Internal Platform

Misal organisasi ingin menstandarkan outbound integration.

### 48.1 Annotation

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface OutboundClient {

    @AliasFor(annotation = Component.class, attribute = "value")
    String value() default "";

    String system();

    Criticality criticality() default Criticality.NORMAL;
}
```

```java
public enum Criticality {
    LOW,
    NORMAL,
    HIGH,
    CRITICAL
}
```

### 48.2 Usage

```java
@OutboundClient(system = "OneMap", criticality = Criticality.HIGH)
public class OneMapClient {
}
```

### 48.3 What Platform Can Do

Platform tooling bisa membaca metadata ini untuk:

1. Generate integration catalog.
2. Enforce timeout policy.
3. Enforce circuit breaker existence.
4. Attach default metrics tag.
5. Validate runbook documentation.
6. Generate architecture diagram.

Namun jangan otomatis memasang retry/circuit breaker hanya dari annotation ini tanpa explicit configuration yang terlihat. Metadata boleh menjadi contract; behavior production sebaiknya tetap transparan.

---

## 49. Advanced Pattern — Annotation Untuk Workflow Boundary

Dalam sistem regulatory/case management, workflow boundary sering penting.

Annotation:

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface WorkflowAction {

    String module();

    String action();

    boolean auditable() default true;
}
```

Usage:

```java
@UseCase
public class ApproveApplicationUseCase {

    @WorkflowAction(module = "application", action = "approve")
    @Transactional
    public void approve(ApproveApplicationCommand command) {
        // transition state
    }
}
```

Potential processor:

1. AOP advice for audit metadata.
2. Documentation generator.
3. Authorization matrix generator.
4. Test coverage validator.

Caution:

1. Jangan jadikan annotation ini satu-satunya sumber authorization.
2. Jangan membuat workflow state transition tersembunyi di annotation.
3. Domain invariant tetap harus ada di domain/application logic.

Annotation adalah metadata untuk orchestration, audit, documentation, atau enforcement. Bukan pengganti model domain.

---

## 50. Advanced Pattern — Annotation Untuk API Governance

Contoh:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@RestController
public @interface PublicApiController {

    @AliasFor(annotation = RestController.class, attribute = "value")
    String value() default "";

    String owner();

    ApiStability stability();
}
```

```java
public enum ApiStability {
    EXPERIMENTAL,
    STABLE,
    DEPRECATED
}
```

Usage:

```java
@PublicApiController(owner = "case-management", stability = ApiStability.STABLE)
@RequestMapping("/api/v1/cases")
public class CaseApiController {
}
```

Manfaat:

1. API ownership jelas.
2. Bisa generate catalog.
3. Bisa enforce deprecation policy.
4. Bisa audit controller yang expose public API.

Risiko:

1. `@RestController` di dalam custom annotation bisa menyembunyikan web role.
2. Tidak semua developer menyadari controller tersebut REST controller.

Alternatif lebih eksplisit:

```java
@RestController
@ApiOwner("case-management")
@ApiStability(STABLE)
@RequestMapping("/api/v1/cases")
public class CaseApiController {
}
```

Ini lebih verbose tetapi lebih jelas.

Rule:

> Semakin behavior annotation berdampak besar, semakin baik dibuat eksplisit.

---

## 51. Architecture Testing Dengan Annotation

Annotation dapat menjadi anchor untuk architecture test.

Contoh rule konseptual:

1. Class dengan `@UseCase` hanya boleh bergantung ke domain, repository port, outbound port, dan platform service.
2. Class dengan `@RestController` tidak boleh langsung bergantung ke JPA repository.
3. Class dengan `@Repository` tidak boleh bergantung ke controller atau use case.
4. Class dengan `@OutboundClient` wajib punya timeout config.
5. Method dengan `@WorkflowAction` wajib punya audit test.

Ini membuat annotation tidak hanya menjadi runtime metadata, tetapi juga architecture governance.

Contoh pseudo-rule:

```text
classes annotated with @RestController
    should not depend on classes annotated with @Repository
```

Manfaat:

1. Architecture drift terdeteksi cepat.
2. Reviewer tidak perlu manual mengingat semua rule.
3. Annotation menjadi vocabulary yang bisa dites.

---

## 52. Annotation dan Documentation Generation

Karena annotation adalah metadata terstruktur, ia bisa dipakai untuk generate dokumentasi.

Contoh:

```java
@WorkflowAction(module = "licensing", action = "approve")
public void approve(...) { }
```

Tooling dapat membuat tabel:

| Module | Action | Class | Method | Auditable |
|---|---|---|---|---|
| licensing | approve | ApproveApplicationUseCase | approve | true |

Ini berguna untuk:

1. Regulatory defensibility.
2. Audit trail mapping.
3. Authorization matrix.
4. Impact analysis.
5. Onboarding engineer baru.

Namun jangan membuat dokumentasi hanya dari annotation jika behavior sebenarnya tidak sesuai. Annotation harus dijaga sinkron dengan test dan implementation.

---

## 53. Annotation dan Modulith Boundary

Pada modular monolith, annotation bisa memperjelas module ownership.

Contoh:

```java
@Target(ElementType.PACKAGE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ApplicationModule {
    String name();
}
```

Pada `package-info.java`:

```java
@ApplicationModule(name = "case-management")
package com.example.caseapplication;
```

Package-level annotation jarang dipakai developer biasa, tetapi powerful untuk module metadata.

Spring Modulith juga mendorong pemikiran package/module sebagai boundary. Annotation dapat membantu, tetapi package structure tetap fondasi utama.

---

## 54. Anti-Pattern: Annotation-Driven Everything

Gejala:

```java
@Audited
@SecuredAction("APPROVE")
@WorkflowTransition(from = "SUBMITTED", to = "APPROVED")
@PublishEvent("ApplicationApproved")
@NotifyUser
@UpdateSearchIndex
@Transactional
public void approve(...) { }
```

Masalah:

1. Logic tersebar di annotation processor/aspect.
2. Sulit debug flow.
3. Urutan execution tidak jelas.
4. Error handling tersembunyi.
5. Transaction boundary tidak jelas.
6. Test sulit memahami behavior.

Lebih baik:

```java
@Transactional
public void approve(ApproveCommand command) {
    Application application = repository.get(command.id());

    application.approve(command.actor(), clock.now());

    repository.save(application);
    audit.record(ApplicationApprovedAudit.from(application));
    events.publish(new ApplicationApproved(application.id()));
}
```

Annotation tetap bisa dipakai untuk metadata:

```java
@WorkflowAction(module = "application", action = "approve")
@Transactional
public void approve(ApproveCommand command) { ... }
```

Tetapi business flow utama tetap terbaca dalam code.

---

## 55. Anti-Pattern: Component Scan Terlalu Luas

Contoh:

```java
@SpringBootApplication(scanBasePackages = "com")
public class Application { }
```

Masalah:

1. Bisa scan package library yang tidak dimaksud.
2. Startup lebih lambat.
3. Bean asing bisa masuk.
4. Collision meningkat.
5. Debugging lebih sulit.

Lebih baik:

```java
@SpringBootApplication
public class RegulatoryApplication { }
```

Diletakkan di:

```text
com.company.regulatory.RegulatoryApplication
```

Lalu semua component aplikasi berada di bawah:

```text
com.company.regulatory...
```

---

## 56. Anti-Pattern: Annotation Untuk Menutupi Desain Buruk

Contoh:

```java
@Component
public class CommonHelper {

    @Autowired
    ApplicationContext context;

    public Object doEverything(String beanName) {
        return context.getBean(beanName);
    }
}
```

Meskipun class ini punya annotation Spring yang valid, desainnya buruk.

Annotation tidak memperbaiki:

1. Dependency graph yang tidak jelas.
2. Service locator anti-pattern.
3. Hidden runtime dependency.
4. Lack of testability.

Spring annotation harus membuat desain lebih eksplisit, bukan menyembunyikan dependency.

---

## 57. Best Practices Ringkas

1. Letakkan application class di root package yang benar.
2. Gunakan stereotype sesuai role, bukan asal `@Component`.
3. Buat custom stereotype hanya untuk vocabulary yang stabil.
4. Jangan sembunyikan transaction/security/cache besar dalam annotation custom yang terlalu umum.
5. Gunakan `@AliasFor` saat custom stereotype expose `value` untuk bean name.
6. Gunakan custom qualifier daripada string qualifier jika dependency category stabil.
7. Jangan menjadikan domain entity sebagai Spring bean kecuali ada alasan kuat.
8. Pisahkan annotation registration dan runtime behavior dalam mental model.
9. Jangan mengandalkan annotation pada self-invoked method.
10. Gunakan architecture tests untuk menjaga makna annotation.
11. Hindari scan base package terlalu luas.
12. Prefer explicit `@Bean` untuk infrastructure construction kompleks.
13. Dokumentasikan custom annotation platform.
14. Pastikan annotation mudah dianalisis oleh test, tooling, dan AOT.

---

## 58. Failure Model Summary

| Gejala | Kemungkinan Penyebab | Cara Berpikir |
|---|---|---|
| Bean tidak ditemukan | package tidak discan | scanning boundary salah |
| Bean tidak ditemukan | custom stereotype tidak meta-annotated `@Component` | metadata tidak membuat candidate |
| Bean name tidak sesuai | `@AliasFor` salah/hilang | attribute tidak diteruskan |
| Annotation method tidak aktif | self-invocation | call tidak melewati proxy |
| `@Scheduled` tidak jalan | scheduling belum enabled | processor tidak aktif |
| `@EventListener` tidak jalan | class bukan bean | listener processor hanya scan bean |
| `@Transactional` tidak aktif | private/final/self-call/proxy issue | interception path gagal |
| Test tidak memuat bean | test slice terbatas | context test berbeda dari app |
| Startup lambat | scanning terlalu luas/classpath besar | metadata discovery mahal |
| Behavior tersembunyi | composed annotation terlalu banyak | annotation abuse |

---

## 59. Mental Model Final

Spring annotation model bukan magic.

Ia terdiri dari beberapa lapisan:

```text
Java annotation syntax
        |
        v
retention/target/inheritance rules
        |
        v
Spring metadata reader
        |
        v
merged annotation model
        |
        v
component scanning / configuration parsing
        |
        v
bean definition registration
        |
        v
bean lifecycle processors
        |
        v
proxy/interceptor/handler/listener/scheduler runtime
```

Jika Anda memahami lapisan ini, Anda bisa menjawab hampir semua pertanyaan annotation Spring:

1. Apakah annotation ini dibaca saat registration atau runtime?
2. Siapa processor yang membacanya?
3. Apakah class harus menjadi bean dulu?
4. Apakah method invocation harus melewati proxy?
5. Apakah attribute annotation dimerged dari meta-annotation?
6. Apakah package scanning mencakup class ini?
7. Apakah condition/profile/filter menolak candidate?
8. Apakah AOT/native dapat menganalisis behavior ini?

Inilah perbedaan antara sekadar “tahu annotation” dan benar-benar menguasai Spring sebagai runtime.

---

## 60. Mini Checklist Untuk Code Review

Saat review Spring annotation, tanyakan:

1. Annotation ini menyatakan role atau menyembunyikan behavior?
2. Apakah role class sesuai stereotype?
3. Apakah annotation runtime behavior terlihat di boundary yang tepat?
4. Apakah method annotated dipanggil melalui proxy?
5. Apakah custom annotation punya `@Retention(RUNTIME)`?
6. Apakah `@AliasFor` diperlukan dan sudah benar?
7. Apakah package scanning jelas?
8. Apakah dependency resolution masih eksplisit?
9. Apakah annotation ini membantu architecture governance?
10. Apakah annotation ini akan tetap aman saat migrasi Spring/Java berikutnya?

---

## 61. Apa Yang Harus Dikuasai Setelah Part Ini

Setelah menyelesaikan part ini, Anda seharusnya mampu:

1. Menjelaskan component scanning sebagai metadata-to-bean-definition pipeline.
2. Membedakan annotation registration dan runtime behavior.
3. Mendesain custom stereotype annotation yang benar.
4. Menggunakan `@AliasFor` secara tepat.
5. Memahami meta-annotation dan merged annotation model.
6. Mendiagnosis bean yang tidak ditemukan karena scanning/filter/profile/condition.
7. Mendiagnosis annotation method yang tidak aktif karena proxy/self-invocation.
8. Menentukan kapan component scanning lebih tepat daripada explicit `@Bean`.
9. Membuat annotation internal untuk architecture vocabulary tanpa menyembunyikan behavior berbahaya.
10. Menyiapkan annotation design yang lebih aman untuk Spring modern, AOT, dan Java 25 era.

---

## 62. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi Spring sebagai referensi utama:

1. Spring Framework Reference — Classpath Scanning and Managed Components.
2. Spring Framework Javadoc — `@AliasFor`.
3. Spring Framework Javadoc — `MergedAnnotations` dan `AnnotatedElementUtils`.
4. Spring Framework Javadoc — `ClassPathScanningCandidateComponentProvider`.
5. Spring Framework Reference — Core container dan annotation configuration.
6. Spring Framework Reference — MVC annotation controller model.
7. Spring Framework Reference — Testing meta-annotation support.

Dokumentasi resmi penting karena behavior annotation Spring sangat bergantung pada versi framework.

---

## 63. Transisi Ke Part Berikutnya

Part berikutnya:

```text
05-configuration-model-bean-full-lite-mode.md
```

Kita akan membahas:

1. `@Configuration` full mode.
2. `@Bean` method.
3. CGLIB enhancement.
4. Inter-bean method call.
5. Lite mode configuration.
6. `proxyBeanMethods = false`.
7. Import mechanism.
8. Configuration ordering.
9. Infrastructure bean declaration.
10. Failure model configuration class.

Jika part ini membahas bagaimana Spring membaca annotation dan menemukan component, part berikutnya membahas bagaimana Java configuration class diproses menjadi object graph yang benar.

---

## Status Seri

Part saat ini: 4 dari 35  
Status seri: belum selesai  
Part berikutnya: `05-configuration-model-bean-full-lite-mode.md`


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./03-bean-lifecycle-extension-points.md">⬅️ Bean Lifecycle and Extension Points</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./05-configuration-model-bean-full-lite-mode.md">Part 5 — Configuration Model: `@Configuration`, `@Bean`, Lite Mode, Full Mode ➡️</a>
</div>
