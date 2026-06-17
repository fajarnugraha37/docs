# learn-java-json-xml-soap-connectors-enterprise-integration — Part 008
# JSON-B Annotation Deep Dive

> Seri: Java (Jakarta/Javax) JSON, JSON Processing, JSON Binding, XML, XML Binding, XML Web Services, SOAP Legacy, dan Connectors  
> Part: 008 dari 034  
> Fokus: annotation JSON-B sebagai kontrak eksplisit antara Java object model dan JSON document model  
> Target Java: 8 sampai 25  
> Target namespace: `javax.json.bind.*` untuk JSON-B 1.0 / Java EE 8, `jakarta.json.bind.*` untuk Jakarta JSON-B 2.x/3.x+

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun mental model JSON-B sebagai layer binding:

```text
JSON document  <---- JSON-B runtime ---->  Java object graph
```

Part ini membahas satu lapisan yang lebih tajam: **annotation JSON-B**.

Annotation bukan sekadar dekorasi class. Dalam sistem enterprise, annotation adalah **metadata kontrak** yang menentukan:

1. field/property mana yang terlihat keluar,
2. nama field JSON yang dianggap stabil,
3. bagaimana null, tanggal, angka, enum, dan custom type direpresentasikan,
4. bagaimana object immutable dibuat kembali saat deserialization,
5. kapan Java model boleh berbeda dari wire model,
6. dan kapan annotation justru menjadi sumber coupling yang berbahaya.

Mental model terpenting:

> JSON-B annotation adalah cara membuat aturan mapping menjadi eksplisit. Tetapi semakin banyak annotation diletakkan pada domain model internal, semakin kuat pula domain model terikat pada kontrak eksternal.

Seorang engineer level tinggi tidak hanya tahu `@JsonbProperty`, tetapi tahu **di layer mana annotation sebaiknya hidup**, bagaimana dampaknya terhadap backward compatibility, bagaimana annotation berinteraksi dengan default mapping, dan bagaimana migration `javax` → `jakarta` memengaruhi codebase multi-version.

---

## 1. Posisi Annotation dalam JSON-B

JSON-B memiliki tiga sumber keputusan mapping:

```text
1. Default convention
   - nama Java property menjadi nama JSON property
   - getter/setter/field dipilih berdasarkan access strategy
   - tipe standar dipetakan otomatis

2. Configuration
   - JsonbConfig
   - property naming strategy
   - property order strategy
   - null handling
   - visibility strategy
   - adapters/serializers/deserializers global

3. Annotation
   - metadata lokal di class/field/method/constructor
   - override sebagian keputusan default/config
```

Dalam praktik, prioritas desainnya bisa dibaca seperti ini:

```text
Default convention  = bagus untuk DTO sederhana
JsonbConfig         = bagus untuk policy aplikasi yang konsisten
Annotation          = bagus untuk kontrak field/type yang spesifik
Adapter/serializer  = bagus untuk tipe yang wire-form-nya berbeda signifikan
```

Kesalahan umum adalah memakai annotation untuk semua hal, padahal sebagian lebih tepat menjadi global policy. Contoh:

- semua field harus snake_case → lebih tepat `JsonbConfig.withPropertyNamingStrategy(...)`, bukan memberi `@JsonbProperty` di ratusan field;
- semua null harus tidak diserialize → lebih tepat config default, bukan annotation satu per satu;
- satu field legacy harus bernama `usr_id` → tepat memakai `@JsonbProperty("usr_id")`.

---

## 2. Namespace: Javax vs Jakarta

Untuk Java 8 / Java EE 8:

```java
import javax.json.bind.annotation.JsonbProperty;
import javax.json.bind.annotation.JsonbTransient;
import javax.json.bind.annotation.JsonbDateFormat;
```

Untuk Jakarta EE 9+ / Java 11+ modern:

```java
import jakarta.json.bind.annotation.JsonbProperty;
import jakarta.json.bind.annotation.JsonbTransient;
import jakarta.json.bind.annotation.JsonbDateFormat;
```

Konsepnya sama, tetapi package berbeda:

```text
javax.json.bind.*   -> Java EE 8 era
jakarta.json.bind.* -> Jakarta EE 9+ era
```

Migration trap:

```text
Kode bisa terlihat sama secara konsep,
tetapi binary compatibility tidak sama karena package berubah.
```

Jangan mencampur dependency `javax.json.bind-api` dan `jakarta.json.bind-api` dalam module yang sama kecuali memang sedang membuat compatibility bridge. Untuk aplikasi modern Java 17/21/25, gunakan dependency Jakarta secara eksplisit.

---

## 3. Daftar Annotation Penting JSON-B

Annotation utama yang perlu dikuasai:

| Annotation | Fungsi |
|---|---|
| `@JsonbProperty` | Mengubah nama property JSON atau memberi metadata property |
| `@JsonbTransient` | Mengeluarkan field/property/type dari binding |
| `@JsonbDateFormat` | Mengatur format tanggal/waktu |
| `@JsonbNumberFormat` | Mengatur format angka |
| `@JsonbTypeAdapter` | Mengubah mapping dengan adapter Java type ↔ adapted type |
| `@JsonbTypeSerializer` | Custom serializer satu arah Java → JSON |
| `@JsonbTypeDeserializer` | Custom deserializer satu arah JSON → Java |
| `@JsonbCreator` | Menentukan constructor/factory method untuk deserialization |
| `@JsonbPropertyOrder` | Mengatur urutan property saat serialization |
| `@JsonbNillable` | Mengatur serialization field null |
| `@JsonbVisibility` | Mengatur strategy visibility field/method |
| `@JsonbAnnotation` | Meta-annotation untuk annotation JSON-B custom |

Pada JSON-B 3.0, ada penambahan penting terkait dukungan polymorphic types dan dukungan `@JsonbTypeDeserializer`/`@JsonbTypeAdapter` sebagai annotation pada parameter/type, serta `@JsonbProperty.nillable()` dideprecate menurut catatan release JSON-B 3.0 resmi.

---

## 4. Mental Model: Annotation Itu Override Lokal

Bayangkan DTO berikut:

```java
public class UserResponse {
    public Long id;
    public String displayName;
}
```

Dengan default JSON-B:

```json
{
  "id": 10,
  "displayName": "Fajar"
}
```

Jika kontrak eksternal mengharuskan `display_name`:

```java
public class UserResponse {
    public Long id;

    @JsonbProperty("display_name")
    public String displayName;
}
```

Output:

```json
{
  "id": 10,
  "display_name": "Fajar"
}
```

Artinya annotation mengubah **wire contract**, bukan hanya penamaan kosmetik.

Konsekuensinya:

1. Mengubah value `@JsonbProperty` adalah breaking change bagi consumer.
2. Menghapus annotation bisa breaking change jika default name berbeda dari explicit name.
3. Menambahkan annotation ke domain object bisa membuat domain object sulit dipakai untuk kontrak berbeda.

---

