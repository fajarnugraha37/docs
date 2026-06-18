# learn-java-oop-functional-reflection-codegen-modules-part-013

# Composition, Delegation, Mixins, and Object Collaboration Design

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `013`  
> Topik: Composition, Delegation, Mixins, and Object Collaboration Design  
> Level: Advanced / top 1% software engineer perspective  

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas inheritance, interface, sealed hierarchy, record, enum, nested class, generics, dan polymorphism. Bagian ini adalah titik balik penting: kita berhenti melihat Java sebagai sekumpulan fitur bahasa, lalu mulai melihat Java sebagai **alat membentuk kolaborasi object**.

Banyak developer memahami kalimat populer:

> "Prefer composition over inheritance."

Tetapi kalimat itu sering disalahpahami menjadi aturan dangkal:

> "Jangan pakai inheritance. Pakai field object saja."

Itu terlalu sempit.

Composition bukan sekadar class A punya field class B. Composition adalah cara mendesain **hubungan tanggung jawab**, **kepemilikan state**, **arah dependency**, **substitusi behavior**, **test seam**, **extension point**, dan **evolusi sistem**.

Setelah mempelajari bagian ini, targetnya kamu mampu:

1. Membedakan inheritance, composition, aggregation, delegation, forwarding, wrapping, dan collaboration.
2. Mendesain object yang bekerja sama tanpa menjadi god object atau anemic service.
3. Menentukan kapan behavior harus dimiliki object, dipisah sebagai policy, dijadikan strategy, didekorasi, diadaptasi, atau dipasang via registry.
4. Menganalisis coupling, cohesion, runtime dependency, dan testability dari desain object.
5. Membuat API dan library yang extension-friendly tanpa fragile base class.
6. Memahami bagaimana framework enterprise seperti DI container, proxy, AOP, serialization, mapper, dan generated code berinteraksi dengan komposisi object.

---

## 1. Core Mental Model

### 1.1 Inheritance menjawab “is-a”, composition menjawab “is built from”, delegation menjawab “asks another object to do”

Secara sederhana:

```java
class Car extends Vehicle { }
```

Inheritance mengatakan:

> `Car` adalah subtype dari `Vehicle`.

Sementara:

```java
final class Car {
    private final Engine engine;
    private final BrakeSystem brakes;
}
```

Composition mengatakan:

> `Car` dibangun dari `Engine` dan `BrakeSystem`.

Lalu:

```java
final class Car {
    private final Engine engine;

    void start() {
        engine.start();
    }
}
```

Delegation mengatakan:

> `Car` menerima request, tetapi sebagian pekerjaan diserahkan ke `Engine`.

Tiga konsep ini tidak saling menggantikan sepenuhnya.

Inheritance kuat untuk **substitutability**.  
Composition kuat untuk **struktur dan ownership**.  
Delegation kuat untuk **pembagian behavior**.

Masalah desain biasanya muncul ketika kita memakai satu mekanisme untuk semua hal.

---

## 2. Vocabulary yang Harus Presisi

### 2.1 Association

Association adalah hubungan paling umum: satu object mengetahui object lain.

```java
final class OrderService {
    private final PaymentGateway paymentGateway;
}
```

Tidak selalu berarti `OrderService` memiliki `PaymentGateway`. Bisa saja hanya menggunakannya.

### 2.2 Aggregation

Aggregation adalah hubungan “has-a” lemah. Object A menggunakan object B, tapi lifecycle B tidak dikendalikan A.

Contoh:

```java
final class Department {
    private final List<Employee> employees;
}
```

`Employee` tetap bisa ada tanpa `Department` tertentu.

### 2.3 Composition

Composition adalah hubungan “part-of” kuat. Part biasanya tidak bermakna atau tidak dikelola terpisah dari whole.

```java
final class EmailAddress {
    private final String localPart;
    private final String domain;
}
```

`localPart` dan `domain` adalah bagian representasi `EmailAddress`.

Contoh enterprise:

```java
final class CaseDecision {
    private final DecisionOutcome outcome;
    private final DecisionReason reason;
    private final DecisionTimestamp decidedAt;
}
```

`DecisionOutcome`, `DecisionReason`, dan `DecisionTimestamp` adalah bagian dari object keputusan.

### 2.4 Delegation

Delegation adalah ketika object menerima tanggung jawab publik lalu meneruskan sebagian pekerjaan ke collaborator.

```java
final class InvoiceCalculator {
    private final TaxPolicy taxPolicy;

    Money calculateTotal(Invoice invoice) {
        Money subtotal = invoice.subtotal();
        Money tax = taxPolicy.calculateTax(subtotal, invoice.customerRegion());
        return subtotal.plus(tax);
    }
}
```

`InvoiceCalculator` tidak mewarisi `TaxPolicy`. Ia memakai `TaxPolicy`.

### 2.5 Forwarding

Forwarding adalah delegation yang hampir 1:1 meneruskan method.

```java
final class AuditedRepository<T> implements Repository<T> {
    private final Repository<T> delegate;
    private final AuditSink auditSink;

    @Override
    public void save(T entity) {
        auditSink.beforeSave(entity);
        delegate.save(entity);
        auditSink.afterSave(entity);
    }
}
```

Forwarding umum dalam decorator/wrapper.

### 2.6 Wrapping

Wrapping adalah menyimpan object lain dan mengubah surface/behavior-nya.

```java
final class SafePaymentGateway implements PaymentGateway {
    private final PaymentGateway delegate;

    @Override
    public PaymentResult charge(PaymentCommand command) {
        try {
            return delegate.charge(command);
        } catch (GatewayTimeoutException e) {
            return PaymentResult.retryableFailure(e.getMessage());
        }
    }
}
```

Wrapper dapat menambah:

- validation
- retry
- logging
- metric
- authorization
- translation
- caching
- fallback

### 2.7 Collaboration

Collaboration adalah desain beberapa object yang bekerja sama untuk menyelesaikan use case.

Object collaboration bukan hanya “class mana memanggil class mana”, tetapi:

- siapa pemilik keputusan
- siapa pemilik data
- siapa pemilik side effect
- siapa boleh tahu detail siapa
- siapa menjadi extension point
- siapa menjaga invariant
- siapa men-translate boundary eksternal

---

## 3. Kenapa Composition Sering Lebih Aman daripada Inheritance

### 3.1 Inheritance membuka terlalu banyak permukaan

Saat class diwariskan, subclass dapat terikat pada detail parent:

```java
class BaseProcessor {
    public void process() {
        validate();
        execute();
        notifyDone();
    }

    protected void validate() { }
    protected void execute() { }
    protected void notifyDone() { }
}
```

Subclass mungkin override method yang sebenarnya tidak aman diubah.

```java
class CustomProcessor extends BaseProcessor {
    @Override
    protected void notifyDone() {
        // silently disabled
    }
}
```

Masalah:

- invariant parent bisa rusak
- urutan proses bisa diasumsikan subclass
- perubahan parent bisa memecahkan subclass
- API protected menjadi API semi-public

### 3.2 Composition membatasi apa yang bisa diubah

Dengan composition:

```java
final class Processor {
    private final Validator validator;
    private final Executor executor;
    private final CompletionNotifier notifier;

    void process(Command command) {
        validator.validate(command);
        executor.execute(command);
        notifier.notifyDone(command.id());
    }
}
```

Yang bisa diganti hanya collaborator yang sengaja disediakan.

Ini memberi kontrol lebih kuat:

- `Processor` tetap mengontrol workflow
- variasi behavior ada di `Validator`, `Executor`, `CompletionNotifier`
- invariant workflow tidak bocor ke subclass
- extension point eksplisit

### 3.3 Composition mengubah hidden override menjadi explicit dependency

Inheritance sering menyembunyikan variasi behavior di subclass.

Composition membuat variasi terlihat di constructor:

```java
new Processor(
    new StrictValidator(),
    new AsyncExecutor(),
    new AuditCompletionNotifier()
);
```

Ini membuat dependency graph lebih eksplisit.

---

## 4. Composition Bukan Selalu Solusi

