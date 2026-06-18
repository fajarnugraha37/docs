# learn-java-jakarta-part-011.md

# Bagian 11 — Jakarta JSON Binding (`jakarta.json.bind` / JSON-B)

> Target pembaca: Java engineer yang ingin memahami JSON-B bukan hanya sebagai “serializer/deserializer”, tetapi sebagai **contract boundary** antara Java object model dan JSON document model dalam REST API, event payload, configuration, integration, audit trail, dan migration.
>
> Fokus bagian ini: JSON-B default mapping, `Jsonb`, `JsonbBuilder`, `JsonbConfig`, annotation customization, adapters, serializers/deserializers, null handling, date/time, generics, immutable DTO, Java records, polymorphism, JSON-B vs JSON-P vs Jackson, integration dengan Jakarta REST, security, compatibility, testing, performance, dan production failure modes.

---

## Daftar Isi

1. [Orientasi: Apa Itu JSON-B?](#1-orientasi-apa-itu-json-b)
2. [Mental Model: JSON Document vs Java Object Graph](#2-mental-model-json-document-vs-java-object-graph)
3. [JSON-B vs JSON-P vs Jackson](#3-json-b-vs-json-p-vs-jackson)
4. [Jakarta JSON Binding 3.0 dan Jakarta EE 11](#4-jakarta-json-binding-30-dan-jakarta-ee-11)
5. [Dependency, API, Provider, dan Runtime](#5-dependency-api-provider-dan-runtime)
6. [Core API: `Jsonb`, `JsonbBuilder`, `JsonbConfig`](#6-core-api-jsonb-jsonbbuilder-jsonbconfig)
7. [Default Mapping Algorithm](#7-default-mapping-algorithm)
8. [Serialize Object ke JSON](#8-serialize-object-ke-json)
9. [Deserialize JSON ke Object](#9-deserialize-json-ke-object)
10. [DTO Design: Mutable Bean, Immutable Class, Record](#10-dto-design-mutable-bean-immutable-class-record)
11. [Property Naming dan `@JsonbProperty`](#11-property-naming-dan-jsonbproperty)
12. [`@JsonbTransient`: Menyembunyikan Field/Property](#12-jsonbtransient-menyembunyikan-fieldproperty)
13. [`@JsonbPropertyOrder`: Stabilitas Output](#13-jsonbpropertyorder-stabilitas-output)
14. [Null Handling dan Default Value](#14-null-handling-dan-default-value)
15. [Date/Time Handling](#15-datetime-handling)
16. [Number, BigDecimal, Precision, dan Formatting](#16-number-bigdecimal-precision-dan-formatting)
17. [Enum Mapping](#17-enum-mapping)
18. [Collections, Maps, Arrays, dan Generics](#18-collections-maps-arrays-dan-generics)
19. [Adapters: `JsonbAdapter`](#19-adapters-jsonbadapter)
20. [Custom Serializer dan Deserializer](#20-custom-serializer-dan-deserializer)
21. [Polymorphism dan Type Information](#21-polymorphism-dan-type-information)
22. [JsonValue, JSON-P Interop, dan Hybrid Processing](#22-jsonvalue-json-p-interop-dan-hybrid-processing)
23. [JSON-B dengan Jakarta REST](#23-json-b-dengan-jakarta-rest)
24. [Error Handling dan Error Contract](#24-error-handling-dan-error-contract)
25. [Versioning dan Backward Compatibility](#25-versioning-dan-backward-compatibility)
26. [Security: PII, Mass Assignment, Polymorphism, dan Payload Abuse](#26-security-pii-mass-assignment-polymorphism-dan-payload-abuse)
27. [Performance Engineering](#27-performance-engineering)
28. [Testing Strategy](#28-testing-strategy)
29. [Observability dan Debugging](#29-observability-dan-debugging)
30. [Common Failure Modes](#30-common-failure-modes)
31. [Best Practices dan Anti-Patterns](#31-best-practices-dan-anti-patterns)
32. [Checklist Review](#32-checklist-review)
33. [Latihan Bertahap](#33-latihan-bertahap)
34. [Mini Project: JSON-B API Contract Lab](#34-mini-project-json-b-api-contract-lab)
35. [Referensi Resmi](#35-referensi-resmi)

---

# 1. Orientasi: Apa Itu JSON-B?

Jakarta JSON Binding, biasa disebut **JSON-B**, adalah standard binding layer untuk mengubah Java object menjadi JSON document dan sebaliknya.

Sederhananya:

```text
Java object → JSON document
JSON document → Java object
```

Contoh:

```java
public record CaseDto(
        String caseId,
        String status,
        String assignedOfficer
) {}
```

menjadi JSON:

```json
{
  "caseId": "CASE-2026-0001",
  "status": "OPEN",
  "assignedOfficer": "officer-a"
}
```

## 1.1 Kenapa JSON-B penting?

Di backend modern, JSON adalah format umum untuk:

- REST API request/response;
- event payload;
- webhook payload;
- audit metadata;
- configuration;
- external system integration;
- test fixtures;
- document-like data;
- API contract.

Karena JSON berada di boundary sistem, mapping JSON tidak boleh dianggap trivial.

Mapping JSON memengaruhi:

- public API compatibility;
- backward compatibility;
- validation;
- security;
- data privacy;
- observability;
- performance;
- versioning;
- consumer compatibility;
- migration.

## 1.2 JSON-B adalah specification, bukan hanya library

JSON-B adalah standard API. Ia mendefinisikan:

- runtime API;
- default mapping behavior;
- annotation customization;
- adapter/serializer/deserializer extension;
- configuration options;
- provider model.

Implementation/provider menjalankan behavior actual.

Contoh provider yang umum dikenal di Jakarta ecosystem adalah Yasson, tetapi aplikasi portable sebaiknya bergantung pada JSON-B API dan behavior standard, bukan provider-specific detail kecuali sengaja.

## 1.3 JSON-B dalam Jakarta EE

Dalam Jakarta EE, JSON-B biasanya terintegrasi dengan Jakarta REST.

Artinya resource seperti ini:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public CaseResponse create(CreateCaseRequest request) {
    ...
}
```

bisa otomatis:

```text
read JSON request body
  ↓
deserialize to CreateCaseRequest
  ↓
call resource method
  ↓
serialize CaseResponse to JSON response
```

Jika JSON-B provider dipilih oleh runtime.

## 1.4 Apa yang sering diremehkan?

Banyak bug production muncul dari hal-hal seperti:

- field rename breaking client;
- date format berbeda antar environment;
- `BigDecimal` precision hilang;
- null vs absent field tidak dibedakan;
- enum rename breaking payload;
- unknown fields ignored unexpectedly;
- DTO mutable menerima field yang tidak seharusnya;
- entity langsung di-serialize dan leak data;
- circular reference;
- polymorphic deserialization risk;
- generated API docs tidak sesuai runtime JSON;
- provider berbeda antara test dan production.

Karena itu JSON-B harus dipahami sebagai **API contract technology**, bukan sekadar helper `toJson()`.

---

# 2. Mental Model: JSON Document vs Java Object Graph

JSON dan Java object graph berbeda secara fundamental.

## 2.1 JSON document model

JSON punya tipe dasar:

```text
object
array
string
number
boolean
null
```

JSON tidak punya konsep:

- class;
- interface;
- constructor;
- inheritance;
- method;
- enum type;
- `BigDecimal` vs `double`;
- `Instant` vs `LocalDate`;
- identity/reference;
- cyclic object graph;
- access modifier;
- validation annotation;
- generic type erased runtime;
- domain invariant.

## 2.2 Java object model

Java punya:

- class;
- record;
- interface;
- enum;
- constructor;
- field;
- method;
- inheritance;
- generics;
- access modifier;
- annotations;
- object identity;
- cyclic reference;
- null;
- domain invariant;
- custom type.

## 2.3 Binding berarti translasi, bukan copy

JSON-B melakukan translasi:

```text
JSON object property ↔ Java property/field
JSON array ↔ List/array
JSON string ↔ String/enum/date/time/custom type
JSON number ↔ int/long/BigDecimal/double
JSON null ↔ null or JsonValue.NULL_VALUE depending target/context
```

Translasi ini butuh aturan.

## 2.4 Contract boundary

Saat JSON keluar dari service, ia menjadi contract.

```text
Java internal model boleh berubah.
JSON public contract harus dijaga.
```

Karena itu jangan langsung expose entity/domain object jika contract harus stabil.

## 2.5 DTO as boundary object

Gunakan DTO untuk boundary:

```java
public record CreateCaseRequest(
        String applicantId,
        String caseType,
        String description
) {}
```

DTO bisa berbeda dari domain entity:

```java
public final class EnforcementCase {
    private CaseId id;
    private CaseStatus status;
    private OfficerId assignedOfficer;
    private List<CaseEvent> history;
}
```

## 2.6 Mapping design question

Untuk setiap field, tanya:

1. Apakah field bagian dari public contract?
2. Apakah field boleh null?
3. Apakah field optional?
4. Apakah field write-only/read-only?
5. Apakah field sensitif?
6. Apa format date/number?
7. Apa backward compatibility requirement?
8. Apa consumer behavior jika field ditambah/dihapus?
9. Apakah enum value stabil?
10. Apakah internal refactoring boleh mengubah JSON?

---

# 3. JSON-B vs JSON-P vs Jackson

## 3.1 JSON-B

JSON-B adalah binding API:

```text
Java object ↔ JSON document
```

Cocok untuk:

- DTO mapping;
- REST request/response;
- event payload object;
- simple serialization/deserialization;
- standard Jakarta EE portability;
- provider-neutral mapping.

## 3.2 JSON-P

JSON-P adalah processing API:

```text
programmatic JSON object model / streaming parser-generator
```

Cocok untuk:

- manipulate JSON tanpa DTO;
- streaming large payload;
- JSON Patch/Pointers;
- transform dynamic payload;
- inspect arbitrary JSON;
- preserve structure.

## 3.3 Jackson

Jackson adalah ecosystem populer non-Jakarta-standard untuk JSON binding/processing.

Cocok untuk:

- broad ecosystem;
- advanced features;
- Spring Boot default;
- polymorphism/control yang kaya;
- custom modules;
- many integrations;
- high configurability.

## 3.4 Decision table

| Use case | JSON-B | JSON-P | Jackson |
|---|---:|---:|---:|
| Jakarta EE portable DTO binding | excellent | no | good but non-standard |
| Dynamic JSON transform | limited | excellent | good |
| Streaming huge JSON | not primary | excellent | good |
| Spring Boot default ecosystem | possible | possible | excellent |
| Standard Jakarta REST provider | good | good | runtime-dependent |
| JSON Patch/Pointers | no/limited | excellent | library-dependent |
| Advanced polymorphism | standard support exists | no | very rich |
| Strict custom modules ecosystem | limited | no | excellent |

## 3.5 Top-tier mental model

Tidak ada “serializer terbaik” universal.

Pilih berdasarkan:

- runtime ecosystem;
- portability;
- feature needs;
- performance;
- security posture;
- team familiarity;
- API contract control;
- integration with REST framework;
- compatibility with existing services.

## 3.6 Mixing JSON-B and Jackson

Bisa, tetapi hati-hati:

- annotation berbeda;
- default naming berbeda;
- date format berbeda;
- null handling berbeda;
- polymorphism berbeda;
- REST provider selection bisa berubah;
- test/prod bisa beda.

Jika project memakai JSON-B, jangan diam-diam menambahkan Jackson annotation pada DTO kecuali jelas provider-nya.

---

# 4. Jakarta JSON Binding 3.0 dan Jakarta EE 11

Jakarta JSON Binding 3.0 adalah release yang menjadi bagian Jakarta EE modern. Halaman spesifikasi Jakarta JSON Binding menyebut versi 3.0 sebagai release untuk Jakarta EE 10, dan Jakarta EE 11 release menggunakan JSON-B 3.0.x API line dalam daftar spesifikasinya.

## 4.1 JSON-B 3.0 highlights

Beberapa perubahan/fitur penting JSON-B 3.0 antara lain:

- deserialization of null to `JsonValue.NULL_VALUE`;
- `@JsonbTypeDeserializer` dan `@JsonbTypeAdapter` dapat digunakan sebagai parameter/type annotation;
- support untuk polymorphic types;
- deprecation `@JsonbProperty.nillable()`;
- beberapa backward incompatible changes seperti optional `@JsonbCreator` parameters.

## 4.2 Jakarta EE 11 context

Jakarta EE 11 membawa fokus modernisasi platform dan support Java 17+ serta Java 21 features seperti virtual threads di platform level. Untuk JSON-B, implikasi modernnya adalah:

- DTO bisa memakai Java modern style seperti records jika provider/runtime mendukung;
- API contract harus lebih eksplisit;
- JSON binding harus aman terhadap public API evolution;
- migration `javax.json.bind` ke `jakarta.json.bind` sudah menjadi baseline.

## 4.3 Jakarta JSON Binding 3.1 under development

Halaman JSON-B resmi mencatat JSON Binding 3.1 under development untuk Jakarta EE 12.

Untuk production saat ini, targetkan versi stable yang didukung runtime kamu.

## 4.4 Compatibility rule

Jangan hanya melihat API version.

Pastikan:

```text
Jakarta EE profile/runtime version
JSON-B API version
JSON-B provider implementation version
Jakarta REST integration
Java version
```

selaras.

---

# 5. Dependency, API, Provider, dan Runtime

## 5.1 Maven API dependency

Individual API:

```xml
<dependency>
  <groupId>jakarta.json.bind</groupId>
  <artifactId>jakarta.json.bind-api</artifactId>
  <version>3.0.1</version>
</dependency>
```

Dalam Jakarta EE runtime, biasanya API ini sudah tercakup oleh Platform/Web/Core API sesuai profile.

Contoh Web Profile:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 5.2 API jar bukan provider

`jakarta.json.bind-api` menyediakan API:

- `Jsonb`;
- `JsonbBuilder`;
- `JsonbConfig`;
- annotations;
- adapter/serializer/deserializer contracts.

Tetapi provider yang menjalankan binding harus tersedia.

## 5.3 Dalam Jakarta EE runtime

Runtime/container biasanya menyediakan JSON-B provider.

Untuk WAR:

```xml
<scope>provided</scope>
```

## 5.4 Plain Java app

Jika plain Java app memakai JSON-B:

```bash
java -jar app.jar
```

maka kamu butuh API + provider implementation.

Conceptual:

```xml
<dependency>
  <groupId>jakarta.json.bind</groupId>
  <artifactId>jakarta.json.bind-api</artifactId>
</dependency>

<dependency>
  <groupId>org.eclipse</groupId>
  <artifactId>yasson</artifactId>
</dependency>
```

Version harus dicek sesuai compatibility.

## 5.5 Provider discovery

`JsonbBuilder.create()` memakai provider discovery mechanism.

Jika provider tidak ada, runtime akan gagal membuat `Jsonb`.

## 5.6 Dependency conflict

Common conflict:

- app membawa JSON-B API berbeda dari container;
- provider old version;
- `javax.json.bind` dan `jakarta.json.bind` tercampur;
- JSON-P API/provider mismatch;
- Jakarta REST provider memilih Jackson padahal test memakai JSON-B;
- transitive dependency menarik API lama.

## 5.7 Production rule

Dokumentasikan:

```text
JSON binding provider:
version:
REST provider:
API version:
custom config:
custom adapters:
compatibility tests:
```

---

# 6. Core API: `Jsonb`, `JsonbBuilder`, `JsonbConfig`

## 6.1 `Jsonb`

`Jsonb` adalah abstraction utama untuk JSON Binding operations.

Ia menyediakan operasi:

```text
fromJson: JSON → Java object tree
ToJson: Java object tree → JSON
```

Contoh:

```java
Jsonb jsonb = JsonbBuilder.create();
String json = jsonb.toJson(new CaseDto("CASE-1", "OPEN"));
CaseDto dto = jsonb.fromJson(json, CaseDto.class);
```

`Jsonb` extends `AutoCloseable`, sehingga instance bisa ditutup jika kamu membuatnya manual.

## 6.2 `JsonbBuilder`

Builder membuat `Jsonb` instance.

```java
Jsonb jsonb = JsonbBuilder.create();
```

Dengan config:

```java
JsonbConfig config = new JsonbConfig()
        .withFormatting(true);

Jsonb jsonb = JsonbBuilder.create(config);
```

## 6.3 `JsonbConfig`

`JsonbConfig` mengatur behavior provider standard.

Contoh config umum:

```java
JsonbConfig config = new JsonbConfig()
        .withFormatting(true)
        .withNullValues(false)
        .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES);
```

## 6.4 Config should be centralized

Jangan membuat config random di banyak tempat.

Buat producer:

```java
@ApplicationScoped
public class JsonbProducer {

    @Produces
    @ApplicationScoped
    public Jsonb jsonb() {
        JsonbConfig config = new JsonbConfig()
                .withFormatting(false)
                .withNullValues(false);
        return JsonbBuilder.create(config);
    }
}
```

## 6.5 Multiple Jsonb configs

Kadang kamu butuh lebih dari satu config:

- public API;
- internal event;
- audit payload;
- partner integration.

Gunakan qualifiers:

```java
@PublicApiJson
@EventJson
@AuditJson
```

Jangan pakai satu global config untuk semua jika contract berbeda.

## 6.6 Lifecycle

Jika kamu membuat `Jsonb` manual, pahami lifecycle dan close.

Dalam CDI producer, buat disposer jika perlu.

---

# 7. Default Mapping Algorithm

JSON-B punya default mapping algorithm yang membuat banyak DTO bisa langsung diserialize tanpa annotation.

## 7.1 JavaBean style

Class:

```java
public class CaseDto {
    private String caseId;
    private String status;

    public String getCaseId() { return caseId; }
    public void setCaseId(String caseId) { this.caseId = caseId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
```

JSON:

```json
{
  "caseId": "CASE-1",
  "status": "OPEN"
}
```

## 7.2 Field/property visibility

Default mapping typically uses JavaBean properties and/or accessible fields according to JSON-B rules/provider behavior.

Jangan mengandalkan private field detail jika contract penting. Gunakan DTO dan annotation eksplisit bila perlu.

## 7.3 Constructors

Deserialization butuh cara membuat object:

- no-arg constructor + setters/fields;
- creator annotation/constructor support;
- provider support for records/immutable classes;
- custom deserializer/adapter.

## 7.4 Public contract should be explicit

Jika JSON public, jangan hanya mengandalkan default name dari Java property yang bisa berubah saat refactor.

Gunakan:

```java
@JsonbProperty("case_id")
```

jika contract harus stabil.

## 7.5 Default is good for internal DTO

Default mapping sangat berguna untuk:

- internal DTO;
- tests;
- simple API;
- quick prototype.

Tapi public API/regulatory integration sebaiknya lebih eksplisit.

---

# 8. Serialize Object ke JSON

## 8.1 Basic serialization

```java
public record CaseDto(String caseId, String status) {}

Jsonb jsonb = JsonbBuilder.create();
String json = jsonb.toJson(new CaseDto("CASE-1", "OPEN"));
```

Output conceptual:

```json
{"caseId":"CASE-1","status":"OPEN"}
```

## 8.2 Pretty print

```java
JsonbConfig config = new JsonbConfig()
        .withFormatting(true);
Jsonb jsonb = JsonbBuilder.create(config);
```

Pretty print baik untuk:

- debug;
- test fixture;
- documentation.

Tidak selalu baik untuk high-throughput API karena payload lebih besar.

## 8.3 Serialize to writer/stream

JSON-B API mendukung serialize ke output tertentu melalui method overload.

Gunakan writer/stream untuk menghindari intermediate String jika payload besar.

## 8.4 Avoid serializing entities directly

Bad:

```java
return entityManager.find(CaseEntity.class, id);
```

Risiko:

- lazy loading;
- circular reference;
- leak internal fields;
- expose DB schema;
- unstable contract;
- performance surprises.

Better:

```java
return CaseDto.from(entity);
```

## 8.5 Deterministic output

Jika output perlu stabil untuk tests/signature/cache:

- property order;
- date format;
- null policy;
- number format;
- timezone;
- pretty vs compact;
- map ordering.

JSON object order secara semantic tidak seharusnya penting, tapi real-world tests/signatures kadang sensitif.

---

# 9. Deserialize JSON ke Object

## 9.1 Basic deserialization

```java
String json = "{\"caseId\":\"CASE-1\",\"status\":\"OPEN\"}";
CaseDto dto = jsonb.fromJson(json, CaseDto.class);
```

## 9.2 Deserialization target matters

Target:

```java
CaseDto.class
```

memberi type information.

Untuk generic collection, butuh type info lebih kaya.

## 9.3 Unknown fields

Behavior terhadap unknown fields harus dipahami dan diuji.

Untuk API compatibility, sering consumer harus tolerate extra fields.

Untuk security-sensitive input, unknown field bisa indikasi mass assignment attempt.

## 9.4 Missing fields

JSON:

```json
{"caseId":"CASE-1"}
```

Apa `status`?

- null?
- default?
- invalid?
- ignored?

Jangan biarkan ambiguity. Gunakan validation.

## 9.5 Null fields

JSON:

```json
{"caseId":"CASE-1","status":null}
```

Berbeda dari missing field:

```json
{"caseId":"CASE-1"}
```

Untuk PATCH/partial update, perbedaan ini sangat penting.

## 9.6 Defensive deserialization

Setelah deserialization:

- validate DTO;
- normalize input;
- reject invalid state;
- map to command/domain type;
- do not trust all fields.

---

# 10. DTO Design: Mutable Bean, Immutable Class, Record

## 10.1 Mutable JavaBean DTO

```java
public class CreateCaseRequest {
    private String applicantId;
    private String caseType;

    public CreateCaseRequest() {}

    public String getApplicantId() { return applicantId; }
    public void setApplicantId(String applicantId) { this.applicantId = applicantId; }

    public String getCaseType() { return caseType; }
    public void setCaseType(String caseType) { this.caseType = caseType; }
}
```

Pros:

- broadly supported;
- easy for serializers;
- simple.

Cons:

- mutable;
- object can be partially valid;
- setters can be abused;
- more boilerplate.

## 10.2 Immutable class

```java
public final class CreateCaseRequest {
    private final String applicantId;
    private final String caseType;

    @JsonbCreator
    public CreateCaseRequest(
            @JsonbProperty("applicantId") String applicantId,
            @JsonbProperty("caseType") String caseType
    ) {
        this.applicantId = applicantId;
        this.caseType = caseType;
    }

    public String applicantId() { return applicantId; }
    public String caseType() { return caseType; }
}
```

Pros:

- invariant possible;
- thread-safe;
- no partial mutation.

Cons:

- annotation/config may be needed;
- provider support details matter.

## 10.3 Record DTO

```java
public record CreateCaseRequest(
        String applicantId,
        String caseType
) {}
```

Pros:

- concise;
- immutable-ish data carrier;
- good for DTO;
- natural with Java 17+;
- canonical constructor.

Cons:

- provider support/version matters;
- validation annotations placement must be understood;
- not ideal for all legacy runtimes.

## 10.4 Record with validation

```java
public record CreateCaseRequest(
        @NotBlank String applicantId,
        @NotBlank String caseType,
        @Size(max = 4000) String description
) {}
```

## 10.5 DTO should not be entity

DTO:

```java
public record CaseResponse(String caseId, String status) {}
```

Entity:

```java
@Entity
public class CaseEntity { ... }
```

Keep them separate if API contract and persistence model have different evolution.

## 10.6 Boundary mapping

```java
public CreateCaseCommand toCommand(CreateCaseRequest request, Actor actor) {
    return new CreateCaseCommand(
        ApplicantId.of(request.applicantId()),
        CaseType.of(request.caseType()),
        request.description(),
        actor.id()
    );
}
```

Deserialization should not create domain aggregate directly.

---

# 11. Property Naming dan `@JsonbProperty`

## 11.1 Default property name

Java:

```java
String caseId;
```

JSON default:

```json
{"caseId":"CASE-1"}
```

## 11.2 Explicit property name

```java
public record CaseDto(
        @JsonbProperty("case_id") String caseId,
        @JsonbProperty("case_status") String status
) {}
```

JSON:

```json
{
  "case_id": "CASE-1",
  "case_status": "OPEN"
}
```

## 11.3 Why explicit naming?

Useful when:

- external contract uses snake_case;
- Java refactoring should not break API;
- partner API has fixed name;
- old field name must remain;
- internal name differs from JSON name.

## 11.4 Naming strategy

Global config can set naming strategy:

```java
JsonbConfig config = new JsonbConfig()
        .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES);
```

## 11.5 Global vs local naming

Global strategy is convenient but can surprise.

Local annotation is explicit but verbose.

Rule:

```text
Public/partner contract → prefer explicit annotations or documented global strategy.
Internal payload → default/global strategy may be enough.
```

## 11.6 Rename policy

Renaming Java field should not silently rename JSON contract.

For public APIs, tests should assert JSON property names.

---

# 12. `@JsonbTransient`: Menyembunyikan Field/Property

`@JsonbTransient` prevents mapping of Java Bean property/field/type to JSON representation.

## 12.1 Example

```java
public class UserDto {
    public String username;

    @JsonbTransient
    public String passwordHash;
}
```

Output:

```json
{"username":"fajar"}
```

## 12.2 Use cases

- hide internal field;
- prevent secret exposure;
- avoid circular reference;
- exclude computed/cache fields;
- exclude technical metadata;
- write-only/read-only separation.

## 12.3 Security caution

Do not rely only on `@JsonbTransient` to secure sensitive data.

Better:

- use response DTO without sensitive field;
- separate request DTO and response DTO;
- avoid storing sensitive data in object sent to serializer.

## 12.4 Entity direct serialization risk

Entity may contain:

- password hash;
- internal status;
- audit fields;
- deleted flag;
- tenant ID;
- security classification;
- lazy relations.

Do not patch with many `@JsonbTransient`. Use DTO.

---

# 13. `@JsonbPropertyOrder`: Stabilitas Output

`@JsonbPropertyOrder` specifies property serialization order.

## 13.1 Example

```java
@JsonbPropertyOrder({"caseId", "status", "assignedOfficer"})
public record CaseDto(
        String status,
        String caseId,
        String assignedOfficer
) {}
```

Output order can be controlled.

## 13.2 When useful?

- human-readable logs;
- generated docs/examples;
- test snapshots;
- deterministic output for signature/canonicalization scenario;
- stable contract examples.

## 13.3 JSON semantic note

JSON object property order should not be semantically meaningful.

But real systems sometimes rely on order for:

- broken clients;
- signature canonicalization;
- snapshot tests;
- diff readability.

If signing JSON, use proper canonicalization. Do not casually rely on serializer ordering.

---

# 14. Null Handling dan Default Value

## 14.1 Null vs absent

JSON with null:

```json
{"middleName": null}
```

JSON absent:

```json
{}
```

These can mean different things.

## 14.2 `withNullValues`

`JsonbConfig` can control null serialization.

```java
JsonbConfig config = new JsonbConfig()
        .withNullValues(true);
```

If false, null properties may be omitted.

## 14.3 API design implications

For response:

- omitting null reduces payload;
- including null makes schema explicit.

For request:

- null could mean clear value;
- absent could mean no change;
- invalid null should be rejected.

## 14.4 PATCH problem

For PATCH:

```json
{"phone": null}
```

could mean:

```text
clear phone
```

while:

```json
{}
```

means:

```text
do not change phone
```

DTO with plain nullable fields cannot always distinguish absent vs null.

Use JSON-P or explicit wrapper for partial update.

## 14.5 Default values

Avoid relying on Java field default for business semantics without validation.

Bad:

```java
boolean urgent; // default false if absent
```

If `urgent` must be explicitly provided, use `Boolean` + validation or explicit command rules.

## 14.6 JSON-B 3.0 null to JsonValue

JSON-B 3.0 includes deserialization of null to `JsonValue.NULL_VALUE` in relevant contexts.

This matters when binding JSON-P types.

---

# 15. Date/Time Handling

## 15.1 Date/time is contract-sensitive

Date/time bugs are extremely common.

Questions:

1. Is value instant or local date?
2. Is timezone included?
3. Is offset included?
4. What format?
5. Is it UTC?
6. Is precision seconds/millis/nanos?
7. Can client parse it?

## 15.2 Prefer Java Time API

Use:

```java
Instant
OffsetDateTime
LocalDate
LocalTime
ZonedDateTime
```

Avoid legacy `Date`/`Calendar` in new DTO unless needed.

## 15.3 `Instant`

Good for machine timestamp:

```java
public record AuditEventDto(
        String eventId,
        Instant occurredAt
) {}
```

Usually serialized ISO-8601 depending provider/config.

## 15.4 `LocalDate`

Good for date without time zone:

```java
public record LicenseDto(
        LocalDate issuedDate,
        LocalDate expiryDate
) {}
```

Do not use `Instant` for birthdate/expiry date if business meaning is calendar date.

## 15.5 Format annotation/config

JSON-B provides date format annotation support.

Example concept:

```java
@JsonbDateFormat("yyyy-MM-dd")
LocalDate expiryDate;
```

## 15.6 Production rule

For public API, define date/time format in API contract.

Do not rely on provider default if consumer compatibility matters.

## 15.7 Timezone rule

For instant events:

```text
Use UTC instant / offset-aware format.
```

For local business date:

```text
Use LocalDate and document timezone/business calendar.
```

---

# 16. Number, BigDecimal, Precision, dan Formatting

## 16.1 JSON number ambiguity

JSON has number, but Java has:

- `int`;
- `long`;
- `double`;
- `BigInteger`;
- `BigDecimal`.

## 16.2 Money

Use `BigDecimal` or domain money type.

Bad:

```java
double amount;
```

Good:

```java
BigDecimal amount;
```

Better domain:

```java
public record Money(BigDecimal amount, Currency currency) {}
```

## 16.3 Formatting

JSON-B supports number formatting annotation/config.

But be careful: formatting number as string changes schema.

```json
{"amount":"1,000.50"}
```

is string, not number.

## 16.4 Precision in JavaScript clients

JavaScript number cannot safely represent all 64-bit integers.

If API exposes long ID:

```json
{"id":9223372036854775807}
```

some clients may lose precision.

Use string for identifiers if needed.

## 16.5 Domain ID as string

```java
public record CaseDto(String caseId) {}
```

Good for external ID.

---

# 17. Enum Mapping

## 17.1 Default enum mapping

Enum often maps to name:

```java
enum CaseStatus {
    OPEN,
    IN_REVIEW,
    CLOSED
}
```

JSON:

```json
{"status":"OPEN"}
```

## 17.2 Enum rename is breaking change

Changing:

```java
IN_REVIEW
```

to:

```java
UNDER_REVIEW
```

can break API consumers.

## 17.3 Stable external value

Use adapter or explicit DTO string mapping if enum internal names may change.

```java
public enum CaseStatus {
    OPEN("open"),
    IN_REVIEW("in_review"),
    CLOSED("closed");

    private final String jsonValue;
}
```

Then use adapter/serializer.

## 17.4 Unknown enum value

If client sends unknown enum, decide:

- reject 400;
- map to UNKNOWN;
- ignore;
- feature-gated.

For public APIs, reject with clear error unless forward compatibility demands otherwise.

## 17.5 Event evolution

For event payload, enum evolution is especially important because consumers may lag.

Document allowed values and deprecation.

---

# 18. Collections, Maps, Arrays, dan Generics

## 18.1 Collections

```java
public record CaseListResponse(
        List<CaseSummaryDto> items
) {}
```

JSON:

```json
{
  "items": [
    {"caseId":"CASE-1"},
    {"caseId":"CASE-2"}
  ]
}
```

## 18.2 Empty list vs null

Prefer empty list over null for response collection.

```json
{"items":[]}
```

is easier for clients than:

```json
{"items":null}
```

## 18.3 Map keys

JSON object keys are strings.

Java Map key types other than String require mapping.

```java
Map<CaseId, CaseSummaryDto>
```

needs adapter or conversion.

## 18.4 Generic deserialization

Because Java erases generics, deserializing generic types needs type information.

Example conceptual:

```java
List<CaseDto> cases = jsonb.fromJson(json, new ArrayList<CaseDto>(){}.getClass());
```

But this is not sufficient in general. Use JSON-B API type overloads/provider-supported generic type handling.

## 18.5 Better wrapper DTO

For API response, prefer wrapper record:

```java
public record CaseListResponse(List<CaseDto> items) {}
```

Then deserialize:

```java
CaseListResponse response = jsonb.fromJson(json, CaseListResponse.class);
```

## 18.6 Pagination response

```java
public record PageResponse<T>(
        List<T> items,
        PageMeta meta
) {}
```

Generic page DTO can be harder for JSON-B deserialization. In public API, concrete DTO wrappers can be simpler.

---

# 19. Adapters: `JsonbAdapter`

Adapters map between original Java type and adapted type suitable for JSON.

`JsonbAdapter<Original, Adapted>` has methods:

```java
Adapted adaptToJson(Original obj);
Original adaptFromJson(Adapted obj);
```

## 19.1 Use case: Value object

Domain type:

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case id blank");
        }
    }
}
```

Adapter:

```java
public class CaseIdAdapter implements JsonbAdapter<CaseId, String> {
    @Override
    public String adaptToJson(CaseId obj) {
        return obj.value();
    }

    @Override
    public CaseId adaptFromJson(String obj) {
        return new CaseId(obj);
    }
}
```

DTO:

```java
public record CaseDto(
        @JsonbTypeAdapter(CaseIdAdapter.class)
        CaseId caseId
) {}
```

JSON:

```json
{"caseId":"CASE-1"}
```

## 19.2 Register adapter globally

```java
JsonbConfig config = new JsonbConfig()
        .withAdapters(new CaseIdAdapter());
```

## 19.3 Local vs global adapter

Local annotation:

- explicit;
- good for one field/type;
- can be verbose.

Global config:

- consistent;
- good for common value types;
- can surprise if context differs.

## 19.4 Adapter should be pure

Adapter should not:

- call database;
- call remote service;
- depend on request context;
- mutate global state;
- enforce heavy business workflow.

It should convert representation.

## 19.5 Adapter error

If JSON value invalid:

```java
throw new IllegalArgumentException("Invalid case id")
```

Map this to proper API error in REST layer.

---

# 20. Custom Serializer dan Deserializer

Adapters are good for simple type mapping. Serializer/deserializer are lower-level and more powerful.

## 20.1 Serializer

Custom serializer controls JSON output.

Use cases:

- flatten object;
- custom formatting;
- conditional fields;
- write JSON-P directly;
- optimize output.

## 20.2 Deserializer

Custom deserializer controls JSON input parsing.

Use cases:

- complex polymorphic logic;
- legacy payload compatibility;
- field aliases;
- validation during parse;
- custom date/number semantics.

## 20.3 Avoid overuse

Custom serializers/deserializers can make contract hidden and hard to reason.

Prefer DTO + adapter first.

## 20.4 Example use case

External partner sends:

```json
{
  "case_no": "CASE-1",
  "case_status": "O"
}
```

Internal DTO wants:

```java
public record PartnerCaseDto(CaseId caseId, CaseStatus status) {}
```

A custom deserializer can translate legacy codes.

## 20.5 Testing required

Every custom serializer/deserializer needs golden JSON tests.

---

# 21. Polymorphism dan Type Information

JSON-B 3.0 includes support for handling polymorphic types.

## 21.1 Polymorphism problem

Java:

```java
sealed interface CaseEvent permits CaseCreated, CaseClosed {}
record CaseCreated(String caseId) implements CaseEvent {}
record CaseClosed(String caseId, String reason) implements CaseEvent {}
```

JSON needs type discriminator:

```json
{"type":"case_created","caseId":"CASE-1"}
```

Without discriminator, deserializer cannot know subtype.

## 21.2 Type information

JSON-B annotation package includes polymorphism-related annotations such as `JsonbTypeInfo` and `JsonbSubtype` in JSON-B 3.0 API.

Conceptual:

```java
@JsonbTypeInfo(
    key = "type",
    value = {
        @JsonbSubtype(alias = "case_created", type = CaseCreated.class),
        @JsonbSubtype(alias = "case_closed", type = CaseClosed.class)
    }
)
public interface CaseEvent {}
```

Check exact syntax/version in API docs.

## 21.3 Security caution

Polymorphic deserialization can be dangerous if type names/classes are accepted from untrusted JSON.

Safe strategy:

- use explicit whitelist aliases;
- do not allow arbitrary class names;
- reject unknown type;
- avoid binding directly to powerful classes;
- validate after deserialization.

## 21.4 Event payload design

For events, prefer explicit type field:

```json
{
  "eventType": "case.approved.v1",
  "eventId": "EVT-1",
  "occurredAt": "2026-06-12T10:15:30Z",
  "data": {...}
}
```

Then dispatch based on known event type.

## 21.5 Polymorphism vs simple DTO

If API can be modeled with simple DTOs, avoid polymorphism. It increases complexity for clients and security review.

---

# 22. JsonValue, JSON-P Interop, dan Hybrid Processing

JSON-B and JSON-P are complementary.

## 22.1 `JsonValue`

JSON-P `JsonValue` represents JSON values.

JSON-B 3.0 has improvements around null deserialization to `JsonValue.NULL_VALUE`.

## 22.2 Hybrid use case

Suppose public payload has stable fields plus dynamic metadata:

```json
{
  "caseId": "CASE-1",
  "status": "OPEN",
  "metadata": {
    "source": "partner-a",
    "riskScore": 80
  }
}
```

Java:

```java
public record CasePayload(
        String caseId,
        String status,
        JsonObject metadata
) {}
```

## 22.3 When hybrid helps

- unknown partner fields;
- dynamic config;
- pass-through metadata;
- partial transformation;
- audit raw payload subset.

## 22.4 Risk

Dynamic JSON bypasses type safety.

Validate:

- allowed keys;
- size;
- value types;
- sensitive fields;
- depth.

## 22.5 JSON-P for PATCH

For partial updates, JSON-P can distinguish absent/null more directly than plain DTO.

---

# 23. JSON-B dengan Jakarta REST

## 23.1 Automatic binding

Jakarta REST can use JSON-B provider to map request/response bodies.

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @POST
    public CreateCaseResponse create(CreateCaseRequest request) {
        ...
    }
}
```

## 23.2 Request flow

```text
HTTP JSON body
  ↓
MessageBodyReader / JSON-B provider
  ↓
CreateCaseRequest
  ↓
resource method
```

## 23.3 Response flow

```text
resource returns DTO
  ↓
MessageBodyWriter / JSON-B provider
  ↓
JSON response body
```

## 23.4 Provider selection

Runtime may support JSON-B, JSON-P, Jackson, or provider-specific behavior.

Document which one is active.

## 23.5 Configure JSON-B for REST

Some runtimes allow CDI producer/config integration for JSON-B provider.

Check runtime docs.

## 23.6 Validation order

Typical flow:

```text
JSON parse/deserialization
  ↓
Bean Validation
  ↓
resource method
```

If JSON cannot parse, validation annotations never run.

## 23.7 Error responses

Differentiate:

- malformed JSON;
- valid JSON invalid schema/type;
- valid DTO violates validation;
- valid command violates domain rule.

Return clear errors.

## 23.8 DTO vs domain command

Resource should map request DTO to command:

```java
CreateCaseCommand command = new CreateCaseCommand(
    ApplicantId.of(request.applicantId()),
    CaseType.of(request.caseType()),
    request.description(),
    actor.id()
);
```

---

# 24. Error Handling dan Error Contract

## 24.1 Deserialization error

Example invalid JSON:

```json
{"caseId":
```

Should return `400 Bad Request` with error body.

## 24.2 Type mismatch

```json
{"priority":"high"}
```

but Java expects integer.

Return clear error:

```json
{
  "errorCode": "INVALID_JSON_FIELD",
  "message": "Field priority must be a number",
  "field": "priority"
}
```

## 24.3 Validation error

DTO:

```java
public record CreateCaseRequest(@NotBlank String applicantId) {}
```

JSON:

```json
{"applicantId":""}
```

Return validation error.

## 24.4 Domain error

JSON valid and DTO valid, but business rule fails:

```text
Applicant is suspended.
```

Return domain error code.

## 24.5 Error taxonomy

Use categories:

```text
MALFORMED_JSON
INVALID_JSON_TYPE
VALIDATION_FAILED
DOMAIN_RULE_VIOLATION
UNAUTHORIZED
FORBIDDEN
CONFLICT
INTERNAL_ERROR
```

## 24.6 Do not leak provider exception

Bad:

```json
{"error":"jakarta.json.bind.JsonbException: ... stack trace ..."}
```

Better:

```json
{"errorCode":"MALFORMED_JSON","message":"Request body is not valid JSON."}
```

---

# 25. Versioning dan Backward Compatibility

JSON is contract.

## 25.1 Compatible changes

Usually compatible:

- add optional response field;
- add optional request field if ignored by old server;
- add new enum value only if clients tolerate unknown;
- relax validation.

## 25.2 Breaking changes

Usually breaking:

- rename field;
- remove field;
- change type;
- change date format;
- change enum value;
- make optional field required;
- change null policy;
- change error format.

## 25.3 Field rename strategy

If you must rename:

1. accept both old and new names for input;
2. emit old + new temporarily if needed;
3. document deprecation;
4. monitor usage;
5. remove in major version.

## 25.4 DTO versioning

Options:

- URI versioning: `/v1/cases`;
- media type versioning;
- field-level compatibility;
- event version in payload;
- separate DTO classes.

## 25.5 Event payload

Event consumers may be async and slower to upgrade.

Be more conservative with event JSON changes.

## 25.6 Contract tests

Use golden JSON tests and consumer-driven contract tests.

---

# 26. Security: PII, Mass Assignment, Polymorphism, dan Payload Abuse

## 26.1 PII leak

Avoid serializing object containing sensitive fields.

Bad:

```java
return userEntity;
```

Better:

```java
return new UserResponse(user.id(), user.displayName());
```

## 26.2 `@JsonbTransient` is not enough

It helps, but DTO separation is safer.

## 26.3 Mass assignment

If request DTO has fields client should not set:

```java
public class CreateUserRequest {
    public String username;
    public boolean admin; // dangerous
}
```

Attacker can send:

```json
{"username":"x","admin":true}
```

Fix:

- separate admin-only DTO;
- ignore/forbid server-controlled fields;
- map only allowed fields to command.

## 26.4 Unknown field policy

For security-sensitive endpoint, decide whether unknown fields are rejected.

Silent ignore can hide attacks.

## 26.5 Polymorphic deserialization

Never allow arbitrary class type from untrusted JSON.

Use whitelist aliases.

## 26.6 Payload size/depth

Large/deep payload can cause memory/CPU issues.

Protect with:

- HTTP body size limit;
- JSON parser limits if available;
- timeout;
- validation;
- streaming for large data.

## 26.7 Logging

Do not log full JSON request body by default.

Mask:

- password;
- token;
- NRIC/ID;
- email/phone;
- address;
- payment data;
- secrets.

## 26.8 Deserialization side effects

Constructors/adapters/deserializers should not perform side effects.

Do not call external service during JSON parse.

---

# 27. Performance Engineering

## 27.1 Cost sources

JSON-B overhead comes from:

- reflection/introspection;
- annotation processing;
- object allocation;
- string allocation;
- date formatting;
- adapters/serializers;
- generic type handling;
- provider lookup;
- pretty printing;
- large payload tree.

## 27.2 Reuse `Jsonb`

Avoid creating `Jsonb` per request.

Bad:

```java
String serialize(Object o) {
    return JsonbBuilder.create().toJson(o);
}
```

Better:

```java
@ApplicationScoped
public class JsonService {
    private final Jsonb jsonb;

    @Inject
    public JsonService(Jsonb jsonb) {
        this.jsonb = jsonb;
    }
}
```

Check provider thread-safety and lifecycle; `Jsonb` is generally intended as reusable abstraction, but follow API/provider docs.

## 27.3 Avoid pretty print in hot path

Pretty JSON increases size and CPU.

Use compact for APIs.

## 27.4 Streaming for huge payload

If payload is huge, JSON-B object mapping may allocate too much.

Use JSON-P streaming or chunked processing.

## 27.5 Avoid entity graph serialization

Entity graph can trigger lazy loads and N+1 queries.

DTO projection is safer and faster.

## 27.6 Cache metadata carefully

Provider likely caches metadata. Avoid creating many differently configured `Jsonb` instances.

## 27.7 Measure

Use:

- JFR allocation profile;
- endpoint latency metrics;
- payload size metrics;
- GC logs;
- load tests;
- JSON parse error counts.

## 27.8 Hot endpoint checklist

- DTO minimal?
- no huge nested graph?
- no pretty print?
- no expensive adapter?
- no `toString()` on large object?
- no full body logging?
- response compression configured if needed?

---

# 28. Testing Strategy

## 28.1 Golden JSON tests

For public API DTO:

```java
@Test
void serializesCaseResponseContract() {
    var dto = new CaseResponse("CASE-1", "OPEN");
    String json = jsonb.toJson(dto);
    assertThatJson(json).isEqualTo("""
        {"caseId":"CASE-1","status":"OPEN"}
        """);
}
```

## 28.2 Deserialization tests

Test:

- valid JSON;
- missing field;
- null field;
- unknown field;
- wrong type;
- invalid enum;
- invalid date;
- extra fields.

## 28.3 Round-trip tests

```text
object → JSON → object
```

Useful, but not enough for public contract because it can pass even if JSON contract changed.

## 28.4 Contract tests

Test exact JSON field names and formats.

## 28.5 REST integration tests

Test actual Jakarta REST runtime because provider selection/config matters.

```text
HTTP request JSON → resource DTO → response JSON
```

## 28.6 Provider parity

Ensure test provider equals production provider/config.

## 28.7 Adapter tests

Every adapter should have direct unit tests:

- adaptToJson;
- adaptFromJson;
- invalid value;
- null value if allowed.

## 28.8 Security tests

Test:

- sensitive fields absent;
- mass assignment field rejected/ignored safely;
- polymorphism unknown type rejected;
- large payload rejected;
- invalid payload returns safe error.

---

# 29. Observability dan Debugging

## 29.1 What to log

Log metadata, not whole payload:

- endpoint;
- content type;
- payload size;
- parse success/failure;
- error category;
- correlation ID;
- DTO class;
- provider version if startup log.

## 29.2 What not to log

Avoid full body logs containing:

- password;
- token;
- PII;
- documents;
- address;
- phone/email;
- financial details.

## 29.3 Startup log

Log JSON provider/config once:

```text
JSON-B provider: ...
JSON-B config: compact, nullValues=false, naming=snake_case
```

Do not log secrets.

## 29.4 Metrics

Track:

- JSON parse errors;
- JSON mapping errors;
- validation errors;
- average payload size;
- large payload rejected;
- serialization latency for large responses.

## 29.5 Debugging mismatch

If output differs:

1. check active provider;
2. check config;
3. check annotations;
4. check DTO accessors/constructors;
5. check adapter registration;
6. check REST provider selection;
7. check test/prod dependency versions.

---

# 30. Common Failure Modes

## 30.1 `JsonbException`

Generic JSON-B exception.

Possible causes:

- malformed JSON;
- unsupported type;
- no suitable constructor;
- adapter failure;
- serializer failure;
- invalid enum/date/number;
- provider missing.

## 30.2 Provider not found

```text
No JsonbProvider found
```

Cause:

- API jar present, provider missing;
- ServiceLoader issue;
- dependency scope wrong;
- runtime not providing JSON-B.

## 30.3 No no-arg constructor / creator

Mutable JavaBean deserialization may require no-arg constructor.

Fix:

- add no-arg constructor;
- use record/creator support;
- add `@JsonbCreator`;
- custom deserializer.

## 30.4 Field missing after serialization

Possible causes:

- no getter;
- visibility rules;
- `@JsonbTransient`;
- null omitted;
- naming mismatch;
- adapter returns null.

## 30.5 Date format mismatch

Test output and configure format explicitly.

## 30.6 BigDecimal precision loss

Causes:

- using double;
- client precision;
- adapter formatting;
- database conversion.

## 30.7 Entity serialization explosion

Symptoms:

- huge response;
- StackOverflow/circular reference;
- lazy loading exception;
- N+1 queries.

Fix:

- DTO projection;
- avoid entity response.

## 30.8 Unknown field silently ignored

Can hide client bugs or attack attempts.

Define unknown field policy.

## 30.9 Test/prod mismatch

Test uses manually created `Jsonb`, REST runtime uses different provider/config.

Fix integration test with actual runtime.

---

# 31. Best Practices dan Anti-Patterns

## 31.1 Best practices

- Use DTOs for public JSON contracts.
- Keep entities/domain objects separate from JSON API response.
- Define date/time format explicitly for public API.
- Use `BigDecimal` for money/precise numbers.
- Use adapters for value objects.
- Keep adapters pure and side-effect-free.
- Use golden JSON tests for public contracts.
- Validate after deserialization.
- Reject or monitor unknown fields where security matters.
- Avoid logging full JSON bodies.
- Reuse `Jsonb` instance/config.
- Document provider/config.
- Test with actual Jakarta REST runtime.

## 31.2 Anti-pattern: Entity as API DTO

```java
@GET
public CaseEntity getCase() { ... }
```

Avoid for production public API.

## 31.3 Anti-pattern: Serializer as business logic

Bad:

```java
public void serialize(...) {
    repository.updateStatus(...);
}
```

Serialization must not mutate business state.

## 31.4 Anti-pattern: Global config surprise

Changing global naming/null/date config can break many APIs.

Use versioned contract tests.

## 31.5 Anti-pattern: Blind round-trip test

Round-trip test can pass while JSON field names changed.

Use golden tests.

## 31.6 Anti-pattern: Polymorphism with arbitrary class names

Dangerous for untrusted JSON.

Use explicit whitelist.

## 31.7 Anti-pattern: DTO with server-controlled fields

Request DTO should not include fields client must not set.

---

# 32. Checklist Review

## 32.1 Contract

- [ ] DTO separate from entity/domain where needed?
- [ ] JSON field names stable?
- [ ] Date/time format documented?
- [ ] Number precision reviewed?
- [ ] Enum values stable?
- [ ] Null vs absent semantics defined?
- [ ] Unknown field policy defined?
- [ ] Versioning strategy defined?

## 32.2 Implementation

- [ ] JSON-B provider known?
- [ ] Config centralized?
- [ ] `Jsonb` reused?
- [ ] Adapters registered intentionally?
- [ ] Custom serializers/deserializers tested?
- [ ] REST runtime uses same config?
- [ ] API/provider versions aligned?

## 32.3 Security

- [ ] Sensitive fields not serialized?
- [ ] Request DTO excludes server-controlled fields?
- [ ] Polymorphism whitelist used?
- [ ] Payload size/depth protected?
- [ ] Full body logging disabled/masked?
- [ ] Deserialization errors sanitized?

## 32.4 Testing

- [ ] Golden JSON serialization tests?
- [ ] Deserialization invalid input tests?
- [ ] Adapter tests?
- [ ] REST integration tests?
- [ ] Contract tests?
- [ ] Test/prod provider parity checked?

## 32.5 Performance

- [ ] No entity graph serialization?
- [ ] No pretty print in hot path?
- [ ] Payload size monitored?
- [ ] Large payload uses streaming if needed?
- [ ] Adapter/serializer not doing remote I/O?

---

# 33. Latihan Bertahap

## Latihan 1 — Basic JSON-B

Buat record:

```java
record CaseDto(String caseId, String status) {}
```

Serialize/deserialize dengan `Jsonb`.

## Latihan 2 — Property naming

Gunakan `@JsonbProperty("case_id")`.

Pastikan output tidak berubah saat Java component rename.

## Latihan 3 — Null policy

Bandingkan config:

```java
withNullValues(true)
withNullValues(false)
```

## Latihan 4 — Date format

Serialize `Instant`, `OffsetDateTime`, dan `LocalDate`.

Definisikan format contract.

## Latihan 5 — Value object adapter

Buat `CaseId` value object dan `JsonbAdapter<CaseId, String>`.

## Latihan 6 — Unknown fields

Kirim JSON dengan field extra.

Amati behavior provider/runtime.

## Latihan 7 — Entity vs DTO

Serialize entity dengan lazy relation.

Lihat risk.

Refactor ke DTO.

## Latihan 8 — Polymorphism

Buat event interface dan dua subtype.

Coba type info/whitelist.

## Latihan 9 — REST integration

Buat JAX-RS endpoint memakai DTO JSON-B.

Test request/response actual HTTP.

## Latihan 10 — Security test

Pastikan `passwordHash`, token, dan internal flags tidak keluar di JSON.

---

# 34. Mini Project: JSON-B API Contract Lab

## 34.1 Goal

Buat repository:

```text
jsonb-api-contract-lab/
```

## 34.2 Modules

```text
basic-binding/
record-dto/
value-object-adapter/
custom-serializer/
rest-integration/
contract-tests/
security-tests/
performance-tests/
```

## 34.3 Domain example

Sistem case management:

```text
CreateCaseRequest
CreateCaseCommand
CaseResponse
CaseSummary
CaseEvent
AuditMetadata
```

## 34.4 Requirements

- Jakarta JSON-B API;
- JSON-B provider;
- Jakarta REST integration;
- DTO not entity;
- custom adapter for `CaseId`;
- explicit date format;
- golden JSON tests;
- invalid JSON tests;
- sensitive data test;
- large payload test.

## 34.5 Deliverables

```text
README.md
JSON-CONTRACT.md
JSONB-CONFIG.md
DTO-DESIGN.md
ADAPTERS.md
ERROR-CONTRACT.md
SECURITY-NOTES.md
PERFORMANCE-NOTES.md
```

## 34.6 Experiments

1. Default mapping vs explicit property.
2. Mutable DTO vs record DTO.
3. Null vs absent.
4. Date/time serialization.
5. Value object adapter.
6. Custom serializer.
7. Polymorphic event payload.
8. JSON-B in Jakarta REST.
9. Golden JSON contract test.
10. Payload abuse/security test.

## 34.7 Evaluation questions

1. What is the active JSON-B provider?
2. Which config affects public contract?
3. Which fields are stable contract fields?
4. How are value objects represented?
5. How do you handle unknown fields?
6. How do you distinguish null vs absent?
7. What happens if enum value changes?
8. What is your date/time format policy?
9. How do you prevent PII leak?
10. How do you prove JSON contract compatibility?

---

# 35. Referensi Resmi

Referensi utama:

1. Jakarta JSON Binding 3.0  
   https://jakarta.ee/specifications/jsonb/3.0/

2. Jakarta JSON Binding 3.0 Specification  
   https://jakarta.ee/specifications/jsonb/3.0/jakarta-jsonb-spec-3.0

3. Jakarta JSON Binding 3.0 API Docs  
   https://jakarta.ee/specifications/jsonb/3.0/apidocs/

4. `Jsonb` API Docs  
   https://jakarta.ee/specifications/jsonb/3.0/apidocs/jakarta.json.bind/jakarta/json/bind/jsonb

5. `JsonbConfig` API Docs  
   https://jakarta.ee/specifications/platform/9/apidocs/jakarta/json/bind/jsonbconfig

6. `JsonbAdapter` API Docs  
   https://jakarta.ee/specifications/platform/9/apidocs/jakarta/json/bind/adapter/jsonbadapter

7. JSON-B Annotation Package API Docs  
   https://jakarta.ee/specifications/jsonb/3.0/apidocs/jakarta.json.bind/jakarta/json/bind/annotation/package-summary

8. Jakarta EE Tutorial — JSON Binding  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonb/jsonb.html

9. Jakarta JSON Binding Specification List  
   https://jakarta.ee/specifications/jsonb/

10. Jakarta EE 11 Release  
    https://jakarta.ee/release/11/

---

# Penutup

JSON-B terlihat sederhana:

```java
jsonb.toJson(object)
jsonb.fromJson(json, Type.class)
```

Tetapi dalam production, JSON-B berada di boundary sistem.

Boundary berarti contract.

Contract berarti perubahan kecil bisa berdampak besar:

```text
field rename
null policy
date format
enum value
number precision
unknown field behavior
polymorphism
sensitive field leak
```

Mental model paling penting:

> JSON-B bukan hanya serializer. JSON-B adalah mekanisme binding antara object model Java dan contract JSON eksternal.

Engineer top-tier tidak hanya bertanya “bagaimana serialize object?” tetapi:

```text
Apakah ini public contract?
Apakah DTO aman?
Apakah field stable?
Apakah null/absent jelas?
Apakah date/number format eksplisit?
Apakah sensitive data terlindungi?
Apakah provider sama antara test dan production?
Apakah contract dites dengan golden JSON?
```

Bagian berikutnya akan masuk ke **Jakarta Persistence (`jakarta.persistence` / JPA)**, salah satu spesifikasi paling kompleks dan paling sering menjadi sumber performance, consistency, transaction, dan domain modeling trade-off di aplikasi enterprise Java.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 10 — Jakarta JSON Processing: `jakarta.json` / JSON-P](./learn-java-jakarta-part-010.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 12 — Jakarta Persistence (`jakarta.persistence`) / JPA](./learn-java-jakarta-part-012.md)
