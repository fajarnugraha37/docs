# Part 25 — Lombok with Jackson and MapStruct: Builders, Records, Immutability

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> Bagian: 25 dari 35  
> Target: Java 8 sampai Java 25  
> Fokus: interaksi Lombok, Jackson, MapStruct, builder, records, dan immutable DTO dalam mapping layer production-grade.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas Lombok sebagai mekanisme annotation processing dan penggunaan praktis Lombok seperti `@Getter`, `@Setter`, `@Builder`, `@Value`, `@Data`, `@EqualsAndHashCode`, dan constructor annotations.

Bagian ini membahas area yang jauh lebih subtle: **apa yang terjadi ketika Lombok dipakai bersama Jackson dan MapStruct**.

Ini penting karena ketiganya bekerja pada waktu yang berbeda:

| Komponen | Bekerja di | Melihat apa? | Risiko utama |
|---|---:|---|---|
| Lombok | compile time, annotation processing / AST transformation | source code sebelum menjadi bytecode | IDE/compiler/build mismatch, generated method tidak terlihat jelas |
| MapStruct | compile time, annotation processing | property accessor, constructor, builder, generated source shape | mapper gagal compile atau memilih mapping path yang tidak diinginkan |
| Jackson | runtime, reflection/introspection/module metadata | bytecode, constructor, accessor, annotation | deserialization gagal, field silent default, builder mismatch |

Kesalahan umum engineer adalah menganggap:

> “Kalau Lombok generate builder, Jackson dan MapStruct pasti otomatis paham.”

Kadang benar. Kadang salah. Dan ketika salah, bug-nya bisa tampak seperti:

- `Cannot construct instance of ... no Creators, like default constructor, exist`
- JSON masuk tetapi semua field `null`
- MapStruct memakai builder padahal kita ingin constructor
- MapStruct tidak melihat property karena Lombok belum diproses benar
- Jackson tidak tahu prefix builder method
- `@Builder.Default` tidak berlaku pada jalur deserialization tertentu
- immutable DTO terlihat aman tetapi bisa menerima state invalid
- JPA entity memakai Lombok builder lalu identity/equality rusak
- record DTO lebih sederhana tetapi tidak cocok untuk semua use case

Tujuan bagian ini adalah membangun mental model dan decision framework supaya kamu bisa memilih:

- kapan pakai Lombok builder
- kapan tambah `@Jacksonized`
- kapan pakai Jackson native annotations
- kapan MapStruct harus mapping via builder
- kapan builder justru harus dimatikan
- kapan record lebih baik daripada Lombok `@Value`
- bagaimana mendesain DTO immutable yang tetap serializable, mappable, testable, dan evolvable

---

## 1. Core Mental Model: Satu Class, Tiga Perspektif

Ambil contoh class berikut:

```java
import lombok.Builder;
import lombok.Value;

@Value
@Builder
public class CustomerResponse {
    String id;
    String fullName;
    String email;
}
```

Dari sisi developer, class ini terlihat sederhana:

```java
CustomerResponse response = CustomerResponse.builder()
    .id("CUST-001")
    .fullName("Jane Doe")
    .email("jane@example.com")
    .build();
```

Tetapi ada tiga perspektif berbeda.

### 1.1 Perspektif Lombok

Lombok melihat source code dan menghasilkan kira-kira:

```java
public final class CustomerResponse {
    private final String id;
    private final String fullName;
    private final String email;

    public CustomerResponse(String id, String fullName, String email) {
        this.id = id;
        this.fullName = fullName;
        this.email = email;
    }

    public String getId() { return id; }
    public String getFullName() { return fullName; }
    public String getEmail() { return email; }

    public static CustomerResponseBuilder builder() {
        return new CustomerResponseBuilder();
    }

    public static class CustomerResponseBuilder {
        private String id;
        private String fullName;
        private String email;

        public CustomerResponseBuilder id(String id) {
            this.id = id;
            return this;
        }

        public CustomerResponseBuilder fullName(String fullName) {
            this.fullName = fullName;
            return this;
        }

        public CustomerResponseBuilder email(String email) {
            this.email = email;
            return this;
        }

        public CustomerResponse build() {
            return new CustomerResponse(id, fullName, email);
        }
    }
}
```

### 1.2 Perspektif MapStruct

MapStruct tidak peduli kamu “menulis” getter atau Lombok “membuat” getter. MapStruct hanya perlu melihat property setelah annotation processing cukup matang.

MapStruct akan bertanya:

- target punya setter?
- target punya constructor yang usable?
- target punya builder?
- source punya getter?
- nama property cocok?
- conversion method tersedia?

Jika MapStruct melihat builder, ia bisa menghasilkan kode seperti:

```java
return CustomerResponse.builder()
    .id(source.getId())
    .fullName(source.getName())
    .email(source.getEmail())
    .build();
```

### 1.3 Perspektif Jackson

Jackson runtime melihat class bytecode dan annotation.

Saat serialization, Jackson relatif mudah:

- ada getter `getId()`
- ada getter `getFullName()`
- ada getter `getEmail()`

Maka object bisa menjadi JSON.

Saat deserialization, Jackson bertanya:

- ada no-args constructor + setter?
- ada constructor/factory yang diberi `@JsonCreator`?
- ada record canonical constructor?
- ada builder yang ditunjuk via `@JsonDeserialize(builder = ...)`?
- builder method memakai prefix apa?
- build method namanya apa?

Tanpa instruksi tambahan, `@Value @Builder` bisa serializable tetapi tidak selalu deserializable dengan cara yang kamu harapkan.

---

## 2. Serialization vs Deserialization: Jangan Disamakan

Salah satu kesalahan paling umum adalah menguji hanya response JSON lalu menyimpulkan class sudah “Jackson compatible”.

Padahal:

```java
String json = objectMapper.writeValueAsString(response);
```

berbeda total dengan:

```java
CustomerResponse value = objectMapper.readValue(json, CustomerResponse.class);
```

### 2.1 Serialization biasanya lebih mudah

Untuk serialization, Jackson cukup membaca property dari:

- public getter
- field visibility tertentu
- annotation `@JsonProperty`
- record component

Immutable object mudah di-serialize karena hanya perlu dibaca.

### 2.2 Deserialization lebih sulit

Untuk deserialization, Jackson harus membuat object.

Ia butuh salah satu dari:

1. no-args constructor lalu setter/field access
2. annotated constructor/factory
3. parameter name metadata yang bisa dibaca
4. record canonical constructor
5. builder yang dikenali
6. custom deserializer

Immutable object tidak bisa diisi setelah dibuat, sehingga Jackson harus tahu cara membangun object dari awal.

---

## 3. Lombok Builder + Jackson: Masalah Dasar

Misalkan kita punya DTO immutable:

```java
import lombok.Builder;
import lombok.Value;

@Value
@Builder
public class CreateCustomerRequest {
    String fullName;
    String email;
}
```

JSON input:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com"
}
```

Pertanyaan: apakah ini bisa langsung dibaca?

```java
CreateCustomerRequest request = objectMapper.readValue(
    json,
    CreateCustomerRequest.class
);
```

Jawabannya bergantung pada:

- versi Jackson
- apakah constructor parameter name tersedia
- apakah Lombok generate constructor yang cocok
- apakah ada annotation Jackson
- apakah module `ParameterNamesModule` dipakai
- apakah build dilakukan dengan `-parameters`
- apakah field final bisa diisi via reflection

Untuk production code, jawaban “bergantung” adalah sinyal desain buruk.

Kita ingin jalur yang eksplisit.

---

## 4. Solusi 1: Lombok `@Jacksonized`

Lombok menyediakan `@Jacksonized` sebagai add-on untuk `@Builder`, `@SuperBuilder`, dan dalam versi baru juga mendukung skenario `@Accessors`. Annotation ini membuat builder Lombok lebih mudah digunakan oleh Jackson dengan menambahkan metadata Jackson yang diperlukan pada hasil generated code.

Contoh:

```java
import lombok.Builder;
import lombok.Value;
import lombok.extern.jackson.Jacksonized;

@Value
@Builder
@Jacksonized
public class CreateCustomerRequest {
    String fullName;
    String email;
}
```

Secara konsep, Lombok membantu menghasilkan bentuk yang kira-kira setara dengan:

```java
@JsonDeserialize(builder = CreateCustomerRequest.CreateCustomerRequestBuilder.class)
public class CreateCustomerRequest {
    // fields, constructor, getters

