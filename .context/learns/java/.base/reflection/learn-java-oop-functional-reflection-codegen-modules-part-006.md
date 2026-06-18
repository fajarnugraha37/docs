# learn-java-oop-functional-reflection-codegen-modules-part-006

# Interfaces Deep Dive: Contracts, Capabilities, Traits, Default Methods

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `006`  
> Topik: Java Interface sebagai contract, capability, role, SPI, functional boundary, default behavior, dan API evolution surface.

---

## 0. Tujuan Part Ini

Setelah bagian sebelumnya membahas inheritance, bagian ini membahas abstraksi yang lebih sering dipakai di Java modern: **interface**.

Banyak developer memahami interface sebagai:

```java
public interface PaymentService {
    PaymentResult pay(PaymentRequest request);
}
```

Lalu berhenti pada definisi sederhana:

> Interface adalah contract.

Itu benar, tetapi belum cukup untuk level desain sistem serius.

Di sistem nyata, interface juga bisa menjadi:

1. **type boundary** — batas antara caller dan implementation.
2. **capability marker** — menandakan objek bisa melakukan sesuatu.
3. **role type** — satu objek bisa memainkan beberapa peran.
4. **protocol** — urutan interaksi yang diharapkan.
5. **SPI** — extension point untuk plugin/framework/provider.
6. **functional target** — target lambda dan method reference.
7. **API evolution surface** — area yang berbahaya ketika library berubah.
8. **module boundary** — contract yang diekspor keluar module.
9. **testing seam** — titik substitusi dalam test.
10. **architectural dependency inversion mechanism** — cara high-level policy tidak bergantung pada low-level details.

Part ini bertujuan membangun mental model interface yang lebih presisi agar kamu bisa mendesain API Java yang stabil, modular, evolvable, dan tidak penuh abstraction noise.

---

## 1. Interface Bukan “Class Tanpa Implementasi”

Definisi dangkal yang sering dipakai:

> Interface adalah class yang hanya berisi method tanpa body.

Definisi itu sudah tidak akurat untuk Java modern.

Interface Java dapat memiliki:

- abstract methods
- default methods
- static methods
- private methods
- private static methods
- constants
- nested types
- sealed/non-sealed modifiers
- annotation interface form
- functional-interface role

Jadi interface bukan sekadar “class tanpa implementation”. Interface adalah **reference type khusus** yang mendefinisikan bentuk kemampuan, supertype umum, dan kontrak interaksi.

Oracle JLS menjelaskan bahwa interface declaration mendefinisikan interface baru yang bisa diimplementasikan oleh satu atau lebih class, menyediakan common supertype bagi class yang tidak harus berbagi abstract superclass.

Mental model yang lebih kuat:

> Class menjawab: “objek ini apa dan bagaimana ia dibangun?”  
> Interface menjawab: “objek ini bisa diperlakukan sebagai apa?”

Contoh:

```java
final class FileReportExporter implements ReportExporter, Closeable, NamedComponent {
    // one concrete object, multiple roles
}
```

Objek tersebut secara implementation adalah `FileReportExporter`, tetapi bisa dipandang sebagai:

- `ReportExporter`
- `Closeable`
- `NamedComponent`
- `Object`

Interface memungkinkan **multiple role typing** tanpa multiple inheritance of state.

---

## 2. Interface sebagai Role, Bukan Sekadar Abstraction Layer

Salah satu kesalahan umum adalah membuat interface untuk setiap class:

```java
public interface UserService {
    User findById(UserId id);
}

public class UserServiceImpl implements UserService {
    @Override
    public User findById(UserId id) {
        ...
    }
}
```

Ini sering dianggap “best practice”, padahal tidak selalu.

Pertanyaan yang lebih benar:

> Apakah ada lebih dari satu meaningful implementation, atau apakah caller benar-benar butuh bergantung pada role daripada concrete class?

Interface layak dibuat jika minimal salah satu kondisi berikut benar:

1. Ada beberapa implementation nyata.
2. Ada kebutuhan plugin/extension.
3. Ada boundary antar module/package/artifact.
4. Ada dependency inversion yang bermakna.
5. Ada need untuk testing seam yang tidak lebih baik diselesaikan dengan desain lain.
6. Ada domain role yang stabil walaupun implementation berubah.
7. Ada functional API yang menerima behavior dari caller.
8. Ada public library API yang harus tidak mengikat caller ke concrete implementation.

Interface tidak layak dibuat jika:

1. Hanya ada satu implementation dan tidak ada variasi nyata.
2. Nama interface hanya nama class tanpa `Impl`.
3. Interface hanya mirror method dari class.
4. Interface dibuat karena framework lama mensyaratkan proxy interface.
5. Interface memperbesar surface area tanpa memperjelas boundary.
6. Interface menyembunyikan domain model yang sebenarnya.

Buruk:

```java
public interface CustomerManager {
    void create(CustomerDto dto);
    void update(CustomerDto dto);
    void delete(String id);
    CustomerDto get(String id);
}

public class CustomerManagerImpl implements CustomerManager {
    ...
}
```

Lebih meaningful:

```java
public interface CustomerCreditPolicy {
    CreditDecision evaluate(CustomerSnapshot customer, Money requestedLimit);
}
```

Kenapa lebih baik?

Karena interface kedua merepresentasikan **role/decision boundary** yang memang bisa berubah:

- policy internal
- policy external vendor
- policy simulation
- policy test double
- policy per jurisdiction
- policy per product

Interface sebaiknya mewakili **variasi yang penting**, bukan sekadar formalitas.

---

## 3. Interface sebagai Contract: Apa yang Harus Dikontrakkan?

Interface contract bukan hanya method signature.

Method signature hanya menjelaskan:

- nama method
- parameter type
- return type
- checked exception
- type parameter
- visibility

Tetapi contract sebenarnya juga mencakup:

1. precondition
2. postcondition
3. invariant
4. nullability rule
5. exception rule
6. idempotency rule
7. ordering guarantee
8. thread-safety expectation
9. performance expectation
10. ownership of returned object
11. lifecycle expectation
12. side-effect expectation
13. blocking/non-blocking behavior
14. retry safety
15. compatibility expectation

Contoh signature yang miskin contract:

```java
public interface DocumentStore {
    Document save(Document document);
}
```

Pertanyaan yang belum dijawab:

- Apakah `document` boleh null?
- Apakah `save` create atau update?
- Apakah id generated?
- Apakah return object sama reference-nya atau copy?
- Apakah method idempotent?
- Apakah save blocking?
- Apakah method transactional?
- Apakah version conflict dilempar exception?
- Apakah document content disalin defensively?
- Apakah metadata akan dimutasi?
- Apakah implementation boleh cache?

Contract yang lebih jelas:

```java
public interface DocumentStore {
    /**
     * Persists a new document and returns the stored representation.
     *
     * Preconditions:
     * - command must not be null.
     * - command.content() must not be empty.
     * - command.ownerId() must refer to an existing owner.
     *
     * Postconditions:
     * - returned document has a generated id.
     * - returned version starts at 1.
     * - command is never mutated.
     *
     * Failure:
     * - throws DuplicateDocumentException if idempotency key was already used
     *   for a different payload.
     * - throws OwnerNotFoundException if owner does not exist.
     */
    StoredDocument create(CreateDocumentCommand command);
}
```

Signature tetap penting, tetapi **semantic contract** yang menentukan apakah implementation bisa disubstitusi dengan aman.

---

