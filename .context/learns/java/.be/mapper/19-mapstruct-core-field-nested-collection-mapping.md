# Part 19 — MapStruct Core: Field Mapping, Nested Mapping, Collection Mapping

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `19-mapstruct-core-field-nested-collection-mapping.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: MapStruct core mapping model — field, nested object, collection, map, enum, constants, defaults, expressions, composition, dan compile-time correctness.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita membangun mental model bahwa MapStruct bukan runtime mapper berbasis reflection, melainkan **annotation processor** yang menghasilkan Java code biasa saat compile time.

Bagian ini masuk ke penggunaan inti MapStruct.

Target setelah menyelesaikan bagian ini:

1. Mampu membaca MapStruct sebagai **declarative mapping specification**.
2. Mampu membedakan mapping otomatis yang aman dan mapping eksplisit yang wajib.
3. Mampu mendesain mapper untuk object sederhana, nested object, collection, map, dan enum.
4. Mampu memahami generated code dan konsekuensi null handling default.
5. Mampu menggunakan `@Mapping`, `@Mappings`, `@IterableMapping`, `@MapMapping`, `@EnumMapping`, `@ValueMapping`, `uses`, `defaultValue`, `constant`, dan `expression` secara tepat.
6. Mampu menetapkan policy `unmappedTargetPolicy` agar bug tidak diam-diam lolos.
7. Mampu menghindari mapper yang berubah menjadi service layer terselubung.

Core idea:

> MapStruct bukan alat untuk membuat mapping menjadi “magis”. MapStruct adalah alat untuk membuat mapping eksplisit, cepat, type-safe, dan dapat diperiksa oleh compiler.

---

## 2. Problem yang Diselesaikan MapStruct Core

Misalkan ada model API:

```java
public class CreateCustomerRequest {
    private String fullName;
    private String email;
    private String phoneNumber;
    private String identityNumber;
}
```

Dan command internal:

```java
public class CreateCustomerCommand {
    private String name;
    private EmailAddress email;
    private PhoneNumber phone;
    private String nationalId;
}
```

Manual mapping:

```java
public CreateCustomerCommand toCommand(CreateCustomerRequest request) {
    if (request == null) {
        return null;
    }

    CreateCustomerCommand command = new CreateCustomerCommand();
    command.setName(request.getFullName());
    command.setEmail(EmailAddress.of(request.getEmail()));
    command.setPhone(PhoneNumber.of(request.getPhoneNumber()));
    command.setNationalId(request.getIdentityNumber());
    return command;
}
```

Manual mapping ini bagus karena eksplisit. Tetapi pada codebase besar, masalahnya:

- mapping repetitive;
- field baru mudah lupa dimapping;
- nested object menjadi panjang;
- collection mapping boilerplate;
- enum conversion tersebar;
- null handling tidak konsisten;
- mapper antar boundary sulit distandardisasi;
- review menjadi sulit karena noise terlalu banyak.

MapStruct mencoba mempertahankan benefit manual mapping, tetapi mengurangi boilerplate.

Dengan MapStruct:

```java
@Mapper
public interface CustomerMapper {

    @Mapping(target = "name", source = "fullName")
    @Mapping(target = "email", source = "email")
    @Mapping(target = "phone", source = "phoneNumber")
    @Mapping(target = "nationalId", source = "identityNumber")
    CreateCustomerCommand toCommand(CreateCustomerRequest request);

    default EmailAddress mapEmail(String value) {
        return value == null ? null : EmailAddress.of(value);
    }

    default PhoneNumber mapPhone(String value) {
        return value == null ? null : PhoneNumber.of(value);
    }
}
```

MapStruct akan menghasilkan implementasi Java biasa, kira-kira:

```java
public class CustomerMapperImpl implements CustomerMapper {
    @Override
    public CreateCustomerCommand toCommand(CreateCustomerRequest request) {
        if (request == null) {
            return null;
        }

        CreateCustomerCommand command = new CreateCustomerCommand();
        command.setName(request.getFullName());
        command.setEmail(mapEmail(request.getEmail()));
        command.setPhone(mapPhone(request.getPhoneNumber()));
        command.setNationalId(request.getIdentityNumber());
        return command;
    }
}
```

Poin penting:

> MapStruct tidak menggantikan design thinking. Ia hanya menggenerate implementasi dari mapping decision yang kita deklarasikan.

---

## 3. Mental Model MapStruct Core

MapStruct bekerja dengan beberapa konsep utama:

```text
Source type
  |
  |  mapping method declaration
  v
Target type

Compiler + MapStruct annotation processor
  |
  v
Generated mapper implementation
```

Contoh:

```java
@Mapper
public interface OrderMapper {
    OrderResponse toResponse(Order order);
}
```

MapStruct akan mencoba membuat `OrderResponse` dari `Order` berdasarkan:

1. property name yang sama;
2. getter/setter JavaBean convention;
3. public fields jika sesuai;
4. constructor/builder/record support tergantung model;
5. mapping method lain yang tersedia;
6. built-in conversion;
7. custom method dalam mapper;
8. mapper lain yang didaftarkan via `uses`;
9. annotation `@Mapping` untuk instruksi eksplisit.

Kita bisa melihat MapStruct sebagai resolver:

```text
Untuk setiap target property:
  1. Apakah ada @Mapping eksplisit?
  2. Apakah ada source property dengan nama sama?
  3. Apakah tipe sama?
  4. Jika tipe beda, apakah ada conversion method?
  5. Jika nested, apakah ada mapper method yang cocok?
  6. Jika collection, apakah element mapper tersedia?
  7. Jika enum, apakah nama enum cocok atau ada mapping eksplisit?
  8. Jika tidak ada, compile warning/error tergantung policy.
```

Karena semua dilakukan saat compile time, MapStruct dapat memberi warning/error lebih awal.

---

## 4. Setup Minimal

### 4.1 Maven

Versi contoh gunakan MapStruct 1.6.x. Sesuaikan dengan standard project.

```xml
<properties>
    <org.mapstruct.version>1.6.3</org.mapstruct.version>
</properties>

<dependencies>
    <dependency>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct</artifactId>
        <version>${org.mapstruct.version}</version>
    </dependency>
</dependencies>

<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.13.0</version>
            <configuration>
                <source>21</source>
                <target>21</target>
                <annotationProcessorPaths>
                    <path>
                        <groupId>org.mapstruct</groupId>
                        <artifactId>mapstruct-processor</artifactId>
                        <version>${org.mapstruct.version}</version>
                    </path>
                </annotationProcessorPaths>
            </configuration>
        </plugin>
    </plugins>
