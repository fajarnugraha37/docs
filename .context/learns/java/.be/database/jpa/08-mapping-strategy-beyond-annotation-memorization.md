# Part 8 — Mapping Strategy Beyond Annotation Memorization

> Series: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `08-mapping-strategy-beyond-annotation-memorization.md`  
> Scope: Java 8–25, JPA 2.x / Jakarta Persistence 3.x, Hibernate ORM 5/6/7, EclipseLink 2/3/4/5 line  
> Goal: membangun mental model mapping sebagai **contract engineering** antara domain object, persistence provider, SQL schema, database type system, dan production behavior.

---

## 1. Why This Matters

Banyak developer mempelajari mapping JPA/Hibernate sebagai daftar annotation:

```java
@Entity
@Table(name = "customer")
public class Customer {
    @Id
    private Long id;

    @Column(name = "name")
    private String name;
}
```

Itu cukup untuk CRUD sederhana, tetapi tidak cukup untuk sistem production yang serius.

Di level advanced, mapping bukan sekadar pertanyaan:

> “Annotation apa yang harus saya pakai?”

Pertanyaannya berubah menjadi:

> “Contract apa yang sedang saya buat antara object model, database schema, provider ORM, query engine, transaction boundary, migration process, dan operational behavior?”

Mapping yang terlihat kecil bisa memiliki efek besar:

| Keputusan mapping | Dampak production |
|---|---|
| `EnumType.ORDINAL` | data corrupt ketika urutan enum berubah |
| `String` tanpa `length` jelas | schema default berbeda antar provider/database |
| `BigDecimal` tanpa precision/scale | rounding, truncation, atau DDL drift |
| `Instant` tanpa timezone policy | audit timestamp salah lintas zona waktu |
| `@Lob` pada field besar | memory spike saat hydration |
| `nullable = false` hanya di annotation | tidak menjamin database constraint jika DDL tidak dikelola |
| custom converter terlalu pintar | query binding dan indexing bisa rusak |
| quoted identifier tidak konsisten | migration gagal saat pindah database/provider |

Top-tier engineer tidak hanya tahu annotation. Ia memahami **konsekuensi mapping**.

---

## 2. Core Mental Model: Mapping Is a Contract, Not Decoration

Mapping entity adalah definisi kontrak multi-layer:

```text
Java field/property
        │
        ▼
JPA/Jakarta mapping metadata
        │
        ▼
Provider type system
        │
        ▼
JDBC type binding/extraction
        │
        ▼
Database column type
        │
        ▼
Index, constraint, storage, query plan, migration behavior
```

Contoh sederhana:

```java
@Column(name = "amount", precision = 19, scale = 2, nullable = false)
private BigDecimal amount;
```

Ini bukan hanya “field amount disimpan ke kolom amount”. Ia mengatakan:

1. Java memakai `BigDecimal`, bukan `double`.
2. Provider harus bind value ke JDBC numeric/decimal type.
3. Database harus menyimpan angka dengan total digit 19 dan 2 digit desimal.
4. Domain tidak menerima null.
5. DDL/migration idealnya membuat constraint `NOT NULL`.
6. Query plan bisa memanfaatkan index numeric jika dibuat.
7. API, validation, dan reporting harus mengikuti skala yang sama.

Mapping yang baik harus punya empat kualitas:

1. **Semantic clarity** — makna domain jelas.
2. **Database correctness** — schema benar-benar menjaga constraint penting.
3. **Provider predictability** — Hibernate/EclipseLink menghasilkan SQL dan binding yang dapat diprediksi.
4. **Migration resilience** — perubahan domain dan schema dapat dikelola tanpa corrupt data.

---

## 3. Annotation Is the Surface; Metadata Is the Real System

Annotation hanyalah salah satu sumber metadata.

Provider ORM membaca metadata dari beberapa tempat:

```text
Java annotations
XML mappings
orm.xml
persistence.xml
programmatic configuration
provider-specific annotations
naming strategies
attribute converters
custom types
bytecode enhancement/weaving metadata
runtime boot metadata
```

Karena itu, dua entity yang annotation-nya sama bisa menghasilkan behavior berbeda jika:

- Hibernate dialect berbeda.
- EclipseLink platform berbeda.
- naming strategy berbeda.
- enhancement/weaving aktif/tidak aktif.
- XML override digunakan.
- converter auto-apply aktif.
- Spring Boot property mengubah default.
- database column sudah ada dengan tipe berbeda dari metadata ORM.

### Design rule

Jangan pernah menganggap annotation sebagai “source of truth tunggal”. Untuk production, source of truth sebenarnya adalah kombinasi:

```text
Entity mapping + provider metadata + migration DDL + actual database schema + runtime configuration
```

---

## 4. Mapping Dimensions

Setiap field/association dalam entity punya beberapa dimensi mapping.

### 4.1 Object dimension

- Java type apa?
- Mutable atau immutable?
- Nullable atau wajib?
- Value object atau primitive data?
- Domain invariant apa yang harus dijaga?

### 4.2 Persistence dimension

- Disimpan sebagai kolom tunggal atau beberapa kolom?
- Butuh converter?
- Butuh custom provider type?
- Lazy atau always loaded?
- Masuk dirty checking bagaimana?

### 4.3 Database dimension

- SQL type apa?
- Precision/scale/length berapa?
- Nullable atau not null?
- Ada check constraint?
- Ada FK/index/unique constraint?
- Collation/case-sensitivity penting atau tidak?

### 4.4 Query dimension

- Field ini sering dipakai filter?
- Sort?
- Join?
- Projection?
- Range query?
- Full-text search?
- Equality lookup?

### 4.5 Migration dimension

- Bisa berubah nilainya di masa depan?
- Apakah backward-compatible?
- Apakah perlu data backfill?
- Apakah butuh dual-write sementara?
- Apakah perubahan enum dapat merusak data lama?

Mapping matang lahir dari semua dimensi ini, bukan dari autocomplete annotation.

---

## 5. Field Access vs Property Access

JPA menentukan access type berdasarkan lokasi annotation mapping pertama.

### Field access

```java
@Entity
public class Account {
    @Id
    private Long id;

    private String accountNo;

    public String getAccountNo() {
        return accountNo;
    }
}
```

Jika `@Id` berada di field, provider membaca/menulis field secara langsung.

### Property access

```java
@Entity
public class Account {
    private Long id;
    private String accountNo;

    @Id
    public Long getId() {
        return id;
    }

    public String getAccountNo() {
        return accountNo;
    }
}
```

Jika `@Id` berada di getter, provider memakai property accessor.

---

## 6. Field Access vs Property Access: Mental Model

```text
Field access:
Provider treats fields as persistence state.
Business methods/getters are not required for persistence.

Property access:
Provider treats getters/setters as persistence boundary.
Getter/setter side effects can affect persistence behavior.
```

### Field access advantages

