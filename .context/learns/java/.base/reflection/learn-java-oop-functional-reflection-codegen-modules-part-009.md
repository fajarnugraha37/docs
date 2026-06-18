# learn-java-oop-functional-reflection-codegen-modules-part-009

# Enums as Type-Safe State, Strategy, Registry, and Domain Model

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `009`  
> Fokus: memahami `enum` bukan sebagai “constant list” sederhana, tetapi sebagai bentuk type-safe finite model yang punya implikasi terhadap domain modeling, persistence, API evolution, strategy dispatch, state modeling, registry design, serialization, dan long-term maintainability.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas:

- object model,
- type system,
- class anatomy,
- equality/hash/immutability,
- encapsulation,
- inheritance,
- interface,
- sealed hierarchy,
- record.

Sekarang kita masuk ke `enum`.

Secara permukaan, enum terlihat sangat sederhana:

```java
enum Status {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Tapi di sistem besar, enum sering menjadi titik yang menentukan:

- apakah domain model stabil atau rapuh,
- apakah persistence aman atau mudah rusak,
- apakah workflow bisa berkembang,
- apakah API kompatibel dalam jangka panjang,
- apakah logic tersebar dalam `switch` di banyak tempat,
- apakah state machine bisa diverifikasi,
- apakah dependency antar module tetap bersih,
- apakah generated code/framework serialization tetap aman saat enum berubah.

Part ini bukan mengajarkan “cara membuat enum”. Itu terlalu dasar. Yang kita bahas adalah **kapan enum benar-benar model yang tepat**, bagaimana memakainya secara production-grade, dan kapan enum justru harus dihindari.

---

## 1. Mental Model Utama: Enum Adalah Closed Set of Named Singleton Values

`enum` di Java adalah class khusus yang mendefinisikan himpunan instance yang terbatas dan diketahui di compile time.

Contoh:

```java
public enum PaymentStatus {
    PENDING,
    PAID,
    FAILED,
    CANCELLED
}
```

Mental model yang lebih tepat:

```text
PaymentStatus is a type.
PENDING, PAID, FAILED, CANCELLED are the only allowed instances of that type.
Each constant is a singleton object.
The set of constants is closed by the enum declaration.
```

Jadi enum bukan sekadar `String` yang diketik lebih rapi.

Enum memberi kita beberapa properti penting:

1. **Type safety**  
   Method yang menerima `PaymentStatus` tidak bisa menerima sembarang string.

2. **Closed world**  
   Semua nilai legal diketahui dari source code enum.

3. **Identity stability inside JVM**  
   Setiap enum constant adalah singleton. Perbandingan dengan `==` valid.

4. **Compiler assistance**  
   `switch` terhadap enum bisa dicek lebih baik daripada string bebas.

5. **Efficient specialized collections**  
   `EnumSet` dan `EnumMap` sangat efisien karena enum punya ordinal internal.

6. **Named domain vocabulary**  
   Enum membuat vocabulary domain eksplisit.

Namun closed world ini sekaligus risiko:

```text
If the real domain set is not closed, enum may become architectural debt.
```

Jika daftar nilai berubah karena konfigurasi tenant, database master data, regulasi eksternal, atau integrasi pihak ketiga, enum bisa menjadi terlalu rigid.

---

## 2. Enum Bukan Sama Dengan Constant Class

Sebelum enum diperkenalkan di Java 5, developer sering memakai constant class:

```java
public final class PaymentStatuses {
    public static final String PENDING = "PENDING";
    public static final String PAID = "PAID";
    public static final String FAILED = "FAILED";

    private PaymentStatuses() {}
}
```

Masalahnya:

```java
void updateStatus(String status) {
    // accepts anything
}

updateStatus("PAID");
updateStatus("PADI");     // typo, compile-time still OK
updateStatus("HELLO");    // domain-invalid, compile-time still OK
```

Dengan enum:

```java
void updateStatus(PaymentStatus status) {
    // accepts only PaymentStatus
}

updateStatus(PaymentStatus.PAID);
```

Keuntungan enum:

- tidak bisa salah ketik value tanpa compiler error,
- tidak perlu manual validate value string di banyak tempat,
- refactoring lebih aman,
- IDE bisa membantu find usages,
- domain vocabulary lebih eksplisit,
- switch/case lebih kuat,
- bisa attach behavior ke value.

Namun enum bukan pengganti semua constant.

Constant tetap cocok untuk:

```java
public final class Headers {
    public static final String CORRELATION_ID = "X-Correlation-Id";
    public static final String IDEMPOTENCY_KEY = "Idempotency-Key";

    private Headers() {}
}
```

Karena HTTP header name bukan closed domain object dalam aplikasi kita. Header hanya literal protokol.

Rule awal:

```text
Use enum when the values represent a closed semantic domain.
Do not use enum merely to avoid string literals.
```

---

## 3. Bentuk Dasar Enum

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    WITHDRAWN
}
```

Enum bisa dipakai seperti ini:

```java
CaseStatus status = CaseStatus.SUBMITTED;

if (status == CaseStatus.SUBMITTED) {
    // safe identity comparison
}
```

Kenapa `==` aman?

Karena setiap enum constant adalah instance tunggal dari enum class tersebut di dalam class loader yang sama.

Tetap boleh memakai `equals`:

```java
if (CaseStatus.SUBMITTED.equals(status)) {
    // null-safe if constant is on the left
}
```

Tapi idiom enum biasanya memakai `==`:

```java
if (status == CaseStatus.SUBMITTED) {
    // idiomatic for enum
}
```

Dengan catatan: jika `status` bisa null, `==` tetap aman:

```java
if (status == CaseStatus.SUBMITTED) {
    // false if status is null
}
```

Sedangkan ini bisa `NullPointerException`:

```java
if (status.equals(CaseStatus.SUBMITTED)) {
    // NPE if status is null
}
```

---

## 4. Enum Adalah Class Khusus

Enum bisa memiliki:

- field,
- constructor,
- method,
- abstract method,
- implemented interface,
- constant-specific class body.

Contoh:

```java
public enum RiskLevel {
    LOW(1),
    MEDIUM(2),
    HIGH(3),
    CRITICAL(4);

    private final int severity;

    RiskLevel(int severity) {
        this.severity = severity;
    }

    public int severity() {
        return severity;
    }

    public boolean requiresManagerApproval() {
        return severity >= 3;
    }
}
```

Penggunaan:

```java
if (riskLevel.requiresManagerApproval()) {
    routeToManager(caseId);
}
```

Ini lebih baik daripada:

```java
if (riskLevel == RiskLevel.HIGH || riskLevel == RiskLevel.CRITICAL) {
    routeToManager(caseId);
}
```

Karena logic domain didekatkan ke value yang relevan.

Namun jangan terlalu cepat memasukkan semua logic ke enum. Nanti kita bahas batasnya.

---

## 5. Constructor Enum Selalu Private Secara Konseptual

Constructor enum tidak bisa public/protected.

```java
public enum Channel {
    EMAIL,
    SMS,
    PUSH;

    Channel() {
        // private by nature
    }
}
```

Kita tidak bisa membuat instance baru:

```java
new Channel(); // impossible
```

Ini inti dari enum:

```text
The enum declaration owns all possible instances.
No outside code can create additional enum values.
```

Implikasi desain:

- enum cocok untuk fixed vocabulary,
- enum tidak cocok untuk user-defined category,
- enum tidak cocok untuk tenant-specific configurable status,
- enum tidak cocok untuk external master data yang bisa berubah tanpa deploy.

---

## 6. `name()`, `toString()`, `ordinal()`: Jangan Salah Pakai

Setiap enum mewarisi dari `java.lang.Enum` dan punya method penting:

```java
status.name();
status.ordinal();
status.toString();
```

### 6.1 `name()`

`name()` mengembalikan nama constant persis seperti deklarasi:

```java
CaseStatus.SUBMITTED.name(); // "SUBMITTED"
```

`name()` bersifat final di `Enum`, tidak bisa dioverride.

`name()` cocok untuk:

- stable technical identifier,
- serialization internal yang dikontrol,
- logging teknis,
- mapping aman jika nama enum memang contract.

Tapi hati-hati: jika nama enum menjadi persisted value atau public API, maka rename enum adalah breaking change.

### 6.2 `toString()`

Default `toString()` biasanya sama dengan `name()`, tetapi bisa dioverride:

```java
public enum Priority {
    LOW("Low"),
    HIGH("High");

    private final String label;

    Priority(String label) {
        this.label = label;
    }

    @Override
    public String toString() {
        return label;
    }
}
```

Jangan gunakan `toString()` sebagai persisted technical value jika enum bisa override `toString()` untuk display label.

Bad:

```java
String dbValue = priority.toString();
```

Better:

```java
String dbValue = priority.code();
```

### 6.3 `ordinal()`

`ordinal()` adalah posisi enum constant berdasarkan urutan deklarasi, dimulai dari 0.

```java
CaseStatus.DRAFT.ordinal();      // 0
CaseStatus.SUBMITTED.ordinal();  // 1
```

Jangan persist `ordinal()`.

Kenapa?

Versi awal:

```java
public enum CaseStatus {
    DRAFT,       // 0
    SUBMITTED,   // 1
    APPROVED     // 2
}
```

Data lama menyimpan `2` sebagai `APPROVED`.

Lalu enum berubah:

```java
public enum CaseStatus {
    DRAFT,        // 0
    SUBMITTED,    // 1
    UNDER_REVIEW, // 2
    APPROVED      // 3
}
```

Data lama `2` sekarang dibaca sebagai `UNDER_REVIEW`. Ini corrupt secara silent.

Rule:

```text
Never persist enum ordinal for business data.
Use explicit stable code.
```

---

## 7. Stable Code Pattern Untuk Persistence dan External API

Untuk domain yang masuk database/API/event, gunakan explicit code.

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED"),
    WITHDRAWN("WITHDRAWN");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

Untuk enum kecil, loop cukup. Untuk enum sering di-parse, gunakan map.

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED"),
    WITHDRAWN("WITHDRAWN");

    private static final Map<String, CaseStatus> BY_CODE = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(CaseStatus::code, Function.identity()));

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        CaseStatus status = BY_CODE.get(code);
        if (status == null) {
            throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
        }
        return status;
    }
}
```

Namun ini punya masalah kecil: static field initialization order.

Enum constants dibuat lebih dulu, lalu static fields. Dalam pattern di atas aman karena `BY_CODE` dibuat setelah enum constants ada. Tapi jangan akses static map dari constructor enum.

Bad:

```java
public enum BadStatus {
    A("A"),
    B("B");

    private static final Map<String, BadStatus> BY_CODE = new HashMap<>();

    private final String code;

    BadStatus(String code) {
        this.code = code;
        BY_CODE.put(code, this); // unsafe: static field not initialized yet
    }
}
```

Better:

```java
private static final Map<String, GoodStatus> BY_CODE = Arrays.stream(values())
        .collect(Collectors.toUnmodifiableMap(GoodStatus::code, Function.identity()));
```

---

## 8. Fail-Fast vs Tolerant Parsing

Parsing enum dari external input punya dua mode:

1. **Fail-fast**: unknown code dianggap error.
2. **Tolerant**: unknown code direpresentasikan sebagai unknown/unsupported.

### 8.1 Fail-Fast Parsing

Cocok untuk internal domain invariant.

```java
public static CaseStatus fromCode(String code) {
    CaseStatus status = BY_CODE.get(code);
    if (status == null) {
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
    return status;
}
```

Gunakan saat:

- data seharusnya dikontrol aplikasi,
- unknown value berarti data corruption,
- lebih baik gagal cepat daripada lanjut salah.

### 8.2 Tolerant Parsing

Cocok untuk external API/event yang bisa menambah nilai baru.

```java
public static Optional<CaseStatus> findByCode(String code) {
    return Optional.ofNullable(BY_CODE.get(code));
}
```

Atau:

```java
public enum ExternalCaseStatus {
    OPEN("OPEN"),
    CLOSED("CLOSED"),
    UNKNOWN("UNKNOWN");

    private static final Map<String, ExternalCaseStatus> BY_CODE = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(ExternalCaseStatus::code, Function.identity()));

    private final String code;

    ExternalCaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static ExternalCaseStatus fromExternalCode(String code) {
        return BY_CODE.getOrDefault(code, UNKNOWN);
    }
}
```

Tapi `UNKNOWN` punya bahaya: original value hilang.

Kalau original value penting, enum mungkin bukan model terbaik. Gunakan wrapper:

```java
public record ExternalStatus(String rawCode, Optional<KnownStatus> knownStatus) {
    public static ExternalStatus parse(String rawCode) {
        return new ExternalStatus(rawCode, KnownStatus.findByCode(rawCode));
    }
}
```

Ini menjaga forward compatibility.

---

## 9. Enum Untuk State: Cocok, Tapi Jangan Salah Kaprah

Enum sering dipakai untuk state:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Ini baik sebagai vocabulary.

Tapi state machine bukan hanya daftar state. State machine punya:

- states,
- transitions,
- guards,
- commands/events,
- side effects,
- authorization,
- audit,
- timestamp,
- actor,
- reason,
- invariant.

Enum hanya merepresentasikan **state set**, bukan keseluruhan workflow.

Bad:

```java
if (status == DRAFT && action.equals("submit")) {
    status = SUBMITTED;
} else if (status == SUBMITTED && action.equals("approve")) {
    status = APPROVED;
} else if (status == SUBMITTED && action.equals("reject")) {
    status = REJECTED;
}
```

Lebih baik minimal punya transition policy:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED;

    public boolean canTransitionTo(ApplicationStatus target) {
        return switch (this) {
            case DRAFT -> target == SUBMITTED;
            case SUBMITTED -> target == UNDER_REVIEW || target == REJECTED;
            case UNDER_REVIEW -> target == APPROVED || target == REJECTED;
            case APPROVED, REJECTED -> false;
        };
    }
}
```

