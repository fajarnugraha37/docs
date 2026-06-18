# Part 8 — Jackson Serialization: Shape Control, Inclusion, Naming, Formatting

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `08-jackson-serialization-shape-control-inclusion-naming-formatting.md`  
> Scope Java: 8 sampai 25  
> Fokus: bagaimana object Java berubah menjadi JSON secara terkendali, aman, kompatibel, dan mudah diuji.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas `ObjectMapper` sebagai komponen infrastruktur: lifecycle, konfigurasi, thread-safety, module, dan profile. Sekarang kita turun satu level ke proses **serialization**, yaitu proses mengubah object Java menjadi JSON.

Banyak developer menganggap serialization hanya ini:

```java
String json = objectMapper.writeValueAsString(response);
```

Secara mekanis benar, tetapi secara engineering belum cukup. Dalam sistem production, JSON response adalah **kontrak publik** atau minimal **kontrak antar boundary**. Begitu field muncul di JSON, consumer bisa mulai bergantung padanya. Begitu field berubah nama, berubah format, berubah dari `null` menjadi absent, atau berubah dari number menjadi string, maka contract bisa pecah.

Bagian ini membahas serialization sebagai proses mengontrol **shape**, **meaning**, **visibility**, **compatibility**, **security**, dan **observability** dari data keluar.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Mendesain JSON output secara eksplisit, bukan hanya mengikuti bentuk class Java.
2. Memahami perbedaan field Java, property Jackson, dan field JSON.
3. Mengontrol nama field, visibility, null policy, ordering, dan formatting.
4. Membedakan `null`, absent, empty, default, dan masked value.
5. Mencegah kebocoran field internal/sensitif.
6. Menulis custom serializer saat annotation tidak cukup.
7. Membuat contract test untuk mencegah perubahan response tidak disengaja.
8. Memahami kapan annotation cukup, kapan perlu DTO berbeda, kapan perlu serializer khusus.

---

## 1. Mental Model: Serialization Bukan Dumping Object

### 1.1 Serialization sebagai Boundary Output

Serialization adalah proses menerjemahkan model internal menjadi bentuk eksternal.

```text
Internal Java Object
        |
        | serialization policy
        v
External JSON Shape
```

Yang penting bukan hanya "object bisa jadi JSON", tetapi:

- field mana yang boleh keluar,
- field mana yang harus disembunyikan,
- nama field apa yang stabil untuk consumer,
- format tanggal/angka/string seperti apa,
- apakah `null` dikirim atau dihilangkan,
- apakah empty list dikirim atau dihilangkan,
- apakah field internal seperti `passwordHash`, `version`, `deleted`, `internalRemark`, `createdByStaffId` bocor,
- apakah shape JSON merepresentasikan kontrak API atau hanya struktur class Java saat ini.

Top 1% engineer tidak memperlakukan serialization sebagai detail teknis kecil. Mereka melihatnya sebagai bagian dari **contract governance**.

---

### 1.2 Object Shape vs JSON Shape

Java object:

```java
public class UserAccount {
    private Long id;
    private String username;
    private String passwordHash;
    private boolean locked;
    private Instant createdAt;
}
```

JSON yang aman untuk public API mungkin:

```json
{
  "id": 1001,
  "username": "fajar",
  "status": "LOCKED",
  "createdAt": "2026-06-17T03:12:20Z"
}
```

Perhatikan:

- `passwordHash` tidak keluar.
- `locked` tidak keluar sebagai boolean mentah, tetapi menjadi `status`.
- `createdAt` punya format kontrak.
- Field Java dan field JSON tidak harus satu banding satu.

Jika kamu membiarkan Jackson men-serialize entity langsung, JSON akan cenderung mengikuti struktur internal, bukan kontrak eksternal.

---

### 1.3 Serialization Pipeline Jackson

Secara konseptual, saat `ObjectMapper.writeValueAsString(obj)` dipanggil, Jackson melakukan:

```text
Object instance
  -> determine runtime type
  -> inspect class / annotations / visibility
  -> discover properties
  -> choose serializers per property type
  -> apply naming strategy
  -> apply inclusion/filter/view rules
  -> write JSON tokens
  -> produce JSON string/bytes/stream
```

Yang bisa kamu kontrol:

- property discovery,
- property name,
- property visibility,
- inclusion policy,
- serializer selection,
- format,
- ordering,
- filtering,
- module behavior,
- fail behavior.

---

## 2. Field Java, Property Jackson, dan Field JSON

### 2.1 Tiga Level yang Sering Tercampur

Ada tiga konsep berbeda:

| Level | Contoh | Penjelasan |
|---|---|---|
| Java field | `private String firstName;` | Storage internal class. |
| Jackson property | property bernama `firstName` | Abstraksi Jackson dari field/getter/setter/record component/annotation. |
| JSON field | `"firstName"` atau `"first_name"` | Nama yang terlihat oleh consumer. |

Kesalahan umum: menganggap field Java otomatis sama dengan kontrak JSON. Padahal Jackson bisa menemukan property dari getter, field, constructor parameter, record component, atau annotation.

---

### 2.2 Getter Bisa Menjadi Property Walau Tidak Ada Field

```java
public class CaseResponse {
    private LocalDate dueDate;

    public LocalDate getDueDate() {
        return dueDate;
    }

    public boolean isOverdue() {
        return dueDate != null && dueDate.isBefore(LocalDate.now());
    }
}
```

JSON bisa menjadi:

```json
{
  "dueDate": "2026-06-17",
  "overdue": false
}
```

`overdue` tidak punya field, tetapi punya getter `isOverdue()`. Ini bisa disengaja, tetapi juga bisa menjadi kebocoran contract jika developer tidak sadar.

Mental model:

> Dalam Jackson, public getter sering dianggap sebagai serializable property.

---

### 2.3 Method Utility Bisa Tidak Sengaja Keluar

```java
public class PaymentDto {
    private BigDecimal amount;
    private BigDecimal tax;

    public BigDecimal getAmount() {
        return amount;
    }

    public BigDecimal getTax() {
        return tax;
    }

    public BigDecimal getTotal() {
        return amount.add(tax);
    }
}
```

`getTotal()` bisa dianggap property `total`.

Ini baik jika memang bagian dari contract. Buruk jika hanya helper internal.

Solusi:

```java
@JsonIgnore
public BigDecimal getTotal() {
    return amount.add(tax);
}
```

Atau lebih baik, buat response DTO eksplisit:

```java
public record PaymentResponse(
    BigDecimal amount,
    BigDecimal tax,
    BigDecimal total
) {}
```

---

## 3. `@JsonProperty`: Mengunci Nama Kontrak

### 3.1 Kapan Menggunakan `@JsonProperty`

Gunakan `@JsonProperty` ketika nama JSON harus stabil dan tidak boleh bergantung pada refactor nama field Java.

```java
public class UserResponse {
    @JsonProperty("user_id")
    private Long id;

    @JsonProperty("display_name")
    private String displayName;
}
```

JSON:

```json
{
  "user_id": 1,
  "display_name": "Fajar"
}
```

Tanpa `@JsonProperty`, rename field Java bisa mengubah response.

---

### 3.2 `@JsonProperty` pada Record

Java 16+ records sangat cocok untuk DTO serialization.

```java
public record UserResponse(
    @JsonProperty("user_id") Long id,
    @JsonProperty("display_name") String displayName
) {}
```

Keunggulan:

- immutable,
- constructor canonical,
- shape eksplisit,
- cocok untuk response DTO,
- mengurangi kebutuhan Lombok.

---

### 3.3 Jangan Terlalu Cepat Mengikuti Nama Database

Contoh buruk:

```json
{
  "USR_ID": 123,
  "USR_NM": "fajar",
  "CRT_DT": "2026-06-17"
}
```

Jika API JSON mengikuti nama kolom database, consumer ikut terikat ke persistence schema.

Lebih baik:

```json
{
  "id": 123,
  "username": "fajar",
  "createdAt": "2026-06-17T10:00:00+07:00"
}
```

Aturan:

> JSON contract harus mengikuti bahasa domain/API, bukan bahasa storage.

---

## 4. Naming Strategy: camelCase, snake_case, kebab-case

### 4.1 Global Naming Strategy

Jackson dapat mengubah nama property secara global.

```java
ObjectMapper mapper = JsonMapper.builder()
    .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
    .build();
```

Class:

```java
public record UserResponse(
    Long userId,
    String displayName,
    Instant createdAt
) {}
```

