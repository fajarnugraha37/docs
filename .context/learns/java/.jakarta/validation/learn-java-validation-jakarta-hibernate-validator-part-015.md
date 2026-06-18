# learn-java-validation-jakarta-hibernate-validator-part-015.md

# Part 015 — Programmatic Constraint Mapping and Runtime Metadata

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: 015 dari 030  
> Topik: Programmatic Constraint Mapping and Runtime Metadata  
> Target: Java 8 sampai Java 25, Bean Validation 2.0, Jakarta Validation 3.x, Hibernate Validator 6.x sampai 9.x

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita banyak menggunakan model deklaratif berbasis annotation:

```java
public class RegisterUserRequest {
    @NotBlank
    private String username;

    @Email
    private String email;
}
```

Model annotation sangat cocok untuk kontrak yang stabil, dekat dengan model, dan mudah dibaca. Tetapi dalam sistem besar, terutama enterprise/regulatory/case-management, ada situasi ketika constraint tidak selalu bisa atau tidak selalu ideal ditaruh langsung pada class:

- class berasal dari generated code;
- class berasal dari library eksternal;
- model tidak boleh diedit;
- constraint berbeda per deployment;
- constraint berubah berdasarkan module;
- constraint perlu dibangun dari metadata internal;
- constraint perlu dibaca untuk menghasilkan form, documentation, rule catalog, atau API error schema;
- constraint harus dipasang pada model legacy tanpa menyentuh source code;
- annotation terlalu statis untuk kebutuhan konfigurasi tertentu.

Bagian ini membahas dua kemampuan besar:

1. **Programmatic constraint mapping** — mendeklarasikan constraint lewat kode, bukan annotation.
2. **Runtime metadata introspection** — membaca constraint yang sudah terdaftar untuk membangun tooling, documentation, diagnostics, dan governance.

Jakarta Validation mendefinisikan metadata model dan API untuk JavaBean dan method validation. Hibernate Validator sebagai reference implementation menyediakan fluent programmatic API untuk constraint declaration. API programmatic ini berguna, tetapi juga mudah disalahgunakan jika dipakai sebagai rule engine runtime tanpa governance.

---

## 1. Mental Model: Constraint Declaration vs Constraint Execution vs Constraint Metadata

Agar tidak salah desain, pisahkan tiga konsep ini:

```text
Constraint Declaration
    ↓
ValidatorFactory bootstrap
    ↓
Runtime Metadata Model
    ↓
Validator execution
    ↓
ConstraintViolation result
```

### 1.1 Constraint declaration

Constraint declaration adalah cara kita menyatakan aturan validasi.

Bentuknya bisa:

```text
1. Annotation
2. XML mapping
3. Programmatic mapping
4. Composed/custom constraint
5. Provider-specific extension
```

Contoh annotation:

```java
public class UserRequest {
    @NotBlank
    private String username;
}
```

Contoh programmatic mapping secara konseptual:

```java
ConstraintMapping mapping = configuration.createConstraintMapping();

mapping.type(UserRequest.class)
       .property("username", ElementType.FIELD)
       .constraint(new NotBlankDef());
```

Maknanya sama: `username` harus tidak blank.

Bedanya adalah lokasi deklarasinya.

### 1.2 ValidatorFactory bootstrap

Saat `ValidatorFactory` dibuat, provider mengumpulkan constraint dari semua sumber:

- annotation;
- XML;
- programmatic mapping;
- provider-specific configuration.

Setelah factory dibuat, constraint metadata dianggap sebagai configuration snapshot.

```java
ValidatorFactory factory = configuration.buildValidatorFactory();
Validator validator = factory.getValidator();
```

Implikasi penting:

> Programmatic mapping bukan seharusnya berubah-ubah per request pada `Validator` yang sama. Ia adalah bagian dari bootstrap/configuration lifecycle.

### 1.3 Runtime metadata

Setelah constraint terdaftar, kita bisa membaca metadata:

```java
BeanDescriptor bean = validator.getConstraintsForClass(UserRequest.class);
```

Metadata ini bisa menjawab pertanyaan:

- apakah class ini punya constraint?
- property apa saja yang constrained?
- constraint apa saja pada property tertentu?
- groups apa yang berlaku?
- payload apa yang ada?
- message template apa yang digunakan?
- apakah property cascaded dengan `@Valid`?
- apakah ada container element constraint?
- apakah method/constructor punya parameter/return constraints?

Metadata adalah fondasi untuk:

- documentation generator;
- UI form generator;
- API error contract;
- validation catalog;
- rule observability;
- compatibility checks;
- migration analysis.

### 1.4 Constraint execution

Execution tetap dilakukan lewat `Validator`:

```java
Set<ConstraintViolation<UserRequest>> violations = validator.validate(request);
```

Execution tidak peduli apakah constraint berasal dari annotation atau programmatic mapping. Setelah masuk metadata model, semuanya menjadi constraint.

---

## 2. Kapan Programmatic Mapping Dibutuhkan?

Programmatic mapping tidak boleh menjadi default. Annotation tetap paling jelas untuk banyak kasus.

Gunakan programmatic mapping ketika ada alasan kuat.

### 2.1 Generated model

Misalnya model dibuat dari OpenAPI, XSD, Avro, SOAP WSDL, atau legacy generator.

```java
// generated, do not edit
public class ExternalApplicantDto {
    private String name;
    private String email;
}
```

Jika file ini di-regenerate, annotation manual akan hilang. Programmatic mapping bisa menambahkan constraint tanpa menyentuh generated source.

### 2.2 Third-party class

Class berasal dari dependency eksternal.

```java
public class VendorAddress {
    private String postalCode;
}
```

Kita tidak bisa menambahkan `@Pattern` langsung ke source-nya.

### 2.3 Legacy model yang tidak boleh diedit

Pada sistem besar, class lama mungkin dipakai oleh banyak module. Menambahkan annotation bisa mengubah behavior di tempat lain.

Programmatic mapping memungkinkan constraint dipasang pada factory tertentu saja.

Contoh:

```text
LegacyCustomerDto
    dipakai oleh:
    - old batch import
    - new REST API
    - internal admin screen
```

Jika annotation ditaruh langsung di class, semua flow terdampak. Programmatic mapping bisa dipakai hanya untuk REST API factory tertentu.

### 2.4 Deployment-specific rule

Misalnya rule berbeda antar jurisdiction, agency, tenant, atau module.

Tetapi hati-hati: ini bukan berarti semua rule bisnis harus dimasukkan ke Bean Validation.

Gunakan hanya untuk rule yang masih berupa **shape/local invariant**, bukan workflow policy kompleks.

### 2.5 Metadata-driven platform

Dalam platform besar, constraint bisa dipakai untuk:

- generate API docs;
- generate UI hints;
- generate CSV import template;
- validate dynamic form;
- compare validation contract antar versi;
- audit rule catalog.

Programmatic mapping dapat menjadi jembatan antara central metadata dan runtime validator.

---

## 3. Kapan Jangan Menggunakan Programmatic Mapping?

Programmatic mapping sering terlihat powerful. Justru karena powerful, ia berbahaya.

Jangan gunakan programmatic mapping untuk hal-hal berikut.

### 3.1 Mengganti domain policy engine

Contoh buruk:

```text
Jika case type = A,
status = SUBMITTED,
role = officer,
agency = X,
tanggal action masih dalam SLA,
dan appeal belum pernah dibuat,
maka field reason wajib diisi.
```

Ini bukan constraint statis pada bean. Ini rule workflow/contextual. Lebih cocok sebagai:

- domain policy object;
- workflow guard;
- command validator;
- state machine transition validator.

### 3.2 Rule berubah per request tanpa lifecycle jelas

Jika mapping dibuat ulang berdasarkan request:

```java
// anti-pattern
ValidatorFactory factory = buildFactoryBasedOnCurrentRequest(request);
Validator validator = factory.getValidator();
```

Masalah:

- mahal;
- sulit di-cache;
- sulit diobservasi;
- sulit dites;
- sulit diaudit;
- bisa menyebabkan behavior non-deterministic.

### 3.3 Untuk authorization

Constraint seperti ini buruk:

```java
@CanApproveCase
private String caseId;
```

Authorization bukan Bean Validation. Authorization membutuhkan actor, permission, ownership, delegation, data scope, dan audit decision.

### 3.4 Untuk uniqueness final

Constraint programmatic untuk uniqueness:

```text
email must be unique
```

bisa berguna sebagai pre-check UX, tetapi final consistency harus tetap di database unique constraint atau locking/reservation pattern.

### 3.5 Untuk menyembunyikan rule dari model

Jika rule stabil, sederhana, dan intrinsic pada DTO/domain value, annotation biasanya lebih baik.

Buruk:

```text
Semua constraint disimpan di class konfigurasi 3.000 baris.
```

Akibatnya rule tidak terlihat saat membaca model.

---

## 4. Source of Truth: Annotation, XML, Programmatic, atau Domain Policy?

Pertanyaan penting dalam arsitektur validation:

> Di mana source of truth untuk rule ini?

Gunakan matriks berikut.

| Rule | Source of Truth yang Cocok | Contoh |
|---|---|---|
| Field wajib secara universal | Annotation/domain constructor | `name` wajib pada `CreateUserRequest` |
| Format lokal sederhana | Annotation/custom constraint | postal code, reference number |
| Model generated | Programmatic/XML mapping | generated SOAP DTO |
| Constraint tenant-specific sederhana | Programmatic mapping dengan governance | max length berbeda per tenant |
| Workflow transition | Workflow guard/state machine | `DRAFT -> SUBMITTED` |
| Authorization | Authorization layer | `actor can approve` |
| Referential existence | Service/domain policy | applicant id exists |
| Final uniqueness | Database constraint | unique email |
| Cross-aggregate consistency | Domain service/policy | no active duplicate case |
| API documentation | Metadata introspection | list required fields |

Rule bagus bukan hanya rule yang benar, tetapi rule yang berada di layer yang benar.

---

## 5. Programmatic Constraint Mapping dengan Hibernate Validator

Jakarta Validation standard tidak menspesifikasikan fluent programmatic mapping API sebagai portable API antar provider. Hibernate Validator menyediakan API ini sebagai provider-specific feature.

Konsekuensinya:

```text
Programmatic mapping Hibernate Validator
    powerful
    tetapi provider-specific
```

Jika aplikasi Anda sudah memilih Hibernate Validator secara eksplisit, penggunaan ini acceptable, tetapi harus sadar lock-in.

### 5.1 Dependency konseptual

Untuk Java 8 / Bean Validation 2.0 era:

```xml
<dependency>
    <groupId>org.hibernate.validator</groupId>
    <artifactId>hibernate-validator</artifactId>
    <version>6.x.x.Final</version>
</dependency>
```

Untuk Jakarta namespace modern:

```xml
<dependency>
    <groupId>org.hibernate.validator</groupId>
    <artifactId>hibernate-validator</artifactId>
    <version>8.x.x.Final</version>
</dependency>
```

Untuk Jakarta Validation 3.1 / Jakarta EE 11 era:

```xml
<dependency>
    <groupId>org.hibernate.validator</groupId>
    <artifactId>hibernate-validator</artifactId>
    <version>9.x.x.Final</version>
</dependency>
```

Catatan versi:

- Hibernate Validator 6.x cocok untuk `javax.validation` / Bean Validation 2.0.
- Hibernate Validator 7.x/8.x masuk dunia `jakarta.validation`.
- Hibernate Validator 9.x mengimplementasikan Jakarta Validation 3.1 dan menargetkan Jakarta EE 11.

Pastikan dependency disesuaikan dengan Spring Boot/Jakarta EE runtime yang digunakan.

---

## 6. Contoh Dasar Programmatic Mapping

Misalkan class tidak bisa diedit:

```java
public class ExternalUserRequest {
    private String username;
    private String email;
    private Integer age;

    public String getUsername() {
        return username;
    }

    public String getEmail() {
        return email;
    }

    public Integer getAge() {
        return age;
    }
}
```

Jika memakai annotation, kita ingin kira-kira seperti ini:

```java
public class ExternalUserRequest {
    @NotBlank
    private String username;

    @Email
    private String email;

    @Min(18)
    private Integer age;
}
```

Dengan Hibernate Validator programmatic API, bentuk konseptualnya:

```java
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.hibernate.validator.HibernateValidator;
import org.hibernate.validator.HibernateValidatorConfiguration;
import org.hibernate.validator.cfg.ConstraintMapping;
import org.hibernate.validator.cfg.defs.EmailDef;
import org.hibernate.validator.cfg.defs.MinDef;
import org.hibernate.validator.cfg.defs.NotBlankDef;

import java.lang.annotation.ElementType;

public final class ProgrammaticValidationExample {

    public static Validator buildValidator() {
        HibernateValidatorConfiguration configuration = Validation
                .byProvider(HibernateValidator.class)
                .configure();

        ConstraintMapping mapping = configuration.createConstraintMapping();

        mapping.type(ExternalUserRequest.class)
                .property("username", ElementType.FIELD)
                    .constraint(new NotBlankDef()
                            .message("{user.username.required}"))
                .property("email", ElementType.FIELD)
                    .constraint(new EmailDef()
                            .message("{user.email.invalid}"))
                .property("age", ElementType.FIELD)
                    .constraint(new MinDef()
                            .value(18)
                            .message("{user.age.minimum}"));

        ValidatorFactory factory = configuration
                .addMapping(mapping)
                .buildValidatorFactory();

        return factory.getValidator();
    }
}
```

Mental model:

```text
configuration.createConstraintMapping()
    membuat mapping object

mapping.type(ExternalUserRequest.class)
    memilih class target

.property("username", FIELD)
    memilih field target

.constraint(new NotBlankDef())
    menambahkan constraint equivalent @NotBlank

configuration.addMapping(mapping)
    memasukkan mapping ke ValidatorFactory bootstrap
```

### 6.1 Jangan buat factory per request

Buruk:

```java
public Set<ConstraintViolation<ExternalUserRequest>> validate(ExternalUserRequest request) {
    Validator validator = ProgrammaticValidationExample.buildValidator();
    return validator.validate(request);
}
```

Lebih baik:

```java
public final class ValidationModule {
    private final ValidatorFactory factory;
    private final Validator validator;

    public ValidationModule() {
        this.factory = buildFactoryOnce();
        this.validator = factory.getValidator();
    }

    public Set<ConstraintViolation<ExternalUserRequest>> validate(ExternalUserRequest request) {
        return validator.validate(request);
    }

    public void close() {
        factory.close();
    }
}
```

`ValidatorFactory` adalah configuration-heavy object. Buat sekali per application/module lifecycle, bukan per request.

---

## 7. Field vs Getter Mapping

Programmatic mapping perlu memilih lokasi property:

```java
.property("username", ElementType.FIELD)
```

atau:

```java
.property("username", ElementType.METHOD)
```

Perbedaan ini sama seperti field annotation vs getter annotation.

### 7.1 Field access

```java
mapping.type(User.class)
       .property("username", ElementType.FIELD)
       .constraint(new NotBlankDef());
```

Cocok jika:

- field ada dan stabil;
- getter punya logic yang tidak ingin dipakai saat validation;
- model JavaBean tidak lengkap.

### 7.2 Getter access

```java
mapping.type(User.class)
       .property("username", ElementType.METHOD)
       .constraint(new NotBlankDef());
```

Cocok jika:

- property diekspos lewat getter;
- getter adalah public contract;
- framework lain juga membaca property via getter.

### 7.3 Jangan campur sembarangan

Jika sebagian constraint dipasang pada field dan sebagian pada getter untuk property yang sama, pembaca kode bisa bingung.

Guideline:

```text
Satu model → pilih satu access strategy utama.
```

---

## 8. Class-Level Constraint secara Programmatic

Misalkan ada constraint custom:

```java
@ValidDateRange(start = "startDate", end = "endDate")
public class LeaveRequest {
    private LocalDate startDate;
    private LocalDate endDate;
}
```

Untuk class yang tidak bisa diedit, bisa dipasang secara programmatic dengan custom constraint definition.

Konsep:

```java
mapping.type(LeaveRequest.class)
       .constraint(new ValidDateRangeDef()
               .start("startDate")
               .end("endDate")
               .message("{leave.dateRange.invalid}"));
```

Namun perhatikan:

- class-level rule harus tetap local consistency;
- jangan masukkan workflow state kompleks;
- violation path harus jelas;
- custom constraint def perlu dirancang rapi.

---

## 9. Method and Constructor Constraint Mapping

Programmatic mapping juga bisa dipakai untuk executable validation.

Contoh konseptual:

```java
public class CaseService {
    public CaseDto findCase(String caseReference) {
        // ...
    }
}
```

Kita ingin:

```java
public CaseDto findCase(@NotBlank String caseReference) { ... }
```

Tetapi class tidak bisa diedit. Programmatic mapping dapat menambahkan parameter constraint.

Bentuk konseptualnya:

```java
mapping.type(CaseService.class)
       .method("findCase", String.class)
       .parameter(0)
       .constraint(new NotBlankDef()
               .message("{case.reference.required}"));
```

Untuk return value:

```java
mapping.type(CaseService.class)
       .method("findCase", String.class)
       .returnValue()
       .constraint(new NotNullDef()
               .message("{case.result.required}"));
```

Gunakan dengan hati-hati karena method validation biasanya dieksekusi oleh integration layer seperti:

- Spring method validation proxy;
- CDI interceptor;
- JAX-RS runtime;
- manual `ExecutableValidator`.

Jika runtime tidak memanggil executable validation, metadata tetap ada tetapi tidak otomatis dieksekusi.

---

## 10. Programmatic Mapping untuk Container Element Constraints

Modern validation sering membutuhkan constraint pada elemen container:

```java
List<@NotBlank String> tags
```

Dalam programmatic mapping, konsepnya adalah constraint bukan pada `List`-nya saja, tetapi pada type argument-nya.

Contoh konseptual:

```java
mapping.type(TagRequest.class)
       .property("tags", ElementType.FIELD)
       .containerElementType()
       .constraint(new NotBlankDef());
```

Untuk nested container, mapping menjadi lebih kompleks karena harus menunjuk container element level tertentu.

Gunakan programmatic container mapping hanya jika benar-benar perlu. Annotation jauh lebih mudah dibaca:

```java
private List<@NotBlank String> tags;
```

Programmatic container mapping lebih cocok untuk:

- generated DTO;
- vendor DTO;
- metadata-driven platform;
- migration layer.

---

## 11. Adding Constraint Definitions Programmatically

Ada dua hal yang mirip tetapi berbeda:

```text
1. Constraint declaration
   Menambahkan @NotBlank-like rule ke User.username.

2. Constraint definition
   Mendefinisikan validator apa yang menjalankan annotation tertentu.
```

Constraint declaration menjawab:

> Rule apa diterapkan di mana?

Constraint definition menjawab:

> Annotation ini divalidasi oleh validator class apa?

Hibernate Validator menyediakan mekanisme programmatic untuk constraint definition. Ini berguna untuk advanced use case, misalnya:

- mengganti validator untuk constraint tertentu;
- menambahkan validator untuk type baru;
- membuat constraint composition provider-specific;
- migrasi dari API lama.

Namun ini level advanced dan harus jarang digunakan.

Risikonya:

- behavior global berubah;
- sulit dipahami pembaca;
- sulit dites lintas module;
- bisa tidak portable antar provider;
- bisa pecah saat upgrade major Hibernate Validator.

Guideline:

```text
Deklarasikan constraint secara programmatic bila perlu.
Definisikan ulang constraint validator secara programmatic hanya bila benar-benar unavoidable.
```

---

## 12. Externalized Rule Configuration: Powerful but Dangerous

Misalkan ada konfigurasi seperti ini:

```yaml
models:
  UserRequest:
    username:
      - type: NotBlank
        message: user.username.required
    email:
      - type: Email
        message: user.email.invalid
    age:
      - type: Min
        value: 18
        message: user.age.minimum
```

Lalu aplikasi membaca YAML dan membangun programmatic mapping.

Ini bisa berguna untuk platform, tetapi bahaya jika tidak dikontrol.

### 12.1 Keuntungan

- rule bisa dikelola central;
- model generated tidak perlu diedit;
- rule catalog bisa diekspor;
- deployment-specific mapping bisa dibuat;
- perubahan rule bisa ditelusuri dari config.

### 12.2 Risiko

- validation behavior tidak terlihat di source model;
- typo property baru ketahuan runtime;
- config drift antar environment;
- rule berubah tanpa test memadai;
- tidak semua constraint aman dieksternalisasi;
- custom validator bisa butuh dependency injection;
- performance factory bootstrap bisa memburuk;
- rule menjadi mini language tanpa governance.

### 12.3 Rule config harus typed dan versioned

Jangan buat format config terlalu bebas:

```yaml
expression: "age >= 18 && country == 'SG'"
```

Ini membuka masalah:

- security;
- observability;
- determinism;
- explainability;
- testability;
- injection;
- compatibility.

Lebih baik pakai schema typed:

```yaml
rules:
  - ruleId: USER_AGE_MINIMUM
    targetClass: com.example.UserRequest
    targetProperty: age
    constraint: Min
    attributes:
      value: 18
    severity: ERROR
    messageKey: user.age.minimum
    version: 1
```

---

## 13. Building a Constraint Mapping Registry

Untuk sistem besar, hindari satu class konfigurasi raksasa.

