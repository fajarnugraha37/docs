# Part 031 — Testing CDI, EJB, and Configuration-Heavy Code

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Bagian: `031 / 035`  
> Topik: Testing CDI, EJB, container behavior, configuration-heavy code, profile/feature-flagged runtime  
> Target Java: Java 8 sampai Java 25  
> Target namespace: Java EE `javax.*` dan Jakarta EE `jakarta.*`

---

## 0. Tujuan Bagian Ini

Bagian ini membahas cara mengetes aplikasi enterprise Java yang tidak hanya berisi pure algorithm, tetapi juga bergantung pada:

- CDI bean discovery;
- dependency injection;
- qualifier resolution;
- producer/disposer;
- interceptor;
- decorator;
- lifecycle callback;
- Enterprise Beans / EJB;
- container-managed transaction;
- resource injection;
- MicroProfile Config;
- profile;
- feature flag;
- managed executor dan context propagation;
- deployment/runtime behavior.

Kesalahan umum engineer adalah memperlakukan semua test sebagai unit test biasa. Itu keliru untuk aplikasi enterprise runtime. Banyak bug tidak berada di method body, tetapi berada di boundary antara code dan container.

Contoh bug yang tidak selalu tertangkap oleh unit test biasa:

```java
@Inject
private PaymentGateway gateway;
```

Kode di atas bisa terlihat benar, tetapi gagal saat deployment karena:

- tidak ada bean dengan type tersebut;
- ada dua implementation dengan qualifier sama;
- bean tidak discoverable karena `beans.xml` atau bean-defining annotation salah;
- implementation tidak proxyable;
- dependency ada di compile classpath tetapi tidak ada di runtime classloader;
- producer gagal karena config hilang;
- interceptor tidak aktif;
- transaction tidak berjalan karena self-invocation;
- request scope tidak aktif saat async execution;
- test memakai mock, tetapi production memakai resource JNDI yang salah.

Karena itu, tujuan bagian ini adalah membangun mental model testing yang cocok untuk managed runtime.

---

## 1. Testing Enterprise Java Bukan Satu Jenis Test

Untuk aplikasi biasa, sering cukup membedakan:

```text
unit test
integration test
end-to-end test
```

Untuk aplikasi CDI/EJB/config-heavy, pembagian itu terlalu kasar.

Model yang lebih akurat:

```text
┌──────────────────────────────────────────────┐
│ 1. Pure unit test                            │
│    Tidak ada container, tidak ada CDI        │
├──────────────────────────────────────────────┤
│ 2. Component test with fake wiring           │
│    Constructor manual, fake dependency       │
├──────────────────────────────────────────────┤
│ 3. CDI container test                        │
│    CDI bootstrap, bean resolution, scopes    │
├──────────────────────────────────────────────┤
│ 4. Runtime slice test                        │
│    CDI + config + interceptor/decorator      │
├──────────────────────────────────────────────┤
│ 5. App-server/container integration test     │
│    WAR/EAR deployed to real/embedded server  │
├──────────────────────────────────────────────┤
│ 6. Contract/infrastructure integration test  │
│    DB, queue, external connector, secrets    │
├──────────────────────────────────────────────┤
│ 7. End-to-end/system test                    │
│    Full route via HTTP/UI/API                │
└──────────────────────────────────────────────┘
```

Top engineer tidak bertanya, “pakai unit test atau integration test?”

Pertanyaan yang lebih tepat:

> Runtime assumption apa yang sedang ingin dibuktikan?

Jika yang ingin dibuktikan adalah business rule murni, gunakan pure unit test. Jika yang ingin dibuktikan adalah CDI qualifier resolution, gunakan CDI container test. Jika yang ingin dibuktikan adalah transaction rollback di EJB, jalankan di container yang benar-benar mendukung transaction semantics.

---

## 2. Prinsip Utama: Pisahkan Logic dari Runtime Wiring

Aplikasi enterprise yang testable biasanya membedakan dua area:

```text
business logic       = deterministic, mudah dites tanpa container
runtime integration  = CDI/EJB/config/resource/proxy/container behavior
```

Contoh desain buruk:

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject
    private EntityManager em;

    @Inject
    private FeatureFlagService flags;

    @Inject
    private AuditService audit;

    public ApprovalResult approve(String caseId) {
        CaseEntity entity = em.find(CaseEntity.class, caseId);

        if (flags.enabled("new-approval-policy")) {
            // 200 lines rule
        } else {
            // 150 lines old rule
        }

        audit.record("APPROVED", caseId);
        return ApprovalResult.approved();
    }
}
```

Masalah:

- rule bisnis tercampur persistence;
- feature flag logic tersebar;
- audit side effect sulit dikontrol;
- test butuh terlalu banyak container/mocking;
- sulit menguji combinatorial behavior.

Desain lebih baik:

```java
public final class ApprovalPolicy {

    public ApprovalDecision decide(ApprovalInput input) {
        if (input.riskScore().isHigh() && input.hasUnresolvedFinding()) {
            return ApprovalDecision.requireEscalation("High risk unresolved finding");
        }
        return ApprovalDecision.approve();
    }
}
```

Lalu runtime service menjadi orchestration boundary:

```java
@ApplicationScoped
public class CaseApprovalUseCase {

    private final CaseRepository repository;
    private final ApprovalPolicy policy;
    private final AuditTrail auditTrail;

    @Inject
    public CaseApprovalUseCase(
            CaseRepository repository,
            ApprovalPolicy policy,
            AuditTrail auditTrail
    ) {
        this.repository = repository;
        this.policy = policy;
        this.auditTrail = auditTrail;
    }

    @Transactional
    public ApprovalResult approve(CaseId caseId) {
        CaseSnapshot snapshot = repository.loadSnapshot(caseId);
        ApprovalDecision decision = policy.decide(snapshot.toApprovalInput());
        repository.applyDecision(caseId, decision);
        auditTrail.recordApprovalDecision(caseId, decision);
        return ApprovalResult.from(decision);
    }
}
```

Sekarang test bisa dibagi:

- `ApprovalPolicyTest`: pure unit test;
- `CaseApprovalUseCaseTest`: component test dengan fake repository/audit;
- `CaseApprovalUseCaseCdiTest`: CDI wiring test;
- transaction test: container integration test;
- audit persistence test: DB integration test.

---

## 3. Testing Pyramid untuk Enterprise Runtime

Testing pyramid umum sering seperti ini:

```text
        E2E
      Integration
    Unit Tests
