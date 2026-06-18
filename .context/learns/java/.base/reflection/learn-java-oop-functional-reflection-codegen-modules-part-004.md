# learn-java-oop-functional-reflection-codegen-modules-part-004

# Encapsulation Beyond `private`: Invariants, State Ownership, and API Surface

> Seri: Java OOP, Functional, Reflection, Code Generation, Modules & Package Management  
> Part: 004  
> Fokus: memahami encapsulation bukan sebagai “pakai `private`”, tetapi sebagai disiplin menjaga invariant, ownership, perubahan internal, dan kontrak API.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas object identity, equality, hashing, immutability, dan object contracts. Sekarang kita naik satu level: bagaimana object/class/package/module **menjaga dirinya tetap benar** walaupun dipakai oleh banyak caller, framework, serializer, reflection, test, generated code, dan future version.

Encapsulation adalah salah satu konsep yang paling sering diajarkan secara dangkal:

```java
private String name;

public String getName() {
    return name;
}

public void setName(String name) {
    this.name = name;
}
```

Secara syntax, field-nya memang `private`. Tetapi secara desain, class ini belum tentu encapsulated. Kalau setiap state internal bisa dibaca dan ditulis bebas lewat getter/setter, maka object tersebut hanya menjadi struct dengan ceremony Java.

Di level engineer senior/top-tier, pertanyaannya bukan:

> “Apakah field sudah private?”

Pertanyaannya adalah:

> “Siapa yang boleh mengubah state ini, melalui operasi apa, dengan validasi apa, pada fase lifecycle mana, dan invariant apa yang tetap harus benar setelah operasi selesai?”

---

## 1. Definisi Kerja: Encapsulation sebagai Perlindungan Invariant

Encapsulation adalah praktik menyembunyikan detail representasi internal dan hanya mengekspos operasi yang menjaga object tetap valid.

Ada tiga lapisan penting:

1. **Information hiding**  
   Caller tidak perlu tahu bagaimana data disimpan.

2. **State ownership**  
   Object jelas memiliki dan mengontrol state-nya sendiri.

3. **Invariant protection**  
   Semua operasi publik menjaga kondisi wajib object tetap benar.

Contoh invariant:

```text
BankAccount.balance tidak boleh negatif.
Order.totalAmount harus sama dengan sum(orderLines).
Case.closedAt hanya boleh terisi jika status = CLOSED.
User.email harus valid dan normalized.
DateRange.start harus <= DateRange.end.
WorkflowTransition hanya valid jika fromState -> toState diizinkan.
```

Object yang truly encapsulated tidak sekadar menyimpan data. Ia **menolak state yang tidak masuk akal**.

---

## 2. Access Modifier Bukan Encapsulation, tapi Alat Encapsulation

