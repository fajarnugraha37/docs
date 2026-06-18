# Part 7 — JSON-B Core Model

> Series: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> File: `learn-java-json-xml-soap-connectors-enterprise-integration-part-007.md`  
> Scope: Java 8 sampai Java 25, Javax/Jakarta transition, JSON-B core mental model, runtime usage, default mapping, object construction, field/property access, records, enums, dates, optionals, generics, dan production-grade boundary design.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas JSON-P dari sisi **processing API**: membaca, menulis, streaming, patching, canonicalization, dan production pattern untuk JSON sebagai struktur data.

Part ini mulai masuk ke **JSON-B / JSON Binding**.

JSON-B berbeda dari JSON-P.

JSON-P bertanya:

> “Bagaimana saya memanipulasi JSON sebagai struktur JSON?”

JSON-B bertanya:

> “Bagaimana saya mengubah object Java menjadi JSON dan JSON menjadi object Java secara standar?”

Di level sederhana, JSON-B tampak seperti library `toJson()` dan `fromJson()`. Tetapi di sistem enterprise, JSON-B adalah bagian dari **boundary contract**:

- menentukan bentuk payload eksternal;
- menentukan field mana yang diekspos;
- menentukan bagaimana `null`, absent field, date/time, enum, number, collection, dan nested object dimaknai;
- menentukan cara DTO dibuat ulang dari input eksternal;
- menentukan apakah perubahan class Java akan memecahkan kontrak API;
- menentukan apakah object domain internal secara tidak sengaja bocor ke external representation.

Target part ini bukan sekadar bisa memakai JSON-B. Targetnya adalah memahami **model berpikir binding** supaya ketika menghadapi payload production, migrasi Java 8 ke 17/21/25, Jakarta namespace migration, framework interop, atau bug serialization yang halus, kita bisa menganalisis dengan tajam.

---

## 1. Posisi JSON-B dalam Ekosistem Java

### 1.1 JSON-B adalah Standard Binding Layer

Jakarta JSON Binding mendefinisikan framework binding standar untuk mengubah Java object ke JSON document dan sebaliknya. API utamanya berada di package:

```java
jakarta.json.bind
```

Untuk generasi lama Java EE / Jakarta EE 8, package historisnya adalah:

```java
javax.json.bind
```

Perbedaan ini penting:

| Era | API Package | Typical Context |
|---|---|---|
| Java EE / Jakarta EE 8 | `javax.json.bind.*` | Java EE 8, Jakarta EE 8, Java 8-era apps |
| Jakarta EE 9+ | `jakarta.json.bind.*` | namespace migration dari `javax` ke `jakarta` |
| Jakarta EE 10/11 era | `jakarta.json.bind.*` | JSON-B 3.x, modern app server/runtime |

Mental model penting:

> JSON-B bukan “milik JDK”. JSON-B adalah spesifikasi Jakarta. Runtime harus menyediakan implementation/provider, misalnya Yasson, atau aplikasi membawa dependency implementation sendiri.

### 1.2 JSON-B vs JSON-P

| Aspek | JSON-P | JSON-B |
|---|---|---|
| Fokus | JSON sebagai struktur data | Java object ↔ JSON |
| Abstraksi utama | `JsonObject`, `JsonArray`, `JsonValue`, `JsonParser`, `JsonGenerator` | `Jsonb`, `JsonbBuilder`, `JsonbConfig` |
| Cocok untuk | transformasi, patch, streaming, canonical JSON, partial extraction | DTO binding, request/response mapping, object serialization |
| Bentuk kontrol | eksplisit terhadap token/tree | implicit/default mapping + annotations/config |
| Risiko utama | kode verbose, manual traversal | kontrak bocor dari class model, implicit behavior tidak disadari |

JSON-P memberi kontrol rendah-level. JSON-B memberi produktivitas tinggi-level.

Top engineer tidak bertanya “mana yang lebih bagus?” tetapi:

> “Di boundary ini, apakah saya butuh kontrol struktur atau mapping object?”

### 1.3 JSON-B vs Jackson/Gson

Di banyak aplikasi Spring Boot, Jackson adalah default de facto. Di Jakarta EE, JSON-B adalah standard API untuk binding.

Perbandingan mental:

| Aspek | JSON-B | Jackson | Gson |
|---|---|---|---|
| Standard Jakarta | Ya | Tidak | Tidak |
| Provider-based | Ya | Library-specific | Library-specific |
| Jakarta REST integration | Native di banyak Jakarta runtime | Bisa, tapi provider berbeda | Bisa, tapi tidak umum untuk enterprise Jakarta |
| Feature breadth | Cukup untuk standard binding | Sangat luas | Sederhana, populer historis |
| Annotation portability | Jakarta standard | Jackson-specific | Gson-specific |
| Enterprise app server fit | Kuat | Bergantung runtime/framework | Lebih library-level |

Kesalahan umum:

> Menganggap JSON-B harus menggantikan Jackson di semua tempat.

Lebih tepat:

- gunakan JSON-B saat ingin standard Jakarta API, portability, dan integrasi Jakarta EE;
- gunakan Jackson saat aplikasi memang berbasis Spring/Jackson ecosystem atau butuh fitur khusus Jackson;
- jangan campur tanpa boundary yang jelas, karena annotation dan default behavior bisa berbeda.

---

## 2. Core API: `Jsonb`, `JsonbBuilder`, dan `JsonbConfig`

### 2.1 API Minimal

Contoh paling sederhana:

```java
import jakarta.json.bind.Jsonb;
import jakarta.json.bind.JsonbBuilder;

public class JsonbBasicExample {
    public static void main(String[] args) throws Exception {
        try (Jsonb jsonb = JsonbBuilder.create()) {
            CustomerDto customer = new CustomerDto("C001", "Alice");

            String json = jsonb.toJson(customer);
            CustomerDto restored = jsonb.fromJson(json, CustomerDto.class);

            System.out.println(json);
            System.out.println(restored);
        }
    }
}
```

Conceptually:

```text
Java object graph
    |
    | toJson(...)
    v
JSON text
    |
    | fromJson(...)
    v
Java object graph
```

Tetapi realitanya lebih kompleks:

```text
Java object graph
    |
    | introspection
    | property discovery
    | access strategy
    | naming strategy
    | type conversion
    | adapter/serializer/deserializer
    | provider-specific behavior
    v
JSON representation
```

### 2.2 `Jsonb` adalah Runtime Binding Engine

`Jsonb` adalah façade utama untuk operasi:

- serialize Java object ke JSON;
- deserialize JSON ke Java object;
- serialize ke `Writer`/`OutputStream`;
- deserialize dari `Reader`/`InputStream`;
- menggunakan konfigurasi dari `JsonbConfig`;
- menggunakan provider JSON-B yang tersedia.

Contoh output ke `Writer`:

```java
try (Jsonb jsonb = JsonbBuilder.create();
     Writer writer = Files.newBufferedWriter(Path.of("customer.json"))) {

    jsonb.toJson(customer, writer);
}
```

Contoh input dari `Reader`:

```java
try (Jsonb jsonb = JsonbBuilder.create();
     Reader reader = Files.newBufferedReader(Path.of("customer.json"))) {

    CustomerDto customer = jsonb.fromJson(reader, CustomerDto.class);
}
```

### 2.3 Lifecycle: Jangan Buat `Jsonb` Sembarangan Per Request

`Jsonb` object biasanya mahal karena provider dapat melakukan:

- introspection class;
- metadata caching;
- resolver setup;
- adapter/serializer setup;
- internal provider initialization.

Pattern buruk:

