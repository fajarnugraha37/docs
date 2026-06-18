# Part 1 — Java Object Model for Mapping: Beans, Records, POJOs, Immutability

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `01-java-object-model-for-mapping-beans-records-pojos-immutability.md`  
> Scope: Java 8 hingga Java 25  
> Fokus: bentuk object Java sebagai bahan baku serialization, deserialization, mapping, validation, contract evolution, dan generated code.

---

## 0. Mengapa Part Ini Penting?

Sebelum masuk Jackson, MapStruct, Lombok, JAXB, XML binding, schema, contract test, atau performance tuning, kita harus memahami satu hal fundamental:

> Mapper tidak memetakan “class”. Mapper memetakan **model object** yang punya bentuk, lifecycle, ownership, mutability, identity, invariant, dan contract.

Banyak bug mapping di aplikasi enterprise bukan karena developer tidak tahu `@JsonProperty` atau `@Mapping`. Bug muncul karena developer salah memahami **jenis object** yang sedang ditransformasikan.

Contoh kesalahan umum:

```java
// Terlihat sederhana, tapi berbahaya jika object ini dipakai sebagai API request, entity, dan event sekaligus.
public class User {
    public Long id;
    public String name;
    public String role;
    public Boolean active;
}
```

Masalahnya bukan hanya public field. Masalahnya adalah satu object ini mencampur beberapa makna:

- `id` mungkin database identity.
- `name` mungkin raw input, normalized name, atau display name.
- `role` mungkin user-submitted value, internal authorization role, atau derived role.
- `active` mungkin account state, business eligibility, atau soft-delete flag.

Kalau bentuk object tidak jelas, mapping layer akan menjadi tempat “kecelakaan semantik”.

Part ini membangun fondasi untuk menjawab:

1. Apa perbedaan POJO, JavaBean, DTO, record, entity, projection, command, event object?
2. Mengapa getter/setter bukan detail kecil, tetapi memengaruhi framework introspection?
3. Kapan object mutable lebih cocok?
4. Kapan immutable object lebih aman?
5. Kapan record ideal, dan kapan record justru merepotkan?
6. Bagaimana sealed classes, enum, collection, Optional, nested object graph, dan constructor binding memengaruhi mapper?
7. Bagaimana membuat object model yang enak untuk Jackson, MapStruct, Lombok, XML binding, dan future migration Java 8 ke Java 25?

---

## 1. Mental Model Utama: Object Shape vs Object Meaning

Dalam mapping engineering, ada dua hal yang sering tercampur:

| Aspek | Pertanyaan | Contoh |
|---|---|---|
| Object shape | Bentuk datanya seperti apa? | field `name`, `birthDate`, `address.postalCode` |
| Object meaning | Makna datanya apa di boundary ini? | legal name, display name, normalized name, user-submitted name |

Framework mapping biasanya kuat di **shape transformation**:

```java
source.getName() -> target.setName(source.getName())
```

Tetapi sistem enterprise gagal di **meaning transformation**:

```java
request.name -> applicant.legalName
request.name -> audit.rawSubmittedName
request.name -> searchIndex.normalizedName
request.name -> emailDisplayName
```

Nama field sama belum tentu maknanya sama.

### 1.1. Rule of Thumb

> Field name is only a hint. Boundary context defines meaning.

Jika dua object sama-sama punya field `status`, jangan langsung map otomatis.

```java
public class CaseEntity {
    private String status; // DB workflow state: DRAFT, SUBMITTED, UNDER_REVIEW
}

public class CaseResponse {
    private String status; // User-facing display state: Pending Review, Awaiting Applicant, Closed
}
```

Secara bentuk sama: `String status`.  
Secara makna berbeda: internal workflow state vs public display state.

Mapping yang benar mungkin butuh policy:

```java
public String toPublicStatus(CaseStatus status) {
    return switch (status) {
        case DRAFT -> "Draft";
        case SUBMITTED, UNDER_REVIEW -> "Pending Review";
        case AWAITING_APPLICANT -> "Action Required";
        case CLOSED_APPROVED -> "Approved";
        case CLOSED_REJECTED -> "Rejected";
    };
}
```

---

## 2. Keluarga Object Java dalam Mapping Layer

Dalam sistem Java modern, kita sering melihat beberapa jenis object berikut.

```text
External JSON/XML
    ↓
Request DTO
    ↓
Command / Use Case Input
    ↓
Domain Model / Aggregate
    ↓
Entity / Persistence Model
    ↓
Projection / Query Model
    ↓
Response DTO / Event DTO / Integration DTO
```

Setiap jenis object punya tujuan berbeda.

| Jenis Object | Tujuan Utama | Biasanya Mutable? | Cocok untuk |
|---|---:|---:|---|
| POJO | Object biasa tanpa aturan framework spesifik | Bisa ya/tidak | model sederhana, internal helper |
| JavaBean | Object dengan no-args constructor + getter/setter | Ya | framework binding lama, UI binding, XML binding, JPA-like style |
| DTO | Membawa data antar boundary | Sebaiknya immutable untuk response/event | API request/response, integration payload |
| Command | Mewakili intent dari request | Immutable | application use case input |
| Entity | Persistence identity + lifecycle | Biasanya mutable/proxied | JPA/database model |
| Projection | Data hasil query spesifik | Immutable/record cocok | read model, report, listing |
| Event Payload | Fakta yang sudah terjadi | Immutable | messaging, audit, integration event |
| Value Object | Nilai domain dengan invariant | Immutable | money, period, address, identifier |
| Record | Transparent immutable data carrier | Shallow immutable | DTO/projection/value-like object |
| Sealed Hierarchy | Closed polymorphic model | Biasanya immutable | typed events, typed commands, result model |

---

## 3. POJO: Bukan Berarti Tanpa Desain

POJO atau Plain Old Java Object sering dianggap “class biasa”. Itu benar, tetapi dalam mapping, POJO tetap punya kontrak implisit.

Contoh POJO sederhana:

```java
public class CustomerName {
    private final String value;

    public CustomerName(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Customer name must not be blank");
        }
        this.value = value.trim();
    }

    public String value() {
        return value;
    }
}
```

Ini POJO, tetapi tidak JavaBean karena tidak punya getter `getValue()` dan setter `setValue()`.

### 3.1. POJO untuk Domain Value Object

POJO cocok untuk value object jika:

- constructor menjaga invariant,
- field final,
- tidak punya setter,
- equality berdasarkan value,
- tidak bergantung framework serialization.

Contoh:

```java
public final class PostalCode {
    private final String value;

    public PostalCode(String value) {
        String normalized = normalize(value);
        if (!normalized.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be 6 digits");
        }
        this.value = normalized;
    }

    public String value() {
        return value;
    }

    private static String normalize(String raw) {
        return raw == null ? "" : raw.trim();
    }
}
```

Mapping masuk ke value object sebaiknya eksplisit:

```java
PostalCode postalCode = new PostalCode(request.getPostalCode());
```

Jangan jadikan domain value object terlalu bergantung pada JSON annotation, kecuali memang object tersebut juga dimaksudkan sebagai boundary DTO.

### 3.2. Risiko POJO Tanpa Convention