Composition juga bisa buruk.

### 4.1 Over-composition menghasilkan object graph terlalu rumit

```java
final class UserRegistrationService {
    private final UserNameNormalizer userNameNormalizer;
    private final UserNameValidator userNameValidator;
    private final UserEmailNormalizer userEmailNormalizer;
    private final UserEmailValidator userEmailValidator;
    private final UserPasswordPolicyChecker userPasswordPolicyChecker;
    private final UserDuplicateChecker userDuplicateChecker;
    private final UserFactory userFactory;
    private final UserRepository userRepository;
    private final UserRegistrationEventFactory eventFactory;
    private final UserRegistrationEventPublisher eventPublisher;
    private final UserRegistrationMetricRecorder metricRecorder;
}
```

Kadang ini valid. Tapi sering ini tanda:

- use case terlalu besar
- abstraction terlalu granular
- naming terlalu procedural
- domain model terlalu pasif
- service menjadi coordinator raksasa

### 4.2 “Composition over inheritance” bukan berarti “semua jadi service”

Anti-pattern umum:

```java
final class Order {
    private final List<OrderLine> lines;
    private final OrderStatus status;
}

final class OrderService {
    Money calculateTotal(Order order) { ... }
    boolean canCancel(Order order) { ... }
    void applyDiscount(Order order, Discount discount) { ... }
    void validateOrder(Order order) { ... }
}
```

Ini bisa berubah menjadi **anemic domain model**: object hanya data, semua behavior di service.

Alternatif:

```java
final class Order {
    private final List<OrderLine> lines;
    private OrderStatus status;

    Money total() {
        return lines.stream()
            .map(OrderLine::subtotal)
            .reduce(Money.zero(), Money::plus);
    }

    boolean canCancel(Clock clock) {
        return status == OrderStatus.SUBMITTED && !isExpired(clock);
    }

    void apply(DiscountPolicy discountPolicy) {
        discountPolicy.applyTo(this);
    }
}
```

Kuncinya:

- behavior yang menjaga invariant sebaiknya dekat dengan state
- behavior eksternal/policy/side-effect boleh dipisah
- service sebaiknya mengorkestrasi use case, bukan mengambil semua intelligence object

---

## 5. Object Collaboration: Pertanyaan Desain yang Benar

Ketika mendesain beberapa class, jangan mulai dari “class apa saja?”. Mulai dari pertanyaan:

1. Keputusan apa yang harus dibuat?
2. Data apa yang diperlukan untuk keputusan itu?
3. Siapa pemilik data tersebut?
4. Siapa yang menjaga invariant?
5. Behavior mana yang stabil?
6. Behavior mana yang sering berubah?
7. Behavior mana yang tergantung external system?
8. Behavior mana yang perlu dites terpisah?
9. Behavior mana yang perlu diganti saat runtime/configuration?
10. Boundary mana yang harus tetap kecil dan stabil?

Contoh use case:

> Case escalation should happen when severity is high, SLA is breached, or manual supervisor override is present.

Desain buruk:

```java
final class CaseService {
    boolean shouldEscalate(Case c) {
        if (c.getSeverity().equals("HIGH")) return true;
        if (Duration.between(c.getCreatedAt(), Instant.now()).toHours() > 48) return true;
        if (c.isSupervisorOverride()) return true;
        return false;
    }
}
```

Masalah:

- stringly typed severity
- time dependency tersembunyi
- policy tercampur service
- sulit audit alasan escalation
- sulit versioning rule

Desain lebih baik:

```java
record EscalationDecision(boolean escalate, List<EscalationReason> reasons) {
    static EscalationDecision none() {
        return new EscalationDecision(false, List.of());
    }

    static EscalationDecision yes(List<EscalationReason> reasons) {
        return new EscalationDecision(true, List.copyOf(reasons));
    }
}

interface EscalationRule {
    Optional<EscalationReason> evaluate(CaseSnapshot snapshot, Instant now);
}

final class SeverityEscalationRule implements EscalationRule {
    @Override
    public Optional<EscalationReason> evaluate(CaseSnapshot snapshot, Instant now) {
        return snapshot.severity() == Severity.HIGH
            ? Optional.of(EscalationReason.HIGH_SEVERITY)
            : Optional.empty();
    }
}

final class SlaBreachEscalationRule implements EscalationRule {
    private final Duration threshold;

    SlaBreachEscalationRule(Duration threshold) {
        this.threshold = Objects.requireNonNull(threshold);
    }

    @Override
    public Optional<EscalationReason> evaluate(CaseSnapshot snapshot, Instant now) {
        Duration age = Duration.between(snapshot.createdAt(), now);
        return age.compareTo(threshold) > 0
            ? Optional.of(EscalationReason.SLA_BREACHED)
            : Optional.empty();
    }
}

final class EscalationPolicy {
    private final List<EscalationRule> rules;
    private final Clock clock;

    EscalationPolicy(List<EscalationRule> rules, Clock clock) {
        this.rules = List.copyOf(rules);
        this.clock = Objects.requireNonNull(clock);
    }

    EscalationDecision decide(CaseSnapshot snapshot) {
        Instant now = clock.instant();
        List<EscalationReason> reasons = rules.stream()
            .map(rule -> rule.evaluate(snapshot, now))
            .flatMap(Optional::stream)
            .toList();

        return reasons.isEmpty()
            ? EscalationDecision.none()
            : EscalationDecision.yes(reasons);
    }
}
```

Yang berubah:

- policy menjadi object eksplisit
- rule bisa dites satu per satu
- time dependency disuntikkan via `Clock`
- result membawa alasan
- service dapat fokus ke use case
- auditability naik

---

## 6. Delegation Pattern

Delegation adalah fondasi banyak pattern.

### 6.1 Basic delegation

```java
final class ReportExporter {
    private final ReportRenderer renderer;
    private final FileWriter writer;

    void export(Report report, Path path) {
        String rendered = renderer.render(report);
        writer.write(path, rendered);
    }
}
```

`ReportExporter` tidak tahu detail rendering dan writing.

### 6.2 Delegation dengan ownership workflow

```java
final class ApplicationSubmissionUseCase {
    private final ApplicationValidator validator;
    private final ApplicationRepository repository;
    private final ApplicationEventPublisher events;

    SubmissionResult submit(SubmitApplication command) {
        ValidationResult validation = validator.validate(command);
        if (!validation.isValid()) {
            return SubmissionResult.rejected(validation.errors());
        }

        Application application = Application.submit(command);
        repository.save(application);
        events.publish(ApplicationSubmitted.from(application));

        return SubmissionResult.accepted(application.id());
    }
}
```

Use case mengontrol urutan. Collaborator menjalankan detail.

### 6.3 Delegation tanpa kehilangan invariant

Bahaya delegation:

```java
final class Account {
    private final Balance balance;

    void withdraw(Money amount) {
        balance.subtract(amount); // jika Balance mutable dan tidak validasi, invariant bocor
    }
}
```

Lebih aman:

```java
final class Account {
    private Balance balance;

    void withdraw(Money amount) {
        if (balance.isLessThan(amount)) {
            throw new InsufficientBalanceException();
        }
        this.balance = balance.minus(amount);
    }
}
```

Delegation tidak boleh membuat invariant pindah ke object yang tidak punya konteks penuh.

---

## 7. Role Object Pattern

Role object digunakan ketika entity yang sama bisa memainkan beberapa role dalam konteks berbeda.

Contoh buruk:

```java
final class User {
    boolean canApprovePayment;
    boolean canReviewCase;
    boolean canAssignOfficer;
    boolean canCloseCase;
    boolean canReopenCase;
}
```

Ini mencampur identity user dengan permission/role behavior.

Alternatif:

