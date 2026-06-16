# Part 017 — Stereotypes and Annotation Composition

Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
Part: `017`  
Topik: `Stereotypes and Annotation Composition`  
Target pembaca: engineer Java enterprise yang ingin memahami annotation bukan sebagai dekorasi sintaks, tetapi sebagai bahasa metadata runtime untuk container, framework, tooling, dan arsitektur.

---

## 0. Posisi Materi Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- DI sebagai inversion of ownership.
- CDI bean model: type, qualifier, scope, context.
- bean discovery.
- scope dan client proxy.
- qualifier, alternative, priority.
- producer/disposer.
- CDI event.
- interceptor.
- decorator.

Part ini membahas **annotation composition** dan **CDI stereotype**.

Tujuan utamanya bukan sekadar mengetahui bahwa ada annotation `@Stereotype`, tetapi memahami:

1. bagaimana annotation menjadi **bahasa metadata** antara code dan runtime;
2. bagaimana stereotype menyatukan metadata berulang seperti scope, interceptor binding, dan nama;
3. kapan custom annotation meningkatkan arsitektur;
4. kapan custom annotation malah menciptakan “annotation soup” yang menyembunyikan perilaku runtime;
5. bagaimana mendesain annotation yang readable, defensible, testable, dan aman untuk sistem enterprise.

---

## 1. Problem Yang Diselesaikan Annotation Composition

Dalam aplikasi enterprise besar, class sering membawa metadata yang berulang.

Contoh sederhana:

```java
@ApplicationScoped
@TransactionalBoundary
@Audited
@Measured
public class CaseAssignmentService {
    // ...
}
```

Jika pattern ini muncul di banyak class, kita mulai punya beberapa masalah:

1. **Noise**: class sulit dibaca karena metadata lebih banyak dari intent bisnis.
2. **Inconsistency**: sebagian class lupa `@Audited`, sebagian lupa `@Measured`.
3. **Policy drift**: convention tidak lagi enforceable secara mudah.
4. **Semantic gap**: annotation teknis tidak menjelaskan peran arsitektural class.
5. **Review burden**: reviewer harus mengingat kombinasi annotation mana yang benar.

Stereotype dan annotation composition mencoba mengubah kombinasi teknis menjadi konsep yang lebih semantik.

Misalnya:

```java
@UseCaseService
public class CaseAssignmentService {
    // ...
}
```

Dengan `@UseCaseService`, kita bisa menyatakan:

> class ini adalah application/use-case boundary, application-scoped, audited, measured, dan tunduk pada policy interceptor tertentu.

Jadi annotation composition bukan hanya membuat code pendek. Ia membuat **runtime contract** lebih eksplisit.

---

## 2. Mental Model: Annotation Sebagai Metadata Language

Annotation di Java adalah metadata yang dapat dibaca oleh:

- compiler;
- annotation processor;
- bytecode tooling;
- runtime reflection;
- CDI container;
- Jakarta EE container;
- validation provider;
- JAX-RS runtime;
- persistence provider;
- testing framework;
- static analysis tool;
- documentation generator.

Secara mental:

```text
Source Code
   |
   | contains annotations
   v
Compiler
   |
   | stores metadata depending on retention
   v
Class File / Bytecode
   |
   | discovered by scanners, reflection, processors, container
   v
Runtime Model
   |
   | creates beans, applies scopes, interceptors, decorators, validation, routing
   v
Behavior
```

Annotation tidak otomatis “melakukan sesuatu”. Annotation hanya metadata. Yang membuatnya bermakna adalah **consumer**.

Contoh:

```java
@Audited
public void approveCase(...) { ... }
```

`@Audited` tidak melakukan audit bila tidak ada:

- interceptor binding;
- interceptor implementation;
- CDI container yang mengaktifkan interceptor;
- invocation path yang melewati proxy/container.

Jadi top engineer tidak bertanya:

> annotation ini apa?

Tetapi:

> siapa consumer annotation ini, kapan dibaca, bagaimana efeknya, dan apa failure mode-nya?

---

## 3. Kategori Annotation Dalam Ekosistem Jakarta/CDI

Tidak semua annotation punya peran yang sama. Mengelompokkan annotation membantu membaca sistem besar.

### 3.1 Scope Annotation

Scope menentukan lifecycle dan context.

Contoh:

```java
@ApplicationScoped
@RequestScoped
@SessionScoped
@Dependent
```

Pertanyaan desain:

- object ini hidup selama apa?
- boleh menyimpan mutable state atau tidak?
- thread-safe atau tidak?
- apakah context selalu aktif saat digunakan?

---

### 3.2 Qualifier Annotation

Qualifier menentukan varian dependency.

Contoh:

```java
@Fast
@Reliable
@PrimaryDatabase
@ExternalSystem("SLA")
```

Pertanyaan desain:

- dependency mana yang diminta?
- apakah qualifier merepresentasikan kemampuan, environment, tenant, atau protocol?
- apakah qualifier terlalu spesifik?

---

### 3.3 Interceptor Binding Annotation

Interceptor binding menempelkan cross-cutting behavior pada invocation.

Contoh:

```java
@Audited
@Measured
@Retried
@IdempotentOperation
```

Pertanyaan desain:

- behavior apa yang dijalankan sebelum/sesudah method?
- apa ordering-nya?
- apakah exception diubah?
- apakah self-invocation melewati interceptor?

---

### 3.4 Stereotype Annotation

Stereotype menggabungkan metadata umum untuk peran class tertentu.

Contoh:

```java
@UseCaseService
@InfrastructureAdapter
@RegulatoryWorkflowStep
```

Pertanyaan desain:

- role arsitektural apa yang diwakili?
- metadata default apa yang diberikan?
- apakah stereotype ini membantu reviewer memahami intent?

---

### 3.5 Lifecycle Annotation

Lifecycle annotation menandai callback tertentu.

Contoh:

```java
@PostConstruct
@PreDestroy
```

Pertanyaan desain:

- kapan method dipanggil?
- apakah dependency sudah diinjeksi?
- apakah failure harus menggagalkan deployment/startup?

---

### 3.6 Resource / Integration Annotation

Annotation ini menghubungkan component dengan resource container atau platform.

Contoh:

```java
@Resource
@PersistenceContext
@EJB
```

Pertanyaan desain:

- resource disediakan siapa?
- lifecycle resource milik siapa?
- apakah naming/binding portable?

---

### 3.7 Validation / Constraint Annotation

Annotation seperti Bean Validation constraint menyatakan invariant input/model.

Contoh:

```java
@NotNull
@Size
@Valid
```

Part ini tidak mengulang Bean Validation detail, tetapi penting memahami bahwa constraint annotation juga contoh annotation composition.

---

### 3.8 Framework / Tooling Annotation

Contoh:

```java
@Generated
@SuppressWarnings
@Deprecated
```

Annotation ini mungkin dikonsumsi compiler, IDE, static analysis, atau dokumentasi.

---

## 4. Dasar Teknis Java Annotation

Sebelum masuk stereotype, kita perlu mengingat struktur annotation Java.