- Lebih dekat ke state sebenarnya.
- Getter bisa punya logic tanpa mengganggu persistence.
- Cocok untuk domain model dengan controlled methods.
- Mengurangi risiko side effect dari getter/setter.

### Field access risks

- Provider bisa bypass validation di setter.
- Reflection/enhancement behavior harus dipahami.
- Test yang memanggil setter mungkin tidak sama dengan provider mutation.

### Property access advantages

- Bisa dipakai jika persistence state memang dikontrol via accessor.
- Kompatibel dengan model JavaBean lama.
- Kadang berguna untuk computed backing field.

### Property access risks

- Getter side effect bisa trigger behavior aneh.
- Setter validation bisa terpanggil saat hydration.
- Lazy proxy dan enhancement bisa berinteraksi dengan getter.
- Lombok-generated accessor bisa menyembunyikan behavior.

---

## 7. Mixed Access: Powerful but Dangerous

JPA memungkinkan override access pada attribute tertentu:

```java
@Entity
@Access(AccessType.FIELD)
public class Payment {
    @Id
    private Long id;

    private BigDecimal amount;

    @Transient
    private String computedLabel;

    @Access(AccessType.PROPERTY)
    @Column(name = "normalized_reference")
    public String getNormalizedReference() {
        return normalize(reference);
    }
}
```

Tetapi mixed access harus dipakai sangat hati-hati.

### Failure mode

```java
@Entity
public class UserAccount {
    @Id
    private Long id;

    @Column(name = "email")
    private String email;

    @Column(name = "email_normalized")
    public String getEmailNormalized() {
        return email == null ? null : email.toLowerCase(Locale.ROOT);
    }
}
```

Masalah potensial:

- Annotation tersebar di field dan getter.
- Provider bisa menentukan access default berbeda dari yang developer kira.
- Field tertentu bisa tidak termapping.
- Kolom computed bisa dianggap persistent biasa.
- Update bisa terjadi tiap flush jika getter tidak stabil.

### Design rule

Gunakan satu access strategy per entity hierarchy. Mixed access hanya untuk kasus yang sangat sadar dan terdokumentasi.

---

## 8. Basic Mapping Is Not Basic

`@Basic` dan `@Column` terlihat sederhana, tetapi menyimpan banyak keputusan.

```java
@Basic(optional = false)
@Column(name = "display_name", nullable = false, length = 120)
private String displayName;
```

### `@Basic(optional = false)` vs `@Column(nullable = false)`

Keduanya sering terlihat mirip, tetapi berbeda fokus:

| Setting | Layer utama | Makna |
|---|---|---|
| `@Basic(optional = false)` | JPA object mapping | attribute tidak optional menurut persistence metadata |
| `@Column(nullable = false)` | schema/DDL mapping | kolom seharusnya `NOT NULL` jika DDL dibuat dari mapping |

Dalam production dengan Flyway/Liquibase, annotation tidak otomatis menjamin database constraint sudah ada. Constraint database tetap harus ada di migration DDL.

### Design rule

Untuk invariant penting, jangan hanya percaya annotation. Pastikan ada constraint database.

---

## 9. Column Naming: The Hidden Portability Trap

```java
@Column(name = "created_date_time")
private Instant createdDateTime;
```

Column naming tampak kecil, tetapi berdampak besar pada:

- generated SQL,
- migration script,
- reserved words,
- case sensitivity,
- quoted identifier,
- DBA convention,
- reporting query,
- index naming,
- cross-provider behavior.

### Implicit naming vs explicit naming

Jika tidak memakai `@Column(name = ...)`, provider/naming strategy akan menentukan nama.

```java
private Instant createdDateTime;
```

Bisa menjadi:

```text
createdDateTime
created_date_time
CREATED_DATE_TIME
created_date_time_
```

tergantung framework/provider/naming strategy.

### Design rule

Untuk enterprise system, explicit naming biasanya lebih aman untuk entity utama dan kolom penting.

---

## 10. Quoted Identifiers

```java
@Column(name = "\"order\"")
private String order;
```

Quoted identifier bisa menyelamatkan ketika nama kolom bentrok dengan reserved word, tetapi membawa biaya:

- case sensitivity meningkat,
- migration harus konsisten,
- query native harus quote juga,
- portability turun,
- DBA tooling bisa lebih rumit.

### Better approach

Daripada:

```java
@Column(name = "order")
private String order;
```

Lebih baik:

```java
@Column(name = "sort_order")
private Integer sortOrder;
```

atau:

```java
@Column(name = "display_sequence")
private Integer displaySequence;
```

### Design rule

Avoid reserved words. Quoted identifiers adalah workaround, bukan default design style.

---

## 11. String Mapping: Length, Semantics, Collation, and Indexing

```java
@Column(name = "name", length = 255)
private String name;
```

String mapping harus menjawab:

1. Maksimum panjang berapa?
2. Panjang dalam character atau byte?
3. Case-sensitive atau case-insensitive?
4. Perlu trimming?
5. Perlu normalization?
6. Dipakai untuk equality lookup atau full-text search?
7. Perlu unique constraint?
8. Unicode support bagaimana?

### Example: username

```java
@Column(name = "username", nullable = false, length = 80, unique = true)
private String username;
```

Ini belum cukup jika sistem butuh case-insensitive uniqueness.

Kemungkinan solusi:

- simpan `username_normalized`,
- functional unique index,
- database collation case-insensitive,
- application-level normalization + database constraint.

### Better design

```java
@Column(name = "username", nullable = false, length = 80)
private String username;

@Column(name = "username_normalized", nullable = false, length = 80, unique = true)
private String usernameNormalized;

public void changeUsername(String username) {
    String normalized = normalizeUsername(username);
    this.username = username;
    this.usernameNormalized = normalized;
}
```

### Failure modes

- username `John` dan `john` dianggap berbeda padahal bisnis menganggap sama.
- index tidak dipakai karena query memakai `lower(username)` tanpa functional index.
- data terpotong karena database length dihitung byte, bukan character.
- invisible whitespace menyebabkan duplicate logical value.

---

## 12. Numeric Mapping: Never Treat Numbers as Just Numbers

### Integer-like types

| Java type | Typical use |
|---|---|
| `Integer` | nullable small count/status code |
| `int` | non-null primitive, default `0` risk |
| `Long` | ID/count large range |
| `long` | non-null primitive, default `0` risk |
| `BigInteger` | very large integer, uncommon for normal business fields |

Primitive fields can hide missing data:

```java
private int retryCount;
```

A new entity has `retryCount = 0`, whether explicitly set or not. That can be correct, but can also hide incomplete initialization.

### Decimal types

Use `BigDecimal` for money and exact decimal.

```java
@Column(name = "amount", precision = 19, scale = 2, nullable = false)
private BigDecimal amount;
```

Avoid:

```java
private double amount;
```

`double` is binary floating-point and not appropriate for exact money semantics.

