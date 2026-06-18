# learn-java-oop-functional-reflection-codegen-modules-part-007
# Sealed Classes and Controlled Hierarchies

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `007`  
> Topik: `Sealed Classes and Controlled Hierarchies`  
> Target: Java engineer yang ingin memahami sealed type bukan sebagai fitur syntax, tetapi sebagai alat desain untuk membatasi ekstensi, memperjelas domain model, mendukung exhaustive reasoning, dan menjaga evolusi API.

---

## 1. Tujuan Bagian Ini

Setelah bagian sebelumnya tentang interface, kita sekarang masuk ke satu konsep yang sangat penting untuk desain model modern Java: **sealed classes and sealed interfaces**.

Secara permukaan, sealed type terlihat sederhana:

```java
public sealed interface PaymentResult permits PaymentSuccess, PaymentRejected, PaymentPending {
}
```

Namun secara desain, ini bukan sekadar cara baru menulis inheritance. Ini adalah alat untuk menjawab pertanyaan arsitektural:

> “Siapa saja yang boleh menjadi subtype dari abstraction ini?”

Pada inheritance/interface biasa, jawabannya terbuka:

```java
public interface PaymentResult {
}
```

Siapa pun bisa membuat implementation baru selama terlihat dari classpath/module path.

Pada sealed hierarchy, jawabannya dikendalikan:

```java
public sealed interface PaymentResult
        permits PaymentSuccess, PaymentRejected, PaymentPending {
}
```

Hanya tipe yang disebut di `permits` yang boleh menjadi direct subtype.

Bagian ini membahas:

1. Apa masalah desain yang diselesaikan sealed type.
2. Perbedaan sealed, final, non-sealed, abstract, interface, enum, dan record.
3. Bagaimana sealed type membantu exhaustive reasoning.
4. Bagaimana sealed type cocok untuk state machine, command/result model, error taxonomy, dan API boundary.
5. Bagaimana sealed hierarchy berdampak pada module, package, reflection, serialization, code generation, dan API evolution.
6. Kapan sealed type adalah pilihan tepat dan kapan menjadi overengineering.

---

## 2. Mental Model Utama

### 2.1 Sebelum sealed type: Java hanya punya open dan closed secara ekstrem

Sebelum sealed classes menjadi fitur final di Java 17, Java punya dua pilihan besar:

#### Opsi 1 — Open hierarchy

```java
public interface Notification {
}
```

Atau:

```java
public abstract class Notification {
}
```

Artinya:

- siapa pun bisa membuat subtype;
- compiler tidak tahu semua kemungkinan subtype;
- `switch`/pattern matching tidak bisa benar-benar exhaustive secara aman;
- library author sulit menjaga invariant hierarchy;
- API consumer bisa membuat extension yang mungkin tidak diantisipasi.

#### Opsi 2 — Fully closed type

```java
public final class EmailNotification {
}
```

Atau enum:

```java
public enum NotificationKind {
    EMAIL,
    SMS,
    PUSH
}
```

Artinya:

- tidak ada subtype baru untuk `final class`;
- enum punya fixed constants;
- cocok untuk finite flat values;
- kurang cocok untuk variant yang punya struktur data dan behavior berbeda-beda.

Sealed type mengisi ruang tengah:

> “Hierarchy ini boleh punya subtype, tapi subtype langsungnya dikontrol.”

---

### 2.2 Sealed type adalah controlled openness

Sealed type bukan “anti inheritance”. Justru sealed type adalah inheritance yang lebih eksplisit.

```java
public sealed interface CaseEvent
        permits CaseCreated, CaseAssigned, CaseClosed {
}

public record CaseCreated(String caseId, String createdBy) implements CaseEvent {
}

public record CaseAssigned(String caseId, String officerId) implements CaseEvent {
}

public record CaseClosed(String caseId, String reason) implements CaseEvent {
}
```

Model ini menyatakan:

- `CaseEvent` adalah abstraction;
- ada beberapa variasi valid;
- variasi langsungnya diketahui;
- compiler dan reader bisa memahami domain boundary;
- caller tidak perlu mengasumsikan subtype liar di luar daftar.

Ini sangat berguna untuk domain yang bersifat finite tetapi setiap variasi memiliki data berbeda.

---

### 2.3 Sealed type membuat hierarchy menjadi bagian dari contract

Dalam open interface, subtype yang ada hanyalah detail implementasi saat ini.

Dalam sealed interface, daftar permitted subtype adalah bagian dari contract desain.

```java
public sealed interface ApplicationDecision
        permits Approved, Rejected, NeedMoreInfo {
}
```

Kalimat desainnya:

> “Keputusan aplikasi hanya bisa berada dalam salah satu dari tiga bentuk langsung ini.”

Itu berbeda dari:

```java
public interface ApplicationDecision {
}
```

Yang secara implisit berkata:

> “Keputusan aplikasi bisa diimplementasikan oleh siapa saja.”

Perbedaan ini penting untuk API publik, domain model, state machine, dan generated code.

---

## 3. Syntax Dasar Sealed Types

### 3.1 Sealed class

```java
public sealed abstract class Shape
        permits Circle, Rectangle, Triangle {
}

public final class Circle extends Shape {
    private final double radius;

    public Circle(double radius) {
        if (radius <= 0) {
            throw new IllegalArgumentException("radius must be positive");
        }
        this.radius = radius;
    }

    public double radius() {
        return radius;
    }
}

public final class Rectangle extends Shape {
    private final double width;
    private final double height;

    public Rectangle(double width, double height) {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("width and height must be positive");
        }
        this.width = width;
        this.height = height;
    }

    public double width() {
        return width;
    }

    public double height() {
        return height;
    }
}

public final class Triangle extends Shape {
    private final double base;
    private final double height;

    public Triangle(double base, double height) {
        if (base <= 0 || height <= 0) {
            throw new IllegalArgumentException("base and height must be positive");
        }
        this.base = base;
        this.height = height;
    }

    public double base() {
        return base;
    }

    public double height() {
        return height;
    }
}
```

`Shape` hanya boleh diperluas langsung oleh `Circle`, `Rectangle`, dan `Triangle`.

---

### 3.2 Sealed interface

```java
public sealed interface DocumentCommand
        permits CreateDocument, ApproveDocument, RejectDocument {
}

public record CreateDocument(String title, String authorId) implements DocumentCommand {
}

public record ApproveDocument(String documentId, String approverId) implements DocumentCommand {
}

public record RejectDocument(String documentId, String rejectorId, String reason) implements DocumentCommand {
}
```

Dalam praktik modern Java, sealed interface + record sering menjadi kombinasi yang sangat kuat untuk command, event, result, dan domain variant.

---

### 3.3 Permitted subclass harus memilih final/sealed/non-sealed

Setiap direct subclass dari sealed class atau direct implementor dari sealed interface harus menyatakan salah satu:

1. `final`
2. `sealed`
3. `non-sealed`

Contoh:

```java
public sealed interface RiskFinding
        permits MinorFinding, MajorFinding, RegulatoryFinding {
}

public final class MinorFinding implements RiskFinding {
}

public sealed class MajorFinding implements RiskFinding
        permits DocumentationGap, ProcessViolation {
}

public non-sealed class RegulatoryFinding implements RiskFinding {
}
```

Maknanya:

- `MinorFinding` berhenti di sana, tidak bisa diturunkan lagi.
- `MajorFinding` masih sealed dan mengontrol subtype berikutnya.
- `RegulatoryFinding` membuka kembali hierarchy di bawahnya.

Ini memberi desain granular:

```text
RiskFinding (sealed)
├── MinorFinding (final)
├── MajorFinding (sealed)
│   ├── DocumentationGap (final)
│   └── ProcessViolation (final)
└── RegulatoryFinding (non-sealed)
    └── arbitrary external subclasses allowed
```

---

## 4. Makna `sealed`, `final`, dan `non-sealed`

### 4.1 `final`: hierarchy berhenti

```java
public final class Approved implements Decision {
}
```

Makna desain:

> Tidak ada variasi lebih lanjut dari `Approved`.

Gunakan `final` ketika:

- tipe sudah konkret;
- invariant sudah lengkap;
- tidak ada kebutuhan extension;
- tipe adalah record/value carrier;
- subtype tambahan akan membingungkan domain.

---

### 4.2 `sealed`: hierarchy tetap dikontrol

```java
public sealed class Rejected implements Decision
        permits AutoRejected, ManualRejected {
}
```

Makna desain:

> `Rejected` masih punya variasi, tetapi variasi langsungnya juga dikontrol.

Gunakan ketika:

- subtype masih punya klasifikasi bermakna;
- domain perlu nested taxonomy;
- setiap tingkat hierarchy punya invariant berbeda;
- exhaustive reasoning tetap dibutuhkan.

---

### 4.3 `non-sealed`: hierarchy dibuka kembali

```java
public non-sealed class ExternalDecision implements Decision {
}
```

Makna desain:

> Mulai dari titik ini, pihak lain boleh membuat subtype.

Gunakan dengan hati-hati.

`non-sealed` berguna ketika:

- sebagian hierarchy perlu closed;
- sebagian perlu extension point;
- library ingin menyediakan official extension branch;
- plugin architecture butuh titik terbuka.

Contoh:

```java
public sealed interface RuleResult
        permits Passed, Failed, VendorSpecificResult {
}

public record Passed() implements RuleResult {
}

public record Failed(String code, String message) implements RuleResult {
}

public non-sealed interface VendorSpecificResult extends RuleResult {
}
```

Di sini `RuleResult` tetap punya tiga kategori utama, tetapi vendor boleh menambahkan subtype di bawah `VendorSpecificResult`.

---

## 5. Package dan Module Constraint

### 5.1 Permitted subtype harus dekat secara compilation/runtime boundary

Sealed hierarchy bukan hanya syntax. Ia berhubungan dengan visibility, package, module, dan compilation unit.

Aturan praktis:

- Jika hierarchy berada di unnamed module, permitted subtype harus berada dalam package yang sama.
- Jika berada di named module, permitted subtype harus berada dalam module yang sama.

Tujuannya: sealed root harus benar-benar bisa mengontrol subtype langsungnya.

Jangan mendesain sealed public API yang berharap subtype langsungnya dibuat oleh artifact/module lain. Itu bertentangan dengan semangat sealed type.

Kalau butuh extension dari module luar, pertimbangkan:

- open interface biasa;
- SPI dengan `ServiceLoader`;
- sealed root dengan branch `non-sealed`;
- plugin abstraction terpisah.

---

### 5.2 Sealed type bukan pengganti module boundary

Sealed type menjawab:

> “Siapa direct subtype dari abstraction ini?”

JPMS/module boundary menjawab:

> “Package mana yang diekspor? Package mana yang hanya internal? Module mana yang dibaca?”

Package structure menjawab:

> “Kode ini dikelompokkan secara konseptual di mana?”

Artifact/build dependency menjawab:

> “Komponen mana yang dikirim dan diversi bersama?”

Jangan mencampur konsep:

```text
sealed type  -> subtype control
package      -> namespace + package-private boundary
module       -> strong encapsulation + reliable configuration
artifact     -> delivery/versioning unit
```

Sealed type bagus jika digabung dengan package/module boundary, tetapi tidak menggantikan keduanya.

---

## 6. Sealed Type vs Enum

### 6.1 Enum cocok untuk finite constants yang flat

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Gunakan enum ketika:

- daftar nilai finite;
- setiap nilai relatif seragam;
- tidak butuh data berbeda per variant;
- persistensi bisa dikontrol;
- tidak butuh hierarchy lebih dalam.

---

### 6.2 Sealed type cocok untuk finite variants dengan struktur berbeda

```java
public sealed interface ApplicationOutcome
        permits Approved, Rejected, PendingClarification {
}

public record Approved(String approvalNo, String approvedBy) implements ApplicationOutcome {
}

public record Rejected(String reasonCode, String reasonText) implements ApplicationOutcome {
}

public record PendingClarification(String question, LocalDate dueDate) implements ApplicationOutcome {
}
```

Setiap variant punya struktur berbeda.

Kalau dipaksa memakai enum, desainnya bisa menjadi stringly typed:

```java
public final class ApplicationOutcome {
    private final ApplicationOutcomeKind kind;
    private final String approvalNo;
    private final String approvedBy;
    private final String reasonCode;
    private final String reasonText;
    private final String question;
    private final LocalDate dueDate;
}
```

Masalah:

- field valid tergantung `kind`;
- banyak nullable field;
- invariant tersembunyi;
- caller harus hafal kombinasi valid;
- object bisa berada dalam state tidak valid.

Sealed type memperbaiki ini:

```java
public sealed interface ApplicationOutcome permits Approved, Rejected, PendingClarification {
}
```

Sekarang setiap shape data punya tipe sendiri.

---

### 6.3 Decision matrix enum vs sealed

| Kebutuhan | Enum | Sealed Type |
|---|---:|---:|
| Finite values | Sangat cocok | Cocok |
| Data sama untuk semua variant | Cocok | Bisa, tapi mungkin berlebihan |
| Data berbeda per variant | Kurang cocok | Sangat cocok |
| Behavior berbeda per variant | Bisa dengan constant-specific body | Cocok |
| Nested taxonomy | Kurang cocok | Cocok |
| Exhaustive switch | Cocok | Cocok |
| Persistensi sederhana | Cocok | Butuh desain eksplisit |
| API evolution mudah | Sedang | Perlu hati-hati |
| Domain invariant kuat | Sedang | Sangat cocok |

---

## 7. Sealed Type vs Abstract Class

### 7.1 Abstract class biasa tetap open

```java
public abstract class CaseAction {
}
```

Ini tidak membatasi subtype.

Siapa pun bisa menulis:

```java
public final class WeirdCaseAction extends CaseAction {
}
```

Jika `CaseAction` adalah domain model yang harus finite, abstract class biasa terlalu terbuka.

---

### 7.2 Sealed abstract class mengontrol subtype

```java
public sealed abstract class CaseAction
        permits AssignCase, CloseCase, ReopenCase {
}
```

Gunakan sealed abstract class ketika:

- variant perlu share state atau method implementation;
- root type perlu constructor;
- root type punya protected helper yang benar-benar diperlukan;
- ada invariant bersama.

Namun hati-hati: abstract class membawa risiko inheritance coupling. Jika tidak perlu shared state/implementation, sealed interface biasanya lebih bersih.

---

### 7.3 Sealed interface biasanya lebih fleksibel

```java
public sealed interface CaseAction
        permits AssignCase, CloseCase, ReopenCase {
}
```

Dengan record:

```java
public record AssignCase(String caseId, String officerId) implements CaseAction {
}

public record CloseCase(String caseId, String reason) implements CaseAction {
}

public record ReopenCase(String caseId, String reopenedBy) implements CaseAction {
}
```

Keuntungan:

- tidak ada inheritance state coupling;
- setiap variant bisa final immutable record;
- domain shape lebih eksplisit;
- cocok untuk command/event/result;
- lebih mudah diuji;
- lebih mudah diserialisasi dengan type discriminator jika framework mendukung.

---

## 8. Sealed Type vs Visitor Pattern

### 8.1 Visitor pattern klasik

Sebelum pattern matching modern, closed hierarchy sering diproses dengan visitor pattern.

```java
public interface Expression {
    <R> R accept(ExpressionVisitor<R> visitor);
}

public interface ExpressionVisitor<R> {
    R visitLiteral(Literal literal);
    R visitAdd(Add add);
    R visitMultiply(Multiply multiply);
}
```

Dengan implementasi:

```java
public final class Literal implements Expression {
    private final int value;

    public Literal(int value) {
        this.value = value;
    }

    public int value() {
        return value;
    }

    @Override
    public <R> R accept(ExpressionVisitor<R> visitor) {
        return visitor.visitLiteral(this);
    }
}
```

Visitor berguna, tetapi verbose.

---

### 8.2 Sealed + pattern matching dapat menggantikan visitor untuk banyak kasus

```java
public sealed interface Expression permits Literal, Add, Multiply {
}

public record Literal(int value) implements Expression {
}

public record Add(Expression left, Expression right) implements Expression {
}

public record Multiply(Expression left, Expression right) implements Expression {
}
```

