# Part 24 — Lombok Practical: Getter, Setter, Builder, Value, Equals, HashCode

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> Bagian: 24 dari 35  
> Fokus: penggunaan Lombok secara praktis, aman, eksplisit, dan arsitektural dalam model data/mapping Java 8 sampai Java 25.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu seharusnya mampu:

1. Memahami Lombok bukan sebagai “penghapus boilerplate”, tetapi sebagai **source-level code generation tool** yang memengaruhi bentuk API class.
2. Memilih annotation Lombok dengan sadar: kapan `@Getter`, `@Setter`, `@Builder`, `@Value`, `@Data`, `@EqualsAndHashCode`, `@ToString`, dan constructor annotations aman digunakan.
3. Mendesain DTO, command, response, event, dan internal model yang kompatibel dengan Jackson, MapStruct, JPA, testing, dan Java modern.
4. Menghindari jebakan umum: mutable DTO tanpa sadar, `equals/hashCode` salah, recursive `toString`, builder default hilang, entity rusak karena `@Data`, inheritance ambiguity, dan collection mutability leak.
5. Membuat policy tim: annotation mana yang diizinkan, dibatasi, atau dilarang berdasarkan layer.

---

## 1. Core Mental Model: Lombok Generates API Surface

Kesalahan paling umum saat memakai Lombok adalah menganggapnya hanya mengurangi jumlah baris code.

Padahal Lombok menghasilkan:

- method publik,
- constructor,
- builder type,
- `equals`,
- `hashCode`,
- `toString`,
- null check,
- accessor convention,
- dan kadang shape yang dipakai framework lain.

Artinya, annotation Lombok adalah bagian dari **contract class**.

Contoh:

```java
@Getter
@Setter
public class CreateUserRequest {
    private String email;
    private String displayName;
}
```

Secara source terlihat kecil. Namun contract aktualnya adalah:

```java
public class CreateUserRequest {
    private String email;
    private String displayName;

    public String getEmail() { return this.email; }
    public void setEmail(String email) { this.email = email; }

    public String getDisplayName() { return this.displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
}
```

Framework seperti Jackson, MapStruct, Bean Validation, Spring MVC, dan IDE refactoring akan berinteraksi dengan bentuk class yang efektif ini.

### Prinsip utama

> Setiap annotation Lombok harus diperlakukan seperti kamu menulis method itu secara manual.

Jangan bertanya:

> “Boleh tidak pakai `@Data` supaya cepat?”

Tanya:

> “Apakah saya benar-benar ingin class ini punya setter publik, equals/hashCode berbasis semua field, toString semua field, dan constructor tertentu?”

---

## 2. Lombok in Mapping-Oriented Codebase

Dalam seri ini, Lombok relevan karena banyak model mapping berbentuk:

- request DTO,
- response DTO,
- command object,
- query parameter object,
- event payload,
- integration payload,
- persistence projection,
- mapper helper type,
- test fixture object.

Lombok bisa sangat membantu di area ini. Tetapi kalau sembarangan, ia bisa membuat object boundary menjadi kabur.

### Lombok cocok untuk

- DTO yang jelas mutability-nya.
- Immutable value object sederhana.
- Builder untuk object dengan banyak optional field.
- Constructor injection di service/component.
- Test fixture model.
- Internal projection yang tidak punya invariant berat.

### Lombok berbahaya untuk

- JPA entity dengan relationship kompleks.
- Domain aggregate yang punya invariant serius.
- Security-sensitive object.
- Object yang masuk ke public API tanpa explicit contract review.
- Class inheritance yang butuh equality semantics spesifik.
- Object dengan field sensitif yang tidak boleh muncul di `toString`.
- Class yang dipakai sebagai key `Map` tetapi mutable.

---

## 3. Annotation Classification

Tidak semua annotation Lombok punya risk profile sama.

| Annotation | Risk | Use Case Ideal | Catatan |
|---|---:|---|---|
| `@Getter` | Rendah | DTO, value object, entity selected fields | Umumnya aman |
| `@Setter` | Sedang | Mutable request DTO, framework binding | Jangan default di domain object |
| `@Builder` | Sedang | Immutable DTO, command, fixture | Waspadai default dan Jackson |
| `@Value` | Sedang | Immutable value DTO | Generates final class + all-args constructor |
| `@Data` | Tinggi | Hampir hanya prototyping/simple carrier | Terlalu banyak efek sekaligus |
| `@EqualsAndHashCode` | Tinggi | Value object terkontrol | Harus eksplisit field identity |
| `@ToString` | Sedang/Tinggi | Debug object non-sensitive | Exclude secret/cycle/lazy fields |
| `@NoArgsConstructor` | Sedang | Framework/JPA/Jackson legacy | Bisa melemahkan invariant |
| `@AllArgsConstructor` | Sedang | Simple DTO/internal model | Constructor order risk |
| `@RequiredArgsConstructor` | Rendah/Sedang | Dependency injection/final fields | Sangat berguna untuk Spring service |
| `@SuperBuilder` | Tinggi | Inheritance DTO tertentu | Kompleks, experimental historically |
| `@Jacksonized` | Sedang | Builder deserialization | Bergantung Jackson package/version |

---

## 4. `@Getter`: Usually Safe, But Still a Contract

`@Getter` menghasilkan getter untuk field.

```java
@Getter
public class UserResponse {
    private final String id;
    private final String email;
    private final String displayName;

    public UserResponse(String id, String email, String displayName) {
        this.id = id;
        this.email = email;
        this.displayName = displayName;
    }
}
```

Ini biasanya aman karena hanya membuka read access.

Namun getter tetap contract. Kalau class diserialisasi oleh Jackson, getter bisa membuat property muncul di JSON.

```java
@Getter
public class AccountInternalView {
    private String accountId;
    private String encryptedPassword;
}
```

Jackson default bisa melihat `getEncryptedPassword()` dan mengeluarkannya jika object dipakai sebagai response.

### Rule

`@Getter` aman hanya jika field tersebut memang boleh dibaca oleh semua consumer yang bisa mengakses object tersebut.

Untuk field sensitif:

```java
@Getter
public class UserInternalModel {
    private String id;
    private String email;

    @Getter(AccessLevel.NONE)
    private String passwordHash;
}
```

Atau lebih baik: jangan pakai internal model sebagai response DTO.

### Getter pada collection

Masalah penting:

```java
@Getter
public class CaseSnapshot {
    private final List<String> attachmentIds;

    public CaseSnapshot(List<String> attachmentIds) {
        this.attachmentIds = attachmentIds;
    }
}
```

Getter mengembalikan reference list asli. Object terlihat immutable karena field `final`, tetapi isi list masih mutable.

```java
CaseSnapshot snapshot = new CaseSnapshot(new ArrayList<>(List.of("A1")));
snapshot.getAttachmentIds().add("A2"); // bisa, kalau list mutable
```

Versi lebih aman:

```java
@Getter
public class CaseSnapshot {
    private final List<String> attachmentIds;

    public CaseSnapshot(List<String> attachmentIds) {
        this.attachmentIds = List.copyOf(attachmentIds);
    }
}
```

Untuk Java 8:

```java
@Getter
public class CaseSnapshot {
    private final List<String> attachmentIds;

    public CaseSnapshot(List<String> attachmentIds) {
        this.attachmentIds = Collections.unmodifiableList(new ArrayList<>(attachmentIds));
    }
}
```

### Mental model

`final` field berarti reference tidak berubah. Itu tidak otomatis berarti object graph immutable.

---

## 5. `@Setter`: Useful for Binding, Dangerous for Invariants

`@Setter` menghasilkan setter.

```java
@Getter
@Setter
public class CreateUserRequest {
    private String email;
    private String displayName;
}
```

Ini umum untuk:

- Jackson deserialization lama,
- Spring MVC binding,
- simple mutable request DTO,
- form object.

Tetapi setter publik artinya object bisa berada dalam state intermediate atau invalid.

```java
CreateUserRequest req = new CreateUserRequest();
req.setEmail("not-an-email");
req.setDisplayName(null);
```

Itu mungkin tidak masalah untuk DTO input yang akan divalidasi setelah binding. Tetapi buruk untuk domain object.

### Hindari ini pada domain model

```java
@Getter
@Setter
public class Money {
    private BigDecimal amount;
    private String currency;
}
```

`Money` punya invariant:

- amount tidak boleh null,
- amount harus scale tertentu,
- currency harus ISO code valid,
- amount dan currency harus diproses bersama.

Setter memecah invariant menjadi operasi parsial.

Lebih baik:

```java
@Getter
public final class Money {
    private final BigDecimal amount;
    private final String currency;

    public Money(BigDecimal amount, String currency) {
        if (amount == null) throw new IllegalArgumentException("amount is required");
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("currency must be ISO-4217 code");
        }
        this.amount = amount;
        this.currency = currency.toUpperCase(Locale.ROOT);
    }
}
```

### Field-level setter

Jangan pakai setter class-level kalau hanya sebagian field boleh mutable.

Buruk:

```java
@Getter
@Setter
public class UserProfile {
    private String id;
    private String email;
    private String displayName;
    private Instant createdAt;
}
```

Lebih baik:

```java
@Getter
public class UserProfile {
    private final String id;
    private final Instant createdAt;

    @Setter
    private String displayName;

    private String email;

    public void changeEmail(String newEmail) {
        // validate + normalize + maybe emit event
        this.email = normalizeEmail(newEmail);
    }
}
```

### Rule

Use `@Setter` mostly for:

- request DTO,
- test fixture object,
- framework adapter object,
- generated/integration model.

Avoid `@Setter` for:

- domain object,
- value object,
- event payload,
- object used as `Map` key,
- object requiring invariant.

---

## 6. `@Data`: The Annotation You Should Distrust by Default

`@Data` is convenient, but it bundles multiple decisions:

- `@Getter` for all fields,
- `@Setter` for non-final fields,
- `@ToString`,
- `@EqualsAndHashCode`,
- `@RequiredArgsConstructor`.

This is too much for many production classes.

```java
@Data
public class UserDto {
    private String id;
    private String email;
    private String passwordHash;
    private List<String> roles;
}
```

Problems:

1. Public setter for every non-final field.
2. `passwordHash` included in `toString` unless excluded.
3. `equals/hashCode` uses all non-static, non-transient fields by default.
4. Mutable `roles` participates in equality/hash.
5. Shape changes silently when fields are added.

### Why this matters

Suppose object is used in a `HashSet`:

```java
Set<UserDto> users = new HashSet<>();
UserDto user = new UserDto();
user.setId("U-1");
user.setRoles(new ArrayList<>(List.of("ADMIN")));

users.add(user);
user.getRoles().add("AUDITOR");

boolean exists = users.contains(user); // may be false
```

Why? Because hash code changed after insertion.

### Safer replacement for `@Data`

Instead of:

```java
@Data
public class UserResponse {
    private String id;
    private String email;
    private String displayName;
}
```

Use:

```java
@Getter
@AllArgsConstructor
public class UserResponse {
    private final String id;
    private final String email;
    private final String displayName;
}
```

Or Java record:

```java
public record UserResponse(
    String id,
    String email,
    String displayName
) {}
```

For mutable request DTO:

```java
@Getter
@Setter
@NoArgsConstructor
public class CreateUserRequest {
    private String email;
    private String displayName;
}
```

This is more explicit. You are saying: “This request is mutable because binding needs it.”

### Policy recommendation

For serious enterprise codebase:

- Ban `@Data` on entities.
- Ban `@Data` on domain objects.
- Ban `@Data` on event payloads.
- Avoid `@Data` on API DTOs unless team explicitly accepts the generated equality/toString semantics.
- Allow `@Data` only for small internal throwaway/test objects, if at all.

---

## 7. `@ToString`: Debug Aid, Potential Data Leak

`@ToString` generates `toString()`.

```java
@ToString
public class LoginRequest {
    private String username;
    private String password;
}
```

This is dangerous. Logs may contain:

```text
LoginRequest(username=fajar, password=secret123)
```

### Exclude sensitive fields

