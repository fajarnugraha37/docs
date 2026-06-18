# Part 13 — Embeddables, Value Objects, Attribute Converters, and Type Systems

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `13-embeddables-value-objects-converters-type-systems.md`  
> Scope Java: 8 hingga 25  
> Scope API: JPA 2.1/2.2 (`javax.persistence`) hingga Jakarta Persistence 3.x (`jakarta.persistence`)  
> Scope Provider: Hibernate ORM 5/6/7, EclipseLink 2/3/4

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas:

1. ORM sebagai state synchronization engine.
2. Perbedaan specification vs provider reality.
3. Bootstrap provider dan metadata.
4. Entity identity.
5. Persistence context.
6. Dirty checking.
7. Flush semantics.
8. SQL generation dan dialect.
9. Mapping strategy.
10. Association mapping.
11. Collection mapping.
12. Cascade, orphan removal, dan aggregate boundary.
13. Inheritance mapping.

Part ini membahas hal yang terlihat kecil tetapi sangat menentukan kualitas model persistence: **value object, embeddable, converter, dan type system**.

Di banyak codebase enterprise, bug ORM tidak selalu berasal dari association besar. Banyak bug justru berasal dari hal yang tampak sederhana:

- status disimpan sebagai `String` tanpa invariant,
- money disimpan sebagai `BigDecimal` polos tanpa currency,
- date range disimpan sebagai dua kolom tanpa validasi,
- converter enum salah mapping,
- converter JSON tidak deterministic,
- mutable value object berubah tapi dirty checking tidak menangkap,
- `@Embeddable` dipakai seperti entity kecil padahal tidak punya identity,
- value object dipakai sebagai DTO request lalu persistence state rusak,
- kolom database punya semantics kuat tetapi Java type-nya terlalu lemah.

Part ini membangun mental model bahwa **mapping type adalah mapping semantics**, bukan hanya mapping data representation.

---

## 1. Core Mental Model

### 1.1 Entity adalah identity object; embeddable adalah state/value object

Dalam ORM, perbedaan paling penting adalah:

| Konsep | Punya identity sendiri? | Punya lifecycle sendiri? | Bisa direferensikan dari banyak aggregate? | Biasanya punya tabel sendiri? |
|---|---:|---:|---:|---:|
| Entity | Ya | Ya | Bisa | Ya |
| Embeddable / value object | Tidak | Tidak | Tidak sebagai shared mutable object | Tidak harus; biasanya kolom owner atau collection table |
| Basic type | Tidak | Tidak | Tidak | Satu kolom |
| Converter-backed type | Tidak | Tidak | Tidak | Satu kolom atau representasi basic |

Entity menjawab pertanyaan:

> “Benda ini siapa?”

Value object menjawab pertanyaan:

> “Nilai ini apa?”

Contoh:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @Embedded
    private CaseReference reference;

    @Embedded
    private Money claimAmount;

    @Embedded
    private DateRange validityPeriod;
}
```

`CaseFile` punya identity. `CaseReference`, `Money`, dan `DateRange` tidak punya identity sendiri. Mereka adalah bagian dari state `CaseFile`.

Kalau `CaseFile` berubah dari:

```text
claimAmount = SGD 100.00
```

menjadi:

```text
claimAmount = SGD 150.00
```

maka bukan `Money` yang “di-update sebagai row sendiri”, tetapi state `CaseFile` yang berubah.

---

### 1.2 Value object harus membawa invariant, bukan hanya grouping field

`@Embeddable` sering dipakai hanya untuk mengelompokkan kolom:

```java
@Embeddable
public class Address {
    private String line1;
    private String line2;
    private String postalCode;
}
```

Itu tidak salah. Tapi kualitas model naik drastis ketika value object juga membawa invariant:

```java
@Embeddable
public class DateRange {
    @Column(name = "valid_from")
    private LocalDate from;

    @Column(name = "valid_to")
    private LocalDate to;

    protected DateRange() {
        // for JPA
    }

    public DateRange(LocalDate from, LocalDate to) {
        if (from == null) {
            throw new IllegalArgumentException("from is required");
        }
        if (to != null && to.isBefore(from)) {
            throw new IllegalArgumentException("to must not be before from");
        }
        this.from = from;
        this.to = to;
    }

    public boolean contains(LocalDate date) {
        return !date.isBefore(from) && (to == null || !date.isAfter(to));
    }
}
```

Tanpa value object, invariant tersebar:

```java
if (validTo != null && validTo.isBefore(validFrom)) { ... }
```

Dengan value object, invariant menjadi bagian dari model.

ORM yang baik bukan hanya menyimpan data. ORM yang baik memungkinkan domain model tetap meaningful sambil tetap bisa dipersist.

---

### 1.3 Type system adalah garis pertahanan pertama sebelum database constraint

Misalnya ada kolom:

```sql
case_status varchar(30) not null
```

Model lemah:

```java
private String status;
```

Masalah:

- typo bisa masuk: `"APROVED"`,
- status ilegal bisa masuk: `"BANANA"`,
- transition tidak terkontrol,
- query tersebar dengan literal string,
- refactor sulit,
- audit semantics lemah.

Model lebih kuat:

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

Lebih kuat lagi jika transition dikontrol:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    WITHDRAWN;

    public boolean canTransitionTo(CaseStatus target) {
        return switch (this) {
            case DRAFT -> target == SUBMITTED || target == WITHDRAWN;
            case SUBMITTED -> target == UNDER_REVIEW || target == WITHDRAWN;
            case UNDER_REVIEW -> target == APPROVED || target == REJECTED;
            case APPROVED, REJECTED, WITHDRAWN -> false;
        };
    }
}
```

Untuk Java 8, `switch` expression diganti dengan `switch` statement biasa.

Point-nya: semakin banyak semantics yang dibawa oleh type, semakin sedikit illegal state yang bisa hidup di aplikasi.

---

## 2. Basic, Embeddable, Converter, dan Custom Type

Dalam JPA/Hibernate/EclipseLink, mapping field bisa dipahami sebagai beberapa kategori besar.

### 2.1 Basic type

Basic type adalah atribut yang biasanya dipetakan ke satu kolom.

Contoh:

```java
private String name;
private Integer quantity;
private BigDecimal amount;
private LocalDate submittedDate;
private Instant createdAt;
```

Provider punya daftar type bawaan. Jakarta Persistence mendefinisikan tipe-tipe basic standar, sementara provider seperti Hibernate dan EclipseLink menambah dukungan tambahan lewat extension/type system masing-masing.

Gunakan basic type jika:

- semantics-nya sederhana,
- tidak ada invariant lintas field,
- representasi Java sudah cukup kuat,
- satu field memang satu konsep.

Jangan pakai basic type lemah jika domain punya semantics kuat.

Contoh buruk:

```java
private String postalCode;
private String email;
private String caseReferenceNo;
private BigDecimal money;
```

Lebih baik:

```java
private PostalCode postalCode;
private EmailAddress email;
private CaseReferenceNo caseReferenceNo;
private Money money;
```

Agar bisa dipersist, nanti bisa memakai `@Embeddable`, `AttributeConverter`, atau provider custom type.

---

### 2.2 Embeddable type

Embeddable dipakai ketika value object terdiri dari beberapa atribut yang dipetakan ke beberapa kolom, atau ketika kita ingin grouping state tanpa identity sendiri.

```java
@Embeddable
public class Money {
    @Column(name = "amount", precision = 19, scale = 4)
    private BigDecimal amount;

    @Column(name = "currency", length = 3)
    private String currency;

    protected Money() {}

    public Money(BigDecimal amount, String currency) {
        if (amount == null) throw new IllegalArgumentException("amount is required");
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("currency must be ISO-4217 code");
        }
        this.amount = amount;
        this.currency = currency;
    }
}
```

Owner:

```java
@Entity
public class Invoice {
    @Id
    private Long id;

    @Embedded
    private Money total;
}
```

