# learn-java-json-xml-soap-connectors-enterprise-integration-part-009

# Part 9 — JSON-B Customization & Provider Internals

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Level: Advanced / Enterprise / Java 8–25  
> Fokus: JSON-B customization, adapters, serializers, deserializers, provider behavior, runtime lifecycle, strictness, security, performance, dan failure modeling.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas annotation JSON-B: `@JsonbProperty`, `@JsonbTransient`, `@JsonbDateFormat`, `@JsonbNumberFormat`, `@JsonbTypeAdapter`, `@JsonbCreator`, naming strategy, dan cara annotation membentuk kontrak JSON.

Part ini naik satu level lebih dalam.

Kita tidak lagi hanya bertanya:

> “Annotation apa yang harus saya pakai agar field ini berubah nama?”

Tetapi:

> “Bagaimana saya mengontrol proses binding ketika mapping default sudah tidak cukup, tanpa merusak kontrak, performance, thread-safety, security, dan compatibility Java/Jakarta?”

JSON-B bukan sekadar library object mapper. Dalam sistem enterprise, JSON-B adalah salah satu titik boundary yang menentukan:

- data eksternal berubah menjadi object internal;
- object internal keluar menjadi contract payload;
- null, absent, default value, enum, tanggal, angka, dan polymorphism diterjemahkan;
- field asing diterima, diabaikan, atau ditolak;
- error parsing menjadi error domain/API;
- provider runtime seperti Yasson menjalankan aturan spesifikasi plus extension behavior.

Di part ini kita fokus pada **customization dan runtime behavior**.

---

## 1. Target Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan kapan menggunakan annotation, adapter, serializer, deserializer, naming strategy, property visibility strategy, atau konfigurasi global.
2. Mendesain `JsonbAdapter` yang aman untuk boundary DTO, value object, enum, ID, money, date/time, dan legacy payload.
3. Mendesain `JsonbSerializer` dan `JsonbDeserializer` ketika struktur JSON tidak lagi 1:1 dengan class Java.
4. Memahami lifecycle `Jsonb`, provider discovery, dan konsekuensi thread-safety/caching.
5. Memahami perbedaan antara JSON-B specification behavior dan provider-specific behavior.
6. Menghindari bug production seperti silent field ignore, over-posting, broken null semantics, timezone drift, polymorphic injection, dan hidden contract drift.
7. Membuat strategi strict input validation walaupun JSON-B punya prinsip lenient/must-ignore pada field yang tidak dikenal.
8. Menyusun testing matrix untuk custom JSON-B mapping.

---

## 2. Mental Model: JSON-B Customization Bukan “Aesthetic Mapping”

Dalam banyak tutorial, customization JSON-B terlihat seperti kosmetik:

```java
@JsonbProperty("first_name")
private String firstName;
```

Atau:

```java
@JsonbDateFormat("yyyy-MM-dd")
private LocalDate birthDate;
```

Namun di sistem enterprise, mapping adalah bagian dari **contract enforcement**.

Satu keputusan mapping dapat mengubah:

- apakah client lama masih compatible;
- apakah field internal bocor ke publik;
- apakah data audit bisa direkonstruksi;
- apakah decimal money kehilangan presisi;
- apakah timezone berubah saat integrasi antar negara;
- apakah payload malicious bisa masuk ke object domain;
- apakah field asing dari client akan diam-diam diabaikan;
- apakah migrasi Javax → Jakarta gagal karena package berubah;
- apakah provider upgrade mengubah output JSON.

Mental model utamanya:

```text
JSON-B customization is not about making JSON pretty.
It is about defining a controlled translation boundary.
```

Boundary yang baik punya sifat:

1. **Explicit** — field yang masuk/keluar jelas.
2. **Stable** — perubahan internal tidak otomatis mengubah external contract.
3. **Auditable** — transformasi bisa dijelaskan dan diuji.
4. **Fail-safe** — input berbahaya/ambigu tidak diam-diam diterima.
5. **Version-aware** — mampu hidup berdampingan dengan client lama dan baru.
6. **Provider-aware** — tidak bergantung pada behavior non-standar tanpa alasan.

---

## 3. JSON-B Runtime Layer: Dari API Sampai Provider

JSON-B mendefinisikan API standar untuk binding Java object ke/dari JSON document. API ini disediakan oleh spesifikasi Jakarta JSON Binding, sedangkan implementasi aktualnya disediakan oleh provider seperti Eclipse Yasson. Jakarta JSON Binding 3.0 adalah release untuk Jakarta EE 10 dan mendefinisikan framework binding Java object ↔ JSON document.

Secara konseptual:

```text
Application Code
      |
      v
Jsonb API
  - Jsonb
  - JsonbBuilder
  - JsonbConfig
  - JsonbAdapter
  - JsonbSerializer
  - JsonbDeserializer
      |
      v
Provider SPI / Implementation
  - Yasson
  - other JSON-B provider
      |
      v
JSON-P Provider
  - parser/generator/object model
      |
      v
InputStream / Reader / String / OutputStream / Writer
```

JSON-B biasanya berdiri di atas JSON-P. JSON-P menyediakan parser/generator/tree model; JSON-B menyediakan object binding.

Implikasinya:

- bug mapping bisa berasal dari code kamu;
- behavior bisa berasal dari JSON-B spec;
- behavior juga bisa berasal dari provider JSON-B;
- parsing/generator detail bisa berasal dari JSON-P provider;
- container bisa menyisipkan provider default;
- dependency aplikasi bisa bentrok dengan provider container.

Di luar Jakarta EE container, kamu biasanya membawa API dan implementation sendiri. Di dalam application server, container bisa sudah menyediakan JSON-B provider.

---

## 4. `Jsonb` Lifecycle: Jangan Dibuat Sembarangan Per Request

`Jsonb` adalah façade utama.

Contoh sederhana:

```java
Jsonb jsonb = JsonbBuilder.create();
String json = jsonb.toJson(orderDto);
OrderDto dto = jsonb.fromJson(json, OrderDto.class);
```

Secara sekilas ini terlihat murah. Tetapi secara runtime, pembuatan `Jsonb` dapat melibatkan:

- provider lookup;
- konfigurasi mapping;
- introspection class;
- annotation scanning;
- serializer/deserializer registry;
- adapter initialization;
- caching metadata;
- underlying JSON-P provider setup.

Prinsip production:

```text
Create Jsonb as a long-lived component, not as a per-request throwaway object.
```

Contoh buruk:

```java
public String serialize(OrderDto dto) {
    try (Jsonb jsonb = JsonbBuilder.create()) {
        return jsonb.toJson(dto);
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

Masalah:

- overhead berulang;
- metadata cache tidak optimal;
- sulit mengontrol config global;
- error behavior bisa tidak konsisten;
- sulit di-test sebagai boundary dependency;
- berpotensi leak jika tidak ditutup di beberapa provider/context tertentu.

Contoh lebih baik:

```java
public final class JsonbCodec implements AutoCloseable {
    private final Jsonb jsonb;

    public JsonbCodec(JsonbConfig config) {
        this.jsonb = JsonbBuilder.create(config);
    }

    public String encode(Object value) {
        return jsonb.toJson(value);
    }

    public <T> T decode(String json, Class<T> type) {
        return jsonb.fromJson(json, type);
    }

    @Override
    public void close() throws Exception {
        jsonb.close();
    }
}
```

Dalam Jakarta EE/CDI:

```java
@ApplicationScoped
public class JsonbProducer {

    private Jsonb jsonb;

    @PostConstruct
    void init() {
        JsonbConfig config = new JsonbConfig()
                .withNullValues(false)
                .withFormatting(false);

        this.jsonb = JsonbBuilder.create(config);
    }

    @Produces
    @ApplicationScoped
    public Jsonb jsonb() {
        return jsonb;
    }

    @PreDestroy
    void destroy() throws Exception {
        jsonb.close();
    }
}
```

Dalam Spring Boot, jika menggunakan JSON-B secara eksplisit:

```java
@Configuration
class JsonbConfiguration {

    @Bean(destroyMethod = "close")
    Jsonb jsonb() {
        JsonbConfig config = new JsonbConfig()
                .withNullValues(false)
                .withFormatting(false);
        return JsonbBuilder.create(config);
    }
}
```

Catatan penting:

- Pastikan custom adapter/serializer/deserializer kamu sendiri thread-safe jika instance-nya digunakan ulang.
- Hindari mutable shared state di adapter kecuali immutable/cache safe.
- Jangan menyimpan request-specific data di adapter singleton.

---

## 5. Customization Decision Ladder

Sebelum membuat custom serializer/deserializer, gunakan tangga keputusan berikut.

```text
Need custom JSON behavior?
        |
        v
1. Can default mapping solve it?
        |
        +-- yes --> use default JSON-B mapping
        |
        no
        v
2. Is it just field name/order/date/number/null visibility?
        |
        +-- yes --> use annotation or JsonbConfig
        |
        no
        v
3. Is it type-level value conversion A <-> B?
        |
        +-- yes --> use JsonbAdapter
        |
        no
        v
4. Is output JSON shape custom but still one-way/simple?
        |
        +-- yes --> use JsonbSerializer
        |
        no
        v
5. Is input JSON shape custom/legacy/ambiguous?
        |
        +-- yes --> use JsonbDeserializer
        |
        no
        v