Buruk:

```java
public class AllValidationMappings {
    public ConstraintMapping mapping(HibernateValidatorConfiguration config) {
        // 5000 lines
    }
}
```

Lebih baik pecah per bounded context/module:

```text
validation/
  applicant/
    ApplicantValidationMapping.java
  case/
    CaseValidationMapping.java
  appeal/
    AppealValidationMapping.java
  compliance/
    ComplianceValidationMapping.java
```

Interface:

```java
public interface ValidationMappingContributor {
    void contribute(HibernateValidatorConfiguration configuration,
                    ConstraintMapping mapping);
}
```

Contoh:

```java
public final class ApplicantValidationMapping implements ValidationMappingContributor {
    @Override
    public void contribute(HibernateValidatorConfiguration configuration,
                           ConstraintMapping mapping) {
        mapping.type(ApplicantImportRow.class)
               .property("name", ElementType.FIELD)
                   .constraint(new NotBlankDef().message("{applicant.name.required}"))
               .property("email", ElementType.FIELD)
                   .constraint(new EmailDef().message("{applicant.email.invalid}"));
    }
}
```

Bootstrap:

```java
public final class ValidationBootstrap {
    private final List<ValidationMappingContributor> contributors;

    public ValidationBootstrap(List<ValidationMappingContributor> contributors) {
        this.contributors = List.copyOf(contributors);
    }

    public ValidatorFactory buildFactory() {
        HibernateValidatorConfiguration configuration = Validation
                .byProvider(HibernateValidator.class)
                .configure();

        ConstraintMapping mapping = configuration.createConstraintMapping();

        for (ValidationMappingContributor contributor : contributors) {
            contributor.contribute(configuration, mapping);
        }

        return configuration.addMapping(mapping).buildValidatorFactory();
    }
}
```

Keuntungan:

- ownership jelas;
- review lebih mudah;
- rule per module bisa dites;
- governance lebih baik;
- tidak ada mega mapping class.

---

## 14. Metadata API: Membaca Constraint saat Runtime

Programmatic mapping adalah cara menulis constraint. Metadata API adalah cara membaca constraint.

Entry point:

```java
BeanDescriptor descriptor = validator.getConstraintsForClass(UserRequest.class);
```

Jakarta Validation metadata package menyediakan descriptor untuk bean, property, method, constructor, parameter, return value, group conversion, dan container element constraints.

### 14.1 BeanDescriptor

`BeanDescriptor` merepresentasikan constrained bean.

Contoh:

```java
BeanDescriptor bean = validator.getConstraintsForClass(UserRequest.class);

boolean constrained = bean.isBeanConstrained();
Set<PropertyDescriptor> properties = bean.getConstrainedProperties();
```

Gunanya:

- mengetahui apakah class punya constraint;
- listing property constrained;
- membaca class-level constraints;
- introspeksi executable constraints.

### 14.2 PropertyDescriptor

```java
PropertyDescriptor username = bean.getConstraintsForProperty("username");

if (username != null) {
    Set<ConstraintDescriptor<?>> constraints = username.getConstraintDescriptors();
}
```

Property descriptor bisa memberi tahu:

- constraint pada property;
- apakah property cascaded;
- group conversion;
- container element constraints.

### 14.3 ConstraintDescriptor

`ConstraintDescriptor` adalah metadata tentang satu constraint.

Contoh:

```java
for (ConstraintDescriptor<?> constraint : username.getConstraintDescriptors()) {
    String annotationType = constraint.getAnnotation().annotationType().getName();
    String message = constraint.getMessageTemplate();
    Set<Class<?>> groups = constraint.getGroups();
    Set<Class<? extends Payload>> payload = constraint.getPayload();
    Map<String, Object> attributes = constraint.getAttributes();
}
```

Data ini bisa digunakan untuk:

- error code mapping;
- documentation;
- frontend hint;
- compliance rule catalog;
- test assertion;
- validation drift detection.

---

## 15. Generating API Error Catalog from Metadata

Salah satu use case advanced adalah membuat catalog error validation.

Misalnya dari model:

```java
public class CreateUserRequest {
    @NotBlank(message = "{user.username.required}")
    private String username;

    @Email(message = "{user.email.invalid}")
    private String email;
}
```

Metadata bisa diubah menjadi catalog:

```json
[
  {
    "model": "CreateUserRequest",
    "path": "username",
    "constraint": "NotBlank",
    "messageKey": "user.username.required",
    "groups": ["Default"]
  },
  {
    "model": "CreateUserRequest",
    "path": "email",
    "constraint": "Email",
    "messageKey": "user.email.invalid",
    "groups": ["Default"]
  }
]
```

Ini berguna untuk:

- frontend mapping;
- QA test planning;
- API documentation;
- support playbook;
- audit review;
- backward compatibility check.

Tetapi jangan menganggap metadata otomatis cukup untuk semua docs. Metadata tidak selalu tahu:

- semantic business meaning;
- authorization context;
- state-specific workflow rule;
- database uniqueness;
- cross-service rule;
- conditional rule di service layer.

Jadi metadata validation hanyalah satu bagian dari rule catalog.

---

## 16. Generating Form Hints from Metadata

Metadata dapat membantu UI:

- required marker;
- min/max length;
- numeric range;
- regex hint;
- email format;
- allowed values;
- nested object validation;
- collection item constraints.

Contoh mapping:

| Constraint | UI hint |
|---|---|
| `@NotNull` | required |
| `@NotBlank` | required text |
| `@Size(max=50)` | max length 50 |
| `@Min(18)` | minimum value 18 |
| `@Pattern` | format hint |
| `@Email` | email input hint |

Namun hati-hati:

> Backend validation metadata boleh membantu UI, tetapi UI tidak boleh menjadi satu-satunya enforcement.

Frontend hint adalah convenience. Backend validation tetap authoritative untuk input boundary.

### 16.1 Constraint tidak selalu langsung bisa diterjemahkan ke UI

Contoh:

```java
@ValidDateRange
public class DateRangeRequest { ... }
```

UI perlu tahu bahwa `startDate` dan `endDate` saling terkait. Metadata class-level constraint tidak selalu cukup untuk membuat UX yang bagus.

Solusi:

- stable error code;
- explicit field dependencies;
- documentation tambahan;
- rule catalog yang lebih kaya daripada Bean Validation metadata mentah.

---

## 17. Constraint Metadata for Contract Testing

Metadata API bisa dipakai untuk mencegah accidental contract change.

Contoh scenario:

```text
v1 API:
email optional tetapi jika ada harus valid email.

v2 accidentally:
email menjadi @NotBlank karena developer menambahkan annotation di shared DTO.
```

Ini breaking change.

Contract test bisa membaca metadata dan memastikan:

```java
@Test
void createUserEmailMustNotBecomeRequiredAccidentally() {
    BeanDescriptor bean = validator.getConstraintsForClass(CreateUserRequest.class);
    PropertyDescriptor email = bean.getConstraintsForProperty("email");

    boolean hasNotBlank = email.getConstraintDescriptors().stream()
            .anyMatch(d -> d.getAnnotation().annotationType().getSimpleName().equals("NotBlank"));

    assertFalse(hasNotBlank);
}
```

