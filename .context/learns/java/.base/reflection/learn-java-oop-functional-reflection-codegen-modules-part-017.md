# learn-java-oop-functional-reflection-codegen-modules-part-017

# Optional, Nullability, Result Modeling, and Error Channels

> Seri: **Java OOP, Functional, Reflection, Code Generation, Modules & Package Management**  
> Bagian: **017**  
> Topik: **Optional, Nullability, Result Modeling, and Error Channels**  
> Status seri: **belum selesai**  
> Bagian berikutnya: **018 - Reflection Deep Dive I: Class Metadata, Members, Access, and Type Inspection**

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas functional interface dan higher-order API design. Sekarang kita masuk ke salah satu area yang paling sering terlihat kecil tetapi sangat menentukan kualitas sistem Java jangka panjang:

- bagaimana merepresentasikan **ketiadaan nilai**;
- bagaimana membedakan **tidak ada data**, **gagal**, **invalid**, **tidak berwenang**, **belum tersedia**, dan **tidak berlaku**;
- kapan memakai `null`;
- kapan memakai `Optional`;
- kapan memakai exception;
- kapan memakai sealed result type;
- bagaimana merancang error channel yang eksplisit, testable, dan tidak menipu caller;
- bagaimana nullability/error model berinteraksi dengan OOP, functional style, reflection, code generation, framework, serialization, dan module boundary.

Tujuan utama bagian ini bukan membuat semua method bebas `null` secara dogmatis. Tujuannya adalah membuat desain API yang jujur.

API yang baik menjawab pertanyaan berikut:

```text
Kalau saya memanggil method ini, apa saja kemungkinan hasilnya?

1. Berhasil dan menghasilkan nilai?
2. Berhasil tetapi tidak ada hasil?
3. Input tidak valid?
4. Resource tidak ditemukan?
5. Caller tidak punya permission?
6. Sistem eksternal gagal?
7. Terjadi bug/programmer error?
8. Kondisi domain menolak operasi?
```

Java memberi kita beberapa channel:

```text
value return
null
Optional<T>
empty collection
boolean/status code
exception
checked exception
unchecked exception
sealed result type
record result type
callback/error handler
framework-specific response wrapper
```

Engineer yang kuat tidak memilih berdasarkan gaya pribadi, tetapi berdasarkan **semantik**.

---

## 1. Mental Model: Absence Bukan Failure

Kesalahan paling umum adalah menyamakan semua kondisi “tidak ada nilai” dengan failure.

Padahal, ada banyak kategori berbeda:

| Kondisi | Contoh | Apakah error? | Representasi umum |
|---|---|---:|---|
| absent | user tidak punya middle name | Tidak | `Optional`, `null`, empty string tergantung boundary |
| not found | case id tidak ditemukan | Tergantung konteks | `Optional`, exception, 404 response |
| empty result | query tidak menemukan item | Tidak | empty collection/page |
| invalid input | date range terbalik | Ya, caller error | validation result / exception |
| forbidden | user tidak punya akses | Ya, authorization denial | exception / result / response error |
| conflict | state transition tidak legal | Domain rejection | domain result / exception |
| unavailable | external service timeout | Operational failure | exception / retryable result |
| bug | impossible branch terjadi | Programmer error | unchecked exception/assertion |

Top engineer membedakan minimal tiga hal:

```text
1. absence
   Nilai memang boleh tidak ada.

2. domain rejection
   Operasi diminta, tetapi domain menolak.

3. technical failure
   Operasi seharusnya bisa jalan, tetapi infrastruktur/runtime gagal.
```

Kalau semua disamakan menjadi `null`, caller kehilangan informasi.

Kalau semua disamakan menjadi exception, control flow menjadi bising dan sulit dikomposisi.

Kalau semua disamakan menjadi `Optional`, failure serius bisa tersembunyi seolah hanya “tidak ada data”.

---

## 2. `null`: Primitive Error Channel Paling Tua di Java

`null` adalah nilai khusus untuk reference type.

Ia bisa berarti:

```text
belum diset
optional field tidak ada
lookup tidak ketemu
cache miss
invalid state
framework belum inject dependency
bug
unknown
tidak berlaku
external payload field missing
```

Masalahnya: `null` tidak membawa alasan.

```java
Customer customer = repository.findById(id);

if (customer == null) {
    // Tidak ditemukan?
    // DB error disembunyikan?
    // Unauthorized?
    // Cache miss?
    // Bug repository?
}
```

`null` adalah representasi yang murah secara syntax, tetapi mahal secara reasoning.

---

## 3. Kapan `null` Masih Masuk Akal?

Walaupun banyak best practice mengatakan “avoid null”, production Java tidak mungkin sepenuhnya bebas `null`.

`null` masih masuk akal di beberapa boundary:

### 3.1 Internal field yang dikontrol ketat

Contoh lazy initialization sederhana:

```java
final class ReportTemplateCache {
    private volatile Map<String, Template> templates;

    Map<String, Template> templates() {
        Map<String, Template> current = templates;
        if (current == null) {
            synchronized (this) {
                current = templates;
                if (current == null) {
                    current = loadTemplates();
                    templates = current;
                }
            }
        }
        return current;
    }
}
```

Di sini `null` adalah implementation detail, bukan API contract.

Caller tidak pernah menerima `null`.

### 3.2 Interoperability dengan framework atau legacy API

Banyak library lama menggunakan `null` sebagai signal.

```java
String header = request.getHeader("X-Correlation-Id");
if (header == null || header.isBlank()) {
    header = correlationIdGenerator.newId();
}
```

Di sini penting untuk segera mengubah `null` dari external boundary menjadi model internal yang lebih jelas.

### 3.3 Performance-sensitive internal path

Kadang `null` dipakai di internal hot path untuk menghindari allocation.

Namun ini harus memenuhi syarat:

```text
- tidak keluar sebagai public API;
- documented secara internal;
- guarded oleh tests;
- caller setempat memahami invariant;
- tidak dipakai sebagai multi-meaning error channel.
```

### 3.4 Serialization/deserialization boundary

JSON/XML/protobuf/database payload sering punya konsep:

```text
field missing
field present null
field present empty
field present default
```

Saat masuk ke domain model, bedakan semantic ini secara eksplisit.

---

## 4. Kapan `null` Harus Dihindari?

Hindari `null` saat ia menjadi kontrak publik yang ambigu.

Buruk:

```java
Customer findCustomer(CustomerId id);
```

Caller tidak tahu:

```text
- return null kalau tidak ditemukan?
- throw exception kalau tidak ditemukan?
- return null kalau id null?
- return null kalau DB timeout?
```

Lebih jelas:

```java
Optional<Customer> findCustomer(CustomerId id);
```

atau:

```java
Customer getExistingCustomer(CustomerId id) throws CustomerNotFoundException;
```

atau:

```java
FindCustomerResult findCustomer(CustomerId id);
```

Yang penting bukan bentuknya, tetapi kontraknya jujur.

---

## 5. `Optional<T>`: Apa yang Ia Representasikan?

`Optional<T>` merepresentasikan hasil yang mungkin ada atau tidak ada.

Mental model:

```text
Optional<T> = value channel untuk “0 atau 1 value”
```

Contoh tepat:

```java
interface CustomerRepository {
    Optional<Customer> findById(CustomerId id);
}
```

Maknanya:

```text
Method berhasil melakukan lookup.
Hasilnya mungkin ada, mungkin tidak.
Tidak ditemukan bukan exceptional failure.
```

Contoh lain:

```java
Optional<EmailAddress> primaryEmailOf(Customer customer) {
    return customer.contacts().stream()
            .filter(Contact::primary)
            .map(Contact::email)
            .findFirst();
}
```

Di sini `Optional` cocok karena ketiadaan primary email adalah kondisi valid.

---

## 6. `Optional` Bukan General-Purpose Null Replacement

`Optional` sering disalahgunakan untuk semua tempat.

### 6.1 Jangan gunakan `Optional` sebagai field domain object secara default

Kurang ideal:

```java
public final class CustomerProfile {
    private final Optional<String> middleName;

    public CustomerProfile(Optional<String> middleName) {
        this.middleName = middleName;
    }
}
```

Masalah:

```text
- field bisa tetap null kalau constructor menerima null;
- serialization framework bisa bermasalah;
- domain object jadi bising;
- Optional menjadi bagian representation, bukan API result;
- JSON model bisa menjadi aneh.
```

Alternatif:

```java
public final class CustomerProfile {
    private final String middleName; // nullable internal, controlled

    public CustomerProfile(String middleName) {
        this.middleName = normalize(middleName);
    }

    public Optional<String> middleName() {
        return Optional.ofNullable(middleName);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}
```

Di sini `Optional` adalah API exposure, bukan field storage.

Namun ada trade-off. Kalau codebase punya strict rule “tidak ada nullable field”, bisa saja memakai custom value object:

```java
record MiddleName(String value) {
    MiddleName {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("middleName must not be blank");
        }
    }
}
```

Lalu field menjadi:

```java
private final MiddleName middleName; // nullable internally or represented via dedicated Absence type
```

Tidak ada jawaban universal. Yang penting konsisten dan explicit.

### 6.2 Jangan gunakan `Optional` sebagai parameter secara default

Kurang ideal:

```java
void updateCustomer(CustomerId id, Optional<EmailAddress> email) {
    ...
}
```

Caller menjadi janggal:

```java
service.updateCustomer(id, Optional.empty());
```

Lebih baik desain intent-specific:

```java
void updateEmail(CustomerId id, EmailAddress email);
void removeEmail(CustomerId id);
```

Atau untuk command object:

```java
sealed interface EmailUpdate permits SetEmail, RemoveEmail, KeepEmail {}

record SetEmail(EmailAddress email) implements EmailUpdate {}
record RemoveEmail() implements EmailUpdate {}
record KeepEmail() implements EmailUpdate {}
```

Ini lebih eksplisit daripada `Optional<EmailAddress>` karena membedakan:

```text
set value
remove value
leave unchanged
```

Dalam PATCH/update use case, `Optional` sering tidak cukup karena hanya punya dua state: present/absent. Banyak update semantics butuh tiga state.

```text
missing      -> do not change
present null -> clear value
present x    -> set value
```

`Optional<T>` tidak merepresentasikan tiga state itu dengan baik.

### 6.3 Jangan return `Optional<Collection<T>>`

Buruk:

```java
Optional<List<CaseItem>> findCases(Filter filter);
```

Lebih baik:

```java
List<CaseItem> findCases(Filter filter);
```

Makna empty list:

```text
Query berhasil, hasil 0 item.
```

`Optional<List<T>>` menciptakan dua level kosong:

```text
Optional.empty()
Optional.of(emptyList())
```

Kecuali ada semantik kuat:

```text
Optional.empty()     -> query tidak applicable
Optional.of(empty)   -> applicable, hasil kosong
```

Jika semantiknya memang begitu, lebih baik pakai result type bernama.

```java
sealed interface SearchAvailability permits SearchNotApplicable, SearchApplied {}

record SearchNotApplicable(String reason) implements SearchAvailability {}
record SearchApplied(List<CaseItem> items) implements SearchAvailability {}
```

---

## 7. `Optional.get()` Hampir Selalu Smell

Buruk:

```java
Customer customer = repository.findById(id).get();
```

Ini sama seperti `null` dereference versi baru.

Lebih baik:

```java
Customer customer = repository.findById(id)
        .orElseThrow(() -> new CustomerNotFoundException(id));
```

Atau:

```java
return repository.findById(id)
        .map(customer -> mapper.toResponse(customer))
        .orElseGet(() -> CustomerResponse.notFound(id));
```

`Optional` mendorong caller untuk menangani absence di titik yang tepat.

Kalau caller memang yakin value selalu ada, tanyakan:

```text
Mengapa type-nya Optional kalau secara invariant selalu present?
```

Mungkin method yang dipakai salah.

Contoh API yang lebih jelas:

```java
Optional<Customer> findById(CustomerId id);
Customer requireById(CustomerId id);
```

Implementation:

```java
Customer requireById(CustomerId id) {
    return findById(id).orElseThrow(() -> new CustomerNotFoundException(id));
}
```

---

## 8. `orElse` vs `orElseGet`

Perbedaan penting:

```java
Customer customer = optional.orElse(loadFallback());
```

`loadFallback()` dieksekusi sebelum `orElse`, bahkan kalau optional berisi value.

```java
Customer customer = optional.orElseGet(() -> loadFallback());
```

`loadFallback()` hanya dieksekusi ketika optional kosong.

Rule:

```text
Gunakan orElse untuk fallback murah dan sudah tersedia.
Gunakan orElseGet untuk fallback mahal, lazy, I/O, allocation besar, logging, metric, atau side effect.
```

Buruk:

```java
Customer customer = repository.findById(id)
        .orElse(auditAndCreateDefaultCustomer(id));
```

Lebih aman:

```java
Customer customer = repository.findById(id)
        .orElseGet(() -> auditAndCreateDefaultCustomer(id));
```

---

## 9. `map`, `flatMap`, dan Nested Optional

Contoh:

```java
Optional<Customer> customer = repository.findById(id);
Optional<EmailAddress> email = customer.map(Customer::email);
```

Kalau `Customer::email` mengembalikan `EmailAddress`, gunakan `map`.

Kalau method mengembalikan `Optional<EmailAddress>`, gunakan `flatMap`.

```java
Optional<EmailAddress> email = repository.findById(id)
        .flatMap(Customer::primaryEmail);
```

Tanpa `flatMap`, hasilnya menjadi:

```java
Optional<Optional<EmailAddress>>
```

Nested optional jarang tepat kecuali memang punya multi-level absence semantics.

---

## 10. Optional dan Exception: Jangan Menyembunyikan Failure

Salah:

```java
Optional<Customer> findById(CustomerId id) {
    try {
        return Optional.ofNullable(jdbcQuery(id));
    } catch (SQLException e) {
        return Optional.empty();
    }
}
```

Ini berbahaya karena:

```text
DB failure disamakan dengan customer tidak ditemukan.
Caller akan mengambil keputusan bisnis yang salah.
Monitoring kehilangan error.
Retry tidak terjadi.
Incident tersembunyi.
```

Lebih baik:

```java
Optional<Customer> findById(CustomerId id) {
    try {
        return Optional.ofNullable(jdbcQuery(id));
    } catch (SQLException e) {
        throw new CustomerRepositoryException("Failed to find customer " + id, e);
    }
}
```

Atau kalau ingin explicit technical failure:

```java
sealed interface RepositoryResult<T> permits Found, NotFound, RepositoryFailure {}

record Found<T>(T value) implements RepositoryResult<T> {}
record NotFound<T>() implements RepositoryResult<T> {}
record RepositoryFailure<T>(String message, Throwable cause) implements RepositoryResult<T> {}
```

Tetapi jangan gunakan `Optional.empty()` untuk menyembunyikan exception.

---

## 11. Empty Collection vs Optional

Untuk query multi-result:

```java
List<CaseItem> findOpenCases(OfficerId officerId);
```

Return empty list bila tidak ada item.

Jangan:

```java
Optional<List<CaseItem>> findOpenCases(OfficerId officerId);
```

Karena “tidak ada open case” adalah hasil valid.

Namun ada kondisi lain:

```text
Officer tidak ada.
Officer ada tetapi tidak punya akses.
Officer ada dan query berhasil tetapi hasil kosong.
```

Maka jangan paksa `List` menanggung semua makna.

Gunakan higher-level result:

```java
sealed interface FindOpenCasesResult permits OfficerNotFound, AccessDenied, OpenCasesFound {}

record OfficerNotFound(OfficerId officerId) implements FindOpenCasesResult {}
record AccessDenied(OfficerId officerId) implements FindOpenCasesResult {}
record OpenCasesFound(List<CaseItem> cases) implements FindOpenCasesResult {
    public OpenCasesFound {
        cases = List.copyOf(cases);
    }
}
```

Sekarang caller tidak menebak.

---

## 12. Exception sebagai Error Channel

Exception cocok untuk kondisi yang memutus normal control flow.

Namun ada dua kategori besar:

```text
programmer error
recoverable/domain/technical failure
```

### 12.1 Programmer error

Contoh:

```java
new Money(null, Currency.getInstance("USD"));
```

Ini bug caller.

Gunakan unchecked exception:

```java
record Money(BigDecimal amount, Currency currency) {
    Money {
        if (amount == null) {
            throw new IllegalArgumentException("amount must not be null");
        }
        if (currency == null) {
            throw new IllegalArgumentException("currency must not be null");
        }
    }
}
```

### 12.2 Domain rejection

Contoh:

```text
case CLOSED tidak bisa di-escalate
```

Ini bukan necessarily bug teknis. Ini keputusan domain.

Bisa pakai exception:

```java
void escalate(CaseId caseId) {
    Case c = repository.requireById(caseId);
    if (!c.canEscalate()) {
        throw new CaseTransitionNotAllowedException(caseId, c.status());
    }
    c.escalate();
}
```

Atau result:

```java
EscalationResult escalate(CaseId caseId);
```

Pemilihannya tergantung apakah denial adalah expected business path.

Kalau denial sering terjadi dan perlu ditampilkan sebagai pilihan UI normal, result type biasanya lebih baik.

Kalau denial adalah guard terhadap invalid command dari caller/internal bug, exception bisa lebih tepat.

### 12.3 Technical failure

Contoh:

```text
DB timeout
HTTP 503 dari external service
message broker unavailable
serialization error
```

Biasanya exception lebih tepat karena:

```text
- tidak bagian dari normal business result;
- perlu propagation;
- perlu logging/metrics;
- sering butuh retry/circuit breaker;
- menyimpan stack trace/cause.
```

Namun pada boundary tertentu, technical failure bisa diubah menjadi result untuk workflow engine.

```java
sealed interface ExternalScreeningResult permits ScreeningAccepted, ScreeningRejected, ScreeningUnavailable {}

record ScreeningAccepted(String referenceNo) implements ExternalScreeningResult {}
record ScreeningRejected(String reasonCode) implements ExternalScreeningResult {}
record ScreeningUnavailable(String system, String reason) implements ExternalScreeningResult {}
```

Ini cocok jika unavailability adalah bagian dari orchestration state.

---

## 13. Checked Exception vs Unchecked Exception

Java punya checked exception dan unchecked exception.

Checked exception memaksa caller men-declare atau menangani.

```java
interface DocumentStore {
    Document load(DocumentId id) throws IOException;
}
```

Kelebihan checked exception:

```text
- failure terlihat di signature;
- caller tidak bisa pura-pura tidak tahu;
- cocok untuk low-level API yang memang punya recoverable failure.
```

Kekurangan:

```text
- noisy di higher-level application code;
- buruk untuk lambda/function composition;
- sering dibungkus secara asal;
- sulit untuk generic abstraction.
```

Unchecked exception cocok untuk:

```text
- programmer error;
- invariant violation;
- framework/application-level failure propagation;
- technical failure yang tidak bisa dipulihkan lokal;
- domain exception yang ditangani oleh global error mapper.
```

Rule praktis:

```text
Gunakan checked exception hanya jika caller pada level itu realistis bisa recover secara lokal.
Jika caller hanya akan wrap/log/rethrow, unchecked sering lebih jujur.
```

Contoh kurang baik:

```java
interface CustomerRepository {
    Customer load(CustomerId id) throws SQLException;
}
```

Ini membocorkan detail persistence ke domain/application layer.

Lebih baik:

```java
interface CustomerRepository {
    Optional<Customer> findById(CustomerId id);
}
```

Implementation membungkus SQL exception:

```java
final class JdbcCustomerRepository implements CustomerRepository {
    @Override
    public Optional<Customer> findById(CustomerId id) {
        try {
            return queryCustomer(id);
        } catch (SQLException e) {
            throw new RepositoryAccessException("Failed to query customer", e);
        }
    }
}
```

---

## 14. Result Type: Membuat Outcome Eksplisit

Result type cocok saat sebuah operasi punya beberapa outcome yang valid dan perlu diproses oleh caller.

Contoh escalation:

```java
sealed interface EscalationResult permits EscalationAccepted, EscalationRejected, EscalationQueued {
}

record EscalationAccepted(CaseId caseId, OfficerId assignedTo) implements EscalationResult {
}

record EscalationRejected(CaseId caseId, String reasonCode, String message) implements EscalationResult {
}

record EscalationQueued(CaseId caseId, String queueName) implements EscalationResult {
}
```

Usage:

```java
EscalationResult result = service.escalate(command);

return switch (result) {
    case EscalationAccepted accepted -> Response.ok(toDto(accepted));
    case EscalationRejected rejected -> Response.badRequest(toDto(rejected));
    case EscalationQueued queued -> Response.accepted(toDto(queued));
};
```

Benefit:

```text
- outcome terlihat dari type;
- caller tidak perlu parse message;
- pattern matching bisa exhaustive;
- cocok untuk tests;
- cocok untuk business workflow;
- cocok untuk domain rejection yang expected;
- mengurangi exception sebagai normal control flow.
```