## 4. Interface dan LSP: Substitutability Tetap Berlaku

Interface sering dianggap lebih aman daripada inheritance. Itu separuh benar.

Interface menghindari inheritance of state, tetapi tetap tunduk pada substitutability.

Jika caller menerima:

```java
void process(PaymentGateway gateway) {
    gateway.charge(...);
}
```

Maka semua implementation `PaymentGateway` harus bisa dipakai tanpa caller perlu tahu detail implementation.

Buruk:

```java
public interface PaymentGateway {
    PaymentReceipt charge(ChargeCommand command);
}

public final class SandboxPaymentGateway implements PaymentGateway {
    @Override
    public PaymentReceipt charge(ChargeCommand command) {
        return PaymentReceipt.fake();
    }
}

public final class ManualPaymentGateway implements PaymentGateway {
    @Override
    public PaymentReceipt charge(ChargeCommand command) {
        throw new UnsupportedOperationException("Manual payment cannot charge directly");
    }
}
```

`ManualPaymentGateway` melanggar contract jika `charge` adalah kemampuan wajib.

Solusi desain:

```java
public interface ChargeCapableGateway {
    PaymentReceipt charge(ChargeCommand command);
}

public interface ManualPaymentInstructionGateway {
    PaymentInstruction createInstruction(PaymentInstructionCommand command);
}
```

Atau gunakan sealed hierarchy jika domain memang finite:

```java
public sealed interface PaymentRoute
        permits DirectChargeRoute, ManualInstructionRoute {
}

public record DirectChargeRoute(ChargeCapableGateway gateway) implements PaymentRoute {
}

public record ManualInstructionRoute(ManualPaymentInstructionGateway gateway) implements PaymentRoute {
}
```

Rule penting:

> Jangan menaruh method di interface jika tidak semua implementation mampu memenuhi semantic contract method itu.

Ini alasan interface besar sering menjadi sumber `UnsupportedOperationException`.

---

## 5. Interface sebagai Capability

Capability interface mendefinisikan kemampuan kecil dan spesifik.

Contoh dari JDK:

```java
AutoCloseable
Closeable
Comparable<T>
Iterable<T>
Serializable
Cloneable
Runnable
```

Beberapa adalah capability behavior (`AutoCloseable`, `Iterable`), beberapa historis/marker (`Serializable`, `Cloneable`).

Contoh domain:

```java
public interface Auditable {
    AuditMetadata auditMetadata();
}

public interface Versioned {
    Version version();
}

public interface Expirable {
    boolean isExpired(Instant now);
}
```

Capability interface baik ketika:

1. kecil
2. stabil
3. orthogonal
4. bisa dikombinasikan
5. tidak memaksakan lifecycle besar
6. memiliki semantic contract jelas

Contoh penggunaan:

```java
public final class AuditRenderer {
    public AuditLine render(Auditable auditable) {
        AuditMetadata metadata = auditable.auditMetadata();
        return new AuditLine(metadata.actor(), metadata.timestamp(), metadata.action());
    }
}
```

`AuditRenderer` tidak peduli concrete class. Ia hanya peduli objek tersebut auditable.

Tetapi capability interface juga bisa disalahgunakan.

Buruk:

```java
public interface Processable {
    void process();
}
```

Terlalu umum. Tidak jelas:

- process apa?
- input apa?
- output apa?
- idempotent atau tidak?
- sync atau async?
- failure-nya bagaimana?

Lebih baik:

```java
public interface CaseEscalationPolicy {
    EscalationDecision evaluate(CaseSnapshot snapshot, Instant now);
}
```

---

## 6. Interface sebagai Protocol

Kadang interface bukan hanya satu method, tetapi menggambarkan protocol interaksi.

Contoh:

```java
public interface BatchWriter<T> extends AutoCloseable {
    void beginBatch();
    void write(T item);
    BatchResult commit();
    void rollback();
}
```

Masalahnya, interface ini mengandung state machine tersembunyi.

Urutan valid:

```text
NEW -> beginBatch -> OPEN -> write* -> commit -> COMMITTED
                         \-> rollback -> ROLLED_BACK
```

Urutan invalid:

```java
writer.write(item);      // before beginBatch
writer.commit();         // before beginBatch
writer.write(item);      // after commit
writer.commit();         // twice
```

Jika interface punya protocol, jangan biarkan protocol hanya hidup di kepala developer. Representasikan secara eksplisit.

Opsi 1: dokumentasi contract kuat.

```java
public interface BatchWriter<T> extends AutoCloseable {
    /** Must be called exactly once before write/commit. */
    void beginBatch();

    /** Valid only after beginBatch and before commit/rollback. */
    void write(T item);

    /** Valid only after beginBatch. Terminal operation. */
    BatchResult commit();

    /** Terminal operation. Safe to call if beginBatch succeeded. */
    void rollback();
}
```

Opsi 2: type-state style.

```java
public interface BatchWriter<T> {
    OpenBatch<T> beginBatch();
}

public interface OpenBatch<T> {
    void write(T item);
    BatchResult commit();
    void rollback();
}
```

Dengan type-state style, caller tidak bisa `write` sebelum `beginBatch`, karena method `write` hanya ada di `OpenBatch`.

Pemahaman penting:

> Interface dengan banyak method sering menyembunyikan lifecycle/state machine. Jika lifecycle penting, jadikan lifecycle terlihat di type model.

---

## 7. Interface sebagai SPI

SPI berarti **Service Provider Interface**.

Bedanya API dan SPI:

- API dipakai oleh consumer.
- SPI diimplementasikan oleh provider.

Contoh API:

```java
public interface ReportService {
    Report generate(ReportCommand command);
}
```

Contoh SPI:

```java
public interface ReportFormatProvider {
    String formatCode();
    ReportRenderer createRenderer(ReportRendererContext context);
}
```

Caller biasa tidak mengimplementasikan `ReportService`, tetapi plugin/vendor/internal extension bisa mengimplementasikan `ReportFormatProvider`.

SPI butuh desain lebih hati-hati karena implementation mungkin berada di luar kontrol library owner.

SPI contract harus menjelaskan:

1. kapan object dibuat
2. apakah instance reusable
3. apakah thread-safe wajib
4. apakah method boleh blocking
5. exception apa yang boleh dilempar
6. apakah provider boleh menyimpan context
7. compatibility rule antar versi
8. apakah provider di-load via ServiceLoader/reflection/DI
9. apakah provider boleh punya dependency eksternal
10. apakah provider boleh melakukan I/O saat construction

Contoh SPI lebih matang:

```java
public interface DocumentClassifierProvider {
    /**
     * Stable provider id. Must be unique within one runtime.
     */
    String providerId();

    /**
     * Creates a classifier for one tenant context.
     *
     * Implementations must not retain mutable references to the context.
     * Returned classifier must be thread-safe.
     */
    DocumentClassifier create(DocumentClassifierContext context);
}
```

Jangan mencampur API dan SPI sembarangan.

Buruk:

```java
public interface DocumentService {
    Document get(DocumentId id);
    void save(Document doc);
    void beforeSave(Document doc); // SPI-ish hook mixed into API
}
```

Lebih baik:

```java
public interface DocumentService {
    Document get(DocumentId id);
    StoredDocument save(SaveDocumentCommand command);
}

public interface DocumentSaveInterceptor {
    void beforeSave(DocumentSaveContext context);
}
```

---

## 8. Interface Segregation: Kecil Bukan Berarti Terpecah Random