```java
public String serialize(Object value) {
    try (Jsonb jsonb = JsonbBuilder.create()) {
        return jsonb.toJson(value);
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

Masalahnya:

- membuat runtime binding engine berkali-kali;
- membuang cache metadata;
- overhead tinggi pada hot path;
- meningkatkan GC pressure;
- bisa menyebabkan latency jitter.

Pattern lebih baik:

```java
public final class JsonbSupport implements AutoCloseable {
    private final Jsonb jsonb;

    public JsonbSupport() {
        this.jsonb = JsonbBuilder.create();
    }

    public String toJson(Object value) {
        return jsonb.toJson(value);
    }

    public <T> T fromJson(String json, Class<T> type) {
        return jsonb.fromJson(json, type);
    }

    @Override
    public void close() throws Exception {
        jsonb.close();
    }
}
```

Di Jakarta container, kita biasanya membiarkan framework mengelola provider JSON-B untuk endpoint Jakarta REST. Tetapi untuk utility internal, batch, integration client, atau message transformation, lifecycle tetap harus diperhatikan.

Mental model:

> `Jsonb` lebih mirip configured engine daripada stateless helper function.

### 2.4 `JsonbConfig`

`JsonbConfig` digunakan untuk mengatur behavior global binding.

Contoh:

```java
import jakarta.json.bind.Jsonb;
import jakarta.json.bind.JsonbBuilder;
import jakarta.json.bind.JsonbConfig;
import jakarta.json.bind.config.PropertyNamingStrategy;

JsonbConfig config = new JsonbConfig()
        .withFormatting(true)
        .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES)
        .withNullValues(false);

try (Jsonb jsonb = JsonbBuilder.create(config)) {
    String json = jsonb.toJson(customer);
}
```

Konfigurasi global bisa berbahaya kalau dipakai tanpa boundary. Misalnya `LOWER_CASE_WITH_UNDERSCORES` bagus untuk public API, tetapi bisa merusak payload vendor yang case-sensitive atau sudah punya field contract historis.

Rule praktis:

> Jangan punya satu `JsonbConfig` global untuk semua integration boundary jika tiap boundary punya kontrak berbeda.

Lebih baik:

```text
PublicApiJsonb
PartnerXJsonb
AuditJsonb
InternalEventJsonb
LegacyMigrationJsonb
```

Masing-masing bisa punya:

- naming strategy berbeda;
- null policy berbeda;
- date/time format berbeda;
- adapters berbeda;
- strictness berbeda;
- logging/redaction behavior berbeda.

---

## 3. Default Mapping: Hal yang Harus Dipahami sebelum Annotation

JSON-B punya default mapping algorithm. Ini membuatnya mudah dipakai, tetapi juga membuka risiko karena bentuk JSON bisa berubah saat Java class berubah.

### 3.1 Simple POJO

```java
public class CustomerDto {
    public String id;
    public String name;
}
```

Output default kira-kira:

```json
{
  "id": "C001",
  "name": "Alice"
}
```

Ini tampak sederhana. Tetapi pertanyaan kontraknya:

- Apakah `id` boleh `null`?
- Apakah `name` wajib ada?
- Apakah field order penting?
- Apakah field tambahan boleh muncul?
- Apakah consumer membedakan field absent dan field null?
- Apakah rename Java field berarti rename JSON property?

Default mapping berguna untuk internal payload, tetapi untuk external contract kita biasanya butuh explicit annotation/config/test.

### 3.2 Property Discovery: Field vs Getter/Setter

JSON-B dapat menemukan property dari:

- public field;
- JavaBean getter/setter;
- annotated member;
- constructor/factory metadata pada skenario tertentu;
- provider-specific support untuk modern type tertentu.

Contoh JavaBean:

```java
public class CustomerDto {
    private String id;
    private String name;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

Output JSON tetap:

```json
{
  "id": "C001",
  "name": "Alice"
}
```

Perhatikan bedanya:

```java
public String getDisplayName() {
    return id + " - " + name;
}
```

Jika getter ini dianggap property, JSON bisa menjadi:

```json
{
  "id": "C001",
  "name": "Alice",
  "displayName": "C001 - Alice"
}
```

Inilah contoh kontrak bocor dari convenience method.

Top engineer biasanya tidak membiarkan public API DTO memiliki getter “helper” tanpa sadar. Jika butuh computed field, harus eksplisit.

### 3.3 DTO Boundary Harus Stabil

Bad external DTO:

```java
public class CaseEntity {
    private Long id;
    private String status;
    private String internalWorkflowState;
    private String assignedOfficerUserId;
    private boolean deleted;
    private Instant createdAt;
    private Instant updatedAt;

    // JPA relationships, lazy fields, internal flags, etc.
}
```

Lalu langsung:

```java
return jsonb.toJson(caseEntity);
```

Masalah:

- field internal bocor;
- lazy relationship bisa trigger query;
- status internal disamakan dengan external status;
- soft-delete flag terlihat consumer;
- perubahan entity database mengubah API;
- circular reference mungkin terjadi;
- audit/security risk.

Better:

```java
public class CaseResponse {
    public String caseNo;
    public String displayStatus;
    public String applicantName;
    public String submittedAt;
}
```

Mapping eksplisit:

```java
public CaseResponse toResponse(CaseEntity entity) {
    CaseResponse response = new CaseResponse();
    response.caseNo = entity.getCaseNo();
    response.displayStatus = mapExternalStatus(entity.getWorkflowState());
    response.applicantName = entity.getApplicant().getName();
    response.submittedAt = externalDateFormat(entity.getSubmittedAt());
    return response;
}
```

Mental model:

```text
Database Entity != Domain Aggregate != External DTO != Vendor Payload != Audit Event
```

JSON-B seharusnya bekerja di layer DTO/payload, bukan langsung di model internal yang berubah cepat.

---

## 4. Serialization vs Deserialization: Dua Arah yang Tidak Simetris

Kesalahan besar dalam binding adalah menganggap serialize dan deserialize adalah operasi simetris.

Padahal tidak selalu.

### 4.1 Serialization

Serialization menjawab:

> “Dari object Java yang saya percaya, bentuk JSON apa yang saya keluarkan?”

Risikonya:

- field sensitif keluar;
- field internal keluar;
- format tanggal salah;
- enum internal bocor;
- null field mengubah arti;
- output tidak deterministic untuk signature/audit;
- cyclic graph;
- lazy field access.

### 4.2 Deserialization

Deserialization menjawab:

> “Dari input JSON yang tidak sepenuhnya saya percaya, object Java apa yang saya buat?”

Risikonya:

- unknown field silently ignored;
- required field missing;
- duplicate keys;
- type coercion tidak diharapkan;
- number overflow;
- timezone ambiguity;
- enum invalid;
- object dibuat dalam state tidak valid;
- constructor/setter menjalankan logic berbahaya;
- polymorphic type abuse.

Karena itu, DTO request dan DTO response sering sebaiknya dipisahkan.

Bad:

```java
public class UserDto {
    public String id;
    public String role;
    public boolean active;
}
```

Dipakai untuk create request dan response.

Masalah: client mungkin mengirim `role` atau `active` dan sistem tidak sengaja memercayainya.

Better:

```java
public class CreateUserRequest {
    public String email;
    public String displayName;
}

public class UserResponse {
    public String id;
    public String email;
    public String displayName;
    public String role;
    public boolean active;
}
```

Rule:

> Jangan desain DTO berdasarkan “field yang kebetulan sama”. Desain DTO berdasarkan arah trust boundary.

---

## 5. Object Construction pada Deserialization

### 5.1 Default Constructor Model

Classic JSON-B paling mudah bekerja dengan class yang punya no-arg constructor dan setter/field writable.

```java
public class CustomerDto {
    private String id;
    private String name;

    public CustomerDto() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

Deserialization roughly:

```text
1. instantiate CustomerDto using no-arg constructor
2. parse JSON object
3. match JSON field to Java property
4. call setter or set field
5. return object
```

Kelemahannya:

- object bisa ada dalam state setengah jadi;
- invariant tidak dijamin constructor;
- setter bisa dipanggil dalam urutan tertentu;
- required field tidak otomatis enforced;
- mutable DTO mudah disalahgunakan.

### 5.2 Immutable DTO Problem

Modern Java cenderung memakai immutable DTO:

```java
public final class CustomerDto {
    private final String id;
    private final String name;