Kelemahan:

```text
- lebih banyak type;
- bisa overengineered untuk kasus sederhana;
- public API evolution harus hati-hati;
- serialization harus disepakati;
- terlalu banyak result class bisa membingungkan.
```

---

## 15. Result Type Generic: `Result<T, E>`

Kadang orang ingin membuat generic result:

```java
sealed interface Result<T, E> permits Success, Failure {
}

record Success<T, E>(T value) implements Result<T, E> {
}

record Failure<T, E>(E error) implements Result<T, E> {
}
```

Contoh:

```java
Result<Customer, FindCustomerError> result = customerFinder.find(id);
```

Ini berguna untuk library/internal functional style.

Namun dalam enterprise Java, domain-specific result sering lebih jelas.

Generic:

```java
Result<CaseEscalation, EscalationError>
```

Domain-specific:

```java
EscalationResult
```

Domain-specific biasanya lebih readable untuk workflow kompleks.

Generic result cocok jika:

```text
- digunakan di infrastructure/helper layer;
- error type tetap domain-specific;
- tim familiar dengan functional style;
- tidak dipakai untuk menyembunyikan semua exception;
- tidak menggantikan observability untuk technical failure.
```

Jangan membuat satu `Result` global yang semua error-nya string.

Buruk:

```java
record Failure(String code, String message) {}
```

Lebih baik:

```java
sealed interface EscalationError permits CaseNotFound, TransitionNotAllowed, AssigneeUnavailable {}

record CaseNotFound(CaseId caseId) implements EscalationError {}
record TransitionNotAllowed(CaseId caseId, CaseStatus currentStatus) implements EscalationError {}
record AssigneeUnavailable(OfficerId officerId) implements EscalationError {}
```

---

## 16. Validation Error Accumulation

Exception cocok untuk fail-fast.

Namun validation sering butuh mengumpulkan banyak error.

Buruk:

```java
void validate(CreateCaseCommand command) {
    if (command.title() == null) throw new ValidationException("title required");
    if (command.applicantId() == null) throw new ValidationException("applicant required");
    if (command.reason() == null) throw new ValidationException("reason required");
}
```

Caller hanya dapat satu error.

Lebih baik:

```java
record ValidationError(String field, String code, String message) {}

record ValidationResult(List<ValidationError> errors) {
    ValidationResult {
        errors = List.copyOf(errors);
    }

    boolean valid() {
        return errors.isEmpty();
    }

    static ValidationResult valid() {
        return new ValidationResult(List.of());
    }

    static ValidationResult invalid(List<ValidationError> errors) {
        return new ValidationResult(errors);
    }
}
```

Usage:

```java
ValidationResult validate(CreateCaseCommand command) {
    List<ValidationError> errors = new ArrayList<>();

    if (command.title() == null || command.title().isBlank()) {
        errors.add(new ValidationError("title", "REQUIRED", "Title is required"));
    }

    if (command.applicantId() == null) {
        errors.add(new ValidationError("applicantId", "REQUIRED", "Applicant is required"));
    }

    if (command.reason() == null || command.reason().isBlank()) {
        errors.add(new ValidationError("reason", "REQUIRED", "Reason is required"));
    }

    return errors.isEmpty()
            ? ValidationResult.valid()
            : ValidationResult.invalid(errors);
}
```

Lalu service:

```java
CreateCaseResult create(CreateCaseCommand command) {
    ValidationResult validation = validator.validate(command);
    if (!validation.valid()) {
        return new CreateCaseRejected(validation.errors());
    }

    Case c = Case.create(command);
    repository.save(c);
    return new CreateCaseAccepted(c.id());
}
```

---

## 17. Nullability Annotations

Java standard language tidak punya built-in non-null type system seperti beberapa bahasa modern.

Karena itu ekosistem Java memakai annotation:

```java
@NonNull
@Nullable
@NotNull
@CheckForNull
```

Masalahnya annotation tidak seragam antar library:

```text
- JetBrains annotations
- Checker Framework annotations
- Jakarta Validation
- JSpecify
- Spring nullability annotations
- Android annotations
- SpotBugs annotations
```

Nullability annotation berguna jika:

```text
- dipakai konsisten;
- dicek oleh IDE/static analyzer/build;
- boundary policy jelas;
- generated code mengikuti annotation;
- tidak hanya menjadi dokumentasi pasif.
```

Contoh:

```java
interface CustomerDirectory {
    Optional<Customer> findById(CustomerId id);

    @Nullable
    Customer findCachedOrNull(CustomerId id);
}
```

Nama method juga membantu. Jika method memang return nullable, beri sinyal.

```java
Customer findCachedOrNull(CustomerId id)
```

lebih jujur daripada:

```java
Customer find(CustomerId id)
```

---

## 18. Boundary Conversion: External Null ke Internal Model

Misalnya JSON request:

```json
{
  "title": "Escalate urgent case",
  "assigneeId": null
}
```

DTO:

```java
record EscalationRequestDto(String title, String assigneeId) {}
```

Jangan biarkan DTO nullability menyebar ke domain.

Mapping:

```java
CreateEscalationCommand toCommand(EscalationRequestDto dto) {
    return new CreateEscalationCommand(
            Title.parse(dto.title()),
            parseAssignee(dto.assigneeId())
    );
}

Optional<OfficerId> parseAssignee(String value) {
    if (value == null || value.isBlank()) {
        return Optional.empty();
    }
    return Optional.of(new OfficerId(value));
}
```

Boundary rule:

```text
DTO boleh merepresentasikan external messiness.
Domain model harus merepresentasikan business meaning.
```

---

## 19. Create/Update/Patch: Optional Sering Tidak Cukup

Create semantics:

```text
field required
field optional
field defaulted
```

Update/PATCH semantics:

```text
missing field -> keep current value
present null  -> clear value
present value -> update value
```

`Optional<T>` hanya punya dua state.

Untuk PATCH, buat tri-state.

```java
sealed interface PatchField<T> permits MissingField, NullField, ValueField {
}

record MissingField<T>() implements PatchField<T> {
}

record NullField<T>() implements PatchField<T> {
}

record ValueField<T>(T value) implements PatchField<T> {
    public ValueField {
        if (value == null) {
            throw new IllegalArgumentException("value must not be null");
        }
    }
}
```

Usage:

```java
record UpdateCustomerPatch(
        PatchField<String> displayName,
        PatchField<String> phoneNumber
) {}
```

Apply:

```java
Customer apply(Customer customer, UpdateCustomerPatch patch) {
    Customer updated = customer;

    updated = switch (patch.displayName()) {
        case MissingField<String> ignored -> updated;
        case NullField<String> ignored -> updated.clearDisplayName();
        case ValueField<String> value -> updated.changeDisplayName(value.value());
    };

    updated = switch (patch.phoneNumber()) {
        case MissingField<String> ignored -> updated;
        case NullField<String> ignored -> updated.clearPhoneNumber();
        case ValueField<String> value -> updated.changePhoneNumber(value.value());
    };

    return updated;
}
```

Ini jauh lebih jelas daripada `Optional<Optional<T>>`.

---

