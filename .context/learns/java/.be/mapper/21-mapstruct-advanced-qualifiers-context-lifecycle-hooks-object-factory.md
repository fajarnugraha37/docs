# Part 21 — MapStruct Advanced: Qualifiers, Context, Lifecycle Hooks, Object Factory

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> Part: 21 dari 35  
> Topik: MapStruct advanced mapping control  
> Target Java: Java 8 sampai Java 25  
> Fokus library: MapStruct 1.5/1.6 stable mindset, dengan awareness MapStruct 1.7 development line

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya bisa memakai annotation MapStruct tingkat lanjut, tetapi bisa **mendesain mapping layer yang punya policy eksplisit**.

Part sebelumnya membahas core MapStruct: field mapping, nested mapping, collection mapping, enum mapping, default value, expression, dan unmapped policy. Part ini masuk ke area yang lebih dekat ke production complexity:

1. memilih mapping method yang tepat ketika ada lebih dari satu kandidat;
2. membawa context tambahan tanpa membuat mapper bergantung berlebihan pada service layer;
3. menjalankan logic sebelum dan sesudah mapping;
4. mengontrol pembuatan target object;
5. mengintegrasikan mapper dengan dependency injection;
6. mencegah mapper berubah menjadi service tersembunyi;
7. membuat mapping yang deterministik, mudah dites, dan aman untuk boundary enterprise.

MapStruct secara resmi adalah annotation processor yang menghasilkan implementation mapping saat compile time. Model ini penting: annotation yang kita tulis bukan runtime magic, melainkan instruksi bagi compiler untuk membuat Java code biasa. Karena itu, setiap fitur advanced sebaiknya selalu dilihat dari pertanyaan:

> “Java code seperti apa yang akan digenerate?”

Jika kamu bisa membayangkan generated code-nya, kamu akan jauh lebih mudah mendesain mapper yang aman.

---

## 2. Mental Model: Advanced MapStruct Bukan Tempat Menaruh Business Logic

MapStruct advanced sering disalahgunakan karena terasa seperti tempat yang nyaman untuk menyisipkan logic. Ada `@AfterMapping`, `@BeforeMapping`, `@Context`, `@ObjectFactory`, `expression`, `uses`, `componentModel`, dan custom methods. Semua ini powerful, tetapi juga bisa membuat mapper menjadi layer abu-abu.

### 2.1 Mapper yang Sehat

Mapper yang sehat menjawab pertanyaan:

> “Bagaimana representasi A diterjemahkan menjadi representasi B?”

Contoh sehat:

- `statusCode` external API menjadi `ApplicationStatus` internal enum;
- `LocalDateTime` internal menjadi ISO string response;
- `UserEntity` menjadi `UserSummaryResponse`;
- `CaseAggregate` menjadi `CaseSubmittedEvent`;
- `postalCode` dinormalisasi menjadi 6 digit;
- field internal disembunyikan dari response publik;
- reference data snapshot dari context dipakai untuk mengisi label.

### 2.2 Mapper yang Tidak Sehat

Mapper mulai tidak sehat ketika menjawab pertanyaan:

> “Apa keputusan bisnis yang harus diambil?”

Contoh tidak sehat:

- menentukan apakah application boleh approve;
- memilih assignee berdasarkan workload real-time;
- memanggil API eksternal;
- melakukan database transaction;
- melakukan access control;
- mengubah state aggregate;
- mengirim notification;
- membuat audit trail final;
- menjalankan workflow transition.

Mapper boleh melakukan **translation**, bukan **decision orchestration**.

### 2.3 Rule of Thumb

Gunakan MapStruct advanced untuk:

- field selection;
- type conversion;
- deterministic enrichment dari data yang sudah tersedia;
- object construction;
- metadata injection;
- normalization ringan;
- post-processing bentuk output.

Jangan gunakan untuk:

- I/O;
- transaction;
- authorization;
- workflow;
- complex business decision;
- remote lookup;
- hidden mutation yang sulit dilacak.

---

## 3. Problem: Method Selection Ambiguity

MapStruct memilih mapping method berdasarkan source type dan target type. Untuk mapping sederhana, ini nyaman.

```java
@Mapper
public interface UserMapper {
    UserResponse toResponse(UserEntity entity);
}
```

Namun di aplikasi besar, kita sering punya beberapa cara mengubah type yang sama.

Contoh:

```java
@Mapper
public interface CaseMapper {
    String statusToLabel(CaseStatus status);

    String statusToExternalCode(CaseStatus status);

    @Mapping(target = "status", source = "status")
    CaseResponse toResponse(CaseEntity entity);
}
```

Masalahnya: ketika target field bertipe `String`, source field bertipe `CaseStatus`, MapStruct melihat ada dua kandidat:

- `statusToLabel(CaseStatus)`
- `statusToExternalCode(CaseStatus)`

Tanpa instruksi tambahan, ini ambiguous.

### 3.1 Ambiguity Bukan Sekadar Error Compiler

Ambiguity itu sebenarnya sinyal desain:

> “Satu tipe source dan target punya lebih dari satu makna mapping.”

Artinya, mapping `CaseStatus -> String` tidak cukup menjelaskan intent. Kamu perlu memberi nama policy.

---

## 4. Qualifier: Menamai Intent Mapping

Qualifier dipakai untuk memberi identitas pada mapping method agar MapStruct tahu method mana yang harus dipakai.

Ada dua pendekatan umum:

1. `@Named` + `qualifiedByName`
2. custom qualifier annotation + `qualifiedBy`

---

## 5. `@Named` dan `qualifiedByName`

`@Named` adalah cara paling cepat.

```java
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;

@Mapper
public interface CaseResponseMapper {

    @Mapping(target = "statusLabel", source = "status", qualifiedByName = "caseStatusLabel")
    @Mapping(target = "statusCode", source = "status", qualifiedByName = "caseStatusExternalCode")
    CaseResponse toResponse(CaseEntity source);

    @Named("caseStatusLabel")
    default String toStatusLabel(CaseStatus status) {
        if (status == null) return null;
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
        };
    }

    @Named("caseStatusExternalCode")
    default String toExternalCode(CaseStatus status) {
        if (status == null) return null;
        return switch (status) {
            case DRAFT -> "D";
            case SUBMITTED -> "S";
            case APPROVED -> "A";
            case REJECTED -> "R";
        };
    }
}
```

Dengan ini, mapping menjadi eksplisit:

- `statusLabel` memakai policy label manusia;
- `statusCode` memakai policy kode eksternal.

### 5.1 Kenapa Ini Penting?

Tanpa qualifier, field bertipe sama bisa terlihat kompatibel padahal maknanya berbeda.

Contoh buruk:

```java
String status;
String type;
String category;
String reason;
```

Semua `String`, tetapi tidak semua boleh diisi dari converter yang sama.

Qualifier membuat semantic intent terlihat di mapping declaration.

### 5.2 Kelemahan `@Named`

`@Named` memakai string.

Risiko:

- typo baru ketahuan saat compile;
- rename kurang aman;
- string tidak memberi struktur domain;
- mudah menjadi terlalu banyak nama acak.

Untuk codebase besar, custom qualifier lebih kuat.

---

## 6. Custom Qualifier Annotation