Evaluator:

```java
public final class ExpressionEvaluator {

    public int evaluate(Expression expression) {
        return switch (expression) {
            case Literal literal -> literal.value();
            case Add add -> evaluate(add.left()) + evaluate(add.right());
            case Multiply multiply -> evaluate(multiply.left()) * evaluate(multiply.right());
        };
    }
}
```

Keuntungan:

- lebih sedikit boilerplate;
- lebih readable;
- compiler dapat mengecek exhaustiveness;
- cocok untuk AST, DSL, command, event, result.

---

### 8.3 Namun visitor masih berguna dalam beberapa kondisi

Visitor masih masuk akal jika:

- language level belum mendukung pattern matching yang dibutuhkan;
- operasi perlu diekstensi tanpa mengubah central switch;
- hierarchy sangat stabil tapi operasi terus bertambah;
- ingin double dispatch eksplisit;
- ingin menghindari banyak `switch` tersebar.

Sealed + switch bagus untuk model yang lebih data-oriented. Visitor bagus untuk operation-oriented extension.

---

## 9. Exhaustive Reasoning

### 9.1 Apa itu exhaustive reasoning?

Exhaustive reasoning berarti compiler bisa mengetahui bahwa semua kemungkinan variant telah ditangani.

Contoh:

```java
public sealed interface Decision permits Approved, Rejected, Escalated {
}

public record Approved(String approvalNo) implements Decision {
}

public record Rejected(String reason) implements Decision {
}

public record Escalated(String queue) implements Decision {
}
```

Pemrosesan:

```java
public String messageOf(Decision decision) {
    return switch (decision) {
        case Approved approved -> "Approved: " + approved.approvalNo();
        case Rejected rejected -> "Rejected: " + rejected.reason();
        case Escalated escalated -> "Escalated to " + escalated.queue();
    };
}
```

Karena `Decision` sealed, compiler tahu direct subtype-nya.

---

### 9.2 Mengapa exhaustive reasoning penting?

Dalam sistem besar, bug sering muncul karena ada variant baru tetapi semua handler tidak diperbarui.

Contoh open design:

```java
public interface CaseStatus {
}
```

Handler:

```java
public String label(CaseStatus status) {
    if (status instanceof Draft) {
        return "Draft";
    }
    if (status instanceof Submitted) {
        return "Submitted";
    }
    return "Unknown";
}
```

Ketika `Suspended` ditambahkan, compiler tidak membantu.

Dengan sealed:

```java
public sealed interface CaseStatus permits Draft, Submitted, Suspended {
}
```

Jika `switch` belum menangani `Suspended`, compiler dapat memaksa update.

---

### 9.3 Exhaustive tidak sama dengan future-proof

Sealed hierarchy membantu compile-time reasoning, tetapi evolusi API tetap perlu hati-hati.

Jika library versi 1:

```java
public sealed interface Decision permits Approved, Rejected {
}
```

Consumer menulis:

```java
return switch (decision) {
    case Approved approved -> ...;
    case Rejected rejected -> ...;
};
```

Lalu library versi 2 menambahkan:

```java
public sealed interface Decision permits Approved, Rejected, Escalated {
}
```

Maka source consumer perlu diperbarui. Dalam beberapa skenario binary/runtime, perubahan hierarchy bisa menyebabkan failure ketika kode lama bertemu hierarchy baru.

Kesimpulan:

> Sealed type meningkatkan correctness, tetapi memperketat compatibility contract.

---

## 10. Modeling State Machine dengan Sealed Types

### 10.1 Status sebagai enum sering terlalu dangkal

Misalnya workflow case:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    ASSIGNED,
    IN_REVIEW,
    CLOSED,
    REJECTED
}
```

Enum ini memberi daftar status, tetapi tidak menyimpan data per state.

Masalah muncul ketika setiap state punya data berbeda:

- `DRAFT` punya creator dan draft timestamp.
- `ASSIGNED` punya officer id dan assignment timestamp.
- `IN_REVIEW` punya reviewer id dan review SLA.
- `CLOSED` punya closure reason dan closed timestamp.
- `REJECTED` punya rejection reason dan rejected by.

Jika semua dimasukkan ke satu class:

```java
public final class CaseState {
    private final CaseStatus status;
    private final String creatorId;
    private final Instant draftAt;
    private final String officerId;
    private final Instant assignedAt;
    private final String reviewerId;
    private final Instant reviewDueAt;
    private final String closureReason;
    private final Instant closedAt;
    private final String rejectionReason;
}
```

Ini menghasilkan banyak nullable field.

---

### 10.2 Sealed state model

```java
public sealed interface CaseState
        permits Draft, Submitted, Assigned, InReview, Closed, Rejected {

    String caseId();
}

public record Draft(
        String caseId,
        String creatorId,
        Instant draftAt
) implements CaseState {
}

public record Submitted(
        String caseId,
        String submittedBy,
        Instant submittedAt
) implements CaseState {
}

public record Assigned(
        String caseId,
        String officerId,
        Instant assignedAt
) implements CaseState {
}

public record InReview(
        String caseId,
        String reviewerId,
        Instant reviewStartedAt,
        Instant reviewDueAt
) implements CaseState {
}

public record Closed(
        String caseId,
        String closedBy,
        String reason,
        Instant closedAt
) implements CaseState {
}

public record Rejected(
        String caseId,
        String rejectedBy,
        String reason,
        Instant rejectedAt
) implements CaseState {
}
```

Setiap state sekarang punya data validnya sendiri.

---

### 10.3 Transition function

```java
public final class CaseTransitions {

    public CaseState submit(CaseState state, String submittedBy, Instant now) {
        return switch (state) {
            case Draft draft -> new Submitted(draft.caseId(), submittedBy, now);
            case Submitted submitted -> throw invalid(state, "submit");
            case Assigned assigned -> throw invalid(state, "submit");
            case InReview inReview -> throw invalid(state, "submit");
            case Closed closed -> throw invalid(state, "submit");
            case Rejected rejected -> throw invalid(state, "submit");
        };
    }

    public CaseState assign(CaseState state, String officerId, Instant now) {
        return switch (state) {
            case Draft draft -> throw invalid(state, "assign");
            case Submitted submitted -> new Assigned(submitted.caseId(), officerId, now);
            case Assigned assigned -> throw invalid(state, "assign");
            case InReview inReview -> throw invalid(state, "assign");
            case Closed closed -> throw invalid(state, "assign");
            case Rejected rejected -> throw invalid(state, "assign");
        };
    }

    private IllegalStateException invalid(CaseState state, String action) {
        return new IllegalStateException(
                "Cannot " + action + " case in state " + state.getClass().getSimpleName()
        );
    }
}
```

Ini verbose tetapi sangat eksplisit. Untuk workflow kompleks, verbosity ini bisa digantikan table-driven transitions, tetapi sealed state tetap membantu memastikan variant lengkap.

---

### 10.4 Keuntungan untuk regulatory/case-management systems

Dalam sistem enforcement/case management, state bukan hanya label UI. State membawa konsekuensi:

- siapa boleh melakukan action;
- dokumen apa yang wajib ada;
- SLA mana yang berjalan;
- notifikasi apa yang dikirim;
- audit event apa yang dicatat;
- data apa yang wajib/opsional;
- downstream integration apa yang boleh dipicu.

Sealed state membantu membuat state sebagai **typed invariant**, bukan string/status code semata.

---

## 11. Modeling Command, Event, Query, and Result

### 11.1 Command model

```java
public sealed interface CaseCommand
        permits CreateCase, AssignCase, CloseCase, ReopenCase {
}

public record CreateCase(String title, String createdBy) implements CaseCommand {
}

public record AssignCase(String caseId, String officerId, String assignedBy) implements CaseCommand {
}

public record CloseCase(String caseId, String reason, String closedBy) implements CaseCommand {
}

public record ReopenCase(String caseId, String reason, String reopenedBy) implements CaseCommand {
}
```

Command handler:

```java
public final class CaseCommandHandler {