Contoh custom annotation:

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface Audited {
    String value() default "";
}
```

Ada beberapa dimensi penting.

---

## 5. Retention: Kapan Metadata Tersedia?

Retention menentukan sampai tahap mana annotation disimpan.

```java
@Retention(RetentionPolicy.SOURCE)
@Retention(RetentionPolicy.CLASS)
@Retention(RetentionPolicy.RUNTIME)
```

### 5.1 SOURCE

Hanya tersedia di source code. Hilang setelah compile.

Cocok untuk:

- compiler hint;
- static analysis;
- annotation processor tertentu;
- IDE helper.

Tidak cocok untuk CDI runtime.

---

### 5.2 CLASS

Disimpan di class file, tetapi tidak tersedia via reflection runtime standar.

Cocok untuk:

- bytecode tooling;
- build-time framework;
- static transformer.

---

### 5.3 RUNTIME

Disimpan di class file dan tersedia melalui reflection runtime.

CDI annotation seperti qualifier, scope, stereotype, interceptor binding umumnya perlu runtime visibility karena container membacanya saat discovery/deployment.

Rule praktis:

> Jika annotation ingin dibaca CDI runtime, gunakan `@Retention(RUNTIME)`.

---

## 6. Target: Annotation Boleh Dipasang Di Mana?

Target menentukan elemen Java yang boleh diberi annotation.

Contoh:

```java
@Target(ElementType.TYPE)
public @interface UseCaseService {
}
```

Target umum:

| Target | Arti |
|---|---|
| `TYPE` | class, interface, enum, annotation type |
| `METHOD` | method |
| `FIELD` | field |
| `PARAMETER` | parameter |
| `CONSTRUCTOR` | constructor |
| `ANNOTATION_TYPE` | annotation lain / meta-annotation |
| `TYPE_USE` | penggunaan type, misalnya generic/type annotation |
| `PACKAGE` | package |
| `MODULE` | module Java 9+ |

Untuk meta-annotation seperti qualifier, interceptor binding, atau stereotype, annotation biasanya harus dapat dipasang pada `ANNOTATION_TYPE`.

Contoh:

```java
@Qualifier
@Retention(RUNTIME)
@Target({TYPE, FIELD, PARAMETER, METHOD})
public @interface PrimaryDatabase {
}
```

---

## 7. Annotation Member: Metadata Dengan Parameter

Annotation bisa memiliki member.

```java
@Audited(category = "CASE", action = "APPROVE")
public void approve(...) { ... }
```

Definition:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    String category();
    String action();
}
```

Member membuat annotation lebih ekspresif, tetapi juga berisiko:

- terlalu banyak konfigurasi di annotation;
- logic runtime menjadi tersembunyi;
- perubahan member memengaruhi equality annotation;
- untuk CDI qualifier/interceptor binding, member dapat memengaruhi resolution/binding.

---

## 8. `@Nonbinding`: Ketika Member Tidak Ikut Resolution/Binding

Dalam CDI, member annotation bisa ikut menentukan kecocokan qualifier atau interceptor binding.

Misalnya:

```java
@ExternalSystem("SLA")
ExternalClient slaClient;

@ExternalSystem("ROM")
ExternalClient romClient;
```

Nilai `"SLA"` dan `"ROM"` membedakan qualifier.

Namun untuk interceptor binding, kadang member hanya metadata untuk interceptor, bukan pembeda binding.

Contoh:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    @Nonbinding
    String action() default "";
}
```

Dengan `@Nonbinding`, nilai `action` tidak menentukan apakah interceptor berlaku atau tidak.

Mental model:

```text
binding member     -> ikut menentukan matching
nonbinding member  -> metadata saja, tidak ikut matching
```

Gunakan `@Nonbinding` bila variasi nilai tidak dimaksudkan menciptakan binding/qualifier baru.

---

## 9. `@Inherited`: Hati-Hati Dengan Pewarisan Annotation

Java menyediakan `@Inherited`, tetapi efeknya terbatas:

- hanya berlaku untuk annotation pada class;
- tidak berlaku untuk method;
- tidak berlaku untuk interface;
- tidak selalu berarti framework akan memperlakukannya seperti inheritance semantik.

Contoh:

```java
@Inherited
@Retention(RUNTIME)
@Target(TYPE)
public @interface AuditedType {
}
```

Jika parent class diberi `@AuditedType`, subclass bisa terlihat memiliki annotation tersebut via reflection tertentu.

Namun dalam CDI/Jakarta, jangan mendesain policy penting hanya berdasarkan asumsi `@Inherited`. Selalu cek bagaimana container/spec memperlakukan annotation tersebut.

Rule praktis:

> Gunakan annotation inheritance untuk convenience, bukan sebagai fondasi security/compliance behavior tanpa test eksplisit.

---

## 10. Repeatable Annotation

Java 8 memperkenalkan repeatable annotation.

Contoh:

```java
@RequiresPermission("CASE_APPROVE")
@RequiresPermission("CASE_ASSIGN")
public void perform(...) { ... }
```

Definition:

```java
@Repeatable(RequiresPermissions.class)
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresPermission {
    String value();
}

@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresPermissions {
    RequiresPermission[] value();
}
```

Repeatable annotation berguna bila satu elemen punya beberapa metadata sejenis.

Namun hati-hati:

- resolver framework harus membaca container annotation dan repeatable annotation dengan benar;
- ordering sering tidak boleh diandalkan;
- terlalu banyak repeatable annotation bisa menandakan model authorization/policy lebih cocok di config/policy engine.

---

## 11. Meta-Annotation: Annotation Di Atas Annotation

Meta-annotation adalah annotation yang diterapkan pada annotation lain.

Contoh:

```java
@Stereotype
@ApplicationScoped
@Audited
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

Di sini:

- `@Stereotype` memberi tahu CDI bahwa `@UseCaseService` adalah stereotype;
- `@ApplicationScoped` memberi default scope;
- `@Audited` bisa menjadi interceptor binding;
- `@Retention` dan `@Target` adalah meta-annotation Java standar.

Ini inti annotation composition.

---

## 12. Apa Itu CDI Stereotype?

CDI stereotype adalah annotation yang diterapkan ke bean untuk menggabungkan metadata umum.

Jakarta EE Tutorial mendeskripsikan stereotype sebagai annotation yang menggabungkan annotation lain, berguna untuk aplikasi besar yang memiliki banyak bean dengan fungsi serupa. Stereotype dapat menentukan default scope, nol atau lebih interceptor bindings, dan opsional `@Named` untuk default EL naming.

Secara praktis, stereotype menjawab:

> “Class dengan role ini seharusnya punya metadata runtime apa?”

Contoh:

```java
@Stereotype
@ApplicationScoped
@Audited
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

Pemakaian:

```java
@UseCaseService
public class ApproveCaseUseCase {
    public ApprovalResult approve(ApproveCaseCommand command) {
        // business orchestration
    }
}
```

---

## 13. Stereotype Bukan Sekadar Alias

Stereotype terlihat seperti alias annotation, tetapi mental model yang lebih tepat:

```text
Stereotype = semantic role + default metadata contract
```

Bukan:

```text
Stereotype = macro untuk copy-paste annotation
```

Jika hanya ingin mengurangi jumlah annotation, stereotype bisa menjadi kosmetik. Tetapi jika ingin menetapkan peran arsitektural dan policy, stereotype menjadi alat desain.

Contoh buruk:

```java
@Stereotype
@ApplicationScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface MyBean {
}
```

`@MyBean` tidak memberi makna domain/architecture yang jelas.

Contoh lebih baik:

```java
@Stereotype
@ApplicationScoped
@Audited
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface ApplicationBoundary {
}
```

`@ApplicationBoundary` menyatakan role.

---

## 14. Contoh Stereotype Untuk Application Service

Misalnya dalam sistem case management/regulatory enforcement, kita punya application service/use case.

```java
@Stereotype
@ApplicationScoped
@Audited
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

Interceptor binding:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
}

@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Measured {
}
```

Bean:

```java
@UseCaseService
public class AssignCaseOfficerUseCase {

    private final CaseRepository caseRepository;
    private final OfficerDirectory officerDirectory;

    @Inject
    public AssignCaseOfficerUseCase(
            CaseRepository caseRepository,
            OfficerDirectory officerDirectory) {
        this.caseRepository = caseRepository;
        this.officerDirectory = officerDirectory;
    }