## 20. Domain Error Modeling

Domain error bukan sekadar string message.

String tidak cukup karena:

```text
- sulit diuji;
- sulit dilokalisasi;
- mudah typo;
- tidak membawa structured data;
- caller harus parse;
- API contract lemah.
```

Buruk:

```java
return Result.failure("Case cannot be escalated");
```

Lebih baik:

```java
sealed interface EscalationError permits CaseNotFound, CaseAlreadyClosed, OfficerUnavailable, MissingPermission {
}

record CaseNotFound(CaseId caseId) implements EscalationError {
}

record CaseAlreadyClosed(CaseId caseId, Instant closedAt) implements EscalationError {
}

record OfficerUnavailable(OfficerId officerId) implements EscalationError {
}

record MissingPermission(UserId userId, String permission) implements EscalationError {
}
```

Mapping ke response:

```java
ErrorResponse toResponse(EscalationError error) {
    return switch (error) {
        case CaseNotFound e -> new ErrorResponse("CASE_NOT_FOUND", "Case was not found");
        case CaseAlreadyClosed e -> new ErrorResponse("CASE_ALREADY_CLOSED", "Case is already closed");
        case OfficerUnavailable e -> new ErrorResponse("OFFICER_UNAVAILABLE", "Officer is unavailable");
        case MissingPermission e -> new ErrorResponse("MISSING_PERMISSION", "Permission is missing");
    };
}
```

Benefit:

```text
- internal domain model structured;
- external response stable;
- message localization possible;
- compiler membantu saat error type bertambah;
- no string parsing.
```

---

## 21. Technical Error Modeling

Technical error sebaiknya tetap mempertahankan cause.

Buruk:

```java
throw new RuntimeException("Failed");
```

Lebih baik:

```java
throw new RepositoryAccessException("Failed to load case " + caseId, e);
```

Custom exception:

```java
public final class RepositoryAccessException extends RuntimeException {
    public RepositoryAccessException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Jangan hilangkan stack trace/cause.

Buruk:

```java
catch (SQLException e) {
    throw new RepositoryAccessException("DB error", null);
}
```

Lebih buruk:

```java
catch (SQLException e) {
    return Optional.empty();
}
```

---

## 22. Exception Taxonomy untuk Sistem Besar

Dalam sistem besar, exception taxonomy perlu sederhana.

Contoh:

```text
ApplicationException
  BusinessRuleException
    CaseTransitionException
    PermissionDeniedException
  InfrastructureException
    RepositoryAccessException
    ExternalServiceException
    MessagePublishException
  ConfigurationException
  IntegrationContractException
```

Tetapi jangan membuat hierarchy terlalu dalam.

Rule:

```text
Exception type harus membantu decision.
Kalau tidak ada handler yang membedakan dua exception, mungkin tidak perlu dua type.
```

Contoh berguna:

```java
catch (ExternalServiceUnavailableException e) {
    retryLater(command);
}

catch (ExternalServiceRejectedException e) {
    markRejected(command, e.reasonCode());
}
```

Contoh tidak berguna:

```java
CustomerNameMissingException
CustomerPhoneMissingException
CustomerEmailMissingException
```

Jika semuanya diproses sebagai validation error, cukup `ValidationException` dengan list structured errors.

---

## 23. Error Code Design

Untuk API publik/internal antar service, error code penting.

Jangan jadikan message sebagai contract.

Buruk:

```json
{
  "message": "Case is already closed"
}
```

Lebih baik:

```json
{
  "code": "CASE_ALREADY_CLOSED",
  "message": "Case is already closed",
  "details": {
    "caseId": "C-1001",
    "status": "CLOSED"
  }
}
```

Error code harus:

```text
- stable;
- documented;
- tidak mengandung PII;
- tidak terlalu granular;
- tidak bergantung pada bahasa manusia;
- bisa dipakai client untuk branching;
- bisa dipakai metrics/alerting;
- bisa dimap ke HTTP/message status bila perlu.
```

Domain exception/result bisa membawa structured error code.

```java
interface DomainError {
    String code();
}
```

```java
record CaseAlreadyClosed(CaseId caseId, CaseStatus status) implements DomainError {
    @Override
    public String code() {
        return "CASE_ALREADY_CLOSED";
    }
}
```

---

## 24. Null Object Pattern

Null Object Pattern mengganti `null` dengan object yang punya behavior default.

Contoh:

```java
interface NotificationPreference {
    boolean emailEnabled();
    boolean smsEnabled();
}

final class NoNotificationPreference implements NotificationPreference {
    @Override
    public boolean emailEnabled() {
        return false;
    }

    @Override
    public boolean smsEnabled() {
        return false;
    }
}
```

Penggunaan:

```java
NotificationPreference preference = repository.findPreference(userId)
        .orElseGet(NoNotificationPreference::new);

if (preference.emailEnabled()) {
    sendEmail();
}
```

Cocok jika:

```text
- default behavior benar secara domain;
- caller tidak perlu tahu absence;
- tidak menyembunyikan missing configuration yang seharusnya error;
- object default tidak menyebabkan silent data loss.
```

Tidak cocok jika absence perlu terlihat.

Contoh buruk:

```java
Customer customer = repository.findById(id).orElse(Customer.guest());
processPayment(customer);
```

Kalau customer tidak ditemukan, memproses sebagai guest mungkin bug serius.

---

## 25. Functional Core, Imperative Shell untuk Error Handling

Di Part 014 kita membahas functional core.

Error channel bisa dibagi:

```text
Functional core:
- domain decision pure;
- return result/error structured;
- no DB/HTTP/logging side effect.

Imperative shell:
- load data;
- handle transaction;
- call external service;
- map exception;
- log/metric/audit;
- persist result.
```

Contoh:

```java
sealed interface TransitionDecision permits TransitionAllowed, TransitionDenied {}