## 5. `@JsonbProperty`: Nama Wire Contract

### 5.1 Fungsi Dasar

`@JsonbProperty` digunakan untuk memberi nama JSON property yang berbeda dari nama Java property.

```java
public class ApplicationDto {
    @JsonbProperty("application_id")
    public String applicationId;

    @JsonbProperty("case_ref_no")
    public String caseReferenceNumber;
}
```

Output:

```json
{
  "application_id": "APP-2026-0001",
  "case_ref_no": "CASE-001"
}
```

### 5.2 Kapan Memakai `@JsonbProperty`

Gunakan ketika:

1. nama JSON adalah bagian dari public contract;
2. nama JSON harus mengikuti legacy naming;
3. nama Java dibuat lebih ekspresif daripada nama wire;
4. ada field eksternal yang tidak bisa diubah;
5. Anda ingin menghindari global naming strategy karena hanya sebagian field berbeda.

Contoh legacy:

```json
{
  "usrNm": "fajar",
  "acctSts": "ACTIVE"
}
```

DTO internal boundary:

```java
public class LegacyAccountResponse {
    @JsonbProperty("usrNm")
    public String username;

    @JsonbProperty("acctSts")
    public String accountStatus;
}
```

Ini lebih baik daripada membuat Java field bernama `usrNm` dan `acctSts`, karena Java code tetap readable.

### 5.3 `@JsonbProperty` pada Field vs Getter

Field annotation:

```java
public class PersonDto {
    @JsonbProperty("full_name")
    private String fullName;

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }
}
```

Getter annotation:

```java
public class PersonDto {
    private String fullName;

    @JsonbProperty("full_name")
    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }
}
```

Prinsip praktis:

```text
Pilih satu style dalam satu codebase.
Jangan campur field annotation dan getter annotation tanpa alasan kuat.
```

Untuk DTO sederhana modern, field annotation sering lebih mudah dibaca. Untuk JavaBean enterprise legacy, getter/setter annotation sering lebih konsisten dengan framework lama.

### 5.4 Risiko Duplicate Mapping

Contoh buruk:

```java
public class BadDto {
    @JsonbProperty("name")
    private String fullName;

    @JsonbProperty("name")
    public String getDisplayName() {
        return fullName;
    }
}
```

Masalah:

- dua member bisa dianggap mengarah ke property JSON yang sama;
- provider bisa menolak, overwrite, atau berperilaku tidak sesuai ekspektasi;
- contract menjadi ambigu.

Invarian yang baik:

```text
Satu JSON property name harus dimiliki oleh tepat satu logical property.
```

---

## 6. `@JsonbTransient`: Explicit Exclusion

### 6.1 Fungsi Dasar

`@JsonbTransient` mencegah field/property/type ikut serialization/deserialization.

```java
public class UserDto {
    public String username;

    @JsonbTransient
    public String passwordHash;
}
```

Output:

```json
{
  "username": "fajar"
}
```

### 6.2 Ini Bukan Hanya Convenience, Ini Security Boundary

Field yang harus hampir selalu transient:

- password hash;
- credential/token;
- internal role computation;
- security flags internal;
- audit-only metadata;
- lazy-loaded internal reference;
- object graph back-reference yang bisa menyebabkan payload membesar/tak terkendali.

Contoh:

```java
public class SessionDto {
    public String userId;

    @JsonbTransient
    public String accessToken;

    @JsonbTransient
    public String refreshToken;
}
```

Namun jangan menganggap annotation sebagai satu-satunya safety mechanism. Untuk data sensitif, desain terbaik adalah **jangan pernah menaruh field sensitif di DTO response**.

Lebih baik:

```java
public class SessionResponse {
    public String userId;
    public long expiresInSeconds;
}
```

Daripada:

```java
public class SessionResponse {
    public String userId;

    @JsonbTransient
    public String refreshToken;
}
```

Kenapa? Karena annotation bisa hilang saat refactor, provider bisa berbeda, dan object bisa dipakai oleh serializer lain.

### 6.3 Domain Object vs DTO

Anti-pattern:

```java
@Entity
public class User {
    public Long id;
    public String username;

    @JsonbTransient
    public String passwordHash;
}
```

Masalah:

- entity persistence dicampur dengan wire contract;
- domain model dipakai langsung sebagai API response;
- future endpoint bisa tidak sengaja expose field baru;
- annotation JSON-B tidak melindungi jika object diserialize oleh Jackson atau logger custom.

Pattern lebih aman:

```java
public class UserResponseDto {
    public Long id;
    public String username;
}
```

Top 1% principle:

```text
Do not rely on exclusion annotation to make an unsafe model safe.
Prefer constructing a safe boundary model from the start.
```

---

## 7. `@JsonbDateFormat`: Date/Time Contract

### 7.1 Kenapa Date Format Sulit

Date/time sulit karena mengandung banyak dimensi:

```text
instant       = titik waktu global
local date    = tanggal tanpa waktu
local time    = waktu tanpa tanggal
zone offset   = +07:00, Z
zone id       = Asia/Jakarta
calendar rule = DST, leap second semantics, historical offset
precision     = second, millisecond, nanosecond
```

Kesalahan umum:

```java
public Date createdAt;
```

Tanpa kontrak eksplisit, consumer bisa bingung:

```json
"createdAt": "2026-06-17T10:15:30"
```

Apakah itu UTC? Jakarta? Local server time? Offset hilang?

### 7.2 Format ISO Offset untuk Event Timestamp

Untuk timestamp audit/event, gunakan tipe dan format yang membawa offset/instant secara jelas.

```java
public class AuditEventDto {
    @JsonbDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX")
    public OffsetDateTime occurredAt;
}
```

Contoh JSON:

```json
{
  "occurredAt": "2026-06-17T10:15:30+07:00"
}
```

Lebih baik lagi untuk machine-to-machine contract: gunakan `Instant` dengan UTC.

```java
public class AuditEventDto {
    @JsonbDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX")
    public Instant occurredAt;
}
```

Contoh:

```json
{
  "occurredAt": "2026-06-17T03:15:30.123Z"
}
```

### 7.3 Jangan Pakai Format Lokal untuk Contract Mesin

Hindari:

```java
@JsonbDateFormat("dd/MM/yyyy HH:mm:ss")
public LocalDateTime submittedAt;
```

Masalah:

- ambiguous across countries;
- tidak ada offset;
- parsing bisa dipengaruhi locale;
- sulit dibandingkan secara lexicographic;
- raw JSON tidak cukup menjawab “ini waktu zona mana?”.

Format seperti itu boleh untuk export report manusia, bukan untuk integration contract antar sistem.

### 7.4 LocalDate untuk Business Date

Untuk tanggal bisnis, gunakan `LocalDate`.

```java
public class LicenseDto {
    @JsonbDateFormat("yyyy-MM-dd")
    public LocalDate expiryDate;
}
```

JSON:

```json
{
  "expiryDate": "2026-12-31"
}
```