### BigDecimal equality trap

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")); // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")); // 0
```

This matters for:

- domain equality,
- dirty checking assumptions,
- validation,
- test assertions,
- value object design.

### Design rule

For business decimal, always define:

- precision,
- scale,
- rounding policy,
- display format,
- comparison semantics,
- database constraint.

---

## 13. Boolean Mapping

Boolean seems trivial, but database representation differs:

| Database style | Possible representation |
|---|---|
| native boolean | `BOOLEAN` |
| numeric | `0/1` |
| char | `Y/N` |
| string | `TRUE/FALSE`, `ACTIVE/INACTIVE` |

JPA Boolean mapping depends on provider and dialect.

### When default boolean is enough

```java
@Column(name = "active", nullable = false)
private boolean active;
```

Good when database has native boolean or dialect maps it predictably.

### When explicit converter is better

Legacy schema:

```text
ACTIVE_FLAG CHAR(1) CHECK (ACTIVE_FLAG IN ('Y', 'N'))
```

Converter:

```java
@Converter
public class YesNoConverter implements AttributeConverter<Boolean, String> {
    @Override
    public String convertToDatabaseColumn(Boolean value) {
        if (value == null) return null;
        return value ? "Y" : "N";
    }

    @Override
    public Boolean convertToEntityAttribute(String dbValue) {
        if (dbValue == null) return null;
        return switch (dbValue) {
            case "Y" -> true;
            case "N" -> false;
            default -> throw new IllegalArgumentException("Unknown boolean flag: " + dbValue);
        };
    }
}
```

For Java 8 compatibility, use classic `switch`:

```java
@Override
public Boolean convertToEntityAttribute(String dbValue) {
    if (dbValue == null) return null;
    switch (dbValue) {
        case "Y": return Boolean.TRUE;
        case "N": return Boolean.FALSE;
        default: throw new IllegalArgumentException("Unknown boolean flag: " + dbValue);
    }
}
```

### Failure mode

If converter silently maps unknown values to `false`, corrupted database data becomes invisible.

Bad:

```java
return "Y".equals(dbValue);
```

This maps `"X"`, `""`, and `"NOPE"` to false.

### Design rule

Converters should fail loudly on invalid persisted values unless there is a deliberate backward-compatibility reason.

---

## 14. Enum Mapping: One of the Most Dangerous “Simple” Mappings

JPA supports enum mapping with `@Enumerated`.

```java
@Enumerated(EnumType.STRING)
@Column(name = "status", nullable = false, length = 40)
private ApplicationStatus status;
```

or:

```java
@Enumerated(EnumType.ORDINAL)
@Column(name = "status", nullable = false)
private ApplicationStatus status;
```

### 14.1 `EnumType.ORDINAL`

```java
enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Stored values:

| Enum | Ordinal |
|---|---:|
| DRAFT | 0 |
| SUBMITTED | 1 |
| APPROVED | 2 |
| REJECTED | 3 |

If someone changes enum order:

```java
enum ApplicationStatus {
    DRAFT,
    WITHDRAWN,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Then old database value `1` now means `WITHDRAWN`, not `SUBMITTED`.

That is silent data corruption.

### Rule

Do not use `EnumType.ORDINAL` for business data unless:

- enum is truly internal,
- persisted values are disposable,
- no long-lived data exists,
- migration risk is accepted explicitly.

For enterprise/regulatory systems, this is almost never acceptable.

---

## 15. `EnumType.STRING`: Better but Not Perfect

```java
@Enumerated(EnumType.STRING)
@Column(name = "status", nullable = false, length = 40)
private ApplicationStatus status;
```

Stored values:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
```

This survives enum reordering.

But it has its own risks:

- renaming enum constant breaks existing data,
- enum names become database contract,
- names may be too Java-centric,
- localization must not be stored as enum name,
- external system code may differ from Java enum name.

### Failure mode

```java
enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    ACCEPTED, // renamed from APPROVED
    REJECTED
}
```

Existing rows with `APPROVED` can no longer hydrate.

---

## 16. Stable-Code Enum Mapping

For long-lived business status, map enum to stable code.

```java
public enum ApplicationStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R");

    private final String code;

    ApplicationStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static ApplicationStatus fromCode(String code) {
        for (ApplicationStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown application status code: " + code);
    }
}
```

Converter:

```java
@Converter(autoApply = false)
public class ApplicationStatusConverter
        implements AttributeConverter<ApplicationStatus, String> {

    @Override
    public String convertToDatabaseColumn(ApplicationStatus attribute) {
        return attribute == null ? null : attribute.code();
    }

    @Override
    public ApplicationStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : ApplicationStatus.fromCode(dbData);
    }
}
```

Usage:

```java
@Convert(converter = ApplicationStatusConverter.class)
@Column(name = "status_code", nullable = false, length = 1)
private ApplicationStatus status;
```

Database:

```sql
status_code char(1) not null
check (status_code in ('D', 'S', 'A', 'R'))
```

### Why this is better

- Java enum constant can be renamed.
- Database code remains stable.
- External contract can align with business code.
- Check constraint protects invalid values.
- Storage compact.
- Migration explicit.

### Trade-off

- More code.
- Converter must be maintained.
- Query literals need awareness of database code if using native SQL.

---

## 17. Jakarta Persistence 3.2 `@EnumeratedValue` Note

Jakarta Persistence 3.2 added `@EnumeratedValue`, allowing enum fields to define the database value more directly in the enum model. Hibernate’s public documentation and the Jakarta Persistence 3.2 material describe the specification as the standard for object/relational mapping in Java, while newer provider lines add support for newer enum-related capabilities. For Java 8 / JPA 2.x / older provider lines, use `AttributeConverter` as the portable approach.

### Compatibility posture

| Runtime line | Recommended enum strategy |
|---|---|
| Java 8 + JPA 2.1/2.2 | `AttributeConverter` for stable code |
| Java 11/17 + Jakarta Persistence 3.0/3.1 | `AttributeConverter` for stable code |
| Jakarta Persistence 3.2+ | consider `@EnumeratedValue`, but validate provider support |
| Hibernate-specific advanced mapping | possible, but document portability loss |
| EclipseLink-specific advanced mapping | possible, but document portability loss |

### Design rule

For cross-version learning from Java 8–25, master `AttributeConverter` first. It is the most portable mental model.

---

## 18. Temporal Mapping: Time Is a Domain Decision, Not Just a Type

Time mapping is one of the highest-risk areas in enterprise systems.

Questions you must answer:

1. Is this a date-only value?
2. Is this a local wall-clock time?
3. Is this an instant on the global timeline?
4. Is timezone part of the data?
5. Is timezone only display concern?
6. Is timestamp used for audit/legal evidence?
7. Does the database preserve fractional seconds?
8. Does the database preserve timezone offset?
9. Does app server timezone matter?
10. Does JDBC driver timezone behavior matter?

---

## 19. Legacy Temporal Types

