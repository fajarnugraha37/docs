# Strict Coding Standards — Java String, Text, Unicode, Charset

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when implementing text/string handling in Java.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. It covers `String`, `char`, Unicode code points, normalization, locale, charset, regex, formatting, parsing, logging, identifiers, filenames, search, and API/database boundaries.
>
> **Mode**: Strict. Text is data with encoding, locale, normalization, and security semantics. If these are not explicit, the implementation is incomplete.

---

## 0. Core Principle

A Java `String` is not “a list of characters” in the human sense.

A code agent must treat text as a layered model:

```text
bytes
  -> decoded with Charset
  -> UTF-16 String code units
  -> Unicode code points
  -> grapheme clusters / user-perceived characters
  -> locale-specific rules
  -> domain-specific identity/search/display rules
```

If the code crosses a boundary — file, network, database, JSON, XML, URL, log, UI, token, filename, user identifier — the rules for charset, normalization, validation, escaping, locale, and length must be explicit.

---

## 1. Version Compatibility Matrix

| Feature / API                                        | Java 11 | Java 17 |        Java 21 | Java 25 | Rule                                                                         |
| ---------------------------------------------------- | ------: | ------: | -------------: | ------: | ---------------------------------------------------------------------------- |
| `String` UTF-16 code-unit model                      |     Yes |     Yes |            Yes |     Yes | Always account for surrogate pairs                                           |
| `String.isBlank()`, `strip()`, `lines()`, `repeat()` |     Yes |     Yes |            Yes |     Yes | Allowed; prefer over ad-hoc whitespace logic where appropriate               |
| `String.formatted(...)`                              |      No |     Yes |            Yes |     Yes | Allowed only Java 15+ baseline; locale caution applies                       |
| Text blocks                                          |      No |   Final |          Final |   Final | Allowed Java 15+; use for multiline literals, not dynamic escaping shortcuts |
| `StandardCharsets.UTF_8`                             |     Yes |     Yes |            Yes |     Yes | Required for durable/cross-system encoding                                   |
| UTF-8 default charset via JEP 400                    |      No |      No | Yes if JDK 18+ |     Yes | Do not rely on default charset anyway                                        |
| `Pattern`, `Matcher`                                 |     Yes |     Yes |            Yes |     Yes | Allowed with regex safety rules                                              |
| `Normalizer`                                         |     Yes |     Yes |            Yes |     Yes | Required when domain identity/search depends on Unicode equivalence          |
| `Locale.ROOT`                                        |     Yes |     Yes |            Yes |     Yes | Required for locale-neutral case conversion                                  |
| `BreakIterator`                                      |     Yes |     Yes |            Yes |     Yes | Use when user-visible text boundary matters                                  |

### 1.1 Baseline Rule

Every implementation touching text boundaries must state:

```text
Text baseline:
- Java version: <11/17/21/25>
- External encoding: <UTF-8 / ISO-8859-1 / ...>
- Locale rule: <Locale.ROOT / user locale / fixed locale>
- Normalization rule: <none / NFC / NFKC / domain-specific>
- Length rule: <bytes / UTF-16 code units / code points / grapheme clusters>
```

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

1. Relying on platform default charset for durable data.
2. Using `new String(bytes)` or `string.getBytes()` without `Charset`.
3. Using `FileReader`, `FileWriter`, `InputStreamReader`, or `OutputStreamWriter` without charset.
4. Treating `String.length()` as human character count.
5. Iterating text with `charAt(i)` when Unicode correctness matters.
6. Using `toLowerCase()` or `toUpperCase()` without explicit `Locale`.
7. Using user input directly inside regex without quoting.
8. Building SQL, HTML, XML, JSON, shell command, LDAP, or URL output with raw string concatenation.
9. Logging secrets/tokens/passwords/raw credentials as strings.
10. Storing secrets in immutable `String` when a safer lifecycle is required.
11. Using `String.intern()` for application-level optimization without architecture approval.
12. Creating custom escaping, encoding, or canonicalization functions for security-sensitive output.
13. Validating file paths, URLs, or identifiers by substring checks only.
14. Using regex for full language parsing where a parser is required.
15. Comparing normalized and non-normalized identifiers as if they were equivalent.