    public CaseResult handle(CaseCommand command) {
        return switch (command) {
            case CreateCase create -> handleCreate(create);
            case AssignCase assign -> handleAssign(assign);
            case CloseCase close -> handleClose(close);
            case ReopenCase reopen -> handleReopen(reopen);
        };
    }

    private CaseResult handleCreate(CreateCase command) {
        // validate, persist, emit event
        return new CaseAccepted(command.title());
    }

    private CaseResult handleAssign(AssignCase command) {
        return new CaseAccepted(command.caseId());
    }

    private CaseResult handleClose(CloseCase command) {
        return new CaseAccepted(command.caseId());
    }

    private CaseResult handleReopen(ReopenCase command) {
        return new CaseAccepted(command.caseId());
    }
}
```

Sealed command cocok untuk internal command bus yang tidak ditujukan sebagai public plugin extension point.

---

### 11.2 Event model

```java
public sealed interface CaseEvent
        permits CaseCreated, CaseAssigned, CaseClosed, CaseReopened {

    String caseId();
    Instant occurredAt();
}

public record CaseCreated(
        String caseId,
        String title,
        String createdBy,
        Instant occurredAt
) implements CaseEvent {
}

public record CaseAssigned(
        String caseId,
        String officerId,
        String assignedBy,
        Instant occurredAt
) implements CaseEvent {
}

public record CaseClosed(
        String caseId,
        String reason,
        String closedBy,
        Instant occurredAt
) implements CaseEvent {
}

public record CaseReopened(
        String caseId,
        String reason,
        String reopenedBy,
        Instant occurredAt
) implements CaseEvent {
}
```

Event projector:

```java
public final class CaseProjectionUpdater {

    public void apply(CaseEvent event) {
        switch (event) {
            case CaseCreated created -> onCreated(created);
            case CaseAssigned assigned -> onAssigned(assigned);
            case CaseClosed closed -> onClosed(closed);
            case CaseReopened reopened -> onReopened(reopened);
        }
    }

    private void onCreated(CaseCreated event) {
        // insert projection
    }

    private void onAssigned(CaseAssigned event) {
        // update assignment fields
    }

    private void onClosed(CaseClosed event) {
        // mark closed
    }

    private void onReopened(CaseReopened event) {
        // reopen projection
    }
}
```

Benefit:

- event catalog terlihat dari type hierarchy;
- handler compiler-enforced;
- event shape spesifik;
- mengurangi accidental missing handler.

---

### 11.3 Result model

```java
public sealed interface ValidationResult
        permits Valid, Invalid {
}

public record Valid() implements ValidationResult {
}

public record Invalid(List<ValidationError> errors) implements ValidationResult {
    public Invalid {
        errors = List.copyOf(errors);
        if (errors.isEmpty()) {
            throw new IllegalArgumentException("invalid result must have at least one error");
        }
    }
}

public record ValidationError(String field, String code, String message) {
}
```

Usage:

```java
public void submit(Application application) {
    ValidationResult result = validator.validate(application);

    switch (result) {
        case Valid ignored -> persistSubmission(application);
        case Invalid invalid -> throw new ValidationException(invalid.errors());
    }
}
```

Ini lebih eksplisit daripada boolean + side-channel error list.

---

## 12. Error Taxonomy dengan Sealed Types

### 12.1 Exception hierarchy yang uncontrolled

```java
public abstract class DomainException extends RuntimeException {
    protected DomainException(String message) {
        super(message);
    }
}
```

Siapa pun bisa membuat subtype.

Masalah:

- error taxonomy bisa melebar tanpa kontrol;
- mapping ke HTTP/API response tidak exhaustive;
- handler harus punya default fallback;
- dokumentasi domain error tidak kuat.

---

### 12.2 Sealed domain error

```java
public sealed abstract class DomainException extends RuntimeException
        permits ValidationDomainException, AuthorizationDomainException, ConflictDomainException {

    protected DomainException(String message) {
        super(message);
    }

    public abstract String errorCode();
}

public final class ValidationDomainException extends DomainException {
    public ValidationDomainException(String message) {
        super(message);
    }

    @Override
    public String errorCode() {
        return "VALIDATION_ERROR";
    }
}

public final class AuthorizationDomainException extends DomainException {
    public AuthorizationDomainException(String message) {
        super(message);
    }

    @Override
    public String errorCode() {
        return "AUTHORIZATION_ERROR";
    }
}

public final class ConflictDomainException extends DomainException {
    public ConflictDomainException(String message) {
        super(message);
    }

    @Override
    public String errorCode() {
        return "CONFLICT_ERROR";
    }
}
```

Mapper:

```java
public final class DomainExceptionMapper {

    public ApiError map(DomainException exception) {
        return switch (exception) {
            case ValidationDomainException validation ->
                    new ApiError(400, validation.errorCode(), validation.getMessage());
            case AuthorizationDomainException authorization ->
                    new ApiError(403, authorization.errorCode(), authorization.getMessage());
            case ConflictDomainException conflict ->
                    new ApiError(409, conflict.errorCode(), conflict.getMessage());
        };
    }
}
```

Sekarang error taxonomy menjadi explicit.

---

### 12.3 Catatan penting: exception sebagai sealed type punya trade-off

Sealed exception hierarchy bagus untuk internal application boundary, tetapi hati-hati untuk public library:

- menambah subtype baru bisa memaksa consumer update switch;
- consumer tidak bisa membuat custom subtype;
- framework tertentu mungkin mengandalkan subclassing;
- serialization exception punya compatibility concern.

Untuk library umum, open exception base kadang lebih baik. Untuk domain internal, sealed error sering lebih aman.

---

## 13. API Boundary: Public, Internal, SPI

### 13.1 Sealed type untuk internal domain

Sangat cocok:

```java
package com.example.caseflow.internal.model;

sealed interface InternalCaseDecision
        permits Approve, Reject, Escalate {
}
```

Karena:

- domain team mengontrol semua variant;
- consumer eksternal tidak perlu menambah subtype;
- exhaustive logic penting;
- perubahan bisa dikoordinasikan dalam satu repo/module.

---

### 13.2 Sealed type untuk public API

Bisa, tetapi lebih berat.

```java
package com.example.workflow.api;

public sealed interface WorkflowResult
        permits WorkflowAccepted, WorkflowRejected, WorkflowDeferred {
}
```

Pertanyaan review:

1. Apakah consumer perlu membuat implementation sendiri?
2. Apakah daftar variant benar-benar stabil?
3. Apakah menambah variant dianggap breaking change?
4. Apakah consumer akan melakukan exhaustive switch?
5. Bagaimana versioning contract-nya?

Jika jawabannya tidak jelas, sealed public API bisa terlalu membatasi.

---

### 13.3 SPI biasanya tidak cocok sealed penuh

SPI adalah extension point. Jika Anda menulis:

```java
public sealed interface PaymentProvider permits StripeProvider, InternalProvider {
}
```

Maka vendor lain tidak bisa menambahkan provider.

Untuk SPI, biasanya lebih cocok:

```java
public interface PaymentProvider {
    PaymentResult pay(PaymentRequest request);
}
```

Atau mixed design:

```java
public sealed interface PaymentProvider permits BuiltInPaymentProvider, ExternalPaymentProvider {
}

public sealed interface BuiltInPaymentProvider extends PaymentProvider
        permits InternalBankProvider, InternalWalletProvider {
}

public non-sealed interface ExternalPaymentProvider extends PaymentProvider {
}
```

Di sini official built-in provider dikontrol, tetapi external provider tetap terbuka.

---

## 14. Sealed Types and Records

### 14.1 Kombinasi paling umum: sealed interface + records

```java
public sealed interface LookupResult<T>
        permits Found, NotFound, LookupFailed {
}

public record Found<T>(T value) implements LookupResult<T> {
    public Found {
        Objects.requireNonNull(value, "value must not be null");
    }
}

public record NotFound<T>(String key) implements LookupResult<T> {
}