Framework seperti Jackson, MapStruct, XML binder, dan Bean Validation biasanya membutuhkan cara menemukan property.

Jika object memakai method non-standar:

```java
public class Person {
    private String fullName;

    public String fullName() {
        return fullName;
    }
}
```

Maka beberapa tool mungkin tidak menganggap `fullName()` sebagai getter JavaBean. Record berbeda karena component accessor memang `fullName()`, tetapi class biasa belum tentu diperlakukan sama oleh semua framework.

Pelajaran:

> Semakin jauh object dari convention umum, semakin eksplisit konfigurasi mapper yang dibutuhkan.

---

## 4. JavaBean: Convention yang Masih Sangat Berpengaruh

JavaBean adalah convention lama tetapi masih sangat penting.

Bentuk umum:

```java
public class ApplicantRequest {
    private String name;
    private String email;

    public ApplicantRequest() {
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
```

Ciri umum JavaBean:

- no-args constructor,
- private fields,
- public getter/setter,
- property discovery lewat method naming,
- mudah dipakai framework lama.

### 4.1. Kenapa JavaBean Masih Relevan?

Karena banyak framework historically dibangun di atas introspection JavaBean:

- Jackson databind lama,
- JAXB/Jakarta XML Binding,
- Bean Validation,
- JPA entity style,
- UI binding,
- reflection-based mapper,
- MapStruct property mapping,
- legacy enterprise frameworks.

### 4.2. Property Bukan Field

Dalam JavaBean, property biasanya ditentukan oleh getter/setter, bukan field langsung.

```java
public class UserBean {
    private String internalName;

    public String getName() {
        return internalName;
    }

    public void setName(String name) {
        this.internalName = name;
    }
}
```

Property-nya adalah `name`, bukan `internalName`.

Ini penting untuk mapper:

```text
JSON property: name
JavaBean property: name
Actual field: internalName
```

Jangan menganggap nama field selalu menjadi nama property.

### 4.3. Boolean Getter Ambiguity

Boolean property punya dua pattern:

```java
public boolean isActive() { return active; }
public Boolean getEnabled() { return enabled; }
```

Masalah muncul jika ada kombinasi buruk:

```java
private Boolean isActive;

public Boolean getIsActive() { return isActive; }
public Boolean isActive() { return isActive; } // problem-prone for Boolean wrapper
```

Rule praktis:

- Untuk primitive `boolean active`, gunakan `isActive()` atau `getActive()`, jangan dua-duanya.
- Untuk wrapper `Boolean active`, lebih aman gunakan `getActive()`.
- Hindari field bernama `isActive` kecuali benar-benar paham efeknya pada serialization.

### 4.4. JavaBean Cocok untuk Apa?

JavaBean masih cocok untuk:

- request DTO di aplikasi legacy Java 8,
- XML binding yang butuh no-args constructor,
- JPA entity,
- framework yang membutuhkan mutable object,
- object yang diisi bertahap oleh framework.

Tetapi JavaBean kurang ideal untuk:

- event payload immutable,
- response DTO yang tidak boleh berubah,
- command object dengan invariant,
- model yang harus thread-safe secara natural,
- object yang ingin eksplisit lewat constructor.

---

## 5. Field Access vs Property Access

Mapper dan serializer bisa membaca object lewat:

1. field langsung,
2. getter/setter,
3. constructor parameter,
4. record component,
5. builder,
6. custom serializer/deserializer.

### 5.1. Field Access

```java
public class PersonDto {
    public String name;
    public int age;
}
```

Keuntungan:

- ringkas,
- mudah dipahami,
- tidak perlu boilerplate.

Kerugian:

- tidak ada encapsulation,
- sulit menjaga invariant,
- semua consumer bisa mutate,
- public field menjadi API surface,
- refactoring berisiko.

Cocok hanya untuk:

- test fixture,
- internal throwaway object,
- generated object,
- simple data structure yang tidak melewati boundary sensitif.

### 5.2. Getter/Setter Access

```java
public class PersonDto {
    private String name;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

Keuntungan:

- kompatibel luas,
- bisa validasi ringan di setter,
- bisa maintain property contract.

Kerugian:

- object mutable,
- setter bisa dipanggil dalam urutan tidak valid,
- invariant lintas field sulit dijaga,
- bisa menghasilkan partially initialized object.

### 5.3. Constructor Access

```java
public class CreateUserCommand {
    private final String email;
    private final String displayName;

    public CreateUserCommand(String email, String displayName) {
        this.email = email;
        this.displayName = displayName;
    }

    public String getEmail() { return email; }
    public String getDisplayName() { return displayName; }
}
```

Keuntungan:

- object valid sejak dibuat,
- field bisa final,
- cocok untuk immutable model,
- mudah reasoning.

Kerugian:

- framework butuh parameter name metadata atau annotation,
- constructor terlalu panjang menjadi smell,
- optional/default value harus didesain jelas.

### 5.4. Record Component Access

```java
public record CreateUserRequest(String email, String displayName) {
}
```

Record punya accessor:

```java
request.email();
request.displayName();
```

Bukan:

```java
request.getEmail();
```

Framework modern umumnya sudah mendukung records, tetapi code lama yang hanya mencari getter JavaBean bisa gagal.

---

## 6. Mutability Spectrum

Object Java tidak hanya “mutable” atau “immutable”. Ada spektrum.

| Tipe | Contoh | Risiko |
|---|---|---|
| Fully mutable | setter untuk semua field | invariant lemah, accidental mutation |
| Framework mutable | no-args + setter, dipakai untuk binding | partially initialized |
| Internally mutable | final reference ke mutable collection | shallow immutability trap |
| Effectively immutable | tidak ada setter, tapi tidak semua field final | aman secara convention, bukan compiler-enforced |
| Shallow immutable | record/final fields, isi collection masih bisa mutable | nested mutation |
| Deep immutable | semua graph immutable | paling aman, paling mahal desainnya |

### 6.1. Mutable DTO

```java
public class UpdateApplicantRequest {
    private String name;
    private String email;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
```

Mutable DTO masih masuk akal untuk inbound request di Java 8 atau framework lama.

Tetapi setelah masuk application layer, lebih baik ubah menjadi command immutable:

```java
public final class UpdateApplicantCommand {
    private final ApplicantId applicantId;
    private final String name;
    private final String email;

    public UpdateApplicantCommand(ApplicantId applicantId, String name, String email) {
        this.applicantId = Objects.requireNonNull(applicantId);
        this.name = name;
        this.email = email;
    }