6. Is behavior cross-cutting over many classes?
        |
        +-- yes --> use naming/visibility strategy or boundary pre-validation
```

Rule of thumb:

| Need | Best Tool |
|---|---|
| Rename field | `@JsonbProperty` / naming strategy |
| Hide field | `@JsonbTransient` / visibility strategy |
| Date/number format | `@JsonbDateFormat`, `@JsonbNumberFormat`, config |
| Convert value object to scalar | `JsonbAdapter` |
| Convert scalar to value object | `JsonbAdapter` |
| Custom full JSON output | `JsonbSerializer` |
| Custom full JSON input | `JsonbDeserializer` |
| Reject unknown fields | Pre-validate with JSON-P/schema/manual allowlist |
| Avoid exposing internal fields | Dedicated DTO + allowlist visibility |
| Handle polymorphism | Prefer explicit type mapping; avoid arbitrary class names |
| Versioned API payload | DTO per version or adapter facade |

A top engineer tidak langsung menulis serializer. Serializer/deserializer adalah escape hatch. Semakin powerful alatnya, semakin besar risiko behavior tidak lagi obvious.

---

## 6. `JsonbAdapter`: Konversi Type-Level yang Terkontrol

`JsonbAdapter<Original, Adapted>` dipakai ketika kamu punya tipe Java tertentu yang ingin direpresentasikan sebagai bentuk JSON lain.

Mental model:

```text
Original Java Type <---- adapter ----> Adapted JSON-bindable Type
```

Contoh: domain value object `CustomerId` ingin muncul sebagai string.

```java
public record CustomerId(String value) {
    public CustomerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CustomerId must not be blank");
        }
    }
}
```

Adapter:

```java
public final class CustomerIdAdapter implements JsonbAdapter<CustomerId, String> {

    @Override
    public String adaptToJson(CustomerId obj) {
        return obj == null ? null : obj.value();
    }

    @Override
    public CustomerId adaptFromJson(String obj) {
        return obj == null ? null : new CustomerId(obj);
    }
}
```

DTO:

```java
public class CustomerDto {
    @JsonbTypeAdapter(CustomerIdAdapter.class)
    public CustomerId id;

    public String name;
}
```

Output:

```json
{
  "id": "CUST-001",
  "name": "Alice"
}
```

Tanpa adapter, JSON-B mungkin mencoba memperlakukan `CustomerId` sebagai object:

```json
{
  "id": {
    "value": "CUST-001"
  },
  "name": "Alice"
}
```

Itu bisa menjadi contract leak: struktur internal value object bocor ke payload publik.

---

## 7. Kapan Adapter Lebih Baik Dari Serializer?

Gunakan adapter jika:

- perubahan representasi bersifat type-level;
- bentuk JSON yang dihasilkan masih bisa di-bind oleh JSON-B;
- kamu ingin reusable mapping untuk banyak field;
- mapping relatif deterministic;
- tidak perlu kontrol token-level JSON generator.

Contoh cocok untuk adapter:

| Java Type | JSON Representation |
|---|---|
| `CustomerId` | string |
| `Money` | object `{ "currency": "USD", "amount": "10.25" }` |
| `EmailAddress` | string |
| `YearMonth` | string `yyyy-MM` |
| `StatusCode` | string code |
| `LocalDateRange` | object `{ "from": "...", "to": "..." }` |

Contoh kurang cocok untuk adapter:

- output field conditional yang tergantung banyak property lain;
- flattening object kompleks ke beberapa sibling fields;
- legacy JSON dengan multiple alternative shapes;
- transformasi yang butuh membaca raw JSON object;
- custom error location/token handling;
- streaming output custom.

Untuk kasus seperti itu, serializer/deserializer lebih tepat.

---

## 8. Adapter Untuk `Money`: Presisi dan Contract Stability

Money adalah contoh klasik mapping yang terlihat sederhana tapi sering berbahaya.

Jangan gunakan `double`:

```java
public class BadPaymentDto {
    public double amount;
}
```

Masalah:

- binary floating-point tidak merepresentasikan decimal money dengan presisi exact;
- output bisa berubah bentuk;
- perbandingan dan audit menjadi bermasalah.

Gunakan `BigDecimal` dan representasi eksplisit.

```java
public record Money(String currency, BigDecimal amount) {
    public Money {
        if (currency == null || !currency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("Invalid currency");
        }
        if (amount == null) {
            throw new IllegalArgumentException("Amount is required");
        }
        amount = amount.stripTrailingZeros();
    }
}
```

Bentuk JSON bisa dipilih:

Option A — amount sebagai number:

```json
{
  "currency": "USD",
  "amount": 10.25
}
```

Option B — amount sebagai string:

```json
{
  "currency": "USD",
  "amount": "10.25"
}
```

Untuk audit/integrasi finansial, amount sebagai string sering lebih defensible karena menghindari ambiguity parser/client lain.

Adapter:

```java
public final class MoneyAdapter implements JsonbAdapter<Money, MoneyAdapter.JsonMoney> {

    public static class JsonMoney {
        public String currency;
        public String amount;
    }

    @Override
    public JsonMoney adaptToJson(Money money) {
        if (money == null) {
            return null;
        }

        JsonMoney json = new JsonMoney();
        json.currency = money.currency();
        json.amount = money.amount().toPlainString();
        return json;
    }

    @Override
    public Money adaptFromJson(JsonMoney json) {
        if (json == null) {
            return null;
        }
        return new Money(json.currency, new BigDecimal(json.amount));
    }
}
```

DTO:

```java
public class InvoiceDto {
    public String invoiceNo;

