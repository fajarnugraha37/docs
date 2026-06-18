# Part 8 — `Enum`: Constant Identity, Type Safety, Switch, Serialization, Design

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `08-enum-constant-identity-type-safety-switch-serialization.md`  
> Scope: Java 8 sampai Java 25  
> Fokus: `java.lang.Enum`, enum class semantics, identity, external-code mapping, switch compatibility, serialization, `EnumMap`, `EnumSet`, dan modelling state yang aman.

---

## 1. Tujuan Part Ini

Di level dasar, banyak developer memahami enum sebagai “kumpulan konstanta”. Pemahaman itu tidak salah, tetapi terlalu dangkal untuk sistem besar.

Di level advance, enum harus dilihat sebagai:

1. **closed set of named singleton objects**;
2. **type-safe replacement** untuk integer/string constants;
3. **runtime class** yang punya identity, methods, fields, constructor, inheritance rules, dan serialization behavior khusus;
4. **domain vocabulary boundary** antara kode internal dan representasi eksternal;
5. **state/modeling tool** yang kuat, tetapi juga berbahaya kalau dipakai untuk hal yang sebenarnya dinamis;
6. **compatibility surface** karena enum sering muncul di database, JSON, XML, API contracts, workflow states, event payloads, audit trail, switch logic, dan authorization rules.

Setelah part ini, targetnya kamu bisa:

- memahami mengapa enum constant aman dibanding public static final integer/string constants;
- tahu kapan menggunakan `name()`, kapan tidak;
- tahu kenapa `ordinal()` hampir tidak boleh masuk persistence/API;
- mendesain enum yang bisa survive evolusi sistem;
- menghindari failure mode pada switch, serialization, JSON/XML mapping, database mapping, dan workflow state machine;
- menggunakan `EnumMap` dan `EnumSet` sebagai struktur data high-performance yang lebih tepat daripada `HashMap<Enum, ...>` dan `HashSet<Enum>`;
- membedakan enum untuk **closed compile-time set** vs konfigurasi/status yang berubah secara operasional.

---

## 2. Mental Model Utama

### 2.1 Enum bukan “constant values”, tetapi “constant objects”

Enum constant adalah object. Misalnya:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Secara mental, `DRAFT`, `SUBMITTED`, `APPROVED`, dan `REJECTED` bukan sekadar string. Mereka adalah instance tunggal dari class `CaseStatus`.

Karena itu:

```java
CaseStatus a = CaseStatus.DRAFT;
CaseStatus b = CaseStatus.DRAFT;

System.out.println(a == b);      // true
System.out.println(a.equals(b)); // true
```

Untuk enum, `==` bukan smell. Justru `==` adalah idiom yang aman karena setiap enum constant punya identity tunggal per enum type dan class loader.

Catatan penting: identity enum tetap mengikuti class loader. Dalam sistem plugin/container yang memuat class sama lewat class loader berbeda, dua enum dengan binary name sama bisa tetap bukan type yang sama.

---

### 2.2 Enum adalah closed set

Enum cocok ketika daftar nilai:

- diketahui saat compile time;
- relatif stabil;
- bagian dari kontrak kode;
- perlu type safety;
- perlu exhaustive reasoning;
- tidak dibuat user/admin secara dinamis.

Contoh cocok:

```java
public enum DecisionOutcome {
    APPROVED,
    REJECTED,
    WITHDRAWN,
    CANCELLED
}
```

Contoh kurang cocok:

```java
public enum ConfigurableDepartment {
    LEGAL,
    FINANCE,
    OPERATIONS,
    LICENSING
}
```

Kalau department bisa berubah lewat admin screen/database, enum akan membuat deployment kode diperlukan hanya untuk menambah data bisnis. Itu salah boundary.

Rule praktis:

> Gunakan enum untuk taxonomy yang menjadi bagian dari program semantics. Jangan gunakan enum untuk master data operasional yang berubah tanpa release aplikasi.

---

### 2.3 Enum punya dua identity penting: internal identity dan external code

Enum punya `name()` bawaan, tetapi `name()` adalah **identifier source code**, bukan selalu kode eksternal yang aman.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

`CaseStatus.SUBMITTED.name()` menghasilkan `"SUBMITTED"`.

Masalahnya, `name()` akan berubah kalau developer rename constant. Sementara database/API/event lama masih membawa string lama.

Untuk sistem production, sering lebih aman:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUB"),
    APPROVED("APR"),
    REJECTED("REJ");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Dengan begitu:

- `name()` = internal source identifier;
- `code()` = stable external representation.

---

## 3. Konsep Fundamental `java.lang.Enum`

Semua enum secara implisit mewarisi `java.lang.Enum<E extends Enum<E>>`.

Secara konsep:

```java
public abstract class Enum<E extends Enum<E>>
        implements Constable, Comparable<E>, Serializable {
    private final String name;
    private final int ordinal;

    public final String name();
    public final int ordinal();
    public final boolean equals(Object other);
    public final int hashCode();
    public final int compareTo(E other);
    public final Class<E> getDeclaringClass();
    public static <T extends Enum<T>> T valueOf(Class<T> enumClass, String name);
}
```

Kita tidak bisa extend `Enum` secara manual. Hanya compiler yang boleh membuat enum class.

Konsekuensi desain:

- enum tidak bisa extend class lain;
- enum bisa implement interface;
- enum constructor selalu private secara efektif;
- enum constants dibuat oleh runtime saat class initialization;
- enum equality/hash tidak bisa diubah;
- enum punya serialization behavior khusus.

---

## 4. Anatomy Enum Class

### 4.1 Enum sederhana

```java
public enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

Compiler menghasilkan beberapa hal penting:

- class `RiskLevel` yang extends `Enum<RiskLevel>`;
- static final instance untuk setiap constant;
- private constructor;
- method static `values()`;
- method static `valueOf(String name)`.

Pemakaian:

```java
RiskLevel risk = RiskLevel.HIGH;

System.out.println(risk.name());      // HIGH
System.out.println(risk.ordinal());   // 2, berdasarkan urutan deklarasi
System.out.println(risk.toString());  // default: HIGH
```

---

### 4.2 Enum dengan field

```java
public enum Severity {
    INFO(10),
    WARNING(20),
    ERROR(30),
    FATAL(40);

    private final int weight;

    Severity(int weight) {
        this.weight = weight;
    }