record TransitionAllowed(CaseStatus nextStatus) implements TransitionDecision {}
record TransitionDenied(String reasonCode) implements TransitionDecision {}
```

Pure domain function:

```java
TransitionDecision decideEscalation(CaseStatus current, UserRole role) {
    if (current == CaseStatus.CLOSED) {
        return new TransitionDenied("CASE_CLOSED");
    }
    if (role != UserRole.SUPERVISOR) {
        return new TransitionDenied("INSUFFICIENT_ROLE");
    }
    return new TransitionAllowed(CaseStatus.ESCALATED);
}
```

Shell:

```java
EscalationResult escalate(EscalationCommand command) {
    Case c = repository.requireById(command.caseId());
    User user = userDirectory.requireById(command.userId());

    TransitionDecision decision = decideEscalation(c.status(), user.role());

    return switch (decision) {
        case TransitionDenied denied -> new EscalationRejected(c.id(), denied.reasonCode());
        case TransitionAllowed allowed -> {
            c.changeStatus(allowed.nextStatus());
            repository.save(c);
            audit.recordEscalation(c.id(), user.id());
            yield new EscalationAccepted(c.id());
        }
    };
}
```

Benefit:

```text
- domain decision mudah dites;
- side effect terkonsentrasi;
- error channel eksplisit;
- exception technical tetap di shell;
- audit/logging tidak bercampur dengan decision.
```

---

## 26. Reflection dan Nullability

Reflection melemahkan compiler guarantees.

Contoh:

```java
Constructor<Customer> ctor = Customer.class.getConstructor(String.class);
Customer customer = ctor.newInstance((Object) null);
```

Jika constructor tidak validate, object invalid bisa dibuat.

Framework juga sering:

```text
- set private field;
- instantiate no-arg constructor;
- bypass factory;
- populate nullable values;
- ignore Optional semantics;
- map missing field ke null.
```

Maka domain type harus tetap menjaga invariant di constructor/factory.

```java
record CustomerName(String value) {
    CustomerName {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Customer name is required");
        }
        value = value.trim();
    }
}
```

Reflection-friendly DTO boleh longgar, domain model jangan longgar.

---

## 27. Code Generation dan Error Channel

Generated code sering menghasilkan:

```text
- nullable getters;
- Optional getters;
- builder setters;
- validation annotations;
- checked exceptions;
- response wrappers;
- API clients yang return null on 404;
- API clients yang throw on non-2xx;
- enum UNKNOWN fallback.
```

Jangan menerima generated contract begitu saja sebagai domain contract.

Boundary adapter harus menormalisasi.

Generated client:

```java
ExternalCustomerDto dto = client.getCustomer(id); // maybe null
```

Adapter:

```java
Optional<Customer> findCustomer(CustomerId id) {
    try {
        ExternalCustomerDto dto = client.getCustomer(id.value());
        return Optional.ofNullable(dto).map(mapper::toDomain);
    } catch (ExternalNotFoundException e) {
        return Optional.empty();
    } catch (ExternalClientException e) {
        throw new ExternalDirectoryException("Failed to load customer " + id, e);
    }
}
```

Generated OpenAPI clients often expose transport semantics. Your domain/application API should expose business semantics.

---

## 28. JPMS/Module Boundary dan Error Types

Module boundary membuat API surface lebih nyata.

Jika package diekspor:

```java
module com.example.caseworkflow {
    exports com.example.caseworkflow.api;
}
```

Maka semua public type di package itu menjadi bagian contract.

Error/result type yang diekspor harus stabil.

Guideline:

```text
- export result/error types yang memang public API;
- keep internal exception/detail package unexported;
- jangan expose infrastructure exception dari API module;
- jangan expose generated DTO jika bukan contract stabil;
- buat mapper internal untuk translate internal failure ke public error.
```

Contoh:

```text
com.example.caseworkflow.api
  EscalationService
  EscalationCommand
  EscalationResult
  EscalationError

com.example.caseworkflow.internal
  JdbcCaseRepository
  RepositoryAccessException
  ExternalOfficerDirectoryClient
```

`RepositoryAccessException` tidak perlu keluar dari module API.

---

## 29. Decision Matrix: Pilih Representasi yang Tepat

| Situasi | Representasi yang biasanya tepat | Catatan |
|---|---|---|
| Single lookup, not found valid | `Optional<T>` | Jangan swallow technical exception |
| Multi-result query kosong | empty `List<T>`/`Set<T>`/page | Bukan `Optional<List<T>>` |
| Required argument invalid | `IllegalArgumentException` / validation result | Tergantung boundary |
| Constructor invariant gagal | unchecked exception | Fail fast |
| UI form validation | validation result dengan list errors | Accumulate errors |
| Domain operation ditolak secara expected | sealed result type | Cocok untuk workflow |
| Technical infrastructure failure | exception dengan cause | Jangan jadi Optional.empty |
| Caller bisa recover lokal | checked exception mungkin layak | Jarang di high-level app service |
| Method tidak applicable | domain-specific result | Jangan overload empty collection |
| PATCH tri-state | `PatchField<T>`/custom type | `Optional` tidak cukup |
| Default behavior valid | Null Object | Jangan sembunyikan error |
| Public API antar module/service | structured error code/result | Stable contract |

---

## 30. Anti-Pattern: `null` sebagai Semua Hal

Buruk:

```java
Case getCase(String id) {
    if (id == null) return null;
    try {
        Case c = query(id);
        if (c == null) return null;
        if (!hasAccess(c)) return null;
        return c;
    } catch (SQLException e) {
        return null;
    }
}
```

Empat kondisi disatukan:

```text
invalid input
not found
access denied
technical failure
```

Lebih jelas:

```java
sealed interface GetCaseResult permits GetCaseAccepted, GetCaseRejected {}

record GetCaseAccepted(Case value) implements GetCaseResult {}

sealed interface GetCaseRejected extends GetCaseResult permits InvalidCaseId, CaseNotFound, CaseAccessDenied {}

record InvalidCaseId(String rawValue) implements GetCaseRejected {}
record CaseNotFound(CaseId caseId) implements GetCaseRejected {}
record CaseAccessDenied(CaseId caseId, UserId userId) implements GetCaseRejected {}
```

Technical failure tetap exception:

```java
GetCaseResult getCase(String rawId, UserId userId) {
    Optional<CaseId> parsed = CaseId.tryParse(rawId);
    if (parsed.isEmpty()) {
        return new InvalidCaseId(rawId);
    }

    CaseId caseId = parsed.get();

    Optional<Case> found = repository.findById(caseId);
    if (found.isEmpty()) {
        return new CaseNotFound(caseId);
    }

    Case c = found.get();
    if (!policy.canView(userId, c)) {
        return new CaseAccessDenied(caseId, userId);
    }

    return new GetCaseAccepted(c);
}
```

Catatan: `parsed.get()` di sini aman secara lokal karena didahului check, tetapi bisa tetap diganti gaya `map/orElse` jika ingin lebih functional.

---

## 31. Anti-Pattern: Optional sebagai Error Suppression

Buruk:

```java
Optional<Address> resolveAddress(Postcode postcode) {
    try {
        return Optional.of(oneMapClient.resolve(postcode));
    } catch (Exception e) {
        return Optional.empty();
    }
}
```

Masalah:

```text
- postcode tidak ditemukan sama dengan OneMap down;
- caller tidak bisa retry;
- metrics error hilang;
- user dapat message salah;
- data quality menurun diam-diam.
```

Lebih baik:

```java
Optional<Address> resolveAddress(Postcode postcode) {
    try {
        return oneMapClient.resolve(postcode);
    } catch (OneMapNotFoundException e) {
        return Optional.empty();
    } catch (OneMapUnavailableException e) {
        throw new AddressResolutionUnavailableException("OneMap unavailable", e);
    }
}
```

Atau explicit:

```java
sealed interface AddressResolutionResult permits AddressResolved, AddressNotFound, AddressResolutionUnavailable {}

record AddressResolved(Address address) implements AddressResolutionResult {}
record AddressNotFound(Postcode postcode) implements AddressResolutionResult {}
record AddressResolutionUnavailable(Postcode postcode, String reason) implements AddressResolutionResult {}
```

Pilih berdasarkan apakah unavailability perlu menjadi workflow state atau exception.

---

## 32. Anti-Pattern: Throwing Exception untuk Normal Branch

Buruk jika ini normal flow:

```java
try {
    Customer c = repository.requireById(id);
    return toResponse(c);
} catch (CustomerNotFoundException e) {
    return Response.notFound();
}
```

Ini masih bisa diterima di controller boundary, tetapi kalau seluruh business flow memakai exception untuk branching normal, kode sulit dikomposisi.

Alternatif:

```java
return repository.findById(id)
        .map(this::toResponse)
        .orElseGet(Response::notFound);
