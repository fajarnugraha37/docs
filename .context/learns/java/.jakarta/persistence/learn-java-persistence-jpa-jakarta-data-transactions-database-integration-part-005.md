# Part 005 — Mapping Fundamentals Done Correctly

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 hingga Java 25  
> Fokus: Jakarta Persistence/JPA mapping fundamental sebagai kontrak antara object model dan relational schema  
> Status seri: Part 005 dari 032 — belum bagian terakhir

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat annotation mapping JPA/Jakarta Persistence bukan sebagai dekorasi class, tetapi sebagai **kontrak data jangka panjang** antara Java object, database schema, migration, query behavior, dan production operation.
2. Mendesain mapping field dasar secara benar untuk:
   - string,
   - number,
   - boolean,
   - enum,
   - date/time,
   - decimal money/amount,
   - value object,
   - LOB/CLOB/BLOB,
   - generated/read-only column,
   - converter/custom representation.
3. Memahami bedanya constraint di annotation dengan constraint di database.
4. Menghindari bug klasik:
   - enum ordinal berubah,
   - timezone corrupt,
   - `BigDecimal` precision salah,
   - `LocalDateTime` dipakai untuk event global,
   - `nullable=false` dianggap cukup sebagai `NOT NULL`,
   - converter dipakai untuk hal yang seharusnya relation/table,
   - LOB diperlakukan seperti string biasa,
   - schema generation otomatis dipakai di production.
5. Membuat mapping yang tahan terhadap evolution, refactor, migration, backward compatibility, audit, reporting, dan debugging production.

Bagian ini tidak membahas relationship mapping seperti `@ManyToOne`, `@OneToMany`, dan fetch strategy. Itu akan dibahas pada Part 006 dan Part 007. Bagian ini fokus pada **basic/value mapping**.

---

## 2. Mental Model: Mapping adalah Contract, Bukan Annotation Checklist

Banyak developer belajar JPA seperti ini:

```java
@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;

    @Column(name = "email")
    private String email;
}
```

Lalu menganggap mapping selesai.

Cara berpikir ini terlalu dangkal. Mapping sebenarnya menjawab pertanyaan yang jauh lebih penting:

> Ketika nilai Java ini masuk ke database, apa arti datanya, bagaimana database menyimpannya, bagaimana query membacanya, bagaimana migration mengubahnya, bagaimana constraint melindunginya, dan bagaimana sistem lain menafsirkannya?

Satu field Java tampak sederhana:

```java
private String status;
```

Tetapi secara production, field itu membawa banyak keputusan:

| Pertanyaan | Contoh Risiko |
|---|---|
| Boleh `null`? | data lama gagal diproses karena status kosong |
| Maksimal panjang? | value terpotong atau insert gagal |
| Case-sensitive? | `approved`, `APPROVED`, `Approved` dianggap berbeda |
| Apakah status enum? | refactor enum mematahkan data lama |
| Apakah status state machine? | invalid transition masuk karena hanya string biasa |
| Perlu index? | listing/search lambat |
| Perlu audit? | perubahan status tidak defensible |
| Perlu backward compatibility? | deployment rolling gagal karena enum baru belum dikenal versi lama |

Jadi mapping fundamental bukan tentang “annotation apa yang dipakai”, melainkan tentang **semantic preservation**.

---

## 3. Peta Besar Mapping Fundamental

Sebuah persistent attribute biasanya melalui 5 lapisan:

```text
Java Field
  ↓
JPA/Jakarta Persistence Mapping
  ↓
Provider Type System, misalnya Hibernate type system
  ↓
JDBC Type
  ↓
Database Column Type
```

Contoh:

```text
Java:        BigDecimal amount
JPA:         @Column(precision = 19, scale = 2)
Hibernate:   BigDecimalJavaType + DecimalJdbcType
JDBC:        DECIMAL / NUMERIC
Database:    NUMBER(19,2), NUMERIC(19,2), DECIMAL(19,2)
```

Atau:

```text
Java:        Instant occurredAt
JPA:         @Column(nullable = false)
Provider:    timestamp mapping
JDBC:        TIMESTAMP / TIMESTAMP_WITH_TIMEZONE depending provider/dialect
Database:    TIMESTAMP, TIMESTAMP WITH TIME ZONE, DATETIME, etc.
```

Yang harus dipahami: JPA standard memberikan abstraksi, tetapi database tetap punya perilaku konkret. Mapping yang sama bisa punya efek berbeda di Oracle, PostgreSQL, MySQL, dan SQL Server.

---

## 4. `@Entity`, `@Table`, dan Naming sebagai Contract

### 4.1 Entity Name vs Table Name

```java
@Entity(name = "CaseRecord")
@Table(name = "case_record")
public class CaseRecord {
    @Id
    private Long id;
}
```

Ada dua nama berbeda:

| Nama | Dipakai Untuk |
|---|---|
| `@Entity(name = "...")` | JPQL/HQL entity name |
| `@Table(name = "...")` | physical database table |

Contoh JPQL:

```java
select c from CaseRecord c where c.status = :status
```

Di sini `CaseRecord` adalah entity name, bukan table name.

### 4.2 Best Practice Naming

Untuk aplikasi besar, jangan bergantung total pada implicit naming kecuali organisasimu punya naming strategy yang stabil.

Lebih eksplisit untuk entity penting:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {
    @Id
    @Column(name = "case_record_id", nullable = false, updatable = false)
    private Long id;
}
```

Kenapa?

Karena naming adalah bagian dari kontrak database. Refactor Java class tidak boleh diam-diam mengganti table/column name.

Buruk:

```java
@Entity
public class AppealApplication {
    @Id
    private Long id;
}
```

Jika naming strategy berubah saat upgrade framework/provider, physical table name bisa berubah dari misalnya `appeal_application` menjadi bentuk lain. Untuk sistem enterprise, terutama yang memakai migration tool dan audit/reporting, ini berbahaya.

---

## 5. `@Column`: Small Annotation, Big Consequences

`@Column` tampak sederhana, tetapi punya dampak besar.

```java
@Column(
    name = "email_address",
    nullable = false,
    length = 320,
    unique = true,
    insertable = true,
    updatable = true
)
private String emailAddress;
```

### 5.1 `name`

Selalu tanyakan:

- Apakah nama column mengikuti naming convention database?
- Apakah nama ini stabil untuk jangka panjang?
- Apakah nama ini jelas bagi DBA/reporting/system integration?

Field Java boleh berubah, column database harus lebih konservatif.

```java
// Java refactor boleh terjadi
private String applicantEmail;