Interface Segregation Principle sering dipahami sebagai:

> Buat interface sekecil mungkin.

Lebih tepat:

> Caller tidak boleh dipaksa bergantung pada kemampuan yang tidak mereka gunakan.

Contoh buruk:

```java
public interface CaseRepository {
    Case get(CaseId id);
    void save(Case kase);
    void delete(CaseId id);
    List<Case> search(CaseSearchCriteria criteria);
    void archive(CaseId id);
    void restore(CaseId id);
    AuditTrail auditTrail(CaseId id);
    List<Case> exportAll();
}
```

Masalah:

- terlalu banyak responsibility
- caller kecil bergantung pada operasi besar
- implementation harus menyediakan semua method
- test double menjadi berat
- permission boundary kabur
- lifecycle boundary kabur

Lebih baik berdasarkan role:

```java
public interface CaseLookup {
    CaseView get(CaseId id);
}

public interface CaseSearch {
    SearchResult<CaseSummary> search(CaseSearchQuery query);
}

public interface CaseCommandHandler {
    CaseCommandResult handle(CaseCommand command);
}

public interface CaseArchivePort {
    ArchiveResult archive(CaseId id, ArchiveReason reason);
    RestoreResult restore(CaseId id, RestoreReason reason);
}
```

Tetapi terlalu kecil juga bisa buruk.

Buruk:

```java
public interface IdGetter {
    String getId();
}

public interface NameGetter {
    String getName();
}

public interface StatusGetter {
    String getStatus();
}
```

Ini fragmentasi tanpa model.

Rule praktis:

> Interface yang baik kecil karena role-nya tajam, bukan kecil karena dipecah mekanis per method.

---

## 9. Marker Interface: Kapan Masih Masuk Akal?

Marker interface adalah interface tanpa method.

Contoh klasik:

```java
Serializable
Cloneable
RandomAccess
```

Marker interface memberi signal type-level:

```java
if (object instanceof Serializable) {
    ...
}
```

Tetapi Java modern punya annotation. Jadi kapan marker interface masih masuk akal?

Marker interface masuk akal jika:

1. marker perlu dipakai sebagai type bound.
2. marker perlu dicek dengan `instanceof` secara type-safe.
3. marker merepresentasikan capability yang memengaruhi overload/resolution API.
4. marker harus inherited melalui type hierarchy.
5. marker menjadi bagian dari type relationship, bukan sekadar metadata.

Contoh:

```java
public interface DomainEvent {
}

public interface IntegrationEvent extends DomainEvent {
}

public final class EventPublisher {
    public <E extends DomainEvent> void publish(E event) {
        ...
    }
}
```

Annotation lebih cocok jika metadata tidak perlu menjadi type:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface ExportableEvent {
    String topic();
}
```

Perbandingan:

| Kebutuhan | Marker Interface | Annotation |
|---|---:|---:|
| Bisa jadi generic bound | Ya | Tidak langsung |
| Bisa `instanceof` | Ya | Via reflection |
| Bisa membawa metadata | Tidak | Ya |
| Cocok untuk runtime scanning | Terbatas | Ya |
| Cocok untuk type-level capability | Ya | Kadang |
| Cocok untuk config/framework metadata | Kurang | Ya |

Anti-pattern:

```java
public interface Important {
}

public interface Processed {
}

public interface Validated {
}
```

Kalau marker hanya status runtime yang bisa berubah, lebih baik jadikan state eksplisit di object model, bukan interface.

---

## 10. Default Methods: Evolution Tool, Bukan Tempat Business Logic Besar

Sejak Java 8, interface bisa punya default method.

Contoh:

```java
public interface CaseView {
    CaseId id();
    CaseStatus status();

    default boolean isClosed() {
        return status().isTerminal();
    }
}
```

Default method berguna untuk:

1. menambahkan method baru tanpa memaksa semua implementer langsung berubah
2. menyediakan behavior kecil berbasis abstract methods
3. menyediakan convenience method
4. menghindari duplikasi kecil antar implementation
5. mendukung interface evolution

Tetapi default method juga berbahaya jika dipakai sebagai inheritance of behavior besar.

Buruk:

```java
public interface CaseWorkflow {
    CaseRepository repository();
    NotificationService notificationService();
    AuditService auditService();

    default void approve(CaseId id, UserId approver) {
        Case kase = repository().get(id);
        kase.approve(approver);
        repository().save(kase);
        notificationService().notifyApproval(kase);
        auditService().recordApproval(kase, approver);
    }
}
```

Ini interface berubah menjadi pseudo-abstract-class tanpa state eksplisit.

Masalah:

- dependency tersembunyi
- test sulit
- logic tersebar
- lifecycle tidak jelas
- implementation bisa override sebagian
- binary evolution makin rumit
- behavior besar berada di tempat yang tidak obvious

Lebih baik:

```java
public interface CaseApprovalPolicy {
    ApprovalDecision evaluate(CaseSnapshot snapshot, UserContext user);
}

public final class CaseApprovalService {
    private final CaseRepository repository;
    private final CaseApprovalPolicy policy;
    private final NotificationService notificationService;
    private final AuditService auditService;

    public ApprovalResult approve(ApproveCaseCommand command) {
        ...
    }
}
```

Rule:

> Default method sebaiknya kecil, deterministic, berbasis method lain di interface, dan tidak menyembunyikan dependency besar.

Contoh default method yang sehat:

```java
public interface MoneyFormatter {
    String format(Money money, Locale locale);

    default String formatDefaultLocale(Money money) {
        return format(money, Locale.getDefault());
    }
}
```

Contoh lain:

```java
public interface Versioned {
    Version version();

    default boolean isNewerThan(Version other) {
        return version().compareTo(other) > 0;
    }
}
```

---

## 11. Default Method Conflict Resolution

Default methods membuat multiple inheritance of behavior terbatas. Karena satu class bisa implement banyak interface, conflict bisa terjadi.

Contoh:

```java
interface A {
    default String name() {
        return "A";
    }
}

interface B {
    default String name() {
        return "B";
    }
}

class C implements A, B {
    @Override
    public String name() {
        return A.super.name();
    }
}
```

Jika `C` tidak override `name`, compile error karena ambigu.

Rule umum:

1. Class method menang atas interface default method.
2. Interface yang lebih spesifik menang atas interface yang lebih umum.
3. Jika dua default method tidak punya hubungan spesifik, implementing class harus override.

Contoh class wins:

```java
class Base {
    public String label() {
        return "base";
    }
}

interface Labeled {
    default String label() {
        return "interface";
    }
}

class Child extends Base implements Labeled {
}

// new Child().label() -> "base"
```

Implikasi desain:

- Jangan membuat default method dengan nama terlalu generik di interface yang mungkin dikombinasikan.
- Hindari default method besar pada capability interface populer.
- Hati-hati menambahkan default method ke public interface yang sudah banyak diimplementasikan.

---

## 12. Static Methods di Interface

Interface bisa punya static method.

Contoh:

```java
public interface CaseIds {
    static CaseId parse(String raw) {
        return new CaseId(UUID.fromString(raw));
    }

    static CaseId random() {
        return new CaseId(UUID.randomUUID());
    }
}
```

Tetapi static method di interface tidak diwariskan sebagai instance behavior.

Ia dipanggil lewat interface name:

```java
CaseId id = CaseIds.parse(raw);
```

Kapan berguna?

1. factory/helper kecil yang sangat terkait dengan interface
2. utility untuk functional interface
3. constants/factory grouping
4. menghindari utility class tambahan jika concept memang melekat ke interface

Contoh JDK-style:

```java
Comparator.comparing(...)
Predicate.not(...)
```

Namun jangan membuat interface menjadi utility dump.

Buruk:

```java
public interface UserService {
    User find(UserId id);

