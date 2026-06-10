# Strict Coding Standards — Go Text, String, Unicode, Encoding, Regex, and Templates

**File:** `strict-coding-standards__go_text.md`  
**Scope:** Go implementation performed by LLM/code agents involving text, string, byte slices, Unicode, UTF-8, encoding/decoding, parsing, formatting, regex, template rendering, identifiers, slugs, tokens, search keys, human input, machine protocols, logs, and security-sensitive output.  
**Mode:** Mandatory merge gate. This document is not advice. It defines constraints the agent MUST follow before proposing or committing Go code.

---

## 1. Core Principle

Text handling in Go MUST be designed around a precise distinction between:

1. **bytes** — raw storage or protocol data;
2. **string** — immutable sequence of bytes;
3. **rune** — Unicode code point, alias of `int32`;
4. **user-perceived character** — often a grapheme cluster, possibly multiple code points;
5. **normalized text** — canonical or compatibility-normalized representation;
6. **escaped text** — safe representation for a specific output context;
7. **localized text** — text whose case, collation, segmentation, or formatting depends on language/locale.

The agent MUST NOT treat these concepts as interchangeable.

---

## 2. Non-Negotiable Rules

### 2.1 Strings Are Bytes, Not Characters

The agent MUST assume that a Go `string` stores bytes. It MUST NOT assume that:

- `len(s)` returns number of characters;
- `s[i]` returns a character;
- slicing `s[a:b]` preserves valid UTF-8;
- every `string` value is valid UTF-8;
- one Unicode code point equals one visible character;
- lowercasing/uppercasing is language-independent for all domains.

Allowed:

```go
byteLen := len(s) // byte count
b := s[i]         // byte
```

Required when working with code points:

```go
for byteOffset, r := range s {
    _ = byteOffset // byte offset, not rune index
    _ = r          // rune / Unicode code point
}
```

Forbidden:

```go
// BAD: assumes byte length equals character length.
if len(name) > 20 {
    return errors.New("name too long")
}

// BAD: may cut a UTF-8 sequence in the middle.
prefix := name[:20]
```

The agent MUST state explicitly whether a limit is a byte limit, rune limit, display-width limit, or protocol-specific encoded-size limit.

---

### 2.2 Validate Text at Boundaries

For inbound text that is expected to be UTF-8, the boundary layer MUST validate it before domain logic depends on it.

Required patterns:

```go
if !utf8.ValidString(input) {
    return Input{}, errors.New("input must be valid UTF-8")
}
```

or for byte input:

```go
if !utf8.Valid(payload) {
    return errors.New("payload must be valid UTF-8")
}
```

The agent MUST NOT silently accept invalid UTF-8 when the business meaning depends on human text, identifiers, names, search keys, policy descriptions, or regulatory notes.

Accepting arbitrary bytes inside a `string` is only allowed when the variable name and type boundary make this explicit, for example:

```go
type RawToken string
```

or better:

```go
type RawToken []byte
```

---

### 2.3 Do Not Use `string` for Arbitrary Binary Data

Binary data MUST be represented as `[]byte`, `io.Reader`, `io.Writer`, `bytes.Buffer`, or domain-specific byte types.

Forbidden:

```go
func SaveBlob(blob string) error
```

Required:

```go
func SaveBlob(blob []byte) error
```

or for streaming:

```go
func SaveBlob(r io.Reader) error
```

A conversion from `[]byte` to `string` MUST be justified by one of these reasons:

- the bytes are known and validated text;
- a standard library API requires string;
- a map key needs immutable text semantics;
- the conversion is for logging/debugging with explicit escaping.

---

### 2.4 Never Use Raw User Text in Security-Sensitive Output

The agent MUST NOT concatenate untrusted text into:

- HTML;
- JavaScript;
- SQL;
- shell commands;
- regex patterns;
- LDAP filters;
- XML;
- CSV consumed by spreadsheets;
- log lines interpreted by machines;
- HTTP headers;
- file paths;
- templates with trusted-author semantics.

Every output context MUST have its own escaping/encoding rule.

