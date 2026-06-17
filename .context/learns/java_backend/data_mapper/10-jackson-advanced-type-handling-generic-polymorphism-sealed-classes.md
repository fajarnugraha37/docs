# Part 10 — Jackson Advanced Type Handling: Generic, Polymorphism, Sealed Classes

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `10-jackson-advanced-type-handling-generic-polymorphism-sealed-classes.md`  
> Fokus: generic type, type erasure, `TypeReference`, `JavaType`, polymorphic JSON, discriminator design, sealed classes, dan security boundary.  
> Target: Java 8 sampai Java 25, Jackson 2.x dengan awareness arah Jackson 3.x.

---

## 1. Kenapa Advanced Type Handling Penting

Pada bagian sebelumnya, kita membahas deserialization sederhana:

```java
OrderRequest request = objectMapper.readValue(json, OrderRequest.class);
```

Untuk DTO flat dan concrete class, ini cukup mudah dipahami. Tetapi real system jarang sesederhana itu.

Di aplikasi enterprise, terutama API, event-driven architecture, batch import, integration adapter, dan regulatory/case management platform, kita sering berhadapan dengan bentuk data seperti ini:

```java
ApiResponse<List<OrderSummaryDto>>
PageResult<CustomerSearchResultDto>
Map<String, List<ValidationErrorDto>>
CommandEnvelope<CreateCaseCommand>
DomainEvent<CaseApprovedPayload>
List<? extends NotificationChannel>
sealed interface PaymentInstruction permits BankTransfer, CreditCard, Giro
```

Masalahnya, Java memiliki **type erasure**. Informasi generic seperti `List<OrderSummaryDto>` tidak selalu tersedia di runtime jika hanya diberi `Class<?>` biasa.

Jackson harus menjawab pertanyaan:

```text
JSON array ini harus menjadi List apa?
Object di dalam array ini class-nya apa?
Wrapper response ini payload-nya tipe apa?
Interface ini harus dibuat menjadi implementation mana?
Abstract class ini harus dibuat menjadi subtype mana?
Generic field T ini saat runtime sebetulnya T apa?
```

Jika pertanyaan ini tidak dijawab eksplisit, hasilnya bisa:

- `List<LinkedHashMap>` bukannya `List<OrderDto>`
- `ClassCastException` di layer berikutnya
- field nested tidak terdeserialize dengan benar
- polymorphic object gagal dibuat
- payload event tidak bisa di-route
- subtype salah dipilih
- security vulnerability karena type metadata terlalu bebas
- contract JSON menjadi terlalu Java-specific

Top 1% engineer tidak hanya tahu cara menulis `new TypeReference<>() {}`. Mereka paham **mengapa** itu dibutuhkan, **kapan** aman, dan **bagaimana** mendesain type metadata sebagai public contract.

---

## 2. Mental Model: Java Type vs Runtime Class

Di Java, `Class<T>` hanya mewakili raw class:

```java
List.class
Map.class
ApiResponse.class
OrderDto.class
```

Tetapi banyak tipe Java sebenarnya bukan sekadar class. Mereka adalah **parameterized type**:

```java
List<OrderDto>
Map<String, OrderDto>
ApiResponse<List<OrderDto>>
```

Perbedaannya:

```text
Class<?>:
    hanya tahu raw type

Parameterized type:
    tahu raw type + type argument

Jackson JavaType:
    representasi lengkap tipe Java untuk databind runtime
```

Contoh:

```java
List<OrderDto> orders;
```

Secara source code, compiler tahu bahwa `orders` adalah list of `OrderDto`. Tetapi pada runtime, karena type erasure, object list hanya memiliki class seperti:

```java
java.util.ArrayList
```

Type argument `OrderDto` tidak melekat langsung ke instance list.

Jackson perlu informasi tambahan supaya bisa membuat elemen yang benar.

---

## 3. Type Erasure: Akar Masalah Generic Deserialization

Misalnya ada JSON:

```json
[
  { "id": "O-001", "status": "SUBMITTED" },
  { "id": "O-002", "status": "APPROVED" }
]
```

Jika kita membaca seperti ini:

```java
List<OrderDto> orders = objectMapper.readValue(json, List.class);
```

Kode itu terlihat seperti menghasilkan `List<OrderDto>`, tetapi sebenarnya tidak.

Jackson hanya diberi `List.class`. Ia tahu harus membuat list, tetapi tidak tahu elemen list harus class apa. Maka object JSON di dalam array biasanya akan menjadi `LinkedHashMap`.

Akibatnya:

```java
OrderDto first = orders.get(0); // ClassCastException
```

Masalahnya bukan Jackson “bodoh”. Masalahnya kita tidak memberikan tipe lengkap.

Yang benar:

```java
List<OrderDto> orders = objectMapper.readValue(
    json,
    new TypeReference<List<OrderDto>>() {}
);
```

atau:

```java
JavaType type = objectMapper
    .getTypeFactory()
    .constructCollectionType(List.class, OrderDto.class);

List<OrderDto> orders = objectMapper.readValue(json, type);
```

Mental model:

```text
readValue(json, List.class)
    = buat List, elemen bebas/unknown

readValue(json, new TypeReference<List<OrderDto>>() {})
    = buat List, setiap elemen bind sebagai OrderDto

readValue(json, JavaType List<OrderDto>)
    = sama, tetapi type dibuat programmatically
```

---

## 4. `TypeReference`: Cara Sederhana Menangkap Generic Type

`TypeReference` menggunakan anonymous subclass untuk mempertahankan informasi generic di runtime.

Contoh:

```java
TypeReference<List<OrderDto>> typeRef = new TypeReference<List<OrderDto>>() {};

List<OrderDto> orders = objectMapper.readValue(json, typeRef);
```

Kenapa harus ada `{}`?

Karena:

```java
new TypeReference<List<OrderDto>>() {}
```

membuat anonymous class yang superclass-nya membawa generic signature `List<OrderDto>`. Jackson kemudian membaca generic signature itu.

### 4.1 Kapan `TypeReference` Cocok

Gunakan `TypeReference` saat tipe diketahui statis di source code:

```java
List<OrderDto>
Map<String, OrderDto>
ApiResponse<OrderDto>
ApiResponse<List<OrderDto>>
```

Contoh:

```java
ApiResponse<List<OrderDto>> response = objectMapper.readValue(
    json,
    new TypeReference<ApiResponse<List<OrderDto>>>() {}
);
```

### 4.2 Kapan `TypeReference` Kurang Cocok

`TypeReference` kurang cocok saat tipe dibangun dinamis:

```java
Class<?> payloadClass = resolvePayloadClass(eventType);
```

Misalnya event type menentukan payload class:

```java
String eventType = envelope.getType();
Class<?> payloadClass = registry.getPayloadClass(eventType);
```

Dalam kasus ini, gunakan `JavaType`.

---

## 5. `JavaType`: Representasi Type Lengkap Milik Jackson

`JavaType` adalah abstraksi Jackson untuk mewakili tipe Java secara lengkap.

Contoh membangun `List<OrderDto>`:

```java
JavaType type = objectMapper.getTypeFactory()
    .constructCollectionType(List.class, OrderDto.class);

List<OrderDto> orders = objectMapper.readValue(json, type);
```

Contoh `Map<String, OrderDto>`:

```java
JavaType type = objectMapper.getTypeFactory()
    .constructMapType(Map.class, String.class, OrderDto.class);

Map<String, OrderDto> ordersById = objectMapper.readValue(json, type);
```

Contoh `ApiResponse<OrderDto>`:

```java
JavaType type = objectMapper.getTypeFactory()
    .constructParametricType(ApiResponse.class, OrderDto.class);

ApiResponse<OrderDto> response = objectMapper.readValue(json, type);
```

Contoh nested generic `ApiResponse<List<OrderDto>>`:

```java
TypeFactory typeFactory = objectMapper.getTypeFactory();

JavaType listOfOrders = typeFactory.constructCollectionType(
    List.class,
    OrderDto.class
);

JavaType responseType = typeFactory.constructParametricType(
    ApiResponse.class,
    listOfOrders
);

ApiResponse<List<OrderDto>> response = objectMapper.readValue(json, responseType);
```

Mental model:

```text
TypeReference
    cocok untuk static generic type yang diketahui di compile-time

JavaType
    cocok untuk generic type yang perlu dibangun/dipilih secara runtime
```

---

## 6. Contoh Wrapper Generic: `ApiResponse<T>`

Banyak API menggunakan wrapper:

```json
{
  "success": true,
  "data": {
    "id": "O-001",
    "status": "SUBMITTED"
  },
  "errors": []
}
```

Model Java:

```java
public class ApiResponse<T> {
    private boolean success;
    private T data;
    private List<ApiError> errors;

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }

    public List<ApiError> getErrors() {
        return errors;
    }

    public void setErrors(List<ApiError> errors) {
        this.errors = errors;
    }
}
```

Jika dibaca seperti ini:

```java
ApiResponse response = objectMapper.readValue(json, ApiResponse.class);
Object data = response.getData();
```

`data` kemungkinan menjadi `LinkedHashMap`.

Yang benar:

```java
ApiResponse<OrderDto> response = objectMapper.readValue(
    json,
    new TypeReference<ApiResponse<OrderDto>>() {}
);
```

atau:

```java
JavaType type = objectMapper.getTypeFactory()
    .constructParametricType(ApiResponse.class, OrderDto.class);

ApiResponse<OrderDto> response = objectMapper.readValue(json, type);
```

### 6.1 Wrapper Generic dan Boundary Design

Wrapper generic kelihatan reusable, tetapi punya risiko desain:

```java
ApiResponse<T>
```

bisa membuat semua endpoint tampak sama, padahal semantik berbeda.

Contoh:

```java
ApiResponse<OrderDto>
ApiResponse<CaseDetailDto>
ApiResponse<List<UserDto>>
```

Reusable wrapper boleh, tetapi payload `T` tetap harus punya contract jelas.

Jangan sampai wrapper dipakai untuk menyembunyikan desain DTO yang buruk.

---

## 7. Generic Method untuk Deserialize Payload

Kadang kita ingin membuat helper:

```java
public <T> T fromJson(String json, Class<T> type) throws IOException {
    return objectMapper.readValue(json, type);
}
```

Ini baik untuk concrete class:

```java
OrderDto order = fromJson(json, OrderDto.class);
```

Tetapi gagal untuk generic container:

```java
List<OrderDto> orders = fromJson(json, List.class); // salah secara tipe semantik
```

Untuk generic penuh, expose overload:

```java
public <T> T fromJson(String json, TypeReference<T> type) throws IOException {
    return objectMapper.readValue(json, type);
}
```

atau:

```java
public <T> T fromJson(String json, JavaType type) throws IOException {
    return objectMapper.readValue(json, type);
}
```

Design utility yang lebih aman:

```java
public final class JsonCodec {
    private final ObjectMapper objectMapper;

    public JsonCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public <T> T read(String json, Class<T> type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (IOException e) {
            throw new JsonDecodeException("Failed to decode JSON as " + type.getName(), e);
        }
    }

    public <T> T read(String json, TypeReference<T> type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (IOException e) {
            throw new JsonDecodeException("Failed to decode JSON as " + type.getType(), e);
        }
    }

    public <T> T read(String json, JavaType type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (IOException e) {
            throw new JsonDecodeException("Failed to decode JSON as " + type, e);
        }
    }
}
```

Hal penting: jangan hanya menyediakan `Class<T>` lalu mengklaim utility itu generic-safe.

---

## 8. `JsonNode` sebagai Intermediate untuk Dynamic Payload

Kadang kita belum tahu payload type sebelum membaca sebagian JSON.

Contoh event envelope:

```json
{
  "eventId": "evt-001",
  "eventType": "CASE_APPROVED",
  "occurredAt": "2026-06-17T10:15:30Z",
  "payload": {
    "caseId": "CASE-001",
    "approvedBy": "user-123"
  }
}
```

Kita harus membaca `eventType` dulu, baru tahu payload class.

Strategi umum:

1. Deserialize envelope ringan dengan `JsonNode payload`
2. Resolve payload class dari event type
3. Convert `payload` node ke target class

Model:

```java
public class EventEnvelopeNode {
    private String eventId;
    private String eventType;
    private Instant occurredAt;
    private JsonNode payload;

    // getters/setters
}
```

Registry:

```java
public final class EventPayloadRegistry {
    private final Map<String, Class<?>> payloadTypes;

    public EventPayloadRegistry(Map<String, Class<?>> payloadTypes) {
        this.payloadTypes = Map.copyOf(payloadTypes);
    }

    public Class<?> resolve(String eventType) {
        Class<?> type = payloadTypes.get(eventType);
        if (type == null) {
            throw new UnknownEventTypeException(eventType);
        }
        return type;
    }
}
```

Decoder:

```java
public DomainEvent<?> decode(String json) throws IOException {
    EventEnvelopeNode envelope = objectMapper.readValue(json, EventEnvelopeNode.class);

    Class<?> payloadClass = registry.resolve(envelope.getEventType());

    Object payload = objectMapper.treeToValue(envelope.getPayload(), payloadClass);

    return new DomainEvent<>(
        envelope.getEventId(),
        envelope.getEventType(),
        envelope.getOccurredAt(),
        payload
    );
}
```

### 8.1 Kenapa Ini Sering Lebih Aman daripada Global Polymorphism

Pendekatan registry eksplisit lebih aman karena:

- hanya event type yang dikenal yang diterima
- payload class tidak dikirim sebagai nama class Java
- mapping event type ke class dikendalikan server
- error handling bisa dibuat jelas
- contract JSON tidak bocor ke detail package/class Java

Ini adalah contoh anti-corruption design untuk polymorphic payload.

---

## 9. Polymorphism: Saat JSON Harus Menjadi Interface/Abstract Class

Misalnya kita punya domain model:

```java
public interface PaymentMethod {
    String type();
}

public class CreditCardPayment implements PaymentMethod {
    private String cardToken;

    @Override
    public String type() {
        return "CREDIT_CARD";
    }

    public String getCardToken() {
        return cardToken;
    }

    public void setCardToken(String cardToken) {
        this.cardToken = cardToken;
    }
}

public class BankTransferPayment implements PaymentMethod {
    private String bankCode;
    private String accountNumber;

    @Override
    public String type() {
        return "BANK_TRANSFER";
    }

    public String getBankCode() {
        return bankCode;
    }

    public void setBankCode(String bankCode) {
        this.bankCode = bankCode;
    }

    public String getAccountNumber() {
        return accountNumber;
    }

    public void setAccountNumber(String accountNumber) {
        this.accountNumber = accountNumber;
    }
}
```

Payload JSON:

```json
{
  "type": "CREDIT_CARD",
  "cardToken": "tok_123"
}
```

Jika kita membaca:

```java
PaymentMethod method = objectMapper.readValue(json, PaymentMethod.class);
```

Jackson tidak tahu implementation mana yang harus dibuat. Interface tidak bisa diinstansiasi.

Kita butuh mekanisme subtype selection.

---

## 10. Discriminator Field: Fondasi Polymorphic JSON yang Sehat

Polymorphic JSON butuh informasi untuk memilih subtype. Informasi ini biasa disebut:

- discriminator
- type field
- kind field
- category field
- event type
- message type

Contoh:

```json
{
  "paymentType": "CREDIT_CARD",
  "cardToken": "tok_123"
}
```

atau:

```json
{
  "kind": "BANK_TRANSFER",
  "bankCode": "DBS",
  "accountNumber": "123456789"
}
```

Discriminator yang baik:

- stabil sebagai public contract
- tidak memakai fully qualified Java class name
- tidak tergantung package structure
- value-nya terbatas dan terdokumentasi
- jelas ownership-nya
- bisa dievolusi dengan compatibility policy
- bisa ditolak jika tidak dikenal

Discriminator yang buruk:

```json
{
  "@class": "com.company.payment.internal.CreditCardPayment",
  "cardToken": "tok_123"
}
```

Kenapa buruk?

- membocorkan internal class name
- payload tergantung package Java
- refactor class/package menjadi breaking change eksternal
- membuka surface security lebih luas
- membuat contract tidak portable untuk non-Java consumer

---

## 11. Jackson `@JsonTypeInfo` dan `@JsonSubTypes`

Jackson menyediakan annotation untuk polymorphic type handling.

Contoh:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "paymentType"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = CreditCardPayment.class, name = "CREDIT_CARD"),
    @JsonSubTypes.Type(value = BankTransferPayment.class, name = "BANK_TRANSFER")
})
public interface PaymentMethod {
}
```

Subtype:

```java
public class CreditCardPayment implements PaymentMethod {
    private String cardToken;

    public String getCardToken() {
        return cardToken;
    }

    public void setCardToken(String cardToken) {
        this.cardToken = cardToken;
    }
}
```

```java
public class BankTransferPayment implements PaymentMethod {
    private String bankCode;
    private String accountNumber;

    public String getBankCode() {
        return bankCode;
    }

    public void setBankCode(String bankCode) {
        this.bankCode = bankCode;
    }

    public String getAccountNumber() {
        return accountNumber;
    }

    public void setAccountNumber(String accountNumber) {
        this.accountNumber = accountNumber;
    }
}
```

JSON:

```json
{
  "paymentType": "CREDIT_CARD",
  "cardToken": "tok_123"
}
```

Sekarang Jackson bisa memilih `CreditCardPayment`.

### 11.1 `Id.NAME` vs `Id.CLASS`

Gunakan:

```java
use = JsonTypeInfo.Id.NAME
```

Jangan gunakan untuk public/untrusted payload:

```java
use = JsonTypeInfo.Id.CLASS
```

`Id.CLASS` memasukkan nama class Java ke JSON, misalnya:

```json
{
  "@class": "com.company.payment.CreditCardPayment",
  "cardToken": "tok_123"
}
```

Ini buruk untuk kontrak eksternal dan berbahaya jika digunakan dengan input tidak dipercaya.

Rule of thumb:

```text
External/untrusted JSON:
    prefer Id.NAME + allowlisted subtype names

Internal trusted snapshot/cache only:
    still be careful; avoid Id.CLASS unless sangat terkontrol