    @JsonPOJOBuilder(withPrefix = "")
    public static class CreateCustomerRequestBuilder {
        // builder methods: fullName(...), email(...)
    }
}
```

Kenapa `withPrefix = ""` penting?

Karena builder Lombok default-nya memakai method:

```java
builder.fullName("Jane Doe")
builder.email("jane@example.com")
```

Bukan:

```java
builder.withFullName("Jane Doe")
builder.withEmail("jane@example.com")
```

Jackson builder default historically sering diasosiasikan dengan prefix `with`. Jadi tanpa konfigurasi, Jackson bisa tidak menemukan setter-like builder methods.

### 4.1 Kapan `@Jacksonized` cocok?

Gunakan untuk:

- immutable DTO berbasis Lombok builder
- request DTO yang ingin constructor/builder based
- response DTO yang juga perlu round-trip test
- event payload object yang dibaca dari queue/file
- test fixture DTO yang dibaca dari JSON

Contoh ideal:

```java
@Value
@Builder
@Jacksonized
public class RegisterAccountCommandPayload {
    String requestId;
    String accountType;
    String applicantName;
    String applicantEmail;
}
```

### 4.2 Kapan `@Jacksonized` tidak cukup?

Tidak cukup jika:

- kamu butuh validasi cross-field saat construction
- kamu butuh default semantic yang kompleks
- kamu perlu membedakan absent vs explicit null
- kamu perlu custom parsing per field
- kamu punya polymorphic deserialization
- kamu punya legacy JSON shape yang tidak cocok dengan builder method
- kamu ingin error message sangat presisi

Untuk kasus ini, gunakan tambahan:

- `@JsonCreator`
- custom deserializer
- wrapper type untuk presence
- validation layer terpisah
- explicit factory method

---

## 5. Solusi 2: Jackson Native Builder Annotation

Tanpa `@Jacksonized`, kamu bisa menulis annotation Jackson eksplisit.

```java
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.annotation.JsonPOJOBuilder;
import lombok.Builder;
import lombok.Value;

@Value
@Builder
@JsonDeserialize(builder = CreateCustomerRequest.CreateCustomerRequestBuilder.class)
public class CreateCustomerRequest {
    String fullName;
    String email;

    @JsonPOJOBuilder(withPrefix = "")
    public static class CreateCustomerRequestBuilder {
    }
}
```

Ini lebih verbose, tetapi memberi kontrol penuh.

### 5.1 Kapan lebih baik manual daripada `@Jacksonized`?

Pakai manual jika:

- kamu ingin explicit dependency ke Jackson terlihat di source
- kamu perlu custom `buildMethodName`
- kamu memakai builder naming khusus
- kamu ingin meminimalkan magic Lombok
- kamu bekerja di tim yang membatasi experimental Lombok feature
- kamu sedang debugging integrasi Jackson-builder yang rumit

Contoh custom:

```java
@Value
@Builder(builderClassName = "Builder", buildMethodName = "create")
@JsonDeserialize(builder = CreateCustomerRequest.Builder.class)
public class CreateCustomerRequest {
    String fullName;
    String email;

    @JsonPOJOBuilder(withPrefix = "", buildMethodName = "create")
    public static class Builder {
    }
}
```

---

## 6. Builder Default: Salah Satu Jebakan Terbesar

Lombok punya `@Builder.Default`:

```java
@Value
@Builder
@Jacksonized
public class SearchRequest {
    String query;

    @Builder.Default
    int page = 1;

    @Builder.Default
    int size = 20;
}
```

Jika JSON tidak mengirim `page` dan `size`:

```json
{
  "query": "java"
}
```

Maka builder Lombok dapat memakai default `1` dan `20`.

Tetapi hati-hati: default ini berlaku pada jalur builder. Jika object dibuat lewat constructor langsung, default field initializer pada Lombok builder tidak otomatis berarti hal yang sama.

Contoh:

```java
SearchRequest request = new SearchRequest("java", 0, 0);
```

Ini bisa melewati semantic default.

### 6.1 Default bukan sekadar nilai teknis

Default bisa berarti policy:

- page default `1`
- size default `20`
- sort default `createdAt DESC`
- locale default `en`
- timezone default `UTC`
- status default `DRAFT`
- consent default `false`

Kalau default punya makna bisnis/security, jangan disembunyikan terlalu jauh di annotation.

Lebih eksplisit:

```java
public final class SearchDefaults {
    public static final int DEFAULT_PAGE = 1;
    public static final int DEFAULT_SIZE = 20;

    private SearchDefaults() {}
}
```

Lalu:

```java
@Value
@Builder
@Jacksonized
public class SearchRequest {
    String query;

    @Builder.Default
    int page = SearchDefaults.DEFAULT_PAGE;

    @Builder.Default
    int size = SearchDefaults.DEFAULT_SIZE;
}
```

Dan validasi tetap dilakukan:

```java
public void validate(SearchRequest request) {
    if (request.getPage() < 1) {
        throw new BadRequestException("page must be >= 1");
    }
    if (request.getSize() < 1 || request.getSize() > 100) {
        throw new BadRequestException("size must be between 1 and 100");
    }
}
```

### 6.2 Default tidak menyelesaikan absent vs null

JSON:

```json
{
  "query": "java"
}
```

berbeda dengan:

```json
{
  "query": "java",
  "page": null
}
```

Untuk primitive `int`, `null` bisa menjadi problem binding. Untuk `Integer`, `null` bisa masuk. Builder default biasanya berlaku ketika builder field belum diset, tetapi explicit null bisa dihitung sebagai “diset ke null”.

Untuk boundary yang strict, bedakan:

- absent field
- explicit null
- invalid value
- defaulted value

Jika perlu membedakan presence, jangan mengandalkan Lombok builder default saja.

---

## 7. Lombok `@Value` + Jackson

`@Value` menghasilkan immutable class:

- class final by default
- fields private final
- getters
- all-args constructor
- equals/hashCode
- toString

Contoh:

```java
@Value
public class CustomerDto {
    String id;
    String name;
}
```

Serialization biasanya mudah karena getter tersedia.

Deserialization bisa bermasalah kecuali Jackson tahu constructor parameter names.

### 7.1 Constructor Binding dengan `@JsonCreator`

Cara eksplisit:

```java
@Value
public class CustomerDto {
    String id;
    String name;

    @JsonCreator
    public CustomerDto(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name
    ) {
        this.id = id;
        this.name = name;
    }
}
```

Ini verbose, tetapi sangat jelas.

### 7.2 Kapan `@Value` cocok?

Cocok untuk:

- small immutable DTO
- value object sederhana
- response DTO internal
- event payload yang stabil
- read model snapshot

Kurang cocok untuk:

- DTO dengan banyak optional field
- request PATCH
- object dengan default rumit
- inheritance-heavy model
- JPA entity
- payload yang butuh builder karena field banyak

---

## 8. Lombok Builder + MapStruct

MapStruct dapat memanfaatkan builder target jika ia mendeteksi builder pattern.

Contoh source:

```java
public class CustomerEntity {
    private String id;
    private String firstName;
    private String lastName;
    private String email;

    public String getId() { return id; }
    public String getFirstName() { return firstName; }
    public String getLastName() { return lastName; }
    public String getEmail() { return email; }
}
```

Target:

```java
@Value
@Builder
public class CustomerResponse {
    String id;
    String fullName;
    String email;
}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface CustomerMapper {

    @Mapping(target = "fullName", expression = "java(entity.getFirstName() + \" \" + entity.getLastName())")
    CustomerResponse toResponse(CustomerEntity entity);
}
```

Generated code kira-kira:

```java
@Override
public CustomerResponse toResponse(CustomerEntity entity) {
    if (entity == null) {
        return null;
    }

    CustomerResponse.CustomerResponseBuilder builder = CustomerResponse.builder();
    builder.id(entity.getId());
    builder.email(entity.getEmail());
    builder.fullName(entity.getFirstName() + " " + entity.getLastName());

    return builder.build();
}
```

Ini bagus karena target immutable tetap bisa dibuat.

---

## 9. Masalah Annotation Processor Ordering: Lombok + MapStruct

Karena Lombok dan MapStruct sama-sama annotation processor, ada isu penting:

- Lombok harus membuat getter/builder/constructor terlihat untuk MapStruct.
- MapStruct harus memproses model setelah Lombok transformations cukup tersedia.

Pada kombinasi Lombok versi baru, MapStruct FAQ merekomendasikan `lombok-mapstruct-binding` agar Lombok dan MapStruct bekerja bersama dengan benar.

### 9.1 Maven Setup

Contoh Maven:

```xml
<properties>
    <org.mapstruct.version>1.6.3</org.mapstruct.version>
    <org.projectlombok.version>1.18.42</org.projectlombok.version>
</properties>

<dependencies>
    <dependency>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct</artifactId>
        <version>${org.mapstruct.version}</version>
    </dependency>

    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>${org.projectlombok.version}</version>
        <scope>provided</scope>
    </dependency>
</dependencies>

<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.13.0</version>
            <configuration>
                <annotationProcessorPaths>
                    <path>
                        <groupId>org.mapstruct</groupId>
                        <artifactId>mapstruct-processor</artifactId>
                        <version>${org.mapstruct.version}</version>
                    </path>
                    <path>
                        <groupId>org.projectlombok</groupId>
                        <artifactId>lombok</artifactId>
                        <version>${org.projectlombok.version}</version>
                    </path>
                    <path>
                        <groupId>org.projectlombok</groupId>
                        <artifactId>lombok-mapstruct-binding</artifactId>
                        <version>0.2.0</version>
                    </path>
                </annotationProcessorPaths>
            </configuration>
        </plugin>
    </plugins>
