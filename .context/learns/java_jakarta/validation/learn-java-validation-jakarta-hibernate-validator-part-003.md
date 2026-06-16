# learn-java-validation-jakarta-hibernate-validator-part-003

# Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `003`  
> Topik: Built-in constraints Jakarta/Bean Validation dan Hibernate Validator  
> Target Java: 8 sampai 25  
> Fokus: memahami makna constraint, edge case, cost model, dan kesalahan desain produksi

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membangun mental model API inti:

- `ValidatorFactory` sebagai konfigurasi engine.
- `Validator` sebagai facade runtime.
- `ConstraintViolation` sebagai data kegagalan terstruktur.
- `Path` sebagai alamat kegagalan.
- `ConstraintDescriptor` sebagai metadata constraint.

Part ini masuk ke pertanyaan yang tampak sederhana tetapi sangat sering menjadi sumber bug produksi:

> “Kalau saya menaruh `@NotNull`, `@NotBlank`, `@Size`, `@Email`, atau `@Pattern`, sebenarnya kontrak apa yang sedang saya nyatakan?”

Engineer pemula melihat built-in constraint sebagai daftar annotation. Engineer senior melihatnya sebagai **bahasa kontrak**. Engineer top-tier melihatnya sebagai bagian dari **boundary correctness system**: setiap annotation harus punya makna domain, cost, failure mode, compatibility behavior, dan konsekuensi API.

---

## 1. Sumber Kebenaran: Specification vs Provider

Ada dua lapisan yang harus dibedakan:

1. **Jakarta/Bean Validation specification**  
   Menentukan API, behavior dasar, annotation constraint standar, validation lifecycle, metadata model, dan contract provider.

2. **Hibernate Validator**  
   Reference implementation dan provider yang menyediakan implementasi konkret, extension constraints, fail-fast mode, configuration API, dan fitur tambahan.

Untuk built-in constraints, mayoritas yang akan kita bahas berasal dari package:

```java
jakarta.validation.constraints.*
```

atau pada legacy Java EE / Spring Boot 2 era:

```java
javax.validation.constraints.*
```

Perbedaan namespace penting, tetapi **semantik built-in constraint-nya secara konseptual tetap harus dipahami sama**. Yang berubah adalah ekosistem, compatibility, provider version, dan package import.

---

## 2. Mental Model Utama: Constraint Bukan “Validasi Field”, tetapi “Predicate Kontrak”

Setiap constraint bisa dipahami sebagai predicate:

```text
value -> true | false
```

Contoh:

```java
@NotBlank
private String name;
```

Secara sederhana:

```text
name != null && name.trim-like-check has at least one non-whitespace char
```

Tetapi dalam sistem produksi, satu annotation membawa beberapa lapisan makna:

```text
Annotation
  -> Semantics: apa yang dianggap valid?
  -> Scope: berlaku pada field, getter, parameter, return value, type use?
  -> Null behavior: apakah null valid atau invalid?
  -> Target type: String? Collection? Number? Temporal?
  -> Error contract: error code dan message apa?
  -> Cost: murah? regex? graph traversal? message interpolation?
  -> Client compatibility: apakah perubahan constraint breaking change?
  -> Domain meaning: rule teknis atau invariant bisnis?
```

Karena itu, jangan pernah menambahkan constraint hanya karena “kelihatannya benar”. Setiap constraint adalah bagian dari API contract.

---

## 3. Prinsip Paling Penting: Mayoritas Constraint Menganggap `null` Valid

Ini aturan yang sering mengejutkan:

> Banyak built-in constraint tidak menganggap `null` sebagai invalid. Untuk membuat nilai wajib ada, tambahkan `@NotNull`, `@NotEmpty`, atau `@NotBlank` sesuai makna yang diinginkan.

Contoh:

```java
@Size(min = 3, max = 50)
private String name;
```

Nilai berikut umumnya valid terhadap `@Size`:

```java
name = null;
```

Karena `@Size` hanya berkata:

> “Jika ada nilainya, ukurannya harus antara min dan max.”

Bukan:

> “Nilainya wajib ada.”

Kalau required:

```java
@NotBlank
@Size(min = 3, max = 50)
private String name;
```

Atau jika string kosong boleh tetapi null tidak boleh:

```java
@NotNull
@Size(max = 50)
private String nickname;
```

Ini bukan detail kecil. Ini fundamental.

### 3.1 Kenapa Specification Mendesain Banyak Constraint Null-Permissive?

Agar constraint bisa dikomposisi.

Misalnya:

```java
@Email
private String secondaryEmail;
```

Maknanya:

> Jika user mengisi secondary email, formatnya harus email-like.

Bukan:

> User wajib punya secondary email.

Untuk wajib:

```java
@NotBlank
@Email
private String primaryEmail;
```

Dengan desain ini, requiredness dipisah dari format.

---

## 4. Taxonomy Built-in Constraints

Built-in constraints bisa dikelompokkan secara mental:

```text
Existence constraints
  @Null
  @NotNull
  @NotEmpty
  @NotBlank

Size / cardinality constraints
  @Size

String / pattern constraints
  @Pattern
  @Email

Boolean constraints
  @AssertTrue
  @AssertFalse

Numeric boundary constraints
  @Min
  @Max
  @DecimalMin
  @DecimalMax
  @Positive
  @PositiveOrZero
  @Negative
  @NegativeOrZero
  @Digits

Temporal constraints
  @Past
  @PastOrPresent
  @Future
  @FutureOrPresent
```