Default mapping dapat menghasilkan kolom:

```text
amount
currency
```

Jika ada dua `Money` dalam entity yang sama, perlu `@AttributeOverrides`:

```java
@Entity
public class PaymentOrder {
    @Id
    private Long id;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "amount", column = @Column(name = "requested_amount", precision = 19, scale = 4)),
        @AttributeOverride(name = "currency", column = @Column(name = "requested_currency", length = 3))
    })
    private Money requestedAmount;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "amount", column = @Column(name = "approved_amount", precision = 19, scale = 4)),
        @AttributeOverride(name = "currency", column = @Column(name = "approved_currency", length = 3))
    })
    private Money approvedAmount;
}
```

---

### 2.3 AttributeConverter

`AttributeConverter<X, Y>` mengubah type domain `X` menjadi database representation `Y`.

Contoh:

```java
@Converter(autoApply = true)
public class CaseReferenceConverter implements AttributeConverter<CaseReference, String> {

    @Override
    public String convertToDatabaseColumn(CaseReference attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public CaseReference convertToEntityAttribute(String dbData) {
        return dbData == null ? null : CaseReference.of(dbData);
    }
}
```

Domain type:

```java
public final class CaseReference {
    private final String value;

    private CaseReference(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case reference is required");
        }
        if (!value.matches("CASE-[0-9]{8}")) {
            throw new IllegalArgumentException("invalid case reference format");
        }
        this.value = value;
    }

    public static CaseReference of(String value) {
        return new CaseReference(value);
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CaseReference)) return false;
        CaseReference that = (CaseReference) o;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }
}
```

Untuk Java 16+, ini bisa dibuat sebagai `record`, tetapi hati-hati dengan provider/proxy/constructor behavior:

```java
public record CaseReference(String value) {
    public CaseReference {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case reference is required");
        }
        if (!value.matches("CASE-[0-9]{8}")) {
            throw new IllegalArgumentException("invalid case reference format");
        }
    }
}
```

Converter cocok jika:

- value object direpresentasikan sebagai satu kolom,
- type domain immutable,
- konversi deterministic,
- database representation adalah basic type,
- query binding masih manageable.

---

### 2.4 Provider custom type

Kadang `AttributeConverter` terlalu terbatas. Provider custom type diperlukan jika:

- butuh kontrol JDBC type lebih rendah,
- butuh binding khusus,
- butuh mapping database-specific seperti PostgreSQL JSONB, ARRAY, enum native,
- butuh mutability plan,
- butuh SQL literal rendering khusus,
- butuh multiple behavior yang tidak diekspresikan oleh converter standar.

Hibernate punya type system yang jauh lebih kaya dari JPA converter. Hibernate 6/7 memisahkan beberapa konsep seperti Java type, JDBC type, basic type, converter, mutability plan, dan registration mechanism.

EclipseLink punya converter extension seperti `ObjectTypeConverter`, `TypeConversionConverter`, `SerializedObjectConverter`, transformation mapping, dan descriptor customizer.

Rule of thumb:

| Kebutuhan | Pilihan awal |
|---|---|
| Satu value object ke satu kolom string/number/date | `AttributeConverter` |
| Beberapa field ke beberapa kolom | `@Embeddable` |
| Value object collection | `@ElementCollection` atau entity child tergantung semantics |
| Database-specific JSON/ARRAY/native enum | Provider custom type atau native mapping extension |
| Butuh query portable lintas provider | Hindari custom type terlalu dalam |
| Butuh performance/DB-specific correctness | Provider custom type bisa justified |

---

## 3. Entity vs Value Object: Invariant Utama

### 3.1 Entity punya lifecycle independen

Entity:

```java
@Entity
public class Person {
    @Id
    private Long id;

    private String name;
}
```

Walau namanya berubah, `Person` tetap orang yang sama.

```text
Person#10 name = "Alice"
Person#10 name = "Alicia"
```

Identity tetap `10`.

### 3.2 Value object tidak punya identity independen

Value object:

```java
@Embeddable
public class Address {
    private String line1;
    private String postalCode;
}
```

Jika address berubah, tidak ada konsep “Address yang sama tetapi state berubah” kecuali sebagai bagian dari owner.

```text
CaseFile#100.address = Address(A, 123456)
CaseFile#100.address = Address(B, 654321)
```

Yang berubah adalah state `CaseFile#100`.

### 3.3 Jangan share mutable value object

Ini buruk:

```java
Address sharedAddress = new Address("A", "123456");

case1.setAddress(sharedAddress);
case2.setAddress(sharedAddress);

sharedAddress.setPostalCode("999999");
```

Masalah:

- Apakah kedua case harus berubah?
- Apakah dirty checking menangkap dua owner?
- Apakah semantic-nya benar?
- Apakah ini sebenarnya entity `Address`?

Value object idealnya immutable:

```java
@Embeddable
public class Address {
    @Column(name = "address_line1")
    private String line1;

    @Column(name = "postal_code")
    private String postalCode;

    protected Address() {}

    public Address(String line1, String postalCode) {
        if (line1 == null || line1.isBlank()) throw new IllegalArgumentException("line1 is required");
        if (postalCode == null || !postalCode.matches("[0-9]{6}")) {
            throw new IllegalArgumentException("postal code must be 6 digits");
        }
        this.line1 = line1;
        this.postalCode = postalCode;
    }

    public Address withPostalCode(String newPostalCode) {
        return new Address(this.line1, newPostalCode);
    }
}
```

Lalu update owner:

```java
caseFile.changeAddress(caseFile.getAddress().withPostalCode("654321"));
```

Ini lebih jelas untuk dirty checking dan domain reasoning.

---

## 4. Designing Good Value Objects

### 4.1 Value object harus immutable secara konseptual

Ideal value object:

- field final jika memungkinkan,
- tidak punya setter publik,
- constructor/factory melakukan validation,
- equality berdasarkan semua significant fields,
- tidak punya identity DB,
- operasi menghasilkan instance baru, bukan mutate in place.

Namun JPA tradisional membutuhkan no-arg constructor dan akses field/property. Ini membuat immutable value object lebih tricky.

Contoh kompromi untuk Java 8–25:

```java
@Embeddable
public class Money {
    @Column(name = "amount", precision = 19, scale = 4, nullable = false)
    private BigDecimal amount;

    @Column(name = "currency", length = 3, nullable = false)
    private String currency;

    protected Money() {
        // required by JPA provider
    }

    private Money(BigDecimal amount, String currency) {
        this.amount = normalizeAmount(amount);
        this.currency = normalizeCurrency(currency);
    }

    public static Money of(BigDecimal amount, String currency) {
        return new Money(amount, currency);
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return Money.of(this.amount.add(other.amount), this.currency);
    }

    private void requireSameCurrency(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch");
        }
    }

    private static BigDecimal normalizeAmount(BigDecimal amount) {
        if (amount == null) throw new IllegalArgumentException("amount is required");
        return amount.setScale(4, RoundingMode.UNNECESSARY);
    }

    private static String normalizeCurrency(String currency) {
        if (currency == null || !currency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("currency must be ISO-4217-like 3-letter code");
        }
        return currency;
    }

    public BigDecimal amount() {
        return amount;
    }

    public String currency() {
        return currency;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money)) return false;
        Money money = (Money) o;
        return amount.compareTo(money.amount) == 0 && currency.equals(money.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount.stripTrailingZeros(), currency);
    }
}
```

Catatan penting:

- `BigDecimal.equals()` mempertimbangkan scale. `1.0` tidak equal dengan `1.00`.
- Untuk money, sering lebih aman normalize scale.
- `hashCode()` harus konsisten dengan `equals()`.
- Jangan asal memakai Lombok `@EqualsAndHashCode` untuk money tanpa sadar scale behavior.

---

### 4.2 Jangan bocorkan internal mutable object

Ini buruk:

```java
public class AuditMetadata {
    private Map<String, String> values;

    public Map<String, String> values() {
        return values;
    }
}
```

Caller bisa mutate:

```java
metadata.values().put("key", "value");
```

Provider mungkin tidak mendeteksi mutation dengan benar jika object dianggap basic converted type atau jika snapshot comparison tidak deep-copy.

Lebih baik:

```java
public Map<String, String> values() {
    return Collections.unmodifiableMap(values);
}

public AuditMetadata withValue(String key, String value) {
    Map<String, String> copy = new LinkedHashMap<>(this.values);
    copy.put(key, value);
    return new AuditMetadata(copy);
}
```

---

### 4.3 Value object bukan tempat untuk query repository

Value object boleh punya behavior domain kecil:

```java
period.contains(today)
money.add(other)
email.domain()
reference.isTemporary()
```

Tetapi value object jangan tahu database:

```java
// buruk
public class CaseReference {
    public boolean existsInDatabase(EntityManager em) { ... }
}
```

Kenapa?

- value object kehilangan purity,
- testing sulit,
- persistence leaks into domain primitive,
- lifecycle jadi tidak jelas.

---

## 5. Embeddable Mapping Mechanics

### 5.1 Basic embeddable

```java
@Embeddable
public class ApplicantName {
    @Column(name = "applicant_first_name", length = 100)
    private String firstName;

    @Column(name = "applicant_last_name", length = 100)
    private String lastName;

    protected ApplicantName() {}

    public ApplicantName(String firstName, String lastName) {
        if (firstName == null || firstName.isBlank()) {
            throw new IllegalArgumentException("first name is required");
        }
        this.firstName = firstName;
        this.lastName = lastName;
    }

    public String displayName() {
        return lastName == null || lastName.isBlank()
            ? firstName
            : firstName + " " + lastName;
    }
}
```

Owner:

```java
@Entity
@Table(name = "application")
public class Application {
    @Id
    private Long id;

    @Embedded
    private ApplicantName applicantName;
}
```

Database shape:

```sql
create table application (
    id bigint primary key,
    applicant_first_name varchar(100),
    applicant_last_name varchar(100)
);
```

Embeddable tidak otomatis menghasilkan tabel sendiri.

---

### 5.2 Reusing embeddable multiple times

```java
@Embeddable
public class PersonName {
    private String firstName;
    private String lastName;
}
```

Owner:

```java
@Entity
public class CaseParty {
    @Id
    private Long id;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "firstName", column = @Column(name = "applicant_first_name")),
        @AttributeOverride(name = "lastName", column = @Column(name = "applicant_last_name"))
    })
    private PersonName applicantName;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "firstName", column = @Column(name = "respondent_first_name")),
        @AttributeOverride(name = "lastName", column = @Column(name = "respondent_last_name"))
    })
    private PersonName respondentName;
}
```

Tanpa override, provider bisa menghasilkan duplicate column mapping.

Production rule:

> Setiap kali embeddable yang sama muncul lebih dari sekali dalam owner yang sama, pakai explicit `@AttributeOverrides`.

---

### 5.3 Nested embeddable

```java
@Embeddable
public class ContactInfo {
    @Embedded
    private EmailAddress email;

    @Embedded
    private PhoneNumber phone;
}
```

Ini bisa useful, tetapi mudah membuat column naming membingungkan.

Untuk nested embeddable, explicit naming menjadi semakin penting.

```java
@Entity
public class Applicant {
    @Id
    private Long id;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "email.value", column = @Column(name = "email_address")),
        @AttributeOverride(name = "phone.countryCode", column = @Column(name = "phone_country_code")),
        @AttributeOverride(name = "phone.number", column = @Column(name = "phone_number"))
    })
    private ContactInfo contactInfo;
}
```

Rule:

> Nested embeddable boleh, tetapi jangan biarkan default naming strategy menjadi satu-satunya dokumentasi schema.

---

### 5.4 Embeddable can contain associations, but be cautious

JPA memungkinkan embeddable mengandung relationship tertentu, misalnya `@ManyToOne`.

```java
@Embeddable
public class AssignedOfficer {
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "officer_id")
    private Officer officer;

    @Column(name = "assigned_at")
    private Instant assignedAt;
}
```

Owner:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @Embedded
    private AssignedOfficer assignedOfficer;
}
```

Ini bisa masuk akal jika `AssignedOfficer` adalah value object yang menggambarkan assignment state.

Namun hati-hati:

- embeddable mulai membawa entity reference,
- fetch plan menjadi lebih kompleks,
- lifecycle bisa membingungkan,
- equality value object dengan entity reference rawan bug,
- serialization bisa trigger lazy load.

Untuk equality, jangan include entire `Officer` object jika lazy proxy bisa terlibat. Lebih aman membandingkan officer ID atau hindari equality kompleks.

---

## 6. Embeddable in Collections

### 6.1 `@ElementCollection`

Value object collection memakai `@ElementCollection`.

```java
@Embeddable
public class Tag {
    @Column(name = "tag_value", length = 50)
    private String value;

    protected Tag() {}

    public Tag(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("tag is required");
        }
        this.value = value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Owner:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @ElementCollection
    @CollectionTable(
        name = "case_file_tag",
        joinColumns = @JoinColumn(name = "case_file_id")
    )
    private Set<Tag> tags = new LinkedHashSet<>();
}
```

Database:

```sql
create table case_file_tag (
    case_file_id bigint not null,
    tag_value varchar(50) not null
);
```

### 6.2 Element collection tidak punya identity per element

Jika collection element perlu:

- audit per item,
- status per item,
- update individual by ID,
- reference dari entity lain,
- lifecycle sendiri,
- optimistic locking sendiri,
- large collection mutation efficient,

maka jangan pakai `@ElementCollection`; gunakan child entity.

Buruk:

```java
@ElementCollection
private List<CaseDocument> documents;
```

Jika document punya ID, file metadata, upload status, verification state, uploader, audit, dan lifecycle sendiri, maka ia entity:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
private List<CaseDocument> documents;
```

Rule:

> `@ElementCollection` cocok untuk small owned value collection, bukan high-volume child record dengan lifecycle sendiri.

---

## 7. AttributeConverter Deep Dive

### 7.1 Standard converter contract

`AttributeConverter<X, Y>` punya dua method:

```java
Y convertToDatabaseColumn(X attribute);
X convertToEntityAttribute(Y dbData);
```

`X` adalah type domain/entity attribute.  
`Y` adalah type database column representation yang biasanya basic type.

Contoh:

```java
public enum RiskLevel {
    LOW("L"),
    MEDIUM("M"),
    HIGH("H");

    private final String code;

    RiskLevel(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static RiskLevel fromCode(String code) {
        for (RiskLevel level : values()) {
            if (level.code.equals(code)) {
                return level;
            }
        }
        throw new IllegalArgumentException("Unknown risk level code: " + code);
    }
}
```

Converter:

```java
@Converter(autoApply = true)
public class RiskLevelConverter implements AttributeConverter<RiskLevel, String> {
    @Override
    public String convertToDatabaseColumn(RiskLevel attribute) {
        return attribute == null ? null : attribute.code();
    }

    @Override
    public RiskLevel convertToEntityAttribute(String dbData) {
        return dbData == null ? null : RiskLevel.fromCode(dbData);
    }
}
```

Entity:

```java
private RiskLevel riskLevel;
```

SQL column:

```sql
risk_level char(1)
```

---

### 7.2 Converter vs `@Enumerated`

JPA enum mapping umum:

```java
@Enumerated(EnumType.STRING)
private CaseStatus status;
```

Ini menyimpan enum name.

```text
SUBMITTED
UNDER_REVIEW
APPROVED
```

Masalah:

- rename enum constant menjadi migration data,
- database value terlalu Java-centric,
- status code integration mungkin butuh code stabil.

Converter memberi code eksplisit:

```java
public enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    UNDER_REVIEW("R"),
    APPROVED("A"),
    REJECTED("X");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }
}
```

Jangan gabungkan `@Enumerated` dan `AttributeConverter` pada field yang sama. Jakarta Persistence mendefinisikan converter untuk mengonversi attribute ke column representation; enum mapping standar (`@Enumerated`) adalah mekanisme berbeda. Hibernate documentation juga memperingatkan bahwa converter tidak boleh dipakai bersamaan dengan `@Enumerated` untuk atribut yang sama.

Correct:

```java
@Convert(converter = CaseStatusConverter.class)
private CaseStatus status;
```

Incorrect:

```java
@Enumerated(EnumType.STRING)
@Convert(converter = CaseStatusConverter.class)
private CaseStatus status;
```

---

### 7.3 `autoApply = true`

```java
@Converter(autoApply = true)
public class EmailAddressConverter implements AttributeConverter<EmailAddress, String> { ... }
```

Dengan `autoApply`, semua field bertipe `EmailAddress` akan memakai converter ini secara otomatis.

Keuntungan:

- konsisten,
- mengurangi annotation noise,
- type system menjadi natural.

Risiko:

- sulit override jika ada satu field butuh mapping berbeda,
- transitive dependency converter bisa mengubah mapping banyak entity,
- dalam multi-module app, scanning converter bisa tidak konsisten,
- mixed `javax`/`jakarta` converter bisa tidak terdeteksi dengan jelas sampai runtime.

Disable untuk field tertentu:

```java
@Convert(disableConversion = true)
private EmailAddress rawEmail;
```

Gunakan `autoApply` untuk type yang benar-benar punya satu canonical database representation.

---

### 7.4 Converter null handling

Converter harus eksplisit menangani null.

Buruk:

```java
@Override
public String convertToDatabaseColumn(EmailAddress attribute) {
    return attribute.value();
}
```

Jika field nullable, akan NPE.

Lebih baik:

```java
@Override
public String convertToDatabaseColumn(EmailAddress attribute) {
    return attribute == null ? null : attribute.value();
}
```

Tetapi jangan jadikan null handling sebagai cara menyembunyikan invalid state.

Jika domain field wajib, enforce di entity/constructor/business method dan database constraint:

```java
@Column(nullable = false)
private EmailAddress email;
```

Database tetap perlu `NOT NULL`, karena converter tidak melindungi data yang ditulis di luar aplikasi.

---

### 7.5 Converter harus deterministic

Converter harus menghasilkan output yang stabil untuk input yang sama.

Buruk:

```java
@Override
public String convertToDatabaseColumn(Token attribute) {
    return encryptWithRandomIv(attribute.value());
}
```

Ini mungkin sah untuk encryption, tetapi konsekuensinya:

- equality query sulit,
- unique constraint tidak bekerja secara natural,
- dirty checking bisa melihat value berubah walau domain value sama,
- second-level cache/keying bisa membingungkan,
- audit diff noisy.

Jika butuh encrypted column, desain secara eksplisit:

- apakah butuh searchable encryption?
- apakah equality lookup diperlukan?
- apakah IV disimpan bersama ciphertext?
- apakah encryption deterministic boleh dari security perspective?
- bagaimana key rotation?
- apakah converter tempat yang tepat atau lebih baik database/driver/security layer?

Rule:

> Converter bukan tempat untuk side effect sembarangan. Converter adalah pure mapping function sejauh mungkin.

---

### 7.6 Converter dan query binding

Misalnya:

```java
@Converter(autoApply = true)
public class CaseReferenceConverter implements AttributeConverter<CaseReference, String> { ... }
```

Query:

```java
TypedQuery<CaseFile> query = em.createQuery(
    "select c from CaseFile c where c.reference = :reference",
    CaseFile.class
);
query.setParameter("reference", CaseReference.of("CASE-20250101"));
```

Provider seharusnya dapat menerapkan converter untuk parameter binding pada attribute path. Namun behavior dapat berbeda untuk:

- native query,
- function expression,
- criteria literal,
- provider-specific query,
- converter pada map key/value,
- converter pada nested embeddable.

Jika query memakai native SQL:

```java
Query q = em.createNativeQuery(
    "select * from case_file where case_reference = ?",
    CaseFile.class
);
q.setParameter(1, CaseReference.of("CASE-20250101"));
```

Jangan berasumsi converter pasti dipakai. Lebih aman bind database representation:

```java
q.setParameter(1, "CASE-20250101");
```

Atau buat repository method yang menyembunyikan detail ini.

---

## 8. Hibernate Type System Perspective

### 8.1 Hibernate tidak hanya punya `AttributeConverter`

Hibernate mendukung JPA converter, tetapi internal type system Hibernate lebih luas.

Secara mental model, Hibernate perlu menjawab:

1. Java type apa yang disimpan?
2. JDBC type apa yang dipakai?
3. Bagaimana bind parameter ke `PreparedStatement`?
4. Bagaimana extract value dari `ResultSet`?
5. Bagaimana membandingkan dirty state?
6. Apakah value mutable?
7. Bagaimana deep copy untuk snapshot/cache?
8. Bagaimana SQL literal dirender?
9. Bagaimana DDL column type dipilih?

`AttributeConverter` terutama menjawab:

```text
Java domain value <-> basic relational representation
```

Tetapi tidak selalu cukup menjawab semua pertanyaan rendah level.

---

### 8.2 MutabilityPlan: detail yang sering menentukan dirty checking

Misalnya entity field:

```java
private AuditMetadata metadata;
```

Converter:

```java
@Converter
public class AuditMetadataConverter implements AttributeConverter<AuditMetadata, String> {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(AuditMetadata attribute) {
        return attribute == null ? null : objectMapper.writeValueAsString(attribute);
    }

    @Override
    public AuditMetadata convertToEntityAttribute(String dbData) {
        return dbData == null ? null : objectMapper.readValue(dbData, AuditMetadata.class);
    }
}
```

Jika `AuditMetadata` mutable, dirty checking tergantung bagaimana provider mengambil snapshot dan membandingkan value.

Masalah:

```java
caseFile.getMetadata().put("source", "internet");
```

Apakah provider tahu field berubah?

Untuk immutable value object, pattern lebih aman:

```java
caseFile.changeMetadata(
    caseFile.getMetadata().withValue("source", "internet")
);
```

Assignment object baru lebih mudah dideteksi.

Hibernate custom type dapat mengatur mutability/deep-copy behavior lebih eksplisit daripada converter standar.

---

### 8.3 Hibernate 6/7 type system migration warning

Jika codebase lama memakai Hibernate 5 custom types seperti:

```java
@Type(type = "jsonb")
private JsonNode metadata;
```

migration ke Hibernate 6/7 sering butuh perubahan karena type system dan annotation model berubah.

Production migration checklist:

- cari semua `@Type`, `UserType`, `CompositeUserType`, `BasicType`, custom dialect,
- cek apakah library eksternal type kompatibel dengan Hibernate version,
- cek DDL type berubah atau tidak,
- cek query parameter binding,
- cek dirty checking mutable values,
- cek cache serialization,
- cek native query mapping.

Rule:

> Custom type adalah extension point kuat, tetapi juga migration liability. Dokumentasikan alasan dan behavior-nya.

---

## 9. EclipseLink Converter and Mapping Perspective

### 9.1 EclipseLink mendukung JPA converter dan extension sendiri

EclipseLink mendukung standard `AttributeConverter`, tetapi juga punya extension mapping/converter seperti:

- `@ObjectTypeConverter`,
- `@TypeConverter`,
- `@StructConverter`,
- `SerializedObjectConverter`,
- transformation mapping,
- descriptor customizer.

Contoh use case `ObjectTypeConverter`:

```java
@ObjectTypeConverter(
    name = "genderConverter",
    dataType = String.class,
    objectType = Gender.class,
    conversionValues = {
        @ConversionValue(dataValue = "M", objectValue = "MALE"),
        @ConversionValue(dataValue = "F", objectValue = "FEMALE")
    }
)
```

Dalam modern Jakarta app, standard `AttributeConverter` biasanya pilihan awal. EclipseLink extension dipakai ketika:

- legacy database value mapping spesifik,
- descriptor-level customization diperlukan,
- mapping tidak cocok dengan JPA standard,
- project memang EclipseLink-specific.

---

### 9.2 EclipseLink descriptor thinking

EclipseLink banyak berputar di konsep descriptor dan session/unit-of-work.

Untuk value object dan converter, pertanyaan yang perlu dijawab:

- converter dipasang di field mana?
- apakah mapping dibaca sebagai direct-to-field mapping?
- apakah transformation mapping diperlukan?
- apakah shared cache menyimpan object hasil konversi?
- apakah object hasil konversi mutable?
- apakah weaving/change tracking mendeteksi perubahan?

Dengan EclipseLink, jangan hanya bertanya:

> “Annotation-nya apa?”

Tanyakan juga:

> “Descriptor mapping final-nya seperti apa?”

---

### 9.3 Serialized object converter warning

EclipseLink punya `SerializedObjectConverter` untuk menyimpan arbitrary object ke binary/character field.

Ini powerful tetapi berbahaya untuk long-term system.

Risiko:

- Java serialization format fragile,
- class rename merusak data lama,
- schema tidak visible,
- query tidak bisa masuk ke struktur internal,
- migration sulit,
- security concern jika deserialization tidak dikontrol,
- interoperability buruk.

Gunakan serialized object storage hanya jika:

- datanya benar-benar opaque,
- tidak perlu query internal,
- ada versioning format,
- ada migration plan,
- format lebih aman seperti JSON dengan schema/version field,
- ukuran dan indexing dipahami.

Untuk regulatory/case management system, serialized opaque field harus dianggap design smell kecuali dipakai untuk audit snapshot yang memang immutable dan versioned.

---

## 10. Enum Mapping Strategy

### 10.1 `EnumType.ORDINAL` hampir selalu buruk untuk enterprise system

```java
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

Jika enum:

```java
DRAFT, SUBMITTED, APPROVED
```

Database:

```text
0, 1, 2
```

Jika kemudian enum berubah:

```java
DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED
```

Maka `APPROVED` lama yang disimpan sebagai `2` sekarang terbaca sebagai `UNDER_REVIEW`.

Ini data corruption.

Rule:

> Jangan gunakan ordinal enum untuk persistent business state.

Kecuali mungkin untuk internal ephemeral data yang tidak perlu migration dan benar-benar controlled. Dalam enterprise production, almost never.

---

### 10.2 `EnumType.STRING` lebih aman tetapi bukan final answer

```java
@Enumerated(EnumType.STRING)
private CaseStatus status;
```

Database:

```text
DRAFT
SUBMITTED
APPROVED
```

Lebih aman dari ordinal, tetapi rename enum constant menjadi data migration.

Jika enum constant berubah:

```java
UNDER_REVIEW -> IN_REVIEW
```

Maka row lama tidak bisa dibaca tanpa migration/compatibility code.

---

### 10.3 Stable code converter untuk state yang hidup lama

Lebih robust:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUB"),
    UNDER_REVIEW("REV"),
    APPROVED("APP"),
    REJECTED("REJ");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus status : values()) {
            if (status.code.equals(code)) return status;
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

Converter:

```java
@Converter(autoApply = true)
public class CaseStatusConverter implements AttributeConverter<CaseStatus, String> {
    @Override
    public String convertToDatabaseColumn(CaseStatus attribute) {
        return attribute == null ? null : attribute.code();
    }

    @Override
    public CaseStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : CaseStatus.fromCode(dbData);
    }
}
```

Database column:

```sql
case_status varchar(10) not null
```

Optional check constraint:

```sql
alter table case_file add constraint chk_case_status
check (case_status in ('DRAFT', 'SUB', 'REV', 'APP', 'REJ'));
```

---

### 10.4 Handling unknown legacy enum values

Converter yang throw exception saat unknown code muncul bisa bagus karena fail-fast. Tapi dalam legacy migration, kadang perlu tolerate unknown.

Option A: fail-fast

```java
throw new IllegalArgumentException("Unknown status: " + code);
```

Cocok untuk:

- data harus bersih,
- invalid data harus menghentikan flow,
- production data controlled.

Option B: unknown enum constant

```java
UNKNOWN("?")
```

Cocok untuk:

- read-only legacy data,
- integration feed dari external system,
- UI perlu menampilkan row walau code unknown,
- migration bertahap.

Tetapi hati-hati: `UNKNOWN` bisa menyembunyikan data corruption.

Better pattern:

```java
public enum ExternalStatus {
    ACTIVE("A"),
    SUSPENDED("S"),
    UNKNOWN("__UNKNOWN__");

    public static ExternalStatus fromCode(String code) {
        for (ExternalStatus status : values()) {
            if (status.code.equals(code)) return status;
        }
        return UNKNOWN;
    }
}
```

Dan log/metric unknown code di converter? Hati-hati side effect. Lebih baik validasi/reporting dilakukan di ingestion layer atau data quality job, bukan converter hot path.

---

## 11. Money, Quantity, Percentage, and Measurement Types

### 11.1 `BigDecimal` saja sering tidak cukup

Buruk:

```java
private BigDecimal amount;
```

Apa currency-nya? Scale-nya? Boleh negative? Rounding policy? Apakah tax-inclusive?

Lebih kuat:

```java
@Embeddable
public class Money {
    private BigDecimal amount;
    private String currency;
}
```

Lebih kuat lagi:

```java
public Money add(Money other) {
    requireSameCurrency(other);
    return Money.of(amount.add(other.amount), currency);
}
```

### 11.2 Scale dan precision adalah domain decision

```java
@Column(precision = 19, scale = 4)
private BigDecimal amount;
```

Artinya total digit 19, 4 digit decimal.

Untuk financial system:

- jangan pakai `double`,
- tentukan scale,
- tentukan rounding mode,
- normalize sebelum persist,
- pikirkan currency minor unit,
- pikirkan aggregate calculations.

### 11.3 Percentage

Buruk:

```java
private BigDecimal discount;
```

Apakah `10` berarti 10% atau 0.10?

Lebih jelas:

```java
@Embeddable
public class Percentage {
    @Column(name = "discount_rate", precision = 7, scale = 4)
    private BigDecimal value; // 0.1000 means 10%

    protected Percentage() {}

    public static Percentage ofRatio(BigDecimal ratio) {
        if (ratio.compareTo(BigDecimal.ZERO) < 0) throw new IllegalArgumentException("negative percentage");
        return new Percentage(ratio.setScale(4, RoundingMode.UNNECESSARY));
    }

    public static Percentage ofPercent(BigDecimal percent) {
        return ofRatio(percent.movePointLeft(2));
    }
}
```

---

## 12. Date, Time, Time Zone, and Period Value Objects

### 12.1 Java 8 changed the baseline

Java 8 introduced `java.time`, making persistence model much clearer than legacy `Date`/`Calendar`.

Prefer:

- `LocalDate` for date without time,
- `LocalDateTime` for local timestamp without zone,
- `Instant` for machine timestamp,
- `OffsetDateTime` when offset matters,
- avoid `java.util.Date` for new code unless legacy interop.

### 12.2 Period/range is a value object

Buruk:

```java
private LocalDate validFrom;
private LocalDate validTo;
```

Lebih baik:

```java
@Embeddable
public class ValidityPeriod {
    @Column(name = "valid_from", nullable = false)
    private LocalDate from;

    @Column(name = "valid_to")
    private LocalDate to;

    protected ValidityPeriod() {}