    static boolean isValidEmail(String email) { ... }
    static String normalizeName(String name) { ... }
    static UserDto toDto(User user) { ... }
    static User fromDto(UserDto dto) { ... }
}
```

Ini mencampur service contract dengan utility unrelated.

---

## 13. Private Methods di Interface

Java 9 menambahkan private methods di interface. Tujuannya: memungkinkan code sharing antar default/static methods tanpa mengekspos helper sebagai public API.

Contoh:

```java
public interface CaseStatusView {
    CaseStatus status();
    Instant updatedAt();

    default boolean isTerminal() {
        return terminalStatuses().contains(status());
    }

    default boolean isTerminalForMoreThan(Duration duration, Instant now) {
        return isTerminal() && updatedAt().plus(duration).isBefore(now);
    }

    private Set<CaseStatus> terminalStatuses() {
        return EnumSet.of(CaseStatus.CLOSED, CaseStatus.REJECTED, CaseStatus.WITHDRAWN);
    }
}
```

Private interface method baik untuk:

- mengurangi duplikasi antar default methods
- menjaga helper tidak menjadi API publik
- menjaga interface evolution lebih bersih

Tetapi jika private method mulai banyak, itu sinyal interface mungkin berubah menjadi class tersembunyi.

Warning sign:

```text
Interface has:
- 5 abstract methods
- 12 default methods
- 8 private helper methods
- business workflow logic
- dependency lookup
```

Ini biasanya smell.

---

## 14. Constants di Interface: Hindari Constant Interface Anti-Pattern

Semua field di interface secara implisit adalah:

```java
public static final
```

Contoh:

```java
public interface HttpConstants {
    String HEADER_CORRELATION_ID = "X-Correlation-Id";
}
```

Masalahnya muncul ketika class mengimplementasikan interface hanya untuk mendapatkan constants:

```java
public class AuditClient implements HttpConstants {
    public void send() {
        use(HEADER_CORRELATION_ID);
    }
}
```

Ini anti-pattern karena:

1. implementation relationship palsu
2. public API class tercemar constants
3. constants menjadi inherited member
4. menggangu readability
5. binary compatibility hazard jika constants berubah

Lebih baik:

```java
public final class HttpHeadersEx {
    private HttpHeadersEx() {
    }

    public static final String CORRELATION_ID = "X-Correlation-Id";
}
```

Atau domain-specific type:

```java
public enum StandardHeader {
    CORRELATION_ID("X-Correlation-Id"),
    REQUEST_ID("X-Request-Id");

    private final String wireName;

    StandardHeader(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }
}
```

Rule:

> Jangan implement interface hanya untuk mewarisi constants.

---

## 15. Functional Interface: Interface sebagai Target Lambda

Functional interface adalah interface dengan tepat satu abstract method secara konseptual.

Contoh:

```java
@FunctionalInterface
public interface CaseValidator {
    ValidationResult validate(CaseDraft draft);
}
```

Bisa dipakai dengan lambda:

```java
CaseValidator validator = draft -> {
    if (draft.title().isBlank()) {
        return ValidationResult.invalid("title is required");
    }
    return ValidationResult.valid();
};
```

Default methods tidak dihitung sebagai abstract method.

Contoh valid:

```java
@FunctionalInterface
public interface CaseRule {
    RuleDecision evaluate(CaseSnapshot snapshot);

    default CaseRule and(CaseRule other) {
        return snapshot -> this.evaluate(snapshot).and(other.evaluate(snapshot));
    }
}
```

Kenapa `@FunctionalInterface` penting?

Karena annotation itu memberi compile-time guard agar interface tidak tidak sengaja kehilangan status functional interface saat method abstract baru ditambah.

Tanpa annotation:

```java
public interface CaseRule {
    RuleDecision evaluate(CaseSnapshot snapshot);

    // later someone adds:
    String name();
}
```

Semua lambda assignment bisa rusak.

Dengan annotation, compiler akan menolak perubahan yang merusak SAM contract.

Functional interface cocok untuk:

1. policy kecil
2. rule kecil
3. callback
4. transformation
5. predicate
6. factory
7. extension hook sederhana
8. behavior injection

Functional interface kurang cocok untuk:

1. lifecycle kompleks
2. multi-step protocol
3. banyak dependency
4. operation yang butuh banyak method terkait
5. contract besar yang butuh object identity/lifecycle

---

## 16. SAM, Lambda, dan Nama Method

SAM berarti Single Abstract Method.

Nama method di functional interface tetap penting.

Buruk:

```java
@FunctionalInterface
public interface Handler<T> {
    void handle(T value);
}
```

Kadang terlalu umum.

Lebih expressive:

```java
@FunctionalInterface
public interface CaseAssignmentPolicy {
    Assignee selectAssignee(CaseSnapshot snapshot, AssignmentContext context);
}
```

Lambda di caller menjadi lebih jelas:

```java
CaseAssignmentPolicy leastLoadedOfficer = (snapshot, context) ->
        context.availableOfficers().stream()
                .min(comparing(OfficerLoad::openCases))
                .map(Assignee::of)
                .orElse(Assignee.unassigned());
```

Generic JDK functional interface seperti `Function`, `Predicate`, `Consumer`, `Supplier` bagus untuk local/simple API.

Contoh:

```java
List<CaseSummary> summaries = cases.stream()
        .filter(Case::isOpen)
        .map(CaseSummary::from)
        .toList();
```

Tetapi public domain API sering lebih baik memakai named functional interface.

Bandingkan:

```java
public void register(Function<CaseSnapshot, Boolean> rule) { ... }
```

Dengan:

```java
public void register(CaseEligibilityRule rule) { ... }

@FunctionalInterface
public interface CaseEligibilityRule {
    boolean isEligible(CaseSnapshot snapshot);
}
```

Named interface memberi:

- domain semantics
- Javadoc place
- future default methods
- better error message
- stronger API readability

---

## 17. Interface Evolution: Menambah Method Tidak Selalu Aman

Public interface adalah contract. Mengubahnya berarti mengubah kewajiban implementer.

Misal versi 1:

```java
public interface NotificationSender {
    void send(Notification notification);
}
```

Versi 2 menambahkan abstract method:

```java
public interface NotificationSender {
    void send(Notification notification);
    boolean supports(NotificationChannel channel);
}
```

Source compatibility rusak: semua implementer harus menambah method.

Binary compatibility lebih nuanced, tetapi risiko runtime tetap ada jika class lama dipakai dengan interface baru lalu method baru dipanggil.

Default method bisa membantu:

```java
public interface NotificationSender {
    void send(Notification notification);

    default boolean supports(NotificationChannel channel) {
        return true;
    }
}
```

Tetapi default method bukan solusi universal.

Risiko default method:

1. default behavior mungkin salah untuk sebagian implementation
2. caller menganggap capability ada padahal tidak
3. method name bisa conflict dengan existing methods
4. semantic contract menjadi lemah
5. default method bisa menyembunyikan breaking behavioral change

Alternatif evolusi:

### Opsi 1: Sub-interface

```java
public interface NotificationSender {
    void send(Notification notification);
}