```java
@ToString
public class LoginRequest {
    private String username;

    @ToString.Exclude
    private String password;
}
```

But better design: do not log request object directly.

### Recursive relationship risk

```java
@ToString
public class Parent {
    private String id;
    private List<Child> children;
}

@ToString
public class Child {
    private String id;
    private Parent parent;
}
```

Calling `toString()` can recurse or produce huge output.

Safer:

```java
@ToString(onlyExplicitlyIncluded = true)
public class Parent {
    @ToString.Include
    private String id;

    @ToString.Exclude
    private List<Child> children;
}
```

### Rule

Prefer:

```java
@ToString(onlyExplicitlyIncluded = true)
```

for classes with:

- sensitive data,
- relationship graph,
- lazy-loaded fields,
- large collections,
- external payloads.

---

## 8. `@EqualsAndHashCode`: The Most Semantically Dangerous Annotation

`equals/hashCode` is not boilerplate. It defines object identity/equality.

Lombok default uses all non-static, non-transient fields unless configured.

This is fine for simple immutable value objects, but dangerous for mutable, persisted, inherited, or graph-based objects.

### Case 1: Value object

For value object, equality by all meaningful fields is often correct.

```java
@Getter
@EqualsAndHashCode
public final class PostalCode {
    private final String value;

    public PostalCode(String value) {
        this.value = normalize(value);
    }
}
```

This is reasonable.

### Case 2: DTO

For DTO, ask: do you need equality at all?

Most request/response DTOs do not need business equality. Tests can assert fields directly.

If equality is needed for test convenience, be aware that adding a new field changes equality.

### Case 3: Entity

Entity equality is hard.

Bad:

```java
@Data
@Entity
public class UserEntity {
    @Id
    private Long id;

    private String email;

    @OneToMany(mappedBy = "user")
    private List<OrderEntity> orders;
}
```

Problems:

- relationship included in equality/hash unless excluded,
- lazy loading can be triggered,
- mutable field can change hash,
- unsaved entity has null id,
- proxy class may affect equality,
- bidirectional graph can recurse.

Safer style:

```java
@Getter
@Setter
@Entity
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
@ToString(onlyExplicitlyIncluded = true)
public class UserEntity {
    @Id
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long id;

    private String email;

    @OneToMany(mappedBy = "user")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private List<OrderEntity> orders = new ArrayList<>();
}
```

Even this is not universally correct. Some teams avoid Lombok-generated entity equality entirely and write it manually.

### Case 4: Inheritance

```java
@Getter
@EqualsAndHashCode
public class BaseMessage {
    private String correlationId;
}

@Getter
@EqualsAndHashCode
public class PaymentMessage extends BaseMessage {
    private String paymentId;
}
```

Should equality include superclass fields? Lombok forces you to decide with `callSuper`.

```java
@EqualsAndHashCode(callSuper = true)
public class PaymentMessage extends BaseMessage {
    private String paymentId;
}
```

But the deeper question is: should this class hierarchy have equality generated at all?

### Recommended default

Use:

```java
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
```

Then include exactly what matters.

```java
@Getter
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public final class ExternalReference {
    @EqualsAndHashCode.Include
    private final String systemCode;

    @EqualsAndHashCode.Include
    private final String externalId;

    private final String displayLabel;
}
```

This makes equality reviewable.

---

## 9. Constructor Annotations

Lombok constructor annotations are useful, but they affect framework compatibility and invariant design.

### `@NoArgsConstructor`

Generates no-argument constructor.

Useful for:

- Jackson mutable DTO,
- JPA entity,
- legacy frameworks,
- reflection-based tools.

```java
@Getter
@Setter
@NoArgsConstructor
public class CreateCaseRequest {
    private String applicantId;
    private String caseType;
}
```

Risk: object can exist without required fields.

```java
CreateCaseRequest req = new CreateCaseRequest(); // invalid but possible
```

That may be acceptable at binding stage, but not as domain object.

### `@AllArgsConstructor`

Generates constructor for all fields.

```java
@Getter
@AllArgsConstructor
public class CaseResponse {
    private final String id;
    private final String status;
    private final Instant submittedAt;
}
```

Risk: constructor argument order can become unreadable for many same-type fields.

```java
new CaseResponse("C-1", "SUBMITTED", Instant.now());
```

For 3 fields, okay. For 12 fields, risky.

### `@RequiredArgsConstructor`

Generates constructor for final fields and fields marked `@NonNull`.

Excellent for dependency injection:

```java
@Service
@RequiredArgsConstructor
public class CaseApplicationService {
    private final CaseRepository caseRepository;
    private final CaseMapper caseMapper;
    private final Clock clock;
}
```

This is one of Lombok’s safest high-value uses.

### `@NoArgsConstructor(force = true)`

This forces initialization of final fields to default values.

```java
@NoArgsConstructor(force = true)
public class DangerousDto {
    private final String id;
}
```

Generated no-args constructor sets `id` to `null`.

This can violate invariants. Use carefully, mainly for frameworks that absolutely require it, and isolate the object to adapter layer.

---

## 10. `@Builder`: Powerful, But Not Free

`@Builder` creates builder API.

```java
@Getter
@Builder
public class CaseResponse {
    private final String id;
    private final String status;
    private final Instant submittedAt;
    private final String assignedOfficerName;
}
```

Usage:

```java
CaseResponse response = CaseResponse.builder()
    .id("C-1001")
    .status("SUBMITTED")
    .submittedAt(Instant.now())
    .assignedOfficerName("Alice")
    .build();
```

Builder improves readability when:

- many optional fields,
- many same-type fields,
- test fixture setup,
- immutable DTO construction,
- object evolution.

### Builder hides required fields

This compiles:

```java
CaseResponse response = CaseResponse.builder()
    .status("SUBMITTED")
    .build();
```

`id` becomes null unless checked.

If some fields are mandatory, constructor or static factory can be better.