Mental model:

```text
Expiry date adalah tanggal administratif.
Created-at adalah timestamp kejadian.
Jangan campur dua konsep ini.
```

### 7.5 Date Format sebagai Public Contract

Mengubah:

```text
2026-06-17T03:15:30Z
```

menjadi:

```text
17/06/2026 10:15:30
```

bukan sekadar perubahan tampilan. Itu breaking change jika consumer parsing string.

Checklist:

- Apakah field ini business date atau event timestamp?
- Apakah timezone/offset harus disimpan?
- Apakah precision penting?
- Apakah consumer butuh lexical sorting?
- Apakah JSON akan masuk audit/signature/canonicalization?

---

## 8. `@JsonbNumberFormat`: Number Contract

### 8.1 Angka Bukan Selalu Angka Matematis

Dalam integration, field numerik bisa berarti:

1. quantity,
2. money,
3. percentage,
4. identifier,
5. code,
6. version,
7. score,
8. sequence,
9. decimal measurement.

Tidak semuanya boleh diperlakukan sama.

Contoh buruk:

```java
public double amount;
```

Untuk uang, `double` adalah pilihan buruk karena floating point binary tidak cocok untuk decimal exactness.

Gunakan:

```java
public BigDecimal amount;
```

### 8.2 Format Angka untuk Display vs Machine Contract

`@JsonbNumberFormat` bisa mengatur representasi angka.

```java
public class PaymentDto {
    @JsonbNumberFormat("#.00")
    public BigDecimal amount;
}
```

Namun berhati-hati: format angka yang menghasilkan string/display style dapat membuat consumer parsing lebih rapuh.

Untuk machine-to-machine JSON, sering lebih baik:

```json
{
  "amount": "12345.67",
  "currency": "IDR"
}
```

atau:

```json
{
  "minorAmount": 1234567,
  "currency": "IDR"
}
```

Daripada:

```json
{
  "amount": "12,345.67"
}
```

Karena separator ribuan bergantung locale.

### 8.3 Money Contract Pattern

Pattern aman:

```java
public class MoneyDto {
    public String currency;
    public BigDecimal amount;
}
```

Atau integer minor unit:

```java
public class MoneyDto {
    public String currency;
    public long minorUnits;
}
```

Contoh:

```json
{
  "currency": "SGD",
  "minorUnits": 125050
}
```

Artinya SGD 1,250.50 jika currency punya 2 decimal places.

### 8.4 Large Number Trap

JSON number tidak memiliki tipe eksplisit seperti `int64`, `BigInteger`, atau `BigDecimal`. Banyak JavaScript consumer tidak aman membaca integer di atas `Number.MAX_SAFE_INTEGER`.

Jika ID besar dikirim sebagai number:

```json
{
  "caseId": 9223372036854775807
}
```

Consumer JavaScript bisa kehilangan presisi.

Lebih aman untuk identifier besar:

```json
{
  "caseId": "9223372036854775807"
}
```

Prinsip:

```text
Identifier bukan angka matematis.
Identifier besar sebaiknya string.
```

---

## 9. `@JsonbTypeAdapter`: Mapping dengan Adapted Type

### 9.1 Mental Model Adapter

`JsonbAdapter<A, B>` mengubah:

```text
Java domain/boundary type A  <---->  adapted JSON-friendly type B
```

Contoh:

```java
public class PostalCode {
    private final String value;

    public PostalCode(String value) {
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be 6 digits");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Adapter:

```java
import jakarta.json.bind.adapter.JsonbAdapter;

public class PostalCodeAdapter implements JsonbAdapter<PostalCode, String> {
    @Override
    public String adaptToJson(PostalCode obj) {
        return obj == null ? null : obj.value();
    }

    @Override
    public PostalCode adaptFromJson(String obj) {
        return obj == null ? null : new PostalCode(obj);
    }
}
```

DTO:

```java
public class AddressDto {
    @JsonbTypeAdapter(PostalCodeAdapter.class)
    public PostalCode postalCode;
}
```

JSON:

```json
{
  "postalCode": "123456"
}
```

### 9.2 Adapter vs Serializer/Deserializer

Gunakan adapter ketika representasi JSON masih bisa dianggap sebagai tipe Java sederhana/intermediate.

```text
PostalCode <-> String
Money      <-> MoneyJson
Enum       <-> String code
```

Gunakan serializer/deserializer ketika perlu kontrol rendah terhadap JSON structure atau parsing token.

```text
Complex polymorphic payload
Legacy irregular JSON
Conditional fields
Custom envelope/body layout
```

### 9.3 Adapter untuk Strongly Typed ID

Alih-alih menyebar `String caseId` di mana-mana:

```java
public final class CaseId {
    private final String value;