```

Namun untuk command operation, result type bisa lebih baik:

```java
GetCustomerResult result = service.getCustomer(id);

return switch (result) {
    case CustomerFound found -> Response.ok(toDto(found.customer()));
    case CustomerNotFound notFound -> Response.notFound();
};
```

---

## 33. Anti-Pattern: Boolean Return untuk Rich Outcome

Buruk:

```java
boolean escalate(CaseId caseId);
```

Caller tidak tahu mengapa false.

Lebih baik:

```java
EscalationResult escalate(CaseId caseId);
```

Jika hanya guard sederhana:

```java
boolean canEscalate(Case c);
```

boleh, karena method hanya menjawab predicate.

Namun untuk operation yang melakukan perubahan state, boolean biasanya terlalu miskin.

---

## 34. Anti-Pattern: String Error Everywhere

Buruk:

```java
record Result(boolean success, String error) {}
```

Masalah:

```text
- tidak type-safe;
- no structured details;
- no exhaustiveness;
- caller parse string;
- localization kacau;
- refactor sulit.
```

Lebih baik:

```java
sealed interface SubmitApplicationResult permits SubmitApplicationAccepted, SubmitApplicationRejected {}

record SubmitApplicationAccepted(ApplicationId applicationId) implements SubmitApplicationResult {}

record SubmitApplicationRejected(List<ApplicationValidationError> errors) implements SubmitApplicationResult {
    public SubmitApplicationRejected {
        errors = List.copyOf(errors);
    }
}
```

---

## 35. API Naming untuk Absence dan Failure

Nama method harus memberi sinyal.

| Nama | Kontrak yang diharapkan |
|---|---|
| `findById` | boleh tidak ditemukan, biasanya `Optional<T>` |
| `getById` | ambigu, hindari kecuali convention jelas |
| `requireById` | harus ada, throw kalau tidak ada |
| `load` | bisa berarti I/O, mungkin throw |
| `tryParse` | tidak throw untuk invalid input, return `Optional`/result |
| `parse` | throw untuk invalid input |
| `canX` | predicate, boolean |
| `validate` | return validation result atau throw sesuai layer |
| `resolve` | bisa lookup/derive, clarify failure semantics |

Contoh bagus:

```java
Optional<Case> findById(CaseId id);
Case requireById(CaseId id);
Optional<CaseId> tryParseCaseId(String raw);
CaseId parseCaseId(String raw);
ValidationResult validate(CreateCaseCommand command);
EscalationResult escalate(EscalationCommand command);
```

Nama adalah bagian dari type contract.

---

## 36. Layering Guidance

### 36.1 Domain layer

Domain layer sebaiknya:

```text
- menjaga invariant dengan constructor/factory;
- tidak membiarkan object invalid;
- memakai value object;
- memakai result type untuk expected domain outcome;
- memakai exception untuk invariant/programmer error;
- tidak bergantung ke HTTP/SQL/framework error.
```

### 36.2 Application/service layer

Application layer:

```text
- orchestrate repository/external service;
- convert not found/access denied/domain denial;
- manage transaction;
- decide exception vs result for use case;
- map technical failures to application exceptions;
- record audit/metrics.
```

### 36.3 Infrastructure layer

Infrastructure layer:

```text
- handles SQL/HTTP/broker exceptions;
- preserves cause;
- translates infrastructure failure;
- converts external null/missing payload;
- does not leak low-level exception to domain API.
```

### 36.4 API/controller layer

API layer:

```text
- maps result/exception to HTTP/message response;
- stable error code;
- safe error message;
- no stack trace leakage;
- correlation id;
- validation response format.
```

---

## 37. End-to-End Example: Case Escalation

### 37.1 Command

```java
record EscalateCaseCommand(
        CaseId caseId,
        UserId requestedBy,
        Optional<OfficerId> preferredAssignee,
        String reason
) {
    EscalateCaseCommand {
        if (caseId == null) {
            throw new IllegalArgumentException("caseId must not be null");
        }
        if (requestedBy == null) {
            throw new IllegalArgumentException("requestedBy must not be null");
        }
        if (preferredAssignee == null) {
            throw new IllegalArgumentException("preferredAssignee must not be null");
        }
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("reason must not be blank");
        }
        reason = reason.trim();
    }
}
```

Note:

```text
Optional as record component here is debatable.
It can be acceptable for command/API internal model if team convention allows it.
Alternative: use PreferredAssignee sealed type.
```

Alternative:

```java
sealed interface AssigneePreference permits NoAssigneePreference, PreferredAssignee {}

record NoAssigneePreference() implements AssigneePreference {}
record PreferredAssignee(OfficerId officerId) implements AssigneePreference {
    PreferredAssignee {
        if (officerId == null) {
            throw new IllegalArgumentException("officerId must not be null");
        }
    }
}
```

### 37.2 Result

```java
sealed interface EscalateCaseResult permits EscalateCaseAccepted, EscalateCaseRejected {
}

record EscalateCaseAccepted(CaseId caseId, OfficerId assignedTo) implements EscalateCaseResult {
}

record EscalateCaseRejected(EscalateCaseError error) implements EscalateCaseResult {
}

sealed interface EscalateCaseError permits CaseNotFound, CaseNotEscalatable, AssigneeUnavailable, MissingEscalationPermission {
    String code();
}

record CaseNotFound(CaseId caseId) implements EscalateCaseError {
    @Override
    public String code() {
        return "CASE_NOT_FOUND";
    }
}

record CaseNotEscalatable(CaseId caseId, CaseStatus currentStatus) implements EscalateCaseError {
    @Override
    public String code() {
        return "CASE_NOT_ESCALATABLE";
    }
}

record AssigneeUnavailable(OfficerId officerId) implements EscalateCaseError {
    @Override
    public String code() {
        return "ASSIGNEE_UNAVAILABLE";
    }
}

record MissingEscalationPermission(UserId userId) implements EscalateCaseError {
    @Override
    public String code() {
        return "MISSING_ESCALATION_PERMISSION";
    }
}
```

### 37.3 Service

```java
final class EscalateCaseService {
    private final CaseRepository caseRepository;
    private final OfficerDirectory officerDirectory;
    private final EscalationPolicy escalationPolicy;
    private final AuditTrail auditTrail;

    EscalateCaseService(
            CaseRepository caseRepository,
            OfficerDirectory officerDirectory,
            EscalationPolicy escalationPolicy,
            AuditTrail auditTrail
    ) {
        this.caseRepository = Objects.requireNonNull(caseRepository);
        this.officerDirectory = Objects.requireNonNull(officerDirectory);
        this.escalationPolicy = Objects.requireNonNull(escalationPolicy);
        this.auditTrail = Objects.requireNonNull(auditTrail);
    }