Ini bukan pengganti behavioral tests, tetapi berguna untuk API compatibility guard.

---

## 18. Metadata for Rule Observability

Saat violation terjadi, kita bisa menggabungkan runtime violation dengan descriptor metadata.

`ConstraintViolation` memberi:

- root bean;
- invalid value;
- path;
- message;
- message template;
- constraint descriptor.

Dari `ConstraintDescriptor`, kita bisa baca:

- annotation type;
- attributes;
- payload;
- groups;
- composing constraints.

Observability event:

```json
{
  "event": "validation_failed",
  "model": "CreateUserRequest",
  "path": "email",
  "constraint": "Email",
  "messageTemplate": "{user.email.invalid}",
  "errorCode": "USER_EMAIL_INVALID",
  "endpoint": "POST /users",
  "channel": "PUBLIC_API",
  "clientVersion": "2026.06",
  "correlationId": "..."
}
```

Jangan log raw invalid value untuk data sensitif.

Better:

```json
{
  "rejectedValueClass": "String",
  "rejectedValueLength": 128,
  "redacted": true
}
```

---

## 19. Programmatic Mapping and Groups

Programmatic mapping tetap bisa menggunakan groups.

Contoh:

```java
mapping.type(ApplicationRequest.class)
       .property("applicantName", ElementType.FIELD)
       .constraint(new NotBlankDef()
               .groups(Create.class)
               .message("{application.applicantName.required}"));
```

Mental model sama seperti:

```java
@NotBlank(groups = Create.class)
private String applicantName;
```

Guideline:

- gunakan groups untuk operation-specific shape;
- jangan gunakan groups sebagai state machine tersembunyi;
- dokumentasikan group taxonomy;
- test setiap group yang exposed oleh API/service.

---

## 20. Programmatic Mapping and Payload

Payload juga bisa dikonfigurasi.

Contoh konseptual:

```java
mapping.type(ApplicationRequest.class)
       .property("email", ElementType.FIELD)
       .constraint(new EmailDef()
               .payload(Severity.Error.class)
               .message("{application.email.invalid}"));
```

Payload berguna untuk machine-readable classification:

- severity;
- UI behavior;
- audit class;
- PII classification;
- remediation category.

Tetapi jika payload terlalu banyak berisi business meaning, constraint metadata menjadi rule engine palsu.

---

## 21. Programmatic Mapping and Message Codes

Message sebaiknya tetap berupa key:

```java
new NotBlankDef().message("{user.username.required}")
```

Bukan hard-coded human text:

```java
new NotBlankDef().message("Username must not be blank")
```

Kenapa?

- i18n;
- stable mapping;
- error catalog;
- FE mapping;
- audit;
- easier refactor.

Untuk machine-readable error code, ada beberapa opsi:

1. gunakan message key sebagai code;
2. gunakan custom annotation attribute `code`;
3. gunakan payload marker;
4. gunakan central mapping dari `(model, path, constraint)` ke code.

Programmatic mapping memudahkan option 4 karena semua rule bisa diregistrasi dalam satu registry.

---

## 22. Metadata for OpenAPI: Useful but Incomplete

Banyak tim ingin generate OpenAPI dari validation constraints.

Contoh mapping:

| Bean Validation | OpenAPI |
|---|---|
| `@NotNull` | `required` |
| `@Size(min,max)` | `minLength`, `maxLength`, `minItems`, `maxItems` |
| `@Min` | `minimum` |
| `@Max` | `maximum` |
| `@Pattern` | `pattern` |
| `@Email` | `format: email` |

Tapi ada gap:

- validation groups tidak langsung cocok dengan satu schema;
- conditional requiredness sulit diekspresikan;
- class-level constraints sulit diekspresikan;
- custom constraints butuh extension;
- PATCH presence semantics tidak otomatis jelas;
- database uniqueness tidak muncul;
- workflow guard tidak muncul.

Jadi jangan menjadikan Bean Validation metadata sebagai satu-satunya API spec source.

Lebih sehat:

```text
OpenAPI schema
    + Bean Validation metadata
    + rule catalog
    + API behavior tests
    + compatibility policy
```

---

## 23. Runtime Metadata and Dynamic Forms

Dynamic form sering ingin membaca constraint dan membuat UI.

Contoh use case:

- agency-specific application form;
- configurable survey;
- import template;
- officer screen;
- admin-defined form.

Bean Validation metadata bisa membantu, tetapi jangan memaksanya untuk semua hal.

### 23.1 Yang cocok dari Bean Validation metadata

- required field;
- max length;
- min/max number;
- allowed format;
- item constraints;
- simple nested object.

### 23.2 Yang tidak cocok

- layout;
- field visibility;
- role-based editability;
- dynamic dependency complex;
- workflow transition behavior;
- jurisdiction-specific legal explanation;
- document evidence requirement;
- asynchronous external check.

Pisahkan:

```text
Form metadata
    controls layout, visibility, editability, labels

Validation metadata
    controls structural correctness

Domain policy
    controls contextual eligibility
```

---

## 24. Multi-Tenant and Jurisdiction-Specific Constraints

Misalnya:

```text
Tenant A: businessName max 100
Tenant B: businessName max 200
Tenant C: businessName max 120
```

Ada beberapa pilihan desain.

### 24.1 Separate DTO per tenant

```java
public class TenantAApplicationRequest { ... }
public class TenantBApplicationRequest { ... }
```

Cocok jika tenant benar-benar berbeda.

Kelemahan:

- DTO explosion;
- duplicated code;
- mapper rumit.

### 24.2 Validation groups per tenant

```java
@Size(max = 100, groups = TenantA.class)
@Size(max = 200, groups = TenantB.class)
private String businessName;
```

Cocok jika variasi sedikit dan stabil.

Kelemahan:

- group explosion;
- model jadi penuh constraint tenant;
- sulit scalable.

### 24.3 Programmatic mapping per tenant factory

```text
ValidatorFactory tenantAFactory
ValidatorFactory tenantBFactory
ValidatorFactory tenantCFactory
```

Cocok jika:

- variasi tenant cukup banyak;
- constraint masih structural;
- tenant set stabil;
- factory bisa dibuat saat startup;
- rule config versioned.

Kelemahan:

- memory overhead;
- bootstrap complexity;
- cache invalidation;
- observability lebih kompleks.

### 24.4 Domain policy layer

Jika variasi rule contextual/complex, lebih baik gunakan policy object.

```java
ValidationDecision decision = tenantPolicy.validate(command, context);
```

---

## 25. ValidatorFactory Strategy untuk Multi-Rule Configuration

Jika programmatic mapping berbeda per tenant/module/version, kita perlu strategy.

### 25.1 Single global factory

```text
One application → one ValidatorFactory
```

Cocok untuk mayoritas aplikasi.

Keuntungan:

- sederhana;
- cepat;
- mudah diintegrasikan framework.

### 25.2 Factory per module

```text
Application module factory
Import module factory
Legacy integration factory
```

Cocok jika constraint source berbeda secara jelas.

### 25.3 Factory per tenant

```text
tenantId → ValidatorFactory
```

Cocok hanya jika tenant count terkendali dan mapping stabil.

Perlu:

- startup build;
- health check;
- rule version;
- memory budget;
- factory close on reload;
- cache eviction policy jika dynamic.

