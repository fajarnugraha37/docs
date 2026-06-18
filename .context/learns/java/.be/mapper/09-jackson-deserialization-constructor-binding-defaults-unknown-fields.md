# Part 9 — Jackson Deserialization: Constructor Binding, Defaults, Unknown Fields

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `09-jackson-deserialization-constructor-binding-defaults-unknown-fields.md`  
> Fokus: inbound JSON → Java object secara aman, eksplisit, kompatibel, dan dapat diaudit.  
> Target: Java 8 sampai Java 25, Jackson 2.x dan arah migrasi ke Jackson 3.x.

---

## 1. Kenapa Deserialization Lebih Berisiko daripada Serialization

Serialization adalah proses mengubah object Java menjadi JSON. Deserialization adalah proses sebaliknya: JSON dari luar sistem masuk menjadi object Java.

Keduanya penting, tetapi deserialization biasanya lebih berisiko karena input berasal dari boundary yang tidak sepenuhnya kita kontrol.

Pada serialization, sistem mengeluarkan data yang sudah ada di memory. Risiko utamanya adalah data leakage, shape contract berubah, atau format tidak sesuai.

Pada deserialization, sistem menerima payload yang bisa:

- field-nya kurang,
- field-nya berlebih,
- field-nya null,
- tipe field-nya salah,
- enum value-nya tidak dikenal,
- number-nya terlalu besar,
- string-nya kosong tetapi dianggap valid,
- object-nya nested terlalu dalam,
- field internal disisipkan oleh client,
- payload lama dikirim ke endpoint baru,
- payload baru dikirim ke service lama.

Karena itu, deserialization bukan sekadar parsing. Ia adalah **inbound contract enforcement layer**.

Mental model penting:

```text
External JSON
    ↓
Parsing
    ↓
Binding
    ↓
Coercion / conversion
    ↓
Object construction
    ↓
Validation
    ↓
Application command/query model
```

Bug sering muncul karena engineer mengira seluruh proses itu hanya satu langkah: `readValue()`.

---

## 2. Deserialization adalah Boundary, Bukan Convenience

Kode seperti ini terlihat sederhana:

```java
OrderRequest request = objectMapper.readValue(json, OrderRequest.class);
```

Tetapi secara semantik, baris itu menjawab banyak pertanyaan besar:

- field apa saja yang boleh diterima?
- field mana yang wajib?
- apa arti field yang hilang?
- apa arti field yang dikirim `null`?
- apakah field tambahan harus ditolak atau diabaikan?
- apakah string kosong boleh dianggap null?
- apakah angka string seperti `"123"` boleh menjadi integer?
- apakah enum tidak dikenal boleh menjadi null?
- constructor mana yang dipakai?
- apakah default value dari Java object adalah default bisnis atau hanya default teknis?
- apakah object hasil binding sudah valid?
- apakah object hasil binding aman untuk masuk domain/service layer?

Top-level engineer tidak memperlakukan deserialization sebagai library magic. Mereka memperlakukannya sebagai bagian dari desain kontrak.

---

## 3. Tiga Mode Deserialization Utama

Jackson dapat membuat object dengan beberapa cara.

### 3.1 Mutable JavaBean Binding

Bentuk klasik:

```java
public class CreateUserRequest {
    private String username;
    private String email;

    public CreateUserRequest() {
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
```

Jackson akan:

1. membuat instance menggunakan no-args constructor,
2. menemukan setter atau field,
3. mengisi property satu per satu.

Kelebihan:

- mudah dipahami,
- kompatibel dengan Java 8,
- bekerja baik dengan banyak framework,
- cocok untuk DTO sederhana.

Kekurangan:

- object bisa berada pada keadaan partially initialized,
- field wajib tidak terjamin oleh constructor,
- mutability tinggi,
- default value sering ambigu,
- setter bisa dipanggil dari luar setelah binding.

Contoh risiko:

```java
public class TransferRequest {
    private String fromAccount;
    private String toAccount;
    private BigDecimal amount;

    public TransferRequest() {
    }

    // getters setters
}
```

Payload ini tetap bisa menghasilkan object:

```json
{
  "fromAccount": "A-001"
}
```

Secara teknis object berhasil dibuat. Secara bisnis, object itu tidak valid.

Karena itu JavaBean binding harus hampir selalu dipasangkan dengan validation.

---

### 3.2 Constructor Binding

Constructor binding membuat object melalui constructor eksplisit.

```java
public class CreateUserRequest {
    private final String username;
    private final String email;

    @JsonCreator
    public CreateUserRequest(
            @JsonProperty("username") String username,
            @JsonProperty("email") String email
    ) {
        this.username = username;
        this.email = email;
    }

    public String getUsername() {
        return username;
    }

    public String getEmail() {
        return email;
    }
}
```

Kelebihan:

- object bisa immutable,
- semua dependency construction terlihat,
- field penting bisa dipusatkan di constructor,
- lebih cocok untuk DTO modern.

Kekurangan:

- perlu konfigurasi/annotation yang benar,
- required semantics masih harus dipahami hati-hati,
- null masih bisa masuk kecuali ditolak eksplisit,
- constructor yang terlalu banyak parameter menjadi sulit dibaca.

Catatan penting: `@JsonProperty(required = true)` tidak selalu berarti validasi bisnis lengkap. Ia membantu metadata dan beberapa mode failure, tetapi tidak menggantikan Bean Validation atau pengecekan invariant.

---

### 3.3 Record Binding

Sejak Java 16, records menjadi bentuk natural untuk immutable carrier.

```java
public record CreateUserRequest(
        String username,
        String email
) {
}
```

Jackson modern dapat melakukan binding ke record component.

Kelebihan:

- ringkas,
- immutable by design,
- constructor canonical jelas,
- property model eksplisit,
- sangat cocok untuk DTO kecil-menengah.

Kekurangan:

- tidak cocok untuk semua object,
- default value tidak senatural class mutable,
- compatibility perubahan component perlu diperhatikan,
- nested complex record bisa sulit dibaca,
- Java 8 codebase tidak bisa langsung memakai record.

Record dengan compact constructor:

```java
public record CreateUserRequest(
        String username,
        String email
) {
    public CreateUserRequest {
        if (username != null) {
            username = username.trim();
        }
        if (email != null) {
            email = email.trim().toLowerCase(Locale.ROOT);
        }
    }
}
```

Ini bisa berguna untuk normalization ringan, tetapi harus hati-hati. Jangan menaruh logic bisnis berat di record constructor.

---

## 4. Object Construction adalah Contract Decision

Saat payload masuk:

```json
{
  "username": "alice",
  "email": "alice@example.com"
}
```

Jackson harus memilih cara membuat object.

Secara umum, Jackson mencari:

- default constructor,
- property-based creator,
- delegating creator,
- record canonical constructor,
- builder,
- factory method,
- custom deserializer.

Urutan dan detail bisa dipengaruhi oleh:

- annotation,
- module,
- visibility configuration,
- parameter name availability,
- compiler flag `-parameters`,
- Lombok-generated constructors/builders,
- record metadata,
- Jackson version.

Masalah besar muncul ketika cara construction tidak eksplisit.

Contoh:

```java
public class MoneyRequest {
    private final BigDecimal amount;
    private final String currency;

    public MoneyRequest(BigDecimal amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }
}
```

Tanpa parameter name metadata atau annotation, Jackson mungkin tidak tahu bahwa constructor parameter pertama bernama `amount` dan parameter kedua bernama `currency`.

Lebih aman:

```java
public class MoneyRequest {
    private final BigDecimal amount;
    private final String currency;

    @JsonCreator
    public MoneyRequest(
            @JsonProperty("amount") BigDecimal amount,
            @JsonProperty("currency") String currency
    ) {
        this.amount = amount;
        this.currency = currency;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }
}
```

Prinsip:

> Untuk DTO boundary penting, lebih baik construction eksplisit daripada berharap framework menebak dengan benar.

---

## 5. Property-Based Creator vs Delegating Creator

`@JsonCreator` memiliki beberapa mode. Dua yang paling sering penting adalah property-based dan delegating.

### 5.1 Property-Based Creator

Digunakan ketika JSON object dipetakan ke beberapa parameter.

```java
public class CustomerId {
    private final String value;
    private final String source;

    @JsonCreator(mode = JsonCreator.Mode.PROPERTIES)
    public CustomerId(
            @JsonProperty("value") String value,
            @JsonProperty("source") String source
    ) {
        this.value = value;
        this.source = source;
    }
}
```

Payload:

```json
{
  "value": "C-001",
  "source": "CRM"
}
```

### 5.2 Delegating Creator

Digunakan ketika seluruh JSON value diserahkan ke satu parameter.

```java
public class CustomerId {
    private final String value;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public CustomerId(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
```

Payload:

```json
"C-001"
```

Ini cocok untuk value object sederhana.

Namun hati-hati: jika external contract mengirim object tetapi Java object memakai delegating creator, bentuk JSON tidak sama.

```json
"C-001"
```

berbeda dengan:

```json
{
  "value": "C-001"
}
```

Perbedaan ini bukan kosmetik. Itu contract breaking change.

---

## 6. Missing Field, Null Field, Empty Field: Tiga Hal Berbeda

Salah satu mental model paling penting:

```text
missing ≠ null ≠ empty
```

### 6.1 Missing Field

Payload:

```json
{
  "email": "alice@example.com"
}
```

`username` tidak ada.

Makna potensial:

- client lama tidak tahu field itu,
- client bug,
- field optional,
- field sengaja omitted untuk PATCH,
- field harus default.

### 6.2 Null Field

Payload:

```json
{
  "username": null,
  "email": "alice@example.com"
}
```

`username` dikirim eksplisit sebagai null.

Makna potensial:

- client ingin menghapus value,
- client tidak punya value,
- client bug,
- field nullable,
- field wajib tapi null.

### 6.3 Empty Field

Payload:

```json
{
  "username": "",
  "email": "alice@example.com"
}
```

`username` ada, tetapi kosong.

Makna potensial:

- string kosong sebagai value valid,
- input form belum diisi,
- client mengirim empty string untuk null,
- perlu trimming/normalization,
- invalid request.

Jangan samakan ketiganya tanpa keputusan sadar.

---

## 7. Required Field: Apa yang Sebenarnya Wajib?

Field bisa wajib pada beberapa level:

```text
JSON-level required
    Field harus ada di payload.

Binding-level required
    Field harus bisa di-bind ke Java object.

Validation-level required
    Field tidak boleh null/blank/invalid.

Domain-level required
    Field dibutuhkan untuk menjaga invariant bisnis.

Persistence-level required
    Kolom database NOT NULL.
```

Kesalahan umum adalah mengandalkan satu layer untuk semua.

Contoh DTO:

```java
public record RegisterUserRequest(
        @NotBlank String username,
        @Email @NotBlank String email
) {
}
```

Jika payload:

```json
{
  "email": "alice@example.com"
}
```

Jackson bisa membuat record dengan `username = null`, lalu Bean Validation menolak `@NotBlank`.

Itu biasanya cukup untuk API validation.

Tetapi kalau kamu ingin membedakan error:

- missing field,
- null field,
- blank field,

maka perlu strategi lebih eksplisit.

---

## 8. `@JsonProperty(required = true)` Tidak Sama dengan `@NotNull`

Contoh:

```java
public class CreateOrderRequest {
    private final String productCode;

    @JsonCreator
    public CreateOrderRequest(
            @JsonProperty(value = "productCode", required = true) String productCode
    ) {
        this.productCode = productCode;
    }

    public String getProductCode() {
        return productCode;
    }
}
```

`required = true` memberi sinyal bahwa property dibutuhkan untuk creator property.

Namun dalam praktik production, jangan hanya bergantung pada itu untuk validasi bisnis. Lebih aman gunakan validation eksplisit:

```java
public record CreateOrderRequest(
        @NotBlank String productCode
) {
}
```

Atau validasi manual pada boundary command:

```java
public CreateOrderCommand toCommand(CreateOrderRequest request) {
    if (request.productCode() == null || request.productCode().isBlank()) {
        throw new BadRequestException("productCode is required");
    }
    return new CreateOrderCommand(request.productCode().trim());
}
```

Prinsip:

> Jackson binding menjawab “bisa dibentuk menjadi object atau tidak”. Validation menjawab “object ini valid atau tidak”. Domain menjawab “aksi ini menjaga invariant atau tidak”.

---

## 9. Unknown Fields: Ignore atau Fail?

Unknown field adalah field yang ada di JSON tetapi tidak ada di Java DTO.

Payload:

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "role": "ADMIN"
}
```

DTO:

```java
public record RegisterUserRequest(
        String username,
        String email
) {
}
```

Field `role` unknown.

Ada dua strategi utama.

### 9.1 Ignore Unknown Fields

Keuntungan:

- lebih forward-compatible,
- client baru bisa bicara ke server lama,
- cocok untuk event consumer yang tolerant reader,
- cocok untuk external integration yang payload-nya evolutif.

Risiko:

- typo client tidak ketahuan,
- field berbahaya bisa diam-diam diabaikan,
- over-posting attempt tidak terlihat,
- contract drift tersembunyi.

Contoh:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record RegisterUserRequest(
        String username,
        String email
) {
}
```