```

Untuk CDI/EJB/config-heavy system, pyramid yang lebih akurat:

```text
                 ┌─────────────────────────┐
                 │ E2E / smoke / journey    │
                 └────────────┬────────────┘
                              │ few
          ┌───────────────────▼───────────────────┐
          │ app-server integration / deployment    │
          └───────────────────┬───────────────────┘
                              │ some
       ┌──────────────────────▼──────────────────────┐
       │ CDI/config/runtime slice tests               │
       └──────────────────────┬──────────────────────┘
                              │ enough
  ┌───────────────────────────▼───────────────────────────┐
  │ pure unit + component tests                            │
  └───────────────────────────────────────────────────────┘
                              │ many
```

Targetnya bukan “semua pakai container”. Targetnya adalah setiap jenis risiko punya level test yang tepat.

| Risiko | Test yang cocok |
|---|---|
| Business rule salah | Pure unit test |
| Use case orchestration salah | Component test with fake dependency |
| CDI qualifier ambiguity | CDI container test |
| Producer gagal karena config | CDI + config slice test |
| Interceptor tidak aktif | CDI runtime slice test |
| EJB transaction rollback salah | App-server integration test |
| JNDI resource name salah | App-server deployment test |
| DB query/invariant salah | DB integration test |
| HTTP contract rusak | API integration test |
| UI journey rusak | E2E test |

---

## 4. Pure Unit Test: Test yang Tidak Butuh Container

Pure unit test adalah test terbaik untuk logic yang bisa dibuat bebas dari runtime.

Ciri pure unit test:

- tidak ada CDI bootstrap;
- tidak ada app server;
- tidak ada database real;
- tidak ada thread container;
- tidak ada `@Inject` yang perlu diproses;
- input jelas;
- output jelas;
- deterministic;
- cepat.

Contoh:

```java
class ApprovalPolicyTest {

    private final ApprovalPolicy policy = new ApprovalPolicy();

    @Test
    void shouldRequireEscalationWhenHighRiskHasUnresolvedFinding() {
        ApprovalInput input = new ApprovalInput(
                RiskScore.high(),
                true,
                List.of("UNRESOLVED_COMPLAINT")
        );

        ApprovalDecision decision = policy.decide(input);

        assertEquals(DecisionType.REQUIRE_ESCALATION, decision.type());
        assertTrue(decision.reason().contains("High risk"));
    }
}
```

Pure unit test harus menjadi mayoritas. Ini bukan karena framework tidak penting, tetapi karena framework wiring adalah permukaan risiko yang berbeda.

### 4.1 Jangan Paksa CDI Masuk ke Semua Test

Anti-pattern:

```java
@ExtendWith(SomeCdiExtension.class)
class ApprovalPolicyTest {
    @Inject
    ApprovalPolicy policy;
}
```

Jika `ApprovalPolicy` tidak membutuhkan container, jangan jadikan test-nya tergantung container. Dependency pada container membuat test:

- lebih lambat;
- lebih rapuh;
- lebih sulit dipahami;
- gagal karena wiring padahal logic benar;
- tidak bisa menjadi fast feedback loop.

Aturan praktis:

> Jika class bisa dibuat dengan `new`, test-lah dengan `new`.

---

## 5. Constructor Injection Membuat Component Test Lebih Bersih

Field injection membuat runtime terlihat mudah tetapi test menjadi lebih sulit.

Contoh field injection:

```java
@ApplicationScoped
public class CaseApprovalUseCase {

    @Inject
    CaseRepository repository;

    @Inject
    AuditTrail auditTrail;

    public ApprovalResult approve(CaseId caseId) {
        // ...
    }
}
```

Test tanpa container harus memakai reflection atau package-private mutation.

Lebih baik:

```java
@ApplicationScoped
public class CaseApprovalUseCase {

    private final CaseRepository repository;
    private final AuditTrail auditTrail;
    private final ApprovalPolicy policy;

    @Inject
    public CaseApprovalUseCase(
            CaseRepository repository,
            AuditTrail auditTrail,
            ApprovalPolicy policy
    ) {
        this.repository = repository;
        this.auditTrail = auditTrail;
        this.policy = policy;
    }

    public ApprovalResult approve(CaseId caseId) {
        // ...
    }
}
```

Component test:

```java
class CaseApprovalUseCaseTest {

    @Test
    void shouldPersistDecisionAndAuditIt() {
        FakeCaseRepository repository = new FakeCaseRepository();
        RecordingAuditTrail auditTrail = new RecordingAuditTrail();
        ApprovalPolicy policy = new ApprovalPolicy();

        CaseApprovalUseCase useCase = new CaseApprovalUseCase(
                repository,
                auditTrail,
                policy
        );

        ApprovalResult result = useCase.approve(new CaseId("CASE-001"));

        assertTrue(result.approved());
        assertEquals(1, repository.savedDecisions().size());
        assertEquals(1, auditTrail.records().size());
    }
}
```

Ini bukan mengganti CDI. Ini memisahkan dua hal:

```text
business orchestration correctness  -> component test
CDI wiring correctness              -> CDI/container test
```

---

## 6. Test Double: Dummy, Stub, Fake, Mock, Spy

Dalam enterprise system, pemilihan test double penting karena dependency sering berupa resource/adaptor.

| Jenis | Fungsi | Contoh |
|---|---|---|
| Dummy | Hanya memenuhi parameter | `NoopAuditTrail` |
| Stub | Mengembalikan jawaban tetap | `StubFeatureFlagService` |
| Fake | Implementasi ringan yang bekerja | `InMemoryCaseRepository` |
| Mock | Memverifikasi interaksi | mock `NotificationGateway` |
| Spy | Merekam call pada object nyata/semi-nyata | `RecordingAuditTrail` |

Untuk domain/use case, fake sering lebih sehat daripada mock berlebihan.

Mock berlebihan membuat test terlalu terikat pada implementasi internal:

```java
verify(repository).findById(caseId);
verify(repository).save(any());
verify(audit).record(any());
verify(notification).send(any());
```

Kadang ini perlu. Tetapi jika semua test hanya memverifikasi method call, test tidak membuktikan state/result yang bermakna.

Lebih baik kombinasikan:

- assert output;
- assert state mutation pada fake repository;
- assert event/audit record yang benar;
- mock hanya untuk external side effect mahal/berbahaya.

---

## 7. CDI Container Test: Apa yang Ingin Dibuktikan?

CDI container test berguna untuk membuktikan hal-hal seperti:

- bean discoverable;
- injection point resolvable;
- qualifier tepat;
- alternative aktif;
- producer menghasilkan object;
- disposer dipanggil;
- scope berjalan;
- interceptor aktif;
- decorator aktif;
- event observer terpanggil;
- lifecycle callback berjalan;
- config injection berhasil.

Contoh pertanyaan yang cocok untuk CDI test:

```text
Apakah @PrimaryPaymentGateway benar-benar dipilih untuk injection point ini?
Apakah producer HttpClient membaca timeout dari config?
Apakah @Audited interceptor aktif pada method use case?
Apakah observer @AfterCaseApproved dipanggil ketika event difire?
Apakah @RequestScoped bean gagal jika request context tidak aktif?
```

Pertanyaan yang tidak harus memakai CDI test:

```text
Apakah risk score dihitung benar?
Apakah state machine transition valid?
Apakah string formatter menghasilkan format benar?
```

---

## 8. Testing CDI dengan Weld JUnit

Weld adalah reference implementation CDI yang sering dipakai untuk CDI tests. Weld Testing Extensions menyediakan extension untuk JUnit 4, JUnit 5, dan Spock. Tujuan utamanya adalah menyediakan tool sederhana dan cepat untuk CDI unit/component testing.

Contoh konseptual JUnit 5:

```java
@EnableWeld
class PaymentServiceCdiTest {