</build>
```

### 9.2 Gradle Setup

Contoh Gradle:

```groovy
dependencies {
    implementation "org.mapstruct:mapstruct:1.6.3"

    compileOnly "org.projectlombok:lombok:1.18.42"
    annotationProcessor "org.projectlombok:lombok:1.18.42"

    annotationProcessor "org.mapstruct:mapstruct-processor:1.6.3"
    annotationProcessor "org.projectlombok:lombok-mapstruct-binding:0.2.0"

    testCompileOnly "org.projectlombok:lombok:1.18.42"
    testAnnotationProcessor "org.projectlombok:lombok:1.18.42"
    testAnnotationProcessor "org.mapstruct:mapstruct-processor:1.6.3"
    testAnnotationProcessor "org.projectlombok:lombok-mapstruct-binding:0.2.0"
}
```

### 9.3 Gejala jika binding bermasalah

Gejalanya bisa berupa:

```text
Unknown property "name" in result type CustomerResponse.CustomerResponseBuilder.
```

atau:

```text
No property named "email" exists in source parameter(s).
```

atau generated mapper tidak menggunakan builder/getter yang kamu harapkan.

### 9.4 Rule production

Untuk project production:

- pin versi Lombok
- pin versi MapStruct
- eksplisitkan annotation processor paths
- jangan hanya mengandalkan transitive processor
- inspect generated source saat upgrade
- pastikan IDE dan CI memakai konfigurasi compiler yang sama

---

## 10. MapStruct Builder Detection: Blessing and Trap

MapStruct bisa mendeteksi builder dan menggunakannya otomatis. Ini nyaman, tetapi bisa berbahaya jika builder bukan jalur construction yang kamu inginkan.

Contoh:

```java
@Builder
public class UpdateCustomerCommand {
    private String id;
    private String email;
    private boolean emailVerified;
}
```

Jika MapStruct mengisi `emailVerified` dari request DTO, padahal field itu harus ditentukan oleh domain/security logic, terjadi privilege escalation atau state corruption.

### 10.1 Builder tidak berarti semua field boleh di-map

Builder membuat semua field terlihat “constructible”. Tetapi tidak semua field seharusnya berasal dari source.

Mapper harus eksplisit:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CustomerCommandMapper {

    @Mapping(target = "emailVerified", ignore = true)
    UpdateCustomerCommand toCommand(UpdateCustomerRequest request);
}
```

Lebih baik lagi, jangan expose field tersebut pada target builder untuk boundary mapping.

```java
@Value
@Builder
public class UpdateCustomerCommand {
    String id;
    String email;

    // emailVerified tidak ada di command dari user input
}
```

### 10.2 Disable builder di MapStruct jika perlu

Ada situasi ketika kamu ingin MapStruct tidak memakai builder.

Misalnya target punya setter dan builder, tetapi builder punya side effect atau tidak lengkap.

Kamu bisa mengatur di mapper config:

```java
@Mapper(
    builder = @Builder(disableBuilder = true)
)
public interface CustomerMapper {
    CustomerMutableDto toDto(CustomerEntity entity);
}
```

Atau secara global lewat `@MapperConfig`:

```java
@MapperConfig(
    builder = @Builder(disableBuilder = true)
)
public interface NoBuilderMapperConfig {
}
```

Lalu:

```java
@Mapper(config = NoBuilderMapperConfig.class)
public interface CustomerMapper {
}
```

### 10.3 Kapan builder detection sebaiknya dipakai?

Pakai builder detection untuk:

- immutable response DTO
- immutable event DTO
- read model snapshot
- command object yang semua field-nya safe dari source

Hindari atau kontrol ketat untuk:

- JPA entity
- security-sensitive command
- patch/update target
- aggregate root
- object dengan lifecycle/invariant kompleks

---

## 11. Lombok `@Builder` pada Constructor vs Class

Lombok `@Builder` bisa ditempel pada class, constructor, atau method.

### 11.1 Class-level builder

```java
@Value
@Builder
public class CreateOrderCommand {
    String customerId;
    List<String> itemIds;
    String requestedBy;
}
```

Builder mencakup semua fields.

Risiko: semua field menjadi constructible dari mapper.

### 11.2 Constructor-level builder

```java
@Getter
public class CreateOrderCommand {
    private final String customerId;
    private final List<String> itemIds;
    private final String requestedBy;
    private final Instant createdAt;

    @Builder
    public CreateOrderCommand(String customerId, List<String> itemIds, String requestedBy) {
        this.customerId = requireNonBlank(customerId, "customerId");
        this.itemIds = List.copyOf(itemIds);
        this.requestedBy = requireNonBlank(requestedBy, "requestedBy");
        this.createdAt = Instant.now();
    }
}
```

Di sini `createdAt` tidak bisa diisi oleh builder. Ini lebih aman.

### 11.3 Method-level builder / factory builder

```java
@Getter
public class CreateOrderCommand {
    private final String customerId;
    private final List<String> itemIds;
    private final String requestedBy;

    private CreateOrderCommand(String customerId, List<String> itemIds, String requestedBy) {
        this.customerId = customerId;
        this.itemIds = List.copyOf(itemIds);
        this.requestedBy = requestedBy;
    }

    @Builder(builderMethodName = "newRequest")
    public static CreateOrderCommand create(String customerId, List<String> itemIds, String requestedBy) {
        return new CreateOrderCommand(
            normalizeCustomerId(customerId),
            requireNonEmpty(itemIds),
            requireNonBlank(requestedBy, "requestedBy")
        );
    }
}
```

Ini memberi kontrol lebih besar atas invariant dan normalization.

### 11.4 Rule

Untuk DTO sederhana, class-level builder acceptable.

Untuk command/domain-adjacent object, prefer constructor-level atau method-level builder supaya field internal tidak otomatis terbuka.

---

## 12. Records vs Lombok `@Value`

Sejak Java 16, records menjadi stable. Untuk Java 8 legacy, records tidak tersedia. Karena seri ini mencakup Java 8 sampai 25, kita perlu strategi dua dunia.

### 12.1 Lombok `@Value`

```java
@Value
public class CustomerResponse {
    String id;
    String name;
    String email;
}
```

Kelebihan:

- bisa dipakai di Java 8+
- mengurangi boilerplate
- familiar di banyak codebase lama
- bisa digabung dengan `@Builder`
- bisa dikontrol dengan Lombok annotations

Kekurangan:

- generated code tidak terlihat langsung
- bergantung Lombok compiler/IDE support
- constructor/deserialization perlu perhatian
- semantic sebagai data carrier tidak sekuat records

### 12.2 Java record

```java
public record CustomerResponse(
    String id,
    String name,
    String email
) {}
```

Kelebihan:

- native Java language feature
- canonical constructor jelas
- immutable by design untuk references
- component names eksplisit
- Jackson modern umumnya sangat baik dengan records
- MapStruct mendukung record mapping pada versi modern
- tidak perlu Lombok untuk getter/constructor/equals/hashCode/toString

Kekurangan:

- Java 16+ only
- accessor namanya `id()`, bukan `getId()`
- tidak cocok untuk JPA entity
- tidak cocok untuk object dengan banyak optional field jika tanpa builder
- binary compatibility perlu diperhatikan saat menambah/mengubah component
- nested mutable object tetap harus defensive copy

### 12.3 Record bukan deep immutable

```java
public record OrderResponse(
    String orderId,
    List<String> itemIds
) {}
```

Record field final, tetapi list-nya bisa mutable jika caller mengirim mutable list.

Lebih aman:

```java
public record OrderResponse(
    String orderId,
    List<String> itemIds
) {
    public OrderResponse {
        itemIds = List.copyOf(itemIds);
    }
}
```

### 12.4 Lombok `@Value` juga bukan deep immutable

```java
@Value
public class OrderResponse {
    String orderId;
    List<String> itemIds;
}
```

Jika `itemIds` mutable, object masih bisa berubah secara tidak langsung.

Gunakan constructor/factory:

```java
@Value
public class OrderResponse {
    String orderId;
    List<String> itemIds;

    public OrderResponse(String orderId, List<String> itemIds) {
        this.orderId = orderId;
        this.itemIds = List.copyOf(itemIds);
    }
}
```

---

## 13. Records + Jackson

Record sangat natural untuk JSON data carrier:

```java
public record CreateCustomerRequest(
    String fullName,
    String email
) {}
```