Examples:

```go
// HTML output: use html/template, not text/template.
tmpl := template.Must(template.New("page").ParseFiles("page.html"))
```

```go
// Regex pattern: quote user input.
pattern := regexp.QuoteMeta(userInput)
re := regexp.MustCompile(pattern)
```

```go
// URL query: use url.Values.
q := url.Values{}
q.Set("search", userInput)
encoded := q.Encode()
```

Forbidden:

```go
// BAD: user input becomes regex syntax.
regexp.MustCompile("^" + userInput + "$" )
```

```go
// BAD: text/template does not auto-escape.
fmt.Fprintf(w, "<p>%s</p>", userInput)
```

---

## 3. Type Selection Rules

### 3.1 Use `string` Only for Immutable Text or Identifiers

Use `string` for:

- already-decoded text;
- immutable identifiers;
- map keys;
- protocol tokens that are defined as text;
- file names after validation;
- small formatted output;
- constants.

Do NOT use `string` for:

- mutable buffers;
- binary payloads;
- large streaming data;
- secrets that require zeroization;
- in-place redaction;
- frequently appended content in loops.

### 3.2 Use `[]byte` for Mutable or Binary Data

Use `[]byte` for:

- buffers;
- network payloads;
- cryptographic material;
- compressed data;
- unknown encoding;
- parser input when avoiding allocation;
- data to be overwritten or redacted.

When converting from `[]byte` to `string`, the agent MUST consider allocation and retention.

```go
s := string(b) // copies bytes into immutable string
```

When converting from `string` to `[]byte`, the agent MUST treat the result as an independent mutable copy.

```go
b := []byte(s)
b[0] = 'X'
```

### 3.3 Use `rune` Only for Unicode Code Points

Use `rune` when:

- decoding UTF-8;
- classifying Unicode code points;
- constructing or validating Unicode scalar values;
- using `unicode.IsLetter`, `unicode.IsDigit`, etc.

Do NOT use `rune` to mean:

- user-perceived character;
- glyph;
- grapheme cluster;
- display cell width;
- language-aware letter.

### 3.4 Use Domain Types for Important Text

Important text MUST NOT be represented as naked `string` across the domain boundary.

Required examples:

```go
type EmailAddress string
type CaseReference string
type PersonName string
type ExternalSystemCode string
type SearchKey string
type RedactedText string
```

Domain types MUST enforce invariants at construction time:

```go
func NewCaseReference(s string) (CaseReference, error) {
    s = strings.TrimSpace(s)
    if !utf8.ValidString(s) {
        return "", errors.New("case reference must be valid UTF-8")
    }
    if s == "" {
        return "", errors.New("case reference is required")
    }
    return CaseReference(s), nil
}
```

---

## 4. Boundary Policy

### 4.1 Input Boundary

At every input boundary, the agent MUST define:

- expected encoding;
- maximum byte size;
- maximum semantic size, if any;
- trimming policy;
- normalization policy;
- allowed character classes;
- error behavior;
- logging/redaction behavior.

Boundary examples:

- HTTP JSON body;
- query parameter;
- path segment;
- CSV import;
- Kafka message;
- file content;
- database row;
- CLI argument;
- environment variable;
- external API response.

### 4.2 Output Boundary

At every output boundary, the agent MUST define:

- target encoding;
- escaping context;
- truncation policy;
- secret redaction policy;
- newline/control-character handling;
- machine-parseable format guarantees.

The same text value may require different output encoders for logs, HTML, JSON, CSV, SQL parameters, and shell arguments.

---

## 5. UTF-8 and Unicode Rules

### 5.1 Use `unicode/utf8` for UTF-8 Validation and Decoding

Required when correctness depends on UTF-8 validity:

```go
if !utf8.ValidString(s) {
    return errors.New("invalid UTF-8")
}
```

Use `utf8.RuneCountInString` only when the requirement is code point count, not visual character count.

```go
n := utf8.RuneCountInString(s)
```

Do NOT use `utf8.RuneCountInString` for display width, UI truncation, password length policy, or legal name field policy unless the requirement explicitly says code points.