    public ApplicantId applicantId() { return applicantId; }
    public String name() { return name; }
    public String email() { return email; }
}
```

### 6.2. Immutable DTO

```java
public record ApplicantResponse(
    String id,
    String name,
    String email,
    String status
) {}
```

Immutable DTO cocok untuk response karena:

- tidak ada consumer internal yang bisa mengubah response setelah dibuat,
- aman untuk caching,
- aman untuk multi-thread read,
- contract lebih jelas,
- serialization predictable.

### 6.3. Shallow Immutability Trap

Record bersifat shallow immutable, bukan deep immutable. `java.lang.Record` didokumentasikan sebagai carrier yang shallowly immutable untuk fixed set of values.

```java
public record ApplicantResponse(
    String id,
    List<String> tags
) {}
```

Field `tags` final, tetapi isi list bisa berubah jika list-nya mutable.

```java
List<String> tags = new ArrayList<>();
tags.add("A");

ApplicantResponse response = new ApplicantResponse("1", tags);
tags.add("B");

System.out.println(response.tags()); // [A, B]
```

Untuk menghindari ini:

```java
public record ApplicantResponse(String id, List<String> tags) {
    public ApplicantResponse {
        tags = tags == null ? List.of() : List.copyOf(tags);
    }
}
```

Di Java 8, `List.copyOf()` belum tersedia, jadi bisa pakai:

```java
this.tags = tags == null
    ? Collections.emptyList()
    : Collections.unmodifiableList(new ArrayList<>(tags));
```

---

## 7. Records: Data Carrier Modern Java

Record adalah fitur penting untuk mapping modern. Di Java SE 25, `Record` adalah base class untuk semua record classes, dan record class didefinisikan sebagai shallowly immutable transparent carrier untuk fixed set of values. Oracle juga menjelaskan record classes sebagai special kind of class untuk plain data aggregates dengan ceremony lebih sedikit.

Contoh:

```java
public record AddressDto(
    String line1,
    String line2,
    String postalCode
) {}
```

Compiler menghasilkan:

- private final fields,
- canonical constructor,
- accessor `line1()`, `line2()`, `postalCode()`,
- `equals()`,
- `hashCode()`,
- `toString()`.

### 7.1. Record Bukan Lombok Replacement Penuh

Record menggantikan banyak DTO sederhana, tetapi bukan semua use case Lombok.

Record cocok untuk:

- response DTO,
- projection DTO,
- event payload,
- command object sederhana,
- value-like object,
- immutable API contract.

Record kurang cocok untuk:

- JPA entity,
- object dengan lifecycle mutable,
- PATCH request yang harus membedakan absent vs null,
- object dengan sangat banyak optional field,
- object dengan inheritance class-based,
- framework lama yang belum mendukung record component.

### 7.2. Compact Constructor

Record bisa punya compact constructor untuk normalisasi dan invariant.

```java
public record PostalCode(String value) {
    public PostalCode {
        if (value == null) {
            throw new IllegalArgumentException("Postal code is required");
        }
        value = value.trim();
        if (!value.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be 6 digits");
        }
    }
}
```

Perhatikan: assignment ke component dilakukan otomatis setelah body compact constructor selesai. Mengubah parameter `value` berarti nilai field final akan memakai value yang sudah dinormalisasi.

### 7.3. Record untuk Response DTO

```java
public record CaseSummaryResponse(
    String caseId,
    String applicantName,
    String publicStatus,
    Instant submittedAt
) {}
```

Ini bagus karena response DTO harus menjadi hasil akhir, bukan object yang dimutasi bertahap.

### 7.4. Record untuk Request DTO: Boleh, Tapi Hati-Hati

```java
public record CreateCaseRequest(
    String applicantName,
    String email,
    String postalCode
) {}
```

Ini bersih, tetapi pertimbangkan:

- Bagaimana membedakan missing property vs explicit null?
- Apakah framework validation membaca annotation di component?
- Apakah deserializer bisa constructor-bind dengan benar?
- Apakah error message ke user cukup baik?
- Apakah request butuh default value?

Untuk create request sederhana, record sangat cocok.

Untuk PATCH request, record bisa kurang ideal jika tidak ada wrapper khusus.

---

## 8. Constructor Binding: Object Valid Sejak Lahir

Constructor binding artinya mapper/deserializer membuat object lewat constructor, bukan setter.

```java
public final class RegisterUserRequest {
    private final String email;
    private final String password;

    public RegisterUserRequest(String email, String password) {
        this.email = Objects.requireNonNull(email, "email");
        this.password = Objects.requireNonNull(password, "password");
    }

    public String getEmail() { return email; }
    public String getPassword() { return password; }
}
```

Kelebihan:

- field final,
- object tidak bisa partially initialized,
- invariant bisa dijaga,
- cocok untuk immutable design.

Kekurangan:

- parameter name harus tersedia,
- butuh annotation dalam beberapa framework,
- constructor panjang sulit dibaca,
- default/null handling harus eksplisit.

### 8.1. Constructor Binding di Java 8

Java 8 tidak punya record. Untuk immutable DTO, biasanya memakai:

```java
public final class ApplicantDto {
    private final String id;
    private final String name;

