# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-016

# Part 016 — Decorators: Semantic Wrapping of Business Interfaces

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Status seri: **belum selesai**  
> Part: **016 dari 035**  
> Target pembaca: engineer Java yang sudah paham OOP, Java runtime, dependency management, CDI core, scope, qualifier, producer, event, dan interceptor.  
> Fokus Java: Java 8 sampai Java 25, dengan perhatian khusus pada Java EE `javax.*` dan Jakarta EE `jakarta.*`.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi berikut:

1. object enterprise tidak selalu dibuat manual oleh `new`;
2. runtime/container dapat menemukan, membuat, menginjeksi, mem-proxy, dan menghancurkan object;
3. dependency resolution CDI bersifat type-safe melalui type + qualifier;
4. scope menentukan lifecycle dan visibility;
5. producer memberi cara programmatic untuk menyediakan object;
6. event memberi decoupling lokal berbasis payload;
7. interceptor memberi cross-cutting behavior di sekitar method invocation.

Sekarang kita masuk ke **decorator**.

Decorator sering disalahpahami karena namanya mirip dengan design pattern GoF “Decorator”. Secara konseptual memang serupa: membungkus behavior object lain. Tetapi di CDI, decorator punya aturan runtime yang spesifik:

- decorator adalah managed bean;
- decorator membungkus bean lain berdasarkan **business interface / decorated type**;
- decorator memiliki tepat satu **delegate injection point**;
- decorator dipakai untuk menambah atau mengubah behavior pada kontrak bisnis tertentu;
- decorator berbeda dari interceptor karena decorator sadar terhadap semantic interface, bukan sekadar invocation metadata.

Part ini tidak hanya mengajarkan `@Decorator` dan `@Delegate`. Tujuannya adalah membangun mental model: **kapan behavior harus menjadi method langsung, service composition, interceptor, decorator, event, atau policy object**.

---

## 1. Problem Yang Ingin Dipecahkan Decorator

Bayangkan sistem case management/regulatory enforcement.

Ada kontrak bisnis:

```java
public interface CaseSubmissionService {
    SubmissionResult submit(SubmitCaseCommand command);
}
```

Implementasi dasarnya:

```java
@ApplicationScoped
public class DefaultCaseSubmissionService implements CaseSubmissionService {
    @Override
    public SubmissionResult submit(SubmitCaseCommand command) {
        // validate aggregate state
        // persist case
        // create workflow task
        // return result
    }
}
```

Lalu muncul kebutuhan tambahan:

1. setiap submission harus menambahkan compliance check;
2. agency tertentu perlu enrichment data sebelum submit;
3. fitur baru hanya aktif untuk subset tenant;
4. ada audit regulatory yang harus menyimpan snapshot sebelum/after;
5. ada fallback behavior untuk legacy path;
6. behavior tambahan hanya relevan untuk `CaseSubmissionService`, bukan semua service.

Pilihan desain:

### Pilihan A — Masukkan semua logic ke implementasi utama

```java
public SubmissionResult submit(SubmitCaseCommand command) {
    compliancePolicy.check(command);
    enrichmentService.enrich(command);
    if (featureFlags.isEnabled("new-submit-flow")) {
        ...
    }
    auditService.before(command);
    SubmissionResult result = doSubmit(command);
    auditService.after(command, result);
    return result;
}
```

Masalah:

- core business flow tercampur concern tambahan;
- sulit membedakan mandatory invariant vs optional extension;
- kode makin bercabang;
- test menjadi berat;
- change kecil di policy memaksa ubah service utama;
- behavior tidak bisa diaktif/nonaktif via CDI secara bersih.

### Pilihan B — Pakai interceptor

```java
@Audited
@FeatureGated("new-submit-flow")
public SubmissionResult submit(...) { ... }
```

Bagus untuk cross-cutting concern generik. Tetapi interceptor bekerja pada level method invocation. Interceptor tahu:

- method apa dipanggil;
- parameter apa;
- annotation binding apa;
- target object apa;
- exception/result apa.

Namun interceptor tidak ideal jika behavior tambahan perlu memahami kontrak bisnis secara semantik, misalnya:

- `submit(command)` harus diubah menjadi `submit(enrichedCommand)`;
- result dari delegate perlu dimodifikasi sesuai business interface;
- wrapper hanya berlaku untuk `CaseSubmissionService`, bukan semua annotated method;
- logic tambahan lebih natural sebagai implementasi interface yang sama.

### Pilihan C — Pakai CDI decorator

Decorator membuat wrapper yang tetap berbicara dalam bahasa interface:

```java
@Decorator
@Priority(100)
public abstract class ComplianceCaseSubmissionDecorator implements CaseSubmissionService {

    @Inject
    @Delegate
    CaseSubmissionService delegate;

    @Inject
    CompliancePolicy compliancePolicy;

    @Override
    public SubmissionResult submit(SubmitCaseCommand command) {
        compliancePolicy.check(command);
        return delegate.submit(command);
    }
}
```

Keuntungannya:

- behavior tambahan tetap type-safe;
- wrapper memahami interface bisnis;
- implementasi utama tetap fokus;
- bisa disusun sebagai chain;
- bisa diaktifkan/dinonaktifkan lewat mekanisme CDI;
- cocok untuk semantic extension.

Mental model utama:

> **Interceptor membungkus invocation. Decorator membungkus contract.**

---

## 2. Decorator Dalam CDI: Definisi Konseptual

Dalam CDI, decorator adalah managed bean yang:

1. diberi annotation `@Decorator`;
2. mengimplementasikan satu atau lebih interface yang akan didekorasi;
3. memiliki tepat satu injection point dengan `@Delegate`;
4. delegate tersebut adalah object target yang dibungkus;
5. method decorator dapat menjalankan logic sebelum/sesudah/menggantikan delegasi.

Pola besarnya:

```text
Caller
  |
  v
CDI client proxy
  |
  v
Decorator N
  |
  v
Decorator N-1
  |
  v
Decorator ...
  |
  v
Original bean implementation
```

Contoh minimal:

```java
public interface PaymentService {
    PaymentResult pay(PaymentCommand command);
}
```

```java
@ApplicationScoped
public class DefaultPaymentService implements PaymentService {
    @Override
    public PaymentResult pay(PaymentCommand command) {
        return PaymentResult.success();
    }
}
```

```java
@Decorator
@Priority(100)
public abstract class FraudCheckPaymentDecorator implements PaymentService {

    @Inject
    @Delegate
    PaymentService delegate;

    @Inject
    FraudPolicy fraudPolicy;

    @Override
    public PaymentResult pay(PaymentCommand command) {
        fraudPolicy.assertAllowed(command);
        return delegate.pay(command);
    }
}
```

Ketika code lain melakukan:

```java
@Inject
PaymentService paymentService;
```

object yang dipanggil bukan langsung `DefaultPaymentService`, tetapi chain yang mencakup decorator aktif.

---

## 3. Package `javax.*` vs `jakarta.*`

Untuk Java EE/CDI lama:

```java
import javax.decorator.Decorator;
import javax.decorator.Delegate;
import javax.inject.Inject;
import javax.annotation.Priority;
```

Untuk Jakarta EE modern:

```java
import jakarta.decorator.Decorator;
import jakarta.decorator.Delegate;
import jakarta.inject.Inject;
import jakarta.annotation.Priority;
```

Konsepnya mirip, tetapi namespace tidak binary-compatible.

Jangan mencampur:

```java
import jakarta.decorator.Decorator;
import javax.decorator.Delegate; // buruk: mixed namespace
```

Jika runtime sudah Jakarta EE 10/11, gunakan `jakarta.*`. Jika aplikasi legacy masih Java EE 8, gunakan `javax.*` secara konsisten.

---