Custom qualifier memberi type-safety lebih baik dibanding string-based `@Named`.

Contoh:

```java
import org.mapstruct.Qualifier;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Qualifier
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.CLASS)
public @interface ExternalStatusCode {
}
```

Qualifier lain:

```java
@Qualifier
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.CLASS)
public @interface HumanReadableLabel {
}
```

Mapper:

```java
@Mapper
public interface CaseResponseMapper {

    @Mapping(target = "statusLabel", source = "status", qualifiedBy = HumanReadableLabel.class)
    @Mapping(target = "statusCode", source = "status", qualifiedBy = ExternalStatusCode.class)
    CaseResponse toResponse(CaseEntity source);

    @HumanReadableLabel
    default String statusLabel(CaseStatus status) {
        if (status == null) return null;
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
        };
    }

    @ExternalStatusCode
    default String statusCode(CaseStatus status) {
        if (status == null) return null;
        return switch (status) {
            case DRAFT -> "D";
            case SUBMITTED -> "S";
            case APPROVED -> "A";
            case REJECTED -> "R";
        };
    }
}
```

### 6.1 Kapan Custom Qualifier Lebih Baik?

Gunakan custom qualifier ketika:

- mapping policy dipakai di banyak mapper;
- policy adalah bagian dari domain language;
- kamu ingin menghindari string literal;
- team besar perlu convention yang kuat;
- mapping punya security/compliance meaning.

Contoh qualifier enterprise:

```java
@PublicApiShape
@InternalAdminShape
@AuditRedacted
@ExternalPartnerCode
@RegulatorySubmissionCode
@HumanReadableLabel
@DatabaseCode
@NormalizedPostalCode
@MaskedIdentifier
```

Qualifier seperti ini membuat mapping declaration terasa seperti contract, bukan sekadar plumbing.

---

## 7. Qualifier sebagai Anti-Ambiguity dan Anti-Accidental Mapping

Qualifier tidak hanya menyelesaikan compiler ambiguity. Ia juga mencegah mapping “benar secara tipe tetapi salah secara makna”.

Contoh:

```java
record OfficerEntity(
    String id,
    String displayName,
    String email,
    String internalStaffNo
) {}

record OfficerPublicResponse(
    String id,
    String name
) {}

record OfficerAuditResponse(
    String id,
    String name,
    String staffNo
) {}
```

Public response tidak boleh membawa `internalStaffNo`.

Kalau mapping public dan audit memakai helper yang sama tanpa qualifier, field exposure bisa muncul ketika DTO berubah.

Lebih baik:

```java
@Mapper
public interface OfficerMapper {

    @Mapping(target = "name", source = "displayName")
    OfficerPublicResponse toPublicResponse(OfficerEntity entity);

    @Mapping(target = "name", source = "displayName")
    @Mapping(target = "staffNo", source = "internalStaffNo", qualifiedBy = AuditOnly.class)
    OfficerAuditResponse toAuditResponse(OfficerEntity entity);

    @AuditOnly
    default String exposeStaffNoForAudit(String staffNo) {
        return staffNo;
    }
}
```

Di sini qualifier menjadi dokumentasi niat: staff number hanya muncul di audit shape.

---

## 8. `uses`: Komposisi Mapper dan Converter

Mapper besar sebaiknya tidak memuat semua converter sendiri. MapStruct mendukung `uses` untuk menggunakan mapper/helper lain.

```java
@Mapper(uses = { StatusMapper.class, DateTimeMapper.class, OfficerMapper.class })
public interface CaseMapper {
    CaseResponse toResponse(CaseEntity entity);
}
```

Helper:

```java
public class DateTimeMapper {
    public String toIsoOffsetDateTime(OffsetDateTime value) {
        return value == null ? null : value.toString();
    }
}
```

### 8.1 Komposisi yang Sehat

Komposisi sehat:

```text
CaseMapper
 ├── StatusMapper
 ├── DateTimeMapper
 ├── OfficerMapper
 └── MoneyMapper
```

Setiap mapper punya tanggung jawab terbatas.

### 8.2 Komposisi yang Tidak Sehat

Komposisi tidak sehat:

```text
CaseMapper
 ├── CaseService
 ├── UserRepository
 ├── NotificationClient
 └── WorkflowEngine
```

Jika mapper membutuhkan service/repository/client untuk bekerja, kemungkinan mapper sudah mengambil tanggung jawab application layer.

---

## 9. `@Context`: Membawa State atau Policy ke Mapping

`@Context` adalah parameter khusus yang diteruskan MapStruct ke mapping method lain, object factory, dan lifecycle hook yang relevan.

Gunanya bukan untuk source data utama, melainkan **konteks mapping**.

Contoh kebutuhan:

- locale untuk label;
- timezone untuk date formatting;
- redaction policy;
- current user scope;
- cycle tracking;
- reference data snapshot;
- audit mode;
- API version;
- field visibility policy.

---

## 10. Contoh Dasar `@Context`: Locale-Aware Label

DTO:

```java
public record CaseResponse(
    String id,
    String statusCode,
    String statusLabel
) {}
```

Context:

```java
public record MappingLocale(String languageTag) {
    public boolean isIndonesian() {
        return "id-ID".equalsIgnoreCase(languageTag) || "id".equalsIgnoreCase(languageTag);
    }
}
```

Mapper:

```java
@Mapper
public interface CaseMapper {

    @Mapping(target = "statusCode", source = "status")
    @Mapping(target = "statusLabel", source = "status")
    CaseResponse toResponse(CaseEntity entity, @Context MappingLocale locale);

    default String mapStatusCode(CaseStatus status) {
        if (status == null) return null;
        return status.name();
    }

    default String mapStatusLabel(CaseStatus status, @Context MappingLocale locale) {
        if (status == null) return null;

        if (locale != null && locale.isIndonesian()) {
            return switch (status) {
                case DRAFT -> "Draf";
                case SUBMITTED -> "Diajukan";
                case APPROVED -> "Disetujui";
                case REJECTED -> "Ditolak";
            };
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

### 10.1 Apa yang Terjadi Secara Mental?

Generated mapper kira-kira akan memanggil helper dengan context yang sama:

```java
response.statusLabel = mapStatusLabel(entity.getStatus(), locale);
```

Context tidak dicari dari global state. Context datang dari caller.

Ini bagus karena:

- deterministic;
- testable;
- tidak bergantung thread-local;
- tidak menyembunyikan dependency.

---

## 11. `@Context` untuk Reference Data Snapshot

Di aplikasi enterprise, label/code sering berasal dari reference data.

Contoh buruk:

```java
default String mapCodeToLabel(String code) {
    return referenceDataService.findLabel(code); // hidden I/O
}
```

Ini berbahaya karena mapper melakukan lookup.

Lebih sehat:

1. application service mengambil reference data snapshot;
2. snapshot diberikan sebagai context;
3. mapper hanya melakukan lookup in-memory.

Context:

```java
public final class ReferenceDataContext {
    private final Map<String, String> statusLabels;
    private final Map<String, String> countryNames;

    public ReferenceDataContext(
        Map<String, String> statusLabels,
        Map<String, String> countryNames
    ) {
        this.statusLabels = Map.copyOf(statusLabels);
        this.countryNames = Map.copyOf(countryNames);
    }