    public CaseId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("caseId is required");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Adapter:

```java
public class CaseIdAdapter implements JsonbAdapter<CaseId, String> {
    @Override
    public String adaptToJson(CaseId obj) {
        return obj == null ? null : obj.value();
    }

    @Override
    public CaseId adaptFromJson(String obj) {
        return obj == null ? null : new CaseId(obj);
    }
}
```

DTO:

```java
public class CaseSummaryDto {
    @JsonbTypeAdapter(CaseIdAdapter.class)
    public CaseId caseId;
}
```

Benefit:

- compile-time type safety;
- validation terkonsentrasi;
- domain vocabulary lebih kuat;
- JSON tetap sederhana.

### 9.4 Adapter Harus Stateless

Adapter sebaiknya stateless:

```java
public class GoodAdapter implements JsonbAdapter<CaseId, String> {
    @Override
    public String adaptToJson(CaseId obj) { ... }

    @Override
    public CaseId adaptFromJson(String obj) { ... }
}
```

Hindari:

```java
public class BadAdapter implements JsonbAdapter<CaseId, String> {
    private int counter; // buruk
    private SimpleDateFormat formatter; // buruk jika mutable dan tidak thread-safe
}
```

Kenapa?

- provider bisa reuse adapter;
- JSON-B instance lazimnya dipakai lintas request;
- mutable state bisa menyebabkan race condition;
- behavior bisa non-deterministic.

---

## 10. `@JsonbTypeSerializer` dan `@JsonbTypeDeserializer`

### 10.1 Kapan Perlu Serializer Custom

Serializer custom diperlukan ketika `JsonbAdapter` tidak cukup.

Misalnya field harus diserialize sebagai object conditional:

```json
{
  "status": {
    "code": "APPROVED",
    "label": "Approved"
  }
}
```

Padahal Java object:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Adapter bisa mengubah enum ke DTO intermediate. Tetapi serializer custom memberi kontrol langsung atas JSON generation.

### 10.2 Prinsip Serializer Custom

Serializer custom harus:

1. deterministic;
2. tidak melakukan I/O;
3. tidak melakukan database lookup;
4. tidak bergantung pada request context tersembunyi;
5. tidak menyembunyikan business logic berat;
6. fail fast untuk nilai invalid.

Bad idea:

```text
Serializer memanggil database untuk mencari label status.
```

Kenapa buruk?

- serialization menjadi lambat dan tidak predictable;
- bisa memicu N+1 query;
- error serialization berubah menjadi error integration;
- test menjadi sulit.

Better:

```text
DTO sudah membawa label yang dibutuhkan sebelum serialization.
```

---

## 11. `@JsonbCreator`: Deserialization untuk Immutable Object

### 11.1 Masalah Object Immutable

JSON-B default mudah bekerja dengan POJO mutable:

```java
public class UserDto {
    public String username;
    public String displayName;
}
```

Tetapi desain modern sering immutable:

```java
public final class UserDto {
    private final String username;
    private final String displayName;

    public UserDto(String username, String displayName) {
        this.username = username;
        this.displayName = displayName;
    }

    public String getUsername() { return username; }
    public String getDisplayName() { return displayName; }
}
```

JSON-B perlu tahu constructor mana yang dipakai dan parameter mana cocok dengan JSON property.

### 11.2 Constructor Creator

```java
public final class UserDto {
    private final String username;
    private final String displayName;

    @JsonbCreator
    public UserDto(
        @JsonbProperty("username") String username,
        @JsonbProperty("displayName") String displayName
    ) {
        this.username = username;
        this.displayName = displayName;
    }

    public String getUsername() {
        return username;
    }

    public String getDisplayName() {
        return displayName;
    }
}
```

Mental model:

```text
@JsonbCreator menjembatani JSON object ke construction invariant.
```

Jika constructor melakukan validation, deserialization juga menghormati invariant.

```java
@JsonbCreator
public UserDto(@JsonbProperty("username") String username) {
    if (username == null || username.isBlank()) {
        throw new IllegalArgumentException("username is required");
    }
    this.username = username;
}
```

### 11.3 Static Factory Creator

```java
public final class CaseId {
    private final String value;

    private CaseId(String value) {
        this.value = value;
    }

    @JsonbCreator
    public static CaseId of(@JsonbProperty("value") String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId is required");
        }
        return new CaseId(value);
    }

    public String getValue() {
        return value;
    }
}
```

Namun untuk single-value object seperti `CaseId`, adapter ke string biasanya lebih baik daripada JSON object `{"value":"..."}` jika wire contract memang string.

### 11.4 Creator dan Java Records

Untuk Java 16+ records:

```java
public record UserResponse(
    String username,
    String displayName
) {}
```

Banyak provider modern mendukung records, tetapi compatibility Java 8–11 dan provider version harus diperhatikan. Untuk seri Java 8–25, jangan menganggap semua runtime mendukung records jika target masih Java 8/11 legacy.

Untuk kontrak enterprise lintas versi, class DTO biasa masih paling portable.

---

## 12. `@JsonbPropertyOrder`: Deterministic Output

### 12.1 JSON Object Secara Semantik Tidak Bergantung Urutan

Secara JSON, object member order tidak semestinya bermakna. Tetapi di production, urutan kadang penting untuk:

- snapshot testing;
- audit log readability;
- deterministic payload;
- digital signing/canonicalization pre-step;
- golden file comparison;
- stable documentation examples.

### 12.2 Contoh

```java
@JsonbPropertyOrder({"caseId", "status", "submittedAt"})
public class CaseSummaryDto {
    public String status;
    public String caseId;
    public Instant submittedAt;
}
```

Output lebih stabil:

```json
{
  "caseId": "CASE-001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-17T03:15:30Z"
}
```

### 12.3 Jangan Jadikan Urutan sebagai Semantik Domain

Consumer tidak boleh bergantung pada urutan property JSON biasa. Jika urutan bermakna, gunakan array:

```json
{
  "steps": [
    { "sequence": 1, "name": "submitted" },
    { "sequence": 2, "name": "screened" }
  ]
}
```

Bukan:

```json
{
  "submitted": {...},
  "screened": {...}
}
```

---

## 13. `@JsonbNillable` dan Null Semantics

### 13.1 Null vs Absent

Salah satu topik paling penting dalam API contract:

```json
{
  "middleName": null
}
```

berbeda dari:

```json
{
}
```

Makna umum:

| Bentuk | Makna Potensial |
|---|---|
| field absent | tidak dikirim, tidak diketahui, tidak berubah, atau default |
| field null | eksplisit kosong, clear value, atau diketahui tidak ada |

Dalam PATCH API, perbedaan ini krusial.

```json
{
  "mobileNo": null
}
```

bisa berarti:

```text
hapus mobileNo
```

Sedangkan:

```json
{}
```

bisa berarti:

```text
jangan ubah mobileNo
```

### 13.2 JSON-B Null Serialization

`@JsonbNillable` dapat mengatur agar null field tetap diserialize.

```java
@JsonbNillable
public class ProfilePatchDto {
    public String mobileNo;
    public String email;
}
```

Output dapat mempertahankan null:

```json
{
  "mobileNo": null,
  "email": null
}
```

Namun hati-hati: class-level nillable bisa membuat semua field null keluar, memperbesar payload dan mengubah semantic consumer.

### 13.3 Field-Level Null Contract

Lebih terkendali:

```java
public class ProfileDto {
    public String name;

    @JsonbNillable
    public String middleName;
}
```

Tetapi perhatikan catatan versi: pada JSON-B 3.0, `@JsonbProperty.nillable()` dideprecate; preferensi desain modern adalah gunakan annotation/null policy yang jelas, bukan menyembunyikan null behavior di property name annotation.

### 13.4 DTO untuk PATCH Harus Eksplisit

Untuk PATCH, Java field nullable tidak cukup membedakan absent vs null.

Buruk:

```java
public class UpdateProfileRequest {
    public String mobileNo;
}
```

Jika `mobileNo == null`, apakah field absent atau eksplisit null?

Pattern lebih kuat:

```java
public final class FieldUpdate<T> {
    private final boolean present;
    private final T value;

    private FieldUpdate(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> FieldUpdate<T> absent() {
        return new FieldUpdate<>(false, null);
    }

    public static <T> FieldUpdate<T> of(T value) {
        return new FieldUpdate<>(true, value);
    }

    public boolean isPresent() { return present; }
    public T getValue() { return value; }
}
```

Tetapi JSON-B default tidak otomatis memberi absent tracking. Untuk kebutuhan serius, gunakan JSON-P layer untuk mendeteksi key presence, lalu map manual ke command object.

Mental model:

```text
JSON-B bagus untuk binding object.
JSON-P lebih tepat ketika presence/absence adalah bagian dari semantics.
```

---

## 14. `@JsonbVisibility`: Mengontrol Apa yang Terlihat

### 14.1 Default Visibility

Default JSON-B biasanya mengikuti JavaBean-style visibility: public getter/setter dan public field lebih mudah terdeteksi.

Namun Anda bisa mengubah strategy.

Contoh visibility strategy:

```java
public class FieldVisibilityStrategy implements PropertyVisibilityStrategy {
    @Override
    public boolean isVisible(Field field) {
        return true;
    }

    @Override
    public boolean isVisible(Method method) {
        return false;
    }
}
```

Annotation:

```java
@JsonbVisibility(FieldVisibilityStrategy.class)
public class UserDto {
    private String username;
    private String displayName;
}
```

### 14.2 Kapan Ini Berguna

Berguna ketika:

- DTO immutable dengan private fields;
- tidak ingin membuat setter hanya demi serializer;
- ingin menghindari getter computed ikut terserialize;
- ingin mapping field-only yang predictable.

### 14.3 Risiko

Field-level visibility bisa membypass logic getter.

Contoh:

```java
public class UserDto {
    private String username;

    public String getUsername() {
        return username == null ? "anonymous" : username;
    }
}
```

Jika field visibility dipakai, JSON bisa berisi raw `null`, bukan `anonymous`.

Prinsip:

```text
Visibility strategy adalah architectural policy.
Jangan ubah per class tanpa alasan kuat.
```

---

## 15. Annotation pada Enum

### 15.1 Default Enum Mapping

Default biasanya enum name:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

JSON:

```json
"SUBMITTED"
```

Masalah:

- enum name Java menjadi wire contract;
- rename enum menjadi breaking change;
- legacy code mungkin membutuhkan code berbeda seperti `S`, `A`, `R`.

### 15.2 Adapter untuk Enum Code

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
        throw new IllegalArgumentException("Unknown status code: " + code);
    }
}
```

Adapter:

```java
public class ApplicationStatusAdapter implements JsonbAdapter<ApplicationStatus, String> {
    @Override
    public String adaptToJson(ApplicationStatus obj) {
        return obj == null ? null : obj.code();
    }