### 2.2 Required by Default

1. Use `StandardCharsets.UTF_8` for new text files, API payloads, durable logs, and cross-service text.
2. Use explicit charset at every byte/text boundary.
3. Use `Locale.ROOT` for protocol, enum, key, command, configuration, and technical case conversion.
4. Use user locale only for user-facing display formatting/parsing.
5. Define whether length limit is in bytes, code units, code points, or user-perceived characters.
6. Normalize text before identity comparison if the domain allows equivalent Unicode forms.
7. Escape at output boundary, not at input boundary.
8. Keep raw input and canonicalized/validated domain values distinct.
9. Use value objects for security-sensitive or domain-sensitive strings.
10. Add tests for non-ASCII, emoji/supplementary code points, combining marks, whitespace, and locale edge cases.

---

## 3. Mental Model: String, char, Code Point, Grapheme

### 3.1 `char` Is a UTF-16 Code Unit

A `char` is not always a full Unicode character.

```java
String s = "A🚀";
int codeUnits = s.length();        // 3, because 🚀 uses a surrogate pair
int codePoints = s.codePointCount(0, s.length()); // 2
```

Rules:

1. Use `char` only for ASCII/protocol tokens or when code-unit semantics are intended.
2. Use `codePoints()` when processing Unicode characters.
3. Use `offsetByCodePoints` when slicing by code point index.
4. Never split a string by arbitrary `substring` indexes unless indexes come from Java string APIs or validated boundaries.
5. For user-visible cursor movement, truncation, or display width, code points may still be insufficient; use `BreakIterator` or UI/library support.

### 3.2 Length Semantics

| Requirement                  | Correct metric                                 | Example                                |
| ---------------------------- | ---------------------------------------------- | -------------------------------------- |
| Database `VARCHAR(50 CHAR)`  | database character semantics                   | Verify DB behavior                     |
| Database `VARCHAR2(50 BYTE)` | encoded byte length                            | Use UTF-8 bytes                        |
| API payload size limit       | bytes                                          | `payload.getBytes(UTF_8).length`       |
| SMS/legacy protocol          | protocol-specific units                        | Do not assume Java length              |
| UI max visible characters    | grapheme clusters or UX rule                   | Use text-boundary library              |
| Password minimum length      | policy-defined; often code points or graphemes | Avoid byte-only policy unless required |
| Token length                 | bytes or encoded characters                    | Define exact encoding                  |
| Filename limit               | filesystem-specific bytes/code units           | Avoid naive string length              |

Forbidden:

```java
if (name.length() > 50) { ... } // forbidden unless UTF-16 code-unit length is the actual contract
```

Required:

```java
int bytes = name.getBytes(StandardCharsets.UTF_8).length;
if (bytes > maxUtf8Bytes) {
    throw new ValidationException("name exceeds max UTF-8 byte length");
}
```

---

## 4. Charset and Encoding Rules

### 4.1 Explicit Charset Required

Allowed:

```java
String body = Files.readString(path, StandardCharsets.UTF_8);
byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
String value = new String(bytes, StandardCharsets.UTF_8);
```

Forbidden:

```java
String body = Files.readString(path); // restricted; only allowed if UTF-8-by-spec is intentionally relied upon
byte[] bytes = value.getBytes();
String value = new String(bytes);
new FileReader(file);
new FileWriter(file);
```

### 4.2 Default Charset Policy

Even though modern Java specifies UTF-8 as default from JDK 18, this standard still requires explicit charsets.

Reason:

1. Java 11 and Java 17 may run with environment-dependent defaults.
2. Many organizations still mix Java versions.
3. Legacy files may use Windows code pages, ISO-8859-1, Shift_JIS, or other encodings.
4. Silent text corruption is harder to detect than a hard failure.