// Database contract tetap stabil
@Column(name = "email_address", nullable = false, length = 320)
private String applicantEmail;
```

### 5.2 `nullable`

```java
@Column(nullable = false)
private String name;
```

`nullable=false` punya dua makna berbeda tergantung konteks:

1. Metadata untuk provider/schema generation.
2. Dokumentasi mapping bahwa field ini seharusnya non-null.

Namun dalam production, yang benar-benar melindungi data adalah:

```sql
ALTER TABLE person MODIFY name NOT NULL;
```

atau:

```sql
ALTER TABLE person ALTER COLUMN name SET NOT NULL;
```

Jangan menganggap `@Column(nullable=false)` cukup jika schema production dibuat manual/migration.

Mental model:

```text
DTO validation      = early feedback
Domain invariant   = business correctness
@Column metadata    = ORM/schema hint
DB NOT NULL         = final protection
```

### 5.3 `length`

Default length untuk `String` biasanya 255 jika tidak dispesifikasikan oleh provider/schema generation.

Buruk:

```java
@Column(nullable = false)
private String description;
```

Lebih baik:

```java
@Column(name = "short_description", nullable = false, length = 500)
private String shortDescription;
```

Untuk text panjang, jangan hanya menaikkan `length` tanpa memikirkan database type dan index.

```java
@Lob
@Column(name = "full_text")
private String fullText;
```

Tetapi LOB punya konsekuensi performance dan storage yang berbeda. Jangan reflex memakai `@Lob` hanya karena field mungkin panjang.

### 5.4 `precision` dan `scale`

Untuk `BigDecimal`, wajib eksplisit.

```java
@Column(name = "amount", nullable = false, precision = 19, scale = 2)
private BigDecimal amount;
```

Arti:

```text
precision = total digit maksimum
scale     = digit di belakang decimal point
```

`precision=19, scale=2` berarti nilai maksimum sekitar:

```text
99999999999999999.99
```

Untuk uang, jangan memakai `double` atau `float`.

Buruk:

```java
private double amount;
```

Benar:

```java
@Column(name = "amount", nullable = false, precision = 19, scale = 2)
private BigDecimal amount;
```

Tetapi `BigDecimal` saja tidak cukup. Kamu juga butuh currency.

```java
@Column(name = "currency_code", nullable = false, length = 3)
private String currencyCode;
```

Atau value object:

```java
@Embedded
private Money amount;
```

### 5.5 `unique`

```java
@Column(name = "email_address", unique = true)
private String emailAddress;
```

Untuk production, lebih baik definisikan unique constraint secara eksplisit di `@Table` atau migration:

```java
@Table(
    name = "app_user",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_app_user__email_address",
            columnNames = "email_address"
        )
    }
)
```

Alasannya:

- constraint punya nama stabil,
- error handling lebih mudah,
- migration lebih jelas,
- observability DBA lebih baik.

### 5.6 `insertable` dan `updatable`

```java
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;
```

`updatable=false` berarti provider tidak akan menyertakan column tersebut dalam SQL update.

```java
@Column(name = "created_by", nullable = false, updatable = false, length = 100)
private String createdBy;
```

Gunakan untuk:

- created timestamp,
- created by,
- immutable external reference,
- generated/read-only database column,
- column yang dimiliki oleh trigger/database.

Namun hati-hati: jika database trigger mengisi nilai setelah insert, entity di memory mungkin belum tahu nilainya kecuali refresh/generated value mechanism dipakai.

---

## 6. `@Basic`: Sering Tidak Dipakai, Tetapi Penting untuk Semantik

`@Basic` adalah mapping untuk persistent basic attribute.

```java
@Basic(optional = false)
@Column(name = "title", nullable = false, length = 200)
private String title;
```

`optional=false` mirip dengan `nullable=false`, tetapi berada di level basic attribute metadata.

Ada juga `fetch = FetchType.LAZY`:

```java
@Basic(fetch = FetchType.LAZY)
@Lob
@Column(name = "large_payload")
private String largePayload;
```

Namun lazy basic field tidak selalu bekerja seperti yang diharapkan tanpa provider support/bytecode enhancement. Untuk Hibernate, lazy basic attribute umumnya membutuhkan bytecode enhancement agar benar-benar efektif.

Rule praktis:

- Jangan mengandalkan lazy basic field sebagai desain utama.
- Untuk payload besar, pertimbangkan pisah table/entity atau projection.
- Jangan load LOB dalam listing screen.

---

## 7. Mapping String dengan Benar

String adalah tipe yang tampak paling mudah tetapi sering menjadi sumber data quality issue.

### 7.1 Pilih Makna String

Tidak semua `String` sama.

| Jenis String | Contoh | Mapping Consideration |
|---|---|---|
| Identifier manusia | application number | length stabil, unique/indexed |
| Email | email address | length, lower-case policy, unique normalized column |
| Name | person name | unicode, length, not always unique |
| Description | description | length besar, mungkin CLOB |
| Status | status | sebaiknya enum/code table, bukan free text |
| JSON | raw payload | JSON column/custom type/LOB tergantung DB |
| External code | agency code | length pendek, FK/lookup table mungkin perlu |

### 7.2 Jangan Pakai String untuk Semua Hal

Buruk:

```java
@Column(name = "status")
private String status;

@Column(name = "amount")
private String amount;

@Column(name = "submitted_at")
private String submittedAt;
```

Ini menghilangkan semantik.

Lebih baik:

```java
@Enumerated(EnumType.STRING)
@Column(name = "status", nullable = false, length = 30)
private CaseStatus status;

@Column(name = "amount", nullable = false, precision = 19, scale = 2)
private BigDecimal amount;

@Column(name = "submitted_at", nullable = false)
private Instant submittedAt;
```

### 7.3 Normalized vs Display Value

Jangan campur normalized value dan display value.

```java
@Column(name = "email_normalized", nullable = false, length = 320)
private String emailNormalized;

@Column(name = "email_display", nullable = false, length = 320)
private String emailDisplay;
```

Untuk query/unique check, pakai normalized. Untuk UI, tampilkan display.

---

## 8. Mapping Number dengan Benar

### 8.1 Integer Types

| Java Type | Umum untuk |
|---|---|
| `Integer` | small count, optional numeric value |
| `int` | non-null primitive value, hati-hati default `0` |
| `Long` | id, counter besar |
| `long` | non-null primitive id jarang ideal untuk entity id |
| `BigInteger` | angka sangat besar |
| `BigDecimal` | decimal exact, uang, rate, amount |

Untuk entity id, wrapper type lebih aman:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
private Long id;
```

Kenapa bukan primitive `long`?

Karena unsaved entity bisa direpresentasikan sebagai `null`. Jika pakai `long`, default-nya `0`, dan ini sering menciptakan ambiguity.

### 8.2 Decimal and Money

Buruk:

```java
@Column(name = "penalty_amount")
private Double penaltyAmount;
```

Benar:

```java
@Column(name = "penalty_amount", nullable = false, precision = 19, scale = 2)
private BigDecimal penaltyAmount;

@Column(name = "penalty_currency", nullable = false, length = 3)
private String penaltyCurrency;
```

Lebih baik untuk domain kuat:

```java
@Embeddable
public class Money {
    @Column(name = "amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    protected Money() {
    }

    public Money(BigDecimal amount, String currency) {
        if (amount == null) throw new IllegalArgumentException("amount is required");
        if (currency == null || currency.length() != 3) throw new IllegalArgumentException("currency must be ISO-4217 code");
        this.amount = amount;
        this.currency = currency;
    }
}
```

Lalu:

```java
@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "amount", column = @Column(name = "penalty_amount", precision = 19, scale = 2, nullable = false)),
    @AttributeOverride(name = "currency", column = @Column(name = "penalty_currency", length = 3, nullable = false))
})
private Money penalty;
```

---

## 9. Mapping Boolean dengan Benar

Boolean tampak sederhana:

```java
@Column(name = "active", nullable = false)
private boolean active;
```

Tetapi database berbeda dalam representasi boolean:

- PostgreSQL punya `boolean`.
- MySQL sering memakai `tinyint(1)`.
- Oracle versi lama sering memakai `NUMBER(1)` atau `CHAR(1)`.
- SQL Server punya `bit`.

Untuk portability, provider/dialect membantu. Namun untuk legacy schema, kadang butuh converter.