    @Override
    public ApplicationStatus adaptFromJson(String obj) {
        return obj == null ? null : ApplicationStatus.fromCode(obj);
    }
}
```

DTO:

```java
public class ApplicationDto {
    @JsonbTypeAdapter(ApplicationStatusAdapter.class)
    public ApplicationStatus status;
}
```

JSON:

```json
{
  "status": "S"
}
```

### 15.3 Unknown Enum Values

Top-tier API design mempertimbangkan unknown future enum.

Jika provider menerima status baru:

```json
{
  "status": "PENDING_REVIEW"
}
```

Consumer lama bisa gagal deserialization.

Strategi:

1. fail fast untuk command/input internal yang harus valid;
2. tolerate unknown untuk external feed/event yang evolutif;
3. gunakan `UNKNOWN` enum sentinel jika memang contract mengizinkan;
4. simpan raw code untuk audit.

Contoh tolerant model:

```java
public final class ExternalStatus {
    private final String rawCode;
    private final KnownStatus knownStatus;

    // knownStatus bisa UNKNOWN
}
```

---

## 16. Annotation dan Inheritance/Polymorphism

### 16.1 Kenapa Polymorphism Berbahaya

JSON tidak membawa tipe Java secara native. Jika kita punya:

```java
public abstract class NotificationCommand {}

public class EmailCommand extends NotificationCommand {
    public String email;
}

public class SmsCommand extends NotificationCommand {
    public String mobileNo;
}
```

JSON perlu discriminator:

```json
{
  "type": "EMAIL",
  "email": "user@example.com"
}
```

Tanpa discriminator, runtime tidak tahu subclass mana yang dibuat.

### 16.2 Jangan Kirim Nama Class Java ke JSON

Anti-pattern:

```json
{
  "@class": "com.company.notification.EmailCommand",
  "email": "user@example.com"
}
```

Masalah:

- membocorkan internal package;
- coupling ekstrem ke Java implementation;
- berbahaya jika deserialization membuka type loading dinamis;
- sulit dimigrasi.

Gunakan discriminator bisnis:

```json
{
  "channel": "EMAIL",
  "email": "user@example.com"
}
```

### 16.3 Strategy Aman

Untuk polymorphic command penting, sering lebih aman parse dengan JSON-P dulu:

```java
JsonObject obj = reader.readObject();
String channel = obj.getString("channel");

switch (channel) {
    case "EMAIL":
        return jsonb.fromJson(obj.toString(), EmailCommand.class);
    case "SMS":
        return jsonb.fromJson(obj.toString(), SmsCommand.class);
    default:
        throw new BadRequestException("Unsupported channel: " + channel);
}
```

Ini lebih eksplisit daripada membiarkan serializer melakukan magic polymorphism.

---

## 17. Annotation dan DTO Layering

### 17.1 Tiga Model yang Sering Tercampur

Dalam sistem enterprise, biasanya ada beberapa model:

```text
Persistence model  -> entity/table shape
Domain model       -> business invariant shape
API DTO model      -> wire contract shape
Integration DTO    -> partner/legacy contract shape
```

JSON-B annotation paling aman berada pada:

```text
API DTO / Integration DTO
```

Bukan pada:

```text
Entity JPA / domain aggregate internal
```

### 17.2 Contoh Layering yang Baik

Domain:

```java
public final class Application {
    private final ApplicationId id;
    private final ApplicationStatus status;
    private final Instant submittedAt;

    // domain behavior
}
```

API DTO:

```java
public class ApplicationResponse {
    @JsonbProperty("application_id")
    public String applicationId;

    public String status;

    @JsonbDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX")
    public Instant submittedAt;
}
```

Mapper:

```java
public class ApplicationDtoMapper {
    public ApplicationResponse toResponse(Application application) {
        ApplicationResponse dto = new ApplicationResponse();
        dto.applicationId = application.id().value();
        dto.status = application.status().name();
        dto.submittedAt = application.submittedAt();
        return dto;
    }
}
```

Benefit:

- annotation tidak mencemari domain;
- contract API bisa berubah tanpa mengubah domain;
- security lebih mudah diaudit;
- backward compatibility bisa dikelola per DTO version.

---

## 18. Annotation dan Versioning

### 18.1 Jangan Rename Field Tanpa Strategi

Versi lama:

```java
public class UserDtoV1 {
    @JsonbProperty("name")
    public String name;
}
```

Consumer memakai:

```json
{
  "name": "Fajar"
}
```

Jika diubah menjadi:

```java
public class UserDtoV2 {
    @JsonbProperty("displayName")
    public String displayName;
}
```

Maka contract berubah.

### 18.2 Additive Change Lebih Aman

Strategi transisi:

```java
public class UserDtoV2 {
    /** old field retained for compatibility */
    @JsonbProperty("name")
    public String name;

    /** new explicit field */
    @JsonbProperty("displayName")
    public String displayName;
}
```

Atau gunakan endpoint versioning:

```text
/v1/users/{id} -> name
/v2/users/{id} -> displayName
```

### 18.3 Read Alias Problem

JSON-B standard annotation tidak sekaya Jackson `@JsonAlias`. Jika harus menerima dua input names:

```json
{ "name": "Fajar" }
```

atau:

```json
{ "displayName": "Fajar" }
```

Strategi aman:

1. parse dengan JSON-P;
2. normalize ke canonical JSON;
3. bind ke DTO.

Contoh:

```java
JsonObject input = reader.readObject();
String displayName = input.containsKey("displayName")
    ? input.getString("displayName")
    : input.getString("name", null);