    public String statusLabel(String code) {
        return statusLabels.getOrDefault(code, code);
    }

    public String countryName(String code) {
        return countryNames.getOrDefault(code, code);
    }
}
```

Mapper:

```java
@Mapper
public interface ApplicationMapper {

    @Mapping(target = "statusLabel", source = "statusCode")
    @Mapping(target = "countryName", source = "countryCode")
    ApplicationResponse toResponse(ApplicationEntity entity, @Context ReferenceDataContext ref);

    default String toStatusLabel(String code, @Context ReferenceDataContext ref) {
        return code == null ? null : ref.statusLabel(code);
    }

    default String toCountryName(String code, @Context ReferenceDataContext ref) {
        return code == null ? null : ref.countryName(code);
    }
}
```

Service:

```java
public ApplicationResponse getApplication(String id) {
    ApplicationEntity entity = repository.getRequired(id);

    ReferenceDataContext context = new ReferenceDataContext(
        referenceDataService.statusLabelsSnapshot(),
        referenceDataService.countryNamesSnapshot()
    );

    return mapper.toResponse(entity, context);
}
```

### 11.1 Kenapa Ini Lebih Baik?

Karena I/O tetap di application service. Mapper hanya menggunakan data yang sudah tersedia.

Invariant:

```text
Mapper must not decide when/how to fetch external state.
Mapper may consume explicitly provided state.
```

---

## 12. `@Context` untuk Cycle Tracking

Object graph yang punya circular reference bisa menyebabkan infinite recursion.

Contoh:

```text
CaseEntity
 └── List<DocumentEntity>
       └── CaseEntity parentCase
```

Jika mapper memetakan `CaseEntity -> CaseDto -> DocumentDto -> CaseDto -> ...`, akan terjadi recursion.

Context bisa dipakai untuk melacak object yang sudah dimap.

```java
public class CycleAvoidingMappingContext {
    private final IdentityHashMap<Object, Object> knownInstances = new IdentityHashMap<>();

    @SuppressWarnings("unchecked")
    public <T> T getMappedInstance(Object source, Class<T> targetType) {
        return (T) knownInstances.get(source);
    }

    public void storeMappedInstance(Object source, Object target) {
        knownInstances.put(source, target);
    }
}
```

Mapper:

```java
@Mapper
public interface CaseGraphMapper {

    CaseDto toDto(CaseEntity entity, @Context CycleAvoidingMappingContext context);

    DocumentDto toDto(DocumentEntity entity, @Context CycleAvoidingMappingContext context);

    @BeforeMapping
    default <T> T getMappedInstance(Object source, @TargetType Class<T> targetType,
                                    @Context CycleAvoidingMappingContext context) {
        return context.getMappedInstance(source, targetType);
    }

    @BeforeMapping
    default void storeMappedInstance(Object source, @MappingTarget Object target,
                                     @Context CycleAvoidingMappingContext context) {
        context.storeMappedInstance(source, target);
    }
}
```

Catatan: pattern cycle tracking perlu dites dengan serius karena interaksi dengan target immutable/record/builder bisa berbeda dari mutable bean biasa.

### 12.1 Lebih Baik Lagi: Hindari Mapping Graph Tak Terbatas

Cycle tracking adalah alat, bukan alasan untuk memetakan seluruh graph.

Sering kali desain DTO yang lebih benar adalah:

```java
record CaseDetailResponse(
    String caseId,
    List<DocumentSummaryResponse> documents
) {}

record DocumentSummaryResponse(
    String documentId,
    String fileName
) {}
```

Jangan membuat `DocumentSummaryResponse` membawa `CaseDetailResponse` lagi.

Mental model:

> DTO response seharusnya punya arah navigasi yang jelas, bukan memantulkan seluruh entity graph.

---

## 13. `@BeforeMapping`: Hook Sebelum Mapping

`@BeforeMapping` menjalankan method sebelum mapping tertentu.

Gunanya:

- normalize source ringan;
- initialize context;
- check cached target;
- prepare value;
- flush entity sebelum membaca computed field — hati-hati;
- short-circuit object mapping via cached instance.

Contoh sederhana:

```java
@Mapper
public interface CustomerMapper {

    CustomerResponse toResponse(CustomerEntity entity, @Context MappingWarnings warnings);

    @BeforeMapping
    default void warnIfLegacyRecord(CustomerEntity entity, @Context MappingWarnings warnings) {
        if (entity != null && entity.isLegacyImported()) {
            warnings.add("Customer was imported from legacy system");
        }
    }
}
```

Context warnings:

```java
public class MappingWarnings {
    private final List<String> warnings = new ArrayList<>();

    public void add(String warning) {
        warnings.add(warning);
    }

    public List<String> all() {
        return List.copyOf(warnings);
    }
}
```

### 13.1 Bahaya `@BeforeMapping`

`@BeforeMapping` menjadi berbahaya jika dipakai untuk hidden mutation.

Buruk:

```java
@BeforeMapping
default void autoApprove(ApplicationEntity entity) {
    if (entity.isEligible()) {
        entity.setStatus(APPROVED); // hidden business transition
    }
}
```

Ini sangat buruk karena mapping response bisa mengubah state domain.

Mapping harus bebas dari state transition.

---

## 14. `@AfterMapping`: Hook Setelah Mapping

`@AfterMapping` berguna ketika target perlu disesuaikan setelah MapStruct mengisi field utama.

Contoh:

```java
@Mapper
public interface ApplicationResponseMapper {

    ApplicationResponse toResponse(ApplicationEntity entity);

    @AfterMapping
    default void deriveDisplayFields(ApplicationEntity source,
                                     @MappingTarget ApplicationResponse target) {
        target.setDisplayTitle(source.getReferenceNo() + " - " + source.getApplicantName());
    }
}
```

### 14.1 Kapan `@AfterMapping` Tepat?

Tepat untuk:

- derived display field;
- field yang butuh gabungan beberapa source field;
- cleanup output;
- attaching mapping metadata;
- setting computed boolean dari already-loaded data.

Tidak tepat untuk:

- menyimpan ke database;
- memanggil service eksternal;
- mengubah source entity;
- melakukan authorization;
- menjalankan workflow.

---

## 15. `@AfterMapping` dengan Builder/Immutable Target

Jika target immutable atau memakai builder, cara `@AfterMapping` berbeda.

Contoh target builder:

```java
@Builder
public record CaseResponse(
    String id,
    String referenceNo,
    String displayTitle
) {}
```

Pada builder mapping, hook bisa bekerja terhadap builder, bukan object final.

```java
@Mapper
public interface CaseMapper {

    CaseResponse toResponse(CaseEntity entity);

    @AfterMapping
    default void fillDisplayTitle(CaseEntity source,
                                  @MappingTarget CaseResponse.CaseResponseBuilder builder) {
        builder.displayTitle(source.getReferenceNo() + " / " + source.getApplicantName());
    }
}
```

Catatan: detail builder bergantung pada shape builder yang tersedia. Pada Lombok, interaksi builder akan dibahas lebih dalam di Part 25.

---

## 16. Lifecycle Hook sebagai Policy Attachment

Lifecycle hook bisa dipakai untuk menempelkan policy output yang cross-cutting, misalnya masking.

Contoh:

```java
public record RedactionPolicy(boolean showSensitiveFields) {}
```

DTO mutable:

```java
public class PersonResponse {
    private String name;
    private String email;
    private String nationalId;