    @JsonbTypeAdapter(MoneyAdapter.class)
    public Money total;
}
```

Prinsip desain:

```text
Financial values should prioritize deterministic representation over convenience.
```

---

## 9. Adapter Untuk Enum: Jangan Bocorkan Nama Enum Internal

Enum Java sering berubah karena refactoring internal.

Contoh buruk:

```java
public enum CaseStatus {
    DRAFT,
    PENDING_REVIEW,
    APPROVED,
    REJECTED
}
```

Jika JSON menggunakan nama enum langsung:

```json
{
  "status": "PENDING_REVIEW"
}
```

Lalu tim refactor ke:

```java
UNDER_REVIEW
```

Contract client bisa rusak.

Lebih baik enum punya external code stabil.

```java
public enum CaseStatus {
    DRAFT("D"),
    PENDING_REVIEW("PR"),
    APPROVED("A"),
    REJECTED("R");

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

Adapter:

```java
public final class CaseStatusAdapter implements JsonbAdapter<CaseStatus, String> {
    @Override
    public String adaptToJson(CaseStatus status) {
        return status == null ? null : status.code();
    }

    @Override
    public CaseStatus adaptFromJson(String code) {
        return code == null ? null : CaseStatus.fromCode(code);
    }
}
```

DTO:

```java
public class CaseDto {
    @JsonbTypeAdapter(CaseStatusAdapter.class)
    public CaseStatus status;
}
```

Dengan ini JSON contract stabil:

```json
{
  "status": "PR"
}
```

Internal enum name bisa berubah tanpa memecahkan external contract.

---

## 10. Adapter Untuk Legacy Boolean/Flag

Legacy system sering memakai flag seperti:

```json
{
  "active": "Y"
}
```

Bukan:

```json
{
  "active": true
}
```

Jangan menyebarkan logic `"Y".equals(value)` di seluruh codebase. Bungkus di adapter.

```java
public final class YesNoBooleanAdapter implements JsonbAdapter<Boolean, String> {

    @Override
    public String adaptToJson(Boolean value) {
        if (value == null) {
            return null;
        }
        return value ? "Y" : "N";
    }

    @Override
    public Boolean adaptFromJson(String value) {
        if (value == null) {
            return null;
        }
        return switch (value) {
            case "Y" -> true;
            case "N" -> false;
            default -> throw new IllegalArgumentException("Expected Y or N, got: " + value);
        };
    }
}
```

Java 8 compatible version:

```java
public Boolean adaptFromJson(String value) {
    if (value == null) {
        return null;
    }
    if ("Y".equals(value)) {
        return true;
    }
    if ("N".equals(value)) {
        return false;
    }
    throw new IllegalArgumentException("Expected Y or N, got: " + value);
}
```

DTO:

```java
public class LegacyAccountDto {
    @JsonbTypeAdapter(YesNoBooleanAdapter.class)
    public Boolean active;
}
```

Prinsipnya:

```text
Legacy quirks should be isolated at integration boundary, not leak into domain logic.
```

---

## 11. Adapter dan Exception Semantics

Adapter sering menjadi titik validasi. Tetapi hati-hati: exception dari adapter akan dibungkus oleh JSON-B provider menjadi `JsonbException` atau exception runtime lain.

Contoh:

```java
@Override
public CustomerId adaptFromJson(String obj) {
    return new CustomerId(obj); // can throw IllegalArgumentException
}
```

Di API boundary, jangan expose exception mentah.

Buruk:

```java
try {
    return jsonb.fromJson(body, CustomerDto.class);
} catch (Exception e) {
    throw e;
}
```

Lebih baik:

```java
public CustomerDto parseCustomer(String body) {
    try {
        return jsonb.fromJson(body, CustomerDto.class);
    } catch (JsonbException | IllegalArgumentException e) {
        throw new BadRequestException("Invalid customer payload", e);
    }
}
```

Untuk sistem enterprise, lebih baik error response tidak membocorkan detail internal class:

```json
{
  "error": "INVALID_REQUEST",
  "message": "Invalid customer payload",
  "correlationId": "..."
}
```

Bukan:

```json
{
  "error": "java.lang.IllegalArgumentException: CustomerId must not be blank at com.company..."
}
```

---

## 12. `JsonbSerializer`: Saat Kamu Mengontrol Output JSON

`JsonbSerializer<T>` memberi kontrol terhadap proses serialization.

Gunakan serializer saat:

- output tidak 1:1 dengan field Java;
- kamu perlu conditional field output;
- kamu perlu flattening;
- kamu perlu menyusun JSON object secara manual;
- kamu ingin mengontrol ordering/shape secara eksplisit;
- kamu ingin menyembunyikan internal field berdasarkan aturan tertentu.

Contoh domain:

```java
public class UserProfile {
    private String id;
    private String firstName;
    private String lastName;
    private String email;
    private boolean emailVerified;

    // getters
}
```

External contract ingin:

```json
{
  "id": "U-1",
  "displayName": "Alice Tan",
  "contact": {
    "email": "alice@example.com",
    "verified": true
  }
}
```

Serializer:

```java
public final class UserProfileSerializer implements JsonbSerializer<UserProfile> {

    @Override
    public void serialize(UserProfile user,
                          JsonGenerator generator,
                          SerializationContext ctx) {
        if (user == null) {
            generator.writeNull();
            return;
        }

        generator.writeStartObject();
        generator.write("id", user.getId());
        generator.write("displayName", user.getFirstName() + " " + user.getLastName());

        generator.writeStartObject("contact");
        generator.write("email", user.getEmail());
        generator.write("verified", user.isEmailVerified());
        generator.writeEnd();

        generator.writeEnd();
    }
}
```

Apply dengan annotation:

```java
@JsonbTypeSerializer(UserProfileSerializer.class)
public class UserProfile {
    // fields
}
```

Atau register via config:

```java
JsonbConfig config = new JsonbConfig()
        .withSerializers(new UserProfileSerializer());

Jsonb jsonb = JsonbBuilder.create(config);
```

Kapan serializer lebih baik dari DTO manual?

Jawaban tegas: **tidak selalu**.

Jika output contract adalah API publik, DTO eksplisit sering lebih mudah dibaca, diuji, dan dijaga:

```java
public record UserProfileResponse(
        String id,
        String displayName,
        Contact contact
) {
    public record Contact(String email, boolean verified) {}
}
```

Serializer cocok saat:

- class tidak bisa diubah;
- type berasal dari library;
- representasi output harus reusable;
- output sangat computed;
- kamu butuh low-level generator control.

DTO eksplisit lebih cocok saat:

- contract penting dan butuh stabilitas;
- banyak developer harus membaca mapping;
- versioning API jelas;
- mapping perlu divalidasi sebagai business boundary.

---

## 13. Serializer Jangan Mengandung Business Workflow

Serializer boleh melakukan transformasi representasi, bukan menjalankan workflow.

Buruk:

```java
public void serialize(Order order, JsonGenerator generator, SerializationContext ctx) {
    if (order.isExpired()) {
        order.cancel(); // side effect!
    }
    generator.writeStartObject();
    // ...
}
```

Masalah:

- serialization menjadi tidak idempotent;
- logging object bisa mengubah state;
- test sulit;
- output tergantung side effect;
- audit rusak.

Prinsip:

```text
Serialization must be a pure representation function.
```

Boleh:

```java
String displayName = user.getFirstName() + " " + user.getLastName();
```

Tidak boleh:

```java
user.markAsExported();
repository.save(user);
callExternalService();
```

---

## 14. Serializer dan `SerializationContext`

`SerializationContext` dipakai untuk menyerahkan serialization sebagian object kembali ke JSON-B.

Contoh:

```java
public final class OrderSerializer implements JsonbSerializer<Order> {

    @Override
    public void serialize(Order order,
                          JsonGenerator generator,
                          SerializationContext ctx) {
        generator.writeStartObject();
        generator.write("orderNo", order.getOrderNo());

        generator.writeKey("customer");
        ctx.serialize(order.getCustomer(), generator);

        generator.writeKey("items");
        ctx.serialize(order.getItems(), generator);

        generator.writeEnd();
    }
}
```

Ini berguna ketika:

- sebagian field custom;
- sebagian field tetap ingin mengikuti mapping JSON-B;
- adapter/serializer nested tetap dihormati.

Namun hati-hati recursive loop.

Contoh berbahaya:

```java
ctx.serialize(order, generator); // inside OrderSerializer itself
```

Ini bisa memicu recursion tak berujung.

Rule:

```text
Inside serializer for T, do not delegate T itself back to context unless you know provider recursion behavior exactly.
```

---

## 15. `JsonbDeserializer`: Saat Input JSON Tidak Bisa Diwakili Mapping Default

`JsonbDeserializer<T>` memberi kontrol terhadap deserialization.

Gunakan ketika:

- input legacy punya multiple shapes;
- field tersebar/flattened;
- kamu perlu discriminated union;
- kamu perlu defaulting kompleks;
- input perlu normalisasi sebelum object dibuat;
- kamu ingin membaca token JSON secara manual.

Contoh legacy payload:

Versi lama:

```json
{
  "customerId": "C-1",
  "customerName": "Alice Tan"
}
```

Versi baru:

```json
{
  "customer": {
    "id": "C-1",
    "name": "Alice Tan"
  }
}
```

Kamu ingin menerima keduanya sementara.

Model:

```java
public record CustomerRef(String id, String name) {}
```

Deserializer konseptual:

```java
public final class CustomerRefDeserializer implements JsonbDeserializer<CustomerRef> {

    @Override
    public CustomerRef deserialize(JsonParser parser,
                                   DeserializationContext ctx,
                                   Type rtType) {
        String id = null;
        String name = null;

        JsonParser.Event event = parser.next();
        if (event != JsonParser.Event.START_OBJECT) {
            throw new JsonbException("Expected object for CustomerRef");
        }

        while (parser.hasNext()) {
            event = parser.next();

            if (event == JsonParser.Event.KEY_NAME) {
                String key = parser.getString();

                if ("customerId".equals(key)) {
                    parser.next();
                    id = parser.getString();
                } else if ("customerName".equals(key)) {
                    parser.next();
                    name = parser.getString();
                } else if ("customer".equals(key)) {
                    CustomerNested nested = ctx.deserialize(CustomerNested.class, parser);
                    id = nested.id;
                    name = nested.name;
                } else {
                    skipValue(parser);
                }
            } else if (event == JsonParser.Event.END_OBJECT) {
                break;
            }
        }

        if (id == null || name == null) {
            throw new JsonbException("Customer id and name are required");
        }

        return new CustomerRef(id, name);
    }

    public static class CustomerNested {
        public String id;
        public String name;
    }

    private void skipValue(JsonParser parser) {
        // Simplified. Production version must handle nested object/array depth.
        JsonParser.Event event = parser.next();
        if (event == JsonParser.Event.START_OBJECT || event == JsonParser.Event.START_ARRAY) {
            int depth = 1;
            while (depth > 0 && parser.hasNext()) {
                JsonParser.Event e = parser.next();
                if (e == JsonParser.Event.START_OBJECT || e == JsonParser.Event.START_ARRAY) depth++;
                if (e == JsonParser.Event.END_OBJECT || e == JsonParser.Event.END_ARRAY) depth--;
            }
        }
    }
}
```

Catatan: API deserializer low-level bisa berbeda detail antar versi API/provider, jadi selalu cek signature API yang dipakai di dependency proyekmu. Prinsip desainnya tetap sama: parser/token masuk, kamu membangun object target secara eksplisit.

---

## 16. Deserializer dan Unknown Fields: Must-Ignore vs Strict Boundary

Salah satu behavior penting JSON-B: unknown properties pada input umumnya diabaikan. Ini sering disebut must-ignore/lenient behavior.

Contoh DTO:

```java
public class RegisterUserRequest {
    public String username;
    public String email;
}
```

Payload:

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "role": "ADMIN"
}
```

Jika `role` tidak dikenal oleh DTO, JSON-B dapat mengabaikannya.

Ini berguna untuk forward compatibility:

- client baru menambahkan field;
- server lama tidak langsung gagal;
- evolusi additive lebih mudah.

Namun ini berbahaya untuk boundary tertentu:

- user mengirim `role=ADMIN` dan sistem diam-diam ignore;
- client mengira update berhasil padahal field tidak diproses;
- bug typo tidak terdeteksi (`emali` bukan `email`);
- kontrak strict regulatory/audit tidak terpenuhi;
- over-posting attempt tidak tercatat.

Mental model:

```text
Lenient parsing is compatibility-friendly but security/audit-hostile unless bounded.
```

Solusi untuk strict boundary:

1. Parse dengan JSON-P sebagai `JsonObject`.
2. Check key allowlist.
3. Baru bind dengan JSON-B.

Contoh:

```java
public final class StrictJsonReader {
    private final Jsonb jsonb;

    public StrictJsonReader(Jsonb jsonb) {
        this.jsonb = jsonb;
    }

