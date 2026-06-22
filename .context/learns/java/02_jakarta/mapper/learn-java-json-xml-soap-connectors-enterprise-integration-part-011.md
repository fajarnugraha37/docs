# learn-java-json-xml-soap-connectors-enterprise-integration — Part 011
# JSON Security & Robustness

> Seri: Java JSON, XML, SOAP, dan Connectors untuk engineer Java 8–25  
> Bagian: 11 dari 34  
> Topik: JSON security, robustness, parser hardening, binding safety, schema discipline, validation boundary, logging safety, dan production failure modeling

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas JSON-P dan JSON-B dari sisi model, streaming, transformasi, annotation, customization, dan desain DTO. Bagian ini sengaja berhenti dari pertanyaan “bagaimana cara convert JSON ke Java object?” dan masuk ke pertanyaan yang lebih penting di sistem production:

**Apa yang bisa salah ketika data JSON dari luar sistem dianggap terlalu jinak?**

Banyak engineer memperlakukan JSON sebagai format sederhana:

```json
{
  "name": "Alice",
  "age": 30
}
```

Lalu mental model-nya menjadi:

```text
HTTP request body → JSON parser → DTO → service method
```

Model itu terlalu dangkal. Dalam sistem enterprise, JSON adalah **input language** dari pihak luar. Setiap input language memiliki grammar, ambiguity, resource cost, edge case, dan security boundary.

Mental model yang lebih benar:

```text
Untrusted bytes
  → transport-level limits
  → character decoding
  → JSON lexical parsing
  → structure limits
  → semantic normalization
  → duplicate/unknown policy
  → binding boundary
  → validation boundary
  → authorization boundary
  → domain command
  → audit/log/event output
```

Kesalahan besar terjadi ketika beberapa layer ini dilewati karena “JSON-B/Jackson sudah bisa map otomatis”. Otomatisasi binding mempercepat development, tetapi juga mempercepat bug security jika boundary-nya tidak eksplisit.

---

## 1. Posisi JSON Security dalam Enterprise Integration

JSON security bukan hanya tentang malicious payload. Ada empat kategori besar:

1. **Parser safety**  
   Apakah parser bisa dipaksa memakai CPU/memory berlebihan?

2. **Semantic safety**  
   Apakah payload yang secara sintaks valid memiliki arti berbeda antar parser/library/system?

3. **Binding safety**  
   Apakah data dari luar bisa mengisi field yang seharusnya tidak boleh dikontrol client?

4. **Output safety**  
   Apakah JSON yang masuk kemudian bocor atau menjadi injection saat ditulis ke log, HTML, SQL, template, audit trail, atau downstream system?

JSON terlihat lebih sederhana dari XML karena tidak punya external entity, DTD, namespace, mixed content, dan schema machinery. Tetapi kesederhanaannya juga membuat banyak tim lupa mendefinisikan kontrak semantik secara ketat.

Top 1% engineer tidak bertanya:

> “Payload ini valid JSON atau tidak?”

Tapi bertanya:

> “Payload ini valid menurut grammar, limits, business semantics, authorization, compatibility policy, dan observability policy sistem kita atau tidak?”

---

## 2. JSON Bukan Object Java

JSON object dan Java object mirip secara visual, tetapi berbeda secara fundamental.

### 2.1 JSON Object

JSON object adalah kumpulan name/value pair:

```json
{
  "status": "APPROVED",
  "amount": 1000,
  "metadata": {
    "source": "portal"
  }
}
```

JSON tidak memiliki:

- class,
- access modifier,
- constructor invariant,
- method,
- enum type,
- `BigDecimal` vs `double`,
- `LocalDate` vs `Instant`,
- `Optional`,
- private field,
- validation annotation,
- domain invariant.

Semua itu adalah interpretasi Java layer.

### 2.2 Java Object

Java object punya identity, behavior, type system, constructor, method, encapsulation, dan invariant.

```java
public final class ApprovalCommand {
    private final String applicationId;
    private final BigDecimal approvedAmount;

    public ApprovalCommand(String applicationId, BigDecimal approvedAmount) {
        if (applicationId == null || applicationId.isBlank()) {
            throw new IllegalArgumentException("applicationId is required");
        }
        if (approvedAmount == null || approvedAmount.signum() < 0) {
            throw new IllegalArgumentException("approvedAmount must be positive");
        }
        this.applicationId = applicationId;
        this.approvedAmount = approvedAmount;
    }
}
```

Binding JSON langsung ke domain object sering berbahaya karena parser/binder dapat melewati intended construction model, tergantung library, visibility, reflection mode, dan framework integration.

### 2.3 Rule

Jangan jadikan JSON sebagai domain object. Jadikan JSON sebagai **external representation** yang harus melewati boundary.

```text
JSON payload
  → Request DTO
  → validation
  → authorization
  → command/factory
  → domain model
```

---

## 3. Threat Model JSON Boundary

Sebelum membahas teknik, kita definisikan threat model.

### 3.1 Actor

Payload JSON bisa datang dari:

- browser user,
- mobile app,
- external agency,
- partner API,
- internal microservice,
- message broker,
- batch file,
- admin portal,
- scheduler,
- replayed audit event,
- migration script.

Kesalahan umum: menganggap internal service selalu trusted. Dalam arsitektur modern, internal traffic tetap bisa membawa bug, stale contract, compromised credential, atau data poison dari upstream.

### 3.2 Asset yang Dilindungi

JSON boundary harus melindungi:

- database integrity,
- state machine integrity,
- authorization boundary,
- audit trail reliability,
- memory/CPU availability,
- privacy/PII,
- downstream contract compatibility,
- digital signature / hash consistency,
- compliance defensibility.

### 3.3 Attack / Failure Surface

```text
Payload size
Payload depth
Payload array cardinality
Duplicate keys
Unknown fields
Type confusion
Number precision
Date/time ambiguity
Null vs absent ambiguity
Mass assignment
Polymorphic binding
Log injection
Template injection
Downstream echo
Schema drift
Canonicalization mismatch
Lenient parser differences
```

---

## 4. Parser-Level Robustness

Parser robustness adalah pertahanan paling awal. Tujuannya bukan hanya mencegah exploit, tetapi juga mencegah sistem menjadi mahal memproses input yang seharusnya ditolak dari awal.

### 4.1 Size Limit

Setiap JSON endpoint harus punya batas ukuran request.

Contoh policy:

```text
Default API request JSON body: 1 MB
Search/filter payload: 64 KB
Bulk import metadata: 5 MB
Bulk data file: tidak lewat JSON body, gunakan upload/storage pipeline
Webhook event: 256 KB
Internal command message: 128 KB
```

Tanpa size limit, satu request dapat memaksa:

- alokasi `byte[]`,
- alokasi `char[]`,
- alokasi object tree,
- alokasi DTO graph,
- GC pressure,
- log bloat saat error,
- downstream retry amplification.

### 4.2 Depth Limit

JSON dapat dibuat sangat dalam:

```json
{"a":{"a":{"a":{"a":{"a":{"a":"boom"}}}}}}
```

Masalahnya:

- recursive parser bisa stack overflow,
- object model membentuk banyak nested object,
- validation traversal menjadi mahal,
- error path menjadi panjang,
- JSON Pointer/Patch operation bisa jadi mahal.

Policy yang baik:

```text
Maximum JSON nesting depth: 32 or 64 for normal API
Maximum JSON nesting depth: lower for simple command endpoints
Reject extremely nested payload before binding
```

Tidak semua standard API JSON-P/JSON-B menyediakan depth limit portable di level spec. Karena itu, pembatasan sering dilakukan di:

- HTTP server/container,
- reverse proxy,
- API gateway,
- custom streaming parser wrapper,
- provider-specific parser config,
- pre-validation layer.

### 4.3 Array Cardinality Limit

Payload kecil bisa tetap mahal jika array sangat banyak elemen kecil.

```json
{
  "ids": ["1", "2", "3", "... 1000000 more ..."]
}
```

Risiko:

- memory pressure,
- SQL `IN` clause explosion,
- downstream fan-out,
- authorization check N kali,
- audit event terlalu besar,
- transaction terlalu lama.

Rule:

```text
Setiap array yang diterima boundary harus punya max cardinality eksplisit.
```

Contoh:

```java
public record BulkStatusRequest(
    List<String> applicationIds
) {
    public BulkStatusRequest {
        if (applicationIds == null || applicationIds.isEmpty()) {
            throw new IllegalArgumentException("applicationIds is required");
        }
        if (applicationIds.size() > 100) {
            throw new IllegalArgumentException("applicationIds maximum is 100");
        }
    }
}
```

### 4.4 String Length Limit

JSON string dapat berisi teks sangat panjang:

```json
{
  "comment": "... 50 MB text ..."
}
```

Risiko:

- memory allocation,
- database column overflow,
- log injection,
- UI rendering issue,
- search index bloat,
- email/template abuse.

Field-level constraint harus eksplisit:

```java
public record CreateCommentRequest(
    String applicationId,
    String comment
) {
    public CreateCommentRequest {
        requireLength(applicationId, 1, 64, "applicationId");
        requireLength(comment, 1, 4000, "comment");
    }

    private static void requireLength(String value, int min, int max, String field) {
        if (value == null || value.length() < min || value.length() > max) {
            throw new IllegalArgumentException(field + " length must be between " + min + " and " + max);
        }
    }
}
```

### 4.5 Token Count Limit

Size saja tidak cukup. Payload kecil bisa memiliki banyak token:

```json
[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]
```

Atau:

```json
{"a":1,"b":2,"c":3,"d":4, ...}
```

Streaming parser wrapper dapat menghitung event/token dan menghentikan parse jika melebihi batas.

Pseudo-pattern:

```java
int tokenCount = 0;
int maxTokens = 100_000;

try (JsonParser parser = Json.createParser(reader)) {
    while (parser.hasNext()) {
        JsonParser.Event event = parser.next();
        tokenCount++;
        if (tokenCount > maxTokens) {
            throw new BadRequestException("JSON token limit exceeded");
        }
        // continue processing
    }
}
```

---

## 5. Duplicate Key Problem

JSON object dengan duplicate key adalah salah satu sumber ambiguity paling berbahaya.

```json
{
  "role": "USER",
  "role": "ADMIN"
}
```

Pertanyaan:

- parser mengambil nilai pertama?
- parser mengambil nilai terakhir?
- parser menyimpan semua pair?
- parser reject?
- signature dihitung atas bentuk mana?
- audit trail menampilkan bentuk mana?
- authorization mengecek bentuk mana?

Jika service A dan B berbeda behavior, attacker bisa membuat payload yang terlihat aman di satu layer tetapi diproses berbeda di layer lain.

### 5.1 Contoh Failure

```text
API Gateway logs first role = USER
Application binder takes last role = ADMIN
Audit stores normalized object = ADMIN
Security review reads gateway log = USER
```

Ini bukan sekadar bug parser. Ini bug forensic defensibility.

### 5.2 Policy

Untuk input dari luar:

```text
Reject duplicate object member names.
```

Namun JSON-P object model mungkin sudah membangun object sebelum Anda bisa melihat duplicate, tergantung provider behavior. Untuk strict duplicate detection, pendekatan yang lebih aman adalah streaming parse dan maintain field set per object depth.

### 5.3 Duplicate Detection dengan Streaming Parser

Contoh konseptual:

```java
public final class StrictJsonDuplicateDetector {

    public static void assertNoDuplicateKeys(Reader reader) {
        Deque<Set<String>> objectStack = new ArrayDeque<>();

        try (JsonParser parser = Json.createParser(reader)) {
            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();

                switch (event) {
                    case START_OBJECT -> objectStack.push(new HashSet<>());
                    case END_OBJECT -> objectStack.pop();
                    case KEY_NAME -> {
                        if (objectStack.isEmpty()) {
                            throw new IllegalStateException("KEY_NAME outside object");
                        }
                        String key = parser.getString();
                        Set<String> keys = objectStack.peek();
                        if (!keys.add(key)) {
                            throw new BadRequestException("Duplicate JSON key: " + key);
                        }
                    }
                    default -> {
                        // no-op
                    }
                }
            }
        }
    }
}
```

Dalam real implementation, error message jangan selalu echo raw key jika key bisa mengandung karakter kontrol. Sanitize sebelum log/response.

### 5.4 Duplicate Key dan Canonicalization

Jika JSON digunakan untuk:

- signature,
- hash,
- idempotency key,
- deduplication,
- audit integrity,
- event replay,

maka duplicate key harus ditolak sebelum canonicalization. Kalau tidak, canonical form dapat menyembunyikan payload asli.

---

## 6. Unknown Field Policy

Unknown field adalah field yang dikirim client tetapi tidak ada di DTO.

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "isAdmin": true
}
```

Jika DTO hanya punya `name` dan `email`, apa yang terjadi pada `isAdmin`?

Ada dua policy:

1. **Ignore unknown fields**  
   Baik untuk forward compatibility.

2. **Reject unknown fields**  
   Baik untuk strict command boundary dan security.

Keduanya valid, tergantung endpoint.

### 6.1 Kapan Ignore Unknown Field Masuk Akal?

Ignore bisa masuk akal untuk:

- event consumer yang harus forward compatible,
- analytics payload,
- read model synchronization,
- partner contract yang berevolusi additive,
- gateway yang hanya mengambil subset payload.

Contoh:

```text
Service menerima event ApplicationSubmittedV2,
tetapi consumer lama hanya butuh applicationId dan submittedAt.
```

Unknown field boleh diabaikan agar consumer tidak rusak saat producer menambah field.

### 6.2 Kapan Reject Unknown Field Lebih Aman?

Reject lebih aman untuk:

- command endpoint,
- admin operation,
- approval/rejection workflow,
- state transition,
- user/role/permission update,
- payment/amount update,
- regulatory decision,
- audit-sensitive write.

Karena unknown field bisa menjadi sinyal:

- client salah versi,
- attacker mencoba mass assignment,
- typo field menyebabkan intended change tidak terjadi,
- integrasi upstream drift.

### 6.3 Policy Matrix

| Boundary | Recommended Unknown Field Policy | Reason |
|---|---|---|
| Public command API | Reject | Security and clear contract |
| Internal state transition command | Reject | Prevent silent workflow drift |
| Partner event consumer | Usually ignore + audit unknown count | Forward compatibility |
| Bulk import | Reject or quarantine | Data quality matters |
| Audit replay event | Reject if signed/canonical; otherwise versioned | Replay determinism |
| Search/filter request | Reject | Typos can create broad queries |
| Telemetry payload | Ignore with sampling | High evolution tolerance |

### 6.4 JSON-B and Unknown Field Reality

JSON-B is specification-driven binding, but strict unknown-property rejection may not be portable across all providers in the same way as in Jackson’s `FAIL_ON_UNKNOWN_PROPERTIES`. For Jakarta JSON-B, if strict unknown field policy is required, a robust approach is:

```text
Parse JSON-P object
  → collect field names
  → compare against endpoint allowlist
  → reject unknowns
  → then bind to DTO