```java
interface CaseRole {
    boolean canPerform(CaseAction action, CaseSnapshot snapshot);
}

final class SupervisorRole implements CaseRole {
    @Override
    public boolean canPerform(CaseAction action, CaseSnapshot snapshot) {
        return switch (action) {
            case ASSIGN_OFFICER, ESCALATE, REOPEN -> true;
            case CLOSE -> snapshot.hasResolution();
            default -> false;
        };
    }
}

final class OfficerRole implements CaseRole {
    @Override
    public boolean canPerform(CaseAction action, CaseSnapshot snapshot) {
        return switch (action) {
            case UPDATE_FINDING, REQUEST_DOCUMENT -> true;
            default -> false;
        };
    }
}
```

Manfaat:

- role behavior eksplisit
- permission logic tidak menumpuk di `User`
- mudah dites
- bisa diganti/dikonfigurasi
- cocok untuk domain complex workflow

---

## 8. Policy Object Pattern

Policy object merepresentasikan aturan yang bisa berubah.

```java
interface DiscountPolicy {
    Money discountFor(Order order);
}

final class NoDiscountPolicy implements DiscountPolicy {
    @Override
    public Money discountFor(Order order) {
        return Money.zero(order.currency());
    }
}

final class TieredDiscountPolicy implements DiscountPolicy {
    @Override
    public Money discountFor(Order order) {
        if (order.total().isGreaterThan(Money.of("1000", order.currency()))) {
            return order.total().multiply("0.10");
        }
        return Money.zero(order.currency());
    }
}
```

Policy object cocok ketika:

- rule berubah berdasarkan customer/tenant/agency/configuration
- rule butuh audit/versioning
- rule punya banyak variasi
- rule tidak seharusnya mengubah identity object

Policy object buruk ketika:

- hanya membungkus satu `if` sederhana tanpa alasan evolusi
- terlalu banyak policy kecil yang tidak reusable
- policy bergantung pada terlalu banyak service eksternal
- policy menjadi mini service god object

---

## 9. Strategy Pattern

Strategy adalah variasi algorithm dengan interface stabil.

```java
interface RoutingStrategy {
    Route route(Request request, List<Node> candidates);
}

final class LeastLoadedRoutingStrategy implements RoutingStrategy {
    @Override
    public Route route(Request request, List<Node> candidates) {
        Node selected = candidates.stream()
            .min(Comparator.comparing(Node::currentLoad))
            .orElseThrow();
        return new Route(selected);
    }
}

final class StickyRoutingStrategy implements RoutingStrategy {
    @Override
    public Route route(Request request, List<Node> candidates) {
        Node selected = candidates.stream()
            .filter(node -> node.matchesAffinity(request.affinityKey()))
            .findFirst()
            .orElseGet(() -> candidates.getFirst());
        return new Route(selected);
    }
}
```

### 9.1 Strategy vs policy

Strategy biasanya menjawab:

> Algorithm mana yang dipakai?

Policy biasanya menjawab:

> Rule bisnis apa yang berlaku?

Perbedaannya tipis, tetapi berguna.

Contoh:

- `CompressionStrategy`: algorithmic
- `RetryStrategy`: algorithmic/operational
- `DiscountPolicy`: business rule
- `EscalationPolicy`: business workflow rule

### 9.2 Strategy injection

```java
final class Router {
    private final RoutingStrategy strategy;

    Router(RoutingStrategy strategy) {
        this.strategy = Objects.requireNonNull(strategy);
    }

    Route route(Request request, List<Node> candidates) {
        return strategy.route(request, candidates);
    }
}
```

Ini lebih aman daripada subclassing:

```java
abstract class Router {
    abstract Route route(Request request, List<Node> candidates);
}
```

Karena router tetap bisa memiliki invariant umum, sementara variasi algorithm dipisah.

---

## 10. Decorator Pattern

Decorator menambah behavior sambil mempertahankan interface yang sama.

```java
interface DocumentStore {
    Document findById(DocumentId id);
    void save(Document document);
}

final class JdbcDocumentStore implements DocumentStore {
    @Override
    public Document findById(DocumentId id) {
        // query database
        throw new UnsupportedOperationException();
    }

    @Override
    public void save(Document document) {
        // persist document
    }
}

final class CachingDocumentStore implements DocumentStore {
    private final DocumentStore delegate;
    private final Cache<DocumentId, Document> cache;

    CachingDocumentStore(DocumentStore delegate, Cache<DocumentId, Document> cache) {
        this.delegate = Objects.requireNonNull(delegate);
        this.cache = Objects.requireNonNull(cache);
    }

    @Override
    public Document findById(DocumentId id) {
        return cache.get(id, delegate::findById);
    }

    @Override
    public void save(Document document) {
        delegate.save(document);
        cache.put(document.id(), document);
    }
}
```

Decorator cocok untuk cross-cutting local behavior:

- caching
- metrics
- audit
- retry
- validation
- tracing
- circuit breaker
- authorization check

### 10.1 Decorator chain

```java
DocumentStore store = new AuditingDocumentStore(
    new MetricsDocumentStore(
        new CachingDocumentStore(
            new JdbcDocumentStore(),
            cache
        ),
        metrics
    ),
    auditSink
);
```

Kelebihan:

- behavior bisa disusun
- setiap concern terpisah
- test per decorator mudah

Risiko:

- order decorator penting
- stack trace lebih panjang
- debugging lebih sulit
- identity/equality object bisa membingungkan
- transaction boundary bisa tidak jelas

### 10.2 Decorator order matters

Caching sebelum authorization bisa berbahaya jika cache key tidak mencakup principal/permission.

```text
Wrong:
Request -> Cache -> Authorization -> DB

Possible leak:
Unauthorized user receives cached data.
```

Lebih aman:

```text
Request -> Authorization -> Cache -> DB
```

Atau cache key harus memasukkan security context.

---

## 11. Adapter Pattern

Adapter menerjemahkan interface satu dunia ke interface dunia lain.

```java
interface PostalCodeLookup {
    Optional<Address> lookup(PostalCode postalCode);
}

final class ExternalMapApiClient {
    ExternalMapResponse search(String postalCode) {
        // HTTP call
        throw new UnsupportedOperationException();
    }
}

final class ExternalMapPostalCodeLookupAdapter implements PostalCodeLookup {
    private final ExternalMapApiClient client;

    ExternalMapPostalCodeLookupAdapter(ExternalMapApiClient client) {
        this.client = Objects.requireNonNull(client);
    }

    @Override
    public Optional<Address> lookup(PostalCode postalCode) {
        ExternalMapResponse response = client.search(postalCode.value());
        return response.toAddress();
    }
}
```

Adapter cocok untuk:

- external API
- legacy system
- generated client
- vendor SDK
- database-specific implementation
- framework-specific boundary

Adapter menjaga domain tetap bersih.

Domain tidak perlu tahu:

- HTTP status
- JSON field name
- vendor exception
- generated DTO
- API versioning detail

---

## 12. Facade Pattern

Facade menyediakan API sederhana di atas subsystem kompleks.

```java
final class CaseSubmissionFacade {
    private final CaseValidator validator;
    private final CaseRepository repository;
    private final CaseAssignmentService assignmentService;
    private final NotificationService notificationService;

    SubmissionResult submit(SubmitCaseCommand command) {
        ValidationResult validation = validator.validate(command);
        if (!validation.isValid()) {
            return SubmissionResult.rejected(validation.errors());
        }

        CaseFile caseFile = CaseFile.open(command);
        Officer assignedOfficer = assignmentService.assign(caseFile);
        caseFile.assignTo(assignedOfficer.id());

        repository.save(caseFile);
        notificationService.notifyAssigned(caseFile.id(), assignedOfficer.id());

        return SubmissionResult.accepted(caseFile.id());
    }
}
```

Facade baik jika:

- menyederhanakan API untuk caller
- mengurangi coupling caller terhadap subsystem
- memberi transaction/use-case boundary
- menjadi entry point yang jelas

Facade buruk jika:

- semua logic masuk ke facade
- facade tahu detail semua module
- facade menjadi god service
- facade hanya pass-through tanpa nilai

---

## 13. Composite Pattern

Composite memungkinkan single object dan group object diperlakukan sama.