JSON:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com"
}
```

Jackson modern dapat memakai record canonical constructor.

### 13.1 Record dengan validation ringan

```java
public record CreateCustomerRequest(
    String fullName,
    String email
) {
    public CreateCustomerRequest {
        if (fullName == null || fullName.isBlank()) {
            throw new IllegalArgumentException("fullName is required");
        }
        if (email == null || email.isBlank()) {
            throw new IllegalArgumentException("email is required");
        }
    }
}
```

Hati-hati: exception constructor akan muncul sebagai deserialization failure. Untuk API, kamu mungkin ingin validasi Bean Validation terpisah agar error response lebih rapi.

### 13.2 Record dengan `@JsonProperty`

```java
public record CustomerResponse(
    @JsonProperty("customer_id") String customerId,
    @JsonProperty("full_name") String fullName
) {}
```

Namun jangan terlalu banyak annotation format eksternal pada domain/internal record. Untuk boundary DTO, acceptable.

### 13.3 Record dan backward compatibility

Menambah component record:

```java
public record CustomerResponse(
    String id,
    String name,
    String email,
    String phoneNumber
) {}
```

Source code berubah besar karena canonical constructor berubah. Untuk JSON response, menambah field biasanya backward-compatible bagi tolerant clients. Tetapi untuk Java consumers atau tests, perubahan constructor adalah breaking source compatibility.

Untuk public library DTO, hati-hati.

---

## 14. Records + MapStruct

MapStruct dapat mapping ke record dengan constructor.

```java
public record CustomerResponse(
    String id,
    String fullName,
    String email
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface CustomerMapper {

    @Mapping(target = "fullName", expression = "java(entity.getFirstName() + \" \" + entity.getLastName())")
    CustomerResponse toResponse(CustomerEntity entity);
}
```

Generated code kira-kira:

```java
return new CustomerResponse(
    entity.getId(),
    entity.getFirstName() + " " + entity.getLastName(),
    entity.getEmail()
);
```

Ini sangat jelas dan efisien.

### 14.1 Record sebagai target update tidak cocok

MapStruct update mapping dengan `@MappingTarget` butuh target mutable.

```java
void update(@MappingTarget CustomerResponse target, CustomerPatch patch);
```

Untuk record, ini tidak masuk akal karena record immutable.

Kalau perlu update, gunakan:

- create new record from old + patch
- mutable command accumulator
- explicit patch service
- wither pattern/manual copy

Contoh:

```java
public CustomerResponse applyPatch(CustomerResponse oldValue, CustomerPatch patch) {
    return new CustomerResponse(
        oldValue.id(),
        patch.fullName() != null ? patch.fullName() : oldValue.fullName(),
        patch.email() != null ? patch.email() : oldValue.email()
    );
}
```

Tapi ini tidak membedakan absent vs explicit null kecuali patch model mendukung presence.

---

## 15. DTO Strategy by Java Version

Karena target seri Java 8 sampai 25, strategi harus realistis.

### 15.1 Java 8–15

Tidak ada records.

Pilihan umum:

- Lombok `@Value`
- Lombok `@Builder`
- manual immutable class
- AutoValue/Immutables jika organisasi memakai
- mutable JavaBean DTO untuk framework lama

Rekomendasi:

| Use case | Rekomendasi Java 8–15 |
|---|---|
| external request DTO | mutable JavaBean atau `@Value @Builder @Jacksonized` dengan test ketat |
| response DTO sederhana | `@Value` atau manual immutable |
| many optional fields | `@Builder @Jacksonized` |
| patch DTO | mutable/presence-aware DTO, jangan naive `@Value` |
| event payload | immutable class + explicit Jackson contract |
| JPA entity | jangan `@Value`, jangan `@Builder` sembarangan |

### 15.2 Java 16–25

Records tersedia.

Rekomendasi:

| Use case | Rekomendasi Java 16–25 |
|---|---|
| simple request DTO | record + Bean Validation |
| simple response DTO | record |
| projection/read model | record |
| event payload stabil | record atau immutable class dengan builder jika field banyak |
| many optional fields | builder class, bisa Lombok/manual |
| patch DTO | presence-aware model, tidak otomatis record sederhana |
| domain value object | record jika invariant sederhana; class jika behavior/invariant kompleks |
| JPA entity | class mutable/protected constructor, bukan record |

---

## 16. Builder vs Record: Decision Matrix

| Kriteria | Record | Lombok `@Value` | Lombok `@Builder` + `@Jacksonized` | Manual class |
|---|---|---|---|---|
| Java 8 support | Tidak | Ya | Ya | Ya |
| Boilerplate rendah | Sangat | Ya | Ya | Tidak |
| Native language feature | Ya | Tidak | Tidak | Ya |
| Banyak optional field | Kurang nyaman | Kurang nyaman | Baik | Bisa |
| Jackson deserialization | Baik di Jackson modern | Perlu perhatian | Baik dengan `@Jacksonized` | Eksplisit |
| MapStruct target | Baik | Baik jika constructor/getter jelas | Baik jika processor config benar | Baik |
| Update mapping | Tidak cocok | Tidak cocok | Tidak cocok | Tergantung mutable |
| JPA entity | Tidak cocok | Tidak cocok | Berisiko | Cocok jika dirancang |
| Invariant kompleks | Terbatas | Bisa | Bisa via constructor/factory | Paling fleksibel |
| Annotation processor dependency | Tidak | Ya | Ya | Tidak |
| Generated code ambiguity | Rendah | Sedang | Sedang-tinggi | Rendah |

---

## 17. Immutability: Apa yang Sebenarnya Kita Kejar?

Banyak engineer berkata “gunakan immutable DTO”. Tapi tujuannya apa?

Tujuan immutability:

1. object tidak berubah diam-diam setelah validasi
2. thread-safe untuk sharing read-only
3. mapper output stabil
4. audit/logging lebih trustworthy
5. mengurangi temporal coupling
6. mencegah framework/layer lain mengubah state internal
7. membuat test lebih deterministik

Tetapi immutability bukan silver bullet.

### 17.1 Immutable object masih bisa invalid

```java
public record Money(BigDecimal amount, String currency) {}
```

Ini immutable, tetapi bisa invalid:

```java
new Money(new BigDecimal("-100"), "")
```

Tambahkan invariant:

```java
public record Money(BigDecimal amount, String currency) {
    public Money {
        if (amount == null) {
            throw new IllegalArgumentException("amount is required");
        }
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("amount must be non-negative");
        }
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency is required");
        }
        currency = currency.trim().toUpperCase(Locale.ROOT);
    }
}
```

### 17.2 Immutable object masih bisa bocor mutable reference

```java
public record CustomerPermissions(List<String> permissions) {}
```

Fix:

```java
public record CustomerPermissions(List<String> permissions) {
    public CustomerPermissions {
        permissions = List.copyOf(permissions);
    }
}
```

### 17.3 Immutable object bisa menyulitkan partial update

PATCH semantics butuh representasi perubahan, bukan object final penuh.

Jangan pakai full immutable DTO untuk patch jika kamu butuh absent/null distinction.

Buruk:

```java
public record CustomerPatchRequest(
    String fullName,
    String email,
    String phoneNumber
) {}
```

Karena `null` bisa berarti:

- field absent
- user ingin clear field
- Jackson default karena missing
- invalid input

Lebih baik pakai model presence-aware:

```java
public final class FieldPatch<T> {
    private final boolean present;
    private final T value;

    private FieldPatch(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> FieldPatch<T> absent() {
        return new FieldPatch<>(false, null);
    }

    public static <T> FieldPatch<T> of(T value) {
        return new FieldPatch<>(true, value);
    }

    public boolean isPresent() { return present; }
    public T getValue() { return value; }
}
```

Atau gunakan JSON Merge Patch / JSON Patch model secara eksplisit.

---

## 18. Designing Immutable Request DTOs

Request DTO adalah input dari luar. Jangan hanya bertanya “bisa deserialize atau tidak”. Tanya:

- apakah unknown field ditolak?
- apakah required field benar-benar required?
- apakah null allowed?
- apakah defaulting eksplisit?
- apakah normalization terjadi di tempat yang tepat?
- apakah error response bisa dimengerti?
- apakah raw input perlu diaudit?

### 18.1 Simple create request dengan record

```java
public record CreateCustomerRequest(
    @NotBlank String fullName,
    @Email @NotBlank String email
) {}
```

Controller:

```java
@PostMapping("/customers")
public CustomerResponse create(@Valid @RequestBody CreateCustomerRequest request) {
    CreateCustomerCommand command = mapper.toCommand(request);
    Customer customer = service.create(command);
    return mapper.toResponse(customer);
}
```

### 18.2 Create request dengan Lombok builder

```java
@Value
@Builder
@Jacksonized
public class CreateCustomerRequest {
    @NotBlank
    String fullName;

    @Email
    @NotBlank
    String email;
}
```

### 18.3 Jangan taruh security-derived field di request DTO

Buruk:

```java
public record CreateCustomerRequest(
    String fullName,
    String email,
    String createdByUserId,
    Set<String> roles
) {}
```

Lebih baik:

```java
public record CreateCustomerRequest(
    String fullName,
    String email
) {}
```

Lalu command dibentuk dari request + authenticated principal:

```java
@Mapper(componentModel = "spring")
public interface CustomerCommandMapper {

    @Mapping(target = "createdByUserId", source = "actor.userId")
    @Mapping(target = "fullName", source = "request.fullName")
    @Mapping(target = "email", source = "request.email")
    CreateCustomerCommand toCommand(CreateCustomerRequest request, Actor actor);
}
```

Target:

```java
public record CreateCustomerCommand(
    String fullName,
    String email,
    String createdByUserId
) {}
```

---

## 19. Designing Immutable Response DTOs

Response DTO biasanya lebih aman untuk immutable/record karena tidak perlu partial update.

```java
public record CustomerResponse(
    String id,
    String fullName,
    String email,
    String status,
    Instant createdAt
) {}
```

MapStruct:

```java
@Mapper(componentModel = "spring")
public interface CustomerResponseMapper {

    @Mapping(target = "fullName", expression = "java(customer.getFirstName() + \" \" + customer.getLastName())")
    CustomerResponse toResponse(Customer customer);
}
```

### 19.1 Jangan expose entity shape

Buruk:

```java
public record CustomerResponse(
    Long databaseId,
    String encryptedEmail,
    String internalStatusCode,
    String createdByBatchJob,
    Integer version
) {}
```

Kecuali memang admin/internal endpoint.

Lebih baik:

```java
public record CustomerResponse(
    String customerId,
    String fullName,
    String email,
    String status,
    Instant registeredAt
) {}
```

### 19.2 Masking dan derived fields

Untuk sensitive output, jangan mengandalkan Lombok/Jackson annotation tersebar tanpa policy.

```java
public record CustomerSummaryResponse(
    String customerId,
    String displayName,
    String maskedEmail
) {}
```

Mapping:

```java
@Mapper(componentModel = "spring", uses = MaskingMapper.class)
public interface CustomerSummaryMapper {