</build>
```

Untuk Java 8:

```xml
<source>8</source>
<target>8</target>
```

### 4.2 Gradle

```groovy
dependencies {
    implementation 'org.mapstruct:mapstruct:1.6.3'
    annotationProcessor 'org.mapstruct:mapstruct-processor:1.6.3'
}
```

Jika menggunakan Lombok:

```groovy
dependencies {
    compileOnly 'org.projectlombok:lombok:1.18.38'
    annotationProcessor 'org.projectlombok:lombok:1.18.38'

    implementation 'org.mapstruct:mapstruct:1.6.3'
    annotationProcessor 'org.mapstruct:mapstruct-processor:1.6.3'
    annotationProcessor 'org.projectlombok:lombok-mapstruct-binding:0.2.0'
}
```

Versi Lombok perlu disesuaikan dengan JDK yang dipakai.

---

## 5. Mapper Declaration

Mapper paling sederhana:

```java
@Mapper
public interface UserMapper {
    UserDto toDto(User user);
}
```

Model:

```java
public class User {
    private Long id;
    private String username;
    private String email;

    public Long getId() { return id; }
    public String getUsername() { return username; }
    public String getEmail() { return email; }
}

public class UserDto {
    private Long id;
    private String username;
    private String email;

    public void setId(Long id) { this.id = id; }
    public void setUsername(String username) { this.username = username; }
    public void setEmail(String email) { this.email = email; }
}
```

Generated implementation akan melakukan copy property bernama sama.

Prinsip:

> Mapping otomatis hanya aman jika nama field sama dan semantic-nya sama.

Nama sama tidak selalu berarti makna sama.

Contoh bahaya:

```java
class UserEntity {
    private String status; // database lifecycle: ACTIVE, SUSPENDED, DELETED
}

class UserResponse {
    private String status; // UI display: Active, Suspended, Removed
}
```

Walaupun sama-sama `status`, semantic berbeda. Untuk kasus seperti ini, mapping harus eksplisit.

---

## 6. Getting Mapper Instance

Ada beberapa model.

### 6.1 Default Factory

```java
@Mapper
public interface UserMapper {
    UserMapper INSTANCE = Mappers.getMapper(UserMapper.class);

    UserDto toDto(User user);
}
```

Cocok untuk:

- library kecil;
- non-DI environment;
- unit test sederhana;
- pure mapper tanpa dependency.

### 6.2 Spring Component Model

```java
@Mapper(componentModel = "spring")
public interface UserMapper {
    UserDto toDto(User user);
}
```

Generated mapper menjadi Spring bean.

```java
@Service
public class UserQueryService {
    private final UserMapper userMapper;

    public UserQueryService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }
}
```

Cocok untuk Spring Boot application.

### 6.3 Jakarta CDI

```java
@Mapper(componentModel = "cdi")
public interface UserMapper {
    UserDto toDto(User user);
}
```

Cocok untuk Jakarta EE/CDI environment.

### 6.4 Policy

Dalam codebase besar, jangan campur semua style.

Pilih satu standard:

```text
Spring app      -> componentModel = "spring"
Jakarta CDI app -> componentModel = "cdi"
Library module  -> Mappers.getMapper
```

---

## 7. Basic Field Mapping

Jika field berbeda nama:

```java
public class Customer {
    private Long id;
    private String fullName;
    private String emailAddress;
}

public class CustomerResponse {
    private Long customerId;
    private String name;
    private String email;
}
```

Mapper:

```java
@Mapper
public interface CustomerMapper {

    @Mapping(target = "customerId", source = "id")
    @Mapping(target = "name", source = "fullName")
    @Mapping(target = "email", source = "emailAddress")
    CustomerResponse toResponse(Customer customer);
}
```

Mental model:

```text
source.id           -> target.customerId
source.fullName     -> target.name
source.emailAddress -> target.email
```

### 7.1 Direction Matters

Mapping entity ke response berbeda dengan request ke entity.

```java
@Mapper
public interface CustomerMapper {

    @Mapping(target = "customerId", source = "id")
    CustomerResponse toResponse(Customer customer);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Customer toEntity(CreateCustomerRequest request);
}
```

`toResponse` boleh membaca `id`.

`toEntity` dari create request tidak boleh menerima `id` dari client.

Ini bukan masalah teknis. Ini boundary security.

---

## 8. Ignoring Fields

Kadang target memiliki field yang tidak boleh dimapping dari source.

```java
@Mapper
public interface AccountMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    Account toEntity(CreateAccountRequest request);
}
```

Field yang sering perlu `ignore`:

- database id;
- audit fields;
- createdBy/updatedBy;
- version/optimistic lock;
- status lifecycle;
- role/permission;
- security flags;
- computed fields;
- server-generated reference number.

Rule:

> Jika field target tidak boleh dikontrol source, jangan hanya berharap source tidak punya field itu. Tandai mapping-nya secara eksplisit.

---

## 9. Constants and Default Values

### 9.1 Constant

`constant` selalu mengisi nilai yang sama.

```java
@Mapper
public interface CaseMapper {

    @Mapping(target = "status", constant = "DRAFT")
    @Mapping(target = "source", constant = "PORTAL")
    CaseEntity toEntity(CreateCaseRequest request);
}
```

Makna:

```text
request apapun -> status = DRAFT
request apapun -> source = PORTAL
```

Gunakan untuk:

- fixed lifecycle initial state;
- source channel;
- static type discriminator;
- system-created marker.

Jangan gunakan untuk business rule kompleks.

Buruk:

```java
@Mapping(target = "priority", constant = "HIGH")
CaseEntity toEntity(CreateCaseRequest request);
```

Jika priority bergantung pada category, risk score, SLA, atau complainant type, itu bukan constant mapping. Itu business policy.

### 9.2 Default Value

`defaultValue` digunakan ketika source value null.

```java
@Mapper
public interface UserMapper {

    @Mapping(target = "displayName", source = "name", defaultValue = "Unknown")
    UserResponse toResponse(User user);
}
```

Jika `user.getName()` null, target `displayName` menjadi `Unknown`.

Hati-hati:

```java
@Mapping(target = "country", source = "country", defaultValue = "SG")
```

Ini bisa benar jika sistem memang hanya Singapore-by-default. Tetapi bisa berbahaya jika null berarti data tidak lengkap.

Prinsip:

> Default value adalah policy. Jangan sembunyikan policy penting dalam mapper tanpa review.

---

## 10. Expressions

`expression` memungkinkan custom Java expression.

```java
@Mapper
public interface PersonMapper {