## 4. Decorator Bukan Sekadar “Interceptor Dengan Cara Lain”

Perbedaan paling penting:

| Aspek | Interceptor | Decorator |
|---|---|---|
| Fokus | method invocation | business interface / decorated type |
| Binding | annotation binding | assignability ke delegate type |
| Cocok untuk | logging, tracing, metrics, transaction-like concern, retry generic | business semantic wrapping, enrichment, policy, fallback, compliance layer |
| Akses kontrak | lewat `InvocationContext`, reflection-ish | langsung typed method interface |
| Kekuatan utama | reusable lintas banyak method/class | semantic wrapper untuk satu kontrak bisnis |
| Risiko | terlalu generic dan magic | terlalu banyak layer wrapper tersembunyi |
| Bias desain | technical cross-cutting | business/domain cross-cutting |

Contoh concern yang cocok untuk interceptor:

```java
@Audited
@Timed
@Retryable
public SubmissionResult submit(SubmitCaseCommand command) { ... }
```

Contoh concern yang cocok untuk decorator:

```java
public class ComplianceSubmissionDecorator implements CaseSubmissionService {
    public SubmissionResult submit(SubmitCaseCommand command) {
        compliancePolicy.assertSubmissionAllowed(command);
        return delegate.submit(command);
    }
}
```

Kenapa compliance bisa lebih cocok decorator daripada interceptor?

Karena compliance policy mungkin bukan sekadar “sebelum method apapun dipanggil”. Ia terikat pada semantic `submit case`:

- command punya meaning;
- result punya meaning;
- exception punya meaning;
- rule bisa berbeda untuk `submit`, `withdraw`, `approve`, `reject`;
- wrapper harus tetap terbaca sebagai bagian dari contract behavior.

---

## 5. Bentuk Dasar CDI Decorator

Struktur wajib:

```java
@Decorator
@Priority(100)
public abstract class SomeDecorator implements SomeInterface {

    @Inject
    @Delegate
    SomeInterface delegate;

    @Override
    public ReturnType operation(Input input) {
        // before
        ReturnType result = delegate.operation(input);
        // after
        return result;
    }
}
```

Kenapa sering `abstract`?

Karena interface mungkin punya banyak method, dan decorator tidak harus mendekorasi semuanya. Dengan membuat class `abstract`, decorator dapat override hanya method yang ia pedulikan. Method lain tetap dianggap tidak diimplementasikan oleh class decorator, dan container/runtime menangani dekorasi pada method yang relevan sesuai model CDI.

Namun dalam praktik modern, terutama untuk readability, sering lebih baik tetap implement method yang penting secara eksplisit. Jika interface kecil, implement semua method agar behavior jelas.

---

## 6. `@Delegate`: Injection Point Khusus

`@Delegate` menandai dependency yang akan dibungkus oleh decorator.

```java
@Inject
@Delegate
PaymentService delegate;
```

Aturan penting:

1. decorator harus punya tepat satu delegate injection point;
2. delegate bisa berupa field injection;
3. delegate bisa berupa parameter initializer method;
4. delegate bisa berupa parameter constructor;
5. delegate menentukan bean mana yang eligible untuk didekorasi;
6. qualifier pada delegate memengaruhi matching.

Contoh constructor delegate:

```java
@Decorator
@Priority(100)
public abstract class FraudCheckPaymentDecorator implements PaymentService {

    private final PaymentService delegate;
    private final FraudPolicy fraudPolicy;

    @Inject
    public FraudCheckPaymentDecorator(
            @Delegate PaymentService delegate,
            FraudPolicy fraudPolicy
    ) {
        this.delegate = delegate;
        this.fraudPolicy = fraudPolicy;
    }

    @Override
    public PaymentResult pay(PaymentCommand command) {
        fraudPolicy.assertAllowed(command);
        return delegate.pay(command);
    }
}
```

Field injection umum dijumpai di contoh spesifikasi/tutorial, tetapi constructor injection sering lebih eksplisit untuk dependency biasa. Untuk decorator, penggunaan constructor injection perlu dicek terhadap provider/runtime yang dipakai, terutama pada kombinasi versi lama.

---

## 7. Decorated Type: Interface Adalah Boundary Utama

Decorator CDI biasanya bekerja melalui interface.

Contoh:

```java
public interface NotificationSender {
    void send(Notification notification);
}
```

```java
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // send email
    }
}
```

```java
@Decorator
@Priority(100)
public abstract class AuditNotificationSenderDecorator implements NotificationSender {

    @Inject
    @Delegate
    NotificationSender delegate;

    @Inject
    NotificationAudit audit;

    @Override
    public void send(Notification notification) {
        audit.beforeSend(notification);
        try {
            delegate.send(notification);
            audit.afterSuccess(notification);
        } catch (RuntimeException ex) {
            audit.afterFailure(notification, ex);
            throw ex;
        }
    }
}
```

Decorator berlaku untuk bean yang assignable ke delegate type.

Jika ada dua implementasi:

```java
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender { ... }

@ApplicationScoped
public class SmsNotificationSender implements NotificationSender { ... }
```

Decorator dengan delegate:

```java
@Inject
@Delegate
NotificationSender delegate;
```

berpotensi mendekorasi keduanya, tergantung qualifier dan injection target.

Jika decorator hanya untuk email sender, gunakan qualifier.

---

## 8. Qualifier Pada Decorator

Misalnya:

```java
@Qualifier
@Retention(RUNTIME)
@Target({TYPE, FIELD, PARAMETER, METHOD})
public @interface EmailChannel {}
```

```java
@EmailChannel
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender { ... }
```

Decorator:

```java
@Decorator
@Priority(100)
public abstract class EmailAuditDecorator implements NotificationSender {

    @Inject
    @Delegate
    @EmailChannel
    NotificationSender delegate;

    @Inject
    AuditService auditService;

    @Override
    public void send(Notification notification) {
        auditService.record("email-send-attempt", notification.id());
        delegate.send(notification);
    }
}
```

Injection:

```java
@Inject
@EmailChannel
NotificationSender sender;
```

Dengan cara ini, decorator tidak menjadi global untuk semua `NotificationSender`.

Mental model:

> Delegate type + delegate qualifier menentukan area dekorasi.

---

## 9. Mengaktifkan Decorator

Ada beberapa pendekatan tergantung versi CDI/runtime.

### 9.1 Dengan `beans.xml`

Model lama/portable:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/beans_4_0.xsd"
       bean-discovery-mode="annotated"
       version="4.0">

    <decorators>
        <class>com.example.payment.FraudCheckPaymentDecorator</class>
        <class>com.example.payment.AuditPaymentDecorator</class>
    </decorators>
</beans>
```

Kelebihan:

- explicit;
- urutan dapat terlihat;
- cocok untuk aplikasi enterprise yang ingin deployment descriptor sebagai control plane.

Kekurangan:

- XML harus sinkron dengan class;
- refactor package bisa lupa update;
- terasa kurang modern.

### 9.2 Dengan `@Priority`

```java
@Decorator
@Priority(100)
public abstract class FraudCheckPaymentDecorator implements PaymentService { ... }
```

Kelebihan:

- self-contained;
- mudah dibaca di class decorator;
- ordering bisa lewat angka priority.

Catatan penting:

- semakin kecil priority biasanya semakin awal dalam chain, tetapi selalu cek semantics runtime/spec yang dipakai;
- jangan asal memilih angka tanpa convention;
- gunakan range priority yang konsisten di project.

Contoh convention:

```text
1000 - mandatory regulatory/compliance wrapper
2000 - security/policy wrapper
3000 - enrichment wrapper
4000 - audit domain wrapper
5000 - fallback/compatibility wrapper
```

Atau gunakan angka kecil untuk paling luar, angka besar untuk makin dekat delegate. Yang penting: tim punya aturan eksplisit.

---

## 10. Chain Decorator

Misalnya ada tiga decorator:

```text
Caller
  -> ComplianceDecorator
      -> FeatureFlagDecorator
          -> AuditDecorator
              -> DefaultCaseSubmissionService