public interface ChannelAwareNotificationSender extends NotificationSender {
    boolean supports(NotificationChannel channel);
}
```

Caller bisa cek:

```java
if (sender instanceof ChannelAwareNotificationSender channelAware
        && !channelAware.supports(channel)) {
    ...
}
```

### Opsi 2: Capability object

```java
public interface NotificationSender {
    void send(Notification notification);
    SenderCapabilities capabilities();
}
```

### Opsi 3: New interface version

```java
public interface NotificationSenderV2 {
    SendResult send(SendCommand command);
    boolean supports(NotificationChannel channel);
}
```

### Opsi 4: Adapter

```java
public final class LegacyNotificationSenderAdapter implements NotificationSenderV2 {
    private final NotificationSender legacy;

    @Override
    public SendResult send(SendCommand command) {
        legacy.send(command.notification());
        return SendResult.accepted();
    }

    @Override
    public boolean supports(NotificationChannel channel) {
        return true;
    }
}
```

Rule:

> Interface public jauh lebih mahal untuk diubah daripada class internal.

---

## 18. Default Methods dan Binary Compatibility: Jangan Terlalu Percaya “Aman”

Default method diperkenalkan salah satunya untuk membantu evolusi interface, terutama agar interface lama bisa ditambah method tanpa semua implementer langsung rusak.

Tetapi ada edge case.

Misal library v1:

```java
public interface A {
}

public interface B {
}

public class C implements A, B {
}
```

Library v2:

```java
public interface A {
    default String name() { return "A"; }
}

public interface B {
    default String name() { return "B"; }
}
```

`C` lama sekarang menghadapi conflict jika method dipanggil/di-resolve. Ini bisa menyebabkan problem linkage/compile tergantung scenario.

Selain itu, jika implementer sudah punya method dengan signature sama tetapi semantic berbeda, default method bisa menciptakan accidental override.

Contoh:

```java
public interface Exportable {
    default String format() {
        return "json";
    }
}

public final class LegacyReport implements Exportable {
    public String format() {
        return "A4"; // meant paper format, not serialization format
    }
}
```

Secara signature match, tetapi semantic clash.

Pelajaran:

> Menambahkan default method ke interface publik tetap perlu API review serius.

Checklist sebelum menambah default method:

1. Apakah nama method terlalu generik?
2. Apakah kemungkinan ada implementer dengan method sama tapi semantic beda?
3. Apakah default behavior benar untuk mayoritas implementation?
4. Apakah default behavior bisa silently wrong?
5. Apakah sub-interface lebih aman?
6. Apakah method sebaiknya ada di utility/helper terpisah?
7. Apakah method memperbesar contract tanpa kebutuhan jelas?
8. Apakah method membuat interface menjadi fat?

---

## 19. Interface vs Abstract Class

Perbandingan sederhana:

| Aspek | Interface | Abstract Class |
|---|---|---|
| Multiple inheritance | Bisa implement banyak interface | Hanya extend satu class |
| State instance | Tidak punya instance field | Bisa punya instance field |
| Constructor | Tidak ada constructor instance | Bisa punya constructor |
| Default behavior | Bisa via default method | Bisa via concrete/protected method |
| Access to state | Tidak langsung | Langsung |
| Role/capability | Sangat cocok | Kurang cocok |
| Implementation sharing besar | Kurang cocok | Lebih cocok |
| API evolution | Sulit tapi default method membantu | Juga sulit, tapi bisa tambah concrete method |
| Framework proxy | Interface proxy mudah | Class proxy butuh subclass/bytecode |

Gunakan interface jika:

1. ingin mendefinisikan role/capability
2. implementation tidak harus berbagi state
3. satu class bisa punya banyak role
4. contract lebih penting daripada reusable base implementation
5. boundary antar module/package/artifact
6. extension point untuk provider

Gunakan abstract class jika:

1. implementation sharing berbasis state memang penting
2. ada invariant construction bersama
3. ada protected helper yang hanya masuk akal untuk subclass
4. hierarchy controlled
5. ingin template method dengan state internal

Tetapi hati-hati: abstract class membawa risiko inheritance dari Part 005.

Sering kali pilihan terbaik adalah:

```java
public interface TokenVerifier {
    VerificationResult verify(Token token);
}

public final class JwtTokenVerifier implements TokenVerifier {
    private final JwtParser parser;
    private final Clock clock;

    @Override
    public VerificationResult verify(Token token) {
        ...
    }
}
```

Bukan:

```java
public abstract class AbstractTokenVerifier {
    protected JwtParser parser;
    protected Clock clock;
    ...
}
```

---

## 20. Interface dan Dependency Inversion

Dependency inversion sering diringkas menjadi:

> Depend on abstractions, not concretions.

Namun bukan berarti semua concrete class harus punya interface.

Dependency inversion yang sehat:

```java
public final class CaseEscalationService {
    private final CaseRepository caseRepository;
    private final EscalationPolicy escalationPolicy;
    private final NotificationPort notificationPort;

    public EscalationResult evaluate(CaseId id) {
        ...
    }
}
```

Interface di sini punya makna:

- `CaseRepository` = persistence boundary
- `EscalationPolicy` = decision boundary
- `NotificationPort` = external system boundary

Interface yang tidak sehat:

```java
public interface CaseEscalationServiceInterface {
    EscalationResult evaluate(CaseId id);
}

public class CaseEscalationServiceImpl implements CaseEscalationServiceInterface {
    ...
}
```

Kalau service tersebut tidak punya variasi implementation dan bukan public module boundary, interface mungkin hanya noise.

Rule:

> Buat interface di sisi policy boundary, external boundary, dan variation point; bukan sebagai ritual untuk setiap class.

---

## 21. Interface Placement: Siapa yang Memiliki Interface?

Pertanyaan penting:

> Interface sebaiknya diletakkan di package caller atau package implementation?

Dalam dependency inversion, interface sering lebih baik dimiliki oleh layer/domain yang membutuhkan capability, bukan oleh adapter yang menyediakannya.

Buruk:

```text
infrastructure/email/
  EmailClient.java         // interface
  SmtpEmailClient.java     // implementation

domain/case/
  CaseEscalationService.java -> depends on infrastructure.email.EmailClient
```

Domain tetap bergantung ke infrastructure package.

Lebih baik:

```text
domain/case/
  CaseEscalationService.java
  NotificationPort.java

infrastructure/email/
  SmtpNotificationAdapter.java implements NotificationPort
```

`NotificationPort` dimiliki oleh use case/domain karena domain yang mendefinisikan apa yang ia butuhkan.

Tetapi untuk public library, interface bisa dimiliki oleh library API package:

```text
com.acme.report.api/
  ReportRenderer.java
  ReportFormatProvider.java

com.acme.report.internal/
  PdfReportRenderer.java
```

Rule:

> Interface location harus mengikuti arah dependency yang diinginkan, bukan lokasi implementation.

---

## 22. Interface dan Package-Private Implementation

Interface sering dipakai untuk menyembunyikan implementation.

Contoh:

```java
package com.acme.caseflow.api;

public interface CaseWorkflowEngine {
    WorkflowResult handle(WorkflowCommand command);
}
```

Implementation:

```java
package com.acme.caseflow.internal;

final class DefaultCaseWorkflowEngine implements CaseWorkflowEngine {
    ...
}
```

Factory:

```java
package com.acme.caseflow.api;

public final class CaseWorkflowEngines {
    private CaseWorkflowEngines() {
    }