    @Mapping(target = "displayName", expression = "java(person.getFirstName() + \" \" + person.getLastName())")
    PersonResponse toResponse(Person person);
}
```

Generated code akan memasukkan expression tersebut.

Kelebihan:

- cepat untuk logic sederhana;
- tidak perlu method tambahan;
- useful untuk field derived ringan.

Kekurangan:

- raw Java string;
- refactoring kurang nyaman;
- compile error bisa kurang readable;
- mudah berubah menjadi logic kompleks;
- sulit diuji secara terpisah.

Lebih baik:

```java
@Mapper
public interface PersonMapper {

    @Mapping(target = "displayName", source = ".")
    PersonResponse toResponse(Person person);

    default String mapDisplayName(Person person) {
        if (person == null) {
            return null;
        }
        return String.join(" ", person.getFirstName(), person.getLastName()).trim();
    }
}
```

Atau lebih eksplisit:

```java
@Mapper
public interface PersonMapper {

    @Mapping(target = "displayName", expression = "java(toDisplayName(person))")
    PersonResponse toResponse(Person person);

    default String toDisplayName(Person person) {
        if (person == null) {
            return null;
        }
        return normalize(person.getFirstName()) + " " + normalize(person.getLastName());
    }

    default String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
```

Rule praktis:

```text
Expression boleh untuk glue kecil.
Expression buruk untuk business logic, branching kompleks, lookup, DB call, remote call, security decision.
```

---

## 11. Type Conversion

MapStruct memiliki built-in conversion untuk banyak tipe umum.

Contoh:

```java
public class InvoiceEntity {
    private Long id;
    private BigDecimal amount;
}

public class InvoiceResponse {
    private String id;
    private String amount;
}
```

Mapper:

```java
@Mapper
public interface InvoiceMapper {
    InvoiceResponse toResponse(InvoiceEntity invoice);
}
```

MapStruct bisa mengubah beberapa tipe melalui conversion bawaan, misalnya numeric ke string.

Tetapi untuk domain-sensitive type, gunakan explicit method.

```java
@Mapper
public interface MoneyMapper {

    @Mapping(target = "amount", source = "amount")
    PaymentResponse toResponse(Payment payment);