Java punya access control untuk membatasi visibility declaration. JLS membedakan access dari scope: scope menentukan area program tempat nama berlaku, sedangkan access menentukan apakah entity boleh direferensikan dari bagian program tertentu. Access control diatur untuk class, interface, member, dan constructor. Referensi resmi: JLS section 6.6 Access Control. [Oracle JLS](https://docs.oracle.com/javase/specs/jls/se25/html/index.html)

Access modifier utama:

| Modifier | Visibility Ringkas | Kegunaan Arsitektural |
|---|---|---|
| `private` | hanya dalam top-level/nested context yang diizinkan | menyembunyikan detail implementasi class |
| package-private | hanya dalam package yang sama | boundary internal kecil, collaboration antar class dalam package |
| `protected` | package + subclass access rule | extension point, tapi berisiko memperlebar coupling |
| `public` | semua caller yang bisa membaca type | API contract jangka panjang |

Kesalahan umum:

```text
private field + public getter/setter = encapsulated
```

Belum tentu.

Contoh tidak encapsulated:

```java
public final class Order {
    private String status;
    private BigDecimal totalAmount;

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public BigDecimal getTotalAmount() {
        return totalAmount;
    }

    public void setTotalAmount(BigDecimal totalAmount) {
        this.totalAmount = totalAmount;
    }
}
```

Masalah:

- status bisa diisi string apa pun
- total bisa negatif
- total bisa tidak sesuai dengan line items
- caller bisa mengubah lifecycle tanpa rule
- object tidak punya pusat kebenaran

Lebih baik:

```java
public final class Order {
    private final OrderId id;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.DRAFT;

    public Order(OrderId id) {
        this.id = Objects.requireNonNull(id, "id");
    }

    public void addLine(ProductId productId, int quantity, Money unitPrice) {
        requireDraft();
        lines.add(OrderLine.create(productId, quantity, unitPrice));
    }

    public void submit() {
        requireDraft();
        if (lines.isEmpty()) {
            throw new IllegalStateException("Cannot submit order without lines");
        }
        status = OrderStatus.SUBMITTED;
    }

    public Money totalAmount() {
        return lines.stream()
                .map(OrderLine::amount)
                .reduce(Money.zero(), Money::add);
    }

    public List<OrderLine> lines() {
        return List.copyOf(lines);
    }

    public OrderStatus status() {
        return status;
    }

    private void requireDraft() {
        if (status != OrderStatus.DRAFT) {
            throw new IllegalStateException("Order is no longer editable");
        }
    }
}
```

Di sini, API publik mewakili **domain operation**, bukan exposing raw storage.

---

## 3. Mental Model: Object sebagai Boundary, Bukan Bag of Data

Object yang baik punya boundary:

```text
outside world
    |
    | calls public operations
    v
+--------------------------+
| Object Boundary           |
|                          |
|  private state            |
|  private helper           |
|  invariant checks         |
|  lifecycle rules          |
|  derived computation      |
+--------------------------+
```

Caller tidak boleh melakukan ini:

```text
read state -> compute outside -> write back state
```

Karena logic menjadi tersebar.

Lebih baik:

```text
call intention-revealing operation -> object validates and mutates itself
```

Contoh buruk:

```java
if (caseFile.getStatus() == CaseStatus.OPEN) {
    caseFile.setStatus(CaseStatus.CLOSED);
    caseFile.setClosedAt(Instant.now());
    caseFile.setClosedBy(userId);
}
```

Contoh lebih baik:

```java
caseFile.closeBy(userId, clock.instant());
```

Object `CaseFile` menjaga rule:

```java
public void closeBy(UserId userId, Instant closedAt) {
    if (status != CaseStatus.OPEN) {
        throw new IllegalStateException("Only OPEN case can be closed");
    }
    this.status = CaseStatus.CLOSED;
    this.closedBy = Objects.requireNonNull(userId);
    this.closedAt = Objects.requireNonNull(closedAt);
}
```

Bedanya besar:

- logic tidak duplikatif
- invariant terkonsentrasi
- test lebih meaningful
- API menggambarkan business operation
- lebih mudah di-refactor
- lebih aman terhadap caller baru

---

## 4. Invariant: Hal yang Harus Selalu Benar

Invariant adalah kondisi yang harus benar pada object setelah construction dan setelah setiap public operation selesai.

Contoh `DateRange`:

```java
public final class DateRange {
    private final LocalDate start;
    private final LocalDate end;

    public DateRange(LocalDate start, LocalDate end) {
        this.start = Objects.requireNonNull(start, "start");
        this.end = Objects.requireNonNull(end, "end");
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }

    public boolean contains(LocalDate date) {
        Objects.requireNonNull(date, "date");
        return !date.isBefore(start) && !date.isAfter(end);
    }

    public LocalDate start() {
        return start;
    }

    public LocalDate end() {
        return end;
    }
}
```

Karena invariant dijaga di constructor dan object immutable, semua method bisa mengasumsikan `start <= end`.

Tanpa invariant, setiap method harus defensive:

```java
if (start == null || end == null || end.isBefore(start)) {
    // recover? throw? patch? guess?
}
```

Itu tanda class tidak punya pusat kebenaran.

---

## 5. Encapsulation dan Lifecycle State

Object sering punya lifecycle:

```text
DRAFT -> SUBMITTED -> APPROVED -> CLOSED
```

Encapsulation berarti setiap transition harus dikontrol.

Buruk:

```java
caseFile.setStatus(CaseStatus.APPROVED);
```

Lebih baik:

```java
caseFile.approveBy(approverId, now);
```

Kenapa?

Karena approval bukan sekadar status assignment. Biasanya ada rule:

- hanya case yang `SUBMITTED` bisa approved
- approver tidak boleh sama dengan submitter
- timestamp harus diisi
- audit event harus dibuat
- reason/comment mungkin wajib
- related task harus diselesaikan

Contoh:

```java
public void approveBy(UserId approverId, Instant approvedAt) {
    Objects.requireNonNull(approverId, "approverId");
    Objects.requireNonNull(approvedAt, "approvedAt");

    if (status != CaseStatus.SUBMITTED) {
        throw new IllegalStateException("Only submitted case can be approved");
    }
    if (approverId.equals(submittedBy)) {
        throw new IllegalArgumentException("Submitter cannot approve own case");
    }

    status = CaseStatus.APPROVED;
    this.approvedBy = approverId;
    this.approvedAt = approvedAt;
}
```

Setter status mentah adalah lubang besar dalam lifecycle model.

---

## 6. State Ownership: Siapa Pemilik Data Ini?

Satu data sebaiknya punya owner yang jelas.

Contoh:

```java
public final class Team {
    private final List<Member> members = new ArrayList<>();

    public List<Member> members() {
        return members;
    }
}
```

Caller bisa melakukan:

```java
team.members().clear();
```

Ini bukan hanya bug. Ini pelanggaran ownership. `Team` kehilangan kontrol atas state-nya.

Perbaikan minimal:

```java
public List<Member> members() {
    return List.copyOf(members);
}
```

Java SE menyediakan `List.copyOf` untuk membuat unmodifiable list dari collection input. Dokumentasi `List` menjelaskan bahwa `List.of` dan `List.copyOf` menghasilkan unmodifiable lists. [Oracle Java SE 25 List](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html)

Namun perlu hati-hati: unmodifiable collection belum tentu membuat elemen di dalamnya immutable.

```java
public List<Member> members() {
    return List.copyOf(members); // list tidak bisa dimodifikasi, tetapi Member bisa saja mutable
}
```

Kalau `Member` mutable, caller masih bisa:

```java
team.members().getFirst().rename("x");
```

Jadi ownership punya level:

| Level | Arti |
|---|---|
| Owns collection only | caller tidak bisa add/remove, tapi elemen mungkin mutable |
| Owns elements too | elemen juga immutable atau defensive-copied |
| Shared mutable state | paling berbahaya, perlu aturan ketat |
| Borrowed reference | caller hanya boleh baca/pakai sementara |
| Transferred ownership | setelah diberikan, pemberi tidak boleh pakai lagi |

Java tidak punya ownership type system seperti Rust. Jadi ownership harus ditegakkan lewat desain API.

---

## 7. Representation Exposure

Representation exposure terjadi ketika detail internal bocor ke luar.

Contoh klasik:

```java
public final class Schedule {
    private final List<LocalDate> holidays;

    public Schedule(List<LocalDate> holidays) {
        this.holidays = holidays;
    }

    public List<LocalDate> holidays() {
        return holidays;
    }
}
```

Dua kebocoran:

1. Constructor menyimpan reference input secara langsung.
2. Getter mengembalikan reference internal secara langsung.

Bug:

```java
List<LocalDate> source = new ArrayList<>();
Schedule schedule = new Schedule(source);
source.add(LocalDate.now()); // mengubah internal schedule dari luar

schedule.holidays().clear(); // menghapus internal schedule dari luar
```

Perbaikan:

```java
public final class Schedule {
    private final List<LocalDate> holidays;

    public Schedule(Collection<LocalDate> holidays) {
        Objects.requireNonNull(holidays, "holidays");
        this.holidays = List.copyOf(holidays);
    }

    public List<LocalDate> holidays() {
        return holidays;
    }
}
```

Karena `LocalDate` immutable, ini cukup aman.

Kalau elemen mutable:

```java
public final class Report {
    private final List<MutableSection> sections;

    public Report(Collection<MutableSection> sections) {
        this.sections = sections.stream()
                .map(MutableSection::copy)
                .toList();
    }

    public List<MutableSection> sections() {
        return sections.stream()
                .map(MutableSection::copy)
                .toList();
    }
}
```

Tetapi defensive copy elemen bisa mahal. Karena itu desain yang lebih baik biasanya memilih immutable value object untuk elemen.

---

## 8. Getter dan Setter: Kapan Benar, Kapan Salah

Getter tidak selalu buruk. Setter tidak selalu buruk. Masalahnya adalah ketika getter/setter menjadi default tanpa memikirkan invariant.

### Getter yang wajar

```java
public OrderStatus status() {
    return status;
}
```

Aman jika:

- return type immutable atau enum
- tidak mengekspos mutable internal
- tidak membuat caller bertanggung jawab atas invariant

### Setter yang wajar

Setter bisa wajar untuk:

- DTO murni
- framework binding object
- configuration object sederhana
- test fixture object
- generated client/server model
- form model

Namun untuk domain object, setter mentah sering merusak model.

Buruk:

```java
customer.setEmail(email);
```

Lebih baik:

```java
customer.changeEmailTo(email, verificationPolicy);
```

Karena email change bisa memerlukan:

- normalization
- uniqueness check
- verification status reset
- domain event
- audit trail
- notification

### Rule praktis

Gunakan pertanyaan ini:

> “Apakah perubahan state ini punya business meaning?”

Kalau iya, jangan buat setter mentah. Buat operation bernama intention.

---

## 9. Tell, Don’t Ask

Prinsip “Tell, Don’t Ask” berarti caller sebaiknya menyuruh object melakukan operasi, bukan mengambil state lalu memutuskan dari luar.

Buruk:

```java
if (invoice.getDueDate().isBefore(today) && invoice.getStatus() == InvoiceStatus.UNPAID) {
    invoice.setStatus(InvoiceStatus.OVERDUE);
    invoice.setPenalty(invoice.getAmount().multiply(new BigDecimal("0.02")));
}
```

Lebih baik:

```java
invoice.markOverdueIfNeeded(today, penaltyPolicy);
```

Implementasi:

```java
public void markOverdueIfNeeded(LocalDate today, PenaltyPolicy penaltyPolicy) {
    Objects.requireNonNull(today, "today");
    Objects.requireNonNull(penaltyPolicy, "penaltyPolicy");

    if (status != InvoiceStatus.UNPAID) {
        return;
    }
    if (!dueDate.isBefore(today)) {
        return;
    }

    status = InvoiceStatus.OVERDUE;
    penalty = penaltyPolicy.calculateFor(amount);
}
```

Keuntungan:

- rule tersentralisasi
- caller lebih sederhana
- invariant lebih aman
- operation bisa dites langsung
- object punya behavior nyata

Kelemahannya:

- object bisa membesar jika semua logic dimasukkan
- perlu membedakan behavior milik object vs service/policy

Jadi prinsip ini bukan dogma. Untuk rule yang membutuhkan banyak dependency eksternal, gunakan domain service/policy object.

---

## 10. Behavioral API vs Data API

Data API:

```java
order.setStatus(OrderStatus.CANCELLED);
order.setCancelledReason(reason);
order.setCancelledAt(now);
```

Behavioral API:

```java
order.cancel(reason, now);
```

Data API cocok untuk:

- transfer data
- serialization boundary
- API request/response
- generated model
- simple projection

Behavioral API cocok untuk:

- domain object
- lifecycle object
- aggregate-like model
- object with invariant
- state machine object
- object shared by many caller

Sering kali sistem enterprise butuh keduanya, tetapi jangan dicampur sembarangan.

Contoh layering:

```text
HTTP Request DTO / generated API model
        |
        v
Application Service
        |
        v
Domain Object with behavioral API
        |
        v
Persistence Mapper / Entity
```

Anti-pattern umum:

```text
Use request DTO directly as domain object
```

Akibat:

- field terlalu publik secara konseptual
- validation tersebar
- lifecycle tidak eksplisit
- object sulit berevolusi
- API external ikut mendikte internal model

---

## 11. Encapsulation dalam Mutable Object

Mutable object bisa tetap encapsulated jika mutasinya dikontrol.

Contoh:

```java
public final class ApprovalWorkflow {
    private final List<ApprovalStep> steps = new ArrayList<>();
    private int currentStepIndex;
    private WorkflowStatus status = WorkflowStatus.IN_PROGRESS;

    public void approveCurrentStep(UserId userId, Instant now) {
        requireInProgress();
        ApprovalStep currentStep = steps.get(currentStepIndex);
        currentStep.approveBy(userId, now);

        if (currentStepIndex == steps.size() - 1) {
            status = WorkflowStatus.APPROVED;
        } else {
            currentStepIndex++;
        }
    }

    public List<ApprovalStep> steps() {
        return List.copyOf(steps);
    }

    private void requireInProgress() {
        if (status != WorkflowStatus.IN_PROGRESS) {
            throw new IllegalStateException("Workflow is not in progress");
        }
    }
}
```

Object mutable ini tetap punya rule:

- caller tidak bisa skip step
- caller tidak bisa approve arbitrary step
- caller tidak bisa mengubah list step langsung
- status berubah berdasarkan transition internal

Mutable bukan musuh. Mutable liar adalah musuh.

---

## 12. Encapsulation dalam Immutable Object

Immutable object lebih mudah diencapsulate karena state tidak berubah setelah valid construction.

Contoh:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        this.amount = normalize(Objects.requireNonNull(amount, "amount"));
        this.currency = Objects.requireNonNull(currency, "currency");
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money multiply(BigDecimal factor) {
        Objects.requireNonNull(factor, "factor");
        return new Money(amount.multiply(factor), currency);
    }

    private void requireSameCurrency(Money other) {
        Objects.requireNonNull(other, "other");
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
    }

    private static BigDecimal normalize(BigDecimal value) {
        return value.stripTrailingZeros();
    }
}
```

Keuntungan:

- no aliasing mutation
- thread-safe by construction jika fields immutable
- aman sebagai key jika equals/hashCode benar
- cocok untuk value object
- mudah dites

Tetapi immutable object juga bisa membocorkan state kalau field-nya mutable:

```java
public final class BadPeriod {
    private final Date start;