    EscalateCaseResult escalate(EscalateCaseCommand command) {
        Case c = caseRepository.findById(command.caseId())
                .orElse(null);

        if (c == null) {
            return new EscalateCaseRejected(new CaseNotFound(command.caseId()));
        }

        if (!escalationPolicy.canEscalate(command.requestedBy(), c)) {
            return new EscalateCaseRejected(new MissingEscalationPermission(command.requestedBy()));
        }

        if (!c.canEscalate()) {
            return new EscalateCaseRejected(new CaseNotEscalatable(c.id(), c.status()));
        }

        OfficerId assignee = command.preferredAssignee()
                .orElseGet(() -> officerDirectory.defaultEscalationOfficer(c.category()));

        if (!officerDirectory.isAvailable(assignee)) {
            return new EscalateCaseRejected(new AssigneeUnavailable(assignee));
        }

        c.escalateTo(assignee, command.reason());
        caseRepository.save(c);
        auditTrail.recordEscalation(c.id(), command.requestedBy(), assignee);

        return new EscalateCaseAccepted(c.id(), assignee);
    }
}
```

This line is acceptable but stylistically mixed:

```java
Case c = caseRepository.findById(command.caseId()).orElse(null);
```

More explicit alternative:

```java
Optional<Case> found = caseRepository.findById(command.caseId());
if (found.isEmpty()) {
    return new EscalateCaseRejected(new CaseNotFound(command.caseId()));
}
Case c = found.orElseThrow();
```

Or functional style:

```java
return caseRepository.findById(command.caseId())
        .map(c -> escalateExistingCase(command, c))
        .orElseGet(() -> new EscalateCaseRejected(new CaseNotFound(command.caseId())));
```

For complex command flow, explicit imperative style is often more readable.

---

## 38. Testing Error Channels

Test not only success path.

### 38.1 Optional contract

```java
@Test
void findByIdReturnsEmptyWhenCaseDoesNotExist() {
    Optional<Case> found = repository.findById(new CaseId("missing"));

    assertTrue(found.isEmpty());
}
```

### 38.2 Technical failure not swallowed

```java
@Test
void findByIdThrowsWhenDatabaseFails() {
    simulateDatabaseDown();

    assertThrows(RepositoryAccessException.class,
            () -> repository.findById(new CaseId("C-1")));
}
```

### 38.3 Domain result branch

```java
@Test
void escalationRejectedWhenCaseClosed() {
    EscalateCaseResult result = service.escalate(commandForClosedCase());

    assertInstanceOf(EscalateCaseRejected.class, result);
    EscalateCaseRejected rejected = (EscalateCaseRejected) result;
    assertInstanceOf(CaseNotEscalatable.class, rejected.error());
}
```

### 38.4 Exhaustive mapping

```java
ErrorResponse response = mapper.toResponse(new CaseNotEscalatable(caseId, CaseStatus.CLOSED));

assertEquals("CASE_NOT_ESCALATABLE", response.code());
```

When new error type is added, sealed switch can force mapper update.

---

## 39. Observability Implications

Error modeling affects monitoring.

Bad pattern:

```java
catch (Exception e) {
    return Optional.empty();
}
```

Observability loss:

```text
- no error log;
- no metric;
- no trace error;
- no alert;
- no retry classification;
- incorrect business data.
```

Better:

```java
catch (OneMapUnavailableException e) {
    metrics.increment("address_resolution.unavailable");
    throw new AddressResolutionUnavailableException("Address service unavailable", e);
}
```

For result-modeled technical state:

```java
catch (OneMapUnavailableException e) {
    metrics.increment("address_resolution.unavailable");
    return new AddressResolutionUnavailable(postcode, "ONEMAP_UNAVAILABLE");
}
```

Either way, do not silently erase failure.

---

## 40. Practical Rules of Thumb

1. Use `Optional<T>` for successful computation with possible absence.
2. Do not use `Optional.empty()` to represent technical failure.
3. Return empty collection for successful multi-result query with no rows.
4. Use exception for invariant violation and technical failure unless workflow explicitly models the failure.
5. Use sealed result type for expected domain outcomes that caller must branch on.
6. Avoid `Optional` fields and parameters by default; use them intentionally, not habitually.
7. For PATCH/update tri-state, do not use plain `Optional<T>`.
8. Preserve exception cause.
9. Do not expose infrastructure exceptions through domain/application API.
10. Use structured error codes for service/API boundary.
11. Make error/result types stable if exported from module/public API.
12. Convert external nullability at boundary.
13. Keep domain objects valid after construction.
14. Use method names that reveal absence/failure semantics.
15. Test negative paths as first-class behavior.

---

## 41. Code Review Checklist

Saat review Java API, tanyakan:

```text
[ ] Apakah return null mungkin terjadi?
[ ] Jika ya, apakah terlihat dari nama/type/annotation?
[ ] Apakah Optional dipakai hanya untuk absence, bukan failure?
[ ] Apakah Optional digunakan sebagai field/parameter tanpa alasan kuat?
[ ] Apakah empty collection lebih tepat daripada Optional collection?
[ ] Apakah exception menyimpan cause?
[ ] Apakah technical failure tidak disamakan dengan not found?
[ ] Apakah domain rejection expected dimodelkan eksplisit?
[ ] Apakah validation perlu accumulate multiple errors?
[ ] Apakah error code stable dan tidak bergantung pada message?
[ ] Apakah API publik membocorkan SQL/HTTP/framework exception?
[ ] Apakah generated/external DTO nullability dinormalisasi?
[ ] Apakah module boundary mengekspor error type yang tepat?
[ ] Apakah method name sesuai kontrak?
[ ] Apakah tests mencakup absence, rejection, dan technical failure?
```

---

## 42. Kesimpulan

`null`, `Optional`, exception, empty collection, dan result type bukan sekadar style preference. Mereka adalah bagian dari desain kontrak.

Mental model utama:

```text
Absence is not failure.
Domain rejection is not always exception.
Technical failure must not be hidden.
Validation often needs accumulation.
Public API must make outcomes explicit.
```

Desain yang buruk membuat caller menebak.

Desain yang baik membuat caller tahu:

```text
apa yang mungkin terjadi,
apa yang harus ditangani,
apa yang exceptional,
dan apa yang merupakan business outcome normal.
```

Untuk menjadi engineer yang kuat di Java, jangan hanya menulis method yang “jalan”. Tulis method yang kontraknya jujur, stabil, dan sulit disalahgunakan.

---

## 43. Referensi Utama

- Java SE 25 API: `java.util.Optional`
- Java SE 25 API: `java.lang.Exception`, `Throwable`, `RuntimeException`
- Java Language Specification Java SE 25
- Oracle Java SE 25 documentation: pattern matching and sealed classes
- OpenJDK JEP 441: Pattern Matching for switch
- Java API design principles around records, sealed classes, and explicit result modeling

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Functional Interfaces and Higher-Order API Design](./learn-java-oop-functional-reflection-codegen-modules-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Reflection Deep Dive I: Class Metadata, Members, Access, and Type Inspection](./learn-java-oop-functional-reflection-codegen-modules-part-018.md)