```

---

## 12. `@JsonTypeName` untuk Mendekatkan Nama Subtype ke Class

Alih-alih mendaftarkan name di base type, subtype bisa diberi nama:

```java
@JsonTypeName("CREDIT_CARD")
public class CreditCardPayment implements PaymentMethod {
    private String cardToken;
    // getters/setters
}
```

Base type:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "paymentType"
)
@JsonSubTypes({
    @JsonSubTypes.Type(CreditCardPayment.class),
    @JsonSubTypes.Type(BankTransferPayment.class)
})
public interface PaymentMethod {
}
```

Trade-off:

- `@JsonTypeName` membuat subtype tahu nama contract-nya
- `@JsonSubTypes` di base type membuat base type tahu semua subtype
- untuk library/domain yang ingin bebas Jackson annotation, gunakan module registration atau custom deserializer

---

## 13. Include Strategy: PROPERTY, WRAPPER_OBJECT, EXTERNAL_PROPERTY

Jackson punya beberapa cara memasukkan type metadata.

### 13.1 `As.PROPERTY`

JSON:

```json
{
  "paymentType": "CREDIT_CARD",
  "cardToken": "tok_123"
}
```

Annotation:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "paymentType"
)
```

Ini biasanya paling mudah untuk API publik.

### 13.2 `As.WRAPPER_OBJECT`

JSON:

```json
{
  "CREDIT_CARD": {
    "cardToken": "tok_123"
  }
}
```

Annotation:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.WRAPPER_OBJECT
)
```

Kelebihan:

- type terlihat sebagai wrapper
- bisa menghindari collision dengan field biasa

Kekurangan:

- kurang natural untuk banyak REST JSON
- client harus menangani dynamic property name

### 13.3 `As.EXTERNAL_PROPERTY`

JSON:

```json
{
  "paymentType": "CREDIT_CARD",
  "payment": {
    "cardToken": "tok_123"
  }
}
```

Model:

```java
public class PaymentRequest {
    private String paymentType;

    @JsonTypeInfo(
        use = JsonTypeInfo.Id.NAME,
        include = JsonTypeInfo.As.EXTERNAL_PROPERTY,
        property = "paymentType"
    )
    @JsonSubTypes({
        @JsonSubTypes.Type(value = CreditCardPayment.class, name = "CREDIT_CARD"),
        @JsonSubTypes.Type(value = BankTransferPayment.class, name = "BANK_TRANSFER")
    })
    private PaymentMethod payment;

    // getters/setters
}
```

Ini berguna jika discriminator berada di level parent, bukan di dalam object polymorphic.

Trade-off:

- lebih cocok untuk envelope-style payload
- lebih rumit untuk maintain
- error lebih sulit didiagnosis jika property order/structure tidak sesuai ekspektasi

---

## 14. Visible Discriminator: `visible = true`

Kadang subtype juga butuh membaca discriminator sebagai field biasa.

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "paymentType",
    visible = true
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = CreditCardPayment.class, name = "CREDIT_CARD")
})
public interface PaymentMethod {
}
```

Subtype:

```java
public class CreditCardPayment implements PaymentMethod {
    private String paymentType;
    private String cardToken;

    public String getPaymentType() {
        return paymentType;
    }

    public void setPaymentType(String paymentType) {
        this.paymentType = paymentType;
    }

    public String getCardToken() {
        return cardToken;
    }

    public void setCardToken(String cardToken) {
        this.cardToken = cardToken;
    }
}
```

Gunakan ini dengan hati-hati. Sering kali discriminator cukup untuk framework, bukan untuk domain model.

Jika domain butuh type, lebih baik expose method stabil:

```java
public interface PaymentMethod {
    PaymentType paymentType();
}
```

---

## 15. Polymorphism di DTO vs Domain Model

Pertanyaan penting:

> Apakah annotation Jackson polymorphism harus diletakkan di domain interface?

Jawaban realistis: tergantung boundary.

### 15.1 Domain Diberi Jackson Annotation

Contoh:

```java
@JsonTypeInfo(...)
public sealed interface PaymentInstruction permits BankTransfer, CreditCard {
}
```

Kelebihan:

- simple
- sedikit class tambahan
- cocok untuk aplikasi kecil/internal

Kekurangan:

- domain tercemar detail JSON
- domain contract tergantung Jackson
- sulit punya format berbeda untuk API/event/cache
- refactor domain bisa breaking JSON

### 15.2 DTO Polymorphic, Domain Bersih

API DTO:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = BankTransferPaymentDto.class, name = "BANK_TRANSFER"),
    @JsonSubTypes.Type(value = CreditCardPaymentDto.class, name = "CREDIT_CARD")
})
public sealed interface PaymentDto
    permits BankTransferPaymentDto, CreditCardPaymentDto {
}
```

Domain:

```java
public sealed interface PaymentInstruction
    permits BankTransferInstruction, CreditCardInstruction {
}
```

Mapper:

```java
public PaymentInstruction toDomain(PaymentDto dto) {
    if (dto instanceof BankTransferPaymentDto bank) {
        return new BankTransferInstruction(bank.bankCode(), bank.accountNumber());
    }
    if (dto instanceof CreditCardPaymentDto card) {
        return new CreditCardInstruction(card.cardToken());
    }
    throw new IllegalArgumentException("Unsupported payment DTO: " + dto.getClass().getName());
}
```

Kelebihan:

- domain bebas dari Jackson
- API shape bisa berubah tanpa mengubah domain
- security dan validation lebih mudah dipasang di boundary
- external contract tidak sama dengan internal model

Kekurangan:

- class lebih banyak
- mapping eksplisit perlu ditulis/ditest

Untuk sistem enterprise/regulatory, pendekatan kedua biasanya lebih defensible.

---

## 16. Sealed Classes dan Sealed Interfaces di Java Modern

Java modern mendukung sealed hierarchy:

```java
public sealed interface PaymentDto
    permits BankTransferPaymentDto, CreditCardPaymentDto {
}

public record BankTransferPaymentDto(
    String bankCode,
    String accountNumber
) implements PaymentDto {
}

public record CreditCardPaymentDto(
    String cardToken
) implements PaymentDto {
}
```

Sealed type memberi compiler informasi bahwa subtype yang valid terbatas.

Manfaat untuk mapping:

- subtype set eksplisit
- switch/pattern matching bisa lebih aman pada Java modern
- domain model lebih jelas
- unknown subtype lebih mudah dideteksi di compile-time
- cocok dengan discriminator allowlist

Namun Jackson tetap perlu tahu cara memilih subtype dari JSON. Sealed hierarchy tidak otomatis cukup untuk inbound polymorphic JSON di semua konfigurasi/versi.

Kita tetap perlu desain discriminator atau custom resolver.

---

## 17. Sealed DTO dengan Jackson Annotation

Contoh DTO modern:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = BankTransferPaymentDto.class, name = "BANK_TRANSFER"),
    @JsonSubTypes.Type(value = CreditCardPaymentDto.class, name = "CREDIT_CARD")
})
public sealed interface PaymentDto
    permits BankTransferPaymentDto, CreditCardPaymentDto {
}
```

Record subtype:

```java
public record BankTransferPaymentDto(
    String bankCode,
    String accountNumber
) implements PaymentDto {
}
```

```java
public record CreditCardPaymentDto(
    String cardToken
) implements PaymentDto {
}
```

JSON:

```json
{
  "type": "BANK_TRANSFER",
  "bankCode": "DBS",
  "accountNumber": "123456789"
}
```

Deserialize:

```java
PaymentDto dto = objectMapper.readValue(json, PaymentDto.class);
```

### 17.1 Java 8 Alternative

Java 8 belum punya records/sealed classes.

Gunakan interface/abstract class biasa:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = BankTransferPaymentDto.class, name = "BANK_TRANSFER"),
    @JsonSubTypes.Type(value = CreditCardPaymentDto.class, name = "CREDIT_CARD")
})
public interface PaymentDto {
}
```

Subtype:

```java
public final class BankTransferPaymentDto implements PaymentDto {
    private String bankCode;
    private String accountNumber;

    public String getBankCode() {
        return bankCode;
    }

    public void setBankCode(String bankCode) {
        this.bankCode = bankCode;
    }

    public String getAccountNumber() {
        return accountNumber;
    }

    public void setAccountNumber(String accountNumber) {
        this.accountNumber = accountNumber;
    }
}
```

Walaupun Java 8 tidak punya sealed, kita tetap bisa menjaga subtype set lewat convention, package-private constructor, module boundary, dan test.

---

## 18. Discriminator Design untuk API dan Event

Discriminator bukan detail teknis kecil. Ia adalah bagian dari contract.

Contoh event:

```json
{
  "eventType": "CASE_APPROVED",
  "eventVersion": 2,
  "payload": {
    "caseId": "CASE-001",
    "approvedBy": "user-123",
    "approvedAt": "2026-06-17T10:15:30Z"
  }
}
```

Ada dua desain umum.

### 18.1 Type Field di Dalam Payload

```json
{
  "type": "CASE_APPROVED",
  "caseId": "CASE-001",
  "approvedBy": "user-123"
}
```

Kelebihan:

- payload self-describing
- mudah deserialisasi langsung ke base type
- cocok untuk single object polymorphism

Kekurangan:

- metadata event bercampur dengan payload bisnis
- sulit memisahkan envelope concern
- jika payload dipakai ulang di konteks lain, field `type` bisa mengganggu

### 18.2 Type Field di Envelope

```json
{
  "type": "CASE_APPROVED",
  "payload": {
    "caseId": "CASE-001",
    "approvedBy": "user-123"
  }
}
```