```java
@Converter(autoApply = false)
public class YesNoBooleanConverter implements AttributeConverter<Boolean, String> {
    @Override
    public String convertToDatabaseColumn(Boolean attribute) {
        if (attribute == null) return null;
        return attribute ? "Y" : "N";
    }

    @Override
    public Boolean convertToEntityAttribute(String dbData) {
        if (dbData == null) return null;
        return switch (dbData) {
            case "Y" -> Boolean.TRUE;
            case "N" -> Boolean.FALSE;
            default -> throw new IllegalArgumentException("Unknown boolean code: " + dbData);
        };
    }
}
```

Usage:

```java
@Convert(converter = YesNoBooleanConverter.class)
@Column(name = "is_active", nullable = false, length = 1)
private Boolean active;
```

Catatan:

- Pakai `Boolean` jika null punya arti atau database lama bisa null.
- Pakai `boolean` jika secara domain benar-benar wajib dan default `false` tidak ambigu.
- Jangan biarkan `null` dan `false` bercampur tanpa makna jelas.

---

## 10. Mapping Enum: Salah Satu Area Paling Berbahaya

Enum sering dipakai untuk status, type, category, channel, action, dan decision.

### 10.1 `EnumType.ORDINAL`: Hampir Selalu Buruk

Buruk:

```java
@Enumerated(EnumType.ORDINAL)
@Column(name = "status", nullable = false)
private CaseStatus status;
```

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Database menyimpan:

| Status | Ordinal |
|---|---:|
| DRAFT | 0 |
| SUBMITTED | 1 |
| APPROVED | 2 |
| REJECTED | 3 |

Jika nanti enum berubah:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Maka ordinal lama berubah makna. Ini data corruption.

Rule:

> Jangan pakai `EnumType.ORDINAL` untuk persistent business data.

### 10.2 `EnumType.STRING`: Lebih Aman, Tapi Bukan Sempurna

```java
@Enumerated(EnumType.STRING)
@Column(name = "status", nullable = false, length = 30)
private CaseStatus status;
```

Database menyimpan:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
```

Lebih readable dan tidak rusak karena urutan enum berubah.

Tetapi tetap punya risiko:

- Rename enum constant mematahkan data lama.
- Delete enum constant membuat data lama gagal dibaca.
- Rolling deployment bisa gagal jika versi lama membaca enum baru.
- Nama enum Java menjadi kontrak database.

### 10.3 Stable Code via `AttributeConverter`

Untuk enum dengan database code stabil:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUB"),
    UNDER_REVIEW("UR"),
    APPROVED("APR"),
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
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

Converter:

```java
@Converter(autoApply = false)
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

Usage:

```java
@Convert(converter = CaseStatusConverter.class)
@Column(name = "status_code", nullable = false, length = 10)
private CaseStatus status;
```

Kelebihan:

- database code stabil,
- enum Java bisa rename tanpa migration data,
- integrasi eksternal bisa pakai code resmi,
- reporting lebih jelas.

Kekurangan:

- butuh converter per enum,
- query literal harus hati-hati,
- perlu handling unknown legacy code.

### 10.4 Jakarta Persistence 3.2 `@EnumeratedValue`

Jakarta Persistence 3.2 menambahkan fitur `@EnumeratedValue` untuk custom enum value mapping. Ini membantu kasus enum yang ingin disimpan memakai field tertentu, bukan ordinal/nama enum.

Contoh konseptual:

```java
public enum DecisionType {
    APPROVE("A"),
    REJECT("R"),
    REQUEST_INFO("I");

    @EnumeratedValue
    private final String code;

    DecisionType(String code) {
        this.code = code;
    }
}
```

Catatan penting:

- Ini fitur Jakarta Persistence modern.
- Untuk Java 8/JPA 2.x/Hibernate lama, gunakan `AttributeConverter`.
- Untuk library/framework yang belum fully support, cek provider version.

### 10.5 Kapan Enum Tidak Cukup?

Enum cocok jika value set relatif stabil dan dikelola di code.

Namun gunakan lookup/reference table jika:

- value bisa ditambah oleh admin/user,
- butuh label multi-bahasa,
- butuh effective date,
- butuh sort order konfigurabel,
- butuh metadata tambahan,
- value dimiliki regulasi dan berubah periodik tanpa deploy,
- perlu soft deactivation.

Contoh lookup table:

```text
case_status_type
- status_code
- display_name
- active
- sort_order
- effective_from
- effective_to
```

---

## 11. Date and Time Mapping: Jangan Menganggap Waktu Itu Sederhana

Date/time adalah salah satu sumber bug paling mahal.

### 11.1 Legacy Java Date Types

Era Java 8 ke bawah/JPA lama sering memakai:

```java
@Temporal(TemporalType.TIMESTAMP)
@Column(name = "submitted_at", nullable = false)
private Date submittedAt;
```

`@Temporal` digunakan untuk tipe lama seperti:

- `java.util.Date`,
- `java.util.Calendar`.

Pilihan:

```java
@Temporal(TemporalType.DATE)
private Date birthDate;

@Temporal(TemporalType.TIME)
private Date startTime;

@Temporal(TemporalType.TIMESTAMP)
private Date submittedAt;
```

Namun untuk Java 8+, lebih baik gunakan Java Time API.

### 11.2 Java Time API

Umumnya:

| Java Type | Cocok Untuk |
|---|---|
| `LocalDate` | tanggal tanpa waktu, misalnya birth date, effective date |
| `LocalTime` | waktu tanpa tanggal, misalnya office hour |
| `LocalDateTime` | tanggal+waktu tanpa timezone, hati-hati |
| `Instant` | event timestamp global/absolute |
| `OffsetDateTime` | timestamp dengan offset |
| `ZonedDateTime` | timestamp dengan zone rules, support provider/db bervariasi |

### 11.3 `Instant` untuk Event Timestamp

Untuk kejadian sistem:

```java
@Column(name = "submitted_at", nullable = false, updatable = false)
private Instant submittedAt;
```

`Instant` merepresentasikan titik waktu global.

Cocok untuk:

- created_at,
- updated_at,
- submitted_at,
- approved_at,
- audit timestamp,
- event occurrence time.

### 11.4 `LocalDate` untuk Business Date

```java
@Column(name = "effective_date", nullable = false)
private LocalDate effectiveDate;
```

Cocok untuk:

- effective date,
- expiry date,
- date of birth,
- license valid from/to,
- reporting period.

Jangan pakai `Instant` untuk tanggal lahir. Tanggal lahir bukan moment global; itu calendar date.

### 11.5 `LocalDateTime` adalah Jebakan jika Salah Dipakai

```java
@Column(name = "submitted_at", nullable = false)
private LocalDateTime submittedAt;
```

Masalah:

- `LocalDateTime` tidak punya timezone/offset.
- “2026-06-16 10:00” di Jakarta dan UTC adalah moment berbeda.
- Untuk event global, ini ambiguous.

`LocalDateTime` cocok jika domain memang local wall-clock time, misalnya:

- appointment local office time,
- schedule display local to jurisdiction,
- cut-off time dalam zona tetap yang disimpan terpisah.

Untuk audit/event, prefer `Instant`.

### 11.6 Timezone Strategy

Strategi umum untuk enterprise system:

```text
Store event timestamps in UTC/Instant.
Store business dates as LocalDate.
Store display timezone separately when semantically required.
Convert at boundary/UI/reporting.
```

Contoh:

```java
@Column(name = "submitted_at", nullable = false, updatable = false)
private Instant submittedAt;

@Column(name = "submitted_zone", nullable = false, length = 50)
private String submittedZone;
```

Jika perlu merekonstruksi local time user saat kejadian:

```text
submitted_at   = 2026-06-16T03:00:00Z
submitted_zone = Asia/Jakarta
```

---

## 12. `@Enumerated`, `@Temporal`, `@Lob`: Annotation Lama yang Tetap Harus Dipahami

### 12.1 `@Enumerated`

Digunakan untuk enum mapping standard:

```java
@Enumerated(EnumType.STRING)
@Column(name = "decision", nullable = false, length = 30)
private Decision decision;
```

Rule:

- Prefer `STRING` dibanding `ORDINAL`.
- Untuk code stabil, gunakan converter atau fitur modern seperti `@EnumeratedValue` jika tersedia.

### 12.2 `@Temporal`

Digunakan untuk `Date`/`Calendar` legacy.

```java
@Temporal(TemporalType.TIMESTAMP)
@Column(name = "created_at")
private Date createdAt;
```

Untuk `java.time.*`, biasanya tidak pakai `@Temporal`.

### 12.3 `@Lob`

Digunakan untuk large object:

```java
@Lob
@Column(name = "payload_json")
private String payloadJson;
```

atau:

```java
@Lob
@Column(name = "document_content")
private byte[] documentContent;
```

Mapping umum:

| Java Type | Biasanya |
|---|---|
| `String` + `@Lob` | CLOB/TEXT |
| `char[]` + `@Lob` | CLOB-like |
| `byte[]` + `@Lob` | BLOB/BYTEA/VARBINARY |
| `Blob` | JDBC Blob |
| `Clob` | JDBC Clob |

### 12.4 LOB Performance Warning

LOB bukan string besar biasa. Pikirkan:

- storage segment berbeda di beberapa DB,
- fetch cost tinggi,
- indexing terbatas,
- backup/restore impact,
- replication impact,
- memory pressure saat entity di-load,
- lazy loading tidak selalu efektif,
- update LOB bisa mahal.

Untuk listing screen, jangan load LOB.

Buruk:

```java
List<AuditTrail> findByModuleId(Long moduleId);
```

Jika `AuditTrail` punya CLOB besar, query listing bisa hydrate payload besar.

Lebih baik projection:

```java
public record AuditTrailRow(
    Long id,
    String module,
    String action,
    Instant createdAt,
    String createdBy
) {}
```

Query hanya field yang perlu.

---

## 13. `@Embeddable` dan `@Embedded`: Value Object Mapping

Value object adalah object yang identitasnya berasal dari value, bukan id database sendiri.

Contoh buruk:

```java
@Column(name = "postal_code")
private String postalCode;

@Column(name = "block")
private String block;

@Column(name = "street")
private String street;

@Column(name = "unit_no")
private String unitNo;
```

Lebih bermakna:

```java
@Embeddable
public class Address {
    @Column(name = "postal_code", length = 20)
    private String postalCode;

    @Column(name = "block", length = 20)
    private String block;

    @Column(name = "street", length = 200)
    private String street;

    @Column(name = "unit_no", length = 50)
    private String unitNo;

    protected Address() {
    }

    public Address(String postalCode, String block, String street, String unitNo) {
        this.postalCode = postalCode;
        this.block = block;
        this.street = street;
        this.unitNo = unitNo;
    }
}
```

Entity:

```java
@Embedded
private Address registeredAddress;
```

Jika entity punya dua address:

```java
@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "postalCode", column = @Column(name = "registered_postal_code", length = 20)),
    @AttributeOverride(name = "block", column = @Column(name = "registered_block", length = 20)),
    @AttributeOverride(name = "street", column = @Column(name = "registered_street", length = 200)),
    @AttributeOverride(name = "unitNo", column = @Column(name = "registered_unit_no", length = 50))
})
private Address registeredAddress;

@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "postalCode", column = @Column(name = "mailing_postal_code", length = 20)),
    @AttributeOverride(name = "block", column = @Column(name = "mailing_block", length = 20)),
    @AttributeOverride(name = "street", column = @Column(name = "mailing_street", length = 200)),
    @AttributeOverride(name = "unitNo", column = @Column(name = "mailing_unit_no", length = 50))
})
private Address mailingAddress;
```

### 13.1 Kapan Pakai `@Embeddable`?

Gunakan jika:

- value tidak punya lifecycle sendiri,
- value tidak direferensikan banyak entity sebagai identity sendiri,
- value sebaiknya dimanipulasi sebagai satu konsep,
- invariant internal bisa dijaga di constructor/method.

Contoh cocok:

- Money,
- Address snapshot,
- DateRange,
- PersonName,
- ContactNumber,
- EmailAddress,
- AuditStamp.

### 13.2 Kapan Jangan Pakai `@Embeddable`?

Jangan jika:

- value butuh table sendiri,
- value punya identity/lifecycle,
- value sering di-query sebagai aggregate sendiri,
- value dipakai sebagai reference data,
- value punya relationship kompleks.

Contoh: `Agency`, `User`, `Country`, `CaseStatusType` biasanya entity/reference table, bukan embeddable.

---

## 14. `AttributeConverter`: Power Tool yang Harus Dipakai dengan Disiplin

`AttributeConverter<X,Y>` mengubah nilai entity attribute `X` menjadi database column representation `Y` dan sebaliknya.

```java
public interface AttributeConverter<X, Y> {
    Y convertToDatabaseColumn(X attribute);
    X convertToEntityAttribute(Y dbData);
}
```

Contoh value object email:

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email is required");
        }
        this.value = value.trim().toLowerCase(Locale.ROOT);
    }

    public String value() {
        return value;
    }
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
        return dbData == null ? null : new EmailAddress(dbData);
    }
}
```

Entity:

```java
@Column(name = "email_address", nullable = false, length = 320)
private EmailAddress emailAddress;
```

### 14.1 `autoApply=true`

```java
@Converter(autoApply = true)
public class EmailAddressConverter implements AttributeConverter<EmailAddress, String> {
    // ...
}
```

Artinya converter otomatis diterapkan untuk semua attribute bertipe `EmailAddress`.

Gunakan jika mapping global dan konsisten.

Jangan gunakan `autoApply=true` jika tipe yang sama bisa punya representasi database berbeda di tempat berbeda.

### 14.2 Kapan Converter Cocok?

Converter cocok untuk:

- value object sederhana ke scalar column,
- legacy boolean code `Y/N`,
- enum code stabil,
- masked/normalized string,
- small immutable type,
- domain-specific id wrapper jika provider mendukung dan tidak untuk `@Id` secara portable.

### 14.3 Kapan Converter Tidak Cocok?

Jangan pakai converter untuk:

- relationship,
- multi-column value,
- query-heavy transformation yang butuh index khusus,
- data yang seharusnya lookup table,
- encryption kompleks tanpa threat model,
- JSON besar tanpa mempertimbangkan database JSON support,
- field yang perlu portable mapping tetapi converter melanggar spec constraint.

### 14.4 Converter dan Query

Jika attribute dikonversi, query parameter biasanya memakai domain type:

```java
select u from UserAccount u where u.emailAddress = :email
```

```java
query.setParameter("email", new EmailAddress("user@example.com"));
```

Provider akan convert parameter ke database representation.

Namun native query tidak otomatis selalu melakukan conversion seperti JPQL. Hati-hati.

---

## 15. Default Value: Java Default, Database Default, Business Default

Default adalah area yang sering rancu.

### 15.1 Java Field Default

```java
@Column(name = "active", nullable = false)
private boolean active = true;
```

Ini berlaku saat object Java dibuat.

### 15.2 Constructor Default

```java
protected UserAccount() {
}

