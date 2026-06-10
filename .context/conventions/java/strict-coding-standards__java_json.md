# Strict Coding Standards — Java JSON

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when parsing, generating, serializing, deserializing, validating, storing, and transmitting JSON in Java.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. Covers RFC 8259 JSON behavior, Jackson, Gson, JSON-B, JSON-P, DTO contracts, schema validation, polymorphic deserialization, number/date handling, streaming, security, and observability.
>
> **Mode**: Strict. JSON is a data interchange format, not a license to accept arbitrary object graphs.

---

## 0. Core Principle

JSON boundaries are trust boundaries.

A code agent must never deserialize external JSON directly into domain entities, persistence entities, security objects, arbitrary polymorphic types, or framework internals.

Every JSON boundary must define:

1. DTO type;
2. schema/contract version;
3. unknown field policy;
4. null/missing policy;
5. numeric precision policy;
6. date/time format policy;
7. polymorphism policy;
8. size/depth limits;
9. validation rules;
10. error mapping.

If these are missing, the JSON implementation is incomplete.

---

## 1. JSON Standards and Library Matrix

| Area | Java 11 | Java 17 | Java 21 | Java 25 | Rule |
|---|---:|---:|---:|---:|---|
| RFC 8259 JSON syntax | Yes | Yes | Yes | Yes | Required external contract baseline |
| Jackson | External dependency | External dependency | External dependency | External dependency | Allowed with strict mapper config |
| Gson | External dependency | External dependency | External dependency | External dependency | Allowed with strict type adapters |
| JSON-B | External dependency / Jakarta | External dependency / Jakarta | External dependency / Jakarta | External dependency / Jakarta | Allowed in Jakarta stacks |
| JSON-P | External dependency / Jakarta | External dependency / Jakarta | External dependency / Jakarta | External dependency / Jakarta | Allowed for streaming/tree processing |
| Java records as DTOs | No | Yes | Yes | Yes | Allowed from Java 16+ with explicit JSON config |
| Sealed polymorphic DTOs | No | Yes | Yes | Yes | Restricted |
| `BigDecimal` exact decimal | Yes | Yes | Yes | Yes | Required for money/exact decimal |
| `java.time` | Yes | Yes | Yes | Yes | Required for dates/times |

### 1.1 Library Policy

A module should standardize on one JSON binding library for application DTOs.

Do not mix Jackson, Gson, JSON-B, and ad-hoc parsing in the same module unless a bridge/migration reason exists.

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

The following are forbidden unless explicitly approved:

1. deserializing external JSON into JPA entities/domain aggregates directly;
2. enabling global polymorphic deserialization/default typing without a strict subtype allow-list;
3. allowing payload-provided class names as type identifiers;
4. accepting unknown fields silently on external APIs unless backward compatibility requires it and it is documented;
5. using `Map<String, Object>` as primary request model for business APIs;
6. using `Object` fields for arbitrary nested payloads without schema;
7. using `double`/`float` for money or exact decimal values;
8. serializing `Instant`/date-time in ambiguous local formats;
9. using system default timezone for JSON serialization/deserialization;
10. logging full JSON payloads containing secrets/PII;
11. loading entire unbounded JSON payload into memory;
12. using reflection-based JSON serialization to expose private/sensitive fields by accident;
13. using user input to select target class/type adapter/deserializer;
14. accepting duplicate object field names without documented policy;
15. treating JSON validation as business authorization.

### 2.2 Mandatory for JSON Boundaries

```text
JSON Contract Note
- Endpoint/message/file:
- Direction: inbound/outbound/both
- DTO type:
- Schema/version:
- Required fields:
- Unknown field policy:
- Null policy:
- Numeric precision policy:
- Date/time format:
- Polymorphism policy:
- Max size/depth:
- Validation:
- Error mapping:
```

---

## 3. DTO Boundary Rules

### 3.1 External JSON Must Bind to DTOs

Inbound JSON must bind to request DTOs, not domain entities.

Forbidden:

```java
@PostMapping("/orders")
public Order create(@RequestBody Order order) { ... } // domain/JPA entity
```