    public CustomerDto(String id, String name) {
        this.id = Objects.requireNonNull(id);
        this.name = Objects.requireNonNull(name);
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }
}
```

Serialization mudah. Deserialization butuh cara provider tahu constructor mana dan parameter mana cocok dengan property apa.

Pada JSON-B, constructor/factory binding biasanya membutuhkan annotation seperti `@JsonbCreator` dan `@JsonbProperty`.

Contoh:

```java
import jakarta.json.bind.annotation.JsonbCreator;
import jakarta.json.bind.annotation.JsonbProperty;

public final class CustomerDto {
    private final String id;
    private final String name;

    @JsonbCreator
    public CustomerDto(
            @JsonbProperty("id") String id,
            @JsonbProperty("name") String name) {
        this.id = Objects.requireNonNull(id, "id");
        this.name = Objects.requireNonNull(name, "name");
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }
}
```

Mental model:

```text
Mutable DTO:
JSON -> no-arg constructor -> setters/fields -> object

Immutable DTO:
JSON -> match constructor/factory parameters -> construct valid object
```

Immutable DTO lebih kuat untuk invariant, tetapi membutuhkan explicit binding metadata.

### 5.3 Jangan Masukkan Domain Invariant Berat di DTO Constructor

DTO constructor boleh melakukan invariant ringan, misalnya required field. Tetapi jangan terlalu banyak business logic.

Bad:

```java
@JsonbCreator
public CreateCaseRequest(@JsonbProperty("caseType") String caseType,
                         @JsonbProperty("applicantId") String applicantId) {
    this.caseType = caseType;
    this.applicantId = applicantId;

    // Bad: calls database or external service
    if (!caseTypeRepository.exists(caseType)) {
        throw new IllegalArgumentException("Invalid case type");
    }
}
```

Masalah:

- deserialization jadi punya side effect;
- error boundary kabur;
- unit test sulit;
- tidak bisa membedakan malformed JSON vs invalid business request;
- membuka DoS vector jika parsing memicu expensive operation.

Better:

```text
JSON-B deserialization
    -> syntactic DTO creation
    -> bean validation / semantic validation
    -> application service validation
    -> domain command
```

DTO constructor sebaiknya menjaga local invariant, bukan melakukan business workflow.

---

## 6. Field, Property, dan Encapsulation

### 6.1 Public Field DTO

```java
public class CustomerDto {
    public String id;
    public String name;
}
```

Kelebihan:

- sangat sederhana;
- cocok untuk internal test fixture;
- verbose rendah.

Kekurangan:

- tidak ada encapsulation;
- mudah berubah tanpa sadar;
- invariant tidak terlindungi;
- sulit evolve untuk logic;
- tidak ideal untuk boundary serius.

### 6.2 JavaBean DTO

```java
public class CustomerDto {
    private String id;
    private String name;