public UserAccount(EmailAddress emailAddress) {
    this.emailAddress = emailAddress;
    this.active = true;
    this.createdAt = Instant.now();
}
```

Lebih jelas karena default menjadi bagian dari creation semantics.

### 15.3 Database Default

```sql
ALTER TABLE user_account
ADD active NUMBER(1) DEFAULT 1 NOT NULL;
```

Database default berlaku jika insert tidak menyertakan column tersebut.

Tetapi JPA/Hibernate biasanya menyertakan column dalam insert jika field punya nilai, bahkan `null` dalam beberapa kondisi. Jadi jangan berasumsi database default selalu aktif.

### 15.4 Business Default

Default yang punya makna bisnis harus ada di domain/application logic, bukan hanya database.

Contoh:

```java
public static CaseRecord draft(String applicationNo, String createdBy, Clock clock) {
    CaseRecord record = new CaseRecord();
    record.applicationNo = applicationNo;
    record.status = CaseStatus.DRAFT;
    record.createdBy = createdBy;
    record.createdAt = Instant.now(clock);
    return record;
}
```

Ini lebih defensible daripada mengandalkan database default status `'DRAFT'` tanpa terlihat di code.

---

## 16. Generated Columns, Read-Only Columns, and Database-Owned Values

Kadang column dimiliki oleh database:

- generated column,
- trigger-maintained column,
- database timestamp,
- computed search column,
- denormalized summary,
- audit metadata dari trigger.

Mapping read-only:

```java
@Column(name = "search_text", insertable = false, updatable = false)
private String searchText;
```

Atau:

```java
@Column(name = "created_at", insertable = false, updatable = false)
private Instant createdAt;
```

Namun setelah insert, object Java belum tentu langsung punya nilai terbaru.

Pilihan:

1. Refresh entity setelah persist.
2. Gunakan provider-specific generated annotation jika tersedia.
3. Pindahkan ownership ke application jika lebih sederhana.
4. Jangan expose generated value sebelum reload.

Contoh:

```java
entityManager.persist(record);
entityManager.flush();
entityManager.refresh(record);
```

Tapi `refresh()` punya cost query tambahan.

---

## 17. Column Definition: Escape Hatch yang Harus Dibatasi

```java
@Column(name = "payload", columnDefinition = "jsonb")
private String payload;
```

`columnDefinition` memberi DDL literal ke provider schema generation.

Kelebihan:

- bisa memakai database-specific type,
- membantu schema generation dev.

Kekurangan:

- tidak portable,
- coupling ke dialect,
- bisa bentrok dengan migration tool,
- sering tidak cukup untuk index/operator DB-specific.

Rule:

> Untuk production schema, lebih baik migration tool menjadi source of truth. Gunakan `columnDefinition` hanya jika kamu sadar itu provider/database-specific metadata.

---

## 18. JSON Mapping: String, LOB, Converter, atau Native JSON Type?

JSON semakin umum untuk:

- external payload snapshot,
- audit metadata,
- integration payload,
- flexible attributes,
- form answers,
- rule evaluation context.

Pilihan mapping:

### 18.1 JSON sebagai `String`

```java
@Lob
@Column(name = "metadata_json")
private String metadataJson;
```

Cocok jika:

- hanya disimpan/dibaca sebagai blob text,
- tidak sering di-query berdasarkan field dalam JSON,
- format dikontrol aplikasi.

Risiko:

- tidak ada validation JSON di DB,
- query field JSON sulit/lambat,
- schema evolution manual.

### 18.2 JSON sebagai Database Native JSON Type

Hibernate modern mendukung mapping JSON provider-specific, misalnya dengan `@JdbcTypeCode(SqlTypes.JSON)`.

Contoh Hibernate-specific:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(name = "metadata_json")
private Map<String, Object> metadata;
```

Kelebihan:

- database JSON type bisa dipakai,
- query/operator/index JSON tersedia tergantung DB,
- lebih natural untuk structured payload.

Kekurangan:

- provider-specific,
- portability lebih rendah,
- migration/index harus DB-specific,
- type safety sering lemah jika pakai `Map<String,Object>`.

### 18.3 JSON sebagai Value Object

```java
public final class CaseMetadata {
    private final String source;
    private final String channel;
    private final Map<String, String> attributes;
}
```

Dengan converter/object mapper.

Namun hati-hati:

- converter dipanggil saat load/save,
- serialization error bisa membuat entity gagal dibaca,
- schema evolution JSON harus dipikirkan,
- unknown field harus handled.

---

## 19. Encrypted / Masked Fields

Beberapa field sensitif perlu proteksi:

- identifier pribadi,
- token,
- credential reference,
- contact detail,
- sensitive payload.

Mapping naive:

```java
@Column(name = "identifier_no")
private String identifierNo;
```

Mungkin tidak cukup.

Pilihan:

1. Encrypt di application via converter.
2. Encrypt di database via TDE/column encryption.
3. Tokenize di external vault/tokenization service.
4. Store hash untuk lookup, ciphertext untuk display/recovery.

Contoh konseptual:

```java
@Column(name = "identifier_ciphertext", nullable = false, length = 1000)
private String identifierCiphertext;

@Column(name = "identifier_hash", nullable = false, length = 64)
private String identifierHash;
```

Jangan asal pakai converter encryption tanpa memikirkan:

- key rotation,
- deterministic vs randomized encryption,
- query kebutuhan,
- indexing,
- audit/log masking,
- migration data lama,
- error handling jika decrypt gagal,
- separation of duties.

Untuk field yang perlu lookup exact match, pattern umum:

```text
ciphertext column = untuk recover/display authorized
hash column       = untuk lookup exact match
```

---

## 20. Immutability and Mapping

Entity JPA tradisional butuh no-arg constructor dan mutable fields. Tetapi kita tetap bisa membuat desain lebih aman.

### 20.1 Protected No-Arg Constructor

```java
protected CaseRecord() {
}
```

Jangan expose public no-arg constructor jika creation harus lewat factory.

### 20.2 Controlled Mutation

Buruk:

```java
public void setStatus(CaseStatus status) {
    this.status = status;
}
```

Lebih baik:

```java
public void submit(String submittedBy, Clock clock) {
    if (this.status != CaseStatus.DRAFT) {
        throw new IllegalStateException("Only draft case can be submitted");
    }
    this.status = CaseStatus.SUBMITTED;
    this.submittedBy = submittedBy;
    this.submittedAt = Instant.now(clock);
}
```

Mapping tetap sama, tetapi invariant lebih kuat.

### 20.3 Immutable Value Object

Untuk embeddable/value object, usahakan immutable secara desain. Namun JPA provider mungkin butuh constructor no-arg. Bisa kompromi:

```java
@Embeddable
public class DateRange {
    @Column(name = "valid_from", nullable = false)
    private LocalDate from;

    @Column(name = "valid_to", nullable = false)
    private LocalDate to;

    protected DateRange() {
    }

    public DateRange(LocalDate from, LocalDate to) {
        if (from == null || to == null) throw new IllegalArgumentException("date range is required");
        if (to.isBefore(from)) throw new IllegalArgumentException("to must be after from");
        this.from = from;
        this.to = to;
    }
}
```

---

## 21. Access Type: Field Access vs Property Access

JPA menentukan access type berdasarkan lokasi annotation `@Id`.

### 21.1 Field Access

```java
@Entity
public class CaseRecord {
    @Id
    private Long id;

    @Column(name = "case_no")
    private String caseNo;

    public String getCaseNo() {
        return caseNo;
    }
}
```