### 4.3 Boundary Encoding Matrix

| Boundary            | Default rule                                                                           |
| ------------------- | -------------------------------------------------------------------------------------- |
| JSON REST API       | UTF-8                                                                                  |
| XML                 | Respect XML declaration; prefer UTF-8 for generated XML                                |
| CSV export/import   | Explicit charset in requirement; prefer UTF-8 with BOM only when required by consumers |
| Logs                | UTF-8                                                                                  |
| Internal config     | UTF-8                                                                                  |
| Database strings    | Driver/database encoding; validate before persistence if byte limit matters            |
| URL query parameter | Percent-encode using UTF-8                                                             |
| Form data           | Use framework/client API, specify charset if protocol allows                           |
| Email               | MIME-aware encoding; do not build raw MIME text manually                               |
| Legacy integration  | Use documented charset and regression fixtures                                         |

---

## 5. Locale Rules

### 5.1 Locale-Neutral Case Conversion

Use `Locale.ROOT` for technical text:

```java
enum Status { PENDING, APPROVED }

String key = input.trim().toUpperCase(Locale.ROOT);
Status status = Status.valueOf(key);
```

Forbidden:

```java
String key = input.toUpperCase(); // locale-dependent
```

Use user locale only for display:

```java
String label = displayName.toUpperCase(userLocale);
```

### 5.2 Turkish-I Rule

Any code doing case conversion must be tested with Turkish locale or equivalent edge case.

Required test idea:

```java
Locale previous = Locale.getDefault();
try {
    Locale.setDefault(Locale.forLanguageTag("tr-TR"));
    assertEquals("FILE", "file".toUpperCase(Locale.ROOT));
} finally {
    Locale.setDefault(previous);
}
```

### 5.3 Collation and Sorting

Do not sort user-facing names with plain `String.compareTo` unless binary/Unicode code-unit order is the intended contract.

| Use case                        | Rule                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Protocol keys                   | `String.compareTo`, `Comparator.naturalOrder()`                                |
| Case-insensitive technical keys | Canonicalize with `Locale.ROOT`, then compare                                  |
| User-facing alphabetical list   | Use `Collator` with explicit `Locale`                                          |
| Database sort                   | Define DB collation and ensure app expectations match                          |
| Search                          | Define normalization, accent handling, case handling, locale, and tokenization |

---

## 6. Normalization and Canonicalization

### 6.1 Normalize Only for a Stated Domain Purpose

Unicode normalization changes representation and sometimes meaning. It must not be applied casually.

Allowed purposes:

1. user identifier canonical comparison;
2. filename policy enforcement;
3. search indexing;
4. deduplication;
5. external integration requiring a normalized form.

### 6.2 Recommended Defaults

| Purpose                       | Normalization                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Display original user input   | Preserve original                                                                           |
| Technical identifier          | Define canonical form; often NFC plus case rule                                             |
| Security-sensitive identifier | Additional confusable/homograph policy required                                             |
| Search index                  | Domain-specific; often NFKC/case-fold/accent policy                                         |
| Password                      | Usually preserve exact sequence; do not silently normalize unless policy explicitly says so |
| Filename storage              | Prefer generated internal filename; preserve display name separately                        |

### 6.3 Canonical Value Object

Preferred pattern:

```java
public final class Username {
    private final String displayValue;
    private final String canonicalValue;

    private Username(String displayValue, String canonicalValue) {
        this.displayValue = displayValue;
        this.canonicalValue = canonicalValue;
    }

    public static Username from(String raw) {
        String display = requireNonBlank(raw, "username");
        String canonical = Normalizer.normalize(display.strip(), Normalizer.Form.NFC)
                .toLowerCase(Locale.ROOT);
        validateUsername(canonical);
        return new Username(display, canonical);
    }

    public String displayValue() { return displayValue; }
    public String canonicalValue() { return canonicalValue; }
}
```

Rules:

1. Keep display and canonical forms separate.
2. Use canonical form for equality/lookup if domain requires it.
3. Use display form only for rendering.
4. Document normalization form.
5. Test composed and decomposed Unicode forms.

---

## 7. Blank, Empty, Whitespace

### 7.1 Required Distinctions

| State            | Meaning                                      | Example                |
| ---------------- | -------------------------------------------- | ---------------------- |
| `null`           | absent / unknown / not supplied              | field omitted          |
| empty string     | supplied but empty                           | `""`                   |
| blank string     | whitespace only                              | `" \t\n"`              |
| normalized empty | becomes empty after trim/strip/normalization | full-width spaces etc. |

Do not collapse these states unless business rules explicitly say so.

### 7.2 Use `isBlank` / `strip` Intentionally

Allowed:

```java
if (input == null || input.isBlank()) {
    throw new ValidationException("name is required");
}
String normalized = input.strip();
```

Rules:

1. Prefer `strip()` over `trim()` for Unicode-aware whitespace removal.
2. Do not strip passwords, tokens, signatures, base64 payloads, or fixed-width protocol values unless protocol requires it.
3. Preserve original input if audit/debug requires exact source.
4. Validate after normalization, not before only.

---

## 8. String Concatenation, Formatting, and Builders

### 8.1 Concatenation

Allowed:

```java
String fullName = firstName + " " + lastName;
```

Restricted:

```java
String query = "select * from user where name = '" + name + "'"; // forbidden: injection
```

Rules:

1. Concatenation is fine for small local strings.
2. Use `StringBuilder` for loops or complex assembly.
3. Use domain-specific encoders/builders for HTML, JSON, XML, SQL, URI, shell, LDAP, and CSV.
4. Do not optimize readability away unless profiling proves string creation is hot.

### 8.2 `String.format` / `formatted`

Rules:

1. Use explicit locale for user-facing formatting.
2. Use `Locale.ROOT` for technical formatting.
3. Do not use `String.format` in hot loops unless acceptable.
4. Do not use format strings from untrusted input.
5. Prefer structured logging placeholders over preformatted strings in logs.

Allowed:

```java
String code = String.format(Locale.ROOT, "CASE-%06d", sequence);
```

### 8.3 Text Blocks

Text blocks are allowed for:

1. static SQL templates with bind parameters;
2. JSON/XML test fixtures;
3. multiline help text;
4. documentation examples.

Forbidden:

1. embedding secrets;
2. concatenating untrusted values into SQL/HTML/XML;
3. hiding escaping issues;
4. using text blocks when indentation or newline semantics are untested.

---

## 9. Regex Rules

### 9.1 Regex Safety

Forbidden:

```java
Pattern.compile(userInput); // unless userInput is intentionally a regex and authorized
```

Required for literal search:

```java
Pattern pattern = Pattern.compile(Pattern.quote(userInput));
```

Rules:

1. Compile reusable regex once as `private static final Pattern`.
2. Name complex regex with intent.
3. Add tests for positive, negative, boundary, Unicode, and malicious long input.
4. Avoid catastrophic backtracking.
5. Bound input length before regex matching on untrusted input.
6. Do not use regex for HTML/XML/JSON/SQL parsing.
7. Use named groups when it improves maintainability.

### 9.2 Validation Regex

Validation regex must be:

1. anchored with `^` and `$` or explicit full-match via `matches()`;
2. documented with allowed character classes;
3. tested for Unicode and ASCII-only cases;
4. paired with length limit;
5. paired with normalization/case policy if identity-related.

Example:

```java
private static final Pattern TECHNICAL_CODE = Pattern.compile("^[A-Z0-9_]{3,40}$");

public static String parseTechnicalCode(String raw) {
    String value = requireNonBlank(raw, "code").strip().toUpperCase(Locale.ROOT);
    if (!TECHNICAL_CODE.matcher(value).matches()) {
        throw new ValidationException("invalid code");
    }
    return value;
}
```

---