    public AssignmentResult assign(AssignCaseOfficerCommand command) {
        CaseRecord record = caseRepository.getRequired(command.caseId());
        Officer officer = officerDirectory.getRequired(command.officerId());

        record.assignTo(officer);
        caseRepository.save(record);

        return AssignmentResult.success(record.id(), officer.id());
    }
}
```

Yang dibaca reviewer:

```text
AssignCaseOfficerUseCase adalah application boundary.
Secara default ia application-scoped.
Invocation-nya audited dan measured.
```

Ini lebih semantik daripada membaca annotation teknis satu per satu.

---

## 15. Stereotype Untuk Infrastructure Adapter

Infrastructure adapter sering punya karakteristik berbeda:

- stateless;
- application-scoped;
- measured;
- kadang retried;
- mungkin tidak selalu audited sebagai business action;
- bergantung pada config/resource/client.

Contoh:

```java
@Stereotype
@ApplicationScoped
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface InfrastructureAdapter {
}
```

Pemakaian:

```java
@InfrastructureAdapter
public class OneMapPostalCodeClient implements PostalCodeLookupPort {
    // HTTP client call, retry, cache, timeout, mapping
}
```

Stereotype membantu membedakan:

```text
Application service -> orchestration + business boundary
Infrastructure adapter -> external system integration boundary
Domain object -> no CDI/runtime dependency ideally
```

---

## 16. Stereotype Untuk Regulatory Workflow Step

Dalam domain regulatory/enforcement lifecycle, workflow step sering perlu policy konsisten:

- audit wajib;
- authorization wajib;
- metrics wajib;
- maybe idempotency;
- maybe feature gate;
- application scoped.

Contoh:

```java
@Stereotype
@ApplicationScoped
@Audited
@Measured
@IdempotentBoundary
@Retention(RUNTIME)
@Target(TYPE)
public @interface RegulatoryWorkflowStep {
}
```

Bean:

```java
@RegulatoryWorkflowStep
public class IssueNoticeOfIntentStep {

    public WorkflowStepResult execute(IssueNoticeCommand command) {
        // validate state transition
        // generate notice
        // persist event
        // schedule notification
        return WorkflowStepResult.completed();
    }
}
```

Dengan stereotype, arsitektur menjadi lebih visible:

```text
Semua workflow step harus audited, measured, idempotent, dan managed sebagai application-scoped bean.
```

---

## 17. Annotation Composition Untuk Interceptor Binding

Kita juga bisa membuat annotation binding yang lebih spesifik.

Daripada:

```java
@Audited
@Measured
@IdempotentBoundary
public void approve(...) { ... }
```

Bisa dibuat:

```java
@InterceptorBinding
@Audited
@Measured
@IdempotentBoundary
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RegulatedOperation {
}
```

Namun hati-hati: tidak semua framework/spec memperlakukan composed interceptor binding seperti yang kita bayangkan jika meta-annotation tidak sesuai aturan CDI. Untuk CDI stereotype, komposisi melalui stereotype adalah jalur yang jelas.

Rekomendasi:

- Untuk role class, gunakan stereotype.
- Untuk behavior invocation spesifik, gunakan interceptor binding eksplisit.
- Untuk kumpulan behavior yang sangat domain-specific, pertimbangkan binding composed setelah memahami aturan container.

---

## 18. Annotation Composition Untuk Qualifier

Qualifier biasanya tidak “dikomposisi” seperti stereotype. Ia lebih baik tetap kecil dan eksplisit.

Contoh qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface ExternalSystem {
    String value();
}
```

Pemakaian:

```java
@Inject
@ExternalSystem("SLA")
ExternalClient slaClient;
```

Namun sering lebih baik memakai enum daripada string:

```java
public enum SystemCode {
    SLA,
    ROM,
    ONEMAP
}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface ExternalSystem {
    SystemCode value();
}
```

Pemakaian:

```java
@Inject
@ExternalSystem(SystemCode.ONEMAP)
ExternalClient oneMapClient;
```

Masalah: annotation member yang ikut binding harus memiliki nilai compile-time constant. Enum cocok untuk itu.

---

## 19. Annotation Composition Untuk Domain Semantics

Custom annotation bisa dipakai sebagai “bahasa arsitektur”.

Contoh:

```java
@ApplicationBoundary
public class SubmitLicenceApplicationUseCase { }

@DomainPolicy
public class EligibilityPolicy { }

@InfrastructureAdapter
public class MyInfoConnector { }

@RegulatoryWorkflowStep
public class EscalateCaseStep { }
```

Namun perlu hati-hati: jika annotation tidak dikonsumsi oleh apa pun, ia hanya dokumentasi. Itu tidak selalu buruk, tetapi harus jelas.

Ada tiga level annotation:

```text
Level 1: Documentation marker
        Dibaca manusia/static analysis.

Level 2: Runtime metadata
        Dibaca container/interceptor/framework.

Level 3: Governance contract
        Dibaca tests, architecture rules, CI checks.
```

Top engineer tidak membuat annotation hanya karena terlihat keren. Ia bertanya:

- Apakah annotation ini hanya dokumentasi?
- Apakah ada runtime effect?
- Apakah ada test/architecture rule yang memverifikasi penggunaannya?
- Apakah developer baru bisa paham tanpa membuka 7 file?

---

## 20. Marker Annotation: Berguna Tapi Mudah Disalahgunakan

Marker annotation tidak memiliki member.

```java
@Retention(RUNTIME)
@Target(TYPE)
public @interface DomainService {
}
```

Berguna untuk:

- semantic classification;
- architecture tests;
- scanning;
- documentation;
- selective framework behavior.

Tetapi marker annotation menjadi buruk jika:

- terlalu banyak;
- overlap;
- tidak ada consumer;
- tidak jelas bedanya dengan naming convention;
- dipakai untuk mengganti package/module boundary yang buruk.

Contoh buruk:

```java
@ServiceThing
@Important
@BusinessLogic
@ManagedStuff
public class CaseService { }
```

Annotation seperti itu tidak membantu arsitektur.

---

## 21. Annotation Dengan Member: Kapan Tepat?

Annotation member tepat bila metadata:

- kecil;
- stabil;
- compile-time constant;
- relevan langsung dengan elemen yang dianotasi;
- tidak berubah antar deployment;
- bukan secret;
- bukan config operasional yang sering berubah.

Contoh tepat:

```java
@AuditAction("CASE_APPROVED")
public ApprovalResult approve(...) { ... }
```

Contoh kurang tepat:

```java
@HttpTimeout(milliseconds = 3000)
public ExternalResponse call(...) { ... }
```

Timeout lebih sering cocok sebagai config karena bisa berbeda antar environment dan perlu tuning tanpa compile ulang.

Rule praktis:

```text
Annotation member = metadata struktural/stabil.
Configuration     = nilai operasional/berubah per environment.
Feature flag      = keputusan rollout/runtime.
Database/policy   = aturan bisnis yang perlu berubah tanpa redeploy.
```

---

## 22. Annotation Bukan Tempat Untuk Secret atau Config Dinamis

Jangan lakukan ini:

```java
@ExternalApi(apiKey = "secret-value")
public class SomeClient { }
```

Atau:

```java
@FeatureEnabled("new-case-flow")
public class NewCaseFlowService { }
```

Bukan berarti feature annotation selalu salah. Tetapi annotation sendiri compile-time/static. Jika flag harus berubah runtime, keputusan akhir harus datang dari config/flag provider.

Lebih baik:

```java
@FeatureGate("new-case-flow")
public void runNewFlow(...) { ... }
```

`@FeatureGate` hanya metadata key, sedangkan enabled/disabled dibaca dari feature flag service.

---

## 23. Domain-Specific Annotation: Contoh Desain Yang Sehat