Java 8 introduced `java.time`, but Java 8–25 systems often still contain legacy types.

| Java type | Problem |
|---|---|
| `java.util.Date` | mutable, actually timestamp-like despite name |
| `java.sql.Date` | date-only but legacy JDBC-specific type |
| `java.sql.Timestamp` | mutable-ish, nanos handling complexity |
| `Calendar` | carries timezone but awkward and mutable |

JPA 2.1 era often used:

```java
@Temporal(TemporalType.TIMESTAMP)
@Column(name = "created_at", nullable = false)
private Date createdAt;
```

Modern code should prefer Java Time API when possible.

---

## 20. Java Time Mapping

Common choices:

| Java type | Meaning |
|---|---|
| `LocalDate` | date without time/timezone |
| `LocalTime` | time-of-day without date/timezone |
| `LocalDateTime` | local date-time, no timezone/offset |
| `Instant` | point on global timeline |
| `OffsetDateTime` | date-time with offset |
| `ZonedDateTime` | date-time with region timezone |
| `Duration` | amount of time |
| `Period` | date-based amount |

Hibernate’s user guide documents Java Time mappings such as `LocalDate` to SQL `DATE`, `Instant` to timestamp-related SQL type, and offset/zoned date-time depending on database support. This is provider/dialect-sensitive and must be verified against the actual database.

---

## 21. Temporal Design by Use Case

### 21.1 Audit timestamp

Use `Instant`.

```java
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;
```

Meaning:

```text
This event happened at this exact point on the global timeline.
```

Good for:

- audit trail,
- created/updated timestamp,
- event timestamp,
- log correlation,
- regulatory evidence.

### 21.2 Business date

Use `LocalDate`.

```java
@Column(name = "effective_date", nullable = false)
private LocalDate effectiveDate;
```

Meaning:

```text
This is a calendar date according to business rules, not a moment in time.
```

Good for:

- effective date,
- expiry date,
- birth date,
- reporting period date.

### 21.3 Scheduled local appointment

Use carefully.

```java
@Column(name = "appointment_local_at", nullable = false)
private LocalDateTime appointmentLocalAt;

@Column(name = "appointment_zone", nullable = false, length = 64)
private String appointmentZone;
```

Meaning:

```text
The appointment is at local wall-clock time in a specific timezone.
```

`LocalDateTime` alone is insufficient if timezone matters.

---

## 22. `LocalDateTime` Trap

```java
@Column(name = "submitted_at", nullable = false)
private LocalDateTime submittedAt;
```

This looks fine, but `LocalDateTime` has no timezone/offset. It is not a point on the global timeline.

If server A in Singapore and server B in Jakarta write `LocalDateTime.now()`, the same real instant can be stored differently.

### Better for audit

```java
private Instant submittedAt;
```

or if database/application standardizes UTC explicitly:

```java
private OffsetDateTime submittedAt;
```

### Design rule

Use `Instant` for machine/audit time. Use `LocalDate` for business date. Use `LocalDateTime` only when wall-clock local time is truly the domain concept.

---

## 23. Database Timestamp Precision

Java `Instant` can hold nanoseconds. Many databases store:

- seconds,
- milliseconds,
- microseconds,
- nanoseconds,
- configurable fractional precision.

### Failure mode

```java
Instant now = Instant.now();
entity.setUpdatedAt(now);
repository.save(entity);
entityManager.flush();
entityManager.clear();

Instant reloaded = repository.findById(id).get().getUpdatedAt();
assertEquals(now, reloaded); // may fail due to precision truncation
```

### Design rule

Normalize timestamp precision in tests and domain logic.

Example:

```java
Instant normalized = now.truncatedTo(ChronoUnit.MILLIS);
```

But choose truncation based on actual DB precision.

---

## 24. LOB Mapping: CLOB/BLOB Are Not Just Big Strings/Bytes

```java
@Lob
@Column(name = "metadata_json")
private String metadataJson;
```

or:

```java
@Lob
@Column(name = "document_content")
private byte[] documentContent;
```

LOB mapping affects:

- storage layout,
- memory usage,
- fetching behavior,
- streaming support,
- dirty checking cost,
- backup/restore size,
- query performance,
- indexing options,
- audit/history growth.

### CLOB pitfalls

- Hydrating entity may load large text into memory.
- Dirty checking may retain snapshots.
- Listing queries can accidentally pull LOB columns.
- JSON stored as CLOB is hard to index unless database supports functional/json indexing.
- Updating small metadata may rewrite large LOB depending on database/provider behavior.

### BLOB pitfalls

- `byte[]` loads whole content into heap.
- Large document storage can destroy app memory.
- Serialization across API boundary can explode response size.
- Lazy LOB is not always reliable without enhancement/provider support.

---

## 25. LOB Design Rule: Split Metadata from Payload

Bad:

```java
@Entity
@Table(name = "document")
public class Document {
    @Id
    private Long id;

    private String fileName;

    @Lob
    private byte[] content;
}
```

Any common query on `Document` risks interacting with content.

Better:

```java
@Entity
@Table(name = "document")
public class DocumentMetadata {
    @Id
    private Long id;

    @Column(name = "file_name", nullable = false, length = 255)
    private String fileName;

    @Column(name = "content_length", nullable = false)
    private long contentLength;

    @Column(name = "storage_key", nullable = false, length = 500)
    private String storageKey;
}
```

Content can live in:

- object storage,
- separate table,
- streaming endpoint,
- document store,
- BLOB table accessed deliberately.

If content must be in database:

```java
@Entity
@Table(name = "document_content")
public class DocumentContent {
    @Id
    private Long documentId;

    @Lob
    @Column(name = "content", nullable = false)
    private byte[] content;
}
```

Then only load it when needed.

---

## 26. JSON/XML Mapping

Modern systems often store semi-structured data:

- audit metadata,
- external API payload snapshot,
- dynamic form fields,
- integration request/response,
- rule evaluation result,
- schema-flexible case attributes.

Options:

### 26.1 Store as `String` CLOB/TEXT

```java
@Lob
@Column(name = "payload_json", nullable = false)
private String payloadJson;
```

Simple and portable, but weak query/index support.

### 26.2 Use provider-specific JSON type

Hibernate 6+ has improved type system support for JSON-style mapping depending on dialect and annotations.

Example conceptually:

```java
// Hibernate-specific mapping example; exact annotation depends on version.
@Column(name = "payload", columnDefinition = "jsonb")
private MyPayload payload;
```

Provider-specific JSON mapping can be powerful but lowers portability.

### 26.3 Use database-native JSON with converter

```java
@Convert(converter = PayloadJsonConverter.class)
@Column(name = "payload_json", nullable = false)
private Payload payload;
```

This gives domain type in Java, but queryability depends on database and converter behavior.

---

## 27. JSON/XML Design Questions

Before storing JSON/XML in ORM entity, answer:

1. Is this data queried often?
2. Does it need indexing?
3. Is schema validation required?
4. Is it audit evidence?
5. Is it immutable snapshot or mutable state?
6. Does it contain PII/secrets?
7. How large can it grow?
8. How will it be archived?
9. Do we need partial update?
10. Do we need backward-compatible schema evolution?

### Rule

JSON column is not a substitute for unclear relational modeling. It is good for semi-structured data, snapshots, and extensibility—but bad as a dumping ground for core queryable state.

---

## 28. AttributeConverter: Portable Power Tool

`AttributeConverter<X, Y>` maps between entity attribute type `X` and database column type `Y`.

```java
public interface AttributeConverter<X, Y> {
    Y convertToDatabaseColumn(X attribute);
    X convertToEntityAttribute(Y dbData);
}
```

Use cases:

- stable-code enum,
- value object wrapping string/number,
- boolean flags,
- encrypted field,
- JSON string serialization,
- legacy code mapping,
- normalization.

### Example: EmailAddress value object

```java
public final class EmailAddress {
    private final String value;

    private EmailAddress(String value) {
        this.value = value;
    }

    public static EmailAddress of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Email is required");
        }
        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        if (!normalized.contains("@")) {
            throw new IllegalArgumentException("Invalid email");
        }
        return new EmailAddress(normalized);
    }

    public String value() {
        return value;
    }
}
```

Java 8 compatible version avoids `isBlank()`:

```java
public static EmailAddress of(String raw) {
    if (raw == null || raw.trim().isEmpty()) {
        throw new IllegalArgumentException("Email is required");
    }
    String normalized = raw.trim().toLowerCase(Locale.ROOT);
    if (!normalized.contains("@")) {
        throw new IllegalArgumentException("Invalid email");
    }
    return new EmailAddress(normalized);
}
```

Converter:

```java
@Converter(autoApply = true)
public class EmailAddressConverter implements AttributeConverter<EmailAddress, String> {
    @Override
    public String convertToDatabaseColumn(EmailAddress attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public EmailAddress convertToEntityAttribute(String dbData) {
        return dbData == null ? null : EmailAddress.of(dbData);
    }
}
```

Usage:

```java
@Column(name = "email", nullable = false, length = 320)
private EmailAddress email;
```

---

## 29. Converter Risks

Converters are powerful but can break assumptions.

### 29.1 Query binding risk

```java
@Query("select u from User u where u.email = :email")
List<User> findByEmail(@Param("email") EmailAddress email);
```

Provider should apply converter, but provider/version behavior must be tested especially in:

- Criteria query,
- native query,
- bulk update,
- function expression,
- provider-specific query API.

### 29.2 Auto-apply risk

```java
@Converter(autoApply = true)
public class StringTrimmingConverter implements AttributeConverter<String, String> { ... }
```

This looks convenient but dangerous: it applies to all `String` attributes unless excluded. It can silently modify fields that should preserve whitespace.

### 29.3 Non-deterministic converter risk

Bad:

```java
@Override
public String convertToDatabaseColumn(Token token) {
    return encryptWithRandomIv(token.value());
}
```

This may be correct for encryption, but equality queries become impossible unless there is a separate deterministic searchable representation.

### 29.4 Heavy converter risk

Converter runs during hydration and binding. If it parses large JSON or calls external service, performance collapses.

### Rule

Converters should be:

- deterministic unless deliberately not,
- side-effect free,
- fast,
- null-safe,
- explicit about invalid data,
- tested with queries, not only persist/find.

---

## 30. Value Objects in Entities

Value objects can make persistence models safer.

Instead of:

```java
@Column(name = "postal_code", length = 6)
private String postalCode;
```

Use:

```java
@Column(name = "postal_code", length = 6, nullable = false)
private PostalCode postalCode;
```

with converter.

### Benefit

- Domain validation centralized.
- Method signature becomes meaningful.
- Invalid state harder to create.
- Mapping expresses semantic type.

### Risk

- Too many tiny converters can complicate query and debugging.
- Provider behavior must be tested.
- Value object must be immutable.
- Equality must be correct.

### Design rule

Use value objects for fields with real domain behavior/invariant, not for every primitive obsession automatically.

---

## 31. Mutable Types and Dirty Checking

Mutable types are dangerous in ORM because dirty checking may rely on snapshots and comparison.

Examples:

- `Date`,
- `Calendar`,
- `byte[]`,
- mutable embeddable,
- mutable custom value object,
- mutable collection inside converter-backed object.

### Problem example

```java
Date dueDate = invoice.getDueDate();
dueDate.setTime(newTime);
```

The entity setter was not called. Depending on provider dirty checking strategy, this may or may not be detected.

### Better

Use immutable types:

```java
private Instant dueAt;
private LocalDate dueDate;
```

For arrays, avoid mutating in place or defensively copy.

```java
public byte[] getChecksum() {
    return checksum == null ? null : checksum.clone();
}

public void setChecksum(byte[] checksum) {
    this.checksum = checksum == null ? null : checksum.clone();
}
```

### Rule

Prefer immutable attribute types. If mutable type is unavoidable, understand dirty checking and defensive copying.

---

## 32. Nullability: Java, ORM, Database, and API Must Agree

Nullability exists at multiple layers:

| Layer | Mechanism |
|---|---|
| Java type | primitive vs wrapper, Optional discouraged in entity fields |
| Bean Validation | `@NotNull` |
| JPA metadata | `optional = false`, `nullable = false` |
| Database | `NOT NULL` constraint |
| API | request validation/schema |
| Domain | constructor/factory invariant |

Example:

```java
@NotNull
@Column(name = "status_code", nullable = false, length = 1)
@Convert(converter = ApplicationStatusConverter.class)
private ApplicationStatus status;
```

But the strongest protection is still database constraint:

```sql
status_code char(1) not null
```

### Failure mode

If Java says non-null but database allows null, bad data can enter through:

- old version app,
- SQL script,
- batch import,
- DBA operation,
- integration job,
- native query,
- bug in another service.

### Rule

For business invariants, enforce at domain + validation + database where practical.

---

## 33. `Optional` in Entity Fields

Avoid:

```java
private Optional<String> middleName;
```

Entity fields should usually be actual persistent values, not wrapper API types.

Better:

```java
@Column(name = "middle_name", length = 120)
private String middleName;

public Optional<String> middleName() {
    return Optional.ofNullable(middleName);
}
```

### Why

- JPA providers expect field types to map to database values.
- `Optional` is not meant as persistent field type.
- It complicates proxying, reflection, and serialization.

---

## 34. Immutability and Column Updatability

```java
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;
```

`updatable = false` tells provider not to include the column in SQL update.

It does not necessarily prevent Java field mutation in memory.

```java
entity.setCreatedAt(Instant.now()); // possible if setter exists
```

Provider may ignore it on update, but your object state becomes misleading.

### Better