### 5.2 Invalid UTF-8 Must Be Deliberate

When ranging over a string, invalid UTF-8 is decoded as `utf8.RuneError`. The agent MUST NOT ignore this when parsing security-sensitive or user-provided text.

Required pattern:

```go
for i, r := range s {
    if r == utf8.RuneError {
        _, size := utf8.DecodeRuneInString(s[i:])
        if size == 1 {
            return errors.New("invalid UTF-8")
        }
    }
}
```

Prefer `utf8.ValidString` for whole-value validation unless streaming/incremental decoding is required.

### 5.3 Do Not Assume Normalization

The agent MUST NOT assume that visually identical Unicode strings have the same byte representation or rune sequence.

If equality, uniqueness, search, deduplication, or policy matching depends on canonical representation, the code MUST normalize at the boundary.

Recommended:

```go
import "golang.org/x/text/unicode/norm"

normalized := norm.NFC.String(input)
```

For security-sensitive identifiers, the agent MUST define a normalization form explicitly and document it. Common defaults:

- **NFC** for preserving normal human text while canonicalizing combining sequences;
- **NFKC** only when compatibility folding is explicitly intended and reviewed, because it can change semantic distinctions.

### 5.4 Case Folding Is Not Universal Lowercasing

The agent MUST NOT use `strings.ToLower` as a universal identity-normalization mechanism.

Allowed for simple ASCII-only domains after validation:

```go
func normalizeASCIIKey(s string) (string, error) {
    for _, r := range s {
        if r > unicode.MaxASCII {
            return "", errors.New("key must be ASCII")
        }
    }
    return strings.ToLower(s), nil
}
```

For language-aware case conversion, use `golang.org/x/text/cases` with `golang.org/x/text/language`:

```go
c := cases.Lower(language.Turkish)
s = c.String(s)
```

The agent MUST document whether matching is:

- byte-exact;
- Unicode code point exact;
- normalized exact;
- case-insensitive ASCII;
- case-folded Unicode;
- locale-specific;
- database collation dependent.

### 5.5 Character Classes Must Be Explicit

The agent MUST NOT use vague rules such as “alphanumeric” without specifying ASCII vs Unicode.

ASCII-only example:

```go
func isASCIIIdentifier(s string) bool {
    if s == "" {
        return false
    }
    for _, r := range s {
        if r > unicode.MaxASCII {
            return false
        }
        if !(r == '_' || r == '-' || ('0' <= r && r <= '9') || ('A' <= r && r <= 'Z') || ('a' <= r && r <= 'z')) {
            return false
        }
    }
    return true
}
```

Unicode-aware example:

```go
func isUnicodeName(s string) bool {
    if s == "" || !utf8.ValidString(s) {
        return false
    }
    for _, r := range s {
        if unicode.IsLetter(r) || unicode.IsMark(r) || unicode.IsSpace(r) || r == '-' || r == '\'' {
            continue
        }
        return false
    }
    return true
}
```

---

## 6. Length, Truncation, and Limits

### 6.1 Every Text Limit Must Name Its Unit

The agent MUST avoid ambiguous names like `MaxNameLength`. Use:

```go
const MaxNameBytes = 256
const MaxNameRunes = 80
const MaxLogFieldBytes = 4096
```

### 6.2 Byte Limits Are for Protocols and Storage

Use byte limits for:

- HTTP body size;
- Kafka message size;
- database column byte size;
- file size;
- header size;
- binary protocol fields;
- memory protection.

Required:

```go
if len(s) > MaxNameBytes {
    return errors.New("name exceeds max byte length")
}
```

### 6.3 Rune Limits Are for Code Point Semantics

Use rune limits only when the policy says code points.

```go
if utf8.RuneCountInString(s) > MaxNameRunes {
    return errors.New("name exceeds max rune length")
}
```

### 6.4 Safe UTF-8 Truncation

If truncating valid UTF-8 by bytes, the agent MUST not cut inside a UTF-8 sequence.