Misalnya kita ingin audit action dalam sistem enforcement.

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface AuditAction {
    @Nonbinding
    String value();
}
```

Interceptor:

```java
@AuditAction("")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditActionInterceptor {

    @AroundInvoke
    public Object audit(InvocationContext ctx) throws Exception {
        AuditAction action = resolveAuditAction(ctx);

        long started = System.nanoTime();
        try {
            Object result = ctx.proceed();
            writeSuccessAudit(ctx, action, System.nanoTime() - started);
            return result;
        } catch (Exception ex) {
            writeFailureAudit(ctx, action, ex, System.nanoTime() - started);
            throw ex;
        }
    }

    private AuditAction resolveAuditAction(InvocationContext ctx) {
        AuditAction methodAnnotation = ctx.getMethod().getAnnotation(AuditAction.class);
        if (methodAnnotation != null) {
            return methodAnnotation;
        }
        return ctx.getTarget().getClass().getAnnotation(AuditAction.class);
    }
}
```

Usage:

```java
@UseCaseService
public class ApproveCaseUseCase {

    @AuditAction("CASE_APPROVED")
    public ApprovalResult approve(ApproveCaseCommand command) {
        // ...
    }
}
```

Kelebihan:

- audit key dekat dengan use case;
- runtime behavior ada di interceptor;
- key bukan secret;
- key stabil;
- mudah diuji.

Risiko:

- jika method dipanggil via self-invocation, interceptor bisa tidak berjalan;
- jika `@AuditAction` tidak punya binding benar, tidak ada efek;
- jika action key typo, audit taxonomy kacau.

Solusi:

- gunakan enum bila action set stabil;
- tambahkan architecture test;
- tambahkan startup validation jika perlu.

---

## 24. Enum Dalam Annotation: Aman Tapi Tidak Selalu Fleksibel

Contoh:

```java
public enum AuditEventType {
    CASE_SUBMITTED,
    CASE_APPROVED,
    CASE_REJECTED,
    CASE_ESCALATED
}
```

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface AuditEvent {
    @Nonbinding
    AuditEventType value();
}
```

Usage:

```java
@AuditEvent(AuditEventType.CASE_ESCALATED)
public void escalate(...) { ... }
```

Kelebihan:

- compile-time safety;
- refactor-friendly;
- mengurangi typo;
- cocok untuk taxonomy stabil.

Kekurangan:

- perubahan taxonomy perlu compile/deploy;
- tidak cocok bila event taxonomy dikelola eksternal oleh policy/config team.

---

## 25. Annotation dan Architecture Tests

Custom annotation menjadi jauh lebih kuat bila dipakai dalam architecture tests.

Misalnya rule:

1. class dengan nama `*UseCase` harus punya `@UseCaseService`;
2. `@UseCaseService` tidak boleh bergantung langsung pada JAX-RS resource;
3. `@InfrastructureAdapter` tidak boleh dipakai di package domain;
4. `@RegulatoryWorkflowStep` harus punya method `execute` atau implement interface tertentu;
5. semua public method pada workflow step harus audited atau class harus punya stereotype audited.

Pseudo example dengan style architecture test:

```java
@Test
void useCasesMustBeAnnotated() {
    classes()
        .that().haveSimpleNameEndingWith("UseCase")
        .should().beAnnotatedWith(UseCaseService.class)
        .check(importedClasses);
}
```

Ini mengubah annotation dari dokumentasi menjadi governance.

---

## 26. Annotation dan Package Boundary

Annotation tidak menggantikan package/module boundary.

Buruk:

```text
com.company.app.misc
  CaseService.java       @DomainService
  OracleCaseRepository.java @InfrastructureAdapter
  CaseResource.java      @RestBoundary
  EligibilityPolicy.java @DomainPolicy
```

Lebih baik:

```text
com.company.case.domain
  EligibilityPolicy.java
  CaseRecord.java

com.company.case.application
  ApproveCaseUseCase.java
  AssignOfficerUseCase.java

com.company.case.infrastructure.persistence
  OracleCaseRepository.java

com.company.case.interfaces.rest
  CaseResource.java
```

Annotation memperkuat struktur, bukan mengganti struktur.

Rule:

> Jika tanpa annotation struktur code tidak masuk akal, annotation kemungkinan sedang menutupi desain package yang lemah.

---

## 27. Annotation dan Naming Convention

Kadang naming convention lebih cukup daripada annotation.

Contoh:

- `*UseCase`
- `*Repository`
- `*Client`
- `*Mapper`
- `*Policy`
- `*Step`

Kapan annotation dibutuhkan?

Gunakan annotation bila ada salah satu:

1. runtime behavior;
2. CDI metadata composition;
3. architecture rule;
4. deployment scanning;
5. cross-cutting policy;
6. metadata yang tidak bisa diekspresikan oleh nama/package saja.

Jika hanya untuk label tanpa effect, naming/package mungkin cukup.

---

## 28. Annotation Soup: Anti-Pattern Besar

Annotation soup terjadi saat class penuh annotation yang campur aduk:

```java
@ApplicationScoped
@Named
@Audited
@Measured
@Retried
@FeatureGate("x")
@ExternalSystem("abc")
@UseCase
@Boundary
@Workflow
@Priority(100)
@Alternative
public class CaseService { }
```

Masalah:

- sulit tahu annotation mana yang punya efek;
- ordering tidak jelas;
- hidden behavior terlalu banyak;
- reviewer perlu memahami banyak framework sekaligus;
- refactoring berisiko;
- test harus membuktikan terlalu banyak implicit behavior.

Solusi:

1. pisahkan role annotation dari behavior annotation;
2. gunakan stereotype untuk kombinasi stabil;
3. gunakan explicit method call untuk behavior bisnis penting;
4. pindahkan config dinamis ke config/feature flag;
5. dokumentasikan annotation penting;
6. buat architecture tests.

---

## 29. Stereotype vs Interceptor Binding vs Qualifier

Tabel mental model:

| Konsep | Pertanyaan | Diterapkan ke | Efek utama |
|---|---|---|---|
| Qualifier | dependency varian mana? | injection point, bean, producer | dependency resolution |
| Interceptor binding | invocation behavior apa? | type/method | wraps method/lifecycle invocation |
| Decorator | interface behavior dibungkus bagaimana? | bean implementing type | semantic delegation |
| Scope | instance hidup selama apa? | bean | lifecycle/context |
| Stereotype | role class ini apa dan default metadata-nya apa? | bean class | annotation composition |

Kesalahan umum:

- memakai qualifier untuk environment profile secara berlebihan;
- memakai interceptor binding untuk logic bisnis utama;
- memakai stereotype hanya sebagai nama lain dari `@ApplicationScoped`;
- memakai custom annotation tanpa consumer.

---

## 30. Stereotype vs Spring Stereotype: Jangan Samakan Mentah-Mentah

Di Spring, annotation seperti:

```java
@Component
@Service
@Repository
@Controller
```

sering disebut stereotype annotation.

Dalam CDI, `@Stereotype` adalah mekanisme spesifik CDI untuk annotation composition yang dapat mencakup scope, interceptor binding, dan naming behavior.

Konsepnya mirip dalam hal “semantic component role”, tetapi aturan runtime dan discovery-nya berbeda.

Jangan mengasumsikan:

- `@Service` Spring sama dengan CDI stereotype;
- semua custom annotation otomatis membuat class menjadi bean;
- annotation yang ada di class otomatis ditemukan container;
- composition rules sama antar framework.

---

## 31. Bean-Defining Annotation dan Stereotype

Dalam CDI discovery mode `annotated`, class ditemukan sebagai bean jika memiliki bean-defining annotation.

