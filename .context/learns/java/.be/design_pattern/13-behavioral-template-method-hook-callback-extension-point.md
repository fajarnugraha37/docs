# 13 — Behavioral Pattern V: Template Method, Hook, Callback, Extension Point

Series: `learn-java-design-patterns-antipatterns-architecture-engineering`  
Part: `13 / 35`  
File: `13-behavioral-template-method-hook-callback-extension-point.md`  
Scope: Java 8 sampai Java 25  
Level: Advanced / Staff-level engineering judgment

---

## 0. Executive Summary

Bagian ini membahas keluarga pattern yang sering muncul ketika sebuah sistem membutuhkan **alur kerja yang stabil**, tetapi beberapa langkah di dalamnya perlu bisa divariasikan, diganti, disisipkan, atau diperluas.

Pattern utama:

1. **Template Method**  
   Algoritma utama tetap di base class, beberapa langkah didelegasikan ke subclass.

2. **Hook Method**  
   Titik opsional untuk mengubah perilaku tanpa mengubah struktur utama algoritma.

3. **Callback**  
   Algoritma menerima behavior dari luar dan memanggilnya pada waktu tertentu.

4. **Extension Point**  
   Kontrak resmi yang disediakan sistem/framework agar pihak lain dapat memperluas perilaku tanpa memodifikasi core.

Inti mental model:

> Pattern ini bukan sekadar “abstract class dengan method abstract”. Pattern ini adalah cara mengontrol variasi di dalam flow yang harus tetap menjaga invariant.

Di Java enterprise, pattern ini muncul di banyak tempat:

- batch processing
- import/export pipeline
- approval workflow
- validation pipeline
- HTTP request lifecycle
- ORM lifecycle callback
- framework lifecycle
- template rendering
- scheduled job framework
- migration runner
- test framework
- security filter/interceptor
- extension/plugin architecture

Namun pattern ini juga sering menjadi sumber masalah besar:

- fragile base class
- inheritance trap
- override sembarangan
- hidden side effects
- callback hell
- extension point tanpa contract
- subclass yang merusak invariant
- protected method yang terlalu banyak
- lifecycle yang tidak eksplisit

Engineer yang matang tidak bertanya:

> “Apakah saya harus pakai Template Method?”

Tetapi bertanya:

> “Apakah ada algorithm skeleton yang stabil? Variasinya apa? Invariant apa yang tidak boleh dilanggar? Apakah inheritance aman? Apakah composition lebih tepat? Apakah extension point ini cukup eksplisit untuk dipakai tim lain?”

---

## 1. Learning Objectives

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami Template Method sebagai pattern untuk mengunci struktur algoritma.
2. Membedakan Template Method, Strategy, Callback, Hook, Interceptor, dan Chain of Responsibility.
3. Mendesain base class yang aman dari fragile base class problem.
4. Menentukan kapan inheritance masih layak digunakan.
5. Menentukan kapan Template Method harus diganti Strategy atau composition.
6. Mendesain hook method yang tidak membocorkan invariant.
7. Mendesain callback API yang readable, testable, dan tidak menyembunyikan failure.
8. Mendesain extension point untuk framework/library internal.
9. Memahami dampak Java 8–25 terhadap pattern ini.
10. Mengenali anti-pattern seperti inheritance trap, callback pyramid, hook abuse, dan magic lifecycle.
11. Membuat refactoring path dari inheritance-heavy code menuju composition yang lebih sehat.
12. Menggunakan pattern ini dalam konteks enterprise Java dengan auditability, reliability, dan maintainability.

---

## 2. Core Problem

Banyak sistem memiliki flow seperti ini:

```text
receive input
validate input
prepare context
execute main operation
persist result
emit event
write audit
return response
```

Struktur besarnya stabil. Namun detailnya berbeda:

- validasi berbeda per jenis request
- transformasi berbeda per channel
- rule berbeda per module
- audit detail berbeda per operation
- error handling berbeda per integration
- output berbeda per format

Masalah muncul kalau semua variasi ditangani dengan `if-else`:

```java
void process(Request request) {
    validateCommon(request);

    if (request.type() == Type.APPLICATION) {
        validateApplication(request);
        enrichApplication(request);
        saveApplication(request);
    } else if (request.type() == Type.APPEAL) {
        validateAppeal(request);
        enrichAppeal(request);
        saveAppeal(request);
    } else if (request.type() == Type.RENEWAL) {
        validateRenewal(request);
        enrichRenewal(request);
        saveRenewal(request);
    }

    audit(request);
}
```

Masalah desainnya:

1. Flow utama bercampur dengan variasi.
2. Penambahan jenis baru mengubah method besar.
3. Invariant mudah rusak.
4. Testing sulit karena banyak kombinasi path.
5. Observability sulit karena lifecycle tidak eksplisit.
6. Ownership tidak jelas.

Template Method, Hook, Callback, dan Extension Point mencoba menyelesaikan masalah ini dengan cara berbeda.

---

## 3. Mental Model: Stable Skeleton, Variable Steps

Template Method cocok ketika kamu bisa mengatakan:

```text
Urutan langkahnya hampir selalu sama,
tetapi beberapa langkah perlu berbeda tergantung implementasi.
```

Contoh:

```text
Algorithm skeleton:
1. open resource
2. validate header
3. parse rows
4. validate each row
5. persist accepted rows
6. report rejected rows
7. close resource

Variation:
- CSV vs XLSX vs XML
- validation rule per module
- persistence target per domain
- rejection report format
```

Yang ingin dikunci:

```text
open -> validate -> process -> persist -> report -> close
```

Yang ingin divariasikan:

```text
how to parse
how to validate row
how to map row
how to persist
```

Template Method membuat flow utama menjadi eksplisit:

```java
public final ImportResult importFile(InputFile file) {
    ImportContext context = open(file);
    try {
        validateHeader(context);
        List<Row> rows = parseRows(context);
        List<DomainObject> objects = mapRows(rows);
        validateObjects(objects);
        persist(objects);
        return success(objects);
    } catch (Exception e) {
        return failure(e);
    } finally {
        close(context);
    }
}
```

Subclass hanya mengisi beberapa bagian.

---

## 4. Pattern Family Map

Pattern ini sering tertukar. Bedakan begini:

| Pattern | Variasi Di Mana? | Mekanisme | Cocok Ketika |
|---|---:|---|---|
| Template Method | Subclass | Inheritance | Skeleton stabil, variasi per subclass |
| Hook Method | Subclass optional | Override default method | Ada titik opsional dalam skeleton |
| Callback | Caller-supplied behavior | Function/object passed in | Behavior kecil dikirim dari luar |
| Strategy | Object dependency | Composition | Behavior besar perlu diganti runtime/test |
| Interceptor | Around lifecycle | Chain/wrapper | Cross-cutting concern |
| Chain of Responsibility | Handler sequence | Linked/pipeline handlers | Banyak handler bisa memproses/menolak |
| Extension Point | External implementor | Interface/SPI/registration | Framework/library ingin diperluas pihak lain |

Rule praktis:

```text
Template Method = base class owns algorithm.
Strategy = caller/composer owns algorithm assembly.
Callback = operation asks caller to provide small behavior.
Extension Point = framework publishes supported customization contract.
```

---

## 5. Template Method Pattern

### 5.1 Definition

Template Method adalah pattern behavioral di mana base class mendefinisikan skeleton algoritma, sementara beberapa langkah didelegasikan ke subclass.

Bentuk umum:

```java
public abstract class AbstractProcessor {

    public final ProcessResult process(ProcessInput input) {
        validate(input);
        PreprocessedInput prepared = prepare(input);
        ProcessResult result = execute(prepared);
        afterSuccess(input, result);
        return result;
    }

    protected abstract void validate(ProcessInput input);

    protected PreprocessedInput prepare(ProcessInput input) {
        return PreprocessedInput.from(input);
    }

    protected abstract ProcessResult execute(PreprocessedInput input);

    protected void afterSuccess(ProcessInput input, ProcessResult result) {
        // hook, default no-op
    }
}
```

Ciri penting:

1. Template method biasanya `final`.
2. Step yang wajib diimplementasikan biasanya `abstract`.
3. Step opsional biasanya concrete no-op atau default behavior.
4. Invariant dijaga oleh base class.
5. Subclass tidak boleh mengontrol urutan utama.

---

## 6. Kenapa Template Method Masih Relevan di Java Modern?

Ada anggapan bahwa sejak Java 8, semua inheritance pattern harus diganti lambda/composition. Itu terlalu ekstrem.

Template Method masih berguna ketika:

1. Ada **lifecycle yang kuat**.
2. Urutan langkah harus dikunci.
3. Invariant harus dijaga oleh framework/base class.
4. Subclass hanya boleh mengubah titik tertentu.
5. Ada shared setup/teardown yang tidak boleh dilupakan.
6. Ada resource management yang harus selalu benar.

Contoh yang tetap masuk akal:

- abstract test support class
- import/export framework internal
- job runner skeleton
- migration runner
- request operation skeleton
- document generation lifecycle
- batch step skeleton
- parser skeleton
- validation template

Namun Template Method menjadi buruk ketika:

1. Subclass terlalu banyak.
2. Protected method terlalu banyak.
3. Base class tahu terlalu banyak domain detail.
4. Variasi perlu diganti runtime.
5. Kombinasi variasi membentuk matrix besar.
6. Subclass mulai override method untuk “mengakali” flow.

---

## 7. Java 8–25 Perspective

### 7.1 Java 8: Lambda dan Functional Interface

Java 8 membuat banyak penggunaan Template Method bisa diganti dengan callback atau Strategy ringan.

Sebelum Java 8:

```java
abstract class TransactionTemplate {
    public final void run() {
        begin();
        try {
            doInTransaction();
            commit();
        } catch (RuntimeException e) {
            rollback();
            throw e;
        }
    }

    protected abstract void doInTransaction();
}
```

Sesudah Java 8:

```java
public final class TransactionRunner {
    public <T> T runInTransaction(Supplier<T> work) {
        begin();
        try {
            T result = work.get();
            commit();
            return result;
        } catch (RuntimeException e) {
            rollback();
            throw e;
        }
    }
}
```

Pemahaman penting:

```text
Kalau variasinya hanya satu behavior kecil, callback/lambda sering lebih ringan daripada subclass.
Kalau variasinya banyak step dengan lifecycle kuat, Template Method masih bisa lebih jelas.
```

Oracle mendokumentasikan bahwa Java interface dapat memiliki default method sejak Java 8 untuk menambah fungsi baru sambil menjaga kompatibilitas biner implementasi lama. Ini relevan karena default method sering dipakai sebagai hook ringan di interface, tetapi harus tetap hati-hati agar interface tidak berubah menjadi base class tersembunyi.

### 7.2 Default Method sebagai Hook

Contoh:

```java
public interface ImportExtension {

    default void beforeImport(ImportContext context) {
        // optional hook
    }

    default void afterImport(ImportContext context, ImportResult result) {
        // optional hook
    }

    void validateRow(Row row);
}
```

Kelebihan:

- tidak perlu abstract base class
- implementor hanya override yang diperlukan
- cocok untuk extension point kecil

Risiko:

- interface mulai menyimpan terlalu banyak lifecycle logic
- default method menyembunyikan behavior penting
- sulit memahami urutan eksekusi
- implementor tidak sadar default behavior berjalan

### 7.3 Java 17+: Sealed Classes

Sealed classes bisa membuat Template Method lebih aman ketika variasi subclass harus terbatas.

```java
public sealed abstract class CaseOperation
        permits ApproveCaseOperation, RejectCaseOperation, EscalateCaseOperation {

    public final OperationResult execute(OperationCommand command) {
        validateCommon(command);
        validateSpecific(command);
        OperationResult result = perform(command);
        audit(command, result);
        return result;
    }

    protected abstract void validateSpecific(OperationCommand command);

    protected abstract OperationResult perform(OperationCommand command);
}
```

Manfaat:

- daftar subclass eksplisit
- lebih mudah reasoning
- lebih aman dari extension liar
- cocok untuk bounded domain operation

### 7.4 Records

Records cocok untuk input/output immutable dari template flow.

```java
public record OperationCommand(
        String caseId,
        String actorId,
        String reason,
        Instant requestedAt
) {}
```

Records tidak menggantikan Template Method. Records membantu membuat data antar-step lebih eksplisit dan immutable.

### 7.5 Pattern Matching dan Switch Expression

Jika variasi kecil dan closed, sealed + switch kadang lebih sederhana daripada Template Method.

```java
return switch (command) {
    case ApproveCommand approve -> approve(approve);
    case RejectCommand reject -> reject(reject);
    case EscalateCommand escalate -> escalate(escalate);
};
```

Decision rule:

```text
Closed variation + simple behavior -> sealed + switch bisa cukup.
Stable lifecycle + multiple overridable steps -> Template Method lebih cocok.
Runtime-pluggable behavior -> Strategy/Extension Point lebih cocok.
```