    default String map(BigDecimal amount) {
        return amount == null ? null : amount.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
```

Kenapa eksplisit?

Karena uang bukan sekadar angka.

Pertanyaan yang harus dijawab:

- scale berapa?
- rounding mode apa?
- currency disertakan atau tidak?
- locale formatting boleh atau tidak?
- trailing zero dipertahankan atau tidak?

Mapping financial/regulatory/reporting harus deterministik.

---

## 12. Custom Mapping Method

MapStruct dapat memakai method custom jika signature cocok.

```java
@Mapper
public interface CustomerMapper {

    CustomerResponse toResponse(Customer customer);

    default String map(EmailAddress emailAddress) {
        return emailAddress == null ? null : emailAddress.value();
    }
}
```

Jika target butuh `String` dan source punya `EmailAddress`, MapStruct dapat memakai method `map(EmailAddress)`.

Generated code:

```java
customerResponse.setEmail(map(customer.getEmail()));
```

### 12.1 Specific Method Lebih Aman Daripada Generic Method

Kurang baik:

```java
default String map(Object value) {
    return value == null ? null : value.toString();
}
```

Ini terlalu luas. Bisa dipakai MapStruct di tempat yang tidak kita maksud.

Lebih baik:

```java
default String emailToString(EmailAddress email) {
    return email == null ? null : email.value();
}
```

Dengan qualifier akan lebih aman, dibahas lebih dalam di Part 21.

---

## 13. Nested Mapping

Model:

```java
public class Order {
    private Long id;
    private Customer customer;
    private ShippingAddress shippingAddress;
}

public class Customer {
    private Long id;
    private String fullName;
}

public class ShippingAddress {
    private String line1;
    private String postalCode;
}
```

Response:

```java
public class OrderResponse {
    private Long id;
    private CustomerSummary customer;
    private AddressResponse shippingAddress;
}

public class CustomerSummary {
    private Long id;
    private String name;
}

public class AddressResponse {
    private String line1;
    private String postalCode;
}
```

Mapper:

```java
@Mapper
public interface OrderMapper {

    OrderResponse toResponse(Order order);

    @Mapping(target = "name", source = "fullName")
    CustomerSummary toCustomerSummary(Customer customer);

    AddressResponse toAddressResponse(ShippingAddress address);
}
```

MapStruct akan memakai method nested yang tersedia.

Mental model:

```text
Order -> OrderResponse
  id -> id
  customer -> toCustomerSummary(customer)
  shippingAddress -> toAddressResponse(shippingAddress)
```

Generated code kurang lebih:

```java
OrderResponse response = new OrderResponse();
response.setId(order.getId());
response.setCustomer(toCustomerSummary(order.getCustomer()));
response.setShippingAddress(toAddressResponse(order.getShippingAddress()));
```

### 13.1 Nested Path Mapping

Kadang target flatten field dari nested source.

```java
public class OrderFlatResponse {
    private Long orderId;
    private Long customerId;
    private String customerName;
    private String postalCode;
}
```

Mapper:

```java
@Mapper
public interface OrderMapper {

    @Mapping(target = "orderId", source = "id")
    @Mapping(target = "customerId", source = "customer.id")
    @Mapping(target = "customerName", source = "customer.fullName")
    @Mapping(target = "postalCode", source = "shippingAddress.postalCode")
    OrderFlatResponse toFlatResponse(Order order);
}
```

MapStruct akan melakukan null checks pada nested path sesuai strategy-nya.

Secara konseptual:

```text
order.customer.fullName -> response.customerName
```

### 13.2 Flattening vs Preserving Structure

Flattening berguna untuk:

- listing page;
- CSV export;
- report payload;
- simple grid;
- mobile lightweight payload.

Preserving nested structure lebih baik untuk:

- detail page;
- complex domain response;
- object yang punya identity sendiri;
- payload yang akan dievolusi per sub-object.

Trade-off:

```text
Flattening:
  + simple consumer
  + convenient for table/grid
  - semantic grouping hilang
  - field explosion
  - harder versioning when nested model grows

Nested structure:
  + semantic grouping jelas
  + evolution lebih natural
  - response lebih verbose
  - consumer perlu object traversal
```

---

## 14. Mapping Several Source Objects

MapStruct bisa mapping dari beberapa source parameter.

```java
@Mapper
public interface CaseMapper {

    @Mapping(target = "caseId", source = "caseEntity.id")
    @Mapping(target = "caseStatus", source = "caseEntity.status")
    @Mapping(target = "assignedOfficerName", source = "officer.name")
    @Mapping(target = "teamName", source = "team.name")
    CaseAssignmentResponse toResponse(
        CaseEntity caseEntity,
        Officer officer,
        Team team
    );
}
```

Ini berguna untuk composition dari beberapa source yang sudah tersedia.

Namun hati-hati:

```java
CaseAssignmentResponse toResponse(CaseEntity caseEntity, Officer officer, Team team);
```

Jika `officer` dan `team` harus dicari dari database, jangan lakukan lookup di mapper.

Alur lebih sehat:

```text
Application service:
  1. Load CaseEntity
  2. Load Officer
  3. Load Team
  4. Call mapper with all needed inputs

Mapper:
  - pure object transformation only
```

---

## 15. Collection Mapping

Model:

```java
public class Product {
    private Long id;
    private String name;
}

public class ProductResponse {
    private Long id;
    private String name;
}
```

Mapper:

```java
@Mapper
public interface ProductMapper {

    ProductResponse toResponse(Product product);

    List<ProductResponse> toResponses(List<Product> products);
}
```

MapStruct akan generate loop.

Kira-kira:

```java
if (products == null) {
    return null;
}

List<ProductResponse> list = new ArrayList<>(products.size());
for (Product product : products) {
    list.add(toResponse(product));
}
return list;
```

Ini salah satu kekuatan MapStruct: collection mapping tetap menjadi Java loop sederhana, bukan reflection traversal.

### 15.1 Set Mapping

```java
Set<RoleResponse> toRoleResponses(Set<Role> roles);
```

Perhatikan semantic collection:

- `List` menjaga order;
- `Set` menjaga uniqueness tapi order tergantung implementasi;
- `LinkedHashSet` menjaga insertion order;
- `SortedSet` butuh comparator/natural order.

Jangan sembarang mengubah `List` ke `Set` dalam mapper jika order atau duplicate punya makna.

### 15.2 IterableMapping

`@IterableMapping` bisa membantu jika ada beberapa mapping method untuk element type yang sama.

Contoh:

```java
@Mapper
public interface UserMapper {

    @Named("summary")
    UserSummaryResponse toSummary(User user);

    @Named("detail")
    UserDetailResponse toDetail(User user);

    @IterableMapping(qualifiedByName = "summary")
    List<UserSummaryResponse> toSummaries(List<User> users);
}
```

Qualifier akan dibahas lebih dalam di Part 21. Untuk core mental model, pahami bahwa collection mapping membutuhkan element mapping yang jelas.

---

## 16. Map Mapping

MapStruct juga dapat mapping `Map<K, V>`.

```java
@Mapper
public interface ConfigMapper {

    Map<String, String> toResponseMap(Map<String, Integer> source);
}
```

MapStruct bisa mengubah value integer ke string jika conversion tersedia.

Untuk key/value formatting tertentu:

```java
@Mapper
public interface DateMapMapper {

    @MapMapping(valueDateFormat = "yyyy-MM-dd")
    Map<String, String> toMap(Map<String, LocalDate> source);
}
```

Map mapping perlu hati-hati karena `Map` sering menjadi escape hatch tanpa schema.

Pertanyaan desain:

- Apakah key set terbatas?
- Apakah value type stabil?
- Apakah map mewakili dynamic attributes?
- Apakah lebih baik pakai explicit DTO?
- Apakah map akan diserialisasi ke JSON contract publik?

Map sebagai public API contract sering lebih sulit dievolusi dan divalidasi.

---

## 17. Enum Mapping

### 17.1 Same Name Enum

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}

public enum CaseStatusResponse {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Mapper:

```java
@Mapper
public interface CaseStatusMapper {
    CaseStatusResponse toResponse(CaseStatus status);
}
```

MapStruct dapat map berdasarkan nama enum.

### 17.2 Different Name Enum

```java
public enum InternalCaseStatus {
    DRAFT,
    PENDING_REVIEW,
    APPROVED,
    REJECTED,
    CANCELLED_BY_SYSTEM
}

public enum PublicCaseStatus {
    DRAFT,
    IN_REVIEW,
    APPROVED,
    REJECTED,
    CANCELLED
}
```

Mapper:

```java
@Mapper
public interface CaseStatusMapper {

    @ValueMapping(source = "PENDING_REVIEW", target = "IN_REVIEW")
    @ValueMapping(source = "CANCELLED_BY_SYSTEM", target = "CANCELLED")
    PublicCaseStatus toPublic(InternalCaseStatus status);
}
```

Enum mapping adalah contract-sensitive.

Jangan anggap enum hanya technical conversion. Enum biasanya menyimpan state lifecycle, visibility, atau business category.

### 17.3 Enum Tidak Selalu One-to-One

Kadang beberapa internal status menjadi satu public status.

```java
public enum InternalPaymentStatus {
    INITIATED,
    AUTHORIZED,
    CAPTURED,
    SETTLED,
    FAILED,
    CANCELLED,
    EXPIRED
}

public enum PublicPaymentStatus {
    PROCESSING,
    PAID,
    FAILED,
    CANCELLED
}
```

Mapping:

```java
@Mapper
public interface PaymentStatusMapper {

    @ValueMapping(source = "INITIATED", target = "PROCESSING")
    @ValueMapping(source = "AUTHORIZED", target = "PROCESSING")
    @ValueMapping(source = "CAPTURED", target = "PROCESSING")
    @ValueMapping(source = "SETTLED", target = "PAID")
    @ValueMapping(source = "FAILED", target = "FAILED")
    @ValueMapping(source = "CANCELLED", target = "CANCELLED")
    @ValueMapping(source = "EXPIRED", target = "CANCELLED")
    PublicPaymentStatus toPublic(InternalPaymentStatus status);
}
```

Di sini mapper melakukan projection dari internal lifecycle ke public lifecycle.

Ini acceptable jika mapping policy memang bagian dari representation boundary.

Tetapi jika status conversion menentukan workflow decision, sebaiknya logic berada di domain/application policy, bukan mapper.

---

## 18. Inverse Mapping

MapStruct mendukung `@InheritInverseConfiguration`.

```java
@Mapper
public interface CustomerMapper {

    @Mapping(target = "customerId", source = "id")
    @Mapping(target = "name", source = "fullName")
    CustomerResponse toResponse(Customer customer);

    @InheritInverseConfiguration
    Customer fromResponse(CustomerResponse response);
}
```

Hati-hati.

Inverse mapping tidak selalu valid.

Entity -> Response:

```text
id -> customerId
fullName -> name
status -> displayStatus
createdAt -> createdAt
```

Response -> Entity sering tidak valid karena:

- response punya derived fields;
- response tidak membawa semua invariant;
- response field sudah dimasking;
- response enum sudah diproyeksikan;
- response tidak punya audit metadata;
- response seharusnya tidak digunakan untuk update.

Rule:

> Inverse mapping hanya aman untuk model yang benar-benar simetris. Kebanyakan API request/response tidak simetris.

Lebih baik buat mapping eksplisit:

```java
Customer toEntity(CreateCustomerRequest request);
CustomerResponse toResponse(Customer entity);
```

---

## 19. Mapper Composition with `uses`

Dalam sistem besar, mapper dipecah.

```java
@Mapper(componentModel = "spring", uses = {
    CustomerMapper.class,
    AddressMapper.class,
    MoneyMapper.class
})
public interface OrderMapper {
    OrderResponse toResponse(Order order);
}
```

Jika `Order` punya `Customer`, `Address`, dan `Money`, MapStruct dapat menggunakan mapper lain.

### 19.1 Composition Harus Mengikuti Boundary

Baik:

```text
OrderApiMapper uses:
  - CustomerApiMapper
  - AddressApiMapper
  - MoneyRepresentationMapper
```

Buruk:

```text
OrderApiMapper uses:
  - OrderEntityMapper
  - PaymentPersistenceMapper
  - LegacySoapMapper
```

Kenapa buruk?

Karena API mapper mulai bergantung ke persistence/integration detail.

Mapper composition harus mencerminkan dependency architecture.

---

## 20. Central Mapper Configuration

Daripada mengulang config di semua mapper:

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface CentralMappingConfig {
}
```

Mapper:

```java
@Mapper(config = CentralMappingConfig.class)
public interface CustomerMapper {
    CustomerResponse toResponse(Customer customer);
}
```

Ini penting untuk governance.

Config yang sering distandardisasi:

- `componentModel`;
- `unmappedTargetPolicy`;
- `unmappedSourcePolicy`;
- `nullValueMappingStrategy`;
- `nullValuePropertyMappingStrategy`;
- `collectionMappingStrategy`;
- injection strategy.

Untuk core part ini, yang paling penting adalah `unmappedTargetPolicy`.

---

## 21. Unmapped Target Policy

Default warning sering tidak cukup untuk enterprise system.

Misal target response bertambah field:

```java
public class CustomerResponse {
    private Long id;
    private String name;
    private String email;
    private String riskCategory; // field baru
}
```

Mapper lama:

```java
CustomerResponse toResponse(Customer customer);
```

Jika policy longgar, field `riskCategory` bisa tidak terisi tanpa disadari.

Dengan:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CustomerMapper {
    CustomerResponse toResponse(Customer customer);
}
```

Compile akan gagal jika ada target field yang tidak dimapping.

Ini sangat berharga.

### 21.1 Recommended Policy

Untuk boundary penting:

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface StrictMapperConfig {
}
```

Gunakan `ignore = true` jika field memang sengaja tidak dimapping.

```java
@Mapping(target = "internalNotes", ignore = true)
CustomerResponse toResponse(Customer customer);
```

Ini membuat decision terlihat saat code review.

Rule:

> Jangan biarkan field target tidak terisi secara tidak sengaja. Jika tidak dimapping, harus eksplisit: ignore, constant, default, expression, atau source mapping.

---

## 22. Null Handling: Core Behavior

Secara umum, generated mapper akan mengembalikan null jika source null.

```java
UserDto toDto(User user);
```

Kira-kira:

```java
if (user == null) {
    return null;
}
```

Untuk nested object:

```java
@Mapping(target = "customerName", source = "customer.fullName")
OrderResponse toResponse(Order order);
```

Generated code akan menghindari `NullPointerException` dengan helper method atau null checks.

Namun, null strategy adalah topik besar dan akan dibahas lebih dalam di Part 20.

Di bagian core ini, cukup pegang prinsip:

```text
Null source object      -> biasanya null target object
Null source property    -> biasanya null target property
Nested null path        -> target property null
Collection null         -> biasanya null collection, kecuali strategy diubah
```

### 22.1 Null vs Empty

Untuk API response, sering lebih baik collection kosong daripada null.

Tetapi jangan asal.

```json
{
  "items": []
}
```

berbeda dengan:

```json
{
  "items": null
}
```

Dan berbeda lagi dari:

```json
{}
```

Makna kontrak harus jelas.

Jika ingin collection null menjadi empty list, standardisasikan dengan MapStruct config atau post-processing policy.

---

## 23. Mapping to Immutable Target

MapStruct tidak hanya bekerja dengan setter. Ia juga bisa bekerja dengan constructor, builder, atau record tergantung model.

Contoh Java record:

```java
public record CustomerResponse(
    Long id,
    String name,
    String email
) {}
```

Mapper:

```java
@Mapper
public interface CustomerMapper {

    @Mapping(target = "name", source = "fullName")
    CustomerResponse toResponse(Customer customer);
}
```

Generated mapper akan memanggil canonical constructor.

Untuk Java 8, records tidak tersedia. Biasanya immutable DTO menggunakan constructor atau Lombok `@Value`/builder.

Contoh constructor DTO:

```java
public class CustomerResponse {
    private final Long id;
    private final String name;
    private final String email;

    public CustomerResponse(Long id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getEmail() { return email; }
}
```

MapStruct dapat menggunakan constructor jika parameter dapat dikenali.

Dengan Java 8, parameter name metadata bisa menjadi isu jika tidak compile dengan `-parameters` atau tidak ada annotation/builder yang jelas.

Praktis:

```text
Java 8 legacy      -> JavaBean DTO atau Lombok builder sering lebih mudah
Java 16+           -> records sangat cocok untuk response/query DTO
Java 21/25 modern  -> records + explicit mapper adalah default kuat untuk immutable DTO
```

---

## 24. Object Factory Preview

Kadang target tidak bisa dibuat dengan constructor default.

Contoh:

```java
public class CaseEntity {
    private final CaseId id;
    private CaseStatus status;

    private CaseEntity(CaseId id) {
        this.id = id;
    }

    public static CaseEntity draft(CaseId id) {
        CaseEntity entity = new CaseEntity(id);
        entity.status = CaseStatus.DRAFT;
        return entity;
    }
}
```

MapStruct core tidak ideal untuk create aggregate seperti ini.

Lebih baik:

```java
public class CaseFactory {
    public CaseEntity createDraft(CreateCaseCommand command) {
        return CaseEntity.draft(CaseId.newId());
    }
}
```

Object factory MapStruct akan dibahas di Part 21.

Untuk sekarang, prinsipnya:

> Jangan memaksa MapStruct membuat domain aggregate jika aggregate creation punya invariant dan lifecycle rule. Gunakan factory/domain method.

---

## 25. Realistic Example: Case Management Response Mapping

Domain:

```java
public class EnforcementCase {
    private Long id;
    private String caseNo;
    private CaseStatus status;
    private Subject subject;
    private Officer assignedOfficer;
    private Instant createdAt;
    private Instant updatedAt;
    private String internalRiskScore;
}

public class Subject {
    private Long id;
    private String name;
    private String identityNo;
}

public class Officer {
    private Long id;
    private String displayName;
    private String email;
}
```

API response:

```java
public class CaseDetailResponse {
    private Long id;
    private String caseNo;
    private String status;
    private SubjectSummaryResponse subject;
    private OfficerSummaryResponse assignedOfficer;
    private Instant createdAt;
    private Instant updatedAt;
}

public class SubjectSummaryResponse {
    private Long id;
    private String name;
    private String maskedIdentityNo;
}

public class OfficerSummaryResponse {
    private Long id;
    private String name;
}
```

Mapper:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    uses = { SubjectMapper.class, OfficerMapper.class }
)
public interface CaseMapper {