    public ApplicantDto(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}
```

Agar framework bisa membaca nama parameter constructor, build perlu `-parameters` atau annotation eksplisit.

Contoh Maven:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <parameters>true</parameters>
    </configuration>
</plugin>
```

Contoh Gradle:

```groovy
tasks.withType(JavaCompile).configureEach {
    options.compilerArgs += ['-parameters']
}
```

### 8.2. Telescoping Constructor Smell

```java
public CustomerDto(
    String id,
    String name,
    String email,
    String phone,
    String addressLine1,
    String addressLine2,
    String postalCode,
    String country,
    String status,
    Instant createdAt,
    Instant updatedAt
) { ... }
```

Constructor panjang menandakan:

- DTO mungkin terlalu besar,
- object shape kurang terstruktur,
- nested object perlu diekstrak,
- builder mungkin lebih baik,
- response view mungkin perlu dipisah.

Refactor:

```java
public record CustomerResponse(
    String id,
    CustomerProfile profile,
    AddressResponse address,
    AccountStatusResponse status,
    AuditTimestamps timestamps
) {}
```

---

## 9. Builder Pattern: Solusi atau Sumber Ambiguitas?

Builder sering dipakai untuk object dengan banyak field optional.

```java
public class EmailMessage {
    private final String to;
    private final String subject;
    private final String body;
    private final List<String> cc;

    private EmailMessage(Builder builder) {
        this.to = builder.to;
        this.subject = builder.subject;
        this.body = builder.body;
        this.cc = List.copyOf(builder.cc);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String to;
        private String subject;
        private String body;
        private List<String> cc = new ArrayList<>();

        public Builder to(String to) {
            this.to = to;
            return this;
        }

        public Builder subject(String subject) {
            this.subject = subject;
            return this;
        }

        public Builder body(String body) {
            this.body = body;
            return this;
        }

        public Builder cc(List<String> cc) {
            this.cc = cc;
            return this;
        }

        public EmailMessage build() {
            return new EmailMessage(this);
        }
    }
}
```

### 9.1. Builder Cocok Untuk

- banyak optional field,
- test fixture,
- complex response assembly,
- immutable object dengan banyak property,
- object yang butuh fluent readability.

### 9.2. Builder Tidak Otomatis Aman

Builder bisa menciptakan object invalid jika `build()` tidak validasi.

```java
EmailMessage message = EmailMessage.builder()
    .subject("Hello")
    .build(); // to/body missing
```

Build method harus menjaga invariant:

```java
public EmailMessage build() {
    if (to == null || to.isBlank()) {
        throw new IllegalStateException("to is required");
    }
    if (subject == null || subject.isBlank()) {
        throw new IllegalStateException("subject is required");
    }
    if (body == null) {
        throw new IllegalStateException("body is required");
    }
    return new EmailMessage(this);
}
```

### 9.3. Builder dan Framework Mapping

Jackson dan MapStruct bisa bekerja dengan builder, tetapi butuh convention/configuration yang tepat.

Risiko:

- nama method builder tidak sesuai expectation,
- `build()` method berbeda nama,
- builder nested static/non-static,
- Lombok builder generated behavior tidak terlihat jelas,
- default values di builder tidak sama dengan default values di deserialization.

Rule:

> Builder adalah API konstruksi object. Jangan gunakan builder untuk menyembunyikan policy yang seharusnya eksplisit di application service atau mapper.

---

## 10. Nested Object Graph

Mapping jarang hanya flat object. Biasanya object graph.

```java
public record ApplicantResponse(
    String id,
    ProfileResponse profile,
    AddressResponse address,
    List<DocumentResponse> documents
) {}

public record ProfileResponse(
    String fullName,
    String email
) {}

public record AddressResponse(
    String line1,
    String postalCode
) {}

public record DocumentResponse(
    String documentId,
    String fileName,
    String type
) {}
```

### 10.1. Deep Copy vs Reference Copy

```java
response.documents() // apakah list baru atau reference dari entity?
```

Jika response memakai reference list dari entity:

- perubahan entity bisa mengubah response,
- serialization bisa melihat perubahan tak terduga,
- lazy loading bisa ter-trigger,
- sensitive internal object bisa bocor.

Mapper harus menentukan:

| Situasi | Strategi |
|---|---|
| Response DTO | copy collection ke DTO collection |
| Domain object | preserve identity jika bagian aggregate |
| Entity update | jangan ganti collection sembarangan |
| Event payload | deep enough immutable snapshot |
| Cache payload | immutable/defensive copy |

### 10.2. Object Graph Explosion

Mapping entity besar ke response bisa tidak sengaja menyalin seluruh graph.

```text
Case
 ├─ Applicant
 │   ├─ Addresses
 │   ├─ Documents
 │   └─ PreviousApplications
 ├─ Officers
 ├─ AuditTrails
 ├─ Correspondences
 └─ Payments
```

Jika endpoint hanya butuh listing:

```json
{
  "caseId": "C-001",
  "applicantName": "Alice",
  "status": "Pending Review"
}
```

Jangan map full entity graph lalu serialize sebagian. Buat projection khusus.

```java
public record CaseListItem(
    String caseId,
    String applicantName,
    String status
) {}
```

---

## 11. Collections dalam Object Model

Collection terlihat sederhana, tetapi penting untuk mapping.

### 11.1. Null Collection vs Empty Collection

```java
public record SearchResponse(List<ResultItem> items) {}
```

Apa arti `items == null`?

- belum dimuat?
- tidak ada hasil?
- field tidak dikirim?
- error?

Untuk response API, biasanya lebih baik:

```json
{ "items": [] }
```

daripada:

```json
{ "items": null }
```

Record constructor:

```java
public record SearchResponse(List<ResultItem> items) {
    public SearchResponse {
        items = items == null ? List.of() : List.copyOf(items);
    }
}
```

Java 8 equivalent:

```java
this.items = items == null
    ? Collections.emptyList()
    : Collections.unmodifiableList(new ArrayList<>(items));
```

### 11.2. List vs Set

| Type | Meaning |
|---|---|
| `List` | order matters, duplicates possible |
| `Set` | uniqueness matters, order may or may not matter |
| `SortedSet` | uniqueness + sorted order |
| `LinkedHashSet` | uniqueness + insertion order |

Jangan gunakan `Set` hanya karena “tidak mau duplicate” jika API contract membutuhkan stable order.

### 11.3. Map dalam DTO

```java
public record ConfigResponse(Map<String, String> values) {}
```

Map fleksibel, tetapi contract-nya lemah:

- key tidak terdokumentasi kuat,
- value type sering terlalu generic,
- schema kurang jelas,
- validation sulit,
- client mudah salah key.

Map cocok untuk:

- truly dynamic attributes,
- metadata,
- extension point,
- localized labels,
- sparse configuration.

Jika key sebenarnya fixed, gunakan field eksplisit.

---

## 12. Optional dalam DTO: Gunakan Sangat Hati-Hati

`Optional<T>` bagus untuk return value method, tetapi kontroversial untuk field DTO.

```java
public record UserDto(Optional<String> middleName) {}
```

Masalah:

- serialization bisa aneh jika module tidak tepat,
- nested Optional mengganggu schema,
- tidak semua framework memperlakukan sama,
- sering gagal membedakan absent vs null secara jelas,
- ergonomics buruk untuk client/server DTO.

Lebih umum:

```java
public record UserDto(String middleName) {}
```

Dengan contract:

- `middleName` nullable, atau
- absent allowed, atau
- empty string forbidden.

Untuk PATCH semantics, gunakan wrapper eksplisit.

```java
public sealed interface FieldPatch<T> permits FieldPatch.Absent, FieldPatch.NullValue, FieldPatch.Value {
    record Absent<T>() implements FieldPatch<T> {}
    record NullValue<T>() implements FieldPatch<T> {}
    record Value<T>(T value) implements FieldPatch<T> {}
}
```

Ini lebih jelas daripada `Optional<T>` jika harus membedakan:

- field tidak dikirim,
- field dikirim dengan null,
- field dikirim dengan value.

---

## 13. Enum: Jangan Anggap Sekadar String

Enum sering dipakai untuk status, type, category, role, dan state.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED_APPROVED,
    CLOSED_REJECTED
}
```

### 13.1. Internal Enum vs External Enum

Internal enum mungkin berubah sesuai workflow internal. External API enum harus stabil.

```java
public enum InternalCaseStatus {
    DRAFT,
    SUBMITTED,
    SCREENING_PENDING,
    SCREENING_FAILED,
    OFFICER_REVIEW,
    MANAGER_APPROVAL,
    CLOSED_APPROVED,
    CLOSED_REJECTED
}

public enum PublicCaseStatus {
    DRAFT,
    PENDING_REVIEW,
    ACTION_REQUIRED,
    APPROVED,
    REJECTED
}
```

Mapper:

```java
public PublicCaseStatus toPublicStatus(InternalCaseStatus status) {
    return switch (status) {
        case DRAFT -> PublicCaseStatus.DRAFT;
        case SUBMITTED, SCREENING_PENDING, OFFICER_REVIEW, MANAGER_APPROVAL -> PublicCaseStatus.PENDING_REVIEW;
        case SCREENING_FAILED -> PublicCaseStatus.ACTION_REQUIRED;
        case CLOSED_APPROVED -> PublicCaseStatus.APPROVED;
        case CLOSED_REJECTED -> PublicCaseStatus.REJECTED;
    };
}
```

### 13.2. Enum Evolution Risk

Menambahkan enum value bisa breaking bagi consumer.

Jika consumer punya switch exhaustive tanpa default, value baru bisa membuat client gagal.

Strategi:

- dokumentasikan enum sebagai extensible atau closed,
- sediakan `UNKNOWN` untuk tolerant reader jika cocok,
- jangan expose internal workflow enum mentah,
- gunakan mapper untuk public enum,
- test deserialization unknown enum.

### 13.3. Enum Code vs Enum Name

Kadang external contract memakai code:

```json
{ "status": "P" }
```

Internal enum:

```java
public enum CaseStatus {
    PENDING("P"),
    APPROVED("A"),
    REJECTED("R");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Jangan bergantung pada `name()` jika external code punya lifecycle sendiri.

---

## 14. Date, Time, Money, Identifier: Object Model Bernilai Tinggi

Field seperti date/time/money/id sering menjadi sumber bug mapping.

### 14.1. Date/Time

Hindari:

```java
private Date createdAt;
private String submittedDate;
```

Lebih eksplisit:

```java
private Instant createdAt;       // machine timestamp
private LocalDate birthDate;     // date without time zone
private OffsetDateTime submittedAt; // timestamp with offset
```

Rule:

| Use Case | Type |
|---|---|
| system event timestamp | `Instant` |
| birth date / due date tanpa jam | `LocalDate` |
| meeting/user-facing date-time dengan offset | `OffsetDateTime` |
| local business time tanpa zone | `LocalDateTime`, hati-hati |
| recurring schedule by timezone | `ZonedDateTime`/domain object |

### 14.2. Money

Hindari:

```java
private double amount;
```

Gunakan:

```java
public record Money(BigDecimal amount, String currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        currency = currency.trim().toUpperCase(Locale.ROOT);
    }
}
```

Mapping money harus jelas:

- scale,
- rounding,
- currency,
- formatting,
- minor unit,
- negative amount policy.

### 14.3. Identifier

Jangan semua id menjadi `String` tanpa makna.

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId is required");
        }
    }
}
```

Keuntungan typed id:

- tidak tertukar `caseId` vs `applicantId`,
- mapping lebih eksplisit,
- domain lebih readable.

Kerugian:

- perlu serializer/deserializer atau mapper helper,
- lebih banyak class,
- friction dengan persistence/framework.

---

## 15. Entity Object: Jangan Disamakan dengan DTO

Entity biasanya punya identity dan lifecycle.

```java
public class CaseEntity {
    private Long id;
    private String caseNo;
    private String status;
    private ApplicantEntity applicant;
    private List<DocumentEntity> documents = new ArrayList<>();
    private Long version;