    @WeldSetup
    WeldInitiator weld = WeldInitiator
            .from(
                    PaymentService.class,
                    StripePaymentGateway.class,
                    PaymentGatewayProducer.class
            )
            .build();

    @Inject
    PaymentService paymentService;

    @Test
    void shouldInjectPaymentGateway() {
        assertNotNull(paymentService);
        assertTrue(paymentService.isReady());
    }
}
```

Catatan penting:

- API detail bisa berbeda antar versi Weld Testing.
- Untuk `javax.*`/CDI 2.x, dependency testing berbeda dari `jakarta.*`/CDI 3+.
- Jangan mencampur artifact lama `javax` dengan runtime `jakarta`.
- Sesuaikan versi Weld dengan CDI/Jakarta target.

Testing dengan Weld cocok untuk:

- CDI bean resolution;
- producers;
- qualifiers;
- interceptors;
- decorators;
- event;
- lifecycle;
- scope tertentu yang bisa diaktifkan di test.

Tidak selalu cocok untuk:

- full Jakarta EE transaction;
- EJB timer;
- remote EJB;
- app-server-specific JNDI;
- servlet request behavior penuh;
- security realm real.

---

## 9. Testing Bean Resolution

Misalnya ada dua gateway:

```java
public interface PaymentGateway {
    PaymentResult charge(PaymentRequest request);
}
```

Qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface PrimaryGateway {
}
```

Implementation:

```java
@ApplicationScoped
@PrimaryGateway
public class StripePaymentGateway implements PaymentGateway {
    @Override
    public PaymentResult charge(PaymentRequest request) {
        return PaymentResult.success("stripe");
    }
}
```

Consumer:

```java
@ApplicationScoped
public class PaymentService {

    private final PaymentGateway gateway;

    @Inject
    public PaymentService(@PrimaryGateway PaymentGateway gateway) {
        this.gateway = gateway;
    }

    public String providerName() {
        return gateway.charge(PaymentRequest.test()).provider();
    }
}
```

CDI test membuktikan qualifier route:

```java
@Test
void shouldResolvePrimaryGateway() {
    assertEquals("stripe", paymentService.providerName());
}
```

Test seperti ini tidak hanya mengetes method output; ia mengetes bahwa runtime graph memilih bean yang tepat.

---

## 10. Testing Unsatisfied Dependency

Kadang kita sengaja ingin memastikan module gagal jika dependency wajib tidak tersedia.

Contoh:

```java
@ApplicationScoped
public class NotificationService {

    @Inject
    public NotificationService(EmailGateway gateway) {
    }
}
```

Jika `EmailGateway` tidak ada, container harus fail saat deployment/bootstrap. Ini baik karena dependency wajib tidak boleh diam-diam `null`.

Prinsip:

```text
Required dependency missing -> fail fast
Optional dependency missing -> explicit Optional/Instance/Provider handling
```

Optional dependency yang buruk:

```java
@Inject
EmailGateway gateway; // nanti dicek null
```

CDI tidak menginjeksi `null` untuk unsatisfied dependency; deployment akan gagal.

Optional dependency yang lebih eksplisit:

```java
@Inject
Instance<EmailGateway> gateways;

public boolean emailAvailable() {
    return !gateways.isUnsatisfied();
}
```

Atau memakai config/feature flag untuk memutuskan behavior dengan jelas.

---

## 11. Testing Ambiguous Dependency

Ambiguous dependency harus dianggap sebagai design bug, bukan sekadar test failure.

Contoh:

```java
@ApplicationScoped
public class SmtpEmailGateway implements EmailGateway {
}

@ApplicationScoped
public class SesEmailGateway implements EmailGateway {
}

@ApplicationScoped
public class NotificationService {
    @Inject
    EmailGateway gateway;
}
```

Injection point `EmailGateway` ambiguous jika dua bean sama-sama match `@Default`.

Solusi:

- gunakan qualifier;
- jadikan salah satu alternative dan aktifkan hanya di environment tertentu;
- gunakan producer untuk memilih startup-time;
- gunakan registry `Instance<EmailGateway>` jika selection memang runtime-per-call.

CDI test yang baik memastikan ambiguity tidak muncul.

---

## 12. Testing Producer dan Disposer

Producer sering menjadi boundary antara CDI dan object non-managed.

Contoh:

```java
@ApplicationScoped
public class HttpClientProducer {

    @Inject
    @ConfigProperty(name = "external.payment.timeout.ms", defaultValue = "2000")
    int timeoutMs;

    @Produces
    @ApplicationScoped
    @PaymentClient
    public HttpClient producePaymentClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(timeoutMs))
                .build();
    }
}
```

Test producer perlu menjawab:

- apakah config terbaca?
- apakah object punya property benar?
- apakah qualifier benar?
- apakah scope benar?
- apakah disposer dipanggil jika ada resource cleanup?

Jika resource punya lifecycle eksplisit:

```java
@Produces
@ApplicationScoped
public ExternalClient produce() {
    return new ExternalClient(...);
}

public void dispose(@Disposes ExternalClient client) {
    client.close();
}
```

Test-nya harus memastikan close dipanggil saat container shutdown, bila test framework mendukung lifecycle shutdown.

---

## 13. Testing `@PostConstruct` dan `@PreDestroy`

Lifecycle callback sering menyimpan bug yang tidak terlihat di unit test.

Contoh:

```java
@ApplicationScoped
public class RoutingTable {

    private Map<String, Route> routes;

    @PostConstruct
    void init() {
        this.routes = loadRoutes();
        if (routes.isEmpty()) {
            throw new IllegalStateException("No route configured");
        }
    }

    @PreDestroy
    void shutdown() {
        routes.clear();
    }
}
```

Yang perlu dites:

- `@PostConstruct` dipanggil setelah injection;
- initialization gagal jika config/resource tidak valid;
- initialized state siap sebelum bean digunakan;
- `@PreDestroy` membersihkan resource;
- callback tidak melakukan side effect terlalu berat tanpa timeout/guard.

Pure unit test bisa mengetes method initialization jika dipisahkan, tetapi CDI lifecycle test memastikan callback benar-benar dipanggil oleh container.

---

## 14. Testing Interceptor

Interceptor tidak bisa dites hanya dengan memanggil method interceptor secara langsung. Yang perlu dibuktikan adalah:

```text
method call -> proxy/interceptor chain -> target method
```

Contoh binding:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({ TYPE, METHOD })
public @interface Audited {
}
```

Interceptor:

```java
@Audited
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditInterceptor {

    @Inject
    AuditSink sink;

    @AroundInvoke
    public Object around(InvocationContext context) throws Exception {
        sink.before(context.getMethod().getName());
        try {
            Object result = context.proceed();
            sink.afterSuccess(context.getMethod().getName());
            return result;
        } catch (Exception ex) {
            sink.afterFailure(context.getMethod().getName(), ex);
            throw ex;
        }
    }
}
```

Target:

```java
@ApplicationScoped
public class CaseCommandService {

    @Audited
    public void approve(String caseId) {
        // business behavior
    }
}
```

Test harus memanggil `CaseCommandService` dari CDI-injected proxy, bukan `new CaseCommandService()`.

Yang perlu diuji:

- interceptor aktif;
- urutan before/after benar;
- exception tetap dipropagasi;
- failure audit terekam;
- binding member diperlakukan benar;
- self-invocation tidak memberi false confidence.

### 14.1 Self-Invocation Test

Contoh bug:

```java
@ApplicationScoped
public class CaseService {

    public void outer() {
        inner();
    }

    @Audited
    public void inner() {
    }
}
```

Jika `outer()` memanggil `inner()` lewat `this.inner()`, invocation tidak melewati client proxy. Interceptor bisa tidak aktif.

Test harus mencakup scenario nyata:

```java
caseService.outer();
assertFalse(auditSink.contains("inner")); // jika self-invocation bypass terjadi
```

Solusinya bukan “test-nya disesuaikan”, tetapi desain runtime boundary-nya diperbaiki:

- pindahkan `inner` ke bean lain;
- inject self proxy dengan sangat hati-hati;
- jadikan intercepted method entry point yang dipanggil dari luar bean.

---

## 15. Testing Decorator

Decorator membungkus business interface. Yang dites bukan hanya method output, tetapi chain behavior.

Interface:

```java
public interface CaseAssignmentService {
    AssignmentResult assign(CaseId caseId, OfficerId officerId);
}
```

Implementation:

```java
@ApplicationScoped
public class DefaultCaseAssignmentService implements CaseAssignmentService {
    @Override
    public AssignmentResult assign(CaseId caseId, OfficerId officerId) {
        return AssignmentResult.assigned(caseId, officerId);
    }
}
```

Decorator:

```java
@Decorator
public abstract class ComplianceAssignmentDecorator implements CaseAssignmentService {

    @Inject
    @Delegate
    CaseAssignmentService delegate;

    @Inject
    CompliancePolicy policy;

    @Override
    public AssignmentResult assign(CaseId caseId, OfficerId officerId) {
        policy.assertCanAssign(caseId, officerId);
        return delegate.assign(caseId, officerId);
    }
}
```

Test harus membuktikan:

- decorator aktif;
- delegate dipanggil;
- policy violation menghentikan call;
- qualifier matching benar;
- tidak terjadi recursion;
- ordering benar jika ada beberapa decorator.

---

## 16. Testing CDI Events

CDI event test harus membedakan:

- synchronous event;
- asynchronous event;
- transactional observer;
- observer qualifier;
- failure propagation.

Synchronous event:

```java
@ApplicationScoped
public class CaseEventPublisher {

    @Inject
    Event<CaseApproved> approvedEvent;

    public void publish(CaseApproved event) {
        approvedEvent.fire(event);
    }
}
```

Observer:

```java
@ApplicationScoped
public class CaseAuditObserver {

    @Inject
    RecordingAuditSink sink;

    public void onApproved(@Observes CaseApproved event) {
        sink.record("approved:" + event.caseId());
    }
}
```

Test:

```java
@Test
void shouldNotifyObserver() {
    publisher.publish(new CaseApproved("CASE-001"));

    assertTrue(sink.records().contains("approved:CASE-001"));
}
```

Async event membutuhkan waiting strategy yang aman:

- jangan pakai `Thread.sleep` sembarangan;
- gunakan latch/future/await utility;
- tetapkan timeout;
- pastikan failure observable.

Transactional observer sebaiknya dites di container yang benar-benar menyediakan transaction integration.

---

## 17. Testing Scopes dan Context Activation

Scope bug sering muncul saat code yang berjalan di HTTP request dipanggil dari scheduler/async/test.

Contoh:

```java
@RequestScoped
public class RequestCorrelation {
    private String correlationId;
}
```

Bean ini valid dalam request context. Tetapi jika dipakai dari background task tanpa request context, bisa gagal.

Test yang baik:

- membuktikan behavior saat context aktif;
- membuktikan failure saat context tidak aktif;
- membuktikan context propagation jika memang dikonfigurasi.

Pseudo-test:

```java
@Test
void requestScopedBeanShouldFailOutsideRequestContext() {
    assertThrows(ContextNotActiveException.class, () -> {
        backgroundJob.run();
    });
}
```

Namun, exact exception bisa bergantung provider/runtime. Jangan terlalu overfit pada class exception jika runtime berbeda.

---

## 18. Testing Configuration-Heavy Code

Config-heavy code biasanya punya risiko:

- config hilang;
- config invalid;
- default salah;
- precedence salah;
- env var mapping salah;
- secret bocor di log;
- config berubah tetapi bean tidak reload;
- config berbeda antar replica;
- profile salah aktif;
- test config tidak sama dengan production contract.

### 18.1 Pisahkan Config Reading dari Config Meaning

Buruk:

```java
@ApplicationScoped
public class RetryService {

    @Inject
    @ConfigProperty(name = "retry.max")
    int maxRetry;

    @Inject
    @ConfigProperty(name = "retry.backoff.ms")
    long backoffMs;

    public void execute(Runnable task) {
        // retry logic langsung pakai raw config
    }
}
```

Lebih baik:

```java
public record RetryConfig(int maxAttempts, Duration backoff) {

    public RetryConfig {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be >= 1");
        }
        if (backoff.isNegative() || backoff.isZero()) {
            throw new IllegalArgumentException("backoff must be positive");
        }
    }
}
```

Producer:

```java
@ApplicationScoped
public class RetryConfigProducer {