    public ValidityPeriod(LocalDate from, LocalDate to) {
        if (from == null) throw new IllegalArgumentException("from is required");
        if (to != null && to.isBefore(from)) {
            throw new IllegalArgumentException("to must not be before from");
        }
        this.from = from;
        this.to = to;
    }

    public boolean isOpenEnded() {
        return to == null;
    }

    public boolean contains(LocalDate date) {
        return !date.isBefore(from) && (to == null || !date.isAfter(to));
    }
}
```

### 12.3 Timezone policy must be explicit

Untuk audit timestamp:

```java
private Instant createdAt;
```

Untuk appointment lokal:

```java
private LocalDateTime scheduledAt;
private String timezone;
```

Atau:

```java
private OffsetDateTime scheduledAt;
```

Tapi jangan asal campur:

- `LocalDateTime` untuk audit event global,
- `Instant` untuk tanggal lahir,
- server default timezone untuk conversion,
- database timezone implicit tanpa policy.

Value object bisa memperjelas:

```java
@Embeddable
public class ScheduledTime {
    @Column(name = "scheduled_local_time", nullable = false)
    private LocalDateTime localTime;

    @Column(name = "scheduled_zone", nullable = false, length = 64)
    private String zoneId;

    protected ScheduledTime() {}

    public ScheduledTime(LocalDateTime localTime, ZoneId zoneId) {
        this.localTime = Objects.requireNonNull(localTime);
        this.zoneId = Objects.requireNonNull(zoneId).getId();
    }

    public ZonedDateTime asZonedDateTime() {
        return localTime.atZone(ZoneId.of(zoneId));
    }
}
```

---

## 13. JSON/XML/Serialized Value Mapping

### 13.1 JSON as converted string

Simplest approach:

```java
@Converter
public class MetadataConverter implements AttributeConverter<Metadata, String> {
    private static final ObjectMapper MAPPER = new ObjectMapper()
        .findAndRegisterModules();

    @Override
    public String convertToDatabaseColumn(Metadata attribute) {
        if (attribute == null) return null;
        try {
            return MAPPER.writeValueAsString(attribute);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Cannot serialize metadata", e);
        }
    }

    @Override
    public Metadata convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) return null;
        try {
            return MAPPER.readValue(dbData, Metadata.class);
        } catch (IOException e) {
            throw new IllegalArgumentException("Cannot deserialize metadata", e);
        }
    }
}
```

Entity:

```java
@Lob
@Convert(converter = MetadataConverter.class)
private Metadata metadata;
```

This is portable-ish, but has trade-offs:

- database sees string/CLOB, not structured JSON unless column type is JSON-capable,
- query inside JSON not portable,
- indexing JSON fields not portable,
- dirty checking depends on object mutability,
- serialization format must be versioned.

### 13.2 JSONB/native JSON provider-specific mapping

For PostgreSQL JSONB, Oracle JSON, MySQL JSON, SQL Server JSON functions, provider-specific custom type/native query might be better.

Decision matrix:

| Requirement | Better approach |
|---|---|
| Only store/retrieve opaque metadata | Converter to String/CLOB may be enough |
| Query by JSON fields | Native JSON column + DB-specific query/type |
| Index JSON fields | DB-specific generated column/index or JSON index |
| Need portable provider behavior | Avoid deep JSON query reliance |
| Need high-volume updates inside JSON | Reconsider relational modeling |

### 13.3 Version your serialized value

Bad:

```json
{
  "fieldA": "value"
}
```

Better:

```json
{
  "schemaVersion": 1,
  "fieldA": "value"
}
```

Converter can handle multiple versions:

```java
public Metadata convertToEntityAttribute(String dbData) {
    JsonNode node = readTree(dbData);
    int version = node.path("schemaVersion").asInt(1);
    return switch (version) {
        case 1 -> parseV1(node);
        case 2 -> parseV2(node);
        default -> throw new IllegalArgumentException("Unsupported metadata version: " + version);
    };
}
```

For Java 8, use `switch` statement.

---

## 14. Equality and HashCode for Value Objects

### 14.1 Value object equality is structural

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        this.value = normalize(value);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("email required");
        return value.trim().toLowerCase(Locale.ROOT);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof EmailAddress)) return false;
        EmailAddress that = (EmailAddress) o;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }
}
```

### 14.2 Embeddable equality matters for collections and dirty checking

If embeddable is used in `Set`:

```java
@ElementCollection
private Set<Tag> tags = new HashSet<>();
```

`Tag.equals/hashCode` must be correct.

Bad:

```java
@Embeddable
public class Tag {
    private String value;
    // no equals/hashCode
}
```

Then two tags with same value are different Java objects and can duplicate.

Good:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Tag)) return false;
    Tag tag = (Tag) o;
    return value.equals(tag.value);
}

@Override
public int hashCode() {
    return value.hashCode();
}
```

### 14.3 Do not include mutable collections carelessly

```java
@Embeddable
public class Metadata {
    private Map<String, String> values;
}
```

If equality includes mutable map, mutation after insertion into HashSet breaks hash bucket. Better avoid using mutable value object in hashed collections or make it immutable.

---

## 15. Mutability and Dirty Checking Failure Modes

### 15.1 In-place mutation may be invisible

Suppose:

```java
@Convert(converter = MetadataConverter.class)
private Metadata metadata;
```

And:

```java
caseFile.getMetadata().put("risk", "HIGH");
```

Provider might not detect this as dirty if:

- snapshot uses same object reference,
- type is considered immutable,
- converter output not recalculated until field assignment,
- custom type lacks deep copy.

Safer:

```java
caseFile.changeMetadata(caseFile.getMetadata().with("risk", "HIGH"));
```

Field reference changes.

### 15.2 Immutable object replacement is ORM-friendly

```java
public void changeMetadata(Metadata newMetadata) {
    this.metadata = Objects.requireNonNull(newMetadata);
}
```

This has benefits:

- dirty checking sees field reference/value difference,
- domain operation explicit,
- audit diff clearer,
- thread safety better,
- no shared mutable state.

### 15.3 Mutable embeddable can be acceptable with discipline

JPA providers commonly instantiate embeddables and set fields. Mutable embeddables are common.

Acceptable if:

- setter visibility controlled,
- mutation happens through owner method,
- collection usage safe,
- tests verify dirty checking,
- no shared instance across owners,
- no public mutable internal collection.

Example:

```java
@Entity
public class CaseFile {
    @Embedded
    private ValidityPeriod validityPeriod;

    public void extendValidityTo(LocalDate newEndDate) {
        this.validityPeriod = this.validityPeriod.withEndDate(newEndDate);
    }
}
```

Do not expose:

```java
public ValidityPeriod getValidityPeriod() {
    return validityPeriod;
}
```

if `ValidityPeriod` is mutable and caller can mutate it freely.

---

## 16. Converter Failure Modes

### 16.1 Converter throws during entity load

If converter cannot parse database value:

```java
RiskLevel.fromCode("UNKNOWN")
```

then entity load fails.

This is good if invalid data should fail. But it can take down list screens if one bad row exists.

Mitigations:

- enforce DB check constraint,
- run data quality jobs,
- tolerate unknown for external/legacy data,
- isolate risky field in projection/native query if needed,
- do migration before strict converter rollout.

### 16.2 Converter changes representation without data migration

Old converter:

```text
LOW -> L
MEDIUM -> M
HIGH -> H
```

New converter:

```text
LOW -> 1
MEDIUM -> 2
HIGH -> 3
```

If database data not migrated, old rows break.

Rule:

> Converter change is schema/data migration, even if DDL does not change.

### 16.3 Converter uses locale-sensitive formatting

Bad:

```java
NumberFormat.getInstance().format(amount)
```

Depending on locale:

```text
1,234.56
1.234,56
```

Use stable machine format.

```java
amount.toPlainString()
```

For dates, use ISO format or direct temporal DB type.

### 16.4 Converter swallows invalid data

Bad:

```java
try {
    return RiskLevel.fromCode(dbData);
} catch (Exception e) {
    return RiskLevel.LOW;
}
```

This silently corrupts semantics. Invalid data becomes low risk.

Better:

- throw,
- return explicit `UNKNOWN`,
- quarantine data at ingestion,
- log/metric outside converter.

### 16.5 Converter has external dependency

Bad:

```java
public String convertToDatabaseColumn(Address address) {
    return postalCodeService.normalize(address.postalCode());
}
```

Converter may run during:

- flush,
- query parameter binding,
- entity load,
- cache hydration,
- background batch.

External calls inside converter can cause:

- latency explosion,
- transaction timeout,
- non-determinism,
- circular dependency,
- failure during entity load.

Rule:

> Converter should not call network, database, remote service, or depend on request context.

---

## 17. Embeddables and DDD Aggregate Design

### 17.1 Use embeddable for concepts owned by aggregate

Good:

```java
@Entity
public class CaseFile {
    @Embedded
    private CaseReference reference;

