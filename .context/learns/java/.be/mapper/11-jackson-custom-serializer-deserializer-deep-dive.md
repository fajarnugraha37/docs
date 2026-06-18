# Part 11 — Jackson Custom Serializer/Deserializer Deep Dive

> Series: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `11-jackson-custom-serializer-deserializer-deep-dive.md`  
> Scope: Java 8–25, Jackson 2.x/3.x concepts, enterprise-grade JSON transformation  
> Status: Part 11 of 35

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas mental model Jackson, `ObjectMapper`, serialization, deserialization, generic type handling, polymorphism, dan sealed classes. Di bagian ini kita masuk ke area yang biasanya hanya disentuh ketika sistem sudah cukup kompleks: **custom serializer dan custom deserializer**.

Tujuan bagian ini bukan hanya membuat class yang extend `JsonSerializer` atau `JsonDeserializer`, tetapi memahami:

1. kapan custom serializer/deserializer memang diperlukan,
2. kapan sebaiknya dihindari,
3. bagaimana menjaga custom codec tetap lokal dan tidak merusak global behavior,
4. bagaimana membuat error message yang aman dan mudah didiagnosis,
5. bagaimana testing custom codec secara serius,
6. bagaimana menghindari hidden business logic di layer serialization,
7. bagaimana mendesain format JSON yang stabil untuk jangka panjang.

Mental model utamanya:

> Custom serializer/deserializer adalah **boundary codec**. Ia menerjemahkan antara representasi Java dan representasi wire format. Karena berada tepat di pintu masuk/keluar sistem, ia punya dampak langsung terhadap compatibility, security, observability, dan correctness.

---

## 1. Kenapa Custom Serializer/Deserializer Ada?

Jackson secara default sangat kuat. Ia bisa membaca dan menulis object Java biasa, records, collections, maps, enums, dates dengan module yang tepat, nested object, bahkan banyak bentuk polymorphism. Namun ada kasus di mana default behavior tidak cukup.

Contoh:

```json
{
  "amount": "IDR 125000.50"
}
```

Java model:

```java
public final class Money {
    private final String currency;
    private final BigDecimal amount;

    public Money(String currency, BigDecimal amount) {
        this.currency = currency;
        this.amount = amount;
    }

    public String currency() {
        return currency;
    }

    public BigDecimal amount() {
        return amount;
    }
}
```

Default Jackson tidak tahu bahwa string `"IDR 125000.50"` harus dipecah menjadi currency dan amount.

Atau sebaliknya:

```java
new Money("IDR", new BigDecimal("125000.50"))
```

ingin ditulis sebagai:

```json
"IDR 125000.50"
```

Di sinilah custom serializer/deserializer berguna.

Namun custom codec juga mudah disalahgunakan.

Contoh buruk:

```java
public class UserDeserializer extends JsonDeserializer<User> {
    @Override
    public User deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        // Membaca JSON
        // Query database
        // Cek role
        // Assign permission
        // Kirim audit event
        // Return User
    }
}
```

Ini buruk karena deserializer berubah menjadi service layer tersembunyi.

Prinsip penting:

> Serializer/deserializer sebaiknya hanya melakukan **representational transformation**, bukan workflow, authorization, persistence, atau orchestration.

---

## 2. Posisi Custom Codec dalam Mapping Architecture

Dalam sistem enterprise, data biasanya melewati beberapa boundary:

```text
HTTP JSON
   ↓
Jackson Deserializer
   ↓
Request DTO
   ↓
Validation
   ↓
Application Command
   ↓
Domain Logic
   ↓
Entity / Event / Response Model
   ↓
Jackson Serializer
   ↓
HTTP JSON
```

Custom deserializer berada di antara **wire payload** dan **DTO Java**.

Custom serializer berada di antara **DTO Java** dan **wire payload**.

Maka custom codec harus menjawab pertanyaan:

1. Apakah ini masalah format JSON?
2. Apakah ini masalah domain rule?
3. Apakah ini masalah validation?
4. Apakah ini masalah compatibility?
5. Apakah ini masalah security masking?
6. Apakah ini masalah presentation?

Jika masalahnya format, codec bisa tepat.

Jika masalahnya domain rule, jangan taruh di codec.

Jika masalahnya validation, pertimbangkan Bean Validation atau validator eksplisit.

Jika masalahnya presentation, pertimbangkan response DTO, bukan serializer global.

---

## 3. Kapan Custom Serializer Diperlukan?

Custom serializer biasanya diperlukan ketika Java object perlu ditulis ke JSON dengan bentuk yang tidak natural bagi default Jackson.

### 3.1 Value Object yang Harus Menjadi Scalar

Java:

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        if (value == null || !value.contains("@")) {
            throw new IllegalArgumentException("Invalid email address");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Default JSON mungkin:

```json
{
  "value": "alice@example.com"
}
```

Tetapi API contract ingin:

```json
"alice@example.com"
```

Custom serializer dapat menulis value object sebagai scalar.

### 3.2 Complex Object yang Harus Flattened

Java:

```java
public final class ApplicantName {
    private final String firstName;
    private final String middleName;
    private final String lastName;
}
```

JSON contract:

```json
{
  "fullName": "Alice Tan Mei Ling"
}
```

Ini bisa dilakukan serializer, tetapi harus hati-hati. Jika `fullName` hanya presentation, lebih baik response DTO memiliki field `fullName` yang sudah dihitung sebelum serialization.

### 3.3 Masking/Redaction untuk Output Tertentu

Contoh:

```json
{
  "nric": "S****123A"
}
```

Bisa dilakukan custom serializer, tetapi perlu hati-hati karena masking sering bergantung pada caller, role, endpoint, atau purpose.

Jika masking bergantung context, serializer global bisa berbahaya.

### 3.4 Format Legacy yang Harus Dipertahankan

Misalnya external system lama mengharapkan:

```json
{
  "birthDate": "19851231"
}
```

bukan:

```json
{
  "birthDate": "1985-12-31"
}
```

Custom serializer untuk external adapter dapat berguna.

### 3.5 Map Key Khusus

Jackson membedakan serializer untuk value dan key.

Contoh Java:

```java
Map<PostalCode, Address> addresses;
```

JSON object key harus string:

```json
{
  "123456": { "block": "10", "street": "Example Road" }
}
```

Untuk ini, kita butuh key serializer/deserializer.

---

## 4. Kapan Custom Deserializer Diperlukan?

Custom deserializer biasanya diperlukan ketika JSON inbound tidak cocok langsung dengan object Java.

### 4.1 Scalar JSON ke Value Object

JSON:

```json
{
  "email": "alice@example.com"
}
```

Java:

```java
public final class RegisterUserRequest {
    private final EmailAddress email;
}
```

Deserializer untuk `EmailAddress` bisa membaca string menjadi value object.

### 4.2 Format Tanggal Legacy

JSON:

```json
{
  "effectiveDate": "20260617"
}
```

Java:

```java
private LocalDate effectiveDate;
```

Ini bisa ditangani dengan `@JsonFormat`, formatter module, atau custom deserializer. Gunakan custom deserializer jika formatnya tidak cukup diekspresikan annotation atau perlu error message khusus.

### 4.3 Tolerant Reader untuk External API

External API kadang tidak konsisten:

```json
{
  "amount": 1000
}
```

atau:

```json
{
  "amount": "1000"
}
```

atau:

```json
{
  "amount": "1,000.00"
}
```

Deserializer bisa dibuat tolerant untuk inbound external adapter. Namun untuk public API milik kita sendiri, terlalu tolerant bisa menutupi bug consumer.

### 4.4 Union-Like Payload

JSON:

```json
{
  "type": "PERSON",
  "id": "S1234567A"
}
```

atau:

```json
{
  "type": "COMPANY",
  "uen": "201912345A"
}
```

Jika polymorphic annotation tidak cocok dengan contract, custom deserializer bisa dipakai.

### 4.5 Backward Compatibility

Payload lama:

```json
{
  "mobileNo": "91234567"
}
```

Payload baru:

```json
{
  "phone": {
    "countryCode": "+65",
    "number": "91234567"
  }
}
```

Custom deserializer dapat menerima keduanya dan menghasilkan model Java baru.

Tetapi ini harus dikontrol, diberi test, dan punya deprecation plan.

---

## 5. Kapan Custom Codec Harus Dihindari?

Custom codec bukan solusi pertama.

Hindari custom serializer/deserializer jika masalah bisa diselesaikan lebih sederhana dengan:

1. DTO yang lebih tepat,
2. `@JsonProperty`,
3. `@JsonFormat`,
4. `@JsonCreator`,
5. `@JsonValue`,
6. `@JsonAlias`,
7. naming strategy,
8. module bawaan seperti `JavaTimeModule`,
9. MapStruct/manual mapper,
10. validation layer.

Contoh:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED;

    @JsonValue
    public String wireValue() {
        return name().toLowerCase(Locale.ROOT);
    }
}
```

Untuk enum sederhana, `@JsonValue` mungkin cukup.

Contoh lain:

```java
public record CreateCaseRequest(
    @JsonProperty("case_title") String caseTitle
) {}
```

Tidak perlu custom deserializer hanya untuk beda nama field.

Prinsip:

> Custom codec adalah alat yang kuat tetapi mahal. Gunakan ketika shape mismatch nyata, bukan karena model DTO buruk.

---

## 6. Serializer Paling Sederhana

Misalnya kita punya value object:

```java
public final class PostalCode {
    private final String value;