```java
@Getter
public class CaseResponse {
    private final String id;
    private final String status;
    private final Instant submittedAt;
    private final String assignedOfficerName;

    @Builder
    private CaseResponse(String id, String status, Instant submittedAt, String assignedOfficerName) {
        this.id = Objects.requireNonNull(id, "id");
        this.status = Objects.requireNonNull(status, "status");
        this.submittedAt = Objects.requireNonNull(submittedAt, "submittedAt");
        this.assignedOfficerName = assignedOfficerName;
    }
}
```

### Builder default trap

```java
@Getter
@Builder
public class SearchRequest {
    private int page = 1;
    private int size = 20;
}
```

With Lombok builder, field initializer is not automatically used by builder unless `@Builder.Default` is used.

Correct:

```java
@Getter
@Builder
public class SearchRequest {
    @Builder.Default
    private int page = 1;

    @Builder.Default
    private int size = 20;
}
```

### Builder and collection mutability

```java
@Getter
@Builder
public class CaseDetailResponse {
    private final List<String> attachmentIds;
}
```

Builder does not automatically make list immutable.

Safer:

```java
@Getter
public class CaseDetailResponse {
    private final List<String> attachmentIds;

    @Builder
    private CaseDetailResponse(List<String> attachmentIds) {
        this.attachmentIds = attachmentIds == null
            ? List.of()
            : List.copyOf(attachmentIds);
    }
}
```

For Java 8:

```java
this.attachmentIds = attachmentIds == null
    ? Collections.emptyList()
    : Collections.unmodifiableList(new ArrayList<>(attachmentIds));
```

### `@Singular`

Lombok supports singular builder methods for collection fields.

```java
@Getter
@Builder
public class CaseDetailResponse {
    private final String id;

    @Singular
    private final List<String> attachmentIds;
}
```

Usage:

```java
CaseDetailResponse response = CaseDetailResponse.builder()
    .id("C-1")
    .attachmentId("A1")
    .attachmentId("A2")
    .build();
```

This can improve fixture readability, but be careful with generated collection behavior and generated method names.

### Builder on class vs constructor

Class-level:

```java
@Builder
public class UserResponse {
    private String id;
    private String email;
}
```

Constructor-level:

```java
public class UserResponse {
    private final String id;
    private final String email;

    @Builder
    public UserResponse(String id, String email) {
        this.id = id;
        this.email = email;
    }
}
```

Constructor-level builder is often better because the construction logic is visible and controllable.

---

## 11. `@Value`: Immutable-ish Value Class

`@Value` is roughly immutable `@Data`:

- class is final by default,
- fields are private final by default,
- getters generated,
- all-args constructor generated,
- `equals/hashCode` generated,
- `toString` generated,
- no setters.

```java
@Value
public class MoneyDto {
    BigDecimal amount;
    String currency;
}
```

Equivalent shape is closer to:

```java
public final class MoneyDto {
    private final BigDecimal amount;
    private final String currency;

    public MoneyDto(BigDecimal amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }

    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }

    // equals, hashCode, toString
}
```

### Good use cases

- simple immutable DTO,
- value object without complex invariant,
- internal command object,
- event payload object,
- test expectation object.

### Risks

1. `equals/hashCode` includes all fields by default.
2. `toString` includes all fields by default.
3. Collection fields are still mutable unless defensively copied.
4. Java records may be better for Java 16+.

### `@Value` vs record

With Java 16+:

```java
public record MoneyDto(BigDecimal amount, String currency) {}
```

Records are language-level constructs. They are often preferable for pure data carriers.

But Lombok `@Value` still matters when:

- codebase supports Java 8,
- you need Lombok builder integration,
- team has existing Lombok DTO patterns,
- you need class-based DTO not record,
- framework constraints exist.

### Defensive `@Value`

```java
@Value
public class CaseSnapshot {
    String id;
    List<String> attachmentIds;

    public CaseSnapshot(String id, List<String> attachmentIds) {
        this.id = Objects.requireNonNull(id, "id");
        this.attachmentIds = attachmentIds == null
            ? List.of()
            : List.copyOf(attachmentIds);
    }
}
```

At this point, Lombok helps less because constructor is manual. That is okay. Correctness beats annotation purity.

---

## 12. `@NonNull`: Generated Null Check, Not Validation Framework

Lombok `@NonNull` can generate null checks in constructors/setters.

```java
@RequiredArgsConstructor
public class CaseService {
    @NonNull
    private final CaseRepository repository;
}
```

For method parameter:

```java
public void submit(@NonNull String caseId) {
    // Lombok inserts null check
}
```

This is useful for programmer error, not user validation.

### Do not confuse these

| Concern | Tool |
|---|---|
| Programmer forgot required dependency | Lombok `@NonNull`, `Objects.requireNonNull` |
| API request field invalid | Bean Validation / explicit validation |
| Domain invariant violated | Constructor/factory/domain method |
| Database column not null | DB constraint / JPA metadata |

`@NonNull` does not replace request validation.

---

## 13. Lombok for Request DTO

Request DTO is usually inbound and short-lived.

Typical style for Java 8 legacy / Jackson mutable binding:

```java
@Getter
@Setter
@NoArgsConstructor
public class CreateCaseRequest {
    private String applicantId;
    private String caseType;
    private String description;
}
```

This is acceptable because:

- object is just a binding target,
- validation happens after binding,
- service maps it to command/domain object,
- it is not reused as domain model.

### Better with explicit validation annotations

```java
@Getter
@Setter
@NoArgsConstructor
public class CreateCaseRequest {
    @NotBlank
    private String applicantId;

    @NotBlank
    private String caseType;

    @Size(max = 4000)
    private String description;
}
```

### Avoid `@Builder` for API request binding by default

```java
@Getter
@Builder
public class CreateCaseRequest {
    private String applicantId;
    private String caseType;
}
```

Jackson will not necessarily know how to deserialize this unless configured with constructor/builder/Jacksonized support.

For request DTO, keep binding boring and predictable.

### Avoid domain behavior in request DTO

Bad:

```java
@Getter
@Setter
@NoArgsConstructor
public class CreateCaseRequest {
    private String caseType;

    public boolean isHighRisk() {
        return caseType.startsWith("HR-");
    }
}
```

This mixes input representation with domain policy.