Kelebihan:

- metadata dan payload terpisah
- cocok untuk messaging/event bus
- routing bisa dilakukan tanpa membaca penuh payload
- payload class bisa dipilih lewat registry

Kekurangan:

- butuh dua tahap deserialization
- tidak bisa langsung `readValue(payload, BaseType.class)` tanpa context

Untuk event-driven systems, envelope-style biasanya lebih sehat.

---

## 19. Unknown Subtype: Fail Fast atau Tolerant Reader?

Jika menerima discriminator tidak dikenal:

```json
{
  "type": "CRYPTO_PAYMENT",
  "walletAddress": "..."
}
```

Apa yang harus dilakukan?

Jawabannya tergantung boundary.

### 19.1 External Command/API Input

Untuk command inbound yang mengubah state, biasanya **fail fast**.

Alasannya:

- unknown type tidak bisa diproses dengan benar
- menerima diam-diam bisa menyebabkan data loss
- client harus tahu bahwa request invalid

Response misalnya:

```json
{
  "errorCode": "UNSUPPORTED_PAYMENT_TYPE",
  "message": "Unsupported payment type: CRYPTO_PAYMENT",
  "field": "type"
}
```

### 19.2 Event Consumer

Untuk event consumer, pilihan lebih nuanced.

Jika event baru muncul dan service lama belum mendukung:

- bisa fail dan masuk DLQ
- bisa skip dengan audit log
- bisa parkir event untuk replay
- bisa tolerant read jika event tidak relevan

Decision matrix:

| Boundary | Unknown subtype strategy | Reason |
|---|---|---|
| Public command API | reject | input harus diketahui |
| Admin API | reject | correctness lebih penting |
| Internal query response | reject atau ignore | tergantung compatibility |
| Event consumer critical | DLQ/park | jangan silent loss |
| Event consumer optional | skip with audit | jika event tidak relevan |
| Analytics pipeline | capture raw | schema evolution butuh observability |

Top-level rule:

```text
Unknown subtype tidak boleh hilang tanpa jejak.
```

---

## 20. Security: Jangan Aktifkan Default Typing Sembarangan

Jackson pernah dikenal memiliki risiko serius terkait polymorphic deserialization jika type information terlalu bebas dan input tidak dipercaya.

Konsep bahayanya:

```text
Jika JSON boleh menentukan class Java arbitrary,
attacker bisa mencoba membuat object dari class yang tidak seharusnya dibuat.
```

Contoh bentuk berbahaya secara konsep:

```json
{
  "@class": "some.dangerous.Class",
  "property": "value"
}
```

Masalah utama bukan hanya satu class tertentu. Masalahnya adalah desain:

```text
External JSON controls internal Java class selection.
```

Itu boundary violation.

### 20.1 Avoid

Hindari untuk untrusted input:

```java
objectMapper.activateDefaultTyping(...)
```

terutama jika memungkinkan class name masuk dari JSON.

### 20.2 Prefer

Gunakan:

- `JsonTypeInfo.Id.NAME`
- subtype allowlist eksplisit
- event type registry eksplisit
- DTO boundary, bukan domain arbitrary
- fail on unknown subtype
- custom deserializer untuk contract sulit

Desain aman:

```text
JSON type = stable logical name
Server maps logical name → allowed Java class
Unknown name rejected/parked
Java class name never accepted from external payload
```

---

## 21. Polymorphic Deserialization dengan Custom Deserializer

Annotation cocok untuk kasus sederhana. Tetapi pada contract kompleks, custom deserializer lebih jelas.

Contoh JSON:

```json
{
  "payment": {
    "method": "BANK_TRANSFER",
    "details": {
      "bankCode": "DBS",
      "accountNumber": "123456789"
    }
  }
}
```

Kita ingin `details` dipilih berdasarkan `method`.

Model:

```java
public class PaymentRequest {
    private PaymentDetails payment;

    public PaymentDetails getPayment() {
        return payment;
    }

    public void setPayment(PaymentDetails payment) {
        this.payment = payment;
    }
}
```

Base:

```java
@JsonDeserialize(using = PaymentDetailsDeserializer.class)
public interface PaymentDetails {
}
```

Subtype:

```java
public class BankTransferDetails implements PaymentDetails {
    private String bankCode;
    private String accountNumber;
    // getters/setters
}
```

Deserializer:

```java
public class PaymentDetailsDeserializer extends JsonDeserializer<PaymentDetails> {

    @Override
    public PaymentDetails deserialize(JsonParser parser, DeserializationContext context)
            throws IOException {

        ObjectCodec codec = parser.getCodec();
        JsonNode root = codec.readTree(parser);

        JsonNode methodNode = root.get("method");
        JsonNode detailsNode = root.get("details");

        if (methodNode == null || methodNode.isNull()) {
            throw JsonMappingException.from(parser, "Missing payment.method");
        }

        if (detailsNode == null || detailsNode.isNull()) {
            throw JsonMappingException.from(parser, "Missing payment.details");
        }

        String method = methodNode.asText();

        switch (method) {
            case "BANK_TRANSFER":
                return codec.treeToValue(detailsNode, BankTransferDetails.class);
            case "CREDIT_CARD":
                return codec.treeToValue(detailsNode, CreditCardDetails.class);
            default:
                throw JsonMappingException.from(parser, "Unsupported payment.method: " + method);
        }
    }
}
```

Kelebihan custom deserializer:

- logic subtype selection eksplisit
- error bisa lebih baik
- tidak perlu memaksa JSON shape mengikuti `@JsonTypeInfo`
- cocok untuk legacy/external contract

Kekurangan:

- lebih banyak kode
- perlu test negatif lebih lengkap
- bisa menjadi mini business logic jika tidak disiplin

---

## 22. Polymorphic Serialization: Jangan Hanya Pikirkan Inbound

Jika kita serialize base type:

```java
PaymentDto dto = new CreditCardPaymentDto("tok_123");
String json = objectMapper.writeValueAsString(dto);
```

Jackson perlu tahu apakah type metadata harus ditulis.

Dengan annotation `@JsonTypeInfo`, output bisa menjadi:

```json
{
  "type": "CREDIT_CARD",
  "cardToken": "tok_123"
}
```

Masalah umum:

```java
CreditCardPaymentDto dto = new CreditCardPaymentDto("tok_123");
String json = objectMapper.writeValueAsString(dto);
```

Jika variable static type adalah concrete class, beberapa konfigurasi polymorphic metadata bisa berbeda dibanding saat static type base interface.

Agar konsisten, gunakan `ObjectWriter` dengan target type:

```java
ObjectWriter writer = objectMapper.writerFor(PaymentDto.class);
String json = writer.writeValueAsString(dto);
```

Mental model:

```text
Serialization polymorphism dipengaruhi oleh runtime type dan declared/static target type.
```

Untuk contract testing, jangan hanya test concrete class serialization. Test juga melalui base type.

---

## 23. Generic + Polymorphic: Kombinasi yang Sering Menjebak

Contoh:

```java
public class ApiResponse<T> {
    private T data;
    // getters/setters
}
```

Payload:

```json
{
  "data": {
    "type": "CREDIT_CARD",
    "cardToken": "tok_123"
  }
}
```

Target:

```java
ApiResponse<PaymentDto>
```

Deserialization:

```java
ApiResponse<PaymentDto> response = objectMapper.readValue(
    json,
    new TypeReference<ApiResponse<PaymentDto>>() {}
);
```

Jackson harus tahu dua hal sekaligus:

1. `data` adalah `PaymentDto`, bukan `Object`
2. `PaymentDto` adalah polymorphic base type yang memakai discriminator

Jika dibaca sebagai raw `ApiResponse.class`, `data` menjadi `LinkedHashMap` dan polymorphism tidak berjalan.

Rule:

```text
Generic wrapper yang membawa polymorphic payload harus selalu dibaca dengan full generic type.
```

---

## 24. Collection of Polymorphic Objects

JSON:

```json
[
  {
    "type": "BANK_TRANSFER",
    "bankCode": "DBS",
    "accountNumber": "123456789"
  },
  {
    "type": "CREDIT_CARD",
    "cardToken": "tok_123"
  }
]
```

Target:

```java
List<PaymentDto>
```

Deserialization:

```java
List<PaymentDto> payments = objectMapper.readValue(
    json,
    new TypeReference<List<PaymentDto>>() {}
);
```

Kalau pakai:

```java
objectMapper.readValue(json, List.class)
```

maka polymorphism tidak akan berjalan karena Jackson tidak tahu elemen list adalah `PaymentDto`.

Untuk runtime dynamic:

```java
JavaType paymentListType = objectMapper.getTypeFactory()
    .constructCollectionType(List.class, PaymentDto.class);

List<PaymentDto> payments = objectMapper.readValue(json, paymentListType);
```

---

## 25. Map dengan Polymorphic Values

JSON:

```json
{
  "primary": {
    "type": "BANK_TRANSFER",
    "bankCode": "DBS",
    "accountNumber": "123456789"
  },
  "fallback": {
    "type": "CREDIT_CARD",
    "cardToken": "tok_123"
  }
}
```

Target:

```java
Map<String, PaymentDto>
```

Deserialization:

```java
Map<String, PaymentDto> methods = objectMapper.readValue(
    json,
    new TypeReference<Map<String, PaymentDto>>() {}
);
```