    public PostalCode(String value) {
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be exactly 6 digits");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Serializer:

```java
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;

import java.io.IOException;

public final class PostalCodeSerializer extends JsonSerializer<PostalCode> {

    @Override
    public void serialize(
            PostalCode value,
            JsonGenerator gen,
            SerializerProvider serializers
    ) throws IOException {
        gen.writeString(value.value());
    }
}
```

Usage with annotation:

```java
import com.fasterxml.jackson.databind.annotation.JsonSerialize;

public final class AddressResponse {
    @JsonSerialize(using = PostalCodeSerializer.class)
    private final PostalCode postalCode;

    public AddressResponse(PostalCode postalCode) {
        this.postalCode = postalCode;
    }

    public PostalCode getPostalCode() {
        return postalCode;
    }
}
```

Output:

```json
{
  "postalCode": "123456"
}
```

Mental model:

- `JsonGenerator` adalah writer streaming.
- Serializer menulis token JSON secara eksplisit.
- `writeString` menghasilkan JSON string scalar.
- Serializer tidak return object; ia menulis ke output stream.

---

## 7. Deserializer Paling Sederhana

Deserializer:

```java
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;

public final class PostalCodeDeserializer extends JsonDeserializer<PostalCode> {

    @Override
    public PostalCode deserialize(
            JsonParser p,
            DeserializationContext ctxt
    ) throws IOException {
        String raw = p.getValueAsString();
        return new PostalCode(raw);
    }
}
```

Usage:

```java
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

public final class AddressRequest {
    @JsonDeserialize(using = PostalCodeDeserializer.class)
    private PostalCode postalCode;

    public PostalCode getPostalCode() {
        return postalCode;
    }

    public void setPostalCode(PostalCode postalCode) {
        this.postalCode = postalCode;
    }
}
```

Input:

```json
{
  "postalCode": "123456"
}
```

Result:

```java
new AddressRequest(new PostalCode("123456"));
```

Namun versi ini masih terlalu naif.

Masalah:

1. bagaimana jika JSON token bukan string?
2. bagaimana jika value null?
3. bagaimana jika string kosong?
4. bagaimana error message ditampilkan?
5. bagaimana field path diketahui?
6. bagaimana membedakan invalid syntax vs invalid domain value?

---

## 8. Token-Aware Deserializer

Deserializer yang lebih defensif harus membaca token.

```java
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;

public final class PostalCodeDeserializer extends JsonDeserializer<PostalCode> {

    @Override
    public PostalCode deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        JsonToken token = p.currentToken();

        if (token == JsonToken.VALUE_NULL) {
            return null;
        }

        if (token != JsonToken.VALUE_STRING) {
            return (PostalCode) ctxt.handleUnexpectedToken(
                PostalCode.class,
                p,
                "Expected postal code as JSON string with exactly 6 digits"
            );
        }

        String raw = p.getText();

        if (raw == null || raw.isBlank()) {
            return (PostalCode) ctxt.handleWeirdStringValue(
                PostalCode.class,
                raw,
                "Postal code must not be blank"
            );
        }

        try {
            return new PostalCode(raw);
        } catch (IllegalArgumentException ex) {
            return (PostalCode) ctxt.handleWeirdStringValue(
                PostalCode.class,
                raw,
                ex.getMessage()
            );
        }
    }
}
```

Untuk Java 8, `String.isBlank()` belum ada. Gunakan:

```java
private static boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
}
```

Kenapa menggunakan `ctxt.handleUnexpectedToken` dan `ctxt.handleWeirdStringValue`?

Karena Jackson dapat memperkaya error dengan context, path, target type, dan lokasi parsing.

Lebih baik daripada:

```java
throw new IllegalArgumentException("Invalid postal code");
```

Karena exception mentah sering menghasilkan error yang kurang konsisten di API layer.

---

## 9. `StdSerializer` dan `StdDeserializer`

Jackson menyediakan base class yang lebih nyaman:

```java
import com.fasterxml.jackson.databind.ser.std.StdSerializer;

public final class PostalCodeSerializer extends StdSerializer<PostalCode> {

    public PostalCodeSerializer() {
        super(PostalCode.class);
    }

    @Override
    public void serialize(PostalCode value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        gen.writeString(value.value());
    }
}
```

Deserializer:

```java
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;

public final class PostalCodeDeserializer extends StdDeserializer<PostalCode> {

    public PostalCodeDeserializer() {
        super(PostalCode.class);
    }

    @Override
    public PostalCode deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        String raw = p.getValueAsString();
        try {
            return new PostalCode(raw);
        } catch (IllegalArgumentException ex) {
            return (PostalCode) ctxt.handleWeirdStringValue(
                PostalCode.class,
                raw,
                ex.getMessage()
            );
        }
    }
}
```

`StdSerializer`/`StdDeserializer` membantu Jackson memahami handled type dan menyediakan behavior dasar yang lebih konsisten.

---

## 10. Registrasi dengan Annotation vs Module

Ada dua cara umum mendaftarkan custom codec:

1. annotation di property/type,
2. module global/local ObjectMapper.

### 10.1 Annotation di Property

```java
public final class AddressRequest {
    @JsonDeserialize(using = PostalCodeDeserializer.class)
    private PostalCode postalCode;
}
```

Kelebihan:

- lokal,
- eksplisit,
- mudah dipahami di field terkait,
- tidak memengaruhi semua penggunaan type.

Kekurangan:

- repetitive,
- mencampur DTO dengan Jackson annotation,
- sulit jika type digunakan di banyak tempat.

### 10.2 Annotation di Type

```java
@JsonSerialize(using = PostalCodeSerializer.class)
@JsonDeserialize(using = PostalCodeDeserializer.class)
public final class PostalCode {
    // ...
}
```

Kelebihan:

- semua penggunaan `PostalCode` konsisten,
- cocok untuk value object scalar.

Kekurangan:

- domain/value object menjadi aware terhadap Jackson,
- tidak cocok jika satu type punya format berbeda per boundary.

### 10.3 Module Registration

```java
import com.fasterxml.jackson.databind.module.SimpleModule;

SimpleModule module = new SimpleModule("ValueObjectModule");
module.addSerializer(PostalCode.class, new PostalCodeSerializer());
module.addDeserializer(PostalCode.class, new PostalCodeDeserializer());

ObjectMapper mapper = new ObjectMapper();
mapper.registerModule(module);
```

Kelebihan:

- domain class tidak perlu annotation,
- bisa dikonfigurasi per `ObjectMapper`,
- cocok untuk boundary-specific mapper.

Kekurangan:

- behavior bisa tersembunyi di configuration,
- jika dipasang ke global mapper, efeknya luas,
- perlu governance agar module tidak jadi dumping ground.

Prinsip:

> Jika format berlaku universal untuk type tersebut, type-level/module codec masuk akal. Jika format hanya berlaku untuk satu endpoint/boundary, buat DTO/annotation lokal atau ObjectMapper profile khusus.

---

## 11. Boundary-Specific Module

Dalam enterprise system, sering ada beberapa JSON profile:

```text
Internal API Mapper
External Partner Mapper
Audit Log Mapper
Message/Event Mapper
Cache Mapper
Test Strict Mapper
```

Jangan selalu memasang semua serializer/deserializer ke satu global `ObjectMapper`.

Contoh:

```java
public final class ExternalPartnerJsonModule extends SimpleModule {
    public ExternalPartnerJsonModule() {
        super("ExternalPartnerJsonModule");
        addSerializer(Money.class, new PartnerMoneySerializer());
        addDeserializer(Money.class, new PartnerMoneyDeserializer());
        addSerializer(LocalDate.class, new PartnerLocalDateSerializer());
        addDeserializer(LocalDate.class, new PartnerLocalDateDeserializer());
    }
}
```

Lalu:

```java
ObjectMapper partnerMapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .addModule(new ExternalPartnerJsonModule())
    .build();
```

Dengan ini, format partner tidak mencemari API internal.

---

## 12. Custom Serializer untuk Object Shape

Misalnya external API mengharapkan `Money` sebagai object:

```json
{
  "currency": "IDR",
  "amount": "125000.50"
}
```

Java:

```java
public final class Money {
    private final String currency;
    private final BigDecimal amount;

    public Money(String currency, BigDecimal amount) {
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("Currency must use ISO-like 3-letter code");
        }
        if (amount == null) {
            throw new IllegalArgumentException("Amount must not be null");
        }
        this.currency = currency;
        this.amount = amount;
    }

    public String currency() {
        return currency;
    }

    public BigDecimal amount() {
        return amount;
    }
}
```

Serializer:

```java
public final class MoneySerializer extends StdSerializer<Money> {

    public MoneySerializer() {
        super(Money.class);
    }

    @Override
    public void serialize(Money value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        gen.writeStartObject();
        gen.writeStringField("currency", value.currency());
        gen.writeStringField("amount", value.amount().toPlainString());
        gen.writeEndObject();
    }
}
```

Kenapa `toPlainString()`?

Karena `BigDecimal.toString()` kadang menghasilkan scientific notation untuk beberapa nilai. Untuk money/wire contract, biasanya kita ingin bentuk decimal eksplisit.

Namun jangan generalisasi buta. Untuk internal numeric JSON, angka bisa lebih tepat daripada string. Untuk money external API, string sering dipakai untuk mencegah precision issue di consumer JavaScript.

---

## 13. Custom Deserializer untuk Object Shape

Deserializer:

```java
public final class MoneyDeserializer extends StdDeserializer<Money> {

    public MoneyDeserializer() {
        super(Money.class);
    }

    @Override
    public Money deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        JsonNode node = p.getCodec().readTree(p);

        JsonNode currencyNode = node.get("currency");
        JsonNode amountNode = node.get("amount");

        if (currencyNode == null || currencyNode.isNull()) {
            return (Money) ctxt.reportInputMismatch(
                Money.class,
                "Missing required field 'currency' for Money"
            );
        }

        if (amountNode == null || amountNode.isNull()) {
            return (Money) ctxt.reportInputMismatch(
                Money.class,
                "Missing required field 'amount' for Money"
            );
        }

        if (!currencyNode.isTextual()) {
            return (Money) ctxt.reportInputMismatch(
                Money.class,
                "Field 'currency' must be a string"
            );
        }

        String currency = currencyNode.asText();
        String amountText;

        if (amountNode.isNumber()) {
            amountText = amountNode.decimalValue().toPlainString();
        } else if (amountNode.isTextual()) {
            amountText = amountNode.asText();
        } else {
            return (Money) ctxt.reportInputMismatch(
                Money.class,
                "Field 'amount' must be a string or number"
            );
        }

        try {
            BigDecimal amount = new BigDecimal(amountText);
            return new Money(currency, amount);
        } catch (RuntimeException ex) {
            return (Money) ctxt.reportInputMismatch(
                Money.class,
                "Invalid Money value: %s",
                ex.getMessage()
            );
        }
    }
}
```

Catatan penting:

`p.getCodec().readTree(p)` praktis, tetapi membaca subtree menjadi `JsonNode`. Untuk payload kecil, ini oke. Untuk payload sangat besar/hot path, streaming token manual bisa lebih hemat memory.

---

## 14. Tree-Based vs Streaming-Based Deserializer

Ada dua gaya utama custom deserializer:

1. tree-based,
2. streaming-based.

### 14.1 Tree-Based

```java
JsonNode node = p.getCodec().readTree(p);
```

Kelebihan:

- mudah dibaca,
- cocok untuk object kecil,
- mudah handle field optional,
- cocok untuk complex branching.

Kekurangan:

- alokasi `JsonNode`,
- kurang optimal untuk payload besar,
- bisa membuat developer lupa token validation.

### 14.2 Streaming-Based

```java
if (p.currentToken() != JsonToken.START_OBJECT) {
    ctxt.handleUnexpectedToken(Money.class, p);
}

String currency = null;
BigDecimal amount = null;

while (p.nextToken() != JsonToken.END_OBJECT) {
    String fieldName = p.currentName();
    p.nextToken();

    switch (fieldName) {
        case "currency":
            currency = p.getText();
            break;
        case "amount":
            amount = p.getDecimalValue();
            break;
        default:
            p.skipChildren();
    }
}

return new Money(currency, amount);
```

Kelebihan:

- lebih hemat memory,
- cocok untuk large payload,
- kontrol penuh token.

Kekurangan:

- lebih verbose,
- lebih rawan bug token navigation,
- lebih sulit maintain.

Rule praktis:

```text
Small object value object / external adapter payload → tree-based OK.
Very large arrays / streaming ingestion / high-throughput hot path → streaming-based.
```

---

## 15. Contextual Serializer

Kadang satu type perlu serialization berbeda tergantung annotation di field.

Contoh:

```java
public final class SensitiveString {
    private final String value;

    public SensitiveString(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Kita ingin:

```java
public final class PersonResponse {
    @Mask(strategy = MaskStrategy.EMAIL)
    private SensitiveString email;

    @Mask(strategy = MaskStrategy.PHONE)
    private SensitiveString phone;
}
```

Annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.METHOD})
public @interface Mask {
    MaskStrategy strategy();
}
```

Enum:

```java
public enum MaskStrategy {
    EMAIL,
    PHONE,
    FULL
}
```

Serializer:

```java
public final class SensitiveStringSerializer
        extends StdSerializer<SensitiveString>
        implements ContextualSerializer {

    private final MaskStrategy strategy;

    public SensitiveStringSerializer() {
        this(null);
    }

    private SensitiveStringSerializer(MaskStrategy strategy) {
        super(SensitiveString.class);
        this.strategy = strategy;
    }

    @Override
    public void serialize(SensitiveString value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }

        MaskStrategy effectiveStrategy = strategy != null ? strategy : MaskStrategy.FULL;
        gen.writeString(mask(value.value(), effectiveStrategy));
    }

    @Override
    public JsonSerializer<?> createContextual(
            SerializerProvider provider,
            BeanProperty property
    ) {
        if (property == null) {
            return this;
        }

        Mask mask = property.getAnnotation(Mask.class);
        if (mask == null) {
            mask = property.getContextAnnotation(Mask.class);
        }

        if (mask == null) {
            return this;
        }

        return new SensitiveStringSerializer(mask.strategy());
    }

    private static String mask(String raw, MaskStrategy strategy) {
        if (raw == null) {
            return null;
        }
        switch (strategy) {
            case EMAIL:
                int at = raw.indexOf('@');
                if (at <= 1) {
                    return "****";
                }
                return raw.charAt(0) + "****" + raw.substring(at);
            case PHONE:
                if (raw.length() <= 4) {
                    return "****";
                }
                return "****" + raw.substring(raw.length() - 4);
            case FULL:
            default:
                return "****";
        }
    }
}
```

Usage:

```java
public final class PersonResponse {
    @JsonSerialize(using = SensitiveStringSerializer.class)
    @Mask(strategy = MaskStrategy.EMAIL)
    private SensitiveString email;

    @JsonSerialize(using = SensitiveStringSerializer.class)
    @Mask(strategy = MaskStrategy.PHONE)
    private SensitiveString phone;
}
```

Ini powerful, tetapi ada risiko.

Masking di serializer bisa cocok untuk rule representational yang stabil. Namun jika masking tergantung role/user/permission, jangan hanya mengandalkan annotation statis. Gunakan response DTO berbeda atau mapping policy eksplisit sebelum serialization.

---

## 16. Contextual Deserializer

Contextual deserializer berguna jika parsing behavior tergantung annotation di field.

Contoh: date field dengan custom pattern per field.

Annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.PARAMETER})
public @interface LegacyDatePattern {
    String value();
}
```

Deserializer:

```java
public final class LegacyLocalDateDeserializer
        extends StdDeserializer<LocalDate>
        implements ContextualDeserializer {

    private final DateTimeFormatter formatter;

    public LegacyLocalDateDeserializer() {
        this(null);
    }

    private LegacyLocalDateDeserializer(DateTimeFormatter formatter) {
        super(LocalDate.class);
        this.formatter = formatter;
    }

    @Override
    public LocalDate deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        if (p.currentToken() == JsonToken.VALUE_NULL) {
            return null;
        }
        if (p.currentToken() != JsonToken.VALUE_STRING) {
            return (LocalDate) ctxt.handleUnexpectedToken(
                LocalDate.class,
                p,
                "Expected date as string"
            );
        }

        String raw = p.getText();
        DateTimeFormatter effectiveFormatter = formatter != null
            ? formatter
            : DateTimeFormatter.ISO_LOCAL_DATE;

        try {
            return LocalDate.parse(raw, effectiveFormatter);
        } catch (DateTimeParseException ex) {
            return (LocalDate) ctxt.handleWeirdStringValue(
                LocalDate.class,
                raw,
                "Invalid date format"
            );
        }
    }

    @Override
    public JsonDeserializer<?> createContextual(
            DeserializationContext ctxt,
            BeanProperty property
    ) {
        if (property == null) {
            return this;
        }

        LegacyDatePattern annotation = property.getAnnotation(LegacyDatePattern.class);
        if (annotation == null) {
            return this;
        }

        return new LegacyLocalDateDeserializer(
            DateTimeFormatter.ofPattern(annotation.value())
        );
    }
}
```

Usage:

```java
public final class LegacyRequest {
    @JsonDeserialize(using = LegacyLocalDateDeserializer.class)
    @LegacyDatePattern("yyyyMMdd")
    private LocalDate effectiveDate;
}
```

Kelebihan:

- format behavior dekat dengan field,
- reusable,
- tidak perlu banyak deserializer class.

Risiko:

- terlalu banyak annotation bisa membuat DTO sulit dibaca,
- formatter invalid baru ketahuan runtime,
- behavior tersembunyi di annotation custom.

---

## 17. Delegating Serializer/Deserializer

Kadang kita ingin custom logic kecil tetapi sisanya tetap menggunakan Jackson default.

Misalnya wrapping output:

```json
{
  "type": "case",
  "payload": {
    "id": "CASE-001",
    "title": "Example"
  }
}
```

Jika payload besar, jangan tulis semua field manual. Delegasikan.

Serializer:

```java
public final class EnvelopeSerializer extends StdSerializer<Envelope<?>> {

