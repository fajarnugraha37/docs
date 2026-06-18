# learn-java-data-types-part-004.md

# Java Data Types — Part 004  
# `boolean`, Flag, State, dan Decision Modeling

> Seri: **Advanced Java Data Types**  
> Bagian: **004**  
> Fokus: memahami `boolean` sebagai primitive type, operator dan semantics-nya, lalu naik ke level production: boolean blindness, flag explosion, impossible states, state modeling, decision result, auditability, feature flags, authorization/eligibility policy, dan kapan boolean masih tepat.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [`boolean` dalam Java Type System](#2-boolean-dalam-java-type-system)
3. [Mental Model: Boolean sebagai Truth Value](#3-mental-model-boolean-sebagai-truth-value)
4. [Boolean Operators: `!`, `&&`, `||`, `&`, `|`, `^`](#4-boolean-operators-----)
5. [Short-Circuit Semantics dan Side Effect](#5-short-circuit-semantics-dan-side-effect)
6. [Boolean bukan Integer](#6-boolean-bukan-integer)
7. [Default Value dan Nullable Boolean](#7-default-value-dan-nullable-boolean)
8. [Boolean Naming: `is`, `has`, `can`, `should`, `must`](#8-boolean-naming-is-has-can-should-must)
9. [Boolean Blindness](#9-boolean-blindness)
10. [Boolean Parameter Anti-Pattern](#10-boolean-parameter-anti-pattern)
11. [Flag Explosion](#11-flag-explosion)
12. [Impossible State dari Banyak Boolean](#12-impossible-state-dari-banyak-boolean)
13. [State Modeling: Boolean vs Enum vs Sealed Type](#13-state-modeling-boolean-vs-enum-vs-sealed-type)
14. [Decision Modeling: Boolean vs Result Object](#14-decision-modeling-boolean-vs-result-object)
15. [Eligibility, Authorization, Validation, dan Policy Decision](#15-eligibility-authorization-validation-dan-policy-decision)
16. [Auditability: Kenapa `false` Tidak Cukup](#16-auditability-kenapa-false-tidak-cukup)
17. [Tri-State: `true`, `false`, `unknown`](#17-tri-state-true-false-unknown)
18. [Feature Flag vs Domain Flag](#18-feature-flag-vs-domain-flag)
19. [Soft Delete, Active Flag, dan Lifecycle Modeling](#19-soft-delete-active-flag-dan-lifecycle-modeling)
20. [Boolean di Database, JSON, dan API Contract](#20-boolean-di-database-json-dan-api-contract)
21. [Boolean di Configuration](#21-boolean-di-configuration)
22. [Boolean dan Concurrency](#22-boolean-dan-concurrency)
23. [AtomicBoolean dan Volatile Boolean](#23-atomicboolean-dan-volatile-boolean)
24. [Boolean di Collections, Streams, dan Predicates](#24-boolean-di-collections-streams-dan-predicates)
25. [Testing Boolean Logic](#25-testing-boolean-logic)
26. [Refactoring Boolean-heavy Code](#26-refactoring-boolean-heavy-code)
27. [Production Failure Modes](#27-production-failure-modes)
28. [Best Practices](#28-best-practices)
29. [Decision Matrix](#29-decision-matrix)
30. [Latihan](#30-latihan)
31. [Ringkasan](#31-ringkasan)
32. [Referensi](#32-referensi)

---

# 1. Tujuan Bagian Ini

`boolean` terlihat sangat sederhana:

```java
boolean active = true;
```

Tetapi di production system, boolean sering menjadi sumber desain buruk:

```java
boolean approved;
boolean rejected;
boolean closed;
boolean deleted;
boolean active;
boolean urgent;
boolean notifyUser;
boolean dryRun;
boolean skipValidation;
```

Masalahnya bukan `boolean` sebagai primitive. Masalahnya adalah **boolean sering dipakai untuk merepresentasikan konsep domain yang lebih kaya daripada true/false**.

Bagian ini akan menjawab:

- kapan `boolean` tepat;
- kapan `boolean` terlalu miskin;
- kenapa boolean parameter sering buruk;
- kenapa banyak boolean bisa menciptakan impossible state;
- bagaimana mengganti boolean dengan enum/sealed type;
- bagaimana mengganti boolean return dengan result object;
- bagaimana membuat decision yang audit-friendly;
- bagaimana modeling tri-state;
- bagaimana membedakan feature flag vs domain flag;
- bagaimana boolean berinteraksi dengan DB/API/config/concurrency.

---

# 2. `boolean` dalam Java Type System

Java memiliki primitive type `boolean` dengan dua literal:

```java
true
false
```

`boolean` bukan numeric type. Ia tidak bisa dikonversi ke `int`, dan `int` tidak bisa dikonversi ke `boolean`.

```java
boolean b = true;
int x = b;       // compile error

int y = 1;
boolean z = y;   // compile error
```

Ini keputusan desain yang penting. Java menghindari bug seperti:

```c
if (x = 1) { ... }
```

yang bisa terjadi di bahasa dengan integer truthiness.

## 2.1 Boolean expressions

Boolean expression muncul di:

```java
if (condition) {}
while (condition) {}
for (; condition; ) {}
do {} while (condition);
condition ? a : b
assert condition
```

Operator comparison menghasilkan boolean:

```java
x > 10
name.equals("Fajar")
items.isEmpty()
status == CaseStatus.CLOSED
```

## 2.2 Boolean array

```java
boolean[] flags = new boolean[10];
```

Default semua element adalah `false`.

Catatan: `boolean[]` tidak berarti bit-packed 1 bit per boolean. Jika butuh bit-level compactness, pertimbangkan `BitSet`.

---

# 3. Mental Model: Boolean sebagai Truth Value

Boolean idealnya merepresentasikan **proposition** yang bisa benar atau salah.

Contoh baik:

```java
isEmpty()
isBlank()
hasNext()
containsKey(key)
isFinite(value)
isAfter(deadline)
```

Ini predicate jelas.

## 3.1 Good boolean asks a clear yes/no question

Good:

```java
boolean isClosed()
boolean hasMandatoryEvidence()
boolean canRetry()
boolean isTerminal()
```

Buruk:

```java
boolean status()
boolean type()
boolean process()
```

Nama boolean harus menjawab pertanyaan ya/tidak.

## 3.2 Boolean hanya cukup jika tidak perlu explanation

Jika caller hanya butuh branch sederhana, boolean cukup.

```java
if (items.isEmpty()) {
    return;
}
```

Tetapi jika caller perlu tahu alasan, boolean tidak cukup.

Buruk:

```java
boolean canClose(CaseRecord c)
```

Jika false, mengapa?

- evidence kurang?
- status salah?
- officer tidak berwenang?
- deadline lewat?
- case sudah closed?
- policy version berbeda?

Lebih baik:

```java
CloseEligibility checkCloseEligibility(CaseRecord c)
```

dengan reason.

---

# 4. Boolean Operators: `!`, `&&`, `||`, `&`, `|`, `^`

## 4.1 Logical NOT

```java
!active
```

## 4.2 Conditional AND

```java
a && b
```

Short-circuit: jika `a` false, `b` tidak dievaluasi.

## 4.3 Conditional OR

```java
a || b
```

Short-circuit: jika `a` true, `b` tidak dievaluasi.

## 4.4 Boolean AND non-short-circuit

```java
a & b
```

Jika operands boolean, keduanya dievaluasi.

## 4.5 Boolean OR non-short-circuit

```java
a | b
```

Jika operands boolean, keduanya dievaluasi.

## 4.6 XOR

```java
a ^ b
```

True jika tepat satu operand true.

Example:

```java
boolean exactlyOne = hasEmail ^ hasPhone;
```

Tetapi untuk readability, kadang lebih baik explicit method:

```java
boolean hasExactlyOneContactMethod = hasExactlyOne(email, phone);
```

## 4.7 Operator precedence

Jangan mengandalkan pembaca hafal precedence untuk logic kompleks.

Buruk:

```java
if (a && b || c && !d || e) {}
```

Lebih baik:

```java
boolean canAutoApprove =
    hasValidEvidence && isLowRisk;

boolean requiresManualReview =
    isHighRisk && !hasSupervisorApproval;

if (canAutoApprove || requiresManualReview || isEmergencyOverride) {
    ...
}
```

---

# 5. Short-Circuit Semantics dan Side Effect

## 5.1 Null guard

```java
if (name != null && !name.isBlank()) {
    ...
}
```

Aman karena `name.isBlank()` tidak dipanggil jika `name == null`.

Jika pakai `&`:

```java
if (name != null & !name.isBlank()) {
    ...
}
```

akan NPE.

## 5.2 Side effect in boolean expression

Buruk:

```java
if (isValid(input) && save(input)) {
    ...
}
```

`save` sebagai side effect di expression bisa membingungkan.

Lebih buruk:

```java
if (shouldRetry() || incrementRetryCount()) {
    ...
}
```

Karena short-circuit bisa membuat side effect tidak terjadi.

## 5.3 Recommendation

Boolean expression idealnya pure/predicate.

Jika ada side effect, pisahkan:

```java
boolean valid = validator.isValid(input);
if (!valid) {
    return;
}

repository.save(input);
```

## 5.4 Expensive predicates

Short-circuit bisa dipakai untuk urutan murah → mahal:

```java
if (input != null &&
    input.length() <= MAX_LENGTH &&
    expensiveValidation(input)) {
    ...
}
```

Tetapi jangan mengorbankan clarity.

---

# 6. Boolean bukan Integer

Java tidak punya truthiness numeric.

```java
if (1) {}      // compile error
if (0) {}      // compile error
```

Ini memaksa intent eksplisit:

```java
if (count > 0) {}
if (statusCode == 200) {}
```

## 6.1 Boolean as bit

Jika kamu butuh bit-level representation, jangan paksakan boolean sebagai number.

Gunakan:

- `BitSet`;
- bit mask dengan `int`/`long`;
- enum set;
- explicit permissions model.

Example permission bitmask:

```java
static final int READ = 1 << 0;
static final int WRITE = 1 << 1;
static final int DELETE = 1 << 2;

boolean canWrite = (permissions & WRITE) != 0;
```

Tetapi untuk domain permission, `EnumSet<Permission>` sering lebih jelas:

```java
EnumSet<Permission> permissions = EnumSet.of(Permission.READ, Permission.WRITE);
```

## 6.2 Database boolean representation

Database tertentu menyimpan boolean sebagai:

- `BOOLEAN`;
- `BIT`;
- `TINYINT(1)`;
- `CHAR(1)` Y/N;
- numeric 0/1.

Java domain tidak perlu mengikuti representasi DB secara langsung. Gunakan mapping/converter.

---

# 7. Default Value dan Nullable Boolean

## 7.1 Primitive boolean default

Field boolean default `false`.

```java
class Config {
    boolean enabled; // false by default
}
```

Array boolean default false:

```java
boolean[] flags = new boolean[10];
```

## 7.2 Default false can hide missing initialization

```java
class Approval {
    boolean approved;
}
```

Apakah `false` berarti:

- rejected?
- pending?
- not reviewed?
- default uninitialized?
- explicitly denied?

Ini ambiguous.

## 7.3 Wrapper Boolean

```java
Boolean approved;
```

Can represent:

```text
true
false
null
```

But now you have tri-state with unclear semantics.

```java
if (approved) { ... } // NPE if null
```

Safer:

```java
if (Boolean.TRUE.equals(approved)) {
    ...
}
```

But better domain modeling:

```java
enum ApprovalStatus {
    PENDING,
    APPROVED,
    REJECTED
}
```

or sealed:

```java
sealed interface ApprovalDecision permits PendingApproval, Approved, Rejected {}

record PendingApproval() implements ApprovalDecision {}
record Approved(OfficerId by, Instant at) implements ApprovalDecision {}
record Rejected(OfficerId by, RejectionReason reason, Instant at) implements ApprovalDecision {}
```

## 7.4 Primitive boolean in config

Config default false can be dangerous.

Example:

```yaml
security:
  enabled: false
```

If missing config maps to false, security could be disabled accidentally.

For critical config, use wrapper then validate presence:

```java
Boolean securityEnabled;
```

At startup:

```java
if (securityEnabled == null) {
    throw new IllegalStateException("security.enabled must be explicitly configured");
}
```

Or use config schema/default policy.

---

# 8. Boolean Naming: `is`, `has`, `can`, `should`, `must`

Boolean naming carries semantics.

## 8.1 `is`

State/property:

```java
isClosed()
isEmpty()
isValid()
isDeleted()
```

## 8.2 `has`

Possession/existence:

```java
hasEvidence()
hasPermission()
hasNext()
hasAssignedOfficer()
```

## 8.3 `can`

Capability/allowed action:

```java
canClose()
canRetry()
canEscalate()
```

But `can` often needs reason. If decision important, return decision object.

## 8.4 `should`

Recommendation/policy:

```java
shouldRetry()
shouldNotifyUser()
shouldEscalate()
```

`should` means policy judgement, not hard permission.

## 8.5 `must`

Requirement:

```java
mustChangePassword()
mustReviewManually()
```

Usually policy-driven.

## 8.6 Avoid negative names

Bad:

```java
boolean isNotActive;
boolean disableValidation;
boolean skipAudit;
```

Double negatives become confusing:

```java
if (!disableValidation) { ... }
```

Prefer positive:

```java
validationEnabled
auditRequired
active
```

## 8.7 Naming return boolean

Bad:

```java
boolean process()
boolean check()
boolean handle()
```

Good:

```java
boolean isEligible()
boolean hasExpired()
boolean canRetry()
```

---

# 9. Boolean Blindness

Boolean blindness adalah ketika `true`/`false` tidak menjelaskan makna.

## 9.1 Parameter example

```java
sendEmail(user, true);
```

Apa arti `true`?

- urgent?
- include attachments?
- async?
- HTML?
- retry?
- dry run?

Lebih baik:

```java
sendEmail(user, EmailPriority.URGENT);
```

atau command object:

```java
record SendEmailCommand(
    UserId userId,
    EmailPriority priority,
    DeliveryMode deliveryMode,
    boolean includeAttachment
) {}
```

Jika boolean tetap dipakai dalam command object dengan nama jelas, masih acceptable:

```java
new SendEmailCommand(userId, priority, deliveryMode, true)
```

Namun builder/factory lebih jelas:

```java
SendEmailCommand.urgent(userId)
```

## 9.2 Return example

```java
boolean result = service.update(caseId);
```

Apakah false berarti:

- not found?
- validation failed?
- unauthorized?
- no changes?
- conflict?
- downstream failed?

Use result type:

```java
sealed interface UpdateCaseResult permits Updated, NotFound, Rejected, Conflict {}

record Updated(CaseId caseId) implements UpdateCaseResult {}
record NotFound(CaseId caseId) implements UpdateCaseResult {}
record Rejected(String code, String reason) implements UpdateCaseResult {}
record Conflict(AggregateVersion currentVersion) implements UpdateCaseResult {}
```

## 9.3 Boolean in maps

Bad:

```java
Map<String, Boolean> flags;
```

Without schema, flags become magic strings.

Better:

```java
record FeatureFlags(
    boolean newApprovalFlowEnabled,
    boolean strictValidationEnabled
) {}
```

or typed enum map:

```java
EnumMap<FeatureFlag, Boolean>
```

---

# 10. Boolean Parameter Anti-Pattern

Boolean parameter often means method does two different things.

Bad:

```java
void save(CaseRecord record, boolean validate) {
    if (validate) {
        validator.validate(record);
    }
    repository.save(record);
}
```

Call site:

```java
save(record, false);
```

Reader must check method definition.

## 10.1 Replace with separate methods

```java
void saveValidated(CaseRecord record)
void saveWithoutValidation(CaseRecord record)
```

If `saveWithoutValidation` is dangerous, name makes danger visible.

## 10.2 Replace with enum

```java
enum ValidationMode {
    VALIDATE,
    SKIP_VALIDATION
}

void save(CaseRecord record, ValidationMode mode)
```

Call site:

```java
save(record, ValidationMode.SKIP_VALIDATION);
```

## 10.3 Replace with command/options object

```java
record SaveOptions(
    ValidationMode validationMode,
    AuditMode auditMode,
    NotificationMode notificationMode
) {}
```

## 10.4 Boolean acceptable for setter/config?

Even there, prefer clarity.

```java
setEnabled(true)
```

is okay.

But:

```java
process(true, false, true)
```

is bad.

## 10.5 Multiple boolean parameters

Very bad:

```java
createUser(name, true, false, true);
```

Refactor immediately.

---

# 11. Flag Explosion

Flag explosion happens when each new requirement adds another boolean.

```java
class CaseRecord {
    boolean submitted;
    boolean assigned;
    boolean escalated;
    boolean resolved;
    boolean closed;
    boolean rejected;
    boolean deleted;
    boolean archived;
}
```

Now combinations explode:

```text
2^8 = 256 possible combinations
```

But domain may allow only 8 real states.

## 11.1 Symptoms

- many `if` conditions;
- contradictory flags;
- unclear lifecycle;
- hard-to-test combinations;
- bug fixes add more flags;
- database rows with inconsistent states;
- audit cannot explain state.

## 11.2 Replace with enum

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    ASSIGNED,
    ESCALATED,
    RESOLVED,
    CLOSED,
    REJECTED,
    ARCHIVED
}
```

This reduces many combinations into one state.

## 11.3 But enum may not be enough

If each state has different data:

```text
Closed has closedAt, closedBy, reason
Rejected has rejectedAt, rejectedBy, reason
Assigned has officer, assignedAt
```

Use sealed state:

```java
sealed interface CaseState permits Draft, Assigned, Closed, Rejected {}

record Draft() implements CaseState {}
record Assigned(OfficerId officerId, Instant assignedAt) implements CaseState {}
record Closed(OfficerId closedBy, ClosureReason reason, Instant closedAt) implements CaseState {}
record Rejected(OfficerId rejectedBy, RejectionReason reason, Instant rejectedAt) implements CaseState {}
```

## 11.4 Test state machine, not flag combinations

Instead of testing random booleans, test transition matrix.

```text
DRAFT -> SUBMITTED
SUBMITTED -> ASSIGNED
ASSIGNED -> CLOSED
ASSIGNED -> REJECTED
CLOSED -> terminal
REJECTED -> terminal
```

---

# 12. Impossible State dari Banyak Boolean

## 12.1 Approval example

```java
boolean approved;
boolean rejected;
```

Possible combinations:

| approved | rejected | Meaning |
|---:|---:|---|
| false | false | pending? |
| true | false | approved |
| false | true | rejected |
| true | true | impossible |

The type allows impossible state.

## 12.2 Use enum

```java
enum ApprovalStatus {
    PENDING,
    APPROVED,
    REJECTED
}
```

Now impossible combination disappears.

## 12.3 Use sealed type if data differs

```java
sealed interface Approval permits Pending, Approved, Rejected {}

record Pending() implements Approval {}
record Approved(OfficerId approvedBy, Instant approvedAt) implements Approval {}
record Rejected(OfficerId rejectedBy, RejectionReason reason, Instant rejectedAt) implements Approval {}
```

Now `Rejected` must have reason, while `Pending` does not.

## 12.4 General rule

If booleans represent mutually exclusive alternatives, use enum/sealed type.

If booleans represent independent capabilities, use `EnumSet` or separate predicates.

Example independent:

```java
EnumSet<Permission> permissions = EnumSet.of(READ, WRITE);
```

---

# 13. State Modeling: Boolean vs Enum vs Sealed Type

## 13.1 Boolean for simple property

```java
boolean emailVerified;
```

This can be okay if it really is binary and independent.

But even email verification may need timestamp:

```java
sealed interface EmailVerification permits Unverified, Verified {}

record Unverified() implements EmailVerification {}
record Verified(Instant verifiedAt) implements EmailVerification {}
```

## 13.2 Enum for closed state set

```java
enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    CLOSED
}
```

Good when states share same data shape.

## 13.3 Sealed type for state-specific data

```java
sealed interface CaseState permits Open, UnderReview, Closed {}

record Open(Instant openedAt) implements CaseState {}
record UnderReview(OfficerId officer, Instant assignedAt) implements CaseState {}
record Closed(OfficerId closedBy, ClosureReason reason, Instant closedAt) implements CaseState {}
```

Good when each state has different fields/invariants.

## 13.4 Decision criteria

| Situation | Recommended type |
|---|---|
| simple yes/no property | boolean |
| nullable/unknown yes/no | enum/sealed |
| mutually exclusive states | enum |
| states with different data | sealed type |
| independent capabilities | EnumSet |
| dynamic flags from config | typed feature flag model |
| decision needing reason | result object |

## 13.5 State transition behavior

State should not be set directly:

```java
caseRecord.status = CLOSED;
```

Use behavior:

```java
caseRecord.close(command, policy, clock);
```

This ensures:

- transition valid;
- reason required;
- audit event produced;
- version incremented.

---

# 14. Decision Modeling: Boolean vs Result Object

## 14.1 Boolean decision is often insufficient

```java
boolean canApprove(CaseRecord c)
```

If false, caller asks why.

## 14.2 Result object

```java
public sealed interface ApprovalEligibility
    permits EligibleForApproval, NotEligibleForApproval {}

public record EligibleForApproval() implements ApprovalEligibility {}

public record NotEligibleForApproval(
    List<ApprovalViolation> violations
) implements ApprovalEligibility {}
```

Violation:

```java
public record ApprovalViolation(
    String code,
    String message
) {}
```

## 14.3 Policy decision

```java
public record PolicyDecision(
    boolean allowed,
    String code,
    String explanation,
    PolicyVersion policyVersion
) {
    public static PolicyDecision allow(PolicyVersion version) {
        return new PolicyDecision(true, "ALLOWED", "Allowed", version);
    }

    public static PolicyDecision deny(String code, String explanation, PolicyVersion version) {
        return new PolicyDecision(false, code, explanation, version);
    }
}
```

This is much more audit-friendly.

## 14.4 Sealed decision without boolean

```java
sealed interface PolicyDecision permits Allowed, Denied {}

record Allowed(PolicyVersion policyVersion) implements PolicyDecision {}
record Denied(String code, String reason, PolicyVersion policyVersion) implements PolicyDecision {}
```

This avoids:

```java
allowed = true
reason = "Denied because..."
```

contradiction.

## 14.5 When boolean return is okay

Predicate methods:

```java
isEmpty()
hasNext()
contains()
isFinite()
```

where reason is not needed.

---

# 15. Eligibility, Authorization, Validation, dan Policy Decision

These look similar but have different semantics.

## 15.1 Eligibility

Eligibility asks:

```text
Does this subject meet business criteria?
```

Example:

```java
EligibilityResult checkEligibility(Application app)
```

May return business reasons.

## 15.2 Authorization

Authorization asks:

```text
Is actor allowed to perform action?
```

Example:

```java
AuthorizationDecision canEscalate(Actor actor, CaseRecord c)
```

Should avoid leaking sensitive reason to user but may log/audit internally.

## 15.3 Validation

Validation asks:

```text
Is input structurally and semantically valid?
```

Example:

```java
ValidationResult validate(CreateCaseRequest request)
```

Often collects multiple errors.

## 15.4 Policy

Policy asks:

```text
According to rule version X, is this action allowed/recommended?
```

Should include policy version for audit.

## 15.5 Don't use one boolean for all

Bad:

```java
boolean ok = service.check(...);
```

Better:

```java
EligibilityResult eligibility
AuthorizationDecision authorization
ValidationResult validation
PolicyDecision policy
```

Different decisions need different data.

---

# 16. Auditability: Kenapa `false` Tidak Cukup

Regulated systems need explanation.

```java
boolean approved = false;
```

Does not answer:

- who rejected?
- when?
- why?
- under what policy?
- based on what evidence?
- was it automatic or manual?
- previous state?
- correlation ID?
- command ID?

## 16.1 Audit-friendly decision

```java
public record CaseRejected(
    CaseId caseId,
    OfficerId rejectedBy,
    RejectionReason reason,
    PolicyVersion policyVersion,
    List<EvidenceReference> evidence,
    Instant occurredAt,
    CorrelationId correlationId
) {}
```

## 16.2 Boolean in audit log

Bad:

```json
{
  "approved": false
}
```

Good:

```json
{
  "action": "REJECT_CASE",
  "fromStatus": "UNDER_REVIEW",
  "toStatus": "REJECTED",
  "actorId": "OFFICER-123",
  "reasonCode": "INSUFFICIENT_EVIDENCE",
  "policyVersion": "ENF-2026.04",
  "occurredAt": "2026-06-12T10:15:30Z",
  "correlationId": "..."
}
```

## 16.3 Rule

If a decision affects business outcome, user rights, money, compliance, or audit, boolean alone is usually not enough.

---

# 17. Tri-State: `true`, `false`, `unknown`

Sometimes domain has three states:

```text
yes
no
unknown
```

Do not model as nullable Boolean without naming.

Bad:

```java
Boolean verified;
```

What does null mean?

Better:

```java
enum VerificationStatus {
    UNKNOWN,
    VERIFIED,
    NOT_VERIFIED
}
```

or sealed:

```java
sealed interface Verification permits UnknownVerification, Verified, NotVerified {}

record UnknownVerification() implements Verification {}
record Verified(Instant verifiedAt) implements Verification {}
record NotVerified(VerificationReason reason) implements Verification {}
```

## 17.1 Tri-state examples

- user consent: granted / denied / not asked;
- document verification: verified / failed / pending;
- risk assessment: low risk / high risk / unavailable;
- feature rollout: enabled / disabled / default;
- optional config: explicitly true / explicitly false / not configured.

## 17.2 Nullable Boolean acceptable at boundary?

Sometimes yes for DTO/config:

```java
record UpdateUserRequest(Boolean marketingConsent) {}
```

Here null may mean “not provided”.

But map it to explicit command/domain:

```java
sealed interface ConsentUpdate permits NoConsentChange, SetConsent {}

record NoConsentChange() implements ConsentUpdate {}
record SetConsent(boolean granted) implements ConsentUpdate {}
```

## 17.3 Database nullable boolean

If DB has nullable boolean, document semantics.

```sql
marketing_consent BOOLEAN NULL
```

What does NULL mean?

- not asked?
- migrated legacy unknown?
- not applicable?

Make it explicit in domain.

---

# 18. Feature Flag vs Domain Flag

Feature flag and domain flag are different.

## 18.1 Feature flag

Feature flag controls software behavior/deployment.

Example:

```java
if (featureFlags.newApprovalFlowEnabled()) {
    newFlow();
} else {
    oldFlow();
}
```

Properties:

- temporary or operational;
- environment/tenant/user specific;
- should have owner and removal plan;
- not necessarily part of domain history.

## 18.2 Domain flag

Domain flag represents business state.

Example:

```java
caseRecord.isArchived()
```

Properties:

- part of business data;
- audited;
- persisted;
- affects domain rules;
- not temporary deployment mechanism.

## 18.3 Do not mix

Bad:

```java
caseRecord.setNewApprovalFlowEnabled(true);
```

Feature rollout detail leaks into domain entity.

## 18.4 Feature flag lifecycle

Every feature flag should have:

- name;
- owner;
- purpose;
- default;
- rollout plan;
- metrics;
- expiry/removal date;
- kill switch behavior.

## 18.5 Boolean config flag naming

Use positive names:

```java
newApprovalFlowEnabled
strictValidationEnabled
```

Avoid:

```java
disableValidation
skipAudit
```

unless the domain truly centers on disabling.

---

# 19. Soft Delete, Active Flag, dan Lifecycle Modeling

## 19.1 `active` flag ambiguity

```java
boolean active;
```

What does inactive mean?

- disabled?
- deleted?
- suspended?
- expired?
- archived?
- pending activation?
- locked?

## 19.2 Soft delete

```java
boolean deleted;
```

May be too weak. Often need:

```java
DeletionState
```

```java
sealed interface DeletionState permits NotDeleted, Deleted {}

record NotDeleted() implements DeletionState {}
record Deleted(ActorId deletedBy, Instant deletedAt, DeletionReason reason) implements DeletionState {}
```

## 19.3 Account status

Instead of:

```java
boolean active;
boolean locked;
boolean suspended;
boolean deleted;
```

Use:

```java
enum AccountStatus {
    PENDING_ACTIVATION,
    ACTIVE,
    LOCKED,
    SUSPENDED,
    DELETED
}
```

If each state carries data, sealed type.

## 19.4 Query convenience

You can still expose helper predicates:

```java
boolean isActive() {
    return status == AccountStatus.ACTIVE;
}
```

But source of truth is status/state, not multiple booleans.

## 19.5 Database migration

Migrating boolean flags to status:

1. add status column nullable;
2. backfill from flags;
3. write both;
4. switch reads to status;
5. remove old flags later.

Be careful with contradictory legacy rows.

---

# 20. Boolean di Database, JSON, dan API Contract

## 20.1 Database boolean

Databases differ:

```sql
BOOLEAN
BIT
TINYINT
CHAR(1)
```

Java domain should not be polluted by DB encoding.

Use mapper/converter.

## 20.2 Nullable boolean in DB

If column nullable, primitive boolean cannot represent null.

Persistence entity might use:

```java
Boolean marketingConsent;
```

Domain should convert to explicit state.

## 20.3 JSON boolean

JSON supports:

```json
true
false
```

and missing/null:

```json
{ "enabled": null }
{}
```

These are different.

## 20.4 PATCH semantics

For update request:

```json
{
  "enabled": false
}
```

means set false.

Missing:

```json
{}
```

means no change.

If Java DTO:

```java
record UpdateFeatureRequest(Boolean enabled) {}
```

`null` could mean missing or explicit null depending deserialization/config.

Better for complex PATCH: use explicit operation model.

## 20.5 API compatibility

Adding boolean field with default can change behavior.

Example:

```json
{
  "skipValidation": false
}
```

If old clients don't send it, default false may be okay or dangerous.

Document default clearly.

## 20.6 Boolean response fields

If API returns:

```json
{ "eligible": false }
```

consider adding reason:

```json
{
  "eligible": false,
  "reasonCode": "MISSING_EVIDENCE",
  "message": "Mandatory evidence is missing."
}
```

Especially for business decisions.

---

# 21. Boolean di Configuration

## 21.1 Config booleans are powerful

```yaml
security.enabled: true
payment.capture.enabled: false
case.strict-validation.enabled: true
```

A wrong boolean config can change system behavior dramatically.

## 21.2 Defaults

Be cautious with defaults.

For safety-critical config:

```text
missing config should fail startup
```

rather than silently defaulting to unsafe behavior.

## 21.3 Positive names

Prefer:

```yaml
audit.enabled: true
```

over:

```yaml
audit.disabled: false
```

Avoid double negative:

```yaml
disable-authentication: false
```

## 21.4 Config validation

Represent config:

```java
record SecurityConfig(boolean enabled) {}
```

But if explicit presence is required, use wrapper at binding boundary and validate:

```java
record SecurityConfig(Boolean enabled) {
    SecurityConfig {
        if (enabled == null) {
            throw new IllegalArgumentException("security.enabled is required");
        }
    }
}
```

## 21.5 Operational flags

For kill switches:

```java
paymentProcessingEnabled
outboundNotificationEnabled
consumerProcessingEnabled
```

Make sure metrics/logs show when disabled.

---

# 22. Boolean dan Concurrency

A shared boolean field is not automatically thread-safe.

Bad:

```java
class Worker {
    private boolean running = true;

    void stop() {
        running = false;
    }

    void loop() {
        while (running) {
            doWork();
        }
    }
}
```

Another thread may not see update promptly because of visibility/data race.

## 22.1 Use volatile for visibility

```java
class Worker {
    private volatile boolean running = true;

    void stop() {
        running = false;
    }

    void loop() {
        while (running) {
            doWork();
        }
    }
}
```

`volatile` ensures visibility for reads/writes of the variable.

## 22.2 Volatile is not enough for compound operations

```java
volatile boolean initialized;

if (!initialized) {
    initialize();
    initialized = true;
}
```

Multiple threads can initialize concurrently.

Use synchronization/locks/atomic compare-and-set if needed.

## 22.3 AtomicBoolean

```java
AtomicBoolean started = new AtomicBoolean(false);

if (started.compareAndSet(false, true)) {
    start();
}
```

This ensures only one thread starts.

## 22.4 Boolean state machine under concurrency

If state has multiple values, use `AtomicReference<State>` or synchronized state machine, not multiple volatile booleans.

Bad:

```java
volatile boolean started;
volatile boolean stopped;
```

Better:

```java
enum LifecycleState { NEW, STARTING, RUNNING, STOPPING, STOPPED }

AtomicReference<LifecycleState> state = new AtomicReference<>(LifecycleState.NEW);
```

## 22.5 Cancellation

A boolean cancel flag is simple but Java has thread interruption.

For blocking operations, use:

```java
Thread.interrupt()
Future.cancel(true)
structured cancellation when available
```

A volatile flag alone won't unblock blocking I/O.

---

# 23. AtomicBoolean dan Volatile Boolean

## 23.1 Volatile boolean

Use when:

- one writer/multiple readers;
- visibility needed;
- assignment independent;
- no compare-and-set needed.

Example:

```java
private volatile boolean shutdownRequested;
```

## 23.2 AtomicBoolean

Use when:

- need CAS;
- only one transition should win;
- lock-free state flag;
- start/stop once.

Example:

```java
if (closed.compareAndSet(false, true)) {
    releaseResource();
}
```

## 23.3 Synchronized

Use when boolean is part of larger invariant.

```java
synchronized void close() {
    if (closed) return;
    closed = true;
    resource.close();
}
```

If multiple fields must change atomically, volatile/AtomicBoolean alone may not be enough.

## 23.4 Memory semantics

AtomicBoolean operations have memory effects similar to volatile plus atomic update semantics.

But don't use atomic classes as magic. Understand invariant.

## 23.5 Domain booleans vs concurrency booleans

Do not confuse:

```java
AtomicBoolean running
```

low-level lifecycle control

with:

```java
boolean approved
```

domain decision.

They solve different problems.

---

# 24. Boolean di Collections, Streams, dan Predicates

## 24.1 Predicate

Java functional interface:

```java
Predicate<T>
```

returns boolean.

```java
Predicate<CaseRecord> isClosed = c -> c.status() == CaseStatus.CLOSED;
```

Good for filtering.

## 24.2 Predicate should be pure

Avoid side effects:

```java
items.stream()
    .filter(item -> {
        audit(item); // bad side effect in predicate
        return item.isValid();
    })
```

Better separate.

## 24.3 `allMatch`, `anyMatch`, `noneMatch`

```java
boolean allValid = items.stream().allMatch(Item::isValid);
boolean anyInvalid = items.stream().anyMatch(Predicate.not(Item::isValid));
boolean noneExpired = items.stream().noneMatch(Item::isExpired);
```

These short-circuit.

## 24.4 Empty stream behavior

Important:

```java
Stream.empty().allMatch(x -> false)  // true
Stream.empty().anyMatch(x -> true)   // false
Stream.empty().noneMatch(x -> true)  // true
```

This can surprise validation.

Example:

```java
boolean allEvidenceValid = evidence.stream().allMatch(Evidence::isValid);
```

If evidence empty, result true. But domain may require at least one evidence.

Need:

```java
boolean valid = !evidence.isEmpty() && evidence.stream().allMatch(Evidence::isValid);
```

## 24.5 Predicate composition

```java
Predicate<CaseRecord> reviewable =
    hasAssignedOfficer.and(hasMandatoryEvidence).and(notClosed);
```

Readable if predicates named well.

---

# 25. Testing Boolean Logic

Boolean logic grows exponentially.

## 25.1 Truth table

For two booleans:

| A | B | Result |
|---|---|---|
| false | false | ? |
| false | true | ? |
| true | false | ? |
| true | true | ? |

For five booleans:

```text
2^5 = 32 combinations
```

This is why flag-heavy logic becomes hard.

## 25.2 Parameterized tests

```java
@ParameterizedTest
@CsvSource({
    "false,false,false",
    "false,true,false",
    "true,false,false",
    "true,true,true"
})
void eligibility(boolean hasEvidence, boolean assigned, boolean expected) {
    ...
}
```

## 25.3 Test decision reason

If using result object, test not only allowed/denied but reason.

```java
assertThat(result)
    .isInstanceOf(NotEligible.class);

assertThat(((NotEligible) result).violations())
    .extracting(ApprovalViolation::code)
    .contains("MISSING_EVIDENCE");
```

## 25.4 Property-based testing

For state machine, generate transitions and assert invariant:

```text
terminal state cannot transition
closed state always has closedAt and reason
approved and rejected cannot both occur
```

## 25.5 Mutation testing

Boolean conditions are good target for mutation testing.

Mutation tools can flip:

```java
>= to >
&& to ||
true to false
```

If tests still pass, logic not sufficiently tested.

---

# 26. Refactoring Boolean-heavy Code

## 26.1 Original

```java
class CaseRecord {
    boolean submitted;
    boolean assigned;
    boolean approved;
    boolean rejected;
    boolean closed;
}
```

## 26.2 Step 1: Identify real states

List valid states:

```text
DRAFT
SUBMITTED
ASSIGNED
APPROVED
REJECTED
CLOSED
```

## 26.3 Step 2: Replace flags with enum

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    ASSIGNED,
    APPROVED,
    REJECTED,
    CLOSED
}
```

## 26.4 Step 3: Add transition methods

```java
public void submit() {
    requireStatus(CaseStatus.DRAFT);
    status = CaseStatus.SUBMITTED;
}

public void approve(OfficerId officerId) {
    requireStatus(CaseStatus.ASSIGNED);
    status = CaseStatus.APPROVED;
}
```

## 26.5 Step 4: Add event/audit

```java
public CaseApproved approve(ApproveCase command, Clock clock) {
    requireStatus(CaseStatus.ASSIGNED);

    CaseStatus previous = status;
    status = CaseStatus.APPROVED;

    return new CaseApproved(id, previous, status, command.approvedBy(), clock.instant());
}
```

## 26.6 Step 5: Migrate database

Add status column, backfill, write both, switch read, remove old flags.

## 26.7 Step 6: Replace boolean return

From:

```java
boolean canApprove()
```

To:

```java
ApprovalEligibility checkApprovalEligibility()
```

## 26.8 Step 7: Delete obsolete flags

Do not leave old flags as shadow state indefinitely.

---

# 27. Production Failure Modes

## 27.1 Approved and rejected both true

Cause:

```java
boolean approved;
boolean rejected;
```

Fix:

```java
ApprovalStatus
sealed ApprovalDecision
```

## 27.2 Missing config disables security

Cause:

```java
boolean securityEnabled; // default false
```

Fix:

- explicit config validation;
- safe default true;
- fail startup if missing.

## 27.3 Boolean parameter misuse

```java
sendEmail(user, false);
```

Developer thought false = not urgent, method means false = don't validate recipient.

Fix:

- enum;
- options object;
- named methods.

## 27.4 Nullable Boolean NPE

```java
if (user.getMarketingConsent()) {}
```

NPE when null.

Fix:

- explicit tri-state;
- `Boolean.TRUE.equals`;
- validation at boundary.

## 27.5 Audit cannot explain denial

```java
eligible = false
```

No reason.

Fix:

```java
EligibilityDecision
```

with reason/policy version.

## 27.6 Feature flag becomes permanent domain logic

Temporary rollout flag remains for years and forks behavior.

Fix:

- owner;
- removal date;
- ADR;
- cleanup ticket.

## 27.7 Stream allMatch bug

Empty evidence list passes `allMatch`.

Fix:

```java
!evidence.isEmpty() && evidence.stream().allMatch(...)
```

or domain type requiring non-empty evidence set.

## 27.8 Volatile missing in worker stop flag

Worker never stops under optimization/load.

Fix:

```java
volatile boolean running
```

or proper cancellation mechanism.

---

# 28. Best Practices

## 28.1 Use boolean for simple predicates

Good:

```java
isEmpty()
hasNext()
contains()
isFinite()
```

## 28.2 Avoid boolean parameters in public APIs

Prefer:

- enum;
- command object;
- separate methods;
- options object.

## 28.3 Avoid multiple booleans for lifecycle

Use:

- enum status;
- sealed state;
- state machine.

## 28.4 Avoid nullable Boolean in domain

Use:

- enum tri-state;
- sealed type;
- explicit update command.

## 28.5 Decision needing reason should not return boolean

Use:

- result object;
- sealed result;
- policy decision;
- validation result.

## 28.6 Make booleans positive and named clearly

Prefer:

```java
validationEnabled
auditRequired
active
```

Avoid:

```java
notDisabled
skipValidation
disableAudit
```

## 28.7 Be explicit at boundary

For JSON PATCH/config, distinguish:

- missing;
- null;
- false;
- true.

## 28.8 Concurrency needs memory semantics

Shared boolean must be:

- volatile;
- AtomicBoolean;
- guarded by lock;
- part of atomic state machine.

## 28.9 Audit important decisions

If business outcome changes, store reason, actor, policy, time.

---

# 29. Decision Matrix

| Situation | Use boolean? | Better alternative |
|---|---:|---|
| `isEmpty()` | yes | boolean |
| `hasNext()` | yes | boolean |
| simple local condition | yes | boolean |
| method parameter changing behavior | usually no | enum/options/separate method |
| lifecycle state | no | enum/sealed state |
| approval decision | no | enum/sealed decision |
| eligibility with reason | no | result object |
| validation with multiple errors | no | validation result |
| authorization | rarely enough | authorization decision |
| tri-state | no | enum/sealed |
| feature rollout | yes but managed | typed feature flag |
| config safety-critical | primitive boolean risky | required config validation |
| concurrent stop flag | yes with semantics | volatile/AtomicBoolean |
| independent permissions | no multiple booleans | EnumSet/permission model |

---

# 30. Latihan

## Latihan 1 — Boolean parameter refactor

Refactor:

```java
void sendNotification(User user, boolean urgent, boolean includeAttachment, boolean dryRun)
```

menjadi command/options object dengan enum jika perlu.

## Latihan 2 — Approval flags to enum

Dari:

```java
boolean approved;
boolean rejected;
```

ubah menjadi:

```java
ApprovalStatus
```

Lalu buat migration mapping.

## Latihan 3 — Approval flags to sealed type

Buat:

```java
sealed interface ApprovalDecision
record Pending()
record Approved(...)
record Rejected(...)
```

Pastikan rejected wajib punya reason.

## Latihan 4 — Eligibility result

Dari:

```java
boolean canClose(CaseRecord c)
```

ubah menjadi:

```java
CloseEligibility check(CaseRecord c)
```

dengan list violations.

## Latihan 5 — Tri-state consent

Model marketing consent:

```text
not asked
granted
denied
```

Jangan pakai nullable Boolean di domain.

## Latihan 6 — allMatch empty bug

Buat test yang membuktikan:

```java
Stream.empty().allMatch(...)
```

menghasilkan true.

Terapkan ke rule evidence.

## Latihan 7 — AtomicBoolean

Implement worker yang bisa start hanya sekali memakai `AtomicBoolean.compareAndSet`.

## Latihan 8 — Config validation

Buat config:

```java
record SecurityConfig(Boolean enabled) {}
```

Validasi bahwa `enabled` wajib explicit.

---

# 31. Ringkasan

`boolean` adalah primitive sederhana dengan dua nilai:

```text
true
false
```

Tetapi dalam domain modeling, `boolean` sering terlalu miskin.

Gunakan boolean untuk:

- predicate sederhana;
- local condition;
- simple independent property;
- concurrency flag dengan memory semantics benar.

Hindari boolean untuk:

- lifecycle state;
- mutually exclusive alternatives;
- decision yang butuh reason;
- validation dengan banyak error;
- authorization/audit;
- tri-state;
- method parameter yang mengubah behavior besar;
- banyak flags yang menciptakan combinatorial explosion.

Prinsip utama:

```text
If false needs explanation, boolean is not enough.
If many booleans describe one lifecycle, use state.
If null boolean has meaning, name the meaning.
If boolean changes behavior, make the behavior explicit.
```

Top-tier Java engineer tidak anti-boolean. Ia tahu bahwa boolean adalah alat yang tepat untuk predicate sederhana, tetapi buruk untuk domain concept yang kaya.

---

# 32. Referensi

1. Java Language Specification SE 25 — Chapter 4: Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

2. Java Language Specification SE 25 — Boolean Type and Boolean Values  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.2.5

3. Java Language Specification SE 25 — Operators  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html

4. Java SE 25 API — `Boolean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Boolean.html

5. Java SE 25 API — `AtomicBoolean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicBoolean.html

6. Java SE 25 API — `Predicate`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Predicate.html

7. Java SE 25 API — `EnumSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

8. Java SE 25 API — `BitSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/BitSet.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Data Types — Part 003](./learn-java-data-types-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Data Types — Part 005](./learn-java-data-types-part-005.md)