    @Mapping(target = "status", source = "status")
    CaseDetailResponse toDetailResponse(EnforcementCase enforcementCase);

    default String map(CaseStatus status) {
        if (status == null) {
            return null;
        }
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case UNDER_REVIEW -> "Under Review";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
            case CLOSED -> "Closed";
        };
    }
}
```

Subject mapper:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface SubjectMapper {

    @Mapping(target = "maskedIdentityNo", source = "identityNo")
    SubjectSummaryResponse toSummary(Subject subject);

    default String maskIdentityNo(String identityNo) {
        if (identityNo == null || identityNo.length() < 4) {
            return "****";
        }
        return "****" + identityNo.substring(identityNo.length() - 4);
    }
}
```

Officer mapper:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface OfficerMapper {

    @Mapping(target = "name", source = "displayName")
    OfficerSummaryResponse toSummary(Officer officer);
}
```

Perhatikan keputusan penting:

- `internalRiskScore` tidak ada di response;
- subject identity dimasking;
- officer email tidak diekspos;
- status diubah ke display string;
- nested mapper dipisah;
- target policy error.

Ini bukan mapping teknis semata. Ini representation boundary.

---

## 26. Request to Command Mapping

Request DTO:

```java
public class CreateCaseRequest {
    private String subjectName;
    private String subjectIdentityNo;
    private String allegationType;
    private String description;
}
```

Command:

```java
public class CreateCaseCommand {
    private String subjectName;
    private String subjectIdentityNo;
    private AllegationType allegationType;
    private String description;
    private String submittedChannel;
}
```

Mapper:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface CreateCaseCommandMapper {

    @Mapping(target = "allegationType", source = "allegationType")
    @Mapping(target = "submittedChannel", constant = "PORTAL")
    CreateCaseCommand toCommand(CreateCaseRequest request);

    default AllegationType mapAllegationType(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return AllegationType.valueOf(value.trim().toUpperCase(Locale.ROOT));
    }
}
```

Important note:

String-to-enum conversion di atas bisa throw `IllegalArgumentException`.

Untuk API boundary, mungkin lebih baik conversion dilakukan setelah validation agar error message lebih controlled.

Alternatif:

```java
public enum AllegationType {
    FRAUD,
    MISREPRESENTATION,
    UNLICENSED_ACTIVITY
}
```

Request DTO pakai enum langsung:

```java
public class CreateCaseRequest {
    private AllegationType allegationType;
}
```

Jackson + validation menangani invalid enum.

Mapper tetap simple.

Rule:

> Jika input string sebenarnya enum contract, pertimbangkan jadikan enum di request DTO. Jangan semua stringly-typed value dilempar ke mapper.

---

## 27. What Should Not Be in Core Mapper

Mapper boleh melakukan:

- structural transformation;
- simple type conversion;
- representation projection;
- deterministic formatting;
- masking/redaction ringan;
- nested mapping;
- collection mapping;
- enum mapping;
- constant/default mapping yang jelas.

Mapper tidak sebaiknya melakukan:

- database query;
- remote API call;
- authorization decision;
- workflow transition;
- status mutation berdasarkan rule kompleks;
- validation berat;
- side effect;
- audit writing;
- event publishing;
- time-dependent decision tersembunyi;
- random id generation untuk aggregate penting;
- transaction boundary.

Anti-pattern:

```java
@Mapper(componentModel = "spring")
public abstract class CaseMapper {

    @Autowired
    private OfficerRepository officerRepository;

    @Mapping(target = "assignedOfficer", expression = "java(findOfficer(request.getOfficerId()))")
    public abstract CaseEntity toEntity(CreateCaseRequest request);

    protected Officer findOfficer(Long id) {
        return officerRepository.findById(id).orElseThrow();
    }
}
```

Masalah:

- mapper melakukan IO;
- mapping bisa throw repository exception;
- unit test mapping butuh database/mock repository;
- transaction semantics tidak jelas;
- mapper menjadi application service terselubung.

Lebih baik:

```text
Application service:
  request -> command mapper
  validate command
  load officer
  create aggregate
  save

Mapper:
  request -> command only
```

---

## 28. Compile-Time Error as Design Feedback

Salah satu benefit terbesar MapStruct adalah error compiler.

Misal:

```java
public class CustomerResponse {
    private Long id;
    private String name;
    private String email;
    private String segment;
}
```

Mapper:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CustomerMapper {
    CustomerResponse toResponse(Customer customer);
}
```

Jika `segment` tidak dimapping, build gagal.

Ini bukan gangguan. Ini signal design.

Pilihan yang harus diambil:

1. Map dari source:

```java
@Mapping(target = "segment", source = "customerSegment")
```

2. Ignore sengaja:

```java
@Mapping(target = "segment", ignore = true)
```

3. Constant/default:

```java
@Mapping(target = "segment", constant = "GENERAL")
```

4. Expression/custom method:

```java
@Mapping(target = "segment", expression = "java(resolveSegment(customer))")
```

5. Hapus field jika tidak perlu.

Compiler memaksa kita membuat keputusan eksplisit.

Itulah value MapStruct.

---

## 29. Generated Code Review

Untuk memahami MapStruct, biasakan membuka generated source.

Lokasi umum Maven:

```text
target/generated-sources/annotations
```

Lokasi umum Gradle:

```text
build/generated/sources/annotationProcessor/java/main
```

Hal yang dicek:

- Apakah field yang benar dimapping?
- Apakah null handling sesuai ekspektasi?
- Apakah nested mapper dipakai?
- Apakah collection dibuat dengan size awal?
- Apakah conversion method yang dipilih benar?
- Apakah generated code memanggil method yang tidak dimaksud?
- Apakah ada field sensitif ikut tersalin?

Generated code adalah bagian dari design feedback, bukan hanya artifact build.

---

## 30. Common Mistakes

### 30.1 Terlalu Percaya Name-Based Mapping

```java
class Source {
    String type;
}

class Target {
    String type;
}
```

Bisa jadi source `type` adalah database discriminator, sedangkan target `type` adalah UI label.

Solusi: mapping eksplisit.

### 30.2 `@Data` Lombok pada Entity/DTO Tanpa Review

`@Data` menghasilkan getter/setter/equals/hashCode/toString. Ini bisa menyebabkan:

- field sensitif tampil di log;
- entity equality bermasalah;
- mutable DTO terlalu terbuka;
- MapStruct menemukan property yang tidak dimaksud.

Akan dibahas di fase Lombok.

### 30.3 Mapper Menjadi Tempat Business Logic

Jika mapper punya banyak branching, repository, clock, remote client, atau transaction concern, kemungkinan ia bukan mapper lagi.

### 30.4 Ignore Field Tanpa Alasan

```java
@Mapping(target = "riskCategory", ignore = true)
```

Ini perlu alasan.

Lebih baik beri komentar jika field penting:

```java
// Internal risk category must not be exposed in public API response.
@Mapping(target = "riskCategory", ignore = true)
```

### 30.5 Inverse Mapping Dipakai untuk Request

Response bukan request. Jangan gunakan response DTO sebagai update input hanya karena inverse mapping mudah.

### 30.6 Collection Mapping Trigger Lazy Loading

```java
List<OrderResponse> toResponses(List<Order> orders);
```

Jika `OrderResponse` membaca `order.customer.name`, mapper bisa trigger lazy loading untuk tiap item.

Ini bukan masalah MapStruct saja. Ini fetch-plan problem.

Akan dibahas di Part 31.

---

## 31. Design Checklist for Core MapStruct Mapper

Gunakan checklist ini saat membuat mapper baru.

### 31.1 Boundary

- Mapper ini milik boundary apa?
- API inbound?
- API outbound?
- persistence?
- integration?
- event?
- report/export?

### 31.2 Direction

- Source dan target apa?
- Apakah mapping satu arah atau benar-benar dua arah?
- Apakah inverse mapping valid?

### 31.3 Semantic Safety

- Field bernama sama benar-benar bermakna sama?
- Ada field yang harus direname?
- Ada field yang harus dimasking?
- Ada field internal yang tidak boleh keluar?
- Ada field client yang tidak boleh masuk?

### 31.4 Null Behavior

- Null source object menjadi apa?
- Null property menjadi apa?
- Null collection menjadi null atau empty?
- Missing vs null perlu dibedakan?

### 31.5 Enum and Type Conversion

- Enum one-to-one atau many-to-one?
- Conversion butuh locale/timezone/scale/rounding?
- Stringly-typed input sebaiknya divalidasi di mana?

### 31.6 Nested and Collection

- Nested object perlu summary/detail variant?
- Collection order penting?
- Mapping bisa trigger lazy loading?
- Butuh projection query daripada entity mapping?

### 31.7 Compile-Time Policy

- `unmappedTargetPolicy` sudah `ERROR`?
- Ignore field eksplisit?
- Generated code sudah dicek?

### 31.8 Testing

- Ada happy path test?
- Ada null test?
- Ada enum test?
- Ada sensitive field leakage test?
- Ada field baru compile failure?

---

## 32. Practice: Refactor Manual Mapper to MapStruct

Manual mapper:

```java
public class ApplicationMapper {