```java
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;

protected Order() {
}

public Order(Instant createdAt) {
    this.createdAt = Objects.requireNonNull(createdAt);
}

public Instant getCreatedAt() {
    return createdAt;
}
```

No public setter for immutable fields.

### Rule

ORM metadata controls persistence behavior. Domain methods control object behavior. Use both.

---

## 35. Insertable/Updatable Flags

```java
@Column(name = "created_by", insertable = true, updatable = false)
private String createdBy;
```

Useful for:

- audit fields,
- database-generated columns,
- read-only mirror columns,
- mapping same column in multiple ways,
- legacy schema.

Dangerous when used to “fix” duplicate column mapping without understanding ownership.

### Example: FK field plus association

```java
@Column(name = "customer_id", insertable = false, updatable = false)
private Long customerId;

@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "customer_id")
private Customer customer;
```

This can be valid: `customerId` is read-only scalar view, `customer` owns FK mapping.

But if both are writable, provider sees duplicate writes to same column.

### Rule

When mapping one column twice, exactly one mapping should be write owner.

---

## 36. Database Defaults vs ORM Defaults

Database default:

```sql
status_code char(1) default 'D' not null
```

Entity:

```java
@Column(name = "status_code", nullable = false, length = 1)
private String statusCode;
```

If ORM sends `NULL`, database default may not apply. Defaults often apply only when column is omitted from insert.

### Better

Set default in domain constructor/factory:

```java
public Application() {
    this.status = ApplicationStatus.DRAFT;
}
```

For database-generated defaults, configure mapping intentionally.

Hibernate has provider-specific annotations and generated value handling. EclipseLink has its own mechanisms. But for portable domain state, prefer explicit initialization.

### Rule

Do not rely on database default to initialize managed entity state unless you intentionally refresh/read generated value.

---

## 37. Generated Columns and Computed Values

Modern databases support generated/computed columns.

Example concept:

```sql
full_name generated always as (first_name || ' ' || last_name)
```

ORM mapping should treat it as read-only:

```java
@Column(name = "full_name", insertable = false, updatable = false)
private String fullName;
```

### Risks

- Entity may not see generated value until reload/refresh.
- Provider may include stale value in memory.
- Query behavior depends on database support.
- Migration and DDL generation portability low.

### Rule

Computed columns are database features. Use them deliberately and test reload behavior.

---

## 38. Column Definition: Escape Hatch With Portability Cost

```java
@Column(name = "payload", columnDefinition = "jsonb")
private String payload;
```

`columnDefinition` gives direct DDL fragment. It is useful for:

- JSONB,
- database-specific enum,
- custom numeric type,
- generated column,
- special default,
- check-like definition.

But it couples mapping to a database dialect.

### Failure mode

A mapping with:

```java
columnDefinition = "jsonb"
```

will not work on Oracle/MySQL/SQL Server as-is.

### Rule

Use `columnDefinition` only when database-specific behavior is intentional and documented.

---

## 39. Indexes and Unique Constraints in Mapping

JPA supports table-level indexes and unique constraints in annotations.

```java
@Table(
    name = "application",
    indexes = {
        @Index(name = "idx_application_status", columnList = "status_code"),
        @Index(name = "idx_application_created_at", columnList = "created_at")
    },
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_application_ref_no", columnNames = "reference_no")
    }
)
@Entity
public class Application { ... }
```

Useful for documentation and DDL generation.

But in production, real index management should be in migrations:

- index type,
- online creation,
- partial index,
- functional index,
- tablespace,
- fillfactor,
- invisible index,
- concurrent creation,
- database-specific options.

### Rule

Annotation indexes can document intent, but migration DDL owns production index reality.

---

## 40. Check Constraints

Jakarta Persistence/Hibernate/provider lines vary in support for check constraints and DDL features. Provider-specific annotations may exist.

For critical constraints, write migration SQL explicitly:

```sql
alter table application
add constraint chk_application_status
check (status_code in ('D', 'S', 'A', 'R'));
```

### Why

- Provider DDL generation may not run in production.
- Database-specific check syntax differs.
- Constraint naming matters for operations.
- Migration ordering matters.

### Rule

For business invariants that database can enforce, migration SQL is the durable contract.

---

## 41. Mapping and Bean Validation Are Not the Same

```java
@NotBlank
@Column(name = "name", nullable = false, length = 120)
private String name;
```

Bean Validation catches invalid object state before persistence if validation is triggered.

Database constraint catches invalid data regardless of source.

They complement each other.

### Example

```java
@NotBlank
@Size(max = 120)
@Column(name = "name", nullable = false, length = 120)
private String name;
```

Still add database constraint:

```sql
name varchar(120) not null
```

Possibly check trimmed length if required:

```sql
check (length(trim(name)) > 0)
```

### Rule

Validation improves application feedback. Database constraints protect data integrity.

---

## 42. Mapping and Lombok

Lombok can reduce boilerplate but is risky on entities.

Avoid:

```java
@Data
@Entity
public class Customer {
    @Id
    private Long id;

    @OneToMany(mappedBy = "customer")
    private Set<Order> orders;
}
```

Problems:

- `equals`/`hashCode` may include lazy collections.
- `toString` may trigger lazy loading or recursion.
- setters expose uncontrolled mutation.
- generated constructor may conflict with JPA requirement.