```

Untuk compatibility rumit, jangan paksakan semua ke annotation.

---

## 19. Annotation dan Validation

JSON-B annotation bukan validation annotation.

Ini mapping:

```java
@JsonbProperty("email")
public String email;
```

Ini validation:

```java
@NotBlank
@Email
public String email;
```

Keduanya punya concern berbeda:

```text
JSON-B = bagaimana data masuk/keluar JSON
Bean Validation = apakah data valid untuk use case
```

Pattern:

```java
public class CreateUserRequest {
    @JsonbProperty("email")
    @NotBlank
    @Email
    public String email;
}
```

Tetapi jangan hanya mengandalkan Bean Validation untuk format yang perlu dipakai saat constructing value object. Untuk invariant kuat, validasi juga harus ada di value object/domain.

---

## 20. Annotation dan Error Handling

### 20.1 Error Saat Deserialization

Error umum:

- field JSON tidak cocok tipe Java;
- tanggal tidak sesuai format;
- angka overflow;
- unknown enum;
- constructor creator melempar exception;
- adapter gagal parsing;
- required field null tetapi constructor menolak.

Top-tier boundary handling:

```text
Raw JSON error -> parse/bind error -> normalized API error response
```

Jangan bocorkan stack trace:

```json
{
  "error": "jakarta.json.bind.JsonbException: Unable to deserialize property..."
}
```

Lebih baik:

```json
{
  "code": "INVALID_REQUEST_BODY",
  "message": "Request body is not valid JSON or does not match the expected schema.",
  "correlationId": "..."
}
```

Untuk field-level details, hati-hati agar tidak membocorkan internals.

### 20.2 Adapter Error Message

Adapter buruk:

```java
throw new IllegalArgumentException("Invalid value");
```

Adapter lebih baik:

```java
throw new IllegalArgumentException("postalCode must be 6 digits");
```

Tetapi API layer tetap harus sanitize.

---

## 21. Annotation dan Security

### 21.1 Allowlist, Not Blocklist

Menggunakan `@JsonbTransient` adalah blocklist approach.

Lebih aman:

```text
Create response DTO with only allowed fields.
```

Misalnya:

```java
public class UserEntity {
    public Long id;
    public String username;
    public String passwordHash;
    public String internalRiskScore;
    public String mfaSecret;
}
```

Jangan expose entity lalu berharap transient cukup.

Buat:

```java
public class UserPublicResponse {
    public Long id;
    public String username;
}
```

### 21.2 Annotation Tidak Melindungi Semua Serializer

`@JsonbTransient` hanya relevan untuk JSON-B. Jika object yang sama diserialize oleh Jackson, logging reflection, debugging tool, atau custom mapper, field bisa tetap keluar.

Prinsip:

```text
Sensitive data should not be present in serialization object.
```

### 21.3 Deserialization Attack Surface

Custom creator/adapter/deserializer harus menolak input aneh:

- string terlalu panjang;
- number terlalu besar;
- deeply nested structure;
- unknown discriminator;
- unexpected null;
- encoded payload yang bisa memicu downstream injection.

Jangan melakukan side effect di constructor DTO karena constructor bisa dipanggil saat deserialization.

Buruk:

```java
@JsonbCreator
public ImportRequest(@JsonbProperty("fileUrl") String fileUrl) {
    this.bytes = httpClient.get(fileUrl); // SSRF risk + side effect
}
```

Baik:

```java
@JsonbCreator
public ImportRequest(@JsonbProperty("fileUrl") String fileUrl) {
    this.fileUrl = validateUrlSyntaxOnly(fileUrl);
}
```

Side effect dilakukan di service layer setelah authorization dan validation.

---

## 22. Annotation dan Performance

### 22.1 Annotation Processing Runtime

JSON-B membaca metadata class melalui reflection/provider internals. Biasanya metadata dicache oleh `Jsonb` instance/provider.

Prinsip:

```text
Jangan buat Jsonb instance baru per request.
```

Buruk:

```java
public String toJson(Object obj) {
    try (Jsonb jsonb = JsonbBuilder.create()) {
        return jsonb.toJson(obj);
    }
}
```

Baik:

```java
public final class JsonbHolder {
    public static final Jsonb JSONB = JsonbBuilder.create();
}
```

Dengan catatan lifecycle close saat aplikasi shutdown jika diperlukan.

### 22.2 Adapter Heavy Logic

Jika adapter melakukan expensive computation, serialization akan lambat.

Bad:

```java
public String adaptToJson(UserId id) {
    return userRepository.findDisplayCode(id); // no
}
```

Good:

```java
public String adaptToJson(UserId id) {
    return id.value();
}
```

Rule:

```text
Serializer/adapter should transform representation, not fetch business data.
```

---

## 23. Annotation dan Testing Strategy

### 23.1 Golden JSON Test

Untuk DTO public contract:

```java
@Test
void serializesApplicationResponseContract() {
    ApplicationResponse dto = new ApplicationResponse();
    dto.applicationId = "APP-001";
    dto.status = "SUBMITTED";
    dto.submittedAt = Instant.parse("2026-06-17T03:15:30Z");

    String json = jsonb.toJson(dto);

    assertThat(json).contains("\"application_id\":");
    assertThat(json).contains("\"status\":");
}
```

Lebih kuat: parse kembali dengan JSON-P dan assert semantic value, bukan raw string order.

```java
JsonObject obj = Json.createReader(new StringReader(json)).readObject();
assertEquals("APP-001", obj.getString("application_id"));
assertEquals("SUBMITTED", obj.getString("status"));
```

### 23.2 Round-Trip Test

```java
@Test
void roundTripKeepsCaseId() {
    CaseSummaryDto dto = new CaseSummaryDto();
    dto.caseId = new CaseId("CASE-001");

    String json = jsonb.toJson(dto);
    CaseSummaryDto result = jsonb.fromJson(json, CaseSummaryDto.class);

    assertEquals("CASE-001", result.caseId.value());
}
```

Round-trip berguna, tetapi tidak cukup. Kenapa?

Karena serializer dan deserializer bisa sama-sama salah tetapi konsisten.

Tambahkan test dengan JSON fixture eksternal:

```java
String json = "{\"caseId\":\"CASE-001\"}";
CaseSummaryDto result = jsonb.fromJson(json, CaseSummaryDto.class);
assertEquals("CASE-001", result.caseId.value());
```

### 23.3 Compatibility Test

Untuk kontrak publik:

```text
- old JSON can still be read
- new JSON does not remove existing fields
- unknown fields behavior is known
- null/absent behavior is tested
- date/number examples are tested
```

---

## 24. Practical Patterns

### 24.1 Public API DTO Pattern

```java
@JsonbPropertyOrder({"application_id", "status", "submitted_at"})
public class ApplicationResponse {
    @JsonbProperty("application_id")
    public String applicationId;