```go
func truncateUTF8Bytes(s string, max int) string {
    if len(s) <= max {
        return s
    }
    s = s[:max]
    for !utf8.ValidString(s) {
        s = s[:len(s)-1]
    }
    return s
}
```

For performance-sensitive code, use `utf8.DecodeLastRuneInString` instead of repeated validation.

### 6.5 Logging Truncation Must Preserve Evidence

When truncating logs, the agent MUST indicate truncation.

```go
func truncateForLog(s string, maxBytes int) string {
    if len(s) <= maxBytes {
        return s
    }
    return truncateUTF8Bytes(s, maxBytes) + "...[truncated]"
}
```

Do NOT silently truncate audit, enforcement, compliance, or workflow evidence fields unless the loss is explicitly acceptable and documented.

---

## 7. Strings, Builders, Buffers, and Allocation

### 7.1 Use `strings.Builder` for Building Strings

Use `strings.Builder` when repeatedly appending strings.

```go
var b strings.Builder
b.Grow(estimatedSize)
for _, part := range parts {
    b.WriteString(part)
}
return b.String()
```

Forbidden in loops:

```go
// BAD: repeated allocation.
out := ""
for _, part := range parts {
    out += part
}
```

Exception: small, obvious, non-loop concatenation is allowed.

### 7.2 Use `bytes.Buffer` or `bytes.Builder`-Like Byte APIs for Bytes

Use `bytes.Buffer` for mutable byte accumulation and writer-style APIs.

```go
var b bytes.Buffer
_, _ = b.Write(payload)
_, _ = b.WriteString("\n")
```

### 7.3 Do Not Copy `strings.Builder` or `bytes.Buffer` After Use

The agent MUST NOT copy non-trivial builder/buffer values after writing to them. Pass by pointer if ownership must move.

Forbidden:

```go
var b strings.Builder
b.WriteString("x")
b2 := b // BAD
```

### 7.4 Use `strings.Clone` or `bytes.Clone` When Retention Matters

When a small substring or subslice may retain a large backing object, clone the value before storing it long-term.

```go
small := strings.Clone(bigString[start:end])
```

```go
small := bytes.Clone(bigBytes[start:end])
```

The agent MUST apply this rule when extracting tokens from large files, request bodies, CSV imports, or message payloads and storing them beyond the parse phase.

---

## 8. Parsing and Formatting

### 8.1 Use `strconv` for Machine Conversion

For programmatic conversion, prefer `strconv` over `fmt`.

Required:

```go
i, err := strconv.ParseInt(s, 10, 64)
if err != nil {
    return err
}
```

```go
s := strconv.FormatInt(id, 10)
```

Avoid:

```go
fmt.Sprintf("%d", id) // avoid for hot paths and simple machine formatting
```

### 8.2 Always Specify Base and Bit Size for Numeric Parsing

The agent MUST NOT rely on implicit numeric parsing semantics when the protocol is known.

Required:

```go
n, err := strconv.ParseInt(input, 10, 32)
```

Forbidden:

```go
// BAD: ambiguous width and base for domain protocol.
n, err := strconv.Atoi(input)
```

Exception: local CLI or simple internal parsing may use `Atoi` if `int` is explicitly acceptable.

### 8.3 Quote Debug Text Safely

For debugging unexpected text, use `%q`, `%+q`, or `strconv.Quote`.

```go
log.Info("invalid input", "value", strconv.Quote(input))
```

Do NOT log raw control characters, raw newlines, or terminal escape sequences from untrusted input.

### 8.4 Avoid `fmt` for Stable Wire Formats Unless Explicit

`fmt` is acceptable for human-readable messages. For stable machine formats, use explicit encoders:

- JSON: `encoding/json` or reviewed alternative;
- CSV: `encoding/csv`;
- XML: `encoding/xml`;
- URL: `net/url`;
- binary: `encoding/binary`;
- text numeric conversion: `strconv`.

---

## 9. Tokenization and Search Keys

### 9.1 Tokenization Must Define Boundary Rules

The agent MUST NOT tokenize human text with `strings.Fields` unless whitespace-only tokenization is explicitly correct.