```java
interface AuthorizationRule {
    boolean permits(User user, Resource resource, Action action);
}

final class RoleRule implements AuthorizationRule {
    private final Role requiredRole;

    @Override
    public boolean permits(User user, Resource resource, Action action) {
        return user.hasRole(requiredRole);
    }
}

final class AndRule implements AuthorizationRule {
    private final List<AuthorizationRule> rules;

    @Override
    public boolean permits(User user, Resource resource, Action action) {
        return rules.stream().allMatch(rule -> rule.permits(user, resource, action));
    }
}

final class OrRule implements AuthorizationRule {
    private final List<AuthorizationRule> rules;

    @Override
    public boolean permits(User user, Resource resource, Action action) {
        return rules.stream().anyMatch(rule -> rule.permits(user, resource, action));
    }
}
```

Composite cocok untuk:

- validation rule tree
- authorization rule tree
- filter expression
- query criteria
- UI/component tree
- workflow condition tree

Risiko:

- recursive structure sulit debug
- error reporting harus dirancang
- short-circuit behavior harus jelas
- cyclic graph harus dicegah

---

## 14. Chain of Responsibility

Chain of Responsibility menyusun handler berurutan.

```java
interface CommandHandler {
    boolean canHandle(Command command);
    CommandResult handle(Command command);
}

final class CommandBus {
    private final List<CommandHandler> handlers;

    CommandResult dispatch(Command command) {
        return handlers.stream()
            .filter(handler -> handler.canHandle(command))
            .findFirst()
            .orElseThrow(() -> new NoHandlerFoundException(command.type()))
            .handle(command);
    }
}
```

Atau chain yang semua handler boleh memproses:

```java
interface ValidationStep {
    void validate(ValidationContext context);
}

final class ValidatorPipeline {
    private final List<ValidationStep> steps;

    ValidationResult validate(Command command) {
        ValidationContext context = new ValidationContext(command);
        for (ValidationStep step : steps) {
            step.validate(context);
        }
        return context.result();
    }
}
```

Cocok untuk:

- validation pipeline
- request filters
- event processing
- enrichment pipeline
- import/export steps
- rule evaluation

Risiko:

- order dependency tidak terdokumentasi
- hidden side effect antar step
- step terlalu bergantung pada mutable context
- duplicate handler ambiguity

---

## 15. Registry and Provider Pattern

Registry memetakan key ke strategy/provider.

```java
enum Channel {
    EMAIL,
    SMS,
    PUSH
}

interface NotificationSender {
    Channel channel();
    void send(Notification notification);
}

final class NotificationSenderRegistry {
    private final Map<Channel, NotificationSender> senders;

    NotificationSenderRegistry(List<NotificationSender> senders) {
        this.senders = senders.stream()
            .collect(Collectors.toUnmodifiableMap(
                NotificationSender::channel,
                Function.identity(),
                (a, b) -> {
                    throw new IllegalArgumentException("Duplicate sender for " + a.channel());
                }
            ));
    }

    NotificationSender senderFor(Channel channel) {
        NotificationSender sender = senders.get(channel);
        if (sender == null) {
            throw new UnsupportedOperationException("No sender for channel " + channel);
        }
        return sender;
    }
}
```

Registry baik ketika:

- jumlah implementasi bisa bertambah
- pemilihan berdasarkan key jelas
- caller tidak boleh `switch` ke semua implementation
- implementation bisa di-discover dari DI container atau ServiceLoader

Registry buruk ketika:

- key tidak stabil
- registry menjadi global mutable singleton
- conflict handling tidak jelas
- fallback terlalu diam-diam

---

## 16. Mixins di Java: Apa yang Bisa dan Tidak Bisa

Java tidak punya mixin seperti beberapa bahasa lain. Tetapi ada beberapa pendekatan mixin-like.

### 16.1 Default method sebagai behavior mixin ringan

```java
interface Identified<ID> {
    ID id();

    default boolean hasSameIdAs(Identified<ID> other) {
        return other != null && Objects.equals(id(), other.id());
    }
}
```

Ini memberikan behavior reusable.

Risiko:

- default method bisa menjadi logic berat
- interface menjadi terlalu state-assuming
- conflict antar default method
- sulit inject dependency

### 16.2 Composition-based mixin

```java
final class TimestampedBehavior {
    private Instant createdAt;
    private Instant updatedAt;

    void markCreated(Instant now) {
        this.createdAt = now;
        this.updatedAt = now;
    }

    void markUpdated(Instant now) {
        this.updatedAt = now;
    }
}

final class CaseFile {
    private final TimestampedBehavior timestamps = new TimestampedBehavior();

    void open(Instant now) {
        timestamps.markCreated(now);
    }
}
```

Ini lebih fleksibel, tapi bisa terasa verbose.

### 16.3 Annotation/codegen mixin

Framework atau generator dapat menambahkan behavior melalui:

- annotation processing
- bytecode enhancement
- dynamic proxy
- AOP
- Lombok-like code generation

Risiko:

- behavior tidak terlihat jelas di source
- debugging lebih sulit
- module/reflection access issue
- generated code bisa mengunci desain

---

## 17. Object Collaboration Map

Untuk sistem kompleks, buat collaboration map.

Contoh use case: submit application.

```text
SubmitApplicationController
    -> SubmitApplicationUseCase
        -> ApplicationDraftRepository
        -> ApplicationValidator
            -> EligibilityPolicy
            -> DocumentRequirementPolicy
        -> ApplicationFactory
        -> ApplicationRepository
        -> OfficerAssignmentPolicy
        -> ApplicationEventPublisher
```

Lalu beri label:

```text
Controller
    role: transport adapter
    owns: HTTP mapping only

UseCase
    role: workflow coordinator
    owns: transaction boundary, order of operation

Repository
    role: persistence port
    owns: data access abstraction

Validator
    role: domain validation collaborator
    owns: validation composition

Policy
    role: variable business rule
    owns: decision logic

Factory
    role: valid aggregate construction
    owns: creation invariant

EventPublisher
    role: outbound side-effect boundary
    owns: event publishing abstraction
```

Kegunaan collaboration map:

- melihat god object
- melihat hidden dependency
- melihat dependency direction salah
- melihat behavior yang salah tempat
- melihat boundary side effect
- melihat test seam

---

## 18. Dependency Direction

Composition harus memperhatikan arah dependency.

Buruk:

```java
final class DomainCase {
    private final CaseRepository repository;

    void close() {
        // domain object melakukan persistence sendiri
        repository.save(this);
    }
}
```

Masalah:

- domain object tergantung infrastructure
- sulit dites
- lifecycle persistence tersembunyi
- transaction boundary kabur

Lebih baik:

```java
final class DomainCase {
    void close(ClosingReason reason) {
        if (!canClose()) {
            throw new InvalidCaseStateException();
        }
        this.status = CaseStatus.CLOSED;
        this.closingReason = reason;
    }
}

final class CloseCaseUseCase {
    private final CaseRepository repository;

    void close(CaseId id, ClosingReason reason) {
        DomainCase caseFile = repository.findById(id).orElseThrow();
        caseFile.close(reason);
        repository.save(caseFile);
    }
}
```

Rule umum:

- domain object boleh tahu value object dan domain policy
- use case boleh tahu repository/port
- infrastructure adapter boleh tahu external SDK
- domain sebaiknya tidak tahu HTTP, database, message broker, framework

---

## 19. Collaboration vs Transaction Boundary

Dalam enterprise Java, object collaboration sering dibungkus transaction.

Salah satu pertanyaan penting:

> Object mana yang menentukan unit of work?

Biasanya:

- entity/domain object menjaga invariant lokal
- policy membuat keputusan
- use case/application service mengatur transaction
- repository menyimpan/mengambil aggregate
- event publisher mengirim efek samping setelah state berubah

Contoh:

```java
final class ApproveApplicationUseCase {
    private final ApplicationRepository repository;
    private final ApprovalPolicy approvalPolicy;
    private final DomainEventCollector events;

    @Transactional
    ApprovalResult approve(ApproveApplicationCommand command) {
        Application application = repository.findById(command.applicationId())
            .orElseThrow(ApplicationNotFoundException::new);

        ApprovalDecision decision = approvalPolicy.decide(application.snapshot(), command.officerId());
        application.apply(decision);

        repository.save(application);
        events.add(ApplicationApproved.from(application));

        return ApprovalResult.from(decision);
    }
}
```