Better: map to command, then evaluate policy in application/domain layer.

---

## 14. Lombok for Response DTO

Response DTO is outbound. It should be stable and safe.

Option 1: immutable class with constructor.

```java
@Getter
@AllArgsConstructor
public class CaseSummaryResponse {
    private final String id;
    private final String status;
    private final Instant submittedAt;
}
```

Option 2: builder for many fields.

```java
@Getter
@Builder
public class CaseDetailResponse {
    private final String id;
    private final String status;
    private final Instant submittedAt;
    private final String applicantName;
    private final String assignedOfficerName;
    private final List<DocumentResponse> documents;
}
```

But do defensive copying if collection matters.

Option 3: record on Java 16+.

```java
public record CaseSummaryResponse(
    String id,
    String status,
    Instant submittedAt
) {}
```

### Avoid setters in response DTO

```java
@Getter
@Setter
public class CaseResponse {
    private String id;
    private String status;
}
```

This is not catastrophic, but it makes response shape mutable after construction. In large systems, immutable response DTOs reduce accidental mutation and test flakiness.

---

## 15. Lombok for Command Object

Command object represents application intent.

Example:

```java
@Getter
public class SubmitCaseCommand {
    private final String applicantId;
    private final String caseType;
    private final String description;
    private final String submittedBy;

    @Builder
    public SubmitCaseCommand(
        String applicantId,
        String caseType,
        String description,
        String submittedBy
    ) {
        this.applicantId = requireText(applicantId, "applicantId");
        this.caseType = requireText(caseType, "caseType");
        this.description = description;
        this.submittedBy = requireText(submittedBy, "submittedBy");
    }
}
```

Command should not be half-valid. Unlike request DTO, command is after validation/boundary normalization.

Therefore avoid:

```java
@Getter
@Setter
@NoArgsConstructor
public class SubmitCaseCommand {
    private String applicantId;
    private String caseType;
}
```

Command should represent “validated intent”, not “incoming JSON bag”.

---

## 16. Lombok for Event Payload

Event payload should be stable, immutable, and versionable.

Good:

```java
@Getter
@Builder
public class CaseSubmittedEventPayload {
    private final String eventId;
    private final String caseId;
    private final String applicantId;
    private final String caseType;
    private final Instant occurredAt;
    private final int schemaVersion;
}
```

Potential improvement:

```java
@Getter
public class CaseSubmittedEventPayload {
    private final String eventId;
    private final String caseId;
    private final String applicantId;
    private final String caseType;
    private final Instant occurredAt;
    private final int schemaVersion;

    @Builder
    private CaseSubmittedEventPayload(
        String eventId,
        String caseId,
        String applicantId,
        String caseType,
        Instant occurredAt,
        Integer schemaVersion
    ) {
        this.eventId = Objects.requireNonNull(eventId, "eventId");
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.applicantId = Objects.requireNonNull(applicantId, "applicantId");
        this.caseType = Objects.requireNonNull(caseType, "caseType");
        this.occurredAt = Objects.requireNonNull(occurredAt, "occurredAt");
        this.schemaVersion = schemaVersion == null ? 1 : schemaVersion;
    }
}
```

### Do not use `@Data` for events

Event payload should not be freely mutable after publication.

Bad:

```java
@Data
public class CaseSubmittedEventPayload {
    private String caseId;
    private String applicantId;
    private Instant occurredAt;
}
```

This allows accidental mutation during publishing/logging/retry.

---

## 17. Lombok for JPA Entity

This is the area where Lombok misuse is most common.

### Avoid `@Data` on JPA entity

Bad:

```java
@Data
@Entity
public class CaseEntity {
    @Id
    private Long id;

    @OneToMany(mappedBy = "caseEntity")
    private List<DocumentEntity> documents;
}
```

Risks:

- `toString()` traverses relationship.
- `equals/hashCode()` includes relationship.
- lazy loading may be triggered.
- recursion possible.
- mutable relationship affects hash.
- entity identity semantics become wrong.

### Safer entity pattern

```java
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@ToString(onlyExplicitlyIncluded = true)
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class CaseEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long id;

    @Column(nullable = false)
    private String caseNumber;

    @Column(nullable = false)
    private String status;

    @OneToMany(mappedBy = "caseEntity")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private List<DocumentEntity> documents = new ArrayList<>();

    public CaseEntity(String caseNumber, String status) {
        this.caseNumber = Objects.requireNonNull(caseNumber, "caseNumber");
        this.status = Objects.requireNonNull(status, "status");
    }
}
```

### Even safer: manual equality

For complex JPA entities, write `equals/hashCode` manually or follow a team-standard entity equality policy.

Lombok is not the problem. Ambiguous identity is the problem.

---

## 18. Lombok with Inheritance

Inheritance plus generated code is tricky.

### `@EqualsAndHashCode(callSuper = true/false)`

If subclass extends non-Object superclass, Lombok asks whether superclass fields should be included.

```java
@Getter
@EqualsAndHashCode(callSuper = true)
public class AdminUserDto extends UserDto {
    private final List<String> permissions;
}
```

This may be correct if `UserDto` fields define part of equality.

But inheritance in DTOs often causes fragile models.

### `@SuperBuilder`

`@Builder` does not naturally handle inheritance well. Lombok provides `@SuperBuilder`.

```java
@Getter
@SuperBuilder
public class BaseResponse {
    private final String requestId;
}

@Getter
@SuperBuilder
public class CaseResponse extends BaseResponse {
    private final String caseId;
}
```

Use with caution.

Inheritance DTOs can make JSON shape, MapStruct mapping, and builder generation more complex than necessary.

Prefer composition when possible:

```java
@Getter
@Builder
public class CaseResponse {
    private final ResponseMeta meta;
    private final String caseId;
}
```

---

## 19. Lombok and MapStruct Practical Interaction

MapStruct reads getters, setters, builders, constructors, and field access depending on config and available methods.

### Simple mutable DTO

```java
@Getter
@Setter
@NoArgsConstructor
public class UserDto {
    private String id;
    private String email;
}
```

MapStruct can instantiate and call setters.

### Immutable target with builder