Scope annotation seperti `@ApplicationScoped` adalah bean-defining annotation. Stereotype juga dapat berperan dalam membuat class discoverable tergantung aturan CDI dan metadata yang dibawanya.

Praktisnya, bila kita membuat stereotype untuk bean role, pastikan ia:

- memiliki `@Stereotype`;
- memiliki `@Retention(RUNTIME)`;
- memiliki target sesuai, biasanya `TYPE`;
- membawa scope default bila memang role tersebut harus menjadi bean;
- diuji dalam mode discovery yang dipakai aplikasi.

Contoh:

```java
@Stereotype
@ApplicationScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

Ini lebih jelas dibanding stereotype tanpa scope untuk role yang memang harus menjadi bean.

---

## 32. Default Scope Dalam Stereotype

Stereotype dapat menentukan default scope.

```java
@Stereotype
@ApplicationScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

Jika class menggunakan stereotype:

```java
@UseCaseService
public class SubmitCaseUseCase { }
```

Maka default lifecycle-nya application scoped.

Namun perlu hati-hati bila class menambahkan scope lain:

```java
@UseCaseService
@RequestScoped
public class SubmitCaseUseCase { }
```

Ini bisa membingungkan karena role mengatakan satu hal, class override mengatakan hal lain. Walaupun container/spec memiliki aturan, dari sisi desain ini perlu sangat jarang.

Rule praktis:

> Jika stereotype membawa default scope, jangan override scope di class kecuali ada alasan kuat dan test eksplisit.

---

## 33. Interceptor Binding Dalam Stereotype

Contoh:

```java
@Stereotype
@ApplicationScoped
@Audited
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

Class:

```java
@UseCaseService
public class SubmitCaseUseCase {
    public SubmissionResult submit(SubmitCaseCommand command) {
        // ...
    }
}
```

Semua business method bisa terkena interceptor binding dari stereotype tergantung aturan binding dan invocation path.

Risiko:

- developer tidak melihat `@Audited` langsung di class;
- behavior tersembunyi di annotation definition;
- jika stereotype terlalu banyak efek, class sulit diprediksi.

Solusi:

- nama stereotype harus jelas;
- dokumentasikan stereotype;
- jangan masukkan terlalu banyak behavior;
- gunakan test yang membuktikan interceptor berjalan.

---

## 34. `@Named` Dalam Stereotype

Stereotype dapat opsional membawa `@Named`, terutama untuk EL/Jakarta Faces/CDI named beans.

Contoh:

```java
@Stereotype
@Named
@RequestScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface WebModel {
}
```

Namun dalam backend service/API modern, `@Named` sering tidak diperlukan.

Jangan memasukkan `@Named` ke stereotype service murni hanya karena “biar bisa dicari by name”. CDI lebih kuat dengan type-safe injection dan qualifier.

Rule:

> Gunakan `@Named` bila memang ada consumer berbasis nama seperti EL, bukan sebagai pengganti qualifier.

---

## 35. Stereotype Untuk Layered Architecture

Contoh set annotation:

```java
@Stereotype
@ApplicationScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface ApplicationService {
}

@Stereotype
@ApplicationScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface DomainPolicy {
}

@Stereotype
@ApplicationScoped
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface InfrastructureAdapter {
}

@Stereotype
@RequestScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface RequestBoundary {
}
```

Namun desain ini perlu konsisten dengan package.

```text
interfaces/rest     -> @RequestBoundary
application         -> @ApplicationService
application/workflow-> @RegulatoryWorkflowStep
domain              -> ideally no CDI, or carefully @DomainPolicy if managed
infrastructure      -> @InfrastructureAdapter
```

Ada tradeoff penting: domain pure object biasanya lebih baik tidak bergantung pada CDI annotation, agar domain tetap portable/testable.

---

## 36. Domain Model: Jangan Terlalu Cepat Diberi CDI Annotation

Contoh buruk:

```java
@ApplicationScoped
public class CaseRecord {
    private CaseStatus status;
}
```

Entity/domain object tidak seharusnya application-scoped singleton. Ini bug desain besar.

Domain object biasanya:

- dibuat oleh constructor/factory/repository;
- punya identity/state;
- bukan singleton;
- bukan bean global.

Annotation CDI lebih cocok untuk:

- service;
- adapter;
- policy stateless;
- orchestrator;
- producer;
- resource boundary.

Bukan untuk semua class.

---

## 37. Custom Annotation Untuk Enforcement Lifecycle

Misalnya kita punya lifecycle enforcement:

```text
Complaint Received
   -> Preliminary Assessment
   -> Investigation Opened
   -> Evidence Gathering
   -> Notice Issued
   -> Representation Received
   -> Decision Made
   -> Enforcement Action
   -> Appeal
   -> Closed
```

Kita bisa mendesain annotation:

```java
public enum EnforcementStage {
    PRELIMINARY_ASSESSMENT,
    INVESTIGATION,
    NOTICE,
    REPRESENTATION,
    DECISION,
    ENFORCEMENT_ACTION,
    APPEAL,
    CLOSURE
}
```

```java
@Retention(RUNTIME)
@Target(TYPE)
public @interface HandlesEnforcementStage {
    EnforcementStage value();
}
```

Usage:

```java
@RegulatoryWorkflowStep
@HandlesEnforcementStage(EnforcementStage.NOTICE)
public class IssueNoticeStep {
    // ...
}
```

Consumer bisa:

- documentation generator;
- startup validator;
- registry builder;
- workflow visualization;
- architecture test.

Jika tidak ada consumer, annotation ini masih bisa dokumentatif, tapi nilainya lebih rendah.

---

## 38. Annotation Untuk Policy Enforcement

Contoh authorization:

```java
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresCapability {
    Capability value();
}
```

```java
public enum Capability {
    CASE_VIEW,
    CASE_ASSIGN,
    CASE_APPROVE,
    CASE_ESCALATE
}
```

Interceptor binding version:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface CapabilityChecked {
}
```

Method:

```java
@CapabilityChecked
@RequiresCapability(Capability.CASE_APPROVE)
public ApprovalResult approve(...) { ... }
```

Kenapa dipisah?

- `@CapabilityChecked` adalah binding untuk menjalankan interceptor.
- `@RequiresCapability` adalah metadata capability yang dibaca interceptor.

Bisa juga digabung, tetapi pemisahan sering membuat model lebih eksplisit.

---

## 39. Jangan Sembunyikan Business Critical Flow Dalam Annotation

Annotation cocok untuk cross-cutting concern dan metadata. Tetapi jangan membuat business flow utama tersembunyi.

Buruk:

```java
@ApproveCase
public void execute(...) {
    // empty
}
```

Lalu semua logic approve terjadi di interceptor berdasarkan annotation.

Ini sulit dibaca, sulit ditest, dan sulit dipahami saat incident.

Lebih baik:

```java
@Audited
@CapabilityChecked
public ApprovalResult approve(ApproveCaseCommand command) {
    CaseRecord record = repository.getRequired(command.caseId());
    policy.ensureCanApprove(record, command.actor());
    record.approve(command.reason());
    repository.save(record);
    return ApprovalResult.approved(record.id());
}
```

Annotation membungkus concern, tetapi business operation tetap terlihat.

---

## 40. Stereotype Dengan Transaction: Hati-Hati

Di Jakarta, transaction boundary bisa datang dari EJB atau Jakarta Transactions/CDI interceptor tergantung runtime.

Membuat stereotype seperti ini:

```java
@Stereotype
@ApplicationScoped
@Transactional
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

bisa tempting.

Namun pertimbangkan:

- apakah semua use case harus transactional?
- apakah read-only use case juga butuh transaksi?
- apakah external call dilakukan dalam transaksi panjang?
- apakah beberapa method butuh `REQUIRES_NEW` atau no transaction?
- apakah self-invocation memotong interceptor?

Rekomendasi:

- untuk sistem kecil/seragam, boleh jika benar-benar invariant;
- untuk sistem enterprise kompleks, sering lebih baik transaction boundary eksplisit di method/class yang tepat;
- gunakan stereotype untuk `@Audited`/`@Measured` lebih aman daripada memasukkan transaction default secara membabi-buta.

---

## 41. Stereotype Dengan Retry: Lebih Hati-Hati Lagi

Retry tidak boleh asal ditempel.

Jika stereotype `@InfrastructureAdapter` otomatis membawa `@Retried`, risikonya:

- operasi non-idempotent diulang;
- external system menerima duplicate request;
- timeout bertambah;
- load meningkat saat dependency down;
- observability misleading.

Lebih baik:

```java
@InfrastructureAdapter
public class PaymentGatewayClient {

    @Retried(maxAttempts = 3)
    public PaymentStatus queryStatus(...) { ... }

    public PaymentResult submitPayment(...) { ... } // no blind retry
}
```

Rule:

> Retry adalah policy operasional yang harus mempertimbangkan idempotency. Jangan masukkan retry ke stereotype terlalu umum.

---

## 42. Stereotype Dengan Feature Gate

Feature gate bisa dipakai sebagai interceptor binding:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface FeatureGated {
    @Nonbinding
    String value();
}
```

Usage:

```java
@FeatureGated("new-escalation-flow")
public EscalationResult escalate(...) { ... }
```

Masukkan ke stereotype hanya jika seluruh role benar-benar behind satu feature.

Misalnya:

```java
@Stereotype
@ApplicationScoped
@FeatureGated("new-case-workflow")
@Retention(RUNTIME)
@Target(TYPE)
public @interface NewCaseWorkflowComponent {
}
```

Namun feature flag biasanya lebih cocok di method/boundary tertentu, bukan stereotype luas.

---

## 43. Annotation Documentation: Wajib Untuk Annotation Dengan Efek Runtime

Setiap custom annotation dengan efek runtime harus punya JavaDoc yang menjawab:

- annotation ini dikonsumsi siapa?
- berlaku pada class/method/field apa?
- efek runtime-nya apa?
- kapan tidak boleh digunakan?
- interaction dengan transaction/proxy/self-invocation?
- apakah member binding atau nonbinding?

Contoh:

```java
/**
 * Marks an application-level use case boundary.
 *
 * <p>Beans annotated with this stereotype are CDI application-scoped beans
 * and are measured and audited through CDI interceptors. This annotation is
 * intended for stateless orchestration services, not for domain entities or
 * request-specific models.</p>
 *
 * <p>Do not use this annotation on classes that store per-request mutable
 * state. Method-level interceptor behavior only applies when invocation goes
 * through the CDI proxy.</p>
 */
@Stereotype
@ApplicationScoped
@Audited
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

Ini mengurangi hidden knowledge.

---

## 44. Naming Custom Annotation

Nama annotation harus menjawab role atau behavior.

### 44.1 Nama Untuk Role

Baik:

```java
@UseCaseService
@ApplicationBoundary
@InfrastructureAdapter
@RegulatoryWorkflowStep
@DomainPolicy
@RequestBoundary
```

Kurang baik:

```java
@ComponentX
@ManagedThing
@BusinessBean
@CommonService
@BaseAnnotation
```

### 44.2 Nama Untuk Behavior

Baik:

```java
@Audited
@Measured
@IdempotentBoundary
@CapabilityChecked
@FeatureGated
@TimedOperation
```

Kurang baik:

```java
@DoAudit
@RunStuff
@CheckIt
@Magic
```

### 44.3 Nama Untuk Qualifier

Baik:

```java
@PrimaryDatabase
@ReadReplica
@ExternalSystem(SystemCode.ONEMAP)
@OutboundConnector
```

Kurang baik:

```java
@Impl1
@NewVersion
@Special
@Default2
```

---

## 45. Package Untuk Annotation

Jangan lempar semua annotation ke `common.annotation` tanpa struktur.

Lebih baik:

```text
com.company.platform.cdi.stereotype
  UseCaseService.java
  InfrastructureAdapter.java

com.company.platform.cdi.binding
  Audited.java
  Measured.java
  FeatureGated.java

com.company.platform.cdi.qualifier
  ExternalSystem.java
  PrimaryDatabase.java

com.company.case.workflow.annotation
  RegulatoryWorkflowStep.java
  HandlesEnforcementStage.java
```

Pisahkan:

- platform-level annotation;
- domain-specific annotation;
- qualifier;
- interceptor binding;
- stereotype;
- test-only annotation.

---

## 46. Versioning Annotation Dalam Library Internal

Jika annotation dipakai lintas module/team, ia menjadi API.

Perubahan berbahaya:

- mengganti package annotation;
- mengganti retention;
- mengganti target;
- mengganti default value member;
- menghapus member;
- mengubah binding menjadi nonbinding atau sebaliknya;
- mengganti stereotype metadata;
- mengganti interceptor binding composition.

Contoh breaking change:

```java
// v1
@Audited
public @interface UseCaseService { }

// v2
@Audited
@Transactional
public @interface UseCaseService { }
```

Ini terlihat kecil, tetapi mengubah transaction behavior semua use case.

Rule:

> Annotation dengan efek runtime harus diperlakukan seperti public API.

---

## 47. Runtime Discovery Cost dan Annotation Scanning

Annotation runtime sering dibaca saat startup/deployment.

Biaya bisa datang dari:

- classpath scanning;
- bytecode indexing;
- reflection;
- CDI bean discovery;
- extension processing;
- annotation processor/build-time index.

Dalam aplikasi besar, annotation design bisa berdampak pada startup:

- terlalu banyak bean discoverable;
- terlalu banyak annotation yang membuat class masuk scanning;
- custom extension membaca terlalu luas;
- repeated reflection saat runtime path panas.

Prinsip:

- gunakan package scanning terbatas jika framework memungkinkan;
- hindari custom runtime scanner sembarangan;
- cache hasil introspection;
- lakukan validation saat startup, bukan per request;
- pertimbangkan build-time indexing pada runtime modern.

---

## 48. Reflection Access dan Java 9+ Modules

Pada Java 9+, JPMS memperkenalkan module boundaries. Reflection terhadap annotation runtime biasanya masih bisa membaca metadata class yang accessible, tetapi deep reflection terhadap member/class non-public bisa terpengaruh oleh module `opens`.

Dalam Jakarta app server, JPMS sering tidak dipakai secara penuh untuk aplikasi WAR/EAR tradisional, tetapi Java version modern tetap membuat reflection/access menjadi topik penting.

Rule praktis:

- jangan bergantung pada deep reflection liar;
- pahami runtime server module model;
- jika memakai JPMS, pastikan package yang perlu direfleksi dibuka sesuai kebutuhan;
- test deployment pada target runtime, bukan hanya unit test Java SE.

---

## 49. Build-Time Annotation Processing vs Runtime Annotation Reading

Ada dua pendekatan:

```text
Build-time processing:
  annotation dibaca saat compile/build, menghasilkan code/index/metadata.

Runtime reading:
  annotation dibaca saat aplikasi start atau saat method dipanggil.