    @Mapping(target = "displayName", source = "name")
    @Mapping(target = "maskedEmail", source = "email", qualifiedByName = "maskEmail")
    CustomerSummaryResponse toSummary(Customer customer);
}
```

---

## 20. Event DTO: Be More Conservative Than API DTO

Event payloads hidup lebih lama daripada API response. Mereka bisa disimpan di log, queue, outbox, object storage, data lake, replay pipeline, audit trail.

Untuk event DTO:

- prefer explicit version field
- jangan rename field sembarangan
- jangan bergantung pada default runtime yang berubah
- gunakan immutable payload
- test golden JSON
- hindari Lombok magic yang membuat contract tidak jelas

Contoh:

```java
@Value
@Builder
@Jacksonized
public class CustomerRegisteredEventV1 {
    @Builder.Default
    String schemaVersion = "1.0";

    String eventId;
    String customerId;
    String fullName;
    String email;
    Instant occurredAt;
}
```

Atau record:

```java
public record CustomerRegisteredEventV1(
    String schemaVersion,
    String eventId,
    String customerId,
    String fullName,
    String email,
    Instant occurredAt
) {
    public CustomerRegisteredEventV1 {
        if (schemaVersion == null) {
            schemaVersion = "1.0";
        }
    }
}
```

Namun default pada compact constructor juga harus diuji dengan deserialization.

### 20.1 Event builder caution

Builder membuat event mudah dibuat dari test/service, tetapi juga mudah lupa required field.

Tambahkan factory:

```java
public final class CustomerEvents {
    private CustomerEvents() {}

    public static CustomerRegisteredEventV1 registered(Customer customer, Clock clock) {
        return CustomerRegisteredEventV1.builder()
            .schemaVersion("1.0")
            .eventId(UUID.randomUUID().toString())
            .customerId(customer.getId())
            .fullName(customer.getFullName())
            .email(customer.getEmail())
            .occurredAt(Instant.now(clock))
            .build();
    }
}
```

---

## 21. JPA Entity: Lombok/Jackson/MapStruct Danger Zone

JPA entity adalah kategori khusus. Jangan memakai pattern DTO secara membabi-buta.

Buruk:

```java
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
public class CustomerEntity {
    @Id
    private Long id;

    private String name;

    @OneToMany(mappedBy = "customer")
    private List<OrderEntity> orders;
}
```

Masalah:

- `@Data` menghasilkan `equals/hashCode/toString` yang bisa menyentuh lazy relation
- `@ToString` bisa trigger lazy loading atau recursion
- `@EqualsAndHashCode` dengan relation bisa recursion/performance issue
- `@Builder` bisa bypass lifecycle methods/invariant
- Jackson serializing entity bisa trigger lazy loading
- bidirectional relation bisa infinite recursion
- entity field internal bisa bocor ke API

### 21.1 Entity Lombok minimal

Lebih aman:

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class CustomerEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String customerNumber;
    private String name;
    private String email;

    protected CustomerEntity() {
    }

    public CustomerEntity(String customerNumber, String name, String email) {
        this.customerNumber = requireNonBlank(customerNumber, "customerNumber");
        this.name = requireNonBlank(name, "name");
        this.email = requireNonBlank(email, "email");
    }

    public void changeEmail(String newEmail) {
        this.email = requireNonBlank(newEmail, "newEmail");
    }
}
```

Hindari:

- `@Data` pada entity
- `@Builder` pada entity kecuali sangat dikontrol
- expose entity ke Jackson langsung
- MapStruct update langsung dari request DTO ke entity tanpa policy

### 21.2 MapStruct entity update harus eksplisit

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CustomerEntityUpdater {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "customerNumber", ignore = true)
    @Mapping(target = "orders", ignore = true)
    void updateFromCommand(UpdateCustomerCommand command, @MappingTarget CustomerEntity entity);
}
```

Tetapi untuk domain-rich entity, lebih baik panggil method domain:

```java
public void apply(UpdateCustomerCommand command, CustomerEntity entity) {
    if (command.email() != null) {
        entity.changeEmail(command.email());
    }
}
```

MapStruct cocok untuk data transformation, bukan menggantikan domain behavior.

---

## 22. Lombok `@With`: Immutable Update Convenience

Lombok menyediakan `@With` untuk membuat copy immutable dengan satu field berubah.

```java
@Value
@With
public class CustomerSnapshot {
    String id;
    String name;
    String email;
}
```

Pemakaian:

```java
CustomerSnapshot updated = oldSnapshot.withEmail("new@example.com");
```

Ini berguna untuk immutable read model atau event snapshot.

### 22.1 Jangan pakai `@With` sebagai PATCH model tanpa semantic

```java
snapshot = snapshot.withEmail(request.email());
```

Jika `request.email()` null, apakah artinya clear? absent? invalid? Tidak jelas.

Gunakan `@With` hanya ketika perubahan sudah diputuskan oleh policy layer.

---

## 23. Lombok `@SuperBuilder` + Jackson + MapStruct

Inheritance dengan builder lebih rumit.

```java
@Getter
@SuperBuilder
@Jacksonized
public abstract class BaseResponse {
    private final String requestId;
}

@Getter
@SuperBuilder
@Jacksonized
public class CustomerResponse extends BaseResponse {
    private final String customerId;
    private final String name;
}
```

Masalah potensial:

- builder class menjadi lebih kompleks
- Jackson polymorphism perlu discriminator jika target abstract/base
- MapStruct builder detection bisa bingung pada inheritance
- equals/hashCode/toString inheritance perlu explicit strategy
- API DTO inheritance sering membuat contract kurang jelas

### 23.1 Prefer composition over DTO inheritance

Daripada:

```java
public class CustomerResponse extends BaseResponse
```

Sering lebih jelas:

```java
public record CustomerResponse(
    ResponseMeta meta,
    String customerId,
    String name
) {}

public record ResponseMeta(
    String requestId,
    Instant generatedAt
) {}
```

Composition lebih mudah untuk JSON contract, testing, MapStruct, dan evolusi.

---

## 24. `@Accessors(fluent = true)` dan Framework Introspection

Lombok dapat membuat accessor fluent:

```java
@Getter
@Accessors(fluent = true)
public class CustomerDto {
    private String name;
}
```

Accessor menjadi:

```java
customer.name()
```

bukan:

```java
customer.getName()
```

Ini bisa memengaruhi:

- Jackson property discovery
- MapStruct property discovery
- JavaBean conventions
- framework lama
- EL/template engines

Dengan Lombok versi baru, `@Jacksonized` menambahkan dukungan untuk beberapa skenario `@Accessors`, tetapi untuk production code enterprise, fluent accessors pada DTO harus dipakai hati-hati.

Rule:

- untuk API DTO umum, prefer JavaBean getter atau records
- untuk internal DSL, fluent accessors boleh
- jangan campur convention per module tanpa standar

---

## 25. Constructor Visibility: Jackson, MapStruct, Lombok

Constructor visibility sering menjadi sumber bug.

### 25.1 Private all-args constructor + builder

```java
@Value
@Builder
@Jacksonized
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class CustomerPayload {
    String id;
    String name;
}
```

Builder tetap bisa membuat object jika builder berada di dalam class dan punya akses.

Jackson dengan builder juga bisa membuat object via builder.

MapStruct juga bisa memakai builder.

Ini bisa bagus untuk memaksa semua construction lewat builder.

### 25.2 Public constructor + builder

```java
@Value
@Builder
public class CustomerPayload {
    String id;
    String name;
}
```

Sekarang ada dua jalur construction:

- constructor
- builder

Default/invariant bisa berbeda jika tidak hati-hati.

### 25.3 Rule

Jika builder adalah jalur resmi, buat constructor tidak menjadi API utama, kecuali ada alasan kuat.

Untuk DTO boundary sederhana, records lebih jelas.

---

## 26. Required Field: Lombok `@NonNull`, Bean Validation, Jackson Required

Ada beberapa konsep “required” yang sering tercampur.

| Mekanisme | Waktu | Fungsi | Keterbatasan |
|---|---:|---|---|
| Lombok `@NonNull` | runtime dalam generated constructor/setter | null check | tidak berarti field wajib hadir di JSON secara semantic |
| Bean Validation `@NotNull` | validation phase | input validation | harus dipicu oleh framework/validator |
| Jackson `@JsonProperty(required = true)` | deserialization metadata | creator property required hint/strictness tergantung config | tidak selalu cukup untuk semua missing/null case |
| Java primitive | construction/binding | tidak bisa null | missing bisa jadi default `0/false`, berbahaya |

### 26.1 Lombok `@NonNull`

```java
@Value
@Builder
@Jacksonized
public class CreateCustomerRequest {
    @NonNull
    String fullName;

    @NonNull
    String email;
}
```

Jika builder menerima null, Lombok bisa generate null check.

Tetapi error-nya mungkin `NullPointerException`, bukan structured API validation error.

Untuk API request, prefer Bean Validation:

```java
@Value
@Builder
@Jacksonized
public class CreateCustomerRequest {
    @NotBlank
    String fullName;

    @Email
    @NotBlank
    String email;
}
```

### 26.2 Jangan pakai primitive untuk required input kecuali benar-benar aman

Buruk:

```java
public record SearchRequest(int page, int size) {}
```

Jika field missing dan mapper/config tertentu memberi default `0`, validation harus menangkap.

Lebih eksplisit:

```java
public record SearchRequest(
    @NotNull @Min(1) Integer page,
    @NotNull @Min(1) @Max(100) Integer size
) {}
```

Atau default eksplisit di layer normalization.

---

## 27. MapStruct + Lombok Builder Defaults

Misalkan target:

```java
@Value
@Builder
public class SearchCommand {
    String query;