    public <T> T readStrict(String json,
                            Class<T> type,
                            Set<String> allowedKeys) {
        JsonObject object;
        try (JsonReader reader = Json.createReader(new StringReader(json))) {
            object = reader.readObject();
        }

        Set<String> unknown = new LinkedHashSet<>(object.keySet());
        unknown.removeAll(allowedKeys);

        if (!unknown.isEmpty()) {
            throw new BadRequestException("Unknown JSON fields: " + unknown);
        }

        return jsonb.fromJson(json, type);
    }
}
```

Usage:

```java
Set<String> allowed = Set.of("username", "email");
RegisterUserRequest req = strictJsonReader.readStrict(
        body,
        RegisterUserRequest.class,
        allowed
);
```

Java 8:

```java
Set<String> allowed = new LinkedHashSet<>(Arrays.asList("username", "email"));
```

Untuk nested object, allowlist harus path-aware:

```text
username
email
address.line1
address.postalCode
```

Atau gunakan JSON Schema validation layer sebelum JSON-B.

---

## 17. Strictness Tidak Sama Untuk Semua Boundary

Jangan membuat semua endpoint strict secara buta.

Gunakan matrix:

| Boundary | Unknown Field Policy | Reason |
|---|---|---|
| Public API create/update | Reject atau log + reject | Security, typo detection, contract clarity |
| Public API read response | N/A | Server controls output |
| Internal async event | Tolerate additive fields | Forward compatibility |
| Regulatory submission | Reject unknown fields | Defensibility |
| Legacy partner input | Tolerate with audit | Partner drift handling |
| Webhook receiver | Usually tolerate + preserve raw | Provider may add fields |
| Admin bulk import | Reject with row-level error | Data quality |
| Audit replay payload | Preserve exact raw | Reconstruction |

Top engineer tidak dogmatis. Ia menyesuaikan strictness dengan risiko kontrak.

---

## 18. Provider Discovery dan Dependency Reality

`JsonbBuilder.create()` memilih provider default. Dalam standalone app, provider ditemukan dari classpath/module path. Dalam Jakarta EE container, provider bisa disediakan container.

Risiko nyata:

1. **No provider found**

Kamu hanya menambahkan API:

```xml
<dependency>
    <groupId>jakarta.json.bind</groupId>
    <artifactId>jakarta.json.bind-api</artifactId>
    <version>3.0.1</version>
</dependency>
```

Tetapi tidak ada implementation.

Akibat:

```text
JsonbException: JSON Binding provider org.eclipse.yasson.JsonBindingProvider not found
```

Tambahkan provider seperti Yasson dan JSON-P implementation.

Contoh Maven Jakarta namespace:

```xml
<dependencies>
    <dependency>
        <groupId>jakarta.json.bind</groupId>
        <artifactId>jakarta.json.bind-api</artifactId>
        <version>3.0.1</version>
    </dependency>

    <dependency>
        <groupId>org.eclipse</groupId>
        <artifactId>yasson</artifactId>
        <version>3.0.4</version>
    </dependency>

    <dependency>
        <groupId>org.eclipse.parsson</groupId>
        <artifactId>parsson</artifactId>
        <version>1.1.7</version>
    </dependency>
</dependencies>
```

Versi di atas contoh; dalam proyek production, pin sesuai compatibility matrix proyek/container.

2. **Javax vs Jakarta mismatch**

Java EE era:

```java
import javax.json.bind.Jsonb;
```

Jakarta era:

```java
import jakarta.json.bind.Jsonb;
```

Mereka bukan package yang sama.

Masalah umum saat migrasi:

- code memakai `javax.json.bind.*`;
- dependency baru memakai `jakarta.json.bind.*`;
- container menyediakan Jakarta EE 10;
- library lama masih compile terhadap Javax;
- runtime classpath berisi campuran API yang tidak kompatibel.

Prinsip:

```text
Do not mix javax JSON-B API and jakarta JSON-B API in the same binding boundary.
```

3. **Container-provided provider conflict**

Di application server, kamu mungkin tidak perlu membawa Yasson sendiri. Jika kamu tetap membundel provider, bisa terjadi:

- duplicate provider;
- classloader conflict;
- version mismatch;
- berbeda behavior antara local test dan server;
- error saat deployment.

Best practice:

- cek apakah runtime/container menyediakan JSON-B;
- untuk WAR di Jakarta EE server, gunakan `provided` jika sesuai;
- untuk fat JAR/microservice, bawa implementation sendiri;
- dokumentasikan provider version sebagai bagian dari runtime contract.

---

## 19. JSON-B Config: Global Behavior Dengan Dampak Besar

`JsonbConfig` mengatur behavior global.

Contoh:

```java
JsonbConfig config = new JsonbConfig()
        .withFormatting(false)
        .withNullValues(false)
        .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES)
        .withDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT);

Jsonb jsonb = JsonbBuilder.create(config);
```

Poin penting:

- config global mempengaruhi semua type yang lewat instance `Jsonb` tersebut;
- satu aplikasi bisa butuh beberapa `Jsonb` instance untuk boundary berbeda;
- jangan pakai satu global config jika public API, partner legacy, dan internal event punya contract berbeda.

Contoh:

```java
@ApplicationScoped
public class JsonCodecs {
    private Jsonb publicApiJsonb;
    private Jsonb legacyPartnerJsonb;
    private Jsonb internalEventJsonb;

    @PostConstruct
    void init() {
        publicApiJsonb = JsonbBuilder.create(new JsonbConfig()
                .withNullValues(false)
                .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES));

        legacyPartnerJsonb = JsonbBuilder.create(new JsonbConfig()
                .withNullValues(true));

        internalEventJsonb = JsonbBuilder.create(new JsonbConfig()
                .withNullValues(false));
    }
}
```

Mental model:

```text
A Jsonb instance is a contract profile.
```

Jangan melihatnya hanya sebagai utility global.

---

## 20. Multiple Contract Profiles

Dalam enterprise system, satu object bisa keluar ke beberapa boundary:

```text
Internal Domain Object
       |
       +--> Public API JSON
       +--> Partner Legacy JSON
       +--> Internal Event JSON
       +--> Audit Snapshot JSON
       +--> Admin Export JSON
```

Masing-masing punya aturan berbeda.

| Boundary | Field Naming | Null Policy | Unknown Input | Date Format | Security |
|---|---|---|---|---|---|
| Public API | snake_case | omit null | reject | ISO offset | hide internal |
| Legacy partner | partner-defined | include null | tolerate/log | custom | map codes |
| Internal event | camelCase/snake_case | omit null | tolerate | ISO instant | versioned |
| Audit snapshot | deterministic | include explicit null | N/A | canonical | immutable raw |
| Admin export | readable | include null | N/A | localized? | role-filtered |

Kalau semua boundary memakai DTO dan JsonbConfig yang sama, contract akan bercampur.

Desain lebih aman:

```text
Domain Object
  -> Mapper
     -> PublicApiDto -> publicApiJsonb
     -> PartnerDto   -> partnerJsonb
     -> EventDto     -> eventJsonb
     -> AuditDto     -> auditJsonb
```

---

## 21. Property Visibility Strategy: Jangan Semua Field Otomatis Terbuka

JSON-B dapat bind field/property berdasarkan access rules. Kamu bisa mengatur visibility strategy.

Masalah default/introspection:

```java
public class Account {
    public String id;
    public String username;
    public String passwordHash;
    public String internalRiskScore;
}
```

Jika object ini tidak sengaja diserialize:

```json
{
  "id": "A-1",
  "username": "alice",
  "passwordHash": "...",
  "internalRiskScore": "HIGH"
}
```

Ini bukan sekadar bug mapping. Ini data leakage.

Solusi terbaik: jangan serialize domain/entity langsung. Gunakan DTO.

Jika tetap perlu visibility strategy:

```java
public final class ExplicitJsonbVisibilityStrategy implements PropertyVisibilityStrategy {

    @Override
    public boolean isVisible(Field field) {
        return field.isAnnotationPresent(JsonbProperty.class);
    }

    @Override
    public boolean isVisible(Method method) {
        return method.isAnnotationPresent(JsonbProperty.class);
    }
}
```

Config:

```java
JsonbConfig config = new JsonbConfig()
        .withPropertyVisibilityStrategy(new ExplicitJsonbVisibilityStrategy());
```

Dengan pola ini, hanya field/method yang diberi `@JsonbProperty` yang keluar/masuk.

Contoh DTO:

```java
public class AccountResponse {
    @JsonbProperty("id")
    public String id;

    @JsonbProperty("username")
    public String username;

    public String passwordHash; // ignored by custom visibility strategy
}
```

Namun hati-hati: ini global untuk `Jsonb` instance tersebut. Jangan campur dengan DTO yang tidak dirancang untuk explicit annotation.

---

## 22. Naming Strategy: Convenience vs Contract Drift

Config naming strategy:

```java
JsonbConfig config = new JsonbConfig()
        .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES);