Hibernate Validator juga menyediakan constraints tambahan seperti `@Length`, `@Range`, `@URL`, dan lainnya, tetapi part ini memprioritaskan constraint standar. Extension Hibernate akan dibahas lebih jauh di part khusus.

---

## 5. `@Null`: Field Harus Tidak Ada Nilainya

### 5.1 Makna

```java
@Null
private String id;
```

Maknanya:

> Nilai harus `null`.

Use case umum:

- ID tidak boleh dikirim saat create.
- Field server-generated tidak boleh disuplai client.
- Field read-only pada request DTO.
- Field internal tidak boleh diisi external caller.

Contoh:

```java
public record CreateApplicationRequest(
        @Null(message = "id must not be supplied by client")
        Long id,

        @NotBlank
        String applicantName
) {}
```

### 5.2 `@Null` sebagai Boundary Defense

`@Null` sangat berguna untuk mencegah **mass assignment vulnerability**.

Misalnya client mengirim:

```json
{
  "id": 10,
  "applicantName": "Alice",
  "status": "APPROVED",
  "approvedBy": "admin"
}
```

Jika DTO menerima semua field dan sistem hanya mengabaikan sebagian, risiko tetap ada karena:

- developer masa depan bisa tidak sengaja memakai field itu,
- mapping otomatis bisa memasukkan field ke entity,
- audit sulit menjelaskan apakah input malicious pernah diterima.

Lebih baik field yang tidak boleh dikirim diberi kontrak eksplisit:

```java
@Null
private ApplicationStatus status;
```

Atau bahkan tidak dimodelkan di request DTO.

### 5.3 Kapan Jangan Pakai `@Null`

Jangan pakai `@Null` untuk PATCH model jika field absen dan field null memiliki makna berbeda.

Contoh:

```json
{}
```

berbeda dari:

```json
{ "middleName": null }
```

Bean Validation hanya melihat Java object setelah deserialization. Ia sering tidak tahu apakah field absen atau eksplisit null, kecuali model PATCH dibuat eksplisit.

---

## 6. `@NotNull`: Nilai Wajib Ada, Bukan Wajib Bermakna

### 6.1 Makna

```java
@NotNull
private String name;
```

Maknanya hanya:

```text
name != null
```

Nilai berikut valid terhadap `@NotNull`:

```java
""
"   "
```

Karena empty string dan blank string bukan null.

### 6.2 Use Case Tepat

`@NotNull` cocok untuk:

- object reference wajib ada,
- enum wajib dipilih,
- boolean wrapper wajib dikirim,
- numeric value wajib dikirim,
- nested DTO wajib ada,
- date wajib ada,
- collection boleh kosong tetapi tidak boleh null.

Contoh:

```java
public record SubmitRequest(
        @NotNull ApplicationType applicationType,
        @NotNull LocalDate submittedDate,
        @NotNull List<AttachmentRequest> attachments
) {}
```

Maknanya:

- `attachments = null` invalid.
- `attachments = []` valid.

Kalau minimal 1 attachment:

```java
@NotEmpty
private List<AttachmentRequest> attachments;
```

### 6.3 `@NotNull` pada Primitive

Ini redundant:

```java
@NotNull
private int age;
```

`int` tidak bisa null. Constraint ini tidak memberi nilai tambah.

Gunakan wrapper jika perlu membedakan:

```java
@NotNull
private Integer age;
```

Kenapa penting?

Karena pada request JSON:

```json
{}
```

Jika field Java adalah primitive `int`, hasil default bisa `0`, sehingga sistem tidak bisa membedakan:

```text
client tidak mengirim age
client mengirim age = 0
```

Untuk input boundary, wrapper sering lebih aman.

### 6.4 `@NotNull` pada Boolean

```java
@NotNull
private Boolean acceptedTerms;
```

Ini hanya memastikan client mengirim nilai `true` atau `false`.

Kalau harus `true`:

```java
@AssertTrue
private Boolean acceptedTerms;
```

Tetapi hati-hati: tergantung implementasi dan type, `null` bisa dianggap valid untuk `@AssertTrue` kecuali dikombinasikan dengan `@NotNull` atau wrapper logic. Untuk mandatory accepted terms, desain yang eksplisit:

```java
@NotNull
@AssertTrue
private Boolean acceptedTerms;
```

---

## 7. `@NotEmpty`: Tidak Null dan Tidak Kosong

### 7.1 Makna

`@NotEmpty` berarti:

```text
value != null && size/length > 0
```

Berlaku untuk tipe seperti:

- `CharSequence`,
- `Collection`,
- `Map`,
- array.

Contoh:

```java
@NotEmpty
private List<String> tags;
```

Valid:

```java
List.of("urgent")
```

Invalid:

```java
null
List.of()
```

### 7.2 Pada String

```java
@NotEmpty
private String name;
```

Invalid:

```java
null
""
```

Tetapi valid:

```java
"   "
```

Karena blank string tetap panjangnya lebih dari nol.

Untuk human-entered text, biasanya `@NotBlank` lebih tepat.

### 7.3 Pada Collection

```java
@NotEmpty
private List<@NotBlank String> reasons;
```

Maknanya:

- list wajib ada,
- list tidak boleh kosong,
- setiap element harus string non-blank.

Tanpa element constraint:

```java
@NotEmpty
private List<String> reasons;
```

Nilai ini valid terhadap `@NotEmpty`:

```java
List.of("")
List.of("   ")
List.of((String) null)
```

Karena `@NotEmpty` pada list hanya memeriksa list-nya, bukan elemennya.

---

## 8. `@NotBlank`: String Wajib Berisi Karakter Non-Whitespace