Questions that MUST be answered:

- Are punctuation marks separators?
- Are apostrophes part of words?
- Are Unicode letters allowed?
- Are combining marks allowed?
- Is normalization applied?
- Is case folded?
- Are stop words removed?
- Is language known?
- Are offsets byte offsets, rune offsets, or token indexes?

### 9.2 Search Key Generation Must Be Stable

Search keys MUST be generated through a single shared function, not ad hoc lower/trim calls scattered across code.

```go
type SearchKey string

func NewSearchKey(s string) (SearchKey, error) {
    if !utf8.ValidString(s) {
        return "", errors.New("search text must be valid UTF-8")
    }
    s = strings.TrimSpace(s)
    s = norm.NFC.String(s)
    s = strings.ToLower(s) // only if reviewed as acceptable for this domain
    return SearchKey(s), nil
}
```

The agent MUST add tests containing:

- ASCII;
- accents;
- composed and decomposed Unicode;
- Turkish dotted/dotless I when case folding is relevant;
- invalid UTF-8 when boundary accepts bytes;
- emoji or multi-code-point graphemes when user-visible fields exist.

---

## 10. Regular Expressions

### 10.1 Compile Regex Once

Regex values used repeatedly MUST be compiled once and reused.

```go
var caseRefRE = regexp.MustCompile(`^[A-Z]{2}-\d{6}$`)
```

Do NOT compile on every request unless the pattern is dynamic and cannot be cached.

### 10.2 Quote User Input in Regex

Dynamic regex from user input MUST use `regexp.QuoteMeta` unless the user is explicitly authorized to provide regex syntax.

```go
re := regexp.MustCompile(regexp.QuoteMeta(userInput))
```

### 10.3 Do Not Depend on Unsupported Regex Features

Go uses RE2-style regular expressions. The agent MUST NOT use backreferences, lookbehind, or catastrophic-backtracking assumptions from PCRE-style engines.

### 10.4 Regex Is Not a Parser for Structured Languages

The agent MUST NOT use regex to parse:

- HTML;
- XML;
- JSON;
- SQL;
- programming languages;
- nested expressions;
- complex CSV.

Use proper parsers.

### 10.5 Validate Regex Semantics With Tests

Every non-trivial regex MUST have table tests for:

- valid cases;
- invalid cases;
- boundary cases;
- Unicode cases if applicable;
- empty string;
- long input.

---

## 11. Templates

### 11.1 Use `html/template` for HTML

The agent MUST use `html/template` for HTML output.

Forbidden:

```go
import "text/template" // BAD for HTML output
```

Required:

```go
import "html/template"
```

### 11.2 Treat `text/template` Authors as Trusted

`text/template` MUST NOT be used with templates supplied by untrusted users unless sandboxing and function restrictions are explicitly designed and reviewed.

### 11.3 Parse During Startup, Execute During Requests

Templates SHOULD be parsed at startup or initialization, not per request.

```go
tmpl := template.Must(template.ParseFS(templatesFS, "templates/*.html"))
```

Request path:

```go
if err := tmpl.ExecuteTemplate(w, "case.html", data); err != nil {
    return err
}
```

### 11.4 Do Not Share Writers Across Parallel Template Executions

Template execution may be safe in parallel, but output can interleave if the same writer is shared. The agent MUST avoid shared writers unless synchronization or separate buffers are used.

### 11.5 Use `missingkey=error` for Strict Templates

For operational templates, notifications, documents, and compliance/audit outputs, missing values SHOULD be treated as errors.

```go
tmpl := template.Must(template.New("notice").Option("missingkey=error").Parse(src))
```

---

## 12. Logs, Audit, and Redaction

### 12.1 Logs Must Be Machine-Safe

Untrusted text in logs MUST be structured and escaped by the logger. The agent MUST NOT build log lines with raw string concatenation.

Allowed:

```go
logger.Info("case note rejected", "reason", reason, "case_ref", ref)
```

Forbidden:

```go
logger.Info("case note rejected: " + reason)
```

### 12.2 Redaction Must Happen Before Formatting