```

Contoh build-time:

- MapStruct mapper generation;
- Dagger DI;
- Quarkus build-time augmentation;
- annotation processor custom;
- static metadata generation.

Contoh runtime:

- CDI classic discovery;
- reflection-based interceptor metadata;
- runtime policy interceptor.

Tradeoff:

| Pendekatan | Kelebihan | Kekurangan |
|---|---|---|
| Build-time | startup cepat, error lebih awal, native-friendly | build kompleks, kurang dinamis |
| Runtime | fleksibel, familiar, dynamic | startup cost, error bisa muncul saat deploy/runtime |

Top engineer tahu kapan metadata harus diverifikasi di build/startup, bukan menunggu request production pertama.

---

## 50. Testing Custom Stereotype

Minimal test untuk stereotype:

1. bean dengan stereotype ditemukan CDI;
2. scope default sesuai;
3. interceptor binding berjalan;
4. class yang tidak boleh memakai stereotype terdeteksi architecture test;
5. self-invocation limitation dipahami;
6. annotation retention/target benar.

Contoh conceptual test:

```java
@Test
void useCaseServiceShouldBeCdiBeanAndAudited() {
    // boot CDI container test
    // obtain bean by type
    // call method via proxy
    // assert audit sink received record
}
```

Jangan hanya test annotation definition. Test efek runtime.

---

## 51. Startup Validation Untuk Annotation Contract

Untuk sistem enterprise, beberapa annotation contract bisa divalidasi saat startup.

Contoh:

- semua `@AuditEvent` value harus terdaftar di taxonomy;
- semua `@FeatureGated` key harus dikenal feature flag registry;
- semua `@HandlesEnforcementStage` harus unik untuk stage tertentu;
- semua `@ExternalSystem` harus punya config endpoint;
- semua `@RegulatoryWorkflowStep` harus implement interface `WorkflowStep`.

Pseudo:

```java
@ApplicationScoped
public class AnnotationContractValidator {

    void onStartup(@Observes StartupEvent event) {
        validateAuditEvents();
        validateFeatureKeys();
        validateWorkflowSteps();
    }
}
```

Event startup spesifik bisa berbeda antar runtime, tetapi idenya sama: fail fast.

---

## 52. Failure Modes

### 52.1 Annotation Tidak Terbaca Karena Retention Salah

```java
@Retention(SOURCE)
@Stereotype
public @interface UseCaseService { }
```

Runtime tidak bisa membaca annotation.

Gejala:

- bean tidak ditemukan;
- interceptor tidak jalan;
- architecture scanner runtime tidak melihat metadata.

Solusi:

```java
@Retention(RUNTIME)
```

---

### 52.2 Target Salah

```java
@Target(METHOD)
public @interface UseCaseService { }
```

Lalu dipakai di class.

Compile error atau annotation tidak bisa digunakan sesuai intent.

---

### 52.3 Lupa `@Stereotype`

```java
@ApplicationScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService { }
```

Ini bukan CDI stereotype meskipun membawa `@ApplicationScoped` secara meta. Container mungkin tidak memperlakukan seperti stereotype CDI.

Solusi:

```java
@Stereotype
@ApplicationScoped
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService { }
```

---

### 52.4 Interceptor Binding Tidak Aktif

Annotation ada, tetapi interceptor tidak jalan.

Kemungkinan:

- annotation bukan `@InterceptorBinding`;
- interceptor tidak diberi binding yang sesuai;
- interceptor tidak enabled/priority;
- invocation tidak melalui CDI proxy;
- method final/private/tidak interceptable;
- bean tidak managed.

---

### 52.5 Annotation Member Membuat Binding Terlalu Spesifik

```java
@Audited("APPROVE")
public void approve() { }

@Audited("REJECT")
@Interceptor
public class AuditInterceptor { }
```

Jika member ikut binding, interceptor bisa hanya match nilai tertentu.

Gunakan `@Nonbinding` bila value hanya metadata.

---

### 52.6 Stereotype Terlalu Banyak Efek

Satu annotation mengaktifkan audit, metrics, transaction, retry, feature gate, security, cache.

Gejala:

- behavior sulit diprediksi;
- debugging lambat;
- perubahan annotation memengaruhi ratusan class;
- incident root cause tersembunyi.

Solusi:

- pecah role dan behavior;
- dokumentasikan;
- architecture decision record;
- test per behavior.

---

### 52.7 Annotation Menjadi Config Yang Salah Tempat

Contoh:

```java
@Retry(maxAttempts = 7, delayMillis = 5000)
```

Jika angka ini harus berubah antar environment, annotation bukan tempat terbaik. Gunakan config key:

```java
@Retried(policy = "external-system-default")
```

Lalu nilai detail di config.

---

## 53. Decision Matrix: Perlu Custom Annotation Atau Tidak?

| Kondisi | Gunakan custom annotation? | Catatan |
|---|---:|---|
| Butuh CDI qualifier type-safe | Ya | Buat qualifier kecil dan jelas |
| Butuh interceptor binding | Ya | Pastikan binding/nonbinding benar |
| Banyak class punya role + metadata sama | Ya, stereotype | Nama harus semantik |
| Hanya ingin mengurangi import | Tidak selalu | Bisa jadi kosmetik |
| Nilai berubah per environment | Biasanya tidak | Gunakan config |
| Nilai berubah runtime | Tidak | Gunakan feature flag/policy store |
| Hanya dokumentasi informal | Mungkin | Naming/package mungkin cukup |
| Perlu architecture rule | Ya | Tambahkan test/CI |
| Logic bisnis utama ingin disembunyikan | Tidak | Tulis explicit code |
| Secret/token/key | Tidak | Gunakan secret manager/config |

---

## 54. Checklist Mendesain Annotation Enterprise

Sebelum membuat annotation, jawab:

1. Apa nama semantiknya?
2. Siapa consumer-nya?
3. Dibaca saat compile, startup, atau runtime invocation?
4. Apakah perlu `RUNTIME` retention?
5. Target-nya apa?
6. Apakah annotation ini role, qualifier, interceptor binding, atau stereotype?
7. Apakah ada member?
8. Apakah member ikut binding/resolution?
9. Perlu `@Nonbinding`?
10. Apakah nilai member stabil?
11. Apakah annotation mengandung config yang seharusnya eksternal?
12. Apakah annotation mengandung secret? Jika ya, desain salah.
13. Apakah behavior-nya terlalu tersembunyi?
14. Apakah ada test yang membuktikan efek runtime?
15. Apakah ada dokumentasi JavaDoc?
16. Apakah perubahan annotation akan menjadi breaking change?
17. Apakah annotation memperkuat package/module boundary atau menutupinya?
18. Apakah developer baru bisa menebak intent dari namanya?

---

## 55. Recommended Annotation Set Untuk Sistem Enterprise

Untuk aplikasi besar, jangan mulai dengan 50 annotation. Mulai kecil.

### 55.1 Stereotype Minimum

```java
@UseCaseService
@InfrastructureAdapter
@RequestBoundary
```

Opsional domain-specific:

```java
@RegulatoryWorkflowStep
```

### 55.2 Interceptor Binding Minimum

```java
@Audited
@Measured
@CapabilityChecked
@FeatureGated
```

Tambahkan dengan hati-hati:

```java
@IdempotentBoundary
@Retried
```

### 55.3 Qualifier Minimum

```java
@PrimaryDatabase
@ReadReplica
@ExternalSystem(SystemCode.X)
```

### 55.4 Marker/Governance Annotation

```java
@HandlesEnforcementStage
@PublicApiBoundary
@InternalOnly
```

Hanya jika ada architecture test atau documentation consumer.

---

## 56. Worked Example: Annotation Design Untuk Case Management

Misalnya kita ingin desain runtime annotation untuk regulatory case management.

### 56.1 Use Case Stereotype

```java
@Stereotype
@ApplicationScoped
@Audited
@Measured
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCaseService {
}
```

### 56.2 Workflow Step Stereotype

```java
@Stereotype
@ApplicationScoped
@Audited
@Measured
@IdempotentBoundary
@Retention(RUNTIME)
@Target(TYPE)
public @interface RegulatoryWorkflowStep {
}
```

### 56.3 Stage Metadata

```java
@Retention(RUNTIME)
@Target(TYPE)
public @interface HandlesStage {
    EnforcementStage value();
}
```

### 56.4 Capability Metadata

```java
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresCapability {
    Capability value();
}
```

### 56.5 Capability Interceptor Binding

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface CapabilityChecked {
}
```