    public ApplicationResponse toResponse(Application app) {
        if (app == null) {
            return null;
        }

        ApplicationResponse response = new ApplicationResponse();
        response.setApplicationId(app.getId());
        response.setReferenceNo(app.getReferenceNo());
        response.setApplicantName(app.getApplicant().getName());
        response.setApplicantMaskedId(mask(app.getApplicant().getIdentityNo()));
        response.setStatus(toDisplayStatus(app.getStatus()));
        response.setSubmittedAt(app.getSubmittedAt());
        return response;
    }

    private String mask(String identityNo) {
        if (identityNo == null || identityNo.length() < 4) {
            return "****";
        }
        return "****" + identityNo.substring(identityNo.length() - 4);
    }

    private String toDisplayStatus(ApplicationStatus status) {
        if (status == null) {
            return null;
        }
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
        };
    }
}
```

MapStruct version:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface ApplicationMapper {

    @Mapping(target = "applicationId", source = "id")
    @Mapping(target = "applicantName", source = "applicant.name")
    @Mapping(target = "applicantMaskedId", source = "applicant.identityNo")
    @Mapping(target = "status", source = "status")
    ApplicationResponse toResponse(Application app);

    default String maskIdentityNo(String identityNo) {
        if (identityNo == null || identityNo.length() < 4) {
            return "****";
        }
        return "****" + identityNo.substring(identityNo.length() - 4);
    }

    default String map(ApplicationStatus status) {
        if (status == null) {
            return null;
        }
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
        };
    }
}
```