Atau global:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
```

### 9.2 Fail on Unknown Fields

Keuntungan:

- strict contract,
- typo cepat ketahuan,
- API lebih defensif,
- mengurangi silent client bug,
- mengurangi risiko field injection.

Risiko:

- forward compatibility rendah,
- client baru bisa gagal saat server lama,
- integrasi eksternal lebih fragile.

Contoh:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Rekomendasi:

```text
Public command/request API      → fail on unknown by default
Internal event consumer         → often ignore unknown/tolerant reader
External legacy integration     → depends; usually isolate with adapter
Admin/internal trusted endpoint → still prefer strict for write commands
Read/filter query DTO           → strict unless compatibility requires lenient
```

---

## 10. Unknown Field sebagai Security Signal

Unknown field tidak selalu harmless.

Contoh payload:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "isAdmin": true,
  "status": "APPROVED",
  "createdBy": "attacker"
}
```

Jika endpoint register user mengabaikan unknown fields, payload ini mungkin tidak langsung merusak. Tetapi ini bisa menjadi sinyal probing: client mencoba mencari field internal yang mungkin diterima oleh DTO/entity lain.

Jika sistem memakai entity sebagai request object, ini jauh lebih berbahaya:

```java
@PostMapping("/users")
public User create(@RequestBody User user) {
    return userRepository.save(user);
}
```

Jika `User` punya field `role`, `status`, atau `approved`, client bisa melakukan over-posting.

Deserialization safe design:

```text
Never deserialize untrusted input directly into entity/domain aggregate.
Use dedicated request DTO.
Fail unknown fields for write commands unless there is a deliberate compatibility reason.
Do not expose privileged fields in inbound DTO.
```

---

## 11. Default Values: Technical Default vs Business Default

Default value sering menjadi sumber bug karena Java punya default teknis.

```java
public class SearchRequest {
    private int page;
    private int size;
}
```

Jika payload kosong:

```json
{}
```

Maka:

```text
page = 0
size = 0
```

Apakah `size = 0` valid? Apakah artinya default size? Atau invalid?

Masalahnya: primitive tidak bisa membedakan missing dengan value eksplisit `0`.

Payload:

```json
{
  "size": 0
}
```

menghasilkan value sama dengan payload:

```json
{}
```

Karena itu untuk inbound DTO sering lebih aman memakai wrapper type:

```java
public record SearchRequest(
        Integer page,
        Integer size
) {
}
```

Lalu defaulting dilakukan eksplisit:

```java
public SearchCommand toCommand(SearchRequest request) {
    int page = request.page() == null ? 0 : request.page();
    int size = request.size() == null ? 20 : request.size();

    if (page < 0) {
        throw new BadRequestException("page must be >= 0");
    }
    if (size < 1 || size > 100) {
        throw new BadRequestException("size must be between 1 and 100");
    }

    return new SearchCommand(page, size);
}
```

Prinsip:

> Jangan biarkan default teknis Java diam-diam menjadi default bisnis.

---

## 12. Primitive vs Wrapper dalam Request DTO

Bandingkan:

```java
public record UpdateQuantityRequest(
        int quantity
) {
}
```

vs:

```java
public record UpdateQuantityRequest(
        Integer quantity
) {
}
```

Dengan `int`, missing field menjadi `0`. Dengan `Integer`, missing field menjadi `null`.

Untuk request DTO, wrapper sering lebih ekspresif karena bisa membedakan:

- tidak dikirim,
- dikirim null,
- dikirim angka valid,
- dikirim angka invalid.

Namun untuk internal command yang sudah valid, primitive bisa lebih tepat:

```java
public record UpdateQuantityCommand(
        int quantity
) {
    public UpdateQuantityCommand {
        if (quantity < 1) {
            throw new IllegalArgumentException("quantity must be positive");
        }
    }
}
```

Boundary DTO:

```text
Integer quantity  // raw inbound, nullable
```

Application command:

```text
int quantity      // already validated invariant
```

---

## 13. Null Handling Strategy

Jackson memiliki banyak fitur null handling, tetapi mental model-nya harus jelas dulu.

Pertanyaan desain:

1. Apakah field boleh null?
2. Apakah null berarti clear existing value?
3. Apakah null berarti unknown?
4. Apakah null harus ditolak?
5. Apakah null harus diganti default?
6. Apakah null berbeda dengan missing?

Contoh create request:

```json
{
  "name": null
}
```

Untuk create, biasanya null invalid.

Contoh patch request:

```json
{
  "middleName": null
}
```

Untuk patch, null mungkin berarti hapus `middleName`.

Karena itu null policy tidak bisa global secara membabi buta.

---

## 14. PATCH: Absent vs Null adalah Semantik Utama

PATCH adalah tempat deserialization paling sering salah.

Payload:

```json
{
  "displayName": "Alice"
}
```

Artinya:

```text
update displayName, field lain jangan disentuh
```

Payload:

```json
{
  "displayName": null
}
```

Bisa berarti:

```text
hapus displayName
```

atau:

```text
invalid karena displayName tidak boleh null
```

Kalau DTO sederhana:

```java
public record PatchUserRequest(
        String displayName,
        String phoneNumber
) {
}
```

Maka field absent dan field null sama-sama menjadi `null`. Informasi hilang.

Solusi yang mungkin:

### 14.1 Gunakan JSON Merge Patch

Terima payload sebagai `JsonNode` atau `JsonMergePatch`, lalu proses patch semantics eksplisit.

### 14.2 Gunakan Wrapper Presence Type