```java
@Getter
@Builder
public class UserResponse {
    private final String id;
    private final String email;
}
```

MapStruct can use builder if it detects builder pattern.

Mapper:

```java
@Mapper
public interface UserMapper {
    UserResponse toResponse(UserEntity entity);
}
```

Generated code conceptually:

```java
return UserResponse.builder()
    .id(entity.getId())
    .email(entity.getEmail())
    .build();
```

### Common issue: Lombok + MapStruct annotation processing order

If MapStruct cannot see Lombok-generated accessors/builders, the build may fail or mappings may not be generated correctly.

Typical solution includes proper annotation processor configuration and, in many setups, `lombok-mapstruct-binding`.

Gradle example:

```groovy
dependencies {
    compileOnly "org.projectlombok:lombok:<version>"
    annotationProcessor "org.projectlombok:lombok:<version>"

    implementation "org.mapstruct:mapstruct:<version>"
    annotationProcessor "org.mapstruct:mapstruct-processor:<version>"
    annotationProcessor "org.projectlombok:lombok-mapstruct-binding:<version>"
}
```

Maven example:

```xml
<annotationProcessorPaths>
    <path>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>${lombok.version}</version>
    </path>
    <path>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok-mapstruct-binding</artifactId>
        <version>${lombok.mapstruct.binding.version}</version>
    </path>
    <path>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>${mapstruct.version}</version>
    </path>
</annotationProcessorPaths>
```

The exact versions should follow your build platform.

---

## 20. Lombok and Jackson Practical Interaction

Jackson can bind using:

- no-args constructor + setters/fields,
- constructor + parameter names/annotations,
- records,
- builders with proper metadata.

### Mutable request DTO: simple

```java
@Getter
@Setter
@NoArgsConstructor
public class CreateUserRequest {
    private String email;
    private String displayName;
}
```

Jackson can easily deserialize this.

### Immutable DTO with all-args constructor

```java
@Getter
@AllArgsConstructor
public class UserResponse {
    private final String id;
    private final String email;
}
```

Serialization is easy because getters exist. Deserialization may require constructor parameter name support or annotations.

### Builder DTO with `@Jacksonized`

```java
@Getter
@Builder
@Jacksonized
public class CreateUserCommandPayload {
    private final String email;
    private final String displayName;
}
```

`@Jacksonized` helps Jackson use Lombok builder.

This is useful for immutable inbound payloads, but it couples Lombok-generated builder metadata with Jackson.

### Practical rule

- Request DTO: prefer simple mutable class or record.
- Response DTO: immutable class/record.
- Event payload: immutable class/record; builder okay.
- Builder deserialization: use deliberately, test with golden payload.

---

## 21. Field Defaults and Initialization

### Field initializer with constructor

```java
@Getter
@NoArgsConstructor
public class SearchRequest {
    private int page = 1;
    private int size = 20;
}
```

No-args constructor preserves initializer.

### Field initializer with builder

```java
@Getter
@Builder
public class SearchRequest {
    private int page = 1;
    private int size = 20;
}
```

Builder may not preserve initializer unless `@Builder.Default` is used.

Correct:

```java
@Getter
@Builder
public class SearchRequest {
    @Builder.Default
    private int page = 1;

    @Builder.Default
    private int size = 20;
}
```

### Default should be semantic

Do not default because “null is annoying”. Default only if it is part of contract.

Bad:

```java
@Builder.Default
private String status = "PENDING";
```

This may hide missing status bugs.

Better:

```java
public static CaseCommand newSubmission(...) {
    return CaseCommand.builder()
        .status(CaseStatus.PENDING)
        ...
        .build();
}
```

---

## 22. Access Level Control

Lombok supports access levels.

```java
@Getter
@Setter(AccessLevel.PRIVATE)
public class CaseDraft {
    private String title;
    private String description;
}
```

This generates public getters but private setters.

### Protected no-args constructor for JPA

```java
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class UserEntity {
    @Id
    private Long id;
}
```

This satisfies JPA while discouraging arbitrary construction from application code.

### Package-private constructor

```java
@AllArgsConstructor(access = AccessLevel.PACKAGE)
@Getter
public class InternalProjection {
    private final String id;
    private final String label;
}
```

Useful when only mapper/factory in same package should construct it.

---

## 23. Lombok and Java Versions: Java 8 to 25 Strategy

### Java 8 era

Common choices:

- Lombok DTOs,
- mutable beans,
- builder classes,
- `@Value` for immutable objects.

### Java 11/17 era

Better choices:

- constructor injection with `@RequiredArgsConstructor`,
- fewer setters,
- stronger use of immutable DTOs,
- gradual move away from entity-as-DTO.

### Java 21/25 era

Language gives more alternatives:

- records for transparent data carriers,
- sealed classes for closed hierarchies,
- pattern matching improvements,
- `List.copyOf`, `Map.copyOf`, `Set.copyOf` for defensive immutable copies.

Lombok still useful, but its role should narrow:

- dependency injection constructors,
- builders for large DTOs,
- legacy Java 8 modules,
- transitional codebases,
- test fixture builders.

### Strategic direction

For modern Java:

- Prefer records for simple DTOs.
- Prefer explicit constructors/factories for domain value objects.
- Use Lombok where it improves signal-to-noise without hiding semantics.
- Avoid Lombok where generated code defines non-trivial behavior.

---

## 24. Practical Patterns

### Pattern A: Mutable inbound request DTO

```java
@Getter
@Setter
@NoArgsConstructor
public class UpdateProfileRequest {
    private String displayName;
    private String phoneNumber;
}
```

Use when:

- Jackson/Spring binding needs no-args + setters,
- object is validated immediately,
- object is mapped to command.

Do not pass this deep into domain.

---

### Pattern B: Immutable response DTO

```java
@Getter
@Builder
public class ProfileResponse {
    private final String userId;
    private final String displayName;
    private final String phoneNumber;
}
```

Use when:

- response has optional fields,
- construction readability matters,
- MapStruct can build target.

---

### Pattern C: Constructor-enforced command