public record LookupFailed<T>(String key, Throwable cause) implements LookupResult<T> {
    public LookupFailed {
        Objects.requireNonNull(cause, "cause must not be null");
    }
}
```

Keuntungan:

- root abstraction closed;
- variant immutable by default;
- data shape jelas;
- equality/toString/hashCode otomatis;
- pattern matching nyaman;
- cocok untuk generated DTO/internal model.

---

### 14.2 Record tetap perlu invariant

Record bukan magic immutable deep object. Jika component mutable, Anda tetap perlu defensive copy.

```java
public record Invalid(List<ValidationError> errors) implements ValidationResult {
    public Invalid {
        errors = List.copyOf(errors);
        if (errors.isEmpty()) {
            throw new IllegalArgumentException("errors must not be empty");
        }
    }
}
```

Tanpa `List.copyOf`, caller bisa memodifikasi list setelah record dibuat.

---

### 14.3 Jangan selalu pakai record untuk subtype

Record cocok untuk data carrier. Jika variant punya behavior kompleks, lifecycle, identity, atau lazy resource, class biasa mungkin lebih tepat.

```java
public final class StreamingReport implements ReportResult {
    private final String reportId;
    private final Supplier<InputStream> streamSupplier;

    public StreamingReport(String reportId, Supplier<InputStream> streamSupplier) {
        this.reportId = Objects.requireNonNull(reportId);
        this.streamSupplier = Objects.requireNonNull(streamSupplier);
    }

    public String reportId() {
        return reportId;
    }

    public InputStream openStream() {
        return streamSupplier.get();
    }
}
```

Record bukan pengganti seluruh class design.

---

## 15. Pattern Matching and Switch

### 15.1 Switch expression dengan sealed type

```java
public Money feeFor(PaymentMethod method) {
    return switch (method) {
        case CreditCard creditCard -> Money.usd("2.50");
        case BankTransfer bankTransfer -> Money.usd("1.00");
        case Cash cash -> Money.zero("USD");
    };
}
```

Dengan sealed type, compiler bisa memeriksa semua direct permitted subtype.

---

### 15.2 Hindari default jika ingin compiler membantu

Ini buruk:

```java
public Money feeFor(PaymentMethod method) {
    return switch (method) {
        case CreditCard creditCard -> Money.usd("2.50");
        default -> Money.zero("USD");
    };
}
```

Mengapa buruk?

- subtype baru tidak memaksa update;
- bug bisa tersembunyi di default;
- exhaustiveness kehilangan manfaat desain.

Lebih baik eksplisit:

```java
public Money feeFor(PaymentMethod method) {
    return switch (method) {
        case CreditCard creditCard -> Money.usd("2.50");
        case BankTransfer bankTransfer -> Money.usd("1.00");
        case Cash cash -> Money.zero("USD");
    };
}
```

Rule praktis:

> Untuk sealed hierarchy internal, hindari `default` kecuali benar-benar ada alasan compatibility.

---

### 15.3 Default masih berguna untuk compatibility boundary

Di public API consumer yang memakai library eksternal, default kadang dibutuhkan untuk defensive compatibility.

```java
public String safeLabel(Decision decision) {
    return switch (decision) {
        case Approved approved -> "Approved";
        case Rejected rejected -> "Rejected";
        default -> "Unknown decision: " + decision.getClass().getName();
    };
}
```

Ini mengorbankan strict exhaustiveness untuk runtime resilience.

Pilih berdasarkan konteks:

| Konteks | Gunakan default? |
|---|---:|
| Internal domain model | Biasanya tidak |
| Generated closed model | Biasanya tidak |
| Public library consumer | Kadang ya |
| Cross-version plugin boundary | Ya, sering perlu |
| Security-critical decision | Hati-hati, default deny lebih aman |

---

## 16. Reflection and Sealed Types

### 16.1 Runtime dapat mengetahui apakah class sealed

Java reflection menyediakan cara untuk memeriksa sealed status dan permitted subclasses.

Contoh konseptual:

```java
Class<?> type = Decision.class;

if (type.isSealed()) {
    Class<?>[] permitted = type.getPermittedSubclasses();
    for (Class<?> subclass : permitted) {
        System.out.println(subclass.getName());
    }
}
```

Use case:

- framework metadata scanning;
- documentation generator;
- validation of sealed hierarchy;
- code generation;
- serialization registration;
- test ensuring all variants handled.

---

### 16.2 Reflection tidak berarti boleh bypass sealed constraint

Reflection bisa membaca metadata, tetapi tidak boleh sembarangan menciptakan subtype baru yang tidak permitted.

Sealed restriction adalah bagian dari classfile semantics. Compiler dan JVM menjaga agar subtype langsung mengikuti daftar permitted subclass.

---

### 16.3 Test helper untuk memastikan variant registry sinkron

Misalnya Anda punya registry serializer:

```java
public final class CaseEventTypeRegistry {
    private static final Map<Class<? extends CaseEvent>, String> TYPES = Map.of(
            CaseCreated.class, "case.created",
            CaseAssigned.class, "case.assigned",
            CaseClosed.class, "case.closed",
            CaseReopened.class, "case.reopened"
    );

    public static String typeOf(CaseEvent event) {
        String type = TYPES.get(event.getClass());
        if (type == null) {
            throw new IllegalArgumentException("Unregistered event type: " + event.getClass().getName());
        }
        return type;
    }
}
```

Test:

```java
@Test
void allPermittedCaseEventsAreRegistered() {
    Set<Class<?>> permitted = Set.of(CaseEvent.class.getPermittedSubclasses());
    Set<Class<?>> registered = CaseEventTypeRegistry.registeredClasses();

    assertEquals(permitted, registered);
}
```

Ini menjaga agar saat subtype baru ditambahkan, registry ikut diperbarui.

---

## 17. Serialization and Deserialization Boundary

### 17.1 Sealed hierarchy butuh type discriminator

JSON contoh:

```json
{
  "type": "case.assigned",
  "caseId": "CASE-001",
  "officerId": "OFFICER-7",
  "assignedBy": "SUPERVISOR-2",
  "occurredAt": "2026-06-16T01:00:00Z"
}
```

Untuk sealed hierarchy:

```java
public sealed interface CaseEvent permits CaseCreated, CaseAssigned, CaseClosed {
}
```

Deserializer perlu tahu `type` mana dipetakan ke class mana.

---

### 17.2 Jangan mengandalkan class name sebagai wire type

Buruk:

```json
{
  "@class": "com.example.caseflow.CaseAssigned",
  "caseId": "CASE-001"
}
```

Risiko:

- package rename memutus compatibility;
- class name mengekspos implementation detail;
- security risk pada polymorphic deserialization;
- cross-language consumer sulit;
- refactoring jadi mahal.

Lebih baik pakai stable discriminator:

```json
{
  "type": "case.assigned.v1",
  "caseId": "CASE-001"
}
```

---

### 17.3 Sealed hierarchy bukan otomatis aman untuk wire evolution

Jika event public:

```java
public sealed interface CaseEvent permits CaseCreated, CaseAssigned {
}
```

Lalu ditambahkan:

```java
public sealed interface CaseEvent permits CaseCreated, CaseAssigned, CaseSuspended {
}
```

Consumer lama mungkin tidak tahu `case.suspended.v1`.

Solusi:

- versioned event type;
- unknown-event fallback;
- compatibility test;
- schema registry;
- consumer capability negotiation;
- default deny for command;
- default ignore/dead-letter for event, tergantung semantics.

---

## 18. Code Generation Boundary

### 18.1 Generated sealed hierarchy

Sealed type cocok untuk generated models dari finite schema.

Contoh schema konseptual:

```yaml
PaymentResult:
  oneOf:
    - PaymentApproved
    - PaymentDeclined
    - PaymentPending
```

Generated Java:

```java
public sealed interface PaymentResult
        permits PaymentApproved, PaymentDeclined, PaymentPending {
}

public record PaymentApproved(String transactionId) implements PaymentResult {
}

public record PaymentDeclined(String reasonCode, String reasonMessage) implements PaymentResult {
}

public record PaymentPending(String trackingId) implements PaymentResult {
}
```

Keuntungan:

- schema union menjadi type-safe;
- consumer handler bisa exhaustive;
- null field berkurang;
- generated code lebih dekat ke domain shape.

---

### 18.2 Generator harus menjaga permits list

Jika generator membuat root sealed type, ia harus meng-update `permits` setiap kali variant berubah.

Bug generator:

```java
public sealed interface PaymentResult permits PaymentApproved, PaymentDeclined {
}

