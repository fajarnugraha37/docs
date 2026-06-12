# learn-java-data-types-part-028.md

# Java Data Types — Part 028  
# Security Implications: Secret Handling, Injection Boundary, Deserialization, Numeric Safety, PII, Logging, dan Secure Type Design

> Seri: **Advanced Java Data Types**  
> Bagian: **028**  
> Fokus: memahami pilihan data type sebagai keputusan keamanan: secret vs normal string, PII, token, password, path, SQL/HTML/JSON/XML boundary, unsafe deserialization, polymorphic typing, numeric overflow, BigDecimal/money, date/time expiry, equality timing, logging leakage, validation limits, canonicalization, and secure-by-construction domain types.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Data Type adalah Security Boundary](#2-mental-model-data-type-adalah-security-boundary)
3. [Untrusted Data vs Trusted Domain Type](#3-untrusted-data-vs-trusted-domain-type)
4. [Secret, Sensitive, PII, dan Public Data](#4-secret-sensitive-pii-dan-public-data)
5. [`String` untuk Secret: Masalah dan Trade-Off](#5-string-untuk-secret-masalah-dan-trade-off)
6. [`char[]`, `byte[]`, `SecretKey`, dan Destroyable](#6-char-byte-secretkey-dan-destroyable)
7. [Safe `toString`, Logging, dan Redaction](#7-safe-tostring-logging-dan-redaction)
8. [Token, API Key, Password, dan Credential Types](#8-token-api-key-password-dan-credential-types)
9. [Constant-Time Equality dan Timing Leak](#9-constant-time-equality-dan-timing-leak)
10. [Input Validation as Security Boundary](#10-input-validation-as-security-boundary)
11. [Canonicalization Before Authorization](#11-canonicalization-before-authorization)
12. [Path, Filename, dan Path Traversal](#12-path-filename-dan-path-traversal)
13. [URL, URI, SSRF, dan Host Validation](#13-url-uri-ssrf-dan-host-validation)
14. [SQL Injection dan Query Parameter Types](#14-sql-injection-dan-query-parameter-types)
15. [HTML/JavaScript Output dan XSS Boundary](#15-htmljavascript-output-dan-xss-boundary)
16. [XML, XXE, dan Parser Configuration](#16-xml-xxe-dan-parser-configuration)
17. [JSON Deserialization dan Mass Assignment](#17-json-deserialization-dan-mass-assignment)
18. [Java Native Deserialization Risk](#18-java-native-deserialization-risk)
19. [`ObjectInputFilter` dan Serialization Filtering](#19-objectinputfilter-dan-serialization-filtering)
20. [Polymorphic Deserialization dan Type Confusion](#20-polymorphic-deserialization-dan-type-confusion)
21. [Numeric Overflow dan Integer Safety](#21-numeric-overflow-dan-integer-safety)
22. [Money, BigDecimal, Rounding, dan Fraud Risk](#22-money-bigdecimal-rounding-dan-fraud-risk)
23. [Date/Time Security: Expiry, Replay, Clock Skew](#23-datetime-security-expiry-replay-clock-skew)
24. [Collections, Size Limits, dan Denial of Service](#24-collections-size-limits-dan-denial-of-service)
25. [Regex, Pattern, dan ReDoS](#25-regex-pattern-dan-redos)
26. [Enum, Status, dan Authorization Confusion](#26-enum-status-dan-authorization-confusion)
27. [ID Types, IDOR, dan Tenant Boundary](#27-id-types-idor-dan-tenant-boundary)
28. [Error Data Types dan Information Disclosure](#28-error-data-types-dan-information-disclosure)
29. [Cache Keys, Session Data, dan Security Context](#29-cache-keys-session-data-dan-security-context)
30. [Serialization of Security-Sensitive Data](#30-serialization-of-security-sensitive-data)
31. [Audit Data Types](#31-audit-data-types)
32. [Secure Type Design Patterns](#32-secure-type-design-patterns)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Security bug sering tidak terlihat sebagai “security code”.

Banyak bug keamanan berasal dari data type yang terlalu lemah:

```java
String token;
String role;
String redirectUrl;
String filePath;
String tenantId;
BigDecimal amount;
LocalDateTime expiresAt;
Map<String, Object> request;
```

Semua compile.

Tetapi masing-masing bisa membawa risiko:

- token bocor di log;
- role dikirim client dan dipercaya;
- redirect URL menjadi open redirect/SSRF;
- file path menjadi path traversal;
- tenantId tidak diikat dengan authenticated principal;
- amount dibulatkan salah;
- `LocalDateTime` expiry salah timezone;
- `Map<String,Object>` menerima field yang tidak seharusnya.

Tujuan bagian ini:

- memahami data type sebagai security boundary;
- mendesain type untuk secrets/PII/token/path/URL/money/date;
- menghindari injection dari boundary;
- memahami unsafe deserialization;
- memahami numeric overflow dan rounding;
- memahami timing leak pada equality;
- menghindari logging leakage;
- menghubungkan validation, authorization, serialization, dan domain type.

---

# 2. Mental Model: Data Type adalah Security Boundary

Type bukan hanya representasi data.

Type bisa menjawab:

```text
Apakah data ini sudah divalidasi?
Apakah aman untuk dilog?
Apakah boleh dieksekusi sebagai query/path/URL?
Apakah sudah canonical?
Apakah berasal dari user?
Apakah tenant-scoped?
Apakah rahasia?
Apakah bisa dibandingkan secara timing-safe?
```

## 2.1 Raw input

```java
String redirectUrl
```

Belum trusted.

## 2.2 Validated domain type

```java
record AllowedRedirectUrl(URI value) {}
```

Sudah melewati allowlist.

## 2.3 Secret type

```java
final class AccessToken {
    private final String value;

    @Override
    public String toString() {
        return "AccessToken[masked]";
    }
}
```

Tidak bocor di log.

## 2.4 Tenant-scoped ID

```java
record TenantScopedCaseId(TenantId tenantId, CaseId caseId) {}
```

Mencegah ID dipakai tanpa tenant boundary.

## 2.5 Rule

```text
Raw String is not a security model.
```

---

# 3. Untrusted Data vs Trusted Domain Type

Semua input eksternal harus dianggap untrusted:

- HTTP request;
- query parameter;
- header;
- JWT claim sebelum verifikasi;
- Kafka message dari luar trust boundary;
- DB data dari legacy/manual scripts;
- file import;
- environment variable;
- config from remote source;
- webhook payload.

## 3.1 Raw DTO

```java
record CloseCaseRequest(String caseId, String reason) {}
```

Untrusted.

## 3.2 Validation

```java
CaseId caseId = new CaseId(request.caseId());
ClosureReason reason = new ClosureReason(request.reason());
```

## 3.3 Authorization

Validation bukan authorization.

```java
caseAuthorization.ensureCanClose(actor, caseId);
```

## 3.4 Trusted domain command

```java
record CloseCaseCommand(CaseId caseId, OfficerId actor, ClosureReason reason) {}
```

Command sudah typed, tapi authorization tetap harus dipastikan.

## 3.5 Rule

```text
Parse -> validate -> canonicalize -> authorize -> execute.
```

Jangan skip.

---

# 4. Secret, Sensitive, PII, dan Public Data

Tidak semua data sama.

## 4.1 Public data

Aman ditampilkan/dilog.

Example:

```text
public product code
public document title
```

## 4.2 Sensitive data

Tidak rahasia kriptografis, tapi perlu dibatasi.

Example:

- email;
- phone;
- address;
- identity number;
- user profile;
- internal case reason.

## 4.3 PII

Personally identifiable information.

Needs minimization, masking, retention policy, access control.

## 4.4 Secret

Data yang jika bocor memberi akses.

Examples:

- password;
- access token;
- refresh token;
- API key;
- private key;
- session cookie;
- HMAC secret.

## 4.5 Security type should encode class

```java
record EmailAddress(String value) {}
final class AccessToken {}
record PublicCaseReference(String value) {}
```

## 4.6 Rule

Use different types for different sensitivity classes.

---

# 5. `String` untuk Secret: Masalah dan Trade-Off

String is immutable and convenient.

But for secrets:

```java
String password = request.password();
```

Problems:

- cannot clear contents;
- may be interned accidentally;
- appears in heap dump;
- easy to log via toString;
- copies created during parsing/serialization;
- lifecycle hard to control.

## 5.1 But frameworks use String

HTTP libraries, JSON libraries, JDBC often expose strings.

You cannot avoid all copies.

## 5.2 Practical stance

For most web apps:

- avoid logging secrets;
- minimize lifetime;
- do not store plaintext passwords;
- hash passwords with proper password hashing;
- mask toString;
- avoid putting secrets in exceptions;
- use secret managers for config secrets.

## 5.3 When char[]/byte[] matters

For high-security flows, char[]/byte[] may allow clearing.

But copies may already exist.

## 5.4 Password as String in DTO

Sometimes unavoidable. Immediately map/hash and discard reference.

## 5.5 Rule

Do not pretend String secret is safe. Treat it as sensitive and minimize exposure.

---

# 6. `char[]`, `byte[]`, `SecretKey`, dan Destroyable

## 6.1 char[]/byte[]

Can be cleared:

```java
Arrays.fill(passwordChars, '\0');
Arrays.fill(secretBytes, (byte) 0);
```

## 6.2 Ownership

If wrapper takes array, copy or take ownership explicitly.

```java
final class SecretBytes implements AutoCloseable {
    private byte[] value;

    SecretBytes(byte[] value) {
        this.value = value.clone();
    }

    @Override
    public void close() {
        if (value != null) {
            Arrays.fill(value, (byte) 0);
            value = null;
        }
    }
}
```

## 6.3 SecretKey

`javax.crypto.SecretKey` represents secret key material. Java SE 25 API notes provider implementations should override `destroy` and `isDestroyed` from `Destroyable` to allow sensitive key information to be destroyed, cleared, or unreferenced.

## 6.4 Destroyable caveat

Destroyability depends on implementation.

Do not assume every key can truly be wiped.

## 6.5 Avoid exposing key bytes

Do not call `getEncoded()` unless needed.

## 6.6 Rule

Use appropriate crypto key types for cryptographic material; use byte[]/char[] with ownership discipline for raw secrets.

---

# 7. Safe `toString`, Logging, dan Redaction

Generated `toString` can leak secrets.

Bad:

```java
record LoginRequest(String username, String password) {}
```

Log:

```java
LoginRequest[username=fajar, password=secret123]
```

## 7.1 Override toString

```java
record LoginRequest(String username, String password) {
    @Override
    public String toString() {
        return "LoginRequest[username=" + username + ", password=***]";
    }
}
```

## 7.2 Better secret type

```java
record PasswordInput(String value) {
    @Override
    public String toString() {
        return "PasswordInput[masked]";
    }
}
```

## 7.3 Structured logging

Log selected safe fields.

```java
log.info("Login attempt userId={} correlationId={}", userId, correlationId);
```

## 7.4 Redaction policy

Centralize redaction for:

- token;
- authorization header;
- cookie;
- password;
- API key;
- PII.

## 7.5 Avoid raw request body logging

Especially for auth, payment, PII.

## 7.6 Rule

Every sensitive type needs safe string representation.

---

# 8. Token, API Key, Password, dan Credential Types

## 8.1 AccessToken

```java
public final class AccessToken {
    private final String value;

    public AccessToken(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("token required");
        }
        this.value = value;
    }

    public String rawValueForAuthorizationHeaderOnly() {
        return value;
    }

    @Override
    public String toString() {
        return "AccessToken[masked]";
    }
}
```

## 8.2 API Key

```java
record ApiKeyId(String value) {}
final class ApiKeySecret { ... }
```

Separate ID from secret.

## 8.3 Password

Never store plaintext password.

Use password hashing algorithm suitable for passwords:

- Argon2;
- bcrypt;
- scrypt;
- PBKDF2 depending policy/platform.

## 8.4 Credential command

```java
record LoginCommand(Username username, PasswordInput password) {}
```

## 8.5 Token scope

Represent claims/scopes explicitly.

```java
record AuthenticatedPrincipal(UserId userId, TenantId tenantId, Set<Scope> scopes) {}
```

## 8.6 Rule

Credentials deserve dedicated types, not raw `String`.

---

# 9. Constant-Time Equality dan Timing Leak

Comparing secrets with ordinary equality can leak timing information if comparison stops at first difference.

## 9.1 Bad for secrets

```java
providedToken.equals(expectedToken)
```

May short-circuit.

## 9.2 Digest compare

Java SE 25 `MessageDigest.isEqual(byte[], byte[])` is intended for comparing digests; its implementation behavior is documented in the Java API.

```java
boolean ok = MessageDigest.isEqual(expectedDigest, providedDigest);
```

## 9.3 Compare hashes, not raw passwords

For passwords, verify with password hashing library.

## 9.4 Same length concern

Some constant-time APIs still leak length if lengths differ or are checked first.

Design token format/compare carefully.

## 9.5 Do not roll crypto

Use vetted library/API.

## 9.6 Rule

Any equality check that protects access should be reviewed for timing behavior.

---

# 10. Input Validation as Security Boundary

OWASP Java Security Cheat Sheet emphasizes validation and injection prevention for Java application code, and OWASP Input Validation guidance generally recommends allowlist validation wherever possible.

## 10.1 Allowlist

Good:

```java
Pattern.compile("^[A-Z0-9_]{3,64}$")
```

## 10.2 Denylist

Weak:

```java
if (!input.contains("'")) ...
```

Attackers bypass.

## 10.3 Size limits

Always bound size:

- string length;
- array length;
- JSON nesting;
- upload size;
- numeric range.

## 10.4 Type-specific validation

Use domain types:

```java
PolicyCode
CaseId
TenantId
SafeFileName
AllowedRedirectUri
```

## 10.5 Validation not escaping

Validation does not replace:

- SQL prepared statements;
- HTML output encoding;
- safe XML parser config;
- SSRF allowlist;
- authorization.

## 10.6 Rule

Validate shape and meaning early, then use context-specific safe APIs at sink.

---

# 11. Canonicalization Before Authorization

Canonicalization converts equivalent representations to one canonical form.

Security checks must operate on canonical form.

## 11.1 Path example

Input:

```text
/uploads/tenant-a/../tenant-b/file.pdf
```

If authorization checks raw prefix before resolving path, bypass possible.

## 11.2 Email/code

```java
" case-000001 "
"CASE-000001"
```

Canonicalize if policy allows.

## 11.3 Unicode

Confusable characters and normalization can affect identity/search.

## 11.4 URL host

Normalize and parse URI before allowlist.

## 11.5 Rule

```text
Canonicalize -> validate -> authorize.
```

But be careful: some values like passwords should not be normalized/truncated silently.

---

# 12. Path, Filename, dan Path Traversal

Path traversal occurs when user input escapes intended directory.

Bad:

```java
Path path = base.resolve(userInput);
Files.readString(path);
```

If `userInput = "../../etc/passwd"`.

## 12.1 Safe path type

```java
record SafeFileName(String value) {
    SafeFileName {
        Objects.requireNonNull(value);
        if (!value.matches("^[A-Za-z0-9._-]{1,100}$")) {
            throw new IllegalArgumentException("Invalid file name");
        }
        if (value.equals(".") || value.equals("..")) {
            throw new IllegalArgumentException("Invalid file name");
        }
    }
}
```

## 12.2 Resolve and normalize

```java
Path resolved = base.resolve(fileName.value()).normalize();
if (!resolved.startsWith(base.normalize())) {
    throw new SecurityException("Path traversal");
}
```

## 12.3 Symlink concern

For high-security file access, handle symlinks and use secure directory APIs/policies.

## 12.4 Do not accept raw path when only filename needed

Use `SafeFileName`.

## 12.5 Extension validation

Extension is not content validation.

## 12.6 Rule

User input should usually choose an ID/file name, not arbitrary filesystem path.

---

# 13. URL, URI, SSRF, dan Host Validation

SSRF occurs when server fetches attacker-controlled URL.

Bad:

```java
URI callback = URI.create(request.callbackUrl());
httpClient.get(callback);
```

## 13.1 AllowedRedirectUri

```java
record AllowedRedirectUri(URI value) {}
```

Construct only after allowlist.

## 13.2 Validate

- scheme `https`;
- host allowlist;
- port allowlist;
- no userinfo;
- no localhost/private IP if external fetch;
- DNS rebinding considerations;
- redirects revalidated.

## 13.3 URI parsing

Use URI parser, not string contains.

## 13.4 ID instead of URL

Better:

```json
{"callbackId": "PAYMENT_STATUS_WEBHOOK"}
```

Server maps to configured URL.

## 13.5 Open redirect

Redirect URL should be allowlisted.

## 13.6 Rule

Never fetch/redirect to arbitrary user-supplied URL.

---

# 14. SQL Injection dan Query Parameter Types

OWASP SQL Injection Prevention Cheat Sheet recommends prepared statements with parameterized queries as a primary defense.

## 14.1 Bad

```java
String sql = "SELECT * FROM case WHERE id = '" + caseId + "'";
```

## 14.2 Good

```java
PreparedStatement ps = connection.prepareStatement(
    "SELECT * FROM case WHERE id = ?"
);
ps.setString(1, caseId.value());
```

## 14.3 Typed ID helps but not enough

`CaseId` validates format, but still use prepared statement.

## 14.4 Dynamic ORDER BY

Prepared statements cannot bind column names.

Use allowlist enum:

```java
enum CaseSortField {
    CREATED_AT("created_at"),
    CASE_ID("case_id");

    final String sqlColumn;
}
```

## 14.5 IN clause

Use safe parameter expansion or framework support.

## 14.6 Rule

Domain type validation reduces attack surface; parameterized query prevents SQL injection at sink.

---

# 15. HTML/JavaScript Output dan XSS Boundary

XSS occurs when untrusted data is interpreted as HTML/JS.

## 15.1 Validation is not encoding

Even valid name can contain characters requiring escaping.

```text
O'Connor <script>
```

## 15.2 Output encoding

Encode according to context:

- HTML text;
- HTML attribute;
- JavaScript string;
- CSS;
- URL.

## 15.3 Do not store escaped data globally

Store raw canonical data; escape at output sink.

## 15.4 Rich text

If allowing HTML, sanitize with trusted sanitizer and policy.

## 15.5 JSON in HTML

Embedding JSON in script tag needs careful escaping.

## 15.6 Rule

Data type can mark text as untrusted/sanitized, but output context still controls encoding.

---

# 16. XML, XXE, dan Parser Configuration

OWASP XXE Prevention Cheat Sheet explains XXE occurs when untrusted XML with external entity references is processed by weakly configured XML parser.

## 16.1 Risk

XXE can lead to:

- file disclosure;
- SSRF;
- denial of service;
- internal network probing.

## 16.2 XML input type

Do not accept arbitrary XML into generic DOM parser without secure config.

## 16.3 Disable external entities

Configure parser features appropriately for your parser.

## 16.4 Prefer safer formats

If XML not required, use JSON with schema validation.

## 16.5 Validate size/nesting

Prevent XML bombs.

## 16.6 Rule

XML payload type must include parser security policy.

---

# 17. JSON Deserialization dan Mass Assignment

Mass assignment occurs when deserializer binds fields the client should not control.

Bad:

```java
class UserEntity {
    public String displayName;
    public boolean admin;
}
```

Client sends:

```json
{"displayName":"Fajar","admin":true}
```

## 17.1 DTO fix

```java
record UpdateProfileRequest(String displayName) {}
```

No admin field.

## 17.2 Ignore unknown fields?

If unknown fields are ignored, client may think admin set succeeded.

If rejected, forward compatibility less flexible.

Choose intentionally.

## 17.3 Read-only/write-only

OpenAPI readOnly/writeOnly documents direction, but server DTO must enforce.

## 17.4 Domain mapping

Do not bind request directly to entity.

## 17.5 Rule

Only expose fields the client is allowed to set.

---

# 18. Java Native Deserialization Risk

OWASP Deserialization Cheat Sheet focuses on safely deserializing untrusted data and warns about risks of deserialization.

Java native deserialization of untrusted bytes is dangerous because gadget chains on classpath can trigger code during deserialization.

## 18.1 Bad

```java
ObjectInputStream in = new ObjectInputStream(requestBody);
Object obj = in.readObject();
```

from untrusted input.

## 18.2 Risks

- remote code execution;
- denial of service;
- type confusion;
- resource exhaustion.

## 18.3 Avoid

Do not use Java native serialization for untrusted external boundary.

## 18.4 Safer alternatives

- JSON with explicit DTO and validation;
- Protobuf/Avro with schema;
- custom strict parser.

## 18.5 If unavoidable

Use serialization filters, allowlists, strict class controls, and isolate.

## 18.6 Rule

Never deserialize untrusted Java serialized object streams casually.

---

# 19. `ObjectInputFilter` dan Serialization Filtering

Java has `ObjectInputFilter` to control classes and graph characteristics during deserialization.

Use filters to reject unexpected classes, array sizes, depth, references, and bytes.

## 19.1 Concept

```java
ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
    "java.base/*;com.example.SafeType;!*"
);
```

## 19.2 Apply

```java
objectInputStream.setObjectInputFilter(filter);
```

## 19.3 Limits

Filters reduce risk but do not make unsafe design safe.

## 19.4 Allowlist

Prefer allowlist over denylist.

## 19.5 Still avoid untrusted native serialization

Use filter only when forced.

## 19.6 Rule

Serialization filtering is defense-in-depth, not permission to deserialize arbitrary objects.

---

# 20. Polymorphic Deserialization dan Type Confusion

Polymorphic JSON deserialization can instantiate different subtypes.

Risky if payload controls Java class.

## 20.1 Bad

```json
{"@class":"com.some.Gadget", ...}
```

## 20.2 Use logical discriminator

```json
{"type":"CARD_PAYMENT", ...}
```

## 20.3 Whitelist subtypes

Only known allowed subtypes.

## 20.4 Sealed type helps

Sealed hierarchy defines permitted variants in code, but serializer config still matters.

## 20.5 Jackson safety

Use `PolymorphicTypeValidator`/allowlists where relevant and avoid unsafe default typing for untrusted input.

## 20.6 Rule

Never let untrusted input choose arbitrary Java class.

---

# 21. Numeric Overflow dan Integer Safety

Java integer overflow is silent for primitive arithmetic.

```java
int total = price * quantity;
```

Can overflow.

## 21.1 Use exact methods

```java
int total = Math.multiplyExact(price, quantity);
long sum = Math.addExact(a, b);
```

## 21.2 Size calculation

Danger:

```java
byte[] buffer = new byte[count * itemSize];
```

Overflow can allocate wrong size.

## 21.3 Pagination

Validate:

```java
page >= 0
size between 1 and 100
offset calculation safe
```

## 21.4 Money

Never use int cents if range can exceed int.

## 21.5 BigInteger/BigDecimal

Use for large/exact numeric where needed, but enforce bounds.

## 21.6 Rule

Any numeric used for allocation, authorization, limit, amount, or index deserves overflow review.

---

# 22. Money, BigDecimal, Rounding, dan Fraud Risk

Money bugs can become security/business integrity bugs.

## 22.1 Do not use double

```java
double amount
```

for money can cause precision issues.

## 22.2 BigDecimal constructor

Avoid:

```java
new BigDecimal(10.10)
```

Use:

```java
new BigDecimal("10.10")
BigDecimal.valueOf(10.10)
```

## 22.3 Scale

Enforce scale per currency.

## 22.4 Rounding

Rounding mode must be explicit and domain-approved.

## 22.5 Negative amount

Refunds/credits may be negative in some contexts, but not all.

Use context-specific types:

```java
PaymentAmount
RefundAmount
FeeAmount
```

## 22.6 Rule

Money type is security/business control, not formatting convenience.

---

# 23. Date/Time Security: Expiry, Replay, Clock Skew

## 23.1 Token expiry

Use `Instant`, not `LocalDateTime`.

```java
Instant expiresAt
```

## 23.2 Compare

```java
boolean expired = !clock.instant().isBefore(expiresAt);
```

## 23.3 Clock skew

Distributed systems need tolerance window.

## 23.4 Replay

Use nonce/jti/idempotency key with expiry.

## 23.5 Time source

Do not trust client-provided timestamp for authorization decisions unless signed and validated.

## 23.6 DST bug

Expiry should not depend on local time/DST.

## 23.7 Rule

Security time is timeline time: `Instant`.

---

# 24. Collections, Size Limits, dan Denial of Service

Large inputs can cause DoS.

## 24.1 Array/list limits

```java
@Size(max = 100)
List<Item> items
```

## 24.2 String length

```java
@Size(max = 2000)
String reason
```

## 24.3 JSON nesting

Limit parser depth if possible.

## 24.4 Map keys

Limit number of entries and key length.

## 24.5 File upload

Limit size and content type.

## 24.6 Rule

Every external collection/string/binary payload needs size limit.

---

# 25. Regex, Pattern, dan ReDoS

ReDoS occurs when regex has catastrophic backtracking on malicious input.

## 25.1 Risky regex

Nested quantifiers:

```regex
(a+)+$
```

against long input.

## 25.2 Safer design

- use simple anchored regex;
- limit input length before regex;
- avoid nested ambiguous quantifiers;
- use parser for complex grammar.

## 25.3 Precompile Pattern

```java
private static final Pattern CASE_ID = Pattern.compile("^CASE-[0-9]{6}$");
```

## 25.4 Do not use regex for everything

URLs, emails, HTML, SQL are not safely handled by ad-hoc regex.

## 25.5 Rule

Regex validation must be bounded and reviewed.

---

# 26. Enum, Status, dan Authorization Confusion

Enums can encode allowed state, but not authorization.

## 26.1 Bad

```java
if (request.role() == ADMIN) ...
```

Client should not provide trusted role.

## 26.2 Authenticated principal

```java
AuthenticatedPrincipal principal
```

created after token verification.

## 26.3 Status transition

```java
case.close(actor)
```

should check actor permission, not only status validity.

## 26.4 User-controlled enum

Request enum is just input.

## 26.5 Rule

A valid enum value is not proof user is allowed to use it.

---

# 27. ID Types, IDOR, dan Tenant Boundary

IDOR: insecure direct object reference.

User accesses resource by changing ID.

## 27.1 Typed ID not enough

```java
CaseId caseId
```

valid format, but does user have access?

## 27.2 Tenant-scoped ID

```java
record TenantCaseRef(TenantId tenantId, CaseId caseId) {}
```

## 27.3 Repository query includes tenant

```java
findByTenantIdAndCaseId(tenantId, caseId)
```

not:

```java
findByCaseId(caseId)
```

## 27.4 Authorization check

```java
authorization.ensureCanRead(principal, caseId)
```

## 27.5 Avoid sequential public IDs if enumeration risk

Use non-guessable IDs or enforce authorization strictly.

## 27.6 Rule

ID validation is not access control.

---

# 28. Error Data Types dan Information Disclosure

Error responses can leak.

## 28.1 Bad

```json
{
  "error": "SQL error near SELECT * FROM users..."
}
```

## 28.2 Bad

```json
{
  "error": "User fajar@example.com exists"
}
```

Can enable account enumeration.

## 28.3 Good

```json
{
  "type": "https://api.example.com/problems/invalid-credentials",
  "title": "Invalid credentials",
  "status": 401
}
```

## 28.4 Validation errors

Do not echo secrets.

## 28.5 Correlation ID

Return correlation ID for support, log details server-side securely.

## 28.6 Rule

Error type should be useful but not revealing.

---

# 29. Cache Keys, Session Data, dan Security Context

## 29.1 Cache key includes tenant

Bad:

```java
"case:" + caseId
```

Good:

```java
"tenant:" + tenantId + ":case:" + caseId
```

## 29.2 Auth cache

Cache permission carefully with user/tenant/scope/version.

## 29.3 Session data

Do not store sensitive data unnecessarily.

## 29.4 Mutable security context

Avoid sharing mutable security context across requests/threads.

## 29.5 TTL

Security decisions can change. Cache authorization with short TTL or invalidation.

## 29.6 Rule

Security-sensitive cache keys must include all security dimensions.

---

# 30. Serialization of Security-Sensitive Data

## 30.1 DTO control

Do not serialize domain/security objects directly.

## 30.2 readOnly/writeOnly

In API schema:

```yaml
password:
  type: string
  writeOnly: true
```

## 30.3 Ignore fields

Use explicit DTO or serialization annotations carefully.

## 30.4 Event payload

Do not publish secrets/PII unless explicitly required and protected.

## 30.5 Heap dumps/logs

Serialized payloads may appear in logs/dead letters/heap dumps.

## 30.6 Rule

If a value should not leave the service, make it impossible or difficult to serialize accidentally.

---

# 31. Audit Data Types

Security systems need audit.

## 31.1 Audit event

```java
record AuditEvent(
    AuditEventId id,
    Instant occurredAt,
    ActorId actorId,
    TenantId tenantId,
    Action action,
    ResourceRef resource,
    AuditOutcome outcome,
    CorrelationId correlationId
) {}
```

## 31.2 No secrets

Audit should not include tokens/passwords.

## 31.3 Tamper evidence

For high assurance, audit logs may require append-only storage/signing.

## 31.4 Time

Use Instant.

## 31.5 Actor

Use authenticated principal, not request-supplied user ID.

## 31.6 Rule

Audit data types should capture who did what to which resource, when, outcome, and correlation — without leaking secrets.

---

# 32. Secure Type Design Patterns

## 32.1 Secret wrapper

```java
final class SecretValue {
    private final String value;

    @Override
    public String toString() {
        return "SecretValue[masked]";
    }
}
```

## 32.2 Validated ID

```java
record CaseId(String value) {}
```

## 32.3 Tenant-scoped reference

```java
record TenantScoped<T>(TenantId tenantId, T value) {}
```

## 32.4 Allowlisted URL

```java
record AllowedWebhookEndpoint(URI uri) {}
```

## 32.5 Safe filename

```java
record SafeFileName(String value) {}
```

## 32.6 Money type

```java
record Money(BigDecimal amount, Currency currency) {}
```

## 32.7 Non-empty collection

```java
record NonEmptyList<T>(List<T> values) {}
```

## 32.8 Security principal

```java
record AuthenticatedPrincipal(UserId userId, TenantId tenantId, Set<Scope> scopes) {}
```

## 32.9 Rule

Security-sensitive concepts deserve explicit types.

---

# 33. Production Failure Modes

## 33.1 Token leaked by record toString

Fix:

- secret wrapper;
- override toString;
- log redaction.

## 33.2 Password stored as plain String in entity

Fix:

- password hash type;
- no plaintext persistence.

## 33.3 Open redirect via redirectUrl

Fix:

- allowlisted URI type.

## 33.4 SSRF via callback URL

Fix:

- configured callback IDs;
- URL allowlist;
- private IP blocking;
- redirect validation.

## 33.5 Path traversal via filename

Fix:

- SafeFileName;
- normalize and startsWith base check.

## 33.6 SQL injection via dynamic sort

Fix:

- enum allowlist for sort field.

## 33.7 Mass assignment sets admin

Fix:

- request DTO only includes allowed fields.

## 33.8 Java deserialization RCE

Fix:

- avoid native deserialization;
- filters/allowlists if unavoidable.

## 33.9 Polymorphic JSON loads arbitrary class

Fix:

- logical discriminator;
- subtype whitelist.

## 33.10 Integer overflow bypasses limit

Fix:

- Math.*Exact;
- bounds;
- long/BigInteger as needed.

## 33.11 Money rounding exploited

Fix:

- explicit Money type and rounding policy.

## 33.12 Expiry uses LocalDateTime

Fix:

- Instant + Clock.

## 33.13 IDOR across tenant

Fix:

- tenant-scoped queries and authorization.

## 33.14 Error leaks existence

Fix:

- generic auth errors and careful problem details.

---

# 34. Best Practices

## 34.1 General

- Treat external data as untrusted.
- Use domain-specific types for security-sensitive values.
- Separate raw DTO from trusted domain command.
- Never rely on validation alone for injection prevention.
- Use prepared statements for SQL.
- Escape output by context for XSS.
- Configure XML parsers securely or avoid XML.
- Avoid Java native deserialization for untrusted data.
- Whitelist polymorphic subtypes.
- Do not let input choose Java class.
- Use size limits everywhere.
- Avoid logging secrets/PII.
- Use safe `toString` for sensitive types.
- Use `Instant` for security time.
- Use tenant-scoped IDs and authorization checks.
- Use explicit error types without leaking internals.
- Use secure password hashing, not reversible encryption/plaintext.

## 34.2 Type design

- `AccessToken`, not `String`.
- `SafeFileName`, not `String`.
- `AllowedRedirectUri`, not `String`.
- `TenantScopedCaseId`, not `CaseId` alone in multi-tenant access.
- `Money`, not `BigDecimal amount` alone.
- `AuthenticatedPrincipal`, not request-supplied `userId`.
- `PasswordHash`, not `password`.

## 34.3 Review checklist

For each field ask:

```text
Is this user-controlled?
Can it be logged?
Can it be used as path/URL/query?
Can it influence authorization?
Can it overflow?
Can it cause large allocation?
Can it be deserialized into unsafe type?
Can it leak PII/secret?
Is it tenant-scoped?
```

---

# 35. Decision Matrix

| Data/security concept | Safer type/design |
|---|---|
| password input | `PasswordInput` + immediate hash |
| password storage | `PasswordHash` |
| access token | `AccessToken` masked |
| API key | separate `ApiKeyId` and `ApiKeySecret` |
| user-provided file name | `SafeFileName` |
| user-provided URL | allowlisted URI type |
| redirect URL | `AllowedRedirectUri` |
| SQL sort field | enum allowlist |
| money | `Money(amount,currency)` |
| expiry | `Instant` |
| tenant resource | `TenantScoped<ResourceId>` |
| role/scope | from authenticated principal, not request |
| polymorphic input | discriminator + whitelist |
| deserialization | explicit DTO/schema, avoid native Java serialization |
| secrets in logs | masked toString/redaction |
| collection input | max size + element validation |
| numeric size/count | bounds + exact arithmetic |
| validation error | stable code + no secret echo |

---

# 36. Latihan

## Latihan 1 — Secret toString

Create `AccessToken` type that masks `toString`. Demonstrate safe logging.

## Latihan 2 — SafeFileName

Implement `SafeFileName` and path normalization check.

## Latihan 3 — AllowedRedirectUri

Create allowlisted redirect URI validator.

## Latihan 4 — Dynamic Sort

Replace raw sort string with enum allowlist and SQL column mapping.

## Latihan 5 — TenantScopedCaseId

Refactor repository method from `findByCaseId` to `findByTenantIdAndCaseId`.

## Latihan 6 — Numeric Overflow

Find overflow bug in `count * itemSize`. Fix with `Math.multiplyExact` and bounds.

## Latihan 7 — Money Rounding

Implement `PaymentAmount` with explicit scale and rounding policy.

## Latihan 8 — Expiry

Refactor `LocalDateTime expiresAt` to `Instant expiresAt`.

## Latihan 9 — Mass Assignment

Show entity binding vulnerability and fix with request DTO.

## Latihan 10 — Polymorphic Deserialization

Design sealed request types with stable discriminator and whitelist.

## Latihan 11 — Java Serialization Filter

Create sample `ObjectInputFilter` allowlist for trusted legacy stream.

## Latihan 12 — Error Disclosure

Rewrite detailed auth error into safe Problem Details response.

---

# 37. Ringkasan

Security is deeply connected to data type design.

Raw types like:

```java
String
long
BigDecimal
LocalDateTime
Map<String,Object>
```

are often too weak for security-sensitive concepts.

Key lessons:

- Raw input is untrusted.
- Validation is not authorization.
- Validation is not escaping.
- Secrets need safe wrappers and logging policy.
- `String` secrets are hard to clear; minimize lifetime and exposure.
- Use constant-time comparison for access-protecting digests/tokens.
- Use prepared statements for SQL.
- Encode output by context for XSS.
- Avoid unsafe XML parser config.
- Avoid native Java deserialization for untrusted input.
- Whitelist polymorphic subtypes.
- Watch numeric overflow.
- Money rounding is integrity/security concern.
- Security timestamps should use `Instant`.
- Collections/strings need size limits.
- Tenant/resource IDs need authorization and tenant scoping.
- Error responses must not leak secrets/internal details.

Senior Java engineer does not ask only:

```text
Apa type field ini?
```

They ask:

```text
Apakah field ini trusted?
Apakah bisa bocor?
Apakah bisa dipakai menyerang parser/query/path/URL?
Apakah perlu canonicalization?
Apakah perlu authorization?
Apakah aman untuk log?
Apakah bisa overflow?
Apakah bisa menyebabkan DoS?
```

Secure type design makes dangerous operations harder to express and safe operations easier to use.

---

# 38. Referensi

1. OWASP Java Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Java_Security_Cheat_Sheet.html

2. OWASP SQL Injection Prevention Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

3. OWASP Deserialization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html

4. OWASP XML External Entity Prevention Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html

5. Java SE 25 API — `ObjectInputFilter`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputFilter.html

6. Java SE 25 API — `MessageDigest`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/MessageDigest.html

7. Java SE 25 API — `SecretKey`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/crypto/SecretKey.html

8. Java SE 25 API — `Math` exact arithmetic  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Math.html

9. Java SE 25 API — `Path`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html

10. Java SE 25 API — `URI`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/URI.html