    public String status;

    @JsonbProperty("submitted_at")
    @JsonbDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX")
    public Instant submittedAt;
}
```

Benefit:

- explicit wire names;
- deterministic examples;
- clear timestamp format.

### 24.2 Legacy Partner DTO Pattern

```java
public class LegacyPartnerRequest {
    @JsonbProperty("REQ_ID")
    public String requestId;

    @JsonbProperty("USR_NM")
    public String username;

    @JsonbProperty("TXN_DT")
    @JsonbDateFormat("yyyyMMddHHmmss")
    public LocalDateTime transactionDateTime;
}
```

Catatan:

- legacy format boleh didukung di integration DTO;
- jangan bocorkan format legacy ke domain;
- mapper harus menjadi anti-corruption layer.

### 24.3 Sensitive Response Pattern

```java
public class AccountResponse {
    public String accountId;
    public String username;
    public String status;
}
```

Bukan:

```java
public class AccountResponse {
    public String accountId;
    public String username;
    public String status;

    @JsonbTransient
    public String passwordHash;

    @JsonbTransient
    public String mfaSecret;
}
```

### 24.4 Strong Type Adapter Pattern

```java
public class EnforcementCaseResponse {
    @JsonbTypeAdapter(CaseIdAdapter.class)
    public CaseId caseId;

    public String status;
}
```

Ini menjaga domain vocabulary kuat tanpa membuat JSON rumit.

---

## 25. Anti-Patterns

### Anti-Pattern 1: Entity sebagai JSON Response

```java
return userEntity;
```

Masalah:

- overexposure;
- lazy loading;
- cyclic graph;
- security leak;
- schema database menjadi API contract.

### Anti-Pattern 2: Semua Field Di-`@JsonbProperty`

```java
@JsonbProperty("firstName")
public String firstName;
```

Jika nama sama, annotation tidak memberi nilai. Ia hanya menambah noise.

Gunakan annotation ketika ada alasan kontrak.

### Anti-Pattern 3: Annotation untuk Business Logic

```java
@JsonbTypeAdapter(EligibilityDecisionAdapter.class)
public Eligibility eligibility;
```

Jika adapter menghitung eligibility, itu salah. Adapter hanya mengubah bentuk data.

### Anti-Pattern 4: Mengandalkan Null Default Tanpa Keputusan

```java
public String mobileNo;
```

Tanpa jelas apakah absent/null beda, PATCH/merge bisa salah.

### Anti-Pattern 5: Wire Contract Mengikuti Rename Refactor

Rename Java field:

```java
displayName -> fullName
```

lalu JSON ikut berubah:

```json
"displayName" -> "fullName"
```

Ini breaking change tersembunyi. Public JSON name harus dilindungi test.

---

## 26. Decision Matrix

| Masalah | Solusi Umum | Catatan |
|---|---|---|
| JSON name beda dari Java name | `@JsonbProperty` | Cocok untuk field spesifik |
| Semua field snake_case | `JsonbConfig` naming strategy | Jangan annotate semua field manual |
| Field sensitif tidak boleh keluar | DTO allowlist | `@JsonbTransient` hanya safety tambahan |
| Tanggal perlu format eksplisit | `@JsonbDateFormat` | Gunakan ISO/UTC/offset untuk machine contract |
| Money/decimal presisi | `BigDecimal` + explicit contract | Hindari `double` |
| Value object ke string | `@JsonbTypeAdapter` | Adapter stateless |
| Immutable object | `@JsonbCreator` | Pastikan parameter diberi property jelas |
| Unknown alias input | JSON-P normalize lalu JSON-B | JSON-B annotation tidak selalu cukup |
| PATCH absent vs null | JSON-P presence detection | Jangan bergantung nullable field biasa |
| Output deterministic | `@JsonbPropertyOrder` | Jangan buat consumer bergantung pada order |

---

## 27. Java 8 sampai 25 Compatibility Notes

### Java 8

- JSON-B 1.0 era memakai `javax.json.bind.*`.
- Banyak aplikasi berjalan dalam Java EE 8 container.
- DTO mutable JavaBean masih sangat umum.

### Java 11+

- Jangan mengandalkan Java EE API dari JDK.
- Tambahkan dependency JSON-B API dan provider eksplisit jika berjalan standalone.
- Untuk Jakarta namespace, gunakan `jakarta.json.bind.*`.

### Java 17/21/25

- Records, sealed classes, pattern matching membuat model Java lebih ekspresif.
- Tetapi support provider untuk fitur bahasa modern harus diverifikasi.
- Untuk library enterprise yang harus portable, class DTO eksplisit masih paling aman.
- JPMS/native-image memerlukan perhatian reflection metadata.

Migration principle:

```text
Pisahkan contract DTO dari domain agar migration javax -> jakarta tidak menyentuh seluruh core domain.
```

---

## 28. Checklist Review JSON-B Annotation

Gunakan checklist ini saat code review DTO:

```text
[ ] Apakah class ini DTO boundary, bukan entity/domain internal?
[ ] Apakah semua @JsonbProperty memang diperlukan?
[ ] Apakah nama JSON adalah public contract yang stabil?
[ ] Apakah field sensitif tidak ada di DTO sejak awal?
[ ] Apakah date/time field punya semantic jelas: LocalDate, Instant, OffsetDateTime?
[ ] Apakah format tanggal aman untuk machine-to-machine contract?
[ ] Apakah money/decimal tidak memakai double/float?
[ ] Apakah identifier besar dikirim sebagai string jika consumer JavaScript mungkin terlibat?
[ ] Apakah null vs absent sudah diputuskan?
[ ] Apakah PATCH memakai presence-aware approach jika dibutuhkan?
[ ] Apakah adapter stateless dan tidak melakukan I/O?
[ ] Apakah @JsonbCreator menjaga invariant object immutable?
[ ] Apakah enum wire value stabil dan tidak sekadar nama Java yang mudah berubah?
[ ] Apakah compatibility test melindungi JSON field names?
[ ] Apakah migration javax/jakarta jelas?
```

---

## 29. Mini Case Study: Regulatory Case Summary DTO

### 29.1 Requirement

Sistem perlu mengirim ringkasan enforcement case ke sistem lain:

```json
{
  "case_id": "CASE-2026-0001",
  "status": "SUBMITTED",
  "submitted_at": "2026-06-17T03:15:30.000Z",
  "officer_name": "Fajar",
  "risk_score": "87.50"
}
```

Constraint:

- `case_id` stable snake_case;
- `submitted_at` UTC ISO timestamp;
- `risk_score` perlu decimal precision dan aman untuk consumer;
- internal fields seperti `internalRoutingKey` tidak boleh keluar;
- Java domain memakai strong type `CaseId`.

### 29.2 DTO

```java
@JsonbPropertyOrder({
    "case_id",
    "status",
    "submitted_at",
    "officer_name",
    "risk_score"
})
public class RegulatoryCaseSummaryResponse {
    @JsonbProperty("case_id")
    @JsonbTypeAdapter(CaseIdAdapter.class)
    public CaseId caseId;

