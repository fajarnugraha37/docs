# learn-jaxrs-advanced-part-012.md

# Bagian 012 — JSON in JAX-RS: JSON-B, JSON-P, Jackson, Provider Selection, DTO Contract, Null Policy, Unknown Fields, Date/Time, Enum Wire Values, dan Security

> Target pembaca: Java/Jakarta engineer yang ingin menguasai JSON di JAX-RS/Jakarta REST secara mendalam. Fokus part ini bukan hanya “bisa return object jadi JSON”, tetapi memahami JSON sebagai **public wire contract**: provider selection, JSON-B vs JSON-P vs Jackson, DTO design, null/unknown field policy, record support, date/time, enum wire value, polymorphism, security, schema, versioning, performance, observability, dan testing.
>
> Namespace dan teknologi utama: Jakarta REST 4.0, Jakarta JSON Binding 3.0, Jakarta JSON Processing 2.1, Jackson Jakarta-RS provider, `MessageBodyReader`, `MessageBodyWriter`, `ContextResolver`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: JSON adalah Wire Contract, Bukan Sekadar Serialization](#2-mental-model-json-adalah-wire-contract-bukan-sekadar-serialization)
3. [Di Mana JSON Masuk dalam Pipeline JAX-RS](#3-di-mana-json-masuk-dalam-pipeline-jax-rs)
4. [JSON-B, JSON-P, Jackson: Tiga Mental Model Berbeda](#4-json-b-json-p-jackson-tiga-mental-model-berbeda)
5. [Jakarta JSON-B: Object Binding](#5-jakarta-json-b-object-binding)
6. [Jakarta JSON-P: Object Model dan Streaming Model](#6-jakarta-json-p-object-model-dan-streaming-model)
7. [Jackson: Data Binding, Tree Model, Streaming, dan Jakarta-RS Provider](#7-jackson-data-binding-tree-model-streaming-dan-jakarta-rs-provider)
8. [Provider Selection di JAX-RS](#8-provider-selection-di-jax-rs)
9. [JSON sebagai `MessageBodyReader` dan `MessageBodyWriter`](#9-json-sebagai-messagebodyreader-dan-messagebodywriter)
10. [Classpath/Runtime Provider Conflict](#10-classpathruntime-provider-conflict)
11. [JSON-B Default di Jakarta EE vs Jackson di Banyak Stack](#11-json-b-default-di-jakarta-ee-vs-jackson-di-banyak-stack)
12. [Kapan Memilih JSON-B](#12-kapan-memilih-json-b)
13. [Kapan Memilih JSON-P](#13-kapan-memilih-json-p)
14. [Kapan Memilih Jackson](#14-kapan-memilih-jackson)
15. [DTO Boundary: Request DTO, Response DTO, Domain Model, Entity](#15-dto-boundary-request-dto-response-dto-domain-model-entity)
16. [Request DTO Design](#16-request-dto-design)
17. [Response DTO Design](#17-response-dto-design)
18. [Java Records untuk DTO](#18-java-records-untuk-dto)
19. [POJO DTO: Getter/Setter dan No-Arg Constructor](#19-pojo-dto-gettersetter-dan-no-arg-constructor)
20. [JSON Property Naming Policy](#20-json-property-naming-policy)
21. [Null Policy: Include, Exclude, atau Reject](#21-null-policy-include-exclude-atau-reject)
22. [Missing Field vs Null Field vs Empty String](#22-missing-field-vs-null-field-vs-empty-string)
23. [Unknown Field Policy: Ignore vs Reject](#23-unknown-field-policy-ignore-vs-reject)
24. [Default Values: DTO, Provider, atau Service?](#24-default-values-dto-provider-atau-service)
25. [Date/Time JSON Contract](#25-datetime-json-contract)
26. [Enum Wire Values](#26-enum-wire-values)
27. [Number, BigDecimal, Money, dan Precision](#27-number-bigdecimal-money-dan-precision)
28. [Boolean dan Tri-State Semantics](#28-boolean-dan-tri-state-semantics)
29. [Collections: Empty Array vs Null](#29-collections-empty-array-vs-null)
30. [Map/Object Dynamic Fields](#30-mapobject-dynamic-fields)
31. [JSON-P `JsonObject` untuk Dynamic Payload](#31-json-p-jsonobject-untuk-dynamic-payload)
32. [JSON-P Streaming untuk Large JSON](#32-json-p-streaming-untuk-large-json)
33. [Polymorphism: Kenapa Berbahaya Jika Sembarangan](#33-polymorphism-kenapa-berbahaya-jika-sembarangan)
34. [JSON-B Polymorphic Support dan Jackson Polymorphic Typing](#34-json-b-polymorphic-support-dan-jackson-polymorphic-typing)
35. [Custom Serialization/Deserialization](#35-custom-serializationdeserialization)
36. [`ContextResolver<Jsonb>` dan `ContextResolver<ObjectMapper>`](#36-contextresolverjsonb-dan-contextresolverobjectmapper)
37. [JSON Provider Configuration sebagai API Contract](#37-json-provider-configuration-sebagai-api-contract)
38. [Validation: JSON Deserialization vs Jakarta Validation](#38-validation-json-deserialization-vs-jakarta-validation)
39. [Error Taxonomy untuk JSON](#39-error-taxonomy-untuk-json)
40. [Problem Details untuk JSON Error](#40-problem-details-untuk-json-error)
41. [PATCH: JSON Merge Patch dan JSON Patch](#41-patch-json-merge-patch-dan-json-patch)
42. [JSON Schema dan Contract Testing](#42-json-schema-dan-contract-testing)
43. [OpenAPI dan JSON Contract](#43-openapi-dan-json-contract)
44. [Security: Deserialization, Unknown Fields, Depth, Size, Polymorphism](#44-security-deserialization-unknown-fields-depth-size-polymorphism)
45. [Performance: Object Binding vs Tree vs Streaming](#45-performance-object-binding-vs-tree-vs-streaming)
46. [Observability: Jangan Log JSON Body Mentah](#46-observability-jangan-log-json-body-mentah)
47. [Testing JSON Behavior](#47-testing-json-behavior)
48. [Runtime Differences: Jersey, RESTEasy, CXF, Open Liberty, Payara, Quarkus](#48-runtime-differences-jersey-resteasy-cxf-open-liberty-payara-quarkus)
49. [Migration: `javax` → `jakarta`, JSON-B/Jackson Artifacts](#49-migration-javax--jakarta-json-bjackson-artifacts)
50. [Common Failure Modes](#50-common-failure-modes)
51. [Best Practices](#51-best-practices)
52. [Anti-Patterns](#52-anti-patterns)
53. [Production Checklist](#53-production-checklist)
54. [Latihan](#54-latihan)
55. [Referensi Resmi](#55-referensi-resmi)
56. [Penutup](#56-penutup)

---

# 1. Tujuan Part Ini

JSON adalah format paling umum untuk REST API modern.

Di JAX-RS, JSON tampak sederhana:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get() {
    return new CustomerResponse("C001", "Fajar");
}
```

atau:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) {
    ...
}
```

Tetapi production-grade JSON jauh lebih dalam:

- library/provider apa yang membaca dan menulis JSON?
- apa yang terjadi jika field tidak dikenal?
- apakah null ditulis?
- apakah missing field beda dengan null?
- bagaimana date/time diformat?
- apakah enum memakai `ACTIVE`, `active`, atau object?
- apakah Java record didukung?
- bagaimana JSON-B berbeda dari Jackson?
- kapan memakai JSON-P?
- bagaimana mencegah deserialization attack?
- bagaimana memastikan JSON tidak berubah saat upgrade dependency?
- bagaimana membuat contract test?

## 1.1 Prinsip utama

```text
JSON is not just serialization output.
JSON is a public compatibility contract.
```

## 1.2 Target akhir

Setelah part ini, kamu bisa:

- memilih JSON-B/JSON-P/Jackson secara sadar;
- memahami provider selection JAX-RS;
- mendesain DTO JSON stabil;
- mengatur null/unknown/missing policy;
- mengelola date/time dan enum wire format;
- menghindari deserialization security risk;
- menulis JSON contract tests;
- menghindari break saat upgrade provider/runtime.

---

# 2. Mental Model: JSON adalah Wire Contract, Bukan Sekadar Serialization

Serialization mindset:

```text
Java object → JSON otomatis
```

Contract mindset:

```text
Resource representation → versioned public JSON shape
```

Perbedaan ini besar.

## 2.1 Serialization mindset yang berbahaya

```java
return customerEntity;
```

Dengan harapan provider akan mengubah entity ke JSON.

Masalah:

- field internal ikut keluar;
- relasi JPA lazy loading;
- infinite recursion;
- null policy tidak jelas;
- format tanggal berubah;
- enum berubah jika nama enum berubah;
- provider upgrade mengubah output;
- client bergantung pada field tak disengaja.

## 2.2 Contract mindset

```java
public record CustomerResponse(
    String id,
    String displayName,
    String status,
    List<LinkResponse> links
) {}
```

Resource mengembalikan DTO yang memang dirancang untuk client.

## 2.3 JSON shape adalah API

Contoh:

```json
{
  "id": "C001",
  "displayName": "Fajar",
  "status": "active"
}
```

Ini kontrak.

Jika berubah menjadi:

```json
{
  "customerId": "C001",
  "name": "Fajar",
  "status": "ACTIVE"
}
```

itu breaking change untuk client tertentu.

## 2.4 Top-tier rule

```text
Do not let Java implementation details accidentally become JSON API contract.
```

---

# 3. Di Mana JSON Masuk dalam Pipeline JAX-RS

## 3.1 Request JSON

```text
HTTP JSON bytes
  ↓
Content-Type: application/json
  ↓
@Consumes(application/json)
  ↓
MessageBodyReader
  ↓
Request DTO
  ↓
Validation
  ↓
Resource method
```

## 3.2 Response JSON

```text
Resource returns Response DTO
  ↓
@Produces(application/json)
  ↓
Accept: application/json
  ↓
MessageBodyWriter
  ↓
HTTP JSON bytes
```

## 3.3 Reader/writer provider

JSON support is implemented as JAX-RS providers:

```java
MessageBodyReader<T>
MessageBodyWriter<T>
```

## 3.4 If provider missing

Request:

```text
415 / 400 / provider error
```

Response:

```text
500-ish writer failure
```

depending runtime and stage.

## 3.5 JAX-RS spec vs JSON library

JAX-RS defines provider mechanism.

JSON-B/Jackson/JSON-P providers implement JSON behavior.

## 3.6 Rule

When JSON behavior surprises you, debug provider and configuration, not only resource code.

---

# 4. JSON-B, JSON-P, Jackson: Tiga Mental Model Berbeda

## 4.1 JSON-B

Object binding standard Jakarta API.

Mental model:

```text
POJO/record ↔ JSON document
```

Like JAXB but for JSON.

## 4.2 JSON-P

JSON processing standard Jakarta API.

Mental model:

```text
parse/generate/query JSON explicitly
```

Object model:

```java
JsonObject
JsonArray
JsonValue
```

Streaming model:

```java
JsonParser
JsonGenerator
```

## 4.3 Jackson

Popular JSON processor library.

Mental model:

```text
data binding + tree model + streaming + extensive configuration
```

Types:

```java
ObjectMapper
JsonNode
JsonParser
JsonGenerator
```

## 4.4 Comparison

```text
JSON-B  = standard object binding
JSON-P  = standard low-level JSON processing
Jackson = feature-rich ecosystem object/tree/streaming
```

## 4.5 Which one should you use?

Depends on:

- runtime;
- portability;
- feature needs;
- existing standards;
- team expertise;
- provider configuration;
- serialization contract complexity.

## 4.6 Rule

Choose JSON provider as architecture decision, not accidental dependency side effect.

---

# 5. Jakarta JSON-B: Object Binding

Jakarta JSON Binding defines a binding framework for converting Java objects to and from JSON documents.

## 5.1 Basic DTO

```java
public record CustomerResponse(
    String id,
    String displayName,
    String status
) {}
```

JSON-B provider can serialize/deserialize supported objects.

## 5.2 JSON-B annotations

Examples:

```java
@JsonbProperty("display_name")
@JsonbTransient
@JsonbDateFormat("yyyy-MM-dd")
@JsonbNumberFormat
@JsonbTypeAdapter
@JsonbTypeSerializer
@JsonbTypeDeserializer
```

## 5.3 Configuration

Using `JsonbConfig`:

```java
JsonbConfig config = new JsonbConfig()
    .withNullValues(false)
    .withPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CASE_WITH_UNDERSCORES);
```

## 5.4 In JAX-RS

A JSON-B provider uses JSON-B under the hood as `MessageBodyReader/Writer`.

## 5.5 Pros

- Jakarta standard;
- portable across Jakarta EE runtimes;
- integrated with Jakarta ecosystem;
- sufficient for many DTO APIs.

## 5.6 Cons

- ecosystem smaller than Jackson;
- provider defaults vary by runtime integration;
- fewer advanced features than Jackson;
- team may be more familiar with Jackson.

## 5.7 JSON-B 3.0 notes

JSON-B 3.0 is the Jakarta EE 10 era release and includes features such as polymorphic type handling support and updates around null handling and adapters/deserializers.

## 5.8 Recommendation

Use JSON-B if you value Jakarta standard portability and your JSON needs are straightforward.

---

# 6. Jakarta JSON-P: Object Model dan Streaming Model

Jakarta JSON Processing defines APIs for parsing, generating, transforming, and querying JSON documents.

## 6.1 Object model

```java
JsonObject object = Json.createObjectBuilder()
    .add("id", "C001")
    .add("name", "Fajar")
    .build();
```

## 6.2 Reading object

```java
try (JsonReader reader = Json.createReader(inputStream)) {
    JsonObject json = reader.readObject();
}
```

## 6.3 Streaming parser

```java
JsonParser parser = Json.createParser(inputStream);
while (parser.hasNext()) {
    JsonParser.Event event = parser.next();
    ...
}
```

## 6.4 Streaming generator

```java
JsonGenerator generator = Json.createGenerator(outputStream);
generator.writeStartObject()
    .write("id", "C001")
    .writeEnd();
```

## 6.5 Use cases

- dynamic JSON;
- JSON Merge Patch/Patch;
- webhook raw/dynamic payload;
- very large JSON streaming;
- partial extraction;
- custom transformation.

## 6.6 Pros

- Jakarta standard;
- explicit control;
- streaming option;
- no accidental POJO serialization.

## 6.7 Cons

- more verbose;
- less domain-friendly for normal DTOs;
- validation/mapping manual.

## 6.8 Recommendation

Use JSON-P when JSON shape is dynamic or streaming/patch processing matters.

---

# 7. Jackson: Data Binding, Tree Model, Streaming, dan Jakarta-RS Provider

Jackson is a widely used JSON processor.

## 7.1 Data binding

```java
CustomerResponse response = objectMapper.readValue(json, CustomerResponse.class);
String json = objectMapper.writeValueAsString(response);
```

## 7.2 Tree model

```java
JsonNode node = objectMapper.readTree(json);
```

## 7.3 Streaming

```java
JsonParser parser = objectMapper.getFactory().createParser(inputStream);
```

## 7.4 Jakarta-RS provider

Jackson has Jakarta-RS providers that implement `MessageBodyReader` and `MessageBodyWriter` for JSON content.

Modern Jakarta namespace artifacts use:

```text
com.fasterxml.jackson.jakarta.rs
```

not old:

```text
com.fasterxml.jackson.jaxrs
```

for Jakarta APIs.

## 7.5 Pros

- huge ecosystem;
- rich configuration;
- strong Spring/Jackson familiarity;
- modules for Java time, records, parameter names;
- powerful annotations;
- tree/streaming/data binding all in one.

## 7.6 Cons

- not Jakarta standard;
- configuration complexity;
- security risks if polymorphic typing misused;
- provider conflicts with JSON-B;
- annotations couple DTO to Jackson.

## 7.7 Recommendation

Use Jackson if team/runtime already standardizes on it or features are needed.

But lock down configuration and test wire format.

---

# 8. Provider Selection di JAX-RS

JAX-RS chooses entity providers based on:

- Java type;
- generic type;
- annotations;
- media type;
- provider `@Consumes/@Produces`;
- provider priority.

## 8.1 Request

```text
Content-Type: application/json
target type: CreateCustomerRequest
```

Runtime finds `MessageBodyReader<CreateCustomerRequest>`.

## 8.2 Response

```text
Accept: application/json
entity type: CustomerResponse
```

Runtime finds `MessageBodyWriter<CustomerResponse>`.

## 8.3 Multiple JSON providers

If both JSON-B and Jackson providers exist, selection can depend on registration/priority/runtime.

## 8.4 Provider conflict symptoms

- output shape changes;
- annotations ignored;
- unknown field policy differs;
- date format changes;
- enum casing changes;
- `Jsonb` config not applied;
- `ObjectMapper` config not applied.

## 8.5 Rule

Know exactly which JSON provider is active in production.

---

# 9. JSON sebagai `MessageBodyReader` dan `MessageBodyWriter`

## 9.1 Reader role

```java
public interface MessageBodyReader<T> {
    boolean isReadable(...);
    T readFrom(...);
}
```

JSON reader parses request body.

## 9.2 Writer role

```java
public interface MessageBodyWriter<T> {
    boolean isWriteable(...);
    void writeTo(...);
}
```

JSON writer serializes response object.

## 9.3 Provider registration

Provider must be registered or auto-discovered with `@Provider`.

## 9.4 JSON-B/Jackson provider

Both provide reader/writer behavior for JSON.

## 9.5 Custom writer danger

Do not write broad custom JSON writer that hijacks all POJOs unless you intend to replace JSON provider.

## 9.6 Rule

JSON behavior in JAX-RS is provider behavior.

---

# 10. Classpath/Runtime Provider Conflict

## 10.1 Scenario

Dependencies include:

- runtime JSON-B provider;
- Jackson Jakarta-RS provider;
- Jersey Jackson feature;
- RESTEasy Jackson extension.

## 10.2 Result

Which provider wins?

Depends on runtime registration and priority.

## 10.3 Symptoms

`@JsonbProperty` ignored.

or:

`@JsonProperty` ignored.

## 10.4 Prevention

- choose one provider;
- register explicitly;
- exclude unwanted provider;
- inspect runtime logs;
- add contract tests.

## 10.5 Application registration

```java
@Override
public Set<Class<?>> getClasses() {
    return Set.of(
        CustomerResource.class,
        JacksonJsonProvider.class,
        ObjectMapperContextResolver.class
    );
}
```

## 10.6 Rule

Do not let transitive dependencies choose your JSON contract.

---

# 11. JSON-B Default di Jakarta EE vs Jackson di Banyak Stack

## 11.1 Jakarta EE

Jakarta EE runtimes commonly include JSON-B/JSON-P integration.

## 11.2 Microservice frameworks

Many Java frameworks default to Jackson.

Examples include many Spring-based systems and some optional JAX-RS setups.

## 11.3 Quarkus

Quarkus can support JSON-B or Jackson extensions depending chosen extension.

## 11.4 Open Liberty

JSON-P/JSON-B features can be enabled explicitly.

## 11.5 Migration risk

Moving between runtimes can change JSON provider.

## 11.6 Rule

In architecture docs, write:

```text
JSON provider: JSON-B 3.0
or
JSON provider: Jackson 2.x with ObjectMapper config X
```

not:

```text
JSON happens automatically
```

---

# 12. Kapan Memilih JSON-B

Choose JSON-B when:

- you want Jakarta standard portability;
- DTOs are simple;
- JSON contract can follow JSON-B features;
- runtime is Jakarta EE server;
- you want less dependency on Jackson-specific annotations;
- organization standardizes on Jakarta APIs.

## 12.1 Good fit

```java
public record CustomerResponse(
    String id,
    String name,
    String status
) {}
```

## 12.2 Use JsonbConfig

Centralize:

- property naming;
- null policy;
- date format;
- adapters.

## 12.3 Avoid provider-specific assumptions

Even with JSON-B, test runtime behavior.

## 12.4 When not enough

If you need advanced Jackson ecosystem features, use Jackson deliberately.

## 12.5 Rule

JSON-B is a good standard baseline for Jakarta-native APIs.

---

# 13. Kapan Memilih JSON-P

Choose JSON-P when:

- payload shape is dynamic;
- you process JSON Patch/Merge Patch;
- you stream huge JSON;
- you need low-level control;
- you don't want POJO binding;
- you need partial extraction.

## 13.1 Dynamic webhook

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response webhook(JsonObject payload) {
    String eventType = payload.getString("type", null);
    ...
}
```

## 13.2 Merge patch

```java
@PATCH
@Consumes("application/merge-patch+json")
public Response patch(JsonObject patch) {
    ...
}
```

## 13.3 Streaming import

Use `JsonParser` for large arrays.

## 13.4 Caution

Manual parsing means manual validation and error mapping.

## 13.5 Rule

JSON-P is explicit JSON processing, not object binding.

---

# 14. Kapan Memilih Jackson

Choose Jackson when:

- team standardizes on Jackson;
- you need Jackson modules;
- advanced polymorphism/custom serializers needed;
- strong tree model needed;
- compatibility with existing DTO annotations;
- Spring/Jackson ecosystem integration.

## 14.1 Jackson module examples

- Java Time module;
- parameter names module;
- JDK8 module;
- Kotlin module if used.

## 14.2 Central ObjectMapper

Always centralize `ObjectMapper`.

## 14.3 Avoid local ObjectMapper

Bad:

```java
new ObjectMapper()
```

inside resource.

## 14.4 Provider config

Use `ContextResolver<ObjectMapper>` or framework-specific configuration.

## 14.5 Security

Disable dangerous default typing unless carefully constrained.

## 14.6 Rule

Jackson is powerful; standardize configuration and test contract.

---

# 15. DTO Boundary: Request DTO, Response DTO, Domain Model, Entity

## 15.1 Four models

```text
Request DTO  = what client may send
Response DTO = what API returns
Domain model = business concepts/rules
Entity       = persistence mapping
```

## 15.2 Bad shortcut

```java
public CustomerEntity create(CustomerEntity entity)
```

## 15.3 Problems

- mass assignment;
- over-exposure;
- lazy loading;
- internal fields;
- versioning;
- security;
- persistence coupling.

## 15.4 Good boundary

```java
CreateCustomerRequest → CreateCustomerCommand → Customer domain/entity → CustomerResponse
```

## 15.5 Mapper

```java
@ApplicationScoped
public class CustomerRestMapper {
    CreateCustomerCommand toCommand(CreateCustomerRequest request) { ... }
    CustomerResponse toResponse(CustomerView view) { ... }
}
```

## 15.6 Rule

DTOs are not redundant; they are boundary contracts.

---

# 16. Request DTO Design

## 16.1 Example

```java
public record CreateCustomerRequest(
    @NotBlank String displayName,
    @Email @NotBlank String email,
    @NotNull CustomerType type
) {}
```

## 16.2 Request DTO should include only allowed input

Do not include:

- server-generated ID;
- status controlled by workflow;
- audit fields;
- roles/permissions;
- tenant from body unless admin;
- version unless used for concurrency.

## 16.3 Validation annotations

Use Jakarta Validation:

```java
@NotBlank
@Size(max = 200)
@Email
@Valid
```

## 16.4 Nested DTOs

```java
public record CreateOrderRequest(
    @NotEmpty List<@Valid OrderItemRequest> items
) {}
```

## 16.5 Command mapping

Convert DTO to command:

```java
CreateOrderCommand command = mapper.toCommand(request, currentUser, tenant);
```

## 16.6 Rule

Request DTO is an allowlist, not a mirror of domain/entity.

---

# 17. Response DTO Design

## 17.1 Example

```java
public record CustomerResponse(
    String id,
    String displayName,
    String status,
    Instant createdAt,
    List<LinkResponse> links
) {}
```

## 17.2 Response DTO should be stable

Avoid leaking:

- DB column names;
- internal enum names;
- internal IDs if not public;
- security flags;
- lazy relations.

## 17.3 Include links if useful

```json
{
  "id": "C001",
  "links": [
    {"rel": "self", "href": "/customers/C001"}
  ]
}
```

## 17.4 Collections

Use envelope:

```json
{
  "items": [],
  "page": {
    "size": 20,
    "nextCursor": "..."
  }
}
```

## 17.5 Error DTO

Use Problem Details or stable error response.

## 17.6 Rule

Response DTO is what you promise clients, not what database happens to look like.

---

# 18. Java Records untuk DTO

## 18.1 Record DTO

```java
public record CustomerResponse(
    String id,
    String displayName,
    String status
) {}
```

## 18.2 Pros

- concise;
- immutable;
- value-based;
- good for response DTOs;
- clear constructor.

## 18.3 Cons

- provider/version support required;
- deserialization constructor behavior differs;
- annotations placement matters;
- defaults harder.

## 18.4 JSON-B/Jackson support

Modern versions usually support records, but test target runtime.

## 18.5 Request records

Records work well if all required fields are explicit.

But handling optional/missing/default values may need care.

## 18.6 Rule

Records are excellent DTOs if your JSON provider supports them and your contract tests pass.

---

# 19. POJO DTO: Getter/Setter dan No-Arg Constructor

## 19.1 Example

```java
public class CreateCustomerRequest {
    private String displayName;
    private String email;

    public CreateCustomerRequest() {}

    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
```

## 19.2 Pros

- widely supported;
- compatible with many providers;
- easier defaults;
- easier framework proxies/reflection.

## 19.3 Cons

- mutable;
- verbose;
- may allow partially initialized object;
- setters can be misused.

## 19.4 For request DTO

POJO is fine if validation catches invalid state.

## 19.5 For response DTO

Records or immutable classes often better.

## 19.6 Rule

Choose DTO style based on provider support and contract clarity, not fashion.

---

# 20. JSON Property Naming Policy

## 20.1 Common choices

```text
camelCase
snake_case
kebab-case
```

## 20.2 Java convention

Java fields usually camelCase.

JSON APIs often use camelCase too:

```json
{
  "displayName": "Fajar"
}
```

## 20.3 Snake case

```json
{
  "display_name": "Fajar"
}
```

Possible with naming strategy.

## 20.4 Do not mix

Bad:

```json
{
  "displayName": "...",
  "created_at": "...",
  "customer-id": "..."
}
```

## 20.5 Provider config

JSON-B and Jackson have naming strategies.

Centralize them.

## 20.6 Explicit annotations

Use when field name differs intentionally.

JSON-B:

```java
@JsonbProperty("display_name")
```

Jackson:

```java
@JsonProperty("display_name")
```

## 20.7 Rule

Property naming policy is API-wide contract.

---

# 21. Null Policy: Include, Exclude, atau Reject

Null handling impacts clients.

## 21.1 Include null

```json
{
  "middleName": null
}
```

Pros:

- explicit absence;
- stable field presence.

Cons:

- verbose;
- clients must handle null.

## 21.2 Exclude null

```json
{}
```

Pros:

- compact;
- avoids noisy nulls.

Cons:

- missing vs null ambiguity.

## 21.3 Reject null in request

Use validation:

```java
@NotNull
```

## 21.4 Response null policy

Decide globally.

Example:

```text
Do not serialize null fields in response except explicit nullable fields.
```

## 21.5 Request null policy

For create/replace:

- required field missing/null → validation error.
- optional field missing → default/empty.
- explicit null → allowed only if field nullable.

## 21.6 Patch null policy

PATCH may use null to remove field.

Different from POST/PUT.

## 21.7 Rule

Null policy must be explicit and tested.

---

# 22. Missing Field vs Null Field vs Empty String

These are different:

## 22.1 Missing

```json
{}
```

## 22.2 Null

```json
{"name": null}
```

## 22.3 Empty string

```json
{"name": ""}
```

## 22.4 Validation examples

```java
@NotNull
String name;
```

Rejects null, not empty.

```java
@NotBlank
String name;
```

Rejects null, empty, whitespace.

## 22.5 Defaulting

Missing may default.

Null may mean explicit clear or invalid.

Empty string may be invalid for names/emails.

## 22.6 Rule

For each request field, define:

```text
required?
nullable?
blank allowed?
default?
patch semantics?
```

## 22.7 Test all three

Contract tests must include missing/null/empty.

---

# 23. Unknown Field Policy: Ignore vs Reject

## 23.1 Unknown field example

```json
{
  "displayName": "Fajar",
  "admin": true
}
```

DTO has no `admin`.

## 23.2 Ignore unknown

Pros:

- forward compatibility;
- tolerant clients.

Cons:

- hides typos;
- can hide attempted over-posting;
- clients think field worked.

## 23.3 Reject unknown

Pros:

- strong contract;
- catches typos;
- safer for command APIs.

Cons:

- less tolerant;
- harder gradual rollout.

## 23.4 Recommendation

For command/write APIs, prefer rejecting unknown fields.

For read response, clients should ignore unknown fields for forward compatibility.

## 23.5 Provider config

Jackson has `FAIL_ON_UNKNOWN_PROPERTIES`.

JSON-B behavior/config depends provider; verify.

## 23.6 Rule

Unknown field policy should be intentional per API style.

---

# 24. Default Values: DTO, Provider, atau Service?

## 24.1 DTO default

POJO field initialization:

```java
private int size = 20;
```

Can be provider-dependent with deserialization.

## 24.2 Constructor default

Records can set default in compact constructor, but missing/null behavior depends deserialization.

## 24.3 Service default

```java
PageRequest page = request.toPageRequestOrDefault();
```

More explicit.

## 24.4 Provider default

Some providers allow annotations/defaulting strategies.

Can hide behavior.

## 24.5 Recommendation

For API semantics, apply defaults in mapper/query object/service boundary explicitly.

## 24.6 Rule

Defaults are contract behavior; don't hide them in accidental deserialization behavior.

---

# 25. Date/Time JSON Contract

## 25.1 Bad date ambiguity

```json
{"date": "12/06/2026"}
```

Ambiguous.

## 25.2 Recommended

Date:

```json
{"date": "2026-06-12"}
```

Instant:

```json
{"createdAt": "2026-06-12T10:15:30Z"}
```

Offset datetime:

```json
{"appointmentAt": "2026-06-12T17:15:30+07:00"}
```

## 25.3 Avoid timestamps as numbers unless required

```json
{"createdAt": 1781268930}
```

Harder for humans and unit ambiguity seconds/millis.

## 25.4 Time zone policy

Define:

- all instants in UTC?
- business date uses tenant timezone?
- local time requires zone?
- offset required?

## 25.5 Provider config

JSON-B/Jackson date/time config must be explicit.

Jackson needs JavaTimeModule for Java time in many setups.

## 25.6 Rule

Date/time format is one of the most important JSON compatibility contracts.

---

# 26. Enum Wire Values

## 26.1 Bad accidental contract

```json
{"status": "IN_PROGRESS"}
```

because Java enum name is `IN_PROGRESS`.

If enum renamed to `PROCESSING`, API breaks.

## 26.2 Stable wire values

```json
{"status": "in_progress"}
```

Map explicitly.

## 26.3 JSON-B approach

Use adapter/serializer if needed.

## 26.4 Jackson approach

Use `@JsonValue` / `@JsonCreator` or custom serializer/deserializer.

Example concept:

```java
public enum CustomerStatus {
    ACTIVE("active"),
    SUSPENDED("suspended");

    private final String wire;
}
```

## 26.5 Unknown enum

Request unknown value should return validation/deserialization error.

Response new enum value can break old clients.

## 26.6 Evolution

When adding enum values:

- document;
- ensure clients ignore unknown where possible;
- consider `unknown` fallback in client SDK.

## 26.7 Rule

Never expose enum names accidentally if API stability matters.

---

# 27. Number, BigDecimal, Money, dan Precision

## 27.1 JSON number

JSON has number type, but clients may parse differently.

JavaScript numbers are double precision.

## 27.2 Money

Do not use floating point.

Bad:

```json
{"amount": 10.1}
```

if clients parse imprecisely.

Better:

```json
{
  "amount": "10.10",
  "currency": "SGD"
}
```

or integer minor unit:

```json
{
  "amountMinor": 1010,
  "currency": "SGD"
}
```

## 27.3 BigDecimal

Java can use `BigDecimal`, but wire/client precision must be considered.

## 27.4 IDs

Do not expose large numeric IDs if JavaScript clients may lose precision.

Use string ID:

```json
{"id": "9007199254740993"}
```

## 27.5 Rule

For money and large IDs, prefer string or integer minor units with explicit semantics.

---

# 28. Boolean dan Tri-State Semantics

## 28.1 Boolean

```json
{"active": true}
```

## 28.2 Missing vs false

If field missing, is it false or default?

Define.

## 28.3 Tri-state

Sometimes need:

```text
true / false / unspecified
```

For filter:

```json
{"verified": null}
```

or absent.

## 28.4 Request DTO

Use `Boolean` wrapper if missing/null matters.

Use `boolean` primitive if default false is intended.

## 28.5 Avoid confusing names

Bad:

```json
{"notDisabled": true}
```

Prefer positive names:

```json
{"enabled": true}
```

## 28.6 Rule

Use wrapper Boolean when presence matters.

---

# 29. Collections: Empty Array vs Null

## 29.1 Empty array

```json
{"items": []}
```

Means known empty collection.

## 29.2 Null collection

```json
{"items": null}
```

Usually avoid.

## 29.3 Missing collection

```json
{}
```

Could mean default/no change.

## 29.4 Response recommendation

Return empty arrays, not null, for collections.

## 29.5 Request recommendation

For create/replace, required collection:

```java
@NotNull
@NotEmpty
List<ItemRequest> items
```

## 29.6 Patch

Missing may mean no change.

Null may mean clear collection if semantics allow.

## 29.7 Rule

Collections in response should normally be `[]`, not `null`.

---

# 30. Map/Object Dynamic Fields

## 30.1 Dynamic object

```json
{
  "attributes": {
    "color": "red",
    "size": "L"
  }
}
```

Java:

```java
Map<String, String> attributes
```

or:

```java
JsonObject attributes
```

## 30.2 Risks

- unbounded keys;
- PII fields;
- schema-less chaos;
- query/index complexity;
- injection into downstream systems.

## 30.3 Validate keys

Allowlist or pattern.

## 30.4 Limit size/depth

Set max entries and value length.

## 30.5 Use cases

- metadata;
- tags;
- custom fields;
- integration payload.

## 30.6 Rule

Dynamic JSON needs stricter governance, not less.

---

# 31. JSON-P `JsonObject` untuk Dynamic Payload

## 31.1 Resource method

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response receive(JsonObject payload) {
    String type = payload.getString("type", null);
    ...
}
```

## 31.2 Pros

- no DTO class needed;
- preserves dynamic shape;
- explicit access;
- good for webhook/patch.

## 31.3 Cons

- validation manual;
- runtime errors if type mismatch;
- less OpenAPI schema clarity;
- business logic can become JSON field walking.

## 31.4 Use wrapper parser

```java
WebhookEvent event = webhookParser.parse(payload);
```

## 31.5 Do not pass JsonObject deep into domain

Convert to application command/event.

## 31.6 Rule

`JsonObject` is good for boundary parsing, not domain model.

---

# 32. JSON-P Streaming untuk Large JSON

## 32.1 Large import

```json
[
  {"id":"1"},
  {"id":"2"},
  ...
]
```

Do not load entire array if huge.

## 32.2 Streaming parser

```java
JsonParser parser = Json.createParser(inputStream);
while (parser.hasNext()) {
    JsonParser.Event event = parser.next();
    ...
}
```

## 32.3 Use cases

- import files;
- event logs;
- NDJSON-like processing;
- large arrays.

## 32.4 Backpressure

Classic blocking parser still reads from stream. Manage timeouts and resource usage.

## 32.5 Validation

Validate item by item.

## 32.6 Error recovery

Define what happens on row N failure:

- fail whole import;
- collect errors;
- partial success;
- async job.

## 32.7 Rule

Large JSON is data ingestion; design as job/stream, not normal DTO.

---

# 33. Polymorphism: Kenapa Berbahaya Jika Sembarangan

Polymorphic deserialization means JSON decides concrete Java subtype.

## 33.1 Example concept

```json
{
  "type": "card",
  "number": "..."
}
```

maps to `CardPayment`.

## 33.2 Good polymorphism

Explicit allowlisted type field maps to known DTO subtypes.

## 33.3 Bad polymorphism

JSON contains Java class name:

```json
{
  "@class": "com.example.SomeClass"
}
```

Dangerous.

## 33.4 Security risk

Unsafe polymorphic typing has historically caused deserialization vulnerabilities in many ecosystems.

## 33.5 Rule

Never allow arbitrary class names from JSON to determine object type.

## 33.6 Safer pattern

Use explicit discriminator and allowlist:

```text
"type": "card" | "bank_transfer"
```

## 33.7 Validate

Unknown type → 400.

---

# 34. JSON-B Polymorphic Support dan Jackson Polymorphic Typing

## 34.1 JSON-B 3.0

JSON-B 3.0 includes support for handling polymorphic types.

## 34.2 Jackson

Jackson supports polymorphic typing through annotations/configuration.

## 34.3 Safe usage

Use explicit discriminator and restricted subtypes.

## 34.4 Avoid default typing

Do not enable broad default typing for untrusted input.

## 34.5 DTO-only polymorphism

Keep polymorphic deserialization to request DTO layer, not arbitrary domain/entity classes.

## 34.6 Contract

Document discriminator field and allowed values.

## 34.7 Rule

Polymorphism must be allowlisted and contract-driven.

---

# 35. Custom Serialization/Deserialization

## 35.1 JSON-B

Use:

```java
@JsonbTypeSerializer
@JsonbTypeDeserializer
@JsonbTypeAdapter
```

## 35.2 Jackson

Use:

```java
JsonSerializer
JsonDeserializer
@JsonSerialize
@JsonDeserialize
```

## 35.3 Use cases

- enum wire values;
- money amount;
- value object IDs;
- date/time custom format;
- redaction;
- polymorphic DTOs.

## 35.4 Caution

Custom serializers become API contract.

## 35.5 Avoid business logic

Serializer formats value; it should not call service/database.

## 35.6 Test

Golden JSON tests for custom serialization.

## 35.7 Rule

Custom serialization should be deterministic, pure, documented, and tested.

---

# 36. `ContextResolver<Jsonb>` dan `ContextResolver<ObjectMapper>`

JAX-RS `ContextResolver<T>` lets providers obtain configured context objects.

## 36.1 JSON-B resolver concept

```java
@Provider
@Produces(MediaType.APPLICATION_JSON)
public class JsonbContextResolver implements ContextResolver<Jsonb> {

    private final Jsonb jsonb = JsonbBuilder.create(
        new JsonbConfig()
            .withNullValues(false)
    );

    @Override
    public Jsonb getContext(Class<?> type) {
        return jsonb;
    }
}
```

## 36.2 Jackson resolver concept

```java
@Provider
@Produces(MediaType.APPLICATION_JSON)
public class ObjectMapperContextResolver implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper = new ObjectMapper()
        .registerModule(new JavaTimeModule());

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

## 36.3 Provider-specific

Whether resolver is honored depends on JSON provider integration.

## 36.4 Centralize config

Do not configure mappers in individual resources.

## 36.5 Test

Verify resolver actually affects output.

## 36.6 Rule

One JSON config source for the application.

---

# 37. JSON Provider Configuration sebagai API Contract

Configuration affects wire shape:

- property naming;
- null inclusion;
- date/time format;
- enum representation;
- unknown field behavior;
- pretty printing;
- property ordering;
- number handling;
- polymorphism;
- custom serializers.

## 37.1 Changing config can be breaking

Example:

```json
"createdAt": "2026-06-12T10:15:30Z"
```

becomes:

```json
"createdAt": 1781268930000
```

Breaking.

## 37.2 Configuration governance

Document:

```text
JSON provider = Jackson 2.22
Naming = camelCase
Null response fields = omitted
Dates = ISO-8601 UTC instants
Unknown request fields = rejected
Enums = lower_snake_case wire values
```

## 37.3 Tests

Golden contract tests detect accidental changes.

## 37.4 Rule

JSON config is not internal implementation detail.

---

# 38. Validation: JSON Deserialization vs Jakarta Validation

## 38.1 Deserialization errors

Malformed JSON or wrong type.

Example:

```json
{"items": "not-array"}
```

Reader fails before validation.

## 38.2 Validation errors

JSON parses but violates constraints.

Example:

```json
{"items": []}
```

with:

```java
@NotEmpty
```

## 38.3 Business errors

JSON valid and DTO valid, but domain rejects.

Example:

```text
order cannot be cancelled because already shipped
```

## 38.4 Error mapping

- malformed JSON → 400 `MALFORMED_JSON`;
- type mismatch → 400 `JSON_DESERIALIZATION_FAILED`;
- validation → 400/422 `VALIDATION_FAILED`;
- business conflict → 409.

## 38.5 Test separately

Do not lump all invalid input into same test.

## 38.6 Rule

Know which layer rejected the request.

---

# 39. Error Taxonomy untuk JSON

Recommended error codes:

## 39.1 Malformed

```text
MALFORMED_JSON
```

Invalid JSON syntax.

## 39.2 Unsupported media

```text
UNSUPPORTED_MEDIA_TYPE
```

Wrong Content-Type.

## 39.3 Deserialization failed

```text
JSON_DESERIALIZATION_FAILED
```

Valid JSON but wrong shape/type.

## 39.4 Unknown field

```text
UNKNOWN_JSON_FIELD
```

If policy rejects unknowns.

## 39.5 Missing required field

```text
MISSING_REQUIRED_FIELD
```

## 39.6 Null not allowed

```text
NULL_NOT_ALLOWED
```

## 39.7 Invalid enum

```text
INVALID_ENUM_VALUE
```

## 39.8 Validation

```text
VALIDATION_FAILED
```

## 39.9 Rule

Stable error codes are more important than provider exception messages.

---

# 40. Problem Details untuk JSON Error

Use `application/problem+json`.

## 40.1 Example

```json
{
  "type": "https://api.example.com/problems/malformed-json",
  "title": "Malformed JSON",
  "status": 400,
  "code": "MALFORMED_JSON",
  "detail": "The request body is not valid JSON.",
  "correlationId": "abc-123"
}
```

## 40.2 Field-level validation

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "violations": [
    {
      "field": "email",
      "code": "EMAIL_INVALID",
      "message": "must be a well-formed email address"
    }
  ]
}
```

## 40.3 Do not expose stack trace

Never expose parser internals.

## 40.4 Include path carefully

Field path is useful:

```text
items[0].quantity
```

## 40.5 Localization

Human messages can localize. Codes stable.

## 40.6 Rule

JSON errors should be machine-readable and stable.

---

# 41. PATCH: JSON Merge Patch dan JSON Patch

## 41.1 JSON Merge Patch

Media:

```text
application/merge-patch+json
```

Semantics:

- object fields present replace existing;
- null removes field;
- missing means unchanged.

## 41.2 JSON Patch

Media:

```text
application/json-patch+json
```

Operations:

```json
[
  {"op": "replace", "path": "/email", "value": "new@example.com"}
]
```

## 41.3 DTO issue

Simple DTO loses missing vs null distinction.

## 41.4 JSON-P useful

Use `JsonObject` for merge patch.

```java
@PATCH
@Consumes("application/merge-patch+json")
public Response patch(JsonObject patch) { ... }
```

## 41.5 Validation

Validate patch document and resulting entity.

## 41.6 Security

Limit paths allowed to patch.

Do not allow patching server-controlled fields.

## 41.7 Rule

PATCH requires presence-aware JSON handling.

---

# 42. JSON Schema dan Contract Testing

## 42.1 JSON Schema

Can describe JSON structure:

- properties;
- required fields;
- types;
- formats;
- enum values;
- additionalProperties.

## 42.2 Use cases

- contract tests;
- external partner specs;
- validation;
- documentation;
- generated clients.

## 42.3 Not replacement for domain validation

Schema validates shape, not all business rules.

## 42.4 Golden tests

Serialize DTO and compare JSON.

## 42.5 Consumer contract tests

Verify clients can parse responses.

## 42.6 Rule

For stable APIs, JSON shape deserves contract tests.

---

# 43. OpenAPI dan JSON Contract

## 43.1 Request schema

```yaml
requestBody:
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CreateCustomerRequest'
```

## 43.2 Response schema

```yaml
responses:
  '200':
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CustomerResponse'
```

## 43.3 Error schema

```yaml
application/problem+json
```

## 43.4 Keep annotations honest

Generated OpenAPI may not reflect custom serializer behavior automatically.

## 43.5 Examples

Include examples for:

- normal response;
- validation error;
- null/empty collection;
- pagination.

## 43.6 Rule

OpenAPI must match actual provider output.

---

# 44. Security: Deserialization, Unknown Fields, Depth, Size, Polymorphism

## 44.1 Size limit

JSON body must have max size.

## 44.2 Depth limit

Deep nested JSON can attack parser/stack/memory.

## 44.3 Unknown fields

Reject or ignore intentionally.

## 44.4 Polymorphism

Never allow arbitrary class names.

## 44.5 Entity binding

Do not bind to JPA entity.

## 44.6 Sensitive fields

Do not include secrets in response.

Use write-only/read-only semantics in DTO/docs.

## 44.7 Parser features

Disable unsafe features.

## 44.8 Rule

JSON deserialization is part of attack surface.

---

# 45. Performance: Object Binding vs Tree vs Streaming

## 45.1 Object binding

Good for normal DTO APIs.

Cost:

- allocate full object graph;
- parse full body;
- validation after parse.

## 45.2 Tree model

Good for dynamic JSON.

Cost:

- allocate JSON tree;
- memory proportional to body.

## 45.3 Streaming

Good for huge JSON.

Cost:

- more complex code;
- manual state machine/validation.

## 45.4 Response serialization

Large response should consider:

- pagination;
- streaming;
- chunked response;
- file/export job.

## 45.5 Pretty printing

Disable in production unless needed.

Adds bytes.

## 45.6 Rule

Most APIs use object binding. Large/dynamic APIs need tree/streaming intentionally.

---

# 46. Observability: Jangan Log JSON Body Mentah

## 46.1 Why?

JSON body can include:

- PII;
- tokens;
- document numbers;
- addresses;
- financial data;
- health/legal data.

## 46.2 Log metadata

- route template;
- content type;
- content length;
- request ID;
- error code;
- JSON parse failure category.

## 46.3 Safe body hash

For idempotency/debugging, hash body or canonical command if policy allows.

## 46.4 Redaction is hard

Generic JSON redaction often fails on nested/dynamic fields.

## 46.5 Metrics

Track:

```text
json_parse_errors_total
json_validation_errors_total
json_body_size_bucket
```

## 46.6 Rule

JSON body is data, not log text.

---

# 47. Testing JSON Behavior

## 47.1 Serialization golden test

Expected JSON exactly:

```json
{
  "id": "C001",
  "displayName": "Fajar",
  "status": "active"
}
```

## 47.2 Deserialization test

Request JSON to DTO.

## 47.3 HTTP runtime test

Use actual JAX-RS runtime/provider.

## 47.4 Null/missing/empty tests

- missing field;
- null field;
- empty string;
- empty array.

## 47.5 Unknown field test

If reject policy, assert error.

## 47.6 Date/time tests

Timezone/format.

## 47.7 Enum tests

Wire value and invalid value.

## 47.8 Provider config test

Test that custom naming/null/date config applies.

## 47.9 Error test

Malformed JSON returns Problem Details.

## 47.10 Upgrade safety

Run contract tests on dependency/runtime upgrades.

---

# 48. Runtime Differences: Jersey, RESTEasy, CXF, Open Liberty, Payara, Quarkus

## 48.1 Jersey

Can use JSON-B, Jackson, JSON-P/MOXy depending modules/features.

## 48.2 RESTEasy

Supports JSON-B and Jackson providers depending dependencies/config.

## 48.3 CXF

Has provider configuration and JSON support options.

## 48.4 Open Liberty

Jakarta JSON-P/JSON-B features can be enabled; Jakarta EE runtime support matters.

## 48.5 Payara/GlassFish

Jakarta EE runtimes typically provide JSON-B/JSON-P integration.

## 48.6 Quarkus

RESTEasy Reactive/Jackson/JSON-B extensions determine behavior.

## 48.7 Rule

Your JSON contract is only guaranteed on the runtime/provider combination you test.

---

# 49. Migration: `javax` → `jakarta`, JSON-B/Jackson Artifacts

## 49.1 Jakarta namespace

Modern Jakarta APIs use:

```java
jakarta.json.*
jakarta.json.bind.*
jakarta.ws.rs.*
```

not:

```java
javax.json.*
javax.json.bind.*
javax.ws.rs.*
```

## 49.2 Jackson provider artifacts

Old JAX-RS provider:

```text
com.fasterxml.jackson.jaxrs
```

Modern Jakarta-RS provider:

```text
com.fasterxml.jackson.jakarta.rs
```

## 49.3 Mixed namespace issue

A provider built for `javax.ws.rs` will not work as Jakarta provider in `jakarta.ws.rs` runtime.

## 49.4 Migration checklist

- update imports;
- update dependencies;
- update provider artifacts;
- update server/runtime;
- run JSON contract tests.

## 49.5 Rule

Namespace migration includes providers, not only resource annotations.

---

# 50. Common Failure Modes

## 50.1 Wrong JSON provider active

Annotations ignored.

## 50.2 Unknown fields ignored unexpectedly

Client typo hidden.

## 50.3 Unknown fields rejected unexpectedly

Client breaks after provider config change.

## 50.4 Date format changes after upgrade

Breaking client parsing.

## 50.5 Enum wire value tied to Java enum name

Refactor breaks API.

## 50.6 Null response fields change

Client sees missing instead of null or vice versa.

## 50.7 JPA entity serialized

Mass data leak/lazy loading failure.

## 50.8 Polymorphic typing unsafe

Security vulnerability.

## 50.9 `application/*+json` not handled

Problem/patch/vendor media fails.

## 50.10 JSON-P `JsonObject` leaks into domain

Domain becomes JSON-aware.

## 50.11 Body logged

PII/security incident.

## 50.12 Jackson old `javax` provider in Jakarta runtime

Provider not discovered/works incorrectly.

---

# 51. Best Practices

## 51.1 Choose one JSON provider intentionally

JSON-B or Jackson.

## 51.2 Centralize configuration

One `JsonbConfig`/`ObjectMapper`.

## 51.3 Use DTOs

No entity/domain direct exposure.

## 51.4 Document null/unknown/date/enum policy

And test it.

## 51.5 Prefer ISO-8601 for date/time

With explicit timezone semantics.

## 51.6 Use stable enum wire values

Not Java enum names accidentally.

## 51.7 Reject unknown fields for command APIs

Unless compatibility policy says otherwise.

## 51.8 Use JSON-P for dynamic/patch/streaming

Not for normal DTO if object binding suffices.

## 51.9 Do not log JSON body

Log metadata/errors.

## 51.10 Contract test JSON output

Provider upgrades should not silently change API.

---

# 52. Anti-Patterns

## 52.1 Returning JPA entity directly

Leaky and unsafe.

## 52.2 Creating `new ObjectMapper()` in resource

Config drift.

## 52.3 Provider chosen by accident

No explicit dependency/config.

## 52.4 Relying on provider defaults for public contract

Fragile.

## 52.5 Enabling broad polymorphic default typing

Dangerous.

## 52.6 Using JSON as domain model everywhere

`JsonObject` deep in services/domain.

## 52.7 Ignoring unknown/null/missing semantics

Client ambiguity.

## 52.8 Logging request/response JSON body

PII leak.

## 52.9 No malformed JSON tests

Runtime default errors leak.

## 52.10 Mixing `javax` and `jakarta` providers

Migration failure.

---

# 53. Production Checklist

## 53.1 Provider

- [ ] JSON provider chosen intentionally.
- [ ] Provider dependency/artifact matches Jakarta namespace.
- [ ] Configuration centralized.
- [ ] Provider conflict checked.
- [ ] Runtime logs/registration verified.

## 53.2 Contract

- [ ] DTOs separate from entity/domain.
- [ ] Naming policy documented.
- [ ] Null policy documented.
- [ ] Unknown field policy documented.
- [ ] Date/time format documented.
- [ ] Enum wire values documented.
- [ ] Number/money precision policy documented.

## 53.3 Security

- [ ] No entity direct binding.
- [ ] Body size limit.
- [ ] Depth limit where possible.
- [ ] Polymorphism allowlisted only.
- [ ] No arbitrary class names.
- [ ] Sensitive fields redacted/not exposed.
- [ ] Body not logged.

## 53.4 Errors

- [ ] Malformed JSON maps to stable problem.
- [ ] Unknown field error mapped if policy rejects.
- [ ] Validation errors mapped.
- [ ] Error media type `application/problem+json`.
- [ ] Parser internals not exposed.

## 53.5 Testing

- [ ] Serialization golden tests.
- [ ] Deserialization tests.
- [ ] HTTP runtime tests.
- [ ] Unknown/missing/null/empty tests.
- [ ] Date/time/enum tests.
- [ ] Provider upgrade contract tests.

## 53.6 Migration

- [ ] No `javax.json` in Jakarta app unless isolated legacy.
- [ ] No `javax.ws.rs` Jackson provider.
- [ ] Provider artifacts updated.
- [ ] JSON contract tested after migration.

---

# 54. Latihan

## Latihan 1 — Provider Audit

Di project, cari provider JSON aktif.

Jawab:

```text
JSON-B atau Jackson?
Artifact apa?
Config di mana?
Runtime apa?
Unknown field policy apa?
Null policy apa?
Date format apa?
```

## Latihan 2 — DTO Boundary

Ambil endpoint yang return entity/domain.

Refactor ke response DTO.

Tambahkan golden JSON test.

## Latihan 3 — Unknown Field Policy

Buat request:

```json
{
  "displayName": "Fajar",
  "unexpected": true
}
```

Tentukan apakah reject atau ignore.

Implement dan test.

## Latihan 4 — Null/Missing/Empty

Untuk field `email`, test:

```json
{}
{"email": null}
{"email": ""}
{"email": "bad"}
{"email": "fajar@example.com"}
```

## Latihan 5 — Date/Time

Buat field:

```java
Instant createdAt
LocalDate birthDate
OffsetDateTime appointmentAt
```

Tentukan JSON format dan test.

## Latihan 6 — Enum Wire Value

Buat enum `ApplicationStatus`.

Wire values:

```text
draft
submitted
approved
rejected
```

Jangan expose Java enum names.

## Latihan 7 — JSON-P Patch

Implement:

```http
PATCH /customers/{id}
Content-Type: application/merge-patch+json
```

Gunakan `JsonObject`.

Pastikan missing/null/value berbeda.

## Latihan 8 — Jackson vs JSON-B Comparison

Serialize DTO yang sama dengan JSON-B dan Jackson.

Bandingkan:

- null;
- date;
- enum;
- record;
- unknown fields.

## Latihan 9 — Problem Details

Map malformed JSON to:

```text
application/problem+json
```

with stable code.

---

# 55. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `MessageBodyReader` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodyreader

3. Jakarta RESTful Web Services 4.0 — `MessageBodyWriter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodywriter

4. Jakarta JSON Binding 3.0  
   https://jakarta.ee/specifications/jsonb/3.0/

5. Jakarta JSON Processing 2.1  
   https://jakarta.ee/specifications/jsonp/2.1/

6. Jakarta JSON Processing Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonp/jsonp.html

7. Jackson Jakarta-RS JSON Provider API Docs  
   https://javadoc.io/doc/com.fasterxml.jackson.jakarta.rs/jackson-jakarta-rs-json-provider/latest/index.html

8. FasterXML Jackson Jakarta-RS Providers  
   https://github.com/FasterXML/jackson-jaxrs-providers

9. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

10. RFC 7386 — JSON Merge Patch  
    https://www.rfc-editor.org/rfc/rfc7386

11. RFC 6902 — JSON Patch  
    https://www.rfc-editor.org/rfc/rfc6902

---

# 56. Penutup

JSON di JAX-RS bukan magic.

Ia adalah hasil kerja sama antara:

```text
@Consumes / @Produces
  ↓
MessageBodyReader / MessageBodyWriter
  ↓
JSON provider
  ↓
DTO design
  ↓
provider configuration
  ↓
error mapping
  ↓
contract tests
```

Mental model final:

```text
JSON-B  = standard Jakarta object binding
JSON-P  = standard Jakarta JSON object/stream processing
Jackson = rich JSON ecosystem with powerful data/tree/streaming model
```

Prinsip final:

```text
Choose provider deliberately.
Design DTOs deliberately.
Configure JSON deliberately.
Test wire format deliberately.
```

Top-tier JAX-RS engineer tidak berkata:

```text
Provider akan otomatis serialize object saya.
```

Ia berkata:

```text
Inilah JSON contract kami:
- naming policy
- null policy
- unknown field policy
- date/time format
- enum wire values
- error media type
- provider config
- contract tests
```

Part berikutnya:

```text
Bagian 013 — Error Handling Architecture: Exceptions, Mappers, Problem Details, Error Taxonomy
```

Kita akan membahas arsitektur error handling lengkap: checked vs unchecked exception, `WebApplicationException`, `ExceptionMapper`, mapper specificity, RFC 9457 Problem Details, validation errors, conversion errors, domain errors, observability, and enterprise error taxonomy.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-011.md">⬅️ Bagian 011 — Content Negotiation Deep Dive: `@Consumes`, `@Produces`, `MediaType`, `Variant`, `Accept`, `Content-Type`, `q/qs`, `Vary`, dan Debugging `406/415`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-013.md">Bagian 013 — Error Handling Architecture: Exceptions, `ExceptionMapper`, `WebApplicationException`, RFC 9457 Problem Details, Error Taxonomy, dan Production Error Contract ➡️</a>
</div>