---

## 8. Template Method Anatomy

Template Method yang baik memiliki bagian berikut:

```text
1. Public final entrypoint
2. Common validation
3. Controlled variable steps
4. Optional hooks
5. Centralized error handling
6. Centralized resource management
7. Centralized audit/telemetry if relevant
8. Clear subclass contract
```

Contoh struktur:

```java
public abstract class AbstractCaseAction<C extends CaseCommand> {

    public final CaseActionResult handle(C command) {
        ActionContext context = createContext(command);

        try {
            validateCommon(context);
            validateSpecific(context);

            beforeMutation(context);
            CaseActionResult result = mutate(context);
            afterMutation(context, result);

            audit(context, result);
            publishEvents(context, result);

            return result;
        } catch (DomainException e) {
            auditFailure(context, e);
            throw e;
        }
    }

    private ActionContext createContext(C command) {
        return ActionContext.from(command);
    }

    private void validateCommon(ActionContext context) {
        if (context.actorId() == null) {
            throw new DomainException("Actor is required");
        }
    }

    protected abstract void validateSpecific(ActionContext context);

    protected void beforeMutation(ActionContext context) {
        // optional hook
    }

    protected abstract CaseActionResult mutate(ActionContext context);

    protected void afterMutation(ActionContext context, CaseActionResult result) {
        // optional hook
    }

    private void audit(ActionContext context, CaseActionResult result) {
        // invariant: every successful action audited
    }

    private void publishEvents(ActionContext context, CaseActionResult result) {
        // invariant: event publication controlled here
    }

    private void auditFailure(ActionContext context, DomainException e) {
        // invariant: every failed domain decision audited
    }
}
```

Perhatikan:

- public method `final`
- invariant method `private`
- subclass hanya override yang aman
- audit/event tidak diserahkan sepenuhnya ke subclass
- failure path juga dikontrol

---

## 9. The Most Important Rule: Template Method Must Guard Invariants

Kesalahan umum adalah membuat base class hanya sebagai tempat reuse code.

Itu lemah.

Template Method yang kuat bukan sekadar reuse. Ia menjaga invariant.

Contoh invariant:

```text
Every case action must:
1. check actor identity
2. check authorization
3. validate current state
4. write audit record
5. mutate within transaction
6. emit event after successful mutation
7. normalize domain error
```

Kalau subclass bisa melewati audit, berarti Template Method gagal.

Buruk:

```java
protected void audit(ActionContext context, CaseActionResult result) {
    // subclass may override and do nothing
}
```

Lebih aman:

```java
private void audit(ActionContext context, CaseActionResult result) {
    auditWriter.write(AuditRecord.from(context, result));
}
```

Atau kalau perlu variasi:

```java
private void audit(ActionContext context, CaseActionResult result) {
    AuditDetails details = auditDetails(context, result);
    auditWriter.write(AuditRecord.from(context, result, details));
}

protected AuditDetails auditDetails(ActionContext context, CaseActionResult result) {
    return AuditDetails.empty();
}
```

Subclass hanya mengisi detail, bukan memutuskan apakah audit terjadi.

---

## 10. Hook Method

Hook adalah method opsional yang dipanggil oleh template flow.

Contoh:

```java
protected void beforeValidation(ActionContext context) {
    // optional
}

protected void afterSuccess(ActionContext context, Result result) {
    // optional
}
```

Hook baik ketika:

1. Ada kebutuhan extension opsional.
2. Default behavior aman.
3. Hook tidak boleh merusak invariant.
4. Urutan hook jelas.
5. Side effect hook terkendali.

Hook buruk ketika:

1. Terlalu banyak hook.
2. Hook saling bergantung.
3. Hook mengubah state internal base class.
4. Hook dipanggil dalam urutan yang tidak jelas.
5. Hook bisa membatalkan invariant penting.

---

## 11. Hook Design Rules

### 11.1 Hook Should Be Narrow

Buruk:

```java
protected void customize(ProcessContext context) {
    // can do anything
}
```

Lebih baik:

```java
protected ValidationPolicy validationPolicy(ProcessContext context) {
    return ValidationPolicy.strict();
}
```

Atau:

```java
protected List<AdditionalCheck> additionalChecks() {
    return List.of();
}
```

Semakin luas hook, semakin sulit menjamin invariant.

### 11.2 Hook Should Have Clear Timing

Nama hook harus menunjukkan kapan dipanggil:

```java
beforeValidation
beforeMutation
afterMutation
afterCommit
afterFailure
```

Hindari nama generik:

```java
processCustom
handleExtra
doMore
customize
```

### 11.3 Hook Should Avoid Hidden Mandatory Behavior

Kalau subclass wajib override, jangan jadikan hook no-op.

Buruk:

```java
protected void validateSpecific(Command command) {
    // default no-op, but actually should be implemented
}
```

Lebih baik:

```java
protected abstract void validateSpecific(Command command);
```

### 11.4 Hook Should Not Expose Mutable Internal State

Buruk:

```java
protected void beforePersist(List<Entity> internalEntities) {
    // subclass can mutate freely
}
```

Lebih baik:

```java
protected List<DomainEvent> eventsAfterPersist(ReadOnlyPersistResult result) {
    return List.of();
}
```

---

## 12. Callback Pattern

Callback adalah behavior yang diberikan dari luar kepada sebuah operasi untuk dipanggil pada momen tertentu.

Contoh sederhana:

```java
public <T> T withRetry(Supplier<T> operation) {
    RuntimeException last = null;

    for (int attempt = 1; attempt <= 3; attempt++) {
        try {
            return operation.get();
        } catch (RuntimeException e) {
            last = e;
        }
    }

    throw last;
}
```

Pemakai:

```java
User user = retryRunner.withRetry(() -> userClient.fetchUser(userId));
```

Callback cocok ketika:

1. Variasinya kecil.
2. Behavior tidak butuh banyak lifecycle method.
3. Caller lebih tahu pekerjaan spesifiknya.
4. Framework hanya menyediakan wrapper control seperti retry, transaction, lock, metric.

---

## 13. Callback vs Template Method

| Pertanyaan | Template Method | Callback |
|---|---|---|
| Siapa punya skeleton? | Base class | Ordinary object/function runner |
| Variasi disediakan lewat? | Subclass override | Function/object parameter |
| Cocok untuk? | Multi-step lifecycle | Single focused behavior |
| Risiko utama | Fragile inheritance | Callback nesting / hidden failure |
| Java modern style | Abstract class/sealed | Lambda/functional interface |

Contoh callback untuk transaction:

```java
public final class TransactionTemplate {

    public <T> T execute(TransactionCallback<T> callback) {
        Transaction tx = begin();
        try {
            T result = callback.doInTransaction(tx);
            commit(tx);
            return result;
        } catch (RuntimeException e) {
            rollback(tx);
            throw e;
        }
    }
}

@FunctionalInterface
public interface TransactionCallback<T> {
    T doInTransaction(Transaction tx);
}
```

Pemakaian:

```java
CaseRecord saved = transactionTemplate.execute(tx -> {
    CaseRecord record = repository.save(caseDraft);
    auditRepository.save(AuditRecord.created(record.id()));
    return record;
});
```

Kelebihan:

- tidak perlu subclass
- call site eksplisit
- mudah test
- cocok untuk operasi kecil

Risiko:

- callback terlalu besar
- transaction boundary tersembunyi di lambda panjang
- exception semantics tidak jelas
- callback nested terlalu dalam

---

## 14. Extension Point

Extension point adalah kontrak resmi yang disediakan oleh sistem agar behavior bisa diperluas tanpa mengubah core.

Contoh:

```java
public interface CaseActionExtension {

    boolean supports(CaseActionType actionType);

    default void beforeValidation(CaseActionContext context) {}

    default void afterValidation(CaseActionContext context) {}

    default void afterSuccess(CaseActionContext context, CaseActionResult result) {}

    default void afterFailure(CaseActionContext context, Throwable failure) {}
}
```

Framework internal:

```java
public final class CaseActionEngine {

    private final List<CaseActionExtension> extensions;

    public CaseActionResult execute(CaseActionCommand command) {
        CaseActionContext context = CaseActionContext.from(command);
        List<CaseActionExtension> selected = selectExtensions(command.actionType());

        try {
            selected.forEach(ext -> ext.beforeValidation(context));
            validate(context);
            selected.forEach(ext -> ext.afterValidation(context));

            CaseActionResult result = mutate(context);

            selected.forEach(ext -> ext.afterSuccess(context, result));
            return result;
        } catch (Throwable failure) {
            selected.forEach(ext -> ext.afterFailure(context, failure));
            throw failure;
        }
    }

    private List<CaseActionExtension> selectExtensions(CaseActionType actionType) {
        return extensions.stream()
                .filter(ext -> ext.supports(actionType))
                .toList();
    }
}
```

Extension point cocok ketika:

1. Core engine stabil.
2. Banyak module perlu menyisipkan behavior.
3. Ownership extension berbeda dari ownership core.
4. Kontrak lifecycle perlu resmi.
5. Behavior tambahan tidak boleh mengubah flow utama secara liar.

---

## 15. Extension Point Design Checklist

Extension point yang baik harus menjawab:

```text
1. Kapan extension dipanggil?
2. Dalam transaction atau di luar transaction?
3. Boleh melakukan mutation atau read-only?
4. Boleh throw exception?
5. Kalau throw, apakah flow berhenti?
6. Urutannya deterministic?
7. Bisa ada lebih dari satu extension?
8. Extension boleh memanggil external system?
9. Timeout-nya bagaimana?
10. Audit/logging-nya bagaimana?
11. Version compatibility-nya bagaimana?
12. Security context-nya apa?
13. Data apa yang boleh dilihat extension?
14. Data apa yang tidak boleh dimutasi extension?
```

Tanpa jawaban ini, extension point akan menjadi “magic hook”.

---

## 16. Case Study: Regulatory Case Action Template

Misal sistem punya beberapa action:

- approve case
- reject case
- request information
- escalate case
- close case

Semua action wajib:

1. validate actor
2. load case
3. check authorization
4. validate state transition
5. execute mutation
6. save audit
7. emit domain event
8. return result

Namun detail tiap action berbeda.

### 16.1 Naive Implementation

```java
public class CaseService {

    public CaseActionResult approve(ApproveRequest request) {
        User actor = userRepository.find(request.actorId());
        CaseRecord record = caseRepository.find(request.caseId());

        if (!actor.canApprove()) {
            throw new ForbiddenException();
        }

        if (record.status() != CaseStatus.PENDING_APPROVAL) {
            throw new InvalidStateException();
        }

        record.approve(request.reason());
        caseRepository.save(record);
        auditRepository.save(AuditRecord.approved(record.id(), actor.id()));
        eventPublisher.publish(new CaseApprovedEvent(record.id()));

        return CaseActionResult.success(record.id());
    }

    public CaseActionResult reject(RejectRequest request) {
        User actor = userRepository.find(request.actorId());
        CaseRecord record = caseRepository.find(request.caseId());

        if (!actor.canReject()) {
            throw new ForbiddenException();
        }

        if (record.status() != CaseStatus.PENDING_APPROVAL) {
            throw new InvalidStateException();
        }

        record.reject(request.reason());
        caseRepository.save(record);
        auditRepository.save(AuditRecord.rejected(record.id(), actor.id()));
        eventPublisher.publish(new CaseRejectedEvent(record.id()));

        return CaseActionResult.success(record.id());
    }
}
```

Masalah:

- repeated actor loading
- repeated case loading
- repeated authorization
- repeated status validation
- repeated audit
- repeated event publishing
- mudah ada action lupa audit/event

### 16.2 Template Method Refactoring

```java
public abstract class AbstractCaseAction<C extends CaseActionCommand> {

    private final UserRepository userRepository;
    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;
    private final DomainEventPublisher eventPublisher;

    protected AbstractCaseAction(
            UserRepository userRepository,
            CaseRepository caseRepository,
            AuditRepository auditRepository,
            DomainEventPublisher eventPublisher
    ) {
        this.userRepository = userRepository;
        this.caseRepository = caseRepository;
        this.auditRepository = auditRepository;
        this.eventPublisher = eventPublisher;
    }

    public final CaseActionResult handle(C command) {
        User actor = userRepository.findRequired(command.actorId());
        CaseRecord record = caseRepository.findRequired(command.caseId());
        CaseActionContext context = new CaseActionContext(actor, record, command);

        authorize(context);
        validateState(context);

        CaseActionResult result = perform(context);

        caseRepository.save(context.caseRecord());
        auditRepository.save(auditRecord(context, result));
        eventPublisher.publish(events(context, result));

        return result;
    }

    protected abstract void authorize(CaseActionContext context);

    protected abstract void validateState(CaseActionContext context);

    protected abstract CaseActionResult perform(CaseActionContext context);

    protected abstract AuditRecord auditRecord(CaseActionContext context, CaseActionResult result);

    protected List<DomainEvent> events(CaseActionContext context, CaseActionResult result) {
        return List.of();
    }
}
```