    // getters setters
}
```

Mapper:

```java
@Mapper
public interface PersonMapper {

    PersonResponse toResponse(PersonEntity entity, @Context RedactionPolicy policy);

    @AfterMapping
    default void redact(@MappingTarget PersonResponse target,
                        @Context RedactionPolicy policy) {
        if (policy == null || !policy.showSensitiveFields()) {
            target.setNationalId(null);
        }
    }
}
```

### 16.1 Alternatif yang Lebih Eksplisit

Daripada satu method dengan redaction policy, sering kali lebih aman membuat dua shape DTO:

```java
PersonPublicResponse toPublicResponse(PersonEntity entity);
PersonInternalResponse toInternalResponse(PersonEntity entity);
```

Gunakan policy context jika kombinasi field visibility terlalu banyak atau ditentukan runtime, tetapi jangan jadikan context sebagai pengganti desain DTO yang jelas.

---

## 17. `@ObjectFactory`: Mengontrol Target Instantiation

`@ObjectFactory` digunakan untuk membuat instance target object.

MapStruct biasanya membuat target dengan:

- no-args constructor;
- constructor yang cocok;
- builder;
- factory method tertentu.

Namun kadang target perlu dibuat dengan aturan khusus.

Contoh:

```java
public class CaseEntity {
    private final String id;
    private String referenceNo;
    private CaseStatus status;

    public CaseEntity(String id) {
        this.id = id;
        this.status = CaseStatus.DRAFT;
    }

    // getters setters
}
```

DTO:

```java
public record CreateCaseCommand(String referenceNo) {}
```

Factory context:

```java
public interface IdGenerator {
    String newId();
}
```

Mapper:

```java
@Mapper
public interface CaseCommandMapper {

    CaseEntity toEntity(CreateCaseCommand command, @Context IdGenerator idGenerator);

    @ObjectFactory
    default CaseEntity createCaseEntity(CreateCaseCommand command,
                                        @Context IdGenerator idGenerator) {
        return new CaseEntity(idGenerator.newId());
    }
}
```

Generated mapping akan membuat target via factory, lalu mengisi field lain.

### 17.1 Batas Aman `@ObjectFactory`

`@ObjectFactory` cocok untuk:

- membuat target dengan constructor khusus;
- memilih subtype target;
- memakai identity dari context;
- mengambil existing object dari context;
- membuat aggregate shell sebelum property mapping;
- object pooling? Hampir tidak pernah disarankan di aplikasi modern.

Tidak cocok untuk:

- menyimpan object ke database;
- memanggil repository untuk fetch target;
- menjalankan business creation rule kompleks;
- mengalokasikan resource eksternal.

---

## 18. `@ObjectFactory` untuk Existing Entity Update: Hati-Hati

Kadang ada kebutuhan mapping request ke existing entity.

Buruk:

```java
@ObjectFactory
default CaseEntity loadEntity(UpdateCaseRequest request) {
    return repository.findById(request.id()).orElseThrow();
}
```

Ini menyembunyikan database access di mapper.

Lebih baik:

```java
public void updateCase(String id, UpdateCaseRequest request) {
    CaseEntity entity = repository.getRequired(id);
    mapper.updateEntity(request, entity);
}
```

Mapper:

```java
@Mapper
public interface CaseUpdateMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    void updateEntity(UpdateCaseRequest request, @MappingTarget CaseEntity entity);
}
```

Application service yang bertanggung jawab mengambil entity. Mapper hanya apply perubahan.

---

## 19. `@TargetType`: Factory/Resolver Berdasarkan Target Type

MapStruct dapat mengirim target type ke helper/factory dengan `@TargetType`.

Contoh generic reference resolver:

```java
public class ReferenceResolver {

    public <T extends Reference> T resolve(String id, @TargetType Class<T> type) {
        if (id == null) return null;
        return Reference.create(type, id);
    }
}
```

Mapper:

```java
@Mapper(uses = ReferenceResolver.class)
public interface OrderMapper {
    OrderEntity toEntity(OrderRequest request);
}
```

Jika `OrderRequest.customerId` dipetakan ke `CustomerReference`, helper bisa memilih target type.

### 19.1 Gunakan untuk Reference Object, Bukan Lazy DB Lookup

Resolver seperti ini aman jika membuat lightweight reference:

```java
new CustomerReference(id)
```

Tidak aman jika diam-diam:

```java
customerRepository.findById(id)
```

---

## 20. Dependency Injection Model

MapStruct bisa menghasilkan mapper sebagai plain singleton via `Mappers.getMapper(...)`, atau sebagai bean DI framework.

Contoh Spring:

```java
@Mapper(componentModel = "spring")
public interface CaseMapper {
    CaseResponse toResponse(CaseEntity entity);
}
```

Dengan `componentModel = "spring"`, generated implementation menjadi Spring bean.

Untuk CDI/Jakarta:

```java
@Mapper(componentModel = "cdi")
public interface CaseMapper {
    CaseResponse toResponse(CaseEntity entity);
}
```

### 20.1 Kapan Pakai DI?

Pakai DI ketika:

- mapper digunakan oleh service/controller sebagai dependency;
- mapper memakai mapper lain yang juga bean;
- kamu ingin convention konsisten di Spring/Jakarta app;
- mapper helper membutuhkan bean stateless yang aman.

Tidak perlu DI jika:

- library module kecil tanpa framework;
- mapping pure function;
- kamu ingin mapper benar-benar framework-neutral.

### 20.2 Jangan Menggunakan DI untuk Membawa Service Berat ke Mapper

DI membuat mudah meng-inject apa saja. Ini berbahaya.

Buruk:

```java
@Mapper(componentModel = "spring")
public abstract class ApplicationMapper {

    @Autowired
    protected EligibilityService eligibilityService;

    @AfterMapping
    protected void fillEligibility(ApplicationEntity source,
                                   @MappingTarget ApplicationResponse target) {
        target.setEligible(eligibilityService.evaluate(source));
    }
}
```

Ini membuat mapping response menjalankan business evaluation tersembunyi.

Lebih baik:

```java
public ApplicationResponse getResponse(String id) {
    ApplicationEntity entity = repository.getRequired(id);
    EligibilityResult eligibility = eligibilityService.evaluate(entity);
    return mapper.toResponse(entity, eligibility);
}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface ApplicationMapper {

    @Mapping(target = "eligible", source = "eligibility.eligible")
    @Mapping(target = "eligibilityReason", source = "eligibility.reason")
    ApplicationResponse toResponse(ApplicationEntity entity, EligibilityResult eligibility);
}
```

Decision dilakukan service. Mapper hanya menyalin result ke shape output.

---

## 21. Abstract Mapper Class vs Interface

MapStruct mapper bisa berupa interface atau abstract class.

Interface cocok untuk:

- mapping deklaratif;
- default helper method;
- pure mapping;
- mapper sederhana/menengah.

Abstract class cocok untuk:

- dependency injection field/constructor tertentu;
- shared protected helper;
- lifecycle hook dengan state dependency;
- mapper yang butuh framework integration lebih eksplisit.

Contoh abstract class:

```java
@Mapper(componentModel = "spring")
public abstract class CaseMapper {