    public String status;

    @JsonbProperty("submitted_at")
    @JsonbDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX")
    public Instant submittedAt;

    @JsonbProperty("officer_name")
    public String officerName;

    @JsonbProperty("risk_score")
    @JsonbTypeAdapter(BigDecimalStringAdapter.class)
    public BigDecimal riskScore;
}
```

### 29.3 BigDecimal String Adapter

```java
public class BigDecimalStringAdapter implements JsonbAdapter<BigDecimal, String> {
    @Override
    public String adaptToJson(BigDecimal obj) {
        return obj == null ? null : obj.toPlainString();
    }

    @Override
    public BigDecimal adaptFromJson(String obj) {
        if (obj == null) {
            return null;
        }
        return new BigDecimal(obj);
    }
}
```

### 29.4 Kenapa Risk Score String?

Karena:

- consumer lintas bahasa bisa punya numeric precision berbeda;
- score mungkin perlu exact decimal display;
- JSON number tidak menyatakan precision/scale;
- string decimal lebih eksplisit sebagai contract.

Namun ini harus didokumentasikan. Jangan diam-diam mengubah numeric menjadi string tanpa agreement.

---

## 30. Mini Case Study: PATCH Profile

### 30.1 Problem

Request:

```json
{
  "email": null
}
```

harus berarti hapus email.

Request:

```json
{}
```

harus berarti email tidak diubah.

### 30.2 Jangan Langsung JSON-B ke DTO Nullable

```java
public class PatchProfileRequest {
    public String email;
}
```

Tidak cukup karena `email == null` bisa berasal dari absent atau explicit null.

### 30.3 Gunakan JSON-P untuk Presence Detection

```java
JsonObject obj = Json.createReader(reader).readObject();

FieldUpdate<String> emailUpdate;
if (obj.containsKey("email")) {
    if (obj.isNull("email")) {
        emailUpdate = FieldUpdate.of(null);
    } else {
        emailUpdate = FieldUpdate.of(obj.getString("email"));
    }
} else {
    emailUpdate = FieldUpdate.absent();
}
```

Lalu command:

```java
public final class PatchProfileCommand {
    private final FieldUpdate<String> email;

    public PatchProfileCommand(FieldUpdate<String> email) {
        this.email = email;
    }
}
```

Pelajaran:

```text
Annotation tidak selalu solusi terbaik.
Untuk semantic-level JSON handling, gabungkan JSON-P dan JSON-B.
```

---

## 31. Ringkasan Mental Model

JSON-B annotation harus dipahami sebagai:

```text
local metadata for mapping Java object shape to JSON contract shape
```

Tetapi boundary design tetap lebih penting daripada annotation.

Prinsip utama:

1. `@JsonbProperty` mengunci nama wire contract.
2. `@JsonbTransient` bukan pengganti DTO allowlist.
3. `@JsonbDateFormat` harus mencerminkan semantic waktu, bukan selera tampilan.
4. `@JsonbNumberFormat` harus berhati-hati dengan money, precision, dan locale.
5. `@JsonbTypeAdapter` ideal untuk value object dan legacy code mapping.
6. `@JsonbCreator` menjaga immutable object tetap bisa di-deserialize.
7. Null vs absent adalah semantic contract, bukan detail kecil.
8. Annotation sebaiknya hidup di DTO boundary, bukan domain/entity internal.
9. Compatibility harus dijaga dengan test, bukan ingatan developer.
10. Jika annotation mulai terlalu rumit, mungkin model boundary salah atau perlu JSON-P normalization.

---

## 32. Latihan Praktis

### Latihan 1

Buat DTO `PaymentResponse` dengan contract:

```json
{
  "payment_id": "PAY-001",
  "amount": "1250.50",
  "currency": "SGD",
  "paid_at": "2026-06-17T03:15:30.000Z"
}
```

Syarat:

- `payment_id` pakai `@JsonbProperty`;
- `amount` memakai `BigDecimal` dan adapter string;
- `paid_at` memakai `Instant` dengan format eksplisit;
- buat test serialization semantic dengan JSON-P.

### Latihan 2

Desain `CreateCaseRequest` immutable dengan `@JsonbCreator`:

```json
{
  "subject": "Unauthorized activity",
  "priority": "HIGH"
}
```

Syarat:

- constructor menolak blank subject;
- priority harus enum;
- unknown priority menghasilkan error yang bisa dimapping ke `INVALID_REQUEST_BODY`.

### Latihan 3

Ambil DTO yang pernah dibuat di sistem nyata. Review:

```text
- field mana yang sebenarnya public contract?
- field mana yang internal tapi ikut DTO?
- apakah null/absent jelas?
- apakah date/time punya timezone?
- apakah enum name Java bocor ke contract?
```

---

## 33. Apa yang Akan Dibahas di Part Berikutnya

Part 9 akan membahas:

```text
JSON-B Customization & Provider Internals
```

Fokusnya:

- `JsonbConfig` advanced;
- serializers/deserializers/adapters secara global;
- provider behavior;
- Yasson sebagai reference implementation;
- thread-safety dan lifecycle;
- strict vs lenient binding;
- unknown field strategy;
- performance dan metadata caching;
- integration dengan Jakarta REST/runtime container.

---

## 34. Referensi

- Jakarta JSON Binding specification page: `https://jakarta.ee/specifications/jsonb/`
- Jakarta JSON Binding 3.0 specification: `https://jakarta.ee/specifications/jsonb/3.0/jakarta-jsonb-spec-3.0`
- Jakarta JSON Binding 3.0 API docs: `https://jakarta.ee/specifications/jsonb/3.0/apidocs/`
- Jakarta JSON Binding annotation package docs: `https://jakarta.ee/specifications/coreprofile/11/apidocs/jakarta/json/bind/annotation/package-summary`
- Jakarta EE Tutorial, JSON Binding: `https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonb/jsonb.html`
- OpenLiberty JSON-P and JSON-B guide: `https://openliberty.io/docs/latest/json-p-b.html`

---

## 35. Status Seri

Seri belum selesai.

Saat ini selesai:

```text
Part 0  - Orientation & Mental Model
Part 1  - Data Format as Contract
Part 2  - Java JSON Ecosystem Map
Part 3  - JSON-P Core Mental Model
Part 4  - JSON-P Streaming Deep Dive
Part 5  - JSON-P Transformation & Mutation
Part 6  - JSON-P Advanced Production Patterns
Part 7  - JSON-B Core Model
Part 8  - JSON-B Annotation Deep Dive
```

Berikutnya:

```text
Part 9 - JSON-B Customization & Provider Internals
```