    public int weight() {
        return weight;
    }
}
```

Ini membuat enum lebih kaya daripada constant string/integer.

Keuntungan:

- kode tetap type-safe;
- metadata dekat dengan constant;
- tidak perlu map terpisah untuk property sederhana;
- switch dan polymorphism tetap bisa dipakai.

Namun jangan memasukkan terlalu banyak business data yang harusnya ada di database/config.

---

### 4.3 Enum dengan behavior

```java
public enum CaseAction {
    SUBMIT {
        @Override
        public boolean allowedFrom(CaseStatus status) {
            return status == CaseStatus.DRAFT;
        }
    },

    APPROVE {
        @Override
        public boolean allowedFrom(CaseStatus status) {
            return status == CaseStatus.SUBMITTED;
        }
    },

    REJECT {
        @Override
        public boolean allowedFrom(CaseStatus status) {
            return status == CaseStatus.SUBMITTED;
        }
    };

    public abstract boolean allowedFrom(CaseStatus status);
}
```

Ini valid karena setiap enum constant bisa punya class body sendiri. Secara internal, constant-specific class body menghasilkan anonymous-like subclass untuk constant tersebut.

Kapan bagus:

- variasi behavior kecil dan sangat melekat pada constant;
- set constant stabil;
- logic tidak perlu dependency kompleks;
- tidak perlu runtime extension.

Kapan buruk:

- logic butuh repository/service/network call;
- logic berubah sering;
- membutuhkan dependency injection;
- banyak conditional cross-entity;
- state machine menjadi besar dan sulit diuji.

Untuk workflow enterprise besar, enum behavior bisa dipakai untuk invariant kecil, tetapi transition orchestration sebaiknya tetap di service/state-machine layer.

---

## 5. `name()`, `toString()`, `ordinal()`, `valueOf()`

### 5.1 `name()`

`name()` mengembalikan exact identifier constant sesuai deklarasi source code.

```java
CaseStatus.SUBMITTED.name(); // "SUBMITTED"
```

Karakteristik:

- final;
- tidak bisa dioverride;
- dipakai oleh Java serialization untuk enum;
- cocok untuk diagnostic internal;
- berbahaya untuk external contract jika enum bisa di-rename.

---

### 5.2 `toString()`

Default `toString()` mengembalikan `name()`, tetapi bisa dioverride.

```java
public enum PaymentStatus {
    PAID("Paid"),
    UNPAID("Unpaid");

    private final String label;

    PaymentStatus(String label) {
        this.label = label;
    }

    @Override
    public String toString() {
        return label;
    }
}
```

Hati-hati:

```java
PaymentStatus.PAID.toString(); // "Paid"
PaymentStatus.PAID.name();     // "PAID"
```

Jangan jadikan `toString()` sebagai persistence/API contract kecuali memang sengaja dan didokumentasikan kuat. `toString()` sering digunakan untuk display/debugging dan bisa berubah demi UI/logging.

---

### 5.3 `ordinal()`

`ordinal()` adalah posisi constant dalam deklarasi, mulai dari 0.

```java
RiskLevel.LOW.ordinal();      // 0
RiskLevel.MEDIUM.ordinal();   // 1
RiskLevel.HIGH.ordinal();     // 2
RiskLevel.CRITICAL.ordinal(); // 3
```

Problem besar:

```java
public enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

Kalau nanti berubah menjadi:

```java
public enum RiskLevel {
    LOW,
    MEDIUM,
    ELEVATED,
    HIGH,
    CRITICAL
}
```

Maka ordinal `HIGH` berubah dari 2 menjadi 3. Data lama yang menyimpan angka 2 sekarang bisa terbaca sebagai `ELEVATED`.

Rule keras:

> Jangan menyimpan `ordinal()` ke database, API, XML, JSON, message broker, cache shared, audit trail, atau file format.

Ordinal boleh dipakai oleh internal Java implementation seperti `EnumSet`, `EnumMap`, array indexing internal yang sangat terkontrol, atau optimization lokal yang tidak menjadi external contract.

---

### 5.4 `valueOf()`

```java
CaseStatus status = CaseStatus.valueOf("SUBMITTED");
```

`valueOf` mencari berdasarkan `name()`, case-sensitive.

Jika tidak ditemukan:

```java
CaseStatus.valueOf("submitted"); // IllegalArgumentException
CaseStatus.valueOf(null);        // NullPointerException
```

Untuk external input, lebih aman buat parser sendiri:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUB"),
    APPROVED("APR"),
    REJECTED("REJ");

    private static final Map<String, CaseStatus> BY_CODE = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(CaseStatus::code, Function.identity()));

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static Optional<CaseStatus> fromCode(String code) {
        return Optional.ofNullable(BY_CODE.get(code));
    }
}
```

Untuk Java 8, `Collectors.toUnmodifiableMap` belum ada. Gunakan static block:

```java
private static final Map<String, CaseStatus> BY_CODE;

static {
    Map<String, CaseStatus> map = new HashMap<>();
    for (CaseStatus status : values()) {
        CaseStatus previous = map.put(status.code, status);
        if (previous != null) {
            throw new ExceptionInInitializerError("Duplicate code: " + status.code);
        }
    }
    BY_CODE = Collections.unmodifiableMap(map);
}
```

---

## 6. Equality, Hashing, Comparison

### 6.1 `==` adalah idiom yang benar untuk enum

```java
if (status == CaseStatus.APPROVED) {
    // safe
}
```

Keuntungan `==`:

- null-safe jika constant di kiri:

```java
if (CaseStatus.APPROVED == status) {
    // false when status is null
}
```

- tidak bergantung pada override;
- menggambarkan identity semantics.

---

### 6.2 `equals()` final

`Enum.equals` final dan secara praktis identity-based. Ini menjaga enum constant tidak bisa merusak equality contract.

```java
status.equals(CaseStatus.APPROVED)
```

Akan NPE jika `status` null. Karena itu untuk enum biasanya lebih nyaman:

```java
if (status == CaseStatus.APPROVED) {
    // ...
}
```

---

### 6.3 `compareTo()` berdasarkan ordinal

Enum implement `Comparable`. Urutannya berdasarkan order deklarasi.

```java
RiskLevel.HIGH.compareTo(RiskLevel.LOW) > 0
```

Ini boleh untuk urutan internal yang memang didefinisikan oleh deklarasi enum. Tetapi kalau ordering adalah business rule eksplisit, lebih baik gunakan field:

```java
public enum RiskLevel {
    LOW(10),
    MEDIUM(20),
    HIGH(30),
    CRITICAL(40);