    public CustomerDto() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

Kelebihan:

- compatible luas;
- mudah dipahami framework;
- cocok untuk legacy/Jakarta EE style.

Kekurangan:

- mutable;
- invalid intermediate state;
- setter bisa disalahgunakan;
- boilerplate.

### 6.3 Immutable Class DTO

```java
public final class CustomerDto {
    private final String id;
    private final String name;

    @JsonbCreator
    public CustomerDto(@JsonbProperty("id") String id,
                       @JsonbProperty("name") String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}
```

Kelebihan:

- safer state;
- thread-friendly;
- contract eksplisit;
- cocok untuk request command dan event.

Kekurangan:

- annotation lebih banyak;
- provider compatibility harus dites;
- generic/complex constructor bisa sulit.

### 6.4 Record DTO

Java records tersedia sejak Java 16 final. Untuk Java 8–15, tidak bisa dipakai.

```java
public record CustomerDto(String id, String name) {
}
```

Record sangat menarik untuk DTO karena:

- immutable by design;
- concise;
- structural data carrier;
- canonical constructor;
- getter bernama component accessor, misalnya `id()` bukan `getId()`.

Tetapi untuk JSON-B:

- support record bergantung versi API/provider;
- perlu dites di runtime target;
- Jakarta EE runtime lama mungkin belum mendukung;
- Java 8 compatibility tidak ada.

Untuk seri Java 8–25, kita harus berpikir:

```text
Jika library/module harus support Java 8:
    jangan gunakan record di API utama.

Jika runtime minimal Java 17/21:
    record bisa menjadi DTO boundary yang bagus,
    tetapi test JSON-B provider wajib.
```

Contoh record dengan invariant:

```java
public record CustomerDto(String id, String name) {
    public CustomerDto {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(name, "name");
        if (id.isBlank()) {
            throw new IllegalArgumentException("id must not be blank");
        }
    }
}
```

Hati-hati: exception dari constructor saat deserialization harus dipetakan menjadi error response yang benar, bukan 500 internal server error.

---

## 7. Naming Strategy dan Contract Drift

### 7.1 Java Name Tidak Selalu JSON Name

Java convention:

```java
private String createdAt;
```

JSON convention bisa:

```json
{
  "createdAt": "2026-06-17T10:00:00Z"
}
```

atau:

```json
{
  "created_at": "2026-06-17T10:00:00Z"
}
```

atau vendor legacy:

```json
{
  "CreatedDateTime": "2026-06-17T10:00:00Z"
}
```

JSON-B bisa menggunakan naming strategy atau annotation.

Global naming strategy:

```java
JsonbConfig config = new JsonbConfig()
        .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES);
```

Explicit property:

```java
import jakarta.json.bind.annotation.JsonbProperty;

public class CaseResponse {
    @JsonbProperty("case_no")
    public String caseNo;

    @JsonbProperty("created_at")
    public String createdAt;
}
```

### 7.2 Annotation vs Global Strategy

| Approach | Cocok untuk | Risiko |
|---|---|---|
| Global naming strategy | API baru yang konsisten | semua field ikut berubah; vendor exception sulit |
| Per-field annotation | contract eksplisit | verbose |
| Mixed | real-world integration | harus disiplin dan dites |

Rule:

> Untuk public/external contract yang panjang umur, explicit mapping lebih aman daripada membiarkan Java rename memengaruhi JSON.

### 7.3 Contract Drift Example

Awal:

```java
public class PaymentDto {
    public String transactionId;
}
```

JSON:

```json
{
  "transactionId": "T001"
}
```

Developer refactor:

```java
public class PaymentDto {
    public String paymentTransactionId;
}
```

JSON berubah:

```json
{
  "paymentTransactionId": "T001"
}
```

Secara compile sukses. Secara contract external rusak.

Better:

```java
public class PaymentDto {
    @JsonbProperty("transactionId")
    public String paymentTransactionId;
}
```

Sekarang Java internal name boleh berubah, contract JSON tetap.

---

## 8. Null, Absent, dan Default Value

### 8.1 Tiga State yang Sering Tercampur

Dalam JSON boundary, ini berbeda:

```json
{}
```

```json
{
  "middleName": null
}
```

```json
{
  "middleName": ""
}
```

Maknanya bisa sangat berbeda:

| JSON | Kemungkinan arti |
|---|---|
| field absent | tidak dikirim, tidak berubah, unknown, default berlaku |
| field null | sengaja dikosongkan, tidak tersedia, explicit null |
| empty string | nilai ada tapi kosong |

Pada create request, absent dan null mungkin sama-sama invalid.

Pada patch request, absent dan null biasanya berbeda:

```json
{
  "email": "new@example.com"
}
```

berarti update email saja.

```json
{
  "email": null
}
```

bisa berarti clear email, atau invalid tergantung rule.

### 8.2 JSON-B Null Serialization

JSON-B config dapat mengatur apakah null values disertakan dalam output.

```java
JsonbConfig config = new JsonbConfig()
        .withNullValues(true);
```

Dengan null values:

```json
{
  "id": "C001",
  "middleName": null
}
```

Tanpa null values:

```json
{
  "id": "C001"
}
```

Tidak ada pilihan universal. Pilihan tergantung contract.

### 8.3 Practical Rules

Untuk response API publik:

- konsisten;
- dokumentasikan apakah null field muncul;
- jangan mengubah policy minor release tanpa compatibility review;
- gunakan contract tests.

Untuk event/audit:

- null kadang penting untuk membedakan “set to null” vs “not captured”;
- absent field lebih sulit diaudit;
- canonical event schema harus jelas.

Untuk PATCH:

- jangan pakai DTO biasa jika perlu membedakan absent vs null;
- pertimbangkan JSON-P, wrapper type, atau patch document.

Contoh wrapper:

```java
public final class OptionalField<T> {
    private final boolean present;
    private final T value;

    private OptionalField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> OptionalField<T> absent() {
        return new OptionalField<>(false, null);
    }

    public static <T> OptionalField<T> present(T value) {
        return new OptionalField<>(true, value);
    }

    public boolean isPresent() { return present; }
    public T value() { return value; }
}
```

Tetapi wrapper ini butuh custom adapter/deserializer agar JSON-B bisa membedakan absent/null secara benar. Ini akan dibahas lebih dalam di part annotation/customization.

---

## 9. Numbers: `int`, `long`, `BigInteger`, `BigDecimal`

### 9.1 JSON Number Tidak Punya Tipe Java

JSON punya number, tapi tidak punya tipe seperti:

- `int`;
- `long`;
- `float`;
- `double`;
- `BigInteger`;
- `BigDecimal`.

Java punya banyak numeric type. Binding harus memilih.

Contoh:

```json
{
  "amount": 1234567890.123456789
}
```

Jika dipetakan ke `double`, precision bisa hilang.

Bad untuk uang:

```java
public class PaymentDto {
    public double amount;
}
```

Better:

```java
import java.math.BigDecimal;

public class PaymentDto {
    public BigDecimal amount;
    public String currency;
}
```

### 9.2 Integer Overflow

JSON input:

```json
{
  "count": 999999999999999999999999999999
}
```

DTO:

```java
public class CountDto {
    public int count;
}
```

Binding harus gagal atau overflow/coerce tergantung provider behavior. Jangan mengandalkan behavior implicit untuk security-sensitive boundary.

Praktik aman:

- gunakan tipe cukup besar di parsing boundary;
- validasi range eksplisit;
- tolak angka ekstrem;
- gunakan JSON-P untuk pre-validate jika perlu;
- gunakan Bean Validation untuk range setelah binding.

```java
public class CountDto {
    @Min(0)
    @Max(10_000)
    public int count;
}
```

Catatan: annotation validation hanya bekerja jika validation layer dipanggil oleh framework atau manual. JSON-B sendiri bukan validation engine.

### 9.3 Number sebagai String

Beberapa external API mengirim angka sebagai string:

```json
{
  "amount": "123.45"
}
```

Alasannya bisa:

- menjaga precision di JavaScript;
- legacy system;
- financial contract;
- format fixed-width yang diadaptasi ke JSON.

Jangan langsung anggap salah. Treat as contract.

DTO:

```java
public class PaymentDto {
    public String amount;
}
```

Lalu parse eksplisit:

```java
BigDecimal parsed = new BigDecimal(payment.amount);
```

Atau gunakan adapter khusus di part berikutnya.

---

## 10. Date and Time

### 10.1 Date/Time adalah Contract, Bukan Formatting Cosmetic

Field waktu tampak sederhana:

```json
{
  "createdAt": "2026-06-17T10:15:30Z"
}
```

Tetapi pertanyaannya:

- timezone apa?
- offset disimpan atau dinormalisasi?
- precision sampai detik, millis, micros, nanos?
- apakah date-only boleh?
- apakah local time tanpa zone boleh?
- apakah consumer lama menerima ISO-8601?
- apakah field sort lexicographic sama dengan chronological?

### 10.2 Java Time Types

| Java Type | Makna | Cocok untuk JSON contract? |
|---|---|---|
| `Instant` | titik waktu absolut UTC | bagus untuk event timestamp/audit |
| `OffsetDateTime` | date-time dengan offset | bagus untuk external event dengan offset penting |
| `ZonedDateTime` | date-time dengan region zone | hati-hati, zone database dan DST |
| `LocalDateTime` | tanggal+waktu tanpa timezone | rawan ambigu untuk distributed systems |
| `LocalDate` | tanggal saja | bagus untuk birth date, due date, effective date |
| `java.util.Date` | legacy timestamp | hindari untuk model baru |
| `Calendar` | legacy + timezone mutable | hindari kecuali interop legacy |

### 10.3 Strong Default Recommendation

Untuk event/audit/integration timestamp:

```java
public class AuditEventDto {
    public Instant occurredAt;
}
```

JSON:

```json
{
  "occurredAt": "2026-06-17T10:15:30Z"
}
```

Untuk tanggal bisnis:

```java
public class LicenseDto {
    public LocalDate validFrom;
    public LocalDate validTo;
}
```

JSON:

```json
{
  "validFrom": "2026-06-17",
  "validTo": "2027-06-16"
}
```

Untuk appointment dengan timezone user:

```java
public class AppointmentDto {
    public OffsetDateTime scheduledAt;
}
```

JSON:

```json
{
  "scheduledAt": "2026-06-17T17:00:00+07:00"
}
```

### 10.4 Jangan Pakai `LocalDateTime` untuk Event Global

Bad:

```java
public class LoginEventDto {
    public LocalDateTime loginAt;
}
```

JSON:

```json
{
  "loginAt": "2026-06-17T10:15:30"
}
```

Ini tidak menjawab:

- 10:15:30 zona mana?
- server timezone?
- user timezone?
- database timezone?
- UTC?

Better:

```java
public class LoginEventDto {
    public Instant loginAt;
}
```

Atau:

```java
public class LoginEventDto {
    public OffsetDateTime loginAt;
}
```

### 10.5 JSON-B Date Format

JSON-B menyediakan annotation/config untuk date format. Ini akan dibahas lebih detail di Part 8, tetapi core modelnya:

```java
import jakarta.json.bind.annotation.JsonbDateFormat;

public class ReportRequest {
    @JsonbDateFormat("yyyy-MM-dd")
    public LocalDate fromDate;

    @JsonbDateFormat("yyyy-MM-dd")
    public LocalDate toDate;
}
```

Hati-hati dengan custom format. ISO standard biasanya lebih interoperable. Custom format perlu alasan kuat, misalnya vendor legacy.

---

## 11. Enum Mapping

### 11.1 Default Enum Output

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}

public class CaseDto {
    public String caseNo;
    public CaseStatus status;
}
```

JSON default biasanya:

```json
{
  "caseNo": "C001",
  "status": "SUBMITTED"
}
```

Risiko:

- enum name Java menjadi external contract;
- rename enum constant memecahkan consumer;
- internal workflow state bocor;
- status display dan status machine tercampur.

### 11.2 External Enum Harus Stabil

Bad:

```java
public enum InternalWorkflowState {
    PENDING_OFFICER_ASSIGNMENT,
    PENDING_MANAGER_CLEARANCE,
    RETURNED_BY_SENIOR_OFFICER,
    AUTO_CLOSED_BY_BATCH
}
```

Lalu langsung diekspos sebagai JSON.

Better:

```java
public enum ExternalCaseStatus {
    DRAFT,
    IN_PROGRESS,
    ACTION_REQUIRED,
    COMPLETED,
    REJECTED
}
```

Mapping:

```java
public ExternalCaseStatus toExternalStatus(InternalWorkflowState state) {
    return switch (state) {
        case PENDING_OFFICER_ASSIGNMENT,
             PENDING_MANAGER_CLEARANCE,
             RETURNED_BY_SENIOR_OFFICER -> ExternalCaseStatus.IN_PROGRESS;
        case AUTO_CLOSED_BY_BATCH -> ExternalCaseStatus.COMPLETED;
    };
}
```

Untuk Java 8, gunakan `switch` biasa.

```java
public ExternalCaseStatus toExternalStatus(InternalWorkflowState state) {
    switch (state) {
        case PENDING_OFFICER_ASSIGNMENT:
        case PENDING_MANAGER_CLEARANCE:
        case RETURNED_BY_SENIOR_OFFICER:
            return ExternalCaseStatus.IN_PROGRESS;
        case AUTO_CLOSED_BY_BATCH:
            return ExternalCaseStatus.COMPLETED;
        default:
            throw new IllegalArgumentException("Unhandled state: " + state);
    }
}
```

### 11.3 Unknown Enum Value

External systems evolve. Consumer lama bisa menerima:

```json
{
  "status": "ESCALATED"
}
```

Jika enum Java belum punya `ESCALATED`, deserialization gagal.

Strategi:

1. Fail fast untuk command/request internal yang harus strict.
2. Gunakan string + validation untuk vendor payload yang sering berubah.
3. Sediakan `UNKNOWN` enum jika contract mengizinkan forward compatibility.
4. Gunakan adapter untuk mapping external value.

Contoh safer vendor DTO:

```java
public class VendorCaseDto {
    public String status;
}
```

Lalu mapping eksplisit:

```java
public VendorStatus parseVendorStatus(String raw) {
    if (raw == null) {
        return VendorStatus.UNKNOWN;
    }
    switch (raw) {
        case "DRAFT": return VendorStatus.DRAFT;
        case "SUBMITTED": return VendorStatus.SUBMITTED;
        case "APPROVED": return VendorStatus.APPROVED;
        default: return VendorStatus.UNKNOWN;
    }
}
```

Trade-off:

- enum langsung memberi type safety;
- string memberi evolvability;
- adapter memberi kompromi tetapi kompleksitas naik.

---

## 12. Collections, Arrays, dan Generic Types

### 12.1 List of DTO

Serialization:

```java
List<CustomerDto> customers = List.of(
        new CustomerDto("C001", "Alice"),
        new CustomerDto("C002", "Bob")
);

String json = jsonb.toJson(customers);
```

Output:

```json
[
  { "id": "C001", "name": "Alice" },
  { "id": "C002", "name": "Bob" }
]
```

Deserialization dengan `Class<List>` tidak cukup karena type erasure.

Bad:

```java
List result = jsonb.fromJson(json, List.class);
```

Hasilnya bisa menjadi list of generic maps/provider-specific structures, bukan `List<CustomerDto>`.

### 12.2 Generic Type dengan `Type`

Gunakan `ParameterizedType` helper.

```java
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;

public abstract class GenericType<T> {
    private final Type type;