public record PaymentPending(String trackingId) implements PaymentResult {
}
```

Ini tidak valid karena `PaymentPending` belum permitted.

Checklist generator:

- generate root type terakhir atau dari full model;
- generate all variant in same module/package constraints;
- deterministic ordering untuk diff bersih;
- stable type discriminator;
- test generated compile;
- test all permitted variants registered;
- avoid manually editing generated hierarchy.

---

### 18.3 Partial generation pattern

Kadang Anda ingin root dan variant generated, tetapi behavior manual.

Pattern:

```text
src/generated/java
└── com/example/payment/generated
    ├── PaymentResult.java
    ├── PaymentApproved.java
    ├── PaymentDeclined.java
    └── PaymentPending.java

src/main/java
└── com/example/payment
    ├── PaymentResultMapper.java
    ├── PaymentResultValidator.java
    └── PaymentResultHandler.java
```

Jangan menambahkan manual subtype ke generated sealed root kecuali generator memang mendukung extension branch.

---

## 19. Framework and Proxy Considerations

### 19.1 Framework yang butuh subclass proxy bisa bermasalah

Beberapa framework membuat subclass runtime untuk:

- lazy loading;
- AOP;
- transaction proxy;
- mocking;
- enhancement;
- instrumentation.

Jika class `final` atau sealed dengan daftar permitted yang tidak mencakup proxy, framework mungkin tidak bisa membuat subclass.

Contoh:

```java
public sealed abstract class Account permits SavingsAccount, CurrentAccount {
}
```

Framework tidak bisa membuat:

```java
class AccountProxy extends Account {
}
```

Karena `AccountProxy` bukan permitted subclass.

---

### 19.2 Prefer sealed interface + final records/classes untuk pure domain model

Untuk domain object yang tidak perlu subclass proxy:

```java
public sealed interface AccountSnapshot permits SavingsAccountSnapshot, CurrentAccountSnapshot {
}

public record SavingsAccountSnapshot(String accountNo, BigDecimal balance) implements AccountSnapshot {
}

public record CurrentAccountSnapshot(String accountNo, BigDecimal balance, BigDecimal overdraftLimit) implements AccountSnapshot {
}
```

Ini aman untuk DTO/snapshot/result/event.

Untuk ORM entity, hati-hati. Banyak ORM memiliki requirement terkait constructor, final class, lazy proxy, dan field access. Jangan otomatis membuat entity hierarchy sealed tanpa memastikan framework mendukung.

---

### 19.3 Testing/mocking implication

Jika interface sealed:

```java
public sealed interface RiskScorer permits DefaultRiskScorer {
    Score score(Application application);
}
```

Test tidak bisa membuat arbitrary fake implementation kecuali permitted.

Untuk service dependency, sealed interface biasanya buruk:

```java
public interface RiskScorer {
    Score score(Application application);
}
```

Lebih baik open interface untuk service dependency, karena test double, plugin, dan implementation replacement adalah kebutuhan normal.

Rule:

> Seal domain variants, not ordinary service seams.

---

## 20. Binary Compatibility and API Evolution

### 20.1 Menambah permitted subtype adalah perubahan besar secara semantic

Misalnya versi 1:

```java
public sealed interface ExportResult permits Exported, ExportFailed {
}
```

Consumer:

```java
return switch (result) {
    case Exported exported -> ...;
    case ExportFailed failed -> ...;
};
```

Versi 2:

```java
public sealed interface ExportResult permits Exported, ExportFailed, ExportQueued {
}
```

Dari sisi domain, ini masuk akal. Dari sisi consumer, mereka harus menangani variant baru.

Jadi perubahan ini harus dianggap sebagai:

- breaking source change untuk exhaustive switch consumer;
- migration-relevant change;
- perlu release notes;
- mungkin major version bump jika public API.

---

### 20.2 Menghapus permitted subtype juga breaking

Versi 1:

```java
public sealed interface CaseOutcome permits Approved, Rejected, Withdrawn {
}
```

Versi 2:

```java
public sealed interface CaseOutcome permits Approved, Rejected {
}
```

Consumer yang masih punya handling `Withdrawn` akan rusak pada source level.

Jika class masih ada tapi bukan subtype, semantics juga berubah.

---

### 20.3 Mengubah subtype dari final ke non-sealed

```java
public final class Rejected implements Decision {
}
```

Menjadi:

```java
public non-sealed class Rejected implements Decision {
}
```

Ini membuka extension. Bisa terlihat kompatibel, tetapi secara semantics mengubah exhaustive reasoning di bawah branch tersebut.

Jika ada switch terhadap root sealed, branch `Rejected` masih satu direct subtype. Tetapi jika code mengasumsikan `Rejected` tidak punya subtype untuk logic tertentu, asumsi berubah.

---

### 20.4 Public sealed hierarchy perlu evolution policy

Dokumentasikan:

- apakah subtype baru bisa ditambahkan di minor version;
- apakah consumer harus menyediakan default;
- apakah hierarchy dianggap closed forever;
- bagaimana unknown variant diproses di wire format;
- apa compatibility guarantee.

Contoh dokumentasi:

```java
/**
 * Represents the result of an export request.
 *
 * <p>This hierarchy is sealed. New permitted result types may be added in
 * minor releases. Consumers that require forward compatibility should include
 * a defensive default branch when switching over this type.
 */
public sealed interface ExportResult permits Exported, ExportFailed, ExportQueued {
}
```

Atau untuk strict internal model:

```java
/**
 * Internal closed set of export outcomes.
 *
 * <p>Do not use a default branch when switching over this type inside this
 * module. Exhaustive switch failures are intentional compile-time signals
 * that a new outcome must be handled.
 */
sealed interface InternalExportResult permits Exported, ExportFailed {
}
```

---

## 21. Design Patterns with Sealed Types

### 21.1 Algebraic Data Type style

Java tidak punya ADT se-native ML/Haskell/Scala, tetapi sealed interface + record memberi pola mirip sum type.

```java
public sealed interface Either<L, R> permits Left, Right {
}

public record Left<L, R>(L value) implements Either<L, R> {
}

public record Right<L, R>(R value) implements Either<L, R> {
}
```

Namun hati-hati: membuat generic functional abstraction terlalu banyak di enterprise Java bisa mengurangi readability.

Sering lebih baik membuat domain-specific result:

```java
public sealed interface CustomerLookupResult
        permits CustomerFound, CustomerNotFound, CustomerLookupUnavailable {
}
```

---

### 21.2 Closed command set

```java
public sealed interface AccountCommand permits Deposit, Withdraw, Freeze {
}
```

Cocok untuk aggregate/application service yang hanya menerima command valid.

---

### 21.3 Closed event set

```java
public sealed interface AccountEvent permits Deposited, Withdrawn, Frozen {
}
```

Cocok untuk internal event sourcing/projection.

Untuk integration event lintas service, sealed type tetap bisa dipakai di codebase producer, tetapi wire compatibility harus dirancang hati-hati.

---

### 21.4 Closed validation result

```java
public sealed interface RuleEvaluation permits RulePassed, RuleFailed, RuleSkipped {
}
```

Mencegah boolean trap.

---

### 21.5 Closed parser AST

```java
public sealed interface QueryNode permits AndNode, OrNode, PredicateNode {
}
```

Sangat cocok untuk DSL, expression tree, query builder, rule engine, template language.

---

## 22. Anti-Patterns

### 22.1 Sealing service interfaces

Buruk:

```java
public sealed interface EmailSender permits SmtpEmailSender {
    void send(Email email);
}
```

Masalah:

- test fake sulit;
- alternative implementation sulit;
- dependency inversion rusak;
- DI container extension terbatas;
- tidak ada manfaat exhaustive domain.

Service dependency biasanya open.

---

### 22.2 Sealed hierarchy untuk domain yang sebenarnya open

Misalnya product type:

```java
public sealed interface Product permits Book, Course, Subscription {
}
```

Jika bisnis sering menambah product type, sealed hierarchy di API publik bisa membuat perubahan mahal.

Alternatif:

- enum/configurable product kind;
- database-driven type;
- open plugin model;
- sealed hanya untuk internal processing category.

---

### 22.3 `non-sealed` tanpa alasan jelas

```java
public sealed interface Decision permits Approved, Rejected {
}