atau:

```java
JavaType mapType = objectMapper.getTypeFactory()
    .constructMapType(Map.class, String.class, PaymentDto.class);

Map<String, PaymentDto> methods = objectMapper.readValue(json, mapType);
```

---

## 26. Abstract Classes vs Interfaces

Jackson polymorphism bisa digunakan pada abstract class maupun interface.

Interface:

```java
public interface NotificationTarget {
}
```

Abstract class:

```java
public abstract class NotificationTarget {
    private String label;

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }
}
```

Perbedaan desain:

| Aspek | Interface | Abstract class |
|---|---|---|
| Shared state | Tidak langsung | Bisa punya field |
| Multiple inheritance | Bisa implement banyak interface | Single class inheritance |
| DTO modern | Cocok dengan records/sealed interface | Cocok jika ada shared fields |
| Jackson annotation | Bisa | Bisa |
| Domain purity | Umumnya lebih bersih | Bisa membawa state/logic |

Untuk DTO polymorphic modern, sealed interface + records sering lebih ringan dan eksplisit.

Untuk Java 8, interface + final classes cukup baik.

---

## 27. Polymorphic Enum Alternative: Kadang Tidak Perlu Subclass

Tidak semua variasi butuh subtype.

Misalnya:

```json
{
  "notificationType": "EMAIL",
  "recipient": "user@example.com",
  "subject": "Welcome",
  "body": "..."
}
```

Bisa saja dibuat polymorphic:

```java
interface NotificationRequest {}
class EmailNotificationRequest implements NotificationRequest {}
class SmsNotificationRequest implements NotificationRequest {}
```

Tetapi jika field-nya hampir sama dan behavior tidak berbeda signifikan, enum biasa mungkin cukup:

```java
public class NotificationRequest {
    private NotificationType notificationType;
    private String recipient;
    private String subject;
    private String body;
}
```

Gunakan polymorphism jika:

- field per subtype berbeda signifikan
- validation per subtype berbeda
- processing path berbeda
- subtype set punya semantic meaning kuat
- subtype evolution perlu dikontrol

Jangan gunakan polymorphism hanya karena ada field `type`.

---

## 28. Anti-Pattern: One Giant Polymorphic DTO

Contoh buruk:

```java
public class ActionRequest {
    private String actionType;
    private String caseId;
    private String comment;
    private String approvalReason;
    private String rejectionReason;
    private String assignmentUserId;
    private LocalDate dueDate;
    private BigDecimal amount;
    private String documentId;
    // 40 fields for all action types
}
```

Masalah:

- banyak field hanya valid untuk action tertentu
- validation penuh `if actionType == ...`
- client bingung field mana wajib
- OpenAPI menjadi tidak akurat
- mapper dipenuhi branching
- over-posting risk tinggi
- backward compatibility sulit

Lebih baik:

```java
public sealed interface CaseActionRequest
    permits ApproveCaseRequest, RejectCaseRequest, AssignCaseRequest {
}

public record ApproveCaseRequest(
    String caseId,
    String approvalReason
) implements CaseActionRequest {
}

public record RejectCaseRequest(
    String caseId,
    String rejectionReason
) implements CaseActionRequest {
}

public record AssignCaseRequest(
    String caseId,
    String assignmentUserId,
    LocalDate dueDate
) implements CaseActionRequest {
}
```

JSON:

```json
{
  "actionType": "APPROVE",
  "caseId": "CASE-001",
  "approvalReason": "Compliant"
}
```

Subtypes membuat contract lebih jujur.

---

## 29. Anti-Pattern: Subtype Explosion

Sebaliknya, terlalu banyak subtype juga buruk.

Contoh:

```text
EmailNotificationForAdmin
EmailNotificationForCustomer
EmailNotificationForAgent
EmailNotificationForSupervisor
SmsNotificationForAdmin
SmsNotificationForCustomer
...
```

Jika perbedaannya hanya recipient role atau template code, polymorphism bukan solusi.

Lebih baik:

```java
public record NotificationRequest(
    NotificationChannel channel,
    RecipientType recipientType,
    String templateCode,
    Map<String, String> parameters
) {
}
```

Gunakan subtype untuk perbedaan **shape/behavior**, bukan untuk setiap kombinasi data.

---

## 30. Designing a Type Registry

Untuk event/integration system, registry eksplisit sering lebih scalable daripada annotation di base interface.

```java
public final class PayloadTypeRegistry {
    private final Map<String, JavaType> types;

    public PayloadTypeRegistry(ObjectMapper objectMapper) {
        TypeFactory typeFactory = objectMapper.getTypeFactory();

        Map<String, JavaType> map = new HashMap<>();
        map.put("CASE_CREATED", typeFactory.constructType(CaseCreatedPayload.class));
        map.put("CASE_APPROVED", typeFactory.constructType(CaseApprovedPayload.class));
        map.put("CASE_REJECTED", typeFactory.constructType(CaseRejectedPayload.class));

        this.types = Map.copyOf(map);
    }

    public JavaType resolve(String type) {
        JavaType javaType = types.get(type);
        if (javaType == null) {
            throw new UnknownPayloadTypeException(type);
        }
        return javaType;
    }
}
```

Decoder:

```java
public final class EventDecoder {
    private final ObjectMapper objectMapper;
    private final PayloadTypeRegistry registry;

    public EventDecoder(ObjectMapper objectMapper, PayloadTypeRegistry registry) {
        this.objectMapper = objectMapper;
        this.registry = registry;
    }

    public EventEnvelope<?> decode(String json) {
        try {
            EventEnvelopeRaw raw = objectMapper.readValue(json, EventEnvelopeRaw.class);
            JavaType payloadType = registry.resolve(raw.getType());
            Object payload = objectMapper.convertValue(raw.getPayload(), payloadType);

            return new EventEnvelope<>(
                raw.getId(),
                raw.getType(),
                raw.getVersion(),
                raw.getOccurredAt(),
                payload
            );
        } catch (UnknownPayloadTypeException e) {
            throw e;
        } catch (IllegalArgumentException | IOException e) {
            throw new EventDecodeException("Failed to decode event", e);
        }
    }
}
```

Raw envelope:

```java
public class EventEnvelopeRaw {
    private String id;
    private String type;
    private int version;
    private Instant occurredAt;
    private JsonNode payload;

    // getters/setters
}
```

### 30.1 Registry sebagai Governance Point

Registry menjadi tempat yang jelas untuk:

- subtype allowlist
- version mapping
- deprecation policy
- compatibility rule
- documentation generation
- test coverage
- audit of supported message types

Ini jauh lebih governance-friendly daripada type metadata arbitrary.

---

## 31. Versioned Polymorphic Payload

Dalam enterprise systems, type saja sering tidak cukup. Butuh version.

```json
{
  "type": "CASE_APPROVED",
  "version": 2,
  "payload": {
    "caseId": "CASE-001",
    "approvedBy": "user-123",
    "approvalCategory": "STANDARD"
  }
}
```

Registry bisa memakai composite key:

```java
public record PayloadKey(String type, int version) {
}
```

Registry:

```java
public final class VersionedPayloadRegistry {
    private final Map<PayloadKey, JavaType> types;

    public JavaType resolve(String type, int version) {
        JavaType javaType = types.get(new PayloadKey(type, version));
        if (javaType == null) {
            throw new UnknownPayloadVersionException(type, version);
        }
        return javaType;
    }
}
```

Payload classes:

```java
public record CaseApprovedPayloadV1(
    String caseId,
    String approvedBy
) {
}

public record CaseApprovedPayloadV2(
    String caseId,
    String approvedBy,
    String approvalCategory
) {
}
```

### 31.1 Alternative: One Class with Compatibility Fields

Untuk additive changes, satu class bisa cukup:

```java
public record CaseApprovedPayload(
    String caseId,
    String approvedBy,
    String approvalCategory
) {
}
```

Jika `approvalCategory` optional untuk V1, mapper bisa default.

Tapi jika semantics berubah besar, pisahkan V1/V2.

Rule:

```text
Additive optional change:
    same class may be okay

Semantic breaking change:
    separate versioned payload class
```

---

## 32. Generic Event Envelope dengan Typed Payload

Target runtime:

```java
public final class EventEnvelope<T> {
    private final String id;
    private final String type;
    private final int version;
    private final Instant occurredAt;
    private final T payload;

    public EventEnvelope(String id, String type, int version, Instant occurredAt, T payload) {
        this.id = id;
        this.type = type;
        this.version = version;
        this.occurredAt = occurredAt;
        this.payload = payload;
    }

    public String getId() {
        return id;
    }

    public String getType() {
        return type;
    }

    public int getVersion() {
        return version;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }

    public T getPayload() {
        return payload;
    }
}
```

Untuk known payload type:

```java
JavaType envelopeType = objectMapper.getTypeFactory()
    .constructParametricType(EventEnvelope.class, CaseApprovedPayload.class);

EventEnvelope<CaseApprovedPayload> envelope = objectMapper.readValue(json, envelopeType);
```

Namun untuk event stream heterogeneous, satu consumer menerima banyak type. Maka raw envelope + registry lebih praktis.

```text
Known endpoint returning one event type:
    EventEnvelope<T> with JavaType

Heterogeneous event stream:
    Raw envelope + registry + payload decode
```