    protected CaseEntity() {
        // for ORM
    }

    public CaseEntity(String caseNo, ApplicantEntity applicant) {
        this.caseNo = caseNo;
        this.applicant = applicant;
        this.status = "DRAFT";
    }
}
```

Ciri entity:

- punya identity,
- lifecycle berubah,
- sering mutable,
- mungkin diproxy framework,
- punya lazy relations,
- punya version/optimistic lock,
- punya persistence constraints.

### 15.1. Kenapa Entity Tidak Boleh Langsung Jadi API DTO?

Karena entity mengandung detail yang bukan contract API:

- database id,
- audit fields,
- internal status,
- lazy relationships,
- security-sensitive fields,
- version field,
- soft delete marker,
- internal notes,
- bidirectional references.

Bad:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Risiko:

- internal field bocor,
- serialization cycle,
- lazy loading exception,
- payload terlalu besar,
- query tambahan tidak terkontrol,
- API contract berubah saat entity berubah.

Good:

```java
@GetMapping("/cases/{id}")
public CaseResponse getCase(@PathVariable Long id) {
    CaseEntity entity = caseRepository.findById(id).orElseThrow();
    return caseMapper.toResponse(entity);
}
```

---

## 16. Projection Object: Read Model yang Efisien

Projection adalah object yang memang dirancang untuk query result.

```java
public record CaseListProjection(
    String caseNo,
    String applicantName,
    String status,
    Instant submittedAt
) {}
```

Projection cocok untuk:

- listing,
- search result,
- dashboard,
- report,
- export,
- lightweight response.

Daripada:

```text
DB -> Entity full graph -> Mapper -> Response list
```

Lebih efisien:

```text
DB -> Projection -> Response
```

Projection tidak harus sama dengan response DTO. Kadang projection internal perlu dimap lagi ke public response.

```java
public record CaseListResponse(
    String caseNo,
    String applicantName,
    String publicStatus,
    String submittedDate
) {}
```

---

## 17. Command Object: Intent, Bukan Data Mentah

Request DTO adalah data yang dikirim user/client. Command adalah intent application layer.

```java
public record SubmitCaseRequest(
    String declarationAccepted,
    String remarks
) {}
```

Command:

```java
public record SubmitCaseCommand(
    CaseId caseId,
    UserId submittedBy,
    boolean declarationAccepted,
    String remarks,
    Instant submittedAt
) {}
```

Kenapa dipisah?

- `caseId` mungkin dari path, bukan body.
- `submittedBy` dari authentication context.
- `submittedAt` dari server clock.
- `declarationAccepted` mungkin perlu parse dari string/boolean.
- request masih raw, command sudah normalized.

Mapping request ke command adalah boundary penting:

```java
SubmitCaseCommand command = new SubmitCaseCommand(
    new CaseId(pathCaseId),
    currentUser.id(),
    parseDeclaration(request.declarationAccepted()),
    normalizeRemarks(request.remarks()),
    clock.instant()
);
```

---

## 18. Event Object: Snapshot Fakta, Bukan Entity Berjalan

Event payload harus merepresentasikan fakta yang sudah terjadi.

```java
public record CaseSubmittedEvent(
    String eventId,
    String caseNo,
    String applicantId,
    String submittedBy,
    Instant submittedAt,
    int schemaVersion
) {}
```

Event object harus:

- immutable,
- versioned,
- tidak bergantung entity lazy loading,
- tidak expose internal object graph,
- cukup lengkap untuk consumer,
- backward compatible.

Bad:

```java
public class CaseSubmittedEvent {
    private CaseEntity caseEntity;
}
```

Ini buruk karena event menjadi pointer ke state berjalan, bukan snapshot.

Good:

```java
public record CaseSubmittedEvent(
    String caseNo,
    String applicantName,
    String submittedByUserId,
    Instant submittedAt
) {}
```

---

## 19. Sealed Classes dan Polymorphic Object Model

Java modern punya sealed classes/interfaces untuk membatasi subtype.

```java
public sealed interface PaymentCommand
    permits CardPaymentCommand, BankTransferCommand, WaiverPaymentCommand {
}

public record CardPaymentCommand(
    BigDecimal amount,
    String cardToken
) implements PaymentCommand {}

public record BankTransferCommand(
    BigDecimal amount,
    String bankReference
) implements PaymentCommand {}