### 25.4 Factory per request

Hampir selalu buruk.

```text
Request → build ValidatorFactory
```

Masalah:

- mahal;
- unpredictable latency;
- pressure allocation;
- metadata rebuild;
- hard to observe;
- resource leak jika factory tidak ditutup.

---

## 26. Hot Reloading Validation Rules

Kadang product ingin rule bisa berubah tanpa redeploy.

Ini mungkin, tetapi mahal secara governance.

### 26.1 Safe hot reload pattern

```text
1. Rule config baru diupload
2. Validate schema config
3. Build ValidatorFactory baru secara isolated
4. Run smoke tests terhadap sample payload
5. Mark as candidate
6. Swap atomically
7. Keep previous factory for rollback
8. Close old factory after grace period
9. Emit audit event
```

Pseudocode:

```java
public final class ReloadableValidatorRegistry {
    private final AtomicReference<VersionedValidator> current = new AtomicReference<>();

    public Validator validator() {
        return current.get().validator();
    }

    public void reload(ValidationRuleConfig config) {
        VersionedValidator candidate = buildAndTest(config);
        VersionedValidator previous = current.getAndSet(candidate);
        previous.closeLater();
    }
}
```

### 26.2 Yang harus diaudit

- siapa mengubah rule;
- kapan rule berubah;
- rule version sebelumnya;
- rule version baru;
- diff rule;
- sample validation result;
- affected endpoint/module;
- rollback id.

### 26.3 Jangan hot reload tanpa test

Rule validation yang salah bisa langsung memblokir semua submission/import/API call.

---

## 27. Programmatic Mapping with Spring Boot

Spring Boot biasanya menyediakan `Validator` bean otomatis jika validation dependency ada.

Jika ingin menambahkan Hibernate Validator programmatic mapping, pendekatan umumnya:

- buat `LocalValidatorFactoryBean` custom;
- configure underlying Hibernate Validator;
- atau expose custom `Validator` untuk use case tertentu.

Konsep:

```java
@Configuration
public class ValidationConfiguration {

    @Bean
    public LocalValidatorFactoryBean validatorFactoryBean() {
        LocalValidatorFactoryBean bean = new LocalValidatorFactoryBean();
        // custom configuration depends on Spring/Hibernate Validator integration style
        return bean;
    }
}
```

Namun integrasi detail bisa berubah berdasarkan Spring Boot major version.

Guideline arsitektur:

```text
Jika programmatic mapping adalah global API contract,
integrasikan ke Validator utama framework.

Jika mapping hanya untuk import/vendor/legacy flow,
buat ValidatorFactory terpisah untuk flow tersebut.
```

Jangan diam-diam mengganti global validator tanpa regression test karena bisa memengaruhi:

- request body validation;
- method validation;
- configuration properties validation;
- JPA validation;
- custom framework integration.

---

## 28. Programmatic Mapping with Jakarta EE / CDI

Dalam Jakarta EE, validation provider biasanya dikelola container. Jika ingin custom provider configuration, lihat mekanisme container/application server yang dipakai.

Untuk use case isolated, bisa bootstrap sendiri:

```java
ValidatorFactory factory = Validation
        .byProvider(HibernateValidator.class)
        .configure()
        .addMapping(mapping)
        .buildValidatorFactory();
```

Tetapi jika ingin container-managed CDI injection ke validators, hati-hati dengan manual bootstrap. Manual factory mungkin tidak memakai integration lifecycle yang sama dengan container.

Guideline:

```text
Untuk aplikasi Jakarta EE:
- gunakan container-managed Validator jika butuh integrasi CDI/interceptor.
- gunakan manual factory hanya untuk isolated validation pipeline.
```

---

## 29. XML Mapping vs Programmatic Mapping

Selain annotation dan programmatic mapping, Bean/Jakarta Validation juga punya XML mapping.

### 29.1 XML mapping cocok ketika

- ingin declarative external config;
- tidak ingin compile code untuk perubahan constraint;
- constraint relatif statis;
- environment enterprise sudah punya governance XML;
- provider portability lebih penting daripada fluent API provider-specific.

### 29.2 Programmatic mapping cocok ketika

- constraint dibangun dari metadata internal typed;
- butuh conditional assembly saat bootstrap;
- ingin reuse Java constants/classes;
- ingin compile-time references sebagian;
- butuh Hibernate Validator-specific extension.

### 29.3 Annotation cocok ketika

- rule stabil;
- rule intrinsic ke model;
- source bisa diedit;
- readability penting;
- provider portability penting.

---

## 30. Governance: Programmatic Mapping Needs Rule Ownership

Jika constraint tersembunyi dalam bootstrap code, governance harus lebih kuat.

Minimal setiap rule punya:

```text
ruleId
ruleName
ownerModule
targetClass
targetProperty
groups
severity
messageKey
constraintType
attributes
introducedIn
lastChangedBy
lastChangedAt
reason
compatibilityImpact
```

Contoh catalog entry:

```json
{
  "ruleId": "APP-REQ-001",
  "ruleName": "Applicant name is required",
  "ownerModule": "application-management",
  "targetClass": "ApplicationSubmitRequest",
  "targetProperty": "applicantName",
  "constraintType": "NotBlank",
  "groups": ["Submit"],
  "severity": "ERROR",
  "messageKey": "application.applicantName.required",
  "introducedIn": "2026.06",
  "compatibilityImpact": "tightening"
}
```

Tanpa catalog, programmatic mapping akan menjadi invisible behavior.

---

## 31. Compatibility and Breaking Change Analysis

Validation changes bisa menjadi breaking change.

### 31.1 Tightening change

Contoh:

```text
Before: email optional
After: email @NotBlank
```

Ini breaking untuk client yang tidak mengirim email.

### 31.2 Relaxing change

```text
Before: @Size(max=50)
After: @Size(max=100)
```

Biasanya backward compatible untuk input, tetapi bisa berdampak ke database/storage/UI.

### 31.3 Message-only change

```text
Before: user.email.invalid
After: email.invalid
```

Jika FE bergantung pada message key, ini breaking.

### 31.4 Group change

```text
Constraint pindah dari Default ke Submit group
```

Bisa mengubah behavior endpoint.

### 31.5 Metadata diff tool

Untuk sistem besar, buat tool yang membandingkan metadata antara versi:

```text
ValidationMetadataSnapshot v1
ValidationMetadataSnapshot v2
    ↓
Diff:
- added required field
- removed constraint
- changed max length
- changed message key
- changed group
- changed payload severity
```

---

## 32. Example: Metadata Snapshot Generator

Contoh sederhana:

```java
public final class ValidationMetadataExporter {

    private final Validator validator;

    public ValidationMetadataExporter(Validator validator) {
        this.validator = validator;
    }

    public List<ConstraintRule> export(Class<?> beanClass) {
        BeanDescriptor bean = validator.getConstraintsForClass(beanClass);
        List<ConstraintRule> rules = new ArrayList<>();

        for (PropertyDescriptor property : bean.getConstrainedProperties()) {
            for (ConstraintDescriptor<?> descriptor : property.getConstraintDescriptors()) {
                rules.add(toRule(beanClass, property.getPropertyName(), descriptor));
            }
        }

        for (ConstraintDescriptor<?> descriptor : bean.getConstraintDescriptors()) {
            rules.add(toRule(beanClass, "<bean>", descriptor));
        }

        return rules;
    }

    private ConstraintRule toRule(Class<?> beanClass,
                                  String path,
                                  ConstraintDescriptor<?> descriptor) {
        return new ConstraintRule(
                beanClass.getName(),
                path,
                descriptor.getAnnotation().annotationType().getName(),
                descriptor.getMessageTemplate(),
                descriptor.getGroups().stream()
                        .map(Class::getName)
                        .sorted()
                        .toList(),
                safeAttributes(descriptor.getAttributes())
        );
    }

    private Map<String, Object> safeAttributes(Map<String, Object> attributes) {
        Map<String, Object> result = new TreeMap<>();
        for (Map.Entry<String, Object> entry : attributes.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if ("payload".equals(key) || "groups".equals(key)) {
                continue;
            }
            result.put(key, String.valueOf(value));
        }
        return result;
    }
}
```

Record:

```java
public record ConstraintRule(
        String beanClass,
        String path,
        String constraintType,
        String messageTemplate,
        List<String> groups,
        Map<String, Object> attributes
) {}
```

Untuk Java 8, ganti `record` dan `.toList()` dengan class biasa dan `Collectors.toList()`.

---

## 33. Example: Detecting Required Fields

Tidak semua required field berarti hanya `@NotNull`.

Required text biasanya:

- `@NotNull`
- `@NotEmpty`
- `@NotBlank`

Contoh detector:

```java
public final class RequiredFieldDetector {

    private static final Set<String> REQUIRED_CONSTRAINTS = Set.of(
            "jakarta.validation.constraints.NotNull",
            "jakarta.validation.constraints.NotEmpty",
            "jakarta.validation.constraints.NotBlank"
    );

    public boolean isRequired(PropertyDescriptor property) {
        return property.getConstraintDescriptors().stream()
                .map(d -> d.getAnnotation().annotationType().getName())
                .anyMatch(REQUIRED_CONSTRAINTS::contains);
    }
}
```

Untuk Java 8:

```java
private static final Set<String> REQUIRED_CONSTRAINTS = new HashSet<>(Arrays.asList(
        "javax.validation.constraints.NotNull",
        "javax.validation.constraints.NotEmpty",
        "javax.validation.constraints.NotBlank"
));
```

Caveat:

- group-specific requiredness perlu group awareness;
- class-level conditional requiredness tidak terdeteksi dari property descriptor;
- composed constraint perlu membaca composing constraints;
- custom required constraint perlu mapping tambahan.

---

## 34. Composed Constraint Metadata

Jika ada composed constraint:

```java
@NotBlank
@Size(max = 20)
@Pattern(regexp = "[A-Z0-9]+")
@Constraint(validatedBy = {})
public @interface CaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Metadata bisa mengandung composing descriptors.

```java
Set<ConstraintDescriptor<?>> composing = descriptor.getComposingConstraints();
```

Gunanya:

- docs bisa menampilkan detail;
- error catalog bisa tahu underlying constraints;
- compatibility diff bisa membaca perubahan internal.

Tetapi jika `@ReportAsSingleViolation` dipakai, runtime violation mungkin dilaporkan sebagai satu violation saja.

Jangan asumsikan jumlah metadata constraint sama dengan jumlah violation runtime.

---

## 35. Container Element Metadata

Untuk:

```java
public class TagRequest {
    private List<@NotBlank String> tags;
}
```

Constraint tidak berada pada property `tags` sebagai list, melainkan pada element `String` di dalam list.

Metadata modern memiliki descriptor untuk container element.

Konsep:

```text
Property: tags
    container element: List element
        constraint: NotBlank