---

## 33. Type Id as Business Concept, Not Class Concept

Polymorphic type id harus merepresentasikan contract/business concept.

Buruk:

```json
{
  "type": "CreditCardPaymentDto"
}
```

Lebih baik:

```json
{
  "type": "CREDIT_CARD"
}
```

Buruk:

```json
{
  "eventClass": "CaseApprovedPayloadV2"
}
```

Lebih baik:

```json
{
  "eventType": "CASE_APPROVED",
  "eventVersion": 2
}
```

Alasannya:

- class name adalah implementation detail
- business concept lebih stabil
- non-Java consumer lebih mudah memahami
- contract review lebih mudah
- schema/versioning lebih bersih

---

## 34. Sealed Hierarchy Exhaustiveness and Mapper Safety

Dengan sealed types, Java modern memungkinkan pattern matching yang lebih aman.

Contoh konseptual:

```java
public PaymentCommand toCommand(PaymentDto dto) {
    return switch (dto) {
        case BankTransferPaymentDto bank -> new BankTransferCommand(
            bank.bankCode(),
            bank.accountNumber()
        );
        case CreditCardPaymentDto card -> new CreditCardCommand(
            card.cardToken()
        );
    };
}
```

Manfaat:

- jika subtype baru ditambahkan, compiler bisa membantu menemukan switch yang belum lengkap
- mapper menjadi governance point
- logic subtype tidak tersebar di banyak `if instanceof`

Untuk Java 8:

```java
public PaymentCommand toCommand(PaymentDto dto) {
    if (dto instanceof BankTransferPaymentDto) {
        BankTransferPaymentDto bank = (BankTransferPaymentDto) dto;
        return new BankTransferCommand(bank.getBankCode(), bank.getAccountNumber());
    }
    if (dto instanceof CreditCardPaymentDto) {
        CreditCardPaymentDto card = (CreditCardPaymentDto) dto;
        return new CreditCardCommand(card.getCardToken());
    }
    throw new IllegalArgumentException("Unsupported payment DTO: " + dto.getClass().getName());
}
```

Tambahkan test agar semua subtype ter-cover.

---

## 35. Testing Generic Type Handling

Test untuk generic deserialization harus memastikan hasil bukan `LinkedHashMap`.

Contoh JUnit:

```java
@Test
void shouldDeserializeListOfOrderDto() throws Exception {
    String json = """
        [
          { "id": "O-001", "status": "SUBMITTED" }
        ]
        """;

    List<OrderDto> result = objectMapper.readValue(
        json,
        new TypeReference<List<OrderDto>>() {}
    );

    assertThat(result).hasSize(1);
    assertThat(result.get(0)).isInstanceOf(OrderDto.class);
    assertThat(result.get(0).getId()).isEqualTo("O-001");
}
```

Negative test:

```java
@Test
void rawListShouldNotBeUsedForDtoList() throws Exception {
    String json = """
        [
          { "id": "O-001", "status": "SUBMITTED" }
        ]
        """;

    List<?> result = objectMapper.readValue(json, List.class);

    assertThat(result.get(0)).isInstanceOf(Map.class);
}
```

Test negatif ini bukan untuk production behavior, tetapi untuk mendidik tim bahwa raw class bukan typed list.

---

## 36. Testing Polymorphic Deserialization

Happy path:

```java
@Test
void shouldDeserializeCreditCardPayment() throws Exception {
    String json = """
        {
          "type": "CREDIT_CARD",
          "cardToken": "tok_123"
        }
        """;

    PaymentDto dto = objectMapper.readValue(json, PaymentDto.class);

    assertThat(dto).isInstanceOf(CreditCardPaymentDto.class);
    CreditCardPaymentDto card = (CreditCardPaymentDto) dto;
    assertThat(card.cardToken()).isEqualTo("tok_123");
}
```

Unknown type:

```java
@Test
void shouldRejectUnknownPaymentType() {
    String json = """
        {
          "type": "CRYPTO",
          "walletAddress": "abc"
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, PaymentDto.class))
        .isInstanceOf(JsonMappingException.class);
}
```

Missing discriminator:

```java
@Test
void shouldRejectMissingType() {
    String json = """
        {
          "cardToken": "tok_123"
        }
        """;

    assertThatThrownBy(() -> objectMapper.readValue(json, PaymentDto.class))
        .isInstanceOf(JsonMappingException.class);
}
```

Collection:

```java
@Test
void shouldDeserializeListOfPolymorphicPayments() throws Exception {
    String json = """
        [
          { "type": "CREDIT_CARD", "cardToken": "tok_123" },
          { "type": "BANK_TRANSFER", "bankCode": "DBS", "accountNumber": "123" }
        ]
        """;

    List<PaymentDto> payments = objectMapper.readValue(
        json,
        new TypeReference<List<PaymentDto>>() {}
    );

    assertThat(payments.get(0)).isInstanceOf(CreditCardPaymentDto.class);
    assertThat(payments.get(1)).isInstanceOf(BankTransferPaymentDto.class);
}
```

---

## 37. Testing Polymorphic Serialization

Test melalui base type:

```java
@Test
void shouldSerializePaymentWithTypeDiscriminator() throws Exception {
    PaymentDto dto = new CreditCardPaymentDto("tok_123");

    String json = objectMapper
        .writerFor(PaymentDto.class)
        .writeValueAsString(dto);

    assertThatJson(json).node("type").isEqualTo("CREDIT_CARD");
    assertThatJson(json).node("cardToken").isEqualTo("tok_123");
}
```

Test round-trip:

```java
@Test
void shouldRoundTripPolymorphicPayment() throws Exception {
    PaymentDto input = new CreditCardPaymentDto("tok_123");

    String json = objectMapper
        .writerFor(PaymentDto.class)
        .writeValueAsString(input);

    PaymentDto output = objectMapper.readValue(json, PaymentDto.class);

    assertThat(output).isEqualTo(input);
}
```

Round-trip test berguna, tetapi jangan hanya mengandalkan round-trip. Kenapa?

Karena round-trip bisa lulus walaupun JSON contract tidak sesuai ekspektasi external consumer.

Tetap butuh golden payload test.

---

## 38. Golden Payload untuk Polymorphism

Golden payload adalah contoh JSON yang dianggap contract resmi.

Contoh file:

`src/test/resources/contracts/payment/credit-card-payment.v1.json`

```json
{
  "type": "CREDIT_CARD",
  "cardToken": "tok_123"
}
```

Test:

```java
@Test
void shouldReadGoldenCreditCardPaymentPayload() throws Exception {
    String json = readResource("contracts/payment/credit-card-payment.v1.json");

    PaymentDto dto = objectMapper.readValue(json, PaymentDto.class);

    assertThat(dto).isInstanceOf(CreditCardPaymentDto.class);
}
```

Serialization test:

```java
@Test
void shouldWriteGoldenCreditCardPaymentPayload() throws Exception {
    PaymentDto dto = new CreditCardPaymentDto("tok_123");

    String actual = objectMapper
        .writerFor(PaymentDto.class)
        .writeValueAsString(dto);

    assertJsonSemanticallyEquals(
        readResource("contracts/payment/credit-card-payment.v1.json"),
        actual
    );
}
```

Golden payload mencegah perubahan tidak sengaja seperti:

- `type` berubah menjadi `paymentType`
- `CREDIT_CARD` berubah menjadi `CreditCardPaymentDto`
- field tambahan bocor
- null field muncul/hilang tanpa review

---

## 39. Schema and OpenAPI Alignment

Polymorphism harus terdokumentasi di OpenAPI/JSON Schema.

Konsep yang perlu muncul:

```yaml
oneOf:
  - $ref: '#/components/schemas/CreditCardPayment'
  - $ref: '#/components/schemas/BankTransferPayment'
discriminator:
  propertyName: type
  mapping:
    CREDIT_CARD: '#/components/schemas/CreditCardPayment'
    BANK_TRANSFER: '#/components/schemas/BankTransferPayment'
```

Hal yang harus disinkronkan:

| Runtime Jackson | OpenAPI/Schema |
|---|---|
| `property = "type"` | `discriminator.propertyName: type` |
| subtype name `CREDIT_CARD` | discriminator mapping `CREDIT_CARD` |
| required fields per subtype | schema required per subtype |
| unknown type rejected | schema enum/mapping terbatas |
| nullable field behavior | nullable/required akurat |

Jika runtime dan OpenAPI beda, client akan gagal walaupun server test hijau.

---

## 40. Type Resolution in Spring Controllers

Spring MVC/WebFlux biasanya menggunakan Jackson di balik layar.

Endpoint:

```java
@PostMapping("/payments")
public ResponseEntity<?> createPayment(@RequestBody PaymentDto request) {
    // request already deserialized polymorphically
    return ResponseEntity.ok().build();
}
```

Jika `PaymentDto` punya annotation polymorphic yang benar, Spring bisa bind subtype.

Untuk generic wrapper:

```java
@PostMapping("/commands")
public ResponseEntity<?> submit(@RequestBody CommandEnvelope<CreateCaseCommand> command) {
    return ResponseEntity.ok().build();
}
```

Spring dapat membaca generic signature dari method parameter. Ini berbeda dengan manual `objectMapper.readValue(json, CommandEnvelope.class)`.

