# 09 — Spring AOP, Proxy Model, and Method Interception

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: `09` dari `35`  
> File: `09-spring-aop-proxy-method-interception.md`  
> Fokus: memahami Spring AOP sebagai mekanisme proxy dan interception yang menjadi dasar `@Transactional`, `@Async`, `@Cacheable`, method security, retry, observability, dan banyak fitur Spring lain.

---

## 0. Tujuan Part Ini

Setelah part ini, target pemahaman Anda bukan sekadar:

```java
@Aspect
@Before("execution(* com.example..*(..))")
public void log() {}
```

Targetnya jauh lebih dalam:

1. Anda paham **mengapa Spring memakai proxy**, bukan bytecode weaving penuh secara default.
2. Anda bisa menjelaskan perbedaan **proxy object** dan **target object**.
3. Anda bisa memprediksi kapan annotation seperti `@Transactional`, `@Async`, `@Cacheable`, `@PreAuthorize`, `@Retryable`, atau custom aspect **akan aktif** dan kapan **diam-diam bypass**.
4. Anda bisa membaca stack trace AOP/proxy dengan mental model yang benar.
5. Anda bisa mendesain service layer agar cross-cutting concern tidak rapuh.
6. Anda bisa membuat aspect sendiri tanpa merusak transaction boundary, security boundary, observability, dan testability.
7. Anda bisa membedakan kapan memakai Spring AOP, kapan memakai servlet filter/interceptor, kapan memakai event/listener, kapan memakai decorator eksplisit, dan kapan membutuhkan AspectJ weaving.

Part ini sangat penting karena banyak engineer Spring mengira mereka sedang memanggil object asli, padahal yang dipegang oleh dependency graph adalah **proxy**. Sebaliknya, banyak bug terjadi karena engineer mengira call sedang melewati proxy, padahal call tersebut hanya `this.method()` di dalam target object.

---

## 1. Inti Mental Model: Spring AOP Adalah Proxy-Based Method Interception

Spring AOP pada praktik default-nya adalah mekanisme berikut:

```text
caller
  |
  v
proxy object
  |
  |-- interceptor/advice chain
  |
  v
target object
```

Artinya, saat Anda inject bean Spring:

```java
@Service
public class OrderService {
    @Transactional
    public void placeOrder() {
        // business logic
    }
}
```

object yang diterima oleh class lain sering kali bukan instance mentah `OrderService`, tetapi proxy yang membungkus `OrderService`.

```java
@RestController
public class OrderController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping("/orders")
    public void create() {
        orderService.placeOrder();
    }
}
```

Secara mental, call tersebut bukan langsung:

```text
OrderController -> OrderService.placeOrder()
```

Tetapi:

```text
OrderController
  -> OrderService proxy
     -> TransactionInterceptor
        -> target OrderService.placeOrder()
```

Jika `placeOrder()` sukses, interceptor commit. Jika gagal dengan exception tertentu, interceptor rollback.

Inilah alasan part ini harus dipahami sebelum part transaksi, caching, security method, async, dan retry.

---

## 2. Kenapa Spring Memakai Proxy?

Cross-cutting concern adalah logic yang tidak natural dimiliki satu business method saja, tetapi perlu diterapkan di banyak tempat.

Contoh:

| Concern | Contoh Annotation/Fitur | Kenapa Cross-Cutting |
|---|---|---|
| Transaction | `@Transactional` | Banyak service butuh begin/commit/rollback |
| Security | `@PreAuthorize` | Banyak method perlu authorization |
| Cache | `@Cacheable` | Banyak read method butuh cache |
| Async | `@Async` | Banyak method perlu dieksekusi di executor lain |
| Retry | `@Retryable` | Banyak outbound call butuh retry |
| Metrics | `@Timed`, observation | Banyak method perlu diukur |
| Audit | custom aspect | Banyak operation perlu dicatat |
| Logging | custom aspect | Banyak boundary perlu log |

Tanpa AOP, business code akan penuh boilerplate:

```java
public void placeOrder(OrderRequest request) {
    Transaction tx = txManager.begin();
    long start = clock.now();
    try {
        authorization.check("ORDER_CREATE");
        audit.start("PLACE_ORDER");
        validate(request);
        repository.save(...);
        tx.commit();
        metrics.recordSuccess(clock.now() - start);
    } catch (Exception ex) {
        tx.rollback();
        metrics.recordFailure(clock.now() - start);
        audit.failure(ex);
        throw ex;
    }
}
```

Dengan proxy, cross-cutting concern dapat ditempatkan di luar business method:

```text
caller
  -> proxy
     -> security advice
        -> transaction advice
           -> metrics advice
              -> target business method
```

Business method menjadi lebih fokus:

```java
@Transactional
@PreAuthorize("hasAuthority('ORDER_CREATE')")
public void placeOrder(OrderRequest request) {
    validate(request);
    repository.save(...);
}
```

Namun ada trade-off: karena concern berjalan melalui proxy, Anda harus paham **jalur pemanggilan**.

---

## 3. Istilah AOP yang Harus Dipahami

Spring sengaja memakai istilah AOP yang dekat dengan AspectJ, tetapi implementasi default Spring AOP tetap proxy-based.

| Istilah | Makna Praktis di Spring |
|---|---|
| Aspect | Modul cross-cutting concern, biasanya class berisi advice dan pointcut |
| Join point | Titik eksekusi yang dapat diintercept; di Spring AOP umumnya method execution |
| Advice | Logic yang dijalankan pada join point |
| Pointcut | Predicate untuk memilih join point mana yang kena advice |
| Advisor | Kombinasi advice + pointcut |
| Target object | Object asli yang menjalankan business logic |
| AOP proxy | Object wrapper yang dipanggil client |
| Weaving | Proses menghubungkan aspect dengan target; di Spring AOP biasanya saat runtime via proxy |
| Introduction | Menambahkan interface/behavior baru ke proxied object |

Yang paling penting:

```text
Spring AOP intercepts method execution through proxy.
```

Bukan field access.  
Bukan constructor execution.  
Bukan arbitrary bytecode instruction.  
Bukan private internal operation.

---

## 4. Join Point di Spring AOP: Terbatas pada Method Execution

Spring AOP tidak mencoba menjadi full AOP engine untuk semua titik program.

Yang umum bisa diintercept:

```text
public/protected/package method call yang lewat Spring proxy
```

Yang tidak natural diintercept oleh Spring AOP default:

```text
constructor call
field read/write
private method call
static method call
final method override
internal self-invocation
direct new object call di luar container
object yang tidak dikelola Spring
```

Contoh tidak kena AOP:

```java
@Service
public class InvoiceService {

    public void generate() {
        calculate(); // self-invocation, tidak lewat proxy
    }

    @Transactional
    public void calculate() {
        // transactional? Tidak jika dipanggil dari generate() via this.calculate()
    }
}
```

Kenapa? Karena call tersebut adalah:

```text
target.generate()
  -> this.calculate()
```

Bukan:

```text
proxy.calculate()
```

---

## 5. Proxy Object vs Target Object

Ini salah satu konsep paling penting.

Misalkan Spring membuat bean `PaymentService`.

```java
@Service
public class PaymentService {
    @Transactional
    public void pay() {}
}
```

Jika transaction management aktif, Spring bisa membuat:

```text
paymentService bean name
  -> proxy object
      -> target PaymentService object
```

Ketika class lain inject `PaymentService`, yang diberikan Spring adalah proxy.

```text
AnotherService.paymentService = proxy
```

Tapi di dalam `PaymentService` sendiri, keyword `this` tetap menunjuk ke target object.

```java
public void outer() {
    this.inner(); // target -> target, bukan proxy -> target
}
```

Maka advice tidak berjalan untuk internal call tersebut.

Mental model sederhana:

```text
AOP hanya aktif jika call masuk melalui pintu depan proxy.
Self-invocation adalah masuk lewat pintu samping target object.
```