Approve implementation:

```java
public final class ApproveCaseAction extends AbstractCaseAction<ApproveCaseCommand> {

    public ApproveCaseAction(
            UserRepository userRepository,
            CaseRepository caseRepository,
            AuditRepository auditRepository,
            DomainEventPublisher eventPublisher
    ) {
        super(userRepository, caseRepository, auditRepository, eventPublisher);
    }

    @Override
    protected void authorize(CaseActionContext context) {
        if (!context.actor().hasPermission("CASE_APPROVE")) {
            throw new ForbiddenException("Actor cannot approve case");
        }
    }

    @Override
    protected void validateState(CaseActionContext context) {
        if (context.caseRecord().status() != CaseStatus.PENDING_APPROVAL) {
            throw new InvalidStateException("Case is not pending approval");
        }
    }

    @Override
    protected CaseActionResult perform(CaseActionContext context) {
        context.caseRecord().approve(context.command().reason());
        return CaseActionResult.success(context.caseRecord().id());
    }

    @Override
    protected AuditRecord auditRecord(CaseActionContext context, CaseActionResult result) {
        return AuditRecord.caseApproved(
                context.caseRecord().id(),
                context.actor().id(),
                context.command().reason()
        );
    }

    @Override
    protected List<DomainEvent> events(CaseActionContext context, CaseActionResult result) {
        return List.of(new CaseApprovedEvent(context.caseRecord().id()));
    }
}
```

Design improvement:

- common lifecycle centralized
- audit/event cannot be forgotten
- each action owns specific logic
- testing per action lebih kecil
- operation skeleton eksplisit

Remaining risk:

- base class bisa membesar
- subclass masih punya access ke mutable context
- jika variasi makin kompleks, Strategy/pipeline mungkin lebih baik

---

## 17. Safer Template Method Variant: Final Core + Strategy Steps

Kadang solusi terbaik adalah hybrid.

Base engine menjaga skeleton, tetapi variasi diwakili object composition, bukan subclass.

```java
public interface CaseActionDefinition<C extends CaseActionCommand> {

    CaseActionType actionType();

    void authorize(CaseActionContext<C> context);

    void validateState(CaseActionContext<C> context);

    CaseActionResult perform(CaseActionContext<C> context);

    AuditRecord auditRecord(CaseActionContext<C> context, CaseActionResult result);

    default List<DomainEvent> events(CaseActionContext<C> context, CaseActionResult result) {
        return List.of();
    }
}
```

Engine:

```java
public final class CaseActionEngine {

    private final Map<CaseActionType, CaseActionDefinition<?>> definitions;
    private final UserRepository userRepository;
    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;
    private final DomainEventPublisher eventPublisher;

    public <C extends CaseActionCommand> CaseActionResult handle(C command) {
        CaseActionDefinition<C> definition = findDefinition(command.actionType());

        User actor = userRepository.findRequired(command.actorId());
        CaseRecord record = caseRepository.findRequired(command.caseId());
        CaseActionContext<C> context = new CaseActionContext<>(actor, record, command);

        definition.authorize(context);
        definition.validateState(context);
        CaseActionResult result = definition.perform(context);

        caseRepository.save(record);
        auditRepository.save(definition.auditRecord(context, result));
        eventPublisher.publish(definition.events(context, result));

        return result;
    }

    @SuppressWarnings("unchecked")
    private <C extends CaseActionCommand> CaseActionDefinition<C> findDefinition(CaseActionType type) {
        CaseActionDefinition<?> definition = definitions.get(type);
        if (definition == null) {
            throw new IllegalArgumentException("Unsupported action type: " + type);
        }
        return (CaseActionDefinition<C>) definition;
    }
}
```

Ini bukan lagi Template Method klasik, tetapi menjaga mental model yang sama:

```text
stable skeleton + variable steps
```

Bedanya, variable steps disediakan lewat composition.

Kelebihan:

- tidak ada inheritance trap
- definition mudah di-test sebagai object biasa
- bisa diregistrasi via DI
- lebih fleksibel
- cocok untuk enterprise module dengan banyak action

Kekurangan:

- sedikit lebih banyak plumbing
- type safety perlu hati-hati
- engine/definition contract harus jelas

---

## 18. Fragile Base Class Problem

Fragile base class terjadi ketika perubahan kecil di base class merusak subclass tanpa compiler error yang jelas.

Contoh:

```java
public abstract class AbstractImporter {

    public final ImportResult importFile(File file) {
        List<Row> rows = readRows(file);
        validate(rows);
        save(rows);
        return ImportResult.success(rows.size());
    }

    protected abstract List<Row> readRows(File file);

    protected void validate(List<Row> rows) {}

    protected abstract void save(List<Row> rows);
}
```

Kemudian base class diubah:

```java
public final ImportResult importFile(File file) {
    List<Row> rows = readRows(file);
    normalize(rows);
    validate(rows);
    save(rows);
    return ImportResult.success(rows.size());
}

protected void normalize(List<Row> rows) {}
```

Subclass lama mungkin diam-diam rusak karena sebelumnya menganggap rows masih raw.

Penyebab fragile base class:

1. Base class dan subclass berbagi terlalu banyak state.
2. Hook contract tidak jelas.
3. Ordering berubah tanpa test kontrak.
4. Protected method terlalu bebas.
5. Subclass bergantung pada detail internal base class.
6. Base class berevolusi tanpa compatibility thinking.

Mitigasi:

1. Keep base class small.
2. Prefer private fields.
3. Expose immutable context.
4. Make template method final.
5. Document hook contract.
6. Add contract tests for subclasses.
7. Avoid calling overridable methods from constructor.
8. Prefer composition when variations multiply.

---

## 19. Never Call Overridable Method from Constructor

Ini salah satu bug klasik inheritance.

Buruk:

```java
public abstract class AbstractJob {

    protected AbstractJob() {
        initialize();
    }

    protected abstract void initialize();
}

public final class ReportJob extends AbstractJob {

    private final ReportConfig config;

    public ReportJob(ReportConfig config) {
        this.config = config;
    }

    @Override
    protected void initialize() {
        config.validate(); // NullPointerException: config belum diset
    }
}
```

Constructor base class berjalan sebelum constructor subclass selesai.

Solusi:

```java
public abstract class AbstractJob {

    public final void start() {
        initialize();
        run();
    }

    protected abstract void initialize();

    protected abstract void run();
}
```

Atau hindari inheritance:

```java
public final class JobRunner {
    public void start(JobDefinition definition) {
        definition.initialize();
        definition.run();
    }
}
```

---

## 20. Protected Is Not “Private for Subclass”

Banyak developer memperlakukan `protected` sebagai cara aman memberi akses ke subclass. Padahal `protected` adalah API untuk subclass.

Kalau method `protected`, berarti:

```text
1. Subclass boleh memanggilnya.
2. Subclass mungkin override jika tidak final.
3. Subclass bisa bergantung pada urutannya.
4. Perubahan method bisa breaking secara semantic.
```

Maka protected API harus diperlakukan seperti public API dalam konteks inheritance hierarchy.

Guideline:

```text
private     -> invariant internal
final       -> behavior tidak boleh diubah
protected final -> subclass boleh pakai, tidak boleh override
protected abstract -> subclass wajib isi
protected concrete -> hook optional, harus aman default-nya
```

Contoh aman:

```java
protected final void requirePendingApproval(CaseRecord record) {
    if (record.status() != CaseStatus.PENDING_APPROVAL) {
        throw new InvalidStateException("Expected pending approval");
    }
}
```

Subclass bisa memakai helper, tetapi tidak bisa mengubah invariant helper.

---

## 21. Template Method vs Strategy

Kapan Template Method:

```text
- skeleton sangat stabil
- inheritance hierarchy kecil dan terkendali
- variasi terjadi di beberapa step tetap
- subclass compile-time known
- base class benar-benar menjaga invariant
```

Kapan Strategy:

```text
- behavior perlu diganti runtime
- kombinasi variasi banyak
- ingin test behavior sebagai object mandiri
- ingin menghindari inheritance
- variasi lebih penting daripada skeleton
```

Contoh masalah Template Method:

```text
Import flow punya variasi:
- file type: CSV, XLSX, XML
- validation mode: strict, relaxed
- persistence mode: insert, upsert
- rejection mode: fail-fast, collect-all
```

Kalau semua dijadikan subclass:

```text
CsvStrictInsertFailFastImporter
CsvStrictInsertCollectAllImporter
CsvRelaxedUpsertCollectAllImporter
XlsxStrictInsertFailFastImporter
...
```

Ini class explosion.

Lebih baik composition:

```java
public final class ImportPipeline {
    private final RowReader reader;
    private final RowValidator validator;
    private final RowPersistence persistence;
    private final RejectionPolicy rejectionPolicy;
}
```

---

## 22. Callback Pyramid Anti-Pattern

Callback bagus untuk behavior kecil, tetapi bisa buruk jika nested.

Buruk:

```java
transaction.execute(() ->
    lock.execute(caseId, () ->
        retry.execute(() ->
            metrics.time("approve", () ->
                audit.capture(() ->
                    approveCase(command)
                )
            )
        )
    )
);
```

Masalah:

- flow sulit dibaca
- error semantics tidak jelas
- ordering tersembunyi
- debugging stack sulit
- sulit menyisipkan observability yang konsisten

Lebih baik gunakan pipeline/decorator eksplisit:

```java
CaseCommandHandler handler = new ApproveCaseHandler(...);
handler = new AuditHandler(handler, auditWriter);
handler = new MetricsHandler(handler, metrics);
handler = new RetryHandler(handler, retryPolicy);
handler = new LockingHandler(handler, lockManager);
handler = new TransactionalHandler(handler, transactionManager);

handler.handle(command);
```

Atau framework pipeline:

```java
pipeline.execute(command, context -> approveCase(context));
```

---

## 23. Inheritance Trap Anti-Pattern

Inheritance trap terjadi ketika subclass dibuat bukan karena “is-a”, tetapi karena ingin reuse beberapa method.

Buruk:

```java
public class CsvReportGenerator extends AbstractPdfReportGenerator {
    // wants reuse date formatting and repository access only
}
```

Masalah:

- semantic inheritance salah
- subclass mewarisi behavior yang tidak relevan
- base class makin gemuk
- override digunakan untuk menonaktifkan behavior

Tanda bahaya:

```java
@Override
protected void renderPdfHeader() {
    // do nothing for CSV
}
```

Kalau subclass override untuk “mematikan” behavior, hierarki salah.

Solusi:

```java
public final class ReportSupport {
    public String formatDate(LocalDate date) { ... }
}

public final class CsvReportGenerator {
    private final ReportSupport support;
}
```

Reuse sebaiknya lewat composition, bukan inheritance palsu.

---

## 24. Hook Abuse Anti-Pattern

Hook abuse terjadi ketika base class menyediakan terlalu banyak titik override.

Contoh buruk:

```java
public abstract class AbstractOperation {
    protected void beforeEverything() {}
    protected void beforeValidation() {}
    protected void afterValidation() {}
    protected void beforeAuthorization() {}
    protected void afterAuthorization() {}
    protected void beforeLoad() {}
    protected void afterLoad() {}
    protected void beforeMutation() {}
    protected void afterMutation() {}
    protected void beforeSave() {}
    protected void afterSave() {}
    protected void beforeAudit() {}
    protected void afterAudit() {}
    protected void beforeEvent() {}
    protected void afterEvent() {}
    protected void afterEverything() {}
}
```

Masalah:

- subclass bisa menyisipkan side effect di mana saja
- lifecycle sulit dipahami
- ordering bug muncul
- testing kombinasi hook hampir mustahil
- invariant base class melemah

Lebih baik:

```text
1. Kurangi hook.
2. Buat extension point yang sempit.
3. Gunakan event/definition object untuk behavior yang benar-benar perlu divariasikan.
4. Pisahkan cross-cutting concern ke interceptor/decorator.
```

---

## 25. Extension Point Versioning

Extension point adalah API. Kalau dipakai module lain, ia harus dirawat seperti public contract.

Masalah umum:

```java
public interface ExportPlugin {
    ExportResult export(ExportContext context);
}
```

Kemudian butuh progress reporting:

```java
public interface ExportPlugin {
    ExportResult export(ExportContext context, ProgressReporter reporter);
}
```

Ini breaking change.

Dengan default method:

```java
public interface ExportPlugin {

    ExportResult export(ExportContext context);

    default ExportResult export(ExportContext context, ProgressReporter reporter) {
        return export(context);
    }
}
```

Default method membantu compatibility, tetapi jangan dipakai untuk menyembunyikan semantic change besar.

Kalau contract berubah besar, lebih baik versi baru:

```java
public interface ExportPluginV2 extends ExportPlugin {
    ExportResult export(ExportContext context, ProgressReporter reporter);
}
```