```

Jika tooling Anda hanya membaca `property.getConstraintDescriptors()`, ia bisa melewatkan container element constraints.

Untuk metadata exporter production-grade, pastikan membaca:

- property constraints;
- cascaded flag;
- group conversions;
- container element constraints;
- nested container descriptors.

---

## 36. Executable Metadata

Untuk method validation:

```java
public class UserService {
    public UserDto find(@NotBlank String id) { ... }
}
```

Metadata dapat dibaca dari `BeanDescriptor`:

```java
BeanDescriptor bean = validator.getConstraintsForClass(UserService.class);
MethodDescriptor method = bean.getConstraintsForMethod("find", String.class);
```

Method descriptor bisa memberi:

- parameter descriptors;
- return value descriptor;
- cross-parameter descriptor;
- cascaded return value;
- group conversions.

Gunanya:

- internal service contract documentation;
- method validation diagnostics;
- API framework integration checks;
- regression tests.

---

## 37. Programmatic Mapping and Native Image/AOT Considerations

Pada Java 21+ dan modern deployment, aplikasi kadang memakai AOT/native image.

Programmatic mapping punya dua sisi:

### 37.1 Bisa membantu

Karena constraint dideklarasikan lewat kode, beberapa dependency reflection dari annotation scanning bisa lebih terkontrol.

### 37.2 Bisa menyulitkan

Jika mapping dibangun secara dynamic dari class name string atau config:

```yaml
targetClass: com.example.SomeDto
```

maka native image butuh konfigurasi reflection/resource yang benar.

Guideline:

- hindari class loading dynamic tanpa registry typed;
- gunakan class reference jika bisa;
- test native image validation behavior;
- snapshot metadata saat build/test;
- jangan asumsikan semua reflection bekerja sama seperti JVM biasa.

---

## 38. Java 8 sampai Java 25 Notes

### 38.1 Java 8

- Bean Validation 2.0 relevan.
- `javax.validation` namespace.
- Type-use constraints sudah didukung oleh Bean Validation 2.0.
- Tidak ada records/sealed classes.
- Gunakan class DTO biasa.

### 38.2 Java 11

- Banyak enterprise masih di Java 11 dengan Spring Boot 2.x atau Jakarta EE 8.
- Hati-hati transitive dependency antara `javax` dan `jakarta`.

### 38.3 Java 17

- Baseline penting untuk Jakarta EE 11/Jakarta Validation 3.1 ecosystem.
- Records sudah final.
- Hibernate Validator 9.x menargetkan stack modern.

### 38.4 Java 21

- LTS modern.
- Virtual threads tidak mengubah semantics validation, tetapi mengubah sensitivity terhadap blocking validator.
- Jangan membuat custom validator melakukan blocking DB call pada hot path tanpa reason kuat.

### 38.5 Java 25

- Target modern setelah Java 21.
- Validation design sebaiknya semakin immutable, metadata-driven, observable, dan contract-tested.
- Gunakan records/sealed/value objects jika sesuai, tetapi tetap jaga compatibility dengan framework serialization/deserialization.

---

## 39. Migration: `javax.validation` ke `jakarta.validation`

Programmatic mapping migration bukan hanya import annotation.

Periksa:

```text
javax.validation.Validation
javax.validation.Validator
javax.validation.ValidatorFactory
javax.validation.metadata.*
javax.validation.ConstraintViolation
javax.validation.Payload
```

menjadi:

```text
jakarta.validation.Validation
jakarta.validation.Validator
jakarta.validation.ValidatorFactory
jakarta.validation.metadata.*
jakarta.validation.ConstraintViolation
jakarta.validation.Payload
```

Hibernate Validator classes juga bisa berubah behavior antar major version.

Checklist migration:

- ganti namespace;
- upgrade Hibernate Validator sesuai framework;
- cek `org.hibernate.validator.cfg.defs.*` yang berubah/deprecated/removed;
- cek custom constraint definitions;
- cek XML mapping namespace;
- cek message interpolation behavior;
- cek programmatic mapping compile error;
- cek metadata exporter output;
- cek API error snapshot;
- cek Spring/Jakarta EE integration.

---

## 40. Anti-Patterns

### 40.1 Invisible validation

Rule tidak ada di model, tidak ada di docs, hanya muncul di bootstrap code.

Solusi:

- rule catalog;
- metadata exporter;
- tests;
- owner per mapping.

### 40.2 Factory per request

Mahal dan rawan leak.

Solusi:

- factory per app/module/tenant lifecycle;
- close factory saat shutdown/reload.

### 40.3 Dynamic expression rule engine

Config berisi ekspresi bebas.

Solusi:

- typed rule config;
- limited DSL;
- domain policy object untuk rule kompleks.

### 40.4 Constraint sebagai authorization

Solusi:

- authorization layer terpisah.

### 40.5 Constraint sebagai DB consistency final

Solusi:

- database constraints tetap authoritative.

### 40.6 Metadata-driven UI tanpa backend enforcement

Solusi:

- UI hint hanya convenience;
- backend validation tetap wajib.

### 40.7 Tidak membaca container element metadata

Tooling hanya membaca property constraint, lalu melewatkan `List<@NotBlank String>`.

Solusi:

- metadata traversal lengkap.

### 40.8 Message key dianggap human message

Solusi:

- pisahkan `messageTemplate`, localized message, dan machine code.

---

## 41. Testing Strategy

### 41.1 Test mapping behavior

```java
@Test
void usernameMustNotBeBlank() {
    ExternalUserRequest request = new ExternalUserRequest("", "valid@example.com", 20);

    Set<ConstraintViolation<ExternalUserRequest>> violations = validator.validate(request);

    assertThat(violations)
            .anyMatch(v -> v.getPropertyPath().toString().equals("username")
                    && v.getMessageTemplate().equals("{user.username.required}"));
}
```

### 41.2 Test metadata presence

```java
@Test
void usernameHasNotBlankConstraintInMetadata() {
    BeanDescriptor bean = validator.getConstraintsForClass(ExternalUserRequest.class);
    PropertyDescriptor username = bean.getConstraintsForProperty("username");

    assertThat(username.getConstraintDescriptors())
            .anyMatch(d -> d.getAnnotation().annotationType().getSimpleName().equals("NotBlank"));
}
```

### 41.3 Test API error mapping

Pastikan programmatic constraint menghasilkan error response sama konsistennya dengan annotation constraint.

```json
{
  "errors": [
    {
      "path": "username",
      "code": "USER_USERNAME_REQUIRED",
      "message": "Username is required"
    }
  ]
}
```

### 41.4 Test compatibility snapshot

Simpan metadata snapshot dan compare saat PR.

Perubahan berikut harus memicu review:

- required field baru;
- max length lebih kecil;
- min value lebih besar;
- group berubah;
- message key berubah;
- constraint dihapus;
- severity berubah.

### 41.5 Test invalid config

Jika mapping berasal dari config, test:

- property tidak ada;
- class tidak ada;
- constraint type invalid;
- attribute type invalid;
- duplicate rule id;
- duplicate constraint yang tidak diinginkan;
- unsupported group;
- unsafe regex.

---

## 42. Production Checklist

Sebelum memakai programmatic mapping di production, pastikan:

```text
[ ] Ada alasan kuat tidak memakai annotation.
[ ] Mapping dibuat saat bootstrap, bukan per request.
[ ] ValidatorFactory lifecycle jelas dan ditutup saat shutdown/reload.
[ ] Rule punya owner.
[ ] Rule punya message key stabil.
[ ] Rule punya error code mapping.
[ ] Rule punya test behavior.
[ ] Rule punya metadata/export test jika dipakai sebagai contract.
[ ] Group usage terdokumentasi.
[ ] Tidak ada authorization dalam validator.
[ ] Tidak ada DB consistency final hanya di Bean Validation.
[ ] Tidak ada dynamic expression bebas tanpa sandbox/governance.
[ ] Metadata exporter membaca container element constraints.
[ ] API error mapping konsisten antara annotation dan programmatic constraints.
[ ] Migration javax/jakarta sudah dites.
[ ] Upgrade Hibernate Validator major version punya regression test.
```

---

## 43. Practical Architecture Recommendation

Untuk sistem enterprise besar, gunakan layering berikut:

```text
Annotation constraints
    untuk rule stabil dan dekat dengan model

Programmatic mapping
    untuk generated/vendor/legacy/configured structural constraints

Metadata API
    untuk documentation, catalog, compatibility diff, observability

Command/domain validator
    untuk contextual business rules

Workflow guard
    untuk state transition rules

Database constraints
    untuk final persistence consistency
```

Jangan pakai satu mekanisme untuk semua rule.

Top-tier engineer tidak hanya tahu cara membuat validation berhasil. Ia tahu kapan satu bentuk validation harus berhenti dan layer lain harus mengambil alih.

---

## 44. Ringkasan

Programmatic constraint mapping memberi kemampuan mendeklarasikan validation rule tanpa annotation. Ini sangat berguna untuk generated model, third-party class, legacy DTO, module-specific validation, dan metadata-driven platform.

Namun kemampuan ini harus dipakai dengan governance kuat karena rule menjadi lebih tidak terlihat dibanding annotation. Jika programmatic mapping dipakai untuk menggantikan workflow engine, authorization, atau database consistency, desain akan rapuh.

Runtime metadata API adalah alat yang sangat kuat untuk membaca validation contract. Dengan `BeanDescriptor`, `PropertyDescriptor`, `ConstraintDescriptor`, dan executable/container metadata, kita bisa membangun rule catalog, API documentation, UI hint, compatibility diff, observability, dan regression tests.

Prinsip utama:

```text
Programmatic mapping is configuration.
Metadata introspection is visibility.
Validation execution is enforcement.
Domain policy is context.
Database constraint is final consistency.
```

Jika lima hal ini tidak dicampur sembarangan, validation layer akan menjadi jelas, testable, auditable, dan production-grade.

---

## 45. Referensi

- Jakarta Validation 3.1 Specification — metadata model dan API untuk JavaBean/method validation.
- Jakarta Validation API — `jakarta.validation.metadata` package: `BeanDescriptor`, `PropertyDescriptor`, `ConstraintDescriptor`, `MethodDescriptor`, `ParameterDescriptor`, `ReturnValueDescriptor`.
- Hibernate Validator Reference Guide — provider-specific programmatic constraint declaration dan Hibernate Validator configuration.
- Hibernate Validator 9.x release notes — implementation target Jakarta Validation 3.1 / Jakarta EE 11.
- Bean Validation 2.0 / JSR 380 — type-use constraints, container element constraints, Java 8 support.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-014](./learn-java-validation-jakarta-hibernate-validator-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-016](./learn-java-validation-jakarta-hibernate-validator-part-016.md)