### 56.6 Usage

```java
@RegulatoryWorkflowStep
@HandlesStage(EnforcementStage.NOTICE)
public class IssueNoticeStep {

    @CapabilityChecked
    @RequiresCapability(Capability.CASE_NOTICE_ISSUE)
    public StepResult execute(IssueNoticeCommand command) {
        // visible business operation
        return StepResult.completed();
    }
}
```

Runtime contract:

```text
IssueNoticeStep:
  - managed by CDI
  - application scoped
  - audited
  - measured
  - idempotency boundary
  - handles NOTICE stage
  - execute requires CASE_NOTICE_ISSUE capability
```

Ini membuat metadata arsitektur terbaca tanpa menyembunyikan business code.

---

## 57. Review Heuristics Untuk Pull Request

Saat review PR yang menambah annotation/custom stereotype, tanyakan:

1. Apakah annotation ini role atau behavior?
2. Apakah nama annotation menjelaskan intent?
3. Apakah annotation punya runtime effect?
4. Apakah effect itu terlihat/didokumentasikan?
5. Apakah ada test?
6. Apakah annotation mengubah lifecycle/scope?
7. Apakah annotation mengubah transaction/retry/security secara luas?
8. Apakah annotation member seharusnya config?
9. Apakah annotation akan membuat class discoverable sebagai bean?
10. Apakah ada hidden coupling dengan interceptor/provider?
11. Apakah annotation menambah ambiguity atau menguranginya?
12. Apakah ini menutup desain package yang buruk?

---

## 58. Top 1% Mental Model

Engineer biasa melihat annotation sebagai:

```text
Tambahkan @X supaya jalan.
```

Engineer kuat melihat annotation sebagai:

```text
Metadata contract yang dikonsumsi oleh compiler/container/framework/tooling,
memengaruhi lifecycle, dependency resolution, interception, discovery,
policy enforcement, dan operational behavior.
```

Engineer top-tier bertanya:

```text
- siapa membaca metadata ini?
- kapan metadata dibaca?
- apakah efeknya deterministic?
- apakah bisa diuji?
- apakah aman terhadap refactoring?
- apakah behavior tersembunyi terlalu banyak?
- apakah nilai ini seharusnya config, bukan annotation?
- apakah annotation memperkuat model arsitektur?
```

---

## 59. Ringkasan

Stereotype dan annotation composition adalah alat penting untuk membuat sistem enterprise lebih konsisten dan semantik.

Poin utama:

1. Annotation adalah metadata, bukan behavior.
2. Behavior muncul karena ada consumer: container, interceptor, processor, scanner, test, atau framework.
3. CDI stereotype menggabungkan metadata umum untuk role bean tertentu.
4. Stereotype harus menyatakan role, bukan sekadar alias teknis.
5. Custom annotation harus didesain seperti API.
6. `Retention`, `Target`, `@Nonbinding`, dan meta-annotation adalah detail kecil yang menentukan behavior besar.
7. Jangan menyimpan secret/config dinamis dalam annotation.
8. Jangan sembunyikan business logic utama dalam annotation.
9. Annotation yang baik memperkuat arsitektur; annotation buruk menutupi desain yang lemah.
10. Untuk sistem besar, annotation harus disertai dokumentasi, test, dan governance.

---

## 60. Latihan

### Latihan 1 — Identify Annotation Category

Kategorikan annotation berikut:

```java
@ApplicationScoped
@ExternalSystem(SystemCode.ONEMAP)
@Audited
@UseCaseService
@PostConstruct
@Resource
```

Tentukan mana scope, qualifier, interceptor binding, stereotype, lifecycle, dan resource annotation.

---

### Latihan 2 — Design Stereotype

Buat stereotype untuk `ReadOnlyQueryService` dengan karakteristik:

- application-scoped;
- measured;
- tidak audited secara default;
- tidak transactional write;
- hanya untuk service query/read model.

Tulis JavaDoc-nya.

---

### Latihan 3 — Find Annotation Smell

Evaluasi desain ini:

```java
@Stereotype
@ApplicationScoped
@Audited
@Transactional
@Retried(maxAttempts = 5)
@FeatureGated("new-flow")
@Retention(RUNTIME)
@Target(TYPE)
public @interface EnterpriseService {
}
```

Jelaskan minimal 5 risiko desain.

---

### Latihan 4 — Annotation vs Config

Tentukan mana yang lebih cocok sebagai annotation dan mana sebagai config:

1. audit event type;
2. HTTP timeout;
3. feature enabled/disabled;
4. capability required by method;
5. external API key;
6. enforcement stage handled by workflow step;
7. retry max attempts;
8. bean role as application boundary.

---

### Latihan 5 — Architecture Rule

Desain rule:

- semua class `*UseCase` harus `@UseCaseService`;
- class `@UseCaseService` tidak boleh berada di package `infrastructure`;
- class domain tidak boleh memakai CDI scope annotation.

Tuliskan pseudo-test atau rule-nya.

---

## 61. Mini Glossary

**Annotation**  
Metadata yang ditempel pada elemen Java.

**Meta-annotation**  
Annotation yang ditempel pada annotation lain.

**Retention**  
Kapan annotation tersedia: source, class, atau runtime.

**Target**  
Elemen Java mana yang boleh diberi annotation.

**Qualifier**  
Annotation CDI untuk memilih varian dependency.

**Interceptor binding**  
Annotation yang menghubungkan target dengan interceptor behavior.

**Stereotype**  
Annotation CDI yang menggabungkan metadata umum untuk role bean.

**Marker annotation**  
Annotation tanpa member.

**Annotation member**  
Parameter/nilai dalam annotation.

**`@Nonbinding`**  
Menandai member qualifier/interceptor binding agar tidak ikut matching/binding.

**Annotation soup**  
Kondisi class penuh annotation yang membuat behavior sulit dipahami.

---

## 62. Checklist Sebelum Lanjut Ke Part Berikutnya

Sebelum lanjut, pastikan kamu bisa menjawab:

1. Mengapa annotation bukan behavior?
2. Apa bedanya qualifier, interceptor binding, scope, dan stereotype?
3. Kapan harus memakai stereotype?
4. Mengapa retention runtime penting untuk CDI?
5. Apa risiko annotation member tanpa `@Nonbinding`?
6. Mengapa annotation tidak cocok untuk secret/config dinamis?
7. Apa itu annotation soup?
8. Bagaimana custom annotation bisa menjadi governance contract?
9. Mengapa stereotype harus menyatakan role arsitektural?
10. Bagaimana mendesain annotation agar tidak menyembunyikan business logic?

---

## 63. Status Seri

Selesai:

- Part 000 — Orientation: Enterprise Runtime Mental Model
- Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
- Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
- Part 003 — Java EE to Jakarta EE Migration Model: `javax.*` to `jakarta.*`
- Part 004 — Runtime / Container Model: Who Owns Your Object?
- Part 005 — Classloaders, Modules, and Deployment Isolation
- Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
- Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
- Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
- Part 009 — Bean Discovery and Archive Model
- Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
- Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
- Part 012 — Qualifiers, Alternatives, Specialization, and Priority
- Part 013 — Producers and Disposers: Programmatic Object Supply
- Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
- Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
- Part 016 — Decorators: Semantic Wrapping of Business Interfaces
- Part 017 — Stereotypes and Annotation Composition

Belum selesai. Bagian berikutnya:

- Part 018 — Lifecycle Callbacks: Construction, Initialization, Destruction