    private final int severityRank;

    RiskLevel(int severityRank) {
        this.severityRank = severityRank;
    }

    public boolean atLeast(RiskLevel other) {
        return this.severityRank >= other.severityRank;
    }
}
```

Kenapa? Karena declaration order bisa berubah untuk readability, sedangkan rank adalah domain rule.

---

## 7. Enum dan Switch

### 7.1 Switch statement Java 8 style

```java
switch (status) {
    case DRAFT:
        return "Editable";
    case SUBMITTED:
        return "Waiting approval";
    case APPROVED:
        return "Closed approved";
    case REJECTED:
        return "Closed rejected";
    default:
        throw new IllegalStateException("Unsupported status: " + status);
}
```

Catatan:

- case label tidak memakai `CaseStatus.DRAFT`, cukup `DRAFT`;
- jika `status` null, switch akan throw `NullPointerException`;
- `default` sering berguna untuk runtime safety, tetapi bisa mengurangi compile-time exhaustiveness benefit di modern switch expression.

---

### 7.2 Switch expression modern

Sejak Java modern, switch expression memungkinkan return value lebih jelas:

```java
String label = switch (status) {
    case DRAFT -> "Editable";
    case SUBMITTED -> "Waiting approval";
    case APPROVED -> "Closed approved";
    case REJECTED -> "Closed rejected";
};
```

Keuntungan:

- lebih ekspresif;
- tidak perlu mutable local variable;
- compiler bisa mengecek exhaustiveness untuk enum jika tidak ada `default` dan semua constants ditangani;
- perubahan enum bisa membuat compile error/warning lebih cepat terdeteksi.

Namun compatibility Java 8 perlu diperhatikan. Jika target runtime/source masih Java 8, gunakan switch statement lama.

---

### 7.3 `default` dalam switch: defensiveness vs exhaustiveness

Dengan `default`, ketika enum baru ditambahkan, compiler tidak memaksa kamu memperbarui switch.

```java
return switch (status) {
    case DRAFT -> "Editable";
    case SUBMITTED -> "Waiting";
    case APPROVED -> "Approved";
    case REJECTED -> "Rejected";
    default -> "Unknown";
};
```

Tanpa `default`, switch internal dapat menjadi alat deteksi perubahan domain:

```java
return switch (status) {
    case DRAFT -> "Editable";
    case SUBMITTED -> "Waiting";
    case APPROVED -> "Approved";
    case REJECTED -> "Rejected";
};
```

Rule praktis:

- untuk **internal exhaustive domain logic**, hindari `default` agar compiler membantu evolusi;
- untuk **external input parsing**, tetap handle unknown explicitly;
- untuk **public library** yang mungkin berhadapan dengan enum version mismatch, pertimbangkan defensive default yang melempar error eksplisit.

---

## 8. Enum dan Serialization

Enum punya special handling dalam Java Object Serialization.

Bukan seluruh field enum constant yang diserialisasi seperti object biasa. Serialized form enum constant pada Java serialization menggunakan nama constant. Saat deserialization, runtime mencari constant dengan nama tersebut.

Implikasi:

1. Rename enum constant dapat merusak deserialization data lama.
2. Field pada enum bukan bagian dari serialized form constant.
3. Enum singleton property tetap dijaga saat deserialization.
4. `serialVersionUID`, `writeObject`, `readObject`, dan mekanisme custom serialization biasa tidak bekerja seperti object normal untuk enum constant.

Contoh problem:

Versi lama:

```java
public enum Status {
    WAITING_APPROVAL
}
```

Data serialized menyimpan nama `WAITING_APPROVAL`.

Versi baru:

```java
public enum Status {
    PENDING_APPROVAL
}
```

Deserialization data lama bisa gagal karena constant `WAITING_APPROVAL` tidak ada lagi.

Rule:

> Treat enum constant names as serialized compatibility surface jika enum pernah masuk Java serialization, JSON default mapping, XML default mapping, message payload, atau database string column.

---

## 9. Enum dan Persistence/API Contracts

### 9.1 Anti-pattern: persist ordinal

```java
// BAD
int dbValue = status.ordinal();
```

Ini berbahaya karena order deklarasi bukan stable external contract.

---

### 9.2 Risky pattern: persist name

```java
// Acceptable only if name is intentionally stable
String dbValue = status.name();
```

Ini lebih baik daripada ordinal, tetapi tetap membuat source identifier menjadi database/API contract.

Boleh jika:

- enum names sudah diperlakukan sebagai public contract;
- rename dianggap breaking change;
- ada migration plan;
- values human-readable dan stabil.

---

### 9.3 Preferred for long-lived systems: explicit code

```java
public enum LicenceStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R"),
    WITHDRAWN("W");

    private final String code;

    LicenceStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static LicenceStatus requireByCode(String code) {
        return fromCode(code).orElseThrow(() ->
                new IllegalArgumentException("Unknown licence status code: " + code));
    }

    public static Optional<LicenceStatus> fromCode(String code) {
        for (LicenceStatus status : values()) {
            if (status.code.equals(code)) {
                return Optional.of(status);
            }
        }
        return Optional.empty();
    }
}
```

Untuk performance, gunakan map static seperti sebelumnya.

---

### 9.4 Unknown value strategy

External systems berubah. API lain bisa mengirim value yang belum dikenal oleh versi aplikasi saat ini.

Ada beberapa strategi:

#### Strategy A — reject unknown

Cocok untuk command/input yang harus valid.

```java
public static LicenceStatus requireByCode(String code) {
    return fromCode(code).orElseThrow(() ->
            new BadRequestException("Unsupported status: " + code));
}
```

#### Strategy B — preserve unknown separately

Cocok untuk integration/event consumer yang tidak boleh drop data.

```java
public record ExternalStatus(LicenceStatus knownStatus, String rawCode) {
    public boolean isKnown() {
        return knownStatus != null;
    }
}
```

#### Strategy C — enum constant `UNKNOWN`

```java
public enum LicenceStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R"),
    UNKNOWN("?");
}
```

Hati-hati: `UNKNOWN` sering menyederhanakan parsing, tetapi bisa menyembunyikan data quality issue. Jangan biarkan `UNKNOWN` masuk ke business transition tanpa aturan eksplisit.

---

## 10. `EnumSet`

`EnumSet` adalah `Set` khusus untuk enum.

```java
EnumSet<Permission> permissions = EnumSet.of(
        Permission.READ,
        Permission.WRITE
);
```

Secara internal, `EnumSet` sangat compact dan efisien karena dapat merepresentasikan set enum sebagai bit vector berdasarkan ordinal. Ini penggunaan ordinal yang benar: internal implementation detail, bukan external persistence.

Contoh:

```java
public enum Permission {
    VIEW_CASE,
    EDIT_CASE,
    APPROVE_CASE,
    REJECT_CASE,
    EXPORT_REPORT
}