Preferred:

```java
public record CreateOrderRequest(
    String customerId,
    List<CreateOrderLineRequest> lines,
    String idempotencyKey
) {}
```

Rules:

1. DTOs are boundary objects.
2. DTOs may use records on Java 16+ if framework supports them.
3. DTOs must not contain behavior beyond simple normalization if any.
4. Domain conversion must be explicit and validated.
5. DTO validation errors must be returned as stable client errors.

### 3.2 Outbound DTOs

Outbound JSON must use response DTOs.

Rules:

1. Do not expose internal domain/entity shape accidentally.
2. Do not expose internal IDs unless contract allows.
3. Do not expose security flags, audit metadata, internal workflow state, or foreign-key structure unintentionally.
4. Use explicit field names.
5. Include versioning when public/external contract may evolve.

---

## 4. Object Mapper Configuration Rules

### 4.1 Centralized Mapper

JSON mapper configuration must be centralized.

Forbidden:

```java
ObjectMapper mapper = new ObjectMapper(); // scattered inside methods
```

Preferred:

```java
public final class JsonMapperFactory {
    private JsonMapperFactory() {}

    public static ObjectMapper createStrictMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
        mapper.enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
        return mapper;
    }
}
```

Rules:

1. Configure mapper before first use.
2. Reuse mapper instances after immutable configuration.
3. Do not mutate shared mapper configuration at runtime.
4. Use dedicated `ObjectReader`/`ObjectWriter` for per-use variations.
5. Do not hide mapper creation in utility methods that create a new mapper per call.

### 4.2 Strict Default Settings

External API mappers must default to:

1. fail on unknown properties unless compatibility policy says otherwise;
2. fail on invalid subtype;
3. fail on trailing tokens if supported;
4. explicit Java time module/config;
5. BigDecimal for exact decimal;
6. no global default typing;
7. no automatic visibility into private fields unless approved;
8. no serialization of nulls unless contract requires them;
9. deterministic property naming strategy;
10. explicit enum handling.

---

## 5. Unknown Field Policy

Unknown fields are a compatibility decision.

| Context | Recommended policy |
|---|---|
| Public external API inbound | Fail by default unless forward compatibility is required |
| Internal service-to-service | Fail by default; version contracts explicitly |
| Event consumers | Often ignore unknown fields for forward compatibility, but log/metric by schema version |
| Configuration files | Fail unknown fields |
| Audit/legal payloads | Fail unknown fields or preserve raw payload as evidence |

Do not silently ignore unknown fields without documenting why.

---

## 6. Null and Missing Field Policy

JSON has distinct concerns:

1. field missing;
2. field present with `null`;
3. field present with empty string;
4. field present with empty array/object;
5. field present with invalid type.

Rules:

1. Required fields must be validated after deserialization.
2. Do not rely only on Java primitive defaults.
3. Avoid nullable booleans for decision-critical flags unless tri-state is intended.
4. Use `Optional` in domain APIs cautiously; avoid `Optional` fields in DTOs unless framework policy supports it.
5. Empty string must not be auto-treated as null unless contract says so.
6. Null collection should be normalized to empty only if semantically correct.

---

## 7. Numeric Policy

JSON number has no built-in Java type, scale, or precision.

Rules:

1. Money/exact decimal must use `BigDecimal`.
2. Counts/IDs must use `long`, `BigInteger`, or `String` based on contract range.
3. Do not parse exact decimal into `double` and later convert to `BigDecimal`.
4. Define rounding at domain boundary, not hidden in JSON mapper.
5. Validate min/max range.
6. Validate scale for money.
7. Reject `NaN`, `Infinity`, `-Infinity` in external JSON.
8. For JavaScript-facing APIs, consider transmitting large integer IDs as strings if precision may exceed safe JS integer range.

Forbidden:

```java
record PaymentRequest(double amount) {}
```

Preferred:

```java
record PaymentRequest(BigDecimal amount, String currency) {}
```

---

## 8. Date and Time Policy

Rules:

1. Use `Instant` for event/audit timestamps.
2. Use `OffsetDateTime` for external timestamps where offset is meaningful.
3. Use `LocalDate` for date-only business values.
4. Do not use `LocalDateTime` for absolute timestamps.
5. Do not use system default timezone in JSON mapping.
6. Serialize timestamps in ISO-8601 format unless contract says otherwise.
7. Include offset or UTC marker for absolute times.
8. Validate date ranges.
9. Do not use epoch milliseconds unless contract requires it.
10. Tests must cover timezone and DST boundaries.

Forbidden:

```json
{"submittedAt":"2026-06-10 09:30:00"}
```

Preferred:

```json
{"submittedAt":"2026-06-10T02:30:00Z"}
```

---

## 9. String, Unicode, and Encoding Policy

Rules:

1. External JSON must be treated as Unicode text.
2. Use UTF-8 for HTTP/file JSON unless explicit contract says otherwise.
3. Do not assume `String.length()` equals user-perceived character count.
4. Validate maximum byte length and character/code-point length separately when storage limits matter.
5. Normalize Unicode only when the domain requires comparison/search canonicalization.
6. Escape using JSON library, not manual string concatenation.
7. Do not embed untrusted JSON into HTML/JavaScript without context-specific escaping.

---

## 10. Polymorphic Deserialization Rules

Polymorphic JSON is restricted.

Allowed only when:

1. closed set of subtypes exists;
2. type discriminator is explicit and stable;
3. discriminator values are domain names, not Java class names;
4. subtype allow-list is enforced;
5. unknown subtype fails closed;
6. each subtype has validation;
7. tests cover invalid discriminator and unexpected fields.

Forbidden:

```json
{"@class":"com.company.SecretAdminCommand", ...}
```

Preferred:

```json
{"type":"CARD_PAYMENT", "cardToken":"..."}
```

Java 17+ sealed interfaces can help model closed polymorphism, but wire type IDs must remain stable external contract values.

---

## 11. Jackson-Specific Rules

### 11.1 Default Typing

Global default typing is forbidden by default.

Forbidden:

```java
mapper.enableDefaultTyping();
mapper.activateDefaultTyping(...); // unless strict validator and architecture approval exist
```

If polymorphism is necessary:

1. use explicit `@JsonTypeInfo` only on boundary DTO hierarchy;
2. use stable discriminator names;
3. restrict subtypes;
4. consider `PolymorphicTypeValidator`;
5. avoid class-name based type IDs;
6. never apply to arbitrary `Object` fields.

### 11.2 Visibility

Do not enable field visibility globally to serialize private fields.

Forbidden:

```java
mapper.setVisibility(PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY);
```

Allowed only for controlled DTO packages with security review.

### 11.3 Annotations

Rules:

1. Do not scatter JSON annotations into domain model unless domain model is explicitly boundary-owned.
2. Prefer DTO-specific annotations.
3. `@JsonIgnore` on sensitive fields is a defense-in-depth, not a substitute for DTOs.
4. `@JsonAnySetter` and `@JsonAnyGetter` are restricted.
5. Custom serializers/deserializers require tests.
6. `@JsonCreator` constructors must validate invariants.

### 11.4 ObjectReader/ObjectWriter

For repeated use:

```java
private static final ObjectReader REQUEST_READER = mapper.readerFor(CreateOrderRequest.class);
private static final ObjectWriter RESPONSE_WRITER = mapper.writerFor(OrderResponse.class);
```

Do not reconfigure shared mapper per request.

---

## 12. Gson-Specific Rules

Gson is allowed with strict configuration.

Rules:

1. Centralize `Gson` construction.
2. Register type adapters for `java.time`; do not rely on legacy `Date` defaults.
3. Use `TypeToken` for generic types.
4. Avoid raw `Map`/`Object` parsing for business APIs.
5. Define unknown field behavior through validation because Gson is lenient in several common usage patterns.
6. Do not use custom `InstanceCreator` or reflection adapters for untrusted dynamic types without allow-list.
7. Test custom serializers/deserializers.