public non-sealed class Rejected implements Decision {
}
```

Kalau tidak ada extension scenario, `non-sealed` membuka kembali hierarchy dan melemahkan model.

Default untuk permitted subtype biasanya `final`.

---

### 22.4 Default branch yang menyembunyikan missing case

```java
return switch (event) {
    case CaseCreated created -> ...;
    default -> ...;
};
```

Di internal closed hierarchy, ini menghilangkan manfaat sealed type.

---

### 22.5 Sealed hierarchy terlalu dalam

```text
A sealed
└── B sealed
    └── C sealed
        └── D sealed
            └── E final
```

Jika hierarchy terlalu dalam, cognitive load meningkat.

Pertanyaan review:

- Apakah setiap level punya invariant berbeda?
- Apakah setiap level dipakai oleh logic?
- Apakah taxonomy ini domain-real atau hanya klasifikasi buatan?
- Apakah enum + field cukup?

---

### 22.6 Sealed model yang hanya membungkus string code

```java
public sealed interface Status permits StatusA, StatusB, StatusC {
}

public record StatusA(String code) implements Status {
}
```

Jika variant tidak punya shape/behavior berbeda dan hanya membungkus code, enum mungkin lebih tepat.

---

## 23. Practical Decision Framework

### 23.1 Gunakan sealed type jika...

Gunakan sealed type jika minimal beberapa benar:

- daftar variant finite dan meaningful;
- Anda ingin compiler membantu exhaustive handling;
- subtype tidak boleh dibuat sembarang pihak;
- setiap variant punya data berbeda;
- hierarchy adalah domain concept, bukan technical service seam;
- invariant bergantung pada variant;
- state transition perlu lebih type-safe;
- command/event/result set dikontrol oleh module/team yang sama;
- API consumer tidak perlu membuat implementation sendiri.

---

### 23.2 Jangan gunakan sealed type jika...

Hindari sealed type jika:

- abstraction adalah extension point;
- implementation ditentukan plugin/vendor;
- test double perlu dibuat bebas;
- framework perlu subclass proxy;
- variant sering berubah oleh konfigurasi/data;
- public API harus forward-compatible tanpa recompilation pressure;
- Anda tidak akan memanfaatkan exhaustive handling;
- enum cukup sederhana;
- class final biasa sudah cukup.

---

### 23.3 Matrix pilihan desain

| Problem | Pilihan yang biasanya tepat |
|---|---|
| Finite simple status | Enum |
| Finite variant dengan data berbeda | Sealed interface + records |
| Shared implementation + controlled subtype | Sealed abstract class |
| Public extension point | Open interface/SPI |
| Service dependency | Open interface |
| Immutable value carrier | Record |
| No subtype allowed | Final class |
| Internal command set | Sealed interface |
| Internal event set | Sealed interface |
| ORM entity hierarchy | Hati-hati; sering jangan sealed dulu |
| Plugin architecture | Open SPI atau sealed + non-sealed branch |

---

## 24. Worked Example: Enforcement Decision Model

### 24.1 Problem

Misalnya sistem enforcement punya decision setelah assessment:

- no action;
- warning;
- request clarification;
- impose penalty;
- escalate to legal.

Naive model:

```java
public final class EnforcementDecision {
    private final String decisionType;
    private final String warningTemplateId;
    private final String clarificationQuestion;
    private final BigDecimal penaltyAmount;
    private final String legalQueue;
}
```

Masalah:

- nullable fields;
- invalid combinations;
- weak compiler support;
- handler harus cek string;
- API tidak self-documenting.

---

### 24.2 Sealed model

```java
public sealed interface EnforcementDecision
        permits NoAction, WarningIssued, ClarificationRequested, PenaltyImposed, EscalatedToLegal {

    String caseId();
    String decidedBy();
    Instant decidedAt();
}

public record NoAction(
        String caseId,
        String decidedBy,
        Instant decidedAt,
        String rationale
) implements EnforcementDecision {
    public NoAction {
        requireText(caseId, "caseId");
        requireText(decidedBy, "decidedBy");
        Objects.requireNonNull(decidedAt, "decidedAt must not be null");
        requireText(rationale, "rationale");
    }
}

public record WarningIssued(
        String caseId,
        String decidedBy,
        Instant decidedAt,
        String warningTemplateId,
        String warningReason
) implements EnforcementDecision {
    public WarningIssued {
        requireText(caseId, "caseId");
        requireText(decidedBy, "decidedBy");
        Objects.requireNonNull(decidedAt, "decidedAt must not be null");
        requireText(warningTemplateId, "warningTemplateId");
        requireText(warningReason, "warningReason");
    }
}

public record ClarificationRequested(
        String caseId,
        String decidedBy,
        Instant decidedAt,
        String question,
        LocalDate responseDueDate
) implements EnforcementDecision {
    public ClarificationRequested {
        requireText(caseId, "caseId");
        requireText(decidedBy, "decidedBy");
        Objects.requireNonNull(decidedAt, "decidedAt must not be null");
        requireText(question, "question");
        Objects.requireNonNull(responseDueDate, "responseDueDate must not be null");
    }
}