Yang penting:

- transaction tidak masuk ke entity
- entity tidak publish event sendiri ke broker
- use case mengatur boundary
- policy tidak melakukan persistence

---

## 20. Avoiding God Service

God service terlihat seperti ini:

```java
final class CaseService {
    void createCase(...) { ... }
    void assignOfficer(...) { ... }
    void escalateCase(...) { ... }
    void closeCase(...) { ... }
    void reopenCase(...) { ... }
    void validateCase(...) { ... }
    void calculateSla(...) { ... }
    void sendNotification(...) { ... }
    void generateReport(...) { ... }
    void syncExternalSystem(...) { ... }
}
```

Gejala:

- terlalu banyak dependency constructor
- method besar
- business rule tersebar
- test setup berat
- perubahan kecil memengaruhi banyak area
- class menjadi tempat semua orang menaruh logic baru

Refactoring:

```text
CaseService
    -> OpenCaseUseCase
    -> AssignOfficerUseCase
    -> EscalateCaseUseCase
    -> CloseCaseUseCase
    -> ReopenCaseUseCase

Shared collaborators:
    CaseRepository
    CasePolicy
    SlaPolicy
    NotificationPort
    ExternalSyncPort
```

Namun jangan ekstrem membuat satu class untuk setiap baris logic. Ukur dengan cohesion dan reason to change.

---

## 21. Avoiding Anemic Object

Anemic object:

```java
class CaseFile {
    private CaseStatus status;
    private OfficerId officerId;

    public CaseStatus getStatus() { return status; }
    public void setStatus(CaseStatus status) { this.status = status; }
    public OfficerId getOfficerId() { return officerId; }
    public void setOfficerId(OfficerId officerId) { this.officerId = officerId; }
}
```

Service melakukan semua:

```java
if (caseFile.getStatus() != CaseStatus.OPEN) {
    throw new IllegalStateException();
}
caseFile.setOfficerId(officerId);
caseFile.setStatus(CaseStatus.ASSIGNED);
```

Lebih baik:

```java
final class CaseFile {
    private CaseStatus status;
    private OfficerId officerId;

    void assignTo(OfficerId officerId) {
        if (status != CaseStatus.OPEN) {
            throw new InvalidCaseTransitionException(status, CaseStatus.ASSIGNED);
        }
        this.officerId = Objects.requireNonNull(officerId);
        this.status = CaseStatus.ASSIGNED;
    }
}
```

Behavior yang menjaga invariant masuk ke object.

Service/use case tetap penting untuk:

- loading state
- transaction
- external call
- authorization context
- orchestration

---

## 22. Testability sebagai Indikator Desain

Composition membuat unit test lebih natural jika dependency jelas.

```java
class EscalationPolicyTest {
    @Test
    void escalatesWhenSlaBreached() {
        EscalationPolicy policy = new EscalationPolicy(
            List.of(new SlaBreachEscalationRule(Duration.ofHours(48))),
            Clock.fixed(Instant.parse("2026-01-03T00:00:00Z"), ZoneOffset.UTC)
        );

        CaseSnapshot snapshot = new CaseSnapshot(
            CaseId.of("C-1"),
            Severity.MEDIUM,
            Instant.parse("2026-01-01T00:00:00Z"),
            false
        );

        EscalationDecision decision = policy.decide(snapshot);

        assertTrue(decision.escalate());
        assertTrue(decision.reasons().contains(EscalationReason.SLA_BREACHED));
    }
}
```

Jika test membutuhkan mock 15 service untuk menguji satu rule, desain mungkin salah.

Indikator desain baik:

- rule dapat dites tanpa database
- policy dapat dites tanpa HTTP
- domain object dapat dites tanpa DI container
- adapter dapat dites dengan contract test
- use case dapat dites dengan fake port

---

## 23. Composition and DI Containers

Dependency Injection container membuat composition mudah, tapi juga bisa menyembunyikan desain buruk.

### 23.1 Constructor injection sebagai explicit collaboration

```java
final class SubmitApplicationUseCase {
    private final ApplicationRepository repository;
    private final ApplicationValidator validator;
    private final EventPublisher eventPublisher;

    SubmitApplicationUseCase(
        ApplicationRepository repository,
        ApplicationValidator validator,
        EventPublisher eventPublisher
    ) {
        this.repository = Objects.requireNonNull(repository);
        this.validator = Objects.requireNonNull(validator);
        this.eventPublisher = Objects.requireNonNull(eventPublisher);
    }
}
```

Constructor injection memperlihatkan collaboration graph.

### 23.2 Field injection menyembunyikan invariant construction

```java
class SubmitApplicationUseCase {
    @Inject
    ApplicationRepository repository;

    @Inject
    ApplicationValidator validator;
}
```

Masalah:

- object bisa dibuat dalam state invalid
- dependency tidak final
- test lebih sulit
- construction contract tidak jelas

### 23.3 Terlalu banyak dependency adalah signal

Jika constructor punya 12 dependency, jangan langsung pakai field injection untuk “merapikan”. Itu hanya menyembunyikan masalah.

Kemungkinan masalah:

- class terlalu banyak responsibility
- collaborator bisa dikelompokkan
- workflow terlalu besar
- domain behavior salah tempat
- facade/use case perlu dipecah

---

## 24. Composition and Proxies

Framework sering membungkus object dengan proxy.

Contoh konseptual:

```text
Caller -> TransactionProxy -> SecurityProxy -> RealService
```

Dampak desain:

- call internal `this.method()` mungkin tidak melewati proxy
- final class/method bisa membatasi class-based proxy
- equals/hashCode bisa bermasalah jika proxy dibandingkan dengan real class
- constructor logic tidak boleh bergantung pada proxy behavior
- interface-based design sering lebih proxy-friendly

Contoh jebakan:

```java
class ReportService {
    public void generate() {
        saveAudit(); // internal self-invocation
    }

    @Transactional
    public void saveAudit() {
        // may not run transaction if proxy not crossed
    }
}
```

Solusi desain:

- pisahkan collaborator transaction boundary
- gunakan use case boundary jelas
- jangan mengandalkan self-invocation untuk behavior proxy

---

## 25. Composition and API Evolution

Composition memudahkan evolusi karena implementation dapat berubah tanpa mengubah public type hierarchy.

Misalnya:

```java
public final class PaymentProcessor {
    private final PaymentGateway gateway;
    private final FraudPolicy fraudPolicy;

    public PaymentProcessor(PaymentGateway gateway, FraudPolicy fraudPolicy) {
        this.gateway = gateway;
        this.fraudPolicy = fraudPolicy;
    }
}
```

Jika fraud logic berubah, kamu bisa mengganti `FraudPolicy` tanpa subclass explosion.

Inheritance approach:

```java
class PaymentProcessor { }
class FraudCheckingPaymentProcessor extends PaymentProcessor { }
class RetryingFraudCheckingPaymentProcessor extends FraudCheckingPaymentProcessor { }
class AuditedRetryingFraudCheckingPaymentProcessor extends RetryingFraudCheckingPaymentProcessor { }
```

Ini cepat menjadi kombinatorial.

Composition menghindari subclass explosion:

```text
PaymentProcessor
    + FraudPolicy
    + RetryPolicy
    + AuditSink
    + PaymentGateway
```

---

## 26. Object Collaboration and Module Boundary

Di sistem modular, composition harus mengikuti boundary.

Contoh package/module:

```text
com.acme.case.domain
    CaseFile
    CaseStatus
    CaseTransitionPolicy

com.acme.case.application
    OpenCaseUseCase
    CloseCaseUseCase
    CaseRepository port

com.acme.case.infrastructure.persistence
    JdbcCaseRepository

com.acme.case.infrastructure.notification
    MessageBrokerCaseEventPublisher
```

Dependency direction:

```text
infrastructure -> application -> domain
```

Atau dengan ports:

```text
application defines port
infrastructure implements port
```

```java
// application module
public interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);
    void save(CaseFile caseFile);
}

// infrastructure module
public final class JdbcCaseRepository implements CaseRepository {
    @Override
    public Optional<CaseFile> findById(CaseId id) { ... }

    @Override
    public void save(CaseFile caseFile) { ... }
}
```

Jangan biarkan domain bergantung ke infrastructure hanya karena “composition”.

Composition tetap harus tunduk ke architecture boundary.

---

## 27. ServiceLoader as Composition Mechanism

Java menyediakan `ServiceLoader` untuk menemukan provider dari service interface pada runtime.

Contoh service:

```java
public interface ExportFormatProvider {
    String format();
    ReportExporter createExporter();
}
```

Provider:

```java
public final class PdfExportFormatProvider implements ExportFormatProvider {
    @Override
    public String format() {
        return "pdf";
    }

    @Override
    public ReportExporter createExporter() {
        return new PdfReportExporter();
    }
}
```

Loader:

```java
public final class ExporterRegistry {
    private final Map<String, ExportFormatProvider> providers;

    public ExporterRegistry() {
        this.providers = ServiceLoader.load(ExportFormatProvider.class).stream()
            .map(ServiceLoader.Provider::get)
            .collect(Collectors.toUnmodifiableMap(
                ExportFormatProvider::format,
                Function.identity()
            ));
    }

    public ReportExporter exporterFor(String format) {
        ExportFormatProvider provider = providers.get(format);
        if (provider == null) {
            throw new IllegalArgumentException("Unsupported format: " + format);
        }
        return provider.createExporter();
    }
}
```

JPMS variant:

```java
module com.acme.report.api {
    exports com.acme.report.api;
}

module com.acme.report.pdf {
    requires com.acme.report.api;
    provides com.acme.report.api.ExportFormatProvider
        with com.acme.report.pdf.PdfExportFormatProvider;
}

module com.acme.report.app {
    requires com.acme.report.api;
    uses com.acme.report.api.ExportFormatProvider;
}
```

Ini adalah composition lintas module.

Cocok untuk:

- plugin architecture
- provider implementation
- compiler/tooling extension
- export/import format
- optional runtime implementation

Risiko:

- discovery failure runtime
- duplicate provider
- ordering tidak boleh diasumsikan sembarangan
- error handling harus eksplisit
- startup cost perlu dipahami

---

## 28. Generated Code Boundary

Generated code sering terlibat dalam composition.

Contoh:

- mapper generated class
- API client generated class
- DI generated factory
- serialization adapter
- query DSL
- proxy class

Prinsip:

> Jangan jadikan generated code sebagai pusat domain model.

Buruk:

```java
final class ApplicationService {
    private final GeneratedExternalApplicationApiClient client;

    void submit(GeneratedSubmitApplicationRequest request) {
        // business logic menggunakan generated DTO langsung
    }
}
```

Lebih baik:

```java
final class ApplicationService {
    private final ExternalApplicationPort externalApplicationPort;

    void submit(SubmitApplicationCommand command) {
        externalApplicationPort.submit(command);
    }
}

final class GeneratedClientExternalApplicationAdapter implements ExternalApplicationPort {
    private final GeneratedExternalApplicationApiClient client;

    @Override
    public void submit(SubmitApplicationCommand command) {
        GeneratedSubmitApplicationRequest request = map(command);
        client.submit(request);
    }
}
```

Generated code ditempatkan di adapter boundary.

---

## 29. Reflection Boundary

Reflection memungkinkan composition dinamis, tetapi juga melemahkan explicitness.

Contoh framework DI:

```text
scan classes -> inspect annotations -> instantiate -> inject dependencies -> proxy -> expose bean
```

Masalah potensial:

- constructor dipilih tidak sesuai ekspektasi
- private field dimodifikasi
- missing no-arg constructor
- annotation salah retention/target
- module tidak membuka package untuk reflection
- runtime error terlambat diketahui

Prinsip desain:

1. Constructor tetap valid secara Java biasa.
2. Required dependency harus final dan non-null.
3. Reflection tidak boleh menjadi satu-satunya cara object valid dibuat, kecuali untuk DTO/framework-only type.
4. Package/module opens harus eksplisit dan minimal.
5. Reflection boundary harus dites.

---

## 30. Design Matrix: Pilih Mekanisme yang Tepat

| Kebutuhan | Mekanisme yang cocok | Catatan |
|---|---|---|
| Behavior harus substitutable sebagai type | Interface | Stabilkan contract |
| Behavior variasi algorithm | Strategy | Inject implementation |
| Rule bisnis yang berubah | Policy object | Buat decision/result eksplisit |
| Tambah behavior tanpa ubah interface | Decorator | Perhatikan order |
| Terjemahkan external API ke domain | Adapter | Lindungi domain dari vendor DTO |
| Sederhanakan subsystem kompleks | Facade | Jangan jadi god service |
| Susun rule/tree | Composite | Desain error reporting |
| Pipeline handler berurutan | Chain of Responsibility | Dokumentasikan ordering |
| Closed set subtype | Sealed hierarchy | Cocok dengan exhaustive switch |
| Closed set constant | Enum | Hindari ordinal persistence |
| Shared light behavior | Interface default method | Jangan terlalu stateful |
| Runtime provider discovery | ServiceLoader/DI registry | Tangani duplicate/missing provider |
| Cross-cutting framework behavior | Proxy/AOP/decorator | Pahami self-invocation dan final class |
| Invariant lokal state | Domain object method | Jangan pindahkan semua ke service |

---

## 31. Case Study: Regulatory Case Escalation

Kita buat mini desain yang realistis.

### 31.1 Requirement

- Case dapat dieskalasi jika:
  - severity high
  - SLA breached
  - manual override oleh supervisor
- Escalation harus menyimpan alasan.
- Rule bisa berubah per agency.
- Sistem harus bisa diaudit.
- External notification dikirim setelah escalation.

### 31.2 Domain model

```java
enum Severity {
    LOW,
    MEDIUM,
    HIGH
}

enum CaseStatus {
    OPEN,
    ASSIGNED,
    ESCALATED,
    CLOSED
}

enum EscalationReason {
    HIGH_SEVERITY,
    SLA_BREACHED,
    SUPERVISOR_OVERRIDE
}

record CaseId(String value) {
    CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId must not be blank");
        }
    }
}
```

### 31.3 Aggregate-like object

```java
final class CaseFile {
    private final CaseId id;
    private CaseStatus status;
    private final Severity severity;
    private final Instant createdAt;
    private final List<EscalationReason> escalationReasons = new ArrayList<>();

    CaseFile(CaseId id, Severity severity, Instant createdAt) {
        this.id = Objects.requireNonNull(id);
        this.severity = Objects.requireNonNull(severity);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.status = CaseStatus.OPEN;
    }

    CaseSnapshot snapshot() {
        return new CaseSnapshot(id, status, severity, createdAt);
    }

    void escalate(EscalationDecision decision) {
        if (!decision.escalate()) {
            return;
        }
        if (status == CaseStatus.CLOSED) {
            throw new IllegalStateException("Closed case cannot be escalated");
        }
        this.status = CaseStatus.ESCALATED;
        this.escalationReasons.clear();
        this.escalationReasons.addAll(decision.reasons());
    }

    CaseId id() {
        return id;
    }
}

record CaseSnapshot(
    CaseId id,
    CaseStatus status,
    Severity severity,
    Instant createdAt
) { }
```

### 31.4 Policy and rule composition