```

This makes strictness explicit and not dependent on provider quirks.

Example:

```java
public final class JsonFieldAllowlist {

    public static void assertOnlyAllowed(JsonObject object, Set<String> allowedFields) {
        List<String> unknown = object.keySet().stream()
            .filter(key -> !allowedFields.contains(key))
            .sorted()
            .toList();

        if (!unknown.isEmpty()) {
            throw new BadRequestException("Unknown JSON fields: " + unknown);
        }
    }
}
```

For nested objects, use recursive allowlist schema:

```java
public record FieldRule(
    Set<String> scalarFields,
    Map<String, FieldRule> objectFields,
    Map<String, FieldRule> arrayObjectFields
) {}
```

---

## 7. Mass Assignment

Mass assignment terjadi ketika automatic binding mengizinkan client mengisi properti yang tidak seharusnya dikontrol client.

### 7.1 Contoh Vulnerable DTO

```java
public class UpdateUserRequest {
    public String displayName;
    public String email;
    public boolean admin;
    public String status;
    public Instant createdAt;
}
```

Payload:

```json
{
  "displayName": "Alice",
  "email": "alice@example.com",
  "admin": true,
  "status": "ACTIVE",
  "createdAt": "2020-01-01T00:00:00Z"
}
```

Jika DTO yang sama juga dipakai untuk persistence/entity update, client mungkin bisa mengubah `admin`, `status`, atau `createdAt`.

### 7.2 Root Cause

Root cause mass assignment biasanya bukan parser. Root cause-nya adalah **model reuse**:

```text
External JSON DTO == internal domain object == persistence entity
```

Atau:

```text
Request JSON directly copied to entity with reflection/mapper
```

### 7.3 Safe Pattern

Gunakan command-specific DTO:

```java
public record UpdateProfileRequest(
    String displayName,
    String email
) {}
```

Lalu service menentukan field internal:

```java
public void updateProfile(UserId userId, UpdateProfileRequest request, Actor actor) {
    User user = userRepository.get(userId);

    authorization.assertCanUpdateProfile(actor, user);

    user.changeDisplayName(request.displayName());
    user.changeEmail(request.email());

    audit.record("USER_PROFILE_UPDATED", actor, userId);
}
```

Field seperti `admin`, `status`, `createdAt`, `verifiedAt` tidak pernah ada di request DTO.

### 7.4 Rule

```text
DTO untuk write operation harus mewakili action, bukan mewakili database row.
```

Buruk:

```java
UpdateApplicationDto // contains all application columns
```

Lebih baik:

```java
SubmitApplicationRequest
AssignOfficerRequest
ApproveApplicationRequest
RejectApplicationRequest
RequestClarificationRequest
WithdrawApplicationRequest
```

State machine menjadi eksplisit dan attack surface mengecil.

---

## 8. Type Confusion

JSON value bisa berupa:

- object,
- array,
- string,
- number,
- boolean,
- null.

Attack/failure terjadi saat sistem menerima tipe yang tidak diharapkan.

### 8.1 Example

Expected:

```json
{
  "amount": 1000
}
```

Unexpected but syntactically valid:

```json
{
  "amount": "1000"
}
```

Atau:

```json
{
  "amount": [1000]
}
```

Atau:

```json
{
  "amount": {"value": 1000}
}
```

Lenient binder bisa melakukan coercion:

```text
"1000" → 1000
1 → true
"false" → false
[] → empty object
```

Coercion membuat compatibility mudah, tetapi security boundary kabur.

### 8.2 Strict Boundary Rule

Untuk command API:

```text
No implicit type coercion at external boundary.
```

Jika field numeric, JSON token harus number. Jika field boolean, token harus boolean. Jika field string, token harus string.

### 8.3 JSON-P Pre-Validation

```java
JsonObject object = Json.createReader(reader).readObject();

JsonValue amountValue = object.get("amount");
if (amountValue == null || amountValue.getValueType() != JsonValue.ValueType.NUMBER) {
    throw new BadRequestException("amount must be a JSON number");
}