    protected GenericType() {
        Type superClass = getClass().getGenericSuperclass();
        this.type = ((ParameterizedType) superClass).getActualTypeArguments()[0];
    }

    public Type getType() {
        return type;
    }
}
```

Usage:

```java
Type customerListType = new GenericType<List<CustomerDto>>() {}.getType();
List<CustomerDto> customers = jsonb.fromJson(json, customerListType);
```

Mental model:

```text
Class<T> works for non-generic root type.
Type is needed for List<CustomerDto>, Map<String, CustomerDto>, Page<CustomerDto>, etc.
```

### 12.3 Map Types

JSON object naturally maps to `Map<String, Something>`:

```json
{
  "C001": { "name": "Alice" },
  "C002": { "name": "Bob" }
}
```

Java:

```java
Type type = new GenericType<Map<String, CustomerDto>>() {}.getType();
Map<String, CustomerDto> map = jsonb.fromJson(json, type);
```

Caution:

- JSON object keys are strings;
- map ordering may not be stable unless using ordered map;
- canonical output should not rely on default map order;
- map-shaped API is harder to document than array-shaped API;
- dynamic keys can hide schema/contract issues.

Often better external API:

```json
{
  "customers": [
    { "id": "C001", "name": "Alice" },
    { "id": "C002", "name": "Bob" }
  ]
}
```

DTO:

```java
public class CustomerListResponse {
    public List<CustomerDto> customers;
}
```

Why better:

- extensible with metadata;
- easier pagination;
- easier validation;
- easier OpenAPI/schema documentation;
- avoids dynamic field names.

---

## 13. Optional Types

### 13.1 `Optional` in DTO: Use Carefully

Java `Optional<T>` was designed primarily as return type, not necessarily as field type.

Bad DTO:

```java
public class CustomerDto {
    public Optional<String> middleName;
}
```

Problems:

- provider support may vary;
- absent vs null semantics still unclear;
- nested optional creates weird JSON contract;
- validation and documentation become confusing.

Usually better:

```java
public class CustomerDto {
    public String middleName;
}
```

And define contract:

```text
middleName absent/null/empty semantics are documented externally.
```

For internal Java API:

```java
public Optional<String> middleName() {
    return Optional.ofNullable(middleName);
}
```

But do not expose that as JSON property accidentally.

### 13.2 Optional in Response vs Patch

Optional as Java semantic:

```java
Optional<String> findMiddleName()
```

is different from JSON patch semantic:

```text
field absent => no change
field null => clear value
field value => set value
```

Do not solve PATCH semantics with `Optional<T>` blindly. JSON-P patch/merge patch or explicit wrapper is usually better.

---

## 14. Polymorphism: Powerful but Dangerous

### 14.1 Basic Problem

Suppose:

```java
public interface NotificationTarget {
}

public class EmailTarget implements NotificationTarget {
    public String email;
}

public class SmsTarget implements NotificationTarget {
    public String phoneNumber;
}

public class NotificationRequest {
    public NotificationTarget target;
}
```

JSON:

```json
{
  "target": {
    "email": "a@example.com"
  }
}
```

How does JSON-B know whether `target` is `EmailTarget` or `SmsTarget`?

It cannot infer safely in all cases.

### 14.2 Type Discriminator

A contract-friendly design:

```json
{
  "target": {
    "type": "EMAIL",
    "email": "a@example.com"
  }
}
```

or:

```json
{
  "targetType": "EMAIL",
  "target": {
    "email": "a@example.com"
  }
}
```

This is not just serialization detail. It is contract design.

### 14.3 Security Warning

Polymorphic deserialization can be dangerous when external JSON can choose Java class names or arbitrary subtypes.

Unsafe mental model:

```json
{
  "@class": "com.internal.SomeDangerousClass",
  "...": "..."
}
```

Safer model:

- allowlist types;
- use stable business discriminator;
- never expose arbitrary Java class names as type ids;
- map discriminator manually if needed;
- fail closed for unknown type.

JSON-B 3.0 added/improved support for polymorphic handling, but production design still needs a clear allowlist and contract model.

---

## 15. Generic DTOs and Envelope Patterns

### 15.1 Common Envelope

Enterprise APIs often use envelope:

```json
{
  "status": "SUCCESS",
  "data": {
    "id": "C001",
    "name": "Alice"
  },
  "errors": []
}
```

Java:

```java
public class ApiResponse<T> {
    public String status;
    public T data;
    public List<ApiError> errors;
}
```

Serialization works if runtime sees actual object.

Deserialization needs `Type`:

```java
Type type = new GenericType<ApiResponse<CustomerDto>>() {}.getType();
ApiResponse<CustomerDto> response = jsonb.fromJson(json, type);
```

### 15.2 Envelope Anti-Pattern

Not every API needs envelope.

Bad overgeneric response:

```json
{
  "success": true,
  "code": "200",
  "message": "OK",
  "object": {
    "anything": "here"
  }
}
```

Problems:

- duplicates HTTP semantics;
- weak schema;
- consumer has to parse nested dynamic object;
- error handling becomes inconsistent;
- versioning harder.

Better API design depends on context:

```text
HTTP 200 + typed response body
HTTP 400 + problem/error response
HTTP 404 + problem/error response
HTTP 500 + problem/error response
```

For messaging or legacy integration, envelope may still be useful because transport may not provide HTTP semantics.

Top-level principle:

> Use envelope because the integration channel needs it, not because every response must look uniform.

---

## 16. JSON-B and Jakarta REST

Even though this series avoids repeating JAX-RS details, JSON-B commonly appears through Jakarta REST providers.

Example resource:

```java
@Path("/customers")
public class CustomerResource {

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public CustomerResponse create(CreateCustomerRequest request) {
        // request may be deserialized using JSON-B provider
        return service.create(request);
    }
}
```

In this style:

```text
HTTP body JSON
    -> JSON-B provider
    -> CreateCustomerRequest
    -> resource method
    -> CustomerResponse
    -> JSON-B provider
    -> HTTP response JSON
```

Important implication:

- you may not see `JsonbBuilder.create()` in code;
- runtime/framework chooses provider;
- config may be container-specific;
- behavior may differ across app servers;
- tests should verify actual deployed provider behavior.

Do not assume local unit test with one JSON-B provider equals production server behavior unless dependencies/config are aligned.

---

## 17. Java 8 sampai Java 25 Compatibility Map

### 17.1 Java Version Considerations

| Java Version | JSON-B Consideration |
|---|---|
| Java 8 | Common legacy baseline; `javax.json.bind` era; no records; old date/time support depends provider/version |
| Java 9–10 | module system exists, but many enterprise apps still classpath-based |
| Java 11 | Java EE modules removed from JDK; always manage dependencies explicitly |
| Java 17 | common LTS; records available; stronger encapsulation considerations |
| Java 21 | common modern LTS; records/sealed classes mature; virtual threads not directly JSON-B-specific but affect request concurrency |
| Java 25 | modern runtime target; dependency compatibility and Jakarta stack version matter more than language alone |

JSON-B itself is not a Java language feature. The binding behavior depends on:

- API version;
- provider version;
- container version;
- namespace `javax` vs `jakarta`;
- classpath/module path;
- DTO design;
- reflection access;
- native-image constraints if used.

### 17.2 Javax to Jakarta Migration

Old:

```java
import javax.json.bind.Jsonb;
import javax.json.bind.JsonbBuilder;
```

New:

```java
import jakarta.json.bind.Jsonb;
import jakarta.json.bind.JsonbBuilder;
```

This is source-level incompatible. You cannot simply mix both namespaces freely.

Migration concerns:

- dependency coordinates differ;
- annotation package names differ;
- app server version matters;
- transitive dependencies may pull old namespace;
- library APIs compiled against `javax` cannot be directly used as `jakarta` APIs;
- tests must run with target runtime.

### 17.3 Dependency Mental Model

Standalone Java app needs:

```text
JSON-B API jar
+ JSON-B implementation/provider jar
+ JSON-P API/implementation as required by provider
```

In Jakarta EE app server:

```text
server may provide API + implementation
application should avoid conflicting bundled versions unless intentionally isolated
```

Common failure:

```text
No Jsonb provider found
ClassNotFoundException jakarta.json.bind.Jsonb
NoSuchMethodError due to version mismatch
javax/jakarta mixed classpath
```

Root cause is often dependency alignment, not JSON mapping logic.

---

## 18. Boundary Design Patterns with JSON-B

### 18.1 Request DTO Pattern

```java
public class CreateApplicationRequest {
    public String applicantId;
    public String applicationType;
    public String submittedChannel;
}
```

Layering:

```text
JSON-B DTO
    -> syntactic validation
    -> semantic validation
    -> command object
    -> domain service
```

Command object:

```java
public final class CreateApplicationCommand {
    private final ApplicantId applicantId;
    private final ApplicationType applicationType;
    private final Channel channel;