    public EnvelopeSerializer() {
        super((Class<Envelope<?>>) (Class<?>) Envelope.class);
    }

    @Override
    public void serialize(Envelope<?> value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        gen.writeStartObject();
        gen.writeStringField("type", value.type());
        gen.writeFieldName("payload");
        provider.defaultSerializeValue(value.payload(), gen);
        gen.writeEndObject();
    }
}
```

`provider.defaultSerializeValue` meminta Jackson menggunakan serializer default untuk payload.

Ini penting agar kita tidak menduplikasi logic serialization payload.

---

## 18. Key Serializer dan Key Deserializer

JSON object keys selalu string. Jika Java map menggunakan key custom type, kita butuh key serializer/deserializer.

Java:

```java
public final class CaseId {
    private final String value;

    public CaseId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId must not be blank");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Key serializer:

```java
public final class CaseIdKeySerializer extends JsonSerializer<CaseId> {
    @Override
    public void serialize(CaseId value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        gen.writeFieldName(value.value());
    }
}
```

Key deserializer:

```java
public final class CaseIdKeyDeserializer extends KeyDeserializer {
    @Override
    public Object deserializeKey(String key, DeserializationContext ctxt)
            throws IOException {
        try {
            return new CaseId(key);
        } catch (IllegalArgumentException ex) {
            return ctxt.handleWeirdKey(CaseId.class, key, ex.getMessage());
        }
    }
}
```

Module:

```java
SimpleModule module = new SimpleModule("CaseIdKeyModule");
module.addKeySerializer(CaseId.class, new CaseIdKeySerializer());
module.addKeyDeserializer(CaseId.class, new CaseIdKeyDeserializer());
```

Input:

```json
{
  "CASE-001": {
    "title": "Inspection case"
  },
  "CASE-002": {
    "title": "Appeal case"
  }
}
```

Java:

```java
Map<CaseId, CaseSummary> cases;
```

---

## 19. Null Handling

Custom serializer biasanya tidak dipanggil untuk null value. Jackson punya null serializer sendiri.

Misalnya:

```java
private PostalCode postalCode = null;
```

Jackson biasanya menulis:

```json
{
  "postalCode": null
}
```

atau menghilangkan field tergantung `JsonInclude`.

Jangan mengandalkan serializer value untuk handle null kecuali serializer dipanggil secara khusus.

Untuk deserializer, null handling lebih tricky.

Jika JSON:

```json
{
  "postalCode": null
}
```

Deserializer custom mungkin tidak selalu dipanggil tergantung configuration dan property handling.

Jika ingin policy null eksplisit, gunakan:

```java
@JsonSetter(nulls = Nulls.FAIL)
private PostalCode postalCode;
```

atau validation:

```java
@NotNull
private PostalCode postalCode;
```

atau constructor invariant:

```java
public AddressRequest(PostalCode postalCode) {
    this.postalCode = Objects.requireNonNull(postalCode, "postalCode");
}
```

Prinsip:

> Null policy sebaiknya eksplisit di DTO/contract, bukan tersembunyi di custom deserializer.

---

## 20. Missing vs Null vs Empty

Untuk API inbound, tiga kondisi ini berbeda:

```json
{}
```

```json
{
  "postalCode": null
}
```

```json
{
  "postalCode": ""
}
```

Maknanya bisa berbeda:

| Condition | Meaning Possible |
|---|---|
| Missing | client tidak mengirim field |
| Null | client sengaja menghapus/mengosongkan |
| Empty string | client mengirim value kosong |

Untuk create request, biasanya ketiganya invalid untuk required field.

Untuk patch request, missing sering berarti “jangan ubah”, null bisa berarti “clear value”, empty string bisa invalid atau clear tergantung policy.

Deserializer custom tidak selalu tahu apakah field missing, karena ia hanya dipanggil ketika property hadir. Untuk membedakan missing vs null dalam patch, sering lebih baik memakai wrapper type:

```java
public final class FieldPatch<T> {
    private final boolean present;
    private final T value;

    private FieldPatch(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> FieldPatch<T> missing() {
        return new FieldPatch<>(false, null);
    }

    public static <T> FieldPatch<T> present(T value) {
        return new FieldPatch<>(true, value);
    }
}
```

Atau gunakan JSON Merge Patch/JsonNode di boundary lalu map secara eksplisit.

---

## 21. Error Message Design

Custom deserializer harus menghasilkan error yang:

1. jelas untuk developer/client,
2. tidak membocorkan internal implementation,
3. menyebut field/format yang benar,
4. tidak menyertakan sensitive raw value sembarangan,
5. bisa dipetakan ke API error response.

Buruk:

```text
java.lang.IllegalArgumentException at Money.java:17
```

Lebih baik:

```text
Invalid value for field 'amount': expected decimal string, for example "125000.50".
```

Namun jangan bocorkan value sensitif:

Buruk:

```text
Invalid NRIC S1234567A
```

Lebih aman:

```text
Invalid identity number format.
```

Untuk internal log, bisa simpan diagnostic dengan masking:

```text
Invalid identity number format. maskedValue=S****67A, fieldPath=/applicant/nric
```

---

## 22. Avoiding Global Side Effects

Masalah umum:

```java
objectMapper.registerModule(new SimpleModule()
    .addSerializer(LocalDate.class, new LegacyDateSerializer()));
```

Efeknya: semua `LocalDate` di seluruh aplikasi berubah format.

Ini berbahaya.

Misalnya API internal butuh:

```json
"2026-06-17"
```

Partner legacy butuh:

```json
"20260617"
```

Audit log butuh:

```json
"2026-06-17"
```

Jika serializer `LocalDate` global diubah menjadi `yyyyMMdd`, internal API dan audit bisa rusak diam-diam.

Lebih aman:

```java
ObjectMapper internalMapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .build();

ObjectMapper partnerMapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .addModule(new PartnerLegacyDateModule())
    .build();
```

Atau gunakan DTO partner dengan annotation lokal:

```java
public record PartnerRequest(
    @JsonFormat(pattern = "yyyyMMdd") LocalDate effectiveDate
) {}
```

---

## 23. Custom Codec vs `@JsonValue` and `@JsonCreator`

Untuk value object sederhana, `@JsonValue` dan `@JsonCreator` sering cukup.

```java
public final class PostalCode {
    private final String value;

    @JsonCreator
    public PostalCode(String value) {
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be exactly 6 digits");
        }
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
```

JSON:

```json
"123456"
```

Kelebihan:

- lebih sedikit code,
- behavior dekat dengan value object,
- cocok untuk scalar wrapper.

Kekurangan:

- class menjadi dependent pada Jackson,
- error handling kurang fleksibel,
- tidak cocok jika format berbeda per boundary,
- bisa konflik dengan domain purity.

Rule:

```text
Small app / DTO-owned value object → @JsonValue/@JsonCreator acceptable.
Domain core / multiple boundary format → module/custom codec per boundary lebih aman.
```

---

## 24. Custom Codec vs MapStruct

Jackson custom deserializer mengubah JSON menjadi DTO/object.

MapStruct mengubah Java object menjadi Java object.

Jangan campur tugas.

Contoh salah:

```java
public final class CreateCaseDeserializer extends JsonDeserializer<CreateCaseCommand> {
    @Override
    public CreateCaseCommand deserialize(JsonParser p, DeserializationContext ctxt) {
        // JSON → command
        // normalize title
        // lookup applicant
        // decide case type
        // apply default SLA
    }
}
```

Lebih baik:

```text
JSON → CreateCaseRequest DTO         oleh Jackson
CreateCaseRequest → CreateCaseCommand oleh MapStruct/manual mapper
Command validation/domain logic        oleh application/domain layer
```

Custom deserializer hanya diperlukan jika JSON shape sulit dibaca langsung menjadi request DTO.

---

## 25. Custom Codec for Backward Compatibility

Misalnya field berubah dari:

```json
{
  "status": "PENDING_APPROVAL"
}
```

menjadi:

```json
{
  "status": {
    "code": "PENDING_APPROVAL",
    "label": "Pending Approval"
  }
}
```

Jika inbound harus menerima keduanya:

```java
public final class StatusDeserializer extends StdDeserializer<Status> {

    public StatusDeserializer() {
        super(Status.class);
    }

    @Override
    public Status deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        JsonToken token = p.currentToken();

        if (token == JsonToken.VALUE_STRING) {
            return Status.fromCode(p.getText());
        }

        if (token == JsonToken.START_OBJECT) {
            JsonNode node = p.getCodec().readTree(p);
            JsonNode code = node.get("code");
            if (code == null || !code.isTextual()) {
                return (Status) ctxt.reportInputMismatch(
                    Status.class,
                    "Missing textual field 'code' for status object"
                );
            }
            return Status.fromCode(code.asText());
        }

        return (Status) ctxt.handleUnexpectedToken(
            Status.class,
            p,
            "Expected status as string or object with field 'code'"
        );
    }
}
```

Ini contoh tolerant reader.

Namun tolerant reader perlu batas:

1. dokumentasikan format lama,
2. test format lama dan baru,
3. metric/log usage format lama,
4. tentukan deprecation date jika memungkinkan,
5. jangan membuat parser terlalu permisif sampai menerima garbage.

---

## 26. Custom Codec for External Partner Weirdness

External systems sering mengirim:

```json
{
  "active": "Y",
  "amount": "0000012500",
  "date": "20260617",
  "tags": "A|B|C"
}
```

Internal model yang baik:

```java
public record PartnerInboundDto(
    boolean active,
    BigDecimal amount,
    LocalDate date,
    List<String> tags
) {}
```

Untuk kasus seperti ini, ada dua pendekatan:

### Pendekatan A — DTO Raw + Mapper

```java
public record PartnerRawDto(
    String active,
    String amount,
    String date,
    String tags
) {}
```

Lalu mapper manual/MapStruct:

```java
PartnerInboundDto normalize(PartnerRawDto raw) {
    return new PartnerInboundDto(
        "Y".equals(raw.active()),
        parseCents(raw.amount()),
        LocalDate.parse(raw.date(), DateTimeFormatter.BASIC_ISO_DATE),
        Arrays.asList(raw.tags().split("\\|"))
    );
}
```

### Pendekatan B — Custom Deserializer

Deserializer langsung parse ke `PartnerInboundDto`.

Mana lebih baik?

Untuk banyak field legacy aneh, **DTO raw + mapper** sering lebih maintainable karena semua conversion terlihat sebagai mapping policy.

Custom deserializer lebih cocok jika weirdness ada pada type kecil yang reusable, misalnya `YesNoBoolean`, `LegacyDate`, `PipeSeparatedList`.

---

## 27. Serializer untuk Redaction: Hati-Hati

Misalnya:

```java
public final class Nric {
    private final String value;
}
```

Global serializer:

```java
public final class NricSerializer extends StdSerializer<Nric> {
    @Override
    public void serialize(Nric value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        gen.writeString(mask(value.value()));
    }
}
```

Ini tampak aman, tetapi bisa menjadi masalah:

1. internal audit mungkin butuh encrypted/full value,
2. outbound integration mungkin butuh full value,
3. admin endpoint mungkin butuh role-based partial reveal,
4. logs mungkin punya policy masking berbeda,
5. cache mungkin butuh canonical internal shape.

Jika serializer global selalu masking, beberapa boundary rusak.

Jika serializer global tidak masking, data bisa bocor.

Solusi lebih baik:

```text
Domain Nric
   ↓
Response DTO: maskedNric
Integration DTO: encrypted/fullNric according to policy
Audit DTO: tokenized/encryptedNric
```

Gunakan custom serializer masking hanya untuk boundary yang sangat jelas dan stabil.

---

## 28. Serializer with `SerializerProvider` Attributes

Kadang serialization butuh context runtime. Jackson menyediakan provider attributes.

Contoh:

```java
ObjectWriter writer = mapper.writer()
    .withAttribute("maskLevel", "PUBLIC");
```

Serializer:

```java
public final class NricContextualRuntimeSerializer extends StdSerializer<Nric> {

    public NricContextualRuntimeSerializer() {
        super(Nric.class);
    }

    @Override
    public void serialize(Nric value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        Object maskLevel = provider.getAttribute("maskLevel");
        if ("INTERNAL".equals(maskLevel)) {
            gen.writeString(value.value());
        } else {
            gen.writeString(mask(value.value()));
        }
    }
}
```

Ini powerful, tetapi harus digunakan disiplin.

Risiko:

- behavior output tidak terlihat dari DTO,
- test harus mencakup attribute combinations,
- mudah lupa set attribute,
- bisa menjadi security footgun.

Untuk role-based output, biasanya response mapper eksplisit lebih aman.

---

## 29. Deserializer and Dependency Injection

Kadang deserializer butuh collaborator, misalnya code table parser.

Hati-hati.

Jika collaborator hanya pure utility:

```java
public final class CountryCodeParser {
    public CountryCode parse(String raw) {
        return new CountryCode(raw.trim().toUpperCase(Locale.ROOT));
    }
}
```

Masih masuk akal.

Jika collaborator adalah repository/service:

```java
countryRepository.findByCode(raw)
```

Ini mulai berbahaya.

Kenapa?

1. deserialization jadi I/O operation,
2. parser bisa lambat,
3. retry/transaction tidak jelas,
4. error HTTP parsing bercampur DB error,
5. sulit test,
6. bisa membuat request body parsing memicu database storm.

Prinsip:

> Deserializer boleh memakai pure parser/converter. Hindari repository, network call, authorization service, atau workflow service.

Jika butuh lookup, parse dulu ke DTO, lalu resolve di application layer.

---

## 30. Generic Deserializer

Generic deserializer lebih sulit karena type erasure.

Misalnya:

```java
public final class ApiValue<T> {
    private final T value;

    public ApiValue(T value) {
        this.value = value;
    }

    public T value() {
        return value;
    }
}
```

JSON:

```json
{
  "value": 123
}
```

Deserializer butuh tahu `T`.

Pendekatan advanced menggunakan `ContextualDeserializer`:

```java
public final class ApiValueDeserializer
        extends JsonDeserializer<ApiValue<?>>
        implements ContextualDeserializer {

    private final JavaType valueType;

    public ApiValueDeserializer() {
        this(null);
    }

    private ApiValueDeserializer(JavaType valueType) {
        this.valueType = valueType;
    }

    @Override
    public ApiValue<?> deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        if (valueType == null) {
            return (ApiValue<?>) ctxt.reportInputMismatch(
                ApiValue.class,
                "Cannot deserialize ApiValue without generic value type"
            );
        }

        JsonNode node = p.getCodec().readTree(p);
        JsonNode valueNode = node.get("value");

        Object value = ctxt.readTreeAsValue(valueNode, valueType);
        return new ApiValue<>(value);
    }

    @Override
    public JsonDeserializer<?> createContextual(
            DeserializationContext ctxt,
            BeanProperty property
    ) throws JsonMappingException {
        JavaType wrapperType;

        if (property != null) {
            wrapperType = property.getType();
        } else {
            wrapperType = ctxt.getContextualType();
        }

        if (wrapperType == null || wrapperType.containedTypeCount() == 0) {
            return this;
        }

        JavaType contained = wrapperType.containedType(0);
        return new ApiValueDeserializer(contained);
    }
}
```

Ini bukan contoh untuk dihafal, tetapi untuk menunjukkan satu hal:

> Generic deserialization membutuhkan type context. Tanpa type context, Jackson tidak bisa menebak `T` secara aman.

---

## 31. Custom Serializer untuk Generic Wrapper

Serializer generic biasanya lebih mudah karena runtime value tersedia.

```java
public final class ApiValueSerializer extends JsonSerializer<ApiValue<?>> {
    @Override
    public void serialize(ApiValue<?> value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        gen.writeStartObject();
        gen.writeFieldName("value");
        serializers.defaultSerializeValue(value.value(), gen);
        gen.writeEndObject();
    }
}
```

Tetapi jika `value()` null, type information bisa hilang. Untuk simple wrapper ini tidak masalah. Untuk polymorphic/generic contract, null bisa ambiguous.

---

## 32. Custom Deserializer for Polymorphic Payload

Misalnya API tidak menggunakan `@JsonTypeInfo`, tetapi discriminator custom:

```json
{
  "kind": "EMAIL",
  "value": "alice@example.com"
}
```

```json
{
  "kind": "SMS",
  "countryCode": "+65",
  "number": "91234567"
}
```

Java:

```java
public sealed interface ContactMethod permits EmailContact, SmsContact {}

public record EmailContact(String value) implements ContactMethod {}

public record SmsContact(String countryCode, String number) implements ContactMethod {}
```

Deserializer:

```java
public final class ContactMethodDeserializer extends StdDeserializer<ContactMethod> {

    public ContactMethodDeserializer() {
        super(ContactMethod.class);
    }

    @Override
    public ContactMethod deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        ObjectCodec codec = p.getCodec();
        JsonNode node = codec.readTree(p);

        JsonNode kindNode = node.get("kind");
        if (kindNode == null || !kindNode.isTextual()) {
            return (ContactMethod) ctxt.reportInputMismatch(
                ContactMethod.class,
                "Missing textual discriminator field 'kind'"
            );
        }

        String kind = kindNode.asText();
        switch (kind) {
            case "EMAIL":
                return codec.treeToValue(node, EmailContact.class);
            case "SMS":
                return codec.treeToValue(node, SmsContact.class);
            default:
                return (ContactMethod) ctxt.reportInputMismatch(
                    ContactMethod.class,
                    "Unsupported contact method kind '%s'",
                    kind
                );
        }
    }
}
```

Catatan security:

- whitelist subtype secara eksplisit,
- jangan load class berdasarkan string dari client,
- jangan menerima arbitrary type name,
- jangan aktifkan default typing untuk untrusted payload.

---

## 33. Unknown Fields Inside Custom Deserializer

Jika kita menggunakan tree-based deserializer, kita bisa tanpa sadar mengabaikan unknown field.

Input:

```json
{
  "currency": "IDR",
  "amount": "100.00",
  "admin": true
}
```

Deserializer tree-based yang hanya membaca `currency` dan `amount` akan mengabaikan `admin`.

Kadang ini baik untuk forward compatibility. Kadang buruk untuk strict public API.

Untuk strict mode:

```java
private static final Set<String> ALLOWED_FIELDS = Set.of("currency", "amount");

private static void rejectUnknownFields(JsonNode node, DeserializationContext ctxt)
        throws JsonMappingException {
    Iterator<String> names = node.fieldNames();
    while (names.hasNext()) {
        String name = names.next();
        if (!ALLOWED_FIELDS.contains(name)) {
            ctxt.reportInputMismatch(
                Money.class,
                "Unknown field '%s' for Money",
                name
            );
        }
    }
}
```

Untuk Java 8, `Set.of` belum ada:

```java
private static final Set<String> ALLOWED_FIELDS = new HashSet<>(
    Arrays.asList("currency", "amount")
);
```

Prinsip:

> Jika custom deserializer mengambil alih parsing, ia juga mengambil alih policy unknown field untuk subtree tersebut.

---

## 34. Coercion Policy

Jackson punya coercion behavior. Misalnya string menjadi number, empty string menjadi null, number menjadi string, dan sebagainya tergantung konfigurasi.

Custom deserializer harus memutuskan sendiri:

- apakah menerima number untuk string?
- apakah menerima string untuk number?
- apakah trim whitespace?
- apakah empty string dianggap null?
- apakah case-insensitive enum diterima?

Contoh policy untuk public API strict:

```text
amount must be JSON string decimal, e.g. "125000.50".
number token is rejected.
empty string is rejected.
whitespace is rejected unless explicitly trimmed by normalization layer.
```

Contoh policy untuk external legacy inbound:

```text
amount may be string or number.
comma separator accepted.
leading zero accepted.
blank becomes null only for optional field.
```

Jangan mencampur dua policy ini dalam satu global deserializer.

---

## 35. Exception Handling in Deserializer

Deserializer boleh melempar `IOException` atau `JsonMappingException`.

Jangan lempar random unchecked exception tanpa context.

Buruk:

```java
throw new RuntimeException("bad money");
```

Lebih baik:

```java
return (Money) ctxt.reportInputMismatch(
    Money.class,
    "Invalid money amount format"
);
```

Atau:

```java
throw JsonMappingException.from(p, "Invalid money amount format", ex);
```

Tetapi hati-hati dengan cause message jika mengandung sensitive data.

---

## 36. Testing Custom Serializer

Test serializer harus memastikan output shape stabil.

Contoh JUnit:

```java
class PostalCodeSerializerTest {

    private final ObjectMapper mapper = JsonMapper.builder()
        .addModule(new SimpleModule()
            .addSerializer(PostalCode.class, new PostalCodeSerializer()))
        .build();

    @Test
    void serializesPostalCodeAsString() throws Exception {
        String json = mapper.writeValueAsString(new PostalCode("123456"));
        assertEquals("\"123456\"", json);
    }
}
```

Untuk object:

```java
@Test
void serializesMoneyAsObjectWithDecimalString() throws Exception {
    Money money = new Money("IDR", new BigDecimal("125000.50"));

    String json = mapper.writeValueAsString(money);

    assertEquals("{\"currency\":\"IDR\",\"amount\":\"125000.50\"}", json);
}
```

Namun exact string comparison bisa rapuh jika ordering tidak dijamin. Alternatif:

```java
JsonNode node = mapper.readTree(json);
assertEquals("IDR", node.get("currency").asText());
assertEquals("125000.50", node.get("amount").asText());
```

Untuk golden payload contract, exact comparison bisa justru diinginkan.

---

## 37. Testing Custom Deserializer

Test valid input:

```java
@Test
void deserializesPostalCodeFromString() throws Exception {
    PostalCode postalCode = mapper.readValue("\"123456\"", PostalCode.class);
    assertEquals("123456", postalCode.value());
}
```

Test invalid token:

```java
@Test
void rejectsPostalCodeNumberToken() {
    assertThrows(JsonMappingException.class, () ->
        mapper.readValue("123456", PostalCode.class)
    );
}
```

Test invalid string:

```java
@Test
void rejectsInvalidPostalCodeString() {
    JsonMappingException ex = assertThrows(JsonMappingException.class, () ->
        mapper.readValue("\"ABC\"", PostalCode.class)
    );

    assertTrue(ex.getMessage().contains("Postal code"));
}
```

Test null:

```java
@Test
void handlesNullAccordingToPolicy() throws Exception {
    PostalCode postalCode = mapper.readValue("null", PostalCode.class);
    assertNull(postalCode);
}
```

Butuh juga test property path:

```java
@Test
void errorContainsPathWhenNested() {
    JsonMappingException ex = assertThrows(JsonMappingException.class, () ->
        mapper.readValue("{\"address\":{\"postalCode\":\"ABC\"}}", UserRequest.class)
    );

    assertTrue(ex.getPathReference().contains("postalCode"));
}
```

---

## 38. Round-Trip Test: Berguna tapi Tidak Cukup

Round-trip:

```java
Money original = new Money("IDR", new BigDecimal("125000.50"));
String json = mapper.writeValueAsString(original);
Money restored = mapper.readValue(json, Money.class);
assertEquals(original, restored);
```

Ini berguna, tetapi tidak cukup.

Kenapa?

Karena serializer dan deserializer bisa sama-sama salah tetapi saling kompatibel.

Contoh:

- serializer menulis `currencyCode`,
- deserializer membaca `currencyCode`,
- test round-trip lolos,
- tetapi external contract mengharapkan `currency`.

Maka perlu golden payload test:

```java
assertEquals(
    "{\"currency\":\"IDR\",\"amount\":\"125000.50\"}",
    json
);
```

Atau compare dengan file golden JSON.

---

## 39. Golden Payload Testing

Golden payload adalah contoh JSON yang dianggap kontrak stabil.

Struktur test:

```text
src/test/resources/contracts/money/v1/money-idr.json
src/test/resources/contracts/money/v1/money-usd.json
src/test/resources/contracts/money/v1/money-invalid-missing-currency.json
```

Test:

```java
@Test
void deserializesGoldenMoneyPayload() throws Exception {
    String json = readResource("contracts/money/v1/money-idr.json");
    Money money = mapper.readValue(json, Money.class);

    assertEquals("IDR", money.currency());
    assertEquals(new BigDecimal("125000.50"), money.amount());
}
```

Golden payload membantu menjaga compatibility ketika:

- upgrade Jackson,
- refactor DTO,
- ganti Lombok ke record,
- pindah Java 8 ke Java 21/25,
- upgrade Spring Boot,
- ubah ObjectMapper configuration.

---

## 40. Performance Considerations

Custom codec bisa lebih cepat atau lebih lambat dari default Jackson.

Faktor:

1. streaming vs tree,
2. allocation intermediate object,
3. string parsing,
4. BigDecimal parsing,
5. date formatter allocation,
6. regex usage,
7. exception-heavy path,
8. module lookup overhead,
9. contextual serializer instantiation.

Contoh buruk:

```java
DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyyMMdd");
return LocalDate.parse(raw, formatter);
```

Jika formatter dibuat setiap deserialize, ada overhead.

Lebih baik:

```java
private static final DateTimeFormatter BASIC_DATE = DateTimeFormatter.ofPattern("yyyyMMdd");
```

Regex juga perlu hati-hati:

```java
if (!raw.matches("\\d{6}")) { ... }
```

`String.matches` compile pattern setiap kali. Untuk hot path:

```java
private static final Pattern POSTAL_CODE = Pattern.compile("\\d{6}");

if (!POSTAL_CODE.matcher(raw).matches()) { ... }
```

Atau manual digit check:

```java
private static boolean isSixDigits(String value) {
    if (value == null || value.length() != 6) {
        return false;
    }
    for (int i = 0; i < 6; i++) {
        if (!Character.isDigit(value.charAt(i))) {
            return false;
        }
    }
    return true;
}
```

---

## 41. Large Array Deserialization

Jangan gunakan tree model untuk payload array sangat besar jika tidak perlu.

Buruk:

```java
JsonNode root = mapper.readTree(inputStream);
for (JsonNode item : root.get("items")) {
    process(item);
}
```

Ini memuat semua payload ke memory.

Lebih baik streaming:

```java
JsonFactory factory = mapper.getFactory();
try (JsonParser parser = factory.createParser(inputStream)) {
    if (parser.nextToken() != JsonToken.START_ARRAY) {
        throw new IllegalArgumentException("Expected array");
    }

    ObjectReader reader = mapper.readerFor(ItemDto.class);

    while (parser.nextToken() != JsonToken.END_ARRAY) {
        ItemDto item = reader.readValue(parser);
        process(item);
    }
}
```

Custom deserializer untuk item kecil boleh tetap default, tetapi pembacaan collection dilakukan streaming.

---

## 42. Thread Safety

Serializer/deserializer instance dapat digunakan ulang oleh Jackson. Karena itu, custom codec harus thread-safe.

Aman:

```java
public final class MoneySerializer extends StdSerializer<Money> {
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE;
}
```

Tidak aman:

```java
public final class BadSerializer extends StdSerializer<Something> {
    private String lastValue;

    @Override
    public void serialize(Something value, JsonGenerator gen, SerializerProvider provider) {
        lastValue = value.toString();
        gen.writeString(lastValue);
    }
}
```

Jangan simpan mutable per-request state di serializer/deserializer field.

Jika contextual serializer membutuhkan konfigurasi, buat instance immutable baru:

```java
return new SensitiveStringSerializer(mask.strategy());
```

Bukan mutate serializer existing.

---

## 43. Java 8 sampai Java 25 Considerations

### Java 8

- Tidak ada records.
- Tidak ada sealed classes.
- `String.isBlank()` belum ada.
- `List.of`, `Set.of` belum ada.
- DTO sering JavaBean atau Lombok.
- Constructor binding butuh setup lebih hati-hati.

### Java 11

- `String.isBlank()` tersedia.
- Runtime modern umum untuk Spring Boot 2/3 transition.

### Java 16+

- Records stable.
- DTO immutable makin natural.
- Jackson mendukung records pada versi modern.

### Java 17+

- Sealed classes stable.
- Cocok untuk closed polymorphic payload.

### Java 21/25

- Modern enterprise baseline semakin record/sealed-friendly.
- Namun library compatibility tetap harus dicek.
- Annotation processing Lombok/MapStruct harus kompatibel dengan JDK target.
- Contract tests makin penting saat upgrade compiler dan library.

Prinsip:

> Semakin modern Java model yang dipakai, semakin sedikit boilerplate DTO, tetapi semakin penting memastikan Jackson/MapStruct/Lombok/toolchain memahami bentuk object tersebut.

---

## 44. Jackson 2.x vs 3.x Awareness

Konsep serializer/deserializer tetap relevan, tetapi package, module, dan behavior tertentu bisa berubah antar major version.

Yang harus dijaga:

1. jangan hardcode behavior berdasarkan kebetulan versi lama,
2. tulis tests untuk custom codec,
3. hindari penggunaan internal API Jackson,
4. baca migration notes saat upgrade,
5. test strict/lenient behavior,
6. test JavaTime, records, polymorphic handling,
7. test module registration.

Custom codec yang memakai public extension points seperti `JsonSerializer`, `JsonDeserializer`, `SimpleModule`, dan contextual interfaces cenderung lebih mudah dimigrasikan daripada yang bergantung pada internal class.

---

## 45. Anti-Patterns

### 45.1 God Deserializer

```java
CreateCaseDeserializer
```

yang melakukan:

- parsing,
- validation,
- normalization,
- lookup DB,
- authorization,
- default SLA,
- audit,
- event creation.

Ini buruk.

### 45.2 Global Serializer untuk Semua Boundary

Satu serializer dipakai untuk internal API, external API, event, cache, audit, dan admin response.

Biasanya akan rusak karena setiap boundary punya contract berbeda.

### 45.3 Silent Fallback

```java
try {
    return parse(raw);
} catch (Exception e) {
    return DEFAULT;
}
```

Ini berbahaya. Data invalid berubah menjadi default tanpa jejak.

### 45.4 Overly Tolerant Public API

Menerima string, number, boolean, empty string, object, array untuk field yang seharusnya string.

Ini membuat client bug tidak ketahuan.

### 45.5 Serializer Menyembunyikan N+1 Query

Jika serializer memanggil getter yang lazy-load JPA association, serialization bisa memicu query storm.

Masalah ini akan dibahas lebih dalam di Part 31.

### 45.6 Business Rule in Serializer

```java
if (caseStatus == APPROVED && userRole == ADMIN) {
    writeExtraField();
}
```

Jika output bergantung business authorization, lebih baik bentuk response DTO di application layer.

---

## 46. Production Checklist untuk Custom Codec

Sebelum custom serializer/deserializer masuk production, cek:

### Necessity

- Apakah annotation/DTO/mapper biasa tidak cukup?
- Apakah ini representational transformation, bukan business workflow?
- Apakah codec ini benar-benar lebih baik dari DTO khusus?

### Boundary

- Apakah berlaku global atau hanya boundary tertentu?
- Apakah module dipasang ke ObjectMapper yang tepat?
- Apakah tidak merusak internal API/audit/event/cache?

### Compatibility

- Apakah format JSON terdokumentasi?
- Apakah ada golden payload test?
- Apakah backward compatibility diuji?
- Apakah unknown field policy jelas?

### Security

- Apakah tidak membuka unsafe polymorphic loading?
- Apakah tidak membocorkan sensitive value di error?
- Apakah masking/redaction tidak bergantung global serializer yang ambigu?

### Correctness

- Apakah missing/null/empty dibedakan sesuai contract?
- Apakah invalid token ditolak dengan jelas?
- Apakah numeric/date/enum coercion policy eksplisit?
- Apakah BigDecimal/date formatting stabil?

### Performance

- Apakah tree model aman untuk ukuran payload?
- Apakah formatter/regex tidak dibuat berulang di hot path?
- Apakah codec stateless/thread-safe?

### Observability

- Apakah error dapat dipetakan ke field path?
- Apakah log aman dan cukup informatif?
- Apakah ada metric untuk legacy fallback jika compatibility mode dipakai?

---

## 47. Worked Example: External Partner Money Codec

Kita desain codec untuk external partner dengan contract:

Inbound/outbound JSON:

```json
{
  "ccy": "IDR",
  "amt": "125000.50"
}
```

Internal value object:

```java
public final class Money {
    private final String currency;
    private final BigDecimal amount;

    public Money(String currency, BigDecimal amount) {
        if (currency == null || !currency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("currency must be 3 uppercase letters");
        }
        if (amount == null) {
            throw new IllegalArgumentException("amount must not be null");
        }
        this.currency = currency;
        this.amount = amount;
    }

    public String currency() {
        return currency;
    }

    public BigDecimal amount() {
        return amount;
    }
}
```

Serializer:

```java
public final class PartnerMoneySerializer extends StdSerializer<Money> {

    public PartnerMoneySerializer() {
        super(Money.class);
    }

    @Override
    public void serialize(Money value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        gen.writeStartObject();
        gen.writeStringField("ccy", value.currency());
        gen.writeStringField("amt", value.amount().toPlainString());
        gen.writeEndObject();
    }
}
```

Deserializer:

```java
public final class PartnerMoneyDeserializer extends StdDeserializer<Money> {

    private static final Set<String> ALLOWED_FIELDS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("ccy", "amt"))
    );

    public PartnerMoneyDeserializer() {
        super(Money.class);
    }

    @Override
    public Money deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        if (p.currentToken() != JsonToken.START_OBJECT) {
            return (Money) ctxt.handleUnexpectedToken(
                Money.class,
                p,
                "Expected money as object with fields 'ccy' and 'amt'"
            );
        }

        JsonNode node = p.getCodec().readTree(p);
        rejectUnknownFields(node, ctxt);

        String currency = readRequiredText(node, "ccy", ctxt);
        String amountText = readRequiredText(node, "amt", ctxt);

        try {
            return new Money(currency, new BigDecimal(amountText));
        } catch (RuntimeException ex) {
            return (Money) ctxt.reportInputMismatch(
                Money.class,
                "Invalid partner money payload"
            );
        }
    }

    private static void rejectUnknownFields(JsonNode node, DeserializationContext ctxt)
            throws JsonMappingException {
        Iterator<String> names = node.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (!ALLOWED_FIELDS.contains(name)) {
                ctxt.reportInputMismatch(
                    Money.class,
                    "Unknown field '%s' for partner money payload",
                    name
                );
            }
        }
    }

    private static String readRequiredText(
            JsonNode node,
            String field,
            DeserializationContext ctxt
    ) throws JsonMappingException {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return (String) ctxt.reportInputMismatch(
                Money.class,
                "Missing required field '%s'",
                field
            );
        }
        if (!value.isTextual()) {
            return (String) ctxt.reportInputMismatch(
                Money.class,
                "Field '%s' must be textual",
                field
            );
        }
        String text = value.asText();
        if (text.trim().isEmpty()) {
            return (String) ctxt.reportInputMismatch(
                Money.class,
                "Field '%s' must not be blank",
                field
            );
        }
        return text;
    }
}
```

Module:

```java
public final class PartnerMoneyModule extends SimpleModule {
    public PartnerMoneyModule() {
        super("PartnerMoneyModule");
        addSerializer(Money.class, new PartnerMoneySerializer());
        addDeserializer(Money.class, new PartnerMoneyDeserializer());
    }
}
```

Boundary mapper:

```java
ObjectMapper partnerMapper = JsonMapper.builder()
    .addModule(new PartnerMoneyModule())
    .build();
```

Test:

```java
class PartnerMoneyCodecTest {

    private final ObjectMapper mapper = JsonMapper.builder()
        .addModule(new PartnerMoneyModule())
        .build();

    @Test
    void serializesPartnerMoney() throws Exception {
        Money money = new Money("IDR", new BigDecimal("125000.50"));

        String json = mapper.writeValueAsString(money);

        JsonNode node = mapper.readTree(json);
        assertEquals("IDR", node.get("ccy").asText());
        assertEquals("125000.50", node.get("amt").asText());
    }

    @Test
    void deserializesPartnerMoney() throws Exception {
        Money money = mapper.readValue(
            "{\"ccy\":\"IDR\",\"amt\":\"125000.50\"}",
            Money.class
        );

        assertEquals("IDR", money.currency());
        assertEquals(new BigDecimal("125000.50"), money.amount());
    }

    @Test
    void rejectsUnknownField() {
        assertThrows(JsonMappingException.class, () ->
            mapper.readValue(
                "{\"ccy\":\"IDR\",\"amt\":\"125000.50\",\"admin\":true}",
                Money.class
            )
        );
    }
}
```

---

## 48. Decision Framework

Ketika menemukan mapping problem, gunakan decision tree berikut.

```text
Apakah masalahnya hanya nama field?
  → @JsonProperty / naming strategy.

Apakah masalahnya format date/number sederhana?
  → @JsonFormat / JavaTimeModule / formatter config.

Apakah masalahnya value object scalar universal?
  → @JsonValue/@JsonCreator atau module codec.

Apakah format berbeda per boundary?
  → DTO boundary-specific atau ObjectMapper/module boundary-specific.

Apakah inbound external legacy sangat aneh?
  → raw DTO + mapper, atau type-level custom deserializer kecil.

Apakah perlu DB/network lookup?
  → Jangan di deserializer. Parse dulu, resolve di application layer.

Apakah perlu role-based output?
  → Response DTO/mapping policy eksplisit, bukan serializer global.

Apakah payload besar?
  → Streaming parser/ObjectReader, hindari full JsonNode tree.

Apakah polymorphic untrusted input?
  → Explicit discriminator whitelist, jangan default typing arbitrary class.
```

---

## 49. Ringkasan Mental Model

Custom serializer/deserializer adalah alat untuk mengontrol bentuk JSON saat default Jackson tidak cukup.

Namun ia harus dipakai dengan disiplin:

1. Serializer/deserializer adalah codec, bukan service layer.
2. Jangan sembunyikan business rule di codec.
3. Jangan memasang behavior boundary-specific ke global ObjectMapper.
4. Missing/null/empty harus dipikirkan secara eksplisit.
5. Unknown field policy harus jelas, terutama jika memakai tree-based parser.
6. Error message harus aman dan diagnostik.
7. Tolerant reader berguna untuk external compatibility, tetapi berbahaya untuk public API yang seharusnya strict.
8. Custom codec harus stateless dan thread-safe.
9. Tree model mudah, streaming model lebih hemat memory.
10. Golden payload tests adalah perlindungan utama terhadap contract drift.

Jika disederhanakan:

> Top-level engineer tidak bertanya “bagaimana membuat Jackson bisa parse ini?” saja. Ia bertanya “di boundary mana format ini berlaku, policy apa yang sedang diterapkan, siapa consumer-nya, bagaimana evolusinya, apa failure mode-nya, dan bagaimana kita membuktikan contract ini tidak berubah diam-diam?”

---

## 50. Latihan

### Latihan 1 — Value Object Scalar

Buat value object `CaseReferenceNo` yang JSON-nya berbentuk string:

```json
"CASE-2026-000001"
```

Requirement:

- harus diawali `CASE-`,
- mengandung tahun 4 digit,
- mengandung sequence 6 digit,
- invalid string harus menghasilkan `JsonMappingException`,
- test valid, invalid token, invalid string, null.

Bandingkan pendekatan:

1. `@JsonCreator` + `@JsonValue`,
2. custom serializer/deserializer module.

Jelaskan trade-off-nya.

### Latihan 2 — Legacy Boolean

External partner mengirim:

```json
{
  "active": "Y"
}
```

atau:

```json
{
  "active": "N"
}
```

Buat `YesNoBooleanDeserializer`.

Requirement:

- `Y` menjadi true,
- `N` menjadi false,
- lowercase ditolak untuk strict mode,
- null policy eksplisit,
- unknown value ditolak.

### Latihan 3 — Partner Money Format

Buat serializer/deserializer untuk:

```json
{
  "ccy": "SGD",
  "amt": "1000.00"
}
```

Requirement:

- reject unknown fields,
- reject blank fields,
- reject numeric `amt` untuk strict mode,
- test golden payload.

### Latihan 4 — Polymorphic Contact Method

Buat custom deserializer untuk:

```json
{
  "kind": "EMAIL",
  "value": "a@example.com"
}
```

```json
{
  "kind": "SMS",
  "countryCode": "+65",
  "number": "91234567"
}
```

Requirement:

- whitelist kind,
- unknown kind ditolak,
- missing kind ditolak,
- jangan memakai class name dari input.

### Latihan 5 — Redaction Decision

Desain response untuk field `nric`.

Bandingkan:

1. global serializer masking,
2. field annotation contextual serializer,
3. response DTO dengan `maskedNric`,
4. mapper policy berdasarkan caller role.

Pilih pendekatan terbaik untuk:

- public citizen API,
- internal officer API,
- audit event,
- outbound partner integration.

---

## 51. Checklist Review Code

Saat review PR yang menambahkan custom serializer/deserializer, tanyakan:

1. Apa alasan custom codec ini diperlukan?
2. Kenapa annotation/DTO/mapper biasa tidak cukup?
3. Apakah codec ini berlaku global atau hanya satu boundary?
4. Apakah module dipasang pada ObjectMapper yang tepat?
5. Apakah ada golden payload test?
6. Apakah invalid token diuji?
7. Apakah missing/null/empty behavior diuji?
8. Apakah unknown field policy eksplisit?
9. Apakah error message aman?
10. Apakah tidak ada DB/network/service call?
11. Apakah serializer/deserializer stateless?
12. Apakah polymorphic handling whitelist-based?
13. Apakah large payload aman dari memory blow-up?
14. Apakah upgrade Jackson/Java kemungkinan memecahkan behavior ini?
15. Apakah contract ownership jelas?

---

## 52. Penutup

Custom serializer/deserializer adalah salah satu extension point Jackson yang paling kuat. Ia bisa membuat sistem mampu berkomunikasi dengan legacy API, menjaga contract aneh, membaca payload polymorphic, menulis value object dengan format bersih, dan membuat model Java tetap expressive.

Tetapi kekuatan ini datang dengan biaya: behavior bisa tersembunyi, global side effect bisa merusak boundary lain, business logic bisa bocor ke parsing layer, dan error handling bisa menjadi sulit.

Di level engineering yang matang, custom codec harus diperlakukan seperti komponen boundary yang serius: punya ownership, policy, tests, compatibility story, security review, dan observability.

Bagian berikutnya akan membahas **Jackson for Enterprise API Contracts: Strictness, Compatibility, Evolution** — bagaimana JSON contract berubah seiring waktu tanpa merusak consumer dan tanpa membuat sistem terlalu permissive.

---

## Status Seri

- Part 11 selesai.
- Seri belum selesai.
- Berikutnya: `12-jackson-enterprise-api-contracts-strictness-compatibility-evolution.md`.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 10 — Jackson Advanced Type Handling: Generic, Polymorphism, Sealed Classes](./10-jackson-advanced-type-handling-generic-polymorphism-sealed-classes.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 12 — Jackson for Enterprise API Contracts: Strictness, Compatibility, Evolution](./12-jackson-enterprise-api-contracts-strictness-compatibility-evolution.md)

</div>