    @Inject
    @ConfigProperty(name = "retry.max-attempts")
    int maxAttempts;

    @Inject
    @ConfigProperty(name = "retry.backoff.ms")
    long backoffMs;

    @Produces
    @ApplicationScoped
    RetryConfig produce() {
        return new RetryConfig(maxAttempts, Duration.ofMillis(backoffMs));
    }
}
```

Pure unit test untuk validation:

```java
@Test
void shouldRejectZeroAttempts() {
    assertThrows(IllegalArgumentException.class, () -> {
        new RetryConfig(0, Duration.ofMillis(100));
    });
}
```

CDI/config test untuk injection:

```java
@Test
void shouldProduceRetryConfigFromMicroProfileConfig() {
    RetryConfig config = container.select(RetryConfig.class).get();

    assertEquals(3, config.maxAttempts());
    assertEquals(Duration.ofMillis(250), config.backoff());
}
```

---

## 19. Testing MicroProfile Config

MicroProfile Config menyatukan banyak source menjadi satu view. Dari sisi test, yang harus dikontrol adalah config source dan precedence.

Yang perlu diuji:

- property required ada;
- default bekerja;
- invalid format gagal;
- converter custom bekerja;
- ordinal precedence sesuai;
- env var mapping sesuai runtime target;
- `Provider<T>` dynamic lookup benar jika dipakai;
- secret tidak muncul di diagnostic output.

Contoh config property:

```java
@ApplicationScoped
public class PaymentConnectorConfig {

    @Inject
    @ConfigProperty(name = "payment.base-url")
    URI baseUrl;

    @Inject
    @ConfigProperty(name = "payment.timeout.ms", defaultValue = "2000")
    int timeoutMs;

    public URI baseUrl() {
        return baseUrl;
    }

    public int timeoutMs() {
        return timeoutMs;
    }
}
```

Test cases minimal:

```text
1. payment.base-url missing       -> bootstrap fails
2. payment.base-url invalid URI   -> bootstrap fails / conversion fails
3. payment.timeout.ms missing     -> uses 2000
4. payment.timeout.ms = abc       -> conversion fails
5. override source has higher ordinal -> override wins
```

### 19.1 Jangan Bergantung pada Production Env Vars di Test

Buruk:

```text
Test hanya pass kalau environment variable lokal developer sudah diset.
```

Lebih baik:

- test menyediakan config source sendiri;
- test profile eksplisit;
- test property file eksplisit;
- container test setup menginjeksi config dengan jelas.

---

## 20. Testing Profile

Profile test harus menjawab:

```text
Dengan profile X, bean/config apa yang aktif?
Dengan profile Y, bean/config apa yang aktif?
Apakah prod tidak pernah memakai fallback dev?
Apakah profile wajib dideklarasikan eksplisit?
```

Contoh matrix:

| Profile | DB | External connector | Feature flag source | Expected behavior |
|---|---|---|---|---|
| local | in-memory/testcontainer | stub | local file | safe local run |
| test | testcontainer | fake | fixed config | deterministic test |
| uat | UAT resource | sandbox | remote/config service | integration-like |
| prod | prod resource | real | governed source | fail-fast, no fallback |

Test profile harus mencegah bug seperti:

```text
Prod accidentally uses local mock connector.
UAT accidentally uses prod endpoint.
Test silently reads developer machine env var.
```

---

## 21. Testing Feature Flags

Feature flag test harus mencakup lebih dari true/false.

Minimal scenario:

```text
flag disabled -> old path
flag enabled  -> new path
flag service down -> configured fallback
flag stale -> behavior explicit
flag variant A -> implementation A
flag variant B -> implementation B
flag removed -> code no longer depends on it
```

Contoh service:

```java
@ApplicationScoped
public class CaseRoutingService {

    private final FeatureFlags flags;
    private final LegacyRouter legacyRouter;
    private final NewPolicyRouter newPolicyRouter;

    @Inject
    public CaseRoutingService(
            FeatureFlags flags,
            LegacyRouter legacyRouter,
            NewPolicyRouter newPolicyRouter
    ) {
        this.flags = flags;
        this.legacyRouter = legacyRouter;
        this.newPolicyRouter = newPolicyRouter;
    }

    public Route route(CaseSnapshot snapshot) {
        if (flags.enabled("new-case-routing", snapshot.flagContext())) {
            return newPolicyRouter.route(snapshot);
        }
        return legacyRouter.route(snapshot);
    }
}
```

Unit/component test:

```java
@Test
void shouldUseLegacyRouterWhenFlagDisabled() {
    FeatureFlags flags = FixedFeatureFlags.disabled("new-case-routing");
    CaseRoutingService service = new CaseRoutingService(
            flags,
            new LegacyRouter(),
            new NewPolicyRouter()
    );

    Route route = service.route(sampleCase());

    assertEquals("legacy", route.strategy());
}
```

Feature flag tests harus juga memverifikasi governance:

- flag punya owner;
- flag punya expiry/removal target;
- flag decision logged/audited jika regulatory relevant;
- fallback eksplisit;
- no hidden network dependency in pure unit test.

---

## 22. Testing EJB / Enterprise Beans

EJB behavior tidak bisa diuji secara lengkap dengan `new`.

Hal-hal yang disediakan container:

- transaction attribute;
- security role check;
- pooling;
- timer;
- async method;
- remote/local view;
- lifecycle;
- concurrency lock singleton;
- resource injection.

Jika ingin membuktikan EJB semantics, test harus melibatkan container yang mendukung EJB.

Contoh:

```java
@Stateless
public class CaseCommandBean {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approve(String caseId) {
        // update DB
        // write audit
    }
}
```

Pure unit test bisa mengetes logic yang dipanggil oleh bean, tetapi tidak membuktikan transaksi.

Untuk transaksi, butuh integration test:

```text
1. deploy bean ke container
2. invoke method melalui EJB proxy
3. trigger exception
4. assert DB rollback
5. assert audit behavior sesuai transaction policy
```

### 22.1 EJB Transaction Test Matrix

| Scenario | Expected |
|---|---|
| REQUIRED called without tx | container starts tx |
| REQUIRED called within tx | joins tx |
| REQUIRES_NEW called within tx | suspends caller tx, starts new tx |
| checked exception | may not rollback unless configured |
| runtime exception | rollback by default |
| self-invocation | transaction attribute may be bypassed |

Test matrix ini harus disesuaikan dengan container dan style aplikasi.

---

## 23. Arquillian-Style Container Test

Arquillian adalah pendekatan klasik untuk menjalankan test dengan deployment ke container. Dokumentasi Arquillian menjelaskan integrasi dengan JUnit/TestNG dan kemampuan menjalankan test memakai IDE/build tool biasa.

Mental model:

```text
JUnit/TestNG test
      │
      ▼