```java
@Getter
public class UpdateProfileCommand {
    private final String userId;
    private final String displayName;
    private final String phoneNumber;
    private final String updatedBy;

    @Builder
    public UpdateProfileCommand(
        String userId,
        String displayName,
        String phoneNumber,
        String updatedBy
    ) {
        this.userId = requireText(userId, "userId");
        this.displayName = normalizeDisplayName(displayName);
        this.phoneNumber = normalizePhone(phoneNumber);
        this.updatedBy = requireText(updatedBy, "updatedBy");
    }
}
```

Use when:

- object represents validated intent,
- construction should enforce invariant,
- builder improves readability.

---

### Pattern D: JPA entity with Lombok minimized

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@ToString(onlyExplicitlyIncluded = true)
public class ProfileEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @ToString.Include
    private Long id;

    @Column(nullable = false)
    private String userId;

    @Column(nullable = false)
    private String displayName;

    public ProfileEntity(String userId, String displayName) {
        this.userId = requireText(userId, "userId");
        this.displayName = requireText(displayName, "displayName");
    }

    public void changeDisplayName(String displayName) {
        this.displayName = requireText(displayName, "displayName");
    }
}
```

Use when:

- entity has behavior,
- setters should be controlled,
- equality is manual or carefully defined.

---

### Pattern E: Test fixture builder

```java
@Builder
@Getter
public class CaseFixture {
    @Builder.Default
    private String caseId = "CASE-001";

    @Builder.Default
    private String status = "DRAFT";

    @Builder.Default
    private Instant submittedAt = Instant.parse("2026-01-01T00:00:00Z");
}
```

This is acceptable because test fixtures prioritize readability and controlled defaults.

---

## 25. Anti-Patterns

### Anti-pattern 1: `@Data` everywhere

```java
@Data
public class Anything {
    private String id;
    private String value;
}
```

This says nothing about intended semantics.

Better: choose explicitly.

---

### Anti-pattern 2: Lombok entity with relationship equality

```java
@Data
@Entity
public class OrderEntity {
    @OneToMany
    private List<OrderLineEntity> lines;
}
```

Dangerous for lazy loading, recursion, and hash stability.

---

### Anti-pattern 3: Builder without invariant

```java
@Builder
@Getter
public class SubmitPaymentCommand {
    private final String accountId;
    private final BigDecimal amount;
    private final String currency;
}
```

This allows null amount/currency.

Better: constructor-level builder with checks.

---

### Anti-pattern 4: `toString` includes secrets

```java
@Data
public class ApiCredential {
    private String clientId;
    private String clientSecret;
}
```

`clientSecret` leaks through logs.

---

### Anti-pattern 5: Mutable object as hash key

```java
@Data
public class CacheKey {
    private String tenantId;
    private String userId;
}
```

If mutated after insertion into `HashMap`, lookup can fail.

Better:

```java
@Value
public class CacheKey {
    String tenantId;
    String userId;
}
```

Or record:

```java
public record CacheKey(String tenantId, String userId) {}
```

---

## 26. Layer-Based Lombok Policy

### API request DTO

Allowed:

- `@Getter`
- `@Setter`
- `@NoArgsConstructor`
- field-level validation annotations

Avoid:

- `@Data`
- `@EqualsAndHashCode`
- `@ToString` with sensitive fields

Possible:

- record DTO for Java 16+ if framework supports it well
- `@Builder + @Jacksonized` only for deliberate immutable inbound payloads

---

### API response DTO

Allowed:

- `@Getter`
- `@AllArgsConstructor`
- `@Builder`
- `@Value`

Prefer:

- record for simple response DTO on modern Java

Avoid:

- setters unless required
- `@Data`

---

### Command/application model

Allowed:

- `@Getter`
- constructor-level `@Builder`
- `@RequiredArgsConstructor` for services

Avoid:

- `@Setter`
- `@Data`
- no-args constructor

---

### Domain model

Allowed cautiously:

- `@Getter`
- `@ToString(onlyExplicitlyIncluded = true)`

Prefer manual:

- constructor/factory,
- equality,
- mutation methods,
- invariant checks.

Avoid:

- `@Setter` class-level,
- `@Data`,
- generated equality unless explicitly reviewed.

---

### JPA entity

Allowed cautiously:

- `@Getter`
- selected field `@Setter` if needed
- `@NoArgsConstructor(access = PROTECTED)`
- `@ToString(onlyExplicitlyIncluded = true)`

Avoid:

- `@Data`
- class-level `@Setter` for rich entities
- `@EqualsAndHashCode` without `onlyExplicitlyIncluded`
- relationship fields in `toString`/equality

---

### Event payload

Allowed:

- `@Getter`
- `@Builder`
- `@Value`
- record

Avoid:

- `@Setter`
- `@Data`

---

### Test code

More permissive:

- `@Builder`
- `@Data` for throwaway test helper
- `@Value`

But do not copy test permissiveness into production code.

---

## 27. Review Checklist

Before accepting Lombok annotation in production code, ask:

1. Does this annotation generate public methods?
2. Are those methods part of API contract?
3. Could Jackson discover generated getters/setters?
4. Could MapStruct rely on generated accessors/builders?
5. Does `toString()` expose secrets or large graph?
6. Does `equals/hashCode()` include mutable fields?
7. Does equality include relationship/lazy fields?
8. Does builder allow missing required fields?
9. Are default values preserved with builder?
10. Are collection fields defensively copied?
11. Does no-args constructor allow invalid object state?
12. Is Lombok used because semantics are simple, or because code is hard to write manually?
13. Would a Java record be clearer?
14. Would an explicit constructor be safer?
15. Does this work consistently in IDE, CI, Maven/Gradle, and annotation processor config?

---

## 28. Practical Decision Matrix

| Scenario | Recommended Shape |
|---|---|
| Simple inbound request DTO, Java 8 | `@Getter @Setter @NoArgsConstructor` |
| Simple inbound request DTO, Java 21+ | record or mutable DTO depending framework style |
| Simple response DTO, Java 8 | `@Getter @AllArgsConstructor` |
| Large response DTO | `@Getter @Builder` |
| Immutable simple value | record or `@Value` |
| Application command | explicit constructor + optional constructor-level `@Builder` |
| Spring service dependencies | `@RequiredArgsConstructor` |
| JPA entity | minimal Lombok, no `@Data` |
| Event payload | record / `@Value` / `@Getter @Builder` |
| Map key | record / `@Value`, no setters |
| Sensitive object | avoid `@ToString` or use explicit include/exclude |
| Inheritance DTO | prefer composition; if needed, `@SuperBuilder` cautiously |

---

## 29. Example: Complete Mapping-Friendly Lombok Design

### Request DTO

```java
@Getter
@Setter
@NoArgsConstructor
public class SubmitCaseRequest {
    @NotBlank
    private String applicantId;