Atau capability-based extension:

```java
public interface ExportPlugin {
    ExportCapabilities capabilities();
    ExportResult export(ExportRequest request);
}
```

---

## 26. Testing Strategy

### 26.1 Template Method Test

Yang perlu diuji:

1. Skeleton order.
2. Common invariant.
3. Subclass-specific behavior.
4. Hook invocation.
5. Failure path.
6. Audit/event invariant.
7. Resource cleanup.

Contoh spy subclass:

```java
final class RecordingImporter extends AbstractImporter {

    private final List<String> calls = new ArrayList<>();

    @Override
    protected List<Row> readRows(InputFile file) {
        calls.add("readRows");
        return List.of(new Row("A"));
    }

    @Override
    protected void validateRows(List<Row> rows) {
        calls.add("validateRows");
    }

    @Override
    protected void saveRows(List<Row> rows) {
        calls.add("saveRows");
    }

    List<String> calls() {
        return calls;
    }
}
```

Test:

```java
@Test
void shouldExecuteStepsInOrder() {
    RecordingImporter importer = new RecordingImporter();

    importer.importFile(new InputFile("cases.csv"));

    assertEquals(List.of("readRows", "validateRows", "saveRows"), importer.calls());
}
```

### 26.2 Contract Test for Extension Point

Kalau banyak extension implementor, buat contract test:

```java
public interface CaseActionExtensionContract {

    CaseActionExtension extension();

    @Test
    default void beforeValidationShouldNotMutateCaseStatus() {
        CaseActionContext context = TestContexts.pendingCase();
        CaseStatus before = context.caseRecord().status();

        extension().beforeValidation(context);

        assertEquals(before, context.caseRecord().status());
    }
}
```

Setiap extension test implements contract:

```java
class NotificationExtensionTest implements CaseActionExtensionContract {
    @Override
    public CaseActionExtension extension() {
        return new NotificationExtension(...);
    }
}
```

### 26.3 Callback Test

Test callback runner harus memverifikasi:

- callback dipanggil
- exception dipropagasi
- cleanup tetap terjadi
- retry count benar
- transaction commit/rollback benar

---

## 27. Observability and Debuggability

Template/hook/callback sering membuat flow tidak terlihat jelas kalau tidak diberi telemetry.

Minimal telemetry:

```text
operation.name
operation.template
operation.step
operation.extension.name
operation.extension.duration_ms
operation.extension.outcome
operation.hook.name
operation.error.type
operation.correlation_id
```

Contoh:

```java
private void invokeExtension(
        CaseActionExtension extension,
        String phase,
        Runnable invocation
) {
    long start = System.nanoTime();
    try {
        invocation.run();
        metrics.recordExtensionSuccess(extension.name(), phase, elapsedMillis(start));
    } catch (RuntimeException e) {
        metrics.recordExtensionFailure(extension.name(), phase, e, elapsedMillis(start));
        throw e;
    }
}
```

Logging yang berguna:

```text
CaseAction extension executed: action=APPROVE phase=afterSuccess extension=NotificationExtension durationMs=12 outcome=SUCCESS
```

Bukan:

```text
Extension done
```

---

## 28. Performance Considerations

Template Method sendiri hampir tidak punya overhead signifikan.

Yang perlu diperhatikan:

1. Hook terlalu banyak.
2. Extension discovery setiap request.
3. Reflection invocation.
4. Dynamic proxy chain terlalu panjang.
5. Callback allocation di hot path.
6. Lambda capture yang membuat allocation.
7. Extension melakukan external call sinkron.
8. Hook melakukan query tambahan berulang.

Optimasi yang masuk akal:

```text
- precompute extension list per operation type
- sort extension once at startup
- avoid reflection in hot path
- keep extension context small
- measure extension duration
- make expensive extension async only if semantics allow
```

Jangan mengorbankan clarity sebelum ada evidence.

---

## 29. Security Considerations

Extension point dan hook bisa menjadi security hole.

Risiko:

1. Extension melihat data yang seharusnya tidak boleh.
2. Extension mengubah authorization result.
3. Extension melakukan mutation sebelum authorization.
4. Extension mengirim data sensitif ke external system.
5. Extension logging PII.
6. Extension throw exception dan menyebabkan denial of service.

Design rule:

```text
Authorization should happen before mutation.
Audit invariant should not be optional.
Extension should receive least-privilege context.
Security-sensitive invariant should be private/final in engine.
```

Buruk:

```java
protected boolean isAuthorized(Context context) {
    return true;
}
```

Lebih baik:

```java
private void authorize(Context context) {
    authorizationService.requireAllowed(context.actor(), requiredPermission(context));
}

protected abstract Permission requiredPermission(Context context);
```

Subclass menentukan permission, bukan hasil authorization.

---

## 30. Refactoring Path

### 30.1 Dari Duplicate Flow ke Template Method

Langkah:

1. Identifikasi method yang punya urutan mirip.
2. Tandai langkah common dan langkah variable.
3. Ekstrak context object.
4. Buat abstract base class kecil.
5. Jadikan skeleton public final.
6. Pindahkan invariant ke private/final method.
7. Jadikan variable step abstract/protected.
8. Buat subclass per variasi utama.
9. Tambahkan test urutan dan invariant.
10. Hapus duplicate flow lama.

### 30.2 Dari Template Method ke Strategy/Composition

Gunakan ketika:

- subclass terlalu banyak
- variasi kombinatorial
- base class terlalu gemuk
- subclass saling override hook dengan cara aneh
- testing inheritance makin sulit

Langkah:

1. Ekstrak setiap overridable step menjadi interface.
2. Buat engine final yang menerima strategy objects.
3. Pindahkan state internal ke context immutable/mutable-terkontrol.
4. Replace subclass dengan definition object.
5. Tambahkan registry/factory untuk memilih definition.
6. Tambahkan contract test untuk definition.
7. Deprecate base class lama.

---

## 31. Practical Decision Matrix

| Situation | Prefer |
|---|---|
| Flow tetap, variasi kecil per subclass | Template Method |
| Flow tetap, extension optional dari module lain | Extension Point |
| Behavior kecil dikirim caller | Callback |
| Behavior kompleks bisa diganti runtime | Strategy |
| Banyak step cross-cutting | Interceptor/Decorator |
| Banyak handler independen | Chain of Responsibility |
| Closed alternatives, logic sederhana | Sealed + switch |
| Variasi kombinatorial | Composition |
| Butuh public plugin API | SPI/Extension Point |
| Hanya ingin reuse utility method | Composition/helper, bukan inheritance |

---

