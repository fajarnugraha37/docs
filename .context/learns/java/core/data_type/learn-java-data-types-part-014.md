# learn-java-data-types-part-014.md

# Java Data Types — Part 014  
# Pattern Matching and Type Refinement: `instanceof`, `switch`, Record Patterns, dan Exhaustive Domain Logic

> Seri: **Advanced Java Data Types**  
> Bagian: **014**  
> Fokus: memahami pattern matching sebagai mekanisme type refinement modern di Java: type pattern di `instanceof`, flow scoping, pattern variable, pattern `switch`, guarded patterns, `case null`, dominance, exhaustiveness, sealed type synergy, record patterns, nested deconstruction, unnamed patterns, preview primitive patterns, dan bagaimana pattern matching membuat domain logic lebih aman, ekspresif, dan minim cast manual.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Sebelum Pattern Matching](#2-masalah-sebelum-pattern-matching)
3. [Mental Model: Pattern = Test + Binding + Refinement](#3-mental-model-pattern--test--binding--refinement)
4. [Type Pattern dengan `instanceof`](#4-type-pattern-dengan-instanceof)
5. [Flow Scoping](#5-flow-scoping)
6. [Pattern Variable dan Scope](#6-pattern-variable-dan-scope)
7. [Negation, Early Return, dan Guard Clause](#7-negation-early-return-dan-guard-clause)
8. [Pattern Matching dan Null](#8-pattern-matching-dan-null)
9. [Pattern Matching for `switch`](#9-pattern-matching-for-switch)
10. [Switch Expression vs Switch Statement](#10-switch-expression-vs-switch-statement)
11. [Dominance dan Ordering of Case Labels](#11-dominance-dan-ordering-of-case-labels)
12. [Guarded Patterns dengan `when`](#12-guarded-patterns-dengan-when)
13. [`case null`](#13-case-null)
14. [Exhaustiveness](#14-exhaustiveness)
15. [Sealed Types + Pattern Switch](#15-sealed-types--pattern-switch)
16. [Record Patterns](#16-record-patterns)
17. [Nested Record Patterns](#17-nested-record-patterns)
18. [`var` dalam Record Patterns](#18-var-dalam-record-patterns)
19. [Unnamed Patterns dan Unnamed Variables](#19-unnamed-patterns-dan-unnamed-variables)
20. [Primitive Types in Patterns: Preview Note](#20-primitive-types-in-patterns-preview-note)
21. [Type Refinement vs Casting Manual](#21-type-refinement-vs-casting-manual)
22. [Pattern Matching untuk Result Modeling](#22-pattern-matching-untuk-result-modeling)
23. [Pattern Matching untuk State Modeling](#23-pattern-matching-untuk-state-modeling)
24. [Pattern Matching untuk Error Handling](#24-pattern-matching-untuk-error-handling)
25. [Pattern Matching untuk DTO/API Mapping](#25-pattern-matching-untuk-dtoapi-mapping)
26. [Pattern Matching dan Validation](#26-pattern-matching-dan-validation)
27. [Pattern Matching dan Collections](#27-pattern-matching-dan-collections)
28. [Anti-Patterns](#28-anti-patterns)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

Pattern matching adalah salah satu arah besar evolusi Java modern.

Sebelum pattern matching, kita sering menulis:

```java
if (obj instanceof String) {
    String s = (String) obj;
    System.out.println(s.length());
}
```

Ada duplikasi:

```text
check type
cast type
bind variable
use variable
```

Pattern matching menggabungkan check + binding:

```java
if (obj instanceof String s) {
    System.out.println(s.length());
}
```

Lebih penting lagi, pattern matching menjadi sangat kuat saat digabung dengan:

- records;
- sealed types;
- switch expressions;
- result modeling;
- state modeling;
- domain error modeling.

Contoh modern:

```java
return switch (result) {
    case CaseClosed(CaseId id, Instant closedAt) ->
        ok("Closed " + id.value());

    case CloseRejected(CaseId id, RejectionReason reason) ->
        unprocessable(reason.value());

    case CaseNotFound(CaseId id) ->
        notFound(id.value());
};
```

Tujuan bagian ini:

- memahami pattern sebagai test + binding + type refinement;
- memahami `instanceof` pattern;
- memahami flow scoping;
- memahami pattern `switch`;
- memahami guarded patterns;
- memahami exhaustiveness;
- memahami record patterns;
- memahami sealed synergy;
- memahami kapan pattern matching membuat domain code lebih aman;
- memahami anti-pattern pattern matching yang berlebihan.

---

# 2. Masalah Sebelum Pattern Matching

## 2.1 Cast manual berulang

Sebelum:

```java
Object value = read();

if (value instanceof String) {
    String s = (String) value;
    return s.length();
}
```

Masalah:

- boilerplate;
- cast bisa salah;
- variable duplikatif;
- logic noisy;
- refactoring rawan.

## 2.2 Cast salah

```java
if (value instanceof String) {
    Integer i = (Integer) value; // compile ok? no, obvious incompatible in direct example
}
```

Dalam code kompleks, cast salah bisa terjadi saat type check dan cast tidak sejajar.

Pattern matching mengikat variable dengan type yang sudah dicek.

## 2.3 Visitor boilerplate

Closed hierarchy sering butuh visitor pattern.

```java
interface Shape {
    <R> R accept(Visitor<R> visitor);
}
```

Dengan sealed + switch:

```java
return switch (shape) {
    case Circle c -> ...
    case Rectangle r -> ...
};
```

lebih langsung.

## 2.4 `if-else instanceof` chains

```java
if (result instanceof Success) {
    ...
} else if (result instanceof Failure) {
    ...
} else if (result instanceof Pending) {
    ...
}
```

Pattern switch lebih ekspresif dan bisa exhaustive.

## 2.5 Null handling scattered

Pattern switch bisa menyatakan null handling eksplisit:

```java
case null -> ...
```

jika domain/boundary membutuhkan.

---

# 3. Mental Model: Pattern = Test + Binding + Refinement

Pattern matching melakukan tiga hal:

```text
1. test apakah value cocok dengan pattern
2. bind variable jika cocok
3. refine type variable dalam scope yang aman
```

Contoh:

```java
if (obj instanceof String s) {
    // obj cocok dengan type pattern String
    // s terikat sebagai String
    // s hanya valid di scope ini
}
```

## 3.1 Pattern bukan hanya syntax sugar

Pattern matching mengubah cara menulis domain branching:

```java
switch (result) {
    case Success s -> ...
    case Rejected r -> ...
}
```

Compiler bisa membantu:

- type safety;
- scope safety;
- exhaustiveness;
- dominance checking.

## 3.2 Pattern variable

`String s` dalam:

```java
obj instanceof String s
```

adalah pattern variable.

## 3.3 Type refinement

Di scope true branch, compiler tahu `s` adalah `String`.

Tidak perlu cast.

## 3.4 Pattern failure

Jika pattern tidak match, variable tidak tersedia.

```java
if (obj instanceof String s) {
    use(s);
}
// s not in scope here
```

---

# 4. Type Pattern dengan `instanceof`

## 4.1 Basic

```java
if (obj instanceof String s) {
    System.out.println(s.length());
}
```

Equivalent intent:

```java
if (obj instanceof String) {
    String s = (String) obj;
    ...
}
```

but safer and shorter.

## 4.2 Works with final classes, interfaces, records

```java
if (result instanceof CloseRejected rejected) {
    return rejected.reason();
}
```

## 4.3 Pattern variable is effectively local variable

```java
if (obj instanceof String s) {
    String upper = s.toUpperCase(Locale.ROOT);
}
```

## 4.4 Avoid redundant pattern

If static type already subtype, pattern may be unnecessary or illegal in some cases depending language rules.

Example:

```java
String text = "x";
if (text instanceof String s) { ... } // pointless
```

## 4.5 Interface pattern

```java
if (command instanceof Auditable auditable) {
    audit(auditable.auditData());
}
```

Useful but be careful not to overuse marker interfaces.

---

# 5. Flow Scoping

Flow scoping means pattern variable is in scope where compiler can prove pattern matched.

## 5.1 Simple true branch

```java
if (obj instanceof String s) {
    System.out.println(s.length());
}
```

`s` in scope only inside block.

## 5.2 `&&`

```java
if (obj instanceof String s && s.length() > 10) {
    System.out.println(s);
}
```

`s` is in scope after `&&` right side because if right side evaluated, pattern matched.

## 5.3 `||`

```java
if (obj instanceof String s || s.length() > 10) { // invalid
}
```

If left side false, `s` not bound, so right side cannot use it.

## 5.4 Negation with early return

```java
if (!(obj instanceof String s)) {
    return;
}

System.out.println(s.length());
```

After early return, compiler knows beyond if that `obj instanceof String s` must have matched.

This is very useful for guard clauses.

## 5.5 Complex boolean expressions

Keep conditions readable. If pattern logic becomes too clever, split into steps.

---

# 6. Pattern Variable dan Scope

## 6.1 Scope limited by definite match

Pattern variable only exists where match definitely occurred.

```java
if (obj instanceof String s) {
    use(s);
} else {
    // s not available
}
```

## 6.2 Shadowing

Avoid reusing same variable name in confusing nested scopes.

```java
if (a instanceof String s) {
    ...
}
if (b instanceof String s) {
    ...
}
```

This can be okay because scopes separate, but readability matters.

## 6.3 Pattern variable final?

Pattern variables are not necessarily final, but treat them as effectively final for clarity.

Avoid reassigning:

```java
if (obj instanceof String s) {
    s = s.strip(); // possible? avoid style
}
```

Prefer:

```java
String stripped = s.strip();
```

## 6.4 Pattern variable vs original variable

Pattern variable has refined type. Original variable keeps original static type.

```java
Object obj = "hello";

if (obj instanceof String s) {
    s.length();       // ok
    // obj.length();  // not ok, obj static type Object
}
```

---

# 7. Negation, Early Return, dan Guard Clause

Pattern matching works very well with guard clauses.

## 7.1 Before

```java
if (!(obj instanceof String)) {
    throw new IllegalArgumentException();
}

String s = (String) obj;
```

## 7.2 After

```java
if (!(obj instanceof String s)) {
    throw new IllegalArgumentException("Expected String");
}

return s.strip();
```

## 7.3 Domain command validation

```java
void handle(Command command) {
    if (!(command instanceof CloseCase closeCase)) {
        throw new IllegalArgumentException("Expected CloseCase");
    }

    close(closeCase.caseId(), closeCase.reason());
}
```

But if you have many variants, prefer switch.

## 7.4 Null behavior

`obj instanceof String s` is false if obj is null.

So:

```java
if (!(obj instanceof String s)) {
    return;
}
```

also handles null.

## 7.5 Avoid over-narrow APIs

If method expects `CloseCase`, parameter should be `CloseCase`, not `Command` plus pattern guard, unless method truly accepts all commands.

---

# 8. Pattern Matching dan Null

## 8.1 `instanceof`

```java
Object obj = null;

if (obj instanceof String s) {
    // not executed
}
```

`instanceof` with null returns false.

## 8.2 Pattern variable not bound

Since null doesn't match type pattern, variable unavailable.

## 8.3 switch and null

Classic switch over null throws NPE.

Pattern switch supports explicit null handling in modern Java:

```java
return switch (value) {
    case null -> "missing";
    case String s -> s;
    default -> value.toString();
};
```

## 8.4 Domain rule

In core domain, prefer non-null sealed values.

Use `case null` mostly at boundaries where null input is possible.

## 8.5 Null and default

Do not assume `default` catches null in all switch contexts. Handle null explicitly if possible.

---

# 9. Pattern Matching for `switch`

Pattern matching extends switch labels to patterns.

```java
String describe(Object value) {
    return switch (value) {
        case null -> "null";
        case String s -> "String length=" + s.length();
        case Integer i -> "Integer value=" + i;
        case List<?> list -> "List size=" + list.size();
        default -> "Other";
    };
}
```

## 9.1 Switch selector types

Modern switch supports many selector types. Pattern switch allows testing selector against patterns.

## 9.2 Benefits

- less `if-else`;
- type-safe binding;
- localized branching;
- exhaustiveness checking;
- dominance checking;
- cleaner sealed handling.

## 9.3 When use switch

Use when branching by variant/type is central and finite.

## 9.4 When avoid switch

Avoid giant switch scattered everywhere.

If each branch has complex behavior, consider moving behavior into polymorphic methods, policy classes, or handlers.

---

# 10. Switch Expression vs Switch Statement

## 10.1 Switch expression

Returns value.

```java
String label = switch (status) {
    case DRAFT -> "Draft";
    case CLOSED -> "Closed";
};
```

Must be exhaustive.

## 10.2 Switch statement

Performs actions.

```java
switch (command) {
    case SubmitCase c -> submit(c);
    case CloseCase c -> close(c);
}
```

## 10.3 Prefer expression for mapping

Use switch expression when computing value:

```java
HttpStatus status = switch (result) {
    case Success s -> HttpStatus.OK;
    case NotFound n -> HttpStatus.NOT_FOUND;
    case Rejected r -> HttpStatus.UNPROCESSABLE_ENTITY;
};
```

## 10.4 Use statement for side effects

Dispatching commands:

```java
switch (command) {
    case SubmitCase c -> submit(c);
    case CloseCase c -> close(c);
}
```

## 10.5 `yield`

For block arm in switch expression:

```java
String label = switch (value) {
    case String s -> {
        String stripped = s.strip();
        yield stripped.isEmpty() ? "blank" : stripped;
    }
    default -> "other";
};
```

---

# 11. Dominance dan Ordering of Case Labels

Pattern switch checks dominance.

A broader pattern before narrower pattern can make narrower unreachable.

## 11.1 Bad ordering

```java
return switch (value) {
    case Object o -> "object";
    case String s -> "string"; // dominated/unreachable
};
```

Since every non-null String is Object, `Object o` catches it first.

## 11.2 Correct ordering

```java
return switch (value) {
    case String s -> "string";
    case Object o -> "object";
};
```

## 11.3 Guards affect dominance

```java
case String s when s.length() > 10 -> ...
case String s -> ...
```

Specific guarded case first, general case after.

## 11.4 Null ordering

`case null` handles null explicitly.

```java
case null -> ...
case String s -> ...
default -> ...
```

## 11.5 Readability rule

Order cases:

```text
null
most specific patterns
guarded specific patterns
general patterns
default
```

where applicable.

---

# 12. Guarded Patterns dengan `when`

Pattern case can have guard condition.

```java
return switch (value) {
    case String s when s.isBlank() -> "blank string";
    case String s -> "string: " + s;
    case Integer i when i > 0 -> "positive int";
    case Integer i -> "int";
    default -> "other";
};
```

## 12.1 Guard runs after pattern match

`when s.isBlank()` only evaluated after value matched `String s`.

## 12.2 Use guard for refinement

Good:

```java
case NotEligible n when n.violations().size() > 10 -> ...
```

## 12.3 Avoid heavy side effects in guard

Guard should be pure/cheap.

Bad:

```java
case Command c when repository.exists(c.id()) -> ...
```

This mixes matching with IO.

## 12.4 Guard vs constructor invariant

Do not use guard to compensate invalid variant.

If `NotEligible` should always have non-empty violations, enforce in constructor.

## 12.5 Guard ordering

More specific guarded cases before general cases.

---

# 13. `case null`

Pattern switch can handle null explicitly.

```java
String describe(Object value) {
    return switch (value) {
        case null -> "missing";
        case String s -> s;
        default -> value.toString();
    };
}
```

## 13.1 Boundary use

Good for:

- deserialization input;
- legacy API;
- reflection values;
- database nullable mapping;
- external integration.

## 13.2 Domain use

In core domain, prefer not to allow null.

```java
Objects.requireNonNull(result)
```

before switch if null means programmer error.

## 13.3 `case null, default`

Some switch syntax allows combining null/default in certain contexts:

```java
case null, default -> ...
```

Use carefully; explicit separate handling is clearer when null semantics important.

## 13.4 Null should have meaning

Do not silently map null to arbitrary default without domain reason.

---

# 14. Exhaustiveness

Exhaustiveness means every possible selector value is handled.

## 14.1 Enum switch

```java
return switch (status) {
    case DRAFT -> ...
    case CLOSED -> ...
};
```

If all enum constants handled, exhaustive.

## 14.2 Sealed switch

```java
return switch (result) {
    case Success s -> ...
    case Rejected r -> ...
    case NotFound n -> ...
};
```

If all permitted subtypes handled, exhaustive.

## 14.3 Default hides future changes

```java
default -> ...
```

makes switch exhaustive but hides added variants.

In core logic, avoid default for sealed hierarchies if you want compile-time reminder.

## 14.4 Exhaustiveness and non-sealed

If sealed hierarchy has `non-sealed` branch, compiler cannot know all concrete subtypes beyond that branch.

You may need case for non-sealed supertype or default.

## 14.5 Exhaustiveness as design tool

Use it to force updates when domain alternatives evolve.

---

# 15. Sealed Types + Pattern Switch

This is one of the strongest combinations in modern Java.

```java
sealed interface PaymentResult permits Captured, Rejected, Failed {}

record Captured(PaymentId id, Instant capturedAt) implements PaymentResult {}
record Rejected(RejectReason reason) implements PaymentResult {}
record Failed(ErrorId errorId, boolean retryable) implements PaymentResult {}
```

Handle:

```java
HttpResponse toResponse(PaymentResult result) {
    return switch (result) {
        case Captured c -> ok(c.id());
        case Rejected r -> unprocessable(r.reason());
        case Failed f when f.retryable() -> serviceUnavailable(f.errorId());
        case Failed f -> internalServerError(f.errorId());
    };
}
```

## 15.1 Compiler knows variants

Because `PaymentResult` is sealed, compiler can verify all direct permitted subtypes are covered.

## 15.2 Adding new variant

```java
record DuplicatePayment(IdempotencyKey key) implements PaymentResult {}
```

Switch without default will fail to compile until updated.

Good.

## 15.3 Better than `instanceof` chain

Switch groups all cases clearly.

## 15.4 Better than visitor for many cases

Less boilerplate.

## 15.5 Still design carefully

If every service has massive switch over same hierarchy, consider moving common behavior closer to variants or policy classes.

---

# 16. Record Patterns

Record patterns deconstruct records.

```java
record Point(int x, int y) {}
```

Instead of:

```java
if (obj instanceof Point p) {
    int x = p.x();
    int y = p.y();
}
```

Use:

```java
if (obj instanceof Point(int x, int y)) {
    System.out.println(x + ", " + y);
}
```

JEP 440 finalized record patterns in Java 21 and describes them as a way to deconstruct record values; record patterns and type patterns can be nested for declarative data navigation.

## 16.1 Switch with record pattern

```java
return switch (shape) {
    case Circle(double radius) -> Math.PI * radius * radius;
    case Rectangle(double width, double height) -> width * height;
};
```

assuming records:

```java
record Circle(double radius) implements Shape {}
record Rectangle(double width, double height) implements Shape {}
```

## 16.2 Components bound by position

Record pattern follows record component order.

```java
record Money(BigDecimal amount, Currency currency) {}
```

Pattern:

```java
case Money(BigDecimal amount, Currency currency) -> ...
```

## 16.3 Type inference

Can use `var` in record patterns.

```java
case Money(var amount, var currency) -> ...
```

## 16.4 Record transparency

Record patterns reinforce that records are transparent data carriers.

If deconstruction feels wrong, record may be wrong type.

---

# 17. Nested Record Patterns

Record patterns can nest.

```java
record Point(int x, int y) {}
record Rectangle(Point topLeft, Point bottomRight) {}
```

Pattern:

```java
if (obj instanceof Rectangle(Point(int x1, int y1), Point(int x2, int y2))) {
    ...
}
```

## 17.1 Domain example

```java
record Money(BigDecimal amount, Currency currency) {}
record InvoiceLine(ProductId productId, Money price) {}
```

Switch:

```java
return switch (line) {
    case InvoiceLine(var productId, Money(var amount, var currency))
        when currency.equals(Currency.getInstance("SGD")) -> amount;
    default -> BigDecimal.ZERO;
};
```

## 17.2 Avoid over-nesting

Deep pattern:

```java
case A(B(C(D(...)))) -> ...
```

can become unreadable.

Extract intermediate methods if too complex.

## 17.3 Use for structural clarity

Nested patterns are great when shape is central and shallow.

## 17.4 Guard with nested values

Use `when` to express additional condition.

---

# 18. `var` dalam Record Patterns

`var` lets compiler infer component types.

```java
if (obj instanceof Point(var x, var y)) {
    ...
}
```

## 18.1 Pros

- less repetition;
- robust to type rename;
- readable for obvious records.

## 18.2 Cons

- hides type if not obvious;
- can reduce readability in complex patterns.

## 18.3 Style

Use explicit types when it aids understanding:

```java
case Money(BigDecimal amount, Currency currency) -> ...
```

Use var when type obvious:

```java
case Point(var x, var y) -> ...
```

## 18.4 Consistency

Team style should define when to use `var` in patterns.

---

# 19. Unnamed Patterns dan Unnamed Variables

Java has introduced unnamed variables/patterns in recent versions.

They allow ignoring values intentionally.

Example concept:

```java
case CaseClosed(var caseId, _) -> ...
```

or unnamed variable in code:

```java
try (var _ = lock.acquire()) {
    ...
}
```

Exact syntax/support depends Java version and feature status. In Java 22, unnamed variables and patterns were finalized by JEP 456.

## 19.1 Why useful?

Avoid fake variable names:

```java
case CaseClosed(var ignoredCaseId, var closedAt) -> ...
```

Better communicate intentionally unused value.

## 19.2 Avoid overuse

If many fields ignored, maybe pattern too detailed.

Use type pattern:

```java
case CaseClosed closed -> ...
```

if you don't need components.

## 19.3 Version awareness

Check project Java version. If using Java 21, unnamed patterns may not be available as final feature.

---

# 20. Primitive Types in Patterns: Preview Note

Java pattern matching historically focused on reference types.

Java 25 includes preview work under JEP 507: Primitive Types in Patterns, `instanceof`, and `switch`, which enhances pattern matching by allowing primitive types in pattern contexts and extending `instanceof`/`switch` behavior around primitive types.

## 20.1 Preview feature warning

Preview features require:

```text
--enable-preview
```

and are not final language features.

Do not use in production baseline unless your organization accepts preview features.

## 20.2 Stable core

For production Java 21/25 without preview, focus on:

- type patterns;
- record patterns;
- pattern switch;
- sealed exhaustiveness.

## 20.3 Why mention?

Because if learning “hingga Java 25”, you should know the direction, but separate stable vs preview.

## 20.4 Practical recommendation

Use stable pattern matching features for production code.

Experiment with primitive patterns in learning/sandbox only unless approved.

---

# 21. Type Refinement vs Casting Manual

## 21.1 Manual cast

```java
if (obj instanceof CloseRejected) {
    CloseRejected rejected = (CloseRejected) obj;
    ...
}
```

## 21.2 Type pattern

```java
if (obj instanceof CloseRejected rejected) {
    ...
}
```

## 21.3 Fewer mismatch bugs

The type check and binding are one construct.

## 21.4 Better refactoring

If class renamed or hierarchy changes, compiler helps.

## 21.5 Still not excuse for weak API

If method needs `CloseRejected`, accept `CloseRejected`.

Do not accept `Object` then pattern-match unnecessarily.

---

# 22. Pattern Matching untuk Result Modeling

## 22.1 Sealed result

```java
sealed interface RegisterUserResult permits Registered, DuplicateEmail, InvalidRegistration {}

record Registered(UserId userId) implements RegisterUserResult {}
record DuplicateEmail(EmailAddress email) implements RegisterUserResult {}
record InvalidRegistration(List<Violation> violations) implements RegisterUserResult {}
```

## 22.2 Mapping to HTTP

```java
HttpResponse toResponse(RegisterUserResult result) {
    return switch (result) {
        case Registered r ->
            created(Map.of("userId", r.userId().value()));

        case DuplicateEmail d ->
            conflict("Email already exists: " + d.email().masked());

        case InvalidRegistration i ->
            badRequest(i.violations());
    };
}
```

## 22.3 Avoid boolean result

Bad:

```java
boolean registered
String errorCode
```

Potential invalid combinations.

## 22.4 Exhaustive compile-time handling

New result variant forces update.

---

# 23. Pattern Matching untuk State Modeling

## 23.1 Sealed state

```java
sealed interface CaseState permits Draft, Assigned, Closed {}

record Draft() implements CaseState {}
record Assigned(OfficerId officerId, Instant assignedAt) implements CaseState {}
record Closed(OfficerId closedBy, ClosureReason reason, Instant closedAt) implements CaseState {}
```

## 23.2 Derived status

```java
CaseStatus statusOf(CaseState state) {
    return switch (state) {
        case Draft d -> CaseStatus.DRAFT;
        case Assigned a -> CaseStatus.ASSIGNED;
        case Closed c -> CaseStatus.CLOSED;
    };
}
```

## 23.3 Transition logic

```java
CaseState close(CaseState state, OfficerId actor, ClosureReason reason, Clock clock) {
    return switch (state) {
        case Draft d ->
            throw new IllegalStateException("Draft cannot be closed");

        case Assigned a ->
            new Closed(actor, reason, clock.instant());

        case Closed c ->
            c;
    };
}
```

## 23.4 Record pattern for state data

```java
case Assigned(OfficerId officerId, Instant assignedAt) -> ...
```

Use when you need components directly.

---

# 24. Pattern Matching untuk Error Handling

## 24.1 Domain error

```java
sealed interface DomainError permits ValidationError, AuthorizationError, ConflictError {}

record ValidationError(List<Violation> violations) implements DomainError {}
record AuthorizationError(ActorId actorId, Permission permission) implements DomainError {}
record ConflictError(Version expected, Version actual) implements DomainError {}
```

## 24.2 Mapping

```java
ApiError toApiError(DomainError error) {
    return switch (error) {
        case ValidationError e -> ApiError.badRequest(e.violations());
        case AuthorizationError e -> ApiError.forbidden(e.permission());
        case ConflictError e -> ApiError.conflict(e.expected(), e.actual());
    };
}
```

## 24.3 Guarded

```java
case ValidationError e when e.violations().size() > 100 ->
    ApiError.badRequest("Too many violations");
```

## 24.4 Exceptions still exist

Do not force all failures into sealed errors.

Infrastructure failure can still be exception.

---

# 25. Pattern Matching untuk DTO/API Mapping

## 25.1 Domain sealed state to DTO

```java
CaseStateDto toDto(CaseState state) {
    return switch (state) {
        case Draft d ->
            new DraftDto("DRAFT");

        case Assigned a ->
            new AssignedDto("ASSIGNED", a.officerId().value(), a.assignedAt());

        case Closed c ->
            new ClosedDto("CLOSED", c.closedBy().value(), c.reason().code(), c.closedAt());
    };
}
```

## 25.2 Record pattern version

```java
CaseStateDto toDto(CaseState state) {
    return switch (state) {
        case Draft() ->
            new DraftDto("DRAFT");

        case Assigned(var officerId, var assignedAt) ->
            new AssignedDto("ASSIGNED", officerId.value(), assignedAt);

        case Closed(var closedBy, var reason, var closedAt) ->
            new ClosedDto("CLOSED", closedBy.value(), reason.code(), closedAt);
    };
}
```

## 25.3 Boundary validation

For inbound DTO, parse discriminator and construct correct domain variant.

Do not deserialize arbitrary Java subtype names.

## 25.4 Exhaustive mapper test

Switch exhaustiveness helps when new variant added.

---

# 26. Pattern Matching dan Validation

Pattern matching helps route validation by shape/type.

## 26.1 Command validation

```java
List<Violation> validate(Command command) {
    return switch (command) {
        case SubmitCase c -> validateSubmit(c);
        case CloseCase c -> validateClose(c);
        case AssignCase c -> validateAssign(c);
    };
}
```

## 26.2 Guarded validation

```java
return switch (request) {
    case CreateUserRequest r when r.email() == null ->
        List.of(new Violation("email", "required"));

    case CreateUserRequest r when r.email().isBlank() ->
        List.of(new Violation("email", "blank"));

    case CreateUserRequest r ->
        List.of();
};
```

But for ordinary validation, explicit validation code may be clearer.

## 26.3 Constructor validation still primary

Don't rely only on switch guards to maintain invariants. Value object constructors should validate.

## 26.4 Pattern matching for dynamic input

Useful when input can be different DTO variants.

---

# 27. Pattern Matching dan Collections

Pattern matching with generic types has limitations due type erasure.

## 27.1 Cannot match parameterized generic exactly

You cannot reliably test:

```java
if (obj instanceof List<String> strings) { ... } // not allowed
```

Because generic type erased.

You can match:

```java
if (obj instanceof List<?> list) { ... }
```

## 27.2 Element validation

```java
if (obj instanceof List<?> list &&
    list.stream().allMatch(String.class::isInstance)) {
    List<String> strings = list.stream()
        .map(String.class::cast)
        .toList();
}
```

## 27.3 Pattern switch with List

```java
case List<?> list -> ...
```

But not `List<String>`.

## 27.4 Avoid Object-typed collection input

Prefer typed APIs:

```java
void process(List<String> values)
```

not:

```java
void process(Object values)
```

unless boundary/framework.

---

# 28. Anti-Patterns

## 28.1 Pattern matching over `Object` everywhere

Bad:

```java
void process(Object o) {
    switch (o) {
        case String s -> ...
        case Integer i -> ...
        case User u -> ...
        default -> ...
    }
}
```

If domain knows type, use typed method parameters.

## 28.2 Giant switch in many places

If same sealed hierarchy is switched in 20 places, maybe behavior belongs in variant/service.

## 28.3 Default hiding missing variants

In core domain sealed switch, avoid default unless intentional.

## 28.4 Complex guards with side effects

Bad:

```java
case Command c when repository.exists(c.id()) -> ...
```

Guard should not do IO.

## 28.5 Over-nested record patterns

Too clever patterns reduce readability.

## 28.6 Pattern matching instead of polymorphism

Sometimes:

```java
shape.area()
```

is better than:

```java
switch (shape) { ... }
```

Especially if operation naturally belongs to type.

## 28.7 Pattern matching invalid domain states

If you need many guards to check null fields in variants, your type model is weak. Fix type/invariants.

---

# 29. Production Failure Modes

## 29.1 New sealed variant not handled because default exists

Switch default returns generic failure; new business case silently wrong.

Fix:

- remove default in core;
- exhaustive switch;
- tests.

## 29.2 Null selector crashes

Switch over null input from API.

Fix:

- validate non-null;
- `case null` at boundary.

## 29.3 Dominance compile error

General case before specific.

Fix:

- order specific before general.

## 29.4 Guard side effect causes latency/bugs

Guard calls DB/service.

Fix:

- compute outside;
- keep guards pure.

## 29.5 Pattern matching generic list incorrectly

Assume `List<?>` is `List<String>`.

Fix:

- validate elements;
- use typed APIs.

## 29.6 Overusing switch instead of domain behavior

Business rules scattered.

Fix:

- centralize mapping;
- polymorphic method;
- policy service;
- handler map.

## 29.7 Record pattern tied to component order

Record component order changed; deconstruction code affected.

Fix:

- treat record header as contract;
- avoid changing public record component order.

## 29.8 Preview primitive patterns used in production accidentally

Build requires `--enable-preview` or breaks on version upgrade.

Fix:

- avoid preview in production baseline;
- CI checks.

---

# 30. Best Practices

## 30.1 General

- Use `instanceof` type patterns instead of manual cast.
- Use pattern switch for sealed hierarchy handling.
- Prefer switch expressions for mapping.
- Avoid default in core sealed switches to get exhaustiveness help.
- Use `case null` only when null is meaningful at boundary.
- Put specific cases before general cases.
- Keep guards pure and cheap.
- Use record patterns when deconstruction improves clarity.
- Avoid over-nested record patterns.
- Respect generic erasure limitations.
- Use typed APIs instead of Object + pattern matching where possible.
- Separate stable features from preview features.
- Treat record component order as deconstruction contract.

## 30.2 Domain

- Model result/state/error with sealed + records.
- Use pattern switch for boundary mapping.
- Keep domain variants valid by constructor.
- Do not use pattern guards to patch weak invariants.
- Add tests to ensure all variants mapped.

## 30.3 Style

- Prefer meaningful pattern variable names:

```java
case CloseRejected rejected -> ...
```

- Use `var` in record patterns when type obvious.
- Use explicit component types when readability benefits.
- Avoid reassigning pattern variables.

---

# 31. Decision Matrix

| Situation | Use pattern matching? | Notes |
|---|---:|---|
| Replace `instanceof` + cast | yes | type pattern |
| Handle sealed result | yes | exhaustive switch |
| Handle enum only | switch ok | no type pattern needed |
| Deconstruct record components | yes if clearer | record pattern |
| Very deep nested data | maybe | avoid unreadable patterns |
| Generic `List<String>` runtime check | limited | use `List<?>` + element validation |
| Dynamic Object boundary | yes | with validation |
| Core method knows concrete type | no | use typed parameter |
| Null boundary input | `case null` maybe | explicit policy |
| Business operation belongs to object | maybe no | polymorphism may be better |
| Preview primitive patterns | learning only | avoid production unless approved |
| Public DTO mapping | yes | exhaustive mapper |

---

# 32. Latihan

## Latihan 1 — Replace Manual Cast

Refactor:

```java
if (obj instanceof String) {
    String s = (String) obj;
    return s.length();
}
```

to pattern matching.

## Latihan 2 — Flow Scoping

Explain why this works:

```java
if (obj instanceof String s && s.length() > 5) {}
```

and this doesn't:

```java
if (obj instanceof String s || s.length() > 5) {}
```

## Latihan 3 — Guard Clause

Write:

```java
if (!(command instanceof CloseCase c)) {
    return;
}
```

Use `c` after guard.

## Latihan 4 — Pattern Switch

Create sealed `PaymentResult` with `Captured`, `Rejected`, `Failed`. Map to HTTP response.

## Latihan 5 — Exhaustiveness

Add new variant `DuplicatePayment`. Observe switch compile error if no default.

## Latihan 6 — Guarded Pattern

For `Failed(errorId, retryable)`, return 503 if retryable, 500 otherwise.

## Latihan 7 — Record Pattern

Create:

```java
record Point(int x, int y) {}
```

Use `instanceof Point(int x, int y)`.

## Latihan 8 — Nested Record Pattern

Create:

```java
record Rectangle(Point topLeft, Point bottomRight) {}
```

Deconstruct nested points.

## Latihan 9 — Generic Erasure

Try matching `List<String>`. Explain why impossible. Implement safe validation for `List<?>`.

## Latihan 10 — DTO Mapper

Map sealed `CaseState` to DTO using pattern switch and record patterns.

## Latihan 11 — Null Boundary

Write pattern switch over Object that handles `case null`.

## Latihan 12 — Anti-pattern Refactor

Find giant pattern switch and refactor either to behavior method or handler map.

---

# 33. Ringkasan

Pattern matching in Java modern is about:

```text
test + binding + type refinement
```

Core features:

- `instanceof` type pattern;
- flow scoping;
- pattern switch;
- guarded patterns with `when`;
- `case null`;
- exhaustiveness;
- sealed hierarchy awareness;
- record patterns;
- nested deconstruction;
- unnamed patterns/variables in newer Java;
- primitive patterns as preview in Java 25.

Pattern matching makes Java code:

- less cast-heavy;
- more type-safe;
- more exhaustive;
- more readable for closed domain alternatives;
- more expressive with records/sealed types.

But it is not a replacement for good API design.

If method knows the type, use that type. If domain has alternatives, model them with sealed types. If each alternative has data, use records. If you need to branch by alternatives, use exhaustive pattern switch.

Senior Java engineer uses pattern matching not as syntax sugar, but as a compiler-assisted way to encode domain reasoning.

---

# 34. Referensi

1. Oracle Java SE 25 Language Guide — Pattern Matching with switch  
   https://docs.oracle.com/en/java/javase/25/language/pattern-matching-switch.html

2. JEP 441 — Pattern Matching for switch  
   https://openjdk.org/jeps/441

3. JEP 440 — Record Patterns  
   https://openjdk.org/jeps/440

4. JEP 409 — Sealed Classes  
   https://openjdk.org/jeps/409

5. JEP 456 — Unnamed Variables and Patterns  
   https://openjdk.org/jeps/456

6. JEP 507 — Primitive Types in Patterns, instanceof, and switch  
   https://openjdk.org/jeps/507

7. Java Language Specification SE 25 — Switch Statements and Expressions  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.11

8. Java Language Specification SE 25 Preview Spec — Primitive Types in Patterns, instanceof, and switch  
   https://docs.oracle.com/javase/specs/jls/se25/preview/specs/primitive-types-in-patterns-instanceof-switch-jls.html