    public static CaseWorkflowEngine create(CaseWorkflowEngineConfig config) {
        return new DefaultCaseWorkflowEngine(...);
    }
}
```

Public API mengekspos interface, bukan class internal.

Manfaat:

1. implementation bisa berubah tanpa mengubah caller
2. internal dependency tidak bocor
3. testing bisa pakai alternative implementation
4. module exports bisa lebih kecil
5. binary compatibility lebih terkendali

Dengan JPMS, ini makin kuat:

```java
module com.acme.caseflow {
    exports com.acme.caseflow.api;
    // internal package not exported
}
```

Public interface menjadi module contract.

---

## 23. Interface dan JPMS: Exports vs Opens

Dalam module system, interface sering berada di package yang diekspor.

```java
module com.acme.notification {
    exports com.acme.notification.api;
}
```

Interface:

```java
package com.acme.notification.api;

public interface NotificationSender {
    SendResult send(SendCommand command);
}
```

Implementation internal:

```java
package com.acme.notification.internal;

final class SmtpNotificationSender implements NotificationSender {
    ...
}
```

Tidak diekspor.

Ini berarti module lain bisa melihat `NotificationSender`, tetapi tidak bisa melihat `SmtpNotificationSender`.

JPMS memperkuat encapsulation package-level. Tetapi reflection/framework bisa butuh access.

Jika framework butuh reflective access, gunakan `opens`, bukan sembarang `exports`.

```java
module com.acme.notification {
    exports com.acme.notification.api;
    opens com.acme.notification.internal to some.framework;
}
```

Rule:

- `exports` = compile-time/public API visibility.
- `opens` = reflective access.
- Interface public biasanya diekspor.
- Implementation internal sebaiknya tidak diekspor.
- Jangan membuka semua package hanya karena framework convenience.

---

## 24. Interface dan ServiceLoader

Java menyediakan `ServiceLoader` untuk menemukan service provider.

SPI interface:

```java
package com.acme.document.spi;

public interface DocumentParserProvider {
    String format();
    DocumentParser createParser(ParserConfig config);
}
```

Provider:

```java
package com.acme.document.pdf;

public final class PdfDocumentParserProvider implements DocumentParserProvider {
    @Override
    public String format() {
        return "pdf";
    }

    @Override
    public DocumentParser createParser(ParserConfig config) {
        return new PdfDocumentParser(config);
    }
}
```

Dengan JPMS:

```java
module com.acme.document.api {
    exports com.acme.document.spi;
}

module com.acme.document.pdf {
    requires com.acme.document.api;
    provides com.acme.document.spi.DocumentParserProvider
        with com.acme.document.pdf.PdfDocumentParserProvider;
}

module com.acme.document.runtime {
    requires com.acme.document.api;
    uses com.acme.document.spi.DocumentParserProvider;
}
```

Runtime:

```java
ServiceLoader<DocumentParserProvider> providers =
        ServiceLoader.load(DocumentParserProvider.class);

for (DocumentParserProvider provider : providers) {
    registry.register(provider.format(), provider.createParser(config));
}
```

SPI dengan ServiceLoader cocok untuk:

- plugin architecture
- provider discovery
- optional capabilities
- modular extension
- driver-style architecture

Tetapi ada trade-off:

1. discovery implicit
2. startup cost
3. error handling perlu jelas
4. provider ordering perlu didefinisikan
5. duplicate provider perlu ditangani
6. lifecycle provider harus jelas
7. dependency conflict tetap mungkin

---

## 25. Interface dan Dynamic Proxy

JDK dynamic proxy bekerja berbasis interface.

Contoh konsep:

```java
public interface AuditService {
    void record(AuditEvent event);
}
```

Proxy bisa dibuat untuk intercept method call:

```java
AuditService proxy = (AuditService) Proxy.newProxyInstance(
        AuditService.class.getClassLoader(),
        new Class<?>[] { AuditService.class },
        (object, method, args) -> {
            long start = System.nanoTime();
            try {
                return method.invoke(realAuditService, args);
            } finally {
                long elapsed = System.nanoTime() - start;
                metrics.record(method.getName(), elapsed);
            }
        }
);
```

Karena proxy ini interface-based, desain interface memengaruhi framework capability.

Implication:

- Interface kecil lebih mudah di-proxy.
- Final class tidak masalah jika caller bergantung pada interface.
- Method `equals`, `hashCode`, `toString` perlu dipikirkan di proxy.
- Default method invocation pada proxy punya detail khusus.
- Exception wrapping bisa membingungkan.

Framework DI/AOP sering memakai interface/class proxy. Jika boundary kamu interface-based, interception lebih sederhana.

Tetapi jangan membuat interface hanya karena “mungkin nanti proxy”. Buat interface jika boundary-nya meaningful.

---

## 26. Interface dan Testing

Interface memudahkan test double:

```java
final class FakeNotificationPort implements NotificationPort {
    private final List<Notification> sent = new ArrayList<>();

    @Override
    public void send(Notification notification) {
        sent.add(notification);
    }

    List<Notification> sent() {
        return List.copyOf(sent);
    }
}
```

Tetapi testability bukan alasan tunggal untuk membuat interface. Java modern mocking framework bisa mock class tertentu juga, dan sering lebih baik menggunakan fake object untuk boundary nyata.

Interface testing seam sehat ketika:

1. boundary memang external/slow/non-deterministic
2. fake implementation merepresentasikan behavior nyata
3. interface contract kecil
4. test tidak over-mock internal implementation
5. interface tidak dibuat hanya untuk mock private detail

Buruk:

```java
public interface DateTimeProvider {
    Instant now();
}
```

Ini tidak selalu buruk, tetapi Java sudah punya `Clock`.

Lebih baik:

```java
public final class CaseExpiryPolicy {
    private final Clock clock;

