# learn-java-data-types-part-032.md

# Java Data Types — Part 032  
# Production Failure Case Studies around Java Data Types: Bug Nyata, Root Cause, Fix, dan Prevention

> Seri: **Advanced Java Data Types**  
> Bagian: **032**  
> Fokus: membahas studi kasus production failure yang sering muncul karena desain data type yang lemah: ID tertukar, enum ordinal, `BigDecimal` scale, timezone, null semantics, mutable collections, serialization compatibility, API number precision, unsafe deserialization, cache key, tenant boundary, reflection, validation gap, and performance/memory blow-up. Setiap case dibahas dengan gejala, root cause, kenapa lolos, fix, dan prevention.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Production Bug sebagai Type Design Feedback](#2-mental-model-production-bug-sebagai-type-design-feedback)
3. [Case 1 — CaseId dan OfficerId Tertukar](#3-case-1--caseid-dan-officerid-tertukar)
4. [Case 2 — Enum Ordinal Mengubah Arti Data Lama](#4-case-2--enum-ordinal-mengubah-arti-data-lama)
5. [Case 3 — `BigDecimal.equals` Membuat Cache Miss](#5-case-3--bigdecimalequals-membuat-cache-miss)
6. [Case 4 — Money Tanpa Currency](#6-case-4--money-tanpa-currency)
7. [Case 5 — `double` untuk Amount Membuat Selisih Settlement](#7-case-5--double-untuk-amount-membuat-selisih-settlement)
8. [Case 6 — `LocalDateTime` untuk Token Expiry](#8-case-6--localdatetime-untuk-token-expiry)
9. [Case 7 — Timezone Default Server Berubah Setelah Deployment](#9-case-7--timezone-default-server-berubah-setelah-deployment)
10. [Case 8 — Nullable Boolean Mengubah Meaning Approval](#10-case-8--nullable-boolean-mengubah-meaning-approval)
11. [Case 9 — Optional Field Diserialisasi Aneh di JSON](#11-case-9--optional-field-diserialisasi-aneh-di-json)
12. [Case 10 — Record dengan List Mutable Masuk HashSet](#12-case-10--record-dengan-list-mutable-masuk-hashset)
13. [Case 11 — Internal Collection Bocor dan Di-clear Caller](#13-case-11--internal-collection-bocor-dan-di-clear-caller)
14. [Case 12 — Array dalam Record Membuat Equality Salah](#14-case-12--array-dalam-record-membuat-equality-salah)
15. [Case 13 — `List<Integer>` Membuat Batch OOM](#15-case-13--listinteger-membuat-batch-oom)
16. [Case 14 — `LinkedList` Dipakai untuk Queue Besar](#16-case-14--linkedlist-dipakai-untuk-queue-besar)
17. [Case 15 — API Long ID Hilang Precision di JavaScript](#17-case-15--api-long-id-hilang-precision-di-javascript)
18. [Case 16 — Enum Value Baru Membuat Generated Client Crash](#18-case-16--enum-value-baru-membuat-generated-client-crash)
19. [Case 17 — PATCH Null Menghapus Data Tanpa Sengaja](#19-case-17--patch-null-menghapus-data-tanpa-sengaja)
20. [Case 18 — Direct Entity Serialization Membuka Field Internal](#20-case-18--direct-entity-serialization-membuka-field-internal)
21. [Case 19 — Java Native Deserialization dari Cache Lama Gagal Setelah Deploy](#21-case-19--java-native-deserialization-dari-cache-lama-gagal-setelah-deploy)
22. [Case 20 — Polymorphic Deserialization Type Confusion](#22-case-20--polymorphic-deserialization-type-confusion)
23. [Case 21 — TenantId Hilang dari Cache Key](#23-case-21--tenantid-hilang-dari-cache-key)
24. [Case 22 — IDOR karena Repository `findById`](#24-case-22--idor-karena-repository-findbyid)
25. [Case 23 — Validation Hanya di Controller, Kafka Consumer Bypass](#25-case-23--validation-hanya-di-controller-kafka-consumer-bypass)
26. [Case 24 — DB Constraint Lemah, Manual Script Memasukkan Invalid State](#26-case-24--db-constraint-lemah-manual-script-memasukkan-invalid-state)
27. [Case 25 — Regex Validation ReDoS](#27-case-25--regex-validation-redos)
28. [Case 26 — Generated `toString` Record Bocorkan Token](#28-case-26--generated-tostring-record-bocorkan-token)
29. [Case 27 — Reflection Dispatch Memanggil Method Tak Seharusnya](#29-case-27--reflection-dispatch-memanggil-method-tak-seharusnya)
30. [Case 28 — Dynamic Sort SQL Injection](#30-case-28--dynamic-sort-sql-injection)
31. [Case 29 — Concurrent Mutable Map Value Corrupt](#31-case-29--concurrent-mutable-map-value-corrupt)
32. [Case 30 — Volatile Reference tapi Mutable Object Graph](#32-case-30--volatile-reference-tapi-mutable-object-graph)
33. [Cross-Case Root Cause Taxonomy](#33-cross-case-root-cause-taxonomy)
34. [Incident Response Checklist for Data Type Bugs](#34-incident-response-checklist-for-data-type-bugs)
35. [Preventive Engineering Practices](#35-preventive-engineering-practices)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Bagian ini berbeda dari part sebelumnya.

Kita tidak hanya membahas konsep. Kita membahas bagaimana bug muncul di production karena type design yang lemah.

Format setiap case:

```text
Symptom:
  Apa yang terlihat di production?

Bad Design:
  Bentuk type/code yang menyebabkan masalah.

Root Cause:
  Kenapa secara desain type ini lemah?

Why It Passed:
  Kenapa test/review tidak menangkap?

Fix:
  Perbaikan immediate dan structural.

Prevention:
  Checklist supaya tidak terulang.
```

Tujuan akhirnya bukan menghafal case, tetapi membangun insting:

```text
Saat melihat data type, kamu bisa memprediksi failure mode-nya.
```

---

# 2. Mental Model: Production Bug sebagai Type Design Feedback

Banyak incident bukan “developer lupa if”.

Sering kali incident adalah sinyal bahwa type system tidak cukup mengekspresikan domain.

## 2.1 Example

Bug:

```text
Officer sees case from another tenant.
```

Mungkin bukan hanya authorization bug. Bisa jadi type bug:

```java
CaseId caseId
```

tidak membawa:

```java
TenantId tenantId
```

Seharusnya:

```java
TenantScoped<CaseId>
```

## 2.2 Example

Bug:

```text
Closed case has no closedAt.
```

Bukan hanya validation bug. Bisa jadi state modeling bug:

```java
status + nullable closedAt
```

seharusnya:

```java
sealed CaseState
```

## 2.3 Example

Bug:

```text
Amount differs by 1 cent.
```

Bukan hanya arithmetic bug. Bisa jadi money type bug:

```java
double
```

atau:

```java
BigDecimal without rounding policy
```

## 2.4 Production rule

```text
Every recurring bug deserves a stronger type, stronger boundary, or stronger constraint.
```

---

# 3. Case 1 — CaseId dan OfficerId Tertukar

## Symptom

Beberapa case assigned ke officer yang salah. Log menunjukkan API menerima `caseId` dan `officerId` valid, tetapi urutan parameter di service call tertukar.

## Bad Design

```java
void assign(String caseId, String officerId) {
    ...
}

assign(request.officerId(), request.caseId());
```

Compile karena keduanya `String`.

## Root Cause

Primitive obsession.

Compiler tidak tahu perbedaan konsep `CaseId` dan `OfficerId`.

## Why It Passed

- Unit test memakai value mirip.
- Review melihat dua String dan tidak sadar urutan.
- Tidak ada typed command.

## Fix

```java
record CaseId(String value) {}
record OfficerId(String value) {}

void assign(CaseId caseId, OfficerId officerId) {
    ...
}
```

Command:

```java
record AssignCaseCommand(CaseId caseId, OfficerId officerId, OfficerId actorId) {}
```

## Prevention

- Typed ID untuk setiap entity penting.
- Hindari method dengan 3+ raw String domain parameter.
- Gunakan command object untuk operation penting.
- Test mapping request DTO → command.

---

# 4. Case 2 — Enum Ordinal Mengubah Arti Data Lama

## Symptom

Setelah deploy, status lama di DB berubah arti. Case yang sebelumnya `SUBMITTED` muncul sebagai `CLOSED`.

## Bad Design

```java
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

Enum sebelum:

```java
DRAFT, SUBMITTED, CLOSED
```

Enum setelah:

```java
DRAFT, CLOSED, SUBMITTED
```

## Root Cause

Ordinal adalah posisi deklarasi, bukan stable business code.

## Why It Passed

- Test DB kosong.
- Tidak ada migration test dengan existing data.
- Review hanya melihat enum refactor.

## Fix

Persist stable code:

```java
enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    CLOSED("C");
}
```

Converter:

```java
CaseStatus <-> String code
```

Migration:

```sql
ALTER TABLE case ADD status_code VARCHAR(16);
UPDATE case SET status_code = CASE status_ordinal
  WHEN 0 THEN 'D'
  WHEN 1 THEN 'S'
  WHEN 2 THEN 'C'
END;
```

## Prevention

- Never persist enum ordinal.
- Migration tests with old data.
- DB column should store stable semantic code.
- Add review rule for `EnumType.ORDINAL`.

---

# 5. Case 3 — `BigDecimal.equals` Membuat Cache Miss

## Symptom

Cache lookup untuk amount rule sering miss walaupun amount terlihat sama: `1.0` dan `1.00`.

## Bad Design

```java
Map<BigDecimal, FeeRule> rules;
rules.get(new BigDecimal("1.00"));
```

Key inserted with:

```java
new BigDecimal("1.0")
```

## Root Cause

`BigDecimal.equals` considers value and scale. `1.0` and `1.00` compare equal by `compareTo`, but not by `equals`.

## Why It Passed

- Manual testing prints both as similar.
- Test uses same scale.
- Developer assumes numeric equality.

## Fix

Canonicalize scale:

```java
record DecimalKey(BigDecimal value) {
    DecimalKey {
        value = value.stripTrailingZeros();
    }
}
```

or enforce domain scale:

```java
record MoneyAmount(BigDecimal value) {
    MoneyAmount {
        value = value.setScale(2, RoundingMode.UNNECESSARY);
    }
}
```

## Prevention

- Do not use raw BigDecimal as semantic key without scale policy.
- Define domain decimal type.
- Test scale variants.
- Use Money/Amount type with canonicalization.

---

# 6. Case 4 — Money Tanpa Currency

## Symptom

Report total menggabungkan SGD dan USD tanpa konversi.

## Bad Design

```java
BigDecimal total = orders.stream()
    .map(Order::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

## Root Cause

`BigDecimal` amount tidak membawa currency.

## Why It Passed

- Test hanya pakai satu currency.
- UI menampilkan currency terpisah.
- DB punya currency column, tapi service method hanya menerima amount.

## Fix

```java
record Money(BigDecimal amount, Currency currency) {
    Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new CurrencyMismatchException();
        }
        return new Money(amount.add(other.amount), currency);
    }
}
```

## Prevention

- Money always amount + currency.
- No service API accepts amount alone when it means money.
- Reports group by currency or convert explicitly.
- DB constraint/columns reflect amount + currency.

---

# 7. Case 5 — `double` untuk Amount Membuat Selisih Settlement

## Symptom

Settlement mismatch 1-2 cents pada beberapa transaksi.

## Bad Design

```java
double total = price * quantity;
```

## Root Cause

Binary floating point cannot exactly represent many decimal fractions.

## Why It Passed

- Small values looked correct in UI formatting.
- Tests used rounded display, not exact expected amount.
- No reconciliation test.

## Fix

Use:

```java
Money(BigDecimal amount, Currency currency)
```

or minor units:

```java
record MoneyMinor(long minorUnits, Currency currency) {}
```

## Prevention

- Never use double/float for money.
- Test exact decimal values.
- Define rounding policy.
- Reconcile at domain level, not display level.

---

# 8. Case 6 — `LocalDateTime` untuk Token Expiry

## Symptom

Token yang harusnya expired masih diterima atau expired terlalu cepat setelah service dipindah timezone.

## Bad Design

```java
record Token(String value, LocalDateTime expiresAt) {}
```

Validation:

```java
LocalDateTime.now().isBefore(token.expiresAt())
```

## Root Cause

`LocalDateTime` tidak merepresentasikan instant global. Expiry adalah timeline concept.

## Why It Passed

- Dev/test/prod awalnya timezone sama.
- Test tidak inject Clock.
- Token created/validated di service berbeda zona.

## Fix

```java
record Token(String value, Instant expiresAt) {}
```

Validation:

```java
boolean valid = clock.instant().isBefore(expiresAt);
```

## Prevention

- Use Instant for security expiry.
- Inject Clock.
- Test with different ZoneId.
- Avoid system default timezone for auth logic.

---

# 9. Case 7 — Timezone Default Server Berubah Setelah Deployment

## Symptom

Report harian bergeser satu hari setelah deploy container base image baru.

## Bad Design

```java
LocalDate today = LocalDate.now();
```

or:

```java
new Date().toString()
```

without explicit zone.

## Root Cause

System default timezone changed.

## Why It Passed

- Local machine matched expected timezone.
- No test asserts timezone.
- No runtime observability for zone.

## Fix

```java
LocalDate today = LocalDate.now(businessZone);
```

or:

```java
Instant now = clock.instant();
```

Display:

```java
now.atZone(userZone)
```

## Prevention

- Always make business zone explicit.
- Log timezone at startup.
- Inject Clock/ZoneId.
- Avoid implicit default zone in domain.

---

# 10. Case 8 — Nullable Boolean Mengubah Meaning Approval

## Symptom

Approval dashboard menampilkan pending item sebagai rejected.

## Bad Design

```java
Boolean approved;
```

UI:

```java
if (Boolean.TRUE.equals(approved)) APPROVED else REJECTED
```

## Root Cause

`null` meant pending, but code treated null as false.

## Why It Passed

- Test only true/false.
- Meaning of null undocumented.
- DB column nullable without enum.

## Fix

```java
enum ApprovalStatus {
    PENDING,
    APPROVED,
    REJECTED
}
```

## Prevention

- Avoid nullable Boolean for meaningful tri-state.
- Use enum/state.
- DB NOT NULL with explicit status.
- API schema documents values.

---

# 11. Case 9 — Optional Field Diserialisasi Aneh di JSON

## Symptom

API response contains:

```json
"email": {"empty": false, "present": true}
```

or client fails to parse Optional field.

## Bad Design

```java
record UserResponse(Optional<String> email) {}
```

## Root Cause

`Optional` is Java API type, not wire type.

## Why It Passed

- Java unit test compares object, not JSON.
- Serializer config differs between services.
- OpenAPI generated incorrectly.

## Fix

Use DTO:

```java
record UserResponse(String email) {}
```

with explicit nullable/missing schema.

Domain can expose:

```java
Optional<EmailAddress> email()
```

Mapper decides JSON representation.

## Prevention

- Avoid Optional fields in DTO/entity.
- Test actual serialized JSON.
- Explicit OpenAPI schema for null/missing.

---

# 12. Case 10 — Record dengan List Mutable Masuk HashSet

## Symptom

Object yang sudah masuk `HashSet` tidak ditemukan lagi setelah list source berubah.

## Bad Design

```java
record Tags(List<String> values) {}
```

Usage:

```java
List<String> raw = new ArrayList<>(List.of("a"));
Tags tags = new Tags(raw);
set.add(tags);
raw.add("b");
set.contains(tags); // false maybe
```

## Root Cause

Record equality/hashCode includes list. Mutable list changed hash.

## Why It Passed

- Test did not mutate after insertion.
- Developer assumed record immutable.
- No defensive copy.

## Fix

```java
record Tags(List<String> values) {
    Tags {
        values = List.copyOf(values);
    }
}
```

## Prevention

- Defensive copy mutable components.
- Avoid mutable components in hash keys.
- Test mutation of constructor input.
- Remember record is shallowly immutable.

---

# 13. Case 11 — Internal Collection Bocor dan Di-clear Caller

## Symptom

Order lines disappear after external code calls getter and clears list.

## Bad Design

```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    List<OrderLine> lines() {
        return lines;
    }
}
```

## Root Cause

Representation exposure.

## Why It Passed

- Getter seemed harmless.
- Test used getter for assertion and later helper cleared list.
- No ownership policy.

## Fix

```java
List<OrderLine> lines() {
    return List.copyOf(lines);
}
```

or expose behavior:

```java
boolean hasLine(ProductId productId)
```

## Prevention

- Do not return mutable internals.
- Use immutable snapshots.
- Add mutation tests for accessors.
- Use domain methods for mutation.

---

# 14. Case 12 — Array dalam Record Membuat Equality Salah

## Symptom

Two digest objects with same bytes are not equal.

## Bad Design

```java
record Digest(byte[] bytes) {}
```

Generated equals uses array reference equality.

## Root Cause

Arrays do not override equals/hashCode by content.

## Why It Passed

- Tests compared same byte array instance.
- Record assumed value semantics.

## Fix

Use class:

```java
final class Digest {
    private final byte[] bytes;

    Digest(byte[] bytes) {
        this.bytes = bytes.clone();
    }

    byte[] bytes() {
        return bytes.clone();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Digest other && Arrays.equals(bytes, other.bytes);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(bytes);
    }
}
```

## Prevention

- Avoid arrays in records unless custom methods.
- Use defensive copy.
- Test equal content, different arrays.

---

# 15. Case 13 — `List<Integer>` Membuat Batch OOM

## Symptom

Batch job processing millions of numeric IDs OOMs after data volume grows.

## Bad Design

```java
List<Integer> ids = new ArrayList<>();
```

## Root Cause

Boxing creates many Integer objects plus references, much larger than primitive array/int stream.

## Why It Passed

- Initial data small.
- Memory test not at production scale.
- Big-O seemed fine.

## Fix

Use:

```java
int[]
IntStream
primitive collection
streaming processing
```

## Prevention

- Avoid boxed numeric collections in high-volume hot paths.
- Load test realistic volume.
- Monitor allocation and heap.
- Use JFR/heap histogram.

---

# 16. Case 14 — `LinkedList` Dipakai untuk Queue Besar

## Symptom

High memory usage and slow iteration in queue-like processing.

## Bad Design

```java
Queue<Job> queue = new LinkedList<>();
```

## Root Cause

Each element creates node object with prev/next references; poor locality.

## Why It Passed

- Chosen because “queue”.
- No memory profiling.
- Data volume grew.

## Fix

Use:

```java
ArrayDeque<Job>
```

single-threaded, or:

```java
BlockingQueue<Job>
```

for producer-consumer.

## Prevention

- Prefer ArrayDeque for stack/queue unless reason.
- Avoid LinkedList by default.
- Benchmark large queues.

---

# 17. Case 15 — API Long ID Hilang Precision di JavaScript

## Symptom

Frontend calls detail endpoint with ID from list response, receives 404.

## Bad Design

```json
{
  "caseId": 9007199254740993
}
```

JavaScript rounds it.

## Root Cause

JSON number consumed by JavaScript Number loses precision beyond safe integer range.

## Why It Passed

- Test IDs small.
- Backend Java long works.
- OpenAPI says int64 but client uses JS number.

## Fix

Expose ID as string:

```json
{
  "caseId": "9007199254740993"
}
```

## Prevention

- Public long IDs as string when JS clients exist.
- OpenAPI schema pattern for numeric string.
- Contract tests with large IDs.

---

# 18. Case 16 — Enum Value Baru Membuat Generated Client Crash

## Symptom

Mobile client crashes after backend adds status `UNDER_REVIEW`.

## Bad Design

Closed enum in OpenAPI:

```yaml
enum: [DRAFT, SUBMITTED, CLOSED]
```

Client generated strict enum without fallback.

## Root Cause

Adding enum value can be breaking for strict clients.

## Why It Passed

- Backend considered additive.
- No generated client compatibility test.
- Clients not tolerant.

## Fix

Options:

- version API;
- add `UNKNOWN` fallback in clients;
- document extensible enum;
- coordinate rollout.

## Prevention

- Treat enum expansion as compatibility risk.
- Test generated clients.
- Use stable code + unknown handling.
- Avoid exposing overly granular internal states.

---

# 19. Case 17 — PATCH Null Menghapus Data Tanpa Sengaja

## Symptom

User updates displayName, secondaryEmail becomes null.

## Bad Design

```java
record UpdateProfileRequest(String displayName, String secondaryEmail) {}
```

Mapper:

```java
profile.setSecondaryEmail(request.secondaryEmail());
```

If field missing, deserializer sets null.

## Root Cause

Missing and null not distinguished.

## Why It Passed

- Full update tests only.
- PATCH semantics not modeled.
- DTO nullable fields ambiguous.

## Fix

Use explicit patch type:

```java
sealed interface PatchField<T> permits Unchanged, SetValue, ClearValue {}

record Unchanged<T>() implements PatchField<T> {}
record SetValue<T>(T value) implements PatchField<T> {}
record ClearValue<T>() implements PatchField<T> {}
```

or JSON Patch/Merge Patch deliberately.

## Prevention

- Design PATCH semantics explicitly.
- Test missing/null/value.
- Avoid naive partial update DTO.

---

# 20. Case 18 — Direct Entity Serialization Membuka Field Internal

## Symptom

API response includes `internalNotes`, `deletedAt`, or `securityFlags`.

## Bad Design

```java
@GetMapping
CaseEntity getCase(...) {
    return entity;
}
```

## Root Cause

Persistence model used as API contract.

## Why It Passed

- Field added for internal feature.
- No API snapshot/contract test.
- Serializer auto-detected getter.

## Fix

Create response DTO:

```java
record CaseResponse(String caseId, String status, String updatedAt) {}
```

Map explicitly.

## Prevention

- Never expose entity directly.
- API contract tests.
- DTO whitelist fields.
- Sensitive field review.

---

# 21. Case 19 — Java Native Deserialization dari Cache Lama Gagal Setelah Deploy

## Symptom

After deploy, app cannot read cached serialized objects. Exceptions around `InvalidClassException`.

## Bad Design

Cache stores Java serialized entity/domain object.

## Root Cause

Class changed; native Java serialization tightly coupled to class structure/serialVersionUID.

## Why It Passed

- Local cache empty during tests.
- Deployment didn't clear distributed cache.
- No cache versioning.

## Fix

- Clear cache or namespace version.
- Store explicit cache DTO JSON/Protobuf with version.
- Avoid Java native serialization for shared cache.

## Prevention

- Cache key namespace version.
- Compatibility tests.
- Prefer schema-based serialization.
- Cache immutable DTOs, not entities.

---

# 22. Case 20 — Polymorphic Deserialization Type Confusion

## Symptom

Unexpected subtype instantiated from user-controlled JSON. Security review flags unsafe default typing.

## Bad Design

Payload includes class name:

```json
{
  "@class": "com.example.SomeType",
  ...
}
```

## Root Cause

Untrusted input controls Java class/type.

## Why It Passed

- Feature built for internal use then exposed.
- No security review of serializer config.
- Tests used only expected subtype.

## Fix

Use stable discriminator:

```json
{
  "type": "CARD_PAYMENT",
  ...
}
```

Whitelist subtypes.

## Prevention

- No class-name-based polymorphism for untrusted input.
- Use sealed DTO variants.
- Security tests for unknown type.
- Keep serializer config explicit.

---

# 23. Case 21 — TenantId Hilang dari Cache Key

## Symptom

Tenant A sees cached summary from Tenant B.

## Bad Design

```java
String key = "case-summary:" + caseId.value();
```

## Root Cause

Cache key did not include tenant dimension.

## Why It Passed

- Test single tenant.
- Case IDs globally unique assumed but not enforced.
- Cache key built from raw string.

## Fix

```java
String key = "tenant:" + tenantId.value() + ":case-summary:" + caseId.value();
```

Better type:

```java
record TenantCaseId(TenantId tenantId, CaseId caseId) {}
```

## Prevention

- Tenant-scoped types.
- Multi-tenant tests.
- Cache key builder requires tenant.
- Repository query includes tenant.

---

# 24. Case 22 — IDOR karena Repository `findById`

## Symptom

Authenticated user accesses resource by changing ID.

## Bad Design

```java
caseRepository.findById(caseId)
```

Controller validates ID format but not tenant/ownership.

## Root Cause

Typed ID validates syntax, not authorization.

## Why It Passed

- Tests only access own data.
- Repository API made unsafe query easy.
- Tenant boundary not in type.

## Fix

```java
caseRepository.findByTenantIdAndCaseId(principal.tenantId(), caseId)
```

or:

```java
caseRepository.find(TenantScoped<CaseId> caseRef)
```

## Prevention

- Tenant-scoped IDs.
- Authorization tests for cross-tenant access.
- Repository API makes unsafe access hard.
- Security review for ID-based endpoints.

---

# 25. Case 23 — Validation Hanya di Controller, Kafka Consumer Bypass

## Symptom

Invalid event creates domain object with blank reason, causing later workflow failure.

## Bad Design

Controller validates request, but domain type raw:

```java
record CloseCaseCommand(String caseId, String reason) {}
```

Kafka consumer creates command directly from event.

## Root Cause

Validation only at HTTP boundary; domain invariant absent.

## Why It Passed

- Tests focus controller.
- Consumer added later.
- Shared command uses raw String.

## Fix

```java
record ClosureReason(String value) {
    ClosureReason {
        if (value == null || value.isBlank()) throw ...
    }
}
```

Command:

```java
record CloseCaseCommand(CaseId caseId, ClosureReason reason) {}
```

Consumer maps event to domain types.

## Prevention

- Domain types enforce invariants.
- Every boundary maps raw to trusted type.
- Consumer contract validation.
- DB constraints if persisted.

---

# 26. Case 24 — DB Constraint Lemah, Manual Script Memasukkan Invalid State

## Symptom

Case status `CLOSED` but `closed_at` null appears after manual data fix.

## Bad Design

DB:

```sql
status VARCHAR(20)
closed_at TIMESTAMP NULL
```

No constraints.

## Root Cause

Domain invariant not mirrored in database.

## Why It Passed

- App never writes invalid state.
- Manual script bypassed app.
- DB schema too permissive.

## Fix

Add constraints where possible:

```sql
CHECK (
  (status <> 'CLOSED') OR (closed_at IS NOT NULL)
)
```

Or redesign state table.

## Prevention

- Critical invariants in DB.
- Data migration scripts reviewed/tested.
- Constraint naming.
- Domain + DB consistency tests.

---

# 27. Case 25 — Regex Validation ReDoS

## Symptom

One request with long malicious string consumes CPU and causes timeout spike.

## Bad Design

```java
@Pattern(regexp = "^(a+)+$")
String value;
```

or complex nested backtracking regex.

## Root Cause

Catastrophic backtracking with unbounded input.

## Why It Passed

- Tests used normal strings.
- No max length before regex.
- Regex copied from internet.

## Fix

- Limit input length before regex.
- Use simpler regex.
- Use parser instead of regex for complex format.
- Fuzz test.

## Prevention

- Review regex for nested quantifiers.
- Apply max length on all external strings.
- Benchmark malicious cases.
- Security test validation patterns.

---

# 28. Case 26 — Generated `toString` Record Bocorkan Token

## Symptom

Access tokens appear in logs after request DTO is logged.

## Bad Design

```java
record AuthRequest(String username, String password, String accessToken) {}
```

Log:

```java
log.info("request={}", request);
```

Generated toString includes all components.

## Root Cause

Sensitive data represented as normal String in record.

## Why It Passed

- Debug logging enabled for incident.
- No secret redaction tests.
- Record toString assumed harmless.

## Fix

Use secret wrapper:

```java
record AccessToken(String value) {
    @Override
    public String toString() {
        return "AccessToken[masked]";
    }
}
```

or override DTO toString.

## Prevention

- Sensitive type wrappers.
- Logging policy/redaction.
- No raw request body logs for auth/payment.
- Static analysis for fields named token/password/secret.

---

# 29. Case 27 — Reflection Dispatch Memanggil Method Tak Seharusnya

## Symptom

User crafts action name that invokes internal method.

## Bad Design

```java
Method method = service.getClass().getMethod(request.action());
method.invoke(service);
```

## Root Cause

Business operation chosen by untrusted string method name.

## Why It Passed

- Intended actions tested.
- No negative/security test.
- Reflection used for convenience.

## Fix

Use enum/sealed command:

```java
enum Action { CLOSE, ASSIGN }

switch (action) { ... }
```

or handler registry with allowlist.

## Prevention

- Never use user input as method/class name.
- Whitelist action values.
- Prefer typed command dispatch.

---

# 30. Case 28 — Dynamic Sort SQL Injection

## Symptom

Security scan finds SQL injection in sort query parameter.

## Bad Design

```java
String sql = "SELECT * FROM case ORDER BY " + request.sort();
```

## Root Cause

Column names cannot be bound as prepared statement parameters, and raw string was concatenated.

## Why It Passed

- Prepared statements used for values, not sort.
- Sort seemed harmless.
- No allowlist.

## Fix

```java
enum CaseSortField {
    CREATED_AT("created_at"),
    CASE_ID("case_id");

    private final String column;
}
```

Map request sort code to enum, then use allowed column.

## Prevention

- Dynamic SQL identifiers must be allowlisted.
- Use enum for sort/filter fields.
- Security tests for query params.

---

# 31. Case 29 — Concurrent Mutable Map Value Corrupt

## Symptom

Concurrent updates produce lost permissions or inconsistent list in `ConcurrentHashMap`.

## Bad Design

```java
ConcurrentHashMap<UserId, List<Permission>> permissions = new ConcurrentHashMap<>();
permissions.get(userId).add(permission);
```

## Root Cause

Map operations are concurrent, but list value is mutable and not thread-safe.

## Why It Passed

- Single-thread tests.
- Developer assumed ConcurrentHashMap makes contents safe.

## Fix

Use immutable replacement:

```java
permissions.compute(userId, (id, old) -> {
    List<Permission> copy = old == null ? new ArrayList<>() : new ArrayList<>(old);
    copy.add(permission);
    return List.copyOf(copy);
});
```

or concurrent value type.

## Prevention

- Concurrent collection does not make mutable values safe.
- Store immutable values.
- Use atomic map operations.
- Concurrency tests.

---

# 32. Case 30 — Volatile Reference tapi Mutable Object Graph

## Symptom

Reader sees partially updated configuration.

## Bad Design

```java
volatile Config config;

class Config {
    Map<String, Rule> rules = new HashMap<>();
}
```

Writer mutates:

```java
config.rules.put("x", rule);
```

## Root Cause

Volatile protects reference visibility, not internal mutable graph.

## Why It Passed

- Small config reload fine.
- No concurrent reload/read stress test.
- `volatile` misunderstood.

## Fix

Immutable config:

```java
record Config(Map<String, Rule> rules) {
    Config {
        rules = Map.copyOf(rules);
    }
}
```

Reload:

```java
config = new Config(newRules);
```

## Prevention

- Volatile reference should point to immutable snapshot.
- Do not mutate published objects.
- JMM review for shared state.
- Stress tests with concurrent reload/read.

---

# 33. Cross-Case Root Cause Taxonomy

Most cases fall into these root causes.

## 33.1 Missing domain type

Raw String/int/BigDecimal used for meaningful concept.

## 33.2 Missing invariant

Object can exist in invalid state.

## 33.3 Missing boundary mapping

Raw external data leaks inward or internal entity leaks outward.

## 33.4 Missing compatibility contract

Serialization/API/DB representation changes without versioning.

## 33.5 Missing ownership policy

Mutable collections/arrays shared unexpectedly.

## 33.6 Missing security type

Secret/path/URL/token treated as normal string.

## 33.7 Missing concurrency model

Shared mutable graph without synchronization/immutability.

## 33.8 Missing scale awareness

Wrapper/object-rich structure used for huge volume.

## 33.9 Missing persistence constraint

DB accepts invalid data.

## 33.10 Missing tests with real boundary

Only unit tests, no JSON/DB/schema/client/concurrency/scale tests.

---

# 34. Incident Response Checklist for Data Type Bugs

When production bug appears, ask:

## 34.1 Identify type weakness

```text
Was raw primitive/string used for domain concept?
Was null meaning ambiguous?
Was state represented as status + optional fields?
Was mutable data shared?
Was serialization contract implicit?
```

## 34.2 Find all boundaries

```text
HTTP
Kafka
DB
cache
file
batch
admin script
third-party
```

## 34.3 Check invariant locations

```text
DTO validation?
domain constructor?
service rule?
DB constraint?
API schema?
event schema?
```

## 34.4 Check compatibility

```text
Old data?
Old consumers?
Generated clients?
Cached values?
Serialized events?
```

## 34.5 Check scale/concurrency

```text
Data volume?
Object count?
Shared mutable object?
Concurrent access?
```

## 34.6 Fix levels

- hotfix data;
- patch validation;
- strengthen domain type;
- add DB/API/schema constraint;
- add migration;
- add tests;
- add monitoring.

## 34.7 Prevent recurrence

Create checklist/code standard for this category.

---

# 35. Preventive Engineering Practices

## 35.1 Type review

In code review, flag:

- raw ID strings;
- boolean parameters;
- nullable fields;
- BigDecimal money without currency;
- LocalDateTime for audit/security time;
- record with mutable component;
- direct entity serialization;
- enum ordinal.

## 35.2 Boundary tests

Test:

- JSON shape;
- OpenAPI compatibility;
- DB round-trip;
- event schema;
- cache compatibility.

## 35.3 Property-based tests

For parsers/IDs/date ranges/money.

## 35.4 Mutation/alias tests

Test constructor input mutation and accessor mutation.

## 35.5 Scale tests

For large collections/wrapper-heavy paths.

## 35.6 Concurrency tests

For shared state/cache/config.

## 35.7 Security tests

For path/URL/sort/deserialization/token logging.

## 35.8 Migration tests

With old data/schema/cache/event.

---

# 36. Latihan

## Latihan 1 — ID Swap

Create method with two String IDs, write bug, refactor to typed IDs.

## Latihan 2 — Enum Ordinal

Simulate ordinal persistence and reorder enum. Observe corruption.

## Latihan 3 — BigDecimal Scale

Use `BigDecimal("1.0")` and `BigDecimal("1.00")` as map keys. Fix with canonical type.

## Latihan 4 — LocalDateTime Expiry

Write token expiry with LocalDateTime. Test across zones. Refactor to Instant.

## Latihan 5 — Mutable Record

Put record containing List into HashSet, mutate source list, observe behavior.

## Latihan 6 — Array Record

Compare two record digests with equal byte contents. Refactor class.

## Latihan 7 — JS Long Precision

Create JSON with long ID > 2^53 and parse in JS/TypeScript. Fix API schema.

## Latihan 8 — PATCH Null

Design missing/null/value PATCH tests.

## Latihan 9 — Tenant Cache Key

Build cache key without tenant, write failing multi-tenant test.

## Latihan 10 — ReDoS

Create dangerous regex and long input. Add max length/safe regex.

## Latihan 11 — Concurrent Map Value

Use ConcurrentHashMap with mutable List value. Refactor to immutable replacement.

## Latihan 12 — Production Review

Take one existing project DTO/entity and identify 10 data type smells.

---

# 37. Ringkasan

Production failures around data types usually happen because code allows too much.

Common pattern:

```text
Raw type was too weak.
Boundary was too implicit.
Invariant was not enforced.
Compatibility was assumed.
Mutability was uncontrolled.
Security meaning was hidden.
```

Key lessons:

- Typed IDs prevent parameter mix-ups.
- Stable enum codes prevent ordinal corruption.
- Money needs currency and rounding policy.
- BigDecimal scale matters.
- Instant is for machine/security time.
- Null is not a domain model.
- Records are shallow immutable.
- Arrays are not value-equal by default.
- Public API numbers must consider client precision.
- PATCH needs explicit semantics.
- Entities should not be serialized directly.
- Java native serialization is fragile and risky.
- Tenant/security boundaries should appear in types.
- Concurrent containers do not make mutable values safe.
- Volatile does not make object graph immutable.
- DB/API/event/cache compatibility must be tested.

Senior Java engineer treats every production incident as feedback:

```text
What type could have made this impossible?
What schema/constraint could have caught this earlier?
What boundary mapping was missing?
What test should exist now?
```

This mindset turns bugs into stronger type design.

---

# 38. Referensi

1. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

2. Java SE 25 API — `Instant`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html

3. Java SE 25 API — `LocalDateTime`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDateTime.html

4. Java SE 25 API — `Record`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

5. Java SE 25 API — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

6. Java SE 25 API — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

7. OWASP SQL Injection Prevention Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

8. OWASP Deserialization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html

9. OpenAPI Specification 3.1.1  
   https://spec.openapis.org/oas/v3.1.1.html

10. RFC 9457 — Problem Details for HTTP APIs  
    https://www.rfc-editor.org/rfc/rfc9457.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-data-types-part-031.md](./learn-java-data-types-part-031.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-033.md](./learn-java-data-types-part-033.md)