EnumSet<Permission> caseOfficerPermissions = EnumSet.of(
        Permission.VIEW_CASE,
        Permission.EDIT_CASE
);

if (caseOfficerPermissions.contains(Permission.EDIT_CASE)) {
    // allowed
}
```

Operasi berguna:

```java
EnumSet<Permission> all = EnumSet.allOf(Permission.class);
EnumSet<Permission> none = EnumSet.noneOf(Permission.class);
EnumSet<Permission> copy = EnumSet.copyOf(caseOfficerPermissions);
EnumSet<Permission> complement = EnumSet.complementOf(caseOfficerPermissions);
```

Kapan gunakan `EnumSet`:

- flags/permissions internal;
- group of enum constants;
- feature toggles compile-time;
- validation allowed states;
- transition source sets.

Contoh state transition:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    WITHDRAWN;

    private static final EnumSet<CaseStatus> TERMINAL =
            EnumSet.of(APPROVED, REJECTED, WITHDRAWN);

    public boolean isTerminal() {
        return TERMINAL.contains(this);
    }
}
```

Catatan: static initialization dalam enum perlu hati-hati jika referensi constant dan static fields terlalu kompleks. Untuk logic yang rumit, pindahkan ke helper class.

---

## 11. `EnumMap`

`EnumMap` adalah `Map` khusus dengan enum key.

```java
EnumMap<CaseStatus, String> labels = new EnumMap<>(CaseStatus.class);
labels.put(CaseStatus.DRAFT, "Draft");
labels.put(CaseStatus.SUBMITTED, "Submitted");
```

Keuntungan dibanding `HashMap<CaseStatus, V>`:

- lebih compact;
- lebih cepat untuk banyak kasus;
- key order mengikuti declaration order;
- tidak butuh hashing umum;
- key type diketahui.

Contoh mapping transition:

```java
public final class CaseTransitions {
    private static final EnumMap<CaseStatus, EnumSet<CaseStatus>> ALLOWED =
            new EnumMap<>(CaseStatus.class);

    static {
        ALLOWED.put(CaseStatus.DRAFT, EnumSet.of(CaseStatus.SUBMITTED, CaseStatus.WITHDRAWN));
        ALLOWED.put(CaseStatus.SUBMITTED, EnumSet.of(CaseStatus.APPROVED, CaseStatus.REJECTED));
        ALLOWED.put(CaseStatus.APPROVED, EnumSet.noneOf(CaseStatus.class));
        ALLOWED.put(CaseStatus.REJECTED, EnumSet.noneOf(CaseStatus.class));
        ALLOWED.put(CaseStatus.WITHDRAWN, EnumSet.noneOf(CaseStatus.class));
    }

    private CaseTransitions() {
    }

    public static boolean canMove(CaseStatus from, CaseStatus to) {
        Objects.requireNonNull(from, "from");
        Objects.requireNonNull(to, "to");
        return ALLOWED.getOrDefault(from, EnumSet.noneOf(CaseStatus.class)).contains(to);
    }
}
```

Untuk production, pastikan map immutable atau tidak terekspos mutable.

Java 8 compatible defensive approach:

```java
private static final Map<CaseStatus, Set<CaseStatus>> ALLOWED;

static {
    EnumMap<CaseStatus, Set<CaseStatus>> map = new EnumMap<>(CaseStatus.class);
    map.put(CaseStatus.DRAFT, Collections.unmodifiableSet(EnumSet.of(CaseStatus.SUBMITTED, CaseStatus.WITHDRAWN)));
    map.put(CaseStatus.SUBMITTED, Collections.unmodifiableSet(EnumSet.of(CaseStatus.APPROVED, CaseStatus.REJECTED)));
    map.put(CaseStatus.APPROVED, Collections.unmodifiableSet(EnumSet.noneOf(CaseStatus.class)));
    map.put(CaseStatus.REJECTED, Collections.unmodifiableSet(EnumSet.noneOf(CaseStatus.class)));
    map.put(CaseStatus.WITHDRAWN, Collections.unmodifiableSet(EnumSet.noneOf(CaseStatus.class)));
    ALLOWED = Collections.unmodifiableMap(map);
}
```

---

## 12. Enum sebagai Domain Model

### 12.1 Good enum domain example

```java
public enum EscalationLevel {
    NONE(0),
    SUPERVISOR(1),
    MANAGER(2),
    DIRECTOR(3);

    private final int rank;

    EscalationLevel(int rank) {
        this.rank = rank;
    }

    public boolean higherThan(EscalationLevel other) {
        return this.rank > other.rank;
    }
}
```

Alasan bagus:

- jumlah level stabil;
- urutan punya domain meaning;
- behavior kecil dan murni;
- tidak membutuhkan data dinamis.

---

### 12.2 Bad enum domain example

```java
public enum Officer {
    ALICE,
    BOB,
    CHARLIE
}
```

Ini buruk karena officer adalah data operasional. Officer bisa join/resign/transfer tanpa release kode.

Lebih baik:

```java
public record OfficerId(String value) {
    public OfficerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Officer id is required");
        }
    }
}
```

Data officer disimpan di database/directory service.

---

### 12.3 Enum untuk state machine

Enum dapat merepresentasikan state, tetapi jangan semua transition orchestration dimasukkan ke enum jika workflow kompleks.

Sederhana:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    WITHDRAWN;

    public boolean isTerminal() {
        return this == APPROVED || this == REJECTED || this == WITHDRAWN;
    }
}
```

Lebih kompleks:

```java
public final class ApplicationWorkflowPolicy {
    public TransitionDecision evaluate(
            Application application,
            ApplicationAction action,
            UserContext actor,
            Clock clock
    ) {
        // cross-entity checks, role checks, deadlines, regulatory rules, etc.
    }
}
```

Rule:

> Enum cocok untuk vocabulary dan invariant lokal. Service/policy/state-machine layer cocok untuk orchestration lintas entity, authorization, deadline, audit, side effect, dan data-driven rules.

---

## 13. Enum dan Polymorphism: Kapan Dipakai?

Enum polymorphism bisa menghilangkan switch yang tersebar.

Contoh:

```java
public enum NotificationChannel {
    EMAIL {
        @Override
        public boolean supportsAttachment() {
            return true;
        }
    },
    SMS {
        @Override
        public boolean supportsAttachment() {
            return false;
        }
    },
    IN_APP {
        @Override
        public boolean supportsAttachment() {
            return false;
        }
    };