    public BadPeriod(Date start) {
        this.start = start;
    }

    public Date start() {
        return start;
    }
}
```

`Date` mutable, jadi harus copy.

---

## 13. Package-Private sebagai Tool Desain

Banyak developer terlalu cepat membuat class `public`.

```java
public class OrderValidator { ... }
public class OrderCalculator { ... }
public class OrderStateMachine { ... }
public class OrderTransitionRule { ... }
```

Kalau semua `public`, maka semua menjadi API. API yang sudah dipakai caller akan sulit diubah.

Lebih baik:

```text
com.example.order
  public OrderService
  public Order
  public OrderId
  public OrderStatus
  package-private OrderValidator
  package-private OrderCalculator
  package-private OrderTransitionRules
```

Di Java, top-level class tanpa `public` hanya bisa diakses dari package yang sama. Ini berguna untuk membuat “internal collaboration cluster”.

Contoh:

```java
final class OrderTransitionRules {
    private OrderTransitionRules() {
    }

    static void requireCanSubmit(Order order) {
        if (order.isEmpty()) {
            throw new IllegalStateException("Order has no line");
        }
    }
}
```

Caller luar package tidak bisa bergantung ke class ini. Jadi kita bebas refactor.

Mental model:

```text
public type      = contract to outside world
package-private = implementation detail within package boundary
private         = implementation detail within class boundary
```

---

## 14. `protected`: Extension Point yang Berbahaya

`protected` sering disalahpahami sebagai “private untuk subclass”. Di Java, `protected` juga memberi akses ke package yang sama, dan ada rule khusus untuk subclass di package berbeda.

Secara desain, `protected` berarti:

> “Saya membuka sebagian internal class ini kepada subclass.”

Itu sangat kuat dan berbahaya.

Contoh:

```java
public abstract class AbstractProcessor {
    protected List<String> errors = new ArrayList<>();

    public final void process(Input input) {
        validate(input);
        execute(input);
    }

    protected abstract void validate(Input input);
    protected abstract void execute(Input input);
}
```

Subclass bisa:

```java
errors = null;
errors.clear();
errors.add("invalid arbitrary error");
```

Lebih aman:

```java
public abstract class AbstractProcessor {
    private final List<String> errors = new ArrayList<>();

    public final void process(Input input) {
        validate(input);
        execute(input);
    }

    protected final void addError(String error) {
        errors.add(Objects.requireNonNull(error));
    }