## 10. Escaping and Injection Boundaries

### 10.1 Escape at Output Boundary

Input validation and output escaping are different.

| Context        | Required approach                   |
| -------------- | ----------------------------------- |
| SQL / JPQL     | bind parameter                      |
| HTML           | framework/template escaping         |
| JavaScript     | JS-context encoder                  |
| JSON           | JSON serializer                     |
| XML            | XML writer/serializer               |
| CSV            | CSV library/writer with quote rules |
| URI path/query | URI builder / percent encoding      |
| Shell command  | avoid shell; pass argv array        |
| LDAP           | LDAP filter/name escaping library   |
| Logs           | structured logging + redaction      |
| Regex          | `Pattern.quote` for literals        |

Forbidden:

```java
String html = "<div>" + userName + "</div>";
String sql = "where name = '" + name + "'";
String url = base + "?q=" + query;
```

### 10.2 Canonicalization Before Authorization

For security checks, canonicalize before comparing.

Examples:

1. normalize path before base-directory containment check;
2. parse URI before host allow-list check;
3. normalize identifier before lookup;
4. decode percent-encoding before path traversal detection, but avoid double-decoding bugs;
5. do not compare mixed encoded/raw values.

---

## 11. Strings and Secrets

### 11.1 Restricted Use of `String` for Secrets

`String` is immutable and cannot be reliably wiped. For long-lived sensitive values, prefer secret-management abstractions and short lifetime.

Rules:

1. Do not log secrets.
2. Do not put secrets in exception messages.
3. Do not store secrets in static final strings.
4. Do not include secrets in `toString()`.
5. Do not expose secrets through generated record/class `toString()`.
6. Prefer token IDs/fingerprints for audit correlation.
7. For password input in CLI, use `Console.readPassword()` where applicable.
8. Do not pretend `char[]` alone solves secret lifecycle; it only allows wiping in some flows.

### 11.2 Redaction

Use centralized redaction:

```java
public final class Redacted {
    private final String label;

    private Redacted(String label) {
        this.label = label;
    }

    public static Redacted of(String label) {
        return new Redacted(label);
    }

    @Override
    public String toString() {
        return "<redacted:" + label + ">";
    }
}
```

Never rely on every caller remembering to mask values.

---

## 12. API, DTO, and Database String Rules

### 12.1 DTO Rules

1. External DTOs may use raw strings.
2. Domain layer should convert raw strings into validated value objects.
3. Do not pass raw strings deep into domain/services when the string has business meaning.
4. Validation error messages must identify the field, not echo unsafe raw input.
5. Generated OpenAPI/schema max length must match implementation length semantics.

### 12.2 Database Rules

1. Do not assume Java string length equals database column capacity.
2. Know whether DB uses byte or char semantics.
3. Validate before insert/update if truncation would be dangerous.
4. Do not rely on DB silent truncation.
5. Define collation for unique constraints involving case/accent/locale behavior.
6. Store canonical key separately if needed.
7. Do not store normalized-only display names unless product requirement allows it.

### 12.3 JSON Rules

1. Use JSON library, not manual concatenation.
2. Validate length after JSON decoding.
3. Define Unicode normalization policy after decoding.
4. Do not compare raw escaped JSON forms.
5. Avoid accepting duplicate object keys if security-sensitive; define parser behavior.

---

## 13. URLs, URIs, and Identifiers

### 13.1 URI Handling

Rules:

1. Use `URI`/URI builder APIs, not raw string concatenation.
2. Encode path segment and query parameter differently.
3. Do not encode a whole URL as if it were a query parameter.
4. Normalize and validate scheme/host/port/path before network calls.
5. Revalidate after redirects.
6. Avoid `URL` equality or host resolution semantics for identity decisions.

### 13.2 Identifier Handling

For usernames, tenant IDs, case IDs, document IDs, role names, and codes:

1. define allowed alphabet;
2. define case sensitivity;
3. define normalization;
4. define max length;
5. define display vs canonical value;
6. define uniqueness rule;
7. define audit/log representation.