JSON:

```json
{
  "user_id": 1,
  "display_name": "Fajar",
  "created_at": "2026-06-17T03:00:00Z"
}
```

---

### 4.2 Global Strategy vs Local Annotation

Dua pendekatan:

#### Pendekatan A — Global naming strategy

Cocok jika seluruh API konsisten, misalnya semua response memakai `snake_case`.

#### Pendekatan B — Explicit `@JsonProperty`

Cocok untuk kontrak yang sangat penting, integrasi eksternal, atau field yang tidak mengikuti convention.

Contoh:

```java
public record MyInfoResponse(
    @JsonProperty("uinfin") String uinfin,
    @JsonProperty("regadd") RegisteredAddress registeredAddress
) {}
```

Untuk payload eksternal/legacy, explicit annotation sering lebih aman.

---

### 4.3 Jangan Campur Tanpa Policy

Bahaya:

```java
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UserResponse {
    private String displayName;

    @JsonProperty("createdAt")
    private Instant createdAt;
}
```

Output campuran:

```json
{
  "display_name": "Fajar",
  "createdAt": "2026-06-17T03:00:00Z"
}
```

Bisa valid, tetapi harus disengaja. Jika tidak, itu contract inconsistency.

---

## 5. `@JsonInclude`: Null, Absent, Empty, Default

### 5.1 Kenapa Null Policy Penting

Misalnya API response:

```json
{
  "middleName": null
}
```

berbeda dengan:

```json
{}
```

Bagi consumer:

- `null` bisa berarti field diketahui kosong,
- absent bisa berarti field tidak dikirim, tidak tersedia, tidak diizinkan, atau tidak relevan.

Dalam API evolution, perbedaan ini penting.

---

### 5.2 `Include.ALWAYS`

```java
@JsonInclude(JsonInclude.Include.ALWAYS)
public record UserResponse(
    String firstName,
    String middleName,
    String lastName
) {}
```

Output:

```json
{
  "firstName": "Fajar",
  "middleName": null,
  "lastName": "Nugraha"
}
```

Cocok jika contract ingin semua field selalu terlihat.

Kelebihan:

- schema lebih stabil,
- consumer tahu field memang ada,
- lebih eksplisit.

Kekurangan:

- response lebih besar,
- `null` bisa membingungkan,
- consumer harus handle banyak null.

---

### 5.3 `Include.NON_NULL`

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserResponse(
    String firstName,
    String middleName,
    String lastName
) {}
```

Output:

```json
{
  "firstName": "Fajar",
  "lastName": "Nugraha"
}
```

Cocok untuk response yang ingin ringkas.

Risiko:

- absent bisa disalahartikan,
- consumer tidak tahu apakah field tidak berlaku atau hanya null,
- contract lebih sulit dibedakan antara “belum ada” dan “tidak dikirim”.

---

### 5.4 `Include.NON_EMPTY`

```java
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record CaseResponse(
    String caseNo,
    List<String> tags,
    String remark
) {}
```

Jika `tags = []` dan `remark = ""`, keduanya bisa hilang.

Output:

```json
{
  "caseNo": "CASE-001"
}
```

Risiko besar:

- empty list bisa bermakna “tidak ada item”, bukan “field tidak tersedia”.
- empty string bisa bermakna input sengaja kosong.

Gunakan `NON_EMPTY` hati-hati, terutama untuk public API.

---

### 5.5 `Include.NON_DEFAULT`

```java
@JsonInclude(JsonInclude.Include.NON_DEFAULT)
public class SearchResponse {
    public int total = 0;
    public boolean hasMore = false;
}
```

Default value bisa tidak dikirim.

Risiko:

- `false` hilang,
- `0` hilang,
- consumer bisa keliru membedakan default dengan absent.

Untuk API contract, `NON_DEFAULT` sering terlalu agresif.

---

### 5.6 Policy yang Disarankan

Untuk API enterprise:

| Field Type | Rekomendasi |
|---|---|
| Required scalar | selalu kirim |
| Optional scalar | tentukan null atau absent secara eksplisit |
| Collection | sering lebih baik kirim `[]` daripada absent |
| Boolean | kirim eksplisit `true/false`, jangan hilang karena default |
| Count/amount | kirim `0` jika memang nol |
| Sensitive field | jangan kirim field, bukan kirim `null` kecuali contract mewajibkan |

Rule of thumb:

> Untuk response public, jangan memilih `NON_EMPTY`/`NON_DEFAULT` hanya demi mengurangi ukuran payload. Pilih berdasarkan semantic contract.

---

## 6. Null vs Absent vs Empty: Semantic Matrix

### 6.1 Empat Bentuk Output

Misalnya field `documents`.

| JSON | Makna yang Mungkin |
|---|---|
| `"documents": null` | informasi dokumen tidak tersedia / belum dihitung / tidak berlaku |
| field absent | field tidak termasuk contract response ini / tidak boleh terlihat / tidak diminta |
| `"documents": []` | sudah dihitung dan tidak ada dokumen |
| `"documents": [{...}]` | ada dokumen |

Kalau semua ini dianggap sama, bug akan muncul di UI, integrasi, dan reporting.

---

### 6.2 Contoh Case Management

Response buruk:

```json
{
  "caseId": "C-001"
}
```

Consumer tidak tahu:

- apakah `tasks` tidak ada,
- apakah user tidak punya permission melihat tasks,
- apakah tasks belum diload,
- apakah case memang tidak punya tasks.

Response lebih jelas:

```json
{
  "caseId": "C-001",
  "tasks": [],
  "tasksVisible": true
}
```

Atau jika permission tidak ada:

```json
{
  "caseId": "C-001",
  "tasksVisible": false
}
```

Namun hati-hati: menambahkan `tasksVisible` juga contract baru. Jangan lakukan jika tidak diperlukan.

---

### 6.3 Design Rule

Untuk setiap optional field, tanyakan:

1. Apakah consumer perlu tahu field ini ada tapi kosong?
2. Apakah consumer perlu membedakan tidak ada data vs tidak punya akses?
3. Apakah field ini mahal dihitung sehingga kadang tidak dikirim?
4. Apakah field ini hanya muncul jika query parameter tertentu digunakan?
5. Apakah absent berarti backward compatibility atau security redaction?

---

## 7. `@JsonIgnore`: Menghilangkan Field dari Serialization

### 7.1 Basic Usage

```java
public class UserEntity {
    private Long id;
    private String username;

    @JsonIgnore
    private String passwordHash;
}
```

`passwordHash` tidak keluar.

Tetapi ini bukan alasan untuk men-serialize entity langsung. `@JsonIgnore` bisa membantu, tetapi DTO eksplisit tetap lebih aman untuk API boundary.

---

### 7.2 `@JsonIgnore` pada Getter

```java
@JsonIgnore
public String getInternalRemark() {
    return internalRemark;
}
```

Gunakan ketika property muncul dari getter.

---

### 7.3 `@JsonIgnoreProperties`

```java
@JsonIgnoreProperties({"passwordHash", "internalNote"})
public class UserEntity {
    private String username;
    private String passwordHash;
    private String internalNote;
}
```

Bisa berguna untuk class yang tidak bisa diedit langsung atau untuk mengelompokkan ignore.

Namun jika daftar ignore makin panjang, itu sinyal bahwa model ini salah dipakai sebagai response.

---

### 7.4 `@JsonIgnoreType`

```java
@JsonIgnoreType
public class InternalMetadata {
    private String traceId;
    private String internalNode;
}
```

Semua property bertipe `InternalMetadata` dapat diabaikan.

Gunakan hati-hati karena efeknya luas.

---

### 7.5 Ignore Bukan Security Boundary yang Cukup

Contoh risiko:

```java
public class UserEntity {
    public Long id;
    public String username;
    @JsonIgnore public String passwordHash;
    public String resetToken;
}
```

Developer lupa memberi `@JsonIgnore` pada `resetToken`. Field bocor.

Lebih aman:

```java
public record UserResponse(
    Long id,
    String username
) {}
```

Prinsip:

> Security-sensitive response harus allow-list, bukan deny-list.

DTO response adalah allow-list.

---

## 8. Read-only, Write-only, dan Access Direction

### 8.1 `@JsonProperty(access = ...)`

Jackson mendukung access mode:

```java
public class UserDto {
    private String username;

    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    private String password;
}
```

`password` bisa diterima saat deserialization, tetapi tidak keluar saat serialization.

Untuk response:

```java
public class UserDto {
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    private Long id;
}
```

`id` keluar saat serialization, tetapi tidak dianggap input dari request.

---

### 8.2 Tapi Jangan Terlalu Mengandalkan Satu DTO Dua Arah

Contoh DTO campuran:

```java
public class UserDto {
    private Long id;
    private String username;
    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    private String password;
    private Instant createdAt;
}
```

Ini bisa bekerja, tetapi sering membuat DTO ambiguous:

- request field apa saja?
- response field apa saja?
- field mana yang server-generated?
- field mana yang client-provided?

Lebih baik:

```java
public record CreateUserRequest(
    String username,
    String password
) {}