Arquillian runner/extension
      │
      ▼
ShrinkWrap deployment archive
      │
      ▼
managed/remote/embedded container
      │
      ▼
test invokes managed component
```

Contoh konseptual:

```java
@RunWith(Arquillian.class)
public class CaseCommandBeanIT {

    @Deployment
    public static Archive<?> deployment() {
        return ShrinkWrap.create(WebArchive.class)
                .addClasses(
                        CaseCommandBean.class,
                        CaseRepository.class,
                        TestDataSourceProducer.class
                )
                .addAsWebInfResource(EmptyAsset.INSTANCE, "beans.xml");
    }

    @EJB
    CaseCommandBean bean;

    @Test
    public void shouldRollbackOnRuntimeException() {
        assertThrows(RuntimeException.class, () -> bean.approveAndFail("CASE-001"));
        // assert DB state rolled back
    }
}
```

Kelebihan:

- mendekati runtime nyata;
- bisa mengetes EJB/JTA/resource injection;
- cocok untuk deployment validation.

Kekurangan:

- lebih lambat;
- setup kompleks;
- container adapter/version harus cocok;
- test failure bisa berasal dari packaging, bukan logic;
- perlu disiplin membatasi jumlah test.

Gunakan untuk test yang memang membutuhkan runtime semantics.

---

## 24. Testing App Server Modern: WildFly, Payara, Open Liberty, GlassFish, Quarkus, Helidon

Pendekatan testing bervariasi menurut runtime:

| Runtime | Testing style umum |
|---|---|
| WildFly/JBoss EAP | Arquillian, remote/managed container, integration test |
| Payara/GlassFish | Arquillian/container integration, deployment smoke |
| Open Liberty | dev mode, integration tests, server-managed test lifecycle |
| Quarkus | `@QuarkusTest`, build-time CDI model, profile/test resources |
| Helidon MP | CDI/MicroProfile testing utilities, config override |
| Plain Weld SE | CDI component tests without full Jakarta EE server |

Yang penting bukan tool favorit, tetapi fidelity terhadap risk.

Jika bug terkait CDI resolution, Weld/Quarkus test mungkin cukup. Jika bug terkait server JNDI datasource binding, harus deploy ke server. Jika bug terkait DB migration, gunakan DB integration. Jika bug terkait HTTP/security filter chain, gunakan HTTP-level test.

---

## 25. Testing Resource Injection dan JNDI

`@Resource` dan JNDI resource references sering gagal hanya saat deploy.

Contoh:

```java
@Resource(lookup = "java:comp/env/jdbc/AceasDS")
DataSource dataSource;
```

Risiko:

- name salah;
- resource belum dibind di server;
- namespace salah;
- datasource driver tidak tersedia;
- credential salah;
- pool config salah;
- transaction enlistment salah.

Testing strategy:

```text
pure unit test       -> repository logic with fake datasource? limited
DB integration test  -> SQL behavior with test datasource
server deploy test   -> JNDI binding and resource injection
smoke test           -> app can acquire connection and run SELECT 1
```

Jangan hanya mengetes repository dengan H2 jika production Oracle/Postgres memiliki behavior berbeda. H2 bisa berguna untuk fast feedback, tetapi bukan bukti final untuk SQL dialect/transaction behavior.

---

## 26. Testing Transaction Boundary

Transaction bug sering mahal.

Yang harus dites:

- commit success;
- rollback runtime exception;
- checked exception policy;
- nested service call;
- `REQUIRES_NEW` side effect;
- audit write policy;
- event after commit;
- timeout;
- optimistic lock;
- duplicate submit/idempotency.

Contoh transaction boundary risk:

```java
@Transactional
public void approve(CaseId caseId) {
    caseRepository.markApproved(caseId);
    auditRepository.insertAudit(caseId, "APPROVED");
    notificationGateway.sendApprovalEmail(caseId);
}
```

Jika email dikirim sebelum commit, ada risiko:

```text
email sent, DB rollback
```

Test harus membuktikan side effect eksternal tidak terjadi sebelum commit, atau desain memakai outbox.

Better design:

```text
transaction:
  update case
  insert audit
  insert outbox event
commit
outbox worker:
  send notification
```

Testing:

- transaction rollback tidak menghasilkan outbox committed;
- commit menghasilkan outbox event;
- worker idempotent;
- retry tidak menduplikasi notification.

---

## 27. Testing Configuration + Transaction + Feature Flag Combination

Bug enterprise sering muncul dari kombinasi, bukan satu komponen.

Contoh scenario:

```text
profile=uat
feature.new-routing=true
transaction.audit.requires-new=true
connector.timeout=500ms
```

Pertanyaan:

- apakah new router aktif?
- apakah audit ditulis dalam transaksi utama atau `REQUIRES_NEW`?
- apakah timeout terlalu kecil menyebabkan rollback?
- apakah failure connector memengaruhi commit?

Test matrix tidak boleh meledak. Pilih kombinasi berdasarkan risiko.

Teknik:

```text
1. test default safe behavior
2. test each high-risk flag once
3. test critical combination
4. test fallback path
5. test invalid config fail-fast
```

---

## 28. Contract Test untuk Runtime Assumptions

Contract test membuktikan asumsi terhadap boundary.

Contoh contract:

```text
PaymentGateway contract:
- timeout must map to RETRYABLE_FAILURE
- 400 response must map to NON_RETRYABLE_FAILURE
- duplicate request id must be idempotent
- correlation id must be sent
```

Interface:

```java
public interface PaymentGatewayContract {

    PaymentGateway gateway();

    @Test
    default void shouldMapTimeoutToRetryableFailure() {
        PaymentResult result = gateway().charge(timeoutRequest());
        assertEquals(FailureType.RETRYABLE, result.failureType());
    }
}
```

Implementasi test untuk real adapter, fake adapter, mock server adapter bisa memakai contract yang sama.

Ini penting untuk menjaga fake tidak menyimpang dari real behavior.

---

## 29. Testcontainers dan External Dependency

Untuk DB/queue/cache, Testcontainers sering lebih realistis daripada embedded fake.

Cocok untuk:

- PostgreSQL/MySQL/MariaDB;
- Kafka/RabbitMQ;
- Redis;
- localstack untuk sebagian AWS workflow;
- mock server HTTP.

Untuk Oracle, pilihan bisa lebih kompleks karena image/licensing/berat runtime. Jika production Oracle, gunakan test strategy yang realistis:

- unit test SQL builder/mapping;
- integration test pada Oracle-compatible environment bila memungkinkan;
- migration verification di environment database nyata;
- avoid relying solely on H2 compatibility mode.

Prinsip:

```text
Fake proves logic.
Container proves integration assumption.
Production-like environment proves operational compatibility.
```

---

## 30. Testing Async dan Context Propagation

Async test sering flaky jika tidak didesain.

Buruk:

```java
service.submitTask();
Thread.sleep(1000);
assertTrue(done);
```

Lebih baik:

```java
CountDownLatch latch = new CountDownLatch(1);
recordingSink.onRecord(record -> latch.countDown());

service.submitTask();

assertTrue(latch.await(2, TimeUnit.SECONDS));
```

Yang harus dites:

- task dieksekusi;
- exception tidak hilang diam-diam;
- context yang diperlukan terpropagasi;
- context yang tidak boleh terpropagasi tidak bocor;
- executor shutdown bersih;
- queue saturation behavior;
- timeout.

Jika memakai `ManagedExecutorService` atau MicroProfile Context Propagation, test harus meniru environment yang relevan atau dijalankan di runtime yang menyediakan context tersebut.

---

## 31. Testing Security Annotation dan Caller Context

Security test perlu membedakan:

- pure authorization policy;
- container security annotation;
- identity provider integration;
- token/session behavior;
- role mapping.

Pure policy:

```java
public final class CaseAccessPolicy {
    public boolean canApprove(UserPrincipal user, CaseSnapshot caze) {
        return user.hasRole("APPROVER") && caze.isAssignedTo(user.id());
    }
}
```

Container boundary:

```java
@RolesAllowed("APPROVER")
public void approve(String caseId) {
}
```

Test pure policy dengan unit test. Test annotation/security context dengan container/security test.

Jangan menganggap unit test role policy membuktikan `@RolesAllowed` aktif di runtime.

---

## 32. Testing Failure Injection

Top engineer tidak hanya mengetes happy path.

Failure injection matrix:

| Dependency | Failure | Expected |
|---|---|---|
| Config | missing required property | fail fast startup |
| Config | invalid integer | conversion/bootstrap failure |
| DB | connection timeout | retry/fail mapped correctly |
| DB | unique constraint | domain conflict result |
| Queue | unavailable | outbox remains pending |
| Feature flag | service down | explicit fallback |
| CDI | ambiguous bean | deployment fail |
| External HTTP | 500 | retryable failure |
| External HTTP | 400 | non-retryable failure |
| Async task | exception | observable failure, no silent loss |
| Transaction | runtime exception | rollback |
| Resource | JNDI missing | deployment/smoke failure |

Failure injection membuat architecture contract eksplisit.

---

## 33. Test Data Strategy

Enterprise tests sering gagal bukan karena logic, tetapi karena test data kacau.

Prinsip:

- data minimal;
- builder/factory eksplisit;
- avoid shared mutable fixtures;
- setiap test punya ownership data;
- cleanup deterministic;
- gunakan transaction rollback untuk test jika aman;
- hindari dependency pada order test;
- gunakan semantic IDs.

Contoh test data builder:

```java
CaseSnapshot highRiskCase = CaseSnapshotBuilder.aCase()
        .withCaseId("CASE-HIGH-RISK-001")
        .withRiskScore(RiskScore.high())
        .withUnresolvedFinding("FINDING-001")
        .assignedTo("OFFICER-001")
        .build();
```

Lebih baik daripada fixture JSON besar yang tidak jelas field mana yang relevan.

---

## 34. Naming Convention untuk Test

Nama test harus menyatakan behavior, bukan method implementation.

Kurang baik:

```java
@Test
void testApprove() {}
```

Lebih baik:

```java
@Test
void shouldRequireEscalationWhenHighRiskCaseHasUnresolvedFinding() {}

@Test
void shouldRollbackCaseUpdateWhenAuditInsertFails() {}

@Test
void shouldUseNewRouterWhenFeatureFlagEnabledForAgency() {}

@Test
void shouldFailStartupWhenRequiredPaymentBaseUrlIsMissing() {}
```

Nama test adalah dokumentasi runtime behavior.

---

## 35. Test Smell Catalog

### 35.1 Container Everywhere

Semua test bootstrap CDI/app server.

Dampak:

- lambat;
- flaky;
- feedback lambat;
- logic sulit dibedakan dari wiring.

Solusi:

- ekstrak pure domain logic;
- constructor injection;
- gunakan component test.

### 35.2 Mock Everything

Semua dependency dimock, bahkan value object/simple policy.

Dampak:

- test hanya memverifikasi call, bukan behavior;
- refactor internal memecahkan test;
- fake runtime confidence.

Solusi:

- gunakan fake/in-memory untuk dependency stateful;
- assert outcome;
- mock external side effect saja.

### 35.3 H2 Proves Production SQL

Test memakai H2 lalu menganggap SQL aman untuk Oracle/PostgreSQL.

Dampak:

- dialect mismatch;
- transaction behavior beda;
- locking beda;
- constraint behavior beda;
- CLOB/TIMESTAMP/sequence behavior beda.

Solusi:

- gunakan DB production-like untuk integration critical;
- batasi H2 untuk fast feedback non-critical;
- migration test di DB target.

### 35.4 Hidden Environment Dependency

Test pass di mesin A, gagal di CI.

Penyebab:

- env var lokal;
- timezone;
- locale;
- file path;
- port fixed;
- current date.

Solusi:

- inject `Clock`;
- explicit config source;
- random/free port;
- deterministic timezone;
- no hidden machine state.

### 35.5 Testing Implementation Instead of Contract

Test terlalu detail pada urutan internal call.

Solusi:

- test public behavior;
- gunakan contract test untuk adapter;
- verifikasi interaction hanya jika interaction adalah contract.

### 35.6 No Negative Tests

Hanya happy path.

Solusi:

- missing config;
- invalid config;
- duplicate request;
- unauthorized user;
- dependency unavailable;
- transaction rollback;
- feature flag off.

---

## 36. CI Pipeline Strategy

Jangan jalankan semua test berat di setiap tahap jika tidak perlu.

Contoh pipeline:

```text
Stage 1: compile + static analysis
  - javac/maven/gradle compile
  - dependency convergence
  - formatting/checkstyle

Stage 2: fast tests
  - pure unit tests
  - component tests
  - no container / no DB heavy

Stage 3: runtime slice tests
  - CDI tests
  - config tests
  - interceptor/decorator tests

Stage 4: integration tests
  - DB container
  - queue/cache
  - HTTP mock server

Stage 5: app-server deployment tests
  - WAR/EAR deploy smoke
  - JNDI resource smoke
  - EJB/JTA critical tests

Stage 6: E2E / journey tests
  - selected critical user journeys
  - not too many
```

Goal:

```text
fast feedback first, high fidelity before release
```

---

## 37. Coverage: Jangan Salah Paham

Coverage angka tinggi tidak otomatis berarti runtime aman.

Contoh:

```text
90% line coverage
0 test untuk CDI qualifier ambiguity
0 test untuk config missing
0 test untuk transaction rollback
0 test untuk JNDI resource binding
```

Ini berbahaya.

Lebih baik punya coverage yang mengukur:

- business rule branch;
- failure path;
- config contract;
- transaction behavior;
- runtime wiring;
- external adapter contract;
- migration/deployment smoke.

Coverage harus dibaca sebagai signal, bukan tujuan utama.

---

## 38. Testing Checklist per Component Type

### 38.1 Domain Policy

```text
[ ] pure unit test
[ ] edge cases
[ ] invalid input
[ ] deterministic clock if time-based
[ ] no container needed
```

### 38.2 CDI Application Service

```text
[ ] component test with fake dependency
[ ] CDI wiring test if qualifiers/producers involved
[ ] interceptor/decorator test if annotated
[ ] transaction boundary test if writes data
[ ] feature flag path test if conditional
```

### 38.3 Producer

```text
[ ] required config present
[ ] default config works
[ ] invalid config fails
[ ] qualifier correct
[ ] scope correct
[ ] disposer/cleanup tested if applicable
```

### 38.4 Interceptor

```text
[ ] invoked through CDI proxy
[ ] success path
[ ] failure path
[ ] ordering if multiple interceptors
[ ] self-invocation caveat covered
```

### 38.5 Decorator

```text
[ ] decorator active
[ ] delegate called
[ ] policy/enrichment applied
[ ] failure blocks delegate if required
[ ] order tested if multiple decorators
```

### 38.6 EJB

```text
[ ] invoked through EJB proxy
[ ] transaction attribute behavior
[ ] rollback behavior
[ ] security role behavior
[ ] async/timer behavior if used
[ ] pooling/state assumptions documented
```

### 38.7 Config/Profile/Feature Flag

```text
[ ] required values fail-fast
[ ] defaults explicit
[ ] profile-specific behavior tested
[ ] prod cannot use dev fallback
[ ] flag on/off/fallback tested
[ ] stale/remote failure behavior clear
```

---

## 39. Example: Regulatory Case Management Testing Map

Misalnya sistem enforcement lifecycle:

```text
Complaint intake -> screening -> case creation -> assignment -> investigation -> enforcement action -> appeal -> closure
```

Testing map:

| Area | Risk | Test |
|---|---|---|
| Screening policy | wrong eligibility decision | pure unit test |
| Case creation use case | missing audit/event | component test |
| Assignment policy decorator | assignment bypasses compliance rule | CDI decorator test |
| Investigation transaction | partial write on failure | JTA/container integration test |
| Appeal SLA config | wrong SLA by profile/agency | config/profile test |
| Feature flag new screening | wrong rollout agency | feature flag test |
| Audit interceptor | missing audit on exception | interceptor test |
| Notification outbox | duplicate notification | DB/integration test |
| Resource injection | wrong datasource | deployment smoke test |
| User journey | officer can complete flow | E2E selected journey |

Ini pola berpikir top-tier: test mengikuti risk map, bukan mengikuti framework secara buta.

---

## 40. Mini Reference Architecture untuk Testable CDI Code

```text
src/main/java
  domain/
    ApprovalPolicy.java                 // pure
    CaseStateMachine.java               // pure
  application/
    CaseApprovalUseCase.java            // CDI boundary
  infrastructure/
    JpaCaseRepository.java              // DB adapter
    HttpPaymentGateway.java             // external adapter
  runtime/
    RetryConfigProducer.java            // config producer
    AuditInterceptor.java               // cross-cutting
    ComplianceDecorator.java            // semantic wrapper

test/java
  domain/
    ApprovalPolicyTest.java             // pure unit
    CaseStateMachineTest.java           // pure unit
  application/
    CaseApprovalUseCaseTest.java        // component fake deps
  runtime/
    CaseApprovalCdiTest.java            // CDI wiring
    AuditInterceptorTest.java           // CDI proxy test
    RetryConfigProducerTest.java        // config test
  integration/
    JpaCaseRepositoryIT.java            // DB test
    CaseTransactionIT.java              // container/JTA test
  e2e/
    CaseApprovalJourneyIT.java          // selected journey
```

---

## 41. Mental Model Final

Testing enterprise runtime harus menjawab dua pertanyaan berbeda:

```text
1. Apakah logic benar?
2. Apakah runtime menjalankan logic dengan wiring, lifecycle, config, resource, transaction, dan context yang benar?
```

Jika dua pertanyaan itu dicampur, test suite menjadi lambat tetapi tetap tidak meyakinkan.

Model yang sehat:

```text
pure logic             -> unit test cepat
orchestration          -> component test dengan fake
CDI wiring             -> CDI test
config/profile/flag    -> runtime slice test
transaction/resource   -> container/integration test
external contract      -> contract/integration test
critical journey       -> E2E terbatas
```

Top 1% engineer tidak sekadar menambah jumlah test. Mereka mendesain test suite sebagai risk-control system.

---

## 42. Ringkasan

Di bagian ini kita mempelajari:

- mengapa enterprise Java testing harus dipetakan berdasarkan runtime risk;
- perbedaan pure unit, component, CDI test, app-server integration, dan E2E;
- mengapa constructor injection membuat test lebih bersih;
- bagaimana mengetes CDI bean resolution, producer, disposer, lifecycle, interceptor, decorator, event, scope;
- bagaimana mengetes MicroProfile Config, profile, dan feature flag;
- mengapa EJB transaction/security/timer/async membutuhkan container-level testing;
- kapan memakai Weld, Arquillian-style test, runtime-specific test, dan Testcontainers;
- bagaimana membuat pipeline test yang cepat tetapi tetap high fidelity;
- bagaimana menyusun test berdasarkan risk map, bukan berdasarkan framework hype.

---

## 43. Status Seri

Bagian selesai:

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
[x] Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources
[x] Part 025 — Configuration Fundamentals: Values, Secrets, Environments, and Runtime Contracts
[x] Part 026 — MicroProfile Config Deep Dive
[x] Part 027 — Profiles: Environment-Specific Behavior Without Code Forking
[x] Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery
[x] Part 029 — Conditional Beans and Runtime Selection Patterns
[x] Part 030 — Container Concurrency, Managed Executors, and Context Propagation
[x] Part 031 — Testing CDI, EJB, and Configuration-Heavy Code
```

Seri belum selesai.

Bagian berikutnya:

```text
Part 032 — Observability and Debugging of Dependency/Container Problems
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 030 — Container Concurrency, Managed Executors, and Context Propagation](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-032](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-032.md)