    public CreateApplicationCommand(ApplicantId applicantId,
                                    ApplicationType applicationType,
                                    Channel channel) {
        this.applicantId = Objects.requireNonNull(applicantId);
        this.applicationType = Objects.requireNonNull(applicationType);
        this.channel = Objects.requireNonNull(channel);
    }
}
```

Do not let JSON-B instantiate domain command directly unless you are very deliberate.

### 18.2 Response DTO Pattern

```java
public class ApplicationResponse {
    public String applicationNo;
    public String status;
    public String submittedAt;
    public List<ActionResponse> availableActions;
}
```

Response DTO is not merely entity dump. It answers:

- what should caller know?
- what should caller not know?
- what state vocabulary should be stable?
- what actions are legal next?

### 18.3 Vendor Payload Pattern

Vendor payload should often be isolated:

```java
public class VendorAddressLookupResponse {
    public String postalCode;
    public String block;
    public String streetName;
    public String buildingName;
    public String x;
    public String y;
}
```

Then map to internal:

```java
public AddressCandidate toCandidate(VendorAddressLookupResponse vendor) {
    return new AddressCandidate(
            vendor.postalCode,
            vendor.block,
            vendor.streetName,
            vendor.buildingName,
            parseCoordinate(vendor.x),
            parseCoordinate(vendor.y)
    );
}
```

Never spread vendor DTO throughout domain.

### 18.4 Audit/Event DTO Pattern

Audit JSON needs special care:

```java
public class AuditEventJson {
    public String eventId;
    public String eventType;
    public String actorId;
    public Instant occurredAt;
    public String entityType;
    public String entityId;
    public Map<String, Object> changes;
}
```

Questions:

- Should field order be deterministic?
- Should null be included?
- Should number precision be preserved?
- Should sensitive values be redacted before serialization?
- Should schema version be included?
- Can event be replayed?
- Is JSON used for signature/hash?

For audit, JSON-B convenience may not be enough. Sometimes combine:

```text
DTO construction with JSON-B
+ canonicalization with JSON-P/custom layer
+ hash/signature
+ immutable storage
```

---

## 19. Validation: JSON-B Does Not Replace Validation

JSON-B answers:

> “Can this JSON be converted into this Java type?”

Validation answers:

> “Is this request allowed and meaningful?”

Example DTO:

```java
public class CreateCustomerRequest {
    public String email;
    public String displayName;
}
```

JSON-B may deserialize:

```json
{
  "email": "not an email",
  "displayName": ""
}
```

The object exists, but it is invalid.

Use Bean Validation or manual validation:

```java
public class CreateCustomerRequest {
    @NotBlank
    @Email
    public String email;