public record UserResponse(
    Long id,
    String username,
    Instant createdAt
) {}
```

Gunakan access mode untuk kasus terbatas, bukan menggantikan desain DTO.

---

## 9. `@JsonFormat`: Date, Time, Number, Enum Shape

### 9.1 Date/Time Formatting

Java modern harus menggunakan `java.time`, bukan `java.util.Date` untuk DTO baru.

```java
public record CaseResponse(
    String caseNo,
    @JsonFormat(pattern = "yyyy-MM-dd")
    LocalDate dueDate
) {}
```

Output:

```json
{
  "caseNo": "CASE-001",
  "dueDate": "2026-06-30"
}
```

Untuk `Instant`, umumnya ISO-8601 UTC:

```json
"2026-06-17T03:12:20Z"
```

Untuk `OffsetDateTime`, offset ikut keluar:

```json
"2026-06-17T10:12:20+07:00"
```

---

### 9.2 Jangan Sembarangan Menggunakan Timestamp Number

Jackson bisa menulis tanggal sebagai timestamp number jika konfigurasi tidak tepat.

Output seperti ini:

```json
{
  "createdAt": 1781665940000
}
```

lebih sulit dibaca, rawan timezone ambiguity, dan kurang eksplisit.

Untuk API manusia/enterprise, ISO-8601 string biasanya lebih baik.

Konfigurasi umum:

```java
ObjectMapper mapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    .build();
```

---

### 9.3 Timezone Contract

Jangan hanya bertanya “format apa?”, tetapi juga “timezone apa?”.

Pilihan umum:

| Type | Output | Cocok Untuk |
|---|---|---|
| `Instant` | UTC absolute time | audit, event, createdAt |
| `OffsetDateTime` | waktu dengan offset | user-facing timestamp lintas zona |
| `LocalDate` | tanggal tanpa timezone | due date, birth date, effective date |
| `LocalDateTime` | waktu lokal tanpa zona | hati-hati, ambiguous untuk integrasi |

Rule:

> Untuk event/audit, gunakan waktu absolut. Untuk tanggal bisnis, gunakan `LocalDate`. Jangan pakai `LocalDateTime` untuk kejadian global tanpa timezone.

---

### 9.4 Enum Formatting

Default enum serialization:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Output:

```json
"UNDER_REVIEW"
```

Bisa baik jika enum name adalah contract stabil.

Namun jika ingin label berbeda:

```java
public enum CaseStatus {
    DRAFT("draft"),
    SUBMITTED("submitted"),
    UNDER_REVIEW("under_review"),
    APPROVED("approved"),
    REJECTED("rejected");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    @JsonValue
    public String getCode() {
        return code;
    }
}
```

Output:

```json
"under_review"
```

---

### 9.5 Enum sebagai Object

Kadang enum perlu code dan label.

```java
public record StatusResponse(
    String code,
    String label
) {}
```

Output:

```json
{
  "code": "UNDER_REVIEW",
  "label": "Under review"
}
```

Jangan memaksa enum serialization melakukan semua hal. Untuk UI/backoffice, response DTO eksplisit sering lebih baik.

---

## 10. Property Ordering

### 10.1 Kenapa Ordering Penting?

Secara JSON semantic, object field order tidak seharusnya bermakna. Namun ordering bisa membantu:

- readability,
- golden payload test,
- documentation,
- diff review,
- audit/debug payload,
- deterministic snapshot.

---

### 10.2 `@JsonPropertyOrder`

```java
@JsonPropertyOrder({"id", "caseNo", "status", "createdAt", "updatedAt"})
public record CaseResponse(
    Long id,
    String caseNo,
    String status,
    Instant updatedAt,
    Instant createdAt
) {}
```

Output mengikuti urutan:

```json
{
  "id": 1,
  "caseNo": "CASE-001",
  "status": "SUBMITTED",
  "createdAt": "2026-06-17T03:00:00Z",
  "updatedAt": "2026-06-17T04:00:00Z"
}
```

---

### 10.3 Alphabetical Ordering

Global:

```java
ObjectMapper mapper = JsonMapper.builder()
    .enable(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY)
    .build();
```

Cocok untuk deterministic output, tetapi tidak selalu paling manusiawi.

---

## 11. Derived Property dan Virtual Property

### 11.1 Derived Property dari Getter

```java
public class CaseResponse {
    private LocalDate dueDate;

    public LocalDate getDueDate() {
        return dueDate;
    }

    public boolean isOverdue() {
        return dueDate != null && dueDate.isBefore(LocalDate.now());
    }
}
```

Masalah: `LocalDate.now()` membuat output berubah tergantung waktu server. Ini membuat serialization tidak pure dan sulit diuji.

Lebih baik hitung di service/application layer:

```java
public record CaseResponse(
    LocalDate dueDate,
    boolean overdue
) {}
```

Dengan nilai `overdue` dihitung secara eksplisit menggunakan clock yang injectable.

---

### 11.2 `@JsonGetter`

```java
@JsonGetter("displayName")
public String fullName() {
    return firstName + " " + lastName;
}
```

Bisa digunakan untuk property turunan.

Namun hati-hati:

- jangan melakukan query database,
- jangan call external service,
- jangan melakukan logic mahal,
- jangan bergantung pada global mutable state,
- jangan memasukkan authorization logic tersembunyi.

---

### 11.3 Virtual Property dengan Custom Serializer

Jika property bergantung pada context serialization, custom serializer bisa lebih tepat. Namun ini masuk kategori advanced dan harus dipakai selektif.

Rule:

> Derived field yang merupakan bagian contract boleh ada. Derived field yang butuh policy kompleks sebaiknya dibuat sebelum serialization, bukan saat serialization.

---

## 12. Sensitive Data Masking

### 12.1 Jangan Bingung Antara Hide dan Mask

Ada dua aksi berbeda:

| Aksi | Output | Makna |
|---|---|---|
| Hide | field tidak ada | consumer tidak boleh tahu / tidak relevan |
| Mask | field ada tapi disamarkan | consumer boleh tahu keberadaan/nilai parsial |

Contoh hide:

```json
{
  "username": "fajar"
}
```

Contoh mask:

```json
{
  "email": "fa***@example.com"
}
```

---

### 12.2 Masking di DTO Lebih Eksplisit

```java
public record UserProfileResponse(
    String displayName,
    String maskedEmail,
    String maskedMobileNo
) {}
```

Kelebihan:

- jelas di contract,
- mudah dites,
- tidak bergantung magic serializer,
- mudah direview security.

---

### 12.3 Custom Annotation untuk Masking

Untuk banyak field, bisa buat annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.METHOD, ElementType.RECORD_COMPONENT})
public @interface Masked {
    MaskingType value();
}
```

```java
public enum MaskingType {
    EMAIL,
    MOBILE,
    NRIC,
    GENERIC
}
```

Lalu custom serializer contextual. Ini lebih advanced, tetapi bisa berguna untuk enterprise systems.

Namun jangan membuat masking terlalu magic. Security reviewer harus bisa memahami field mana yang dimask.

---

### 12.4 Contoh Serializer Masking Sederhana

```java
public final class MaskingSerializer extends JsonSerializer<String> {
    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }
        gen.writeString(mask(value));
    }

    private String mask(String value) {
        if (value.length() <= 2) {
            return "**";
        }
        return value.charAt(0) + "***" + value.charAt(value.length() - 1);
    }
}
```

Usage:

```java
public record UserResponse(
    String username,
    @JsonSerialize(using = MaskingSerializer.class)
    String email
) {}
```

Catatan: ini masking sederhana. Untuk email/phone/identifier, buat algoritma masking spesifik domain.

---

## 13. Custom Serializer

### 13.1 Kapan Annotation Tidak Cukup?

Gunakan custom serializer jika:

- output shape tidak 1:1 dengan object field,
- format membutuhkan logic khusus,
- type milik library eksternal tidak bisa diubah,
- butuh context-aware formatting,
- ada type value object domain yang ingin punya JSON representation stabil.

Jangan gunakan custom serializer untuk:

- menggantikan DTO mapping,
- menyembunyikan business logic,
- query database,
- authorization kompleks,
- dynamic response yang seharusnya ditangani service layer.

---

### 13.2 Value Object Serializer

Misalnya domain punya value object:

```java
public final class Money {
    private final BigDecimal amount;
    private final String currency;

    public Money(BigDecimal amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }

    public BigDecimal amount() {
        return amount;
    }

    public String currency() {
        return currency;
    }
}
```

Ingin JSON:

```json
{
  "amount": "123.45",
  "currency": "SGD"
}
```

Serializer:

```java
public final class MoneySerializer extends JsonSerializer<Money> {
    @Override
    public void serialize(Money value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }

        gen.writeStartObject();
        gen.writeStringField("amount", value.amount().toPlainString());
        gen.writeStringField("currency", value.currency());
        gen.writeEndObject();
    }
}
```

Usage:

```java
public record InvoiceResponse(
    String invoiceNo,
    @JsonSerialize(using = MoneySerializer.class)
    Money total
) {}
```

---

### 13.3 Module Registration Lebih Baik dari Annotation Tersebar

Jika `Money` selalu punya JSON shape sama, register serializer melalui module:

```java
SimpleModule moneyModule = new SimpleModule("MoneyModule");
moneyModule.addSerializer(Money.class, new MoneySerializer());

ObjectMapper mapper = JsonMapper.builder()
    .addModule(moneyModule)
    .build();
```

Kelebihan:

- policy terpusat,
- tidak perlu annotation di banyak DTO,
- konsisten lintas aplikasi.

Kekurangan:

- efek global pada mapper tersebut,
- harus hati-hati jika boundary berbeda butuh format berbeda.

---

### 13.4 Boundary-Specific Serializer

Kadang type sama harus berbeda shape di boundary berbeda.

Public API:

```json
{
  "amount": "123.45",
  "currency": "SGD"
}
```

Legacy integration:

```json
{
  "amt": 12345,
  "ccy": "SGD"
}
```

Jangan pakai satu global serializer untuk semua boundary. Gunakan:

- DTO berbeda,
- ObjectMapper profile berbeda,
- serializer module berbeda,
- explicit adapter mapping.

---

## 14. Contextual Serializer

### 14.1 Problem: Serializer Butuh Metadata Field

Misalnya masking tergantung annotation field:

```java
public record PersonResponse(
    @Masked(MaskingType.EMAIL)
    String email,

    @Masked(MaskingType.MOBILE)
    String mobileNo
) {}
```

Serializer butuh tahu annotation di property. Ini disebut contextual serialization.

---

### 14.2 Contoh Contextual Serializer

```java
public final class ContextualMaskingSerializer
        extends JsonSerializer<String>
        implements ContextualSerializer {

    private final MaskingType maskingType;

    public ContextualMaskingSerializer() {
        this.maskingType = MaskingType.GENERIC;
    }

    private ContextualMaskingSerializer(MaskingType maskingType) {
        this.maskingType = maskingType;
    }

    @Override
    public JsonSerializer<?> createContextual(
            SerializerProvider prov,
            BeanProperty property
    ) {
        if (property == null) {
            return this;
        }

        Masked annotation = property.getAnnotation(Masked.class);
        if (annotation == null) {
            annotation = property.getContextAnnotation(Masked.class);
        }

        if (annotation == null) {
            return this;
        }

        return new ContextualMaskingSerializer(annotation.value());
    }

    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }
        gen.writeString(mask(value, maskingType));
    }

    private String mask(String value, MaskingType type) {
        switch (type) {
            case EMAIL:
                return maskEmail(value);
            case MOBILE:
                return maskMobile(value);
            case NRIC:
                return maskNric(value);
            default:
                return "***";
        }
    }

    private String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }

    private String maskMobile(String mobile) {
        if (mobile.length() < 4) {
            return "****";
        }
        return "****" + mobile.substring(mobile.length() - 4);
    }

    private String maskNric(String nric) {
        if (nric.length() < 4) {
            return "****";
        }
        return "*****" + nric.substring(nric.length() - 4);
    }
}
```

Usage:

```java
public record PersonResponse(
    @JsonSerialize(using = ContextualMaskingSerializer.class)
    @Masked(MaskingType.EMAIL)
    String email,

    @JsonSerialize(using = ContextualMaskingSerializer.class)
    @Masked(MaskingType.MOBILE)
    String mobileNo
) {}
```

---

### 14.3 Review Checklist untuk Contextual Serializer

Sebelum menggunakan contextual serializer, tanyakan:

1. Apakah logic ini benar-benar serialization concern?
2. Apakah output deterministic?
3. Apakah tidak ada external I/O?
4. Apakah field tanpa annotation punya default aman?
5. Apakah serializer sudah dites untuk null, empty, invalid format?
6. Apakah security reviewer bisa memahami policy-nya?
7. Apakah ada kemungkinan boundary lain butuh policy berbeda?

---

## 15. JSON Views

### 15.1 Konsep `@JsonView`

`@JsonView` memungkinkan field berbeda keluar untuk view berbeda.

```java
public class Views {
    public interface Public {}
    public interface Internal extends Public {}
}
```

```java
public class UserResponse {
    @JsonView(Views.Public.class)
    public String username;

    @JsonView(Views.Internal.class)
    public String internalRemark;
}
```

Serialization:

```java
String publicJson = mapper
    .writerWithView(Views.Public.class)
    .writeValueAsString(user);

String internalJson = mapper
    .writerWithView(Views.Internal.class)
    .writeValueAsString(user);
```

---

### 15.2 Kapan `@JsonView` Berguna?

Berguna untuk:

- admin vs public view sederhana,
- debug/internal endpoint,
- same object dengan variasi field minor.

Namun untuk API besar, DTO berbeda sering lebih jelas.

---

### 15.3 Risiko `@JsonView`

- sulit dilihat shape final tanpa menjalankan serialization,
- annotation tersebar,
- mudah salah view,
- security tergantung pemilihan writer yang benar,
- contract documentation lebih sulit.

Rule:

> Gunakan `@JsonView` untuk variasi ringan. Untuk boundary penting, gunakan DTO eksplisit.

---

## 16. Dynamic Filtering

### 16.1 `@JsonFilter`

Jackson dapat filter field runtime.

```java
@JsonFilter("caseFilter")
public class CaseResponse {
    public String caseNo;
    public String status;
    public String internalRemark;
}
```

```java
FilterProvider filters = new SimpleFilterProvider()
    .addFilter("caseFilter",
        SimpleBeanPropertyFilter.serializeAllExcept("internalRemark"));

String json = mapper.writer(filters).writeValueAsString(response);
```

---

### 16.2 Kapan Dynamic Filter Cocok?

- field selection API,
- export dengan kolom dinamis,
- admin/reporting tool,
- internal diagnostic payload.

Untuk public security-sensitive API, dynamic filter harus hati-hati.

---

### 16.3 Risiko Dynamic Filter

- output shape terlalu dinamis,
- sulit didokumentasikan,
- sulit dites semua kombinasi,
- bisa membuka field sensitif jika allow-list salah,
- consumer menjadi bergantung pada query field selection.

Jika perlu dynamic fields, lebih aman menggunakan allow-list eksplisit:

```java
Set<String> allowedFields = Set.of("caseNo", "status", "createdAt");
Set<String> requestedFields = parseRequestedFields(request);
Set<String> selectedFields = intersection(allowedFields, requestedFields);
```

---

## 17. `@JsonAnyGetter`: Dynamic Properties

### 17.1 Contoh

```java
public class FlexibleResponse {
    private String id;
    private Map<String, Object> attributes = new LinkedHashMap<>();

    public String getId() {
        return id;
    }

    @JsonAnyGetter
    public Map<String, Object> getAttributes() {
        return attributes;
    }
}
```

Output:

```json
{
  "id": "A-001",
  "color": "red",
  "size": "large"
}
```

---

### 17.2 Kapan Berguna?

- metadata extensibility,
- custom fields,
- schema-less attributes,
- integration payload yang fleksibel.

---

### 17.3 Risiko

- collision dengan field tetap,
- field tidak terdokumentasi,
- type tidak stabil,
- security leakage,
- consumer sulit contract-test.

Lebih aman:

```json
{
  "id": "A-001",
  "attributes": {
    "color": "red",
    "size": "large"
  }
}
```

Daripada flatten dynamic fields ke root.

---

## 18. `@JsonRawValue`: Raw JSON Injection yang Harus Hati-Hati

### 18.1 Contoh

```java
public class RawPayloadResponse {
    public String id;

    @JsonRawValue
    public String rawJson;
}
```

Jika:

```java
rawJson = "{\"source\":\"legacy\"}";
```

Output:

```json
{
  "id": "1",
  "rawJson": {"source":"legacy"}
}
```

---

### 18.2 Risiko

`@JsonRawValue` memasukkan string sebagai JSON mentah. Jika value tidak trusted, bisa menghasilkan output invalid atau membuka injection-like problem.

Gunakan hanya jika:

- raw JSON berasal dari trusted internal source,
- sudah divalidasi sebagai JSON,
- memang perlu preserve raw JSON,
- ada test invalid JSON.

Lebih aman gunakan `JsonNode`:

```java
public record PayloadResponse(
    String id,
    JsonNode rawJson
) {}
```

---

## 19. `JsonNode` sebagai Output Shape

### 19.1 Kapan Menggunakan `JsonNode`

`JsonNode` berguna untuk:

- dynamic payload,
- partial transformation,
- proxying JSON,
- preserving external payload,
- manipulating JSON tree.

Contoh:

```java
ObjectNode root = mapper.createObjectNode();
root.put("caseNo", "CASE-001");
root.put("status", "SUBMITTED");

ArrayNode tags = root.putArray("tags");
tags.add("urgent");
tags.add("licensing");
```

Output:

```json
{
  "caseNo": "CASE-001",
  "status": "SUBMITTED",
  "tags": ["urgent", "licensing"]
}
```

---

### 19.2 DTO vs JsonNode

| Approach | Cocok Untuk | Risiko |
|---|---|---|
| DTO | kontrak stabil | perlu class tambahan |
| JsonNode | dynamic/partial JSON | type safety rendah |
| Map<String,Object> | cepat/prototype | rawan shape drift |

Rule:

> Gunakan DTO untuk contract stabil. Gunakan `JsonNode` untuk dynamic atau intermediary JSON. Hindari `Map<String,Object>` sebagai public contract kecuali benar-benar diperlukan.

---

## 20. Map Serialization

### 20.1 Map Key Selalu JSON Object Field Name

```java
Map<String, Integer> counts = Map.of(
    "open", 10,
    "closed", 5
);
```

JSON:

```json
{
  "open": 10,
  "closed": 5
}
```

Jika key bukan string, Jackson perlu mengubahnya menjadi string.

---

### 20.2 Risiko Map sebagai API Contract

```java
public record ReportResponse(
    Map<String, Object> data
) {}
```

Masalah:

- schema tidak jelas,
- type value tidak jelas,
- field bisa berubah tanpa compile error,
- consumer sulit generate client,
- documentation lemah.

Gunakan Map untuk:

- dynamic attributes,
- aggregation by code,
- localization map,
- metrics map,
- extension point.

Tetapi jangan jadikan Map sebagai pengganti DTO.

---

### 20.3 Deterministic Ordering Map

Untuk output stabil:

```java
Map<String, Object> data = new LinkedHashMap<>();
data.put("caseNo", "CASE-001");
data.put("status", "SUBMITTED");
```

Atau sorted:

```java
Map<String, Object> data = new TreeMap<>();
```

---

## 21. Collection Serialization

### 21.1 Empty List vs Null List

```java
public record SearchResponse(
    List<CaseSummary> items,
    int total
) {}
```

Lebih baik:

```json
{
  "items": [],
  "total": 0
}
```

Daripada:

```json
{
  "items": null,
  "total": 0
}
```

Untuk response collection, empty list biasanya lebih consumer-friendly.

---

### 21.2 Jangan Mengembalikan Null Collection dari DTO

```java
public record SearchResponse(
    List<CaseSummary> items,
    int total
) {
    public SearchResponse {
        items = items == null ? List.of() : List.copyOf(items);
    }
}
```

Untuk Java 8:

```java
public final class SearchResponse {
    private final List<CaseSummary> items;
    private final int total;

    public SearchResponse(List<CaseSummary> items, int total) {
        this.items = items == null
            ? Collections.emptyList()
            : Collections.unmodifiableList(new ArrayList<>(items));
        this.total = total;
    }

    public List<CaseSummary> getItems() {
        return items;
    }

    public int getTotal() {
        return total;
    }
}
```

---

### 21.3 Large Collection Warning

Serialization collection besar bisa menyebabkan:

- memory pressure,
- long response time,
- network bottleneck,
- client crash,
- timeout,
- GC pressure.

Jangan biarkan endpoint serialize ribuan/ jutaan record tanpa pagination/streaming.

---

## 22. BigDecimal, Money, dan Numeric Contract

### 22.1 BigDecimal sebagai Number vs String

BigDecimal default sering keluar sebagai JSON number:

```json
{
  "amount": 123.45
}
```

Namun untuk uang/precision-sensitive data, beberapa sistem memilih string:

```json
{
  "amount": "123.45"
}
```

Alasannya: JavaScript number adalah double precision, sehingga angka desimal besar/presisi bisa bermasalah.

---

### 22.2 Jangan Menggunakan Double untuk Money

Buruk:

```java
public record InvoiceResponse(
    double amount
) {}
```

Lebih baik:

```java
public record InvoiceResponse(
    BigDecimal amount,
    String currency
) {}
```

Atau:

```java
public record MoneyResponse(
    String amount,
    String currency
) {}
```

---

### 22.3 Scientific Notation

BigDecimal bisa keluar dalam scientific notation tergantung penggunaan.

Untuk string stabil:

```java
amount.toPlainString()
```

Custom serializer bisa memastikan format.

---

## 23. Boolean Serialization

### 23.1 Getter `isX` dan Property Name

```java
public class FeatureResponse {
    private boolean active;

    public boolean isActive() {
        return active;
    }
}
```

JSON:

```json
{
  "active": true
}
```

---

### 23.2 Boolean Field dengan Prefix `is`

```java
public class FeatureResponse {
    private boolean isActive;

    public boolean isActive() {
        return isActive;
    }
}
```

Jackson property bisa menjadi `active`, bukan `isActive`, tergantung accessor.

Untuk mengunci contract:

```java
@JsonProperty("isActive")
public boolean isActive() {
    return isActive;
}
```

Atau gunakan record:

```java
public record FeatureResponse(
    @JsonProperty("isActive") boolean active
) {}
```

---

### 23.3 Jangan Hilangkan Boolean False

Jika menggunakan `NON_DEFAULT`, `false` bisa hilang.

Response:

```json
{}
```

Consumer tidak tahu apakah false, tidak tersedia, atau field tidak didukung.

Untuk boolean contract, kirim eksplisit kecuali ada alasan kuat.

---

## 24. Serialization of Java 8 sampai 25 Types

### 24.1 Java 8

Java 8 memperkenalkan:

- `Optional`,
- `java.time`,
- lambda tidak langsung relevan,
- default methods.

Untuk Jackson:

- register `JavaTimeModule` untuk `java.time`,
- register `Jdk8Module` untuk Optional jika diperlukan.

Namun jangan jadikan `Optional` field DTO sembarangan.

---

### 24.2 Java 14/16+ Records

Records sangat cocok untuk response DTO.

```java
public record CaseResponse(
    String caseNo,
    String status,
    Instant createdAt
) {}
```

Keuntungan:

- immutable by default,
- concise,
- shape eksplisit,
- constructor canonical,
- less Lombok.

Namun record component names menjadi bagian penting serialization contract jika tidak memakai `@JsonProperty`/naming strategy.

---

### 24.3 Java 17+ Sealed Types

Sealed type dapat menjadi model polymorphic response.

```java
public sealed interface PaymentMethodResponse
    permits CardPaymentResponse, BankTransferResponse {}

public record CardPaymentResponse(String last4) implements PaymentMethodResponse {}
public record BankTransferResponse(String bankCode) implements PaymentMethodResponse {}
```

JSON polymorphism butuh discriminator jika consumer perlu tahu subtype.

Ini akan dibahas lebih detail di part polymorphism.

---

### 24.4 Java 21/25 Modern DTO Direction

Untuk Java modern:

- gunakan records untuk simple immutable DTO,
- gunakan class jika butuh lifecycle/compatibility/complex builder,
- gunakan sealed type untuk finite polymorphic model,
- kurangi Lombok untuk DTO baru bila records cukup,
- tetap explicit terhadap JSON contract.

---

## 25. Annotation Placement: Field, Getter, Constructor, Record Component

### 25.1 Field Annotation

```java
public class UserResponse {
    @JsonProperty("display_name")
    private String displayName;
}
```

Cocok untuk mutable bean.

---

### 25.2 Getter Annotation

```java
@JsonProperty("display_name")
public String getDisplayName() {
    return displayName;
}
```

Cocok jika property berasal dari getter atau ingin kontrol accessor.

---

### 25.3 Record Component Annotation

```java
public record UserResponse(
    @JsonProperty("display_name") String displayName
) {}
```

Cocok untuk modern DTO.

---

### 25.4 Jangan Campur Tanpa Kebutuhan

Jika annotation ada di field dan getter dengan nama berbeda, hasil bisa membingungkan.

```java
public class UserResponse {
    @JsonProperty("display_name")
    private String displayName;

    @JsonProperty("name")
    public String getDisplayName() {
        return displayName;
    }
}
```

Hindari pola seperti ini kecuali paham penuh introspection behavior.

---

## 26. Mixin: Mengubah Serialization Tanpa Mengubah Class

### 26.1 Kapan Mixin Berguna?

Jika class berasal dari library eksternal atau domain model yang tidak boleh diberi annotation Jackson, gunakan mixin.

Class eksternal:

```java
public class ExternalUser {
    public String id;
    public String name;
    public String secret;
}
```

Mixin:

```java
abstract class ExternalUserMixin {
    @JsonIgnore
    public String secret;
}
```

Registration:

```java
ObjectMapper mapper = JsonMapper.builder()
    .addMixIn(ExternalUser.class, ExternalUserMixin.class)
    .build();
```

---

### 26.2 Kelebihan dan Risiko

Kelebihan:

- tidak mengubah source class,
- policy bisa per ObjectMapper,
- cocok untuk library/legacy type.

Risiko:

- behavior tersembunyi dari class,
- sulit dilacak,
- perlu dokumentasi kuat,
- bisa berbeda antar mapper.

Rule:

> Mixin adalah adapter-level customization, bukan default style untuk DTO internal.

---

## 27. Serialization dan JPA Entity: Jangan Langsung

### 27.1 Masalah Entity Serialization

Jika serialize JPA entity langsung:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Risiko:

- lazy loading tidak terkendali,
- N+1 query saat serialization,
- infinite recursion pada bidirectional relationship,
- field internal bocor,
- persistence model menjadi API contract,
- perubahan entity memecah API,
- audit/version/deleted fields bocor,
- security annotation harus deny-list.

---

### 27.2 DTO sebagai Output Boundary

```java
@GetMapping("/cases/{id}")
public CaseResponse getCase(@PathVariable Long id) {
    CaseEntity entity = caseService.getCase(id);
    return caseMapper.toResponse(entity);
}
```

```java
public record CaseResponse(
    Long id,
    String caseNo,
    String status,
    Instant createdAt
) {}
```

DTO membuat output menjadi allow-list.

---

### 27.3 Annotation seperti `@JsonManagedReference` Bukan Solusi Arsitektural

Jackson punya annotation untuk cycle:

- `@JsonManagedReference`,
- `@JsonBackReference`,
- `@JsonIdentityInfo`.

Ini bisa berguna untuk object graph tertentu, tetapi untuk API enterprise biasanya lebih baik mendesain DTO response yang tidak mengekspos graph entity penuh.

---

## 28. Serialization Profiles per Boundary

### 28.1 Satu ObjectMapper Tidak Selalu Cukup

Boundary berbeda bisa butuh profile berbeda:

| Boundary | Serialization Profile |
|---|---|
| Public REST API | strict, stable, safe, ISO date |
| Internal service API | stable but may include internal codes |
| Audit log | preserve raw values, include nulls, deterministic |
| External legacy integration | legacy names/formats |
| Cache | compact, internal-only, versioned |
| Event payload | backward compatible, immutable schema |

---

### 28.2 Contoh Profile

```java
public final class JsonMappers {
    public static ObjectMapper publicApiMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .serializationInclusion(JsonInclude.Include.NON_NULL)
            .build();
    }

    public static ObjectMapper auditMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .serializationInclusion(JsonInclude.Include.ALWAYS)
            .enable(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY)
            .build();
    }
}
```

Catatan: di Spring Boot, biasanya ObjectMapper dikelola container. Untuk profile berbeda, gunakan bean bernama khusus atau `ObjectWriter` khusus.

---

## 29. Serialization Error Handling

### 29.1 Serialization Bisa Gagal

Banyak orang mengira serialization selalu berhasil. Faktanya bisa gagal karena:

- type tidak punya serializer,
- lazy proxy bermasalah,
- getter throw exception,
- circular reference,
- custom serializer bug,
- invalid object state,
- unsupported date/time module,
- IO error saat menulis stream.

---

### 29.2 Getter Throw Exception

```java
public String getDisplayName() {
    if (firstName == null) {
        throw new IllegalStateException("firstName is required");
    }
    return firstName + " " + lastName;
}
```

Saat serialization, exception keluar sebagai serialization failure.

Lebih baik pastikan DTO sudah valid sebelum serialization.

---

### 29.3 Fail Fast di Test, Safe di Runtime

Di test:

- assert semua DTO bisa diserialize,
- assert output shape,
- assert no sensitive fields,
- assert no unexpected null omission.

Di runtime:

- jangan expose stacktrace,
- log correlation id,
- log type DTO yang gagal,
- jangan log full payload sensitif,
- fallback error response harus aman.

---

## 30. Contract Testing untuk Serialization

### 30.1 Kenapa Test Shape JSON?

Refactor kecil bisa mengubah response:

- rename field Java,
- tambah getter,
- ubah annotation,
- ubah ObjectMapper global,
- upgrade Jackson,
- ubah Lombok/record/class,
- ubah inclusion policy.

Tanpa contract test, perubahan ini bisa lolos.

---

### 30.2 Assert JSON Field

```java
class UserResponseSerializationTest {
    private final ObjectMapper mapper = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .build();

    @Test
    void serializesExpectedShape() throws Exception {
        UserResponse response = new UserResponse(
            1L,
            "fajar",
            Instant.parse("2026-06-17T03:00:00Z")
        );

        String json = mapper.writeValueAsString(response);
        JsonNode node = mapper.readTree(json);

        assertEquals(1L, node.get("id").asLong());
        assertEquals("fajar", node.get("username").asText());
        assertEquals("2026-06-17T03:00:00Z", node.get("createdAt").asText());
    }
}
```

---

### 30.3 Assert Field Tidak Ada

```java
@Test
void doesNotExposeSensitiveFields() throws Exception {
    UserResponse response = new UserResponse(
        1L,
        "fajar",
        "secret-hash"
    );

    JsonNode node = mapper.readTree(mapper.writeValueAsString(response));

    assertFalse(node.has("password"));
    assertFalse(node.has("passwordHash"));
    assertFalse(node.has("resetToken"));
}
```

Test field tidak ada sama pentingnya dengan field ada.

---

### 30.4 Golden Payload Test

```java
@Test
void matchesGoldenPayload() throws Exception {
    CaseResponse response = new CaseResponse(
        "CASE-001",
        "SUBMITTED",
        Instant.parse("2026-06-17T03:00:00Z")
    );

    String actual = mapper.writerWithDefaultPrettyPrinter()
        .writeValueAsString(response);

    String expected = Files.readString(
        Path.of("src/test/resources/golden/case-response.json")
    );

    assertEquals(
        mapper.readTree(expected),
        mapper.readTree(actual)
    );
}
```

Gunakan `JsonNode` comparison agar tidak sensitif terhadap whitespace/order, kecuali order memang ingin dites.

---

### 30.5 Snapshot Test Trade-off

Snapshot/golden file berguna, tetapi bisa menjadi noise jika developer asal update snapshot.

Policy yang baik:

- perubahan golden payload harus direview sebagai API contract change,
- PR harus menjelaskan field apa berubah,
- breaking/non-breaking harus dikategorikan,
- sensitive field regression harus otomatis fail.

---

## 31. OpenAPI dan Serialization Reality

### 31.1 OpenAPI Bisa Bohong Jika Runtime Berbeda

OpenAPI mungkin menyatakan:

```yaml
middleName:
  type: string
  nullable: true
```

