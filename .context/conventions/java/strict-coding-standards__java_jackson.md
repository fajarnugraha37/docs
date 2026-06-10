# Strict Coding Standards — Java Jackson

> **Purpose**: This document defines strict, enforceable coding standards for using Jackson in Java services. It is written for human engineers and LLM code agents. It must be applied together with the project Java baseline standard (`java11`, `java17`, `java21`, or `java25`), `java_json.md`, `java_security.md`, `java_http.md`, and any framework-specific standard such as Quarkus, Jersey, Spring, Retrofit, or OpenFeign.

---

## 1. Scope

This standard covers:

- Jackson Databind / Streaming / Annotations.
- `ObjectMapper`, `ObjectReader`, `ObjectWriter`, `JsonFactory`, `JsonParser`, `JsonGenerator`.
- JSON DTO serialization and deserialization.
- Java Time, Optional, records, sealed types, enum, BigDecimal, binary data, polymorphic type handling.
- API boundary mapping for HTTP, messaging, persistence, cache, and file I/O.
- Security rules for untrusted JSON.
- Performance, streaming, memory, testing, and migration.

This standard does **not** replace:

- `java_json.md` for general JSON contract rules.
- `java_security.md` for trust-boundary and deserialization policy.
- `java_time_date.md`, `java_number.md`, `java_string.md` for primitive/value semantics.

---

## 2. Version and Dependency Policy

### 2.1 Default line

For new Java code:

- Prefer Jackson **2.x stable line** if the wider ecosystem/framework is still based on `com.fasterxml.jackson.*`.
- Use Jackson **3.x** only when the application stack, framework, modules, and transitive dependencies are explicitly aligned to Jackson 3.
- Do **not** mix Jackson 2 and Jackson 3 artifacts in the same runtime classpath.

### 2.2 Package split

| Jackson line | Typical package | Rule |
|---|---:|---|
| Jackson 2.x | `com.fasterxml.jackson.*` | Allowed default for existing Java ecosystem |
| Jackson 3.x | `tools.jackson.*` and changed module coordinates in parts of the ecosystem | Restricted; requires migration plan |

### 2.3 Dependency governance

MUST:

- Use a Jackson BOM or platform-managed dependency versions.
- Keep all Jackson modules on compatible versions.
- Pin versions through build governance, not random transitive dependency drift.
- Explicitly include only modules that are needed.

SHOULD include when relevant:

- `jackson-databind`
- `jackson-core`
- `jackson-annotations`
- `jackson-datatype-jsr310` for Java Time in Jackson 2.x
- `jackson-datatype-jdk8` for Java 8 types such as `Optional`
- Framework-specific Jackson integration module only when required.

FORBIDDEN:

- Adding a second JSON library just to work around Jackson configuration mistakes.
- Pulling an old Jackson version through unrelated libraries without dependency convergence checks.
- Mixing old `javax` integration modules with new `jakarta` runtime modules unless the framework explicitly requires it.

---

## 3. Core Design Principle

Jackson is a **boundary serializer**, not a domain model engine.

MUST:

- Serialize/deserialize DTOs, commands, events, and API models.
- Keep domain invariants inside domain constructors/factories/services.
- Treat inbound JSON as untrusted input.
- Validate deserialized DTOs before domain conversion.
- Keep mapper configuration centralized and testable.

MUST NOT:

- Deserialize untrusted JSON directly into domain aggregate/entity types.
- Use Jackson annotations to hide broken domain design.
- Put business rules in custom serializers/deserializers.
- Let JSON shape be implicitly determined by entity fields.

---

## 4. ObjectMapper Lifecycle

### 4.1 Singleton-style mapper

MUST:

- Reuse configured `ObjectMapper` instances.
- Complete all mapper configuration before first read/write.
- Treat the shared mapper as immutable after first use.
- Use `ObjectReader` / `ObjectWriter` for per-use specialized views.

```java
public final class JsonCodec {
    private final ObjectMapper mapper;
    private final ObjectReader orderReader;
    private final ObjectWriter orderWriter;

    public JsonCodec(ObjectMapper mapper) {
        this.mapper = Objects.requireNonNull(mapper, "mapper");
        this.orderReader = mapper.readerFor(OrderRequest.class);
        this.orderWriter = mapper.writerFor(OrderResponse.class);
    }
}
```

FORBIDDEN:

```java
// Forbidden: expensive and inconsistent per-call mapper construction.
new ObjectMapper().readValue(json, OrderRequest.class);
```

```java
// Forbidden: mutating shared mapper at runtime.
sharedMapper.enable(SerializationFeature.INDENT_OUTPUT);
```

### 4.2 Mapper ownership

Each service/application MUST have a single mapper ownership point, for example:

- `JsonConfiguration`
- `ObjectMapperFactory`
- framework-managed bean
- infrastructure module

LLM agents MUST NOT create ad-hoc mappers inside controllers, clients, repositories, serializers, tests, or utility methods unless the method is explicitly testing mapper construction.

---

## 5. Required Baseline Configuration

The exact config may vary by project, but every project MUST document its policy for:

- Unknown fields.
- Null handling.
- Enum handling.
- Date/time format.
- Numeric precision.
- Property naming strategy.
- Inclusion policy.
- Polymorphism.
- Duplicate fields.
- Serialization of empty/absent values.

Example baseline:

```java
ObjectMapper mapper = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .addModule(new Jdk8Module())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .build();
```

The above is a sample. The project may differ, but differences MUST be intentional.

---

## 6. Unknown Field Policy

Default rule:

- In external/public API request DTOs, unknown fields SHOULD fail unless backward compatibility requires ignoring them.
- In event consumers that need forward compatibility, unknown fields MAY be ignored only when the schema/versioning policy allows it.
- In internal persistence JSON, unknown fields MUST be explicitly handled during migration.

Allowed:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record PartnerCallback(
        String eventId,
        String status
) {}
```

Only allowed if documented:

```java
// Reason: partner may add fields without notice; contract tests cover required fields.
@JsonIgnoreProperties(ignoreUnknown = true)
```

FORBIDDEN:

- Globally ignoring unknown fields without boundary-specific reasoning.
- Using unknown-field ignoring to hide client/server contract drift.

---

## 7. Null, Missing, Empty, and Default Values

MUST distinguish:

| JSON state | Meaning |
|---|---|
| Missing field | Not provided |
| `null` | Explicit null |
| `""` | Empty string |
| `[]` | Empty list |
| `{}` | Empty object |
| defaulted value | Server/client applied default |

Rules:

- Do not conflate missing and null unless contract explicitly says so.
- Do not default silently in deserializer unless default is part of API contract.
- Do not use primitive fields for nullable inbound data.
- Prefer wrapper types in DTOs when null/missing matters.
- Validate required fields after deserialization.

Restricted:

```java
@JsonSetter(nulls = Nulls.SKIP)
```

Allowed only with documented patch/merge semantics.

FORBIDDEN:

```java
public record CreateUserRequest(String name, int age) {}
```

if `age` is optional or nullable. Primitive `int` silently becomes `0` in many paths, which may be semantically wrong.

---

## 8. DTO and Domain Boundary

MUST:

- Use DTOs for JSON input/output.
- Convert DTOs to domain commands/value objects explicitly.
- Keep persistence entities out of JSON API.
- Keep lazy-loaded ORM entities out of Jackson serialization.

FORBIDDEN:

```java
// Forbidden: API directly exposes JPA entity.
@GET
public CustomerEntity getCustomer() { ... }
```

Allowed:

```java
public record CustomerResponse(
        UUID id,
        String displayName,
        String status
) {}
```

---

## 9. Annotation Policy

Jackson annotations are allowed on DTOs and boundary models.

Allowed common annotations:

- `@JsonProperty`
- `@JsonCreator`
- `@JsonIgnoreProperties`
- `@JsonInclude`
- `@JsonFormat`
- `@JsonValue`
- `@JsonAlias`
- `@JsonDeserialize` / `@JsonSerialize` only when justified

Restricted:

- `@JsonIgnore` on domain fields.
- `@JsonView` for API authorization.
- `@JsonTypeInfo` for polymorphism.
- Custom serializers/deserializers.
- `@JsonAnyGetter` / `@JsonAnySetter`.

FORBIDDEN:

- Using annotations to expose secrets accidentally.
- Using `@JsonIgnore` as a security mechanism.
- Adding annotation to persistence entity just to fix API shape.

---

## 10. Constructors, Records, and Immutability

Preferred DTO styles:

### Java records

```java
public record CreateOrderRequest(
        UUID customerId,
        List<OrderLineRequest> lines
) {
    public CreateOrderRequest {
        lines = List.copyOf(lines);
    }
}
```

Rules:

- Records are preferred for simple immutable JSON DTOs on Java 16+.
- Defensive copy mutable collections in compact constructor if the DTO is retained.
- Avoid business validation inside DTO constructor except structural invariants needed for safe object creation.

### Constructor-based class DTO

```java
public final class MoneyDto {
    private final BigDecimal amount;
    private final String currency;

    @JsonCreator
    public MoneyDto(
            @JsonProperty(value = "amount", required = true) BigDecimal amount,
            @JsonProperty(value = "currency", required = true) String currency) {
        this.amount = amount;
        this.currency = currency;
    }
}
```

FORBIDDEN:

- Public mutable DTOs for untrusted input unless framework requires and tests cover it.
- Lombok-generated DTOs without visibility/null policy review.
- No-arg mutable DTO as default for new code when records/constructors are available.

---

## 11. Enum Policy

MUST:

- Decide whether JSON enum values are stable API names or display names.
- Use explicit wire values when enum names may change.
- Handle unknown enum values intentionally.

Allowed:

```java
public enum CaseStatus {
    @JsonProperty("open") OPEN,
    @JsonProperty("closed") CLOSED
}
```

Restricted:

```java
@JsonEnumDefaultValue
UNKNOWN
```

Only allowed when the business can safely handle unknown values.

FORBIDDEN:

- Renaming enum constants that are serialized by name without migration.
- `toString()`-based enum serialization unless explicitly part of contract.

---

## 12. Date and Time Policy

MUST:

- Use `java.time` types.
- Register Java Time module when using Jackson 2.x.
- Serialize durable timestamps as ISO-8601 strings unless contract says otherwise.
- Use `Instant` for event/audit timestamps.
- Use `LocalDate` for date-only business values.
- Avoid timestamps-as-array or numeric timestamp by accident.

Preferred:

```json
{
  "submittedAt": "2026-06-10T08:15:30Z",
  "effectiveDate": "2026-06-10"
}
```

FORBIDDEN:

- Serializing `LocalDateTime` across systems without timezone/offset semantics.
- Using `java.util.Date`/`Calendar` in new DTOs.
- Relying on system default timezone in serializers.

---

## 13. Number and BigDecimal Policy

MUST:

- Use `BigDecimal` for money/exact decimal values.
- Avoid `double`/`float` for financial JSON.
- Preserve precision for IDs that may exceed JavaScript safe integer range.
- Decide whether large numeric IDs are strings in public APIs.

Restricted config:

```java
mapper.enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
```

Allowed for generic maps, but concrete DTO fields are preferred.

FORBIDDEN:

- Parsing money as `double`.
- Serializing `BigDecimal` with inconsistent scale when contract requires fixed decimal places.
- Accepting arbitrary precision/scale without validation.

---

## 14. String and Charset Policy

MUST:

- Treat JSON text as Unicode.
- Explicitly specify `StandardCharsets.UTF_8` when reading/writing bytes.
- Validate length by code point or domain rule when user-visible text matters.
- Normalize input only when contract requires canonical comparison/search.

FORBIDDEN:

```java
json.getBytes(); // platform default charset
```

Allowed:

```java
json.getBytes(StandardCharsets.UTF_8);
```

---

## 15. Binary Data

MUST:

- Avoid embedding large binary blobs in JSON.
- Use base64 only for small payloads where contract requires it.
- Prefer object storage/reference URLs for large content.
- Enforce size limits before decoding.

FORBIDDEN:

- Deserializing unbounded base64 into `byte[]` from untrusted JSON.
- Logging base64 payloads.

---

## 16. Polymorphic Deserialization

Default rule: **forbidden unless explicitly approved**.

Polymorphic deserialization is high risk because JSON controls the type to instantiate.

FORBIDDEN:

- Global/default typing for untrusted JSON.
- Deserializing to `Object`, raw `Map`, raw `List`, or abstract supertype without explicit type controls.
- Accepting class names as type ids from clients.

Restricted allowed pattern:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = EmailCommand.class, name = "email"),
        @JsonSubTypes.Type(value = SmsCommand.class, name = "sms")
})
public sealed interface NotificationCommand
        permits EmailCommand, SmsCommand {
}
```