Forbidden:

```java
boolean admin = roleName.toLowerCase().equals("admin");
```

Allowed:

```java
boolean admin = roleName.strip().equalsIgnoreCase("ADMIN"); // only if role names are ASCII and case-insensitive by policy
```

Preferred:

```java
RoleName role = RoleName.parse(rawRole);
if (role.equals(RoleName.ADMIN)) { ... }
```

---

## 14. Performance Rules

### 14.1 Do Not Micro-Optimize Blindly

Forbidden by default:

1. `String.intern()` as a memory optimization;
2. manual char buffer pooling;
3. unsafe string reflection hacks;
4. premature replacement of readable code with complex builders;
5. custom UTF-8 encoders/decoders.

Required for hot paths:

1. profile first;
2. benchmark with realistic text and encodings;
3. test non-ASCII data;
4. measure allocation and throughput;
5. keep correctness tests before optimization.

### 14.2 Builder Usage

Use `StringBuilder` for loop assembly:

```java
StringBuilder sb = new StringBuilder(expectedSize);
for (Item item : items) {
    sb.append(item.code()).append('\n');
}
return sb.toString();
```

Rules:

1. Prefer estimating capacity when large.
2. Do not use shared mutable builders across threads.
3. Do not use `StringBuffer` unless synchronized builder semantics are explicitly required.
4. Use streaming/writer APIs for very large output.

### 14.3 Large Text

For large text files/payloads:

1. stream instead of full read;
2. specify charset decoder behavior if malformed input matters;
3. apply max size limit;
4. avoid building giant strings in memory;
5. process by lines only if line boundaries are guaranteed and max line length is bounded;
6. beware files without newline.

---

## 15. Logging and Error Messages

### 15.1 Logging Rules

1. Use structured logging placeholders.
2. Never pre-concatenate expensive or sensitive values.
3. Redact secrets, tokens, passwords, PII where required.
4. Log canonical IDs, not raw payloads.
5. Bound logged string length.
6. Sanitize control characters if logs can be parsed line-by-line.
7. Do not allow log injection via newline/control characters.

Allowed:

```java
log.info("case_updated caseId={} status={}", caseId, status);
```

Forbidden:

```java
log.info("payload=" + rawRequestBody);
```

### 15.2 Exception Messages

Exception messages must not include:

1. password/token/secret;
2. raw authorization header;
3. full request payload;
4. SQL with sensitive bind values;
5. filesystem absolute path if it leaks infrastructure;
6. untrusted raw string without length/control cleanup.

---

## 16. Testing Requirements

Any non-trivial string/text implementation must include tests for:

1. null input if allowed/forbidden;
2. empty string;
3. blank string;
4. leading/trailing whitespace;
5. tabs/newlines/control characters;
6. Unicode BMP characters;
7. supplementary character/emoji;
8. combining marks, e.g. `é` vs `e + \u0301`;
9. Turkish `I/İ/i/ı` if case conversion exists;
10. very long input;
11. invalid encoding bytes if decoding external data;
12. injection payload relevant to context;
13. normalization equivalence if applicable;
14. byte-length limit if applicable;
15. serialization/deserialization round trip.

### 16.1 Required Edge Fixtures

```java
static final String ASCII = "ABC xyz 123";
static final String EMOJI = "A🚀B";
static final String COMPOSED_E = "é";
static final String DECOMPOSED_E = "e\u0301";
static final String TURKISH_UPPER_I_DOT = "İ";
static final String TURKISH_LOWER_DOTLESS_I = "ı";
static final String ZERO_WIDTH = "a\u200Bb";
static final String NBSP = "a\u00A0b";
```

---

## 17. Anti-Patterns

### 17.1 Stringly-Typed Domain

Bad:

```java
void approve(String caseId, String status, String userRole) { ... }
```

Better:

```java
void approve(CaseId caseId, CaseStatus status, RoleName userRole) { ... }
```