Sensitive values MUST be redacted before being formatted, logged, templated, or returned.

```go
logger.Info("request rejected", "email", RedactEmail(email))
```

Do NOT rely on downstream sinks to redact.

### 12.3 Preserve Evidence Without Leaking Secrets

For enforcement or compliance workflows, rejected text SHOULD preserve enough diagnostic information without leaking full raw content.

Recommended:

- store validation code;
- store field name;
- store byte/rune length;
- store normalized/escaped sample if safe;
- store hash/fingerprint for correlation;
- avoid storing raw secrets or raw PII unless policy allows.

---

## 13. Internationalization and Localization

### 13.1 Do Not Hardcode English Text in Domain Logic

User-facing text SHOULD be separated from domain decisions.

Forbidden:

```go
if status == Rejected {
    return "Your application is rejected"
}
```

Required:

```go
return MessageKeyApplicationRejected
```

### 13.2 Locale-Sensitive Behavior Must Be Explicit

The agent MUST NOT implement locale-sensitive case conversion, collation, sorting, pluralization, or date/number formatting with ad hoc string operations.

Use `golang.org/x/text` packages or a reviewed localization layer.

### 13.3 Sorting Human Text Is Not Byte Sorting

Byte sorting is allowed only for stable internal keys. Human-facing sorting MUST define collation requirements.

---

## 14. File Paths and Text

### 14.1 Do Not Treat Paths as Plain Text

The agent MUST use path APIs:

- `path/filepath` for OS file paths;
- `path` for slash-separated URL/archive paths;
- `net/url` for URLs.

Forbidden:

```go
file := root + "/" + userInput
```

Required:

```go
file := filepath.Join(root, userInput)
```

For security boundaries, use `os.Root` where available and appropriate in version-specific standards.

### 14.2 Path Display and Path Access Are Different

A path displayed to the user may be escaped/truncated. A path used for access MUST be validated and resolved using filesystem-safe APIs.

---

## 15. Database and External System Text

### 15.1 Database Collation Must Be Known

The agent MUST NOT assume Go string equality matches database equality.

For fields with uniqueness or search behavior, document:

- database collation;
- normalization applied before insert;
- case-sensitivity;
- accent-sensitivity;
- width/kana sensitivity if relevant;
- migration behavior for existing data.

### 15.2 Do Not Build SQL With Strings

SQL values MUST use parameters.

Forbidden:

```go
query := "select * from cases where ref = '" + ref + "'"
```

Required:

```go
row := db.QueryRowContext(ctx, `select * from cases where ref = $1`, ref)
```

### 15.3 External Encoding Must Be Explicit

If an external system sends non-UTF-8 text, the boundary adapter MUST decode to UTF-8 or preserve bytes with explicit type.

The domain layer MUST NOT receive ambiguous encoded text.

---

## 16. API and JSON Text

### 16.1 JSON Strings Are Unicode Text, But Validate Domain Semantics

JSON decoding handles string syntax, but the agent MUST still validate domain constraints:

- required/optional;
- trim policy;
- UTF-8 validity if bytes were accepted earlier;
- max bytes/runes;
- allowed characters;
- normalization;
- redaction.

### 16.2 Optional String Fields Must Be Intentional

Use different representations for:

- absent;
- present empty string;
- present null;
- present non-empty string.

Example:

```go
type PatchRequest struct {
    DisplayName *string `json:"displayName"`
}
```

If the API needs to distinguish null from absent, use a dedicated optional type.

---

## 17. Performance Rules

### 17.1 Avoid Repeated Full-String Scans

The agent MUST avoid performing multiple full scans over large text when one pass is sufficient.

Bad:

```go
if !utf8.ValidString(s) { ... }
if utf8.RuneCountInString(s) > max { ... }
if strings.ContainsAny(s, "\n\r") { ... }
```

Better for hot paths:

```go
func validateText(s string, maxRunes int) error {
    count := 0
    for _, r := range s {
        if r == utf8.RuneError {
            // optionally validate exact invalid sequence
        }
        count++
        if count > maxRunes {
            return errors.New("too long")
        }
        if r == '\n' || r == '\r' {
            return errors.New("newline not allowed")
        }
    }
    return nil
}
```