Ini cukup untuk workflow kecil.

Tapi untuk workflow kompleks, jangan masukkan semua logic ke enum.

Contoh workflow regulatory/case management biasanya punya:

- role-based guards,
- SLA,
- mandatory document checks,
- conditional route,
- agency-specific rule,
- appeal/reopen path,
- audit reason,
- integration callback,
- timer-based escalation.

Jika semua dimasukkan ke enum, enum menjadi god-object.

Better:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}

public enum ApplicationAction {
    SUBMIT,
    START_REVIEW,
    APPROVE,
    REJECT
}

public interface TransitionPolicy {
    boolean canApply(Application application, ApplicationAction action, User actor);

    ApplicationStatus targetStatus(Application application, ApplicationAction action, User actor);
}
```

Enum sebagai vocabulary, policy sebagai object terpisah.

Mental model:

```text
Enum is good for naming the states.
Policy object is better for non-trivial transition rules.
```

---

## 10. Enum Untuk Transition Matrix

Untuk workflow yang medium complexity, enum bisa dipakai bersama `EnumMap`/`EnumSet`.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    REVIEWING,
    APPROVED,
    REJECTED,
    CLOSED
}
```

```java
public final class CaseTransitions {
    private static final EnumMap<CaseStatus, EnumSet<CaseStatus>> ALLOWED = new EnumMap<>(CaseStatus.class);

    static {
        ALLOWED.put(CaseStatus.DRAFT, EnumSet.of(CaseStatus.SUBMITTED));
        ALLOWED.put(CaseStatus.SUBMITTED, EnumSet.of(CaseStatus.REVIEWING, CaseStatus.REJECTED));
        ALLOWED.put(CaseStatus.REVIEWING, EnumSet.of(CaseStatus.APPROVED, CaseStatus.REJECTED));
        ALLOWED.put(CaseStatus.APPROVED, EnumSet.of(CaseStatus.CLOSED));
        ALLOWED.put(CaseStatus.REJECTED, EnumSet.noneOf(CaseStatus.class));
        ALLOWED.put(CaseStatus.CLOSED, EnumSet.noneOf(CaseStatus.class));
    }

    private CaseTransitions() {}

    public static boolean canMove(CaseStatus from, CaseStatus to) {
        return ALLOWED.getOrDefault(from, EnumSet.noneOf(CaseStatus.class)).contains(to);
    }
}
```

Kelebihan:

- transition matrix centralized,
- efficient,
- readable,
- easy to test,
- enum tetap tidak terlalu gemuk.

Test:

```java
class CaseTransitionsTest {
    @Test
    void draftCanOnlyMoveToSubmitted() {
        assertTrue(CaseTransitions.canMove(CaseStatus.DRAFT, CaseStatus.SUBMITTED));
        assertFalse(CaseTransitions.canMove(CaseStatus.DRAFT, CaseStatus.APPROVED));
    }
}
```

Kalau state makin kompleks, pindahkan ke explicit state machine model.

---

## 11. Enum Sebagai Strategy

Enum bisa menjadi strategy jika behavior benar-benar melekat pada masing-masing constant.

Contoh sederhana:

```java
public enum FeeType {
    FIXED {
        @Override
        public Money calculate(Money base, BigDecimal rate) {
            return Money.of(rate);
        }
    },
    PERCENTAGE {
        @Override
        public Money calculate(Money base, BigDecimal rate) {
            return base.multiply(rate);
        }
    };

    public abstract Money calculate(Money base, BigDecimal rate);
}
```

Ini disebut constant-specific class body.

Kelebihan:

- tidak perlu switch tersebar,
- behavior dekat dengan constant,
- compiler memaksa semua constant implement method abstract.

Namun hati-hati.

Enum strategy buruk jika:

- behavior perlu dependency injection,
- behavior perlu database/repository,
- behavior berubah via konfigurasi,
- behavior berbeda per tenant,
- behavior perlu state mutable,
- behavior butuh observability/transaction boundary,
- behavior menjadi panjang dan kompleks.

Bad:

```java
public enum NotificationChannel {
    EMAIL {
        @Override
        void send(Message message) {
            // opens SMTP connection, reads config, retries, logs, etc.
        }
    },
    SMS {
        @Override
        void send(Message message) {
            // calls vendor API
        }
    }
}
```

Masalah:

- enum tidak cocok membawa infrastructure dependency,
- testing sulit,
- retry/logging/metrics bercampur,
- tidak cocok dengan DI container,
- environment config masuk ke domain vocabulary.

Better:

```java
public enum NotificationChannel {
    EMAIL,
    SMS,
    PUSH
}

public interface NotificationSender {
    NotificationChannel channel();

    void send(Message message);
}
```

```java
public final class NotificationDispatchService {
    private final Map<NotificationChannel, NotificationSender> senders;

    public NotificationDispatchService(List<NotificationSender> senderList) {
        this.senders = senderList.stream()
                .collect(Collectors.toUnmodifiableMap(NotificationSender::channel, Function.identity()));
    }

    public void send(NotificationChannel channel, Message message) {
        NotificationSender sender = senders.get(channel);
        if (sender == null) {
            throw new IllegalArgumentException("Unsupported channel: " + channel);
        }
        sender.send(message);
    }
}
```

Rule:

```text
Enum strategy is fine for pure, small, dependency-free behavior.
Use separate strategy objects for infrastructure or complex behavior.
```

---

## 12. Enum Sebagai Registry

Enum bisa dipakai sebagai registry kecil.

Contoh:

```java
public enum ReportType {
    CASE_SUMMARY("case-summary", "Case Summary"),
    REVENUE_SUMMARY("revenue-summary", "Revenue Summary"),
    SLA_BREACH("sla-breach", "SLA Breach");

    private static final Map<String, ReportType> BY_CODE = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(ReportType::code, Function.identity()));

    private final String code;
    private final String displayName;

    ReportType(String code, String displayName) {
        this.code = code;
        this.displayName = displayName;
    }

    public String code() {
        return code;
    }

    public String displayName() {
        return displayName;
    }

    public static Optional<ReportType> findByCode(String code) {
        return Optional.ofNullable(BY_CODE.get(code));
    }
}
```

Cocok jika:

- registry kecil,
- perubahan via deploy acceptable,
- semua value adalah code-owned,
- tidak ada tenant-specific configuration,
- tidak perlu CRUD admin.

Tidak cocok jika:

- business user harus bisa tambah report type,
- value berasal dari database master table,
- value tergantung agency/tenant,
- value punya lifecycle sendiri,
- value sering berubah tanpa release.

Dalam kasus itu, buat entity/reference-data model:

```java
public record ReportTypeRef(String code, String displayName, boolean active) {}
```

Atau database table:

```sql
report_type (
  code varchar primary key,
  display_name varchar not null,
  active boolean not null
)
```

---

## 13. Enum vs Lookup Table

Ini keputusan arsitektur penting.

| Pertanyaan | Jika jawabannya “ya” | Kemungkinan model |
|---|---:|---|
| Apakah value set fixed oleh code? | Ya | enum |
| Apakah business user bisa tambah value? | Ya | lookup table |
| Apakah value berubah tanpa deployment? | Ya | lookup table/config |
| Apakah value punya behavior compile-time? | Ya | enum/sealed |
| Apakah value punya metadata banyak dan lifecycle? | Ya | entity/reference table |
| Apakah external provider bisa menambah value? | Ya | wrapper/tolerant parser |
| Apakah switch exhaustiveness penting? | Ya | enum/sealed |
| Apakah value perlu localized label? | Biasanya | enum + message bundle atau lookup table |

Contoh enum yang tepat:

```java
public enum SortDirection {
    ASC,
    DESC
}
```

Karena sort direction secara konsep fixed.

Contoh lookup table yang lebih tepat:

```text
Business category
Agency-defined reason code
Document type configured per module
Product package managed by admin
```

Karena nilai-nilai itu bisa berubah sebagai data.

---

## 14. Enum vs Sealed Hierarchy

Enum cocok ketika tiap value relatif sama bentuknya.

```java
public enum Decision {
    APPROVE,
    REJECT,
    REQUEST_MORE_INFO
}
```

Tapi jika tiap variant membawa data berbeda, enum menjadi tidak cukup.

Bad:

```java
public enum DecisionType {
    APPROVE,
    REJECT,
    REQUEST_MORE_INFO
}

public record Decision(
        DecisionType type,
        String rejectionReason,
        LocalDate infoDueDate
) {}
```

Masalah:

- `rejectionReason` hanya valid untuk `REJECT`,
- `infoDueDate` hanya valid untuk `REQUEST_MORE_INFO`,
- object bisa masuk state invalid,
- invariant tersembunyi.

Better dengan sealed hierarchy:

```java
public sealed interface Decision permits Approve, Reject, RequestMoreInfo {
}

public record Approve() implements Decision {
}

public record Reject(String reason) implements Decision {
    public Reject {
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("reason is required");
        }
    }
}

public record RequestMoreInfo(LocalDate dueDate) implements Decision {
    public RequestMoreInfo {
        Objects.requireNonNull(dueDate, "dueDate");
    }
}
```

Rule:

```text
Use enum when variants have the same shape.
Use sealed hierarchy when variants have different data or behavior shape.
```

---

## 15. Enum vs Boolean Flags

Boolean flag sering bisa diganti enum agar model lebih eksplisit.

Bad:

```java
public record Approval(boolean approved) {}
```

Masalah:

- hanya dua nilai sekarang, tapi domain mungkin punya more states,
- `false` tidak menjelaskan apakah rejected, pending, cancelled, expired,
- future evolution sulit.

Better:

```java
public enum ApprovalDecision {
    APPROVED,
    REJECTED,
    PENDING
}
```

Atau sealed jika tiap decision punya data:

```java
public sealed interface ApprovalDecision permits Approved, Rejected, Pending {
}

public record Approved(String approverId) implements ApprovalDecision {}
public record Rejected(String reason) implements ApprovalDecision {}
public record Pending() implements ApprovalDecision {}
```

Rule:

```text
If boolean name requires domain explanation, consider enum.
If enum variants require different payloads, consider sealed hierarchy.
```

---

## 16. EnumSet: Specialized Set Untuk Enum

Jangan gunakan `HashSet<EnumType>` untuk enum set kecuali ada alasan kuat.

Gunakan `EnumSet`.

```java
EnumSet<CaseStatus> terminalStatuses = EnumSet.of(
        CaseStatus.APPROVED,
        CaseStatus.REJECTED,
        CaseStatus.CLOSED
);
```

`EnumSet` didesain khusus untuk enum type. Secara implementasi, ia bisa sangat compact karena enum punya ordinal.

Contoh:

```java
public enum Permission {
    VIEW,
    CREATE,
    UPDATE,
    DELETE,
    APPROVE,
    EXPORT
}
```

```java
EnumSet<Permission> reviewerPermissions = EnumSet.of(
        Permission.VIEW,
        Permission.UPDATE,
        Permission.APPROVE
);

if (reviewerPermissions.contains(Permission.APPROVE)) {
    // allowed
}
```

Kelebihan:

- lebih efisien dari HashSet,
- readable,
- type-safe,
- mendukung operasi set.

Contoh operasi:

```java
EnumSet<Permission> all = EnumSet.allOf(Permission.class);
EnumSet<Permission> none = EnumSet.noneOf(Permission.class);
EnumSet<Permission> write = EnumSet.of(Permission.CREATE, Permission.UPDATE, Permission.DELETE);
EnumSet<Permission> readOnly = EnumSet.complementOf(write);
```

Hati-hati:

`EnumSet` mutable.

```java
private static final EnumSet<Permission> ADMIN = EnumSet.allOf(Permission.class);
```

Jika expose langsung:

```java
public static EnumSet<Permission> adminPermissions() {
    return ADMIN; // bad: caller can mutate
}
```

Better:

```java
public static Set<Permission> adminPermissions() {
    return Set.copyOf(ADMIN);
}
```

Atau:

```java
public static EnumSet<Permission> adminPermissions() {
    return EnumSet.copyOf(ADMIN);
}
```

Rule:

```text
Use EnumSet internally for efficient enum sets.
Do not expose mutable EnumSet as shared state.
```

---

## 17. EnumMap: Specialized Map Untuk Enum Key

Gunakan `EnumMap` ketika key adalah enum.

```java
EnumMap<CaseStatus, String> labels = new EnumMap<>(CaseStatus.class);
labels.put(CaseStatus.DRAFT, "Draft");
labels.put(CaseStatus.SUBMITTED, "Submitted");
```

Contoh transition matrix:

```java
private static final EnumMap<CaseStatus, EnumSet<CaseStatus>> ALLOWED = new EnumMap<>(CaseStatus.class);
```

Contoh handler registry:

```java
public enum ExportFormat {
    CSV,
    XLSX,
    PDF
}

public interface Exporter {
    ExportFormat format();

    byte[] export(Report report);
}

public final class Exporters {
    private final EnumMap<ExportFormat, Exporter> byFormat;

    public Exporters(List<Exporter> exporters) {
        this.byFormat = new EnumMap<>(ExportFormat.class);
        for (Exporter exporter : exporters) {
            Exporter previous = byFormat.put(exporter.format(), exporter);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate exporter for " + exporter.format());
            }
        }
    }

    public Exporter get(ExportFormat format) {
        Exporter exporter = byFormat.get(format);
        if (exporter == null) {
            throw new IllegalArgumentException("No exporter for " + format);
        }
        return exporter;
    }
}
```

Kelebihan:

- compact,
- fast,
- enum-aware,
- iteration order follows enum declaration order.

Hati-hati:

- `EnumMap` mutable,
- key tidak boleh null,
- value bisa null tapi sebaiknya dihindari,
- enum declaration order dapat memengaruhi iteration order.

---

## 18. Switch Dengan Enum

Enum sering dipakai dengan switch.

```java
public String label(CaseStatus status) {
    return switch (status) {
        case DRAFT -> "Draft";
        case SUBMITTED -> "Submitted";
        case UNDER_REVIEW -> "Under review";
        case APPROVED -> "Approved";
        case REJECTED -> "Rejected";
        case WITHDRAWN -> "Withdrawn";
    };
}
```

Switch expression membantu menghindari fall-through dan memaksa expression menghasilkan value.

### 18.1 Jangan Terlalu Cepat Tambah `default`

Dalam switch enum internal, `default` bisa menurunkan exhaustiveness checking.

Kurang ideal:

```java
return switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    default -> "Other";
};
```

Jika nanti enum ditambah `APPROVED`, compiler mungkin tidak memaksa Anda update logic.

Better untuk internal exhaustive mapping:

```java
return switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    case APPROVED -> "Approved";
    case REJECTED -> "Rejected";
};
```

Untuk external compatibility, default bisa valid, tapi buat eksplisit:

```java
return switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    case APPROVED -> "Approved";
    case REJECTED -> "Rejected";
    case UNKNOWN -> "Unknown";
};
```

Atau jika memang forward-compatible:

```java
return switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    default -> throw new UnsupportedOperationException("Unsupported status: " + status);
};
```

Tapi ini tetap harus dipakai sadar.

Rule:

```text
For internal closed domain, prefer exhaustive switch without default.
For external/open domain, model unknown explicitly or fail loudly.
```

---

## 19. Switch Tersebar Adalah Smell

Enum sering menyebabkan switch tersebar:

```java
switch (status) { ... } // in service A
switch (status) { ... } // in service B
switch (status) { ... } // in mapper C
switch (status) { ... } // in validator D
switch (status) { ... } // in UI adapter E
```

Masalah:

- perubahan enum butuh update banyak tempat,
- logic domain tersebar,
- invariant sulit diverifikasi,
- test coverage fragmentasi,
- ada risiko behavior tidak konsisten.

Tidak semua switch buruk. Switch buruk jika ia merepresentasikan behavior domain yang sama secara tersebar.

Contoh switch yang wajar:

```java
public String displayLabel(CaseStatus status) {
    return switch (status) {
        case DRAFT -> "Draft";
        case SUBMITTED -> "Submitted";
        case APPROVED -> "Approved";
        case REJECTED -> "Rejected";
    };
}
```

Contoh switch smell:

```java
public boolean canEdit(CaseStatus status) { ... }
public boolean canSubmit(CaseStatus status) { ... }
public boolean canWithdraw(CaseStatus status) { ... }
public boolean shouldNotifyOfficer(CaseStatus status) { ... }
public Queue routeQueue(CaseStatus status) { ... }
```

Jika banyak behavior tergantung status, pertimbangkan:

- enum method,
- transition policy,
- state object,
- sealed hierarchy,
- rule engine/configuration,
- state machine table.

---

## 20. Enum Method vs External Policy

Pertanyaan utama:

```text
Should behavior live inside the enum or outside the enum?
```

### Behavior Cocok Di Enum Jika

- pure,
- kecil,
- stable,
- tidak butuh dependency,
- benar-benar intrinsic terhadap value,
- tidak berbeda per tenant/context.

Contoh:

```java
public enum CaseStatus {
    DRAFT(false),
    SUBMITTED(false),
    APPROVED(true),
    REJECTED(true);

    private final boolean terminal;

    CaseStatus(boolean terminal) {
        this.terminal = terminal;
    }

    public boolean isTerminal() {
        return terminal;
    }
}
```

### Behavior Lebih Baik Di Policy Jika

- butuh repository,
- butuh user role,
- butuh current date/time,
- butuh feature flag,
- butuh tenant configuration,
- butuh external service,
- kompleks dan berubah sering.

Contoh:

```java
public final class CaseEditPolicy {
    public boolean canEdit(Case c, User user, Clock clock) {
        if (c.status().isTerminal()) {
            return false;
        }
        if (!user.hasPermission(Permission.EDIT_CASE)) {
            return false;
        }
        return !c.isLockedAt(clock.instant());
    }
}
```

Rule:

```text
Enum owns intrinsic stable facts.
Policy owns contextual business decisions.
```

---

## 21. Enum Untuk Domain Vocabulary

Enum sangat baik untuk menciptakan vocabulary.

Contoh buruk dengan string:

```java
caseRecord.setType("COMPLIANCE");
caseRecord.setPriority("HIGH");
caseRecord.setSource("INTERNET");
```

Better:

```java
caseRecord.setType(CaseType.COMPLIANCE);
caseRecord.setPriority(Priority.HIGH);
caseRecord.setSource(CaseSource.INTERNET);
```

Keuntungan:

- compiler menjaga value legal,
- method signature lebih jelas,
- code search lebih mudah,
- refactor lebih aman,
- domain terms lebih eksplisit.

Namun jangan membuat enum untuk vocabulary yang belum stabil.

Contoh bahaya:

```java
public enum DocumentType {
    ID_CARD,
    PASSPORT,
    BANK_STATEMENT,
    UTILITY_BILL,
    OTHER
}
```

Jika document type dikelola oleh admin/regulator dan bisa bertambah setiap bulan, enum akan memaksa deployment untuk perubahan data.

Better:

```java
public record DocumentTypeCode(String value) {
    public DocumentTypeCode {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Document type code is required");
        }
    }
}
```

Atau reference table.

---

## 22. Enum `OTHER` Adalah Sinyal Desain

Enum sering punya `OTHER`:

```java
public enum ReasonType {
    DUPLICATE,
    INCOMPLETE,
    INVALID,
    OTHER
}
```

`OTHER` tidak selalu buruk. Tapi sering menjadi tanda bahwa domain sebenarnya open-ended.

Pertanyaan:

- Apakah `OTHER` perlu free-text description?
- Apakah `OTHER` sering dipakai?
- Apakah `OTHER` punya subcategories?
- Apakah report butuh breakdown `OTHER`?
- Apakah business ingin tambah reason tanpa deploy?

Jika iya, enum mungkin salah.

Better:

```java
public record RejectionReason(String code, String description) {}
```

Atau:

```java
public sealed interface RejectionReason permits KnownReason, OtherReason {
}

public record KnownReason(RejectionReasonCode code) implements RejectionReason {}

public record OtherReason(String description) implements RejectionReason {
    public OtherReason {
        if (description == null || description.isBlank()) {
            throw new IllegalArgumentException("description is required");
        }
    }
}
```

---

## 23. Enum dan Persistence: JPA/Hibernate Caveat Tanpa Masuk JDBC/JPA Detail

Walaupun seri ini bukan JPA, enum sering masuk database melalui ORM.

Dua mode umum:

```java
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

dan:

```java
@Enumerated(EnumType.STRING)
private CaseStatus status;
```

`ORDINAL` berbahaya untuk business data karena reordering/inserting enum constant bisa corrupt data.

`STRING` lebih aman daripada ordinal, tetapi rename enum constant tetap breaking terhadap data.

Production-grade approach biasanya memakai explicit code converter.

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

DB menyimpan `code`, bukan ordinal.

Aturan penting:

```text
Database value is a long-lived contract.
Enum constant name is source-code detail unless you intentionally make it contract.
```

Jika nama constant memang dijadikan contract, jangan rename sembarangan.

---

## 24. Enum dan JSON/API Contract

Enum di JSON biasanya muncul sebagai string:

```json
{
  "status": "SUBMITTED"
}
```

Jika API consumer bergantung pada value ini, enum name menjadi public contract.

Risiko:

- rename enum constant breaking,
- remove enum constant breaking,
- add enum constant bisa breaking untuk client yang tidak tolerant,
- casing berubah breaking,
- display label tercampur technical code.

Better:

```java
public enum CaseStatus {
    DRAFT("draft"),
    SUBMITTED("submitted"),
    APPROVED("approved"),
    REJECTED("rejected");

    private final String apiValue;

    CaseStatus(String apiValue) {
        this.apiValue = apiValue;
    }

    public String apiValue() {
        return apiValue;
    }
}
```

Namun jika menggunakan framework JSON, pastikan mapping eksplisit dan test contract-nya.

API evolution checklist:

- Apakah enum value documented?
- Apakah clients harus handle unknown value?
- Apakah `UNKNOWN` diperlukan?
- Apakah enum value case-sensitive?
- Apakah enum value akan dipakai di analytics/report?
- Apakah enum value akan disimpan downstream?
- Apakah rename diizinkan?

Untuk public API, treat enum value like schema contract.

---

## 25. Enum dan Event Contract

Event lebih sensitif daripada synchronous API karena:

- event bisa disimpan lama,
- consumer bisa tertinggal versi,
- replay bisa terjadi setelah enum berubah,
- unknown enum value bisa mematikan consumer.

Bad event schema:

```json
{
  "eventType": "CASE_STATUS_CHANGED",
  "newStatus": "APPROVED"
}
```

Ini tidak selalu buruk, tapi harus jelas governance-nya.

Pertanyaan:

- Jika producer menambah status baru, consumer lama bagaimana?
- Apakah consumer harus ignore unknown?
- Apakah unknown status disimpan raw?
- Apakah status punya semantic version?
- Apakah event schema punya compatibility rule?

Tolerant event model:

```java
public record CaseStatusChangedEvent(
        String caseId,
        String oldStatusCode,
        String newStatusCode
) {}
```

Domain layer bisa parse:

```java
Optional<CaseStatus> known = CaseStatus.findByCode(event.newStatusCode());
```

Ini menjaga raw code tetap ada walaupun aplikasi belum mengenal status baru.

Trade-off:

- kehilangan type safety di boundary,
- tapi lebih forward-compatible.

Pattern:

```text
Inside bounded context: enum.
Across independently versioned boundary: stable string code + tolerant parser.
```

---

## 26. Enum dan Localization

Jangan jadikan enum sebagai tempat label multi-language hardcoded.

Bad:

```java
public enum CaseStatus {
    DRAFT("Draft", "Draf"),
    SUBMITTED("Submitted", "Diajukan");

    private final String englishLabel;
    private final String indonesianLabel;
}
```

Masalah:

- enum berubah saat ada bahasa baru,
- domain tercampur presentation,
- label update perlu deploy,
- label bisa berbeda per channel/tenant.

Better:

```java
public enum CaseStatus {
    DRAFT("case.status.draft"),
    SUBMITTED("case.status.submitted");

    private final String messageKey;

    CaseStatus(String messageKey) {
        this.messageKey = messageKey;
    }

    public String messageKey() {
        return messageKey;
    }
}
```

Lalu presentation layer resolve message key.

Atau untuk fully configurable label, gunakan lookup table.

---

## 27. Enum dan Ordering

Kadang enum punya urutan bisnis.

Bad:

```java
if (priority.ordinal() >= Priority.HIGH.ordinal()) {
    escalate();
}
```

Ini fragile karena ordinal tergantung urutan deklarasi.

Better:

```java
public enum Priority {
    LOW(10),
    MEDIUM(20),
    HIGH(30),
    CRITICAL(40);

    private final int rank;

    Priority(int rank) {
        this.rank = rank;
    }

    public boolean atLeast(Priority other) {
        return this.rank >= other.rank;
    }
}
```

Penggunaan:

```java
if (priority.atLeast(Priority.HIGH)) {
    escalate();
}
```

Rule:

```text
Use explicit rank for business ordering.
Do not use ordinal as business meaning.
```

---

## 28. Enum dan Comparison

Enum secara natural comparable berdasarkan ordinal karena `Enum` implements `Comparable`.

```java
Priority.HIGH.compareTo(Priority.LOW) > 0
```

Tapi ini tetap ordinal-based. Jika ordering adalah domain contract, lebih aman explicit rank.

```java
public int compareBusinessPriority(Priority other) {
    return Integer.compare(this.rank, other.rank);
}
```

Atau comparator:

```java
Comparator<Priority> byRank = Comparator.comparingInt(Priority::rank);
```

Jangan biarkan deklarasi order enum menjadi accidental business rule tanpa dokumentasi.

---

## 29. Enum Constant-Specific Class Body

Enum bisa membuat behavior berbeda per constant:

```java
public enum DiscountPolicy {
    NONE {
        @Override
        public Money apply(Money amount) {
            return amount;
        }
    },
    TEN_PERCENT {
        @Override
        public Money apply(Money amount) {
            return amount.multiply(new BigDecimal("0.90"));
        }
    },
    HALF_PRICE {
        @Override
        public Money apply(Money amount) {
            return amount.multiply(new BigDecimal("0.50"));
        }
    };