    protected abstract void validate(Input input);
    protected abstract void execute(Input input);
}
```

Guideline:

- hindari `protected` field
- lebih baik `private` field + `protected final` helper method
- dokumentasikan extension contract
- jadikan method `final` jika tidak dirancang untuk override
- jangan expose internal collection ke subclass

Inheritance akan dibahas lebih dalam di Part 005, tetapi dari sisi encapsulation: subclass adalah caller yang sangat powerful.

---

## 15. Public API adalah Hutang Jangka Panjang

Begitu method/class dibuat `public`, ia menjadi kontrak.

```java
public void updateStatus(String status) { ... }
```

Caller bisa mulai memakai:

```java
obj.updateStatus("APPROVED");
obj.updateStatus("approved");
obj.updateStatus("A");
obj.updateStatus(null);
```

Jika nanti ingin memperketat rule, perubahan bisa breaking.

Karena itu, public API harus minimal, intentional, dan stabil.

Pertanyaan sebelum membuat sesuatu `public`:

1. Apakah caller luar benar-benar perlu ini?
2. Apakah nama method mencerminkan business intention?
3. Apakah parameter terlalu primitive/stringly typed?
4. Apakah method ini membocorkan internal representation?
5. Apakah method ini akan sulit diubah nanti?
6. Apakah method ini mengizinkan state invalid?
7. Apakah return type membuat caller bergantung pada implementation detail?

Contoh API yang lebih kuat:

```java
public void transitionTo(CaseStatus targetStatus, TransitionContext context)
```

Lebih kuat lagi jika status transition domain-specific:

```java
public void submit(UserId submittedBy, Instant submittedAt)
public void approve(UserId approvedBy, Instant approvedAt)
public void reject(UserId rejectedBy, RejectReason reason, Instant rejectedAt)
```

Karena setiap transition punya invariant berbeda.

---

## 16. Encapsulation dan Primitive Obsession

Primitive obsession merusak encapsulation karena rule tersebar di sekitar primitive.

Buruk:

```java
public void register(String email, String postalCode, String amount, String currency) { ... }
```

Lebih baik:

```java
public void register(EmailAddress email, PostalCode postalCode, Money initialBalance) { ... }
```

Value object menjaga invariant lokal:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value, "value");
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (!normalized.matches("^[^@]+@[^@]+\\.[^@]+$")) {
            throw new IllegalArgumentException("Invalid email address");
        }
        value = normalized;
    }
}
```

Catatan: regex email di contoh ini sengaja sederhana untuk ilustrasi. Validasi email production bisa jauh lebih kompleks.

Keuntungan:

- API lebih eksplisit
- validation reusable
- caller tidak bisa asal kirim string
- domain meaning masuk ke type system
- test lebih fokus

Encapsulation tidak hanya di class besar. Encapsulation juga terjadi melalui type kecil yang menjaga rule kecil.

---

## 17. Encapsulation dan Derived State

Derived state adalah state yang bisa dihitung dari state lain.

Contoh buruk:

```java
public final class Cart {
    private final List<CartItem> items = new ArrayList<>();
    private Money total;

    public void addItem(CartItem item) {
        items.add(item);
    }

    public Money total() {
        return total;
    }
}
```

`total` bisa stale karena tidak selalu diperbarui.

Pilihan 1: calculate on demand.

```java
public Money total() {
    return items.stream()
            .map(CartItem::amount)
            .reduce(Money.zero(), Money::add);
}
```

Pilihan 2: maintain cached derived state secara konsisten.

```java
public void addItem(CartItem item) {
    items.add(Objects.requireNonNull(item));
    total = total.add(item.amount());
}
```

Rule:

- Kalau murah dihitung, derive on demand.
- Kalau mahal dihitung, cache boleh, tapi semua mutation path harus update cache.
- Jangan expose setter untuk derived state.

Buruk:

```java
cart.setTotal(total);
```

Karena total adalah consequence, bukan command.

---

## 18. Encapsulation dan Validation Placement

Validation bisa ditempatkan di beberapa layer:

```text
Input boundary validation
Application use-case validation
Domain invariant validation
Persistence constraint validation
Database constraint validation
```

Encapsulation bukan berarti semua validation dimasukkan ke satu class.

Contoh:

```text
HTTP DTO:
  - field required
  - format basic

Application service:
  - user authorization
  - referenced entity exists
  - idempotency rule

Domain object:
  - lifecycle invariant
  - internal consistency
  - object validity

Database:
  - uniqueness
  - FK constraint
  - not null
```

Domain object harus menjaga invariant yang membuat object valid terlepas dari transport/storage.

Contoh:

```java
public final class DateRange {
    public DateRange(LocalDate start, LocalDate end) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end before start");
        }
    }
}
```

Validasi ini jangan hanya ada di controller, karena object bisa dibuat dari test, batch job, message consumer, import tool, migration script, atau reflection/framework.

---

## 19. Encapsulation vs Testability

Developer kadang membuat method/field public hanya supaya bisa dites.

Buruk:

```java
public BigDecimal calculateInternalFee(...) { ... } // public only for test
```

Alternatif:

1. Test lewat public behavior.
2. Extract package-private collaborator.
3. Extract pure function object.
4. Gunakan package-private test class di package sama.
5. Jika benar-benar penting, buat public karena memang API, bukan karena test.

Contoh package-private collaborator:

```java
final class FeeCalculator {
    Money calculateFor(Order order) {
        // pure-ish logic
    }
}
```

Test bisa berada di package yang sama:

```text
src/main/java/com/example/order/FeeCalculator.java
src/test/java/com/example/order/FeeCalculatorTest.java
```

Dengan begitu production public API tetap kecil.

---

## 20. Encapsulation vs Framework Reflection

Framework sering butuh reflection:

- dependency injection
- JSON serialization/deserialization
- ORM
- validation
- mapping
- testing/mocking

Masalah: reflection bisa melewati access modifier tertentu, tergantung access checks, module boundary, dan konfigurasi runtime.