But note: `maskIdentityNo` may not automatically be selected if multiple `String -> String` mapping methods exist. In production, use qualifier for clarity. That is covered in Part 21.

Safer preview with qualifier:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface ApplicationMapper {

    @Mapping(target = "applicationId", source = "id")
    @Mapping(target = "applicantName", source = "applicant.name")
    @Mapping(target = "applicantMaskedId", source = "applicant.identityNo", qualifiedByName = "maskIdentityNo")
    @Mapping(target = "status", source = "status")
    ApplicationResponse toResponse(Application app);

    @Named("maskIdentityNo")
    default String maskIdentityNo(String identityNo) {
        if (identityNo == null || identityNo.length() < 4) {
            return "****";
        }
        return "****" + identityNo.substring(identityNo.length() - 4);
    }

    default String map(ApplicationStatus status) {
        if (status == null) {
            return null;
        }
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
        };
    }
}
```

---

## 33. Practice: Identify Unsafe Mapping

Given:

```java
@Mapper
public interface UserMapper {
    UserEntity toEntity(UserRequest request);
}
```

Models:

```java
public class UserRequest {
    private Long id;
    private String username;
    private String email;
    private String role;
    private Boolean active;
}

public class UserEntity {
    private Long id;
    private String username;
    private String email;
    private Role role;
    private Boolean active;
    private Instant createdAt;
    private Instant updatedAt;
}
```

Problems:

1. `id` should not be controlled by create request.
2. `role` should likely not be controlled by normal user request.
3. `active` may be lifecycle/system field.
4. audit fields need server-side population.
5. no unmapped target policy.
6. source request too powerful.
7. potential over-posting/mass assignment.

Better:

```java
public class CreateUserRequest {
    private String username;
    private String email;
}
```

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface UserMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "role", constant = "USER")
    @Mapping(target = "active", constant = "true")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    UserEntity toEntity(CreateUserRequest request);
}
```