    protected final DateTimeFormatter formatter = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    public abstract CaseResponse toResponse(CaseEntity entity);

    protected String format(OffsetDateTime value) {
        return value == null ? null : formatter.format(value);
    }
}
```

Tetap jaga dependency tetap ringan dan deterministic.

---

## 22. Decorator Pattern: Menambah Behavior di Luar Generated Mapping

MapStruct mendukung decorator untuk membungkus generated mapper.

Use case:

- mapping utama tetap generated;
- behavior tambahan ditempatkan di wrapper;
- berguna untuk cross-cutting enrichment yang ingin terlihat jelas.

Contoh interface:

```java
@Mapper(componentModel = "spring")
@DecoratedWith(CaseMapperDecorator.class)
public interface CaseMapper {
    CaseResponse toResponse(CaseEntity entity);
}
```

Decorator:

```java
public abstract class CaseMapperDecorator implements CaseMapper {

    private final CaseMapper delegate;

    protected CaseMapperDecorator(CaseMapper delegate) {
        this.delegate = delegate;
    }

    @Override
    public CaseResponse toResponse(CaseEntity entity) {
        CaseResponse response = delegate.toResponse(entity);
        response.setDisplayTitle(entity.getReferenceNo() + " - " + entity.getApplicantName());
        return response;
    }
}
```

Catatan: wiring decorator bisa berbeda tergantung component model dan framework. Untuk Spring, perlu memperhatikan bean name/qualifier yang dihasilkan.

### 22.1 Decorator vs `@AfterMapping`

Gunakan `@AfterMapping` jika logic kecil dan murni mapping.

Gunakan decorator jika:

- ingin memisahkan generated mapping dan enrichment;
- logic cukup panjang;
- butuh dependency yang eksplisit;
- ingin mudah dites sebagai wrapper;
- ingin menghindari mapper interface terlalu ramai.

Tetap jangan jadikan decorator sebagai service layer tersembunyi.

---

## 23. Advanced Pattern: Policy Object sebagai Context

Daripada context berupa primitive atau banyak parameter, gunakan policy object.

Buruk:

```java
CaseResponse toResponse(
    CaseEntity entity,
    @Context boolean includeInternal,
    @Context boolean maskSensitive,
    @Context String locale,
    @Context String apiVersion
);
```

Lebih baik:

```java
public record ResponseMappingPolicy(
    Audience audience,
    SensitivityMode sensitivityMode,
    Locale locale,
    ApiVersion apiVersion
) {
    public boolean canSeeInternalFields() {
        return audience == Audience.INTERNAL_ADMIN;
    }

    public boolean mustMaskSensitiveFields() {
        return sensitivityMode == SensitivityMode.MASKED;
    }
}
```

Mapper:

```java
CaseResponse toResponse(CaseEntity entity, @Context ResponseMappingPolicy policy);
```

Keuntungan:

- parameter lebih sedikit;
- intent jelas;
- mudah dites;
- bisa divalidasi saat dibuat;
- tidak membuat mapper signature berantakan.

---

## 24. Advanced Pattern: Mapping Context Tidak Boleh Mutable Sembarangan

Context kadang perlu mutable, misalnya warnings atau cycle tracking. Namun default sebaiknya immutable.

### 24.1 Immutable Context

Cocok untuk:

- locale;
- timezone;
- API version;
- redaction policy;
- reference data snapshot;
- current audience;
- formatting policy.

### 24.2 Mutable Context

Cocok untuk:

- cycle tracking;
- mapping warnings;
- diagnostics collector;
- deduplication map;
- identity preservation.

Jika mutable, pastikan:

- dibuat per mapping operation;
- tidak singleton;
- tidak disimpan di mapper;
- tidak dipakai antar thread;
- lifecycle jelas.

Buruk:

```java
@Component
public class SharedMappingContext {
    private final List<String> warnings = new ArrayList<>();
}
```

Context seperti ini akan bocor antar request.

---

## 25. Multiple Source Parameters + Context

MapStruct mendukung lebih dari satu source parameter.

Contoh:

```java
@Mapper
public interface CaseDetailMapper {

    @Mapping(target = "caseId", source = "entity.id")
    @Mapping(target = "applicantName", source = "applicant.name")
    @Mapping(target = "editable", source = "permission.canEdit")
    CaseDetailResponse toResponse(
        CaseEntity entity,
        ApplicantEntity applicant,
        PermissionSnapshot permission,
        @Context ResponseMappingPolicy policy
    );
}
```

Di sini:

- `entity`, `applicant`, `permission` adalah source data;
- `policy` adalah context.

### 25.1 Jangan Salahgunakan Context sebagai Source Utama

Jika data adalah bagian dari output, sering kali lebih baik menjadi source parameter biasa, bukan `@Context`.

Contoh `PermissionSnapshot` di atas adalah source karena field `editable` berasal darinya.

Context lebih cocok untuk policy yang memengaruhi cara mapping, bukan data utama yang dipetakan.

---

## 26. Context vs Source Parameter

Gunakan source parameter jika:

- field target berasal langsung dari object tersebut;
- object tersebut adalah input bisnis mapping;
- perubahan object harus terlihat di mapping declaration;
- kamu ingin MapStruct bisa resolve `source = "object.field"`.

Gunakan `@Context` jika:

- object tersebut membantu mapping method;
- perlu diteruskan ke nested mapper;
- dipakai lifecycle hook/factory;
- bukan bagian utama dari data shape;
- mewakili policy/environment/snapshot.

Contoh:

```java
// Better as source
CaseResponse toResponse(CaseEntity entity, PermissionSnapshot permission);

// Better as context
CaseResponse toResponse(CaseEntity entity, @Context LocaleContext locale);
```

---

## 27. Qualifier + Context

Qualifier dan context bisa digabung.

Contoh:

```java
@Mapper
public interface MoneyMapper {

    @Mapping(target = "amountDisplay", source = "amount", qualifiedByName = "formatMoney")
    InvoiceResponse toResponse(InvoiceEntity entity, @Context CurrencyDisplayPolicy policy);

    @Named("formatMoney")
    default String formatMoney(BigDecimal amount, @Context CurrencyDisplayPolicy policy) {
        if (amount == null) return null;
        return policy.format(amount);
    }
}
```

Ini berguna saat ada beberapa converter dari tipe yang sama, tetapi converter juga butuh policy.

---

## 28. Lifecycle Hook + Context + MappingTarget

Contoh redaction yang lebih lengkap:

```java
public record SecurityViewContext(
    boolean internalUser,
    boolean complianceOfficer,
    boolean showDebugFields
) {}
```

Mapper:

```java
@Mapper
public interface InvestigationMapper {

    InvestigationResponse toResponse(InvestigationEntity entity,
                                     @Context SecurityViewContext security);