    public abstract Money apply(Money amount);
}
```

Ini bagus jika:

- jumlah constant kecil,
- behavior simple,
- behavior pure,
- tidak perlu DI,
- tidak perlu state mutable.

Namun ada konsekuensi:

- enum source bisa panjang,
- testing per constant harus jelas,
- sulit mengganti behavior runtime,
- constant-specific anonymous subclass bisa memengaruhi reflection/class metadata,
- framework tertentu mungkin punya asumsi sederhana terhadap enum.

Alternatif:

```java
public enum DiscountType {
    NONE,
    TEN_PERCENT,
    HALF_PRICE
}

public interface DiscountCalculator {
    DiscountType type();

    Money apply(Money amount);
}
```

Rule:

```text
Use constant-specific enum body for small intrinsic algorithms.
Use strategy classes for application behavior.
```

---

## 30. Enum Implementing Interface

Enum bisa implement interface.

```java
public interface CodedEnum {
    String code();
}

public enum CaseStatus implements CodedEnum {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    @Override
    public String code() {
        return code;
    }
}
```

Ini berguna untuk generic helper:

```java
public final class EnumCodes {
    private EnumCodes() {}

    public static <E extends Enum<E> & CodedEnum> Optional<E> findByCode(
            Class<E> enumType,
            String code
    ) {
        return Arrays.stream(enumType.getEnumConstants())
                .filter(e -> e.code().equals(code))
                .findFirst();
    }
}
```

Penggunaan:

```java
Optional<CaseStatus> status = EnumCodes.findByCode(CaseStatus.class, "SUBMITTED");
```

Namun jangan terlalu abstrak.

Generic enum utility bisa berguna, tetapi bisa juga menyembunyikan domain-specific error handling.

Misalnya:

```java
throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
```

lebih informatif daripada:

```java
throw new IllegalArgumentException("Unknown enum code: " + code);
```

---

## 31. Generic Coded Enum Pattern Dengan Cache

Untuk banyak enum dengan code, bisa buat helper reusable.

```java
public interface CodeEnum {
    String code();
}
```

```java
public final class CodeEnumLookup<E extends Enum<E> & CodeEnum> {
    private final Class<E> enumType;
    private final Map<String, E> byCode;

    private CodeEnumLookup(Class<E> enumType) {
        this.enumType = Objects.requireNonNull(enumType, "enumType");
        this.byCode = Arrays.stream(enumType.getEnumConstants())
                .collect(Collectors.toUnmodifiableMap(CodeEnum::code, Function.identity()));
    }

    public static <E extends Enum<E> & CodeEnum> CodeEnumLookup<E> of(Class<E> enumType) {
        return new CodeEnumLookup<>(enumType);
    }

    public E require(String code) {
        E value = byCode.get(code);
        if (value == null) {
            throw new IllegalArgumentException(
                    "Unknown " + enumType.getSimpleName() + " code: " + code
            );
        }
        return value;
    }

    public Optional<E> find(String code) {
        return Optional.ofNullable(byCode.get(code));
    }
}
```

Penggunaan:

```java
public enum CaseStatus implements CodeEnum {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED");

    private static final CodeEnumLookup<CaseStatus> LOOKUP = CodeEnumLookup.of(CaseStatus.class);

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    @Override
    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        return LOOKUP.require(code);
    }
}
```

Pertimbangan:

- helper mengurangi boilerplate,
- tetapi jangan sampai semua enum dipaksa punya `code`,
- error semantics tetap harus domain-aware,
- duplicate code harus fail saat class initialization.

---

## 32. Duplicate Code Detection

`Collectors.toUnmodifiableMap` akan throw jika duplicate key. Itu bagus.

Tapi error-nya bisa kurang domain-specific. Bisa buat validasi sendiri:

```java
private static Map<String, CaseStatus> buildLookup() {
    Map<String, CaseStatus> result = new HashMap<>();
    for (CaseStatus status : values()) {
        CaseStatus previous = result.put(status.code, status);
        if (previous != null) {
            throw new ExceptionInInitializerError(
                    "Duplicate CaseStatus code " + status.code
                            + " for " + previous.name()
                            + " and " + status.name()
            );
        }
    }
    return Map.copyOf(result);
}
```

```java
private static final Map<String, CaseStatus> BY_CODE = buildLookup();
```

Ini fail fast saat class initialization.

Production rule:

```text
If enum code is persisted or externalized, duplicate code must fail at startup/class initialization, not at random request time.
```

---

## 33. Enum dan Null

Enum tidak menghilangkan masalah null.

```java
public void updateStatus(CaseStatus status) {
    if (status == CaseStatus.APPROVED) {
        // null-safe comparison
    }
}
```

Tapi parameter masih bisa null.

Untuk domain invariant:

```java
public record CaseRecord(String id, CaseStatus status) {
    public CaseRecord {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(status, "status");
    }
}
```

Jangan menambahkan enum constant `NONE` hanya untuk menghindari null tanpa memahami domain.

```java
public enum AssigneeType {
    USER,
    GROUP,
    NONE
}
```

`NONE` valid jika memang domain value.

Jika hanya berarti absent, mungkin lebih baik:

```java
Optional<Assignee> assignee
```

Atau:

```java
public sealed interface Assignment permits AssignedToUser, AssignedToGroup, Unassigned {
}
```

Rule:

```text
Do not use fake enum constants to hide absence unless absence itself is a domain state.
```

---

## 34. Enum dan Class Loader Identity

Enum identity aman dalam class loader yang sama.

Namun di plugin/app server/complex module runtime, class loader bisa membuat dua class dengan nama sama tapi identity berbeda.

Mental model:

```text
A Java type is identified by fully qualified name + defining class loader.
```

Jika `com.acme.CaseStatus` dimuat oleh class loader A dan B, maka itu dua type berbeda.

Akibat:

```java
statusFromLoaderA == statusFromLoaderB // not even same type normally
```

Untuk aplikasi Spring Boot biasa, jarang jadi masalah. Untuk plugin system, app server, agent, OSGi-like runtime, custom module layer, ini penting.

Boundary yang aman:

- gunakan string code di inter-classloader boundary,
- jangan leak enum implementation dari plugin ke host jika class loader berbeda,
- definisikan shared API enum di parent/shared loader jika memang perlu.

---

## 35. Enum dan Serialization

Java enum punya special handling dalam serialization. Namun serializing enum tetap punya compatibility consideration.

Risiko:

- enum constant removed,
- enum renamed,
- different version reads old stream,
- external serialized data lives long.

Untuk modern distributed systems, biasanya lebih baik serialisasi code eksplisit dalam JSON/protobuf/event schema daripada Java native serialization.

Pattern:

```java
public record CaseDto(String id, String statusCode) {
    public static CaseDto fromDomain(Case c) {
        return new CaseDto(c.id(), c.status().code());
    }
}
```

Domain parse:

```java
CaseStatus.fromCode(dto.statusCode())
```

---

## 36. Enum dan Reflection

Reflection bisa melihat enum metadata.

```java
Class<CaseStatus> type = CaseStatus.class;

boolean isEnum = type.isEnum();
CaseStatus[] constants = type.getEnumConstants();
```

Generic mapper bisa menggunakan ini.

```java
public static <E extends Enum<E>> E parseEnum(Class<E> enumType, String name) {
    return Enum.valueOf(enumType, name);
}
```

Namun `Enum.valueOf` memakai `name()`, bukan custom code.

Jika Anda punya explicit code, jangan pakai `Enum.valueOf` untuk external code.

Bad:

```java
CaseStatus status = Enum.valueOf(CaseStatus.class, externalCode);
```

Better:

```java
CaseStatus status = CaseStatus.fromCode(externalCode);
```

Reflection dalam framework juga bisa membaca annotation pada enum constants.

```java
public enum CaseStatus {
    @Deprecated
    OLD_STATUS,
    NEW_STATUS
}
```

Namun annotation-heavy enum bisa menjadi mini-framework yang sulit dirawat.

---

## 37. Enum Constant Annotation Pattern

Kadang enum constant diberi annotation:

```java
public enum CaseStatus {
    @Terminal
    APPROVED,

    @Terminal
    REJECTED,

    DRAFT,
    SUBMITTED
}
```

Reflection utility:

```java
public static boolean isTerminal(CaseStatus status) {
    try {
        Field field = CaseStatus.class.getField(status.name());
        return field.isAnnotationPresent(Terminal.class);
    } catch (NoSuchFieldException e) {
        throw new IllegalStateException(e);
    }
}
```

Ini biasanya overkill.

Lebih sederhana:

```java
public enum CaseStatus {
    DRAFT(false),
    SUBMITTED(false),
    APPROVED(true),
    REJECTED(true);

    private final boolean terminal;

    CaseStatus(boolean terminal) {
        this.terminal = terminal;
    }

    public boolean isTerminal() {
        return terminal;
    }
}
```

Gunakan annotation enum constant hanya jika:

- metadata diproses compile-time,
- framework benar-benar perlu annotation,
- metadata banyak dan lebih cocok deklaratif,
- ada tooling yang memvalidasi.

---

## 38. Enum dan Code Generation

Generated code sering menghasilkan enum dari schema.

Contoh sumber:

- OpenAPI enum schema,
- protobuf enum,
- GraphQL enum,
- database code table snapshot,
- DSL internal.

Risiko generated enum:

- enum generated dari external schema bisa berubah mendadak,
- consumer lama tidak mengenal value baru,
- generated enum name bisa tidak stabil,
- schema enum mungkin open-ended tapi Java enum closed,
- `UNKNOWN` handling sering dibutuhkan.

Generated enum harus punya governance:

```text
Who owns enum values?
Can values be added independently?
Is unknown value preserved?
Is generated code committed?
How is compatibility tested?
```

Untuk external schema yang bisa bertambah, pertimbangkan generated enum dengan `UNRECOGNIZED` plus raw value preservation, atau jangan expose enum langsung ke domain.

Domain adapter pattern:

```java
// generated
public enum ExternalPaymentStatusDto {
    PENDING,
    SUCCESS,
    FAILURE,
    UNRECOGNIZED
}

// domain
public enum PaymentStatus {
    PENDING,
    PAID,
    FAILED
}
```

```java
public final class PaymentStatusMapper {
    public PaymentStatus toDomain(ExternalPaymentStatusDto dto) {
        return switch (dto) {
            case PENDING -> PaymentStatus.PENDING;
            case SUCCESS -> PaymentStatus.PAID;
            case FAILURE -> PaymentStatus.FAILED;
            case UNRECOGNIZED -> throw new IllegalArgumentException("Unrecognized external payment status");
        };
    }
}
```

Jangan leak generated enum ke core domain tanpa sadar.

---

## 39. Enum dan API Evolution

Enum evolution tampak sederhana, tapi bisa breaking.

### 39.1 Menambah Constant

Source code internal mungkin tetap compile, tapi switch exhaustive tanpa default akan perlu update. Itu bagus.

Untuk public API, adding enum constant bisa breaking bagi client yang tidak siap.

Contoh client lama:

```java
switch (status) {
    case DRAFT -> ...;
    case SUBMITTED -> ...;
    case APPROVED -> ...;
    case REJECTED -> ...;
}
```

Jika status baru `WITHDRAWN` dikirim lewat API, client lama bisa gagal.

### 39.2 Rename Constant

Rename constant hampir selalu breaking jika:

- persisted by name,
- serialized by name,
- used in API,
- used in config,
- used in logs/analytics queries,
- used in switch by downstream code.

Gunakan explicit code untuk stabilitas:

```java
APPROVED("APPROVED")
```

Nama Java constant bisa berubah dengan mapping code tetap, meski tetap perlu hati-hati untuk Java serialization dan source compatibility.

### 39.3 Remove Constant

Remove constant breaking untuk:

- old data,
- old events,
- old config,
- downstream compiled code,
- replay.

Better deprecate first:

```java
@Deprecated(forRemoval = false, since = "2.4")
OLD_STATUS("OLD_STATUS")
```

Dan buat migration plan.

### 39.4 Reorder Constant

Seharusnya tidak berdampak jika tidak ada ordinal persistence/ordering. Tapi bisa berdampak pada:

- ordinal-based storage,
- `compareTo`,
- `EnumSet`/`EnumMap` iteration order,
- UI list order jika langsung pakai `values()`,
- generated docs.

Jika order penting, buat explicit display order.

```java
public enum CaseStatus {
    DRAFT(10),
    SUBMITTED(20),
    APPROVED(30),
    REJECTED(40);