Provider membaca field langsung.

Kelebihan:

- getter bisa berisi logic ringan tanpa mempengaruhi persistence,
- lebih umum dipakai,
- menghindari side effect setter.

### 21.2 Property Access

```java
@Entity
public class CaseRecord {
    private Long id;
    private String caseNo;

    @Id
    public Long getId() {
        return id;
    }

    @Column(name = "case_no")
    public String getCaseNo() {
        return caseNo;
    }
}
```

Provider memakai getter/setter.

Risiko:

- getter/setter side effect bisa mengganggu persistence,
- lazy loading/proxy behavior lebih tricky,
- refactor annotation bisa mengubah access type tanpa sengaja.

Rule:

> Pilih satu access type secara konsisten per entity hierarchy. Untuk kebanyakan aplikasi modern, field access lebih predictable.

---

## 22. Nullability: Domain Meaning Harus Eksplisit

Null bukan sekadar “belum ada value”. Null bisa punya banyak arti:

| Null Meaning | Contoh |
|---|---|
| unknown | tanggal lahir belum diketahui |
| not applicable | company tidak punya individual birth date |
| not yet assigned | reviewer belum ditentukan |
| optional | remarks boleh kosong |
| migration gap | data lama belum terisi |
| error | seharusnya tidak null tapi lolos |

Mapping harus mencerminkan makna.

Buruk:

```java
@Column(name = "reviewer_id")
private Long reviewerId;
```

Tidak jelas apakah nullable.

Lebih jelas:

```java
@Column(name = "reviewer_id", nullable = true)
private Long reviewerId;
```

Tetapi lebih baik jika domain method menjelaskan:

```java
public boolean hasAssignedReviewer() {
    return reviewerId != null;
}
```

Untuk field wajib:

```java
@Column(name = "application_no", nullable = false, length = 50, updatable = false)
private String applicationNo;
```

Dan migration:

```sql
ALTER TABLE case_record
ADD CONSTRAINT nn_case_record__application_no CHECK (application_no IS NOT NULL);
```

atau database-specific `NOT NULL`.

---

## 23. Mapping and Schema Generation: Jangan Salah Source of Truth

JPA bisa generate schema, tetapi production enterprise umumnya harus memakai migration tool.

### 23.1 Development Convenience

Di local/dev:

```properties
jakarta.persistence.schema-generation.database.action=drop-and-create
```

atau Spring/Hibernate:

```properties
spring.jpa.hibernate.ddl-auto=update
```

Ini convenience, bukan production discipline.

### 23.2 Production Discipline

Production sebaiknya:

```text
Entity mapping  = application interpretation
Migration files = database source of truth
Database schema = actual contract
```

Jadi perubahan field harus diikuti migration.

Contoh perubahan:

```java
@Column(name = "decision_reason", length = 1000)
private String decisionReason;
```

Harus ada migration:

```sql
ALTER TABLE case_decision
ADD decision_reason VARCHAR2(1000);
```

atau sesuai database.

### 23.3 Mapping Drift

Mapping drift terjadi ketika entity dan schema tidak sinkron.

Contoh:

```java
@Column(name = "remarks", length = 2000)
private String remarks;
```

Database ternyata:

```sql
remarks VARCHAR(255)
```

Akibat:

- insert/update gagal saat data panjang,
- bug hanya muncul dengan input tertentu,
- dev environment lolos jika schema generated berbeda.

Solusi:

- migration test,
- schema validation mode,
- integration test dengan DB real,
- production schema introspection/check.

---

## 24. Mapping untuk Audit Fields

Hampir semua enterprise entity butuh audit metadata.

```java
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;

@Column(name = "created_by", nullable = false, updatable = false, length = 100)
private String createdBy;

@Column(name = "updated_at", nullable = false)
private Instant updatedAt;

@Column(name = "updated_by", nullable = false, length = 100)
private String updatedBy;
```

### 24.1 Base Mapped Superclass

```java
@MappedSuperclass
public abstract class AuditableEntity {
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false, length = 100)
    private String createdBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 100)
    private String updatedBy;

    protected void markCreated(String userId, Clock clock) {
        Instant now = Instant.now(clock);
        this.createdAt = now;
        this.createdBy = userId;
        this.updatedAt = now;
        this.updatedBy = userId;
    }

    protected void markUpdated(String userId, Clock clock) {
        this.updatedAt = Instant.now(clock);
        this.updatedBy = userId;
    }
}
```

### 24.2 Listener Alternative

```java
@PrePersist
void prePersist() {
    Instant now = Instant.now();
    this.createdAt = now;
    this.updatedAt = now;
}

@PreUpdate
void preUpdate() {
    this.updatedAt = Instant.now();
}
```

Risiko listener:

- sulit inject `Clock`/current user tanpa framework support,
- hidden behavior,
- testing bisa lebih sulit,
- tidak selalu cocok untuk domain explicitness.

Untuk sistem regulatory, explicit audit mutation sering lebih defensible.

---

## 25. Mapping External Identifiers and Public IDs

Jangan expose internal database id ke semua boundary jika tidak perlu.

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
private Long id;

@Column(name = "public_id", nullable = false, unique = true, updatable = false, length = 36)
private String publicId;

@Column(name = "application_no", nullable = false, unique = true, updatable = false, length = 50)
private String applicationNo;
```

Perbedaan:

| Field | Makna |
|---|---|
| `id` | internal database identity |
| `publicId` | safe external technical id |
| `applicationNo` | business reference |

Mapping harus membantu boundary:

- API pakai `publicId` atau business reference.
- Join internal pakai `id`.
- User-facing screen pakai `applicationNo`.
- Audit menyimpan reference yang meaningful.

---

## 26. Case Study: Mapping `CaseRecord` dengan Benar

### 26.1 Naive Mapping

```java
@Entity
public class CaseRecord {
    @Id
    private Long id;

    private String caseNo;
    private String status;
    private String applicantName;
    private String submittedAt;
    private Double penaltyAmount;
    private String remarks;
}
```

Masalah:

- tidak ada table/column contract eksplisit,
- status free text,
- submittedAt string,
- amount pakai double,
- remarks length tidak jelas,
- nullability tidak jelas,
- audit tidak ada,
- id generation tidak jelas,
- business uniqueness tidak dilindungi,
- schema evolution berisiko.

### 26.2 Better Mapping

```java
@Entity
@Table(
    name = "case_record",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_case_record__case_no", columnNames = "case_no"),
        @UniqueConstraint(name = "uk_case_record__public_id", columnNames = "public_id")
    },
    indexes = {
        @Index(name = "idx_case_record__status", columnList = "status_code"),
        @Index(name = "idx_case_record__submitted_at", columnList = "submitted_at")
    }
)
public class CaseRecord {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
    @SequenceGenerator(name = "case_record_seq", sequenceName = "case_record_seq", allocationSize = 50)
    @Column(name = "case_record_id", nullable = false, updatable = false)
    private Long id;

    @Column(name = "public_id", nullable = false, updatable = false, length = 36)
    private String publicId;

    @Column(name = "case_no", nullable = false, updatable = false, length = 50)
    private String caseNo;

    @Convert(converter = CaseStatusConverter.class)
    @Column(name = "status_code", nullable = false, length = 10)
    private CaseStatus status;