```

Java:

```java
public class UserDto {
    public String firstName;
    public String lastName;
}
```

JSON:

```json
{
  "first_name": "Alice",
  "last_name": "Tan"
}
```

Ini nyaman. Tetapi ada risiko:

- rename Java field mengubah JSON field;
- acronym mapping bisa berbeda dari ekspektasi;
- provider behavior bisa punya nuance;
- generated docs/schema bisa drift;
- field dengan nama khusus butuh override.

Contoh problematic:

```java
public String URLValue;
public String userID;
public String eKycStatus;
```

Output naming strategy bisa tidak sesuai contract yang diinginkan.

Untuk public API penting, explicit annotation sering lebih defensible:

```java
@JsonbProperty("url_value")
public String urlValue;

@JsonbProperty("user_id")
public String userId;

@JsonbProperty("e_kyc_status")
public String eKycStatus;
```

Rule:

```text
Naming strategy is good for internal/event consistency.
Explicit property names are safer for external contracts.
```

---

## 23. Null Handling: Bukan Sekadar Include/Omit

`withNullValues(true/false)` tampak sederhana, tetapi null semantics sangat penting.

Ada tiga keadaan berbeda:

```text
Field absent      -> client did not send it / server omits it
Field null        -> client explicitly sets it null
Field with value  -> client provides value
```

Dalam update/PATCH, ini kritis.

Payload A:

```json
{
  "displayName": "Alice"
}
```

Payload B:

```json
{
  "displayName": null
}
```

A bisa berarti “update displayName only”.  
B bisa berarti “clear displayName”.

Jika JSON-B langsung bind ke:

```java
public class UpdateProfileRequest {
    public String displayName;
    public String phone;
}
```

Kamu tidak bisa membedakan:

- `phone` absent;
- `phone` explicitly null.

Keduanya menjadi `null`.

Untuk PATCH semantics, jangan hanya mengandalkan JSON-B POJO default.

Solusi:

1. Gunakan JSON-P untuk detect presence.
2. Gunakan wrapper field state.
3. Gunakan DTO khusus patch.

Contoh wrapper:

```java
public sealed interface FieldPatch<T> permits FieldPatch.Absent, FieldPatch.NullValue, FieldPatch.Value {
    record Absent<T>() implements FieldPatch<T> {}
    record NullValue<T>() implements FieldPatch<T> {}
    record Value<T>(T value) implements FieldPatch<T> {}
}
```

Java 8 compatible bisa gunakan class biasa.

Patch parser dengan JSON-P:

```java
public UpdateProfilePatch parsePatch(String json) {
    JsonObject obj;
    try (JsonReader reader = Json.createReader(new StringReader(json))) {
        obj = reader.readObject();
    }

    FieldPatch<String> phone;
    if (!obj.containsKey("phone")) {
        phone = new FieldPatch.Absent<>();
    } else if (obj.isNull("phone")) {
        phone = new FieldPatch.NullValue<>();
    } else {
        phone = new FieldPatch.Value<>(obj.getString("phone"));
    }

    return new UpdateProfilePatch(phone);
}
```

Prinsip:

```text
JSON-B object binding is not enough when field presence itself has business meaning.
```

---

## 24. Date/Time Provider Behavior: Jangan Mengandalkan Default

Tanggal dan waktu adalah sumber bug integrasi klasik.

Masalah:

- default format bisa berbeda antar provider/version;
- timezone bisa hilang;
- `LocalDateTime` tidak punya timezone;
- `Date` membawa instant tetapi sering diformat di timezone default JVM;
- partner legacy bisa memakai format non-ISO;
- daylight saving bisa mengubah hasil jika timezone tidak eksplisit.

Gunakan format eksplisit.

Untuk instant:

```java
public class EventDto {
    @JsonbDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX")
    public Instant occurredAt;
}
```

Untuk date-only:

```java
public class PersonDto {
    @JsonbDateFormat("yyyy-MM-dd")
    public LocalDate birthDate;
}
```

Untuk Jakarta/Java 8 compatibility:

- Java 8 sudah punya `java.time`;
- JSON-B provider support untuk java.time tergantung versi;
- selalu test provider yang dipakai;
- hindari `java.util.Date` untuk contract baru kecuali legacy boundary.

Prinsip:

```text
External JSON timestamp must encode whether it is an instant, local date, local date-time, or business date.
```

Jangan mencampur:

| Java Type | Meaning | Good JSON Example |
|---|---|---|
| `Instant` | point in time | `2026-06-17T10:15:30Z` |
| `OffsetDateTime` | date-time with offset | `2026-06-17T18:15:30+08:00` |
| `LocalDate` | date without time | `2026-06-17` |
| `LocalDateTime` | local wall-clock time | `2026-06-17T18:15:30` |
| `YearMonth` | month period | `2026-06` |

---

## 25. Provider-Specific Features: Boleh, Tapi Isolasi

Yasson sebagai reference implementation/provider bisa punya extension behavior di luar spec. Provider lain bisa berbeda.

Gunakan provider-specific feature hanya jika:

- behavior tidak bisa dicapai oleh standard JSON-B;
- risiko lock-in diterima;
- provider version dipin;
- ada test yang mendeteksi behavior;
- abstraction boundary jelas.

Contoh anti-pattern:

```java
// seluruh aplikasi tersebar menggunakan property string provider-specific
new JsonbConfig().setProperty("yasson.some.internal.feature", true);
```

Lebih baik:

```java
public final class PublicApiJsonbFactory {
    public static Jsonb create() {
        JsonbConfig config = new JsonbConfig()
                .withNullValues(false)
                .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES);

        // provider-specific config isolated here if really needed
        return JsonbBuilder.create(config);
    }
}
```

Dan test:

```java
class PublicApiJsonbFactoryTest {
    @Test
    void serializesContractAsExpected() {
        Jsonb jsonb = PublicApiJsonbFactory.create();
        String json = jsonb.toJson(new UserResponse("U-1", "Alice"));
        assertEquals("{\"id\":\"U-1\",\"name\":\"Alice\"}", json);
    }
}
```

Prinsip:

```text
Provider-specific behavior is infrastructure detail, not application-wide knowledge.
```

---

## 26. Polymorphism: Powerful, Dangerous, Often Overused

JSON-B 3.0 menambahkan dukungan handling polymorphic types. Ini berguna, tetapi harus hati-hati.

Polymorphism problem:

```java
public interface PaymentMethod {}

public class CardPayment implements PaymentMethod {
    public String cardToken;
}

public class BankTransferPayment implements PaymentMethod {
    public String bankCode;
    public String accountNo;
}
```

JSON butuh discriminator:

```json
{
  "type": "CARD",
  "cardToken": "tok_123"
}
```

Atau:

```json
{
  "type": "BANK_TRANSFER",
  "bankCode": "DBS",
  "accountNo": "..."
}
```

Bahaya jika polymorphism memakai class name arbitrary:

```json
{
  "@class": "com.company.internal.AdminCommand",
  "...": "..."
}
```

Ini membuka risiko security dan coupling internal.

Prinsip aman:

1. Gunakan discriminator eksternal stabil, bukan Java class name.
2. Allowlist subtype eksplisit.
3. Jangan deserialize arbitrary type dari client.
4. Validasi field per subtype.
5. Pertimbangkan deserializer manual untuk boundary sensitif.

Contoh manual safer:

```java
public PaymentMethod parsePayment(JsonObject obj) {
    String type = obj.getString("type", null);

    if ("CARD".equals(type)) {
        return new CardPayment(obj.getString("cardToken"));
    }

    if ("BANK_TRANSFER".equals(type)) {
        return new BankTransferPayment(
                obj.getString("bankCode"),
                obj.getString("accountNo")
        );
    }

    throw new BadRequestException("Unknown payment type");
}
```

Top engineer tidak terpesona dengan polymorphic auto-magic. Ia menilai boundary risk.

---

## 27. Generic Types dan Type Erasure

Untuk deserialization generic collection, jangan hanya gunakan raw class.

Buruk:

```java
List<OrderDto> orders = jsonb.fromJson(json, List.class);
```

Hasilnya bisa menjadi list map/object provider-specific, bukan `OrderDto`.

Gunakan `ParameterizedType`.

```java
public final class Types {
    public static ParameterizedType listOf(Class<?> elementType) {
        return new ParameterizedType() {
            @Override
            public Type[] getActualTypeArguments() {
                return new Type[] { elementType };
            }

            @Override
            public Type getRawType() {
                return List.class;
            }

            @Override
            public Type getOwnerType() {
                return null;
            }
        };
    }
}
```

Usage:

```java
Type orderListType = Types.listOf(OrderDto.class);
List<OrderDto> orders = jsonb.fromJson(json, orderListType);
```

Untuk nested generic, buat type helper yang jelas dan diuji.

Prinsip:

```text
If the target type contains generics, Class<T> is usually not enough.
```

---

## 28. Records, Constructors, dan Immutability

Java records sangat cocok untuk DTO immutable:

```java
public record CreateUserRequest(
        String username,
        String email
) {}
```

Namun compatibility tergantung:

- Java version;
- JSON-B version;
- provider support;
- constructor binding support;
- parameter name availability.

Untuk Java 8, record tidak tersedia. Gunakan immutable class dengan constructor.

```java
public final class CreateUserRequest {
    private final String username;
    private final String email;