Rule: any string with business meaning should become a value object when it crosses into domain logic.

### 17.2 Magic Delimiter Protocol

Bad:

```java
String encoded = tenantId + "|" + caseId + "|" + action;
```

Better:

1. structured JSON/protobuf;
2. typed composite key object;
3. escaping-aware library;
4. documented grammar if custom format is unavoidable.

### 17.3 Normalize Everywhere

Bad:

```java
input = Normalizer.normalize(input, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
```

without domain explanation.

Rule: normalization changes semantics. It must be justified.

### 17.4 One Utility Class for All Text

Bad:

```java
StringUtils.clean(String s)
```

if it trims, lowercases, removes accents, strips symbols, and normalizes without a domain name.

Better:

```java
UsernameCanonicalizer
CaseReferenceParser
SearchTextNormalizer
FileDisplayNamePolicy
```

---

## 18. LLM Implementation Protocol

Before generating or modifying string/text code, the agent must answer:

```text
1. Is this text internal or external?
2. What is the charset at every byte boundary?
3. Is comparison binary, case-insensitive, locale-aware, or normalized?
4. Is length measured in bytes, UTF-16 code units, code points, or graphemes?
5. Is the value display text, identifier, token, secret, payload, or protocol syntax?
6. Is escaping required? Which output context?
7. Is normalization required? Which form and why?
8. Can raw input be preserved separately from canonical value?
9. What are the Unicode/locale/security tests?
```

If the agent cannot answer, it must not implement the string transformation.

---

## 19. Reviewer Checklist

A reviewer must reject code if any answer is unclear:

- [ ] Are charsets explicit at byte/text boundaries?
- [ ] Is locale explicit for case conversion/formatting?
- [ ] Is `String.length()` used only when UTF-16 code units are intended?
- [ ] Are code points/graphemes considered where needed?
- [ ] Is normalization policy explicit?
- [ ] Are display and canonical forms separated when needed?
- [ ] Is escaping context-specific and done at output boundary?
- [ ] Are SQL/HTML/JSON/XML/URI/shell outputs built through safe APIs?
- [ ] Are secrets prevented from logs, exceptions, `toString()`, and records?
- [ ] Are regex patterns safe from injection and catastrophic backtracking?
- [ ] Are non-ASCII, emoji, combining marks, blank, and long input tested?
- [ ] Are raw strings replaced by value objects in domain logic?
- [ ] Are database/API length semantics aligned?

---

## 20. Prompt Contract for LLM Code Agents

Use this instruction when asking an LLM to implement Java string/text code:

```text
You are implementing Java text/string handling under strict standards.

Mandatory rules:
- Do not rely on default charset. Use explicit Charset, usually StandardCharsets.UTF_8.
- Do not use String.length() as human-character count unless UTF-16 code-unit length is the contract.
- Do not use charAt loops for Unicode-sensitive logic; use code points or appropriate text boundary APIs.
- Do not call toLowerCase/toUpperCase without Locale. Use Locale.ROOT for technical identifiers.
- Do not concatenate untrusted input into SQL, HTML, XML, JSON, URI, shell, LDAP, regex, or logs.
- Escape at the output boundary using context-specific APIs.
- Keep raw, display, and canonical values separate when identity/search/security matters.
- Do not log secrets or raw sensitive payloads.
- Include tests for null/empty/blank, Unicode, emoji, combining marks, Turkish case, long input, and injection payloads.

Before coding, state charset, locale, normalization, length semantics, escaping context, and test cases.
```

---

## 21. References

- Java SE `String` API: https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/lang/String.html
- Java SE `Character` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Character.html
- Java SE `StandardCharsets` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/StandardCharsets.html
- Java SE `Normalizer` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/text/Normalizer.html
- Java SE `Locale` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Locale.html
- Java SE `Pattern` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/regex/Pattern.html
- JEP 400 — UTF-8 by Default: https://openjdk.org/jeps/400
- OWASP Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html
- OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