    @NotBlank
    @Size(max = 100)
    public String displayName;
}
```

But validation is not enough for semantic rule:

```text
email domain must be allowed for this tenant
applicant must not already have active application
case type must be open for current period
role must be assignable by current actor
```

Those belong to application/domain service.

Layer model:

```text
JSON syntax validity
    -> JSON-B type binding
    -> structural validation
    -> semantic/application validation
    -> domain invariant
    -> persistence/integration side effects
```

---

## 20. Error Handling Model

### 20.1 Binding Failure vs Business Failure

Binding failure:

```json
{
  "count": "abc"
}
```

DTO:

```java
public class Request {
    public int count;
}
```

This should become something like:

```text
400 Bad Request: invalid JSON field type
```

Business failure:

```json
{
  "count": 5
}
```

But count exceeds user quota.

This should become:

```text
409 Conflict / 422 Unprocessable Entity / domain-specific error
```

Do not collapse all exceptions into 500.

### 20.2 Error Taxonomy

| Error | Example | Typical Response |
|---|---|---|
| Malformed JSON | missing brace | 400 |
| Type mismatch | string for integer | 400 |
| Unknown enum | invalid status | 400 or compatibility handling |
| Missing required field | no `email` | 400 |
| Validation failure | invalid email | 400/422 |
| Business rule failure | duplicate active case | 409/422 |
| Downstream failure | vendor timeout | 502/503 depending context |
| Internal serialization bug | cyclic object | 500 and fix code |

The exact status code depends on API convention, but taxonomy must be clear.

---

## 21. Performance Model

### 21.1 What Costs Time?

JSON-B cost comes from:

- parsing JSON text;
- object allocation;
- reflection/introspection;
- adapter invocation;
- date/time formatting;
- BigDecimal parsing;
- nested object graph traversal;
- collection allocation;
- string creation;
- validation after binding;
- GC pressure.

### 21.2 Hot Path Rules

For high-throughput services:

- reuse `Jsonb` engine;
- avoid serializing huge object graphs accidentally;
- avoid entity serialization;
- avoid `Map<String,Object>` unless necessary;
- avoid excessive custom adapters in hot path;
- pre-size collections when manually mapping;
- use streaming JSON-P for very large payloads;
- benchmark with realistic payloads;
- measure allocation rate, not just latency.

### 21.3 Large Payload Decision

If payload is small/medium and maps naturally to DTO:

```text
JSON-B is fine.
```

If payload is huge but you need only 3 fields:

```text
JSON-P streaming extraction may be better.
```

If payload is huge and must fully become object graph:

```text
JSON-B may be acceptable, but memory and timeout budget must be explicit.
```

If payload is used for audit hash/signature:

```text
JSON-B alone may be insufficient due to output determinism/canonicalization concerns.
```

---

## 22. Security Model

### 22.1 JSON-B Security Risks

JSON-B-specific or binding-related risks:

- mass assignment: input sets fields it should not set;
- internal field exposure during serialization;
- polymorphic deserialization abuse;
- large/deep payload causing resource exhaustion;
- numeric overflow/precision attacks;
- date/time ambiguity;
- unknown fields ignored when strictness required;
- logging raw deserialization error with PII;
- exception messages exposing class/package internals;
- provider mismatch causing unexpected behavior.

### 22.2 Mass Assignment Example

Bad request DTO:

```java
public class UpdateUserRequest {
    public String displayName;
    public String role;
    public boolean active;
}
```

Client sends:

```json
{
  "displayName": "Alice",
  "role": "ADMIN",
  "active": true
}
```

If handler blindly applies all fields, privilege escalation risk.

Better:

```java
public class UpdateOwnProfileRequest {
    public String displayName;
}
```

Admin-only request separate:

```java
public class AdminUpdateUserRequest {
    public String role;
    public Boolean active;
}
```

Authorization is still required. DTO separation reduces accidental attack surface.

### 22.3 Redaction Before Serialization

Bad:

```java
public class UserResponse {
    public String id;
    public String email;
    public String passwordHash;
    public String resetToken;
}
```

Even if you intend not to set those fields, someone may later populate them.

Better:

```java
public class UserResponse {
    public String id;
    public String email;
}
```

Do not rely on “we won’t set sensitive field” if the field exists in response DTO.

---

## 23. Testing Strategy

### 23.1 Golden File Contract Test

For external JSON contract, test actual JSON.

```java
@Test
void shouldSerializeCustomerResponseContract() {
    CustomerResponse response = new CustomerResponse();
    response.id = "C001";
    response.name = "Alice";

    String json = jsonb.toJson(response);

    assertThat(json).isEqualToIgnoringWhitespace("""
        {
          "id": "C001",
          "name": "Alice"
        }
        """);
}
```

For Java 8, use normal string.

```java
String expected = "{\"id\":\"C001\",\"name\":\"Alice\"}";
```

Caution: if ordering is not guaranteed, compare parsed structure, not raw string.

### 23.2 Round-Trip Test Is Not Enough

Bad test:

```java
CustomerDto original = new CustomerDto("C001", "Alice");
String json = jsonb.toJson(original);
CustomerDto restored = jsonb.fromJson(json, CustomerDto.class);
assertEquals(original, restored);
```

This only proves JSON-B can read its own output. It does not prove compatibility with external contract.

Better tests:

- serialize expected JSON contract;
- deserialize known external JSON samples;
- reject malformed/invalid cases;
- test unknown fields if strictness matters;
- test null/absent semantics;
- test enum unknown value;
- test date/time timezone;
- test provider in same version as runtime.

### 23.3 Compatibility Test Matrix

For each DTO boundary:

| Test Type | Purpose |
|---|---|
| sample request deserialization | ensures consumer input accepted |
| sample response serialization | ensures provider output stable |
| null/absent tests | ensures semantic correctness |
| unknown field tests | ensures strict/lenient policy |
| version N-1 sample | backward compatibility |
| version N+1 tolerance | forward compatibility if needed |
| invalid type tests | error mapping |
| max size/depth tests | robustness |

---

## 24. Observability

Serialization/deserialization failures are often hard to debug because raw payload may contain sensitive data.

Good logging:

```text
event=json_binding_failed
boundary=PartnerXCreateCase
direction=inbound
correlationId=...
fieldPath=/applicant/dateOfBirth
reason=invalid_date_format
payloadSizeBytes=2381
provider=yasson
api=jakarta-jsonb-3.0
```

Bad logging:

```text
Failed to parse payload: { full raw JSON with NRIC/email/token/password }
```

Recommended:

- log boundary name;
- log direction inbound/outbound;
- log correlation ID;
- log field path if available;
- log sanitized reason;
- log payload size/hash, not full payload;
- preserve raw payload only in secure quarantine if policy allows;
- metrics for binding failures by boundary.

---

## 25. Practical Decision Matrix

### 25.1 When JSON-B Is a Good Fit

Use JSON-B when:

- you are in Jakarta EE/Jakarta REST ecosystem;
- DTO maps naturally to JSON;
- contract is relatively stable;
- standard API portability matters;
- you want annotations/config rather than manual JSON traversal;
- payload size is reasonable;
- you do not need heavy custom polymorphic magic;
- provider behavior is tested.

### 25.2 When JSON-B Is Not the Best Fit

Prefer JSON-P/manual processing when:

- payload is very large and only partial fields needed;
- mutation/patch/canonicalization is primary;
- absent vs null must be tracked precisely at raw JSON level;
- dynamic JSON structure dominates;
- signature/hash requires deterministic canonical JSON;
- security requires pre-validation before object construction.

Consider Jackson when:

- application stack is Spring Boot/Jackson-centric;
- you need Jackson-specific features;
- existing codebase heavily uses Jackson annotations/modules;
- organization has standardized on Jackson.

But avoid mixing JSON-B and Jackson annotations on same DTO unless you deliberately test both outputs.

---

## 26. Anti-Patterns

### 26.1 Entity Serialization

```java
return jsonb.toJson(jpaEntity);
```

Usually bad for external API.

### 26.2 One DTO for Everything

```java
UserDto used for create, update, response, admin response, audit, vendor sync.
```

This creates security and compatibility problems.

### 26.3 Letting Java Refactor Change JSON Contract

Renaming Java field without `@JsonbProperty` can break JSON consumers.

### 26.4 Blind Round-Trip Testing

Round-trip tests hide contract drift.

### 26.5 Treating JSON-B as Validation

Deserialized object is not necessarily valid.

### 26.6 Global Config Without Boundary Ownership

One global naming/date/null strategy for all vendors and APIs causes silent breakage.

### 26.7 Ignoring Javax/Jakarta Namespace

Mixing `javax.json.bind` and `jakarta.json.bind` dependencies causes migration pain.

---

## 27. Reference Implementation Skeleton

A simple production-minded JSON-B support class:

```java
import jakarta.json.bind.Jsonb;
import jakarta.json.bind.JsonbBuilder;
import jakarta.json.bind.JsonbConfig;
import jakarta.json.bind.config.PropertyNamingStrategy;

public final class BoundaryJsonb implements AutoCloseable {
    private final Jsonb jsonb;
    private final String boundaryName;