    @Embedded
    private ValidityPeriod validityPeriod;

    @Embedded
    private RiskAssessmentSummary riskSummary;
}
```

These are part of `CaseFile` state.

### 17.2 Do not use embeddable for shared master data

Bad:

```java
@Embedded
private Agency agency;
```

If agency has:

- agency ID,
- name,
- status,
- configuration,
- many cases reference it,
- lifecycle independent,

then agency is entity/reference data:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Agency agency;
```

### 17.3 Snapshot vs reference

Sometimes you need both:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Agency agency;

@Embedded
private AgencySnapshot agencySnapshotAtSubmission;
```

Why?

- `agency` points to current master data,
- `agencySnapshotAtSubmission` records historical value at time of submission.

This is very important in regulatory systems.

Example:

```java
@Embeddable
public class AgencySnapshot {
    @Column(name = "agency_code_at_submission")
    private String code;

    @Column(name = "agency_name_at_submission")
    private String name;
}
```

Rule:

> If historical truth matters, store snapshot value object. Do not rely only on mutable reference data.

---

## 18. API Boundary Safety

### 18.1 Do not expose embeddable directly as request DTO blindly

Bad:

```java
@PostMapping("/cases")
public void create(@RequestBody CaseFile caseFile) {
    repository.save(caseFile);
}
```

Problems:

- client controls entity graph,
- client can set fields it should not,
- embeddable invariant may be bypassed by reflection/deserialization,
- invalid partial object enters persistence context,
- mass assignment risk.

Better:

```java
public record CreateCaseRequest(
    String applicantName,
    String postalCode,
    LocalDate validFrom,
    LocalDate validTo
) {}
```

Application service:

```java
CaseFile caseFile = CaseFile.create(
    ApplicantName.of(request.applicantName()),
    PostalCode.of(request.postalCode()),
    new ValidityPeriod(request.validFrom(), request.validTo())
);
```

For Java 8, use ordinary DTO class.

### 18.2 Partial update needs explicit semantics

Bad:

```java
mapper.updateEntityFromRequest(request, entity);
```

If request field null, does it mean:

- clear field?
- not provided?
- invalid?

Value object update should be explicit:

```java
public void changeValidityPeriod(LocalDate from, LocalDate to) {
    this.validityPeriod = new ValidityPeriod(from, to);
}
```

Patch command:

```java
public class UpdateValidityPeriodCommand {
    private Optional<LocalDate> from;
    private Optional<LocalDate> to;
}
```

---

## 19. Provider Portability Guidelines

### 19.1 Portable baseline

Most portable:

- `@Embeddable`,
- `@Embedded`,
- `@AttributeOverride`,
- `@ElementCollection`,
- `@CollectionTable`,
- `AttributeConverter`,
- `@Convert`,
- `@Enumerated(EnumType.STRING)`.

### 19.2 Provider-specific zone

Less portable:

- Hibernate custom type,
- Hibernate `@JdbcTypeCode`,
- Hibernate JSON mapping,
- Hibernate `@Mutability`,
- EclipseLink `@ObjectTypeConverter`,
- EclipseLink transformation mapping,
- EclipseLink serialized object converter,
- database-native enum/json/array mapping,
- custom dialect behavior.

Provider-specific is not bad. It is bad only if it is accidental.

Decision rule:

> Use portable mapping by default. Use provider-specific mapping intentionally when it buys correctness, performance, or database capability that the standard cannot express.

Document:

- why provider extension is used,
- which provider/version supports it,
- fallback/migration plan,
- tests proving behavior.

---

## 20. Java 8 to 25 Compatibility Notes

### 20.1 Java 8

- `java.time` available.
- No records.
- No switch expressions.
- No sealed classes.
- Use classic class-based value objects.
- JPA 2.1/2.2 commonly under `javax.persistence`.
- Hibernate 5.x and EclipseLink 2.x often found in legacy systems.

### 20.2 Java 11/17

- Java 11 common enterprise baseline.
- Java 17 became major LTS baseline for Spring Boot 3/Jakarta era.
- Jakarta namespace migration becomes relevant.
- Records exist from Java 16 onward, but JPA entity/embeddable support depends on provider capabilities and constraints.

### 20.3 Java 21

- Modern LTS.
- Pattern matching and records useful for DTO/value modeling.
- Entities should still avoid being records in most JPA use cases because entity lifecycle/proxy/no-arg constructor requirements conflict with record semantics.
- Records can be useful for projections, DTOs, command objects, and sometimes immutable embeddable-like structures if provider supports the pattern.

### 20.4 Java 25

- Treat as modern runtime target.
- ORM provider compatibility must be verified explicitly.
- Language features can improve domain modeling, but provider bytecode enhancement/proxy requirements still matter.

Compatibility rule:

> Java language can make value modeling cleaner, but ORM provider rules still control persistence compatibility.

---

## 21. Production Design Rules

### Rule 1 — Do not model domain-specific values as weak primitives by default

Weak:

```java
String email;
String status;
String referenceNo;
BigDecimal amount;
```

Stronger:

```java
EmailAddress email;
CaseStatus status;
CaseReference referenceNo;
Money amount;
```

### Rule 2 — Use embeddable for multi-column owned concepts

```java
@Embedded
private Money amount;

@Embedded
private ValidityPeriod validityPeriod;
```

### Rule 3 — Use converter for single-column semantic type

```java
@Convert(converter = EmailAddressConverter.class)
private EmailAddress email;
```

### Rule 4 — Keep value objects immutable or mutation-controlled

Avoid public setters and mutable internal collections.

### Rule 5 — Treat converter change as data migration

Changing code mapping changes data semantics.

### Rule 6 — Avoid ordinal enum

Use string or stable-code converter.

### Rule 7 — Do not hide invalid data silently

Fail-fast or explicit unknown state.

### Rule 8 — Do not call external systems inside converter

Converters must be deterministic and local.

### Rule 9 — Test dirty checking for converted mutable values

Especially JSON, maps, lists, metadata blobs.

### Rule 10 — Snapshot historical values explicitly

Regulatory systems need historical truth, not only current references.

---

## 22. Anti-Patterns

### 22.1 Primitive obsession

```java
private String status;
private String type;
private String source;
private BigDecimal amount;
private String currency;
```

The model cannot prevent invalid combinations.

### 22.2 Embeddable with public setters everywhere

```java
@Embeddable
public class Money {
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public void setCurrency(String currency) { this.currency = currency; }
}
```

Allows:

```java
money.setAmount(new BigDecimal("100"));
money.setCurrency("INVALID");
```

### 22.3 Converter as business service

```java
converter.convertToDatabaseColumn(value) {
    remoteService.validate(value);
}
```

This couples persistence hot path to external behavior.

### 22.4 JSON blob for relational data

If you constantly query fields inside JSON, join with them, filter by them, and index them, maybe they are relational columns/entities.

### 22.5 `@ElementCollection` for high-volume child lifecycle

If child needs ID, audit, status, or independent update, use entity.

### 22.6 Silent fallback in converter

```java
return defaultValue;
```

when database value is invalid.

This hides corruption.

### 22.7 Mixing `@Enumerated` and converter

Use one strategy.

---

## 23. Diagnostic Checklist

When a bug appears around embeddables/converters/types, ask:

### Mapping

- Is this concept entity or value object?
- Does it have independent identity?
- Does it need lifecycle/audit/versioning?
- Is `@Embeddable` appropriate?
- Is `AttributeConverter` enough or do we need provider custom type?

### Dirty checking

- Is the value mutable?
- Is mutation in-place or replacement?
- Does provider deep-copy snapshot?
- Does equality reflect real value?
- Does flush produce expected update?

### Converter

- Is converter deterministic?
- Does it handle null correctly?
- Does it throw or tolerate unknown values intentionally?
- Did converter representation change without migration?
- Does query binding use converter?
- Are native queries bypassing converter?

### Database

- Are column length/precision/scale correct?
- Are check constraints aligned with converter values?
- Is JSON/XML field queryable if needed?
- Is serialized format versioned?
- Are indexes compatible with converted representation?

### Provider

- Is behavior tested on actual provider/version?
- Does Hibernate/EclipseLink treat the type as mutable/immutable correctly?
- Are provider-specific extensions documented?
- Will migration to Jakarta/Hibernate 6/7/EclipseLink 4 break the mapping?

---

## 24. Practice Scenarios

### Scenario 1 — Case status mapping

You have current code:

```java
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