```java
record EscalationDecision(boolean escalate, List<EscalationReason> reasons) {
    EscalationDecision {
        reasons = List.copyOf(reasons);
    }

    static EscalationDecision from(List<EscalationReason> reasons) {
        return new EscalationDecision(!reasons.isEmpty(), reasons);
    }
}

interface EscalationRule {
    Optional<EscalationReason> evaluate(CaseSnapshot snapshot, EscalationContext context);
}

record EscalationContext(Instant now, boolean supervisorOverride) { }

final class HighSeverityRule implements EscalationRule {
    @Override
    public Optional<EscalationReason> evaluate(CaseSnapshot snapshot, EscalationContext context) {
        return snapshot.severity() == Severity.HIGH
            ? Optional.of(EscalationReason.HIGH_SEVERITY)
            : Optional.empty();
    }
}

final class SlaBreachRule implements EscalationRule {
    private final Duration threshold;

    SlaBreachRule(Duration threshold) {
        this.threshold = Objects.requireNonNull(threshold);
    }

    @Override
    public Optional<EscalationReason> evaluate(CaseSnapshot snapshot, EscalationContext context) {
        Duration age = Duration.between(snapshot.createdAt(), context.now());
        return age.compareTo(threshold) > 0
            ? Optional.of(EscalationReason.SLA_BREACHED)
            : Optional.empty();
    }
}

final class SupervisorOverrideRule implements EscalationRule {
    @Override
    public Optional<EscalationReason> evaluate(CaseSnapshot snapshot, EscalationContext context) {
        return context.supervisorOverride()
            ? Optional.of(EscalationReason.SUPERVISOR_OVERRIDE)
            : Optional.empty();
    }
}

final class EscalationPolicy {
    private final List<EscalationRule> rules;
    private final Clock clock;

    EscalationPolicy(List<EscalationRule> rules, Clock clock) {
        this.rules = List.copyOf(rules);
        this.clock = Objects.requireNonNull(clock);
    }

    EscalationDecision decide(CaseSnapshot snapshot, boolean supervisorOverride) {
        EscalationContext context = new EscalationContext(clock.instant(), supervisorOverride);
        List<EscalationReason> reasons = rules.stream()
            .map(rule -> rule.evaluate(snapshot, context))
            .flatMap(Optional::stream)
            .distinct()
            .toList();

        return EscalationDecision.from(reasons);
    }
}
```

### 31.5 Use case orchestration

```java
interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);
    void save(CaseFile caseFile);
}

interface CaseNotificationPort {
    void notifyEscalated(CaseId caseId, List<EscalationReason> reasons);
}

record EscalateCaseCommand(CaseId caseId, boolean supervisorOverride) { }

final class EscalateCaseUseCase {
    private final CaseRepository repository;
    private final EscalationPolicy escalationPolicy;
    private final CaseNotificationPort notificationPort;

    EscalateCaseUseCase(
        CaseRepository repository,
        EscalationPolicy escalationPolicy,
        CaseNotificationPort notificationPort
    ) {
        this.repository = Objects.requireNonNull(repository);
        this.escalationPolicy = Objects.requireNonNull(escalationPolicy);
        this.notificationPort = Objects.requireNonNull(notificationPort);
    }

    EscalationDecision escalate(EscalateCaseCommand command) {
        CaseFile caseFile = repository.findById(command.caseId())
            .orElseThrow(() -> new IllegalArgumentException("Case not found: " + command.caseId()));

        EscalationDecision decision = escalationPolicy.decide(
            caseFile.snapshot(),
            command.supervisorOverride()
        );

        caseFile.escalate(decision);
        repository.save(caseFile);

        if (decision.escalate()) {
            notificationPort.notifyEscalated(caseFile.id(), decision.reasons());
        }

        return decision;
    }
}
```

### 31.6 Apa yang bagus dari desain ini?

- `CaseFile` menjaga state transition.
- `EscalationPolicy` membuat keputusan rule.
- `EscalationRule` membuat rule dapat dikombinasikan.
- `Clock` membuat time deterministic di test.
- Use case mengatur repository dan notification.
- External notification tidak masuk domain object.
- Result membawa alasan audit.
- Rule bisa beda per agency dengan konfigurasi object graph berbeda.

---

## 32. Common Anti-Patterns

### 32.1 Pass-through service

```java
final class UserService {
    private final UserRepository repository;

    User findById(UserId id) {
        return repository.findById(id);
    }
}
```

Jika tidak ada business/use-case value, service ini mungkin noise.

### 32.2 Manager suffix as dumping ground

```java
CaseManager
ApplicationManager
DocumentManager
WorkflowManager
```

`Manager` sering berarti responsibility belum jelas.

Lebih baik gunakan nama berdasarkan responsibility:

- `CaseAssignmentPolicy`
- `CaseEscalationUseCase`
- `DocumentRetentionPolicy`
- `WorkflowTransitionValidator`

### 32.3 Utility class replacing object model

```java
final class CaseUtils {
    static boolean canClose(CaseFile caseFile) { ... }
    static boolean canEscalate(CaseFile caseFile) { ... }
    static Duration age(CaseFile caseFile) { ... }
}
```

Utility class sering menjadi tanda behavior salah tempat.

### 32.4 Boolean parameter strategy

```java
void process(Order order, boolean applyDiscount, boolean sendNotification, boolean audit) { }
```

Lebih baik pisahkan policy/configuration:

```java
record ProcessingOptions(
    DiscountPolicy discountPolicy,
    NotificationMode notificationMode,
    AuditMode auditMode
) { }
```

Atau pisah use case jika behavior memang berbeda.

### 32.5 Inheritance for configuration

```java
class SingaporePaymentProcessor extends PaymentProcessor { }
class MalaysiaPaymentProcessor extends PaymentProcessor { }
class IndonesiaPaymentProcessor extends PaymentProcessor { }
```

Sering lebih baik:

```java
new PaymentProcessor(countrySpecificPaymentPolicy);
```

### 32.6 Hidden global registry

```java
GlobalHandlerRegistry.get(type).handle(command);
```

Risiko:

- hidden dependency
- test pollution
- ordering/global state bug
- sulit parallel test

Lebih baik inject registry sebagai dependency eksplisit.

---

## 33. Refactoring Recipe: From Inheritance to Composition

### Step 1: Identifikasi override points

```java
abstract class ReportGenerator {
    public final Report generate(Input input) {
        Data data = load(input);
        String rendered = render(data);
        save(rendered);
        return new Report(rendered);
    }

    protected abstract Data load(Input input);
    protected abstract String render(Data data);
    protected abstract void save(String rendered);
}
```

### Step 2: Ubah override points menjadi collaborator

```java
interface DataLoader {
    Data load(Input input);
}

interface ReportRenderer {
    String render(Data data);
}

interface ReportSink {
    void save(String rendered);
}
```

### Step 3: Workflow owner tetap final

```java
final class ReportGenerator {
    private final DataLoader loader;
    private final ReportRenderer renderer;
    private final ReportSink sink;

    ReportGenerator(DataLoader loader, ReportRenderer renderer, ReportSink sink) {
        this.loader = Objects.requireNonNull(loader);
        this.renderer = Objects.requireNonNull(renderer);
        this.sink = Objects.requireNonNull(sink);
    }

    Report generate(Input input) {
        Data data = loader.load(input);
        String rendered = renderer.render(data);
        sink.save(rendered);
        return new Report(rendered);
    }
}
```

### Step 4: Pastikan invariant workflow tidak bocor

Jika `save` hanya boleh setelah `render`, jangan expose terlalu banyak public method.

### Step 5: Tambahkan tests per collaborator dan workflow

- `DataLoaderTest`
- `ReportRendererTest`
- `ReportGeneratorTest`

---

## 34. Refactoring Recipe: From God Service to Collaborating Objects

### Step 1: Kelompokkan method berdasarkan reason to change

```text
CaseService
    validation methods
    assignment methods
    escalation methods
    SLA methods
    notification methods
    report methods
```

### Step 2: Pisahkan policy dari use case

```text
SlaPolicy
EscalationPolicy
AssignmentPolicy
```

### Step 3: Pisahkan side effect port

```text
CaseRepository
NotificationPort
AuditPort
ExternalSyncPort
```

### Step 4: Buat use case kecil

```text
OpenCaseUseCase
AssignCaseUseCase
EscalateCaseUseCase
CloseCaseUseCase
```

### Step 5: Pindahkan invariant ke domain object