    public boolean isExpired(CaseDeadline deadline) {
        return clock.instant().isAfter(deadline.value());
    }
}
```

Gunakan interface jika ada domain role. Gunakan existing abstraction jika JDK sudah menyediakan.

---

## 27. Interface Naming: Hindari Nama Abstrak yang Kosong

Nama interface harus menjelaskan role.

Buruk:

```java
Processor
Handler
Manager
Helper
Service
Executor
Operation
Logic
Base
Common
```

Nama-nama ini kadang valid, tetapi sering terlalu luas.

Lebih baik:

```java
CaseEscalationPolicy
DocumentRetentionRule
NotificationSender
AuditEventPublisher
OfficerAssignmentStrategy
PostalAddressResolver
DuplicateCaseDetector
DocumentChecksumCalculator
```

Suffix yang umum:

| Suffix | Makna Umum |
|---|---|
| `Policy` | decision rule |
| `Strategy` | interchangeable algorithm |
| `Port` | boundary keluar dari domain/use case |
| `Provider` | menyediakan instance/data/capability |
| `Factory` | membuat object |
| `Resolver` | menemukan/memutuskan value berdasarkan input |
| `Mapper` | transformasi antar model |
| `Validator` | validasi dan error report |
| `Listener` | menerima event/callback |
| `Publisher` | menerbitkan event/message |
| `Repository` | collection-like persistence abstraction |
| `Gateway` | external system boundary |
| `Client` | client ke service/protocol tertentu |
| `Renderer` | menghasilkan representasi output |
| `Parser` | membaca representasi input |
| `Encoder/Decoder` | transformasi format |

Jangan terlalu dogmatis. Nama terbaik adalah nama yang membuat role jelas bagi caller.

---

## 28. Interface Granularity Decision Matrix

Gunakan matrix ini saat mendesain interface.

| Pertanyaan | Jika Ya | Jika Tidak |
|---|---|---|
| Apakah ada variasi implementation nyata? | Interface mungkin tepat | Concrete class cukup |
| Apakah caller hanya butuh subset kemampuan? | Pecah berdasarkan role | Jangan pecah mekanis |
| Apakah method punya lifecycle/protocol? | Pertimbangkan type-state | Interface sederhana cukup |
| Apakah interface untuk plugin/provider? | Desain sebagai SPI | Jangan overdesign |
| Apakah interface public library? | Dokumentasikan contract detail | Internal bisa lebih fleksibel |
| Apakah default method akan ditambah? | Review compatibility | Hindari jika semantic lemah |
| Apakah semua implementer bisa memenuhi semua method? | Lanjut | Pecah interface |
| Apakah interface hanya mirror class? | Hapus/mundur | Pertahankan jika boundary jelas |
| Apakah interface butuh state sharing? | Abstract class/composition | Interface tepat |
| Apakah dipakai sebagai lambda target? | Functional interface | Normal interface |

---

## 29. Case Study: Mendesain Interface untuk Workflow Enforcement

Misal kita punya domain enforcement lifecycle:

```text
Case Drafted -> Submitted -> Under Review -> Escalated -> Resolved/Rejected/Closed
```

Naive interface:

```java
public interface CaseWorkflowService {
    void submit(String caseId);
    void review(String caseId);
    void escalate(String caseId);
    void resolve(String caseId);
    void reject(String caseId);
    void close(String caseId);
}
```

Masalah:

1. command miskin context
2. no result type
3. no failure model
4. permission/audit/context tidak terlihat
5. transition policy tidak modular
6. interface menjadi transaction script besar
7. sulit test rule per transition
8. sulit extend per agency/jurisdiction

Desain lebih baik:

```java
public interface CaseTransitionPolicy {
    TransitionDecision evaluate(TransitionRequest request);
}
```

```java
public record TransitionRequest(
        CaseSnapshot snapshot,
        CaseAction action,
        Actor actor,
        Instant requestedAt,
        TransitionContext context
) {
}
```

```java
public sealed interface TransitionDecision
        permits TransitionDecision.Allowed, TransitionDecision.Denied {

    record Allowed(NextCaseState nextState, List<RequiredSideEffect> sideEffects)
            implements TransitionDecision {
    }

    record Denied(List<DenialReason> reasons)
            implements TransitionDecision {
    }
}
```

Workflow engine:

```java
public interface CaseWorkflowEngine {
    TransitionResult transition(TransitionCommand command);
}
```

Ports:

```java
public interface CaseStateStore {
    CaseSnapshot get(CaseId id);
    StoredCaseState saveTransition(SaveTransitionCommand command);
}
```

```java
public interface CaseAuditPublisher {
    void publish(CaseAuditEvent event);
}
```

```java
public interface CaseNotificationSender {
    void send(CaseNotification notification);
}
```

Policy variation:

```java
public final class CompositeCaseTransitionPolicy implements CaseTransitionPolicy {
    private final List<CaseTransitionRule> rules;

    @Override
    public TransitionDecision evaluate(TransitionRequest request) {
        List<DenialReason> denialReasons = new ArrayList<>();

        for (CaseTransitionRule rule : rules) {
            RuleDecision decision = rule.evaluate(request);
            if (decision instanceof RuleDecision.Denied denied) {
                denialReasons.addAll(denied.reasons());
            }
        }

        if (!denialReasons.isEmpty()) {
            return new TransitionDecision.Denied(List.copyOf(denialReasons));
        }

        return new TransitionDecision.Allowed(
                request.action().nextStateFrom(request.snapshot().state()),
                RequiredSideEffectPlanner.plan(request)
        );
    }
}
```

Small functional rule:

```java
@FunctionalInterface
public interface CaseTransitionRule {
    RuleDecision evaluate(TransitionRequest request);
}
```

Benefits:

1. transition policy bisa diganti
2. rule bisa dikomposisi
3. failure eksplisit
4. side effect dipisah
5. store/publisher/sender adalah ports
6. engine tetap orchestration boundary
7. audit/notification tidak dicampur ke policy
8. interface mewakili role nyata
9. sealed result memperjelas exhaustiveness
10. test bisa fokus per rule/policy/engine

Ini contoh interface sebagai desain sistem, bukan sekadar keyword bahasa.

---

## 30. Anti-Patterns Interface yang Sering Muncul

### 30.1 Interface Per Class

```java
UserService -> UserServiceImpl
OrderService -> OrderServiceImpl
InvoiceService -> InvoiceServiceImpl
```

Tidak selalu salah, tetapi sering ritual tanpa value.

Tanyakan:

- Apa alternative implementation-nya?
- Siapa caller interface ini?
- Apakah ini module boundary?
- Apakah test membutuhkan fake meaningful?
- Apakah interface ini stabil?

### 30.2 Fat Interface

```java
public interface UserOperations {
    void create(...);
    void approve(...);
    void reject(...);
    void archive(...);
    void export(...);
    void importUsers(...);
    void resetPassword(...);
    void assignRole(...);
}
```

Solusi: pecah berdasarkan role/use case/capability.

### 30.3 Leaky Abstraction

```java
public interface CustomerRepository {
    ResultSet findCustomer(String sql);
}
```

Ini bukan abstraction, ini JDBC bocor.

Lebih baik:

```java
public interface CustomerLookup {
    Optional<CustomerSnapshot> findById(CustomerId id);
}
```

### 30.4 Generic but Meaningless

```java
public interface Processor<I, O> {
    O process(I input);
}
```

Kadang berguna, sering kehilangan semantic.

Lebih baik jika domain-specific:

```java
public interface DocumentClassificationPolicy {
    ClassificationResult classify(DocumentSnapshot document);
}
```

### 30.5 Marker Interface untuk Runtime State

```java
public interface Approved {
}
```

Jika approved adalah state yang berubah, jangan jadikan marker interface.

Lebih baik:

```java
public enum ApprovalStatus {
    DRAFT,
    PENDING,
    APPROVED,
    REJECTED
}
```

Atau sealed state model.

### 30.6 Default Method sebagai Dumping Ground

```java
public interface UserWorkflow {
    default void doEverything(...) {
        ...
    }
}
```

Jika logic besar, taruh di class/service yang dependency-nya eksplisit.

### 30.7 Interface yang Memaksakan UnsupportedOperationException

```java
public interface EditableDocument {
    void edit(...);
    void approve(...);
    void publish(...);
}