public record PenaltyImposed(
        String caseId,
        String decidedBy,
        Instant decidedAt,
        BigDecimal amount,
        String currency,
        String penaltyReason
) implements EnforcementDecision {
    public PenaltyImposed {
        requireText(caseId, "caseId");
        requireText(decidedBy, "decidedBy");
        Objects.requireNonNull(decidedAt, "decidedAt must not be null");
        Objects.requireNonNull(amount, "amount must not be null");
        if (amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        requireText(currency, "currency");
        requireText(penaltyReason, "penaltyReason");
    }
}

public record EscalatedToLegal(
        String caseId,
        String decidedBy,
        Instant decidedAt,
        String legalQueue,
        String escalationReason
) implements EnforcementDecision {
    public EscalatedToLegal {
        requireText(caseId, "caseId");
        requireText(decidedBy, "decidedBy");
        Objects.requireNonNull(decidedAt, "decidedAt must not be null");
        requireText(legalQueue, "legalQueue");
        requireText(escalationReason, "escalationReason");
    }
}
```

Helper:

```java
private static void requireText(String value, String name) {
    if (value == null || value.isBlank()) {
        throw new IllegalArgumentException(name + " must not be blank");
    }
}
```

---

### 24.3 Policy handler

```java
public final class EnforcementDecisionApplier {

    public List<FollowUpAction> apply(EnforcementDecision decision) {
        return switch (decision) {
            case NoAction noAction -> List.of(
                    new AuditOnly(noAction.caseId(), "NO_ACTION", noAction.rationale())
            );
            case WarningIssued warning -> List.of(
                    new GenerateWarningLetter(warning.caseId(), warning.warningTemplateId()),
                    new AuditOnly(warning.caseId(), "WARNING_ISSUED", warning.warningReason())
            );
            case ClarificationRequested clarification -> List.of(
                    new SendClarificationRequest(clarification.caseId(), clarification.question()),
                    new StartSlaTimer(clarification.caseId(), clarification.responseDueDate())
            );
            case PenaltyImposed penalty -> List.of(
                    new GeneratePenaltyNotice(penalty.caseId(), penalty.amount(), penalty.currency()),
                    new CreateReceivable(penalty.caseId(), penalty.amount(), penalty.currency())
            );
            case EscalatedToLegal legal -> List.of(
                    new CreateLegalReferral(legal.caseId(), legal.legalQueue()),
                    new AuditOnly(legal.caseId(), "ESCALATED_TO_LEGAL", legal.escalationReason())
            );
        };
    }
}
```

Jika besok domain menambah `LicenseSuspended`, compiler dapat memaksa handler ini diperbarui.

---

### 24.4 Why this is better

Dibanding satu class dengan `decisionType`:

- invalid field combination hilang;
- setiap decision punya constructor invariant;
- handler exhaustive;
- audit/action mapping jelas;
- variant addition terlihat oleh compiler;
- code lebih self-documenting;
- tidak bergantung pada string type di business logic.

---

## 25. Production Checklist

Sebelum menggunakan sealed type, jawab checklist ini.

### 25.1 Domain checklist

- Apakah variant benar-benar finite?
- Apakah setiap variant punya arti domain yang stabil?
- Apakah setiap variant punya data/behavior berbeda?
- Apakah caller perlu exhaustive handling?
- Apakah subtype liar akan merusak invariant?
- Apakah hierarchy lebih jelas daripada enum?

### 25.2 API checklist

- Apakah ini internal atau public API?
- Jika public, apakah consumer boleh membuat subtype?
- Apakah menambah subtype dianggap breaking?
- Apakah perlu default branch untuk forward compatibility?
- Apakah documentation menyebut evolution policy?

### 25.3 Runtime/framework checklist

- Apakah framework perlu subclass proxy?
- Apakah serialization butuh type discriminator?
- Apakah reflection scanner sudah mendukung sealed types?
- Apakah module/package constraint terpenuhi?
- Apakah test double masih mudah dibuat?

### 25.4 Build/codegen checklist

- Apakah generated code update permits list?
- Apakah all variants berada di module/package valid?
- Apakah registry/discriminator sinkron?
- Apakah compile test menangkap missing variant?
- Apakah generated and manual code boundary jelas?

---

## 26. Heuristics Top Engineer

### 26.1 Jangan seal karena terlihat modern

Sealed type bukan badge modern Java. Gunakan karena ada kebutuhan desain:

- controlled subtype;
- exhaustive reasoning;
- finite domain variant;
- invariant preservation.

Jika tidak ada kebutuhan itu, open interface/final class/enum mungkin lebih tepat.

---

### 26.2 Seal data variants, not service dependencies

Biasanya baik:

```java
public sealed interface PaymentResult permits PaymentApproved, PaymentDeclined, PaymentPending {
}
```

Biasanya buruk:

```java
public sealed interface PaymentGateway permits StripeGateway {
}
```

Service dependency butuh substitutability, testing, DI, dan extension.

---

### 26.3 Hindari default dalam internal exhaustive switch

Jika Anda sengaja membuat closed hierarchy, biarkan compiler membantu.

```java
return switch (result) {
    case PaymentApproved approved -> ...;
    case PaymentDeclined declined -> ...;
    case PaymentPending pending -> ...;
};
```

Jangan langsung:

```java
default -> ...
```

Kecuali Anda memang sedang mendesain forward compatibility.

---

### 26.4 Treat subtype changes as API changes

Menambah subtype bukan hal kecil. Ini bisa mengubah:

- handler completeness;
- serialization contract;
- test expectations;
- UI mapping;
- documentation;
- integration event schema;
- DB discriminator mapping;
- generated code.

---

### 26.5 Keep hierarchy shallow

Sealed hierarchy terbaik biasanya 1-2 level.

Jika lebih dari itu, pastikan setiap level punya alasan domain nyata.

---

## 27. Common Interview/Design Discussion Points

### 27.1 “Apa bedanya sealed class dan final class?”

`final class` tidak boleh punya subclass. `sealed class` boleh punya subclass, tetapi direct subclass-nya dibatasi ke daftar permitted types.

---

### 27.2 “Apa bedanya sealed interface dan enum?”

Enum merepresentasikan finite constants. Sealed interface merepresentasikan finite family of types. Jika setiap variant punya data berbeda, sealed interface + record biasanya lebih baik daripada enum dengan banyak nullable fields.

---

### 27.3 “Mengapa direct subclass harus final/sealed/non-sealed?”

Karena setiap direct subtype harus menjelaskan bagaimana extensibility dilanjutkan:

- berhenti (`final`),
- tetap dikontrol (`sealed`),
- dibuka kembali (`non-sealed`).

Ini membuat inheritance policy eksplisit di setiap level.

---

### 27.4 “Kapan sealed type berbahaya?”

Ketika dipakai untuk abstraction yang harus open:

- plugin interface;
- service dependency;
- framework extension point;
- domain yang variant-nya konfiguratif/dynamic;
- public API dengan unknown future variants.

---

### 27.5 “Apakah sealed type menggantikan polymorphism?”

Tidak. Sealed type adalah bentuk controlled polymorphism. Anda tetap bisa menggunakan method dispatch di subtype. Namun sealed type juga bekerja sangat baik dengan pattern matching and switch.

---

## 28. Mini Exercises

### Exercise 1 — Enum to sealed

Ubah model ini:

```java
public enum RefundStatus {
    APPROVED,
    REJECTED,
    PENDING_BANK_CONFIRMATION
}
```

Menjadi sealed hierarchy jika:

- approved punya refund transaction id;
- rejected punya reason code dan reason text;
- pending punya bank reference dan expected confirmation date.

Evaluasi apakah sealed type lebih baik daripada enum.

---

### Exercise 2 — Command model

Buat sealed hierarchy untuk command:

- create application;
- submit application;
- request clarification;
- approve application;
- reject application.

Tentukan:

- root type;
- common method jika ada;
- record components;
- validation invariant di compact constructor.

---

### Exercise 3 — Avoid bad sealed service

Diberikan:

```java
public sealed interface NotificationSender permits EmailNotificationSender {
    void send(Notification notification);
}
```

Jelaskan mengapa ini kemungkinan buruk, lalu ubah desainnya agar testable dan extensible.

---

### Exercise 4 — Exhaustive handler

Buat sealed `ValidationResult` dengan:

- valid;
- invalid;
- skipped.

Tulis method yang memproses semua variant tanpa `default`.

---

### Exercise 5 — Compatibility reasoning

Jika public sealed API menambah variant baru, apa dampaknya pada:

- source compatibility;
- binary compatibility;
- switch exhaustiveness;
- JSON discriminator;
- generated client;
- documentation.

---

## 29. Summary

Sealed classes and interfaces memberi Java kemampuan penting: **controlled hierarchy**.

Inti mental model:

```text
open interface/class  -> siapa pun bisa extend/implement
final class           -> tidak ada subclass
sealed type           -> subclass langsung dikontrol
non-sealed subtype    -> hierarchy dibuka kembali dari titik itu
```

Gunakan sealed type untuk:

- finite domain variants;
- state machine;
- command/event/result;
- error taxonomy;
- AST/DSL/query node;
- generated union-like model;
- internal closed API;
- exhaustive switch/pattern matching.

Hindari sealed type untuk:

- service interface;
- plugin SPI;
- framework extension point;
- domain yang variant-nya dynamic;
- public API tanpa evolution policy;
- model yang enum saja sudah cukup.

Sealed type bukan sekadar fitur modern Java. Ia adalah alat desain untuk membuat model lebih jujur:

> Jika domain hanya punya beberapa bentuk valid, tipe Java sebaiknya menyatakan itu secara eksplisit.

Namun konsekuensinya juga harus diterima:

> Ketika daftar bentuk valid berubah, itu adalah perubahan contract.

Top engineer tidak hanya tahu syntax `sealed`; ia tahu kapan menutup hierarchy, kapan membukanya, kapan menambahkan branch `non-sealed`, kapan menggunakan enum, kapan menggunakan record, kapan menjaga API tetap open, dan bagaimana sealed hierarchy berinteraksi dengan serialization, reflection, generated code, framework proxy, module boundary, dan API evolution.

---

## 30. Referensi Resmi

- Oracle Java SE 25 Language Guide — Sealed Classes and Interfaces.
- OpenJDK JEP 409 — Sealed Classes.
- Oracle Java Language Specification — Classes and Interfaces.
- Oracle Java Language Guide — Pattern Matching for switch.
- Java SE API — `Class.isSealed()` and `Class.getPermittedSubclasses()`.

---

## Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-008.md
```

Topik berikutnya:

```text
Records Deep Dive: Value-Carrying Types, Canonical Constructor, and API Design
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Interfaces Deep Dive: Contracts, Capabilities, Traits, Default Methods](./learn-java-oop-functional-reflection-codegen-modules-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Records Deep Dive: Value-Carrying Types, Canonical Constructor, and API Design](./learn-java-oop-functional-reflection-codegen-modules-part-008.md)