    @Builder.Default
    int page = 1;

    @Builder.Default
    int size = 20;
}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface SearchMapper {
    SearchCommand toCommand(SearchRequest request);
}
```

Jika `SearchRequest.page` null dan MapStruct memanggil:

```java
builder.page(request.getPage())
```

untuk primitive target bisa ada conversion problem. Jika target `Integer`, explicit null bisa override default.

### 27.1 Default harus dikontrol di mapper atau normalization layer

Lebih jelas:

```java
@Mapper(componentModel = "spring")
public interface SearchMapper {

    @Mapping(target = "page", expression = "java(request.page() == null ? 1 : request.page())")
    @Mapping(target = "size", expression = "java(request.size() == null ? 20 : request.size())")
    SearchCommand toCommand(SearchRequest request);
}
```

Lebih maintainable:

```java
public final class SearchNormalizer {
    public NormalizedSearch normalize(SearchRequest request) {
        return new NormalizedSearch(
            request.query(),
            request.page() == null ? 1 : request.page(),
            request.size() == null ? 20 : request.size()
        );
    }
}
```

Kemudian MapStruct mapping dari normalized model.

Rule:

> Jika default punya semantic, jangan berharap `@Builder.Default` diam-diam menyelesaikan semua jalur mapping.

---

## 28. MapStruct `@AfterMapping` dengan Lombok Builder

Untuk target builder, `@AfterMapping` bisa menerima builder target.

Contoh:

```java
@Mapper(componentModel = "spring")
public abstract class CustomerMapper {

    public abstract CustomerResponse toResponse(Customer customer);

    @AfterMapping
    protected void mask(@MappingTarget CustomerResponse.CustomerResponseBuilder builder, Customer customer) {
        if (customer.isRestricted()) {
            builder.email(null);
        }
    }
}
```

Ini powerful tetapi berisiko.

### 28.1 Risiko hidden mutation

Mapping utama terlihat seperti mapping biasa, tetapi `@AfterMapping` mengubah hasil.

Pastikan:

- nama method jelas
- test mencakup branch
- jangan taruh business decision berat di hook
- gunakan hook untuk adjustment kecil, bukan workflow

Lebih eksplisit kadang lebih baik:

```java
public CustomerResponse toResponse(Customer customer, Viewer viewer) {
    CustomerResponse raw = delegate.toResponse(customer);
    return redactor.redact(raw, viewer);
}
```

---

## 29. Records, Builders, and Large DTOs

Record dengan 3–6 fields enak.

```java
public record CustomerSummary(String id, String name, String email) {}
```

Record dengan 25 fields mulai sulit:

```java
public record CustomerDetailResponse(
    String id,
    String name,
    String email,
    String phone,
    String status,
    String type,
    Instant createdAt,
    Instant updatedAt,
    String createdBy,
    String updatedBy,
    // ... banyak lagi
) {}
```

Masalah:

- constructor call sulit dibaca
- field order bug risk
- MapStruct generated constructor mungkin benar, tetapi manual test fixture menyakitkan
- evolution sulit

### 29.1 Gunakan nested records/composition

```java
public record CustomerDetailResponse(
    CustomerIdentity identity,
    CustomerContact contact,
    CustomerLifecycle lifecycle,
    AuditInfo audit
) {}

public record CustomerIdentity(String id, String name, String type) {}
public record CustomerContact(String email, String phone) {}
public record CustomerLifecycle(String status, Instant registeredAt) {}
public record AuditInfo(String createdBy, Instant createdAt, String updatedBy, Instant updatedAt) {}
```

Lebih baik untuk:

- readability
- JSON grouping jika contract mengizinkan
- MapStruct nested mapping
- test fixture
- evolusi field per cluster

### 29.2 Jika flat contract wajib, builder bisa lebih nyaman

```java
@Value
@Builder
@Jacksonized
public class CustomerDetailResponse {
    String id;
    String name;
    String email;
    String phone;
    String status;
    String type;
    Instant createdAt;
    Instant updatedAt;
    String createdBy;
    String updatedBy;
}
```

Flat API contract tetap bisa dipertahankan, sementara construction lebih readable.

---

## 30. Testing Compatibility Across Lombok, Jackson, and MapStruct

Untuk kombinasi ini, unit test biasa belum cukup.

Minimal test suite:

1. Jackson serialization test
2. Jackson deserialization test
3. round-trip test jika relevan
4. MapStruct generated mapping test
5. null/missing/default test
6. unknown field test
7. generated source inspection saat upgrade
8. golden payload test untuk API/event

### 30.1 Serialization test

```java
@Test
void serializeCustomerResponse() throws Exception {
    CustomerResponse response = CustomerResponse.builder()
        .id("CUST-001")
        .fullName("Jane Doe")
        .email("jane@example.com")
        .build();

    String json = objectMapper.writeValueAsString(response);

    assertThatJson(json).isEqualTo("""
        {
          "id": "CUST-001",
          "fullName": "Jane Doe",
          "email": "jane@example.com"
        }
        """);
}
```

### 30.2 Deserialization test

```java
@Test
void deserializeCreateCustomerRequest() throws Exception {
    String json = """
        {
          "fullName": "Jane Doe",
          "email": "jane@example.com"
        }
        """;

    CreateCustomerRequest request = objectMapper.readValue(json, CreateCustomerRequest.class);

    assertThat(request.getFullName()).isEqualTo("Jane Doe");
    assertThat(request.getEmail()).isEqualTo("jane@example.com");
}
```

### 30.3 Default test

```java
@Test
void applyDefaultPageAndSizeWhenMissing() throws Exception {
    SearchRequest request = objectMapper.readValue("""
        { "query": "java" }
        """, SearchRequest.class);

    assertThat(request.getPage()).isEqualTo(1);
    assertThat(request.getSize()).isEqualTo(20);
}
```

### 30.4 Explicit null test

```java
@Test
void rejectExplicitNullPage() {
    assertThatThrownBy(() -> objectMapper.readValue("""
        { "query": "java", "page": null }
        """, SearchRequest.class))
        .isInstanceOf(Exception.class);
}
```

### 30.5 MapStruct mapping test

```java
@Test
void mapEntityToImmutableResponse() {
    CustomerEntity entity = new CustomerEntity("CUST-001", "Jane", "Doe", "jane@example.com");

    CustomerResponse response = mapper.toResponse(entity);

    assertThat(response.getId()).isEqualTo("CUST-001");
    assertThat(response.getFullName()).isEqualTo("Jane Doe");
    assertThat(response.getEmail()).isEqualTo("jane@example.com");
}
```

### 30.6 Golden payload test

Golden payload file:

```json
{
  "id": "CUST-001",
  "fullName": "Jane Doe",
  "email": "jane@example.com"
}
```

Test:

```java
@Test
void customerResponseContractShouldNotDrift() throws Exception {
    CustomerResponse response = fixture.customerResponse();

    String actual = objectMapper.writerWithDefaultPrettyPrinter()
        .writeValueAsString(response);

    String expected = readResource("contracts/customer-response-v1.json");
    assertThatJson(actual).isEqualTo(expected);
}
```

---

## 31. Build and IDE Checklist

Kombinasi Lombok + MapStruct sangat bergantung pada build setup.

Checklist:

- `lombok` ada di `compileOnly`/`provided`, bukan runtime dependency utama
- `lombok` ada di annotation processor path
- `mapstruct-processor` ada di annotation processor path
- `lombok-mapstruct-binding` ada jika kombinasi versi membutuhkannya
- IDE annotation processing aktif
- CI build tidak bergantung pada IDE plugin
- generated sources masuk ke target/generated-sources atau build/generated
- generated sources tidak perlu committed kecuali policy organisasi mengharuskan
- compile warning MapStruct tidak diabaikan
- `unmappedTargetPolicy = ERROR` untuk mapper penting
- upgrade JDK dites dengan clean build

### 31.1 Jangan percaya incremental compilation sepenuhnya

Kadang IDE incremental compilation tidak mencerminkan clean CI build.

Selalu lakukan:

```bash
mvn clean test
```

atau:

```bash
./gradlew clean test
```

Saat mengubah:

- Lombok version
- MapStruct version
- JDK version
- compiler plugin
- DTO annotation
- builder naming

---

## 32. Common Failure Modes and Diagnosis

### 32.1 Jackson tidak bisa deserialize Lombok builder DTO

Error:

```text
Cannot construct instance of `CreateCustomerRequest`
(no Creators, like default constructor, exist)
```

Kemungkinan:

- tidak ada `@Jacksonized`
- tidak ada `@JsonDeserialize(builder = ...)`
- constructor tidak diberi `@JsonCreator`
- parameter names tidak tersedia
- ObjectMapper module kurang

Fix:

```java
@Value
@Builder
@Jacksonized
public class CreateCustomerRequest {
    String fullName;
    String email;
}
```

Atau explicit Jackson builder annotation.

### 32.2 Field hasil deserialization null semua

Kemungkinan:

- builder method prefix tidak cocok
- JSON property name berbeda
- fluent accessor tidak dikenali
- naming strategy mismatch
- `@JsonPOJOBuilder(withPrefix = "")` hilang

Fix:

```java
@JsonPOJOBuilder(withPrefix = "")
```

atau `@Jacksonized`.

### 32.3 MapStruct tidak melihat Lombok getter/builder

Error:

```text
No property named "..." exists
```

Kemungkinan:

- annotation processor path salah
- Lombok processor tidak jalan
- `lombok-mapstruct-binding` belum ditambahkan
- IDE build berbeda dengan Maven/Gradle

Fix build config.

### 32.4 MapStruct memakai builder padahal ingin setter

Gejala:

- generated code memakai `Target.builder()`
- update mapping tidak bekerja seperti expected

Fix:

```java
@Mapper(builder = @Builder(disableBuilder = true))
```

atau refactor target.

### 32.5 `@Builder.Default` tidak berlaku

Kemungkinan:

- object dibuat lewat constructor, bukan builder
- MapStruct mengirim explicit null
- field default tidak sesuai jalur deserialization

Fix:

- test default behavior
- pindahkan default ke normalization/factory
- hindari semantic default tersembunyi

### 32.6 Record deserialization gagal

Kemungkinan:

- Jackson terlalu lama
- module/config tidak sesuai
- annotation naming mismatch
- compact constructor throw exception
- non-public record/class visibility issue

Fix:

- upgrade Jackson
- tambahkan test deserialization
- beri `@JsonProperty` jika nama berbeda
- pastikan exception handling API rapi

---

## 33. Boundary Patterns

### 33.1 Pattern A: Java 8 Immutable Request DTO with Lombok Builder

```java
@Value
@Builder
@Jacksonized
public class CreateCaseRequest {
    @NotBlank
    String applicantName;