public final class ArchivedDocument implements EditableDocument {
    @Override
    public void edit(...) {
        throw new UnsupportedOperationException();
    }
}
```

Solusi: pecah role atau modelkan state.

### 30.8 Interface Berbasis DTO CRUD Tanpa Domain

```java
public interface CaseService {
    CaseDto create(CaseDto dto);
    CaseDto update(CaseDto dto);
    CaseDto get(String id);
}
```

Ini mungkin cukup untuk simple CRUD, tetapi untuk domain complex akan gagal menangkap invariant, transition, dan failure.

---

## 31. Interface Design Checklist

Sebelum membuat interface, jawab:

1. Apa role interface ini?
2. Siapa caller-nya?
3. Siapa implementer-nya?
4. Apakah ada lebih dari satu implementation meaningful?
5. Apakah ini API, SPI, port, capability, policy, atau callback?
6. Apakah semua method wajib dipenuhi semua implementation?
7. Apakah interface punya lifecycle/protocol tersembunyi?
8. Apakah contract nullability jelas?
9. Apakah failure model jelas?
10. Apakah thread-safety expectation jelas?
11. Apakah method blocking/non-blocking jelas?
12. Apakah side effect jelas?
13. Apakah return object ownership jelas?
14. Apakah interface terlalu luas?
15. Apakah interface terlalu kecil tanpa semantic?
16. Apakah nama interface menjelaskan role?
17. Apakah default method benar-benar aman?
18. Apakah abstract class lebih tepat?
19. Apakah sealed hierarchy lebih tepat?
20. Apakah record/function type lebih tepat?
21. Apakah interface akan diekspor dari module?
22. Apakah implementation bisa package-private?
23. Apakah interface public butuh compatibility policy?
24. Apakah akan dipakai reflection/proxy/ServiceLoader?
25. Apakah testing seam ini meaningful atau hanya untuk mock internal detail?

---

## 32. Practical Heuristics untuk Top-Level Engineering Judgment

Gunakan prinsip berikut:

### 32.1 Interface adalah boundary, bukan dekorasi

Jika interface tidak mengubah arah dependency, tidak menyembunyikan implementation, tidak memungkinkan variasi, dan tidak memperjelas role, mungkin tidak perlu.

### 32.2 Satu interface harus punya satu alasan untuk berubah

Jika satu interface berubah karena persistence, notification, authorization, export, dan reporting, interface itu terlalu besar.

### 32.3 Capability harus orthogonal

`Auditable`, `Versioned`, `Expirable` bisa dikombinasikan. Tetapi `EverythingManageable` tidak memberi desain yang baik.

### 32.4 SPI harus lebih ketat daripada API biasa

Karena implementer bisa pihak lain, contract harus jelas dan konservatif.

### 32.5 Default method adalah compatibility tool, bukan inheritance replacement

Gunakan untuk convenience kecil, bukan workflow besar.

### 32.6 Interface public adalah janji jangka panjang

Setiap method public yang ditambahkan adalah beban compatibility masa depan.

### 32.7 Jangan sembunyikan state machine dalam interface datar

Kalau operation punya urutan valid/invalid, pertimbangkan type-state, sealed state, atau command model.

### 32.8 Jangan membuat abstraction sebelum variasi terlihat

Premature abstraction menciptakan vocabulary palsu dan memperberat codebase.

### 32.9 Named functional interface bagus untuk domain API

`Function<A, B>` cocok untuk local utility. `CaseAssignmentPolicy` lebih baik untuk public domain contract.

### 32.10 Interface harus membuat caller lebih bebas, bukan lebih bingung

Jika caller tetap harus tahu concrete implementation, interface gagal sebagai abstraction.

---

## 33. Ringkasan Mental Model

Interface Java modern adalah tool desain yang sangat kuat, tetapi mudah disalahgunakan.

Mental model akhirnya:

```text
Interface = role/capability/protocol boundary
Class     = concrete implementation and state owner
Abstract  = shared implementation with controlled inheritance
Record    = transparent value carrier
Sealed    = controlled finite type family
Lambda    = behavior value targeting functional interface
Module    = deployment/visibility boundary
Package   = namespace and local encapsulation boundary
```

Interface yang baik:

- kecil tapi meaningful
- punya semantic contract jelas
- semua implementer bisa memenuhi contract
- dependency direction benar
- tidak membocorkan implementation detail
- tidak menjadi dumping ground
- stabil untuk public API
- bisa berevolusi secara terencana
- cocok dengan package/module architecture
- mudah diuji tanpa over-mocking

Interface yang buruk:

- hanya mirror class
- terlalu generic
- terlalu besar
- terlalu kecil tanpa semantic
- punya method yang sebagian implementation tidak bisa dukung
- menyembunyikan lifecycle
- memakai default method untuk business workflow besar
- mencampur API dan SPI
- menjadi constant holder
- dibuat karena ritual framework, bukan desain

---

## 34. Latihan Desain

### Latihan 1: Pecah Fat Interface

Diberikan:

```java
public interface DocumentService {
    DocumentDto get(String id);
    List<DocumentDto> search(String keyword);
    DocumentDto create(DocumentDto dto);
    DocumentDto update(DocumentDto dto);
    void delete(String id);
    void approve(String id);
    void reject(String id);
    byte[] exportPdf(String id);
    void sendEmail(String id);
    List<AuditDto> auditTrail(String id);
}
```

Tugas:

1. Identifikasi role berbeda.
2. Pecah menjadi interface yang lebih meaningful.
3. Tentukan mana API, mana port, mana policy.
4. Tentukan failure model minimal.

Contoh arah jawaban:

```java
public interface DocumentLookup { ... }
public interface DocumentSearch { ... }
public interface DocumentCommandHandler { ... }
public interface DocumentApprovalPolicy { ... }
public interface DocumentRenderer { ... }
public interface DocumentNotificationPort { ... }
public interface DocumentAuditTrail { ... }
```

### Latihan 2: Default Method Review

Diberikan:

```java
public interface PaymentGateway {
    PaymentReceipt charge(ChargeCommand command);

    default boolean supportsRefund() {
        return true;
    }

    default RefundReceipt refund(RefundCommand command) {
        throw new UnsupportedOperationException();
    }
}
```

Tugas:

1. Apakah default method ini aman?
2. Apakah semua implementation gateway mendukung refund?
3. Apakah lebih baik sub-interface?

Arah solusi:

```java
public interface PaymentGateway {
    PaymentReceipt charge(ChargeCommand command);
}

public interface RefundCapablePaymentGateway extends PaymentGateway {
    RefundReceipt refund(RefundCommand command);
}
```

### Latihan 3: API vs SPI

Diberikan kebutuhan:

- aplikasi bisa generate report
- format report bisa ditambahkan oleh plugin
- plugin harus bisa menyediakan renderer
- caller biasa hanya ingin generate report

Tugas:

1. Desain API untuk caller.
2. Desain SPI untuk plugin provider.
3. Tentukan package layout.
4. Tentukan apakah ServiceLoader cocok.

---

## 35. Referensi Resmi

- Java Language Specification, Java SE 25, Chapter 9: Interfaces.
- Java SE 25 API: `java.lang.FunctionalInterface`.
- Java SE 25 API: `java.util.function` package.
- OpenJDK JEP 213: Milling Project Coin, termasuk private interface methods.
- Java Language Specification, Java SE 25, Chapter 13: Binary Compatibility.
- Java Platform Module System / JEP 261 untuk konteks exported interface dan strong encapsulation.

---

## 36. Penutup Part 006

Di part ini, kita memperlakukan interface sebagai alat desain sistem, bukan sekadar keyword bahasa.

Takeaway utama:

> Interface bukan tujuan. Interface adalah alat untuk membuat role, boundary, variation point, dan contract menjadi eksplisit.

Jika interface tidak memperjelas salah satu dari itu, kemungkinan besar ia hanya menambah noise.

Part berikutnya akan membahas **Sealed Classes and Controlled Hierarchies**, yaitu cara Java modern membatasi type family agar model domain, state machine, dan result type bisa lebih eksplisit dan exhaustively reasoned.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-005.md">⬅️ Part 005 — Inheritance Deep Dive: Substitutability, Fragility, and Runtime Dispatch</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-007.md">Sealed Classes and Controlled Hierarchies ➡️</a>
</div>