BigDecimal amount = object.getJsonNumber("amount").bigDecimalValueExact();
```

Use `bigDecimalValueExact()` where exactness matters, but handle exceptions cleanly.

---

## 9. Numeric Precision and Range

JSON number grammar does not define Java numeric type. It is just a textual number.

Examples:

```json
1
1.0
1e3
9007199254740993
99999999999999999999999999999999999999
0.0000000000000000000000000000000000001
```

### 9.1 Java Type Mapping Risk

| JSON number | Java target | Risk |
|---|---|---|
| `1` | `int` | overflow if large |
| `1.5` | `int` | truncation or reject depending binder |
| `9007199254740993` | JavaScript client | precision loss |
| `1e1000` | `BigDecimal` | memory/CPU cost |
| `0.1` | `double` | binary floating imprecision |
| money amount | `double` | unacceptable rounding risk |

### 9.2 Money Rule

For money/fee/fine/tax/regulatory amount:

```text
Never bind to double/float.
Use BigDecimal plus scale/range validation.
```

Example:

```java
public static BigDecimal requireMoney(JsonObject object, String field) {
    JsonNumber number = object.getJsonNumber(field);
    if (number == null) {
        throw new BadRequestException(field + " is required");
    }

    BigDecimal value = number.bigDecimalValue();

    if (value.scale() > 2) {
        throw new BadRequestException(field + " must have at most 2 decimal places");
    }
    if (value.signum() < 0) {
        throw new BadRequestException(field + " must not be negative");
    }
    if (value.compareTo(new BigDecimal("1000000000.00")) > 0) {
        throw new BadRequestException(field + " exceeds maximum allowed amount");
    }

    return value;
}
```

### 9.3 ID Rule

IDs should often be strings, not numbers.

Bad:

```json
{
  "applicationId": 9007199254740993
}
```

Good:

```json
{
  "applicationId": "9007199254740993"
}
```

Reason:

- JavaScript number precision limit,
- leading zero preservation,
- database ID format evolution,
- composite IDs,
- opaque identifier principle.

### 9.4 Range Policy

Every numeric field needs:

```text
minimum
maximum
scale
integer/decimal policy
unit
business meaning
```

Example:

```text
field: fineAmount
JSON type: number
Java type: BigDecimal
min: 0.00
max: 999999.99
scale: 2
unit: SGD
rounding: reject, do not round
```

---

## 10. Null vs Absent

JSON has explicit `null`, but absent field is different.

```json
{
  "email": null
}
```

versus:

```json
{}
```

Meaning can differ:

| Payload | Possible Meaning |
|---|---|
| field absent | no change / not supplied / use default |
| field null | clear value / unknown / invalid / explicit null |

### 10.1 PUT vs PATCH

For full replacement:

```text
Absent field may mean invalid because full object is required.
```

For patch:

```text
Absent field usually means no change.
Null may mean clear, if allowed.
```

### 10.2 Dangerous DTO

```java
public record PatchUserRequest(
    String displayName,
    String email
) {}
```

This cannot distinguish:

```json
{}
```

from:

```json
{"email": null}
```

Both map to `email == null`.

### 10.3 Safer Patch Field Wrapper

```java
public sealed interface PatchField<T> permits PatchField.Absent, PatchField.NullValue, PatchField.Value {
    record Absent<T>() implements PatchField<T> {}
    record NullValue<T>() implements PatchField<T> {}
    record Value<T>(T value) implements PatchField<T> {}
}
```

Conceptual mapping:

```text
field absent → PatchField.Absent
field null   → PatchField.NullValue
field value  → PatchField.Value(value)
```

JSON-P can inspect presence before binding:

```java
if (!object.containsKey("email")) {
    return new PatchField.Absent<String>();
}
if (object.isNull("email")) {
    return new PatchField.NullValue<String>();
}
return new PatchField.Value<>(object.getString("email"));
```

### 10.4 Rule

For high-stakes updates:

```text
Do not let Java null carry three meanings.
```

Split absent, explicit null, and invalid.

---

## 11. Date and Time Ambiguity

Date/time JSON is usually string.

Examples:

```json
"2026-06-17"
"2026-06-17T10:15:30"
"2026-06-17T10:15:30Z"
"2026-06-17T10:15:30+07:00"
"17/06/2026"
"06/17/2026"
```

### 11.1 Risk

- timezone lost,
- local date interpreted as UTC,
- DST issue,
- date-only interpreted as start/end of day inconsistently,
- business calendar mismatch,
- client locale ambiguity,
- audit timestamp not comparable.

### 11.2 Policy

Use clear semantic types:

| Business meaning | Java type | JSON representation |
|---|---|---|
| Instant event time | `Instant` | ISO-8601 with `Z` or offset |
| Local business date | `LocalDate` | `YYYY-MM-DD` |
| Local appointment time | `OffsetDateTime` or `ZonedDateTime` | include offset/zone policy |
| Month period | `YearMonth` or string | `YYYY-MM` |
| Time without date | `LocalTime` | only if business meaning is clear |

### 11.3 Rule

```text
Never accept ambiguous date formats at enterprise boundary.
```

Bad:

```json
{"submittedAt":"17/06/2026 10:00"}
```

Good:

```json
{"submittedAt":"2026-06-17T03:00:00Z"}
```

For local date:

```json
{"effectiveDate":"2026-06-17"}
```

---

## 12. Polymorphic Binding Risk

Polymorphic binding maps JSON to different Java subtypes based on type discriminator.

Example:

```json
{
  "type": "EMAIL",
  "to": "user@example.com",
  "subject": "Hello"
}
```

Could map to:

```java
sealed interface NotificationRequest permits EmailNotification, SmsNotification {}
```

Polymorphism is useful, but dangerous if implementation allows arbitrary class names or unsafe subtype resolution.

### 12.1 Dangerous Pattern

```json
{
  "@class": "com.example.internal.AdminCommand",
  "...": "..."
}
```

Any system that lets payload choose arbitrary Java class name is suspicious.

### 12.2 Safe Pattern

Use explicit allowlisted discriminator:

```java
public enum NotificationType {
    EMAIL,
    SMS
}
```

Mapping:

```java
NotificationRequest parse(JsonObject object) {
    String type = object.getString("type", null);
    return switch (type) {
        case "EMAIL" -> parseEmail(object);
        case "SMS" -> parseSms(object);
        default -> throw new BadRequestException("Unsupported notification type");
    };
}
```

### 12.3 Rule

```text
Payload may select business subtype, never arbitrary implementation class.
```

---

## 13. JSON Injection Is Usually Context Injection

JSON itself is a data format. Injection usually happens when JSON values are moved into another context without escaping/encoding.

### 13.1 Log Injection

Payload:

```json
{
  "username": "alice\nERROR payment approved by admin"
}
```

Bad log:

```java
log.info("Login failed for username={}", username);
```

Depending logging setup, newline/control chars may forge log entries.

Safe approach:

- structured logging,
- escaping control characters,
- length limits,
- do not log raw payload by default,
- correlation ID separate from user input.

Example sanitize:

```java
public static String safeForLog(String value, int maxLength) {
    if (value == null) return null;

    String sanitized = value
        .replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("\t", "\\t");

    if (sanitized.length() > maxLength) {
        return sanitized.substring(0, maxLength) + "...[truncated]";
    }
    return sanitized;
}
```

### 13.2 HTML/JavaScript Injection

JSON value later rendered into HTML:

```json
{
  "displayName": "<script>alert(1)</script>"
}
```

If frontend renders unsafely, this becomes XSS.

Backend should not assume all JSON string values are safe for all contexts. Encoding must happen at output context:

```text
HTML text context → HTML encode
HTML attribute context → attribute encode
JavaScript string context → JS encode
URL context → URL encode
SQL context → parameterized query
LDAP context → LDAP escaping
Shell context → avoid shell or strict argument passing
```

### 13.3 Template Injection

Payload:

```json
{
  "message": "${T(java.lang.Runtime).getRuntime().exec('...')}"
}
```

If message is later used as server-side template, risk increases.

Rule:

```text
User-provided JSON values are data, never template source.
```

---

## 14. Logging Raw JSON Payloads

Logging raw JSON is tempting during debugging. In production, it is dangerous.

### 14.1 Risks

Raw payload may contain:

- passwords,
- tokens,
- API keys,
- PII,
- NRIC/passport-like identifiers,
- address,
- medical/legal data,
- huge text,
- malicious control characters,
- hidden duplicate keys,
- values later used out of context.

### 14.2 Better Logging Model

Instead of:

```java
log.info("requestBody={}", rawJson);
```

Log:

```text
correlationId
endpoint
actorId / subject id if allowed
payload size
schema version
field presence summary
validation error code
business entity id
result status
latency
```

Example:

```java
log.info("json_request_rejected endpoint={} correlationId={} reason={} sizeBytes={} depth={} tokenCount={}",
    endpoint,
    correlationId,
    reasonCode,
    sizeBytes,
    depth,
    tokenCount
);
```

### 14.3 Redaction

If payload-level logging is required for non-production or controlled audit:

```java
private static final Set<String> SENSITIVE_FIELDS = Set.of(
    "password",
    "token",
    "accessToken",
    "refreshToken",
    "authorization",
    "secret",
    "nric",
    "passportNo",
    "email",
    "phone"
);
```

Recursive redaction:

```java
public static JsonValue redact(JsonValue value) {
    return switch (value.getValueType()) {
        case OBJECT -> redactObject(value.asJsonObject());
        case ARRAY -> redactArray(value.asJsonArray());
        default -> value;
    };
}

private static JsonObject redactObject(JsonObject object) {
    JsonObjectBuilder builder = Json.createObjectBuilder();
    for (Map.Entry<String, JsonValue> entry : object.entrySet()) {
        String key = entry.getKey();
        JsonValue val = entry.getValue();
        if (SENSITIVE_FIELDS.contains(key.toLowerCase(Locale.ROOT))) {
            builder.add(key, "[REDACTED]");
        } else {
            builder.add(key, redact(val));
        }
    }
    return builder.build();
}

private static JsonArray redactArray(JsonArray array) {
    JsonArrayBuilder builder = Json.createArrayBuilder();
    for (JsonValue item : array) {
        builder.add(redact(item));
    }
    return builder.build();
}
```

Caveat: redaction-by-field-name is not perfect. Best policy is still minimization.

---

## 15. Error Response Safety

When JSON parsing fails, do not expose internal parser stack trace.

Bad:

```json
{
  "error": "jakarta.json.stream.JsonParsingException: Unexpected char at org.eclipse.parsson..."
}
```

Better:

```json
{
  "errorCode": "INVALID_JSON",
  "message": "Request body is not valid JSON.",
  "correlationId": "7d3c..."
}
```

For validation error:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "fields": [
    {
      "field": "amount",
      "code": "OUT_OF_RANGE",
      "message": "amount exceeds maximum allowed value"
    }
  ],
  "correlationId": "7d3c..."
}
```

Do not include:

- raw payload,
- SQL error,
- stack trace,
- class names,
- full internal field path if it leaks model internals,
- secret/token fragments.

---

## 16. Validation Boundary vs Authorization Boundary

Validation answers:

```text
Is the payload well-formed and semantically valid?
```