Tetapi runtime dengan `NON_NULL` membuat field hilang.

Atau OpenAPI menyatakan date-time, tetapi runtime mengirim timestamp number.

Jadi, contract bukan hanya dokumen. Contract adalah kombinasi:

```text
DTO shape + Jackson annotations + ObjectMapper config + runtime modules + tests
```

---

### 31.2 Align Schema dan Runtime

Checklist:

- Apakah nullable di OpenAPI sesuai inclusion policy?
- Apakah date format sesuai runtime?
- Apakah enum values sesuai output?
- Apakah field read-only/write-only sesuai DTO?
- Apakah sensitive fields tidak muncul di schema?
- Apakah examples berasal dari actual serialization test?
- Apakah generated clients bisa membaca output real?

---

## 32. Common Anti-Patterns

### 32.1 Entity as API Response

```java
return userRepository.findById(id).orElseThrow();
```

Masalah:

- internal structure bocor,
- lazy loading,
- cycle,
- version drift,
- security field leak.

Solusi: DTO response eksplisit.

---

### 32.2 `@JsonIgnore` Everywhere

Jika class penuh ignore:

```java
@JsonIgnoreProperties({
    "passwordHash",
    "resetToken",
    "internalNote",
    "deleted",
    "version",
    "createdBy",
    "updatedBy"
})
```

Itu tanda class salah digunakan sebagai output.

---

### 32.3 Global `NON_NULL` Tanpa Semantic Policy

Global `NON_NULL` bisa membuat response ringkas, tetapi semantic absent menjadi kabur.

Solusi: pilih inclusion per boundary atau per DTO berdasarkan contract.

---

### 32.4 Getter dengan Side Effect

```java
public int getTotalItems() {
    return itemRepository.countByCaseId(caseId);
}
```

Ini sangat buruk. Serialization tidak boleh query database.

---

### 32.5 Map<String,Object> untuk Semua Response

Cepat di awal, mahal di masa depan.

Masalah:

- tidak type-safe,
- tidak self-documenting,
- mudah drift,
- sulit test,
- sulit generate schema.

---

### 32.6 Custom Serializer Berisi Business Logic

Serializer harus formatting/shape concern, bukan business decision engine.

Buruk:

```java
if (currentUser.hasRole("ADMIN")) {
    gen.writeStringField("internalRemark", value.getInternalRemark());
}
```

Authorization harus terjadi sebelum DTO dibangun atau melalui explicit view boundary yang sangat terkontrol.

---

## 33. Practical Design Patterns

### 33.1 Explicit Response DTO Pattern

```java
public record CaseDetailResponse(
    String caseNo,
    String status,
    LocalDate submittedDate,
    List<DocumentSummaryResponse> documents
) {
    public CaseDetailResponse {
        documents = documents == null ? List.of() : List.copyOf(documents);
    }
}
```

Karakteristik:

- immutable,
- collection non-null,
- shape jelas,
- aman dari field internal.

---

### 33.2 Boundary Mapper + Response DTO

```java
public final class CaseResponseMapper {
    private CaseResponseMapper() {}

    public static CaseDetailResponse toDetailResponse(CaseEntity entity) {
        return new CaseDetailResponse(
            entity.getCaseNo(),
            entity.getStatus().name(),
            entity.getSubmittedDate(),
            entity.getDocuments().stream()
                .map(CaseResponseMapper::toDocumentSummary)
                .toList()
        );
    }

    private static DocumentSummaryResponse toDocumentSummary(DocumentEntity document) {
        return new DocumentSummaryResponse(
            document.getId(),
            document.getFilename(),
            document.getUploadedAt()
        );
    }
}
```

Untuk Java 8, ganti `.toList()` dengan `collect(Collectors.toList())`.

---

### 33.3 Serializer untuk Value Object Stabil

Jika `Money`, `CaseNo`, `PostalCode`, `EmailAddress` adalah value object, serializer bisa menjaga representation stabil.

Namun jika representation berbeda per API, gunakan DTO mapper.

---

### 33.4 Golden Contract Test Pattern

Setiap response DTO penting punya:

- example object builder,
- serialization test,
- sensitive field absence test,
- null/empty policy test,
- date/time format test,
- enum output test.

---

## 34. Decision Framework: Annotation, DTO, Serializer, atau Mapper?

### 34.1 Pilih Annotation Jika...

- perubahan hanya nama field,
- format sederhana,
- inclusion sederhana,
- ignore field minor,
- contract masih satu boundary,
- tidak ada logic kompleks.

Contoh:

```java
public record UserResponse(
    @JsonProperty("display_name") String displayName
) {}
```

---

### 34.2 Pilih DTO Berbeda Jika...

- request dan response berbeda,
- public dan internal berbeda,
- permission memengaruhi field,
- entity punya field internal,
- shape berbeda dari domain model,
- boundary berbeda punya semantic berbeda.

DTO adalah pilihan default untuk API production.

---

### 34.3 Pilih Custom Serializer Jika...

- type value object butuh representation konsisten,
- class eksternal tidak bisa diubah,
- format tidak bisa dicapai annotation,
- butuh contextual formatting sederhana,
- output masih murni serialization concern.

---

### 34.4 Pilih Mapper Jika...

- transformasi butuh semantic conversion,
- field digabung/dipecah,
- perlu redaction/enrichment eksplisit,
- data berasal dari beberapa source,
- ingin keep serializer dumb,
- ingin contract test mudah.

---

## 35. Checklist Production Serialization

Gunakan checklist ini saat review response DTO/API.

### 35.1 Shape

- Apakah semua field yang keluar memang bagian dari contract?
- Apakah ada getter yang tidak sengaja menjadi field JSON?
- Apakah nama field stabil terhadap refactor Java?
- Apakah naming strategy konsisten?
- Apakah field order perlu deterministic?

### 35.2 Null/Absent/Empty

- Apakah `null` punya makna jelas?
- Apakah absent punya makna jelas?
- Apakah empty list harus dikirim sebagai `[]`?
- Apakah boolean false tidak hilang?
- Apakah zero amount/count tidak hilang?

### 35.3 Security

- Apakah field internal/sensitif tidak keluar?
- Apakah response menggunakan allow-list DTO?
- Apakah masking benar-benar masking, bukan accidental exposure?
- Apakah exception serialization tidak membocorkan payload?
- Apakah dynamic fields punya allow-list?

### 35.4 Compatibility

- Apakah perubahan field backward compatible?
- Apakah enum values stabil?
- Apakah date/time format stabil?
- Apakah OpenAPI sesuai runtime?
- Apakah golden payload test ada?

### 35.5 Performance

- Apakah response collection dipaginasi?
- Apakah serialization tidak memicu lazy loading/N+1?
- Apakah getter tidak melakukan expensive computation?
- Apakah custom serializer tidak melakukan I/O?
- Apakah large payload perlu streaming?

---

## 36. Mini Case Study: Case Management Response

### 36.1 Bad Design

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Entity:

```java
public class CaseEntity {
    private Long id;
    private String caseNo;
    private CaseStatus status;
    private String internalRemark;
    private String officerNote;
    private boolean deleted;
    private Long version;
    private List<DocumentEntity> documents;
    private UserEntity assignedOfficer;
}
```

Risiko:

- `internalRemark` bocor,
- `officerNote` bocor,
- `deleted/version` bocor,
- `documents` lazy loaded,
- `assignedOfficer` membawa graph user,
- cycle mungkin terjadi,
- API contract berubah saat entity berubah.

---

### 36.2 Better Design

```java
public record CaseDetailResponse(
    String caseNo,
    String status,
    LocalDate submittedDate,
    String assignedOfficerName,
    List<DocumentSummaryResponse> documents
) {
    public CaseDetailResponse {
        documents = documents == null ? List.of() : List.copyOf(documents);
    }
}

public record DocumentSummaryResponse(
    String documentId,
    String filename,
    Instant uploadedAt
) {}
```

Mapper:

```java
public final class CaseDetailResponseMapper {
    private CaseDetailResponseMapper() {}

    public static CaseDetailResponse from(CaseEntity entity) {
        return new CaseDetailResponse(
            entity.getCaseNo(),
            entity.getStatus().name(),
            entity.getSubmittedDate(),
            entity.getAssignedOfficer() == null
                ? null
                : entity.getAssignedOfficer().getDisplayName(),
            mapDocuments(entity.getDocuments())
        );
    }

    private static List<DocumentSummaryResponse> mapDocuments(List<DocumentEntity> documents) {
        if (documents == null || documents.isEmpty()) {
            return List.of();
        }
        return documents.stream()
            .map(document -> new DocumentSummaryResponse(
                document.getPublicId(),
                document.getFilename(),
                document.getUploadedAt()
            ))
            .toList();
    }
}
```