    @AfterMapping
    default void applySecurityView(@MappingTarget InvestigationResponse target,
                                   @Context SecurityViewContext security) {
        if (security == null || !security.internalUser()) {
            target.setInternalNotes(null);
            target.setAssignedOfficerEmail(null);
        }

        if (security == null || !security.complianceOfficer()) {
            target.setRiskScore(null);
        }

        if (security == null || !security.showDebugFields()) {
            target.setDebugTraceId(null);
        }
    }
}
```

### 28.1 Security Caveat

Untuk security-sensitive fields, lebih aman punya DTO berbeda daripada runtime nulling. Runtime redaction bisa gagal jika:

- field baru ditambahkan tapi lupa diredact;
- response object di-log sebelum redaction;
- mapper lain tidak memakai hook;
- serialization view berbeda.

Policy context bisa berguna, tetapi jangan menjadikannya satu-satunya lapisan proteksi.

---

## 29. Advanced Error: Hidden Null Context

MapStruct akan meneruskan context yang diberikan. Jika caller mengirim `null`, helper bisa NPE.

Contoh:

```java
default String label(String code, @Context ReferenceDataContext ref) {
    return ref.statusLabel(code); // possible NPE
}
```

Pilihan:

1. context wajib non-null dan divalidasi di service;
2. helper defensif terhadap null;
3. factory static membuat default context;
4. jangan nullable context untuk mapping kritis.

Rekomendasi:

```java
public ApplicationResponse toResponse(ApplicationEntity entity) {
    ReferenceDataContext context = referenceDataContextProvider.requiredSnapshot();
    return mapper.toResponse(entity, context);
}
```

Mapper boleh mengasumsikan context valid jika application service menjamin invariant.

---

## 30. Advanced Error: Qualifier Tidak Dipakai karena Signature Tidak Cocok

Qualifier hanya membantu jika method candidate cocok secara type.

Contoh:

```java
@Named("statusLabel")
default String statusLabel(String status) { ... }
```

Tetapi source field bertipe `CaseStatus`.

```java
@Mapping(target = "statusLabel", source = "status", qualifiedByName = "statusLabel")
```

Jika tidak ada conversion `CaseStatus -> String` yang sesuai, mapping gagal.

Solusi: signature harus sesuai:

```java
@Named("statusLabel")
default String statusLabel(CaseStatus status) { ... }
```

Atau buat chain conversion yang eksplisit.

---

## 31. Advanced Error: `@AfterMapping` Tidak Dipanggil

Sering terjadi karena signature hook tidak cocok dengan mapping method.

Contoh mapping:

```java
CaseResponse toResponse(CaseEntity entity, @Context MappingPolicy policy);
```

Hook:

```java
@AfterMapping
default void after(@MappingTarget CaseResponse target) { }
```

Ini biasanya masih bisa cocok. Tetapi jika hook membutuhkan source/context yang tidak ada di mapping method, ia tidak cocok.

```java
@AfterMapping
default void after(UserEntity user, @MappingTarget CaseResponse target) { }
```

Jika `UserEntity` bukan parameter mapping, hook tidak akan diterapkan.

Mental model:

> Hook harus bisa dipanggil oleh generated method dengan parameter yang tersedia.

---

## 32. Advanced Error: `@ObjectFactory` Disalahpahami sebagai Custom Mapping

`@ObjectFactory` hanya membuat target instance. Ia bukan tempat mengisi semua property.

Buruk:

```java
@ObjectFactory
default PersonEntity create(PersonRequest request) {
    PersonEntity entity = new PersonEntity();
    entity.setName(request.name());
    entity.setEmail(request.email());
    return entity;
}
```

Ini membingungkan karena MapStruct setelah itu juga bisa mengisi property.

Lebih baik:

```java
@ObjectFactory
default PersonEntity create(PersonRequest request) {
    return new PersonEntity();
}
```

Biarkan field mapping tetap dideklarasikan/digenerate.

Kalau ingin custom penuh, buat manual method saja.

---

## 33. Generated Code Inspection

Untuk fitur advanced, biasakan inspect generated code.

Lokasi umum:

Maven:

```text
target/generated-sources/annotations
```

Gradle:

```text
build/generated/sources/annotationProcessor/java/main
```

Yang perlu dilihat:

- apakah qualifier method dipanggil;
- apakah context diteruskan ke nested mapper;
- apakah lifecycle hook terpanggil;
- apakah object factory digunakan;
- apakah dependency injection sesuai;
- apakah null check sesuai ekspektasi;
- apakah collection mapping membuat instance yang tepat;
- apakah builder mapping sesuai.

Top 1% engineer tidak hanya membaca annotation. Ia membaca hasil codegen.

---

## 34. Design Example: Regulatory Case Response Mapping

Kita desain contoh yang lebih realistic.

### 34.1 Domain Model

```java
public class EnforcementCaseEntity {
    private String id;
    private String caseNo;
    private CaseStatus status;
    private String applicantName;
    private String applicantNationalId;
    private String assignedOfficerId;
    private LocalDateTime submittedAt;
    private BigDecimal penaltyAmount;

    // getters setters
}
```

Enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Response:

```java
public class EnforcementCaseResponse {
    private String id;
    private String caseNo;
    private String statusCode;
    private String statusLabel;
    private String applicantName;
    private String applicantNationalId;
    private String assignedOfficerName;
    private String submittedAt;
    private String penaltyDisplay;
    private String displayTitle;

    // getters setters
}
```

Context:

```java
public record CaseResponseContext(
    Locale locale,
    ZoneId zoneId,
    boolean internalUser,
    Map<String, String> officerNames
) {
    public String officerName(String officerId) {
        if (officerId == null) return null;
        return officerNames.getOrDefault(officerId, officerId);
    }
}
```

Qualifiers:

```java
@Qualifier
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.CLASS)
public @interface CaseStatusCode {}

@Qualifier
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.CLASS)
public @interface CaseStatusLabel {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface EnforcementCaseResponseMapper {

    @Mapping(target = "statusCode", source = "status", qualifiedBy = CaseStatusCode.class)
    @Mapping(target = "statusLabel", source = "status", qualifiedBy = CaseStatusLabel.class)
    @Mapping(target = "assignedOfficerName", source = "assignedOfficerId")
    @Mapping(target = "submittedAt", source = "submittedAt")
    @Mapping(target = "penaltyDisplay", source = "penaltyAmount")
    EnforcementCaseResponse toResponse(EnforcementCaseEntity entity,
                                       @Context CaseResponseContext context);

    @CaseStatusCode
    default String statusCode(CaseStatus status) {
        return status == null ? null : status.name();
    }