---

## 6. Dua Jenis Proxy Utama: JDK Dynamic Proxy vs CGLIB

Spring AOP memakai dua strategi utama:

1. **JDK Dynamic Proxy**
2. **CGLIB Class Proxy**

### 6.1 JDK Dynamic Proxy

JDK dynamic proxy membuat object proxy berbasis interface.

```java
public interface PaymentService {
    void pay();
}

@Service
public class DefaultPaymentService implements PaymentService {
    @Transactional
    public void pay() {}
}
```

Proxy-nya mengimplementasikan interface:

```text
$Proxy123 implements PaymentService
```

Call:

```text
PaymentService proxy -> interceptor chain -> DefaultPaymentService target
```

Karakteristik:

| Aspek | JDK Dynamic Proxy |
|---|---|
| Basis | Interface |
| Bisa proxy class tanpa interface? | Tidak |
| Type proxy | Interface type |
| Built-in JDK | Ya |
| Final class issue | Tidak relevan selama interface dipakai |
| Method yang bisa diekspos | Method pada interface |

Pitfall:

```java
@Autowired
private DefaultPaymentService service;
```

Jika Spring membuat JDK proxy berbasis `PaymentService`, injection by concrete class dapat gagal karena proxy bukan subclass `DefaultPaymentService`.

Lebih aman:

```java
@Autowired
private PaymentService service;
```

### 6.2 CGLIB Class Proxy

CGLIB membuat subclass dari target class.

```text
PaymentService$$SpringCGLIB extends PaymentService
```

Karakteristik:

| Aspek | CGLIB Proxy |
|---|---|
| Basis | Subclass |
| Butuh interface? | Tidak |
| Bisa inject concrete class? | Ya, dalam banyak kasus |
| Bisa proxy final class? | Tidak |
| Bisa intercept final method? | Tidak |
| Bisa intercept private method? | Tidak |

Contoh problem:

```java
@Service
public final class PaymentService {
    @Transactional
    public void pay() {}
}
```

CGLIB tidak bisa membuat subclass dari final class.

Contoh lain:

```java
@Service
public class PaymentService {
    @Transactional
    public final void pay() {}
}
```

Method final tidak bisa dioverride oleh proxy subclass, sehingga tidak bisa diintercept secara normal.

---

## 7. Default Proxy Behavior dari Era Java 8 sampai Java 25

Untuk sistem lama berbasis Java 8/Spring 4/5, Anda sering menemukan konfigurasi eksplisit:

```java
@EnableAspectJAutoProxy(proxyTargetClass = false)
```

atau XML:

```xml
<aop:aspectj-autoproxy proxy-target-class="false" />
```

`proxyTargetClass = false` berarti prefer JDK dynamic proxy jika interface tersedia.

Di Spring Boot, banyak aplikasi memakai class-based proxy behavior melalui setting:

```properties
spring.aop.proxy-target-class=true
```

Dalam Spring Framework 7, defaulting tipe proxy dibuat lebih konsisten, termasuk untuk beberapa proxy processor seperti `@Async`. Namun untuk codebase enterprise, jangan hanya menghafal default. Selalu lihat:

```text
Spring version
Boot version
spring.aop.proxy-target-class
@EnableAspectJAutoProxy
@EnableTransactionManagement
@EnableAsync
@EnableCaching
custom ProxyConfig
```

Karena kombinasi konfigurasi tersebut dapat mengubah jenis proxy.

Prinsip aman:

```text
Design code agar tidak bergantung pada detail tipe proxy kecuali memang sedang membuat infrastructure.
```

---

## 8. Cara Proxy Dibuat dalam Lifecycle Spring

AOP proxy biasanya dibuat oleh `BeanPostProcessor`.

Dari part lifecycle sebelumnya, pipeline simplifikasi:

```text
1. BeanDefinition registered
2. Bean instantiated as target object
3. Dependency injected
4. Aware callback
5. BeanPostProcessor before initialization
6. init callback
7. BeanPostProcessor after initialization
8. final exposed bean may be proxy
```

AOP auto-proxy creator bekerja sebagai post processor. Setelah target object dibuat dan diinisialisasi, Spring dapat membungkusnya menjadi proxy.

```text
raw target object
  -> BeanPostProcessor afterInitialization
     -> proxy object
        -> registered as exposed bean
```

Konsekuensi penting:

1. Bean lain biasanya menerima proxy.
2. Target object sendiri tidak otomatis tahu proxy-nya.
3. Early bean reference pada circular dependency dapat melibatkan early proxy exposure.
4. BeanPostProcessor ordering sangat penting.
5. Infrastructure bean yang dibuat terlalu awal bisa tidak kena semua post processor.

---

## 9. Advisor, Advice, Pointcut, dan Interceptor Chain

Spring tidak hanya punya satu advice. Sebuah method call bisa melewati banyak interceptor.

Contoh method:

```java
@PreAuthorize("hasAuthority('ORDER_APPROVE')")
@Transactional
@CacheEvict(cacheNames = "orderSummary", key = "#orderId")
public void approveOrder(Long orderId) {
    // business logic
}
```

Call chain bisa terlihat seperti:

```text
caller
  -> proxy
     -> security interceptor
        -> transaction interceptor
           -> cache interceptor
              -> target.approveOrder(orderId)
```

Atau order lain tergantung advisor ordering.

### 9.1 Advice Types

Common advice:

| Advice | Waktu Eksekusi | Use Case |
|---|---|---|
| Before | Sebelum target method | validation, authorization, audit start |
| After returning | Setelah sukses | audit success, publish result |
| After throwing | Setelah exception | audit failure, exception metric |
| After finally | Selalu setelah selesai | cleanup, timing stop |
| Around | Mengelilingi method | transaction, retry, metrics, cache |

`Around` paling powerful karena bisa:

1. menjalankan logic sebelum method,
2. memutuskan apakah target dipanggil,
3. memanggil target lebih dari sekali,
4. menangkap exception,
5. mengganti return value,
6. mengukur durasi,
7. mengubah behavior sepenuhnya.

Karena itu `Around` juga paling berbahaya jika dipakai sembarangan.

### 9.2 Pointcut

Pointcut menentukan method mana yang kena advice.

Contoh:

```java
@Pointcut("within(com.example.order..*)")
public void orderPackage() {}
```

```java
@Pointcut("@annotation(com.example.Audited)")
public void auditedMethod() {}
```

```java
@Pointcut("execution(public * com.example..*Service.*(..))")
public void serviceMethods() {}
```

Pointcut buruk bisa terlalu luas:

```java
execution(* *(..))
```

Ini hampir selalu red flag karena bisa mengenai infrastructure bean, actuator, auto-configuration, proxy internal, dan test bean.

---

## 10. Method Interception Step-by-Step

Ambil contoh transaksi.

```java
@Service
public class CaseService {
    @Transactional
    public void closeCase(String caseId) {
        repository.markClosed(caseId);
        audit.record(caseId);
    }
}
```

Saat dipanggil dari controller:

```java
caseService.closeCase("C-001");
```

Flow konseptual:

```text
1. Caller memanggil method pada proxy.
2. Proxy melihat method invocation.
3. Proxy mengambil interceptor chain yang cocok.
4. TransactionInterceptor membaca metadata @Transactional.
5. TransactionInterceptor meminta transaction manager membuka transaction.
6. Invocation dilanjutkan ke target method.
7. Target method menjalankan business logic.
8. Jika sukses, interceptor commit.
9. Jika exception sesuai rollback rule, interceptor rollback.
10. Return/exception dikembalikan ke caller.
```

Pseudocode interceptor:

```java
Object invoke(MethodInvocation invocation) throws Throwable {
    TransactionStatus tx = txManager.begin(...);
    try {
        Object result = invocation.proceed();
        txManager.commit(tx);
        return result;
    } catch (Throwable ex) {
        txManager.rollback(tx);
        throw ex;
    }
}
```

`invocation.proceed()` adalah titik di mana interceptor berikutnya atau target method dipanggil.

---

## 11. Self-Invocation Problem: Bug Paling Sering di Spring AOP

Contoh:

```java
@Service
public class RegistrationService {

    public void register(UserRequest request) {
        validate(request);
        saveUser(request); // self-invocation
    }

    @Transactional
    public void saveUser(UserRequest request) {
        userRepository.save(...);
    }
}
```

Banyak engineer mengira `saveUser()` transactional. Tapi jika `register()` dipanggil lewat proxy lalu `saveUser()` dipanggil dengan `this.saveUser()`, maka call kedua tidak melewati proxy.

Flow sebenarnya:

```text
external caller
  -> proxy.register()
     -> target.register()
        -> target.saveUser()   // bypass proxy
```

`@Transactional` pada `saveUser()` tidak aktif.

### 11.1 Solusi 1: Pindahkan Method ke Bean Lain

Ini solusi paling bersih.

```java
@Service
public class RegistrationService {
    private final UserWriter userWriter;

    public RegistrationService(UserWriter userWriter) {
        this.userWriter = userWriter;
    }

    public void register(UserRequest request) {
        validate(request);
        userWriter.saveUser(request);
    }
}

@Service
public class UserWriter {
    @Transactional
    public void saveUser(UserRequest request) {
        // save
    }
}
```

Flow:

```text
RegistrationService target
  -> UserWriter proxy
     -> TransactionInterceptor
        -> UserWriter target
```

Ini membuat boundary eksplisit.

### 11.2 Solusi 2: Letakkan Annotation di Outer Method

Jika seluruh operation harus transactional:

```java
@Service
public class RegistrationService {

    @Transactional
    public void register(UserRequest request) {
        validate(request);
        saveUser(request);
    }

    private void saveUser(UserRequest request) {
        // save
    }
}
```

Ini sering lebih benar karena transaction boundary biasanya di application use case, bukan di helper method internal.

### 11.3 Solusi 3: Self-Injection

```java
@Service
public class RegistrationService {
    private final RegistrationService self;

    public RegistrationService(@Lazy RegistrationService self) {
        this.self = self;
    }

    public void register(UserRequest request) {
        self.saveUser(request);
    }

    @Transactional
    public void saveUser(UserRequest request) {
        // save
    }
}
```

Ini membuat call melewati proxy, tapi lebih rapuh:

1. Membuat circular-ish dependency.
2. Membingungkan pembaca.
3. Mudah salah saat refactor.
4. Membuat class tergantung pada mekanisme proxy.

Gunakan hanya jika Anda benar-benar paham trade-off-nya.

### 11.4 Solusi 4: `AopContext.currentProxy()`

```java
((RegistrationService) AopContext.currentProxy()).saveUser(request);
```

Ini membutuhkan proxy exposure.

Ini biasanya pilihan terakhir karena membuat business code sangat bergantung pada Spring AOP internal.

Prinsip:

```text
Jika self-invocation muncul, biasanya class boundary Anda terlalu gemuk atau transaction boundary Anda salah tempat.
```

---

## 12. Visibility: Public, Protected, Package, Private

Pada proxy-based AOP, method visibility penting.

### 12.1 Public Method

Paling aman untuk Spring AOP.

```java
@Transactional
public void approve() {}
```

### 12.2 Protected/Package Method

Dengan class-based proxy, sebagian scenario modern bisa mendukung method non-public tertentu, tetapi desain service enterprise sebaiknya tidak bergantung pada ini untuk cross-cutting concern utama.

Kenapa?

1. Lebih sulit diprediksi lintas versi/proxy strategy.
2. Lebih buruk untuk readability boundary.
3. Bisa berubah saat interface ditambahkan.
4. Test bisa berbeda dari runtime.

### 12.3 Private Method

Private method tidak bisa diintercept oleh subclass proxy.

```java
@Transactional
private void saveInternal() {}
```

Ini tidak boleh dianggap bekerja.

Jika method adalah boundary transaksi/security/cache, buat boundary-nya eksplisit dan callable melalui proxy.

---

## 13. Final Class dan Final Method

CGLIB bekerja dengan subclassing. Final class tidak bisa disubclass. Final method tidak bisa dioverride.

Problem:

```java
@Service
public final class BillingService {
    @Transactional
    public void bill() {}
}
```

Problem:

```java
@Service
public class BillingService {
    @Transactional
    public final void bill() {}
}
```

Dalam Java biasa, service Spring umumnya tidak dibuat final jika perlu AOP class proxy.

Untuk Java 17+ dengan records/sealed/final style, berhati-hatilah:

```text
immutability untuk data model bagus,
final untuk service yang diproxy perlu dipikirkan.
```

Records cocok untuk DTO/config/value object, bukan service bean yang perlu AOP.

---

## 14. Interface-Based Design vs Class-Based Design

Ada dua gaya umum.

### 14.1 Interface-Based Service

```java
public interface CaseCommandService {
    void closeCase(String caseId);
}

@Service
public class DefaultCaseCommandService implements CaseCommandService {
    @Transactional
    public void closeCase(String caseId) {}
}
```

Kelebihan:

1. Contract jelas.
2. JDK proxy friendly.
3. Cocok untuk hexagonal port.
4. Mudah mock di test.

Kekurangan:

1. Interface bisa menjadi noise jika hanya satu implementation tanpa kebutuhan abstraction.
2. Annotation di interface vs implementation perlu konsisten.
3. Refactor lebih verbose.

### 14.2 Class-Based Service

```java
@Service
public class CaseCommandService {
    @Transactional
    public void closeCase(String caseId) {}
}
```

Kelebihan:

1. Simpel.
2. Sedikit boilerplate.
3. Natural untuk Spring Boot modern.

Kekurangan:

1. Bergantung pada class proxy jika ingin inject concrete type.
2. Final class/method issue.
3. Kurang explicit contract untuk boundary besar.

### 14.3 Rekomendasi Praktis

Untuk enterprise system besar:

| Komponen | Rekomendasi |
|---|---|
| Application use case service | Bisa class-based, public methods jelas |
| Domain service murni | Tidak perlu Spring/AOP jika bisa pure Java |
| Port outbound | Interface baik |
| Infrastructure adapter | Class implementation |
| Shared platform extension | Interface jelas |
| Transaction boundary | Public application service method |
| Security boundary | Public method, preferably application service/controller boundary |

---

## 15. Annotation Location: Interface atau Implementation?

Pertanyaan umum:

```java
public interface PaymentService {
    @Transactional
    void pay();
}
```

atau:

```java
@Service
public class DefaultPaymentService implements PaymentService {
    @Transactional
    public void pay() {}
}
```

Secara engineering, lebih sering lebih aman meletakkan annotation operasional di implementation atau concrete boundary yang benar-benar dieksekusi.

Alasannya:

1. Tidak semua annotation discovery sama antara interface dan class.
2. Class proxy dan JDK proxy dapat memiliki behavior berbeda.
3. Annotation di interface bisa menyembunyikan operational semantics dari implementation reader.
4. Jika ada banyak implementation, tidak semua implementation selalu ingin semantic yang sama.

Namun annotation di interface bisa masuk akal untuk contract-level policy, misalnya API client interface atau shared service contract.

Prinsip:

```text
Letakkan annotation di tempat yang paling dekat dengan policy yang ingin ditegakkan.
```

Jika policy melekat pada use case implementation, letakkan di implementation.  
Jika policy bagian dari contract, letakkan di contract dengan pemahaman proxy strategy.

---

## 16. Ordering: Urutan Advice Bisa Mengubah Semantics

Misalnya method memiliki security dan transaction.

Pertanyaan:

```text
security dulu atau transaction dulu?
```

Jika transaction dibuka sebelum authorization, maka request unauthorized bisa membuka connection/transaction dulu.

Flow A:

```text
security -> transaction -> target
```

Flow B:

```text
transaction -> security -> target
```

Biasanya authorization lebih baik terjadi sebelum transaksi mahal, tetapi ada kasus authorization membutuhkan data transactional. Maka ordering harus sadar.

Contoh lain: retry dan transaction.

Flow A:

```text
retry -> transaction -> target
```

Setiap retry membuka transaction baru.

Flow B:

```text
transaction -> retry -> target
```

Retry terjadi dalam transaction yang sama, sering salah untuk database failure tertentu.

Maka ordering bukan detail kosmetik. Ordering adalah semantics.

Spring memakai `Ordered`, `@Order`, atau advisor-specific ordering.

Contoh custom aspect:

```java
@Aspect
@Order(100)
@Component
public class AuditAspect {
    // advice
}
```

Semakin kecil nilai order, semakin tinggi prioritas wrapping luar dalam banyak konteks.

Namun jangan hanya menghafal angka. Verifikasi call chain untuk concern penting.

---

## 17. Around Advice: Powerful tapi Berbahaya

Contoh around advice:

```java
@Around("@annotation(Audited)")
public Object audit(ProceedingJoinPoint pjp) throws Throwable {
    long start = System.nanoTime();
    try {
        Object result = pjp.proceed();
        auditSuccess(pjp, result, System.nanoTime() - start);
        return result;
    } catch (Throwable ex) {
        auditFailure(pjp, ex, System.nanoTime() - start);
        throw ex;
    }
}
```

Masalah jika salah:

### 17.1 Lupa `proceed()`

```java
@Around("@annotation(Audited)")
public Object audit(ProceedingJoinPoint pjp) {
    auditStart(pjp);
    return null; // target method tidak pernah dipanggil
}
```

### 17.2 Memanggil `proceed()` Dua Kali

```java
Object a = pjp.proceed();
Object b = pjp.proceed();
return b;
```

Ini bisa menyebabkan duplicate insert, duplicate event, duplicate external call.

### 17.3 Menelan Exception

```java
try {
    return pjp.proceed();
} catch (Exception ex) {
    log.warn("failed", ex);
    return null;
}
```

Ini bisa merusak rollback transaction karena exception tidak sampai ke transaction interceptor tergantung ordering.

### 17.4 Mengubah Argument Sembarangan

```java
return pjp.proceed(new Object[] { mutatedRequest });
```

Bisa valid, tetapi harus dipakai sebagai explicit policy, bukan side effect tersembunyi.

Rule:

```text
Around advice harus dianggap seperti middleware tingkat tinggi yang bisa mengubah correctness sistem.
```

---

## 18. Spring AOP vs Servlet Filter vs HandlerInterceptor vs ControllerAdvice

Jangan gunakan AOP untuk semua hal.

| Mekanisme | Boundary | Cocok Untuk |
|---|---|---|
| Servlet Filter | HTTP request paling awal | auth token extraction, correlation id, compression, low-level request wrapping |
| Spring MVC HandlerInterceptor | MVC handler lifecycle | request logging, locale, handler-level context |
| ControllerAdvice | MVC exception/response concern | API error model, validation error response |
| Spring AOP | Bean method execution | transaction, method security, cache, audit use case, service metrics |
| ApplicationEvent | Decoupled domain/application event | post-commit notification, async side effect |
| Decorator eksplisit | Object boundary eksplisit | outbound client resilience, domain port wrapping |

Contoh salah:

```text
Memakai AOP untuk parsing Authorization header.
```

Lebih cocok filter/security chain.

Contoh salah lain:

```text
Memakai HandlerInterceptor untuk transaction boundary service.
```

Lebih cocok `@Transactional` pada service/application boundary.

---

## 19. Spring AOP vs AspectJ Weaving

Spring AOP default adalah proxy-based. AspectJ weaving lebih powerful karena dapat weave bytecode.

| Aspek | Spring AOP | AspectJ Weaving |
|---|---|---|
| Mekanisme | Proxy | Compile-time/load-time weaving |
| Join point | Method execution via proxy | Lebih luas: field, constructor, internal call, dll |
| Setup | Mudah | Lebih kompleks |
| Runtime mental model | Bean proxy | Woven bytecode |
| Self-invocation | Bypass | Bisa diatasi oleh weaving |
| Cocok untuk | Enterprise app typical | Advanced cross-cutting concern yang butuh join point luas |

Kapan mempertimbangkan AspectJ?

1. Butuh intercept internal self-invocation tanpa refactor.
2. Butuh field/constructor join point.
3. Butuh cross-cutting concern di object non-Spring.
4. Butuh domain object weaving.

Namun untuk mayoritas Spring Boot enterprise application, proxy-based AOP cukup, lebih sederhana, dan lebih mudah dioperasikan.

---

## 20. `@Transactional` sebagai Contoh AOP Paling Penting

`@Transactional` sering dianggap magic. Padahal ini method interceptor.

```java
@Transactional
public void approveCase(String caseId) {
    caseRepository.approve(caseId);
}
```

Butuh:

1. Bean dikelola Spring.
2. Transaction management aktif.
3. Method dipanggil melalui proxy.
4. Method cocok dengan transaction attribute source.
5. Transaction manager tersedia.
6. Exception propagation sesuai rollback rule.

Tidak cukup hanya menempel annotation.

### 20.1 Self-Invocation Transaction Bug

```java
public void approveMany(List<String> ids) {
    for (String id : ids) {
        approveOne(id); // bypass @Transactional on approveOne
    }
}

@Transactional
public void approveOne(String id) {}
```

Solusi desain:

```java
@Transactional
public void approveMany(List<String> ids) {
    for (String id : ids) {
        approveOneInternal(id);
    }
}
```

atau pisahkan bean jika setiap item perlu transaction berbeda:

```java
for (String id : ids) {
    itemApprovalService.approveOneInNewTransaction(id);
}
```

---

## 21. `@Async` dan Proxy

`@Async` juga proxy-based.

```java
@Async
public CompletableFuture<Void> sendEmail(...) {
    // runs on executor if called through proxy
}
```

Self-invocation problem:

```java
public void register() {
    sendWelcomeEmail(); // not async if self-invocation
}

@Async
public void sendWelcomeEmail() {}
```

Flow salah:

```text
target.register()
  -> target.sendWelcomeEmail()
```

Bukan executor.

Solusi bersih:

```java
@Service
public class RegistrationService {
    private final WelcomeEmailSender welcomeEmailSender;

    public void register() {
        // save user
        welcomeEmailSender.sendWelcomeEmail(...);
    }
}

@Service
public class WelcomeEmailSender {
    @Async
    public void sendWelcomeEmail(...) {}
}
```

Namun hati-hati: async memisahkan thread, sehingga:

1. Transaction context tidak otomatis ikut.
2. SecurityContext tidak selalu ikut.
3. MDC/correlation id tidak otomatis ikut tanpa task decorator/context propagation.
4. Exception handling berbeda.
5. Caller tidak otomatis tahu failure.

---

## 22. `@Cacheable` dan Proxy

`@Cacheable` berjalan via cache interceptor.

```java
@Cacheable(cacheNames = "caseSummary", key = "#caseId")
public CaseSummary getSummary(String caseId) {
    return repository.loadSummary(caseId);
}
```

Self-invocation problem:

```java
public Dashboard buildDashboard(String caseId) {
    CaseSummary summary = getSummary(caseId); // bypass cache
    return ...;
}
```

Selain proxy issue, cache punya issue lain:

1. key generation salah,
2. mutable return object,
3. tenant/security context tidak masuk key,
4. invalidation tidak jelas,
5. transaction commit belum terjadi saat cache update.

AOP adalah mekanisme, bukan solusi consistency.

---

## 23. Method Security dan Proxy

Method security juga menggunakan interception.

```java
@PreAuthorize("hasAuthority('CASE_APPROVE')")
public void approveCase(String caseId) {}
```

Self-invocation problem juga berlaku.

```java
public void approveFromWorkflow(String caseId) {
    approveCase(caseId); // may bypass method security
}
```

Untuk authorization enterprise, ini sangat serius. Jangan menaruh security hanya pada method yang sering dipanggil internal jika internal caller bisa bypass.

Prinsip:

```text
Security boundary harus berada pada entry point yang tidak bisa dilewati oleh flow yang tidak dipercaya.
```

Dalam aplikasi case management:

1. Controller/API boundary perlu authorization.
2. Application service public use case perlu authorization.
3. Query repository perlu tenant/data filtering.
4. Domain method internal bukan tempat utama untuk Spring method security jika tidak selalu lewat proxy.

---

## 24. Custom Aspect: Contoh Audit Annotation

Misalkan kita ingin audit use case tertentu.

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface AuditedUseCase {
    String action();
}
```

Aspect:

```java
@Aspect
@Component
@Order(200)
public class AuditedUseCaseAspect {

    private final AuditSink auditSink;
    private final Clock clock;

    public AuditedUseCaseAspect(AuditSink auditSink, Clock clock) {
        this.auditSink = auditSink;
        this.clock = clock;
    }

    @Around("@annotation(audited)")
    public Object around(ProceedingJoinPoint pjp, AuditedUseCase audited) throws Throwable {
        Instant startedAt = clock.instant();
        String action = audited.action();

        try {
            Object result = pjp.proceed();
            auditSink.success(action, pjp.getSignature().toShortString(), startedAt, clock.instant());
            return result;
        } catch (Throwable ex) {
            auditSink.failure(action, pjp.getSignature().toShortString(), startedAt, clock.instant(), ex);
            throw ex;
        }
    }
}
```

Usage:

```java
@Service
public class CaseCommandService {

    @AuditedUseCase(action = "CASE_APPROVE")
    @Transactional
    public void approveCase(String caseId) {
        // business logic
    }
}
```

Pertanyaan engineering yang harus dijawab:

1. Audit harus dicatat sebelum atau sesudah transaction commit?
2. Jika transaction rollback, audit success boleh tercatat?
3. Jika audit sink gagal, business operation ikut gagal atau tidak?
4. Audit action harus punya correlation id?
5. Audit payload boleh berisi PII?
6. Apakah audit sink synchronous atau async?
7. Apakah audit aspect harus ordered sebelum/after transaction interceptor?

Jika audit harus hanya tercatat setelah commit, aspect langsung mungkin bukan tempat final. Bisa lebih tepat:

```text
AOP captures intent -> publishes application event -> TransactionalEventListener(AFTER_COMMIT) writes audit
```

---

## 25. AOP untuk Observability: Method Metrics dan Tracing

AOP cocok untuk mengukur boundary method tertentu.

Contoh:

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface MeasuredUseCase {
    String value();
}
```

Aspect:

```java
@Aspect
@Component
public class MeasuredUseCaseAspect {

    private final MeterRegistry registry;

    public MeasuredUseCaseAspect(MeterRegistry registry) {
        this.registry = registry;
    }

    @Around("@annotation(measured)")
    public Object measure(ProceedingJoinPoint pjp, MeasuredUseCase measured) throws Throwable {
        Timer.Sample sample = Timer.start(registry);
        try {
            Object result = pjp.proceed();
            sample.stop(Timer.builder("usecase.duration")
                    .tag("usecase", measured.value())
                    .tag("outcome", "success")
                    .register(registry));
            return result;
        } catch (Throwable ex) {
            sample.stop(Timer.builder("usecase.duration")
                    .tag("usecase", measured.value())
                    .tag("outcome", "failure")
                    .tag("exception", ex.getClass().getSimpleName())
                    .register(registry));
            throw ex;
        }
    }
}
```

Risk:

1. Tag cardinality meledak jika pakai user id/case id sebagai tag.
2. Exception tag terlalu granular.
3. Around advice menambah overhead di hot path.
4. Jika aspect mengenai terlalu banyak method, metrics noise.

Rule observability:

```text
AOP metrics cocok untuk named boundary yang stabil, bukan semua method kecil.
```

---

## 26. AOP untuk Retry: Hati-Hati dengan Idempotency

Retry dengan AOP terlihat nyaman:

```java
@Retryable(maxAttempts = 3)
public ExternalResult callExternalSystem(Command command) {
    return client.send(command);
}
```

Namun retry adalah correctness concern.

Pertanyaan:

1. Apakah operation idempotent?
2. Apakah external system bisa menerima idempotency key?
3. Apakah timeout berarti gagal atau unknown?
4. Apakah retry dilakukan di dalam transaction?
5. Apakah retry bisa memperpanjang lock database?
6. Apakah retry storm bisa terjadi saat dependency down?

Ordering retry + transaction sangat penting.

Lebih aman untuk banyak outbound call:

```text
transaction commit local state + outbox
then async dispatcher retries external delivery with idempotency key
```

AOP retry cocok untuk operasi read-only/idempotent atau adapter-level call dengan policy jelas.

---

## 27. AOP untuk Logging: Jangan Membuat Sistem Bocor

Logging aspect sering dibuat seperti ini:

```java
@Around("execution(* com.example..*Service.*(..))")
public Object log(ProceedingJoinPoint pjp) throws Throwable {
    log.info("calling {} with {}", pjp.getSignature(), pjp.getArgs());
    return pjp.proceed();
}
```

Ini berbahaya.

Masalah:

1. Argumen bisa berisi password/token/PII.
2. Object besar bisa membuat log meledak.
3. Lazy JPA object bisa ter-trigger.
4. `toString()` bisa mahal atau recursive.
5. Log volume bisa membunuh throughput.
6. Audit dan logging tercampur.

Jika membuat logging aspect:

1. Gunakan allowlist, bukan dump semua args.
2. Redact sensitive field.
3. Batasi package/method.
4. Jangan log full payload di production default.
5. Sertakan correlation id.
6. Pisahkan audit event dari technical log.

---

## 28. Pointcut Design untuk Codebase Besar

Pointcut adalah policy selector. Pointcut yang buruk membuat sistem sulit diprediksi.

### 28.1 Package-Based Pointcut

```java
@Pointcut("within(com.company.app.caseapp.application..*)")
public void applicationLayer() {}
```

Kelebihan:

1. Cocok untuk layer policy.
2. Mudah dipahami.

Kekurangan:

1. Refactor package mengubah behavior.
2. Bisa terlalu luas.

### 28.2 Annotation-Based Pointcut

```java
@Pointcut("@annotation(com.company.platform.audit.AuditedUseCase)")
public void auditedUseCase() {}
```

Kelebihan:

1. Explicit di method.
2. Cocok untuk policy yang harus terlihat.

Kekurangan:

1. Engineer bisa lupa annotation.
2. Annotation noise jika terlalu banyak.

### 28.3 Bean Name Pointcut

```java
@Pointcut("bean(*Service)")
public void serviceBeans() {}
```

Kelebihan:

1. Simple.

Kekurangan:

1. Naming convention menjadi behavior.
2. Mudah tidak sengaja kena.

### 28.4 Execution-Based Pointcut

```java
@Pointcut("execution(public * com.company..*CommandService.*(..))")
public void commandServiceMethods() {}
```

Kelebihan:

1. Spesifik pada signature/package.

Kekurangan:

1. Expression bisa sulit dibaca.
2. Overload/generic bisa membingungkan.

### 28.5 Rekomendasi

Untuk sistem besar:

```text
Gunakan annotation-based pointcut untuk policy penting yang harus eksplisit.
Gunakan package/layer pointcut untuk policy infrastruktur yang universal.
Hindari wildcard global kecuali benar-benar terukur.
```

---

## 29. AOP dan Generic Method/Bridge Method

Java generics bisa menghasilkan bridge method.

Contoh:

```java
public interface Handler<T> {
    void handle(T command);
}

@Service
public class ApproveCaseHandler implements Handler<ApproveCaseCommand> {
    @Transactional
    public void handle(ApproveCaseCommand command) {}
}
```

Compiler bisa membuat bridge method untuk type erasure.

Dalam AOP, metadata resolution harus bisa menemukan method paling spesifik. Spring punya mekanisme untuk mencari target method dan merged annotation, tetapi custom aspect yang membaca annotation langsung dari `pjp.getSignature().getMethod()` bisa salah jika method dari interface/bridge.

Lebih aman gunakan utility Spring:

```java
MethodSignature signature = (MethodSignature) pjp.getSignature();
Method method = signature.getMethod();
Class<?> targetClass = AopProxyUtils.ultimateTargetClass(pjp.getTarget());
Method specificMethod = AopUtils.getMostSpecificMethod(method, targetClass);
```

Lalu baca annotation dari specific method dengan merged annotation API jika perlu.

---

## 30. AOP dan `equals`, `hashCode`, `toString`

Proxy dapat mempengaruhi identity perception.

Masalah umum:

```java
someBean.getClass() == PaymentService.class
```

Bisa false karena class-nya proxy.

Lebih aman:

```java
AopUtils.getTargetClass(someBean)
```

atau gunakan contract, bukan concrete class comparison.

Jangan membuat logic bisnis yang bergantung pada class name proxy.

```text
PaymentService$$SpringCGLIB$$0
$Proxy123
```

Untuk entity equality, jangan melibatkan Spring proxy service. Entity seharusnya bukan Spring bean AOP.

---

## 31. Detecting Proxy di Runtime

Untuk debugging:

```java
AopUtils.isAopProxy(bean)
AopUtils.isJdkDynamicProxy(bean)
AopUtils.isCglibProxy(bean)
AopUtils.getTargetClass(bean)
```

Contoh diagnostic runner:

```java
@Component
public class ProxyDiagnostics implements ApplicationRunner {
    private final ApplicationContext context;

    public ProxyDiagnostics(ApplicationContext context) {
        this.context = context;
    }

    @Override
    public void run(ApplicationArguments args) {
        Object bean = context.getBean("caseCommandService");
        System.out.println("is proxy = " + AopUtils.isAopProxy(bean));
        System.out.println("target class = " + AopUtils.getTargetClass(bean));
        System.out.println("actual class = " + bean.getClass());
    }
}
```

Jangan tinggalkan diagnostic noisy seperti ini di production kecuali guarded.

---

## 32. Proxy dan Circular Dependency

AOP membuat circular dependency lebih rumit.

Contoh:

```java
@Service
class A {
    A(B b) {}

    @Transactional
    void doA() {}
}

@Service
class B {
    B(A a) {}
}
```

Dengan constructor injection, cycle gagal. Dengan setter/field, Spring mungkin memakai early reference. Jika A perlu proxy, early exposed reference harus konsisten dengan final proxy.

Spring punya mekanisme early proxy reference, tetapi jangan mengandalkan ini sebagai desain.

Jika Anda melihat error seperti:

```text
BeanCurrentlyInCreationException
```

atau:

```text
Bean with name 'x' has been injected into other beans in its raw version as part of a circular reference, but has eventually been wrapped
```

Itu tanda raw target object mungkin terlanjur diinjeksi sebelum proxy final dibuat.

Solusi benar:

1. Pecah dependency cycle.
2. Pisahkan orchestration dari operation.
3. Gunakan event jika dependency tidak harus synchronous.
4. Gunakan provider/lazy hanya jika cycle memang optional dan terkendali.

---

## 33. Proxy dan BeanPostProcessor Ordering

Auto-proxy creator sendiri adalah `BeanPostProcessor`.

Jika ada BeanPostProcessor lain yang mengakses bean terlalu awal, bean tersebut bisa dibuat sebelum semua proxy infrastructure siap.

Contoh anti-pattern:

```java
@Component
public class BadBeanPostProcessor implements BeanPostProcessor {
    public BadBeanPostProcessor(SomeService someService) {
        // SomeService may be initialized too early
    }
}
```

Infrastructure bean seperti BeanPostProcessor sebaiknya tidak bergantung pada application service biasa.

Rule:

```text
Infrastructure depends downward on metadata/config/helper, not upward on business service.
```

---

## 34. Proxy dan Testing

Test bisa gagal memahami proxy.

### 34.1 Unit Test Pure Java

```java
CaseService service = new CaseService(repository);
service.approve();
```

Tidak ada Spring proxy. `@Transactional` tidak aktif.

Ini bagus untuk business logic test, tetapi bukan test transaksi.

### 34.2 Spring Integration Test

```java
@SpringBootTest
class CaseServiceIT {
    @Autowired CaseService service;
}
```

Jika context lengkap dan transaction management aktif, service bisa proxy.

### 34.3 Testing Aspect Sendiri

Gunakan Spring context kecil.

```java
@Import({AuditedUseCaseAspect.class, TestConfig.class})
class AuditedUseCaseAspectTest {}
```

Atau gunakan `ApplicationContextRunner` untuk auto-config/aspect infrastructure.

### 34.4 Mocking Proxied Bean

Jika mock menggantikan bean, aspect mungkin tidak berjalan pada mock tergantung setup.

Jangan mengira test dengan mock membuktikan AOP behavior.

### 34.5 Assert Proxy Jika Perlu

Untuk critical infrastructure test:

```java
assertThat(AopUtils.isAopProxy(service)).isTrue();
```

Tapi jangan terlalu banyak assert detail proxy di business test.

---

## 35. AOP dan Kotlin/Records/Sealed/Future Java Style

Walaupun seri ini Java 8–25, style modern Java makin mendorong immutability, records, sealed types, dan final semantics.

Prinsip:

1. Records bagus untuk value carrier, DTO, event, config immutable.
2. Sealed types bagus untuk domain algebraic modeling.
3. Final class bagus untuk value object.
4. Service Spring yang perlu class proxy jangan sembarangan final.
5. Domain model sebaiknya tidak tergantung AOP Spring.
6. Cross-cutting concern Spring paling aman berada di application/infrastructure boundary.

Dengan Java 21–25, virtual threads dan structured concurrency tidak menghapus kebutuhan AOP. Mereka hanya mengubah execution model thread. Proxy tetap proxy.

---

## 36. AOP dan Native Image/AOT

Dalam Spring AOT/native image, dynamic behavior harus diketahui lebih awal.

AOP proxy masih bisa digunakan, tetapi:

1. Proxy requirements perlu diketahui AOT.
2. JDK proxy interface perlu hint jika dynamic.
3. Reflection-based aspect logic perlu hati-hati.
4. Classpath scanning dinamis berkurang.
5. Dynamic advisor registration terlalu runtime-heavy bisa bermasalah.

Untuk custom starter modern:

```text
Design AOP infrastructure agar explicit, conditional jelas, dan AOT-friendly.
```

Artinya:

1. Hindari mencari class/method secara reflektif liar saat runtime.
2. Gunakan Spring metadata APIs.
3. Register hints jika perlu.
4. Test native image jika fitur platform penting.

---

## 37. AOP dan Transaction/Event/Audit Boundary

Misalkan Anda membuat aspect audit:

```java
@Around("@annotation(Audited)")
public Object audit(ProceedingJoinPoint pjp) throws Throwable {
    Object result = pjp.proceed();
    auditRepository.save(...);
    return result;
}
```

Pertanyaan: audit save ikut transaction business atau tidak?

Tergantung ordering dan transaction propagation.

Scenario A:

```text
audit aspect outer
  -> transaction interceptor
     -> target
  -> auditRepository.save outside transaction?
```

Scenario B:

```text
transaction interceptor outer
  -> audit aspect
     -> target
     -> auditRepository.save inside transaction
```

Semantics berbeda.

Untuk audit regulatori, sering lebih baik eksplisit:

```java
@Transactional
public void approveCase(...) {
    // update state
    domainEvents.publish(new CaseApproved(...));
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void audit(CaseApproved event) {
    auditSink.record(event);
}
```

AOP bisa dipakai untuk capture metadata, tapi commit semantics sebaiknya jelas.

---

## 38. AOP dan Domain Model: Jangan Campur Berlebihan

Spring AOP bekerja pada Spring bean. Domain entity biasanya bukan Spring bean.

Anti-pattern:

```java
@Entity
public class Case {
    @Autowired SomeService service;

    @Transactional
    public void approve() {}
}
```

Ini mencampur domain object dengan container runtime.

Lebih baik:

```java
public class Case {
    public void approve(Approver approver) {
        // pure domain invariant
    }
}

@Service
public class ApproveCaseUseCase {
    @Transactional
    public void approve(...) {
        Case c = repository.get(...);
        c.approve(...);
        repository.save(c);
    }
}
```

AOP boundary di application service, domain tetap pure.

---

## 39. AOP sebagai Policy Enforcement: Kapan Cocok?

AOP cocok jika concern memenuhi kriteria:

1. Berlaku pada banyak method.
2. Semantics-nya bisa diekspresikan di boundary method.
3. Tidak membutuhkan logic bisnis yang terlalu spesifik.
4. Ordering dengan concern lain jelas.
5. Failure semantics jelas.
6. Bisa dites.
7. Bisa diobservasi.
8. Tidak membuat control flow tersembunyi berlebihan.

AOP kurang cocok jika:

1. Concern hanya dipakai satu tempat.
2. Logic sangat domain-specific.
3. Membutuhkan branching bisnis rumit.
4. Membutuhkan explicit orchestration step yang harus dibaca jelas.
5. Kesalahan ordering bisa catastrophic dan sulit diverifikasi.
6. Pointcut terlalu luas.

Contoh cocok:

```text
@Transactional
@PreAuthorize
@Cacheable
@AuditedUseCase
@MeasuredUseCase
```

Contoh tidak cocok:

```text
Aspect yang diam-diam mengubah request command berdasarkan role user.
Aspect yang melakukan remote call tambahan untuk semua service method.
Aspect yang swallow exception agar UI tetap sukses.
Aspect yang publish integration event sebelum transaction commit tanpa aturan.
```

---

## 40. Design Heuristics untuk Top-Tier Spring Engineer

### 40.1 Boundary Harus Jelas

AOP bekerja baik pada boundary yang jelas:

```text
Controller -> Application Service -> Domain -> Repository/Adapter
```

Letakkan `@Transactional`, method security, audit use case, dan metrics di boundary application service, bukan helper random.

### 40.2 Jangan Mengandalkan Internal Call untuk Policy

Jika policy penting, pastikan call melewati proxy atau pindahkan policy ke outer method.

### 40.3 Jangan Membuat Aspect yang Terlalu Pintar

Aspect yang terlalu pintar menjadi invisible framework. Dalam sistem enterprise, invisibility bisa menjadi risiko audit dan maintainability.

### 40.4 Ordering Adalah Desain

Untuk kombinasi:

```text
security + transaction + retry + cache + audit + metrics
```

urutan harus didesain, bukan kebetulan.

### 40.5 Pahami Object yang Anda Inject

Saat melihat:

```java
private final CaseService caseService;
```

jangan otomatis bayangkan target object. Bisa jadi proxy.

### 40.6 Pakai AOP untuk Policy Stabil

AOP ideal untuk policy lintas sistem yang stabil, bukan hack lokal.

### 40.7 Test Behavior, Bukan Annotation

Test yang hanya memastikan annotation ada tidak cukup. Test harus memastikan transaction/security/cache benar-benar aktif jika behavior critical.

---

## 41. Failure Model Spring AOP

### 41.1 Annotation Tidak Berjalan

Kemungkinan:

1. Method tidak dipanggil lewat proxy.
2. Bean bukan Spring bean.
3. Method private/final.
4. Class final dengan class proxy.
5. Annotation diletakkan di tempat yang tidak dibaca.
6. Auto-configuration belum aktif.
7. Advisor tidak match pointcut.
8. Proxy type tidak sesuai injection.

### 41.2 Bean Injection Gagal Setelah AOP Aktif

Kemungkinan:

1. JDK proxy hanya implement interface.
2. Anda inject concrete class.
3. Bean final tidak bisa diproxy.
4. Multiple proxy membuat type exposure berubah.

### 41.3 Transaction Tidak Rollback

Kemungkinan:

1. Self-invocation.
2. Exception ditelan aspect lain.
3. Checked exception tidak masuk rollback rule.
4. Transaction interceptor ordering salah.
5. Method tidak public/proxy-visible.
6. Transaction manager salah.

### 41.4 Async Tidak Async

Kemungkinan:

1. Self-invocation.
2. `@EnableAsync` tidak aktif.
3. Method final/private.
4. Return type/exception handling salah dipahami.
5. Executor misconfigured.

### 41.5 Cache Tidak Kena

Kemungkinan:

1. Self-invocation.
2. Key mismatch.
3. Cache manager tidak aktif.
4. Condition/unless expression false.
5. Method tidak lewat proxy.

### 41.6 Aspect Terlalu Banyak Kena Method

Kemungkinan:

1. Pointcut terlalu global.
2. Package expression terlalu luas.
3. Annotation meta-detected tidak sesuai harapan.
4. Infrastructure bean ikut kena.

---

## 42. Diagnostic Playbook

Jika annotation AOP tidak bekerja:

### Step 1 — Pastikan Bean Dikelola Spring

```java
applicationContext.getBean(MyService.class)
```

Jika object dibuat dengan `new`, AOP tidak aktif.

### Step 2 — Cek Apakah Bean Proxy

```java
AopUtils.isAopProxy(bean)
bean.getClass()
AopUtils.getTargetClass(bean)
```

### Step 3 — Cek Call Path

Apakah method dipanggil dari bean lain melalui injected reference, atau dari `this.method()`?

### Step 4 — Cek Method

1. Public?
2. Final?
3. Private?
4. Static?
5. Ada di interface atau implementation?

### Step 5 — Cek Advisor/Annotation Aktif

1. `@EnableTransactionManagement`?
2. `@EnableAsync`?
3. `@EnableCaching`?
4. Starter dependency ada?
5. Auto-configuration aktif?

### Step 6 — Cek Condition dan Ordering

1. Pointcut match?
2. Aspect order?
3. Advice menelan exception?
4. Retry/transaction order benar?

### Step 7 — Buat Test Minimal

Buat test kecil dengan context minimal dan assert behavior.

---

## 43. Contoh Refactor: Dari Service Rapuh ke Boundary Jelas

### 43.1 Versi Rapuh

```java
@Service
public class CaseService {

    public void closeCase(String caseId) {
        validate(caseId);
        updateStatus(caseId); // expected transactional but not
        sendNotification(caseId); // expected async but not
    }

    @Transactional
    public void updateStatus(String caseId) {
        repository.close(caseId);
    }

    @Async
    public void sendNotification(String caseId) {
        notificationClient.send(caseId);
    }
}
```

Bug:

1. `updateStatus()` tidak transactional saat self-invocation.
2. `sendNotification()` tidak async saat self-invocation.
3. Notification bisa terkirim sebelum commit jika transaction nanti ditambahkan di outer method.
4. Boundary use case tidak jelas.

### 43.2 Versi Lebih Baik

```java
@Service
public class CloseCaseUseCase {

    private final CaseRepository repository;
    private final ApplicationEventPublisher events;

    public CloseCaseUseCase(CaseRepository repository, ApplicationEventPublisher events) {
        this.repository = repository;
        this.events = events;
    }

    @Transactional
    public void closeCase(String caseId) {
        validate(caseId);
        repository.close(caseId);
        events.publishEvent(new CaseClosedEvent(caseId));
    }
}
```

Notification setelah commit:

```java
@Component
public class CaseClosedNotificationHandler {

    private final NotificationSender sender;

    public CaseClosedNotificationHandler(NotificationSender sender) {
        this.sender = sender;
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(CaseClosedEvent event) {
        sender.send(event.caseId());
    }
}
```

Sekarang:

1. Transaction boundary jelas di use case.
2. Event hanya diproses setelah commit.
3. Async dipakai di bean listener yang dipanggil oleh Spring infrastructure.
4. Business flow lebih defensible.

---

## 44. Mini Lab: Membuktikan Self-Invocation

Buat service:

```java
@Service
public class SelfInvocationLab {

    private final JdbcTemplate jdbc;

    public SelfInvocationLab(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void outer() {
        inner();
    }

    @Transactional
    public void inner() {
        System.out.println(TransactionSynchronizationManager.isActualTransactionActive());
    }
}
```

Panggil:

```java
lab.outer();
```

Kemungkinan output:

```text
false
```

Panggil dari bean lain:

```java
@Component
public class LabCaller {
    private final SelfInvocationLab lab;

    public void callInner() {
        lab.inner();
    }
}
```

Output:

```text
true
```

Ini membuktikan:

```text
annotation bukan trigger utama; proxy call path adalah trigger utama.
```

---

## 45. Mini Lab: Cek Tipe Proxy

```java
@Component
public class ProxyLab implements ApplicationRunner {

    private final SelfInvocationLab lab;

    public ProxyLab(SelfInvocationLab lab) {
        this.lab = lab;
    }

    @Override
    public void run(ApplicationArguments args) {
        System.out.println("class = " + lab.getClass());
        System.out.println("is proxy = " + AopUtils.isAopProxy(lab));
        System.out.println("is cglib = " + AopUtils.isCglibProxy(lab));
        System.out.println("is jdk = " + AopUtils.isJdkDynamicProxy(lab));
        System.out.println("target = " + AopUtils.getTargetClass(lab));
    }
}
```

Gunakan untuk memahami runtime, bukan untuk production logging permanen.

---

## 46. Anti-Pattern Besar dalam Spring AOP

### 46.1 Annotation-Driven Illusion

Mengira annotation selalu aktif.

```java
@Transactional
private void helper() {}
```

Tidak.

### 46.2 God Aspect

Satu aspect melakukan logging, audit, metrics, authorization, mutation, dan exception handling.

Masalah:

1. Sulit dites.
2. Sulit di-order.
3. Sulit diaudit.
4. Sulit dipahami.

### 46.3 Global Pointcut Tanpa Guardrail

```java
execution(* com.company..*(..))
```

Bisa mengenai terlalu banyak method.

### 46.4 Swallow Exception

Aspect menangkap exception dan return fallback tanpa kontrak.

Ini bisa merusak rollback, security, dan error semantics.

### 46.5 Business Logic Tersembunyi di Aspect

Misalnya aspect diam-diam mengubah `status` command berdasarkan role user.

Itu bukan cross-cutting concern; itu business rule tersembunyi.

### 46.6 Self-Injection Everywhere

Self-injection dipakai untuk memperbaiki semua self-invocation.

Lebih baik desain ulang boundary.

---

## 47. Checklist Mendesain Custom Aspect

Sebelum membuat aspect, jawab:

1. Concern ini benar-benar cross-cutting?
2. Boundary method mana yang sah?
3. Pointcut explicit atau convention-based?
4. Apakah aspect harus `Around`, atau cukup `Before/After`?
5. Apa ordering terhadap transaction/security/cache/retry?
6. Jika target exception, aspect harus rethrow atau translate?
7. Jika aspect gagal, business method ikut gagal?
8. Apakah aspect boleh mengubah argument/return value?
9. Apakah aspect membawa context lintas thread?
10. Apakah aman terhadap PII/secrets?
11. Apakah tag metrics bounded cardinality?
12. Apakah native/AOT friendly?
13. Bagaimana test-nya?
14. Bagaimana dokumentasi policy-nya?
15. Bagaimana disable/override untuk kasus khusus?

Jika banyak jawaban tidak jelas, jangan buat aspect dulu.

---

## 48. Checklist Review Code Spring AOP

Saat review PR Spring app:

```text
[ ] Apakah method dengan @Transactional/@Async/@Cacheable dipanggil melalui proxy?
[ ] Apakah ada self-invocation yang membuat annotation tidak aktif?
[ ] Apakah method final/private/static?
[ ] Apakah class final saat butuh class proxy?
[ ] Apakah injection by concrete class aman terhadap proxy strategy?
[ ] Apakah annotation diletakkan di interface/implementation secara sadar?
[ ] Apakah pointcut terlalu luas?
[ ] Apakah aspect ordering terdokumentasi?
[ ] Apakah exception tidak ditelan?
[ ] Apakah retry idempotent?
[ ] Apakah audit terjadi sebelum/sesudah commit secara sengaja?
[ ] Apakah metrics tag cardinality aman?
[ ] Apakah test membuktikan behavior, bukan hanya annotation?
```

---

## 49. Ringkasan Mental Model

Spring AOP harus dipahami dengan kalimat berikut:

```text
Spring AOP adalah method interception berbasis proxy pada bean yang dikelola Spring.
```

Maka:

```text
external call through proxy  -> advice aktif
internal this.method() call   -> advice bypass
non-Spring object             -> advice tidak aktif
private/final/static method   -> tidak bisa diintercept secara normal
ordering advice               -> mengubah semantics
```

Cross-cutting concern yang terlihat sederhana sering berdampak besar pada correctness:

```text
transaction
security
cache
async
retry
audit
metrics
```

Top-tier Spring engineer tidak hanya tahu annotation. Ia tahu:

1. object mana proxy,
2. object mana target,
3. method mana lewat proxy,
4. advice mana jalan duluan,
5. exception pergi ke mana,
6. transaction commit kapan,
7. event publish sebelum/sesudah commit,
8. context thread mana yang membawa security/MDC/transaction,
9. test mana yang benar-benar membuktikan behavior.

---

## 50. Koneksi ke Part Berikutnya

Part ini menjadi fondasi langsung untuk Part 10.

Part berikutnya:

```text
10-spring-transaction-management-beyond-transactional.md
```

Di sana kita akan membedah `@Transactional` secara jauh lebih dalam:

1. `PlatformTransactionManager`
2. `TransactionInterceptor`
3. propagation
4. isolation
5. rollback rules
6. transaction synchronization
7. resource binding
8. multi transaction manager
9. transaction + event
10. transaction + async
11. transaction + retry
12. outbox boundary
13. failure model enterprise

Tanpa memahami proxy di part ini, transaction management akan terlihat seperti magic. Setelah part ini, transaction akan terlihat sebagai interceptor yang punya semantics jelas.

---

## Referensi Resmi dan Bacaan Lanjutan

1. Spring Framework Reference — AOP Proxying Mechanisms  
   `https://docs.spring.io/spring-framework/reference/core/aop/proxying.html`

2. Spring Framework Reference — Aspect Oriented Programming with Spring  
   `https://docs.spring.io/spring-framework/reference/core/aop.html`

3. Spring Framework Reference — AOP APIs  
   `https://docs.spring.io/spring-framework/reference/core/aop-api.html`

4. Spring Framework Javadoc — `org.springframework.aop.framework`  
   `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/aop/framework/package-summary.html`

5. Spring Framework 7.0 Release Notes — proxy type defaulting notes  
   `https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes`

---

## Status Seri

```text
Part saat ini : 9 dari 35
Status        : belum selesai
Berikutnya    : 10-spring-transaction-management-beyond-transactional.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-application-startup-bootstrap-failure-diagnostics.md">⬅️ Part 8 — Application Startup, Bootstrap, Failure Analysis, and Diagnostics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./10-spring-transaction-management-beyond-transactional.md">Spring Transaction Management Beyond `@Transactional` ➡️</a>
</div>