Untuk Java 8:

```java
return documents.stream()
    .map(document -> new DocumentSummaryResponse(
        document.getPublicId(),
        document.getFilename(),
        document.getUploadedAt()
    ))
    .collect(Collectors.toList());
```

---

### 36.3 Serialization Test

```java
@Test
void caseDetailResponseHasStableSafeShape() throws Exception {
    CaseDetailResponse response = new CaseDetailResponse(
        "CASE-2026-0001",
        "SUBMITTED",
        LocalDate.of(2026, 6, 17),
        "Officer A",
        List.of(new DocumentSummaryResponse(
            "DOC-1",
            "application.pdf",
            Instant.parse("2026-06-17T03:00:00Z")
        ))
    );

    JsonNode node = mapper.readTree(mapper.writeValueAsString(response));

    assertEquals("CASE-2026-0001", node.get("caseNo").asText());
    assertEquals("SUBMITTED", node.get("status").asText());
    assertEquals("2026-06-17", node.get("submittedDate").asText());
    assertEquals("Officer A", node.get("assignedOfficerName").asText());
    assertTrue(node.get("documents").isArray());

    assertFalse(node.has("internalRemark"));
    assertFalse(node.has("officerNote"));
    assertFalse(node.has("deleted"));
    assertFalse(node.has("version"));
}
```

---

## 37. Exercises

### Exercise 1 — Identify Accidental JSON Fields

Diberikan class:

```java
public class ApplicantResponse {
    private String name;
    private String nric;
    private LocalDate dateOfBirth;

    public String getName() { return name; }
    public String getNric() { return nric; }
    public LocalDate getDateOfBirth() { return dateOfBirth; }

    public int getAge() {
        return Period.between(dateOfBirth, LocalDate.now()).getYears();
    }

    public boolean isAdult() {
        return getAge() >= 18;
    }
}
```

Pertanyaan:

1. Field JSON apa saja yang keluar?
2. Mana yang contract eksplisit, mana yang accidental?
3. Apa risiko `getAge()`?
4. Bagaimana mendesain ulang response DTO-nya?

Jawaban yang diharapkan:

- `name`, `nric`, `dateOfBirth`, `age`, `adult` dapat keluar.
- `age` dan `adult` berasal dari getter turunan.
- `getAge()` bergantung `LocalDate.now()` sehingga output berubah tergantung waktu dan timezone server.
- DTO sebaiknya eksplisit, misalnya `ApplicantResponse(name, maskedNric, dateOfBirth, age, adult)` dengan age dihitung di service menggunakan `Clock`.

---

### Exercise 2 — Null Policy

Diberikan response:

```java
public record SearchCaseResponse(
    List<CaseSummary> items,
    Integer total,
    String nextPageToken
) {}
```

Tentukan policy untuk:

- `items` kosong,
- `total` nol,
- `nextPageToken` tidak ada.

Rekomendasi:

```json
{
  "items": [],
  "total": 0,
  "nextPageToken": null
}
```

Atau hilangkan `nextPageToken` jika contract menyatakan absent berarti tidak ada page berikutnya. Yang penting: dokumentasikan dan test.

---

### Exercise 3 — Sensitive Field Regression Test

Buat test agar field berikut tidak pernah keluar:

- `password`,
- `passwordHash`,
- `resetToken`,
- `internalRemark`,
- `deleted`,
- `version`.

Pattern:

```java
private static void assertNoSensitiveFields(JsonNode node) {
    List<String> forbidden = List.of(
        "password",
        "passwordHash",
        "resetToken",
        "internalRemark",
        "deleted",
        "version"
    );

    for (String field : forbidden) {
        assertFalse(node.has(field), "Forbidden field leaked: " + field);
    }
}
```

Untuk nested object, perlu recursive scan.

---

## 38. Recursive Sensitive Field Scanner

Untuk test yang lebih kuat:

```java
public final class JsonSecurityAssertions {
    private JsonSecurityAssertions() {}

    public static void assertNoForbiddenFields(JsonNode node, Set<String> forbiddenFields) {
        scan(node, forbiddenFields, "$.");
    }

    private static void scan(JsonNode node, Set<String> forbiddenFields, String path) {
        if (node == null || node.isNull()) {
            return;
        }

        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String fieldName = field.getKey();
                String fieldPath = path + fieldName;

                if (forbiddenFields.contains(fieldName)) {
                    throw new AssertionError("Forbidden field leaked at " + fieldPath);
                }

                scan(field.getValue(), forbiddenFields, fieldPath + ".");
            }
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                scan(node.get(i), forbiddenFields, path + "[" + i + "].");
            }
        }
    }
}
```

Usage:

```java
@Test
void responseDoesNotLeakSensitiveFieldsRecursively() throws Exception {
    JsonNode node = mapper.readTree(mapper.writeValueAsString(response));

    JsonSecurityAssertions.assertNoForbiddenFields(
        node,
        Set.of("password", "passwordHash", "resetToken", "internalRemark")
    );
}
```

---

## 39. Top 1% Mental Model

Engineer biasa bertanya:

> Bagaimana cara object ini jadi JSON?

Engineer kuat bertanya:

> JSON shape apa yang seharusnya menjadi contract boundary ini?

Engineer top-level bertanya lebih jauh:

1. Siapa consumer-nya?
2. Field mana yang stabil untuk jangka panjang?
3. Field mana yang semantic-nya bisa berubah?
4. Mana yang harus absent, null, empty, masked, atau redacted?
5. Apakah output aman dari field internal?
6. Apakah perubahan Java refactor bisa mengubah JSON contract?
7. Apakah runtime ObjectMapper sesuai dokumentasi API?
8. Apakah ada test yang gagal kalau contract berubah?
9. Apakah serialization bisa memicu query/database/lazy loading?
10. Apakah output cukup deterministic untuk audit/debug/replay?

Serialization adalah tempat di mana model internal menjadi janji eksternal. Janji ini harus dirancang, bukan dibiarkan terjadi otomatis.

---

## 40. Ringkasan

Di bagian ini kita membahas Jackson serialization sebagai proses contract shaping, bukan sekadar dumping object.

Poin utama:

1. JSON output adalah boundary contract.
2. Java field, Jackson property, dan JSON field adalah tiga hal berbeda.
3. `@JsonProperty` mengunci nama kontrak.
4. Naming strategy harus konsisten dan disadari.
5. `null`, absent, empty, dan default punya semantic berbeda.
6. `@JsonIgnore` berguna, tetapi DTO allow-list lebih aman.
7. `@JsonFormat` penting untuk date/time/enum/number contract.
8. Derived getter bisa tidak sengaja menjadi field JSON.
9. Sensitive data harus di-hide atau di-mask dengan policy eksplisit.
10. Custom serializer cocok untuk formatting/value object, bukan business logic.
11. Dynamic filtering dan `JsonNode` berguna, tetapi menurunkan contract clarity.
12. Entity tidak seharusnya langsung diserialize sebagai API response.
13. OpenAPI harus cocok dengan runtime serialization, bukan hanya DTO class.
14. Contract test adalah perlindungan terhadap accidental serialization drift.

---

## 41. Koneksi ke Part Berikutnya

Part berikutnya adalah:

**Part 9 — Jackson Deserialization: Constructor Binding, Defaults, Unknown Fields**

Jika serialization adalah proses membuat janji keluar, deserialization adalah proses menerima input dari dunia luar. Risiko deserialization lebih berbahaya karena data tidak trusted masuk ke sistem.

Kita akan membahas:

- constructor binding,
- records,
- `@JsonCreator`,
- required fields,
- unknown fields,
- missing vs null,
- coercion,
- enum handling,
- strict vs lenient input,
- default ambiguity,
- dan bagaimana mendesain input boundary yang aman.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./07-objectmapper-engineering-configuration-lifecycle-thread-safety-modules.md">⬅️ Part 7 — ObjectMapper Engineering: Configuration, Lifecycle, Thread Safety, Modules</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./09-jackson-deserialization-constructor-binding-defaults-unknown-fields.md">Part 9 — Jackson Deserialization: Constructor Binding, Defaults, Unknown Fields ➡️</a>
</div>