    @Column(name = "applicant_name", nullable = false, length = 200)
    private String applicantName;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "amount", column = @Column(name = "penalty_amount", precision = 19, scale = 2)),
        @AttributeOverride(name = "currency", column = @Column(name = "penalty_currency", length = 3))
    })
    private Money penalty;

    @Column(name = "remarks", length = 2000)
    private String remarks;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false, length = 100)
    private String createdBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 100)
    private String updatedBy;

    protected CaseRecord() {
    }

    public static CaseRecord draft(String caseNo, String applicantName, String createdBy, Clock clock) {
        CaseRecord record = new CaseRecord();
        record.publicId = UUID.randomUUID().toString();
        record.caseNo = requireText(caseNo, "caseNo");
        record.applicantName = requireText(applicantName, "applicantName");
        record.status = CaseStatus.DRAFT;
        Instant now = Instant.now(clock);
        record.createdAt = now;
        record.createdBy = requireText(createdBy, "createdBy");
        record.updatedAt = now;
        record.updatedBy = createdBy;
        return record;
    }

    public void submit(String submittedBy, Clock clock) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only DRAFT case can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
        this.submittedAt = Instant.now(clock);
        this.updatedAt = this.submittedAt;
        this.updatedBy = requireText(submittedBy, "submittedBy");
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value.trim();
    }
}
```

Mapping ini lebih kuat karena:

- database contract eksplisit,
- status stabil,
- timestamp pakai `Instant`,
- money pakai `BigDecimal` via value object,
- audit jelas,
- creation semantics jelas,
- mutation dikendalikan method domain,
- unique/index diberi nama,
- schema migration bisa mengikuti mapping dengan jelas.

---

## 27. Mapping Design Reasoning: Checklist per Field

Untuk setiap field persistent, tanyakan:

### 27.1 Semantic

- Apa arti field ini secara domain?
- Apakah field ini business data, technical data, audit data, cache/denormalized data, atau integration data?
- Apakah field ini boleh berubah?
- Siapa owner field ini: application, database, external system, user, batch job?

### 27.2 Type

- Java type apa yang paling tepat?
- Database type apa yang paling tepat?
- Apakah butuh exact decimal?
- Apakah butuh timezone?
- Apakah butuh enum/code table?
- Apakah string ini sebenarnya value object?

### 27.3 Constraint

- Boleh null?
- Perlu unique?
- Perlu check constraint?
- Perlu foreign key/reference?
- Perlu length/precision/scale?
- Constraint ada di annotation saja atau database juga?

### 27.4 Evolution

- Bagaimana jika value baru ditambahkan?
- Bagaimana jika field rename di Java?
- Bagaimana jika column rename di DB?
- Bagaimana migration data lama?
- Bagaimana rolling deployment?
- Bagaimana backward compatibility API/event/reporting?

### 27.5 Query and Performance

- Field ini sering difilter?
- Sering disort?
- Perlu index?
- Perlu full-text search?
- Akan diload di listing?
- Apakah terlalu besar untuk entity utama?
- Apakah harus dipisah ke read model/projection?

### 27.6 Security and Audit

- Apakah field sensitif?
- Perlu masking?
- Perlu encryption/tokenization?
- Perlu audit before/after?
- Boleh muncul di log?
- Boleh muncul di exception message?

---

## 28. Common Failure Modes

### 28.1 Enum Ordinal Corruption

Gejala:

- status lama berubah makna setelah deploy,
- report tidak konsisten,
- workflow masuk state salah.

Root cause:

```java
@Enumerated(EnumType.ORDINAL)
```

dan enum order berubah.

Mitigation:

- gunakan `EnumType.STRING`, converter stable code, atau lookup table,
- migration untuk enum lama,
- test data compatibility.

### 28.2 Timezone Shift

Gejala:

- timestamp bergeser beberapa jam,
- report harian salah,
- SLA calculation salah,
- audit terlihat terjadi sebelum/sesudah waktu sebenarnya.

Root cause:

- `LocalDateTime` untuk event global,
- JVM timezone berbeda antar environment,
- DB/session timezone berbeda,
- conversion layer tidak konsisten.

Mitigation:

- event timestamp pakai `Instant`,
- simpan UTC,
- convert di boundary,
- test dengan timezone berbeda.

### 28.3 Data Truncation

Gejala:

- insert/update gagal hanya untuk input panjang,
- production error intermittent.

Root cause:

- `@Column(length=...)` tidak sinkron dengan schema,
- DTO validation tidak mengikuti DB,
- migration lupa update column length.

Mitigation:

- schema validation,
- migration test,
- centralize max length constants jika perlu,
- DB constraint sebagai final protection.

### 28.4 BigDecimal Scale Issue

Gejala:

- amount dibulatkan tidak sesuai,
- comparison gagal karena scale beda,
- audit amount tidak match.

Root cause:

- precision/scale tidak eksplisit,
- rounding policy tersebar,
- `double` dipakai sebelum `BigDecimal`.

Mitigation:

- `BigDecimal` dari awal,
- precision/scale eksplisit,
- rounding policy domain-level,
- value object Money.

### 28.5 LOB Accidentally Loaded

Gejala:

- listing lambat,
- memory naik,
- GC pressure,
- response 504,
- DB I/O spike.

Root cause:

- entity punya CLOB/BLOB besar,
- query listing return full entity,
- lazy LOB tidak efektif.

Mitigation:

- projection untuk listing,
- pisah table/entity untuk payload besar,
- load detail hanya saat dibutuhkan,
- monitor row size dan query columns.

### 28.6 Converter Breaks Old Data

Gejala:

- entity gagal load setelah deploy,
- unknown code exception,
- batch job berhenti pada satu row lama.

Root cause:

- converter tidak backward-compatible,
- legacy value tidak dikenali,
- enum value dihapus.

Mitigation:

- converter handle unknown explicitly,
- data migration sebelum deploy,
- compatibility test dengan snapshot data lama,
- jangan hapus enum/code tanpa migration.

---

## 29. Performance Implications of Basic Mapping

Mapping field mempengaruhi performance lebih dari yang terlihat.

### 29.1 Row Width

Semakin banyak/besar column entity utama, semakin mahal:

- table scan,
- index lookup + table access,
- buffer cache usage,
- network transfer,
- hydration entity,
- first-level cache memory.

Field besar seperti `remarks`, `payload`, `serialized_changes`, `full_text` harus dipikirkan.

### 29.2 Indexable Type

`VARCHAR(4000)` untuk code pendek membuat index lebih berat dari perlu.

```java
@Column(name = "status_code", length = 10)
private CaseStatus status;
```

Lebih baik dari:

```java
@Column(name = "status_code", length = 255)
private String status;
```

### 29.3 Function-Based Query

Jika data tidak dinormalisasi, query sering memakai function:

```sql
where lower(email_address) = lower(?);
```

Ini bisa mengganggu index biasa. Lebih baik simpan normalized column:

```java
@Column(name = "email_normalized", nullable = false, length = 320)
private String emailNormalized;
```

### 29.4 Converter Cost

Converter dipanggil saat load/save. Untuk converter ringan tidak masalah. Untuk converter berat seperti JSON serialization/encryption, cost bisa signifikan.

Jangan taruh logic mahal tanpa sadar di converter entity yang sering diload.

---

## 30. Production Consideration

### 30.1 Schema Validation Mode

Di production, gunakan mode yang tidak mengubah schema otomatis. Validasi schema bisa membantu mendeteksi drift.

Contoh Hibernate/Spring property umum:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Atau disable perubahan schema otomatis dan serahkan ke Flyway/Liquibase.

### 30.2 Migration Review

Setiap perubahan mapping harus punya review migration:

| Mapping Change | Migration Concern |
|---|---|
| tambah non-null column | butuh default/backfill/expand-contract |
| ubah length | data lama mungkin melebihi batas baru |
| ubah enum mapping | data compatibility |
| ubah decimal scale | rounding/data loss |
| ubah timestamp type | timezone/data conversion |
| tambah unique constraint | duplicate existing data |
| tambah index | lock/build time/storage |
| ubah LOB | storage/backup/performance |

### 30.3 Observability

Mapping issue sering muncul sebagai:

- SQL exception,
- constraint violation,
- data truncation,
- invalid enum value,
- deserialization error,
- timezone discrepancy,
- slow query.

Log minimal yang berguna:

```text
correlation_id
use_case
entity_name
table_name
operation insert/update/select
constraint_name if available
sql_state/vendor_code if available
```

Jangan log sensitive field raw.

---

## 31. Anti-Patterns

### 31.1 Entity sebagai Dump Semua Column

```java
@Entity
public class CaseRecord {
    // 200 fields from one giant table
}
```

Masalah:

- persistence context berat,
- dirty checking mahal,
- query over-fetch,
- boundary tidak jelas,
- sulit migration.

### 31.2 Semua Status sebagai String

```java
private String status;
```

Masalah:

- typo,
- invalid value,
- transition tidak aman,
- report sulit konsisten.

### 31.3 Enum Ordinal

```java
@Enumerated(EnumType.ORDINAL)
```

Masalah: data corruption saat enum berubah.

### 31.4 `LocalDateTime` untuk Audit Timestamp

```java
private LocalDateTime createdAt;
```

Masalah: ambiguous timezone.

### 31.5 Money sebagai Double

```java
private double amount;
```

Masalah: floating point precision.

### 31.6 LOB di Entity Listing

```java
List<AuditTrail> findAllByModuleId(Long moduleId);
```

Jika `AuditTrail` punya CLOB besar, listing menjadi mahal.

### 31.7 `columnDefinition` Everywhere

```java
@Column(columnDefinition = "...")
```

Masalah:

- provider coupling,
- migration tidak jelas,
- portability hilang,
- schema generation misleading.

### 31.8 Relying on ORM Annotation for All Constraints

Annotation bukan pengganti database constraint.

---

## 32. Practical Mapping Checklist

Sebelum merge entity mapping baru, cek:

```text
[ ] Table name eksplisit untuk entity penting.
[ ] Column name eksplisit untuk field persistent penting.
[ ] Nullable jelas dan sinkron dengan DB migration.
[ ] String length jelas.
[ ] BigDecimal precision/scale jelas.
[ ] Enum tidak memakai ORDINAL untuk business data.
[ ] Date/time type sesuai semantic: Instant vs LocalDate vs LocalDateTime.
[ ] LOB tidak ikut query listing/hot path tanpa sengaja.
[ ] Value object dipakai untuk konsep kuat seperti Money/DateRange/Email jika relevan.
[ ] AttributeConverter ringan, deterministic, backward-compatible.
[ ] Unique/check/not-null constraint ada di DB migration, bukan annotation saja.
[ ] Index dipertimbangkan untuk field filter/sort/join.
[ ] Field sensitive tidak raw-loggable.
[ ] Generated/read-only column punya ownership jelas.
[ ] Audit fields punya update mechanism jelas.
[ ] Mapping kompatibel dengan rolling deployment jika enum/column baru ditambahkan.
[ ] Integration test memakai database realistis, bukan hanya H2 jika dialect penting.
```

---

## 33. Latihan dan Scenario

### Scenario 1 — Status Mapping

Kamu punya field status untuk `Application`:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    PENDING_PAYMENT,
    APPROVED,
    REJECTED
}
```