### 8.1 Makna

`@NotBlank` berlaku untuk `CharSequence`.

Maknanya:

```text
value != null && contains at least one non-whitespace character
```

Invalid:

```java
null
""
"   "
"\t\n"
```

Valid:

```java
"A"
"  A  "
```

### 8.2 `@NotBlank` vs `@NotEmpty` vs `@NotNull`

| Constraint | `null` | `""` | `"   "` | `"abc"` |
|---|---:|---:|---:|---:|
| `@NotNull` | invalid | valid | valid | valid |
| `@NotEmpty` | invalid | invalid | valid | valid |
| `@NotBlank` | invalid | invalid | invalid | valid |

### 8.3 Unicode Whitespace Caveat

Whitespace bukan topik sederhana. Ada:

- ASCII space,
- tab,
- newline,
- non-breaking space,
- zero-width characters,
- Unicode separator categories.

Untuk aplikasi global, Anda harus bertanya:

> Apakah string berisi zero-width character dianggap “bermakna”?

Contoh konseptual:

```java
String s = "\u200B"; // zero-width space
```

Tergantung implementasi whitespace check, ini bisa mengejutkan. Untuk field penting seperti name, identifier, atau reason, kadang perlu normalisasi tambahan sebelum validation atau custom constraint yang sadar Unicode.

### 8.4 Jangan Pakai `@NotBlank` untuk Semua String

Tidak semua string harus non-blank.

Contoh field opsional:

```java
@Size(max = 500)
private String remarks;
```

Ini berarti remarks opsional, tetapi kalau diisi maksimal 500 karakter.

Kalau:

```java
@NotBlank
@Size(max = 500)
private String remarks;
```

Maka remarks menjadi wajib. Ini bisa menjadi breaking API change.

---

## 9. `@Size`: Panjang, Jumlah, atau Cardinality

### 9.1 Makna

`@Size` memeriksa ukuran:

```java
@Size(min = 3, max = 50)
private String name;
```

Untuk:

- `CharSequence`: panjang karakter menurut `length()`.
- `Collection`: `size()`.
- `Map`: `size()`.
- array: length.

### 9.2 `@Size` Tidak Membuat Field Required

```java
@Size(min = 3)
private String name;
```

`null` biasanya valid.

Untuk required:

```java
@NotBlank
@Size(min = 3, max = 50)
private String name;
```

### 9.3 Char Count vs User-Perceived Character

Java `String.length()` menghitung UTF-16 code units, bukan grapheme cluster.

Contoh:

```java
"👍".length() // bisa 2 karena surrogate pair
```

Nama manusia, emoji, aksen gabungan, atau karakter kompleks bisa membuat `@Size(max = 10)` tidak sama dengan “maksimal 10 karakter yang dilihat user”.

Untuk field seperti:

- username teknis,
- code,
- reference number,
- postal code,

`@Size` biasanya cukup.

Untuk field human name global, gunakan hati-hati.

### 9.4 `@Size` Bukan Database Column Guarantee

```java
@Size(max = 255)
private String title;
```

Tidak otomatis menjamin database column cukup, karena:

- DB bisa menghitung bytes, bukan characters.
- Encoding bisa multi-byte.
- Column semantic bisa `VARCHAR2(255 BYTE)` vs `VARCHAR2(255 CHAR)` pada Oracle.
- Input bisa berubah setelah validation.

Jangan anggap `@Size(max=255)` menggantikan DB constraint.

### 9.5 `@Size` pada Collection: Boundary Defense

```java
@Size(max = 100)
private List<@Valid AttachmentRequest> attachments;
```

Ini sangat penting untuk mencegah payload besar dan cascaded validation explosion.

Tanpa batas:

```json
{
  "attachments": [ ... 100000 items ... ]
}
```

Dampaknya:

- CPU validation tinggi,
- memory allocation tinggi,
- error response terlalu besar,
- DB/API downstream overload.

Jadi `@Size(max=...)` adalah kontrol reliability dan security, bukan sekadar UX.

---

## 10. `@Pattern`: Regex Constraint yang Kuat tetapi Berbahaya

### 10.1 Makna

```java
@Pattern(regexp = "^[A-Z]{3}-\\d{6}$")
private String referenceNo;
```

Maknanya:

> Jika value tidak null, value harus match regex.

`null` biasanya valid kecuali dikombinasikan dengan `@NotNull`/`@NotBlank`.

### 10.2 Use Case Tepat

Cocok untuk:

- reference number,
- postal code sederhana,
- code format,
- enum-like textual field jika belum dimodelkan enum,
- fixed format identifier.

Contoh:

```java
@NotBlank
@Pattern(regexp = "^[A-Z]{2}[0-9]{6}$")
private String caseReference;
```

### 10.3 Regex Harus Anchored

Buruk:

```java
@Pattern(regexp = "[A-Z]{3}")
```

Bisa match substring tergantung penggunaan matcher. Untuk kontrak format penuh, gunakan anchor:

```java
@Pattern(regexp = "^[A-Z]{3}$")
```

### 10.4 Regex Denial-of-Service

Regex kompleks bisa mengalami catastrophic backtracking.

Contoh pola berbahaya:

```text
^(a+)+$
```

Input:

```text
aaaaaaaaaaaaaaaaaaaaa!
```

Dapat membuat waktu evaluasi meledak.

Guideline:

- Hindari nested quantifier.
- Hindari regex terlalu generik.
- Batasi panjang input dengan `@Size` sebelum regex secara konseptual.
- Gunakan regex linear jika memungkinkan.
- Untuk format kompleks, pertimbangkan parser eksplisit.