Namun jangan terlalu mengandalkan magic. Test controller contract tetap perlu.

### 40.1 Generic Controller Pitfall

Jika membuat base controller generic:

```java
public abstract class BaseCommandController<T> {

    @PostMapping
    public ResponseEntity<?> submit(@RequestBody CommandEnvelope<T> command) {
        // ...
    }
}
```

Tergantung framework metadata, generic `T` bisa tidak terselesaikan jelas. Hati-hati dengan abstract generic controller yang mengandalkan runtime type inference.

Lebih aman jika endpoint concrete memiliki parameter jelas:

```java
@PostMapping("/cases")
public ResponseEntity<?> createCase(@RequestBody CommandEnvelope<CreateCaseCommand> command) {
    // ...
}
```

---

## 41. Type Handling di Messaging Consumer

Messaging consumer sering menerima `String` atau `byte[]`.

```java
public void onMessage(String json) {
    EventEnvelopeRaw raw = objectMapper.readValue(json, EventEnvelopeRaw.class);
    JavaType payloadType = registry.resolve(raw.getType(), raw.getVersion());
    Object payload = objectMapper.treeToValue(raw.getPayload(), payloadType);
    dispatch(raw, payload);
}
```

Jangan deserialize langsung ke `Object` lalu casting.

Buruk:

```java
Object event = objectMapper.readValue(json, Object.class);
```

Ini menghasilkan `Map/List/String/Number/Boolean`, bukan typed event.

Better:

```java
EventEnvelopeRaw raw = objectMapper.readValue(json, EventEnvelopeRaw.class);
```

Lalu decode payload dengan registry.

### 41.1 DLQ Strategy

Untuk unknown type atau incompatible payload:

- simpan raw JSON
- simpan error code
- simpan field path jika ada
- simpan event type/version
- simpan consumer version
- jangan log PII mentah sembarangan

Mapping failure harus replayable.

---

## 42. Type Handling dan Persistence/Cache

Kadang object polymorphic disimpan ke cache atau DB JSON column.

Contoh:

```java
public interface RuleCondition {
}

public class AmountGreaterThanCondition implements RuleCondition {
    private BigDecimal amount;
}

public class CountryIsCondition implements RuleCondition {
    private String countryCode;
}
```

Jika disimpan sebagai JSON, butuh type metadata.

Pertanyaan desain:

- apakah JSON cache adalah internal transient format?
- apakah JSON DB adalah long-lived persisted contract?
- apakah schema-nya perlu migrasi?
- apakah class/package boleh berubah?
- apakah future service/version harus membaca data lama?

Untuk persisted JSON, jangan pakai class name sebagai type id. Gunakan stable logical type.

```json
{
  "conditionType": "AMOUNT_GREATER_THAN",
  "amount": 1000.00
}
```

Jika class berubah dari:

```java
AmountGreaterThanCondition
```

menjadi:

```java
MinimumAmountCondition
```

JSON lama tetap bisa dibaca karena type id tetap stabil.

---

## 43. Type Handling dan Audit Trail

Audit trail sering menyimpan before/after state atau serialized changes.

Risiko jika menyimpan polymorphic object langsung:

- class name masuk audit payload
- future code tidak bisa deserialize audit lama
- sensitive field ikut tersimpan
- audit menjadi tergantung runtime object model

Lebih baik audit payload memakai audit DTO yang stabil:

```json
{
  "changeType": "STATUS_CHANGED",
  "field": "status",
  "from": "SUBMITTED",
  "to": "APPROVED"
}
```

Untuk polymorphic audit event:

```json
{
  "auditEventType": "CASE_STATUS_CHANGED",
  "auditEventVersion": 1,
  "payload": {
    "caseId": "CASE-001",
    "fromStatus": "SUBMITTED",
    "toStatus": "APPROVED"
  }
}
```

Jangan simpan arbitrary domain object snapshot tanpa policy.

---

## 44. Common Exceptions dan Cara Membacanya

### 44.1 Cannot Deserialize Interface/Abstract Type

Contoh error konseptual:

```text
Cannot construct instance of PaymentDto: abstract types either need to be mapped to concrete types...
```

Artinya:

- target type adalah interface/abstract class
- Jackson tidak tahu subtype concrete
- discriminator/registry/custom deserializer belum ada atau tidak aktif

Solusi:

- tambahkan `@JsonTypeInfo` + subtype allowlist
- gunakan concrete DTO
- gunakan custom deserializer
- gunakan registry dua tahap

### 44.2 LinkedHashMap Cannot Be Cast

Contoh:

```text
java.util.LinkedHashMap cannot be cast to OrderDto
```

Artinya:

- generic type hilang
- data dibaca sebagai raw `List.class`, `Map.class`, atau `ApiResponse.class`

Solusi:

- gunakan `TypeReference`
- gunakan `JavaType`
- jangan pakai raw class untuk generic payload

### 44.3 Could Not Resolve Type Id

Contoh konseptual:

```text
Could not resolve type id 'CRYPTO' as a subtype of PaymentDto
```

Artinya:

- discriminator value tidak dikenal
- subtype belum didaftarkan
- value typo
- client mengirim versi lebih baru

Solusi tergantung boundary:

- reject dengan error jelas
- register subtype baru
- route ke DLQ/parking lot
- update OpenAPI/schema

### 44.4 Missing Type Id

Artinya payload polymorphic tidak memiliki field discriminator.

Solusi:

- pastikan JSON contract mewajibkan discriminator
- perbaiki serializer agar menulis discriminator
- gunakan external property jika discriminator di parent
- custom deserializer jika shape legacy

---

## 45. Decision Framework: Annotation, JavaType, Registry, atau Custom Deserializer?

| Masalah | Solusi Utama | Kenapa |
|---|---|---|
| `List<OrderDto>` | `TypeReference` atau `JavaType` | menghindari type erasure |
| `ApiResponse<OrderDto>` | `TypeReference` atau `JavaType` | wrapper generic butuh payload type |
| Dynamic payload class | `JavaType` | type dibangun runtime |
| Simple polymorphic DTO | `@JsonTypeInfo` + `@JsonSubTypes` | declarative dan ringkas |
| External/legacy weird shape | custom deserializer | contract tidak cocok dengan annotation |
| Event envelope heterogeneous | raw envelope + registry | aman, explicit, governable |
| Persisted polymorphic JSON | stable logical type id | tahan refactor class/package |
| Untrusted input | allowlist subtype, no class name | security boundary |

---

## 46. Production Checklist

Sebelum menggunakan generic/polymorphic type handling di production, jawab ini:

### Generic Type

- Apakah semua `readValue` untuk `List<T>` memakai `TypeReference`/`JavaType`?
- Apakah wrapper generic seperti `ApiResponse<T>` dibaca dengan full generic type?
- Apakah ada raw `List.class`, `Map.class`, atau `ApiResponse.class` di hot path?
- Apakah helper JSON utility mendukung `TypeReference`/`JavaType`, bukan hanya `Class<T>`?
- Apakah test memastikan elemen collection bertipe benar?

### Polymorphism

- Apakah discriminator field stabil dan terdokumentasi?
- Apakah discriminator memakai logical name, bukan Java class name?
- Apakah subtype allowlist eksplisit?
- Apakah unknown subtype ditolak/di-DLQ/diobservasi?
- Apakah missing discriminator menghasilkan error jelas?
- Apakah serialization melalui base type sudah dites?
- Apakah OpenAPI/JSON Schema sinkron dengan runtime Jackson?

### Security

- Apakah default typing dihindari untuk untrusted input?
- Apakah external payload tidak bisa memilih arbitrary Java class?
- Apakah subtype yang didaftarkan hanya DTO aman?
- Apakah polymorphic domain object tidak langsung diekspos ke external boundary?
- Apakah error message tidak membocorkan internal class/package secara berlebihan?

### Versioning

- Apakah polymorphic payload punya version jika long-lived?
- Apakah event type dan version dipisahkan?
- Apakah payload lama masih bisa dibaca?
- Apakah breaking semantic change memakai payload class/version baru?
- Apakah golden payload test tersedia?

---

## 47. Mini Case Study: Case Management Action API

Kita desain endpoint:

```http
POST /cases/actions
```

Aksi yang didukung:

- approve case
- reject case
- assign case

### 47.1 Buruk: Single DTO dengan Banyak Nullable Field

```java
public class CaseActionRequest {
    private String actionType;
    private String caseId;
    private String approvalReason;
    private String rejectionReason;
    private String assigneeUserId;
    private LocalDate dueDate;
}
```

Masalah:

- jika `actionType = APPROVE`, apakah `rejectionReason` boleh dikirim?
- jika client kirim `approvalReason` dan `rejectionReason`, mana yang menang?
- apakah `dueDate` diabaikan untuk approve?
- audit akan merekam field yang tidak relevan?
- validation penuh branching