Even better for domain-rich system:

```text
Request -> Command
Command -> domain factory creates UserEntity
```

Mapper should not bypass aggregate creation rules.

---

## 34. Java 8 to Java 25 Considerations

### 34.1 Java 8

Common style:

- JavaBean DTO;
- mutable classes;
- Lombok common;
- MapStruct with getters/setters;
- no records;
- no switch expression;
- careful with parameter names.

Example Java 8 enum mapping method:

```java
default String map(ApplicationStatus status) {
    if (status == null) {
        return null;
    }
    switch (status) {
        case DRAFT:
            return "Draft";
        case SUBMITTED:
            return "Submitted";
        case APPROVED:
            return "Approved";
        case REJECTED:
            return "Rejected";
        default:
            throw new IllegalArgumentException("Unsupported status: " + status);
    }
}
```

### 34.2 Java 11

Java 11 often appears in enterprise migration after Java 8.

Considerations:

- JAXB removed from JDK since Java 11 era module cleanup;
- DTO style often still JavaBean;
- can use `var` locally, but not important for mapper design;
- MapStruct still works normally.

### 34.3 Java 17

Important because records and sealed classes become relevant.

DTO style can start moving to records:

```java
public record CustomerResponse(Long id, String name, String email) {}
```

### 34.4 Java 21

Modern LTS widely used in new Spring/Jakarta apps.

Benefits:

- records mature;
- sealed types for controlled polymorphism;
- pattern matching useful around domain logic;
- better baseline for generated code in modern frameworks.

### 34.5 Java 25

For Java 25 era, mapping strategy should increasingly prefer:

- immutable DTO;
- records for simple carriers;
- explicit mapper config;
- compile-time generated mappers;
- minimal Lombok for DTO where records suffice;
- strong compatibility tests.

But enterprise reality:

```text
A modern Java 25 service may still integrate with Java 8-era DTO conventions, old XML contracts, legacy mutable beans, and reflection-heavy frameworks.
```

Top-level engineer must be bilingual: comfortable with both legacy JavaBean mapping and modern record/immutable mapping.

---

## 35. Top 1% Mental Model

Most engineers see mapper as:

```text
copy source field to target field
```

Strong engineers see mapper as:

```text
a compile-time checked representation boundary
```

Top-level engineers ask:

1. What boundary is this mapping crossing?
2. Which fields are intentionally exposed?
3. Which fields are intentionally hidden?
4. Which transformations are semantic, not structural?
5. What happens when the source model evolves?
6. What happens when the target model evolves?
7. What breaks at compile time?
8. What only breaks at runtime?
9. What can silently become wrong?
10. Does generated code match our mental model?

MapStruct core is powerful because it lets compiler participate in boundary correctness.

But compiler can only protect the decisions we encode.

---

## 36. Summary

Dalam bagian ini kita membahas:

- MapStruct core sebagai compile-time generated mapping;
- `@Mapper` dan mapper instance model;
- basic field mapping;
- rename mapping dengan `@Mapping`;
- ignored fields;
- constants dan default values;
- expressions;
- custom mapping methods;
- nested mapping;
- flattening nested paths;
- multiple source parameters;
- collection mapping;
- map mapping;
- enum mapping;
- inverse mapping dan bahayanya;
- mapper composition dengan `uses`;
- shared mapper config;
- `unmappedTargetPolicy = ERROR`;
- null behavior dasar;
- immutable target/records;
- generated code review;
- common mistakes;
- Java 8 sampai Java 25 considerations.

Core principle:

> MapStruct is not about avoiding manual thinking. It is about making mapping decisions explicit enough that the compiler can generate and verify the boring part.

---

## 37. Kapan Menggunakan MapStruct Core

Gunakan MapStruct ketika:

- mapping repetitive tapi tetap harus eksplisit;
- DTO/entity/event/projection banyak;
- compile-time failure lebih diinginkan daripada runtime surprise;
- performance penting;
- mapping mostly deterministic;
- codebase butuh standard mapping governance;
- ingin menghindari reflection mapper.

Jangan paksakan MapStruct ketika:

- mapping sangat dynamic;
- target schema runtime-defined;
- business logic dominan;
- transformasi tergantung IO;
- mapping lebih cocok sebagai domain factory;
- payload lebih cocok diproses streaming/tree model.

---

## 38. What Comes Next

Part berikutnya:

# Part 20 — MapStruct Update Mapping: Patch, Merge, Partial Update, Null Strategy

Part 20 akan membahas area yang jauh lebih rawan bug: update mapping.

Topik:

- `@MappingTarget`;
- update existing entity;
- PATCH vs PUT semantics;
- null ignore vs null set;
- absent vs null problem;
- JSON Merge Patch mental model;
- dirty checking JPA;
- audit-friendly update;
- preventing accidental overwrite.

Ini sangat penting untuk CRUD enterprise, case management, regulatory system, approval workflow, dan semua sistem yang punya data lifecycle panjang.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 18 — MapStruct Mental Model: Compile-Time Mapping and Generated Code](./18-mapstruct-mental-model-compile-time-mapping-generated-code.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 20 — MapStruct Update Mapping: Patch, Merge, Partial Update, Null Strategy](./20-mapstruct-update-mapping-patch-merge-partial-update-null-strategy.md)