    @NotBlank
    String applicationType;

    String remarks;
}
```

Mapper:

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CaseCommandMapper {

    @Mapping(target = "submittedBy", source = "actor.userId")
    @Mapping(target = "applicantName", source = "request.applicantName")
    @Mapping(target = "applicationType", source = "request.applicationType")
    @Mapping(target = "remarks", source = "request.remarks")
    CreateCaseCommand toCommand(CreateCaseRequest request, Actor actor);
}
```

Command:

```java
@Value
@Builder
public class CreateCaseCommand {
    String applicantName;
    String applicationType;
    String remarks;
    String submittedBy;
}
```

### 33.2 Pattern B: Java 21+ Record Request DTO

```java
public record CreateCaseRequest(
    @NotBlank String applicantName,
    @NotBlank String applicationType,
    String remarks
) {}
```

Command:

```java
public record CreateCaseCommand(
    String applicantName,
    String applicationType,
    String remarks,
    String submittedBy
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CaseCommandMapper {

    @Mapping(target = "submittedBy", source = "actor.userId")
    CreateCaseCommand toCommand(CreateCaseRequest request, Actor actor);
}
```

### 33.3 Pattern C: Large Response DTO with Lombok Builder

```java
@Value
@Builder
@Jacksonized
public class CaseDetailResponse {
    String caseId;
    String caseNumber;
    String status;
    String applicantName;
    String applicationType;
    Instant submittedAt;
    String submittedBy;
    List<DocumentSummaryResponse> documents;
    List<ActionSummaryResponse> availableActions;
}
```

Mapper:

```java
@Mapper(
    componentModel = "spring",
    uses = {DocumentMapper.class, ActionMapper.class},
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface CaseDetailMapper {

    @Mapping(target = "availableActions", source = "actions")
    CaseDetailResponse toResponse(CaseAggregate caseAggregate, List<Action> actions);
}
```

### 33.4 Pattern D: Event DTO with Explicit Version

```java
@Value
@Builder
@Jacksonized
public class CaseSubmittedEventV1 {
    @Builder.Default
    String schemaVersion = "1.0";

    String eventId;
    String caseId;
    String caseNumber;
    String submittedBy;
    Instant occurredAt;
}
```

Test wajib:

- serialize golden payload
- deserialize golden payload
- missing optional field compatibility
- unknown future field behavior

---

## 34. Style Guide Recommendation

Untuk tim enterprise, jangan biarkan setiap developer memilih sendiri.

### 34.1 Recommended standard untuk Java 8 legacy

1. Request DTO:
   - simple mutable JavaBean jika framework lama perlu
   - atau `@Value @Builder @Jacksonized` jika immutable desired
2. Response DTO:
   - `@Value` untuk sederhana
   - `@Value @Builder` untuk banyak field
3. Event DTO:
   - immutable, explicit version, golden tests
   - `@Jacksonized` jika builder-based
4. Entity:
   - `@Getter`
   - protected no-args constructor
   - no `@Data`
   - no direct Jackson exposure
5. Mapper:
   - MapStruct dengan `unmappedTargetPolicy = ERROR`
   - explicit ignore untuk security/internal fields
   - generated source inspected during review

### 34.2 Recommended standard untuk Java 21/25 modern

1. Simple request/response DTO:
   - records
2. Large response DTO:
   - nested records atau Lombok builder jika flat contract besar
3. Commands:
   - records jika simple
   - class/factory jika invariant kompleks
4. Patch DTO:
   - presence-aware model
   - jangan naive record dengan nullable fields tanpa policy
5. Event DTO:
   - record atau immutable builder class
   - explicit schema version
6. Lombok:
   - still allowed for builders and entity boilerplate reduction
   - avoid `@Data` on important boundary/domain/entity classes
7. MapStruct:
   - constructor/record mapping for simple targets
   - builder mapping for large immutable targets
   - disable builder where harmful

---

## 35. Review Checklist

Gunakan checklist ini saat code review DTO/mapper yang memakai Lombok, Jackson, dan MapStruct.

### 35.1 Jackson compatibility

- Apakah DTO perlu deserialization, atau hanya serialization?
- Jika immutable builder-based, apakah ada `@Jacksonized` atau `@JsonDeserialize(builder = ...)`?
- Apakah builder prefix cocok?
- Apakah unknown field policy jelas?
- Apakah null/missing/default behavior dites?
- Apakah naming strategy sesuai contract?
- Apakah golden payload tersedia untuk public/event contract?

### 35.2 MapStruct compatibility

- Apakah Lombok + MapStruct annotation processor setup benar?
- Apakah `lombok-mapstruct-binding` diperlukan dan sudah ada?
- Apakah generated mapper memakai builder/constructor/setter yang diharapkan?
- Apakah `unmappedTargetPolicy` cukup ketat?
- Apakah internal/security fields di-ignore explicit?
- Apakah defaulting dilakukan di tempat yang jelas?
- Apakah `@AfterMapping` tidak menyembunyikan business logic besar?

### 35.3 Lombok usage

- Apakah `@Data` dihindari pada entity/domain/boundary penting?
- Apakah `@Builder.Default` punya test?
- Apakah `@EqualsAndHashCode` aman dari lazy relation/cycle?
- Apakah `@ToString` tidak membocorkan data sensitif?
- Apakah constructor visibility sesuai intended construction path?
- Apakah annotation Lombok membuat public API terlalu luas?

### 35.4 Immutability

- Apakah immutable object benar-benar deep-safe untuk collection/map?
- Apakah invariant tetap dijaga?
- Apakah patch/update semantics tidak dikaburkan oleh null?
- Apakah default bukan policy tersembunyi?
- Apakah record digunakan untuk kasus yang cocok?

---

## 36. Practical Decision Tree

### 36.1 Saat membuat response DTO baru

Pertanyaan:

1. Java 16+?
2. Field sedikit dan contract sederhana?
3. Tidak butuh builder?

Jika ya:

```java
public record CustomerResponse(String id, String name, String email) {}
```

Jika field banyak atau flat contract besar:

```java
@Value
@Builder
@Jacksonized
public class CustomerDetailResponse { ... }
```

Jika response hanya internal dan tidak perlu deserialization, `@Jacksonized` optional. Tetapi untuk round-trip/golden test, tambahkan.

### 36.2 Saat membuat request DTO baru

Pertanyaan:

1. Butuh strict validation?
2. Butuh distinguish absent vs null?
3. Butuh many optional fields?

Simple create:

```java
public record CreateCustomerRequest(@NotBlank String name, @Email String email) {}
```

Large optional input:

```java
@Value
@Builder
@Jacksonized
public class SearchCustomerRequest { ... }
```

PATCH:

```java
public class PatchCustomerRequest {
    private FieldPatch<String> name = FieldPatch.absent();
    private FieldPatch<String> email = FieldPatch.absent();
}
```

### 36.3 Saat membuat command

Jika command hanya membawa intent simple:

```java
public record CreateCustomerCommand(String name, String email, String actorId) {}
```

Jika command punya invariant/default/factory:

```java
@Getter
public final class CreateCustomerCommand {
    private final String name;
    private final String email;
    private final String actorId;

    private CreateCustomerCommand(String name, String email, String actorId) {
        this.name = normalizeName(name);
        this.email = normalizeEmail(email);
        this.actorId = requireNonBlank(actorId, "actorId");
    }

    public static CreateCustomerCommand of(String name, String email, String actorId) {
        return new CreateCustomerCommand(name, email, actorId);
    }
}
```

### 36.4 Saat membuat event payload

Prefer:

- immutable
- explicit schema version
- no accidental field rename
- golden tests
- stable JSON names

```java
@Value
@Builder
@Jacksonized
public class CustomerRegisteredEventV1 { ... }
```

atau:

```java
public record CustomerRegisteredEventV1(...) {}
```

---

## 37. Advanced Anti-Patterns

### 37.1 “One annotation to rule them all”