```java
caseFile.assignTo(officerId);
caseFile.escalate(decision);
caseFile.close(reason);
```

### Step 6: Buat collaboration map

Jangan refactor buta. Gambar dependency dan ownership.

---

## 35. Practical Heuristics

### 35.1 Let state and invariant live together

Jika method selalu butuh banyak getter dari object yang sama, method itu mungkin milik object tersebut.

Buruk:

```java
if (order.getStatus() == SUBMITTED && order.getPaidAt() != null && order.getLines().size() > 0) { }
```

Lebih baik:

```java
if (order.isReadyForFulfillment()) { }
```

### 35.2 Extract policy when rule varies independently

Jika rule berubah per tenant/agency/customer/time/version, jadikan policy.

### 35.3 Extract strategy when algorithm varies

Jika ada beberapa cara menghitung/merender/routing/compress, jadikan strategy.

### 35.4 Use adapter at external boundary

Jangan biarkan generated/vendor DTO merembes ke domain.

### 35.5 Use decorator for orthogonal behavior

Retry, metrics, audit, tracing sering lebih cocok decorator daripada copy-paste.

### 35.6 Avoid premature abstraction

Jangan buat interface hanya karena “best practice”. Buat interface saat ada kebutuhan:

- multiple implementation
- boundary antar module
- test seam yang meaningful
- plugin/provider
- API contract publik

### 35.7 Prefer constructor clarity over magic injection

Object yang dependency-nya jelas lebih mudah dipahami, dites, dan di-refactor.

---

## 36. Checklist Code Review

Gunakan checklist berikut saat mereview desain composition/collaboration.

### 36.1 Responsibility

- Apakah tiap class punya reason to change yang jelas?
- Apakah class ini melakukan terlalu banyak hal?
- Apakah behavior ditempatkan dekat dengan state yang dijaganya?
- Apakah use case mengorkestrasi, bukan mengambil semua logic domain?

### 36.2 Dependency

- Apakah dependency direction sesuai architecture boundary?
- Apakah domain tergantung framework/infrastructure?
- Apakah generated/vendor type bocor ke domain?
- Apakah dependency eksplisit di constructor?

### 36.3 Extension

- Apakah extension point memang diperlukan?
- Apakah interface terlalu luas?
- Apakah default behavior aman?
- Apakah missing implementation ditangani jelas?

### 36.4 Invariant

- Apakah invariant bisa dilanggar lewat collaborator?
- Apakah mutable internal state bocor?
- Apakah order workflow dijaga owner yang tepat?
- Apakah policy hanya memutuskan, bukan mutate sembarangan?

### 36.5 Testing

- Apakah rule bisa dites tanpa database?
- Apakah time dependency disuntikkan?
- Apakah adapter bisa dites dengan contract test?
- Apakah use case test terlalu banyak mock?

### 36.6 Runtime

- Apakah decorator order aman?
- Apakah proxy self-invocation menjadi masalah?
- Apakah reflection/module access diperlukan?
- Apakah registry duplicate/missing provider ditangani?

---

## 37. Mental Model Akhir

Composition bukan sekadar teknik menghindari inheritance. Composition adalah cara untuk membangun sistem dari object-object kecil yang:

- punya tanggung jawab jelas
- menjaga invariant yang tepat
- dependency-nya eksplisit
- boundary-nya stabil
- mudah dites
- mudah dievolusi
- aman terhadap framework/proxy/generated code
- tidak mencampur domain, workflow, infrastructure, dan cross-cutting concern secara sembarangan

Inheritance bertanya:

> Object ini jenis dari apa?

Composition bertanya:

> Object ini bekerja dengan siapa?

Delegation bertanya:

> Siapa yang paling tepat melakukan bagian pekerjaan ini?

Policy bertanya:

> Rule apa yang berubah?

Strategy bertanya:

> Algorithm apa yang bisa diganti?

Adapter bertanya:

> Boundary luar mana yang perlu diterjemahkan?

Decorator bertanya:

> Behavior tambahan apa yang orthogonal terhadap core behavior?

Facade bertanya:

> Kompleksitas subsystem mana yang perlu disederhanakan untuk caller?

Composite bertanya:

> Apakah single dan group bisa diperlakukan seragam?

Chain bertanya:

> Apakah proses ini adalah pipeline handler yang berurutan?

Registry bertanya:

> Apakah implementasi perlu dipilih berdasarkan key/provider?

Jika kamu bisa menjawab pertanyaan-pertanyaan ini sebelum membuat class, kamu tidak lagi sekadar menulis Java. Kamu sedang mendesain struktur sistem.

---

## 38. Latihan

### Latihan 1 — Refactor inheritance ke composition

Ambil desain berikut:

```java
abstract class NotificationService {
    public final void notify(User user, Message message) {
        if (user.isActive()) {
            send(user, message);
            audit(user, message);
        }
    }

    protected abstract void send(User user, Message message);
    protected void audit(User user, Message message) { }
}
```

Tugas:

1. Ubah `send` menjadi strategy/collaborator.
2. Ubah `audit` menjadi decorator atau collaborator.
3. Pastikan workflow active-user tetap dijaga satu owner.
4. Jelaskan trade-off desain baru.

### Latihan 2 — Desain escalation policy

Buat object collaboration untuk rule:

- high risk customer
- unpaid invoice > 30 hari
- manual override
- external fraud flag

Tentukan:

- domain object
- policy
- rule
- adapter external fraud
- use case
- result object
- test seam

### Latihan 3 — Cari god service

Ambil salah satu service besar di project nyata. Buat tabel:

| Method | Responsibility | State used | Side effect | Candidate collaborator |
|---|---|---|---|---|

Lalu pecah menjadi use case/policy/adapter/domain method.

### Latihan 4 — Decorator order

Desain chain untuk `DocumentStore` dengan:

- authorization
- cache
- metrics
- audit
- retry

Tentukan order aman dan jelaskan kenapa.

---

## 39. Ringkasan

Di bagian ini kita mempelajari:

- composition, aggregation, delegation, forwarding, wrapping, dan collaboration
- mengapa composition sering lebih aman daripada inheritance
- kapan composition bisa menjadi overengineering
- role object, policy object, strategy, decorator, adapter, facade, composite, chain, registry
- mixin-like design di Java
- object collaboration map
- dependency direction
- transaction boundary
- god service dan anemic object
- testability sebagai indikator desain
- hubungan composition dengan DI container, proxy, generated code, reflection, dan module boundary
- refactoring recipe dari inheritance/god service ke collaborating objects

Bagian ini menjadi jembatan dari OOP structural design ke bagian berikutnya: functional Java. Setelah memahami object collaboration, kita akan melihat kapan behavior lebih baik diekspresikan sebagai function, lambda, pure transformation, dan higher-order API.

---

## 40. Status Seri

Seri **belum selesai**.

Bagian yang sudah selesai:

- Part 000 — Orientation: Mental Model Besar Java Program Structure
- Part 001 — Java Type System Deep Dive
- Part 002 — Class Anatomy
- Part 003 — Object Identity, Equality, Hashing, Immutability
- Part 004 — Encapsulation Beyond `private`
- Part 005 — Inheritance Deep Dive
- Part 006 — Interfaces Deep Dive
- Part 007 — Sealed Classes and Controlled Hierarchies
- Part 008 — Records Deep Dive
- Part 009 — Enums as Type-Safe State, Strategy, Registry, and Domain Model
- Part 010 — Nested, Inner, Local, and Anonymous Classes
- Part 011 — Generics for API Designers
- Part 012 — Advanced Polymorphism
- Part 013 — Composition, Delegation, Mixins, and Object Collaboration Design

Berikutnya:

- Part 014 — Functional Java Mental Model: Functions, Effects, and Referential Transparency

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Advanced Polymorphism: Overloading, Overriding, Dispatch, and Pattern Matching](./learn-java-oop-functional-reflection-codegen-modules-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Functional Java Mental Model: Functions, Effects, and Referential Transparency](./learn-java-oop-functional-reflection-codegen-modules-part-014.md)