    @JsonbCreator
    public CreateUserRequest(
            @JsonbProperty("username") String username,
            @JsonbProperty("email") String email) {
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

Untuk Java 16+ records:

```java
public record CreateUserRequest(
        @JsonbProperty("username") String username,
        @JsonbProperty("email") String email
) {}
```

Prinsip:

```text
Immutable DTOs reduce accidental mutation, but require explicit construction semantics.
```

Test record/constructor binding di provider yang sama dengan production.

---

## 29. Performance: Reflection, Metadata, Allocation, dan Streaming Boundary

JSON-B binding nyaman, tetapi bukan selalu paling efisien.

Biaya umum:

- reflection/introspection;
- metadata construction;
- object allocation;
- intermediate strings;
- nested object graph creation;
- adapter calls;
- exception stack trace cost;
- full materialization sebelum processing.

Optimization order yang sehat:

1. Gunakan long-lived `Jsonb` instance.
2. Hindari domain/entity graph besar; gunakan DTO ringkas.
3. Hindari custom serializer/deserializer yang membuat banyak temporary object.
4. Untuk payload besar, pertimbangkan JSON-P streaming extraction.
5. Benchmark boundary nyata, bukan microbenchmark palsu.
6. Ukur memory dan GC, bukan hanya latency.

Contoh kasus:

Payload 500 MB array transaksi:

```json
[
  { "id": "1", "amount": "10.00" },
  { "id": "2", "amount": "20.00" }
]
```

Jangan langsung:

```java
List<TransactionDto> all = jsonb.fromJson(json, transactionListType);
```

Jika hanya perlu aggregate, pakai JSON-P streaming:

```text
InputStream -> JsonParser -> per item extraction -> process -> discard
```

JSON-B cocok untuk object boundary ukuran normal. JSON-P streaming cocok untuk huge payload, ETL, import/export, dan partial read.

---

## 30. Security Failure Patterns

### 30.1 Over-posting

Payload:

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "role": "ADMIN"
}
```

Jika DTO/domain punya `role` field dan langsung bind:

```java
public class User {
    public String username;
    public String email;
    public String role;
}
```

Client bisa mengisi field yang seharusnya server-controlled.

Solusi:

- dedicated request DTO;
- allowlist field;
- strict unknown field policy;
- server-controlled field tidak ada di request DTO.

### 30.2 Data Leakage

Serialize entity/domain langsung:

```java
return jsonb.toJson(userEntity);
```

Bocor:

- password hash;
- internal status;
- risk score;
- audit metadata;
- tenant id;
- soft delete flag;
- internal notes.

Solusi:

- response DTO eksplisit;
- `@JsonbTransient` sebagai backup, bukan proteksi utama;
- API contract test.

### 30.3 Silent Unknown Field

Typo:

```json
{
  "emali": "alice@example.com"
}
```

DTO:

```java
public String email;
```

Jika unknown ignored, email menjadi null. Error validasi mungkin berkata “email required”, tetapi tidak memberi tahu typo. Untuk admin/import, lebih baik reject unknown.

### 30.4 Polymorphic Injection

Jangan biarkan client memilih Java class arbitrary. Gunakan discriminator allowlist.

### 30.5 Log Injection

Jangan log raw payload tanpa sanitization/truncation:

```java
log.warn("Invalid payload: {}", body);
```

Payload bisa berisi newline, escape sequence, secret, atau PII.

Lebih baik:

```java
log.warn("Invalid payload. correlationId={}, errorCode={}, size={}",
        correlationId,
        "INVALID_JSON",
        body.length());
```

Simpan raw payload hanya jika diperlukan dan protected sesuai policy.

---

## 31. Validation Boundary: JSON-B Bukan Validator Lengkap

JSON-B mengubah JSON menjadi object. Ia bukan pengganti validation.

Pipeline sehat:

```text
Raw JSON
  -> size limit
  -> content-type check
  -> JSON syntax parse
  -> unknown field policy / schema validation
  -> JSON-B binding
  -> bean/domain validation
  -> authorization/business rules
  -> command execution
```

Jangan melakukan:

```text
Raw JSON -> JSON-B bind directly into entity -> save
```

Contoh boundary parser:

```java
public final class RequestBodyParser {
    private final Jsonb jsonb;
    private final Validator validator;

