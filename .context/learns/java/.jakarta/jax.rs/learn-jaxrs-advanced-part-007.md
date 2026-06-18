# learn-jaxrs-advanced-part-007.md

# Bagian 007 — Advanced Parameter Conversion: `ParamConverter`, `ParamConverterProvider`, `valueOf`, Constructor, `fromString`, `@Lazy`, Error Taxonomy, dan Typed Boundary Design

> Target pembaca: Java/Jakarta engineer yang ingin menguasai parameter conversion JAX-RS/Jakarta REST secara mendalam. Part ini membahas bagaimana string dari path/query/header/cookie/matrix/form menjadi tipe Java yang benar, kapan cukup memakai constructor/`valueOf`/`fromString`, kapan perlu `ParamConverterProvider`, bagaimana prioritas converter bekerja, bagaimana `@Lazy` mempengaruhi default value conversion, bagaimana mendesain typed domain IDs, enum alias, date/time conversion, error taxonomy, testing, observability, dan portability antar runtime.
>
> Namespace utama: `jakarta.ws.rs.ext.ParamConverter`, `jakarta.ws.rs.ext.ParamConverterProvider`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Conversion adalah Syntax Boundary, Bukan Business Resolution](#2-mental-model-conversion-adalah-syntax-boundary-bukan-business-resolution)
3. [Conversion Pipeline dalam JAX-RS](#3-conversion-pipeline-dalam-jax-rs)
4. [Jenis Parameter yang Mendukung Conversion](#4-jenis-parameter-yang-mendukung-conversion)
5. [Conversion Strategy Order](#5-conversion-strategy-order)
6. [Built-In Basic Types](#6-built-in-basic-types)
7. [Constructor `String`: Kapan Cocok](#7-constructor-string-kapan-cocok)
8. [`valueOf(String)`: Static Factory Klasik](#8-valueofstring-static-factory-klasik)
9. [`fromString(String)`: Static Factory Alternatif](#9-fromstringstring-static-factory-alternatif)
10. [`valueOf` vs `fromString`: Rule Penting](#10-valueof-vs-fromstring-rule-penting)
11. [Enum Conversion dan Case Sensitivity](#11-enum-conversion-dan-case-sensitivity)
12. [Custom Enum Alias Converter](#12-custom-enum-alias-converter)
13. [`ParamConverter<T>`: Kontrak Low-Level](#13-paramconvertert-kontrak-low-level)
14. [`ParamConverterProvider`: Registry untuk Custom Types](#14-paramconverterprovider-registry-untuk-custom-types)
15. [Provider Registration dan Discovery](#15-provider-registration-dan-discovery)
16. [Priority: ParamConverter Harus Diutamakan](#16-priority-paramconverter-harus-diutamakan)
17. [`@ParamConverter.Lazy`: Default Value Conversion Timing](#17-paramconverterlazy-default-value-conversion-timing)
18. [Default Value Conversion: Deployment Time vs Injection Time](#18-default-value-conversion-deployment-time-vs-injection-time)
19. [Typed Domain IDs: `CustomerId`, `OrderId`, `TenantId`](#19-typed-domain-ids-customerid-orderid-tenantid)
20. [Converter untuk Strongly Typed ID](#20-converter-untuk-strongly-typed-id)
21. [Generic Base Converter: Kapan Membantu, Kapan Membahayakan](#21-generic-base-converter-kapan-membantu-kapan-membahayakan)
22. [Date/Time Conversion: `LocalDate`, `Instant`, `OffsetDateTime`](#22-datetime-conversion-localdate-instant-offsetdatetime)
23. [Locale, Time Zone, dan Date Parsing Policy](#23-locale-time-zone-dan-date-parsing-policy)
24. [Numeric Value Objects: `PageSize`, `Limit`, `Amount`](#24-numeric-value-objects-pagesize-limit-amount)
25. [Sort, Filter, Include: Converter atau Parser?](#25-sort-filter-include-converter-atau-parser)
26. [Collection Conversion: Standard vs Runtime Extension](#26-collection-conversion-standard-vs-runtime-extension)
27. [Comma-Separated Values: Jangan Asumsikan Otomatis](#27-comma-separated-values-jangan-asumsikan-otomatis)
28. [Generic Type dan Annotation Metadata dalam `getConverter`](#28-generic-type-dan-annotation-metadata-dalam-getconverter)
29. [Annotation-Aware Converter](#29-annotation-aware-converter)
30. [Error Handling: Exception dari Converter Menjadi Apa?](#30-error-handling-exception-dari-converter-menjadi-apa)
31. [Error Taxonomy untuk Parameter Conversion](#31-error-taxonomy-untuk-parameter-conversion)
32. [Problem Details untuk Conversion Error](#32-problem-details-untuk-conversion-error)
33. [Conversion vs Validation vs Authorization vs Lookup](#33-conversion-vs-validation-vs-authorization-vs-lookup)
34. [Anti-Pattern: Converter Melakukan DB Lookup](#34-anti-pattern-converter-melakukan-db-lookup)
35. [Security Concerns: Length, Encoding, Regex, ReDoS, Secret Leakage](#35-security-concerns-length-encoding-regex-redos-secret-leakage)
36. [Performance Concerns: Allocation, Regex Compile, Object Creation](#36-performance-concerns-allocation-regex-compile-object-creation)
37. [Thread Safety dan Converter Lifecycle](#37-thread-safety-dan-converter-lifecycle)
38. [CDI Injection dalam Provider/Converter](#38-cdi-injection-dalam-providerconverter)
39. [Testing Converter](#39-testing-converter)
40. [Runtime Integration Tests](#40-runtime-integration-tests)
41. [Observability untuk Conversion Errors](#41-observability-untuk-conversion-errors)
42. [Implementation Differences: Jersey, RESTEasy, CXF, Quarkus](#42-implementation-differences-jersey-resteasy-cxf-quarkus)
43. [Migration `javax.ws.rs.ext` ke `jakarta.ws.rs.ext`](#43-migration-javaxxwrsext-ke-jakartawsrsext)
44. [Design Guidelines](#44-design-guidelines)
45. [Common Failure Modes](#45-common-failure-modes)
46. [Best Practices](#46-best-practices)
47. [Anti-Patterns](#47-anti-patterns)
48. [Production Checklist](#48-production-checklist)
49. [Latihan](#49-latihan)
50. [Referensi Resmi](#50-referensi-resmi)
51. [Penutup](#51-penutup)

---

# 1. Tujuan Part Ini

Part sebelumnya membahas parameter injection.

Part ini zoom-in ke hal yang terjadi setelah runtime menemukan value string:

```text
"123"
"CUST-000001"
"2026-06-12"
"ACTIVE"
"createdAt:desc"
```

dan harus mengubahnya menjadi Java type:

```java
int
CustomerId
LocalDate
CustomerStatus
SortSpec
```

JAX-RS/Jakarta REST menyediakan beberapa strategi conversion:

- primitive/wrapper built-in;
- constructor dengan single `String`;
- static `valueOf(String)`;
- static `fromString(String)`;
- `ParamConverter<T>`;
- `ParamConverterProvider`.

## 1.1 Kenapa conversion penting?

Karena resource method signature adalah boundary typed contract.

Bad:

```java
public Response get(@PathParam("customerId") String customerId) {
    // parse everywhere
}
```

Better:

```java
public Response get(@PathParam("customerId") CustomerId customerId) {
    ...
}
```

## 1.2 Tapi conversion juga bisa berbahaya

Jika converter melakukan terlalu banyak:

```java
@PathParam("customerId") Customer customer
```

dan converter query database, maka converter bukan converter lagi.

Itu service lookup tersembunyi.

## 1.3 Prinsip utama

```text
Converters parse syntax.
Services resolve meaning.
Policies authorize access.
Validators enforce boundary rules.
```

---

# 2. Mental Model: Conversion adalah Syntax Boundary, Bukan Business Resolution

Conversion menjawab:

```text
Can this textual HTTP parameter be represented as this Java type?
```

Contoh:

```text
"CUST-000001" → CustomerId
"2026-06-12" → LocalDate
"ACTIVE" → CustomerStatus
"20" → PageSize
```

Conversion tidak seharusnya menjawab:

```text
Does customer exist?
Can current user access customer?
Is order cancellable?
Does tenant own this entity?
```

Itu bukan syntax.

Itu business/data/security.

## 2.1 Layer separation

```text
HTTP string
  ↓ conversion
Typed boundary value
  ↓ validation
Boundary invariant checked
  ↓ service lookup
Domain/resource exists
  ↓ authorization
Principal may access/action
  ↓ business rule
Operation allowed
```

## 2.2 Good converter

```java
CustomerId.fromString("CUST-000001")
```

checks format.

## 2.3 Bad converter

```java
customerRepository.findById("CUST-000001")
```

inside converter.

## 2.4 Why bad?

- hidden database call during parameter injection;
- unclear error mapping;
- hard to test;
- security context unavailable/unclear;
- performance surprise;
- transaction boundary unclear;
- authorization bypass risk;
- conversion may happen before filters/validators expected.

## 2.5 Top-tier rule

```text
Keep conversion pure, deterministic, fast, side-effect-free.
```

---

# 3. Conversion Pipeline dalam JAX-RS

For parameter annotations, runtime roughly does:

```text
find raw string value(s)
  ↓
apply @DefaultValue if metadata missing
  ↓
decode unless @Encoded
  ↓
choose converter strategy
  ↓
convert string to target type
  ↓
inject into method/field/property/bean
  ↓
run validation if configured
  ↓
invoke resource method
```

## 3.1 Source types

Raw values can come from:

- path template;
- query string;
- header;
- cookie;
- matrix params;
- form body.

## 3.2 Single-value target

```java
@QueryParam("page") int page
```

## 3.3 Multi-value target

```java
@QueryParam("status") List<OrderStatus> statuses
```

## 3.4 Missing metadata

If missing:

- `@DefaultValue` if present;
- null for reference type;
- collection empty/null depending rules/runtime;
- primitive default/conversion behavior needs test/avoid ambiguity.

## 3.5 Invalid conversion

Conversion failure should be client error.

But exact exception class and default response can vary.

Production API should map to stable error contract.

## 3.6 Converter location

Conversion happens before resource method body executes.

So you cannot catch conversion error inside resource method.

Use exception mapper.

---

# 4. Jenis Parameter yang Mendukung Conversion

Jakarta REST `ParamConverter` supports conversion for message parameter values injected via:

- `@PathParam`;
- `@QueryParam`;
- `@MatrixParam`;
- `@FormParam`;
- `@CookieParam`;
- `@HeaderParam`.

## 4.1 Path

```java
@PathParam("customerId") CustomerId customerId
```

## 4.2 Query

```java
@QueryParam("date") LocalDate date
```

## 4.3 Matrix

```java
@MatrixParam("year") Year year
```

## 4.4 Form

```java
@FormParam("email") Email email
```

## 4.5 Cookie

```java
@CookieParam("theme") Theme theme
```

## 4.6 Header

```java
@HeaderParam("Idempotency-Key") IdempotencyKey key
```

## 4.7 Entity body is different

JSON body conversion is not `ParamConverter`.

It is `MessageBodyReader`.

Do not confuse:

```java
CreateCustomerRequest request
```

with:

```java
@QueryParam("status") CustomerStatus status
```

---

# 5. Conversion Strategy Order

JAX-RS supports several conversion strategies.

## 5.1 ParamConverter first

If a `ParamConverter` is available for a type, it must be preferred over other conversion strategies.

## 5.2 Then built-in/string constructor/static methods

Common order described in spec/API docs includes:

- primitive types;
- types with constructor accepting a single `String`;
- types with static `valueOf(String)`;
- types with static `fromString(String)`;
- collection/array forms of supported element type.

## 5.3 `valueOf` vs `fromString`

If both exist, `valueOf` is used unless type is enum; for enum, `fromString` should be used if available.

## 5.4 Why this matters

If you add a `ParamConverterProvider`, it can override static factory behavior.

## 5.5 Example

```java
public record CustomerId(String value) {
    public static CustomerId valueOf(String raw) { ... }
}
```

Then later register:

```java
ParamConverter<CustomerId>
```

Runtime must use `ParamConverter`.

## 5.6 Top-tier warning

Adding a global provider can silently change conversion behavior across all resources.

Treat it as API behavior change.

---

# 6. Built-In Basic Types

Common parameter target types:

```java
String
int / Integer
long / Long
boolean / Boolean
double / Double
BigDecimal
UUID
Enum
```

## 6.1 String

No conversion except decoding.

## 6.2 Numbers

```java
@QueryParam("size") int size
```

Invalid:

```text
?size=abc
```

conversion failure.

## 6.3 Boolean

Boolean parsing may accept only standard forms depending conversion strategy.

Do not invent ambiguous API:

```text
?active=yes
?active=1
```

unless converter supports and docs specify.

## 6.4 UUID

`UUID.fromString` works for canonical UUID.

Invalid UUID fails conversion.

## 6.5 BigDecimal

Often works via string constructor.

Use for precise decimals.

## 6.6 Enum

Uses enum conversion rules.

Case-sensitive by default.

## 6.7 Recommendation

Wrap important domain primitives into value objects.

Example:

```java
PageSize
CustomerId
CurrencyCode
```

---

# 7. Constructor `String`: Kapan Cocok

A type can be converted if it has constructor accepting one `String`.

## 7.1 Example

```java
public final class CurrencyCode {
    private final String value;

    public CurrencyCode(String value) {
        String normalized = value.toUpperCase(Locale.ROOT);
        if (!normalized.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("Invalid currency code");
        }
        this.value = normalized;
    }

    public String value() {
        return value;
    }
}
```

Resource:

```java
@QueryParam("currency") CurrencyCode currency
```

## 7.2 Pros

- simple;
- no provider registration;
- reusable.

## 7.3 Cons

- public constructor may be undesirable;
- exception message may leak;
- normalization hidden;
- no annotation metadata;
- no custom error category;
- cannot inject services/config.

## 7.4 When okay

- tiny pure value objects;
- simple syntax;
- no complex parsing policy.

## 7.5 When avoid

- multiple parsing formats;
- annotation-specific behavior;
- need custom default conversion timing;
- need custom error details.

## 7.6 Prefer static factory?

Static factory is often clearer:

```java
CustomerId.fromString(value)
```

But JAX-RS can call static methods if signatures match.

---

# 8. `valueOf(String)`: Static Factory Klasik

`valueOf(String)` is a common conversion factory.

## 8.1 Example

```java
public record PageSize(int value) {

    public static PageSize valueOf(String raw) {
        int parsed = Integer.parseInt(raw);
        if (parsed < 1 || parsed > 100) {
            throw new IllegalArgumentException("Page size out of range");
        }
        return new PageSize(parsed);
    }
}
```

Resource:

```java
@QueryParam("size")
@DefaultValue("20")
PageSize size
```

## 8.2 Pros

- explicit named conversion;
- no provider needed;
- can normalize;
- constructor can remain compact/private-ish if using class.

## 8.3 Cons

- limited context;
- no annotation metadata;
- cannot distinguish parameter name;
- global for all uses.

## 8.4 Good for

- IDs;
- small value objects;
- bounded numbers;
- normalized codes.

## 8.5 Error

Throw `IllegalArgumentException`.

Map conversion exceptions.

## 8.6 Consistency

Use a team convention:

```java
fromString
```

or:

```java
valueOf
```

But remember JAX-RS selection rules.

---

# 9. `fromString(String)`: Static Factory Alternatif

`fromString(String)` is another supported static factory.

## 9.1 Example

```java
public record CustomerId(String value) {

    public static CustomerId fromString(String raw) {
        if (raw == null || !raw.matches("CUST-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid customer ID");
        }
        return new CustomerId(raw);
    }
}
```

Resource:

```java
@PathParam("customerId")
CustomerId customerId
```

## 9.2 Pros

- semantically clear;
- common in parsing APIs;
- works with JAX-RS conversion.

## 9.3 Cons

If both `valueOf` and `fromString` exist, `valueOf` generally wins except enum rule.

## 9.4 Recommendation

For custom value objects, define only one supported factory to avoid confusion.

## 9.5 Team convention

I recommend:

```java
public static Type fromString(String raw)
```

for domain value objects.

But if you need JAX-RS to prefer it, do not also define `valueOf` unless intended.

---

# 10. `valueOf` vs `fromString`: Rule Penting

The spec/API docs note:

```text
If both valueOf and fromString are present, valueOf must be used
unless type is enum, in which case fromString must be used.
```

## 10.1 Why this matters

This can surprise you.

```java
public static CustomerId valueOf(String raw) { ... }
public static CustomerId fromString(String raw) { ... }
```

JAX-RS uses `valueOf`.

## 10.2 Enum exception

For enum type, `fromString` can override default enum `valueOf`.

## 10.3 Avoid dual factory

Do not define both unless you know why.

## 10.4 If you need custom behavior

Use `ParamConverterProvider` to be explicit.

## 10.5 Migration risk

Adding `valueOf` later can change behavior.

## 10.6 Test

Write runtime tests for conversion behavior.

---

# 11. Enum Conversion dan Case Sensitivity

## 11.1 Default enum

```java
public enum OrderStatus {
    NEW,
    PAID,
    SHIPPED
}
```

Resource:

```java
@QueryParam("status") OrderStatus status
```

Request:

```text
?status=NEW
```

works.

Request:

```text
?status=new
```

may fail because enum `valueOf` is case-sensitive.

## 11.2 API design

Choose one:

- require uppercase enum names;
- accept lowercase/aliases using converter;
- use stable wire values not enum names.

## 11.3 Stable wire values

Enum names are code identifiers.

Changing enum name breaks API.

Better:

```java
public enum OrderStatus {
    NEW("new"),
    PAID("paid"),
    SHIPPED("shipped");
}
```

Then converter maps wire value.

## 11.4 Unknown enum

Return clear parameter error.

Do not default unknown to `UNKNOWN` silently unless API designed that way.

## 11.5 Collections

```java
@QueryParam("status") Set<OrderStatus> statuses
```

Each value converted.

## 11.6 Recommendation

For public API, use converter for enum wire values.

---

# 12. Custom Enum Alias Converter

## 12.1 Enum

```java
public enum CustomerStatus {
    ACTIVE("active"),
    SUSPENDED("suspended"),
    CLOSED("closed");

    private final String wire;

    CustomerStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static CustomerStatus fromWire(String raw) {
        for (CustomerStatus status : values()) {
            if (status.wire.equalsIgnoreCase(raw)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown customer status");
    }
}
```

## 12.2 Converter

```java
public final class CustomerStatusConverter implements ParamConverter<CustomerStatus> {

    @Override
    public CustomerStatus fromString(String value) {
        return CustomerStatus.fromWire(value);
    }

    @Override
    public String toString(CustomerStatus value) {
        return value.wire();
    }
}
```

## 12.3 Provider

```java
@Provider
public final class EnumAliasParamConverterProvider implements ParamConverterProvider {

    @Override
    @SuppressWarnings("unchecked")
    public <T> ParamConverter<T> getConverter(
        Class<T> rawType,
        Type genericType,
        Annotation[] annotations
    ) {
        if (rawType.equals(CustomerStatus.class)) {
            return (ParamConverter<T>) new CustomerStatusConverter();
        }
        return null;
    }
}
```

## 12.4 Benefits

- case-insensitive if desired;
- stable wire values;
- better error messages;
- decoupled from enum names.

## 12.5 Caution

Global provider applies everywhere that type is used.

## 12.6 Test

Test:

```text
active
ACTIVE
suspended
bad-value
```

---

# 13. `ParamConverter<T>`: Kontrak Low-Level

Interface:

```java
public interface ParamConverter<T> {
    T fromString(String value);
    String toString(T value);
}
```

## 13.1 Purpose

Converts between string parameter value and custom Java type.

## 13.2 fromString

Used for incoming request param.

```java
CustomerId id = converter.fromString("CUST-000001");
```

## 13.3 toString

Used for outbound string representation in contexts such as URI building in client/runtime.

Implement it properly.

## 13.4 Null handling

Define how null behaves.

Usually:

```java
if (value == null) return null;
```

or throw, depending type and missing param handling.

## 13.5 Exception

Throw `IllegalArgumentException` for invalid value.

Do not throw random infrastructure exceptions.

## 13.6 Side effects

None.

## 13.7 Thread safety

Converter may be reused.

Make stateless/thread-safe.

## 13.8 Example

```java
public final class CustomerIdParamConverter implements ParamConverter<CustomerId> {

    @Override
    public CustomerId fromString(String value) {
        return CustomerId.fromString(value);
    }

    @Override
    public String toString(CustomerId value) {
        return value.value();
    }
}
```

---

# 14. `ParamConverterProvider`: Registry untuk Custom Types

Interface:

```java
public interface ParamConverterProvider {
    <T> ParamConverter<T> getConverter(
        Class<T> rawType,
        Type genericType,
        Annotation[] annotations
    );
}
```

## 14.1 Called by runtime

Runtime asks registered providers:

```text
Do you have converter for rawType/genericType/annotations?
```

Provider returns converter or null.

## 14.2 Example

```java
@Provider
public final class DomainParamConverterProvider implements ParamConverterProvider {

    private static final CustomerIdParamConverter CUSTOMER_ID = new CustomerIdParamConverter();
    private static final OrderIdParamConverter ORDER_ID = new OrderIdParamConverter();

    @Override
    @SuppressWarnings("unchecked")
    public <T> ParamConverter<T> getConverter(
        Class<T> rawType,
        Type genericType,
        Annotation[] annotations
    ) {
        if (rawType.equals(CustomerId.class)) {
            return (ParamConverter<T>) CUSTOMER_ID;
        }
        if (rawType.equals(OrderId.class)) {
            return (ParamConverter<T>) ORDER_ID;
        }
        return null;
    }
}
```

## 14.3 rawType

The erased class.

Example:

```text
CustomerId.class
List.class
```

## 14.4 genericType

Generic type info.

Example:

```text
List<CustomerId>
```

## 14.5 annotations

Annotations on injection target.

Useful for annotation-aware conversion.

## 14.6 Provider ordering

If multiple providers can convert same type, ordering/priority may matter.

Avoid multiple providers for same type.

## 14.7 Registration

Must be registered/discovered as provider.

---

# 15. Provider Registration dan Discovery

`ParamConverterProvider` is JAX-RS provider.

## 15.1 Annotation

```java
@Provider
public class DomainParamConverterProvider implements ParamConverterProvider { ... }
```

## 15.2 Automatic scanning

If scanning enabled, `@Provider` discovered.

## 15.3 Explicit registration

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            CustomerResource.class,
            DomainParamConverterProvider.class
        );
    }
}
```

## 15.4 CDI provider

Provider may be CDI-managed in Jakarta EE runtime.

Check implementation behavior.

## 15.5 Missing provider symptom

Your custom type may fall back to:

- constructor;
- `valueOf`;
- `fromString`;
- or fail no conversion.

## 15.6 Test startup

Create test endpoint using custom type and call via HTTP.

## 15.7 Recommendation

Register domain converter provider explicitly in large apps.

---

# 16. Priority: ParamConverter Harus Diutamakan

Spec/API says if `ParamConverter` is available for type, it must be preferred over other conversion strategies.

## 16.1 Example

```java
public record CustomerId(String value) {
    public static CustomerId fromString(String raw) {
        return new CustomerId("STATIC-" + raw);
    }
}
```

Provider:

```java
ParamConverter<CustomerId> returns new CustomerId("PROVIDER-" + raw)
```

Injected value should use provider result.

## 16.2 Why useful

Provider can centralize parsing rules.

## 16.3 Why dangerous

A provider can change behavior globally.

## 16.4 Governance

For shared libraries, changing converter is breaking behavior.

## 16.5 Test

Test actual HTTP conversion.

## 16.6 Documentation

Document converters in architecture/API standards.

---

# 17. `@ParamConverter.Lazy`: Default Value Conversion Timing

`ParamConverter.Lazy` is an annotation on converter implementation class.

It changes conversion timing for default values.

## 17.1 Default behavior

Default values are converted as early as possible, generally at deployment time.

## 17.2 Lazy behavior

If converter implementation class annotated with:

```java
@ParamConverter.Lazy
```

then default value conversion should happen only when value is actually required/injected.

## 17.3 Example

```java
@ParamConverter.Lazy
public final class TenantAwareDateConverter implements ParamConverter<LocalDate> {
    ...
}
```

## 17.4 Why need lazy?

If conversion depends on runtime context that is not available at deployment time.

But be careful: converters should not depend heavily on request context.

## 17.5 Use cases

- default value parsing expensive;
- default values depend on state available later;
- avoid deployment failure for optional defaults until endpoint used.

## 17.6 Caution

Lazy conversion can move failure from deployment to request time.

This may hide bad defaults until production traffic.

## 17.7 Recommendation

Prefer eager default validation for safety.

Use `@Lazy` only with clear reason.

---

# 18. Default Value Conversion: Deployment Time vs Injection Time

## 18.1 Eager conversion benefit

Invalid default detected at startup/deploy.

Example:

```java
@QueryParam("date")
@DefaultValue("not-a-date")
LocalDate date
```

If converter eager, app may fail early.

## 18.2 Lazy conversion benefit

App deploys even if endpoint/default not used.

## 18.3 Production preference

Fail fast for invalid config/default.

Thus avoid `@Lazy` unless needed.

## 18.4 Testing

Test endpoint default behavior:

```text
GET /reports
```

without date.

## 18.5 Default values as API contract

Changing default changes API behavior.

Version/document it.

## 18.6 Rule

```text
Default value conversion should be boring, deterministic, and tested.
```

---

# 19. Typed Domain IDs: `CustomerId`, `OrderId`, `TenantId`

Typed IDs prevent mix-ups.

## 19.1 Bad

```java
service.getOrder(customerId, orderId);
```

Both Strings.

Easy to swap.

## 19.2 Better

```java
service.getOrder(CustomerId customerId, OrderId orderId);
```

## 19.3 Value object

```java
public record OrderId(String value) {

    private static final Pattern PATTERN = Pattern.compile("ORD-[0-9]{8}");

    public OrderId {
        Objects.requireNonNull(value, "value");
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid order id");
        }
    }

    public static OrderId fromString(String raw) {
        return new OrderId(raw);
    }
}
```

## 19.4 Benefits

- type safety;
- centralized syntax validation;
- cleaner service API;
- easier audit/logging policy;
- more expressive code.

## 19.5 Wire format

The value object defines wire format:

```text
ORD-00000001
```

That is API contract.

## 19.6 Migration caution

Changing ID format breaks clients and regex/routes.

## 19.7 Recommendation

Use typed IDs for important domain identifiers.

---

# 20. Converter untuk Strongly Typed ID

## 20.1 Direct static factory

If `CustomerId.fromString` exists, no provider needed.

```java
@PathParam("customerId") CustomerId customerId
```

## 20.2 ParamConverter

Use provider if you need:

- richer error type;
- centralized ID parsing;
- annotation metadata;
- multiple wire formats;
- avoid static factory API exposure.

## 20.3 Converter code

```java
public final class CustomerIdConverter implements ParamConverter<CustomerId> {

    @Override
    public CustomerId fromString(String value) {
        try {
            return CustomerId.fromString(value);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Invalid customerId", ex);
        }
    }

    @Override
    public String toString(CustomerId value) {
        return value.value();
    }
}
```

## 20.4 Provider

```java
@Provider
public final class DomainIdConverterProvider implements ParamConverterProvider {

    private static final CustomerIdConverter CUSTOMER_ID = new CustomerIdConverter();

    @Override
    @SuppressWarnings("unchecked")
    public <T> ParamConverter<T> getConverter(
        Class<T> rawType,
        Type genericType,
        Annotation[] annotations
    ) {
        if (rawType.equals(CustomerId.class)) {
            return (ParamConverter<T>) CUSTOMER_ID;
        }
        return null;
    }
}
```

## 20.5 Error details

Converter lacks parameter name unless provider reads annotations or exception mapper has context.

You may rely on exception mapper with request info.

## 20.6 Testing

HTTP test:

```text
GET /customers/CUST-000001 -> 200/404 depending existence
GET /customers/bad -> 400 invalid parameter
```

## 20.7 Distinguish invalid vs not found

Invalid syntax:

```text
400
```

Valid syntax but no resource:

```text
404
```

---

# 21. Generic Base Converter: Kapan Membantu, Kapan Membahayakan

You may want generic converter for many IDs.

## 21.1 Interface

```java
public interface StringValueObject {
    String value();
}
```

## 21.2 Generic factory registry

```java
private final Map<Class<?>, Function<String, ?>> factories = Map.of(
    CustomerId.class, CustomerId::fromString,
    OrderId.class, OrderId::fromString
);
```

## 21.3 Provider

```java
if (factories.containsKey(rawType)) {
    Function<String, ?> factory = factories.get(rawType);
    return (ParamConverter<T>) new StringValueObjectConverter<>(factory);
}
```

## 21.4 Pros

- less boilerplate;
- consistent error handling;
- centralized list.

## 21.5 Cons

- reflection/generic complexity;
- error messages less specific;
- too magical;
- harder debugging;
- accidental broad matching.

## 21.6 Recommendation

For critical IDs, explicit converters are clearer.

Generic provider acceptable if simple and well-tested.

## 21.7 Do not use reflection-heavy cleverness

Avoid scanning every record with `fromString`.

Explicit registration is safer.

---

# 22. Date/Time Conversion: `LocalDate`, `Instant`, `OffsetDateTime`

Date/time parameters are common.

## 22.1 Query date

```text
GET /reports?from=2026-01-01&to=2026-01-31
```

## 22.2 LocalDate converter

```java
public final class LocalDateParamConverter implements ParamConverter<LocalDate> {

    @Override
    public LocalDate fromString(String value) {
        return LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE);
    }

    @Override
    public String toString(LocalDate value) {
        return DateTimeFormatter.ISO_LOCAL_DATE.format(value);
    }
}
```

## 22.3 Instant converter

Use ISO instant:

```text
2026-06-12T10:15:30Z
```

```java
Instant.parse(value)
```

## 22.4 OffsetDateTime

Use ISO offset datetime:

```text
2026-06-12T17:15:30+07:00
```

## 22.5 Avoid ambiguous date

Bad:

```text
12/06/2026
```

Could mean DD/MM or MM/DD.

## 22.6 Time zone policy

Decide:

- date-only means local business date?
- timestamp must include offset?
- server assumes UTC?
- user locale matters?

## 22.7 Recommendation

Use ISO-8601 formats.

Document timezone semantics.

## 22.8 Cross-field validation

Converter parses individual dates.

Validation checks:

```text
from <= to
range <= 90 days
```

---

# 23. Locale, Time Zone, dan Date Parsing Policy

## 23.1 Locale

Parsing numbers/dates with locale can be dangerous.

API should use locale-invariant wire format.

## 23.2 Date

Use:

```text
YYYY-MM-DD
```

for dates.

## 23.3 Time instant

Use:

```text
2026-06-12T10:15:30Z
```

for instant.

## 23.4 Offset datetime

Use:

```text
2026-06-12T17:15:30+07:00
```

if local offset matters.

## 23.5 Time zone header?

If client sends local date range, timezone may come from:

- tenant config;
- user profile;
- explicit query/header.

Do not guess silently.

## 23.6 Business date

For systems like licensing/banking, date-only often means jurisdiction/business timezone.

Document.

## 23.7 Converter rule

Converter should parse format, not decide business timezone unless type encodes it.

## 23.8 Better types

```java
BusinessDateRange
```

parsed/validated in query object/service, not only converter.

---

# 24. Numeric Value Objects: `PageSize`, `Limit`, `Amount`

## 24.1 PageSize

```java
public record PageSize(int value) {
    public static PageSize fromString(String raw) {
        int value = Integer.parseInt(raw);
        if (value < 1 || value > 100) {
            throw new IllegalArgumentException("size must be between 1 and 100");
        }
        return new PageSize(value);
    }
}
```

## 24.2 Limit

```java
@QueryParam("limit")
@DefaultValue("20")
Limit limit
```

## 24.3 Amount

Do not parse money casually.

Use `BigDecimal`, currency, scale policy.

```java
public record MoneyAmount(BigDecimal value) { ... }
```

## 24.4 Validation placement

Numeric range can be:

- converter;
- Jakarta Validation;
- query object normalization.

## 24.5 Recommendation

For reusable numeric boundary value with fixed invariant, value object is good.

For endpoint-specific bound, use Jakarta Validation.

Example:

```java
@Max(50)
@QueryParam("size")
int size
```

## 24.6 Avoid double policy

Do not put max 100 in converter and max 50 in endpoint without clarity.

---

# 25. Sort, Filter, Include: Converter atau Parser?

## 25.1 Sort example

```text
?sort=createdAt:desc&sort=name:asc
```

Target:

```java
@QueryParam("sort")
List<String> sort
```

Then parse in query object.

## 25.2 Could use converter?

```java
@QueryParam("sort")
List<SortSpec> sort
```

if each query param value is one sort spec.

## 25.3 But complex grammar

For grammar like:

```text
?filter=status:eq:ACTIVE;createdAt:gte:2026-01-01
```

a converter may become too complex.

## 25.4 Parser object

Better:

```java
FilterExpression.parse(rawFilters)
```

inside query object.

## 25.5 Why?

- need allowed fields;
- need endpoint-specific policy;
- need better error reporting;
- may need multiple params together.

## 25.6 Rule

Use converter for simple independent value.

Use parser/query object for compound grammar.

## 25.7 Include enum

This is good converter target:

```java
@QueryParam("include")
Set<CustomerInclude> includes
```

if wire values simple.

---

# 26. Collection Conversion: Standard vs Runtime Extension

Standard JAX-RS supports collection/array injection where element type is convertible.

Example:

```java
@QueryParam("status")
List<CustomerStatus> statuses
```

with repeated query params:

```text
?status=active&status=suspended
```

## 26.1 Element converter

Each individual string value is converted to `CustomerStatus`.

## 26.2 Not standard comma splitting

Do not assume:

```text
?status=active,suspended
```

becomes two elements.

## 26.3 RESTEasy extension

RESTEasy documents an extension where `ParamConverter` semantics can parse one string into multi-valued structures.

That is not portable standard behavior.

## 26.4 Portability decision

If you use runtime extension:

- document;
- test;
- isolate;
- accept migration cost.

## 26.5 Standard approach

Prefer repeated params for multi-value:

```text
?status=active&status=suspended
```

## 26.6 Alternative

If you want comma style, parse manually in query object:

```java
@QueryParam("status") String statusCsv
```

then:

```java
StatusList.parseCsv(statusCsv)
```

## 26.7 Recommendation

For portable JAX-RS, use repeated query params.

---

# 27. Comma-Separated Values: Jangan Asumsikan Otomatis

## 27.1 Ambiguous input

```text
?tag=a,b,c
```

Could be:

- one value `"a,b,c"`;
- three values `a`, `b`, `c`.

## 27.2 HTTP query syntax does not impose one interpretation

Application contract decides.

## 27.3 JAX-RS default collection injection

Repeated params are the natural multivalued map model.

```text
?tag=a&tag=b&tag=c
```

## 27.4 If choosing CSV

Define:

- escaping rules;
- whitespace trim;
- empty item behavior;
- duplicate behavior;
- max items;
- invalid item error.

## 27.5 Parser example

```java
public static List<Tag> parseCsv(String raw) {
    if (raw == null || raw.isBlank()) {
        return List.of();
    }
    return Arrays.stream(raw.split(","))
        .map(String::trim)
        .filter(s -> !s.isEmpty())
        .map(Tag::fromString)
        .toList();
}
```

## 27.6 Edge cases

```text
?tag=a,,b
?tag=a,%20b
?tag=a%2Cb
```

## 27.7 Recommendation

Use repeated params unless clients strongly prefer CSV.

---

# 28. Generic Type dan Annotation Metadata dalam `getConverter`

`getConverter` receives:

```java
Class<T> rawType
Type genericType
Annotation[] annotations
```

## 28.1 rawType

For:

```java
@QueryParam("id") CustomerId id
```

rawType:

```text
CustomerId.class
```

## 28.2 genericType

For:

```java
@QueryParam("ids") List<CustomerId> ids
```

rawType might be `List.class`, genericType contains `List<CustomerId>`.

But standard collection handling usually applies converter to element type, not collection type.

## 28.3 annotations

Annotations present on injection target.

Example:

```java
@QueryParam("date")
@DateFormat("yyyyMMdd")
LocalDate date
```

Provider can inspect `@DateFormat`.

## 28.4 Annotation-aware converter

Return different converter based on annotation.

## 28.5 Caution

Too much annotation-driven parsing can become hard to document.

## 28.6 Useful cases

- custom date format;
- ID format variant;
- case sensitivity;
- enum alias strategy;
- min/max policy? Usually validation better.

## 28.7 Recommendation

Use annotations sparingly for syntax formatting, not business logic.

---

# 29. Annotation-Aware Converter

## 29.1 Custom annotation

```java
@Target({PARAMETER, FIELD})
@Retention(RUNTIME)
public @interface IsoDateOnly {
}
```

## 29.2 Provider reads annotations

```java
private boolean hasAnnotation(Annotation[] annotations, Class<?> type) {
    return Arrays.stream(annotations)
        .anyMatch(a -> a.annotationType().equals(type));
}
```

## 29.3 Converter selection

```java
if (rawType.equals(LocalDate.class) && hasAnnotation(annotations, IsoDateOnly.class)) {
    return (ParamConverter<T>) ISO_LOCAL_DATE_CONVERTER;
}
```

## 29.4 Alternative annotation with value

```java
@Target({PARAMETER, FIELD})
@Retention(RUNTIME)
public @interface DatePattern {
    String value();
}
```

## 29.5 Warning

Date pattern in endpoint can fragment API consistency.

Prefer one standard format globally.

## 29.6 Good use

Interop with legacy endpoint requiring non-standard date format.

## 29.7 Document

Annotation-driven wire format must appear in API docs.

---

# 30. Error Handling: Exception dari Converter Menjadi Apa?

Converter may throw:

```java
IllegalArgumentException
```

or other runtime exceptions.

## 30.1 Runtime wrapping

JAX-RS runtime may wrap conversion errors in exceptions such as `BadRequestException`, `ParamException` in some implementations, or other implementation-specific types.

## 30.2 You need error mapper

To produce stable error body:

```json
{
  "type": "https://example.com/problems/invalid-parameter",
  "title": "Invalid parameter",
  "status": 400,
  "code": "INVALID_PARAMETER",
  "parameter": "customerId",
  "location": "path",
  "correlationId": "..."
}
```

## 30.3 Challenge

Converter often does not know parameter name/location.

Exception mapper may need runtime exception details or context.

## 30.4 Implementation-specific exceptions

Jersey/RESTEasy may expose parameter info differently.

Portability issue.

## 30.5 Portable fallback

Return generic invalid request error but still log details internally.

## 30.6 Better error design

For critical params, parse inside `@BeanParam`/query object if you need precise error detail and portability.

## 30.7 Recommendation

Use converter for common syntax.

Use custom validation layer for rich per-param error details where needed.

---

# 31. Error Taxonomy untuk Parameter Conversion

Define categories:

## 31.1 Invalid path parameter

```text
INVALID_PATH_PARAMETER
```

Example:

```text
/customer/bad-id
```

## 31.2 Invalid query parameter

```text
INVALID_QUERY_PARAMETER
```

Example:

```text
?page=abc
```

## 31.3 Invalid header

```text
INVALID_HEADER
```

Example:

```text
If-Match malformed
```

## 31.4 Invalid cookie

```text
INVALID_COOKIE
```

## 31.5 Invalid matrix parameter

```text
INVALID_MATRIX_PARAMETER
```

## 31.6 Missing required parameter

```text
MISSING_REQUIRED_PARAMETER
```

## 31.7 Duplicate parameter

```text
DUPLICATE_PARAMETER
```

## 31.8 Unsupported value

```text
UNSUPPORTED_PARAMETER_VALUE
```

For enum outside allowed set.

## 31.9 Error response fields

Useful fields:

- code;
- parameter;
- location;
- reason;
- allowed values;
- correlation ID.

## 31.10 Avoid raw invalid value in response if sensitive

Do not echo secrets/tokens.

---

# 32. Problem Details untuk Conversion Error

Use `application/problem+json`.

## 32.1 Example

```json
{
  "type": "https://api.example.com/problems/invalid-parameter",
  "title": "Invalid request parameter",
  "status": 400,
  "code": "INVALID_QUERY_PARAMETER",
  "detail": "Parameter 'page' must be a positive integer.",
  "parameter": "page",
  "location": "query",
  "correlationId": "abc-123"
}
```

## 32.2 Multiple errors

For validation, multiple violations possible.

For conversion, runtime may stop at first invalid param.

If you need aggregate errors, parse/validate in DTO/query object manually.

## 32.3 Do not expose stack trace

Never.

## 32.4 Include allowed values

For enum:

```json
{
  "allowedValues": ["active", "suspended", "closed"]
}
```

## 32.5 Localization

Message can be localized, but code stable.

## 32.6 Logging

Log raw detail internally only if safe.

---

# 33. Conversion vs Validation vs Authorization vs Lookup

## 33.1 Conversion

```text
"CUST-000001" has valid customer ID syntax.
```

## 33.2 Validation

```text
size must be 1..100
from <= to
include contains allowed values
```

## 33.3 Lookup

```text
customer CUST-000001 exists.
```

## 33.4 Authorization

```text
current user can access customer CUST-000001.
```

## 33.5 Business rule

```text
customer status allows operation.
```

## 33.6 Correct layering

```java
public Response get(@PathParam("customerId") CustomerId customerId) {
    Customer customer = service.requireAccessibleCustomer(customerId, currentUser);
    ...
}
```

## 33.7 Error mapping

- invalid syntax → 400;
- not found → 404;
- forbidden → 403 or hidden 404;
- invalid business state → 409;
- stale condition → 412.

## 33.8 Rule

Do not collapse all into conversion.

---

# 34. Anti-Pattern: Converter Melakukan DB Lookup

## 34.1 Bad code

```java
public final class CustomerParamConverter implements ParamConverter<Customer> {

    @Inject CustomerRepository repository;

    @Override
    public Customer fromString(String value) {
        return repository.findById(value)
            .orElseThrow(NotFoundException::new);
    }
}
```

## 34.2 Problems

- converter now depends on DB;
- conversion may happen outside transaction;
- no authorization;
- no clear service boundary;
- cannot easily test;
- hidden performance cost;
- repeated conversion may query multiple times;
- resource signature hides request semantics.

## 34.3 Better

```java
public Response get(@PathParam("customerId") CustomerId customerId) {
    Customer customer = customerService.getAccessible(customerId, currentUser);
    ...
}
```

## 34.4 If you want convenience

Use service helper:

```java
Customer customer = customerAccess.require(customerId, security);
```

inside service/resource boundary.

## 34.5 Rule

```text
A converter should never require transaction, repository, authorization, or remote call.
```

---

# 35. Security Concerns: Length, Encoding, Regex, ReDoS, Secret Leakage

## 35.1 Length limits

Attackers can send very long param.

Check max length before heavy regex.

## 35.2 Regex ReDoS

Avoid vulnerable regex with catastrophic backtracking.

Bad patterns with nested quantifiers can be attacked.

## 35.3 Precompile Pattern

```java
private static final Pattern PATTERN = Pattern.compile("CUST-[0-9]{6}");
```

Do not compile regex per request.

## 35.4 Encoding

Encoded values may hide dangerous characters.

Test:

```text
..%2F
%252F
```

## 35.5 Secret leakage

Do not echo invalid sensitive header value.

Example:

```text
Authorization
API key
token
password
```

## 35.6 Header/cookie parsing

Treat as untrusted.

## 35.7 Exception messages

Converter exception message may reach logs/response.

Make safe messages.

## 35.8 Rule

Converters are part of input attack surface.

---

# 36. Performance Concerns: Allocation, Regex Compile, Object Creation

## 36.1 Conversion happens per request

Hot endpoints convert params frequently.

## 36.2 Avoid per-call regex compile

Bad:

```java
value.matches("CUST-[0-9]{6}")
```

`String.matches` compiles pattern each call.

Better:

```java
private static final Pattern PATTERN = Pattern.compile("CUST-[0-9]{6}");
```

## 36.3 Avoid heavy parsing

For simple IDs, keep parse cheap.

## 36.4 Avoid DB/network

Already covered.

## 36.5 Allocation

Value objects allocate, but usually fine.

Don't sacrifice correctness prematurely.

## 36.6 Cache?

Do not cache arbitrary converted user params globally unless bounded and safe.

## 36.7 Benchmark only if hot

Most bottlenecks are DB/network/JSON, not ID conversion.

## 36.8 Rule

Fast enough, pure, predictable.

---

# 37. Thread Safety dan Converter Lifecycle

## 37.1 Providers often singleton-like

A `ParamConverterProvider` may be reused across requests.

## 37.2 Converter instances

You may return same singleton converter.

```java
private static final CustomerIdConverter CUSTOMER_ID = new CustomerIdConverter();
```

## 37.3 Make converters stateless

No mutable per-request state.

## 37.4 Thread-safe formatters

Java time `DateTimeFormatter` is immutable/thread-safe.

Old `SimpleDateFormat` is not thread-safe.

Do not use shared `SimpleDateFormat`.

## 37.5 Avoid storing annotation-specific state in shared converter unless immutable

If converter created based on annotation, create immutable converter with final formatter.

## 37.6 Rule

Assume converter/provider can be called concurrently.

---

# 38. CDI Injection dalam Provider/Converter

## 38.1 Provider injection

In Jakarta EE, providers can often be CDI-managed.

```java
@Provider
@ApplicationScoped
public class DomainParamConverterProvider implements ParamConverterProvider {
    @Inject SomeConfig config;
}
```

## 38.2 Converter injection

Converter itself is usually object returned by provider, not necessarily CDI-managed.

If converter needs dependencies, provider can construct it with dependency values.

## 38.3 Keep dependencies minimal

Converters should not need repositories/services.

Config for formatting may be okay if stable.

## 38.4 Request-scoped dependencies

Avoid request-scoped injection in converters.

It complicates lifecycle.

## 38.5 Runtime differences

CDI integration of providers can vary by runtime/registration.

Test on target runtime.

## 38.6 Recommendation

Prefer stateless converters.

If config needed, inject into provider and create immutable converters.

---

# 39. Testing Converter

## 39.1 Unit tests

Test converter directly.

Example cases:

```text
valid
invalid
null
empty
lowercase
too long
encoded
boundary length
```

## 39.2 Property-like tests

For ID formats:

```text
toString(fromString(x)) = canonical x
```

for valid values.

## 39.3 Error tests

Assert exception type and safe message.

## 39.4 Thread-safety tests

For date converters with custom formatters.

## 39.5 Performance sanity

For regex-heavy converter, test long malicious input.

## 39.6 Example

```java
@Test
void parsesValidCustomerId() {
    CustomerId id = converter.fromString("CUST-000001");
    assertEquals("CUST-000001", id.value());
}
```

## 39.7 Invalid

```java
assertThrows(IllegalArgumentException.class,
    () -> converter.fromString("bad"));
```

---

# 40. Runtime Integration Tests

Unit tests are not enough.

## 40.1 Need HTTP runtime tests

Because runtime decides:

- provider discovery;
- strategy priority;
- default value conversion timing;
- exception mapping;
- collection conversion;
- annotation metadata;
- CDI injection.

## 40.2 Test endpoint

```java
@Path("/test/customers/{customerId}")
public class CustomerIdTestResource {

    @GET
    public Response get(@PathParam("customerId") CustomerId id) {
        return Response.ok(Map.of("id", id.value())).build();
    }
}
```

## 40.3 Test valid

```http
GET /test/customers/CUST-000001
→ 200
```

## 40.4 Test invalid

```http
GET /test/customers/bad
→ 400 problem+json
```

## 40.5 Test default

```java
@QueryParam("size")
@DefaultValue("20")
PageSize size
```

Call without `size`.

## 40.6 Test collection

```text
?status=active&status=closed
```

## 40.7 Test provider registered

If converter not registered, test fails.

## 40.8 Run on target runtime

JerseyTest may not equal production RESTEasy/Liberty/Quarkus.

---

# 41. Observability untuk Conversion Errors

## 41.1 Metrics

Track conversion errors with low-cardinality labels:

```text
rest_parameter_errors_total{
  location="query",
  parameter="page",
  reason="conversion"
}
```

## 41.2 Avoid raw values

Bad:

```text
value="very-long-attacker-string"
```

## 41.3 Logs

Log:

- correlation ID;
- parameter name;
- location;
- reason;
- route template;
- safe truncated value if allowed.

## 41.4 Traces

Add event:

```text
invalid_parameter
```

with safe attributes.

## 41.5 Alerting

Do not alert on every invalid parameter.

High spike may indicate client bug or attack.

## 41.6 Dashboard

Track top invalid params by endpoint.

## 41.7 Error contract

Expose stable code to client.

---

# 42. Implementation Differences: Jersey, RESTEasy, CXF, Quarkus

## 42.1 Standard behavior

All compatible implementations should support `ParamConverter`.

## 42.2 Diagnostics differ

- exception class wrapping;
- error messages;
- provider priority diagnostics;
- default value conversion timing logs;
- collection extension behavior.

## 42.3 RESTEasy extension

RESTEasy documents extension allowing converter semantics to parse a single String into multi-valued structures such as list/set/array.

This is not portable standard.

## 42.4 Jersey

Jersey has rich provider ecosystem and may expose detailed parameter exception types.

## 42.5 CXF

CXF has its own extension/diagnostic behaviors.

## 42.6 Quarkus

Build-time indexing and RESTEasy Reactive may affect provider discovery/registration patterns.

## 42.7 Rule

If using non-standard converter behavior, isolate and document.

## 42.8 Migration tests

When changing runtime, run conversion contract tests.

---

# 43. Migration `javax.ws.rs.ext` ke `jakarta.ws.rs.ext`

Legacy imports:

```java
import javax.ws.rs.ext.ParamConverter;
import javax.ws.rs.ext.ParamConverterProvider;
import javax.ws.rs.ext.Provider;
```

Modern imports:

```java
import jakarta.ws.rs.ext.ParamConverter;
import jakarta.ws.rs.ext.ParamConverterProvider;
import jakarta.ws.rs.ext.Provider;
```

## 43.1 Mixed namespace trap

A `javax.ws.rs.ext.ParamConverterProvider` is not a `jakarta.ws.rs.ext.ParamConverterProvider`.

It will not work in Jakarta REST 4 runtime.

## 43.2 Third-party providers

Check libraries:

- old Jersey provider;
- old RESTEasy provider;
- old OpenAPI tooling;
- old custom jars.

## 43.3 Build scan

Search:

```text
javax.ws.rs.ext
javax.ws.rs
```

## 43.4 Tests

Conversion test catches missing migrated provider.

## 43.5 Maven dependency

Use:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

or Jakarta EE API BOM/runtime-provided.

## 43.6 Rule

Namespace migration must include providers, not only resources.

---

# 44. Design Guidelines

## 44.1 Use typed IDs

For important domain IDs.

## 44.2 Keep converter pure

No IO, DB, remote call, auth.

## 44.3 Avoid dual factories

Do not define both `valueOf` and `fromString` unless intended.

## 44.4 Prefer ISO formats

For date/time.

## 44.5 Enum wire values explicit

Do not expose enum names accidentally for public API.

## 44.6 Use `@BeanParam` for compound parsing

Sort/filter/date range.

## 44.7 Map errors consistently

Do not rely on default runtime error body.

## 44.8 Test via runtime

Provider discovery and priority require integration tests.

## 44.9 Avoid runtime-specific extensions in public library

Unless documented.

## 44.10 Make conversion observable

Count invalid parameter errors safely.

---

# 45. Common Failure Modes

## 45.1 Converter not registered

Runtime falls back or fails.

## 45.2 `javax` provider in `jakarta` runtime

Provider ignored/incompatible.

## 45.3 Both `valueOf` and `fromString`

Unexpected factory used.

## 45.4 Enum lowercase rejected

Client sends `active`, enum expects `ACTIVE`.

## 45.5 `LocalDate` conversion missing

No converter.

## 45.6 Default value invalid

App fails deployment or endpoint fails later.

## 45.7 `@Lazy` hides invalid default until runtime

Late failure.

## 45.8 Converter does DB lookup

Performance/security/layering issue.

## 45.9 Collection comma assumption

Client sends CSV, server treats as one value.

## 45.10 Regex compiled per request

Performance waste.

## 45.11 Non-thread-safe formatter

Concurrency bug.

## 45.12 Raw invalid value leaked

PII/security issue.

## 45.13 Runtime-specific extension used unknowingly

Migration break.

---

# 46. Best Practices

## 46.1 Define conversion policy in API standards

IDs, enums, dates, booleans, lists.

## 46.2 Use value objects for domain IDs

Avoid stringly typed IDs.

## 46.3 Use converter for independent syntax

Not business lookup.

## 46.4 Use query object parser for compound grammar

Sort/filter/date range.

## 46.5 Use ISO-8601

For dates/times.

## 46.6 Use stable enum wire values

Prefer `active` over Java enum names if public API.

## 46.7 Fail fast on invalid defaults

Avoid `@Lazy` unless necessary.

## 46.8 Provide consistent error contract

Problem Details.

## 46.9 Test invalid inputs

Not just happy path.

## 46.10 Audit providers during migration

`javax` → `jakarta`.

---

# 47. Anti-Patterns

## 47.1 Stringly typed everything

No type safety.

## 47.2 Converter as repository

DB lookup in converter.

## 47.3 Converter as authorization layer

Security hidden in parsing.

## 47.4 Too-clever generic reflection converter

Hard to debug.

## 47.5 Per-endpoint inconsistent date formats

Client confusion.

## 47.6 Enum name as public contract accidentally

Renaming enum breaks API.

## 47.7 Silent fallback default on invalid input

Hides client bug.

## 47.8 Logging raw bad value

Potential sensitive data leak.

## 47.9 Using RESTEasy multi-valued converter extension without documenting

Portability trap.

## 47.10 No runtime tests

Provider missing only discovered in production.

---

# 48. Production Checklist

## 48.1 Conversion design

- [ ] Important IDs are typed.
- [ ] Converters are pure/fast/stateless.
- [ ] No DB/remote/security lookup in converter.
- [ ] Date/time formats documented.
- [ ] Enum wire values documented.
- [ ] CSV vs repeated params policy documented.

## 48.2 Provider registration

- [ ] Providers annotated/registered.
- [ ] Providers namespace is `jakarta`.
- [ ] CDI injection tested if used.
- [ ] No duplicate converters for same type.
- [ ] Runtime warnings checked.

## 48.3 Defaults

- [ ] `@DefaultValue` values valid.
- [ ] Default behavior tested.
- [ ] `@Lazy` justified if used.
- [ ] Defaults documented as API behavior.

## 48.4 Errors

- [ ] Conversion errors map to 400.
- [ ] Error body stable.
- [ ] Parameter name/location included where possible.
- [ ] Sensitive values not echoed.
- [ ] Metrics/logs safe.

## 48.5 Testing

- [ ] Unit tests for converters.
- [ ] Runtime tests for injection.
- [ ] Invalid input tests.
- [ ] Collection conversion tests.
- [ ] Migration tests for `javax`/`jakarta`.

## 48.6 Security/performance

- [ ] Max length checked for complex params.
- [ ] Regex precompiled/safe.
- [ ] Formatters thread-safe.
- [ ] No high-cardinality labels.

---

# 49. Latihan

## Latihan 1 — Typed ID

Buat:

```java
CustomerId
OrderId
TenantId
```

dengan wire format:

```text
CUST-000001
ORD-2026-000001
TNT-sg-gov
```

Implement `fromString` dan tests.

## Latihan 2 — ParamConverterProvider

Buat `DomainParamConverterProvider` yang support ketiga ID tersebut.

Register di `Application`.

Test via HTTP.

## Latihan 3 — Enum Wire Value

Buat enum:

```java
CustomerStatus ACTIVE/SUSPENDED/CLOSED
```

Wire value:

```text
active
suspended
closed
```

Implement converter case-insensitive.

## Latihan 4 — LocalDate Converter

Support query:

```text
GET /reports?from=2026-01-01&to=2026-01-31
```

Invalid date should return problem+json 400.

## Latihan 5 — Default Value

```java
@QueryParam("size")
@DefaultValue("20")
PageSize size
```

Test missing, valid, too high, invalid string.

## Latihan 6 — Conversion vs Lookup

Refactor endpoint:

```java
@PathParam("customerId") Customer customer
```

to:

```java
@PathParam("customerId") CustomerId customerId
```

Move lookup/authorization to service.

## Latihan 7 — CSV vs Repeated

Implement both styles in separate endpoints.

Document behavior.

Test edge cases.

## Latihan 8 — Error Mapper

Implement mapper for conversion errors that returns Problem Details.

Include:

- code;
- parameter;
- location;
- correlationId.

## Latihan 9 — Migration Audit

Search project for:

```text
javax.ws.rs.ext.ParamConverter
javax.ws.rs.ext.ParamConverterProvider
```

Plan migration to `jakarta`.

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `ParamConverter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/paramconverter

2. Jakarta RESTful Web Services 4.0 — `ParamConverterProvider` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/paramconverterprovider

3. Jakarta RESTful Web Services 4.0 — `ParamConverter.Lazy` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/paramconverter.lazy

4. Jakarta RESTful Web Services 4.0 — `QueryParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/queryparam

5. Jakarta RESTful Web Services 4.0 — `PathParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/pathparam

6. Jakarta RESTful Web Services 4.0 — `HeaderParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/headerparam

7. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

8. RESTEasy User Guide — String marshalling for String based `@*Param`  
   https://docs.resteasy.dev/5.0/userguide/html/ch28.html

9. Maven Central — `jakarta.ws.rs-api` 4.0.0  
   https://central.sonatype.com/artifact/jakarta.ws.rs/jakarta.ws.rs-api/4.0.0/jar

10. RFC 9457 — Problem Details for HTTP APIs  
    https://www.rfc-editor.org/rfc/rfc9457.html

---

# 51. Penutup

Parameter conversion adalah bagian kecil yang berdampak besar.

Mental model utama:

```text
HTTP string
  ↓
conversion
  ↓
typed boundary value
  ↓
validation
  ↓
service lookup
  ↓
authorization
  ↓
business operation
```

JAX-RS menyediakan banyak cara:

```java
String constructor
valueOf(String)
fromString(String)
ParamConverter<T>
ParamConverterProvider
ParamConverter.Lazy
```

Tetapi top-tier engineer tahu batasnya:

```text
Converter parses syntax.
It does not load entities.
It does not authorize.
It does not call remote services.
It does not hide business logic.
```

Gunakan converter untuk membuat resource method lebih kuat:

```java
public Response get(
    @PathParam("customerId") CustomerId customerId,
    @QueryParam("from") LocalDate from,
    @QueryParam("status") Set<CustomerStatus> statuses
)
```

bukan:

```java
public Response get(String customerId, String from, String status)
```

Prinsip final:

```text
A clean converter turns untrusted HTTP text into safe typed input.
A bad converter turns routing into hidden business logic.
```

Part berikutnya:

```text
Bagian 008 — Context Injection: @Context, UriInfo, HttpHeaders, Request, SecurityContext, Providers, ResourceContext
```

Kita akan membedah request/runtime context injection, conditional requests, headers negotiation, security principal, provider lookup, subresource instantiation, and how to use context without leaking HTTP details deep into the domain.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-006.md](./learn-jaxrs-advanced-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-008.md](./learn-jaxrs-advanced-part-008.md)