## 32. Anti-Pattern Catalog

### 32.1 Fragile Base Class

Base class berubah, subclass rusak secara semantic.

### 32.2 Inheritance for Reuse

Subclass dibuat hanya untuk memakai helper method.

### 32.3 Hook Everything

Base class punya terlalu banyak hook sehingga flow tidak bisa dipahami.

### 32.4 Override to Disable

Subclass override method dan mengosongkannya.

### 32.5 Callback Pyramid

Callback nested terlalu dalam.

### 32.6 Magic Lifecycle

Method dipanggil oleh framework secara tersembunyi tanpa kontrak jelas.

### 32.7 Protected State Leak

Subclass diberi akses ke mutable internal state.

### 32.8 Extension Point Without Contract

Interface extension ada, tetapi tidak menjelaskan timing, transaction, error, ordering, dan permission.

### 32.9 Base Class God Object

Base class memuat repository, client, mapper, validator, audit, event, cache, dan semua domain knowledge.

### 32.10 Constructor Calls Hook

Base constructor memanggil method overridable.

---

## 33. Staff-Level Review Questions

Gunakan pertanyaan ini saat design review:

```text
1. Apa skeleton algoritma yang ingin dikunci?
2. Apa step yang memang harus bervariasi?
3. Invariant apa yang tidak boleh bisa dioverride?
4. Apakah variasi compile-time atau runtime?
5. Apakah subclass count akan bertambah linear atau kombinatorial?
6. Apakah inheritance ini semantic atau hanya reuse?
7. Apakah hook punya contract jelas?
8. Apakah hook boleh throw exception?
9. Apakah extension dipanggil dalam transaction?
10. Apakah extension ordering deterministic?
11. Apakah ada observability per extension/hook?
12. Apakah protected API terlalu luas?
13. Apakah sealed hierarchy bisa membatasi risiko?
14. Apakah lambda/callback lebih sederhana?
15. Apakah Strategy lebih testable?
16. Apa refactoring path jika base class mulai membengkak?
```

---

## 34. Common Interview / Senior Discussion Prompts

### Prompt 1

> Kapan Template Method lebih baik daripada Strategy?

Jawaban matang:

```text
Template Method lebih baik ketika yang stabil adalah skeleton algoritma dan variasi hanya terjadi pada beberapa step yang terkontrol. Strategy lebih baik ketika behavior perlu diganti runtime, variasi perlu dikombinasikan, atau inheritance akan membuat hierarchy rapuh.
```

### Prompt 2

> Apa masalah terbesar Template Method?

Jawaban matang:

```text
Masalah terbesar adalah fragile base class dan protected API yang menjadi contract tersembunyi. Jika base class berubah, subclass bisa rusak tanpa compiler error. Karena itu invariant harus private/final, hook harus sempit, dan subclass contract harus eksplisit.
```

### Prompt 3

> Apakah Java 8 membuat Template Method obsolete?

Jawaban matang:

```text
Tidak. Java 8 membuat banyak variasi kecil lebih cocok diekspresikan sebagai callback/lambda atau Strategy ringan. Tetapi untuk lifecycle yang kuat, setup/teardown, invariant, dan framework skeleton, Template Method masih relevan.
```

### Prompt 4

> Bagaimana mendesain extension point yang aman?

Jawaban matang:

```text
Tentukan fase lifecycle, ordering, transaction boundary, exception semantics, permission model, data visibility, mutability rule, observability, dan compatibility strategy. Extension point adalah API, bukan sekadar interface.
```

---

## 35. Mini-Lab: Refactor Import Flow

Starting point:

```java
public class ImportService {

    public ImportResult importCsv(File file) {
        List<String> lines = readCsv(file);
        List<Row> rows = parseCsv(lines);
        validate(rows);
        save(rows);
        return ImportResult.success(rows.size());
    }

    public ImportResult importXml(File file) {
        String xml = readXml(file);
        List<Row> rows = parseXml(xml);
        validate(rows);
        save(rows);
        return ImportResult.success(rows.size());
    }
}
```

Exercise:

1. Extract template skeleton.
2. Make resource cleanup explicit.
3. Make parse step abstract.
4. Make validation policy pluggable.
5. Add hook for rejection report.
6. Ensure audit is mandatory.
7. Add tests for step ordering.
8. Then refactor to composition if variation grows.

Target mental result:

```text
Do not jump to pattern first.
First identify stable flow, variable steps, invariant, failure semantics, and evolution pressure.
```

---

## 36. Summary

Template Method, Hook, Callback, dan Extension Point berada dalam satu keluarga ide:

```text
control the flow, vary selected behavior
```

Perbedaannya ada pada siapa yang memiliki flow dan bagaimana variasi diberikan:

- Template Method: base class owns flow, subclass fills steps.
- Hook: subclass optionally customizes phase.
- Callback: caller supplies behavior to operation.
- Extension Point: framework publishes official customization contract.

Prinsip utama:

```text
A good template protects invariants.
A bad template merely shares code.
```

Gunakan Template Method ketika skeleton kuat dan variasi terbatas. Gunakan callback untuk behavior kecil. Gunakan Strategy/composition ketika variasi perlu fleksibel. Gunakan extension point ketika kamu mendesain framework/library internal yang perlu diperluas module lain.

Waspadai:

- fragile base class
- protected API leakage
- too many hooks
- inheritance for reuse
- callback pyramid
- extension point without contract

Engineer level tinggi tidak sekadar tahu pattern ini. Ia tahu kapan pattern ini menjaga sistem, dan kapan pattern ini mulai merusak evolusi sistem.

---

## 37. References

- Oracle Java Tutorials — Default Methods: default methods allow adding functionality to interfaces while preserving binary compatibility with older implementations.
- Java Language Specification — Interfaces: default methods are instance methods declared in interfaces with a body.
- Classic GoF Pattern Catalog — Template Method as a behavioral pattern.
- Refactoring literature — Replace inheritance with delegation, replace conditional with polymorphism, form template method.
- Enterprise framework practice — lifecycle callbacks, extension points, transaction templates, interceptors, and test framework templates.

---

## 38. Completion Status

```text
Part 13 dari 35 selesai.
Seri belum selesai.
```

Next part:

```text
14-behavioral-state-state-machine-workflow-object.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./12-behavioral-observer-listener-event-pubsub.md">⬅️ Behavioral Pattern IV: Observer, Listener, Event, Pub/Sub</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./14-behavioral-state-state-machine-workflow-object.md">Behavioral Pattern VI: State, State Machine, Workflow Object ➡️</a>
</div>