```

Call flow:

```text
submit(command)

ComplianceDecorator.submit
  check compliance
  FeatureFlagDecorator.submit
    choose new/old mode
    AuditDecorator.submit
      audit before
      DefaultCaseSubmissionService.submit
      audit after
```

Urutan chain sangat penting.

Contoh dampak ordering:

### Audit di luar compliance

```text
Audit
  -> Compliance
      -> Service
```

Audit merekam attempt meski compliance gagal.

### Compliance di luar audit

```text
Compliance
  -> Audit
      -> Service
```

Jika compliance gagal, audit mungkin tidak terekam.

Tidak ada jawaban universal. Untuk sistem regulatory, attempt yang gagal karena compliance rule sering tetap perlu audit. Jadi audit sebaiknya di luar compliance, atau compliance sendiri mencatat denial. Keputusan ini bukan teknis semata; ini runtime policy.

---

## 11. Decorator vs Classic Manual Decorator

Manual decorator:

```java
PaymentService service = new AuditPaymentService(
    new FraudCheckPaymentService(
        new DefaultPaymentService()
    )
);
```

CDI decorator:

```java
@Inject
PaymentService service;
```

Container membangun chain berdasarkan metadata.

Kelebihan CDI decorator:

- terintegrasi dengan DI;
- decorator sendiri bisa inject dependency;
- activation bisa dikontrol declaratively;
- consistent dengan CDI resolution;
- bisa dikelola container lifecycle.

Kekurangan CDI decorator:

- chain tidak terlihat dari constructor composition biasa;
- debugging butuh paham CDI;
- ordering bisa tersembunyi;
- terlalu banyak decorator membuat runtime behavior sulit ditebak;
- kurang cocok untuk logic yang harus eksplisit per use case.

Rule praktis:

> Kalau wrapper adalah bagian penting dari architecture runtime dan berlaku konsisten untuk kontrak interface, CDI decorator masuk akal. Kalau wrapper hanya composition lokal yang harus terlihat jelas di satu use case, manual composition atau explicit service lebih baik.

---

## 12. Decorator Sebagai Semantic Boundary

Decorator cocok saat behavior tambahan adalah “semantic boundary”.

Contoh dalam regulatory workflow:

```java
public interface EnforcementActionService {
    EnforcementResult initiate(InitiateEnforcementCommand command);
    EnforcementResult escalate(EscalateEnforcementCommand command);
    EnforcementResult close(CloseEnforcementCommand command);
}
```

Decorator compliance:

```java
@Decorator
@Priority(1000)
public abstract class EnforcementComplianceDecorator implements EnforcementActionService {

    @Inject
    @Delegate
    EnforcementActionService delegate;

    @Inject
    EnforcementPolicy policy;

    @Override
    public EnforcementResult initiate(InitiateEnforcementCommand command) {
        policy.assertCanInitiate(command);
        return delegate.initiate(command);
    }

    @Override
    public EnforcementResult escalate(EscalateEnforcementCommand command) {
        policy.assertCanEscalate(command);
        return delegate.escalate(command);
    }

    @Override
    public EnforcementResult close(CloseEnforcementCommand command) {
        policy.assertCanClose(command);
        return delegate.close(command);
    }
}
```

Ini lebih baik daripada interceptor generik seperti:

```java
@PolicyChecked
public EnforcementResult escalate(...) { ... }
```

kenapa?

Karena setiap method punya semantic policy berbeda. Decorator tetap type-safe dan readable.

---

## 13. Use Case 1 — Compliance Wrapper

Interface:

```java
public interface CaseDecisionService {
    DecisionResult approve(ApproveCaseCommand command);
    DecisionResult reject(RejectCaseCommand command);
}
```

Implementasi utama:

```java
@ApplicationScoped
public class DefaultCaseDecisionService implements CaseDecisionService {

    @Override
    public DecisionResult approve(ApproveCaseCommand command) {
        // update aggregate
        // persist decision
        // create notification
        return DecisionResult.approved(command.caseId());
    }

    @Override
    public DecisionResult reject(RejectCaseCommand command) {
        // update aggregate
        // persist decision
        // create notification
        return DecisionResult.rejected(command.caseId());
    }
}
```

Decorator:

```java
@Decorator
@Priority(1000)
public abstract class ComplianceCaseDecisionDecorator implements CaseDecisionService {

    @Inject
    @Delegate
    CaseDecisionService delegate;

    @Inject
    DecisionCompliancePolicy compliancePolicy;

    @Override
    public DecisionResult approve(ApproveCaseCommand command) {
        compliancePolicy.assertApprovalAllowed(command);
        return delegate.approve(command);
    }

    @Override
    public DecisionResult reject(RejectCaseCommand command) {
        compliancePolicy.assertRejectionAllowed(command);
        return delegate.reject(command);
    }
}
```

Keuntungan:

- default service tidak bercampur compliance orchestration;
- compliance logic tetap strongly typed;
- policy bisa diuji terpisah;
- decorator bisa dinonaktifkan/diganti saat migrasi/test;
- invariant runtime menjadi eksplisit.

Risiko:

- developer baru mungkin tidak sadar approval melewati decorator;
- observability harus menampilkan active decorator chain;
- ordering dengan audit/security harus dirancang.

---

## 14. Use Case 2 — Feature Flag Wrapper

Misalnya ada interface:

```java
public interface AddressLookupService {
    Address lookupByPostalCode(String postalCode);
}
```

Ada implementasi default:

```java
@ApplicationScoped
public class DefaultAddressLookupService implements AddressLookupService {
    @Override
    public Address lookupByPostalCode(String postalCode) {
        // legacy lookup
    }
}
```

Decorator feature flag:

```java
@Decorator
@Priority(3000)
public abstract class NewAddressLookupFeatureDecorator implements AddressLookupService {

    @Inject
    @Delegate
    AddressLookupService delegate;

    @Inject
    FeatureFlagService flags;

    @Inject
    NewAddressLookupClient newClient;

    @Override
    public Address lookupByPostalCode(String postalCode) {
        if (!flags.enabled("new-address-lookup")) {
            return delegate.lookupByPostalCode(postalCode);
        }

        try {
            return newClient.lookup(postalCode);
        } catch (RuntimeException ex) {
            // fallback decision must be intentional
            return delegate.lookupByPostalCode(postalCode);
        }
    }
}
```

Ini pattern yang kuat tetapi berisiko.

Pertanyaan desain:

1. Apakah fallback boleh silent?
2. Apakah fallback harus diaudit?
3. Apakah failure new client harus memicu alert?
4. Apakah flag decision harus konsisten per request?
5. Apakah decision context perlu tenant/user/agency?
6. Apakah ada risiko data mismatch antara new path dan old path?

Top engineer tidak hanya membuat decorator. Ia mendefinisikan **runtime decision contract**.

---

## 15. Use Case 3 — Audit Domain Decorator

Audit teknis bisa interceptor. Audit domain sering lebih cocok decorator.

### Technical audit dengan interceptor

```java
@Audited
public SubmissionResult submit(SubmitCaseCommand command) { ... }
```

Interceptor mencatat:

- method name;
- duration;
- exception;
- request id.

### Domain audit dengan decorator

```java
@Decorator
@Priority(900)
public abstract class DomainAuditSubmissionDecorator implements CaseSubmissionService {

    @Inject
    @Delegate
    CaseSubmissionService delegate;

    @Inject
    CaseAuditTrail auditTrail;