Requirements:

- Use logical type names, not Java class names.
- Allow-list concrete subtypes.
- Keep subtype set closed and tested.
- Validate type-specific fields.
- Never use this for arbitrary plugin loading.

---

## 17. Raw Maps and JsonNode

Allowed when:

- Handling arbitrary metadata.
- Building protocol adapters.
- Implementing schema migration tooling.
- Passing through unknown JSON safely without interpretation.

MUST:

- Limit size/depth.
- Validate before using values.
- Avoid casting chains in business code.
- Convert to typed DTO as soon as possible.

FORBIDDEN:

```java
Map<String, Object> payload = mapper.readValue(json, Map.class);
String status = (String) payload.get("status");
```

Allowed:

```java
JsonNode root = mapper.readTree(json);
JsonNode statusNode = root.path("status");
if (!statusNode.isTextual()) {
    throw new InvalidPayloadException("status must be a string");
}
```

---

## 18. Streaming API

Use streaming for:

- Large JSON arrays.
- Large files.
- Network streams.
- Transforming JSON without full object materialization.

MUST:

- Use `try-with-resources`.
- Bound depth and item count.
- Avoid loading full document when streaming is required.
- Handle partial/truncated JSON as failure.

Example:

```java
try (JsonParser parser = mapper.getFactory().createParser(inputStream)) {
    if (parser.nextToken() != JsonToken.START_ARRAY) {
        throw new InvalidPayloadException("Expected array");
    }

    while (parser.nextToken() != JsonToken.END_ARRAY) {
        OrderEvent event = mapper.readValue(parser, OrderEvent.class);
        handler.handle(event);
    }
}
```

FORBIDDEN:

- `readValue` into `List<T>` for unbounded payload.
- Streaming without error handling for malformed/truncated input.

---

## 19. Request/Response Body Ownership

MUST:

- Close input streams owned by the caller only according to caller contract.
- Avoid double-reading HTTP request bodies.
- Avoid serializing directly into memory for large output.
- Use streaming output for large response/download.

FORBIDDEN:

```java
String json = new String(requestBody.readAllBytes(), StandardCharsets.UTF_8);
```

for unbounded request bodies.

---

## 20. Custom Serializer/Deserializer Policy

Custom serializers/deserializers are restricted.

Allowed only when:

- A third-party wire contract cannot be represented with normal Jackson configuration.
- Backward compatibility requires legacy shape.
- Streaming transformation is required for performance.

MUST include:

- Unit tests for valid, invalid, missing, null, unknown, and malicious inputs.
- Clear failure messages.
- No network/database/business side effects.
- No dependency on mutable global state.

FORBIDDEN:

- Business validation hidden inside deserializer.
- Custom serializer just to rename a property.
- Calling repositories/services from deserializer.

---

## 21. Views, Mixins, and Filters

### 21.1 `@JsonView`

Restricted.

Allowed only for stable presentation variants where:

- Views are documented.
- Tests prove field visibility.
- It is not used for authorization.

FORBIDDEN:

- `@JsonView` as access-control mechanism.

### 21.2 Mixins

Restricted.

Allowed for:

- Third-party classes that cannot be annotated.
- Framework integration that needs non-invasive metadata.

FORBIDDEN:

- Mixins to hide entity leakage in API.
- Mixins spread across modules without central registration.

### 21.3 Dynamic filters

Restricted; must have tests and authorization/security review.

---

## 22. Property Naming Strategy

MUST:

- Define naming strategy once per API boundary.
- Avoid mixing `snake_case`, `camelCase`, and custom names in the same API without reason.
- Use `@JsonProperty` for intentionally stable wire names.

FORBIDDEN:

- Changing global naming strategy in shared mapper without full contract regression tests.

---

## 23. Inclusion Policy

MUST define:

- Whether null fields are serialized.
- Whether empty collections are serialized.
- Whether absent optional values are serialized.
- Whether defaults are serialized.

Rules:

- Public API must not change inclusion policy casually; it is a contract change.
- Events should prefer explicit required fields and versioned optional fields.

Restricted:

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
```

Allowed only when consumers are designed for missing fields.

---

## 24. Error Handling

MUST:

- Convert `JsonProcessingException`/mapping failures into boundary-specific errors.
- Do not leak raw parser details to external clients.
- Log enough internal context without logging sensitive payload.
- Return deterministic API errors.

Example HTTP mapping:

```java
catch (JsonProcessingException ex) {
    throw new BadRequestException("Malformed JSON payload", ex);
}
```

FORBIDDEN:

- Returning stack traces to clients.
- Logging full request body by default.
- Swallowing parse errors and defaulting to empty object.

---

## 25. Security Rules

MUST:

- Treat all inbound JSON as untrusted.
- Enforce maximum request size before Jackson parsing where possible.
- Avoid polymorphic deserialization unless allow-listed.
- Avoid native Java deserialization entirely for JSON payloads.
- Avoid logging secrets.
- Validate deserialized DTOs.
- Defend against JSON bombs/deep nesting with parser constraints where available.

FORBIDDEN:

- Global default typing on untrusted data.
- Deserializing into `Object` and then executing behavior based on type.
- Deserializing into classes with dangerous side effects in setters/constructors.
- Accepting user-controlled `@class` / `class` / type metadata.

---

## 26. Secrets and Redaction

MUST:

- Mark secret DTO fields clearly.
- Never log serialized DTOs that may contain secrets.
- Use explicit redacted DTOs for logs/audit.
- Avoid `toString()` containing secrets.

FORBIDDEN:

```java
log.info("request={}", mapper.writeValueAsString(request));
```

unless request type is proven safe and redacted.

---

## 27. API Contract Testing

Every JSON boundary MUST have tests for:

- Required fields.
- Optional fields.
- Unknown fields.
- Null values.
- Invalid types.
- Invalid enum values.
- Date/time format.
- Numeric precision.
- Serialization shape.
- Deserialization failure shape.

Recommended:

- Golden JSON fixtures for public APIs/events.
- JSON schema or OpenAPI contract where applicable.
- Consumer-driven contract tests for cross-service payloads.

---

## 28. Performance Rules

MUST:

- Reuse mappers/readers/writers.
- Use streaming for large payloads.
- Avoid converting object -> string -> bytes unnecessarily.
- Avoid pretty printing in production hot paths.
- Avoid reflection-heavy custom serializers unless measured.

Restricted:

- Afterburner/Blackbird performance modules: allowed only with compatibility tests and benchmark evidence.
- `JsonNode` transformations in hot paths.
- Large generic map deserialization.

FORBIDDEN:

- Creating `ObjectMapper` per request.
- Materializing unbounded JSON array.
- Benchmarking Jackson with one-off `System.nanoTime()` loops instead of JMH for microbenchmarks.

---

## 29. Framework Integration

### 29.1 HTTP server frameworks

MUST:

- Use framework-managed mapper where possible.
- Register modules centrally.
- Ensure framework and application mappers do not drift.
- Test actual wire serialization through HTTP test when feasible.

### 29.2 HTTP clients

MUST:

- Share the same DTO contract as server boundary, not domain types.
- Handle non-2xx error body separately.
- Avoid deserializing error response into success DTO.

### 29.3 Messaging

MUST:

- Include event type/version metadata outside or inside JSON payload by contract.
- Use stable DTOs for event versions.
- Preserve unknown fields only if event-forwarding requires it.

### 29.4 Persistence JSON

MUST:

- Version stored JSON shape.
- Provide migration strategy.
- Avoid storing domain object serialization directly.

---

## 30. Jackson and ORM Entities

FORBIDDEN:

- Serializing Hibernate/JPA entities directly to JSON.
- Relying on Jackson Hibernate modules to make API entity exposure acceptable.
- Lazy-loading during serialization.
- Bidirectional entity graph serialization.

Allowed only as migration bridge:

- Hibernate-specific datatype modules, with explicit tests and deprecation plan.

Preferred:

- Query DTO projection.
- MapStruct/manual mapper to response DTO.
- Explicit fetch plan.

---

## 31. Object Identity and Cycles

FORBIDDEN by default:

- `@JsonManagedReference` / `@JsonBackReference` to fix domain graph leakage.
- `@JsonIdentityInfo` for public APIs.

Allowed only when:

- Object graph identity is part of wire contract.
- Consumers understand identity references.
- Cycle behavior is contract-tested.

---

## 32. Duplicate Field Policy

MUST define policy for duplicate JSON object fields.

Recommended:

- Enable strict duplicate detection for external security-sensitive boundaries.
- Reject duplicate fields in authentication, authorization, payment, and regulatory workflows.

FORBIDDEN:

- Accepting duplicate fields silently when the data affects security or financial/state transitions.

---

## 33. Migration Rules

### 33.1 Jackson 2.x upgrade

MUST:

- Use BOM.
- Run serialization compatibility tests.
- Check module compatibility.
- Validate changed defaults/features.
- Scan for deprecated APIs.

### 33.2 Jackson 2 -> 3

MUST have migration plan covering:

- Package changes.
- Module coordinates.
- Framework support.
- Removed/deprecated APIs.
- Contract regression tests.
- Security review for polymorphism.

FORBIDDEN:

- Blind automated package rename without running wire-level tests.

---

## 34. LLM Implementation Protocol

Before changing Jackson code, an LLM agent MUST answer:

1. What JSON boundary is being changed?
2. Is the payload inbound, outbound, event, persistence JSON, or log/audit JSON?
3. Is the input trusted or untrusted?
4. What is the unknown field policy?
5. What is the null/missing/default policy?
6. What is the date/time/numeric policy?
7. Is polymorphism involved?
8. What tests prove compatibility?

The agent MUST NOT:

- Add `new ObjectMapper()` inside business logic.
- Disable `FAIL_ON_UNKNOWN_PROPERTIES` globally without reason.
- Enable default typing.
- Expose entities directly.
- Add custom deserializer without tests.
- Hide parse errors.

---

## 35. Reviewer Checklist

A reviewer MUST verify:

- [ ] Mapper is centrally configured and reused.
- [ ] No runtime mutation of shared mapper.
- [ ] DTOs are separate from domain/entity types.
- [ ] Unknown field behavior is intentional.
- [ ] Null/missing/default semantics are tested.
- [ ] Date/time serialization is stable.
- [ ] Money/decimal precision is preserved.
- [ ] Enum wire values are stable.
- [ ] No unsafe polymorphic deserialization.
- [ ] No raw `Object`/`Map` deserialization in business logic.
- [ ] Large payloads use streaming or size limits.
- [ ] Secrets are not logged.
- [ ] Error mapping is deterministic.
- [ ] Contract/golden tests exist for public/event JSON.
- [ ] Framework mapper and application mapper do not drift.

---

## 36. References

- FasterXML Jackson releases and migration notes.
- Jackson `ObjectMapper` Javadocs.
- Jackson polymorphic deserialization documentation.
- Jackson BOM documentation.
- RFC 8259 JSON.
- OWASP deserialization and API security guidance.