public record WaiverPaymentCommand(
    String reason
) implements PaymentCommand {}
```

### 19.1. Kapan Sealed Cocok?

- command dengan beberapa variant tertutup,
- event type tertutup,
- result type,
- validation outcome,
- domain state model,
- polymorphic DTO dengan discriminator.

### 19.2. Mapping Polymorphic Model

Polymorphic mapping butuh discriminator.

JSON:

```json
{
  "type": "CARD",
  "amount": 100.00,
  "cardToken": "tok_123"
}
```

Internal model:

```java
PaymentCommand command = switch (request.type()) {
    case "CARD" -> new CardPaymentCommand(request.amount(), request.cardToken());
    case "BANK_TRANSFER" -> new BankTransferCommand(request.amount(), request.bankReference());
    case "WAIVER" -> new WaiverPaymentCommand(request.reason());
    default -> throw new IllegalArgumentException("Unsupported payment type");
};
```

Rule:

> Polymorphic deserialization harus explicit, version-aware, dan security-aware.

Jangan biarkan external payload menentukan arbitrary Java class.

---

## 20. Public Field, Setter, Constructor, Builder, Record: Decision Matrix

| Model Style | Strength | Weakness | Best Use |
|---|---|---|---|
| Public fields | simple | no encapsulation | tests, generated simple structures |
| JavaBean | framework compatibility | mutable, partial state | legacy request DTO, XML/JPA-style object |
| Constructor immutable class | invariant strong | boilerplate | Java 8 immutable DTO/command/value object |
| Builder immutable class | readable for many optional fields | hidden invalid states if careless | complex DTO, test fixture, config object |
| Record | concise immutable data carrier | shallow immutable, less flexible for PATCH/JPA | response DTO, projection, event, simple command |
| Sealed hierarchy | closed polymorphism | mapping complexity | typed command/event/result variants |

---

## 21. Java 8 sampai Java 25: Evolution of DTO Strategy

### 21.1. Java 8 Style

Umum:

- JavaBean DTO,
- Lombok `@Data`,
- constructor immutable class manual,
- builder manual/Lombok,
- `Date` masih sering muncul,
- Optional mulai dipakai tetapi sering berlebihan.

Rekomendasi Java 8:

- gunakan JavaBean untuk inbound DTO jika framework membutuhkan,
- gunakan immutable final class untuk command/event,
- gunakan Lombok secara selektif,
- gunakan `java.time`, bukan `Date`,
- pisahkan entity dari DTO.

### 21.2. Java 11/17 Style

Umum:

- Java 11 masih tanpa record final,
- Java 16/17 records stabil,
- sealed classes tersedia di Java 17,
- pattern matching mulai membantu model reasoning.

Rekomendasi Java 17:

- records untuk response/projection/event,
- sealed interface untuk closed variant,
- JavaBean hanya jika perlu,
- kurangi Lombok `@Data`,
- gunakan constructor/record invariant.

### 21.3. Java 21/25 Style

Umum:

- records sudah mature,
- record patterns membantu decomposition,
- sealed + switch lebih expressive,
- virtual threads tidak langsung mengubah DTO, tetapi mapping allocation tetap penting,
- framework modern lebih siap record.

Rekomendasi Java 21/25:

- default ke record untuk immutable data carrier,
- gunakan class biasa untuk entity dan lifecycle object,
- gunakan sealed hierarchy untuk polymorphic intent/result,
- gunakan Lombok lebih selektif,
- eksplisitkan boundary DTO dan domain value object.

---

## 22. Lombok dalam Object Model: Productivity vs Hidden Shape

Lombok mengurangi boilerplate, tetapi object shape yang dibaca manusia tidak selalu sama dengan source code yang terlihat.

```java
@Data
public class UserDto {
    private String id;
    private String name;
    private List<String> roles;
}
```

`@Data` menghasilkan:

- getter,
- setter,
- `equals`,
- `hashCode`,
- `toString`,
- required args constructor untuk final/non-null fields.

Masalah:

- setter semua field terbuka,
- `toString()` bisa bocorkan sensitive data,
- `equals/hashCode` pada entity bisa berbahaya,
- collection tetap mutable,
- generated code tidak terlihat langsung,
- annotation processing coupling.

### 22.1. Lombok Aman Jika Disiplin

Lebih eksplisit:

```java
@Getter
@Setter
public class CreateApplicantRequest {
    private String name;
    private String email;
}
```

Atau immutable:

```java
@Getter
public class ApplicantResponse {
    private final String id;
    private final String name;

    public ApplicantResponse(String id, String name) {
        this.id = id;
        this.name = name;
    }
}
```

Atau builder:

```java
@Getter
@Builder
public class ApplicantResponse {
    private final String id;
    private final String name;
}
```

Rule awal:

> Avoid `@Data` by default. Prefer explicit Lombok annotations that match the intended object model.

---

## 23. Object Model dan Jackson

Jackson akan membaca object berdasarkan configuration dan introspection.

Object style memengaruhi Jackson:

| Object Style | Jackson Concern |
|---|---|
| JavaBean | no-args constructor + setters mudah |
| Immutable class | butuh constructor binding/creator |
| Record | component binding modern |
| Builder | butuh builder discovery/annotation |
| Public field | bisa langsung field access jika enabled/default visible |
| Polymorphic sealed | butuh discriminator/type handling |
| Value object | butuh custom serializer/deserializer atau creator |

Contoh record response:

```java
public record ApplicantResponse(String id, String name) {}
```

Contoh immutable class Java 8:

```java
public final class ApplicantResponse {
    private final String id;
    private final String name;

    public ApplicantResponse(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}
```

Untuk deserialization immutable class, sering perlu metadata parameter atau annotation.

---

## 24. Object Model dan MapStruct

MapStruct membaca source/target properties dan menghasilkan mapping code di compile time. Reference guide MapStruct menjelaskan MapStruct sebagai annotation processor yang menghasilkan type-safe bean mapping classes.

Object style memengaruhi MapStruct:

| Object Style | MapStruct Concern |
|---|---|
| JavaBean target | panggil setter |
| Immutable target | panggil constructor/builder |
| Record target | panggil canonical constructor |
| Builder target | gunakan builder jika terdeteksi |
| Nested object | butuh mapper method nested |
| Value object | butuh conversion method |
| Collection | generate loop mapping |
| Update mapping | butuh mutable target / `@MappingTarget` |

### 24.1. Mutable Target Mapping

```java
@Mapper
public interface ApplicantMapper {
    ApplicantResponse toResponse(ApplicantEntity entity);
}
```

Jika `ApplicantResponse` JavaBean:

```java
ApplicantResponse response = new ApplicantResponse();
response.setId(entity.getId().toString());
response.setName(entity.getName());
return response;
```

### 24.2. Record Target Mapping

Jika target record:

```java
public record ApplicantResponse(String id, String name) {}
```

Generated mapping conceptually:

```java
return new ApplicantResponse(
    entity.getId().toString(),
    entity.getName()
);
```

Ini lebih aman karena target tidak bisa partially initialized.

---

## 25. Object Model dan XML Binding

XML binding punya kebutuhan berbeda dari JSON.

XML object model sering perlu:

- no-args constructor,
- mutable properties,
- annotation element/attribute,
- namespace awareness,
- order control,
- wrapper element,
- collection wrapper.

Contoh XML-friendly JavaBean:

```java
public class ApplicantXmlDto {
    private String name;
    private String postalCode;