    @NotBlank
    private String caseType;

    @Size(max = 4000)
    private String description;
}
```

### Command

```java
@Getter
public class SubmitCaseCommand {
    private final String applicantId;
    private final String caseType;
    private final String description;
    private final String submittedBy;
    private final Instant submittedAt;

    @Builder
    private SubmitCaseCommand(
        String applicantId,
        String caseType,
        String description,
        String submittedBy,
        Instant submittedAt
    ) {
        this.applicantId = requireText(applicantId, "applicantId");
        this.caseType = requireText(caseType, "caseType");
        this.description = normalizeDescription(description);
        this.submittedBy = requireText(submittedBy, "submittedBy");
        this.submittedAt = Objects.requireNonNull(submittedAt, "submittedAt");
    }
}
```

### Entity

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@ToString(onlyExplicitlyIncluded = true)
public class CaseEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @ToString.Include
    private Long id;

    @Column(nullable = false)
    private String applicantId;

    @Column(nullable = false)
    private String caseType;

    @Column(nullable = false)
    private String status;

    @Column(nullable = false)
    private Instant submittedAt;

    public static CaseEntity submit(SubmitCaseCommand command) {
        CaseEntity entity = new CaseEntity();
        entity.applicantId = command.getApplicantId();
        entity.caseType = command.getCaseType();
        entity.status = "SUBMITTED";
        entity.submittedAt = command.getSubmittedAt();
        return entity;
    }
}
```

### Response DTO

```java
@Getter
@Builder
public class CaseResponse {
    private final String id;
    private final String applicantId;
    private final String caseType;
    private final String status;
    private final Instant submittedAt;
}
```

### Event payload

```java
@Getter
@Builder
public class CaseSubmittedEventPayload {
    private final String eventId;
    private final String caseId;
    private final String applicantId;
    private final String caseType;
    private final Instant occurredAt;

    @Builder.Default
    private final int schemaVersion = 1;
}
```

This design uses Lombok differently per layer. That is the point.

There is no universal annotation combination.

---

## 30. What Top-Level Engineers Do Differently

Average usage:

```java
@Data
public class UserDto {
    private String id;
    private String email;
}
```

Top-level usage asks:

- Is this inbound or outbound?
- Is it mutable or immutable?
- Is equality meaningful?
- Is it safe to log?
- Is it a framework binding object?
- Will Jackson deserialize it?
- Will MapStruct construct it?
- Could a field addition silently change equality or JSON?
- Is the object allowed to be partially initialized?
- Should Java record replace Lombok here?

The difference is not memorizing annotations. The difference is recognizing that Lombok generates behavior, and generated behavior is still design.

---

## 31. Summary

Lombok is powerful when used as a disciplined code generation tool.

The safest high-value annotations are often:

- `@Getter`,
- `@RequiredArgsConstructor`,
- carefully placed `@Builder`,
- sometimes `@Value`,
- carefully restricted `@ToString`.

The most dangerous are:

- `@Data`,
- careless `@EqualsAndHashCode`,
- class-level `@Setter` on domain/entity objects,
- `@ToString` on sensitive/graph objects,
- builder without required-field enforcement.

A mature Java codebase should not have one Lombok style everywhere. It should have Lombok policy per layer.

---

## 32. Practical Exercises

### Exercise 1

Take this class:

```java
@Data
public class OfficerAssignmentDto {
    private String caseId;
    private String officerId;
    private String officerEmail;
    private List<String> permissions;
}
```

Refactor it into:

1. inbound request DTO,
2. application command,
3. outbound response DTO.

Decide which Lombok annotations are appropriate for each.

---

### Exercise 2

Analyze this entity:

```java
@Data
@Entity
public class CaseEntity {
    @Id
    private Long id;

    private String caseNumber;

    @OneToMany(mappedBy = "caseEntity")
    private List<DocumentEntity> documents;
}
```

List at least 8 risks and rewrite it with safer Lombok usage.

---

### Exercise 3

Design an immutable event payload using Lombok builder.

Requirements:

- required event id,
- required aggregate id,
- required occurredAt,
- schema version defaults to 1,
- metadata map must be immutable,
- no secret should appear in `toString`.

---

### Exercise 4

Given a Java 21 service, decide whether each model should use record or Lombok:

1. `CreateUserRequest`
2. `UserResponse`
3. `SubmitPaymentCommand`
4. `PaymentEntity`
5. `PaymentSubmittedEvent`
6. `PaymentCacheKey`

Explain why.

---

## 33. References

- Project Lombok official documentation: `@Data`, `@Builder`, `@EqualsAndHashCode`, `@Jacksonized`, constructor annotations, and feature overview.
- MapStruct official documentation for Lombok integration considerations.
- Jackson databind conventions for getter/setter/builder/constructor discovery.
- Java records and modern Java immutable data modeling practices.

---

## 34. Closing Thought

Lombok is not “good” or “bad”. Lombok is leverage.

Leverage makes correct design faster and bad design more dangerous.

A top-level engineer uses Lombok to reduce accidental noise while keeping semantic decisions explicit.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 23 — Lombok Mental Model: Annotation Processing, Bytecode Shape, IDE Coupling](./23-lombok-mental-model-annotation-processing-bytecode-shape-ide-coupling.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 25 — Lombok with Jackson and MapStruct: Builders, Records, Immutability](./25-lombok-with-jackson-mapstruct-builders-records-immutability.md)