### 17.2 Stream Large Text

Large text input MUST use streaming APIs instead of reading entire content into memory, unless the size is bounded and checked.

Required:

```go
scanner := bufio.NewScanner(r)
scanner.Buffer(make([]byte, 0, 64*1024), maxTokenBytes)
```

Note: default `bufio.Scanner` token size may be too small. The agent MUST configure max token size for known large tokens or use `bufio.Reader`/custom tokenizer.

### 17.3 Avoid Unbounded Regex or Split Results

Do NOT use `strings.Split`, `regexp.FindAllString`, or similar APIs on unbounded input when the result can explode memory.

Use streaming/tokenized iteration or bounded `n` variants.

---

## 18. Error Handling for Text

### 18.1 Errors Must Identify the Field, Not Leak Full Input

Required:

```go
return fmt.Errorf("display_name: invalid UTF-8")
```

Forbidden:

```go
return fmt.Errorf("invalid display name %q", rawSecret)
```

### 18.2 Preserve Machine-Readable Error Codes

For APIs, validation errors SHOULD include stable codes:

```go
type FieldError struct {
    Field string
    Code  string
    Msg   string
}
```

Examples:

- `invalid_utf8`;
- `too_long_bytes`;
- `too_long_runes`;
- `invalid_character`;
- `not_normalized`;
- `reserved_word`;
- `unsafe_control_character`.

---

## 19. Testing Requirements

Every text-related function MUST include table tests covering the relevant cases below.

### 19.1 Required Cases

- empty string;
- ASCII valid input;
- leading/trailing spaces;
- newline/control characters;
- invalid UTF-8 if byte input is possible;
- multi-byte UTF-8;
- combining marks;
- composed vs decomposed forms;
- emoji;
- right-to-left text if displayed or stored;
- maximum length boundary;
- just-over-maximum length;
- SQL/HTML/script-looking input;
- regex metacharacters if regex is involved;
- path separators if path is involved;
- log injection with `\n`, `\r`, tabs, ANSI escape.

### 19.2 Example Test Matrix