    public ApplicantXmlDto() {
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPostalCode() {
        return postalCode;
    }

    public void setPostalCode(String postalCode) {
        this.postalCode = postalCode;
    }
}
```

Untuk XML integration legacy, JavaBean mungkin lebih praktis daripada record, tergantung binder dan constraint.

---

## 26. Object Identity vs Object Equality

Mapping sering salah ketika `equals/hashCode` tidak jelas.

### 26.1. DTO Equality

Record equality berdasarkan semua component.

```java
public record ApplicantResponse(String id, String name) {}
```

Dua response sama jika id dan name sama.

### 26.2. Entity Equality

Entity equality lebih rumit.

```java
public class ApplicantEntity {
    private Long id;
    private String name;
}
```

Jika `equals/hashCode` berdasarkan semua field:

- entity berubah saat field berubah,
- collection Set bisa rusak,
- proxy ORM bisa bermasalah.

Jika berdasarkan id:

- entity baru id null menjadi problem.

Karena itu Lombok `@Data` pada entity sangat riskan.

Rule:

> DTO may use value equality. Entity equality must be deliberately designed.

---

## 27. Nullability sebagai Bagian Object Model

Java belum punya null-safety built-in seperti Kotlin. Maka nullability harus dibuat eksplisit melalui convention, annotation, validation, atau wrapper.

### 27.1. Empat Makna Null

`null` bisa berarti:

1. tidak dikirim,
2. dikirim null,
3. tidak diketahui,
4. tidak berlaku,
5. belum dimuat,
6. sengaja dikosongkan.

Itu banyak sekali. Jadi jangan gunakan null tanpa policy.

### 27.2. Null di Request

```json
{
  "email": null
}
```

Apakah ini valid?

- Create request: mungkin invalid.
- Patch request: mungkin berarti clear email.
- Search filter: mungkin berarti ignore.
- Integration payload: mungkin berarti unknown.

Object model harus mencerminkan semantics.

### 27.3. Null di Response

Response field null harus punya arti jelas.

```json
{
  "approvedAt": null
}
```

Mungkin berarti belum approved. Itu acceptable jika didokumentasikan.

Tetapi collection null biasanya membingungkan.

---

## 28. Boundary Object Design: Practical Patterns

### 28.1. Request DTO Pattern

Untuk Java 8 legacy:

```java
public class CreateCaseRequest {
    private String applicantName;
    private String postalCode;

    public String getApplicantName() { return applicantName; }
    public void setApplicantName(String applicantName) { this.applicantName = applicantName; }

    public String getPostalCode() { return postalCode; }
    public void setPostalCode(String postalCode) { this.postalCode = postalCode; }
}
```

Untuk Java 17+:

```java
public record CreateCaseRequest(
    String applicantName,
    String postalCode
) {}
```

### 28.2. Command Pattern

```java
public record CreateCaseCommand(
    UserId actorId,
    ApplicantName applicantName,
    PostalCode postalCode,
    Instant requestedAt
) {}
```

### 28.3. Entity Pattern

```java
public class CaseEntity {
    private Long id;
    private String caseNo;
    private String applicantName;
    private String postalCode;
    private String status;
    private Long version;

    protected CaseEntity() {}

    public CaseEntity(String caseNo, String applicantName, String postalCode) {
        this.caseNo = caseNo;
        this.applicantName = applicantName;
        this.postalCode = postalCode;
        this.status = "DRAFT";
    }
}
```

### 28.4. Response DTO Pattern

```java
public record CaseResponse(
    String caseNo,
    String applicantName,
    String postalCode,
    String status
) {}
```

### 28.5. Event Pattern

```java
public record CaseCreatedEvent(
    String eventId,
    String caseNo,
    String applicantName,
    Instant occurredAt,
    int schemaVersion
) {}
```

---

## 29. Anti-Patterns Object Model untuk Mapping

### 29.1. One Class for Everything

```java
public class CaseModel {
    // request fields
    // response fields
    // entity fields
    // audit fields
    // integration fields
}
```

Gejala:

- banyak nullable field,
- annotation campur JSON/XML/JPA/Validation,
- field internal bocor ke API,
- mapping terlihat “tidak perlu” karena semua pakai object sama,
- perubahan satu boundary merusak boundary lain.

### 29.2. Entity as API Contract

```java
return caseRepository.findById(id).orElseThrow();
```

Ini mengikat API ke database model.

### 29.3. Lombok `@Data` Everywhere

```java
@Data
@Entity
public class CaseEntity { ... }
```

Risiko:

- `equals/hashCode` tidak deliberate,
- `toString` bisa trigger lazy loading atau leak sensitive data,
- setter semua field membuka invariant,
- sulit review generated behavior.

### 29.4. Map<String, Object> as DTO

```java
Map<String, Object> payload
```

Cocok untuk dynamic payload tertentu, tetapi buruk sebagai default karena:

- tidak type-safe,
- tidak self-documenting,
- refactoring buruk,
- schema sulit,
- runtime error meningkat.

### 29.5. Stringly Typed Domain

```java
String status;
String amount;
String date;
String active;
```

Semua menjadi string karena “mudah mapping”. Ini menunda error ke runtime dan melemahkan domain.

---

## 30. Design Heuristics untuk Top-Level Engineer

### 30.1. Object Harus Menjawab “Boundary Mana?”

Sebelum membuat class, tanya:

1. Object ini masuk dari mana?
2. Object ini keluar ke mana?
3. Siapa owner contract-nya?
4. Apakah object ini boleh berubah setelah dibuat?
5. Apakah object ini punya identity?
6. Apakah object ini snapshot atau live state?
7. Apakah object ini internal atau external?
8. Apakah field null punya arti?
9. Apakah object ini harus backward compatible?
10. Apakah object ini akan diserialize?

### 30.2. Prefer Narrow Model

Jangan buat object terlalu general.

Bad:

```java
public class UserDto {
    private String id;
    private String name;
    private String email;
    private String role;
    private String password;
    private String createdAt;
    private String updatedAt;
    private String internalNote;
}
```

Better:

```java
public record UserListItem(String id, String name, String role) {}
public record UserDetailResponse(String id, String name, String email, String role) {}
public record CreateUserRequest(String name, String email, String password) {}
public record UserCreatedEvent(String userId, String email, Instant occurredAt) {}
```

### 30.3. Use Records for Stable Data Carriers

Jika object adalah pure data carrier dan tidak butuh mutation, record sering menjadi default modern.

### 30.4. Use Class for Lifecycle and Behavior

Jika object punya lifecycle, behavior, identity, framework proxy, atau mutation controlled, gunakan class biasa.

### 30.5. Keep Mapping-Friendly Without Sacrificing Domain

Jangan rusak domain model hanya supaya Jackson/MapStruct mudah.

Jika domain value object sulit diserialize, buat adapter mapper.

---

## 31. Example End-to-End Object Model

Misal endpoint:

```http
POST /cases/{caseId}/submit
```

Body:

```json
{
  "declarationAccepted": true,
  "remarks": "Ready for review"
}
```

### 31.1. Request DTO

```java
public record SubmitCaseRequest(
    Boolean declarationAccepted,
    String remarks
) {}
```

Kenapa `Boolean`, bukan `boolean`?

Karena inbound request perlu membedakan missing/null dari false. Setelah validation, baru ubah ke primitive boolean di command.

### 31.2. Command

```java
public record SubmitCaseCommand(
    CaseId caseId,
    UserId actorId,
    boolean declarationAccepted,
    String remarks,
    Instant submittedAt
) {}
```

Command sudah mengandung context server-side.

### 31.3. Entity

```java
public class CaseEntity {
    private Long id;
    private String caseNo;
    private String status;
    private String remarks;
    private Instant submittedAt;
    private Long version;