    public abstract boolean supportsAttachment();
}
```

Ini baik karena behavior:

- kecil;
- pure;
- tidak butuh dependency;
- melekat pada constant.

Jangan lakukan ini:

```java
public enum NotificationChannel {
    EMAIL {
        @Override
        public void send(Message message) {
            smtpClient.send(message); // smtpClient dari mana?
        }
    }
}
```

Enum constructor tidak cocok untuk DI runtime biasa. Memasukkan service dependency ke enum biasanya membuat desain sulit dites, global, dan kaku.

Lebih baik:

```java
public interface NotificationSender {
    NotificationChannel channel();
    void send(Message message);
}
```

Lalu registry:

```java
public final class NotificationSenderRegistry {
    private final EnumMap<NotificationChannel, NotificationSender> senders;

    public NotificationSenderRegistry(List<NotificationSender> senderList) {
        EnumMap<NotificationChannel, NotificationSender> map = new EnumMap<>(NotificationChannel.class);
        for (NotificationSender sender : senderList) {
            map.put(sender.channel(), sender);
        }
        this.senders = map;
    }

    public NotificationSender senderFor(NotificationChannel channel) {
        NotificationSender sender = senders.get(channel);
        if (sender == null) {
            throw new IllegalStateException("No sender for channel: " + channel);
        }
        return sender;
    }
}
```

---

## 14. Enum Initialization and Static Traps

Enum constants dibuat saat enum class initialized. Urutan deklarasi penting.

Problem muncul jika constructor constant mengakses static field yang belum siap.

```java
public enum BadCode {
    A("A"),
    B("B");

    private static final Map<String, BadCode> BY_CODE = new HashMap<>();

    private final String code;

    BadCode(String code) {
        this.code = code;
        BY_CODE.put(code, this); // problematic: initialization trap
    }
}
```

Jangan register enum constant ke static map dari constructor enum. Bangun map setelah semua constants selesai dibuat.

Benar:

```java
private static final Map<String, GoodCode> BY_CODE = buildMap();

private static Map<String, GoodCode> buildMap() {
    Map<String, GoodCode> map = new HashMap<>();
    for (GoodCode value : values()) {
        map.put(value.code, value);
    }
    return Collections.unmodifiableMap(map);
}
```

---

## 15. Enum and Class Metadata

Karena enum adalah class, kamu bisa inspeksi metadata:

```java
Class<CaseStatus> type = CaseStatus.class;

System.out.println(type.isEnum());
System.out.println(Arrays.toString(type.getEnumConstants()));
```

`getEnumConstants()` berguna untuk generic framework:

```java
public static <E extends Enum<E>> Map<String, E> byName(Class<E> enumType) {
    E[] constants = enumType.getEnumConstants();
    if (constants == null) {
        throw new IllegalArgumentException("Not an enum type: " + enumType);
    }

    Map<String, E> map = new LinkedHashMap<>();
    for (E constant : constants) {
        map.put(constant.name(), constant);
    }
    return Collections.unmodifiableMap(map);
}
```

Generic bound penting:

```java
<E extends Enum<E>>
```

Ini berarti `E` adalah enum yang comparable terhadap type-nya sendiri.

---

## 16. Enum and Generics

### 16.1 Generic parser

```java
public final class EnumParsers {
    private EnumParsers() {
    }