JPMS memperkenalkan strong encapsulation dan membedakan `exports` untuk compile-time/public access serta `opens` untuk deep reflection. JEP 261 menjelaskan module system sebagai mekanisme reliable configuration dan strong encapsulation. [OpenJDK JEP 261](https://openjdk.org/jeps/261)

Contoh module descriptor:

```java
module com.example.order {
    exports com.example.order.api;

    opens com.example.order.persistence to org.hibernate.orm.core;
    opens com.example.order.api.dto to com.fasterxml.jackson.databind;
}
```

Maknanya:

- `com.example.order.api` adalah public API untuk module lain.
- package persistence tidak diekspor untuk compile-time dependency umum.
- package tertentu dibuka hanya untuk framework tertentu yang butuh reflection.

Ini lebih baik daripada:

```java
open module com.example.order {
    exports com.example.order.api;
}
```

Karena `open module` membuka semua package untuk deep reflection.

Guideline:

- Jangan design domain object semata-mata untuk memuaskan framework.
- Gunakan adapter/DTO/entity mapping jika framework butuh constructor kosong/setter.
- Batasi `opens` secara qualified bila memungkinkan.
- Jangan membuka package internal tanpa alasan jelas.
- Dokumentasikan reflective access sebagai bagian dari architecture boundary.

---

## 21. Encapsulation di Era Records

Record otomatis memberi accessor untuk semua component.

```java
public record Customer(String name, String email) { }
```

Artinya record cocok untuk data carrier/value carrier, bukan untuk menyembunyikan component.

Record tetap bisa menjaga invariant di compact constructor:

```java
public record CustomerName(String value) {
    public CustomerName {
        Objects.requireNonNull(value, "value");
        value = value.trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("Customer name must not be blank");
        }
    }
}
```

Tetapi record tidak cocok jika:

- component internal tidak boleh diekspos
- representation mungkin berubah drastis
- object punya lifecycle mutation kompleks
- accessor publik semua component akan menjadi beban compatibility

Record bagus untuk:

- small immutable value
- command/query/result payload
- DTO internal
- tuple bernama yang punya meaning
- generated model tertentu

Record bukan pengganti semua class.

---

## 22. Encapsulation dengan Sealed Types

Sealed hierarchy membantu mengontrol siapa yang boleh menjadi subtype.

Contoh:

```java
public sealed interface CaseDecision
        permits Approved, Rejected, ReturnedForClarification {
}

public record Approved(UserId approvedBy, Instant approvedAt) implements CaseDecision { }
public record Rejected(UserId rejectedBy, String reason, Instant rejectedAt) implements CaseDecision { }
public record ReturnedForClarification(String message) implements CaseDecision { }
```

Encapsulation di sini bukan menyembunyikan field, melainkan menyembunyikan/menutup **ruang kemungkinan subtype**.

Tanpa sealed, caller/library lain bisa membuat implementation liar:

```java
final class UnknownDecision implements CaseDecision { }
```

Dengan sealed, API designer mengontrol exhaustive domain alternatives.

Ini sangat cocok untuk:

- state machine result
- validation result
- command result
- error taxonomy
- finite workflow decision
- parser AST
- domain event family yang closed-set

Namun hati-hati untuk API publik yang harus extensible. Kalau pengguna library perlu menambah subtype, sealed bisa terlalu membatasi.

---

## 23. Encapsulation dan API Return Type

Return type adalah bagian dari contract.

Buruk:

```java
public ArrayList<OrderLine> lines() {
    return lines;
}
```

Masalah:

- caller tahu implementation detail `ArrayList`
- caller bisa mutate
- sulit ganti representation menjadi `LinkedHashSet`, persistent list, lazy view, dsb.

Lebih baik:

```java
public List<OrderLine> lines() {
    return List.copyOf(lines);
}
```

Atau jika hanya perlu iteration:

```java
public Iterable<OrderLine> lines() {
    return List.copyOf(lines);
}
```

Atau domain operation:

```java
public int lineCount() { ... }
public Money totalAmount() { ... }
public boolean containsProduct(ProductId productId) { ... }
```

Jangan expose collection kalau caller hanya butuh pertanyaan sederhana.

Design heuristic:

```text
Expose the least powerful abstraction that still lets caller do its legitimate job.
```

---

## 24. Encapsulation dan Parameter Type

Parameter juga bisa terlalu expose detail.

Buruk:

```java
public void importUsers(ArrayList<UserCsvRow> rows) { ... }
```

Kenapa harus `ArrayList`?

Lebih baik:

```java
public void importUsers(List<UserCsvRow> rows) { ... }
```

Atau kalau hanya iteration:

```java
public void importUsers(Iterable<UserCsvRow> rows) { ... }
```

Atau kalau method butuh stream-like lazy processing:

```java
public void importUsers(Stream<UserCsvRow> rows) { ... }
```

Tapi `Stream` sebagai parameter punya caveat: sekali pakai, lifecycle resource bisa tricky, dan caller harus paham ownership.

Rule:

- Terima interface/abstraction secukupnya.
- Return abstraction yang aman.
- Jangan menerima mutable object lalu menyimpannya tanpa copy.
- Jangan return mutable internal.

---

## 25. Encapsulation dan Exception Design

Exception juga bagian dari API surface.

Buruk:

```java
public void submit() throws Exception
```

Tidak jelas failure mode.

Lebih baik:

```java
public void submit() {
    if (lines.isEmpty()) {
        throw new EmptyOrderCannotBeSubmittedException(id);
    }
    if (status != OrderStatus.DRAFT) {
        throw new InvalidOrderStateException(id, status, OrderStatus.DRAFT);
    }
    status = OrderStatus.SUBMITTED;
}
```

Namun jangan juga membuat exception class terlalu banyak tanpa benefit.

Encapsulation failure mode berarti:

- caller tahu jenis kegagalan yang relevan
- internal detail tidak bocor
- message cukup diagnostik
- invariant violation tidak disembunyikan
- exception tidak membawa mutable internal object sembarangan

Contoh bocor:

```java
throw new ValidationException(errors); // errors mutable internal list
```

Lebih aman:

```java
throw new ValidationException(List.copyOf(errors));
```

---

## 26. Encapsulation dan Command/Query Separation

Command mengubah state. Query membaca state. Mencampurnya membuat behavior sulit dipahami.

Buruk:

```java
public OrderStatus status() {
    if (isExpired()) {
        status = OrderStatus.EXPIRED;
    }
    return status;
}
```

Caller mengira hanya membaca status, tapi state berubah.

Lebih eksplisit:

```java
public void expireIfNeeded(Instant now) { ... }
public OrderStatus status() { return status; }
```

Atau:

```java
public OrderStatus effectiveStatusAt(Instant now) { ... } // no mutation
```

Guideline:

- Query sebaiknya bebas side effect.
- Command boleh mutate, tapi nama harus menunjukkan intention.
- Kalau query mahal, dokumentasikan atau cache internal secara aman.
- Jangan sembunyikan network/database call dalam getter.

Getter yang melakukan I/O adalah kejutan buruk.

---

## 27. Encapsulation dan Temporal Coupling

Temporal coupling terjadi ketika method harus dipanggil dalam urutan tertentu, tetapi urutan itu tidak terlihat dari type/API.

Buruk:

```java
ReportBuilder builder = new ReportBuilder();
builder.setTitle("A");
builder.setRows(rows);
builder.validate();
Report report = builder.build();
```

Apa yang terjadi jika lupa `validate()`?

Lebih baik:

```java
Report report = Report.builder()
        .title("A")
        .rows(rows)
        .build();
```

`build()` melakukan validasi final.

Lebih kuat lagi jika step builder:

```java
Report report = ReportBuilder
        .withTitle("A")
        .withRows(rows)
        .build();
```

Temporal coupling juga muncul pada lifecycle object:

```java
connection.open();
connection.authenticate();
connection.send(data);
connection.close();
```

Kalau urutan wajib kompleks, pertimbangkan:

- state machine explicit
- separate type per phase
- factory method
- template method internal
- try-with-resources untuk resource lifecycle

Encapsulation berarti API sebaiknya membuat invalid sequence sulit dilakukan.

---

## 28. Encapsulation dan Builder Pattern

Builder membantu object dengan banyak parameter, tetapi builder juga bisa menjadi lubang invariant.

Buruk:

```java
Order order = new OrderBuilder()
        .status(OrderStatus.APPROVED)
        .approvedAt(null)
        .lines(List.of())
        .build();
```

Builder yang baik tetap validate:

```java
public Order build() {
    if (id == null) {
        throw new IllegalStateException("id is required");
    }
    if (lines.isEmpty()) {
        throw new IllegalStateException("lines are required");
    }
    return new Order(id, lines);
}
```

Untuk domain object dengan lifecycle, builder sebaiknya hanya membuat initial valid state.

Contoh:

```java
Order draft = Order.newDraft(id, customerId);
draft.addLine(...);
draft.submit(...);
```

Bukan:

```java
Order approved = Order.builder()
        .status(APPROVED)
        .approvedBy(user)
        .build();
```

Kecuali builder khusus reconstruction dari persistence:

```java
static Order rehydrate(OrderSnapshot snapshot) { ... }
```

Pisahkan:

- construction untuk new object
- rehydration dari persistence
- test fixture builder
- API request builder

Jangan biarkan test convenience merusak production invariant.

---

## 29. Encapsulation dan Rehydration dari Database

ORM/persistence sering memaksa object bisa dibuat ulang dari database.

Masalah:

```java
protected Order() { } // for ORM
public void setStatus(OrderStatus status) { ... } // for ORM
```

Ini bisa membuka jalan caller biasa membuat state invalid.

Alternatif:

1. Gunakan persistence entity terpisah dari domain object.
2. Gunakan package-private constructor/factory untuk rehydration.
3. Gunakan static factory yang validate snapshot.
4. Batasi setter sebagai package-private jika framework memungkinkan.
5. Gunakan module `opens` hanya untuk package persistence.

Contoh:

```java
public final class Order {
    private final OrderId id;
    private final List<OrderLine> lines;
    private OrderStatus status;

    private Order(OrderId id, List<OrderLine> lines, OrderStatus status) {
        this.id = Objects.requireNonNull(id);
        this.lines = new ArrayList<>(List.copyOf(lines));
        this.status = Objects.requireNonNull(status);
        validateInvariant();
    }

    public static Order newDraft(OrderId id) {
        return new Order(id, List.of(), OrderStatus.DRAFT);
    }

    static Order rehydrate(OrderSnapshot snapshot) {
        return new Order(snapshot.id(), snapshot.lines(), snapshot.status());
    }

    private void validateInvariant() {
        if (status != OrderStatus.DRAFT && lines.isEmpty()) {
            throw new IllegalStateException("Non-draft order must have lines");
        }
    }
}
```

`rehydrate` package-private membuat repository di package sama bisa memanggil, tetapi caller luar tidak.

---

## 30. Encapsulation dan Generated Code

Generated code sering berupa data carrier:

- OpenAPI model
- protobuf class
- JAXB class
- MapStruct generated mapper
- annotation processor output
- query DSL

Generated code biasanya tidak ideal sebagai domain object.

Masalah jika generated model menjadi core domain:

- field mengikuti schema eksternal
- naming mengikuti contract eksternal
- nullability bisa tidak sesuai domain
- versioning mengikuti provider eksternal
- validation sering lemah
- backward compatibility domain dikontrol oleh generator

Lebih aman:

```text
External/generated DTO -> Mapper -> Domain object
Domain object -> Mapper -> External/generated DTO
```

Encapsulation boundary:

```text
generated code is a boundary artifact, not the center of business truth
```

Kecuali untuk sistem yang memang schema-first dan domain-nya tipis, tetap perlu jelas: generated code adalah source of truth atau hanya adapter?

---

## 31. Encapsulation dan Reflection/Serialization Holes

Reflection dan serialization bisa membuat object tanpa melewati constructor normal atau mengisi field langsung, tergantung framework.

Risiko:

- final field semantics terganggu oleh unsafe framework behavior
- constructor validation dilewati
- private field diisi invalid
- object partially initialized
- invariant hanya berlaku setelah framework callback
- no-arg constructor membuat state sementara invalid

Guideline:

- Pahami framework construction model.
- Jangan asumsikan constructor selalu dipanggil kecuali terbukti.
- Tambahkan validation after deserialization jika perlu.
- Gunakan DTO untuk serialization jika domain object sensitif.
- Batasi reflective access via module/package design.
- Test object creation path yang dipakai framework, bukan hanya manual constructor.

Contoh pattern:

```java
public record CreateOrderRequest(List<CreateOrderLineRequest> lines) {
    public CreateOrderRequest {
        lines = List.copyOf(Objects.requireNonNull(lines, "lines"));
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("lines must not be empty");
        }
    }
}
```

Untuk framework yang compatible dengan record, ini bagus. Untuk framework yang butuh no-arg/setter, gunakan DTO mutable lalu map ke domain object.

---

## 32. Encapsulation dan Modules

Sebelum JPMS, Java hanya punya class/package visibility pada level bahasa. Dengan module system, kita bisa mengontrol package mana yang diekspor ke module lain.

Contoh:

```java
module com.acme.caseflow {
    exports com.acme.caseflow.api;
    exports com.acme.caseflow.spi;

    opens com.acme.caseflow.adapter.jackson to com.fasterxml.jackson.databind;

    requires java.base;
}
```

Internal package tidak diekspor:

```text
com.acme.caseflow.internal
com.acme.caseflow.domain
com.acme.caseflow.persistence
```

Module lain tidak bisa compile against package tersebut jika tidak diekspor.

Ini memperkuat encapsulation:

```text
class private boundary
package-private boundary
module exports boundary
artifact dependency boundary
runtime module graph boundary
```

Namun JPMS tidak otomatis membuat desain bagus. Kalau semua package diekspor, module hanya menjadi label.

---

## 33. Encapsulation dan Architectural Boundaries

Encapsulation juga berlaku di level lebih besar dari class.

| Level | Encapsulation Boundary | Contoh |
|---|---|---|
| Method | local variables, pre/post condition | helper hides algorithm detail |
| Class | private fields/methods | `Order` protects lifecycle |
| Package | package-private collaboration | internal validators/calculators |
| Module | exported vs internal packages | JPMS API boundary |
| Artifact | dependency/API jar | `order-api` vs `order-impl` |
| Service | network contract | REST/gRPC/event schema |
| Bounded context | domain language boundary | case vs appeal vs compliance |

Top engineer tidak melihat encapsulation hanya sebagai OOP topic. Encapsulation adalah prinsip arsitektur: setiap boundary harus jelas apa yang disembunyikan dan apa yang dikontrakkan.

---

## 34. Anti-Pattern: Anemic Object dengan Setter Everywhere

Anemic model:

```java
public class Application {
    private ApplicationStatus status;
    private Instant submittedAt;
    private UserId submittedBy;

    public void setStatus(ApplicationStatus status) { this.status = status; }
    public void setSubmittedAt(Instant submittedAt) { this.submittedAt = submittedAt; }
    public void setSubmittedBy(UserId submittedBy) { this.submittedBy = submittedBy; }
}
```

Logic tersebar:

```java
application.setStatus(SUBMITTED);
application.setSubmittedAt(now);
application.setSubmittedBy(userId);
```

Kemungkinan bug:

- status submitted tanpa timestamp
- timestamp ada tapi status draft
- submittedBy null
- transition dari rejected ke submitted tanpa rule
- audit tidak dibuat

Better:

```java
public void submit(UserId submittedBy, Instant submittedAt) {
    if (status != ApplicationStatus.DRAFT) {
        throw new IllegalStateException("Only draft application can be submitted");
    }
    if (!hasRequiredDocuments()) {
        throw new IllegalStateException("Required documents are missing");
    }
    this.status = ApplicationStatus.SUBMITTED;
    this.submittedBy = Objects.requireNonNull(submittedBy);
    this.submittedAt = Objects.requireNonNull(submittedAt);
}
```

Namun jangan ekstrem memasukkan semua use-case ke entity. Rule yang memerlukan repository, authorization, external system, atau cross-aggregate coordination lebih cocok di application/domain service.

---

## 35. Anti-Pattern: Encapsulation Palsu dengan DTO sebagai Domain

Contoh:

```java
public class CaseDto {
    public String status;
    public String officerId;
    public String dueDate;
    public List<DocumentDto> documents;
}
```

Lalu dipakai di seluruh service sebagai domain model.

Masalah:

- stringly typed
- null everywhere
- no invariant
- no lifecycle method
- external format mengontrol internal
- sulit enforce rule
- fragile terhadap API change

DTO boleh ada. Tetapi DTO sebaiknya boundary model, bukan pusat domain.

---

## 36. Anti-Pattern: Over-Encapsulation

Encapsulation juga bisa berlebihan.

Contoh:

```java
public final class UserName {
    private final String value;

    private UserName(String value) { ... }

    public static UserName fromString(String value) { ... }

    public String asString() { ... }
}
```

Ini bisa bagus jika `UserName` punya rule. Tetapi kalau semua string trivial dibungkus tanpa benefit, sistem menjadi noisy.

Tanda over-encapsulation:

- terlalu banyak tiny classes tanpa invariant
- API sulit dipakai
- mapping membengkak
- engineer baru sulit memahami flow
- abstraction hanya menyembunyikan satu line code
- semua hal jadi private sampai test butuh reflection

Rule sehat:

> Encapsulate where there is invariant, policy, ownership, lifecycle, or change pressure.

Jangan encapsulate hanya untuk terlihat “pure OOP”.

---

## 37. Anti-Pattern: Leaky Abstraction

Leaky abstraction terjadi ketika API terlihat menyembunyikan detail, tetapi caller tetap harus tahu internal.

Contoh:

```java
public interface UserRepository {
    User findById(String id);
}
```

Tampak simple. Tapi caller harus tahu:

- apakah return null?
- apakah throw jika tidak ditemukan?
- apakah lazy-loaded?
- apakah transaction harus aktif?
- apakah User mutable attached entity?
- apakah caller boleh modify?

Lebih eksplisit:

```java
public interface UserRepository {
    Optional<User> findById(UserId id);
}
```

Atau:

```java
public interface UserRepository {
    User getExisting(UserId id) throws UserNotFoundException;
}
```

Encapsulation tidak berarti menyembunyikan semua hal. Ia berarti menyembunyikan detail yang tidak relevan, tetapi **mengungkap contract yang relevan**.

---

## 38. Designing Encapsulated Domain Object: Step-by-Step

Misal kita desain `CaseFile`.

### Step 1: Tentukan invariant

```text
- id wajib ada
- status tidak null
- closedAt hanya boleh ada jika status CLOSED
- assignedOfficer wajib ada jika status IN_REVIEW
- closed case tidak boleh dimodifikasi
```

### Step 2: Tentukan lifecycle

```text
DRAFT -> SUBMITTED -> IN_REVIEW -> APPROVED/REJECTED -> CLOSED
```

### Step 3: Hindari setter mentah

Jangan:

```java
setStatus(...)
setClosedAt(...)
setAssignedOfficer(...)
```

### Step 4: Buat operation berbasis intention

```java
submit(...)
assignTo(...)
approve(...)
reject(...)
close(...)
```

### Step 5: Pilih type kuat

```java
CaseId, UserId, RejectReason, CaseStatus
```

### Step 6: Proteksi mutable state

```java
List.copyOf(events)
```

### Step 7: Pisahkan external dependencies

Jangan inject email client ke `CaseFile`. Gunakan domain event/application service.

### Step 8: Sediakan snapshot/projection jika perlu

```java
public CaseSnapshot snapshot() { ... }
```

### Step 9: Batasi rehydration

```java
static CaseFile rehydrate(CaseSnapshot snapshot) { ... }
```

### Step 10: Test invariant, bukan getter/setter

Test:

```text
cannot approve draft case
cannot close already closed case
submitted case records submittedBy and submittedAt
closed case cannot be assigned
```

---

## 39. Example: Encapsulated CaseFile

```java
public final class CaseFile {
    private final CaseId id;
    private final List<CaseEvent> events = new ArrayList<>();

    private CaseStatus status;
    private UserId submittedBy;
    private Instant submittedAt;
    private UserId assignedOfficer;
    private UserId closedBy;
    private Instant closedAt;

    private CaseFile(CaseId id, CaseStatus status) {
        this.id = Objects.requireNonNull(id, "id");
        this.status = Objects.requireNonNull(status, "status");
        validateInvariant();
    }

    public static CaseFile draft(CaseId id) {
        return new CaseFile(id, CaseStatus.DRAFT);
    }

    public void submit(UserId userId, Instant now) {
        requireStatus(CaseStatus.DRAFT);
        this.submittedBy = Objects.requireNonNull(userId, "userId");
        this.submittedAt = Objects.requireNonNull(now, "now");
        this.status = CaseStatus.SUBMITTED;
        events.add(new CaseSubmitted(id, userId, now));
        validateInvariant();
    }

    public void assignTo(UserId officerId, Instant now) {
        requireStatus(CaseStatus.SUBMITTED);
        this.assignedOfficer = Objects.requireNonNull(officerId, "officerId");
        this.status = CaseStatus.IN_REVIEW;
        events.add(new CaseAssigned(id, officerId, now));
        validateInvariant();
    }

    public void close(UserId userId, Instant now) {
        if (status == CaseStatus.CLOSED) {
            throw new IllegalStateException("Case is already closed");
        }
        this.closedBy = Objects.requireNonNull(userId, "userId");
        this.closedAt = Objects.requireNonNull(now, "now");
        this.status = CaseStatus.CLOSED;
        events.add(new CaseClosed(id, userId, now));
        validateInvariant();
    }

    public List<CaseEvent> pullEvents() {
        List<CaseEvent> copy = List.copyOf(events);
        events.clear();
        return copy;
    }

    public CaseStatus status() {
        return status;
    }

    public CaseId id() {
        return id;
    }

    private void requireStatus(CaseStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("Expected status " + expected + " but was " + status);
        }
    }

    private void validateInvariant() {
        if (status == CaseStatus.CLOSED && closedAt == null) {
            throw new IllegalStateException("Closed case must have closedAt");
        }
        if (status == CaseStatus.IN_REVIEW && assignedOfficer == null) {
            throw new IllegalStateException("In-review case must have assigned officer");
        }
    }
}
```

Catatan desain:

- `status` tidak punya setter.
- `submittedBy`, `closedAt`, `assignedOfficer` hanya berubah lewat operation.
- `events` tidak diekspos langsung.
- invariant dicek setelah mutation.
- lifecycle eksplisit.

---

## 40. Encapsulation Checklist untuk Code Review

Gunakan checklist ini saat review class/domain/API:

### State

- Apakah field mutable benar-benar perlu mutable?
- Apakah mutable collection bocor keluar?
- Apakah constructor menyimpan reference input mutable tanpa copy?
- Apakah getter mengembalikan internal mutable object?
- Apakah derived state bisa stale?

### Invariant

- Apa invariant object ini?
- Di mana invariant divalidasi?
- Apakah semua public method menjaga invariant?
- Apakah ada setter yang bisa membuat state invalid?
- Apakah object bisa dibuat dalam state invalid?

### API

- Apakah public method terlalu banyak?
- Apakah method public hanya ada untuk test/framework?
- Apakah nama method menggambarkan intention?
- Apakah parameter memakai primitive/string padahal perlu domain type?
- Apakah return type membocorkan implementation detail?

### Lifecycle

- Apakah transition state eksplisit?
- Apakah invalid transition mustahil/sulit dilakukan?
- Apakah status bisa diubah langsung?
- Apakah timestamp/user/reason terkait transition dijaga bersama?

### Boundary

- Apakah class ini DTO, entity, domain object, service, atau adapter?
- Apakah generated/external model masuk terlalu dalam?
- Apakah package-private sudah dimanfaatkan?
- Apakah module exports/opens terlalu luas?
- Apakah reflection framework bisa melanggar invariant?

---

## 41. Decision Matrix: Bentuk API yang Tepat

| Situasi | API yang Lebih Tepat |
|---|---|
| Data carrier tanpa behavior | record/DTO |
| Object punya invariant sederhana | constructor/factory validation |
| Object punya lifecycle | intention method, no raw setter |
| Collection internal | defensive copy/unmodifiable view |
| Elemen mutable | deep copy atau immutable element |
| Butuh framework binding | DTO/entity terpisah atau controlled reflective access |
| Logic butuh external dependency | service/policy object, bukan entity gemuk |
| Internal helper | package-private class |
| Library public API | minimal, stable, documented |
| Closed set subtype | sealed hierarchy |
| External extensibility | interface/SPI, bukan sealed |

---

## 42. Practical Heuristics

1. **Private field adalah awal, bukan akhir.**
2. **Setter mentah adalah warning sign untuk domain object.**
3. **Public API harus intention-revealing.**
4. **Invariant harus dekat dengan state yang dijaga.**
5. **Jangan expose mutable internal collection.**
6. **Gunakan package-private untuk internal collaboration.**
7. **Gunakan domain value object untuk rule kecil yang sering tersebar.**
8. **DTO boleh bodoh; domain object jangan bodoh.**
9. **Framework compatibility jangan mengorbankan domain invariant tanpa boundary.**
10. **Module exports/opens adalah bagian dari encapsulation modern Java.**

---

## 43. Kesalahan Berpikir yang Harus Dihindari

### “Semua field private berarti sudah encapsulated”

Salah. Kalau semua field punya getter/setter bebas, invariant tetap bocor.

### “Getter/setter selalu buruk”

Salah. DTO, projection, config, dan framework model sering wajar memakai getter/setter.

### “Domain object harus memuat semua business logic”

Salah. Logic yang butuh repository, authorization, external service, atau cross-aggregate coordination biasanya lebih cocok di service/policy.

### “Immutable selalu lebih baik”

Tidak selalu. Lifecycle object sering lebih natural mutable, asal mutation terkontrol.

### “Reflection membuat access modifier tidak penting”

Salah. Access modifier tetap penting untuk compile-time contract, readability, tooling, module boundary, dan default safety. Reflection adalah privileged escape hatch, bukan desain normal.

### “Package-private itu jarang dipakai”

Justru package-private sangat berguna untuk membuat internal collaboration tanpa memperbesar public API.

---

## 44. Mini Exercise

Desain ulang class berikut agar lebih encapsulated:

```java
public class LeaveRequest {
    private String status;
    private LocalDate startDate;
    private LocalDate endDate;
    private String requesterId;
    private String approverId;
    private String rejectionReason;

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDate getStartDate() { return startDate; }
    public void setStartDate(LocalDate startDate) { this.startDate = startDate; }
    public LocalDate getEndDate() { return endDate; }
    public void setEndDate(LocalDate endDate) { this.endDate = endDate; }
    public String getRequesterId() { return requesterId; }
    public void setRequesterId(String requesterId) { this.requesterId = requesterId; }
    public String getApproverId() { return approverId; }
    public void setApproverId(String approverId) { this.approverId = approverId; }
    public String getRejectionReason() { return rejectionReason; }
    public void setRejectionReason(String rejectionReason) { this.rejectionReason = rejectionReason; }
}
```

Pertanyaan:

1. Apa invariant-nya?
2. Apa lifecycle-nya?
3. Field mana yang harus immutable?
4. Status apa yang valid?
5. Operation apa yang harus ada?
6. Apakah rejected request wajib punya rejection reason?
7. Apakah approved request wajib punya approver?
8. Apakah requester boleh approve request sendiri?
9. Apakah date range valid?
10. Apakah model ini DTO atau domain object?

Sketsa perbaikan:

```java
public final class LeaveRequest {
    private final LeaveRequestId id;
    private final UserId requesterId;
    private final DateRange period;

    private LeaveStatus status = LeaveStatus.DRAFT;
    private UserId approverId;
    private String rejectionReason;

    public LeaveRequest(LeaveRequestId id, UserId requesterId, DateRange period) {
        this.id = Objects.requireNonNull(id);
        this.requesterId = Objects.requireNonNull(requesterId);
        this.period = Objects.requireNonNull(period);
    }

    public void submit() {
        requireStatus(LeaveStatus.DRAFT);
        status = LeaveStatus.SUBMITTED;
    }

    public void approve(UserId approverId) {
        requireStatus(LeaveStatus.SUBMITTED);
        if (requesterId.equals(approverId)) {
            throw new IllegalArgumentException("Requester cannot approve own leave");
        }
        this.approverId = Objects.requireNonNull(approverId);
        this.status = LeaveStatus.APPROVED;
    }

    public void reject(UserId approverId, String reason) {
        requireStatus(LeaveStatus.SUBMITTED);
        if (requesterId.equals(approverId)) {
            throw new IllegalArgumentException("Requester cannot reject own leave");
        }
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("Rejection reason is required");
        }
        this.approverId = approverId;
        this.rejectionReason = reason;
        this.status = LeaveStatus.REJECTED;
    }

    private void requireStatus(LeaveStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + status);
        }
    }
}
```

---

## 45. Ringkasan Part 004

Encapsulation bukan ritual `private field + getter/setter`. Encapsulation adalah disiplin desain untuk menjaga object, package, module, dan API tetap valid, stabil, dan bebas dari coupling yang tidak perlu.

Yang harus dibawa dari part ini:

- Access modifier hanya alat; invariant adalah tujuan.
- Object yang baik punya state ownership jelas.
- Mutable state boleh, tetapi mutation harus melalui operation bermakna.
- Getter/setter tidak otomatis buruk, tetapi berbahaya untuk domain object yang punya lifecycle.
- Public API adalah hutang compatibility.
- Package-private adalah senjata penting untuk desain internal Java.
- Reflection/framework/code generation harus diperlakukan sebagai boundary risk.
- JPMS menambah lapisan encapsulation melalui exports/opens.
- Encapsulation berlaku dari method sampai service boundary.

---

## 46. Referensi

- Java Language Specification, Java SE 25, terutama section 6.6 tentang access control: https://docs.oracle.com/javase/specs/jls/se25/html/index.html
- Java SE 25 API, `java.util.List`, terutama `List.of` dan `List.copyOf` untuk unmodifiable list: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html
- OpenJDK JEP 261, Module System, reliable configuration dan strong encapsulation: https://openjdk.org/jeps/261
- Java SE 25 API, `java.lang.Object`, object contract foundation: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html

---

## 47. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-005.md
```

Topik berikutnya:

```text
Inheritance Deep Dive: Substitutability, Fragility, and Runtime Dispatch
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-003](./learn-java-oop-functional-reflection-codegen-modules-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-005](./learn-java-oop-functional-reflection-codegen-modules-part-005.md)