    protected CaseEntity() {}

    public void submit(UserId actorId, boolean declarationAccepted, String remarks, Instant now) {
        if (!declarationAccepted) {
            throw new IllegalStateException("Declaration must be accepted");
        }
        if (!"DRAFT".equals(status)) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        this.status = "SUBMITTED";
        this.remarks = remarks;
        this.submittedAt = now;
    }
}
```

### 31.4. Response DTO

```java
public record SubmitCaseResponse(
    String caseNo,
    String status,
    Instant submittedAt
) {}
```

### 31.5. Event DTO

```java
public record CaseSubmittedEvent(
    String eventId,
    String caseNo,
    String actorUserId,
    Instant submittedAt,
    int schemaVersion
) {}
```

### 31.6. Mapping Flow

```java
SubmitCaseCommand command = new SubmitCaseCommand(
    new CaseId(pathCaseId),
    currentUser.id(),
    requireAccepted(request.declarationAccepted()),
    normalizeRemarks(request.remarks()),
    clock.instant()
);

CaseEntity entity = repository.findByCaseId(command.caseId());
entity.submit(
    command.actorId(),
    command.declarationAccepted(),
    command.remarks(),
    command.submittedAt()
);

SubmitCaseResponse response = new SubmitCaseResponse(
    entity.getCaseNo(),
    toPublicStatus(entity.getStatus()),
    entity.getSubmittedAt()
);
```

Object model di atas jelas:

- request = data dari client,
- command = intent normalized,
- entity = lifecycle state,
- response = public output,
- event = immutable fact.

---

## 32. Object Model Review Checklist

Gunakan checklist ini saat review PR.

### 32.1. Boundary

- [ ] Apakah object ini jelas milik boundary apa?
- [ ] Apakah object request/response/entity/event dipisah?
- [ ] Apakah ada object yang dipakai lintas boundary terlalu luas?

### 32.2. Mutability

- [ ] Apakah object perlu mutable?
- [ ] Jika mutable, siapa yang boleh mutate?
- [ ] Jika immutable, apakah collection sudah defensive copy?
- [ ] Apakah object bisa partially initialized?

### 32.3. Nullability

- [ ] Apakah null punya arti jelas?
- [ ] Apakah collection response null atau empty?
- [ ] Apakah primitive digunakan di inbound request padahal missing perlu dibedakan?

### 32.4. Framework Compatibility

- [ ] Apakah Jackson bisa serialize/deserialize object ini dengan jelas?
- [ ] Apakah MapStruct bisa menemukan property/constructor/builder?
- [ ] Apakah XML binding membutuhkan no-args constructor?
- [ ] Apakah Lombok generated behavior sesuai expectation?

### 32.5. Security

- [ ] Apakah sensitive field bisa bocor lewat `toString()` atau serialization?
- [ ] Apakah entity expose internal field?
- [ ] Apakah request DTO mencegah over-posting?
- [ ] Apakah polymorphic model aman?

### 32.6. Evolution

- [ ] Apakah object ini external contract?
- [ ] Apakah field rename/add/remove akan breaking?
- [ ] Apakah enum value baru aman?
- [ ] Apakah event payload versioned?

---

## 33. Practical Exercises

### Exercise 1: Split One God DTO

Diberikan:

```java
public class UserModel {
    public Long id;
    public String username;
    public String password;
    public String email;
    public String role;
    public String internalNote;
    public String createdAt;
    public String updatedAt;
    public Boolean active;
}
```

Pisahkan menjadi:

- `CreateUserRequest`,
- `UpdateUserRequest`,
- `UserResponse`,
- `UserListItem`,
- `UserEntity`,
- `UserCreatedEvent`.

Pertimbangkan mana yang record, mana yang class mutable.

### Exercise 2: Design PATCH Object

Endpoint:

```http
PATCH /applicants/{id}
```

Body boleh mengubah:

- email,
- phone,
- address,
- preferred language.

Tentukan object model yang bisa membedakan:

- field absent,
- field null untuk clear,
- field value baru.

### Exercise 3: Enum Boundary

Internal status:

```java
DRAFT, SUBMITTED, SCREENING_PENDING, SCREENING_FAILED,
OFFICER_REVIEW, MANAGER_APPROVAL, APPROVED, REJECTED, CANCELLED
```

Public status:

```java
DRAFT, PENDING_REVIEW, ACTION_REQUIRED, APPROVED, REJECTED, CANCELLED
```

Buat mapping policy dan jelaskan mana yang breaking jika internal status baru ditambahkan.

### Exercise 4: Immutable Collection

Buat `CaseDetailResponse` record yang punya:

- case number,
- applicant name,
- list of documents,
- list of timeline events.

Pastikan list tidak bisa dimutasi dari luar setelah object dibuat.

---

## 34. Key Takeaways

1. Object model adalah fondasi mapping. Framework hanya mengikuti bentuk dan contract object yang kita desain.
2. POJO, JavaBean, record, builder, entity, projection, command, dan event punya tujuan berbeda.
3. Jangan memakai satu class untuk semua boundary.
4. Mutable object berguna untuk framework binding dan lifecycle object, tetapi berbahaya untuk response/event/command jika tidak dikontrol.
5. Record sangat cocok untuk immutable data carrier, tetapi hanya shallow immutable.
6. Entity tidak boleh menjadi API DTO.
7. Request DTO adalah raw client input; command adalah normalized intent.
8. Event payload harus immutable snapshot, bukan pointer ke entity.
9. Null, enum, collection, date/time, money, dan identifier adalah bagian dari object model, bukan detail kecil.
10. Mapper yang baik dimulai dari object model yang benar.

---

## 35. Referensi

- Oracle Java SE 25 API Documentation — `java.lang.Record`.
- Oracle Java Language Guide — Record Classes.
- OpenJDK JEP 395 — Records.
- Oracle Java SE Specifications — Java SE 25.
- MapStruct 1.6.3 Reference Guide.
- MapStruct 1.6.3 release notes mentioning Java records regression fixes.

---

## 36. Posisi dalam Seri

Kita sudah menyelesaikan:

- Part 0 — Orientation: Data Transformation as Software Boundary
- Part 1 — Java Object Model for Mapping: Beans, Records, POJOs, Immutability

Berikutnya:

- Part 2 — Transformation Taxonomy: Copy, Convert, Normalize, Enrich, Redact, Project

Seri belum selesai. Ini adalah Part 1 dari 35.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: 00 — Orientation: Data Transformation as Software Boundary](./00-orientation-data-transformation-as-software-boundary.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — Transformation Taxonomy: Copy, Convert, Normalize, Enrich, Redact, Project](./02-transformation-taxonomy-copy-convert-normalize-enrich-redact-project.md)

</div>