    public static <E extends Enum<E>> Optional<E> parseName(Class<E> enumType, String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(Enum.valueOf(enumType, raw));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
```

Pemakaian:

```java
Optional<CaseStatus> status = EnumParsers.parseName(CaseStatus.class, rawStatus);
```

Namun untuk external code, generic `name()` parser sering kurang ideal. Lebih baik enum implement interface:

```java
public interface CodedEnum {
    String code();
}

public enum CaseStatus implements CodedEnum {
    DRAFT("D"), SUBMITTED("S"), APPROVED("A"), REJECTED("R");

    private final String code;

    CaseStatus(String code) { this.code = code; }

    @Override
    public String code() { return code; }
}
```

Generic parser:

```java
public static <E extends Enum<E> & CodedEnum> Optional<E> parseCode(
        Class<E> enumType,
        String code
) {
    if (code == null) {
        return Optional.empty();
    }
    for (E constant : enumType.getEnumConstants()) {
        if (constant.code().equals(code)) {
            return Optional.of(constant);
        }
    }
    return Optional.empty();
}
```

Perhatikan bound:

```java
<E extends Enum<E> & CodedEnum>
```

Artinya `E` harus enum dan implement `CodedEnum`.

---

## 17. Enum Compatibility Java 8–25

Enum sudah ada sejak Java 5. Dari Java 8 sampai Java 25, semantics fundamental enum relatif stabil. Yang berubah lebih banyak adalah fitur bahasa di sekitarnya:

- Java 8: enum umum, switch statement, lambdas bisa membantu mapping;
- Java 9+: module system memengaruhi reflection dan package boundary, bukan enum semantics langsung;
- Java 12/14+: switch expression menjadi bagian penting untuk enum exhaustive mapping;
- Java 17+: sealed classes memberi alternatif modelling untuk closed hierarchy yang lebih kaya;
- Java 21+: pattern matching switch final, berguna dalam desain sealed hierarchy; enum tetap berperan untuk closed simple constants;
- Java 25: enum tetap core stable contract di `java.lang`.

### 17.1 Enum vs sealed hierarchy

Gunakan enum ketika varian tidak perlu payload berbeda.

```java
public enum PaymentState {
    PENDING,
    PAID,
    FAILED
}
```

Gunakan sealed hierarchy ketika setiap varian membawa data berbeda.

```java
public sealed interface PaymentResult permits PaymentResult.Success, PaymentResult.Failure {
    record Success(String receiptNo) implements PaymentResult {}
    record Failure(String reasonCode, String message) implements PaymentResult {}
}
```

Rule:

> Enum cocok untuk named alternatives tanpa per-instance payload. Sealed hierarchy cocok untuk algebraic alternatives dengan struktur data berbeda per variant.

---

## 18. Enum in JSON/XML/Database Mapping

Walaupun detail Jackson/JPA/JAXB tidak dibahas panjang di seri ini, prinsip enum contract penting.

### 18.1 JSON default mapping risk

Banyak library default-nya serialize enum sebagai `name()`.

```json
{
  "status": "SUBMITTED"
}
```

Kalau enum rename, API break.

Better explicit code:

```json
{
  "status": "SUB"
}
```

Atau jelas sejak awal bahwa `SUBMITTED` adalah public stable API value.

---

### 18.2 Database mapping risk

JPA `EnumType.ORDINAL` adalah trap untuk long-lived systems.

Lebih aman:

- string stable name;
- explicit code converter;
- lookup table jika value perlu data-driven;
- separate status table jika workflow states configurable.

---

### 18.3 XML attribute/value risk

XML integration sering membawa enum sebagai attribute:

```xml
<Application status="SUBMITTED" />
```

Sama seperti JSON, tentukan apakah `SUBMITTED` adalah internal name atau external code.

Untuk XML schema, enum values bisa menjadi schema contract. Rename berarti schema breaking change.

---

## 19. Design Pattern: Stable Coded Enum

Template Java 8-compatible:

```java
public interface CodeEnum {
    String code();
}
```

```java
public enum ReviewDecision implements CodeEnum {
    APPROVE("APP", true),
    REJECT("REJ", true),
    REQUEST_INFORMATION("RFI", false),
    ESCALATE("ESC", false);

    private static final Map<String, ReviewDecision> BY_CODE = buildByCode();

    private final String code;
    private final boolean terminal;

    ReviewDecision(String code, boolean terminal) {
        this.code = code;
        this.terminal = terminal;
    }

    @Override
    public String code() {
        return code;
    }

    public boolean isTerminal() {
        return terminal;
    }

    public static Optional<ReviewDecision> fromCode(String code) {
        return Optional.ofNullable(BY_CODE.get(code));
    }

    public static ReviewDecision requireCode(String code) {
        ReviewDecision decision = BY_CODE.get(code);
        if (decision == null) {
            throw new IllegalArgumentException("Unknown review decision code: " + code);
        }
        return decision;
    }

    private static Map<String, ReviewDecision> buildByCode() {
        Map<String, ReviewDecision> map = new HashMap<>();
        for (ReviewDecision decision : values()) {
            ReviewDecision previous = map.put(decision.code, decision);
            if (previous != null) {
                throw new ExceptionInInitializerError(
                        "Duplicate ReviewDecision code: " + decision.code);
            }
        }
        return Collections.unmodifiableMap(map);
    }
}
```

Checklist:

- `code` final;
- map immutable;
- duplicate code detected at class initialization;
- parsing explicit;
- unknown handling explicit;
- `name()` not exposed accidentally;
- display label tidak dicampur dengan code.

---

## 20. Design Pattern: Enum-Based Policy Matrix

Untuk policy kecil dan stabil:

```java
public enum Role {
    OFFICER,
    SUPERVISOR,
    DIRECTOR
}
```

```java
public enum Action {
    CREATE_CASE,
    EDIT_CASE,
    APPROVE_CASE,
    CLOSE_CASE
}
```

```java
public final class RoleActionPolicy {
    private static final EnumMap<Role, EnumSet<Action>> ALLOWED = new EnumMap<>(Role.class);

    static {
        ALLOWED.put(Role.OFFICER, EnumSet.of(Action.CREATE_CASE, Action.EDIT_CASE));
        ALLOWED.put(Role.SUPERVISOR, EnumSet.of(Action.CREATE_CASE, Action.EDIT_CASE, Action.APPROVE_CASE));
        ALLOWED.put(Role.DIRECTOR, EnumSet.allOf(Action.class));
    }

    private RoleActionPolicy() {
    }

    public static boolean allowed(Role role, Action action) {
        Objects.requireNonNull(role, "role");
        Objects.requireNonNull(action, "action");
        return ALLOWED.getOrDefault(role, EnumSet.noneOf(Action.class)).contains(action);
    }
}
```

Kapan ini cocok:

- role/action compile-time fixed;
- policy kecil;
- tidak perlu admin configuration;
- perubahan policy lewat release aplikasi dapat diterima.

Kapan tidak cocok:

- authorization matrix configurable;
- policy per agency/tenant;
- policy perlu audit admin change;
- policy butuh effective date;
- policy kompleks dengan condition.

---

## 21. Design Pattern: State Transition Table

```java
public enum CaseState {
    DRAFT,
    SUBMITTED,
    REVIEWING,
    APPROVED,
    REJECTED,
    WITHDRAWN
}
```

```java
public enum CaseEvent {
    SUBMIT,
    START_REVIEW,
    APPROVE,
    REJECT,
    WITHDRAW
}
```

```java
public final class CaseStateMachine {
    private static final EnumMap<CaseState, EnumMap<CaseEvent, CaseState>> TRANSITIONS = buildTransitions();

    private CaseStateMachine() {
    }

    public static Optional<CaseState> next(CaseState current, CaseEvent event) {
        Objects.requireNonNull(current, "current");
        Objects.requireNonNull(event, "event");

        Map<CaseEvent, CaseState> byEvent = TRANSITIONS.get(current);
        if (byEvent == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(byEvent.get(event));
    }

    private static EnumMap<CaseState, EnumMap<CaseEvent, CaseState>> buildTransitions() {
        EnumMap<CaseState, EnumMap<CaseEvent, CaseState>> table = new EnumMap<>(CaseState.class);

        put(table, CaseState.DRAFT, CaseEvent.SUBMIT, CaseState.SUBMITTED);
        put(table, CaseState.DRAFT, CaseEvent.WITHDRAW, CaseState.WITHDRAWN);
        put(table, CaseState.SUBMITTED, CaseEvent.START_REVIEW, CaseState.REVIEWING);
        put(table, CaseState.REVIEWING, CaseEvent.APPROVE, CaseState.APPROVED);
        put(table, CaseState.REVIEWING, CaseEvent.REJECT, CaseState.REJECTED);

        return table;
    }

    private static void put(
            EnumMap<CaseState, EnumMap<CaseEvent, CaseState>> table,
            CaseState from,
            CaseEvent event,
            CaseState to
    ) {
        EnumMap<CaseEvent, CaseState> byEvent = table.get(from);
        if (byEvent == null) {
            byEvent = new EnumMap<>(CaseEvent.class);
            table.put(from, byEvent);
        }
        CaseState previous = byEvent.put(event, to);
        if (previous != null) {
            throw new IllegalStateException("Duplicate transition: " + from + " + " + event);
        }
    }
}
```

Ini baik untuk state machine kecil-medium. Untuk enterprise workflow besar, table ini bisa menjadi bagian dari domain policy, tetapi orchestration tetap memerlukan service layer untuk:

- permission checks;
- locking;
- audit;
- side effects;
- notification;
- SLA calculation;
- transactional consistency;
- cross-entity validation.

---

## 22. Failure Modes

### 22.1 Menyimpan `ordinal()`

Gejala:

- data lama berubah makna setelah enum ditambah/diurut ulang;
- audit trail tidak bisa dipercaya;
- migration sulit karena angka tidak self-describing.

Solusi:

- gunakan explicit code;
- migrasikan ordinal ke code string;
- tambahkan test yang melarang ordinal mapping untuk persistence.

---

### 22.2 Rename enum constant tanpa migration

Gejala:

- JSON lama gagal parse;
- Java serialization gagal;
- DB string mapping gagal;
- message consumer gagal consume event lama.

Solusi:

- treat enum name sebagai public contract kalau sudah keluar boundary;
- gunakan explicit code;
- support alias parsing jika rename tidak terhindarkan.

Contoh alias:

```java
public static Optional<CaseStatus> fromExternal(String raw) {
    if (raw == null) return Optional.empty();
    switch (raw) {
        case "SUBMITTED":
        case "PENDING_SUBMISSION_REVIEW":
            return Optional.of(SUBMITTED);
        default:
            return Optional.empty();
    }
}
```

---

### 22.3 Enum untuk dynamic master data

Gejala:

- tambah data harus deploy;
- emergency operational change sulit;
- environment berbeda punya enum needs berbeda;
- database punya values yang tidak ada di code.

Solusi:

- pindahkan ke table/config;
- gunakan value object ID;
- enum hanya untuk category yang benar-benar compile-time stable.

---

### 22.4 Switch default menyembunyikan enum baru

Gejala:

- enum baru ditambahkan;
- compiler tidak memaksa update logic;
- business behavior jatuh ke default yang salah.

Solusi:

- hindari `default` pada exhaustive internal switch expression;
- test coverage per enum constant;
- gunakan helper yang memverifikasi semua enum constants punya mapping.

Contoh verification:

```java
static {
    EnumSet<CaseStatus> missing = EnumSet.allOf(CaseStatus.class);
    missing.removeAll(LABELS.keySet());
    if (!missing.isEmpty()) {
        throw new ExceptionInInitializerError("Missing labels for: " + missing);
    }
}
```

---

### 22.5 Enum behavior terlalu berat

Gejala:

- enum memanggil service/database;
- sulit mock;
- static global dependency;
- cyclic initialization;
- policy sulit diaudit.

Solusi:

- enum hanya simpan vocabulary/invariant lokal;
- orchestration pindah ke service/policy object;
- gunakan registry berbasis `EnumMap` jika perlu dispatch.

---

### 22.6 Display label dicampur dengan stable code

Gejala:

- label UI berubah merusak API;
- i18n sulit;
- code external tidak stabil.

Solusi:

Pisahkan:

```java
public enum Status {
    SUBMITTED("SUB", "status.submitted");

    private final String code;
    private final String messageKey;
}
```

- `code` untuk API/DB;
- `messageKey` untuk localization;
- localized label dari message bundle, bukan enum `toString()`.

---

## 23. Performance and Memory Considerations

### 23.1 Enum allocation

Enum constants dibuat sekali saat class initialization. Menggunakan enum constant tidak mengalokasikan object baru.

```java
CaseStatus status = CaseStatus.APPROVED; // reference to existing singleton
```

---

### 23.2 `values()` creates array copy

`values()` mengembalikan array. Umumnya compiler-generated method mengembalikan clone/copy agar caller tidak bisa memodifikasi internal array.

Dalam hot path, hindari memanggil `values()` berulang-ulang.

```java
private static final CaseStatus[] ALL = CaseStatus.values();
```

Namun jangan expose array mutable:

```java
public static CaseStatus[] allUnsafe() {
    return ALL; // BAD: caller can mutate array contents
}
```

Lebih aman:

```java
private static final List<CaseStatus> ALL =
        Collections.unmodifiableList(Arrays.asList(values()));

public static List<CaseStatus> all() {
    return ALL;
}
```

---

### 23.3 Prefer `EnumMap`/`EnumSet`

Untuk enum keys/sets, `EnumMap` dan `EnumSet` biasanya lebih tepat daripada `HashMap`/`HashSet`.

```java
EnumMap<Status, Integer> counts = new EnumMap<>(Status.class);
EnumSet<Status> terminalStates = EnumSet.of(Status.APPROVED, Status.REJECTED);
```

---

## 24. Security and Robustness Considerations

### 24.1 External enum input is untrusted input

Jangan parse external string dengan asumsi pasti valid.

```java
Status.valueOf(request.status()) // can throw
```

Lebih baik:

```java
Status status = Status.fromCode(request.status())
        .orElseThrow(() -> new BadRequestException("Invalid status"));
```

Untuk error response, hati-hati jangan membocorkan internal enum names jika itu bukan public contract.

---

### 24.2 Unknown values in integration

Untuk event consumer, unknown enum value bisa berarti producer lebih baru daripada consumer. Jangan otomatis drop event.

Strategi:

- reject and dead-letter;
- preserve raw value;
- route to manual review;
- degrade gracefully jika safe;
- alert compatibility issue.

---

### 24.3 Authorization enum trap

Enum permission/action cocok untuk internal code vocabulary. Tetapi jangan menganggap `EnumSet<Permission>` cukup untuk authorization enterprise jika rule sebenarnya bergantung pada:

- tenant;
- agency;
- record ownership;
- state;
- delegation;
- effective date;
- conflict of interest;
- separation of duty;
- case sensitivity;
- regulatory audit constraints.

Enum dapat menjadi vocabulary. Policy engine/service menentukan keputusan.

---

## 25. Testing Strategy

### 25.1 Test external code uniqueness

```java
@Test
void codesMustBeUnique() {
    Set<String> codes = new HashSet<>();
    for (ReviewDecision decision : ReviewDecision.values()) {
        assertTrue(codes.add(decision.code()), "Duplicate code: " + decision.code());
    }
}
```

Walaupun sudah ada static initializer, test membuat intent lebih eksplisit.

---

### 25.2 Test parser known/unknown/null

```java
@Test
void parseKnownCode() {
    assertEquals(Optional.of(ReviewDecision.APPROVE), ReviewDecision.fromCode("APP"));
}

@Test
void parseUnknownCode() {
    assertEquals(Optional.empty(), ReviewDecision.fromCode("UNKNOWN"));
}

@Test
void parseNullCode() {
    assertEquals(Optional.empty(), ReviewDecision.fromCode(null));
}
```

---

### 25.3 Test all enum values mapped

```java
@Test
void allStatusesHaveLabels() {
    for (CaseStatus status : CaseStatus.values()) {
        assertNotNull(StatusLabels.labelFor(status));
    }
}
```

---

### 25.4 Test transition completeness

```java
@Test
void terminalStatesHaveNoOutgoingTransition() {
    for (CaseState state : EnumSet.of(CaseState.APPROVED, CaseState.REJECTED, CaseState.WITHDRAWN)) {
        for (CaseEvent event : CaseEvent.values()) {
            assertEquals(Optional.empty(), CaseStateMachine.next(state, event));
        }
    }
}
```

---

## 26. Production Checklist

Sebelum enum dipakai di sistem production, cek:

1. Apakah value set benar-benar compile-time stable?
2. Apakah enum ini akan masuk database/API/XML/JSON/message/event/audit?
3. Jika iya, apakah external representation memakai `name()` atau explicit `code()`?
4. Apakah `ordinal()` dipakai di luar internal memory structure? Jika iya, ubah.
5. Apakah rename constant dianggap breaking change?
6. Apakah unknown external value ditangani eksplisit?
7. Apakah enum punya display label? Jika iya, apakah label dipisah dari code?
8. Apakah switch logic exhaustive?
9. Apakah ada `default` yang menyembunyikan enum baru?
10. Apakah semua enum value punya mapping di UI/API/policy?
11. Apakah `EnumMap`/`EnumSet` lebih cocok daripada `HashMap`/`HashSet`?
12. Apakah enum behavior masih pure dan kecil?
13. Apakah enum constructor bebas dari static initialization trap?
14. Apakah Java serialization compatibility relevan?
15. Apakah integration consumer perlu preserve raw unknown value?
16. Apakah role/permission enum hanya vocabulary, bukan keseluruhan authorization decision?
17. Apakah tests memverifikasi uniqueness, completeness, dan unknown handling?

---

## 27. Thought Exercise

Bayangkan ada enum:

```java
public enum EnforcementCaseStatus {
    NEW,
    PENDING_REVIEW,
    INVESTIGATING,
    ACTION_REQUIRED,
    CLOSED
}
```

Pertanyaan desain:

1. Apakah status ini compile-time stable atau agency-configurable?
2. Apakah status ini akan disimpan di DB?
3. Apakah API publik mengirim status ini?
4. Apakah perlu external code seperti `N`, `PR`, `INV`, `AR`, `CL`?
5. Apa yang terjadi jika `ACTION_REQUIRED` diganti menjadi `PENDING_ACTION`?
6. Apakah `CLOSED` cukup, atau perlu `CLOSED_APPROVED`, `CLOSED_REJECTED`, `CLOSED_WITHDRAWN`?
7. Apakah state transition bisa ditaruh di enum, atau perlu policy service?
8. Apakah switch expression tanpa default lebih baik untuk mapping internal?
9. Apakah consumer event lama harus menerima status unknown?
10. Apakah audit trail harus menyimpan raw code, enum name, label, atau semuanya?

Jawaban top-tier biasanya bukan “pakai enum atau tidak”, tetapi menentukan boundary:

- enum sebagai internal vocabulary;
- code sebagai external contract;
- label sebagai presentation concern;
- transition sebagai policy;
- audit sebagai immutable historical record;
- unknown sebagai compatibility signal.

---

## 28. Ringkasan

Enum adalah salah satu fitur Java yang terlihat sederhana tetapi sangat strategis.

Mental model utamanya:

- enum constant adalah singleton object, bukan sekadar string/integer;
- enum adalah closed set yang cocok untuk compile-time vocabulary;
- `==` aman dan idiomatis untuk enum comparison;
- `name()` adalah source identifier, bukan selalu external code;
- `ordinal()` hampir tidak boleh menjadi persistence/API contract;
- `valueOf()` case-sensitive dan berbasis `name()`;
- explicit `code()` lebih aman untuk long-lived integration;
- Java serialization enum berbasis constant name;
- `EnumMap` dan `EnumSet` adalah struktur data khusus yang sangat tepat untuk enum;
- switch expression modern memberi exhaustiveness checking, tetapi `default` bisa menyembunyikan perubahan enum;
- enum behavior bagus untuk logic kecil dan pure, buruk untuk dependency-heavy orchestration;
- enum cocok untuk vocabulary, bukan master data dinamis;
- untuk workflow/regulatory systems, enum harus dipisahkan dari policy, transition orchestration, audit, dan external representation.

Jika kamu menguasai enum sampai level ini, kamu akan menghindari salah satu sumber bug jangka panjang paling umum di sistem Java: enum yang awalnya tampak kecil, lalu diam-diam menjadi kontrak database, API, event, audit, workflow, dan authorization tanpa desain compatibility yang jelas.

---

## 29. Referensi Resmi

- Java SE 25 API — `java.lang.Enum`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Enum.html
- Java SE 25 API — `java.util.EnumSet`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html
- Java SE 25 API — `java.util.EnumMap`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html
- Java Language Specification SE 25 — Enum Classes: https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.9
- Java Language Specification SE 25 — Evolution of Enum Classes: https://docs.oracle.com/javase/specs/jls/se25/html/jls-13.html#jls-13.4.26
- Java Object Serialization Specification SE 25 — Serialization of Enum Constants: https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/serial-arch.html#serialization-of-enum-constants

---

## 30. Status Seri

Selesai: **Part 8 dari 32**.

Seri belum selesai. Part berikutnya:

**Part 9 — `Record`: Runtime Contract, Value Carrier Semantics, and API Boundaries**

File berikutnya:

`09-record-runtime-contract-value-carrier-api-boundaries.md`

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 7 — `Boolean`, `Character`, Unicode Classification, and Primitive Edge Cases](./07-boolean-character-unicode-classification-primitive-edge-cases.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 9 — `Record`: Runtime Contract, Value Carrier Semantics, and API Boundaries](./09-record-runtime-contract-value-carrier-api-boundaries.md)

</div>