    @CaseStatusLabel
    default String statusLabel(CaseStatus status, @Context CaseResponseContext context) {
        if (status == null) return null;

        boolean id = context != null
            && context.locale() != null
            && context.locale().getLanguage().equals("id");

        if (id) {
            return switch (status) {
                case DRAFT -> "Draf";
                case SUBMITTED -> "Diajukan";
                case UNDER_REVIEW -> "Dalam Pemeriksaan";
                case APPROVED -> "Disetujui";
                case REJECTED -> "Ditolak";
                case CLOSED -> "Ditutup";
            };
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

    default String officerName(String officerId, @Context CaseResponseContext context) {
        return context == null ? officerId : context.officerName(officerId);
    }

    default String submittedAt(LocalDateTime value, @Context CaseResponseContext context) {
        if (value == null) return null;
        ZoneId zone = context != null && context.zoneId() != null
            ? context.zoneId()
            : ZoneOffset.UTC;
        return value.atZone(zone).toOffsetDateTime().toString();
    }

    default String penaltyDisplay(BigDecimal value) {
        if (value == null) return null;
        return value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    @AfterMapping
    default void finish(EnforcementCaseEntity source,
                        @MappingTarget EnforcementCaseResponse target,
                        @Context CaseResponseContext context) {
        target.setDisplayTitle(source.getCaseNo() + " - " + source.getApplicantName());

        if (context == null || !context.internalUser()) {
            target.setApplicantNationalId(null);
        }
    }
}
```

### 34.2 Apa yang Bagus dari Desain Ini?

1. Status code dan label dipisah secara eksplisit.
2. Context membawa locale, timezone, visibility, dan snapshot officer names.
3. Mapper tidak memanggil database untuk officer name.
4. Redaction dilakukan setelah mapping, tetapi field security-sensitive tetap harus direview.
5. Formatting date dan money deterministic.
6. `componentModel = "spring"` hanya untuk mapper bean, bukan alasan menyuntik service berat.

### 34.3 Apa yang Masih Perlu Diwaspadai?

1. Redaction runtime bisa lupa jika field baru ditambahkan.
2. `penaltyDisplay` belum locale-aware.
3. `submittedAt` memakai `LocalDateTime`, padahal source enterprise lebih aman memakai `OffsetDateTime` atau `Instant`.
4. Officer name fallback ke ID mungkin tidak cocok untuk public API.
5. DTO mutable membuat after mapping mudah, tetapi immutable DTO/record butuh strategi berbeda.

---

## 35. Testing Advanced Mapper

Advanced mapper harus dites lebih dari happy path.

### 35.1 Test Qualifier

```java
@Test
void shouldMapStatusCodeAndLabelDifferently() {
    EnforcementCaseEntity entity = new EnforcementCaseEntity();
    entity.setStatus(CaseStatus.SUBMITTED);

    CaseResponseContext context = new CaseResponseContext(
        Locale.ENGLISH,
        ZoneOffset.UTC,
        true,
        Map.of()
    );

    EnforcementCaseResponse response = mapper.toResponse(entity, context);

    assertThat(response.getStatusCode()).isEqualTo("SUBMITTED");
    assertThat(response.getStatusLabel()).isEqualTo("Submitted");
}
```

### 35.2 Test Context Locale

```java
@Test
void shouldUseIndonesianStatusLabelWhenLocaleIsIndonesian() {
    entity.setStatus(CaseStatus.UNDER_REVIEW);

    CaseResponseContext context = new CaseResponseContext(
        Locale.forLanguageTag("id-ID"),
        ZoneOffset.UTC,
        true,
        Map.of()
    );

    EnforcementCaseResponse response = mapper.toResponse(entity, context);

    assertThat(response.getStatusLabel()).isEqualTo("Dalam Pemeriksaan");
}
```

### 35.3 Test Redaction

```java
@Test
void shouldRedactNationalIdForPublicUser() {
    entity.setApplicantNationalId("S1234567A");

    CaseResponseContext context = new CaseResponseContext(
        Locale.ENGLISH,
        ZoneOffset.UTC,
        false,
        Map.of()
    );

    EnforcementCaseResponse response = mapper.toResponse(entity, context);

    assertThat(response.getApplicantNationalId()).isNull();
}
```

### 35.4 Test Reference Data Snapshot

```java
@Test
void shouldResolveOfficerNameFromContextSnapshot() {
    entity.setAssignedOfficerId("officer-001");

    CaseResponseContext context = new CaseResponseContext(
        Locale.ENGLISH,
        ZoneOffset.UTC,
        true,
        Map.of("officer-001", "Alice Tan")
    );

    EnforcementCaseResponse response = mapper.toResponse(entity, context);

    assertThat(response.getAssignedOfficerName()).isEqualTo("Alice Tan");
}
```

### 35.5 Test Generated Code Assumption

Untuk mapping advanced, tambahkan review build artifact pada PR besar:

- buka generated mapper;
- pastikan no unexpected service call;
- pastikan hook terpanggil;
- pastikan factory digunakan;
- pastikan null strategy benar;
- pastikan nested context diteruskan.

---

## 36. Common Anti-Patterns

### 36.1 God Mapper

```text
ApplicationMapper
 ├── maps request
 ├── maps response
 ├── calls repository
 ├── evaluates eligibility
 ├── formats PDF field
 ├── sends notification
 └── creates audit record
```

Ini bukan mapper. Ini service layer tersembunyi.

### 36.2 Magic Context

```java
MappingContext context
```

yang berisi:

```java
User user;
HttpServletRequest request;
EntityManager em;
ApplicationContext springContext;
Map<String, Object> anything;
```

Ini service locator disguised as context.

Context harus spesifik, kecil, dan typed.

### 36.3 Qualifier Explosion

Terlalu banyak qualifier granular bisa membuat mapping sulit dibaca.

Buruk:

```java
@QualifiedByName("convertStatusForCaseResponseInEnglishForAdminWhenVersion2")
```

Lebih baik pecah:

- source/target DTO yang jelas;
- policy context;
- mapper khusus boundary;
- qualifier hanya untuk perbedaan konversi yang stabil.

### 36.4 `expression = "java(...)"` Berlebihan

Expression berguna, tetapi mudah menjadi string Java tersembunyi.

Buruk:

```java
@Mapping(target = "x", expression = "java(a.getB().getC().trim().toUpperCase())")
```

Lebih baik helper method:

```java
@Mapping(target = "x", source = "b.c", qualifiedByName = "normalizeCode")
```

```java
@Named("normalizeCode")
default String normalizeCode(String value) {
    return value == null ? null : value.trim().toUpperCase(Locale.ROOT);
}
```

Helper lebih testable dan readable.

### 36.5 Runtime Lookup di Mapping Method

Buruk:

```java
default String officerName(String officerId) {
    return officerClient.getName(officerId);
}
```

Ini membuat mapping response memiliki latency dan failure mode tersembunyi.

Lebih baik snapshot/context.

---

## 37. Decision Matrix

| Kebutuhan | Fitur MapStruct | Catatan |
|---|---:|---|
| Ada dua converter source-target type yang sama | Qualifier | Gunakan `@Named` untuk kecil, custom qualifier untuk besar |
| Converter butuh locale/timezone/policy | `@Context` | Context harus explicit dan per operation |
| Perlu field derived setelah mapping | `@AfterMapping` | Jangan lakukan I/O/state transition |
| Perlu prepare/cache sebelum mapping | `@BeforeMapping` | Cocok untuk cycle tracking/warnings |
| Target butuh constructor/factory khusus | `@ObjectFactory` | Hanya buat object, bukan isi semua business state |
| Mapper ingin jadi Spring/CDI bean | `componentModel` | Jangan inject service berat sembarangan |
| Mapping utama generated, logic tambahan dipisah | Decorator | Cocok untuk enrichment eksplisit |
| Perlu lookup reference data | Context snapshot | Jangan repository/client call di mapper |
| Perlu update existing object | `@MappingTarget` | Sudah dibahas Part 20, hati-hati null strategy |
| Perlu security redaction | DTO khusus atau policy context | DTO khusus lebih aman untuk field sensitif |

---

## 38. Boundary Heuristics untuk Top 1% Engineer

Saat melihat advanced mapper, tanyakan:

1. Apakah mapping ini deterministic?
2. Apakah mapper melakukan I/O tersembunyi?
3. Apakah context typed dan sempit?
4. Apakah qualifier menamai semantic intent?
5. Apakah lifecycle hook mengubah source object?
6. Apakah object factory hanya membuat object?
7. Apakah generated code mudah dipahami?
8. Apakah security-sensitive fields deny-by-default?
9. Apakah mapping bisa dites tanpa Spring context penuh?
10. Apakah dependency direction tetap bersih?
11. Apakah mapper masih translation layer, bukan orchestration layer?
12. Apakah perubahan DTO baru akan gagal compile atau diam-diam bocor?
13. Apakah fallback/default value eksplisit?
14. Apakah context mutable dibuat per request?
15. Apakah mapper punya owner boundary yang jelas?

---

## 39. Recommended Package Structure

Contoh untuk aplikasi modular:

```text
com.company.caseapp.case.application
 ├── CaseQueryService.java
 ├── CaseCommandService.java

com.company.caseapp.case.adapter.web.dto
 ├── CaseResponse.java
 ├── CreateCaseRequest.java
 ├── UpdateCaseRequest.java

com.company.caseapp.case.adapter.web.mapper
 ├── CaseResponseMapper.java
 ├── CaseRequestMapper.java
 ├── CaseResponseContext.java
 ├── qualifier
 │    ├── CaseStatusCode.java
 │    └── CaseStatusLabel.java

com.company.caseapp.case.adapter.persistence
 ├── CaseEntity.java
 ├── CaseRepository.java
 └── CasePersistenceMapper.java

com.company.caseapp.case.domain
 ├── CaseAggregate.java
 ├── CaseStatus.java
 └── command
      ├── CreateCaseCommand.java
      └── UpdateCaseCommand.java
```

Prinsip:

- web mapper milik adapter web;
- persistence mapper milik adapter persistence;
- external integration mapper milik adapter integration;
- domain tidak bergantung pada DTO web/persistence;
- qualifier domain-general boleh shared, tetapi jangan semua helper dibuat global.

---

## 40. Practical Coding Standards

Untuk project besar, buat rule seperti ini:

1. Semua mapper harus `unmappedTargetPolicy = ERROR` kecuali ada alasan tertulis.
2. `expression = "java(...)"` hanya untuk logic sangat pendek; selebihnya helper method.
3. Mapper tidak boleh inject repository/client.
4. Mapper boleh inject/helper mapper lain yang pure.
5. `@Context` harus typed, bukan `Map<String, Object>`.
6. Mutable context harus dibuat per operation.
7. Qualifier wajib jika ada lebih dari satu converter untuk source-target type yang sama.
8. Security-sensitive field tidak boleh hanya mengandalkan default auto-mapping.
9. Generated mapper perlu direview untuk mapper advanced.
10. Mapping behavior penting harus punya unit test.
11. Object factory tidak boleh melakukan persistence lookup.
12. `@AfterMapping` tidak boleh mengubah source entity.
13. Mapping ke API public harus deny-by-default.
14. Response internal dan public sebaiknya DTO berbeda.
15. Reference data lookup dilakukan sebelum mapper, diberikan sebagai context/snapshot.

---

## 41. Latihan Desain

### Latihan 1 — Qualifier

Kamu punya enum:

```java
ApplicationStatus
```

Target response butuh:

```java
statusCode
statusLabel
statusBadgeColor
```

Desain mapper dengan qualifier agar tiga mapping `ApplicationStatus -> String` tidak ambiguous.

Yang harus dipikirkan:

- apakah badge color bagian API contract?
- apakah label locale-aware?
- apakah code sama dengan enum name?
- apakah status baru harus membuat compile/test gagal?

### Latihan 2 — Context

Response case detail butuh `assignedOfficerName`, tetapi entity hanya punya `assignedOfficerId`.

Desain flow:

1. service mengambil case;
2. service mengambil officer name snapshot;
3. mapper menerima context;
4. mapper tidak melakukan lookup.

### Latihan 3 — Redaction

Ada response untuk public user dan internal officer. Field sensitif:

- `nationalId`
- `internalNotes`
- `riskScore`
- `assignedOfficerEmail`

Tentukan mana yang lebih aman:

- satu DTO + redaction context;
- dua DTO berbeda;
- kombinasi policy context dan DTO terpisah.

Jelaskan trade-off.

### Latihan 4 — ObjectFactory

Target entity wajib dibuat dengan constructor:

```java
new CaseEntity(CaseId id, CreatedBy createdBy)
```

Request tidak punya ID. ID dibuat oleh service.

Desain apakah ID generator masuk context, source parameter, atau entity dibuat di service.

Pertanyaan penting:

- apakah creation rule domain kompleks?
- apakah mapper boleh membuat aggregate?
- apakah ID generator pure?
- apakah audit createdBy harus diset di mapper atau domain factory?

---

## 42. Ringkasan

MapStruct advanced memberi kontrol besar, tetapi kontrol itu harus dipakai untuk memperjelas boundary, bukan menyembunyikan behavior.

Inti bagian ini:

1. **Qualifier** menamai semantic intent ketika satu source-target type punya banyak arti mapping.
2. **`@Context`** membawa policy/snapshot/state mapping secara eksplisit dan testable.
3. **`@BeforeMapping` dan `@AfterMapping`** berguna untuk hook ringan, bukan business transition.
4. **`@ObjectFactory`** mengontrol target instantiation, bukan menggantikan service/domain factory.
5. **Dependency injection** berguna untuk wiring mapper, tetapi berbahaya jika dipakai untuk menyuntik repository/client/service berat.
6. **Generated code inspection** adalah skill wajib untuk mapper advanced.
7. **Context harus typed dan sempit**, bukan service locator.
8. **Mapper harus tetap translation layer**, bukan orchestration layer.

Mapper advanced yang baik memiliki sifat:

```text
explicit intent
+ deterministic behavior
+ compile-time safety
+ no hidden I/O
+ narrow context
+ testable policy
+ readable generated code
+ safe boundary ownership
```

Jika prinsip ini dijaga, MapStruct bukan sekadar pengurang boilerplate, tetapi alat untuk membuat transformation boundary yang kuat dan scalable.

---

## 43. Referensi

- MapStruct Reference Guide stable 1.6.3 — qualifiers, context parameters, lifecycle methods, object factories, dependency injection, decorators.
- MapStruct `@Context` API documentation — context parameters are passed to other mapping methods, object factory methods, and before/after mapping methods when applicable.
- MapStruct development reference 1.7.0 Beta line — awareness untuk evolusi fitur terbaru seperti Optional dan Java collection model modern.

---

## 44. Status Seri

Part 21 selesai.

Seri belum selesai. Berikutnya:

> Part 22 — MapStruct for Domain Boundaries: Entity DTO Event Projection

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — MapStruct Update Mapping: Patch, Merge, Partial Update, Null Strategy](./20-mapstruct-update-mapping-patch-merge-partial-update-null-strategy.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — MapStruct for Domain Boundaries: Entity DTO Event Projection](./22-mapstruct-domain-boundaries-entity-dto-event-projection.md)