Contoh konsep:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    private PatchField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> PatchField<T> absent() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> present(T value) {
        return new PatchField<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T value() {
        return value;
    }
}
```

### 14.3 Gunakan Map/JsonNode untuk Patch Layer

```java
public void patchUser(String id, JsonNode patch) {
    if (patch.has("displayName")) {
        JsonNode displayNameNode = patch.get("displayName");
        if (displayNameNode.isNull()) {
            user.clearDisplayName();
        } else {
            user.changeDisplayName(displayNameNode.asText());
        }
    }
}
```

Prinsip:

> Jika operasi membutuhkan perbedaan absent vs null, jangan pakai DTO biasa yang menghilangkan informasi presence.

---

## 15. Coercion: Ketika Jackson “Membantu” Terlalu Banyak

Jackson secara historis cukup fleksibel dalam menerima bentuk input yang tidak persis.

Contoh payload:

```json
{
  "quantity": "10"
}
```

DTO:

```java
public record OrderRequest(Integer quantity) {
}
```

Jackson bisa mengubah string `"10"` menjadi integer `10` tergantung konfigurasi.

Contoh lain:

```json
{
  "active": "true"
}
```

bisa menjadi boolean `true`.

Ini nyaman untuk integration legacy. Tetapi untuk public API modern, ini bisa menyembunyikan bug client.

Pertanyaan penting:

```text
Apakah API kita strict typed, atau tolerant terhadap client buruk?
```

Untuk command API internal/modern, strict lebih baik.

Untuk integrasi legacy, tolerant boleh, tetapi isolasi di adapter.

---

## 16. String Kosong: Value, Null, atau Invalid?

Payload:

```json
{
  "email": ""
}
```

Kemungkinan:

- invalid,
- dianggap null,
- dianggap empty string valid,
- perlu trim lalu invalid,
- perlu trim lalu null.

Untuk kebanyakan business input:

```text
blank string is not a valid meaningful value
```

DTO validation:

```java
public record RegisterRequest(
        @NotBlank String email
) {
}
```

Namun kalau input perlu normalization:

```java
public record RegisterRequest(
        String email
) {
    public RegisterRequest {
        if (email != null) {
            email = email.trim();
        }
    }
}
```

Lalu validation menolak blank.

Peringatan: jangan global mengubah empty string menjadi null tanpa sadar. Itu bisa mengubah semantics untuk field yang memang boleh empty string.

---

## 17. Enum Deserialization

Enum terlihat sederhana tetapi sering menjadi breaking point compatibility.

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

DTO:

```java
public record ApplicationRequest(
        ApplicationStatus status
) {
}
```

Payload valid:

```json
{
  "status": "SUBMITTED"
}
```

Payload tidak dikenal:

```json
{
  "status": "PENDING_REVIEW"
}
```

Pertanyaan:

- harus fail?
- menjadi null?
- menjadi UNKNOWN?
- disimpan raw string?
- diperlakukan sebagai future enum?

Untuk write command, fail biasanya benar.

Untuk event consumer atau integration reader, `UNKNOWN` kadang lebih aman agar consumer tidak mati saat producer menambah enum baru.

Contoh enum dengan unknown:

```java
public enum ExternalStatus {
    ACTIVE,
    SUSPENDED,
    CLOSED,
    UNKNOWN
}
```

Namun hati-hati: `UNKNOWN` bisa menyembunyikan perubahan penting.

Rekomendasi:

```text
Inbound write command       → reject unknown enum
Inbound external event      → consider tolerant enum strategy
Internal domain state       → avoid UNKNOWN unless domain benar-benar punya state unknown
Reporting/read model        → UNKNOWN bisa acceptable bila ditampilkan sebagai unsupported/new value
```

---

## 18. Case-Insensitive Enum: Convenience atau Contract Weakness?

Payload:

```json
{
  "status": "submitted"
}
```

bisa diterima jika case-insensitive enum diaktifkan.

Keuntungan:

- lebih ramah client,
- mengurangi masalah casing.

Kerugian:

- kontrak kurang presisi,
- typo tertentu bisa lolos,
- sulit menjaga consistency antar client.

Untuk API publik yang ingin kontrak rapi, lebih baik dokumentasikan casing dan enforce.

Untuk legacy integration, case-insensitive bisa diterima di adapter.

---

## 19. Number Deserialization: Integer, Long, BigDecimal

JSON number tidak membawa tipe Java. Payload:

```json
{
  "amount": 100.10
}
```

Bisa menjadi:

- `double`,
- `BigDecimal`,
- `String`,
- custom Money object.

Untuk money atau regulatory value, hindari floating point binary.

Buruk:

```java
public record PaymentRequest(double amount) {
}
```

Lebih baik:

```java
public record PaymentRequest(BigDecimal amount) {
}
```

Namun `BigDecimal` juga punya detail:

```text
100.10 berbeda scale dari 100.1
```

Apakah scale penting? Untuk money biasanya iya.

Validasi:

```java
public record PaymentRequest(
        @NotNull
        @DecimalMin(value = "0.01")
        @Digits(integer = 12, fraction = 2)
        BigDecimal amount
) {
}
```

Jangan bergantung pada deserialization untuk semua constraint numerik.

---

## 20. Date/Time Deserialization

Tanggal/waktu adalah sumber bug besar.

Payload:

```json
{
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Java type pilihan:

- `Instant`
- `OffsetDateTime`
- `ZonedDateTime`
- `LocalDateTime`
- `LocalDate`
- `LocalTime`

Prinsip:

```text
Instant          → titik waktu global
OffsetDateTime   → waktu dengan offset, bagus untuk API boundary
ZonedDateTime    → waktu dengan zona aturan DST
LocalDateTime    → waktu lokal tanpa offset; berbahaya untuk event global
LocalDate        → tanggal kalender
```

Untuk audit timestamp:

```java
Instant submittedAt
```

Untuk appointment user dengan zona:

```java
OffsetDateTime appointmentTime
```

Untuk tanggal lahir:

```java
LocalDate dateOfBirth
```

Pastikan `JavaTimeModule` terdaftar pada ObjectMapper.

---

## 21. Field Alias dan Rename Compatibility

Ketika field berubah nama:

Versi lama:

```json
{
  "mobileNo": "81234567"
}
```

Versi baru:

```json
{
  "phoneNumber": "81234567"
}
```

DTO:

```java
public record ContactRequest(
        @JsonAlias({"mobileNo", "mobileNumber"})
        String phoneNumber
) {
}
```

`@JsonAlias` membantu backward compatibility inbound.

Namun hati-hati:

- alias hanya untuk deserialization,
- serialization tetap memakai property utama,
- konflik alias perlu dipikirkan,
- jangan mempertahankan alias selamanya tanpa deprecation policy.

Jika payload mengirim dua field:

```json
{
  "mobileNo": "1111",
  "phoneNumber": "2222"
}
```

Apa yang harus terjadi?

Lebih baik buat test eksplisit untuk kasus konflik.

---

## 22. Read-Only dan Write-Only Field

Beberapa field boleh keluar tetapi tidak boleh masuk.

Contoh response punya `id`, request tidak boleh mengirim `id`.

Buruk:

```java
public class UserDto {
    public Long id;
    public String name;
}
```

Jika class sama dipakai request dan response, client bisa mengirim `id`.

Lebih baik pisah DTO:

```java
public record CreateUserRequest(
        String name
) {
}

public record UserResponse(
        Long id,
        String name
) {
}
```

Kalau benar-benar butuh satu class, Jackson menyediakan access control:

```java
public class UserDto {
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    private Long id;

    private String name;
}
```

Namun untuk desain yang bersih, pisahkan request dan response DTO.

---

## 23. Builder-Based Deserialization

Builder sering dipakai untuk immutable class, terutama dengan Lombok.

Manual builder:

```java
@JsonDeserialize(builder = CreateUserRequest.Builder.class)
public class CreateUserRequest {
    private final String username;
    private final String email;

    private CreateUserRequest(Builder builder) {
        this.username = builder.username;
        this.email = builder.email;
    }

    public static class Builder {
        private String username;
        private String email;

        public Builder username(String username) {
            this.username = username;
            return this;
        }

        public Builder email(String email) {
            this.email = email;
            return this;
        }

        public CreateUserRequest build() {
            return new CreateUserRequest(this);
        }
    }
}
```

Jackson perlu tahu prefix method builder. Jika builder method tidak memakai `withX`, perlu annotation:

```java
@JsonPOJOBuilder(withPrefix = "")
public static class Builder {
    // builder methods
}
```

Dengan Lombok, biasanya:

```java
@Value
@Builder
@Jacksonized
public class CreateUserRequest {
    String username;
    String email;
}
```

Pembahasan detail Lombok + Jackson akan masuk Part 25, tetapi prinsipnya:

> Builder deserialization bagus untuk immutable object, tetapi pastikan shape builder terlihat jelas oleh Jackson dan test payload wajib ada.

---

## 24. Nested Object Deserialization

Payload:

```json
{
  "customer": {
    "name": "Alice",
    "email": "alice@example.com"
  },
  "shippingAddress": {
    "line1": "Street 1",
    "postalCode": "123456"
  }
}
```

DTO:

```java
public record CreateOrderRequest(
        CustomerRequest customer,
        AddressRequest shippingAddress
) {
}

public record CustomerRequest(
        String name,
        String email
) {
}

public record AddressRequest(
        String line1,
        String postalCode
) {
}
```

Pertanyaan penting:

- Apakah `customer` wajib ada?
- Apakah `shippingAddress` wajib ada?
- Apakah nested object boleh empty `{}`?
- Apakah unknown field di nested object juga ditolak?
- Apakah validation cascade diaktifkan?

Bean Validation cascade:

```java
public record CreateOrderRequest(
        @Valid @NotNull CustomerRequest customer,
        @Valid @NotNull AddressRequest shippingAddress
) {
}

public record CustomerRequest(
        @NotBlank String name,
        @Email @NotBlank String email
) {
}
```

Tanpa `@Valid`, nested validation bisa tidak berjalan.

---

## 25. Collection Deserialization

Payload:

```json
{
  "items": [
    { "sku": "A", "quantity": 2 },
    { "sku": "B", "quantity": 1 }
  ]
}
```

DTO:

```java
public record CreateOrderRequest(
        @NotEmpty List<@Valid OrderItemRequest> items
) {
}

public record OrderItemRequest(
        @NotBlank String sku,
        @Min(1) int quantity
) {
}
```

Perhatikan:

- `items = null` berbeda dengan `items = []`,
- list item null perlu ditolak jika tidak valid,
- duplicate item mungkin perlu dicek di mapper/service,
- jumlah item perlu dibatasi,
- collection terlalu besar bisa menjadi resource exhaustion.

Validasi size:

```java
public record CreateOrderRequest(
        @NotEmpty
        @Size(max = 100)
        List<@NotNull @Valid OrderItemRequest> items
) {
}
```

Namun duplicate SKU adalah semantic validation, bukan sekadar deserialization:

```java
private void validateNoDuplicateSku(List<OrderItemRequest> items) {
    Set<String> seen = new HashSet<>();
    for (OrderItemRequest item : items) {
        if (!seen.add(item.sku())) {
            throw new BadRequestException("duplicate sku: " + item.sku());
        }
    }
}
```

---

## 26. Map Deserialization

Payload:

```json
{
  "attributes": {
    "source": "WEB",
    "campaign": "JUNE"
  }
}
```

DTO:

```java
public record TrackingRequest(
        Map<String, String> attributes
) {
}
```

Map memberi fleksibilitas, tetapi juga mengurangi contract clarity.

Risiko:

- key tidak tervalidasi,
- value terlalu panjang,
- reserved key disisipkan,
- schema tidak jelas,
- query/reporting sulit,
- security review lebih sulit.

Gunakan Map jika:

- payload benar-benar dynamic,
- key space dikontrol,
- ada validation key/value,
- Map tidak menggantikan DTO yang seharusnya eksplisit.

Contoh validasi manual:

```java
private static final Set<String> ALLOWED_KEYS = Set.of("source", "campaign", "channel");

public void validateAttributes(Map<String, String> attributes) {
    if (attributes == null) {
        return;
    }
    if (attributes.size() > 20) {
        throw new BadRequestException("too many attributes");
    }
    for (Map.Entry<String, String> entry : attributes.entrySet()) {
        if (!ALLOWED_KEYS.contains(entry.getKey())) {
            throw new BadRequestException("unsupported attribute: " + entry.getKey());
        }
        if (entry.getValue() != null && entry.getValue().length() > 100) {
            throw new BadRequestException("attribute too long: " + entry.getKey());
        }
    }
}
```

---

## 27. Root Array vs Root Object

Payload root object:

```json
{
  "items": [
    { "id": "A" },
    { "id": "B" }
  ]
}
```

Payload root array:

```json
[
  { "id": "A" },
  { "id": "B" }
]
```

Root array terlihat sederhana, tetapi root object sering lebih evolvable.

Root object bisa menambah metadata:

```json
{
  "requestId": "REQ-001",
  "items": [
    { "id": "A" }
  ],
  "options": {
    "dryRun": true
  }
}
```

Untuk API yang mungkin berkembang, root object lebih aman.

---

## 28. Deserialization Error Message

Error deserialization harus membantu client, tetapi tidak membocorkan internal.

Buruk:

```text
com.fasterxml.jackson.databind.exc.InvalidFormatException: Cannot deserialize value of type ...
```

Lebih baik external response:

```json
{
  "code": "INVALID_JSON_FIELD",
  "message": "Field 'quantity' must be a number.",
  "field": "items[0].quantity",
  "correlationId": "abc-123"
}
```

Internal log bisa lebih detail:

```text
InvalidFormatException path=items[0].quantity targetType=Integer value="abc" correlationId=abc-123
```

Prinsip:

```text
External error: stable, safe, useful.
Internal log: diagnostic, correlated, sanitized.
```

---

## 29. Exception Taxonomy untuk Deserialization

Beberapa kategori error:

```text
Malformed JSON
    JSON tidak valid secara syntax.

Unexpected token
    Field mengharapkan object tetapi menerima array/string.

Invalid format
    Value tidak bisa dikonversi ke tipe target.

Unknown property
    Field tidak dikenal.

Missing creator property
    Field wajib constructor tidak ada.

Null for primitive
    Null dikirim untuk tipe primitive.

Invalid subtype
    Polymorphic type tidak valid.

Payload too large
    Ukuran request melewati batas.

Depth too deep
    Nested object terlalu dalam.
```

Untuk API yang baik, tidak semua harus menjadi generic `400 Bad Request` tanpa detail. Tetapi detail harus aman.

---

## 30. Strict Request ObjectMapper vs Lenient Integration ObjectMapper

Satu ObjectMapper global untuk semua boundary sering berbahaya.

Lebih baik pikirkan beberapa profile:

```text
apiRequestObjectMapper
    strict unknown fields
    strict coercion
    safe date/time
    no unsafe polymorphic default typing

apiResponseObjectMapper
    controlled inclusion
    masking support
    stable naming strategy

legacyIntegrationObjectMapper
    maybe lenient unknown fields
    maybe custom date formats
    maybe string-to-number coercion
    isolated from public API mapper

eventObjectMapper
    tolerant reader strategy
    explicit enum compatibility policy
```

Bukan berarti harus membuat banyak mapper di setiap project. Tetapi secara desain, boundary berbeda sering butuh policy berbeda.

---

## 31. Fail-Fast vs Tolerant Reader

Dua filosofi utama:

### 31.1 Fail-Fast

Digunakan saat input harus persis sesuai kontrak.

Cocok untuk:

- write command API,
- admin operation,
- financial/regulatory operation,
- internal service contract yang dikontrol ketat,
- security-sensitive endpoint.

Benefit:

- bug cepat terlihat,
- contract kuat,
- diagnosis mudah,
- data lebih bersih.

Cost:

- backward/forward compatibility lebih sulit,
- client harus disiplin.

### 31.2 Tolerant Reader

Digunakan saat consumer harus bertahan terhadap payload yang berevolusi.

Cocok untuk:

- event consumer,
- external integration,
- analytics pipeline,
- log ingestion,
- backward-compatible message reader.

Benefit:

- lebih resilient terhadap perubahan additive,
- mengurangi consumer breakage,
- cocok untuk distributed systems.

Cost:

- typo bisa tersembunyi,
- semantic drift bisa tidak terlihat,
- butuh monitoring contract drift.

Top-level rule:

> Be strict when accepting commands that change state. Be tolerant when reading events you do not fully control, but make tolerance observable.

---

## 32. Over-Posting dan Entity Deserialization

Anti-pattern:

```java
@PostMapping("/applications")
public Application create(@RequestBody Application application) {
    return applicationRepository.save(application);
}
```

Entity:

```java
@Entity
public class Application {
    @Id
    private Long id;

    private String applicantName;

    private String status;

    private String assignedOfficerId;

    private boolean approved;

    private Instant createdAt;
}
```

Client bisa mengirim:

```json
{
  "applicantName": "Alice",
  "status": "APPROVED",
  "approved": true,
  "assignedOfficerId": "OFFICER-001",
  "createdAt": "2000-01-01T00:00:00Z"
}
```

Ini bukan hanya mapping bug. Ini authorization dan integrity bug.

Safe design:

```java
public record SubmitApplicationRequest(
        @NotBlank String applicantName
) {
}

@PostMapping("/applications")
public ApplicationResponse submit(@Valid @RequestBody SubmitApplicationRequest request) {
    SubmitApplicationCommand command = mapper.toCommand(request);
    Application application = service.submit(command);
    return mapper.toResponse(application);
}
```

Entity state seperti status, approval, assigned officer, createdAt harus ditentukan oleh server-side policy.

---

## 33. Deserialization dan Domain Invariant

Jangan deserialize langsung menjadi domain aggregate jika domain invariant kuat.

Buruk:

```java
Order order = objectMapper.readValue(json, Order.class);
orderRepository.save(order);
```

Masalah:

- constructor domain bypassed,
- invariant bisa dilanggar,
- internal state bisa diset dari luar,
- lifecycle event tidak terjadi,
- audit metadata bisa palsu.

Lebih baik:

```text
JSON → Request DTO → Validation → Command → Domain method/factory
```

Contoh:

```java
public record CreateOrderRequest(
        @NotBlank String customerId,
        @NotEmpty List<@Valid OrderItemRequest> items
) {
}

public record CreateOrderCommand(
        CustomerId customerId,
        List<OrderLineCommand> lines
) {
}

public class Order {
    public static Order create(CreateOrderCommand command, Clock clock) {
        // enforce invariant here
    }
}
```

Jackson hanya boleh membuat boundary DTO, bukan mem-bypass domain.

---

## 34. Immutable DTO dan Validation Timing

Dengan immutable DTO/record, validation biasanya terjadi setelah object terbentuk.

```java
public record CreateUserRequest(
        @NotBlank String username,
        @Email @NotBlank String email
) {
}
```

Object bisa sesaat terbentuk dengan invalid state sebelum validation berjalan.

Untuk boundary DTO, ini acceptable selama object tidak masuk service layer sebelum validation.

Dalam Spring MVC/JAX-RS-style flow:

```java
public ResponseEntity<?> create(@Valid @RequestBody CreateUserRequest request) {
    // request sudah tervalidasi oleh framework sebelum method body berjalan
}
```

Tetapi jika kamu memanggil ObjectMapper manual:

```java
CreateUserRequest request = objectMapper.readValue(json, CreateUserRequest.class);
service.create(request); // validation belum tentu terjadi
```

Maka kamu perlu validasi manual:

```java
Set<ConstraintViolation<CreateUserRequest>> violations = validator.validate(request);
if (!violations.isEmpty()) {
    throw new ConstraintViolationException(violations);
}
```

---

## 35. Normalization: Di Deserializer, DTO Constructor, Mapper, atau Service?

Contoh normalization:

- trim string,
- uppercase code,
- lowercase email,
- remove dash from ID,
- convert empty string to null,
- normalize phone number.

Pilihan lokasi:

### 35.1 Custom Deserializer

Cocok jika normalization sangat format-level dan reusable.

Risiko: global side effect jika dipasang luas.

### 35.2 DTO Constructor / Record Compact Constructor

Cocok untuk normalization ringan pada DTO.

```java
public record RegisterRequest(String email) {
    public RegisterRequest {
        if (email != null) {
            email = email.trim().toLowerCase(Locale.ROOT);
        }
    }
}
```

Risiko: raw input hilang. Untuk audit/regulatory, kadang raw input perlu disimpan.

### 35.3 Mapper to Command

Cocok untuk normalization yang merupakan policy boundary.

```java
public RegisterCommand toCommand(RegisterRequest request) {
    return new RegisterCommand(
            normalizeEmail(request.email())
    );
}
```

### 35.4 Domain Factory

Cocok jika normalization bagian dari value object invariant.

```java
public record EmailAddress(String value) {
    public EmailAddress {
        value = normalize(value);
        validate(value);
    }
}
```

Rekomendasi:

```text
Format cleanup ringan         → DTO/mapper
Semantic normalization        → mapper/value object
Invariant-critical normalize  → domain value object
Audit-sensitive raw input     → preserve raw + normalized separately
```

---

## 36. Custom Deserializer: Kapan Perlu?

Gunakan custom deserializer jika:

- input shape tidak cocok dengan DTO normal,
- field format legacy sangat aneh,
- satu value bisa punya banyak representasi,
- butuh error message field-level yang presisi,
- butuh preserve raw value,
- butuh parsing polymorphic manual.

Jangan gunakan custom deserializer hanya untuk logic bisnis biasa.

Contoh custom deserializer untuk flexible boolean legacy:

```java
public class LegacyBooleanDeserializer extends JsonDeserializer<Boolean> {
    @Override
    public Boolean deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        String value = p.getValueAsString();
        if (value == null) {
            return null;
        }
        return switch (value.trim().toUpperCase(Locale.ROOT)) {
            case "Y", "YES", "TRUE", "1" -> true;
            case "N", "NO", "FALSE", "0" -> false;
            default -> throw JsonMappingException.from(p, "Invalid legacy boolean: " + value);
        };
    }
}
```

DTO:

```java
public record LegacyRequest(
        @JsonDeserialize(using = LegacyBooleanDeserializer.class)
        Boolean active
) {
}
```

Catatan Java 8: `switch` expression tidak tersedia. Gunakan `switch` statement atau if-else.

---

## 37. Java 8 sampai Java 25: Implikasi Deserialization

### Java 8

Umum:

- JavaBean DTO,
- constructor binding dengan annotation,
- Lombok banyak dipakai,
- `Optional` kadang dipakai tetapi tidak ideal untuk DTO field,
- `java.time` tersedia tetapi perlu module Jackson.

Rekomendasi:

- pakai DTO eksplisit,
- wrapper type untuk request nullable,
- validation jelas,
- hindari entity binding,
- annotation constructor untuk immutable DTO.

### Java 11/17

Umum:

- stronger baseline untuk modern framework,
- records mulai tersedia di Java 16,
- sealed classes tersedia di Java 17,
- pattern matching mulai berkembang.

Rekomendasi:

- mulai gunakan records untuk DTO sederhana,
- gunakan sealed hierarchy untuk polymorphic model yang terkendali,
- kurangi Lombok untuk DTO baru jika records cukup.

### Java 21

Umum:

- LTS modern,
- records/sealed sudah mature,
- virtual threads tidak langsung terkait deserialization, tetapi throughput API bisa meningkatkan tekanan parsing/mapping.

Rekomendasi:

- record DTO untuk request/response simple,
- explicit mapper layer,
- strict ObjectMapper profile,
- benchmark hot path jika payload besar.

### Java 25

Arah:

- Java modern makin mendukung model data eksplisit,
- records/sealed/pattern matching membuat model object lebih deklaratif,
- library ecosystem perlu dicek compatibility-nya.

Rekomendasi:

- jangan migrasi DTO ke fitur baru tanpa compatibility tests,
- validasi Jackson/Lombok/MapStruct support pada build matrix,
- pisahkan migration concern dari behavior change.

---

## 38. Jackson 2.x ke Jackson 3.x: Deserialization Mindset

Jackson 3 membawa perubahan package/artifact dan behavior tertentu. Untuk deserialization, prinsip migrasinya:

1. jangan bergantung pada behavior lenient default yang tidak dites,
2. test missing/null/unknown/coercion/enum cases,
3. buat golden payload inbound,
4. audit custom deserializer,
5. audit ObjectMapper global config,
6. audit module registration,
7. audit framework integration seperti Spring Boot.

Migration test matrix minimum:

```text
valid payload
missing required field
field null
field blank
unknown field
type mismatch
enum unknown
date invalid
number overflow
nested invalid
collection item invalid
alias old field
conflicting old/new alias
```

---

## 39. Deserialization Testing Strategy

Contoh DTO:

```java
public record CreateOrderRequest(
        @NotBlank String customerId,
        @NotEmpty List<@Valid OrderItemRequest> items
) {
}

public record OrderItemRequest(
        @NotBlank String sku,
        @Min(1) Integer quantity
) {
}
```

Test cases:

### 39.1 Valid Payload

```json
{
  "customerId": "C-001",
  "items": [
    { "sku": "SKU-1", "quantity": 2 }
  ]
}
```

Expected:

```text
bind success + validation success
```

### 39.2 Missing Required Field

```json
{
  "items": [
    { "sku": "SKU-1", "quantity": 2 }
  ]
}
```

Expected:

```text
bind may success, validation fails customerId
```

### 39.3 Unknown Field

```json
{
  "customerId": "C-001",
  "items": [],
  "status": "APPROVED"
}
```

Expected for strict command API:

```text
bind fails unknown field status
```

### 39.4 Type Mismatch

```json
{
  "customerId": "C-001",
  "items": [
    { "sku": "SKU-1", "quantity": "many" }
  ]
}
```

Expected:

```text
bind fails invalid quantity
```

### 39.5 Null Item

```json
{
  "customerId": "C-001",
  "items": [null]
}
```

Expected:

```text
validation fails item not null
```

---

## 40. Example: Strict API Request Mapper

Configuration concept:

```java
ObjectMapper mapper = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
        .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
        .build();
```

Catatan:

- fitur yang tersedia/behavior bisa berbeda antar versi Jackson,
- jangan copy konfigurasi tanpa test,
- Spring Boot bisa override/compose configuration,
- strictness juga bisa diatur via MVC message converter.

Untuk production, buat test yang memastikan policy ini benar-benar berlaku.

---

## 41. Example: Boundary DTO → Command

Inbound DTO:

```java
public record SubmitCaseRequest(
        @NotBlank String applicantId,
        @NotBlank String caseType,
        @NotNull LocalDate receivedDate,
        @Size(max = 1000) String remarks
) {
}
```

Command:

```java
public record SubmitCaseCommand(
        ApplicantId applicantId,
        CaseType caseType,
        LocalDate receivedDate,
        String remarks
) {
}
```

Mapper:

```java
public final class SubmitCaseRequestMapper {

    public SubmitCaseCommand toCommand(SubmitCaseRequest request) {
        return new SubmitCaseCommand(
                new ApplicantId(normalizeApplicantId(request.applicantId())),
                CaseType.fromCode(normalizeCode(request.caseType())),
                request.receivedDate(),
                normalizeRemarks(request.remarks())
        );
    }

    private String normalizeApplicantId(String value) {
        return value.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeCode(String value) {
        return value.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeRemarks(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
```

Kenapa tidak langsung deserialize ke `SubmitCaseCommand`?

Karena command sudah menggunakan value object dan enum domain. Boundary DTO masih membawa raw external input. Mapper adalah tempat transisi dari raw contract ke semantic command.

---

## 42. Anti-Pattern Catalog

### 42.1 Satu DTO untuk Request dan Response

Masalah:

- field server-generated bisa masuk dari client,
- read-only/write-only tercampur,
- validation berbeda sulit,
- contract evolusi sulit.

### 42.2 Entity sebagai Request Body

Masalah:

- over-posting,
- lazy loading/proxy issue,
- persistence annotation bocor ke API,
- domain invariant bypassed.

### 42.3 Global Lenient ObjectMapper

Masalah:

- typo client tidak terlihat,
- coercion tak terkendali,
- unknown field security signal hilang,
- behavior integration dan API tercampur.

### 42.4 Primitive Field pada Inbound DTO

Masalah:

- missing berubah menjadi default teknis,
- tidak bisa bedakan absent vs explicit zero/false,
- validation semantics kabur.

### 42.5 PATCH DTO Biasa

Masalah:

- absent dan null indistinguishable,
- partial update bisa menghapus field tanpa sengaja,
- audit perubahan tidak akurat.

### 42.6 Enum Domain Langsung untuk External Integration

Masalah:

- external value baru bisa merusak domain,
- mapping compatibility sulit,
- internal domain state tercemar external vocabulary.

---

## 43. Decision Matrix

| Situasi | Strategi Deserialization yang Disarankan |
|---|---|
| Public write API | Strict unknown field, strict type, DTO khusus request, validation wajib |
| Internal command API | Strict, versioned, contract tested |
| PATCH endpoint | Preserve presence; jangan pakai DTO biasa jika null bermakna |
| Event consumer | Tolerant reader untuk additive fields, enum strategy jelas |
| Legacy external API | Lenient adapter mapper, isolasi dari core DTO/domain |
| Money/amount | BigDecimal + validation scale/range |
| Date/time global | Instant atau OffsetDateTime, bukan LocalDateTime sembarang |
| Dynamic attributes | Map boleh, tetapi key/value harus divalidasi |
| Immutable DTO | Constructor/record/builder binding + tests |
| Lombok builder DTO | Pakai konfigurasi Jackson/Lombok yang jelas dan test generated behavior |

---

## 44. Production Checklist

Gunakan checklist ini saat review endpoint inbound.

### DTO Shape

- Apakah request DTO terpisah dari response DTO?
- Apakah request DTO terpisah dari entity?
- Apakah field server-controlled tidak ada di request DTO?
- Apakah primitive field pada request memang disengaja?
- Apakah nested DTO divalidasi dengan cascade?

### Missing/Null/Empty

- Apakah missing field policy jelas?
- Apakah null field policy jelas?
- Apakah blank string policy jelas?
- Apakah PATCH membedakan absent dan null jika perlu?
- Apakah default value eksplisit, bukan default teknis Java?

### Unknown/Coercion

- Apakah unknown field harus fail atau ignore?
- Apakah string-to-number coercion boleh?
- Apakah float-to-int coercion ditolak?
- Apakah enum unknown ditolak atau dimapping ke UNKNOWN?
- Apakah field alias punya test?

### Security

- Apakah over-posting dicegah?
- Apakah unsafe polymorphic typing tidak aktif?
- Apakah payload size/depth dibatasi di layer HTTP/parser?
- Apakah error message tidak membocorkan internal class/package?
- Apakah failed payload logging disanitasi?

### Compatibility

- Apakah ada golden inbound payload?
- Apakah old field name masih diterima jika perlu?
- Apakah perubahan DTO diuji terhadap backward compatibility?
- Apakah enum evolution diuji?
- Apakah Jackson version upgrade punya regression test?

---

## 45. Latihan Desain

### Latihan 1 — Create Request Strictness

Desain DTO untuk endpoint:

```text
POST /applications
```

Payload harus berisi:

- applicantId wajib,
- applicationType wajib,
- submittedAt wajib,
- remarks optional,
- status tidak boleh dikirim client,
- assignedOfficer tidak boleh dikirim client.

Tentukan:

- DTO shape,
- validation annotation,
- unknown field policy,
- date/time type,
- mapper ke command,
- test cases.

### Latihan 2 — PATCH Semantics

Endpoint:

```text
PATCH /users/{id}
```

Field:

- displayName: boleh diubah, tidak boleh blank,
- phoneNumber: boleh diubah atau dihapus,
- email: tidak boleh diubah melalui endpoint ini.

Tentukan:

- bagaimana membedakan absent vs null,
- payload valid/invalid,
- mapping ke command,
- audit event untuk perubahan.

### Latihan 3 — External Event Tolerant Reader

Event producer eksternal mengirim:

```json
{
  "applicationNo": "APP-001",
  "status": "SUBMITTED",
  "lastUpdated": "2026-06-17T10:00:00+07:00"
}
```

Bulan depan producer mungkin menambah field baru dan status baru.

Tentukan:

- unknown field policy,
- enum strategy,
- raw status preservation,
- compatibility test,
- monitoring untuk unknown enum.

---

## 46. Ringkasan Mental Model

Deserialization yang baik bukan hanya membuat JSON bisa masuk menjadi object.

Deserialization yang baik harus menjawab:

```text
Apa yang boleh masuk?
Apa yang wajib ada?
Apa yang boleh hilang?
Apa arti null?
Apa arti empty?
Apa yang harus ditolak?
Apa yang boleh ditoleransi?
Apa yang harus dinormalisasi?
Apa yang harus tetap raw?
Apa yang menjadi validation error?
Apa yang menjadi mapping error?
Apa yang menjadi domain error?
```

Untuk menjadi engineer level tinggi, jangan desain inbound DTO berdasarkan convenience. Desain inbound DTO berdasarkan boundary semantics.

Formula aman:

```text
External JSON
  → strict/tolerant ObjectMapper sesuai boundary
  → dedicated request DTO
  → validation
  → explicit mapper
  → semantic command/query
  → domain/application service
```

---

## 47. Koneksi ke Part Berikutnya

Part 9 membahas inbound JSON menjadi Java object. Part berikutnya akan masuk ke area yang lebih sulit:

```text
Generic type, TypeReference, JavaType, polymorphic binding, sealed classes, subtype discriminator, dan security risk default typing.
```

Itu penting karena banyak sistem enterprise tidak hanya menerima DTO datar, tetapi juga wrapper generic, response envelope, event envelope, heterogeneous payload, dan object hierarchy.

---

## Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 berikutnya
```

Part berikutnya:

```text
10-jackson-advanced-type-handling-generic-polymorphism-sealed-classes.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-jackson-serialization-shape-control-inclusion-naming-formatting.md">⬅️ Part 8 — Jackson Serialization: Shape Control, Inclusion, Naming, Formatting</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./10-jackson-advanced-type-handling-generic-polymorphism-sealed-classes.md">Part 10 — Jackson Advanced Type Handling: Generic, Polymorphism, Sealed Classes ➡️</a>
</div>