```java
@Data
@Builder
@Jacksonized
@Entity
public class Customer { ... }
```

Ini mencampur:

- persistence model
- API model
- builder construction
- equality logic
- JSON contract
- mutable entity lifecycle

Hindari.

### 37.2 “DTO inheritance hierarchy because fields are reused”

```java
class BaseCustomerDto { ... }
class CustomerDetailDto extends BaseCustomerDto { ... }
class CustomerAdminDto extends CustomerDetailDto { ... }
```

Ini sering membuat Jackson/MapStruct/Lombok interop makin kompleks.

Prefer composition atau duplication kecil yang disengaja.

### 37.3 “Patch with normal DTO”

```java
@Value
@Builder
@Jacksonized
public class PatchCustomerRequest {
    String name;
    String email;
}
```

Tidak bisa membedakan absent dan null.

### 37.4 “Trust generated defaults”

```java
@Builder.Default
Status status = Status.DRAFT;
```

Lalu semua layer berasumsi default berlaku. Padahal ada jalur constructor, MapStruct, deserialization, test fixture, dan reflection.

### 37.5 “MapStruct as security filter by accident”

Kalau field tidak ter-map karena kebetulan nama berbeda, jangan anggap aman. Gunakan explicit ignore dan policy.

---

## 38. End-to-End Example: Case Creation Boundary

### 38.1 API request

Java 21+:

```java
public record SubmitCaseRequest(
    @NotBlank String applicationType,
    @NotBlank String applicantName,
    String remarks
) {}
```

Java 8 style:

```java
@Value
@Builder
@Jacksonized
public class SubmitCaseRequest {
    @NotBlank
    String applicationType;

    @NotBlank
    String applicantName;

    String remarks;
}
```

### 38.2 Actor context

```java
public record Actor(
    String userId,
    String agencyCode,
    Set<String> roles
) {}
```

### 38.3 Command

```java
public record SubmitCaseCommand(
    String applicationType,
    String applicantName,
    String remarks,
    String submittedBy,
    String agencyCode
) {}
```

### 38.4 Mapper

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface SubmitCaseMapper {

    @Mapping(target = "submittedBy", source = "actor.userId")
    @Mapping(target = "agencyCode", source = "actor.agencyCode")
    SubmitCaseCommand toCommand(SubmitCaseRequest request, Actor actor);
}
```

### 38.5 Domain handling

```java
public CaseAggregate submit(SubmitCaseCommand command) {
    CaseAggregate aggregate = CaseAggregate.open(
        command.applicationType(),
        command.applicantName(),
        command.submittedBy(),
        command.agencyCode()
    );

    if (command.remarks() != null && !command.remarks().isBlank()) {
        aggregate.addInitialRemarks(command.remarks());
    }

    return repository.save(aggregate);
}
```

### 38.6 Response DTO

```java
public record SubmitCaseResponse(
    String caseId,
    String caseNumber,
    String status,
    Instant submittedAt
) {}
```

### 38.7 Event DTO

```java
@Value
@Builder
@Jacksonized
public class CaseSubmittedEventV1 {
    @Builder.Default
    String schemaVersion = "1.0";

    String eventId;
    String caseId;
    String caseNumber;
    String applicationType;
    String submittedBy;
    String agencyCode;
    Instant occurredAt;
}
```

### 38.8 Why this design works

- request tidak berisi `submittedBy`
- actor-derived fields dimasukkan di mapper/application boundary
- command adalah intent, bukan entity
- response berbeda dari event
- event punya version
- entity tidak diexpose ke Jackson
- MapStruct mapping strict
- Lombok builder hanya dipakai untuk event/large immutable shape
- record dipakai untuk simple DTO/command

---

## 39. Key Principles

1. Lombok mengubah bentuk source saat compile time; Jackson melihat runtime shape; MapStruct melihat compile-time model.
2. Serialization lebih mudah daripada deserialization; jangan menguji satu arah saja.
3. `@Builder` bukan kontrak JSON; perlu `@Jacksonized` atau annotation Jackson eksplisit.
4. `@Builder.Default` bukan tempat ideal untuk policy default yang kritis.
5. MapStruct builder detection berguna, tetapi harus dikontrol untuk security/internal fields.
6. Records adalah pilihan terbaik untuk DTO sederhana di Java modern.
7. Lombok `@Value` tetap berguna untuk Java 8 legacy.
8. Large flat DTO sering lebih nyaman dengan builder daripada record constructor panjang.
9. Patch/update tidak boleh dimodelkan sebagai DTO nullable biasa jika absent/null semantics penting.
10. JPA entity adalah zona bahaya untuk `@Data`, `@Builder`, dan direct Jackson exposure.
11. Generated code harus menjadi bagian dari review mental model.
12. Build setup annotation processor adalah bagian dari architecture, bukan sekadar konfigurasi.
13. Test deserialization, mapping, default, null, missing, unknown field, dan golden payload.
14. Immutability membantu correctness, tetapi tidak otomatis menjaga invariant atau deep immutability.
15. Boundary DTO harus dipilih berdasarkan contract, bukan berdasarkan “annotation favorit”.

---

## 40. Latihan Praktis

### Latihan 1 — Ubah Mutable DTO ke Immutable DTO

Ambil DTO berikut:

```java
public class CreateProductRequest {
    private String name;
    private BigDecimal price;
    private String currency;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
}
```

Buat dua versi:

1. Java 8 Lombok immutable + Jackson deserializable
2. Java 21 record

Pastikan:

- validation tidak hilang
- deserialization test ada
- default currency tidak tersembunyi jika punya makna bisnis

### Latihan 2 — Debug Lombok + MapStruct Failure

Buat target:

```java
@Value
@Builder
public class ProductResponse {
    String id;
    String name;
}
```

Buat mapper dari entity ke response.

Lalu sengaja hapus Lombok annotation processor dari build.

Amati error MapStruct.

Tambahkan konfigurasi yang benar dan inspect generated source.

### Latihan 3 — Builder Default Semantics

Buat request:

```java
@Value
@Builder
@Jacksonized
public class SearchRequest {
    String query;

    @Builder.Default
    Integer page = 1;

    @Builder.Default
    Integer size = 20;
}
```

Test:

- missing page
- explicit null page
- page 0
- size 1000

Putuskan apakah default sebaiknya di DTO, mapper, atau normalizer.

### Latihan 4 — Event Golden Payload

Buat event `CaseSubmittedEventV1`.

Test:

- serialize ke golden JSON
- deserialize dari golden JSON
- unknown future field behavior
- missing optional field behavior
- schemaVersion selalu ada

### Latihan 5 — Record vs Builder Review

Ambil DTO besar dengan 20 field.

Bandingkan:

- flat record
- nested records
- Lombok builder class

Nilai dari sisi:

- readability
- MapStruct generated code
- JSON contract
- test fixture
- backward compatibility

---

## 41. Ringkasan

Lombok, Jackson, dan MapStruct bisa menjadi kombinasi yang sangat produktif, tetapi hanya jika dipahami sebagai tiga mekanisme berbeda:

- Lombok membentuk source/bytecode melalui annotation processing.
- MapStruct menghasilkan mapper compile-time berdasarkan property/constructor/builder yang terlihat.
- Jackson melakukan runtime serialization/deserialization berdasarkan bytecode, annotation, module, dan introspection rules.

Untuk Java modern, records sering menjadi pilihan paling bersih untuk DTO sederhana. Untuk Java 8 legacy atau DTO besar, Lombok `@Value`, `@Builder`, dan `@Jacksonized` tetap sangat berguna. Untuk mapping antar boundary, MapStruct memberi type-safety dan generated code yang cepat, tetapi harus dikonfigurasi benar terutama saat Lombok ikut terlibat.

Level top engineer bukan sekadar tahu annotation apa yang dipakai, tetapi mampu menjawab:

- object ini dibuat oleh siapa?
- lewat jalur constructor, builder, setter, atau deserializer?
- field mana berasal dari user, sistem, security context, atau domain?
- default mana yang teknis dan mana yang policy?
- apakah mapper generated code sesuai niat?
- apakah JSON contract stabil saat class berubah?
- apakah immutable object benar-benar menjaga correctness?

Jika pertanyaan-pertanyaan itu bisa dijawab secara eksplisit, mapping layer akan menjadi aset arsitektur, bukan sumber bug tersembunyi.

---

## Referensi Utama

- Project Lombok — `@Jacksonized`, `@Builder`, dan API documentation.
- MapStruct Reference Guide 1.6.3 dan MapStruct FAQ tentang integrasi Lombok serta kebutuhan `lombok-mapstruct-binding` pada kombinasi versi tertentu.
- Jackson Databind API dan `@JsonPOJOBuilder` untuk builder-based deserialization.
- Dokumentasi MapStruct tentang builder detection dan generated mapper behavior.
- Java records sebagai fitur bahasa modern untuk data carrier immutable pada Java 16+.

---

## Status Seri

Selesai: Part 25 dari 35.

Belum selesai. Bagian berikutnya:

**Part 26 — Records, Builders, and Modern Java DTO Strategy**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./24-lombok-practical-getter-setter-builder-value-equals-hashcode.md">⬅️ Part 24 — Lombok Practical: Getter, Setter, Builder, Value, Equals, HashCode</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./26-records-builders-modern-java-dto-strategy.md">Part 26 — Records, Builders, and Modern Java DTO Strategy ➡️</a>
</div>