Better:

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class Customer {
    @Id
    private Long id;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    protected Customer() {
    }

    public Customer(String name) {
        this.name = requireValidName(name);
    }
}
```

Use Lombok selectively.

### Rule

For entities, avoid `@Data`. Prefer explicit methods or narrow Lombok annotations.

---

## 43. Hibernate-Specific Mapping Extensions

Hibernate provides many useful extensions beyond JPA/Jakarta Persistence, such as:

- custom type system,
- natural ID,
- filters,
- soft delete support in newer lines,
- generated columns support,
- formula mapping,
- dynamic insert/update,
- batch size,
- fetch modes,
- JSON/type annotations depending on version,
- bytecode enhancement options.

These are often necessary for high-quality production systems.

### Mindset

Provider-specific is not automatically bad.

Bad provider-specific usage:

```text
Using extension accidentally because tutorial said so, without understanding lock-in.
```

Good provider-specific usage:

```text
Choosing extension deliberately because it solves a real production problem, documenting portability cost.
```

---

## 44. EclipseLink-Specific Mapping Extensions

EclipseLink has rich mapping capabilities, including:

- converters,
- transformation mappings,
- object type conversion,
- direct collection mapping,
- aggregate mappings,
- fetch groups,
- batch reading,
- descriptor customizers,
- weaving-based features,
- shared cache configuration.

EclipseLink’s mapping model often exposes descriptor-level customization more explicitly than typical JPA usage.

### Design rule

When using EclipseLink-specific mappings, document:

- why standard JPA is insufficient,
- which provider feature is used,
- how it is tested,
- migration implication if moving to Hibernate.

---

## 45. Mapping for Oracle, PostgreSQL, MySQL, SQL Server: Examples of Database Reality

### Oracle

Common concerns:

- `NUMBER` precision ambiguity,
- `CLOB`/`BLOB` storage,
- sequence-based IDs,
- timestamp/timezone types,
- identifier length limits historically,
- quoted identifiers pain,
- empty string treated as null for `VARCHAR2`.

Oracle empty string behavior is especially important:

```java
@Column(name = "middle_name")
private String middleName;
```

Persisting `""` may come back as `null` depending on Oracle behavior.

### PostgreSQL

Common concerns:

- native `uuid`,
- `jsonb`,
- arrays,
- enum types,
- `timestamp with time zone` semantics,
- functional/partial indexes,
- case-insensitive `citext` extension.

### MySQL/MariaDB

Common concerns:

- timezone/session settings,
- `datetime` vs `timestamp`,
- collation default,
- silent truncation depending on SQL mode,
- `text` indexing prefix limits,
- enum type temptation.

### SQL Server

Common concerns:

- `datetime2` precision,
- identity columns,
- `uniqueidentifier`,
- `nvarchar`,
- locking behavior,
- pagination SQL.

### Rule

Mapping strategy is never purely Java. Database behavior is part of the mapping.

---

## 46. Mapping Review Checklist

For every persistent attribute, ask:

```text
[ ] What is the domain meaning?
[ ] Is null allowed by domain?
[ ] Is null prevented by database?
[ ] Is Java type appropriate?
[ ] Is database type appropriate?
[ ] Are length/precision/scale explicit?
[ ] Is timezone/precision policy explicit?
[ ] Is enum value stable across code changes?
[ ] Is converter needed?
[ ] Is converter deterministic and tested?
[ ] Is field mutable?
[ ] Can dirty checking detect changes?
[ ] Is the field loaded in list screens?
[ ] Is it indexed if queried frequently?
[ ] Is it included in equals/hashCode/toString accidentally?
[ ] Is it safe under provider migration?
[ ] Does migration DDL match mapping?
```

---

## 47. Anti-Patterns

### 47.1 Annotation cargo cult

```java
@Column
private String name;
```

No length, nullability, semantic clarity, or migration awareness.

### 47.2 Enum ordinal persistence

```java
@Enumerated(EnumType.ORDINAL)
private Status status;
```

Silent corruption risk.

### 47.3 Entity as API DTO

```java
@PostMapping
public Application create(@RequestBody Application application) {
    return repository.save(application);
}
```

Mapping becomes exposed to external clients. Mass assignment and detached graph risks follow.

### 47.4 LOB in hot entity

```java
@Lob
private String fullPayload;
```

on an entity used in listing/search screens.

### 47.5 `@Data` on entity

Triggers lazy loading, recursion, equality bugs.

### 47.6 ColumnDefinition everywhere

Locks mapping to one database without explicit architecture decision.

### 47.7 Converter with side effects

Converter should not call external service, generate random values unexpectedly, or depend on request context unless extremely deliberate.

---

## 48. Production Failure Modes

### 48.1 Data corrupt after enum change

Symptom:

- old records show wrong status after deployment.

Root cause:

- `EnumType.ORDINAL` used.

Fix:

- migrate to stable code column,
- backfill carefully,
- add check constraint,
- forbid ordinal for business status.

---

### 48.2 Query suddenly stops using index

Symptom:

- lookup by email slow.

Root cause:

```sql
where lower(email) = lower(?)
```

but index exists only on `email`, not `lower(email)`.

Fix:

- normalized column,
- functional index,
- proper collation strategy.

---

### 48.3 Audit timestamp inconsistent across nodes

Symptom:

- records created at “future” or inconsistent local time.

Root cause:

- `LocalDateTime.now()` used across nodes with different timezone assumptions.

Fix:

- use `Instant`,
- standardize UTC,
- check JDBC/session timezone.

---

### 48.4 Memory spike when listing records

Symptom:

- listing endpoint causes high heap usage.

Root cause:

- entity contains eager or effectively eager CLOB/BLOB field.

Fix:

- projection query,
- split LOB table/entity,
- avoid loading payload in list query,
- consider external storage.

---

### 48.5 Invalid legacy code crashes hydration

Symptom:

- one bad row causes endpoint failure.

Root cause:

- converter throws on unknown code.

This is sometimes correct because it exposes data corruption. But operationally, you may need:

- data repair,
- quarantine path,
- tolerant read model,
- admin report for invalid codes.

### Rule

Fail-fast converter is good for integrity, but production system needs repair workflow.

---

## 49. Provider Behavior Notes

### Hibernate

Hibernate’s mapping behavior is strongly shaped by:

- type system,
- dialect,
- boot metadata,
- bytecode enhancement,
- access type,
- dirty checking strategy,
- generated SQL AST in modern versions,
- custom type/converter integration.

Its official user guide documents mappings for Java Time types and enum mapping options, but exact behavior must still be tested against the database dialect and Hibernate version used.

### EclipseLink

EclipseLink’s mapping behavior is shaped by:

- descriptors,
- sessions/unit of work,
- weaving,
- converters,
- transformation mappings,
- shared cache,
- platform/database abstraction.

Its documentation emphasizes standards-based persistence plus extensions beyond the standard. Advanced EclipseLink mapping often involves descriptor-level thinking, not only annotation-level thinking.

### Rule

Never assume provider-neutral behavior for advanced mapping. Build a tiny verification test for every mapping decision that carries production risk.

---

## 50. Java 8–25 Compatibility Notes

### Java 8

- Java Time API available.
- No records, no switch expressions, no text blocks.
- JPA 2.1/2.2 commonly uses `javax.persistence`.
- Hibernate 5.x common in legacy apps.
- EclipseLink 2.x common in legacy Jakarta/Java EE systems.

### Java 11

- Common baseline for Jakarta EE 9/10 era.
- Better runtime baseline for modern providers.
- Still no records as stable language feature until later.

### Java 17

- Major LTS baseline for modern Spring Boot/Jakarta systems.
- Records available, but be careful using records as entities. JPA entities need no-arg constructor, identity, lifecycle, and mutability/proxy compatibility considerations.
- Records are more suitable for DTO/projection than entities.

### Java 21

- Modern LTS baseline.
- Virtual threads affect request/concurrency architecture, but do not remove ORM transaction/connection constraints.
- Mapping rules remain the same.

### Java 25

- Modern LTS line.
- Same mapping fundamentals apply.
- Provider/library compatibility must be checked; language/runtime newness does not automatically mean ORM provider supports every advanced runtime scenario.

---

## 51. Practical Mapping Decision Matrix

| Field kind | Recommended mapping | Avoid |
|---|---|---|
| Business status | stable code enum + converter + check constraint | ordinal enum |
| Audit timestamp | `Instant` | `LocalDateTime.now()` without timezone policy |
| Business date | `LocalDate` | timestamp if time irrelevant |
| Money | `BigDecimal` with precision/scale | `double`, unspecified decimal |
| Username/email lookup | normalized column/index | lower function without matching index |
| Large payload | separate table/object storage | LOB on hot list entity |
| Legacy Y/N flag | converter + check constraint | silent unknown-to-false mapping |
| External payload snapshot | JSON/CLOB or native JSON, immutable | mixing core query state into unstructured blob |
| Computed DB value | read-only column mapping | writable generated column |
| Provider-specific type | documented extension | accidental lock-in |

---

## 52. Example: Regulatory Case Mapping

Consider a case management system.

### Naive mapping

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    private String status;
    private String priority;
    private String applicantEmail;
    private LocalDateTime submittedAt;

    @Lob
    private String metadata;
}
```