Contoh lebih aman:

```java
@NotBlank
@Size(max = 20)
@Pattern(regexp = "^[A-Z0-9-]+$")
private String code;
```

### 10.5 Regex Bukan Sanitization

```java
@Pattern(regexp = "^[a-zA-Z0-9 ]+$")
private String name;
```

Ini tidak otomatis aman untuk:

- SQL,
- HTML,
- JavaScript,
- shell command,
- file path,
- LDAP query.

Validation menjawab:

> Apakah input sesuai kontrak?

Sanitization/encoding menjawab:

> Bagaimana input aman digunakan di konteks tertentu?

Keduanya berbeda.

---

## 11. `@Email`: Format Email-Like, Bukan Jaminan Email Valid

### 11.1 Makna

```java
@Email
private String email;
```

Maknanya:

> Jika value tidak null, value harus tampak seperti email menurut validator.

Ini tidak menjamin:

- mailbox ada,
- domain menerima email,
- user memiliki email tersebut,
- email tidak disposable,
- email aman digunakan untuk login,
- email canonicalization benar.

### 11.2 Required Email

```java
@NotBlank
@Email
private String email;
```

Tanpa `@NotBlank`, `null` bisa valid.

### 11.3 Email Address Itu Sulit

Email valid menurut RFC bisa jauh lebih kompleks daripada regex sederhana. Tetapi aplikasi bisnis biasanya tidak ingin menerima semua bentuk RFC-valid.

Misalnya quoted local part:

```text
"john..doe"@example.com
```

Mungkin RFC-valid dalam konteks tertentu, tetapi banyak sistem bisnis menolaknya.

Karena itu, `@Email` harus diperlakukan sebagai:

> pragmatic format validation, bukan kebenaran absolut.

### 11.4 Email untuk Identity: Jangan Hanya Validasi Format

Untuk login/account identity, perlu lapisan lain:

- normalization/canonicalization,
- uniqueness constraint di DB,
- verification email,
- ownership proof,
- anti-enumeration response,
- rate limiting,
- case sensitivity policy.

`@Email` hanya satu predicate kecil.

---

## 12. Numeric Constraints: `@Min`, `@Max`, `@DecimalMin`, `@DecimalMax`

### 12.1 `@Min` dan `@Max`

```java
@Min(1)
@Max(100)
private Integer quantity;
```

Cocok untuk integer-like value.

Tipe umum:

- `byte`, `short`, `int`, `long` dan wrapper,
- `BigInteger`,
- kadang numeric types lain sesuai provider/spec support.

### 12.2 Jangan Pakai `@Min` untuk `double`/`float` Semantik Finansial

Untuk money, scoring, percentage, atau decimal precise, gunakan `BigDecimal` dengan `@DecimalMin`/`@DecimalMax` atau custom Money type.

Buruk:

```java
@Min(0)
private double amount;
```

Lebih baik:

```java
@DecimalMin(value = "0.00", inclusive = true)
@Digits(integer = 12, fraction = 2)
private BigDecimal amount;
```

Tetapi untuk domain money yang serius, lebih baik gunakan value object:

```java
public record Money(
        @NotNull
        @DecimalMin("0.00")
        @Digits(integer = 12, fraction = 2)
        BigDecimal amount,

        @NotNull
        Currency currency
) {}
```

### 12.3 `@DecimalMin` Inclusive vs Exclusive

```java
@DecimalMin(value = "0.0", inclusive = false)
private BigDecimal ratio;
```

Maknanya:

```text
ratio > 0.0
```

Sedangkan:

```java
@DecimalMin(value = "0.0", inclusive = true)
```

Maknanya:

```text
ratio >= 0.0
```

Gunakan secara eksplisit untuk menghindari ambiguity.

### 12.4 `BigDecimal` Scale Caveat

`BigDecimal` punya value dan scale.

```java
new BigDecimal("1.0")
new BigDecimal("1.00")
```

Secara numeric compare bisa setara, tetapi scale berbeda.

`@DecimalMin` memeriksa nilai numeric, bukan necessarily scale policy. Untuk scale, gunakan:

```java
@Digits(integer = 10, fraction = 2)
private BigDecimal amount;
```

Atau enforce di value object constructor.

---

## 13. `@Positive`, `@PositiveOrZero`, `@Negative`, `@NegativeOrZero`

### 13.1 Makna

```java
@Positive
private Integer count;
```

Makna:

```text
count > 0
```

```java
@PositiveOrZero
private Integer count;
```

Makna:

```text
count >= 0
```

`null` biasanya valid kecuali requiredness ditambahkan.

### 13.2 Kapan Lebih Baik dari `@Min`

Untuk non-negative values:

```java
@PositiveOrZero
private BigDecimal outstandingAmount;
```

lebih ekspresif daripada:

```java
@DecimalMin("0")
private BigDecimal outstandingAmount;
```

Tetapi jika boundary spesifik:

```java
@Min(18)
private Integer age;
```

lebih tepat.

### 13.3 Domain Meaning

Jangan asal pakai `@Positive` jika nol punya makna valid.

Contoh:

- quantity order minimal 1: `@Positive`.
- outstanding amount bisa 0: `@PositiveOrZero`.
- retry count bisa 0: `@PositiveOrZero`.
- age bayi bisa 0 tergantung model: jangan pakai `@Positive` tanpa berpikir.

---

## 14. `@Digits`: Jumlah Digit Integer dan Fraction

### 14.1 Makna

```java
@Digits(integer = 10, fraction = 2)
private BigDecimal amount;
```

Maknanya:

- maksimal 10 digit di bagian integer,
- maksimal 2 digit di bagian fraction.

Contoh valid:

```text
1234567890.12
0.99
```

Invalid:

```text
12345678901.12   // integer part 11 digit
123.456          // fraction 3 digit
```

### 14.2 `@Digits` untuk Database Compatibility

`@Digits(integer=10, fraction=2)` sering dikaitkan dengan DB column:

```sql
NUMBER(12,2)
```

Tetapi jangan menganggap mapping selalu 1:1 tanpa memeriksa DB dialect dan schema.

### 14.3 Money Caveat

Untuk uang, `@Digits` hanya memeriksa bentuk angka, bukan:

- currency,
- rounding mode,
- tax rule,
- negative allowed or not,
- minor unit per currency,
- exchange rate policy.

Untuk sistem finansial, constraint ini hanya boundary awal.

---

## 15. Boolean Constraints: `@AssertTrue` dan `@AssertFalse`

### 15.1 `@AssertTrue`

```java
@AssertTrue
private Boolean acceptedTerms;
```

Makna:

```text
value must be true
```

Untuk mandatory acceptance, gunakan:

```java
@NotNull
@AssertTrue
private Boolean acceptedTerms;
```

### 15.2 Derived Boolean Method

Sering dipakai untuk cross-field sederhana:

```java
public class DateRangeRequest {
    private LocalDate startDate;
    private LocalDate endDate;

    @AssertTrue(message = "startDate must be before or equal to endDate")
    public boolean isValidDateRange() {
        if (startDate == null || endDate == null) {
            return true;
        }
        return !startDate.isAfter(endDate);
    }
}
```

Ini cepat dibuat, tetapi ada masalah:

- violation path bisa mengarah ke `validDateRange`, bukan `startDate`/`endDate`,
- method bisa muncul sebagai property pseudo-field,
- logic kompleks menjadi tidak rapi,
- message kurang presisi.

Untuk cross-field serius, class-level custom constraint lebih baik.

### 15.3 Jangan Campur Domain Logic Berat di Getter Boolean

Buruk:

```java
@AssertTrue
public boolean isEligibleForApproval() {
    return applicant.hasNoOutstandingCase()
        && riskScore < 50
        && externalRegistryService.isClear(applicant.getId());
}
```

Ini buruk karena:

- validator memanggil external service,
- method property jadi side-effect prone,
- test sulit,
- latency tinggi,
- error message miskin,
- validation engine tidak didesain sebagai workflow policy engine.

---

## 16. Temporal Constraints: `@Past`, `@PastOrPresent`, `@Future`, `@FutureOrPresent`

### 16.1 Makna

```java
@Past
private LocalDate birthDate;
```

Makna:

```text
birthDate must be before now/current date according to clock provider
```

```java
@FutureOrPresent
private LocalDate effectiveDate;
```

Makna:

```text
effectiveDate must be now/current date or future
```

### 16.2 Supported Temporal Types

Pada Java 8+, temporal constraints mendukung Java Time API seperti:

- `LocalDate`,
- `LocalDateTime`,
- `Instant`,
- `ZonedDateTime`,
- `OffsetDateTime`,
- dan tipe temporal lain sesuai spec/provider.

### 16.3 Clock Provider

Temporal validation bergantung pada “now”. Dalam Validation API, “now” bisa dikontrol melalui `ClockProvider`.

Kenapa penting?

- Test deterministic.
- Multi-region app.
- Business timezone.
- Regulatory cutoff.
- Batch processing dengan effective processing date.

Contoh konseptual:

```java
ValidatorFactory factory = Validation.byDefaultProvider()
        .configure()
        .clockProvider(() -> Clock.fixed(
                Instant.parse("2026-01-01T00:00:00Z"),
                ZoneOffset.UTC
        ))
        .buildValidatorFactory();
```

### 16.4 `LocalDate` vs `Instant` Boundary

```java
@PastOrPresent
private LocalDate submittedDate;
```

Validasi terhadap tanggal lokal bergantung pada zona clock provider.

Jika server UTC tetapi user/regulator menggunakan Asia/Singapore atau Asia/Jakarta, hasil bisa berbeda di sekitar tengah malam.

Untuk sistem regulatory, jangan anggap “today” universal.

Tentukan:

```text
Business date = tanggal menurut timezone apa?
```

### 16.5 `@Past` untuk Birth Date

```java
@Past
private LocalDate birthDate;
```

Ini memastikan tanggal lahir sebelum hari ini. Tetapi tidak memastikan:

- umur minimal,
- umur maksimal masuk akal,
- tanggal bukan 1800-01-01,
- tanggal bukan typo.

Untuk umur minimal:

```java
@Adult(minAge = 18, zone = "Asia/Singapore")
private LocalDate birthDate;
```

atau validation di domain policy.

---

## 17. Built-in Constraints dan Type-Use Constraints

Sejak Bean Validation 2.0, constraint bisa diletakkan pada type argument.

Contoh:

```java
private List<@NotBlank String> reasons;
```

Maknanya berbeda dari:

```java
@NotEmpty
private List<String> reasons;
```

Gabungan yang benar:

```java
@NotEmpty
private List<@NotBlank String> reasons;
```

Makna:

- list tidak null,
- list tidak kosong,
- setiap element tidak null,
- setiap element tidak blank.

Contoh map:

```java
private Map<@NotBlank String, @NotNull @Positive Integer> stockByCode;
```

Makna:

- key harus non-blank,
- value harus ada,
- value harus positif.

Top-tier engineer harus selalu membedakan:

```text
constraint pada container
constraint pada element
constraint pada nested property
```

---

## 18. Access Strategy: Field vs Getter Constraint

Constraint bisa diletakkan di field:

```java
@NotBlank
private String name;
```

atau getter:

```java
@NotBlank
public String getName() {
    return name;
}
```

Guideline:

- Jangan campur field dan getter constraints secara sembarangan pada class yang sama.
- Field constraints membaca field langsung.
- Getter constraints membaca property melalui method.
- Getter bisa punya logic, lazy computation, atau side effect jika desain buruk.

Untuk DTO sederhana, field atau record component constraints umum.

Untuk Java records:

```java
public record CreateUserRequest(
        @NotBlank String name,
        @NotBlank @Email String email
) {}
```

---

## 19. Constraint Composition Dasar

Built-in constraints sering dikombinasikan:

```java
@NotBlank
@Size(max = 100)
private String title;
```

Mental model:

```text
title != null
AND title has non-whitespace char
AND title.length <= 100
```

Tidak ada jaminan urutan evaluasi kecuali menggunakan group sequence atau provider-specific fail-fast behavior.

Jangan mengandalkan `@NotBlank` selalu dievaluasi sebelum `@Pattern`.

Jika cost matters:

- gunakan group sequence,
- gunakan fail-fast dengan sadar,
- atau buat custom validator yang mengatur urutan secara eksplisit.

---

## 20. Built-in Constraints dan API Compatibility

Menambahkan constraint bisa menjadi breaking change.

Contoh sebelumnya:

```java
private String remarks;
```

Kemudian diubah:

```java
@NotBlank
private String remarks;
```

Ini breaking karena request yang sebelumnya valid menjadi invalid.

Perubahan berikut juga breaking:

```java
@Size(max = 500)
```

menjadi:

```java
@Size(max = 255)
```

atau:

```java
@PastOrPresent
```

menjadi:

```java
@Past
```

Dalam public API atau inter-service contract, validation tightening harus dikelola seperti schema change.

Strategi rollout:

1. Observe existing traffic.
2. Add warning/non-blocking validation.
3. Notify clients.
4. Enforce later.
5. Monitor rejection rate.

---

## 21. Error Message Bukan Error Code

Built-in constraint default message biasanya seperti:

```text
must not be null
must not be blank
size must be between {min} and {max}
```

Jangan menjadikan message sebagai programmatic contract.

Buruk:

```javascript
if (message === "must not be blank") {
  showNameRequiredError();
}
```

Lebih baik API response punya stable code:

```json
{
  "errors": [
    {
      "path": "applicant.name",
      "code": "APPLICANT_NAME_REQUIRED",
      "constraint": "NotBlank",
      "message": "Applicant name is required."
    }
  ]
}
```

Built-in constraint memberi sinyal teknis; aplikasi perlu menerjemahkan ke contract yang stabil.

---

## 22. Rejected Value: Jangan Bocorkan PII

`ConstraintViolation` menyediakan `getInvalidValue()`.

Ini berguna untuk debugging, tetapi berbahaya untuk API/log.

Contoh field sensitif:

- password,
- NRIC/NIK/passport,
- phone,
- email,
- address,
- bank account,
- token,
- uploaded text.

Jangan return mentah:

```json
{
  "path": "password",
  "rejectedValue": "MySecretPassword123!"
}
```

Lebih aman:

```json
{
  "path": "password",
  "code": "PASSWORD_TOO_WEAK"
}
```

Untuk observability, log:

```text
constraint=Size path=password rejectedValueClass=String rejectedValueLength=8
```

bukan actual value.

---

## 23. Constraint Selection Decision Table

| Intent | Constraint yang umum tepat | Catatan |
|---|---|---|
| Field tidak boleh dikirim client | `@Null` | Cocok untuk server-generated field pada create request |
| Field wajib ada, tipe apa pun | `@NotNull` | Tidak memeriksa string kosong/blank |
| String wajib ada dan tidak kosong | `@NotEmpty` | Blank spaces masih valid |
| String human input wajib bermakna | `@NotBlank` | Umumnya untuk name/title/reason |
| Collection wajib punya minimal 1 item | `@NotEmpty` | Tambahkan element constraint bila perlu |
| Collection maksimal N item | `@Size(max=N)` | Penting untuk abuse resistance |
| String maksimal N char | `@Size(max=N)` | Hati-hati Unicode dan DB byte semantics |
| Code harus format tertentu | `@Pattern` | Anchor regex dan batasi panjang |
| Email optional tapi format harus benar | `@Email` | Null biasanya valid |
| Email wajib | `@NotBlank @Email` | Tambahkan verification di layer lain |
| Angka minimal/maksimal integer | `@Min`, `@Max` | Cocok untuk integer-like |
| Decimal boundary | `@DecimalMin`, `@DecimalMax` | Gunakan string value |
| Angka harus positif | `@Positive` | Nol invalid |
| Angka tidak boleh negatif | `@PositiveOrZero` | Nol valid |
| Precision decimal | `@Digits` | Bukan money policy penuh |
| Boolean harus true | `@AssertTrue` | Tambahkan `@NotNull` untuk mandatory wrapper |
| Tanggal harus masa lalu | `@Past` | Timezone/clock matters |
| Tanggal boleh hari ini/masa lalu | `@PastOrPresent` | Cocok untuk submitted date |
| Tanggal masa depan | `@Future` | Business timezone matters |
| Tanggal boleh hari ini/masa depan | `@FutureOrPresent` | Cocok untuk effective date |

---

## 24. Common Misuse Pattern