    @Override
    public SubmissionResult submit(SubmitCaseCommand command) {
        AuditRecord start = auditTrail.recordSubmissionAttempt(command);
        try {
            SubmissionResult result = delegate.submit(command);
            auditTrail.recordSubmissionSuccess(start, result);
            return result;
        } catch (RuntimeException ex) {
            auditTrail.recordSubmissionFailure(start, ex);
            throw ex;
        }
    }
}
```

Kenapa decorator?

Karena audit record bukan sekadar “method called”. Ia punya semantic:

- submission attempt;
- case id;
- applicant id;
- agency;
- regulatory action;
- decision state;
- actor role;
- before/after transition.

Decorator membuat semantic audit tetap explicit di interface boundary.

---

## 16. Use Case 4 — Backward Compatibility Wrapper

Saat migrasi legacy ke modern flow, decorator bisa menjadi compatibility layer.

```java
public interface RenewalService {
    RenewalResult renew(RenewalCommand command);
}
```

```java
@Decorator
@Priority(5000)
public abstract class LegacyRenewalCompatibilityDecorator implements RenewalService {

    @Inject
    @Delegate
    RenewalService delegate;

    @Inject
    LegacyRenewalMapper mapper;

    @Override
    public RenewalResult renew(RenewalCommand command) {
        RenewalCommand normalized = mapper.normalizeLegacyFields(command);
        RenewalResult result = delegate.renew(normalized);
        return mapper.enrichLegacyResponse(result);
    }
}
```

Kegunaan:

- menjaga service utama tetap modern;
- memindahkan legacy compatibility ke boundary;
- memudahkan penghapusan saat legacy tidak diperlukan;
- mengurangi `if (legacy)` di core service.

Risiko:

- compatibility behavior tersembunyi;
- bisa membuat data terlihat “benar” padahal input upstream belum bersih;
- bisa memperpanjang umur legacy secara tidak sadar.

Tambahkan expiry policy:

```java
/**
 * Temporary decorator for legacy renewal payload compatibility.
 * Remove after agency X completes payload migration.
 * Owner: Renewal module team.
 * Target removal: 2026-Q4.
 */
```

---

## 17. Use Case 5 — Authorization / Policy Enforcement

Authorization sering bisa annotation/interceptor:

```java
@RolesAllowed("CASE_APPROVER")
public DecisionResult approve(...) { ... }
```

Namun business authorization yang kompleks bisa lebih cocok decorator.

```java
@Decorator
@Priority(800)
public abstract class CaseDecisionAuthorizationDecorator implements CaseDecisionService {

    @Inject
    @Delegate
    CaseDecisionService delegate;

    @Inject
    CurrentUser currentUser;

    @Inject
    CaseAccessPolicy accessPolicy;

    @Override
    public DecisionResult approve(ApproveCaseCommand command) {
        accessPolicy.assertCanApprove(currentUser.get(), command.caseId());
        return delegate.approve(command);
    }

    @Override
    public DecisionResult reject(RejectCaseCommand command) {
        accessPolicy.assertCanReject(currentUser.get(), command.caseId());
        return delegate.reject(command);
    }
}
```

Perbedaan:

- `@RolesAllowed` cocok untuk coarse-grained role;
- decorator cocok untuk fine-grained policy: owner, assignment, agency, state, risk tier, escalation path.

---

## 18. Decorator dan Transaction Boundary

Pertanyaan penting:

> Apakah decorator berjalan di dalam atau di luar transaction?

Jawaban tergantung transaction interceptor/annotation ditempatkan di mana dan bagaimana container menyusun invocation chain.

Misalnya service:

```java
@Transactional
public class DefaultCaseSubmissionService implements CaseSubmissionService { ... }
```

Decorator:

```java
@Decorator
public class AuditDecorator implements CaseSubmissionService { ... }
```

Kemungkinan yang perlu dipahami:

1. transaction dimulai saat invocation masuk ke bean target;
2. decorator bisa berada di luar transaction;
3. decorator sendiri bisa diberi annotation transaction jika container mendukung sesuai rules;
4. audit before/after mungkin terjadi di transaction yang sama atau berbeda tergantung desain.

Untuk enterprise production, jangan menebak. Buat test integration yang memastikan:

- apakah audit rollback bersama business data;
- apakah audit failure menggagalkan business operation;
- apakah compliance check dilakukan sebelum transaction dibuka;
- apakah external call terjadi di dalam transaction;
- apakah decorator memanggil delegate tepat sekali.

Rule praktis:

- compliance validation biasanya boleh sebelum transaction;
- domain mutation harus jelas transactional boundary-nya;
- external call sebaiknya tidak berada di transaction database panjang;
- audit regulatory bisa butuh transaction terpisah atau outbox, tergantung kebutuhan defensibility.

---

## 19. Decorator dan Exception Semantics

Decorator tidak boleh sembarangan menangkap exception.

Buruk:

```java
@Override
public SubmissionResult submit(SubmitCaseCommand command) {
    try {
        return delegate.submit(command);
    } catch (Exception ex) {
        return SubmissionResult.failed("Something went wrong");
    }
}
```

Masalah:

- menyembunyikan error;
- merusak transaction rollback;
- caller tidak bisa membedakan validation error vs infra error;
- observability hilang;
- compliance/audit bisa salah.

Lebih baik:

```java
@Override
public SubmissionResult submit(SubmitCaseCommand command) {
    try {
        return delegate.submit(command);
    } catch (BusinessRuleViolation ex) {
        audit.recordBusinessRejection(command, ex);
        throw ex;
    } catch (RuntimeException ex) {
        audit.recordTechnicalFailure(command, ex);
        throw ex;
    }
}
```

Decorator boleh mengubah exception hanya jika itu bagian dari contract.

Contoh acceptable:

```java
catch (ExternalProviderTimeoutException ex) {
    throw new AddressLookupUnavailableException(command.postalCode(), ex);
}
```

Karena decorator berperan sebagai adapter semantic boundary.

---

## 20. Decorator dan Idempotency

Decorator bisa menjadi tempat idempotency boundary jika idempotency melekat pada interface operation.

```java
public interface PaymentExecutionService {
    PaymentResult execute(PaymentCommand command);
}
```

Decorator:

```java
@Decorator
@Priority(700)
public abstract class IdempotentPaymentDecorator implements PaymentExecutionService {

    @Inject
    @Delegate
    PaymentExecutionService delegate;

    @Inject
    IdempotencyStore store;

    @Override
    public PaymentResult execute(PaymentCommand command) {
        String key = command.idempotencyKey();

        return store.getOrExecute(key, () -> delegate.execute(command));
    }
}
```

Pertanyaan penting:

1. Apakah idempotency key wajib?
2. Apakah response disimpan?
3. Apakah exception disimpan?
4. Apakah retry setelah timeout harus return result lama?
5. Apakah operation sudah mencapai provider eksternal?
6. Apakah idempotency store transactionally consistent?

Decorator hanya tempatnya. Correctness tetap perlu desain state machine.

---

## 21. Decorator dan Caching

Caching bisa interceptor, decorator, atau explicit service.

Decorator caching:

```java
@Decorator
@Priority(4000)
public abstract class CachedPostalCodeLookupDecorator implements AddressLookupService {

    @Inject
    @Delegate
    AddressLookupService delegate;

    @Inject
    PostalCodeCache cache;

    @Override
    public Address lookupByPostalCode(String postalCode) {
        return cache.getOrLoad(postalCode, () -> delegate.lookupByPostalCode(postalCode));
    }
}
```

Kapan decorator cocok?

- cache key semantic terhadap interface;
- caching hanya untuk service tertentu;
- fallback/stale behavior butuh domain awareness;
- result normalization butuh kontrak bisnis.

Kapan interceptor lebih cocok?

- caching generik berbasis annotation;
- key expression sederhana;
- banyak method punya policy sama.

Kapan explicit service lebih baik?

- cache adalah bagian utama domain flow;
- cache invalidation kompleks;
- cache consistency harus sangat jelas;
- operation melibatkan distributed lock/in-flight dedup.

---

## 22. Decorator dan Observability

Decorator chain tersembunyi jika tidak diobservasi.

Untuk production-grade runtime, minimal lakukan:

1. log active decorator saat startup;
2. expose diagnostic endpoint internal untuk bean/feature config jika aman;
3. metric per decorator jika behavior penting;
4. trace span untuk decorator yang melakukan I/O atau policy heavy;
5. audit decision untuk decorator compliance/authorization/feature flag.

Contoh manual startup log:

```java
@ApplicationScoped
public class RuntimeWiringLogger {

    void onStart(@Observes StartupEvent event) {
        // vendor-specific in many runtimes; pseudo example
        log.info("CaseSubmissionService decorators: Compliance -> FeatureFlag -> Audit -> Default");
    }
}
```

Jika tidak ada portable introspection yang nyaman, dokumentasikan chain sebagai architecture contract.

---

## 23. Decorator dan Self-Invocation

Self-invocation problem tetap relevan.

Misalnya:

```java
@ApplicationScoped
public class DefaultCaseDecisionService implements CaseDecisionService {

    @Override
    public DecisionResult approve(ApproveCaseCommand command) {
        return internalApprove(command);
    }

    public DecisionResult internalApprove(ApproveCaseCommand command) {
        ...
    }
}
```

Jika decorator hanya mendekorasi `approve`, call dari luar ke `approve` melewati decorator. Tetapi call internal di dalam class tidak otomatis melewati proxy/decorator chain.

Lebih berbahaya:

```java
@Override
public DecisionResult approve(ApproveCaseCommand command) {
    validate(command); // internal method not decorated/intercepted
    ...
}
```

Jika `validate` sebenarnya butuh cross-cutting behavior, jangan andalkan decorator/interceptor pada self-call.

Rule:

> Decorator bekerja pada invocation yang melewati CDI-managed reference. Panggilan internal langsung adalah Java call biasa.

---

## 24. Decorator Dengan Multiple Implementations

Interface:

```java
public interface DocumentRenderer {
    RenderedDocument render(DocumentTemplate template, Map<String, Object> data);
}
```

Implementasi:

```java
@Pdf
@ApplicationScoped
public class PdfDocumentRenderer implements DocumentRenderer { ... }

@Html
@ApplicationScoped
public class HtmlDocumentRenderer implements DocumentRenderer { ... }
```

Decorator global:

```java
@Decorator
@Priority(1000)
public abstract class AuditDocumentRendererDecorator implements DocumentRenderer {

    @Inject
    @Delegate
    DocumentRenderer delegate;

    @Override
    public RenderedDocument render(DocumentTemplate template, Map<String, Object> data) {
        ...
        return delegate.render(template, data);
    }
}
```

Decorator specific PDF:

```java
@Decorator
@Priority(900)
public abstract class PdfComplianceRendererDecorator implements DocumentRenderer {

    @Inject
    @Delegate
    @Pdf
    DocumentRenderer delegate;

    @Override
    public RenderedDocument render(DocumentTemplate template, Map<String, Object> data) {
        ...
        return delegate.render(template, data);
    }
}
```

Injection:

```java
@Inject
@Pdf
DocumentRenderer pdfRenderer;

@Inject
@Html
DocumentRenderer htmlRenderer;
```

Design decision:

- global audit applies to all renderers;
- PDF compliance applies only to PDF;
- ordering harus jelas jika keduanya aktif.

---

## 25. Decorator, `@Alternative`, dan Testing

Dalam test, Anda mungkin ingin mengganti service utama atau decorator.

Misalnya production:

```java
@ApplicationScoped
public class DefaultNotificationSender implements NotificationSender { ... }
```

Test alternative:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class InMemoryNotificationSender implements NotificationSender {
    ...
}
```

Pertanyaan:

> Apakah decorator production tetap mendekorasi test alternative?

Bisa iya, jika alternative assignable ke delegate type dan qualifier cocok.

Ini kadang bagus:

- test tetap memverifikasi audit wrapper;
- test tetap memverifikasi compliance wrapper.

Kadang buruk:

- unit test ingin isolated fake tanpa wrapper;
- decorator memanggil dependency production;
- test menjadi integration test tanpa sadar.

Strategi:

1. pisahkan unit test pure Java untuk decorator;
2. buat container test untuk chain wiring;
3. gunakan qualifier/test profile untuk menonaktifkan decorator jika perlu;
4. hindari decorator yang melakukan I/O berat tanpa abstraction.

---

## 26. Testing Decorator Sebagai Pure Unit

Decorator bisa dites sebagai class biasa jika dependency disuntik manual.

```java
class ComplianceCaseDecisionDecoratorTest {

    @Test
    void approve_rejects_when_policy_fails() {
        FakeDelegate delegate = new FakeDelegate();
        FakePolicy policy = new FakePolicy(false);

        ComplianceCaseDecisionDecorator decorator = new TestableComplianceDecorator(delegate, policy);

        assertThrows(BusinessRuleViolation.class,
            () -> decorator.approve(new ApproveCaseCommand("CASE-1")));

        assertFalse(delegate.called);
    }

    static class TestableComplianceDecorator extends ComplianceCaseDecisionDecorator {
        TestableComplianceDecorator(CaseDecisionService delegate, DecisionCompliancePolicy policy) {
            this.delegate = delegate;
            this.compliancePolicy = policy;
        }
    }
}
```

Jika field private, test jadi susah. Itulah salah satu alasan constructor injection atau protected field kadang dipilih dalam contoh decorator.

Namun hati-hati: membuat field protected demi test bukan selalu desain terbaik. Alternatifnya:

- pisahkan logic ke policy/service biasa;
- decorator hanya orchestration tipis;
- test policy secara detail;
- test decorator chain dengan integration test minimal.

---

## 27. Testing Decorator Chain Dengan Container

Container test perlu menjawab:

1. decorator aktif atau tidak;
2. urutan decorator benar;
3. qualifier matching benar;
4. delegate dipanggil tepat sekali;
5. exception propagation benar;
6. behavior transactional sesuai harapan;
7. mock/test alternative tetap didekorasi atau tidak sesuai desain.

Pseudo test:

```java
@Inject
CaseSubmissionService service;

@Test
void submission_goes_through_compliance_and_audit() {
    SubmitCaseCommand command = validCommand();

    SubmissionResult result = service.submit(command);

    assertTrue(complianceProbe.wasChecked(command.caseId()));
    assertTrue(auditProbe.wasRecorded(command.caseId()));
    assertTrue(delegateProbe.wasCalled(command.caseId()));
}
```

Untuk runtime seperti Weld JUnit, Arquillian, Open Liberty test, Payara embedded, WildFly Arquillian, atau Quarkus test, detail setup berbeda. Yang penting adalah contract test-nya.

---

## 28. Common Failure: Decorator Tidak Aktif

Gejala:

- method delegate langsung terpanggil;
- audit/compliance tidak jalan;
- breakpoint decorator tidak kena.

Kemungkinan penyebab:

1. decorator belum di-enable;
2. tidak ada `@Priority` dan tidak terdaftar di `beans.xml`;
3. class decorator tidak masuk bean archive;
4. package namespace salah `javax` vs `jakarta`;
5. delegate type/qualifier tidak match;
6. injection target memakai concrete class, bukan interface;
7. bean target tidak managed oleh CDI;
8. call dibuat dengan `new`, bukan injected reference;
9. runtime menggunakan CDI Lite subset/vendor mode dengan batas tertentu;
10. deployment tidak memuat module/JAR decorator.

Diagnostic checklist:

```text
[ ] Apakah decorator class ada di artifact deployed?
[ ] Apakah decorator class discoverable sebagai bean?
[ ] Apakah ada @Decorator?
[ ] Apakah ada @Priority atau beans.xml decorators entry?
[ ] Apakah delegate injection point tepat satu?
[ ] Apakah delegate type interface yang sama dengan injection target?
[ ] Apakah qualifier cocok?
[ ] Apakah target bean managed CDI?
[ ] Apakah caller mendapat object via @Inject?
[ ] Apakah namespace javax/jakarta konsisten?
```

---

## 29. Common Failure: Ambiguous / Unsatisfied Delegate

Decorator tetap tunduk pada CDI resolution.

Contoh:

```java
@Inject
@Delegate
NotificationSender delegate;
```

Jika ada beberapa `NotificationSender` tanpa qualifier yang jelas, container bisa menghadapi ambiguity.

Solusi:

- gunakan qualifier;
- pastikan implementasi default punya qualifier yang sesuai;
- hindari banyak implementation dengan `@Default` tanpa kebutuhan;
- desain interface lebih spesifik jika semantic berbeda.

Contoh interface terlalu generic:

```java
public interface Processor<T> {
    void process(T input);
}
```

Banyak implementation `Processor<T>` bisa membuat decorator/resolution sulit.

Lebih baik:

```java
public interface CaseSubmissionProcessor { ... }
public interface AppealSubmissionProcessor { ... }
public interface RenewalSubmissionProcessor { ... }
```

Jika semantic berbeda, jangan terlalu generik hanya demi reuse.

---

## 30. Common Failure: Infinite Recursion

Buruk:

```java
@Decorator
public abstract class BadDecorator implements PaymentService {

    @Inject
    PaymentService service; // salah: bukan @Delegate

    @Override
    public PaymentResult pay(PaymentCommand command) {
        return service.pay(command); // bisa memanggil dirinya sendiri
    }
}
```

Benar:

```java
@Inject
@Delegate
PaymentService delegate;
```

Decorator harus memanggil delegate, bukan menginjeksi service yang sama secara biasa untuk didekorasi.

---

## 31. Common Failure: Decorator Mengubah Semantics Terlalu Banyak

Decorator idealnya memperkaya/membungkus behavior, bukan diam-diam mengganti kontrak.

Buruk:

```java
@Override
public DecisionResult approve(ApproveCaseCommand command) {
    if (flags.enabled("auto-reject")) {
        return delegate.reject(new RejectCaseCommand(command.caseId(), "auto"));
    }
    return delegate.approve(command);
}
```

Masalah:

- method `approve` bisa melakukan reject;
- caller tertipu;
- audit semantics kacau;
- authorization mungkin salah;
- mental model rusak.

Jika behavior sebesar itu, gunakan explicit orchestrator/state machine:

```java
caseDecisionWorkflow.decide(command);
```

Decorator bukan tempat untuk menyembunyikan workflow besar.

---

## 32. Common Failure: Decorator Menjadi God Wrapper

Buruk:

```java
@Decorator
public abstract class MegaCaseServiceDecorator implements CaseService {
    // compliance
    // audit
    // metrics
    // enrichment
    // authorization
    // feature flag
    // fallback
    // cache
    // notification
}
```

Masalah:

- semua concern tercampur;
- ordering internal tidak jelas;
- test berat;
- change risk tinggi;
- debugging sulit.

Lebih baik pisahkan:

```text
AuthorizationDecorator
ComplianceDecorator
DomainAuditDecorator
FeatureFlagDecorator
CompatibilityDecorator
```

Namun jangan terlalu ekstrem juga. Sepuluh decorator untuk satu interface juga bisa membuat chain sulit dipahami. Gunakan granularity yang sejalan dengan architecture concern.

---

## 33. Decorator vs Event

Gunakan decorator jika:

- behavior harus terjadi inline;
- result/exception harus dipengaruhi;
- caller tidak boleh lanjut jika wrapper gagal;
- wrapper adalah bagian dari contract;
- ordering terhadap delegate penting.

Gunakan event jika:

- behavior adalah notification lokal;
- caller tidak butuh result observer;
- loose coupling lebih penting;
- observer failure semantics jelas;
- event tidak mengubah main result.

Contoh:

```java
public SubmissionResult submit(command) {
    SubmissionResult result = delegate.submit(command);
    events.fire(new CaseSubmitted(result.caseId()));
    return result;
}
```

Jika event hanya dipakai untuk audit mandatory, hati-hati. Mandatory audit sering lebih aman sebagai decorator/interceptor/outbox karena ordering dan failure semantics lebih jelas.

---

## 34. Decorator vs Producer Selection

Producer selection memilih object yang diinjeksi.

Decorator membungkus object setelah object tersedia.

Producer example:

```java
@Produces
@ApplicationScoped
PaymentGateway gateway(Config config) {
    if (config.useNewGateway()) {
        return new NewPaymentGateway();
    }
    return new LegacyPaymentGateway();
}
```

Decorator example:

```java
@Decorator
public abstract class AuditedPaymentGateway implements PaymentGateway {
    @Inject @Delegate PaymentGateway delegate;
}
```

Gunakan producer jika ingin memilih implementation.

Gunakan decorator jika ingin menambahkan behavior pada implementation yang dipilih.

Keduanya bisa digabung:

```text
@Inject PaymentGateway
  -> AuditDecorator
      -> RetryDecorator
          -> Produced gateway implementation
```

---

## 35. Decorator vs Inheritance

Inheritance:

```java
public class AuditedPaymentService extends DefaultPaymentService { ... }
```

Masalah:

- coupling kuat ke implementation;
- sulit compose multiple behavior;
- inheritance hierarchy rapuh;
- hanya satu parent class;
- test substitution lebih sulit.

Decorator:

```java
public class AuditedPaymentDecorator implements PaymentService { ... }
```

Kelebihan:

- coupling ke interface;
- composition lebih fleksibel;
- behavior bisa di-chain;
- cocok untuk runtime activation.

Rule:

> Jika ingin menambahkan behavior pada contract, gunakan composition/decorator. Jika ingin reuse implementation internal, inheritance mungkin masuk akal tetapi harus hati-hati.

---

## 36. Decorator Untuk Regulatory Workflow: Contoh End-to-End

Domain:

```java
public interface EnforcementLifecycleService {
    EnforcementCase open(OpenCaseCommand command);
    EnforcementCase escalate(EscalateCaseCommand command);
    EnforcementCase close(CloseCaseCommand command);
}
```

Default service:

```java
@ApplicationScoped
public class DefaultEnforcementLifecycleService implements EnforcementLifecycleService {

    @Inject
    EnforcementCaseRepository repository;

    @Inject
    WorkflowTaskService workflowTaskService;

    @Override
    public EnforcementCase open(OpenCaseCommand command) {
        EnforcementCase c = EnforcementCase.open(command);
        repository.save(c);
        workflowTaskService.createInitialTask(c.id());
        return c;
    }

    @Override
    public EnforcementCase escalate(EscalateCaseCommand command) {
        EnforcementCase c = repository.get(command.caseId());
        c.escalate(command.reason());
        repository.save(c);
        workflowTaskService.createEscalationTask(c.id());
        return c;
    }

    @Override
    public EnforcementCase close(CloseCaseCommand command) {
        EnforcementCase c = repository.get(command.caseId());
        c.close(command.reason());
        repository.save(c);
        workflowTaskService.completeOpenTasks(c.id());
        return c;
    }
}
```

Authorization decorator:

```java
@Decorator
@Priority(800)
public abstract class EnforcementAuthorizationDecorator implements EnforcementLifecycleService {

    @Inject
    @Delegate
    EnforcementLifecycleService delegate;

    @Inject
    CurrentUser currentUser;

    @Inject
    EnforcementAccessPolicy accessPolicy;

    @Override
    public EnforcementCase open(OpenCaseCommand command) {
        accessPolicy.assertCanOpen(currentUser.get(), command.agencyId());
        return delegate.open(command);
    }

    @Override
    public EnforcementCase escalate(EscalateCaseCommand command) {
        accessPolicy.assertCanEscalate(currentUser.get(), command.caseId());
        return delegate.escalate(command);
    }

    @Override
    public EnforcementCase close(CloseCaseCommand command) {
        accessPolicy.assertCanClose(currentUser.get(), command.caseId());
        return delegate.close(command);
    }
}
```

Compliance decorator:

```java
@Decorator
@Priority(900)
public abstract class EnforcementComplianceDecorator implements EnforcementLifecycleService {

    @Inject
    @Delegate
    EnforcementLifecycleService delegate;

    @Inject
    EnforcementCompliancePolicy compliancePolicy;

    @Override
    public EnforcementCase open(OpenCaseCommand command) {
        compliancePolicy.assertOpenAllowed(command);
        return delegate.open(command);
    }

    @Override
    public EnforcementCase escalate(EscalateCaseCommand command) {
        compliancePolicy.assertEscalationAllowed(command);
        return delegate.escalate(command);
    }

    @Override
    public EnforcementCase close(CloseCaseCommand command) {
        compliancePolicy.assertClosureAllowed(command);
        return delegate.close(command);
    }
}
```

Audit decorator:

```java
@Decorator
@Priority(700)
public abstract class EnforcementAuditDecorator implements EnforcementLifecycleService {

    @Inject
    @Delegate
    EnforcementLifecycleService delegate;

    @Inject
    EnforcementAuditTrail auditTrail;

    @Override
    public EnforcementCase open(OpenCaseCommand command) {
        AuditAttempt attempt = auditTrail.openAttempt(command);
        try {
            EnforcementCase result = delegate.open(command);
            auditTrail.openSuccess(attempt, result);
            return result;
        } catch (RuntimeException ex) {
            auditTrail.openFailure(attempt, ex);
            throw ex;
        }
    }

    @Override
    public EnforcementCase escalate(EscalateCaseCommand command) {
        AuditAttempt attempt = auditTrail.escalateAttempt(command);
        try {
            EnforcementCase result = delegate.escalate(command);
            auditTrail.escalateSuccess(attempt, result);
            return result;
        } catch (RuntimeException ex) {
            auditTrail.escalateFailure(attempt, ex);
            throw ex;
        }
    }

    @Override
    public EnforcementCase close(CloseCaseCommand command) {
        AuditAttempt attempt = auditTrail.closeAttempt(command);
        try {
            EnforcementCase result = delegate.close(command);
            auditTrail.closeSuccess(attempt, result);
            return result;
        } catch (RuntimeException ex) {
            auditTrail.closeFailure(attempt, ex);
            throw ex;
        }
    }
}
```

Possible chain:

```text
Caller
  -> EnforcementAuditDecorator
      -> EnforcementAuthorizationDecorator
          -> EnforcementComplianceDecorator
              -> DefaultEnforcementLifecycleService
```

Interpretasi:

- audit mencatat semua attempt;
- authorization dicek sebelum compliance;
- compliance dicek sebelum mutation;
- default service melakukan state transition.

Apakah authorization harus sebelum compliance? Bisa diperdebatkan.

Jika unauthorized user tidak boleh tahu apakah case melanggar compliance, authorization harus lebih awal. Jika sistem wajib mencatat compliance denial untuk semua attempt, audit harus di luar keduanya.

Ini contoh bahwa decorator ordering adalah policy architecture, bukan kosmetik.

---

## 37. Design Heuristics: Kapan Memilih Decorator?

Gunakan decorator jika mayoritas jawaban “ya”:

```text
[ ] Behavior berlaku pada kontrak interface tertentu.
[ ] Behavior perlu memahami method/parameter/result secara semantik.
[ ] Behavior harus inline, bukan async notification.
[ ] Behavior boleh/gak boleh memanggil delegate berdasarkan rule.
[ ] Behavior perlu mengubah input/result secara terkendali.
[ ] Behavior ingin dipasang sebagai runtime layer yang konsisten.
[ ] Core implementation sebaiknya tetap bersih dari policy wrapper.
[ ] Ordering terhadap wrapper lain bisa didefinisikan jelas.
```

Jangan gunakan decorator jika:

```text
[ ] Behavior generic lintas banyak method tanpa semantic interface.
[ ] Behavior lebih cocok annotation interceptor.
[ ] Behavior hanya satu-off di satu use case.
[ ] Behavior mengubah workflow besar secara tersembunyi.
[ ] Interface terlalu generic sehingga matching membingungkan.
[ ] Team belum punya observability/documentation untuk decorator chain.
[ ] Decorator membuat call path tidak defensible saat incident.
```

---

## 38. Naming Convention

Nama decorator harus menjelaskan concern + interface target.

Baik:

```text
ComplianceCaseSubmissionDecorator
DomainAuditCaseDecisionDecorator
FeatureFlagAddressLookupDecorator
LegacyCompatibilityRenewalDecorator
AuthorizationEnforcementLifecycleDecorator
```

Kurang baik:

```text
CaseDecorator
ServiceDecorator
BusinessDecorator
EnhancedPaymentService
WrapperService
```

Gunakan suffix `Decorator` agar runtime layer terlihat.

Jika decorator temporary, tandai dengan jelas:

```text
LegacyCompatibilityRenewalDecorator
TemporaryAgencyPayloadCompatibilityDecorator
MigrationBridgeCaseSubmissionDecorator
```

---

## 39. Documentation Pattern

Untuk decorator penting, tambahkan header contract:

```java
/**
 * Decorates CaseSubmissionService with regulatory submission compliance checks.
 *
 * Runtime role:
 * - blocks submission before delegate is called when compliance rule fails
 * - does not mutate command
 * - does not catch technical failures from delegate
 * - must run after authorization and before persistence mutation
 *
 * Ordering:
 * - expected chain: Audit -> Authorization -> Compliance -> Default
 */
@Decorator
@Priority(900)
public abstract class ComplianceCaseSubmissionDecorator implements CaseSubmissionService {
    ...
}
```

Ini sangat membantu saat incident/debugging.

---

## 40. Runtime Invariants Untuk Decorator

Setiap decorator penting harus punya invariant.

Contoh compliance decorator:

```text
Invariant:
- delegate must not be called if compliance check fails
- compliance check must be deterministic for same command + same reference data snapshot
- compliance failure must be auditable
- compliance decorator must not persist mutation directly
```

Contoh audit decorator:

```text
Invariant:
- every external call to submit must create an audit attempt
- success audit must include resulting case id and workflow state
- failure audit must include exception category
- audit failure policy must be explicit: fail-closed or fail-open
```

Contoh feature flag decorator:

```text
Invariant:
- flag decision must be logged/traced with flag key and evaluated variant
- fallback must be explicit and observable
- stale flag behavior must be documented
- command/result contract must remain stable regardless of variant
```

Top engineer tidak hanya bertanya “jalan atau tidak”; ia bertanya “apa invariant runtime yang harus selalu benar”.

---

## 41. Performance Considerations

Decorator menambah method call layer. Biasanya overhead kecil dibanding I/O/database/network. Tetapi tetap perhatikan:

1. chain terlalu panjang;
2. decorator melakukan blocking I/O;
3. decorator membaca config remote per call;
4. decorator melakukan expensive reflection;
5. decorator melakukan serialization besar;
6. decorator membuka transaction tambahan;
7. decorator memanggil audit sink sinkron lambat;
8. decorator melakukan logging payload besar.

Rule:

- decorator harus tipis;
- dependency berat harus punya caching/pooling;
- audit/event/outbox harus dirancang sesuai latency budget;
- feature flag lookup harus punya local cache/TTL jika remote;
- jangan log full payload sensitif.

---

## 42. Security Considerations

Decorator bisa menjadi security boundary, tetapi jangan jadikan satu-satunya security boundary tanpa desain.

Pertanyaan:

1. Apakah semua caller lewat CDI reference?
2. Apakah ada direct call ke implementation concrete class?
3. Apakah ada REST endpoint yang bypass service interface?
4. Apakah test alternative mematikan decorator?
5. Apakah async job memakai service yang sama?
6. Apakah decorator aktif di semua deployment profile?
7. Apakah qualifier membuat sebagian implementation tidak didekorasi?

Security decorator harus diuji sebagai runtime contract, bukan diasumsikan.

---

## 43. Anti-Pattern Catalog

### 43.1 Hidden Workflow Decorator

Decorator diam-diam menjalankan workflow besar.

Gejala:

- method sederhana ternyata membuat banyak side effect;
- developer tidak tahu call path;
- transaction dan audit sulit dijelaskan.

Solusi:

- pindahkan ke application service/orchestrator;
- gunakan decorator hanya untuk boundary concern.

### 43.2 Flag Jungle Decorator

Decorator berisi banyak flag:

```java
if (flagA) ...
if (flagB) ...
if (flagC) ...
```

Solusi:

- pisahkan strategy;
- gunakan decision object;
- dokumentasikan rollout;
- hapus flag selesai rollout.

### 43.3 Audit Swallowing Decorator

Audit gagal lalu exception ditelan.

Solusi:

- definisikan fail-open/fail-closed;
- metric/alert audit failure;
- outbox jika audit mandatory tapi tidak boleh blocking lama.

### 43.4 Decorator Untuk Semua Hal

Setiap concern dibuat decorator.

Solusi:

- gunakan interceptor untuk technical cross-cutting;
- gunakan explicit composition untuk use-case-specific logic;
- gunakan event untuk notification;
- gunakan policy object untuk pure decision;
- gunakan decorator hanya bila interface semantic wrapping tepat.

### 43.5 Qualifier Tidak Jelas

Decorator terlalu luas atau terlalu sempit karena qualifier salah.

Solusi:

- buat qualifier semantic;
- dokumentasikan decorator scope;
- test injection matrix.

---

## 44. Checklist Review PR Untuk Decorator

Gunakan checklist ini saat code review.

```text
Design Fit
[ ] Apakah concern ini memang semantic wrapper, bukan interceptor/event biasa?
[ ] Apakah interface target cukup spesifik?
[ ] Apakah decorator tidak menyembunyikan workflow besar?

CDI Correctness
[ ] Ada @Decorator?
[ ] Ada tepat satu @Delegate injection point?
[ ] Delegate type benar?
[ ] Qualifier benar?
[ ] Decorator di-enable via @Priority atau beans.xml?
[ ] Namespace javax/jakarta konsisten?

Ordering
[ ] Priority/ordering jelas?
[ ] Ordering dengan audit/security/transaction/compliance sudah diputuskan?
[ ] Ada test untuk ordering jika penting?

Failure Semantics
[ ] Exception tidak ditelan sembarangan?
[ ] Rollback behavior dipahami?
[ ] Fallback behavior eksplisit?
[ ] Audit/metric failure jelas?

Observability
[ ] Decorator penting punya log/metric/trace/audit?
[ ] Startup/runtime wiring bisa diketahui?
[ ] Feature flag decision observable?

Testing
[ ] Ada unit test untuk logic wrapper?
[ ] Ada integration/container test untuk active chain?
[ ] Ada test untuk delegate tidak dipanggil saat guard gagal?
[ ] Ada test untuk delegate dipanggil tepat sekali saat success?

Maintainability
[ ] Nama decorator jelas?
[ ] Temporary decorator punya removal plan?
[ ] Tidak ada duplicate behavior dengan interceptor/event lain?
```

---

## 45. Mental Model Final

Ringkasnya:

```text
Interceptor = wraps invocation mechanics
Decorator   = wraps business contract
Producer    = supplies object
Qualifier   = routes dependency
Event       = notifies local observers
Scope       = defines lifecycle/context
Proxy       = makes contextual dispatch possible
```

Decorator adalah alat kuat ketika Anda ingin berkata:

> “Setiap penggunaan kontrak bisnis ini harus melewati semantic layer tambahan ini.”

Bukan:

> “Saya ingin menaruh logic tambahan di tempat yang tidak terlihat.”

Decorator yang baik membuat architecture lebih jelas. Decorator yang buruk membuat runtime menjadi labirin.

---

## 46. Latihan Pemahaman

### Latihan 1 — Pilih Mechanism

Untuk setiap concern berikut, pilih method langsung, interceptor, decorator, event, producer, atau explicit orchestrator:

1. record method duration untuk semua service;
2. reject case approval jika user bukan assigned officer;
3. kirim email setelah case submitted;
4. pilih payment gateway legacy/new saat startup;
5. fallback ke old address lookup saat new API timeout;
6. audit regulatory before/after case escalation;
7. create workflow task setelah state transition;
8. normalize legacy payload sebelum renewal service;
9. retry HTTP client call dengan backoff;
10. validate aggregate invariant saat domain state berubah.

Jawaban yang disarankan:

```text
1. interceptor
2. decorator atau explicit policy di application service
3. event atau outbox, tergantung reliability
4. producer atau config-based bean selection
5. decorator jika semantic per service, explicit adapter jika kompleks
6. decorator atau outbox-backed audit boundary
7. explicit application service/domain workflow, bukan hidden decorator jika core flow
8. decorator temporary atau adapter boundary
9. interceptor/decorator/client wrapper tergantung target
10. domain method/entity invariant, bukan decorator utama
```

### Latihan 2 — Ordering

Untuk chain:

```text
Audit -> Authorization -> Compliance -> FeatureFlag -> Default
```

Tanyakan:

1. apakah unauthorized attempt diaudit?
2. apakah compliance denial diaudit?
3. apakah feature flag decision diaudit?
4. apakah audit terjadi jika default service gagal?
5. apakah feature flag boleh mengubah command sebelum compliance?

Jika tidak bisa menjawab, chain belum defensible.

---

## 47. Ringkasan

Pada part ini kita belajar:

- decorator adalah managed bean CDI untuk membungkus business interface;
- decorator memiliki `@Decorator` dan satu `@Delegate` injection point;
- decorator berbeda dari interceptor karena ia semantic/type-aware terhadap interface;
- qualifier menentukan area dekorasi;
- decorator chain membutuhkan ordering yang eksplisit;
- decorator cocok untuk compliance, authorization fine-grained, domain audit, compatibility, fallback, feature-flagged semantic behavior;
- decorator buruk jika dipakai untuk menyembunyikan workflow besar;
- correctness decorator harus dilihat dari invariant, failure semantics, transaction boundary, dan observability;
- production-grade decorator harus punya naming, documentation, test, dan diagnostic strategy.

---

## 48. Status Seri

Part yang sudah selesai:

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
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 017 — Stereotypes and Annotation Composition
```

---

## 49. Referensi Resmi / Baseline

- Jakarta CDI 4.1 Specification — decorators, delegate injection point, decorated types, CDI bean model.
- Jakarta CDI API — `jakarta.decorator.Decorator` dan `jakarta.decorator.Delegate`.
- Jakarta Interceptors Specification — pembanding interceptor model.
- Jakarta EE Tutorial — advanced CDI examples, termasuk decorator/interceptor concept.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-015.md">⬅️ Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-017.md">Part 017 — Stereotypes and Annotation Composition ➡️</a>
</div>