    private final int displayOrder;
}
```

---

## 40. Enum dan Binary Compatibility

Dari sudut library, enum adalah class. Perubahan enum punya efek terhadap binary/source compatibility.

Hal yang perlu dipikirkan:

- public enum exposed in API becomes part of ABI/API surface,
- adding/removing fields/methods affects clients,
- removing enum constant breaks source and runtime assumptions,
- changing method signature breaks binary compatibility,
- changing constructor private signature biasanya tidak exposed, tapi generated bytecode enum constants berubah,
- switch terhadap enum di compiled client bisa punya synthetic mapping behavior.

Praktisnya:

```text
Once a public enum is released, treat its constants and serialized codes as contract.
```

Untuk internal module, lebih fleksibel. Untuk public shared library, sangat hati-hati.

---

## 41. Enum dan Backward/Forward Compatibility Matrix

| Change | Internal code | Public API | DB data | Event replay | Risk |
|---|---:|---:|---:|---:|---|
| Add enum constant | Medium | Medium/High | Low | Medium | switch/client unknown |
| Rename constant | Medium | High | High if name persisted | High | value mismatch |
| Remove constant | Medium | High | High | High | old data unreadable |
| Reorder constants | Low | Low/Medium | High if ordinal persisted | Medium | ordinal/order bugs |
| Add field/method | Low | Low | Low | Low | usually safe |
| Change code value | Medium | High | High | High | contract break |
| Change display label | Low | Medium | Low | Low | presentation impact |

---

## 42. Enum dan `values()`

Compiler mensintesis method `values()` untuk enum.

```java
CaseStatus[] statuses = CaseStatus.values();
```

Catatan:

- `values()` mengembalikan array baru/copy,
- urutannya declaration order,
- jangan ubah array dan berharap berdampak pada enum,
- jangan pakai order `values()` sebagai business order kecuali memang documented.

Untuk list immutable:

```java
public static final List<CaseStatus> DISPLAY_ORDER = List.of(
        DRAFT,
        SUBMITTED,
        APPROVED,
        REJECTED
);
```

Atau:

```java
public static List<CaseStatus> displayOrder() {
    return Arrays.stream(values())
            .sorted(Comparator.comparingInt(CaseStatus::displayOrder))
            .toList();
}
```

---

## 43. Enum dan `valueOf()`

Compiler/JDK menyediakan:

```java
CaseStatus.valueOf("SUBMITTED")
```

Ini sama seperti:

```java
Enum.valueOf(CaseStatus.class, "SUBMITTED")
```

`valueOf` exact match ke enum constant name.

Masalah:

- case-sensitive,
- pakai Java constant name,
- throws `IllegalArgumentException` jika tidak ada,
- tidak cocok untuk display label,
- tidak cocok untuk custom external code kecuali code == name by contract.

Better:

```java
CaseStatus.fromCode(input)
```

---

## 44. Enum dan Validation

Enum sering dipakai untuk mengganti string validation.

String approach:

```java
public void create(String priority) {
    if (!Set.of("LOW", "MEDIUM", "HIGH").contains(priority)) {
        throw new IllegalArgumentException("Invalid priority");
    }
}
```

Enum approach:

```java
public void create(Priority priority) {
    Objects.requireNonNull(priority, "priority");
}
```

Namun di boundary input, Anda tetap perlu parsing:

```java
public Priority parsePriority(String raw) {
    return Priority.fromCode(raw);
}
```

Layering:

```text
External input: string/raw JSON
Boundary adapter: parse/validate
Application/domain: enum
Persistence/output: explicit code
```

Jangan biarkan raw string masuk ke deep domain jika enum vocabulary sudah ada.

---

## 45. Enum dan Logging/Audit

Untuk audit, stable code lebih penting dari display label.

Bad:

```java
audit("Status changed to " + status.toString());
```

Jika `toString()` berubah karena label, audit semantic berubah.

Better:

```java
audit("Status changed to " + status.code());
```

Atau structured audit:

```java
public record StatusChangedAudit(
        String caseId,
        String oldStatusCode,
        String newStatusCode,
        Instant changedAt,
        String changedBy
) {}
```

Audit adalah long-lived evidence. Treat enum code as stable evidence vocabulary.

---

## 46. Enum dan Security/Authorization

Enum sering dipakai untuk permission:

```java
public enum Permission {
    CASE_VIEW,
    CASE_EDIT,
    CASE_APPROVE,
    CASE_EXPORT
}
```

Ini bisa baik untuk internal authorization vocabulary.

Tapi hati-hati jika permission dikelola external IAM/admin UI.

Enum cocok jika:

- permissions code-owned,
- release controls permission set,
- application logic compiled against permission,
- role mapping external hanya merujuk code.

Potential design:

```java
public enum Permission {
    CASE_VIEW("case:view"),
    CASE_EDIT("case:edit"),
    CASE_APPROVE("case:approve"),
    CASE_EXPORT("case:export");

    private final String authority;

    Permission(String authority) {
        this.authority = authority;
    }

    public String authority() {
        return authority;
    }
}
```

But do not use ordinal or display label.

If permissions are fully dynamic, use string authority with validation from policy store.

---

## 47. Enum dan Module Boundary

Dalam modular Java, public enum exported dari module adalah API.

```java
module com.acme.case.api {
    exports com.acme.caseapi;
}
```

```java
package com.acme.caseapi;

public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Semua consumer module yang membaca `com.acme.case.api` bisa bergantung pada enum ini.

Impikasi:

- enum constants menjadi shared vocabulary,
- perubahan harus backward-compatible,
- jangan expose internal workflow enum jika itu bukan contract,
- pisahkan API enum dan internal enum jika lifecycle berbeda.

Example:

```java
// API module
public enum CaseStatusDto {
    DRAFT,
    SUBMITTED,
    COMPLETED
}

// internal domain module
public enum InternalCaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Mapper:

```java
public CaseStatusDto toDto(InternalCaseStatus status) {
    return switch (status) {
        case DRAFT -> CaseStatusDto.DRAFT;
        case SUBMITTED, UNDER_REVIEW -> CaseStatusDto.SUBMITTED;
        case APPROVED, REJECTED, CLOSED -> CaseStatusDto.COMPLETED;
    };
}
```

Ini menjaga internal evolution tidak langsung bocor ke external contract.

---

## 48. Enum dan Package Architecture

Enum sering ditempatkan sembarangan:

```text
com.acme.common.enums
```

Ini sering menjadi dumping ground.

Masalah `common.enums`:

- coupling meningkat,
- domain vocabulary lepas dari bounded context,
- semua module mudah bergantung ke common,
- perubahan kecil menjadi cross-module impact,
- enum menjadi “global truth” padahal mungkin context-specific.

Better:

```text
com.acme.case.domain.CaseStatus
com.acme.case.domain.CasePriority
com.acme.notification.domain.NotificationChannel
com.acme.report.api.ReportFormat
```

Rule:

```text
Put enum near the domain/context that owns its meaning.
Avoid global common enum packages unless the vocabulary is truly platform-wide.
```

Contoh enum yang mungkin platform-wide:

```java
public enum SortDirection {
    ASC,
    DESC
}
```

Contoh yang tidak seharusnya common:

```java
CaseStatus
ApplicationType
AppealReason
DocumentType
```

Karena maknanya domain-specific.

---

## 49. Enum dan Anti-Corruption Layer

Saat berintegrasi dengan external system, jangan langsung pakai enum external sebagai domain enum.

External:

```json
{
  "status": "SUCCESS"
}
```

Domain:

```java
public enum PaymentStatus {
    PENDING,
    PAID,
    FAILED
}
```

Mapper:

```java
public PaymentStatus mapExternalStatus(String externalStatus) {
    return switch (externalStatus) {
        case "PENDING" -> PaymentStatus.PENDING;
        case "SUCCESS" -> PaymentStatus.PAID;
        case "FAILURE", "DECLINED" -> PaymentStatus.FAILED;
        default -> throw new IllegalArgumentException("Unknown external payment status: " + externalStatus);
    };
}
```

Kalau external bisa add status:

```java
public Optional<PaymentStatus> tryMapExternalStatus(String externalStatus) {
    return switch (externalStatus) {
        case "PENDING" -> Optional.of(PaymentStatus.PENDING);
        case "SUCCESS" -> Optional.of(PaymentStatus.PAID);
        case "FAILURE", "DECLINED" -> Optional.of(PaymentStatus.FAILED);
        default -> Optional.empty();
    };
}
```

Jangan biarkan external enum vocabulary mengkontaminasi domain internal tanpa mapping.

---

## 50. Enum dan Testing

Enum harus dites bukan karena enum sulit, tapi karena mapping dan contract-nya long-lived.

Test yang berguna:

### 50.1 Code Uniqueness

```java
@Test
void statusCodesAreUnique() {
    Set<String> codes = new HashSet<>();
    for (CaseStatus status : CaseStatus.values()) {
        assertTrue(codes.add(status.code()), "Duplicate code: " + status.code());
    }
}
```

### 50.2 From Code Round Trip

```java
@Test
void allStatusesCanRoundTripFromCode() {
    for (CaseStatus status : CaseStatus.values()) {
        assertSame(status, CaseStatus.fromCode(status.code()));
    }
}
```

### 50.3 Unknown Code Behavior

```java
@Test
void unknownStatusCodeFailsFast() {
    assertThrows(IllegalArgumentException.class, () -> CaseStatus.fromCode("UNKNOWN_CODE"));
}
```

### 50.4 Transition Matrix Coverage

```java
@Test
void terminalStatusesCannotTransition() {
    for (CaseStatus terminal : List.of(CaseStatus.APPROVED, CaseStatus.REJECTED)) {
        for (CaseStatus target : CaseStatus.values()) {
            assertFalse(CaseTransitions.canMove(terminal, target));
        }
    }
}
```

### 50.5 API Contract Snapshot

Untuk public API enum, snapshot test bisa valid:

```java
@Test
void publicStatusCodesRemainStable() {
    assertEquals(
            Set.of("DRAFT", "SUBMITTED", "APPROVED", "REJECTED"),
            Arrays.stream(CaseStatus.values())
                    .map(CaseStatus::code)
                    .collect(Collectors.toSet())
    );
}
```

Test ini sengaja gagal jika enum berubah, supaya perubahan contract sadar.

---

## 51. Enum dan Documentation

Enum yang menjadi public/domain contract perlu dokumentasi.

Bad:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Better:

```java
/**
 * Lifecycle status of a case inside the case management bounded context.
 *
 * <p>The {@link #code()} value is persisted and exposed in internal events.
 * Do not change an existing code without data migration and event compatibility review.</p>
 */
public enum CaseStatus {
    /** Case is editable by applicant/officer and has not entered review. */
    DRAFT("DRAFT"),

    /** Case has been submitted and is awaiting review. */
    SUBMITTED("SUBMITTED"),

    /** Case has reached a positive terminal decision. */
    APPROVED("APPROVED"),

    /** Case has reached a negative terminal decision. */
    REJECTED("REJECTED");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    /** Stable persisted/event code. */
    public String code() {
        return code;
    }
}
```

Dokumentasikan:

- meaning,
- owner,
- persisted/API/event status,
- lifecycle,
- terminal/non-terminal,
- compatibility rule,
- replacement/deprecation.

---

## 52. Enum dan Naming

Enum type name sebaiknya singular:

```java
public enum CaseStatus { ... }
public enum Permission { ... }
public enum ExportFormat { ... }
```

Bukan:

```java
public enum CaseStatuses { ... }
```

Karena variable merepresentasikan satu value:

```java
CaseStatus status = CaseStatus.SUBMITTED;
```

Constant names biasanya uppercase snake case:

```java
UNDER_REVIEW
WAITING_FOR_PAYMENT
```

Jangan pakai prefix redundant:

Bad:

```java
public enum CaseStatus {
    CASE_STATUS_DRAFT,
    CASE_STATUS_SUBMITTED
}
```

Better:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED
}
```

Karena type name sudah memberi konteks.

---

## 53. Enum dan Domain Ambiguity

Enum sering menyembunyikan ambiguity.

Contoh:

```java
public enum Status {
    ACTIVE,
    INACTIVE
}
```

Masalah: status apa?

- user account status?
- case status?
- subscription status?
- document status?
- license status?

Better:

```java
public enum AccountStatus {
    ACTIVE,
    DISABLED,
    LOCKED
}
```

```java
public enum LicenseStatus {
    ACTIVE,
    SUSPENDED,
    EXPIRED,
    REVOKED
}
```

Jangan membuat enum generik jika makna domainnya berbeda.

```text
Same labels do not imply same meaning.
```

`ACTIVE` dalam user account berbeda dari `ACTIVE` dalam license, subscription, or case assignment.

---

## 54. Enum dan State Explosion

Jika enum tumbuh besar:

```java
public enum ApplicationStatus {
    DRAFT,
    DRAFT_INCOMPLETE,
    DRAFT_PENDING_PAYMENT,
    SUBMITTED,
    SUBMITTED_PENDING_DOCUMENT,
    SUBMITTED_PENDING_SCREENING,
    REVIEW_L1,
    REVIEW_L2,
    REVIEW_LEGAL,
    REVIEW_COMPLIANCE,
    APPROVED_PENDING_PAYMENT,
    APPROVED_PENDING_ISSUANCE,
    APPROVED_ISSUED,
    REJECTED_BY_L1,
    REJECTED_BY_L2,
    REJECTED_BY_LEGAL,
    WITHDRAWN,
    CANCELLED,
    EXPIRED
}
```

Ini mungkin tanda bahwa satu enum mencampur beberapa axis:

- lifecycle status,
- pending reason,
- review stage,
- outcome,
- payment status,
- issuance status.

Better decomposed model:

```java
public enum LifecycleStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    DECIDED,
    CLOSED
}

public enum ReviewStage {
    NONE,
    LEVEL_ONE,
    LEVEL_TWO,
    LEGAL,
    COMPLIANCE
}

public enum PaymentStatus {
    NOT_REQUIRED,
    PENDING,
    PAID,
    FAILED
}

public enum DecisionOutcome {
    NONE,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    CANCELLED,
    EXPIRED
}
```

Namun decomposition juga bisa overcomplicate. Pilih berdasarkan invariant.

Pertanyaan kunci:

```text
Are these values mutually exclusive states of one axis,
or combinations of multiple independent axes?
```

Jika kombinasi multiple axes, satu enum besar bisa menjadi smell.

---

## 55. Enum dan State Machine Modeling

Untuk state machine, enum bisa menjadi bagian dari model, bukan seluruh model.

```java
public enum State {
    DRAFT,
    SUBMITTED,
    REVIEWING,
    APPROVED,
    REJECTED
}

public enum Event {
    SUBMIT,
    START_REVIEW,
    APPROVE,
    REJECT
}
```

Transition:

```java
public record Transition(State from, Event event, State to) {}
```

State machine:

```java
public final class StateMachine {
    private final Map<Key, State> transitions;

    public StateMachine(Set<Transition> transitions) {
        Map<Key, State> map = new HashMap<>();
        for (Transition t : transitions) {
            Key key = new Key(t.from(), t.event());
            State previous = map.put(key, t.to());
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate transition: " + key);
            }
        }
        this.transitions = Map.copyOf(map);
    }

    public State apply(State current, Event event) {
        State target = transitions.get(new Key(current, event));
        if (target == null) {
            throw new IllegalStateException("No transition from " + current + " on " + event);
        }
        return target;
    }

    private record Key(State state, Event event) {}
}
```

Enum gives finite states/events. State machine object owns transition rules.

---

## 56. Enum dan Exhaustiveness Dalam Business Logic

Enum bisa membantu memastikan semua case dipikirkan.

```java
public boolean isTerminal(CaseStatus status) {
    return switch (status) {
        case DRAFT, SUBMITTED, UNDER_REVIEW -> false;
        case APPROVED, REJECTED, WITHDRAWN -> true;
    };
}
```

Jika nanti ditambah `EXPIRED`, compiler bisa memberi sinyal bahwa switch perlu update.

Ini jauh lebih baik daripada:

```java
return status == APPROVED || status == REJECTED || status == WITHDRAWN;
```

Karena ketika enum bertambah, method di atas tetap compile dan diam-diam menganggap `EXPIRED` non-terminal.

Namun banyak static analyzer/compiler behavior bergantung bentuk switch dan penggunaan default. Karena itu hindari default untuk internal exhaustive logic.

---

## 57. Enum dan `Map<Enum, Function>` Dispatch

Alternatif dari switch adalah map dispatch.

```java
private final EnumMap<Action, Consumer<Case>> handlers = new EnumMap<>(Action.class);

public CaseActionService() {
    handlers.put(Action.SUBMIT, this::submit);
    handlers.put(Action.APPROVE, this::approve);
    handlers.put(Action.REJECT, this::reject);
}

public void handle(Action action, Case c) {
    Consumer<Case> handler = handlers.get(action);
    if (handler == null) {
        throw new IllegalArgumentException("Unsupported action: " + action);
    }
    handler.accept(c);
}
```

Kelebihan:

- dynamic registration possible,
- cleaner if handlers are objects,
- avoids huge switch,
- good for command dispatch.

Kekurangan:

- exhaustiveness tidak otomatis,
- map bisa incomplete,
- runtime error instead of compile-time signal.

Tambahkan validation:

```java
private void validateCoverage() {
    EnumSet<Action> missing = EnumSet.allOf(Action.class);
    missing.removeAll(handlers.keySet());
    if (!missing.isEmpty()) {
        throw new IllegalStateException("Missing handlers for: " + missing);
    }
}
```

---

## 58. Enum dan Registry Coverage Test

Jika enum dipakai untuk registry, wajib test coverage.

```java
@Test
void everyExportFormatHasExporter() {
    Set<ExportFormat> handled = exporters.supportedFormats();
    assertEquals(EnumSet.allOf(ExportFormat.class), handled);
}
```

Atau startup validation:

```java
public Exporters(List<Exporter> exporters) {
    EnumMap<ExportFormat, Exporter> map = new EnumMap<>(ExportFormat.class);
    for (Exporter exporter : exporters) {
        map.put(exporter.format(), exporter);
    }

    EnumSet<ExportFormat> missing = EnumSet.allOf(ExportFormat.class);
    missing.removeAll(map.keySet());
    if (!missing.isEmpty()) {
        throw new IllegalStateException("Missing exporters for " + missing);
    }

    this.byFormat = map;
}
```

This turns enum changes into fail-fast startup errors.

---

## 59. Enum dan Overuse Dalam Enterprise Systems

Enum overuse biasanya muncul karena developer ingin cepat.

Gejala:

```text
Everything becomes enum:
- DocumentType
- BusinessCategory
- Agency
- Department
- ReasonCode
- ProductType
- LicenseClass
- ReportTemplate
- WorkflowRoute
- EmailTemplate
```

Beberapa mungkin valid. Banyak yang sebenarnya reference data.

Pertanyaan governance:

- siapa owner value?
- seberapa sering berubah?
- apakah perlu UI management?
- apakah perlu inactive/retired flag?
- apakah perlu effective date?
- apakah perlu per-agency variance?
- apakah perlu label multi-language?
- apakah perlu audit perubahan?

Jika iya, enum terlalu statis.

Reference data model:

```java
public record ReferenceCode(
        String domain,
        String code,
        String label,
        boolean active,
        LocalDate effectiveFrom,
        LocalDate effectiveTo
) {}
```

---

## 60. Enum dan Temporal Validity

Enum tidak cocok untuk value yang punya effective date.

Bad:

```java
public enum FeeScheme {
    OLD_SCHEME,
    NEW_SCHEME
}
```

Jika fee scheme berubah per tanggal, region, license type, or regulation version, enum saja tidak cukup.

Better:

```java
public record FeeScheme(
        String code,
        LocalDate effectiveFrom,
        LocalDate effectiveTo,
        BigDecimal rate
) {}
```

Enum bisa tetap dipakai untuk scheme family yang fixed:

```java
public enum FeeSchemeType {
    APPLICATION,
    RENEWAL,
    APPEAL
}
```

Data table menyimpan actual rates/effective dates.

---

## 61. Enum dan Configuration

Jangan gunakan enum untuk configuration yang seharusnya deploy-independent.

Bad:

```java
public enum SupportedAgency {
    CEA,
    CPDS,
    ROM
}
```

Jika agency baru bisa onboarding tanpa code release, enum salah.

Better:

```java
public record AgencyCode(String value) {}
```

But enum can be valid if:

- application binary memang hanya untuk fixed agencies,
- adding agency requires code integration anyway,
- each agency has compiled behavior.

Rule:

```text
If adding a value requires code behavior, enum may be appropriate.
If adding a value is data/config only, enum is probably wrong.
```

---

## 62. Enum dan Flags/Bitmask Legacy

Legacy systems kadang pakai integer bitmask:

```java
int permissions = 0b1011;
```

Java domain bisa pakai `EnumSet`:

```java
EnumSet<Permission> permissions = EnumSet.of(
        Permission.VIEW,
        Permission.CREATE,
        Permission.DELETE
);
```

Mapping ke bitmask jika perlu boundary legacy:

```java
public enum Permission {
    VIEW(1),
    CREATE(2),
    UPDATE(4),
    DELETE(8);

    private final int bit;

    Permission(int bit) {
        this.bit = bit;
    }

    public int bit() {
        return bit;
    }
}
```

```java
public static int toMask(Set<Permission> permissions) {
    int mask = 0;
    for (Permission permission : permissions) {
        mask |= permission.bit();
    }
    return mask;
}

public static EnumSet<Permission> fromMask(int mask) {
    EnumSet<Permission> result = EnumSet.noneOf(Permission.class);
    for (Permission permission : Permission.values()) {
        if ((mask & permission.bit()) != 0) {
            result.add(permission);
        }
    }
    return result;
}
```

Jangan pakai ordinal sebagai bit position untuk persisted legacy mask kecuali sudah menjadi explicit contract dan ditest ketat.

---

## 63. Enum dan Performance

Enum performance biasanya bukan masalah.

Yang relevan:

- `==` comparison sangat murah,
- `switch` enum efisien,
- `EnumSet`/`EnumMap` sangat efisien,
- `values()` membuat array copy, hindari di hot loop jika perlu,
- `Enum.valueOf` lookup by name cukup baik tapi throws exception untuk invalid input,
- custom `Map<String, E>` lebih baik untuk parsing banyak input.

Potential issue:

```java
for (int i = 0; i < huge; i++) {
    for (CaseStatus status : CaseStatus.values()) {
        ...
    }
}
```

Jika hot path, cache immutable list/array internal:

```java
private static final CaseStatus[] ALL = values();

public static CaseStatus[] allArrayCopy() {
    return ALL.clone();
}

public static List<CaseStatus> all() {
    return List.of(ALL);
}
```

Namun jangan optimize prematur. Biasanya readability lebih penting.

---

## 64. Enum dan Memory

Setiap enum constant adalah object singleton. Enum dengan sedikit constant murah.

Enum dengan banyak constants dan banyak fields tetap memakan memory, tapi biasanya tidak signifikan dibanding aplikasi enterprise.

Yang lebih penting:

- jangan simpan object besar di enum constant,
- jangan simpan mutable collections yang bisa bocor,
- jangan buka resource di enum constructor,
- jangan inject service ke enum,
- jangan jadikan enum global singleton service.

Bad:

```java
public enum ReportTemplate {
    CASE_SUMMARY(loadLargeTemplateFromDisk("case-summary.html"));
}
```

Ini membuat class initialization berat dan failure-prone.

Better:

```java
public enum ReportTemplateId {
    CASE_SUMMARY("case-summary.html")
}
```

Template loading dilakukan service/cache terpisah.

---

## 65. Enum dan Mutable State

Enum constant adalah singleton. Jika enum punya mutable field, field itu global mutable state.

Bad:

```java
public enum Counter {
    INSTANCE;

    private int count;

    public void increment() {
        count++;
    }
}
```

Masalah:

- global state,
- thread safety,
- testing contamination,
- lifecycle unclear.

Enum singleton pattern pernah populer:

```java
public enum Singleton {
    INSTANCE;

    public void doSomething() {}
}
```

Ini bisa valid untuk stateless utility-like singleton, tapi di modern DI-based application biasanya tidak ideal.

Better for service:

```java
public final class CaseNumberGenerator {
    private final SequenceRepository repository;
}
```

Rule:

```text
Enum constants should be immutable semantic values, not mutable services.
```

---

## 66. Enum dan Dependency Injection

Enum tidak cocok sebagai bean yang menerima injected dependency.

Bad:

```java
public enum PaymentProvider {
    STRIPE {
        @Override
        void charge(Payment p) {
            stripeClient.charge(p); // where does stripeClient come from?
        }
    }
}
```

Better:

```java
public enum PaymentProviderCode {
    STRIPE,
    ADYEN
}

public interface PaymentProviderClient {
    PaymentProviderCode provider();

    void charge(Payment payment);
}
```

DI container wires implementations.

```java
public final class PaymentService {
    private final Map<PaymentProviderCode, PaymentProviderClient> clients;
}
```

Enum holds identity/code, service holds behavior.

---

## 67. Enum dan Exception/Error Type

Enum sering dipakai untuk error code.

```java
public enum ErrorCode {
    CASE_NOT_FOUND,
    INVALID_STATUS_TRANSITION,
    UNAUTHORIZED_ACTION
}
```

Ini bisa baik.

Better with explicit stable code:

```java
public enum ErrorCode {
    CASE_NOT_FOUND("CASE-404"),
    INVALID_STATUS_TRANSITION("CASE-409"),
    UNAUTHORIZED_ACTION("CASE-403");

    private final String code;

    ErrorCode(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Exception:

```java
public final class DomainException extends RuntimeException {
    private final ErrorCode errorCode;

    public DomainException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = Objects.requireNonNull(errorCode, "errorCode");
    }

    public ErrorCode errorCode() {
        return errorCode;
    }
}
```

Caveat:

- public error code is contract,
- do not rename code casually,
- consider documentation and support process,
- error code may need parameters/template.

---

## 68. Enum dan Records

Enum + record sering jadi pasangan bagus.

```java
public enum CaseEventType {
    SUBMITTED,
    APPROVED,
    REJECTED
}

public record CaseEvent(
        String caseId,
        CaseEventType type,
        Instant occurredAt,
        String actorId
) {
    public CaseEvent {
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(type);
        Objects.requireNonNull(occurredAt);
        Objects.requireNonNull(actorId);
    }
}
```

Tapi jika tiap event type punya payload berbeda, sealed hierarchy lebih baik.

Bad:

```java
public record CaseEvent(
        CaseEventType type,
        String rejectionReason,
        String approvalNumber
) {}
```

Better:

```java
public sealed interface CaseEvent permits CaseSubmitted, CaseApproved, CaseRejected {
    String caseId();
    Instant occurredAt();
}