### 24.1 Mengira `@Size` Membuat Required

Buruk:

```java
@Size(min = 1)
private String name;
```

Masalah:

```java
name = null; // valid terhadap @Size
```

Lebih tepat:

```java
@NotBlank
@Size(max = 100)
private String name;
```

### 24.2 Menggunakan `@NotNull` untuk String User Input

Buruk:

```java
@NotNull
private String reason;
```

Masalah:

```java
reason = "   "; // valid
```

Lebih tepat:

```java
@NotBlank
private String reason;
```

### 24.3 Menggunakan `@Pattern` untuk Business Rule

Buruk:

```java
@Pattern(regexp = "PENDING|APPROVED|REJECTED")
private String status;
```

Lebih baik:

```java
@NotNull
private ApplicationStatus status;
```

Tetapi untuk external payload yang memang string dan harus backward compatible, pattern masih bisa dipakai sementara.

### 24.4 Validasi Uniqueness dengan Custom Constraint Naif

Contoh:

```java
@UniqueEmail
private String email;
```

Masalah:

- race condition,
- dua request paralel bisa lolos,
- DB tetap harus punya unique constraint,
- validator bisa memanggil DB di layer yang tidak tepat.

Lebih aman:

- gunakan DB unique constraint sebagai final guard,
- tangkap violation DB,
- translate ke domain/API error,
- gunakan pre-check hanya untuk UX, bukan correctness final.

### 24.5 Menggunakan Built-in Constraint untuk Workflow Rule

Buruk:

```java
@NotBlank(groups = Approve.class)
private String approvalRemarks;
```

Ini bisa valid untuk requiredness sederhana. Tetapi kalau approval remarks wajib hanya ketika:

- risk score tinggi,
- officer role tertentu,
- case sudah melewati SLA,
- applicant type tertentu,
- previous decision rejected,

maka annotation group bisa berubah menjadi mini workflow engine yang sulit dibaca.

Lebih baik pisahkan:

- DTO shape validation,
- command validation,
- workflow guard,
- domain policy.

---

## 25. Java 8 sampai 25: Version-Aware Notes

### 25.1 Java 8

Penting karena Bean Validation 2.0 membawa dukungan Java 8 seperti:

- Java Time API constraints,
- type-use constraints,
- container element constraints.

Kode legacy biasanya memakai:

```java
javax.validation.constraints.*
```

### 25.2 Java 11

Banyak enterprise app berada di Java 11 dengan Spring Boot 2.x atau Jakarta EE 8 style.

Risiko utama:

- dependency mix,
- Hibernate Validator 6 vs 7,
- `javax` vs `jakarta` mismatch.

### 25.3 Java 17

Java 17 menjadi baseline penting untuk modern Jakarta EE 11/Hibernate Validator 9 ecosystem.

Mulai lazim:

- records,
- sealed classes,
- stronger immutable DTO style,
- Spring Boot 3+.

### 25.4 Java 21

Java 21 LTS membuat style request/command model makin condong ke:

```java
public record SubmitApplicationCommand(
        @NotBlank String applicantName,
        @NotNull ApplicationType type
) {}
```

Tetapi validation tetap terjadi setelah object dibuat, kecuali Anda validasi constructor secara eksplisit atau framework melakukan executable validation.

### 25.5 Java 25

Java 25 era memperkuat kebutuhan desain yang:

- immutable-friendly,
- record-aware,
- AOT/native-image-aware bila framework mendukung,
- virtual-thread-friendly dalam arti validator tidak boleh sembarangan blocking external dependency,
- observable dan contract-driven.

Built-in constraints tetap relevan, tetapi desain arsitekturnya harus matang.

---

## 26. Practical Design Recipes

### 26.1 Create Request DTO

```java
public record CreateCaseRequest(
        @Null
        Long id,

        @NotBlank
        @Size(max = 200)
        String applicantName,

        @NotBlank
        @Email
        @Size(max = 320)
        String applicantEmail,

        @NotNull
        CaseType caseType,

        @Size(max = 20)
        List<@NotBlank @Size(max = 50) String> tags,

        @NotEmpty
        List<@Valid AttachmentRequest> attachments
) {}
```

Notes:

- `id` harus null karena server-generated.
- `applicantName` human-entered, maka `@NotBlank`.
- `applicantEmail` wajib dan email-like.
- `caseType` enum wajib.
- `tags` optional, tetapi jika ada maksimal 20 dan setiap item non-blank.
- `attachments` wajib minimal satu.

### 26.2 Search Request DTO

```java
public record SearchCaseRequest(
        @Size(max = 100)
        String keyword,

        @Size(max = 20)
        List<@Pattern(regexp = "^[A-Z_]+$") String> statuses,

        @PositiveOrZero
        Integer page,

        @Min(1)
        @Max(100)
        Integer size
) {}
```

Notes:

- Search fields biasanya optional.
- Jangan pakai `@NotBlank` untuk keyword jika pencarian kosong boleh.
- Pagination harus dibatasi untuk reliability.

### 26.3 Approval Command

```java
public record ApproveCaseCommand(
        @NotNull
        Long caseId,

        @NotBlank
        @Size(max = 1000)
        String remarks,

        @NotNull
        Boolean confirmNoConflictOfInterest
) {}
```

Tetapi rule seperti:

```text
Officer cannot approve their own submitted case.
```

bukan built-in constraint. Itu workflow/domain policy.

---

## 27. Built-in Constraint Review Checklist

Sebelum merge PR yang menambah constraint, tanyakan:

1. Apakah field ini wajib atau opsional?
2. Jika string, apakah null, empty, blank punya makna berbeda?
3. Apakah constraint ini berlaku untuk semua operation atau hanya create/update/submit?
4. Apakah ini input shape rule atau business workflow rule?
5. Apakah null behavior sudah benar?
6. Apakah collection size dibatasi?
7. Apakah element collection juga divalidasi?
8. Apakah regex aman dari catastrophic backtracking?
9. Apakah temporal constraint memakai timezone yang benar?
10. Apakah perubahan ini breaking untuk client lama?
11. Apakah message/error code stabil?
12. Apakah rejected value aman untuk log/API?
13. Apakah DB constraint tetap menjadi final guard untuk consistency?
14. Apakah test mencakup null, empty, blank, boundary, dan invalid format?
15. Apakah rule ini akan mudah dijelaskan ke user/support/auditor?

---

## 28. Anti-Pattern Summary

| Anti-pattern | Masalah | Alternatif |
|---|---|---|
| `@Size(min=1)` untuk required string | Null tetap valid | `@NotBlank` |
| `@NotNull` untuk human text | Blank tetap valid | `@NotBlank` |
| `@NotEmpty` untuk human text | Spaces tetap valid | `@NotBlank` |
| Regex kompleks tanpa max length | ReDoS risk | `@Size` + regex sederhana |
| `@Email` dianggap bukti email valid | Tidak membuktikan mailbox/ownership | Email verification |
| Constraint pada list tanpa element constraint | Item invalid tetap lolos | `List<@NotBlank String>` |
| `@NotNull` pada primitive | Redundant dan bisa menutupi absent input | Wrapper type di DTO |
| Business workflow dipaksa ke annotation | Sulit dibaca/test/audit | Domain policy/workflow guard |
| DB uniqueness hanya dicek validator | Race condition | DB unique constraint + error translation |
| Return rejected value mentah | PII leak | Mask/classify rejected value |

---

## 29. Mental Model Penutup

Built-in constraints adalah vocabulary paling dasar dalam Jakarta Validation. Tetapi justru karena terlihat sederhana, mereka sering dipakai sembarangan.

Cara berpikir yang benar:

```text
@NotNull      -> existence
@NotEmpty    -> existence + non-empty cardinality
@NotBlank    -> existence + meaningful text
@Size        -> cardinality/length boundary
@Pattern     -> formal textual shape
@Email       -> pragmatic email-like shape
@Min/@Max    -> integer boundary
@DecimalMin  -> decimal boundary
@Digits      -> decimal digit shape
@Past/Future -> temporal relation to configured clock
@AssertTrue  -> boolean predicate, preferably simple
```

Dan aturan paling penting:

```text
Requiredness, format, semantic business rule, workflow eligibility, persistence consistency,
and security safety are different concerns.
```

Annotation built-in constraint sangat berguna untuk **local, deterministic, explainable validation**.

Ia buruk jika dipakai sebagai:

- workflow engine,
- authorization system,
- DB consistency replacement,
- sanitization mechanism,
- external dependency checker,
- one-size-fits-all business rule container.

Top-tier validation design bukan tentang menaruh annotation sebanyak mungkin. Ia tentang menaruh constraint di tempat yang tepat, dengan makna yang tepat, failure model yang jelas, dan konsekuensi operasional yang dapat dikendalikan.

---

## 30. Latihan Pemahaman

### Latihan 1

Apa masalah dari DTO berikut?

```java
public record RegisterUserRequest(
        @NotNull String name,
        @Email String email,
        @Size(min = 8) String password
) {}
```

Jawaban yang diharapkan:

- `name` bisa `"   "`.
- `email` bisa `null` karena `@Email` tidak membuat required.
- `password` bisa `null` karena `@Size` tidak membuat required.
- Tidak ada max length untuk password input, bisa abuse.
- Tidak ada policy password strength, tetapi jangan semuanya dipaksa ke regex kompleks.

Versi lebih baik:

```java
public record RegisterUserRequest(
        @NotBlank
        @Size(max = 100)
        String name,

        @NotBlank
        @Email
        @Size(max = 320)
        String email,

        @NotBlank
        @Size(min = 8, max = 128)
        String password
) {}
```

Password strength bisa dicek dengan dedicated validator/policy object.

### Latihan 2

Apa beda dua deklarasi ini?

```java
@NotEmpty
private List<String> reasons;
```

```java
@NotEmpty
private List<@NotBlank String> reasons;
```

Jawaban:

- Deklarasi pertama hanya memastikan list tidak null dan tidak kosong.
- Deklarasi kedua juga memastikan setiap element string tidak null, tidak empty, dan tidak blank.

### Latihan 3

Kenapa ini berbahaya?

```java
@Pattern(regexp = "^(a+)+$")
@Size(max = 10000)
private String input;
```

Jawaban:

- Regex memiliki nested quantifier yang bisa catastrophic backtracking.
- `@Size(max=10000)` terlalu besar untuk pola seperti itu.
- Input malicious bisa membuat CPU spike.
- Gunakan regex linear atau parser eksplisit, dan limit panjang lebih ketat.

---

## 31. Referensi Resmi

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Jakarta Validation constraints API package: https://jakarta.ee/specifications/bean-validation/3.0/apidocs/jakarta/validation/constraints/package-summary
- Bean Validation 2.0 Specification: https://beanvalidation.org/2.0/spec/
- Hibernate Validator stable reference guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator 9.0 release page: https://hibernate.org/validator/releases/9.0/

---

## 32. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata
- Part 003 — Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse

Part berikutnya:

- Part 004 — Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence
