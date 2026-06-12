# learn-java-data-types-part-013.md

# Java Data Types — Part 013  
# Sealed Types: Closed Polymorphism, Exhaustive Modeling, dan Domain Algebra

> Seri: **Advanced Java Data Types**  
> Bagian: **013**  
> Fokus: memahami `sealed class` dan `sealed interface` sebagai alat type modeling modern Java: closed inheritance hierarchy, `permits`, `final`, `sealed`, `non-sealed`, exhaustive `switch`, sealed + records, result modeling, state modeling, error modeling, API compatibility, reflection, dan kapan sealed type lebih tepat daripada enum/class biasa.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah yang Diselesaikan Sealed Types](#2-masalah-yang-diselesaikan-sealed-types)
3. [Apa Itu Sealed Class dan Sealed Interface](#3-apa-itu-sealed-class-dan-sealed-interface)
4. [Mental Model: Closed Polymorphic Hierarchy](#4-mental-model-closed-polymorphic-hierarchy)
5. [Syntax Dasar `sealed`, `permits`, `final`, `non-sealed`](#5-syntax-dasar-sealed-permits-final-non-sealed)
6. [Aturan Permitted Subclasses](#6-aturan-permitted-subclasses)
7. [`final`, `sealed`, dan `non-sealed` pada Subtype](#7-final-sealed-dan-non-sealed-pada-subtype)
8. [Sealed Interface vs Sealed Abstract Class](#8-sealed-interface-vs-sealed-abstract-class)
9. [Sealed + Records: Algebraic Data Type ala Java](#9-sealed--records-algebraic-data-type-ala-java)
10. [Exhaustive `switch` dan Pattern Matching](#10-exhaustive-switch-dan-pattern-matching)
11. [Sealed Type vs Enum](#11-sealed-type-vs-enum)
12. [Sealed Type vs Inheritance Biasa](#12-sealed-type-vs-inheritance-biasa)
13. [Sealed Type vs Visitor Pattern](#13-sealed-type-vs-visitor-pattern)
14. [Modeling Result dengan Sealed Type](#14-modeling-result-dengan-sealed-type)
15. [Modeling Error dengan Sealed Type](#15-modeling-error-dengan-sealed-type)
16. [Modeling State dengan Sealed Type](#16-modeling-state-dengan-sealed-type)
17. [Modeling Command dan Event](#17-modeling-command-dan-event)
18. [Modeling Optional/Absence yang Kaya](#18-modeling-optionalabsence-yang-kaya)
19. [Sealed Type dan Domain Invariants](#19-sealed-type-dan-domain-invariants)
20. [Sealed Type dan API Boundary](#20-sealed-type-dan-api-boundary)
21. [Sealed Type dan JSON Serialization](#21-sealed-type-dan-json-serialization)
22. [Sealed Type dan Database Mapping](#22-sealed-type-dan-database-mapping)
23. [Sealed Type dan Kafka/Event Schema](#23-sealed-type-dan-kafkaevent-schema)
24. [Sealed Type dan Compatibility](#24-sealed-type-dan-compatibility)
25. [Sealed Type dan Modularization](#25-sealed-type-dan-modularization)
26. [Reflection: `Class.isSealed()` dan `getPermittedSubclasses()`](#26-reflection-classissealed-dan-getpermittedsubclasses)
27. [Testing Sealed Hierarchy](#27-testing-sealed-hierarchy)
28. [Design Smells](#28-design-smells)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

Sebelumnya kita sudah membahas:

- primitive types;
- reference types;
- `String`;
- enum;
- records.

Sekarang kita masuk ke fitur yang menyatukan banyak konsep modern Java:

```java
sealed interface CloseCaseResult
    permits CaseClosed, CloseRejected, CaseNotFound {}

record CaseClosed(CaseId caseId, Instant closedAt) implements CloseCaseResult {}
record CloseRejected(CaseId caseId, RejectionReason reason) implements CloseCaseResult {}
record CaseNotFound(CaseId caseId) implements CloseCaseResult {}
```

Dengan sealed types, kita bisa mengatakan:

```text
CloseCaseResult hanya boleh berupa CaseClosed, CloseRejected, atau CaseNotFound.
Tidak ada implementasi lain di luar daftar itu.
```

Ini sangat kuat untuk:

- result modeling;
- state modeling;
- error modeling;
- command/event modeling;
- replacing boolean/string/int status;
- exhaustive switch;
- domain invariants;
- safer polymorphism.

Tujuan bagian ini:

- memahami sealed class/interface;
- memahami `permits`;
- memahami hubungan subtype dengan `final`, `sealed`, `non-sealed`;
- memahami sealed + records sebagai ADT-style modeling;
- memahami kapan sealed lebih tepat dari enum;
- memahami exhaustive pattern matching;
- memahami compatibility risiko saat menambah variant;
- memahami serialization/API/DB/event boundary.

---

# 2. Masalah yang Diselesaikan Sealed Types

## 2.1 Inheritance biasa terlalu terbuka

```java
interface PaymentResult {}
```

Siapa pun bisa membuat:

```java
class WeirdResult implements PaymentResult {}
```

Jika domain hanya mengizinkan:

```text
PaymentSuccess
PaymentRejected
PaymentFailed
```

maka inheritance terbuka membuat model terlalu longgar.

## 2.2 Enum terlalu miskin data

```java
enum PaymentResult {
    SUCCESS,
    REJECTED,
    FAILED
}
```

Tapi setiap result butuh data berbeda:

```text
SUCCESS: paymentId, capturedAt
REJECTED: reasonCode, message
FAILED: exceptionId, retryable
```

Enum bisa punya fields, tetapi tiap constant sulit membawa data instance berbeda per operation result.

## 2.3 Boolean result terlalu miskin

```java
boolean success = paymentService.pay(command);
```

Jika false, kenapa?

- card declined?
- validation failed?
- timeout?
- duplicate request?
- insufficient balance?
- fraud rejected?

## 2.4 Exception untuk normal domain outcome terlalu kasar

Tidak semua non-success adalah exception.

Contoh:

```text
CaseNotFound
CloseRejected
AlreadyClosed
```

bisa menjadi normal business outcome.

## 2.5 Sealed type memberikan closed alternatives with data

```java
sealed interface PaymentResult permits PaymentCaptured, PaymentRejected, PaymentFailed {}

record PaymentCaptured(PaymentId paymentId, Instant capturedAt) implements PaymentResult {}
record PaymentRejected(RejectReason reason) implements PaymentResult {}
record PaymentFailed(ErrorId errorId, boolean retryable) implements PaymentResult {}
```

---

# 3. Apa Itu Sealed Class dan Sealed Interface

Sealed class/interface membatasi siapa yang boleh extend/implement.

```java
public sealed interface Shape
    permits Circle, Rectangle, Triangle {}
```

Hanya `Circle`, `Rectangle`, dan `Triangle` yang boleh implement `Shape`.

## 3.1 Sealed class

```java
public sealed abstract class Shape
    permits Circle, Rectangle {}
```

## 3.2 Sealed interface

```java
public sealed interface Shape
    permits Circle, Rectangle {}
```

## 3.3 Permitted subtype

```java
public final class Circle implements Shape {}
public final class Rectangle implements Shape {}
```

Subtype harus secara eksplisit memilih:

- `final`;
- `sealed`;
- `non-sealed`.

## 3.4 Goal

Menurut JEP 409, sealed classes/interfaces restrict which other classes or interfaces may extend or implement them.

Ini membuat inheritance menjadi controlled, bukan open-ended.

---

# 4. Mental Model: Closed Polymorphic Hierarchy

Sealed hierarchy adalah:

```text
A known finite set of subtypes under one supertype.
```

Contoh:

```java
sealed interface CaseState permits Draft, UnderReview, Closed, Rejected {}
```

Kemungkinan runtime object:

```text
Draft
UnderReview
Closed
Rejected
```

Tidak ada yang lain.

## 4.1 Closed world untuk subtype

Compiler/runtime tahu permitted subclasses.

Ini memungkinkan exhaustive reasoning.

## 4.2 Polymorphic data, not just constants

Berbeda dari enum, setiap subtype bisa punya data berbeda:

```java
record Draft() implements CaseState {}
record UnderReview(OfficerId officerId, Instant assignedAt) implements CaseState {}
record Closed(OfficerId closedBy, ClosureReason reason, Instant closedAt) implements CaseState {}
record Rejected(OfficerId rejectedBy, RejectionReason reason, Instant rejectedAt) implements CaseState {}
```

## 4.3 Domain algebra

Sealed + records membuat bentuk seperti algebraic data type:

```text
CaseState =
    Draft
  | UnderReview(officerId, assignedAt)
  | Closed(closedBy, reason, closedAt)
  | Rejected(rejectedBy, reason, rejectedAt)
```

Ini sangat powerful untuk membuat impossible state tidak representable.

## 4.4 Compiler as design partner

Jika semua alternatives diketahui, switch bisa exhaustive.

Saat variant baru ditambah, compiler membantu menemukan logic yang belum diupdate.

---

# 5. Syntax Dasar `sealed`, `permits`, `final`, `non-sealed`

## 5.1 Sealed interface

```java
public sealed interface CloseCaseResult
    permits CaseClosed, CloseRejected, CaseNotFound {
}
```

## 5.2 Final implementations

```java
public record CaseClosed(CaseId caseId, Instant closedAt)
    implements CloseCaseResult {}

public record CloseRejected(CaseId caseId, RejectionReason reason)
    implements CloseCaseResult {}

public record CaseNotFound(CaseId caseId)
    implements CloseCaseResult {}
```

Records are final by default, so they satisfy permitted subtype requirement.

## 5.3 Sealed class

```java
public sealed abstract class Document
    permits PdfDocument, ImageDocument {
}

public final class PdfDocument extends Document {}
public final class ImageDocument extends Document {}
```

## 5.4 Non-sealed subtype

```java
public sealed interface Shape permits Circle, Polygon {}

public final class Circle implements Shape {}

public non-sealed interface Polygon extends Shape {}
```

Now `Polygon` is open for further implementations.

## 5.5 Sealed subtype

```java
public sealed interface ErrorResult permits ValidationError, SystemError {}

public sealed interface ValidationError extends ErrorResult
    permits MissingField, InvalidFormat {}

public final class MissingField implements ValidationError {}
public final class InvalidFormat implements ValidationError {}

public final class SystemError implements ErrorResult {}
```

Hierarchy can be partially closed at multiple levels.

---

# 6. Aturan Permitted Subclasses

## 6.1 Direct subtype must be named

A sealed class/interface lists permitted direct subtypes with `permits`, unless compiler can infer in some same-file scenarios.

Example explicit:

```java
sealed interface Result permits Success, Failure {}
```

## 6.2 Direct subtype must extend/implement sealed parent

```java
final class Success implements Result {}
```

## 6.3 Direct subtype must declare final/sealed/non-sealed

```java
final class Success implements Result {}
```

or:

```java
sealed class Intermediate implements Result permits Child {}
```

or:

```java
non-sealed class OpenExtension implements Result {}
```

## 6.4 Package/module proximity

Permitted subclasses must be accessible in a controlled way. In unnamed module, permitted classes are typically in the same package. In named modules, they must be in same module.

This prevents arbitrary external code from extending sealed hierarchy.

## 6.5 Records and enums

Records are implicitly final, so they work naturally as final permitted subclasses.

Enums can implement sealed interfaces too, but enum itself has special rules and is final-ish unless constants have class bodies.

---

# 7. `final`, `sealed`, dan `non-sealed` pada Subtype

Every direct subclass of sealed type must declare how inheritance continues.

## 7.1 final

```java
final class Circle implements Shape {}
```

No further subclassing.

Use when variant is complete.

## 7.2 sealed

```java
sealed interface Polygon extends Shape permits Triangle, Rectangle {}
```

Still closed, but with another level.

Use when variant group has sub-variants.

## 7.3 non-sealed

```java
non-sealed interface PluginShape extends Shape {}
```

Reopens hierarchy beyond that point.

Use carefully.

## 7.4 Why require explicit modifier?

Java forces designer to decide:

```text
Is this branch closed?
Open?
Partially closed?
```

This prevents accidental openness.

## 7.5 Production rule

Prefer `final` records/classes for variants unless you deliberately need extension.

Use `non-sealed` sparingly because it weakens closed-world reasoning.

---

# 8. Sealed Interface vs Sealed Abstract Class

## 8.1 Sealed interface

Good for pure sum type / variants:

```java
sealed interface PaymentResult permits Captured, Rejected, Failed {}
```

Pros:

- variants can be records/classes/enums;
- no shared state;
- flexible;
- works well with records;
- clean ADT modeling.

## 8.2 Sealed abstract class

Good when variants share implementation/state:

```java
sealed abstract class DomainError permits ValidationError, SystemError {
    private final ErrorCode code;

    protected DomainError(ErrorCode code) {
        this.code = code;
    }

    public ErrorCode code() {
        return code;
    }
}
```

## 8.3 Interface default methods

Sealed interface can still have default methods:

```java
sealed interface DomainError permits ValidationError, SystemError {
    ErrorCode code();

    default boolean retryable() {
        return false;
    }
}
```

## 8.4 Prefer sealed interface for data alternatives

Most modern Java ADT-style modeling uses:

```java
sealed interface + records
```

## 8.5 Use abstract class when

- shared constructor/state;
- protected helper methods;
- strict base behavior;
- object identity hierarchy;
- framework requirement.

But avoid inheritance complexity if interface + composition enough.

---

# 9. Sealed + Records: Algebraic Data Type ala Java

Sealed interfaces define closed alternatives. Records define immutable data for each alternative.

```java
public sealed interface EligibilityResult
    permits Eligible, NotEligible {}

public record Eligible() implements EligibilityResult {}

public record NotEligible(List<Violation> violations)
    implements EligibilityResult {
    public NotEligible {
        violations = List.copyOf(violations);
        if (violations.isEmpty()) {
            throw new IllegalArgumentException("violations cannot be empty");
        }
    }
}
```

## 9.1 Why powerful?

The type says:

```text
EligibilityResult is either Eligible or NotEligible.
If NotEligible, violations are required and non-empty.
```

No nullable reason field.

No boolean + list mismatch.

## 9.2 Replaces invalid states

Bad:

```java
record Eligibility(boolean eligible, List<Violation> violations) {}
```

Invalid combinations:

```text
eligible=true, violations non-empty
eligible=false, violations empty
eligible=false, violations null
```

Sealed version removes these.

## 9.3 Event/result modeling

```java
sealed interface CreateUserResult permits UserCreated, DuplicateEmail, InvalidUser {}

record UserCreated(UserId userId) implements CreateUserResult {}
record DuplicateEmail(EmailAddress email) implements CreateUserResult {}
record InvalidUser(List<Violation> violations) implements CreateUserResult {}
```

## 9.4 State modeling

```java
sealed interface AccountState permits Active, Suspended, Deleted {}

record Active(Instant activatedAt) implements AccountState {}
record Suspended(SuspensionReason reason, Instant suspendedAt) implements AccountState {}
record Deleted(DeletionReason reason, Instant deletedAt) implements AccountState {}
```

---

# 10. Exhaustive `switch` dan Pattern Matching

Sealed types shine with pattern matching switch.

```java
String message = switch (result) {
    case UserCreated created -> "Created: " + created.userId();
    case DuplicateEmail duplicate -> "Duplicate: " + duplicate.email();
    case InvalidUser invalid -> "Invalid: " + invalid.violations();
};
```

Because `CreateUserResult` is sealed and all permitted subtypes are covered, compiler can verify exhaustiveness.

## 10.1 No default can be good

No default means adding new variant causes compile error in switch expressions that need update.

This is excellent for domain logic.

## 10.2 Default can hide missing case

```java
switch (result) {
    case UserCreated created -> ...
    default -> ...
}
```

If new subtype added, default catches it silently.

Sometimes boundary code needs default, but core domain logic usually should be exhaustive.

## 10.3 Pattern switch maturity

Pattern matching for switch became final in Java 21 via JEP 441. Sealed types and pattern matching work together to support exhaustive type-safe branching.

## 10.4 Null handling

Switch selector null needs explicit policy. Classic switch throws NPE. Pattern switch can support `case null` in modern Java.

Better: domain result should be non-null.

## 10.5 If your project Java version

If project is Java 17, sealed classes are final, but pattern switch was preview then. In Java 21+, pattern switch is final. In Java 25, it is part of standard language.

---

# 11. Sealed Type vs Enum

## 11.1 Enum

Use enum when alternatives are constants with same shape.

```java
enum CaseStatus {
    DRAFT,
    UNDER_REVIEW,
    CLOSED
}
```

## 11.2 Sealed type

Use sealed type when alternatives have different data.

```java
sealed interface CaseState permits Draft, UnderReview, Closed {}

record Draft() implements CaseState {}
record UnderReview(OfficerId officerId, Instant assignedAt) implements CaseState {}
record Closed(OfficerId closedBy, ClosureReason reason, Instant closedAt) implements CaseState {}
```

## 11.3 Enum with nullable fields smell

Bad:

```java
record Case(
    CaseStatus status,
    OfficerId assignedOfficer, // only for UNDER_REVIEW
    Instant closedAt,          // only for CLOSED
    ClosureReason reason       // only for CLOSED
) {}
```

Sealed state better.

## 11.4 Enum can be projection

You can derive enum from sealed state:

```java
CaseStatus status() {
    return switch (state) {
        case Draft d -> CaseStatus.DRAFT;
        case UnderReview r -> CaseStatus.UNDER_REVIEW;
        case Closed c -> CaseStatus.CLOSED;
    };
}
```

## 11.5 Decision

```text
Same data shape -> enum
Different data shape -> sealed type
```

---

# 12. Sealed Type vs Inheritance Biasa

## 12.1 Open interface

```java
interface Command {}
```

Anyone can implement.

Good for plugin extension.

Bad for closed domain command set.

## 12.2 Sealed interface

```java
sealed interface Command permits SubmitCase, CloseCase, ReopenCase {}
```

Only known commands.

Good for internal bounded context.

## 12.3 Abstract class open

```java
abstract class DomainEvent {}
```

Unknown subclasses possible.

## 12.4 Sealed abstract class

```java
sealed abstract class DomainEvent permits CaseSubmitted, CaseClosed {}
```

Closed event set.

## 12.5 Use ordinary inheritance when

- external extension intended;
- plugin architecture;
- framework extension point;
- unknown implementors acceptable;
- library API meant for users to implement.

Use sealed when domain alternatives should be known and controlled.

---

# 13. Sealed Type vs Visitor Pattern

Before sealed + pattern switch, visitor pattern often handled closed hierarchies.

```java
interface Shape {
    <R> R accept(ShapeVisitor<R> visitor);
}
```

## 13.1 Visitor benefits

- double dispatch;
- operations separated;
- older Java compatibility;
- can force handling all variants if visitor has all methods.

## 13.2 Visitor costs

- boilerplate;
- difficult evolution;
- harder readability;
- awkward with generics;
- invasive accept method.

## 13.3 Sealed + switch alternative

```java
double area(Shape shape) {
    return switch (shape) {
        case Circle c -> ...
        case Rectangle r -> ...
    };
}
```

Cleaner for many cases.

## 13.4 When visitor still useful?

- Java version before pattern switch;
- operations as objects;
- external libraries expecting visitor;
- complex double dispatch;
- avoiding huge switch spread across codebase by centralizing operations.

## 13.5 Modern default

For domain ADT-style modeling in modern Java, sealed + records + switch is usually simpler.

---

# 14. Modeling Result dengan Sealed Type

Boolean result is poor.

Bad:

```java
boolean closeCase(CaseId id);
```

Better:

```java
sealed interface CloseCaseResult
    permits CaseClosed, CaseAlreadyClosed, CloseRejected, CaseNotFound {}

record CaseClosed(CaseId caseId, Instant closedAt) implements CloseCaseResult {}
record CaseAlreadyClosed(CaseId caseId, Instant closedAt) implements CloseCaseResult {}
record CloseRejected(CaseId caseId, RejectionReason reason) implements CloseCaseResult {}
record CaseNotFound(CaseId caseId) implements CloseCaseResult {}
```

## 14.1 Handling

```java
HttpResponse response = switch (result) {
    case CaseClosed closed -> ok(closed);
    case CaseAlreadyClosed already -> conflict(already);
    case CloseRejected rejected -> unprocessable(rejected);
    case CaseNotFound notFound -> notFound(notFound);
};
```

## 14.2 No ambiguous null

Do not return null for not found.

Use `CaseNotFound`.

## 14.3 No exception for expected outcome

If rejection is domain-normal, model it as variant.

Exceptions remain for exceptional/infrastructure failures.

## 14.4 Result with data

Each variant carries exactly data it needs.

No optional fields.

---

# 15. Modeling Error dengan Sealed Type

Not all errors are same.

```java
sealed interface CreateCaseError
    permits ValidationError, AuthorizationError, ConflictError {}

record ValidationError(List<Violation> violations) implements CreateCaseError {}
record AuthorizationError(ActorId actorId, Permission permission) implements CreateCaseError {}
record ConflictError(CaseId caseId, Version currentVersion) implements CreateCaseError {}
```

## 15.1 Error as data

Useful when error is part of domain flow.

## 15.2 Exception vs error result

Use exception for:

- programmer error;
- infrastructure failure;
- unexpected failure;
- transaction failure;
- unrecoverable system issue.

Use sealed error result for:

- validation;
- business rejection;
- authorization decision that caller handles;
- conflict;
- not found if expected.

## 15.3 API mapping

```java
int statusCode = switch (error) {
    case ValidationError e -> 400;
    case AuthorizationError e -> 403;
    case ConflictError e -> 409;
};
```

## 15.4 Auditability

Error variants can carry reason/policy version.

```java
record PolicyDenied(String code, String explanation, PolicyVersion version)
    implements AuthorizationDecision {}
```

---

# 16. Modeling State dengan Sealed Type

State often has state-specific data.

Bad:

```java
enum CaseStatus { DRAFT, ASSIGNED, CLOSED }

record CaseRecord(
    CaseStatus status,
    OfficerId assignedOfficer,
    Instant assignedAt,
    OfficerId closedBy,
    Instant closedAt,
    ClosureReason closureReason
) {}
```

Many null fields.

Better:

```java
sealed interface CaseState permits Draft, Assigned, Closed {}

record Draft() implements CaseState {}

record Assigned(
    OfficerId officerId,
    Instant assignedAt
) implements CaseState {}

record Closed(
    OfficerId closedBy,
    Instant closedAt,
    ClosureReason reason
) implements CaseState {}
```

## 16.1 Impossible states removed

You cannot create:

```text
status=CLOSED but closedAt=null
status=DRAFT but assignedOfficer exists
```

because those fields exist only in correct variant.

## 16.2 Transition

```java
CaseState assign(CaseState state, OfficerId officerId, Clock clock) {
    return switch (state) {
        case Draft d -> new Assigned(officerId, clock.instant());
        case Assigned a -> throw new IllegalStateException("Already assigned");
        case Closed c -> throw new IllegalStateException("Closed");
    };
}
```

## 16.3 Entity wrapper

Aggregate entity can hold sealed state:

```java
final class CaseRecord {
    private final CaseId id;
    private CaseState state;
}
```

## 16.4 Persistence

DB mapping may still store status + nullable columns or separate tables. Domain model can be sealed even if persistence representation is relational.

Mapping layer enforces consistency.

---

# 17. Modeling Command dan Event

## 17.1 Command

```java
sealed interface CaseCommand permits SubmitCase, AssignCase, CloseCase {}

record SubmitCase(CaseId caseId, ActorId actorId) implements CaseCommand {}
record AssignCase(CaseId caseId, OfficerId officerId, ActorId actorId) implements CaseCommand {}
record CloseCase(CaseId caseId, ClosureReason reason, ActorId actorId) implements CaseCommand {}
```

## 17.2 Event

```java
sealed interface CaseEvent permits CaseSubmitted, CaseAssigned, CaseClosed {}

record CaseSubmitted(CaseId caseId, ActorId actorId, Instant occurredAt) implements CaseEvent {}
record CaseAssigned(CaseId caseId, OfficerId officerId, Instant occurredAt) implements CaseEvent {}
record CaseClosed(CaseId caseId, ClosureReason reason, Instant occurredAt) implements CaseEvent {}
```

## 17.3 Dispatcher

```java
void handle(CaseCommand command) {
    switch (command) {
        case SubmitCase c -> submit(c);
        case AssignCase c -> assign(c);
        case CloseCase c -> close(c);
    }
}
```

## 17.4 Boundary warning

If commands/events cross service boundary, adding variant is compatibility change.

Internal sealed hierarchy is easier than external public schema.

---

# 18. Modeling Optional/Absence yang Kaya

`Optional<T>` only models present/absent.

Sometimes absence has reasons.

Bad:

```java
Optional<RiskScore> score
```

if absence can mean:

- not calculated;
- not authorized;
- insufficient data;
- calculation failed;
- expired.

Better:

```java
sealed interface RiskScoreState
    permits ScoreAvailable, ScoreNotCalculated, ScoreInsufficientData, ScoreHidden {}

record ScoreAvailable(RiskScore score, Instant calculatedAt) implements RiskScoreState {}
record ScoreNotCalculated() implements RiskScoreState {}
record ScoreInsufficientData(List<MissingData> missingData) implements RiskScoreState {}
record ScoreHidden(PolicyReason reason) implements RiskScoreState {}
```

## 18.1 Avoid null reason

No:

```java
RiskScore score;
String missingReason;
```

## 18.2 UI handling

```java
String label = switch (state) {
    case ScoreAvailable s -> s.score().toString();
    case ScoreNotCalculated s -> "Not calculated";
    case ScoreInsufficientData s -> "Insufficient data";
    case ScoreHidden s -> "Hidden";
};
```

## 18.3 API response

Map sealed domain state to explicit DTO with type discriminator.

---

# 19. Sealed Type dan Domain Invariants

Sealed types help enforce invariants by construction.

## 19.1 Invalid combination impossible

```java
record Closed(OfficerId closedBy, Instant closedAt, ClosureReason reason)
```

A closed state always has closedBy, closedAt, reason.

## 19.2 Constructor validation per variant

```java
record Closed(OfficerId closedBy, Instant closedAt, ClosureReason reason)
    implements CaseState {
    Closed {
        Objects.requireNonNull(closedBy);
        Objects.requireNonNull(closedAt);
        Objects.requireNonNull(reason);
    }
}
```

## 19.3 State-specific behavior

```java
boolean isTerminal() {
    return switch (this) {
        case Draft d -> false;
        case Assigned a -> false;
        case Closed c -> true;
        case Rejected r -> true;
    };
}
```

Could be default method on sealed interface.

## 19.4 Avoid leaking setters

Do not expose:

```java
setStatus
setClosedAt
setReason
```

Use transition methods.

---

# 20. Sealed Type dan API Boundary

Sealed domain model may need mapping to DTOs.

## 20.1 Type discriminator

JSON often needs discriminator:

```json
{
  "type": "CLOSED",
  "caseId": "CASE-001",
  "closedAt": "2026-06-12T10:00:00Z",
  "reason": "DONE"
}
```

## 20.2 DTO variants

```java
sealed interface CaseStateDto permits DraftDto, AssignedDto, ClosedDto {}

record DraftDto(String type) implements CaseStateDto {}
record AssignedDto(String type, String officerId, String assignedAt) implements CaseStateDto {}
record ClosedDto(String type, String closedBy, String closedAt, String reason) implements CaseStateDto {}
```

## 20.3 External compatibility

Adding sealed domain variant may require:

- new JSON type;
- OpenAPI update;
- frontend handling;
- client compatibility plan.

## 20.4 Internal vs external sealed

You can keep domain sealed and expose simpler enum/status externally if needed.

## 20.5 Validation

External input must validate discriminator and required fields per type.

---

# 21. Sealed Type dan JSON Serialization

Java sealed hierarchy does not automatically define JSON shape.

Serialization library needs configuration for polymorphic types.

## 21.1 Common options

- discriminator property;
- wrapper object;
- external type field;
- custom serializer/deserializer;
- mapping manually to DTO.

## 21.2 Manual mapping often safest

Domain:

```java
CaseState
```

DTO:

```java
CaseStateResponse
```

Mapper:

```java
CaseStateResponse toDto(CaseState state) {
    return switch (state) {
        case Draft d -> ...
        case Assigned a -> ...
        case Closed c -> ...
    };
}
```

## 21.3 Avoid exposing Java class names

Bad JSON:

```json
{
  "@class": "com.example.domain.Closed"
}
```

This leaks internals and can be security risk depending library.

Use stable type codes:

```json
{ "type": "CLOSED" }
```

## 21.4 Unknown types

Deserializer should handle unknown external type explicitly.

Return validation error, not generic 500.

## 21.5 Versioning

Adding variant changes schema.

Plan for old clients.

---

# 22. Sealed Type dan Database Mapping

Relational DB does not store sealed hierarchy directly.

Options:

## 22.1 Single table with discriminator

```sql
case_state_type VARCHAR(32) NOT NULL
assigned_officer_id UUID NULL
assigned_at TIMESTAMP NULL
closed_by UUID NULL
closed_at TIMESTAMP NULL
closure_reason VARCHAR(255) NULL
```

Mapping enforces nullability based on discriminator.

## 22.2 Multiple tables

```text
case_draft
case_assigned
case_closed
```

More normalized but more complex.

## 22.3 JSON column

Store state object as JSON with type discriminator.

Pros:

- flexible;
- variant-specific fields.

Cons:

- query/index constraints;
- schema validation;
- migration;
- DB portability.

## 22.4 Event sourcing

State variants can be derived from event stream.

Events can be sealed hierarchy internally.

## 22.5 Mapping layer responsibility

DB may allow invalid combinations unless constraints enforce.

Domain sealed model should not accept invalid state.

---

# 23. Sealed Type dan Kafka/Event Schema

Events often map well to sealed hierarchy internally:

```java
sealed interface CaseEvent permits CaseSubmitted, CaseAssigned, CaseClosed {}
```

But event schema compatibility matters.

## 23.1 New event type

Adding new permitted subtype means new event type.

Consumers must handle it.

## 23.2 Consumer strategy

- fail to DLQ on unknown type;
- ignore unknown type if safe;
- route to generic handler;
- upgrade consumers first;
- version event stream.

## 23.3 Schema registry

If using Avro/Protobuf/JSON Schema, understand union/oneof/enum evolution rules.

## 23.4 Stable type names

Do not use Java class name as event type.

Use explicit event type code:

```java
String eventType()
```

or mapper.

## 23.5 Internal sealed, external schema

Keep sealed type in code; serialize to stable event contract.

---

# 24. Sealed Type dan Compatibility

Sealed hierarchy changes are compatibility-sensitive.

## 24.1 Adding permitted subtype

Source code with exhaustive switch may fail to compile until updated. This is often desired.

Runtime consumers of external API/event may break if not prepared.

## 24.2 Removing subtype

Dangerous if persisted data/events/API can still contain it.

Deprecate first.

## 24.3 Changing subtype from final to non-sealed

Opens extension; may break exhaustiveness assumptions.

## 24.4 Changing permits list

Affects who can extend/implement. Binary/source compatibility rules apply.

JLS has binary compatibility rules for evolving sealed/non-sealed/final classes.

## 24.5 Versioning checklist

Before adding sealed variant:

- all switch expressions updated?
- JSON discriminator added?
- DB mapping updated?
- event schema updated?
- consumer behavior defined?
- UI display added?
- tests exhaustive?
- documentation updated?
- backward compatibility reviewed?

---

# 25. Sealed Type dan Modularization

Sealed hierarchies interact with packages/modules.

## 25.1 Same module/package constraints

Permitted direct subclasses must be within allowed module/package constraints.

This supports control over hierarchy.

## 25.2 Public API sealed type

If library exposes public sealed interface, users cannot implement it unless listed.

This is intentional.

## 25.3 Internal domain sealed type

Often best:

```java
package-private sealed interface InternalState permits ...
```

Expose public methods/DTOs instead.

## 25.4 Plugins

If you want external plugin implementations, sealed type may be wrong or use `non-sealed` branch as extension point.

```java
sealed interface Rule permits BuiltInRule, ExternalRule {}

non-sealed interface ExternalRule extends Rule {}
```

## 25.5 Module design

Sealed types can enforce bounded context boundaries by preventing arbitrary subtypes outside module.

---

# 26. Reflection: `Class.isSealed()` dan `getPermittedSubclasses()`

Java reflection supports sealed classes/interfaces.

```java
Class<?> clazz = CloseCaseResult.class;

boolean sealed = clazz.isSealed();
Class<?>[] permitted = clazz.getPermittedSubclasses();
```

Java SE 25 `Class` API states `isSealed()` returns true iff the Class object represents a sealed class or interface, and `getPermittedSubclasses()` returns permitted subclasses for sealed class/interface.

## 26.1 Use cases

- framework validation;
- documentation generation;
- JSON subtype registration;
- test coverage;
- architecture checks.

## 26.2 Reflection is not domain logic

Do not replace normal switch with reflection in business code.

## 26.3 Build-time scanning

Can use reflection/tests to ensure every variant has:

- JSON mapping;
- DB mapping;
- handler;
- display label;
- documentation.

## 26.4 Example test

```java
assertThat(CloseCaseResult.class.isSealed()).isTrue();

Set<Class<?>> permitted = Set.of(CloseCaseResult.class.getPermittedSubclasses());
assertThat(permitted).containsExactlyInAnyOrder(
    CaseClosed.class,
    CloseRejected.class,
    CaseNotFound.class
);
```

---

# 27. Testing Sealed Hierarchy

## 27.1 Exhaustive switch tests

Compiler handles much, but tests verify behavior.

```java
for (Class<?> subtype : Result.class.getPermittedSubclasses()) {
    ...
}
```

## 27.2 Variant constructor tests

Each variant should validate invariants.

## 27.3 Mapping tests

For every variant:

- domain -> DTO;
- DTO -> domain;
- domain -> DB;
- DB -> domain;
- event serialization;
- event deserialization.

## 27.4 Handler coverage

If using handler map:

```java
Map<Class<? extends Result>, Handler> handlers
```

verify all permitted subclasses covered.

## 27.5 Golden files

For event/API JSON variants, keep golden samples.

## 27.6 Mutation tests

Sealed result logic often has switch branches. Mutation testing can catch missing assertions.

---

# 28. Design Smells

## 28.1 Sealed hierarchy with one subtype

Maybe unnecessary unless anticipating controlled expansion.

## 28.2 Too many variants

If 30 variants, hierarchy may be too broad or missing sub-grouping.

Consider nested sealed sub-hierarchies.

## 28.3 Variants with same fields and no behavior

Maybe enum is enough.

## 28.4 Sealed type exposed directly across service boundary

May couple Java internal model to external schema.

Use DTO mapping.

## 28.5 non-sealed everywhere

If every branch is `non-sealed`, sealing adds little.

## 28.6 `instanceof` scattered everywhere

If many switches over same hierarchy across codebase, consider:

- central policy methods;
- visitor;
- behavior on variants;
- service dispatch map.

## 28.7 Nullable fields inside variants

Variant should have exact data. Avoid:

```java
record Closed(Instant closedAt, String reasonNullable)
```

if reason required.

## 28.8 Business taxonomy as sealed hierarchy

If business can add types dynamically, sealed type may require deployment each change. Use reference data/config.

---

# 29. Production Failure Modes

## 29.1 New variant not handled in API mapper

Domain adds variant, API mapper has default returning generic error.

Fix:

- exhaustive switch without default;
- tests over permitted subclasses.

## 29.2 JSON deserialization exposes class names

Security/internal leak.

Fix:

- stable discriminator codes;
- manual DTO mapping.

## 29.3 Database invalid discriminator combination

DB row says CLOSED but closed_at null.

Fix:

- DB constraints;
- mapping validation;
- sealed domain constructor.

## 29.4 Event consumer crashes on new type

Producer emits new subtype; old consumer uses strict parser.

Fix:

- compatibility rollout;
- unknown handling policy;
- schema evolution.

## 29.5 non-sealed branch breaks exhaustiveness

Designer opens hierarchy; switch no longer safely exhaustive for unknown external implementors.

Fix:

- avoid non-sealed in core domain;
- isolate extension point.

## 29.6 Sealed type used for dynamic config

Adding new config category requires deployment.

Fix:

- data-driven model.

## 29.7 Record variant with mutable component

Sealed result variant mutable after creation.

Fix:

- defensive copy;
- immutable components.

## 29.8 Exceptions replaced by sealed errors incorrectly

Infrastructure failures modeled as normal result and ignored.

Fix:

- distinguish domain outcome vs system failure.

## 29.9 Public sealed API too restrictive

Library users need extension but cannot implement.

Fix:

- don't seal extension APIs;
- provide non-sealed extension branch.

## 29.10 Exhaustive switch with default hides compile-time help

Fix:

- remove default in core domain switch;
- handle all variants explicitly.

---

# 30. Best Practices

## 30.1 General

- Use sealed interfaces + records for closed alternatives with data.
- Use enum for closed constants with same shape.
- Use sealed abstract class when shared state/implementation needed.
- Prefer final records as variants.
- Use `non-sealed` only deliberately.
- Avoid nullable optional fields inside variants.
- Keep variant constructors validating invariants.
- Use exhaustive switch without default in core domain logic.
- Map sealed domain types to explicit DTOs at boundaries.
- Use stable type discriminator for JSON/events.
- Treat adding variant as compatibility event.
- Test mapping coverage for all permitted subclasses.
- Avoid exposing internal class names in serialized form.
- Avoid sealed types for dynamic business reference data.
- Use reflection only for tooling/tests/frameworks, not core business branching.

## 30.2 Domain modeling

Good sealed type candidates:

- result;
- error;
- state;
- command;
- event;
- rich optional/absence;
- policy decision;
- validation outcome.

Bad candidates:

- user-editable categories;
- country/currency lists;
- plugin extension points;
- arbitrary external event types;
- huge taxonomy that changes frequently.

## 30.3 Boundary

- Internal sealed hierarchy can be rich.
- External contract should be stable.
- DTOs should have explicit discriminator.
- DB mapping should validate discriminator-specific fields.
- Event schema evolution must be planned.

---

# 31. Decision Matrix

| Situation | Use sealed type? | Better alternative |
|---|---:|---|
| result success/failure with data | yes | n/a |
| validation result with violations | yes | n/a |
| state with state-specific fields | yes | n/a |
| simple status constants | maybe no | enum |
| permission set | no | EnumSet |
| dynamic category from DB | no | reference table |
| public plugin API | usually no | open interface |
| controlled extension branch | maybe | sealed + non-sealed branch |
| event hierarchy internal | yes | map to external schema |
| API polymorphic response | maybe | explicit DTO discriminator |
| JPA entity inheritance | careful | class hierarchy/ORM mapping |
| error codes only | enum | sealed if variant data differs |
| command set in bounded context | yes | sealed command interface |
| optional with reason | yes | Optional if no reason |
| one variant only | usually no | class/record |
| variants all same fields | maybe enum + fields | record if one data shape |

---

# 32. Latihan

## Latihan 1 — CloseCaseResult

Model:

```java
sealed interface CloseCaseResult
record CaseClosed(...)
record CloseRejected(...)
record CaseNotFound(...)
```

Handle with exhaustive switch.

## Latihan 2 — Replace Boolean Result

Refactor:

```java
boolean canApprove(Case c)
```

to:

```java
sealed interface ApprovalEligibility
record Eligible()
record NotEligible(List<Violation>)
```

## Latihan 3 — CaseState

Model states:

```text
Draft
Assigned(officerId, assignedAt)
Closed(closedBy, closedAt, reason)
Rejected(rejectedBy, rejectedAt, reason)
```

Ensure impossible states cannot compile.

## Latihan 4 — Enum vs Sealed

Create enum `CaseStatus`. Then create sealed `CaseState`. Explain when each is appropriate.

## Latihan 5 — JSON DTO Mapping

Map sealed `CaseState` to DTO with `type` discriminator.

Do not expose Java class name.

## Latihan 6 — DB Mapping

Design single-table mapping for `CaseState` with discriminator and nullable columns. Add validation in mapper.

## Latihan 7 — Event Compatibility

Add new variant `CaseReopened`. List all code/schema/client places to update.

## Latihan 8 — Reflection Test

Use:

```java
CaseState.class.isSealed()
CaseState.class.getPermittedSubclasses()
```

to verify permitted subclasses.

## Latihan 9 — non-sealed Extension

Design sealed `Rule` with built-in final variants and one `non-sealed ExternalRule` extension point.

Explain trade-off.

## Latihan 10 — Sealed Error

Model:

```text
ValidationError
AuthorizationError
ConflictError
SystemFailure
```

Decide which should be domain result and which should be exception.

---

# 33. Ringkasan

Sealed types memberi Java kemampuan modeling closed polymorphic hierarchy.

Intinya:

```text
sealed type = supertype dengan daftar subtype yang dibatasi
```

Hal penting:

- `sealed class/interface` membatasi siapa yang boleh extend/implement.
- `permits` menyebut permitted direct subtypes.
- Setiap direct subtype harus `final`, `sealed`, atau `non-sealed`.
- Sealed + records sangat cocok untuk ADT-style modeling.
- Enum cocok untuk constants dengan shape sama.
- Sealed type cocok untuk alternatives dengan data berbeda.
- Pattern matching switch bisa exhaustive atas sealed hierarchy.
- `non-sealed` membuka kembali hierarchy dan harus dipakai hati-hati.
- Sealed domain types perlu mapping eksplisit untuk API/JSON/DB/events.
- Adding new variant adalah compatibility event.
- Reflection mendukung `isSealed()` dan `getPermittedSubclasses()`.

Senior Java engineer memakai sealed types untuk membuat impossible states unrepresentable dan membuat compiler ikut menjaga domain logic.

Jika enum menjawab:

```text
Nilainya yang mana?
```

sealed type menjawab:

```text
Bentuk datanya yang mana, dan data wajib apa yang ikut bersamanya?
```

Itulah kekuatan sealed types dalam Java modern.

---

# 34. Referensi

1. JEP 409 — Sealed Classes  
   https://openjdk.org/jeps/409

2. Java Language Specification SE 25 — Classes, Interfaces, and sealed/non-sealed/final Evolution  
   https://docs.oracle.com/javase/specs/jls/se25/html/index.html

3. Oracle Java Language Guide — Sealed Classes and Interfaces  
   https://docs.oracle.com/en/java/javase/17/language/sealed-classes-and-interfaces.html

4. Java SE 25 API — `Class.isSealed()` and `Class.getPermittedSubclasses()`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html

5. JEP 441 — Pattern Matching for switch  
   https://openjdk.org/jeps/441

6. JEP 440 — Record Patterns  
   https://openjdk.org/jeps/440

7. Java Language Specification SE 25 — Switch Statements and Expressions  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.11