public record CaseSubmitted(String caseId, Instant occurredAt) implements CaseEvent {}
public record CaseApproved(String caseId, Instant occurredAt, String approvalNumber) implements CaseEvent {}
public record CaseRejected(String caseId, Instant occurredAt, String reason) implements CaseEvent {}
```

Rule repeats:

```text
Enum + record works when shape is uniform.
Sealed hierarchy works when shape differs by variant.
```

---

## 69. Enum dan Pattern Matching

Enum bisa dipakai dalam switch expression.

```java
String action = switch (status) {
    case DRAFT -> "edit";
    case SUBMITTED -> "review";
    case APPROVED, REJECTED -> "view";
};
```

Pattern matching lebih relevan untuk sealed hierarchy, tetapi enum tetap bagian dari exhaustive modeling.

Hybrid:

```java
public sealed interface Decision permits SimpleDecision, ConditionalDecision {
}

public record SimpleDecision(DecisionType type) implements Decision {}
public record ConditionalDecision(DecisionType type, String condition) implements Decision {}

public enum DecisionType {
    APPROVE,
    REJECT,
    REQUEST_INFO
}
```

Namun hindari model yang terlalu nested tanpa kebutuhan.

---

## 70. Enum dan Fluent APIs

Enum dapat membuat API lebih readable.

```java
query.orderBy("createdAt", SortDirection.DESC);
```

Daripada:

```java
query.orderBy("createdAt", false);
```

Enum mengganti boolean trap.

Bad:

```java
sendEmail(user, true, false);
```

Better:

```java
sendEmail(user, EmailPriority.HIGH, EmailTracking.DISABLED);
```

Tapi jangan kebanyakan enum untuk parameter yang jarang dipakai. Kadang builder lebih baik.

```java
EmailRequest request = EmailRequest.builder()
        .recipient(user.email())
        .priority(EmailPriority.HIGH)
        .tracking(EmailTracking.DISABLED)
        .build();
```

---

## 71. Enum dan Public Method Parameters

Enum sebagai parameter membuat API lebih self-documenting.

```java
public Page<Case> searchCases(SortDirection direction) {}
```

Namun jika enum berada di module internal, exposing it leaks dependency.

Misalnya shared library:

```java
public void export(InternalReportFormat format) {}
```

Jika `InternalReportFormat` berubah sering, public API ikut rapuh.

Design:

- public API enum harus stabil,
- internal enum boleh lebih detail,
- mapper memisahkan lifecycle.

---

## 72. Enum dan Validation Error Accumulation

Enum parse fail-fast kadang tidak cukup untuk form validation.

Bad:

```java
CaseStatus status = CaseStatus.fromCode(rawStatus); // throws immediately
```

For validation pipeline:

```java
public ValidationResult<CaseStatus> parseStatus(String rawStatus) {
    return CaseStatus.findByCode(rawStatus)
            .<ValidationResult<CaseStatus>>map(ValidationResult::valid)
            .orElseGet(() -> ValidationResult.invalid("Invalid case status: " + rawStatus));
}
```

Atau:

```java
public record FieldError(String field, String message) {}
```

Tujuannya agar boundary bisa mengumpulkan semua error, bukan berhenti di error pertama.

---

## 73. Enum dan Clean Architecture Layering

Layering umum:

```text
Controller/API DTO: string or API enum
Application service: domain enum
Domain model: domain enum/sealed type
Persistence adapter: DB code converter
External adapter: external raw code/generated enum mapper
```

Jangan mencampur:

- DB enum langsung sebagai domain enum jika DB value bukan domain owner,
- generated OpenAPI enum langsung di domain,
- UI label enum langsung di domain,
- external provider enum langsung di core logic.

Mapping memang terlihat boilerplate, tapi mapping adalah anti-corruption boundary.

---

## 74. Enum dan “Common Status” Anti-Pattern

Anti-pattern:

```java
public enum Status {
    ACTIVE,
    INACTIVE,
    PENDING,
    APPROVED,
    REJECTED,
    CLOSED,
    DELETED
}
```

Lalu dipakai semua entity.

Masalah:

- status kehilangan makna spesifik,
- invalid status untuk entity tertentu tetap compile,
- logic penuh guard runtime,
- domain menjadi lemah.

Bad:

```java
User user = new User(Status.APPROVED); // what does approved user mean?
Document doc = new Document(Status.ACTIVE); // active document?
Case c = new Case(Status.DELETED); // deleted as lifecycle?
```

Better:

```java
public enum UserStatus {
    ACTIVE,
    LOCKED,
    DISABLED
}

public enum DocumentStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}

public enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    CLOSED
}
```

Domain-specific enum prevents invalid states.

---

## 75. Enum dan Open/Closed Principle

Enum adalah closed set. Ini kadang bertentangan dengan extensibility.

Jika Anda ingin pihak ketiga menambahkan behavior baru tanpa mengubah core code, enum tidak cocok sebagai extension point.

Bad plugin architecture:

```java
public enum PluginType {
    PDF_EXPORT,
    CSV_EXPORT,
    XML_EXPORT
}
```

Setiap plugin baru perlu ubah enum core.

Better:

```java
public interface ExportPlugin {
    String formatCode();

    byte[] export(Report report);
}
```

Enum bisa tetap digunakan untuk built-in plugins:

```java
public enum BuiltInExportFormat {
    PDF,
    CSV
}
```

Tapi extension point menggunakan string/code/interface.

Rule:

```text
Enums are closed. Extension points are open. Do not confuse them.
```

---

## 76. Enum dan Dependency Direction

Jika low-level module tergantung enum dari high-level module, architecture terbalik.

Bad:

```text
infrastructure-email -> case-domain.CaseStatus
```

Jika email infrastructure hanya butuh template code, jangan tergantung domain status langsung.

Better:

```java
public record EmailTemplateCode(String value) {}
```

Or application layer maps:

```java
EmailTemplateCode template = switch (caseStatus) {
    case SUBMITTED -> new EmailTemplateCode("case-submitted");
    case APPROVED -> new EmailTemplateCode("case-approved");
    case REJECTED -> new EmailTemplateCode("case-rejected");
    default -> throw new IllegalStateException("No email template for " + caseStatus);
};
```

Keep enum ownership clear.

---

## 77. Enum dan Error-Prone Refactoring

Refactoring enum harus diperlakukan sebagai contract change.

Checklist sebelum rename/delete/reorder:

- Apakah enum dipersist di DB?
- Apakah JSON menggunakan enum name?
- Apakah event schema menggunakan enum value?
- Apakah config file menyebut enum value?
- Apakah logs/analytics mencari enum value?
- Apakah downstream service bergantung pada value?
- Apakah UI menerjemahkan enum value?
- Apakah test snapshot ada?
- Apakah migration script diperlukan?

Jika jawaban tidak jelas, jangan rename.

---

## 78. Enum dan Database Migration Strategy

Jika perlu rename code:

Old:

```java
SUBMITTED("SUBMITTED")
```

New desired:

```java
PENDING_REVIEW("PENDING_REVIEW")
```

Migration path:

1. Tambahkan new enum constant jika perlu.
2. Support read old + new code.
3. Write new code only after deployment phase.
4. Run data migration.
5. Monitor old code absence.
6. Remove old support in later version.

Alternative: keep code stable, rename Java constant only:

```java
PENDING_REVIEW("SUBMITTED")
```

Ini menjaga DB/API code, tapi Java name berubah. Source consumers tetap terdampak jika public.

Untuk public enum, rename Java constant juga breaking. Deprecate instead.

```java
@Deprecated(forRemoval = false, since = "3.1")
SUBMITTED("SUBMITTED"),

PENDING_REVIEW("PENDING_REVIEW");
```

Tapi duplicate semantic bisa membingungkan. Migration harus jelas.

---

## 79. Enum dan “Unknown Future Value” Problem

Closed enum di Java bertabrakan dengan open world external systems.

External API bisa mengirim value baru:

```json
{ "status": "PARTIALLY_APPROVED" }
```

Client Java lama tidak punya enum constant.

Solusi tergantung boundary:

### 79.1 Internal Domain

Fail fast.

```java
throw new IllegalArgumentException("Unknown status");
```

### 79.2 External Integration

Preserve raw value.

```java
public record ExternalStatus(String raw, Optional<KnownExternalStatus> known) {}
```

### 79.3 Public SDK

Sediakan unknown wrapper, bukan pure enum, jika forward compatibility penting.

```java
public sealed interface ApiStatus permits KnownApiStatus, UnknownApiStatus {}

public record KnownApiStatus(Status status) implements ApiStatus {}
public record UnknownApiStatus(String rawValue) implements ApiStatus {}
```

Enum tidak selalu cukup untuk SDK yang harus forward-compatible.

---

## 80. Enum dan Generated OpenAPI Client

OpenAPI enum sering digenerate sebagai Java enum.

Masalah:

- server menambah enum value,
- client generated lama gagal parse,
- unknown value hilang,
- SDK perlu regenerate.

Untuk robust clients:

- configure generator untuk unknown default jika tersedia,
- preserve raw string,
- avoid exposing generated enum to core domain,
- write adapter tests with unknown enum value.

Boundary example:

```java
public record ProviderStatusDto(String rawStatus) {}
```

Rather than trusting generated enum in domain.

---

## 81. Enum dan Protobuf-like Numbered Enum

Beberapa schema language punya enum numeric values. Jangan otomatis map ke Java ordinal.

External numeric value:

```text
0 = UNKNOWN
1 = PENDING
2 = PAID
3 = FAILED
```

Java:

```java
public enum PaymentStatus {
    UNKNOWN(0),
    PENDING(1),
    PAID(2),
    FAILED(3);

    private final int number;

    PaymentStatus(int number) {
        this.number = number;
    }

    public int number() {
        return number;
    }
}
```

Never assume:

```java
number == ordinal()
```

Explicit mapping only.

---

## 82. Enum dan UI Ordering/Filtering

UI sering butuh display list.

Bad:

```java
List<CaseStatus> options = Arrays.asList(CaseStatus.values());
```

Jika declaration order berubah, UI berubah.

Better:

```java
public enum CaseStatus {
    DRAFT(10, true),
    SUBMITTED(20, true),
    INTERNAL_REVIEW(30, false),
    APPROVED(40, true),
    REJECTED(50, true);

    private final int displayOrder;
    private final boolean userVisible;

    CaseStatus(int displayOrder, boolean userVisible) {
        this.displayOrder = displayOrder;
        this.userVisible = userVisible;
    }

    public int displayOrder() {
        return displayOrder;
    }

    public boolean isUserVisible() {
        return userVisible;
    }

    public static List<CaseStatus> userVisibleOptions() {
        return Arrays.stream(values())
                .filter(CaseStatus::isUserVisible)
                .sorted(Comparator.comparingInt(CaseStatus::displayOrder))
                .toList();
    }
}
```

If visibility/config differs by tenant/user role, move to policy/service.

---

## 83. Enum dan Access Control Matrix

Enum can represent permissions/actions:

```java
public enum CaseAction {
    VIEW,
    EDIT,
    SUBMIT,
    APPROVE,
    REJECT,
    WITHDRAW
}
```

Matrix:

```java
public final class CaseActionPolicy {
    private static final EnumMap<CaseStatus, EnumSet<CaseAction>> ALLOWED_ACTIONS = new EnumMap<>(CaseStatus.class);

    static {
        ALLOWED_ACTIONS.put(CaseStatus.DRAFT, EnumSet.of(CaseAction.VIEW, CaseAction.EDIT, CaseAction.SUBMIT));
        ALLOWED_ACTIONS.put(CaseStatus.SUBMITTED, EnumSet.of(CaseAction.VIEW, CaseAction.APPROVE, CaseAction.REJECT));
        ALLOWED_ACTIONS.put(CaseStatus.APPROVED, EnumSet.of(CaseAction.VIEW));
        ALLOWED_ACTIONS.put(CaseStatus.REJECTED, EnumSet.of(CaseAction.VIEW));
    }