```go
func TestNewDisplayName(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {"empty", "", true},
        {"ascii", "Fajar", false},
        {"trim", " Fajar ", false},
        {"multibyte", "日本語", false},
        {"combining", "a\u0300", false},
        {"script", "<script>alert(1)</script>", true},
        {"newline", "hello\nworld", true},
        {"invalid utf8", string([]byte{0xff}), true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            _, err := NewDisplayName(tt.input)
            if (err != nil) != tt.wantErr {
                t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

### 19.3 Fuzz Text Parsers

Text parsers, tokenizers, decoders, and validators SHOULD have fuzz tests when they parse external input.

```go
func FuzzParseCaseReference(f *testing.F) {
    f.Add("EA-123456")
    f.Add("你好")
    f.Add(string([]byte{0xff}))

    f.Fuzz(func(t *testing.T, s string) {
        _, _ = ParseCaseReference(s)
    })
}
```

Fuzz targets MUST assert invariants, not only absence of panic, when semantics are known.

---

## 20. Code Review Checklist

Before merging any Go code involving text, the agent MUST verify:

- [ ] The code distinguishes bytes, string, rune, and user-visible character.
- [ ] Every text limit names its unit: bytes, runes, display cells, or protocol size.
- [ ] Input encoding is validated at the boundary.
- [ ] Normalization policy is explicit when equality/search/dedup depends on it.
- [ ] Case conversion is ASCII-only, Unicode-aware, or locale-aware by design.
- [ ] Untrusted text is escaped for the exact output context.
- [ ] Regex patterns do not include raw untrusted input.
- [ ] HTML uses `html/template`, not `text/template`.
- [ ] Logs do not contain raw untrusted multiline/control text or secrets.
- [ ] Large text processing is bounded or streaming.
- [ ] Substrings/subslices retained from large buffers are cloned.
- [ ] Tests cover ASCII, Unicode, invalid UTF-8, length boundaries, and injection-looking input.
- [ ] Database collation and Go normalization/equality are not accidentally inconsistent.

---

## 21. Agent-Specific Operating Rules

When an LLM/code agent edits Go text code, it MUST:

1. infer and document the text unit being manipulated;
2. refuse to implement ambiguous “character length” requirements without choosing a safe explicit interpretation;
3. prefer boundary validation over scattered validation;
4. create domain constructors for important text types;
5. avoid regex when a parser is required;
6. avoid `strings.ToLower` as identity normalization unless ASCII or locale policy is clear;
7. add tests for Unicode and invalid UTF-8, not only happy-path ASCII;
8. avoid raw string concatenation for security-sensitive output;
9. preserve auditability without leaking raw secrets;
10. explain any lossy normalization, truncation, or replacement behavior in code comments or API docs.

---

## 22. Common Anti-Patterns

### 22.1 Byte Length Mistaken for Character Length

```go
if len(s) <= 10 { ... } // ambiguous and often wrong
```

### 22.2 Unsafe UTF-8 Slice

```go
s = s[:10] // may break UTF-8
```

### 22.3 Lowercase as Universal Identity Key

```go
key := strings.ToLower(name) // insufficient for many languages and normalization cases
```

### 22.4 Regex Injection

```go
regexp.MustCompile(userInput)
```

### 22.5 HTML Injection

```go
fmt.Fprintf(w, "<div>%s</div>", comment)
```

### 22.6 Log Injection

```go
log.Printf("user=%s action=login", username)
```

where `username` may contain newline/control characters.

### 22.7 Accidental Large Buffer Retention

```go
token := bigPayload[start:end]
cache[token] = true // may retain huge backing string or byte slice
```

### 22.8 Treating `rune` as a Display Character

```go
if utf8.RuneCountInString(password) >= 8 { ... } // policy may be weaker than expected
```

---

## 23. Recommended Package Use

| Need                       | Preferred package/API                                  |
| -------------------------- | ------------------------------------------------------ |
| String search/manipulation | `strings`                                              |
| Byte slice manipulation    | `bytes`                                                |
| UTF-8 validation/decoding  | `unicode/utf8`                                         |
| UTF-16 interop             | `unicode/utf16`                                        |
| Unicode classification     | `unicode`                                              |
| Numeric/string conversion  | `strconv`                                              |
| Human formatting           | `fmt`                                                  |
| Regex                      | `regexp`                                               |
| HTML templates             | `html/template`                                        |
| Trusted text templates     | `text/template`                                        |
| Unicode normalization      | `golang.org/x/text/unicode/norm`                       |
| Locale-aware casing        | `golang.org/x/text/cases` + `language`                 |
| CSV                        | `encoding/csv`                                         |
| URL query/path escaping    | `net/url`                                              |
| JSON                       | `encoding/json` or approved replacement                |
| Streaming text             | `bufio.Reader`, `bufio.Scanner` with configured buffer |

---

## 24. References

- Go Specification — strings, runes, constants, indexing, ranges: https://go.dev/ref/spec
- Go Blog — Strings, bytes, runes and characters in Go: https://go.dev/blog/strings
- `strings` package: https://pkg.go.dev/strings
- `bytes` package: https://pkg.go.dev/bytes
- `unicode/utf8` package: https://pkg.go.dev/unicode/utf8
- `unicode` package: https://pkg.go.dev/unicode
- `unicode/utf16` package: https://pkg.go.dev/unicode/utf16
- `strconv` package: https://pkg.go.dev/strconv
- `regexp` package: https://pkg.go.dev/regexp
- `text/template` package: https://pkg.go.dev/text/template
- `html/template` package: https://pkg.go.dev/html/template
- `golang.org/x/text/unicode/norm`: https://pkg.go.dev/golang.org/x/text/unicode/norm
- `golang.org/x/text/cases`: https://pkg.go.dev/golang.org/x/text/cases
- `golang.org/x/text/language`: https://pkg.go.dev/golang.org/x/text/language