Forbidden:

```java
List<Order> orders = gson.fromJson(json, List.class); // loses element type
```

Preferred:

```java
Type type = new TypeToken<List<OrderRequest>>() {}.getType();
List<OrderRequest> orders = gson.fromJson(json, type);
```

---

## 13. JSON-B / JSON-P Rules

### 13.1 JSON-B

JSON-B is allowed in Jakarta-based services.

Rules:

1. Centralize `Jsonb` configuration.
2. Do not mix `javax.json.bind` and `jakarta.json.bind` in one module.
3. Use DTOs, not entities.
4. Configure date/time adapters explicitly.
5. Define unknown/null policy.
6. Use explicit polymorphic handling only with allow-list.
7. Test adapter behavior.

### 13.2 JSON-P

JSON-P is allowed for tree or streaming processing.

Rules:

1. Use streaming parser/generator for large payloads.
2. Avoid materializing large documents into `JsonObject`.
3. Validate expected field types.
4. Do not use string concatenation to generate JSON.
5. Close parser/generator resources.

---

## 14. Large JSON and Streaming Rules

For large payloads:

1. enforce request/file size limit before parsing;
2. use streaming parser;
3. process bounded batches;
4. avoid accumulating full object graph;
5. validate each item;
6. emit partial failure policy explicitly;
7. enforce timeout/cancellation;
8. track processed count and rejected count;
9. avoid `readValue(inputStream, List.class)` for unbounded arrays.

Example policy:

```text
Large JSON Import Policy
- Max file size: 200 MB
- Max array items: 1,000,000
- Batch size: 1,000
- Per-record validation: yes
- Failure mode: reject file after 10,000 invalid records
- Memory target: bounded, no full materialization
```

---

## 15. JSON Schema and Contract Validation

JSON Schema is recommended for external contracts, event contracts, configuration files, and partner integration.

Rules:

1. Version schemas explicitly.
2. Validate inbound JSON before or during binding when feasible.
3. Keep schema and DTO synchronized through tests.
4. Use `additionalProperties` intentionally.
5. Define required fields.
6. Define numeric ranges and string length.
7. Define enum values.
8. Define date/time string formats.
9. Avoid overly permissive schemas.
10. Validate schema changes for backward compatibility.

---

## 16. Duplicate Field Policy

JSON objects with duplicate names can create ambiguity across parsers.

Rules:

1. External APIs should reject duplicate fields if parser supports detection.
2. At minimum, document parser behavior.
3. Do not rely on “last field wins” for security-sensitive values.
4. Add tests for duplicate authz/amount/status fields.

Security-sensitive example:

```json
{"role":"USER", "role":"ADMIN"}
```

Must not be accepted silently for decision-critical input.

---

## 17. Security Rules

### 17.1 Injection and Escaping

JSON libraries handle JSON escaping. They do not handle every target context.

Rules:

1. JSON string escaping is not HTML escaping.
2. JSON string escaping is not SQL escaping.
3. JSON string escaping is not shell escaping.
4. JSON fields used in SQL must still use bind parameters.
5. JSON fields used in HTML/JS must use context-specific output encoding.
6. JSON fields used in paths must pass path validation.
7. JSON fields used in URLs must pass SSRF/URL validation.

### 17.2 Secret Handling

Do not serialize secrets by default.

Forbidden fields unless explicitly approved:

1. password;
2. password hash;
3. token;
4. refresh token;
5. session ID;
6. private key;
7. API key;
8. OAuth authorization code;
9. PII not needed for the response;
10. internal authorization flags.

### 17.3 Deserialization Gadgets

Avoid features that instantiate arbitrary classes or execute arbitrary setters/builders.

Rules:

1. Keep dependency versions patched.
2. Avoid unsafe polymorphism.
3. Prefer immutable DTOs/records with explicit constructors.
4. Use allow-lists for subtypes.
5. Do not expose deserialization errors with classpath details.

---

## 18. Error Handling

JSON errors must be stable.

Recommended error codes:

```text
JSON_MALFORMED
JSON_SIZE_LIMIT_EXCEEDED
JSON_SCHEMA_INVALID
JSON_UNKNOWN_FIELD
JSON_MISSING_REQUIRED_FIELD
JSON_NULL_NOT_ALLOWED
JSON_INVALID_TYPE
JSON_INVALID_ENUM
JSON_INVALID_NUMBER
JSON_INVALID_DATE_TIME
JSON_UNSUPPORTED_VERSION
JSON_UNSUPPORTED_TYPE
```

Rules:

1. Do not leak internal class names.
2. Include field path when safe.
3. Include correlation ID.
4. Do not echo full invalid payload.
5. Preserve raw exception internally.
6. Differentiate parse errors from business validation errors.

---

## 19. Observability

Log/metric:

1. payload size bucket;
2. endpoint/message type;
3. schema version;
4. parse duration;
5. validation duration;
6. rejection reason;
7. unknown field count if tolerated;
8. item count for arrays/imports;
9. mapper version/config profile;
10. correlation ID.

Do not log:

1. full JSON payload by default;
2. secrets/tokens/passwords;
3. large arrays;
4. PII without redaction;
5. internal class names in client-facing responses.

---

## 20. Testing Requirements

Mandatory inbound tests:

1. valid minimal payload;
2. valid full payload;
3. malformed JSON;
4. unknown field;
5. missing required field;
6. null for required field;
7. wrong type;
8. invalid enum;
9. decimal precision/scale;
10. large integer range;
11. invalid date/time;
12. duplicate field;
13. oversized payload;
14. excessive nesting;
15. unsupported schema version;
16. polymorphic invalid discriminator;
17. secret field ignored/rejected;
18. trailing tokens if parser supports detection.

Mandatory outbound tests:

1. field names match contract;
2. null serialization policy;
3. date/time format;
4. decimal precision preserved;
5. no internal fields;
6. no secrets;
7. deterministic enum values;
8. schema compatibility.

---

## 21. Review Checklist

A reviewer must reject JSON code if:

- [ ] It deserializes into domain/JPA entities directly.
- [ ] Mapper configuration is scattered.
- [ ] Unknown field policy is undocumented.
- [ ] Null/missing policy is undocumented.
- [ ] Money/exact decimal uses `double`/`float`.
- [ ] Date/time format or timezone is ambiguous.
- [ ] Polymorphic deserialization is not allow-listed.
- [ ] Payload can select Java class name.
- [ ] Large payload is fully materialized without limits.
- [ ] Full payload is logged.
- [ ] Secret fields can be serialized.
- [ ] Schema/version policy is missing for external contracts.
- [ ] Negative tests are missing.

---

## 22. LLM Code Agent Contract

```text
You are implementing Java JSON code.
You must treat JSON input as untrusted unless explicitly stated otherwise.
You must bind external JSON to DTOs, not domain/JPA entities.
You must centralize mapper configuration.
You must define unknown field, null, numeric, date/time, and polymorphism policy.
You must not enable global default typing or class-name based polymorphism.
You must not use double/float for money or exact decimals.
You must enforce size/depth limits for untrusted JSON.
You must not log full payloads with secrets or PII.
You must add negative tests for malformed JSON, unknown fields, missing fields, invalid type, invalid date/time, duplicate fields, and unsafe polymorphism.
```

---

## 23. References

- RFC 8259 JSON Data Interchange Format: https://datatracker.ietf.org/doc/html/rfc8259
- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12
- Jackson polymorphic deserialization documentation: https://github.com/FasterXML/jackson-docs/wiki/JacksonPolymorphicDeserialization
- Jackson `ObjectMapper` Javadoc: https://fasterxml.github.io/jackson-databind/javadoc/2.7/com/fasterxml/jackson/databind/ObjectMapper.html
- Gson User Guide: https://google.github.io/gson/UserGuide.html
- Jakarta JSON Binding: https://jakarta.ee/specifications/jsonb/
- Jakarta JSON Processing: https://jakartaee.github.io/jsonp-api/
- OWASP Deserialization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
- OWASP Secure Code Review Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html