Authorization answers:

```text
Is this actor allowed to do this operation on this object/property/state?
```

They must not be merged.

### 16.1 Example

Payload:

```json
{
  "applicationId": "APP-001",
  "decision": "APPROVE"
}
```

Validation:

```text
applicationId exists syntactically
decision is one of APPROVE/REJECT
```

Authorization:

```text
actor is assigned officer
actor has approval role
application is in approvable state
actor is not applicant
approval amount within delegation limit
```

A JSON validator cannot answer those domain questions.

### 16.2 Rule

```text
Passing JSON validation must never imply permission.
```

---

## 17. Schema Validation: Useful but Not Enough

JSON Schema can define structure, types, required fields, range, pattern, and more. It is useful for contract clarity and early rejection.

But schema validation does not replace:

- authorization,
- state machine checks,
- database uniqueness,
- cross-entity invariant,
- business policy,
- fraud/risk checks,
- anti-replay logic,
- idempotency,
- audit rules.

### 17.1 Good Use of Schema

Schema is good for:

```text
field presence
type
string length
numeric range
array cardinality
additionalProperties policy
enum shape
basic pattern
contract documentation
contract tests
client generation
```

### 17.2 Bad Use of Schema

Schema is insufficient for:

```text
application can transition from DRAFT to SUBMITTED
actor can approve this case
amount is within officer approval limit
email is verified by trusted provider
postal code exists in authoritative source
submitted date is before deadline considering public holiday
```

### 17.3 Schema + Code Pattern

```text
JSON syntax validation
  → JSON schema validation
  → DTO binding
  → bean validation / constructor validation
  → domain authorization
  → domain invariant
  → persistence constraint
```

Do not skip later layers because earlier layers exist.

---

## 18. JSON-P Hardening Pattern

For high-stakes command endpoint, JSON-P can be used as a pre-binding strict layer.

### 18.1 Strict Intake Pipeline

```text
Read limited bytes
Decode UTF-8
Streaming parse with token/depth/duplicate detection
Build JsonObject only if under limits
Allowlist fields
Validate JSON types
Extract primitives exactly
Create request DTO
Run Bean Validation or constructor validation
Map to command
Authorize command
Execute domain transition
```

### 18.2 Example Strict Parser Facade

```java
public final class StrictJsonIntake {

    private final int maxDepth;
    private final int maxTokens;
    private final int maxStringLength;

    public StrictJsonIntake(int maxDepth, int maxTokens, int maxStringLength) {
        this.maxDepth = maxDepth;
        this.maxTokens = maxTokens;
        this.maxStringLength = maxStringLength;
    }

    public JsonObject readObject(Reader reader) {
        String json = readAndValidateStreaming(reader);
        try (JsonReader jsonReader = Json.createReader(new StringReader(json))) {
            JsonStructure structure = jsonReader.read();
            if (structure.getValueType() != JsonValue.ValueType.OBJECT) {
                throw new BadRequestException("JSON root must be object");
            }
            return structure.asJsonObject();
        }
    }

    private String readAndValidateStreaming(Reader reader) {
        StringWriter copy = new StringWriter();
        Deque<Set<String>> objectKeys = new ArrayDeque<>();
        int depth = 0;
        int tokens = 0;

        // In production, avoid double reading for very large bodies.
        // This example prioritizes clarity.
        String raw = readLimited(reader);

        try (JsonParser parser = Json.createParser(new StringReader(raw))) {
            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();
                tokens++;
                if (tokens > maxTokens) {
                    throw new BadRequestException("JSON token limit exceeded");
                }

                switch (event) {
                    case START_OBJECT -> {
                        depth++;
                        if (depth > maxDepth) throw new BadRequestException("JSON depth limit exceeded");
                        objectKeys.push(new HashSet<>());
                    }
                    case END_OBJECT -> {
                        objectKeys.pop();
                        depth--;
                    }
                    case START_ARRAY -> {
                        depth++;
                        if (depth > maxDepth) throw new BadRequestException("JSON depth limit exceeded");
                    }
                    case END_ARRAY -> depth--;
                    case KEY_NAME -> {
                        String key = parser.getString();
                        if (key.length() > maxStringLength) {
                            throw new BadRequestException("JSON key too long");
                        }
                        if (!objectKeys.peek().add(key)) {
                            throw new BadRequestException("Duplicate JSON key");
                        }
                    }
                    case VALUE_STRING -> {
                        if (parser.getString().length() > maxStringLength) {
                            throw new BadRequestException("JSON string too long");
                        }
                    }
                    default -> {
                        // number, true, false, null
                    }
                }
            }
        }

        return raw;
    }

    private String readLimited(Reader reader) {
        // Implement character/body size limit here or enforce before this layer.
        throw new UnsupportedOperationException("example");
    }
}
```

Production note:

- avoid buffering huge body twice,
- enforce byte size before char decoding,
- handle malformed UTF-8 at transport layer,
- prefer framework/gateway limits where possible,
- keep parser error mapped to safe error code.

---

## 19. JSON-B Hardening Pattern

JSON-B is convenient for binding. It should be used behind explicit boundary decisions.

### 19.1 Safe Use

```java
Jsonb jsonb = JsonbBuilder.create(new JsonbConfig()
    .withNullValues(false)
);

CreateApplicationRequest request = jsonb.fromJson(reader, CreateApplicationRequest.class);
```

This is fine for low-risk endpoints if:

- body size is limited,
- DTO is command-specific,
- field validation exists,
- unknown field policy is intentional,
- no dangerous polymorphism,
- no entity binding,
- no sensitive logging.

### 19.2 Safer High-Stakes Use

```text
JSON-P strict intake
  → field allowlist
  → JSON-B bind from sanitized JsonObject/String
  → validation
```

Example:

```java
JsonObject object = strictIntake.readObject(reader);
JsonFieldAllowlist.assertOnlyAllowed(object, Set.of(
    "applicationId",
    "decision",
    "remarks"
));

String normalized = object.toString();
ApproveApplicationRequest request = jsonb.fromJson(normalized, ApproveApplicationRequest.class);
```

### 19.3 DTO Constructor Invariants

Prefer immutable DTOs / records where possible.

```java
public record ApproveApplicationRequest(
    String applicationId,
    String remarks
) {
    public ApproveApplicationRequest {
        if (applicationId == null || applicationId.isBlank()) {
            throw new IllegalArgumentException("applicationId is required");
        }
        if (remarks != null && remarks.length() > 4000) {
            throw new IllegalArgumentException("remarks too long");
        }
    }
}
```

Caveat: binder behavior with constructors/records depends on JSON-B version/provider and Java version. Test it explicitly.

---

## 20. Secure Defaults for JSON DTOs

### 20.1 Avoid Public Mutable Field DTOs for Sensitive Commands

Bad:

```java
public class DecisionRequest {
    public String applicationId;
    public String decision;
    public boolean override;
    public String officerId;
}
```

Better:

```java
public record ApproveApplicationRequest(
    String applicationId,
    String remarks
) {}
```

`officerId` comes from authenticated actor, not JSON.

### 20.2 Separate Request and Response DTO

Bad:

```java
public class UserDto {
    public String id;
    public String email;
    public boolean admin;
    public String passwordHash;
}
```

Better:

```java
public record UpdateUserEmailRequest(String email) {}
public record UserProfileResponse(String id, String email, String displayName) {}
```

### 20.3 Avoid Entity Binding

Bad:

```java
UserEntity user = jsonb.fromJson(reader, UserEntity.class);
entityManager.merge(user);
```

This is dangerous because persistence entity fields are not external contract fields.

Better:

```java
UpdateUserEmailRequest request = jsonb.fromJson(reader, UpdateUserEmailRequest.class);
userService.updateEmail(actor, userId, request.email());
```

---

## 21. Property-Level Authorization

Modern API security failures often happen not because endpoint is unauthenticated, but because object property access is not authorized.

Example response:

```json
{
  "id": "USR-001",
  "name": "Alice",
  "email": "alice@example.com",
  "salary": 10000,
  "disciplinaryNotes": "..."
}
```

Endpoint is authenticated, but response includes fields actor should not see.

### 21.1 Response DTO Must Be Audience-Specific

Bad:

```java
UserResponse response = mapper.toResponse(userEntity);
```

Better:

```java
public record PublicUserProfileResponse(
    String id,
    String displayName
) {}

public record AdminUserProfileResponse(
    String id,
    String displayName,
    String email,
    String status
) {}
```

### 21.2 Do Not Rely Only on `@JsonbTransient`

`@JsonbTransient` helps hide fields in serialization, but response design should not depend solely on annotations over a broad object. Use explicit response DTOs.

Why?

- annotation can be removed accidentally,
- different serializer may ignore it,
- object reused in another context,
- nested object may expose sensitive fields,
- future field added without annotation.

---

## 22. Denial of Service via Binding Graph

Even if JSON parser is safe, object binding can create huge object graphs.

```json
{
  "items": [
    {"a": {"b": {"c": "..."}}},
    {"a": {"b": {"c": "..."}}}
  ]
}
```

Binding risk:

- many DTO instances,
- validation traverses graph,
- mapper copies graph again,
- audit serializes graph again,
- domain event duplicates graph,
- persistence stores huge CLOB.

### 22.1 Multiplication Effect

```text
1 MB JSON
  → 5 MB char/string/object model
  → 20 MB DTO graph
  → 20 MB validation graph
  → 20 MB log/audit serialization
  → GC pressure
```

The exact numbers vary, but amplification is real.

### 22.2 Rule

```text
Reject excessive shape before binding.
```

Especially for:

- arrays,
- nested objects,
- long strings,
- large numbers,
- repeated structures.

---

## 23. JSON in Messaging Systems

When JSON is used in Kafka/RabbitMQ/JMS/event streams, security concerns shift.

### 23.1 API Request vs Message Payload

API request:

```text
client waits for response
reject immediately
rate limit per caller
```

Message payload:

```text
consumer may retry forever
poison message can block partition/queue
schema drift may break deployment
bad payload may trigger DLQ storm
```

### 23.2 Message Hardening

For JSON messages:

```text
include schemaVersion/eventVersion
limit message size
strictly validate envelope
separate metadata from data
handle unknown event type explicitly
send invalid payload to DLQ with safe metadata
avoid logging full payload
idempotency key required for commands/events
```

Example envelope:

```json
{
  "eventId": "01HY...",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 3,
  "occurredAt": "2026-06-17T03:00:00Z",
  "producer": "application-service",
  "correlationId": "...",
  "data": {
    "applicationId": "APP-001"
  }
}
```

### 23.3 Poison Message Policy

```text
Parse error → DLQ immediately or after small retry count
Validation error → DLQ, not infinite retry
Transient downstream error → retry with backoff
Authorization/config error → pause/alert depending context
Unknown event version → DLQ or compatibility handler
```

Do not retry malformed JSON forever.

---

## 24. JSON and Idempotency

Idempotency keys are often derived from JSON request content.

Naive approach:

```text
hash(raw request body)
```

Problem:

These are semantically equivalent for many systems:

```json
{"a":1,"b":2}
```

```json
{
  "b": 2,
  "a": 1
}
```

But raw hash differs.

Other risk:

```json
{"amount":1}
```

```json
{"amount":1.0}
```

Are they same or different? Business must decide.

### 24.1 Safe Strategy

```text
Reject duplicate keys
Validate semantics
Normalize/canonicalize according to explicit rule
Hash canonical business command, not arbitrary raw JSON
```

Example canonical business command:

```java
public record PaymentCommandFingerprint(
    String payerId,
    String invoiceId,
    BigDecimal amount,
    String currency
) {}
```

Then canonicalize fields yourself:

```text
payerId=USR-001|invoiceId=INV-001|amount=100.00|currency=SGD
```

Do not let JSON formatting become business identity unless you really want raw-message identity.

---

## 25. JSON Canonicalization and Signatures

When JSON is signed, canonicalization matters. Without canonicalization, different textual forms can represent same logical data:

```json
{"a":1,"b":2}
```

```json
{"b":2,"a":1}
```

Signatures over raw bytes require exact byte preservation. Signatures over logical JSON require canonical JSON rules.

### 25.1 Design Choices

| Choice | Meaning |
|---|---|
| Sign raw bytes | Receiver must verify exact bytes before parsing/modification |
| Sign canonical JSON | Both sides must implement same canonicalization |
| Sign selected claims | Safer for business payload if claim set is stable |
| Sign envelope and payload separately | Useful for routing metadata vs business data |

### 25.2 Rule

Before signing JSON, define:

```text
encoding
field ordering
number normalization
string escaping
duplicate key rejection
unknown field policy
included/excluded fields
canonicalization version
```

Otherwise, signature verification becomes fragile or insecure.

---

## 26. API Gateway Is Not Enough

API gateway can enforce:

- max body size,
- rate limit,
- authentication,
- coarse schema validation,
- WAF rules,
- content-type checks.

But application still must enforce:

- business field allowlist,
- authorization,
- state transition rules,
- numeric precision,
- null semantics,
- duplicate key policy if gateway does not enforce,
- domain-specific validation,
- audit redaction.

### 26.1 Defense in Depth

```text
Gateway: reject obviously bad or too large traffic
Application intake: parse and validate exact contract
Domain: enforce invariants and authorization
Persistence: enforce constraints
Observability: log safely and alert meaningfully
```

Do not move all JSON security to gateway. Gateway does not understand your domain.

---

## 27. Content-Type and Charset

JSON request should use appropriate content type:

```http
Content-Type: application/json
```

For APIs requiring specific vendor contract:

```http
Content-Type: application/vnd.company.application-command+json; version=2
```

### 27.1 Reject Wrong Content-Type

Do not parse JSON from arbitrary content type for command endpoints.

Bad:

```text
Accept text/plain and try to parse as JSON anyway
```

Better:

```text
Require application/json or documented vendor JSON media type
```

### 27.2 Charset

JSON is typically UTF-8 in modern HTTP APIs. Be strict and consistent.

Risk:

- inconsistent byte decoding,
- signature mismatch,
- weird control characters,
- logging/display issue.

Rule:

```text
Define accepted charset and normalize early.
```

---

## 28. Safe Error Taxonomy

A good JSON boundary produces actionable errors without leaking internals.

| Error Code | HTTP | Meaning |
|---|---:|---|
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type not accepted |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds max size |
| `INVALID_JSON` | 400 | Syntax parse failure |
| `JSON_DEPTH_LIMIT_EXCEEDED` | 400 | Too deeply nested |
| `JSON_TOKEN_LIMIT_EXCEEDED` | 400 | Too many parser events |
| `DUPLICATE_JSON_FIELD` | 400 | Duplicate object key |
| `UNKNOWN_JSON_FIELD` | 400 | Field not allowed |
| `INVALID_JSON_TYPE` | 400 | Field type mismatch |
| `VALIDATION_FAILED` | 400 | Semantic validation failure |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `FORBIDDEN` | 403 | Authenticated but not allowed |
| `CONFLICT` | 409 | State/version conflict |
| `UNPROCESSABLE_COMMAND` | 422 | Valid JSON but domain rejects command |

Keep parser errors separate from domain errors. It improves debugging, metrics, and incident response.

---

## 29. Observability for JSON Boundary

Metrics to track:

```text
json_parse_fail_total
json_validation_fail_total
json_duplicate_key_reject_total
json_unknown_field_reject_total
json_payload_too_large_total
json_depth_limit_reject_total
json_binding_fail_total
json_redaction_fail_total
json_request_size_bytes histogram
json_parse_latency histogram
json_validation_latency histogram
```

### 29.1 Why Metrics Matter

If unknown field rejects spike after a deployment, likely client/server contract drift.

If payload too large spikes, likely abuse or client bug.

If duplicate key rejects appear, possible malicious probing or upstream serializer bug.

If parse latency increases, maybe large payloads or slow input pattern.

### 29.2 Sample Log Event

```json
{
  "event": "json_request_rejected",
  "endpoint": "/applications/approve",
  "reason": "UNKNOWN_JSON_FIELD",
  "correlationId": "01HY...",
  "actorType": "USER",
  "payloadSizeBytes": 1380,
  "schemaVersion": "v2"
}
```

Do not include full raw payload.

---

## 30. Testing JSON Robustness

Testing normal payload is not enough.

### 30.1 Test Matrix

For each command endpoint, test:

```text
valid minimal payload
valid full payload
missing required field
unknown field
duplicate key
wrong type
null for required field
null for optional field
absent optional field
very long string
array empty
array exceeds max
nested object too deep
large number overflow
decimal scale violation
scientific notation if not allowed
invalid date format
ambiguous date format
invalid enum
case mismatch enum
malformed JSON
wrong content-type
payload too large
control characters in string
log-forging string
```

### 30.2 Duplicate Key Test

```java
@Test
void rejectDuplicateDecisionField() {
    String json = """
        {
          "applicationId": "APP-001",
          "decision": "REJECT",
          "decision": "APPROVE"
        }
        """;

    assertThrows(BadRequestException.class, () -> intake.readObject(new StringReader(json)));
}
```

### 30.3 Numeric Precision Test

```java
@Test
void rejectAmountWithTooManyDecimalPlaces() {
    String json = """
        { "amount": 100.001 }
        """;

    JsonObject object = Json.createReader(new StringReader(json)).readObject();

    assertThrows(BadRequestException.class, () -> requireMoney(object, "amount"));
}
```

### 30.4 Mass Assignment Test

```java
@Test
void rejectUnknownAdminField() {
    String json = """
        {
          "displayName": "Alice",
          "email": "alice@example.com",
          "admin": true
        }
        """;

    JsonObject object = Json.createReader(new StringReader(json)).readObject();

    assertThrows(BadRequestException.class, () ->
        JsonFieldAllowlist.assertOnlyAllowed(object, Set.of("displayName", "email"))
    );
}
```

---

## 31. Java 8–25 Considerations

### 31.1 Java 8

In Java 8-era enterprise systems, JSON-P/JSON-B may be provided by Java EE/Jakarta EE containers or explicit dependencies.

Typical concerns:

- older provider versions,
- older TLS/runtime defaults,
- weaker module boundaries,
- legacy app servers,
- mixed `javax.*` APIs,
- entity/DTO reuse patterns common in older systems.

### 31.2 Java 11+

Java 11 removed Java EE modules from the JDK, but JSON-P/JSON-B were never generally “JDK built-in” in the same way JAXB/JAX-WS were discussed historically. Still, Java 11+ projects usually need explicit dependencies and must be clear about:

- `javax.json` vs `jakarta.json`,
- provider implementation,
- application server version,
- dependency convergence,
- JPMS module names if using module path,
- reflection requirements.

### 31.3 Java 17/21/25

Modern Java gives better DTO options:

- records,
- sealed classes,
- pattern matching,
- stronger encapsulation,
- better GC options,
- virtual threads for request handling in some stacks.

But JSON binding must be tested with these language features. Do not assume every provider handles records/sealed types/polymorphism the way you expect.

### 31.4 Namespace Migration

Legacy:

```java
import javax.json.Json;
import javax.json.bind.Jsonb;
```

Modern Jakarta:

```java
import jakarta.json.Json;
import jakarta.json.bind.Jsonb;
```

Mixing `javax.*` and `jakarta.*` APIs accidentally can create confusing classpath failures.

Rule:

```text
One application boundary should standardize on either javax generation/runtime or jakarta generation/runtime, unless explicitly isolated.
```

---

## 32. Production JSON Boundary Checklist

Use this checklist for every important JSON endpoint.

### 32.1 Transport

- [ ] Is `Content-Type` restricted?
- [ ] Is max body size enforced?
- [ ] Is charset policy defined?
- [ ] Is request timeout enforced?
- [ ] Is rate limiting configured?

### 32.2 Parser

- [ ] Is malformed JSON mapped to safe error?
- [ ] Is max depth enforced?
- [ ] Is token count or structural complexity controlled?
- [ ] Are duplicate keys rejected?
- [ ] Are huge strings rejected?
- [ ] Are huge arrays rejected?

### 32.3 Contract

- [ ] Are unknown fields intentionally allowed or rejected?
- [ ] Are field names allowlisted for command endpoints?
- [ ] Is JSON root type enforced?
- [ ] Are numeric range/scale rules explicit?
- [ ] Are date/time formats unambiguous?
- [ ] Is null vs absent semantics explicit?

### 32.4 Binding

- [ ] Is DTO command-specific?
- [ ] Is entity binding avoided?
- [ ] Is polymorphism allowlisted?
- [ ] Are constructors/invariants tested with actual provider?
- [ ] Are records/sealed classes tested on target Java/provider version?

### 32.5 Validation and Authorization

- [ ] Is structural validation separate from business validation?
- [ ] Is authorization separate from validation?
- [ ] Are property-level permissions checked?
- [ ] Are state machine transitions enforced server-side?
- [ ] Are server-controlled fields excluded from request DTO?

### 32.6 Output

- [ ] Is response DTO audience-specific?
- [ ] Are sensitive fields excluded by design, not just annotation?
- [ ] Is raw payload logging avoided?
- [ ] Is redaction tested?
- [ ] Are error responses safe?

### 32.7 Observability

- [ ] Are parse/validation rejection metrics available?
- [ ] Are correlation IDs included?
- [ ] Are rejection reasons categorized?
- [ ] Are payload size histograms tracked?
- [ ] Are DLQ reasons categorized for message consumers?

---

## 33. Reference Architecture: Secure JSON Command Intake

```text
HTTP Request
  │
  ├─ API Gateway
  │    ├─ TLS
  │    ├─ auth coarse check
  │    ├─ body size limit
  │    ├─ rate limit
  │    └─ content-type check
  │
  ├─ Application JSON Intake
  │    ├─ safe charset decode
  │    ├─ streaming syntax parse
  │    ├─ depth/token/string/array limit
  │    ├─ duplicate key reject
  │    ├─ root object enforcement
  │    ├─ field allowlist
  │    └─ type pre-validation
  │
  ├─ DTO Binding
  │    ├─ command-specific DTO
  │    ├─ immutable/record preferred
  │    └─ constructor/basic invariant
  │
  ├─ Semantic Validation
  │    ├─ Bean Validation / manual validation
  │    ├─ cross-field validation
  │    └─ reference validation
  │
  ├─ Authorization
  │    ├─ actor identity
  │    ├─ role/permission
  │    ├─ object ownership/assignment
  │    ├─ property-level authorization
  │    └─ delegation limit
  │
  ├─ Domain Command
  │    ├─ state transition check
  │    ├─ invariant enforcement
  │    ├─ idempotency check
  │    └─ transaction boundary
  │
  ├─ Persistence / Event
  │    ├─ database constraints
  │    ├─ outbox/event emission
  │    └─ audit trail
  │
  └─ Safe Response
       ├─ audience-specific DTO
       ├─ no sensitive leakage
       └─ safe error/correlation ID
```

---

## 34. Common Anti-Patterns

### 34.1 “JSON Is Trusted Because It Comes from Internal Service”

Internal service can be buggy, compromised, stale, or fed by external input.

Better:

```text
Trust identity, not payload correctness.
```

### 34.2 “DTO Equals Entity”

This causes mass assignment, data leakage, persistence coupling, and fragile API evolution.

Better:

```text
Request DTO, Response DTO, Domain Model, Persistence Entity are different models.
```

### 34.3 “Validation Annotation Is Enough”

Bean Validation is useful, but cannot replace parser limits, duplicate rejection, unknown field policy, authorization, and state transition checks.

### 34.4 “We Log Raw Payload for Debugging”

This creates privacy, security, and operational risk.

Better:

```text
Log metadata, correlation ID, safe field summary, and controlled redacted samples only when necessary.
```

### 34.5 “Lenient Parsing Improves Compatibility”

Sometimes true for event consumers. Dangerous for command endpoints.

Better:

```text
Strict commands, tolerant readers for versioned events where appropriate.
```

### 34.6 “Unknown Fields Are Harmless”

Unknown fields may reveal drift, typo, probing, or mass assignment attempt.

Better:

```text
Endpoint-specific unknown field policy.
```

---

## 35. Practical Decision Matrix

| Situation | Recommended Approach |
|---|---|
| Public write API | Strict JSON intake + reject unknown + command DTO |
| Public read filter | Strict field allowlist + max array/string/range |
| Internal command | Strict or near-strict; do not assume safe |
| Partner event consumer | Versioned envelope + tolerant reader + metrics |
| Audit event | Canonical form + duplicate reject + schema version |
| Signed JSON | Raw byte or canonical strategy defined upfront |
| Bulk import | Separate upload pipeline, not huge JSON body |
| Money/fee amount | BigDecimal + scale/range reject |
| IDs | String opaque identifiers |
| PATCH | Explicit absent/null/value model |
| Polymorphism | Business discriminator allowlist only |
| Logging | Metadata and redacted summaries, no raw default |

---

## 36. Minimal Secure JSON Intake Example

This example combines several ideas in a simplified way.

```java
public final class ApproveApplicationJsonHandler {

    private static final Set<String> ALLOWED_FIELDS = Set.of(
        "applicationId",
        "remarks"
    );

    private final StrictJsonIntake intake;
    private final Jsonb jsonb;
    private final ApprovalService approvalService;

    public ApproveApplicationJsonHandler(
        StrictJsonIntake intake,
        Jsonb jsonb,
        ApprovalService approvalService
    ) {
        this.intake = intake;
        this.jsonb = jsonb;
        this.approvalService = approvalService;
    }

    public ApprovalResponse handle(Reader body, Actor actor) {
        JsonObject object = intake.readObject(body);
        JsonFieldAllowlist.assertOnlyAllowed(object, ALLOWED_FIELDS);

        requireString(object, "applicationId", 1, 64);
        optionalString(object, "remarks", 0, 4000);

        ApproveApplicationRequest request = jsonb.fromJson(
            object.toString(),
            ApproveApplicationRequest.class
        );

        return approvalService.approve(actor, request);
    }

    private static String requireString(JsonObject object, String field, int min, int max) {
        if (!object.containsKey(field) || object.isNull(field)) {
            throw new BadRequestException(field + " is required");
        }
        JsonValue value = object.get(field);
        if (value.getValueType() != JsonValue.ValueType.STRING) {
            throw new BadRequestException(field + " must be string");
        }
        String text = object.getString(field);
        if (text.length() < min || text.length() > max) {
            throw new BadRequestException(field + " length invalid");
        }
        return text;
    }

    private static String optionalString(JsonObject object, String field, int min, int max) {
        if (!object.containsKey(field) || object.isNull(field)) {
            return null;
        }
        return requireString(object, field, min, max);
    }
}
```

Important: `approvalService.approve()` still must enforce authorization and state transition. JSON validation does not approve anything.

---

## 37. How Top Engineers Think About JSON Security

A beginner thinks:

```text
Can I deserialize this JSON?
```

A mid-level engineer thinks:

```text
Can I validate this DTO?
```

A senior engineer thinks:

```text
Does this endpoint expose any field or type that client should not control?
```

A top-level engineer thinks:

```text
What are the parser, semantic, binding, authorization, logging, replay, compatibility, and forensic failure modes of this JSON boundary over several years of system evolution?
```

That last question is the point of this part.

---

## 38. Summary

JSON security is not one feature. It is a layered discipline:

```text
limit input size
limit structure complexity
reject duplicate ambiguity
control unknown fields
avoid mass assignment
preserve numeric exactness
separate null from absent
avoid unsafe polymorphism
validate semantics
separate authorization
avoid raw logging
use audience-specific responses
observe rejection patterns
```

The most important design rule:

```text
JSON is an external representation, not your domain model.
```

And the most important production rule:

```text
Every JSON boundary needs an explicit policy for size, shape, fields, types, nulls, numbers, authorization, and logging.
```

---

## 39. Latihan

### Latihan 1 — Audit Endpoint JSON

Pilih satu endpoint write di sistem Anda. Tulis:

```text
endpoint:
actor:
operation:
allowed fields:
server-controlled fields:
unknown field policy:
max body size:
max array size:
numeric rules:
null/absent rules:
authorization rule:
logging policy:
```

Jika Anda tidak bisa mengisi salah satu item, berarti boundary belum eksplisit.

### Latihan 2 — Mass Assignment Test

Tambahkan field internal ke payload request:

```json
{
  "expectedField": "value",
  "role": "ADMIN",
  "status": "APPROVED",
  "createdBy": "attacker"
}
```

Pastikan endpoint menolak unknown field atau mengabaikannya secara aman dan tidak memengaruhi persistence.

### Latihan 3 — Duplicate Key Test

Uji payload:

```json
{
  "decision": "REJECT",
  "decision": "APPROVE"
}
```

Pastikan sistem tidak memproses payload ambiguous.

### Latihan 4 — Null vs Absent

Untuk PATCH endpoint, uji:

```json
{}
```

```json
{"email": null}
```

```json
{"email": "alice@example.com"}
```

Pastikan ketiganya memiliki semantics yang jelas.

### Latihan 5 — Observability

Buat dashboard sederhana untuk:

```text
invalid JSON
unknown field reject
duplicate key reject
payload too large
validation failed
```

Lihat apakah spike bisa dikaitkan dengan deployment/client tertentu.

---

## 40. Referensi

- RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format
- RFC 8785 — JSON Canonicalization Scheme
- Jakarta JSON Processing specification and API docs
- Jakarta JSON Binding specification and API docs
- OWASP API Security Top 10 2023, especially object property authorization and mass assignment/excessive data exposure concerns
- Provider-specific documentation for strict parsing, unknown property policy, depth/size limits, and polymorphic handling

---

## 41. Status Seri

Seri belum selesai.

Bagian ini adalah **Part 11 dari 34**.

Bagian berikutnya: **Part 12 — XML Fundamentals for Java Engineers**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-010.md">⬅️ Part 10 — B for Enterprise DTO Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-012.md">Part 12 — XML Fundamentals for Java Engineers ➡️</a>
</div>