Problems:

- status is arbitrary string,
- priority is arbitrary string,
- email not normalized,
- submittedAt has no timezone semantics,
- metadata can become dumping ground,
- no length/nullability,
- no stable codes,
- no check constraints,
- list query may load metadata.

### Better mapping

```java
@Entity
@Table(
    name = "case_file",
    indexes = {
        @Index(name = "idx_case_file_status", columnList = "status_code"),
        @Index(name = "idx_case_file_submitted_at", columnList = "submitted_at"),
        @Index(name = "idx_case_file_applicant_email_norm", columnList = "applicant_email_normalized")
    }
)
public class CaseFile {

    @Id
    @Column(name = "id")
    private Long id;

    @Convert(converter = CaseStatusConverter.class)
    @Column(name = "status_code", nullable = false, length = 2)
    private CaseStatus status;

    @Convert(converter = CasePriorityConverter.class)
    @Column(name = "priority_code", nullable = false, length = 1)
    private CasePriority priority;

    @Column(name = "applicant_email", nullable = false, length = 320)
    private String applicantEmail;

    @Column(name = "applicant_email_normalized", nullable = false, length = 320)
    private String applicantEmailNormalized;

    @Column(name = "submitted_at", nullable = false, updatable = false)
    private Instant submittedAt;

    protected CaseFile() {
    }

    public CaseFile(Long id, String applicantEmail, Instant submittedAt) {
        this.id = Objects.requireNonNull(id);
        setApplicantEmail(applicantEmail);
        this.status = CaseStatus.DRAFT;
        this.priority = CasePriority.NORMAL;
        this.submittedAt = Objects.requireNonNull(submittedAt);
    }

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
    }

    public void setApplicantEmail(String applicantEmail) {
        String normalized = normalizeEmail(applicantEmail);
        this.applicantEmail = applicantEmail.trim();
        this.applicantEmailNormalized = normalized;
    }

    private static String normalizeEmail(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Applicant email is required");
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Payload separated:

```java
@Entity
@Table(name = "case_file_metadata")
public class CaseFileMetadata {
    @Id
    @Column(name = "case_file_id")
    private Long caseFileId;

    @Lob
    @Column(name = "metadata_json", nullable = false)
    private String metadataJson;
}
```

Database migration still owns constraints:

```sql
alter table case_file add constraint chk_case_file_status
check (status_code in ('DR', 'SB', 'RV', 'AP', 'RJ'));

alter table case_file add constraint chk_case_file_priority
check (priority_code in ('L', 'N', 'H', 'U'));

create unique index uk_case_file_applicant_email_norm
on case_file(applicant_email_normalized, id);
```

This mapping expresses production intent much better.

---

## 53. Mapping as Documentation

Good mapping helps future engineers answer:

- What does this field mean?
- Is it required?
- How large can it be?
- Can it change?
- Is it database-generated?
- Is it queryable?
- Is it stable across enum rename?
- Is it safe to list thousands of rows?
- Does it contain large/sensitive payload?

Bad mapping forces them to infer everything from runtime bugs.

---

## 54. Exercises

### Exercise 1 — Enum safety

Given:

```java
@Enumerated(EnumType.ORDINAL)
private EnforcementStatus status;
```

Refactor to stable-code enum mapping with converter and database check constraint.

Questions:

1. What are existing ordinal values?
2. How will you backfill new code column?
3. How will you deploy without downtime?
4. How will you prevent old code from writing ordinal after migration?

---

### Exercise 2 — Timestamp policy

Given:

```java
private LocalDateTime createdAt;
private LocalDateTime approvedAt;
private LocalDate expiryDate;
```

Decide which fields should be `Instant`, `LocalDate`, or something else.

Explain:

- audit meaning,
- display timezone,
- database type,
- precision testing,
- migration risk.

---

### Exercise 3 — LOB split

Given an entity:

```java
@Entity
class AuditTrail {
    @Id Long id;
    String module;
    String activity;
    Instant createdAt;
    @Lob String serializedChanges;
    @Lob String fullText;
}
```

Design a split model for:

- listing screen,
- detail screen,
- search,
- archive,
- retention policy.

---

### Exercise 4 — Converter correctness

Design converter for `RiskRating` stored as `L`, `M`, `H`, `C`.

Test:

- persist,
- find,
- JPQL query by enum,
- Criteria query,
- invalid database code,
- null handling.

---

## 55. Summary

Mapping strategy is not about memorizing annotations. It is about designing the boundary between Java state and relational state.

The advanced mindset:

1. A field mapping is a contract.
2. Java type, provider type, JDBC type, and database type must align.
3. Annotation metadata is not enough; actual schema matters.
4. Enum ordinal is dangerous for long-lived business data.
5. `EnumType.STRING` is better but still couples database to Java names.
6. Stable-code enum mapping is usually best for enterprise state.
7. Time mapping must distinguish audit instant, business date, and local wall-clock time.
8. LOBs must be isolated from hot query paths.
9. Converters are powerful but must be deterministic, fast, and tested with queries.
10. Provider-specific extensions are acceptable when chosen deliberately.
11. Database constraints remain the final guardrail for data integrity.
12. Good mapping makes production behavior predictable.

If Part 0–7 built the mental model of ORM as a synchronization engine, Part 8 defines the quality of the contract being synchronized.

---

## 56. References

- Jakarta Persistence 3.2 Specification — standard persistence and object/relational mapping model for Java.
- Hibernate ORM User Guide — basic value mappings, enum mapping, temporal mapping, type system, and dialect-sensitive behavior.
- EclipseLink Documentation and API Reference — standards-based persistence plus provider extensions such as descriptors, mappings, converters, transformation mapping, and weaving.
- EclipseLink 4.x release documentation — Jakarta EE 10 / Jakarta Persistence 3.1 era baseline; newer EclipseLink lines add Jakarta Persistence 3.2 support.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 7 — SQL Generation Pipeline and Dialect Behavior](./07-sql-generation-pipeline-dialect-behavior.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 9 — Association Mapping: Ownership, Foreign Keys, Join Tables, and Graph Mutation](./09-association-mapping-ownership-foreign-keys-join-tables.md)

</div>