Task:

- migrate to stable-code converter,
- design DB migration,
- add check constraint,
- ensure old ordinal data is converted safely,
- update queries.

Expected reasoning:

- ordinal is unsafe,
- converter maps enum to stable code,
- migration updates existing rows,
- app deploy and DB migration order matters,
- rollback plan needed.

---

### Scenario 2 — Validity period bug

Current code:

```java
private LocalDate validFrom;
private LocalDate validTo;
```

Bug: rows exist where `valid_to < valid_from`.

Task:

- introduce `ValidityPeriod` embeddable,
- add application invariant,
- add DB check constraint,
- handle existing bad rows,
- test update path.

Expected reasoning:

- value object prevents future invalid state,
- DB constraint protects against external writes,
- existing data migration must clean before adding constraint.

---

### Scenario 3 — JSON metadata dirty checking

Current code:

```java
@Convert(converter = MetadataConverter.class)
private Metadata metadata;
```

Bug: `metadata.put("risk", "HIGH")` sometimes does not update DB.

Task:

- determine whether provider sees in-place mutation,
- change `Metadata` to immutable,
- use replacement method,
- test SQL update after flush,
- consider Hibernate custom type if mutation must be supported.

Expected reasoning:

- immutable replacement is safer,
- converter does not guarantee deep mutation tracking,
- provider custom mutability plan may be needed.

---

### Scenario 4 — Agency snapshot vs agency reference

Current code:

```java
@ManyToOne
private Agency agency;
```

Bug: old submitted cases show current agency name, not agency name at submission time.

Task:

- add `AgencySnapshot` embeddable,
- populate at submission,
- keep `agency` reference for current relationship,
- update read model to display historical snapshot where required.

Expected reasoning:

- reference data is mutable,
- historical truth must be stored as value snapshot,
- embeddable is appropriate for snapshot.

---

## 25. Mini Case Study: Regulatory Case File

Consider:

```java
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Id
    private Long id;

    @Embedded
    private CaseReference reference;

    @Convert(converter = CaseStatusConverter.class)
    @Column(name = "status", nullable = false, length = 10)
    private CaseStatus status;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "from", column = @Column(name = "valid_from", nullable = false)),
        @AttributeOverride(name = "to", column = @Column(name = "valid_to"))
    })
    private ValidityPeriod validityPeriod;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "amount", column = @Column(name = "claim_amount", precision = 19, scale = 4)),
        @AttributeOverride(name = "currency", column = @Column(name = "claim_currency", length = 3))
    })
    private Money claimAmount;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "agency_id", nullable = false)
    private Agency agency;

    @Embedded
    private AgencySnapshot agencySnapshotAtSubmission;

    protected CaseFile() {}

    public static CaseFile draft(CaseReference reference, Agency agency) {
        CaseFile c = new CaseFile();
        c.reference = Objects.requireNonNull(reference);
        c.status = CaseStatus.DRAFT;
        c.agency = Objects.requireNonNull(agency);
        return c;
    }

    public void submit(ValidityPeriod validityPeriod, Money claimAmount) {
        if (!status.canTransitionTo(CaseStatus.SUBMITTED)) {
            throw new IllegalStateException("Cannot submit case from " + status);
        }
        this.validityPeriod = Objects.requireNonNull(validityPeriod);
        this.claimAmount = Objects.requireNonNull(claimAmount);
        this.agencySnapshotAtSubmission = AgencySnapshot.from(agency);
        this.status = CaseStatus.SUBMITTED;
    }
}
```

This model gives:

- stable case reference type,
- controlled status transition,
- validity invariant,
- money semantics,
- current agency relation,
- historical agency snapshot,
- clear aggregate operation.

This is much better than:

```java
private String reference;
private String status;
private LocalDate validFrom;
private LocalDate validTo;
private BigDecimal amount;
private String currency;
private Long agencyId;
private String agencyName;
```

The second model is easier to write initially but harder to keep correct over years.

---

## 26. Summary

Embeddables, value objects, converters, and provider type systems are not minor mapping details. They determine whether your persistence model expresses real business meaning or just stores weak primitive data.

Key takeaways:

1. Entity has identity; value object has structural value.
2. Use `@Embeddable` for owned multi-column concepts.
3. Use `AttributeConverter` for single-column semantic types.
4. Use provider custom type when standard converter cannot express JDBC/mutability/query behavior.
5. Prefer immutable or mutation-controlled value objects.
6. Avoid ordinal enum for persistent business state.
7. Converter changes are data migrations.
8. Dirty checking and mutability must be tested, not assumed.
9. Historical snapshot values matter in regulatory systems.
10. Provider-specific mapping is acceptable when intentional, documented, and tested.

The next part will move from value/type modeling into one of the most practically important ORM topics:

```text
14-fetching-mental-model-lazy-eager-proxies-enhancement-load-plans.md
```

That part will explain how ORM materializes object graphs, why lazy/eager is not simply a performance toggle, how proxies and bytecode enhancement work, and why fetch planning is a central production engineering skill.

---

## References

- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta Persistence 3.2 API — `AttributeConverter`: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/attributeconverter
- Jakarta Persistence 3.2 API — `ElementCollection`: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/elementcollection
- Hibernate ORM User Guide 7.1: https://docs.hibernate.org/orm/7.1/userguide/html_single/
- Hibernate ORM stable User Guide: https://docs.hibernate.org/stable/orm/userguide/html_single/
- EclipseLink 4.0 JPA Extensions Reference: https://eclipse.dev/eclipselink/documentation/4.0/jpa/extensions/jpa-extensions.html
- EclipseLink `ObjectTypeConverter` documentation: https://eclipse.dev/eclipselink/documentation/2.4/jpa/extensions/a_objecttypeconverter.htm
- EclipseLink `SerializedObjectConverter` API: https://eclipse.dev/eclipselink/api/4.0/org.eclipse.persistence.core/org/eclipse/persistence/mappings/converters/SerializedObjectConverter.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./12-inheritance-mapping-object-hierarchy-relational-shape.md">⬅️ Part 12 — Inheritance Mapping: Object Hierarchy vs Relational Shape</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./14-fetching-mental-model-lazy-eager-proxies-enhancement-load-plans.md">Part 14 — Fetching Mental Model: Lazy, Eager, Proxies, Enhancement, and Load Plans ➡️</a>
</div>