### 47.2 Lebih Baik: Polymorphic DTO

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "actionType"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = ApproveCaseActionRequest.class, name = "APPROVE"),
    @JsonSubTypes.Type(value = RejectCaseActionRequest.class, name = "REJECT"),
    @JsonSubTypes.Type(value = AssignCaseActionRequest.class, name = "ASSIGN")
})
public sealed interface CaseActionRequest
    permits ApproveCaseActionRequest, RejectCaseActionRequest, AssignCaseActionRequest {
    String caseId();
}
```

```java
public record ApproveCaseActionRequest(
    String caseId,
    String approvalReason
) implements CaseActionRequest {
}
```

```java
public record RejectCaseActionRequest(
    String caseId,
    String rejectionReason
) implements CaseActionRequest {
}
```

```java
public record AssignCaseActionRequest(
    String caseId,
    String assigneeUserId,
    LocalDate dueDate
) implements CaseActionRequest {
}
```

### 47.3 JSON Examples

Approve:

```json
{
  "actionType": "APPROVE",
  "caseId": "CASE-001",
  "approvalReason": "All compliance checks passed"
}
```

Reject:

```json
{
  "actionType": "REJECT",
  "caseId": "CASE-001",
  "rejectionReason": "Missing mandatory supporting document"
}
```

Assign:

```json
{
  "actionType": "ASSIGN",
  "caseId": "CASE-001",
  "assigneeUserId": "user-123",
  "dueDate": "2026-06-30"
}
```

### 47.4 Mapper to Command

```java
public CaseActionCommand toCommand(CaseActionRequest request) {
    return switch (request) {
        case ApproveCaseActionRequest approve -> new ApproveCaseCommand(
            approve.caseId(),
            approve.approvalReason()
        );
        case RejectCaseActionRequest reject -> new RejectCaseCommand(
            reject.caseId(),
            reject.rejectionReason()
        );
        case AssignCaseActionRequest assign -> new AssignCaseCommand(
            assign.caseId(),
            assign.assigneeUserId(),
            assign.dueDate()
        );
    };
}
```

For Java 8, gunakan `instanceof` chain dan test coverage.

### 47.5 Kenapa Ini Lebih Baik

- request shape jujur per action
- validation lebih fokus
- OpenAPI bisa pakai `oneOf`
- mapper eksplisit per action
- over-posting lebih kecil
- audit lebih jelas
- subtype baru memaksa review mapper/test/schema

---

## 48. Mini Case Study: Event Envelope Registry

Event JSON:

```json
{
  "eventId": "evt-001",
  "eventType": "CASE_APPROVED",
  "eventVersion": 1,
  "occurredAt": "2026-06-17T10:15:30Z",
  "payload": {
    "caseId": "CASE-001",
    "approvedBy": "user-123"
  }
}
```

Raw envelope:

```java
public class RawEventEnvelope {
    private String eventId;
    private String eventType;
    private int eventVersion;
    private Instant occurredAt;
    private JsonNode payload;

    // getters/setters
}
```

Payload:

```java
public record CaseApprovedPayloadV1(
    String caseId,
    String approvedBy
) {
}
```

Registry:

```java
public final class EventTypeRegistry {
    private final TypeFactory typeFactory;
    private final Map<EventKey, JavaType> payloadTypes;

    public EventTypeRegistry(ObjectMapper objectMapper) {
        this.typeFactory = objectMapper.getTypeFactory();

        Map<EventKey, JavaType> map = new HashMap<>();
        map.put(
            new EventKey("CASE_APPROVED", 1),
            typeFactory.constructType(CaseApprovedPayloadV1.class)
        );

        this.payloadTypes = Map.copyOf(map);
    }

    public JavaType resolve(String eventType, int eventVersion) {
        JavaType type = payloadTypes.get(new EventKey(eventType, eventVersion));
        if (type == null) {
            throw new UnsupportedEventTypeException(eventType, eventVersion);
        }
        return type;
    }
}
```

Decoder:

```java
public final class EventMessageDecoder {
    private final ObjectMapper objectMapper;
    private final EventTypeRegistry registry;

    public EventMessageDecoder(ObjectMapper objectMapper, EventTypeRegistry registry) {
        this.objectMapper = objectMapper;
        this.registry = registry;
    }

    public DecodedEvent<?> decode(String json) {
        try {
            RawEventEnvelope raw = objectMapper.readValue(json, RawEventEnvelope.class);
            JavaType payloadType = registry.resolve(raw.getEventType(), raw.getEventVersion());
            Object payload = objectMapper.convertValue(raw.getPayload(), payloadType);

            return new DecodedEvent<>(
                raw.getEventId(),
                raw.getEventType(),
                raw.getEventVersion(),
                raw.getOccurredAt(),
                payload
            );
        } catch (UnsupportedEventTypeException e) {
            throw e;
        } catch (Exception e) {
            throw new EventMessageDecodeException("Failed to decode event message", e);
        }
    }
}
```

This design:

- avoids arbitrary class name metadata
- supports versioning
- supports DLQ with raw event
- separates envelope from payload
- centralizes governance

---

## 49. Practical Rules of Thumb

1. Jangan deserialize generic collection dengan raw `List.class`.
2. Jangan deserialize generic wrapper dengan raw wrapper class.
3. Gunakan `TypeReference` untuk generic type statis.
4. Gunakan `JavaType` untuk type yang dibangun dinamis.
5. Gunakan discriminator logical name, bukan Java class name.
6. Treat polymorphic deserialization as security-sensitive.
7. Hindari default typing untuk untrusted input.
8. Prefer DTO polymorphism over domain polymorphism at external boundaries.
9. Untuk event stream, envelope + registry sering lebih aman daripada global annotation.
10. Unknown subtype harus terlihat: reject, DLQ, park, atau audit.
11. Test serialization melalui base type, bukan hanya concrete type.
12. Sinkronkan runtime discriminator dengan OpenAPI/schema.
13. Jangan jadikan polymorphism sebagai pelarian dari desain DTO yang buruk.
14. Jangan membuat subtype untuk setiap variasi kecil yang bisa direpresentasikan sebagai data.
15. Untuk persisted JSON, type id harus tahan refactor class/package.

---

## 50. Ringkasan Mental Model

Generic type handling menjawab pertanyaan:

```text
Container ini berisi object tipe apa?
```

Polymorphic type handling menjawab pertanyaan:

```text
Base type/interface ini harus menjadi subtype concrete yang mana?
```

`TypeReference` dan `JavaType` menyelesaikan masalah type erasure.

`@JsonTypeInfo`, subtype registry, dan custom deserializer menyelesaikan masalah subtype selection.

Tetapi desain yang benar bukan sekadar “bagaimana membuat Jackson bisa deserialize”. Desain yang benar adalah:

```text
Bagaimana membuat type selection eksplisit, aman, stabil sebagai contract,
tidak membocorkan internal Java model, bisa dievolusi, bisa dites,
dan failure-nya bisa didiagnosis.
```

Untuk menjadi engineer yang kuat di area ini, jangan melihat polymorphism sebagai fitur library. Lihat ia sebagai **contract governance problem**.

---

## 51. Latihan

### Latihan 1 — Generic Wrapper

Buat class:

```java
ApiResponse<T>
```

Lalu deserialize JSON:

```json
{
  "success": true,
  "data": {
    "id": "O-001",
    "status": "SUBMITTED"
  }
}
```

ke:

```java
ApiResponse<OrderDto>
```

Lakukan dengan:

1. `TypeReference`
2. `JavaType`

Tambahkan test yang membuktikan `data` adalah `OrderDto`, bukan `LinkedHashMap`.

### Latihan 2 — Polymorphic Payment DTO

Desain polymorphic DTO untuk:

- credit card
- bank transfer
- e-wallet

Gunakan discriminator:

```json
"paymentType"
```

Buat test untuk:

- happy path semua subtype
- unknown subtype
- missing discriminator
- list of polymorphic payments
- serialization melalui base type

### Latihan 3 — Event Envelope Registry

Desain event envelope:

```json
{
  "eventType": "...",
  "eventVersion": 1,
  "payload": {}
}
```

Buat registry:

```java
(eventType, eventVersion) -> JavaType
```

Buat decoder yang:

- membaca raw envelope
- resolve payload type
- decode payload
- menolak unknown type/version
- menyimpan raw JSON untuk error handling

### Latihan 4 — Refactor Giant DTO

Ambil DTO besar dengan field nullable berdasarkan `actionType`. Refactor menjadi polymorphic DTO hierarchy.

Analisis:

- field mana menjadi subtype-specific
- discriminator apa yang dipakai
- validation per subtype
- command mapping
- OpenAPI `oneOf` representation
- backward compatibility impact

---

## 52. Penutup

Advanced type handling adalah salah satu area yang membedakan penggunaan Jackson secara casual dan penggunaan Jackson secara production-grade.

Engineer biasa berhenti di:

```java
objectMapper.readValue(json, SomeClass.class)
```

Engineer yang lebih matang memahami:

```text
- apakah tipe ini generic?
- apakah tipe ini polymorphic?
- apakah JSON boleh menentukan subtype?
- apakah type id stabil sebagai contract?
- apakah unknown type aman ditangani?
- apakah payload lama masih bisa dibaca?
- apakah error bisa didiagnosis?
- apakah schema dan runtime sinkron?
```

Bagian berikutnya akan masuk ke custom serializer/deserializer secara lebih dalam: bagaimana menulis codec yang benar saat annotation tidak cukup, bagaimana membuat error message yang berkualitas, bagaimana memakai contextual serializer/deserializer, dan bagaimana menghindari global side effects.

---

## Status Seri

- Part 10 selesai.
- Seri belum selesai.
- Berikutnya: **Part 11 — Jackson Custom Serializer/Deserializer Deep Dive**.