    private BoundaryJsonb(String boundaryName, JsonbConfig config) {
        this.boundaryName = boundaryName;
        this.jsonb = JsonbBuilder.create(config);
    }

    public static BoundaryJsonb publicApi() {
        JsonbConfig config = new JsonbConfig()
                .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES)
                .withNullValues(false);
        return new BoundaryJsonb("public-api", config);
    }

    public static BoundaryJsonb audit() {
        JsonbConfig config = new JsonbConfig()
                .withNullValues(true)
                .withFormatting(false);
        return new BoundaryJsonb("audit", config);
    }

    public String toJson(Object value) {
        try {
            return jsonb.toJson(value);
        } catch (RuntimeException e) {
            throw new JsonBindingBoundaryException(boundaryName, "serialize", e);
        }
    }

    public <T> T fromJson(String json, Class<T> type) {
        try {
            return jsonb.fromJson(json, type);
        } catch (RuntimeException e) {
            throw new JsonBindingBoundaryException(boundaryName, "deserialize", e);
        }
    }

    @Override
    public void close() throws Exception {
        jsonb.close();
    }
}
```

Exception:

```java
public final class JsonBindingBoundaryException extends RuntimeException {
    private final String boundaryName;
    private final String direction;

    public JsonBindingBoundaryException(String boundaryName,
                                        String direction,
                                        Throwable cause) {
        super("JSON binding failed for boundary=" + boundaryName
                + ", direction=" + direction, cause);
        this.boundaryName = boundaryName;
        this.direction = direction;
    }

    public String getBoundaryName() {
        return boundaryName;
    }

    public String getDirection() {
        return direction;
    }
}
```

This class is intentionally simple. Real production code may add:

- metrics;
- sanitized error extraction;
- payload size guard;
- secure debug capture;
- `Type` overload;
- adapter registration;
- provider/version logging.

---

## 28. Checklist JSON-B Core Model

Sebelum memakai JSON-B untuk boundary production, jawab ini:

1. Apakah ini DTO boundary, bukan entity/domain object?
2. Apakah request dan response DTO dipisahkan?
3. Apakah field JSON penting diberi nama eksplisit?
4. Apakah null vs absent semantics jelas?
5. Apakah date/time type benar?
6. Apakah enum external stabil dan tidak membocorkan internal state?
7. Apakah numeric precision aman?
8. Apakah generic deserialization memakai `Type`?
9. Apakah polymorphism dibatasi allowlist?
10. Apakah validation layer terpisah dari binding?
11. Apakah error binding dipetakan ke response yang benar?
12. Apakah `Jsonb` lifecycle dikelola dan tidak dibuat per request?
13. Apakah provider/runtime sama antara test dan production?
14. Apakah Javax/Jakarta namespace sudah konsisten?
15. Apakah contract tests berbasis sample JSON tersedia?
16. Apakah sensitive fields tidak ada di response DTO?
17. Apakah logging binding failure tidak membocorkan PII?
18. Apakah payload besar perlu JSON-P streaming instead?
19. Apakah config global tidak merusak vendor-specific contract?
20. Apakah migration Java 8–25 sudah mempertimbangkan dependency/provider?

---

## 29. Mental Model Akhir

JSON-B bukan sekadar serializer.

JSON-B adalah:

```text
Contract-aware object binding engine
```

Ia berada di antara:

```text
External JSON representation
        |
        | syntax + type binding
        v
Boundary DTO
        |
        | validation + mapping
        v
Application command / domain model
```

Kesalahan engineer rata-rata:

> “Saya punya object, tinggal convert ke JSON.”

Cara berpikir engineer top-level:

> “Saya punya boundary contract. Saya perlu memilih representasi Java yang stabil, aman, validatable, evolvable, dan tidak membocorkan model internal. JSON-B adalah engine untuk binding representasi itu, bukan pengganti desain kontrak.”

---

## 30. Ringkasan Part 7

Di part ini kita membahas:

- posisi JSON-B sebagai standard binding layer;
- perbedaan JSON-B, JSON-P, Jackson, Gson;
- API utama `Jsonb`, `JsonbBuilder`, dan `JsonbConfig`;
- lifecycle dan reuse `Jsonb`;
- default mapping dan risiko contract drift;
- serialization vs deserialization sebagai dua arah trust yang berbeda;
- object construction, mutable DTO, immutable DTO, dan records;
- field/property discovery;
- naming strategy;
- null vs absent;
- number precision;
- date/time contract;
- enum mapping;
- collections dan generic `Type`;
- optional field caveat;
- polymorphism risk;
- envelope pattern;
- Jakarta REST integration;
- Java 8–25 compatibility;
- validation, error handling, performance, security, testing, dan observability.

Part berikutnya akan lebih spesifik ke annotation:

> **Part 8 — JSON-B Annotation Deep Dive**

Kita akan membahas `@JsonbProperty`, `@JsonbTransient`, `@JsonbDateFormat`, `@JsonbNumberFormat`, `@JsonbTypeAdapter`, `@JsonbCreator`, visibility, ordering, naming, dan cara memakai annotation tanpa membuat DTO menjadi fragile.

---

## 31. Status Series

- Part saat ini: **Part 7 dari 34**
- Status: **Belum selesai**
- Berikutnya: **Part 8 — JSON-B Annotation Deep Dive**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-006.md">⬅️ Part 6 — P Advanced Production Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-008.md">Part 008 — B Annotation Deep Dive ➡️</a>
</div>