    public Set<CaseAction> allowedActions(CaseStatus status) {
        return Set.copyOf(ALLOWED_ACTIONS.getOrDefault(status, EnumSet.noneOf(CaseAction.class)));
    }
}
```

But real authorization also needs user context:

```java
public Set<CaseAction> allowedActions(Case c, User user) {
    EnumSet<CaseAction> actions = EnumSet.copyOf(baseActionsFor(c.status()));
    actions.removeIf(action -> !userCanPerform(user, action));
    return Set.copyOf(actions);
}
```

Enum models finite action vocabulary; policy handles contextual authorization.

---

## 84. Enum dan Compile-Time Exhaustive Documentation

An enum can be used to force developer touchpoints.

Example: every notification type must define template.

```java
public enum NotificationType {
    CASE_SUBMITTED,
    CASE_APPROVED,
    CASE_REJECTED
}
```

Template resolver:

```java
public TemplateCode templateFor(NotificationType type) {
    return switch (type) {
        case CASE_SUBMITTED -> new TemplateCode("case-submitted");
        case CASE_APPROVED -> new TemplateCode("case-approved");
        case CASE_REJECTED -> new TemplateCode("case-rejected");
    };
}
```

When adding `CASE_WITHDRAWN`, compiler forces review.

This is useful when every new value must be considered across a small number of centralized places.

If review points are too many, design is too scattered.

---

## 85. Enum dan Stringly-Typed Replacement

Enum should replace stringly typed fields only when the domain is closed.

Bad stringly typed:

```java
public boolean canApprove(String status) {
    return "SUBMITTED".equals(status) || "UNDER_REVIEW".equals(status);
}
```

Better:

```java
public boolean canApprove(CaseStatus status) {
    return switch (status) {
        case SUBMITTED, UNDER_REVIEW -> true;
        case DRAFT, APPROVED, REJECTED -> false;
    };
}
```

But if status comes from dynamic workflow engine:

```java
public record WorkflowStateCode(String value) {}
```

Then enum may not be appropriate.

---

## 86. Enum dan Invariants

Enum can encode invariants by making invalid states unrepresentable.

Instead of:

```java
public record CaseRecord(String status) {}
```

Use:

```java
public record CaseRecord(CaseStatus status) {
    public CaseRecord {
        Objects.requireNonNull(status, "status");
    }
}
```

Now invalid arbitrary string cannot exist inside domain.

But enum does not encode all invariants.

Example:

```java
public record Decision(CaseStatus status, String rejectionReason) {}
```

Still allows:

```java
new Decision(CaseStatus.APPROVED, "bad reason");
```

Use constructor validation or sealed hierarchy.

---

## 87. Enum dan Modeling Granularity

Granularity salah bisa membuat model lemah.

Too coarse:

```java
public enum CaseStatus {
    OPEN,
    CLOSED
}
```

Mungkin tidak cukup membedakan submitted/reviewing/escalated.

Too fine:

```java
public enum CaseStatus {
    OPEN_WAITING_FOR_DOC,
    OPEN_WAITING_FOR_PAYMENT,
    OPEN_ESCALATED_TO_MANAGER,
    OPEN_ESCALATED_TO_LEGAL,
    CLOSED_APPROVED,
    CLOSED_REJECTED,
    CLOSED_WITHDRAWN
}
```

Mungkin mencampur axes.

Good granularity follows invariants:

- Apakah behavior berbeda?
- Apakah transition berbeda?
- Apakah authorization berbeda?
- Apakah SLA berbeda?
- Apakah reporting berbeda?
- Apakah user sees different state?
- Apakah data requirement berbeda?

Jika tidak ada perbedaan behavior/invariant, mungkin tidak perlu enum value berbeda.

---

## 88. Enum dan Domain Language

Enum names should match ubiquitous language within context.

Bad:

```java
public enum Status {
    S1,
    S2,
    S3
}
```

Unless domain really uses regulatory codes S1/S2/S3.

Better:

```java
public enum InspectionOutcome {
    PASSED,
    FAILED,
    REQUIRES_FOLLOW_UP
}
```

Avoid implementation names:

```java
DB_STATUS_1
FLAG_Y
TYPE_A
```

Unless those are external contract codes and wrapped with meaningful names:

```java
public enum InspectionOutcome {
    PASSED("S1"),
    FAILED("S2"),
    REQUIRES_FOLLOW_UP("S3");
}
```

---

## 89. Enum dan Refactoring From Legacy String

Migration from string to enum:

Step 1: Identify value set.

```sql
select distinct status from case_table;
```

Step 2: Define enum with explicit code.

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");
}
```

Step 3: Add parser with unknown handling.

```java
public static Optional<CaseStatus> findByCode(String code) { ... }
```

Step 4: Parse at boundary.

```java
CaseStatus status = CaseStatus.fromCode(row.status());
```

Step 5: Replace internal string comparisons.

Before:

```java
if ("APPROVED".equals(status))
```

After:

```java
if (status == CaseStatus.APPROVED)
```

Step 6: Add tests for all known DB values.

Step 7: Add migration/cleanup for invalid values.

Do not blindly convert if DB contains many unknown/configurable values. That may indicate lookup table is better.

---

## 90. Enum dan Governance Checklist

Before creating enum, ask:

1. Is the value set truly closed?
2. Who owns the value set?
3. Can values change without code deployment?
4. Is the enum internal or public API?
5. Will values be persisted?
6. Will values be serialized in API/events?
7. Is ordering meaningful?
8. Is unknown future value possible?
9. Does each variant have same data shape?
10. Does behavior require dependencies/context?
11. Is this vocabulary domain-specific or platform-wide?
12. Would a lookup table be better?
13. Would sealed hierarchy be better?
14. Do we need explicit stable code?
15. Do we need migration plan for old values?

If many answers point to external/dynamic/configurable, avoid enum as core model.

---

## 91. Production-Grade Enum Template

```java
package com.acme.caseapp.domain;

import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Lifecycle status of a case.
 *
 * <p>The {@link #code()} value is persisted and emitted in domain events.
 * Do not change existing codes without data migration and compatibility review.</p>
 */
public enum CaseStatus {
    DRAFT("DRAFT", false, 10),
    SUBMITTED("SUBMITTED", false, 20),
    UNDER_REVIEW("UNDER_REVIEW", false, 30),
    APPROVED("APPROVED", true, 40),
    REJECTED("REJECTED", true, 50),
    WITHDRAWN("WITHDRAWN", true, 60);

    private static final Map<String, CaseStatus> BY_CODE = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(CaseStatus::code, Function.identity()));

    private final String code;
    private final boolean terminal;
    private final int displayOrder;

    CaseStatus(String code, boolean terminal, int displayOrder) {
        this.code = code;
        this.terminal = terminal;
        this.displayOrder = displayOrder;
    }

    /** Stable persisted/event code. */
    public String code() {
        return code;
    }

    /** Whether this status ends the case lifecycle. */
    public boolean isTerminal() {
        return terminal;
    }

    /** Stable explicit order for display/reporting. */
    public int displayOrder() {
        return displayOrder;
    }

    public static CaseStatus fromCode(String code) {
        CaseStatus status = BY_CODE.get(code);
        if (status == null) {
            throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
        }
        return status;
    }

    public static Optional<CaseStatus> findByCode(String code) {
        return Optional.ofNullable(BY_CODE.get(code));
    }
}
```

This template is appropriate when:

- enum is domain-owned,
- codes are stable,
- terminal/display metadata are intrinsic,
- unknown value should fail or be explicitly handled,
- values are not dynamic/configurable.

---

## 92. Bad Enum Examples and Fixes

### 92.1 Ordinal Persistence

Bad:

```java
status.ordinal()
```

Fix:

```java
status.code()
```

### 92.2 Generic Status

Bad:

```java
public enum Status { ACTIVE, INACTIVE, PENDING }
```

Fix:

```java
public enum AccountStatus { ACTIVE, LOCKED, DISABLED }
public enum CaseStatus { DRAFT, SUBMITTED, CLOSED }
```

### 92.3 Enum With External Service Call

Bad:

```java
EMAIL { sendViaSmtp(message); }
```

Fix:

```java
enum Channel { EMAIL }
interface Sender { Channel channel(); void send(Message message); }
```

### 92.4 Enum For Dynamic Reference Data

Bad:

```java
enum DocumentType { PASSPORT, ID_CARD, BANK_STATEMENT }
```

If dynamic, fix:

```java
record DocumentTypeCode(String value) {}
```

or lookup table.

### 92.5 `OTHER` Without Detail

Bad:

```java
enum Reason { DUPLICATE, INVALID, OTHER }
```

Fix if detail required:

```java
sealed interface Reason permits KnownReason, OtherReason {}
```

---

## 93. Decision Matrix: Enum vs Alternatives

| Need | Best fit |
|---|---|
| Fixed small set, same shape | enum |
| Fixed variants, different payload | sealed hierarchy + records |
| Dynamic configurable values | lookup table/reference data |
| External open-ended value | raw string + tolerant wrapper |
| Pure behavior per value | enum method/constant-specific body |
| Dependency-heavy behavior | strategy classes + enum code |
| Bitset of enum values | EnumSet |
| Map keyed by enum | EnumMap |
| Public extension point | interface/SPI, not enum |
| Stable persisted code | enum with explicit code |
| Localized label | message key or lookup table |
| Business ordering | explicit rank/order field |

---

## 94. Code Review Checklist For Enum

Saat review enum, cek:

- Apakah enum benar-benar closed set?
- Apakah nama enum domain-specific?
- Apakah ada `ordinal()` untuk business/persistence? Jika ada, hampir pasti salah.
- Apakah persisted/API/event value memakai explicit code?
- Apakah `toString()` dipakai untuk persistence? Jika iya, salah.
- Apakah ada `OTHER` yang menyembunyikan open-ended domain?
- Apakah enum memiliki mutable state?
- Apakah enum constructor melakukan I/O/heavy work?
- Apakah enum behavior butuh dependency/context?
- Apakah switch tersebar di banyak service?
- Apakah `default` menutupi exhaustive switch internal?
- Apakah order memakai declaration order secara accidental?
- Apakah enum ditempatkan di `common.enums` tanpa ownership jelas?
- Apakah generated/external enum bocor ke domain?
- Apakah public enum evolution dipikirkan?
- Apakah test round-trip code ada?
- Apakah unknown value handling jelas?

---

## 95. Latihan Pemahaman

### Latihan 1

Anda punya field `applicationType` dengan values:

```text
NEW_LICENSE
RENEWAL
AMENDMENT
APPEAL
```

Pertanyaan:

- Apakah ini enum?
- Apakah values bisa bertambah dari admin UI?
- Apakah tiap type punya workflow berbeda?
- Apakah type dipersist?
- Apakah external API expose value ini?

Jawaban ideal bergantung ownership. Jika application type code-owned dan tiap type punya behavior compiled, enum masuk akal. Jika admin bisa menambah type, gunakan reference data.

### Latihan 2

Anda punya `DecisionType`:

```text
APPROVE
REJECT
REQUEST_MORE_INFO
```

`REJECT` butuh `reason`, `REQUEST_MORE_INFO` butuh `dueDate`.

Enum saja tidak cukup. Gunakan sealed hierarchy.

### Latihan 3

Anda punya `Priority`:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Butuh ordering untuk escalation. Jangan pakai ordinal. Tambahkan explicit rank.

### Latihan 4

Anda menerima status dari external vendor dan vendor bisa menambah status baru tanpa koordinasi.

Jangan parse langsung ke enum domain tanpa fallback. Preserve raw value dan map known values.

### Latihan 5

Anda punya `Permission` fixed dalam code. User role berisi set permission.

Enum + `EnumSet` cocok. Tapi persisted authority sebaiknya explicit string code.

---

## 96. Mental Model Final

Enum adalah alat untuk membuat **finite semantic set** menjadi type-safe.

Gunakan enum ketika:

```text
The domain values are closed, code-owned, stable enough, and have uniform shape.
```

Jangan gunakan enum ketika:

```text
The values are external, dynamic, configurable, tenant-specific, or require extension without deployment.
```

Enum terbaik biasanya:

- immutable,
- punya explicit stable code jika dipersist/diserialisasi,
- punya metadata intrinsic secukupnya,
- tidak membawa dependency infrastructure,
- tidak menyimpan mutable state,
- tidak menjadi dumping ground common vocabulary,
- punya test untuk mapping/round-trip,
- jelas boundary internal vs external.

Pola paling sehat:

```text
Raw external input -> boundary parser/mapper -> domain enum -> policy/state machine -> explicit code at persistence/event boundary
```

Dan jika enum mulai membawa banyak conditional payload/behavior/context, itu sinyal untuk mempertimbangkan:

- sealed hierarchy,
- strategy objects,
- reference data,
- state machine model,
- anti-corruption mapping.

---

## 97. Ringkasan Part 009

Kita telah membahas:

- enum sebagai closed set of named singleton values,
- perbedaan enum vs constant class,
- `name()`, `toString()`, `ordinal()` dan jebakannya,
- stable code pattern,
- fail-fast vs tolerant parsing,
- enum sebagai state,
- transition matrix,
- enum sebagai strategy,
- enum sebagai registry,
- enum vs lookup table,
- enum vs sealed hierarchy,
- enum vs boolean flag,
- `EnumSet`,
- `EnumMap`,
- switch exhaustiveness,
- switch smell,
- persistence/API/event contract,
- localization,
- ordering,
- constant-specific class body,
- interface implementation,
- code generation,
- module/package boundary,
- anti-corruption layer,
- testing,
- governance,
- failure model,
- production-grade template.

Enum bukan fitur kecil. Ia adalah salah satu alat utama untuk membuat domain vocabulary lebih aman, tetapi juga salah satu sumber technical debt jika dipakai untuk domain yang sebenarnya dinamis/open-ended.

---

## 98. Referensi Resmi dan Lanjutan

- The Java Language Specification, Java SE 25, Chapter 8: Classes, especially enum classes.
- Java SE 25 API: `java.lang.Enum`.
- Java SE 25 API: `java.util.EnumSet`.
- Java SE 25 API: `java.util.EnumMap`.
- Java SE 25 API: `java.lang.Class#getEnumConstants` and enum reflection support.
- Java Language Guide: enum classes, switch expressions, records, sealed classes.
- Effective Java, Joshua Bloch: enum-related items, especially enum instead of int constants, EnumSet/EnumMap, strategy enum pattern.

---

## 99. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-010.md
```

Topik berikutnya:

```text
Nested, Inner, Local, and Anonymous Classes
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-008](./learn-java-oop-functional-reflection-codegen-modules-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-010](./learn-java-oop-functional-reflection-codegen-modules-part-010.md)