Pertanyaan:

1. Apakah cukup `EnumType.STRING`?
2. Apakah butuh stable code converter?
3. Apakah status ini perlu lookup table?
4. Bagaimana jika status baru ditambahkan saat rolling deployment?
5. Bagaimana data lama diproteksi?

Jawaban pendek:

- Jika status murni internal dan jarang berubah, `EnumType.STRING` cukup.
- Jika status menjadi kontrak eksternal/reporting/regulatory, stable code lebih baik.
- Jika status punya label, effective date, display order, active flag, gunakan lookup table.
- Rolling deployment butuh compatibility: versi lama tidak boleh crash saat membaca status baru.

### Scenario 2 — Audit Trail CLOB

Entity `AuditTrail` punya:

```java
@Lob
private String serializedChanges;

@Lob
private String fullText;
```

Listing screen hanya butuh:

- id,
- module,
- action,
- createdAt,
- createdBy.

Apa desain query yang benar?

Jawaban:

- Jangan return full `AuditTrail` entity untuk listing.
- Gunakan projection/DTO query.
- Load LOB hanya di detail screen.
- Pertimbangkan table split jika LOB sangat besar.

### Scenario 3 — Date/Time SLA

SLA dihitung dari `submittedAt` sampai `resolvedAt` lintas timezone.

Pilihan field:

```java
LocalDateTime submittedAt;
Instant submittedAt;
LocalDate submittedDate;
```

Jawaban:

- Gunakan `Instant` untuk event timestamp global.
- Gunakan `LocalDate` hanya untuk business date/reporting date.
- Jangan gunakan `LocalDateTime` kecuali zona/meaning local disimpan dan jelas.

### Scenario 4 — Money

Penalty amount disimpan sebagai:

```java
private double amount;
```

Apa masalahnya?

Jawaban:

- Floating point tidak exact.
- Rounding bisa salah.
- Currency tidak ada.
- Scale tidak jelas.

Better:

```java
@Column(precision = 19, scale = 2)
private BigDecimal amount;

@Column(length = 3)
private String currency;
```

atau `@Embedded Money`.

---

## 34. Ringkasan

Mapping fundamental adalah fondasi persistence correctness. Annotation seperti `@Column`, `@Enumerated`, `@Temporal`, `@Lob`, `@Embedded`, dan `@Convert` bukan sekadar syntax. Mereka adalah deklarasi bagaimana data Java diterjemahkan menjadi data relational yang akan hidup lama di database.

Prinsip utama:

1. Mapping adalah kontrak, bukan dekorasi.
2. Java type harus merepresentasikan domain semantic.
3. Database constraint adalah final protection.
4. Enum ordinal hampir selalu salah untuk business data.
5. `Instant` cocok untuk event timestamp; `LocalDate` cocok untuk business date.
6. `BigDecimal` wajib untuk amount/money, dengan precision/scale eksplisit.
7. LOB harus dijauhkan dari hot path/listing query.
8. AttributeConverter powerful, tetapi harus backward-compatible dan tidak menyembunyikan desain buruk.
9. Schema migration adalah source of truth production, bukan auto DDL.
10. Setiap field harus dievaluasi dari sisi semantic, constraint, evolution, performance, security, dan audit.

---

## 35. Referensi Resmi dan Lanjutan

- Jakarta Persistence 3.2 Specification — standard persistence dan object/relational mapping untuk Java/Jakarta EE.
- Jakarta Persistence API Documentation — `AttributeConverter`, `Enumerated`, `Column`, `Lob`, dan annotation mapping lain.
- Hibernate ORM User Guide — basic mapping, type system, JSON mapping, enum handling, LOB, generated values, dan provider-specific extension.
- Hibernate ORM 7 Short Guide — pengantar modern Hibernate ORM dan Jakarta Persistence/Jakarta Data ecosystem.

---

## 36. Status Seri

Part ini adalah **Part 005 dari 032**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 006 — Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many
```