    public <T> T parse(String body, Class<T> type) {
        if (body == null || body.length() > 1_000_000) {
            throw new BadRequestException("Invalid body size");
        }

        try {
            T value = jsonb.fromJson(body, type);
            Set<ConstraintViolation<T>> violations = validator.validate(value);
            if (!violations.isEmpty()) {
                throw new BadRequestException("Validation failed");
            }
            return value;
        } catch (JsonbException e) {
            throw new BadRequestException("Malformed JSON payload", e);
        }
    }
}
```

Validation harus tetap eksplisit.

---

## 32. Error Taxonomy Untuk JSON-B Boundary

Buat taxonomy error agar API behavior stabil.

| Failure | Example | HTTP-ish Mapping | Internal Handling |
|---|---|---|---|
| Body too large | 20 MB body | 413 | reject before parse |
| Malformed JSON | `{` | 400 | syntax error |
| Wrong type | string expected but object | 400 | binding error |
| Unknown field | `role` not allowed | 400 | strict allowlist |
| Missing required | no `email` | 400 | validation error |
| Invalid value | bad enum code | 400 | adapter/domain error |
| Unauthorized field | tries server-owned field | 403/400 | security event maybe |
| Internal serializer bug | NPE in serializer | 500 | alert |
| Provider misconfig | no provider | 500 startup fail | fail fast |

Jangan semua `JsonbException` menjadi 500.

Input-caused JSON-B exception biasanya 400. Runtime/provider misconfiguration sebaiknya fail saat startup.

---

## 33. Testing Matrix Untuk Custom JSON-B Mapping

Custom mapping tanpa test adalah contract risk.

Minimal test:

### 33.1 Round-trip Test

```java
@Test
void customerIdRoundTrip() {
    Jsonb jsonb = JsonbBuilder.create();
    CustomerDto dto = new CustomerDto();
    dto.id = new CustomerId("C-1");
    dto.name = "Alice";

    String json = jsonb.toJson(dto);
    CustomerDto parsed = jsonb.fromJson(json, CustomerDto.class);

    assertEquals("C-1", parsed.id.value());
}
```

Round-trip saja tidak cukup, karena bisa tetap salah tapi konsisten.

### 33.2 Golden JSON Test

```java
@Test
void serializesToPublicContract() {
    CustomerDto dto = new CustomerDto();
    dto.id = new CustomerId("C-1");
    dto.name = "Alice";

    String json = jsonb.toJson(dto);

    assertEquals("{\"id\":\"C-1\",\"name\":\"Alice\"}", json);
}
```

Untuk field order yang tidak dijamin, parse ke JSON-P object lalu assert struktur.

### 33.3 Negative Input Test

```java
@Test
void rejectsInvalidStatusCode() {
    String json = "{\"status\":\"UNKNOWN\"}";

    assertThrows(JsonbException.class, () ->
            jsonb.fromJson(json, CaseDto.class)
    );
}
```

### 33.4 Unknown Field Test

```java
@Test
void strictReaderRejectsUnknownField() {
    String json = "{\"username\":\"alice\",\"role\":\"ADMIN\"}";

    assertThrows(BadRequestException.class, () ->
            strictReader.readStrict(json, RegisterUserRequest.class, Set.of("username", "email"))
    );
}
```

### 33.5 Null/Absent Test

```java
@Test
void distinguishesAbsentAndExplicitNull() {
    UpdateProfilePatch absent = parser.parsePatch("{}");
    UpdateProfilePatch explicitNull = parser.parsePatch("{\"phone\":null}");

    assertTrue(absent.phone() instanceof FieldPatch.Absent);
    assertTrue(explicitNull.phone() instanceof FieldPatch.NullValue);
}
```

### 33.6 Provider Upgrade Test

Golden tests harus dijalankan ketika upgrade:

- JSON-B API;
- Yasson/provider;
- JSON-P provider;
- Jakarta EE container;
- Java version;
- build plugin;
- module path/classpath mode.

---

## 34. Java 8–25 Compatibility Notes

### 34.1 Java 8

- Java 8 banyak enterprise app masih memakai `javax.*` ecosystem.
- JSON-B 1.x berada di era Java EE/Jakarta awal.
- Records/sealed classes/switch expression belum tersedia.
- Gunakan POJO, constructor explicit, JavaBean getter/setter.
- Hati-hati dependency lama.

### 34.2 Java 11+

- Banyak Java EE module dihapus dari JDK sejak Java 11, sehingga JAXB/JAX-WS/SAAJ perlu dependency eksplisit. Untuk JSON-B, dependency juga biasanya eksplisit di standalone app.
- Migrasi dari Java 8 sering sekaligus membuka masalah classpath.

### 34.3 Java 17

- Banyak Jakarta EE modern runtime nyaman di Java 17.
- Records tersedia dan sering cocok untuk DTO.
- Namun provider support harus diuji.

### 34.4 Java 21

- LTS modern, cocok untuk service baru.
- Records, sealed classes, pattern matching membantu model DTO/contract lebih ekspresif.
- Jangan membuat mapping terlalu magic hanya karena language feature tersedia.

### 34.5 Java 25

- Untuk Java 25, prinsipnya sama: JSON-B adalah library/spec ecosystem, bukan fitur JDK core.
- Pastikan provider/container compatibility dengan runtime Java yang dipakai.
- Contract tests lebih penting daripada asumsi “karena compile maka aman”.

---

## 35. Provider Internals: Apa yang Perlu Kamu Tahu, Tanpa Menjadi Maintainer

Kamu tidak perlu tahu seluruh source code provider. Tetapi kamu perlu mental model cukup untuk debug production.

Saat `jsonb.toJson(obj)` dipanggil, provider kira-kira melakukan:

```text
1. Resolve runtime type
2. Lookup serialization model/cache
3. Inspect annotations/config/visibility
4. Resolve custom serializer/adapter if any
5. Traverse object graph
6. Delegate nested values
7. Use JSON-P generator
8. Write JSON output
```

Saat `jsonb.fromJson(json, Type)`:

```text
1. Create JSON parser from input
2. Resolve target type
3. Lookup deserialization model/cache
4. Match JSON properties to Java properties
5. Apply adapters/deserializers
6. Instantiate object
7. Set fields/properties/constructor args
8. Handle unknown/missing/null according to rules
9. Return object or throw JsonbException
```

Bug debug checklist:

| Symptom | Possible Cause |
|---|---|
| Field missing in output | visibility, null omit, transient, no getter, wrong config |
| Field not populated | name mismatch, no setter/constructor, unknown ignored, adapter issue |
| Date shifted | timezone/default format/type mismatch |
| Enum fails | unknown code, default enum name mismatch |
| Provider not found | missing implementation dependency |
| Works local not server | container provider/classloader conflict |
| Stack overflow | recursive serializer/object graph cycle |
| Huge memory | full object binding for large payload |
| Slow first request | lazy metadata introspection |
| Different output after upgrade | provider behavior/config/default changed |

---

## 36. Object Graph Cycles

JSON is tree-shaped. Java object graphs can be cyclic.

Example:

```java
public class Parent {
    public String name;
    public List<Child> children;
}

public class Child {
    public String name;
    public Parent parent;
}
```

Serializing `Parent` can recurse:

```text
Parent -> children[0] -> parent -> children[0] -> parent -> ...
```

JPA entities commonly have this problem.

Do not serialize entity graph directly.

Use DTO:

```java
public class ParentResponse {
    public String name;
    public List<ChildSummary> children;
}

public class ChildSummary {
    public String name;
}
```

Or break cycle:

```java
public class ChildDto {
    public String name;

    @JsonbTransient
    public ParentDto parent;
}
```

But `@JsonbTransient` is a patch. DTO projection is cleaner.

---

## 37. Adapter/Serializer Thread-Safety

Assume custom components may be reused.

Bad:

```java
public final class BadDateAdapter implements JsonbAdapter<LocalDate, String> {
    private final SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd");

    @Override
    public String adaptToJson(LocalDate obj) {
        return format.format(Date.from(obj.atStartOfDay(ZoneId.systemDefault()).toInstant()));
    }
}
```

`SimpleDateFormat` is mutable and not thread-safe.

Better:

```java
public final class LocalDateAdapter implements JsonbAdapter<LocalDate, String> {
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE;

    @Override
    public String adaptToJson(LocalDate obj) {
        return obj == null ? null : FORMATTER.format(obj);
    }

    @Override
    public LocalDate adaptFromJson(String obj) {
        return obj == null ? null : LocalDate.parse(obj, FORMATTER);
    }
}
```

Avoid:

- mutable fields;
- request-specific state;
- storing last parsed value;
- non-thread-safe formatter;
- lazy initialization without synchronization;
- calling external services from adapter.

Safe:

- immutable config;
- static final thread-safe formatter;
- pure conversion;
- local variables only;
- deterministic exceptions.

---

## 38. Boundary Design Pattern: Codec Per Use Case

Daripada menyebar `Jsonb` langsung di seluruh codebase, buat codec boundary.

```java
public interface JsonCodec {
    <T> T decode(String json, Class<T> type);
    String encode(Object value);
}
```

Implementasi:

```java
public final class JsonbJsonCodec implements JsonCodec, AutoCloseable {
    private final Jsonb jsonb;

    public JsonbJsonCodec(Jsonb jsonb) {
        this.jsonb = jsonb;
    }

    @Override
    public <T> T decode(String json, Class<T> type) {
        try {
            return jsonb.fromJson(json, type);
        } catch (JsonbException e) {
            throw new PayloadBindingException("Invalid JSON payload", e);
        }
    }

    @Override
    public String encode(Object value) {
        try {
            return jsonb.toJson(value);
        } catch (JsonbException e) {
            throw new PayloadBindingException("Unable to serialize JSON payload", e);
        }
    }

    @Override
    public void close() throws Exception {
        jsonb.close();
    }
}
```

Per boundary:

```java
public final class PublicApiJsonCodec extends JsonbJsonCodec {
    public PublicApiJsonCodec() {
        super(JsonbBuilder.create(new JsonbConfig()
                .withNullValues(false)
                .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES)));
    }
}
```

Atau composition, bukan inheritance.

Manfaat:

- error handling konsisten;
- config terpusat;
- provider-specific behavior terisolasi;
- testing lebih mudah;
- migration JSON-B ↔ Jackson mungkin lebih terkendali;
- boundary intent jelas.

---

## 39. Anti-Patterns

### 39.1 Global Static Jsonb Tanpa Lifecycle

```java
public final class Jsons {
    public static final Jsonb JSONB = JsonbBuilder.create();
}
```

Masalah:

- tidak ditutup;
- tidak configurable;
- sulit test;
- satu config untuk semua boundary;
- classloader leak risk di app server/redeploy.

### 39.2 Entity as API DTO

```java
return jsonb.toJson(userEntity);
```

Masalah:

- lazy loading;
- cycles;
- data leakage;
- internal schema bocor;
- breaking change saat entity berubah.

### 39.3 Adapter Dengan Side Effect

```java
public String adaptToJson(Token token) {
    auditRepository.save(...);
    return token.value();
}
```

Serialization harus pure.

### 39.4 Catch-All Deserializer yang Terlalu Pintar

Deserializer yang menerima semua bentuk input lama/baru/aneh bisa membuat kontrak kabur.

Lebih baik:

- tetapkan migration window;
- log penggunaan legacy shape;
- deprecate;
- hapus setelah aman.

### 39.5 Provider-Specific Config Tersebar

Provider-specific code harus isolated.

### 39.6 Mengandalkan Round-Trip Test Saja

Round-trip bisa lolos meskipun JSON contract salah.

Harus ada golden/contract test.

---

## 40. Production Checklist

Sebelum JSON-B customization dipakai production, cek:

### Contract

- [ ] Apakah DTO berbeda dari domain/entity?
- [ ] Apakah field external diberi nama eksplisit untuk API penting?
- [ ] Apakah null vs absent semantics jelas?
- [ ] Apakah enum memakai stable external code?
- [ ] Apakah date/time format eksplisit?
- [ ] Apakah decimal/money tidak memakai floating point?

### Runtime

- [ ] Apakah `Jsonb` dibuat long-lived, bukan per request?
- [ ] Apakah provider tersedia di runtime?
- [ ] Apakah classpath tidak mencampur `javax` dan `jakarta`?
- [ ] Apakah container/fat JAR dependency strategy jelas?
- [ ] Apakah adapter/serializer thread-safe?

### Security

- [ ] Apakah request DTO tidak punya server-controlled field?
- [ ] Apakah unknown field policy sesuai boundary?
- [ ] Apakah polymorphism memakai allowlist?
- [ ] Apakah raw payload logging aman?
- [ ] Apakah body size dibatasi sebelum parsing?

### Testing

- [ ] Golden JSON serialization test ada?
- [ ] Negative deserialization test ada?
- [ ] Unknown field test ada jika strict?
- [ ] Null/absent test ada untuk PATCH?
- [ ] Provider upgrade test masuk CI?
- [ ] Java version/container compatibility diuji?

### Observability

- [ ] Binding error punya correlation ID?
- [ ] Error taxonomy membedakan input error vs internal error?
- [ ] Legacy shape usage terukur?
- [ ] Unknown field attempt dapat dimonitor jika relevan?

---

## 41. Mini Case Study: Public API Registration Boundary

### Requirement

Endpoint menerima:

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "preferred_language": "en",
  "marketing_consent": "Y"
}
```

Rules:

- unknown field harus ditolak;
- `marketing_consent` legacy flag `Y/N`;
- field internal seperti `role`, `status`, `tenant_id` tidak boleh diterima;
- response tidak boleh expose internal metadata;
- contract memakai snake_case;
- Java code memakai camelCase.

### DTO

```java
public class RegisterUserRequest {
    @JsonbProperty("username")
    public String username;

    @JsonbProperty("email")
    public String email;

    @JsonbProperty("preferred_language")
    public String preferredLanguage;

    @JsonbProperty("marketing_consent")
    @JsonbTypeAdapter(YesNoBooleanAdapter.class)
    public Boolean marketingConsent;
}
```

### Strict Reader

```java
public final class RegisterUserRequestParser {
    private static final Set<String> ALLOWED_FIELDS = Set.of(
            "username",
            "email",
            "preferred_language",
            "marketing_consent"
    );

    private final Jsonb jsonb;

    public RegisterUserRequestParser(Jsonb jsonb) {
        this.jsonb = jsonb;
    }

    public RegisterUserRequest parse(String body) {
        JsonObject object;
        try (JsonReader reader = Json.createReader(new StringReader(body))) {
            object = reader.readObject();
        } catch (JsonException e) {
            throw new BadRequestException("Malformed JSON");
        }

        Set<String> unknown = new LinkedHashSet<>(object.keySet());
        unknown.removeAll(ALLOWED_FIELDS);
        if (!unknown.isEmpty()) {
            throw new BadRequestException("Unknown field(s): " + unknown);
        }

        try {
            return jsonb.fromJson(body, RegisterUserRequest.class);
        } catch (JsonbException e) {
            throw new BadRequestException("Invalid registration payload", e);
        }
    }
}
```

### Java 8 Set Alternative

```java
private static final Set<String> ALLOWED_FIELDS =
        Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
                "username",
                "email",
                "preferred_language",
                "marketing_consent"
        )));
```

### Service Boundary

```java
public UserId register(RegisterUserRequest request) {
    Username username = Username.of(request.username);
    EmailAddress email = EmailAddress.of(request.email);
    Language language = Language.of(request.preferredLanguage);
    boolean consent = Boolean.TRUE.equals(request.marketingConsent);

    RegisterUserCommand command = new RegisterUserCommand(
            username,
            email,
            language,
            consent
    );

    return userService.register(command);
}
```

Notice:

- DTO tidak langsung menjadi entity;
- adapter hanya mengubah `Y/N`;
- domain validation tetap di domain value object;
- unknown field ditolak sebelum binding;
- server-controlled fields tidak ada di DTO.

---

## 42. Mini Case Study: Partner Legacy Payload Dengan Migration Window

Partner lama mengirim:

```json
{
  "cust_id": "C-1",
  "cust_nm": "Alice",
  "actv": "Y"
}
```

Partner baru mengirim:

```json
{
  "customer": {
    "id": "C-1",
    "name": "Alice",
    "active": true
  }
}
```

Strategi top engineer:

1. Jangan ubah domain mengikuti legacy shape.
2. Buat parser boundary menerima dua shape.
3. Log metric shape lama.
4. Tetapkan tanggal deprecation.
5. Setelah migration selesai, hapus support shape lama.

Canonical internal DTO:

```java
public record PartnerCustomerMessage(
        String id,
        String name,
        boolean active
) {}
```

Parser bisa menggunakan JSON-P karena shape berbeda cukup besar.

```java
public PartnerCustomerMessage parsePartnerCustomer(String json) {
    JsonObject root;
    try (JsonReader reader = Json.createReader(new StringReader(json))) {
        root = reader.readObject();
    }

    if (root.containsKey("customer")) {
        JsonObject customer = root.getJsonObject("customer");
        return new PartnerCustomerMessage(
                customer.getString("id"),
                customer.getString("name"),
                customer.getBoolean("active")
        );
    }

    if (root.containsKey("cust_id")) {
        // metric: legacy payload used
        return new PartnerCustomerMessage(
                root.getString("cust_id"),
                root.getString("cust_nm"),
                "Y".equals(root.getString("actv"))
        );
    }

    throw new BadRequestException("Unsupported partner customer payload shape");
}
```

Kenapa tidak pakai deserializer magic?

Bisa. Tetapi JSON-P parser manual kadang lebih jelas untuk migration boundary besar. Jangan memaksakan JSON-B untuk semua hal.

---

## 43. Kapan Tidak Menggunakan JSON-B

Gunakan JSON-B jika:

- object mapping relatif jelas;
- DTO cukup stabil;
- spec standard Jakarta penting;
- aplikasi berada di Jakarta EE ecosystem;
- kamu ingin portable binding API.

Pertimbangkan Jackson jika:

- ekosistem Spring Boot dominan;
- butuh fitur advanced yang lebih luas;
- butuh JSON Schema/tooling tertentu;
- banyak module datatype spesifik;
- team sudah standard di Jackson.

Pertimbangkan JSON-P jika:

- payload besar;
- butuh streaming;
- butuh partial extraction;
- butuh strict raw structure validation;
- patch/pointer/merge patch;
- field presence sangat penting.

Pertimbangkan manual parser/custom codec jika:

- kontrak sangat sensitif;
- shape sangat legacy/aneh;
- performance critical;
- deserialization harus security-hardened;
- polymorphism sangat terbatas dan perlu allowlist ketat.

Top engineer tidak memilih library berdasarkan popularitas saja. Ia memilih berdasarkan boundary risk.

---

## 44. Summary Mental Model

JSON-B customization terdiri dari beberapa lapisan:

```text
Annotation
  -> local declarative mapping

JsonbConfig
  -> global contract profile

JsonbAdapter
  -> type-level conversion

JsonbSerializer
  -> custom output shape

JsonbDeserializer
  -> custom input shape

JSON-P pre-processing
  -> strict structure/presence/security validation

DTO/domain mapper
  -> business boundary separation
```

Rule penting:

1. **Default mapping is convenient, not automatically safe.**
2. **Adapters are best for stable type-level conversion.**
3. **Serializers/deserializers are escape hatches; use deliberately.**
4. **Unknown fields are a policy decision, not a technical accident.**
5. **Null and absent are different in business semantics.**
6. **One `Jsonb` instance often equals one contract profile.**
7. **Provider behavior must be tested, especially across upgrades.**
8. **Do not serialize entities/domain objects directly across external boundaries.**
9. **JSON-B is binding, not full validation or authorization.**
10. **A good mapping layer is boring, explicit, tested, and isolated.**

---

## 45. Latihan Praktis

### Latihan 1 — Stable Enum Contract

Buat enum `ApplicationStatus` dengan internal names:

- `DRAFT`
- `SUBMITTED_FOR_REVIEW`
- `APPROVED`
- `REJECTED`

External code:

- `D`
- `SFR`
- `A`
- `R`

Tugas:

1. Buat `JsonbAdapter<ApplicationStatus, String>`.
2. Buat DTO dengan field status.
3. Test serialization ke external code.
4. Test deserialization invalid code harus gagal.

### Latihan 2 — Strict Unknown Field

Buat request DTO:

```json
{
  "case_no": "CASE-001",
  "reason": "..."
}
```

Tugas:

1. Implement strict parser dengan allowlist.
2. Payload dengan `admin_override: true` harus ditolak.
3. Payload dengan typo `reasn` harus ditolak sebagai unknown.
4. Payload missing `reason` harus gagal validation.

### Latihan 3 — Null vs Absent PATCH

Buat PATCH profile:

```json
{
  "phone": null
}
```

Dan:

```json
{}
```

Tugas:

1. Buat parser yang membedakan absent/null/value.
2. Terapkan ke aggregate dummy.
3. Test bahwa absent tidak mengubah field.
4. Test bahwa explicit null menghapus field.

### Latihan 4 — Legacy Partner Adapter

Legacy partner mengirim `Y/N`, date `ddMMyyyy`, dan amount string.

Tugas:

1. Buat adapter untuk flag.
2. Buat adapter untuk date.
3. Buat adapter untuk money.
4. Buat contract test golden JSON.

### Latihan 5 — Provider Upgrade Safety

Tugas:

1. Buat 10 golden tests untuk DTO penting.
2. Jalankan dengan provider version saat ini.
3. Upgrade provider minor version.
4. Catat apakah output berubah.
5. Buat checklist upgrade.

---

## 46. Referensi Utama

- Jakarta JSON Binding Specification 3.0 — mendefinisikan binding framework Java object ↔ JSON document.
- Jakarta JSON Binding API docs — `Jsonb`, `JsonbBuilder`, `JsonbConfig`, annotation, adapter, serializer, deserializer.
- Jakarta EE Tutorial — JSON Binding dan Yasson sebagai salah satu reference implementation.
- Jakarta JSON Processing Specification — penting karena JSON-B provider menggunakan parser/generator JSON-P di bawahnya.
- RFC 8259 — JSON data interchange format.
- RFC 8785 — JSON Canonicalization Scheme, relevan untuk deterministik output/signature/audit.

---

## 47. Penutup

Part ini membahas sisi yang sering memisahkan developer biasa dan engineer yang matang di enterprise integration.

Developer biasa biasanya bertanya:

> “Bagaimana caranya object ini jadi JSON?”

Engineer yang lebih matang bertanya:

> “Boundary apa yang sedang saya definisikan, failure apa yang mungkin terjadi, field mana yang boleh masuk/keluar, apakah mapping ini stabil, apakah provider upgrade bisa mengubah behavior, dan apakah saya bisa membuktikan contract ini lewat test?”

JSON-B customization adalah alat yang kuat. Tetapi kekuatan utamanya bukan pada banyaknya annotation atau serializer yang bisa ditulis. Kekuatan sebenarnya adalah kemampuan mendesain translation boundary yang eksplisit, stabil, aman, dan bisa diuji.

Pada part berikutnya, kita akan masuk ke desain DTO enterprise yang lebih sistematis: bagaimana JSON-B dipakai untuk boundary object, domain separation, records/sealed types, polymorphism risk, null/absent semantics, PATCH DTO, dan validation boundary.

**Status seri:** belum selesai.  
**Part saat ini:** Part 9 dari 34.  
**Part berikutnya:** Part 10 — JSON-B for Enterprise DTO Design.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration — Part 008](./learn-java-json-xml-soap-connectors-enterprise-integration-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 10](./learn-java-json-xml-soap-connectors-enterprise-integration-part-010.md)
